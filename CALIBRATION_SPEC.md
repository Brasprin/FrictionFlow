# FrictionFlow — Calibration Specification

**Status:** implemented and tested in simulation (`npm test`). Not yet run in
Chrome against a real participant session.
**Purpose:** define every threshold the system personalizes, where each number
comes from, and the formula that produces it.

---

## 1. What this document answers

The thesis panel asked, in effect: *how can you claim your detection thresholds
are accurate when your own group chose them, with no training data and no
research basis?*

This specification answers the **arbitrariness** half of that question. Every
threshold below is derived from a number the participant themselves produced,
minutes earlier, in a controlled task, and is shown back to them before the
session begins.

### What this document does NOT answer

Calibration does not establish that the detection is **accurate**. It makes the
thresholds participant-specific; it says nothing about whether the rule
structure corresponds to real cognitive phases.

Accuracy is established separately, by the screen-recording validation already
specified in the conference paper (§4.4): an independent coder, blind to the
classifier output, timestamps the real phase transitions and distraction
episodes, and agreement is computed against the system log.

**These two must be presented together.** Calibration removes the
one-size-fits-all assumption. Recording-coded agreement establishes accuracy.
Presenting only the first invites the accuracy question a second time.

A useful side effect: the calibration segments are themselves labelled ground
truth (the participant is *told* which phase to be in), so they support a first
agreement check before any participant is recruited.

---

## 2. The two-label model

Calibration presupposes a change to how state is represented.

**Current (one label).** `classifyPhase()` returns exactly one of
`Planning | Translating | Reviewing | Distracted`. Distracted preempts the other
three, so the moment it fires, the phase is erased. The variable
`lastActivePhase` (content.js:115) exists solely to recover the erased phase for
the recovery prompt.

**Adopted (two labels).**

| Channel | Values | Notes |
|---|---|---|
| **Phase** | Planning, Translating, Reviewing | always exactly one; never erased |
| **Attention** | Focused, Distracted | evaluated *against the current phase's baseline* |

Rationale:

1. Flower & Hayes describe three processes. "Distracted" was never a fourth.
2. `lastActivePhase` and its workarounds disappear.
3. **It is what makes per-phase calibration usable.** A 60-second pause is
   normal in Planning and a stall in Translating. Expressing that requires
   knowing the phase *while* the attention rule runs — impossible when the phase
   has already been overwritten.
4. It matches the validation protocol already written (§4.4 codes three phases
   and codes distraction separately).
5. It yields distraction time broken down by phase — a 3×2 matrix the current
   model structurally cannot produce.

---

## 3. Scope: per participant, before their session

Calibration runs **once per participant**, immediately before their single
writing session.

The study is **between-subjects**: each participant takes part in one condition
only, baseline or intervention. Participants are therefore compared with *each
other* rather than with themselves, so differences between people — in typing
speed, in how long they pause — do not cancel out as they would in a
within-subjects design. That makes personalised thresholds matter more, not
less: with one fixed threshold for everyone, a group that happened to contain
more slow typists would register more "distraction" regardless of condition.
Calibration measures each participant against their own baseline, which keeps
that difference out of the detector.

Consequences:

- The profile is keyed by participant ID and must survive every storage-clearing
  path (`handleStartTask`, `handleCancelTask` currently bulk-remove keys), and one
  participant's calibration must never overwrite another's.
- The full profile is embedded in the session export, or the session's data
  would not record the thresholds it ran under.
- Re-calibration is a deliberate researcher action, not something a participant
  can trigger accidentally.
- Participants must be **assigned to conditions at random** (or from a
  pre-drawn balanced list), never by convenience — with only one session each,
  anything that differs systematically between the two groups reads as an
  effect of the condition.

---

## 4. Protocol

A single writing task, split into three timed segments. The participant is told
explicitly when to switch. This is what makes the behavioural data **labelled**.

| Segment | Duration | Instruction to participant |
|---|---|---|
| Planning | 3 min | "Decide your position and plan what you'll write. Don't start writing yet." |
| Translating | 5 min | "Now write. Focus on getting ideas down, not on correctness." |
| Reviewing | 4 min | "Now reread and revise what you wrote. Fix, cut, restructure." |
| **Total** | **12 min** | |

**Ordering is fixed and non-arbitrary:** reviewing requires text to review, which
requires writing first. State this in the paper — it looks arbitrary otherwise.

**Task:** *"Should class attendance be optional at university? Take a position,
give at least two reasons, and respond to one argument someone on the other side
might make."*

The same prompt for every participant, so differences between profiles reflect
the writer rather than the topic.

**What the task is for.** The instructed segments *guarantee* that all three
phases occur — the participant is told which one to be in. The topic's job is to
make each phase **genuine**, as it would be in the real task, rather than acted.
Requirements it meets:

- **genuine Planning** — the phase that matters most, since it is where false
  positives occur. Attendance alone was too familiar: most students hold a
  ready-made opinion, which leaves little to plan, so the Planning step becomes
  waiting and yields too few pauses (`idle-fallback:Planning`, already observed
  in testing). The counterargument clause fixes this — an opposing argument
  cannot be recalled, it has to be imagined and weighed.
- **genuine Translating** — a position, two reasons and a rebuttal fill five
  minutes of drafting
- **genuine Reviewing** — participants are told to draft for ideas rather than
  correctness, so the draft carries real flaws worth revising
- **easy** — no subject knowledge needed
- **self-contained** — no outside research, so tab-switching is not induced
- **knowledge-neutral across courses** — a campus-life question every student
  has lived equally

The handoff's original prompt (*"Should university students be allowed to use
generative AI tools for academic work?"*) was replaced because it failed the last
requirement: CS and IT students know far more about generative AI than students
in other programmes, which is a head start the calibration exists to exclude.

**Relationship to the main task.** The main task is a single standardised
argumentative essay with three source excerpts supplied inside the document
(`study-materials/session-document-template.md`). The pilot used each
participant's own coursework; participants left the document to consult sources,
and any tab-away over 60 s is recorded as distraction, so those episodes were
not distraction at all.

The session task is still harder than a campus-life question — it requires
integrating conflicting sources and answering a counterargument — and harder
tasks lengthen pauses, so session pausing may run longer than the calibrated
baseline. The two-family rule and the 3× severe tier absorb part of this; the
rest is measured in the pilot by comparing calibration pauses with pauses during
Focused stretches of the session. Report it as a limitation.

**Separated versus interleaved phases.** In real writing the three processes
interleave — Flower & Hayes describe them as recursive: a writer plans a little,
drafts a sentence, rereads, drafts again. Calibration separates them
deliberately, because separation is what yields clean labels. The consequence is
that each phase is measured **in isolation**, while the main task presents them
**mixed**. Calibration cannot show that the classifier recognises the phases
when they interleave; that is tested separately, against human-coded screen
recordings. State this in the paper as a deliberate trade-off.

**Main-task comparability.** Every participant writes the same prompt from the
same document, so nothing about the task differs between the two groups. This is
what a between-subjects design needs: with one session each, any difference
between the tasks people write lands unevenly across the groups and reads as an
effect of the recovery prompt.

The cost is ecological validity — participants write a set prompt rather than
work that counts towards their grade. State it as a limitation, together with
the reason: course tasks required sources, and the system cannot tell
reference-checking from disengagement.

**Environment: inside the Google Doc**, using the live content script — not a
side-panel text box. Reasons:

- Reviewing needs genuine scroll behaviour off `.kix-appview-editor`; a
  420 px panel textarea produces a scroll rate that means nothing.
- The baseline is then produced by the *identical code path* that produces the
  session measurements: same keydown listener, same rolling windows, same
  debounce. A baseline gathered by a different mechanism than the measurement is
  a soft target for a panel already asking about rigour.

The side panel drives the timer, the instructions and the segment transitions.

### Duration rationale (why 3/5/4 and not 2/5/3)

The first **30 seconds of every segment are discarded** (see §5.1), so usable
data is segment length minus 30 s:

| Segment | 2/5/3 usable | 3/5/4 usable |
|---|---|---|
| Planning | 90 s | 150 s |
| Translating | 270 s | 270 s |
| Reviewing | 150 s | 210 s |

Planning is the thinnest segment (few keystrokes by definition) and is the one
whose baseline matters most, because Planning is where false positives happen.
90 usable seconds is too thin to estimate a pause distribution from. Since
calibration runs **once per participant** for the whole study, the extra two
minutes is cheap.

---

## 5. What is captured

During each segment, with segment labels attached:

- keystroke timestamps, tagged printable / delete / other
- scroll event timestamps (debounced, as in the live sensor)
- selection gesture timestamps (debounced)
- typing burst start/end times
- net character count

Nothing new needs to be sensed — every one of these is already logged by
`content.js`. Calibration only adds *segment labelling* and *per-segment
aggregation*.

### 5.1 Warm-up exclusion

Rolling WPM uses a 30-second window (`WPM_WINDOW_MS`). At the start of any
segment that window is either empty or still full of the *previous* segment's
keystrokes. **Discard the first 30 s of each segment** from all statistics.

A pause that spans a segment boundary is attributed to neither segment.

### 5.2 Pause definition

A **pause** is a gap of **≥ 2000 ms in the merged interaction timeline** —
keystrokes, deletions, scrolls and selection gestures together.

**The 2000 ms floor.** Raw gaps are dominated by within-word intervals of
150–300 ms, so the median of all gaps measures typing rhythm, not pausing, and
any statistic computed from it is meaningless. 2000 ms is the conventional pause
threshold in keystroke-logging research (Leijten & Van Waes 2013; Van Waes,
Leijten & Lindgren 2019) — both already in the reference list.

**Correction: why the merged timeline, not keystrokes alone.** An earlier draft
defined pauses as gaps between *keystrokes*. That would have made every
calibrated idle threshold systematically too high, because it is not what the
threshold gets compared against at runtime: the Time family measures
`now − lastActivityTime`, and scrolls and selection gestures reset that clock
just as keystrokes do. Under the keystroke-only definition, twenty seconds of
scrolling would be captured as a twenty-second "pause" during calibration while
reading as continuous activity during the session.

The error would have been worst in **Reviewing**, where non-typing interaction
is the dominant behaviour — precisely the phase where a wrong threshold is
hardest to notice. The rule is that a calibrated threshold must be computed from
the same quantity it will be tested against.

---

## 6. Parameters

Thirteen personalized numbers. Two thresholds stay fixed and are declared as such.

### 6.1 Measured per phase (9 numbers)

| Parameter | Symbol | Statistic |
|---|---|---|
| Typing speed, Planning | `W_P` | median of rolling-WPM samples (2 s cadence) |
| Typing speed, Translating | `W_T` | same |
| Typing speed, Reviewing | `W_R` | same |
| Idle threshold, Planning | `IDLE_P` | `median(pauses) + 3 × MAD(pauses)` |
| Idle threshold, Translating | `IDLE_T` | same |
| Idle threshold, Reviewing | `IDLE_R` | same |
| Interaction rate, Planning | `ACT_P` | events/min (keystrokes + scrolls + gestures) |
| Interaction rate, Translating | `ACT_T` | same |
| Interaction rate, Reviewing | `ACT_R` | same |

**Why the rolling-WPM median, not total-words/total-time.** At runtime,
`classifyPhase()` tests `rollingWPM()` — a 30-second window. The calibration
statistic must be computed the same way or the threshold is not comparable to
what it will be tested against. Median rather than mean: robust to the ramp-up
at segment start and to single outlier windows.

**Why median + 3 × MAD.** MAD (median absolute deviation) is the standard robust
alternative to mean + 3 × SD for "unusually large value", and unlike SD it does
not get inflated by the very outliers it is meant to detect — which matters at
these sample sizes (a Planning segment may yield fewer than ten pauses).
Reference: Leys, Ley, Klein, Bernard & Licata (2013), *Journal of Experimental
Social Psychology* 49(4), 764–766. **Not currently in the reference list — add it.**

The multiplier 3 is the conventional choice and is a **tunable to sanity-check
in the pilot**. Flagged as such in §9.

### 6.2 Derived thresholds (4 numbers)

These replace hard-coded constants in `classifyPhase()`.

| Replaces | Current | Formula | Rationale |
|---|---|---|---|
| WPM gate (appears **4×**) | `10` | `(W_T + W_R) / 2` | Reviewing is Translating's nearest neighbour (both involve typing). For two roughly-normal classes of similar spread, the midpoint of the means is the misclassification-minimising split. |
| `BURST_MIN` | `10 s` | `0.5 × median burst duration in Translating segment` | Half a typical burst is enough evidence of being in one. Fixes the choppy-typist case named in the conference paper §3.3 — a writer whose bursts average 8 s would *never* classify as Translating under a fixed 10 s rule. |
| `DELETE_REVIEW_THRESHOLD` | `5/min` | `(D_W + D_R) / 2` | Same class-separation logic, using the writing and reviewing segments. |
| Scroll threshold | `5/min` | `(S_W + S_R) / 2` | Same. |

### 6.3 Dropped

**`SELECT_REVIEW_THRESHOLD` (currently 2/min) — remove.** It is the weakest
signal in the system, it is already a proxy for something Google Docs' canvas
rendering prevents observing directly, and it is redundant with the delete rate.
Fewer parameters, less to defend.

### 6.4 NOT calibrated — declare this in the paper

| Threshold | Value | Why it cannot be calibrated |
|---|---|---|
| `TAB_AWAY_THRESHOLD_MS` | 60 s | Nobody switches tabs during a controlled calibration task, so there is nothing to measure. |
| `RAPID_SWITCH_THRESHOLD` | 3 / 60 s | Same. |

Stating this plainly is stronger than implying every threshold is personalized.

---

## 7. Worked example — participant P01

Illustrative numbers, to show the formulas producing real values.

**Planning** (180 s, 150 s usable): 55 printable keystrokes.
- rolling-WPM samples, median: **`W_P` = 3**
- pauses ≥ 2 s (n=8): 4.1, 6.3, 8.8, 12.0, 15.4, 21.7, 30.2, 47.5
  - median = 13.7; MAD = 7.7
  - `IDLE_P` = 13.7 + 3(7.7) = 36.8 → **37 s**

**Translating** (300 s, 270 s usable): 640 printable keystrokes, median burst 22 s.
- rolling-WPM samples, median: **`W_T` = 28**
- pauses ≥ 2 s (n=6): 2.4, 3.1, 3.6, 5.0, 7.2, 11.9
  - median = 4.3; MAD = 1.55
  - 4.3 + 3(1.55) = 8.95 → below the 15 s floor → **`IDLE_T` = 15 s**
- deletes 22 / 270 s = 4.9/min (`D_W`); scrolls 6 / 270 s = 1.3/min (`S_W`)

**Reviewing** (240 s, 210 s usable): 180 printable keystrokes.
- rolling-WPM samples, median: **`W_R` = 9**
- pauses ≥ 2 s (n=7): 2.8, 4.0, 5.5, 6.1, 9.3, 14.0, 19.8
  - median = 6.1; MAD = 3.2
  - `IDLE_R` = 6.1 + 3(3.2) = 15.7 → **16 s**
- deletes 34 / 210 s = 9.7/min (`D_R`); scrolls 26 / 210 s = 7.4/min (`S_R`)

**Derived, vs. the current fixed values:**

| Threshold | Fixed today | P01 calibrated |
|---|---|---|
| WPM gate | 10 | (28+9)/2 = **19** |
| Burst minimum | 10 s | 0.5 × 22 = **11 s** |
| Delete rate | 5/min | (4.9+9.7)/2 = **7/min** |
| Scroll rate | 5/min | (1.3+7.4)/2 = **4/min** |
| Idle, Planning | 120 s (global) | **37 s** |
| Idle, Translating | 120 s (global) | **15 s** |
| Idle, Reviewing | 120 s (global) | **16 s** |

Note that some thresholds rise and some fall — the personalization is doing real
work, not uniformly loosening or tightening.

**On the idle thresholds dropping sharply from 120 s:** this is intended, and is
safe only *because* of the two-signal rule (§8). Individually the thresholds
become far more sensitive; firing requires corroboration. Net effect should be
fewer false positives with better true-positive detection. **This interaction is
the single most important thing for the pilot to check.**

---

## 8. The two-label classifier

Both labels are recomputed on the existing 2 s interval. The phase channel runs
first; the attention channel then evaluates against *that* phase's baseline.

### 8.1 Phase channel — three-way, no Distracted branch

```
Reviewing     if (scroll ≥ SCROLL_GATE or deletes ≥ DELETE_GATE)
                 and WPM < WPM_GATE
Translating   if WPM ≥ WPM_GATE and burst ≥ BURST_MIN
Planning      otherwise
```

Every Distracted branch is removed from phase classification. Planning becomes
the residual state, which is what it always was in substance — the current
`pause > 15 s and WPM < 10` rule and the `default → Planning` fallthrough
already collapse to the same thing, so that threshold disappears rather than
being calibrated.

### 8.2 Attention channel — signal families

Signals are grouped into **families**. Distraction requires **signals from ≥ 2
different families firing simultaneously**.

Grouping by family, rather than counting signals flatly, exists to prevent
double-counting non-independent evidence: "no keystroke for 40 s" and "no
interaction for 40 s" are nearly the same observation and must not together
satisfy a two-signal rule.

| Family | Signal | Eligible in |
|---|---|---|
| **Time** | no interaction of any kind (keystroke, scroll, or selection gesture) for > `IDLE_<phase>` | all phases |
| **Rate** | interaction events/min < ¼ × `ACT_<phase>` | all phases (needs a profile) |
| **Environment** | ≥ `RAPID_SWITCH_THRESHOLD` tab switches in 60 s | all phases |

#### Correction: why Rate measures interactions, not words

An earlier draft of this section had a **Production** family ("no net words in
60 s") and defined Rate as `WPM < ¼ × W_<phase>`. Both were dead logic, for the
same underlying reason: **the phase channel is already computed from typing
rate, so any deviation signal also computed from typing rate is not independent
of it.** Working the numbers through:

- *During Translating*, the phase rule requires `WPM ≥ WPM_GATE`. For the §7
  participant that is 19, while the Rate signal needed `WPM < ¼ × 28 = 7`.
  Mutually exclusive — the signal could never fire in the phase it was written
  for. The same argument kills Production: Translating requires recent
  keystrokes, so words are by definition being produced.
- *During Planning*, both signals invert and become true almost continuously,
  because Planning is *defined* by low typing and low output. They would fire on
  every legitimate thinking pause.

A signal that is definitionally true — or definitionally impossible — in a phase
carries no information in that phase. Stated positively: *you cannot treat "not
producing text" as abnormal in the phase whose definition is not producing text.*

The fix is to measure a **different dimension**: total interaction events per
minute (keystrokes + scrolls + selection gestures), against a per-phase
calibrated baseline. This is genuinely independent of the phase rule — Planning
is the residual phase and constrains interaction rate not at all — so the signal
is informative in all three phases, and it asks a different question from the
Time family: *sustained low activity* rather than *one long gap*. A writer
making five brief touches separated by 20 s gaps trips Rate without ever
tripping Time.

This adds three parameters (`ACT_P`, `ACT_T`, `ACT_R`), taking the total from
ten to thirteen. Without a profile there is no baseline to deviate from, so the
Rate family is simply disabled and the fallback runs on Time + Environment.

The Time signal uses `lastActivityTime`, not `lastKeyTime` — it is updated by
scrolls and selection gestures as well as keystrokes ([content.js:35](public/content.js:35)).
This is the discriminator that makes Planning work at all: a writer who is
genuinely planning is still *present* — rereading the prompt, scrolling, moving
the cursor. A writer who has disengaged produces no interaction of any kind.

The current `WPM < 10` guard on rapid-switching is **dropped**. It is no longer
needed: a writer typing productively while switching tabs fires Environment and
nothing else, which is one family, which is not enough.

### 8.3 Categorical triggers — sufficient alone

Two observations bypass the two-family requirement:

| Trigger | Condition | Why it stands alone |
|---|---|---|
| **Tab away** | tab hidden > `TAB_AWAY_THRESHOLD_MS` (60 s) | Not a deviation from a baseline — direct evidence the participant is not in the document. |
| **Severe stall** | no interaction of any kind for > **3 × `IDLE_<phase>`** | An extreme deviation needs no corroboration. |

The severe tier closes a real gap. Without it, a participant who disengages
during Planning without switching tabs fires only the Time family — one family,
never enough — and would never be flagged.

It also lands where it should. For the worked example in §7:

| Phase | `IDLE` | Severe tier (3×) |
|---|---|---|
| Planning | 37 s | 111 s |
| Translating | 15 s | 45 s |
| Reviewing | 16 s | 48 s |

The Planning severe tier arrives at ~111 s — close to the current global 120 s
rule. The flat 120 s threshold effectively becomes a *per-phase* severe tier,
which is a useful sanity check that the calibration is not producing nonsense.

### 8.4 Hysteresis

**Enter** Distracted at ≥ 2 families. **Leave** at 0 families — not at 1.

The classifier runs every 2 s. A symmetric threshold makes the state oscillate
across the boundary, and every oscillation opens a new distraction episode,
fires a new Gentle Reminder, and triggers a new Gemini call.

The distraction **episode** lifecycle is unchanged and stays separate from the
attention state: an episode opens at onset and closes only on the first *writing*
keystroke, because that is the H1 resumption measure. The attention state may
return to Focused before the episode closes — exactly as the current phase
already does on tab return.

### 8.5 Output stays binary

No intermediate "Drifting" state. Ground truth comes from a human watching a
screen recording, who can label "they were away / they had stopped" but cannot
reliably label "drifting". Do not create a state that cannot be validated.

The family count is kept internally and exported per episode, so the graded
evidence is available for analysis without being a reported state.

---

## 8A. Time accounting: overlap, not partition

Under one label, the four phases partitioned the session and `writingSec` was
simply "total minus Distracted".

Under two labels the participant is **always** in one of three phases, and
distraction is a subset of that time. Therefore:

- `phasesMs` — total time in each of Planning / Translating / Reviewing.
  These sum to the tracked session.
- `distractedMs` — time distracted **within** each phase. A 3-way breakdown that
  is a subset of the above.
- `writingSec` = `sum(phasesMs) − sum(distractedMs)`, preserving its current
  meaning as on-task time.

The analytics chart shows three slices with the distracted portion marked inside
each, rather than Distracted as a fourth peer slice.

This is what produces the 3 × 2 matrix — *time distracted, by phase* — that the
one-label model structurally cannot report.

---

## 9. Validity guards

A degenerate profile is worse than no profile: a participant who barely types
yields a near-zero `W_T`, making the Translating gate trivially satisfiable so
that every phase reads as Translating.

**Floors and caps.** All idle thresholds clamped to **[15 s, 180 s]**. The floor
prevents an implausibly tight threshold (as in P01's Translating segment); the
cap prevents an unusable one.

**Rejection checks.** The profile is invalid if any of:

| Check | Meaning |
|---|---|
| `W_T <= W_R` | did not type more while writing than while reviewing — segments not followed |
| Translating segment < 100 printable keystrokes | too little text produced to characterise anything |
| fewer than 5 pauses in a phase | that phase's idle threshold falls back to default |
| MAD = 0 in a phase | no spread; that phase's idle threshold falls back to default |

**On rejection:** fall back to the current fixed constants and record
`calibrationValid: false` plus the failed check in the export. A bad profile
must be **visible in the data**, never silently distorting one participant's
session.

**Pilot tunables**, to be checked with at least two participants before the main
study:
- the MAD multiplier (currently 3)
- the idle floor (currently 15 s)
- the 2-signal deviation threshold

---

## 10. What the participant sees

The conference paper (§3.3) makes transparency an explicit design commitment:
the baseline must not be a hidden internal parameter.

Show **three** numbers, not ten:

- "Your writing speed: **28 WPM**"
- "Your reviewing speed: **9 WPM**"
- "You naturally pause for up to **~15 seconds** while writing"

The full ten-parameter profile goes in the export, not on the screen.

---

## 11. Fallback when no profile exists

Dev testing, a pre-calibration session, or a rejected profile (§9) must still
run. Defaults:

| Parameter | Fallback | Source |
|---|---|---|
| `WPM_GATE` | 10 | current constant |
| `BURST_MIN` | 10 s | current constant |
| `DELETE_GATE` | 5/min | current constant |
| `SCROLL_GATE` | 5/min | current constant |
| `IDLE_P`, `IDLE_T`, `IDLE_R` | **40 s** | see below |

The idle default is **not** the current 120 s. Under the graded rule (§8.3), the
severe tier sits at 3 × `IDLE`, so `IDLE = 40 s` makes the severe tier land at
**120 s** — reproducing today's behaviour exactly, while giving the two-family
rule a mild tier to work with. The default is derived from the current system,
not chosen freely.

Sessions running on fallback values record `calibrationValid: false` and the
reason in the export.

---

## 12. Decisions settled

| Decision | Resolution |
|---|---|
| Implementation status | **Implemented end to end** — classifier, capture, profile math, UI, export (`npm test`, 60 checks). Not yet run in Chrome against a real document. |
| Fourth phase or orthogonal condition | **Orthogonal** — two labels (§2) |
| Calibration scope | **Per participant, once** (§3) |
| Segment durations | **3 / 5 / 4, 12 min total** (§4) |
| Statistic for idle thresholds | **median + 3 × MAD**, pauses ≥ 2 s only (§5.2, §6.1) |
| Statistic for discriminating thresholds | **midpoint of the two class means** (§6.2) |
| Selection-gesture threshold | **Dropped** (§6.3) |
| Deviation combination | **≥ 2 signal families**, plus two categorical triggers (§8.2–8.3) |
| Hysteresis | **Enter at ≥ 2, leave at 0** (§8.4) |
| Time accounting | **Overlap** — distraction is a subset of phase time (§8A) |
| No-profile behaviour | **Fallback constants + `calibrationValid: false`** (§11) |

---

## 13. Open items

1. **Conference paper §3.3 and §4.2 describe a two-segment calibration** (type a
   paragraph, then edit it). That version produces no Planning baseline at all.
   Both sections need rewriting to the three-segment protocol.
2. **Thesis Chapter 3 and Chapter 5** still describe four phases including
   Distracted. Both need updating to the two-label model.
3. Add Leys et al. (2013) to the reference list.
4. Pilot tunables to verify (§9): the MAD multiplier (3), the idle floor (15 s),
   the severe-tier multiplier (3×), and the two-family threshold.
