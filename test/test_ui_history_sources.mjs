// Paired schematic measurements and states have two independent 24-hour rings. Execute the production
// browser combiner and renderer so an X10A gap cannot erase a live Modbus sample, and so the second
// line remains visibly attributed instead of becoming an unlabeled near-overlap.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const firmwareHistory = fs.readFileSync(new URL("../main/history.cpp", import.meta.url), "utf8");
const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
assert.match(style, /\.vhist-state-graph \.vhist-tip \{[^}]*z-index:\s*2[^}]*white-space:\s*pre;/,
  "state tooltips must paint over the timeline and honor only their deliberate vertical breaks");
assert.match(style, /\.vhist-graph\s*\{[^}]*padding-top:\s*20px;/,
  "numeric and categorical plots must share the compact legend-to-graph spacing");
assert.doesNotMatch(style, /\.vhist-state-graph\s*\{[^}]*padding-top:/,
  "categorical timelines must not reintroduce a larger spacing override");
assert.match(style,
  /\.vhist-state-current \{[^}]*border-left:\s*2px solid var\(--card\);/,
  "every categorical track must visibly separate its live observation from completed raster buckets");
// Source outline and state fill are SEPARATE visual channels (DESIGN.md). A blanket source fill on
// the HomeHub lane repaints every phase one colour, which is not a cosmetic loss: it erased all four
// Smart-Grid modes into a single bar, and that bar read as a STATE, because petrol is the legend
// swatch for "Recommended on". A plant running free for a day showed 24 h of Boost directly under a
// Boost total of a few hours derived from the same samples. Strip comments first — the CSS explains
// why the rule is absent, and that prose must not satisfy the check for it.
const cssRules = style.replace(/\/\*[\s\S]*?\*\//g, "");
assert.doesNotMatch(cssRules, /\.vhist-state-on\.mb\b/,
  "no source colour may override a categorical state fill on the HomeHub lane");
const stateFill = (cls) => {
  const rule = cssRules.match(new RegExp(`\\.vhist-state-on\\.${cls}\\b[^{}]*\\{([^}]*)\\}`));
  assert.ok(rule, `${cls} must own a state fill`);
  const bg = rule[1].match(/background:\s*([^;]+);/);
  assert.ok(bg, `${cls} must declare a background`);
  return bg[1].trim();
};
const sgFills = ["sg-free", "sg-forced-off", "sg-recommended", "sg-forced-on"].map(stateFill);
assert.equal(new Set(sgFills).size, 4,
  "each of the four Smart-Grid modes must be distinguishable by its own fill");
assert.match(firmwareHistory,
  /if \(!s_have_bucket\)[\s\S]*?history_completed_samples\(bucket\)[\s\S]*?P\(\)\.ring\)[\s\S]*?reset_with_gaps\(completed\)/m,
  "X10A and board rings must seed the elapsed boot raster even when polling starts late");
assert.match(firmwareHistory,
  /if \(!s_mb_have_bucket\)[\s\S]*?history_completed_samples\(bucket\)[\s\S]*?P\(\)\.mb_ring\)[\s\S]*?reset_with_gaps\(completed\)/m,
  "HomeHub rings must use the same boot-aligned raster when enabled later");
assert.match(firmwareHistory, /void history_record\([^)]*\) \{\s*if \(!s_mtx\) return;\s*if \(!v\) n = 0;/m,
  "an empty X10A sweep must still advance board histories and the shared gap raster");
assert.match(firmwareHistory,
  /void history_record_circulation\(\)[\s\S]*advance_raster_locked\(now_us, bucket\);[\s\S]*fold_circulation_locked\(circulation\);/,
  "the MQTT witness must own a lightweight recorder that advances the common raster without X10A");
assert.match(mqtt,
  /service_reference_frames\(ref_config\);[\s\S]{0,500}history_record_circulation\(\);[\s\S]{0,500}if \(gate\.publish_offline\)/,
  "circulation history must tick on the subscriber path before every X10A publication gate");

const S = {
  status: { history: {
    rows: [
      { id: "dhw_tank", label: "DHW tank temp. (R5T)" },
      { id: "leaving_water", label: "Leaving water temp. before BUH (R1T)" },
      { id: "return_water", label: "Inlet water temp.(R4T)" },
      { id: "outdoor_air", label: "R1T-Outdoor air temp." },
      { id: "pump_signal", label: "Water pump signal (0:max-100:stop)" },
      { id: "defrost_state", label: "Defrost Operation" },
      { id: "quiet_state", label: "Silent Mode" },
      { id: "bsh_state", label: "BSH" },
      { id: "buh_step1", label: "BUH Step1" },
      { id: "buh_step2", label: "BUH Step2" },
      { id: "valve_dhw", label: "3way valve(On:DHW_Off:Space)" },
      { id: "valve_heat", label: "2way valve(On:Heat_Off:Cool)" },
      { id: "water_flow_switch", label: "Water flow switch" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
      { id: "circulation_state", label: "DHW circulation pump" },
    ],
    modbus_rows: [
      { id: "dhw_tank", label: "Domestic Hot Water temperature" },
      { id: "outdoor_air", label: "Outside air temperature" },
      { id: "quiet_state", label: "Quiet mode operation" },
      { id: "bsh_state", label: "Booster heater run" },
      { id: "valve_dhw", label: "3-way valve" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
    ],
    env3_rows: [{ id: "temperature", label: "Temperature" }],
  }, ntp: { synced: true } },
  hist: new Map(), histBusy: new Set(), histPin: new Map(), clickHold: false, scrub: null,
};
let fetched = "";
let fetchedUrls = [];
const defaultHistoryResponse = { dt: 300, unit: "°C", label: "Domestic Hot Water temperature",
  b0: 102, v: [457], held: [] };
let historyResponse = defaultHistoryResponse;
let historyFetchError = false;
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
    if (key === "hist.recorded") return `Aufzeichnung · ${arg} h`;
    if (key === "hist.ago") return `vor ${arg} h`;
    if (key === "hist.rel") return `vor ${arg} h`;
    if (key === "hist.gaps") return `${arg} Lücke`;
    if (key === "hist.heldnote") return `${arg} h Stillstand — nicht gemessen`;
    if (key === "hist.aria") return `${arg} — 24-Stunden-Verlauf`;
    if (key === "hist.aria_pinned") return `${arg} — angeheftet`;
    if (key === "hist.duration_min") return `${arg} min`;
    if (key === "hist.duration_h") return `${arg} h`;
    if (key === "hist.duration_hm") return `${arg} h ${arg2} min`;
    if (key === "hist.state_phase_run") return `${arg}\n${arg2} · ca. ${args[2]}`;
    if (key === "hist.state_active") return "Aktiv";
    if (key === "hist.state_off") return "Aus";
    if (key === "hist.modbus_plateau") return `Register unverändert ${arg} · ca. ${arg2} · Messalter unbekannt`;
    if (key === "hist.boost_total") return `Boost aktiv · ${arg}`;
    if (key === "hist.boost_none") return "Kein Boost im aufgezeichneten Zeitraum.";
    if (key === "hist.boost_ago_range") return `vor ${arg}–${arg2} h`;
    if (key === "hist.boost_active") return "Boost aktiv";
    if (key === "hist.boost_inactive") return "Boost aus";
    if (key === "hist.boost_aria") return `${arg} — Boost-Verlauf. ${arg2}`;
    if (key === "hist.defrost_total") return `Abtauen aktiv erfasst · ${arg} Rasterzeit`;
    if (key === "hist.defrost_none") return "Kein Abtauvorgang erfasst.";
    if (key === "hist.defrost_active") return "Abtauen aktiv";
    if (key === "hist.defrost_inactive") return "Abtauen aus";
    if (key === "hist.defrost_aria") return `${arg} — Abtauverlauf. ${arg2}`;
    if (key === "hist.quiet_total") return `Leise-Modus aktiv erfasst · ${arg} Rasterzeit`;
    if (key === "hist.quiet_none") return "Kein Leise-Modus erfasst.";
    if (key === "hist.quiet_active") return "Leise-Modus aktiv";
    if (key === "hist.quiet_inactive") return "Leise-Modus aus";
    if (key === "hist.quiet_aria") return `${arg} — Verlauf des Leise-Modus. ${arg2}`;
    if (key === "hist.heater_total") return `Heizstab aktiv erfasst · ${arg} Rasterzeit`;
    if (key === "hist.heater_none") return "Kein Heizstabeinsatz erfasst.";
    if (key === "hist.heater_active") return "Heizstab aktiv";
    if (key === "hist.heater_inactive") return "Heizstab aus";
    if (key === "hist.heater_aria") return `${arg} — Heizstab-Verlauf. ${arg2}`;
    if (key === "hist.buh_total") return `Zusatzheizer aktiv erfasst · ${arg} Rasterzeit`;
    if (key === "hist.buh_none") return "Kein Zusatzheizereinsatz erfasst.";
    if (key === "hist.buh_active") return "Zusatzheizer aktiv";
    if (key === "hist.buh_inactive") return "Zusatzheizer aus";
    if (key === "hist.buh_step1") return "Stufe 1";
    if (key === "hist.buh_step2") return "Stufe 2";
    if (key === "hist.buh_aria") return `${arg} — Zusatzheizer-Verlauf. ${arg2}`;
    if (key === "hist.valve_dhw_total") return `Warmwasser · ${arg}`;
    if (key === "hist.valve_space_total") return `Raumkreis · ${arg}`;
    if (key === "hist.valve_none") return "Keine Warmwasserstellung erfasst.";
    if (key === "hist.valve_dhw") return "Warmwasser";
    if (key === "hist.valve_space") return "Raumkreis";
    if (key === "hist.valve_aria") return `${arg} — 3-Wege-Ventil-Verlauf. ${arg2}`;
    if (key === "hist.circ_total") return `Pumpe laufend erfasst · ${arg} Rasterzeit`;
    if (key === "hist.circ_none") return "Kein Pumpenlauf erfasst.";
    if (key === "hist.circ_on") return "Läuft";
    if (key === "hist.circ_off") return "Steht";
    if (key === "hist.circ_unavailable") return "Nicht verfügbar";
    if (key === "hist.circ_gaps") return `${arg} Phase · nicht verfügbar`;
    if (key === "hist.circ_aria") return `${arg} — Zirkulationsverlauf. ${arg2}`;
    if (key === "hist.valve2_on_total") return `2WV-Ausgang ON · ${arg}`;
    if (key === "hist.valve2_off_total") return `2WV-Ausgang OFF · ${arg}`;
    if (key === "hist.valve2_none") return "Kein ON-Zustand des 2WV-Ausgangs erfasst.";
    if (key === "hist.valve2_on") return "2WV-Ausgang ON";
    if (key === "hist.valve2_off") return "2WV-Ausgang OFF";
    if (key === "hist.valve2_aria") return `${arg} — Verlauf des 2WV-Ausgangs. ${arg2}`;
    if (key.startsWith("sg.mode")) return ["Freier Betrieb", "Zwangsabschaltung", "Empfehlung ein", "Erzwungen ein"][+key.at(-1)];
    return labels[key] || key;
  },
  fetch: async (url) => {
    fetched = url;
    fetchedUrls.push(url);
    if (historyFetchError) throw new Error("temporary reboot window");
    return { json: async () => historyResponse };
  },
  setTimeout, clearTimeout, Date, Map, Set, console,
};
vm.createContext(context);
vm.runInContext(readAppFragments(["history.js"]) +
  "\nthis.__api = { hasHist, hasModbusHist, histCacheKey, historyView, histHtml, scrubText," +
  " scrubMove, ensureHist, ensureHistPair, ensureDerived };", context,
  { filename: "main/www/js/history.js" });
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
assert.match(html, /Aufzeichnung · 1 h/,
  "a partial ring reports its recorded span without claiming that the board restarted");
assert.doesNotMatch(html, /Neustart/);
assert.match(html, /vhist-source[^>]*><i><\/i>X10A/);
assert.match(html, /vhist-source mb[^>]*><i><\/i>HomeHub · Modbus/);
assert.match(html, /vhist-line mb/);
assert.match(html, /45\.2 – 45\.6 °C/,
  "both sources share one vertical scale, including the Modbus-only maximum");

// Every numeric chart uses the same light-area/dark-upper-edge grammar. A single series keeps the
// reference opacity; paired instruments retain both areas and both lines under a transparent wrapper.
S.hist.set("pump_signal", { at: 1, gen: 1, dt: 300, unit: "%", t0: null, b0: 100,
  held: [], v: [700, 650, 600] });
const singleAreaHtml = h.histHtml("pump_signal", "%", "Pumpensignal");
assert.match(singleAreaHtml, /^<div class="vhist">[\s\S]*vhist-area[\s\S]*vhist-line/,
  "a single numeric trend must draw a light area before its darker upper-edge line");
assert.doesNotMatch(singleAreaHtml, /vhist-multi/,
  "a single trend must keep the reference opacity");
S.hist.set("leaving_water", { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
  held: [], v: [400, 410, 420] });
S.hist.set("modbus:leaving_water", { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
  held: [], v: [401, 411, 421] });
const pairedAreaHtml = h.histHtml("leaving_water", "°C", "Vorlauftemperatur");
assert.match(pairedAreaHtml, /^<div class="vhist vhist-multi">/,
  "overlaid numeric trends must opt into the reduced-opacity paint contract");
assert.match(pairedAreaHtml,
  /vhist-area"[\s\S]*vhist-area mb[\s\S]*vhist-line"[\s\S]*vhist-line mb/,
  "both instruments must retain a filled area and a darker line on its upper edge");
assert.match(style, /\.vhist-area\s*\{[^}]*opacity:\s*\.14/,
  "the reference single-series area must remain light");
assert.match(style, /\.vhist-multi \.vhist-area\s*\{[^}]*opacity:\s*\.09/,
  "overlaid areas must be more transparent than a single series");
assert.match(style, /\.vhist-multi \.vhist-line\s*\{[^}]*opacity:\s*\.82/,
  "overlaid upper-edge lines must remain distinct without becoming opaque");
assert.match(style,
  /\.vhist-source i\s*\{[^}]*border-top:\s*2px solid var\(--vhist-colour\)[^}]*color-mix\(/,
  "numeric legend samples must repeat the light-area/dark-upper-edge grammar");

// A derived curve keeps the UNION of its input rasters. Before this contract, taking the shortest
// input collapsed an 11-hour chart to 1 or 8 hours after one register appeared/reset later.
S.hist.set("leaving_water", { at: Date.now(), gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
  held: [], v: [400, 410, 420] });
S.hist.set("return_water", { at: Date.now(), gen: 1, dt: 300, unit: "°C", t0: null, b0: 101,
  held: [], v: [350, 360] });
await h.ensureDerived("dt");
assert.equal(S.hist.get("dt").b0, 100);
assert.deepEqual(Array.from(S.hist.get("dt").v), [null, 60, 60],
  "the earlier bucket remains a gap instead of being cut off with the shorter input");

// A successful HomeHub poll proves transport freshness, not when the controller last refreshed its
// outdoor-temperature register. Keep that qualification in the graph popup: the chart must remain
// compact, while hovering any petrol plateau names its observed interval and unknown measurement age.
S.hist.set("outdoor_air", { at: 1, gen: 1, dt: 300, unit: "°C", t0: 1768720000, b0: 200,
  held: [[1, 3]], v: [205, null, null, null] });
S.hist.set("modbus:outdoor_air", { at: 1, gen: 1, dt: 300, unit: "°C", t0: 1768720000, b0: 200,
  held: [], v: [205, 205, 205, 295] });
const outdoorView = h.historyView("outdoor_air");
const outdoorHtml = h.histHtml("outdoor_air", "°C", "Außentemperatur");
assert.doesNotMatch(outdoorHtml, /Messalter unbekannt/,
  "the freshness qualification must not become another static line below the chart");
assert.match(h.scrubText(outdoorView, 1),
  /Modbus 20\.5 °C · Register unverändert .* ca\. 15 min · Messalter unbekannt/,
  "the popup distinguishes a repeated register value from a proven fresh measurement");

// THE READOUT AT THE ENDS OF THE CHART. An absolutely positioned bubble carrying only `left` is
// shrink-to-fit against `container - left`, so at the last sample — where the live value sits and
// where a reader looks first — the available width collapses and the text wraps to its
// minimum-content width. Shipped, that turned "08:23 · X10A 46.3 °C · Modbus 46.3 °C" into a 59 px
// column of SEVEN lines hanging over the curve it was reading, and the measured clamp in scrubMove
// could not recover: it read offsetWidth while the squeezed `left` was still applied and concluded
// the bubble already fit. Both halves of the fix are pinned here, since neither is visible in any
// rendering this suite can perform.
assert.match(style, /\.vhist-tip \{[^}]*width:\s*max-content;/,
  "the readout's width must not depend on its position, or the last sample wraps it to one word per line");
assert.match(style,
  /\.vhist-tip \{[^}]*left:\s*calc\(var\(--tip-p\) \* 1%\);\s*transform:\s*translateX\(calc\(var\(--tip-p\) \* -1%\)\);/,
  "the readout must slide its own anchor with --tip-p, so it stays inside the card at both ends " +
  "without a measurement or a percentage cut-off");
S.histPin.set("outdoor_air", { t: 1768720000 + 3 * 300 });        // the newest sample: p = 100
assert.match(h.histHtml("outdoor_air", "°C", "Außentemperatur"),
  /<div class="vhist-tip vhist-pinned mono num" style="--tip-p:100\.000">/,
  "a pinned readout carries its POSITION, so the one CSS rule places it before layout too");
S.histPin.delete("outdoor_air");

// The LIVE half is the handler, not a stylesheet, so execute it rather than grep it: scrubMove must
// place the bubble from the sample's position and must not MEASURE it. The measurement is what made
// the defect self-reinforcing — offsetWidth was read while the squeezed `left` was still applied —
// so the fake node counts reads of it and reports any as a failure. `left` is likewise never written
// on the tip any more; the cross and the marker keep their own px placement inside the plot.
{
  const styleSpy = () => {
    const props = new Map(), written = [];
    return { props, written,
      setProperty: (k, v) => { props.set(k, v); written.push(k); },
      set left(v) { written.push("left=" + v); }, get left() { return ""; } };
  };
  let offsetWidthReads = 0;
  const node = (cls) => ({ className: cls, hidden: true, dataset: {}, style: styleSpy(),
    get offsetWidth() { offsetWidthReads++; return 0; } });
  const tipNode = node("vhist-tip vhist-live");
  const crossNode = node("vhist-cross vhist-live");
  const markNode = node("vhist-mark vhist-live");     // never spread: that reads the offsetWidth spy
  markNode.dataset.source = "modbus";
  const plot = {
    clientWidth: 600, dataset: { hist: "outdoor_air", source: "modbus", n: "4" },
    querySelector: () => crossNode,
    querySelectorAll: () => [markNode],
    parentElement: { querySelector: () => tipNode },
  };
  h.scrubMove(plot, 3);                                    // the newest sample of the 4-sample ring
  assert.equal(tipNode.style.props.get("--tip-p"), "100.000",
    "the live readout is placed from the sample's position, like the pinned one");
  assert.deepEqual(tipNode.style.written, ["--tip-p"],
    "scrubMove must write only --tip-p on the bubble — a px `left` reintroduces the edge squeeze");
  assert.equal(offsetWidthReads, 0,
    "the bubble's placement must not depend on measuring it: the squeezed width measured as fitting");
  assert.equal(tipNode.hidden, false, "the readout is still revealed by a scrub");
}

// Smart-Grid mode is a complete categorical state timeline, not a misleading numeric 0..3 line.
// Every manufacturer mode and a measurement gap are visible in both source lanes. Exact phase
// intervals live in the hover/touch/keyboard popup, not in a repeated list below the chart; only
// mode 2 contributes to the compact Boost total.
S.hist.set("smart_grid_mode", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 20, 30, null, 20, 0] });
S.hist.set("modbus:smart_grid_mode", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 20, 30, null, 20, 0] });
const boostView = h.historyView("smart_grid_mode");
const boostHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung");
assert.equal(boostView.series.length, 2);
assert.match(boostHtml, /vhist-state-track/);
assert.doesNotMatch(boostHtml, /vhist-line/,
  "a categorical Smart-Grid mode must not be drawn as a numeric line");
assert.match(boostHtml, /Boost aktiv · 10 min/,
  "only the two mode-2 buckets contribute to the Boost total");
for (const cls of ["sg-free", "sg-forced-off", "sg-recommended", "sg-forced-on"])
  assert.match(boostHtml, new RegExp(`vhist-state-on mb ${cls}`),
    `the HomeHub lane visibly distinguishes ${cls}`);
assert.match(boostHtml, /vhist-state-gap/);
assert.match(boostHtml, /Freier Betrieb/);
assert.match(boostHtml, /Zwangsabschaltung/);
assert.match(boostHtml, /Empfehlung ein/);
assert.match(boostHtml, /Erzwungen ein/);
assert.doesNotMatch(boostHtml, /vhist-state-runs|· Phasen/,
  "phase details belong to the chart popup, never a long list below it");
assert.match(boostHtml, /vhist-state-lane-label">X10A/);
assert.match(boostHtml, /vhist-state-lane-label mb">Modbus/);
assert.doesNotMatch(boostHtml, /vhist-state-legend/,
  "source names belong directly on their lanes, not in a detached legend");
for (const i of [1, 3])
  assert.match(h.scrubText(boostView, i), /^\d{2}:\d{2}–\d{2}:\d{2} · Aus$/,
    "non-Boost Smart-Grid modes keep the compact Boost status off");
assert.match(h.scrubText(boostView, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Aktiv$/,
  "mode 2 shows the compact active Boost status");
for (const i of [1, 2, 3])
  assert.doesNotMatch(h.scrubText(boostView, i), /X10A|Modbus|Boost|Empfehlung|Erzwungen|Zwang|ca\.|min/);

// The schematic's BOOST inspector is a HomeHub/Modbus request, so it deliberately filters the
// otherwise shared Smart-Grid history to that instrument. The generic value-row history above stays
// dual-source for diagnostics; only this filtered view loses the X10A lane and tooltip block.
const boostModbusView = h.historyView("smart_grid_mode", "modbus");
const boostModbusHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
assert.equal(boostModbusView.series.length, 1);
assert.equal(boostModbusView.series[0].source, "modbus");
assert.doesNotMatch(boostModbusHtml, /vhist-state-lane-label">X10A/);
assert.match(boostModbusHtml, /vhist-state-lane-label mb">Modbus/);
assert.match(boostModbusHtml, /data-source="modbus"/,
  "scrubbing and pinning must resolve the same Modbus-only view that the chart renders");
assert.match(h.scrubText(boostModbusView, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Aktiv$/);
assert.doesNotMatch(h.scrubText(boostModbusView, 2), /X10A|Modbus|Boost|Empfehlung|ca\.|min/);

// Regression: /history ends at the newest COMPLETED bucket while /values already carries the live
// state. The chart must not paint that old bucket through the edge labelled "jetzt". Append the
// current observation as its own cap, keep it scrub-readable, and exclude it from sampled totals.
S._modbus = [{ off: 56, value: 2, enum: "smart_grid_mode" }];
const liveBoostView = h.historyView("smart_grid_mode", "modbus");
const liveBoostHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
assert.equal(liveBoostView.recordedN, 7);
assert.equal(liveBoostView.liveIndex, 7);
assert.deepEqual(Array.from(liveBoostView.series[0].v), [0, 10, 20, 30, null, 20, 0, 20]);
assert.match(liveBoostHtml,
  /vhist-state-on mb sg-recommended" style="left:87\.500%;width:12\.500%/,
  "the live Recommended-on state must own the right edge instead of extending Free running to now");
assert.match(liveBoostHtml, /vhist-state-current" style="left:87\.500%;width:12\.500%/,
  "the display distinguishes the live observation from completed raster buckets");
assert.match(liveBoostHtml, /Boost aktiv · 10 min/,
  "one live observation must not be counted as an invented five minutes of Boost runtime");
assert.equal(h.scrubText(liveBoostView, 7), "jetzt · Aktiv",
  "the state shown at the right edge and its tooltip must agree");
delete S._modbus;

// The external circulation witness is a three-outcome history: confirmed running, confirmed
// stopped, or unavailable evidence. The configured name lives in the Settings row; the chart lane
// names its transport and must keep absent MQTT evidence visible instead of colouring it stopped.
S.hist.set("circulation_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [null, 0, 0, 10, 10, null] });
const circulationView = h.historyView("circulation_state");
const circulationHtml = h.histHtml("circulation_state", "", "Warmwasser-Zirkulationspumpe");
assert.equal(circulationView.series[0].name, "MQTT");
assert.match(circulationHtml, /vhist-state-lane-label">MQTT/);
assert.match(circulationHtml, /vhist-state-on state-off/);
assert.match(circulationHtml, /vhist-state-on circulation-on/);
assert.match(circulationHtml, /vhist-state-gap/);
for (const label of ["Läuft", "Steht", "Nicht verfügbar"])
  assert.match(circulationHtml, new RegExp(`>${label}<`), `${label} must be an explicit timeline state`);
assert.match(circulationHtml, /2 Phase · nicht verfügbar/);
assert.match(h.scrubText(circulationView, 0), /MQTT\nNicht verfügbar/,
  "an absent pump sample must read unavailable, never stopped");
assert.match(h.scrubText(circulationView, 1), /MQTT\nSteht/);
assert.match(h.scrubText(circulationView, 3), /MQTT\nLäuft/);

// BSH is also categorical. Its active buckets render as intervals and the wording calls the sum
// raster time rather than exact runtime; X10A is the preferred physical-state source.
S.hist.set("bsh_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
S.hist.set("modbus:bsh_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
const bshView = h.historyView("bsh_state");
const bshHtml = h.histHtml("bsh_state", "", "Heizstab");
assert.match(bshHtml, /vhist-state-track/);
assert.doesNotMatch(bshHtml, /vhist-line/);
assert.match(bshHtml, /Heizstab aktiv erfasst · 10 min Rasterzeit/);
assert.match(bshHtml, /vhist-state-on state-off/);
assert.match(bshHtml, /vhist-state-on heater-on/);
assert.doesNotMatch(bshHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(bshView, 0), /^\d{2}:\d{2}–\d{2}:\d{2} · Aus$/);
assert.match(h.scrubText(bshView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · Aktiv$/);
assert.doesNotMatch(h.scrubText(bshView, 1), /X10A|Modbus|Heizstab|ca\.|min/);

// The Heizstab schematic inspector keeps the categorical history but narrows it to the authoritative
// X10A BSH state. The generic value-row chart above remains dual-source for diagnostics.
const bshX10aView = h.historyView("bsh_state", "x10a");
const bshX10aHtml = h.histHtml("bsh_state", "", "Heizstab", "x10a");
assert.equal(bshX10aView.series.length, 1);
assert.equal(bshX10aView.series[0].source, "x10a");
assert.match(bshX10aHtml, /vhist-state-lane-label">X10A/);
assert.doesNotMatch(bshX10aHtml, /vhist-state-lane-label mb">Modbus/);
assert.match(bshX10aHtml, /data-source="x10a"/);
assert.match(h.scrubText(bshX10aView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · Aktiv$/);
assert.doesNotMatch(h.scrubText(bshX10aView, 1), /X10A|Modbus|Heizstab|ca\.|min/);

// Both outdoor pills open categorical timelines. Defrost is event-folded; Quiet keeps two
// source-attributed lanes because X10A and HomeHub report the same exact mode independently.
S.hist.set("defrost_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
const defrostView = h.historyView("defrost_state");
const defrostHtml = h.histHtml("defrost_state", "", "Abtauen");
assert.match(defrostHtml, /vhist-state-track/);
assert.doesNotMatch(defrostHtml, /vhist-line/);
assert.match(defrostHtml, /Abtauen aktiv erfasst · 10 min Rasterzeit/);
assert.match(defrostHtml, /vhist-state-on state-off/);
assert.match(defrostHtml, /vhist-state-on defrost-on/);
assert.doesNotMatch(defrostHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(defrostView, 1), /Abtauen aktiv\n.* · ca\. 5 min/);

S.hist.set("quiet_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [10, 10, 0, 0] });
S.hist.set("modbus:quiet_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [10, 0, 0, 10] });
const quietView = h.historyView("quiet_state");
const quietHtml = h.histHtml("quiet_state", "", "Leise-Modus");
assert.equal(quietView.series.length, 2);
assert.match(quietHtml, /vhist-state-track/);
assert.doesNotMatch(quietHtml, /vhist-line/);
assert.match(quietHtml, /Leise-Modus aktiv erfasst · 10 min Rasterzeit/);
assert.match(quietHtml, /vhist-state-lane-label mb">Modbus/);
assert.match(quietHtml, /vhist-state-on state-off/);
assert.match(quietHtml, /vhist-state-on quiet-on/);
assert.doesNotMatch(quietHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(quietView, 0), /X10A\nLeise-Modus aktiv\n.* · ca\. 10 min/);
assert.match(h.scrubText(quietView, 1), /Modbus\nLeise-Modus aus\n.* · ca\. 10 min/);

// BUH is one component with two event-folded stage bits. The browser combines both aligned rings
// into an off/step-1/step-2 timeline; it must not graph either raw bit as a numeric 0/1 curve.
const now = Date.now();
S.hist.set("buh_step1", { at: now, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 10, 0, 0, null] });
S.hist.set("buh_step2", { at: now, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 0] });
assert.equal(h.hasHist("buh_state"), true);
await h.ensureDerived("buh_state");
assert.deepEqual(Array.from(S.hist.get("buh_state").v), [0, 10, 20, 20, 0, null]);
const buhView = h.historyView("buh_state");
const buhHtml = h.histHtml("buh_state", "", "Zusatzheizer · BUH");
assert.match(buhHtml, /vhist-state-track/);
assert.doesNotMatch(buhHtml, /vhist-line/);
assert.match(buhHtml, /Zusatzheizer aktiv erfasst · 15 min Rasterzeit/);
assert.match(buhHtml, /vhist-state-on step1/);
assert.match(buhHtml, /vhist-state-on step2/);
assert.match(buhHtml, /vhist-state-on state-off/);
assert.doesNotMatch(buhHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(buhView, 0), /^\d{2}:\d{2}–\d{2}:\d{2} · Aus$/);
assert.match(h.scrubText(buhView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · Stufe 1$/);
assert.match(h.scrubText(buhView, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Stufe 2$/);
assert.match(h.scrubText(buhView, 5), /^\d{2}:\d{2}–\d{2}:\d{2} · nicht gemessen$/,
  "a BUH gap remains explicit without adding source or duration prose");
for (const i of [0, 1, 2, 5])
  assert.doesNotMatch(h.scrubText(buhView, i), /X10A|Modbus|Zusatzheizer|ca\.|min/);

// The schematic shows intuitive pump speed, while the X10A row is inverted (0=max, 100=stop).
// Its inspector curve must transform the source ring instead of making a stopped pump look maximal.
S.hist.set("pump_signal", { at: Date.now(), gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [1000, 700, 0] });
await h.ensureDerived("pump_speed");
assert.deepEqual(Array.from(S.hist.get("pump_speed").v), [0, 300, 1000]);
assert.match(h.histHtml("pump_speed", "", "Drehzahl der Umwälzpumpe"), /0\.0 – 100\.0 %/);

// The diverter is categorical too. Both selected branches are named, both independent sources keep
// their own lane, and no numeric 0/1 curve is drawn.
S.hist.set("valve_dhw", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 10] });
S.hist.set("modbus:valve_dhw", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 10] });
const valveView = h.historyView("valve_dhw");
const valveHtml = h.histHtml("valve_dhw", "", "3-Wege-Ventil");
assert.match(valveHtml, /vhist-state-track/);
assert.doesNotMatch(valveHtml, /vhist-line/);
assert.match(valveHtml, /Warmwasser · 15 min · Raumkreis · 15 min/);
assert.match(valveHtml, /vhist-state-on valve-space/);
assert.match(valveHtml, /vhist-state-on valve-dhw/);
assert.doesNotMatch(valveHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(valveView, 0), /X10A \+ Modbus\nRaumkreis\n.* · ca\. 10 min/);
assert.match(h.scrubText(valveView, 2), /X10A \+ Modbus\nWarmwasser\n.* · ca\. 10 min/);

// The legacy history id `valve_heat` stores the optional 2-way/heating-cooling OUTPUT. It is not the
// configured/current operating mode, so the timeline must retain ON/OFF and never turn idle periods
// into a Cooling position (or ON into proof of Heating).
S.hist.set("valve_heat", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 10] });
const valve2View = h.historyView("valve_heat");
const valve2Html = h.histHtml("valve_heat", "", "Ausgang 2-Wege-/Absperrventil");
assert.equal(valve2View.series.length, 1);
assert.match(valve2Html, /2WV-Ausgang ON · 15 min · 2WV-Ausgang OFF · 15 min/);
assert.match(valve2Html, /vhist-state-on state-off/);
assert.match(valve2Html, /vhist-state-on valve2-on/);
assert.doesNotMatch(valve2Html, /Kühlstellung|Heizstellung|>Kühlen<|>Heizen</);
assert.match(h.scrubText(valve2View, 0), /2WV-Ausgang OFF\n.* · ca\. 10 min/);
assert.match(h.scrubText(valve2View, 2), /2WV-Ausgang ON\n.* · ca\. 10 min/);

// Every categorical timeline uses the same live-cap contract, including derived BUH and the MQTT
// circulation witness. Structural concepts are mandatory; no label matching or cross-source
// borrowing may turn an unavailable current state into a plausible one.
S.status.hp = { connected: true };
S.status.circulation_source = {
  configured: true, has_value: true, fresh: true, state: "on",
};
S._values = [
  { concept: "defrost_state", binary: true, value: 1 },
  { concept: "quiet_state", binary: true, value: 1 },
  { concept: "bsh_state", binary: true, value: 1 },
  { concept: "buh_step1", binary: true, value: 0 },
  { concept: "buh_step2", binary: true, value: 1 },
  { concept: "valve_dhw", binary: true, value: 1 },
  { concept: "valve_heat", binary: true, value: 1 },
  { concept: "water_flow_switch", binary: true, value: 1 },
  { binary_semantic: "smart_grid_contact_1", binary: true, value: 1 },
  { binary_semantic: "smart_grid_contact_2", binary: true, value: 0 },
];
S._modbus = [
  { concept: "quiet_state", binary: true, value: 1 },
  { concept: "bsh_state", binary: true, value: 1 },
  { concept: "valve_dhw", binary: true, value: 1 },
  { off: 56, value: 2, enum: "smart_grid_mode" },
];
S.hist.set("water_flow_switch", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 0, 10, 0] });
const liveStateCases = [
  ["defrost_state", "x10a", 10],
  ["quiet_state", "x10a", 10],
  ["smart_grid_mode", "modbus", 20],
  ["bsh_state", "x10a", 10],
  ["buh_state", "x10a", 20],
  ["valve_dhw", "x10a", 10],
  ["circulation_state", "x10a", 10],
  ["valve_heat", "x10a", 10],
  ["water_flow_switch", "x10a", 10],
];
for (const [id, primarySource, expected] of liveStateCases) {
  const stateView = h.historyView(id);
  const primary = stateView.series.find((s) => s.source === primarySource);
  assert.equal(primary.v.at(-1), expected, `${id} must append its current structural state`);
  assert.equal(stateView.liveIndex, stateView.recordedN, `${id} must identify the live boundary`);
  const stateHtml = h.histHtml(id, "", id);
  assert.match(stateHtml, /vhist-state-current/, `${id} must visibly delimit the live cap`);
  assert.match(h.scrubText(stateView, stateView.liveIndex), /jetzt/,
    `${id} must expose the current state at the right edge tooltip`);
}
assert.match(h.histHtml("bsh_state", "", "Heizstab"),
  /Heizstab aktiv erfasst · 10 min Rasterzeit/,
  "the live BSH observation must not add a fabricated five-minute bucket to its total");
delete S._values;
delete S._modbus;
delete S.status.hp;
delete S.status.circulation_source;

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
