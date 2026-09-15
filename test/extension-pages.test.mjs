// Static checks on the extension's own HTML pages.
//
// Chrome runs extension pages under a Content Security Policy of
// script-src 'self', which blocks inline <script> blocks and inline event
// handlers outright. A page that breaks this still loads — it just does
// nothing, with a CSP error in the console. The memory game shipped that way
// once and drew no cards. The development server does not enforce the policy,
// so neither the build nor a preview catches it; this test does.

import fs from "node:fs";
import path from "node:path";

const PUBLIC = new URL("../public/", import.meta.url);

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
}

const pages = htmlFiles(PUBLIC.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
console.log("\nExtension pages obey the Content Security Policy");
check("found the extension pages", pages.length >= 2, `found ${pages.length}`);

for (const file of pages) {
  const html = fs.readFileSync(file, "utf8");
  const rel = path.relative(PUBLIC.pathname.replace(/^\/([A-Za-z]:)/, "$1"), file);

  // Every <script> tag must load an external file.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const inline = scripts.filter(([, attrs, body]) => !/\bsrc\s*=/.test(attrs) || body.trim() !== "");
  check(`${rel}: no inline <script>`, inline.length === 0,
        inline.length ? `${inline.length} inline script(s) — move the code to a .js file` : "");

  // Inline event handlers (onclick="…") are blocked by the same policy.
  const handlers = html.match(/\son[a-z]+\s*=\s*["']/gi) ?? [];
  check(`${rel}: no inline event handlers`, handlers.length === 0,
        handlers.length ? `found ${handlers.join(", ")}` : "");

  // A referenced script must actually exist, or the page loads blank.
  for (const [, attrs] of scripts) {
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src || /^https?:/.test(src)) continue;
    const target = path.join(path.dirname(file), src);
    check(`${rel}: ${src} exists`, fs.existsSync(target));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
