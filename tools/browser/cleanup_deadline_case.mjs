// Isolate test-clock and body-reader observation from the concurrently imported infrastructure
// suites. Network traffic, AbortController, child ownership and cleanup remain real.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchBrowser } from "./cdp_browser.mjs";
import { inspectProcess as processState } from "./process_state.mjs";

const flags = process.argv.slice(2);
assert.ok(flags.length <= 1 && flags.every(flag =>
  ["--expire-before-endpoint", "--suppress-body-witness", "--suppress-stall-witness"].includes(flag)),
  "unknown cleanup deadline control");
const mode = process.env.DAIKIN_BROWSER_STALL_MODE;
assert.ok(["list-headers", "list-body", "socket", "version-headers", "version-body"].includes(mode));
const marker = process.env.DAIKIN_BROWSER_STALL_MARKER;
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const realFetch = globalThis.fetch, realRemove = fs.rmSync;
const pause = ms => new Promise(resolve => realSetTimeout(resolve, ms));
const readRecord = () => fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : null;
const deadlines = [], bodies = new Set(), actualBodies = new Set(), removals = [];
let completion, pending, error, cleanupVerified = false, deadlineRejected = false, armed = false;
let firedAt;
const fire = () => {
  const deadline = deadlines[0];
  assert.ok(deadline && !deadline.fired && !deadline.cancelled, "single launch timer must remain armed");
  deadline.fired = true;
  firedAt = Date.now();
  deadline.callback(...deadline.args);
};
async function until(check, label, requirePending = true) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (requirePending)
      assert.ok(!completion, `${label}; launch completed before the intended stall: ${completion?.error?.message}`);
    assert.ok(Date.now() < end, label);
    await pause(10);
  }
}
async function completedWithinBudget() {
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = realSetTimeout(() => reject(new Error("launch cleanup exceeded its 2500 ms bound")), 2500);
    })]);
  } finally { realClearTimeout(timer); }
}
try {
  fs.rmSync = (target, options) => {
    const record = readRecord();
    if (record && target === record.profile) removals.push(processState(record.pid).present);
    return realRemove(target, options);
  };
  globalThis.fetch = async (...args) => {
    const response = await realFetch(...args), record = readRecord();
    const url = new URL(response.url);
    if (record && url.hostname === "127.0.0.1" && url.port === String(record.port) &&
        ["/json/list", "/json/version"].includes(url.pathname)) {
      const json = response.json.bind(response);
      response.json = (...jsonArgs) => {
        actualBodies.add(url.pathname);
        if (!flags.includes("--suppress-body-witness")) bodies.add(url.pathname);
        return json(...jsonArgs);
      };
    }
    return response;
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    const handle = realSetTimeout(() => {}, 2147483647);
    realClearTimeout(handle);
    deadlines.push({ callback, delay, args, handle, fired: false, cancelled: false });
    return handle;
  };
  globalThis.clearTimeout = handle => {
    const deadline = deadlines.find(item => item.handle === handle);
    if (deadline && !deadline.fired) deadline.cancelled = true;
    return realClearTimeout(handle);
  };
  try {
    // Only the synchronous timer-registration window is intercepted; all subsequent scheduling
    // and cleanup timers use the real clock. The callback is the production abort callback.
    pending = launchBrowser({ timeoutMs: 600 }).then(
      browser => (completion = { browser }), failure => (completion = { error: failure }));
  } finally { globalThis.setTimeout = realSetTimeout; }
  assert.equal(deadlines.length, 1, "launch must register exactly one absolute deadline");
  assert.equal(deadlines[0].delay, 600, "the captured launch deadline must stay 600 ms");
  if (flags.includes("--expire-before-endpoint")) {
    await until(() => !!readRecord()?.port, "early-expiry control must own a ready held endpoint");
    const record = readRecord();
    assert.equal(processState(record.pid).present, true);
    assert.equal(fs.existsSync(record.profile), true);
    assert.equal(record.stallReached, null, "held endpoint must not have reached a later stall");
    fire();
  }
  await until(() => {
    const record = readRecord();
    if (!record || flags.includes("--suppress-stall-witness") || record.stallReached !== mode) return false;
    if (mode.startsWith("version-") &&
        !["Page.enable", "Runtime.enable", "Log.enable", "Accessibility.enable"].every(method =>
          record.enabled.includes(method))) return false;
    return !mode.endsWith("-body") || bodies.has(mode === "list-body" ? "/json/list" : "/json/version");
  }, `${mode}: fixture must reach its intended ${mode.endsWith("-body") ? "body-reader" : "endpoint"} stall before arming deadline`);
  armed = true;
  assert.ok(!completion, "stalled launch must remain pending before deadline firing");
  fire();
} catch (failure) { error = failure; }
finally {
  try {
    if (deadlines[0] && !deadlines[0].fired && !deadlines[0].cancelled) fire();
    if (completion?.browser) await completion.browser.close();
    const result = await completedWithinBudget();
    deadlineRejected = /Chrome launch deadline exceeded/.test(result.error?.message || "");
    assert.ok(deadlineRejected, "stalled launch must reject with its exact deadline error");
    if (firedAt) assert.ok(Date.now() - firedAt < 2500, "deadline cleanup must remain bounded");
    const record = readRecord();
    assert.ok(record && record.parentPid === process.pid, "fixture must retain its actual owned child");
    assert.equal(processState(record.pid).present, false, "deadline cleanup must reap the browser child");
    assert.equal(fs.existsSync(record.profile), false, "deadline cleanup must remove its profile");
    assert.ok(removals.length && removals.every(active => !active), "profile removal must follow actual child exit");
    cleanupVerified = true;
  } catch (cleanupError) { error = error ? new AggregateError([error, cleanupError], "cleanup deadline case failed") : cleanupError; }
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  globalThis.fetch = realFetch;
  fs.rmSync = realRemove;
  if (!cleanupVerified) {
    const record = readRecord();
    if (record) {
      const state = processState(record.pid);
      if (state.present) {
        assert.equal(state.parent, process.pid, "repair cleanup must only kill its own child");
        process.kill(record.pid, "SIGKILL");
        await until(() => !processState(record.pid).present, "owned failed fixture must exit", false);
      }
      assert.equal(path.dirname(record.profile), os.tmpdir());
      assert.match(path.basename(record.profile), /^daikin-browser-gate-[A-Za-z0-9]+$/);
      realRemove(record.profile, { recursive: true, force: true });
    }
  }
}
const finalRecord = readRecord();
console.log("DEADLINE_CASE:" + JSON.stringify({ mode, armed, cleanupVerified, deadlineRejected,
  timers: deadlines.length, delay: deadlines[0]?.delay, deadlineFired: deadlines[0]?.fired,
  cancelledBeforeFiring: deadlines[0]?.cancelled, bodyRead: [...actualBodies],
  actualStall: finalRecord?.stallReached, endpointReady: !!finalRecord?.port,
  enabled: finalRecord?.enabled, failed: !!error }));
if (error) { console.error(error); process.exitCode = 1; }
