# FrictionFlow — Distraction Task Specification

**Status:** implemented and tested in simulation (`npm test`; the scheduler has
its own suite, `test/distraction.test.mjs`). Not yet run in Chrome against a
real session. The game is `public/distraction/memory.html`; it also runs
standalone when opened as a file.
**Purpose:** define the standardised secondary task that induces distraction
during study sessions, and how it interacts with detection, the recovery
prompt, and the export.

---

## 1. What it is for

Conference paper §4.3 requires a secondary task that is:

- **the same for every participant**, delivered at the same predetermined times
- **identical in both conditions**, so that differences between the baseline and
  intervention groups come from the recovery prompt, not from variation in the
  disruption
- **cognitively engaging rather than merely time-consuming** — it must pull
  working memory away from the writing, so that resuming requires genuine
  reconstruction of task context rather than a superficial pause (Leroy, 2009;
  Mark, Gudith & Klocke, 2008)

The supervising faculty member additionally asked that the distraction produce
genuine *slipping off* — absorption in the other task — rather than a brief
forced pause.

---

## 2. Task choice: memory card matching

### Criteria

| # | Criterion | Why |
|---|---|---|
| 1 | understood in seconds | a learning curve makes the task affect participants unequally |
| 2 | absorbing | the "slipping off" the study needs to observe |
| 3 | loads working memory | so the writing context is genuinely displaced |
| 4 | unrelated to writing | nothing verbal that can leak into the essay |
| 5 | cannot be finished within the exposure | otherwise participants idle |
| 6 | identical for everyone | §4.3 |
| 7 | loggable | engagement must be demonstrable, not assumed |

### Alternatives considered

| Task | Rejected because |
|---|---|
| Sudoku (the original suggestion) | high learning curve — absorbing for participants who know it, frustrating for those who do not, so the same exposure means different things for different people |
| Word search, article + quiz | verbal content can leak vocabulary and ideas into the essay |
| Short video, simulated feed | passive, so weak on working-memory load; content hard to standardise; engagement cannot be demonstrated |
| Mental arithmetic, N-back | load working memory well but feel like a test, producing effort rather than absorption |
| Existing memory-game apps | shuffle the cards on every game, so each participant faces a different problem; cannot be logged or timed |

Memory card matching satisfies all seven criteria. Holding card positions in
mind competes directly with holding the sentence being composed, which is the
displacement §4.3 asks for; almost everyone knows the game; and clearing one
board immediately starts the next, so there is no natural stopping point.

---

## 3. Uniformity

**Fixed layouts.** Every layout is shuffled by a seeded generator (integer-only
arithmetic, so identical across browsers), with the seed derived from
set + episode + board. Board 2 of set A, episode 1 is the same on every machine,
every time.

**One set for everyone.** Each participant takes part in one session only
(between-subjects), so nobody can meet a layout twice, and every participant
plays set A. Identical boards for everyone is what keeps the distraction the
same across the two groups. The game still supports a second set (`?set=B`)
should a second session per participant ever be reintroduced.

**Three episodes per session.** Each distraction has its own boards, so a later
distraction never repeats an earlier one's layout.

**Fixed rules.** Same board progression (12 → 16 → 20 cards), same 0.8 s
flip-back delay, same exposure.

**Fixed appearance.** Drawn SVG shapes, not emoji — emoji render differently on
Windows, macOS and Android, which would make the same card a different picture
on a different laptop. Symbols differ by shape, so colour is never the only cue.

**Adaptive difficulty within a uniform sequence.** Boards grow as they are
cleared, so a fast and a slow player both spend the exposure near the edge of
their own ability. Everyone faces the identical board *n* when they reach it;
only how far they get differs, and that is logged.

---

## 4. Schedule

| Distraction | Starts | Exposure |
|---|---|---|
| 1 | minute 10 | 3 min |
| 2 | minute 25 | 3 min |
| 3 | minute 40 | 3 min |

Times are measured from the session start. The same schedule runs in both
conditions.

- **not before minute 10** — the writer must be properly into the task, or there
  is nothing to interrupt
- **the last ends at minute 43** — leaving time to observe recovery before the
  50-minute session closes
- **evenly spread** — so the three episodes fall in different stretches of the
  session, and different writing phases are interrupted
- **3 minutes** — long enough to become absorbed and lose the thread, and well
  past the 60-second tab-away threshold; short enough that nine of fifty minutes
  are spent in the game

The phase each distraction interrupts is not controlled. It varies naturally
between participants, and the two-label model records it per episode.

These values are a design judgment, not derived. Verify in the pilot that
participants are writing fluently by minute 10.

---

## 5. How it ends

Exposure is **fixed, not "until finished"**. Completion-based exposure would give
fast players about a minute away and slow players several; since a longer
absence makes resumption harder (Altmann & Trafton, 2002), resumption time would
then partly measure distraction length rather than the recovery prompt.

At the end of the exposure a "time's up — please go back to your writing" banner
appears. **It does not block the game, and new boards keep coming.** Whether the
participant returns at once or keeps playing is the slipping-off behaviour the
study wants to observe; flips after the banner are counted separately.

No countdown is shown during play: a visible clock invites clock-watching, which
works against absorption.

---

## 6. The recovery prompt must not interrupt the distraction

In the intervention condition the Gentle Reminder currently fires once the
participant has been off the document for 60 seconds. The side panel stays
visible across tabs, so it would appear **beside the game and pull the
participant back early**.

That would break the comparison. Intervention participants would receive
shorter distractions than baseline participants, and a shorter distraction is
easier to recover from — so H1 would measure distraction length, not the prompt.

**Rule: during a scheduled distraction, the reminder is held until the
participant returns to the document, and shown then.**

This also matches the thesis: FrictionFlow supports **recovery, not
prevention**. It should not stop the distraction; it should help on return.

Exposure is therefore identical across conditions, and the only thing that
differs is what happens on re-entry.

---

## 7. Measures

Per scheduled distraction:

| Measure | Definition |
|---|---|
| exposure start | game tab opened |
| time's up | banner shown — identical offset for everyone |
| return | participant back on the document |
| **overrun** | return − time's up: the *slipping off* |
| **resumption** | first writing keystroke − return: the existing H1 measure |
| engagement | flips, matches, mismatches, boards cleared |
| flips after time's up | continued play once told to stop |

**Manipulation check.** An episode with zero flips was not a distraction: the
participant opened the game and did not play. Such episodes are flagged in the
export and should be excluded or analysed separately.

---

## 8. Induced versus natural distraction

Every distraction episode is tagged **induced** (the scheduled game) or
**natural** (the participant drifted on their own).

This matters for validation. Leaving the tab for more than 60 seconds flags
distraction categorically, so the system detects the scheduled game almost
perfectly. Pooling induced and natural episodes would inflate the attention-
channel kappa. **Report detection agreement separately for each**; natural
distraction is the real test of the detector.

---

## 9. Edge cases

| Situation | Behaviour |
|---|---|
| participant on a sanctioned break at a scheduled time | deferred until the break ends — never during a break |
| participant closes the game early | exposure recorded as cut short, and flagged |
| session finished before a scheduled time | that distraction is not delivered; recorded as such |
| session interrupted (Docs tab closed) at a scheduled time | deferred until the session resumes |
| scheduled time falls mid-calibration | impossible — calibration runs before any session |

---

## 10. Implementation plan

| Piece | Where |
|---|---|
| Schedule | `background.js`, using `chrome.alarms` — survives the MV3 service worker being put to sleep, unlike a plain timer. Needs the `alarms` permission. |
| Game page | moved to `public/distraction/memory.html` so it ships inside the extension. It stays its own file in its own folder. |
| Game log | written to storage when running inside the extension; standalone mode unchanged |
| Episode tagging | `content.js` marks an episode induced when a scheduled distraction is in progress. Remains condition-blind: the distraction is identical in both arms. |
| Reminder hold | side panel defers the Gentle Reminder during a scheduled distraction until the participant is back on the document |
| Export | per-distraction record (§7) in the JSON; summary columns in the CSV |

---

## 11. Decisions taken

| Decision | Resolution |
|---|---|
| Schedule | minutes 10, 25, 40; 3-minute exposure each |
| Card set | **set A for everyone.** One session per participant, so there is no second session to protect from memorised layouts. (An earlier version had the researcher pick 1st / 2nd session to choose set A or B; removed when the design became between-subjects.) |
| Which distractions hold the reminder | **only the scheduled game.** Natural distractions behave exactly as before. |
| Where the game lives | `public/distraction/memory.html` — ships with the extension, still its own self-contained file |

## 12. Export

**JSON** — `distractionTask`: the set, and one record per scheduled
distraction with `delivered`, `openedAt`, `deferredSec`, `timesUpAt`,
`returnedAt`, `overrunSec`, `cutShort`, `flips`, `matches`, `mismatches`,
`boardsCleared`, `flipsAfterTimesUp`, `engaged`, `resumptionSec` and
`adjustedResumptionSec`. Plus counts of induced and natural episodes. Every
detector episode also carries `induced` and `inducedEpisode`.

**CSV** — `distractionSet`, `distractionsDelivered`,
`inducedEpisodes`, `naturalEpisodes`, `zeroFlipDistractions`, and for each of the
three distractions `distN Delivered / CutShort / OverrunSec / Flips /
ResumptionSec / AdjResumptionSec`.

## 13. Testing the flow quickly

Extension options → **Short schedule**: distractions at minutes **1, 3 and 5**
with **70-second** games, so the whole flow can be checked in about six minutes
instead of forty-three.

- **70 s, not shorter.** A distraction is only detected after 60 s off the tab,
  so a shorter game ends before detection — and the held reminder, the part most
  worth checking, would never appear.
- **Fixed at session start.** The schedule is saved as the session's plan when
  the session begins; toggling the option mid-session cannot turn a real session
  partly into a test run.
- **Always stamped.** Every distraction record carries `testMode`, the JSON's
  `distractionTask.testMode` is true, and the CSV's `distractionTestMode` is 1.
  Exclude those rows from analysis. The setup screen and the options page both
  warn while it is on.

## 14. Known limitation

`chrome.alarms` may not survive a full browser restart mid-session. A session
interrupted by closing Chrome entirely could lose its remaining scheduled
distractions; `distractionsDelivered` in the export will show it.
