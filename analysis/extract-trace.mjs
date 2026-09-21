// Writes the <session>_trace.csv that the panel should have downloaded.
//
//   node analysis/extract-trace.mjs P01_baseline_2026-09-16.json [more.json ...]
//
// The trace ships inside the export JSON as well as in its own CSV. Chrome
// often blocks the second and third automatic download from one click, so the
// CSV can be missing while the data itself is perfectly intact. This recovers
// it, rather than losing the session's only re-classifiable record.

import fs from "node:fs";
import path from "node:path";

const NEEDS_QUOTING = /["',\r\n]/;

const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return NEEDS_QUOTING.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("usage: node analysis/extract-trace.mjs <export.json> [more.json ...]");
  process.exit(1);
}

for (const file of files) {
  const x = JSON.parse(fs.readFileSync(file, "utf8"));
  const trace = x.decisionTrace;
  if (!trace || !trace.columns || !trace.columns.length || !trace.rows || !trace.rows.length) {
    console.log(file + ": no trace in this export - nothing to write");
    continue;
  }
  const out = path.join(path.dirname(file), path.basename(file).replace(/\.json$/i, "_trace.csv"));
  const csv = [
    ["participantId", "condition"].concat(trace.columns).map(cell).join(","),
    ...trace.rows.map((r) => [x.participantId ?? "", x.condition ?? ""].concat(r).map(cell).join(",")),
  ].join("\r\n") + "\r\n";
  fs.writeFileSync(out, csv);
  const mins = Math.round((trace.rows[trace.rows.length - 1][0] ?? 0) / 60000);
  console.log(out + "  -  " + trace.rows.length + " ticks (~" + mins + " min)" + (trace.truncated ? "  TRUNCATED" : ""));
}
