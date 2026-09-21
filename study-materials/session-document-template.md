# Session document — template

The Google Doc each participant writes in. Build it once, then copy it per
participant.

Two things this design is doing at the same time:

1. **Nothing requires leaving the tab.** The pilot showed participants going off
   to look things up, and the system counts any tab-away over 60 s as
   distraction — so those episodes were not distraction at all. The sources are
   in the document instead.
2. **The task still loads working memory.** An opinion-only essay is too easy to
   resume: everything is already in the writer's head, so an interruption costs
   little and the recovery prompt has nothing to help with. Holding a position,
   three reasons, two sources and a counterargument is what makes losing your
   place expensive — which is the thing the study measures.

---

## Order matters: sources ABOVE, writing BELOW

The recovery summary reads the **end** of the document to tell the participant
where they left off. With sources at the bottom, it would quote a source back at
them instead of their own unfinished sentence.

### The divider line is load-bearing

`WRITE YOUR ESSAY BELOW THIS LINE` is not decoration. The extension cuts the
document there and sends **only what is below it** to the summary model.

This matters most at the first distraction, around minute 10, when a participant
may have written two sentences against ~2,900 characters of prompt and sources.
Without the cut, the excerpt would be mostly Source A and B, and the summary
would tell the writer they left off mid-way through a source passage — wrong
guidance at the exact moment the study is measuring recovery.

Keep the wording exactly as written. If you change it, change `ESSAY_DIVIDER` in
`public/background.js` to match; `test/docs-auth.test.mjs` reads this file and
fails if the two drift apart.

If a participant deletes the line mid-session, the summary degrades to using the
whole document rather than failing — but the first summary after that may quote a
source.

---

## Paste this into the document

```
Should universities replace final exams with projects?

Write an argumentative essay of at least 500 words. In your essay:
  • take a clear position
  • support it with at least three reasons
  • use at least two of the three sources below, and say which you are using
  • respond to the strongest argument against your position
  • end with a conclusion

─────────────────────────────────────────────────────────────
The three passages below were prepared by the researchers to represent
common arguments in this debate. They are not quotations from published
work and should be cited as "Source A", "Source B" and "Source C".
─────────────────────────────────────────────────────────────

SOURCE A — argues for projects

Final examinations reward a narrow kind of performance: recalling
material under time pressure, alone, without resources. Very little
professional work resembles this. Projects ask students to plan over
weeks, use references, revise after feedback, and produce something that
could exist outside a classroom — closer to what graduates are actually
expected to do. Projects also spread assessment across a term rather
than concentrating it into a single high-stakes hour, which reduces the
chance that one bad day determines a grade. Students who need time to
think, or who write slowly, are not penalised for that alone. Where
exams measure what can be retrieved quickly, projects measure what can
be built carefully.

SOURCE B — argues for exams

Examinations have one clear advantage: the person sitting the exam is
the person being assessed. Projects are completed unsupervised, which
makes it harder to know whose work is being graded — a difficulty that
has grown as AI writing tools have become common. Exams are also equal
in resources: everyone has the same time, the same materials, and no
advantage from a quieter home, a faster laptop, or help from family.
Projects favour students with time and support outside class. Marking is
more consistent too, since exam answers respond to identical questions,
while project topics vary so widely that fair comparison between
students becomes difficult.

SOURCE C — practical trade-offs, takes no position

The choice is not only about fairness. Projects take longer to mark and
need more detailed criteria, since two projects on different topics
cannot be compared question by question. Feedback arrives later, though
it is usually more specific. Exams are quicker to mark and easier to
schedule, but produce little feedback a student can act on afterwards.
Workload also shifts: exams concentrate student effort into a revision
period, while projects spread it across a term and can collide with
deadlines in other subjects. Departments adopting projects often report
needing clearer rubrics and staged deadlines before the change works.

─────────────────────────────────────────────────────────────
WRITE YOUR ESSAY BELOW THIS LINE
─────────────────────────────────────────────────────────────
```

**Stop the paste at the line above.** Leave the space beneath it genuinely
empty — no placeholder, no "[leave empty]", no instruction to the participant.

Anything sitting below the divider is read as the participant's own writing.
A placeholder left in would make the first recovery summary tell them they left
off at "leave empty" — worse than no summary, because an empty space correctly
falls back to estimating their position from timing and phase instead.

---

## Choosing the three sources

| Source | Role | Why |
|---|---|---|
| A | argues **for** | gives them material to agree with |
| B | argues **against** | feeds the required counterargument |
| C | **findings or figures**, no side | something to interpret rather than copy |

They must **disagree with each other**. Three agreeing sources let a participant
lift one idea and stop thinking; conflicting ones force weighing and combining,
which is where the memory load comes from. A above says exams measure the wrong
thing; B answers that projects cannot verify authorship; C complicates both with
workload. None of them can simply be copied.

### Why these are researcher-prepared, not real excerpts

Constructed passages are standard for experiment stimuli, and here they are the
better choice: length, reading level and difficulty are controlled, so no
participant gets a harder source than another, and nobody recognises an article
they have read before.

Two rules were followed and must stay followed if they are rewritten:

- **No invented authors, publications or citations.** The passages carry no
  attribution, and the document says plainly that the researchers wrote them.
- **No invented statistics.** Source C describes trade-offs rather than quoting
  figures. A fabricated number is the one thing a participant might repeat in
  their essay, and it would end up in your data.

If you would rather use **real published excerpts**, that works too: keep them to
100–150 words each, give each a full citation, and drop the researcher-prepared
note. Short excerpts with attribution are fine for research use.

**Declare the AI assistance.** These passages were drafted with AI help and
revised by the group. That belongs in your AI usage declaration under materials
or design-asset creation.

---

## Before you run anyone

- [x] Topic confirmed by the group on 16 Sep 2026, and different from the
      calibration topic (class attendance), so nobody arrives having already
      argued this case. If it is ever changed, the three passages must be
      rewritten to match and so must `studyTask` in `src/App.jsx` —
      `test/extension-pages.test.mjs` fails if the two drift apart.
- [ ] The three passages read well to your group, and match the topic
- [ ] The researcher-prepared note is present, and no passage carries a fake
      citation or an invented statistic
- [ ] Sources positioned **above** the writing area, with the
      `WRITE YOUR ESSAY BELOW THIS LINE` divider between them, worded exactly
      as in the block above
- [ ] Time yourself: reading all three and starting to write should take **under
      5 minutes**. The first distraction arrives at minute 10.
- [ ] Master document saved read-only, so no session edits it
- [ ] Per participant: *File → Make a copy*, named by participant ID, writing
      area empty
- [ ] **Nothing at all below the divider** — click beneath it and confirm the
      cursor sits on a blank line with no placeholder text
- [ ] **The document is ready before you press Start Task.** The extension
      measures the document once at session start and treats whatever is there
      as the starting point. Paste the prompt and sources *after* starting and
      those ~450 words are credited to the participant as writing.

---

## What the extension does with this

| | |
|---|---|
| Prompt and sources already in the document | counted as the baseline; "words added" starts from zero for the participant |
| Scrolling up to reread a source | activity — the idle clock stops, nothing is flagged |
| Rereading sources | may be classified as **Reviewing**, slightly inflating that phase. A known limitation; the screen-recording coder can see the difference. |
| The prompt and sources | never sent to the summary model — cut off at the divider |
| The essay text | read only to generate recovery summaries, never stored or exported |
| A participant who has not started writing | gets a summary estimated from timing and phase, rather than a quoted source |

---

## The same task for everyone

One prompt, one set of sources, every participant. Each person does one session
in one condition, so any difference between the tasks people write would land
unevenly between the baseline and intervention groups and read as an effect of
the recovery prompt.

This replaces the pilot's course-aligned tasks. Report that change, and why:

> "Pilot participants writing course-assigned tasks left the document to consult
> sources. Because the system cannot distinguish reference-checking from
> disengagement, those episodes were recorded as distraction. The main study
> therefore used a single standardised prompt with source material supplied
> inside the document."
