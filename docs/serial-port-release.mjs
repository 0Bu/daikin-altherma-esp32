const portLeases = new WeakMap();
const releaseRequests = new WeakSet();
const ownershipListeners = new Set();

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
  const ports = await serial.getPorts();
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
  releaseRequests.add(serial);
  let lease;
  try {
    const granted = await grantedSerialPorts(serial);
    checkReleaseAllowed(controller);
    if (!granted.length) throw namedError("NotFoundError", "This site has no serial-port permission to remove.");
    const selected = controller?.getSelectedPort();
    const preferred = selected && granted.includes(selected) && !serialPortLease(selected) && !serialPortIsOpen(selected);
    const port = preferred ? selected : granted.length === 1 ? granted[0] : await serial.requestPort();
    checkReleaseAllowed(controller);
    if (!granted.includes(port)) {
      throw namedError("PermissionMismatchError", "The selected port was not already permitted. No permission was removed.");
    }
    if (typeof port?.forget !== "function") throw namedError("NotSupportedError", "This browser cannot forget serial ports.");
    lease = acquireSerialPortLease(port, "release");
    const fresh = await grantedSerialPorts(serial);
    checkReleaseAllowed(controller);
    if (!fresh.includes(port)) {
      throw namedError("PermissionMismatchError", "The selected port is no longer permitted. No permission was removed.");
    }
    if (serialPortIsOpen(port)) throw namedError("InvalidStateError", "The serial port is still open. Stop its monitor or installer first.");
    await port.forget();
    return port;
  } finally {
    if (lease) releaseSerialPortLease(lease);
    releaseRequests.delete(serial);
  }
}

export function releaseFeedback(error) {
  switch (error && error.name) {
    case "NotFoundError": return { kind: "info", message: "No port released." };
    case "InvalidStateError": return { kind: "error", message: error.message || "Wait for serial operations and confirmed port closure before releasing the port." };
    case "PermissionMismatchError": return { kind: "error", message: error.message };
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
    button.disabled = busy || Boolean(controller?.isReleaseBlocked()) ||
      (grants.length > 0 && grants.every((port) => serialPortLease(port) || serialPortIsOpen(port)));
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  };
  const refreshVisibility = async () => {
    const generation = ++refreshing;
    try {
      const ports = await grantedSerialPorts(serial);
      if (generation !== refreshing) return !container.hidden;
      grants = ports;
      container.hidden = !grants.length;
    } catch (_error) {
      if (generation !== refreshing) return !container.hidden;
      grants = [];
      container.hidden = true;
    }
    updateControls();
    return !container.hidden;
  };
  const scheduleRefresh = () => refreshVisibility();
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
    if (busy) return;
    busy = true;
    updateControls();
    status.hidden = false;
    status.dataset.kind = "info";
    status.textContent = "Releasing serial port…";
    try {
      const port = await releaseSelectedSerialPort(serial, { controller });
      if (typeof onReleased === "function") await onReleased(port);
      status.dataset.kind = "success";
      status.textContent = "Serial port released — it is no longer paired with this site.";
    } catch (error) {
      const feedback = releaseFeedback(error);
      status.dataset.kind = feedback.kind;
      status.textContent = feedback.message;
    } finally {
      await refreshVisibility();
      busy = false;
      updateControls();
    }
  });
  await refreshVisibility();
  return true;
}
