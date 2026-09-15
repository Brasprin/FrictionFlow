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

Paste the summary row into a spreadsheet, one line per session. Those columns
feed a **paired** comparison across participants (Wilcoxon signed-rank, or a
paired *t*-test if normality holds).

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
