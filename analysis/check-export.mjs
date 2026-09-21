// Checks an exported session for the data problems that were possible before
// the 16 Sep 2026 fixes, so sessions collected on earlier code can be cleared
// or corrected rather than trusted on faith.
//
//   node analysis/check-export.mjs <export.json> [more.json ...]
//
// What it cannot tell you: anything about phase or attention measurement. That
// is unaffected -- updateState() banks elapsed time on its own 2s timer, so
// neither the word-count fix nor the polling change touched phase durations.

import fs from "node:fs";

// The session document ships with the prompt and three sources already in it.
const PRELOADED_WORDS = 441;

function check(file) {
  let x;
  try {
    x = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { file, fatal: `could not read as JSON: ${e.message}` };
  }

  const added = x.words?.wordsAddedToDoc ?? 0;
  const typed = x.words?.typedWords ?? 0;
  const whole = x.words?.wholeDocWords ?? 0;
  const notes = [];

  // The 443 bug: the whole document credited to the participant. typedWords is
  // keystroke-derived and immune, so the gap between them is the tell.
  if (whole > 0 && added >= whole - 5) {
    notes.push({
      level: "CORRECT",
      what: "wordsAddedToDoc looks like the WHOLE document, not what they wrote",
      why: `added=${added} is within 5 of wholeDoc=${whole}`,
      fix: `use ${Math.max(0, added - PRELOADED_WORDS)} instead, or typedWords=${typed}`,
    });
  } else if (typed > 20 && added > typed + PRELOADED_WORDS * 0.8) {
    notes.push({
      level: "CORRECT",
      what: "wordsAddedToDoc is inflated by roughly the pre-loaded document",
      why: `added=${added} vs typed=${typed}`,
      fix: `subtract ~${PRELOADED_WORDS}, or use typedWords`,
    });
  }

  // The quota 403: the Docs sync died mid-session and the count froze.
  if (typed > 20 && added === 0) {
    notes.push({
      level: "DROP FIELD",
      what: "the participant typed but no words were credited",
      why: `typed=${typed}, added=0 — the Docs sync never succeeded or froze`,
      fix: "use typedWords for this session; wordsAddedToDoc is unusable",
    });
  }
  if (whole === 0 && typed > 0) {
    notes.push({
      level: "DROP FIELD",
      what: "the Docs API never reported a document",
      why: "wholeDocWords=0 — not connected for the whole session",
      fix: "use typedWords; note it in the data log",
    });
  }

  // A test run must never reach the dataset.
  if (x.distractions?.testMode || x.calibration?.testMode) {
    notes.push({
      level: "EXCLUDE",
      what: "this session is stamped testMode",
      why: "short schedule or test-length calibration",
      fix: "not participant data — remove it",
    });
  }

  if (!x.calibration || x.calibration.valid === false) {
    notes.push({
      level: "NOTE",
      what: "no valid calibration profile",
      why: "the session ran on default thresholds",
      fix: "record it — this session cannot join the calibrated-vs-default comparison",
    });
  }

  return {
    file,
    participant: x.participantId ?? "(none)",
    condition: x.condition ?? "(none)",
    added, typed, whole,
    notes,
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("usage: node analysis/check-export.mjs <export.json> [more.json ...]");
  process.exit(1);
}

let problems = 0;
for (const f of files) {
  const r = check(f);
  console.log(`
${r.file}`);
  if (r.fatal) { console.log(`  ERROR  ${r.fatal}`); problems++; continue; }
  console.log(`  ${r.participant} / ${r.condition}   added=${r.added}  typed=${r.typed}  wholeDoc=${r.whole}`);
  if (r.notes.length === 0) { console.log("  OK — nothing to correct"); continue; }
  for (const n of r.notes) {
    problems++;
    console.log(`  ${n.level}  ${n.what}`);
    console.log(`         because: ${n.why}`);
    console.log(`         do this: ${n.fix}`);
  }
}
console.log(`
${files.length} file(s), ${problems} thing(s) to act on
`);
