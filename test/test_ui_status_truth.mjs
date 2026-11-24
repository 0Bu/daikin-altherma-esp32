// Current service-settings readability and diagnosis freshness use the real production render.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppSource, readUiLocale } from "../tools/ui/read_app_source.mjs";

// ── A DOM shim wide enough to load the production bundle ───────────────────────────────────────
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
  querySelector(selector) {
    const suffix = { ".crash-title": "Title", ".ota-alert-message": "Message",
      ".ota-alert-close": "Close" }[selector];
    return suffix && this.id.startsWith("otaAlert")
      ? this.doc.getElementById(this.id + suffix) : null;
  }
  querySelectorAll() { return []; }
  focus() {} blur() {}
  setAttribute(n, v) { this.attributes[n] = String(v); this[n] = String(v); }
  getAttribute(n) { return this.attributes[n] ?? null; }
  removeAttribute(n) { delete this.attributes[n]; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(fragment) { this.innerHTML = fragment.innerHTML; this.children = []; }
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
  createElement(tag) {
    const element = new Element(`tag:${tag}`, this);
    // This status/copy fixture stores serialized markup; trend tests and browsers cover DOM reuse.
    if (tag === "template") element.content = element;
    return element;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {} removeEventListener() {}
}

const context = vm.createContext({
  document: new Document(),
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
  navigator: { language: "de-DE" },
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

const markup = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const banners = ["configWarningDash", "configWarningSettings"].map((id) => {
  const block = markup.match(new RegExp(`<div[^>]+id="${id}"[^>]*>[\\s\\S]*?\\n        </div>`))?.[0];
  assert.ok(block, `${id}: persistent warning must exist in production markup`);
  assert.match(block, /role="alert"/);
  assert.match(block, /\bhidden\b/);
  assert.doesNotMatch(block, /<button|data-act|onclick|tabindex=/,
    `${id}: the warning has no dismissal or acknowledgement action`);
  const banner = context.document.getElementById(id);
  banner.hidden = true;
  banner.copy = [...block.matchAll(/data-i18n="([^"]+)"/g)].map((match) => {
    const element = new Element(`${id}:${match[1]}`, context.document);
    element.dataset.i18n = match[1];
    return element;
  });
  assert.equal(banner.copy.length, 2, `${id}: title and explanation are translated static copy`);
  return banner;
});
context.document.querySelectorAll = (selector) => selector === "[data-i18n]"
  ? banners.flatMap((banner) => banner.copy) : [];

const locales = ["de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"];
vm.runInContext(readAppSource().replace(/\nboot\(\);\s*$/, "\n") +
  locales.map(readUiLocale).join("") + `
  this.__ui = { S, UI_LANGS, t, esc, renderApp, activateLang, applyStaticI18n, showStage, esp32CardHtml };`,
context, { filename: "main/www/app.sources" });
const ui = context.__ui;
assert.deepEqual(Array.from(ui.UI_LANGS), ["en", ...locales]);
ui.S._values = []; ui.S._modbus = [];

const status = () => ({
  sys: {}, hp: {}, diagnostics: { enabled: true },
  mqtt: { configured: true, connected: true },
  env3: { enabled: true, connected: true, fresh: true, temperature_c: 12.4 },
  modbus: { enabled: true, connected: true },
});

for (const lang of ui.UI_LANGS) {
  ui.activateLang(lang); ui.applyStaticI18n();
  ui.S.status = status();
  for (const value of [undefined, false, "true", 1, null, {}, true, true, false, true, undefined]) {
    if (value === undefined) delete ui.S.status.sys.config_unreadable;
    else ui.S.status.sys.config_unreadable = value;
    ui.renderApp();
    for (const banner of banners) {
      assert.equal(banner.hidden, value !== true, `${lang}: only literal true shows ${banner.id}`);
      assert.equal(banner.copy[0].textContent, ui.t("config.unreadable_title"));
      assert.equal(banner.copy[1].textContent, ui.t("config.unreadable_meta"));
    }
  }
  ui.S.status.sys.config_unreadable = true;
  ui.renderApp();
  for (const stage of ["settings", "dashboard", "settings"]) {
    ui.showStage(stage); ui.renderApp(); ui.renderApp();
    assert.ok(banners.every((banner) => !banner.hidden), `${lang}: navigation/polls preserve warning`);
  }
  // Old status fields can survive in a browser snapshot across firmware replacement.
  ui.S.status.heating_curve = { armed: true, state: "recording" };
  ui.S.status.reference_temperature = { configured: true, name: "Retired MQTT room source" };
  ui.S.status.weather_forecast = { configured: true, fresh: true };
  const settings = ui.esp32CardHtml();
  assert.match(settings, /data-act="circulation"/, lang+" circulation remains reachable");
  assert.doesNotMatch(settings, /data-desc="dynamic:|data-act="(?:ref-temp|weather)"/,
    lang+" retired editors and card are absent");
  assert.doesNotMatch(settings, /Retired MQTT room source/);
}
console.log(`status truth: ${ui.UI_LANGS.length} locales; literal warnings, navigation/polls and remaining diagnostics`);
