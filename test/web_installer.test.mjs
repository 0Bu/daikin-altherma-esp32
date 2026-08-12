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
  selectManifestBuild
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
    async after() { calls.push("reset"); }
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
  assert.deepEqual(fake.calls, ["transport", "loader", "main", "flashId", "reset", "disconnect"]);
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
  assert.deepEqual(fake.calls.slice(-3), ["write", "reset", "disconnect"]);
  assert.equal(states.at(-1).percentage, 100);
});

test("the published page keeps the monitor toggle in the connection tile and pins its arrow right", () => {
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="serial-monitor-button"/g) || []).length, 1);
  assert.match(html, /\.installer-monitor-chevron\s*\{[^}]*margin-left:auto;/s);
  assert.match(html, /\.installer-device-monitor-value\s*\{[^}]*gap:14px;/s);
  assert.match(html, /esptool-js@0\.6\.1\/\+esm/);
  assert.doesNotMatch(html, /esp-web-install-button/);
});
