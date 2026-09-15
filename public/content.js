//const LOGGING_ENABLED = false;

// Logs behavioral data to chrome.storage.local
const PAUSE_THRESHOLD_MS = 30000;         // gap > 30s = pause
const WPM_WINDOW_MS = 30000;              // rolling window for WPM calculation
const STORAGE_FLUSH_MS = 2000;            // 2s interval to write to storage
const CHARS_PER_WORD = 5;                 // Standard WPM definition
const BURST_END_THRESHOLD_MS = 10000;     // 10s of inactivity ends a typing burst
const BURST_MIN_DURATION_MS = 10000;      // Minimum 10s of activity to consider a burst
const WORD_SYNC_INTERVAL_MS = 2000;       // 2s cadence so the displayed count tracks the exact
                                          // Google Docs API word count in near-real time. An
                                          // in-flight guard (wordSyncInFlight) prevents requests
                                          // from stacking if a fetch runs slow.
const TAB_SWITCH_WINDOW_MS = 60000;       // rolling window for switch-frequency classification
const RAPID_SWITCH_THRESHOLD = 3;         // >= this many switches in the window = Distracted
                                          // (a switch every ~20s — attention residue never
                                          // clears between switches; cf. Leroy 2009)
const TAB_AWAY_THRESHOLD_MS = 60000;      // single tab-away tolerated up to this long; beyond
                                          // it the away-stretch is Distracted. Short reference
                                          // hops are free — frequency (above) catches repeats.
const REVIEW_SIGNAL_WINDOW_MS = 60000;    // rolling window for revision signals (Reviewing rule)
const ACTIVITY_WINDOW_MS = 60000;         // rolling window for the interaction-rate deviation signal

// ─── Two-label state model (see CALIBRATION_SPEC.md §8) ────────────────────
// PHASE is always one of Planning | Translating | Reviewing — never erased.
// ATTENTION is Focused | Distracted, evaluated against the CURRENT PHASE's
// calibrated baseline. Distraction is not a fourth phase: it is a condition
// that can occur during any of the three (Flower & Hayes describe three
// processes, not four), and keeping the two separate is what lets a 60s pause
// be normal while Planning and a stall while Translating.
const DEVIATION_FAMILIES_REQUIRED = 2;    // families that must fire together to enter Distracted
const SEVERE_STALL_MULTIPLIER = 3;        // inactivity beyond this x IDLE_<phase> stands alone
const RATE_DEVIATION_FRACTION = 0.25;     // interaction rate below this x the phase baseline = deviation

// ─── Calibration capture (see CALIBRATION_SPEC.md §5-§6) ───────────────────
// The participant works through three instructed segments in the real
// document, so the baseline is produced by the SAME listeners, debounces and
// rolling windows that produce the session measurements.
const CALIB_WARMUP_MS = 30000;            // discarded from the head of each segment
const CALIB_PAUSE_FLOOR_MS = 2000;        // a gap below this is typing rhythm, not a pause
const CALIB_MAD_MULTIPLIER = 3;           // idle threshold = median + 3 x MAD
const CALIB_SAMPLE_MS = 2000;             // WPM sampling cadence — matches the classifier's
const CALIB_IDLE_MIN_SEC = 15;            // clamp: below this a pause isn't disengagement
const CALIB_IDLE_MAX_SEC = 180;           // clamp: above this the threshold is unusable
const CALIB_BURST_MIN_SEC = 3;            // clamp on the derived burst minimum
const CALIB_BURST_MAX_SEC = 30;
const CALIB_MIN_PAUSES = 5;               // fewer than this: fall back for that phase only
const CALIB_MIN_TRANSLATING_KEYS = 100;   // less text than this: the whole profile is rejected

// Profiles are stored as a MAP keyed by participant id, not as a single
// profile. A single-profile key loses P01's baseline the moment P02
// calibrates, so if several participants were calibrated before their
// sessions ran, the earlier ones would quietly fall back to default thresholds
// while the panel still showed them as calibrated.
const CALIBRATION_STORE_KEY = "ff_calibrations";

// Per-participant thresholds, populated from the calibration profile at
// session start. These defaults are the FALLBACK used when no profile exists
// (dev testing, a pre-calibration session, or a profile that failed the
// validity guards) — every value is the constant this system used before
// calibration, except idleSec.
//
// idleSec defaults to 40 (not the old 120) because the severe-stall tier sits
// at SEVERE_STALL_MULTIPLIER x idleSec: 3 x 40 = 120s reproduces the previous
// behaviour exactly, while still giving the two-family rule a mild tier to
// work with. The default is derived from the old system, not chosen freely.
const DEFAULT_THRESHOLDS = {
  wpmGate: 10,          // separates Translating from Reviewing/Planning
  burstMinSec: 10,      // minimum burst length to count as Translating
  deleteGate: 5,        // deletions/min indicating revision
  scrollGate: 5,        // scroll events/min indicating rereading
  idleSec:  { Planning: 40, Translating: 40, Reviewing: 40 },
  // Per-phase interaction rate (events/min) from calibration. null disables
  // the Rate deviation family for that phase — with no baseline there is
  // nothing to deviate from, so the fallback runs on Time + Environment only.
  activityRate: { Planning: null, Translating: null, Reviewing: null },
};


//------------------- State --------------------------//
// KeyStroke Variables
let keyStrokeTimeStamps = [];         // Timestamps of keystrokes for WPM calculation
let netChars = 0;
let sessionStartTime = Date.now();
let lastKeyTime = null;
let lastActivityTime = Date.now();

// Pause/State Variables
let totalPauses = 0;
let longestPauseMs = 0;
let lastPauseMs = 0;
let isTyping = false;               // when state change since last flush
let isTracking = false;             // whether tracking is currently active
let listenerAttached = false;       // whether event listeners have been attached

// Revision Signal Variables — deletions and text-selection gestures feed the
// Reviewing rule (Flower & Hayes' reviewing = evaluating + revising; scroll
// alone only captures the evaluating half, and misses short docs entirely).
let deleteTimeStamps = [];      // one entry per Backspace/Delete keydown
let selectionTimeStamps = [];   // one entry per selection gesture (debounced)
// Session-lifetime totals. The arrays above are pruned to a 60s rolling window
// (that's what the Reviewing rule needs), so they can't answer "how much
// revision happened this session" — a value read at finish would only cover the
// last minute. These counters never prune; they are what the export carries.
let totalDeletes = 0;
let totalSelections = 0;

// Scrolling Variables
let scrollTimeStamps = [];
let lastScrollTop = 0;
let scrollUpCount = 0;
let scrollDownCount = 0;

// Tab Switch Variables
let tabSwitchTimeStamps = [];   // rolling window for the rapid-switch phase rule
let tabSwitchCount = 0;
let lastTabSwitchTime = null;   // currently not used, but may be useful for future analysis of tab switch patterns
let totalTabAwayMs = 0;
let tabHiddenAt = null;

// Burst Variables
let burstStartTime = null;
let burstCount = 0;
let totalBurstDurationMs = 0;
let lastCompletedBurstMs = 0;

// Break Variables
let totalBreakMs = 0;
let isOnBreak = false;   // phase/episode tracking is suspended while true

// Interruption Variables — total ms the Docs tab was closed or navigated away
// from Docs (fully offline, no tracking) across all interrupt→resume cycles
// this session. Subtracted from writing time in analytics so the offline gap
// doesn't dilute avg WPM. Distinct from breaks (a sanctioned in-app pause).
let totalInterruptedMs = 0;

// Word Count Sync Variables — background.js reads the real count via the
// Google Docs API; only the number crosses into this script (never the text).
// Until the first successful sync (or if OAuth isn't configured) the word
// count falls back to the netChars keystroke approximation.
let syncedWordCount = null;   // words written this session per the API (total - baseline)
let netCharsAtSync = 0;       // netChars at that moment, for the live delta
// Study docs start with the writing prompt already in them, so "words
// written" must subtract the doc's word count at session start. The baseline
// is a number (not text) so persisting it in ff_session is allowed — and
// required, or a tab refresh mid-session would re-baseline and zero the count.
let docWordBaseline = null;
let totalDocWords = 0;        // total words in the doc (baseline + written) — for display only
let wordSyncInFlight = false; // true while a Docs API word-count request is pending
// True once a Docs API word-count sync has actually returned a number this
// session — i.e. OAuth is working. Stays false (or flips back) when syncs
// return null (no/failed auth), which the panel surfaces so the researcher
// can reconnect instead of silently getting keystroke-only word counts.
let docsConnected = false;

// Active thresholds for this session. Replaced wholesale by the participant's
// calibration profile at startTracking; stays at DEFAULT_THRESHOLDS otherwise.
let thresholds = structuredClone(DEFAULT_THRESHOLDS);
let calibrationValid = false;     // true only when a valid profile was loaded
let calibrationProfileId = null;  // participant id the profile belongs to, for the export

// Interaction timestamps for the Rate deviation family. Distinct from
// keyStrokeTimeStamps: this counts EVERY interaction (keystroke, scroll,
// selection gesture), because "still present but barely doing anything" is a
// different question from "typing slowly" — and during Planning, where typing
// is near zero by definition, it is the only rate question worth asking.
let activityTimeStamps = [];

// ── Phase channel ──
// Accumulated ms in each of the three writing processes. There is no
// Distracted bucket: distraction is tracked on its own axis below and OVERLAPS
// these, so time in phase stays a complete partition of the tracked session.
let phaseDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0 };
let currentTrackedPhase = null;

// ── Attention channel ──
// Distracted ms WITHIN each phase — a subset of phaseDurationsMs, not a peer.
// This is what yields "time distracted, by phase", which the previous
// four-way model could not express: once it labelled you Distracted, the
// phase you were distracted *from* had already been overwritten.
let distractedDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0 };
let currentAttention = "Focused";
let attentionFamilies = [];       // families that fired on the last evaluation
let attentionTrigger = null;      // what caused the current Distracted state

// ── Calibration state ──
// Active only between FF_CALIB_START and FF_CALIB_FINISH, and never at the same
// time as a tracked session: calibration runs before the writing task, so
// isTracking stays false throughout and no ff_session data is produced.
let calibrationMode = false;
let calibSegments = [];        // completed segments, each fully recorded
let calibCurrent = null;       // the segment being recorded right now
let calibSampleIntervalId = null;

// ── Scheduled distraction ──
// Mirror of ff_distraction (owned by background.js) so an episode can be
// tagged INDUCED — the scheduled memory game — or NATURAL at the moment it
// starts, synchronously. The scheduled game is detected almost perfectly
// (leaving the tab is a categorical trigger), so pooling the two would inflate
// detection agreement; the tag is what lets the analysis report them apart.
// Holds no condition information: the distraction is identical in both arms.
let scheduledDistraction = null;

function refreshScheduledDistraction() {
  safeStorageGet("ff_distraction", (result) => {
    scheduledDistraction = result?.ff_distraction ?? null;
  });
}

// ── Decision trace ──
// One row per classifier tick holding the RAW MEASUREMENTS alongside the
// decision they produced. Without the inputs, a saved decision cannot be
// re-derived: "Translating" is a conclusion, and no threshold set can be
// replayed against it. Keeping them is what makes the study able to ask, after
// the fact, what the SAME session would have been classified as under the fixed
// pre-calibration thresholds — scored against the same screen-recording ground
// truth, which is the paired comparison that shows whether calibration helped.
//
// Rows are arrays, not objects, so the field names are not repeated 1,500 times
// (a 50-minute session is ~1,500 ticks). TRACE_COLUMNS travels with the export
// so the file stays self-describing.
const TRACE_COLUMNS = [
  "tMs",                // ms since session start
  "phase",              // Planning | Translating | Reviewing
  "attention",          // Focused | Distracted
  "wpm",                // rolling WPM, 30s window
  "inactiveSec",        // since ANY interaction — what the Time family tests
  "scrollPerMin",
  "deletePerMin",
  "activityPerMin",     // interactions/min — what the Rate family tests
  "burstSec",           // current typing burst length
  "tabSwitchesPerMin",
  "hidden",             // 1 while the tab is not visible
  "families",           // deviation families firing, "+"-joined
];
const TRACE_FLUSH_EVERY_TICKS = 5;   // persist every ~10s rather than every tick
const TRACE_MAX_ROWS = 6000;         // ~3.3h; guards memory if a session is left running

let decisionTrace = [];
let traceTruncated = false;
let traceTickCounter = 0;

// Timestamp of the last time-accumulation tick. Elapsed time is banked into
// the phase bucket (and the distracted bucket when distracted) on every tick,
// rather than only on transitions — with two overlapping channels a
// transition-based scheme would need to track two independent segment starts
// and reconcile them.
let lastAccumTime = null;

// Distraction Episode Variables — one entry per completed "Distracted" phase
// episode: { startedAt, endedAt, durationMs, trigger, resumptionMs }.
// resumptionMs is the time from returning to the doc until typing resumed
// (for tab-away episodes) or the full episode length (for idle episodes).
let distractionEpisodes = [];
let activeDistraction = null; // { startedAt, trigger, returnedAt } while an episode is ongoing
// Monotonic count of distraction episodes STARTED (incremented at onset, unlike
// distractionEpisodes.length which only grows when an episode CLOSES on the next
// keystroke). The panel watches this to re-arm the Gentle Reminder per episode —
// it fires even for tab-away episodes, whose phase flips back to non-Distracted
// on return before the panel's poll would ever observe "Distracted".
let distractionOnsetCount = 0;

// Interval handles — needed so we can clear them on extension context invalidation
let flushIntervalId = null;
let pauseIntervalId = null;
let idleIntervalId = null;
let phaseIntervalId = null;
let wordSyncIntervalId = null;


//------------------- Helper -----------------------------//
function isPrintable(key) {
  return key.length === 1;
}

// ── Robust statistics for calibration ──
function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Median absolute deviation. Used instead of the standard deviation because,
// unlike SD, it is not inflated by the very outliers it exists to detect —
// which matters at these sample sizes (a Planning segment may yield fewer than
// ten pauses). Leys, Ley, Klein, Bernard & Licata (2013).
function mad(values) {
  const med = median(values);
  if (med === null) return null;
  return median(values.map((v) => Math.abs(v - med)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rollingWPM() {
  const cutOff = Date.now() - WPM_WINDOW_MS;
  while (keyStrokeTimeStamps.length > 0 && keyStrokeTimeStamps[0] < cutOff) {
    keyStrokeTimeStamps.shift();
  }
  // Normalize words-in-window to a per-minute rate — without the 60s/window
  // factor this reported words-per-30s as WPM (half the real value).
  return Math.round((keyStrokeTimeStamps.length / CHARS_PER_WORD) * (60000 / WPM_WINDOW_MS));
}

function rollingDeleteFrequency() {
  const cutOff = Date.now() - REVIEW_SIGNAL_WINDOW_MS;
  while (deleteTimeStamps.length > 0 && deleteTimeStamps[0] < cutOff) {
    deleteTimeStamps.shift();
  }
  return deleteTimeStamps.length;
}

function rollingSelectionFrequency() {
  const cutOff = Date.now() - REVIEW_SIGNAL_WINDOW_MS;
  while (selectionTimeStamps.length > 0 && selectionTimeStamps[0] < cutOff) {
    selectionTimeStamps.shift();
  }
  return selectionTimeStamps.length;
}

// Interaction events per minute over the rolling window — the Rate deviation
// family's live measure, compared against the phase's calibrated baseline.
function rollingActivityFrequency() {
  const cutOff = Date.now() - ACTIVITY_WINDOW_MS;
  while (activityTimeStamps.length > 0 && activityTimeStamps[0] < cutOff) {
    activityTimeStamps.shift();
  }
  return activityTimeStamps.length * (60000 / ACTIVITY_WINDOW_MS);
}

// Single entry point for "the participant did something". Every interaction
// route (keystroke, scroll, selection gesture, tab return) goes through here so
// the idle clock and the interaction-rate window can never disagree about what
// counts as activity — the Time family reads lastActivityTime and the Rate
// family reads activityTimeStamps, and a signal recorded in one but not the
// other would make the two families silently inconsistent.
function markActivity(now) {
  lastActivityTime = now;
  activityTimeStamps.push(now);
  isTyping = true;
}

// Debounced: a held shift+arrow fires keydown repeats many times per second,
// but one continuous extend-the-selection motion is ONE gesture. Signals
// less than 1s apart merge into the previous gesture.
function pushSelectionSignal(now) {
  if (selectionTimeStamps.length === 0 || now - selectionTimeStamps[selectionTimeStamps.length - 1] > 1000) {
    selectionTimeStamps.push(now);
    // Incremented INSIDE the debounce guard so the session total counts
    // gestures, the same unit the rolling metric and threshold use.
    totalSelections++;
  }
  // Selecting text is engagement — keep it from reading as idle.
  markActivity(now);
  calibRecord("selections", now);
}

// Appends an event to the segment currently being recorded. A no-op outside
// calibration, so the live listeners can call it unconditionally.
function calibRecord(kind, at) {
  if (!calibrationMode || !calibCurrent) return;
  calibCurrent[kind].push(at);
}

function rollingTabSwitchFrequency() {
  const cutOff = Date.now() - TAB_SWITCH_WINDOW_MS;
  while (tabSwitchTimeStamps.length > 0 && tabSwitchTimeStamps[0] < cutOff) {
    tabSwitchTimeStamps.shift();
  }
  return tabSwitchTimeStamps.length;
}

function rollingScrollFrequency() {
  const cutOff = Date.now() - 60000; // 60s window for scroll speed calculation
  while (scrollTimeStamps.length > 0 && scrollTimeStamps[0] < cutOff) {
    scrollTimeStamps.shift();
  }
  return scrollTimeStamps.length;
}

function elapsedSeconds() {
  return Math.round((Date.now() - sessionStartTime) / 1000);
}

function getLiveWordCount() {
  if (syncedWordCount !== null) {
    // API-anchored: real count from the last sync, plus a keystroke-estimated
    // delta so the number still moves live between syncs.
    const delta = Math.round((netChars - netCharsAtSync) / CHARS_PER_WORD);
    return Math.max(0, syncedWordCount + delta);
  }
  return Math.max(0, Math.round(netChars / CHARS_PER_WORD));
}

// Pure typed-word count from keystrokes. Unlike getLiveWordCount (which is
// Docs-API-anchored and therefore reflects whatever ends up in the document),
// this counts only what the participant actually typed — a paste is a single
// non-printable Ctrl+V, so pasted/imported text adds ~nothing here. Used as the
// "typed words" study measure and for avg WPM, so pasting can't inflate either.
function getTypedWordCount() {
  return Math.max(0, Math.round(netChars / CHARS_PER_WORD));
}

// Asks background.js for the real word count (Docs API). Silently keeps the
// keystroke approximation on any failure — no auth, background asleep, API
// error — so this can never block or break tracking.
function syncWordCount() {
  if (!isTracking) return;
  if (!isExtensionContextValid()) { stopAllTracking(); return; }
  if (wordSyncInFlight) return; // a request is still pending — don't stack another
  wordSyncInFlight = true;
  try {
    chrome.runtime.sendMessage({ type: "FF_SYNC_WORD_COUNT" }, (response) => {
      wordSyncInFlight = false;
      if (chrome.runtime.lastError) return; // background asleep — keep last known status
      if (response && typeof response.wordCount === "number") {
        docsConnected = true;
        if (docWordBaseline === null) {
          // First sync: everything in the doc beyond what this session's
          // keystrokes account for was already there — that's the baseline.
          docWordBaseline = Math.max(0, response.wordCount - Math.round(netChars / CHARS_PER_WORD));
        }
        syncedWordCount = Math.max(0, response.wordCount - docWordBaseline);
        netCharsAtSync = netChars;
        totalDocWords = response.wordCount;
        isTyping = true; // make the next flush write the corrected count
      } else {
        // Response arrived but no number → Docs API unavailable (no/failed
        // OAuth, tab gone). Surface it so the panel can offer a reconnect.
        docsConnected = false;
      }
    });
  } catch (e) {
    wordSyncInFlight = false;
    stopAllTracking();
  }
}

// Checks whether the extension's runtime context is still alive.
// Once the extension is reloaded/updated/disabled, chrome.runtime.id becomes
// undefined inside any content script that was injected before the reload —
// any chrome.* API call made after that point throws "Extension context
// invalidated." This check lets us detect that *before* calling the API.
function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// Stops all tracking: clears every interval and flips isTracking off so any
// in-flight event listeners (keydown/scroll/visibilitychange) become no-ops.
// Called once, the first time we detect the extension context has died.
function stopAllTracking() {
  // Calibration runs on its own interval and is stopped unconditionally: a dead
  // extension context must not leave a sampler running in the page.
  stopCalibration();
  if (!isTracking) return; // already stopped, avoid double logging
  isTracking = false;

  if (flushIntervalId !== null) clearInterval(flushIntervalId);
  if (pauseIntervalId !== null) clearInterval(pauseIntervalId);
  if (idleIntervalId !== null) clearInterval(idleIntervalId);
  if (phaseIntervalId !== null) clearInterval(phaseIntervalId);
  if (wordSyncIntervalId !== null) clearInterval(wordSyncIntervalId);
  flushIntervalId = null;
  pauseIntervalId = null;
  idleIntervalId = null;
  phaseIntervalId = null;
  wordSyncIntervalId = null;

  console.log("FrictionFlow: extension context invalidated — tracking stopped. Refresh this tab to resume.");
}

// Wraps a chrome.storage.local call so that if the extension context has
// been invalidated, we stop tracking cleanly instead of throwing on every
// interval tick.
function safeStorageSet(payload, callback) {
  if (!isExtensionContextValid()) {
    stopAllTracking();
    if (typeof callback === "function") callback();
    return;
  }
  try {
    chrome.storage.local.set(payload, callback);
  } catch (e) {
    // Context died between the check above and this call — stop here too.
    stopAllTracking();
    if (typeof callback === "function") callback();
  }
}

function safeStorageGet(keys, callback) {
  if (!isExtensionContextValid()) {
    stopAllTracking();
    return;
  }
  try {
    chrome.storage.local.get(keys, callback);
  } catch (e) {
    stopAllTracking();
  }
}


//------------------ Phase & Attention Detection -------------------//
// Two independent channels, both recomputed on the 2s interval. The phase
// channel runs first; the attention channel then evaluates against THAT
// phase's calibrated baseline.

// PHASE — three-way. Every "Distracted" branch that used to live here has
// moved into assessAttention, because being distracted should not erase what
// the participant was doing.
//
// Planning is the residual state, which is what it always was in substance:
// the old `pause > 15s && WPM < 10` rule and the `default → Planning`
// fallthrough collapsed to the same answer, so that threshold is gone rather
// than calibrated. It is also the theoretically correct default — pausing
// mid-draft to work out the next sentence IS a shift into planning under
// Flower & Hayes' recursive model.
//
// Selection gestures no longer feed this rule (see CALIBRATION_SPEC.md §6.3):
// the weakest of the three revision signals, redundant with the delete rate,
// and itself only a proxy for something Docs' canvas rendering hides. Gestures
// are still logged — they count as activity, and the session total is exported.
function classifyPhase(scrollFreq) {
  const now = Date.now();
  const currentBurstSec = burstStartTime ? Math.round((now - burstStartTime) / 1000) : 0;
  const wpm = rollingWPM();

  // Reviewing — rereading or revising while production typing is low: heavy
  // scrolling (evaluating a long doc), or a run of deletions (pruning text —
  // flow typo-fixes co-occur with high WPM, which the gate excludes).
  if ((scrollFreq >= thresholds.scrollGate || rollingDeleteFrequency() >= thresholds.deleteGate)
      && wpm < thresholds.wpmGate) return "Reviewing";

  // Translating — actively typing at pace, within a sustained burst.
  if (wpm >= thresholds.wpmGate && currentBurstSec >= thresholds.burstMinSec) return "Translating";

  return "Planning";
}

// ATTENTION — Focused | Distracted, judged against the CURRENT phase's
// baseline. Signals are grouped into FAMILIES and two different families must
// fire together, so no single deviation flags a participant (a long pause is
// ordinary during Planning; a burst of tab switches is ordinary mid-research).
//
// Grouping by family rather than counting signals flatly prevents
// double-counting near-identical evidence: "no keystroke for 40s" and "no
// interaction for 40s" are effectively one observation and must not satisfy a
// two-signal rule between them.
//
//   Time        — no interaction of ANY kind for longer than IDLE_<phase>
//   Rate        — interaction rate collapsed vs the phase's calibrated baseline
//   Environment — rapid tab switching
//
// The Rate family deliberately measures INTERACTIONS, not words: a "no text
// produced" signal would be true almost continuously during Planning, whose
// definition is producing no text, and a signal that is definitionally true in
// a phase carries no information in that phase. It is also why the Time family
// reads lastActivityTime rather than lastKeyTime — a writer who is genuinely
// planning is still present (rereading, scrolling, moving the cursor), while
// one who has disengaged produces no interaction at all. That distinction is
// the only thing that separates the two during Planning.
function assessAttention(phase) {
  const now = Date.now();
  const idleMs = (thresholds.idleSec[phase] ?? DEFAULT_THRESHOLDS.idleSec[phase]) * 1000;
  const inactiveMs = now - lastActivityTime;

  // ── Categorical triggers — sufficient on their own ──
  // Not deviations from a baseline: direct evidence the participant is not
  // working. A single tab-away is still tolerated up to TAB_AWAY_THRESHOLD_MS
  // so quick reference checks don't flag.
  if (document.hidden && tabHiddenAt !== null && now - tabHiddenAt > TAB_AWAY_THRESHOLD_MS) {
    return { distracted: true, trigger: "tab-away", families: ["tab-away"] };
  }
  // Severe stall. Without this tier a participant who disengages during
  // Planning without touching another tab fires only the Time family — one
  // family, never enough — and would never be flagged at all. At the default
  // idleSec of 40s this lands at 120s, exactly the old global idle rule.
  if (inactiveMs > idleMs * SEVERE_STALL_MULTIPLIER) {
    return { distracted: true, trigger: "severe-stall", families: ["severe-stall"] };
  }

  // ── Deviation families ──
  const families = [];
  if (inactiveMs > idleMs) families.push("time");
  const rateBaseline = thresholds.activityRate[phase];
  if (rateBaseline !== null && rollingActivityFrequency() < rateBaseline * RATE_DEVIATION_FRACTION) {
    families.push("rate");
  }
  // No WPM guard here any more: a writer typing productively through a few tab
  // switches fires Environment and nothing else, which is one family, which is
  // not enough. The two-family rule makes the old guard redundant.
  if (rollingTabSwitchFrequency() >= RAPID_SWITCH_THRESHOLD) families.push("environment");

  // Hysteresis — enter at >= 2 families, leave only at 0, never at 1. This
  // interval runs every 2s; a symmetric threshold would let the state
  // oscillate across the boundary, and every oscillation opens a new
  // distraction episode, fires a new Gentle Reminder and triggers a new
  // Gemini call.
  const distracted = currentAttention === "Distracted"
    ? families.length > 0
    : families.length >= DEVIATION_FAMILIES_REQUIRED;

  return { distracted, trigger: distracted ? "deviation" : null, families };
}

// Banks elapsed time into the current phase bucket, and additionally into the
// distracted bucket when distracted — the two channels OVERLAP, so distracted
// time is a subset of phase time, not a peer of it. Tick-based rather than
// transition-based: with two channels changing independently, a
// transition-based scheme would need two segment starts kept in sync.
// Break time is banked nowhere, but the clock still advances so the break gap
// isn't retroactively charged to a phase when tracking resumes.
function bankElapsed() {
  const now = Date.now();
  if (lastAccumTime !== null && currentTrackedPhase !== null && !isOnBreak) {
    const dt = now - lastAccumTime;
    phaseDurationsMs[currentTrackedPhase] += dt;
    if (currentAttention === "Distracted") distractedDurationsMs[currentTrackedPhase] += dt;
  }
  lastAccumTime = now;
}

// Recomputes both channels. Must run on a fixed interval regardless of typing
// activity — otherwise a silent stall is never re-evaluated, because the
// classifier would only ever run inside the activity-gated flush.
function updateState() {
  const now = Date.now();

  // Freeze the phase while distracted. The phase at ONSET is what the recovery
  // prompt needs ("you were mid-sentence"); re-evaluating through a long
  // tab-away would drift it to Planning and reintroduce exactly the erasure
  // this model exists to prevent. This is what replaces lastActivePhase.
  const phase = currentAttention === "Distracted" && currentTrackedPhase !== null
    ? currentTrackedPhase
    : classifyPhase(rollingScrollFrequency());

  const assessment = assessAttention(phase);

  // Bank against the OLD state before applying the new one, so elapsed time
  // lands in the buckets that were actually current for that interval.
  bankElapsed();

  currentTrackedPhase = phase;
  attentionFamilies = assessment.families;

  recordTraceRow(now, phase, assessment);

  if (assessment.distracted && currentAttention === "Focused") {
    currentAttention = "Distracted";
    attentionTrigger = assessment.trigger;
    startDistractionEpisode(now, assessment.trigger, phase, assessment.families);
  } else if (!assessment.distracted && currentAttention === "Distracted") {
    // The attention state clears as soon as the signals do, but the distraction
    // EPISODE stays open until the first writing keystroke (see the keydown
    // handler) — that is what makes resumptionMs the H1 measure.
    currentAttention = "Focused";
    attentionTrigger = null;
  }
}

// Appends one row of raw measurements plus the decision they produced. The
// attention value recorded is the one this tick ENDS on, so a row can be read
// as "these measurements, therefore this state".
function recordTraceRow(now, phase, assessment) {
  if (isOnBreak) return; // tracking is suspended; there is no decision to record
  if (decisionTrace.length >= TRACE_MAX_ROWS) { traceTruncated = true; return; }

  decisionTrace.push([
    now - sessionStartTime,
    phase,
    assessment.distracted ? "Distracted" : "Focused",
    rollingWPM(),
    Math.round((now - lastActivityTime) / 1000),
    rollingScrollFrequency(),
    rollingDeleteFrequency(),
    rollingActivityFrequency(),
    burstStartTime ? Math.round((now - burstStartTime) / 1000) : 0,
    rollingTabSwitchFrequency(),
    document.hidden ? 1 : 0,
    assessment.families.join("+"),
  ]);

  // Persisted on its own key and on a slower cadence: ff_session is
  // read-modify-written every 2s, and a growing array there would make every
  // one of those writes progressively heavier.
  traceTickCounter++;
  if (traceTickCounter % TRACE_FLUSH_EVERY_TICKS === 0) flushTraceToStorage();
}

function flushTraceToStorage(callback) {
  safeStorageSet(
    { ff_trace: { columns: TRACE_COLUMNS, rows: decisionTrace, truncated: traceTruncated } },
    callback
  );
}

function startDistractionEpisode(now, trigger, phase, families) {
  if (activeDistraction) return;
  distractionOnsetCount++; // onset signal for the panel's per-episode re-arm
  const induced = !!scheduledDistraction?.active;
  activeDistraction = {
    startedAt: now,
    trigger,   // "tab-away" | "severe-stall" | "deviation"
    phase,     // the phase this distraction interrupted — no longer inferred
    families,  // which signals fired, kept for analysis of the detection rule
    induced,   // true = the scheduled memory game; false = the writer drifted
    inducedEpisode: induced ? scheduledDistraction.episode : null,
    returnedAt: null,
  };

  // Ask background to pre-generate a recovery summary for this episode so
  // it's ready by the time the user clicks "Get Back to Work". All gates
  // (intervention condition, cooldown, key configured) live in background —
  // this is fire-and-forget and must never affect tracking.
  //
  // The episode facts ride ON THE MESSAGE rather than being read from
  // ff_session: the flush that would carry them happens AFTER this call, so a
  // storage read in background would race it and could see stale values.
  try {
    chrome.runtime.sendMessage({
      type: "FF_CHECK_STUCK",
      trigger,
      phase,
      families,
    }, () => void chrome.runtime.lastError);
  } catch (e) {
    // Extension context died mid-call — the interval guards will handle it.
  }
}

// Called from the keydown handler at the first keystroke while an episode
// is open (or from startBreak when the user opts for a break instead) —
// `now` marks actual task resumption.
function finalizeDistractionEpisode(now) {
  if (!activeDistraction) return;
  const ep = activeDistraction;
  distractionEpisodes.push({
    startedAt: ep.startedAt,
    endedAt: now,
    durationMs: now - ep.startedAt,
    trigger: ep.trigger,
    phase: ep.phase ?? null,        // what was interrupted
    families: ep.families ?? [],    // which signals fired, for auditing the rule
    induced: !!ep.induced,          // scheduled game vs natural drift
    inducedEpisode: ep.inducedEpisode ?? null,
    // For tab-away episodes measure from the moment they came back to the
    // doc; for stall and deviation episodes the user never left (or is
    // currently on the doc), so use the full episode.
    resumptionMs: ep.trigger === "tab-away" && ep.returnedAt ? now - ep.returnedAt : now - ep.startedAt,
  });
  activeDistraction = null;
}

function getAvgResumptionMs() {
  if (distractionEpisodes.length === 0) return 0;
  const total = distractionEpisodes.reduce((sum, ep) => sum + ep.resumptionMs, 0);
  return Math.round(total / distractionEpisodes.length);
}

// Merge-writes the current phase + episode data to storage immediately.
// Used by the phase interval AND the visibilitychange handler: Chrome
// throttles or outright freezes timers in hidden tabs, so distraction
// detection must not depend on the next interval tick firing while hidden —
// the visibility event itself is the reliable trigger.
function flushPhaseToStorage() {
  safeStorageGet("ff_session", (result) => {
    const existing = (result && result.ff_session) ?? {};
    safeStorageSet({
      ff_session: {
        ...existing,
        currentPhase: currentTrackedPhase,
        currentAttention,        // "Focused" | "Distracted" — the second label
        attentionFamilies,       // which deviation families are firing right now
        attentionTrigger,
        phaseDurationsMs,        // total time per phase (distracted time included)
        distractedDurationsMs,   // distracted time WITHIN each phase (a subset)
        distractionCount: distractionEpisodes.length,
        distractionOnsetCount,
        distractionEpisodes,
        activeDistraction, // persist the open episode so a resume can continue it
        avgResumptionMs: getAvgResumptionMs(),
        docsConnected, // Docs API auth status, for the panel's connect indicator
        calibrationValid,
        calibrationProfileId,
        thresholds, // the exact values this session ran under — must reach the export
      }
    });
  });
}


//------------------ Event Listeners ------------------------//
// Google docs swallows events before they reach the document
function attachTypingListener() {
  const docsInput = document.querySelector("iframe.docs-texteventtarget-iframe");

  if (!docsInput) {
    setTimeout(attachTypingListener, 500);
    return;
  }

  docsInput.contentDocument.addEventListener("keydown", (e) => {
    // Calibration uses the same listener deliberately (spec §4): a baseline
    // gathered by a different mechanism than the measurement would not be
    // comparable to it.
    if (!isTracking && !calibrationMode) return;

    const now = Date.now();
    if (calibrationMode) {
      if (isPrintable(e.key)) calibRecord("keys", now);
      else if (e.key === "Backspace" || e.key === "Delete") calibRecord("deletes", now);
    }

    // First WRITING keystroke while a distraction episode is open = task
    // resumed — close the episode here (not on phase transitions) so
    // resumptionMs reflects when writing actually restarted. Lone modifier
    // or navigation keys (Ctrl, Shift, arrows) are re-orientation, not
    // resumption — H1 defines resumption as the return of typing.
    const isWritingKey = isPrintable(e.key) || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter";
    if (isWritingKey && activeDistraction && !isOnBreak) {
      finalizeDistractionEpisode(now);
    }

    if (isPrintable(e.key)) {
      keyStrokeTimeStamps.push(now);
      netChars++;
    } else if (e.key === "Backspace" || e.key === "Delete") {
      netChars = Math.max(0, netChars - 1);
      deleteTimeStamps.push(now); // revision signal for the Reviewing rule
      totalDeletes++;             // session total (never pruned) — exported
    } else if (e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      // Keyboard text selection — a revision signal (debounced inside).
      pushSelectionSignal(now);
    }

    // Pause detection if gap exceeds threshold
    if (lastKeyTime !== null) {
      const gap = now - lastKeyTime;

      if (gap >= PAUSE_THRESHOLD_MS) {
        totalPauses++;
        lastPauseMs = gap;
        longestPauseMs = Math.max(longestPauseMs, gap);
      }
    }

    // Burst detection
    if (lastKeyTime !== null) {
      const gap = now - lastKeyTime;

      // If gap exceeds burst end threshold, consider previous burst ended
      if (gap >= BURST_END_THRESHOLD_MS && burstStartTime !== null) {
        const burstDuration = lastKeyTime - burstStartTime;
        if (burstDuration >= BURST_MIN_DURATION_MS) {
          burstCount++;
          totalBurstDurationMs += burstDuration;
          lastCompletedBurstMs = burstDuration;
          // Bursts are attributed to the segment they ENDED in, and carry their
          // own start time so the warm-up filter can exclude any that began
          // before the segment's usable window opened.
          if (calibrationMode && calibCurrent) {
            calibCurrent.bursts.push({ startedAt: burstStartTime, durationMs: burstDuration });
          }
        }
        burstStartTime = null; // reset burst start
      }
    }

    if (burstStartTime === null) {
      burstStartTime = now; // start new burst
    }

    lastKeyTime = now;
    markActivity(now);
  });
}

function attachScrollListener() {
  const editor = document.querySelector(".kix-appview-editor");

  if (!editor) {
    setTimeout(attachScrollListener, 500);
    return;
  }

  let scrollDebounceTimer = null;

  editor.addEventListener("scroll", () => {
    if (!isTracking && !calibrationMode) return;

    const currentScrollTop = editor.scrollTop;
    const delta = currentScrollTop - lastScrollTop;

    // may use in the future, for now just log total scroll distance and counts
    if (delta > 0) {
      scrollDownCount++;
    } else if (delta < 0) {
      scrollUpCount++;
    }

    lastScrollTop = currentScrollTop;
    // Scrolling is interaction: it keeps the Time family's idle clock from
    // running, and counts toward the Rate family's interaction window. This is
    // what distinguishes a writer rereading their draft while planning from
    // one who has left the desk.
    markActivity(Date.now());

    // Only push timestamp once per scroll burst, not on every raw event
    clearTimeout(scrollDebounceTimer);
    scrollDebounceTimer = setTimeout(() => {
      const at = Date.now();
      scrollTimeStamps.push(at);
      // Same debounced unit the scroll threshold is expressed in, so the
      // calibrated gate and the live measure count the same thing.
      calibRecord("scrolls", at);
    }, 150); // waits 150ms after last scroll before counting
  });
}

// Google Docs renders text on canvas, so there is no DOM selection to
// observe — detect the selection GESTURE instead: a click-drag across the
// editor, or a double-click (select word). Caveat: a scrollbar drag also
// registers as one gesture, but two scrollbar drags in a minute while not
// typing is doc navigation — Reviewing is the right call there anyway.
function attachSelectionListener() {
  const editor = document.querySelector(".kix-appview-editor");

  if (!editor) {
    setTimeout(attachSelectionListener, 500);
    return;
  }

  let dragStart = null;

  editor.addEventListener("mousedown", (e) => {
    dragStart = { x: e.clientX, y: e.clientY };
  });

  editor.addEventListener("mouseup", (e) => {
    if ((!isTracking && !calibrationMode) || !dragStart) return;
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    dragStart = null;
    if (moved > 8) pushSelectionSignal(Date.now()); // drag, not a plain caret click
  });

  editor.addEventListener("dblclick", () => {
    if (!isTracking && !calibrationMode) return;
    pushSelectionSignal(Date.now());
  });
}

function attachTabSwitchListener() {
  document.addEventListener("visibilitychange", () => {
    if (!isTracking) return; // ignore activity once tracking has stopped

    if (document.hidden) {
      tabSwitchCount++;
      tabSwitchTimeStamps.push(Date.now()); // rolling window for the rapid-switch rule
      tabHiddenAt = Date.now();
      lastTabSwitchTime = Date.now();

      // Classify + persist NOW — the phase interval may be throttled or
      // frozen by Chrome once this tab is hidden. This banks the pre-hide
      // segment while state is fresh, and catches the rapid-switch rule
      // immediately on the switch that crosses the threshold. (A single
      // tab-away no longer flags here — see TAB_AWAY_THRESHOLD_MS.)
      if (!isOnBreak) {
        updateState();
        flushPhaseToStorage();
      }
    } else {
      // Retroactive catch: if Chrome throttled/froze our intervals while the
      // tab was hidden, an over-threshold away-stretch may never have been
      // evaluated. Flip ATTENTION here, backdated to when the tolerance ran
      // out, so the away time is attributed correctly. The PHASE is left
      // untouched — under the two-label model an absence says nothing about
      // which writing process was interrupted, and preserving it is the point.
      // Must run before tabHiddenAt is cleared.
      if (tabHiddenAt !== null && !isOnBreak) {
        const awayMs = Date.now() - tabHiddenAt;
        if (awayMs > TAB_AWAY_THRESHOLD_MS && currentAttention === "Focused") {
          const flipAt = tabHiddenAt + TAB_AWAY_THRESHOLD_MS;
          // Bank the still-focused stretch up to the flip; the updateState()
          // call below then banks flipAt→now as distracted time, since
          // bankElapsed runs before the state is re-evaluated.
          if (lastAccumTime !== null && currentTrackedPhase !== null && flipAt > lastAccumTime) {
            phaseDurationsMs[currentTrackedPhase] += flipAt - lastAccumTime;
            lastAccumTime = flipAt;
          }
          currentAttention = "Distracted";
          attentionTrigger = "tab-away";
          attentionFamilies = ["tab-away"];
          startDistractionEpisode(flipAt, "tab-away", currentTrackedPhase, ["tab-away"]);
        }
      }
      if (tabHiddenAt !== null) {
        totalTabAwayMs += Date.now() - tabHiddenAt;
        tabHiddenAt = null;
      }
      // Stamp the LATEST return to the doc (overwriting earlier ones): if the
      // user bounces away and back several times without typing, it's all one
      // open episode, and resumptionMs should measure from the final return
      // before writing resumed.
      if (activeDistraction && activeDistraction.trigger === "tab-away") {
        activeDistraction.returnedAt = Date.now();
      }
      // Force the next flush to write, but deliberately do NOT call
      // markActivity: coming back to the tab is not doing work. Leaving the
      // idle clock running means a participant who returns and then sits there
      // stays flagged, which is the honest reading.
      isTyping = true;

      // Re-sync on return too — if the tab was frozen while hidden, this is
      // the first chance to bank the away time into the phase durations.
      if (!isOnBreak) {
        updateState();
        flushPhaseToStorage();
      }
    }
  });
}

function attachListenersOnce() {
  if (listenerAttached) return;
  listenerAttached = true;

  attachTypingListener();
  attachScrollListener();
  attachSelectionListener();
  attachTabSwitchListener();
}


//------------------ Tracking Lifecycle -------------------//
function resetSessionState() {
  keyStrokeTimeStamps = [];
  netChars = 0;
  sessionStartTime = Date.now();
  lastKeyTime = null;
  lastActivityTime = Date.now();

  totalPauses = 0;
  longestPauseMs = 0;
  lastPauseMs = 0;
  isTyping = false;

  deleteTimeStamps = [];
  selectionTimeStamps = [];
  totalDeletes = 0;
  totalSelections = 0;

  scrollTimeStamps = [];
  lastScrollTop = 0;
  scrollUpCount = 0;
  scrollDownCount = 0;

  tabSwitchTimeStamps = [];
  tabSwitchCount = 0;
  lastTabSwitchTime = null;
  totalTabAwayMs = 0;
  tabHiddenAt = null;

  burstStartTime = null;
  burstCount = 0;
  totalBurstDurationMs = 0;
  lastCompletedBurstMs = 0;

  totalBreakMs = 0;
  isOnBreak = false;
  totalInterruptedMs = 0;

  syncedWordCount = null;
  netCharsAtSync = 0;
  docWordBaseline = null;
  totalDocWords = 0;
  wordSyncInFlight = false;
  docsConnected = false;

  activityTimeStamps = [];

  phaseDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0 };
  distractedDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0 };
  currentTrackedPhase = null;
  currentAttention = "Focused";
  attentionFamilies = [];
  attentionTrigger = null;
  lastAccumTime = null;

  distractionEpisodes = [];
  activeDistraction = null;
  distractionOnsetCount = 0;

  decisionTrace = [];
  traceTruncated = false;
  traceTickCounter = 0;

  // Thresholds are NOT reset here — loadThresholds() owns them, and it runs
  // before tracking starts so a reset would just discard the profile it loaded.
}

// Loads the participant's calibration profile into `thresholds`. Falls back to
// DEFAULT_THRESHOLDS on anything unexpected — a missing profile, a profile for
// a different participant, or one that failed the validity guards at capture
// time. A session must always be able to run: a participant blocked at the
// start screen because calibration is missing is a worse study outcome than one
// running on documented defaults, which the export flags as calibrationValid:
// false so the condition is visible in the data rather than silent.
function loadThresholds(callback) {
  thresholds = structuredClone(DEFAULT_THRESHOLDS);
  calibrationValid = false;
  calibrationProfileId = null;

  safeStorageGet([CALIBRATION_STORE_KEY, "ff_calibration", "ff_task"], (result) => {
    const participantId = result?.ff_task?.participantId ?? null;
    const store = result?.[CALIBRATION_STORE_KEY] ?? {};
    // Falls back to the pre-map single-profile key so a profile captured before
    // this change is still honoured rather than silently ignored.
    const legacy = result?.ff_calibration;
    const profile =
      (participantId && store[participantId]) ??
      (legacy && legacy.participantId === participantId ? legacy : null);

    if (profile?.valid && profile.thresholds && profile.participantId === participantId) {
      thresholds = { ...structuredClone(DEFAULT_THRESHOLDS), ...structuredClone(profile.thresholds) };
      calibrationValid = true;
      calibrationProfileId = profile.participantId;
      console.log("FrictionFlow: calibration profile loaded for", profile.participantId);
    } else if (profile && profile.participantId !== participantId) {
      // Loud, because silently running P02 on P01's baseline would corrupt a
      // participant's data in a way nothing downstream could detect.
      console.warn(
        `FrictionFlow: calibration profile belongs to ${profile.participantId}, session is ${participantId} — using defaults.`
      );
    } else {
      console.log("FrictionFlow: no valid calibration profile — using default thresholds.");
    }

    if (typeof callback === "function") callback();
  });
}

function startTracking() {
  resetSessionState();
  refreshScheduledDistraction();
  // Thresholds must be in place BEFORE the first classification, or the opening
  // seconds of the session would be judged against defaults and then silently
  // switch to the participant's profile mid-stream.
  loadThresholds(() => {
    isTracking = true;
    attachListenersOnce();
    startIntervals();
    // Open the first phase segment NOW rather than waiting for the phase
    // interval's first tick (up to 2s later): otherwise those seconds fall into
    // no phase, and the analytics phase durations sum to just under the session
    // length. classifyPhase with no keystrokes yet returns Planning (its default).
    updateState();
    console.log("FrictionFlow: tracking started.");
  });
}

// Resumes tracking in a freshly injected content script (tab refresh,
// extension reload, or doc reopened after an interruption) by restoring
// accumulated counters from the last ff_session snapshot, so the session
// continues instead of restarting from zero. Callers must check isTracking
// first — if tracking is already alive, resuming would be a data-losing reset.
function resumeTracking(snapshot, task, interruptedMs = 0, trace = null) {
  resetSessionState();
  // A reinjection can land mid-distraction; re-read so the episode about to be
  // restored or opened is tagged correctly.
  refreshScheduledDistraction();

  // Keep the original session anchor so elapsed time stays continuous.
  if (task?.sessionStartTime) sessionStartTime = task.sessionStartTime;

  // Carry the trace across reinjection. Row timestamps are relative to
  // sessionStartTime, restored just above, so the resumed rows line up with the
  // earlier ones on one continuous timeline.
  if (Array.isArray(trace?.rows)) {
    decisionTrace = trace.rows;
    traceTruncated = !!trace.truncated;
  }

  if (snapshot) {
    // Restore the typed-keystroke count (not the doc word count) so the typed-
    // words metric stays paste-free across a resume — reconstructing netChars
    // from the doc count would fold pasted text into "typed". Older snapshots
    // without typedWordCount fall back to the doc count.
    netChars = (snapshot.typedWordCount ?? snapshot.wordCount ?? 0) * CHARS_PER_WORD;
    docWordBaseline = snapshot.docWordBaseline ?? null;
    totalPauses = snapshot.totalPauses ?? 0;
    longestPauseMs = snapshot.longestPauseMs ?? 0;
    tabSwitchCount = snapshot.tabSwitchCount ?? 0;
    totalTabAwayMs = snapshot.totalTabAwayMs ?? 0;
    burstCount = snapshot.burstCount ?? 0;
    totalBurstDurationMs = (snapshot.avgBurstDurationSec ?? 0) * 1000 * burstCount;
    lastCompletedBurstMs = (snapshot.lastCompletedBurstSec ?? 0) * 1000;
    totalBreakMs = snapshot.totalBreakMs ?? 0;
    totalInterruptedMs = snapshot.totalInterruptedMs ?? 0;
    if (snapshot.phaseDurationsMs) {
      // Spread over the fresh object, so a snapshot written by the previous
      // four-phase build (which carried a Distracted key) can't reintroduce it.
      const { Planning = 0, Translating = 0, Reviewing = 0 } = snapshot.phaseDurationsMs;
      phaseDurationsMs = { Planning, Translating, Reviewing };
    }
    if (snapshot.distractedDurationsMs) {
      const { Planning = 0, Translating = 0, Reviewing = 0 } = snapshot.distractedDurationsMs;
      distractedDurationsMs = { Planning, Translating, Reviewing };
    }
    // Attention deliberately restarts at Focused: the signals it is derived
    // from (idle clock, interaction window, tab-switch window) are all rolling
    // and cannot be reconstructed across a reinjection gap. The open EPISODE is
    // restored below, so nothing is lost from the H1 measure — only the live
    // state, which the next tick recomputes anyway.
    // Guarded against a snapshot from the previous four-phase build, whose
    // currentPhase could be "Distracted" — not a phase any more.
    currentTrackedPhase = ["Planning", "Translating", "Reviewing"].includes(snapshot.currentPhase)
      ? snapshot.currentPhase
      : null;
    // Cumulative revision totals must survive reinjection — the rolling arrays
    // deliberately restart (a 60s window has no meaning across a gap).
    totalDeletes = snapshot.totalDeletes ?? 0;
    totalSelections = snapshot.totalSelections ?? 0;
    distractionEpisodes = snapshot.distractionEpisodes ?? [];
    // Preserve the onset baseline across reinjection so the panel doesn't
    // treat a resumed session as a brand-new episode. Fall back to the closed-
    // episode count if an older snapshot predates this field.
    distractionOnsetCount = snapshot.distractionOnsetCount ?? distractionEpisodes.length;
    // Restore an in-progress distraction episode (refresh happened mid-
    // distraction) so it can still be finalized on the next keystroke with its
    // original startedAt — otherwise the episode and its resumption time are
    // silently lost. startDistractionEpisode's `if (activeDistraction) return`
    // guard then prevents the re-classified phase from opening a duplicate.
    activeDistraction = snapshot.activeDistraction ?? null;
  }

  // Fold this interruption's offline gap (Docs tab closed/away from Docs) into
  // the running total so analytics can subtract it from writing time.
  totalInterruptedMs += interruptedMs ?? 0;

  // Same ordering requirement as startTracking: the profile has to be loaded
  // before any classification runs, so a resumed session is judged against the
  // same thresholds as the stretch before the interruption.
  loadThresholds(() => {
    isTracking = true;
    attachListenersOnce();
    startIntervals();
    updateState();

    // Persist the interruption total immediately — the participant may finish the
    // session before the first flush, and handleFinishSession reads it from the
    // ff_session snapshot.
    safeStorageGet("ff_session", (result) => {
      const existing = (result && result.ff_session) ?? {};
      safeStorageSet({ ff_session: { ...existing, totalInterruptedMs } });
    });

    console.log("FrictionFlow: tracking resumed from stored session snapshot.");
  });
}

function stopTracking() {
  stopAllTracking();
  console.log("FrictionFlow: tracking cancelled.");
}

// A sanctioned break suspends phase/episode tracking so break time doesn't
// pollute the behavioral data (Distracted time, episodes, pauses) — per the
// paper, the system is "in a paused state" during break mode.
function startBreak() {
  if (!isTracking || isOnBreak) return;

  const now = Date.now();
  // Bank everything up to this moment BEFORE flipping isOnBreak, so the
  // pre-break stretch is still attributed. Nulling lastAccumTime then makes the
  // first tick after the break bank nothing, which is what keeps the break gap
  // out of the phase totals entirely.
  bankElapsed();
  currentTrackedPhase = null;
  lastAccumTime = null;
  // A sanctioned break is not distraction — clear the attention channel so the
  // break can't accumulate distracted time or leave the state stuck on return.
  currentAttention = "Focused";
  attentionFamilies = [];
  attentionTrigger = null;

  isOnBreak = true;

  // If a distraction episode led into this break, it ends here — the user
  // responded to it by taking a sanctioned break, not by disengaging further.
  finalizeDistractionEpisode(now);

  // Persisted immediately rather than on the next flush: the phase interval is
  // suspended during a break, so without this the scheduled distraction would
  // never learn the participant is on one, and could open the game mid-break.
  safeStorageGet("ff_session", (result) => {
    const existing = (result && result.ff_session) ?? {};
    safeStorageSet({ ff_session: { ...existing, isOnBreak: true } });
  });
}

// Break accounting is decided by the side panel (it knows the break's origin
// and duration) and arrives as flags:
//   countAsBreak — add to totalBreakMs (real breaks: prompt-path, or
//                  voluntary >= 30s; a shorter voluntary break is a false
//                  start, not a break)
//   countAsPause — tally a pause event (voluntary breaks only: they're
//                  self-initiated disengagement. Prompt-path breaks are
//                  never pauses — they're already represented as a
//                  distraction episode, and counting both would double-count
//                  one event)
function endBreak(breakMs, countAsBreak = true, countAsPause = false) {
  if (!isOnBreak) return;
  isOnBreak = false;
  if (countAsBreak) totalBreakMs += breakMs ?? 0;

  if (countAsPause && (breakMs ?? 0) > 0) {
    totalPauses++;
    lastPauseMs = breakMs;
    longestPauseMs = Math.max(longestPauseMs, breakMs);
  }

  // Don't let the break gap read as a typing pause, an idle stretch, or a
  // continuing burst once tracking resumes.
  lastKeyTime = null;
  burstStartTime = null;
  lastActivityTime = Date.now();
  // Clear the interaction window too: activity from before a ten-minute break
  // would otherwise sit in the 60s rolling window and make the Rate family
  // read a burst of pre-break activity as if it had just happened.
  activityTimeStamps = [];

  // Persist immediately — the user may finish the session before typing again.
  safeStorageGet("ff_session", (result) => {
    const existing = (result && result.ff_session) ?? {};
    safeStorageSet({ ff_session: { ...existing, totalBreakMs, totalPauses, longestPauseMs, isOnBreak: false } });
  });
}

function startIntervals() {
  // Periodic flush to chrome.storage.local
  flushIntervalId = setInterval(() => {
    if (!isTracking) return;
    if (!isExtensionContextValid()) { stopAllTracking(); return; }
    if (!isTyping) return; // Only log if there was activity since last flush
    isTyping = false;

    // Bring the time buckets up to now before reading them: this interval and
    // the phase interval are separate timers, so without this the durations
    // written here could lag by a full tick.
    bankElapsed();

    const scrollFreq = rollingScrollFrequency(); // to avoid recalculating multiple times during flush

    const payLoad = {
      // Keystroke
      wpm: rollingWPM(),
      wordCount: getLiveWordCount(), // doc words added this session (incl. paste), API-anchored
      typedWordCount: getTypedWordCount(), // keystroke-typed words only (excludes paste)
      docWordBaseline, // number only — survives reinjection so resume doesn't re-baseline
      totalDocWords, // exact whole-doc count from the last Docs API sync
      elapsedSeconds: elapsedSeconds(),

      // Pauses
      totalPauses,
      longestPauseMs,
      // Included here as well as in the pause interval's merge: this flush
      // REPLACES ff_session wholesale, so omitting it wiped the value every
      // time this ran (and syncWordCount sets isTyping, so it ran even with no
      // typing) — leaving the LLM to read "current pause: 0" mid-pause.
      currentPauseSec: lastKeyTime ? Math.round((Date.now() - lastKeyTime) / 1000) : 0,

      // Scroll
      scrollFrequency: scrollFreq,
      scrollFrequencyLabel: (() => {
        if (scrollFreq === 0) return "None";
        if (scrollFreq < 5)   return "Low";
        if (scrollFreq < 10)  return "Medium";
        return "High";
      })(),

      // Revision signals. The rolling pair drives the Reviewing rule live; the
      // totals are the session-lifetime counts that reach the export.
      deleteFrequency: rollingDeleteFrequency(),
      selectionFrequency: rollingSelectionFrequency(),
      totalDeletes,
      totalSelections,

      // Tab Switching
      tabSwitchCount,
      totalTabAwayMs,

      // Bursts
      currentBurstDurationSec: burstStartTime ? Math.round((Date.now() - burstStartTime) / 1000) : 0,
      burstCount,
      avgBurstDurationSec: burstCount > 0 ? Math.round(totalBurstDurationMs / burstCount / 1000) : 0,
      lastCompletedBurstSec: Math.round(lastCompletedBurstMs / 1000),

      // Phase channel — one of Planning | Translating | Reviewing, always.
      currentPhase: currentTrackedPhase ?? classifyPhase(scrollFreq),
      phaseDurationsMs,

      // Attention channel — evaluated against the current phase's baseline.
      currentAttention,
      attentionFamilies,
      attentionTrigger,
      distractedDurationsMs, // distracted time WITHIN each phase (a subset of the above)

      // Thresholds actually in force this session, so the export records what
      // the classification ran on rather than what it was assumed to run on.
      calibrationValid,
      calibrationProfileId,
      thresholds,

      // Distraction episodes
      distractionCount: distractionEpisodes.length,
      distractionOnsetCount,
      distractionEpisodes,
      activeDistraction, // in-progress episode — carried so a mid-distraction refresh doesn't drop it
      avgResumptionMs: getAvgResumptionMs(),

      // Docs API connection status (for the panel's connect indicator)
      docsConnected,

      // Breaks & interruptions
      totalBreakMs,
      totalInterruptedMs,
      // Must be in this payload, not only written by startBreak: this flush
      // REPLACES ff_session wholesale, and it keeps running during a break
      // (word-count syncs mark activity), so a flag held anywhere else would be
      // wiped within seconds and the scheduler would open the game mid-break.
      isOnBreak,

      lastUpdated: Date.now(),
    };

    safeStorageSet({ ff_session: payLoad });
  }, STORAGE_FLUSH_MS);

  // Interval specifically for currentPauseSec, runs regardless of activity
  pauseIntervalId = setInterval(() => {
    if (!isTracking) return;
    if (!isExtensionContextValid()) { stopAllTracking(); return; }
    if (!lastKeyTime) return;

    const currentPauseSec = Math.round((Date.now() - lastKeyTime) / 1000);
    if (currentPauseSec < 2) return; // don't log very short pauses

    safeStorageGet("ff_session", (result) => {
      const existing = result && result.ff_session;
      if (!existing) return; // no existing session data, skip
      safeStorageSet({
        ff_session: { ...existing, currentPauseSec }
      });
    });
  }, 2000);

  // Phase re-classification — runs unconditionally so silent pauses still
  // get re-classified (e.g. into "Distracted") instead of freezing the
  // phase at whatever it was during the last typing-triggered flush.
  phaseIntervalId = setInterval(() => {
    if (!isTracking) return;
    if (isOnBreak) return; // suspended during sanctioned breaks
    if (!isExtensionContextValid()) { stopAllTracking(); return; }

    updateState();
    flushPhaseToStorage();
  }, 2000);

  // Real word count sync via the Docs API (through background.js), on a 2s
  // cadence so the displayed count stays aligned with the exact Docs count.
  // An early first sync fills in a doc's existing word count right away
  // instead of waiting a full interval; the guard inside syncWordCount
  // handles early stops and prevents overlapping requests.
  wordSyncIntervalId = setInterval(syncWordCount, WORD_SYNC_INTERVAL_MS);
  setTimeout(syncWordCount, 800);

  // Idle watcher
  idleIntervalId = setInterval(() => {
    if (!isTracking) return;
    if (!isExtensionContextValid()) { stopAllTracking(); return; }

    const idleTime = Date.now() - lastActivityTime;
    if (idleTime >= 120000) {
      safeStorageSet({
        ff_idle: { duration: idleTime, since: lastActivityTime }
      });
    }
  }, 60000);
}


//------------------ Calibration ------------------------//
// Runs BEFORE any writing session, once per participant. isTracking stays false
// throughout, so calibration produces no ff_session data and cannot be confused
// with a study session — but it uses the same listeners, so the baseline and
// the measurements are produced by one code path.

function startCalibration() {
  calibrationMode = true;
  calibSegments = [];
  calibCurrent = null;

  // Clear the sensing state the segment statistics derive from. Without this,
  // keystrokes from before calibration would sit in the rolling WPM window and
  // inflate the first segment's opening samples.
  keyStrokeTimeStamps = [];
  lastKeyTime = null;
  burstStartTime = null;
  scrollTimeStamps = [];
  selectionTimeStamps = [];

  attachListenersOnce();

  // Sample rolling WPM on the SAME cadence and through the same function the
  // classifier uses. A baseline computed as total-words/total-time would not be
  // comparable to a threshold that will be tested against a 30s rolling window.
  calibSampleIntervalId = setInterval(() => {
    if (!calibrationMode) return;
    if (!isExtensionContextValid()) { stopCalibration(); return; }
    if (calibCurrent) calibCurrent.wpmSamples.push({ at: Date.now(), wpm: rollingWPM() });
  }, CALIB_SAMPLE_MS);

  console.log("FrictionFlow: calibration started.");
}

function beginCalibrationSegment(phase) {
  if (!calibrationMode) return;
  closeCalibrationSegment();
  calibCurrent = {
    phase,
    startedAt: Date.now(),
    endedAt: null,
    keys: [], deletes: [], scrolls: [], selections: [], bursts: [], wpmSamples: [],
  };
  console.log(`FrictionFlow: calibration segment "${phase}" started.`);
}

function closeCalibrationSegment() {
  if (!calibCurrent) return;
  calibCurrent.endedAt = Date.now();
  calibSegments.push(calibCurrent);
  calibCurrent = null;
}

function stopCalibration() {
  calibrationMode = false;
  calibCurrent = null;
  if (calibSampleIntervalId !== null) {
    clearInterval(calibSampleIntervalId);
    calibSampleIntervalId = null;
  }
}

// Reduces one recorded segment to the statistics the thresholds are built from.
// The first CALIB_WARMUP_MS of every segment is discarded: rolling WPM uses a
// 30s window, so at a segment boundary that window is either empty or still
// full of the PREVIOUS segment's keystrokes.
function summarizeSegment(seg) {
  const windowStart = seg.startedAt + CALIB_WARMUP_MS;
  const windowEnd = seg.endedAt ?? Date.now();
  const usableMs = Math.max(0, windowEnd - windowStart);
  const usableMin = usableMs / 60000;
  const inWindow = (arr) => arr.filter((t) => t >= windowStart && t <= windowEnd);

  const keys = inWindow(seg.keys);
  const deletes = inWindow(seg.deletes);
  const scrolls = inWindow(seg.scrolls);
  const selections = inWindow(seg.selections);

  // Pauses are gaps in the merged INTERACTION timeline — keystrokes, deletions,
  // scrolls and selection gestures together — not gaps between printable
  // keystrokes alone. This has to match what the threshold is tested against:
  // the Time family measures `now - lastActivityTime`, which every one of those
  // events resets. Deriving the threshold from keystroke gaps only would make
  // it systematically too high, because a stretch of deleting or scrolling
  // reads as one long "pause" during capture but as continuous activity at
  // runtime — worst exactly in Reviewing, where non-typing interaction is the
  // dominant behaviour.
  //
  // The 2s floor is not optional: raw gaps are dominated by within-word
  // intervals of 150-300ms, so a median over all gaps would measure typing
  // rhythm, and every statistic built on it would be meaningless. 2s is the
  // conventional keystroke-logging pause threshold (Leijten & Van Waes 2013).
  const interactions = [...keys, ...deletes, ...scrolls, ...selections].sort((a, b) => a - b);
  const pauses = [];
  for (let i = 1; i < interactions.length; i++) {
    const gap = interactions[i] - interactions[i - 1];
    if (gap >= CALIB_PAUSE_FLOOR_MS) pauses.push(gap / 1000);
  }

  const wpmSamples = seg.wpmSamples
    .filter((s) => s.at >= windowStart && s.at <= windowEnd)
    .map((s) => s.wpm);
  // Only bursts that BEGAN inside the usable window: one spanning the warm-up
  // boundary was partly produced under the previous segment's instruction.
  const bursts = seg.bursts
    .filter((b) => b.startedAt >= windowStart)
    .map((b) => b.durationMs / 1000);

  return {
    phase: seg.phase,
    durationSec: Math.round((windowEnd - seg.startedAt) / 1000),
    usableSec: Math.round(usableMs / 1000),
    keyCount: keys.length,
    medianWpm: median(wpmSamples) ?? 0,
    pauseCount: pauses.length,
    pauseMedianSec: median(pauses),
    pauseMadSec: mad(pauses),
    // Same merged timeline the pauses come from, so the Rate and Time families
    // are calibrated against one consistent definition of "interaction".
    activityRate: usableMin > 0 ? Math.round(interactions.length / usableMin) : 0,
    deleteRate: usableMin > 0 ? deletes.length / usableMin : 0,
    scrollRate: usableMin > 0 ? scrolls.length / usableMin : 0,
    medianBurstSec: median(bursts),
  };
}

// Turns the three segment summaries into the threshold set, applying the
// validity guards. Two grades of failure, deliberately: a phase with too few
// pauses falls back for THAT PHASE ONLY, while a participant who did not follow
// the instructions at all invalidates the whole profile.
function computeCalibrationProfile(participantId, testMode = false) {
  const byPhase = {};
  for (const seg of calibSegments) byPhase[seg.phase] = summarizeSegment(seg);

  const failures = [];
  const T = byPhase.Translating;
  const R = byPhase.Reviewing;
  if (!byPhase.Planning || !T || !R) failures.push("missing-segment");
  // Short-calibration runs exist to exercise the UI flow; their segments are far
  // too brief to characterise anyone. Rejected unconditionally so a researcher
  // who forgets to switch the setting off cannot silently run a participant on
  // a 90-second "profile" — the session falls back to documented defaults, and
  // the export says why.
  if (testMode) failures.push("test-mode-calibration");

  const idleSec = {};
  const activityRate = {};
  for (const phase of ["Planning", "Translating", "Reviewing"]) {
    const s = byPhase[phase];
    if (!s) {
      idleSec[phase] = DEFAULT_THRESHOLDS.idleSec[phase];
      activityRate[phase] = null;
      continue;
    }
    // null disables the Rate family for this phase rather than comparing
    // against a baseline of zero, which nothing could ever fall below.
    activityRate[phase] = s.activityRate > 0 ? s.activityRate : null;

    if (s.pauseCount < CALIB_MIN_PAUSES || !s.pauseMadSec) {
      idleSec[phase] = DEFAULT_THRESHOLDS.idleSec[phase];
      failures.push(`idle-fallback:${phase}`);
    } else {
      idleSec[phase] = Math.round(clamp(
        s.pauseMedianSec + CALIB_MAD_MULTIPLIER * s.pauseMadSec,
        CALIB_IDLE_MIN_SEC,
        CALIB_IDLE_MAX_SEC
      ));
    }
  }

  // Did not type faster while writing than while reviewing — the segments were
  // not followed, and every discriminating threshold below would be nonsense.
  if (T && R && T.medianWpm <= R.medianWpm) failures.push("translating-not-faster-than-reviewing");
  if (T && T.keyCount < CALIB_MIN_TRANSLATING_KEYS) failures.push("insufficient-text");

  // Per-phase idle fallbacks do not invalidate the profile: the rest of it is
  // still the participant's own data, and rejecting everything over one thin
  // segment would throw away good calibration.
  const valid = failures.every((f) => f.startsWith("idle-fallback"));

  const thresholds = valid
    ? {
        // Reviewing is Translating's nearest neighbour (both involve typing),
        // so it is the boundary that matters. For two classes of similar
        // spread, the midpoint of the means is the split that minimises
        // misclassification.
        wpmGate: Math.max(1, Math.round((T.medianWpm + R.medianWpm) / 2)),
        // Half a typical burst is enough evidence of being inside one. This is
        // what fixes the choppy-typist case: a writer whose bursts average 8s
        // would never reach Translating under a fixed 10s rule.
        burstMinSec: Math.round(clamp(
          0.5 * (T.medianBurstSec ?? DEFAULT_THRESHOLDS.burstMinSec * 2),
          CALIB_BURST_MIN_SEC,
          CALIB_BURST_MAX_SEC
        )),
        deleteGate: Math.max(1, Math.round((T.deleteRate + R.deleteRate) / 2)),
        scrollGate: Math.max(1, Math.round((T.scrollRate + R.scrollRate) / 2)),
        idleSec,
        activityRate,
      }
    : structuredClone(DEFAULT_THRESHOLDS);

  return {
    participantId: participantId ?? null,
    capturedAt: Date.now(),
    valid,
    testMode,
    failures,
    thresholds,
    // Every input to every threshold, kept so the derivation is auditable from
    // the exported data rather than taken on trust.
    segments: byPhase,
    // The three figures shown back to the participant (spec §10). Transparency
    // is a stated design commitment: the baseline must not be a hidden
    // internal parameter.
    display: valid
      ? {
          writingWpm: Math.round(T.medianWpm),
          reviewingWpm: Math.round(R.medianWpm),
          typicalPauseSec: idleSec.Translating,
        }
      : null,
  };
}

function finishCalibration(participantId, sendResponse, testMode = false) {
  closeCalibrationSegment();
  const profile = computeCalibrationProfile(participantId, testMode);
  stopCalibration();

  // Merge into the per-participant map rather than replacing it, so calibrating
  // a new participant cannot destroy an earlier one's baseline.
  safeStorageGet(CALIBRATION_STORE_KEY, (result) => {
    const store = { ...(result?.[CALIBRATION_STORE_KEY] ?? {}) };
    if (participantId) store[participantId] = profile;
    safeStorageSet({ [CALIBRATION_STORE_KEY]: store });
  });
  console.log(
    profile.valid
      ? `FrictionFlow: calibration complete for ${participantId} — WPM gate ${profile.thresholds.wpmGate}, idle ${JSON.stringify(profile.thresholds.idleSec)}.`
      : `FrictionFlow: calibration REJECTED (${profile.failures.join(", ")}) — session will run on default thresholds.`
  );
  if (typeof sendResponse === "function") sendResponse({ profile });
}


//------------------ Messages from popup ------------------------//
if (isExtensionContextValid()) {
  // Keep the scheduled-distraction mirror current as background.js opens and
  // closes the game.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && "ff_distraction" in changes) {
      scheduledDistraction = changes.ff_distraction.newValue ?? null;
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "FF_CALIB_START") {
      startCalibration();
    } else if (message?.type === "FF_CALIB_SEGMENT") {
      beginCalibrationSegment(message.phase);
    } else if (message?.type === "FF_CALIB_FINISH") {
      // Responds synchronously with the computed profile, so the results screen
      // can show the participant their own numbers without a storage round-trip.
      finishCalibration(message.participantId, sendResponse, message.testMode === true);
    } else if (message?.type === "FF_CALIB_CANCEL") {
      stopCalibration();
    } else if (message?.type === "FF_FLUSH_TRACE") {
      // Sent by the panel immediately before it reads storage at session end.
      // The trace is persisted every ~10s to keep the periodic writes cheap, so
      // without this the final few ticks — often the ones around the last
      // distraction — would never reach the export.
      flushTraceToStorage(() => sendResponse({ ok: true }));
      return true; // async sendResponse
    } else if (message?.type === "FF_START_TASK") {
      startTracking();
    } else if (message?.type === "FF_RESUME_TASK") {
      if (isTracking) {
        // Panel may have been closed mid-break; the UI is back at monitoring,
        // so make sure tracking isn't still suspended (the exact break length
        // is unrecoverable in that case — endBreak(0) just unpauses).
        endBreak(0);
      } else {
        // Freshly injected script (isTracking starts false) — restore
        // counters from the last snapshot and restart tracking.
        safeStorageGet(["ff_session", "ff_task", "ff_trace"], (result) => {
          resumeTracking(result?.ff_session, result?.ff_task, message.interruptedMs ?? 0, result?.ff_trace);
        });
      }
    } else if (message?.type === "FF_CANCEL_TASK") {
      stopTracking();
    } else if (message?.type === "FF_BREAK_START") {
      startBreak();
    } else if (message?.type === "FF_BREAK_END") {
      endBreak(message.breakMs ?? 0, message.countAsBreak ?? true, message.countAsPause ?? false);
    }
  });
}

console.log("FrictionFlow content script loaded — waiting for task start."); // console log for debugging
