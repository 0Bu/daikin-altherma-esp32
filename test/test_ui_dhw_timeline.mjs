// Unit and strict-DOM contract tests for DHW tank cooling in the Tank inspector:
// timeline wire validation, cooling band filtering/clipping/peak flagging, wall-clock vs relative
// alignment, X10A/Modbus separation, selectDhwCooling pointer/button selection, focus restoration
// across replaceHistoryHtml, Tank brief states, 4-cause copy across all 13 locales, and CSS rules.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppSource, readUiLocale } from "../tools/ui/read_app_source.mjs";
import { createStrictDocument } from "../tools/ui/strict_dom.mjs";

const doc = createStrictDocument("main/www/index.html");
const consoleErrors = [];
let nowMs = 1795262400000;

class StrictDOMPoint {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
}

const context = vm.createContext({
  document: doc,
  window: {
    scrollTo() {},
    open() {},
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerWidth: 1024,
    innerHeight: 800,
  },
  history: { state: null, pushState() {}, replaceState() {}, back() {}, forward() {} },
  location: { pathname: "/", search: "", hash: "", hostname: "daikin-dhw.local", reload() {} },
  navigator: { language: "en" },
  localStorage: { getItem: () => "en", setItem() {} },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  Blob,
  AbortController,
  Intl,
  DOMPoint: StrictDOMPoint,
  Date: class extends Date { static now() { return nowMs; } },
  setTimeout: () => 1,
  clearTimeout() {},
  setInterval: () => 1,
  clearInterval() {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  console: {
    log: () => {},
    warn: () => {},
    error: (...args) => { consoleErrors.push(args.map(String).join(" ")); },
  },
});

const appSource = readAppSource().replace(/\nboot\(\);\s*$/, "\n");
const locales = JSON.parse(appSource.match(/const UI_LANGS = Object\.freeze\((\[[^\n]+\])\)/)[1]);
vm.runInContext(
  `${appSource}
  ${locales.filter(l => l !== "en").map(readUiLocale).join("\n")}
  this.__dhw = {
    S, HIST_W, HIST_H, t, esc,
    lang: code => { LANG = code; },
    checkupDhwHasRate, checkupDhwTimeline, checkupDhwReport,
    checkupDhwCoolingExplanation, checkupDhwBriefHtml,
    dhwCoolingBands, dhwCoolingTime, selectDhwCooling,
    clearDhwCoolingSelection, toggleDhwCoolingOverlay,
    historyView, histHtml, histCacheKey, replaceHistoryHtml,
    renderInspect, syncHistSources, liveData,
  };`,
  context,
  { filename: "main/www/app.sources" },
);

const ui = context.__dhw;
const S = ui.S;

// 1. Timeline wire validation: valid frames, restored coordinates, quantized 3631s limit, rejections.
const trace = {
  epoch: 3, window_end_s: 100200, since_s: 0, observed_end_s: 100198,
  unix_s: 1795262400, live: true,
  windows: [
    { start_s: 11015, end_s: 14630, rate_k_h: 1.7, observed_s: 3600, pump_marker: false, draw_marker: false },
    { start_s: 20017, end_s: 23617, rate_k_h: 0.7, observed_s: 3590, pump_marker: true, draw_marker: false },
    { start_s: 41031, end_s: 44631, rate_k_h: 0.8, observed_s: 3600, pump_marker: false, draw_marker: true },
    { start_s: 93007, end_s: 96607, rate_k_h: 2.7, observed_s: 3600, pump_marker: true, draw_marker: true },
  ],
};
const baseCheck = {
  id: "dhw_loss", verdict: "ok", evidence: "observation", reason: "observation_only",
  max_k_h: 2.7, windows: 4, blocked: false, timeline: structuredClone(trace),
};
assert.deepEqual(ui.checkupDhwTimeline(baseCheck), trace);
assert.deepEqual(ui.checkupDhwTimeline({ ...baseCheck, windows: 0 }), trace,
  "timed records remain independent from aggregate count");

const restored = {
  epoch: 9, window_end_s: 90093, since_s: 85000, observed_end_s: null,
  unix_s: trace.unix_s, live: false,
  windows: [{ ...trace.windows[3], start_s: 85000, end_s: 88600 }],
};
assert.deepEqual(ui.checkupDhwTimeline({ ...baseCheck, timeline: restored }), restored);
assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: { ...restored, live: true } }), null,
  "live=true without observed_end_s must be rejected");
assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: { ...restored, window_end_s: 175000 } }), null,
  "expired restored window must be rejected");
const quantized = { ...trace, windows: [{ ...trace.windows[0], end_s: 14646 }] };
assert.deepEqual(ui.checkupDhwTimeline({ ...baseCheck, timeline: quantized }), quantized,
  "quantized 3631s endpoints are accepted");

for (const bad of [
  undefined, null, {}, [], { ...trace, epoch: 0 }, { ...trace, epoch: -1 }, { ...trace, epoch: 2 ** 32 },
  { ...trace, epoch: "3" }, { ...trace, window_end_s: NaN }, { ...trace, since_s: 100201 },
  { ...trace, observed_end_s: -1 }, { ...trace, observed_end_s: 100201 }, { ...trace, observed_end_s: null },
  { ...trace, live: null }, { ...trace, unix_s: 0 }, { ...trace, unix_s: "1795262400" },
  { ...trace, windows: {} }, { ...trace, windows: Array(25).fill(trace.windows[0]) },
]) {
  assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: bad }), null,
    `invalid timeline rejected: ${JSON.stringify(bad)}`);
}
for (const patch of [
  { start_s: -1 }, { start_s: 11015.5 }, { end_s: 14614 }, { end_s: 14647 }, { end_s: 100201 },
  { observed_s: 3616 }, { observed_s: -1 }, { rate_k_h: null }, { rate_k_h: NaN },
  { rate_k_h: Infinity }, { rate_k_h: -0.1 }, { rate_k_h: "1.7" },
  { pump_marker: 1 }, { draw_marker: null },
  { circulation: "invalid" }, { circulation: 1 },
]) {
  const badWin = { ...trace, windows: [{ ...trace.windows[0], ...patch }] };
  assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: badWin }), null,
    `invalid window rejected: ${JSON.stringify(patch)}`);
}
const circTrace = {
  ...trace,
  windows: trace.windows.map((w, idx) => ({
    ...w,
    circulation: ["unknown", "on", "off", "off_settled"][idx],
  })),
};
assert.deepEqual(ui.checkupDhwTimeline({ ...baseCheck, timeline: circTrace }), circTrace);
assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: { ...trace, windows: [...trace.windows].reverse() } }), null);
assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: { ...trace, windows: [trace.windows[0], trace.windows[0]] } }), null);
assert.equal(ui.checkupDhwTimeline({ ...baseCheck, timeline: { ...trace, window_end_s: 101030 } }), null);

// 2. checkupDhwReport, checkupDhwBriefHtml, and 4-cause explanation across all 13 locales.
const setStatus = (checkPatch = {}, healthPatch = {}, diagPatch = {}, statePatch = {}) => {
  S.otaCached = false;
  S.transportUnavailable = null;
  Object.assign(S, statePatch);
  S.status = {
    boot_id: "boot-dhw",
    uptime_s: 100200,
    ntp: { synced: true, time: new Date(trace.unix_s * 1000).toISOString() },
    history: { epoch: 1, rows: [{ id: "dhw_tank", label: "DHW tank temp. (R5T)" }], modbus_rows: [{ id: "dhw_tank", label: "Tank temperature" }] },
    diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", ...diagPatch },
    health: {
      source: "x10a", source_fresh: true, persist: "fresh",
      checks: [{ ...structuredClone(baseCheck), ...checkPatch }],
      ...healthPatch,
    },
  };
};

setStatus({}, {}, { enabled: false });
assert.equal(ui.checkupDhwReport(), null, "disabled diagnostics suppresses tank cooling");
setStatus({}, {}, {}, { otaCached: true });
assert.equal(ui.checkupDhwReport(), null, "OTA cached snapshot suppresses tank cooling");
setStatus({}, {}, {}, { transportUnavailable: "status" });
assert.equal(ui.checkupDhwReport(), null, "unavailable status suppresses tank cooling");
setStatus({}, { persist: "unknown" });
assert.equal(ui.checkupDhwReport(), null, "persist=unknown suppresses tank cooling");
setStatus({}, { checks: [] });
assert.equal(ui.checkupDhwReport(), null, "missing dhw_loss check returns null");
setStatus({}, { source: "env3" }, { effective_source: "env3" });
assert.equal(ui.checkupDhwReport(), null, "unsupported source returns null");

setStatus({ verdict: "unavailable", max_k_h: 2.0, windows: 2 });
assert.deepEqual(
  { maxRate: ui.checkupDhwReport().maxRate, unsupported: ui.checkupDhwReport().unsupported },
  { maxRate: null, unsupported: true },
);
assert.equal(ui.checkupDhwBriefHtml(ui.checkupDhwReport(), false),
  `<div class="inspect-diagnosis-result"><span>DHW tank cooling · X10A</span><strong class="num">${ui.t("check.status.unavailable")}</strong></div>`);

setStatus({ verdict: "unavailable", blocked: true, max_k_h: null, windows: 0 });
assert.equal(ui.checkupDhwBriefHtml(ui.checkupDhwReport(), false),
  `<div class="inspect-diagnosis-result"><span>DHW tank cooling · X10A</span><strong class="num">—</strong></div><p>${ui.t("check.dhw.no_window")}</p>`);

setStatus({ verdict: "collecting", blocked: false, max_k_h: null, windows: 0 });
assert.equal(ui.checkupDhwBriefHtml(ui.checkupDhwReport(), false),
  `<div class="inspect-diagnosis-result"><span>DHW tank cooling · X10A</span><strong class="num">${ui.t("check.status.collecting")}</strong></div><p>${ui.t("check.dhw.waiting")}</p>`);

// 24-h external circulation correlation in brief summary (running vs settled off vs uncovered strong phases).
setStatus(
  { max_k_h: 2.7, windows: 5, high_windows: 4, high_with_pump: 2, high_pump_off: 0, circulation_on_s: 1200, circulation_known_s: 14000 },
  {}, {}, { circulation_source: undefined },
);
S.status.circulation_source = { configured: true, name: "DHW circulation pump" };
let rep = ui.checkupDhwReport();
let corrBrief = ui.checkupDhwBriefHtml(rep, true);
assert.ok(corrBrief.includes("4 strong cooling phase(s)"));
assert.ok(corrBrief.includes("External circulation pump (DHW circulation pump) ran during 2 of 4 strong phases."));

setStatus({
  max_k_h: 2.7, windows: 5, high_windows: 4, high_with_pump: 0, high_pump_off: 2,
  circulation_on_s: 0, circulation_known_s: 14400,
});
S.status.circulation_source = { configured: true, name: "DHW circulation pump" };
corrBrief = ui.checkupDhwBriefHtml(ui.checkupDhwReport(), true);
assert.ok(corrBrief.includes("External circulation pump (DHW circulation pump) stayed off (≥ 2 h) during observed strong phases."));

// Known-off coverage solely outside settled strong phases must not claim pump stayed off during strong phases.
setStatus({
  max_k_h: 2.7, windows: 5, high_windows: 4, high_with_pump: 0, high_pump_off: 0,
  circulation_on_s: 0, circulation_known_s: 14400,
});
S.status.circulation_source = { configured: true, name: "DHW circulation pump" };
const uncoveredBrief = ui.checkupDhwBriefHtml(ui.checkupDhwReport(), true);
assert.ok(uncoveredBrief.includes("4 strong cooling phase(s)"));
assert.ok(!uncoveredBrief.includes("stayed off (≥ 2 h) during observed strong phases"));

setStatus({ max_k_h: 2.7, windows: 4 }, { source_fresh: false });
rep = ui.checkupDhwReport();
assert.equal(rep.stale, true);
assert.ok(ui.checkupDhwBriefHtml(rep, true).includes(ui.t("check.dhw.stale")));
assert.ok(!ui.checkupDhwBriefHtml(rep, true).includes(ui.t("check.dhw.locations_missing")));
assert.ok(ui.checkupDhwBriefHtml(rep, false).includes(ui.t("check.dhw.locations_missing")),
  "rate >= 0.8 with no visible bands explains missing locations");

setStatus({ max_k_h: 0.7, windows: 1 });
rep = ui.checkupDhwReport();
assert.ok(ui.checkupDhwBriefHtml(rep, false).includes("0.7 °C/h"));
assert.ok(!ui.checkupDhwBriefHtml(rep, false).includes(ui.t("check.dhw.locations_missing")),
  "rate < 0.8 never adds locations_missing");

for (const lang of locales) {
  ui.lang(lang);
  for (const [pump_marker, draw_marker] of [[true, true], [true, false], [false, true], [false, false]]) {
    for (const circulation of ["unknown", "on", "off"]) {
      const exp = ui.checkupDhwCoolingExplanation({ pump_marker, draw_marker, circulation });
      assert.ok(exp.trim(), `${lang}: explanation non-empty`);
      const sentences = exp.split(/[.!?。！？]+/).filter(s => s.trim());
      assert.ok(sentences.length >= 2 && sentences.length <= 3,
        `${lang}: explanation (${circulation}) must be 2..3 sentences (saw ${sentences.length})`);
    }
  }
}
ui.lang("en");

// 3. dhwCoolingBands: filtering (< 0.8 excluded, >= 0.8 included), peak tie handling, clipping,
//    wall-clock vs relative live alignment, and X10A vs Modbus source separation.
const countSamples = 288;
const ringB0 = 46; // 46 + 288 = 334 == 100200 / 300 -> 0 expired slots
const traceChartStartS = trace.window_end_s - (countSamples - 1) * 300; // 14100 -> inside window[0] (11015..14630)
const chartStart = trace.unix_s - (trace.window_end_s - traceChartStartS);
const chartVals = Array.from({ length: countSamples }, (_, i) => (i >= 110 && i <= 116 ? null : 500 - i));
setStatus();
S.statusRequestedAt = nowMs;
S.hist.clear();
S.histHidden.clear();
S.histPin.clear();
S.dhwCoolSelection = null;
S.hist.set("dhw_tank", {
  at: nowMs, receivedAt: nowMs, gen: 1, dt: 300, unit: "°C", b0: ringB0, t0: chartStart, held: [], v: chartVals,
});
S.hist.set(ui.histCacheKey("dhw_tank", "modbus"), {
  at: nowMs, receivedAt: nowMs, gen: 1, dt: 300, unit: "°C", b0: ringB0, t0: chartStart, held: [],
  v: chartVals.map(v => (v == null ? null : v + 10)),
});

const x10aView = ui.historyView("dhw_tank", "");
const x10aDhw = ui.checkupDhwReport();
const bands = ui.dhwCoolingBands(x10aView, x10aDhw);
assert.equal(bands.length, 3, "only >= 0.8 windows (1.7, 0.8, 2.7) become cooling bands; 0.7 is excluded");
assert.deepEqual(Array.from(bands, b => b.end_s), [14630, 44631, 96607]);
assert.deepEqual(Array.from(bands, b => b.isPeak), [false, false, true], "only highest rate 2.7 is marked peak");
assert.equal(bands[0].x, 0, "left-edge window clips cleanly at x = 0");
const span = (x10aView.v.length - 1) * 300;
assert.ok(Math.abs(bands[0].width - ((14630 - traceChartStartS) / span) * ui.HIST_W) < 1e-6,
  "left-clipped band width matches remaining elapsed seconds");
const expectedX2 = ((41031 - traceChartStartS) / span) * ui.HIST_W;
assert.ok(Math.abs(bands[1].x - expectedX2) < 1e-6);

// Tied peaks mark all tied windows with isPeak: true.
const tiedDhw = {
  ...x10aDhw,
  timeline: {
    ...trace,
    windows: [
      { ...trace.windows[0], rate_k_h: 2.7 },
      trace.windows[1],
      trace.windows[2],
      { ...trace.windows[3], rate_k_h: 2.7 },
    ],
  },
};
assert.deepEqual(Array.from(ui.dhwCoolingBands(x10aView, tiedDhw), b => b.isPeak), [true, false, true]);

// Mismatched wall/relative clock or stale relative or hidden source returns [].
assert.equal(ui.dhwCoolingBands({ ...x10aView, t0: null }, x10aDhw).length, 0,
  "undated trend cannot place wall-anchored timeline");
assert.equal(ui.dhwCoolingBands(x10aView, { ...x10aDhw, timeline: { ...trace, unix_s: undefined } }).length, 0,
  "unsynced timeline cannot place onto wall-clock trend");

const relView = { ...x10aView, t0: null, aged: false, refreshFailed: false };
const relDhw = { ...x10aDhw, timeline: { ...trace, unix_s: undefined, live: true } };
const relBands = ui.dhwCoolingBands(relView, relDhw);
assert.equal(relBands.length, 3, "live relative trend aligns with unsynced live timeline");
assert.equal(relBands[0].unixFrom, null);
assert.equal(relBands[0].unixTo, null);
assert.equal(ui.dhwCoolingBands(relView, { ...x10aDhw, timeline: { ...trace, unix_s: undefined, live: false } }).length, 0,
  "non-live relative timeline must not align bands");
assert.equal(ui.dhwCoolingBands({ ...relView, aged: true }, relDhw).length, 0,
  "aged relative view must not align bands");
assert.equal(ui.dhwCoolingBands({ ...relView, refreshFailed: true }, relDhw).length, 0,
  "failed relative view must not align bands");

// Relative time formatting never manufactures wall dates.
const timeFmt = new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" });
const relText = ui.dhwCoolingTime(timeFmt, relBands[2]);
assert.match(relText, /ago/);
assert.doesNotMatch(relText, /2026|GMT|UTC/);
assert.match(ui.dhwCoolingTime(timeFmt, { ...relBands[2], end_s: trace.window_end_s }), /now/);

// Wall-clock formatting uses Intl.DateTimeFormat.formatRange in the local timezone.
const priorTz = process.env.TZ;
try {
  process.env.TZ = "Europe/Berlin";
  const wallFmt = new Intl.DateTimeFormat("de", { dateStyle: "short", timeStyle: "short" });
  const wallFrom = Date.parse("2026-10-25T11:00:00Z") / 1000;
  const wallText = ui.dhwCoolingTime(wallFmt, { unixFrom: wallFrom, unixTo: wallFrom + 3600 });
  assert.match(wallText, /12:00.*13:00/);
} finally {
  if (priorTz == null) delete process.env.TZ; else process.env.TZ = priorTz;
}

// 4. histHtml("dhw_tank", ..., dhw) for X10A and Modbus, plus clipping, selection & focus restoration.
S.histHidden.set("dhw_tank", new Set(["x10a"]));
assert.equal(ui.dhwCoolingBands(ui.historyView("dhw_tank", ""), x10aDhw).length, 0,
  "hiding the X10A series suppresses X10A bands");
assert.doesNotMatch(ui.histHtml("dhw_tank", "°C", "DHW tank", "", false, null, { dhw: x10aDhw }),
  /dhwCoolingClip|data-dhw-band|data-dhw-cool-show/);
S.histHidden.clear();

const x10aHtml = ui.histHtml("dhw_tank", "°C", "DHW tank", "", false, null, { dhw: x10aDhw });
assert.match(x10aHtml, /<clipPath id="dhwCoolingClip">.*<\/clipPath>/);
assert.equal((x10aHtml.match(/class="vhist-dhw-band/g) || []).length, 3);
assert.equal((x10aHtml.match(/class="vhist-dhw-band is-peak"/g) || []).length, 1);
assert.match(x10aHtml, /data-dhw-source="x10a"/);
assert.match(x10aHtml, /<button type="button" data-dhw-cool-show class="vhist-source vhist-legend-dhw-cool" aria-pressed="true"><i aria-hidden="true"><\/i>DHW tank cooling<\/button>/);
assert.match(x10aHtml, /<div class="vhist-flow-readout vhist-dhw-readout" role="status" hidden>/);

// Toggling legend overlay off hides cooling bands and readout while keeping aria-pressed="false".
S.dhwCoolHidden = true;
const hiddenBandsHtml = ui.histHtml("dhw_tank", "°C", "DHW tank", "", false, null, { dhw: x10aDhw });
assert.doesNotMatch(hiddenBandsHtml, /dhwCoolingClip|data-dhw-band|vhist-dhw-readout/);
assert.match(hiddenBandsHtml, /<button type="button" data-dhw-cool-show class="vhist-source vhist-legend-dhw-cool" aria-pressed="false">/);
S.dhwCoolHidden = false;

// Modbus report clips ONLY to the Modbus area path (with .mb class) and labels data-dhw-source="modbus".
setStatus({}, { source: "modbus" }, { source: "modbus", effective_source: "modbus" });
const modbusDhw = ui.checkupDhwReport();
const modbusHtml = ui.histHtml("dhw_tank", "°C", "DHW tank", "", false, null, { dhw: modbusDhw });
assert.match(modbusHtml, /data-dhw-source="modbus"/);
const clipBody = modbusHtml.match(/<clipPath id="dhwCoolingClip">([\s\S]*?)<\/clipPath>/)?.[1] || "";
assert.ok(clipBody.includes('class="vhist-area mb"'), "Modbus clipPath must use Modbus area path");
assert.ok(!clipBody.includes('class="vhist-area"'), "Modbus clipPath must not include X10A area path");

// Pure Modbus-only board (hp.connected: false, empty X10A values & rows) in both waiting & active states.
setStatus(
  { verdict: "collecting", blocked: false, max_k_h: null, windows: 0, timeline: { ...trace, windows: [] } },
  { source: "modbus" },
  { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["modbus"] },
);
S.status.hp = { connected: false, values: 0 };
S.status.modbus = { enabled: true, connected: true, profile: "homehub", profile_basis: "affirmative" };
S.status.history = { epoch: 2, rows: [], modbus_rows: [{ id: "dhw_tank", label: "Domestic Hot Water temperature" }] };
S._values = [];
S._modbus = [{ off: 43, label: "Domestic Hot Water temperature", value: 46.2, unit: "°C", concept: "dhw_tank", history: "dhw_tank" }];
S.live = ui.liveData();
S.insp = "tank";
S.inspSig = ""; S.inspHistSig = "";
ui.renderInspect();
assert.equal(doc.getElementById("inspFlowDiagnosis").hidden, false);
assert.match(doc.getElementById("inspFlowDiagnosis").innerHTML, /DHW tank cooling · Modbus/);
assert.ok(doc.getElementById("inspFlowDiagnosis").innerHTML.includes(ui.t("check.dhw.waiting")));

setStatus(
  { verdict: "ok", blocked: false, max_k_h: 2.7, windows: 4, high_windows: 3, timeline: structuredClone(circTrace) },
  { source: "modbus" },
  { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["modbus"] },
);
S.status.hp = { connected: false, values: 0 };
S.status.modbus = { enabled: true, connected: true, profile: "homehub", profile_basis: "affirmative" };
S.status.history = { epoch: 2, rows: [], modbus_rows: [{ id: "dhw_tank", label: "Domestic Hot Water temperature" }] };
S.inspSig = ""; S.inspHistSig = "";
ui.renderInspect();
assert.match(doc.getElementById("inspFlowDiagnosis").innerHTML, /Strongest tank cooling · Modbus.*2\.7 °C\/h/);
assert.match(doc.getElementById("inspHist").innerHTML, /data-dhw-source="modbus"/);
assert.equal((doc.getElementById("inspHist").innerHTML.match(/class="vhist-dhw-band/g) || []).length, 3);
S.insp = null; S.inspSig = ""; S.inspHistSig = "";

// Single-point / all-null curves have no area under curve and omit cooling bands.
S.hist.set("dhw_tank", {
  at: nowMs, receivedAt: nowMs, gen: 1, dt: 300, unit: "°C", b0: ringB0, t0: chartStart, held: [],
  v: chartVals.map((_, i) => (i === 50 ? 450 : null)),
});
setStatus();
assert.equal(ui.dhwCoolingBands(ui.historyView("dhw_tank", ""), ui.checkupDhwReport()).length, 0);
S.hist.set("dhw_tank", {
  at: nowMs, receivedAt: nowMs, gen: 1, dt: 300, unit: "°C", b0: ringB0, t0: chartStart, held: [], v: chartVals,
});

// Mount into strict DOM #inspHist and exercise tap-toggle & legend-toggle behaviour.
const inspHist = doc.getElementById("inspHist");
inspHist.hidden = false;
ui.replaceHistoryHtml(inspHist, x10aHtml);
let plot = inspHist.querySelector("[data-hist=dhw_tank]");
let bandEls = plot.querySelectorAll("[data-dhw-band]");
let readout = inspHist.querySelector(".vhist-dhw-readout");
assert.equal(bandEls.length, 3);
assert.equal(readout.hidden, true);

const svg = plot.querySelector("svg");
svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: ui.HIST_W, bottom: ui.HIST_H, width: ui.HIST_W, height: ui.HIST_H });
for (const b of bandEls) {
  const bx = Number(b.getAttribute("x"));
  const bw = Number(b.getAttribute("width"));
  b.getBoundingClientRect = () => ({ left: bx, top: 0, right: bx + bw, bottom: ui.HIST_H, width: bw, height: ui.HIST_H });
}
for (const p of svg.querySelectorAll("#dhwCoolingClip path")) {
  p.isPointInFill = pt => pt.y >= 40;
}
assert.equal(ui.selectDhwCooling(plot), false, "legend click no longer steps through bands");
assert.equal(ui.selectDhwCooling(plot, Number(bandEls[0].getAttribute("x")) + 2, 10, 4), false,
  "tap above the curve must not select a band");
assert.equal(S.dhwCoolSelection, null);
// First tap on band[0] -> selects it & shows readout.
assert.equal(ui.selectDhwCooling(plot, Number(bandEls[0].getAttribute("x")) + 2, 60, 4), true,
  "tap inside the curve selects the band under it");
assert.equal(S.dhwCoolSelection.end_s, 14630);
assert.equal(bandEls[0].classList.contains("selected"), true);
assert.equal(readout.hidden, false);
// Second tap on SAME band[0] -> toggles off selection & hides readout.
assert.equal(ui.selectDhwCooling(plot, Number(bandEls[0].getAttribute("x")) + 2, 60, 4), true,
  "second tap on selected band toggles explanation off");
assert.equal(S.dhwCoolSelection, null);
assert.equal(bandEls[0].classList.contains("selected"), false);
assert.equal(readout.hidden, true);
// Tap band[1], then band[2] -> switches directly.
assert.equal(ui.selectDhwCooling(plot, Number(bandEls[1].getAttribute("x")) + 2, 60, 4), true);
assert.equal(S.dhwCoolSelection.end_s, 44631);
assert.equal(ui.selectDhwCooling(plot, Number(bandEls[2].getAttribute("x")) + 2, 60, 4), true);
assert.equal(S.dhwCoolSelection.end_s, 96607);
assert.equal(readout.querySelector("span").textContent,
  ui.checkupDhwCoolingExplanation({ pump_marker: true, draw_marker: true }));
// clearDhwCoolingSelection closes open readout on outside tap.
ui.clearDhwCoolingSelection(plot);
assert.equal(S.dhwCoolSelection, null);
assert.equal(readout.hidden, true);
// Re-select band[0] to test selection + focus restoration on [data-dhw-cool-show].
assert.equal(ui.selectDhwCooling(plot, Number(bandEls[0].getAttribute("x")) + 2, 60, 4), true);

// Focus restoration on [data-dhw-cool-show] when replaceHistoryHtml updates the plot.
const showBtn = inspHist.querySelector("[data-dhw-cool-show]");
showBtn.focus();
assert.equal(doc.activeElement, showBtn);
const updatedHtml = ui.histHtml("dhw_tank", "°C", "DHW tank", "", false, null, {
  dhw: {
    ...x10aDhw,
    maxRate: 2.8,
    timeline: { ...trace, windows: [...trace.windows.slice(0, -1), { ...trace.windows[3], rate_k_h: 2.8 }] },
  },
});
ui.replaceHistoryHtml(inspHist, updatedHtml);
const newShowBtn = inspHist.querySelector("[data-dhw-cool-show]");
assert.notEqual(newShowBtn, showBtn, "updated DOM creates a new button");
assert.equal(doc.activeElement, newShowBtn, "focus must be restored onto [data-dhw-cool-show]");
assert.equal(inspHist.querySelector('[data-dhw-band="14630"]').classList.contains("selected"), true,
  "S.dhwCoolSelection must restore .selected after replaceHistoryHtml");
assert.equal(inspHist.querySelector(".vhist-dhw-readout").hidden, false);
assert.equal(S.dhwCoolSelection.epoch, trace.epoch);

// Changing timeline.epoch invalidates the previous chart selection immediately.
const nextEpochHtml = ui.histHtml("dhw_tank", "°C", "DHW tank", "", false, null, {
  dhw: {
    ...x10aDhw,
    timeline: { ...trace, epoch: trace.epoch + 1 },
  },
});
ui.replaceHistoryHtml(inspHist, nextEpochHtml);
assert.equal(inspHist.querySelector('[data-dhw-band="14630"]').classList.contains("selected"), false,
  "timeline.epoch change must clear previous S.dhwCoolSelection");
assert.equal(inspHist.querySelector(".vhist-dhw-readout").hidden, true);

// 5. style.css contracts: new DHW cooling rules present, zero leftover .checkup-dhw-* rules.
const css = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
assert.match(css, /--dhw-cooling:\s*#BE185D/i);
assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^}]*--dhw-cooling:\s*#F472B6/i);
for (const selector of [
  ".vhist-dhw-band",
  ".vhist-dhw-band.is-peak",
  ".vhist-dhw-band.selected",
  ".vhist-flow-readout.vhist-dhw-readout",
  ".vhist-source.vhist-legend-dhw-cool",
]) {
  assert.ok(css.includes(selector), `style.css missing ${selector}`);
}
assert.doesNotMatch(css, /\.checkup-dhw-/, "style.css must not retain dead .checkup-dhw-* rules");
assert.deepEqual(consoleErrors, [], `unexpected console.error: ${consoleErrors.join("; ")}`);

console.log(`DHW cooling UI: timeline validation, X10A/Modbus clipping, peak cycling, focus restore and CSS verified across ${locales.length} locales`);
