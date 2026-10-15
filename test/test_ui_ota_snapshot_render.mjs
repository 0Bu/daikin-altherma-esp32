// Exercise cached OTA startup through the real status/value derivation and SVG renderer. The
// snapshot may race the first refused full status response; neither order may leave it blank.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppSource } from "../tools/ui/read_app_source.mjs";

const app = readAppSource();
assert.match(app, /\nboot\(\);\s*$/, "the harness must intercept the production boot call");
const source = app.replace(/\nboot\(\);\s*$/, "\n");
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const status = () => ({
  version: "snapshot-test", app_elf_sha256: "image-a", uptime_s: 100, boot_id: "boot-a",
  profile: { id: "profile-a" }, hp: { connected: true, proto: "I", rx: 44, tx: 43, last_ok_s: 0 },
  detect: { valid: true }, modbus: { enabled: true, connected: true, host: "hub-a", port: 502, unit_id: 1 },
  history: { epoch: 1, rows: [] }, env3: { enabled: false, supported: false },
  diagnostics: { enabled: false }, ui: { lang: "en" }, ota: { channel: "dev" },
  wifi: { connected: true }, mqtt: { configured: false }, ntp: {}, sys: {},
});
const values = (lwt = "35.0") => {
  const row = (label, value, reg = 0x60, unit = "") => ({ label, value, reg, unit });
  return { values: [row("I/U operation mode", "Heating"),
    row("Leaving water temp. before BUH (R1T)", lwt, 0x61, "°C"),
    row("Return water temp before PHE (R4T)", "30.0", 0x61, "°C"),
    row("Leaving water temp. after BUH (R2T)", lwt, 0x61, "°C"),
    row("Flow sensor", "10.0", 0x61, "l/min"), row("INV frequency", "40", 0x21, "rps"),
    row("INV primary current", "5", 0x21, "A"), row("Water pump operation", "1"),
    row("Water pump signal", "50"), row("3way valve", "0"), row("BUH Step1", "0"),
    row("BUH Step2", "0"), row("BSH", "0"), row("Space heating operation", "1"),
    row("Defrost operation", "0")],
  modbus: [{ label: "Tank temperature", value: 42, off: 7, unit: "°C" }] };
};
const cacheKey = "daikinOtaRenderV1";
const cache = () => ({ saved_at_ms: Date.now(), status: status(), ...values() });

function harness(cached, transform = (text) => text) {
  const elements = new Map(), storage = new Map(), routes = new Map();
  if (cached) storage.set(cacheKey, JSON.stringify(cached));
  const flows = ["fPhe", "fSup1", "fSup2", "fSup3", "fRet", "fHeat", "fHeatRet", "rfHot", "rfPhe", "rfCold"];
  const controls = [{ disabled: false, dataset: {} }];
  const element = (id) => {
    if (elements.has(id)) return elements.get(id);
    const names = new Set();
    const node = { id, dataset: {}, style: {}, hidden: false, textContent: "", innerHTML: "", children: [],
      classList: { add: (...list) => list.forEach((name) => names.add(name)),
        remove: (...list) => list.forEach((name) => names.delete(name)), contains: (name) => names.has(name),
        toggle(name, on) { if (on) names.add(name); else names.delete(name); } },
      setAttribute(name, value) { this[name] = String(value); }, removeAttribute(name) { delete this[name]; },
      appendChild(child) { this.children.push(child); return child; }, closest: () => null,
      querySelector: () => null,
      querySelectorAll(selector) {
        if (selector.includes(".sc-flow")) return flows.map(element);
        if (selector === "button, select, input") return controls;
        return [];
      } };
    elements.set(id, node); return node;
  };
  const document = { activeElement: null, getElementById: element, createElement: element,
    querySelectorAll: () => [] };
  const context = vm.createContext({ document, navigator: { language: "en" },
    location: { hostname: "fixture.invalid" }, localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    setTimeout: () => 1, clearTimeout() {},
    fetch: (url) => routes.get(String(url))(),
  });
  context.window = context;
  vm.runInContext(transform(source) + `
    // Omit unrelated cards/banners, retaining renderApp, liveData and renderLive unchanged.
    renderRecoveryBanner = () => {};
    renderRollbackBanner = () => {};
    renderCrashBanner = () => {};
    renderHeaderMeta = () => {};
    renderSettings = () => {};
    renderCards = () => {};
    renderInspect = () => {};
    paintOtaAlert = () => {};
    this.ui = { S, resumeOta, refreshStatus, refreshValues, renderApp, renderLive };
  `, context);
  const statusReply = deferred(), compactReply = deferred();
  routes.set("/status", () => statusReply.promise);
  routes.set("/ota/status", () => compactReply.promise);
  return { ...context.ui, storage, routes, statusReply, compactReply, controls, element };
}
const compact = { state: "updating", generation: 7, current: "snapshot-test", progress: 78, channel: "dev" };
const observe = (h) => ({ lwt: h.element("svLwt").textContent, pth: h.element("svPth").textContent,
  fan: h.element("schem").classList.contains("fan-on"),
  pump: h.element("schem").classList.contains("pump-on"),
  headline: h.element("svMode").textContent, detail: h.element("svStatus").textContent });

for (const order of ["status-first", "cache-first"]) {
  const h = harness(cache());
  const resume = h.resumeOta(), initial = h.refreshStatus(false);
  if (order === "status-first") {
    h.statusReply.resolve(response({}, 503)); await settle();
    assert.equal(h.S.transportUnavailable, "status");
    h.compactReply.resolve(response(compact));
  } else {
    h.compactReply.resolve(response(compact)); await settle();
    assert.equal(h.S.otaCached, true);
    h.statusReply.resolve(response({}, 503));
  }
  await resume; await initial; await settle();
  assert.equal(h.S.otaCached, true);
  assert.equal(observe(h).lwt, "35.0", `${order}: restored R1T must reach the real schematic`);
  assert.notEqual(h.S.live, null, `${order}: restored values must reach the actual live-data builder`);
  assert.equal(h.S.transportUnavailable, null);
  assert.equal(h.S.transportBusy, false);
  assert.notEqual(observe(h).pth, "—");
  assert.equal(observe(h).fan, true); assert.equal(observe(h).pump, true);
  assert.equal(observe(h).headline, "Firmware update");
  assert.match(observe(h).detail, /78%.*last received state/, "restored readings must be explicitly cached");
  assert.equal(h.controls[0].disabled, true);
  h.renderApp(); h.renderLive();
  assert.equal(observe(h).lwt, "35.0");
  assert.equal(observe(h).headline, "Firmware update", "a plain repaint cannot promote the cached frame");
  assert.match(observe(h).detail, /last received state/);

  // One fresh status alone cannot promote the cached readings to current. Its following values
  // response supplies a complete frame; another failure then blanks that live frame normally.
  h.routes.set("/status", async () => response({ ...status(), uptime_s: 101 }));
  await h.refreshStatus();
  assert.equal(h.S.otaCached, true);
  assert.equal(observe(h).lwt, "35.0");
  assert.match(observe(h).detail, /last received state/, "status alone cannot mark cached values current");
  h.routes.set("/values", async () => response(values("38.0")));
  await h.refreshValues();
  assert.equal(h.S.otaCached, false); assert.equal(observe(h).lwt, "38.0");
  assert.doesNotMatch(observe(h).detail, /last received state/);
  h.routes.set("/values", async () => { throw new Error("offline"); });
  await h.refreshValues();
  assert.equal(h.S.otaCached, false); assert.equal(observe(h).lwt, "—");
  assert.equal(observe(h).fan, false); assert.equal(observe(h).pump, false);
}

for (const invalid of [null, { ...cache(), saved_at_ms: Date.now() - 16 * 60 * 1000 },
  { ...cache(), status: { ...status(), version: "other-version" } }]) {
  const h = harness(invalid);
  const resume = h.resumeOta(), initial = h.refreshStatus(false);
  h.statusReply.resolve(response({}, 503)); await settle();
  h.compactReply.resolve(response(compact));
  await resume; await initial; await settle();
  assert.equal(h.S.otaCached, false);
  assert.equal(h.S.live, null); assert.equal(observe(h).lwt, "—");
  assert.equal(observe(h).fan, false); assert.equal(observe(h).pump, false);
  assert.doesNotMatch(observe(h).detail, /last received state/);
  assert.equal(h.storage.has(cacheKey), false);
}

// Both historical bugs must remain independently observable in compiling production variants.
// These controls alter only the in-memory source consumed by this harness.
for (const [before, after, broken] of [
  ["  S.otaCached = true;\n  S.transportUnavailable = null;\n  S.transportBusy = false;",
    "  S.otaCached = true;", "cache-reset"],
  ["  if (S.otaCached) renderOtaDashboardStatus();\n  else if (S.transportUnavailable) {",
    "  if (S.transportUnavailable) {", "cached-headline"],
]) {
  const h = harness(cache(), (text) => {
    const mutated = text.replace(before, after);
    assert.notEqual(mutated, text, `${broken}: the negative control must modify the actual production source`);
    return mutated;
  });
  const resume = h.resumeOta(), initial = h.refreshStatus(false);
  h.statusReply.resolve(response({}, 503)); await settle();
  h.compactReply.resolve(response(compact));
  await resume; await initial; await settle();
  assert.equal(h.S.otaCached, true); assert.equal(h.controls[0].disabled, true);
  h.renderApp();
  if (broken === "cache-reset") {
    assert.equal(h.S.live, null); assert.equal(observe(h).lwt, "—");
  } else {
    assert.equal(observe(h).lwt, "35.0");
    assert.notEqual(observe(h).headline, "Firmware update");
    assert.doesNotMatch(observe(h).detail, /last received state/);
  }
}
console.log("OTA cached snapshot: real schematic, startup races, fresh-frame recovery and rejected caches pass");
