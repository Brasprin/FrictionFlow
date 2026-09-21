# Instructions for the person watching the recordings

You will watch a screen recording of someone writing an essay and write down
what they were doing. About an hour per recording. No technical knowledge needed.

Do not look at any file from the extension before you finish. Just the video.

---

## What you are producing

A table. One row per stretch of time. Start a new row whenever **either** column
would change.

```
start,end,phase,attention
0,200,Planning,Focused
200,345,Translating,Focused
345,370,Translating,Distracted
370,570,Translating,Focused
570,660,Reviewing,Focused
```

Times in **plain seconds**, read straight off the video player's clock. Do not
try to work out when the session started — whoever prepared the video has
already recorded that, and it is corrected for afterwards. Just use the time the
player shows. Type whole numbers
only — if you type 3:20 in Excel it silently corrupts the file.

Expect 15 to 30 rows for a 50-minute recording. You are not labelling every
minute, only the changes.

---

## Column 3 — phase. What kind of writing work?

Always one of these three. Pick the one that best describes the stretch.

**Planning** — working out what to say, not producing sentences.
Looks like: staring at the screen, reading the prompt again, reading the source
passages, typing a few words then stopping, making notes or an outline, cursor
not moving much.

**Translating** — turning thoughts into sentences.
Looks like: sustained typing, text growing steadily, moving forward through the
document rather than back over it.

**Reviewing** — going back over what is already there.
Looks like: scrolling up, rereading their own text, selecting and deleting,
rewording a sentence, fixing typos, cursor jumping backwards.

**The rule when unsure:** ask what is *growing*. New text appearing = Translating.
Existing text changing = Reviewing. Neither = Planning.

---

## Column 4 — attention. Were they on the task?

**Focused** — attention is on the writing task, including thinking about it.
Sitting still and thinking is Focused. Rereading a source is Focused. Staring
at their own paragraph is Focused.

**Distracted** — attention is visibly somewhere else.
Another tab or window unrelated to the task, phone, looking away from the screen
for a long time, clearly disengaged.

**Do not use a stopwatch.** How long a pause lasted is not the question. The
question is where their attention was. A two-minute silence while they think is
Focused; fifteen seconds on another tab is Distracted.

If you genuinely cannot tell, choose Focused. Guessing Distracted because a
pause felt long is the one habit that ruins this.

---

## The two columns are independent

A distracted stretch still carries the phase they were **interrupted out of**.

If they were drafting and switched to another tab, that row is
`Translating,Distracted` — not a fourth category. Whatever they were doing
before the interruption is what the phase column keeps saying.

---

## Edge cases you will hit in the first ten minutes

| What you see | What to write |
|---|---|
| Scrolling up to reread one of the source passages | Planning, Focused — they are gathering material |
| Scrolling up to reread **their own writing** | Reviewing, Focused |
| Long silence, nothing moving, screen on the document | Focused. Phase = whatever they were doing before |
| A card-matching game opens in a new tab | Distracted. Phase = whatever they were doing before |
| Typing a sentence, deleting it, typing it again | Translating — new text is the point |
| Fixing a typo mid-sentence while drafting | Translating — do not start a new row for this |
| Long silence with an unrelated tab or phone visible | Distracted |
| Cannot tell at all | Focused, and leave a note |

If the person **steps away or stops working for a few minutes**, code it as you
see it — you cannot tell from the video whether they pressed "Take a break", and
you do not need to. Sanctioned breaks are recorded by the extension and removed
from the comparison automatically.

Do not start a new row for changes lasting only a few seconds. You are marking
stretches, not moments.

---

## Steps

1. Open the recording and a blank spreadsheet or text file with the four column
   headings.
2. Play it through once at normal speed. Pause when something changes, write the
   row, continue.
3. Save as `<participant>_coding.csv` — for example `P01_coding.csv`.
4. Give it to whoever is running the analysis. Do not open the extension's
   files.

If you are unsure about a stretch, write the row and add a note beside it. A
noted uncertainty is useful; a confident guess is not.
