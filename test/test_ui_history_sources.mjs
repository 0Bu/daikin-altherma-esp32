// The six paired schematic measurements have two independent 24-hour rings. Execute the production
// browser combiner and renderer so an X10A gap cannot erase a live Modbus sample, and so the second
// line remains visibly attributed instead of becoming an unlabeled near-overlap.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const S = {
  status: { history: {
    rows: [
      { id: "dhw_tank", label: "DHW tank temp. (R5T)" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
    ],
    modbus_rows: [
      { id: "dhw_tank", label: "Domestic Hot Water temperature" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
    ],
  } },
  hist: new Map(), histBusy: new Set(), histPin: new Map(), clickHold: false, scrub: null,
};
let fetched = "";
const labels = {
  "hist.loading": "Verlauf wird geladen…", "hist.err": "Verlauf nicht verfügbar.",
  "hist.none": "Noch keine Messwerte aufgezeichnet.", "hist.title": "Letzte 24 Stunden",
  "hist.now": "jetzt", "hist.nm": "nicht gemessen", "hist.held": "Außeneinheit ruht",
};
const context = {
  S, LANG: "de", renderApp() {}, renderCards() {}, renderInspect() {}, renderSettings() {},
  esc: (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  tx: (x) => x.de,
  t: (key, ...args) => {
    const [arg, arg2] = args;
    if (key === "hist.since") return `Seit Neustart · ${arg} h`;
    if (key === "hist.ago") return `vor ${arg} h`;
    if (key === "hist.rel") return `vor ${arg} h`;
    if (key === "hist.gaps") return `${arg} Lücke`;
    if (key === "hist.heldnote") return `${arg} h Stillstand — nicht gemessen`;
    if (key === "hist.aria") return `${arg} — 24-Stunden-Verlauf`;
    if (key === "hist.aria_pinned") return `${arg} — angeheftet`;
    if (key === "hist.duration_min") return `${arg} min`;
    if (key === "hist.duration_h") return `${arg} h`;
    if (key === "hist.duration_hm") return `${arg} h ${arg2} min`;
    if (key === "hist.boost_total") return `Boost aktiv · ${arg}`;
    if (key === "hist.boost_run") return `${arg} · ca. ${arg2}`;
    if (key === "hist.boost_none") return "Kein Boost im aufgezeichneten Zeitraum.";
    if (key === "hist.boost_ago_range") return `vor ${arg}–${arg2} h`;
    if (key === "hist.boost_active") return "Boost aktiv";
    if (key === "hist.boost_inactive") return "Boost aus";
    if (key === "hist.boost_aria") return `${arg} — Boost-Verlauf. ${arg2}`;
    if (key.startsWith("sg.mode")) return ["Freier Betrieb", "Zwangsabschaltung", "Empfehlung ein", "Erzwungen ein"][+key.at(-1)];
    return labels[key] || key;
  },
  fetch: async (url) => {
    fetched = url;
    return { json: async () => ({ dt: 300, unit: "°C", b0: 102, v: [457], held: [] }) };
  },
  setTimeout, clearTimeout, Date, Map, Set, console,
};
vm.createContext(context);
vm.runInContext(readAppFragments(["history.js"]) +
  "\nthis.__api = { hasHist, hasModbusHist, histCacheKey, historyView, histHtml, scrubText," +
  " ensureHist, ensureHistPair };", context, { filename: "main/www/js/history.js" });
const h = context.__api;

const x10a = { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
                held: [], v: [452, null, 454] };
const modbus = { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
                 held: [], v: [453, 455, 456] };
S.hist.set("dhw_tank", x10a);
S.hist.set("modbus:dhw_tank", modbus);

assert.equal(h.hasHist("dhw_tank"), true);
assert.equal(h.hasModbusHist("dhw_tank"), true);
assert.equal(h.histCacheKey("dhw_tank", "modbus"), "modbus:dhw_tank");
let view = h.historyView("dhw_tank");
assert.equal(view.series.length, 2);
assert.deepEqual(Array.from(view.series[0].v), [452, null, 454]);
assert.deepEqual(Array.from(view.series[1].v), [453, 455, 456]);
assert.match(h.scrubText(view, 1), /X10A nicht gemessen/);
assert.match(h.scrubText(view, 1), /Modbus 45\.5 °C/,
  "the same cursor instant reads both instruments and preserves the X10A gap");

const html = h.histHtml("dhw_tank", "°C", "Warmwasserspeichertemperatur");
assert.match(html, /vhist-source[^>]*><i><\/i>X10A/);
assert.match(html, /vhist-source mb[^>]*><i><\/i>HomeHub · Modbus/);
assert.match(html, /vhist-line mb/);
assert.match(html, /45\.2 – 45\.6 °C/,
  "both sources share one vertical scale, including the Modbus-only maximum");

// Smart-Grid mode is a state timeline, not a misleading numeric 0..3 line. Mode 2 becomes two
// visible Boost intervals whose sampled duration and source are written in words.
S.hist.set("smart_grid_mode", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 20, 20, 0, 20, 20, 20, 0] });
S.hist.set("modbus:smart_grid_mode", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 20, 20, 0, 20, 20, 20, 0] });
const boostView = h.historyView("smart_grid_mode");
const boostHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung");
assert.equal(boostView.series.length, 2);
assert.match(boostHtml, /vhist-state-track/);
assert.doesNotMatch(boostHtml, /vhist-line/,
  "a categorical Smart-Grid mode must not be drawn as a numeric line");
assert.match(boostHtml, /Boost aktiv · 25 min/,
  "two mode-2 runs report their combined five-minute-sampled duration");
assert.equal((boostHtml.match(/vhist-state-on mb/g) || []).length, 2,
  "the HomeHub track shows exactly the two active Boost intervals");
assert.match(boostHtml, /HomeHub · Modbus/);
assert.match(h.scrubText(boostView, 1), /Modbus Boost aktiv · Empfehlung ein/,
  "scrubbing names the state and manufacturer mode, not the number 2.0");

// Bucket alignment, not array index: Modbus starts one raster later and must leave the first slot
// empty rather than sliding its first sample under the older X10A point.
S.hist.set("modbus:dhw_tank", { ...modbus, b0: 101, v: [455, 456] });
view = h.historyView("dhw_tank");
assert.deepEqual(Array.from(view.series.find((s) => s.source === "modbus").v), [null, 455, 456]);

// A model/X10A outage can leave only the HomeHub ring. It still renders, and the visible legend
// names its source rather than making a petrol line depend on colour recognition.
S.status.history.rows = [];
S.hist.delete("dhw_tank");
view = h.historyView("dhw_tank");
assert.equal(view.series.length, 1);
assert.equal(view.series[0].source, "modbus");
assert.match(h.histHtml("dhw_tank", "°C", "Warmwasserspeichertemperatur"), /HomeHub · Modbus/);

// The second ring is a distinct wire request and cache key; without the source query it would fetch
// X10A twice and draw two differently coloured copies of the same instrument.
S.hist.delete("modbus:dhw_tank");
await h.ensureHist("dhw_tank", "modbus");
assert.equal(fetched, "/history?row=dhw_tank&source=modbus");
assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), [457]);

console.log("UI history sources: X10A and Modbus rings align, gap, render and fetch independently");
