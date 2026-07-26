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
    chrome.storage.local.get(["ff_task", "ff_interrupted"], (result) => {
      const task = result.ff_task;
      if (!task) return;
      if (isDocsTab && active.id !== task.tabId) {
        chrome.storage.local.set({ ff_task: { ...task, tabId: active.id } });
      }
      const targetId = isDocsTab ? active.id : task.tabId;
      if (!targetId) return;
      // If this resume follows an interruption (Docs tab closed/left), measure
      // the offline gap here — where ff_interrupted is still readable — and
      // pass it to the content script so it's subtracted from writing time.
      // Clearing ff_interrupted is owned by this function (only on a confirmed
      // resume), so it isn't cleared out from under this read by a racing
      // remove() elsewhere.
      const wasInterrupted = !!result.ff_interrupted;
      const interruptedMs = result.ff_interrupted?.at
        ? Math.max(0, Date.now() - result.ff_interrupted.at)
        : 0;
      chrome.tabs.sendMessage(targetId, { type: "FF_RESUME_TASK", interruptedMs })
        .then(() => { if (wasInterrupted) chrome.storage.local.remove("ff_interrupted"); })
        .catch(() => {});
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

// Upsert the participant's chosen next-step for the current recovery episode.
// Keyed by the episode's generatedAt so re-picking (including later via "View
// last recovery summary") UPDATES the same record instead of adding a duplicate
// — one distraction episode contributes at most one choice to the export tally.
// A record freezes on its own once the next episode generates (a new
// generatedAt is never written back to) or the session ends; there is no
// separate "commit" step. The choice log (ff_suggestion_choices) is owned
// solely by the panel — kept OUT of ff_session, which content.js
// read-modify-writes continuously, so the two never race.
function recordSuggestionChoice({ generatedAt, chosenIndex, options }) {
  if (typeof chrome === "undefined" || !chrome.storage || !generatedAt) return;
  chrome.storage.local.get("ff_suggestion_choices", (result) => {
    const log = Array.isArray(result.ff_suggestion_choices) ? result.ff_suggestion_choices : [];
    // chosenIndex IS the stance (0 = goal-anchored, 1 = doc-driven, 2 = bridge)
    // because the suggestions array is generated in that fixed order. options
    // preserves the two not-chosen suggestions for the export record.
    const record = { at: Date.now(), generatedAt, chosenIndex, chosenText: options[chosenIndex], options };
    const idx = log.findIndex((r) => r.generatedAt === generatedAt);
    if (idx >= 0) log[idx] = record; else log.push(record);
    chrome.storage.local.set({ ff_suggestion_choices: log });
  });
}

// Appends an intervention event to a panel-owned log: the "Gentle Reminder"
// shown (prompt_shown), the participant's response to it (response =
// get_back_to_work / take_a_break / dismiss), or a self-initiated voluntary
// break (voluntary_break — the monitoring-screen "Take a break" button, kept
// distinct from the prompt-driven take_a_break so the two break origins can be
// counted separately). Kept OUT of ff_session — which content.js
// read-modify-writes continuously — so the two never race. Feeds the export.
function logInterventionEvent(type, detail = {}) {
  if (typeof chrome === "undefined" || !chrome.storage) return;
  chrome.storage.local.get("ff_events", (result) => {
    const log = Array.isArray(result.ff_events) ? result.ff_events : [];
    log.push({ at: Date.now(), type, ...detail });
    chrome.storage.local.set({ ff_events: log });
  });
}

// ─── Session data export ──────────────────────────────────────────────────────

// Triggers a file download from the side panel via an in-memory blob — no
// "downloads" permission needed, since the panel is a normal extension page.
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Quote a CSV cell and escape embedded quotes, so free-text fields (task name,
// objective) with commas/quotes/newlines don't break the row.
function csvCell(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

// Slugs a value for use in a filename (participant id, condition).
function fileSlug(value, fallback) {
  const s = String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

// ─── Post-session questionnaires ─────────────────────────────────────────────
// Three validated instruments, administered in-panel right after Session
// Complete so responses land in the SAME export as the behavioral data (no
// separate form to reconcile by participant ID later).
//
// Variants fixed with the owners: Raw TLX (unweighted — no pairwise procedure),
// FSS 10 flow items, UEQ-S (8 items). Item wording below is verbatim from the
// published instruments — DO NOT reword or reorder: the subscale indices and
// the published comparison norms both depend on it.

// NASA-TLX (Hart & Staveland 1988), raw/unweighted. Each 0-100 in steps of 5.
// Wording is the official rating-scale description, trimmed to the FIRST
// question of each (the follow-up clauses — "Was the task easy or demanding,
// simple or complex..." — are dropped to keep the side panel readable).
// Performance is anchored Good→Poor per the original, which means that like the
// other five a HIGHER value is the worse/heavier end — so the six are directly
// averageable with no reverse-scoring.
const TLX_ITEMS = [
  { id: "mental", label: "Mental Demand", question: "How much mental and perceptual activity was required (e.g. thinking, deciding, calculating, remembering, looking, searching, etc)?", low: "Low", high: "High" },
  { id: "physical", label: "Physical Demand", question: "How much physical activity was required (e.g. pushing, pulling, turning, controlling, activating, etc)?", low: "Low", high: "High" },
  { id: "temporal", label: "Temporal Demand", question: "How much time pressure did you feel due to the rate of pace at which the tasks or task elements occurred?", low: "Low", high: "High" },
  { id: "performance", label: "Performance", question: "How successful do you think you were in accomplishing the goals of the task set by the experimenter (or yourself)?", low: "Good", high: "Poor" },
  { id: "effort", label: "Effort", question: "How hard did you have to work (mentally and physically) to accomplish your level of performance?", low: "Low", high: "High" },
  { id: "frustration", label: "Frustration", question: "How insecure, discouraged, irritated, stressed and annoyed versus secure, gratified, content, relaxed and complacent did you feel during the task?", low: "Low", high: "High" },
];

// Flow Short Scale (Rheinberg, Vollmeyer & Engeser 2003), 10 flow items, 1-7.
const FSS_ITEMS = [
  "I feel just the right amount of challenge.",
  "My thoughts/activities run fluidly and smoothly.",
  "I do not notice time passing.",
  "I have no difficulty concentrating.",
  "My mind is completely clear.",
  "I am totally absorbed in what I am doing.",
  "The right thoughts/movements occur of their own accord.",
  "I know what I have to do each step of the way.",
  "I feel that I have everything under control.",
  "I am completely lost in thought.",
];
// Subscales per Engeser & Rheinberg (2008), 1-indexed item numbers.
const FSS_FLUENCY = [2, 4, 5, 7, 8, 9];
const FSS_ABSORPTION = [1, 3, 6, 10];

// UEQ-S (Schrepp, Hinderks & Thomaschewski 2017), 8 semantic differentials
// scored -3..+3. Items 1-4 = pragmatic quality, 5-8 = hedonic quality.
const UEQS_ITEMS = [
  { left: "obstructive", right: "supportive" },
  { left: "complicated", right: "easy" },
  { left: "inefficient", right: "efficient" },
  { left: "confusing", right: "clear" },
  { left: "boring", right: "exciting" },
  { left: "not interesting", right: "interesting" },
  { left: "conventional", right: "inventive" },
  { left: "usual", right: "leading edge" },
];

// Turns raw responses into the stored survey object: every item preserved for
// reanalysis (item-level data is needed for Cronbach's alpha), plus the
// subscale means each instrument defines.
function scoreSurvey({ tlx, fss, ueqs }) {
  const mean = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null);
  const fssItems = {};
  FSS_ITEMS.forEach((_, i) => { fssItems[i + 1] = fss[i + 1]; });
  const ueqsItems = {};
  UEQS_ITEMS.forEach((_, i) => { ueqsItems[i + 1] = ueqs[i + 1]; });
  return {
    completedAt: Date.now(),
    tlx: { items: { ...tlx }, rawScore: mean(TLX_ITEMS.map((i) => tlx[i.id])) },
    fss: {
      items: fssItems,
      overall: mean(FSS_ITEMS.map((_, i) => fss[i + 1])),
      fluency: mean(FSS_FLUENCY.map((n) => fss[n])),
      absorption: mean(FSS_ABSORPTION.map((n) => fss[n])),
    },
    ueqs: {
      items: ueqsItems,
      overall: mean(UEQS_ITEMS.map((_, i) => ueqs[i + 1])),
      pragmatic: mean([1, 2, 3, 4].map((n) => ueqs[n])),
      hedonic: mean([5, 6, 7, 8].map((n) => ueqs[n])),
    },
  };
}

// Builds the per-session export payloads (rich JSON + one flat CSV row) from the
// finish summary. Kept as one function so the two formats can never drift.
function buildSessionExport(s) {
  const sec = (ms) => Math.round((ms ?? 0) / 1000);
  const totalSec = s.elapsedSeconds ?? 0;
  const breakSec = sec(s.totalBreakMs);
  const offlineSec = sec(s.totalInterruptedMs);
  const phases = s.phaseDurationsMs ?? {};
  const translatingSec = sec(phases.Translating);
  const reviewingSec = sec(phases.Reviewing);
  // Writing time = Translating + Reviewing — time actually working on the text
  // (producing it, or re-reading/revising it), per Flower & Hayes (1981).
  // Planning and Distracted are excluded but still reported in phasesMs, and
  // total/break/offline are all exported, so any other time base is derivable.
  const writingSec = translatingSec + reviewingSec;
  const typedWords = s.typedWordCount ?? 0;
  // Overall pace = words over all writing work (Translating + Reviewing).
  // Focused pace = words over active drafting only (Translating), where new text
  // is actually produced. Both exported; UI shows focused.
  const avgWpmOverall = writingSec > 0 ? Math.round(typedWords / (writingSec / 60)) : 0;
  const avgWpmFocused = translatingSec > 0 ? Math.round(typedWords / (translatingSec / 60)) : 0;
  // Session pace = words over total wall-clock time (breaks and distraction
  // included) — the most conservative of the three rates.
  const avgWpmSession = totalSec > 0 ? Math.round(typedWords / (totalSec / 60)) : 0;
  const events = Array.isArray(s.interventionEvents) ? s.interventionEvents : [];
  const respCount = (r) => events.filter((e) => e.type === "response" && e.response === r).length;
  // Break counts by origin, kept separate: prompted = the distraction prompt's
  // "Take a Break" (a response to the intervention, intervention condition only);
  // voluntary = the monitoring-screen "Take a break" (self-initiated, both
  // conditions). total is the convenience sum. Merging them would confound the
  // baseline↔intervention comparison, since prompted breaks can't occur in baseline.
  // H1 measurement correction. resumptionMs runs return-to-doc → first
  // keystroke, so in the INTERVENTION arm it also contains the time spent
  // reading the prompt and the recovery summary — time baseline participants
  // never spend. Left uncorrected, using the intervention makes the
  // intervention look slower. Computed here rather than in analysis so the
  // number can't be derived inconsistently; every input stays exported, so a
  // disagreement with this formula is always recomputable from raw.
  const choices = s.suggestionChoices ?? [];
  const episodesOut = (s.distractionEpisodes ?? []).map((ep) => {
    if (typeof ep.endedAt !== "number") return { ...ep };
    // Not stored on the episode, but exact: resumptionMs was measured from it.
    const returnedAt = ep.endedAt - (ep.resumptionMs ?? 0);
    // Latest intervention interaction that falls INSIDE the resumption window.
    // Two clamps matter: an interaction before returnedAt (they read the prompt
    // while still on the other tab) cost no resumption time; and one after
    // endedAt is real — the prompt is sticky, so it can be dismissed after
    // typing already resumed — but must not produce a negative result.
    const marks = [
      ...events.filter((e) => e.type === "response").map((e) => e.at),
      ...choices.map((c) => c.at),
    ].filter((at) => typeof at === "number" && at >= returnedAt && at <= ep.endedAt);
    const cut = marks.length > 0 ? Math.max(returnedAt, ...marks) : returnedAt;
    return { ...ep, returnedAt, adjustedResumptionMs: ep.endedAt - cut };
  });
  // Baseline has no intervention events, so adjusted === raw there — which is
  // what makes the two arms comparable on this measure.
  const adjustedList = episodesOut
    .map((e) => e.adjustedResumptionMs)
    .filter((n) => typeof n === "number" && n >= 0);
  const avgAdjustedResumptionMs = adjustedList.length > 0
    ? Math.round(adjustedList.reduce((a, b) => a + b, 0) / adjustedList.length)
    : 0;

  const promptedBreaks = respCount("take_a_break");
  const voluntaryBreaks = events.filter((e) => e.type === "voluntary_break").length;
  const tally = s.suggestionTally ?? {};
  const sv = s.survey ?? null;

  const json = {
    participantId: s.participantId || "",
    condition: s.condition || "",
    task: { name: s.taskName || "", objective: s.objective || "" },
    session: {
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
      endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
      totalTimeSec: totalSec,
      writingTimeSec: writingSec,
      breakTimeSec: breakSec,
      offlineTimeSec: offlineSec,
      interrupted: offlineSec > 0,
    },
    words: {
      docWords: s.wordCount ?? 0,        // words ADDED this session (API-anchored, incl. paste)
      typedWords,                        // keystroke-typed only (excludes paste)
      docTotalWords: s.totalDocWords ?? 0, // exact whole-document count (Docs API), incl. pre-loaded prompt
    },
    typing: {
      avgWpmOverall,
      avgWpmFocused,
      avgWpmSession,
      totalPauses: s.totalPauses ?? 0,
      longestPauseSec: sec(s.longestPauseMs),
      burstCount: s.burstCount ?? 0,
      avgBurstSec: s.avgBurstDurationSec ?? 0,
      scrollFrequency: s.scrollFrequency ?? 0,
      tabSwitchCount: s.tabSwitchCount ?? 0,
      tabAwaySec: sec(s.totalTabAwayMs), // cumulative time the Docs tab was hidden
    },
    // Raw revision signals behind the Reviewing phase classification: the rule
    // is (scroll >=5 OR deletes >=5 OR selections >=2) AND WPM <10 over a 60s
    // window, so these are the session-lifetime counts of the two keystroke
    // signals it tests. Exported so the classification is auditable, not just
    // asserted.
    revision: {
      totalDeletes: s.totalDeletes ?? 0,       // Backspace/Delete presses
      totalSelections: s.totalSelections ?? 0, // debounced selection gestures
    },
    phasesMs: {
      Planning: phases.Planning ?? 0,
      Translating: phases.Translating ?? 0,
      Reviewing: phases.Reviewing ?? 0,
      Distracted: phases.Distracted ?? 0,
    },
    distractions: {
      count: s.distractionCount ?? 0,              // occurrences (onset)
      recovered: s.distractionsRecovered ?? 0,     // episodes that resumed (have a resumptionMs)
      avgResumptionSec: sec(s.avgResumptionMs),    // averaged over recovered episodes only
      // H1 with prompt-reading time removed (identical to raw in baseline).
      avgAdjustedResumptionSec: sec(avgAdjustedResumptionMs),
      // Each episode carries returnedAt + adjustedResumptionMs alongside the raw
      // values, so the correction is auditable per episode, not just in aggregate.
      episodes: episodesOut,
    },
    promptResponses: {
      promptsShown: events.filter((e) => e.type === "prompt_shown").length,
      getBackToWork: respCount("get_back_to_work"),
      takeABreak: promptedBreaks,
      dismiss: respCount("dismiss"),
    },
    breaks: {
      voluntary: voluntaryBreaks,
      prompted: promptedBreaks,
      total: voluntaryBreaks + promptedBreaks,
    },
    recoverySuggestions: { tally, choices: s.suggestionChoices ?? [] },
    interventionEvents: events,
    // null when the participant hasn't completed the questionnaire yet — an
    // explicit null, so a missing survey is distinguishable from a zero score.
    survey: s.survey ?? null,
    exportedAt: new Date().toISOString(),
  };

  const cols = [
    ["participantId", json.participantId],
    ["condition", json.condition],
    ["taskName", json.task.name],
    ["startedAt", json.session.startedAt],
    ["endedAt", json.session.endedAt],
    ["totalTimeSec", totalSec],
    ["writingTimeSec", writingSec],
    ["breakTimeSec", breakSec],
    ["offlineTimeSec", offlineSec],
    ["interrupted", json.session.interrupted ? 1 : 0],
    ["docWords", json.words.docWords],
    ["typedWords", typedWords],
    ["docTotalWords", json.words.docTotalWords],
    ["avgWpmOverall", avgWpmOverall],
    ["avgWpmFocused", avgWpmFocused],
    ["avgWpmSession", avgWpmSession],
    ["totalPauses", json.typing.totalPauses],
    ["longestPauseSec", json.typing.longestPauseSec],
    ["totalDeletes", json.revision.totalDeletes],
    ["totalSelections", json.revision.totalSelections],
    ["planningSec", sec(phases.Planning)],
    ["translatingSec", sec(phases.Translating)],
    ["reviewingSec", sec(phases.Reviewing)],
    ["distractedSec", sec(phases.Distracted)],
    // tabSwitchCount rides along because tabAwaySec is hard to read without it
    // (10 min away over 2 switches means something different than over 40).
    ["tabSwitchCount", json.typing.tabSwitchCount],
    ["tabAwaySec", json.typing.tabAwaySec],
    ["distractionCount", json.distractions.count],
    ["distractionsRecovered", json.distractions.recovered],
    ["avgResumptionSec", json.distractions.avgResumptionSec],
    ["avgAdjustedResumptionSec", json.distractions.avgAdjustedResumptionSec],
    ["promptsShown", json.promptResponses.promptsShown],
    ["respGetBackToWork", json.promptResponses.getBackToWork],
    ["respTakeBreak", json.promptResponses.takeABreak], // prompt-driven breaks
    ["respDismiss", json.promptResponses.dismiss],
    ["voluntaryBreaks", voluntaryBreaks],
    ["totalBreaks", voluntaryBreaks + promptedBreaks],
    ["suggestStance0", tally[0] ?? 0],
    ["suggestStance1", tally[1] ?? 0],
    ["suggestStance2", tally[2] ?? 0],
    // Questionnaires. Subscale scores AND every raw item — item-level data is
    // what reliability analysis (Cronbach's alpha) needs, and it lets the
    // scores be recomputed if a scoring decision changes. Blank cells when the
    // survey wasn't completed (csvCell renders null/undefined as "").
    ["surveyCompleted", sv ? 1 : 0],
    ["tlxRaw", sv?.tlx.rawScore],
    ...TLX_ITEMS.map((i) => [`tlx_${i.id}`, sv?.tlx.items[i.id]]),
    ["fssOverall", sv?.fss.overall],
    ["fssFluency", sv?.fss.fluency],
    ["fssAbsorption", sv?.fss.absorption],
    ...FSS_ITEMS.map((_, i) => [`fss${i + 1}`, sv?.fss.items[i + 1]]),
    ["ueqsOverall", sv?.ueqs.overall],
    ["ueqsPragmatic", sv?.ueqs.pragmatic],
    ["ueqsHedonic", sv?.ueqs.hedonic],
    ...UEQS_ITEMS.map((_, i) => [`ueqs${i + 1}`, sv?.ueqs.items[i + 1]]),
  ];
  const csv = cols.map(([k]) => csvCell(k)).join(",") + "\r\n" + cols.map(([, v]) => csvCell(v)).join(",") + "\r\n";

  const datePart = (s.startedAt ? new Date(s.startedAt) : new Date()).toISOString().slice(0, 10);
  const base = `${fileSlug(s.participantId, "session")}_${fileSlug(s.condition, "cond")}_${datePart}`;

  return { json, csv, base };
}

function RecoverySummaryContent({ summary, selectedIndex, onSelect }) {
  const selectable = typeof onSelect === "function";
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
      <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: selectable ? 3 : 8 }}>Suggested next steps</p>
      {selectable && (
        <p style={{ margin: "0 0 8px", fontSize: 11, color: "#717182", lineHeight: 1.5 }}>
          Pick the one you'll work on — it'll show while you write. You can change it anytime here.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {summary.suggestions.map((s, i) => {
          const selected = selectedIndex === i;
          return (
            <div
              key={i}
              onClick={selectable ? () => onSelect(i) : undefined}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              onKeyDown={selectable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } } : undefined}
              style={{ background: selected ? TEAL[50] : "#fff", borderRadius: 9, padding: "9px 11px", border: `1px solid ${selected ? TEAL[400] : TEAL[100]}`, boxShadow: selected ? `0 0 0 1px ${TEAL[400]}` : "none", display: "flex", gap: 8, alignItems: "flex-start", cursor: selectable ? "pointer" : "default", transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s" }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 999, background: selected ? TEAL[400] : TEAL[50], border: `1px solid ${selected ? TEAL[400] : TEAL[200]}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: selected ? "#fff" : TEAL[600] }}>{i + 1}</span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "#444", lineHeight: 1.5 }}>{s}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Screen 1: Task Initialization ───────────────────────────────────────────

function TaskInitScreen({ onStart }) {
  const [participantId, setParticipantId] = useState(""); // stamped on the data export
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  // All three fields are required — shown on a Start attempt with any empty.
  const [participantIdError, setParticipantIdError] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [objectiveError, setObjectiveError] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);
  // "baseline" = no recovery prompts (control condition); "intervention" =
  // recovery prompts enabled. This is the study's independent variable.
  const [condition, setCondition] = useState("intervention");
  // Last finished session, kept so a download missed on the analytics screen
  // can still be recovered here. Null once a newer session overwrites it.
  const [lastSummary, setLastSummary] = useState(null);

  // Self-contained senior high school writing prompts — opinion/reflection
  // based, so participants can write from their own knowledge without needing
  // to leave the doc to research (tab-switching would register as distraction).
  const templates = [
    { name: "Position Paper", obj: "Argue for or against allowing students to use AI tools for schoolwork. Take a clear stance and support it with at least three reasons." },
    { name: "Reflective Essay", obj: "Reflect on a challenge you faced this school year and what it taught you about yourself as a student." },
    { name: "Argumentative Essay", obj: "Should senior high school students be required to wear uniforms? Defend your position with clear arguments." },
  ];

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(["ff_task", "ff_interrupted", "ff_draft", "ff_lastSummary"], (result) => {
        // Read before the early return below — a recoverable previous session
        // matters just as much when a session is already active.
        setLastSummary(result.ff_lastSummary ?? null);
        const t = result.ff_task;
        if (t) {
          setParticipantId(t.participantId ?? "");
          setTaskName(t.taskName ?? "");
          setObjective(t.objective ?? "");
          setCondition(t.condition ?? "intervention");
          setIsActive(true);
          if (result.ff_interrupted) setIsInterrupted(true);
          return;
        }
        // No active session, but a draft left over from a failed connection
        // attempt — prefill the form and consume the draft so it doesn't
        // resurface in unrelated future sessions.
        const d = result.ff_draft;
        if (d) {
          setParticipantId(d.participantId ?? "");
          setTaskName(d.taskName ?? "");
          setObjective(d.objective ?? "");
          setCondition(d.condition ?? "intervention");
          chrome.storage.local.remove("ff_draft");
        }
      });
    }
  }, []);

  // Soft input validation: the task name is required (it identifies the
  // session and anchors the AI prompt); the objective is optional but nudged
  // when very short, since it feeds recovery generation. Warn, never block —
  // a false positive that stops a participant from starting a session is
  // worse for the study than weak input reaching the (hardened) prompt.
  const objectiveWordCount = objective.trim().split(/\s+/).filter(Boolean).length;
  const showObjectiveNudge = !isActive && objectiveWordCount > 0 && objectiveWordCount < 3;

  function handleStartTask() {
    // All three fields are required before a session can start.
    const missingPid = !participantId.trim();
    const missingName = !taskName.trim();
    const missingObjective = !objective.trim();
    if (missingPid || missingName || missingObjective) {
      setParticipantIdError(missingPid);
      setNameError(missingName);
      setObjectiveError(missingObjective);
      return;
    }

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id ?? null;

        const taskMetadata = {
          participantId: participantId.trim(),
          taskName,
          objective,
          condition,
          sessionStartTime: Date.now(),
          tabId, // stored so background.js can detect if this specific tab closes
        };

        // clear previous session data
        chrome.storage.local.remove("ff_session");
        chrome.storage.local.remove("ff_idle");
        chrome.storage.local.remove("ff_interrupted");
        chrome.storage.local.remove("ff_recovery"); // stale summary must not leak into a new session
        chrome.storage.local.remove("ff_generating");
        chrome.storage.local.remove("ff_suggestion_choices"); // and neither must last session's choices
        chrome.storage.local.remove("ff_events"); // nor last session's intervention events

        // Navigate only after ff_task is persisted — ContextPrepScreen reads
        // it on mount, and navigating before the write landed made it show
        // "Untitled task". FF_START_TASK is sent by ContextPrepScreen once
        // the prep sequence completes.
        chrome.storage.local.set({ ff_task: taskMetadata }, () => {
          setIsActive(true);
          onStart("fresh");
        });
      });
    } else {
      setIsActive(true);
      onStart("fresh");
    }
  }

  // Re-download a previous session's export. Same builder as the analytics
  // screen, so the two can never produce different files.
  function handleDownloadLast() {
    if (!lastSummary) return;
    const { json, csv, base } = buildSessionExport(lastSummary);
    downloadFile(`${base}.json`, JSON.stringify(json, null, 2), "application/json");
    setTimeout(() => downloadFile(`${base}.csv`, csv, "text/csv"), 400);
    const updated = { ...lastSummary, downloadedAt: Date.now() };
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ ff_lastSummary: updated });
    }
    setLastSummary(updated);
  }

  function handleCancelTask() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      // Send before clearing ff_task — sendToTaskTab needs its tabId.
      sendToTaskTab({ type: "FF_CANCEL_TASK" });

      chrome.storage.local.remove("ff_task");
      chrome.storage.local.remove("ff_session");
      chrome.storage.local.remove("ff_idle");
      chrome.storage.local.remove("ff_interrupted");
      chrome.storage.local.remove("ff_recovery");
      chrome.storage.local.remove("ff_generating");
      chrome.storage.local.remove("ff_suggestion_choices");
      chrome.storage.local.remove("ff_events");
    }

    setParticipantId("");
    setTaskName("");
    setObjective("");
    setParticipantIdError(false);
    setNameError(false);
    setObjectiveError(false);
    setIsActive(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle={isActive ? "Session in progress" : "Set up your writing session"} />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 0" }}>
        {/* Shown ONLY while a previous session's export is still outstanding —
            it exists to catch data that would otherwise be lost. Once
            downloaded it disappears entirely: a "download again" offer here is
            noise on a screen whose job is starting the next session (re-download
            still lives on the analytics screen, where it's the actual context). */}
        {lastSummary && !lastSummary.downloadedAt && (
          <div style={{ background: "#FFF8F0", border: "1px solid #FDDCB5", borderRadius: 10, padding: "10px 11px", marginBottom: 14 }}>
            <p style={{ margin: "0 0 7px", fontSize: 11, color: "#8A5A1B", lineHeight: 1.5 }}>
              {`Previous session was not downloaded (${lastSummary.participantId || "no ID"} · ${lastSummary.condition === "baseline" ? "Baseline" : "Intervention"})`}
            </p>
            <Btn variant="outline" style={{ width: "100%" }} onClick={handleDownloadLast}>Download session data</Btn>
          </div>
        )}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, marginTop: 0 }}>Participant ID</p>
        <input
          value={participantId}
          onChange={e => { if (!isActive) { setParticipantId(e.target.value); if (participantIdError) setParticipantIdError(false); } }}
          placeholder="e.g. P01"
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${participantIdError ? "#E5484D" : "rgba(0,0,0,0.12)"}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#030213", outline: "none", marginBottom: participantIdError ? 4 : 12, background: isActive ? TEAL[50] : "#FAFAFA", cursor: isActive ? "default" : "text" }}
        />
        {participantIdError && (
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#E5484D", lineHeight: 1.5 }}>
            Please enter a participant ID.
          </p>
        )}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, marginTop: 0 }}>Task name</p>
        <input
          value={taskName}
          onChange={e => { if (!isActive) { setTaskName(e.target.value); if (nameError) setNameError(false); } }}
          placeholder="e.g. Research Essay Draft"
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${nameError ? "#E5484D" : "rgba(0,0,0,0.12)"}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#030213", outline: "none", marginBottom: nameError ? 4 : 12, background: isActive ? TEAL[50] : "#FAFAFA", cursor: isActive ? "default" : "text" }}
        />
        {nameError && (
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#E5484D", lineHeight: 1.5 }}>
            Please enter a task name — it identifies this session.
          </p>
        )}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Objective</p>
        <textarea
          value={objective}
          onChange={e => { if (!isActive) { setObjective(e.target.value); if (objectiveError) setObjectiveError(false); } }}
          placeholder="Briefly describe what you aim to accomplish in this session…"
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${objectiveError ? "#E5484D" : "rgba(0,0,0,0.12)"}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#030213", outline: "none", resize: "none", marginBottom: (objectiveError || showObjectiveNudge) ? 4 : 12, background: isActive ? TEAL[50] : "#FAFAFA", fontFamily: "inherit", cursor: isActive ? "default" : "text" }}
        />
        {objectiveError ? (
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#E5484D", lineHeight: 1.5 }}>
            Please enter an objective — it anchors the recovery prompts.
          </p>
        ) : showObjectiveNudge && (
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#B45309", lineHeight: 1.5 }}>
            A more specific objective helps FrictionFlow give better recovery tips — but you can start anyway.
          </p>
        )}
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
  const [stage, setStage] = useState("building"); // "building" | "connecting" | "error"

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

  // The "connecting" stage is a real delivery check: FF_START_TASK must be
  // received by the content script in the Docs tab before we proceed to
  // monitoring. If it isn't (not a Docs tab, or the tab wasn't refreshed
  // after an extension reload), show an error instead of silently starting
  // a dead session that would log nothing.
  function connectToDocs() {
    setStage("connecting");

    if (typeof chrome === "undefined" || !chrome.tabs || !chrome.storage) {
      setScreen("monitoring"); // plain-browser dev preview, nothing to connect to
      return;
    }

    // Re-resolve the target tab on every attempt. The tabId stored at
    // "Start Task" is whatever tab was active at that moment — if that
    // wasn't the doc (the usual reason for landing in the error state),
    // retrying against the same wrong tab would fail forever. If the user
    // is on a Docs tab now, adopt it as the session tab.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs[0];
      const isDocsTab = !!active?.url?.startsWith("https://docs.google.com/");
      chrome.storage.local.get("ff_task", (result) => {
        const task = result.ff_task;
        if (!task) {
          setStage("error");
          return;
        }
        if (isDocsTab && active.id !== task.tabId) {
          chrome.storage.local.set({ ff_task: { ...task, tabId: active.id } });
        }
        const targetId = isDocsTab ? active.id : task.tabId;
        if (!targetId) {
          setStage("error");
          return;
        }
        chrome.tabs.sendMessage(targetId, { type: "FF_START_TASK" })
          .then(() => {
            // Kick the one-time Google consent for the Docs API here, at
            // session start, so it never pops up mid-writing. Failure is
            // fine — word count / doc text fall back to keystroke data.
            chrome.runtime.sendMessage({ type: "FF_ENSURE_DOCS_AUTH" }).catch(() => {});
            setTimeout(() => setScreen("monitoring"), 800);
          })
          .catch(() => setStage("error"));
      });
    });
  }

  // The session never actually started (delivery was never confirmed), so
  // discard the stored task — otherwise setup shows a phantom "session in
  // progress" for a session that never tracked anything. The typed details
  // are kept as a draft so the user doesn't have to re-enter them.
  function handleBackToSetup() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("ff_task", (result) => {
        const t = result.ff_task;
        if (t) {
          chrome.storage.local.set({
            ff_draft: { participantId: t.participantId ?? "", taskName: t.taskName ?? "", objective: t.objective ?? "", condition: t.condition ?? "intervention" },
          });
        }
        chrome.storage.local.remove("ff_task");
        chrome.storage.local.remove("ff_session");
        chrome.storage.local.remove("ff_idle");
        chrome.storage.local.remove("ff_interrupted");
        setScreen("init");
      });
    } else {
      setScreen("init");
    }
  }

  useEffect(() => {
    const buildTimer = setTimeout(connectToDocs, 1300);
    return () => clearTimeout(buildTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formattedStart = startTime
    ? new Date(startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle="Preparing your session" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 24, textAlign: "center" }}>
        {stage === "error" ? (
          <>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 20 20"><path d="M10 6v5M10 14h.01" stroke="#F4A261" strokeWidth="2" strokeLinecap="round" /></svg>
            </div>
            <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#030213" }}>Couldn't connect to your Google Doc</p>
            <p style={{ margin: "0 0 18px", fontSize: 11, color: "#717182", lineHeight: 1.6, maxWidth: 250 }}>
              Make sure the document tab is open and focused when starting a task. If the extension was recently reloaded, refresh the document tab first — then retry.
            </p>
            <Btn variant="primary" style={{ width: "100%", maxWidth: 220, marginBottom: 8 }} onClick={connectToDocs}>Retry connection</Btn>
            <Btn variant="ghost" style={{ width: "100%", maxWidth: 220 }} onClick={handleBackToSetup}>Back to setup</Btn>
          </>
        ) : (
          <>
            <div style={{ width: 40, height: 40, borderRadius: 12, border: `3px solid ${TEAL[100]}`, borderTopColor: TEAL[400], animation: "spin 0.9s linear infinite", marginBottom: 18 }} />
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#030213" }}>{taskName || "Untitled task"}</p>
            {objective && <p style={{ margin: "0 0 14px", fontSize: 11, color: "#717182", lineHeight: 1.5, maxWidth: 230 }}>{objective}</p>}
            <div style={{ background: TEAL[50], borderRadius: 8, padding: "6px 12px", fontSize: 10, color: TEAL[600], marginBottom: 16 }}>
              Started at {formattedStart}
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: TEAL[600], margin: 0 }}>
              {stage === "building" ? "Building context-aware focus model…" : "Connecting to Google Docs…"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Screen 2: Active Monitoring ─────────────────────────────────────────────

// After the user dismisses the Gentle Reminder, suppress re-showing it for this
// long. Dismissing silences the CURRENT instance but must not disable detection:
// if the writer is still distracted once the cooldown passes, the reminder
// returns. A genuinely new distraction episode bypasses the cooldown entirely.
const PROMPT_COOLDOWN_MS = 60000;

// showDistractionPrompt/setShowDistractionPrompt and the two prompt refs
// (promptSuppressUntilRef, lastDistractionOnsetRef) are lifted up to App and
// passed in as props — they must survive this component unmounting when
// navigating to Recovery/Break and remounting on return, otherwise the
// dismiss cooldown and last-seen episode would reset and re-trigger the modal.
function ActiveMonitoringScreen({ setScreen, setSummary, hasRecoverySummary, setHasRecoverySummary, showDistractionPrompt, setShowDistractionPrompt, promptSuppressUntilRef, lastDistractionOnsetRef, breakOriginRef }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState(null); // read once from ff_task
  const [elapsed, setElapsed] = useState(0);                      // calculated locally every second
  const [wpm, setWpm] = useState(0);
  const [words, setWords] = useState(0);
  const [totalDocWords, setTotalDocWords] = useState(0);
  const [totalPauses, setTotalPauses] = useState(0);
  const [longestPause, setLongestPause] = useState(0);
  const [scrollFrequency, setScrollFrequency] = useState(0);
  const [scrollFrequencyLabel, setScrollFrequencyLabel] = useState("None");
  const [currentPhase, setCurrentPhase] = useState("Planning");
  const [condition, setCondition] = useState("intervention");
  const [distractionCount, setDistractionCount] = useState(0);
  const [participantId, setParticipantId] = useState(""); // carried into the export
  // Docs API connection status, mirrored from ff_session.docsConnected. When
  // false, the word count is keystroke-approximated (pasted text uncounted)
  // and the panel offers a manual reconnect.
  const [docsConnected, setDocsConnected] = useState(false);
  const [docsConnecting, setDocsConnecting] = useState(false);
  // The next-step the participant chose for the CURRENT recovery episode, shown
  // between the phase and the active context. Null once a new episode generates
  // (its generatedAt no longer matches any choice) until they pick again.
  const [activeStep, setActiveStep] = useState(null);

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
        chrome.storage.local.get(["ff_session", "ff_task", "ff_recovery", "ff_suggestion_choices"], (result) => {
          const s = result.ff_session;
          const t = result.ff_task;

          if (t) {
            setParticipantId(t.participantId ?? "");
            setTaskName(t.taskName ?? "");
            setObjective(t.objective ?? "");
            setCondition(t.condition ?? "intervention");
          }

          // Show the chosen step only for the current episode: match the choice
          // record to the live ff_recovery.generatedAt. A newer generation has
          // no matching record yet, so this clears until they re-pick.
          const gen = result.ff_recovery?.generatedAt;
          const rec = gen && Array.isArray(result.ff_suggestion_choices)
            ? result.ff_suggestion_choices.find((c) => c.generatedAt === gen)
            : null;
          setActiveStep(rec ? rec.chosenText : null);

          if (!s) return;
          setWpm(s.wpm ?? 0);
          setWords(s.wordCount ?? 0);
          setTotalPauses(s.totalPauses ?? 0);
          setLongestPause(s.longestPauseMs ?? 0);
          setScrollFrequency(s.scrollFrequency ?? 0);
          setScrollFrequencyLabel(s.scrollFrequencyLabel ?? "None");
          setCurrentPhase(s.currentPhase ?? "Planning");
          // Show OCCURRENCES (onset), not closed episodes — so the tile ticks
          // the moment a distraction begins (matching the reminder), instead of
          // lagging until the resuming keystroke closes the episode.
          setDistractionCount(s.distractionOnsetCount ?? 0);
          setTotalDocWords(s.totalDocWords ?? 0);
          if (s.docsConnected) { setDocsConnected(true); setDocsConnecting(false); }
          else setDocsConnected(false);

          // Auto-trigger the distraction prompt. Two independent triggers, so a
          // dismiss silences the current instance without disabling detection:
          //   1. A NEW distraction episode began (distractionOnsetCount rose) —
          //      fires immediately, bypassing the cooldown. This also covers
          //      tab-away, whose phase flips back to non-Distracted on return
          //      before this poll ever sees "Distracted"; the onset still fires.
          //   2. The writer is STILL "Distracted" and the post-dismiss cooldown
          //      has elapsed — re-nudges a continuing distraction (e.g. repeated
          //      tab-switching that never lets the phase leave "Distracted").
          // The prompt is STICKY by owner decision: it never dismisses itself —
          // only the user's button click closes it (see the three handlers).
          // Behavioral logging runs identically in both conditions — only
          // baseline suppresses the prompt, since that's the independent variable.
          const isBaseline = (t?.condition ?? "intervention") === "baseline";
          if (!isBaseline) {
            const onset = s.distractionOnsetCount ?? 0;
            const isDistracted = s.currentPhase === "Distracted";
            // Establish the baseline on first read so reopening the panel
            // mid-episode doesn't retro-fire for an already-known distraction.
            let newEpisode = false;
            if (lastDistractionOnsetRef.current === null) {
              lastDistractionOnsetRef.current = onset;
            } else if (onset > lastDistractionOnsetRef.current) {
              lastDistractionOnsetRef.current = onset;
              newEpisode = true;
            }
            const cooldownElapsed = Date.now() >= promptSuppressUntilRef.current;
            if (newEpisode || (isDistracted && cooldownElapsed)) {
              promptSuppressUntilRef.current = 0; // clear any spent cooldown
              setShowDistractionPrompt(true);
            }
          }
        });
      }
    }
    readStorage();
    const t = setInterval(readStorage, 2000);
    return () => clearInterval(t);
  }, [promptSuppressUntilRef, lastDistractionOnsetRef, setShowDistractionPrompt]);

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

  // Log each time the Gentle Reminder actually appears. This effect only re-runs
  // when showDistractionPrompt flips, and the poll's setShowDistractionPrompt(true)
  // is a no-op when already true — so this fires once per appearance, not every
  // 2s poll while the modal is open.
  useEffect(() => {
    if (showDistractionPrompt) logInterventionEvent("prompt_shown");
  }, [showDistractionPrompt]);

  // All three responses acknowledge the current distraction episode: start the
  // dismiss cooldown so the modal doesn't immediately reappear, while still
  // allowing a re-nudge if the writer stays distracted past the cooldown, or a
  // genuinely new episode begins (both handled in the poll above). Each logs the
  // chosen response for the intervention-event export.
  function handleGetBackToWork() {
    logInterventionEvent("response", { response: "get_back_to_work" });
    promptSuppressUntilRef.current = Date.now() + PROMPT_COOLDOWN_MS;
    setShowDistractionPrompt(false);
    setHasRecoverySummary(true);
    setScreen("recovery");
  }

  function handleTakeBreakFromPrompt() {
    logInterventionEvent("response", { response: "take_a_break" });
    promptSuppressUntilRef.current = Date.now() + PROMPT_COOLDOWN_MS;
    setShowDistractionPrompt(false);
    breakOriginRef.current = "prompt";
    setScreen("break");
  }

  function handleDismissPrompt() {
    logInterventionEvent("response", { response: "dismiss" });
    promptSuppressUntilRef.current = Date.now() + PROMPT_COOLDOWN_MS;
    setShowDistractionPrompt(false);
  }

  // Manually (re)trigger the Google Docs consent. The session-start attempt is
  // easy to miss (the popup is a separate window, or a stale grant fails
  // non-interactively); this forces an interactive auth on demand. On success
  // the next word-count sync flips docsConnected true and the banner clears.
  function handleConnectDocs() {
    if (typeof chrome === "undefined" || !chrome.runtime) return;
    setDocsConnecting(true);
    try {
      chrome.runtime.sendMessage({ type: "FF_ENSURE_DOCS_AUTH" }, () => {
        void chrome.runtime.lastError; // ignore; the poll reflects the real result
        // Leave "connecting" until a sync confirms; time-box it so a
        // dismissed popup doesn't spin forever.
        setTimeout(() => setDocsConnecting(false), 8000);
      });
    } catch (e) {
      setDocsConnecting(false);
    }
  }

  function handleFinishSession() {
    const finalElapsedSeconds = sessionStartTime
      ? Math.floor((Date.now() - sessionStartTime) / 1000)
      : elapsed;

    // Read the last ff_session snapshot to grab session-lifetime data before we clear storage
    function buildAndNavigate(sessionSnapshot = {}, suggestionChoices = [], interventionEvents = []) {
      // Finalize the suggestion tally. chosenIndex is the stance
      // (0 = goal-anchored, 1 = doc-driven, 2 = bridge); every remaining record
      // is a frozen per-episode choice, so summing by index gives the export
      // counts. suggestionChoices keeps the full record (incl. the not-chosen
      // options) for the study's data export.
      const suggestionTally = suggestionChoices.reduce((acc, c) => {
        if (typeof c.chosenIndex === "number") acc[c.chosenIndex] = (acc[c.chosenIndex] ?? 0) + 1;
        return acc;
      }, {});
      const finishedSummary = {
        participantId,
        taskName,
        objective,
        condition,
        startedAt: sessionStartTime,
        endedAt: Date.now(),
        elapsedSeconds: finalElapsedSeconds,
        totalBreakMs: sessionSnapshot.totalBreakMs ?? 0,
        totalInterruptedMs: sessionSnapshot.totalInterruptedMs ?? 0,
        // All behavioral fields read from the FRESH ff_session snapshot, not the
        // panel's React state (which lags up to one 2s poll). Mixing the two
        // made word count / WPM / pauses on the summary stale — and inconsistent
        // with the snapshot-sourced fields beside them. State is only a
        // dev-preview fallback (snapshot is {} when chrome.storage is absent).
        wordCount: sessionSnapshot.wordCount ?? words, // session-added doc words (API-anchored, incl. paste)
        totalDocWords: sessionSnapshot.totalDocWords ?? 0, // exact whole-doc count from the last Docs API sync
        typedWordCount: sessionSnapshot.typedWordCount ?? 0, // keystroke-typed only (excludes paste)
        wpm: sessionSnapshot.wpm ?? wpm,
        totalPauses: sessionSnapshot.totalPauses ?? totalPauses,
        longestPauseMs: sessionSnapshot.longestPauseMs ?? longestPause,
        burstCount: sessionSnapshot.burstCount ?? 0,
        avgBurstDurationSec: sessionSnapshot.avgBurstDurationSec ?? 0,
        tabSwitchCount: sessionSnapshot.tabSwitchCount ?? 0,
        totalTabAwayMs: sessionSnapshot.totalTabAwayMs ?? 0,
        // Session-lifetime revision counts (NOT the rolling 60s values, which
        // at finish would only describe the last minute). These are the raw
        // signals behind the Reviewing classification.
        totalDeletes: sessionSnapshot.totalDeletes ?? 0,
        totalSelections: sessionSnapshot.totalSelections ?? 0,
        scrollFrequency: sessionSnapshot.scrollFrequency ?? scrollFrequency,
        scrollFrequencyLabel: sessionSnapshot.scrollFrequencyLabel ?? scrollFrequencyLabel,
        phaseDurationsMs: sessionSnapshot.phaseDurationsMs ?? {},
        // distractionCount = occurrences (onset): matches the live tile and the
        // reminders, and includes any distraction still open at finish.
        // distractionsRecovered = episodes that closed on a resuming keystroke
        // (the ones with a resumptionMs); avgResumptionMs is averaged over those.
        distractionCount: sessionSnapshot.distractionOnsetCount ?? 0,
        distractionsRecovered: sessionSnapshot.distractionCount ?? 0,
        distractionEpisodes: sessionSnapshot.distractionEpisodes ?? [],
        avgResumptionMs: sessionSnapshot.avgResumptionMs ?? 0,
        suggestionChoices,
        suggestionTally,
        interventionEvents,
      };
      setSummary(finishedSummary);

      if (typeof chrome !== "undefined" && chrome.storage) {
        // Send before clearing ff_task — sendToTaskTab needs its tabId.
        sendToTaskTab({ type: "FF_CANCEL_TASK" });

        // SAFETY NET (study-critical): everything below is about to be cleared,
        // and finishedSummary otherwise lives only in React state — so closing
        // the panel on the analytics screen before downloading would lose the
        // participant's whole session with no way back. This copy survives until
        // the NEXT session finishes and overwrites it, so a missed download is
        // recoverable from the task-setup screen. Deliberately NOT cleared by
        // handleStartTask or handleCancelTask.
        chrome.storage.local.set({ ff_lastSummary: finishedSummary });

        chrome.storage.local.remove("ff_task");
        chrome.storage.local.remove("ff_session");
        chrome.storage.local.remove("ff_idle");
        chrome.storage.local.remove("ff_recovery");
        chrome.storage.local.remove("ff_generating");
        chrome.storage.local.remove("ff_suggestion_choices");
        chrome.storage.local.remove("ff_events");
      }

      setScreen("analytics");
    }

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(["ff_session", "ff_suggestion_choices", "ff_events"], (result) => {
        buildAndNavigate(result.ff_session ?? {}, result.ff_suggestion_choices ?? [], result.ff_events ?? []);
      });
    } else {
      buildAndNavigate({}, [], []);
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
            // Doc total comes from the Docs API; without OAuth it stays 0,
            // so fall back to the session's (keystroke-tracked) word count.
            { label: "Words", value: totalDocWords > 0 ? totalDocWords : words },
            { label: "WPM", value: wpm },
            { label: "Pauses", value: totalPauses },
            { label: "Longest Pause", value: `${longestPauseSec}s` },
            { label: "Scroll Frequency", value: `${scrollFrequencyLabel} (${scrollFrequency}/min)` },
            { label: "Distractions", value: distractionCount },
          ].map(s => (
            <div key={s.label} style={{ background: "#F7FAF9", borderRadius: 10, padding: "10px 10px 8px", border: `1px solid ${TEAL[50]}` }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</p>
              <p style={{ margin: "3px 0 0", fontSize: 17, fontWeight: 700, color: TEAL[800] }}>{s.value}</p>
            </div>
          ))}
        </div>
        {/* Docs connection banner — only once past a short grace (so it
            doesn't flash before the first word-count sync lands) and only
            while genuinely not connected. */}
        {elapsed >= 5 && !docsConnected && (
          <div style={{ background: "#FFF8F0", border: "1px solid #FDDCB5", borderRadius: 10, padding: "10px 12px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "#B45309" }}>Google Docs not connected</p>
              <p style={{ margin: 0, fontSize: 11, color: "#92400E", lineHeight: 1.5 }}>
                Word count is approximate and won't include pasted text. Connect to enable the exact count.
              </p>
            </div>
            <Btn variant="outline" style={{ fontSize: 12, padding: "7px 12px", flexShrink: 0 }} onClick={handleConnectDocs}>
              {docsConnecting ? "Connecting…" : "Connect"}
            </Btn>
          </div>
        )}
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
        {/* Chosen next step (current recovery episode) */}
        {activeStep && (
          <>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Your next step</p>
            <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 14, border: `1px solid ${TEAL[200]}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 18, height: 18, borderRadius: 999, background: TEAL[400], display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.2 2.2L9.5 3.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#444", lineHeight: 1.5 }}>{activeStep}</p>
            </div>
          </>
        )}
        {/* Task context */}
        <p style={{ fontSize: 11, fontWeight: 600, color: "#717182", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Active context</p>
        <div style={{ background: TEAL[50], borderRadius: 10, padding: "10px 12px", border: `1px solid ${TEAL[100]}`, marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TEAL[800] }}>{taskName}</p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>
            {objective} {totalDocWords > 0 ? `· ${totalDocWords} words` : ""} </p>
        </div>
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" style={{ flex: 1, fontSize: 12 }} onClick={() => { breakOriginRef.current = "voluntary"; logInterventionEvent("voluntary_break"); setScreen("break"); }}>Take a break</Btn>
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

// A generation-in-flight marker older than this is treated as dead (e.g. the
// service worker was killed mid-call and never cleared it).
const GENERATING_STALE_MS = 30000;

function RecoveryScreen({ setScreen }) {
  const [taskName, setTaskName] = useState("");
  const [objective, setObjective] = useState("");
  const [summary, setSummary] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  // Whether a Gemini API key is configured. When absent, no summary can ever
  // generate, so the empty state says so (a config fix) instead of implying
  // one is coming. Defaults true so the "no key" notice doesn't flash before
  // ff_settings is read.
  const [hasApiKey, setHasApiKey] = useState(true);
  // Which of the 3 suggestions this episode's choice currently sits on (null =
  // no pick yet). Reloaded from the choice log so revisiting via "View last
  // recovery summary" shows — and lets the participant change — their pick.
  const [selectedIndex, setSelectedIndex] = useState(null);

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(["ff_task", "ff_recovery", "ff_generating", "ff_suggestion_choices", "ff_settings"], (result) => {
        setHasApiKey(!!result.ff_settings?.geminiApiKey);
        const t = result.ff_task;
        const r = result.ff_recovery;
        if (t) {
          setTaskName(t.taskName ?? "");
          setObjective(t.objective ?? "");
        }
        if (r) {
          setSummary({
            whatYouWereDoing: r.whatYouWereDoing,
            whereYouLeftOff: r.whereYouLeftOff,
            suggestions: r.suggestedNextSteps ?? [],
            generatedAt: r.generatedAt,
          });
          const prior = Array.isArray(result.ff_suggestion_choices)
            ? result.ff_suggestion_choices.find((c) => c.generatedAt === r.generatedAt)
            : null;
          setSelectedIndex(prior ? prior.chosenIndex : null);
        }
        setGenerating(typeof result.ff_generating === "number" && Date.now() - result.ff_generating < GENERATING_STALE_MS);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  function handleSelectSuggestion(i) {
    if (!summary) return;
    setSelectedIndex(i);
    recordSuggestionChoice({ generatedAt: summary.generatedAt, chosenIndex: i, options: summary.suggestions });
  }

  // Generation is often still in flight when the user arrives here (it
  // starts when the Distracted episode starts) — show a generating state
  // and swap in the real summary the moment background.js writes it.
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    function onStorageChange(changes, area) {
      if (area !== "local") return;
      if (changes.ff_recovery?.newValue) {
        const r = changes.ff_recovery.newValue;
        setSummary({
          whatYouWereDoing: r.whatYouWereDoing,
          whereYouLeftOff: r.whereYouLeftOff,
          suggestions: r.suggestedNextSteps ?? [],
          generatedAt: r.generatedAt,
        });
        // A freshly generated episode has no pick yet; the previous episode's
        // record is left frozen in the log for the tally.
        setSelectedIndex(null);
      }
      if ("ff_generating" in changes) {
        const v = changes.ff_generating.newValue;
        setGenerating(typeof v === "number" && Date.now() - v < GENERATING_STALE_MS);
      }
    }
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title="FrictionFlow" subtitle="Welcome back!" />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <div style={{ background: TEAL[50], borderRadius: 12, padding: "12px 13px", marginBottom: 14, border: `1px solid ${TEAL[100]}` }}>
          <p style={{ margin: "0 0 3px", fontSize: 12, fontWeight: 700, color: TEAL[800] }}>{taskName || "Untitled task"}</p>
          <p style={{ margin: 0, fontSize: 11, color: TEAL[600] }}>{objective}</p>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#717182", fontSize: 12 }}>
            Loading recovery summary…
          </div>
        ) : generating ? (
          // While a fresh summary is generating, never show the previous
          // (now-outdated) one — the whole point is current context. If
          // generation fails, ff_generating clears and we fall back to
          // whatever summary exists below.
          <div style={{ textAlign: "center", padding: "36px 0" }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, border: `3px solid ${TEAL[100]}`, borderTopColor: TEAL[400], animation: "spin 0.9s linear infinite", margin: "0 auto 14px" }} />
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TEAL[600] }}>Generating your recovery summary…</p>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#717182" }}>Reading your recent activity and progress</p>
          </div>
        ) : summary ? (
          <RecoverySummaryContent summary={summary} selectedIndex={selectedIndex} onSelect={handleSelectSuggestion} />
        ) : !hasApiKey ? (
          // No API key → summaries can never generate. Say so (a setup fix),
          // rather than implying one is on the way.
          <div style={{ textAlign: "center", padding: "36px 16px" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF8F0", border: "1px solid #FDDCB5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 20 20"><path d="M10 6v5M10 14h.01" stroke="#F4A261" strokeWidth="2" strokeLinecap="round" /></svg>
            </div>
            <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600, color: "#030213" }}>AI recovery summaries are off</p>
            <p style={{ margin: 0, fontSize: 11, color: "#717182", lineHeight: 1.6, maxWidth: 250, marginLeft: "auto", marginRight: "auto" }}>
              No Gemini API key is configured. A researcher can add one on the extension's Options page to enable recovery summaries. You can head back and keep writing.
            </p>
          </div>
        ) : (
          // Honest empty state — no filler content pretending to be a real
          // summary (generation failed, or no episode yet).
          <div style={{ textAlign: "center", padding: "36px 16px" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#F7FAF9", border: `1px solid ${TEAL[100]}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <svg width="18" height="18" fill="none" viewBox="0 0 18 18"><path d="M3 9h12M9 3v12" stroke={TEAL[200]} strokeWidth="1.6" strokeLinecap="round" opacity="0.6" transform="rotate(45 9 9)"/></svg>
            </div>
            <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600, color: "#030213" }}>No recovery summary yet</p>
            <p style={{ margin: 0, fontSize: 11, color: "#717182", lineHeight: 1.6, maxWidth: 240, marginLeft: "auto", marginRight: "auto" }}>
              A summary is generated when a distraction is detected or a break starts. You can head back and continue writing.
            </p>
          </div>
        )}
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

// A voluntary break shorter than this is a false start (misclick, quick
// stretch), not a real break: it's logged as a pause only, generates no
// recovery summary, and returns straight to monitoring. Matches content.js's
// PAUSE_THRESHOLD_MS — below it, the gap wouldn't even qualify as a pause
// worth special treatment.
const SHORT_BREAK_THRESHOLD_MS = 30000;

function BreakScreen({ setScreen, setHasRecoverySummary, breakOriginRef }) {
  const [secs, setSecs] = useState(0);
  const breakStartRef = useRef(Date.now()); // track when break started for totalBreakMs
  // Read inside effects/handlers only (never during render): the origin is
  // fixed for the lifetime of this mount, set by whichever control opened it.
  const isPromptBreak = () => breakOriginRef?.current === "prompt";

  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Suspend behavioral tracking for the duration of the break so break time
  // doesn't pollute phase durations, pauses, or distraction episodes.
  useEffect(() => {
    sendToTaskTab({ type: "FF_BREAK_START" });

    // Pre-generate a recovery summary for AFTER the break, so "what you were
    // doing / where you left off / next steps" survive the memory gap. All
    // gates (baseline condition, no key, concurrency) live in background.js —
    // fire and forget, must never affect the break.
    //
    // Timing depends on the break's origin: prompt-path breaks generate
    // immediately (a distraction already happened); voluntary breaks wait out
    // SHORT_BREAK_THRESHOLD_MS first — a sub-30s break is only a pause, and
    // generating for it would waste a call on a summary nobody will see.
    // Ending the break early unmounts this screen and cancels the timer.
    function requestGeneration() {
      if (typeof chrome !== "undefined" && chrome.runtime) {
        try {
          chrome.runtime.sendMessage({ type: "FF_CHECK_STUCK", reason: "break" }, () => void chrome.runtime.lastError);
        } catch (e) {
          // dev preview / dead context — the break itself is unaffected
        }
      }
    }

    if (isPromptBreak()) {
      requestGeneration();
      return;
    }
    const genTimer = setTimeout(requestGeneration, SHORT_BREAK_THRESHOLD_MS);
    return () => clearTimeout(genTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleContinue() {
    const breakMs = Date.now() - breakStartRef.current;
    const promptBreak = isPromptBreak();
    const isShortVoluntary = !promptBreak && breakMs < SHORT_BREAK_THRESHOLD_MS;

    // Ends the tracking suspension and tells content.js how to account for
    // this break (logged in both conditions):
    //   prompt break        → break only (the distraction episode already
    //                         represents the event — a pause would double-count)
    //   voluntary >= 30s    → break AND pause (self-initiated disengagement)
    //   voluntary < 30s     → pause only (false start, not a real break)
    sendToTaskTab({
      type: "FF_BREAK_END",
      breakMs,
      countAsBreak: !isShortVoluntary,
      countAsPause: !promptBreak,
    });

    // A short voluntary break generated nothing (the timer was cancelled) —
    // straight back to monitoring, no recovery screen in either condition.
    if (isShortVoluntary) {
      setScreen("monitoring");
      return;
    }

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

// ─── Screen 7: Post-session questionnaires ───────────────────────────────────

// One row of discrete choices. Used for FSS (1-7, numbered) and UEQ-S (-3..+3,
// unlabelled circles, the semantic-differential convention).
function ScaleRow({ points, value, onChange, showNumbers }) {
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "space-between", marginTop: 5 }}>
      {points.map((p) => {
        const on = value === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={{ flex: 1, minWidth: 0, height: 26, borderRadius: 999, cursor: "pointer", fontSize: 10, fontWeight: 700, background: on ? TEAL[400] : "#fff", color: on ? "#fff" : "#717182", border: `1px solid ${on ? TEAL[400] : TEAL[100]}` }}
          >
            {showNumbers ? p : ""}
          </button>
        );
      })}
    </div>
  );
}

function SurveyScreen({ initial, onDone, onBack }) {
  const [step, setStep] = useState(0); // 0 = NASA-TLX, 1 = FSS, 2 = UEQ-S
  // Prefilled from a previously completed survey so "review" actually reviews.
  // Starting blank here meant re-submitting silently REPLACED good answers with
  // whatever was re-entered — worse than not offering review at all.
  const [tlx, setTlx] = useState(() => ({ ...(initial?.tlx?.items ?? {}) }));
  const [fss, setFss] = useState(() => ({ ...(initial?.fss?.items ?? {}) }));
  const [ueqs, setUeqs] = useState(() => ({ ...(initial?.ueqs?.items ?? {}) }));
  const [error, setError] = useState(false);

  // Every item must be answered before advancing. TLX sliders start UNSET
  // rather than at 50 — a pre-filled midpoint would let a participant skip an
  // item without noticing, and it would be indistinguishable from a real 50.
  const complete = [
    TLX_ITEMS.every((i) => typeof tlx[i.id] === "number"),
    FSS_ITEMS.every((_, i) => typeof fss[i + 1] === "number"),
    UEQS_ITEMS.every((_, i) => typeof ueqs[i + 1] === "number"),
  ];

  const titles = ["Workload (NASA-TLX)", "Flow (FSS)", "Experience (UEQ-S)"];
  const intros = [
    "Rate your experience of the writing session you just finished.",
    "How well do these statements describe how you felt while writing?",
    "Rate the FrictionFlow extension itself on each pair.",
  ];

  function handleNext() {
    if (!complete[step]) { setError(true); return; }
    setError(false);
    if (step < 2) { setStep(step + 1); return; }
    onDone(scoreSurvey({ tlx, fss, ueqs }));
  }

  function handleBack() {
    setError(false);
    if (step === 0) { onBack(); return; }
    setStep(step - 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SidePanelHeader title={initial ? "Review answers" : "Questionnaire"} subtitle={`Step ${step + 1} of 3 · ${titles[step]}`} />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <p style={{ margin: "0 0 14px", fontSize: 11, color: "#717182", lineHeight: 1.6 }}>{intros[step]}</p>

        {step === 0 && TLX_ITEMS.map((item) => (
          <div key={item.id} style={{ marginBottom: 15 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#030213" }}>{item.label}</p>
              <span style={{ fontSize: 11, fontWeight: 700, color: typeof tlx[item.id] === "number" ? TEAL[600] : "#B4B4BB" }}>
                {typeof tlx[item.id] === "number" ? tlx[item.id] : "—"}
              </span>
            </div>
            <p style={{ margin: "2px 0 6px", fontSize: 11, color: "#717182", lineHeight: 1.5 }}>{item.question}</p>
            <input
              type="range" min={0} max={100} step={5}
              value={typeof tlx[item.id] === "number" ? tlx[item.id] : 50}
              onChange={(e) => setTlx({ ...tlx, [item.id]: Number(e.target.value) })}
              style={{ width: "100%", accentColor: TEAL[400], opacity: typeof tlx[item.id] === "number" ? 1 : 0.45 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#717182" }}>
              <span>{item.low}</span><span>{item.high}</span>
            </div>
          </div>
        ))}

        {step === 1 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#717182", marginBottom: 8 }}>
              <span>1 · Not at all</span><span>Very much · 7</span>
            </div>
            {FSS_ITEMS.map((text, i) => (
              <div key={i} style={{ marginBottom: 13 }}>
                <p style={{ margin: 0, fontSize: 11, color: "#030213", lineHeight: 1.5 }}>{i + 1}. {text}</p>
                <ScaleRow points={[1, 2, 3, 4, 5, 6, 7]} value={fss[i + 1]} onChange={(v) => setFss({ ...fss, [i + 1]: v })} showNumbers />
              </div>
            ))}
          </>
        )}

        {step === 2 && UEQS_ITEMS.map((pair, i) => (
          <div key={i} style={{ marginBottom: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#030213" }}>
              <span>{pair.left}</span><span>{pair.right}</span>
            </div>
            <ScaleRow points={[-3, -2, -1, 0, 1, 2, 3]} value={ueqs[i + 1]} onChange={(v) => setUeqs({ ...ueqs, [i + 1]: v })} />
          </div>
        ))}

        {error && (
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#E5484D", lineHeight: 1.5 }}>
            Please answer every item before continuing.
          </p>
        )}
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", gap: 8 }}>
        <Btn variant="outline" style={{ flex: 1 }} onClick={handleBack}>{step === 0 ? "Cancel" : "Back"}</Btn>
        <Btn variant="primary" style={{ flex: 1 }} onClick={handleNext}>{step === 2 ? "Finish" : "Next"}</Btn>
      </div>
    </div>
  );
}

// ─── Screen 6: Session Analytics ─────────────────────────────────────────────

function AnalyticsScreen({ setScreen, summary }) {
  const s = summary ?? {};

  const totalSecs = s.elapsedSeconds ?? 0;
  const breakSecs = Math.floor((s.totalBreakMs ?? 0) / 1000);
  // Time the Docs tab was closed/away (fully offline, untracked).
  const interruptedSecs = Math.floor((s.totalInterruptedMs ?? 0) / 1000);
  // Writing time = Translating + Reviewing — the phases where the participant is
  // actually working on the text (producing it, or re-reading/revising it), per
  // Flower & Hayes (1981). Planning and Distracted are deliberately excluded:
  // the old "total − breaks − offline" counted both, so on a session with no
  // breaks it came out identical to Total time. Neither is lost — both still
  // appear as their own slice in the phase breakdown below.
  const translatingSecs = Math.round((s.phaseDurationsMs?.Translating ?? 0) / 1000);
  const reviewingSecs = Math.round((s.phaseDurationsMs?.Reviewing ?? 0) / 1000);
  const writingSecs = translatingSecs + reviewingSecs;

  function fmt(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const avgResumptionSecs = Math.round((s.avgResumptionMs ?? 0) / 1000);

  // Whole-document word count from the Docs API — matches the monitoring
  // "Words" tile. Falls back to the session-added keystroke count if the API
  // wasn't connected (totalDocWords stays 0 without OAuth).
  const docWords = (s.totalDocWords ?? 0) > 0 ? s.totalDocWords : (s.wordCount ?? 0);
  const typedWords = s.typedWordCount ?? 0; // keystroke-typed words (excludes paste)

  // The tile shows the FOCUSED rate: typed words (paste can't inflate them) over
  // active drafting only (Translating), where new text is actually produced, so
  // it reflects genuine typing pace. The OVERALL rate (over Translating +
  // Reviewing) is shown in the tile's hover breakdown; both are exported.
  const avgWpmFocused = translatingSecs > 0 ? Math.round(typedWords / (translatingSecs / 60)) : 0;
  const avgWpmOverall = writingSecs > 0 ? Math.round(typedWords / (writingSecs / 60)) : 0;
  // Whole-session rate: same typed words over total wall-clock time, so breaks,
  // planning and distracted time all count against it. The lowest of the three.
  const avgWpmSession = totalSecs > 0 ? Math.round(typedWords / (totalSecs / 60)) : 0;

  // ── Values used only by the hover breakdowns ──
  // The tiles show one headline number each; the adviser asked for the
  // components behind them to be inspectable without opening the export.
  const planningSecs = Math.round((s.phaseDurationsMs?.Planning ?? 0) / 1000);
  const distractedSecs = Math.round((s.phaseDurationsMs?.Distracted ?? 0) / 1000);
  const tabAwaySecs = Math.round((s.totalTabAwayMs ?? 0) / 1000);
  // Only CLOSED episodes are in this array, so it's the recovered set.
  const episodes = s.distractionEpisodes ?? [];
  const recoveredCount = s.distractionsRecovered ?? episodes.length;
  const triggerCount = (t) => episodes.filter((e) => e.trigger === t).length;
  const resumptionSecsList = episodes.map((e) => Math.round((e.resumptionMs ?? 0) / 1000));
  const events = Array.isArray(s.interventionEvents) ? s.interventionEvents : [];
  const promptedBreaks = events.filter((e) => e.type === "response" && e.response === "take_a_break").length;
  const voluntaryBreaks = events.filter((e) => e.type === "voluntary_break").length;

  // Stats backed by real tracked data from content.js
  const stats = [
    { label: "Total time", value: fmt(totalSecs), icon: "⏱",
      detail: {
        rows: [
          { label: "Writing", value: fmt(writingSecs) },
          { label: "Planning", value: fmt(planningSecs) },
          { label: "Distracted", value: fmt(distractedSecs) },
          { label: "Breaks", value: fmt(breakSecs) },
          ...(interruptedSecs > 0 ? [{ label: "Offline", value: fmt(interruptedSecs) }] : []),
        ],
        note: "Parts won't sum to the total — tracking pauses during breaks and offline time.",
      } },
    { label: "Writing time", value: fmt(writingSecs), icon: "✍️",
      detail: {
        rows: [
          { label: "Translating (drafting)", value: fmt(translatingSecs) },
          { label: "Reviewing (revising)", value: fmt(reviewingSecs) },
        ],
      } },
    { label: "Doc words", value: docWords, icon: "📝",
      detail: {
        rows: [
          // "—" not 0 when the Docs API never connected: totalDocWords stays 0
          // in that case, and printing 0 asserts the document is EMPTY when the
          // truth is that we never found out. The headline silently falls back
          // to the keystroke estimate here, so the panel must show the gap.
          { label: "Whole document", value: (s.totalDocWords ?? 0) > 0 ? s.totalDocWords : "—" },
          // Siblings, NOT a parent with a split: these two count different
          // things (Docs API word boundaries vs keystrokes/5), so "typed" can
          // legitimately exceed "added" — a word extended in place grows the
          // keystroke estimate but not the document's word count. An "added
          // minus typed = pasted" row was here and was wrong: it implied a
          // decomposition that only holds when the API count runs ahead.
          { label: "Added this session", value: s.wordCount ?? 0 },
          { label: "Typed", value: typedWords },
        ],
      } },
    { label: "Typed words", value: typedWords, icon: "⌨️",
      detail: {
        rows: [
          // No row for typedWords itself — it's the headline directly above.
          // Same wording as the Doc words tile: it's the same quantity.
          { label: "Added this session", value: s.wordCount ?? 0 },
          // Units spelled out: these are keypress/gesture counts sitting beside
          // word counts, and "Deletions: 47" reads as 47 words otherwise.
          { label: "Delete keypresses", value: s.totalDeletes ?? 0 },
          { label: "Text selections", value: s.totalSelections ?? 0 },
        ],
        note: "Counted from keystrokes, so pasted text is excluded.",
      } },
    { label: "Avg. WPM", value: avgWpmFocused, icon: "⚡",
      detail: {
        rows: [
          // Same typed words over three widening time bases, named after the
          // phases in the chart below. The duplication with the headline is the
          // point here — it's a comparison set, so the reader can see which
          // base the tile uses. No rows for the inputs (typed words, phase
          // durations): those are breakdowns of other tiles, not of this one.
          { label: "Translating only", value: avgWpmFocused },
          { label: "Translating + reviewing", value: avgWpmOverall },
          { label: "Whole session", value: avgWpmSession },
        ],
      } },
    { label: "Pauses", value: s.totalPauses ?? 0, icon: "⏸",
      detail: {
        rows: [
          { label: "Longest pause", value: fmt(Math.round((s.longestPauseMs ?? 0) / 1000)) },
          { label: "Typing bursts", value: s.burstCount ?? 0 },
          { label: "Avg. burst length", value: fmt(s.avgBurstDurationSec ?? 0) },
        ],
      } },
    { label: "Break time", value: fmt(breakSecs), icon: "☕",
      detail: {
        rows: [
          { label: "Voluntary breaks", value: voluntaryBreaks },
          { label: "Prompted breaks", value: promptedBreaks },
        ],
      } },
    { label: "Distractions", value: s.distractionCount ?? 0, icon: "💥",
      detail: {
        rows: [
          { label: "Recovered", value: recoveredCount },
          // Indented under Recovered, NOT under the headline: trigger counts
          // come from closed episodes only, so they sum to recovered. Listed
          // flat they looked like a breakdown of occurrences that didn't add up.
          { label: "Left the tab", value: triggerCount("tab-away"), indent: true },
          { label: "Idle on the doc", value: triggerCount("idle"), indent: true },
          { label: "Rapid switching", value: triggerCount("rapid-switch"), indent: true },
          // Tab switch COUNT was dropped: most switches never become a
          // distraction, so it isn't a breakdown of this tile. Time off-tab
          // stays — it quantifies the dominant trigger above it.
          { label: "Time off-tab", value: fmt(tabAwaySecs) },
        ],
      } },
    // Guard on RECOVERED episodes (not occurrences): if the only distraction was
    // still open at finish, there's no resumption time to average, so show "—".
    { label: "Avg. recovery", value: episodes.length > 0 ? fmt(avgResumptionSecs) : "—", icon: "🎯",
      detail: {
        rows: [
          { label: "Fastest", value: resumptionSecsList.length > 0 ? fmt(Math.min(...resumptionSecsList)) : "—" },
          { label: "Slowest", value: resumptionSecsList.length > 0 ? fmt(Math.max(...resumptionSecsList)) : "—" },
          { label: "Episodes measured", value: episodes.length },
        ],
      } },
    // Only surfaced when the session was interrupted (Docs tab closed/left),
    // so a clean session's grid stays uncluttered.
    // No detail: the only thing to say is the number already on the tile.
    ...(interruptedSecs > 0 ? [{ label: "Offline", value: fmt(interruptedSecs), icon: "🔌" }] : []),
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

  // Which tile's breakdown is showing (by label; null = none).
  const [openStat, setOpenStat] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  function handleExport() {
    const { json, csv, base } = buildSessionExport(s);
    downloadFile(`${base}.json`, JSON.stringify(json, null, 2), "application/json");
    // Small stagger so the browser reliably fires both downloads in a row.
    setTimeout(() => downloadFile(`${base}.csv`, csv, "text/csv"), 400);
    setDownloaded(true);
    // Stamp the persisted copy as retrieved, so the setup screen stops flagging
    // it as an un-downloaded session.
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ ff_lastSummary: { ...s, downloadedAt: Date.now() } });
    }
  }

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
          {stats.map((st, i) => {
            // A tile with no detail never highlights or opens — it just sits there.
            const open = openStat === st.label && !!st.detail;
            // Tiles on the last row open UPWARD — a panel hanging below them
            // would sit at the bottom edge of the scroll area, half off-screen.
            // The last row holds 2 tiles on an even count, 1 on an odd one.
            const openUp = i >= stats.length - (stats.length % 2 === 0 ? 2 : 1);
            // Left column anchors left, right column anchors right, so a panel
            // wider than its tile still can't overflow the narrow side panel.
            const anchorRight = i % 2 === 1;
            return (
              <div
                key={st.label}
                onMouseEnter={() => setOpenStat(st.label)}
                onMouseLeave={() => setOpenStat(null)}
                onFocus={() => setOpenStat(st.label)}
                onBlur={() => setOpenStat(null)}
                // Click toggles too: hover alone is unreachable by keyboard and
                // unreliable on a trackpad-less setup during a study session.
                onClick={() => setOpenStat(open ? null : st.label)}
                tabIndex={st.detail ? 0 : undefined}
                style={{ position: "relative", background: "#F7FAF9", borderRadius: 10, padding: "9px 10px", border: `1px solid ${open ? TEAL[200] : TEAL[50]}`, cursor: st.detail ? "help" : "default", outline: "none" }}
              >
                <p style={{ margin: 0, fontSize: 16 }}>{st.icon}</p>
                <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700, color: TEAL[800] }}>{st.value}</p>
                <p style={{ margin: "1px 0 0", fontSize: 10, color: "#717182" }}>{st.label}</p>
                {open && st.detail && (
                  // The wrapper carries the gap as PADDING, not margin, so the
                  // pointer never crosses dead space (which would fire
                  // mouseleave and close the panel on the way to reading it).
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: "absolute", zIndex: 20, width: 216, [anchorRight ? "right" : "left"]: 0, [openUp ? "bottom" : "top"]: "100%", [openUp ? "paddingBottom" : "paddingTop"]: 6, textAlign: "left", cursor: "default" }}
                  >
                    <div style={{ background: "#fff", border: `1px solid ${TEAL[200]}`, borderRadius: 10, padding: "9px 11px", boxShadow: "0 6px 18px rgba(0,0,0,0.10)" }}>
                      <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, color: "#030213", textTransform: "uppercase", letterSpacing: "0.05em" }}>{st.label}</p>
                      {st.detail.rows.map(r => (
                        // Sub-rows are indented with real padding + a rule, not
                        // a leading "—": that character already means "no value"
                        // in these panels (Fastest/Slowest with no episodes).
                        <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 3, paddingLeft: r.indent ? 9 : 0, borderLeft: r.indent ? `2px solid ${TEAL[100]}` : "none" }}>
                          <span style={{ fontSize: 10, color: "#717182", lineHeight: 1.5 }}>{r.label}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: TEAL[800], flexShrink: 0, lineHeight: 1.5 }}>{r.value}</span>
                        </div>
                      ))}
                      {/* A note only earns its place when a number would
                          otherwise read as a bug (parts that don't sum, a
                          count that looks too low). Most rows explain
                          themselves from their label, so most have none. */}
                      {st.detail.note && (
                        <p style={{ margin: "7px 0 0", paddingTop: 6, borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 10, color: "#717182", lineHeight: 1.55 }}>{st.detail.note}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: TEAL[800] }}>
            {dominantPhase && dominantPhase.label !== "Distracted" ? "Great session!" : "Session complete"}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: TEAL[600], lineHeight: 1.5 }}>
            {!dominantPhase
              ? "Start a new session to build up your phase breakdown."
              : dominantPhase.label === "Distracted"
                ? "Most of this session was spent away from the task — shorter sessions or fewer open tabs might help next time."
                : `You spent most of your time in the ${dominantPhase.label.toLowerCase()} phase${dominantPhase.label === "Translating" ? " — a sign of productive flow." : "."}`}
          </p>
        </div>
      </div>
      <div style={{ padding: 16, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* The export embeds questionnaire responses, so downloading first
            yields an incomplete file. Only ONE action is primary at a time,
            walking the researcher through questionnaire → download → next task.
            The gate is deliberately soft: a hard block would strand the
            behavioral data whenever a participant can't finish the scales, so
            the skip stays available as a plain link rather than a button. */}
        <Btn variant={s.survey ? "outline" : "primary"} style={{ width: "100%" }} onClick={() => setScreen("survey")}>
          {s.survey ? "Review answers ✓" : "Complete questionnaire (3 short scales)"}
        </Btn>
        {s.survey ? (
          <Btn variant={downloaded ? "outline" : "primary"} style={{ width: "100%" }} onClick={handleExport}>
            {downloaded ? "Downloaded ✓ — download again" : "Download session data (JSON + CSV)"}
          </Btn>
        ) : (
          <button onClick={handleExport} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#717182", textDecoration: "underline", padding: "2px 0", alignSelf: "center" }}>
            Download without questionnaire
          </button>
        )}
        <Btn variant={downloaded ? "primary" : "outline"} style={{ width: "100%" }} onClick={() => setScreen("init")}>Start new task</Btn>
      </div>
    </div>
  );
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function PopupView({ screen, setScreen, summary, setSummary, hasRecoverySummary, setHasRecoverySummary, showDistractionPrompt, setShowDistractionPrompt, promptSuppressUntilRef, lastDistractionOnsetRef, breakOriginRef }) {
  const screenMap = {
    init: <TaskInitScreen onStart={(mode) => {
      setHasRecoverySummary(false);
      setShowDistractionPrompt(false);
      promptSuppressUntilRef.current = 0;
      lastDistractionOnsetRef.current = null;
      if (mode === "resume") {
        // resumeTaskTracking reads ff_interrupted to measure the offline gap,
        // then clears it once resume is confirmed — so it must NOT be removed
        // here first (that race previously discarded the timestamp).
        resumeTaskTracking(); // content script may have been re-injected — restart tracking
        setScreen("monitoring");
      } else {
        // Fresh start: handleStartTask already clears ff_interrupted.
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
      promptSuppressUntilRef={promptSuppressUntilRef}
      lastDistractionOnsetRef={lastDistractionOnsetRef}
      breakOriginRef={breakOriginRef}
    />,
    recovery: <RecoveryScreen setScreen={setScreen} />,
    survey: <SurveyScreen
      initial={summary?.survey}
      onBack={() => setScreen("analytics")}
      onDone={(survey) => {
        // Fold the responses into the summary so the existing export picks them
        // up, and mirror to ff_lastSummary so a questionnaire completed but not
        // downloaded is still recoverable from the setup screen.
        const next = { ...(summary ?? {}), survey };
        setSummary(next);
        if (typeof chrome !== "undefined" && chrome.storage) {
          chrome.storage.local.set({ ff_lastSummary: next });
        }
        setScreen("analytics");
      }}
    />,
    break: <BreakScreen setScreen={setScreen} setHasRecoverySummary={setHasRecoverySummary} breakOriginRef={breakOriginRef} />,
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
  // Timestamp until which the reminder stays suppressed after a dismiss (0 = not
  // suppressed). A timestamp, not a boolean, so dismissing silences the current
  // instance for PROMPT_COOLDOWN_MS without permanently disabling detection.
  const promptSuppressUntilRef = useRef(0);
  // Highest distractionOnsetCount the panel has already reacted to, so each NEW
  // episode re-arms the reminder exactly once. Null until the first storage read
  // establishes the baseline.
  const lastDistractionOnsetRef = useRef(null);
  // How the current break was entered: "voluntary" (Take a break button) or
  // "prompt" (the distraction prompt's Take a Break option). Lifted here
  // because it's set in ActiveMonitoringScreen and read in BreakScreen —
  // it decides pause-vs-break accounting and summary-generation timing.
  const breakOriginRef = useRef("voluntary");

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
          promptSuppressUntilRef={promptSuppressUntilRef}
          lastDistractionOnsetRef={lastDistractionOnsetRef}
          breakOriginRef={breakOriginRef}
        />
      </div>
    </div>
  );
}
