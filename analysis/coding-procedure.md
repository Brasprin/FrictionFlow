# Validating detection — the step-by-step

How to get from "we have recordings" to a kappa you can defend. Do the steps in
order; each one is cheap to undo and expensive to skip.

The claim being built: **the system's phase and attention labels agree with what
a human sees in the recording**, and **calibrated thresholds agree better than
fixed ones**. Two separate claims, two separate numbers.

---

## Step 1 — screen the exports (minutes)

```bash
node analysis/check-export.mjs P01.json P02.json P03.json
```

Catches sessions affected by the word-count and Docs-quota bugs fixed on
16 Sep 2026. `EXCLUDE` means the session is not data; everything else is usable
with a correction noted. Nothing here touches phase or attention.

---

## Step 1b — recover the trace CSV if it did not download

```bash
node analysis/extract-trace.mjs P01_baseline_2026-09-16.json
```

The panel downloads three files from one click, and Chrome frequently blocks
the second and third. The trace also ships **inside** the export JSON, so a
missing `_trace.csv` is a missing file, not missing data — this writes it back
out. Check for it before assuming a session cannot be analysed.

---

## Step 1c — correct the interrupted phase

```bash
node analysis/fix-onset-phase.mjs --write P01_baseline_2026-09-16.json
```

Writes `<session>_corrected.json`: a **complete** export, same shape as the
original, so it drops into any analysis in place of it. Use the corrected file
from here on.

Every corrected field keeps its original beside it — `phaseRecorded` on each
episode, `distractedMsRecorded` at the top — and a `correction` block records
the rule, the window, and how many episodes changed. Nothing is hidden, and a
reviewer can recompute it from the trace that travels with the file.

**The original export is never modified.** Raw records stay exactly as the
extension wrote them; corrections are derived. That is also what lets anyone
check the correction rather than take it on trust.

Sessions recorded after 16 Sep 2026 already carry the right value live, so this
should report `0 of N episodes corrected` for them. Run it on every session
anyway — one rule applied uniformly beats a mix of live and corrected values,
and a non-zero count on a new session is a signal worth investigating.

---

## Step 2 — check replay fidelity (seconds per session)

```bash
printf 'start,end,phase
0:00,0:10,Planning
' > stub.csv
node analysis/compare-thresholds.mjs P01.json P01_trace.csv stub.csv
```

Read **only** the fidelity line. It does not depend on the coding, so this comes
before the hour of work, not after.

- **above ~95%** — the analysis script and `content.js` agree; continue
- **below** — they have drifted; nothing downstream is meaningful until fixed

---

## Step 3 — decide who codes, before any coding happens

This is a design decision, not a task assignment, and it is the first thing a
panel will ask about.

The coder must be **blind to what the system output** — no trace, no export, and
no view of the side panel, which displays the phase and a Distracted badge in
real time. A coder who has seen what the system decided produces agreement that
proves nothing.

Blindness to the **output** is what matters most, and cropping the recording
achieves it (Step 3b). Knowledge of the rule *structure* matters much less, as
long as the coding scheme is behavioural rather than time-based — a coder
judging "where was their attention" is using evidence the system does not have,
which is the whole point of a ground truth. A coder mentally timing pauses has
broken the exercise regardless of who they are.

Preferences, in order:

1. Someone outside the group. A coder need not be an author; an hour of a
   classmate's time and an acknowledgement is normal.
2. A group member who did **not** facilitate that participant, coding a cropped
   recording.
3. Whoever set the thresholds, coding a cropped recording — declare it.

Write down who coded what, and when. It goes in the methodology.

---

## Step 3b — blind the recordings by cropping the panel out

The side panel shows the system's answer **live**: the current phase in the
header, and a Distracted badge with a colour change. In the intervention
condition the recovery prompt appears there too. Anyone who watches the panel
during a session, or sees it in the recording, has seen the labels they are
supposed to be producing independently.

Cropping the panel out of the video removes that entirely. It is what makes
coding by a group member defensible: the coder may know the rule structure, but
they cannot see any decision the system made.

**What must not be visible in the coder's copy:**

- the side panel, in full — header, phase text, the state bar and its colour
- any recovery prompt or summary
- the export or trace file, at any point before coding

**What should stay visible** — it is the evidence they code from:

- the document, the text being written, scrolling and selection
- the browser tab strip, so tab-switching is visible
- the distraction game when it opens (episodes are scheduled by the clock, not
  detected, so seeing one reveals nothing about a detection decision)

**Trim the start first — this one silently ruins everything if missed.**
Coding times are measured from the moment **Start Task** was pressed, because
that is where the trace starts counting. A recording almost always begins
earlier: the facilitator opens the recorder, explains the task, then starts the
session. If the video starts 90 seconds before Start Task, every row the coder
writes is 90 seconds off, and the comparison scores a writer's drafting against
the system's view of their planning. Nothing errors. The kappa is just wrong.

So, **before cropping** (the panel is what shows the session starting): find the
video time at which Start Task is pressed. Then either:

- **Write it down** — the easy way. The coder uses the video player's own clock,
  and the comparison subtracts it:
  `node analysis/compare-thresholds.mjs P01.json P01_trace.csv P01_coding.csv --offset 1:32`
  The output confirms the shift it applied, so a missing offset is visible.
- **Or trim** everything before it, so the video's 0:00 is the session's 0:00, and
  check the trimmed length against `session.totalTimeSec` in the export.

The FrictionFlow timer cannot stand in for either: it is in the panel, which is
cropped out, and leaving it visible would show the coder the labels beside it.

**Check the crop before trusting it.** Take the timestamps of a few known
distraction episodes from the export (`fix-onset-phase.mjs` prints each episode's minute), and look at those frames in the cropped
copy. The colour change is the easiest thing to leak through a sliver of
remaining panel.

**Better still, for sessions not yet run:** record only the document region in
the first place, or move the panel off the recorded area. A recording that never
contained the panel cannot leak it, and there is no crop to verify.

Record in the methodology that recordings were blinded this way — it is a
strength, and a panel asking "who coded these?" is answered by "someone who
could not see what the system decided."

---

## Step 4 — code one recording as a dry run (about an hour)

Not for the dataset. This is to find out whether the stretch format survives
contact with a real recording, and how long an hour of video actually takes to
code.

Format, from `coding-template.csv` — a new row whenever **either** channel
changes. Fifteen to thirty rows for a 50-minute session, not 1,500.

```csv
start,end,phase,attention
0:00,3:20,Planning,Focused
3:20,5:45,Translating,Focused
5:45,6:10,Translating,Distracted
```

Phase and attention are coded **independently**: a distracted stretch still
carries the phase the writer was interrupted in. Uncoded stretches are skipped
rather than guessed, so partial coding is fine.

### Do not let Excel touch the time columns

Excel reads `3:20` as twenty past three in the morning. Saved back to CSV it
becomes either `3:20:00 AM` — which reads as 3h20m and scores nothing — or
`0.1388888`, a fraction of a day, which is a perfectly valid number and would
record a 200-second stretch as lasting 0.14 seconds. The second one is the
dangerous one: nothing looks wrong.

Three ways to avoid it, any of which works:

- **Type plain seconds** — `0`, `200`, `345`. Excel never reformats a whole
  number, and the script accepts them. Simplest, and what we recommend.
- Format the `start` and `end` columns as **Text** before typing anything.
- Use a plain text editor instead of a spreadsheet.

The script refuses a file it cannot trust: it checks every row against the
length of the session and rejects times that fall outside it, phases that are
not one of the three, and attention values that are not Focused / Distracted.

Agree in advance what the three phases look like on screen, and write those
definitions down before coding — not after seeing disagreements.

---

## Step 5 — run the comparison per session

```bash
node analysis/compare-thresholds.mjs P01.json P01_trace.csv P01_coding.csv
```

Record the summary row, one line per session, in a spreadsheet.

Report **agreement and kappa together**. Kappa collapses when a category is rare
— 90%+ agreement with kappa near zero is normal for attention in a session with
few distraction episodes, and quoting either number alone misleads.

---

## Step 6 — accumulate to at least six sessions

A two-tailed Wilcoxon signed-rank test cannot produce *p* < .05 with fewer than
six pairs. It is arithmetic, not power: with *n* pairs the smallest achievable
*p* is 2 / 2^*n*.

| pairs | smallest possible *p* |
|---|---|
| 3 | .250 |
| 5 | .063 |
| 6 | .031 |

This comparison is about detection, not the intervention, so **sessions from
both conditions count toward the same n**.

---

## Step 7 — second coder on ~20%

A second coder labels a fifth of the recordings independently, and the two
codings are compared to each other. This is inter-rater reliability: it
establishes that the ground truth itself is reliable.

Without it, "the system agreed with our coder" invites the obvious question of
whether the coder was any good.

---

## What each number actually claims

| Number | Claims | Does not claim |
|---|---|---|
| Replay fidelity | the analysis script reproduces the extension's decisions | that those decisions are correct |
| Kappa vs coder | detection matches what a human sees | that the recovery prompt helps |
| Calibrated vs fixed kappa | personalising thresholds improved detection | that the thresholds are optimal |
| Inter-rater kappa | the ground truth is reliable | anything about the system |

Keep these apart when writing up. Presenting the calibration comparison as
evidence of accuracy invites the accuracy question a second time.
