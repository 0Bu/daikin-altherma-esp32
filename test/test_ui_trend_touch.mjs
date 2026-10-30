// iOS users drag the visible readout, not only the narrow plot below it. Exercise the production
// delegated pointer wiring with events that target .vhist-graph (the tooltip is pointer-events:none)
// so this cannot regress into a desktop-hover-only control again.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
assert.match(style,
  /\.vhist-graph\s*\{[^}]*touch-action:\s*pan-y;/,
  "the tooltip strip must accept horizontal touch scrubbing while preserving vertical page scroll");
assert.match(style,
  /\.vhist-tip\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--card\)\s+60%,\s*transparent\);/,
  "tooltip surfaces must be translucent without fading their text");
assert.match(style,
  /\.vhist-graph\s*\{[^}]*grid-template-rows:\s*auto 12px auto 24px;/,
  "one readout row and a shared lower time axis keep the chart compact");
assert.match(style, /\.vhist-tip\.vhist-live\s*\{[^}]*z-index:\s*4;[^}]*background:\s*var\(--card\);/,
  "the moving bubble must cover the pinned bubble without ghost text");
assert.match(style, /\.vhist-time\.vhist-live\s*\{[^}]*z-index:\s*4;[^}]*background:\s*var\(--brand-tint\);/,
  "the moving time must cover the pinned time on the shared lower axis");
assert.match(style, /\.vhist-tip\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*3;/,
  "the readout remains in normal layout above the chart");
assert.match(style, /\.vhist-tip\s*\{[^}]*translateX\(calc\(var\(--tip-p\) \* -1%\)\)/,
  "proportional anchoring keeps the tooltip inside both card edges");
assert.doesNotMatch(style, /\.vhist-tip\s*\{[^}]*\bopacity\s*:/,
  "transparency must not reduce tooltip text opacity");

class Host {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  fire(type, target, clientX = 0, key = "") {
    const event = {
      type, target, clientX, pointerId: 7, relatedTarget: null, key,
      preventDefault() {},
      stopPropagation() { this.stopped = true; },
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

const calls = [];
const S = { scrub: null, histPin: new Map() };
const plot = {
  dataset: { hist: "valve_dhw", source: "", n: "20" }, parentElement: null,
  closest: (selector) => selector === "[data-hist]" ? plot : selector === ".vhist-graph" ? graph : null,
  setPointerCapture: (id) => calls.push(["capture", id]),
  querySelector: () => ({ hidden: false }), querySelectorAll: () => [],
};
const graph = {
  querySelector: (selector) => selector === "[data-hist]" ? plot : ({ hidden: false }),
  querySelectorAll: () => [], contains: () => true,
  closest: (selector) => selector === ".vhist-graph" ? graph : null,
};
plot.parentElement = graph;

const context = vm.createContext({
  S, console,
  scrubArm: () => calls.push(["arm"]),
  scrubMove: (_plot, i) => calls.push(["move", i]),
  scrubIndex: (_plot, x) => x,
  scrubEnd: () => { calls.push(["end"]); S.scrub = null; },
  histPinToggle: (id, i, source) => calls.push(["pin", id, i, source]),
  scrubCount: () => 20, renderTrendHosts: () => {},
});
const bootstrap = readAppFragments(["bootstrap.js"]).replace(/\nboot\(\);\s*$/, "\n");
vm.runInContext(`${bootstrap}\nthis.__touch = { trendPlotFromTarget, wireTrendScrub };`, context,
  { filename: "main/www/js/bootstrap.js" });

assert.equal(context.__touch.trendPlotFromTarget(graph), plot,
  "the reserved tooltip strip resolves to its plot");
const host = new Host();
context.__touch.wireTrendScrub(host);
host.fire("pointerdown", graph, 4);
host.fire("pointermove", graph, 11);
host.fire("pointerup", graph, 13);
assert.deepEqual(calls, [
  ["arm"], ["capture", 7], ["move", 4],
  ["arm"], ["move", 11],
  ["end"], ["pin", "valve_dhw", 13, ""],
], "a drag starting on the tooltip moves and pins the newly selected sample");

// Exercise the real pin/rebuild functions: a keyboard user keeps both the focused replacement plot
// and its chosen cursor after pinning/unpinning. Escape belongs to this plot, not its inspector.
{
  const keyboardHost = new Host();
  const document = { activeElement: null };
  let current;
  const graphHost = { querySelectorAll: () => [current] };
  const makePlot = () => ({
    dataset: { hist: "temperature", source: "", n: "20" },
    parentElement: { querySelector: () => ({ hidden: false }) },
    closest(selector) {
      if (selector === "[data-hist]") return this;
      if (selector === "#valueGroups, #inspHist, #settingsCards") return graphHost;
      return null;
    },
    querySelector: () => ({ hidden: false }), querySelectorAll: () => [],
    focus() { document.activeElement = this; },
  });
  current = makePlot(); current.focus();
  const state = { histPin: new Map(), scrub: null, insp: "temperature" };
  const moves = [];
  const ctx = vm.createContext({
    S: state, document, clearTimeout() {},
    historyData: { v: Array.from({ length: 20 }, (_, i) => i), dt: 300, t0: 1000 },
    renderCards: () => {
      keyboardHost.fire("focusout", current);
      document.activeElement = null; current = makePlot();
    },
    renderInspect() {}, renderSettings() {},
  });
  const historySource = readAppFragments(["history.js"]);
  vm.runInContext(historySource + "\n" + bootstrap + `
    historyView = () => historyData;
    scrubCount = () => 20;
    scrubMove = (plot, i) => moves.push(i);
    this.wireKeyboard = wireTrendScrub;
  `, ctx);
  ctx.moves = moves;
  ctx.wireKeyboard(keyboardHost);
  keyboardHost.fire("keydown", current, 0, "Home");
  keyboardHost.fire("keydown", current, 0, "ArrowRight");
  const first = current;
  keyboardHost.fire("keydown", current, 0, "Enter");
  assert.notEqual(current, first, "pinning must exercise the actual DOM replacement path");
  assert.equal(document.activeElement, current, "the replacement plot keeps keyboard focus");
  assert.equal(+current.dataset.cur, 1, "the replacement plot keeps the chosen cursor");
  assert.equal(state.histPin.get("temperature").t, 1300);
  keyboardHost.fire("keydown", current, 0, "ArrowRight");
  assert.equal(+current.dataset.cur, 2, "continued arrows start at the preserved cursor");
  const escape = keyboardHost.fire("keydown", current, 0, "Escape");
  assert.equal(escape.stopped, true, "Escape must not reach the inspector's close handler");
  assert.equal(state.histPin.has("temperature"), false);
  assert.equal(document.activeElement, current);
  assert.equal(+current.dataset.cur, 2);
  assert.equal(state.insp, "temperature");
  assert.equal(moves.at(-1), 2);
}

// Ordinary values polls use setHtml directly, outside the explicit pin/legend rebuild path.
{
  const document = { activeElement: null };
  const makeLegend = () => ({
    dataset: { histId: "dhw_tank", histSeries: "modbus" },
    focus() { document.activeElement = this; },
  });
  let current = makeLegend(); current.focus();
  const host = {
    contains: (el) => el === current,
    querySelectorAll: () => [current],
    set innerHTML(_html) { current = makeLegend(); document.activeElement = null; },
  };
  const stateSource = readAppFragments(["app_state.js"]);
  const writer = stateSource.slice(stateSource.indexOf("const _html = {}"), stateSource.indexOf("function renderHeader()"));
  const ctx = vm.createContext({ S: { clickHold: false }, document, $: () => host });
  vm.runInContext(readAppFragments(["history.js"]) + "\n" + writer + "\nthis.repaint = setHtml;", ctx);
  const first = current;
  ctx.repaint("valueGroups", "updated readings");
  assert.notEqual(current, first, "the poll must replace the real container");
  assert.equal(document.activeElement, current,
    "changing readings must preserve the focused legend button across a normal poll");
}

console.log("UI trend touch and keyboard pin/rebuild/poll focus tests passed");
