//const LOGGING_ENABLED = false;

// Logs behavioral data to chrome.storage.local
const PAUSE_THRESHOLD_MS = 30000;         // gap > 30s = pause
const WPM_WINDOW_MS = 30000;              // rolling window for WPM calculation
const STORAGE_FLUSH_MS = 2000;            // 2s interval to write to storage
const CHARS_PER_WORD = 5;                 // Standard WPM definition
const BURST_END_THRESHOLD_MS = 10000;     // 10s of inactivity ends a typing burst
const BURST_MIN_DURATION_MS = 10000;      // Minimum 10s of activity to consider a burst


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

// Scrolling Variables
let scrollTimeStamps = [];
let lastScrollTop = 0;
let scrollUpCount = 0;
let scrollDownCount = 0;

// Tab Switch Variables
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

// Interval handles — needed so we can clear them on extension context invalidation
let flushIntervalId = null;
let pauseIntervalId = null;
let idleIntervalId = null;
let phaseIntervalId = null;


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
  return Math.max(0, Math.round(netChars / CHARS_PER_WORD));
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
  flushIntervalId = null;
  pauseIntervalId = null;
  idleIntervalId = null;
  phaseIntervalId = null;

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

  // Distracted — away from tab or long idle
  // TODO revert: threshold temporarily dropped from 120 to 2 for manual testing
  if (document.hidden) return "Distracted";
  if (currentPauseSec > 2) return "Distracted";

  // Reviewing — scrolling a lot with low typing
  if (scrollFreq >= 5 && rollingWPM() < 10) return "Reviewing";

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

    // Episode bookkeeping on the Distracted boundary (check before
    // reassigning currentTrackedPhase — it still holds the previous phase).
    if (phase === "Distracted") {
      startDistractionEpisode(now);
    } else if (currentTrackedPhase === "Distracted") {
      finalizeDistractionEpisode(now);
    }

    currentTrackedPhase = phase;
    phaseSegmentStartTime = now;
  }
}

function startDistractionEpisode(now) {
  if (activeDistraction) return;
  activeDistraction = {
    startedAt: now,
    trigger: document.hidden ? "tab-away" : "idle",
    returnedAt: null,
  };
}

// Called when the phase leaves "Distracted" — which only happens once the
// user types again (or scrolls enough), so `now` marks task resumption.
function finalizeDistractionEpisode(now) {
  if (!activeDistraction) return;
  const ep = activeDistraction;
  distractionEpisodes.push({
    startedAt: ep.startedAt,
    endedAt: now,
    durationMs: now - ep.startedAt,
    trigger: ep.trigger,
    // For tab-away episodes measure from the moment they came back to the
    // doc; for idle episodes the user never left, so use the full episode.
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

    if (isPrintable(e.key)) {
      keyStrokeTimeStamps.push(now);
      netChars++;
    } else if (e.key === "Backspace" || e.key === "Delete") {
      netChars = Math.max(0, netChars - 1);
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

function attachTabSwitchListener() {
  document.addEventListener("visibilitychange", () => {
    if (!isTracking) return; // ignore activity once tracking has stopped

    if (document.hidden) {
      tabSwitchCount++;
      tabHiddenAt = Date.now();
      lastTabSwitchTime = Date.now();
    } else {
      if (tabHiddenAt !== null) {
        totalTabAwayMs += Date.now() - tabHiddenAt;
        tabHiddenAt = null;
      }
      // Mark when the user came back to the doc so resumptionMs can measure
      // return-to-doc → typing-resumed, not the whole time away.
      if (activeDistraction && activeDistraction.trigger === "tab-away" && activeDistraction.returnedAt === null) {
        activeDistraction.returnedAt = Date.now();
      }
      isTyping = true; // treat returning to tab as activity for idle detection
    }
  });
}

function attachListenersOnce() {
  if (listenerAttached) return;
  listenerAttached = true;

  attachTypingListener();
  attachScrollListener();
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

  scrollTimeStamps = [];
  lastScrollTop = 0;
  scrollUpCount = 0;
  scrollDownCount = 0;

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

  phaseDurationsMs = { Planning: 0, Translating: 0, Reviewing: 0, Distracted: 0 };
  currentTrackedPhase = null;
  phaseSegmentStartTime = null;

  distractionEpisodes = [];
  activeDistraction = null;
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
function resumeTracking(snapshot, task) {
  resetSessionState();

  // Keep the original session anchor so elapsed time stays continuous.
  if (task?.sessionStartTime) sessionStartTime = task.sessionStartTime;

  if (snapshot) {
    netChars = (snapshot.wordCount ?? 0) * CHARS_PER_WORD;
    totalPauses = snapshot.totalPauses ?? 0;
    longestPauseMs = snapshot.longestPauseMs ?? 0;
    tabSwitchCount = snapshot.tabSwitchCount ?? 0;
    totalTabAwayMs = snapshot.totalTabAwayMs ?? 0;
    burstCount = snapshot.burstCount ?? 0;
    totalBurstDurationMs = (snapshot.avgBurstDurationSec ?? 0) * 1000 * burstCount;
    lastCompletedBurstMs = (snapshot.lastCompletedBurstSec ?? 0) * 1000;
    totalBreakMs = snapshot.totalBreakMs ?? 0;
    if (snapshot.phaseDurationsMs) {
      phaseDurationsMs = { ...phaseDurationsMs, ...snapshot.phaseDurationsMs };
    }
    distractionEpisodes = snapshot.distractionEpisodes ?? [];
  }

  isTracking = true;
  attachListenersOnce();
  startIntervals();
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

function endBreak(breakMs) {
  if (!isOnBreak) return;
  isOnBreak = false;
  totalBreakMs += breakMs ?? 0;

  // Don't let the break gap read as a typing pause, an idle stretch, or a
  // continuing burst once tracking resumes.
  lastKeyTime = null;
  burstStartTime = null;
  lastActivityTime = Date.now();

  // Persist immediately — the user may finish the session before typing again.
  safeStorageGet("ff_session", (result) => {
    const existing = (result && result.ff_session) ?? {};
    safeStorageSet({ ff_session: { ...existing, totalBreakMs } });
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
      wordCount: getLiveWordCount(),
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
      distractionEpisodes,
      avgResumptionMs: getAvgResumptionMs(),

      // Breaks
      totalBreakMs,

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

    safeStorageGet("ff_session", (result) => {
      const existing = (result && result.ff_session) ?? {};
      safeStorageSet({
        ff_session: {
          ...existing,
          currentPhase: currentTrackedPhase,
          phaseDurationsMs: getPhaseDurationsMsSnapshot(),
          distractionCount: distractionEpisodes.length,
          distractionEpisodes,
          avgResumptionMs: getAvgResumptionMs(),
        }
      });
    });
  }, 2000);

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
          resumeTracking(result?.ff_session, result?.ff_task);
        });
      }
    } else if (message?.type === "FF_CANCEL_TASK") {
      stopTracking();
    } else if (message?.type === "FF_BREAK_START") {
      startBreak();
    } else if (message?.type === "FF_BREAK_END") {
      endBreak(message.breakMs ?? 0);
    }
  });
}

console.log("FrictionFlow content script loaded — waiting for task start."); // console log for debugging
