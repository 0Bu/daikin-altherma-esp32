// End-to-end interaction contract for the dependency-free device UI.  It executes the production
// wiring and modal functions in a small DOM harness so every dialog action is tested as behavior,
// not merely matched as source text.  Adding a modal without adding its lifecycle here fails.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

class ClassList {
  constructor() { this.names = new Set(); }
  add(...names) { for (const name of names) this.names.add(name); }
  remove(...names) { for (const name of names) this.names.delete(name); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.names.has(name) : !!force;
    if (on) this.names.add(name); else this.names.delete(name);
    return on;
  }
}

class Element {
  constructor(id, doc) {
    this.id = id;
    this.doc = doc;
    this._value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = id.endsWith("Modal");
    this.innerHTML = "";
    this.textContent = "";
    this.dataset = {};
    this.classList = new ClassList();
    this.listeners = new Map();
    this.onclick = null;
  }
  set value(value) { this._value = String(value ?? ""); }
  get value() { return this._value; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async fire(type, init = {}) {
    const event = {
      type,
      target: init.target || this,
      currentTarget: this,
      key: init.key,
      pointerId: 1,
      clientX: 0,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    if (type === "click" && typeof this.onclick === "function") await this.onclick(event);
    return event;
  }
  querySelector(selector) { return selector === '[role="dialog"]' ? this : null; }
  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  setAttribute(name, value) { this[name] = String(value); }
  appendChild(child) { this.lastChild = child; return child; }
  remove() {}
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  matches() { return false; }
  closest() { return null; }
  contains() { return false; }
  setPointerCapture() {}
}

class Document {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.activeElement = null;
    this.documentElement = new Element("html", this);
    this.body = new Element("body", this);
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new Element(id, this));
    return this.elements.get(id);
  }
  createElement(tag) { return new Element(tag, this); }
  querySelectorAll() { return []; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async fire(type, init = {}) {
    const event = {
      type,
      target: init.target || this.activeElement || this.body,
      currentTarget: this,
      key: init.key,
      pointerId: 1,
      clientX: 0,
      preventDefault() {},
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
}

const document = new Document();
const fetchState = { mode: "ok", calls: [] };
const response = (ok, payload, status = ok ? 200 : 400) => ({
  ok,
  status,
  async json() { return payload; },
});
const fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  fetchState.calls.push({ url, body });
  if (fetchState.mode === "throw") throw new Error("unreachable");
  if (fetchState.mode === "env3_missing" && url === "/set_board")
    return response(false, {
      code: "env3_sht30_not_found",
      error: "ENV III temperature/humidity sensor not found on the selected pins",
    }, 422);
  if (url === "/test_circulation") {
    if (fetchState.mode === "circ_test_reject")
      return response(false, { error: "No fresh pump-power value received before timeout" }, 422);
    return response(true, {
      ok: true, test_proof: 83, power_w: 5.7, state: "on", retained: false,
    });
  }
  if (fetchState.mode === "mqtt_base_reject" && url === "/set_mqtt")
    return response(false, {
      code: "mqtt_base_not_sluggable",
      error: "Base topic must contain a letter or digit",
    }, 400);
  if (fetchState.mode === "mqtt_base_unknown_code" && url === "/set_mqtt")
    return response(false, {
      code: "mqtt_base_future_rule",
      error: "Base topic violates a rule this UI predates",
    }, 400);
  if (fetchState.mode === "reject") return response(false, { error: "rejected by test" });
  if (url === "/status") return response(true, {});
  return response(true, { reboot: false, saved: false });
};

// Minimal same-document History API. push/replace do not emit events; Back/Forward emit popstate,
// matching the browser contract the production hash router relies on.
const location = { pathname: "/", search: "", hash: "", reload() {} };
const windowListeners = new Map();
const window = {
  scrollTo() {},
  open() {},
  addEventListener(type, listener) {
    const listeners = windowListeners.get(type) || [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  },
  fire(type) { for (const listener of windowListeners.get(type) || []) listener({ type }); },
};
const historyEntries = [{ hash: "", state: null }];
let historyIndex = 0;
const setHistoryLocation = (url) => {
  const parsed = new URL(url, "http://device.local/");
  location.pathname = parsed.pathname;
  location.search = parsed.search;
  location.hash = parsed.hash;
};
const history = {
  get state() { return historyEntries[historyIndex].state; },
  pushState(state, _title, url) {
    setHistoryLocation(url);
    historyEntries.splice(++historyIndex, Infinity, { hash: location.hash, state });
  },
  replaceState(state, _title, url) {
    setHistoryLocation(url);
    historyEntries[historyIndex] = { hash: location.hash, state };
  },
  back() {
    if (!historyIndex) return;
    const oldHash = location.hash;
    historyIndex--;
    location.hash = historyEntries[historyIndex].hash;
    window.fire("popstate");
    if (location.hash !== oldHash) window.fire("hashchange");
  },
  forward() {
    if (historyIndex >= historyEntries.length - 1) return;
    const oldHash = location.hash;
    historyIndex++;
    location.hash = historyEntries[historyIndex].hash;
    window.fire("popstate");
    if (location.hash !== oldHash) window.fire("hashchange");
  },
};

const context = vm.createContext({
  document,
  fetch,
  navigator: { language: "de-DE" },
  localStorage: { getItem() { return null; }, setItem() {} },
  window,
  history,
  location,
  URL,
  URLSearchParams,
  Blob,
  AbortController,
  setTimeout: () => 1,
  clearTimeout() {},
  setInterval: () => 1,
  clearInterval() {},
  console,
  renderHeader() {},
});

const source = readAppFragments(["i18n.js"]) + readUiLocale("de") +
  readAppFragments(["app_state.js", "settings.js", "bootstrap.js"])
    .replace(/\nboot\(\);\s*$/, "\n");
vm.runInContext(`${source}
  toast = () => {};
  renderApp = () => {};
  refreshStatus = async () => true;
  collectBugReport = async () => ({ text: "redacted report", failed: false });
  this.__ui = {
    S, MODALS, POPUP_ROUTES, wire, initNavigation, applyRouteFromLocation, hydrateRoutedPopup,
    openWifi, openMqtt, openRefTemp, openCirculation, openWeather, openSyslog,
    openNtp, openHomehub, openBoard, openBug,
  };`, context, { filename: "main/www/app.sources" });
const ui = context.__ui;

ui.S.status = {
  wifi: { ssid: "ExampleNet" },
  mqtt: { broker: "192.0.2.27:1883", has_creds: false, base: "daikin-altherma-esp32", base_custom: false },
  reference_temperature: {
    configured: true, name: "Living room", topic: "sensor/living-room/temperature",
    temperature_path: "temperature.tC", setpoint_topic: "", setpoint_path: "",
    fixed_setpoint_c: 20, timestamp_topic: "sensor/living-room/sys",
    timestamp_path: "read_at", enabled_path: "enabled", hvac_mode_path: "hvac_mode",
    max_age_s: 600,
  },
  circulation_source: {
    configured: true, name: "DHW circulation",
    topic: "fixture/circulation/status",
    power_path: "apower", timestamp_path: "aenergy.minute_ts",
    max_age_s: 120, on_threshold_w: 3.0, off_threshold_w: 1.0, confirm_s: 60,
  },
  weather_forecast: { latitude: "", longitude: "" },
  syslog: {},
  ntp: { server: "pool.ntp.org" },
  modbus: { host: "", port: 502, unit_id: 1 },
  board: {
    preset_id: "m5stack_atoms3_lite",
    preset_name: "M5Stack AtomS3 Lite",
    user_set: true,
    presets: [{
      id: "m5stack_atoms3_lite", name: "M5Stack AtomS3 Lite", vendor: "m5stack",
      led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true,
    }, {
      id: "seeed_xiao_esp32s3", name: "Seeed XIAO ESP32-S3", vendor: "seeed",
      led_gpio: 21, led_type: 0, led_inverted: true, btn_gpio: -1, btn_active_low: true,
    }],
    pins_local: [1, 2, 5, 6, 35, 41],
    led_gpio: 35,
    led_type: 1,
    led_inverted: false,
    btn_gpio: 41,
    btn_active_low: true,
  },
  env3: { supported: true, enabled: true, sda: 2, scl: 1, pins_avail: [1, 2, 5, 6] },
};

const cases = [
  { name: "Wi-Fi", modal: "wifiModal", open: "openWifi", cancel: "wfCancel", backdrop: "wifiBackdrop", form: "wifiForm", url: "/set_wifi" },
  { name: "MQTT", modal: "mqttModal", open: "openMqtt", cancel: "mqCancel", backdrop: "mqttBackdrop", form: "mqttForm", url: "/set_mqtt" },
  { name: "Room temperature", modal: "refTempModal", open: "openRefTemp", cancel: "rtCancel", backdrop: "refTempBackdrop", form: "refTempForm", url: "/set_ref_temp", customSave: true },
  { name: "Circulation pump", modal: "circulationModal", open: "openCirculation", cancel: "circCancel", backdrop: "circulationBackdrop", form: "circulationForm", url: "/set_circulation", customSave: true },
  { name: "Weather", modal: "weatherModal", open: "openWeather", cancel: "wxCancel", backdrop: "weatherBackdrop", form: "weatherForm", url: "/set_weather" },
  { name: "Syslog", modal: "syslogModal", open: "openSyslog", cancel: "slCancel", backdrop: "syslogBackdrop", form: "syslogForm", url: "/set_syslog" },
  { name: "NTP", modal: "ntpModal", open: "openNtp", cancel: "ntpCancel", backdrop: "ntpBackdrop", form: "ntpForm", url: "/set_ntp" },
  { name: "HomeHub", modal: "homehubModal", open: "openHomehub", cancel: "hhCancel", backdrop: "homehubBackdrop", form: "homehubForm", url: "/set_hp", customSave: true },
  { name: "Board", modal: "boardModal", open: "openBoard", cancel: "bdCancel", backdrop: "boardBackdrop", form: "boardForm", url: "/set_board" },
  { name: "Bug report", modal: "bugModal", open: "openBug", cancel: "bugCancel", backdrop: "bugBackdrop" },
];

const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const htmlModals = [...html.matchAll(/<div class="modal" id="([^"]+Modal)"/g)].map((match) => match[1]).sort();
assert.deepEqual([...ui.MODALS].sort(), htmlModals, "MODALS must name every modal in the shipped HTML");
assert.deepEqual(cases.map((item) => item.modal).sort(), htmlModals,
  "the interaction matrix must cover every shipped modal");
const popupRoutes = Object.values(ui.POPUP_ROUTES);
assert.equal(new Set(popupRoutes).size, ui.MODALS.length, "every popup route must be unique");
assert.ok(popupRoutes.every((route) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route)),
  "popup routes must remain human-readable stable URL segments");

ui.wire();
ui.initNavigation();

// Navigation is part of the same one-time wiring.  If wiring aborts early, these assertions and all
// modal actions below fail together instead of leaving a half-interactive page.
assert.equal(location.hash, "", "the dashboard must keep the canonical hash-free device URL");
await document.getElementById("btnSettings").onclick();
assert.equal(ui.S.stage, "settings", "Settings must open from the dashboard");
assert.equal(location.hash, "#settings", "Settings must be an addressable history entry");
await document.getElementById("btnBack").onclick();
assert.equal(ui.S.stage, "dashboard", "Back must return to the dashboard");
assert.equal(location.hash, "", "Back from Settings must restore the dashboard URL");
history.forward();
assert.equal(ui.S.stage, "settings", "browser Forward must restore Settings");
assert.equal(location.hash, "#settings", "browser Forward must restore the Settings URL");
history.back();

const loadRoute = (hash) => {
  history.replaceState(null, "", `/${hash}`);
  ui.applyRouteFromLocation();
};

loadRoute("#settings/toString");
assert.equal(ui.S.stage, "dashboard", "an unknown or inherited-object hash must fail closed");
assert.equal(location.hash, "", "an unknown popup hash must canonicalize to the dashboard URL");

// This is the state a full reload presents to initNavigation: a URL selected by the address bar,
// with no in-app parent metadata. The exact dialog must be restored and an explicit close must stay
// inside the app instead of navigating to whatever site preceded the pasted link.
loadRoute("#settings/mqtt");
assert.equal(ui.S.stage, "settings", "a popup URL must restore its Settings parent");
assert.equal(document.getElementById("mqttModal").hidden, false, "a popup URL must restore the exact popup");
assert.equal(document.getElementById("mqBroker").value, "192.0.2.27:1883",
  "a restored popup must use the normal status-backed form fill path");
await document.getElementById("mqCancel").onclick();
assert.equal(location.hash, "#settings", "closing a directly loaded popup must canonicalize to Settings");

// Startup restores the overlay before the first status request has returned. Its normal form fill
// runs once that response arrives, but an impatient user's draft wins over the late response.
const loadedStatus = ui.S.status;
ui.S.status = null;
loadRoute("#settings/wifi");
assert.equal(document.getElementById("wfSSID").value, "", "pre-status reload must not invent saved values");
document.getElementById("wfSSID").value = "Draft network";
await document.fire("input", { target: document.getElementById("wfSSID") });
ui.S.status = loadedStatus;
ui.hydrateRoutedPopup();
assert.equal(document.getElementById("wfSSID").value, "Draft network",
  "the first status response must not overwrite a draft started after reload");
await document.getElementById("wfCancel").onclick();

ui.S.status = null;
loadRoute("#settings/wifi");
ui.S.status = loadedStatus;
ui.hydrateRoutedPopup();
assert.equal(document.getElementById("wfSSID").value, "ExampleNet",
  "an untouched reload popup must hydrate from the first status response");
await document.getElementById("wfCancel").onclick();

// An in-app popup has a real Settings parent: Back closes it and Forward opens the same one again.
ui.openWifi();
assert.equal(location.hash, "#settings/wifi", "opening a popup must add its stable route");
history.back();
assert.equal(document.getElementById("wifiModal").hidden, true, "browser Back must close the popup");
assert.equal(location.hash, "#settings", "browser Back from a popup must retain Settings");
history.forward();
assert.equal(document.getElementById("wifiModal").hidden, false, "browser Forward must restore the popup");
assert.equal(document.getElementById("wfSSID").value, "ExampleNet",
  "browser Forward must run the popup's normal fill lifecycle");
await document.getElementById("wfCancel").onclick();

const resetModals = () => {
  for (const id of ui.MODALS) document.getElementById(id).hidden = true;
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
};
const delegatedTarget = (selector, key, value) => ({
  closest(query) { return query === selector ? { dataset: { [key]: value } } : null; },
});

// Exercise the controls a user actually clicks, not only the open helpers used by the lifecycle
// matrix below. The cards are rebuilt on every status poll, so these are delegated handlers and a
// missing action branch otherwise leaves a perfectly rendered pencil/row inert.
for (const entry of [
  ["settingsCards", "[data-act]", "act", "board", "boardModal"],
  ["settingsCards", "[data-act]", "act", "ref-temp", "refTempModal"],
  ["settingsCards", "[data-act]", "act", "circulation", "circulationModal"],
  ["settingsCards", "[data-act]", "act", "weather", "weatherModal"],
  ["connTile", "[data-edit]", "edit", "wifi", "wifiModal"],
  ["connTile", "[data-edit]", "edit", "mqtt", "mqttModal"],
  ["connTile", "[data-edit]", "edit", "syslog", "syslogModal"],
  ["connTile", "[data-edit]", "edit", "ntp", "ntpModal"],
  ["connTile", "[data-edit]", "edit", "homehub", "homehubModal"],
]) {
  const [host, selector, key, value, modal] = entry;
  loadRoute("#settings");
  await document.getElementById(host).fire("click", { target: delegatedTarget(selector, key, value) });
  assert.equal(document.getElementById(modal).hidden, false, `${value}: visible entry action must open`);
  assert.equal(location.hash, `#settings/${ui.POPUP_ROUTES[modal]}`,
    `${value}: visible entry action must add its addressable popup route`);
}
loadRoute("#settings");
await document.getElementById("footBug").onclick();
assert.equal(document.getElementById("bugModal").hidden, false, "Report a bug footer action must open");
assert.equal(location.hash, "#settings/bug-report", "Report a bug must add its addressable popup route");

const open = (item) => {
  loadRoute("#settings");
  ui[item.open]();
  assert.equal(document.getElementById(item.modal).hidden, false, `${item.name}: open`);
  assert.equal(location.hash, `#settings/${ui.POPUP_ROUTES[item.modal]}`,
    `${item.name}: open must add the popup URL`);
  assert.equal(document.documentElement.classList.contains("modal-open"), true,
    `${item.name}: open must lock the document scroller`);
  assert.equal(document.body.classList.contains("modal-open"), true,
    `${item.name}: open must lock the body scroller`);
};

for (const item of cases) {
  open(item);
  const cancel = document.getElementById(item.cancel);
  assert.equal(typeof cancel.onclick, "function", `${item.name}: Cancel must be wired`);
  await cancel.onclick({ preventDefault() {} });
  assert.equal(document.getElementById(item.modal).hidden, true, `${item.name}: Cancel must close`);
  assert.equal(location.hash, "#settings", `${item.name}: Cancel must return the URL to Settings`);
  assert.equal(document.documentElement.classList.contains("modal-open"), false,
    `${item.name}: Cancel must release document scrolling`);
  assert.equal(document.body.classList.contains("modal-open"), false,
    `${item.name}: Cancel must release body scrolling`);

  open(item);
  const backdrop = document.getElementById(item.backdrop);
  assert.equal(typeof backdrop.onclick, "function", `${item.name}: backdrop must be wired`);
  await backdrop.onclick({ preventDefault() {} });
  assert.equal(document.getElementById(item.modal).hidden, true, `${item.name}: backdrop must close`);
  assert.equal(location.hash, "#settings", `${item.name}: backdrop must return the URL to Settings`);
  assert.equal(document.documentElement.classList.contains("modal-open"), false,
    `${item.name}: backdrop must release document scrolling`);

  open(item);
  await document.fire("keydown", { key: "Escape" });
  assert.equal(document.getElementById(item.modal).hidden, true, `${item.name}: Escape must close`);
  assert.equal(location.hash, "#settings", `${item.name}: Escape must return the URL to Settings`);
  assert.equal(document.body.classList.contains("modal-open"), false,
    `${item.name}: Escape must release body scrolling`);
}

const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
const configureValid = (item) => {
  if (item.modal === "refTempModal") {
    document.getElementById("rtTemperatureSource").value = "sensor/living-room/temperature$temperature.tC";
    document.getElementById("rtTarget").value = "20";
    document.getElementById("rtTimestampSource").value = "sensor/living-room/sys$read_at";
    document.getElementById("rtMaxAge").value = "600";
  } else if (item.modal === "circulationModal") {
    document.getElementById("circTopic").value = "fixture/circulation/status";
    document.getElementById("circPowerPath").value = "apower";
    document.getElementById("circTimePath").value = "aenergy.minute_ts";
    document.getElementById("circMaxAge").value = "120";
    document.getElementById("circOn").value = "3.0";
    document.getElementById("circOff").value = "1.0";
    document.getElementById("circConfirm").value = "60";
  }
};

for (const item of cases.filter((entry) => entry.form)) {
  fetchState.mode = "ok";
  fetchState.calls.length = 0;
  ui.S.busy = false;
  open(item);
  configureValid(item);
  await document.getElementById(item.form).fire("submit");
  await settle();
  assert.equal(document.getElementById(item.modal).hidden, true, `${item.name}: accepted Save must close`);
  assert.equal(location.hash, "#settings", `${item.name}: accepted Save must return the URL to Settings`);
  assert.equal(document.body.classList.contains("modal-open"), false,
    `${item.name}: accepted Save must release background scrolling`);
  assert.ok(fetchState.calls.some((call) => call.url === item.url), `${item.name}: Save must call ${item.url}`);
  if (item.modal === "refTempModal") {
    assert.deepEqual(fetchState.calls.map((call) => call.url), ["/set_ref_temp"],
      "one room-source Save must persist immediately without a live probe");
    assert.equal(fetchState.calls[0]?.body?.enabled_path, "enabled",
      "editing the visible fields of an unchanged source must preserve its existing enabled gate");
    assert.equal(fetchState.calls[0]?.body?.hvac_mode_path, "hvac_mode",
      "editing the visible fields of an unchanged source must preserve its existing HVAC gate");
    assert.equal(fetchState.calls[0]?.body?.fixed_setpoint_c, 20,
      "a numeric target must be sent as a fixed temperature, not an MQTT mapping");
    assert.equal(fetchState.calls[0]?.body?.timestamp_topic, "sensor/living-room/sys",
      "the timestamp mapping must retain its independent MQTT topic");
  } else if (item.modal === "circulationModal") {
    assert.deepEqual(fetchState.calls.map((call) => call.url), ["/test_circulation", "/set_circulation"],
      "one circulation-source Save must run live test before persistence");
    assert.equal(fetchState.calls[1]?.body?.test_proof, 83,
      "circulation-source persistence must present the exact live proof");
    assert.equal(fetchState.calls[0]?.body?.power_path, "apower");
    assert.equal(fetchState.calls[0]?.body?.timestamp_path, "aenergy.minute_ts");
  }

  fetchState.mode = "reject";
  fetchState.calls.length = 0;
  ui.S.busy = false;
  open(item);
  configureValid(item);
  await document.getElementById(item.form).fire("submit");
  await settle();
  assert.equal(document.getElementById(item.modal).hidden, false, `${item.name}: rejected Save must stay open`);
  assert.equal(document.body.classList.contains("modal-open"), true,
    `${item.name}: rejected Save must keep background scrolling locked`);
  assert.equal(ui.S.busy, false, `${item.name}: rejected Save must release busy state`);
}

// This synthetic sensor fixture has a temperature topic but no target and need not publish a
// source timestamp.
// The fixed target plus live MQTT arrival-time contract must therefore survive immediate persistence
// with both timestamp fields deliberately empty.
fetchState.mode = "ok";
fetchState.calls.length = 0;
ui.S.busy = false;
open(cases.find((item) => item.modal === "refTempModal"));
document.getElementById("rtName").value = "Example temperature sensor";
document.getElementById("rtTemperatureSource").value =
  "fixture/room-temperature/status$tC";
document.getElementById("rtTarget").value = "20";
document.getElementById("rtTimestampSource").value = "";
document.getElementById("rtMaxAge").value = "600";
await document.getElementById("refTempForm").fire("submit");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/set_ref_temp"],
  "a timestamp-less source must persist without waiting for its next report");
assert.equal(fetchState.calls[0]?.body?.timestamp_topic, "");
assert.equal(fetchState.calls[0]?.body?.timestamp_path, "");
assert.equal(fetchState.calls[0]?.body?.fixed_setpoint_c, 20);

// Missing and malformed paths are saved as operator intent. The durable subscriber reports their
// failure only after a real MQTT frame arrives. Delete remains a separate destructive action.
const roomSource = cases.find((item) => item.modal === "refTempModal");
fetchState.calls.length = 0;
ui.S.busy = false;
open(roomSource);
document.getElementById("rtName").value = "Example sleeping sensor";
document.getElementById("rtTemperatureSource").value = "fixture/room-temperature/status";
document.getElementById("rtTarget").value = "22";
document.getElementById("rtTimestampSource").value = "";
document.getElementById("rtMaxAge").value = "600";
await document.getElementById("refTempForm").fire("submit");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/set_ref_temp"]);
assert.equal(fetchState.calls[0]?.body?.temperature_path, "",
  "a topic without a JSON path must still be persisted");
assert.equal(document.getElementById("refTempModal").hidden, true,
  "saving an unverified path must not wait for a live MQTT value");

fetchState.calls.length = 0;
ui.S.busy = false;
open(roomSource);
document.getElementById("rtTemperatureSource").value = "sensor/living-room$temperature..tC";
document.getElementById("rtTarget").value = "22";
await document.getElementById("refTempForm").fire("submit");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/set_ref_temp"]);
assert.equal(fetchState.calls[0]?.body?.temperature_path, "temperature..tC",
  "even a malformed path must reach persistence and runtime diagnostics");

fetchState.mode = "ok";
fetchState.calls.length = 0;
ui.S.busy = false;
open(roomSource);
configureValid(roomSource);
document.getElementById("rtTarget").value = "thermostat/living-room/status$target.temperature_c";
await document.getElementById("refTempForm").fire("submit");
await settle();
assert.equal(fetchState.calls[0]?.body?.setpoint_topic, "thermostat/living-room/status",
  "an MQTT target must keep its independent exact topic");
assert.equal(fetchState.calls[0]?.body?.setpoint_path, "target.temperature_c",
  "an MQTT target must split the dotted JSON path after the final $ delimiter");
assert.equal(fetchState.calls[0]?.body?.fixed_setpoint_c, 0,
  "an MQTT target must not also send a fixed temperature");

fetchState.calls.length = 0;
ui.S.busy = false;
open(roomSource);
assert.equal(document.getElementById("rtDeleteBtn").disabled, false,
  "a configured room source must expose Delete");
document.getElementById("rtName").value = "unsaved draft";
await document.getElementById("rtDeleteBtn").fire("click");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/set_ref_temp"],
  "Delete must not run the live-test endpoint");
assert.deepEqual(fetchState.calls[0]?.body, {
  name: "", topic: "", temperature_path: "", setpoint_topic: "", setpoint_path: "",
  fixed_setpoint_c: 0, timestamp_topic: "", timestamp_path: "", max_age_s: 600,
  enabled_path: "", hvac_mode_path: "",
}, "Delete must submit the explicit empty mapping rather than the draft fields");
assert.equal(document.getElementById("refTempModal").hidden, true,
  "accepted Delete must close the dialog");
assert.equal(document.body.classList.contains("modal-open"), false,
  "accepted Delete must release background scrolling");
open(roomSource);
for (const id of ["rtName", "rtTemperatureSource", "rtTarget", "rtTimestampSource"])
  assert.equal(document.getElementById(id).value, "",
    `accepted Delete must leave ${id} empty when the dialog is reopened`);
assert.equal(document.getElementById("rtMaxAge").value, "600",
  "an empty source must retain only the real default freshness limit");
assert.equal(document.getElementById("rtDeleteBtn").disabled, true,
  "the locally cleared source must not offer another Delete before the status refresh completes");

fetchState.mode = "reject";
fetchState.calls.length = 0;
ui.S.busy = false;
ui.S.status.reference_temperature = {
  configured: true, name: "Living room", topic: "sensor/living-room/temperature",
  temperature_path: "temperature.tC", setpoint_topic: "", setpoint_path: "",
  fixed_setpoint_c: 20, timestamp_topic: "sensor/living-room/sys",
  timestamp_path: "read_at", enabled_path: "enabled", hvac_mode_path: "hvac_mode",
  max_age_s: 600,
};
open(roomSource);
await document.getElementById("rtDeleteBtn").fire("click");
await settle();
assert.equal(document.getElementById("refTempModal").hidden, false,
  "rejected Delete must keep the dialog open");
assert.equal(document.body.classList.contains("modal-open"), true,
  "rejected Delete must keep background scrolling locked");
assert.equal(document.getElementById("rtDeleteBtn").disabled, false,
  "rejected Delete must release its button for retry");
assert.equal(ui.S.busy, false, "rejected Delete must release global busy state");

ui.S.status.reference_temperature = {
  configured: false, name: "stale name", topic: "stale/topic",
  temperature_path: "stale.current", setpoint_topic: "stale/target", setpoint_path: "stale.target",
  timestamp_topic: "stale/time", timestamp_path: "stale.time", enabled_path: "stale.enabled",
  hvac_mode_path: "stale.hvac", max_age_s: 900,
};
fetchState.mode = "ok";
open(roomSource);
assert.equal(document.getElementById("rtDeleteBtn").disabled, true,
  "an unconfigured source must not offer a destructive no-op");
for (const id of ["rtName", "rtTemperatureSource", "rtTarget", "rtTimestampSource"])
  assert.equal(document.getElementById(id).value, "",
    `an unconfigured source must ignore stale ${id} status data`);
assert.equal(document.getElementById("rtMaxAge").value, "600",
  "an unconfigured source must use the standard freshness limit instead of stale status data");
fetchState.calls.length = 0;
ui.S.busy = false;
configureValid(roomSource);
await document.getElementById("refTempForm").fire("submit");
await settle();
assert.equal(fetchState.calls[0]?.body?.enabled_path, "",
  "a new source must not inherit a stale hidden enabled gate");
assert.equal(fetchState.calls[0]?.body?.hvac_mode_path, "",
  "a new source must not inherit a stale hidden HVAC gate");
ui.S.status.reference_temperature.configured = true;

// Circulation-source Save follows the same proof boundary, but its proof is actual active power.
// Delete removes only the read-only observer mapping; there is no device switch request.
const circulationSource = cases.find((item) => item.modal === "circulationModal");
fetchState.mode = "circ_test_reject";
fetchState.calls.length = 0;
ui.S.busy = false;
open(circulationSource);
configureValid(circulationSource);
await document.getElementById("circulationForm").fire("submit");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/test_circulation"],
  "a failed live power test must not persist the circulation source");
assert.equal(document.getElementById("circulationModal").hidden, false);
assert.equal(document.getElementById("circError").hidden, false);
assert.equal(ui.S.busy, false);

fetchState.mode = "ok";
fetchState.calls.length = 0;
ui.S.busy = false;
open(circulationSource);
assert.equal(document.getElementById("circDeleteBtn").disabled, false);
document.getElementById("circTopic").value = "unsaved/draft";
await document.getElementById("circDeleteBtn").fire("click");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/set_circulation"],
  "circulation Delete must not run the live-test endpoint");
assert.deepEqual(fetchState.calls[0]?.body, {
  name: "", topic: "", power_path: "", timestamp_path: "", max_age_s: 120,
  on_threshold_w: 3, off_threshold_w: 1, confirm_s: 60, test_proof: 0,
}, "circulation Delete must submit the explicit empty observer mapping");
assert.equal(document.getElementById("circulationModal").hidden, true);
open(circulationSource);
assert.equal(document.getElementById("circTopic").value, "");
assert.equal(document.getElementById("circPowerPath").value, "apower");
assert.equal(document.getElementById("circTimePath").value, "aenergy.minute_ts");
assert.equal(document.getElementById("circDeleteBtn").disabled, true);

// ENV III now belongs to the Board Hardware form. Custom/Seeed hide and disable the entire
// accessory section; Atom reveals it. No-sensor and board hardware are persisted atomically.
const boardCase = cases.find((item) => item.modal === "boardModal");
ui.S.status.board.preset_id = "custom";
ui.S.status.board.preset_name = "";
ui.S.status.board.user_set = true;
open(boardCase);
assert.equal(document.getElementById("bdEnvSection").hidden, true,
  "Custom board must hide the M5Stack outdoor-sensor settings");
assert.equal(document.getElementById("envSensor").disabled, true);
assert.equal(document.getElementById("envSda").disabled, true);
assert.equal(document.getElementById("envScl").disabled, true);

ui.S.status.board.preset_id = "m5stack_atoms3_lite";
ui.S.status.board.preset_name = "M5Stack AtomS3 Lite";
ui.S.status.env3.enabled = false;
fetchState.mode = "ok";
fetchState.calls.length = 0;
ui.S.busy = false;
open(boardCase);
assert.equal(document.getElementById("bdEnvSection").hidden, false,
  "AtomS3 Lite must expose the integrated outdoor-sensor settings");
assert.equal(document.getElementById("envPinFields").hidden, true);
assert.equal(document.getElementById("envSda").disabled, true);
assert.equal(document.getElementById("envScl").disabled, true);
await document.getElementById("boardForm").fire("submit");
await settle();
const disableRequest = fetchState.calls.find((call) => call.url === "/set_board");
assert.equal(disableRequest?.body?.preset_id, "m5stack_atoms3_lite");
assert.equal(disableRequest?.body?.env3_enabled, false, "No sensor must release both GPIOs atomically");

// Peripheral customization must not rewrite the explicit board identity to Custom.
fetchState.calls.length = 0;
ui.S.busy = false;
open(boardCase);
document.getElementById("bdLedType").value = "-1";
await document.getElementById("bdLedType").fire("change");
document.getElementById("bdBtnPin").value = "-1";
await document.getElementById("bdBtnPin").fire("change");
assert.equal(document.getElementById("bdPreset").value, "m5stack_atoms3_lite",
  "disabling LED/reset must keep AtomS3 Lite selected");
await document.getElementById("boardForm").fire("submit");
await settle();
const customized = fetchState.calls.find((call) => call.url === "/set_board")?.body;
assert.equal(customized?.preset_id, "m5stack_atoms3_lite");
assert.equal(customized?.led_gpio, -1);
assert.equal(customized?.btn_gpio, -1);

ui.S.status.env3.enabled = true;
fetchState.mode = "ok";
ui.S.busy = false;
open(boardCase);
document.getElementById("envSensor").value = "";
await document.getElementById("envSensor").fire("change");
assert.equal(document.getElementById("envPinFields").hidden, true, "No sensor selection hides pins immediately");
document.getElementById("envSensor").value = "env_iii";
await document.getElementById("envSensor").fire("change");
assert.equal(document.getElementById("envPinFields").hidden, false, "ENV III selection reveals pins immediately");
document.getElementById("envScl").value = document.getElementById("envSda").value;
fetchState.calls.length = 0;
await document.getElementById("boardForm").fire("submit");
await settle();
assert.equal(fetchState.calls.length, 0, "equal ENV III pins must be rejected before POST");
assert.equal(document.getElementById("boardModal").hidden, false, "invalid ENV III pins stay editable");

document.getElementById("envSda").value = "2";
document.getElementById("envScl").value = "1";
fetchState.mode = "env3_missing";
fetchState.calls.length = 0;
await document.getElementById("boardForm").fire("submit");
await settle();
assert.ok(fetchState.calls.some((call) => call.url === "/set_board"),
  "a valid integrated ENV III pair must be checked by firmware");
assert.equal(document.getElementById("boardModal").hidden, false,
  "an unreachable ENV III must not be accepted or close Board Hardware");
assert.equal(document.getElementById("bdError").hidden, false,
  "an unreachable ENV III must show an inline error in Board Hardware");
assert.equal(document.getElementById("bdError").textContent,
  "Der Temperatur-/Feuchtesensor des ENV III ist an diesen Pins nicht erreichbar.");
assert.equal(ui.S.busy, false, "a failed ENV III probe must release the shared Save button");

// Representative invalid inputs for every client-validated transport stay in their dialog and do
// not reach firmware. Server-validated NTP/Board paths are covered by the HTTP rejection loop above.
const invalid = [
  { modal: "wifiModal", form: "wifiForm", set() { document.getElementById("wfSSID").value = ""; } },
  { modal: "mqttModal", form: "mqttForm", set() { document.getElementById("mqBroker").value = "bad uri"; } },
  { modal: "refTempModal", form: "refTempForm", set() { document.getElementById("rtTemperatureSource").value = "bad/#$value"; } },
  { modal: "weatherModal", form: "weatherForm", set() { document.getElementById("wxLatitude").value = "51.0"; document.getElementById("wxLongitude").value = ""; } },
  { modal: "syslogModal", form: "syslogForm", set() { document.getElementById("slHost").value = "host:not-a-port"; } },
  { modal: "homehubModal", form: "homehubForm", set() { document.getElementById("hhPort").value = "70000"; } },
];
for (const scenario of invalid) {
  const item = cases.find((entry) => entry.modal === scenario.modal);
  fetchState.mode = "ok";
  fetchState.calls.length = 0;
  ui.S.busy = false;
  open(item);
  scenario.set();
  await document.getElementById(scenario.form).fire("submit");
  await settle();
  assert.equal(fetchState.calls.length, 0, `${item.name}: invalid input must not POST`);
  assert.equal(document.getElementById(item.modal).hidden, false, `${item.name}: invalid input stays editable`);
}

// ── MQTT base topic ───────────────────────────────────────────────────────────────────────────
// The base topic is this INSTALLATION's identity: two boards sharing it share their retained topics,
// their metrics series and their Home Assistant device, silently. The field must therefore actually
// reach the device, and a refusal must land on the field that caused it — blaming the broker box for
// a bad base topic sends the user to edit the one input that was correct.
const mqttCase = cases.find((item) => item.modal === "mqttModal");

// 1. Prefilled with the EFFECTIVE base from /status, not left blank (blank reads as "not set" for a
//    value the device is definitely publishing under), and submitted with the rest of the form.
fetchState.mode = "ok";
fetchState.calls.length = 0;
ui.S.busy = false;
open(mqttCase);
assert.equal(document.getElementById("mqBase").value, "daikin-altherma-esp32",
  "the MQTT modal must prefill the base topic the device actually publishes under");
document.getElementById("mqBase").value = "  daikin-bench-2  ";
await document.getElementById("mqttForm").fire("submit");
await settle();
const mqttSave = fetchState.calls.find((call) => call.url === "/set_mqtt");
assert.ok(mqttSave, "Save must POST /set_mqtt");
assert.equal(mqttSave.body.base, "daikin-bench-2",
  "the base topic must be sent, trimmed — a stray space is a different topic to a broker");

// 2. A coded refusal lands on the BASE field with the German translation of that exact code, and
//    leaves the broker field alone. The browser keeps no copy of the rules (logic/mqtt_base.hpp owns
//    them), so this path is the only feedback the user gets.
fetchState.mode = "mqtt_base_reject";
fetchState.calls.length = 0;
ui.S.busy = false;
open(mqttCase);
document.getElementById("mqBase").value = "___";
await document.getElementById("mqttForm").fire("submit");
await settle();
assert.equal(document.getElementById("mqttModal").hidden, false,
  "a rejected base topic must keep the dialog open");
assert.equal(document.getElementById("mqBaseError").hidden, false,
  "a rejected base topic must show its error on the base field");
assert.ok(document.getElementById("mqBaseError").textContent.includes("Buchstaben"),
  "the base-topic refusal must be translated from its machine code");
assert.equal(document.getElementById("mqError").hidden, true,
  "a base-topic refusal must not blame the broker field");
assert.equal(ui.S.busy, false, "a rejected base topic must release the Save button");

// 3. A code this UI has no string for still lands on the base field, showing the device's own
//    English text rather than a raw "err.<code>" key — a firmware that grows a rule ahead of these
//    translations degrades to untranslated, never to nonsense or to the wrong field.
fetchState.mode = "mqtt_base_unknown_code";
fetchState.calls.length = 0;
ui.S.busy = false;
open(mqttCase);
document.getElementById("mqBase").value = "whatever";
await document.getElementById("mqttForm").fire("submit");
await settle();
assert.equal(document.getElementById("mqBaseError").hidden, false,
  "an unknown base-topic code must still show on the base field");
assert.equal(document.getElementById("mqBaseError").textContent,
  "Base topic violates a rule this UI predates",
  "an untranslated code must fall back to the device's English text, not the i18n key");
assert.equal(document.getElementById("mqError").hidden, true,
  "an unknown base-topic code must not blame the broker field");

// 4. A non-base rejection still lands on the BROKER field — the routing must not have inverted.
fetchState.mode = "reject";
fetchState.calls.length = 0;
ui.S.busy = false;
open(mqttCase);
await document.getElementById("mqttForm").fire("submit");
await settle();
assert.equal(document.getElementById("mqError").hidden, false,
  "an ordinary MQTT rejection must still show on the broker field");
assert.equal(document.getElementById("mqBaseError").hidden, true,
  "an ordinary MQTT rejection must not blame the base-topic field");

// The bug dialog has a two-stage action instead of a configuration form.
const bug = cases.find((item) => item.modal === "bugModal");
open(bug);
await document.getElementById("bugGo").onclick();
assert.equal(document.getElementById("bugStep1").hidden, false, "empty report must stay on step one");
document.getElementById("bugWhat").value = "ENV III buttons do not react";
await document.getElementById("bugGo").onclick();
assert.equal(document.getElementById("bugStep2").hidden, false, "valid report must reach review step");
assert.equal(typeof document.getElementById("bugCopy").onclick, "function", "prepared report must wire Copy");
await document.getElementById("bugClose").onclick();
assert.equal(document.getElementById("bugModal").hidden, true, "bug review Close must dismiss");

console.log(`UI use cases: ${cases.length} modals, navigation, Cancel/backdrop/Escape, accepted/rejected/invalid Save paths`);
