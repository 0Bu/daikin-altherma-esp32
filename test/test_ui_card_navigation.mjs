// Execute the production selection/reconciliation functions with actual vcard metadata. The real
// browser suite owns responsive geometry and native pointer/keyboard behavior; this harness covers
// source disappearance and render holds without timing-dependent device traffic.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const decode = text => text.replace(/&(amp|lt|gt|quot);/g,
  (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"' }[entity]));

class Element {
  constructor(document, id = "") {
    this.document = document;
    this.id = id;
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.hidden = false;
    this.writes = 0;
    this._html = "";
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g,
      (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(element) { return element === this || this.children.includes(element); }
  focus() { this.document.activeElement = this; }
  set innerHTML(html) {
    this._html = html;
    this.writes++;
    this.children = [];
    const matcher = this.id === "cardNav" ? /<button\b([^>]*)>([\s\S]*?)<\/button>/g
      : /<div\b([^>]*\bclass="vgroup"[^>]*)>/g;
    for (const match of html.matchAll(matcher)) {
      const child = new Element(this.document);
      for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g))
        child.setAttribute(attribute[1], decode(attribute[2]));
      child.textContent = decode((match[2] || "").replace(/<[^>]*>/g, ""));
      this.children.push(child);
    }
  }
  get innerHTML() { return this._html; }
  querySelectorAll(selector) {
    if (selector === ".vgroup[data-dashboard-card]")
      return this.children.filter(child => child.dataset.dashboardCard != null);
    if (selector === "[data-card]") return this.children.filter(child => child.dataset.card != null);
    throw new Error(`unhandled card-navigation selector: ${selector}`);
  }
}

const document = {
  activeElement: null,
  elements: new Map(),
  getElementById(id) { return this.elements.get(id) || null; },
};
for (const id of ["cardBrowser", "cardNav", "valueGroups"])
  document.elements.set(id, new Element(document, id));
const i18n = readAppFragments(["i18n.js"]);
const locales = JSON.parse(i18n.match(/const UI_LANGS = Object.freeze\((\[[^\n]+\])\)/)[1]);
const context = vm.createContext({
  document,
  navigator: { language: "en" },
  localStorage: { getItem: () => "en", setItem() {} },
  fetch() { throw new Error("card selection must not fetch or write settings"); },
  valueGroupsHtml: () => "",
  setTimeout, clearTimeout,
});
vm.runInContext(readAppFragments(["i18n.js", "app_state.js", "dashboard.js"]) +
  locales.filter(code => code !== "en").map(readUiLocale).join("\n") + `
  this.ui = {
    S, vcard, icon: dashboardCardIcon, sync: syncDashboardCards, select: selectDashboardCard,
    lang: code => { LANG = code; }, text: key => t(key),
    render: (diagnosis, model, values) => {
      checkupCardHtml = () => diagnosis;
      statusCardsHtml = () => model;
      valueGroupsHtml = () => values;
      renderCards();
    },
  };`, context);
const { ui } = context;
const host = document.getElementById("valueGroups");
const nav = document.getElementById("cardNav");
const browser = document.getElementById("cardBrowser");
const card = (key, label = key) => ui.vcard(label, "<p>Fixture reading</p>", "", "", key);
const keys = () => nav.children.map(button => button.dataset.card);
const selected = () => nav.children.filter(button => button.getAttribute("aria-pressed") === "true");
const visible = () => host.children.filter(element => !element.hidden).map(element => element.dataset.dashboardCard);
function expectSelection(key, message) {
  assert.equal(ui.S.dashboardCard, key, `${message}: state`);
  assert.deepEqual(visible(), [key], `${message}: exactly one card is shown`);
  assert.deepEqual(selected().map(button => button.dataset.card), [key], `${message}: exactly one pressed button`);
  assert.equal(host.getAttribute("aria-labelledby"), selected()[0].id, `${message}: content naming`);
}

assert.equal(ui.S.dashboardCard, "diagnosis", "a new dashboard starts with diagnosis selected");
ui.S.status = { diagnostics: { enabled: true }, hp: { connected: true } };
ui.render(card("diagnosis"), card("model"), card("group:Operation") + card("modbus"));
expectSelection("diagnosis", "initial available diagnosis");
assert.deepEqual(keys(), ["diagnosis", "model", "group:Operation", "modbus"]);
assert.ok(nav.children.every(button => button.getAttribute("type") === "button" &&
  button.getAttribute("aria-controls") === "valueGroups"), "navigation uses native content-control buttons");
for (const className of ["dashboard-card-icon", "dashboard-card-label"])
  assert.equal(Array.from(nav.innerHTML.matchAll(new RegExp(`class="${className}"`, "g"))).length, 4,
    `every rendered button has its ${className} element`);
assert.doesNotMatch(nav.innerHTML, /dashboard-card-chevron/, "card names have no trailing navigation arrow");
const knownKeys = ["diagnosis", "model", "group:Operation", "group:Domestic hot water", "group:Water circuit",
  "group:Refrigerant / outdoor", "group:Protection", "group:Electrical", "group:Device", "group:Other values", "modbus"];
const knownIcons = knownKeys.map(key => ui.icon(key));
assert.equal(new Set(knownIcons).size, knownKeys.length, "each standard card has its own recognizable icon");
for (const icon of knownIcons) {
  assert.match(icon, /<svg[^>]*class="dashboard-card-icon"[^>]*width="17"[^>]*height="17"/);
  assert.match(icon, /viewBox="0 0 24 24"/, "icon geometry uses the prototype's vector coordinate system");
  assert.match(icon, /aria-hidden="true" focusable="false"/, "decorative icons do not duplicate spoken card names");
  assert.match(icon, /<(?:path|rect)\b/, "every icon renders actual self-contained vector geometry");
}
assert.equal(ui.icon('group:Installer "<custom>"'), ui.icon("group:Other values"),
  "firmware custom groups receive a safe fixed icon rather than inserting their key as markup");

const mounted = [...host.children];
const disclosureState = ui.S.descOpen;
const trendState = ui.S.hist;
ui.S.descOpen.add("fixture-row");
ui.S.hist.set("fixture-trend", { v: [1, 2] });
for (const key of keys()) {
  ui.select(key);
  expectSelection(key, `select ${key}`);
}
assert.deepEqual(host.children, mounted, "selection keeps mounted rows and their delegated handlers");
assert.equal(ui.S.descOpen, disclosureState, "selection preserves disclosure state");
assert.equal(ui.S.hist, trendState, "selection preserves trend cache");
assert.ok(ui.S.descOpen.has("fixture-row"));
assert.equal(ui.S.hist.get("fixture-trend").v[1], 2);
ui.select("unknown-source");
expectSelection("modbus", "unknown selection cannot blank the content");

// A locale repaint and a changed card order keep source keys stable. A focused native navigation
// button is restored to that source when translated labels require replacement of nav markup.
ui.select("model");
for (const code of locales) {
  ui.lang(code);
  selected()[0].focus();
  ui.render(card("diagnosis", ui.text("nav.diagnosis")), card("model", ui.text("card.model")),
    card("group:Operation", ui.text("group.Operation")));
  expectSelection("model", `${code} locale repaint`);
  assert.equal(selected()[0].textContent, ui.text("card.model"), `${code} translated model navigation`);
  assert.equal(nav.getAttribute("aria-label"), ui.text("nav.cards"), `${code} translated navigation name`);
  assert.equal(document.activeElement.dataset.card, "model", `${code} source focus survives nav replacement`);
}
ui.lang("en");

const custom = 'group:Installer "A&B" <view>';
const label = 'Installer "A&B" <view>';
ui.render(card("diagnosis"), card("model"), card(custom, label));
ui.select(custom);
expectSelection(custom, "escaped firmware custom group");
assert.equal(selected()[0].textContent, label, "custom labels are text rather than markup");
assert.match(nav.innerHTML, /Installer &quot;A&amp;B&quot; &lt;view&gt;/,
  "custom labels and identifiers are escaped at the HTML boundary");
assert.doesNotMatch(ui.vcard("Settings", "<p>Existing settings row</p>"), /data-dashboard-/,
  "ordinary Settings cards stay outside dashboard navigation");

// Changes in independently available sources must reconcile against the actual installed cards.
ui.render(card("diagnosis"), card("model"), "");
expectSelection("diagnosis", "custom source removed");
ui.select("model");
ui.render(card("diagnosis"), "", card("group:Operation"));
expectSelection("diagnosis", "model disappears");
ui.render("", card("model"), card("group:Operation"));
expectSelection("model", "diagnosis unavailable");
ui.render("", "", card("modbus"));
expectSelection("modbus", "HomeHub is the sole source");
ui.render("", "", "");
assert.equal(browser.hidden, true, "the complete navigation hides when there are no available cards");
assert.deepEqual(keys(), [], "removed sources leave no dead navigation entries");
assert.equal(host.getAttribute("aria-labelledby"), null, "empty content does not refer to a removed button");
ui.render("", "", card("values", ui.text("group.Values")));
assert.equal(browser.hidden, false, "the waiting-values card can make navigation available again");
expectSelection("values", "waiting values fallback");

ui.render(card("diagnosis"), card("model"), "");
ui.select("model");
ui.S.clickHold = true;
ui.render(card("diagnosis"), "", "");
expectSelection("model", "held newer data cannot reconcile against uninstalled markup");
assert.deepEqual(keys(), ["diagnosis", "model"], "navigation describes the installed frame during the hold");
ui.select("diagnosis");
expectSelection("diagnosis", "selection remains immediate during a click hold");
ui.S.clickHold = false;
ui.render(card("diagnosis"), "", "");
expectSelection("diagnosis", "released hold installs the pending source change");
assert.deepEqual(keys(), ["diagnosis"]);
ui.render(card("diagnosis"), card("model"), "");
ui.S.scrub = "fixture-trend";
ui.render("", "", card("modbus"));
assert.deepEqual(keys(), ["diagnosis", "model"], "scrub protects its installed values frame");
ui.select("model");
expectSelection("model", "selection remains immediate during scrubbing");
ui.S.scrub = null;
ui.render("", "", card("modbus"));
expectSelection("modbus", "source reconciliation resumes after the scrub");

// The card-level opt-in must suppress even a nonempty renderer result (e.g. the independent
// refrigerant observation), not just its 24-hour rows. Exercise the actual render/reconcile path.
for (const diagnostics of [{ enabled: false }, undefined, { enabled: "true" }]) {
  ui.S.status.diagnostics = diagnostics;
  ui.S.dashboardCard = "diagnosis";
  ui.render(card("diagnosis"), card("model"), card("group:Operation"));
  assert.deepEqual(keys(), ["model", "group:Operation"], "disabled/absent opt-in removes diagnosis navigation");
  assert.ok(!host.children.some(element => element.dataset.dashboardCard === "diagnosis"),
    "disabled/absent opt-in removes diagnosis content rather than only hiding it");
  expectSelection("model", "Model is the default when diagnosis is disabled");
}
ui.S.status.diagnostics = { enabled: true };
ui.render(card("diagnosis"), card("model"), card("group:Operation"));
expectSelection("model", "enabling diagnosis preserves an existing valid selection");
ui.select("diagnosis");
selected()[0].focus();
ui.S.status.diagnostics.enabled = false;
ui.render(card("diagnosis"), card("model"), card("group:Operation"));
expectSelection("model", "disabling the selected diagnosis falls back to Model");
assert.equal(document.activeElement.dataset.card, "model", "focus follows the removed diagnosis to Model");
ui.select("group:Operation");
ui.render(card("diagnosis"), card("model"), card("group:Operation"));
expectSelection("group:Operation", "disabled diagnosis preserves other card choices");
ui.S.dashboardCard = "diagnosis";
ui.render(card("diagnosis"), "", card("modbus"));
expectSelection("modbus", "without Model, disabled diagnosis falls back to an available source");

console.log("dashboard card navigation: stable selection, localized labels, availability fallback and held-frame interactions passed");
