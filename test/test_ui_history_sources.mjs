// Paired schematic measurements and states have two independent 24-hour rings. Execute the production
// browser combiner and renderer so an X10A gap cannot erase a live Modbus sample, and so the second
// line remains visibly attributed instead of becoming an unlabeled near-overlap.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../main/www/js/history.js", import.meta.url), "utf8");
const appState = fs.readFileSync(new URL("../main/www/js/app_state.js", import.meta.url), "utf8");
const firmwareHistory = fs.readFileSync(new URL("../main/history.cpp", import.meta.url), "utf8");
const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
assert.match(style, /\.vhist-state-graph \.vhist-tip \{[^}]*white-space:\s*pre-wrap;/,
  "state tooltips must honor deliberate breaks");
assert.match(style,
  /\.vhist-graph\s*\{[^}]*grid-template-rows:\s*auto 12px auto 24px;/,
  "one readout row and one reserved time axis keep the curve stable");
assert.match(style, /\.vhist-tip\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*3;/,
  "the translucent tooltip must participate in the reserved readout layout");
assert.doesNotMatch(style, /--vhist-tip-space/,
  "tooltip height must never feed back into graph layout");
assert.doesNotMatch(style, /\.vhist-state-graph\s*\{[^}]*padding-top:/,
  "categorical timelines must not reintroduce a larger spacing override");
assert.doesNotMatch(appState, /syncGraphTipSpaces/,
  "a status rebuild must not re-measure a tooltip and shift its plot");
assert.doesNotMatch(historySource, /syncGraphTipSpace|HIST_TIP_GAP_PX/,
  "scrubbing must not contain a hidden tooltip-height-to-layout coupling");
assert.match(style,
  /\.vhist-state-current \{[^}]*border-left:\s*2px solid var\(--card\);/,
  "every categorical track must visibly separate its live observation from completed raster buckets");
// A source fill must never repaint a categorical state lane. That once erased all four Smart-Grid
// modes into a petrol bar that read as 24 h of Boost. Strip comments first so explanatory prose
// cannot accidentally satisfy the absence check.
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
const referenceFramesAt = mqtt.indexOf("service_reference_frames(ref_config);");
const circulationHistoryAt = mqtt.indexOf("history_record_circulation();", referenceFramesAt);
const ordinaryPublishAt = mqtt.indexOf("if (gate.publish_cycle)", circulationHistoryAt);
assert.ok(referenceFramesAt >= 0 && circulationHistoryAt > referenceFramesAt &&
  ordinaryPublishAt > circulationHistoryAt,
"circulation history must tick on the independent subscriber path before X10A state publication");

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
      { id: "tank_preheat_state", label: "Tank preheat ON/OFF" },
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
      { id: "leaving_water", label: "Leaving water temperature" },
      { id: "outdoor_air", label: "Outside air temperature" },
      { id: "quiet_state", label: "Quiet mode operation" },
      { id: "bsh_state", label: "Booster heater run" },
      { id: "valve_dhw", label: "3-way valve" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
      { id: "disinfection_state", label: "Disinfection operation" },
    ],
    env3_rows: [{ id: "temperature", label: "Temperature" }],
  }, ntp: { synced: true } },
  hist: new Map(), histBusy: new Set(), histPin: new Map(), histHidden: new Map(), clickHold: false, scrub: null,
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
  "hist.modbus_flow_unverified": "The scale of recorded Modbus flow is unverified.",
  "hist.thermal_bucket_note": "The estimate combines samples that may have been taken at different times.",
};
const context = {
  S, LANG: "de", renderApp() {}, renderCards() {}, renderInspect() {}, renderSettings() {},
  esc: (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
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
    if (key === "hist.defrost_total") return `Abtauen aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.defrost_none") return "Kein Abtauvorgang erfasst.";
    if (key === "hist.defrost_active") return "Abtauen aktiv";
    if (key === "hist.defrost_inactive") return "Abtauen aus";
    if (key === "hist.defrost_aria") return `${arg} — Abtauverlauf. ${arg2}`;
    if (key === "hist.quiet_total") return `Leise-Modus aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.quiet_none") return "Kein Leise-Modus erfasst.";
    if (key === "hist.quiet_active") return "Leise-Modus aktiv";
    if (key === "hist.quiet_inactive") return "Leise-Modus aus";
    if (key === "hist.quiet_aria") return `${arg} — Verlauf des Leise-Modus. ${arg2}`;
    if (key === "hist.heater_total") return `Heizstab aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.heater_none") return "Kein Heizstabeinsatz erfasst.";
    if (key === "hist.heater_active") return "Heizstab aktiv";
    if (key === "hist.heater_inactive") return "Heizstab aus";
    if (key === "hist.heater_aria") return `${arg} — Heizstab-Verlauf. ${arg2}`;
    if (key === "hist.preheat_total") return `Speichervorheizung aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.preheat_none") return "Keine Speichervorheizung erfasst.";
    if (key === "hist.preheat_active") return "Speichervorheizung aktiv";
    if (key === "hist.preheat_inactive") return "Speichervorheizung aus";
    if (key === "hist.preheat_aria") return `${arg} — X10A-Vorheizverlauf. ${arg2}`;
    if (key === "hist.disinfection_total") return `Desinfektion aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.disinfection_none") return "Keine Speicherdesinfektion erfasst.";
    if (key === "hist.disinfection_active") return "Desinfektion aktiv";
    if (key === "hist.disinfection_inactive") return "Desinfektion aus";
    if (key === "hist.disinfection_aria") return `${arg} — HomeHub-Desinfektionsverlauf. ${arg2}`;
    if (key === "hist.buh_total") return `Zusatzheizer aktiv erfasst · ${arg} im 5-Minuten-Raster`;
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
    if (key === "hist.circ_total") return `Pumpe laufend erfasst · ${arg} im 5-Minuten-Raster`;
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
    return { json: async () => ({ ...historyResponse,
      epoch: S.status?.history?.epoch, boot_id: S.status?.boot_id }) };
  },
  setTimeout, clearTimeout, Date, Map, Set, console,
};
vm.createContext(context);
const lifecycleSource = appState.slice(appState.indexOf("// ── History source lifecycle"),
  appState.indexOf("// ── Navigation (dashboard ⇄ Settings)"));
const bootstrap = readAppFragments(["bootstrap.js"]);
const statusAdoption = appState.slice(appState.indexOf("async function refreshStatus("),
  appState.indexOf("function markUnreachable("));
const trendPlot = bootstrap.slice(bootstrap.indexOf("function trendPlotFromTarget("),
  bootstrap.indexOf("// The hour readout"));
const trendWiring = bootstrap.slice(bootstrap.indexOf("function wireTrendScrub("),
  bootstrap.indexOf("// The remaining delegated wiring"));
Object.assign(context, { acceptImageLease: () => true, j: async () => context.nextStatus,
  pollSignal() {}, setLangFromStatus: async () => {}, hpProbeIsOpen: () => false, hydrateRoutedPopup() {} });
vm.runInContext(lifecycleSource + statusAdoption + trendPlot + trendWiring +
  readAppFragments(["descriptions.js", "history.js"]) +
  "\nthis.__api = { hasHist, hasModbusHist, hasRoomHist, histCacheKey, historyView, histHtml, scrubText, histReadout, histVisibleSeries," +
  " histTipsHtml, scrubMove, histSeriesToggle, ensureHist, ensureHistPair, ensureDerived, DERIVED, syncHistSources, invalidateHistSources," +
  " refreshStatus, wireTrendScrub };", context,
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

// Modbus is initially deactivated; only X10A is shown, so label is omitted and only value is rendered
assert.equal(h.histVisibleSeries(view).length, 1);
assert.equal(h.histVisibleSeries(view)[0].source, "x10a");
assert.equal(h.scrubText(view, 1, false), "nicht gemessen",
  "a single visible curve omits its source label in tooltip readout");
assert.equal(h.histReadout(view, 1), "nicht gemessen");

const initialHtml = h.histHtml("dhw_tank", "°C", "Tank");
assert.doesNotMatch(initialHtml, /class="vhist-line mb"/,
  "Modbus curve is initially hidden");
assert.match(initialHtml, /data-hist-series="modbus" aria-pressed="false"/,
  "Modbus legend button is initially inactive");
assert.match(initialHtml, /data-hist-series="x10a" aria-pressed="true" disabled/,
  "the only visible source cannot be disabled");

// Tapping Modbus activates it: both curves shown, tabular tooltip with labels and values
h.histSeriesToggle("dhw_tank", "modbus");
assert.equal(h.histVisibleSeries(view).length, 2);
assert.match(h.scrubText(view, 1), /X10A nicht gemessen/);
assert.match(h.scrubText(view, 1), /Modbus 45,5 °C/,
  "the same cursor instant reads both instruments and preserves the X10A gap");
assert.equal(h.scrubText(view, 1, false), "X10A nicht gemessen\nModbus 45,5 °C",
  "visible bubbles list one source per row and leave selected time to the axis");
assert.match(h.histReadout(view, 1), /class="vhist-tip-rows"/,
  "multiple visible series render tabular grid rows in tooltip");
assert.match(h.histReadout(view, 1), /<span class="vhist-tip-label">X10A<\/span><span class="vhist-tip-val">nicht gemessen<\/span>/);
assert.match(h.histReadout(view, 1), /<span class="vhist-tip-label mb">Modbus<\/span><span class="vhist-tip-val">45,5 °C<\/span>/);

{
  h.histSeriesToggle("dhw_tank", "modbus");
  const hidden = h.histHtml("dhw_tank", "°C", "Tank");
  assert.doesNotMatch(hidden, /class="vhist-line mb"/);
  assert.match(hidden, /data-hist-series="modbus" aria-pressed="false"/);
  assert.match(hidden, /data-hist-series="x10a" aria-pressed="true" disabled/,
    "the last visible source cannot be disabled");
  assert.doesNotMatch(h.scrubText(view, 1, false), /Modbus/);
  h.histSeriesToggle("dhw_tank", "x10a");
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /class="vhist-pt"/,
    "a stale or programmatic click cannot hide the last visible curve");
  assert.match(h.histHtml("dhw_tank", "°C", "Tank", "modbus"), /class="vhist-line mb"/,
    "a source-filtered view must keep its own sole curve visible");
  const measured = x10a.v;
  x10a.v = [null, null, null];
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /class="vhist-line mb"/,
    "an all-gap remaining source must reveal an available curve instead of leaving an empty chart");
  x10a.v = measured;
  h.histSeriesToggle("dhw_tank", "modbus");
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /class="vhist-line mb"/);
  assert.equal(S.hist.get("modbus:dhw_tank"), modbus,
    "legend choices never discard the recorded source history");
}

const html = h.histHtml("dhw_tank", "°C", "Warmwasserspeichertemperatur");
assert.match(html, /Aufzeichnung · 1 h/,
  "a partial ring reports its recorded span without claiming that the board restarted");
assert.doesNotMatch(html, /Neustart/);
assert.match(html, /vhist-source[^>]*><i><\/i>X10A/);
assert.match(html, /vhist-source mb[^>]*><i><\/i>HomeHub · Modbus/);
assert.match(html, /vhist-line mb/);
assert.match(html, /45,2 – 45,6 °C/,
  "both sources share one vertical scale, including the Modbus-only maximum");

{
  // When X10A is down (not connected), Modbus is displayed by default and X10A is deactivated
  S.histHidden.delete("dhw_tank");
  S.status.hp = { connected: false };
  const downView = h.historyView("dhw_tank");
  assert.equal(h.histVisibleSeries(downView).length, 1);
  assert.equal(h.histVisibleSeries(downView)[0].source, "modbus");
  assert.equal(h.scrubText(downView, 1, false), "45,5 °C",
    "when X10A is down, Modbus is shown and omits its label");
  const downHtml = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(downHtml, /class="vhist-line mb"/,
    "Modbus curve is displayed when X10A is down");
  assert.match(downHtml, /data-hist-series="modbus" aria-pressed="true" disabled/,
    "Modbus is active and cannot be disabled when X10A is down");
  assert.match(downHtml, /data-hist-series="x10a" aria-pressed="false"/,
    "X10A is inactive when down");

  // When X10A has no data points (all null), Modbus is also displayed by default
  delete S.status.hp;
  const origV = x10a.v;
  x10a.v = [null, null, null];
  const noDataView = h.historyView("dhw_tank");
  assert.equal(h.histVisibleSeries(noDataView).length, 1);
  assert.equal(h.histVisibleSeries(noDataView)[0].source, "modbus");
  assert.equal(h.scrubText(noDataView, 1, false), "45,5 °C",
    "when X10A has no data, Modbus is shown and omits its label");
  const noDataHtml = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(noDataHtml, /class="vhist-line mb"/,
    "Modbus curve is displayed when X10A has no data");
  assert.match(noDataHtml, /data-hist-series="modbus" aria-pressed="true" disabled/);
  assert.match(noDataHtml, /data-hist-series="x10a" aria-pressed="false"/);

  // Restore
  x10a.v = origV;
  S.histHidden.delete("dhw_tank");
}

// The Modbus flow scale is unverified. Its warning follows the displayed historical source and
// appears in the readout only where that source contributes a sample.
{
  const note = labels["hist.modbus_flow_unverified"];
  const chartNote = `<div class="vhist-note">${note}</div>`;
  S.status.history.rows.push({ id: "flow", label: "Water flow" });
  S.status.history.modbus_rows.push({ id: "flow", label: "Water flow rate" });
  S.hist.set("flow", { ...x10a, unit: "l/min", v: [180, null, 200] });
  S.hist.set("modbus:flow", { ...modbus, unit: "l/min", gen: 2, b0: 99, v: [10000, 190, 195, null] });

  const flow = h.historyView("flow");
  const flowHtml = (source) => h.histHtml("flow", "l/min", "Durchfluss", source);
  const nativeHtml = flowHtml("x10a");
  const hiddenHtml = flowHtml();
  assert.ok(!hiddenHtml.includes(note), "a hidden Modbus trace has no warning");
  assert.match(hiddenHtml, /data-hist-series="modbus" aria-pressed="false"/,
    "the hidden source remains available in the legend");
  assert.equal(hiddenHtml.match(/<svg[^>]*>[\s\S]*?<\/svg>/)?.[0],
    nativeHtml.match(/<svg[^>]*>[\s\S]*?<\/svg>/)?.[0],
    "a provisional outlier must not change the visible X10A flow geometry");
  assert.match(hiddenHtml, /class="vhist-range mono num">18,0 – 20,0 l\/min</);
  assert.equal(flow.b0, 100, "the hidden source must not prepend a cursor bucket");
  assert.deepEqual(Array.from(flow.v), [180, null, 200]);
  assert.equal(flow.gen, "x10a:1", "the hidden source must not invalidate an X10A plot or pin");
  assert.equal(h.scrubText(flow, 0, false), "18,0 l/min");

  const marker = { dataset: { source: "x10a" }, style: {} };
  const cross = { style: {} };
  const readouts = [{ style: { setProperty() {} } }, { style: { setProperty() {} } }];
  const plot = { dataset: { hist: "flow", n: "3" }, clientWidth: 240,
    querySelector: () => cross, querySelectorAll: () => [marker],
    parentElement: {
      querySelector: (selector) => readouts[selector.includes("vhist-time") ? 1 : 0],
      querySelectorAll: () => [cross, marker, ...readouts],
    } };
  h.scrubMove(plot, 0);
  const atFirst = { left: marker.style.left, top: marker.style.top, time: readouts[1].textContent };
  h.scrubMove({ ...plot, dataset: { ...plot.dataset, source: "x10a" } }, 0);
  assert.deepEqual({ left: marker.style.left, top: marker.style.top, time: readouts[1].textContent },
    atFirst, "the cursor and time must use the same visible X10A flow geometry");
  S.hist.set("modbus:flow", { ...S.hist.get("modbus:flow"), gen: 3, v: [20000, 190, 195, null] });
  assert.equal(flowHtml(), hiddenHtml, "a hidden-only change must retain the open plot markup");

  h.histSeriesToggle("flow", "modbus");
  const comparison = h.historyView("flow");
  assert.equal(comparison.b0, 99, "the explicitly selected source can extend the comparison span");
  assert.ok(flowHtml().includes(chartNote), "the paired chart keeps the warning visible before scrubbing");
  assert.equal(h.scrubText(comparison, 2, false), `X10A nicht gemessen\nModbus 19,5 l/min\n${note}`);
  assert.match(h.histReadout(comparison, 2), /class="vhist-tip-val">19,5 l\/min<\/span>/);
  assert.ok(h.histReadout(comparison, 2).includes(`style="white-space: normal">${note}</span>`),
    "the paired tooltip renders the localized warning in a wrapping note row");
  assert.ok(!h.histReadout(comparison, 3).includes(note), "a Modbus gap contributes no flow value to qualify");

  const modbusFlow = h.historyView("flow", "modbus");
  assert.ok(flowHtml("modbus").includes(chartNote), "the Modbus-only chart keeps the warning visible");
  assert.equal(h.scrubText(modbusFlow, 1, false), `19,0 l/min\n${note}`);
  assert.equal(h.histReadout(modbusFlow, 1), `19,0 l/min\n${note}`);
  assert.ok(!flowHtml("x10a").includes(note), "the warning does not apply to X10A-only flow");
  assert.ok(!h.histHtml("dhw_tank", "°C", "Tank", "modbus").includes(note),
    "the warning does not apply to other Modbus measurements");

  // The differently sized, shifted rings expose a cursor that uses the wrong chart extent.
  S.histHidden.delete("flow");
  S.hist.set("flow", { ...S.hist.get("flow"), t0: 30000 });
  S.hist.set("modbus:flow", { ...S.hist.get("modbus:flow"), t0: 29700, v: [170, 190, 195, 210] });
  const oldStatus = S.status;
  const events = new Map();
  h.wireTrendScrub({ addEventListener: (type, callback) => events.set(type, callback) });
  const pointerPlot = (n, source) => ({
    ...plot, dataset: { hist: "flow", n: String(n) },
    getBoundingClientRect: () => ({ left: 0, width: 240 }),
    closest(selector) { return selector === "[data-hist]" ? this : null; },
    setPointerCapture() {},
    querySelectorAll: () => [{ dataset: { source }, style: {} }],
  });
  const native = pointerPlot(3, "x10a"), peer = pointerPlot(4, "modbus");
  const send = (type, target, pointerId, clientX = 120) =>
    events.get(type)({ type, target, pointerId, clientX, button: 0 });
  h.syncHistSources();
  const epoch = S.histEpoch;
  send("pointerdown", native, 1, 0);
  assert.equal(readouts[0].innerHTML, "18,0 l/min");
  send("pointerdown", peer, 2);
  send("pointerup", native, 2);
  assert.ok(S.scrub, "a second pointer cannot release the first drag");
  assert.equal(S.histPin.has("flow"), false);
  let firstPaint;
  context.renderApp = () => { firstPaint = [S.scrub, h.historyView("flow").b0]; };
  context.nextStatus = { ...oldStatus, hp: { ...oldStatus.hp, connected: false } };
  S.clickHold = true;
  assert.equal(await h.refreshStatus(false), true);
  assert.equal(S.histEpoch, epoch, "a transient link loss keeps the stored source lifetime");
  assert.equal(S.scrub, null, "switching the paired Flow extent releases the frozen renderer");
  assert.deepEqual(firstPaint, [null, 99], "repaint the new extent before the deferred values poll");
  assert.equal(S.clickHold, false);
  assert.equal(cross.hidden, true);
  assert.equal(readouts[0].hidden, true);
  assert.equal(h.historyView("flow").b0, 99);
  assert.equal(h.historyView("flow").v.length, 4);
  send("pointerup", native, 1);
  send("pointerup", peer, 1);
  assert.equal(S.histPin.has("flow"), false, "release of the retired drag cannot pin either extent");

  send("pointerdown", peer, 3);
  send("lostpointercapture", native, 1);
  assert.ok(S.scrub, "the earlier plot's capture loss cannot cancel its successor");
  send("pointercancel", peer, 3);
  assert.equal(S.scrub, null, "browser pan/cancel releases the new drag");
  assert.equal(S.histPin.has("flow"), false);
  send("pointerdown", peer, 4);
  assert.ok(readouts[0].innerHTML.includes("19,5 l/min"));
  send("pointerup", peer, 4);
  assert.equal(S.histPin.get("flow")?.t, 30300, "the new drag pins the bucket shown in the Modbus extent");
  S.histPin.delete("flow");
  S.status = oldStatus;
  context.renderApp = () => {};
  h.syncHistSources();

  S.histHidden.delete("flow");
  S.hist.delete("flow");
  S.hist.delete("modbus:flow");
  S.status.history.rows.pop();
  S.status.history.modbus_rows.pop();
}

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
h.histSeriesToggle("leaving_water", "modbus");
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

// The configured MQTT room instrument contributes its own observations, not an X10A replacement.
// All three independent rasters share axes; an MQTT gap cannot borrow a device value at that time.
const beforeRoomHistory = new Map(S.hist);
const beforeRoomSource = S.status.reference_temperature;
const beforeRoomRows = S.status.history.room_rows;
S.status.reference_temperature = { configured: true, name: "Meross <img src=x onerror=alert(1)>",
  topic: "fixture/room-a", temperature_path: "temperature", fresh: true, temperature_valid: true,
  control_eligible: false, reason: "disabled" };
S.status.history.room_rows = [{ id: "room_temp", label: S.status.reference_temperature.name }];
S.status.history.rows.push({ id: "room_temp", label: "Indoor ambient temp. (R1T)" });
S.status.history.modbus_rows.push({ id: "room_temp", label: "Room temperature" });
S.hist.set("room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [200, 200, 200] });
S.hist.set("modbus:room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [205, 205, 205] });
S.hist.set("room:room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [235, null, 236] });
const roomView = h.historyView("room_temp");
assert.equal(roomView.series.length, 3);
assert.equal(roomView.series[2].source, "room");
assert.deepEqual(Array.from(roomView.series[2].v), [235, null, 236]);
assert.match(h.scrubText(roomView, 1), /Meross .* · MQTT nicht gemessen/);
const roomHtml = h.histHtml("room_temp", "°C", "Raumtemperatur");
assert.match(roomHtml, /20,0 – 23,6 °C/);
assert.match(roomHtml, /vhist-source room/);
assert.match(roomHtml, /Meross &lt;img src=x onerror=alert\(1\)&gt; · MQTT/);
assert.doesNotMatch(roomHtml, /<img/);
assert.match(roomHtml, /vhist-pt room/);
assert.match(roomHtml, /vhist-now room/);
assert.match(roomHtml, /vhist-mark vhist-live room/);
assert.match(roomHtml, /1 Lücke/);
for (const cls of ["line", "area", "pt", "mark"])
  assert.match(style, new RegExp(`\\.vhist-${cls}\\.room`), `${cls} must use the independent room colour`);
S.status.history.rows = S.status.history.rows.filter((r) => r.id !== "room_temp");
S.status.history.modbus_rows = S.status.history.modbus_rows.filter((r) => r.id !== "room_temp");
assert.equal(S.hist.has("room_temp"), true);
assert.equal(S.hist.has("modbus:room_temp"), true);
assert.deepEqual(Array.from(h.historyView("room_temp").series, (s) => s.source), ["room"],
  "withdrawn source rows cannot revive cached X10A or HomeHub curves beside the independent room source");
const roomOnlyHtml = h.histHtml("room_temp", "°C", "Raumtemperatur");
assert.match(roomOnlyHtml, /data-source="room"/);
assert.match(roomOnlyHtml, /vhist-source room/,
  "an MQTT-only history must still name its physical source");
assert.match(h.scrubText(h.historyView("room_temp"), 2), /23,6 °C$/);
assert.doesNotMatch(h.scrubText(h.historyView("room_temp"), 2), /Meross/);
S.histPin.set("room_temp", { i: 2, gen: h.historyView("room_temp").gen });
assert.match(h.histHtml("room_temp", "°C", "Raumtemperatur"), /vhist-mark vhist-pinned room/);
S.histPin.delete("room_temp");
S.hist.delete("room:room_temp");
fetchedUrls = [];
await h.ensureHistPair("room_temp");
assert.deepEqual(fetchedUrls, ["/history?row=room_temp&source=room"],
  "the independent source must fetch without an X10A or HomeHub room series");
S.status.history.room_rows = [];
assert.equal(h.histHtml("room_temp", "°C", "Raumtemperatur"), "",
  "an unoffered room source cannot keep displaying its cached history");
S.status.history.room_rows = beforeRoomRows;
S.status.reference_temperature = beforeRoomSource;
h.syncHistSources();
S.hist = beforeRoomHistory;

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

// A 5 A INV reading from a sweep without a speed witness and 18 rps from a later sweep can
// occupy the same bucket. That raw current must stay visible without creating an estimate.
{
  const originalRows = S.status.history.rows;
  const originalHistory = S.hist;
  const originalResponse = historyResponse;
  const originalUrls = fetchedUrls;
  const rows = ["inv_current", "comp_rps", "flow", "leaving_water", "return_water"].map(id => ({ id }));
  S.status.history.rows = rows;
  const base = { at: Date.now(), gen: 1, dt: 300, b0: 100 };
  S.hist = new Map([
    ["inv_current", { ...base, unit: "A", v: [null, 50, 0, 50], held: [[0, 1]] }],
    ["comp_rps", { ...base, v: [0, 180, 180, 0], held: [] }],
  ]);
  fetchedUrls = [];
  assert.equal(h.hasHist("inv_current"), true, "raw inverter current remains available");
  assert.deepEqual(Array.from(h.historyView("inv_current").v), [null, 50, 0, 50]);
  assert.equal(!!h.hasHist("pel"), false, "raw inverter and speed rings alone cannot offer electrical history");
  assert.equal(!!h.hasHist("cop"), false, "independent rings cannot offer a historical COP");
  await h.ensureHistPair("pel");
  await h.ensureHistPair("cop");
  assert.deepEqual(fetchedUrls, []);
  assert.equal(h.histHtml("pel", "", "Electrical input"), "");
  assert.equal(h.histHtml("cop", "", "COP"), "");

  // A later partial CT sweep can update L1/L2 and leave the preceding sweep's L3 in the same
  // bucket. Preserve the raw readings and refuse the resulting apparent 11.5 kW.
  S.status.history.rows = [...rows, { id: "ct_l1" }, { id: "ct_l2" }, { id: "ct_l3" }];
  for (const [id, value] of [["ct_l1", 200], ["ct_l2", 200], ["ct_l3", 100]]) {
    S.hist.set(id, { ...base, unit: "A", v: [100, value], held: [] });
    assert.deepEqual(Array.from(h.historyView(id).v), [100, value]);
  }
  assert.equal(h.hasHist("pel"), false, "same-bucket CT readings cannot qualify a historical power estimate");
  await h.ensureHistPair("pel");
  assert.deepEqual(fetchedUrls, []);
  assert.equal(h.histHtml("pel", "", "Electrical input"), "");
  assert.equal(h.histHtml("cop", "", "COP"), "");
  S.status.history.rows = originalRows;
  S.hist = originalHistory;
  historyFetchError = false;
  historyResponse = originalResponse;
  fetchedUrls = originalUrls;
}

// The signed historical estimate uses independently sampled values, including stored speed.
assert.equal(h.DERIVED.pth.ready({
  flow: true, leaving_water: true, return_water: true, comp_rps: false,
}), false, "thermal output is unavailable when the profile has no compressor witness");
assert.equal(h.DERIVED.pth.fn({
  flow: 0, leaving_water: 35, return_water: 30, comp_rps: 0,
}), 0, "a stopped circuit with measured zero flow is zero transfer");
assert.equal(h.DERIVED.pth.fn({
  flow: 0, leaving_water: null, return_water: null, comp_rps: null,
}), 0, "measured no flow proves zero transfer without temperature or compressor samples");
for (const flow of [-1, null, NaN, Infinity, 100.1, 3276.7]) {
  assert.equal(h.DERIVED.pth.fn({ flow, leaving_water: 35, return_water: 30, comp_rps: 45 }), null,
    "negative or invalid flow must leave a gap rather than imply zero transfer");
}
assert.equal(h.DERIVED.pth.fn({
  flow: 0.5, leaving_water: 35, return_water: 30, comp_rps: 45,
}), 0, "the measured low-flow threshold is included in the zero-transfer range");
assert.ok(h.DERIVED.pth.fn({
  flow: 0.6, leaving_water: 35, return_water: 30, comp_rps: 45,
}) > 0, "a value above the low-flow threshold can qualify for transfer");
assert.equal(h.DERIVED.pth.fn({
  flow: 20, leaving_water: 35, return_water: 30, comp_rps: 0,
}), null, "a bucket whose speed sample is zero leaves a gap when water moves");
assert.ok(h.DERIVED.pth.fn({
  flow: 20, leaving_water: 35, return_water: 30, comp_rps: 45,
}) > 0, "a positive speed sample allows the signed arithmetic estimate");
assert.ok(h.DERIVED.pth.fn({
  flow: 20, leaving_water: 30, return_water: 35, comp_rps: 45,
}) < 0, "defrost and cooling retain the signed reverse transfer");
{
  const old = S.hist.get("pth");
  const oldRows = S.status.history.rows;
  S.status.history.rows = ["flow", "leaving_water", "return_water", "comp_rps"].map(id => ({ id }));
  S.hist.set("pth", { at: 1, gen: 1, dt: 300, b0: 100, unit: "kW", held: [], v: [50, 0] });
  assert.ok(h.histHtml("pth", "kW", "Thermal estimate").includes(labels["hist.thermal_bucket_note"]),
    "the thermal chart must qualify its independently timed samples");
  S.status.history.rows = oldRows;
  if (old) S.hist.set("pth", old); else S.hist.delete("pth");
}

// A successful HomeHub poll proves transport freshness, not when the controller last refreshed its
// outdoor-temperature register. Keep that qualification in the graph popup: the chart must remain
// compact, while hovering any petrol plateau names its observed interval and unknown measurement age.
S.hist.set("outdoor_air", { at: 1, gen: 1, dt: 300, unit: "°C", t0: 1768720000, b0: 200,
  held: [[1, 3]], v: [205, null, null, null] });
S.hist.set("modbus:outdoor_air", { at: 1, gen: 1, dt: 300, unit: "°C", t0: 1768720000, b0: 200,
  held: [], v: [205, 205, 205, 295] });
h.histSeriesToggle("outdoor_air", "modbus");
const outdoorView = h.historyView("outdoor_air");
const outdoorHtml = h.histHtml("outdoor_air", "°C", "Außentemperatur");
assert.doesNotMatch(outdoorHtml.slice(outdoorHtml.indexOf('<div class="vhist-axis">')), /Messalter unbekannt/,
  "the freshness qualification must not become another static line below the chart");
assert.match(h.scrubText(outdoorView, 1),
  /Modbus 20,5 °C · Register unverändert .* ca\. 15 min · Messalter unbekannt/,
  "the popup distinguishes a repeated register value from a proven fresh measurement");

// Readouts belong above the selected instant, with position-independent widths at both edges.
assert.match(style, /\.vhist-tip \{[^}]*width:\s*max-content;/,
  "the readout's width must not depend on its position, or the last sample wraps it to one word per line");
assert.match(style, /\.vhist-tip \{[^}]*translateX\(calc\(var\(--tip-p\) \* -1%\)\)/,
  "the anchor must keep the readout inside the card at either end of the time axis");
S.histPin.set("outdoor_air", { t: 1768720000 + 3 * 300 });        // the newest sample: p = 100
assert.match(h.histHtml("outdoor_air", "°C", "Außentemperatur"),
  /<div class="vhist-tip vhist-pinned mono num" style="--tip-p:100\.000">/,
  "the pinned readout uses the same anchor as the selected instant");
S.histPin.delete("outdoor_air");

// The LIVE half is the handler, not a stylesheet, so execute it rather than grep it: scrubMove must
// place the bubble from the sample's position. Overlapping readouts use paint order rather than
// geometry measurements, changing the bubble's width or adding another vertical row.
{
  const styleSpy = () => {
    const props = new Map(), written = [];
    return { props, written,
      setProperty: (k, v) => { props.set(k, v); written.push(k); },
      set left(v) { written.push("left=" + v); }, get left() { return ""; } };
  };
  let offsetWidthReads = 0;
  const node = (cls) => {
    const classes = new Set(cls.split(" "));
    let html = "";
    return { get className() { return [...classes].join(" "); },
      set className(value) {
        classes.clear();
        for (const name of value.split(/\s+/)) if (name) classes.add(name);
      },
      get innerHTML() { return html; }, set innerHTML(value) { html = String(value); },
      get textContent() {
        const entities = { "&amp;":"&", "&lt;":"<", "&gt;":">", "&quot;":'"' };
        return html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot);/g, entity => entities[entity])
          .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(+code));
      },
      set textContent(value) { html = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
      hidden: true, dataset: {}, style: styleSpy(),
      classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name) },
      get offsetWidth() { offsetWidthReads++; return 0; } };
  };
  const tipNode = node("vhist-tip vhist-live");
  const timeNode = node("vhist-time vhist-live");
  const crossNode = node("vhist-cross vhist-live");
  const markNode = node("vhist-mark vhist-live");     // never spread: that reads the offsetWidth spy
  const pinned = { getBoundingClientRect() { throw Error("Readout overlap must not measure geometry"); } };
  markNode.dataset.source = "modbus";
  const plot = {
    clientWidth: 600, dataset: { hist: "outdoor_air", source: "modbus", n: "4" },
    querySelector: () => crossNode,
    querySelectorAll: () => [markNode],
    parentElement: { querySelector: (selector) => selector === ".vhist-time.vhist-live" ? timeNode
      : selector === ".vhist-tip.vhist-pinned" ? pinned : tipNode },
  };
  h.scrubMove(plot, 3);                                    // the newest sample of the 4-sample ring
  assert.equal(tipNode.style.props.get("--tip-p"), "100.000",
    "the live readout is placed from the sample's position, like the pinned one");
  assert.deepEqual(tipNode.style.written, ["--tip-p"],
    "scrubMove must write only --tip-p on the bubble — a px `left` reintroduces the edge squeeze");
  assert.equal(offsetWidthReads, 0,
    "the bubble's placement must not depend on measuring it: the squeezed width measured as fitting");
  assert.equal(tipNode.hidden, false, "the readout is still revealed by a scrub");
  assert.equal(timeNode.hidden, false, "scrubbing reveals the separate time-axis label");
  assert.match(timeNode.textContent, /^\d{2}:\d{2}$/);
  assert.doesNotMatch(tipNode.textContent, /\d{2}:\d{2} · Modbus/,
    "the selected time belongs on the axis rather than in the measurement bubble");
  assert.equal(timeNode.style.props.get("--tip-p"), "100.000");
  h.scrubMove(plot, 0);
  assert.equal(tipNode.style.props.get("--tip-p"), "0.000");
  assert.equal(tipNode.classList.contains("vhist-stacked"),false,
    "moving readouts must remain in the same compact row");
}

// Smart-Grid mode is a complete categorical state timeline, not a misleading numeric 0..3 line.
// X10A and Modbus keep independent, source-labelled lanes. Exact readings remain available in the
// shared tooltip. Only mode 2 of the authoritative HomeHub ring contributes to the Boost total.
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
  assert.match(boostHtml, new RegExp(`vhist-state-on ${cls}`),
    `each source lane visibly distinguishes ${cls}`);
assert.match(boostHtml, /vhist-state-gap/);
assert.match(boostHtml, /Freier Betrieb/);
assert.match(boostHtml, /Zwangsabschaltung/);
assert.match(boostHtml, /Empfehlung ein/);
assert.match(boostHtml, /Erzwungen ein/);
assert.doesNotMatch(boostHtml, /vhist-state-runs|· Phasen/,
  "phase details belong to the chart popup, never a long list below it");
assert.equal((boostHtml.match(/vhist-state-track/g) || []).length, 2,
  "paired X10A/HomeHub state histories must render two independent tracks");
assert.match(boostHtml, /vhist-state-lane-label">X10A[\s\S]*vhist-state-track x10a/,
  "X10A must be the upper status track");
assert.match(boostHtml, /vhist-state-lane-label mb">Modbus[\s\S]*vhist-state-track modbus/,
  "Modbus must be the lower status track");
assert.ok(boostHtml.indexOf('vhist-state-lane-label">X10A') <
          boostHtml.indexOf('vhist-state-lane-label mb">Modbus'),
  "the X10A lane must precede the Modbus lane in document and visual order");
assert.match(boostHtml, />nicht gemessen</,
  "gaps in either independent source remain explained in the legend");
for (const [i, label] of [[0, "Freier Betrieb"], [1, "Zwangsabschaltung"],
                           [2, "Empfehlung ein"], [3, "Erzwungen ein"]])
  assert.match(h.scrubText(boostView, i),
    new RegExp(`X10A\\n${label}[\\s\\S]*Modbus\\n${label}`),
    `the Smart-Grid tooltip must expose both witnesses for ${label}`);

// A caller can still request a deliberately Modbus-only Smart-Grid history. That filtered view
// loses the X10A lane and tooltip block, while the schematic inspector above remains dual-source.
const boostModbusView = h.historyView("smart_grid_mode", "modbus");
const boostModbusHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
assert.equal(boostModbusView.series.length, 1);
assert.equal(boostModbusView.series[0].source, "modbus");
assert.doesNotMatch(boostModbusHtml, /vhist-state-lane-label">X10A/);
assert.match(boostModbusHtml, /vhist-state-lane-label mb">Modbus/);
assert.match(boostModbusHtml, /data-source="modbus"/,
  "scrubbing and pinning must resolve the same Modbus-only view that the chart renders");
assert.match(h.scrubText(boostModbusView, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Empfehlung ein$/);
assert.doesNotMatch(h.scrubText(boostModbusView, 2), /X10A|Modbus|Boost|ca\.|min/);

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
  /vhist-state-on sg-recommended" style="left:87\.500%;width:12\.500%/,
  "the live Recommended-on state must own the right edge instead of extending Free running to now");
assert.match(liveBoostHtml, /vhist-state-current" style="left:87\.500%;width:12\.500%/,
  "the display distinguishes the live observation from completed raster buckets");
assert.match(liveBoostHtml, /Boost aktiv · 10 min/,
  "one live observation must not be counted as an invented five minutes of Boost runtime");
assert.equal(h.scrubText(liveBoostView, 7), "jetzt · Empfehlung ein",
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
assert.match(bshHtml, /Heizstab aktiv erfasst · 10 min im 5-Minuten-Raster/);
assert.match(bshHtml, /vhist-state-on state-off/);
assert.match(bshHtml, /vhist-state-on heater-on/);
assert.doesNotMatch(bshHtml, /vhist-state-runs|· Phasen/);
assert.equal((bshHtml.match(/vhist-state-track/g) || []).length, 2);
assert.match(bshHtml, /vhist-state-lane-label">X10A/);
assert.match(bshHtml, /vhist-state-lane-label mb">Modbus/);
assert.match(h.scrubText(bshView, 0), /X10A\nHeizstab aus[\s\S]*Modbus\nHeizstab aus/);
assert.match(h.scrubText(bshView, 1), /X10A\nHeizstab aktiv[\s\S]*Modbus\nHeizstab aktiv/);

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

// Related does not mean equivalent: X10A tank preheat and HomeHub disinfection retain separate ids,
// source lanes and state wording. Neither one may be overlaid as the other's second witness.
S.hist.set("tank_preheat_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 10, 0, 0] });
S.hist.set("modbus:disinfection_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 0, 10, 0] });
assert.equal(h.hasHist("tank_preheat_state"), true);
assert.equal(h.hasModbusHist("tank_preheat_state"), false);
assert.equal(h.hasHist("disinfection_state"), false);
assert.equal(h.hasModbusHist("disinfection_state"), true);
const preheatHtml = h.histHtml("tank_preheat_state", "", "Speichervorheizung");
const disinfectionHtml = h.histHtml("disinfection_state", "", "Speicherdesinfektion");
assert.match(preheatHtml, /vhist-state-lane-label">X10A/);
assert.match(preheatHtml, /vhist-state-on preheat-on/);
assert.doesNotMatch(preheatHtml, /HomeHub · Modbus|Desinfektion aktiv/);
assert.match(disinfectionHtml, /vhist-state-lane-label mb">Modbus/);
assert.match(disinfectionHtml, /vhist-state-on disinfection-on/);
assert.doesNotMatch(disinfectionHtml, />X10A<|Speichervorheizung aktiv/);

// Both outdoor pills open categorical X10A timelines. Legacy Modbus Quiet is not activity.
S.hist.set("defrost_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
const defrostView = h.historyView("defrost_state");
const defrostHtml = h.histHtml("defrost_state", "", "Abtauen");
assert.match(defrostHtml, /vhist-state-track/);
assert.doesNotMatch(defrostHtml, /vhist-line/);
assert.match(defrostHtml, /Abtauen aktiv erfasst · 10 min im 5-Minuten-Raster/);
assert.match(defrostHtml, /vhist-state-on state-off/);
assert.match(defrostHtml, /vhist-state-on defrost-on/);
assert.doesNotMatch(defrostHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(defrostView, 1), /Abtauen aktiv\n.* · ca\. 5 min/);

S.hist.set("quiet_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [10, 10, 0, 0] });
S.hist.set("modbus:quiet_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [10, null, 0, 10] });
const quietView = h.historyView("quiet_state");
const quietHtml = h.histHtml("quiet_state", "", "Leise-Modus");
assert.equal(h.hasModbusHist("quiet_state"), false, "legacy holding 9 cannot be charted as activity");
assert.deepEqual(Array.from(quietView.series, s => s.source), ["x10a"]);
assert.match(quietHtml, /vhist-state-track/);
assert.doesNotMatch(quietHtml, /vhist-line|Modbus/);
assert.match(quietHtml, /Leise-Modus aktiv erfasst · 10 min im 5-Minuten-Raster/);
assert.equal((quietHtml.match(/vhist-state-track/g) || []).length, 1);
assert.match(quietHtml, /vhist-state-on state-off/);
assert.match(quietHtml, /vhist-state-on quiet-on/);
assert.doesNotMatch(quietHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(quietView, 0), /Leise-Modus aktiv/);
assert.match(h.scrubText(quietView, 3), /Leise-Modus aus/);
assert.doesNotMatch(h.scrubText(quietView, 3), /Modbus/);

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
assert.match(buhHtml, /Zusatzheizer aktiv erfasst · 15 min im 5-Minuten-Raster/);
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

// The schematic shows the inverted pump command, not measured speed. The source ring is fixed-point
// tenths: retain fractions and reject unsupported values instead of clamping them to plausible %.
S.hist.set("pump_signal", { at: Date.now(), gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [1000, 255, 0, -10, 1010, 2550, null] });
await h.ensureDerived("pump_speed");
assert.deepEqual(Array.from(S.hist.get("pump_speed").v), [0, 745, 1000, null, null, null, null]);
assert.match(h.histHtml("pump_speed", "", "Ansteuerung der Umwälzpumpe"), /0,0 – 100,0 %/);

// The diverter is categorical too. Both selected branches are named, its two witnesses keep their
// independent lanes, and no numeric 0/1 curve is drawn.
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
assert.equal((valveHtml.match(/vhist-state-track/g) || []).length, 2);
assert.match(valveHtml, /vhist-state-lane-label">X10A/);
assert.match(valveHtml, /vhist-state-lane-label mb">Modbus/);
assert.doesNotMatch(valveHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(valveView, 0), /X10A\nRaumkreis[\s\S]*Modbus\nRaumkreis/);
assert.match(h.scrubText(valveView, 2), /X10A\nWarmwasser[\s\S]*Modbus\nWarmwasser/);
assert.equal(valveView.series.find((s) => s.source === "modbus").v[valveView.liveIndex], null,
  "the completed Modbus bucket stays separated from the current edge before live rows arrive");

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
  { concept: "tank_preheat_state", binary: true, value: 1 },
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
  { off: 37, concept: "valve_dhw", enum: "three_way_valve", value: 0 },
  { off: 56, value: 2, enum: "smart_grid_mode" },
  { off: 33, history: "disinfection_state", binary: true, value: 1 },
];
S.status.modbus = { enabled: true, connected: true };
S.hist.set("water_flow_switch", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 0, 10, 0] });
S.hist.set("modbus:bsh_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 10, 0, 10] });
const liveStateCases = [
  ["defrost_state", "x10a", 10],
  ["quiet_state", "x10a", 10],
  ["smart_grid_mode", "modbus", 20],
  ["bsh_state", "x10a", 10],
  ["bsh_state", "modbus", null],
  ["tank_preheat_state", "x10a", 10],
  ["disinfection_state", "modbus", 10],
  ["buh_state", "x10a", 20],
  ["valve_dhw", "x10a", 10],
  ["valve_dhw", "modbus", null],
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
const modbusValve = S._modbus.find((row) => row.off === 37);
const stageOne = S._values.findIndex((row) => row.concept === "buh_step1");
const [stageOneRow] = S._values.splice(stageOne, 1);
assert.equal(h.historyView("buh_state").series[0].v.at(-1), 20,
  "a current stage 2 ON survives a missing stage 1 report");
S._values.splice(stageOne, 0, stageOneRow);
const valveLive = () => h.historyView("valve_dhw");
const valveNow = (view) => view.series.find((s) => s.source === "modbus").v.at(-1);
for (const value of [0, 1, null]) {
  modbusValve.value = value;
  const view = valveLive();
  assert.equal(valveNow(view), null, "a full-sweep HomeHub row cannot prove the route at the live edge");
  assert.match(h.scrubText(view, view.liveIndex), /X10A\njetzt · Warmwasser[\s\S]*Modbus\njetzt · nicht gemessen/);
}
modbusValve.value = 0;
const modbusValveView = h.historyView("valve_dhw", "modbus");
assert.deepEqual(Array.from(modbusValveView.series[0].v), [0, 0, 10, 10, 0, 10, null],
  "the Modbus-only valve lane preserves completed buckets and has an explicit current gap");
assert.match(h.histHtml("valve_dhw", "", "3-Wege-Ventil", "modbus"), /vhist-state-gap[^>]*left:85\.714%/);
S.status.modbus.connected = false;
const offlineValve = valveLive();
assert.equal(valveNow(offlineValve), null, "a disconnected HomeHub cannot contribute its retained live route");
assert.equal(offlineValve.series.find((s) => s.source === "x10a").v.at(-1), 10);
delete S.status.modbus;
assert.match(h.histHtml("bsh_state", "", "Heizstab"),
  /Heizstab aktiv erfasst · 10 min im 5-Minuten-Raster/,
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

// The temperature chart must not fuse the physical Smart Grid contacts with the Modbus
// request, or let one source's reported BSH state fill the other's missing samples.
S.status.history.rows = [
  { id: "dhw_tank", label: "Domestic Hot Water temperature" },
  { id: "smart_grid_mode", label: "Smart Grid operation mode" },
  { id: "bsh_state", label: "BSH" },
];
S.status.history.modbus_rows = [
  { id: "dhw_tank", label: "Domestic Hot Water temperature" },
  { id: "smart_grid_mode", label: "Smart Grid operation mode" },
  { id: "bsh_state", label: "Booster heater run" },
];
S.hist.set("dhw_tank", { dt: 300, unit: "°C", b0: 100, v: [450, 460, 470, 480], held: [] });
S.hist.set("smart_grid_mode", { dt: 300, b0: 100, v: [20, null, 30, 20] });
S.hist.set("modbus:smart_grid_mode", { dt: 300, b0: 100, v: [0, 20, 20, null] });
S.hist.set("bsh_state", { dt: 300, b0: 100, v: [10, null, 0, 0] });
S.hist.set("modbus:bsh_state", { dt: 300, b0: 101, v: [0, 10, 10] });

view = h.historyView("dhw_tank");
const dhwHtml = h.histHtml("dhw_tank", "°C", "Warmwasserspeicher");
assert.equal((dhwHtml.match(/class="vhist-state-track /g) || []).length, 4,
  "each instrument and auxiliary signal gets a separate aligned track");
assert.match(dhwHtml, /X10A · Smart Grid · Boost aktiv \(10 min\)/);
assert.match(dhwHtml, /Modbus · Smart Grid · Boost aktiv \(10 min\)/);
assert.match(dhwHtml, /X10A · BSH · Heizstab aktiv \(5 min\)/);
assert.match(dhwHtml, /Modbus · BSH · Heizstab aktiv \(10 min\)/);
assert.match(dhwHtml, /sg-forced-on/, "Smart Grid modes besides Boost must remain distinct");
assert.match(dhwHtml, /vhist-state-gap/, "a gap is visible separately from a known off state");
assert.match(h.scrubText(view, 0), /X10A · Smart Grid: Empfehlung ein\nModbus · Smart Grid: Freier Betrieb/);
assert.match(h.scrubText(view, 0), /X10A · BSH: Heizstab aktiv\nModbus · BSH: nicht gemessen/);
assert.match(h.scrubText(view, 2), /X10A · BSH: Heizstab aus\nModbus · BSH: Heizstab aktiv/);
assert.equal(h.histReadout(view, 1), "46,0 °C\nX10A · Smart Grid: nicht gemessen\n" +
  "Modbus · Smart Grid: Empfehlung ein\nX10A · BSH: nicht gemessen\nModbus · BSH: Heizstab aus");
{
  S.hist.set("modbus:dhw_tank", { dt: 300, unit: "°C", b0: 100, v: [450, 460, 470, 480], held: [] });
  h.histSeriesToggle("dhw_tank", "modbus");
  const pairedView = h.historyView("dhw_tank");
  assert.match(h.histReadout(pairedView, 1),
    /<span class="vhist-tip-note">X10A · Smart Grid: nicht gemessen[\s\S]*Modbus · BSH: Heizstab aus<\/span>/,
    "both visible temperature curves retain every source-specific auxiliary readout");
  S.hist.delete("modbus:dhw_tank");
  S.histHidden.delete("dhw_tank");
}
assert.match(h.scrubText(view, 3), /X10A · Smart Grid: Empfehlung ein\nModbus · Smart Grid: nicht gemessen/);
{
  const saved = S.status.history, lease = S.modbusHistoryLease, boot = S.status.boot_id;
  const ring = S.hist.get("dhw_tank"), sg = S.hist.get("smart_grid_mode");
  S.status.history = { ...saved, modbus_binding: true, epoch: 8 };
  S.status.boot_id = "dhw-source";
  S.modbusHistoryLease = { boot: "dhw-source", epoch: 7 };
  assert.doesNotMatch(h.scrubText(view, 1), /Modbus ·/, "a mismatched peer lease withdraws both auxiliary tracks");
  S.modbusHistoryLease.epoch = 8;
  assert.match(h.scrubText(view, 1), /Modbus · Smart Grid: Empfehlung ein/);
  S.status.history.rows = saved.rows.filter(row => row.id !== "bsh_state");
  assert.doesNotMatch(h.scrubText(view, 1), /X10A · BSH/, "a withdrawn capability cannot revive its cache");
  S.status.history = saved;
  S.status.boot_id = boot;
  S.modbusHistoryLease = lease;
  S.hist.set("dhw_tank", { ...ring, b0: null, t0: 1000 });
  S.hist.set("smart_grid_mode", { ...sg, b0: null, t0: 1300 });
  const legacy = h.historyView("dhw_tank");
  assert.match(h.scrubText(legacy, 1), /X10A · Smart Grid: Empfehlung ein/,
    "legacy wall-time anchors preserve alignment when monotonic buckets are unavailable");
  S.hist.set("smart_grid_mode", { ...sg, b0: null });
  assert.match(h.scrubText(legacy, 1), /X10A · Smart Grid: nicht gemessen/,
    "an unanchored legacy history cannot infer timing from array length");
  S.hist.set("dhw_tank", ring);
  S.hist.set("smart_grid_mode", sg);
}

// ensureHistPair("dhw_tank") fetches auxiliary series
fetchedUrls = [];
S.hist.delete("dhw_tank");
S.hist.delete("modbus:dhw_tank");
S.hist.delete("smart_grid_mode");
S.hist.delete("modbus:smart_grid_mode");
S.hist.delete("bsh_state");
S.hist.delete("modbus:bsh_state");
await h.ensureHistPair("dhw_tank");
assert.ok(fetchedUrls.includes("/history?row=smart_grid_mode"),
  "ensureHistPair(dhw_tank) must request x10a smart_grid_mode");
assert.ok(fetchedUrls.includes("/history?row=smart_grid_mode&source=modbus"),
  "ensureHistPair(dhw_tank) must request smart_grid_mode");
assert.ok(fetchedUrls.includes("/history?row=bsh_state&source=modbus"),
  "ensureHistPair(dhw_tank) must request modbus:bsh_state");

// Lifecycle regression: changing away and back retires the cache even inside its one-minute TTL.
// Every transition runs the same production synchronisation used when /status lands.
S.status.profile = { id: "fixture-a" };
S.status.hp = { proto: "I", rx: 1, tx: 2 };
S.status.modbus = { host: "192.0.2.10", port: 502, unit_id: 1, enabled: true };
S.status.uptime_s = 100;
h.syncHistSources();
fetchedUrls = [];
historyResponse = { ...defaultHistoryResponse, v: [501] };
await h.ensureHist("dhw_tank", "modbus");
const homehubKey = h.histCacheKey("dhw_tank", "modbus");
await h.ensureHist("dhw_tank", "modbus");
assert.equal(fetchedUrls.length, 1, "unchanged source must retain the one-minute fetch limit");
S.histPin.set("dhw_tank", { i: 0, gen: 1 });
S.status.modbus.host = "192.0.2.11";
h.syncHistSources();
assert.equal(S.hist.size, 0);
assert.equal(S.histPin.size, 0, "source changes must retire pins with the old measurement");
S.status.modbus.host = "192.0.2.10";
h.syncHistSources();
historyResponse = { ...defaultHistoryResponse, v: [502] };
await h.ensureHist("dhw_tank", "modbus");
assert.deepEqual(Array.from(S.hist.get(homehubKey).v), [502],
  "A → B → A must refetch instead of reusing the earlier A lifetime");
for (const enabled of [false, true]) {
  S.status.modbus.enabled = enabled;
  h.syncHistSources();
}
assert.equal(S.hist.has(homehubKey), false, "disabled → A must retire the old A cache");

// Row ids stay stable when the X10A instrument or circulation witness changes. Identity comes from
// their actual status/configuration, never from a different label invented by the browser.
S.hist.set("dhw_tank", x10a);
S.status.hp.rx = 44;
h.syncHistSources();
assert.equal(S.hist.has("dhw_tank"), false, "repointing X10A pins must retire the old ring");
S.hist.set("dhw_tank", x10a);
S.status.profile.id = "fixture-b";
h.syncHistSources();
assert.equal(S.hist.has("dhw_tank"), false, "a new X10A profile must retire the old ring");
S.status.circulation_source = { configured: true, topic: "fixture/pump-a", power_path: "power" };
h.syncHistSources();
S.hist.set("circulation_state", x10a);
S.status.circulation_source.topic = "fixture/pump-b";
h.syncHistSources();
assert.equal(S.hist.has("circulation_state"), false,
  "changing a circulation witness must retire history even though its row id is unchanged");
S.hist.set("free_heap", x10a);
S.histPin.set("free_heap", { i: 0, gen: 1 });
S.status.uptime_s = 2;
h.syncHistSources();
assert.equal(S.hist.size, 0, "a reboot must retire all cached series before their monotonic epoch changes");
assert.equal(S.histPin.size, 0);

// Uptime alone cannot detect a reboot that returns after exceeding its last observed uptime.
S.status.boot_id = "0000000000000001";
h.syncHistSources();
S.hist.set("free_heap", x10a);
S.histPin.set("free_heap", { i: 0, gen: 1 });
S.status.boot_id = "0000000000000002";
S.status.uptime_s = 3;
h.syncHistSources();
assert.equal(S.hist.size, 0, "a new boot identity must retire history even with higher uptime");
assert.equal(S.histPin.size, 0);

// Another client can change A → B → A entirely between status polls. The firmware lifetime
// token changes even if the final configuration and boot identity match the previous sample.
S.status.history = { ...S.status.history, epoch: 7 };
h.syncHistSources();
S.hist.set(homehubKey, x10a);
S.histPin.set("dhw_tank", { i: 0, gen: 1 });
S.status.history.epoch = 9;
h.syncHistSources();
assert.equal(S.hist.size, 0, "an unobserved source ABA must retire the old firmware lifetime");
assert.equal(S.histPin.size, 0);

// Hold the transport while the source leaves and returns. Both success and failure of the retired
// request must leave its successor's cache/lease alone, even though both use the same endpoint key.
const pendingHistory = [];
context.fetch = (url) => new Promise((resolve, reject) => pendingHistory.push({ url, resolve, reject }));
const finishHistory = (pending, values) => pending.resolve({ json: async () => ({
  ...defaultHistoryResponse, v: values,
  epoch: S.status?.history?.epoch, boot_id: S.status?.boot_id,
}) });
for (const failOld of [false, true]) {
  h.invalidateHistSources();
  const old = h.ensureHist("dhw_tank", "modbus");
  const oldTransport = pendingHistory.shift();
  S.status.modbus.host = "192.0.2.11"; h.syncHistSources();
  S.status.modbus.host = "192.0.2.10"; h.syncHistSources();
  const current = h.ensureHist("dhw_tank", "modbus");
  const newTransport = pendingHistory.shift();
  if (failOld) oldTransport.reject(new Error("retired source error"));
  else finishHistory(oldTransport, [601]);
  await old;
  assert.equal(S.hist.has(homehubKey), false, "late success/error must not reinsert the retired series");
  assert.equal(S.histBusy.has(homehubKey), true,
    "an old finally must not release the new request for the same cache key");
  finishHistory(newTransport, [602]);
  await current;
  assert.deepEqual(Array.from(S.hist.get(homehubKey).v), [602]);
  assert.equal(S.histBusy.has(homehubKey), false);
}

// A derived chart owns a lease too: awaiting its independent input fetches cannot revive an old
// instrument lifetime after the source changed while those requests were outstanding.
S.status.history.rows = [
  { id: "leaving_water", label: "Leaving water temperature" },
  { id: "return_water", label: "Return water temperature" },
];
h.invalidateHistSources();
const oldDerived = h.ensureDerived("dt");
const retiredInputs = pendingHistory.splice(0);
assert.equal(retiredInputs.length, 2);
S.status.profile.id = "fixture-c";
h.syncHistSources();
for (const input of retiredInputs) finishHistory(input, [400]);
await oldDerived;
assert.equal(S.hist.has("dt"), false, "late derived assembly must not revive a retired source");
assert.equal(S.hist.size, 0, "late derived inputs must also stay retired");
const currentDerived = h.ensureDerived("dt");
for (const input of pendingHistory.splice(0))
  finishHistory(input, input.url.includes("leaving_water") ? [410] : [390]);
await currentDerived;
assert.deepEqual(Array.from(S.hist.get("dt").v), [20], "the successor must derive only its own inputs");

// MQTT room mapping and broker identity own the lifetime independently of X10A and HomeHub.
S.status.history.room_rows = [{ id: "room_temp", label: "Example room" }];
S.status.reference_temperature = { configured: true, name: "Example room", topic: "fixture/room-a",
  temperature_path: "temperature", timestamp_topic: "fixture/time", timestamp_path: "time" };
S.status.mqtt = { configured: true, broker: "mqtt://broker-a.invalid" };
h.syncHistSources();
S.hist.set("room:room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [236] });
S.histPin.set("room_temp", { i: 0, gen: 1 });
S.status.reference_temperature.fresh = false;
h.syncHistSources();
assert.equal(S.hist.has("room:room_temp"), true,
  "a transient stale sample cannot erase already measured history");
S.status.reference_temperature.name = "Renamed room";
S.status.history.room_rows[0].label = "Renamed room";
h.syncHistSources();
assert.equal(S.hist.has("room:room_temp"), true, "renaming does not change the measuring instrument");
assert.match(h.histHtml("room_temp", "°C", "Raumtemperatur"), /Renamed room · MQTT/);
S.status.reference_temperature.topic = "fixture/room-b";
h.syncHistSources();
assert.equal(S.hist.size, 0);
assert.equal(S.histPin.size, 0, "a replaced MQTT instrument retires its old cursor");
S.status.reference_temperature.topic = "fixture/room-a";
h.syncHistSources();
const oldRoom = h.ensureHist("room_temp", "room");
const retiredRoom = pendingHistory.shift();
S.status.mqtt.broker = "mqtt://broker-b.invalid"; h.syncHistSources();
S.status.mqtt.broker = "mqtt://broker-a.invalid"; h.syncHistSources();
const newRoom = h.ensureHist("room_temp", "room");
const successorRoom = pendingHistory.shift();
finishHistory(retiredRoom, [200]);
await oldRoom;
assert.equal(S.hist.has("room:room_temp"), false, "late MQTT history cannot revive its old broker");
assert.equal(S.histBusy.has("room:room_temp"), true, "old completion cannot release the new MQTT lease");
finishHistory(successorRoom, [237]);
await newRoom;
assert.deepEqual(Array.from(S.hist.get("room:room_temp").v), [237]);
S.status.history.room_rows = [];
S.status.reference_temperature.configured = false;
h.syncHistSources();
assert.equal(S.hist.size, 0, "deleting a room mapping retires its cached readings");
assert.equal(h.histHtml("room_temp", "°C", "Raumtemperatur"), "");

// Reserving tooltip shapes must scan the auxiliary day once, not once per sample. A later render
// must still read changed auxiliary data even when it uses the same numeric view object.
S.status.history = { rows: ["dhw_tank", "smart_grid_mode", "bsh_state"].map(id => ({id, label:id})),
  modbus_rows: [] };
S.hist.clear();
const fullRing = value => ({gen:1,dt:300,b0:100,unit:"°C",v:Array(288).fill(value)});
S.hist.set("dhw_tank", fullRing(450));
S.hist.set("smart_grid_mode", fullRing(20));
S.hist.set("bsh_state", fullRing(10));
vm.runInContext("this.originalAuxScan = dhwAuxPhases; this.auxScans = 0; " +
  "dhwAuxPhases = (...args) => { auxScans++; return originalAuxScan(...args); };", context);
try {
  const view = h.historyView("dhw_tank");
  const first = h.histTipsHtml(view, -1, 0);
  assert.equal(context.auxScans, 1, "288 tooltip readouts must share one auxiliary scan");
  assert.match(first, /Smart Grid: Empfehlung ein/);
  assert.match(first, /Heizstab aktiv/);
  S.hist.set("smart_grid_mode", fullRing(0));
  const second = h.histTipsHtml(view, -1, 0);
  assert.equal(context.auxScans, 2, "the next rendered view must refresh its auxiliary snapshot");
  assert.match(second, /Smart Grid: Freier Betrieb/);
  assert.match(second, /Heizstab aktiv/);
  // Re-seed the previous per-readout work: the same measured operation budget must reject it.
  vm.runInContext("this.originalReadout = histReadout; auxScans = 0; " +
    "histReadout = (view, index) => originalReadout(view, index);", context);
  h.histTipsHtml(view, -1, 0);
  assert.ok(context.auxScans >= 289, "the old per-sample scan must exceed the one-scan budget");
} finally {
  vm.runInContext("dhwAuxPhases = originalAuxScan; " +
    "if (this.originalReadout) histReadout = originalReadout;", context);
}

console.log("UI history sources: X10A, Modbus and MQTT room rings align, gap, render and fetch independently");
