const STUCK_THRESHOLD_SEC = 90;      // seconds before considering user stuck
const RECOVERY_COOLDOWN_MS = 180000; // 3 minutes before retriggering (doubling from 90s)

let lastRecoveryTime = null;
let isCallingClaude = false; // prevent concurrent API calls


//------------------ Side Panel ------------------//
// Opens the side panel when the toolbar icon is clicked, since manifest.json
// no longer sets a default_popup. Called unconditionally (not just in
// onInstalled) so it's re-applied whenever the service worker restarts.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("FrictionFlow: sidePanel setup failed", error));


//------------------ Install ------------------//
chrome.runtime.onInstalled.addListener(() => {
  console.log("FrictionFlow installed");
});


//------------------ Message Listener ------------------//
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FF_CHECK_STUCK") {
    handleStuckCheck();
  } else if (message.type === "FF_ENSURE_DOCS_AUTH") {
    // Sent by the side panel at session connect so the one-time Google
    // consent popup happens at start, never mid-writing. Failure is fine —
    // doc reading degrades to keystroke approximation everywhere.
    getDocsAuthToken(true)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.warn("FrictionFlow: Docs API auth unavailable —", err.message);
        sendResponse({ ok: false });
      });
    return true; // async sendResponse
  } else if (message.type === "FF_SYNC_WORD_COUNT") {
    // content.js asks for the real word count. Only the count (a number)
    // leaves this function — the document text stays ephemeral in here.
    getTaskDocText()
      .then((text) => sendResponse({ wordCount: text === null ? null : countWords(text) }))
      .catch(() => sendResponse({ wordCount: null }));
    return true; // async sendResponse
  }
});


//------------------ Google Docs API (document reading) ------------------//
// Reads the actual document text via the official Docs API instead of
// approximating from keystrokes. Consent constraint: the text is ephemeral —
// it may be passed into an LLM prompt or reduced to a word count, but must
// NEVER be written to chrome.storage, logs, or exports.

function getDocsAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error(chrome.runtime.lastError?.message ?? "no auth token"));
        } else {
          resolve(token);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    try {
      chrome.identity.removeCachedAuthToken({ token }, resolve);
    } catch (e) {
      resolve();
    }
  });
}

function extractDocId(url) {
  const match = /https:\/\/docs\.google\.com\/document\/d\/([^/]+)/.exec(url ?? "");
  return match ? match[1] : null;
}

// Walks the Docs API structural-element tree (paragraphs, tables, ToCs)
// and concatenates the text runs into a plain string.
function extractTextFromStructuralElements(elements) {
  let text = "";
  for (const el of elements) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements ?? []) {
        if (pe.textRun?.content) text += pe.textRun.content;
      }
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          text += extractTextFromStructuralElements(cell.content ?? []);
        }
      }
    } else if (el.tableOfContents) {
      text += extractTextFromStructuralElements(el.tableOfContents.content ?? []);
    }
  }
  return text;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function fetchDocText(docId) {
  const docsGet = (token) =>
    fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=body`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  let token = await getDocsAuthToken(false);
  let res = await docsGet(token);

  // Cached tokens can expire — drop it and retry once with a fresh one.
  if (res.status === 401) {
    await removeCachedToken(token);
    token = await getDocsAuthToken(false);
    res = await docsGet(token);
  }

  if (!res.ok) throw new Error(`Docs API error: ${res.status}`);
  const doc = await res.json();
  return extractTextFromStructuralElements(doc.body?.content ?? []);
}

// Resolves the session doc from ff_task.tabId and returns its full text,
// or null on any failure (no task, tab gone, no auth, API error) so every
// caller degrades gracefully instead of blocking the writing session.
async function getTaskDocText() {
  const { ff_task: task } = await chrome.storage.local.get("ff_task");
  if (!task?.tabId) return null;

  let tab;
  try {
    tab = await chrome.tabs.get(task.tabId);
  } catch (e) {
    return null;
  }

  const docId = extractDocId(tab?.url);
  if (!docId) return null;

  try {
    return await fetchDocText(docId);
  } catch (e) {
    return null;
  }
}


//------------------ Tab Closure / Navigation Detection ------------------//
// Fires when any tab is closed. If it matches the session tab, mark interrupted.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get("ff_task", (result) => {
    const task = result.ff_task;
    if (!task) return;

    if (task.tabId === tabId) {
      chrome.storage.local.set({ ff_interrupted: true });
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");
      console.log("FrictionFlow: session tab closed — marked as interrupted.");
    }
  });
});

// Fires when a tab navigates to a new URL. If the session tab leaves Docs, mark interrupted.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;

  chrome.storage.local.get("ff_task", (result) => {
    const task = result.ff_task;
    if (!task) return;
    if (task.tabId !== tabId) return;

    const isStillOnDocs = changeInfo.url.startsWith("https://docs.google.com/");
    if (!isStillOnDocs) {
      chrome.storage.local.set({ ff_interrupted: true });
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");
      console.log("FrictionFlow: session tab left Docs — marked as interrupted.");
    }
  });
});


//------------------ Stuck Detection -------------------//
async function handleStuckCheck() {
  // Prevent concurrent calls
  if (isCallingClaude) return;

  // Enforce cooldown between recovery calls
  const now = Date.now();
  if (lastRecoveryTime && (now - lastRecoveryTime) < RECOVERY_COOLDOWN_MS) return;

  // Read session and task data
  const result = await chrome.storage.local.get(["ff_session", "ff_task"]);
  const session = result.ff_session;
  const task = result.ff_task;

  if (!session || !task) return;

  // Only trigger if user is in Planning phase and has been paused long enough
  if (session.currentPhase !== "Planning") return;
  if ((session.currentPauseSec ?? 0) < STUCK_THRESHOLD_SEC) return;

  // All conditions met — call Claude
  isCallingClaude = true;
  lastRecoveryTime = now;

  try {
    // Doc text is read fresh here, used only inside the prompt, and never
    // stored — ff_recovery holds only the generated summary.
    const docText = await getTaskDocText();
    const recovery = await callClaude(session, task, docText);
    await chrome.storage.local.set({ ff_recovery: recovery });
    chrome.runtime.sendMessage({ type: "FF_RECOVERY_READY" });
  } catch (err) {
    console.error("FrictionFlow Claude API error:", err);
  } finally {
    isCallingClaude = false;
  }
}


//------------------ Claude API Call -------------------//
async function callClaude(session, task, docText) {
  // Only the tail of the doc goes into the prompt — "where you left off"
  // lives at the end, and it keeps token cost bounded on long documents.
  const docExcerpt = docText ? docText.slice(-2000) : null;

  const prompt = `You are helping a writer who is stuck. Analyze their behavioral data and writing goal, then provide recovery guidance.

TASK:
Name: ${task.taskName}
Objective: ${task.objective ?? "Not specified"}
${docExcerpt ? `
DOCUMENT (the most recent portion of what they have written so far):
"""
${docExcerpt}
"""
` : ""}
BEHAVIORAL DATA:
- Current phase: ${session.currentPhase}
- Current pause: ${session.currentPauseSec ?? 0} seconds
- WPM (last 30s): ${session.wpm}
- Total pauses: ${session.totalPauses}
- Longest pause: ${Math.round((session.longestPauseMs ?? 0) / 1000)}s
- Burst count: ${session.burstCount}
- Avg burst duration: ${session.avgBurstDurationSec}s
- Scroll frequency: ${session.scrollFrequencyLabel}
- Tab switches: ${session.tabSwitchCount}
- Session time: ${Math.round((session.elapsedSeconds ?? 0) / 60)} minutes

Respond ONLY with a JSON object in this exact format, no markdown, no preamble:
{
  "condition": "one short phrase describing the writer's current state e.g. stuck on word choice, overwhelmed by scope, losing momentum",
  "whatYouWereDoing": "one sentence describing what the behavioral data suggests they were doing before getting stuck",
  "whereYouLeftOff": ${docExcerpt
    ? '"one sentence pointing at the last thing they wrote (quote a short fragment) so they can re-orient instantly"'
    : '"one sentence estimating where they were in the task based on timing and phase data"'},
  "suggestedNextSteps": [
    "specific actionable suggestion 1 tailored to their task",
    "specific actionable suggestion 2 tailored to their task",
    "specific actionable suggestion 3 tailored to their task"
  ]
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "",  // TODO: Insert your Anthropic API key here
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();
  const text = data.content[0].text;

  // Parse JSON response
  const parsed = JSON.parse(text);

  return {
    condition: parsed.condition,
    whatYouWereDoing: parsed.whatYouWereDoing,
    whereYouLeftOff: parsed.whereYouLeftOff,
    suggestedNextSteps: parsed.suggestedNextSteps,
    generatedAt: Date.now(),
  };
}