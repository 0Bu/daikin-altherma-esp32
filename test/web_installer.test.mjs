// Installer module tests: offer integrity, serial-port ownership, probe/flash/monitor lifecycles,
// the device check and the page.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import {
  acquireSerialPortLease, forgetSerialPort, releaseSerialPortLease, serialPortLease
} from "../docs/serial-port-release.mjs";

import {
  attachWebInstaller,
  combinedProgress,
  describeSerialConnection,
  detectedSerialType,
  fetchFirmwareParts,
  fetchOfferPart,
  flashDevice,
  inspectInstalledFirmware,
  loadFirmwareOffer,
  otaSequenceCrc,
  parseAppDescription,
  parsePartitionTable,
  partitionTableLength,
  probeDevice,
  resetToUserFirmware,
  sameNvsLayout,
  selectBootPartition,
  serialLogLevel,
  selectManifestBuild,
  sharedPortTransport,
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

// partitions.csv in the ESP-IDF entry format; the entries match gen_esp32part.py output byte for byte
// (checked against the published daikin-altherma-esp32-web-partition-table.bin), padded like that file.
const PARTITION_TYPES = { app: 0, data: 1 };
const PARTITION_SUBTYPES = { nvs: 0x02, ota: 0x00, phy: 0x01, coredump: 0x03, undefined: 0x06, ota_0: 0x10, ota_1: 0x11 };
function partitionRows() {
  return fs.readFileSync(new URL("../partitions.csv", import.meta.url), "utf8").split("\n")
    .map((raw) => raw.trim()).filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").map((field) => field.trim()));
}
function partitionTableBytes(rows = partitionRows()) {
  const table = Buffer.alloc(0xc00, 0xff);
  rows.forEach(([name, type, subtype, offset, size], index) => {
    const at = index * 32;
    table.writeUInt16LE(0x50aa, at);
    table[at + 2] = PARTITION_TYPES[type];
    table[at + 3] = PARTITION_SUBTYPES[subtype];
    table.writeUInt32LE(Number(offset), at + 4);
    table.writeUInt32LE(Number(size), at + 8);
    table.fill(0, at + 12, at + 32);
    table.write(name, at + 12, 16, "latin1");
  });
  return table;
}
const PARTITION_TABLE = partitionTableBytes();
// The former 4 MB table (partitions.csv before commit 798f74c5): another layout, NVS in the same place.
const FORMER_4MB_ROWS = [
  ["nvs", "data", "nvs", "0x9000", "0x6000"],
  ["otadata", "data", "ota", "0xf000", "0x2000"],
  ["phy_init", "data", "phy", "0x11000", "0x1000"],
  ["coredump", "data", "coredump", "0x12000", "0xc000"],
  ["history", "data", "undefined", "0x1e000", "0x2000"],
  ["ota_0", "app", "ota_0", "0x20000", "0x1f0000"],
  ["ota_1", "app", "ota_1", "0x210000", "0x1f0000"]
];

// esp_image_header_t and the first segment header, then esp_app_desc_t (magic, version, project_name).
function appHead(project = "daikin-altherma-esp32", version = "1.2.3") {
  const head = Buffer.alloc(0x100, 0);
  head[0] = 0xe9;
  head.writeUInt32LE(0xabcd5432, 0x20);
  head.write(version, 0x30, 32, "latin1");
  head.write(project, 0x50, 32, "latin1");
  return head;
}

// esp_ota_select_entry_t; state 2 is ESP_OTA_IMG_VALID.
function otadataEntry(sequence, state = 2, crc = otaSequenceCrc(sequence)) {
  const entry = Buffer.alloc(32, 0xff);
  entry.writeUInt32LE(sequence, 0);
  entry.writeUInt32LE(state, 24);
  entry.writeUInt32LE(crc, 28);
  return entry;
}

// Sparse flash contents for readFlash; anything not listed reads as erased.
function flashImage(regions = { 0x8000: PARTITION_TABLE, 0x20000: appHead() }) {
  return (offset, length) => {
    const bytes = new Uint8Array(length).fill(0xff);
    for (const [start, data] of Object.entries(regions)) {
      for (let index = 0; index < data.length; index++) {
        const at = Number(start) + index - offset;
        if (at >= 0 && at < length) bytes[at] = data[index];
      }
    }
    return bytes;
  };
}
const INSTALLED_FLASH = flashImage();

function firmwareFixture(version = "1.2.3", byte = 0xa5) {
  const payloads = new Map(OFFICIAL_PARTS.map((part, index) =>
    [part.path, part.offset === 0x8000 ? Buffer.from(PARTITION_TABLE) : Buffer.alloc(part.size, (byte + index) & 0xff)]
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
    ["wrong offset", (f) => { f.document.builds[0].parts[3].offset = 0x400000; }],
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
    ["PHY data boundary", (f) => { f.index.artifacts[2].size = 0x2001; }],
    ["application slot boundary", (f) => { f.index.artifacts[3].size = 0x380001; }],
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
  // Only the HTTPS Pages feeds publish signed firmware; there is no local installer server to trust.
  for (const host of ["localhost:8765", "127.0.0.1:8765", "[::1]:8765", "localhost.example.test"]) {
    await assert.rejects(firmwareFixture().load(`http://${host}/manifest.json`), /HTTPS feed directory/, host);
  }
  assert.equal((await firmwareFixture("1.0.12-dev.8").load()).manifest.version, "1.0.12-dev.8");
  for (const version of ["0.2.10 setup", "1.0.12-setup", "1.0.12-rc.1"]) {
    await assert.rejects(firmwareFixture(version).load(), { name: "FirmwareIntegrityError" }, version);
  }
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

function fakeEsptool(chipFamily = "ESP32-S3", flashSize = "8MB") {
  const calls = [];
  const loaderOptions = [];
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
      loaderOptions.push(options);
    }
    async main() { calls.push("main"); }
    async flashId() { calls.push("flashId"); }
    async detectFlashSize() { calls.push("detectFlashSize"); return flashSize; }
    async eraseFlash() { calls.push("erase"); }
    async readFlash(offset, length) { return INSTALLED_FLASH(offset, length); }
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
  return { calls, writes, loaderOptions, Transport, Loader };
}

test("diag console strips caller line endings without changing ring or syslog bytes", () => {
  const source = fs.readFileSync(new URL("../main/diag_log.cpp", import.meta.url), "utf8");
  assert.match(source, /syslog_send\(line, total\);/);
  assert.match(source, /while \(console_total > 0[\s\S]*?line\[console_total - 1\] == '\\n'[\s\S]*?line\[console_total - 1\] == '\\r'/);
  assert.match(source, /ESP_LOGI\("diag", "%\.\*s", console_total, line\);/);
  assert.doesNotMatch(source, /ESP_LOGI\("diag", "%\.\*s", total, line\);/);
});

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
    dataset: {}, textContent: "", className: "", hidden: true, disabled: false,
    // Scrolling stands in for layout: one pixel per character of text.
    scrollTop: 0, clientHeight: 0, get scrollHeight() { return this.textContent.length; },
    style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } },
    attributes: new Map(), listeners: new Map(), children: [],
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    append(child) { this.children.push(child); this.textContent += child.textContent; },
    replaceChildren() { this.children = []; this.textContent = ""; },
    ownerDocument: { createElement: () => makeElement() }
  });
  const root = {
    dataset: {}, attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, makeElement());
      return elements.get(selector);
    },
    querySelectorAll() { return []; }
  };
  return { root, element: (id) => root.querySelector(`#${id}`) };
}

// The log's rendered lines with the level from their class (status, info, warning, error).
function logLines(dom, level) {
  return dom.element("serial-monitor-output").children
    .map((line) => ({ text: line.textContent.trimEnd(), level: line.className.replace(/^.*installer-monitor-line-/, "") }))
    .filter((line) => !level || line.level === level)
    .map((line) => line.text);
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
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader, fetchImpl: fixture.fetch, cryptoImpl: webcrypto,
    followLog: false
  });
  await controller.ready;
  assert.equal(dom.element("firmware-version-value").textContent, "1.2.3");
  await controller.connect();
  assert.equal(dom.element("flash-button").disabled, false);
  fixture.payloads.get(APP_NAME)[0] ^= 1;
  await controller.install();
  assert.match(logLines(dom, "error").join("\n"), /Flash failed:.*Reload this page/);
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
  assert.match(logLines(dom, "error").join("\n"), /Firmware verification is unavailable/);
  assert.equal(dom.element("connect-button").disabled, true);
  assert.equal(dom.element("flash-button").disabled, true);
  assert.equal(dom.element("clean-flash-button").disabled, true);
  assert.equal(dom.element("reset-button").disabled, true);
  assert.deepEqual(["connect-button", "reset-button", "flash-button", "clean-flash-button"].map((id) => dom.element(id).hidden),
    [false, false, false, false], "unavailable controls are greyed out, not hidden");
  assert.equal(dom.element("disconnect-button").hidden, true, "Disconnect shares Connect's place");
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
  const port = { getInfo() { return { usbVendorId: 0x303a, usbProductId: 0x1001 }; } };
  fake.Loader.prototype.after = async function after(mode) {
    fake.calls.push(`reset:${mode}`);
    throw resetError;
  };

  await assert.rejects(flashDevice({
    port,
    offer,
    eraseFirst: false,
    TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader,
    fetchImpl: fixture.fetch
  }), (error) => {
    assert.notEqual(error, resetError);
    assert.equal(error.cause, resetError);
    assert.equal(error.cleanupError, resetError);
    assert.match(error.message, /reset failed.*serial port is closed/);
    assert.doesNotMatch(error.message, /stays reserved|remains reserved/);
    return true;
  });
  assert.equal(resetError.message, "reset failed");
  assert.equal(serialPortLease(port), undefined);

  assert.deepEqual(fake.calls.slice(-4), [
    "write",
    "reset:hard_reset",
    "reset:hard_reset",
    "disconnect"
  ]);
});

test("cleanup composition preserves DOMException and frozen primary errors without masking them", async (t) => {
  const underlying = new Error("original lower-level cause");
  for (const primary of [
    new DOMException("native write denied", "OperationError"),
    Object.freeze(new Error("frozen native write failed", { cause: underlying }))
  ]) {
    await t.test(primary.name, async () => {
      const fixture = firmwareFixture();
      const offer = await fixture.load();
      const fake = fakeEsptool();
      const originalMessage = primary.message;
      const originalCause = primary.cause;
      const closing = new DOMException("native close denied", "NetworkError");
      fake.Loader.prototype.writeFlash = async () => { throw primary; };
      fake.Transport.prototype.disconnect = async () => { throw closing; };
      // The write failed on an open port, so the failed close leaves it open and reserved.
      const port = { readable: {}, writable: {}, getInfo() { return {}; } };
      await assert.rejects(flashDevice({
        port, offer, eraseFirst: false, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
        fetchImpl: fixture.fetch
      }), (error) => {
        assert.notEqual(error, primary);
        assert.equal(error.name, primary.name);
        assert.equal(error.cause, primary);
        assert.equal(error.cleanupError, closing);
        assert.ok(error.message.includes(originalMessage));
        assert.match(error.message, /native close denied.*remains reserved/);
        return true;
      });
      assert.equal(primary.message, originalMessage);
      assert.equal(primary.cause, originalCause);
      assert.equal(primary.cleanupError, undefined);
      assert.equal(serialPortLease(port).phase, "quarantined");
    });
  }
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

test("the published page checks the device first and keeps one log below the card", () => {
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  for (const id of ["connect-button", "disconnect-button", "reset-button", "flash-button", "clean-flash-button",
    "serial-monitor-output", "serial-monitor-live", "firmware-version-value", "release-channel"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
  }
  // Device controls come first. Until the page has checked its offer and a device, controls are greyed
  // out; only Disconnect, which shares Connect's place, starts hidden.
  assert.match(html, /id="connect-button"[\s\S]*id="disconnect-button"[\s\S]*id="reset-button"[\s\S]*id="flash-button"[\s\S]*id="clean-flash-button"/);
  assert.doesNotMatch(html, /unpair|Remove browser permission|release-serial-port/i,
    "Disconnect unpairs; there is no separate permission control");
  for (const id of ["connect-button", "reset-button", "flash-button", "clean-flash-button"]) {
    const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(html)[0];
    assert.match(tag, / disabled>$/, id);
    assert.doesNotMatch(tag, /\shidden\b/, id);
  }
  assert.match(html, /<button[^>]*id="disconnect-button"[^>]*hidden disabled>/);
  assert.match(html, /\.installer-button:disabled \{ cursor:default; opacity:\.5;/);
  // Flash and Clean flash are two buttons side by side; the page offers no erase choice besides them.
  assert.match(html, /<div class="installer-group" aria-label="Firmware">\s*<button[^>]*id="flash-button"[^>]*>Flash<\/button>\s*<button[^>]*id="clean-flash-button"[^>]*>Clean flash<\/button>\s*<\/div>/);
  assert.match(html, /id="flash-button"\s+title="Keeps WiFi, MQTT and X10A settings"/);
  assert.match(html, /id="clean-flash-button"\s+title="Erases all flash first"/);
  assert.doesNotMatch(html, /aria-haspopup|role="menu"|type="checkbox"|type="radio"|role="switch"|install-mode/);
  assert.match(html, /<img class="installer-logo" src="\.\/heat-pump-icon\.png" alt="" aria-hidden="true">/);
  // Only the offered version and its channel sit under the product name; both arrive with the manifest.
  assert.match(html, /<h1 id="installer-title">daikin-altherma-esp32<\/h1>\s*<p class="installer-version" id="firmware-version"><span class="installer-version-value" id="firmware-version-value"><\/span><span class="installer-channel" id="release-channel"><\/span><\/p>/);
  assert.match(html, /\.installer-version \{ min-height:1\.5em;/);
  assert.ok(html.includes('channel: /\\/dev\\/(index\\.html)?$/.test(location.pathname) ? "development" : "release"'),
    "the channel comes from the page path");
  assert.ok(html.includes('trace: new URLSearchParams(location.search).has("trace")'), "?trace enables the packet trace");
  // All messages go to the log: no status line, device tiles, step rail or unsupported-browser note.
  assert.doesNotMatch(html, /id="(page-status|serial-unsupported|connection-label|device-value|compatibility-value)"|installer-step|installer-rail/);
  // A port the browser still lists as paired is reconnected once the offer is verified.
  assert.match(html, /controller\.ready\.then\(\(\) => controller\.reconnectPaired\(\)\);/);
  // No separate progress bar: the flash button that was clicked fills up, and all buttons share one width.
  assert.doesNotMatch(html, /installer-progress|role="progressbar"/);
  assert.match(html, /\.installer-button\[data-progress\] \{[^}]*opacity:1;[^}]*linear-gradient\(to right, var\(--progress-fill\) var\(--progress, 0%\)/s);
  assert.match(html, /\.installer-button \{\s*width:8\.5rem;/);
  // Button colours set background-color only, so they never wipe the progress fill.
  assert.doesNotMatch(html, /(installer-button[^{]*|#clean-flash-button) \{[^}]*\bbackground:/);
  assert.match(html, /\.installer-group > \.installer-button \{ flex:1 1 0; width:auto; min-width:0; \}/);
  // The log hangs below the card as a tongue at a height that depends only on the window. It starts in,
  // and only the controller's data-log slides it out (no toggle of its own); long lines stay unwrapped.
  assert.match(html, /<main class="installer" id="web-installer"[^>]* data-log="closed">/);
  assert.match(html, /<\/section>\s*<section class="installer-log" id="serial-log" aria-label="Log" aria-hidden="true" inert>/);
  assert.match(html, /\.installer \{ --log-height:clamp\(180px, 41\.25vh, 360px\); \}/);
  assert.match(html, /\.installer-log \{[^}]*max-height:0; margin:0 18px;[^}]*border:0 solid var\(--line\); border-radius:0 0 14px 14px;[^}]*opacity:0; transform:translateY\(-24px\); pointer-events:none;/s);
  assert.match(html, /\.installer\[data-log="open"\] \.installer-log \{[^}]*max-height:calc\(var\(--log-height\) \+ 40px\); border-width:0 1px 1px; opacity:1; transform:translateY\(0\);/s);
  assert.match(html, /\.installer-monitor-output \{[^}]*height:var\(--log-height\);/s);
  assert.doesNotMatch(html, /\.installer-monitor-output \{[^}]*(min-height|max-height)/s);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{ \.installer-log \{ transition:none !important; \} \}/);
  assert.doesNotMatch(html, /serial-monitor-button|aria-controls="serial-monitor|data-monitor/);
  assert.match(html, /\.installer-monitor-output \{[^}]*overflow:auto;[^}]*white-space:pre;[^}]*overflow-wrap:normal;/s);
  assert.match(html, /\.installer-monitor-output::-webkit-scrollbar \{ width:8px; height:0; \}/,
    "long lines scroll without a visible horizontal bar");
  assert.doesNotMatch(html, /\.installer-monitor-output \{[^}]*scrollbar-(width|color)/s,
    "standard scrollbar properties would make Chromium ignore the pseudo-elements");
  assert.match(html, /\.installer-live\[data-state="flashing"\]/);
  // After flashing is its own card below the log and keeps the setup network, address and breaker-off wiring.
  assert.match(html, /<section class="installer-log"[\s\S]*<section class="installer-card installer-after"/);
  assert.match(html, /daikin-altherma-esp32-setup[\s\S]*http:\/\/daikin-altherma-esp32\.local[\s\S]*breaker off/);
  // The pinned esptool-js bundle is vendored and imported from the page's own directory, never a CDN.
  assert.match(html, /from "\.\/esptool-js-[0-9]+\.[0-9]+\.[0-9]+\.bundle\.js"/);
  assert.doesNotMatch(html, /https:\/\/cdn\.|jsdelivr|unpkg|esp-web-install-button/);
});

// Reviewed bundles by version: a bump vendors new bytes after checking the npm tarball integrity and
// adds their digest here.
const VENDORED_ESPTOOL_SHA256 = { "0.7.0": "00ebe6fb0b202976d3e2a3c6b9a6bd438c26a81d2af6739c95ac276a64c1a84e" };

test("the vendored esptool-js bundle is the reviewed npm file, self-contained and published flat", () => {
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const version = /from "\.\/esptool-js-([0-9]+\.[0-9]+\.[0-9]+)\.bundle\.js"/.exec(html)?.[1];
  assert.ok(version, "the page imports a vendored esptool-js bundle");
  const vendor = new URL("../docs/vendor/", import.meta.url);
  assert.deepEqual(fs.readdirSync(vendor).sort(), [`esptool-js-${version}.LICENSE`, `esptool-js-${version}.bundle.js`],
    "exactly the imported version is vendored");
  const bundle = fs.readFileSync(new URL(`esptool-js-${version}.bundle.js`, vendor));
  assert.equal(digest(bundle), VENDORED_ESPTOOL_SHA256[version], `esptool-js ${version} is not a reviewed bundle`);
  assert.doesNotMatch(bundle.toString("utf8"), /\bimport\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|^\s*import\s/m,
    "the bundle loads nothing at run time");
  const license = fs.readFileSync(new URL(`esptool-js-${version}.LICENSE`, vendor), "utf8");
  const escaped = version.replaceAll(".", "\\.");
  assert.match(license, new RegExp(`^esptool-js ${escaped} \\(npm\\), bundle\\.js, unmodified\\.\\nTarball integrity: sha512-[A-Za-z0-9+/]{86}==\\n\\n`));
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.ok(html.includes(`href="./esptool-js-${version}.LICENSE"`), "the footer links the vendored license");
  // Pages publishes both files flat next to the page, and the readback requires both.
  const pages = fs.readFileSync(new URL("../scripts/build-pages.sh", import.meta.url), "utf8");
  assert.ok(pages.includes(`cp docs/vendor/esptool-js-${version}.bundle.js docs/vendor/esptool-js-${version}.LICENSE "$OUT/"`));
  const readback = fs.readFileSync(new URL("../scripts/verify-published-artifacts.py", import.meta.url), "utf8");
  assert.ok(readback.includes(`"esptool-js-${version}.bundle.js", "esptool-js-${version}.LICENSE"`));
  const notices = fs.readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.ok(notices.includes(`[\`esptool-js\`](https://github.com/espressif/esptool-js) ${version} is vendored unmodified`));
});

test("the offered version arrives with its channel; an unknown channel shows none", async (t) => {
  for (const [channel, shown] of [["development", "development"], ["release", "release"], ["preview", ""]]) {
    await t.test(channel, async (st) => {
      const { dom } = await attachedLifecycle(st, [lifecyclePort("A")], { channel });
      assert.equal(dom.element("firmware-version-value").textContent, "1.2.3");
      assert.equal(dom.element("release-channel").textContent, shown);
      assert.equal(dom.element("release-channel").dataset.kind, shown || undefined);
    });
  }
});

test("the log head says Flashing while the flasher owns the port, then follows the new firmware", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a], { followLog: true });
  await completeLogStart(t, a, controller.connect());
  a.writeEntered = pendingNative();
  a.writeWait = pendingNative();
  const install = dom.element("flash-button").listeners.get("click")();
  await a.writeEntered.promise;
  assert.deepEqual([dom.element("serial-monitor-live").textContent, dom.element("serial-monitor-live").dataset.state],
    ["Flashing", "flashing"]);
  a.writeWait.resolve();
  await completeLogStart(t, a, install);
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  a.writeWait = pendingNative();
  a.writeEntered = pendingNative();
  a.writeError = new Error("write failed");
  const failed = dom.element("flash-button").listeners.get("click")();
  await a.writeEntered.promise;
  a.writeWait.resolve();
  await finishSignalReset(t, failed);
  assert.equal(dom.element("serial-monitor-live").textContent, "Stopped", "a failed install leaves no Flashing state");
  assert.match(logLines(dom, "error").at(-1), /\] Flash failed: write failed$/);
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
    name, writable: null, opens: 0, closes: 0, signals: [], forgets: 0,
    reads: 0, resets: 0, flashIds: 0, writes: 0, isOpen: false, stream: null,
    getInfo() { return {}; },
    // Like Web Serial: while the port is open, a cancelled input stream is replaced by a new one.
    get readable() {
      if (!this.isOpen) return null;
      this.stream ||= this.readerSource || new ReadableStream({
        start: (controller) => { this.readController = controller; },
        cancel: () => { this.stream = null; }
      });
      return this.stream;
    },
    async open(options) {
      this.opens++;
      this.openOptions = options;
      if (this.isOpen) throw new DOMException("The port is already open.", "InvalidStateError");
      if (this.openFailures > 0) {
        this.openFailures--;
        throw new DOMException("Failed to open serial port.", "NetworkError");
      }
      if (this.openWait) await this.openWait.promise;
      this.isOpen = true;
      this.writable = this.heldWriter || {};
    },
    async close() {
      this.closes++;
      if (this.closeWait) await this.closeWait.promise;
      if (this.closeError) throw this.closeError;
      if (this.readable?.locked) throw new Error("native readable stream is still locked");
      this.isOpen = false;
      this.stream = null;
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

// Like esptool-js 0.7.0: the loader opens the port through Transport.connect(device.open) and the
// transport closes it in disconnect().
function lifecycleEsptool() {
  class Transport {
    constructor(port) { this.port = port; this.device = port; }
    async connect(baudRate, options) { await this.device.open({ baudRate, ...options }); }
    async disconnect() { await this.port.close(); }
  }
  class Loader {
    constructor(options) { this.options = options; this.port = options.transport.port; }
    async main() {
      await this.options.transport.connect(115200, this.options.serialOptions);
      if (this.port.mainError) throw this.port.mainError;
      if (this.options.enableTracing) {
        this.options.terminal.write(`native ${this.port.name}`);
        this.options.transport.trace(`main packet ${this.port.name}`);
      }
      this.port.mainEntered?.resolve();
      if (this.port.mainWait) await this.port.mainWait.promise;
      this.chip = { CHIP_NAME: "ESP32-S3" };
      this.options.terminal.writeLine(`native ${this.port.name}`);
    }
    async flashId() { this.port.flashIds++; }
    async detectFlashSize() { return "8MB"; }
    async readFlash(offset, length) { return (this.port.flash || INSTALLED_FLASH)(offset, length); }
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

// The ownership tests drive the live log themselves; followLog is exercised separately. `forget`
// stands in for a browser whose SerialPort can forget its permission.
async function attachedLifecycle(t, ports, { followLog = false, forget = false, trace = false, channel } = {}) {
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
    fetchImpl: fixture.fetch, cryptoImpl: webcrypto, followLog, trace, channel,
    SerialPortCtor: forget ? { prototype: { forget() {} } } : undefined
  });
  await controller.ready;
  return { controller, serial, dom, fixture, fake };
}

async function until(predicate) {
  for (let turn = 0; turn < 500 && !predicate(); turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(predicate(), "the awaited native step was not reached");
}

// Drives resetToUserFirmware's two mocked delays once the live log has really reached them, also
// when downloads and WebCrypto digests run first. Pass a function when the operation may signal
// before its first await (Reset on a live log), so the count starts before it.
async function completeLogStart(t, port, operation) {
  const start = port.signals.length;
  if (typeof operation === "function") operation = operation();
  await until(() => port.signals.length === start + 1);
  t.mock.timers.tick(100);
  await until(() => port.signals.length === start + 2);
  t.mock.timers.tick(250);
  await operation;
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
  assert.equal(dom.element("reset-button").attributes.get("aria-busy"), "true");
  const disconnecting = controller.disconnect();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await disconnecting;
  await starting;
  assert.ok(serialPortLease(a), "the delayed native open must retain A's lease");
  serial.choice = b;
  await controller.connect();
  const before = lifecycleUi(dom);
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
  t.mock.timers.tick(19999);
  await drainNativeTasks();
  assert.equal(dom.root.dataset.connected, "false");
  assert.doesNotMatch(dom.element("serial-monitor-output").textContent, /still pending/, "the chip probe and the firmware check share 20 s");
  t.mock.timers.tick(1);
  await probing;
  assert.match(logLines(dom, "error").join("\n"), /native serial operation is still pending/);
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
  assert.match(logLines(dom, "error").join("\n"), /cleanup timed out/);
  assert.equal(dom.root.dataset.connected, "false");
  assert.equal(dom.element("flash-button").disabled, true);
  assert.ok(serialPortLease(a));
  await controller.connect();
  assert.match(logLines(dom, "error").at(-1), /\] Probe failed: Port busy: a previous operation is still closing\.$/);
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
  assert.match(logLines(dom, "error").join("\n"), /original native write failure.*native close rejected/);
  assert.equal(dom.root.dataset.finished, "false");
  assert.equal(serialPortLease(a).phase, "quarantined");
  assert.equal(dom.element("flash-button").disabled, true);
  assert.equal(dom.element("clean-flash-button").disabled, true);
  assert.equal(a.forgets, 0);
});

test("attached disconnect cannot report a clean stop when native close resolves without closing the port", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  await finishSignalReset(t, controller.startMonitor());
  a.close = async () => { a.closes++; };
  await controller.disconnect();
  assert.match(logLines(dom, "error").at(-1), /Disconnect:.*closure could not be confirmed/);
  assert.equal(serialPortLease(a).phase, "quarantined");
});

test("Reset on a live log only pulses the reset line: no close, no reopen", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  await finishSignalReset(t, controller.startMonitor());
  const [opens, closes, signals] = [a.opens, a.closes, a.signals.length];
  await finishSignalReset(t, controller.reset());
  assert.deepEqual([a.opens - opens, a.closes - closes, a.signals.length - signals], [0, 0, 2]);
  assert.deepEqual(a.signals.slice(-2), [
    { dataTerminalReady: false, requestToSend: true }, { dataTerminalReady: false, requestToSend: false }
  ], "EN pulsed with IO0 high");
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  assert.ok(logLines(dom, "status").some((line) => /\] Reset to firmware$/.test(line)));
  assert.deepEqual(logLines(dom, "error"), []);
});

test("attached failed firmware reset reports failure with confirmed closure and no reservation", async (t) => {
  const a = lifecyclePort("A");
  const { controller, dom, fake } = await attachedLifecycle(t, [a]);
  await controller.connect();
  const primary = new DOMException("firmware reset was rejected", "NotSupportedError");
  fake.Loader.prototype.after = async () => { throw primary; };
  await controller.install();
  assert.equal(a.writes, 1);
  assert.equal(a.readable, null);
  assert.equal(serialPortLease(a), undefined);
  assert.equal(primary.message, "firmware reset was rejected");
  const failure = logLines(dom, "error").join("\n");
  assert.match(failure, /Flash failed:.*firmware reset was rejected.*serial port is closed/);
  assert.doesNotMatch(failure, /stays reserved|remains reserved|TypeError/);
  assert.equal(dom.root.dataset.finished, "false");
});

test("attached natural monitor EOF releases its real reader and closes without a spurious cancellation error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  await finishSignalReset(t, controller.startMonitor());
  const nativeStream = a.readable;
  a.readController.enqueue(new TextEncoder().encode("normal completed log"));
  a.readController.close();
  await drainNativeTasks();
  assert.equal(nativeStream.locked, false);
  assert.equal(a.readable, null);
  assert.equal(serialPortLease(a), undefined);
  assert.equal(a.closes, 2);
  assert.equal(dom.element("serial-monitor-live").textContent, "Stopped");
  assert.deepEqual(logLines(dom, "error"), []);
  assert.match(dom.element("serial-monitor-output").textContent, /normal completed log/);
});

test("attached natural monitor read error keeps the native error and still confirms closure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  await finishSignalReset(t, controller.startMonitor());
  const nativeStream = a.readable;
  const primary = new DOMException("native serial read lost", "NetworkError");
  a.readController.error(primary);
  await drainNativeTasks();
  assert.equal(nativeStream.locked, false);
  assert.equal(a.readable, null);
  assert.equal(serialPortLease(a), undefined);
  assert.equal(primary.message, "native serial read lost");
  assert.equal(dom.element("serial-monitor-live").textContent, "Error");
  const [stopped] = logLines(dom, "error");
  assert.match(stopped, /Monitor stopped: native serial read lost/);
  assert.doesNotMatch(stopped, /TypeError|stays reserved|remains reserved/);
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
  const resetting = controller.reset();
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

test("connect follows the firmware log, reset restarts it and an update hands it back to the log", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a], { followLog: true });
  await completeLogStart(t, a, controller.connect());
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  const portUse = () => ({ opens: a.opens, closes: a.closes, hardResets: a.resets });
  assert.deepEqual(portUse(), { opens: 1, closes: 0, hardResets: 0 },
    "the check hands its open port to the log, which resets the chip itself");
  assert.equal(a.openOptions.bufferSize, 0x10000, "the one open uses esptool-js's large buffer");
  assert.deepEqual(logLines(dom, "warning"), []);
  assert.equal(dom.element("connect-button").hidden, true);
  assert.equal(dom.element("disconnect-button").hidden, false);
  assert.equal(dom.element("flash-button").disabled, false, "the live log yields the port to flashing");
  assert.deepEqual(["reset-button", "flash-button", "clean-flash-button"].map((id) => dom.element(id).disabled),
    [false, false, false]);
  assert.deepEqual(["flash-button", "clean-flash-button"].map((id) => dom.element(id).hidden), [false, false]);
  assert.match(dom.element("serial-monitor-output").textContent, /\] Installed: daikin-altherma-esp32 1\.2\.3 \(ota_0\); partition table matches$/m);
  await completeLogStart(t, a, () => controller.reset());
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  assert.equal(a.signals.length, 4, "reset pulses EN with IO0 high again");
  assert.deepEqual(portUse(), { opens: 1, closes: 0, hardResets: 0 }, "Reset keeps the log's port");
  await completeLogStart(t, a, dom.element("flash-button").listeners.get("click")());
  assert.equal(dom.root.dataset.finished, "true");
  assert.equal(a.writes, 1);
  assert.equal(a.erases, undefined, "Flash keeps WiFi, MQTT and X10A settings");
  assert.equal(dom.element("serial-monitor-live").textContent, "Live", "the log follows the new firmware");
  assert.ok(serialPortLease(a), "the live log owns the port again");
  assert.deepEqual(portUse(), { opens: 1, closes: 0, hardResets: 0 },
    "the install borrows the open port and the log starts the new firmware");
  await completeLogStart(t, a, dom.element("clean-flash-button").listeners.get("click")());
  assert.deepEqual([a.erases, a.writes], [1, 2], "Clean flash erases before writing");
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  await controller.disconnect();
  assert.equal(serialPortLease(a), undefined);
  assert.equal(a.readable, null);
  assert.deepEqual(portUse(), { opens: 1, closes: 1, hardResets: 0 }, "Disconnect is the only close");
  assert.equal(dom.element("connect-button").hidden, false);
  assert.match(logLines(dom, "status").join("\n"), /\] Installed 1\.2\.3$/m);
});

test("the log follows new lines only while it is scrolled to its end", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a], { followLog: true });
  await completeLogStart(t, a, controller.connect());
  const log = dom.element("serial-monitor-output");
  log.clientHeight = 50;
  const scrollTo = (top) => { log.scrollTop = top; log.listeners.get("scroll")(); };
  const write = async (text) => { a.readController.enqueue(new TextEncoder().encode(text)); await drainNativeTasks(); };
  await write("first line\n");
  assert.equal(log.scrollTop, log.scrollHeight, "at the end the log follows");
  scrollTo(10);
  await write("second line\n");
  assert.equal(log.scrollTop, 10, "scrolled up, the view holds");
  scrollTo(log.scrollHeight - log.clientHeight - 8);
  await write("third line\n");
  assert.equal(log.scrollTop, log.scrollHeight, "back at the end it follows again");
  // Older lines are dropped above a held view; it keeps showing the same lines.
  await write(`${"x".repeat(59)}\n`.repeat(800));
  scrollTo(45000);
  const total = log.textContent.length + 60 * 1100;
  await write(`${"y".repeat(59)}\n`.repeat(1100));
  assert.ok(log.textContent.length < total, "the log was trimmed");
  assert.equal(log.scrollTop, 45000 - (total - log.textContent.length));
});

test("other firmware, NVS elsewhere or an erased chip offer only Clean flash", async (t) => {
  const movedNvs = partitionTableBytes(partitionRows().map((row) => row[0] === "nvs" ? [...row.slice(0, 3), "0xa000", "0x5000"] : row));
  const renamedNvs = partitionTableBytes(partitionRows().map((row) => row[0] === "nvs" ? ["config", ...row.slice(1)] : row));
  for (const [name, flash, installed] of [
    ["other firmware", flashImage({ 0x8000: PARTITION_TABLE, 0x20000: appHead("micropython", "v1.24.1") }), "micropython v1.24.1"],
    ["NVS moved", flashImage({ 0x8000: movedNvs, 0x20000: appHead() }), "daikin-altherma-esp32 1.2.3"],
    ["NVS renamed", flashImage({ 0x8000: renamedNvs, 0x20000: appHead() }), "daikin-altherma-esp32 1.2.3"],
    ["erased chip", flashImage({}), "none"]
  ]) {
    await t.test(name, async (st) => {
      const a = lifecyclePort("A");
      a.flash = flash;
      const { controller, dom } = await attachedLifecycle(st, [a]);
      await controller.connect();
      assert.match(logLines(dom, "status").join("\n"), new RegExp(`\\] Installed: ${installed}[ ;]`));
      assert.match(logLines(dom, "warning").at(-1), /\] Clean flash required$/);
      assert.deepEqual([dom.element("flash-button").hidden, dom.element("flash-button").disabled], [true, true],
        "only Clean flash is offered");
      assert.deepEqual([dom.element("clean-flash-button").hidden, dom.element("clean-flash-button").disabled], [false, false]);
      await controller.install();
      assert.match(logLines(dom, "error").at(-1), /\] Flash refused: Clean flash required$/);
      assert.equal(a.writes, 0, "the API refuses a keep-data install as well");
      await dom.element("clean-flash-button").listeners.get("click")();
      assert.equal(a.erases, 1);
      assert.equal(a.writes, 1);
      assert.deepEqual([dom.element("flash-button").hidden, dom.element("flash-button").disabled], [false, false],
        "after installing, updates keep data again");
    });
  }
});

test("the former 4 MB layout keeps NVS in place, so Flash updates it without erasing", async (t) => {
  const a = lifecyclePort("A");
  a.flash = flashImage({ 0x8000: partitionTableBytes(FORMER_4MB_ROWS), 0x20000: appHead("daikin-altherma-esp32", "1.0.9") });
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  assert.match(logLines(dom, "status").join("\n"),
    /\] Installed: daikin-altherma-esp32 1\.0\.9 \(ota_0\); partition table differs; NVS layout matches$/m);
  assert.deepEqual(logLines(dom, "warning"), []);
  assert.deepEqual([dom.element("flash-button").hidden, dom.element("flash-button").disabled], [false, false]);
  await dom.element("flash-button").listeners.get("click")();
  assert.deepEqual([a.erases, a.writes], [undefined, 1], "Flash writes the new table around NVS without erasing");
});

test("a stuck flash read leaves the firmware unknown, keeps both actions and releases the port", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const reads = [];
  a.flash = (offset) => { reads.push(offset); return new Promise(() => {}); };
  const { controller, dom } = await attachedLifecycle(t, [a]);
  const connecting = controller.connect();
  await until(() => reads.length === 1);
  t.mock.timers.tick(2499);
  await drainNativeTasks();
  assert.equal(dom.root.dataset.connected, "false", "each read gets 2.5 s");
  t.mock.timers.tick(1);
  await connecting;
  assert.deepEqual(reads, [0x8000], "no further reads after a timeout");
  assert.equal(dom.root.dataset.connected, "true");
  assert.equal(serialPortLease(a), undefined, "the probe closed the port normally");
  assert.match(logLines(dom, "warning").join("\n"),
    /\] Installed firmware unknown: Reading flash at 0x8000 timed out\.$/);
  assert.deepEqual(["flash-button", "clean-flash-button"].map((id) => [dom.element(id).hidden, dom.element(id).disabled]),
    [[false, false], [false, false]], "unknown is not foreign: Flash and Clean flash stay available");
  a.flash = null;
  await controller.install();
  assert.deepEqual([a.erases, a.writes], [undefined, 1], "a keep-data update is allowed");
});

test("a failed app read after the table keeps the table's NVS verdict", async (t) => {
  const movedNvs = partitionTableBytes(partitionRows().map((row) => row[0] === "nvs" ? [...row.slice(0, 3), "0xa000", "0x5000"] : row));
  for (const [name, table, offered, warning] of [
    ["NVS elsewhere", movedNvs, false, /\] Installed firmware unknown: Reading flash at 0x20000 timed out\.; NVS elsewhere$/],
    ["NVS in place", PARTITION_TABLE, true, /\] Installed firmware unknown: Reading flash at 0x20000 timed out\.; NVS layout matches$/]
  ]) {
    await t.test(name, async (st) => {
      st.mock.timers.enable({ apis: ["setTimeout"] });
      const a = lifecyclePort("A");
      const reads = [];
      const image = flashImage({ 0x8000: table, 0x20000: appHead() });
      a.flash = (offset, length) => { reads.push(offset); return offset === 0x20000 ? new Promise(() => {}) : image(offset, length); };
      const { controller, dom } = await attachedLifecycle(st, [a]);
      const connecting = controller.connect();
      await until(() => reads.includes(0x20000));
      st.mock.timers.tick(2500);
      await connecting;
      assert.deepEqual(reads, [0x8000, 0xf000, 0x10000, 0x20000], "the table and otadata were read before the app timed out");
      assert.match(logLines(dom, "warning")[0], warning);
      assert.deepEqual([dom.element("flash-button").hidden, dom.element("flash-button").disabled], [!offered, !offered]);
      assert.equal(logLines(dom, "warning").some((line) => /Clean flash required$/.test(line)), !offered);
      a.flash = null;
      await controller.install();
      assert.equal(a.writes, offered ? 1 : 0, offered ? "an unread app with NVS in place may keep data" : "NVS elsewhere refuses keep-data");
    });
  }
});

test("the Disconnect button also unpairs exactly the connected port", async (t) => {
  const [a, b] = ["A", "B"].map((name) => lifecyclePort(name));
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b], { forget: true });
  serial.choice = b;
  await controller.connect();
  const chooserCalls = serial.chooserCalls;
  await dom.element("disconnect-button").listeners.get("click")();
  assert.deepEqual([a.forgets, b.forgets], [0, 1], "only the connected port is released");
  assert.equal(serial.chooserCalls, chooserCalls, "without asking which port");
  assert.deepEqual(serial.grants, [a]);
  assert.equal(b.readable, null);
  assert.equal(controller.getSelectedPort(), null);
  assert.equal(dom.element("connect-button").hidden, false);
  assert.match(dom.element("serial-monitor-output").textContent, /\] Port unpaired$/m);
  assert.deepEqual(logLines(dom, "error"), []);
  await dom.element("disconnect-button").listeners.get("click")();
  assert.deepEqual([a.forgets, b.forgets], [0, 1], "nothing connected: nothing to unpair");
});

test("the log slides out on connecting and for warnings, and back in on Disconnect or unplug", async (t) => {
  const a = lifecyclePort("A");
  const { controller, serial, dom } = await attachedLifecycle(t, [a], { forget: true });
  const log = () => [dom.root.dataset.log, dom.element("serial-log").attributes.get("aria-hidden"), dom.element("serial-log").inert];
  const chooser = serial.requestPort;
  serial.requestPort = async () => { throw new DOMException("No port selected.", "NotFoundError"); };
  await controller.connect();
  assert.notDeepEqual(log(), ["open", "false", false], "a cancelled port dialog leaves the log in");
  serial.requestPort = chooser;
  await controller.connect();
  assert.deepEqual(log(), ["open", "false", false], "connecting slides the log out");
  await dom.element("disconnect-button").listeners.get("click")();
  assert.deepEqual(log(), ["closed", "true", true], "Disconnect slides it back in");
  a.mainError = new Error("no sync");
  await controller.connect();
  assert.match(logLines(dom, "error").at(-1), /\] Probe failed: no sync$/);
  assert.deepEqual(log(), ["open", "false", false], "a failed check stays readable without a connection");
  delete a.mainError;
  await controller.disconnect();
  await controller.connect();
  assert.deepEqual(log(), ["open", "false", false]);
  await serial.listeners.get("disconnect")[0]({ port: a });
  assert.deepEqual(log(), ["closed", "true", true], "unplugging slides it in");
});

test("an error slides the log out even when nothing was ever connected", async (t) => {
  const priorLocation = globalThis.location;
  const priorSecureContext = globalThis.isSecureContext;
  globalThis.location = { href: "https://example.test/dev/index.html" };
  globalThis.isSecureContext = true;
  t.after(() => { globalThis.location = priorLocation; globalThis.isSecureContext = priorSecureContext; });
  const dom = installerDom();
  const fake = lifecycleEsptool();
  const fixture = firmwareFixture();
  const controller = attachWebInstaller({ root: dom.root, serial: undefined, TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader, fetchImpl: fixture.fetch, cryptoImpl: webcrypto });
  await controller.ready;
  assert.match(logLines(dom, "error").at(-1), /\] Web Serial unavailable \(Chrome or Edge required\)$/);
  assert.deepEqual([dom.root.dataset.log, dom.element("serial-log").attributes.get("aria-hidden"), dom.element("serial-log").inert],
    ["open", "false", false]);
});

test("Disconnect during a check waits for the port before unpairing it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  a.mainWait = pendingNative();
  a.mainEntered = pendingNative();
  const { controller, dom } = await attachedLifecycle(t, [a], { forget: true });
  const probing = controller.connect();
  await a.mainEntered.promise;
  const disconnecting = dom.element("disconnect-button").listeners.get("click")();
  await drainNativeTasks();
  t.mock.timers.tick(2000);
  await drainNativeTasks();
  assert.equal(controller.getSelectedPort(), null);
  assert.ok(serialPortLease(a), "esptool-js is still trying to connect");
  assert.equal(a.forgets, 0, "not while the cancelled probe owns the port");
  a.mainWait.resolve();
  await probing;
  await disconnecting;
  assert.equal(serialPortLease(a), undefined);
  assert.equal(a.forgets, 1, "unpaired once the port is free");
  assert.match(logLines(dom, "status").at(-1), /\] Port unpaired$/);
});

test("Disconnect stops a live log before unpairing; unplugging and older browsers only disconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = lifecyclePort("A");
  const { controller, serial, dom } = await attachedLifecycle(t, [a], { forget: true });
  await controller.connect();
  await finishSignalReset(t, controller.startMonitor());
  assert.equal(dom.element("serial-monitor-live").textContent, "Live");
  await dom.element("disconnect-button").listeners.get("click")();
  assert.equal(a.forgets, 1);
  assert.equal(a.readable, null, "the log was stopped and the port closed before forgetting");
  assert.equal(serialPortLease(a), undefined);
  assert.equal(dom.element("serial-monitor-live").textContent, "Stopped");

  serial.grants = [a];
  await controller.connect();
  await serial.listeners.get("disconnect")[0]({ port: a });
  assert.equal(controller.getSelectedPort(), null, "unplugging disconnects");
  assert.equal(a.forgets, 1, "but keeps the pairing");

  const b = lifecyclePort("B");
  const plain = await attachedLifecycle(t, [b]);
  await plain.controller.connect();
  await plain.dom.element("disconnect-button").listeners.get("click")();
  assert.equal(b.forgets, 0, "without SerialPort.forget nothing is unpaired");
  assert.equal(plain.controller.getSelectedPort(), null);
  assert.deepEqual(logLines(plain.dom, "error"), []);
});

test("?trace adds esptool-js's packet trace to the log as whole lines, and only then", async (t) => {
  const a = lifecyclePort("A");
  const traced = await attachedLifecycle(t, [a], { trace: true });
  await traced.controller.connect();
  assert.ok(logLines(traced.dom).some((line) => /^TRACE \+\d+ ms main packet A$/.test(line)));
  assert.ok(logLines(traced.dom).some((line) => line === "native A"), "esptool's own line stays apart from the trace");
  const b = lifecyclePort("B");
  const plain = await attachedLifecycle(t, [b]);
  await plain.controller.connect();
  assert.doesNotMatch(plain.dom.element("serial-monitor-output").textContent, /TRACE/);
});

test("a single paired port reconnects without the chooser after a reload or a replug", async (t) => {
  const [a, b] = ["A", "B"].map((name) => lifecyclePort(name));
  const { controller, serial, dom } = await attachedLifecycle(t, [a, b], { forget: true });
  await controller.reconnectPaired();
  assert.deepEqual([controller.getSelectedPort(), serial.chooserCalls], [null, 0], "two paired ports are left to the chooser");
  serial.grants = [];
  await controller.reconnectPaired();
  assert.equal(controller.getSelectedPort(), null, "nothing paired: nothing to reconnect");
  serial.grants = [b];
  await controller.reconnectPaired();
  assert.deepEqual([controller.getSelectedPort(), serial.chooserCalls], [b, 0], "the paired port is used without asking");
  assert.deepEqual([dom.element("connect-button").hidden, dom.element("disconnect-button").hidden], [true, false]);
  assert.match(logLines(dom, "status").join("\n"), /\] Probe \(paired port\)$/m);
  assert.equal(b.opens, 1, "the check is the only open");
  await controller.reconnectPaired();
  assert.equal(b.opens, 1, "an existing connection is kept");

  await dom.element("disconnect-button").listeners.get("click")();
  await serial.listeners.get("connect")[0]();
  assert.equal(controller.getSelectedPort(), null, "Disconnect unpaired B, so plugging it in again does nothing");
  serial.grants = [a];
  await serial.listeners.get("connect")[0]();
  assert.equal(controller.getSelectedPort(), a, "plugging in a paired device reconnects it");

  await controller.disconnect();
  const chooserCalls = serial.chooserCalls;
  await dom.element("connect-button").listeners.get("click")();
  assert.equal(serial.chooserCalls, chooserCalls + 1, "a manual Connect asks even with one paired port");

  await controller.disconnect();
  a.mainError = new Error("no answer from the bootloader");
  await controller.reconnectPaired();
  assert.equal(controller.getSelectedPort(), a);
  assert.match(logLines(dom, "error").at(-1), /Probe failed: no answer from the bootloader/);
  a.mainError = null;
  await serial.listeners.get("connect")[0]();
  assert.equal(controller.isConnected(), true, "after a failed check, plugging the device in again retries");
});

test("a busy paired port is retried quietly by the check itself and gets one line", async (t) => {
  const a = lifecyclePort("A");
  // Like Chrome: a port that failed to open reports "already closed" on close.
  const close = a.close.bind(a);
  a.close = async () => {
    if (!a.readable) throw new DOMException("The port is already closed.", "InvalidStateError");
    return close();
  };
  const { controller, serial, dom } = await attachedLifecycle(t, [a], { forget: true });
  const probes = () => logLines(dom, "status").filter((line) => line.endsWith("Probe (paired port)")).length;

  a.openFailures = 1; // still closing after a reload
  await controller.reconnectPaired();
  assert.equal(controller.isConnected(), true);
  assert.deepEqual([a.opens, probes(), logLines(dom, "error"), logLines(dom, "warning")], [2, 1, [], []],
    "one failed open, then the check; no noise in the log");

  await controller.disconnect();
  a.opens = 0;
  a.openFailures = 3; // held by another tab
  await controller.reconnectPaired();
  assert.deepEqual([controller.isConnected(), a.opens, probes()], [false, 3, 1], "three opens at most, no further probe line");
  assert.match(logLines(dom, "warning").at(-1), /\] Paired port busy \(open in another tab or program\)$/);

  a.opens = 0;
  a.openFailures = 1;
  await dom.element("connect-button").listeners.get("click")();
  assert.match(logLines(dom, "error").at(-1), /\] Probe failed: port busy \(open in another tab or program\)$/);
  assert.equal(serialPortLease(a), undefined, "a port that never opened is not held as reserved");
  assert.equal(serial.chooserCalls, 1);

  a.mainError = new Error("no answer from the bootloader");
  a.opens = 0;
  await controller.reconnectPaired();
  assert.deepEqual([controller.isConnected(), a.opens], [false, 1], "a device that does not answer is not retried");
});

test("the clicked flash button shows the progress and is cleared afterwards", async (t) => {
  const a = lifecyclePort("A");
  const { controller, dom } = await attachedLifecycle(t, [a]);
  await controller.connect();
  const [flash, clean] = ["flash-button", "clean-flash-button"].map((id) => dom.element(id));
  for (const [button, other] of [[clean, flash], [flash, clean]]) {
    a.writeWait = pendingNative();
    a.writeEntered = pendingNative();
    const installing = button.listeners.get("click")();
    await a.writeEntered.promise;
    assert.equal(button.dataset.progress, "0");
    assert.equal(button.style["--progress"], "0%");
    assert.equal(other.dataset.progress, undefined, "only the clicked button fills");
    a.writeWait.resolve();
    await installing;
    assert.deepEqual([button.dataset.progress, button.style["--progress"]], [undefined, undefined], "cleared after installing");
  }
  a.writeError = new Error("write failed");
  a.writeWait = null;
  await flash.listeners.get("click")();
  assert.equal(flash.dataset.progress, undefined, "cleared after a failure too");
});

test("a port is forgotten only while paired, closed, unowned and not blocked, under its own lease", async () => {
  const port = { readable: null, writable: null, forgotten: 0, leaseDuringForget: null };
  port.forget = async () => { port.forgotten++; port.leaseDuringForget = serialPortLease(port)?.kind; };
  const serial = { grants: [port], async getPorts() { return [...this.grants]; } };
  const blocked = { isReleaseBlocked: () => true };

  serial.grants = [];
  await assert.rejects(forgetSerialPort(serial, port), { name: "NotFoundError" });
  serial.grants = [port];
  port.readable = {};
  await assert.rejects(forgetSerialPort(serial, port), { name: "InvalidStateError", message: /still open/ });
  port.readable = null;
  const probe = acquireSerialPortLease(port, "probe");
  await assert.rejects(forgetSerialPort(serial, port), { name: "InvalidStateError", message: /^Port busy/ });
  releaseSerialPortLease(probe);
  await assert.rejects(forgetSerialPort(serial, port, { controller: blocked }), { name: "InvalidStateError" });
  assert.equal(port.forgotten, 0, "no refused request reached the browser");

  assert.equal(await forgetSerialPort(serial, port), port);
  assert.deepEqual([port.forgotten, port.leaseDuringForget], [1, "release"], "forgotten under the release lease");
  assert.equal(serialPortLease(port), undefined, "and the lease is returned afterwards");
});

test("installed firmware inspection follows the ESP-IDF partition, otadata and app formats", async () => {
  // Vectors from binascii.crc32(struct.pack("<I", seq), 0xFFFFFFFF), the formula of ESP-IDF otatool.py.
  assert.equal(otaSequenceCrc(1), 0x4743989a);
  assert.equal(otaSequenceCrc(2), 0x55f63774);
  assert.equal(otaSequenceCrc(0x12345678), 0x71d6a731);
  const partitions = parsePartitionTable(PARTITION_TABLE);
  assert.deepEqual(partitions.map(({ label, offset }) => [label, offset]),
    partitionRows().map(([name, , , offset]) => [name, Number(offset)]));
  const boot = (entries) => selectBootPartition(partitions, entries).label;
  assert.equal(boot([]), "ota_0", "no valid otadata boots ota_0");
  assert.equal(boot([otadataEntry(1), otadataEntry(2)]), "ota_1");
  assert.equal(boot([otadataEntry(3), otadataEntry(2)]), "ota_0");
  assert.equal(boot([otadataEntry(1), otadataEntry(2, 2, 0)]), "ota_0", "wrong CRC");
  assert.equal(boot([otadataEntry(1), otadataEntry(2, 3)]), "ota_0", "ESP_OTA_IMG_INVALID");
  assert.equal(boot([otadataEntry(1), otadataEntry(2, 4)]), "ota_0", "ESP_OTA_IMG_ABORTED");
  assert.deepEqual(parseAppDescription(appHead("daikin-altherma-esp32", "1.0.12-dev.8")),
    { version: "1.0.12-dev.8", project: "daikin-altherma-esp32" });
  const withoutMagic = appHead();
  withoutMagic.writeUInt32LE(0, 0x20);
  assert.equal(parseAppDescription(withoutMagic), null);
  assert.equal(parseAppDescription(appHead("\u00ffbad")).project, "", "non-printable names are dropped");

  const reads = [];
  const flash = flashImage({ 0x8000: PARTITION_TABLE, 0xf000: otadataEntry(1), 0x10000: otadataEntry(2),
    0x210000: appHead("daikin-altherma-esp32", "1.0.12-dev.8") });
  const loader = { async readFlash(offset, length) { reads.push([offset, length]); return flash(offset, length); } };
  assert.deepEqual(await inspectInstalledFirmware(loader, PARTITION_TABLE, "8MB"), {
    layoutMatches: true, nvsMatches: true, firmware: { version: "1.0.12-dev.8", project: "daikin-altherma-esp32" }, slot: "ota_1"
  });
  assert.deepEqual(reads, [[0x8000, 0x100], [0xf000, 32], [0x10000, 32], [0x210000, 0x70]],
    "the table is read in small steps up to its end, then otadata and the app head");
  const longer = partitionTableBytes([...partitionRows(), ...Array.from({ length: 3 }, (_, index) =>
    [`spare${index}`, "data", "undefined", `0x${(0x800000 + index * 0x1000).toString(16)}`, "0x1000"])]);
  const longReads = [];
  const longLoader = { async readFlash(offset, length) { longReads.push([offset, length]); return flashImage({ 0x8000: longer })(offset, length); } };
  await inspectInstalledFirmware(longLoader, longer, "16MB");
  assert.deepEqual(longReads.slice(0, 2), [[0x8000, 0x100], [0x8100, 0x100]], "a longer table takes another small step");
  // gen_esp32part.py ends the table with an MD5 entry; nothing after it is compared or read.
  const withMd5 = Buffer.from(PARTITION_TABLE);
  withMd5.fill(0xff, 224, 256);
  withMd5.writeUInt16LE(0xebeb, 224);
  assert.equal(partitionTableLength(withMd5), 256);
  assert.equal(partitionTableLength(PARTITION_TABLE), 224);
  assert.equal(partitionTableLength(PARTITION_TABLE.subarray(0, 0xc0)), undefined, "the end is not reached yet");
  assert.equal(partitionTableLength(new Uint8Array(32).fill(0xff)), 0);
  const md5Reads = [];
  const md5Flash = flashImage({ 0x8000: withMd5, 0x20000: appHead() });
  const md5Loader = { async readFlash(offset, length) { md5Reads.push([offset, length]); return md5Flash(offset, length); } };
  assert.equal((await inspectInstalledFirmware(md5Loader, withMd5, "8MB")).layoutMatches, true);
  assert.equal((await inspectInstalledFirmware(md5Loader, PARTITION_TABLE, "8MB")).layoutMatches, false, "a different end differs");
  const erasedReads = [];
  const erased = { async readFlash(offset, length) { erasedReads.push(offset); return new Uint8Array(length).fill(0xff); } };
  assert.deepEqual(await inspectInstalledFirmware(erased, PARTITION_TABLE, "8MB"),
    { layoutMatches: false, nvsMatches: false, firmware: null, slot: "" });
  assert.deepEqual(erasedReads, [0x8000], "an erased table ends in its first step");
  const former = partitionTableBytes(FORMER_4MB_ROWS);
  const formerResult = await inspectInstalledFirmware({ async readFlash(offset, length) {
    return flashImage({ 0x8000: former, 0x20000: appHead() })(offset, length);
  } }, PARTITION_TABLE, "8MB");
  assert.deepEqual([formerResult.layoutMatches, formerResult.nvsMatches, formerResult.slot], [false, true, "ota_0"]);
  const short = { async readFlash() { return new Uint8Array(4); } };
  await assert.rejects(inspectInstalledFirmware(short, PARTITION_TABLE, "8MB"), { name: "FlashReadError" });
});

test("the probe compares the installed layout only with the verified offer's partition table", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const table = await fetchOfferPart(offer, OFFICIAL_PARTS[1].path, fixture.fetch);
  assert.ok(Buffer.from(table).equals(PARTITION_TABLE));
  await assert.rejects(fetchOfferPart(offer, "elsewhere.bin", fixture.fetch), /not part of the displayed firmware offer/);
  fixture.payloads.get(OFFICIAL_PARTS[1].path)[0] ^= 1;
  await assert.rejects(fetchOfferPart(offer, OFFICIAL_PARTS[1].path, fixture.fetch), /no longer matches/);
  const fake = fakeEsptool();
  const result = await probeDevice({ port: { getInfo() { return {}; } }, manifest: offer.manifest,
    expectedPartitionTable: PARTITION_TABLE, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader });
  assert.deepEqual(result.installed,
    { layoutMatches: true, nvsMatches: true, firmware: { version: "1.2.3", project: "daikin-altherma-esp32" }, slot: "ota_0" });
  assert.equal(result.mac, "");
  assert.equal(fake.calls.at(-2), "reset:hard_reset", "the probe still leaves the stub with a hard reset");
});

test("esptool-js opens the port with a buffer far above a 4-KiB flash read block", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const fake = fakeEsptool();
  const port = { getInfo() { return {}; } };
  await probeDevice({ port, manifest: offer.manifest, expectedPartitionTable: PARTITION_TABLE,
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader });
  await flashDevice({ port, offer, eraseFirst: false, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
    fetchImpl: fixture.fetch });
  // Web Serial's default is 255 bytes; with it, Chrome received 830 of 3072 bytes from the stub.
  assert.deepEqual(fake.loaderOptions.map((options) => options.serialOptions?.bufferSize), [0x10000, 0x10000]);
});

test("Disconnect during the check's hand-over still closes the port it handed on", async (t) => {
  const a = lifecyclePort("A");
  // esptool-js still holds a writer, so the hand-over waits for it.
  a.heldWriter = { locked: true };
  const { controller, dom } = await attachedLifecycle(t, [a], { followLog: true });
  const connecting = controller.connect();
  await until(() => a.resets === 0 && a.flashIds === 1 && serialPortLease(a)?.phase === "cleanup");
  const disconnecting = controller.disconnect();
  a.heldWriter.locked = false;
  await connecting;
  await disconnecting;
  assert.deepEqual([a.isOpen, a.opens, a.closes, a.resets], [false, 1, 1, 0],
    "handed on during the Disconnect, then closed by it; no log was started");
  assert.deepEqual(a.signals, [
    { dataTerminalReady: false, requestToSend: true }, { dataTerminalReady: false, requestToSend: false }
  ], "the chip left in the flasher is reset into the firmware before the close");
  assert.equal(serialPortLease(a), undefined);
  assert.deepEqual(logLines(dom, "error"), []);
});

test("Disconnect during the check with the live log resets the chip into the firmware and closes", async (t) => {
  const a = lifecyclePort("A");
  a.mainWait = pendingNative();
  a.mainEntered = pendingNative();
  const { controller } = await attachedLifecycle(t, [a], { followLog: true });
  const probing = controller.connect();
  await a.mainEntered.promise;
  const disconnecting = controller.disconnect();
  a.mainWait.resolve();
  await probing;
  await disconnecting;
  assert.deepEqual([a.isOpen, a.closes, a.resets, a.signals.length], [false, 1, 1, 0],
    "a cancelled check never hands its port on: esptool-js resets the chip and closes");
});

test("Disconnect during the last read of the check still resets the chip through esptool-js", async (t) => {
  const a = lifecyclePort("A");
  // The app header is the last read; the check treats a failed read as unknown and finishes.
  const lastRead = pendingNative();
  a.flash = (offset, length) => offset === 0x20000 ? lastRead.promise.then(() => INSTALLED_FLASH(offset, length)) : INSTALLED_FLASH(offset, length);
  const { controller } = await attachedLifecycle(t, [a], { followLog: true });
  const probing = controller.connect();
  await until(() => a.isOpen && serialPortLease(a)?.phase === "probe" && a.flashIds === 1);
  await drainNativeTasks();
  const disconnecting = controller.disconnect();
  lastRead.resolve();
  await probing;
  await disconnecting;
  assert.deepEqual([a.isOpen, a.closes, a.resets, a.signals.length], [false, 1, 1, 0],
    "cancelled while reading: not handed on, reset by esptool-js and closed");
});

test("a check or install with keepOpen hands the open port on without a hard reset or a close", async () => {
  const fixture = firmwareFixture();
  const offer = await fixture.load();
  const fake = lifecycleEsptool();
  const port = lifecyclePort("A");
  const use = () => [port.opens, port.closes, port.resets, port.isOpen, Boolean(serialPortLease(port))];
  await probeDevice({ port, manifest: offer.manifest, expectedPartitionTable: PARTITION_TABLE,
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader, keepOpen: true });
  assert.deepEqual(use(), [1, 0, 0, true, false], "the check leaves the port open and unowned");
  await flashDevice({ port, offer, eraseFirst: false, TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader,
    fetchImpl: fixture.fetch, keepOpen: true });
  assert.deepEqual(use(), [1, 0, 0, true, false], "the install reuses it and leaves it open");
  assert.equal(port.writes, 1);
  await probeDevice({ port, manifest: offer.manifest, expectedPartitionTable: PARTITION_TABLE,
    TransportCtor: fake.Transport, ESPLoaderCtor: fake.Loader });
  assert.deepEqual(use(), [1, 1, 1, false, false], "without keepOpen the check resets the chip and closes");
  port.mainError = new Error("no answer");
  await assert.rejects(probeDevice({ port, manifest: offer.manifest, TransportCtor: fake.Transport,
    ESPLoaderCtor: fake.Loader, keepOpen: true }), /no answer/);
  assert.deepEqual(use(), [2, 2, 1, false, false], "a failed check never hands a port on");
});

test("the shared transport uses an open port and ends esptool-js's read loop without closing", async () => {
  const port = lifecyclePort("A");
  const Shared = sharedPortTransport(lifecycleEsptool().Transport);
  const transport = new Shared(port);
  let opened = 0;
  transport.onOpened = () => { opened++; };
  await transport.connect(115200, { bufferSize: 0x10000 });
  await transport.connect(115200, { bufferSize: 0x10000 });
  assert.deepEqual([port.opens, opened, transport.baudrate], [1, 2, 115200], "an open port is not opened again");
  // esptool-js's readLoop holds a reader and releases it once its read ends.
  transport.reader = port.readable.getReader();
  const loop = transport.reader.read().finally(() => transport.reader.releaseLock());
  await transport.release();
  assert.deepEqual(await loop, { value: undefined, done: true });
  assert.deepEqual([port.isOpen, port.closes, port.readable.locked, transport.reader], [true, 0, false, undefined]);
});

test("the installer's flash plan constants mirror partitions.csv", () => {
  const rows = new Map();
  for (const raw of fs.readFileSync(new URL("../partitions.csv", import.meta.url), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, , , offset, size] = line.split(",").map((field) => field.trim());
    rows.set(name, { start: Number(offset), end: Number(offset) + Number(size) });
  }
  const source = fs.readFileSync(new URL("../docs/web-installer.mjs", import.meta.url), "utf8");
  const preserved = new Map(Array.from(
    source.matchAll(/\{ name: "([a-z_]+)", start: (0x[0-9a-f]+), end: (0x[0-9a-f]+) \}/g),
    ([, name, start, end]) => [name, { start: Number(start), end: Number(end) }]
  ));
  assert.deepEqual([...preserved.keys()], ["nvs", "coredump", "history"]);
  for (const [name, range] of preserved) assert.deepEqual(range, rows.get(name), name);
  const parts = Array.from(source.matchAll(/\{ path: [^,]+, offset: (0x[0-9a-f]+|0), end: (0x[0-9a-f]+) \}/g),
    ([, offset, end]) => ({ start: Number(offset), end: Number(end) }));
  assert.deepEqual(parts, [
    { start: 0, end: 0x8000 },
    { start: 0x8000, end: rows.get("nvs").start },
    rows.get("otadata"),
    rows.get("ota_0")
  ]);
});

test("keeping data needs the offered NVS label, offset and size", () => {
  const offered = parsePartitionTable(PARTITION_TABLE);
  const rows = partitionRows();
  const variant = (change) => parsePartitionTable(partitionTableBytes(rows.map((row) => row[0] === "nvs" ? change(row) : row)));
  assert.equal(sameNvsLayout(offered, offered), true);
  assert.equal(sameNvsLayout(parsePartitionTable(partitionTableBytes(FORMER_4MB_ROWS)), offered), true, "former 4 MB table");
  assert.equal(sameNvsLayout(variant((row) => [...row.slice(0, 3), "0xa000", row[4]]), offered), false, "offset");
  assert.equal(sameNvsLayout(variant((row) => [...row.slice(0, 4), "0x5000"]), offered), false, "size");
  assert.equal(sameNvsLayout(variant((row) => ["config", ...row.slice(1)]), offered), false, "label");
  assert.equal(sameNvsLayout(variant((row) => [row[0], row[1], "coredump", row[3], row[4]]), offered), false, "subtype");
  assert.equal(sameNvsLayout([], offered), false, "an erased table has no NVS");
});

test("the shared transport fits the vendored esptool-js Transport, not only the fake", async () => {
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const version = /from "\.\/esptool-js-([0-9]+\.[0-9]+\.[0-9]+)\.bundle\.js"/.exec(html)[1];
  const { Transport } = await import(`../docs/vendor/esptool-js-${version}.bundle.js`);
  for (const member of ["connect", "disconnect", "readLoop", "trace"]) {
    assert.equal(typeof Transport.prototype[member], "function", member);
  }
  const Shared = sharedPortTransport(Transport);
  const port = (open) => ({
    readable: open ? {} : null, writable: open ? {} : null, opens: [], getInfo() { return {}; },
    async open(options) { this.opens.push(options); this.readable = {}; this.writable = {}; }
  });
  const handedOver = port(true);
  const reused = new Shared(handedOver, false);
  await reused.connect(115200, { bufferSize: 0x10000 });
  assert.deepEqual([handedOver.opens, reused.baudrate, reused.device], [[], 115200, handedOver],
    "an open port is taken over without a second open");
  const closed = port(false);
  await new Shared(closed, false).connect(115200, { bufferSize: 0x10000 });
  assert.deepEqual(closed.opens.map(({ baudRate, bufferSize }) => [baudRate, bufferSize]), [[115200, 0x10000]],
    "a closed port is opened by esptool-js itself, with the large buffer");
  const unlocked = new Shared(port(true), false);
  unlocked.reader = { cancel() { throw new Error("an unlocked port has no reader to cancel"); } };
  await unlocked.release();
  assert.equal(unlocked.reader, undefined, "release leaves no reader behind");
});
