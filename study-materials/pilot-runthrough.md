# Pilot run-through

Nothing has been walked end to end in Chrome. This is that walk. Do it once
yourself before any participant sees the extension.

Why it matters: the three bugs found on 16 Sep (a quota 403, the 443-word count,
task sources leaking into the recovery summary) were all noticed by a human, not
caught by a test, and two of them only appear in a **sustained** session. A
five-minute smoke test passes while they are live.

Budget about 25 minutes.

---

## Before you start

- [ ] `npm run build`, then reload the extension at `chrome://extensions`
- [ ] A Gemini API key is saved in **Options**, or summaries will be skipped
- [ ] A copy of the session document is open, already holding the prompt and the
      three sources, writing area empty
- [ ] The service-worker console is open (`chrome://extensions` -> **service
      worker**). Most failures announce themselves there and nowhere else.

---

## Step 1 — calibration, at full length

Enter the participant ID **first**, then run calibration. Entering it afterwards
is what produced "not calibrated" during development.

Run the real 12 minutes, not the 30-second test lengths. A test-mode profile is
stamped `test-mode-calibration`, deliberately rejected by `content.js`, and the
session then runs on defaults and reports itself uncalibrated. That is correct
behaviour, not a bug -- but it means test-mode calibration cannot verify the
calibration path.

- [ ] Participant ID entered before starting
- [ ] Three segments each ran their full length
- [ ] The panel reports a valid profile afterwards
- [ ] Console shows no failures listed on the profile

---

## Step 2 — the session, on the short schedule

Turn on **short distractions** in Options: episodes at minutes 1, 3 and 5 with
70-second exposure, instead of 10/25/40 at 180 seconds. The session is stamped
`testMode: true` in the export so this run can never be mistaken for data.

Choose the **intervention** condition. Baseline suppresses recovery content by
design, so summaries will not appear and you will not have tested them.

- [ ] Document ready **before** pressing Start Task, not pasted after
- [ ] "Words written" reads 0 at the start, not ~441
- [ ] Write continuously for a few minutes and watch the count track what you add

---

## Step 3 — the distractions

Three episodes fire. For each:

- [ ] The memory game opens, and the cards are visible and turn over
- [ ] The game is playable to completion
- [ ] Returning to the document is detected
- [ ] A recovery summary appears (intervention condition only)

Read the first summary carefully. It arrives when your essay is still short,
which is exactly the case that used to quote Source A back at you:

- [ ] The summary describes **your own writing**, never a source passage
- [ ] If you had barely started, it estimates your position instead of quoting

---

## Step 4 — let it run quiet

Stop typing and leave it alone for several minutes, reading the sources.

- [ ] The banner does **not** flip to "Google Docs not connected"
- [ ] The service-worker console shows no 403s piling up

This is the state the old 2-second poll broke in. It costs nothing to check and
it is the failure most likely to hit a real participant mid-session.

---

## Step 5 — the export

Download at the end and open it.

- [ ] Word count matches roughly what you wrote, not the whole document
- [ ] Three distraction episodes recorded, each with its game event log
- [ ] Phase durations look like the session you actually had
- [ ] `testMode: true` is present, so this run is identifiable as a test
- [ ] The trace CSV opens and the columns line up
- [ ] No document text anywhere in the export

---

## If something fails

Capture the banner text and the service-worker console before reloading. Both
were what identified the quota problem; a reload throws them away.
