// Regression test for live UI-language changes. Runs the real production render functions from
// the assembled production UI in a tiny DOM-free VM harness: a persistent surface must repaint when LANG changes
// even though every device/status value in its ordinary render signature remains identical.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const appStateSource = readAppFragments(["app_state.js"]);
const schematicSource = readAppFragments(["schematic.js"]);

function productionApi(source, exports, context) {
  const sandbox = vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.__productionApi = { ${exports.join(", ")} };`,
    sandbox,
    { filename: "main/www/app.sources" },
  );
  return { sandbox, api: sandbox.__productionApi };
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
    $: () => target,
    esc: String,
  };
  context.t = (key) => `${context.LANG}:${key}`;
  return context;
}

function assertPersistentBannerRepaints(name, status) {
  const target = element();
  const context = languageContext(status, target);
  const { api } = productionApi(appStateSource, ["S", name], context);
  api.S.status = status;
  const render = api[name];
  render();
  assert.equal(target.writes, 1, `${name} must paint its initial language`);
  const english = target.innerHTML;
  context.LANG = "de";
  render();
  assert.equal(target.writes, 2, `${name} must repaint when only LANG changes`);
  assert.notEqual(target.innerHTML, english, `${name} must replace the old-language copy`);
}

{
  const { api } = productionApi(
    appStateSource,
    ["plantState", "PLANT_COOL_RESIDUAL", "PLANT_RUNNING"],
    { compressorRunning: (d) => d?.rps != null ? d.rps > 0 : d?.compressorOn === true },
  );
  const residual = api.plantState({
    rps: 0, pumpOn: true, flow: 19.1, thermalMode: "cool", pthRaw: 0.4,
  });
  assert.equal(residual.key, "sys.residual_circulating",
    "hot pump-only circulation in Cooling must be named as residual heat, not active cooling");
  assert.equal(residual.tone, "idle", "residual circulation must not receive the running-green tone");
  assert.equal(api.plantState({ rps: 42, pumpOn: true, thermalMode: "cool", pthRaw: -4 }).key,
    "sys.operating", "a running compressor remains active plant operation");
  assert.equal(api.plantState({ rps: null, compressorOn: true, pumpOn: true,
                                thermalMode: "heat", pthRaw: 7.8 }).key,
    "sys.operating", "the HomeHub compressor witness keeps Modbus-only DHW in active operation");
}

assertPersistentBannerRepaints(
  "renderRecoveryBanner",
  { sys: { safe_mode: true } },
);

assertPersistentBannerRepaints(
  "renderRollbackBanner",
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
  const { api } = productionApi(appStateSource, ["S", "renderCrashBanner"], context);
  api.S.status = status;
  api.S.crashAsk = "";
  api.S.crashDismissed = "";
  const render = api.renderCrashBanner;
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
    MB_PAIRS: [],
    histIdFor: () => "row",
    hasHist: () => true,
    hasModbusHist: () => false,
    ensureHistPair: () => {},
    histCacheKey: (id, source) => source === "modbus" ? `modbus:${id}` : id,
    histHtml: () => `${context.LANG}:chart`,
    displayUnit: (row) => row?.unit || "",
    displayReadingLabel: String,
    DERIVED: {},
  };
  const render = productionApi(schematicSource, ["renderInspectHist"], context).api.renderInspectHist;
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
    // The second source. Null is the shape a device with no HomeHub sees, which is the right
    // baseline here: this asserts that LANG ALONE still moves the signature, so every other input
    // has to be held constant — including the one that now feeds the panel's comparison block.
    mbTwin: () => null,
    mbForInspect: () => null,
  };
  const signature = productionApi(schematicSource, ["inspectSig"], context).api.inspectSig;
  const english = signature({});
  context.LANG = "de";
  assert.notEqual(signature({}), english, "inspectSig must change when only LANG changes");
}

console.log("live UI language switching: all persistent surfaces repaint");
