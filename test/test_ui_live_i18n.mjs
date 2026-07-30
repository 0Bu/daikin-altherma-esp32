// Regression test for live UI-language changes. Runs the real production render functions from
// main/www/app.js in a tiny DOM-free VM harness: a persistent surface must repaint when LANG changes
// even though every device/status value in its ordinary render signature remains identical.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app = fs.readFileSync(new URL("../main/www/app.js", import.meta.url), "utf8");

function span(start, end) {
  const from = app.indexOf(start);
  assert.notEqual(from, -1, `missing production source marker: ${start}`);
  const to = app.indexOf(end, from);
  assert.notEqual(to, -1, `missing production source marker: ${end}`);
  return app.slice(from, to);
}

function productionFunction(name, endMarker, context) {
  const sandbox = vm.createContext(context);
  vm.runInContext(
    `${span(`function ${name}(`, endMarker)}\nthis.__productionFunction = ${name};`,
    sandbox,
    { filename: "main/www/app.js" },
  );
  return { sandbox, fn: sandbox.__productionFunction };
}

function element() {
  return {
    dataset: {},
    hidden: true,
    writes: 0,
    _html: "",
    set innerHTML(value) { this._html = value; this.writes += 1; },
    get innerHTML() { return this._html; },
  };
}

function languageContext(status, target) {
  const context = {
    LANG: "en",
    S: { status },
    $: () => target,
    esc: String,
  };
  context.t = (key) => `${context.LANG}:${key}`;
  return context;
}

function assertPersistentBannerRepaints(name, endMarker, status) {
  const target = element();
  const context = languageContext(status, target);
  const render = productionFunction(name, endMarker, context).fn;
  render();
  assert.equal(target.writes, 1, `${name} must paint its initial language`);
  const english = target.innerHTML;
  context.LANG = "de";
  render();
  assert.equal(target.writes, 2, `${name} must repaint when only LANG changes`);
  assert.notEqual(target.innerHTML, english, `${name} must replace the old-language copy`);
}

assertPersistentBannerRepaints(
  "renderRecoveryBanner",
  "// ── WiFi rollback banner",
  { sys: { safe_mode: true } },
);

assertPersistentBannerRepaints(
  "renderRollbackBanner",
  "// ── Crash banner",
  { wifi: { rolled_back: true, ssid: "fallback" } },
);

{
  const target = element();
  const status = {
    version: "test",
    last_crash: {
      reason: "panic",
      pc: "",
      task: "",
      coredump: false,
      fault: true,
      backtrace: [],
    },
  };
  const context = languageContext(status, target);
  context.S.crashAsk = "";
  context.S.crashDismissed = "";
  const render = productionFunction(
    "renderCrashBanner",
    "// Copy text to the clipboard.",
    context,
  ).fn;
  render();
  assert.equal(target.writes, 1, "renderCrashBanner must paint its initial language");
  const english = target.innerHTML;
  context.LANG = "de";
  render();
  assert.equal(target.writes, 2, "renderCrashBanner must repaint when only LANG changes");
  assert.notEqual(target.innerHTML, english, "renderCrashBanner must replace old-language actions");
}

{
  const target = element();
  const context = {
    LANG: "en",
    S: {
      inspHistSig: "",
      hist: new Map([["row", { gen: 1 }]]),
      histPin: new Map(),
    },
    $: () => target,
    histIdFor: () => "row",
    hasHist: () => true,
    ensureHist: () => {},
    histHtml: () => `${context.LANG}:chart`,
    displayReadingLabel: String,
    DERIVED: {},
    tx: String,
    inspTitleText: () => "title",
  };
  const render = productionFunction(
    "renderInspectHist",
    "function renderInspect()",
    context,
  ).fn;
  render(null, { label: "row", unit: "°C" });
  assert.equal(target.writes, 1, "renderInspectHist must paint its initial language");
  context.LANG = "de";
  render(null, { label: "row", unit: "°C" });
  assert.equal(target.writes, 2, "renderInspectHist must repaint when only LANG changes");
  assert.equal(target.innerHTML, "de:chart");
}

{
  const context = {
    LANG: "en",
    S: { insp: "same", live: null },
    inspRow: () => null,
    inspVal: () => "",
    pickRow: () => null,
    inspTitleText: () => "same",
    inspNowText: () => "",
    inspHeld: () => false,
    // The second source. Null is the shape a device with no HomeHub sees, which is the right
    // baseline here: this asserts that LANG ALONE still moves the signature, so every other input
    // has to be held constant — including the one that now feeds the panel's comparison block.
    mbTwin: () => null,
    mbForInspect: () => null,
  };
  const signature = productionFunction(
    "inspectSig",
    "// The trend under the inspector:",
    context,
  ).fn;
  const english = signature({});
  context.LANG = "de";
  assert.notEqual(signature({}), english, "inspectSig must change when only LANG changes");
}

console.log("live UI language switching: all persistent surfaces repaint");
