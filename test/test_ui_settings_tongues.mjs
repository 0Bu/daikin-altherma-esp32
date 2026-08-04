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
  "dyn.room_sources": "Raumtemperaturquellen",
  "dyn.weather": "Wetterprognose",
  "dyn.strategy": "Regelstrategie",
  "dyn.inactive": "Nicht aktiv",
  "dyn.safety": "Sicherheit & Ausgabe",
  "dyn.read_only": "Nur lesend",
  "dyn.mode_help": "Betriebsart-Erklärung",
  "dyn.strategy_help": "Strategie-Erklärung",
  "dyn.safety_help": "Sicherheits-Erklärung",
  "dyn.card": "Dynamische Vorlaufregelung",
  "dyn.capture": "Datenerfassung",
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
  "wx.detail.fresh": "Die Prognose wurde erfolgreich abgerufen.",
  "wx.detail.fetching": "Der ESP32 ruft gerade neue Prognosedaten ab.",
  "wx.detail.stale": "Der letzte erfolgreiche Abruf ist zu alt; die Werte werden nur zur Diagnose angezeigt.",
  "wx.detail.unavailable": "Der letzte Abruf ist fehlgeschlagen; ein älterer Wert wird, falls vorhanden, nur zur Diagnose angezeigt.",
  "wx.detail.waiting": "Es wurde noch keine Prognose empfangen.",
  "wx.detail.temperature_label": "Temperatur:",
  "wx.detail.temperature": "{0} °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden.",
  "wx.detail.solar_label": "Sonnenenergie:",
  "wx.detail.solar": "{0} Wh/m² ist die Summe der prognostizierten kurzwelligen Sonnenenergie je Quadratmeter im selben Zeitraum.",
  "wx.detail.source_label": "Quelle:",
  "wx.detail.source": "Open-Meteo · DWD-ICON-Modell. Nur Beobachtung.",
  "wx.hint": "Wetter-Erklärung",
  "env.title": "Außensensor",
  "env.collecting": "Messwerte werden erfasst",
  "env.unavailable": "Sensor nicht erreichbar",
};
const t = (key, ...args) => (labels[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const S = { status: {}, descOpen: new Set() };
const descNoteHtml = (lead, text) =>
  `<div class="vdesc-p"><span class="vdesc-n">${esc(lead)}</span> ${esc(text)}</div>`;
const sandbox = vm.createContext({ S, LANG: "de", t, esc, descNoteHtml, setTimeout, clearTimeout });
vm.runInContext(`${source}\nthis.__renderDynamic = dynamicControlCardHtml;`, sandbox,
  { filename: "main/www/js/dashboard.js" });

S.status = {
  mqtt: { configured: true },
  reference_temperature: {
    configured: true, has_value: true, temperature_c: 25.1, age_s: 17, fresh: true,
  },
  weather_forecast: {
    configured: true, has_value: true, outdoor_mean_2h_c: 22.6,
    solar_energy_2h_wh_m2: 0, fresh: true,
  },
  env3: {
    supported: true, enabled: true, fresh: true,
    temperature_c: 20.2, humidity_pct: 46, pressure_hpa: 1009,
  },
};
let html = sandbox.__renderDynamic();
assert.equal((html.match(/class="vdesc-body settings-source-tongue"/g) || []).length, 5,
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
for (const [id, summary] of [
  ["dynamic-ref-temp-status", "1 Quelle · 25,1 °C · vor 17 s"],
  ["dynamic-weather-status", "Open-Meteo · 22,6 °C / 2 h · 0 Wh/m²"],
]) {
  assert.match(html, new RegExp(`class="settings-source-summary ok" id="${id}">${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`),
    `healthy configured summary must use its green tongue: ${summary}`);
}
const weatherTongue = html.match(/<div class="vdesc-body settings-source-tongue" id="dynamic-weather-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((weatherTongue.match(/class="vdesc-p"/g) || []).length, 5,
  "the healthy weather tongue must keep four live-evidence paragraphs plus its configuration help");
assert.match(weatherTongue, /<span class="vdesc-n">Status:<\/span> Aktuell — Die Prognose wurde erfolgreich abgerufen\./,
  "weather must explain its freshness instead of presenting an unexplained green line");
assert.match(weatherTongue, /<span class="vdesc-n">Temperatur:<\/span> 22,6 °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden\./,
  "weather must define the displayed two-hour temperature mean");
assert.match(weatherTongue, /<span class="vdesc-n">Sonnenenergie:<\/span> 0 Wh\/m² ist die Summe der prognostizierten kurzwelligen Sonnenenergie je Quadratmeter im selben Zeitraum\./,
  "weather must define the accumulated solar-energy value, including a valid zero");
assert.match(weatherTongue, /<span class="vdesc-n">Quelle:<\/span> Open-Meteo · DWD-ICON-Modell\. Nur Beobachtung\./,
  "weather must state provenance and its observation-only boundary");
assert.match(weatherTongue, /Wetter-Erklärung/,
  "weather configuration guidance must move from the popup into the tongue");
const roomButton = html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(roomButton, /<span>1 Quelle<\/span>/,
  "the compact room-source value must be the popup action");
assert.doesNotMatch(roomButton, /25,1 °C|vor 17 s/,
  "the configured reading must no longer be duplicated inside the editable header");
const weatherButton = html.match(/<button[^>]*data-act="weather"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(weatherButton, /<span>Open-Meteo<\/span>/,
  "the compact weather-provider value must be the popup action");
for (const explanation of ["Betriebsart-Erklärung", "Raumquellen-Erklärung", "Wetter-Erklärung", "Strategie-Erklärung", "Sicherheits-Erklärung"])
  assert.ok(html.includes(explanation), `dynamic explanation tongue must include: ${explanation}`);

S.descOpen.add("dynamic:strategy");
html = sandbox.__renderDynamic();
assert.match(html, /class="vitem open dynamic-info-item"[\s\S]*data-desc="dynamic:strategy"[^>]*aria-expanded="true"/,
  "an opened dynamic explanation must persist across status-driven rebuilds");
S.descOpen.clear();

S.status.reference_temperature = {};
S.status.weather_forecast = {};
html = sandbox.__renderDynamic();
assert.equal((html.match(/class="vdesc-body settings-source-tongue"/g) || []).length, 5,
  "unconfigured sources must retain their explanation tongues");
assert.equal((html.match(/<span>Nicht konfiguriert<\/span>/g) || []).length, 2,
  "each empty editable source must expose Not configured as its popup value");
assert.ok(html.includes("Raumquellen-Erklärung") && html.includes("Wetter-Erklärung"),
  "unconfigured sources must still explain how their inputs work");

S.status.reference_temperature = { configured: true, error: "bad payload" };
S.status.weather_forecast = { configured: true, fetching: true };
html = sandbox.__renderDynamic();
assert.match(html, /settings-source-summary err" id="dynamic-ref-temp-status">1 Quelle · Eingabefehler</,
  "a configured source error must keep the tongue and switch its semantic colour");
assert.match(html, /id="dynamic-weather-status"[^]*<span class="vdesc-n">Status:<\/span> Aktualisierung läuft — Der ESP32 ruft gerade neue Prognosedaten ab\./,
  "a configured weather fetch must keep the tongue and explain the in-progress state");
assert.match(html, /settings-source-summary warn" id="dynamic-weather-status">Wird geladen</,
  "a configured weather fetch must keep the tongue and switch to warning colour");
assert.doesNotMatch(html, /data-act="env3"|dynamic-env3-status/,
  "ENV III configuration must live exclusively in Board Hardware");

S.status.weather_forecast = {
  configured: true, has_value: true, outdoor_mean_2h_c: -3.2,
  solar_energy_2h_wh_m2: 18, fresh: false,
};
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-status"[^]*<span class="vdesc-n">Status:<\/span> Veraltet — Der letzte erfolgreiche Abruf ist zu alt;/,
  "a stale forecast must identify retained values as diagnostic rather than current");
assert.match(html, /<span class="vdesc-n">Temperatur:<\/span> -3,2 °C/,
  "a stale forecast must keep its last values visible for diagnosis");

S.status.weather_forecast = { configured: true, has_value: false, error: "timeout" };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-status"[^]*<span class="vdesc-n">Status:<\/span> Nicht verfügbar — Der letzte Abruf ist fehlgeschlagen;/,
  "a failed forecast must explain its unavailable state");
assert.doesNotMatch(html, /<span class="vdesc-n">Temperatur:<\/span>|<span class="vdesc-n">Sonnenenergie:<\/span>/,
  "an unavailable forecast without a sample must not invent value explanations");

console.log("settings source tongue use-cases: ok");
