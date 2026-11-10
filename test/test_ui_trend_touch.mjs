// iOS users drag the visible readout, not only the narrow plot below it. Exercise the production
// delegated pointer wiring with events that target .vhist-graph (the tooltip is pointer-events:none)
// so this cannot regress into a desktop-hover-only control again.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";
import { createScalarGridWitness } from "./test_browser_history_motion.mjs";

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

// A cached disclosure can open and close before any poll renders its open state. Exercise the real
// toggle/setHtml cache decision with a small DOM writer adapter; browser tests own native input,
// transition timing and actual SVG identity, while the focus test above keeps the real replacer.
function assertCachedDisclosureClose(historySource, ownerId) {
  const stateSource = readAppFragments(["app_state.js"]);
  const writer = stateSource.slice(stateSource.indexOf("const _html = {}"), stateSource.indexOf("function renderHeader()"));
  const writes = [], attrs = new Map(), classes = new Set();
  let bodyHtml = "<p>History help</p>", chart = null, renders = 0;
  const body = {
    get innerHTML() { return bodyHtml; },
    set innerHTML(html) {
      bodyHtml = html;
      chart = html.includes("data-hist=") ? chart || { id: "fixture-trend" } : null;
    },
  };
  const containers = Object.fromEntries(["settingsCards", "valueGroups", "connTile"].map(id => [id, {
    id,
    set innerHTML(html) {
      writes.push({ id, html });
      if (id === ownerId) body.innerHTML = "<p>History help</p>";
    },
  }]));
  const item = {
    classList: {
      contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
    querySelector: selector => selector === ".vhist" ? chart : selector === ".vdesc-body" ? body : null,
  };
  const button = {
    dataset: { desc: "fixture:trend", trend: "fixture-trend", unit: "°C" },
    closest: selector => selector === ".vitem" ? item
      : selector === "#valueGroups, #settingsCards" ? containers[ownerId] : null,
    setAttribute: (name, value) => attrs.set(name, value),
    querySelector: () => ({ textContent: "Fixture trend" }),
  };
  const state = { clickHold: false, descOpen: new Set(), histPin: new Map() };
  const ctx = vm.createContext({ S: state, $: id => containers[id], renderApp: () => renders++ });
  vm.runInContext(historySource + "\n" + writer + `
    histHtml = () => '<div class="vhist"><svg data-hist="fixture-trend"></svg></div>';
    ensureHistPair = () => {};
    replaceHistoryHtml = (host, html) => { host.innerHTML = html; };
    this.toggle = toggleDesc; this.repaint = setHtml; this.cached = id => _html[id];
  `, ctx);
  const closed = Object.fromEntries(Object.keys(containers).map(id => [id, `<section>${id}: closed</section>`]));
  for (const [id, html] of Object.entries(closed)) ctx.repaint(id, html);
  const before = writes.length;
  ctx.toggle(button);
  const openedChart = chart;
  assert.ok(openedChart && state.descOpen.has(button.dataset.desc) && classes.has("open"),
    ownerId + ": production toggle path must mount its cached history");
  assert.equal(attrs.get("aria-expanded"), "true");
  ctx.toggle(button);
  assert.equal(state.descOpen.has(button.dataset.desc) || classes.has("open"), false);
  assert.equal(attrs.get("aria-expanded"), "false");
  assert.equal(chart, openedChart, ownerId + ": close must preserve its chart during the CSS transition");
  assert.equal(writes.length, before, ownerId + ": toggles must not immediately rebuild any container");
  assert.equal(renders, 0, ownerId + ": toggles must wait for the normal poll renderer");
  for (const id of Object.keys(containers).filter(id => id !== ownerId))
    assert.equal(ctx.cached(id), closed[id], ownerId + ": other container caches must remain valid: " + id);
  state.clickHold = true;
  ctx.repaint(ownerId, closed[ownerId]);
  assert.equal(chart, openedChart, ownerId + ": an in-flight click must still defer the poll write");
  state.clickHold = false;
  ctx.repaint(ownerId, closed[ownerId]);
  assert.equal(chart, null, ownerId + ": identical closed poll must remove its own cached-open chart");
  assert.equal(writes.length, before + 1, ownerId + ": the next poll must rebuild only the dirty owner");
  assert.equal(ctx.cached(ownerId), closed[ownerId], ownerId + ": completed poll must restore the owner cache");
  for (const id of Object.keys(containers).filter(id => id !== ownerId)) ctx.repaint(id, closed[id]);
  assert.equal(writes.length, before + 1, ownerId + ": unchanged other containers must still skip writes");
}

const disclosureSource = readAppFragments(["history.js"]);
for (const owner of ["settingsCards", "valueGroups"]) assertCachedDisclosureClose(disclosureSource, owner);
const invalidation = "  if (owner) delete _html[owner.id];";
assert.ok(disclosureSource.includes(invalidation), "disclosure cache negative-control target must exist");
for (const owner of ["settingsCards", "valueGroups"])
  assert.throws(() => assertCachedDisclosureClose(disclosureSource.replace(invalidation, "  void owner;"), owner),
    error => error.code === "ERR_ASSERTION" && error.actual?.id === "fixture-trend" && error.expected === null &&
      error.message.startsWith(owner + ": identical closed poll must remove its own cached-open chart"),
    owner + ": previous cache behavior must fail at the retained hidden-chart assertion");

// Execute the actual reconciler against fresh template trees. This adapter models only its DOM
// operations; the browser matrix owns native layout, connectivity observations and input timing.
function scalarGridHarness(historySource) {
  const document = { activeElement: null }, templates = new Map();
  const text = value => ({ nodeType: 3, nodeName: "#text", nodeValue: value,
    ownerDocument: document,
    get parentNode() { return this.parentElement || null; },
    get isConnected() { return this.parentElement?.isConnected || false; },
    get outerHTML() { return this.nodeValue; } });
  function adopt(parent, children) {
    const focused = parent.contains(document.activeElement);
    for (const old of parent.childNodes) old.parentElement = null;
    parent.childNodes = [...children];
    for (const child of parent.childNodes) child.parentElement = parent;
    if (focused && !parent.contains(document.activeElement)) document.activeElement = null;
  }
  function element(tag, attrs = {}, children = []) {
    const attributes = new Map(Object.entries(attrs));
    const node = {
      nodeType: tag === "#fragment" ? 11 : 1, nodeName: tag.toUpperCase(),
      id: attrs.id || "", childNodes: [], writes: 0, value: attrs.value,
      ownerDocument: document,
      get parentNode() { return this.parentElement || null; },
      dataset: Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith("data-"))
        .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value])),
      get attributes() { return [...attributes].map(([name, value]) => ({ name, value })); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      get hidden() { return attributes.has("hidden"); },
      set hidden(value) { if (value) attributes.set("hidden", ""); else attributes.delete("hidden"); },
      classList: { contains: name => (attributes.get("class") || "").split(/\s+/).includes(name) },
      matches(selector) {
        const match = selector.match(/^(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/);
        return !!match && (!match[1] || this.classList.contains(match[1])) &&
          (!match[2] || attributes.has(match[2]));
      },
      contains(other) {
        for (let current = other; current; current = current.parentElement) if (current === this) return true;
        return false;
      },
      closest(selector) {
        for (let current = this; current; current = current.parentElement)
          if (current.matches?.(selector)) return current;
        return null;
      },
      querySelectorAll(selector) {
        return this.childNodes.flatMap(child => [
          ...(child.matches?.(selector) ? [child] : []), ...(child.querySelectorAll?.(selector) || []),
        ]);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      get isConnected() {
        for (let current = this; current; current = current.parentElement) if (current.mounted) return true;
        return false;
      },
      focus() { if (this.isConnected) document.activeElement = this; },
      get outerHTML() {
        return `<${tag}${[...attributes].map(([name, value]) => ` ${name}="${value}"`).join("")}>` +
          this.innerHTML + `</${tag}>`;
      },
      isEqualNode(other) { return this.outerHTML === other.outerHTML; },
      get innerHTML() { return this.childNodes.map(child => child.outerHTML).join(""); },
      set innerHTML(html) { this.writes++; adopt(this, templates.get(html)()); },
      replaceChildren(fragment) { this.writes++; adopt(this, fragment.childNodes); },
    };
    adopt(node, children);
    return node;
  }
  document.createElement = tag => {
    assert.equal(tag, "template", "scalar preflight creates only its inert template");
    return { content: null,
      set innerHTML(html) { this.content = element("#fragment", {}, templates.get(html)()); } };
  };
  const state = { trendRebuilding: false }, ctx = vm.createContext({ S: state, document });
  vm.runInContext(historySource + "\nthis.replace = replaceHistoryHtml;", ctx);
  return { document, state, element, text,
    mount(id, factory) { const host = element("div", { id }, factory()); host.mounted = true; return host; },
    repaint(host, factory) {
      const nodes = factory();
      const html = nodes.map(node => node.outerHTML).join("");
      nodes.forEach((node, index) => {
        if (node.nodeType === 1) templates.set(node.innerHTML, () => factory()[index].childNodes);
      });
      templates.set(html, factory);
      ctx.replace(host, html);
    },
  };
}

function assertScalarGridPolling(historySource) {
  const h = scalarGridHarness(historySource), { element: el, text } = h;
  const row = (name, body, state = "ready") => el("div", { class: "vitem", "data-state": state }, [
    el("button", { "data-desc": name }, [text(name)]), ...body,
  ]);
  const grid = (reading, { state = "ready", extra = false, chart = false } = {}) => () => [
    el("section", { class: "vgroup", "data-dashboard-card": "readings" }, [
      row("temperature", [el("span", { "data-reading": "" }, [text(reading)]),
        ...(chart ? [el("div", { class: "vhist" }, [el("svg", { "data-hist": "temperature" })])] : [])]),
      row("pressure", [text("1.4 bar")], state), ...(extra ? [row("flow", [text("20 l/min")])] : []),
    ]),
    el("section", { class: "vgroup", "data-dashboard-card": "other" }, [row("other", [text("unchanged")])]),
  ];
  const host = h.mount("valueGroups", grid("20 °C"));
  const [first, hidden] = host.childNodes, rows = [...first.childNodes];
  const button = rows[0].querySelector("[data-desc]"), reading = rows[0].querySelector("[data-reading]").childNodes[0];
  hidden.hidden = true;
  button.focus();
  h.repaint(host, grid("21 °C"));
  assert.equal(host.childNodes[0], first, "no-chart scalar poll must retain the value grid");
  assert.ok(first.childNodes.length === rows.length && rows.every((row, index) => first.childNodes[index] === row),
    "no-chart scalar poll must retain closed rows");
  assert.equal(reading.nodeValue, "21 °C", "retained scalar text must show the current reading");
  assert.equal(host.childNodes[1], hidden, "scalar poll must retain the card hidden by navigation");
  assert.equal(hidden.hidden, true, "scalar preflight must preserve card-owned hidden state");
  assert.equal(h.document.activeElement, button, "retained closed-row control must keep focus");
  assert.equal(host.writes, 0, "scalar poll must not replace the value grid or any ancestor");
  h.repaint(host, grid("22 °C", { state: "changed" }));
  assert.notEqual(host.childNodes[0], first, "non-text attribute changes must rebuild the grid");
  assert.equal(reading.nodeValue, "21 °C", "failed preflight must not partially change detached old text");
  assert.equal(host.childNodes[0].childNodes[1].getAttribute("data-state"), "changed");
  const beforeStructure = host.childNodes[0];
  h.repaint(host, grid("23 °C", { state: "changed", extra: true }));
  assert.notEqual(host.childNodes[0], beforeStructure, "structural changes must rebuild the grid");
  assert.equal(host.childNodes[0].childNodes.length, 3);
  assert.equal(h.state.trendRebuilding, false, "structural fallback must restore its rebuild guard");
  const staleHost = h.mount("valueGroups", grid("24 °C", { chart: true }));
  const stale = staleHost.querySelector(".vhist");
  h.repaint(staleHost, grid("25 °C"));
  assert.equal(staleHost.querySelector(".vhist"), null, "closed template must remove a stale live chart");
  assert.equal(stale.isConnected, false, "closed template must disconnect its obsolete chart");
  const form = label => () => [el("fieldset", {}, [
    el("select", { value: "server", "data-field": "" }, [el("option", { value: "server" }, [text("Server")])]),
    el("span", {}, [text(label)]),
  ])];
  const settings = h.mount("settingsCards", form("old")), select = settings.querySelector("[data-field]");
  select.value = "unsaved";
  h.repaint(settings, form("new"));
  assert.equal(settings.querySelector("[data-field]").value, "server",
    "Settings no-chart poll must reset live select state through replacement");
  assert.notEqual(settings.querySelector("[data-field]"), select, "Settings must keep its original full-write path");
}

assertScalarGridPolling(disclosureSource);
const scalarBranch = `if (!html.includes('class="vhist') && host.id !== "valueGroups" && host.id !== "inspRows" && !diagnosisCard)
    host.innerHTML = html;`;
assert.equal(disclosureSource.split(scalarBranch).length, 2, "scalar-grid negative control must target one production branch");
assert.throws(() => assertScalarGridPolling(disclosureSource.replace(scalarBranch,
  `if (!html.includes('class="vhist')) host.innerHTML = html;`)),
error => error.code === "ERR_ASSERTION" && error.message.startsWith("no-chart scalar poll must retain the value grid"),
"the old no-chart branch must fail the exact scalar-retention assertion");
assert.throws(() => assertScalarGridPolling(disclosureSource.replace(scalarBranch,
  `if (false) host.innerHTML = html;`)),
error => error.code === "ERR_ASSERTION" && error.message.startsWith("Settings no-chart poll must reset live select state"),
"extending scalar retention to Settings must fail its live-select reset assertion");
console.log("UI scalar-grid reconciliation and both branch negative controls passed");

function assertDiagnosisCardPolling(historySource) {
  const h = scalarGridHarness(historySource), { element: el, text } = h;
  const grid = (reading, { diagnosis = true, completed = false, state = "ready" } = {}) => () => [
    ...(diagnosis ? [el("section", { class: "vgroup", "data-dashboard-card": "diagnosis" }, [
      el("span", {}, [text(completed ? "Measured" : "Collecting")]),
      ...(completed ? [el("div", { "data-completed": "" }, [text("1 run")])] : []),
    ])] : []),
    el("section", { class: "vgroup", "data-dashboard-card": "readings", "data-state": state }, [
      el("div", { class: "vitem" }, [el("button", { "data-desc": "temperature" }, [text(reading)])]),
    ]),
  ];
  const host = h.mount("valueGroups", grid("20 °C"));
  const [diagnosis, sibling] = host.childNodes;
  diagnosis.hidden = true;
  const button = sibling.querySelector("[data-desc]");
  button.focus();
  h.repaint(host, grid("21 °C", { completed: true }));
  assert.equal(host.childNodes[1], sibling, "a diagnosis refresh must not detach an unrelated card");
  assert.equal(host.writes, 0);
  assert.equal(host.childNodes[0], diagnosis);
  assert.equal(diagnosis.hidden, true);
  assert.equal(diagnosis.querySelector("[data-completed]").innerHTML, "1 run");
  assert.equal(h.document.activeElement, button);
  assert.equal(button.innerHTML, "21 °C");

  h.repaint(host, grid("22 °C", { state: "changed" }));
  assert.equal(host.writes, 1, "an unrelated structural change must still use the grid fallback");
  assert.ok(diagnosis.querySelector("[data-completed]"), "failed outer preflight must leave the old diagnosis intact");
  h.repaint(host, grid("22 °C", { diagnosis: false }));
  assert.equal(host.childNodes.length, 1, "removing the diagnosis must still update the grid");
  h.repaint(host, grid("22 °C"));
  assert.equal(host.childNodes[0].getAttribute("data-dashboard-card"), "diagnosis");
}

assertDiagnosisCardPolling(disclosureSource);
const diagnosisBranch = `if (host.id !== "valueGroups" || a.parentNode !== host ||
          a.getAttribute("data-dashboard-card") !== "diagnosis") return false;`;
assert.equal(disclosureSource.split(diagnosisBranch).length, 2);
assert.throws(() => assertDiagnosisCardPolling(disclosureSource.replace(diagnosisBranch, "return false;")),
  error => error.code === "ERR_ASSERTION" && error.message.startsWith("a diagnosis refresh must not detach"),
  "the old whole-grid fallback must fail the diagnosis-continuity assertion");
console.log("UI diagnosis-card reconciliation and its whole-grid fallback negative control passed");

function assertInspectorScalarPolling(historySource) {
  const h = scalarGridHarness(historySource), { element: el, text } = h;
  const members = node => (node.childNodes || []).flatMap(child => [child, ...members(child)]);
  const inspector = (reading, { rowClass = "inspect-row mb-row", state = "fresh",
    comparison = null, modbus = true } = {}) => () => [
    el("div", { class: "inspect-row", "data-member": "x10a" }, [
      el("span", {}, [text("Tank temperature")]), el("span", { "data-reading": "" }, [text(reading)]),
    ]),
    ...(modbus ? [el("div", { class: rowClass, "data-member": "modbus", "data-state": state }, [
      el("span", {}, [text("Tank temperature "), el("span", { class: "mb-tag" }, [text("Modbus")])]),
      el("span", {}, [text(reading)]),
    ])] : []),
    ...(modbus && comparison != null ? [el("div", { class: "mb-delta" }, [text(comparison)])] : []),
  ];
  const host = h.mount("inspRows", inspector("40 °C")), original = members(host);
  const readingNode = host.querySelector("[data-reading]").childNodes[0];
  h.repaint(host, inspector("41 °C"));
  assert.ok(members(host).length === original.length && members(host).every((node, index) => node === original[index]),
    "inspector scalar poll must retain every original member and text node");
  assert.equal(readingNode.nodeValue, "41 °C", "retained inspector text must show the fresh reading");
  assert.equal(host.childNodes[1].childNodes[1].childNodes[0].nodeValue, "41 °C",
    "the retained independent Modbus member must show its fresh reading");
  assert.equal(host.writes, 0, "scalar inspector text must update without replacing rows");
  let options = {}, nextReading = 42;
  for (const [change, patch] of [
    ["class change", { rowClass: "inspect-row mb-row held" }],
    ["attribute change", { state: "held" }],
    ["late comparison insertion", { comparison: "0.5 K difference" }],
    ["late comparison removal", { comparison: null }],
  ]) {
    const first = host.childNodes[0], oldText = host.querySelector("[data-reading]").childNodes[0];
    const previous = oldText.nodeValue, reading = `${nextReading++} °C`;
    options = { ...options, ...patch };
    h.repaint(host, inspector(reading, options));
    assert.notEqual(host.childNodes[0], first, "inspector " + change + " must use the structural fallback");
    assert.equal(oldText.nodeValue, previous, "inspector " + change + " must not partially change old text");
    assert.equal(host.querySelector("[data-reading]").childNodes[0].nodeValue, reading,
      "inspector " + change + " must render fresh text in its replacement");
    assert.equal(host.childNodes[1].getAttribute("class"), options.rowClass);
    assert.equal(host.childNodes[1].getAttribute("data-state"), options.state || "fresh");
    assert.equal(host.childNodes.length, options.comparison == null ? 2 : 3);
  }
  h.repaint(host, inspector("46 °C", { comparison: "0.5 K difference" }));
  const missingSource = host.childNodes[1], comparison = host.querySelector(".mb-delta");
  h.repaint(host, inspector("47 °C", { modbus: false }));
  assert.equal(host.childNodes.length, 1, "source removal must remove the missing source and its comparison");
  assert.equal(host.childNodes[0].getAttribute("data-member"), "x10a");
  assert.equal(missingSource.isConnected || comparison.isConnected, false,
    "source removal must disconnect both the source member and its comparison");
  const remaining = host.childNodes[0];
  h.repaint(host, () => []);
  assert.equal(host.childNodes.length, 0, "complete source absence must clear the inspector rows");
  assert.equal(remaining.isConnected, false, "clearing an inspector must disconnect its obsolete member");
  h.repaint(host, inspector("40 °C"));
  assert.equal(host.childNodes.length, 2, "A-to-empty-to-A must restore both source members");
  assert.equal(host.querySelector("[data-reading]").childNodes[0].nodeValue, "40 °C");
  assert.notEqual(host.childNodes[0], original[0], "source restoration must create current members");
  const restored = members(host);
  h.repaint(host, inspector("47 °C"));
  assert.ok(members(host).length === restored.length && members(host).every((node, index) => node === restored[index]),
    "restored inspector members must resume scalar retention");
  assert.equal(host.querySelector("[data-reading]").childNodes[0].nodeValue, "47 °C");
  assert.equal(h.state.trendRebuilding, false, "inspector fallback must restore the rebuild guard");
}

assertInspectorScalarPolling(disclosureSource);
assert.throws(() => assertInspectorScalarPolling(disclosureSource.replace(scalarBranch,
  scalarBranch.replace(' && host.id !== "inspRows"', ""))),
error => error.code === "ERR_ASSERTION" && error.actual === false && error.expected === true &&
  error.message.startsWith("inspector scalar poll must retain every original member and text node"),
"removing only the inspector exclusion must fail its own member-retention assertion");
console.log("UI inspector scalar retention, structural transitions and scoped negative control passed");

function scalarWitnessFixture(makeWitness, trackDescendants) {
  const h = scalarGridHarness(disclosureSource), { element: el } = h;
  const cards = ["first", "later", "hidden"].map(name =>
    el("section", { class: "vgroup", "data-dashboard-card": name }, [
      el("span", {}, [h.text(name)]),
    ]));
  cards[2].hidden = true;
  const root = el("div", { id: "valueGroups" }, cards), body = el("body", {}, [root]);
  const html = el("html", {}, [body]);
  html.mounted = true;
  h.document.nodeType = 9;
  h.document.parentNode = null;
  h.document.documentElement = html;
  Object.defineProperty(html, "parentNode", { get: () => h.document });
  let observer;
  class Observer {
    constructor(callback) {
      observer = this; this.callback = callback; this.pending = [];
      this.takes = 0; this.closes = 0; this.observations = 0;
    }
    observe(target, options) {
      this.observations++;
      assert.equal(target, h.document, "continuity witness must observe removals at document scope");
      assert.equal(options.childList && options.subtree, true, "continuity witness must include ancestor child-list removals");
    }
    takeRecords() { this.takes++; return this.pending.splice(0); }
    disconnect() { this.closes++; this.pending = []; }
    queue(node) { this.pending.push({ removedNodes: [node] }); }
    deliver() { this.callback(this.takeRecords()); }
  }
  const witness = trackDescendants === undefined ? makeWitness(root, Observer)
    : makeWitness(root, Observer, trackDescendants);
  assert.equal(observer.observations, 1, "continuity witness must arm its document observer once");
  return { h, root, body, html, cards, witness, observer,
    detachAndReattach(node) {
      const parent = node.parentNode, index = parent.childNodes.indexOf(node);
      parent.childNodes.splice(index, 1); node.parentElement = null;
      observer.queue(node);
      parent.childNodes.splice(index, 0, node); node.parentElement = parent;
    },
  };
}

function assertScalarWitnessContinuity(makeWitness) {
  function finish(fixture) {
    const result = fixture.witness.finish();
    assert.equal(fixture.observer.pending.length, 0, "finish must drain pending removal records");
    assert.ok(fixture.observer.takes > 0, "finish must obtain the observer's queued records");
    fixture.witness.close(); fixture.witness.close();
    assert.equal(fixture.observer.closes, 1, "finish and explicit close must disconnect only once");
    return result;
  }
  const unchanged = scalarWitnessFixture(makeWitness), clean = finish(unchanged);
  assert.deepEqual({ ...clean }, { retained: true, removed: 0, visibilityStable: true },
    "an unchanged scalar grid must pass its continuity witness");
  const takes = unchanged.observer.takes;
  unchanged.cards[2].hidden = false;
  assert.equal(unchanged.witness.finish(), clean, "repeated finish must return its cached observation");
  assert.equal(unchanged.observer.takes, takes, "repeated finish must not drain a closed observer again");

  const later = scalarWitnessFixture(makeWitness);
  later.detachAndReattach(later.cards[1]);
  const reattached = finish(later);
  assert.equal(reattached.retained, true, "later card must have returned to its original final position");
  assert.equal(reattached.removed, 1, "queued later-card removal must be observed even after reattachment");
  for (const target of ["root", "body"]) {
    const fixture = scalarWitnessFixture(makeWitness);
    fixture.detachAndReattach(fixture[target]);
    const result = finish(fixture);
    assert.equal(result.retained, true, target + ": temporary removal must leave the same final grid");
    assert.equal(result.removed, 1, target + ": removal of the grid or its ancestor must be recorded");
  }
  const delivered = scalarWitnessFixture(makeWitness);
  delivered.detachAndReattach(delivered.cards[1]); delivered.observer.deliver();
  assert.equal(finish(delivered).removed, 1, "observer callbacks must record removals before finish");

  const replaced = scalarWitnessFixture(makeWitness), obsolete = replaced.cards[1];
  const replacement = replaced.h.element("section", { class: "vgroup", "data-dashboard-card": "later" });
  replaced.root.childNodes[1] = replacement; replacement.parentElement = replaced.root; obsolete.parentElement = null;
  replaced.observer.queue(obsolete);
  assert.equal(finish(replaced).retained, false, "replacing a later child must fail grid identity retention");
  const reordered = scalarWitnessFixture(makeWitness);
  [reordered.root.childNodes[1], reordered.root.childNodes[2]] = [reordered.cards[2], reordered.cards[1]];
  assert.equal(finish(reordered).retained, false, "every original card must retain its own child position");
  const extended = scalarWitnessFixture(makeWitness), added = extended.h.element("section");
  extended.root.childNodes.push(added); added.parentElement = extended.root;
  assert.equal(finish(extended).retained, false, "scalar grid must retain its complete child count");
  const disconnected = scalarWitnessFixture(makeWitness);
  disconnected.body.childNodes = []; disconnected.root.parentElement = null;
  assert.equal(finish(disconnected).retained, false, "original grid children must remain connected");
  const visibility = scalarWitnessFixture(makeWitness);
  visibility.cards[2].hidden = false;
  assert.equal(finish(visibility).visibilityStable, false, "changed card-owned hidden state must fail visibility stability");
  const closed = scalarWitnessFixture(makeWitness);
  closed.witness.close(); closed.witness.close();
  assert.equal(closed.observer.closes, 1, "explicit close must be idempotent without finish");
}

assertScalarWitnessContinuity(createScalarGridWitness);
const witnessSource = createScalarGridWitness.toString();
for (const [label, anchor, replacement] of [
  ["first child only", "const tracked = new Set(children);", "const tracked = new Set(children.slice(0, 1));"],
  ["ignored removals", "if (tracked.has(node)) removed++;", "if (false) removed++;"],
]) {
  assert.equal(witnessSource.split(anchor).length, 2, label + ": witness control must mutate one exact helper seam");
  const mutant = vm.runInNewContext("(" + witnessSource.replace(anchor, replacement) + ")");
  assert.throws(() => assertScalarWitnessContinuity(mutant),
    error => error.code === "ERR_ASSERTION" && error.actual === 0 && error.expected === 1 &&
      error.message.startsWith("queued later-card removal must be observed even after reattachment"),
    label + ": a final first-child check must not substitute for continuous removal observation");
}
console.log("UI scalar-grid continuity witness and both temporal negative controls passed");

function assertNestedScalarWitness(makeWitness) {
  for (const scope of [undefined, false]) {
    const fixture = scalarWitnessFixture(makeWitness, scope), nested = fixture.cards[1].childNodes[0];
    fixture.detachAndReattach(nested); fixture.detachAndReattach(nested.childNodes[0]);
    const result = fixture.witness.finish();
    assert.equal(result.retained, true, "default witness must preserve the same direct-child contract");
    assert.equal(result.removed, 0, "descendant removal tracking must remain opt-in");
    assert.equal(fixture.observer.pending.length, 0);
    assert.equal(fixture.observer.closes, 1);
  }
  for (const kind of ["element", "text"]) {
    const fixture = scalarWitnessFixture(makeWitness, true), direct = fixture.cards[1];
    const nested = direct.childNodes[0], target = kind === "text" ? nested.childNodes[0] : nested;
    assert.equal(target.nodeType, kind === "text" ? 3 : 1, "recursive fixture must reach the intended node type");
    fixture.detachAndReattach(target);
    const result = fixture.witness.finish();
    assert.equal(fixture.root.childNodes[1], direct, "temporary nested removal must leave the direct child unchanged");
    assert.equal(result.retained && target.isConnected, true, "nested removal fixture must end fully reattached");
    assert.equal(result.removed, 1, "recursive scalar witness must record temporary nested removal: " + kind);
    assert.equal(fixture.observer.pending.length, 0);
    assert.equal(fixture.observer.closes, 1);
  }
}

assertNestedScalarWitness(createScalarGridWitness);
const recursiveBranch = "if (trackDescendants) {";
assert.equal(witnessSource.split(recursiveBranch).length, 2, "recursive witness control must target one exact helper branch");
const nonRecursiveWitness = vm.runInNewContext("(" + witnessSource.replace(recursiveBranch, "if (false) {") + ")");
assert.throws(() => assertNestedScalarWitness(nonRecursiveWitness),
error => error.code === "ERR_ASSERTION" && error.actual === 0 && error.expected === 1 &&
  error.message.startsWith("recursive scalar witness must record temporary nested removal"),
"disabling recursive tracking must fail the nested-removal assertion");
console.log("UI recursive scalar witness covers nested elements/text and rejects disabled tracking");

console.log("UI trend touch and keyboard pin/rebuild/poll focus tests passed");
