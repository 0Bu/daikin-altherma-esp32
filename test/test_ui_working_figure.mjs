// Contract and interaction test for the 24-hour working-figure observation row, gas-comparison
// tariff lifecycle, and optional MQTT external power-meter settings. Executes the assembled
// English production UI bundle in a DOM/VM harness without depending on external locale files.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppSource } from "../tools/ui/read_app_source.mjs";

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
    this.hidden = String(id).endsWith("Modal");
    this.innerHTML = "";
    this._textContent = "";
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.classList = new ClassList();
    this.listeners = new Map();
    this.onclick = null;
  }
  set value(value) { this._value = String(value ?? ""); }
  get value() { return this._value; }
  set textContent(value) { this._textContent = String(value ?? ""); this.children = []; }
  get textContent() { return this._textContent; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener() {}
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
      stopPropagation() {},
    };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    if (type === "click" && typeof this.onclick === "function") await this.onclick(event);
    return event;
  }
  querySelector(selector) {
    if (selector === '[role="dialog"]') return this;
    return null;
  }
  querySelectorAll() {
    return (this.doc.modalControls?.get(this.id) || []).map((id) => this.doc.getElementById(id));
  }
  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); this[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { this.children.push(child); this.lastChild = child; return child; }
  remove() {}
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  matches() { return false; }
  closest() { return null; }
  contains(child) { return this.doc.modalControls?.get(this.id)?.includes(child.id) || false; }
  setPointerCapture() {}
  releasePointerCapture() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; }
}

class Document {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.activeElement = null;
    this.hidden = false;
    this.documentElement = new Element("html", this);
    this.body = new Element("body", this);
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new Element(id, this));
    return this.elements.get(id);
  }
  createElement(tag) { return new Element(`tag:${tag}`, this); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener() {}
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
const fetchState = { mode: "ok", calls: [], status: {} };
const response = (ok, payload, status = ok ? 200 : 400) => ({
  ok,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

const fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  fetchState.calls.push({ url, body });
  if (url === "/status") return response(true, fetchState.status || {});
  if (url === "/test_power_meter") {
    if (fetchState.mode === "pm_test_live")
      return response(true, { ok: true, power_w: 1420.5, retained: false });
    if (fetchState.mode === "pm_test_retained")
      return response(true, { ok: true, power_w: 850, retained: true });
    if (fetchState.mode === "pm_test_fail")
      return response(false, { error: "No fresh power-meter value received before timeout" }, 422);
  }
  if (fetchState.mode === "gc_reject" && url === "/set_gas_comparison")
    return response(false, { error: fetchState.error || "Invalid gas tariff" }, 400);
  if (fetchState.mode === "pm_reject" && url === "/set_power_meter")
    return response(false, { error: fetchState.error || "Invalid power meter path" }, 400);
  return response(true, { ok: true, saved: true, reboot: false });
};

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
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => "", overflowX: "visible", paddingLeft: "0px" }),
  innerWidth: 900,
  innerHeight: 800,
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

const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
document.modalControls = new Map();
const modalStarts = [...html.matchAll(/<div class="modal" id="([^"]+Modal)"/g)];
for (let i = 0; i < modalStarts.length; i++) {
  const block = html.slice(modalStarts[i].index, modalStarts[i + 1]?.index ?? html.length);
  document.modalControls.set(modalStarts[i][1],
    [...block.matchAll(/<(?:button|input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
}

const context = vm.createContext({
  document,
  fetch,
  navigator: { language: "en-US" },
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
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  console,
});

const source = readAppSource().replace(/\nboot\(\);\s*$/, "\n");
vm.runInContext(`${source}
  const notices = [];
  toast = (message, type) => { notices.push({ message, type }); };
  renderApp = () => {};
  refreshStatus = async () => true;
  this.__wf = {
    S, t, esc, notices, wire, initNavigation, applyRouteFromLocation,
    workingFigureRowHtml, checkupCardHtml, circulationSettingsCardHtml,
    openGasComparison, closeGasComparison, openPowerMeter, closePowerMeter,
    MODALS, ROUTED_MODALS, POPUP_ROUTES,
  };`, context, { filename: "main/www/app.sources" });

const ui = context.__wf;
ui.wire();
ui.initNavigation();

const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
const loadRoute = (hash) => {
  history.replaceState(null, "", `/${hash}`);
  ui.applyRouteFromLocation();
};
const delegatedTarget = (selector, key, value) => ({
  closest(query) { return query === selector ? { dataset: { [key]: value } } : null; },
});

function baseStatus() {
  return {
    version: "1.0.0-dev.500",
    uptime_s: 90000,
    hp: { proto: "I", rx: 1, tx: 2, connected: true, last_ok_s: 0 },
    diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
    mqtt: { configured: true, connected: true, broker: "192.0.2.27:1883", base: "daikin-altherma-esp32" },
    circulation_source: { configured: false, max_age_s: 120 },
    gas_comparison: { configured: false, gas_efficiency_pct: 88, currency: "EUR" },
    power_meter: { configured: false, unit: "W", scope: "whole_unit", max_age_s: 60 },
    health: {
      source: "x10a",
      status: "ok",
      full_span: true,
      span_s: 86400,
      source_fresh: true,
      source_age_s: 1,
      available: 2,
      assessable: 2,
      evaluated: 2,
      checks: [
        { id: "fault", verdict: "ok", evidence: "manufacturer", active: 0 },
        { id: "pressure", verdict: "ok", evidence: "heuristic", min_bar: 1.8, current_bar: 1.9,
          observed_s: 86400, required_s: 77760 },
      ],
    },
    working_figure: {
      kind: "observation",
      supported: true,
      state: "cheaper",
      tariffs_configured: true,
      full_window: true,
      source_fresh: true,
      is_estimate: false,
      is_compressor_only: false,
      pel_source: "mqtt_whole_unit",
      span_s: 86400,
      observed_s: 86400,
      unpairable_s: 0,
      defrost_s: 0,
      buh_s: 0,
      bsh_excluded_s: 0,
      cooling_excluded_s: 0,
      coverage_pct: 100,
      neutral_band_pct: 10,
      heat_kwh: 41.0,
      elec_kwh: 10.0,
      az: 4.10,
      gas_efficiency_pct: 88,
      currency: "EUR",
      elec_price: 0.32,
      gas_price: 0.105,
      break_even_az: 2.68,
      gas_equiv_kwh: 46.6,
      cost_wp: 3.20,
      cost_gas: 4.89,
      cost_delta: -1.69,
      cost_delta_pct: -34.6,
      outdoor_mean_c: 4.2,
      outdoor_min_c: 1.1,
      limited_buh: false,
      unpaired_buh: false,
      ct_unwired: false,
    },
  };
}

// ── 1. Absence on older firmware / Modbus / diagnostics disabled ────────────────────────────────
{
  const s = baseStatus();
  for (const absent of [undefined, null, "invalid", []]) {
    ui.S.status = { ...s, working_figure: absent };
    assert.equal(ui.workingFigureRowHtml(), "",
      `workingFigureRowHtml() must be empty when working_figure is ${JSON.stringify(absent)}`);
  }

  ui.S.status = {
    ...s,
    diagnostics: { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["x10a", "modbus"] },
    health: { ...s.health, source: "modbus" },
  };
  const modbusCard = ui.checkupCardHtml(true);
  assert.doesNotMatch(modbusCard, /observation:working_figure/,
    "working_figure must stay hidden when health.source is modbus");

  ui.S.status = {
    ...s,
    diagnostics: { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["modbus"] },
    health: { status: "collecting", checks: [] },
  };
  assert.doesNotMatch(ui.checkupCardHtml(true), /observation:working_figure/,
    "working_figure must stay hidden when diagnostics.effective_source is modbus");
}

// ── 2. Card summary badge invariance across working_figure states ───────────────────────────────
{
  const s = baseStatus();
  for (const wfState of ["more_expensive", "limited", "cheaper", "partial", "collecting", "standby", "measured", "unsupported"]) {
    ui.S.status = {
      ...s,
      working_figure: {
        ...s.working_figure,
        supported: wfState !== "unsupported",
        state: wfState,
        limited_buh: wfState === "limited",
      },
    };
    const card = ui.checkupCardHtml(true);
    assert.match(card, new RegExp(`<span class="section-badge ok">${ui.t("check.summary.ok")}</span>`),
      `card badge must remain ${ui.t("check.summary.ok")} regardless of working_figure state (${wfState})`);
  }

  ui.S.status = {
    ...s,
    health: {
      ...s.health,
      status: "warn",
      checks: [{ id: "fault", verdict: "warn", evidence: "manufacturer", active: 1 }],
    },
    working_figure: { ...s.working_figure, state: "more_expensive", limited_buh: true },
  };
  assert.match(ui.checkupCardHtml(true), new RegExp(`<span class="section-badge err">${ui.t("check.summary.warnings", 1)}</span>`),
    "card warning count must count health checks only, never working_figure");
}

// ── 3. All 9 working_figure states: text, ~ estimate prefix, tone, suffix, words-only ariaValue ─
{
  const stateExpectations = [
    { state: "collecting", supported: true, est: true, az: 0, text: "Collecting", tone: "dim", aria: "Collecting" },
    { state: "standby", supported: true, est: true, az: 0, text: "Standby", tone: "dim", aria: "Standby" },
    { state: "unsupported", supported: false, est: false, az: 0, text: "Not supported", tone: "dim", aria: "Not supported" },
    { state: "measured", supported: true, est: false, az: 3.45, tariffs: false, text: "3.45", tone: "", aria: "3.45 · measured" },
    { state: "measured", supported: true, est: true, az: 3.45, tariffs: false, text: "~3.45", tone: "", aria: "estimated 3.45 · measured" },
    { state: "cheaper", supported: true, est: false, az: 4.10, text: "4.10", tone: "ok", aria: "4.10 · cheaper than gas" },
    { state: "cheaper", supported: true, est: true, az: 4.10, text: "~4.10", tone: "ok", aria: "estimated 4.10 · cheaper than gas" },
    { state: "similar", supported: true, est: false, az: 3.05, text: "3.05", tone: "", aria: "3.05 · like gas" },
    { state: "more_expensive", supported: true, est: false, az: 2.15, text: "2.15", tone: "warn", aria: "2.15 · costlier than gas" },
    { state: "more_expensive", supported: true, est: true, az: 2.15, text: "~2.15", tone: "warn", aria: "estimated 2.15 · costlier than gas" },
    { state: "partial", supported: true, est: false, az: 3.60, fullWindow: false, text: "3.60 · prov.", tone: "", aria: "3.60 · provisional" },
    { state: "partial", supported: true, est: true, az: 3.60, fullWindow: false, text: "~3.60 · prov.", tone: "", aria: "estimated 3.60 · provisional" },
    { state: "limited", supported: true, est: false, az: 3.25, limitedBuh: true, text: "3.25 · lim.", tone: "warn", aria: "3.25 · limited" },
    { state: "limited", supported: true, est: true, az: 3.25, limitedBuh: true, text: "~3.25 · lim.", tone: "warn", aria: "estimated 3.25 · limited" },
  ];

  const disclosure = "24 h Heating+DHW (excl. cooling); pure water 4.186 kJ/(L·K); gas Hs; no fixed fees.";
  for (const spec of stateExpectations) {
    const s = baseStatus();
    s.working_figure = {
      ...s.working_figure,
      supported: spec.supported,
      state: spec.state,
      is_estimate: spec.est,
      tariffs_configured: spec.tariffs ?? true,
      full_window: spec.fullWindow ?? true,
      limited_buh: spec.limitedBuh ?? false,
      az: spec.az,
    };
    ui.S.status = s;
    const row = ui.workingFigureRowHtml();
    const expectedCls = `checkup-val${spec.tone ? ` ${spec.tone}` : ""}`;
    assert.match(row, new RegExp(`<span class="vrow-val ${expectedCls}">${spec.text.replace(".", "\\.")}</span>`),
      `${spec.state} (est=${spec.est}): collapsed value/tone mismatch`);
    assert.ok(row.includes(`aria-label="Performance factor: ${spec.aria}"`),
      `${spec.state} (est=${spec.est}): expected aria-label "Performance factor: ${spec.aria}"`);
    assert.ok(row.includes(disclosure),
      `${spec.state}: pure-water / Heating+DHW / Hs disclosure must always be present`);
  }
}

// ── 4. Expanded body: KPIs, scale bar, BUH/BSH/CT banners & context metadata ───────────────────
{
  // (a) Tariffs configured -> 4 KPI tiles + Break-Even scale bar + ~ prefix on estimates
  const s = baseStatus();
  s.working_figure = {
    ...s.working_figure,
    state: "cheaper",
    tariffs_configured: true,
    is_estimate: true,
    pel_source: "x10a_ct",
    neutral_band_pct: 20,
    buh_s: 1800,
    defrost_s: 300,
    cooling_excluded_s: 600,
  };
  ui.S.status = s;
  let body = ui.workingFigureRowHtml();
  assert.match(body, /class="wf-kpis wf-kpis-4"/, "configured tariffs must render 4 KPI tiles");
  assert.equal((body.match(/class="wf-kpi"/g) || []).length, 4);
  assert.match(body, /class="wf-scale"/, "configured tariffs must render Break-Even scale bar");
  assert.match(body, /±20%/, "X10A estimate scale bar must render ±20% neutral band");
  assert.match(body, /~10\.0 kWh/, "estimate flag must prefix electricity kWh with ~");
  assert.match(body, /~3\.20 €/, "estimate flag must prefix heat-pump cost with ~");
  assert.match(body, /Backup electric heater ran \(30 min\); included\./,
    "whole-unit buh_s > 0 without limited_buh must render buh_active banner");
  assert.match(body, /5 min \/ 30 min/, "defrost/BUH context line must appear when either is positive");
  assert.match(body, /Cooling excl\./, "cooling exclusion metadata must appear when positive");
  assert.match(body, /data-act="gas-comparison">Edit tariffs</);

  // (b) Tariffs unconfigured -> 2 KPI tiles + Set tariffs button, NO scale bar
  s.working_figure = {
    ...s.working_figure,
    state: "measured",
    tariffs_configured: false,
    is_estimate: false,
    is_compressor_only: true,
    pel_source: "mqtt_compressor",
    buh_s: 0,
  };
  ui.S.status = s;
  body = ui.workingFigureRowHtml();
  assert.doesNotMatch(body, /wf-kpis-4/, "unconfigured tariffs must not render 4 KPI tiles");
  assert.equal((body.match(/class="wf-kpi"/g) || []).length, 2, "unconfigured tariffs must render 2 KPI tiles");
  assert.doesNotMatch(body, /class="wf-scale"/, "unconfigured tariffs must omit Break-Even scale bar");
  assert.match(body, /comp\. only/, "compressor-only scope label must appear in KPI tile");
  assert.match(body, /data-act="gas-comparison">Set tariffs</);

  // (c) limited_buh: true -> renders wf.banner.buh_limited warning instead of buh_active even with buh_s > 0
  s.working_figure = {
    ...s.working_figure,
    state: "limited",
    tariffs_configured: true,
    limited_buh: true,
    buh_s: 1200,
    bsh_excluded_s: 900,
    ct_unwired: true,
    source_fresh: false,
    pel_source: "x10a_inv",
  };
  ui.S.status = s;
  body = ui.workingFigureRowHtml();
  assert.match(body, /<div class="wf-banner warn">Backup\/booster heater ran while metering compressor only — excluded load may distort the figure\.<\/div>/,
    "limited_buh must render buh_limited warning");
  assert.doesNotMatch(body, /Backup electric heater ran/,
    "limited_buh must suppress whole-unit 1:1 buh_active claim");
  assert.match(body, /<div class="wf-banner warn">BSH \(15 min\) excluded \(outside circuit\)\.<\/div>/);
  assert.match(body, /<div class="wf-banner warn">CT 0 A with comp\.; using inverter \(comp\. only\)\.<\/div>/);
  assert.match(body, /X10A inv\. \(est\., comp\. only\) · stale/, "stale pel source must be marked stale");

  // (d) unpaired_buh: true -> renders buh_unpaired warning
  s.working_figure = {
    ...s.working_figure,
    limited_buh: false,
    unpaired_buh: true,
    buh_s: 600,
    bsh_excluded_s: 0,
    ct_unwired: false,
  };
  ui.S.status = s;
  body = ui.workingFigureRowHtml();
  assert.match(body, /<div class="wf-banner warn">BUH active\/unknown without post-BUH R2T — excluded\.<\/div>/);
  assert.doesNotMatch(body, /Backup electric heater ran/);
}

// ── 5. Settings split card (circulationSettingsCardHtml) ───────────────────────────────────────
{
  const s = baseStatus();
  delete s.working_figure; // e.g. Modbus-only or pre-detection: Settings card still reads gas_comparison
  s.gas_comparison = {
    configured: true,
    elec_price: 0.32,
    gas_price: 0.105,
    gas_efficiency_pct: 88,
    currency: "EUR",
    break_even_az: 2.68,
  };
  s.mqtt = { configured: false, connected: false, broker: "" };
  s.power_meter = {
    configured: true,
    name: "Heat pump meter",
    topic: "fixture/power-meter/status",
    scope: "whole_unit",
    max_age_s: 60,
    has_value: false,
    fresh: false,
  };
  ui.S.status = s;
  const card = ui.circulationSettingsCardHtml();
  assert.match(card, /data-desc="diagnostics:gas_comparison"[\s\S]*data-act="gas-comparison"[\s\S]*2\.68 · 88% Hs/,
    "Settings card must render configured gas_comparison even when working_figure is absent");
  assert.match(card, /Electricity<\/span> 0\.3200 EUR\/kWh/);
  assert.match(card, /data-desc="diagnostics:power_meter"[\s\S]*class="settings-split-action vrow-val settings-wrap err"[^>]*data-act="power-meter" aria-label="External MQTT meter: Heat pump meter · No MQTT broker"/,
    "configured power meter with disabled MQTT must show No MQTT broker error state");
  assert.match(card, /State<\/span> No MQTT broker/);
}

// ── 6. gasComparisonModal lifecycle (#settings/gas-comparison) ──────────────────────────────────
{
  const gcHtml = html.slice(html.indexOf('id="gasComparisonModal"'), html.indexOf('id="powerMeterModal"'));
  assert.doesNotMatch(gcHtml, /<select|fluid|glycol/i,
    "gasComparisonModal must contain no fluid or glycol selector");

  const s = baseStatus();
  ui.S.status = s;
  ui.S.busy = false;
  fetchState.mode = "ok";
  fetchState.calls.length = 0;

  // Open from dashboard CTA
  loadRoute("");
  ui.S.stage = "dashboard";
  await document.getElementById("valueGroups").fire("click", {
    target: delegatedTarget("[data-act]", "act", "gas-comparison"),
  });
  assert.equal(document.getElementById("gasComparisonModal").hidden, false);
  assert.equal(location.hash, "#settings/gas-comparison");
  assert.equal(document.getElementById("gcDeleteBtn").disabled, true);
  assert.equal(document.getElementById("gcPreview").textContent, "Enter prices for break-even.");

  // Live preview update
  document.getElementById("gcElecPrice").value = "0.3200";
  document.getElementById("gcGasPrice").value = "0.1050";
  document.getElementById("gcGasEff").value = "88";
  await document.getElementById("gcElecPrice").fire("input");
  assert.equal(document.getElementById("gcPreview").textContent,
    "Break-even: 2.68 (±20% X10A / ±10% MQTT)");

  // Client-side validation: invalid elec price, gas price, efficiency, currency
  for (const [field, badVal, errId, errText] of [
    ["gcElecPrice", "0", "gcElecPrice", "0.0001–99.9999."],
    ["gcGasPrice", "100", "gcGasPrice", "0.0001–99.9999."],
    ["gcGasEff", "49", "gcGasEff", "Whole % (50–98)."],
    ["gcGasEff", "88.5", "gcGasEff", "Whole % (50–98)."],
    ["gcCurrency", "eu1", "gcCurrency", "3 uppercase letters (EUR)."],
  ]) {
    document.getElementById("gcElecPrice").value = "0.3200";
    document.getElementById("gcGasPrice").value = "0.1050";
    document.getElementById("gcGasEff").value = "88";
    document.getElementById("gcCurrency").value = "EUR";
    document.getElementById(field).value = badVal;
    fetchState.calls.length = 0;
    await document.getElementById("gasComparisonForm").fire("submit");
    await settle();
    assert.equal(fetchState.calls.length, 0, `invalid ${field}=${badVal} must not POST`);
    assert.equal(document.getElementById(errId).classList.contains("invalid"), true);
    assert.equal(document.getElementById("gcError").hidden, false);
    assert.equal(document.getElementById("gcError").textContent, errText);
    assert.equal(document.getElementById("gasComparisonModal").hidden, false);
  }

  // Valid save
  document.getElementById("gcElecPrice").value = "0.3200";
  document.getElementById("gcGasPrice").value = "0.1050";
  document.getElementById("gcGasEff").value = "88";
  document.getElementById("gcCurrency").value = " chf ";
  fetchState.calls.length = 0;
  await document.getElementById("gasComparisonForm").fire("submit");
  await settle();
  assert.deepEqual(fetchState.calls.map((c) => c.url), ["/set_gas_comparison"]);
  assert.deepEqual(fetchState.calls[0].body, {
    elec_price: 0.32, gas_price: 0.105, gas_efficiency_pct: 88, currency: "CHF",
  });
  assert.equal(document.getElementById("gasComparisonModal").hidden, true);
  assert.equal(location.hash, "#settings");

  // Clear action ({ clear: true })
  ui.S.status.gas_comparison = {
    configured: true, elec_price: 0.32, gas_price: 0.105, gas_efficiency_pct: 88, currency: "CHF", break_even_az: 2.68,
  };
  loadRoute("#settings/gas-comparison");
  assert.equal(document.getElementById("gcDeleteBtn").disabled, false);
  fetchState.calls.length = 0;
  await document.getElementById("gcDeleteBtn").fire("click");
  await settle();
  assert.deepEqual(fetchState.calls.map((c) => c.url), ["/set_gas_comparison"]);
  assert.deepEqual(fetchState.calls[0].body, { clear: true });
  assert.equal(document.getElementById("gasComparisonModal").hidden, true);
  ui.openGasComparison();
  assert.equal(document.getElementById("gcDeleteBtn").disabled, true);
  assert.equal(document.getElementById("gcElecPrice").value, "");

  // Server 400 rejection keeps dialog open and surfaces inline error
  fetchState.mode = "gc_reject";
  fetchState.error = "Gas tariff out of range";
  document.getElementById("gcElecPrice").value = "0.3200";
  document.getElementById("gcGasPrice").value = "0.1050";
  document.getElementById("gcGasEff").value = "88";
  document.getElementById("gcCurrency").value = "EUR";
  await document.getElementById("gasComparisonForm").fire("submit");
  await settle();
  assert.equal(document.getElementById("gasComparisonModal").hidden, false);
  assert.equal(document.getElementById("gcError").hidden, false);
  assert.equal(document.getElementById("gcError").textContent, "Gas tariff out of range");
  assert.equal(document.getElementById("gcGasPrice").classList.contains("invalid"), true);
  assert.equal(ui.S.busy, false);
  fetchState.mode = "ok";
  await document.getElementById("gcCancel").onclick();
}

// ── 7. powerMeterModal lifecycle (#settings/power-meter) ────────────────────────────────────────
{
  const s = baseStatus();
  ui.S.status = s;
  ui.S.busy = false;
  fetchState.mode = "ok";
  fetchState.calls.length = 0;

  // #pmBrokerHint visibility follows MQTT broker configuration
  ui.S.status.mqtt = { configured: false, connected: false, broker: "" };
  loadRoute("#settings/power-meter");
  assert.equal(document.getElementById("powerMeterModal").hidden, false);
  assert.equal(document.getElementById("pmBrokerHint").hidden, false,
    "pmBrokerHint must be visible when MQTT broker is unconfigured");
  await document.getElementById("pmCancel").onclick();

  ui.S.status.mqtt = { configured: true, connected: true, broker: "192.0.2.27:1883" };
  loadRoute("#settings/power-meter");
  assert.equal(document.getElementById("pmBrokerHint").hidden, true,
    "pmBrokerHint must stay hidden when MQTT broker is configured");

  // Client validation: wildcards, invalid power_path, timestamp_path requiring power_path, max_age 10..300
  const fillValidPm = () => {
    document.getElementById("pmName").value = "Heat pump meter";
    document.getElementById("pmTopic").value = "fixture/power-meter/status";
    document.getElementById("pmPowerPath").value = "total_act_power";
    document.getElementById("pmTimePath").value = "ts";
    document.getElementById("pmUnit").value = "W";
    document.getElementById("pmScope").value = "whole_unit";
    document.getElementById("pmMaxAge").value = "60";
  };
  for (const [setupBad, badField] of [
    [() => { document.getElementById("pmTopic").value = "fixture/+/status"; }, "pmTopic"],
    [() => { document.getElementById("pmTopic").value = "fixture/#"; }, "pmTopic"],
    [() => { document.getElementById("pmPowerPath").value = "a..b"; }, "pmPowerPath"],
    [() => { document.getElementById("pmPowerPath").value = ""; document.getElementById("pmTimePath").value = "ts"; }, "pmTimePath"],
    [() => { document.getElementById("pmMaxAge").value = "9"; }, "pmMaxAge"],
    [() => { document.getElementById("pmMaxAge").value = "301"; }, "pmMaxAge"],
    [() => { document.getElementById("pmMaxAge").value = "60.5"; }, "pmMaxAge"],
  ]) {
    fillValidPm();
    setupBad();
    fetchState.calls.length = 0;
    await document.getElementById("powerMeterForm").fire("submit");
    await settle();
    assert.equal(fetchState.calls.length, 0, `invalid ${badField} must block POST`);
    assert.equal(document.getElementById(badField).classList.contains("invalid"), true);
    assert.equal(document.getElementById("pmError").hidden, false);
    assert.equal(document.getElementById("powerMeterModal").hidden, false);
  }

  // POST /test_power_meter: live, retained, failure, and clear on edit
  fillValidPm();
  fetchState.mode = "pm_test_live";
  fetchState.calls.length = 0;
  await document.getElementById("pmTestBtn").fire("click");
  await settle();
  assert.deepEqual(fetchState.calls.map((c) => c.url), ["/test_power_meter"]);
  assert.equal(document.getElementById("pmTestResult").hidden, false);
  assert.equal(document.getElementById("pmTestResult").classList.contains("ok"), true);
  assert.equal(document.getElementById("pmTestResult").textContent, "1,420.5 W (live)");

  fetchState.mode = "pm_test_retained";
  await document.getElementById("pmTestBtn").fire("click");
  await settle();
  assert.equal(document.getElementById("pmTestResult").hidden, false);
  assert.equal(document.getElementById("pmTestResult").classList.contains("warn"), true);
  assert.equal(document.getElementById("pmTestResult").textContent, "850 W (retained; needs timestamp)");

  await document.getElementById("pmPowerPath").fire("input");
  assert.equal(document.getElementById("pmTestResult").hidden, true,
    "editing a field must clear stale power-meter test result");

  fetchState.mode = "pm_test_fail";
  await document.getElementById("pmTestBtn").fire("click");
  await settle();
  assert.equal(document.getElementById("pmTestResult").hidden, true);
  assert.equal(document.getElementById("pmError").hidden, false);
  assert.equal(document.getElementById("pmError").textContent, "No fresh power-meter value received before timeout");

  // Direct POST /set_power_meter save WITHOUT calling /test_power_meter
  fetchState.mode = "ok";
  fetchState.calls.length = 0;
  fillValidPm();
  document.getElementById("pmUnit").value = "kW";
  document.getElementById("pmScope").value = "compressor_only";
  await document.getElementById("powerMeterForm").fire("submit");
  await settle();
  assert.deepEqual(fetchState.calls.map((c) => c.url), ["/set_power_meter"],
    "Save must persist directly without requiring /test_power_meter");
  assert.deepEqual(fetchState.calls[0].body, {
    name: "Heat pump meter",
    topic: "fixture/power-meter/status",
    power_path: "total_act_power",
    timestamp_path: "ts",
    unit: "kW",
    scope: "compressor_only",
    max_age_s: 60,
  });
  assert.equal(document.getElementById("powerMeterModal").hidden, true);

  // Server 400 rejection on /set_power_meter
  ui.S.status.power_meter = {
    configured: true, name: "Heat pump meter", topic: "fixture/power-meter/status",
    power_path: "total_act_power", timestamp_path: "ts", unit: "kW", scope: "compressor_only", max_age_s: 60,
  };
  loadRoute("#settings/power-meter");
  fetchState.mode = "pm_reject";
  fetchState.error = "Invalid timestamp JSON path";
  fetchState.calls.length = 0;
  await document.getElementById("powerMeterForm").fire("submit");
  await settle();
  assert.equal(document.getElementById("powerMeterModal").hidden, false);
  assert.equal(document.getElementById("pmError").hidden, false);
  assert.equal(document.getElementById("pmError").textContent, "Invalid timestamp JSON path");
  assert.equal(document.getElementById("pmTimePath").classList.contains("invalid"), true);
  assert.equal(ui.S.busy, false);

  // Delete submits topic: "" even if draft inputs are invalid, without calling /test_power_meter
  fetchState.mode = "ok";
  fetchState.calls.length = 0;
  document.getElementById("pmTopic").value = "bad/#";
  await document.getElementById("pmDeleteBtn").fire("click");
  await settle();
  assert.deepEqual(fetchState.calls.map((c) => c.url), ["/set_power_meter"]);
  assert.deepEqual(fetchState.calls[0].body, {
    name: "", topic: "", power_path: "", timestamp_path: "", unit: "W", scope: "whole_unit", max_age_s: 60,
  });
  assert.equal(document.getElementById("powerMeterModal").hidden, true);
  ui.openPowerMeter();
  assert.equal(document.getElementById("pmDeleteBtn").disabled, true);
  assert.equal(document.getElementById("pmTopic").value, "");
  await document.getElementById("pmCancel").onclick();
}

console.log("UI working figure: 9 states, badge invariance, banners, Settings rows, and gas-comparison + power-meter modals passed");
