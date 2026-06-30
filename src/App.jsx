import { useState, useEffect, useRef } from "react";

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
  },
  content: {
    display: "flex",
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

// ─── Screen 1: Task Initialization ───────────────────────────────────────────

function TaskInitScreen({ onStart }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  const [isActive, setIsActive] = useState(false);

  const templates = [
    { name: "Research Essay", obj: "Write a 500-word essay on the impact of AI in education." },
    { name: "Lab Report", obj: "Summarize findings from Experiment 3 with discussion." },
    { name: "Reflection Paper", obj: "Reflect on this week's readings on cognitive load theory." },
  ];

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_task", (result) => {
        const t = result.ff_task;
        if (!t) return;
        setTaskName(t.taskName ?? "");
        setObjective(t.objective ?? "");
        setIsActive(true); 
      })
    }
  }, []);

  function handleStartTask() {
    if (!taskName.trim()) return;

    const taskMetadata = {
      taskName, 
      objective,
      sessionStartTime: Date.now(),
    };

    if (typeof chrome !== "undefined" && chrome.storage) {
      // save metadata and clear previous data sessions
      chrome.storage.local.set({ ff_task: taskMetadata });
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");

      // Tell content script to start tracking
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "FF_START_TASK" });
        }
      });
    }

    setIsActive(true);
    onStart();  // navigates to active monitoring screen
  }

  function handleCancelTask() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.remove("ff_task");
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");
    
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "FF_CANCEL_TASK" });
      }
      });
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
        {isActive && (
          <div style={{ background: TEAL[50], borderRadius: 10, padding: "10px 12px", border: `1px solid ${TEAL[100]}`, marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>Session is active. Cancel to start a new task.</p>
          </div>
        )}
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
        {isActive ? (
          <>
            <Btn variant="primary" style={{ width: "100%" }} onClick={onStart}>
              Resume session →
            </Btn>
            <Btn variant="danger" style={{ width: "100%" }} onClick={handleCancelTask}>
              Cancel session
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

// ─── Screen 2: Active Monitoring ─────────────────────────────────────────────

function ActiveMonitoringScreen({ setScreen, setSummary, hasRecoverySummary }) {
  const [taskName, setTaskName] = useState("Research Essay Draft");
  const [wpm, setWpm] = useState(0);
  const [words, setWords] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalPauses, setTotalPauses] = useState(0);
  const [longestPause, setLongestPause] = useState(0);
  const [scrollFrequency, setScrollFrequency] = useState(0);
  const [scrollFrequencyLabel, setScrollFrequencyLabel] = useState("None");
  const [currentPhase, setCurrentPhase] = useState("Planning");

  // Poll chrome.storage.local every 2s to get current metrics 
  useEffect(() => {
    function readStorage() {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.get(["ff_session", "ff_task"], (result) => {
          const s = result.ff_session;
          const t = result.ff_task;

          if(t) setTaskName(t.taskName ?? "");

          if (!s) return;
          setWpm(s.wpm ?? 0);
          setWords(s.wordCount ?? 0);
          setElapsed(s.elapsedSeconds ?? 0);
          setTotalPauses(s.totalPauses ?? 0);
          setLongestPause(s.longestPauseMs ?? 0);
          setScrollFrequency(s.scrollFrequency ?? 0);
          setScrollFrequencyLabel(s.scrollFrequencyLabel ?? "None");
          setCurrentPhase(s.currentPhase ?? "Planning");
        })
      }
    } 
    readStorage();
    const t = setInterval(readStorage, 2000);
    return () => clearInterval(t);
  }, []);

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

  function handleFinishSession() {
    // Snapshot the current live stats into a summary object before storage is cleared.
    const finishedSummary = {
      taskName,
      elapsedSeconds: elapsed,
      wordCount: words,
      wpm,
      totalPauses,
      longestPauseMs: longestPause,
      scrollFrequency,
      scrollFrequencyLabel,
    };
    setSummary(finishedSummary);

    if (typeof chrome !== "undefined" && chrome.storage) {
      // Session is truly over — clear stored task/session/idle data so the
      // init screen starts blank next time, not in a "Resume session" state.
      chrome.storage.local.remove("ff_task");
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");

      // Tell content script to stop tracking
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "FF_CANCEL_TASK" });
        }
      });
    }

    setScreen("analytics");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle={taskName} status={currentPhase} />
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
          <p style={{ margin: "4px 0 0", fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>Write a 500-word essay on the impact of AI in education.</p>
        </div>
        {/* Recent activity */}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Last paragraph</p>
        <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(0,0,0,0.06)", fontSize: 11, color: "#444", lineHeight: 1.6 }}>
          "…artificial intelligence has begun reshaping traditional classroom paradigms, offering personalized learning pathways that adapt to—"
          <span style={{ display: "inline-block", width: 2, height: 12, background: TEAL[400], marginLeft: 2, verticalAlign: "middle", animation: "blink 1s infinite" }} />
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
    </div>
  );
}

// ─── Screen 4: Recovery Interface ────────────────────────────────────────────

function RecoveryScreen({ setScreen }) {
  const suggestions = [
    "Continue the sentence you were drafting about AI's personalization capabilities.",
    "Expand on the point about student engagement metrics from paragraph 2.",
    "Outline the counterargument section you planned in your objective.",
    "Review and revise the thesis statement before moving forward.",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle="Welcome back!" />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {/* Context summary */}
        <div style={{ background: TEAL[50], borderRadius: 12, padding: "12px 13px", marginBottom: 14, border: `1px solid ${TEAL[100]}` }}>
          <p style={{ margin: "0 0 3px", fontSize: 12, fontWeight: 700, color: TEAL[800] }}>Research Essay Draft</p>
          <p style={{ margin: 0, fontSize: 11, color: TEAL[600] }}>Write a 500-word essay on the impact of AI in education.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "11px 12px", border: "1px solid rgba(0,0,0,0.06)" }}>
            <p style={{ margin: "0 0 5px", fontSize: 11, fontWeight: 700, color: "#030213", textTransform: "uppercase", letterSpacing: "0.05em" }}>What you were doing</p>
            <p style={{ margin: 0, fontSize: 12, color: "#444", lineHeight: 1.6 }}>Actively drafting the body paragraphs — you were in a translating phase with a steady typing rhythm.</p>
          </div>
          <div style={{ background: "#F7FAF9", borderRadius: 10, padding: "11px 12px", border: "1px solid rgba(0,0,0,0.06)" }}>
            <p style={{ margin: "0 0 5px", fontSize: 11, fontWeight: 700, color: "#030213", textTransform: "uppercase", letterSpacing: "0.05em" }}>Where you left off</p>
            <p style={{ margin: 0, fontSize: 12, color: "#444", lineHeight: 1.6, fontStyle: "italic" }}>"…artificial intelligence has begun reshaping traditional classroom paradigms, offering personalized learning pathways that adapt to—"</p>
          </div>
        </div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Suggested next steps</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {suggestions.map((s, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 9, padding: "9px 11px", border: `1px solid ${TEAL[100]}`, display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <div style={{ width: 18, height: 18, borderRadius: 999, background: TEAL[50], border: `1px solid ${TEAL[200]}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: TEAL[600] }}>{i+1}</span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "#444", lineHeight: 1.5 }}>{s}</p>
            </div>
          ))}
        </div>
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
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
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
        <Btn variant="primary" style={{ width: "100%" }} onClick={() => { setHasRecoverySummary(true); setScreen("recovery"); }}>
          I'm ready to continue →
        </Btn>
      </div>
    </div>
  );
}

// ─── Screen 6: Session Analytics ─────────────────────────────────────────────

function AnalyticsScreen({ setScreen, summary }) {
  const s = summary ?? {};

  const mins = Math.floor((s.elapsedSeconds ?? 0) / 60);
  const secs = (s.elapsedSeconds ?? 0) % 60;
  const sessionTimeStr = `${mins}m ${secs}s`;

  // Stats backed by real tracked data from content.js
  const stats = [
    { label: "Session time", value: sessionTimeStr, icon: "⏱" },
    { label: "Words written", value: s.wordCount ?? 0, icon: "📝" },
    { label: "Avg. WPM", value: s.wpm ?? 0, icon: "⚡" },
    { label: "Pauses", value: s.totalPauses ?? 0, icon: "⏸" },
    // NOTE: distraction count, breaks taken, and recovery rate aren't tracked
    // by content.js yet (only current phase is logged, not a running tally
    // of distraction events or break usage) — left out until that's added.
  ];
  const phases = [
    { label: "Planning", pct: 18, color: TEAL[100] },
    { label: "Translating", pct: 64, color: TEAL[400] },
    { label: "Reviewing", pct: 18, color: TEAL[200] },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)", textAlign: "center" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: TEAL[400], display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px" }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
            <path d="M2 12l4-4 3 3 5-7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, color: "#030213" }}>Session complete!</p>
        <p style={{ margin: 0, fontSize: 11, color: "#717182" }}>{s.taskName || "Untitled task"}</p>
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
          <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", gap: 2, marginBottom: 8 }}>
            {phases.map(p => <div key={p.label} style={{ flex: p.pct, background: p.color }} />)}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {phases.map(p => (
              <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
                <span style={{ fontSize: 10, color: "#717182" }}>{p.label} {p.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: TEAL[50], borderRadius: 10, padding: "10px 12px", border: `1px solid ${TEAL[100]}` }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: TEAL[800] }}>Great session!</p>
          <p style={{ margin: 0, fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>You recovered focus quickly after each distraction. You spent most of your time in the translating phase — a sign of productive flow.</p>
        </div>
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <Btn variant="primary" style={{ width: "100%" }} onClick={() => setScreen("init")}>Start new task</Btn>
      </div>
    </div>
  );
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function PopupView({ screen, setScreen, summary, setSummary, hasRecoverySummary, setHasRecoverySummary }) {
  const screenMap = {
    init: <TaskInitScreen onStart={() => { setHasRecoverySummary(false); setScreen("monitoring"); }}/>,
    monitoring: <ActiveMonitoringScreen setScreen={setScreen} setSummary={setSummary} hasRecoverySummary={hasRecoverySummary} />,
    recovery: <RecoveryScreen setScreen={setScreen} />,
    break: <BreakScreen setScreen={setScreen} setHasRecoverySummary={setHasRecoverySummary} />,
    analytics: <AnalyticsScreen setScreen={setScreen} summary={summary} />,
  };
  return (
    <div style={{ width: 320, height: 500, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {screenMap[screen]}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("init");
  const [summary, setSummary] = useState(null); // snapshot of session stats captured when a session finishes
  const [hasRecoverySummary, setHasRecoverySummary] = useState(false); // true once a real recovery moment has happened this task

  return (
    <div style={styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
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
        />
      </div>
    </div>
  );
}
