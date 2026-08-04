// End-to-end interaction contract for the dependency-free device UI.  It executes the production
// wiring and modal functions in a small DOM harness so every dialog action is tested as behavior,
// not merely matched as source text.  Adding a modal without adding its lifecycle here fails.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

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
  if (fetchState.mode === "env3_missing" && url === "/set_env3")
    return response(false, {
      code: "env3_sht30_not_found",
      error: "ENV III temperature/humidity sensor not found on the selected pins",
    }, 422);
  if (url === "/test_ref_temp") {
    if (fetchState.mode === "ref_test_reject")
      return response(false, { error: "No fresh value received before the test timed out" }, 422);
    return response(true, { ok: true, test_proof: 71, temperature_c: 21.5, retained: false });
  }
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

const source = readAppFragments(["i18n.js", "app_state.js", "settings.js", "bootstrap.js"])
  .replace(/\nboot\(\);\s*$/, "\n");
vm.runInContext(`${source}
  toast = () => {};
  renderApp = () => {};
  refreshStatus = async () => true;
  collectBugReport = async () => ({ text: "redacted report", failed: false });
  this.__ui = {
    S, MODALS, POPUP_ROUTES, wire, initNavigation, applyRouteFromLocation, hydrateRoutedPopup,
    openWifi, openMqtt, openRefTemp, openWeather, openSyslog,
    openNtp, openHomehub, openBoard, openEnv3, openBug,
  };`, context, { filename: "main/www/app.sources" });
const ui = context.__ui;

ui.S.status = {
  wifi: { ssid: "DemoNet" },
  mqtt: { broker: "203.0.113.27:1883", has_creds: false },
  reference_temperature: {
    configured: true, name: "Living room", topic: "sensor/living-room/status",
    temperature_path: "temperature.tC", timestamp_path: "", max_age_s: 600,
  },
  weather_forecast: { latitude: "", longitude: "" },
  syslog: {},
  ntp: { server: "pool.ntp.org" },
  modbus: { host: "", port: 502, unit_id: 1 },
  board: {
    preset_id: "m5stack_atoms3_lite",
    presets: [],
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
  { name: "Weather", modal: "weatherModal", open: "openWeather", cancel: "wxCancel", backdrop: "weatherBackdrop", form: "weatherForm", url: "/set_weather" },
  { name: "Syslog", modal: "syslogModal", open: "openSyslog", cancel: "slCancel", backdrop: "syslogBackdrop", form: "syslogForm", url: "/set_syslog" },
  { name: "NTP", modal: "ntpModal", open: "openNtp", cancel: "ntpCancel", backdrop: "ntpBackdrop", form: "ntpForm", url: "/set_ntp" },
  { name: "HomeHub", modal: "homehubModal", open: "openHomehub", cancel: "hhCancel", backdrop: "homehubBackdrop", form: "homehubForm", url: "/set_hp", customSave: true },
  { name: "Board", modal: "boardModal", open: "openBoard", cancel: "bdCancel", backdrop: "boardBackdrop", form: "boardForm", url: "/set_board" },
  { name: "ENV III", modal: "env3Modal", open: "openEnv3", cancel: "envCancel", backdrop: "env3Backdrop", form: "env3Form", url: "/set_env3" },
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

const supportedStatus = ui.S.status;
ui.S.status = { ...supportedStatus, env3: { ...supportedStatus.env3, supported: false } };
loadRoute("#settings/env-iii");
assert.equal(document.getElementById("env3Modal").hidden, true,
  "a board-gated popup route must fail closed when the device does not expose it");
assert.equal(location.hash, "#settings", "an unavailable popup route must canonicalize to Settings");
ui.S.status = supportedStatus;

// This is the state a full reload presents to initNavigation: a URL selected by the address bar,
// with no in-app parent metadata. The exact dialog must be restored and an explicit close must stay
// inside the app instead of navigating to whatever site preceded the pasted link.
loadRoute("#settings/mqtt");
assert.equal(ui.S.stage, "settings", "a popup URL must restore its Settings parent");
assert.equal(document.getElementById("mqttModal").hidden, false, "a popup URL must restore the exact popup");
assert.equal(document.getElementById("mqBroker").value, "203.0.113.27:1883",
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
assert.equal(document.getElementById("wfSSID").value, "DemoNet",
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
assert.equal(document.getElementById("wfSSID").value, "DemoNet",
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
  ["settingsCards", "[data-act]", "act", "weather", "weatherModal"],
  ["settingsCards", "[data-act]", "act", "env3", "env3Modal"],
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
    document.getElementById("rtTopic").value = "sensor/living-room/status";
    document.getElementById("rtPath").value = "temperature.tC";
    document.getElementById("rtTimePath").value = "";
    document.getElementById("rtMaxAge").value = "600";
  }
  if (item.modal === "env3Modal") {
    document.getElementById("envSensor").value = "env_iii";
    document.getElementById("envSda").value = "2";
    document.getElementById("envScl").value = "1";
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
    assert.deepEqual(fetchState.calls.map((call) => call.url), ["/test_ref_temp", "/set_ref_temp"],
      "one room-source Save must run live test before persistence");
    assert.equal(fetchState.calls[1]?.body?.test_proof, 71,
      "room-source persistence must present the proof returned by that live test");
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

// Room source Save owns validation + live test + persistence. A failed live read never reaches the
// write endpoint, and the separate destructive action clears the mapping without testing whatever
// draft happens to be in the form.
const roomSource = cases.find((item) => item.modal === "refTempModal");
fetchState.mode = "ref_test_reject";
fetchState.calls.length = 0;
ui.S.busy = false;
open(roomSource);
configureValid(roomSource);
await document.getElementById("refTempForm").fire("submit");
await settle();
assert.deepEqual(fetchState.calls.map((call) => call.url), ["/test_ref_temp"],
  "a failed live test must not attempt to persist the room source");
assert.equal(document.getElementById("refTempModal").hidden, false,
  "a failed live test must keep the mapping editable");
assert.equal(document.getElementById("rtError").hidden, false,
  "a failed live test must explain its failure inline");
assert.equal(ui.S.busy, false, "a failed live test must release Save");

fetchState.mode = "ok";
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
  name: "", topic: "", temperature_path: "", timestamp_path: "", max_age_s: 600, test_proof: 0,
}, "Delete must submit the explicit empty mapping rather than the draft fields");
assert.equal(document.getElementById("refTempModal").hidden, true,
  "accepted Delete must close the dialog");
assert.equal(document.body.classList.contains("modal-open"), false,
  "accepted Delete must release background scrolling");

fetchState.mode = "reject";
fetchState.calls.length = 0;
ui.S.busy = false;
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

ui.S.status.reference_temperature.configured = false;
fetchState.mode = "ok";
open(roomSource);
assert.equal(document.getElementById("rtDeleteBtn").disabled, true,
  "an unconfigured source must not offer a destructive no-op");
ui.S.status.reference_temperature.configured = true;

// ENV III's board gate and both selector states are distinct use cases.  Pins disappear and are
// disabled when no sensor is selected, and the disable request must not leak stale pin values.
ui.S.status.env3.supported = false;
resetModals();
ui.openEnv3();
assert.equal(document.getElementById("env3Modal").hidden, true, "unsupported board must not open ENV III");
ui.S.status.env3.supported = true;
ui.S.status.env3.enabled = false;
fetchState.mode = "ok";
fetchState.calls.length = 0;
open(cases.find((item) => item.modal === "env3Modal"));
assert.equal(document.getElementById("envPinFields").hidden, true);
assert.equal(document.getElementById("envSda").disabled, true);
assert.equal(document.getElementById("envScl").disabled, true);
await document.getElementById("env3Form").fire("submit");
await settle();
const disableRequest = fetchState.calls.find((call) => call.url === "/set_env3");
assert.deepEqual(disableRequest?.body, { enabled: false }, "No sensor must release both GPIOs");

ui.S.status.env3.enabled = true;
open(cases.find((item) => item.modal === "env3Modal"));
document.getElementById("envSensor").value = "";
await document.getElementById("envSensor").fire("change");
assert.equal(document.getElementById("envPinFields").hidden, true, "No sensor selection hides pins immediately");
document.getElementById("envSensor").value = "env_iii";
await document.getElementById("envSensor").fire("change");
assert.equal(document.getElementById("envPinFields").hidden, false, "ENV III selection reveals pins immediately");
document.getElementById("envScl").value = document.getElementById("envSda").value;
fetchState.calls.length = 0;
await document.getElementById("env3Form").fire("submit");
await settle();
assert.equal(fetchState.calls.length, 0, "equal ENV III pins must be rejected before POST");
assert.equal(document.getElementById("env3Modal").hidden, false, "invalid ENV III pins stay editable");

document.getElementById("envSda").value = "2";
document.getElementById("envScl").value = "1";
fetchState.mode = "env3_missing";
fetchState.calls.length = 0;
await document.getElementById("env3Form").fire("submit");
await settle();
assert.ok(fetchState.calls.some((call) => call.url === "/set_env3"),
  "a valid ENV III pair must be checked by firmware");
assert.equal(document.getElementById("env3Modal").hidden, false,
  "an unreachable ENV III must not be accepted or close the dialog");
assert.equal(document.getElementById("envError").hidden, false,
  "an unreachable ENV III must show an inline error");
assert.equal(document.getElementById("envError").textContent,
  "Der Temperatur-/Feuchtesensor des ENV III ist an diesen Pins nicht erreichbar.");
assert.equal(ui.S.busy, false, "a failed ENV III probe must release the Save button");

// Representative invalid inputs for every client-validated transport stay in their dialog and do
// not reach firmware. Server-validated NTP/Board paths are covered by the HTTP rejection loop above.
const invalid = [
  { modal: "wifiModal", form: "wifiForm", set() { document.getElementById("wfSSID").value = ""; } },
  { modal: "mqttModal", form: "mqttForm", set() { document.getElementById("mqBroker").value = "bad uri"; } },
  { modal: "refTempModal", form: "refTempForm", set() { document.getElementById("rtTopic").value = "bad/#"; } },
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
