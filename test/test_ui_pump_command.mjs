// Host contract for pump command [0, 100] validation, rotor vs water-flow independence, and
// honest pump copy across all 13 shipped UI locales (including executable negative controls).
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const LOCALES = ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"];
const SOURCE = readAppFragments([
  "i18n.js", "app_state.js", "descriptions.js", "history.js", "schematic.js",
]);
const LOCALE_SOURCES = Object.fromEntries(LOCALES.slice(1).map((code) => [code, readUiLocale(code)]));

function harness(lang = "en", mutate = null) {
  let code = SOURCE + (LOCALE_SOURCES[lang] ? "\n" + LOCALE_SOURCES[lang] : "");
  if (mutate) code = mutate(code);

  const nodes = new Map();
  const el = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        textContent: "",
        innerHTML: "",
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        removeAttribute(k) { delete this.attributes[k]; },
        closest: () => null,
        querySelectorAll: () => [],
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c),
          toggle: (c, on) => {
            if (on === undefined) {
              if (classes.has(c)) classes.delete(c); else classes.add(c);
            } else if (on) {
              classes.add(c);
            } else {
              classes.delete(c);
            }
          },
        },
      });
    }
    return nodes.get(id);
  };

  const ctx = {
    document: { getElementById: el, querySelectorAll: () => [] },
    window: {},
    navigator: { language: lang },
    localStorage: { getItem: () => lang, setItem: () => {} },
    fetch: () => { throw new Error("unexpected network fetch in test_ui_pump_command"); },
  };
  vm.createContext(ctx);
  vm.runInContext(
    code + "\n" +
    "S.status = { hp: { connected: true }, modbus: { enabled: false, connected: false }, " +
    "history: { rows: [], modbus_rows: [], env3_rows: [] } }; " +
    "S._values = []; S._modbus = []; S.insp = null; " +
    "renderEnv3Pill = () => {}; renderSourcePills = () => {}; layoutHeaderPills = () => {}; renderInspect = () => {}; " +
    "this.__api = { S, I18N, INSPECT, INSPECT_I18N, DESCRIPTIONS, DESCRIPTION_I18N, DERIVED, " +
    "pumpCommandPercent, waterMoving, pumpFlowConflict, pumpNowText, liveData, renderLive, " +
    "descFor, inspFieldText, setLang: (l) => { LANG = l; } };",
    ctx,
    { filename: `main/www/app.sources(${lang})` },
  );
  ctx.__api.setLang(lang);
  return { api: ctx.__api, nodes, el };
}

function assertValidPumpCommand(api) {
  assert.equal(api.pumpCommandPercent(0), 100);
  assert.equal(api.pumpCommandPercent(100), 0);
  assert.equal(api.pumpCommandPercent(25.5), 74.5);
  assert.equal(api.DERIVED.pump_speed.fn({ pump_signal: 25.5 }), 74.5);
  for (const invalid of [-1, -0.1, 100.1, 101, 255, Infinity, -Infinity, NaN, "50", null, undefined]) {
    assert.equal(api.pumpCommandPercent(invalid), null, `invalid signal ${String(invalid)} must return null`);
    assert.equal(api.DERIVED.pump_speed.fn({ pump_signal: invalid }), null,
      `DERIVED.pump_speed must reject ${String(invalid)}`);
  }
}

function assertRotorAndFlowIndependence(api, nodes) {
  // 1. Reported pump ON without X10A/Modbus flow: rotor spins, water flow stays inactive.
  api.S.status = { hp: { connected: false }, modbus: { enabled: true, connected: true },
    history: { rows: [], modbus_rows: [], env3_rows: [] } };
  api.S._values = [];
  api.S._modbus = [{ off: 30, label: "Circulation pump running", value: "1", unit: "", binary: true, concept: "pump_running" }];
  api.S.live = api.liveData();
  api.renderLive();
  assert.equal(api.S.live.pumpOn, true);
  assert.equal(api.waterMoving(api.S.live), null);
  assert.equal(nodes.get("schem").classList.contains("pump-on"), true, "reported pump ON rotates #scPump");
  assert.equal(nodes.get("fPhe").classList.contains("on"), false, "no water pipe animation without qualified flow");
  assert.equal(nodes.get("fSup1").classList.contains("on"), false);

  // 2. Qualified flow while internal pump reports OFF: water moves, rotor stops, conflict detected.
  api.S.status = { hp: { connected: true }, modbus: { enabled: false, connected: false },
    history: { rows: [], modbus_rows: [], env3_rows: [] } };
  api.S._modbus = [];
  api.S._values = [
    { label: "Water pump operation", value: "0", unit: "", reg: 0x60, binary: true, concept: "pump_running" },
    { label: "Flow sensor (l/min)", value: "14.2", unit: "l/min", reg: 0x61, concept: "flow" },
    { label: "Water pump signal", value: "25.5", unit: "%", reg: 0x61 },
  ];
  api.S.live = api.liveData();
  api.renderLive();
  assert.equal(api.S.live.pump, 74.5, "liveData preserves fractional command precision");
  assert.equal(nodes.get("svPump").textContent, "75", "schematic badge displays rounded percentage");
  assert.equal(api.waterMoving(api.S.live), true);
  assert.equal(api.pumpFlowConflict(api.S.live), true);
  assert.equal(nodes.get("schem").classList.contains("pump-on"), false,
    "measured flow alone cannot spin #scPump when pump reports OFF");
  assert.equal(nodes.get("fPhe").classList.contains("on"), true);
  assert.equal(nodes.get("fSup1").classList.contains("on"), true);

  // 3. Stop command (raw 100 -> 0%) with unknown pump ON/OFF and no flow never claims stopped.
  api.S._values = [{ label: "Water pump signal", value: "100", unit: "%", reg: 0x61 }];
  api.S.live = api.liveData();
  api.renderLive();
  assert.equal(api.S.live.pump, 0);
  assert.equal(api.S.live.pumpOn, null);
  assert.equal(nodes.get("schem").classList.contains("pump-on"), false);
  const stopUnknownText = api.inspFieldText({ ...api.INSPECT.pump, i18nKey: "pump" }, "now", api.S.live);
  assert.ok(stopUnknownText && !/\bstopped\b/i.test(stopUnknownText),
    `STOP command with unknown pumpOn must not claim stopped: ${stopUnknownText}`);

  // 4. Out-of-range raw signal stays null instead of clamping to 0% or 100%.
  for (const bad of ["255", "-5", "105"]) {
    api.S._values = [{ label: "Water pump signal", value: bad, unit: "%", reg: 0x61 }];
    api.S.live = api.liveData();
    api.renderLive();
    assert.equal(api.S.live.pump, null, `raw signal ${bad} stays null`);
    assert.equal(nodes.get("svPump").textContent, "—", `raw signal ${bad} blanks badge`);
  }
}

const { api: enApi, nodes: enNodes } = harness("en");
assertValidPumpCommand(enApi);
assertRotorAndFlowIndependence(enApi, enNodes);

for (const lang of LOCALES) {
  const { api } = harness(lang);
  assert.ok(api.I18N[lang]["mb.flow_scale_help"]?.trim(), `${lang}: missing mb.flow_scale_help`);
  assert.ok(api.I18N[lang]["hist.modbus_flow_unverified"]?.trim(), `${lang}: missing hist.modbus_flow_unverified`);

  const pumpIdx = api.DESCRIPTIONS.findIndex((d) => d.re.test("Water pump signal"));
  assert.equal(pumpIdx, 38, "water pump signal description index matches DESCRIPTION_I18N contract");
  const signalDesc = api.descFor("Water pump signal", { label: "Water pump signal", reg: 0x61 });
  const what = lang === "en"
    ? signalDesc?.what
    : lang === "de"
      ? signalDesc?.de?.what
      : api.DESCRIPTION_I18N[lang][pumpIdx]?.[0];
  assert.ok(what && what.includes("0") && what.includes("100"), `${lang}: pump signal explainer states 0 and 100 bounds`);
  if (lang === "en") assert.equal(signalDesc.normal, undefined, "en: universal normal: advice removed");
  if (lang === "de") assert.equal(signalDesc.de?.normal, undefined, "de: universal normal: advice removed");
  if (lang !== "en" && lang !== "de") {
    assert.equal(api.DESCRIPTION_I18N[lang][pumpIdx]?.length, 1, `${lang}: universal normal: advice removed`);
  }

  const entry = { ...api.INSPECT.pump, i18nKey: "pump" };
  const inspWhat = api.inspFieldText(entry, "what", null);
  assert.ok(inspWhat && inspWhat.includes("0") && inspWhat.includes("100"), `${lang}: INSPECT.pump.what names 0 and 100`);

  const stoppedOff = api.inspFieldText(entry, "now", { pump: 0, pumpOn: false, flow: null });
  const stopUnknown = api.inspFieldText(entry, "now", { pump: 0, pumpOn: null, flow: null });
  const conflict = api.inspFieldText(entry, "now", { pump: 0, pumpOn: false, flow: 12.4 });
  const onNoFlow = api.inspFieldText(entry, "now", { pump: 60, pumpOn: true, flow: null });
  const onFlow = api.inspFieldText(entry, "now", { pump: 60, pumpOn: true, flow: 12.4 });
  for (const [label, text] of Object.entries({ stoppedOff, stopUnknown, conflict, onNoFlow, onFlow })) {
    assert.ok(text && text.length > 10, `${lang}: missing INSPECT.pump.now for ${label}`);
  }
  assert.notEqual(stopUnknown, stoppedOff, `${lang}: 0% command with unknown ON/OFF must differ from reported stopped`);
  assert.ok(stopUnknown.includes("0"), `${lang}: 0% command with unknown ON/OFF states 0% command`);
}

// Executable negative controls: verify our assertions catch the exact bugs being prevented.
const negativeControls = [
  {
    name: "clamp-out-of-range-pump-signal",
    mutate: (s) => {
      const anchor = "return typeof signal === \"number\" && Number.isFinite(signal) && signal >= 0 && signal <= 100\n    ? 100 - signal : null;";
      assert.equal(s.split(anchor).length, 2, "unique pumpCommandPercent anchor");
      return s.replace(anchor, "return typeof signal === \"number\" && Number.isFinite(signal) ? Math.max(0, Math.min(100, 100 - signal)) : null;");
    },
    check: ({ api }) => assertValidPumpCommand(api),
  },
  {
    name: "tie-rotor-to-water-flow",
    mutate: (s) => {
      const anchor = "sc.classList.toggle(\"pump-on\", d.pumpOn === true);";
      assert.equal(s.split(anchor).length, 2, "unique #scPump toggle anchor");
      return s.replace(anchor, "sc.classList.toggle(\"pump-on\", pumping === true);");
    },
    check: ({ api, nodes }) => assertRotorAndFlowIndependence(api, nodes),
  },
  {
    name: "stop-unknown-claims-stopped",
    mutate: (s) => {
      const anchor = "parts.push(d.pumpOn === true ? words[1] : d.pumpOn === false ? words[2] : words[3]);";
      assert.equal(s.split(anchor).length, 2, "unique stop-unknown fallback anchor");
      return s.replace(anchor, "parts.push(d.pumpOn === true ? words[1] : (d.pumpOn === false || d.pump === 0) ? words[2] : words[3]);");
    },
    check: ({ api, nodes }) => assertRotorAndFlowIndependence(api, nodes),
  },
];

for (const control of negativeControls) {
  const mutated = harness("en", control.mutate);
  assert.throws(() => control.check(mutated),
    `negative control ${control.name} must be rejected`);
}

console.log(`pump command validation, rotor/flow independence and 13-locale copy passed (${negativeControls.length} negative controls verified)`);
