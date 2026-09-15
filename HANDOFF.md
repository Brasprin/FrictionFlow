# FrictionFlow — handoff

Orientation for anyone (or any AI session) picking this up. Written after the
calibration rework of September 2026.

Detail lives in `CALIBRATION_SPEC.md` (design and formulas), `analysis/README.md`
(validation), `README.md` (setup and architecture), and the git log — every
commit message explains *why*, not just what. This file exists so you know which
of those to read.

---

## 1. What the system is

A Manifest V3 Chrome extension that runs inside Google Docs, passively senses
writing behaviour, and offers contextual recovery prompts when it detects
disengagement — instead of blocking anything.

Study design: **between-subjects — one session per participant**, each assigned
to one condition (**baseline** = no prompts, **intervention** = prompts). The
independent variable is the presence of the recovery prompt.

> The thesis, the conference paper and the ethics documents all still describe a
> **within-subjects** design with two sessions per participant and paired tests.
> The code was changed to match the one-session design on 15 Sep 2026. Those
> documents now need updating, and the ethics committee may need to approve the
> change — see §4.

`content.js` — the sensor — still contains **no condition branch at all**, so
instrumentation stays condition-blind.

---

## 2. What changed, and why

### 2.1 Two labels instead of one

**Before:** one label — `Planning | Translating | Reviewing | Distracted`.
Distraction *replaced* the phase, so being flagged erased what the writer was
doing. A variable called `lastActivePhase` existed purely to dig the phase back
out for the recovery prompt.

**Now:** two independent channels.

| Channel | Values |
|---|---|
| Phase | Planning, Translating, Reviewing — always exactly one |
| Attention | Focused, Distracted |

Six states instead of four. The phase survives a distraction (and is frozen for
its duration), so "distracted **while drafting**" is now expressible — and
reportable as a 3×2 matrix (`distractedMs` in the export).

Three reasons this had to change:

1. Flower & Hayes describe three processes. "Distracted" was never a fourth, and
   Chapter 3 says three while the old system reported four.
2. **Per-phase calibration is impossible without it.** A 60-second pause is
   normal while planning and a stall while drafting. Expressing that requires
   knowing the phase *while* the attention rule runs — impossible when the phase
   has already been overwritten.
3. The evaluation protocol already assumed it. Conference paper §4.4 has the
   coder timestamp "phase transitions (planning, translating, reviewing)" **and
   separately** "the onset and end of distraction episodes". The code was the
   odd one out.

### 2.2 Thresholds are per participant

Ten hard-coded constants became **thirteen calibrated numbers**, derived from a
12-minute calibration run once per participant, immediately before their
session.

The single biggest change: idle-to-distracted was a flat **120 s for everyone**.
It is now **per phase, per person** — roughly 110 s while planning, 45 s while
drafting for a typical writer.

See `CALIBRATION_SPEC.md` §4 (protocol), §6 (every parameter and its formula),
§9 (validity guards).

### 2.3 Distraction needs corroboration

**Before:** one long pause flagged you.

**Now:** either a categorical trigger (off-tab > 60 s, or no interaction at all
for 3× the personal threshold), or **two different signal families at once**
(Time / Rate / Environment). Rapid tab-switching alone no longer flags someone
who is typing productively. Hysteresis: enter at ≥2 families, leave at 0.

`CALIBRATION_SPEC.md` §8.

### 2.4 A decision trace

Every 2 s the classifier now records its **raw inputs** alongside the decision.
Exports as a third file, `<base>_trace.csv`.

This exists for one purpose: a session can be re-classified afterwards under a
*different* threshold set and both scored against the same screen-recording
ground truth. That paired comparison is the evidence that calibration was worth
doing. It cannot be reconstructed later — a stored "Translating" is a
conclusion, not evidence — so it had to exist before data collection.

`analysis/README.md`.

### 2.5 A standardised distraction task

At minutes **10, 25 and 40** a memory card-matching game opens in a new tab for
**3 minutes**, identically in both conditions (conference paper §4.3). Chosen
over Sudoku, whose learning curve would make the same exposure affect
participants unequally. Layouts are fixed in advance, so every participant faces
the same boards — set A for every participant.

Two rules matter most:

- **The recovery prompt is held while the game is open** and shown on return.
  Otherwise it would pull intervention participants back early, giving them
  shorter distractions than baseline and confounding H1 with distraction length.
- **Every episode is tagged induced or natural.** The game is detected almost
  perfectly, so detection agreement must be reported separately for each.

"Time's up" does not end the game; how long they keep playing afterwards is
recorded as the *overrun* — the "slipping off" the study wants to observe.

`DISTRACTION_SPEC.md`.

---

## 3. Current state

**Working and tested** (`npm test` — 152 checks across four files): two-label
classifier, calibration capture and profile maths, calibration UI, per-participant
profile storage, decision trace, the scheduled distraction task, export, and
the analysis script.

**Never run in Chrome against a real document.** Every automated test drives the
real `content.js` inside a Node vm with a fake Docs page and a controllable
clock. That proves the logic; it cannot prove the integration. Three bugs were
found only by a human clicking through, and all three were invisible to the build,
the linter and the test suite:

- the calibration timer skipped its first segment on one code path
- the participant ID was not carried back to the setup screen, so a participant
  who had just calibrated was reported as "Not calibrated"
- the memory game drew nothing inside the extension: its code was inline, which
  Chrome's Content Security Policy blocks on extension pages. The development
  preview does not enforce that policy, so it passed every check until run in
  Chrome. `test/extension-pages.test.mjs` now guards every extension page.

Assume more of that class remains.

---

## 4. Open items

1. **Thesis Ch. 3 and Ch. 5 describe four phases.** They now contradict the code.
2. **Conference paper §3.3 and §4.2 describe a two-segment calibration** (type a
   paragraph, then edit it). The implemented protocol is three segments; the
   two-segment version produced no Planning baseline at all, which is the phase
   where false positives happen.
3. Add **Leys et al. (2013)** to the reference list — it is the citation for the
   median + 3×MAD rule used for every idle threshold.
4. **Pilot tunables** (`CALIBRATION_SPEC.md` §9): the MAD multiplier (3), the
   15 s idle floor, the severe-tier multiplier (3×), the two-family threshold.
   The idle floor bound both drafting and reviewing in simulation — watch whether
   it binds for real participants too.
5. **Planning instruction may need rewording.** A participant who plans without
   interacting at all produces too few pause observations to characterise, and
   that phase falls back to the default. Seen once already in testing
   (`calibrationFailures: idle-fallback:Planning`).
6. **Second coder on ~20% of recordings**, for inter-rater kappa. Agreement with
   a coder means nothing if the coder is unreliable, and it is the first thing a
   panel asks about ground truth.
7. **The design changed to between-subjects (one session per participant).**
   Everything written still describes two sessions per participant: thesis §4.1
   (*"within-subject … each participant completes two writing sessions"*), the
   analysis plan in §4.4–4.5 (paired t-tests), conference paper §4.3 and §4.5,
   and the ethics documents (*"The study will involve two writing sessions"*).
   All need revising, and **the ethics committee may need to approve the change**
   before data collection.
8. **Statistics for H1–H4 change.** Paired t-test / Wilcoxon signed-rank become
   **independent-samples t-test / Mann–Whitney U**, baseline group against
   intervention group. (The calibrated-versus-fixed threshold comparison in
   `analysis/` stays paired — both scores come from the same session.)
9. **Sample size.** A between-subjects comparison needs roughly **twice as many
   participants** for the same sensitivity, because differences between people
   no longer cancel out. Plan recruitment accordingly.
10. **Assignment and balance.** Assign conditions at random or from a pre-drawn
    balanced list, and balance the difficulty of the coursework tasks across the
    two groups. Record each participant's course and assignment so the balance
    can be checked.

---

## 5. How to defend it

Three separate claims. Do not conflate them — the distinction is the defence.

| Claim | Evidence |
|---|---|
| Thresholds are not arbitrary | Every one traces to a number the participant produced and was shown. Formulas fixed in advance, nothing tuned after seeing session data. |
| Calibration measures the person reliably | **Test–retest**: calibrate two pilot participants twice, days apart, and report how stable each parameter is. Plus the between-person spread — if profiles barely differed, calibration would be pointless. |
| Detection is accurate | Screen recordings, blind coder, Cohen's κ per channel, precision/recall on episodes, confusion matrix. |
| Calibration was worth doing | The counterfactual replay in `analysis/`. Each participant yields two κ values → paired Wilcoxon. |

**Calibration does not establish accuracy.** It removes the one-size-fits-all
assumption. The recording-coded agreement establishes accuracy. Presenting only
the first invites the accuracy question a second time.

And be upfront that calibration personalizes *parameters inside a rule structure
the group authored* — the signals, the two-family rule, the 3× severe tier are
design decisions. The recording validation is what tests those.

---

## 6. Known limitations to state, not hide

- **Tab-away cannot tell reference-checking from distraction.** Mitigated by
  self-contained writing prompts.
- **A second window, second monitor, or phone is invisible.** Chrome only reports
  the tab as hidden when it is backgrounded in its own window, so those are
  caught only by the inactivity route, later and by a different rule.
- **Motionless rereading is indistinguishable from a thinking pause.** A
  fundamental limit of behavioural sensing without eye-tracking.
- **Tab thresholds cannot be calibrated** (60 s away, 3 switches/min) — nobody
  switches tabs during a controlled calibration task, so there is nothing to
  measure. They stay fixed, and the paper should say so.
- Google Docs only.

---

## 7. Running it

```bash
npm install
npm run build      # compiles the panel and copies public/ into dist/
npm test           # 152 checks
npm run lint       # ~120 pre-existing errors: eslint has no webextension globals
```

Load `dist/` unpacked at `chrome://extensions`.

**Which reload you need:**

| Changed | Do |
|---|---|
| `src/` | rebuild → close and reopen the side panel |
| `public/background.js`, `manifest.json` | rebuild → reload the extension |
| `public/content.js` | rebuild → reload the extension **and refresh the Docs tab** |

That last one catches people constantly. Content scripts only inject on page load.

**Testing the distractions without waiting 43 minutes:** extension options →
*Short schedule* (minutes 1, 3, 5; 70-second games). Sessions run that way are
stamped `testMode` in the export (`distractionTestMode = 1` in the CSV) and are
not study data.

**Testing calibration without waiting 12 minutes:** extension options → *Short
calibration (30s per step)*. Profiles captured that way are stamped
`testMode: true` and **always rejected**, so a forgotten toggle costs a re-run
rather than a corrupted participant.

---

## 8. Where things live

```
public/content.js     the sensor — classifier, calibration capture, trace
public/background.js  watchdog, Docs API, Gemini recovery summaries
src/App.jsx           the side panel — all screens, and the export builder
test/                 152 checks: content script, analysis replay, distraction scheduler
analysis/             threshold-comparison script + coding template
CALIBRATION_SPEC.md   every calibration decision and formula, with rationale
DISTRACTION_SPEC.md   the scheduled memory-game distraction task
public/distraction/   the memory game itself (also runs standalone)
```

Two corrections were made to the spec during implementation, both recorded in it
with the reasoning, and both instances of the same underlying rule:

> **A calibrated threshold must be computed from the same quantity it will be
> tested against.**

Worth remembering before adding any new signal.
