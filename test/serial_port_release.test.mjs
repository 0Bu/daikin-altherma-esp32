// Port leases and forgetting a port's permission, which the installer's Disconnect uses.
import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireSerialPortLease,
  forgetSerialPort,
  releaseFeedback,
  releaseSerialPortLease,
  serialPortIsOpen,
  serialPortLease,
  supportsSerialForget
} from "../docs/serial-port-release.mjs";

class ForgetCapablePort {
  forget() {}
}

function closedGrant(name) {
  return { name, readable: null, writable: null, forgotten: 0, async forget() { this.forgotten++; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function drainPermissionTasks() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

test("serial forget support requires permission discovery, the chooser and forget API", () => {
  const serial = { getPorts() {}, requestPort() {} };
  assert.equal(supportsSerialForget(serial, ForgetCapablePort), true);
  assert.equal(supportsSerialForget({ requestPort() {} }, ForgetCapablePort), false);
  assert.equal(supportsSerialForget({ getPorts() {} }, ForgetCapablePort), false);
  assert.equal(supportsSerialForget(serial, class {}), false);
  assert.equal(supportsSerialForget(serial, undefined), false);
});

test("a port counts as open while either stream exists", () => {
  assert.equal(serialPortIsOpen(closedGrant("A")), false);
  assert.equal(serialPortIsOpen({ readable: {}, writable: null }), true);
  assert.equal(serialPortIsOpen({ readable: null, writable: {} }), true);
  assert.equal(serialPortIsOpen(null), false);
});

test("an open, unpaired or busy port is never forgotten", async () => {
  const open = { ...closedGrant("open"), readable: {} };
  await assert.rejects(forgetSerialPort({ async getPorts() { return [open]; } }, open), { name: "InvalidStateError" });
  assert.equal(open.forgotten, 0);
  const stranger = closedGrant("stranger");
  await assert.rejects(forgetSerialPort({ async getPorts() { return []; } }, stranger), { name: "NotFoundError" });
  assert.equal(stranger.forgotten, 0);
  const busy = closedGrant("busy");
  const lease = acquireSerialPortLease(busy, "monitor");
  await assert.rejects(forgetSerialPort({ async getPorts() { return [busy]; } }, busy), { name: "InvalidStateError" });
  releaseSerialPortLease(lease);
  const blocked = closedGrant("blocked");
  await assert.rejects(forgetSerialPort({ async getPorts() { return [blocked]; } }, blocked,
    { controller: { isReleaseBlocked: () => true } }), { name: "InvalidStateError" });
  assert.equal(blocked.forgotten, 0);
  assert.equal(serialPortLease(blocked), undefined, "a refused release leaves no lease");
  await assert.rejects(forgetSerialPort({ async getPorts() { return []; } }, { readable: null, writable: null }),
    { name: "NotSupportedError" });
});

test("release owns the native port before the grant query and prevents reentrant claims", async () => {
  const port = closedGrant("A");
  const grants = deferred();
  const entered = deferred();
  const serial = { getPorts() { entered.resolve(); return grants.promise; } };
  const releasing = forgetSerialPort(serial, port);
  await entered.promise;
  assert.equal(serialPortLease(port).kind, "release");
  assert.throws(() => acquireSerialPortLease(port, "probe"), { name: "InvalidStateError" });
  await assert.rejects(forgetSerialPort(serial, port), { name: "InvalidStateError" });
  grants.resolve([port]);
  assert.equal(await releasing, port);
  assert.equal(port.forgotten, 1);
  assert.equal(serialPortLease(port), undefined);
});

test("a timed-out grant query keeps its lease until true settlement and never forgets late", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const port = closedGrant("A");
  const grants = deferred();
  const entered = deferred();
  const serial = { getPorts() { entered.resolve(); return grants.promise; } };
  const foreground = assert.rejects(forgetSerialPort(serial, port), { name: "SerialPermissionTimeoutError" });
  await entered.promise;
  t.mock.timers.tick(10000);
  await foreground;
  assert.equal(serialPortLease(port).kind, "release", "the native query is still pending");
  await assert.rejects(forgetSerialPort(serial, port), { name: "InvalidStateError" });
  grants.resolve([port]);
  await drainPermissionTasks();
  assert.equal(serialPortLease(port), undefined);
  assert.equal(port.forgotten, 0, "late grants cannot resume an expired release");
});

test("a forget timeout keeps native ownership until forget settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const port = closedGrant("A");
  const forgetting = deferred();
  const entered = deferred();
  port.forget = async () => { port.forgotten++; entered.resolve(); await forgetting.promise; };
  const serial = { async getPorts() { return [port]; } };
  const foreground = assert.rejects(forgetSerialPort(serial, port),
    (error) => error.name === "SerialPermissionTimeoutError" && /Removing.*timed out.*no release is confirmed/.test(error.message));
  await entered.promise;
  t.mock.timers.tick(10000);
  await foreground;
  assert.equal(serialPortLease(port).kind, "release");
  forgetting.resolve();
  await drainPermissionTasks();
  assert.equal(serialPortLease(port), undefined);
  assert.equal(port.forgotten, 1);
});

test("release feedback treats an unpaired port as information and everything else as an error", () => {
  const notFound = new Error("gone");
  notFound.name = "NotFoundError";
  assert.deepEqual(releaseFeedback(notFound), { kind: "info", message: "port not paired" });
  assert.deepEqual(releaseFeedback(new Error("boom")), { kind: "error", message: "boom" });
  assert.deepEqual(releaseFeedback(undefined), { kind: "error", message: "unknown error" });
});
