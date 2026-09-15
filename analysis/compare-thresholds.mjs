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

const TAB_AWAY_MS = 60000;
const RAPID_SWITCH = 3;
const SEVERE_MULT = 3;
const RATE_FRACTION = 0.25;
const FAMILIES_REQUIRED = 2;
const PHASES = ["Planning", "Translating", "Reviewing"];

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
export function toSeconds(value) {
  const s = String(value).trim();
  if (!s.includes(":")) return Number(s);
  return s.split(":").map(Number).reduce((acc, part) => acc * 60 + part, 0);
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
const [jsonPath, tracePath, codingPath] = process.argv.slice(2);
if (!jsonPath || !tracePath || !codingPath) {
  console.error("usage: node analysis/compare-thresholds.mjs <session.json> <session_trace.csv> <coding.csv>");
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
  startMs: toSeconds(r[cIdx("start")]) * 1000,
  endMs: toSeconds(r[cIdx("end")]) * 1000,
  phase: (r[cIdx("phase")] ?? "").trim(),
  attention: cIdx("attention") >= 0 ? (r[cIdx("attention")] ?? "Focused").trim() : "Focused",
}));

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

// Only rows the coder actually covered are scored.
const scored = [];
rows.forEach((r, i) => {
  const truth = truthAt(r.tMs);
  if (!truth) return;
  scored.push({ truth, cal: calibratedRun[i], fix: fixedRun[i] });
});

const out = (label, pairs, classes) => {
  const k = kappa(pairs, classes);
  return { label, ...k };
};

const phaseCal = out("calibrated", scored.map((s) => [s.truth.phase, s.cal.phase]), PHASES);
const phaseFix = out("fixed", scored.map((s) => [s.truth.phase, s.fix.phase]), PHASES);
const attnCal = out("calibrated", scored.map((s) => [s.truth.attention, s.cal.attention]), ["Focused", "Distracted"]);
const attnFix = out("fixed", scored.map((s) => [s.truth.attention, s.fix.attention]), ["Focused", "Distracted"]);

const pid = session.participantId || "?";
const cond = session.condition || "?";

console.log(`\nFrictionFlow — threshold comparison`);
console.log(`Participant ${pid} · ${cond} · ${rows.length} ticks, ${scored.length} coded\n`);

console.log(`Replay fidelity (this script vs what the extension recorded)`);
console.log(`  phase ${pct(fidelityPhase)} · attention ${pct(fidelityAttn)}`);
if (fidelityPhase < 0.95 || fidelityAttn < 0.95) {
  console.log(`  WARNING: below 95% — this script and content.js have drifted apart.`);
  console.log(`  Fix that before reporting anything below.`);
}

console.log(`\nPHASE (Planning / Translating / Reviewing)`);
for (const r of [phaseCal, phaseFix]) {
  console.log(`  ${r.label.padEnd(11)} agreement ${pct(r.agreement).padStart(6)}   kappa ${k3(r.kappa)}`);
}
console.log(`\nATTENTION (Focused / Distracted)`);
for (const r of [attnCal, attnFix]) {
  console.log(`  ${r.label.padEnd(11)} agreement ${pct(r.agreement).padStart(6)}   kappa ${k3(r.kappa)}`);
}

console.log(`\nConfusion matrix — calibrated, phase (rows = coder, cols = system)`);
console.log(`  ${"".padEnd(13)}${PHASES.map((p) => p.slice(0, 5).padStart(8)).join("")}`);
for (const t of PHASES) {
  console.log(`  ${t.padEnd(13)}${PHASES.map((p) => String(phaseCal.matrix[t][p]).padStart(8)).join("")}`);
}

// One line per session, for pasting into the spreadsheet that feeds the paired
// test across participants.
console.log(`\nSummary row (participantId,condition,phaseKappaCal,phaseKappaFix,attnKappaCal,attnKappaFix,codedTicks)`);
console.log(`${pid},${cond},${k3(phaseCal.kappa)},${k3(phaseFix.kappa)},${k3(attnCal.kappa)},${k3(attnFix.kappa)},${scored.length}\n`);
}
