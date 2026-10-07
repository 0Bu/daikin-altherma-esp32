// The dashboard heading and Model card name the unit only as far as /status.detect.model
// establishes it (logic/detect_identity.hpp). The firmware nulls every field the candidate set does
// not support; this file pins how the UI reads the shapes it can now receive, so a later
// "simplification" back to `m.marketing || m.name` cannot reintroduce either failure:
//   • naming the tie-break's model for an ambiguous set (the EBLA/EDLA monobloc shown for an ERGA
//     split), or
//   • an unexplained brand heading for several same-family profiles without a marketing name, where
//     the family IS established but the families row (shown only for >1 family) stays hidden.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppSource } from "../tools/ui/read_app_source.mjs";

class ClassList {
  constructor() { this.names = new Set(); }
  add(...n) { n.forEach((x) => this.names.add(x)); }
  remove(...n) { n.forEach((x) => this.names.delete(x)); }
  contains(n) { return this.names.has(n); }
  toggle(n, f) {
    const on = f === undefined ? !this.names.has(n) : !!f;
    if (on) this.names.add(n); else this.names.delete(n);
    return on;
  }
}
class Element {
  constructor(id, doc) {
    this.id = id; this.doc = doc; this._value = ""; this.checked = false; this.disabled = false;
    this.hidden = String(id).endsWith("Modal"); this.innerHTML = ""; this.textContent = "";
    this.dataset = {}; this.classList = new ClassList(); this.listeners = new Map();
    this.onclick = null; this.style = {}; this.children = []; this.attributes = {};
  }
  set value(v) { this._value = String(v ?? ""); }
  get value() { return this._value; }
  addEventListener(t, l) { const a = this.listeners.get(t) || []; a.push(l); this.listeners.set(t, a); }
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {} blur() {}
  setAttribute(n, v) { this.attributes[n] = String(v); this[n] = String(v); }
  getAttribute(n) { return this.attributes[n] ?? null; }
  removeAttribute(n) { delete this.attributes[n]; }
  appendChild(c) { this.children.push(c); return c; }
  remove() {} matches() { return false; } closest() { return null; } contains() { return false; }
  setPointerCapture() {} releasePointerCapture() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; }
}
class Document {
  constructor() {
    this.elements = new Map(); this.listeners = new Map(); this.activeElement = null;
    this.documentElement = new Element("html", this); this.body = new Element("body", this);
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new Element(id, this));
    return this.elements.get(id);
  }
  createElement(tag) { return new Element(`tag:${tag}`, this); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {} removeEventListener() {}
}

const context = vm.createContext({
  document: new Document(),
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
  navigator: { language: "en-US" },
  localStorage: { getItem: () => null, setItem() {} },
  window: {
    scrollTo() {}, open() {}, addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerWidth: 900, innerHeight: 800,
  },
  history: { state: null, pushState() {}, replaceState() {}, back() {}, forward() {} },
  location: { pathname: "/", search: "", hash: "", reload() {} },
  URL, URLSearchParams, Blob, AbortController, console,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
});

vm.runInContext(`${readAppSource().replace(/\nboot\(\);\s*$/, "\n")}
  this.__ui = { S, hpModelName, statusCardsHtml };`, context, { filename: "main/www/app.sources" });
const ui = context.__ui;

// The shapes http_status.cpp emits, one per rule in logic/detect_identity.hpp.
const BASE = { proto: "I", rx: 1, tx: 2, valid: true, capacity_kw: null, capacity_kw_iu: 8.0,
  ou_eeprom: "01 50 29 63 07 02" };
const status = (detect, connected = true) => ({ hp: { connected, last_ok_s: 0 }, detect });
const heading = (detect, connected) => {
  ui.S.status = status(detect, connected);
  return ui.hpModelName();
};

// 1. A unique identification names the marketing name, else the exact model.
//    (Illustrative shapes: in the real catalog ERGA E never stands alone — it ties with EBLA/EDLA D
//    and ERGA D DJ — but the heading rule only reads the fields, not the ids.)
assert.equal(heading({ ...BASE, candidates: ["altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"],
  families: ["Altherma 3 R"], ambiguous: false,
  model: { name: "Altherma ERGA E EHV-EHB-EHVZ E EJ series 04-08kW", family: "Altherma 3 R",
    marketing: "Altherma 3 R (ERGA)" } }), "Altherma 3 R (ERGA)");
assert.equal(heading({ ...BASE, candidates: ["altherma_lt_d7_e_bml"], families: ["Altherma LT / older"],
  ambiguous: false, model: { name: "Altherma LT-D7 E BML", family: "Altherma LT / older", marketing: "" } }),
  "Altherma LT-D7 E BML");

// 2. The reference unit: five candidates across three families — the firmware sends model:null, so
//    the heading is the brand and the card explains it with the families row and the EEPROM digits.
const reference = { ...BASE, candidates: ["altherma_ebla_edla_d_series_4_8kw_monobloc",
  "altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw", "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw",
  "altherma_lt_d7_e_bml", "altherma_top_grade"],
  families: ["Altherma 3 M", "Altherma 3 R", "Altherma LT / older"], ambiguous: true, model: null };
assert.equal(heading(reference), "Daikin Altherma");
ui.S.status = status(reference);
const card = ui.statusCardsHtml();
assert.match(card, /3 M · 3 R · LT \/ older/, "an ambiguous set must name the families still in play");
assert.match(card, /01 50 29 63 07 02/, "the EEPROM digits remain the one way to settle it");
assert.doesNotMatch(card, /EBLA|monobloc/i, "the tie-break's monobloc must not be named for a split");

// 3. Same family, marketing name established: the marketing name, never the tie-break's model.
//    (An illustrative shape: this exact pair never forms a set in the real catalog.)
assert.equal(heading({ ...BASE, candidates: ["altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw",
  "altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw"], families: ["Altherma 3 R"], ambiguous: true,
  model: { name: null, family: "Altherma 3 R", marketing: "Altherma 3 R (ERGA)" } }), "Altherma 3 R (ERGA)");

// 4. Same family, NO marketing name (the LT / older and Altherma 3 GEO sets in the catalog): the
//    family itself — not the brand, which would read as a failed detection with nothing explaining it.
assert.equal(heading({ ...BASE, candidates: ["altherma_lt_d7_e_bml", "altherma_top_grade"],
  families: ["Altherma LT / older"], ambiguous: true,
  model: { name: null, family: "Altherma LT / older", marketing: null } }), "Altherma LT / older");

// 5. Offline, nothing is named from the cached fingerprint, however specific it was.
assert.equal(heading({ ...BASE, candidates: ["altherma_lt_d7_e_bml"], families: ["Altherma LT / older"],
  ambiguous: false, model: { name: "Altherma LT-D7 E BML", family: "Altherma LT / older", marketing: "" } },
  false), "Daikin Altherma");
// ...and an invalid fingerprint (POST /detect cleared it) names nothing either.
assert.equal(heading({ ...BASE, valid: false, candidates: [], families: [], ambiguous: false, model: null }),
  "Daikin Altherma");

console.log("UI model identity: heading names only what /status.detect.model establishes");
