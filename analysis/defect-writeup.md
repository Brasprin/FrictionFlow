# Explaining the phase-labelling defect

What happened, how it was found, and what to say when asked. Adapt the wording;
do not read it out. The one thing you must be able to do unaided is explain the
mechanism in your own words — that is what a panel is testing.

---

## What actually happened, in order

1. Three baseline sessions were run on 16 September 2026.
2. Before any analysis, the exports were screened. Word counts, timings and
   calibration all checked out.
3. The distraction records did not. Every episode across all three
   participants — ten of ten — said the same thing: the writer had been
   **Planning** when interrupted. `distractedMs.Translating` was exactly zero
   for all three.
4. Ten out of ten identical is not a finding, it is a symptom. The per-tick
   decision trace was checked against it, and showed the participants had been
   Translating or Reviewing thirty seconds before each episode began.
5. The cause followed from that: detection requires a period of inactivity
   before it will flag a distraction, and inactivity is also what makes the
   classifier report Planning. By the time an episode opened, the phase had
   already decayed, and the freeze that holds the phase during an episode was
   holding the decayed value.

**Say it plainly: the system was recording what the silence looked like, not
what the writer had been doing.**

---

## The mechanism, in one breath

> "Our detector waits about a minute of inactivity before it calls something a
> distraction. But inactivity is also how we recognise planning. So by the time
> it decided someone was distracted, it had already decided they were planning —
> and that is the label it stored."

If you can say that without notes, the rest is detail.

---

## What was done about it

**The data.** The phase was recomputed from the decision trace as the phase at
the last tick where the participant had interacted within ten seconds. Nine of
the ten episodes changed. Phase totals moved with them — for P01, Planning fell
from 943 s to 453 s and Translating rose from 645 s to 1055 s.

**The exports.** Never modified. Corrections are written to separate files that
carry the original value beside the corrected one (`phaseRecorded`,
`phasesMsRecorded`) and a block recording the rule, the window and how many
episodes changed. The decision trace ships with them, so the correction can be
recomputed by anyone who wants to check it.

**The software.** The extension now records the last phase observed while the
participant was active. It is a label only — the value is deliberately not fed
back into the live phase, because that value selects the idle threshold and
changing it would have altered detection itself, mid-study, between the baseline
and intervention groups.

---

## Questions to expect

**"How do you know ten out of ten was wrong and not just true?"**
Because the trace records the phase every two seconds, and it shows sustained
typing at twenty-plus words per minute in the minute before most episodes. The
writers were demonstrably drafting. And a detector that reports one category one
hundred per cent of the time is describing its own rule, not the participants.

**"Where does the ten-second window come from?"**
It must be shorter than the smallest idle threshold in the session, or it starts
counting the stall itself as activity and the correction undoes itself. Every
participant calibrated to fifteen seconds at the smallest, so ten is below all
of them. The tool checks this per session and refuses to vouch for a session
where it does not hold, and it reports how much the result moves at twenty and
thirty seconds so the choice is visible rather than assumed.

**"Does this invalidate the affected sessions?"**
No. Detection itself was unaffected — the episodes were found, at the right
times, with the right durations. Resumption time, the primary measure, is a
timing and contains no phase at all; it did not change. What was wrong was one
derived label, and the trace contained everything needed to recover it.

**"Why should we believe the corrected numbers?"**
Because you do not have to take them on faith. Both values are in the file, the
rule is stated, and the raw trace travels with it. Recompute it.

**"Why did you not just discard those sessions?"**
Discarding sound data because a derived label needed correcting would cost three
participants and gain nothing — the same correction applies to every session,
including those collected afterwards.

---

## The framing

Do not apologise for it, and do not oversell it either. The accurate framing:

> The system logs the inputs behind every classification decision, every two
> seconds. That record is what made the defect visible, diagnosable and
> correctable after the fact — without re-running a single participant.

That is what the decision trace was built for. A panel that hears this hears a
group that instrumented its own instrument and then actually checked it.

---

## Declare the assistance

The analysis tooling (`fix-onset-phase.mjs`, `check-export.mjs`,
`extract-trace.mjs`, `compare-thresholds.mjs`) and parts of the extension were
written with AI assistance, and the defect was identified during an
AI-assisted review of the first three exports. That belongs in the AI usage
declaration alongside the source passages. Declaring it costs nothing and
withholding it is the only version that could become a problem.
