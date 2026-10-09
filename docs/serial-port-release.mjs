const portLeases = new WeakMap();
const releaseRequests = new WeakMap();
const ownershipListeners = new Set();
const SERIAL_PERMISSION_TIMEOUT_MS = 10000;

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function notifyOwnership() {
  for (const listener of ownershipListeners) {
    try { listener(); } catch (_error) {}
  }
}

export function subscribeSerialOwnership(listener) {
  ownershipListeners.add(listener);
  return () => ownershipListeners.delete(listener);
}

export function serialPortLease(port) {
  return port && portLeases.get(port);
}

export function acquireSerialPortLease(port, kind) {
  if (!port || serialPortLease(port)) {
    throw namedError("InvalidStateError", "This serial port is still owned by an operation or unresolved cleanup. Wait for confirmed closure; if cleanup failed, reconnect the device and reload the page.");
  }
  const lease = { port, kind, phase: kind };
  portLeases.set(port, lease);
  notifyOwnership();
  return lease;
}

export function updateSerialPortLease(lease, phase) {
  if (serialPortLease(lease.port) === lease) {
    lease.phase = phase;
    notifyOwnership();
  }
}

export function releaseSerialPortLease(lease) {
  if (serialPortLease(lease.port) === lease) {
    portLeases.delete(lease.port);
    notifyOwnership();
  }
}

export function serialPortIsOpen(port) {
  return Boolean(port && (port.readable != null || port.writable != null));
}

export function supportsSerialForget(serial, SerialPortCtor) {
  return Boolean(serial && typeof serial.getPorts === "function" &&
    typeof serial.requestPort === "function" && SerialPortCtor &&
    typeof SerialPortCtor.prototype?.forget === "function");
}

export async function grantedSerialPorts(serial) {
  let timer;
  const native = Promise.resolve().then(() => serial.getPorts());
  try {
    const ports = await Promise.race([native, new Promise((_, reject) => {
      timer = setTimeout(() => reject(namedError("SerialPermissionTimeoutError",
        "Reading serial-port permissions timed out. The browser has not confirmed the current permissions.")), SERIAL_PERMISSION_TIMEOUT_MS);
    })]);
    return Array.isArray(ports) ? ports : Array.from(ports || []);
  } finally { clearTimeout(timer); }
}

async function awaitNativeReleaseStep(request, call, description) {
  let timer;
  const native = Promise.resolve().then(call);
  timer = setTimeout(() => {
    request.failure = namedError("SerialPermissionTimeoutError",
      `${description} timed out. The native browser operation is still pending; no release is confirmed. Wait for it to settle before trying again.`);
    request.rejectForeground(request.failure);
    notifyOwnership();
  }, SERIAL_PERMISSION_TIMEOUT_MS);
  let result;
  try { result = await native; }
  finally { clearTimeout(timer); }
  if (request.failure) throw request.failure;
  return result;
}

async function nativeReleaseGrants(serial, request) {
  const ports = await awaitNativeReleaseStep(request, () => serial.getPorts(), "Reading serial-port permissions");
  return Array.isArray(ports) ? ports : Array.from(ports || []);
}

function checkReleaseAllowed(controller) {
  if (controller?.isReleaseBlocked()) {
    throw namedError("InvalidStateError", "Wait for the installer or reset operation and its cleanup to finish before releasing any serial port.");
  }
}

// The chooser may grant a new port. Forget only a port that was already in the initial grant set,
// still appears in a fresh grant set and is closed under our shared native-port lease.
export async function releaseSelectedSerialPort(serial, { controller = null } = {}) {
  if (releaseRequests.has(serial)) throw namedError("InvalidStateError", "A serial-port release is already in progress.");
  checkReleaseAllowed(controller);
  const request = {};
  const expired = new Promise((_, reject) => { request.rejectForeground = reject; });
  expired.catch(() => {});
  releaseRequests.set(serial, request);
  notifyOwnership();
  let lease;
  // This task keeps awaiting the real native promises after the foreground deadline. Its finally
  // owns the request and port lease; the raced caller cannot free them or start a second release.
  const actual = (async () => {
    try {
      const granted = await nativeReleaseGrants(serial, request);
      checkReleaseAllowed(controller);
      if (!granted.length) throw namedError("NotFoundError", "This site has no serial-port permission to remove.");
      const port = granted.length === 1 ? granted[0] : await serial.requestPort();
      checkReleaseAllowed(controller);
      if (!granted.includes(port)) {
        throw namedError("PermissionMismatchError", "The selected port was not already permitted. No permission was removed.");
      }
      if (typeof port?.forget !== "function") throw namedError("NotSupportedError", "This browser cannot forget serial ports.");
      lease = acquireSerialPortLease(port, "release");
      const fresh = await nativeReleaseGrants(serial, request);
      checkReleaseAllowed(controller);
      if (!fresh.includes(port)) {
        throw namedError("PermissionMismatchError", "The selected port is no longer permitted. No permission was removed.");
      }
      if (serialPortIsOpen(port)) throw namedError("InvalidStateError", "The serial port is still open. Stop its monitor or installer first.");
      await awaitNativeReleaseStep(request, () => port.forget(), "Removing the serial-port permission");
      return port;
    } finally {
      if (lease) releaseSerialPortLease(lease);
      if (releaseRequests.get(serial) === request) releaseRequests.delete(serial);
      notifyOwnership();
    }
  })();
  actual.catch(() => {});
  return Promise.race([actual, expired]);
}

export function releaseFeedback(error) {
  switch (error && error.name) {
    case "NotFoundError": return { kind: "info", message: "No port released." };
    case "InvalidStateError": return { kind: "error", message: error.message || "Wait for serial operations and confirmed port closure before releasing the port." };
    case "PermissionMismatchError": return { kind: "error", message: error.message };
    case "SerialPermissionTimeoutError": return { kind: "error", message: error.message };
    case "NotSupportedError": return { kind: "error", message: "This browser cannot remove serial-port permissions." };
    default: return { kind: "error", message: "Could not release the serial port. Close other serial applications and try again." };
  }
}

export async function attachSerialPortRelease({
  serial, SerialPortCtor, container, button, status,
  refreshTarget = globalThis, onReleased = null, controller = null
}) {
  if (!container || !button || !status) throw new Error("Serial port release controls are incomplete.");
  if (!supportsSerialForget(serial, SerialPortCtor)) {
    container.hidden = true;
    return false;
  }
  let refreshing = 0;
  let busy = false;
  let grants = [];
  const updateControls = () => {
    const pending = busy || releaseRequests.has(serial);
    button.disabled = pending || Boolean(controller?.isReleaseBlocked()) ||
      (grants.length > 0 && grants.every((port) => serialPortLease(port) || serialPortIsOpen(port)));
    if (pending) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  };
  const refreshVisibility = async () => {
    const generation = ++refreshing;
    try {
      const ports = await grantedSerialPorts(serial);
      if (generation !== refreshing) return { visible: !container.hidden };
      grants = ports;
      container.hidden = !grants.length;
    } catch (error) {
      if (generation !== refreshing) return { visible: !container.hidden };
      // Keep the last known grants; an unavailable query cannot prove the site has no permission.
      container.hidden = false;
      updateControls();
      return { visible: true, error };
    }
    updateControls();
    return { visible: !container.hidden };
  };
  const reportRefreshError = (error, released = false) => {
    status.hidden = false;
    status.dataset.kind = "error";
    status.textContent = released
      ? `Serial port was released, but the remaining permissions could not be refreshed: ${error.message}`
      : `Serial-port permissions could not be refreshed: ${error.message}`;
  };
  const scheduleRefresh = async () => {
    const result = await refreshVisibility();
    if (result.error && !busy && !releaseRequests.has(serial)) reportRefreshError(result.error);
  };
  if (typeof serial.addEventListener === "function") {
    serial.addEventListener("connect", scheduleRefresh);
    serial.addEventListener("disconnect", scheduleRefresh);
  }
  if (typeof refreshTarget?.addEventListener === "function") {
    refreshTarget.addEventListener("focus", scheduleRefresh);
    refreshTarget.addEventListener("pageshow", scheduleRefresh);
  }
  subscribeSerialOwnership(updateControls);
  controller?.subscribeOwnership(updateControls);
  container.hidden = true;
  button.addEventListener("click", async () => {
    if (busy || releaseRequests.has(serial)) return;
    busy = true;
    let released = false;
    updateControls();
    status.hidden = false;
    status.dataset.kind = "info";
    status.textContent = "Releasing serial port…";
    try {
      const port = await releaseSelectedSerialPort(serial, { controller });
      released = true;
      if (typeof onReleased === "function") await onReleased(port);
      status.dataset.kind = "success";
      status.textContent = "Serial port released — it is no longer paired with this site.";
    } catch (error) {
      const feedback = releaseFeedback(error);
      status.dataset.kind = feedback.kind;
      status.textContent = feedback.message;
    } finally {
      const refreshed = await refreshVisibility();
      if (refreshed.error && released) reportRefreshError(refreshed.error, true);
      busy = false;
      updateControls();
    }
  });
  const initial = await refreshVisibility();
  if (initial.error) reportRefreshError(initial.error);
  return true;
}
