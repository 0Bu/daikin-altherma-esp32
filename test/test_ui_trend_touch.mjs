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
  /\.vhist-tip\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--card\)\s+76%,\s*transparent\);/,
  "tooltip surfaces must be translucent without fading their text");
assert.doesNotMatch(style, /\.vhist-tip\s*\{[^}]*\bopacity\s*:/,
  "transparency must not reduce tooltip text opacity");

class Host {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  fire(type, target, clientX = 0) {
    const event = {
      type, target, clientX, pointerId: 7, relatedTarget: null, key: "",
      preventDefault() {},
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
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

console.log("UI trend touch tests passed");
