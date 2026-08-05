// Dynamic-control rows use the real production renderer. Every label owns a collapsible information
// tongue, while only the compact room/weather values on the right open editors. This guards the
// split-action contract, source status presentation and all configured/unconfigured use-cases.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["dashboard.js"]);
const labels = {
  "dyn.mode": "Betriebsart",
  "dyn.observe": "Beobachten",
  "dyn.off": "Aus",
  "dyn.room_sources": "Raumtemperaturquellen",
  "dyn.weather": "Wetterprognose",
  "dyn.strategy": "Regelstrategie",
  "dyn.shadow_strategy": "P-Regler · Schatten",
  "dyn.inactive": "Nicht aktiv",
  "dyn.safety": "Sicherheit & Ausgabe",
  "dyn.read_only": "Nur lesend",
  "dyn.mode_help": "Betriebsart-Erklärung",
  "dyn.off_help": "Erfassung ausgeschaltet",
  "dyn.strategy_help": "Strategie-Erklärung",
  "dyn.strategy_off_help": "Strategie ausgeschaltet",
  "dyn.safety_help": "Sicherheits-Erklärung",
  "dyn.card": "Dynamische Vorlaufregelung",
  "dyn.not_configured": "Nicht konfiguriert",
  "dyn.one_source": "1 Quelle",
  "dyn.input_error": "Eingabefehler",
  "ref.title": "Raumtemperaturquelle",
  "ref.ago": "vor {0} s",
  "ref.now": "jetzt",
  "ref.waiting": "Warte auf Daten",
  "ref.retained": "retained",
  "ref.stale": "veraltet",
  "ref.error": "Fehler",
  "ref.hint": "Raumquellen-Erklärung",
  "ref.detail.status_label": "Status:",
  "ref.status.fresh": "Aktuell",
  "ref.status.stale": "Veraltet",
  "ref.status.waiting": "Wartet",
  "ref.status.unavailable": "Nicht verfügbar",
  "ref.status.inactive": "Aus",
  "ref.detail.fresh": "Messwert geprüft.",
  "ref.detail.stale": "Messwert wird nicht verwendet.",
  "ref.detail.waiting": "Noch kein Messwert.",
  "ref.detail.inactive": "Erfassung durch Firmware-Schalter ausgeschaltet.",
  "ref.detail.error": "Messwert verworfen.",
  "ref.detail.temperature_label": "Raumtemperatur:",
  "ref.detail.temperature": "{0} °C ist die aktuelle Raumtemperatur.",
  "ref.detail.setpoint_label": "Solltemperatur:",
  "ref.detail.setpoint": "{0} °C ist der Raumsollwert.",
  "ref.detail.age_label": "Alter:",
  "ref.detail.age": "Messwert {0} übernommen.",
  "ref.detail.source_label": "Quelle:",
  "ref.detail.source": "{0} via MQTT.",
  "wx.title": "Wetterprognose",
  "wx.fetching": "Wird geladen",
  "wx.waiting": "Warte auf Daten",
  "wx.error": "Fehler",
  "wx.detail.status": "Status:",
  "wx.status.fresh": "Aktuell",
  "wx.status.fetching": "Aktualisierung läuft",
  "wx.status.stale": "Veraltet",
  "wx.status.unavailable": "Nicht verfügbar",
  "wx.status.waiting": "Wartet",
  "wx.status.inactive": "Aus",
  "wx.detail.fresh": "Die Prognose wurde erfolgreich abgerufen.",
  "wx.detail.fetching": "Der ESP32 ruft gerade neue Prognosedaten ab.",
  "wx.detail.stale": "Der letzte erfolgreiche Abruf ist zu alt; die Werte werden nur zur Diagnose angezeigt.",
  "wx.detail.unavailable": "Der letzte Abruf ist fehlgeschlagen; ein älterer Wert wird, falls vorhanden, nur zur Diagnose angezeigt.",
  "wx.detail.waiting": "Es wurde noch keine Prognose empfangen.",
  "wx.detail.inactive": "Prognoseerfassung ausgeschaltet.",
  "wx.detail.temperature_label": "Temperatur:",
  "wx.detail.temperature": "{0} °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden.",
  "wx.detail.solar_label": "Globalstrahlung:",
  "wx.detail.solar": "{0} Wh/m² ist die prognostizierte Globalstrahlung auf eine horizontale Fläche im selben Zweistundenzeitraum.",
  "wx.detail.source_label": "Quelle:",
  "wx.detail.source": "Open-Meteo · DWD ICON Seamless. Nur Beobachtung; die Prognose verändert die Wärmepumpensteuerung nicht.",
  "wx.hint.configured": "Wetter-Konfiguration",
  "wx.hint.setup": "Wetter-Einrichtung",
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
  "card.hplink_help": "Verbindungs-Erklärung",
  "card.protocol_help": "Protokoll-Erklärung",
  "card.rxpin_help": "RX-Erklärung",
  "card.txpin_help": "TX-Erklärung",
  "card.firmware_help": "Firmware-Erklärung",
  "card.channel_help": "Kanal-Erklärung",
  "card.language_help": "Sprach-Erklärung",
  "card.hardware": "Hardware",
  "card.uptime": "Laufzeit",
  "card.freeheap": "Freier Speicher",
  "card.maxalloc": "Größter Block",
  "chan.release": "Release",
  "chan.dev": "Development",
  "lang.auto": "Browser",
  "lang.de": "Deutsch",
  "lang.en": "English",
  "dyn.enable": "Dynamische Vorlaufregelung",
  "dyn.enable_help": "Standardmäßig aus.",
  "aria.ota": "Nach Firmware-Updates suchen",
  "ota.title_check": "Nach Updates suchen",
};
const t = (key, ...args) => (labels[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const S = { status: {}, descOpen: new Set() };
const descNoteHtml = (lead, text) =>
  `<div class="vdesc-p"><span class="vdesc-n">${esc(lead)}</span> ${esc(text)}</div>`;
const sandbox = vm.createContext({
  S, LANG: "de", t, esc, descNoteHtml, setTimeout, clearTimeout,
  MODEL_DESCRIPTIONS: {}, hasHist: () => false,
});
vm.runInContext(`${source}\nthis.__renderDynamic = dynamicControlCardHtml; this.__renderEsp32 = esp32CardHtml;`, sandbox,
  { filename: "main/www/js/dashboard.js" });

S.status = {
  mqtt: { configured: true },
  reference_temperature: {
    configured: true, name: "Example rm", has_value: true, temperature_c: 25.1,
    has_setpoint: true, setpoint_c: 22.0, age_s: 17, fresh: true,
  },
  weather_forecast: {
    configured: true, has_value: true, outdoor_mean_2h_c: 22.6,
    solar_energy_2h_wh_m2: 0, fresh: true,
  },
  dynamic_lwt: { mode: "shadow" },
  env3: {
    supported: true, enabled: true, fresh: true,
    temperature_c: 20.2, humidity_pct: 46, pressure_hpa: 1009,
  },
};
let html = sandbox.__renderDynamic();
assert.doesNotMatch(html, /section-badge|Experimentell/,
  "the enabled bottom card must not carry an experimental pill");
assert.equal((html.match(/class="vdesc-body settings-info-tongue"/g) || []).length, 5,
  "all five dynamic-control rows must render an information tongue");
for (const key of ["mode", "room-sources", "weather", "strategy", "safety"]) {
  const infoButton = html.match(new RegExp(`<button class="settings-split-info[^"]*"[^>]*data-desc="dynamic:${key}"[\\s\\S]*?<\\/button>`))?.[0] || "";
  assert.match(infoButton, /aria-expanded="false"/,
    `${key} label must be a closed explanation action on first render`);
  assert.doesNotMatch(infoButton, /data-act=/,
    `${key} label must never open a configuration popup`);
}
assert.equal((html.match(/class="settings-split-action dynamic-config-open/g) || []).length, 2,
  "only room-temperature and weather values may be popup actions");
assert.equal((html.match(/class="settings-split-value/g) || []).length, 3,
  "mode, strategy and safety values must remain non-interactive readouts");
assert.doesNotMatch(html, /settings-source-summary|1 Quelle · 25,1 °C|Open-Meteo · 22,6 °C \/ 2 h/,
  "obsolete green summary lines must not duplicate values inside the tongues");
const roomTongue = html.match(/<div class="vdesc-body settings-info-tongue" id="dynamic-room-sources-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((roomTongue.match(/class="vdesc-p"/g) || []).length, 6,
  "room tongue must explain status, current value, target, age, source and configuration");
assert.match(roomTongue, /<span class="vdesc-n">Raumtemperatur:<\/span> 25,1 °C ist die aktuelle Raumtemperatur\./);
assert.match(roomTongue, /<span class="vdesc-n">Solltemperatur:<\/span> 22 °C ist der Raumsollwert\./);
assert.match(roomTongue, /<span class="vdesc-n">Alter:<\/span> Messwert vor 17 s übernommen\./);
assert.match(roomTongue, /<span class="vdesc-n">Quelle:<\/span> Example rm via MQTT\./);
const weatherTongue = html.match(/<div class="vdesc-body settings-info-tongue" id="dynamic-weather-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((weatherTongue.match(/class="vdesc-p"/g) || []).length, 5,
  "the healthy weather tongue must keep four live-evidence paragraphs plus its configuration help");
assert.match(weatherTongue, /<span class="vdesc-n">Status:<\/span> Aktuell — Die Prognose wurde erfolgreich abgerufen\./,
  "weather must explain its freshness instead of presenting an unexplained green line");
assert.match(weatherTongue, /<span class="vdesc-n">Temperatur:<\/span> 22,6 °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden\./,
  "weather must define the displayed two-hour temperature mean");
assert.match(weatherTongue, /<span class="vdesc-n">Globalstrahlung:<\/span> 0 Wh\/m² ist die prognostizierte Globalstrahlung auf eine horizontale Fläche im selben Zweistundenzeitraum\./,
  "weather must define the accumulated global horizontal irradiation, including a valid zero");
assert.match(weatherTongue, /<span class="vdesc-n">Quelle:<\/span> Open-Meteo · DWD ICON Seamless\. Nur Beobachtung; die Prognose verändert die Wärmepumpensteuerung nicht\./,
  "weather must state provenance and its observation-only boundary");
assert.match(weatherTongue, /Wetter-Konfiguration/,
  "configured weather guidance must remain in the tongue");
assert.doesNotMatch(weatherTongue, /Wetter-Einrichtung/,
  "configured weather must not repeat coordinate-entry guidance");
const roomButton = html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(roomButton, /<span>1 Quelle<\/span>/,
  "the compact room-source value must be the popup action");
assert.doesNotMatch(roomButton, /25,1 °C|vor 17 s/,
  "the configured reading must no longer be duplicated inside the editable header");
const weatherButton = html.match(/<button[^>]*data-act="weather"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(weatherButton, /<span>Open-Meteo<\/span>/,
  "the compact weather-provider value must be the popup action");
for (const explanation of ["Betriebsart-Erklärung", "Raumquellen-Erklärung", "Wetter-Konfiguration", "Strategie-Erklärung", "Sicherheits-Erklärung"])
  assert.ok(html.includes(explanation), `dynamic explanation tongue must include: ${explanation}`);

S.descOpen.add("dynamic:strategy");
html = sandbox.__renderDynamic();
assert.match(html, /class="vitem open settings-info-item dynamic-info-item"[\s\S]*data-desc="dynamic:strategy"[^>]*aria-expanded="true"/,
  "an opened dynamic explanation must persist across status-driven rebuilds");
S.descOpen.clear();

S.status.reference_temperature = {};
S.status.weather_forecast = {};
html = sandbox.__renderDynamic();
assert.equal((html.match(/class="vdesc-body settings-info-tongue"/g) || []).length, 5,
  "unconfigured sources must retain their explanation tongues");
assert.equal((html.match(/<span>Nicht konfiguriert<\/span>/g) || []).length, 2,
  "each empty editable source must expose Not configured as its popup value");
assert.ok(html.includes("Raumquellen-Erklärung") && html.includes("Wetter-Einrichtung"),
  "unconfigured sources must still explain how their inputs work");
assert.doesNotMatch(html, /Wetter-Konfiguration/,
  "unconfigured weather must show setup guidance instead of configured-source guidance");

S.status.reference_temperature = { configured: true, error: "bad payload" };
S.status.weather_forecast = { configured: true, fetching: true };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Aktualisierung läuft — Der ESP32 ruft gerade neue Prognosedaten ab\./,
  "a configured weather fetch must keep the tongue and explain the in-progress state");
assert.match(html, /id="dynamic-room-sources-detail"[^]*<span class="vdesc-n">Status:<\/span> Nicht verfügbar — Messwert verworfen\./,
  "a configured source error must be explained in its tongue");
assert.doesNotMatch(html, /data-act="env3"|dynamic-env3-status/,
  "ENV III configuration must live exclusively in Board Hardware");

S.status.weather_forecast = {
  configured: true, has_value: true, outdoor_mean_2h_c: -3.2,
  solar_energy_2h_wh_m2: 18, fresh: false,
};
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Veraltet — Der letzte erfolgreiche Abruf ist zu alt;/,
  "a stale forecast must identify retained values as diagnostic rather than current");
assert.match(html, /<span class="vdesc-n">Temperatur:<\/span> -3,2 °C/,
  "a stale forecast must keep its last values visible for diagnosis");

S.status.weather_forecast = { configured: true, has_value: false, error: "timeout" };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Nicht verfügbar — Der letzte Abruf ist fehlgeschlagen;/,
  "a failed forecast must explain its unavailable state");
assert.doesNotMatch(html, /<span class="vdesc-n">Temperatur:<\/span>|<span class="vdesc-n">Sonnenenergie:<\/span>/,
  "an unavailable forecast without a sample must not invent value explanations");

S.status.dynamic_lwt = { mode: "off" };
S.status.reference_temperature = {
  configured: true, name: "Example rm", has_value: true, temperature_c: 25.1,
  has_setpoint: true, setpoint_c: 22, age_s: 17, fresh: true,
};
S.status.weather_forecast = {
  configured: true, has_value: true, outdoor_mean_2h_c: 22.6,
  solar_energy_2h_wh_m2: 514, fresh: true,
};
html = sandbox.__renderDynamic();
assert.equal(html, "", "OFF must hide the complete experimental controller card");

// Protocol and Firmware use the same info-tongue contract while keeping their independent controls.
S.status = {
  version: "1.0.0-dev.317", pins_avail: [1, 2, 4, 5],
  hp: { connected: true, proto: "I", rx: 2, tx: 1, last_ok_s: 0 },
  ota: { channel: "dev" }, ui: { lang: "auto" }, dynamic_lwt: { mode: "off" },
  board: {}, env3: {}, sys: {}, mqtt: {}, reference_temperature: {}, weather_forecast: {},
};
S.descOpen.clear();
html = sandbox.__renderEsp32();
for (const key of ["protocol:link", "protocol:framing", "protocol:rx", "protocol:tx",
                   "firmware:version", "firmware:channel", "firmware:language", "firmware:dynamic-lwt"]) {
  assert.match(html, new RegExp(`data-desc="${key}"`), `${key} must expose an information tongue`);
}
for (const explanation of ["Verbindungs-Erklärung", "Protokoll-Erklärung", "RX-Erklärung", "TX-Erklärung",
                           "Firmware-Erklärung", "Kanal-Erklärung", "Sprach-Erklärung", "Standardmäßig aus."])
  assert.ok(html.includes(explanation), `Protocol/Firmware explanation must include: ${explanation}`);
assert.match(html, /id="e32Chan"[^]*<option value="dev" selected>Development<\/option>/,
  "the update selector must survive the split explanation row");
assert.match(html, /id="e32Lang"[^]*<option value="auto" selected>Browser<\/option>/,
  "the language selector must survive the split explanation row");
assert.match(html, /id="e32DynamicLwt" role="switch" aria-label="Dynamische Vorlaufregelung"/,
  "the firmware card must contain an unchecked default-OFF switch");
assert.doesNotMatch(html, /<div class="section-label">Dynamische Vorlaufregelung/,
  "OFF must leave only the Firmware switch and hide the experimental card");
assert.ok(html.indexOf("card.fw_title") < 0, "translated card titles must be resolved");
S.status.dynamic_lwt = { mode: "shadow" };
html = sandbox.__renderEsp32();
assert.match(html, /id="e32DynamicLwt" role="switch" checked/,
  "SHADOW must render the Firmware switch as enabled");
assert.ok(html.indexOf("<div class=\"section-label\">Firmware") <
          html.indexOf("<div class=\"section-label\">Dynamische Vorlaufregelung"),
  "SHADOW must reveal the experimental controller card after Firmware at the bottom");

console.log("settings source tongue use-cases: ok");
