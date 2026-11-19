// Schematic header data-source pills (#gX10a and #gModbus): visibility for configured/used sources,
// blue/petrol live provenance vs grey offline state, gapless right-to-left packing beside ENV III
// and Boost, and link-status inspector rendering/auto-close.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  readAppFragments,
  readHistoryLifecycle,
  readHtmlRenderer,
  readUiLocale,
} from "../tools/ui/read_app_source.mjs";

const index = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const source = readAppFragments(["i18n.js"]) + readUiLocale("de") +
  readHistoryLifecycle() + readHtmlRenderer() + "\n" +
  readAppFragments(["dashboard.js", "descriptions.js", "history.js", "schematic.js"]);

assert.match(
  index,
  /id="gX10a"[^>]*data-insp="x10a"[\s\S]*?x="496"[\s\S]*?>X10A<\/text>[\s\S]*?id="gModbus"[^>]*data-insp="modbus"[\s\S]*?x="552"[\s\S]*?>MODBUS<\/text>[\s\S]*?id="gEnv3"[\s\S]*?x="624"[\s\S]*?id="gSgRequest"[\s\S]*?x="706"/,
  "X10A and MODBUS pills must precede ENV III and Boost in left-to-right header order",
);
assert.match(style, /svg \.sc-x10a\.live \.sc-x10a-box\s*\{[^}]*stroke:\s*var\(--brand\)/,
  "a live X10A pill must use the X10A blue token");
assert.match(style, /svg \.sc-modbus\.live \.sc-modbus-box\s*\{[^}]*stroke:\s*var\(--src-mb\)/,
  "a live MODBUS pill must use the Modbus petrol token");

function classList() {
  const names = new Set();
  return {
    names,
    contains(name) { return names.has(name); },
    remove(...list) { list.forEach((n) => names.delete(n)); },
    toggle(name, force) {
      const on = force === undefined ? !names.has(name) : !!force;
      if (on) names.add(name); else names.delete(name);
      return on;
    },
  };
}

function element(id) {
  const titleEl = { textContent: "" };
  return {
    id, textContent: "", _html: "", hidden: false, style: {}, attrs: {}, classList: classList(),
    dataset: id === "gX10a" ? { insp: "x10a" }
           : id === "gModbus" ? { insp: "modbus" }
           : id === "gEnv3" ? { insp: "env3" }
           : id === "gSgRequest" ? { insp: "sgrequest" } : {},
    titleEl,
    get innerHTML() { return this._html; },
    set innerHTML(html) {
      this._html = html;
      this.textContent = html.replace(/<[^>]*>/g, "");
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    removeAttribute(name) { delete this.attrs[name]; },
    querySelector(sel) { return sel === ":scope > title" ? titleEl : null; },
    querySelectorAll() { return []; },
    replaceChildren(fragment) { this.innerHTML = fragment.markup; },
  };
}

const ids = [
  "gX10a", "gModbus", "gEnv3", "gSgRequest", "svEnv3Temp", "svMode",
  "inspect", "inspCard", "inspTitle", "inspSrc", "inspNow", "inspBody", "inspHist", "inspRows",
];
const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
elements.gX10a.style.display = "none";
elements.gModbus.style.display = "none";
elements.gEnv3.style.display = "none";
elements.gSgRequest.style.display = "";

const S = {
  stage: "dash",
  status: null,
  live: null,
  _values: [{ label: "Leaving water", value: "35.0", unit: "°C" }],
  _modbus: [{ label: "Outdoor air", value: "8.0", unit: "°C", off: 44 }],
  hist: new Map(),
  insp: null,
  inspSig: "",
  inspHistSig: "",
  scrub: null,
  transportUnavailable: "",
};

const sandbox = {
  navigator: { language: "de-DE" },
  localStorage: { getItem: () => "de", setItem: () => {} },
  document: {
    documentElement: { lang: "de" },
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(sel) {
      return sel === "#schem .sc-hit"
        ? [elements.gX10a, elements.gModbus, elements.gEnv3, elements.gSgRequest] : [];
    },
    createElement(tag) {
      assert.equal(tag, "template");
      const content = { markup: "", querySelectorAll: () => [] };
      return { content, set innerHTML(markup) { content.markup = markup; } };
    },
  },
  window: { matchMedia: () => ({ matches: false }) },
  S,
  cancelHistoryGesture() {},
  setTxt(id, value) { if (elements[id]) elements[id].textContent = String(value ?? ""); },
};

vm.runInNewContext(`${source}
  globalThis.__run = () => { renderEnv3Pill(); renderSourcePills(); layoutHeaderPills(); renderInspect(); };
  globalThis.__pick = (k) => inspectPick(k);
`, sandbox, { filename: "source-pills-vm.js" });

// 1. Before initial /status: only Boost is visible at its base x (dx = 0).
sandbox.__run();
assert.equal(elements.gX10a.style.display, "none");
assert.equal(elements.gModbus.style.display, "none");
assert.equal(elements.gSgRequest.getAttribute("transform"), null);

// 2. All four pills visible and live: zero transform on every pill, blue + petrol active states.
S.status = {
  hp: { proto: "I", rx: 44, tx: 43, connected: true, last_ok_s: 2, values: 99 },
  profile: { id: "altherma3_r" },
  modbus: { host: "192.0.2.30", port: 502, unit_id: 1, profile: "homehub", enabled: true, connected: true, values: 20 },
  env3: { supported: true, enabled: true, fresh: true, temperature_c: 21.9, humidity_pct: 48, pressure_hpa: 1012 },
  sys: { safe_mode: false },
};
sandbox.__run();
assert.equal(elements.gX10a.style.display, "");
assert.equal(elements.gModbus.style.display, "");
assert.equal(elements.gEnv3.style.display, "");
assert.equal(elements.gX10a.classList.contains("live"), true);
assert.equal(elements.gModbus.classList.contains("live"), true);
for (const id of ["gX10a", "gModbus", "gEnv3", "gSgRequest"]) {
  assert.equal(elements[id].getAttribute("transform"), null, `${id} sits at static markup coordinates when all 4 show`);
}
assert.equal(elements.gX10a.getAttribute("aria-label"), "Datenquelle X10A: Online");
assert.equal(elements.gModbus.getAttribute("aria-label"), "Datenquelle Modbus: Verbunden");

// 3. ENV III disabled -> X10A and MODBUS pack right by +82 px (74 + 8) with no gap before Boost.
S.status.env3.enabled = false;
sandbox.__run();
assert.equal(elements.gEnv3.style.display, "none");
assert.equal(elements.gModbus.getAttribute("transform"), "translate(82 0)");
assert.equal(elements.gX10a.getAttribute("transform"), "translate(82 0)");

// 4. Dual-source plant loses X10A -> X10A stays visible as grey offline because profile/last_ok_s prove use.
S.status.hp.connected = false;
S.status.hp.last_ok_s = 45;
sandbox.__run();
assert.equal(elements.gX10a.style.display, "");
assert.equal(elements.gX10a.classList.contains("live"), false);
assert.equal(elements.gX10a.getAttribute("aria-label"), "Datenquelle X10A: Offline");
assert.equal(elements.gModbus.classList.contains("live"), true);

// 5. Inspecting X10A and MODBUS renders localized state, protocol/host facts, and auto-closes if Modbus is removed.
sandbox.__pick("x10a");
assert.equal(elements.inspect.classList.contains("open"), true);
assert.equal(elements.inspTitle.textContent, "X10A-Serviceschnittstelle");
assert.equal(elements.inspNow.textContent, "Offline");
assert.match(elements.inspRows.textContent, /44 \/ 43/);

sandbox.__pick("modbus");
assert.equal(elements.inspTitle.textContent, "Modbus TCP");
assert.equal(elements.inspNow.textContent, "Verbunden");
assert.match(elements.inspRows.textContent, /192\.0\.2\.30:502/);

S.status.modbus = { host: "", port: 502, unit_id: 1, enabled: false, connected: false };
sandbox.__run();
assert.equal(elements.gModbus.style.display, "none", "removing Modbus host hides the pill");
assert.equal(S.insp, null, "removing Modbus host closes its open inspector");
assert.equal(elements.gX10a.getAttribute("transform"), "translate(154 0)",
  "lone X10A pill packs directly beside Boost (706 - 8 - 48 = 650, dx = +154)");

// 6. Pure Modbus-only plant (never detected X10A): hides X10A and shows only MODBUS + Boost.
S.status = {
  hp: { proto: "I", rx: 44, tx: 43, connected: false, last_ok_s: -1, values: 0 },
  profile: { id: "auto" },
  history: { rows: [{ id: "free_heap", label: "Free heap" }] },
  modbus: { host: "192.0.2.30", port: 502, unit_id: 1, enabled: true, connected: false,
            error: "connect timeout", error_code: "connect_timeout" },
  env3: { supported: true, enabled: false },
  sys: { safe_mode: false },
};
sandbox.__run();
assert.equal(elements.gX10a.style.display, "none", "pure Modbus setup hides unused X10A pill");
assert.equal(elements.gModbus.style.display, "");
assert.equal(elements.gModbus.classList.contains("live"), false);
assert.match(elements.gModbus.getAttribute("aria-label"), /Zeitüberschreitung|nicht erreichbar/);
console.log("X10A and MODBUS header pills: visibility, provenance colours, packing and inspectors verified");
