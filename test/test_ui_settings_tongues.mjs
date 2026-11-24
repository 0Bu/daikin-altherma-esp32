// Dynamic-control rows use the real production renderer. Every label owns a collapsible information
// tongue, while compact source values on the right open independent editors. This guards the
// split-action contract, source status presentation and all configured/unconfigured use-cases.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["dashboard.js"]);
const labels = {


































  "board.title": "Board-Hardware",

























































  "env.title": "Außensensor",
  "env.collecting": "Messwerte werden erfasst",
  "env.unavailable": "Sensor nicht erreichbar",
  "card.proto_title": "Protokoll",
  "card.fw_title": "Firmware",
  "card.hplink": "Wärmepumpen-Verbindung",
  "card.online": "Online",
  "card.offline": "Offline",
  "card.protocol": "Protokoll",
  "card.rxpin": "RX-Pin",
  "card.txpin": "TX-Pin",
  "card.firmware": "Version",
  "card.channel": "Update-Kanal",
  "card.language": "Sprache",
  "card.diagnostics": "Anlagendiagnose",
  "card.hplink_help": "Verbindungs-Erklärung",
  "card.protocol_help": "Protokoll-Erklärung",
  "card.rxpin_help": "RX-Erklärung",
  "card.txpin_help": "TX-Erklärung",
  "card.firmware_help": "Firmware-Erklärung",
  "card.channel_help": "Kanal-Erklärung",
  "card.language_help": "Sprach-Erklärung",
  "card.diagnostics_help": "Diagnose-Erklärung",
  "card.hardware": "Hardware",
  "card.uptime": "Laufzeit",
  "card.freeheap": "Freier Speicher",
  "card.maxalloc": "Größter Block",
  "chan.release": "Release",
  "chan.dev": "Development",
  "lang.auto": "Browser",
  "lang.de": "Deutsch",
  "lang.en": "English",
  "diagnostics.off": "Aus",
  "diagnostics.on": "Ein",










  "aria.ota": "Nach Firmware-Updates suchen",
  "ota.title_check": "Nach Updates suchen",
  "settings.diagnostics": "Anlagendiagnose",
  "circ.title": "Quelle der Zirkulationspumpe",
  "circ.row": "Warmwasser-Zirkulationspumpe",
  "circ.not_configured": "Nicht konfiguriert",
  "circ.unavailable": "Nicht verfügbar",
  "circ.running": "Läuft",
  "circ.stopped": "Steht",
  "circ.checking": "Prüft",
  "circ.stale": "Veraltet",
  "circ.waiting": "Warte auf Nachricht",
  "circ.detail.source": "Quelle",
  "circ.detail.power": "Wirkleistung",
  "circ.detail.state": "Erkannter Zustand",
  "circ.detail.age": "Alter des Messwerts",
  "circ.settings_help": "Nur lesende Pumpendiagnose.",
  "circ.broker_off": "MQTT-Broker deaktiviert",
  "env.live": "Live",
  "wf.not_configured": "Keine Tarife",
  "wf.gas.title": "Gaspreis-Vergleich",
  "wf.gas.row": "Gaspreis-Vergleich (Tarife)",
  "wf.gas.detail.elec": "Strompreis",
  "wf.gas.detail.gas": "Gaspreis",
  "wf.gas.detail.breakeven": "Break-even-AZ",
  "wf.gas.settings_help": "Nur lokale Tarifwerte für die Arbeitszahl-Auswertung (88 % Hs).",
};
const t = (key, ...args) => (labels[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const S = { status: {}, descOpen: new Set() };
const descNoteHtml = (lead, text) =>
  `<div class="vdesc-p"><span class="vdesc-n">${esc(lead)}</span> ${esc(text)}</div>`;
const sandbox = vm.createContext({
  S, LANG: "de", t, esc, descNoteHtml, setTimeout, clearTimeout,
  uiLangSupported: (lang) => ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"].includes(lang),
  MODEL_DESCRIPTIONS: {}, hasHist: () => false, checkupDuration: (seconds) => `${seconds} s`,
  histHtml: () => `<div class="vhist vhist-state">TIMELINE</div>`,
});
vm.runInContext(`${source}\nthis.__renderEsp32 = esp32CardHtml; this.__renderCirculation = circulationSettingsCardHtml;`, sandbox,
  { filename: "main/www/js/dashboard.js" });

S.status = {
  diagnostics: { enabled: true },
  mqtt: { configured: true },
  modbus: { enabled: true, connected: true },
  env3: {
    supported: true, enabled: true, fresh: true,
    temperature_c: 20.2, humidity_pct: 46, pressure_hpa: 1009,
  },
  circulation_source: {
    configured: true, name: "Example circulation pump", has_value: true, fresh: true,
    power_w: 4.2, age_s: 17, state: "on",
  },
};
let circulationHtml = sandbox.__renderCirculation();
let circulationButton = circulationHtml.match(/<button[^>]*data-act="circulation"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(circulationButton, /<span>Example circulation pump<\/span>/,
  "the editable row header must identify the configured pump");
// The VISIBLE face keeps the pump's name — the status must not take its place. It is scoped to the
// span rather than the whole button on purpose: the row now states its condition in COLOUR too, and
// DESIGN.md §9 requires a colour-only face to spell that condition out in its accessible name (the
// accessible name below does exactly this). Asserting over the entire button conflated "the visible
// text was replaced" with "the screen reader was told", and only the first is the rule.
assert.doesNotMatch(circulationButton.match(/<span>[\s\S]*?<\/span>/)?.[0] || "",
  /Läuft|Steht|Prüft|Nicht verfügbar/,
  "the moment status belongs to the diagnostic tongue, not in place of the pump name");
assert.match(circulationButton, /aria-label="[^"]*Example circulation pump · Läuft"/,
  "a row whose face carries its condition in colour must say that condition in its accessible name");
let circulationTongue = circulationHtml.match(/id="diagnostics-circulation-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(circulationTongue, /<span class="vdesc-n">Erkannter Zustand<\/span> Läuft/);
assert.doesNotMatch(circulationTongue, /class="vhist/,
  "a collapsed circulation tongue must not rebuild a cached history on every poll");
S.descOpen.add("diagnostics:circulation");
circulationHtml = sandbox.__renderCirculation();
circulationTongue = circulationHtml.match(/id="diagnostics-circulation-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(circulationTongue, /<div class="vhist vhist-state">TIMELINE/,
  "the current assessment and its categorical history must share the information tongue");

S.status.circulation_source = {
  configured: true, name: "Example circulation pump", has_value: false, error: "timeout",
};
circulationHtml = sandbox.__renderCirculation();
circulationButton = circulationHtml.match(/<button[^>]*data-act="circulation"[\s\S]*?<\/button>/)?.[0] || "";
circulationTongue = circulationHtml.match(/id="diagnostics-circulation-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(circulationButton, /Example circulation pump/,
  "an MQTT outage must not replace the configured pump identity in the row header");
assert.match(circulationTongue, /<span class="vdesc-n">Erkannter Zustand<\/span> Nicht verfügbar/,
  "an unavailable source without a power sample must still expose its current status inside");

// Gas-comparison settings row shares the diagnostics card and split-tongue pattern.
let gasButton = circulationHtml.match(/<button[^>]*data-act="gas-comparison"[\s\S]*?<\/button>/)?.[0] || "";
let gasTongue = circulationHtml.match(/id="diagnostics-gas-comparison-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(gasButton, /<span>Keine Tarife<\/span>/,
  "an unconfigured gas comparison must show its compact setup label");
assert.match(gasButton, /\bdim\b/, "unconfigured tariffs stay subdued");
assert.match(gasTongue, /Nur lokale Tarifwerte/,
  "collapsed/unconfigured gas comparison still keeps its settings explanation in the tongue");

S.status.gas_comparison = {
  configured: true, elec_price: 0.32, gas_price: 0.11, gas_efficiency_pct: 88,
  break_even_az: 2.56, currency: "EUR",
};
circulationHtml = sandbox.__renderCirculation();
gasButton = circulationHtml.match(/<button[^>]*data-act="gas-comparison"[\s\S]*?<\/button>/)?.[0] || "";
gasTongue = circulationHtml.match(/id="diagnostics-gas-comparison-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(gasButton, /<span>2,56<\/span>/,
  "configured tariffs summarize break-even AZ without repeating 88% Hs");
assert.match(gasButton, /\bok\b/, "configured tariffs carry ok tone");
assert.doesNotMatch(gasTongue, /Wirkungsgrad/, "Settings tongue omits fixed efficiency note field");
assert.match(gasTongue, /<span class="vdesc-n">Strompreis<\/span> 0,3200 EUR\/kWh/);
assert.match(gasTongue, /<span class="vdesc-n">Gaspreis<\/span> 0,1100 EUR\/kWh/);
assert.match(gasTongue, /<span class="vdesc-n">Break-even-AZ<\/span> 2,56/);
assert.doesNotMatch(circulationHtml, /data-act="power-meter"/,
  "power-meter row must no longer render in the diagnostics settings card");

// Protocol and Firmware use the same info-tongue contract while keeping their independent controls.
S.status = {
  version: "1.0.0-dev.317", pins_avail: [1, 2, 4, 5],
  hp: { connected: true, proto: "I", rx: 2, tx: 1, last_ok_s: 0 },
  diagnostics: { enabled: true },
  ota: { channel: "dev" }, ui: { lang: "auto" },
  board: {}, env3: {}, sys: {}, mqtt: {},
};
S.descOpen.clear();
let html = sandbox.__renderEsp32();
for (const key of ["protocol:link", "protocol:framing", "protocol:rx", "protocol:tx",
                   "firmware:version", "firmware:channel", "firmware:language",
                   "firmware:diagnostics"]) {
  assert.match(html, new RegExp(`data-desc="${key}"`), `${key} must expose an information tongue`);
}
for (const key of ["link", "framing", "rx", "tx"]) {
  assert.match(html, new RegExp(`<button class="vrow settings-whole-info-row settings-info-row"[^>]*data-desc="protocol:${key}"[\\s\\S]*class="settings-info-value`),
    `locked protocol ${key} has no second action, so tapping its value must toggle its tongue`);
}
S.status.hp = { connected: false, proto: "", rx: 2, tx: 1, last_ok_s: 31 };
html = sandbox.__renderEsp32();
assert.match(html, /<button class="vrow settings-whole-info-row settings-info-row"[^>]*data-desc="protocol:link"[\s\S]*<span class="settings-info-value vrow-val settings-wrap err">Offline<\/span><\/button>/,
  "the reported Offline value must live inside the full-row heat-pump-link accordion button");
for (const explanation of ["Verbindungs-Erklärung", "Protokoll-Erklärung", "RX-Erklärung", "TX-Erklärung",
                           "Firmware-Erklärung", "Kanal-Erklärung", "Sprach-Erklärung"])
  assert.ok(html.includes(explanation), `Protocol/Firmware explanation must include: ${explanation}`);

// A concrete board is authoritative for the editable X10A inventory. Old XIAO defaults may still
// be cached immediately after Atom was selected, but they must neither reappear as options nor make
// both selects fall onto the same first GPIO. The first interaction submits the distinct suggested
// board pair. Custom keeps the legacy off-list value because its physical headers are unknowable.
S.status.board = { preset_id: "m5stack_atoms3_lite" };
S.status.pins_avail = [1, 2, 5, 6, 7, 8, 38];
S.status.hp = { connected: false, proto: "", rx: 44, tx: 43, last_ok_s: 31 };
html = sandbox.__renderEsp32();
let rxSelect = html.match(/<select[^>]*id="e32Rx"[\s\S]*?<\/select>/)?.[0] || "";
let txSelect = html.match(/<select[^>]*id="e32Tx"[\s\S]*?<\/select>/)?.[0] || "";
assert.doesNotMatch(rxSelect, /value="44"|value="43"/,
  "Atom RX options must not resurrect XIAO-only cached pins");
assert.doesNotMatch(txSelect, /value="44"|value="43"/,
  "Atom TX options must not resurrect XIAO-only cached pins");
assert.match(rxSelect, /value="1" selected/, "an invalid cached pair must start at Atom GPIO1 for RX");
assert.match(txSelect, /value="2" selected/, "the suggested Atom TX must stay distinct from RX");

S.status.pins_avail = [5, 6, 7, 8, 38]; // ENV III owns Grove GPIO2/1
html = sandbox.__renderEsp32();
rxSelect = html.match(/<select[^>]*id="e32Rx"[\s\S]*?<\/select>/)?.[0] || "";
txSelect = html.match(/<select[^>]*id="e32Tx"[\s\S]*?<\/select>/)?.[0] || "";
assert.doesNotMatch(rxSelect + txSelect, /value="[12]"/,
  "enabled ENV III pins must stay absent from both X10A selectors");
assert.match(rxSelect, /value="5" selected/);
assert.match(txSelect, /value="6" selected/);

S.status.board = { preset_id: "custom" };
S.status.pins_avail = [1, 2, 5];
html = sandbox.__renderEsp32();
rxSelect = html.match(/<select[^>]*id="e32Rx"[\s\S]*?<\/select>/)?.[0] || "";
txSelect = html.match(/<select[^>]*id="e32Tx"[\s\S]*?<\/select>/)?.[0] || "";
assert.match(rxSelect, /value="44" selected/, "Custom must retain its explicitly stored off-list RX pin");
assert.match(txSelect, /value="43" selected/, "Custom must retain its explicitly stored off-list TX pin");

assert.match(html, /id="e32Chan"[^]*<option value="dev" selected>Development<\/option>/,
  "the update selector must survive the split explanation row");
assert.match(html, /id="e32Lang"[^]*<option value="auto" selected>Browser<\/option>/,
  "the language selector must survive the split explanation row");
assert.doesNotMatch(html, /e32DynamicLwt|role="switch"/,
  "the retired heating-curve mode switch must stay absent");
assert.match(html, /id="e32Diagnostics"[^]*<option value="x10a" selected>X10A<\/option>/,
  "the Firmware card must show the enabled master diagnostics source selection");
S.status.diagnostics = { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["modbus"] };
html = sandbox.__renderEsp32();
const diagSelect = html.match(/<select[^>]*id="e32Diagnostics"[\s\S]*?<\/select>/)?.[0] || "";
assert.match(diagSelect, /<option value="off">Aus<\/option>/,
  "Modbus-only diagnostics selector must retain Off");
assert.match(diagSelect, /<option value="modbus" selected>Modbus<\/option>/,
  "Modbus-only diagnostics selector must select Modbus");
assert.doesNotMatch(diagSelect, /value="x10a"/,
  "unavailable X10A option must stay absent when only Modbus is available");
S.status.diagnostics = { enabled: true, source: "modbus", effective_source: "x10a", available_sources: [] };
html = sandbox.__renderEsp32();
const fallbackDiagSelect = html.match(/<select[^>]*id="e32Diagnostics"[\s\S]*?<\/select>/)?.[0] || "";
assert.match(fallbackDiagSelect, /<option value="x10a" selected>X10A<\/option>/,
  "empty available_sources must fall back to X10A instead of unconfigured Modbus");
assert.doesNotMatch(fallbackDiagSelect, /value="modbus"/,
  "unconfigured Modbus must not reappear when available_sources is empty");
S.status.diagnostics = { enabled: true };
assert.ok(html.indexOf("card.fw_title") < 0, "translated card titles must be resolved");
assert.match(html, /data-act="circulation"/, "the circulation editor stays reachable when diagnostics is on");
S.status.diagnostics.enabled = false;
html = sandbox.__renderEsp32();
assert.match(html, /id="e32Diagnostics"[^]*<option value="off" selected>Aus<\/option>/,
  "off must be a visible persisted Firmware setting");
assert.doesNotMatch(html, /<div class="section-label">Anlagendiagnose/,
  "dependent diagnostic cards must be absent while the master setting is off");

console.log("settings source tongue use-cases: ok");
