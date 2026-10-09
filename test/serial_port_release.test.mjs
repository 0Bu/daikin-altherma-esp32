import assert from "node:assert/strict";
import test from "node:test";

import {
  attachSerialPortRelease,
  acquireSerialPortLease,
  grantedSerialPorts,
  releaseFeedback,
  releaseSelectedSerialPort,
  releaseSerialPortLease,
  supportsSerialForget
} from "../docs/serial-port-release.mjs";

class ForgetCapablePort {
  forget() {}
}

function fakeButton() {
  return {
    disabled: false,
    attributes: new Map(),
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); }
  };
}

test("serial forget support requires permission discovery, the chooser and forget API", () => {
  const serial = { getPorts() {}, requestPort() {} };
  assert.equal(supportsSerialForget(serial, ForgetCapablePort), true);
  assert.equal(supportsSerialForget({ requestPort() {} }, ForgetCapablePort), false);
  assert.equal(supportsSerialForget({ getPorts() {} }, ForgetCapablePort), false);
  assert.equal(supportsSerialForget(serial, class {}), false);
});

test("granted serial ports are normalized to an array", async () => {
  const port = {};
  assert.deepEqual(await grantedSerialPorts({ async getPorts() { return [port]; } }), [port]);
  assert.deepEqual(await grantedSerialPorts({ async getPorts() { return new Set([port]); } }), [port]);
});

test("no chooser opens when this site has no granted port", async () => {
  let chooserOpened = false;
  const serial = {
    async getPorts() { return []; },
    async requestPort() { chooserOpened = true; }
  };

  await assert.rejects(releaseSelectedSerialPort(serial), { name: "NotFoundError" });
  assert.equal(chooserOpened, false);
});

test("a single granted closed port is released without opening the chooser", async () => {
  const calls = [];
  const port = {
    readable: null,
    writable: null,
    async forget() { calls.push("forget"); }
  };
  const serial = {
    async getPorts() {
      calls.push("get");
      return [port];
    },
    async requestPort() { calls.push("request"); }
  };

  assert.equal(await releaseSelectedSerialPort(serial), port);
  assert.deepEqual(calls, ["get", "get", "forget"]);
});

test("the chooser disambiguates multiple previously granted ports", async () => {
  const calls = [];
  const first = { readable: null, writable: null, async forget() { calls.push("first"); } };
  const second = { readable: null, writable: null, async forget() { calls.push("second"); } };
  const serial = {
    async getPorts() { return [first, second]; },
    async requestPort() {
      calls.push("request");
      return second;
    }
  };

  await releaseSelectedSerialPort(serial);
  assert.deepEqual(calls, ["request", "second"]);
});

test("an open port is not interrupted or released", async () => {
  let forgotten = false;
  const port = {
    readable: {},
    writable: {},
    async forget() { forgotten = true; }
  };
  const serial = {
    async getPorts() { return [port]; },
    async requestPort() { return port; }
  };

  await assert.rejects(releaseSelectedSerialPort(serial), { name: "InvalidStateError" });
  assert.equal(forgotten, false);
});

test("cancelling the chooser is reported without an error state", () => {
  assert.deepEqual(releaseFeedback({ name: "NotFoundError" }), {
    kind: "info",
    message: "No port released."
  });
});

test("the UI stays hidden when this site has no granted port", async () => {
  const container = { hidden: false };
  const button = fakeButton();
  const status = { hidden: true, dataset: {}, textContent: "" };
  const serial = {
    async getPorts() { return []; },
    async requestPort() { throw new Error("chooser must not open"); }
  };

  assert.equal(await attachSerialPortRelease({
    serial,
    SerialPortCtor: ForgetCapablePort,
    container,
    button,
    status,
    refreshTarget: null
  }), true);
  assert.equal(container.hidden, true);
});

test("the UI refreshes when a granted device connects or disconnects", async () => {
  let ports = [];
  const serialListeners = new Map();
  const pageListeners = new Map();
  const container = { hidden: false };
  const button = fakeButton();
  const status = { hidden: true, dataset: {}, textContent: "" };
  const port = { readable: null, writable: null, async forget() {} };
  const serial = {
    async getPorts() { return ports; },
    async requestPort() { return port; },
    addEventListener(name, handler) { serialListeners.set(name, handler); }
  };
  const refreshTarget = {
    addEventListener(name, handler) { pageListeners.set(name, handler); }
  };

  await attachSerialPortRelease({
    serial,
    SerialPortCtor: ForgetCapablePort,
    container,
    button,
    status,
    refreshTarget
  });
  assert.equal(container.hidden, true);

  ports = [port];
  await serialListeners.get("connect")();
  assert.equal(container.hidden, false);

  ports = [];
  await serialListeners.get("disconnect")();
  assert.equal(container.hidden, true);

  ports = [port];
  await pageListeners.get("focus")();
  assert.equal(container.hidden, false);
});

test("the UI appears for a granted port and disappears after releasing it", async () => {
  let granted = true;
  let releasedCallback = false;
  const port = {
    readable: null,
    writable: null,
    async forget() { granted = false; }
  };
  const container = { hidden: true };
  const button = fakeButton();
  const status = { hidden: true, dataset: {}, textContent: "" };
  const serial = {
    async getPorts() { return granted ? [port] : []; },
    async requestPort() { return port; }
  };

  assert.equal(await attachSerialPortRelease({
    serial,
    SerialPortCtor: ForgetCapablePort,
    container,
    button,
    status,
    refreshTarget: null,
    async onReleased() { releasedCallback = true; }
  }), true);
  assert.equal(container.hidden, false);

  await button.listeners.get("click")();
  assert.equal(granted, false);
  assert.equal(releasedCallback, true);
  assert.equal(container.hidden, true);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.has("aria-busy"), false);
  assert.equal(status.dataset.kind, "success");
  assert.match(status.textContent, /no longer paired/);
});

test("the UI stays available when another granted port remains", async () => {
  let grantedPorts;
  const first = {
    readable: null,
    writable: null,
    async forget() { grantedPorts = [second]; }
  };
  const second = { readable: null, writable: null, async forget() {} };
  grantedPorts = [first, second];
  const container = { hidden: true };
  const button = fakeButton();
  const status = { hidden: true, dataset: {}, textContent: "" };
  const serial = {
    async getPorts() { return grantedPorts; },
    async requestPort() { return first; }
  };

  await attachSerialPortRelease({
    serial,
    SerialPortCtor: ForgetCapablePort,
    container,
    button,
    status,
    refreshTarget: null
  });
  await button.listeners.get("click")();

  assert.deepEqual(grantedPorts, [second]);
  assert.equal(container.hidden, false);
});

function deferredRelease() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function closedGrant(name) {
  return { name, readable: null, writable: null, forgotten: 0, async forget() { this.forgotten++; } };
}

test("an unknown chooser port is rejected even if the chooser just granted it", async () => {
  const a = closedGrant("A");
  const b = closedGrant("B");
  const c = closedGrant("C");
  let ports = [a, b];
  const serial = {
    async getPorts() { return ports; },
    async requestPort() { ports = [a, b, c]; return c; }
  };
  await assert.rejects(releaseSelectedSerialPort(serial), (error) =>
    error.name === "PermissionMismatchError" && /not already permitted/.test(error.message));
  assert.equal(c.forgotten, 0);
  assert.deepEqual(ports, [a, b, c], "a newly granted permission must not be silently undone or called released");
});

test("a chooser port must still be granted and closed at the leased final check", async () => {
  for (const changed of ["revoked", "opened"]) {
    const a = closedGrant("A");
    const b = closedGrant("B");
    let queries = 0;
    const serial = {
      async getPorts() {
        if (++queries === 1) return [a, b];
        if (changed === "opened") { b.readable = {}; return [a, b]; }
        return [a];
      },
      async requestPort() { return b; }
    };
    await assert.rejects(releaseSelectedSerialPort(serial), {
      name: changed === "revoked" ? "PermissionMismatchError" : "InvalidStateError"
    });
    assert.equal(b.forgotten, 0);
  }
});

test("a closed port with unresolved ownership cannot be forgotten", async (t) => {
  const port = closedGrant("A");
  const lease = acquireSerialPortLease(port, "probe");
  t.after(() => releaseSerialPortLease(lease));
  const serial = { async getPorts() { return [port]; }, async requestPort() { return port; } };
  await assert.rejects(releaseSelectedSerialPort(serial), { name: "InvalidStateError" });
  assert.equal(port.forgotten, 0);
});

test("the selected idle closed grant is preferred over the multi-port chooser", async () => {
  const a = closedGrant("A");
  const b = closedGrant("B");
  const serial = {
    async getPorts() { return [a, b]; },
    async requestPort() { throw new Error("the chooser must not open for selected idle B"); }
  };
  const controller = { getSelectedPort: () => b, isReleaseBlocked: () => false };
  assert.equal(await releaseSelectedSerialPort(serial, { controller }), b);
  assert.equal(a.forgotten, 0);
  assert.equal(b.forgotten, 1);
});

test("release owns the native port before the fresh grant query and prevents reentrant claims", async () => {
  const port = closedGrant("A");
  const fresh = deferredRelease();
  const freshEntered = deferredRelease();
  let queries = 0;
  const serial = {
    getPorts() {
      if (++queries === 1) return Promise.resolve([port]);
      freshEntered.resolve();
      return fresh.promise;
    },
    async requestPort() { return port; }
  };
  const releasing = releaseSelectedSerialPort(serial);
  await freshEntered.promise;
  assert.throws(() => acquireSerialPortLease(port, "monitor"), { name: "InvalidStateError" });
  await assert.rejects(releaseSelectedSerialPort(serial), { name: "InvalidStateError" });
  fresh.resolve([port]);
  assert.equal(await releasing, port);
  assert.equal(port.forgotten, 1);
});

test("double clicks keep one release in flight and deliver the exact forgotten port", async () => {
  const port = closedGrant("A");
  const forgetting = deferredRelease();
  const forgetEntered = deferredRelease();
  let granted = true;
  port.forget = async () => {
    port.forgotten++;
    forgetEntered.resolve();
    await forgetting.promise;
    granted = false;
  };
  const serial = { async getPorts() { return granted ? [port] : []; }, async requestPort() { return port; } };
  const button = fakeButton();
  const container = { hidden: true };
  const status = { hidden: true, dataset: {}, textContent: "" };
  let released;
  await attachSerialPortRelease({
    serial, SerialPortCtor: ForgetCapablePort, container, button, status, refreshTarget: null,
    onReleased: (value) => { released = value; }
  });
  const first = button.listeners.get("click")();
  await forgetEntered.promise;
  await button.listeners.get("click")();
  assert.equal(button.disabled, true);
  assert.equal(button.attributes.get("aria-busy"), "true");
  assert.equal(port.forgotten, 1);
  forgetting.resolve();
  await first;
  assert.equal(released, port);
  assert.equal(button.attributes.has("aria-busy"), false);
  assert.equal(status.dataset.kind, "success");
});

test("an older focus refresh cannot overwrite the latest grant visibility", async () => {
  const port = closedGrant("A");
  const older = deferredRelease();
  const latest = deferredRelease();
  let queries = 0;
  const serial = {
    getPorts() {
      queries++;
      return queries === 1 ? Promise.resolve([port]) : queries === 2 ? older.promise : latest.promise;
    },
    async requestPort() { return port; }
  };
  const listeners = new Map();
  const container = { hidden: true };
  await attachSerialPortRelease({
    serial, SerialPortCtor: ForgetCapablePort, container, button: fakeButton(),
    status: { hidden: true, dataset: {}, textContent: "" },
    refreshTarget: { addEventListener(name, handler) { listeners.set(name, handler); } }
  });
  const oldRefresh = listeners.get("focus")();
  const newRefresh = listeners.get("focus")();
  latest.resolve([port]);
  await newRefresh;
  older.resolve([]);
  await oldRefresh;
  assert.equal(container.hidden, false);
});
