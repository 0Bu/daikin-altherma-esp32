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
  "env.title": "Außensensor",
  "env.collecting": "Messwerte werden erfasst",
  "env.unavailable": "Sensor nicht erreichbar",
};
const t = (key, ...args) => (labels[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const S = { status: {} };
const sandbox = vm.createContext({ S, LANG: "de", t, esc, setTimeout, clearTimeout });
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
}
for (const [id, summary] of [
  ["dynamic-ref-temp-status", "1 Quelle · 25,1 °C · vor 17 s"],
  ["dynamic-weather-status", "Open-Meteo · 22,6 °C / 2 h · 0 Wh/m²"],
  ["dynamic-env3-status", "20,2 °C · 46 % · 1.009 hPa"],
]) {
  assert.ok(html.includes(`<span class="settings-source-summary ok" id="${id}">${summary}</span>`),
    `healthy configured summary must use its green tongue: ${summary}`);
}
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
assert.match(html, /settings-source-summary warn[^>]*>Wird geladen</,
  "a configured weather fetch must keep the tongue and switch to warning colour");
assert.match(html, /settings-source-summary warn[^>]*>Messwerte werden erfasst</,
  "a collecting ENV III must keep the tongue and switch to warning colour");

console.log("settings source tongue use-cases: ok");
