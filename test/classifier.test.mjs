// Smoke test for the two-label classifier in public/content.js.
// Loads the content script into a vm context with a fake Docs page and a
// controllable clock, then drives it through scenarios and checks both labels.
//
// Top-level `function` declarations land on the vm global, so classifyPhase,
// assessAttention and updateState are reachable; `let` state is not, which is
// why activity is simulated through the real keydown/scroll listeners.

import vm from "node:vm";
import fs from "node:fs";

const SRC = fs.readFileSync(
  new URL("../public/content.js", import.meta.url),
  "utf8"
);

let clock = 1_700_000_000_000;
const advance = (ms) => { clock += ms; };

function makeContext() {
  const handlers = { key: null, scroll: null, visibility: null, mouseup: null, dblclick: null, mousedown: null };
  const stored = {};

  const editor = {
    scrollTop: 0,
    addEventListener(type, fn) {
      if (type === "scroll") handlers.scroll = fn;
      if (type === "mouseup") handlers.mouseup = fn;
      if (type === "mousedown") handlers.mousedown = fn;
      if (type === "dblclick") handlers.dblclick = fn;
    },
  };
  const iframe = { contentDocument: { addEventListener: (t, fn) => { if (t === "keydown") handlers.key = fn; } } };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Math, JSON, Object, Array, String, Number, Boolean, Error, Promise,
    structuredClone,
    Date: new Proxy(Date, { get: (t, p) => (p === "now" ? () => clock : Reflect.get(t, p)) }),
    setTimeout: (fn) => { fn(); return 0; },      // run retries/first-sync immediately
    setInterval: (fn, ms) => { ctx.__intervals.push({ fn, ms }); return ctx.__intervals.length; },
    // Intervals are recorded but never fire on their own: session ticks are
    // driven by tick(), and the calibration sampler by fireSampler().
    clearInterval() {},
    clearTimeout() {},
    document: {
      hidden: false,
      addEventListener: (t, fn) => { if (t === "visibilitychange") handlers.visibility = fn; },
      querySelector: (sel) => (sel.includes("iframe") ? iframe : editor),
    },
    chrome: {
      runtime: {
        id: "test",
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage: (msg, cb) => { ctx.__messages.push(msg); if (cb) cb(); },
      },
      storage: {
        local: {
          get: (keys, cb) => {
            const out = {};
            for (const k of [].concat(keys)) if (k in stored) out[k] = stored[k];
            cb(out);
          },
          set: (obj) => Object.assign(stored, obj),
        },
      },
    },
    __intervals: [],
    __messages: [],
    __handlers: handlers,
    __stored: stored,
    __editor: editor,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

// ── helpers ────────────────────────────────────────────────────────────────
const typeChars = (ctx, n, gapMs = 100) => {
  for (let i = 0; i < n; i++) {
    advance(gapMs);
    ctx.__handlers.key({ key: "a", shiftKey: false });
  }
};
const scroll = (ctx, n) => {
  for (let i = 0; i < n; i++) {
    advance(200);
    ctx.__editor.scrollTop += 100;
    ctx.__handlers.scroll();
  }
};
const del = (ctx, n) => {
  for (let i = 0; i < n; i++) { advance(200); ctx.__handlers.key({ key: "Backspace", shiftKey: false }); }
};
const tabSwitch = (ctx, awayMs) => {
  ctx.document.hidden = true;
  ctx.__handlers.visibility();
  advance(awayMs);
  ctx.document.hidden = false;
  ctx.__handlers.visibility();
};
const session = (ctx) => ctx.__stored.ff_session ?? {};
const tick = (ctx) => { ctx.updateState(); ctx.flushPhaseToStorage(); };

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`); }
}

function start() {
  const ctx = makeContext();
  ctx.startTracking();
  return ctx;
}

// ── 1. sustained typing → Translating, Focused ─────────────────────────────
console.log("\n1. Sustained typing");
{
  const ctx = start();
  typeChars(ctx, 200, 150);   // ~30s of steady typing, well above 10 WPM
  tick(ctx);
  check("phase is Translating", session(ctx).currentPhase, "Translating");
  check("attention is Focused", session(ctx).currentAttention, "Focused");
}

// ── 2. one signal is never enough ──────────────────────────────────────────
console.log("\n2. Idle alone (mild tier) does not flag");
{
  const ctx = start();
  typeChars(ctx, 100, 150);
  advance(50_000);            // > idle default 40s, < severe 120s
  tick(ctx);
  check("time family fired", session(ctx).attentionFamilies, ["time"]);
  check("still Focused (1 family)", session(ctx).currentAttention, "Focused");
}

// ── 3. severe stall stands alone ───────────────────────────────────────────
console.log("\n3. Severe stall (3x idle) flags on its own");
{
  const ctx = start();
  typeChars(ctx, 100, 150);
  advance(125_000);           // > 3 x 40s
  tick(ctx);
  check("attention is Distracted", session(ctx).currentAttention, "Distracted");
  check("trigger is severe-stall", session(ctx).attentionTrigger, "severe-stall");
  check("episode opened", session(ctx).distractionOnsetCount, 1);
  check("episode records the phase", session(ctx).activeDistraction.phase, "Planning");
}

// ── 4. two families flag before the severe tier ────────────────────────────
console.log("\n4. Idle + rapid switching (2 families)");
{
  const ctx = start();
  typeChars(ctx, 100, 150);
  for (let i = 0; i < 3; i++) tabSwitch(ctx, 1_000);   // 3 quick hops, none over 60s
  advance(50_000);                                     // mild idle tier
  tick(ctx);
  check("two families fired", session(ctx).attentionFamilies.sort(), ["environment", "time"]);
  check("attention is Distracted", session(ctx).currentAttention, "Distracted");
  check("trigger is deviation", session(ctx).attentionTrigger, "deviation");
}

// ── 5. hysteresis: leave only at zero families ─────────────────────────────
console.log("\n5. Hysteresis");
{
  const ctx = start();
  typeChars(ctx, 100, 150);
  for (let i = 0; i < 3; i++) tabSwitch(ctx, 1_000);
  advance(50_000);
  tick(ctx);
  check("entered Distracted", session(ctx).currentAttention, "Distracted");
  typeChars(ctx, 5, 100);     // interaction clears the Time family only
  tick(ctx);
  check("one family left, stays Distracted", session(ctx).currentAttention, "Distracted");
  advance(61_000);            // tab-switch window ages out; but that re-arms Time...
  typeChars(ctx, 5, 100);     // ...so interact again to clear it
  tick(ctx);
  check("zero families, back to Focused", session(ctx).currentAttention, "Focused");
}

// ── 6. tab-away is categorical, and the phase survives it ──────────────────
console.log("\n6. Tab-away preserves the phase");
{
  const ctx = start();
  typeChars(ctx, 200, 150);
  tick(ctx);
  check("drafting before leaving", session(ctx).currentPhase, "Translating");
  tabSwitch(ctx, 90_000);     // > 60s away
  check("attention flipped", session(ctx).currentAttention, "Distracted");
  check("phase NOT overwritten", session(ctx).currentPhase, "Translating");
  check("episode knows what it interrupted", session(ctx).activeDistraction.phase, "Translating");
  check("trigger is tab-away", session(ctx).activeDistraction.trigger, "tab-away");
}

// ── 7. distracted time is a subset of phase time ───────────────────────────
console.log("\n7. Overlapping time accounting");
{
  const ctx = start();
  typeChars(ctx, 200, 150);
  tick(ctx);
  advance(125_000);           // severe stall while (residually) drafting
  tick(ctx);
  advance(20_000);
  tick(ctx);
  const s = session(ctx);
  const phaseTotal = s.phaseDurationsMs.Planning + s.phaseDurationsMs.Translating + s.phaseDurationsMs.Reviewing;
  const distTotal = s.distractedDurationsMs.Planning + s.distractedDurationsMs.Translating + s.distractedDurationsMs.Reviewing;
  check("distracted time is non-zero", distTotal > 0, true);
  check("distracted <= phase total (subset, not peer)", distTotal <= phaseTotal, true);
  check("no Distracted phase bucket exists", "Distracted" in s.phaseDurationsMs, false);
}

// ── 8. reviewing signals ───────────────────────────────────────────────────
console.log("\n8. Deletions drive Reviewing");
{
  const ctx = start();
  typeChars(ctx, 200, 150);
  advance(31_000);            // let the WPM window drain below the gate
  del(ctx, 6);                // >= deleteGate 5 within the 60s window
  tick(ctx);
  check("phase is Reviewing", session(ctx).currentPhase, "Reviewing");
}

// ── 9. episode closes on the first writing keystroke ───────────────────────
console.log("\n9. Episode closes on resumption");
{
  const ctx = start();
  typeChars(ctx, 100, 150);
  advance(125_000);
  tick(ctx);
  check("episode open", session(ctx).activeDistraction !== null, true);
  advance(3_000);
  typeChars(ctx, 1, 100);     // a writing key resumes the task
  tick(ctx);
  const s = session(ctx);
  check("episode closed", s.activeDistraction, null);
  check("one closed episode", s.distractionEpisodes.length, 1);
  check("resumptionMs recorded", s.distractionEpisodes[0].resumptionMs > 0, true);
}

// ── 10. calibration profile is applied, and rejected when it isn't ours ────
console.log("\n10. Calibration profile loading");
{
  const ctx = makeContext();
  ctx.__stored.ff_task = { participantId: "P01" };
  ctx.__stored.ff_calibrations = { P01: {
    valid: true,
    participantId: "P01",
    thresholds: { wpmGate: 19, burstMinSec: 11, deleteGate: 7, scrollGate: 4,
                  idleSec: { Planning: 37, Translating: 15, Reviewing: 16 },
                  activityRate: { Planning: 30, Translating: 90, Reviewing: 60 } },
  } };
  ctx.startTracking();
  tick(ctx);
  check("profile applied", session(ctx).calibrationValid, true);
  check("wpmGate personalised", session(ctx).thresholds.wpmGate, 19);
  check("per-phase idle personalised", session(ctx).thresholds.idleSec.Translating, 15);

  const other = makeContext();
  other.__stored.ff_task = { participantId: "P02" };
  other.__stored.ff_calibrations = { ...ctx.__stored.ff_calibrations };
  other.startTracking();
  tick(other);
  check("another participant's profile refused", session(other).calibrationValid, false);
  check("falls back to default gate", session(other).thresholds.wpmGate, 10);
  check("fallback severe tier reproduces the old 120s rule",
        session(other).thresholds.idleSec.Planning * 3, 120);
}

// ─── Calibration capture and profile math (CALIBRATION_SPEC.md §5-§6, §9) ───
// Segments are driven through the real listeners and the real 2s sampler, so
// these exercise the same capture path a participant would.

const fireSampler = (ctx) => {
  const s = ctx.__intervals[ctx.__intervals.length - 1];
  if (s) s.fn();
};

// Advances the clock in 2s slices, sampling rolling WPM at each one — the
// cadence the classifier itself uses.
function pumpFor(ctx, ms) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(2000, left);
    advance(step);
    fireSampler(ctx);
    left -= step;
  }
}

// A chunk of typing followed by a pause, sampling throughout.
function writeChunk(ctx, chars, gapMs, pauseSec) {
  typeChars(ctx, chars, gapMs);
  fireSampler(ctx);
  if (pauseSec) pumpFor(ctx, pauseSec * 1000);
}

function calibrate(ctx, { planning, translating, reviewing }) {
  ctx.startCalibration();
  ctx.beginCalibrationSegment("Planning");    planning(ctx);
  ctx.beginCalibrationSegment("Translating"); translating(ctx);
  ctx.beginCalibrationSegment("Reviewing");   reviewing(ctx);
  let profile = null;
  ctx.finishCalibration("P01", (res) => { profile = res.profile; });
  return profile;
}

// A participant who follows the instructions: thinks with long irregular
// pauses, drafts fluently, then rereads and revises more slowly.
const goodPlanning = (ctx) => {
  pumpFor(ctx, 30_000);                                   // warm-up, discarded
  for (const p of [12, 18, 25, 15, 30, 20, 22, 40]) writeChunk(ctx, 8, 300, p);
};
const goodTranslating = (ctx) => {
  pumpFor(ctx, 30_000);
  for (const p of [3, 4, 5, 3, 6, 4]) writeChunk(ctx, 180, 200, p);  // ~60 WPM
  del(ctx, 5);
  scroll(ctx, 3);
};
const goodReviewing = (ctx) => {
  pumpFor(ctx, 30_000);
  for (const p of [5, 8, 4, 12, 6, 9]) {
    typeChars(ctx, 40, 600);                              // ~20 WPM
    del(ctx, 4);
    scroll(ctx, 5);
    fireSampler(ctx);
    pumpFor(ctx, p * 1000);
  }
};

// ── 11. a valid profile ────────────────────────────────────────────────────
console.log("\n11. Valid calibration profile");
{
  const ctx = makeContext();
  const p = calibrate(ctx, { planning: goodPlanning, translating: goodTranslating, reviewing: goodReviewing });
  check("profile is valid", p.valid, true);
  check("no failures", p.failures, []);
  check("stored under the participant id", Object.keys(ctx.__stored.ff_calibrations), ["P01"]);
  check("drafting faster than revising", p.segments.Translating.medianWpm > p.segments.Reviewing.medianWpm, true);
  check("wpmGate sits between the two",
        p.thresholds.wpmGate > p.segments.Reviewing.medianWpm &&
        p.thresholds.wpmGate < p.segments.Translating.medianWpm, true);
  // The whole point of per-phase idle: a planner pauses long, and normally.
  check("planning tolerates longer pauses than drafting",
        p.thresholds.idleSec.Planning > p.thresholds.idleSec.Translating, true);
  check("all idle thresholds within the clamp",
        Object.values(p.thresholds.idleSec).every((v) => v >= 15 && v <= 180), true);
  check("interaction baselines captured for every phase",
        Object.values(p.thresholds.activityRate).every((v) => typeof v === "number" && v > 0), true);
  check("drafting is the most active phase",
        p.thresholds.activityRate.Translating > p.thresholds.activityRate.Planning, true);
  check("burst minimum within clamp",
        p.thresholds.burstMinSec >= 3 && p.thresholds.burstMinSec <= 30, true);
  check("participant-facing figures present",
        p.display.writingWpm > p.display.reviewingWpm, true);
}

// ── 12. warm-up exclusion ──────────────────────────────────────────────────
console.log("\n12. Warm-up exclusion");
{
  const ctx = makeContext();
  ctx.startCalibration();
  ctx.beginCalibrationSegment("Translating");
  typeChars(ctx, 100, 100);     // 10s in: entirely inside the 30s warm-up
  pumpFor(ctx, 25_000);
  typeChars(ctx, 50, 100);      // after the warm-up
  pumpFor(ctx, 10_000);
  ctx.beginCalibrationSegment("Reviewing");
  let profile = null;
  ctx.finishCalibration("P01", (r) => { profile = r.profile; });
  check("warm-up keystrokes excluded from the count", profile.segments.Translating.keyCount, 50);
}

// ── 13. pauses come from the merged interaction timeline ───────────────────
console.log("\n13. Pause definition");
{
  const ctx = makeContext();
  ctx.startCalibration();
  ctx.beginCalibrationSegment("Reviewing");
  pumpFor(ctx, 31_000);
  typeChars(ctx, 10, 100);
  advance(20_000);
  scroll(ctx, 10);              // 20s of scrolling: activity, NOT a 20s pause
  typeChars(ctx, 10, 100);
  advance(9_000);               // a genuine 9s gap in all interaction
  typeChars(ctx, 10, 100);
  ctx.beginCalibrationSegment("Planning");
  let profile = null;
  ctx.finishCalibration("P01", (r) => { profile = r.profile; });
  const rev = profile.segments.Reviewing;
  // Two real gaps (20s before the scrolling, 9s after it); every within-word
  // gap is below the 2s floor and must not count.
  check("within-word gaps excluded", rev.pauseCount, 2);
  check("scrolling did not read as one long pause", rev.pauseMedianSec <= 20, true);
}

// ── 14. rejection: instructions not followed ───────────────────────────────
console.log("\n14. Rejection — no faster while drafting");
{
  const ctx = makeContext();
  const p = calibrate(ctx, {
    planning: goodPlanning,
    translating: goodReviewing,   // drafts no faster than they revise
    reviewing: goodTranslating,
  });
  check("profile rejected", p.valid, false);
  check("reason recorded", p.failures.includes("translating-not-faster-than-reviewing"), true);
  check("falls back to default thresholds", p.thresholds.wpmGate, 10);
  check("no participant-facing figures", p.display, null);
}

// ── 15. rejection: too little text ─────────────────────────────────────────
console.log("\n15. Rejection — insufficient text");
{
  const ctx = makeContext();
  const p = calibrate(ctx, {
    planning: goodPlanning,
    translating: (c) => { pumpFor(c, 30_000); writeChunk(c, 40, 200, 5); },  // < 100 keys
    reviewing: goodReviewing,
  });
  check("profile rejected", p.valid, false);
  check("reason recorded", p.failures.includes("insufficient-text"), true);
}

// ── 16. per-phase fallback does not sink the whole profile ─────────────────
console.log("\n16. Per-phase idle fallback");
{
  const ctx = makeContext();
  const p = calibrate(ctx, {
    // Continuous typing, no pauses at all — nothing to build a threshold from.
    planning: (c) => { pumpFor(c, 30_000); typeChars(c, 300, 200); },
    translating: goodTranslating,
    reviewing: goodReviewing,
  });
  check("profile still valid", p.valid, true);
  check("that phase flagged", p.failures.includes("idle-fallback:Planning"), true);
  check("that phase uses the default", p.thresholds.idleSec.Planning, 40);
  check("other phases still calibrated", p.thresholds.idleSec.Reviewing !== 40, true);
}

// ── 17. the profile actually drives classification ─────────────────────────
console.log("\n17. Calibrated profile changes behaviour");
{
  const ctx = makeContext();
  const p = calibrate(ctx, { planning: goodPlanning, translating: goodTranslating, reviewing: goodReviewing });
  ctx.__stored.ff_task = { participantId: "P01" };
  ctx.startTracking();
  tick(ctx);
  check("session runs on the profile", session(ctx).calibrationValid, true);
  check("gate is the calibrated one, not 10", session(ctx).thresholds.wpmGate, p.thresholds.wpmGate);
  // Typing that would clear the fixed gate of 10 need not clear a personalised
  // gate of ~40 — which is the entire point of calibrating it.
  check("calibrated gate is stricter for this fast typist", p.thresholds.wpmGate > 10, true);
}

// ── 18. profiles are kept per participant ──────────────────────────────────
// The study is within-subjects: each participant runs two sessions that may be
// days apart, with other participants calibrated in between. A single-profile
// key would drop the earlier participant onto default thresholds for their
// second session while still reporting them as calibrated.
console.log("\n18. One profile per participant");
{
  const ctx = makeContext();
  calibrate(ctx, { planning: goodPlanning, translating: goodTranslating, reviewing: goodReviewing });

  // A second participant calibrates on the same machine, in between.
  ctx.startCalibration();
  ctx.beginCalibrationSegment("Planning");    goodPlanning(ctx);
  ctx.beginCalibrationSegment("Translating"); goodTranslating(ctx);
  ctx.beginCalibrationSegment("Reviewing");   goodReviewing(ctx);
  ctx.finishCalibration("P02", () => {});

  const store = ctx.__stored.ff_calibrations;
  check("both profiles stored", Object.keys(store).sort(), ["P01", "P02"]);
  check("P01 survived P02 calibrating", store.P01.valid, true);
  check("profiles are not the same object", store.P01.capturedAt !== store.P02.capturedAt, true);

  // P01 returns for their second session.
  ctx.__stored.ff_task = { participantId: "P01" };
  ctx.startTracking();
  tick(ctx);
  check("P01 second session uses P01's profile", session(ctx).calibrationProfileId, "P01");
  check("and it is still valid", session(ctx).calibrationValid, true);
  check("with P01's own gate", session(ctx).thresholds.wpmGate, store.P01.thresholds.wpmGate);
}

// ── 19. a profile from the pre-map key is still honoured ───────────────────
console.log("\n19. Legacy single-profile key");
{
  const ctx = makeContext();
  const donor = makeContext();
  const p = calibrate(donor, { planning: goodPlanning, translating: goodTranslating, reviewing: goodReviewing });
  // Written the old way, with no ff_calibrations map present at all.
  ctx.__stored.ff_calibration = p;
  ctx.__stored.ff_task = { participantId: "P01" };
  ctx.startTracking();
  tick(ctx);
  check("legacy profile still applied", session(ctx).calibrationValid, true);
  check("under the right participant", session(ctx).calibrationProfileId, "P01");
}

// ── 20. an unrelated participant is still refused ──────────────────────────
console.log("\n20. Mismatched participant refused");
{
  const ctx = makeContext();
  calibrate(ctx, { planning: goodPlanning, translating: goodTranslating, reviewing: goodReviewing });
  ctx.__stored.ff_task = { participantId: "P99" }; // never calibrated
  ctx.startTracking();
  tick(ctx);
  check("falls back rather than borrowing P01's baseline", session(ctx).calibrationValid, false);
  check("default gate in force", session(ctx).thresholds.wpmGate, 10);
}


// ── 21. the decision trace records inputs, not just conclusions ─────────────
// The point of the trace is that a session can be re-classified under a
// DIFFERENT threshold set during analysis. That is only possible if every
// quantity the classifier tests is stored alongside the decision it produced.
console.log("\n21. Decision trace");
{
  const ctx = start();
  typeChars(ctx, 200, 150);
  tick(ctx);
  advance(50_000);
  tick(ctx);
  advance(80_000);
  tick(ctx);
  // What the panel sends before reading storage at session end: the trace is
  // persisted every ~5 ticks, so the tail needs an explicit flush.
  ctx.flushTraceToStorage();

  const trace = ctx.__stored.ff_trace;
  check("trace persisted", !!trace, true);
  check("column names travel with it", trace.columns[0], "tMs");
  // startTracking() opens the first phase segment immediately, which records a
  // row before any typing — so three ticks yield four rows.
  check("one row per tick, plus the opening one", trace.rows.length, 4);

  const col = (name) => trace.columns.indexOf(name);
  // Every threshold in the classifier must have its measured counterpart here,
  // or that rule cannot be replayed with a different value.
  for (const needed of ["wpm", "inactiveSec", "scrollPerMin", "deletePerMin", "activityPerMin", "burstSec", "tabSwitchesPerMin"]) {
    check(`input recorded: ${needed}`, col(needed) >= 0, true);
  }
  check("decision recorded too", col("phase") >= 0 && col("attention") >= 0, true);

  const opening = trace.rows[0];
  check("opening row precedes any typing", opening[col("phase")], "Planning");
  check("timestamps are session-relative", opening[col("tMs")] < 1000, true);

  const drafting = trace.rows[1];
  check("row after typing is drafting", drafting[col("phase")], "Translating");
  check("and focused", drafting[col("attention")], "Focused");
  check("carrying a real measured WPM", drafting[col("wpm")] > 10, true);

  const last = trace.rows[trace.rows.length - 1];
  check("last row is distracted", last[col("attention")], "Distracted");
  check("inactivity was measured, not inferred", last[col("inactiveSec")] > 120, true);
}

// ── 22. the trace supports the counterfactual it exists for ────────────────
// A replay under the OLD fixed thresholds must be computable from the rows
// alone, with no access to the extension. This reproduces that computation.
console.log("\n22. Replay under different thresholds");
{
  const ctx = start();
  typeChars(ctx, 200, 150);
  tick(ctx);
  advance(50_000);   // past the fixed 40s idle default, short of the 120s severe tier
  tick(ctx);
  ctx.flushTraceToStorage();

  const trace = ctx.__stored.ff_trace;
  const col = (n) => trace.columns.indexOf(n);

  // Offline re-classification of the phase channel using a threshold set the
  // session never ran under — exactly what the analysis will do.
  const replayPhase = (row, wpmGate, burstMin) => {
    if (row[col("wpm")] >= wpmGate && row[col("burstSec")] >= burstMin) return "Translating";
    return "Planning";
  };
  const drafting = trace.rows[1];                       // row 0 predates any typing
  const live = drafting[col("phase")];
  const strict = replayPhase(drafting, 999, 10);        // an impossible gate
  check("live classification was Translating", live, "Translating");
  check("replay under a stricter gate differs", strict, "Planning");
  check("which is the whole point", live !== strict, true);
}

// ── 23. break time produces no trace rows ──────────────────────────────────
console.log("\n23. Breaks are not traced");
{
  const ctx = start();
  typeChars(ctx, 100, 150);
  tick(ctx);
  ctx.flushTraceToStorage();
  const before = ctx.__stored.ff_trace.rows.length;
  ctx.startBreak();
  advance(60_000);
  tick(ctx);
  tick(ctx);
  ctx.endBreak(60_000);
  ctx.flushTraceToStorage();
  check("no rows recorded during a sanctioned break",
        ctx.__stored.ff_trace.rows.length, before);
}

console.log(`
${pass} passed, ${fail} failed
`);
process.exit(fail === 0 ? 0 : 1);
