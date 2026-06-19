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
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "0",
    color: "#030213",
  },
  // Nav tabs
  nav: {
    width: "100%",
    background: "#fff",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: "0",
    padding: "0 16px",
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 1px 4px rgba(29,158,117,0.06)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "12px 16px 12px 0",
    borderRight: "1px solid rgba(0,0,0,0.08)",
    marginRight: "8px",
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: TEAL[400],
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "-0.5px",
  },
  logoText: {
    fontSize: 14,
    fontWeight: 600,
    color: "#030213",
    letterSpacing: "-0.3px",
  },
  tab: (active) => ({
    padding: "14px 16px",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? TEAL[600] : "#717182",
    borderBottom: active ? `2px solid ${TEAL[400]}` : "2px solid transparent",
    cursor: "pointer",
    background: "none",
    border: "none",
    borderBottom: active ? `2px solid ${TEAL[400]}` : "2px solid transparent",
    transition: "color 0.15s",
    whiteSpace: "nowrap",
  }),
  content: {
    width: "100%",
    maxWidth: 900,
    padding: "24px 16px 48px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  screenLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: TEAL[600],
    marginBottom: 8,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.07)",
    overflow: "hidden",
    boxShadow: "0 2px 12px rgba(29,158,117,0.06)",
  },
};

// ─── Shared Components ────────────────────────────────────────────────────────

function ExtensionShell({ children, sidePanel }) {
  return (
    <div style={{ display: "flex", gap: 0, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 4px 24px rgba(29,158,117,0.08)", background: "#fff", minHeight: 460 }}>
      <div style={{ flex: 1, background: "#F0F4F2", position: "relative", overflow: "hidden", minHeight: 460 }}>
        {/* Fake browser chrome */}
        <div style={{ background: "#E8EEEC", borderBottom: "1px solid rgba(0,0,0,0.08)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {["#FF5F57","#FEBC2E","#28C840"].map((c,i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 999, background: c }} />)}
          </div>
          <div style={{ flex: 1, background: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#888", border: "1px solid rgba(0,0,0,0.1)" }}>
            docs.google.com/document/d/1a2B3c…
          </div>
          <div style={{ fontSize: 13, color: TEAL[400], fontWeight: 600, cursor: "pointer" }}>FF</div>
        </div>
        {/* Google Docs mock */}
        <div style={{ padding: "20px 32px", height: "calc(100% - 37px)", overflowY: "auto" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ height: 16, background: "rgba(0,0,0,0.08)", borderRadius: 4, width: "60%", marginBottom: 12 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "100%", marginBottom: 8 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "92%", marginBottom: 8 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "85%", marginBottom: 8 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "97%", marginBottom: 8 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "78%", marginBottom: 20 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "100%", marginBottom: 8 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "88%", marginBottom: 8 }} />
            <div style={{ height: 10, background: "rgba(0,0,0,0.05)", borderRadius: 4, width: "70%", marginBottom: 8 }} />
          </div>
        </div>
        {children}
      </div>
      {sidePanel && (
        <div style={{ width: 256, borderLeft: "1px solid rgba(0,0,0,0.07)", background: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {sidePanel}
        </div>
      )}
    </div>
  );
}

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
      {subtitle && <p style={{ fontSize: 11, color: "#717182", margin: 0, paddingLeft: 32 }}>{subtitle}</p>}
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
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 0" }}>
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
      <div style={{ padding: 14, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
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

function ActiveMonitoringScreen() {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle={taskName} status={currentPhase} />
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
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
      <div style={{ padding: 14, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <Btn variant="ghost" style={{ width: "100%", fontSize: 12 }}>Take a break</Btn>
      </div>
    </div>
  );
}

// ─── Screen 3: Distraction Prompt ────────────────────────────────────────────

function DistractionPromptScreen({ onAction }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(3,2,19,0.38)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, backdropFilter: "blur(1px)" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "24px 22px", width: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", textAlign: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: TEAL[50], display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" stroke={TEAL[400]} strokeWidth="1.5" />
            <path d="M10 6v4M10 13h.01" stroke={TEAL[400]} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#030213" }}>Gentle reminder</p>
        <p style={{ margin: "0 0 18px", fontSize: 12, color: "#717182", lineHeight: 1.5 }}>You've been away from your writing for a while. Ready to get back on track?</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn variant="primary" onClick={() => onAction("resume")} style={{ width: "100%" }}>Get back to work</Btn>
          <Btn variant="outline" onClick={() => onAction("break")} style={{ width: "100%" }}>Take a break</Btn>
          <Btn variant="ghost" onClick={() => onAction("dismiss")} style={{ width: "100%", fontSize: 12, color: "#aaa", border: "none" }}>Dismiss</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Screen 4: Recovery Interface ────────────────────────────────────────────

function RecoveryScreen() {
  const suggestions = [
    "Continue the sentence you were drafting about AI's personalization capabilities.",
    "Expand on the point about student engagement metrics from paragraph 2.",
    "Outline the counterargument section you planned in your objective.",
    "Review and revise the thesis statement before moving forward.",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle="Welcome back!" />
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
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
      <div style={{ padding: 14, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn variant="primary" style={{ width: "100%" }}>
          Continue where I left off →
        </Btn>
      </div>
    </div>
  );
}

// ─── Screen 5: Break Mode ─────────────────────────────────────────────────────

function BreakScreen() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const activities = ["🧘 Breathe slowly", "🚶 Take a short walk", "💧 Drink some water", "👁 Rest your eyes"];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: TEAL[50], border: `2px solid ${TEAL[100]}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <svg width="26" height="26" fill="none" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="10" stroke={TEAL[400]} strokeWidth="1.8" />
            <path d="M13 8v5l3 3" stroke={TEAL[400]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#030213" }}>Taking a break</p>
        <p style={{ margin: 0, fontSize: 12, color: "#717182" }}>Your session is paused</p>
      </div>
      <div style={{ background: "#F7FAF9", borderRadius: 12, padding: "14px 28px", textAlign: "center", marginBottom: 20, border: `1px solid ${TEAL[50]}` }}>
        <p style={{ margin: 0, fontSize: 11, color: "#717182", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Break duration</p>
        <p style={{ margin: 0, fontSize: 30, fontWeight: 700, color: TEAL[800], fontVariantNumeric: "tabular-nums" }}>
          {String(Math.floor(secs/60)).padStart(2,"0")}:{String(secs%60).padStart(2,"0")}
        </p>
      </div>
      <div style={{ width: "100%", marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, textAlign: "center" }}>Suggested activities</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activities.map(a => (
            <div key={a} style={{ background: TEAL[50], borderRadius: 8, padding: "8px 12px", fontSize: 12, color: TEAL[800], textAlign: "center", border: `1px solid ${TEAL[100]}` }}>{a}</div>
          ))}
        </div>
      </div>
      <Btn variant="primary" style={{ width: "100%" }}>
        I'm ready to continue →
      </Btn>
    </div>
  );
}

// ─── Screen 6: Session Analytics ─────────────────────────────────────────────

function AnalyticsScreen() {
  const stats = [
    { label: "Session time", value: "47m 12s", icon: "⏱" },
    { label: "Words written", value: "624", icon: "📝" },
    { label: "Avg. WPM", value: "38", icon: "⚡" },
    { label: "Distractions", value: "4", icon: "🔔" },
    { label: "Breaks taken", value: "1", icon: "☕" },
    { label: "Recovery rate", value: "100%", icon: "✅" },
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
        <p style={{ margin: 0, fontSize: 11, color: "#717182" }}>Research Essay Draft</p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: "#F7FAF9", borderRadius: 10, padding: "9px 10px", border: `1px solid ${TEAL[50]}` }}>
              <p style={{ margin: 0, fontSize: 16 }}>{s.icon}</p>
              <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700, color: TEAL[800] }}>{s.value}</p>
              <p style={{ margin: "1px 0 0", fontSize: 10, color: "#717182" }}>{s.label}</p>
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
      <div style={{ padding: 14, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <Btn variant="primary" style={{ width: "100%" }}>Start new task</Btn>
      </div>
    </div>
  );
}

// ─── Full Popup Mode (no side panel) ─────────────────────────────────────────

function PopupView({ screen, setScreen }) {
  const [distractionAction, setDistractionAction] = useState(null);
  const screenMap = {
    init: <TaskInitScreen onStart={() => setScreen("monitoring")}/>,
    monitoring: <ActiveMonitoringScreen />,
    recovery: <RecoveryScreen />,
    break: <BreakScreen />,
    analytics: <AnalyticsScreen />,
  };
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* Extension popup */}
      <div style={{ flex: "0 0 260px" }}>
        <p style={styles.screenLabel}>Extension popup</p>
        <div style={{ ...styles.card, width: 260, minHeight: 460, display: "flex", flexDirection: "column", overflow: "visible" }}>
          <div style={{ display: "flex", flexDirection: "column", height: 460, overflow: "hidden", borderRadius: 16 }}>
            {screenMap[screen]}
          </div>
        </div>
      </div>
      {/* Screen selector */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <p style={styles.screenLabel}>Select screen</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { key: "init", label: "Task initialization", desc: "Set task name & objective" },
            { key: "monitoring", label: "Active monitoring", desc: "Live stats & phase detection" },
            { key: "recovery", label: "Recovery interface", desc: "Context summary + next steps" },
            { key: "break", label: "Break mode", desc: "Break timer & activities" },
            { key: "analytics", label: "Session analytics", desc: "End-of-session summary" },
          ].map(s => (
            <button key={s.key} onClick={() => setScreen(s.key)}
              style={{ textAlign: "left", background: screen === s.key ? TEAL[50] : "#fff", border: screen === s.key ? `1.5px solid ${TEAL[200]}` : "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "10px 13px", cursor: "pointer", transition: "all 0.15s" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: screen === s.key ? TEAL[800] : "#030213" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 11, color: "#717182", marginTop: 2 }}>{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Distraction Overlay Demo ─────────────────────────────────────────────────

function DistractionDemo() {
  const [show, setShow] = useState(false);
  const [action, setAction] = useState(null);
  return (
    <div>
      <p style={styles.screenLabel}>Distraction overlay</p>
      <div style={{ ...styles.card, overflow: "visible" }}>
        <ExtensionShell sidePanel={
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <SidePanelHeader title="FrictionFlow" subtitle="Research Essay Draft" status="Active" />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, gap: 12 }}>
              {action ? (
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: TEAL[800], marginBottom: 6 }}>
                    {action === "resume" ? "Welcome back! 👋" : action === "break" ? "Enjoy your break ☕" : "Dismissed"}
                  </p>
                  <p style={{ fontSize: 11, color: "#717182", margin: "0 0 16px" }}>
                    {action === "resume" ? "Recovery context loaded." : action === "break" ? "Break timer started." : "Monitoring continues."}
                  </p>
                  <Btn variant="outline" onClick={() => { setAction(null); setShow(false); }} style={{ fontSize: 11 }}>Reset demo</Btn>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: "#717182", textAlign: "center", margin: 0 }}>Monitoring active. Idle threshold: 45s</p>
                  <Btn variant="danger" onClick={() => setShow(true)} style={{ width: "100%", fontSize: 12 }}>
                    Simulate distraction
                  </Btn>
                </>
              )}
            </div>
          </div>
        }>
          {show && !action && (
            <DistractionPromptScreen onAction={a => { setAction(a); setShow(false); }} />
          )}
        </ExtensionShell>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "popup", label: "Extension popup" },
  { key: "overlay", label: "Distraction overlay" },
  { key: "inline", label: "Inline monitoring" },
];

export default function App() {
  const [tab, setTab] = useState("popup");
  const [screen, setScreen] = useState("init");

  return (
    <div style={styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        button:hover { opacity: 0.85; }
      `}</style>
      {/* Nav */}
      <div style={styles.nav}>
        <div style={styles.logo}>
          <div style={styles.logoMark}>FF</div>
          <span style={styles.logoText}>FrictionFlow</span>
        </div>
        {TABS.map(t => (
          <button key={t.key} style={styles.tab(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 999, background: TEAL[400] }} />
          <span style={{ fontSize: 11, color: "#717182" }}>Browser Extension UI</span>
        </div>
      </div>
      {/* Content */}
      <div style={styles.content}>
        {tab === "popup" && <PopupView screen={screen} setScreen={setScreen} />}
        {tab === "overlay" && <DistractionDemo />}
        {tab === "inline" && (
          <div>
            <p style={styles.screenLabel}>Full inline view — active session</p>
            <div style={styles.card}>
              <ExtensionShell sidePanel={<ActiveMonitoringScreen />} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
