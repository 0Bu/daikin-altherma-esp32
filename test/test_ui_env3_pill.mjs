// ENV III is a compact schematic-header reading, not a permanent dashboard card. Tapping it opens
// the existing inspector with all three current values followed by one combined, scrubbable trend.
// Execute the production renderer so localisation, stale-state handling and chart composition stay
// one contract rather than a collection of source-text assertions.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const index = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../main/www/js/dashboard.js", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const source = readAppFragments(["i18n.js"]) + readUiLocale("de") +
  readAppFragments(["dashboard.js", "descriptions.js", "history.js", "schematic.js"]);

assert.match(index,
  /id="gEnv3"[^>]*data-insp="env3"[\s\S]*?class="sc-env3-box" x="624"[\s\S]*?id="gSgRequest"[\s\S]*?x="706"/,
  "the ENV III temperature pill must sit immediately left of Boost and use the shared inspector action");
assert.doesNotMatch(dashboard, /vcard\(t\("env\.card"\)/,
  "the former standalone outdoor-climate dashboard card must stay removed");
assert.doesNotMatch(dashboard, /hardware-env-history|data-trends="env3_temperature/,
  "Board Hardware must retain configuration help without duplicating live ENV III evidence");
assert.match(style, /svg \.sc-env3\.fresh \.sc-env3-box\s*\{[^}]*stroke:\s*var\(--brand\)/,
  "a fresh outdoor-climate pill must have a visible measurement state");
assert.match(index, /id="inspBody"[\s\S]*id="inspHist"[\s\S]*id="inspRows"/,
  "the inspector DOM must place the ENV III chart after its custom value body");
assert.match(index,
  /<figure class="schem-card" id="schem"[\s\S]*?<div class="card schem-face">[\s\S]*?<\/svg>[\s\S]*?<\/div>\s*<\/div>\s*<!-- Inspector:[\s\S]*?<div class="inspect"/,
  "the inspector must be a sibling tongue below the white schematic face, not part of the picture card");
assert.match(style,
  /\.vdesc, \.inspect \{[^}]*grid-template-rows: 0fr;[^}]*transition: grid-template-rows \.22s ease;[^}]*\}[\s\S]*?\.vitem\.open \.vdesc, \.inspect\.open \{ grid-template-rows: 1fr; \}/,
  "the schematic inspector must use the exact same clipped height transition as every other tongue");
assert.match(style,
  /\.vdesc-body, \.inspect-card \{[^}]*margin: 0 10px 12px;[^}]*border-top: 0;[^}]*border-radius: 0 0 var\(--r-tile\) var\(--r-tile\);[^}]*box-shadow: var\(--shadow-tongue\);[^}]*transform: translateY\(-7px\);[^}]*transition: transform \.22s ease;[^}]*\}[\s\S]*?\.vitem\.open \.vdesc-body, \.inspect\.open \.inspect-card \{ transform: none; \}/,
  "the schematic inspector and row explainers must share one surface and pull-out movement");
assert.doesNotMatch(style, /inspect-tongue-in/,
  "the inspector must not retain an independent one-shot animation");
assert.match(index, /<div class="inspect-inner">\s*<div class="inspect-card" id="inspCard" aria-hidden="true" inert>/,
  "the collapsed inspector must stay mounted in the shared clip but remain non-interactive");

function classList() {
  const names = new Set();
  return {
    names,
    contains(name) { return names.has(name); },
    toggle(name, force) {
      const on = force === undefined ? !names.has(name) : !!force;
      if (on) names.add(name); else names.delete(name);
      return on;
    },
  };
}

function element() {
  return {
    textContent: "", innerHTML: "", hidden: false, style: {}, attrs: {}, classList: classList(),
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
  };
}

const ids = ["gEnv3", "svEnv3Temp", "inspect", "inspCard", "inspTitle", "inspSrc", "inspNow",
             "inspBody", "inspHist", "inspRows"];
const elements = Object.fromEntries(ids.map((id) => [id, element()]));
const nativeTitle = element();
elements.gEnv3.querySelector = (selector) => selector === ":scope > title" ? nativeTitle : null;
elements.gEnv3.dataset = { insp: "env3" };

const now = Date.now();
const currentUnix = Date.parse("2026-08-12T10:00:00Z") / 1000;
const S = {
  status: {
    env3: { supported: true, enabled: true, fresh: true, error: "",
            temperature_c: 21.5, humidity_pct: 48, pressure_hpa: 1007 },
    ntp: { synced: true, time: "2026-08-12T10:00:00Z" },
    weather_forecast: {
      configured: true, available: true, fresh: true,
      hourly: [
        { time_unix_s: currentUnix + 3600, temperature_c: 22.0, humidity_pct: 46.0, pressure_hpa: 1008.0 },
        { time_unix_s: currentUnix + 7200, temperature_c: 23.0, humidity_pct: 44.0, pressure_hpa: 1009.0 },
        { time_unix_s: currentUnix + 10800, temperature_c: 22.5, humidity_pct: 45.0, pressure_hpa: 1008.5 },
      ],
    },
    history: { dt: 300, rows: [], modbus_rows: [], env3_rows: [
      { id: "env3_temperature", label: "ENV III temperature" },
      { id: "env3_humidity", label: "ENV III humidity" },
      { id: "env3_pressure", label: "ENV III air pressure" },
    ] },
  },
  hist: new Map([
    ["env3:env3_temperature", { at: now, gen: 1, source: "env3", dt: 300, unit: "°C", b0: 1,
                                t0: currentUnix - 600,
                                v: [205, 210, 215] }],
    ["env3:env3_humidity", { at: now, gen: 1, source: "env3", dt: 300, unit: "%", b0: 1,
                             t0: currentUnix - 600,
                             v: [500, 490, 480] }],
    ["env3:env3_pressure", { at: now, gen: 1, source: "env3", dt: 300, unit: "hPa", b0: 1,
                             t0: currentUnix - 600,
                             v: [10050, 10060, 10070] }],
  ]),
  histBusy: new Set(), histPin: new Map(), insp: "env3", inspSig: "", inspHistSig: "",
  scrub: null, live: null, _values: [], _modbus: [],
};

const document = {
  getElementById(id) { return elements[id] || null; },
  querySelectorAll(selector) { return selector === "#schem .sc-hit" ? [elements.gEnv3] : []; },
};
const sandbox = vm.createContext({
  S, document,
  navigator: { language: "de-DE" },
  localStorage: { getItem() { return null; }, setItem() {} },
  setTimeout, clearTimeout,
  fetch() { throw new Error("fresh seeded histories must not be fetched in this test"); },
});
vm.runInContext(`${source}
  this.__api = {
    render: () => { LANG = "de"; renderEnv3Pill(); renderInspect(); },
    pill: () => { LANG = "de"; renderEnv3Pill(); },
    tooltip: (i) => { LANG = "de"; return scrubText(historyView(ENV3_COMBINED_ID), i); },
    tooltipHtml: (i) => { LANG = "de"; return env3ScrubHtml(historyView(ENV3_COMBINED_ID), i); },
  };`, sandbox, { filename: "main/www/app.sources" });

sandbox.__api.render();
assert.equal(elements.gEnv3.style.display, "", "a configured ENV III must expose its pill");
assert.equal(elements.gEnv3.attrs.tabindex, "0");
assert.equal(elements.svEnv3Temp.textContent, "21,5 °C",
  "the compact face must show the localized fresh temperature");
assert.equal(elements.gEnv3.classList.contains("fresh"), true);
assert.equal(elements.gEnv3.attrs["aria-label"], "Außenklima: 21,5 °C; Aktuell");
assert.equal(nativeTitle.textContent, elements.gEnv3.attrs["aria-label"],
  "hover and assistive text must name the same current reading and state");

assert.equal(elements.inspCard.hidden, false);
assert.equal(elements.inspect.classList.contains("open"), true,
  "rendering a selection must open the shared accordion instead of unhiding the card");
assert.equal(elements.inspCard.attrs["aria-hidden"], undefined);
assert.equal(elements.inspCard.attrs.inert, undefined);
assert.equal(elements.inspTitle.textContent, "Außenklima");
assert.equal(elements.inspSrc.textContent, "ENV III");
assert.equal(elements.inspNow.textContent, "21,5 °C");
assert.match(elements.inspBody.innerHTML,
  /Sensor: Aktuell[\s\S]*Temperatur[\s\S]*21,5 °C[\s\S]*Luftfeuchte[\s\S]*48 %[\s\S]*Luftdruck[\s\S]*1\.007 hPa/,
  "the infobox must show all three current ENV III readings in localized form");
assert.equal(elements.inspRows.innerHTML, "",
  "no value rows may be appended below the combined chart");
assert.match(elements.inspHist.innerHTML,
  /data-hist="env3_combined"[\s\S]*env-temperature[\s\S]*env-humidity[\s\S]*env-pressure/,
  "the infobox must end with one shared timeline carrying all three independently scaled series");
assert.match(elements.inspHist.innerHTML,
  /vhist-area env-temperature[\s\S]*vhist-area env-humidity[\s\S]*vhist-area env-pressure/,
  "ENV III measurements must retain the shared light areas");
assert.match(elements.inspHist.innerHTML,
  /vhist-line env-temperature[\s\S]*vhist-line env-humidity[\s\S]*vhist-line env-pressure/,
  "each ENV III area must carry the same darker line on its upper edge");
assert.match(elements.inspHist.innerHTML,
  /env-forecast-temperature[\s\S]*env-forecast-humidity[\s\S]*env-forecast-pressure[\s\S]*vhist-forecast-divider/,
  "all three Open-Meteo forecasts must share the future plot with a visible now divider");
assert.match(elements.inspHist.innerHTML,
  /vhist-line env-forecast-temperature[\s\S]*vhist-line env-forecast-humidity[\s\S]*vhist-line env-forecast-pressure/,
  "forecast areas must use the same darker upper-edge line as every numeric trend");
assert.match(elements.inspHist.innerHTML, /^<div class="vhist vhist-env3 vhist-multi">/,
  "the overlaid ENV III and forecast series must use the transparent multi-series contract");
assert.doesNotMatch(elements.inspHist.innerHTML,
  /<circle class="vhist-pt env-forecast-/,
  "forecast areas must stay quiet instead of marking every provider hour with a large point");
assert.doesNotMatch(elements.inspHist.innerHTML,
  /<span class="vhist-source env-forecast-/,
  "the measured-variable legend must not repeat Open-Meteo forecast entries");
assert.doesNotMatch(elements.inspHist.innerHTML,
  /Open-Meteo · Prognose/,
  "Open-Meteo provenance belongs in the forecast tooltip, not the always-visible legend");
const legendHtml = elements.inspHist.innerHTML.match(/<div class="vhist-legend">([\s\S]*?)<\/div>/)?.[1] || "";
assert.match(legendHtml,
  /env-temperature[^>]*><i><\/i>Temperatur<\/span>[\s\S]*env-humidity[^>]*><i><\/i>Luftfeuchte<\/span>[\s\S]*env-pressure[^>]*><i><\/i>Luftdruck<\/span>/,
  "the legend must retain only the three coloured measurement names");
assert.doesNotMatch(legendHtml, /<small>|°C|%|hPa/,
  "units belong in the tooltip, not the always-visible legend");
assert.match(style, /\.vhist-area\.env-forecast-temperature\s*\{[^}]*opacity:\s*\.065/);
assert.match(style, /\.vhist-multi \.vhist-area\s*\{[^}]*opacity:\s*\.09/,
  "measured ENV III areas must use the shared multi-series transparency");
assert.match(style, /\.vhist-line\.env-forecast-temperature\s*\{[^}]*opacity:\s*\.68/,
  "forecast upper-edge lines must be quieter than measured upper-edge lines");
assert.match(style, /\.vhist-env3 \.vhist-tip-line\.env-temperature\s*\{[^}]*color:\s*var\(--flow-hot\)/);
assert.match(style, /\.vhist-env3 \.vhist-tip-line\.env-humidity\s*\{[^}]*color:\s*var\(--flow-cold\)/);
assert.match(style, /\.vhist-env3 \.vhist-tip-line\.env-pressure\s*\{[^}]*color:\s*var\(--env-pressure\)/);
assert.match(style, /\.vhist-graph\s*\{[^}]*--vhist-tip-base:\s*20px;[^}]*padding-top:\s*var\(--vhist-tip-base\);/,
  "climate charts must share the fixed compact legend-to-plot distance");
assert.doesNotMatch(style, /\.vhist-env3 \.vhist-graph\s*\{/,
  "climate tooltip height must not alter graph layout");
assert.match(style,
  /\.vhist-env3 \.vhist-tip\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, max-content\)\)/,
  "the three wide-screen readings must share one compact tooltip row");
assert.match(style,
  /@media \(max-width: 480px\)[\s\S]*\.vhist-env3 \.vhist-tip\s*\{[^}]*display:\s*block/,
  "phones must stack the same tooltip rows while the plot stays fixed underneath");
const measuredClock = new Date(currentUnix * 1000)
  .toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit" });
assert.equal(sandbox.__api.tooltip(2),
  `${measuredClock}\nTemperatur  21,5 °C\nLuftfeuchte  48,0 %\nLuftdruck  1.007,0 hPa`,
  "one readable tooltip must report the selected instant and all three measurements");
assert.equal(sandbox.__api.tooltipHtml(2),
  `<span class="vhist-tip-line vhist-tip-meta">${measuredClock}</span>` +
  `<span class="vhist-tip-line env-temperature">Temperatur  21,5 °C</span>` +
  `<span class="vhist-tip-line env-humidity">Luftfeuchte  48,0 %</span>` +
  `<span class="vhist-tip-line env-pressure">Luftdruck  1.007,0 hPa</span>`,
  "each measured tooltip row must colour its name and value with the matching series token");
const forecastClock = new Date((currentUnix + 3600) * 1000)
  .toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit" });
assert.equal(sandbox.__api.tooltip(3),
  `${forecastClock}\nOpen-Meteo · Prognose\nTemperatur  22,0 °C\nLuftfeuchte  46,0 %\nLuftdruck  1.008,0 hPa`,
  "the same tooltip path must expose every provider-timestamped future value");
assert.equal(sandbox.__api.tooltipHtml(3),
  `<span class="vhist-tip-line vhist-tip-meta">${forecastClock} · Open-Meteo · Prognose</span>` +
  `<span class="vhist-tip-line env-temperature">Temperatur  22,0 °C</span>` +
  `<span class="vhist-tip-line env-humidity">Luftfeuchte  46,0 %</span>` +
  `<span class="vhist-tip-line env-pressure">Luftdruck  1.008,0 hPa</span>`,
  "forecast provenance stays neutral while all three forecast rows keep their series colours");

S.status.env3 = { ...S.status.env3, fresh: false, error: "collecting" };
S.inspSig = "";
sandbox.__api.render();
assert.equal(elements.svEnv3Temp.textContent, "— °C");
assert.equal(elements.gEnv3.classList.contains("fresh"), false);
assert.match(elements.inspBody.innerHTML, /Sensor: Messung läuft…[\s\S]*Temperatur[\s\S]*— °C/,
  "a configured sensor without a fresh whole sample must remain visible without carrying old values");

S.status.env3.enabled = false;
sandbox.__api.pill();
assert.equal(elements.gEnv3.style.display, "none");
assert.equal(elements.gEnv3.attrs.tabindex, "-1");
assert.equal(elements.gEnv3.attrs["aria-hidden"], "true");
assert.equal(S.insp, null, "disabling ENV III must close an inspector whose trigger disappeared");
sandbox.__api.render();
assert.equal(elements.inspect.classList.contains("open"), false);
assert.equal(elements.inspCard.attrs["aria-hidden"], "true");
assert.equal(elements.inspCard.attrs.inert, "");

console.log("ENV III pill: compact header reading, combined inspector and stale-state contract verified");
