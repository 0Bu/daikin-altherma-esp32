// ENV III is a compact schematic-header reading, not a permanent dashboard card. Tapping it opens
// the existing inspector with all three current values followed by one combined, scrubbable trend.
// Execute the production renderer so localisation, stale-state handling and chart composition stay
// one contract rather than a collection of source-text assertions.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const index = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../main/www/js/dashboard.js", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const source = readAppFragments(["i18n.js", "dashboard.js", "descriptions.js", "history.js", "schematic.js"]);

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
  /\.inspect \{ margin: 0 10px; \}[\s\S]*?\.inspect-card \{[^}]*border-top: 0;[^}]*border-radius: 0 0 var\(--r-tile\) var\(--r-tile\);[^}]*box-shadow: var\(--shadow-tongue\);/,
  "the schematic inspector must use the shared inset, bottom-rounded tongue treatment");

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

const ids = ["gEnv3", "svEnv3Temp", "inspCard", "inspTitle", "inspSrc", "inspNow",
             "inspBody", "inspHist", "inspRows"];
const elements = Object.fromEntries(ids.map((id) => [id, element()]));
const nativeTitle = element();
elements.gEnv3.querySelector = (selector) => selector === ":scope > title" ? nativeTitle : null;
elements.gEnv3.dataset = { insp: "env3" };

const now = Date.now();
const S = {
  status: {
    env3: { supported: true, enabled: true, fresh: true, error: "",
            temperature_c: 21.5, humidity_pct: 48, pressure_hpa: 1007 },
    history: { dt: 300, rows: [], modbus_rows: [], env3_rows: [
      { id: "env3_temperature", label: "ENV III temperature" },
      { id: "env3_humidity", label: "ENV III humidity" },
      { id: "env3_pressure", label: "ENV III air pressure" },
    ] },
  },
  hist: new Map([
    ["env3:env3_temperature", { at: now, gen: 1, source: "env3", dt: 300, unit: "°C", b0: 1,
                                v: [205, 210, 215] }],
    ["env3:env3_humidity", { at: now, gen: 1, source: "env3", dt: 300, unit: "%", b0: 1,
                             v: [500, 490, 480] }],
    ["env3:env3_pressure", { at: now, gen: 1, source: "env3", dt: 300, unit: "hPa", b0: 1,
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
assert.equal(sandbox.__api.tooltip(2),
  "jetzt\nTemperatur  21,5 °C\nLuftfeuchte  48,0 %\nLuftdruck  1.007,0 hPa",
  "one readable tooltip must report the selected instant and all three measurements");

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

console.log("ENV III pill: compact header reading, combined inspector and stale-state contract verified");
