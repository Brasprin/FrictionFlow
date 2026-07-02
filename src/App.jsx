import { useState, useEffect, useRef } from "react";

// Sends a message to the Docs tab specifically (via the tabId stored on
// ff_task at session start), rather than "whichever tab is active right
// now" — the side panel stays open across tab switches, so the active tab
// is frequently not the Docs tab, which previously caused "Could not
// establish connection" errors when messaging the wrong tab.
function sendToTaskTab(message) {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.tabs) return;
  chrome.storage.local.get("ff_task", (result) => {
    const tabId = result.ff_task?.tabId;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Tab may have been closed or navigated away — background.js's
      // onRemoved/onUpdated listeners already handle marking the session
      // interrupted in that case, so this is safe to ignore here.
    });
  });
}

// Re-establishes tracking when a session is resumed. The content script may
// have been re-injected since the session started (tab refresh, extension
// reload, or the doc reopened in a new tab after an interruption), in which
// case its in-memory tracking state is gone even though the UI shows an
// active session. FF_RESUME_TASK is a no-op in a script that's still
// tracking, so this is always safe to send. If the doc was reopened in a
// different tab, the stored tabId is stale — adopt the active Docs tab as
// the new session tab first so background.js watches the right one.
function resumeTaskTracking() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.tabs) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const active = tabs[0];
    const isDocsTab = !!active?.url?.startsWith("https://docs.google.com/");
    chrome.storage.local.get("ff_task", (result) => {
      const task = result.ff_task;
      if (!task) return;
      if (isDocsTab && active.id !== task.tabId) {
        chrome.storage.local.set({ ff_task: { ...task, tabId: active.id } });
      }
      const targetId = isDocsTab ? active.id : task.tabId;
      if (!targetId) return;
      chrome.tabs.sendMessage(targetId, { type: "FF_RESUME_TASK" }).catch(() => {});
    });
  });
}

const TEAL = {
  50: "#E1F5EE",
  100: "#9FE1CB",
  200: "#5DCAA5",
  400: "#1D9E75",
  600: "#0F6E56",
  800: "#085041",
  900: "#04342C",
};

const styles = {
  root: {
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    background: "#F7FAF9",
    display: "flex",
    color: "#030213",
    width: "100%",
    height: "100vh",
  },
  content: {
    display: "flex",
    width: "100%",
    maxWidth: 420,
    margin: "0 auto",
  },
};

// ─── Shared Components ────────────────────────────────────────────────────────

function SidePanelHeader({ title, subtitle, status }) {
  return (
    <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: TEAL[400], display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4" stroke="#fff" strokeWidth="1.5" />
            <path d="M4 6l1.5 1.5L8 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#030213", letterSpacing: "-0.2px" }}>FrictionFlow</span>
        {status && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, color: TEAL[600], background: TEAL[50], padding: "2px 7px", borderRadius: 99 }}>{status}</span>}
      </div>
      {subtitle && <p style={{ fontSize: 11, color: "#717182", margin: 0 }}>{subtitle}</p>}
    </div>
  );
}

function Btn({ children, variant = "primary", onClick, style = {} }) {
  const base = { borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", padding: "9px 16px", transition: "opacity 0.15s", display: "flex", alignItems: "center", gap: 6, justifyContent: "center", ...style };
  if (variant === "primary") return <button style={{ ...base, background: TEAL[400], color: "#fff" }} onClick={onClick}>{children}</button>;
  if (variant === "outline") return <button style={{ ...base, background: "transparent", color: TEAL[600], border: `1px solid ${TEAL[200]}` }} onClick={onClick}>{children}</button>;
  if (variant === "ghost") return <button style={{ ...base, background: "transparent", color: "#717182", border: "1px solid rgba(0,0,0,0.1)" }} onClick={onClick}>{children}</button>;
  if (variant === "danger") return <button style={{ ...base, background: "transparent", color: "#d4183d", border: "1px solid rgba(212,24,61,0.25)" }} onClick={onClick}>{children}</button>;
}

// Placeholder until the Claude integration lands — both RecoveryScreen and
// ActiveMonitoringScreen's inline card read from this single mock so there's
// one source of truth to swap for real ff_recovery data later.
const MOCK_RECOVERY_SUMMARY = {
  whatYouWereDoing: "Actively drafting the body paragraphs — you were in a translating phase with a steady typing rhythm.",
  whereYouLeftOff: "“…artificial intelligence has begun reshaping traditional classroom paradigms, offering personalized learning pathways that adapt to—”",
  suggestions: [
    "Continue the sentence you were drafting about AI's personalization capabilities.",
    "Expand on the point about student engagement metrics from paragraph 2.",
    "Outline the counterargument section you planned in your objective.",
    "Review and revise the thesis statement before moving forward.",
  ],
};

function RecoverySummaryContent({ summary }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "11px 12px", border: "1px solid rgba(0,0,0,0.06)" }}>
          <p style={{ margin: "0 0 5px", fontSize: 11, fontWeight: 700, color: "#030213", textTransform: "uppercase", letterSpacing: "0.05em" }}>What you were doing</p>
          <p style={{ margin: 0, fontSize: 12, color: "#444", lineHeight: 1.6 }}>{summary.whatYouWereDoing}</p>
        </div>
        <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "11px 12px", border: "1px solid rgba(0,0,0,0.06)" }}>
          <p style={{ margin: "0 0 5px", fontSize: 11, fontWeight: 700, color: "#030213", textTransform: "uppercase", letterSpacing: "0.05em" }}>Where you left off</p>
          <p style={{ margin: 0, fontSize: 12, color: "#444", lineHeight: 1.6, fontStyle: "italic" }}>{summary.whereYouLeftOff}</p>
        </div>
      </div>
      <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Suggested next steps</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {summary.suggestions.map((s, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 9, padding: "9px 11px", border: `1px solid ${TEAL[100]}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ width: 18, height: 18, borderRadius: 999, background: TEAL[50], border: `1px solid ${TEAL[200]}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: TEAL[600] }}>{i + 1}</span>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "#444", lineHeight: 1.5 }}>{s}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Screen 1: Task Initialization ───────────────────────────────────────────

function TaskInitScreen({ onStart }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);
  // "baseline" = no recovery prompts (control condition); "intervention" =
  // recovery prompts enabled. This is the study's independent variable.
  const [condition, setCondition] = useState("intervention");

  const templates = [
    { name: "Research Essay", obj: "Write a 500-word essay on the impact of AI in education." },
    { name: "Lab Report", obj: "Summarize findings from Experiment 3 with discussion." },
    { name: "Reflection Paper", obj: "Reflect on this week's readings on cognitive load theory." },
  ];

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(["ff_task", "ff_interrupted"], (result) => {
        const t = result.ff_task;
        if (!t) return;
        setTaskName(t.taskName ?? "");
        setObjective(t.objective ?? "");
        setCondition(t.condition ?? "intervention");
        setIsActive(true);
        if (result.ff_interrupted) setIsInterrupted(true);
      });
    }
  }, []);

  function handleStartTask() {
    if (!taskName.trim()) return;

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id ?? null;

        const taskMetadata = {
          taskName,
          objective,
          condition,
          sessionStartTime: Date.now(),
          tabId, // stored so background.js can detect if this specific tab closes
        };

        // save metadata and clear previous data sessions
        chrome.storage.local.set({ ff_task: taskMetadata });
        chrome.storage.local.remove("ff_session");
        chrome.storage.local.remove("ff_idle");
        chrome.storage.local.remove("ff_interrupted");

        // FF_START_TASK is sent by ContextPrepScreen once the prep animation
        // finishes — tracking shouldn't begin until context prep completes.
      });
    }

    setIsActive(true);
    onStart("fresh"); // navigates to context preparation screen
  }

  function handleCancelTask() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      // Send before clearing ff_task — sendToTaskTab needs its tabId.
      sendToTaskTab({ type: "FF_CANCEL_TASK" });

      chrome.storage.local.remove("ff_task");
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");
      chrome.storage.local.remove("ff_interrupted");
    }

    setTaskName("");
    setObjective("");
    setIsActive(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle={isActive ? "Session in progress" : "Set up your writing session"} />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 0" }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, marginTop: 0 }}>Task name</p>
        <input
          value={taskName}
          onChange={e => !isActive && setTaskName(e.target.value)}
          placeholder="e.g. Research Essay Draft"
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#030213", outline: "none", marginBottom: 12, background: isActive ? TEAL[50] : "#FAFAFA", cursor: isActive ? "default" : "text" }}
        />
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Objective</p>
        <textarea
          value={objective}
          onChange={e => !isActive && setObjective(e.target.value)}
          placeholder="Briefly describe what you aim to accomplish in this session…"
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#030213", outline: "none", resize: "none", marginBottom: 12, background: isActive ? TEAL[50] : "#FAFAFA", fontFamily: "inherit", cursor: isActive ? "default" : "text" }}
        />
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Session condition</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button
            onClick={() => !isActive && setCondition("baseline")}
            disabled={isActive}
            style={{ flex: 1, textAlign: "center", cursor: isActive ? "default" : "pointer", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, border: `1px solid ${condition === "baseline" ? TEAL[400] : "rgba(0,0,0,0.12)"}`, background: condition === "baseline" ? TEAL[50] : "#FAFAFA", color: condition === "baseline" ? TEAL[800] : "#717182" }}>
            Baseline
          </button>
          <button
            onClick={() => !isActive && setCondition("intervention")}
            disabled={isActive}
            style={{ flex: 1, textAlign: "center", cursor: isActive ? "default" : "pointer", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, border: `1px solid ${condition === "intervention" ? TEAL[400] : "rgba(0,0,0,0.12)"}`, background: condition === "intervention" ? TEAL[50] : "#FAFAFA", color: condition === "intervention" ? TEAL[800] : "#717182" }}>
            Intervention
          </button>
        </div>
        <p style={{ margin: "-8px 0 14px", fontSize: 11, color: "#717182", lineHeight: 1.5 }}>
          {condition === "baseline"
            ? "No recovery prompts will appear — behavioral data is still logged."
            : "Recovery prompts appear when inactivity is detected."}
        </p>
        {!isActive && (
          <>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Quick templates</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {templates.map(t => (
                <button key={t.name} onClick={() => { setTaskName(t.name); setObjective(t.obj); }}
                  style={{ textAlign: "left", background: "#F7FAF9", border: `1px solid ${TEAL[100]}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TEAL[800] }}>{t.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#717182", marginTop: 2, lineHeight: 1.4 }}>{t.obj.slice(0, 50)}…</p>
                </button>
              ))}
            </div>
          </>
        )}
        {isActive && !isInterrupted && (
          <div style={{ background: TEAL[50], borderRadius: 10, padding: "10px 12px", border: `1px solid ${TEAL[100]}`, marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>Session is active. Cancel to start a new task.</p>
          </div>
        )}
        {isInterrupted && (
          <div style={{ background: "#FFF8F0", borderRadius: 10, padding: "10px 12px", border: "1px solid #FDDCB5", marginBottom: 14 }}>
            <p style={{ margin: "0 0 3px", fontSize: 11, fontWeight: 700, color: "#B45309" }}>Session interrupted</p>
            <p style={{ margin: 0, fontSize: 11, color: "#92400E", lineHeight: 1.5 }}>
              Your Google Docs tab was closed before the session finished. You can reopen the doc and resume, or cancel to start fresh.
            </p>
          </div>
        )}
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
        {isActive ? (
          <>
            <Btn variant="primary" style={{ width: "100%" }} onClick={() => onStart("resume")}>
              {isInterrupted ? "Resume session →" : "Resume session →"}
            </Btn>
            <Btn variant="danger" style={{ width: "100%" }} onClick={handleCancelTask}>
              {isInterrupted ? "Discard session" : "Cancel session"}
            </Btn>
          </>
        ) : (
          <Btn variant="primary" style={{ width: "100%" }} onClick={handleStartTask}>
            <svg width="14" height="14" fill="none" viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Start Task
          </Btn>
        )}
      </div>
    </div>
  );
}

// ─── Screen 1b: Context Preparation ──────────────────────────────────────────

function ContextPrepScreen({ setScreen }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  const [startTime, setStartTime] = useState(null);
  const [stage, setStage] = useState("building"); // "building" -> "connecting"

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_task", (result) => {
        const t = result.ff_task;
        if (!t) return;
        setTaskName(t.taskName ?? "");
        setObjective(t.objective ?? "");
        setStartTime(t.sessionStartTime ?? Date.now());
      });
    }
  }, []);

  // Simulated build → connect sequence, then hand off to content.js to
  // actually start tracking. Tracking intentionally begins here rather than
  // at "Start Task", since context prep is meant to complete first.
  useEffect(() => {
    const buildTimer = setTimeout(() => setStage("connecting"), 1300);
    const connectTimer = setTimeout(() => {
      sendToTaskTab({ type: "FF_START_TASK" });
      setScreen("monitoring");
    }, 2600);
    return () => {
      clearTimeout(buildTimer);
      clearTimeout(connectTimer);
    };
  }, [setScreen]);

  const formattedStart = startTime
    ? new Date(startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle="Preparing your session" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 24, textAlign: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, border: `3px solid ${TEAL[100]}`, borderTopColor: TEAL[400], animation: "spin 0.9s linear infinite", marginBottom: 18 }} />
        <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#030213" }}>{taskName || "Untitled task"}</p>
        {objective && <p style={{ margin: "0 0 14px", fontSize: 11, color: "#717182", lineHeight: 1.5, maxWidth: 230 }}>{objective}</p>}
        <div style={{ background: TEAL[50], borderRadius: 8, padding: "6px 12px", fontSize: 10, color: TEAL[600], marginBottom: 16 }}>
          Started at {formattedStart}
        </div>
        <p style={{ fontSize: 12, fontWeight: 600, color: TEAL[600], margin: 0 }}>
          {stage === "building" ? "Building context-aware focus model…" : "Connecting to Google Docs…"}
        </p>
      </div>
    </div>
  );
}

// ─── Screen 2: Active Monitoring ─────────────────────────────────────────────

// showDistractionPrompt/setShowDistractionPrompt/promptDismissedRef are lifted
// up to App and passed in as props — they must survive this component
// unmounting when navigating to Recovery/Break and remounting on return,
// otherwise a still-"Distracted" phase immediately re-triggers the modal.
function ActiveMonitoringScreen({ setScreen, setSummary, hasRecoverySummary, setHasRecoverySummary, showDistractionPrompt, setShowDistractionPrompt, promptDismissedRef }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState(null); // read once from ff_task
  const [elapsed, setElapsed] = useState(0);                      // calculated locally every second
  const [wpm, setWpm] = useState(0);
  const [words, setWords] = useState(0);
  const [totalPauses, setTotalPauses] = useState(0);
  const [longestPause, setLongestPause] = useState(0);
  const [scrollFrequency, setScrollFrequency] = useState(0);
  const [scrollFrequencyLabel, setScrollFrequencyLabel] = useState("None");
  const [currentPhase, setCurrentPhase] = useState("Planning");
  const [condition, setCondition] = useState("intervention");

  // Read sessionStartTime once from ff_task on mount so the timer can run locally.
  // This survives popup close/reopen since ff_task is in storage and never changes
  // mid-session — the popup just recalculates from the same anchor point.
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_task", (result) => {
        if (result.ff_task?.sessionStartTime) {
          setSessionStartTime(result.ff_task.sessionStartTime);
        }
      });
    }
  }, []);

  // Local timer — ticks every second regardless of what the user is doing.
  // No storage writes needed; just Date.now() - sessionStartTime.
  useEffect(() => {
    if (!sessionStartTime) return;
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [sessionStartTime]);

  // Poll ff_session every 2s for behavioral metrics from content.js
  useEffect(() => {
    function readStorage() {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.get(["ff_session", "ff_task"], (result) => {
          const s = result.ff_session;
          const t = result.ff_task;

          if (t) {
            setTaskName(t.taskName ?? "");
            setObjective(t.objective ?? "");
            setCondition(t.condition ?? "intervention");
          }

          if (!s) return;
          setWpm(s.wpm ?? 0);
          setWords(s.wordCount ?? 0);
          setTotalPauses(s.totalPauses ?? 0);
          setLongestPause(s.longestPauseMs ?? 0);
          setScrollFrequency(s.scrollFrequency ?? 0);
          setScrollFrequencyLabel(s.scrollFrequencyLabel ?? "None");
          setCurrentPhase(s.currentPhase ?? "Planning");

          // Auto-trigger the distraction prompt while the phase reads
          // "Distracted", once per episode — reset once the user leaves
          // that state (whether on their own or via the prompt). Behavioral
          // logging (phase classification) runs identically in both
          // conditions — only the baseline condition suppresses the prompt
          // itself, since that's the study's independent variable.
          const isBaseline = (t?.condition ?? "intervention") === "baseline";
          if (s.currentPhase === "Distracted") {
            if (!isBaseline && !promptDismissedRef.current) setShowDistractionPrompt(true);
          } else {
            promptDismissedRef.current = false;
            setShowDistractionPrompt(false);
          }
        });
      }
    }
    readStorage();
    const t = setInterval(readStorage, 2000);
    return () => clearInterval(t);
  }, [promptDismissedRef, setShowDistractionPrompt]);

  const mins = String(Math.floor(elapsed/60)).padStart(2,"0");
  const secs = String(elapsed%60).padStart(2,"0");
  const longestPauseSec = (longestPause / 1000).toFixed(1);
  const scrollFrequencyValue = scrollFrequency;

  const phaseConfig = {
  Planning:    { color: TEAL[100], desc: "thinking..." },
  Translating: { color: TEAL[400], desc: "drafting..." },
  Reviewing:   { color: TEAL[200], desc: "re-reading...." },
  Distracted:  { color: "#F4A261", desc: "away..." },
  };

  const activePhase = phaseConfig[currentPhase] ?? phaseConfig.Planning;

  // All three responses acknowledge the current distraction episode — none
  // of them should cause the modal to reappear until the phase leaves
  // "Distracted" and a new episode begins later.
  function handleGetBackToWork() {
    promptDismissedRef.current = true;
    setShowDistractionPrompt(false);
    setHasRecoverySummary(true);
    setScreen("recovery");
  }

  function handleTakeBreakFromPrompt() {
    promptDismissedRef.current = true;
    setShowDistractionPrompt(false);
    setScreen("break");
  }

  function handleDismissPrompt() {
    promptDismissedRef.current = true;
    setShowDistractionPrompt(false);
  }

  function handleFinishSession() {
    const finalElapsedSeconds = sessionStartTime
      ? Math.floor((Date.now() - sessionStartTime) / 1000)
      : elapsed;

    // Read the last ff_session snapshot to grab totalBreakMs/phaseDurationsMs before we clear storage
    function buildAndNavigate(totalBreakMs = 0, phaseDurationsMs = {}) {
      const finishedSummary = {
        taskName,
        condition,
        elapsedSeconds: finalElapsedSeconds,
        totalBreakMs,
        wordCount: words,
        wpm,
        totalPauses,
        longestPauseMs: longestPause,
        scrollFrequency,
        scrollFrequencyLabel,
        phaseDurationsMs,
      };
      setSummary(finishedSummary);

      if (typeof chrome !== "undefined" && chrome.storage) {
        // Send before clearing ff_task — sendToTaskTab needs its tabId.
        sendToTaskTab({ type: "FF_CANCEL_TASK" });

        chrome.storage.local.remove("ff_task");
        chrome.storage.local.remove("ff_session");
        chrome.storage.local.remove("ff_idle");
      }

      setScreen("analytics");
    }

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_session", (result) => {
        buildAndNavigate(result.ff_session?.totalBreakMs ?? 0, result.ff_session?.phaseDurationsMs ?? {});
      });
    } else {
      buildAndNavigate(0, {});
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <SidePanelHeader title="FrictionFlow" subtitle={condition === "baseline" ? `${taskName} · Baseline` : taskName} status={currentPhase} />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {/* Live stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Time", value: `${mins}:${secs}` },
            { label: "Words", value: words },
            { label: "WPM", value: wpm },
            { label: "Pauses", value: totalPauses },
            { label: "Longest Pause", value: `${longestPauseSec}s` },
            { label: "Scroll Frequency", value: `${scrollFrequencyLabel} (${scrollFrequency}/min)` },
          ].map(s => (
            <div key={s.label} style={{ background: "#F7FAF9", borderRadius: 10, padding: "10px 10px 8px", border: `1px solid ${TEAL[50]}` }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</p>
              <p style={{ margin: "3px 0 0", fontSize: 17, fontWeight: 700, color: TEAL[800] }}>{s.value}</p>
            </div>
          ))}
        </div>
        {/* Writing phase */}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Detected writing phase</p>
        <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "10px 12px", marginBottom: 14, border: `1px solid ${TEAL[50]}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: activePhase.color }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: TEAL[800] }}>{currentPhase}</span>
            <span style={{ fontSize: 11, color: "#717182" }}>— {activePhase.desc}</span>
          </div>
          <div style={{ display: "flex", height: 6, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ flex: 1, background: activePhase.color, transition: "background 0.5s" }} />
          </div>
        </div>
        {/* Task context */}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Active context</p>
        <div style={{ background: TEAL[50], borderRadius: 10, padding: "10px 12px", border: `1px solid ${TEAL[100]}`, marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TEAL[800] }}>{taskName}</p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>{objective}</p>
        </div>
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" style={{ flex: 1, fontSize: 12 }} onClick={() => setScreen("break")}>Take a break</Btn>
          <Btn variant="primary" style={{ flex: 1 }} onClick={handleFinishSession}>Finish session</Btn>
        </div>
        {hasRecoverySummary && (
          <button onClick={() => setScreen("recovery")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: TEAL[600], textDecoration: "underline", padding: 0, alignSelf: "center" }}>
            View last recovery summary
          </button>
        )}
      </div>
      {showDistractionPrompt && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(3,2,19,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "18px 18px 14px", width: "100%", maxWidth: 320, boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="14" height="14" fill="none" viewBox="0 0 14 14"><path d="M7 4v4M7 10h.01" stroke="#F4A261" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#030213" }}>Gentle Reminder</p>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#717182", lineHeight: 1.5 }}>
              Looks like you've drifted from "{taskName || "your task"}". Want a hand getting back into it?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Btn variant="primary" style={{ width: "100%" }} onClick={handleGetBackToWork}>Get Back to Work</Btn>
              <Btn variant="outline" style={{ width: "100%" }} onClick={handleTakeBreakFromPrompt}>Take a Break</Btn>
              <Btn variant="ghost" style={{ width: "100%" }} onClick={handleDismissPrompt}>Dismiss</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Screen 4: Recovery Interface ────────────────────────────────────────────

function RecoveryScreen({ setScreen }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_task", (result) => {
        const t = result.ff_task;
        if (!t) return;
        setTaskName(t.taskName ?? "");
        setObjective(t.objective ?? "");
      });
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle="Welcome back!" />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {/* Context summary */}
        <div style={{ background: TEAL[50], borderRadius: 12, padding: "12px 13px", marginBottom: 14, border: `1px solid ${TEAL[100]}` }}>
          <p style={{ margin: "0 0 3px", fontSize: 12, fontWeight: 700, color: TEAL[800] }}>{taskName || "Untitled task"}</p>
          <p style={{ margin: 0, fontSize: 11, color: TEAL[600] }}>{objective}</p>
        </div>
        <RecoverySummaryContent summary={MOCK_RECOVERY_SUMMARY} />
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn variant="primary" style={{ width: "100%" }} onClick={() => setScreen("monitoring")}>
          Continue where I left off →
        </Btn>
      </div>
    </div>
  );
}

// ─── Screen 5: Break Mode ─────────────────────────────────────────────────────

function BreakScreen({ setScreen, setHasRecoverySummary }) {
  const [secs, setSecs] = useState(0);
  const breakStartRef = useRef(Date.now()); // track when break started for totalBreakMs

  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  function handleContinue() {
    const breakMs = Date.now() - breakStartRef.current;

    // Tell content.js how long this break was so it can accumulate
    // totalBreakMs — logged in both conditions, this isn't the prompt itself.
    sendToTaskTab({ type: "FF_UPDATE_BREAK_MS", breakMs });

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_task", (result) => {
        const isBaseline = (result.ff_task?.condition ?? "intervention") === "baseline";
        if (isBaseline) {
          setScreen("monitoring");
        } else {
          setHasRecoverySummary(true);
          setScreen("recovery");
        }
      });
    } else {
      setHasRecoverySummary(true);
      setScreen("recovery");
    }
  }
  const activities = ["🧘 Breathe slowly", "🚶 Take a short walk", "💧 Drink some water", "👁 Rest your eyes"];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ textAlign: "center", padding: "20px 16px 4px" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: TEAL[50], border: `2px solid ${TEAL[100]}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <svg width="26" height="26" fill="none" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="10" stroke={TEAL[400]} strokeWidth="1.8" />
            <path d="M13 8v5l3 3" stroke={TEAL[400]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#030213" }}>Taking a break</p>
        <p style={{ margin: 0, fontSize: 12, color: "#717182" }}>Your session is paused</p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <div style={{ background: "#F7FAF9", borderRadius: 12, padding: "14px 28px", textAlign: "center", marginBottom: 18, border: `1px solid ${TEAL[50]}` }}>
          <p style={{ margin: 0, fontSize: 11, color: "#717182", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Break duration</p>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 700, color: TEAL[800], fontVariantNumeric: "tabular-nums" }}>
            {String(Math.floor(secs/60)).padStart(2,"0")}:{String(secs%60).padStart(2,"0")}
          </p>
        </div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, textAlign: "center" }}>Suggested activities</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activities.map(a => (
            <div key={a} style={{ background: TEAL[50], borderRadius: 8, padding: "8px 12px", fontSize: 12, color: TEAL[800], textAlign: "center", border: `1px solid ${TEAL[100]}` }}>{a}</div>
          ))}
        </div>
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <Btn variant="primary" style={{ width: "100%" }} onClick={handleContinue}>
          I'm ready to continue →
        </Btn>
      </div>
    </div>
  );
}

// ─── Screen 6: Session Analytics ─────────────────────────────────────────────

function AnalyticsScreen({ setScreen, summary }) {
  const s = summary ?? {};

  const totalSecs = s.elapsedSeconds ?? 0;
  const breakSecs = Math.floor((s.totalBreakMs ?? 0) / 1000);
  const writingSecs = Math.max(0, totalSecs - breakSecs);

  function fmt(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  // Stats backed by real tracked data from content.js
  const stats = [
    { label: "Total time",    value: fmt(totalSecs),   icon: "⏱" },
    { label: "Writing time",  value: fmt(writingSecs),  icon: "✍️" },
    { label: "Words written", value: s.wordCount ?? 0,  icon: "📝" },
    { label: "Avg. WPM",      value: s.wpm ?? 0,        icon: "⚡" },
    { label: "Pauses",        value: s.totalPauses ?? 0, icon: "⏸" },
    { label: "Break time",    value: fmt(breakSecs),    icon: "☕" },
    // NOTE: distraction count and recovery rate aren't tracked by content.js
    // yet — left out until that's added.
  ];
  const PHASE_COLORS = { Planning: TEAL[100], Translating: TEAL[400], Reviewing: TEAL[200], Distracted: "#F4A261" };
  const PHASE_ORDER = ["Planning", "Translating", "Reviewing", "Distracted"];

  const phaseDurationsMs = s.phaseDurationsMs ?? {};
  const totalPhaseMs = PHASE_ORDER.reduce((sum, label) => sum + (phaseDurationsMs[label] ?? 0), 0);

  const phases = totalPhaseMs > 0
    ? PHASE_ORDER
        .filter(label => (phaseDurationsMs[label] ?? 0) > 0)
        .map(label => ({
          label,
          pct: Math.round((phaseDurationsMs[label] / totalPhaseMs) * 100),
          color: PHASE_COLORS[label],
        }))
    : [];

  const dominantPhase = phases.length > 0
    ? phases.reduce((max, p) => (p.pct > max.pct ? p : max))
    : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)", textAlign: "center" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: TEAL[400], display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
            <path d="M2 12l4-4 3 3 5-7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, color: "#030213" }}>Session complete!</p>
        <p style={{ margin: 0, fontSize: 11, color: "#717182" }}>
          {s.taskName || "Untitled task"}{s.condition && ` · ${s.condition === "baseline" ? "Baseline" : "Intervention"}`}
        </p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 }}>
          {stats.map(st => (
            <div key={st.label} style={{ background: "#F7FAF9", borderRadius: 10, padding: "9px 10px", border: `1px solid ${TEAL[50]}` }}>
              <p style={{ margin: 0, fontSize: 16 }}>{st.icon}</p>
              <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700, color: TEAL[800] }}>{st.value}</p>
              <p style={{ margin: "1px 0 0", fontSize: 10, color: "#717182" }}>{st.label}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Time in writing phase</p>
        <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "10px 12px", marginBottom: 14, border: `1px solid ${TEAL[50]}` }}>
          {phases.length > 0 ? (
            <>
              <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", gap: 2, marginBottom: 8 }}>
                {phases.map(p => <div key={p.label} style={{ flex: p.pct, background: p.color }} />)}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {phases.map(p => (
                  <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
                    <span style={{ fontSize: 10, color: "#717182" }}>{p.label} {p.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 11, color: "#717182" }}>No phase data recorded for this session.</p>
          )}
        </div>
        <div style={{ background: TEAL[50], borderRadius: 10, padding: "10px 12px", border: `1px solid ${TEAL[100]}` }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: TEAL[800] }}>{dominantPhase ? "Great session!" : "Session complete"}</p>
          <p style={{ margin: 0, fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>
            {dominantPhase
              ? `You spent most of your time in the ${dominantPhase.label.toLowerCase()} phase${dominantPhase.label === "Translating" ? " — a sign of productive flow." : "."}`
              : "Start a new session to build up your phase breakdown."}
          </p>
        </div>
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <Btn variant="primary" style={{ width: "100%" }} onClick={() => setScreen("init")}>Start new task</Btn>
      </div>
    </div>
  );
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function PopupView({ screen, setScreen, summary, setSummary, hasRecoverySummary, setHasRecoverySummary, showDistractionPrompt, setShowDistractionPrompt, promptDismissedRef }) {
  const screenMap = {
    init: <TaskInitScreen onStart={(mode) => {
      setHasRecoverySummary(false);
      setShowDistractionPrompt(false);
      promptDismissedRef.current = false;
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.remove("ff_interrupted");
      }
      if (mode === "resume") {
        resumeTaskTracking(); // content script may have been re-injected — restart tracking
        setScreen("monitoring");
      } else {
        setScreen("contextPrep");
      }
    }}/>,
    contextPrep: <ContextPrepScreen setScreen={setScreen} />,
    monitoring: <ActiveMonitoringScreen
      setScreen={setScreen}
      setSummary={setSummary}
      hasRecoverySummary={hasRecoverySummary}
      setHasRecoverySummary={setHasRecoverySummary}
      showDistractionPrompt={showDistractionPrompt}
      setShowDistractionPrompt={setShowDistractionPrompt}
      promptDismissedRef={promptDismissedRef}
    />,
    recovery: <RecoveryScreen setScreen={setScreen} />,
    break: <BreakScreen setScreen={setScreen} setHasRecoverySummary={setHasRecoverySummary} />,
    analytics: <AnalyticsScreen setScreen={setScreen} summary={summary} />,
  };
  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {screenMap[screen]}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("init");
  const [summary, setSummary] = useState(null);
  const [hasRecoverySummary, setHasRecoverySummary] = useState(false);
  // Lifted here (rather than inside ActiveMonitoringScreen) so the
  // distraction-prompt acknowledgment survives navigating to Recovery/Break
  // and back to Monitoring, which otherwise unmounts and remounts that screen.
  const [showDistractionPrompt, setShowDistractionPrompt] = useState(false);
  const promptDismissedRef = useRef(false);

  // On popup open, check storage to decide the correct starting screen:
  // - ff_interrupted = true means the Docs tab was closed mid-session → init with interrupted notice
  // - ff_task exists (no interruption) → active session, go straight to monitoring
  // - neither → fresh start, stay on init
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(["ff_task", "ff_interrupted"], (result) => {
        if (result.ff_interrupted) {
          setScreen("init"); // TaskInitScreen reads ff_task and ff_interrupted to show the right UI
        } else if (result.ff_task) {
          // Panel reopened mid-session — tracking may have died if the
          // content script was re-injected since (safe no-op otherwise).
          resumeTaskTracking();
          setScreen("monitoring");
        }
      });
    }
  }, []);

  return (
    <div style={styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        button:hover { opacity: 0.85; }
      `}</style>
      {/* Content */}
      <div style={styles.content}>
        <PopupView
          screen={screen}
          setScreen={setScreen}
          summary={summary}
          setSummary={setSummary}
          hasRecoverySummary={hasRecoverySummary}
          setHasRecoverySummary={setHasRecoverySummary}
          showDistractionPrompt={showDistractionPrompt}
          setShowDistractionPrompt={setShowDistractionPrompt}
          promptDismissedRef={promptDismissedRef}
        />
      </div>
    </div>
  );
}
