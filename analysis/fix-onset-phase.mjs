// Recomputes what each distraction interrupted, for sessions recorded before
// the fix of 16 Sep 2026.
//
//   node analysis/fix-onset-phase.mjs P01_baseline_2026-09-16.json [more ...]
//   node analysis/fix-onset-phase.mjs --write P01_...json     (also writes a side-car)
//
// The problem: detection needs a stall before it flags a distraction, and a
// stall is also what makes the classifier say Planning. So by the time an
// episode opened, the live phase had already decayed, and every episode was
// recorded as Planning - ten out of ten across the first three sessions, while
// the trace showed the writer had been Translating or Reviewing 30s earlier.
//
// The trace records the phase every 2s, so the answer is already in the data.
// This reads it back out. The original export is never modified: raw research
// records stay as they were recorded, and corrections are derived from them.

import fs from "node:fs";
import path from "node:path";
import { breakWindows } from "./compare-thresholds.mjs";

// A tick counts as "still working" if they interacted within this long. Matches
// ACTIVE_RECENCY_MS in public/content.js so live and retroactive agree.
const ACTIVE_RECENCY_SEC = 10;

function corrected(x, recencySec) {
  const cols = x.decisionTrace?.columns ?? [];
  const rows = x.decisionTrace?.rows ?? [];
  if (!rows.length) return null;
  const T = cols.indexOf("tMs"), P = cols.indexOf("phase");
  const A = cols.indexOf("attention"), I = cols.indexOf("inactiveSec");

  const sessionStart = Date.parse(x.session?.startedAt ?? 0);
  const breaks = breakWindows(x, rows.map((r) => Number(r[T])));
  let lastActive = null;
  const phaseAt = [];            // carried-forward phase, per tick
  const distractedMs = { Planning: 0, Translating: 0, Reviewing: 0 };
  const phasesMs = { Planning: 0, Translating: 0, Reviewing: 0 };

  rows.forEach((r, i) => {
    if (Number(r[I]) <= recencySec) lastActive = r[P];
    const carried = r[A] === "Distracted" ? (lastActive ?? r[P]) : r[P];
    phaseAt.push({ tMs: Number(r[T]), carried });
    if (i > 0) {
      const prevT = Number(rows[i - 1][T]), curT = Number(r[T]);
      // A break writes no rows, so its whole span would otherwise land in
      // whichever phase the first row after it carries. Take it back out.
      let dt = curT - prevT;
      for (const b of breaks) dt -= Math.max(0, Math.min(curT, b.end) - Math.max(prevT, b.start));
      dt = Math.max(0, dt);
      // Phase totals are affected by the same decay: while an episode is open
      // the frozen Planning label is what elapsed time was banked against, so
      // a tab-away during drafting was counted as time spent planning.
      if (carried in phasesMs) phasesMs[carried] += dt;
      if (r[A] === "Distracted" && carried in distractedMs) distractedMs[carried] += dt;
    }
  });

  const lookup = (tMs) => {
    let best = null;
    for (const p of phaseAt) { if (p.tMs <= tMs) best = p.carried; else break; }
    return best;
  };

  const episodes = (x.distractions?.episodes ?? []).map((e) => ({
    atMin: Math.round((e.startedAt - sessionStart) / 60000),
    trigger: e.trigger,
    induced: !!e.induced,
    recorded: e.phase,
    corrected: lookup(e.startedAt - sessionStart) ?? e.phase,
  }));

  return { episodes, distractedMs, phasesMs };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => a !== "--write");
if (!files.length) {
  console.log("usage: node analysis/fix-onset-phase.mjs [--write] <export.json> ...");
  process.exit(1);
}

for (const file of files) {
  const x = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = corrected(x, ACTIVE_RECENCY_SEC);
  if (!c) { console.log(`\n${file}: no trace — cannot correct`); continue; }

  console.log(`\n${x.participantId} · ${x.condition}`);
  console.log("  episode        recorded      corrected");
  let changed = 0;
  for (const e of c.episodes) {
    const mark = e.recorded === e.corrected ? " " : "*";
    if (mark === "*") changed++;
    console.log(`  ${mark} @${String(e.atMin).padStart(2)}min ${(e.induced ? "induced" : "natural").padEnd(8)} ` +
                `${String(e.recorded).padEnd(12)}  ${e.corrected}`);
  }
  console.log(`  ${changed} of ${c.episodes.length} episodes corrected`);

  const asRecorded = x.distractedMs ?? {};
  const recPhases = x.phasesMs ?? {};
  console.log("  time per phase (sec):");
  for (const k of ["Planning", "Translating", "Reviewing"]) {
    console.log(`    ${k.padEnd(12)} as recorded ${String(Math.round((recPhases[k] ?? 0) / 1000)).padStart(5)}` +
                `    corrected ${String(Math.round(c.phasesMs[k] / 1000)).padStart(5)}`);
  }
  // The trace is sampled every ~2s while the live totals are banked
  // continuously, so the two totals will not match exactly. Say so rather than
  // letting a reader assume a discrepancy is part of the correction.
  const recTotal = Math.round(Object.values(recPhases).reduce((a, b) => a + b, 0) / 1000);
  const corTotal = Math.round(Object.values(c.phasesMs).reduce((a, b) => a + b, 0) / 1000);
  console.log(`    total        as recorded ${String(recTotal).padStart(5)}    corrected ${String(corTotal).padStart(5)}` +
              `   (trace is sampled; totals differ by ${Math.abs(corTotal - recTotal)}s)`);

  console.log("  distracted time by phase (sec):");
  for (const k of ["Planning", "Translating", "Reviewing"]) {
    console.log(`    ${k.padEnd(12)} as recorded ${String(Math.round((asRecorded[k] ?? 0) / 1000)).padStart(5)}` +
                `    corrected ${String(Math.round(c.distractedMs[k] / 1000)).padStart(5)}`);
  }

  // The window is only valid while it sits BELOW this participant's smallest
  // calibrated idle threshold. Above it, ticks that are already part of the
  // stall count as "still working", the carried phase becomes the Planning the
  // stall itself produced, and the correction undoes itself. That is exactly
  // what the 30s column below shows - it is not noise, it is the window
  // reaching into the silence.
  const idle = x.calibration?.thresholds?.idleSec ?? {};
  const smallestIdle = Math.min(...Object.values(idle).filter(Number.isFinite));
  if (Number.isFinite(smallestIdle) && ACTIVE_RECENCY_SEC >= smallestIdle) {
    console.log(`  WARNING: the ${ACTIVE_RECENCY_SEC}s window is not below this participant's` +
                ` smallest calibrated idle threshold (${smallestIdle}s). The correction` +
                ` cannot be trusted for this session.`);
  } else if (Number.isFinite(smallestIdle)) {
    console.log(`  window ${ACTIVE_RECENCY_SEC}s is below the smallest calibrated idle threshold (${smallestIdle}s) — valid`);
  }

  // How much does the window matter? Reported so the choice is visible rather
  // than assumed - see the note above on why the 30s column diverges.
  const alt = [20, 30].map((sec) => {
    const a = corrected(x, sec);
    const same = a.episodes.filter((e, i) => e.corrected === c.episodes[i].corrected).length;
    return `${sec}s: ${same}/${c.episodes.length} identical`;
  });
  console.log(`  sensitivity to the 10s window — ${alt.join(", ")}`);

  if (write) {
    // A COMPLETE export, not a fragment: same shape as the original, so it can
    // be dropped into any analysis in place of it without joining two files.
    // Every corrected field keeps its original alongside under a *Recorded key,
    // so a reviewer can see exactly what changed and recompute it themselves -
    // the decision trace travels with it for that reason.
    const out = file.replace(/\.json$/i, "_corrected.json");
    const fixed = structuredClone(x);

    fixed.correction = {
      what: "The phase each distraction interrupted, time per phase, and distracted time by phase.",
      totalsNote: "Corrected totals are summed from the ~2s decision trace while the recorded "
        + "totals were banked continuously, so the two will differ slightly. Use the corrected "
        + "SPLIT between phases; the recorded total remains the authority on session length.",
      why: "Detection requires a stall, and a stall is also what makes the classifier "
         + "report Planning, so the live phase had already decayed by the time an episode "
         + "opened. Recomputed from the decision trace as the phase at the last tick where "
         + "the participant had interacted within activeRecencySec.",
      activeRecencySec: ACTIVE_RECENCY_SEC,
      smallestCalibratedIdleSec: Number.isFinite(smallestIdle) ? smallestIdle : null,
      episodesCorrected: changed,
      episodesTotal: c.episodes.length,
      source: path.basename(file),
      generatedAt: new Date().toISOString(),
      tool: "analysis/fix-onset-phase.mjs",
    };

    fixed.distractedMsRecorded = x.distractedMs ?? null;
    fixed.distractedMs = c.distractedMs;
    fixed.phasesMsRecorded = x.phasesMs ?? null;
    fixed.phasesMs = c.phasesMs;

    fixed.distractions = {
      ...x.distractions,
      episodes: (x.distractions?.episodes ?? []).map((e, i) => ({
        ...e,
        phase: c.episodes[i]?.corrected ?? e.phase,
        phaseRecorded: e.phase,
      })),
    };

    fs.writeFileSync(out, JSON.stringify(fixed, null, 2));
    console.log(`  wrote ${path.basename(out)} — full export, corrected`);
  }
}
console.log("");
