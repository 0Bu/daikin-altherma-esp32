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
  if (fetchState.mode === "gc_reject" && url === "/set_gas_comparison")
    return response(false, { error: fetchState.error || "Invalid gas tariff" }, 400);
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

const navigatorState = { language: "en-US" };
let storedLangMode = null;
const context = vm.createContext({
  document,
  fetch,
  navigator: navigatorState,
  localStorage: {
    getItem(key) { return key === "uiLangMode" ? storedLangMode : null; },
    setItem() {},
  },
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
    openGasComparison, closeGasComparison,
    WF_CURRENCIES, WF_CURRENCY_SYM, wfMoney, defaultTariffCurrency,
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
      is_estimate: true,
      is_compressor_only: false,
      pel_source: "x10a_ct",
      span_s: 86400,
      observed_s: 86400,
      unpairable_s: 0,
      defrost_s: 0,
      buh_s: 0,
      bsh_excluded_s: 0,
      cooling_excluded_s: 0,
      coverage_pct: 100,
      neutral_band_pct: 20,
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

// ── 1. Absence on older firmware / diagnostics disabled & HomeHub Modbus rendering ────────────────
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
    working_figure: { ...s.working_figure, pel_source: "modbus", is_estimate: true, neutral_band_pct: 20 },
  };
  const modbusCard = ui.checkupCardHtml(true);
  assert.match(modbusCard, /observation:working_figure/,
    "working_figure must render on HomeHub Modbus when /status.working_figure is present");
  assert.doesNotMatch(modbusCard, /observation:refrigerant_service/,
    "refrigerant_service must stay hidden when health.source is modbus");
  assert.doesNotMatch(modbusCard, />Power<\/span>/,
    "Modbus card header already identifies Modbus so Power fact row must be omitted");
  assert.match(modbusCard, /24 h heating &amp; hot water · pure water · gas 88% condensing boiler, no fixed fees · estimate\./);

  ui.S.status = {
    ...s,
    diagnostics: { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["modbus"] },
    health: { status: "collecting", checks: [] },
    working_figure: undefined,
  };
  assert.doesNotMatch(ui.checkupCardHtml(true), /observation:working_figure/,
    "working_figure row must stay hidden when /status.working_figure is absent on modbus");
}

// ── 2. No header summary badge across working_figure or fault states ────────────────────────────
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
    assert.doesNotMatch(card, /section-badge/,
      `diagnosis card must render no header badge regardless of working_figure state (${wfState})`);
  }

  ui.S.status = {
    ...s,
    health: {
      ...s.health,
      checks: [{ id: "fault", verdict: "warn", evidence: "manufacturer", active: 1 }],
    },
    working_figure: { ...s.working_figure, state: "more_expensive", limited_buh: true },
  };
  const warnCard = ui.checkupCardHtml(true);
  assert.doesNotMatch(warnCard, /section-badge/,
    "diagnosis card must render no header badge even when fault verdict is warn");
  assert.match(warnCard, /class="vrow-val checkup-val err"/,
    "fault row must retain its err tone while working_figure renders independently");
  assert.match(warnCard, /observation:working_figure/,
    "working_figure row must render independently beside fault warn state");
}

// ── 3. All 9 working_figure states: text, ~ estimate prefix, tone, suffix, words-only ariaValue ─
{
  const stateExpectations = [
    { state: "collecting", supported: true, est: true, az: 0, text: "", tone: "", aria: "Collecting", observed_s: 3600 },
    { state: "standby", supported: true, est: true, az: 0, text: "Standby", tone: "dim", aria: "Standby", observed_s: 10800 },
    { state: "unsupported", supported: false, est: false, az: 0, text: "Not supported", tone: "dim", aria: "Not supported" },
    { state: "measured", supported: true, est: false, az: 3.45, tariffs: false, text: "3.45", tone: "", aria: "3.45 · measured" },
    { state: "measured", supported: true, est: true, az: 3.45, tariffs: false, text: "~3.45", tone: "", aria: "estimated 3.45 · measured" },
    { state: "cheaper", supported: true, est: false, az: 4.10, text: "4.10", tone: "ok", aria: "4.10 · cheaper than gas" },
    { state: "cheaper", supported: true, est: true, az: 4.10, text: "~4.10", tone: "ok", aria: "estimated 4.10 · cheaper than gas" },
    { state: "similar", supported: true, est: false, az: 3.05, text: "3.05", tone: "", aria: "3.05 · like gas" },
    { state: "more_expensive", supported: true, est: false, az: 2.15, text: "2.15", tone: "warn", aria: "2.15 · costlier than gas" },
    { state: "more_expensive", supported: true, est: true, az: 2.15, text: "~2.15", tone: "warn", aria: "estimated 2.15 · costlier than gas" },
    { state: "partial", supported: true, est: false, az: 3.60, fullWindow: false, text: "3.60", tone: "", aria: "3.60 · provisional" },
    { state: "partial", supported: true, est: true, az: 3.60, fullWindow: false, text: "~3.60", tone: "", aria: "estimated 3.60 · provisional" },
    { state: "limited", supported: true, est: false, az: 3.25, limitedBuh: true, text: "3.25", tone: "warn", aria: "3.25 · limited" },
    { state: "limited", supported: true, est: true, az: 3.25, limitedBuh: true, text: "~3.25", tone: "warn", aria: "estimated 3.25 · limited" },
  ];

  const baseFoot = "24 h heating &amp; hot water · pure water · estimate.";
  const gasFoot = "24 h heating &amp; hot water · pure water · gas 88% condensing boiler, no fixed fees · estimate.";
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
      observed_s: spec.observed_s ?? s.working_figure.observed_s,
    };
    ui.S.status = s;
    const row = ui.workingFigureRowHtml();
    const expectedCls = `checkup-val${spec.tone ? ` ${spec.tone}` : ""}`;
    assert.match(row, new RegExp(`<span class="vrow-val ${expectedCls}">${spec.text.replace(".", "\\.")}</span>`),
      `${spec.state} (est=${spec.est}): collapsed value/tone mismatch`);
    assert.ok(row.includes(`aria-label="Performance factor: ${spec.aria}"`),
      `${spec.state} (est=${spec.est}): expected aria-label "Performance factor: ${spec.aria}"`);
    const haveMetrics = spec.supported && !["collecting", "standby", "unsupported"].includes(spec.state) && spec.az > 0;
    const expectedFoot = (haveMetrics && (spec.tariffs ?? true)) ? gasFoot : baseFoot;
    assert.ok(row.includes(expectedFoot),
      `${spec.state}: concise pure-water / Heating+DHW footer must be present`);
    if (spec.state === "collecting") {
      assert.match(row, /First value after 2 h · 1 h so far/);
      assert.match(row, /class="wf-prog-fill" style="width:50%"/);
      assert.doesNotMatch(row, />Period<\/span>/, "collecting card must not repeat duration in a Period fact row");
    } else if (spec.state === "standby") {
      assert.match(row, /Too little runtime for a value · 3 h observed/);
      assert.doesNotMatch(row, />Period<\/span>/, "standby card must not emit a redundant Period fact row");
    } else if (spec.state === "unsupported") {
      assert.match(row, /Required flow, temperature, or electrical inputs unavailable\./);
      assert.doesNotMatch(row, /data-act="gas-comparison"/,
        "unsupported working_figure must not emit a tariff CTA inside the row body");
    }
  }
}

// ── 4. Expanded body: KPIs, scale bar, BUH/BSH/CT banners & structured facts ───────────────────
{
  // (a) Tariffs configured -> 4 KPI tiles + Break-Even scale bar + ~ prefix on estimates + structured facts
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
  assert.match(body, /Gas · 88%/);
  assert.match(body, />46\.6 kWh</);
  assert.match(body, /class="wf-scale"/, "configured tariffs must render Break-Even scale bar");
  assert.match(body, /±20%/, "X10A estimate scale bar must render ±20% neutral band");
  assert.match(body, /~10\.0 kWh/, "estimate flag must prefix electricity kWh with ~");
  assert.match(body, /~3\.20 €/, "estimate flag must prefix heat-pump cost with ~");
  assert.match(body, /<span class="wf-fact-k">Period<\/span><span class="wf-fact-v num">24 h<\/span>/);
  assert.match(body, /<span class="wf-fact-k">Power<\/span><span class="wf-fact-v">Clamp · whole unit<\/span>/);
  assert.match(body, /<span class="wf-fact-k">Outdoor<\/span><span class="wf-fact-v num">avg 4\.2 °C · min 1\.1 °C<\/span>/);
  assert.match(body, /<span class="wf-fact-k">Defrost<\/span><span class="wf-fact-v num">5 min<\/span>/);
  assert.match(body, /<span class="wf-fact-k">Backup heater<\/span><span class="wf-fact-v num">30 min · included<\/span>/);
  assert.match(body, /<span class="wf-fact-k">Cooling<\/span><span class="wf-fact-v num">10 min excluded<\/span>/);
  assert.doesNotMatch(body, /data-act="gas-comparison"|wf-actions|wf-btn/,
    "configured working figure panel must not render inline tariff CTA");

  // (b) Tariffs unconfigured on HomeHub Modbus -> 2 KPI tiles (no duplicate heat kWh) + est., NO scale/Power fact
  s.working_figure = {
    ...s.working_figure,
    state: "partial",
    full_window: false,
    observed_s: 21600,
    coverage_pct: 25,
    tariffs_configured: false,
    is_estimate: true,
    is_compressor_only: false,
    pel_source: "modbus",
    buh_s: 0,
    defrost_s: 0,
    cooling_excluded_s: 0,
    outdoor_mean_c: 2.0,
    outdoor_min_c: 2.0,
  };
  ui.S.status = s;
  body = ui.workingFigureRowHtml();
  assert.doesNotMatch(body, /wf-kpis-4/, "unconfigured tariffs must not render 4 KPI tiles");
  assert.equal((body.match(/class="wf-kpi"/g) || []).length, 2, "unconfigured tariffs must render 2 KPI tiles");
  assert.doesNotMatch(body, /class="wf-scale"/, "unconfigured tariffs must omit Break-Even scale bar");
  assert.match(body, />24 h heat</);
  assert.match(body, />el\. ~10\.0 kWh</);
  assert.match(body, />est\.</);
  assert.match(body, /<span class="wf-fact-k">Period<\/span><span class="wf-fact-v num">6 h \/ 24 h · 25%<\/span>/);
  assert.match(body, /<span class="wf-fact-k">Outdoor<\/span><span class="wf-fact-v num">2\.0 °C<\/span>/);
  assert.doesNotMatch(body, />Power<\/span>|Defrost|Backup heater|Cooling/);
  assert.doesNotMatch(body, /data-act="gas-comparison"|wf-actions|wf-btn/,
    "unconfigured working figure panel must not render inline tariff CTA");

  // (c) limited_buh: true -> renders wf.banner.buh_limited & suppresses Backup heater included fact; stale banner shown
  s.working_figure = {
    ...s.working_figure,
    state: "limited",
    full_window: true,
    observed_s: 86400,
    coverage_pct: 100,
    tariffs_configured: true,
    limited_buh: true,
    buh_s: 1200,
    bsh_excluded_s: 900,
    ct_unwired: true,
    is_compressor_only: true,
    source_fresh: false,
    pel_source: "x10a_inv",
  };
  ui.S.status = s;
  body = ui.workingFigureRowHtml();
  assert.match(body, /<div class="wf-banner warn">Source signal stale — figure paused\.<\/div>/);
  assert.match(body, /<div class="wf-banner warn">Backup heater active outside electrical scope — figure limited\.<\/div>/,
    "limited_buh must render buh_limited warning");
  assert.match(body, /Inverter · comp\. only/);
  assert.doesNotMatch(body, /<span class="wf-fact-k">Backup heater<\/span>/,
    "limited_buh must suppress Backup heater included fact row");
  assert.match(body, /<div class="wf-banner warn">Tank booster 15 min excluded\.<\/div>/);
  assert.match(body, /<div class="wf-banner warn">Mains clamp at 0 A — using compressor only\.<\/div>/);

  // (d) unpaired_buh: true -> renders buh_unpaired warning
  s.working_figure = {
    ...s.working_figure,
    limited_buh: false,
    unpaired_buh: true,
    buh_s: 600,
    bsh_excluded_s: 0,
    ct_unwired: false,
    source_fresh: true,
  };
  ui.S.status = s;
  body = ui.workingFigureRowHtml();
  assert.match(body, /<div class="wf-banner warn">Backup heater active without outlet sensor — excluded\.<\/div>/);
  assert.doesNotMatch(body, /<span class="wf-fact-k">Backup heater<\/span>/);
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
  ui.S.status = s;
  const card = ui.circulationSettingsCardHtml();
  assert.match(card, /data-desc="diagnostics:gas_comparison"[\s\S]*data-act="gas-comparison"[\s\S]*>2\.68<\/span>/,
    "Settings card must render configured gas_comparison even when working_figure is absent");
  assert.doesNotMatch(card, /2\.68 · 88% Hs|Efficiency \(Hs\)/,
    "Settings gas-comparison row and tongue must omit redundant efficiency setting text");
  assert.match(card, /Electricity<\/span> 0\.3200 EUR\/kWh/);
  assert.doesNotMatch(card, /data-act="power-meter"|diagnostics:power_meter/,
    "Settings card must not expose removed external power-meter row");
}

// ── 6. gasComparisonModal lifecycle (#settings/gas-comparison) ──────────────────────────────────
{
  const gcHtml = html.slice(html.indexOf('id="gasComparisonModal"'), html.indexOf('id="weatherModal"'));
  assert.doesNotMatch(gcHtml, /gcGasEff|fluid|glycol/i,
    "gasComparisonModal must contain no efficiency input or fluid/glycol selector");
  const gcCurrencySelect = gcHtml.match(/<select[^>]*id="gcCurrency"[\s\S]*?<\/select>/)?.[0] || "";
  assert.deepEqual(
    [...gcCurrencySelect.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]),
    ["EUR", "CHF", "GBP", "USD", "PLN", "CZK", "SEK", "NOK", "DKK", "UAH", "JPY", "CNY"],
    "gasComparisonModal #gcCurrency must expose the exact 12 curated currency options",
  );

  const s = baseStatus();
  s.ui = { lang: "auto" };
  navigatorState.language = "en-US";
  ui.S.status = s;
  ui.S.busy = false;
  fetchState.mode = "ok";
  fetchState.calls.length = 0;

  // Dashboard does not open gas-comparison; open from the single Settings entry (defaults currency from browser locale when unconfigured)
  loadRoute("");
  ui.S.stage = "dashboard";
  await document.getElementById("valueGroups").fire("click", {
    target: delegatedTarget("[data-act]", "act", "gas-comparison"),
  });
  assert.equal(document.getElementById("gasComparisonModal").hidden, true);

  loadRoute("#settings");
  ui.S.stage = "settings";
  await document.getElementById("settingsCards").fire("click", {
    target: delegatedTarget("[data-act]", "act", "gas-comparison"),
  });
  assert.equal(document.getElementById("gasComparisonModal").hidden, false);
  assert.equal(location.hash, "#settings/gas-comparison");
  assert.equal(document.getElementById("gcCurrency").value, "USD");
  assert.equal(document.getElementById("gcDeleteBtn").disabled, true);
  assert.equal(document.getElementById("gcPreview").textContent, "Enter prices for break-even.");

  // Live preview update
  document.getElementById("gcElecPrice").value = "0.3200";
  document.getElementById("gcGasPrice").value = "0.1050";
  await document.getElementById("gcElecPrice").fire("input");
  assert.equal(document.getElementById("gcPreview").textContent,
    "Break-even: 2.68 (±20%)");

  // Client-side validation: invalid elec price, gas price, non-curated currency
  for (const [field, badVal, errId, errText] of [
    ["gcElecPrice", "0", "gcElecPrice", "0.0001–99.9999."],
    ["gcGasPrice", "100", "gcGasPrice", "0.0001–99.9999."],
    ["gcCurrency", "CAD", "gcCurrency", "Select a supported currency."],
    ["gcCurrency", "eu1", "gcCurrency", "Select a supported currency."],
  ]) {
    document.getElementById("gcElecPrice").value = "0.3200";
    document.getElementById("gcGasPrice").value = "0.1050";
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

  // Valid save omits gas_efficiency_pct
  document.getElementById("gcElecPrice").value = "0.3200";
  document.getElementById("gcGasPrice").value = "0.1050";
  document.getElementById("gcCurrency").value = "CHF";
  fetchState.calls.length = 0;
  await document.getElementById("gasComparisonForm").fire("submit");
  await settle();
  assert.deepEqual(fetchState.calls.map((c) => c.url), ["/set_gas_comparison"]);
  assert.deepEqual(fetchState.calls[0].body, {
    elec_price: 0.32, gas_price: 0.105, currency: "CHF",
  });
  assert.equal("gas_efficiency_pct" in fetchState.calls[0].body, false);
  assert.equal(document.getElementById("gasComparisonModal").hidden, true);
  assert.equal(location.hash, "#settings");

  // Clear action ({ clear: true })
  ui.S.status.gas_comparison = {
    configured: true, elec_price: 0.32, gas_price: 0.105, gas_efficiency_pct: 88, currency: "CHF", break_even_az: 2.68,
  };
  loadRoute("#settings/gas-comparison");
  assert.equal(document.getElementById("gcCurrency").value, "CHF");
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

// ── 7. WF_CURRENCY_SYM, wfMoney formatting (JPY 0-dec / deadband), and defaultTariffCurrency ─────
{
  assert.deepEqual(
    [...ui.WF_CURRENCIES],
    ["EUR", "CHF", "GBP", "USD", "PLN", "CZK", "SEK", "NOK", "DKK", "UAH", "JPY", "CNY"],
  );
  assert.deepEqual({ ...ui.WF_CURRENCY_SYM }, {
    EUR: "€", CHF: "CHF", GBP: "£", USD: "$", PLN: "zł", CZK: "Kč",
    SEK: "kr", NOK: "kr", DKK: "kr", UAH: "₴", JPY: "¥", CNY: "CN¥",
  });

  // JPY: 0 decimal digits & 0.5 deadband
  assert.equal(ui.wfMoney(1234.4, "JPY"), "1,234 ¥");
  assert.equal(ui.wfMoney(-0.49, "JPY"), "0 ¥");
  assert.equal(ui.wfMoney(-0.51, "JPY"), "−1 ¥");
  assert.equal(ui.wfMoney(0.49, "JPY", true), "0 ¥");
  assert.equal(ui.wfMoney(-0.49, "JPY", true), "0 ¥");
  assert.equal(ui.wfMoney(0.51, "JPY", true), "+1 ¥");
  assert.equal(ui.wfMoney(-0.51, "JPY", true), "−1 ¥");

  // 2-decimal currencies & 0.005 deadband
  assert.equal(ui.wfMoney(3.2, "EUR"), "3.20 €");
  assert.equal(ui.wfMoney(12.345, "UAH"), "12.35 ₴");
  assert.equal(ui.wfMoney(0.004, "CNY", true), "0.00 CN¥");
  assert.equal(ui.wfMoney(0.01, "CNY", true), "+0.01 CN¥");
  assert.equal(ui.wfMoney(-0.01, "DKK", true), "−0.01 kr");

  // defaultTariffCurrency(): auto browser locale vs manual UI lang + regional Swiss/UK/US overrides
  const origStatus = ui.S.status;
  const origNavLang = navigatorState.language;
  const origStored = storedLangMode;
  try {
    storedLangMode = null;
    for (const [navLang, expectedCur] of [
      ["de-CH", "CHF"], ["fr-CH", "CHF"], ["it-LI", "CHF"],
      ["en-GB", "GBP"], ["en_UK", "GBP"], ["en-US", "USD"],
      ["de-DE", "EUR"], ["da-DK", "DKK"], ["nb-NO", "NOK"],
      ["sv-SE", "SEK"], ["pl-PL", "PLN"], ["cs-CZ", "CZK"],
      ["uk-UA", "UAH"], ["ja-JP", "JPY"], ["zh-CN", "CNY"],
      ["ja-DE", "EUR"], ["pt-BR", "EUR"],
    ]) {
      ui.S.status = { ui: { lang: "auto" } };
      navigatorState.language = navLang;
      assert.equal(ui.defaultTariffCurrency(), expectedCur,
        `auto navigator.language=${navLang} should default to ${expectedCur}`);
    }

    for (const [uiLang, navLang, expectedCur] of [
      ["pl", "en-US", "PLN"],
      ["uk", "de-DE", "UAH"],
      ["ja", "en-GB", "JPY"],
      ["de", "de-CH", "CHF"],
      ["fr", "fr-CH", "CHF"],
      ["it", "it-LI", "CHF"],
      ["en", "en-GB", "GBP"],
      ["en", "en-US", "USD"],
      ["de", "en-CH", "EUR"],
    ]) {
      ui.S.status = { ui: { lang: uiLang } };
      navigatorState.language = navLang;
      assert.equal(ui.defaultTariffCurrency(), expectedCur,
        `manual ui.lang=${uiLang} with navigator.language=${navLang} should resolve to ${expectedCur}`);
    }

    // Invalid persisted currency in status falls back to defaultTariffCurrency() when filling modal
    ui.S.status = { ui: { lang: "auto" }, gas_comparison: { configured: true, elec_price: 0.3, gas_price: 0.1, currency: "CAD" } };
    navigatorState.language = "en-GB";
    ui.openGasComparison();
    assert.equal(document.getElementById("gcCurrency").value, "GBP");
    await document.getElementById("gcCancel").onclick();
  } finally {
    ui.S.status = origStatus;
    navigatorState.language = origNavLang;
    storedLangMode = origStored;
  }
}

console.log("UI working figure: 9 states, Modbus support, badge invariance, banners, Settings rows, currency/locale defaults, and gas-comparison modal passed");
