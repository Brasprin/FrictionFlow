//const LOGGING_ENABLED = false;

// Logs pauses and typing speed to chrome.storage.local
const PAUSE_THRESHOLD_MS = 30000;     // gap > 30s = pause
const WPM_WINDOW_MS = 30000;          // 60s window for WPM calculation
const STORAGE_FLUSH_MS = 2000;        // 2s interval to write to storage
const CHARS_PER_WORD = 5;             // Standard WPM definition
 
//------------------- State --------------------------//
let keyStrokeTimeStamps = [];         // Timestamps of keystrokes for WPM calculation
let netChars = 0;                    
let sessionStartTime = Date.now();    
let lastKeyTime = null;              
let lastActivityTime = Date.now();   

let totalPauses = 0;
let longestPauseMs = 0; 
let lastPauseMs = 0;
let isTyping = false;                  // when state change since last flush

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

function elapsedSeconds() {
  return Math.round((Date.now() - sessionStartTime) / 1000);
}

function getLiveWordCount() {
  return Math.max(0, Math.round(netChars / CHARS_PER_WORD));
}

//------------------ Event Listeners ------------------------//
// Google docs swallows events before they reach the document
function attachListener() {
  const docsInput = document.querySelector("iframe.docs-texteventtarget-iframe");
  if (!docsInput) {
    setTimeout(attachListener, 500);
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

    lastKeyTime = now;
    lastActivityTime = now;
    isTyping = true;
  });
}

attachListener(); // call attach listener function

// Periodic flush to chrome.local.storage
setInterval(() => {
  if (!isTyping) return; // Only log if there was activity since last flush
  isTyping = false;

  const payLoad = {
    wpm: rollingWPM(),
    wordCount: getLiveWordCount(),
    elapsedSeconds: elapsedSeconds(),
    totalPauses,
    longestPauseMs,
    lastUpdated: Date.now(),
  };

  chrome.storage.local.set({ff_session: payLoad});
}, STORAGE_FLUSH_MS);

// Idle watcher
setInterval(() => {
  const idleTime = Date.now() - lastActivityTime;
  if (idleTime >= 120000) {
    chrome.storage.local.set({
      ff_idle: {duration: idleTime, since: lastActivityTime}
    });
  }
}, 60000);

// Console log for debugging
console.log("FrictionFlow content script active — logging typing speed & pauses.");


// console.log("FrictionFlow behavioral logging active");


// document.addEventListener("visibilitychange", () => {
//   console.log("FrictionFlow Log:", {
//     type: document.hidden ? "tab_switch" : "tab_return"
//   });
// });


// setInterval(() => {
//   const idle = Date.now() - lastActivityTime;

//   if (idle > 10000) {
//     console.log("FrictionFlow Log:", {
//       type: "idle",
//       duration: idle
//     });
//   }
// }, 5000);


// document.addEventListener("keydown", (e) => {
//   const now = Date.now();

//   if (isPrintable(e.key)) {
//     keyStrokeTimeStamps.push(now);
//     if(e.key === " ") wordCount++;
//   }

//   // Pause detection if gap exceeds threshold
//   if (lastKeyTime !== null) {
//     const gap = now - lastKeyTime;
//     if (gap >= PAUSE_THRESHOLD_MS) {
//       totalPauses++;
//       lastPauseMs = gap;
//       longestPauseMs = Math.max(longestPauseMs, gap);  
//     }
//   }

//   lastKeyTime = now;
//   lastActivityTime = now;
//   isTyping = true;

// });