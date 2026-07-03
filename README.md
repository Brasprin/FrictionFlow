# FrictionFlow

**Supporting Focus Recovery and Re-engagement from Cognitive Disruptions**

FrictionFlow is a Chrome extension (Manifest V3) that supports students in recovering focus during academic writing tasks in Google Docs. Instead of blocking distractions, it passively logs writing behavior (typing, pauses, scrolling, tab switches), infers the writer's current cognitive phase — Planning, Translating, Reviewing, or Distracted (Flower & Hayes, 1981) — and offers contextual recovery prompts when disengagement is detected.

Developed as a BS Computer Science (Software Technology) thesis at De La Salle University Manila by Oliver Aldrin H. Arucan, Aljirah Brendl Y. Resurreccion, and Andrei G. Tamse, advised by Jordan Aiko P. Deja, PhD.

---

## Requirements

- **Google Chrome** (the extension uses the MV3 side panel API — use Chrome for smooth operation)
- **Node.js** ≥ 18 and npm

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

```bash
npm run build
```

This compiles the React side-panel UI and copies `public/` (manifest, content script, background worker) into `dist/`. The `dist/` folder is the actual loadable extension.

For active development, use watch mode so every save rebuilds automatically:

```bash
npm run build -- --watch
```

### 3. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the **`dist/`** folder inside this project

### 4. Use it

1. Open a document at [docs.google.com](https://docs.google.com)
2. Click the FrictionFlow icon in the toolbar — the side panel opens, docked next to the doc
3. Enter a task name and objective, choose the session condition, and hit **Start Task**
4. Write. The panel shows live stats (time, words, WPM, pauses, detected phase, distractions)
5. Hit **Finish session** for the session analytics summary

## Reloading after changes

Which reload you need depends on what changed:

| What changed | What to do |
|---|---|
| `src/` (React UI) | Rebuild → close and reopen the side panel |
| `public/background.js` or `public/manifest.json` | Rebuild → reload the extension (↻ on `chrome://extensions`) |
| `public/content.js` | Rebuild → reload the extension **and refresh the Google Docs tab** (content scripts only inject on page load) |
| Manifest permissions acting strange | Remove and re-add the unpacked extension (last resort) |

> Note: `npm run build -- --watch` handles the rebuild step, but Chrome-side reloads are still manual.

## Study conditions

The session condition toggle on the task setup screen is the experiment's independent variable:

- **Baseline** — behavioral data is logged, but no recovery prompts ever appear (control condition)
- **Intervention** — a "Gentle Reminder" prompt appears when the system detects distraction, offering *Get Back to Work* (recovery summary), *Take a Break* (timed break, tracking suspended), or *Dismiss*

Behavioral logging is identical in both conditions.

## Architecture

```
┌─────────────────────┐   chrome.storage.local    ┌──────────────────────┐
│  content.js         │ ────────────────────────▶ │  App.jsx (side panel)│
│  (in the Docs page) │      ff_session           │  6 screens: init →   │
│  keystrokes, pauses,│                           │  prep → monitoring → │
│  bursts, scrolls,   │ ◀──────────────────────── │  recovery/break →    │
│  phase classifier,  │   FF_* runtime messages   │  analytics           │
│  distraction        │                           └──────────────────────┘
│  episodes           │   ┌────────────────────┐
└─────────────────────┘   │  background.js     │
                          │  side-panel setup, │
                          │  session-tab close/│
                          │  navigation watch  │
                          └────────────────────┘
```

- **`public/content.js`** — the sensor. Runs inside Google Docs; logs keystrokes (via Docs' text-event iframe), scrolls, and visibility changes. Classifies the writing phase every 2 s, accumulates time-in-phase and distraction episodes (with task-resumption times), and flushes everything to `chrome.storage.local` (`ff_session`).
- **`public/background.js`** — the watchdog. Opens the side panel on toolbar click; marks the session interrupted if the Docs tab closes or navigates away. Also contains parked scaffolding for the future Claude-generated recovery summaries (not active).
- **`src/App.jsx`** — the UI. All six screens in one file, polling `ff_session` for live data and messaging the content script for lifecycle events (`FF_START_TASK`, `FF_RESUME_TASK`, `FF_CANCEL_TASK`, `FF_BREAK_START`, `FF_BREAK_END`).

### Storage keys

| Key | Written by | Purpose |
|---|---|---|
| `ff_task` | side panel | Task metadata: name, objective, condition, start time, session tab id |
| `ff_session` | content.js | Live behavioral metrics, flushed every 2 s |
| `ff_interrupted` | background.js | Set when the Docs tab closes/navigates mid-session |
| `ff_idle` | content.js | Long-idle marker (≥ 2 min without activity) |

## ⚠️ Testing thresholds

Some detection thresholds are currently lowered for fast manual testing and **must be reverted before running real study sessions** (search the code for `TODO revert`):

| Threshold | Current (testing) | Study value | Location |
|---|---|---|---|
| Idle time → Distracted | 2 s | 120 s | `public/content.js`, `classifyPhase()` |

Tab-switching away from the doc flags Distracted immediately in both modes (by design — see limitations).

## Current status

**Working:** behavioral logging, phase classification, time-in-phase analytics, distraction episodes with resumption times (H1 measure), baseline/intervention conditions, distraction prompt, break mode (tracking suspended during breaks), session interruption/resume, session analytics.

**Not yet implemented:**
- Session data export + participant ID (needed before data collection)
- Claude-generated recovery summaries — the recovery screen currently shows **mock placeholder content** (`MOCK_RECOVERY_SUMMARY` in `App.jsx`); the API scaffolding in `background.js` is parked and needs a safe key-handling approach before activation
- Post-session questionnaires (administered externally)

## Known limitations

- Word count is keystroke-approximated (paste, undo, and autocorrect are not counted)
- Any tab-away counts as Distracted — the system cannot distinguish legitimate reference-checking from distraction (mitigate by using self-contained writing prompts in study sessions)
- Switching to another *application* (not just another tab) is detected via `document.hidden` and is indistinguishable from a tab switch
- Only Google Docs is supported as the writing environment

## Privacy

The extension records only keyboard/scroll/tab-switch *activity metrics* inside the writing interface — never the document text itself as stored data, and no external applications or websites are monitored. See the study's informed-consent documents for the full data-handling protocol.
