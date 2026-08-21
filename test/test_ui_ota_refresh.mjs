// Regression for refreshing the self-contained UI while an OTA download is already running.
// /ota/status is deliberately small enough to answer under TLS heap pressure while the full
// /status builder may be refused. Execute the production resume/render functions so that state can
// never again freeze Settings before its first card render or mislabel that window as unreachable.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const otaSource = readAppFragments(["history.js", "settings.js", "bootstrap.js"]);
assert.doesNotMatch(otaSource,
  /histPreferRam|histOtaSnapshot|histOtaRestore|captureHistoriesForOta|otaHistoryCacheRestore/,
  "measurement history must come from device flash, never a sessionStorage handoff");

class Element {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.textContent = "";
    this.title = "";
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.controls = [];
    this.disabled = false;
    this._html = "";
    this.classList = { contains: () => false, toggle: () => {} };
  }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  querySelectorAll() { return this.controls; }
}

// The tab that initiated OTA has a bounded session snapshot. A reload in that same tab must restore
// the complete dashboard/Settings state, label it as cached, and lock every Settings write control
// while the device is installing. Read-only explanation toggles remain usable. The compact shell
// below remains the fallback for a second tab.
{
  const elements = elementsFor(
    "hdrIp", "verLink", "settingsVer", "connTile", "settingsCards", "otaStat", "otaStatSet",
    "settingsDot", "btnSettings",
  );
  const connAction = new Element("conn-action");
  const settingsAction = new Element("settings-action");
  const explanationToggle = new Element("hardware-info");
  explanationToggle.dataset.desc = "board:hardware";
  elements.connTile.controls = [connAction];
  elements.settingsCards.controls = [settingsAction, explanationToggle];

  const cachedStatus = {
    version: "1.4.72-dev.333",
    uptime_s: 123,
    hp: { connected: true, proto: "I", rx: 1, tx: 2 },
    pins_avail: [1, 2],
    board: { preset_name: "Test board", led_gpio: -1, btn_gpio: -1 },
    sys: {},
    ota: { channel: "dev" },
    ui: { lang: "de" },
    wifi: { connected: true, ssid: "test-wifi", std: "Wi-Fi" },
    mqtt: { configured: false },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
    heating_curve: { method_version: 2, armed: false, state: "off" },
  };
  const cacheKey = "daikinOtaRenderV1";
  const storage = new Map([[cacheKey, JSON.stringify({
    saved_at_ms: Date.now(),
    status: cachedStatus,
    values: [{ label: "Operation Mode", value: "Heating" }],
    modbus: [{ label: "Leaving water temperature", value: "31.0" }],
  })]]);
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const S = {
    status: null, busy: false, otaBusy: false, otaInstalling: false, otaShown: false, otaView: null,
    otaAvail: null, otaCached: false, settingsHydrated: false, clickHold: false, scrub: null,
    descOpen: new Set(),
  };
  let languageHydrations = 0;
  let dashboardStatusPaints = 0;
  const context = {
    S,
    LANG: "de",
    uiLangSupported: (lang) => ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"].includes(lang),
    MODEL_DESCRIPTIONS: {},
    sessionStorage,
    document: { activeElement: null, createElement: () => new Element() },
    location: { hostname: "daikin.local", reload() {} },
    $: (id) => elements[id] || null,
    esc: (value) => String(value ?? ""),
    t: (key, ...args) => {
      const text = {
        "ota.pct": `${args[0]}%`,
        "ota.snapshot_title": "Firmware-Update",
        "ota.snapshot_label": "Datenstand",
        "ota.snapshot_value": "Zwischengespeichert",
        "ota.snapshot_help": "Letzter empfangener Stand; Einstellungen gesperrt.",
        "card.proto_title": "Protokoll",
        "card.fw_title": "Firmware",
        "card.channel": "Update-Kanal",
        "chan.dev": "Entwicklung",
        "chan.release": "Release",
        "dyn.card": "Heizkurven-Diagnose",
      };
      return text[key] ?? key;
    },
    setHtml: (id, html) => { elements[id].innerHTML = html; },
    // descriptions.js is not among the fragments this harness loads, but every settings card that
    // states a source's configuration renders through it. Stubbed here like esc/t so a card gaining
    // one explanation note does not fail as a missing global.
    descNoteHtml: (lead, text) => `<div class="vdesc-p"><span class="vdesc-n">${lead}</span> ${text}</div>`,
    hasHist: () => false,
    setLangFromStatus: () => { languageHydrations += 1; },
    renderOtaDashboardStatus: () => { dashboardStatusPaints += 1; },
    j: async () => ({ state: "updating", progress: 78, current: "1.4.72-dev.333", channel: "dev" }),
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  const source = readAppFragments(["dashboard.js", "settings.js"]);
  const sandbox = vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.__api = { resumeOta, renderSettings, otaCacheRestore };`,
    sandbox,
    { filename: "main/www/app.sources" },
  );
  context.renderApp = () => sandbox.__api.renderSettings();

  sandbox.__api.resumeOta();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(S.otaCached, true, "the matching same-tab frame must be marked as a snapshot");
  assert.equal(S.status.version, "1.4.72-dev.333", "the complete status frame is restored");
  assert.equal(S._values[0].value, "Heating", "X10A values survive the reload");
  assert.equal(S._modbus[0].value, "31.0", "HomeHub values survive the reload independently");
  assert.equal(languageHydrations, 1, "the restored device language is applied before rendering");
  assert.equal(elements.connTile.hidden, false, "known connections remain visible");
  assert.match(elements.settingsCards.innerHTML, /Firmware-Update/, "Settings labels the snapshot prominently");
  assert.match(elements.settingsCards.innerHTML, />ESP32</, "the complete board card remains visible");
  assert.match(elements.settingsCards.innerHTML, /Protokoll/, "the complete protocol card remains visible");
  assert.doesNotMatch(elements.settingsCards.innerHTML, /<div class="section-label">Dynamische/,
    "a restored OFF snapshot must keep the experimental card hidden");
  assert.equal(connAction.disabled, true, "connection writes are locked during OTA");
  assert.equal(settingsAction.disabled, true, "Settings writes are locked during OTA");
  assert.equal(explanationToggle.disabled, false,
    "read-only information tongues remain interactive while OTA locks competing writes");
  assert.equal(S.otaView.text, "78%", "progress resumes over the restored content");
  assert.equal(dashboardStatusPaints, 1, "the dashboard explicitly labels the restored OTA state");

  const freshStatus = { version: "fresh-live-frame" };
  S.status = freshStatus;
  assert.equal(await sandbox.__api.otaCacheRestore({ current: "1.4.72-dev.333" }), false,
    "a normal status response that wins the startup race must never be replaced by cache");
  assert.equal(S.status, freshStatus, "the freshly fetched frame remains authoritative");
  S.status = null;
  assert.equal(await sandbox.__api.otaCacheRestore({ current: "another-version" }), false,
    "a snapshot from another running version must be rejected");
  assert.equal(storage.has(cacheKey), false, "a rejected snapshot is removed");
}

function elementsFor(...ids) {
  return Object.fromEntries(ids.map((id) => [id, new Element(id)]));
}

// A refresh first learns only the compact OTA status. The production resumeOta() must render a
// truthful shell immediately, keep the progress as state, and leave its watch pending rather than
// requiring /status to succeed before anything appears.
{
  const elements = elementsFor(
    "hdrIp", "verLink", "settingsVer", "connTile", "settingsCards", "otaStat", "otaStatSet",
    "settingsDot", "btnSettings",
  );
  const S = {
    status: null, busy: false, otaBusy: false, otaInstalling: false, otaShown: false, otaView: null,
    otaAvail: null, settingsHydrated: false, clickHold: false, scrub: null,
  };
  let dashboardStatusPaints = 0;
  const context = {
    S,
    LANG: "de",
    uiLangSupported: (lang) => ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"].includes(lang),
    MODEL_DESCRIPTIONS: {},
    document: {
      activeElement: null,
      createElement: () => new Element(),
    },
    location: { hostname: "daikin.local", reload() {} },
    $: (id) => elements[id] || null,
    esc: (value) => String(value ?? ""),
    t: (key, ...args) => {
      const text = {
        "ota.pct": `${args[0]}%`,
        "ota.active_title": "Firmware-Update",
        "card.fw_title": "Firmware",
        "card.proto_title": "Protokoll",
        "card.channel": "Update-Kanal",
        "chan.dev": "Entwicklung",
        "chan.release": "Release",
      };
      return text[key] ?? key;
    },
    setHtml: (id, html) => { elements[id].innerHTML = html; },
    // descriptions.js is not among the fragments this harness loads, but every settings card that
    // states a source's configuration renders through it. Stubbed here like esc/t so a card gaining
    // one explanation note does not fail as a missing global.
    descNoteHtml: (lead, text) => `<div class="vdesc-p"><span class="vdesc-n">${lead}</span> ${text}</div>`,
    hasHist: () => false,
    renderOtaDashboardStatus: () => { dashboardStatusPaints += 1; },
    j: async () => ({ state: "updating", progress: 48, current: "1.4.72-dev.333", channel: "dev" }),
    // Keep otaWatch at its first delay. An unresolved Promise without a real timer does not keep the
    // Node process alive, while the assertions can inspect the adopted in-flight state.
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  const source = readAppFragments(["dashboard.js", "settings.js"]);
  const sandbox = vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.__api = { resumeOta, renderSettings };`,
    sandbox,
    { filename: "main/www/app.sources" },
  );

  sandbox.__api.resumeOta();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(S.otaInstalling, true, "the adopted device-side install must own the reachability state");
  assert.equal(S.otaShown, true, "the resumed progress must freeze only already-rendered Settings cards");
  assert.equal(S.otaView.text, "48%", "the resumed percentage must survive as renderable state");
  assert.equal(elements.hdrIp.textContent, "daikin.local", "the OTA shell restores the reached host identity");
  assert.equal(elements.verLink.textContent, "v1.4.72-dev.333", "the compact status restores the running version");
  assert.equal(elements.connTile.hidden, true, "unknown connection state is omitted rather than guessed");
  assert.match(elements.settingsCards.innerHTML, /Firmware/, "Settings must show a real Firmware card");
  assert.match(elements.settingsCards.innerHTML, /v1\.4\.72-dev\.333/, "the OTA-only card uses the reported version");
  assert.match(elements.settingsCards.innerHTML, /Entwicklung/, "the OTA-only card uses the reported channel");
  assert.equal(dashboardStatusPaints, 1, "the dashboard must paint the known OTA state immediately");

  // If /status later fits before the reboot, it must replace the recovery card ONCE despite
  // otaShown, and then repaint the retained percentage into the newly-created progress slot.
  S.status = {
    version: "1.4.72-dev.333",
    uptime_s: 123,
    hp: { connected: true, proto: "I", rx: 1, tx: 2 },
    pins_avail: [1, 2],
    board: { preset_name: "Test board", led_gpio: -1, btn_gpio: -1 },
    sys: {},
    ota: { channel: "dev" },
    ui: { lang: "de" },
    wifi: { connected: true, ssid: "test-wifi", std: "Wi-Fi" },
    mqtt: { configured: false },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
  };
  sandbox.__api.renderSettings();

  assert.equal(S.settingsHydrated, true, "the first status-backed Settings render must complete");
  assert.equal(elements.connTile.hidden, false, "known connection state returns with full status");
  assert.match(elements.settingsCards.innerHTML, />ESP32</, "the complete board cards replace the OTA shell");
  assert.match(elements.settingsCards.innerHTML, /Protokoll/, "the complete protocol card is restored");
  assert.equal(elements.otaStatSet.children.at(-1)?.textContent, "48%",
    "hydrating the complete cards must repaint the retained OTA percentage");
}

// A failing /status during an adopted install must not overwrite that stronger, successful
// /ota/status evidence with the red generic unreachable state.
{
  const elements = elementsFor("svMode", "svStatus", "svDot");
  const context = {
    $: (id) => elements[id],
    setTxt: (id, value) => { elements[id].textContent = String(value); },
    t: (key, ...args) => key === "ota.active_sub" ? `Installation läuft · ${args[0]}` : key,
  };
  const source = readAppFragments(["app_state.js"]);
  const sandbox = vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.__api = { S, markUnreachable };`,
    sandbox,
    { filename: "main/www/js/app_state.js" },
  );

  sandbox.__api.S.otaInstalling = true;
  sandbox.__api.S.otaView = { text: "48%" };
  sandbox.__api.markUnreachable();
  assert.equal(elements.svMode.textContent, "ota.active_title");
  assert.equal(elements.svStatus.textContent, "Installation läuft · 48%");
  assert.equal(elements.svStatus.attributes.class, "sc-status idle",
    "an expected OTA resource window must not use the error presentation");

  sandbox.__api.S.otaInstalling = false;
  sandbox.__api.S.otaBusy = true;
  sandbox.__api.S.otaView = { text: "ota.checking" };
  sandbox.__api.markUnreachable();
  assert.equal(elements.svStatus.attributes.class, "sc-status idle",
    "the deliberately refused status snapshot during manifest TLS must not look unreachable");

  sandbox.__api.S.otaBusy = false;
  sandbox.__api.markUnreachable();
  assert.equal(elements.svMode.textContent, "sys.unreachable");
  assert.equal(elements.svStatus.attributes.class, "sc-status err",
    "ordinary failures keep the existing unreachable behavior");
}

console.log("OTA refresh: same-tab snapshot, recovery fallback, Settings hydration, and reachability passed");
