import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  combinedProgress,
  describeSerialConnection,
  detectedSerialType,
  fetchFirmwareParts,
  flashDevice,
  probeDevice,
  resetConnectedDevice,
  resetToUserFirmware,
  serialLogLevel,
  selectManifestBuild,
  splitSerialChunk,
  stripSerialAnsi
} from "../docs/web-installer.mjs";

const manifest = {
  version: "1.2.3",
  builds: [
    { chipFamily: "ESP32-S3", serialType: "cdc", parts: [{ path: "cdc.bin", offset: 0x1000 }] },
    { chipFamily: "ESP32-S3", serialType: "uart", parts: [{ path: "uart.bin", offset: 0x1000 }] },
    { chipFamily: "ESP32-C3", parts: [{ path: "fallback.bin", offset: 0 }] }
  ]
};

test("native Espressif USB ports select the CDC build and UART bridges select UART", () => {
  const cdcInfo = { usbVendorId: 0x303a, usbProductId: 0x1001 };
  const uartInfo = { usbVendorId: 0x1a86, usbProductId: 0x55d3 };

  assert.equal(detectedSerialType(cdcInfo), "cdc");
  assert.equal(detectedSerialType(uartInfo), "uart");
  assert.equal(describeSerialConnection(cdcInfo), "USB Serial/JTAG");
  assert.equal(describeSerialConnection(uartInfo), "USB UART");
  assert.equal(selectManifestBuild(manifest, "ESP32-S3", cdcInfo).serialType, "cdc");
  assert.equal(selectManifestBuild(manifest, "ESP32-S3", uartInfo).serialType, "uart");
  assert.equal(selectManifestBuild(manifest, "ESP32-C3", cdcInfo).parts[0].path, "fallback.bin");
  assert.equal(selectManifestBuild(manifest, "ESP32", cdcInfo), undefined);
});

test("multi-part progress is weighted by each uncompressed image size", () => {
  const files = [
    { data: new Uint8Array(4), address: 0 },
    { data: new Uint8Array(6), address: 4 }
  ];
  assert.equal(combinedProgress(files, 0, 2, 4), 20);
  assert.equal(combinedProgress(files, 1, 0, 6), 40);
  assert.equal(combinedProgress(files, 1, 3, 6), 70);
  assert.equal(combinedProgress(files, 1, 6, 6), 100);
});

test("firmware parts resolve relative to the manifest and preserve offsets", async () => {
  const seen = [];
  const parts = await fetchFirmwareParts(
    { parts: [{ path: "firmware/app.bin", offset: 0x20000 }] },
    "https://example.test/dev/manifest.json",
    async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
      };
    }
  );

  assert.equal(seen[0].url, "https://example.test/dev/firmware/app.bin");
  assert.equal(seen[0].options.cache, "no-store");
  assert.equal(parts[0].address, 0x20000);
  assert.deepEqual(Array.from(parts[0].data), [1, 2, 3]);
});

test("serial log parsing preserves line endings across chunks and classifies IDF levels", () => {
  const first = splitSerialChunk("", "\x1b[0;33mW (7700) uart: pin busy\r");
  assert.deepEqual(first.lines, []);
  assert.equal(first.pending, "\x1b[0;33mW (7700) uart: pin busy\r");

  const second = splitSerialChunk(
    first.pending,
    "\nE (8340) uart: failed\nI (9000) diag: continuing"
  );
  assert.deepEqual(second.lines, [
    { text: "\x1b[0;33mW (7700) uart: pin busy", terminated: true },
    { text: "E (8340) uart: failed", terminated: true }
  ]);
  assert.equal(second.pending, "I (9000) diag: continuing");
  assert.equal(serialLogLevel(second.lines[0].text), "warning");
  assert.equal(serialLogLevel(second.lines[1].text), "error");
  assert.equal(serialLogLevel(second.pending), "info");
  assert.equal(stripSerialAnsi(second.lines[0].text), "W (7700) uart: pin busy");

  assert.deepEqual(splitSerialChunk(second.pending, "", true), {
    lines: [{ text: "I (9000) diag: continuing", terminated: false }],
    pending: ""
  });
});

test("diag console strips caller line endings without changing ring or syslog bytes", () => {
  const source = fs.readFileSync(new URL("../main/diag_log.cpp", import.meta.url), "utf8");
  assert.match(source, /syslog_send\(line, total\);/);
  assert.match(source, /while \(console_total > 0[\s\S]*?line\[console_total - 1\] == '\\n'[\s\S]*?line\[console_total - 1\] == '\\r'/);
  assert.match(source, /ESP_LOGI\("diag", "%\.\*s", console_total, line\);/);
  assert.doesNotMatch(source, /ESP_LOGI\("diag", "%\.\*s", total, line\);/);
});

function fakeEsptool(chipFamily = "ESP32-S3") {
  const calls = [];
  class Transport {
    constructor(port) { this.port = port; calls.push("transport"); }
    async disconnect() { calls.push("disconnect"); }
  }
  class Loader {
    constructor(options) {
      this.options = options;
      this.chip = { CHIP_NAME: chipFamily };
      calls.push("loader");
    }
    async main() { calls.push("main"); }
    async flashId() { calls.push("flashId"); }
    async eraseFlash() { calls.push("erase"); }
    async writeFlash(options) {
      calls.push("write");
      options.reportProgress(0, options.fileArray[0].data.length, options.fileArray[0].data.length);
    }
    async after(mode) { calls.push(`reset:${mode}`); }
  }
  return { calls, Transport, Loader };
}

test("device probing validates the manifest and always resets and closes the port", async () => {
  const fake = fakeEsptool();
  const port = { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } };
  const result = await probeDevice({
    port,
    manifest,
    TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader
  });

  assert.equal(result.chipFamily, "ESP32-S3");
  assert.deepEqual(fake.calls, ["transport", "loader", "main", "flashId", "reset:soft_reset", "disconnect"]);
});

test("device probing times out and releases an unresponsive serial device", async () => {
  const calls = [];
  class Transport {
    constructor() { calls.push("transport"); }
    async disconnect() { calls.push("disconnect"); }
  }
  class Loader {
    constructor() { calls.push("loader"); }
    async main() {
      calls.push("main");
      return new Promise(() => {});
    }
    async after() { calls.push("reset"); }
  }

  await assert.rejects(
    probeDevice({
      port: { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } },
      manifest,
      TransportCtor: Transport,
      ESPLoaderCtor: Loader,
      timeoutMs: 10,
      cleanupTimeoutMs: 10
    }),
    (error) => error.name === "DeviceProbeTimeoutError" && /did not answer in flashing mode/.test(error.message)
  );

  assert.deepEqual(calls, ["transport", "loader", "main", "disconnect"]);
});

test("a stuck transport cleanup cannot leave the compatibility page busy forever", async () => {
  const calls = [];
  class Transport {
    async disconnect() {
      calls.push("disconnect");
      return new Promise(() => {});
    }
  }
  class Loader {
    async main() { return new Promise(() => {}); }
  }

  const startedAt = Date.now();
  await assert.rejects(probeDevice({
    port: { getInfo() { return {}; } },
    manifest,
    TransportCtor: Transport,
    ESPLoaderCtor: Loader,
    timeoutMs: 10,
    cleanupTimeoutMs: 10
  }), { name: "DeviceProbeTimeoutError" });

  assert.deepEqual(calls, ["disconnect"]);
  assert.ok(Date.now() - startedAt < 250, "probe and cleanup deadlines must release the UI promptly");
});

test("flash writes the sparse manifest parts and only erases when explicitly selected", async () => {
  const fake = fakeEsptool();
  const states = [];
  const port = { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } };

  const result = await flashDevice({
    port,
    manifest,
    manifestUrl: "https://example.test/manifest.json",
    eraseFirst: false,
    TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async arrayBuffer() { return Uint8Array.from([1, 2, 3, 4]).buffer; }
    }),
    onState(state) { states.push(state); }
  });

  assert.equal(result.chipFamily, "ESP32-S3");
  assert.equal(fake.calls.includes("erase"), false);
  assert.deepEqual(fake.calls.slice(-3), ["write", "reset:soft_reset", "disconnect"]);
  assert.equal(states.at(-1).percentage, 100);
  assert.equal(states.at(-1).message, "Starting firmware");
});

test("serial monitor resets into user firmware with IO0 high before reading logs", async () => {
  const calls = [];
  const port = {
    async setSignals(signals) { calls.push(signals); }
  };

  await resetToUserFirmware(port, async (milliseconds) => {
    calls.push(`wait:${milliseconds}`);
  });

  assert.deepEqual(calls, [
    { dataTerminalReady: false, requestToSend: true },
    "wait:100",
    { dataTerminalReady: false, requestToSend: false },
    "wait:250"
  ]);
});

test("standalone reset opens a closed port, resets user firmware and releases it again", async () => {
  const calls = [];
  const port = {
    readable: null,
    writable: null,
    async open(options) {
      calls.push(["open", options]);
      this.readable = {};
      this.writable = {};
    },
    async setSignals(signals) { calls.push(["signals", signals]); },
    async close() {
      calls.push(["close"]);
      this.readable = null;
      this.writable = null;
    }
  };

  await resetConnectedDevice(port, {
    delay: async (milliseconds) => calls.push(["wait", milliseconds])
  });

  assert.deepEqual(calls, [
    ["open", { baudRate: 115200, bufferSize: 8192 }],
    ["signals", { dataTerminalReady: false, requestToSend: true }],
    ["wait", 100],
    ["signals", { dataTerminalReady: false, requestToSend: false }],
    ["wait", 250],
    ["close"]
  ]);
});

test("the published page keeps the monitor toggle in the connection tile and pins its arrow right", () => {
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="serial-monitor-button"/g) || []).length, 1);
  assert.equal((html.match(/id="reset-button"/g) || []).length, 1);
  assert.match(html, /<img class="installer-logo" src="\.\/heat-pump-icon\.png" alt="" aria-hidden="true">/);
  assert.doesNotMatch(html, /<span class="installer-logo"/);
  assert.match(html, /class="installer-action-row installer-device-actions"[\s\S]*id="install-button"[\s\S]*id="reset-button"[\s\S]*id="disconnect-button"[\s\S]*id="release-serial-port"/);
  assert.match(html, /\.installer-device-actions\s*\{[^}]*grid-template-columns:/s);
  assert.match(html, /\.installer-monitor-chevron\s*\{[^}]*margin-left:auto;/s);
  assert.match(html, /\.installer-device-monitor-value\s*\{[^}]*gap:14px;/s);
  assert.match(html, /\.installer-monitor-output\s*\{[^}]*overflow-x:auto;[^}]*white-space:pre;[^}]*overflow-wrap:normal;/s);
  assert.doesNotMatch(html, /\.installer-monitor-output\s*\{[^}]*white-space:pre-wrap;/s);
  assert.match(html, /\.installer-monitor-line-warning\s*\{[^}]*color:#F2A444;/s);
  assert.match(html, /\.installer-monitor-line-error\s*\{[^}]*color:#FF6B6B;/s);
  assert.match(html, /esptool-js@0\.6\.1\/\+esm/);
  assert.doesNotMatch(html, /esp-web-install-button/);
});
