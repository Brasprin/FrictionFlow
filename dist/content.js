//const LOGGING_ENABLED = false;

// Logs pauses and typing speed to chrome.storage.local
const PAUSE_THRESHOLD_MS = 30000;     // gap > 30s = pause
const WPM_WINDOW_MS = 30000;          // 60s window for WPM calculation
const STORAGE_FLUSH_MS = 2000;        // 2s interval to write to storage
const CHARS_PER_WORD = 5;             // Standard WPM definition
 
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
let isTyping = false;                  // when state change since last flush

// Scrolling Variables
let scrollTimeStamps = [];
let lastScrollTop = 0;
let scrollUpCount = 0;
let scrollDownCount = 0;

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
    scrollFrequency: rollingScrollFrequency(),
    scrollFrequencyLabel: (() => {
      const count = scrollTimeStamps.length;
      if (count === 0)  return "None";
      if (count < 5)   return "Low";
      if (count < 15)  return "Medium";
      return "High";
    })(),
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

console.log("FrictionFlow content script active — logging typing speed & pauses."); // console log for debugging
attachTypingListener(); // call attach typing listener function
attachScrollListener(); // call attach scroll listener function


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