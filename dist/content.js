//const LOGGING_ENABLED = false;

// Logs behavioral data to chrome.storage.local
const PAUSE_THRESHOLD_MS = 30000;         // gap > 30s = pause
const WPM_WINDOW_MS = 30000;              // 60s window for WPM calculation
const STORAGE_FLUSH_MS = 2000;            // 2s interval to write to storage
const CHARS_PER_WORD = 5;                 // Standard WPM definition
const BURST_END_THRESHOLD_MS = 10000;     // 10s of inactivity ends a typing burst
const BURST_MIN_DURATION_MS = 10000;     // Minimum 10s of activity to consider a burst 

//------------------- State --------------------------//
// KeyStroke Variables
let keyStrokeTimeStamps = [];         // Timestamps of keystrokes for WPM calculation
let netChars = 0;                    
let sessionStartTime = Date.now();    
let lastKeyTime = null;              
let lastActivityTime = Date.now();   

// Pause Variables
let totalPauses = 0;
let longestPauseMs = 0; 
let lastPauseMs = 0;
let isTyping = false;   // when state change since last flush

// Scrolling Variables
let scrollTimeStamps = [];
let lastScrollTop = 0;
let scrollUpCount = 0;
let scrollDownCount = 0;

// Tab Switch Varibales
let tabSwitchCount = 0; 
let lastTabSwitchTime = null;   // currently not used, but may be useful for future analysis of tab switch patterns
let totalTabAwayMs = 0;
let tabHiddenAt = null; 
 
// Burst Variables
let burstStartTime = null;
let burstCount = 0;
let totalBurstDurationMs = 0; 
let lastCompletedBurstMs = 0;

//------------------- Helper -----------------------------//
function isPrintable(key) {
  return key.length === 1;
}

function rollingWPM() {
  const cutOff = Date.now() - WPM_WINDOW_MS;
  while (keyStrokeTimeStamps.length > 0 && keyStrokeTimeStamps[0] < cutOff) {
    keyStrokeTimeStamps.shift();
  } 
  return Math.round(keyStrokeTimeStamps.length / CHARS_PER_WORD);
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

//------------------ Phase Detection -------------------//
function classifyPhase(scrollFreq) {
  const now = Date.now();
  const currentPauseSec = lastKeyTime ? Math.round((now - lastKeyTime) / 1000) : 0;
  const currentBurstSec = burstStartTime ? Math.round((now - burstStartTime) / 1000) : 0;

  // Distracted — away from tab or long idle
  if (document.hidden) return "Distracted";
  if (currentPauseSec > 120) return "Distracted";

  // Reviewing — scrolling a lot with low typing
  if (scrollFreq >= 5 && rollingWPM() < 10) return "Reviewing";

  // Planning — pausing but still on the doc, low WPM, short bursts
  if (currentPauseSec > 15 && rollingWPM() < 10) return "Planning";

  // Translating — actively typing, decent WPM, sustained burst
  if (rollingWPM() >= 10 && currentBurstSec >= 10) return "Translating";

  // Default fallback
  return "Planning";
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
    if (document.hidden) {
      tabSwitchCount++;
      tabHiddenAt = Date.now();
      lastTabSwitchTime = Date.now();
    } else {
      if (tabHiddenAt !== null) {
        totalTabAwayMs += Date.now() - tabHiddenAt;
        tabHiddenAt = null;
      }
      isTyping = true; // treat returning to tab as activity for idle detection
    }
  })
}

// Periodic flush to chrome.local.storage
setInterval(() => {
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
      if (scrollFreq === 0)  return "None";
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
    currentPhase: classifyPhase(scrollFreq),

    lastUpdated: Date.now(),
  };

  chrome.storage.local.set({ff_session: payLoad});
}, STORAGE_FLUSH_MS);

// Interval specifically for currentPauseSec, runs regardless of activity
setInterval(() => {
  if (!lastKeyTime) return;

  const currentPauseSec = Math.round((Date.now() - lastKeyTime) / 1000);
  if (currentPauseSec < 2) return; // don't log very short pauses
  
  chrome.storage.local.get("ff_session", (result) => {
    const existing = result.ff_session;
    if (!existing) return; // no existing session data, skip
    chrome.storage.local.set({
      ff_session: { ...existing, currentPauseSec }
    });
  });
}, 2000);

// Idle watcher
setInterval(() => {
  const idleTime = Date.now() - lastActivityTime;
  if (idleTime >= 120000) {
    chrome.storage.local.set({
      ff_idle: {duration: idleTime, since: lastActivityTime}
    });
  }
}, 60000);

console.log("FrictionFlow content script active — logging typing speed & pauses."); // console log for debugging
attachTypingListener(); // call attach typing listener function
attachScrollListener(); // call attach scroll listener function
attachTabSwitchListener(); // call attach tab switch listener function