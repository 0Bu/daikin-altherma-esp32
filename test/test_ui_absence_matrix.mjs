// THE ABSENCE MATRIX — what the UI says when a third-party system is unconfigured, deleted, or
// simply not answering. Every optional source this firmware reads (the MQTT broker, the HomeHub, the
// ENV III accessory, the MQTT circulation witness and the X10A bus itself) can be absent
// independently of the others, and safe mode removes all of them at once. That
// is a state space no single-feature test walks, and it is the one where this UI has been wrong.
//
// It exists because every other gate was green while the copy lied. The firmware built, the values
// were physically true, the drawing was right, the schematic audit passed, and:
//
//   • the circulation row answered a cleared broker with "waiting for a message", forever, with no
//     colour or accurate explanation;
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
import { createStrictDocument } from "../tools/ui/strict_dom.mjs";

const strictDoc = createStrictDocument("main/www/index.html");
const consoleErrors = [];

const context = vm.createContext({
  document: strictDoc,
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
  location: { pathname: "/", search: "", hash: "", hostname: "daikin-absence.local", reload() {} },
  URL, URLSearchParams, Blob, AbortController,
  console: {
    log: () => {},
    warn: () => {},
    error: (...args) => { consoleErrors.push(args.map(String).join(" ")); },
  },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
});

vm.runInContext(`${readAppSource().replace(/\nboot\(\);\s*$/, "\n")}
  applyStaticI18n();
  labelSchematicHits();
  wire();
  this.__ui = { S, t, esp32CardHtml, circulationSettingsCardHtml,
                refrigerantServiceRowHtml, checkupCardHtml, checkupDetailHtml,
                checkupFlowReport, checkupFlowBriefHtml, connLinks, liveData,
                renderApp, renderCards, histHtml, INSPECT };`, context,
  { filename: "main/www/app.sources" });
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
  circulation_source: { configured: true, name: "Example circulation pump", topic: "fixture/circulation/status",
    power_path: "apower", timestamp_path: "aenergy.minute_ts", max_age_s: 120, on_threshold_w: "3.0",
    off_threshold_w: "1.0", confirm_s: 60, subscribed: true, has_value: true, power_w: 5.4,
    state: "on", age_s: 5, fresh: true, freshness_reason: "fresh", retained: false, messages: 5,
    errors: 0, rejections: 0 },
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
  refrigerant_service: { kind: "observation", state: "waiting", continuous_s: 0, samples: 0,
    mode: "heating", blocker: "compressor_not_running", special_phases_known: true,
    load_proven: false, eev_feedback: false, limitations: [], metrics: {} },
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
function clearCirculationReading(s) {
  Object.assign(s.circulation_source, { has_value: false, fresh: false, power_w: null,
    state: "unknown", freshness_reason: "no_value", age_s: null, retained: false });
}

const REMOVE = {
  // Clearing the broker stops receipt without deleting the saved circulation mapping.
  mqtt(s) {
    // base/base_custom come from the CONFIG, not from the broker link, so http_status.cpp still
    // emits them with no broker — an installation keeps its identity while MQTT is switched off.
    s.mqtt = { configured: false, connected: false, tls: false, has_creds: false, broker: "",
               base: "daikin-altherma-esp32", base_custom: false };
    s.circulation_source.subscribed = false;
    clearCirculationReading(s);
    s.history.rows = s.history.rows.filter((r) => r.id !== "circulation_state");
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
  homehub(s) {
    s.modbus = { enabled: false, connected: false, discovering: false, host: "", port: 502,
      // null, not 0: with no HomeHub there is no task, so its stack was never sampled — the
      // firmware cannot emit a number here, and a fixture that says 0 describes a payload no
      // device produces (main/stack_watch.hpp).
      unit_id: 1, rx: 0, fails: 0, values: 0, task_stack_min_free_bytes: null,
      plant_gate_known: false, plant_gate_active: false, heating_mode_known: false,
      heating_mode_active: false };
    s.history.modbus_rows = [];
    return s;
  },
  env3(s) {
    s.env3 = { ...s.env3, supported: false, enabled: false, connected: false, fresh: false,
      age_s: null, temperature_c: null, humidity_pct: null, pressure_hpa: null,
      error: "unsupported_board", samples: 0, presets: [] };
    s.history.env3_rows = [];
    return s;
  },
  x10a(s) {
    s.hp = { ...s.hp, connected: false, last_ok_s: -1, registers: 0, values: 0 };
    s.profile = { id: "auto" };
    s.detect = { ...s.detect, valid: false, capacity_kw: null, capacity_kw_iu: null, ou_eeprom: "",
      candidates: [], families: [], ambiguous: false, model: null };
    delete s.refrigerant_service;
    // Only the BOARD's own trends survive an unresolved profile — history_record_board() owns them
    // and the poll task calls it before it decides whether to detect or to sweep.
    s.history.rows = s.history.rows.filter((r) => r.id === "free_heap" || r.id === "max_alloc");
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
    s.ntp = { ...s.ntp, synced: false, time: null };
    // The clock has never synchronized and the subscription has yet to receive a message.
    clearCirculationReading(s);
    Object.assign(s.circulation_source, { messages: 0, errors: 0, rejections: 0 });
    return s;
  },
  safeMode(s) {
    // safe_mode_cause is part of the shape http_status.cpp emits: this scenario is the CRASH-LOOP
    // route (reset_reason task_wdt), so the recovery banner must give configuration advice. The
    // heap route reaches the same sys.safe_mode with cause "heap" and opposite advice (legacy-407).
    s.sys = { ...s.sys, safe_mode: true, safe_mode_cause: "crash_loop", reset_reason: "task_wdt" };
    s.hp = { ...s.hp, connected: false, last_ok_s: -1, values: 0 };
    s.detect = { ...s.detect, valid: false, capacity_kw: null, capacity_kw_iu: null, ou_eeprom: "",
      candidates: [], families: [], ambiguous: false, model: null };
    delete s.refrigerant_service;
    // mb_start() is never called, so the stack's own `enabled` flag is false even though an address
    // IS saved — the one place /status reports a task fact where its siblings report a config fact.
    s.modbus = { ...s.modbus, enabled: false, connected: false, plant_gate_known: false,
      plant_gate_active: false };
    s.env3 = { ...s.env3, connected: false, fresh: false, temperature_c: null, humidity_pct: null,
      pressure_hpa: null, error: "not_started", samples: 0 };
    REMOVE.mqtt(s);
    Object.assign(s.circulation_source, { messages: 0, errors: 0, rejections: 0 });
    s.history = { dt: 300, rows: [], modbus_rows: [], env3_rows: [] };
    return s;
  },
};

// `absent` drives the derived rules below. A scenario declares what is GONE; everything else is
// present and healthy, so a rule about "a configured source" needs no per-scenario bookkeeping.
const SCENARIOS = [
  { name: "everything configured", remove: [] },
  { name: "no MQTT broker (circulation mapping stays saved)", remove: ["mqtt"] },

  { name: "no circulation witness", remove: ["circulation"] },

  { name: "no HomeHub", remove: ["homehub"] },
  { name: "no ENV III", remove: ["env3"] },
  { name: "X10A bus silent", remove: ["x10a"] },

  { name: "X10A silent and no HomeHub (no plant source at all)", remove: ["x10a", "homehub"] },
  { name: "every optional source removed", remove: ["mqtt", "circulation",
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
  circulationSettingsCardHtml: () => ui.circulationSettingsCardHtml(),
  refrigerantServiceRowHtml: () => ui.refrigerantServiceRowHtml(),
};

const SETUP_COPY = [
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

  // The arbitrary register reader requires a live X10A transport. Hiding only its form would leave
  // an empty disclosure that promises an action the poll task cannot execute; the complete row is
  // therefore present exactly while /status.hp.connected is true.
  if (status.hp.connected) {
    assert.match(rendered.esp32CardHtml, /protocol-diagnosis-detail/,
      `${scenario.name}: a live X10A link must expose protocol diagnosis`);
  } else {
    assert.doesNotMatch(rendered.esp32CardHtml, /protocol-diagnosis-detail|Protokolldiagnose|Protocol diagnostics/,
      `${scenario.name}: protocol diagnosis must disappear with the X10A link`);
  }
  checks++;

  // The service object has no truthful state until this boot detects an X10A profile. Safe mode
  // never starts the poll task and an initially silent bus never resolves one, so both API fixture
  // shapes omit the object and the browser must omit the row rather than blaming profile coverage.
  if (!status.detect.valid) {
    assert.equal(rendered.refrigerantServiceRowHtml, "",
      `${scenario.name}: no detected X10A profile must render no refrigerant-service row`);
    checks++;
  }

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
      `${scenario.name}: the circulation row must name the missing broker, by its actual cause`);
    checks++;
  }
  if (status.sys.safe_mode || scenario.remove.includes("ntp")) {
    // Safe mode stops MQTT. The circulation row follows the broker state from /status.
    const state = status.sys.safe_mode ? "circ.broker_off" : "circ.waiting";
    assert.ok(rendered.circulationSettingsCardHtml.includes(ui.t(state)),
      `${scenario.name}: the saved circulation mapping must reflect the observed input state`);
    assert.ok(!rendered.circulationSettingsCardHtml.includes(ui.t("circ.detail.power")),
      `${scenario.name}: the circulation input must not contribute a power reading`);
    checks += 2;
  }

  // RULE 5 — an unoffered trend renders NOTHING. The device decides which series exist; a browser
  // that draws a chart the firmware is not buffering is showing an empty buffer as a feature.
  const offered = new Set([
    ...status.history.rows.map((r) => r.id),
    ...status.history.modbus_rows.map((r) => r.id),
    ...status.history.env3_rows.map((r) => r.id),
  ]);
  for (const id of ["circulation_state", "free_heap", "max_alloc", "dhw_tank", "env3_temperature", "room_temp"]) {
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

  // Full unstubbed bundle render: verify renderApp() + renderCards() succeed cleanly with strict DOM,
  // including when health.checks is populated for scenarios with an active health block.
  assert.doesNotThrow(() => {
    ui.renderApp();
    ui.renderCards(false);
  }, `${scenario.name}: full renderApp/renderCards threw under strict DOM`);
  for (const hostId of ["valueGroups", "settingsCards", "connTile"]) {
    assert.doesNotMatch(strictDoc.getElementById(hostId).innerHTML, /undefined|NaN|\[object Object\]/,
      `${scenario.name}: #${hostId} rendered a JavaScript artefact during full renderApp`);
  }
  if (status.health) {
    const withChecks = JSON.parse(JSON.stringify(status));
    withChecks.diagnostics = { enabled: true, source: withChecks.health.source || "x10a",
      effective_source: withChecks.health.source || "x10a",
      available_sources: [withChecks.health.source || "x10a"] };
    withChecks.health.covered_s = withChecks.health.covered_s || 3600;
    withChecks.health.checks = [
      { id: "cycling", verdict: "ok", evidence: "measured", starts: 1, observed_s: 3600, required_s: 3600 },
      { id: "defrost", verdict: "collecting", evidence: "measured", count: 0, paired_count: 0,
        observed_s: 600, required_s: 3600, outdoor_source: "none", outdoor_samples: 0 },
      { id: "fault", verdict: "ok", evidence: "manufacturer", active: 0, observed_s: 3600 },
    ];
    ui.S.status = withChecks;
    assert.doesNotThrow(() => {
      ui.renderApp();
      ui.renderCards(false);
    }, `${scenario.name}: renderApp/renderCards with populated health.checks threw`);
    assert.equal(strictDoc.getElementById("cardBrowser").hidden, false,
      `${scenario.name}: active diagnostics with health.checks must reveal #cardBrowser`);
    assert.ok(strictDoc.getElementById("valueGroups").innerHTML.length > 0,
      `${scenario.name}: active diagnostics with health.checks must populate #valueGroups`);
  }
  checks++;
}
assert.deepEqual(consoleErrors, [],
  `UI absence full-bundle renders must emit no console errors: ${consoleErrors.join("; ")}`);

// The board's own memory trends are the case that must survive EVERY plant absence: they describe
// the ESP32, not the heat pump. Assert it here as a property of the matrix rather than of one
// scenario, because the regression was precisely that they rode on the heat pump's poll cycle.
const busSilent = build(["x10a", "homehub", "mqtt", "circulation", "env3"]);
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

// Modbus-only diagnostics and unavailable flow never surface X10A hydronic observation details
// or keep an unavailable flow row visible via a hydronic placeholder or stale X10A payload.
{
  const hydronicPlaceholder = {
    confirmed: false, current: false, dated: false, coverage_partial: false,
    restore_pending: false, persistence_pending: false, method: 2, reason_code: 0,
    reason: "none", spread_k: { min: null, mean: null, max: null },
  };
  const modbusOnly = build(["x10a"]);
  modbusOnly.diagnostics = { enabled: true, source: "modbus", effective_source: "modbus",
    available_sources: ["modbus"] };
  modbusOnly.health = { source: "modbus", status: "ok", persist: "no_record", source_fresh: true,
    covered_s: 3600, span_s: 3600, full_span: false, available: 4, assessable: 4, evaluated: 4,
    checks: [{ id: "flow", verdict: "unavailable", observed_s: 0, min_l_min: null,
      hydronic: hydronicPlaceholder, water_agreement: null }] };
  ui.S.status = modbusOnly;
  assert.ok(!ui.checkupCardHtml(true).includes("health_flow"),
    "Modbus diagnostics must hide unavailable flow even with hydronic placeholder");
  assert.equal(ui.checkupCardHtml(false), "",
    "offline Modbus card must not expose hydronic flow row");
  const modbusOkFlow = { id: "flow", verdict: "ok", evidence: "observation", min_l_min: 11.4,
    hydronic: { ...hydronicPlaceholder, confirmed: true, dated: true,
      first_evidence_unix_s: 1791880000, last_evidence_unix_s: 1791880020,
      samples: 4, spread_k: { min: 1.0, mean: 2.0, max: 3.0 } },
    water_agreement: { method: 2, reason_code: 0, reason: "qualified",
      r1_r4: { supported: true, qualified_s: 35, windows: 1, samples: 2, delta_k: { min: -0.3, mean: -0.2, max: -0.1 } },
      r2_r1: { supported: false, qualified_s: 0, windows: 0, samples: 0, delta_k: { min: null, mean: null, max: null } } } };
  modbusOnly.health.checks = [modbusOkFlow];
  const agreeLabel = ui.t("check.hydronic.agree_labels").split("|")[0];
  const modbusDetailHtml = ui.checkupDetailHtml(modbusOkFlow, false, modbusOnly.health);
  assert.ok(!modbusDetailHtml.includes("Water spread"),
    "Modbus flow detail must omit X10A hydronic population rows");
  assert.ok(!modbusDetailHtml.includes(agreeLabel),
    "Modbus flow detail must omit X10A water agreement rows");
  const modbusFlowReport = ui.checkupFlowReport();
  assert.equal(modbusFlowReport?.agreement, null,
    "Modbus flow report must omit X10A water agreement");
  assert.ok(!ui.checkupFlowBriefHtml(modbusFlowReport).includes(agreeLabel),
    "Modbus flow inspector must omit X10A water agreement rows");
  checks++;
}

console.log(`UI absence matrix: ${SCENARIOS.length} source combinations, ${checks} rules held`);

// Exported so a local visual review can drive the REAL assembled UI from the same fixtures, rather
// than hand-copying a /status shape into a throwaway mock — a second copy of the payload would be a
// review of the copy. Importing this module runs the matrix, which is the intended side effect.
export { HEALTHY, REMOVE, SCENARIOS, build };
