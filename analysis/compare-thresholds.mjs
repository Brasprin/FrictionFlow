// Re-classifies one session under two threshold sets and scores both against
// human-coded ground truth.
//
//   node analysis/compare-thresholds.mjs <session.json> <session_trace.csv> <coding.csv>
//
// The point: a session is recorded ONCE, then interpreted twice — with the
// participant's calibrated thresholds, and with the fixed pre-calibration ones.
// Both are scored against the same screen-recording coding, so the difference
// between the two scores is attributable to the thresholds alone. Nothing is
// re-measured and no participant time is involved; the trace holds the
// classifier's raw inputs, so any threshold set can be applied to it after the
// fact.
//
// Every rule below mirrors classifyPhase/assessAttention in public/content.js.
// If those change, this must change with them — REPLAY FIDELITY (reported at
// the end) is the guard: it re-runs the calibrated thresholds and checks the
// result against the decisions the extension actually recorded. Anything below
// ~95% means this script and the extension have drifted apart, and the
// comparison should not be trusted until they agree.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

// ── The pre-calibration constants, from public/content.js DEFAULT_THRESHOLDS ──
export const FIXED = {
  wpmGate: 10,
  burstMinSec: 10,
  deleteGate: 5,
  scrollGate: 5,
  idleSec: { Planning: 40, Translating: 40, Reviewing: 40 },
  // No baselines existed before calibration, so the Rate family cannot fire.
  activityRate: { Planning: null, Translating: null, Reviewing: null },
};

// ── The pre-declared calibration rule (agreed 17 Sep 2026) ────────────────────
// Decided after coding P02 and BEFORE any other session was coded, so that P01,
// P03 and every later session test it rather than fit it. Two limits:
//
//  1. Scroll limit. If calibration never observed scrolling, the calibrated
//     scrollGate was not measured at all - it falls to 1/min, and a single
//     scroll while not typing reads as Reviewing. All three first participants
//     calibrated to zero scrolling in every segment. Use the default instead.
//     This reason is independent of any coding.
//  2. Burst length. Never require more sustained typing than the default
//     before calling it Translating. This one WAS suggested by P02's coding,
//     which is why P02 must not be counted as evidence for it.
export function applyDeclaredRule(calibrated, profile) {
  const segs = Object.values(profile?.segments ?? {});
  const sawScrolling = segs.some((sg) => Number(sg?.scrollRate) > 0);
  return {
    ...calibrated,
    scrollGate: sawScrolling ? calibrated.scrollGate : FIXED.scrollGate,
    burstMinSec: Math.min(calibrated.burstMinSec, FIXED.burstMinSec),
  };
}
// ── Second declared variant: scrolling does not decide Reviewing (21 Sep 2026) ─
// Declared after P02 was scored and before P01, P03 or any later session was
// coded. (A P03_coding.csv existed at the time, but held only an empty template.)
//
// The session document holds its source passages above the writing area, so
// participants scroll up to reread them, and one scroll while not typing reads
// as Reviewing. The coding scheme calls reading a source Planning. Here
// Reviewing requires deleting; scrolling still counts as activity (it is in
// activityPerMin and inactiveSec, which this does not touch), so reading a
// source can never look like absence.
//
// Built on the declared rule (burst capped at 10s), so the only difference
// between the two rows is the scroll condition.
//
// Pre-declared decision: adopt it if its phase kappa beats cal+rule on the
// sessions it is tested on, without lowering attention kappa.
export function applyNoScrollVariant(calibrated, profile) {
  return { ...applyDeclaredRule(calibrated, profile), scrollGate: Infinity };
}


const TAB_AWAY_MS = 60000;
const RAPID_SWITCH = 3;
const SEVERE_MULT = 3;
const RATE_FRACTION = 0.25;
const FAMILIES_REQUIRED = 2;
const PHASES = ["Planning", "Translating", "Reviewing"];

// ── Breaks ──────────────────────────────────────────────────────────────────
// A sanctioned break suspends tracking entirely: no trace rows are written
// until the participant resumes. Anything that fills time from the last row
// forward - the scoring grid, the phase totals - would otherwise carry the
// pre-break state across the whole break. A break is neither a phase nor a
// distraction, so its span is excluded.
//
// Start: the voluntary_break event, or a 'take_a_break' response to a prompt.
// End: the first trace row after it, which is when tracking resumed.
export function breakWindows(session, rowTimesMs) {
  const t0 = Date.parse(session?.session?.startedAt ?? "");
  if (!Number.isFinite(t0)) return [];
  const starts = (session?.interventionEvents ?? [])
    .filter((e) => e.type === "voluntary_break" || (e.type === "response" && e.response === "take_a_break"))
    .map((e) => Number(e.at) - t0)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const last = rowTimesMs.length ? rowTimesMs[rowTimesMs.length - 1] : 0;
  return starts.map((start) => ({ start, end: rowTimesMs.find((t) => t > start) ?? last }));
}

// ── CSV / time parsing ──────────────────────────────────────────────────────
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Accepts "4:32", "1:04:32" or a plain number of seconds.
// Accepts "m:ss", "h:mm:ss" or plain seconds — and refuses, loudly, the two
// shapes Excel produces when it decides a coder's "3:20" is a clock time.
// Saving that back to CSV gives either "3:20:00 AM" (NaN, which at least
// fails) or a fraction of a day: 0.1388..., which is a perfectly valid number
// and would silently record a 200-second stretch as lasting 0.14 seconds.
export function toSeconds(value) {
  const raw = String(value).trim();
  const s = raw.replace(/\s*(AM|PM)$/i, "");

  if (!s.includes(":")) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`cannot read "${raw}" as a time`);
    // Plain seconds are whole numbers. A fraction below 1 is Excel's day value.
    if (n > 0 && n < 1) {
      throw new Error(
        `"${raw}" looks like Excel converted a time to a fraction of a day ` +
        `(${Math.round(n * 86400)}s?). Format the column as Text, or type plain seconds.`,
      );
    }
    return n;
  }

  const parts = s.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) throw new Error(`cannot read "${raw}" as a time`);
  // Excel writes a clock time with an AM/PM suffix; with it stripped, "3:20:00"
  // is indistinguishable from a real h:mm:ss, so that one is left alone.
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

// ── The classifier, replayed from recorded measurements ─────────────────────
export function classifyPhase(r, t) {
  if ((r.scrollPerMin >= t.scrollGate || r.deletePerMin >= t.deleteGate) && r.wpm < t.wpmGate) {
    return "Reviewing";
  }
  if (r.wpm >= t.wpmGate && r.burstSec >= t.burstMinSec) return "Translating";
  return "Planning";
}

export function assessAttention(r, phase, t, state) {
  const idleSec = t.idleSec[phase];

  // Categorical: hidden longer than the tolerance. Reconstructed from the run
  // of hidden rows rather than a live timer, so it can land a tick or two later
  // than the extension did — one source of replay-fidelity loss.
  if (r.hidden && state.hiddenSinceMs !== null && r.tMs - state.hiddenSinceMs > TAB_AWAY_MS) {
    return { distracted: true, families: ["tab-away"] };
  }
  if (r.inactiveSec > idleSec * SEVERE_MULT) {
    return { distracted: true, families: ["severe-stall"] };
  }

  const families = [];
  if (r.inactiveSec > idleSec) families.push("time");
  const base = t.activityRate[phase];
  if (base !== null && base !== undefined && r.activityPerMin < base * RATE_FRACTION) {
    families.push("rate");
  }
  if (r.tabSwitchesPerMin >= RAPID_SWITCH) families.push("environment");

  // Hysteresis: enter at >= 2 families, leave only at 0.
  const distracted = state.attention === "Distracted"
    ? families.length > 0
    : families.length >= FAMILIES_REQUIRED;
  return { distracted, families };
}

export function replay(rows, thresholds) {
  const state = { attention: "Focused", phase: null, hiddenSinceMs: null };
  return rows.map((r) => {
    if (r.hidden && state.hiddenSinceMs === null) state.hiddenSinceMs = r.tMs;
    if (!r.hidden) state.hiddenSinceMs = null;

    // The phase is frozen while distracted — the phase at onset is what the
    // episode is about, so it must not drift during the episode.
    const phase = state.attention === "Distracted" && state.phase
      ? state.phase
      : classifyPhase(r, thresholds);
    const a = assessAttention(r, phase, thresholds, state);
    state.phase = phase;
    state.attention = a.distracted ? "Distracted" : "Focused";
    return { tMs: r.tMs, phase, attention: state.attention };
  });
}

// ── Agreement statistics ────────────────────────────────────────────────────
// Cohen's kappa: agreement corrected for what chance alone would produce. Raw
// percentage agreement flatters any classifier whose classes are unbalanced,
// which these are — most of a session is one phase.
export function kappa(pairs, classes) {
  const n = pairs.length;
  if (n === 0) return { agreement: 0, kappa: 0, matrix: {} };
  const matrix = {};
  for (const a of classes) { matrix[a] = {}; for (const b of classes) matrix[a][b] = 0; }
  let agree = 0;
  for (const [truth, pred] of pairs) {
    if (matrix[truth] && matrix[truth][pred] !== undefined) matrix[truth][pred]++;
    if (truth === pred) agree++;
  }
  const po = agree / n;
  let pe = 0;
  for (const c of classes) {
    const rowSum = classes.reduce((s, b) => s + matrix[c][b], 0);
    const colSum = classes.reduce((s, a) => s + matrix[a][c], 0);
    pe += (rowSum / n) * (colSum / n);
  }
  return { agreement: po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), matrix, n };
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }
function k3(x) { return x.toFixed(3); }

// ── CLI ─────────────────────────────────────────────────────────────────────
// Everything above is importable; the run below happens only when this file is
// invoked directly, so test/replay.test.mjs can reuse the replay logic and
// assert it still matches content.js.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!invokedDirectly) { /* imported for its exports */ } else { main(); }

function main() {
// --offset: where Start Task falls in the recording. Coding times are measured
// from session start, because that is where the trace starts counting, but a
// screen recording nearly always begins earlier. Rather than trim the video,
// the coder can use the player's own clock and this subtracts the difference.
// Without it, every coded row is shifted by the lead-in and nothing errors.
const argv = process.argv.slice(2);
let offsetSec = 0;
const oi = argv.indexOf("--offset");
if (oi !== -1) {
  offsetSec = toSeconds(argv[oi + 1]);
  argv.splice(oi, 2);
}
const [jsonPath, tracePath, codingPath] = argv;
if (!jsonPath || !tracePath || !codingPath) {
  console.error("usage: node analysis/compare-thresholds.mjs <session.json> <session_trace.csv> <coding.csv> [--offset m:ss]");
  console.error("  --offset  video time at which Start Task was pressed, if the recording was not trimmed");
  process.exit(2);
}

const session = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const calibrated = session.calibration?.thresholds;
if (!calibrated) {
  console.error("No thresholds in the session export — cannot replay.");
  process.exit(2);
}

const traceCsv = parseCsv(fs.readFileSync(tracePath, "utf8"));
const traceHeader = traceCsv[0].map((h) => h.trim());
const idx = (name) => traceHeader.indexOf(name);
const rows = traceCsv.slice(1).map((r) => ({
  tMs: Number(r[idx("tMs")]),
  livePhase: r[idx("phase")],
  liveAttention: r[idx("attention")],
  wpm: Number(r[idx("wpm")]),
  inactiveSec: Number(r[idx("inactiveSec")]),
  scrollPerMin: Number(r[idx("scrollPerMin")]),
  deletePerMin: Number(r[idx("deletePerMin")]),
  activityPerMin: Number(r[idx("activityPerMin")]),
  burstSec: Number(r[idx("burstSec")]),
  tabSwitchesPerMin: Number(r[idx("tabSwitchesPerMin")]),
  hidden: Number(r[idx("hidden")]) === 1,
}));

// Coding file: start,end,phase,attention — one row per coded stretch. The coder
// writes a new row whenever EITHER channel changes; attention defaults to
// Focused when the column is omitted.
const codingCsv = parseCsv(fs.readFileSync(codingPath, "utf8"));
const codingHeader = codingCsv[0].map((h) => h.trim().toLowerCase());
const cIdx = (n) => codingHeader.indexOf(n);
const coded = codingCsv.slice(1).map((r) => ({
  startMs: (toSeconds(r[cIdx("start")]) - offsetSec) * 1000,
  endMs: (toSeconds(r[cIdx("end")]) - offsetSec) * 1000,
  phase: (r[cIdx("phase")] ?? "").trim(),
  attention: cIdx("attention") >= 0 ? (r[cIdx("attention")] ?? "Focused").trim() : "Focused",
}));

// Sanity-check the coding against the session it claims to describe. Silent
// nonsense is the risk here: Excel turns "3:20" into "3:20:00 AM", which reads
// back as 3h20m and quietly scores nothing, and a coder can transpose a digit.
{
  const sessionMs = rows.length ? rows[rows.length - 1].tMs : 0;
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
  const problems = [];
  coded.forEach((c, i) => {
    const line = i + 2; // +1 for the header, +1 for 1-based lines
    if (!(c.endMs > c.startMs)) problems.push(`line ${line}: end is not after start`);
    if (c.startMs > sessionMs) {
      problems.push(`line ${line}: starts at ${mmss(c.startMs)}, after the session ended (${mmss(sessionMs)})`);
    }
    if (!PHASES.includes(c.phase)) problems.push(`line ${line}: phase "${c.phase}" is not one of ${PHASES.join(" / ")}`);
    if (!["Focused", "Distracted"].includes(c.attention)) {
      problems.push(`line ${line}: attention "${c.attention}" is not Focused / Distracted`);
    }
  });
  if (problems.length) {
    console.error(`
Problems in ${codingPath}:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`
The session is ${mmss(sessionMs)} long. If your times look like clock`);
    console.error(`times, Excel reformatted them — format the column as Text, or use plain seconds.
`);
    process.exit(1);
  }
}

function truthAt(tMs) {
  return coded.find((c) => tMs >= c.startMs && tMs < c.endMs) ?? null;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const calibratedRun = replay(rows, calibrated);
const fixedRun = replay(rows, FIXED);

// Replay fidelity: does this script reproduce what the extension actually
// decided, given the same thresholds? If not, everything below is suspect.
const fidelityPhase = rows.filter((r, i) => r.livePhase === calibratedRun[i].phase).length / rows.length;
const fidelityAttn = rows.filter((r, i) => r.liveAttention === calibratedRun[i].attention).length / rows.length;

// The phase a distraction interrupted, carried forward through the episode.
//
// replay() reproduces the extension exactly, including the freeze that holds
// whatever the phase had decayed to by the time detection fired - which is
// Planning, because detection needs a stall and a stall is what produces
// Planning. Scored against a coder, who sees the writer stop mid-sentence and
// writes "Translating, Distracted", that costs the phase channel agreement it
// should not lose.
//
// So the phase channel is scored twice: as the extension recorded it, and with
// the same carry-forward that public/content.js now applies to episodes and
// that analysis/fix-onset-phase.mjs applies to exports. One rule everywhere.
//
// Fidelity above is deliberately measured against the UNCORRECTED replay - it
// asks whether this script reproduces the extension, and that answer must not
// be quietly improved by a correction applied afterwards.
const ACTIVE_RECENCY_SEC = 10;

function carryForward(run, rows) {
  let lastActive = null;
  return run.map((d, i) => {
    if (rows[i].inactiveSec <= ACTIVE_RECENCY_SEC) lastActive = d.phase;
    return d.attention === "Distracted" && lastActive ? { ...d, phase: lastActive } : d;
  });
}

const calibratedFixed = carryForward(calibratedRun, rows);
const fixedFixed = carryForward(fixedRun, rows);
const ruleThresholds = applyDeclaredRule(calibrated, session.calibration?.profile);
const ruleRun = replay(rows, ruleThresholds);
const ruleFixed = carryForward(ruleRun, rows);
const noScrollThresholds = applyNoScrollVariant(calibrated, session.calibration?.profile);
const noScrollRun = replay(rows, noScrollThresholds);
const noScrollFixed = carryForward(noScrollRun, rows);

// The window is valid only below the smallest calibrated idle threshold: above
// it, ticks that are part of the stall count as activity and the carried phase
// becomes the Planning the stall itself produced.
const idleVals = Object.values(calibrated.idleSec ?? {}).filter(Number.isFinite);
const smallestIdleSec = idleVals.length ? Math.min(...idleVals) : null;

// Scored on a regular one-second grid, not per trace row.
//
// Trace rows are NOT evenly spaced. The classifier ticks every 2s while the
// document is visible, but Chrome throttles timers in a hidden tab down to
// about once a minute - so a three-minute distraction produces ~27 rows in its
// first minute (while the 60s tab-away rule is still waiting, and system and
// coder legitimately disagree) and only ~2 rows for the two minutes after,
// where they agree. Counting rows made the correctly detected part of every
// distraction nearly weightless and the detection lag dominate the score.
//
// Each grid second takes the system state from the latest row at or before
// it, which is how the extension itself behaves: a state holds until the next
// tick changes it. The coder's labels are already continuous in time.
// Only seconds the coder actually covered are scored.
const GRID_MS = 1000;
const breaks = breakWindows(session, rows.map((r) => r.tMs));
const inBreak = (t) => breaks.some((b) => t >= b.start && t < b.end);
const scored = [];
{
  const endMs = rows.length ? rows[rows.length - 1].tMs : 0;
  let i = -1;
  for (let t = 0; t <= endMs; t += GRID_MS) {
    while (i + 1 < rows.length && rows[i + 1].tMs <= t) i++;
    if (i < 0) continue;
    if (inBreak(t)) continue;
    const truth = truthAt(t);
    if (!truth) continue;
    scored.push({ truth, cal: calibratedRun[i], fix: fixedRun[i], calC: calibratedFixed[i], fixC: fixedFixed[i], rule: ruleRun[i], ruleC: ruleFixed[i], ns: noScrollRun[i], nsC: noScrollFixed[i] });
  }
}

const out = (label, pairs, classes) => {
  const k = kappa(pairs, classes);
  return { label, ...k };
};

const phaseCal = out("calibrated", scored.map((s) => [s.truth.phase, s.cal.phase]), PHASES);
const phaseFix = out("fixed", scored.map((s) => [s.truth.phase, s.fix.phase]), PHASES);
const phaseCalC = out("calibrated*", scored.map((s) => [s.truth.phase, s.calC.phase]), PHASES);
const phaseFixC = out("fixed*", scored.map((s) => [s.truth.phase, s.fixC.phase]), PHASES);
const attnCal = out("calibrated", scored.map((s) => [s.truth.attention, s.cal.attention]), ["Focused", "Distracted"]);
const attnFix = out("fixed", scored.map((s) => [s.truth.attention, s.fix.attention]), ["Focused", "Distracted"]);
const phaseRule = out("cal+rule", scored.map((s) => [s.truth.phase, s.rule.phase]), PHASES);
const phaseRuleC = out("cal+rule*", scored.map((s) => [s.truth.phase, s.ruleC.phase]), PHASES);
const attnRule = out("cal+rule", scored.map((s) => [s.truth.attention, s.rule.attention]), ["Focused", "Distracted"]);
const phaseNs = out("no-scroll", scored.map((s) => [s.truth.phase, s.ns.phase]), PHASES);
const phaseNsC = out("no-scroll*", scored.map((s) => [s.truth.phase, s.nsC.phase]), PHASES);
const attnNs = out("no-scroll", scored.map((s) => [s.truth.attention, s.ns.attention]), ["Focused", "Distracted"]);

// ── Distraction labels: what a recovery prompt would name ────────────────────
// Objective 2 promises phase-sensitive suggestions, so the phase each
// distraction is labelled with is its own question, separate from per-second
// phase agreement. Label: the phase at the last tick the participant was
// active (the rule content.js applies live from P04, and fix-onset-phase
// applies to earlier exports), read from the RECORDED trace so it is what the
// deployed system would have said. Reference: the coder's phase at the last
// second before onset that the coder marked Focused - what they were doing
// before they drifted, which is the thing the prompt is meant to recall.
const episodeChecks = [];
{
  const t0 = Date.parse(session.session?.startedAt ?? "");
  const labelAt = (tMs) => {
    let last = null, at = null;
    for (const r of rows) {
      if (r.tMs > tMs) break;
      if (r.inactiveSec <= ACTIVE_RECENCY_SEC) last = r.livePhase;
      at = r.livePhase;
    }
    return last ?? at;
  };
  for (const e of session.distractions?.episodes ?? []) {
    const onset = Number(e.startedAt) - t0;
    if (!Number.isFinite(onset) || inBreak(onset)) continue;
    let coder = null;
    for (let t = Math.floor(onset / 1000) * 1000 - 1000; t >= 0; t -= 1000) {
      const k = truthAt(t);
      if (k && k.attention === "Focused") { coder = k.phase; break; }
    }
    if (!coder) continue;
    episodeChecks.push({ onset, induced: !!e.induced, label: labelAt(onset), coder });
  }
}
const labelsMatched = episodeChecks.filter((c) => c.label === c.coder).length;

const pid = session.participantId || "?";
const cond = session.condition || "?";

console.log(`\nFrictionFlow — threshold comparison`);
console.log(`Participant ${pid} · ${cond} · ${rows.length} ticks, ${scored.length} coded seconds`);
console.log(offsetSec ? `Coding times shifted back by ${offsetSec}s (--offset): video ${offsetSec}s = session 0:00\n` : `No --offset: coding times are taken as measured from Start Task\n`);
for (const b of breaks) console.log(`Break excluded from scoring: ${Math.floor(b.start/60000)}:${String(Math.round(b.start/1000)%60).padStart(2,"0")} to ${Math.floor(b.end/60000)}:${String(Math.round(b.end/1000)%60).padStart(2,"0")}`);

console.log(`Replay fidelity (this script vs what the extension recorded)`);
console.log(`  phase ${pct(fidelityPhase)} · attention ${pct(fidelityAttn)}`);
if (fidelityPhase < 0.95 || fidelityAttn < 0.95) {
  console.log(`  WARNING: below 95% — this script and content.js have drifted apart.`);
  console.log(`  Fix that before reporting anything below.`);
}

console.log(`Declared rule for this participant: scroll limit ${calibrated.scrollGate} -> ${ruleThresholds.scrollGate}/min, burst ${calibrated.burstMinSec} -> ${ruleThresholds.burstMinSec}s`);
if (pid === "P02") console.log(`  NOTE: the rule was formed after coding P02 - do not count P02 as evidence for it.`);
if (pid === "P02") console.log(`  NOTE: no-scroll was declared after P02 was scored - do not count P02 as evidence for it either.`);
console.log(`\nPHASE (Planning / Translating / Reviewing)`);
console.log(`  * = the interrupted phase carried through each episode, as content.js now`);
console.log(`      records it. Rows without * are as these sessions were recorded.`);
if (smallestIdleSec !== null && ACTIVE_RECENCY_SEC >= smallestIdleSec) {
  console.log(`  WARNING: the ${ACTIVE_RECENCY_SEC}s window is not below this participant's smallest`);
  console.log(`  calibrated idle threshold (${smallestIdleSec}s) - ignore the starred rows.`);
}
for (const r of [phaseCal, phaseCalC, phaseRule, phaseRuleC, phaseNs, phaseNsC, phaseFix, phaseFixC]) {
  console.log(`  ${r.label.padEnd(11)} agreement ${pct(r.agreement).padStart(6)}   kappa ${k3(r.kappa)}`);
}
console.log(`\nATTENTION (Focused / Distracted)`);
for (const r of [attnCal, attnRule, attnNs, attnFix]) {
  console.log(`  ${r.label.padEnd(11)} agreement ${pct(r.agreement).padStart(6)}   kappa ${k3(r.kappa)}`);
}

console.log(`\nDISTRACTION LABELS (the phase a recovery prompt would name)`);
for (const c of episodeChecks) {
  const mm = `${Math.floor(c.onset / 60000)}:${String(Math.round(c.onset / 1000) % 60).padStart(2, "0")}`;
  console.log(`  ${mm.padStart(5)} ${(c.induced ? "game" : "natural").padEnd(8)} system ${c.label.padEnd(12)} coder before ${c.coder.padEnd(12)} ${c.label === c.coder ? "match" : "-"}`);
}
console.log(`  ${labelsMatched} of ${episodeChecks.length} matched`);
console.log(`\nConfusion matrix — calibrated, phase (rows = coder, cols = system)`);
console.log(`  ${"".padEnd(13)}${PHASES.map((p) => p.slice(0, 5).padStart(8)).join("")}`);
for (const t of PHASES) {
  console.log(`  ${t.padEnd(13)}${PHASES.map((p) => String(phaseCal.matrix[t][p]).padStart(8)).join("")}`);
}

// One line per session, for pasting into the spreadsheet that feeds the paired
// test across participants.
console.log(`\nSummary row (participantId,condition,phaseKappaCal,phaseKappaCalCorrected,phaseKappaFix,phaseKappaFixCorrected,attnKappaCal,attnKappaFix,phaseKappaRule,phaseKappaRuleCorrected,attnKappaRule,phaseKappaNoScroll,phaseKappaNoScrollCorrected,attnKappaNoScroll,labelsMatched,labelsChecked,codedSec)`);
console.log(`${pid},${cond},${k3(phaseCal.kappa)},${k3(phaseCalC.kappa)},${k3(phaseFix.kappa)},${k3(phaseFixC.kappa)},${k3(attnCal.kappa)},${k3(attnFix.kappa)},${k3(phaseRule.kappa)},${k3(phaseRuleC.kappa)},${k3(attnRule.kappa)},${k3(phaseNs.kappa)},${k3(phaseNsC.kappa)},${k3(attnNs.kappa)},${labelsMatched},${episodeChecks.length},${scored.length}\n`);
}
