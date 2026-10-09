const ESPRESSIF_USB_VENDOR_ID = 0x303a;
const CDC_PRODUCT_IDS = new Set([0x0002, 0x0003, 0x1001, 0x1002, 0x1003]);
const MAX_MONITOR_CHARS = 100000;
const DEVICE_PROBE_TIMEOUT_MS = 10000;
const TRANSPORT_CLEANUP_TIMEOUT_MS = 2000;
const ANSI_CONTROL_SEQUENCE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/;
const MAX_BINARY_BYTES = 0x800000;
const FIRMWARE_DOWNLOAD_TIMEOUT_MS = 30000;
const FLASH_SECTOR_BYTES = 0x1000;
// Mirrors the official partitions.csv; the publisher derives its bounds from that file.
const OFFICIAL_FLASH_PARTS = Object.freeze([
  { path: "daikin-altherma-esp32-web-bootloader.bin", offset: 0, end: 0x8000 },
  { path: "daikin-altherma-esp32-web-partition-table.bin", offset: 0x8000, end: 0x9000 },
  { path: "daikin-altherma-esp32-web-ota_data_initial.bin", offset: 0xf000, end: 0x11000 },
  { path: "daikin-altherma-esp32.bin", offset: 0x20000, end: 0x210000 }
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

async function settleTransport(transport, loader, resetMode, timeoutMs = TRANSPORT_CLEANUP_TIMEOUT_MS) {
  if (resetMode && loader && loader.chip && typeof loader.after === "function") {
    try {
      await withTimeout(loader.after(resetMode), timeoutMs, new Error("Device reset timed out."));
    } catch (_error) {
      // Cleanup still has to close the port if a reset signal is not supported by the adapter.
    }
  }
  if (transport && typeof transport.disconnect === "function") {
    try {
      await withTimeout(transport.disconnect(), timeoutMs, new Error("Serial cleanup timed out."));
    } catch (_error) {
      // The device can disappear during its reset. In that case the browser already closed it.
    }
  }
}

export async function resetToUserFirmware(port, delay = sleep) {
  if (!port || typeof port.setSignals !== "function") {
    throw new Error("This serial adapter cannot reset the ESP automatically.");
  }

  // Keep IO0 high while EN is pulsed low, then release EN. This is the same
  // firmware-mode reset used by ESPConnect and avoids leaving the chip in the
  // flasher stub after the compatibility probe.
  await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  await delay(100);
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await delay(250);
}

export async function resetConnectedDevice(port, { keepOpen = false, delay = sleep } = {}) {
  if (!port) throw new Error("No serial device is connected.");
  const wasOpen = Boolean(port.readable || port.writable);

  if (!wasOpen) await port.open({ baudRate: 115200, bufferSize: 8192 });
  try {
    await resetToUserFirmware(port, delay);
  } finally {
    if (!wasOpen && !keepOpen && (port.readable || port.writable)) await port.close();
  }
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
    if (part.path === "daikin-altherma-esp32.bin" && entry.sha256 !== appSha256) {
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

async function requireOfficialFlashCapacity(loader) {
  const flashSize = typeof loader.detectFlashSize === "function" ? await loader.detectFlashSize() : undefined;
  // These are the >=8 MB values returned by the pinned esptool-js detectFlashSize API.
  if (!["8MB", "16MB", "32MB", "64MB", "128MB", "256MB"].includes(flashSize)) {
    throw errorWithName("UnsupportedFlashSizeError", "This firmware needs an ESP32-S3 with at least 8 MB of detected flash. Flash capacity could not be confirmed or is too small.");
  }
  return flashSize;
}

export async function probeDevice({
  port,
  manifest,
  TransportCtor,
  ESPLoaderCtor,
  onLog = () => {},
  timeoutMs = DEVICE_PROBE_TIMEOUT_MS,
  cleanupTimeoutMs = TRANSPORT_CLEANUP_TIMEOUT_MS
}) {
  const transport = new TransportCtor(port);
  const loader = new ESPLoaderCtor({
    transport,
    baudrate: 115200,
    terminal: terminalAdapter(onLog),
    debugLogging: false,
    enableTracing: false
  });
  try {
    return await withTimeout((async () => {
      await loader.main();
      if (typeof loader.flashId === "function") await loader.flashId();
      const chipFamily = loader.chip && loader.chip.CHIP_NAME;
      if (!chipFamily) throw errorWithName("ChipDetectionError", "The connected ESP chip could not be identified.");
      const build = selectManifestBuild(manifest, chipFamily, port.getInfo());
      if (!build) {
        throw errorWithName("UnsupportedChipError", `${chipFamily} is not supported by this firmware.`);
      }
      const flashSize = await requireOfficialFlashCapacity(loader);
      return { chipFamily, flashSize, build };
    })(), timeoutMs, errorWithName(
      "DeviceProbeTimeoutError",
      "The serial device did not answer in flashing mode. Select an ESP32-S3 USB port; if it is an ESP32-S3, hold BOOT, tap RESET, then try again."
    ));
  } finally {
    // The compatibility probe runs the flasher stub. Explicitly hand control
    // back to the installed application before releasing the serial port. A
    // partially failed loader.main() can already have started the stub; the
    // cleanup helper resets only after esptool-js has identified a chip.
    await settleTransport(transport, loader, "hard_reset", cleanupTimeoutMs);
  }
}

export async function flashDevice({
  port,
  offer,
  eraseFirst,
  TransportCtor,
  ESPLoaderCtor,
  fetchImpl = fetch,
  onState = () => {},
  onLog = () => {}
}) {
  requireOffer(offer);
  const manifest = offer.manifest;
  const transport = new TransportCtor(port);
  const loader = new ESPLoaderCtor({
    transport,
    baudrate: 115200,
    terminal: terminalAdapter(onLog),
    debugLogging: false,
    enableTracing: false
  });
  let completed = false;

  try {
    onState({ stage: "connecting", percentage: 0, message: "Checking device" });
    await loader.main();
    if (typeof loader.flashId === "function") await loader.flashId();

    const chipFamily = loader.chip && loader.chip.CHIP_NAME;
    const build = selectManifestBuild(manifest, chipFamily, port.getInfo());
    if (!build) {
      throw errorWithName(
        "UnsupportedChipError",
        chipFamily ? `${chipFamily} is not supported by this firmware.` : "The ESP chip could not be identified."
      );
    }
    await requireOfficialFlashCapacity(loader);

    onState({ stage: "preparing", percentage: 0, message: "Loading firmware" });
    const fileArray = await fetchFirmwareParts(build, offer, fetchImpl);

    if (eraseFirst) {
      onState({ stage: "erasing", percentage: 0, message: "Erasing flash" });
      await loader.eraseFlash();
    }

    onState({ stage: "writing", percentage: 0, message: "Writing firmware" });
    await loader.writeFlash({
      fileArray,
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: false,
      compress: true,
      reportProgress(fileIndex, written, total) {
        onState({
          stage: "writing",
          percentage: combinedProgress(fileArray, fileIndex, written, total),
          message: "Writing firmware"
        });
      }
    });

    onState({ stage: "restarting", percentage: 100, message: "Starting firmware" });
    await loader.after("hard_reset");
    completed = true;
    return { chipFamily, build };
  } finally {
    await settleTransport(transport, loader, completed ? undefined : "hard_reset");
  }
}

export function attachWebInstaller({
  root,
  serial,
  TransportCtor,
  ESPLoaderCtor,
  fetchImpl = fetch,
  cryptoImpl = globalThis.crypto,
  manifestPath = "manifest.json"
}) {
  if (!root) throw new Error("The installer root is missing.");

  const element = (id) => root.querySelector(`#${id}`);
  const connectButton = element("connect-button");
  const disconnectButton = element("disconnect-button");
  const resetButton = element("reset-button");
  const installButton = element("install-button");
  const monitorButton = element("serial-monitor-button");
  const connectionLabel = element("connection-label");
  const deviceValue = element("device-value");
  const connectionValue = element("connection-value");
  const compatibilityValue = element("compatibility-value");
  const monitor = element("serial-monitor");
  const monitorOutput = element("serial-monitor-output");
  const monitorLive = element("serial-monitor-live");
  const progressStage = element("progress-stage");
  const progressPercent = element("progress-percent");
  const progressTrack = element("progress-track");
  const progressFill = element("progress-fill");
  const pageStatus = element("page-status");
  const unsupported = element("serial-unsupported");
  const versionLine = element("firmware-version");
  const versionValue = element("firmware-version-value");
  const steps = Array.from(root.querySelectorAll(".installer-step"));

  let selectedPort = null;
  let manifest = null;
  let offer = null;
  let monitorReader = null;
  let monitorLoop = null;
  let monitorPendingLine = "";
  let busy = false;
  const serialSupported = Boolean(
    serial && typeof serial.requestPort === "function" && globalThis.isSecureContext
  );

  const setPageStatus = (message, kind = "info") => {
    pageStatus.hidden = !message;
    pageStatus.dataset.kind = kind;
    pageStatus.textContent = message || "";
  };

  const appendRenderedMonitorLine = ({ text, terminated }) => {
    const line = monitorOutput.ownerDocument.createElement("span");
    const level = serialLogLevel(text);
    line.className = `installer-monitor-line installer-monitor-line-${level}`;
    line.textContent = `${stripSerialAnsi(text)}${terminated ? "\n" : ""}`;
    monitorOutput.append(line);
  };

  const appendMonitor = (text, { flush = false } = {}) => {
    if (!text && !flush) return;
    const parsed = splitSerialChunk(monitorPendingLine, text, flush);
    monitorPendingLine = parsed.pending;
    parsed.lines.forEach(appendRenderedMonitorLine);

    if (monitorOutput.textContent.length + monitorPendingLine.length > MAX_MONITOR_CHARS) {
      // Trim in batches so a busy UART does not force a full DOM rebuild on every following chunk.
      const keep = Math.floor(MAX_MONITOR_CHARS * 0.8);
      const retained = `${monitorOutput.textContent}${stripSerialAnsi(monitorPendingLine)}`.slice(-keep);
      monitorOutput.replaceChildren();
      const reparsed = splitSerialChunk("", retained);
      monitorPendingLine = reparsed.pending;
      reparsed.lines.forEach(appendRenderedMonitorLine);
    }
    monitorOutput.scrollTop = monitorOutput.scrollHeight;
  };

  const appendStatusLine = (message) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    appendMonitor(`[${time}] ${message}\n`);
  };

  const markSteps = (activeStep) => {
    steps.forEach((step, index) => {
      const number = index + 1;
      step.dataset.state = number < activeStep ? "done" : number === activeStep ? "active" : "";
    });
  };

  const setProgress = (message, percentage) => {
    const value = Math.min(100, Math.max(0, Math.round(percentage || 0)));
    progressStage.textContent = message;
    progressPercent.textContent = `${value}%`;
    progressTrack.setAttribute("aria-valuenow", String(value));
    progressFill.style.width = `${value}%`;
  };

  const closePort = async () => {
    if (!selectedPort || (!selectedPort.readable && !selectedPort.writable)) return;
    try {
      await withTimeout(
        selectedPort.close(),
        TRANSPORT_CLEANUP_TIMEOUT_MS,
        new Error("Closing the serial port timed out.")
      );
    } catch (_error) {
      // A USB reset or unplug can close the port before the page reaches cleanup.
    }
  };

  const stopMonitor = async ({ collapse = true } = {}) => {
    if (collapse) {
      root.dataset.monitor = "closed";
      monitorButton.setAttribute("aria-expanded", "false");
      monitor.setAttribute("aria-hidden", "true");
    }
    monitorLive.textContent = "Stopped";
    monitorLive.dataset.state = "stopped";

    const reader = monitorReader;
    const loop = monitorLoop;
    monitorReader = null;
    monitorLoop = null;
    if (reader) {
      try { await reader.cancel(); } catch (_error) {}
    }
    if (loop) {
      try { await loop; } catch (_error) {}
    }
    await closePort();
  };

  const startMonitor = async () => {
    if (!selectedPort || busy) return;
    root.dataset.monitor = "open";
    monitorButton.setAttribute("aria-expanded", "true");
    monitor.setAttribute("aria-hidden", "false");
    monitorLive.textContent = "Connecting";
    monitorLive.dataset.state = "connecting";

    try {
      await selectedPort.open({ baudRate: 115200, bufferSize: 8192 });
      if (!selectedPort.readable) throw new Error("The serial input stream is unavailable.");
      const reader = selectedPort.readable.getReader();
      const decoder = new TextDecoder();
      monitorReader = reader;

      monitorLoop = (async () => {
        try {
          while (monitorReader === reader) {
            const { value, done } = await reader.read();
            if (done) break;
            appendMonitor(decoder.decode(value, { stream: true }));
          }
          appendMonitor(decoder.decode(), { flush: true });
        } catch (error) {
          if (monitorReader === reader) appendStatusLine(`Serial monitor stopped: ${errorMessage(error)}`);
        } finally {
          try { reader.releaseLock(); } catch (_error) {}
          if (monitorReader === reader) monitorReader = null;
        }
      })();

      appendStatusLine("Resetting ESP32-S3 into normal firmware mode");
      try {
        await resetToUserFirmware(selectedPort);
      } catch (error) {
        appendStatusLine(`Automatic reset unavailable: ${errorMessage(error)} Press RESET once to see boot output.`);
      }

      monitorLive.textContent = "Live";
      monitorLive.dataset.state = "live";
      appendStatusLine("Serial monitor started at 115200 baud");
    } catch (error) {
      monitorLive.textContent = "Error";
      monitorLive.dataset.state = "error";
      appendStatusLine(`Could not open serial monitor: ${errorMessage(error)}`);
      await closePort();
    }
  };

  const setDisconnected = () => {
    root.dataset.connected = "false";
    root.dataset.flashing = "false";
    root.dataset.finished = "false";
    connectionLabel.textContent = "Not connected";
    connectButton.disabled = !manifest || !serialSupported;
    disconnectButton.disabled = true;
    resetButton.disabled = true;
    installButton.disabled = true;
    monitorButton.disabled = true;
    deviceValue.textContent = "—";
    connectionValue.textContent = "Serial Monitor";
    compatibilityValue.textContent = "—";
    setProgress("Preparing", 0);
    markSteps(1);
  };

  const disconnect = async () => {
    busy = false;
    await stopMonitor();
    await closePort();
    selectedPort = null;
    setDisconnected();
    setPageStatus("", "info");
  };

  const connect = async () => {
    if (!serial || typeof serial.requestPort !== "function" || !manifest || busy) return;
    busy = true;
    connectButton.disabled = true;
    setPageStatus("Select the ESP32-S3 USB port in the browser dialog.");

    try {
      const port = await serial.requestPort();
      selectedPort = port;
      connectionLabel.textContent = "Checking device…";
      setPageStatus("Checking chip and firmware compatibility…");
      appendStatusLine("USB port selected; checking device");
      const result = await probeDevice({
        port,
        manifest,
        TransportCtor,
        ESPLoaderCtor,
        onLog: appendMonitor
      });
      const info = port.getInfo ? port.getInfo() : {};
      deviceValue.textContent = result.chipFamily;
      connectionValue.textContent = describeSerialConnection(info);
      compatibilityValue.textContent = "Suitable";
      root.dataset.connected = "true";
      connectionLabel.textContent = `${result.chipFamily} connected`;
      disconnectButton.disabled = false;
      resetButton.disabled = false;
      installButton.disabled = !manifest;
      monitorButton.disabled = false;
      markSteps(2);
      setPageStatus("Device ready. Choose how the firmware should be installed.", "success");
      appendStatusLine(`${result.chipFamily} detected and compatible`);
    } catch (error) {
      await closePort();
      selectedPort = null;
      setDisconnected();
      if (error && error.name === "NotFoundError") {
        setPageStatus("No USB device was selected.");
      } else {
        setPageStatus(`Connection failed: ${errorMessage(error)}`, "error");
        appendStatusLine(`Connection failed: ${errorMessage(error)}`);
      }
    } finally {
      busy = false;
      if (selectedPort) connectButton.disabled = true;
    }
  };

  const install = async () => {
    if (!selectedPort || !offer || busy) return;
    const selectedOffer = offer;
    busy = true;
    await stopMonitor();
    root.dataset.flashing = "true";
    root.dataset.finished = "false";
    installButton.disabled = true;
    disconnectButton.disabled = true;
    resetButton.disabled = true;
    monitorButton.disabled = true;
    markSteps(3);
    setProgress("Checking device", 0);
    setPageStatus("Keep this page open and leave the USB cable connected.");
    appendStatusLine(`Firmware installation ${manifest.version || ""} started`);

    try {
      const eraseFirst = Boolean(root.querySelector('input[name="install-mode"]:checked')?.value === "erase");
      await flashDevice({
        port: selectedPort,
        offer: selectedOffer,
        eraseFirst,
        TransportCtor,
        ESPLoaderCtor,
        fetchImpl,
        onLog: appendMonitor,
        onState(state) {
          setProgress(state.message, state.percentage);
        }
      });
      root.dataset.flashing = "false";
      root.dataset.finished = "true";
      connectionLabel.textContent = "Restart complete";
      setProgress("Installation complete", 100);
      setPageStatus("Firmware installed successfully. The ESP32-S3 has restarted.", "success");
      appendStatusLine("Firmware installed successfully; device restarted");
      markSteps(4);
    } catch (error) {
      root.dataset.flashing = "false";
      root.dataset.finished = "false";
      setPageStatus(`Installation failed: ${errorMessage(error)}`, "error");
      appendStatusLine(`Installation failed: ${errorMessage(error)}`);
      markSteps(2);
    } finally {
      busy = false;
      const connected = Boolean(selectedPort && root.dataset.connected === "true");
      installButton.disabled = !connected;
      disconnectButton.disabled = !connected;
      resetButton.disabled = !connected;
      monitorButton.disabled = !connected;
    }
  };

  const resetDevice = async () => {
    if (!selectedPort || busy) return;
    busy = true;
    installButton.disabled = true;
    disconnectButton.disabled = true;
    resetButton.disabled = true;
    monitorButton.disabled = true;
    appendStatusLine("Manual device reset requested");
    setPageStatus("Resetting ESP32-S3…");

    try {
      await resetConnectedDevice(selectedPort, { keepOpen: Boolean(monitorReader) });
      setPageStatus("ESP32-S3 reset. The firmware is starting now.", "success");
      appendStatusLine("ESP32-S3 reset into normal firmware mode");
    } catch (error) {
      setPageStatus(`Reset failed: ${errorMessage(error)}`, "error");
      appendStatusLine(`Reset failed: ${errorMessage(error)}`);
    } finally {
      busy = false;
      const connected = Boolean(selectedPort && root.dataset.connected === "true");
      installButton.disabled = !connected;
      disconnectButton.disabled = !connected;
      resetButton.disabled = !connected;
      monitorButton.disabled = !connected;
    }
  };

  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", disconnect);
  resetButton.addEventListener("click", resetDevice);
  installButton.addEventListener("click", install);
  monitorButton.addEventListener("click", async () => {
    if (root.dataset.monitor === "open") await stopMonitor();
    else await startMonitor();
  });

  if (serial && typeof serial.addEventListener === "function") {
    serial.addEventListener("disconnect", async (event) => {
      if (selectedPort && (!event.target || event.target === selectedPort)) {
        appendStatusLine("USB device disconnected");
        await disconnect();
      }
    });
  }

  root.dataset.monitor = "closed";
  setDisconnected();

  if (!serialSupported) {
    connectButton.disabled = true;
    unsupported.hidden = false;
    setPageStatus("Web Serial needs Chrome or Edge on a secure desktop page.", "error");
  }

  const manifestUrl = new URL(manifestPath, location.href).toString();
  const ready = loadFirmwareOffer({ manifestUrl, fetchImpl, cryptoImpl })
    .then((loadedOffer) => {
      offer = loadedOffer;
      manifest = offer.manifest;
      if (typeof manifest.version === "string" && manifest.version) {
        versionValue.textContent = manifest.version;
        versionLine.hidden = false;
      }
      if (selectedPort && !busy) installButton.disabled = false;
      if (!selectedPort && !busy && serialSupported) connectButton.disabled = false;
    })
    .catch((error) => {
      setPageStatus(`Firmware metadata could not be loaded: ${errorMessage(error)}`, "error");
    });

  return { connect, disconnect, install, resetDevice, startMonitor, stopMonitor, ready };
}
