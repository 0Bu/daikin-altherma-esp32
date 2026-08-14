// THE ABSENCE MATRIX — what the UI says when a third-party system is unconfigured, deleted, or
// simply not answering. Every optional source this firmware reads (the MQTT broker, the HomeHub, the
// ENV III accessory, the MQTT room source, the MQTT circulation witness, Open-Meteo, the X10A bus
// itself) can be absent independently of the others, and safe mode removes all of them at once. That
// is a state space no single-feature test walks, and it is the one where this UI has been wrong.
//
// It exists because every other gate was green while the copy lied. The firmware built, the values
// were physically true, the drawing was right, the schematic audit passed, and:
//
//   • the heating-curve card told a reader to "set up a room source" while their configured room
//     source sat one row below it — because the card keyed on the sampler's state, and "off" is the
//     evaluator's word for BOTH "nothing is mapped" and "the sampler never ran" (safe mode, or a
//     broker cleared after the mapping was saved);
//   • the circulation row answered a cleared broker with "waiting for a message", forever, with no
//     colour and no hint, while the room source one row up named the same cause outright;
//   • an unconfigured circulation witness was still offered a 24-hour chart, so its tongue said "no
//     readings yet" under a row that said "not configured" — an absent feature reported as an empty
//     buffer, which is exactly what logic/history.hpp's rule refuses.
//
// None of those is visible in a value, a converter, a payload schema or a pixel. They are visible in
// one place only: the CROSS PRODUCT of which sources exist. So that product is what this file walks.
//
// The rules below are derived from each scenario's declared `absent`/`present` sets rather than
// written out per scenario, so adding a scenario adds its assertions with it.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppSource } from "../tools/ui/read_app_source.mjs";

// ── A DOM shim wide enough to load the production bundle ───────────────────────────────────────
class ClassList {
  constructor() { this.names = new Set(); }
  add(...n) { n.forEach((x) => this.names.add(x)); }
  remove(...n) { n.forEach((x) => this.names.delete(x)); }
  contains(n) { return this.names.has(n); }
  toggle(n, f) {
    const on = f === undefined ? !this.names.has(n) : !!f;
    if (on) this.names.add(n); else this.names.delete(n);
    return on;
  }
}
class Element {
  constructor(id, doc) {
    this.id = id; this.doc = doc; this._value = ""; this.checked = false; this.disabled = false;
    this.hidden = String(id).endsWith("Modal"); this.innerHTML = ""; this.textContent = "";
    this.dataset = {}; this.classList = new ClassList(); this.listeners = new Map();
    this.onclick = null; this.style = {}; this.children = []; this.attributes = {};
  }
  set value(v) { this._value = String(v ?? ""); }
  get value() { return this._value; }
  addEventListener(t, l) { const a = this.listeners.get(t) || []; a.push(l); this.listeners.set(t, a); }
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {} blur() {}
  setAttribute(n, v) { this.attributes[n] = String(v); this[n] = String(v); }
  getAttribute(n) { return this.attributes[n] ?? null; }
  removeAttribute(n) { delete this.attributes[n]; }
  appendChild(c) { this.children.push(c); return c; }
  remove() {} matches() { return false; } closest() { return null; } contains() { return false; }
  setPointerCapture() {} releasePointerCapture() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; }
}
class Document {
  constructor() {
    this.elements = new Map(); this.listeners = new Map(); this.activeElement = null;
    this.documentElement = new Element("html", this); this.body = new Element("body", this);
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new Element(id, this));
    return this.elements.get(id);
  }
  createElement(tag) { return new Element(`tag:${tag}`, this); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {} removeEventListener() {}
}

const context = vm.createContext({
  document: new Document(),
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
  navigator: { language: "de-DE" },
  localStorage: { getItem: () => null, setItem() {} },
  window: {
    scrollTo() {}, open() {}, addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerWidth: 900, innerHeight: 800,
  },
  history: { state: null, pushState() {}, replaceState() {}, back() {}, forward() {} },
  location: { pathname: "/", search: "", hash: "", reload() {} },
  URL, URLSearchParams, Blob, AbortController, console,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
});

vm.runInContext(`${readAppSource().replace(/\nboot\(\);\s*$/, "\n")}
  this.__ui = { S, t, esp32CardHtml, dynamicControlCardHtml, circulationSettingsCardHtml,
                connLinks, liveData, histHtml, INSPECT };`, context, { filename: "main/www/app.sources" });
const ui = context.__ui;

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────
// A device with EVERYTHING configured and healthy. Each scenario removes one or more sources from
// it, in the exact shape http_status.cpp emits for that removal.
const HEALTHY = () => ({
  version: "1.0.0-dev.400", uptime_s: 90000, app_elf_sha256: "abc",
  pins_avail: [1, 2, 5, 6, 7, 8],
  board: { led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true,
    user_set: true, preset_id: "m5stack_atoms3_lite", preset_name: "M5Stack AtomS3 Lite",
    vendor: "M5Stack", pins_local: [1, 2, 5, 6], presets: [] },
  env3: { type: "env_iii", supported: true, enabled: true, sda: 2, scl: 1, connected: true,
    fresh: true, age_s: 3, temperature_c: 21.4, humidity_pct: 48.2, pressure_hpa: 1004.1,
    error: "", samples: 120, errors: 0, pins_avail: [1, 2], presets: [] },
  wifi: { ssid: "ExampleNet", ip: "192.0.2.170", rssi: -55, connected: true, bssid: "02:00:00:00:00:01",
    mac: "02:00:00:00:01:70", std: "Wi-Fi 4", rolled_back: false },
  mqtt: { configured: true, connected: true, tls: false, has_creds: false, broker: "192.0.2.27:1883",
          base: "daikin-altherma-esp32", base_custom: false },
  reference_temperature: { configured: true, name: "Example room", topic: "fixture/room/status",
    temperature_path: "temperature", setpoint_path: "setpoint", timestamp_path: "ts",
    enabled_path: "on", hvac_mode_path: "mode", max_age_s: 300, subscribed: true, has_value: true,
    temperature_c: 21.5, has_setpoint: true, setpoint_c: 22, enabled: true, hvac_mode: "heat",
    age_s: 10, received_ago_s: 10, fresh: true, freshness_reason: "fresh", temperature_valid: true,
    setpoint_valid: true, control_eligible: true, room_error_k: -0.5, reason: "eligible",
    reason_code: 0, retained: false, messages: 10, errors: 0, rejections: 0 },
  heating_curve: { method_version: 2, armed: true, state: "recording", state_code: 1,
    reason: "sample_recorded", reason_code: 1, sample_eligible: true, current_room_error_k: -0.5,
    last_sample_room_error_k: -0.4, last_sample_unix_s: 1780000000, forecast_available: true,
    outdoor_temperature_c: 21.4, outdoor_source: "env3",
    last_sample_outdoor_temperature_c: 21.2, last_sample_outdoor_source: "env3",
    plant_outdoor_temperature_c: 9.1, plant_outdoor_source: "homehub",
    last_sample_plant_outdoor_temperature_c: 8.9,
    last_sample_plant_outdoor_source: "homehub",
    plant_gate_known: true, plant_gate_active: true, heating_mode_known: true,
    heating_mode_active: true, room_source_unix_s: 1780000000, room_age_s: 10, sequence: 3,
    evaluations: 900, samples: 3, holds: 1, blocks: 0 },
  circulation_source: { configured: true, name: "Example circulation pump", topic: "fixture/circulation/status",
    power_path: "apower", timestamp_path: "", max_age_s: 120, on_threshold_w: "3.0",
    off_threshold_w: "1.0", confirm_s: 60, subscribed: true, has_value: true, power_w: 5.4,
    state: "on", age_s: 5, fresh: true, freshness_reason: "fresh", retained: false, messages: 5,
    errors: 0, rejections: 0 },
  weather_forecast: { configured: true, provider: "open-meteo", model: "icon_seamless",
    fetch_interval_s: 2700, max_age_s: 5400, fetching: false, available: true, has_value: true,
    latitude: "12.345678", longitude: "23.456789", state: "ok", outdoor_mean_2h_c: 9.2,
    solar_energy_2h_wh_m2: 120, issued_at: null, fetched_at: "2026-08-07T10:00:00Z",
    valid_for_decision_at: "2026-08-07T10:00:00Z", last_attempt_at: "2026-08-07T10:00:00Z",
    age_s: 300, fresh: true, freshness_reason: "fresh", successes: 5, errors: 0 },
  syslog: { configured: true, resolved: true, reachable: true, host: "192.0.2.5", port: 514 },
  hp: { proto: "I", rx: 1, tx: 2, connected: true, last_ok_s: 0, registers: 12, values: 99,
    crc_err: 0, timeout_err: 0 },
  profile: { id: "altherma3_r_erga" },
  modbus: { enabled: true, connected: true, discovering: false, host: "192.0.2.30", port: 502,
    unit_id: 1, rx: 100, fails: 0, values: 20, task_stack_min_free_bytes: 900,
    plant_gate_known: true, plant_gate_active: true, heating_mode_known: true,
    heating_mode_active: true },
  history: { dt: 300,
    rows: [{ id: "dhw_tank", label: "DHW tank temp. (R5T)" },
           { id: "free_heap", label: "Free heap" },
           { id: "max_alloc", label: "Largest free block" },
           { id: "circulation_state", label: "DHW circulation pump" }],
    modbus_rows: [{ id: "dhw_tank", label: "Domestic Hot Water temperature" }],
    env3_rows: [{ id: "env3_temperature", label: "Outdoor temperature" }] },
  health: { covered_s: 86400, full_span: true, available: 7, assessable: 7, evaluated: 7,
    status: "ok", checks: [] },
  sys: { free_heap: 120000, min_free_heap: 90000, max_alloc: 60000, reset_reason: "power_on",
    safe_mode: false },
  ntp: { server: "pool.ntp.org", synced: true, time: "2026-08-07T10:00:00Z" },
  ota: { channel: "dev" }, ui: { lang: "auto" }, last_crash: null,
  detect: { proto: "I", rx: 1, tx: 2, valid: true, capacity_kw: 6.0, capacity_kw_iu: 8.0,
    ou_eeprom: "x", candidates: ["altherma3_r_erga"], families: ["Altherma 3"], ambiguous: false,
    model: { name: "n", family: "f", marketing: "m" } },
});

// Each removal, written ONCE, in the shape the firmware actually emits. Scenarios compose them, so a
// change to how a source reports its absence is made in one place and reaches every combination.
const REMOVE = {
  // The broker is cleared. Both MQTT-backed sources stay SAVED — that is the state that produced two
  // of the three defects above, and it is reachable in one tap (edit the broker, save an empty one).
  mqtt(s) {
    // base/base_custom come from the CONFIG, not from the broker link, so http_status.cpp still
    // emits them with no broker — an installation keeps its identity while MQTT is switched off.
    s.mqtt = { configured: false, connected: false, tls: false, has_creds: false, broker: "",
               base: "daikin-altherma-esp32", base_custom: false };
    s.reference_temperature = { ...s.reference_temperature, subscribed: false, has_value: false,
      temperature_c: null, has_setpoint: false, setpoint_c: null, fresh: false,
      freshness_reason: "no_value", control_eligible: false, room_error_k: null, reason: "no_value",
      age_s: null, received_ago_s: null };
    s.circulation_source = { ...s.circulation_source, subscribed: false, has_value: false,
      power_w: null, state: "unknown", fresh: false, freshness_reason: "no_value", age_s: null };
    // heating_curve_diagnosis_armed() requires a broker, so clearing it DISARMS a fully mapped room
    // source: armed goes false and the evaluator reports its ordinary Off/Disabled.
    s.heating_curve = { ...s.heating_curve, armed: false, state: "off", state_code: 0,
      reason: "disabled", reason_code: 0, sample_eligible: false, current_room_error_k: null,
      last_sample_room_error_k: null, last_sample_unix_s: null, evaluations: 0, samples: 0 };
    s.history.rows = s.history.rows.filter((r) => r.id !== "circulation_state");
    return s;
  },
  room(s) {
    s.reference_temperature = { configured: false, name: "", topic: "", temperature_path: "",
      setpoint_path: "", timestamp_path: "", enabled_path: "", hvac_mode_path: "", max_age_s: 300,
      subscribed: false, has_value: false, temperature_c: null, has_setpoint: false,
      setpoint_c: null, enabled: null, hvac_mode: null, age_s: null, received_ago_s: null,
      fresh: false, freshness_reason: "not_configured", temperature_valid: false,
      setpoint_valid: false, control_eligible: false, room_error_k: null, reason: "not_configured",
      reason_code: 1, retained: false, messages: 0, errors: 0, rejections: 0 };
    s.heating_curve = { ...s.heating_curve, armed: false, state: "off", state_code: 0,
      reason: "disabled", reason_code: 0, sample_eligible: false, current_room_error_k: null,
      last_sample_room_error_k: null, last_sample_unix_s: null, evaluations: 0, samples: 0 };
    return s;
  },
  circulation(s) {
    s.circulation_source = { configured: false, name: "", topic: "", power_path: "",
      timestamp_path: "", max_age_s: 120, on_threshold_w: "3.0", off_threshold_w: "1.0",
      confirm_s: 60, subscribed: false, has_value: false, power_w: null, state: "unknown",
      age_s: null, fresh: false, freshness_reason: "not_configured", retained: false,
      messages: 0, errors: 0, rejections: 0 };
    // history.cpp stops labelling the ring, so /status stops offering the trend.
    s.history.rows = s.history.rows.filter((r) => r.id !== "circulation_state");
    return s;
  },
  weather(s) {
    s.weather_forecast = { ...s.weather_forecast, configured: false, available: false,
      has_value: false, latitude: null, longitude: null, state: "disabled",
      outdoor_mean_2h_c: null, solar_energy_2h_wh_m2: null, issued_at: null, fetched_at: null,
      valid_for_decision_at: null, age_s: null, fresh: false, freshness_reason: "not_configured",
      reason: "not_configured" };
    s.heating_curve = { ...s.heating_curve, forecast_available: false };
    return s;
  },
  homehub(s) {
    s.modbus = { enabled: false, connected: false, discovering: false, host: "", port: 502,
      // null, not 0: with no HomeHub there is no task, so its stack was never sampled — the
      // firmware cannot emit a number here, and a fixture that says 0 describes a payload no
      // device produces (main/stack_watch.hpp).
      unit_id: 1, rx: 0, fails: 0, values: 0, task_stack_min_free_bytes: null,
      plant_gate_known: false, plant_gate_active: false, heating_mode_known: false,
      heating_mode_active: false };
    s.history.modbus_rows = [];
    s.heating_curve = { ...s.heating_curve, state: "blocked", state_code: 4,
      reason: "homehub_unavailable", reason_code: 7, sample_eligible: false,
      plant_gate_known: false, plant_gate_active: false,
      plant_outdoor_temperature_c: null, plant_outdoor_source: null,
      last_sample_plant_outdoor_temperature_c: null,
      last_sample_plant_outdoor_source: null };
    return s;
  },
  env3(s) {
    s.env3 = { ...s.env3, supported: false, enabled: false, connected: false, fresh: false,
      age_s: null, temperature_c: null, humidity_pct: null, pressure_hpa: null,
      error: "unsupported_board", samples: 0, presets: [] };
    s.history.env3_rows = [];
    s.heating_curve = { ...s.heating_curve, outdoor_temperature_c: null, outdoor_source: null,
      last_sample_outdoor_temperature_c: null, last_sample_outdoor_source: null };
    return s;
  },
  x10a(s) {
    s.hp = { ...s.hp, connected: false, last_ok_s: -1, registers: 0, values: 0 };
    s.profile = { id: "auto" };
    s.detect = { ...s.detect, valid: false, capacity_kw: null, capacity_kw_iu: null, ou_eeprom: "",
      candidates: [], families: [], ambiguous: false, model: null };
    // Only the BOARD's own trends survive an unresolved profile — history_record_board() owns them
    // and the poll task calls it before it decides whether to detect or to sweep.
    s.history.rows = s.history.rows.filter((r) => r.id === "free_heap" || r.id === "max_alloc");
    s.heating_curve = { ...s.heating_curve, state: "blocked", state_code: 4,
      reason: "x10a_unavailable", reason_code: 6, sample_eligible: false };
    return s;
  },
  // Two optional systems that own a Connections row rather than a card. They are here because
  // absence is the question, not importance: an empty syslog host is the disabled state, and an NTP
  // server that has never answered is why /history omits `t0` and the UI reads out an AGE instead of
  // a wall-clock time. Neither is exercised by the three cards above, which is exactly why the
  // Connections rows are a renderer in their own right below.
  syslog(s) {
    s.syslog = { configured: false, resolved: false, reachable: false, host: "", port: 514 };
    return s;
  },
  ntp(s) {
    s.ntp = { server: "", synced: false, time: null };
    return s;
  },
  // Safe mode is not one absent source: main.cpp skips EVERY optional consumer, so the sampler's
  // task is never created and its snapshot stays default-constructed while /status still derives
  // `armed` from the saved configuration. logic/heating_curve_diagnosis.hpp names that state rather
  // than letting it share a wording with "no room source is mapped".
  safeMode(s) {
    // safe_mode_cause is part of the shape http_status.cpp emits: this scenario is the CRASH-LOOP
    // route (reset_reason task_wdt), so the recovery banner must give configuration advice. The
    // heap route reaches the same sys.safe_mode with cause "heap" and opposite advice (#407).
    s.sys = { ...s.sys, safe_mode: true, safe_mode_cause: "crash_loop", reset_reason: "task_wdt" };
    s.hp = { ...s.hp, connected: false, last_ok_s: -1, values: 0 };
    // mb_start() is never called, so the stack's own `enabled` flag is false even though an address
    // IS saved — the one place /status reports a task fact where its siblings report a config fact.
    s.modbus = { ...s.modbus, enabled: false, connected: false, plant_gate_known: false,
      plant_gate_active: false };
    s.env3 = { ...s.env3, connected: false, fresh: false, temperature_c: null, humidity_pct: null,
      pressure_hpa: null, error: "not_started", samples: 0 };
    s.weather_forecast = { ...s.weather_forecast, available: false, fresh: false,
      state: "waiting", reason: "safe_mode" };
    s.heating_curve = { ...s.heating_curve, armed: true, state: "off", state_code: 0,
      reason: "sampler_inactive", reason_code: 14, sample_eligible: false, evaluations: 0,
      samples: 0, plant_gate_known: false, plant_gate_active: false,
      outdoor_temperature_c: null, outdoor_source: null,
      last_sample_outdoor_temperature_c: null, last_sample_outdoor_source: null,
      plant_outdoor_temperature_c: null, plant_outdoor_source: null,
      last_sample_plant_outdoor_temperature_c: null,
      last_sample_plant_outdoor_source: null };
    s.history = { dt: 300, rows: [], modbus_rows: [], env3_rows: [] };
    return s;
  },
};

// `absent` drives the derived rules below. A scenario declares what is GONE; everything else is
// present and healthy, so a rule about "a configured source" needs no per-scenario bookkeeping.
const SCENARIOS = [
  { name: "everything configured", remove: [] },
  { name: "no MQTT broker (both MQTT sources stay saved)", remove: ["mqtt"] },
  { name: "no room source", remove: ["room"] },
  { name: "no circulation witness", remove: ["circulation"] },
  { name: "no weather location", remove: ["weather"] },
  { name: "no HomeHub", remove: ["homehub"] },
  { name: "no ENV III", remove: ["env3"] },
  { name: "X10A bus silent", remove: ["x10a"] },
  { name: "no HomeHub and no weather", remove: ["homehub", "weather"] },
  { name: "X10A silent and no HomeHub (no plant source at all)", remove: ["x10a", "homehub"] },
  { name: "MQTT sources deleted, broker kept", remove: ["room", "circulation"] },
  { name: "every optional source removed", remove: ["mqtt", "room", "circulation", "weather",
                                                    "homehub", "env3", "x10a"] },
  { name: "no syslog collector", remove: ["syslog"] },
  { name: "clock never synced", remove: ["ntp"] },
  { name: "no syslog and no clock", remove: ["syslog", "ntp"] },
  { name: "safe mode with everything configured", remove: ["safeMode"] },
];

function build(remove) {
  return remove.reduce((s, key) => REMOVE[key](s), JSON.parse(JSON.stringify(HEALTHY())));
}

// ── The rules ──────────────────────────────────────────────────────────────────────────────────
const RENDERERS = {
  // The Connections rows are the only surface some optional systems have (syslog, NTP, and the
  // HomeHub's address), so a matrix that only walked the cards could not see them at all. Rendered
  // to a string here so the same artefact/setup-copy rules apply to them unchanged.
  connLinks: () => JSON.stringify(ui.connLinks()),
  esp32CardHtml: () => ui.esp32CardHtml(),
  dynamicControlCardHtml: () => ui.dynamicControlCardHtml(),
  circulationSettingsCardHtml: () => ui.circulationSettingsCardHtml(),
};

// Copy that tells the reader to CONFIGURE a source. Printing one of these while that very source is
// configured is the defect this file was built around, so each is tied to the status field that
// makes it false — and to the CARD it belongs to. Scoping matters: several keys share one German
// word ("Nicht konfiguriert" is `circ.not_configured` on one card and `dyn.not_configured` on
// another), so a search across the whole page would fail on a card that is telling the truth about a
// different source.
const SETUP_COPY = [
  { card: "dynamicControlCardHtml", text: () => ui.t("dyn.state_setup_room"),
    falseWhen: (s) => s.reference_temperature.configured,
    why: "the heating-curve card told the reader to set up the room source they have configured" },
  { card: "dynamicControlCardHtml", text: () => ui.t("dyn.state_setup_homehub"),
    falseWhen: (s) => s.modbus.enabled,
    why: "the heating-curve card called a configured HomeHub 'not set up'" },
  { card: "circulationSettingsCardHtml", text: () => ui.t("circ.not_configured"),
    falseWhen: (s) => s.circulation_source.configured,
    why: "the circulation row called a configured witness 'not configured'" },
];

let checks = 0;
for (const scenario of SCENARIOS) {
  const status = build(scenario.remove);
  ui.S.status = status;
  ui.S._values = [];
  ui.S._modbus = [];
  ui.S.hist = new Map();
  ui.S.histBusy = new Set();
  ui.S.histPin = new Map();
  ui.S.descOpen = new Set();

  const rendered = {};
  for (const [name, run] of Object.entries(RENDERERS)) {
    // RULE 1 — no absence may throw. A card that crashes takes the whole Settings screen with it,
    // and an absent block reads as `undefined` all the way down unless every access is optional.
    assert.doesNotThrow(() => { rendered[name] = run(); },
      `${scenario.name}: ${name}() threw`);
    // RULE 2 — nor may it leak a JS artefact into the page. "undefined °C" is the shape an absent
    // /status block takes when one `?.` is missing, and it renders as a reading.
    assert.doesNotMatch(rendered[name], /undefined|NaN|\[object Object\]/,
      `${scenario.name}: ${name}() rendered a JavaScript artefact`);
    checks++;
  }
  // liveData() is the schematic's snapshot rather than markup; it must survive the same states.
  assert.doesNotThrow(() => ui.liveData(), `${scenario.name}: liveData() threw`);

  // RULE 3b — a pill whose SOURCE depends on which systems exist must never describe one that does
  // not. The Smart-Grid request is the only pill with two possible instruments (the HomeHub register
  // and the X10A SG-Ready contacts), so it is the only one that can name the wrong one — and it did:
  // the explainer said "read back from the HomeHub" on every plant, including those that have never
  // had a gateway. Asserted over BOTH languages, because a sentence corrected in one is half fixed.
  {
    const d = ui.liveData();
    const e = ui.INSPECT.sgrequest;
    const copy = [e.t(d), e.what(d), e.now(d)].flatMap((o) => [o.en, o.de]).join(" ");
    if (scenario.remove.includes("homehub")) {
      assert.doesNotMatch(copy, /HomeHub|Modbus/,
        `${scenario.name}: the Smart-Grid pill named a gateway this plant does not have`);
    } else {
      assert.doesNotMatch(copy, /X10A|SG-Ready/,
        `${scenario.name}: the Smart-Grid pill credited the contacts while the gateway answers`);
    }
    checks++;
  }

  // RULE 3 — never tell someone to configure what they have configured.
  for (const copy of SETUP_COPY) {
    if (!copy.falseWhen(status)) continue;
    assert.ok(!rendered[copy.card].includes(copy.text()), `${scenario.name}: ${copy.why}`);
    checks++;
  }

  // RULE 4 — a source that cannot be reached must not be rendered as healthy. The circulation row is
  // the one that carried this wrong: it answered a cleared broker with "waiting", styled like any
  // other row, so a witness that could never report looked exactly like one that was running.
  if (status.circulation_source.configured && !status.mqtt.configured) {
    assert.match(rendered.circulationSettingsCardHtml, /class="[^"]*\berr\b[^"]*"/,
      `${scenario.name}: an unreachable circulation witness must not render as a healthy row`);
    assert.ok(rendered.circulationSettingsCardHtml.includes(ui.t("circ.broker_off")),
      `${scenario.name}: the circulation row must name the missing broker, as the room row does`);
    checks++;
  }

  // RULE 5 — an unoffered trend renders NOTHING. The device decides which series exist; a browser
  // that draws a chart the firmware is not buffering is showing an empty buffer as a feature.
  const offered = new Set([
    ...status.history.rows.map((r) => r.id),
    ...status.history.modbus_rows.map((r) => r.id),
    ...status.history.env3_rows.map((r) => r.id),
  ]);
  for (const id of ["circulation_state", "free_heap", "max_alloc", "dhw_tank", "env3_temperature"]) {
    if (offered.has(id)) continue;
    assert.equal(ui.histHtml(id, "", id), "",
      `${scenario.name}: the UI offered a "${id}" chart the device is not buffering`);
    checks++;
  }

  // RULE 6 — a CONFIGURED endpoint must never be reported as "disabled" because its task is not
  // running. /status.modbus.enabled is the one optional-source flag that reports the TASK rather than
  // the config (mb_start() is skipped in safe mode), so the Connections row has to key its off-state
  // on the saved HOST. Keying it on `enabled` would tell a safe-mode board its HomeHub is not set up
  // — §2.5's failure, on the one source that can still reach it.
  if (status.modbus.host && !status.modbus.enabled) {
    const row = ui.connLinks().find((l) => l.edit === "homehub");
    assert.ok(row, `${scenario.name}: the HomeHub row must exist whenever /status.modbus does`);
    assert.notEqual(row.state, ui.t("conn.disabled"),
      `${scenario.name}: a saved HomeHub address must not read as disabled while its task is stopped`);
    assert.ok(row.value.includes(status.modbus.host),
      `${scenario.name}: the HomeHub row must keep showing the configured address`);
    checks++;
  }

  // RULE 7 — an ARMED diagnosis that is not running must say so, not report itself disabled. `off`
  // plus `armed` can only mean the sampler's task was never created (safe mode); publishing the
  // evaluator's "disabled" there makes a running installation read as an unconfigured one.
  if (status.heating_curve.armed && status.heating_curve.state === "off") {
    assert.equal(status.heating_curve.reason, "sampler_inactive",
      `${scenario.name}: /status.heating_curve is self-contradictory (armed + disabled)`);
    assert.ok(rendered.dynamicControlCardHtml.includes(ui.t("dyn.state_safe_mode")),
      `${scenario.name}: an armed-but-inactive sampler must name why it is not recording`);
    checks++;
  }

  // RULE 8 — the optional outdoor axis must blame only ITSELF. A healthy ENV III with no value in
  // the diagnosis means the RECORDER stopped, not the sensor: clearing the broker disarms the
  // sampler while the sensor keeps measuring, and warning there sends the reader to check hardware
  // that is fine. Only a running recorder that is not being fed may warn, and an absent sensor is
  // never a fault at all — the axis gates no sampling.
  // The row is PASSIVE — label and value share one accordion button, since the sensor's only editor
  // is the Board Hardware modal on the ESP32 card. The match runs to the TONGUE, not to the first
  // </button>, and that is the load-bearing part rather than a tidier regex: a row that regains a
  // configuration action becomes a SPLIT row, whose first </button> closes the info toggle — so a
  // face stopping there would never contain the `data-act` it is checking for, and the guard below
  // would pass vacuously on exactly the change it exists to catch. Measured, not reasoned: with the
  // action put back, the first version of this matcher reported success.
  // Asserted to be found rather than guarded by `if (face)` for the same reason — this selector used
  // to name the removed button, and a face that stops matching retires the rule in silence.
  const outdoorFace = rendered.dynamicControlCardHtml
    .match(/data-desc="dynamic:outdoor"[\s\S]*?<div class="vdesc">/)?.[0] || "";
  assert.ok(outdoorFace, `${scenario.name}: the outdoor axis row must render`);
  assert.doesNotMatch(outdoorFace, /data-act=/,
    `${scenario.name}: the outdoor axis must not offer an editor — the Board modal owns the sensor`);
  checks += 2;
  {
    const sensorOk = status.env3 && status.env3.enabled && status.env3.fresh;
    const axisMissing = status.heating_curve.outdoor_temperature_c == null;
    const recording = status.heating_curve.armed &&
      status.heating_curve.reason !== "sampler_inactive";
    if (axisMissing && (!sensorOk || !recording)) {
      assert.doesNotMatch(outdoorFace, /vrow-val settings-wrap (?:warn|err)/,
        `${scenario.name}: the outdoor axis must not report a fault when the sensor is absent ` +
        `or the recorder is not running`);
      checks++;
    }
    if (sensorOk && axisMissing && !recording) {
      assert.ok(rendered.dynamicControlCardHtml.includes(ui.t("dyn.outdoor_status_idle")),
        `${scenario.name}: a healthy sensor with a stopped recorder must name the recorder`);
      checks++;
    }
  }

  // RULE 9 — the plant axis is a second, separately sourced row. HomeHub absence must not leak the
  // last input-44 value or turn this OPTIONAL context into a warning; when present, the face and the
  // event tongue name HomeHub rather than silently presenting it as ENV III.
  const plantFace = rendered.dynamicControlCardHtml
    .match(/data-desc="dynamic:plant-outdoor"[\s\S]*?<div class="vdesc">/)?.[0] || "";
  assert.ok(plantFace, `${scenario.name}: the plant outdoor axis row must render`);
  assert.doesNotMatch(plantFace, /data-act=/,
    `${scenario.name}: plant outdoor evidence must not offer a configuration action`);
  checks += 2;
  if (scenario.remove.includes("homehub") || scenario.remove.includes("safeMode")) {
    assert.doesNotMatch(plantFace, /vrow-val settings-wrap (?:warn|err)/,
      `${scenario.name}: absent plant outdoor context must stay neutral and never gate sampling`);
    assert.doesNotMatch(plantFace, /9[,.]1.*°C|8[,.]9.*°C/,
      `${scenario.name}: a removed HomeHub must not leak an old plant outdoor value`);
    checks += 2;
  } else {
    assert.match(plantFace, /HomeHub/,
      `${scenario.name}: plant outdoor evidence must name its source`);
    assert.match(rendered.dynamicControlCardHtml, /9,1.*°C[^]*HomeHub|9\.1.*°C[^]*HomeHub/,
      `${scenario.name}: current plant outdoor evidence must render with provenance`);
    checks += 2;
  }
}

// The board's own memory trends are the case that must survive EVERY plant absence: they describe
// the ESP32, not the heat pump. Assert it here as a property of the matrix rather than of one
// scenario, because the regression was precisely that they rode on the heat pump's poll cycle.
const busSilent = build(["x10a", "homehub", "mqtt", "room", "circulation", "weather", "env3"]);
for (const id of ["free_heap", "max_alloc"]) {
  assert.ok(busSilent.history.rows.some((r) => r.id === id),
    `a board memory trend must survive every absent plant source ("${id}" was dropped)`);
}

// ── The TRANSPORT's own presence/absence ───────────────────────────────────────────────────────
// The optional wire (net.cpp) is not a plant SOURCE, so it has no REMOVE entry — but it has the
// same failure shape the scenarios above exist for: a state where the honest thing to render is
// nothing at all, and three where rendering the wrong one misleads. On a board with no controller
// the row must be ABSENT, not an empty or "unavailable" row — the modbus/env3 rule applied to a
// transport. And "no cable" must never be worded as the same thing as "cable, but no address":
// they call for opposite actions (plug something in, versus fix DHCP or the VLAN).
const WIRED = [
  { name: "no controller",        eth: { supported: true, present: false }, row: false },
  { name: "controller, no cable", eth: { supported: true, present: true, link: false, lease: false },
    cls: "err",  key: "conn.eth_no_cable" },
  { name: "cable, no lease",      eth: { supported: true, present: true, link: true, lease: false },
    cls: "warn", key: "conn.eth_no_lease" },
  { name: "up",                   eth: { supported: true, present: true, link: true, lease: true,
    speed_mbps: 100, full_duplex: true }, cls: "ok", value: "100 Mbit/s" },
];
for (const c of WIRED) {
  ui.S.status = { ...HEALTHY(), net: { kind: c.eth.lease ? "eth" : "wifi", ip: "", eth: c.eth } };
  const rows = ui.connLinks().filter((r) => r.label === "Ethernet");
  if (c.row === false) {
    assert.equal(rows.length, 0,
      "a board with no Ethernet controller must render NO Ethernet row, not an empty one");
    checks++;
    continue;
  }
  assert.equal(rows.length, 1, `${c.name}: exactly one Ethernet row`);
  assert.equal(rows[0].cls, c.cls, `${c.name}: tone must distinguish this state`);
  if (c.key) {
    assert.equal(rows[0].value, ui.t(c.key), `${c.name}: must use its own translated wording`);
    assert.notEqual(ui.t(c.key), ui.t("conn.offline"),
      `${c.name}: must not be worded as the generic offline state`);
  }
  if (c.value) assert.ok(rows[0].value.includes(c.value), `${c.name}: must state the negotiated link`);
  checks++;
}
assert.notEqual(ui.t("conn.eth_no_cable"), ui.t("conn.eth_no_lease"),
  "no cable and no address are different problems and must read differently");

console.log(`UI absence matrix: ${SCENARIOS.length} source combinations, ${checks} rules held`);

// Exported so a local visual review can drive the REAL assembled UI from the same fixtures, rather
// than hand-copying a /status shape into a throwaway mock — a second copy of the payload would be a
// review of the copy. Importing this module runs the matrix, which is the intended side effect.
export { HEALTHY, REMOVE, SCENARIOS, build };
