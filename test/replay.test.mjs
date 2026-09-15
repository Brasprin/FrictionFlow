// Guards the one silent failure that would invalidate the study's analysis:
// analysis/compare-thresholds.mjs reimplements the classifier so a session can
// be re-scored under different thresholds, and nothing forces that copy to stay
// in step with public/content.js. If they drift, the comparison still runs and
// still prints plausible numbers — it is simply measuring the wrong classifier.
//
// So: drive a realistic session through the REAL content script, then replay
// its own trace through the analysis code using the SAME thresholds. The two
// must agree on every row. Any disagreement is drift.

import vm from "node:vm";
import fs from "node:fs";
import { replay, FIXED } from "../analysis/compare-thresholds.mjs";

const SRC = fs.readFileSync(new URL("../public/content.js", import.meta.url), "utf8");

let clock = 1_700_000_000_000;
const advance = (ms) => { clock += ms; };

const handlers = {};
const editor = { scrollTop: 0, addEventListener: (t, fn) => { handlers[t] = fn; } };
const iframe = { contentDocument: { addEventListener: (t, fn) => { if (t === "keydown") handlers.key = fn; } } };
const stored = {};
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  Math, JSON, Object, Array, String, Number, Boolean, Error, Promise, structuredClone,
  Date: new Proxy(Date, { get: (t, p) => (p === "now" ? () => clock : Reflect.get(t, p)) }),
  setTimeout: (fn) => { fn(); return 0; },
  setInterval: () => 0,
  clearInterval() {}, clearTimeout() {},
  document: {
    hidden: false,
    addEventListener: (t, fn) => { if (t === "visibilitychange") handlers.visibility = fn; },
    querySelector: (s) => (s.includes("iframe") ? iframe : editor),
  },
  chrome: {
    runtime: { id: "x", lastError: null, onMessage: { addListener() {} }, sendMessage: (m, cb) => cb && cb() },
    storage: { local: {
      get: (keys, cb) => { const o = {}; for (const k of [].concat(keys)) if (k in stored) o[k] = stored[k]; cb(o); },
      set: (obj, cb) => { Object.assign(stored, obj); if (cb) cb(); },
    } },
  },
};
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

const type = (n, gap) => { for (let i = 0; i < n; i++) { advance(gap); handlers.key({ key: "a", shiftKey: false }); } };
const del = (n) => { for (let i = 0; i < n; i++) { advance(250); handlers.key({ key: "Backspace", shiftKey: false }); } };
const scroll = (n) => { for (let i = 0; i < n; i++) { advance(400); editor.scrollTop += 120; handlers.scroll(); } };
const pump = (ms) => { let l = ms; while (l > 0) { const s = Math.min(2000, l); advance(s); ctx.updateState(); l -= s; } };

const THRESHOLDS = {
  wpmGate: 19, burstMinSec: 11, deleteGate: 4, scrollGate: 4,
  idleSec: { Planning: 37, Translating: 15, Reviewing: 16 },
  activityRate: { Planning: 19, Translating: 269, Reviewing: 89 },
};
stored.ff_task = { participantId: "P01" };
stored.ff_calibrations = { P01: { participantId: "P01", valid: true, capturedAt: clock, thresholds: THRESHOLDS } };

ctx.startTracking();

// A session that exercises every rule: thinking pauses, fluent drafting, a
// tab-away long enough to trip the categorical trigger, a return to drafting,
// a stall, and a revision stretch.
for (const p of [20, 25, 18, 30, 22, 26]) { type(6, 400); ctx.updateState(); pump(p * 1000); }
for (let i = 0; i < 6; i++) { type(150, 180); ctx.updateState(); pump(3000); }
ctx.document.hidden = true; handlers.visibility();
pump(90_000);
ctx.document.hidden = false; handlers.visibility();
for (let i = 0; i < 4; i++) { type(150, 180); ctx.updateState(); pump(3000); }
pump(32_000);
for (let i = 0; i < 5; i++) { del(5); scroll(6); ctx.updateState(); pump(6000); }
ctx.flushTraceToStorage();

const trace = stored.ff_trace;
const col = (n) => trace.columns.indexOf(n);
const rows = trace.rows.map((r) => ({
  tMs: r[col("tMs")],
  livePhase: r[col("phase")],
  liveAttention: r[col("attention")],
  wpm: r[col("wpm")],
  inactiveSec: r[col("inactiveSec")],
  scrollPerMin: r[col("scrollPerMin")],
  deletePerMin: r[col("deletePerMin")],
  activityPerMin: r[col("activityPerMin")],
  burstSec: r[col("burstSec")],
  tabSwitchesPerMin: r[col("tabSwitchesPerMin")],
  hidden: r[col("hidden")] === 1,
}));

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(expected === actual)} ${JSON.stringify(actual)}`); }
};

console.log("\nReplay fidelity — analysis script vs live classifier");
check("the session produced a usable trace", rows.length > 100, true);

const replayed = replay(rows, THRESHOLDS);
const phaseMismatches = rows.filter((r, i) => r.livePhase !== replayed[i].phase);
const attnMismatches = rows.filter((r, i) => r.liveAttention !== replayed[i].attention);

if (phaseMismatches.length) {
  console.log(`        first phase mismatch at ${phaseMismatches[0].tMs}ms: live=${phaseMismatches[0].livePhase}`);
}
if (attnMismatches.length) {
  console.log(`        first attention mismatch at ${attnMismatches[0].tMs}ms: live=${attnMismatches[0].liveAttention}`);
}
check("phase replay matches the live classifier on every row", phaseMismatches.length, 0);
check("attention replay matches the live classifier on every row", attnMismatches.length, 0);

// The comparison is only meaningful if the two threshold sets actually disagree
// somewhere. If they never diverge, the study's counterfactual has nothing to
// measure and the test would be passing vacuously.
const underFixed = replay(rows, FIXED);
const diverged = rows.filter((r, i) =>
  underFixed[i].phase !== replayed[i].phase || underFixed[i].attention !== replayed[i].attention
);
check("calibrated and fixed thresholds disagree somewhere", diverged.length > 0, true);
console.log(`        (they differ on ${diverged.length} of ${rows.length} rows — this is what the study measures)`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
