// Regression test for live UI-language changes. Runs the real production render functions from
// the assembled production UI in a tiny DOM-free VM harness: a persistent surface must repaint when LANG changes
// even though every device/status value in its ordinary render signature remains identical.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

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

// The Settings title is route-owned rather than data-i18n markup. A live language pick used to
// repaint every card while leaving this one header in the previous language until the user went
// Back and opened Settings again. Exercise the real language activation + route header together so
// a source-only assertion cannot pass while the interaction stays broken.
{
  const elements = {
    hdrDash: { hidden: false },
    hdrBack: { hidden: true },
    btnBack: {
      ariaLabel: "",
      setAttribute(name, value) { if (name === "aria-label") this.ariaLabel = value; },
    },
    verLink: {
      ariaLabel: "",
      setAttribute(name, value) { if (name === "aria-label") this.ariaLabel = value; },
    },
    backTitle: { textContent: "" },
  };
  const schematicAria = ["schem.card_aria", "schem.group_aria"].map((key) => ({
    dataset: { i18nAria: key },
    ariaLabel: "",
    setAttribute(name, value) { if (name === "aria-label") this.ariaLabel = value; },
  }));
  const context = {
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      documentElement: {},
      getElementById: (id) => elements[id],
      querySelectorAll: (selector) => selector === "[data-i18n-aria]" ? schematicAria : [],
    },
    labelSchematicHits: () => {},
  };
  const source = readAppFragments(["i18n.js"]) + readUiLocale("de") + appStateSource;
  const { api } = productionApi(source, ["S", "activateLang", "applyStaticI18n", "renderHeader"], context);
  api.S.stage = "settings";
  api.applyStaticI18n();
  api.renderHeader();
  assert.equal(elements.backTitle.textContent, "Settings");
  assert.equal(elements.btnBack.ariaLabel, "Back");
  assert.equal(elements.verLink.ariaLabel, "Check for firmware updates");
  assert.match(schematicAria[0].ariaLabel, /^Live system schematic:/,
    "the schematic card must receive its English accessible name from the catalog");
  assert.match(schematicAria[1].ariaLabel, /tap a value or component/,
    "the schematic group must receive its English interaction hint from the catalog");
  assert.equal(api.activateLang("de"), true);
  assert.equal(elements.backTitle.textContent, "Einstellungen",
    "a live language switch must repaint the active route title without a navigation round-trip");
  assert.equal(elements.btnBack.ariaLabel, "Zurück",
    "a live language switch must repaint the active Back control's accessible name");
  assert.equal(elements.verLink.ariaLabel, "Nach Firmware-Updates suchen",
    "a live language switch must repaint the persistent update control's accessible name");
  assert.match(schematicAria[0].ariaLabel, /^Live-Anlagenschema:/,
    "a live language switch must repaint the schematic card's accessible name");
  assert.match(schematicAria[1].ariaLabel, /Wert oder Bauteil/,
    "a live language switch must repaint the schematic group's accessible interaction hint");
}

{
  const { api } = productionApi(
    appStateSource,
    ["plantState", "modbusStatusView", "PLANT_COOL_RESIDUAL", "PLANT_RUNNING"],
    {
      compressorRunning: (d) => d?.rps != null ? d.rps > 0 : d?.compressorOn === true,
      t: (key) => key,
    },
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

  const idleModbus = api.modbusStatusView("mode.dhw", {
    rps: null, compressorOn: false, pumpOn: false, flow: 0, bsh: false,
  });
  assert.equal(idleModbus.mode, "mode.dhw", "the HomeHub DHW flag remains the mode headline");
  assert.equal(idleModbus.status, "sys.standby · sys.mb_source",
    "Modbus-only DHW with every activity witness off must say that the plant is not running");
  assert.equal(idleModbus.tone, "idle",
    "Modbus-only DHW standby must mute the dot instead of treating a known mode as active");

  const runningModbus = api.modbusStatusView("mode.dhw", {
    rps: null, compressorOn: true, pumpOn: true, flow: 14, bsh: false,
  });
  assert.equal(runningModbus.status, "sys.operating · sys.mb_source");
  assert.equal(runningModbus.tone, "", "a running HomeHub compressor keeps the active green tone");

  const unknownMode = api.modbusStatusView(null, {
    rps: null, compressorOn: false, pumpOn: false, flow: 0, bsh: false,
  });
  assert.equal(unknownMode.mode, "sys.x10a_down");
  assert.equal(unknownMode.status, "sys.mb_carrying");
  assert.equal(unknownMode.tone, "warn", "an unknown Modbus mode keeps the existing warning state");
}

// A tone that can be RETURNED must be DRAWABLE. The block above pinned that "warn" is produced, and
// nothing pinned that anything could paint it: TONE_FILL had no "warn" key, so sysSet handed the
// status dot the string "undefined" — not a valid SVG paint — and it fell back to black, in exactly
// the two HomeHub states that exist to draw attention. Asserted over EVERY tone the two producers
// can return, so a future tone added to one side and forgotten on the other fails here.
{
  const { api } = productionApi(
    appStateSource,
    ["plantState", "modbusStatusView", "TONE_FILL"],
    { compressorRunning: (d) => d?.rps != null ? d.rps > 0 : d?.compressorOn === true,
      t: (key) => key },
  );
  const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
  const produced = new Set();
  for (const d of [{ rps: 0, pumpOn: false, flow: 0 },
                   { rps: 42, pumpOn: true, flow: 19, thermalMode: "heat", pthRaw: 7 },
                   { rps: 0, pumpOn: true, flow: 19, thermalMode: "cool", pthRaw: 0.4 }])
    produced.add(api.plantState(d).tone);
  for (const [mode, d] of [[null, { rps: null, compressorOn: false, pumpOn: false, flow: 0 }],
                           ["mode.dhw", { rps: null, compressorOn: true, pumpOn: true, flow: 14 }]])
    produced.add(api.modbusStatusView(mode, d).tone);
  assert.ok(produced.has("warn"), "the fixture set must actually reach the warn tone");
  for (const tone of produced) {
    const fill = api.TONE_FILL[tone || ""];
    assert.ok(typeof fill === "string" && fill.startsWith("var(--"),
      `tone "${tone}" must map to a real paint, not ${String(fill)}`);
    // "" is the default class-less state; every named tone also needs its own text rule.
    if (tone) assert.match(style, new RegExp(`svg \\.sc-status\\.${tone}\\s*\\{`),
      `tone "${tone}" must have a .sc-status rule so the line is coloured too`);
  }
}

assertPersistentBannerRepaints(
  "renderRecoveryBanner",
  { sys: { safe_mode: true } },
);

// The SAME banner is reached from two causes that need OPPOSITE advice (#407): a crash loop points
// at the configuration — the RX/TX pins first — while the heap watchdog giving up means the
// configuration is almost certainly fine and a newer build is the fix. Naming the pins there sends
// the reader to correct something that is already correct, which is the failure the absence rules
// call out by name.
//
// Two halves, because they are two different claims and this harness can only see one of them: the
// RENDERER picks a key (asserted here, where `t` is a stub that echoes its key), and the DICTIONARY
// decides what that key says (asserted against the real i18n.js below).
{
  const paintKey = (cause) => {
    const status = { sys: { safe_mode: true, safe_mode_cause: cause } };
    const target = element();
    const context = languageContext(status, target);
    const { api } = productionApi(appStateSource, ["S", "renderRecoveryBanner"], context);
    api.S.status = status;
    api.renderRecoveryBanner();
    return target.innerHTML;
  };
  assert.match(paintKey("heap"), /recovery\.meta_heap/,
    "a heap give-up must render its OWN sentence, not the crash-loop one");
  assert.doesNotMatch(paintKey("crash_loop"), /recovery\.meta_heap/,
    "a crash loop must keep the configuration advice");
  // An older firmware sends no cause at all, and an unknown one may arrive from a newer device than
  // this bundle. Both must fall back to the crash-loop wording — the only thing either can honestly
  // say — and never to the heap text, which asserts a cause nobody established.
  assert.equal(paintKey(undefined), paintKey("crash_loop"),
    "an absent cause must render exactly the crash-loop banner");
  assert.equal(paintKey("something_newer"), paintKey("crash_loop"),
    "an unknown cause must fall back to the crash-loop banner");
}

// The dictionary half: both languages carry the new key, and the advice actually differs in the way
// that matters. A half-translated pair is exactly how one language silently keeps the wrong advice.
{
  const i18n = readAppFragments(["i18n.js"]) + readUiLocale("de");
  // i18n.js is a page fragment, so it reaches for browser globals at load time (navigator.language
  // for the auto-detect, localStorage for the stored override). Stub only what loading needs — the
  // dictionaries themselves are plain data and the point of reading the REAL file is that no second
  // copy of the copy can drift.
  const ctx = vm.createContext({
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, documentElement: {} },
  });
  vm.runInContext(`${i18n}; globalThis.__I18N = I18N;`, ctx, { filename: "main/www/js/i18n.js" });
  for (const lang of ["en", "de"]) {
    const dict = ctx.__I18N[lang];
    assert.ok(dict["recovery.meta_heap"],
      `[${lang}] the heap recovery banner has no copy — the row would render its raw key`);
    assert.match(dict["recovery.meta"], /RX\/TX/,
      `[${lang}] the crash-loop banner must still name the pins as the first thing to check`);
    assert.doesNotMatch(dict["recovery.meta_heap"], /RX\/TX/,
      `[${lang}] the heap banner must not send the reader to the pins — they are not the cause`);
  }
}


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

// Derived inspector charts used to bypass INSPECT_I18N and expose their English aria name even
// though the visible inspector title/body were native. Exercise the real chart-name path.
{
  const target = element();
  const context = {
    LANG: "es",
    INSPECT_I18N: { es: { pth: { aria: "Potencia térmica estimada" } } },
    S: { inspHistSig: "", hist: new Map([["pth", { gen: 1 }]]), histPin: new Map() },
    $: () => target,
    MB_PAIRS: [],
    histIdFor: () => "pth",
    hasHist: () => true,
    hasModbusHist: () => false,
    ensureHistPair: () => {},
    histCacheKey: (id) => id,
    histHtml: (_id, _unit, name) => name,
    displayUnit: () => "kW",
    displayReadingLabel: String,
    DERIVED: { pth: { unit: "kW" } },
  };
  const render = productionApi(schematicSource, ["renderInspectHist"], context).api.renderInspectHist;
  render({ i18nKey: "pth", aria: { en: "Thermal capacity at the PHE (estimated)",
                                   de: "Thermische Leistung am PHE (Schätzung)" } },
         { label: "Thermal capacity", unit: "kW" });
  assert.equal(target.innerHTML, "Potencia térmica estimada",
    "a derived chart must use the lazy locale's accessible name");
}

{
  const context = {
    LANG: "en",
    INSPECT_I18N: Object.create(null),
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
