const STUCK_THRESHOLD_SEC = 90;      // seconds before considering user stuck
const RECOVERY_COOLDOWN_MS = 180000; // 3 minutes before retriggering (doubling from 90s)

let lastRecoveryTime = null;
let isCallingClaude = false; // prevent concurrent API calls

//------------------ Message Listener ------------------//
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FF_CHECK_STUCK") {
    handleStuckCheck();
  }
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
    const recovery = await callClaude(session, task);
    await chrome.storage.local.set({ ff_recovery: recovery });
    chrome.runtime.sendMessage({ type: "FF_RECOVERY_READY" });
  } catch (err) {
    console.error("FrictionFlow Claude API error:", err);
  } finally {
    isCallingClaude = false;
  }
}

//------------------ Claude API Call -------------------//
async function callClaude(session, task) {
  const prompt = `You are helping a writer who is stuck. Analyze their behavioral data and writing goal, then provide recovery guidance.

TASK:
Name: ${task.taskName}
Objective: ${task.objective ?? "Not specified"}

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
    suggestedNextSteps: parsed.suggestedNextSteps,
    generatedAt: Date.now(),
  };
}