// Tests the Google Docs connection in public/background.js.
//
// The bug this exists for: chrome.identity.getAuthToken returns Chrome's CACHED
// token even when interactive is true. So when a grant expires or is revoked,
// pressing Connect handed back the same dead token, reported success, and the
// "Google Docs not connected" banner never cleared. Reconnecting has to clear
// the cache first.

import vm from "node:vm";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../public/background.js", import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function makeBackground({ cachedToken = null, freshToken = "fresh-token", docStatus = 200, signInFails = false, errorBody = null } = {}) {
  const stored = { ff_task: { participantId: "P01", tabId: 101, sessionStartTime: Date.now() } };
  const calls = { interactive: [], removed: [], fetched: [] };
  let cached = cachedToken;

  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: {
      id: "test", lastError: null,
      onInstalled: { addListener() {} }, onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve(), getURL: (p) => `chrome-extension://test/${p}`,
    },
    identity: {
      getAuthToken: ({ interactive }, cb) => {
        calls.interactive.push(interactive);
        if (cached) return cb(cached);          // Chrome hands back the cache
        if (!interactive) { chrome.runtime.lastError = { message: "not signed in" }; cb(undefined); chrome.runtime.lastError = null; return; }
        if (signInFails) { chrome.runtime.lastError = { message: "user cancelled" }; cb(undefined); chrome.runtime.lastError = null; return; }
        cached = freshToken;                     // a real consent prompt
        cb(freshToken);
      },
      removeCachedAuthToken: ({ token }, cb) => { calls.removed.push(token); if (cached === token) cached = null; cb(); },
    },
    storage: {
      local: {
        get: (keys, cb) => { const o = {}; for (const k of [].concat(keys)) if (k in stored) o[k] = stored[k]; if (cb) cb(o); return Promise.resolve(o); },
        set: (obj, cb) => { Object.assign(stored, obj); if (cb) cb(); return Promise.resolve(); },
        remove: (keys, cb) => { for (const k of [].concat(keys)) delete stored[k]; if (cb) cb(); return Promise.resolve(); },
      },
      onChanged: { addListener() {} },
    },
    alarms: { create() {}, clear: () => Promise.resolve(true), onAlarm: { addListener() {} } },
    tabs: {
      get: (id) => (id === 101 ? Promise.resolve({ id: 101, windowId: 1, url: "https://docs.google.com/document/d/abc/edit" }) : Promise.reject(new Error("no tab"))),
      create: () => Promise.resolve({ id: 500 }), remove: () => Promise.resolve(),
      onActivated: { addListener() {} }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
  };

  const fetchStub = (url, opts) => {
    calls.fetched.push(opts?.headers?.Authorization);
    const status = typeof docStatus === "function" ? docStatus(opts?.headers?.Authorization) : docStatus;
    return Promise.resolve({
      ok: status === 200, status,
      json: () => Promise.resolve(
        status !== 200 && errorBody
          ? errorBody
          : { body: { content: [{ paragraph: { elements: [{ textRun: { content: "one two three" } }] } }] } },
      ),
    });
  };

  const ctx = { chrome, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Promise, structuredClone, setTimeout, fetch: fetchStub };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, stored, calls };
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`); }
}

// ── 1. reconnecting clears a dead token ────────────────────────────────────
console.log("\n1. Reconnect after the sign-in expired");
{
  // Chrome holds a token the server has already rejected.
  const { ctx, stored, calls } = makeBackground({
    cachedToken: "dead-token",
    docStatus: (auth) => (auth.includes("dead-token") ? 401 : 200),
  });
  const result = await ctx.ensureDocsAuth(true);
  await settle();
  check("the dead token was cleared", calls.removed.includes("dead-token"), true);
  check("reconnect succeeded", result.ok, true);
  check("status recorded as connected", stored.ff_docs_status.ok, true);
}

// ── 2. without the clearing step it would fail ─────────────────────────────
console.log("\n2. The same case, not forced");
{
  const { ctx } = makeBackground({
    cachedToken: "dead-token",
    docStatus: (auth) => (auth.includes("dead-token") ? 401 : 200),
  });
  // force:false is the old behaviour — ask again and get the same dead token.
  const result = await ctx.ensureDocsAuth(false);
  await settle();
  check("still fails, which is why Connect forces", result.ok, false);
}

// ── 3. a token is not proof of access ──────────────────────────────────────
console.log("\n3. Signed in, but the document is not readable");
{
  // 404: the document belongs to a different Google account than the one
  // Chrome is signed in as — common on a shared study machine.
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 404 });
  const result = await ctx.ensureDocsAuth(true);
  await settle();
  check("not reported as connected", result.ok, false);
  check("and the reason names the cause", /different Google account|not found/.test(stored.ff_docs_status.reason), true);
}

// ── 4. refusing the sign-in is reported, not swallowed ─────────────────────
console.log("\n4. Consent dismissed");
{
  const { ctx, stored } = makeBackground({ cachedToken: null, signInFails: true });
  const result = await ctx.ensureDocsAuth(true);
  await settle();
  check("reported as failed", result.ok, false);
  check("with the reason", /sign-in failed/.test(result.reason), true);
  check("and recorded for the banner", stored.ff_docs_status.ok, false);
}

// ── 5. failures during a session are diagnosed, not silent ─────────────────
console.log("\n5. A failing word-count sync says why");
{
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 403 });
  const text = await ctx.getTaskDocText();
  await settle();
  check("no text returned", text, null);
  check("reason recorded", /Docs API disabled|access refused/.test(stored.ff_docs_status.reason), true);
}

// ── 6. a working session reports connected ─────────────────────────────────
console.log("\n6. Normal case");
{
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 200 });
  const text = await ctx.getTaskDocText();
  await settle();
  check("document read", text.trim(), "one two three");
  check("status is connected", stored.ff_docs_status.ok, true);
}

// -- 7. Google's own explanation of a 403 reaches the banner ---------------
// "access refused" has several causes with different fixes. Google names the
// cause in the error body; the panel is no use to the group unless it says so.
console.log("\n7. A 403 says which 403 it is");
{
  const disabled = {
    error: {
      code: 403, status: "PERMISSION_DENIED",
      message: "Google Docs API has not been used in project 600200227791 before or it is disabled.",
      details: [{ reason: "SERVICE_DISABLED" }],
    },
  };
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 403, errorBody: disabled });
  await ctx.getTaskDocText();
  await settle();
  check("names the disabled API, not just access-refused",
    /not enabled for this extension's Cloud project/.test(stored.ff_docs_status.reason), true);
}

// -- 8. a too-narrow grant is distinguished from a disabled API -------------
console.log("\n8. Insufficient scope");
{
  const narrow = {
    error: {
      code: 403, status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes.",
      details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
    },
  };
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 403, errorBody: narrow });
  await ctx.getTaskDocText();
  await settle();
  check("names the missing permission",
    /did not grant permission to read documents/.test(stored.ff_docs_status.reason), true);
}

// -- 9. an unparseable body still reports the plain reason -----------------
// This runs while another failure is being reported. It must never throw.
console.log("\n9. Error body missing or unreadable");
{
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 403, errorBody: { nonsense: true } });
  await ctx.getTaskDocText();
  await settle();
  check("falls back to the plain reason", /access refused/.test(stored.ff_docs_status.reason), true);
}

// -- 10. a rate limit does not become a 'not connected' banner -------------
// Google answers an exceeded quota with 403 as often as 429, and it clears by
// itself. Reporting it as a broken connection sends the group off disabling and
// re-enabling a Cloud API that was never the problem.
console.log("\n10. Rate limiting is transient, not a broken connection");
{
  const limited = {
    error: {
      code: 403, status: "PERMISSION_DENIED", message: "Quota exceeded.",
      details: [{ reason: "RATE_LIMIT_EXCEEDED" }],
    },
  };
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 200 });
  await ctx.getTaskDocText();
  await settle();
  check("connected to begin with", stored.ff_docs_status.ok, true);

  // the same session now hits the quota
  const limitedCtx = makeBackground({ cachedToken: "good-token", docStatus: 403, errorBody: limited });
  await limitedCtx.ctx.getTaskDocText();
  await settle();
  check("the failure is flagged transient", limitedCtx.ctx.docsFailureWasTransient(), true);
  check("and the connection status is left alone", limitedCtx.stored.ff_docs_status, undefined);
}

// -- 11. a real refusal is still recorded ----------------------------------
console.log("\n11. A genuine refusal is not mistaken for a rate limit");
{
  const { ctx, stored } = makeBackground({ cachedToken: "good-token", docStatus: 403 });
  await ctx.getTaskDocText();
  await settle();
  check("not transient", ctx.docsFailureWasTransient(), false);
  check("and recorded as not connected", stored.ff_docs_status.ok, false);
}

// -- 12. the recovery prompt reads the essay, not the sources --------------
// The session document arrives holding the task prompt and three source
// passages (~2,900 chars). A plain tail-slice of a barely-started essay is
// therefore mostly source material, and the summary would quote Source A back
// at the writer as "where you left off" - actively misleading them at the exact
// moment the study is measuring their recovery. Read the real template so that
// editing it and breaking the divider fails here.
console.log("\n12. Only the participant text reaches the prompt");
{
  const md = fs.readFileSync(new URL("../study-materials/session-document-template.md", import.meta.url), "utf8");
  const preloaded = md.split("```")[1].replace("[leave empty]", "").trim();
  const { ctx } = makeBackground({ cachedToken: "good-token" });

  check("the template still carries the divider the code looks for",
    preloaded.includes(ctx.ESSAY_DIVIDER ?? "WRITE YOUR ESSAY BELOW THIS LINE"), true);

  // Minute 10: the first distraction, with one sentence written.
  const started = preloaded + "\n\nI believe universities should keep final exams, because";
  const essay = ctx.essayTextOnly(started);
  check("returns only what they wrote", essay, "I believe universities should keep final exams, because");
  check("no source text leaks in", /Final examinations|Examinations have|SOURCE [ABC]/.test(essay), false);

  // Nothing written yet: better to estimate from timing than to quote a source.
  check("an untouched document yields nothing", ctx.essayTextOnly(preloaded), null);

  // The old behaviour, for contrast: a tail-slice of the same document.
  check("a plain tail-slice would have been mostly sources",
    /Final examinations|Examinations have/.test(started.slice(-2000)), true);

  // A participant may delete the divider; a degraded excerpt beats no summary.
  const noDivider = "Exams should stay. My first reason is fairness.";
  check("falls back when the divider is gone", ctx.essayTextOnly(noDivider), noDivider);
  check("and null stays null", ctx.essayTextOnly(null), null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
