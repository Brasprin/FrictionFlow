// Tests the scheduled distraction task in public/background.js.
//
// Checking this by hand means waiting ten minutes per distraction, so it is the
// part most in need of automation. background.js is loaded into a vm with a
// fake chrome API — storage, alarms and tabs — and driven through a session:
// scheduling, delivery, deferral, the return to the document, and clean-up.

import vm from "node:vm";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../public/background.js", import.meta.url), "utf8");
let clock = 1_700_000_000_000;
const advance = (ms) => { clock += ms; };
const FakeDate = new Proxy(Date, { get: (t, p) => (p === "now" ? () => clock : Reflect.get(t, p)) });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function makeBackground() {
  const stored = {};
  const listeners = { storage: [], alarm: [], activated: [], removed: [] };
  const alarms = new Map();
  const created = [];
  const removedTabs = [];
  const tabs = new Map([[101, { id: 101, windowId: 7, url: "https://docs.google.com/document/d/abc/edit" }]]);
  let nextTabId = 500;

  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  function fireStorage(changes) {
    for (const fn of listeners.storage) fn(changes, "local");
  }

  const local = {
    get(keys, cb) {
      const out = {};
      for (const k of [].concat(keys)) if (k in stored) out[k] = clone(stored[k]);
      if (cb) cb(out);
      return Promise.resolve(out);
    },
    set(obj, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(stored[k]), newValue: clone(v) };
        stored[k] = clone(v);
      }
      fireStorage(changes);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in stored) { changes[k] = { oldValue: clone(stored[k]), newValue: undefined }; delete stored[k]; }
      }
      if (Object.keys(changes).length) fireStorage(changes);
      if (cb) cb();
      return Promise.resolve();
    },
  };

  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: {
      id: "test",
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve(),
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    storage: { local, onChanged: { addListener: (fn) => listeners.storage.push(fn) } },
    alarms: {
      create: (name, info) => { alarms.set(name, info.when); },
      clear: (name) => { alarms.delete(name); return Promise.resolve(true); },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    tabs: {
      get: (id) => (tabs.has(id) ? Promise.resolve(tabs.get(id)) : Promise.reject(new Error("no tab"))),
      create: (opts) => {
        const tab = { id: nextTabId++, windowId: opts.windowId, url: opts.url };
        tabs.set(tab.id, tab);
        created.push(opts);
        return Promise.resolve(tab);
      },
      remove: (id) => {
        removedTabs.push(id);
        tabs.delete(id);
        for (const fn of listeners.removed) fn(id);
        return Promise.resolve();
      },
      onActivated: { addListener: (fn) => listeners.activated.push(fn) },
      onRemoved: { addListener: (fn) => listeners.removed.push(fn) },
      onUpdated: { addListener() {} },
    },
    identity: { getAuthToken() {}, removeCachedAuthToken() {} },
  };

  const ctx = { chrome, console: { log() {}, warn() {}, error() {} }, Date: FakeDate, Math, JSON, Promise, structuredClone, setTimeout, fetch: () => Promise.reject(new Error("no network")) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);

  return {
    stored, alarms, created, removedTabs, local,
    fireAlarm: (name) => { for (const fn of listeners.alarm) fn({ name }); },
    activate: (tabId) => { for (const fn of listeners.activated) fn({ tabId }); },
    closeTab: (tabId) => chrome.tabs.remove(tabId),
  };
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`); }
}

// The session started 10 minutes before the clock, so distraction 1 is due now.
const START = clock - 10 * 60000;
const task = (over = {}) => ({ participantId: "P01", condition: "intervention", sessionStartTime: START, tabId: 101, ...over });

// ── 1. starting a session schedules three distractions ─────────────────────
console.log("\n1. Scheduling");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  check("three alarms created", [...bg.alarms.keys()].sort(), ["ff_distraction_1", "ff_distraction_2", "ff_distraction_3"]);
  check("minute 10", bg.alarms.get("ff_distraction_1"), START + 10 * 60000);
  check("minute 25", bg.alarms.get("ff_distraction_2"), START + 25 * 60000);
  check("minute 40", bg.alarms.get("ff_distraction_3"), START + 40 * 60000);
}

// ── 2. a resume must not reschedule ────────────────────────────────────────
console.log("\n2. Resume keeps the original schedule");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  const before = [...bg.alarms.entries()];
  // Resume adopts a new tab but keeps the same session start.
  await bg.local.set({ ff_task: task({ tabId: 202 }) });
  await settle(); // scheduling reads the settings first
  check("alarm times unchanged", [...bg.alarms.entries()], before);
}

// ── 3. delivery ────────────────────────────────────────────────────────────
console.log("\n3. Delivering a distraction");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_1");
  await settle();
  check("one game tab opened", bg.created.length, 1);
  check("the game, set A, episode 1, 3 minutes",
        bg.created[0].url, "chrome-extension://test/distraction/memory.html?set=A&episode=1&seconds=180");
  check("in the same window as the document", bg.created[0].windowId, 7);
  check("brought to the front", bg.created[0].active, true);
  check("marked in progress", bg.stored.ff_distraction.active, true);
  check("recorded", bg.stored.ff_distractions.map((d) => d.episode), [1]);
  check("on time, so no deferral", bg.stored.ff_distractions[0].deferredMs, 0);
}

// ── 4. everyone plays the same set ─────────────────────────────────────────
// One session per participant, so every participant gets set A. A leftover
// sessionNumber from an older build must not be able to change that.
console.log("\n4. Everyone plays set A");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task({ sessionNumber: 2 }) });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_2");
  await settle();
  check("set A even with a stale session number", bg.created[0].url, "chrome-extension://test/distraction/memory.html?set=A&episode=2&seconds=180");
}

// ── 5. condition-blind ─────────────────────────────────────────────────────
console.log("\n5. Identical in both conditions");
{
  const run = async (condition) => {
    const bg = makeBackground();
    await bg.local.set({ ff_task: task({ condition }) });
    await settle(); // scheduling reads the settings first
    bg.fireAlarm("ff_distraction_1");
    await settle();
    return { alarms: [...bg.alarms.entries()], url: bg.created[0]?.url };
  };
  check("baseline and intervention get the same distraction", await run("baseline"), await run("intervention"));
}

// ── 6. deferral ────────────────────────────────────────────────────────────
console.log("\n6. Deferred, never skipped");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task(), ff_session: { isOnBreak: true } });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_1");
  await settle();
  check("no game opened during a break", bg.created.length, 0);
  check("retried 30 s later", bg.alarms.get("ff_distraction_1") - clock, 30000);

  advance(30000);
  await bg.local.set({ ff_session: { isOnBreak: false } });
  bg.fireAlarm("ff_distraction_1");
  await settle();
  check("delivered once the break ends", bg.created.length, 1);
  check("the 30 s delay is recorded exactly", bg.stored.ff_distractions[0].deferredMs, 30000);
  advance(-30000); // restore, so later scenarios start on time
}
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task(), ff_interrupted: { at: Date.now() } });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_1");
  await settle();
  check("no game opened while the session is interrupted", bg.created.length, 0);
}

// ── 7. the return to the document ──────────────────────────────────────────
console.log("\n7. Returning to the document");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_1");
  await settle();
  const gameTab = bg.stored.ff_distraction.gameTabId;

  bg.activate(999);             // some unrelated tab
  await settle();
  check("another tab is not a return", bg.stored.ff_distraction.active, true);

  bg.activate(101);             // the document
  await settle();
  check("return recorded", typeof bg.stored.ff_distraction.returnedAt, "number");
  check("no longer in progress", bg.stored.ff_distraction.active, false);
  check("the game tab is closed", bg.removedTabs.includes(gameTab), true);
  check("the history carries the return", typeof bg.stored.ff_distractions[0].returnedAt, "number");
}

// ── 8. closing the game early ──────────────────────────────────────────────
console.log("\n8. Closing the game early");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_1");
  await settle();
  const gameTab = bg.stored.ff_distraction.gameTabId;
  bg.closeTab(gameTab);
  bg.activate(101);             // Chrome activates the neighbouring tab
  await settle();
  const rec = bg.stored.ff_distractions[0];
  check("closure recorded", typeof rec.gameClosedAt, "number");
  check("return still recorded", typeof rec.returnedAt, "number");
  check("both writes survived (no clobbering)", rec.gameClosedAt !== null && rec.returnedAt !== null, true);
}

// ── 9. a second distraction cannot open over the first ─────────────────────
console.log("\n9. One distraction at a time");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  bg.fireAlarm("ff_distraction_1");
  await settle();
  bg.fireAlarm("ff_distraction_2");
  await settle();
  check("second is deferred while the first is open", bg.created.length, 1);
}

// ── 10. finishing the session cancels what is left ────────────────────────
console.log("\n10. Session end");
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle(); // scheduling reads the settings first
  await bg.local.remove("ff_task");
  check("all alarms cleared", bg.alarms.size, 0);

  bg.fireAlarm("ff_distraction_3"); // a stray alarm after the end
  await settle();
  check("nothing opens after the session ended", bg.created.length, 0);
}

// ── 11. the short test schedule ────────────────────────────────────────────
console.log("\n11. Short schedule for testing");
{
  const bg = makeBackground();
  await bg.local.set({ ff_settings: { shortDistractions: true } });
  await bg.local.set({ ff_task: task() });
  await settle();
  check("minute 1", bg.alarms.get("ff_distraction_1"), START + 1 * 60000);
  check("minute 3", bg.alarms.get("ff_distraction_2"), START + 3 * 60000);
  check("minute 5", bg.alarms.get("ff_distraction_3"), START + 5 * 60000);
  check("plan stamped as a test run", bg.stored.ff_distraction_plan.testMode, true);

  bg.fireAlarm("ff_distraction_1");
  await settle();
  // 70 s, not 20: a distraction is only detected after 60 s off the tab, so a
  // shorter game could never show the held reminder.
  check("70-second game, longer than the 60 s detection threshold",
        bg.created[0].url, "chrome-extension://test/distraction/memory.html?set=A&episode=1&seconds=70");
  check("the record is stamped as a test run", bg.stored.ff_distractions[0].testMode, true);
}
{
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle();
  bg.fireAlarm("ff_distraction_1");
  await settle();
  check("a normal session is not a test run", bg.stored.ff_distractions[0].testMode, false);
  check("and uses the 3-minute exposure", bg.created[0].url.endsWith("seconds=180"), true);
}
{
  // Switching the option on mid-session must not change a running session.
  const bg = makeBackground();
  await bg.local.set({ ff_task: task() });
  await settle();
  await bg.local.set({ ff_settings: { shortDistractions: true } });
  bg.fireAlarm("ff_distraction_1");
  await settle();
  check("toggling mid-session does not turn it into a test run", bg.stored.ff_distractions[0].testMode, false);
  check("the session keeps its real exposure", bg.created[0].url.endsWith("seconds=180"), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
