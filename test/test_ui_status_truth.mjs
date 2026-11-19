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
  this.__ui = { S, UI_LANGS, t, esc, renderApp, activateLang, applyStaticI18n, showStage,
    dynamicControlCardHtml, dynamicStateRow, outdoorAxisRow, plantOutdoorAxisRow, roomSourceStatus,
    heatingCurveBinsRow };`,
context, { filename: "main/www/app.sources" });
const ui = context.__ui;
assert.deepEqual(Array.from(ui.UI_LANGS), ["en", ...locales]);
ui.S._values = []; ui.S._modbus = [];

const status = () => ({
  sys: {}, hp: {}, diagnostics: { enabled: true },
  mqtt: { configured: true, connected: true },
  reference_temperature: { configured: true, name: "Example room", topic: "room/state",
    has_value: true, temperature_c: 21.5, has_setpoint: true, setpoint_c: 22, age_s: 1,
    fresh: true, freshness_reason: "fresh", temperature_valid: true, control_eligible: true,
    reason: "eligible", room_error_k: -0.5 },
  env3: { enabled: true, connected: true, fresh: true, temperature_c: 12.4 },
  modbus: { enabled: true, connected: true },
  heating_curve: { armed: true, state: "blocked", reason: "evaluation_stale", reason_code: 15,
    sample_eligible: false, current_room_error_k: null, outdoor_temperature_c: null,
    plant_outdoor_temperature_c: null, plant_outdoor_source: null, forecast_available: false,
    last_sample_room_error_k: -0.4, last_sample_unix_s: 1780000000,
    last_sample_outdoor_temperature_c: 12.3, last_sample_outdoor_source: "env3",
    last_sample_plant_outdoor_temperature_c: 8.9, last_sample_plant_outdoor_source: "homehub" },
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
  const d = ui.S.status.heating_curve;
  const event = JSON.stringify(d);
  const state = ui.dynamicStateRow(d, ui.S.status.reference_temperature, {}, ui.S.status.modbus,
    ui.S.status.mqtt, ui.S.status.sys);
  assert.equal(state.key, "dyn.state_stale", `${lang}: evaluation age has its own state`);
  assert.equal(state.cls, "", `${lang}: stale evaluation is not a sensor-fault warning`);
  const card = ui.dynamicControlCardHtml();
  assert.ok(card.includes(ui.esc(ui.t("dyn.state_stale"))));
  assert.ok(card.includes(ui.esc(ui.t("dyn.state_help_stale"))));
  assert.ok(!card.includes(ui.esc(ui.t("dyn.state_help_inactive"))));
  assert.doesNotMatch(card, /dynamic:outdoor-bins/, `${lang}: no row on older firmware`);
  for (const html of [ui.outdoorAxisRow(d, ui.S.status.env3),
    ui.plantOutdoorAxisRow(d, ui.S.status.modbus)]) {
    assert.ok(html.includes(ui.esc(ui.t("dyn.outdoor_status_idle", "ENV III"))) ||
      html.includes(ui.esc(ui.t("dyn.outdoor_status_idle", "HomeHub"))),
    `${lang}: paused diagnosis does not blame either healthy outdoor source`);
  }
  for (const [html, sample] of [[ui.outdoorAxisRow(d, ui.S.status.env3), 12.3],
    [ui.plantOutdoorAxisRow(d, ui.S.status.modbus), 8.9]]) {
    assert.ok(html.includes(sample.toLocaleString(lang,
      { minimumFractionDigits: 1, maximumFractionDigits: 1 })), `${lang}: historical sample survives`);
  }
  assert.equal(ui.roomSourceStatus(ui.S.status.reference_temperature, ui.S.status.mqtt).cls, "ok",
    `${lang}: independently fresh room source stays fresh`);
  assert.equal(JSON.stringify(d), event, `${lang}: rendering does not replace the recorded event`);

  d.method_version = 4;
  d.outdoor_bins = null;
  const unavailable = ui.heatingCurveBinsRow(d);
  assert.ok(unavailable.includes(ui.esc(ui.t("dyn.bins_no_scope"))), `${lang}: null bins explain absence`);
  assert.ok(unavailable.includes(ui.esc(ui.t("sys.nodata"))));
  assert.ok(!unavailable.includes(ui.esc(ui.t("dyn.bins_count", "0"))),
    `${lang}: unavailable scope does not display a sample count`);

  const first = 1780000000, last = first + 5400;
  const homehub = { samples: 2, first_unix_s: first, last_unix_s: last,
    room_sum_tenths: 12, room_min_tenths: 2, room_max_tenths: 10,
    outdoor_sum_tenths: -73, outdoor_min_tenths: -48, outdoor_max_tenths: -25 };
  const env3 = { samples: 1, first_unix_s: null, last_unix_s: null,
    room_sum_tenths: 0, room_min_tenths: 0, room_max_tenths: 0,
    outdoor_sum_tenths: 0, outdoor_min_tenths: 0, outdoor_max_tenths: 0 };
  d.outdoor_bins = { scope_samples: 5, target_c: 21.5,
    homehub: [homehub, null, null, null], env3: [null, env3, null, null] };
  const binsCard = ui.dynamicControlCardHtml();
  const row = ui.heatingCurveBinsRow(d);
  assert.ok(binsCard.includes(row), `${lang}: recorded bins are part of the existing card`);
  assert.match(row, /aria-expanded="false" aria-controls="dynamic-outdoor-bins-detail"/);
  assert.match(row, /id="dynamic-outdoor-bins-detail"/);
  assert.ok(row.includes(ui.esc(ui.t("dyn.bins_count", "5"))), `${lang}: scope count is not an axis sum`);
  assert.ok(row.includes(ui.esc(ui.t("dyn.bins_count", "2"))));
  assert.ok(row.includes(ui.esc(ui.t("dyn.bins_count", "1"))));
  assert.ok(row.includes(ui.esc("HomeHub · <0 °C")) && row.includes(ui.esc("ENV III · 0–<5 °C")));
  assert.ok(row.includes(ui.esc(ui.t("dyn.bins_help"))));
  const num = (x, unit) => `${x.toLocaleString(lang, { minimumFractionDigits: 1,
    maximumFractionDigits: 1, signDisplay: unit === "K" ? "exceptZero" : "auto" })} ${unit}`;
  for (const [mean, min, max, unit] of [[.6, .2, 1, "K"], [-3.65, -4.8, -2.5, "°C"],
    [0, 0, 0, "K"], [0, 0, 0, "°C"]]) {
    const evidence = ui.t("dyn.bins_stats", num(mean, unit), num(min, unit), num(max, unit));
    assert.ok(row.includes(ui.esc(evidence)), `${lang}: reports mean, range and genuine zero`);
  }
  const localDate = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit",
    minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  const span = `${localDate.format(first * 1000)} – ${localDate.format(last * 1000)}`;
  assert.ok(row.includes(ui.esc(span)), `${lang}: actual first and last measurements are shown`);
  assert.ok(row.includes(ui.esc(ui.t("dyn.bins_no_date"))), `${lang}: missing dates stay unknown`);
  assert.doesNotMatch(row.slice(row.indexOf('id="dynamic-outdoor-bins-detail"')), /<svg|data-act=/,
    `${lang}: the details are passive text without a plot`);

  d.outdoor_bins.env3 = [null, null, null, null];
  const oneAxis = ui.heatingCurveBinsRow(d);
  assert.ok(oneAxis.includes(ui.esc(ui.t("dyn.bins_no_axis"))), `${lang}: an absent axis is explained`);
  assert.ok(oneAxis.includes(ui.esc("HomeHub · <0 °C")));
  assert.ok(!oneAxis.includes(ui.esc("ENV III · 0–<5 °C")), `${lang}: no bin invented for ENV III`);
}
console.log(`status truth: ${ui.UI_LANGS.length} locales; literal warnings, navigation/polls, stale evaluation and heating bins`);
