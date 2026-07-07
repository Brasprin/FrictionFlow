# FrictionFlow

**Supporting Focus Recovery and Re-engagement from Cognitive Disruptions**

FrictionFlow is a Chrome extension (Manifest V3) that supports students in recovering focus during academic writing tasks in Google Docs. Instead of blocking distractions, it passively logs writing behavior (typing, pauses, scrolling, tab switches), infers the writer's current cognitive phase Planning, Translating, Reviewing, or Distracted (Flower & Hayes, 1981)  and offers contextual recovery prompts when disengagement is detected.


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

### 4. Google Docs API setup (document reading)

The extension reads the actual document text through the official **Google Docs API** — used for the real word count and for the AI recovery summaries. Without this setup everything still works, but word count falls back to keystroke approximation and recovery prompts are behavioral-signals-only.

1. Load the extension once (step 3) and copy its **ID** from `chrome://extensions`.
2. In [Google Cloud Console](https://console.cloud.google.com): create a project and enable the **Google Docs API** (APIs & Services → Library).
3. Configure the **OAuth consent screen**: External, *Testing* publishing status, and add the Google account(s) that will run sessions as **test users**.
4. Create credentials → **OAuth client ID** → application type **Chrome Extension** → paste the extension ID from step 1.
5. Copy the generated client ID into `public/manifest.json` → `oauth2.client_id` (replacing the `REPLACE_WITH_OAUTH_CLIENT_ID` placeholder), rebuild, and reload the extension.
6. On the first session start, Chrome shows a one-time Google consent popup (read-only Docs scope). Approve it once; later sessions are silent.

> ⚠️ The OAuth client is bound to the extension ID. An unpacked extension's ID is derived from its folder path, so it changes if you load `dist/` from a different path or machine — re-create (or edit) the OAuth client with the new ID if that happens.

### 5. Use it

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
- **`public/background.js`** — the watchdog + API gateway. Opens the side panel on toolbar click; marks the session interrupted if the Docs tab closes or navigates away. Reads the document text via the Google Docs API (OAuth, read-only scope) on request: content.js asks for the real word count every 30 s, and the recovery-summary generation reads the doc tail for context. **Document text is ephemeral** — it is used inside the request and never written to storage, logs, or exports; only the derived word count (a number) is persisted. Also contains parked scaffolding for the Claude-generated recovery summaries (not active).
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

- Word count is API-anchored when Docs API auth is configured (synced every 30 s, session-baseline-subtracted so pre-existing prompt text isn't counted); between syncs — and always, if OAuth isn't set up — it falls back to keystroke approximation (paste, undo, and autocorrect not counted)
- Any tab-away counts as Distracted — the system cannot distinguish legitimate reference-checking from distraction (mitigate by using self-contained writing prompts in study sessions)
- Switching to another *application* (not just another tab) is detected via `document.hidden` and is indistinguishable from a tab switch
- Only Google Docs is supported as the writing environment

## Privacy

The extension records only keyboard/scroll/tab-switch *activity metrics* inside the writing interface — never the document text itself as stored data, and no external applications or websites are monitored. Document text **is** read ephemerally through the Google Docs API (read-only scope) to compute the word count and, in intervention sessions, to generate recovery prompts — per the consent-form commitment it is never persisted to storage, logs, or exported data. See the study's informed-consent documents for the full data-handling protocol.
