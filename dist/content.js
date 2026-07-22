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
const DELETE_REVIEW_THRESHOLD = 5;        // >=5 deletions in the window (with low WPM) = revising,
                                          // not typo-fixing — flow typos co-occur with high WPM,
                                          // which the WPM gate already excludes
const SELECT_REVIEW_THRESHOLD = 2;        // >=2 distinct selection gestures in the window =
                                          // deliberate text manipulation, not a stray click


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

// Phase Duration Variables — accumulated ms spent in each classified phase
let phaseDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0, Distracted: 0 };
let currentTrackedPhase = null;
let phaseSegmentStartTime = null;

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

// Debounced: a held shift+arrow fires keydown repeats many times per second,
// but one continuous extend-the-selection motion is ONE gesture. Signals
// less than 1s apart merge into the previous gesture.
function pushSelectionSignal(now) {
  if (selectionTimeStamps.length === 0 || now - selectionTimeStamps[selectionTimeStamps.length - 1] > 1000) {
    selectionTimeStamps.push(now);
  }
  // Selecting text is engagement — keep it from reading as idle.
  lastActivityTime = now;
  isTyping = true;
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
      if (chrome.runtime.lastError) return; // keep approximation
      if (response && typeof response.wordCount === "number") {
        if (docWordBaseline === null) {
          // First sync: everything in the doc beyond what this session's
          // keystrokes account for was already there — that's the baseline.
          docWordBaseline = Math.max(0, response.wordCount - Math.round(netChars / CHARS_PER_WORD));
        }
        syncedWordCount = Math.max(0, response.wordCount - docWordBaseline);
        netCharsAtSync = netChars;
        totalDocWords = response.wordCount;
        isTyping = true; // make the next flush write the corrected count
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
function safeStorageSet(payload) {
  if (!isExtensionContextValid()) {
    stopAllTracking();
    return;
  }
  try {
    chrome.storage.local.set(payload);
  } catch (e) {
    // Context died between the check above and this call — stop here too.
    stopAllTracking();
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


//------------------ Phase Detection -------------------//
function classifyPhase(scrollFreq) {
  const now = Date.now();
  const currentPauseSec = lastKeyTime ? Math.round((now - lastKeyTime) / 1000) : 0;
  const currentBurstSec = burstStartTime ? Math.round((now - burstStartTime) / 1000) : 0;

  // Distracted — away from tab or long idle. Note: the phase (and with it
  // the Gentle Reminder) flips back as soon as the user returns to the doc,
  // but the distraction EPISODE stays open until the first keystroke — see
  // finalizeDistractionEpisode, called from the keydown handler. Phase
  // drives the UI; the episode drives the H1 resumption measurement.
  // A single tab-away is tolerated up to TAB_AWAY_THRESHOLD_MS (quick
  // reference checks shouldn't flag) — beyond that the away-stretch is
  // Distracted. While hidden, Chrome throttles our intervals to ~1/min,
  // which still evaluates this rule in time for any meaningful away-stretch;
  // repeated short hops are caught by the rapid-switch rule below instead.
  if (document.hidden && tabHiddenAt !== null && now - tabHiddenAt > TAB_AWAY_THRESHOLD_MS) return "Distracted";
  if (currentPauseSec > 120) return "Distracted";

  // Distracted — rapid tab switching: >= RAPID_SWITCH_THRESHOLD switches in
  // the rolling window means attention is fragmented even while on the doc
  // (a switch every ~20s never lets focus rebuild). WPM guard: a writer
  // typing at speed is Translating regardless of recent switches — without
  // it the panel would show "Distracted" through genuine writing.
  if (rollingTabSwitchFrequency() >= RAPID_SWITCH_THRESHOLD && rollingWPM() < 10) return "Distracted";

  // Reviewing — rereading OR revising while production typing is low:
  // heavy scrolling (evaluating a long doc), a run of deletions (pruning
  // text — flow typo-fixes co-occur with high WPM, which the gate excludes),
  // or repeated selection gestures (deliberate text manipulation). Any one
  // signal suffices; each threshold is individually meaningful.
  if (
    (scrollFreq >= 5 ||
      rollingDeleteFrequency() >= DELETE_REVIEW_THRESHOLD ||
      rollingSelectionFrequency() >= SELECT_REVIEW_THRESHOLD) &&
    rollingWPM() < 10
  ) return "Reviewing";

  // Planning — pausing but still on the doc, low WPM, short bursts
  if (currentPauseSec > 15 && rollingWPM() < 10) return "Planning";

  // Translating — actively typing, decent WPM, sustained burst
  if (rollingWPM() >= 10 && currentBurstSec >= 10) return "Translating";

  // Default fallback
  return "Planning";
}

// Re-classifies the phase and rolls the elapsed time since the last check
// into the previous phase's running total. Must be called on a fixed
// interval regardless of typing activity — otherwise a silent pause never
// gets re-classified (e.g. into "Distracted") because classifyPhase would
// only ever run inside the activity-gated flush.
function updatePhaseTracking() {
  const phase = classifyPhase(rollingScrollFrequency());
  const now = Date.now();

  if (currentTrackedPhase === null) {
    currentTrackedPhase = phase;
    phaseSegmentStartTime = now;
    if (phase === "Distracted") startDistractionEpisode(now);
    return;
  }

  if (phase !== currentTrackedPhase) {
    phaseDurationsMs[currentTrackedPhase] += now - phaseSegmentStartTime;

    // Entering Distracted opens an episode. Leaving Distracted does NOT
    // close it — the episode ends only at the first keystroke (see the
    // keydown handler), so resumptionMs measures actual writing resumption
    // even though the phase/UI flips back the moment the user returns.
    if (phase === "Distracted") {
      startDistractionEpisode(now);
    }

    currentTrackedPhase = phase;
    phaseSegmentStartTime = now;
  }
}

// triggerOverride is used by the retroactive tab-away catch in the
// visibilitychange handler, where document.hidden is already false again.
function startDistractionEpisode(now, triggerOverride) {
  if (activeDistraction) return;
  distractionOnsetCount++; // onset signal for the panel's per-episode re-arm
  activeDistraction = {
    startedAt: now,
    // Three causes, distinguished for the export: hidden tab, rapid
    // switching while visible, or a long idle pause on the doc.
    trigger: triggerOverride ?? (document.hidden
      ? "tab-away"
      : (rollingTabSwitchFrequency() >= RAPID_SWITCH_THRESHOLD ? "rapid-switch" : "idle")),
    returnedAt: null,
  };

  // Ask background to pre-generate a recovery summary for this episode so
  // it's ready by the time the user clicks "Get Back to Work". All gates
  // (intervention condition, cooldown, key configured) live in background —
  // this is fire-and-forget and must never affect tracking.
  try {
    chrome.runtime.sendMessage({ type: "FF_CHECK_STUCK" }, () => void chrome.runtime.lastError);
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
    // For tab-away episodes measure from the moment they came back to the
    // doc; for idle and rapid-switch episodes the user never left (or is
    // currently on the doc), so use the full episode.
    resumptionMs: ep.trigger === "tab-away" && ep.returnedAt ? now - ep.returnedAt : now - ep.startedAt,
  });
  activeDistraction = null;
}

// Returns accumulated phase durations including the in-progress segment,
// so reads reflect time up to "now" rather than the last phase transition.
function getPhaseDurationsMsSnapshot() {
  const snapshot = { ...phaseDurationsMs };
  if (currentTrackedPhase !== null && phaseSegmentStartTime !== null) {
    snapshot[currentTrackedPhase] += Date.now() - phaseSegmentStartTime;
  }
  return snapshot;
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
        phaseDurationsMs: getPhaseDurationsMsSnapshot(),
        distractionCount: distractionEpisodes.length,
        distractionOnsetCount,
        distractionEpisodes,
        activeDistraction, // persist the open episode so a resume can continue it
        avgResumptionMs: getAvgResumptionMs(),
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
    if (!isTracking) return; // ignore activity once tracking has stopped

    const now = Date.now();

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
        }
        burstStartTime = null; // reset burst start
      }
    }

    if (burstStartTime === null) {
      burstStartTime = now; // start new burst
    }

    lastKeyTime = now;
    lastActivityTime = now;
    isTyping = true;
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
    if (!isTracking) return; // ignore activity once tracking has stopped

    const currentScrollTop = editor.scrollTop;
    const delta = currentScrollTop - lastScrollTop;

    // may use in the future, for now just log total scroll distance and counts
    if (delta > 0) {
      scrollDownCount++;
    } else if (delta < 0) {
      scrollUpCount++;
    }

    lastScrollTop = currentScrollTop;
    lastActivityTime = Date.now();
    isTyping = true; // treat scrolling as activity for idle detection

    // Only push timestamp once per scroll burst, not on every raw event
    clearTimeout(scrollDebounceTimer);
    scrollDebounceTimer = setTimeout(() => {
      scrollTimeStamps.push(Date.now());
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
    if (!isTracking || !dragStart) return;
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    dragStart = null;
    if (moved > 8) pushSelectionSignal(Date.now()); // drag, not a plain caret click
  });

  editor.addEventListener("dblclick", () => {
    if (!isTracking) return;
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
        updatePhaseTracking();
        flushPhaseToStorage();
      }
    } else {
      // Retroactive catch: if Chrome throttled/froze our intervals while the
      // tab was hidden, an over-threshold away-stretch may never have been
      // classified. Flip the segment to Distracted here, backdated to when
      // the tolerance ran out, so the away time is attributed correctly.
      // Must run before tabHiddenAt is cleared.
      if (tabHiddenAt !== null && !isOnBreak) {
        const awayMs = Date.now() - tabHiddenAt;
        if (awayMs > TAB_AWAY_THRESHOLD_MS && currentTrackedPhase !== "Distracted") {
          const flipAt = tabHiddenAt + TAB_AWAY_THRESHOLD_MS;
          if (currentTrackedPhase !== null && phaseSegmentStartTime !== null) {
            phaseDurationsMs[currentTrackedPhase] += flipAt - phaseSegmentStartTime;
          }
          currentTrackedPhase = "Distracted";
          phaseSegmentStartTime = flipAt;
          startDistractionEpisode(flipAt, "tab-away");
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
      isTyping = true; // treat returning to tab as activity for idle detection

      // Re-sync on return too — if the tab was frozen while hidden, this is
      // the first chance to bank the away time into the phase durations.
      if (!isOnBreak) {
        updatePhaseTracking();
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

  phaseDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0, Distracted: 0 };
  currentTrackedPhase = null;
  phaseSegmentStartTime = null;

  distractionEpisodes = [];
  activeDistraction = null;
  distractionOnsetCount = 0;
}

function startTracking() {
  resetSessionState();
  isTracking = true;
  attachListenersOnce();
  startIntervals();
  console.log("FrictionFlow: tracking started.");
}

// Resumes tracking in a freshly injected content script (tab refresh,
// extension reload, or doc reopened after an interruption) by restoring
// accumulated counters from the last ff_session snapshot, so the session
// continues instead of restarting from zero. Callers must check isTracking
// first — if tracking is already alive, resuming would be a data-losing reset.
function resumeTracking(snapshot, task, interruptedMs = 0) {
  resetSessionState();

  // Keep the original session anchor so elapsed time stays continuous.
  if (task?.sessionStartTime) sessionStartTime = task.sessionStartTime;

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
      phaseDurationsMs = { ...phaseDurationsMs, ...snapshot.phaseDurationsMs };
    }
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

  isTracking = true;
  attachListenersOnce();
  startIntervals();

  // Persist the interruption total immediately — the participant may finish the
  // session before the first flush, and handleFinishSession reads it from the
  // ff_session snapshot.
  safeStorageGet("ff_session", (result) => {
    const existing = (result && result.ff_session) ?? {};
    safeStorageSet({ ff_session: { ...existing, totalInterruptedMs } });
  });

  console.log("FrictionFlow: tracking resumed from stored session snapshot.");
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
  isOnBreak = true;

  const now = Date.now();
  // Close out the current phase segment so break time isn't attributed to it.
  if (currentTrackedPhase !== null && phaseSegmentStartTime !== null) {
    phaseDurationsMs[currentTrackedPhase] += now - phaseSegmentStartTime;
  }
  currentTrackedPhase = null;
  phaseSegmentStartTime = null;

  // If a distraction episode led into this break, it ends here — the user
  // responded to it by taking a sanctioned break, not by disengaging further.
  finalizeDistractionEpisode(now);
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

  // Persist immediately — the user may finish the session before typing again.
  safeStorageGet("ff_session", (result) => {
    const existing = (result && result.ff_session) ?? {};
    safeStorageSet({ ff_session: { ...existing, totalBreakMs, totalPauses, longestPauseMs } });
  });
}

function startIntervals() {
  // Periodic flush to chrome.storage.local
  flushIntervalId = setInterval(() => {
    if (!isTracking) return;
    if (!isExtensionContextValid()) { stopAllTracking(); return; }
    if (!isTyping) return; // Only log if there was activity since last flush
    isTyping = false;

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

      // Scroll
      scrollFrequency: scrollFreq,
      scrollFrequencyLabel: (() => {
        if (scrollFreq === 0) return "None";
        if (scrollFreq < 5)   return "Low";
        if (scrollFreq < 10)  return "Medium";
        return "High";
      })(),

      // Revision signals (counts only — feeds Reviewing analysis in export)
      deleteFrequency: rollingDeleteFrequency(),
      selectionFrequency: rollingSelectionFrequency(),

      // Tab Switching
      tabSwitchCount,
      totalTabAwayMs,

      // Bursts
      currentBurstDurationSec: burstStartTime ? Math.round((Date.now() - burstStartTime) / 1000) : 0,
      burstCount,
      avgBurstDurationSec: burstCount > 0 ? Math.round(totalBurstDurationMs / burstCount / 1000) : 0,
      lastCompletedBurstSec: Math.round(lastCompletedBurstMs / 1000),

      // Phase
      currentPhase: currentTrackedPhase ?? classifyPhase(scrollFreq),
      phaseDurationsMs: getPhaseDurationsMsSnapshot(),

      // Distraction episodes
      distractionCount: distractionEpisodes.length,
      distractionOnsetCount,
      distractionEpisodes,
      activeDistraction, // in-progress episode — carried so a mid-distraction refresh doesn't drop it
      avgResumptionMs: getAvgResumptionMs(),

      // Breaks & interruptions
      totalBreakMs,
      totalInterruptedMs,

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

    updatePhaseTracking();
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


//------------------ Messages from popup ------------------------//
if (isExtensionContextValid()) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "FF_START_TASK") {
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
        safeStorageGet(["ff_session", "ff_task"], (result) => {
          resumeTracking(result?.ff_session, result?.ff_task, message.interruptedMs ?? 0);
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
