// Regression for the poll chain's /status cadence across a tab that is left and re-entered.
//
// pollNow() exists to make ONE promise: coming back to the tab does not leave yesterday's numbers
// sitting there looking current. It keeps that promise by setting _statusDue = 0, so the next tick
// fetches /status instead of waiting out the 8-second cycle.
//
// pollTick() reads performance.now() BEFORE its await and writes `_statusDue = now + POLL_STATUS_MS`
// after it. A visibilitychange landing in that window — the tab left and re-entered while a /status
// request was still in flight — therefore had its reset overwritten by a tick that had already
// decided what the next due instant was. Nothing looked wrong: /values kept refreshing on its own
// 2-second cadence, so the dashboard's numbers moved while the STATUS frame (connection state,
// MQTT/X10A liveness, OTA state, the crash banner) stayed up to 8 seconds stale. The failure is by
// ABSENCE, which is the shape DESIGN.md §5.3 forbids.
//
// Executes the production pollTick/pollNow/pollStart out of bootstrap.js rather than asserting on
// source text: the subject is an interleaving, and only running it can show the tick and the
// visibility handler in the order that produced the defect.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["bootstrap.js"]);

const flush = () => new Promise((resolve) => setImmediate(resolve));

// One controllable timer wheel. pollSchedule() clears before it sets, so "exactly one timer
// standing" is itself part of the contract under test and is asserted on every drive.
const timers = [];
let nextTimerId = 1;
let visibilityHandler = null;
let statusRequests = 0;
let releaseFirstStatus = null;

const context = {
  S: { hpProbeBusy: false },
  LANG: "en",
  document: {
    hidden: false,
    addEventListener(type, handler) { if (type === "visibilitychange") visibilityHandler = handler; },
  },
  // Frozen clock: the defect does not need time to pass. A tick that wrongly advances _statusDue
  // pushes it to POLL_STATUS_MS, which at t=0 is simply "not due", so the next tick skips /status.
  performance: { now: () => 0 },
  setTimeout(fn, ms) { timers.push({ id: nextTimerId, fn, ms }); return nextTimerId++; },
  clearTimeout(id) {
    const at = timers.findIndex((timer) => timer.id === id);
    if (at >= 0) timers.splice(at, 1);
  },
  // The first /status is held open; every later one answers at once.
  async refreshStatus() {
    statusRequests++;
    if (statusRequests > 1) return true;
    return new Promise((resolve) => { releaseFirstStatus = resolve; });
  },
  async refreshValues() { return true; },
  renderApp() {},
  // boot() runs on load, exactly as it does on the device. Everything it reaches before pollStart()
  // is out of scope here and is stubbed to the shape pollStart() needs.
  async loadLocale() { return true; },
  applyStaticI18n() {}, labelSchematicHits() {}, wire() {}, initNavigation() {}, resumeOta() {},
};
context.window = context;
context.globalThis = context;

const sandbox = vm.createContext(context);
vm.runInContext(source, sandbox, { filename: "main/www/js/bootstrap.js" });
// boot() is suspended on its first await when runInContext returns, so the DOM wiring it does next
// can still be replaced. wire() is the one boot() callee DECLARED in this fragment, so its function
// declaration shadows a context stub; every other callee resolves to the stubs above. Replacing it
// here keeps this test to the poll chain instead of dragging in the whole modal surface.
sandbox.wire = () => {};

function runPendingTick(why) {
  assert.equal(timers.length, 1, `the chain must leave exactly one timer standing (${why})`);
  return timers.shift().fn();
}

await flush();   // boot() -> pollStart() -> pollNow() schedules the first tick
assert.ok(visibilityHandler, "pollStart() must subscribe to visibilitychange");

const firstTick = runPendingTick("first tick scheduled by pollStart");
await flush();
assert.equal(statusRequests, 1, "the first tick fetches /status");

// The tab is left and re-entered while that request is still open. This is the production handler,
// called the way the browser calls it.
visibilityHandler();
assert.equal(statusRequests, 1, "returning to the tab must not open a second concurrent /status");

await runPendingTick("tick scheduled by the visibilitychange pollNow()");
assert.equal(statusRequests, 1, "a tick finding one in flight reschedules instead of requesting");

releaseFirstStatus(true);
await firstTick;

await runPendingTick("tick scheduled after the in-flight tick completed");
assert.equal(statusRequests, 2,
  "the /status refresh that returning to the tab forces must survive the tick that was in flight");

// The steady state is unchanged: with no visibilitychange in the window, the cadence still holds
// /status back to POLL_STATUS_MS while /values keeps its own faster tick.
await runPendingTick("steady-state tick");
assert.equal(statusRequests, 2,
  "without a pollNow() the status cadence must still throttle /status to POLL_STATUS_MS");

console.log("UI poll cadence: a forced /status survives a tick that was already awaiting a response");
