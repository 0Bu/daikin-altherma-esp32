// Regression for refreshing the self-contained UI while an OTA download is already running.
// /ota/status is deliberately small enough to answer under TLS heap pressure while the full
// /status builder may be refused. Execute the production resume/render functions so that state can
// never again freeze Settings before its first card render or mislabel that window as unreachable.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

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
    this._html = "";
    this.classList = { contains: () => false, toggle: () => {} };
  }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
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
  sandbox.__api.markUnreachable();
  assert.equal(elements.svMode.textContent, "sys.unreachable");
  assert.equal(elements.svStatus.attributes.class, "sc-status err",
    "ordinary failures keep the existing unreachable behavior");
}

console.log("OTA refresh: recovery shell, first Settings hydration, and truthful reachability passed");
