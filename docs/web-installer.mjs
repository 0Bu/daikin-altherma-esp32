// Web Serial installer: a verified firmware offer, serial-port ownership, a read-only check of the
// installed partition table and app before flashing, Flash and Clean flash side by side with only
// Clean flash left when the installed data cannot be kept, and a log that follows the firmware
// after connecting and installing.
//
// One connection opens the port once and closes it once. Rapid open/close cycles have locked an
// ESP32-S3's USB-Serial/JTAG link on macOS until a power cycle while the firmware kept running, so
// the check hands its open port to the live log, Reset only pulses the reset line, and an install
// borrows the port from the log and hands it back.
import {
  acquireSerialPortLease, forgetSerialPort, releaseFeedback, releaseSerialPortLease, serialPortIsOpen,
  serialPortLease, subscribeSerialOwnership, supportsSerialForget, updateSerialPortLease
} from "./serial-port-release.mjs";

const ESPRESSIF_USB_VENDOR_ID = 0x303a;
const CDC_PRODUCT_IDS = new Set([0x0002, 0x0003, 0x1001, 0x1002, 0x1003]);
const MAX_MONITOR_CHARS = 100000;
// Within this many pixels of its end the log counts as scrolled to the end and follows new lines.
const LOG_END_SLACK_PX = 8;
const DEVICE_PROBE_TIMEOUT_MS = 10000;
const TRANSPORT_CLEANUP_TIMEOUT_MS = 2000;
const DEVICE_FLASH_TIMEOUT_MS = 180000;
// esptool-js opens the port with Web Serial's default 255-byte buffer unless told otherwise. Chrome
// then drains USB only as fast as the page reads, and the flasher stub on USB-Serial/JTAG drops data
// it cannot send in time: a 3-KiB flash read arrived as 830 bytes. A large buffer made such losses
// rare but not impossible, so the installed-firmware check also reads in small steps.
const ESPTOOL_SERIAL_OPTIONS = Object.freeze({ bufferSize: 0x10000 });
// Each read of the installed-firmware check has its own bound, so a slow or stuck read can neither
// eat the chip probe's budget nor hold the port; the check stops at the first read that fails.
const FLASH_READ_STEP_TIMEOUT_MS = 2500;
const INSPECTION_TIMEOUT_MS = 4 * FLASH_READ_STEP_TIMEOUT_MS;
// A cancelled probe keeps its port until esptool-js gives up connecting; unpairing waits that long.
const PORT_RELEASE_WAIT_MS = 15000;
// A port opens once per browser: right after a reload Chrome may still hold the previous page's
// handle, and another tab may hold it for good. A failed open never reaches the device, so the
// check of a paired port is retried.
const PAIRED_OPEN_ATTEMPTS = 3;
const PAIRED_OPEN_RETRY_MS = 500;
const ANSI_CONTROL_SEQUENCE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/;
const MAX_BINARY_BYTES = 0x800000;
const FIRMWARE_DOWNLOAD_TIMEOUT_MS = 30000;
const FLASH_SECTOR_BYTES = 0x1000;
// Mirrors the official partitions.csv; the publisher derives its bounds from that file.
const APP_PART = "daikin-altherma-esp32.bin";
const OFFICIAL_FLASH_PARTS = Object.freeze([
  { path: "daikin-altherma-esp32-web-bootloader.bin", offset: 0, end: 0x8000 },
  { path: "daikin-altherma-esp32-web-partition-table.bin", offset: 0x8000, end: 0x9000 },
  { path: "daikin-altherma-esp32-web-ota_data_initial.bin", offset: 0xf000, end: 0x11000 },
  { path: APP_PART, offset: 0x20000, end: 0x210000 }
]);
const PRESERVED_FLASH_RANGES = Object.freeze([
  { name: "nvs", start: 0x9000, end: 0xf000 },
  { name: "coredump", start: 0x12000, end: 0x1e000 },
  { name: "history", start: 0x400000, end: 0x800000 }
]);
const verifiedOffers = new WeakMap();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorWithName(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function errorMessage(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}

const isOpenFailure = (error) => error?.name === "NetworkError" && /open/i.test(errorMessage(error));
const PORT_BUSY = Symbol("port busy");

// esptool-js opens the port in Transport.connect() and closes it in disconnect(). This transport
// uses a port that is already open and, through release(), hands it on without closing it.
const sharedTransports = new WeakMap();
export function sharedPortTransport(Base) {
  if (!sharedTransports.has(Base)) {
    sharedTransports.set(Base, class extends Base {
      async connect(...args) {
        if (serialPortIsOpen(this.device)) this.baudrate = args[0] ?? 115200;
        else await super.connect(...args);
        this.onOpened?.();
      }
      // Ends esptool-js's read loop and waits until both streams are unlocked; the port stays open.
      async release() {
        if (this.device?.readable?.locked) await this.reader?.cancel();
        const deadline = Date.now() + TRANSPORT_CLEANUP_TIMEOUT_MS;
        while (this.device?.readable?.locked || this.device?.writable?.locked) {
          if (Date.now() >= deadline) throw errorWithName("SerialCleanupError", "The flasher did not release the serial port.");
          await sleep(10);
        }
        this.reader = undefined;
      }
    });
  }
  return sharedTransports.get(Base);
}

export function stripSerialAnsi(text) {
  return String(text || "").replace(ANSI_CONTROL_SEQUENCE, "");
}

export function serialLogLevel(line) {
  const plain = stripSerialAnsi(line).trimStart();
  if (/^E\s+\(/.test(plain)) return "error";
  if (/^W\s+\(/.test(plain)) return "warning";
  return "info";
}

export function splitSerialChunk(pending, text, flush = false) {
  const combined = `${pending || ""}${text || ""}`;
  // A CR/LF pair may be split across two Web Serial reads. Hold a trailing CR until the next chunk
  // so it remains one line ending instead of becoming an empty line followed by LF.
  const holdTrailingCr = !flush && combined.endsWith("\r");
  const source = holdTrailingCr ? combined.slice(0, -1) : combined;
  const parts = source.replace(/\r\n?/g, "\n").split("\n");
  let nextPending = parts.pop() || "";
  if (holdTrailingCr) nextPending += "\r";

  const lines = parts.map((line) => ({ text: line, terminated: true }));
  if (flush && nextPending) {
    lines.push({ text: nextPending, terminated: false });
    nextPending = "";
  }
  return { lines, pending: nextPending };
}

async function withTimeout(operation, milliseconds, timeoutError) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError), milliseconds);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function terminalAdapter(onLog) {
  return {
    clean() {},
    write(data) { onLog(String(data)); },
    writeLine(data) { onLog(`${String(data)}\n`); }
  };
}

// `keepOpen` hands a port that is still open on to the next owner instead of resetting and closing
// it; when that release fails, the port is closed as usual.
async function settleTransport(port, transport, loader, { reset, keepOpen = false } = {}) {
  let error;
  if (reset && loader && loader.chip && typeof loader.after === "function") {
    try {
      await loader.after(reset);
    } catch (failure) { error = failure; }
  }
  if (keepOpen && serialPortIsOpen(port) && typeof transport?.release === "function") {
    try {
      await transport.release();
      return { released: true };
    } catch (failure) { error = failure; }
  }
  let closed = !transport && !serialPortIsOpen(port);
  if (transport && typeof transport.disconnect === "function") {
    try {
      await transport.disconnect();
    } catch (failure) {
      // A port that never opened, or is already closed, leaves nothing to close.
      if (serialPortIsOpen(port)) error ||= failure;
    }
    closed = !serialPortIsOpen(port);
  }
  if (!closed && serialPortIsOpen(port) && typeof port.close === "function") {
    try { await port.close(); closed = !serialPortIsOpen(port); } catch (failure) { error ||= failure; }
  }
  if (!closed) error ||= new Error("Native serial-port closure could not be confirmed.");
  return { released: closed, error };
}

function cleanupFailure(error, limitation, port) {
  const primary = error || errorWithName("SerialCleanupError", "Serial cleanup failed.");
  const lease = serialPortLease(port);
  const reservation = lease
    ? lease.phase === "quarantined"
      ? "The port remains reserved because closure was not confirmed. Reconnect the device and reload this page."
      : "The port stays reserved until its native operation and cleanup settle."
    : "The serial port is closed; no reservation is held.";
  // DOMException.message is read-only, and a primary Error may be frozen. Compose without
  // changing it; the cause retains the original name, message and any earlier cause chain.
  const details = primary === limitation ? errorMessage(primary) : `${errorMessage(primary)} ${errorMessage(limitation)}`;
  const failure = new Error(`${details} ${reservation}`, { cause: primary });
  failure.name = primary.name || "SerialCleanupError";
  failure.cleanupError = limitation;
  return failure;
}

// A foreground deadline never means native open/main/changeBaudrate was cancelled. Keep the
// lease until the actual body AND captured cleanup settle, and quarantine an unconfirmed release
// (the port closed, or handed on open with unlocked streams).
function ownPortOperation(port, kind, body, cleanup, onOwnership = () => {}) {
  const lease = acquireSerialPortLease(port, kind);
  let resolveSettled;
  let rejectCancellation;
  const state = {
    port, lease, kind, cancelled: false, foreground: true, bodyFinished: false,
    settled: new Promise((resolve) => { resolveSettled = resolve; }),
    cancellation: new Promise((_, reject) => { rejectCancellation = reject; }),
    cancel(reason = errorWithName("SerialOperationCancelledError", "The serial operation was cancelled.")) {
      if (this.cancelled) return;
      this.cancelled = true;
      this.reason = reason;
      rejectCancellation(reason);
      this.onCancel?.();
    },
    guard() { if (this.cancelled) throw this.reason; }
  };
  state.cancellation.catch(() => {});
  state.bodyOutcome = Promise.resolve().then(async () => {
    try { return { value: await body(state) }; }
    catch (error) { return { error }; }
    finally { state.bodyFinished = true; }
  });
  state.bodyOutcome.then(async (outcome) => {
    updateSerialPortLease(lease, "cleanup");
    let result;
    try { result = await cleanup(state); }
    catch (error) { result = { released: false, error }; }
    if (!result.released) result.error ||= new Error("Native serial-port closure could not be confirmed.");
    if (result.released) releaseSerialPortLease(lease);
    else updateSerialPortLease(lease, "quarantined");
    resolveSettled({ ...outcome, cleanupError: result.error });
  }).catch((error) => {
    updateSerialPortLease(lease, "quarantined");
    resolveSettled({ error, cleanupError: error });
  });
  onOwnership(state);
  return state;
}

async function awaitPortOperation(state, timeoutMs, timeoutError, cleanupTimeoutMs = TRANSPORT_CLEANUP_TIMEOUT_MS) {
  let outcome;
  try {
    try {
      outcome = await withTimeout(Promise.race([state.bodyOutcome, state.cancellation]), timeoutMs, timeoutError);
    } catch (error) {
      state.cancel(error);
      if (!state.bodyFinished) throw cleanupFailure(error, new Error("The native serial operation is still pending."), state.port);
      outcome = { error };
    }
    let completed;
    try {
      completed = await withTimeout(state.settled, cleanupTimeoutMs,
        errorWithName("SerialCleanupTimeoutError", "Serial cleanup timed out."));
    } catch (error) {
      state.cancel(error);
      throw cleanupFailure(outcome.error || error, new Error("Native serial cleanup is still pending."), state.port);
    }
    if (completed.cleanupError) throw cleanupFailure(outcome.error || completed.error, completed.cleanupError, state.port);
    if (outcome.error || completed.error) throw outcome.error || completed.error;
    state.guard();
    return outcome.value;
  } finally { state.foreground = false; }
}

export async function resetToUserFirmware(port, delay = sleep, guard = () => {}) {
  if (!port || typeof port.setSignals !== "function") {
    throw new Error("This serial adapter cannot reset the ESP automatically.");
  }

  // Keep IO0 high while EN is pulsed low, then release EN. This is the same
  // firmware-mode reset used by ESPConnect and avoids leaving the chip in the
  // flasher stub after the compatibility probe.
  guard();
  await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  guard();
  await delay(100);
  guard();
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  guard();
  await delay(250);
  guard();
}

export function detectedSerialType(info = {}) {
  return info.usbVendorId === ESPRESSIF_USB_VENDOR_ID &&
    CDC_PRODUCT_IDS.has(info.usbProductId) ? "cdc" : "uart";
}

export function describeSerialConnection(info = {}) {
  if (detectedSerialType(info) === "cdc") return "USB Serial/JTAG";
  if (info.usbVendorId !== undefined) return "USB UART";
  return "Web Serial";
}

export function selectManifestBuild(manifest, chipFamily, info = {}) {
  if (!manifest || !Array.isArray(manifest.builds)) return undefined;
  const serialType = detectedSerialType(info);
  return manifest.builds.find((build) =>
    build.chipFamily === chipFamily && build.serialType === serialType
  ) || manifest.builds.find((build) =>
    build.chipFamily === chipFamily && build.serialType === undefined
  );
}

export function combinedProgress(fileArray, fileIndex, written, total) {
  const totalBytes = fileArray.reduce((sum, file) => sum + file.data.length, 0);
  if (!totalBytes || !fileArray[fileIndex]) return 0;
  const completedBytes = fileArray
    .slice(0, fileIndex)
    .reduce((sum, file) => sum + file.data.length, 0);
  const currentBytes = total > 0
    ? Math.min(1, Math.max(0, written / total)) * fileArray[fileIndex].data.length
    : 0;
  return Math.min(100, Math.max(0, Math.floor(((completedBytes + currentBytes) / totalBytes) * 100)));
}

function integrityError(message) {
  return errorWithName("FirmwareIntegrityError", `${message} Reload this page to select the current firmware, then try again.`);
}

function parseMetadata(bytes, name) {
  // JSON.parse silently accepts repeated object keys. Reject them before interpreting metadata.
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(source[cursor] || "") && cursor < source.length) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === "\\") cursor++;
      else if (character === '"') return JSON.parse(source.slice(start, cursor));
    }
    throw new Error("unterminated string");
  };
  const value = (depth = 0) => {
    if (depth > 16) throw new Error("metadata is too deeply nested");
    whitespace();
    const opener = source[cursor];
    if (opener === "{" || opener === "[") {
      cursor++;
      whitespace();
      const closer = opener === "{" ? "}" : "]";
      const keys = new Set();
      if (source[cursor] !== closer) {
        while (true) {
          if (opener === "{") {
            if (source[cursor] !== '"') throw new Error("invalid object key");
            const key = string();
            if (keys.has(key)) throw new Error(`duplicate metadata key ${key}`);
            keys.add(key);
            whitespace();
            if (source[cursor++] !== ":") throw new Error("missing object colon");
          }
          value(depth + 1);
          whitespace();
          if (source[cursor] !== ",") break;
          cursor++;
          whitespace();
        }
      }
      if (source[cursor++] !== closer) throw new Error("invalid container");
    } else if (opener === '"') {
      string();
    } else {
      const primitive = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(cursor));
      if (!primitive) throw new Error("invalid value");
      cursor += primitive[0].length;
    }
  };
  try {
    value();
    whitespace();
    if (cursor !== source.length) throw new Error("trailing metadata");
    return JSON.parse(source);
  } catch (error) {
    throw integrityError(`${name} is invalid: ${errorMessage(error)}.`);
  }
}

function freezeMetadata(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeMetadata);
    Object.freeze(value);
  }
  return value;
}

function requireCrypto(cryptoImpl) {
  if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    throw errorWithName("FirmwareVerificationUnavailableError", "Firmware verification is unavailable in this browser. Use Chrome or Edge on a secure desktop page.");
  }
}

async function sha256(bytes, cryptoImpl) {
  const digest = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function downloadBytes(url, fetchImpl, limit, siblingSignal) {
  const controller = new AbortController();
  let reader;
  let timeoutId;
  const timeoutError = () => integrityError("Firmware download exceeded its 30-second time limit.");
  const deadline = performance.now() + FIRMWARE_DOWNLOAD_TIMEOUT_MS;
  const abortFromSibling = () => controller.abort(siblingSignal.reason);
  const interruption = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      const reason = controller.signal.reason || integrityError("Firmware download was cancelled.");
      reject(reason);
      if (reader) {
        // Cancellation may itself stall in a broken source; abort and return without waiting for it.
        try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch (_error) {}
      }
    }, { once: true });
    timeoutId = setTimeout(() => controller.abort(timeoutError()), FIRMWARE_DOWNLOAD_TIMEOUT_MS);
  });
  if (siblingSignal) {
    siblingSignal.addEventListener("abort", abortFromSibling, { once: true });
    if (siblingSignal.aborted) abortFromSibling();
  }
  const requireTime = () => {
    if (!controller.signal.aborted && performance.now() >= deadline) controller.abort(timeoutError());
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  const consume = async () => {
    requireTime();
    const response = await fetchImpl(url, { cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.body || typeof response.body.getReader !== "function") {
      throw integrityError("The browser cannot stream firmware downloads safely.");
    }
    reader = response.body.getReader();
    // A fetch implementation may finish after its abort signal. Cancel that late body too.
    if (controller.signal.aborted) {
      try { Promise.resolve(reader.cancel(controller.signal.reason)).catch(() => {}); } catch (_error) {}
      try { reader.releaseLock(); } catch (_error) {}
    }
    requireTime();
    if (!response.ok || response.redirected || response.url !== url) {
      throw integrityError(`Firmware download changed location or failed with HTTP ${response.status}.`);
    }
    const declaredSize = response.headers?.get("content-length");
    if (declaredSize !== undefined && declaredSize !== null &&
        (!/^[0-9]+$/.test(declaredSize) || !Number.isSafeInteger(Number(declaredSize)) ||
         Number(declaredSize) > limit)) {
      throw integrityError("Firmware download declared an invalid size.");
    }
    const bytes = new Uint8Array(limit);
    let size = 0;
    while (true) {
      requireTime();
      const { value, done } = await reader.read();
      requireTime();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > limit - size) {
        throw integrityError("Firmware download exceeded its byte limit.");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    if (!size) throw integrityError("Firmware download has an invalid size.");
    return bytes.subarray(0, size);
  };
  try {
    return await Promise.race([consume(), interruption]);
  } catch (error) {
    const failure = error?.name === "FirmwareIntegrityError" ? error :
      integrityError(`Downloading firmware metadata or bytes failed: ${errorMessage(error)}.`);
    controller.abort(failure);
    throw failure;
  } finally {
    clearTimeout(timeoutId);
    if (siblingSignal) siblingSignal.removeEventListener("abort", abortFromSibling);
    if (reader) {
      try { reader.releaseLock(); } catch (_error) {}
    }
  }
}

function validateFlashBuild(build, entries, appSha256) {
  if (!build || build.chipFamily !== "ESP32-S3" ||
      (build.serialType !== undefined && !["cdc", "uart"].includes(build.serialType)) ||
      !Array.isArray(build.parts) || build.parts.length !== OFFICIAL_FLASH_PARTS.length) {
    throw integrityError("The firmware offer has an unsupported target or incomplete flash plan.");
  }
  const seen = new Set();
  const eraseRanges = [];
  for (const part of build.parts) {
    const expected = OFFICIAL_FLASH_PARTS.find((candidate) => candidate.path === part?.path);
    const entry = entries.get(part?.path);
    if (!expected || !entry || seen.has(part.path) || part.offset !== expected.offset) {
      throw integrityError("The firmware offer has a duplicate, unindexed or noncanonical flash part.");
    }
    seen.add(part.path);
    const start = Math.floor(part.offset / FLASH_SECTOR_BYTES) * FLASH_SECTOR_BYTES;
    const end = Math.ceil((part.offset + entry.size) / FLASH_SECTOR_BYTES) * FLASH_SECTOR_BYTES;
    for (const preserved of PRESERVED_FLASH_RANGES) {
      if (start < preserved.end && end > preserved.start) {
        throw integrityError(`The firmware part would erase preserved ${preserved.name} data.`);
      }
    }
    if (end > expected.end || eraseRanges.some((range) => start < range.end && end > range.start)) {
      throw integrityError("The firmware offer has overlapping or oversized flash parts.");
    }
    eraseRanges.push({ start, end });
    if (part.path === APP_PART && entry.sha256 !== appSha256) {
      throw integrityError("The selected application does not match the signed application provenance.");
    }
  }
}

export async function loadFirmwareOffer({ manifestUrl, fetchImpl = fetch, cryptoImpl = globalThis.crypto }) {
  requireCrypto(cryptoImpl);
  const url = new URL(manifestUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith("/manifest.json")) {
    throw integrityError("Firmware metadata must come from its HTTPS feed directory.");
  }
  const rawManifest = await downloadBytes(url.href, fetchImpl, 1024);
  const manifest = parseMetadata(rawManifest, "manifest.json");
  const manifestSha256 = await sha256(rawManifest, cryptoImpl);
  const rawIndex = await downloadBytes(new URL("artifacts.json", url).href, fetchImpl, 65536);
  const index = parseMetadata(rawIndex, "artifacts.json");
  if (!manifest || manifest.name !== "daikin-altherma-esp32" ||
      typeof manifest.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-dev\.[0-9]+)?$/.test(manifest.version) ||
      manifest.new_install_prompt_erase !== true || "artifacts" in manifest ||
      typeof manifest.provenance?.app_sha256 !== "string" ||
      !SHA256_PATTERN.test(manifest.provenance.app_sha256) ||
      !Array.isArray(manifest.builds) || !manifest.builds.length) {
    throw integrityError("The firmware manifest is incomplete or invalid.");
  }
  if (!index || Object.keys(index).sort().join(",") !== "artifacts,manifest_sha256,schema_version" ||
      index.schema_version !== 1 || index.manifest_sha256 !== manifestSha256 ||
      !Array.isArray(index.artifacts) || !index.artifacts.length) {
    throw integrityError("The artifact index does not match the displayed firmware manifest.");
  }
  const entries = new Map();
  for (const entry of index.artifacts) {
    if (!entry || Object.keys(entry).sort().join(",") !== "path,sha256,size" ||
        typeof entry.path !== "string" || !ARTIFACT_NAME_PATTERN.test(entry.path) || entries.has(entry.path) ||
        typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256) || !Number.isSafeInteger(entry.size) ||
        entry.size <= 0 || entry.size > MAX_BINARY_BYTES) {
      throw integrityError("The artifact index has unsafe, duplicate or invalid metadata.");
    }
    entries.set(entry.path, entry);
  }
  const targets = new Set();
  for (const build of manifest.builds) {
    validateFlashBuild(build, entries, manifest.provenance.app_sha256);
    const target = `${build.chipFamily}:${build.serialType || "default"}`;
    if (targets.has(target)) throw integrityError("The firmware manifest repeats a build target.");
    targets.add(target);
  }
  const offer = freezeMetadata({ manifestUrl: url.href, manifestSha256, manifest, artifacts: index.artifacts });
  verifiedOffers.set(offer, { entries, cryptoImpl });
  return offer;
}

function requireOffer(offer) {
  const verification = offer && verifiedOffers.get(offer);
  if (!verification) throw integrityError("A verified firmware offer is required before installation.");
  return verification;
}

export async function fetchFirmwareParts(build, offer, fetchImpl = fetch) {
  const { entries, cryptoImpl } = requireOffer(offer);
  if (!offer.manifest.builds.includes(build)) throw integrityError("The selected build is outside the verified firmware offer.");

  const downloads = new AbortController();
  const pending = build.parts.map(async (part) => {
    try {
      const entry = entries.get(part.path);
      const url = new URL(part.path, offer.manifestUrl).href;
      const data = await downloadBytes(url, fetchImpl, entry.size, downloads.signal);
      if (data.length !== entry.size || await sha256(data, cryptoImpl) !== entry.sha256) {
        throw integrityError(`Downloaded ${part.path} no longer matches the displayed firmware offer.`);
      }
      if (downloads.signal.aborted) throw downloads.signal.reason;
      return { address: part.offset, data };
    } catch (error) {
      downloads.abort(error);
      throw error;
    }
  });
  try {
    return await Promise.all(pending);
  } catch (error) {
    downloads.abort(error);
    await Promise.allSettled(pending);
    throw error;
  }
}

export async function fetchOfferPart(offer, path, fetchImpl = fetch) {
  const { entries, cryptoImpl } = requireOffer(offer);
  const entry = entries.get(path);
  if (!entry || !offer.manifest.builds.some((build) => build.parts.some((part) => part.path === path))) {
    throw integrityError(`${path} is not part of the displayed firmware offer.`);
  }
  const data = await downloadBytes(new URL(path, offer.manifestUrl).href, fetchImpl, entry.size);
  if (data.length !== entry.size || await sha256(data, cryptoImpl) !== entry.sha256) {
    throw integrityError(`Downloaded ${path} no longer matches the displayed firmware offer.`);
  }
  return data;
}

// Read-only look at what the device would boot, taken while the flasher stub runs. Formats follow
// ESP-IDF: partition table entries, esp_ota_select_entry_t and esp_app_desc_t.
const PARTITION_TABLE_PART = OFFICIAL_FLASH_PARTS[1].path;
const PARTITION_TABLE_OFFSET = 0x8000;
const PARTITION_ENTRY_MAGIC = 0x50aa;
const PARTITION_MD5_MAGIC = 0xebeb;
// Small reads: Chrome drains USB in pieces with short pauses, and a 3-KiB burst from the stub lost
// its middle when a pause outlasted the stub's send timeout. The first few hundred bytes always arrived.
const FLASH_READ_CHUNK_BYTES = 0x100;
const OTA_SELECT_SECTOR_BYTES = 0x1000;
const OTA_IMG_INVALID = 3;
const OTA_IMG_ABORTED = 4;
const APP_HEAD_BYTES = 0x70; // image and first segment headers (0x20), esp_app_desc_t through project_name
const APP_DESC_MAGIC = 0xabcd5432;
const MAC_PATTERN = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;

function cString(bytes) {
  const end = bytes.indexOf(0);
  const text = String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end));
  return /^[\x20-\x7e]*$/.test(text) ? text : "";
}

const littleEndian = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function parsePartitionTable(bytes) {
  const view = littleEndian(bytes);
  const partitions = [];
  for (let at = 0; at + 32 <= bytes.length && view.getUint16(at, true) === PARTITION_ENTRY_MAGIC; at += 32) {
    partitions.push({
      type: bytes[at + 2], subtype: bytes[at + 3],
      offset: view.getUint32(at + 4, true), size: view.getUint32(at + 8, true),
      label: cString(bytes.subarray(at + 12, at + 28))
    });
  }
  return partitions;
}

export function otaSequenceCrc(sequence) {
  // esp_rom_crc32_le(UINT32_MAX, &ota_seq, 4): the ROM inverts its seed, so the register starts at 0.
  let crc = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    crc ^= (sequence >>> shift) & 0xff;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

// Mirrors the bootloader: the valid otadata entry with the highest sequence selects
// ota[(seq - 1) % count]; without one it boots factory, else ota_0.
export function selectBootPartition(partitions, otadataEntries = []) {
  const apps = partitions.filter((partition) => partition.type === 0);
  const ota = apps.filter((partition) => partition.subtype >= 0x10 && partition.subtype < 0x20)
    .sort((left, right) => left.subtype - right.subtype);
  let sequence;
  for (const entry of otadataEntries) {
    if (!entry || entry.length < 32) continue;
    const view = littleEndian(entry);
    const candidate = view.getUint32(0, true);
    const state = view.getUint32(24, true);
    if (candidate === 0xffffffff || state === OTA_IMG_INVALID || state === OTA_IMG_ABORTED ||
        view.getUint32(28, true) !== otaSequenceCrc(candidate)) continue;
    if (sequence === undefined || candidate > sequence) sequence = candidate;
  }
  if (sequence !== undefined && ota.length) return ota[((sequence - 1) >>> 0) % ota.length];
  return apps.find((partition) => partition.subtype === 0) || ota[0];
}

export function parseAppDescription(bytes) {
  if (!bytes || bytes.length < APP_HEAD_BYTES || bytes[0] !== 0xe9) return null;
  if (littleEndian(bytes).getUint32(0x20, true) !== APP_DESC_MAGIC) return null;
  return { version: cString(bytes.subarray(0x30, 0x50)), project: cString(bytes.subarray(0x50, 0x70)) };
}

// Bytes of a partition table up to and including its MD5 entry, or up to its end marker; undefined
// while the given bytes do not reach either. The bootloader ignores everything after that point.
export function partitionTableLength(bytes) {
  const view = littleEndian(bytes);
  for (let at = 0; at + 32 <= bytes.length; at += 32) {
    const magic = view.getUint16(at, true);
    if (magic === PARTITION_MD5_MAGIC) return at + 32;
    if (magic !== PARTITION_ENTRY_MAGIC) return at;
  }
  return undefined;
}

// Keeping data needs the settings where the new table expects them: the same NVS label, offset and
// size. The former 4 MB table differs elsewhere but keeps NVS there, so it can be updated in place.
const PARTITION_TYPE_DATA = 1;
const DATA_SUBTYPE_NVS = 2;
const nvsPartition = (partitions) => partitions.find((partition) =>
  partition.type === PARTITION_TYPE_DATA && partition.subtype === DATA_SUBTYPE_NVS && partition.label === "nvs");

export function sameNvsLayout(installed, offered) {
  const [have, want] = [nvsPartition(installed), nvsPartition(offered)];
  return Boolean(have && want && have.offset === want.offset && have.size === want.size);
}

export async function inspectInstalledFirmware(loader, expectedTable, flashSize, guard = () => {}) {
  const limit = Number.parseInt(flashSize, 10) * 0x100000;
  const read = async (offset, length) => {
    if (!(offset + length <= limit)) return null;
    const bytes = await withTimeout(loader.readFlash(offset, length), FLASH_READ_STEP_TIMEOUT_MS,
      errorWithName("FlashReadTimeoutError", `Reading flash at 0x${offset.toString(16)} timed out.`));
    guard();
    return bytes instanceof Uint8Array && bytes.length >= length ? bytes.subarray(0, length) : null;
  };
  let table = new Uint8Array(0);
  while (partitionTableLength(table) === undefined && table.length < expectedTable.length) {
    const chunk = await read(PARTITION_TABLE_OFFSET + table.length,
      Math.min(FLASH_READ_CHUNK_BYTES, expectedTable.length - table.length));
    if (!chunk) throw errorWithName("FlashReadError", "The installed partition table could not be read.");
    const joined = new Uint8Array(table.length + chunk.length);
    joined.set(table);
    joined.set(chunk, table.length);
    table = joined;
  }
  const used = partitionTableLength(table) ?? table.length;
  const expectedUsed = partitionTableLength(expectedTable) ?? expectedTable.length;
  const layoutMatches = used === expectedUsed && table.subarray(0, used).every((byte, index) => byte === expectedTable[index]);
  const partitions = parsePartitionTable(table);
  const nvsMatches = sameNvsLayout(partitions, parsePartitionTable(expectedTable));
  const otadata = partitions.find((partition) => partition.type === PARTITION_TYPE_DATA && partition.subtype === 0);
  // Once the table is read, its verdict stands: a later failed read leaves only the app unknown, so
  // NVS known to be elsewhere still rules out keeping data.
  try {
    const entries = [];
    if (otadata) {
      for (const sector of [0, OTA_SELECT_SECTOR_BYTES]) entries.push(await read(otadata.offset + sector, 32));
    }
    const app = selectBootPartition(partitions, entries);
    const firmware = app ? parseAppDescription(await read(app.offset, APP_HEAD_BYTES)) : null;
    return { layoutMatches, nvsMatches, firmware, slot: app?.label || "" };
  } catch (error) {
    if (error?.name === "SerialOperationCancelledError") throw error;
    return { layoutMatches, nvsMatches, firmware: null, slot: "", error: errorMessage(error) };
  }
}

async function requireOfficialFlashCapacity(loader) {
  const flashSize = typeof loader.detectFlashSize === "function" ? await loader.detectFlashSize() : undefined;
  // These are the >=8 MB values returned by the pinned esptool-js detectFlashSize API.
  if (!["8MB", "16MB", "32MB", "64MB", "128MB", "256MB"].includes(flashSize)) {
    throw errorWithName("UnsupportedFlashSizeError", "This firmware needs an ESP32-S3 with at least 8 MB of detected flash. Flash capacity could not be confirmed or is too small.");
  }
  return flashSize;
}

// With `keepOpen`, a successful check leaves the port open and the chip in the flasher for the live
// log, which resets it into the firmware; otherwise the check resets the chip and closes the port.
export async function probeDevice({
  port, manifest, expectedPartitionTable, TransportCtor, ESPLoaderCtor, onLog = () => {}, onStep = () => {},
  onOpened = () => {}, trace = false, keepOpen = false,
  timeoutMs = DEVICE_PROBE_TIMEOUT_MS + (expectedPartitionTable ? INSPECTION_TIMEOUT_MS : 0),
  cleanupTimeoutMs = TRANSPORT_CLEANUP_TIMEOUT_MS,
  onOwnership
}) {
  let transport;
  let loader;
  let probed = false;
  const state = ownPortOperation(port, "probe", async (operation) => {
    operation.guard();
    transport = new (sharedPortTransport(TransportCtor))(port);
    transport.onOpened = () => { if (!operation.cancelled && operation.foreground) onOpened(); };
    loader = new ESPLoaderCtor({
      transport, baudrate: 115200,
      terminal: terminalAdapter((text) => { if (!operation.cancelled && operation.foreground) onLog(text); }),
      debugLogging: false, enableTracing: trace, serialOptions: ESPTOOL_SERIAL_OPTIONS
    });
    await loader.main();
    operation.guard();
    if (typeof loader.flashId === "function") await loader.flashId();
    operation.guard();
    const chipFamily = loader.chip && loader.chip.CHIP_NAME;
    if (!chipFamily) throw errorWithName("ChipDetectionError", "The connected ESP chip could not be identified.");
    const build = selectManifestBuild(manifest, chipFamily, port.getInfo());
    if (!build) throw errorWithName("UnsupportedChipError", `${chipFamily} is not supported by this firmware.`);
    const flashSize = await requireOfficialFlashCapacity(loader);
    operation.guard();
    const mac = typeof loader.chip.readMac === "function" ? String(await loader.chip.readMac(loader)) : "";
    operation.guard();
    // Without the offer's partition table there is nothing to compare; only the chip is checked. A
    // failed read leaves the installed firmware unknown instead of failing the connection.
    let installed = null;
    if (expectedPartitionTable) {
      if (operation.foreground) onStep("Reading partition table and app header");
      try {
        installed = await inspectInstalledFirmware(loader, expectedPartitionTable, flashSize, () => operation.guard());
      } catch (error) {
        // A cancelled probe ends in awaitPortOperation regardless of this result.
        installed = { error: errorMessage(error) };
      }
    }
    probed = true;
    return { chipFamily, flashSize, build, mac: MAC_PATTERN.test(mac) ? mac.toLowerCase() : "", installed };
  }, (operation) => settleTransport(port, transport, loader,
    probed && keepOpen && !operation.cancelled ? { keepOpen: true } : { reset: "hard_reset" }), onOwnership);
  return awaitPortOperation(state, timeoutMs, errorWithName(
    "DeviceProbeTimeoutError",
    "The serial device did not answer in flashing mode. Select an ESP32-S3 USB port; if it is an ESP32-S3, hold BOOT, tap RESET, then try again."
  ), cleanupTimeoutMs);
}

// With `keepOpen`, a successful install leaves the port open for the live log, which starts the new
// firmware; otherwise the install resets the chip itself and closes the port.
export async function flashDevice({
  port, offer, eraseFirst, TransportCtor, ESPLoaderCtor, fetchImpl = fetch, trace = false, keepOpen = false,
  onState = () => {}, onLog = () => {}, onOwnership
}) {
  requireOffer(offer);
  const manifest = offer.manifest;
  let transport;
  let loader;
  let completed = false;
  const state = ownPortOperation(port, "flash", async (operation) => {
    operation.guard();
    transport = new (sharedPortTransport(TransportCtor))(port);
    loader = new ESPLoaderCtor({
      transport, baudrate: 115200,
      terminal: terminalAdapter((text) => { if (!operation.cancelled && operation.foreground) onLog(text); }),
      debugLogging: false, enableTracing: trace, serialOptions: ESPTOOL_SERIAL_OPTIONS
    });
    const report = (value) => { operation.guard(); onState(value); };
    report({ stage: "connecting", percentage: 0, message: "Checking device" });
    await loader.main();
    operation.guard();
    if (typeof loader.flashId === "function") await loader.flashId();
    operation.guard();
    const chipFamily = loader.chip && loader.chip.CHIP_NAME;
    const build = selectManifestBuild(manifest, chipFamily, port.getInfo());
    if (!build) throw errorWithName("UnsupportedChipError",
      chipFamily ? `${chipFamily} is not supported by this firmware.` : "The ESP chip could not be identified.");
    await requireOfficialFlashCapacity(loader);
    operation.guard();
    report({ stage: "preparing", percentage: 0, message: "Loading firmware" });
    const fileArray = await fetchFirmwareParts(build, offer, fetchImpl);
    operation.guard();
    if (eraseFirst) {
      report({ stage: "erasing", percentage: 0, message: "Erasing flash" });
      await loader.eraseFlash();
      operation.guard();
    }
    report({ stage: "writing", percentage: 0, message: "Writing firmware" });
    await loader.writeFlash({
      fileArray, flashSize: "keep", flashMode: "keep", flashFreq: "keep",
      eraseAll: false, compress: true,
      reportProgress(fileIndex, written, total) {
        if (!operation.cancelled && operation.foreground) onState({
          stage: "writing", percentage: combinedProgress(fileArray, fileIndex, written, total), message: "Writing firmware"
        });
      }
    });
    operation.guard();
    report({ stage: "restarting", percentage: 100, message: "Starting firmware" });
    if (!keepOpen) await loader.after("hard_reset");
    operation.guard();
    completed = true;
    return { chipFamily, build };
  }, (operation) => settleTransport(port, transport, loader,
    !completed || (keepOpen && operation.cancelled) ? { reset: "hard_reset" } : { keepOpen }), onOwnership);
  return awaitPortOperation(state, DEVICE_FLASH_TIMEOUT_MS,
    errorWithName("DeviceFlashTimeoutError", "Firmware installation timed out."));
}

export function attachWebInstaller({
  root,
  serial,
  TransportCtor,
  ESPLoaderCtor,
  fetchImpl = fetch,
  cryptoImpl = globalThis.crypto,
  manifestPath = "manifest.json",
  SerialPortCtor = globalThis.SerialPort,
  followLog = true, // open the live log after connecting and after installing
  trace = false, // also log esptool-js's packet trace (diagnostics; the page enables it with ?trace)
  channel = "" // feed shown next to the version: "development" or "release"
}) {
  if (!root) throw new Error("The installer root is missing.");

  const element = (id) => root.querySelector(`#${id}`);
  const connectButton = element("connect-button");
  const disconnectButton = element("disconnect-button");
  const resetButton = element("reset-button");
  const flashButton = element("flash-button");
  const cleanFlashButton = element("clean-flash-button");
  const monitorOutput = element("serial-monitor-output");
  const monitorLive = element("serial-monitor-live");
  const versionValue = element("firmware-version-value");
  const channelLabel = element("release-channel");
  const logPanel = element("serial-log");

  let generation = 0;
  let current = null;
  let foreground = null;
  let manifest = null;
  let offer = null;
  let expectedTable = null;
  let monitorPendingLine = "";
  // Connect pairs the chosen port (the chooser grants this page access); Disconnect unpairs it again.
  const canForget = supportsSerialForget(serial, SerialPortCtor);
  const serialSupported = Boolean(
    serial && typeof serial.requestPort === "function" && globalThis.isSecureContext
  );

  // With tracing, esptool-js's transport reports every packet; the trace goes to the log, not the console.
  const traceStarted = Date.now();
  const LoggedTransport = trace ? class extends TransportCtor {
    trace(message) { appendWholeLines(`TRACE +${Date.now() - traceStarted} ms ${message}`, "info"); }
  } : TransportCtor;

  const appendRenderedMonitorLine = ({ text, terminated }, level = serialLogLevel(text)) => {
    const line = monitorOutput.ownerDocument.createElement("span");
    line.className = `installer-monitor-line installer-monitor-line-${level}`;
    line.textContent = `${stripSerialAnsi(text)}${terminated ? "\n" : ""}`;
    monitorOutput.append(line);
  };

  // Everything the page reports goes to the log; installer lines carry a time stamp and are rendered
  // whole, so a device line that is still incomplete cannot absorb them.
  function appendWholeLines(text, level) {
    // An unfinished device or esptool line, such as "Connecting....", is shown as it stands first.
    if (monitorPendingLine) {
      appendRenderedMonitorLine({ text: monitorPendingLine.replace(/\r$/, ""), terminated: true });
      monitorPendingLine = "";
    }
    for (const line of text.split("\n")) appendRenderedMonitorLine({ text: line, terminated: true }, level);
    settleMonitor();
  }
  // The log slides out while a device is linked and back in on Disconnect or unplug. A warning or
  // error slides it out as well, so neither is ever hidden; plain status lines may land in a closed log.
  const showLog = (open) => {
    root.dataset.log = open ? "open" : "closed";
    if (!logPanel) return;
    logPanel.setAttribute("aria-hidden", open ? "false" : "true");
    // A closed log keeps no keyboard focus, even where Chrome makes an overflowing scroller focusable.
    logPanel.inert = !open;
  };
  const appendStatusLine = (message, level = "status") => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    appendWholeLines(`[${time}] ${message}`, level);
    if (level === "warning" || level === "error") showLog(true);
  };

  const appendMonitor = (text, { flush = false } = {}) => {
    if (!text && !flush) return;
    const parsed = splitSerialChunk(monitorPendingLine, text, flush);
    monitorPendingLine = parsed.pending;
    // Log text is untrusted: it is rendered as plain text and never interpreted.
    for (const line of parsed.lines) appendRenderedMonitorLine(line);
    settleMonitor();
  };

  // The log follows new lines only while it is scrolled to its end. Scrolling up holds the view
  // until the user scrolls back down to the end.
  let logAtEnd = true;
  monitorOutput.addEventListener("scroll", () => {
    logAtEnd = monitorOutput.scrollHeight - monitorOutput.scrollTop - monitorOutput.clientHeight <= LOG_END_SLACK_PX;
  });
  function settleMonitor() {
    if (monitorOutput.textContent.length + monitorPendingLine.length > MAX_MONITOR_CHARS) {
      // Trim in batches so a busy UART does not force a full DOM rebuild on every following chunk.
      const keep = Math.floor(MAX_MONITOR_CHARS * 0.8);
      const retained = `${monitorOutput.textContent}${stripSerialAnsi(monitorPendingLine)}`.slice(-keep);
      const heightBefore = monitorOutput.scrollHeight;
      monitorOutput.replaceChildren();
      const reparsed = splitSerialChunk("", retained);
      monitorPendingLine = reparsed.pending;
      reparsed.lines.forEach((line) => appendRenderedMonitorLine(line));
      // A held view keeps showing the same lines although older ones above it were dropped.
      if (!logAtEnd) monitorOutput.scrollTop = Math.max(0, monitorOutput.scrollTop - (heightBefore - monitorOutput.scrollHeight));
    }
    if (logAtEnd) monitorOutput.scrollTop = monitorOutput.scrollHeight;
  }

  // Flash progress fills the button that started the installation; no other control shows it.
  const setProgress = (button, percentage) => {
    for (const control of [flashButton, cleanFlashButton]) {
      if (control === button) continue;
      delete control.dataset.progress;
      control.style.removeProperty("--progress");
    }
    if (!button) return;
    const value = Math.min(100, Math.max(0, Math.round(percentage || 0)));
    button.dataset.progress = String(value);
    button.style.setProperty("--progress", `${value}%`);
  };

  const isCurrent = (session) => Boolean(session && current === session && generation === session.id);
  const syncControls = () => {
    const connected = Boolean(current?.compatible);
    const lease = current && serialPortLease(current.port);
    const monitorSelected = Boolean(current?.monitor && lease === current.monitor.lease);
    const monitorOwns = Boolean(monitorSelected && lease.phase === "monitor" &&
      current.monitor.readyFinished && !current.monitor.cancelled);
    const nativePending = Boolean(lease && lease.phase !== "quarantined" && !monitorOwns);
    const busy = Boolean(foreground) || nativePending;
    // Device actions may take the port over from the live log, never from a pending or quarantined
    // native operation. Unavailable controls are greyed out; Connect and Disconnect share one place.
    const portReady = connected && !busy && !(lease && !monitorOwns);
    const linked = connected || foreground?.kind === "probe";
    connectButton.hidden = linked;
    connectButton.disabled = !offer || !expectedTable || !serialSupported || Boolean(foreground);
    disconnectButton.hidden = !linked;
    disconnectButton.disabled = foreground?.kind === "flash";
    resetButton.hidden = false;
    resetButton.disabled = !portReady;
    // Other firmware or another partition layout leaves no data worth keeping: only Clean flash remains.
    const eraseRequired = Boolean(connected && !current.device?.updatable);
    flashButton.hidden = eraseRequired;
    flashButton.disabled = !portReady || eraseRequired;
    cleanFlashButton.hidden = false;
    cleanFlashButton.disabled = !portReady;
    root.dataset.busy = busy ? "true" : "false";
    root.dataset.ownership = lease?.phase || "idle";
    root.setAttribute?.("aria-busy", busy ? "true" : "false");
    for (const [button, kind] of [[connectButton, "probe"], [flashButton, "flash"], [cleanFlashButton, "flash"], [resetButton, "monitor"]]) {
      button.setAttribute("aria-busy", foreground?.kind === kind || (nativePending && lease.kind === kind) ? "true" : "false");
    }
  };
  subscribeSerialOwnership(syncControls);
  const captureOwnership = (session) => (operation) => {
    session.operation = operation;
    operation.settled.then(() => {
      if (session.operation === operation) session.operation = null;
      syncControls();
    });
    syncControls();
  };
  const setDisconnected = () => {
    root.dataset.connected = "false";
    root.dataset.flashing = "false";
    root.dataset.finished = "false";
    monitorLive.textContent = "Stopped";
    monitorLive.dataset.state = "stopped";
    setProgress(null);
    syncControls();
  };
  // Stopping the log closes the port, unless an install takes it over (`keepOpen`).
  const stopMonitor = async ({ session = current, keepOpen = false } = {}) => {
    const operation = session?.monitor;
    if (!operation) return;
    operation.keepOpen = keepOpen;
    operation.cancel();
    if (isCurrent(session)) {
      monitorLive.textContent = "Closing";
      monitorLive.dataset.state = "closing";
      syncControls();
    }
    let outcome;
    try {
      outcome = await withTimeout(operation.settled, TRANSPORT_CLEANUP_TIMEOUT_MS,
        errorWithName("SerialCleanupTimeoutError", "Serial monitor cleanup timed out."));
    } catch (error) { throw cleanupFailure(error, new Error("Native monitor open, reset or cleanup is still pending."), operation.port); }
    if (outcome.cleanupError) throw cleanupFailure(outcome.error, outcome.cleanupError, operation.port);
    if (outcome.error && outcome.error.name !== "SerialOperationCancelledError") throw outcome.error;
    if (isCurrent(session)) {
      monitorLive.textContent = "Stopped";
      monitorLive.dataset.state = "stopped";
      syncControls();
    }
  };
  const disconnect = async () => {
    const session = current;
    const previousForeground = foreground;
    const disconnectGeneration = ++generation;
    current = null;
    foreground = null;
    monitorPendingLine = "";
    session?.operation?.cancel();
    previousForeground?.operation?.cancel();
    setDisconnected();
    showLog(false);
    if (!session) return;
    try {
      if (session.monitor) await stopMonitor({ session });
      else if (session.operation) {
        const outcome = await withTimeout(session.operation.settled, TRANSPORT_CLEANUP_TIMEOUT_MS,
          errorWithName("SerialCleanupTimeoutError", "Serial cleanup is still pending."));
        if (outcome.cleanupError) throw cleanupFailure(outcome.error, outcome.cleanupError, session.port);
      }
      // A port handed on by a check or install that the log never took: the chip may still run the
      // flasher, so start the firmware, then close the port.
      const port = session.port;
      if (serialPortIsOpen(port) && !serialPortLease(port)) {
        const lease = acquireSerialPortLease(port, "close");
        try {
          try { await resetToUserFirmware(port); } catch (_error) { /* a lost device cannot be reset */ }
          await port.close();
        } finally {
          if (serialPortIsOpen(port)) updateSerialPortLease(lease, "quarantined");
          else releaseSerialPortLease(lease);
        }
      }
    } catch (error) {
      if (!current && generation === disconnectGeneration) appendStatusLine(`Disconnect: ${errorMessage(error)}`, "error");
    }
  };
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    promise.catch(() => {});
    return { promise, resolve, reject };
  };
  const startMonitor = async () => {
    const session = current;
    if (!session?.compatible || foreground || session.monitor || serialPortLease(session.port)) return;
    const port = session.port;
    const token = { kind: "monitor", session };
    foreground = token;
    const readyMonitor = deferred();
    const stop = deferred();
    let reader;
    let readerAttached = false;
    let loop;
    let cancelReader;
    let loopError;
    const cancelCapturedReader = () => {
      if (readerAttached && !cancelReader) {
        cancelReader = Promise.resolve().then(() => { if (readerAttached) return reader.cancel(); });
        cancelReader.catch(() => {});
      }
    };
    let operation;
    try {
      operation = ownPortOperation(port, "monitor", async (owned) => {
        owned.guard();
        // Usually the check or install hands the port over open; the log opens it only on its own.
        if (!serialPortIsOpen(port)) await port.open({ baudRate: 115200, ...ESPTOOL_SERIAL_OPTIONS });
        owned.guard();
        if (!isCurrent(session)) throw errorWithName("SerialOperationCancelledError", "Monitor selection changed.");
        if (!port.readable) throw new Error("The serial input stream is unavailable.");
        reader = port.readable.getReader();
        readerAttached = true;
        const decoder = new TextDecoder();
        loop = (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (owned.cancelled || !isCurrent(session)) break;
              if (done) break;
              appendMonitor(decoder.decode(value, { stream: true }));
            }
            if (!owned.cancelled && isCurrent(session)) appendMonitor(decoder.decode(), { flush: true });
          } catch (error) { loopError = error; }
          finally {
            try { reader.releaseLock(); readerAttached = false; } catch (error) { loopError ||= error; }
            stop.resolve();
          }
        })();
        appendStatusLine("Reset to firmware");
        await resetToUserFirmware(port, sleep, () => owned.guard());
        owned.guard();
        owned.readyFinished = true;
        readyMonitor.resolve();
        await stop.promise;
        if (loopError) throw loopError;
      }, async (owned) => {
        let error;
        cancelCapturedReader();
        if (cancelReader) { try { await cancelReader; } catch (failure) { error = failure; } }
        if (loop) { try { await loop; } catch (failure) { error ||= failure; } }
        if (owned.keepOpen) return { released: !port.readable?.locked, error };
        if (serialPortIsOpen(port)) {
          try { await port.close(); } catch (failure) { return { released: false, error: error || failure }; }
        }
        return { released: !serialPortIsOpen(port), error };
      }, captureOwnership(session));
      token.operation = operation;
      session.monitor = operation;
      operation.onCancel = () => { stop.resolve(); cancelCapturedReader(); };
      operation.settled.then((outcome) => {
        readyMonitor.reject(outcome.error || outcome.cleanupError || new Error("The serial monitor stopped before it was ready."));
        if (!isCurrent(session) || session.monitor !== operation) return;
        const error = outcome.cleanupError ? cleanupFailure(outcome.error, outcome.cleanupError, port) :
          outcome.error?.name !== "SerialOperationCancelledError" ? outcome.error : null;
        monitorLive.textContent = error ? "Error" : "Stopped";
        monitorLive.dataset.state = error ? "error" : "stopped";
        if (error) appendStatusLine(`Monitor stopped: ${errorMessage(error)}`, "error");
        if (!serialPortLease(port)) session.monitor = null;
        syncControls();
      });
      monitorLive.textContent = "Connecting";
      monitorLive.dataset.state = "connecting";
      syncControls();
      await withTimeout(Promise.race([readyMonitor.promise, operation.cancellation]), DEVICE_PROBE_TIMEOUT_MS,
        errorWithName("MonitorOpenTimeoutError", "Opening the serial monitor timed out."));
      if (!isCurrent(session) || operation.cancelled || session.monitor !== operation ||
          serialPortLease(port) !== operation.lease || operation.lease.phase !== "monitor") return;
      monitorLive.textContent = "Live";
      monitorLive.dataset.state = "live";
      appendStatusLine("Monitor 115200 baud");
    } catch (error) {
      operation?.cancel(error);
      const reported = operation && !operation.bodyFinished
        ? cleanupFailure(error, new Error("Native monitor open or reset is still pending."), port) : error;
      if (isCurrent(session)) {
        monitorLive.textContent = "Error";
        monitorLive.dataset.state = "error";
        appendStatusLine(`Monitor failed: ${errorMessage(reported)}`, "error");
      }
    } finally {
      if (operation) operation.foreground = false;
      if (foreground === token) foreground = null;
      syncControls();
    }
  };
  // Connect always asks with the browser's chooser; `paired` is a port the browser already lists as
  // paired, reconnected without asking (see reconnectPaired), which may leave a busy port unlogged.
  const connect = async ({ paired = null, quietBusy = false } = {}) => {
    if (!serialSupported || !offer || !expectedTable || foreground || current?.compatible) return;
    const token = { id: ++generation, kind: "probe", session: null };
    foreground = token;
    current = null;
    monitorPendingLine = "";
    setDisconnected();
    let session = null;
    let result;
    try {
      const port = paired || await serial.requestPort();
      if (foreground !== token || generation !== token.id) return;
      session = { id: token.id, port, compatible: false, device: null, monitor: null, operation: null };
      current = session;
      token.session = session;
      showLog(true);
      syncControls();
      result = await probeDevice({
        port, manifest, expectedPartitionTable: expectedTable, TransportCtor: LoggedTransport, ESPLoaderCtor, trace,
        keepOpen: followLog,
        onOpened: () => { if (isCurrent(session)) appendStatusLine(paired ? "Probe (paired port)" : "Probe"); },
        onOwnership: (operation) => { token.operation = operation; captureOwnership(session)(operation); },
        onLog: (text) => { if (isCurrent(session)) appendMonitor(text); },
        onStep: (message) => { if (isCurrent(session)) appendStatusLine(message); }
      });
      if (!isCurrent(session) || foreground !== token) return;
      const { installed } = result;
      // Only a device known to hold other firmware or NVS elsewhere forces Clean flash; an unread
      // device keeps both choices. A table read before a failed app read still decides on NVS.
      const unknown = Boolean(installed?.error) && installed?.nvsMatches !== false;
      session.compatible = true;
      session.device = {
        chipFamily: result.chipFamily, flashSize: result.flashSize, mac: result.mac,
        firmware: installed?.firmware || null, unknown,
        updatable: unknown || Boolean(installed?.nvsMatches && installed.firmware?.project === manifest.name)
      };
      root.dataset.connected = "true";
      if (installed?.error) {
        const nvs = installed.nvsMatches === false ? "; NVS elsewhere" : installed.nvsMatches ? "; NVS layout matches" : "";
        appendStatusLine(`Installed firmware unknown: ${installed.error}${nvs}`, "warning");
      } else {
        const firmware = installed?.firmware?.project
          ? `${installed.firmware.project} ${installed.firmware.version} (${installed.slot})` : "none";
        const table = installed?.layoutMatches ? "matches" : installed?.nvsMatches ? "differs; NVS layout matches" : "differs";
        appendStatusLine(`Installed: ${firmware}; partition table ${table}`);
      }
      if (!session.device.updatable) appendStatusLine("Clean flash required", "warning");
    } catch (error) {
      if (foreground !== token || generation !== token.id) return;
      setDisconnected();
      if (error?.name === "NotFoundError") appendStatusLine("No port selected");
      else if (isOpenFailure(error)) {
        if (!quietBusy) {
          appendStatusLine(paired ? "Paired port busy (open in another tab or program)" : "Probe failed: port busy (open in another tab or program)",
            paired ? "warning" : "error");
        }
        return PORT_BUSY;
      } else appendStatusLine(`Probe failed: ${errorMessage(error)}`, "error");
      return;
    } finally {
      if (foreground === token) foreground = null;
      syncControls();
    }
    if (followLog && isCurrent(session)) await startMonitor();
    return result;
  };
  // Restarts the firmware and follows its boot from the first line: the live log keeps its port and
  // only the reset line is pulsed; without a live log, starting one resets the firmware.
  const reset = async () => {
    const session = current;
    if (!session?.compatible || foreground) return;
    const monitor = session.monitor;
    const lease = serialPortLease(session.port);
    if (!monitor || lease !== monitor.lease || lease.phase !== "monitor" || !monitor.readyFinished || monitor.cancelled) {
      if (!monitor) await startMonitor();
      return;
    }
    const token = { kind: "monitor", session, operation: monitor };
    foreground = token;
    syncControls();
    try {
      appendStatusLine("Reset to firmware");
      await resetToUserFirmware(session.port, sleep, () => monitor.guard());
    } catch (error) {
      if (isCurrent(session) && !monitor.cancelled) appendStatusLine(`Reset failed: ${errorMessage(error)}`, "error");
    } finally {
      if (foreground === token) foreground = null;
      syncControls();
    }
  };
  const install = async ({ eraseFirst = false } = {}) => {
    const session = current;
    if (!session?.compatible || !offer || foreground) return;
    if (!eraseFirst && !session.device?.updatable) {
      appendStatusLine("Flash refused: Clean flash required", "error");
      syncControls();
      return;
    }
    const selectedOffer = offer;
    const { name, version } = selectedOffer.manifest;
    const token = { kind: "flash", session };
    const progressButton = eraseFirst ? cleanFlashButton : flashButton;
    foreground = token;
    syncControls();
    let installed = false;
    try {
      await stopMonitor({ session, keepOpen: true });
      if (!isCurrent(session) || foreground !== token) return;
      root.dataset.flashing = "true";
      root.dataset.finished = "false";
      // The flasher, not the log, owns the port now; its lines still stream into the log.
      monitorLive.textContent = "Flashing";
      monitorLive.dataset.state = "flashing";
      setProgress(progressButton, 0);
      appendStatusLine(eraseFirst ? `Clean flash ${version}: erase all` : `Flash ${version}: NVS kept`);
      await flashDevice({
        port: session.port, offer: selectedOffer, eraseFirst, TransportCtor: LoggedTransport, ESPLoaderCtor, fetchImpl, trace,
        keepOpen: followLog,
        onOwnership: (operation) => { token.operation = operation; captureOwnership(session)(operation); },
        onLog: (text) => { if (isCurrent(session)) appendMonitor(text); },
        onState: (state) => { if (isCurrent(session)) setProgress(progressButton, state.percentage); }
      });
      if (!isCurrent(session) || foreground !== token) return;
      root.dataset.flashing = "false";
      root.dataset.finished = "true";
      Object.assign(session.device, { firmware: { project: name, version }, unknown: false, updatable: true });
      setProgress(null);
      appendStatusLine(`Installed ${version}`);
      installed = true;
    } catch (error) {
      if (!isCurrent(session) || foreground !== token) return;
      root.dataset.flashing = "false";
      root.dataset.finished = "false";
      setProgress(null);
      appendStatusLine(`Flash failed: ${errorMessage(error)}`, "error");
    } finally {
      if (isCurrent(session) && monitorLive.dataset.state === "flashing") {
        monitorLive.textContent = "Stopped";
        monitorLive.dataset.state = "stopped";
      }
      if (foreground === token) foreground = null;
      syncControls();
    }
    // Follow the new firmware's boot, which names the setup network after a Clean flash.
    if (installed && followLog && isCurrent(session)) await startMonitor();
  };
  // The Disconnect button also unpairs: after the port is closed, the browser forgets this page's
  // permission, so the next Connect asks again. Unplugging the device only disconnects.
  const portReleased = (port) => new Promise((resolve) => {
    if (!serialPortLease(port)) return resolve();
    let timer;
    const unsubscribe = subscribeSerialOwnership(() => {
      if (serialPortLease(port)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
    timer = setTimeout(() => { unsubscribe(); resolve(); }, PORT_RELEASE_WAIT_MS);
  });
  const disconnectAndUnpair = async () => {
    const port = current?.port;
    await disconnect();
    if (!port || !canForget) return;
    await portReleased(port);
    try {
      await forgetSerialPort(serial, port, { controller: { isReleaseBlocked: () => Boolean(foreground) } });
      appendStatusLine("Port unpaired");
    } catch (error) {
      const feedback = releaseFeedback(error);
      appendStatusLine(feedback.kind === "error" ? `Unpair failed: ${feedback.message}` : `Unpair skipped: ${feedback.message}`,
        feedback.kind === "error" ? "error" : "status");
    }
  };
  // Paired means connected: after a reload or a replug, the one port the browser still lists as
  // paired is reconnected, so the button shows the browser's state. Several paired ports stay for
  // the chooser.
  // connect() ignores this while connected or busy; after a failed check, a replug tries again.
  const reconnectPaired = async () => {
    let ports = [];
    try {
      ports = typeof serial.getPorts === "function" ? Array.from(await serial.getPorts()) : [];
    } catch (_error) {
      return;
    }
    if (ports.length !== 1) return;
    const [port] = ports;
    // The check itself is the only open; a busy port is retried quietly and gets one log line.
    for (let attempt = 1; attempt <= PAIRED_OPEN_ATTEMPTS; attempt++) {
      if (current?.compatible || foreground || serialPortLease(port)) return;
      if (await connect({ paired: port, quietBusy: attempt < PAIRED_OPEN_ATTEMPTS }) !== PORT_BUSY) return;
      if (attempt < PAIRED_OPEN_ATTEMPTS) await sleep(PAIRED_OPEN_RETRY_MS);
    }
  };
  connectButton.addEventListener("click", () => connect());
  disconnectButton.addEventListener("click", disconnectAndUnpair);
  resetButton.addEventListener("click", reset);
  flashButton.addEventListener("click", () => install());
  cleanFlashButton.addEventListener("click", () => install({ eraseFirst: true }));
  if (typeof serial?.addEventListener === "function") {
    serial.addEventListener("connect", () => reconnectPaired());
    serial.addEventListener("disconnect", (event) => {
      const port = event.port || event.target;
      if (port === current?.port) {
        appendStatusLine("USB disconnected");
        return disconnect();
      }
    });
  }
  setDisconnected();
  if (!serialSupported) appendStatusLine("Web Serial unavailable (Chrome or Edge required)", "error");

  const manifestUrl = new URL(manifestPath, location.href).toString();
  const ready = loadFirmwareOffer({ manifestUrl, fetchImpl, cryptoImpl })
    .then(async (loadedOffer) => {
      // The offered partition table tells whether an installed layout can be updated in place.
      const table = await fetchOfferPart(loadedOffer, PARTITION_TABLE_PART, fetchImpl);
      offer = loadedOffer;
      manifest = offer.manifest;
      expectedTable = table;
      if (typeof manifest.version === "string" && manifest.version) {
        versionValue.textContent = manifest.version;
        if (channelLabel && (channel === "development" || channel === "release")) {
          channelLabel.textContent = channel;
          channelLabel.dataset.kind = channel;
        }
      }
      syncControls();
    })
    .catch((error) => {
      appendStatusLine(`Manifest error: ${errorMessage(error)}`, "error");
    });

  return {
    connect, reconnectPaired, disconnect, disconnectAndUnpair, reset, install, startMonitor, stopMonitor, ready,
    getSelectedPort: () => current?.port || null,
    isConnected: () => Boolean(current?.compatible)
  };
}
