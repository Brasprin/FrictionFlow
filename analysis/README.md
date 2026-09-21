# Analysis — threshold comparison

Answers the question *"did calibration actually help?"* with a number instead of
an argument.

A session is recorded **once**. Afterwards it is interpreted **twice** — with
the participant's calibrated thresholds, and with the fixed pre-calibration ones
— and both are scored against the same screen-recording ground truth. No extra
sessions, no extra participants, no re-recording: the trace file holds the
classifier's raw inputs, so any threshold set can be applied to it after the
fact.

This is the same logic as the study's own baseline condition. You do not skip
the control just because you expect the treatment to win.

## What you need per session

| File | Where it comes from |
|---|---|
| `<session>.json` | the panel's **Download session data** |
| `<session>_trace.csv` | same download — one row per 2 s tick |
| `coding.csv` | your coder, from the screen recording |

## The coding file

The coder does **not** label 1,500 rows. They watch the recording once and write
down *stretches* — a new row whenever either channel changes. Fifteen to thirty
lines for a 50-minute session.

```csv
start,end,phase,attention
0:00,3:20,Planning,Focused
3:20,5:45,Translating,Focused
5:45,6:10,Translating,Distracted
6:10,9:30,Translating,Focused
9:30,11:00,Reviewing,Focused
```

- times as `m:ss`, `h:mm:ss`, or plain seconds, measured from session start
- `phase` — `Planning` | `Translating` | `Reviewing`
- `attention` — `Focused` | `Distracted` (omit the column to treat everything as Focused)

Note that phase and attention are coded **independently**: a distracted stretch
still carries the phase the writer was interrupted in. That is what makes
"distracted while drafting" recoverable, and it matches the two-label model the
extension uses.

Uncoded stretches are skipped rather than guessed, so partial coding is fine.

See `coding-template.csv`.

## Step 0 — check replay fidelity before you code anything

Coding a session takes about an hour. Replay fidelity does not depend on the
coding at all — it compares this script's re-classification against what the
extension actually recorded, over every tick — so check it first with a stub
file and only invest the hour if it passes.

```bash
printf 'start,end,phase
0:00,0:10,Planning
' > stub.csv
node analysis/compare-thresholds.mjs session.json session_trace.csv stub.csv
```

Read only the fidelity line. Above ~95% means this script and `content.js` still
agree and the comparison can be trusted. Below it, they have drifted and nothing
downstream means anything — fix that first.

Worth knowing what fidelity is **not**: it does not say detection is accurate.
It says this script reproduces the extension's own decisions. Accuracy is the
kappa against the human coding, which is the part that needs the recording.

## Running it

```bash
node analysis/compare-thresholds.mjs session.json session_trace.csv coding.csv
```

Output:

```
Replay fidelity (this script vs what the extension recorded)
  phase 100.0% · attention 100.0%

PHASE (Planning / Translating / Reviewing)
  calibrated  agreement  78.4%   kappa 0.712
  fixed       agreement  64.1%   kappa 0.523

ATTENTION (Focused / Distracted)
  calibrated  agreement  91.2%   kappa 0.804
  fixed       agreement  86.6%   kappa 0.701

Confusion matrix — calibrated, phase (rows = coder, cols = system)
...
Summary row (participantId,condition,phaseKappaCal,phaseKappaFix,...)
P01,intervention,0.712,0.523,0.804,0.701,1487
```

### The starred phase rows

The phase channel is scored twice. Rows without `*` are the phase exactly as the
extension recorded it. Rows with `*` carry the interrupted phase through each
episode — the same rule `public/content.js` now applies to episode records and
`analysis/fix-onset-phase.mjs` applies to exports.

The gap between them is the cost of the phase decay: detection needs a stall,
and a stall is also what makes the classifier say Planning, so the recorded
phase during an episode describes the silence rather than the writer. A coder
watching the recording sees someone stop mid-sentence and writes
"Translating, Distracted"; the uncorrected replay says "Planning".

Report the starred figures as the system's phase accuracy — they describe the
version that ships. Report the unstarred ones alongside for sessions recorded
before 16 Sep 2026, since that is what those participants' data actually
contains. Replay fidelity is deliberately measured against the **uncorrected**
replay: it asks whether this script reproduces the extension, and that answer
must not be improved by a correction applied afterwards.

Paste the summary row into a spreadsheet, one line per session. Those columns
feed a **paired** comparison across participants (Wilcoxon signed-rank, or a
paired *t*-test if normality holds).

### How many sessions before that test can say anything

A two-tailed Wilcoxon signed-rank test has a floor set by the number of pairs,
not by the effect size. With *n* pairs there are 2^*n* sign patterns, so the
smallest achievable two-tailed *p* is 2 / 2^*n*:

| pairs | smallest possible *p* | can reach *p* < .05? |
|---|---|---|
| 3 | .250 | no |
| 4 | .125 | no |
| 5 | .063 | no |
| 6 | .031 | yes |
| 8 | .008 | yes |

**Six coded sessions is the hard floor**, and that is before any consideration of
power — it is the point at which significance stops being arithmetically
impossible. Coding fewer is still worth doing, as a pilot of the process and to
report descriptively, but do not expect a *p*-value from three.

This comparison is about **detection**, not about the intervention, so sessions
from both conditions count toward the same *n*.

This comparison stays paired even though the study itself is between-subjects:
both kappas come from the *same* session — one scored with the participant's
calibrated thresholds, one with the fixed ones — so each participant is compared
with themselves. The hypothesis tests (H1–H4) are different: each participant is
in one condition only, so those compare the baseline group with the
intervention group using independent-samples tests.

## Read replay fidelity first

`compare-thresholds.mjs` reimplements the classifier so it can apply thresholds
the session never ran under. Nothing forces that copy to stay in step with
`public/content.js`, and if the two drift the comparison keeps producing
plausible-looking numbers while measuring the wrong classifier.

Fidelity re-runs the participant's **own** thresholds and checks the result
against the decisions the extension actually recorded. It should be ~100%.
**Below 95%, stop** — fix the drift before reporting anything else.

`npm test` runs `test/replay.test.mjs`, which asserts row-for-row agreement
between the two implementations, so drift fails the build rather than surfacing
months later in the analysis.

## Cohen's kappa, and why not just percentages

Most of a writing session is one phase, so a classifier that always guessed
"Translating" would post a high raw agreement. Kappa corrects for the agreement
chance alone would produce. Report both; kappa is the defensible one.

Landis & Koch put 0.61–0.80 at "substantial" and 0.81+ at "almost perfect".
Treat that as a convention, not a pass mark.

## Before any of this means anything

**Have a second coder independently code ~20% of the recordings and report
inter-rater kappa.** Agreement with a coder is worthless if the coder is
unreliable, and it is the first thing a panel asks about ground truth.

## If the fixed thresholds win

Report it. It would mean the 12-minute calibration does not earn its cost, which
is a genuine finding — and calibration can still be defended on the
arbitrariness argument, which does not depend on this result. A thesis that
tests its own design choice and reports the outcome is stronger than one that
assumes it.

---

## check-export.mjs — screening sessions collected before 16 Sep 2026

```
node analysis/check-export.mjs P01.json P02.json P03.json
```

Three fixes landed on 16 Sep 2026 that could affect a session recorded earlier
the same day: the word count credited the whole document to the participant, an
exhausted Docs API quota froze the count mid-session, and the recovery prompt
could quote a task source back at the writer.

Only the first two can touch **baseline** sessions — the recovery prompt is
suppressed in that condition by design, so nothing generated from it exists.

Neither touches phase or attention measurement: `updateState()` banks elapsed
time on its own 2-second timer, independent of the word-count sync, so phase
durations, distraction episodes and every WPM figure are unaffected. The WPM
figures read `typedWords`, which is keystroke-derived and immune to both bugs.

What the script flags:

| Level | Meaning |
|---|---|
| `CORRECT` | `wordsAddedToDoc` is inflated by the pre-loaded document; subtract, or use `typedWords` |
| `DROP FIELD` | the Docs sync never worked; `wordsAddedToDoc` is unusable, `typedWords` stands |
| `EXCLUDE` | stamped `testMode` — a test run, not participant data |
| `NOTE` | no valid calibration profile; the session ran on defaults |

A session flagged `CORRECT` or `DROP FIELD` is still usable. Only `EXCLUDE`
means the session is not data. Record whichever correction you applied, per
participant, so the choice is visible in the write-up rather than buried.

---

## The declared calibration rule (`cal+rule` rows)

Agreed on 17 Sep 2026, after P02 was coded and **before** any other session was
coded. The commit that added it is the record of that order.

1. **Scroll limit.** If calibration observed no scrolling in any segment, use the
   default 5/min instead of the calibrated value. A calibration with no scrolling
   produces a limit of 1/min, at which a single scroll while not typing reads as
   Reviewing. All three first participants calibrated to zero scrolling. This
   reason does not depend on any coding.
2. **Burst length.** Never require more sustained typing than the default 10 s
   before classifying Translating. This limit was suggested by P02's coding.

**How to report it.** P02 formed the rule, so P02 is not evidence for it. The test
is P01, P03 and every later session: does `cal+rule` agree with the coder better
than `calibrated`? Report the rule as declared, the sessions it was tested on, and
the result whichever way it goes.

The extension's live detection is unchanged. The rule exists only in analysis, so
baseline and intervention participants were all detected identically.

---

## Second declared variant: no scroll in Reviewing (`no-scroll` rows)

Declared 21 Sep 2026. Reviewing requires deleting while typing slowly; scrolling
no longer qualifies. Scrolling still counts as activity, so reading a source never
looks like absence. Built on the declared rule above, so `cal+rule` and
`no-scroll` differ only in the scroll condition.

**Why.** The source passages sit above the writing area, participants scroll up
to reread them, and the coding scheme calls that Planning. The cost: rereading
one's own essay without deleting also becomes Planning, where the coder says
Reviewing. Coders mark `(reading sources)` so the two can be told apart.

**Order.** Declared after P02 was scored and before P01, P03 or any later session
was coded, so all of them are clean tests of it. (A `P03_coding.csv` existed at
the time, but it held only an empty template — no stretches had been coded.)

**Decision, fixed in advance:** adopt it if its phase kappa beats `cal+rule` on
the sessions it is tested on, without lowering attention kappa.

---

## Decisions recorded 21 Sep 2026, after P01-P03 were scored

**cal+rule: adopted.** On both clean tests it beat calibrated on phase and on
attention (P01: phase 0.114 -> 0.240, attention 0.560 -> 0.643; P03: phase 0.111
-> 0.119, attention 0.809 -> 0.829).

**no-scroll: not adopted, reported as exploratory.** It passed the phase condition
on both clean tests (P01: 0.240 -> 0.388; P03: 0.119 -> 0.284) but attention on P01
fell from 0.643 to 0.639. The declared condition was "without lowering attention
kappa", with no tolerance, so it did not pass as written. The group chose to
follow the condition exactly rather than treat a 0.004 miss as a pass.

**no-scroll: re-declared for P04 onward, with a tolerance.** Adopt it if, once
coding of the final participant is complete, its mean phase kappa across the
sessions from P04 onward is higher than cal+rule's, and its mean attention kappa
is no more than 0.02 lower. P01-P03 do not count toward this; they have all been
seen.

**Distraction label check (Objective 2).** For each distraction episode, the phase
a recovery prompt would name - the phase at the last tick the participant was
active, read from the recorded trace - against the coder's phase at the last
Focused second before onset. P01-P03: 4 of 10 matched (4 of 7 induced, 0 of 3
natural). Every mismatch but one had the coder seeing Planning just before the
distraction, while the rule named Translating or Reviewing. The rule carries the
phase from the last *active* moment, and quiet thinking is not activity, so it
rarely names Planning. Recorded as a limitation; the rule is not being changed on
the strength of sessions already seen.

**Logged, not used (from P04):** `wpm10` and `selectPerMin` trace columns, for
testing a faster typing window and selection-based Reviewing on P04 onward. Any
rule using them must be declared before the sessions it is tested on.

**Phase kappa is reported strictly** - every coded second, no tolerance at
boundaries - since any alternative scoring would be designed after seeing these
three sessions.

