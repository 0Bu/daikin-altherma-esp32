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

let explicitDrains = 0, autoRefreshes = 0;
sandbox.refreshValues = async () => false;
sandbox.pumpHistoryQueue = () => explicitDrains++;
sandbox.recoverOpenHistory = () => autoRefreshes++;
await runPendingTick("values endpoint refused a live read");
assert.equal(explicitDrains, 1, "a failed values poll releases explicitly queued reads");
assert.equal(autoRefreshes, 0, "a failed values poll does not schedule background history");

const errors = [];
sandbox.console = { error: (...args) => errors.push(args) };
sandbox.refreshValues = async () => { throw new Error("render failed"); };
await runPendingTick("render threw during a live update");
assert.equal(timers.length, 1, "a failed render still schedules the next poll");
assert.equal(errors.length, 1, "a failed render is reported");
assert.equal(explicitDrains, 2, "a failed render still releases the history queue");

// Boot overlaps locale loading with the initial /status + /values fetches, skips resumeOta()
// when no OTA render snapshot is cached, and delays the first renderApp() until static i18n
// and event wiring complete.
{
  const runBootCase = async ({ cached }) => {
    const bootTimers = [];
    let bootTimerId = 1;
    let resolveLocale;
    const localePending = new Promise((resolve) => { resolveLocale = resolve; });
    const order = [];
    let resumeCalls = 0;
    const bootContext = {
      S: { hpProbeBusy: false },
      LANG: "de",
      OTA_RENDER_CACHE_KEY: "daikinOtaRenderV1",
      otaCacheStorage: () => (cached ? { getItem: (key) => (key === "daikinOtaRenderV1" ? "{}" : null) } : null),
      document: { hidden: false, addEventListener() {} },
      performance: { now: () => 0 },
      setTimeout(fn, ms) { bootTimers.push({ id: bootTimerId, fn, ms }); return bootTimerId++; },
      clearTimeout(id) {
        const at = bootTimers.findIndex((timer) => timer.id === id);
        if (at >= 0) bootTimers.splice(at, 1);
      },
      async refreshStatus(paint) {
        order.push(`refreshStatus(${paint})`);
        return true;
      },
      async refreshValues(paint) {
        order.push(`refreshValues(${paint})`);
        return true;
      },
      renderApp() { order.push("renderApp"); },
      loadLocale(lang) { order.push(`loadLocale(${lang})`); return localePending; },
      applyStaticI18n() { order.push("applyStaticI18n"); },
      labelSchematicHits() { order.push("labelSchematicHits"); },
      wire() {},
      initNavigation() { order.push("initNavigation"); },
      resumeOta() { resumeCalls++; order.push("resumeOta"); },
    };
    bootContext.window = bootContext;
    bootContext.globalThis = bootContext;

    const bootSandbox = vm.createContext(bootContext);
    vm.runInContext(source, bootSandbox, { filename: "main/www/js/bootstrap.js" });
    bootSandbox.wire = () => { order.push("wire"); };

    assert.equal(bootTimers.length, 1,
      "boot() must schedule pollStart() before awaiting loadLocale()");
    assert.deepEqual(order, ["loadLocale(de)"]);

    const initialTick = bootTimers.shift().fn();
    await flush();
    assert.deepEqual(order, ["loadLocale(de)", "refreshStatus(false)", "refreshValues(false)"],
      "initial /status and /values must start while loadLocale() is pending without painting yet");

    resolveLocale(true);
    await initialTick;
    const expectedTail = cached
      ? ["applyStaticI18n", "labelSchematicHits", "wire", "initNavigation", "resumeOta", "renderApp"]
      : ["applyStaticI18n", "labelSchematicHits", "wire", "initNavigation", "renderApp"];
    assert.deepEqual(order, [
      "loadLocale(de)",
      "refreshStatus(false)",
      "refreshValues(false)",
      ...expectedTail,
    ], "renderApp() must wait until loadLocale(), applyStaticI18n(), and wire() finish");
    assert.equal(resumeCalls, cached ? 1 : 0,
      cached ? "cached OTA snapshot at boot must call resumeOta()" : "idle boot must skip resumeOta()");
  };

  await runBootCase({ cached: false });
  await runBootCase({ cached: true });
}

// Locale script URL appends &v=<tag> only when LOCALE_ASSET_TAG is non-empty,
// and failed loads clear LOCALE_LOADS so subsequent retries can succeed.
{
  const i18nSource = readAppFragments(["i18n.js"]);
  for (const [tag, expected] of [
    ["", "/locale.js?lang=de"],
    ["a1b2c3d4", "/locale.js?lang=de&v=a1b2c3d4"],
  ]) {
    const scripts = [];
    let attempt = 0;
    const mutated = tag
      ? i18nSource.replace('const LOCALE_ASSET_TAG = "";', `const LOCALE_ASSET_TAG = "${tag}";`)
      : i18nSource;
    assert.ok(mutated.includes(`const LOCALE_ASSET_TAG = "${tag}";`),
      "i18n.js must expose the literal LOCALE_ASSET_TAG placeholder");
    const i18nCtx = vm.createContext({
      navigator: { language: "en" },
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout, clearTimeout,
      document: {
        getElementById: () => null,
        createElement: () => ({ remove() {} }),
        head: {
          appendChild(script) {
            attempt++;
            scripts.push(script.src);
            if (attempt === 1) {
              script.onerror();
            } else {
              i18nCtx.localeReady = (lang) => lang === "de";
              script.onload();
            }
          },
        },
      },
    });
    vm.runInContext(`${mutated}\nthis.__loadLocale = loadLocale;`,
      i18nCtx, { filename: "main/www/js/i18n.js" });
    assert.equal(await i18nCtx.__loadLocale("de"), false);
    assert.equal(await i18nCtx.__loadLocale("de"), true,
      "a transient /locale.js failure must clear LOCALE_LOADS so later attempts retry");
    assert.deepEqual(scripts, [expected, expected]);
  }
}

// A failing initial /status during boot must wait for _bootReady before invalidateLiveReadings()
// or markUnreachable() repaints in English.
{
  const stateSource = readAppFragments(["app_state.js"]);
  const bootOrder = [];
  let resolveBoot;
  const bootGate = new Promise((resolve) => { resolveBoot = resolve; });
  const errCtx = vm.createContext({
    _bootReady: bootGate,
    S: { status: null, histEpoch: 0 },
    pollSignal: () => undefined,
    historyClock: () => 0,
    j: async () => { throw new Error("503"); },
    probeRunningOta: async () => { bootOrder.push("probeRunningOta"); return false; },
    renderApp: () => { bootOrder.push("renderApp"); },
    sysSet: (mode) => { bootOrder.push(`sysSet:${mode}`); },
    t: (k) => k,
    markCheckupDhwStale: () => {},
    expireLiveHistoryPins: () => {},
  });
  vm.runInContext(`${stateSource}\nthis.__readStatusFrame = readStatusFrame;\nthis.__S = S;`, errCtx,
    { filename: "main/www/js/app_state.js" });
  errCtx.renderApp = () => { bootOrder.push("renderApp"); };
  errCtx.sysSet = (mode) => { bootOrder.push(`sysSet:${mode}`); };
  const pendingRead = errCtx.__readStatusFrame(false);
  await flush();
  assert.equal(errCtx.__S.transportUnavailable, "status");
  assert.deepEqual(bootOrder, ["probeRunningOta"],
    "initial /status failure must wait on _bootReady before calling renderApp() or sysSet()");
  errCtx._bootReady = null;
  resolveBoot();
  assert.equal(await pendingRead, false);
  await flush();
  assert.deepEqual(bootOrder, ["probeRunningOta", "renderApp", "sysSet:sys.nodata"]);
}

console.log("UI poll cadence: forced status refresh and queued history after a failed live poll pass");
