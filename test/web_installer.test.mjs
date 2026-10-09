import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { releaseSelectedSerialPort, serialPortLease } from "../docs/serial-port-release.mjs";

import {
  attachWebInstaller,
  combinedProgress,
  describeSerialConnection,
  detectedSerialType,
  fetchFirmwareParts,
  flashDevice,
  loadFirmwareOffer,
  probeDevice,
  resetConnectedDevice,
  resetToUserFirmware,
  serialLogLevel,
  selectManifestBuild,
  splitSerialChunk,
  stripSerialAnsi
} from "../docs/web-installer.mjs";

const APP_NAME = "daikin-altherma-esp32.bin";
const OFFICIAL_PARTS = [
  { path: "daikin-altherma-esp32-web-bootloader.bin", offset: 0, size: 0x6000 },
  { path: "daikin-altherma-esp32-web-partition-table.bin", offset: 0x8000, size: 0xc00 },
  { path: "daikin-altherma-esp32-web-ota_data_initial.bin", offset: 0xf000, size: 0x2000 },
  { path: APP_NAME, offset: 0x20000, size: 0x21000 }
];
const digest = (data) => createHash("sha256").update(data).digest("hex");

function firmwareFixture(version = "1.2.3", byte = 0xa5) {
  const payloads = new Map(OFFICIAL_PARTS.map((part, index) =>
    [part.path, Buffer.alloc(part.size, (byte + index) & 0xff)]
  ));
  const document = {
    name: "daikin-altherma-esp32",
    version,
    provenance: { app_sha256: digest(payloads.get(APP_NAME)) },
    new_install_prompt_erase: true,
    builds: [{ chipFamily: "ESP32-S3", parts: OFFICIAL_PARTS.map(({ path, offset }) => ({ path, offset })) }]
  };
  const index = {
    schema_version: 1,
    manifest_sha256: "",
    artifacts: Array.from(payloads, ([path, data]) => ({ path, size: data.length, sha256: digest(data) }))
  };
  const fixture = {
    document, index, payloads, seen: [],
    refresh() {
      this.rawManifest = Buffer.from(JSON.stringify(document));
      index.manifest_sha256 = digest(this.rawManifest);
      this.rawIndex = Buffer.from(JSON.stringify(index));
      return this;
    },
    async fetch(url, options) {
      fixture.seen.push({ url, options });
      const name = new URL(url).pathname.split("/").at(-1);
      const data = name === "manifest.json" ? fixture.rawManifest :
        name === "artifacts.json" ? fixture.rawIndex : payloads.get(name);
      return {
        ok: Boolean(data), status: data ? 200 : 404, url, redirected: false,
        body: new ReadableStream({
          start(controller) {
            if (data) controller.enqueue(Uint8Array.from(data));
            controller.close();
          }
        }),
        async arrayBuffer() { throw new Error("bulk body consumption must never be used"); }
      };
    },
    load(manifestUrl = "https://example.test/dev/manifest.json") {
      return loadFirmwareOffer({ manifestUrl, fetchImpl: fixture.fetch, cryptoImpl: webcrypto });
    }
  };
  return fixture.refresh();
}

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

test("verified firmware parts stay in their feed directory and preserve canonical offsets", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const parts = await fetchFirmwareParts(offer.manifest.builds[0], offer, fixture.fetch);

  assert.deepEqual(parts.map((part) => part.address), OFFICIAL_PARTS.map((part) => part.offset));
  assert.deepEqual(parts.map((part) => digest(part.data)), offer.artifacts.map((entry) => entry.sha256));
  assert.equal(fixture.seen.length, 6);
  for (const request of fixture.seen) {
    assert.ok(request.url.startsWith("https://example.test/dev/"));
    assert.equal(request.options.cache, "no-store");
    assert.equal(request.options.redirect, "error");
    assert.ok(request.options.signal instanceof AbortSignal);
  }
  assert.equal(Object.isFrozen(offer), true);
  assert.equal(Object.isFrozen(offer.manifest.builds[0].parts[0]), true);
  assert.equal(Object.isFrozen(offer.artifacts[0]), true);
  assert.throws(() => { offer.manifest.version = "9.9.9"; }, TypeError);
});

test("official offers reject invalid target, geometry and artifact bindings", async (t) => {
  const cases = [
    ["wrong target", (f) => { f.document.builds[0].chipFamily = "ESP32-C3"; }],
    ["wrong offset", (f) => { f.document.builds[0].parts[3].offset = 0x210000; }],
    ["substituted bootloader", (f) => {
      f.document.builds[0].parts[0].path = "replacement.bin";
      f.index.artifacts.push({ ...f.index.artifacts[0], path: "replacement.bin" });
    }],
    ["missing application", (f) => { f.document.builds[0].parts.pop(); }],
    ["duplicate flash part", (f) => { f.document.builds[0].parts[3] = { ...f.document.builds[0].parts[0] }; }],
    ["unindexed part", (f) => { f.index.artifacts.shift(); }],
    ["duplicate artifact", (f) => { f.index.artifacts.push({ ...f.index.artifacts[0] }); }],
    ["duplicate build", (f) => { f.document.builds.push(structuredClone(f.document.builds[0])); }],
    ["erase sector overlap", (f) => {
      f.index.artifacts[0].size = 0x8001;
      const parts = f.document.builds[0].parts;
      [parts[0], parts[1]] = [parts[1], parts[0]];
    }],
    ["NVS boundary", (f) => { f.index.artifacts[1].size = 0x1001; }],
    ["coredump boundary", (f) => { f.index.artifacts[2].size = 0x3001; }],
    ["history boundary", (f) => { f.index.artifacts[3].size = 0x400000; }],
    ["application provenance", (f) => { f.document.provenance.app_sha256 = "0".repeat(64); }],
    ["unsafe root path", (f) => { f.index.artifacts[0].path = "/bootloader.bin"; }],
    ["unsafe parent path", (f) => { f.index.artifacts[0].path = "../bootloader.bin"; }],
    ["foreign URL", (f) => { f.document.builds[0].parts[0].path = "https://foreign.test/bootloader.bin"; }],
    ["invalid size", (f) => { f.index.artifacts[0].size = true; }],
    ["invalid hash", (f) => { f.index.artifacts[0].sha256 = "X".repeat(64); }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const fixture = firmwareFixture();
      mutate(fixture);
      fixture.refresh();
      await assert.rejects(fixture.load(), { name: "FirmwareIntegrityError" });
      assert.equal(fixture.seen.length, 2, "invalid metadata must fail before binary downloads");
    });
  }
});

test("offer loading rejects stale indexes, duplicate JSON keys, redirects and missing WebCrypto", async () => {
  const fixture = firmwareFixture();
  fixture.rawIndex = Buffer.from(JSON.stringify({ ...fixture.index, manifest_sha256: "0".repeat(64) }));
  await assert.rejects(fixture.load(), /does not match the displayed firmware manifest/);
  fixture.refresh();
  fixture.rawManifest = Buffer.from(fixture.rawManifest.toString().replace('"version":"1.2.3"', '"version":"1.2.3","version":"9.9.9"'));
  await assert.rejects(fixture.load(), /duplicate metadata key version/);
  fixture.refresh();
  fixture.rawIndex = Buffer.from(fixture.rawIndex.toString().replace('"schema_version":1', '"schema_version":1,"schema_version":1'));
  await assert.rejects(fixture.load(), /duplicate metadata key schema_version/);

  for (const redirected of [true, false]) {
    const clean = firmwareFixture();
    await assert.rejects(loadFirmwareOffer({
      manifestUrl: "https://example.test/dev/manifest.json", cryptoImpl: webcrypto,
      fetchImpl: async (url, options) => ({
        ...await clean.fetch(url, options),
        redirected,
        url: redirected ? url : "https://example.test/manifest.json"
      })
    }), /changed location/);
  }
  await assert.rejects(loadFirmwareOffer({ manifestUrl: "https://example.test/manifest.json", cryptoImpl: {} }),
    { name: "FirmwareVerificationUnavailableError" });
  await assert.rejects(firmwareFixture().load("http://example.test/manifest.json"), /HTTPS feed directory/);
});

test("all byte drift fails before explicit erase or sparse write, including a stale displayed version", async (t) => {
  const cases = [
    ["version A offer and version B bytes", (f) => {
      const newer = firmwareFixture("1.2.4", 0xb5);
      for (const [name, data] of newer.payloads) f.payloads.set(name, data);
    }],
    ["bootloader corruption", (f) => { f.payloads.get(OFFICIAL_PARTS[0].path)[0] ^= 1; }],
    ["application corruption", (f) => { f.payloads.get(APP_NAME)[0] ^= 1; }],
    ["truncated partition", (f) => { f.payloads.set(OFFICIAL_PARTS[1].path, f.payloads.get(OFFICIAL_PARTS[1].path).subarray(0, -1)); }],
    ["root/dev substitution", (_f, response) => { response.url = response.url.replace("/dev/", "/"); }],
    ["foreign redirect", (_f, response) => { response.redirected = true; response.url = "https://foreign.test/app.bin"; }]
  ];
  for (const [name, mutate] of cases) {
    for (const eraseFirst of [false, true]) {
      await t.test(`${name}; erase=${eraseFirst}`, async () => {
        const fixture = firmwareFixture();
        const offer = await fixture.load();
        if (mutate.length === 1) mutate(fixture);
        const fake = fakeEsptool();
        await assert.rejects(flashDevice({
          port: { getInfo() { return {}; } }, offer, eraseFirst,
          TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
          fetchImpl: async (url, options) => {
            const response = await fixture.fetch(url, options);
            if (mutate.length === 2) mutate(fixture, response);
            return response;
          }
        }), (error) => error.name === "FirmwareIntegrityError" && /Reload this page/.test(error.message));
        assert.equal(offer.manifest.version, "1.2.3", "the displayed selection must never silently advance");
        assert.equal(fake.calls.includes("erase"), false);
        assert.equal(fake.calls.includes("write"), false);
      });
    }
  }
});

test("a raw manifest or forged offer cannot bypass verification", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  for (const candidate of [undefined, structuredClone(offer)]) {
    const fake = fakeEsptool();
    await assert.rejects(flashDevice({
      port: { getInfo() { return {}; } }, manifest: fixture.document, offer: candidate,
      TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader, fetchImpl: fixture.fetch
    }), /verified firmware offer is required/);
    assert.deepEqual(fake.calls, []);
  }
});

function controlledBody({ chunks = [], hang = false, cancelHangs = false } = {}) {
  let started;
  const record = { cancellations: [], pulls: 0, started: new Promise((resolve) => { started = resolve; }) };
  let chunkIndex = 0;
  record.body = new ReadableStream({
    pull(controller) {
      record.pulls++;
      started();
      if (chunkIndex < chunks.length) controller.enqueue(Uint8Array.from(chunks[chunkIndex++]));
      else if (hang) return new Promise(() => {});
      else controller.close();
    },
    cancel(reason) {
      record.cancellations.push(reason);
      if (cancelHangs) return new Promise(() => {});
    }
  }, { highWaterMark: 0 });
  return record;
}

function streamedResponse(url, record) {
  return {
    ok: true, status: 200, url, redirected: false, body: record.body,
    async arrayBuffer() { throw new Error("bulk body consumption must never be used"); }
  };
}

test("metadata streaming cancels and aborts a body that exceeds its cap by one byte", async () => {
  const fixture = firmwareFixture();
  const oversized = Buffer.concat([fixture.rawManifest, Buffer.alloc(1025 - fixture.rawManifest.length, 32)]);
  const source = controlledBody({ chunks: [oversized.subarray(0, 1024), oversized.subarray(1024)], cancelHangs: true });
  let signal;
  await assert.rejects(loadFirmwareOffer({
    manifestUrl: "https://example.test/dev/manifest.json", cryptoImpl: webcrypto,
    fetchImpl: async (url, options) => { signal = options.signal; return streamedResponse(url, source); }
  }), /exceeded its byte limit/);
  assert.equal(signal.aborted, true);
  assert.equal(source.cancellations.length, 1);
  assert.equal(source.pulls, 2, "no chunk beyond the first excess byte may be requested");
  assert.equal(source.body.locked, false);
});

test("a part exceeding its indexed size by one byte never erases or writes and closes the transport", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const fake = fakeEsptool();
  const source = controlledBody({ chunks: [fixture.payloads.get(OFFICIAL_PARTS[0].path), Uint8Array.of(1)] });
  let signal;
  await assert.rejects(flashDevice({
    port: { getInfo() { return {}; } }, offer, eraseFirst: true,
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
    fetchImpl: async (url, options) => {
      if (!url.endsWith(OFFICIAL_PARTS[0].path)) return fixture.fetch(url, options);
      signal = options.signal;
      return streamedResponse(url, source);
    }
  }), /exceeded its byte limit/);
  assert.equal(signal.aborted, true);
  assert.equal(source.cancellations.length, 1);
  assert.equal(source.body.locked, false);
  assert.equal(fake.calls.includes("erase"), false);
  assert.equal(fake.calls.includes("write"), false);
  assert.deepEqual(fake.calls.slice(-2), ["reset:hard_reset", "disconnect"]);
});

test("one absolute deadline covers fetch and a hung metadata body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = controlledBody({ hang: true, cancelHangs: true });
  let signal;
  let releaseFetch;
  let startedFetch;
  const fetched = new Promise((resolve) => { releaseFetch = resolve; });
  const fetchStarted = new Promise((resolve) => { startedFetch = resolve; });
  const loading = loadFirmwareOffer({
    manifestUrl: "https://example.test/dev/manifest.json", cryptoImpl: webcrypto,
    fetchImpl: async (_url, options) => { signal = options.signal; startedFetch(); return fetched; }
  });
  const rejection = assert.rejects(loading, /30-second time limit/);
  await fetchStarted;
  t.mock.timers.tick(20000);
  releaseFetch(streamedResponse("https://example.test/dev/manifest.json", source));
  await source.started;
  t.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(signal.aborted, true);
  assert.equal(source.cancellations.length, 1);
  assert.equal(source.body.locked, false);
});

test("a fetch that ignores abort returns at the deadline and its late response body is still cancelled", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = controlledBody({ hang: true, cancelHangs: true });
  let signal;
  let releaseFetch;
  let startedFetch;
  const fetched = new Promise((resolve) => { releaseFetch = resolve; });
  const fetchStarted = new Promise((resolve) => { startedFetch = resolve; });
  const loading = loadFirmwareOffer({
    manifestUrl: "https://example.test/dev/manifest.json", cryptoImpl: webcrypto,
    fetchImpl: (_url, options) => { signal = options.signal; startedFetch(); return fetched; }
  });
  const rejection = assert.rejects(loading, /30-second time limit/);
  await fetchStarted;
  t.mock.timers.tick(30000);
  await rejection;
  assert.equal(signal.aborted, true);
  releaseFetch(streamedResponse("https://example.test/dev/manifest.json", source));
  await new Promise(queueMicrotask);
  assert.equal(source.cancellations.length, 1);
  assert.equal(source.pulls, 0, "an aborted late body must be cancelled without reading");
  assert.equal(source.body.locked, false);
});

test("a hung part body returns at the fixed deadline despite stalled cancellation and cleans up transport", async (t) => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fakeEsptool();
  const source = controlledBody({ hang: true, cancelHangs: true });
  let signal;
  const flashing = flashDevice({
    port: { getInfo() { return {}; } }, offer, eraseFirst: true,
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
    fetchImpl: async (url, options) => {
      if (!url.endsWith(OFFICIAL_PARTS[0].path)) return fixture.fetch(url, options);
      signal = options.signal;
      return streamedResponse(url, source);
    }
  });
  const rejection = assert.rejects(flashing, /30-second time limit/);
  await source.started;
  t.mock.timers.tick(30000);
  await rejection;
  assert.equal(signal.aborted, true);
  assert.equal(source.cancellations.length, 1);
  assert.equal(source.body.locked, false);
  assert.equal(fake.calls.includes("erase"), false);
  assert.equal(fake.calls.includes("write"), false);
  assert.deepEqual(fake.calls.slice(-2), ["reset:hard_reset", "disconnect"]);
});

test("the first corrupt part aborts and cancels all three pending sibling streams before transport cleanup", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const fake = fakeEsptool();
  const corrupt = Uint8Array.from(fixture.payloads.get(OFFICIAL_PARTS[0].path));
  corrupt[0] ^= 1;
  const sources = OFFICIAL_PARTS.map((_part, index) => index === 0 ?
    controlledBody({ chunks: [corrupt] }) : controlledBody({ hang: true, cancelHangs: true }));
  const signals = [];
  await assert.rejects(flashDevice({
    port: { getInfo() { return {}; } }, offer, eraseFirst: true,
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
    fetchImpl: async (url, options) => {
      const index = OFFICIAL_PARTS.findIndex((part) => url.endsWith(part.path));
      assert.notEqual(index, -1);
      signals[index] = options.signal;
      return streamedResponse(url, sources[index]);
    }
  }), /no longer matches the displayed firmware offer/);
  for (let index = 1; index < sources.length; index++) {
    assert.equal(signals[index].aborted, true);
    assert.equal(sources[index].cancellations.length, 1);
    assert.ok(sources[index].pulls > 0, "the sibling must actually be pending in a stream read");
    assert.equal(sources[index].body.locked, false);
  }
  assert.equal(fake.calls.includes("erase"), false);
  assert.equal(fake.calls.includes("write"), false);
  assert.deepEqual(fake.calls.slice(-2), ["reset:hard_reset", "disconnect"]);
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

function fakeEsptool(chipFamily = "ESP32-S3", flashSize = "8MB") {
  const calls = [];
  const writes = [];
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
    async detectFlashSize() { calls.push("detectFlashSize"); return flashSize; }
    async eraseFlash() { calls.push("erase"); }
    async writeFlash(options) {
      calls.push("write");
      writes.push(options);
      options.reportProgress(0, options.fileArray[0].data.length, options.fileArray[0].data.length);
    }
    async after(mode) {
      calls.push(`reset:${mode}`);
      if (mode !== "hard_reset") {
        throw new Error("Soft resetting is currently only supported on ESP8266");
      }
    }
  }
  return { calls, writes, Transport, Loader };
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
  assert.equal(result.flashSize, "8MB");
  assert.deepEqual(fake.calls, ["transport", "loader", "main", "flashId", "detectFlashSize", "reset:hard_reset", "disconnect"]);
});

test("probe and install require known flash capacity of at least 8 MB before downloading or writing", async (t) => {
  for (const capacity of ["4MB", undefined, "unknown", "12MB", "missing method", "8MB", "16MB"]) {
    await t.test(String(capacity), async () => {
      const fixture = firmwareFixture();
      const offer = await fixture.load();
      const fake = fakeEsptool();
      if (capacity === "missing method") delete fake.Loader.prototype.detectFlashSize;
      else fake.Loader.prototype.detectFlashSize = async () => capacity;
      const accepted = capacity === "8MB" || capacity === "16MB";
      const port = { getInfo() { return {}; } };
      const probing = probeDevice({ port, manifest: offer.manifest, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader });
      if (accepted) assert.equal((await probing).flashSize, capacity);
      else await assert.rejects(probing, { name: "UnsupportedFlashSizeError" });
      const flashing = flashDevice({
        port, offer, eraseFirst: true, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
        fetchImpl: fixture.fetch
      });
      if (accepted) await flashing;
      else await assert.rejects(flashing, { name: "UnsupportedFlashSizeError" });
      assert.equal(fake.calls.includes("erase"), accepted);
      assert.equal(fake.calls.includes("write"), accepted);
      assert.equal(fixture.seen.length, accepted ? 6 : 2);
      if (accepted) assert.equal(fake.writes[0].flashSize, "keep", "signed image headers must stay unchanged");
    });
  }
});

function installerDom() {
  const elements = new Map();
  const makeElement = () => ({
    dataset: {}, style: {}, textContent: "", hidden: true, disabled: false,
    attributes: new Map(), listeners: new Map(),
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    append(child) { this.textContent += child.textContent; },
    replaceChildren() { this.textContent = ""; },
    ownerDocument: { createElement: () => makeElement() }
  });
  const root = {
    dataset: {}, attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelector(selector) {
      if (selector.startsWith("input")) return { value: "preserve" };
      if (!elements.has(selector)) elements.set(selector, makeElement());
      return elements.get(selector);
    },
    querySelectorAll() { return []; }
  };
  return { root, element: (id) => root.querySelector(`#${id}`) };
}

test("the attached installer freezes the displayed offer and reports drift without changing the version", async (t) => {
  const priorLocation = globalThis.location;
  const priorSecureContext = globalThis.isSecureContext;
  globalThis.location = { href: "https://example.test/dev/index.html" };
  globalThis.isSecureContext = true;
  t.after(() => { globalThis.location = priorLocation; globalThis.isSecureContext = priorSecureContext; });
  const fixture = firmwareFixture();
  const fake = fakeEsptool();
  const dom = installerDom();
  const controller = attachWebInstaller({
    root: dom.root,
    serial: { async requestPort() { return { getInfo() { return {}; } }; }, addEventListener() {} },
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader, fetchImpl: fixture.fetch, cryptoImpl: webcrypto
  });
  await controller.ready;
  assert.equal(dom.element("firmware-version-value").textContent, "1.2.3");
  await controller.connect();
  assert.equal(dom.element("install-button").disabled, false);
  fixture.payloads.get(APP_NAME)[0] ^= 1;
  await controller.install();
  assert.match(dom.element("page-status").textContent, /Installation failed:.*Reload this page/);
  assert.equal(dom.element("firmware-version-value").textContent, "1.2.3");
  assert.equal(dom.root.dataset.finished, "false");
  assert.equal(fake.calls.includes("erase"), false);
  assert.equal(fake.calls.includes("write"), false);
});

test("the attached installer disables installation when WebCrypto verification is unavailable", async (t) => {
  const priorLocation = globalThis.location;
  const priorSecureContext = globalThis.isSecureContext;
  globalThis.location = { href: "https://example.test/index.html" };
  globalThis.isSecureContext = true;
  t.after(() => { globalThis.location = priorLocation; globalThis.isSecureContext = priorSecureContext; });
  const dom = installerDom();
  const fixture = firmwareFixture();
  const fake = fakeEsptool();
  const controller = attachWebInstaller({
    root: dom.root, serial: { async requestPort() { throw new Error("must stay disabled"); } },
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader, fetchImpl: fixture.fetch, cryptoImpl: {}
  });
  await controller.ready;
  assert.match(dom.element("page-status").textContent, /Firmware verification is unavailable/);
  assert.equal(dom.element("connect-button").disabled, true);
  assert.equal(dom.element("install-button").disabled, true);
  assert.equal(fixture.seen.length, 0);
});

test("device probing resets when loader startup fails after the flasher stub starts", async () => {
  const calls = [];
  const startupError = new Error("Flash ID validation failed after stub startup");
  class Transport {
    constructor() { calls.push("transport"); }
    async disconnect() { calls.push("disconnect"); }
  }
  class Loader {
    constructor() { calls.push("loader"); }
    async main() {
      calls.push("main:stub-running");
      this.chip = { CHIP_NAME: "ESP32-S3" };
      throw startupError;
    }
    async after(mode) { calls.push(`reset:${mode}`); }
  }

  await assert.rejects(probeDevice({
    port: { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } },
    manifest,
    TransportCtor: Transport,
    ESPLoaderCtor: Loader
  }), (error) => error === startupError);

  assert.deepEqual(calls, [
    "transport",
    "loader",
    "main:stub-running",
    "reset:hard_reset",
    "disconnect"
  ]);
});

test("device probing times out without closing or releasing a still-running native startup", async () => {
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

  assert.deepEqual(calls, ["transport", "loader", "main"]);
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
    async main() { this.chip = { CHIP_NAME: "ESP32-S3" }; }
    async detectFlashSize() { return "8MB"; }
  }

  const startedAt = Date.now();
  await assert.rejects(probeDevice({
    port: { getInfo() { return {}; } },
    manifest,
    TransportCtor: Transport,
    ESPLoaderCtor: Loader,
    timeoutMs: 10,
    cleanupTimeoutMs: 10
  }), { name: "SerialCleanupTimeoutError" });

  assert.deepEqual(calls, ["disconnect"]);
  assert.ok(Date.now() - startedAt < 250, "probe and cleanup deadlines must release the UI promptly");
});

test("flash writes the sparse manifest parts and only erases when explicitly selected", async () => {
  for (const eraseFirst of [false, true]) {
    const fixture = firmwareFixture();
    const offer = await fixture.load();
    const fake = fakeEsptool();
    const states = [];
    const result = await flashDevice({
      port: { getInfo() { return {}; } }, offer, eraseFirst,
      TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader, fetchImpl: fixture.fetch,
      onState(state) {
        states.push(state);
        if (["erasing", "writing"].includes(state.stage)) assert.equal(fixture.seen.length, 6);
      }
    });

    assert.equal(result.chipFamily, "ESP32-S3");
    assert.equal(fake.calls.includes("erase"), eraseFirst);
    assert.deepEqual(fake.calls.slice(-3), ["write", "reset:hard_reset", "disconnect"]);
    if (eraseFirst) assert.ok(fake.calls.indexOf("erase") < fake.calls.indexOf("write"));
    assert.equal(fake.writes.length, 1);
    assert.equal(fake.writes[0].eraseAll, false);
    assert.deepEqual(fake.writes[0].fileArray.map((part) => part.address), OFFICIAL_PARTS.map((part) => part.offset));
    assert.deepEqual(fake.writes[0].fileArray.map((part) => digest(part.data)), offer.artifacts.map((entry) => entry.sha256));
    assert.equal(states.at(-1).percentage, 100);
    assert.equal(states.at(-1).message, "Starting firmware");
  }
});

test("a flash write failure is preserved after hard-reset cleanup closes the port", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const fake = fakeEsptool();
  const writeError = new Error("write failed");
  fake.Loader.prototype.writeFlash = async function writeFlash() {
    fake.calls.push("write");
    throw writeError;
  };

  await assert.rejects(flashDevice({
    port: { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } },
    offer,
    eraseFirst: false,
    TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader,
    fetchImpl: fixture.fetch
  }), (error) => error === writeError);

  assert.deepEqual(fake.calls.slice(-3), ["write", "reset:hard_reset", "disconnect"]);
});

test("a post-write reset failure is preserved while cleanup still disconnects", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const fake = fakeEsptool();
  const resetError = new Error("reset failed");
  fake.Loader.prototype.after = async function after(mode) {
    fake.calls.push(`reset:${mode}`);
    throw resetError;
  };

  await assert.rejects(flashDevice({
    port: { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } },
    offer,
    eraseFirst: false,
    TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader,
    fetchImpl: fixture.fetch
  }), (error) => error === resetError);

  assert.deepEqual(fake.calls.slice(-4), [
    "write",
    "reset:hard_reset",
    "reset:hard_reset",
    "disconnect"
  ]);
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
  assert.match(html, /--installer-rail-width:214px;/);
  assert.match(html, /\.installer-shell\s*\{[^}]*background:linear-gradient\(to right,var\(--brand-tint\) 0 var\(--installer-rail-width\),var\(--bg\) var\(--installer-rail-width\)\);/s);
  assert.match(html, /\.installer-layout\s*\{[^}]*grid-template-columns:var\(--installer-rail-width\) minmax\(0,1fr\);/s);
  assert.match(html, /@media \(max-width:780px\)\s*\{[\s\S]*?\.installer-shell\s*\{\s*background:var\(--bg\);\s*\}[\s\S]*?\.installer-layout\s*\{\s*grid-template-columns:1fr;\s*\}/s);
  assert.match(html, /\.installer-device-actions\s*\{[^}]*grid-template-columns:/s);
  assert.match(html, /\.installer-monitor-chevron\s*\{[^}]*margin-left:auto;/s);
  assert.match(html, /\.installer-device-monitor-value\s*\{[^}]*gap:14px;/s);
  assert.match(html, /\.installer-monitor-output\s*\{[^}]*overflow-x:auto;[^}]*white-space:pre;[^}]*overflow-wrap:normal;/s);
  assert.doesNotMatch(html, /\.installer-monitor-output\s*\{[^}]*white-space:pre-wrap;/s);
  assert.match(html, /\.installer-monitor-line-warning\s*\{[^}]*color:#F2A444;/s);
  assert.match(html, /\.installer-monitor-line-error\s*\{[^}]*color:#FF6B6B;/s);
  assert.match(html, /https:\/\/cdn\.jsdelivr\.net\/npm\/esptool-js@\d+\.\d+\.\d+\/\+esm/);
  assert.doesNotMatch(html, /esp-web-install-button/);
});

function pendingNative() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function drainNativeTasks() {
  for (let turn = 0; turn < 60; turn++) await Promise.resolve();
}

function lifecyclePort(name) {
  const port = {
    name, readable: null, writable: null, opens: 0, closes: 0, signals: [], forgets: 0,
    reads: 0, resets: 0, flashIds: 0, writes: 0,
    getInfo() { return {}; },
    async open() {
      this.opens++;
      if (this.openWait) await this.openWait.promise;
      this.readable = this.readerSource || new ReadableStream({
        start: (controller) => { this.readController = controller; }
      });
      this.writable = {};
    },
    async close() {
      this.closes++;
      if (this.closeWait) await this.closeWait.promise;
      if (this.closeError) throw this.closeError;
      if (this.readable?.locked) throw new Error("native readable stream is still locked");
      this.readable = null;
      this.writable = null;
    },
    async setSignals(value) {
      this.signals.push(value);
      this.signalEntered?.resolve();
      if (this.signalWait) await this.signalWait.promise;
    },
    async forget() { this.forgets++; this.onForget?.(); }
  };
  return port;
}

function lifecycleEsptool() {
  class Transport {
    constructor(port) { this.port = port; }
    async disconnect() { await this.port.close(); }
  }
  class Loader {
    constructor(options) { this.options = options; this.port = options.transport.port; }
    async main() {
      await this.port.open();
      this.port.mainEntered?.resolve();
      if (this.port.mainWait) await this.port.mainWait.promise;
      this.chip = { CHIP_NAME: "ESP32-S3" };
      this.options.terminal.writeLine(`native ${this.port.name}`);
    }
    async flashId() { this.port.flashIds++; }
    async detectFlashSize() { return "8MB"; }
    async eraseFlash() { this.port.erases = (this.port.erases || 0) + 1; }
    async writeFlash(options) {
      this.port.writes++;
      this.port.writeEntered?.resolve();
      if (this.port.writeWait) await this.port.writeWait.promise;
      options.reportProgress(0, 1, 1);
      this.options.terminal.writeLine(`late write ${this.port.name}`);
      if (this.port.writeError) throw this.port.writeError;
    }
    async after() {
      this.port.resets++;
      if (this.port.afterWait) await this.port.afterWait.promise;
    }
  }
  return { Transport, Loader };
}

async function attachedLifecycle(t, ports) {
  const priorLocation = globalThis.location;
  const priorSecureContext = globalThis.isSecureContext;
  globalThis.location = { href: "https://example.test/dev/index.html" };
  globalThis.isSecureContext = true;
  t.after(() => { globalThis.location = priorLocation; globalThis.isSecureContext = priorSecureContext; });
  const fixture = firmwareFixture();
  const dom = installerDom();
  const fake = lifecycleEsptool();
  const serial = {
    choice: ports[0], grants: [...ports], chooserCalls: 0, listeners: new Map(),
    async requestPort() { this.chooserCalls++; return this.choice; },
    async getPorts() { return [...this.grants]; },
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
  };
  for (const port of ports) port.onForget = () => { serial.grants = serial.grants.filter((granted) => granted !== port); };
  const controller = attachWebInstaller({
    root: dom.root, serial, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
    fetchImpl: fixture.fetch, cryptoImpl: webcrypto
  });
  await controller.ready;
  return { controller, serial, dom, fixture, fake };
}

async function finishSignalReset(t, operation) {
  await drainNativeTasks();
  t.mock.timers.tick(100);
  await drainNativeTasks();
  t.mock.timers.tick(250);
  await drainNativeTasks();
  await operation;
}

function lifecycleUi(dom) {
  return JSON.stringify({
    dataset: dom.root.dataset,
    connection: dom.element("connection-label").textContent,
    status: dom.element("page-status").textContent,
    progress: dom.element("progress-stage").textContent,
    monitor: dom.element("serial-monitor-live").textContent,
    output: dom.element("serial-monitor-output").textContent
  });
}

test("attached monitor cancellation captures A's delayed open and cannot close or reset connected B", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  await controller.connect();
  a.openWait = pendingNative();
  const starting = controller.startMonitor();
  await drainNativeTasks();
  assert.equal(dom.root.attributes.get("aria-busy"), "true");
  assert.equal(dom.element("serial-monitor-button").attributes.get("aria-busy"), "true");
  const disconnecting = controller.disconnect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await disconnecting;
  await starting;
  assert.ok(serialPortLease(a), "the delayed native open must retain A's lease");
  serial.choice = b;
  await controller.connect();
  const before = lifecycleUi(dom);
  serial.choice = a;
  await assert.rejects(releaseSelectedSerialPort(serial, { controller }), { name: "InvalidStateError" });
  a.openWait.resolve();
  await drainNativeTasks();
  assert.equal(a.signals.length, 0, "cancelled monitor opening must never reset A");
  assert.equal(a.readable, null);
  assert.equal(serialPortLease(a), undefined);
  assert.equal(controller.getSelectedPort(), b);
  assert.equal(b.closes, 1, "only B's own compatibility probe may close B");
  assert.equal(lifecycleUi(dom), before);
});

test("attached timed-out probe retains its lease until late native open and cleanup actually settle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  a.openWait = pendingNative();
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  const probing = controller.connect();
  await drainNativeTasks();
  t.mock.timers.tick(10000);
  await probing;
  assert.match(dom.element("page-status").textContent, /native serial operation is still pending/);
  assert.equal(a.closes, 0, "cleanup must not race an unresolved native startup");
  assert.ok(serialPortLease(a));
  assert.equal(dom.root.dataset.busy, "true", "native cleanup stays visibly busy after the foreground deadline");
  assert.equal(dom.element("connect-button").attributes.get("aria-busy"), "true");
  serial.choice = b;
  await controller.connect();
  const before = lifecycleUi(dom);
  a.openWait.resolve();
  await drainNativeTasks();
  assert.equal(a.readable, null);
  assert.equal(a.flashIds, 0, "no later probe stages may run after timeout");
  assert.equal(serialPortLease(a), undefined);
  assert.equal(controller.getSelectedPort(), b);
  assert.equal(lifecycleUi(dom), before);
});

test("attached pending probe cleanup reports failure and prevents reuse until actual closure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  a.closeWait = pendingNative();
  const { controller, dom } = await attachedLifecycle(t, [a]);
  const probing = controller.connect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await probing;
  assert.match(dom.element("page-status").textContent, /cleanup timed out/);
  assert.equal(dom.root.dataset.connected, "false");
  assert.equal(dom.element("install-button").disabled, true);
  assert.ok(serialPortLease(a));
  await controller.connect();
  assert.match(dom.element("page-status").textContent, /still owned/);
  a.closeWait.resolve();
  await drainNativeTasks();
  assert.equal(serialPortLease(a), undefined);
  assert.equal(dom.root.dataset.connected, "false", "late cleanup must not retroactively certify compatibility");
  a.closeWait = null;
  await controller.connect();
  assert.equal(dom.root.dataset.connected, "true");
});

test("attached rejected flash cleanup retains the original failure and never claims installation success", async (t) => {
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  a.writeError = new Error("original native write failure");
  a.closeError = new Error("native close rejected");
  await controller.install();
  assert.match(dom.element("page-status").textContent, /original native write failure.*native close rejected/);
  assert.equal(dom.root.dataset.finished, "false");
  assert.equal(serialPortLease(a).phase, "quarantined");
  assert.equal(dom.element("install-button").disabled, true);
  assert.equal(a.forgets, 0);
});

test("attached reset cannot report success when native close resolves without closing the port", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  a.close = async () => { a.closes++; };
  await finishSignalReset(t, controller.resetDevice());
  assert.match(dom.element("page-status").textContent, /Reset failed:.*closure could not be confirmed/);
  assert.equal(serialPortLease(a).phase, "quarantined");
  assert.equal(dom.element("reset-button").disabled, true);
  assert.equal(dom.element("page-status").dataset.kind, "error");
});

test("attached repeated monitor stop is bounded while native reader cancellation remains owned", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  const reading = pendingNative();
  const cancelling = pendingNative();
  let cancels = 0;
  a.readerSource = {
    locked: false,
    getReader() {
      this.locked = true;
      return {
        read: () => reading.promise,
        cancel() {
          cancels++;
          reading.resolve({ done: true });
          return cancelling.promise;
        },
        releaseLock: () => { a.readerSource.locked = false; }
      };
    }
  };
  await finishSignalReset(t, controller.startMonitor());
  const first = assert.rejects(controller.stopMonitor(), { name: "SerialCleanupTimeoutError" });
  const second = assert.rejects(controller.stopMonitor(), { name: "SerialCleanupTimeoutError" });
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await first;
  await second;
  assert.equal(cancels, 1, "repeated stop must reuse the captured cancellation promise");
  assert.equal(serialPortLease(a).phase, "cleanup");
  assert.equal(dom.root.attributes.get("aria-busy"), "true");
  assert.equal(dom.element("reset-button").disabled, true);
  assert.equal(a.closes, 1, "only the earlier successful probe has closed A yet");
  cancelling.resolve();
  await drainNativeTasks();
  assert.equal(a.readable, null);
  assert.equal(serialPortLease(a), undefined);
  assert.equal(dom.element("serial-monitor-live").textContent, "Stopped");
});

test("attached late probe error and cleanup for A cannot change B's completed connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  a.mainWait = pendingNative();
  a.mainEntered = pendingNative();
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  const probing = controller.connect();
  await a.mainEntered.promise;
  const disconnecting = controller.disconnect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await disconnecting;
  await probing;
  serial.choice = b;
  await controller.connect();
  const before = lifecycleUi(dom);
  a.mainWait.reject(new Error("obsolete A probe failure"));
  await drainNativeTasks();
  assert.equal(a.readable, null);
  assert.equal(controller.getSelectedPort(), b);
  assert.equal(lifecycleUi(dom), before);
});

test("attached late flash progress, terminal text and success for A cannot alter B or release B mid-flash", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  await controller.connect();
  a.writeWait = pendingNative();
  a.writeEntered = pendingNative();
  const flashing = controller.install();
  await a.writeEntered.promise;
  serial.choice = b;
  await assert.rejects(releaseSelectedSerialPort(serial, { controller }), { name: "InvalidStateError" });
  assert.equal(b.forgets, 0);
  const disconnecting = controller.disconnect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await disconnecting;
  await flashing;
  await controller.connect();
  const before = lifecycleUi(dom);
  a.writeWait.resolve();
  await drainNativeTasks();
  assert.equal(a.readable, null);
  assert.equal(controller.getSelectedPort(), b);
  assert.equal(lifecycleUi(dom), before);
  assert.equal(dom.root.dataset.finished, "false");
});

test("attached delayed reset of A cannot signal B or publish a stale success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  await controller.connect();
  a.signalWait = pendingNative();
  a.signalEntered = pendingNative();
  const resetting = controller.resetDevice();
  await a.signalEntered.promise;
  const disconnecting = controller.disconnect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await disconnecting;
  await resetting;
  serial.choice = b;
  await controller.connect();
  const before = lifecycleUi(dom);
  a.signalWait.resolve();
  await drainNativeTasks();
  assert.equal(a.signals.length, 1, "cancellation must prevent the next reset signal");
  assert.equal(b.signals.length, 0);
  assert.equal(a.readable, null);
  assert.equal(lifecycleUi(dom), before);
});

test("attached stale monitor reader A cannot append into B's monitor output", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  await controller.connect();
  const reading = pendingNative();
  a.readerSource = {
    locked: false,
    getReader() {
      this.locked = true;
      return {
        read: () => reading.promise,
        async cancel() {},
        releaseLock: () => { a.readerSource.locked = false; }
      };
    }
  };
  await finishSignalReset(t, controller.startMonitor());
  const disconnecting = controller.disconnect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await disconnecting;
  assert.ok(serialPortLease(a));
  serial.choice = b;
  await controller.connect();
  const before = lifecycleUi(dom);
  reading.resolve({ value: new TextEncoder().encode("obsolete A output\n"), done: false });
  await drainNativeTasks();
  assert.equal(a.readable, null);
  assert.equal(lifecycleUi(dom), before);
});

test("attached monitor A survives releasing unrelated closed B; reset stops monitor and the user can reopen it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const b = lifecyclePort("B");
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b]);
  await controller.connect();
  await finishSignalReset(t, controller.startMonitor());
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  assert.equal(dom.element("serial-monitor-button").attributes.get("aria-expanded"), "true");
  assert.equal(dom.element("serial-monitor").attributes.get("aria-hidden"), "false");
  assert.equal(dom.root.attributes.get("aria-busy"), "false");
  serial.choice = b;
  const forgotten = await releaseSelectedSerialPort(serial, { controller });
  assert.equal(forgotten, b);
  await controller.onPortReleased(forgotten);
  assert.equal(controller.getSelectedPort(), a);
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  assert.ok(serialPortLease(a));
  await finishSignalReset(t, controller.resetDevice());
  assert.match(dom.element("page-status").textContent, /serial monitor is stopped; reopen/);
  assert.equal(dom.root.dataset.monitor, "closed");
  assert.equal(dom.element("serial-monitor-button").attributes.get("aria-expanded"), "false");
  assert.equal(dom.element("serial-monitor").attributes.get("aria-hidden"), "true");
  assert.equal(a.readable, null);
  await finishSignalReset(t, controller.startMonitor());
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  await controller.stopMonitor();
  await controller.install();
  assert.equal(dom.root.dataset.finished, "true");
  assert.equal(a.writes, 1);
  assert.equal(a.readable, null);
  const chooserBeforeRelease = serial.chooserCalls;
  assert.equal(await releaseSelectedSerialPort(serial, { controller }), a);
  assert.equal(serial.chooserCalls, chooserBeforeRelease, "the selected idle closed grant is preferred");
  await controller.onPortReleased(a);
  assert.equal(controller.getSelectedPort(), null);
  assert.equal(dom.root.dataset.connected, "false");
});
