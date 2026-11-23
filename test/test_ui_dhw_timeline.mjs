// Execute the real DHW wire validation, geometry, selection, lazy mounting and lifecycle code.
// This small DOM witness is not a visual browser: the assembled-UI Chromium/WebKit suite owns
// native hit testing, disclosure layout, real DOM reconciliation and rendered locale geometry.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const base = readAppFragments(["i18n.js"]);
const locales = JSON.parse(base.match(/const UI_LANGS = Object.freeze\((\[[^\n]+\])\)/)[1]);
const source = readAppFragments(["dashboard.js", "descriptions.js", "history.js"]);
const state = readAppFragments(["app_state.js"]);
const statusTransport = state.slice(state.indexOf("function invalidateLiveReadings("),
  state.indexOf("function markUnreachable("));
const S = { status: {}, descOpen: new Set(), stage: "dashboard", scrub: null, hist: new Map(), histPin: new Map() };
let now = 1000, timerId = 0;
const timers = new Map();
const document = { activeElement: null, listeners: new Map(),
  getElementById: id => id === "valueGroups" ? host : null,
  addEventListener(type, handler) { this.listeners.set(type, handler); },
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); },
};
class Node {
  constructor(dataset = {}, classes = []) {
    this.dataset = dataset; this.classes = new Set(classes); this.attributes = new Map();
    this.style = {}; this.listeners = new Map(); this.children = []; this.writes = 0;
    this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
      contains: name => this.classes.has(name) };
  }
  add(child) { child.parent = this; this.children.push(child); return child; }
  set textContent(value) { this._text = String(value); this.writes++; }
  get textContent() { return this._text || ""; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some(s => this.matches(s.trim()));
    if (selector === "[hidden]") return this.hidden === true;
    if (selector === "[inert]") return this.inert === true;
    if (selector.startsWith(".")) return selector.slice(1).split(".").every(c => this.classes.has(c));
    const attr = selector.match(/^\[data-([\w-]+)(?:=["']([^"']*)["'])?\]$/);
    if (attr) {
      const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return key in this.dataset && (attr[2] === undefined || this.dataset[key] === attr[2]);
    }
    return false;
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [child, ...child.querySelectorAll(selector)])
      .filter(child => child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  fire(type, target = this, more = {}) {
    const event = { type, target, button: 0, pointerId: 7, clientX: 0, clientY: 0,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...more };
    this.listeners.get(type)?.(event);
    return event;
  }
  focus() { document.activeElement = this; this.closest("[data-dhw-timeline]")?.fire("focusin", this); }
  setPointerCapture(id) { this.capture = id; }
  releasePointerCapture() { this.capture = null; }
}
const host = new Node();
const item = host.add(new Node({}, ["vitem", "open"]));
const panel = item.add(new Node({}, ["checkup-dhw-detail"]));
const timedEvidence = panel.add(new Node({ dhwEvidence: "" }));
const timelineDisclosure = panel.add(new Node({ dhwDisclosure: "timeline" }));
timelineDisclosure.open = false;
const slot = timelineDisclosure.add(new Node({ checkupDhw: "", dhwScope: "" }));
const slotText = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
Object.defineProperty(slot, "textContent", {
  get() { return slotText.get.call(this); },
  set(text) { slotText.set.call(this, text); this.children = []; },
});
function makeChart(trace, scope) {
  const chart = new Node({ dhwTimeline: scope }, ["vhist", "checkup-dhw-chart"]);
  const plot = chart.add(new Node({}, ["checkup-dhw-plot"]));
  plot.getBoundingClientRect = () => ({ left: 0, width: 864 });
  plot.add(new Node({}, ["checkup-dhw-before"]));
  plot.add(new Node({}, ["checkup-dhw-unread"]));
  for (const w of trace.windows) plot.add(new Node({ dhwWindow: String(w.end_s) }));
  for (const h of [0, 12, 24]) chart.add(new Node({ dhwAxis: String(h) }));
  for (const name of ["pump", "draw"]) {
    const lane = chart.add(new Node({ dhwLane: name }));
    for (const w of trace.windows.filter(w => w[`${name}_marker`]))
      lane.add(new Node({ dhwMarker: String(w.end_s) }));
  }
  if (trace.windows.length) {
    for (const key of ["rate", "time", "coverage", "context"]) chart.add(new Node({ dhwReadout: key }));
    for (const key of ["previous", "next"]) chart.add(new Node({ dhwAction: key }));
  }
  return chart;
}
const context = vm.createContext({ S, document, console, _html: {},
  navigator: { language: "en" }, localStorage: { getItem: () => "en" },
  historyClock: () => now,
  setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; },
  clearTimeout: id => timers.delete(id),
  // Relative timelines must not manufacture wall time even when the machine has a clock.
  Date: class extends Date { static now() { throw new Error("DHW must not fabricate wall time"); } },
  mount(node, html) {
    node._html = html;
    node.children = [];
    const trace = context.ui.parse(S.status.health.checks[0]);
    if (trace) node.add(makeChart(trace, context.ui.scope(trace)));
  },
});
vm.runInContext(base + locales.filter(l => l !== "en").map(readUiLocale).join("\n") + source + statusTransport + `
  let dhwBuilds = 0;
  const actualDhwBuilder = checkupDhwChartHtml;
  checkupDhwChartHtml = (...args) => { dhwBuilds++; return actualDhwBuilder(...args); };
  const actualDhwReconciler = replaceHistoryHtml;
  const actualDhwPreserver = preserveCheckupDhwIsland;
  replaceHistoryHtml = (node, html) => mount(node, html);
  this.ui = { parse: checkupDhwTimeline, scope: checkupDhwScope, detail: checkupDetailHtml,
    chart: checkupDhwChartHtml, render: renderCheckupDhwChart, sync: syncCheckupDhwChart, cards: renderCards,
    retire: retireCheckupDhwTimeline, geometry: updateCheckupDhwGeometry,
    reconcile: actualDhwReconciler,
    readStatus: readStatusFrame, readValues: refreshValues,
    skipIsland: skip => { preserveCheckupDhwIsland = skip ? () => false : actualDhwPreserver; },
    paint: paintCheckupDhwChart, wire: wireCheckupDhwChart, patchText: checkupDhwText,
    lang: code => { LANG = code; }, text: t,
    builds: () => dhwBuilds, selection: () => ({ ...dhwSelection }),
  };`, context);
const ui = context.ui;
const retainedText = { nodeType: 3, nodeValue: "old relative time" };
const textWitness = { firstChild: retainedText, childNodes: [retainedText],
  get textContent() { return retainedText.nodeValue; },
  set textContent(_) { assert.fail("scalar readout changes must retain their text node"); } };
ui.patchText(textWitness, "new relative time");
assert.equal(retainedText.nodeValue, "new relative time");

// Intentionally unlike the maximum and counts of the aggregate diagnosis. All fixture values
// stay in tests; production bars require actual completions and paired markers.
const trace = { epoch: 3, window_end_s: 100000, since_s: 0, observed_end_s: 99998,
  unix_s: 1795262400, live: true, windows: [
    { start_s: 11015, end_s: 14630, rate_k_h: 1.7, observed_s: 3600, pump_marker: false, draw_marker: false },
    { start_s: 20017, end_s: 23617, rate_k_h: 0, observed_s: 3590, pump_marker: true, draw_marker: false },
    { start_s: 41031, end_s: 44631, rate_k_h: 0.9, observed_s: 3600, pump_marker: false, draw_marker: true },
    { start_s: 93007, end_s: 96607, rate_k_h: 2.7, observed_s: 3600, pump_marker: true, draw_marker: true },
  ] };
const check = { id: "dhw_loss", verdict: "ok", evidence: "observation", reason: "observation_only",
  max_k_h: 4.5, windows: 8, high_windows: 8, pump_windows: 8, draw_windows: 7,
  quiet_high_windows: 0, observed_s: 28800, required_s: 0, timeline: structuredClone(trace) };
S.status = { boot_id: "boot-a", history: { epoch: 7 }, health: { source: "x10a",
  source_fresh: true, span_s: 100000, checks: [structuredClone(check)] } };
S.statusRequestedAt = now;
const c = () => S.status.health.checks[0];
const timeline = () => c().timeline;
assert.equal(ui.parse(c()), timeline());
assert.equal(ui.parse({ ...check, windows: 0 }), check.timeline,
  "the timed record count is independent from aggregate expiry and journal restoration");
// Restored endpoints are coordinates in the backend's stable frame, even when
// their original boot differed. They can arrive before a current complete sample.
const restored = { epoch: 9, window_end_s: 90093, since_s: 85000, observed_end_s: null,
  unix_s: trace.unix_s, live: false, windows: [{ ...trace.windows[3], start_s: 85000, end_s: 88600 }] };
const postBootCheck = { ...check, timeline: restored };
assert.equal(ui.parse(postBootCheck), restored);
const restoredChart = ui.chart(restored, ui.scope(restored));
assert.match(restoredChart, /data-start-s="85000" data-end-s="88600"/);
assert.equal((restoredChart.match(/data-dhw-marker="88600"/g) || []).length, 2);
assert.equal(ui.parse({ ...postBootCheck, timeline: { ...restored, live: true } }), null,
  "restored samples alone cannot establish current freshness");
assert.equal(ui.parse({ ...postBootCheck, timeline: { ...restored, window_end_s: 175000 } }), null,
  "a restored measurement expires using its actual completion time");
const quantizedEdge = { ...trace, windows: [{ ...trace.windows[0], end_s: 14646 }] };
assert.equal(ui.parse({ ...check, timeline: quantizedEdge }), quantizedEdge,
  "separately floored endpoints can span 3631 s at the unchanged 3630 s evaluator limit");
for (const value of [undefined, null, {}, [], { ...trace, epoch: 0 }, { ...trace, epoch: -1 },
  { ...trace, epoch: 2 ** 32 }, { ...trace, epoch: "3" }, { ...trace, window_end_s: NaN },
  { ...trace, since_s: 100001 }, { ...trace, observed_end_s: -1 },
  { ...trace, observed_end_s: 100001 }, { ...trace, observed_end_s: null }, { ...trace, live: null }, { ...trace, unix_s: 0 },
  { ...trace, unix_s: "1795262400" }, { ...trace, windows: {} },
  { ...trace, windows: Array(25).fill(trace.windows[0]) }]) {
  assert.equal(ui.parse({ ...check, timeline: value }), null, `invalid timeline rejected: ${JSON.stringify(value)}`);
}
for (const patch of [ { start_s: -1 }, { start_s: 11015.5 }, { end_s: 14614 },
  { end_s: 14647 }, { end_s: 100001 }, { observed_s: 3616 }, { observed_s: -1 },
  { rate_k_h: null }, { rate_k_h: NaN }, { rate_k_h: Infinity }, { rate_k_h: -0.1 },
  { rate_k_h: "1.7" }, { pump_marker: 1 }, { draw_marker: null } ]) {
  const invalid = { ...trace, windows: [{ ...trace.windows[0], ...patch }] };
  assert.equal(ui.parse({ ...check, timeline: invalid }), null, `invalid completion rejected: ${JSON.stringify(patch)}`);
}
assert.equal(ui.parse({ ...check, timeline: { ...trace, windows: [...trace.windows].reverse() } }), null);
assert.equal(ui.parse({ ...check, timeline: { ...trace, windows: [trace.windows[0], trace.windows[0]] } }), null);
assert.equal(ui.parse({ ...check, timeline: { ...trace, window_end_s: 101030 } }), null,
  "a completion exactly at the left boundary is expired, never a fabricated zero");

// Load-bearing provenance/absence wording: the maximum is not necessarily a plotted sample,
// and a missing exact-time record cannot prove that no aggregate window ever completed.
const boundedCopy = {
  en: [/maximum and counts.*saved hourly evidence.*not just plotted/i,
    /no completed timed window available.*not zero cooling.*presence, not duration/i],
  de: [/Höchstwert und Zähler.*gespeicherten Stundenwerten.*nicht nur.*gezeichneten Fenstern/,
    /Schraffiert.*ohne abgeschlossene Messstunde.*Balken zeigt eine Messstunde mit 0 K\/h.*Merkmale ohne Angabe der Dauer/],
  es: [/máximo y los recuentos.*datos horarios guardados.*no solo.*ventanas del gráfico/,
    /ninguna ventana completa con tiempos disponible.*no enfriamiento cero.*presencia, no duración/],
  fr: [/maximum et les décomptes.*données horaires sauvegardées.*pas seulement.*fenêtres tracées/,
    /aucune fenêtre horodatée terminée disponible.*pas un refroidissement nul.*présence, pas une durée/],
  it: [/massimo e i conteggi.*dati orari salvati.*non solo.*intervalli tracciati/,
    /nessun intervallo completo con tempi disponibile.*non raffreddamento nullo.*presenza, non durata/],
  pl: [/Maksimum i liczniki.*zapisanych danych godzinowych.*nie tylko.*oknach wykresu/,
    /brak dostępnego ukończonego okna z danymi czasowymi.*nie zerowe chłodzenie.*obecność, nie czas trwania/],
  cs: [/Maximum i počty.*uložených hodinových údajů.*nejen.*vykreslených oken/,
    /není dostupné dokončené okno s časovými údaji.*nikoli nulové ochlazení.*výskyt, ne dobu trvání/],
  uk: [/Максимум і лічильники.*збережені погодинні дані.*а не лише.*вікна графіка/,
    /немає доступного завершеного вікна із часовими даними.*а не нульове охолодження.*наявність, а не тривалість/],
  zh: [/最大值和计数.*保存的小时数据.*而非仅来自图中窗口/,
    /没有可用的已完成窗口时间记录.*并非零降温.*曾出现，不表示持续时间/],
  ja: [/最大値と件数.*描画された時間窓だけでなく.*保存済みの1時間ごとのデータ/,
    /利用可能な完了済みの時刻付き時間窓がない.*温度低下ゼロではありません.*存在を示し、継続時間ではありません/],
  nb: [/Maksimum og tellinger.*lagrede timedata.*ikke bare.*viste målevinduene/,
    /intet fullført målevindu med tider tilgjengelig.*ikke null avkjøling.*forekomst, ikke varighet/],
  sv: [/Maxvärdet och antalen.*sparade timdata.*inte bara.*visade mätfönstren/,
    /inget avslutat tidsstämplat mätfönster tillgängligt.*inte noll avkylning.*förekomst, inte varaktighet/],
  fi: [/Maksimi ja lukumäärät.*tallennettuihin tuntitietoihin.*eivät vain.*piirrettyihin jaksoihin/,
    /valmista aikaleimattua jaksoa ei ole saatavilla.*ei nollajäähtymistä.*esiintymisestä, eivät kestosta/],
};
assert.deepEqual(Object.keys(boundedCopy).sort(), [...locales].sort());
function assertBoundedCopy(lang, scope, blank) {
  assert.match(scope, boundedCopy[lang][0], `${lang}: maximum/counts provenance must include saved hourly evidence`);
  assert.match(blank, boundedCopy[lang][1], `${lang}: blanks must state timed-record availability, not absence or zero`);
}
for (const lang of locales) {
  ui.lang(lang);
  assertBoundedCopy(lang, ui.text("check.dhw.timed_scope", 4), ui.text("check.dhw.blank"));
  const detail = ui.detail(c(), false, S.status.health);
  assert.match(detail, /checkup-dhw-value num has-rate/);
  assert.match(detail, /4[,.]5<span class="checkup-dhw-unit">/);
  assert.ok(detail.includes(ui.text("check.dhw.hour_unit")));
  assert.match(detail, /data-checkup-dhw/);
  assert.doesNotMatch(detail, /data-dhw-window=|data-dhw-timeline=/,
    `${lang}: scalar detail must not eagerly construct the closed chart`);
  for (const key of ["timeline", "basis", "energy"]) assert.ok(detail.includes(`data-dhw-disclosure="${key}"><summary>`),
    `${lang}: ${key} starts collapsed`);
  assert.ok(detail.includes(ui.text("check.dhw.context_missing")));
  assert.ok(!detail.includes("data-dhw-evidence"));
  assert.ok(detail.includes(ui.text("check.dhw.limit")));
  assert.ok(!detail.includes(ui.text("check.dhw.hint")), `${lang}: marked maximum alone is not a finding`);
  assert.doesNotMatch(detail, /check\.dhw\.|undefined|NaN|Infinity/);
  const html = ui.chart(trace, ui.scope(trace));
  assert.equal((html.match(/data-dhw-window=/g) || []).length, trace.windows.length);
  assert.match(html, /checkup-dhw-window is-zero[\s\S]*data-rate="0"/);
  assert.equal((html.match(/data-dhw-marker=/g) || []).length, 4, `${lang}: paired presence, not a duration band`);
  assert.ok(html.includes(ui.text("check.dhw.blank")));
  assert.match(html, /class="checkup-dhw-caption checkup-dhw-gap-caption"/,
    `${lang}: the legend identifies the hatched intervals`);
  assert.ok(html.includes(ui.text("check.dhw.timed_scope", 4)));
  assert.doesNotMatch(html, /4[,.]5|200 l|COP|kWh|threshold/,
    `${lang}: no scalar maximum, energy assumptions or browser threshold in the plot`);
  assert.ok(ui.chart(null, "none").includes(ui.text("check.dhw.timeline_unavailable")));
  assert.ok(ui.chart({ ...trace, windows: [] }, "empty").includes(ui.text("check.dhw.timeline_empty")));
}
ui.lang("en");
const compact = check => ui.detail(check, false, S.status.health).split('data-dhw-disclosure="timeline"')[0];
for (const [window, keys] of [
  [trace.windows[0], ["quiet"]], [trace.windows[1], ["pump"]],
  [trace.windows[2], ["draw"]], [trace.windows[3], ["pump", "draw"]],
]) {
  const body = compact({ ...check, max_k_h: window.rate_k_h });
  assert.ok(body.includes(ui.text("check.dhw.context_hour")));
  assert.equal(body.includes(ui.text("check.dhw.context_title")), window.rate_k_h > 0);
  assert.equal(body.includes("checkup-dhw-arrow"), window.rate_k_h > 0);
  for (const key of ["quiet", "pump", "draw", "missing"])
    assert.equal(body.includes(ui.text(`check.dhw.context_${key}`)), keys.includes(key),
      "the compact card describes only the markers of an hour with the same rate");
}
const ties = { ...trace, unix_s: undefined, windows: [
  ...trace.windows.slice(0, -1), { ...trace.windows.at(-1), rate_k_h: 1.7 },
] };
const tied = compact({ ...check, max_k_h: 1.7, timeline: ties });
assert.ok(tied.includes(ui.text("check.dhw.context_draw")), "ties use the newest timed hour");
assert.ok(!tied.includes(ui.text("check.dhw.context_quiet")));
assert.match(tied, /before snapshot/);
assert.doesNotMatch(tied, /GMT|UTC/);
const priorTimezone = process.env.TZ;
try {
  process.env.TZ = "Europe/Berlin";
  const end = Date.parse("2026-10-25T01:30:00Z") / 1000;
  const repeatedHour = { ...trace, unix_s: end + trace.window_end_s - trace.windows.at(-1).end_s };
  const body = compact({ ...check, max_k_h: 2.7, timeline: repeatedHour });
  assert.match(body, /02:30:00 GMT\+2.*02:30:00 GMT\+1/,
    "an elapsed hour across the autumn clock change retains both offsets");
} finally {
  if (priorTimezone == null) delete process.env.TZ; else process.env.TZ = priorTimezone;
}
assert.throws(() => assertBoundedCopy("en",
  "Completed hours in the chart: 4 (last 24 h). Diagnosis totals can also include saved windows.",
  ui.text("check.dhw.blank")), /maximum\/counts provenance/,
  "the old totals-only copy must fail its named maximum-provenance assertion");
assert.throws(() => assertBoundedCopy("en", ui.text("check.dhw.timed_scope", 4),
  "Blank intervals: no completed window, not zero cooling. Markers show presence, not duration."),
  /timed-record availability/, "the old absence claim must fail its named availability assertion");
const initialBuilds = ui.builds();
const card = { dataset: { dashboardCard: "diagnosis" },
  querySelector: selector => { assert.equal(selector, ".vitem.open [data-checkup-dhw]"); return slot; } };
ui.sync(card);
assert.equal(ui.builds(), initialBuilds, "collapsed DHW does no chart work");
S.descOpen.add("model:health_dhw_loss");
S.stage = "settings"; ui.sync(card);
S.stage = "dashboard"; S.scrub = "other-chart"; ui.sync(card);
S.scrub = null; ui.sync({ ...card, dataset: { dashboardCard: "model" } });
assert.equal(ui.builds(), initialBuilds, "hidden/inactive/settings/gesture states do no chart work");
const findSlot = host.querySelector;
host.querySelector = () => null;
timeline().live = false;
ui.retire();
assert.equal(host.getAttribute("data-dhw-stale"), "true", "the first stale status is labelled before a chart slot exists");
timeline().live = true;
host.querySelector = findSlot;
ui.sync(card);
assert.equal(ui.builds(), initialBuilds, "expanding the value row leaves its timed history unmounted");
timelineDisclosure.open = true;
item.fire("toggle", timelineDisclosure);
assert.equal(ui.builds(), initialBuilds + 1);
assert.ok(S.descOpen.has("dhw:timeline"));
let chart = slot.children[0];
assert.equal(chart.dataset.dhwClock, "wall");
assert.equal(ui.selection().end, 96607, "latest actual window is initially selected");
let buttons = chart.querySelectorAll("[data-dhw-window]");
const percent = node => Number.parseFloat(node.style.left);
const width = node => Number.parseFloat(node.style.width);
assert.equal(percent(buttons[0]), 0, "actual crossing hour is clipped at the rolling left edge");
assert.ok(Math.abs(width(buttons[0]) - 1030 * 100 / 86400) < 1e-9);
assert.ok(Math.abs(percent(buttons[1]) - (20017 - 13600) * 100 / 86400) < 1e-9,
  "non-hour-aligned completion is never snapped to an invented bucket");
assert.ok(Math.abs(width(buttons[1]) - 3600 * 100 / 86400) < 1e-9);
for (const w of trace.windows) for (const marker of chart.querySelectorAll(`[data-dhw-marker="${w.end_s}"]`)) {
  const button = chart.querySelector(`[data-dhw-window="${w.end_s}"]`);
  assert.ok(Math.abs(percent(marker) - percent(button) - width(button) / 2) < 1e-9);
}
assert.equal(host.getAttribute("data-dhw-stale"), "false");
assert.match(chart.querySelector('[data-dhw-readout="rate"]').textContent, /^2.7 K\/h$/);
assert.equal(chart.querySelector('[data-dhw-readout="context"]').textContent,
  ["pump", "draw", "selected"].map(key => ui.text(`check.dhw.context_${key}`)).join(" "));
assert.match(buttons[3].getAttribute("aria-label"), /Internal pump: recorded · Draw-like drop: recorded/);
chart.fire("click", buttons[1]);
assert.equal(ui.selection().end, 23617);
assert.match(chart.querySelector('[data-dhw-readout="rate"]').textContent, /^0 K\/h$/);
assert.equal(chart.querySelector('[data-dhw-readout="context"]').textContent,
  ui.text("check.dhw.context_pump"));
assert.match(buttons[1].getAttribute("aria-label"), /Internal pump: recorded · Draw-like drop: not recorded/);
let event = chart.fire("keydown", buttons[1], { key: "ArrowLeft" });
assert.ok(event.prevented && event.stopped);
assert.equal(ui.selection().end, 14630);
assert.equal(document.activeElement, buttons[0]);
chart.fire("keydown", buttons[0], { key: "End" });
assert.equal(ui.selection().end, 96607);
chart.fire("click", chart.querySelector('[data-dhw-action="previous"]'));
assert.equal(ui.selection().end, 44631);
chart.fire("keydown", buttons[2], { key: "Home" });
assert.equal(ui.selection().end, 14630);
chart.fire("keydown", buttons[0], { key: "Escape" });
assert.equal(ui.selection().end, 96607);
chart.fire("click", buttons[2]);
buttons[2].focus();

// Frame/freshness and scalar changes must patch connected controls, not rebuild the plot.
const mountedNodes = [chart, ...chart.children, ...buttons];
const readout = chart.querySelector('[data-dhw-readout="rate"]');
const rateWrites = readout.writes, buildsBeforePolls = ui.builds();
for (let i = 0; i < 3; i++) {
  now += 2000;
  S.statusRequestedAt = now;
  timeline().window_end_s += 2;
  timeline().observed_end_s += 2;
  timeline().unix_s += 2;
  c().max_k_h += 0.1;
  S.status.health.span_s += 2;
  ui.sync(card);
  assert.equal(slot.children[0], chart);
  assert.equal(document.activeElement, buttons[2]);
  assert.equal(ui.selection().end, 44631);
}
assert.equal(ui.builds(), buildsBeforePolls, "three scalar polls construct no charts");
assert.equal(readout.writes, rateWrites, "unchanged selected rate is not rewritten");
assert.deepEqual([chart, ...chart.children, ...chart.querySelectorAll("[data-dhw-window]")], mountedNodes);
const detail = ui.detail(c(), false, S.status.health);
assert.ok(detail.includes('data-dhw-disclosure="basis"><summary>'));
const disclosure = new Node({ dhwDisclosure: "basis" }); disclosure.open = true;
item.fire("toggle", disclosure);
assert.ok(S.descOpen.has("dhw:basis"));
assert.ok(ui.detail(c(), false, S.status.health).includes('data-dhw-disclosure="basis" open>'));
disclosure.open = false; item.fire("toggle", disclosure);
assert.ok(!S.descOpen.has("dhw:basis"));
timelineDisclosure.open = false;
item.fire("toggle", timelineDisclosure);
assert.ok(!S.descOpen.has("dhw:timeline"));
assert.equal(slot.children.length, 0, "folding the timeline releases chart nodes");
assert.equal(S.cancelDhwDrag, null, "the detached chart is not held by the gesture callback");
ui.sync(card);
assert.equal(ui.builds(), buildsBeforePolls, "folded timelines stay unmounted when status is rendered");
timelineDisclosure.open = true;
item.fire("toggle", timelineDisclosure);
chart = slot.children[0];
buttons = chart.querySelectorAll("[data-dhw-window]");
const buildsAfterReopen = ui.builds();
assert.equal(ui.selection().end, 44631, "reopening keeps the same-scope timed selection");

// Pointer dragging selects only an actual observed window; crossing a blank cannot invent a
// zero or claim a gap cause. Vertical scrolling, cancellation and the watchdog release the hold.
const xAt = s => (s - (timeline().window_end_s - 86400)) / 100;
chart.fire("pointerdown", buttons[1], { clientX: xAt(21000) });
assert.equal(S.scrub, "checkup-dhw");
chart.fire("pointermove", buttons[1], { clientX: xAt(42000) });
assert.equal(ui.selection().end, 44631);
chart.fire("pointermove", buttons[1], { clientX: xAt(60000) });
assert.equal(ui.selection().end, 44631, "blank intervals cannot select neighbouring evidence");
chart.fire("pointercancel", chart);
assert.equal(S.scrub, null);
assert.equal(document.listeners.size, 0, "global release fallbacks are retired with the drag");
chart.fire("pointerdown", buttons[0]);
chart.fire("pointermove", buttons[0], { clientX: 1, clientY: 20 });
assert.equal(S.scrub, null, "vertical touch scrolling remains native");
chart.fire("pointerdown", buttons[0]);
S.cancelDhwDrag();
assert.equal(S.scrub, null);
assert.equal(document.listeners.size, 0);

// A relative timeline must stay relative even when other status fields advertise SNTP.
delete timeline().unix_s;
S.status.ntp = { synced: true };
ui.sync(card);
assert.equal(chart.dataset.dhwClock, "relative");
assert.match(chart.querySelector('[data-dhw-readout="time"]').textContent, /before snapshot/);
assert.doesNotMatch(chart.querySelector('[data-dhw-readout="time"]').textContent, /2026|GMT|UTC|Nov/);
assert.equal(ui.builds(), buildsAfterReopen, "clock anchoring changes also retain the chart DOM");
assert.equal(chart.querySelector('[data-dhw-axis="24"]').textContent, "Snapshot");

// Freshness is a monotonic upper-bound lease; no delayed timer may turn stale data fresh.
now += 16000;
for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
assert.equal(host.getAttribute("data-dhw-stale"), "true");
S.statusRequestedAt = now; timeline().live = false; ui.sync(card);
assert.equal(host.getAttribute("data-dhw-stale"), "true");
timeline().live = true; S.status.health.source_fresh = false; ui.sync(card);
assert.equal(host.getAttribute("data-dhw-stale"), "true");
S.status.health.source_fresh = true;

// Exercise the real poll callbacks with a retained DOM during a held values request. A status
// outage is stale; its successful replacement must hand off a fresh lease before /values paints.
S.clickHold = true;
let statusUnavailable = true;
Object.assign(context, {
  fetch: async url => url === "/status" && !statusUnavailable
    ? { ok: true, json: async () => S.status } : { ok: false, status: 503 },
  pollSignal: () => undefined,
  acceptImageLease: () => true,
  setLangFromStatus: () => {},
  syncHistSources: () => {},
  hpProbeIsOpen: () => false,
  hydrateRoutedPopup: () => {},
  renderApp: ui.cards,
});
assert.equal(await ui.readStatus(false, undefined, true), false);
assert.equal(S.transportUnavailable, "status");
assert.equal(host.getAttribute("data-dhw-stale"), "true", "a failed /status makes retained DHW readings stale");
statusUnavailable = false;
assert.ok(await ui.readStatus(false));
assert.equal(S.transportUnavailable, "values");
assert.equal(host.getAttribute("data-dhw-stale"), "false",
  "status recovery establishes fresh DHW evidence before /values completes");
assert.equal(await ui.readValues(false), false);
assert.equal(S.transportUnavailable, "values");
assert.equal(host.getAttribute("data-dhw-stale"), "false",
  "a failed /values does not invalidate the accepted status evidence");
assert.equal(slot.children[0], chart, "values-only loss and status recovery preserve the chart node");
now += 12000;
for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
assert.equal(host.getAttribute("data-dhw-stale"), "true",
  "a lease rearmed by accepted status expires independently of /values");
S.clickHold = false;
S.statusRequestedAt = now;
S.transportUnavailable = null; ui.sync(card);
assert.equal(host.getAttribute("data-dhw-stale"), "false");

for (const change of [
  () => { S.status.boot_id = "boot-b"; },
  () => { S.status.history.epoch++; },
  () => { S.status.health.source = "modbus"; },
  () => { timeline().epoch++; },
  () => { S.status.health.source = "x10a"; },
]) {
  ui.paint(chart, 23617);
  change();
  S.scrub = "checkup-dhw";
  S.clickHold = true;
  ui.cards();
  assert.equal(slot.children.length, 0, "even a held render immediately retires the old lifecycle");
  S.scrub = null;
  S.clickHold = false;
  ui.sync(card);
  chart = slot.children[0];
  assert.equal(ui.selection().end, 96607, "no prior source/boot/epoch selection is inherited");
}
// Expiry does not start a new collection. A formerly nonempty timed view can become empty
// with exactly the same lifecycle and an independently valid saved/aggregate maximum.
const beforeExpiry = { scope: ui.scope(timeline()), epoch: timeline().epoch, since: timeline().since_s };
assert.ok(timeline().windows.length > 0);
timeline().window_end_s = timeline().windows.at(-1).end_s + 86400;
timeline().windows = [];
ui.sync(card);
assert.equal(timeline().epoch, beforeExpiry.epoch);
assert.equal(timeline().since_s, beforeExpiry.since);
assert.equal(ui.scope(timeline()), beforeExpiry.scope);
assert.equal(slot.children[0].querySelectorAll("[data-dhw-window]").length, 0);
assert.equal(ui.selection().end, null);
for (const lang of locales) {
  ui.lang(lang);
  const emptyCopy = ui.text("check.dhw.timeline_empty");
  assert.match(emptyCopy, /24/, `${lang}: empty wording is bounded to this retained 24-hour view`);
  assert.ok(ui.chart(timeline(), beforeExpiry.scope).includes(emptyCopy));
}
ui.lang("en");
assert.match(ui.detail(c(), false, S.status.health), /has-rate/,
  "expired timed records cannot erase or reconstruct an independent aggregate maximum");
assert.match(slot._html, /No completed timed windows available in this 24 h view/);

// The status request can succeed with a fresh source while omitting the optional chart.
// Withdraw old windows without inventing a current-input failure while values are held.
S.statusRequestedAt = now;
timedEvidence.hidden = false;
context._html.valueGroups = ui.detail(c(), false, S.status.health);
delete c().timeline;
ui.retire();
assert.equal(timedEvidence.hidden, true, "status adoption retires paired hero evidence before a held render");
assert.equal(context._html.valueGroups, undefined, "restored identical markup must repair retired context");
assert.equal(host.getAttribute("data-dhw-stale"), "false",
  "omitting optional timed evidence does not establish stale current readings at status adoption");
ui.sync(card);
assert.equal(slot.children.length, 0);
assert.match(slot._html, /Timed windows unavailable/);
assert.equal(ui.selection().end, null);
assert.equal(host.getAttribute("data-dhw-stale"), "false",
  "an aggregate-only status must only claim timed evidence is unavailable");
c().timeline = { ...structuredClone(trace), epoch: 0, live: false };
ui.retire();
ui.sync(card);
assert.equal(host.getAttribute("data-dhw-stale"), "false",
  "a malformed timeline cannot establish staleness even if it claims live=false");
assert.match(slot._html, /Timed windows unavailable/);
delete c().timeline;
for (const change of [
  { object: S.status.health, key: "source_fresh", value: false },
  { object: c(), key: "reason", value: "source_stale" },
  { object: S, key: "transportUnavailable", value: "status" },
  { object: S, key: "otaCached", value: true },
]) {
  const { object, key, value } = change, prior = object[key];
  object[key] = value;
  ui.retire();
  assert.equal(host.getAttribute("data-dhw-stale"), "true",
    `independent stale evidence remains visible without timed records: ${key}`);
  assert.match(slot._html, /Timed windows unavailable/);
  object[key] = prior;
  ui.retire();
  assert.equal(host.getAttribute("data-dhw-stale"), "false",
    `the independent stale claim retires when evidence returns: ${key}`);
}
c().timeline = { ...structuredClone(trace), windows: [], observed_end_s: null, live: false };
ui.sync(card);
assert.match(slot._html, /No completed timed windows available in this 24 h view/);
assert.equal(host.getAttribute("data-dhw-stale"), "true",
  "a valid timeline with unread DHW inputs still reports missing current readings");
assert.equal(slot.children[0].querySelectorAll("[data-dhw-window]").length, 0);
assert.equal(ui.selection().end, null);
assert.match(ui.detail(c(), false, S.status.health), /has-rate/,
  "empty timed history cannot erase a valid persisted aggregate maximum");
ui.render(slot, false);
assert.equal(slot.children.length, 0);
assert.equal(panel.inert, true, "a closed outer accordion has no focusable inner controls");

// Exercise the actual structural fallback, not only equal-HTML/slot identity. The tiny fixture
// tree follows the renderer's has-rate/energy branches; the browser gate owns full HTML parsing.
let watched = [], disconnected = 0;
class IslandNode {
  constructor(name = "DIV", attributes = {}) {
    this.nodeName = name; this.nodeType = name === "#fragment" ? 11 : 1;
    this.childNodes = []; this.parentNode = null; this.dataset = {}; this.style = {}; this._attrs = new Map();
    this.classList = { contains: c => (this.getAttribute("class") || "").split(" ").includes(c),
      toggle: (c, on) => { const classes = new Set((this.getAttribute("class") || "").split(" ").filter(Boolean));
        if (on) classes.add(c); else classes.delete(c); this.setAttribute("class", [...classes].join(" ")); } };
    for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value);
  }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  get open() { return this.hasAttribute("open"); }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
  get isConnected() { return this.connectedRoot === true || this.parentNode?.isConnected === true; }
  setAttribute(name, value) {
    this._attrs.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this._attrs.get(name) ?? null; }
  hasAttribute(name) { return this._attrs.has(name); }
  removeAttribute(name) { this._attrs.delete(name); }
  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some(s => this.matches(s.trim()));
    return [...selector.matchAll(/\.([\w-]+)/g)].every(m => this.classList.contains(m[1])) &&
      [...selector.matchAll(/\[([\w-]+)(?:=["']([^"']*)["'])?\]/g)].every(m =>
        this.hasAttribute(m[1]) && (m[2] === undefined || this.getAttribute(m[1]) === m[2]));
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) { return this.childNodes.flatMap(n => [n, ...n.querySelectorAll(selector)])
    .filter(n => n.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.childNodes.some(n => n.contains(node)); }
  add(node) { this.insertBefore(node, null); return node; }
  insertBefore(node, before) { node.remove(); node.parentNode = this;
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node); }
  remove() {
    if (!this.parentNode) return;
    if (this.isConnected) disconnected += watched.filter(n => this.contains(n)).length;
    const parent = this.parentNode; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null;
  }
  replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove(); }
  replaceChildren(fragment) { for (const node of [...this.childNodes]) node.remove();
    for (const node of [...fragment.childNodes]) this.add(node); }
  addEventListener() {}
  focus() { document.activeElement = this; }
}
function islandTransitions(requireAncestors = true) {
  watched = []; disconnected = 0;
  c().timeline = structuredClone(trace); c().windows = 1; c().max_k_h = 4.5;
  const scope = ui.scope(timeline());
  const tree = (html, extra = false) => {
    const root = new IslandNode("#fragment");
    const hasRate = /class="checkup-dhw-value[^\"]*has-rate/.test(html);
    root.add(new IslandNode("DIV", { class: hasRate ? "badge ok" : "badge dim" }));
    const row = root.add(new IslandNode("DIV", { class: "vitem open" }));
    row.add(new IslandNode("BUTTON", { "data-desc": "model:health_dhw_loss", class: hasRate ? "rate" : "pending" }));
    const body = row.add(new IslandNode("DIV", { class: "vrow-desc" }));
    const panel = body.add(new IslandNode("DIV", { class: "checkup-dhw-detail" }));
    const hero = panel.add(new IslandNode("DIV", { class: "checkup-dhw-hero" }));
    if (hasRate) hero.add(new IslandNode("DIV", { class: "checkup-dhw-heading" }));
    hero.add(new IslandNode("DIV", { class: hasRate ? "has-rate" : "no-rate" }));
    const disclosure = panel.add(new IslandNode("DETAILS", { "data-dhw-disclosure": "timeline", open: "" }));
    disclosure.add(new IslandNode("SUMMARY"));
    const chartBody = disclosure.add(new IslandNode("DIV", { class: "checkup-dhw-disclosure-body" }));
    chartBody.add(new IslandNode("DIV", { "data-checkup-dhw": "", "data-dhw-scope": scope }));
    panel.add(new IslandNode("DETAILS", { "data-dhw-disclosure": "basis", open: "" }));
    if (html.includes('data-dhw-disclosure="energy"'))
      panel.add(new IslandNode("DETAILS", { "data-dhw-disclosure": "energy" }));
    if (extra) root.add(new IslandNode("DIV", { class: "vitem newly-available-diagnosis" }));
    return root;
  };
  const grid = new IslandNode("DIV", { "data-dashboard-card": "diagnosis" });
  grid.id = "diagnosis-fixture"; grid.connectedRoot = true;
  grid.replaceChildren(tree(ui.detail(c(), false, S.status.health)));
  const liveSlot = grid.querySelector("[data-checkup-dhw]");
  const liveChart = liveSlot.add(new IslandNode("DIV", { class: "vhist checkup-dhw-chart", "data-dhw-timeline": scope }));
  for (const w of timeline().windows) liveChart.add(new IslandNode("BUTTON", { "data-dhw-window": String(w.end_s) }));
  const chosen = liveChart.querySelector('[data-dhw-window="44631"]');
  for (const name of ["before", "unread"]) liveChart.add(new IslandNode("DIV", { class: `checkup-dhw-${name}` }));
  for (const action of ["previous", "next"]) liveChart.add(new IslandNode("BUTTON", { "data-dhw-action": action }));
  liveChart._dhwTrace = timeline(); liveChart._dhwScope = scope; liveChart._dhwWired = true;
  liveSlot._dhwKey = JSON.stringify(["en", scope, timeline().windows]);
  ui.paint(liveChart, 44631); chosen.focus();
  for (let node = chosen; node; node = node.parentNode) watched.push(node);
  const builds = ui.builds();
  let extra = false;
  document.createElement = name => {
    assert.equal(name, "template");
    return { set innerHTML(html) { this.content = tree(html, extra); } };
  };
  for (const [windows, maximum, addRow] of [[0, null, false], [1, 4.5, true]]) {
    c().windows = windows; c().max_k_h = maximum; extra = addRow;
    const html = ui.detail(c(), false, S.status.health);
    assert.equal(html.includes('data-dhw-disclosure="energy"'), windows > 0);
    ui.reconcile(grid, html);
    ui.render(liveSlot);
    assert.equal(grid.querySelector("[data-dhw-timeline]"), liveChart);
    assert.equal(document.activeElement, chosen);
    assert.equal(chosen.getAttribute("aria-pressed"), "true");
    assert.equal(ui.selection().end, 44631);
    if (requireAncestors) assert.ok(watched.every(node => node.isConnected));
  }
  assert.equal(ui.builds(), builds, "aggregate 1→0→1 never constructs an unchanged timed chart");
  delete document.createElement;
  return disconnected;
}
assert.equal(islandTransitions(), 0,
  "aggregate 1→0→1 and outer badge/sibling changes must never detach the chart or a painting ancestor");
ui.skipIsland(true);
try {
  assert.ok(islandTransitions(false) > 0,
    "negative control must detect the old detached-template path even when identity and focus recover");
} finally { ui.skipIsland(false); }

const css = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
assert.match(css, /\.checkup-dhw-window\.is-zero \.checkup-dhw-bar\s*\{[^}]*min-height:\s*2px/,
  "a real zero has a visible baseline, unlike no completed window");
assert.match(css, /\.checkup-dhw-marker\.pump\s*\{[^}]*width:\s*8px/);
assert.match(css, /\.checkup-dhw-marker\.draw\s*\{[^}]*width:\s*4px/);
assert.match(css, /\.checkup-dhw-plot\s*\{[^}]*touch-action:\s*pan-y/);
console.log(`DHW timeline UI: real-window validation, exact geometry, presence markers, selection, lazy scalar reuse, freshness and lifecycle verified in ${locales.length} locales`);
