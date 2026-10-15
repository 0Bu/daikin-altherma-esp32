import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = ["app_state", "dashboard", "settings"].map((name) =>
  fs.readFileSync(new URL(`../main/www/js/${name}.js`, import.meta.url), "utf8")).join("\n");
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness(compact) {
  const events = [], requests = [], controls = [{ disabled: false, dataset: {} }];
  let finish;
  const completion = new Promise((resolve) => { finish = resolve; });
  const context = vm.createContext({
    $: () => ({ querySelectorAll: () => controls }), events,
    pollSignal: () => "bounded-probe-signal", t: (key) => key,
    j: async (url, options) => {
      requests.push({ url, options });
      if (url === "/status") throw new Error("503");
      if (compact instanceof Error) throw compact;
      return compact;
    },
    location: { reload: () => events.push("reload") },
  });
  vm.runInContext(source + `
    renderApp = () => events.push("paint");
    sysSet = (mode) => events.push(mode);
    otaInline = () => {};
    otaAlert = () => {};
    otaWatch = (generation) => { events.push("watch:" + generation); return completion; };
    otaPoll = (_states, _tries, _tick, generation) => { events.push("check:" + generation); return completion; };
    otaWaitReboot = () => events.push("wait-reboot");
    this.ui = { S, resumeOta, refreshStatus };
  `, context);
  context.completion = completion;
  context.ui.S.status = { version: "same" };
  return { ...context.ui, events, requests, controls, finish };
}

// External manifest checking also owns the write lock; normal check completion releases it without
// pretending that this observer accepted an install or waiting for a reboot that will never occur.
for (const compact of [{ state: "checking", busy: true, generation: 45 },
  { state: "idle", busy: true, generation: 46 }]) {
  const h = harness(compact);
  await h.refreshStatus(false); await settle();
  assert.equal(h.S.otaBusy, true);
  assert.equal(h.S.otaInstalling, false);
  assert.equal(h.controls[0].disabled, true);
  assert.ok(h.events.includes("check:" + compact.generation));
  h.finish({ state: "idle", busy: false, generation: compact.generation }); await settle();
  assert.equal(h.S.otaBusy, false); assert.equal(h.S.busy, false);
  assert.equal(h.controls[0].disabled, false);
  assert.equal(h.events.includes("wait-reboot"), false);
}

// A previously idle tab must discover another client's install when /status begins returning 503.
// The compact request is bounded, its exact generation owns one watcher, and writes lock at once.
for (const compact of [
  { state: "updating", generation: 41, progress: 37, current: "same" },
  { state: "done", generation: 42, current: "same" },
]) {
  const endpoint = { state: "idle", generation: 4 };
  const h = harness(endpoint);
  await h.resumeOta();
  assert.equal(h.S.otaBusy, false);
  Object.assign(endpoint, compact);
  h.requests.length = 0;
  assert.equal(await h.refreshStatus(false), false);
  await settle();
  assert.equal(h.S.otaBusy, true);
  assert.equal(h.S.otaInstalling, true);
  assert.equal(h.controls[0].disabled, true);
  const probe = h.requests.find((request) => request.url === "/ota/status");
  assert.equal(probe.options.signal, "bounded-probe-signal");
  assert.equal(h.events.includes("sys.unreachable"), false);
  await h.refreshStatus(false); await settle();
  assert.equal(h.requests.filter((request) => request.url === "/ota/status").length, 1,
    "repeated refused full status must not start duplicate compact probes/watchers");
  if (compact.state === "updating") {
    assert.deepEqual(h.events.filter((event) => event.startsWith("watch:")), ["watch:41"]);
    h.finish({ state: "done", generation: 41 }); await settle();
  }
  assert.equal(h.events.filter((event) => event === "wait-reboot").length, 1);
}

// Invalid compact state supplies no OTA lease. The answered full-status 503 still proves a busy
// HTTP service, even if the compact probe subsequently fails; it cannot prove an install.
for (const compact of [new Error("offline"), { state: "updating", generation: null },
  { state: "idle", generation: 4 }]) {
  const h = harness(compact);
  await h.refreshStatus(false); await settle();
  assert.equal(h.S.otaBusy, false);
  assert.equal(h.events.includes("sys.unreachable"), false);
  assert.ok(h.events.includes("sys.nodata"));
  assert.equal(h.S.transportBusy, true);
  assert.equal(h.events.some((event) => event.startsWith("watch:")), false);
}
console.log("UI compact OTA adoption: bounded second-tab discovery, generation, write lock and failure truth pass");

// Keep the actual otaPoll/otaWatch loops here. Busy stays true throughout the firmware's update
// and reboot handoff, including the inherited state visible before the worker starts.
function realPollHarness() {
  const events = [], timers = [], controls = [{ disabled: false, dataset: {} }];
  let compact;
  const context = vm.createContext({
    $: () => ({ querySelectorAll: () => controls }), events,
    t: (key, value) => key === "ota.pct" ? `progress:${value}` : key,
    j: async () => ({ ...compact }),
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {},
  });
  vm.runInContext(source + `
    renderApp = () => {};
    sysSet = () => {};
    otaInline = (text) => events.push(text);
    otaAlert = (text) => events.push("alert:" + text);
    otaWaitReboot = () => events.push("wait-reboot");
    const originalWatch = otaWatch;
    otaWatch = (generation) => { events.push("watch:" + generation); return originalWatch(generation); };
    this.ui = { S, resumeOta, otaPoll };
  `, context);
  context.ui.S.status = { version: "same" };
  return {
    ...context.ui, events, controls,
    async tick(value) {
      compact = value;
      await settle();
      assert.ok(timers.length, "the production loop must have scheduled its next bounded poll");
      timers.shift()();
      await settle();
    },
  };
}

for (const inherited of ["idle", "checking", "error"]) {
  const h = realPollHarness();
  const state = (state, extra = {}) => ({ state, generation: 70, busy: true, current: "same", ...extra });
  const observing = h.resumeOta(state(inherited));
  await settle();
  for (const old of ["idle", "error"]) {
    await h.tick(state(old));
    assert.equal(h.S.otaBusy, true);
    assert.equal(h.S.otaInstalling, false, "busy inherited state does not prove worker startup");
    assert.equal(h.events.some((event) => event.startsWith("alert:")), false);
    assert.equal(h.events.includes("wait-reboot"), false);
  }
  await h.tick(state("updating", { progress: 27 }));
  assert.equal(h.S.otaInstalling, true, "same-generation busy update must join the real download watcher");
  assert.equal(h.controls[0].disabled, true);
  assert.ok(h.events.includes("progress:27"));
  await h.resumeOta(state("updating", { progress: 27 }));
  assert.deepEqual(h.events.filter((event) => event.startsWith("watch:")), ["watch:70"]);
  await h.tick(state("updating", { progress: 65 }));
  assert.ok(h.events.includes("progress:65"));
  await h.tick(state("done", { progress: 100 }));
  await observing;
  assert.equal(h.events.filter((event) => event === "wait-reboot").length, 1);
  assert.equal(h.S.otaBusy, true, "writes remain locked through the reboot handoff");
}

// The initiating check still requires authoritative release. Observer transition permission must
// not make an inherited updating/done payload accept an unfinished local manifest check.
{
  const h = realPollHarness();
  let released = false;
  const checking = h.otaPoll(["checking"], 3, null, 80, true).then((result) => {
    released = true; return result;
  });
  for (const state of ["updating", "done"]) {
    await h.tick({ state, generation: 80, busy: true });
    assert.equal(released, false);
  }
  await h.tick({ state: "idle", generation: 80, busy: false });
  assert.equal((await checking).state, "idle");
}
console.log("UI OTA observer real-loop transitions and initiating-check release contract pass");
