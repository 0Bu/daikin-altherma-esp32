// Dynamic-control source summaries use the real production renderer. Configured sources put their
// state in a permanent info tongue while the row remains the modal opener; empty sources stay
// compact. This guards the mobile layout contract as well as all three source use-cases.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["dashboard.js"]);
const labels = {
  "dyn.mode": "Betriebsart",
  "dyn.observe": "Beobachten",
  "dyn.room_sources": "Raumtemperaturquellen",
  "dyn.weather": "Wetterprognose",
  "dyn.outdoor": "Außenmessungen",
  "dyn.strategy": "Regelstrategie",
  "dyn.inactive": "Nicht aktiv",
  "dyn.safety": "Sicherheit & Ausgabe",
  "dyn.read_only": "Nur lesend",
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
  "env.title": "Außensensor",
  "env.collecting": "Messwerte werden erfasst",
  "env.unavailable": "Sensor nicht erreichbar",
};
const t = (key, ...args) => (labels[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const S = { status: {} };
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
assert.equal((html.match(/class="vdesc-body settings-source-tongue"/g) || []).length, 3,
  "all three configured source states must render in permanent info tongues");
for (const action of ["ref-temp", "weather", "env3"]) {
  assert.match(html, new RegExp(`data-act="${action}"[^>]*aria-describedby="dynamic-${action}-status"`),
    `${action} header must remain the accessible modal opener for its tongue`);
  assert.match(html, new RegExp(`class="vdesc-body settings-source-tongue" id="dynamic-${action}-status"`),
    `${action} header description must name the complete tongue`);
}
for (const [id, summary] of [
  ["dynamic-ref-temp-status", "1 Quelle · 25,1 °C · vor 17 s"],
  ["dynamic-env3-status", "20,2 °C · 46 % · 1.009 hPa"],
]) {
  assert.match(html, new RegExp(`id="${id}"[^]*<span class="settings-source-summary ok">${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`),
    `healthy configured summary must use its green tongue: ${summary}`);
}
const weatherTongue = html.match(/<div class="vdesc-body settings-source-tongue" id="dynamic-weather-status">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((weatherTongue.match(/class="vdesc-p"/g) || []).length, 4,
  "the healthy weather tongue must use the ordinary four-paragraph explainer structure");
assert.match(weatherTongue, /<span class="vdesc-n">Status:<\/span> Aktuell — Die Prognose wurde erfolgreich abgerufen\./,
  "weather must explain its freshness instead of presenting an unexplained green line");
assert.match(weatherTongue, /<span class="vdesc-n">Temperatur:<\/span> 22,6 °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden\./,
  "weather must define the displayed two-hour temperature mean");
assert.match(weatherTongue, /<span class="vdesc-n">Sonnenenergie:<\/span> 0 Wh\/m² ist die Summe der prognostizierten kurzwelligen Sonnenenergie je Quadratmeter im selben Zeitraum\./,
  "weather must define the accumulated solar-energy value, including a valid zero");
assert.match(weatherTongue, /<span class="vdesc-n">Quelle:<\/span> Open-Meteo · DWD-ICON-Modell\. Nur Beobachtung\./,
  "weather must state provenance and its observation-only boundary");
const roomButton = html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "";
assert.doesNotMatch(roomButton, /25,1 °C|vor 17 s/,
  "the configured reading must no longer be duplicated inside the editable header");

S.status.reference_temperature = {};
S.status.weather_forecast = {};
S.status.env3.enabled = false;
html = sandbox.__renderDynamic();
assert.doesNotMatch(html, /settings-source-tongue/,
  "unconfigured sources must not allocate permanent info tongues");
assert.equal((html.match(/dynamic-source-inline/g) || []).length, 3,
  "all unconfigured source rows must retain the compact phone layout");
assert.equal((html.match(/Nicht konfiguriert/g) || []).length, 3,
  "each empty supported source must state that it is not configured");

S.status.reference_temperature = { configured: true, error: "bad payload" };
S.status.weather_forecast = { configured: true, fetching: true };
S.status.env3 = { supported: true, enabled: true, fresh: false, error: "collecting" };
html = sandbox.__renderDynamic();
assert.match(html, /settings-source-summary err[^>]*>1 Quelle · Eingabefehler</,
  "a configured source error must keep the tongue and switch its semantic colour");
assert.match(html, /id="dynamic-weather-status"[^]*<span class="vdesc-n">Status:<\/span> Aktualisierung läuft — Der ESP32 ruft gerade neue Prognosedaten ab\./,
  "a configured weather fetch must keep the tongue and explain the in-progress state");
assert.match(html, /settings-source-summary warn[^>]*>Messwerte werden erfasst</,
  "a collecting ENV III must keep the tongue and switch to warning colour");

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
