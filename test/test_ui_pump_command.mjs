// Execute the shipped live reader, derived history rule and localized inspector together.
// Commands, reported activity and measured flow are independent observations.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const locales = ["de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"];
const production = readAppFragments(["i18n.js"]) + locales.map(readUiLocale).join("\n") +
  readAppFragments(["descriptions.js", "history.js", "schematic.js"]);
function harness(source = production) {
  const S = { status: { hp: { connected: true }, modbus: { enabled: false, connected: false } },
    _values: [], _modbus: [] };
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { textContent: "", setAttribute() {}, closest: () => null, querySelectorAll: () => [],
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c),
          toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } } });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({ S, $: node, navigator: { language: "en" },
    localStorage: { getItem: () => "en" }, document: { getElementById: node, documentElement: { lang: "en" } },
    esc: (s) => String(s ?? ""), displayUnit: (r) => r?.unit || "", displayValue: (r) => r?.value,
    displayReadingLabel: (s) => s, displayHomeHubLabel: (r) => r?.label || "" });
  vm.runInContext(source + "\nthis.api = { liveData, DERIVED, INSPECT, inspFieldText, renderLive, descFor, descriptionCopy, descBodyHtml, setLang: (lang) => LANG = lang };", context);
  // The production render path still executes; the unrelated sensor pill and open inspector have
  // their own lifecycle suites and need no DOM in this pump-specific class/pipe witness.
  vm.runInContext("renderEnv3Pill = () => {}; renderInspect = () => {};", context);
  return { S, node, context, ...context.api };
}
const row = (label, value) => ({ label, value, reg: 0x62, unit: "" });
function live(h, signal, state, flow) {
  h.S._values = [row("Water pump signal (0:max-100:stop)", signal),
    { ...row("Water pump operation", state), binary: true }, row("Flow sensor (l/min)", flow)];
  return h.liveData();
}
function commandContract(h) {
  for (const [signal, expected] of [[0, 100], [25.5, 74.5], [100, 0], [-1, null], [101, null],
    [255, null], [NaN, null], [Infinity, null], [-Infinity, null], [null, null], [undefined, null]]) {
    assert.equal(live(h, signal, null, 0).pump, expected, `live command signal ${signal}`);
    assert.equal(h.DERIVED.pump_speed.fn({ pump_signal: signal }), expected,
      `history command signal ${signal}`);
  }
  for (const invalid of [null, undefined, false, true, "", "25.5", "invalid"])
    assert.equal(h.DERIVED.pump_speed.fn({ pump_signal: invalid }), null,
      `decoded history input ${JSON.stringify(invalid)} is not a numeric command`);
  // /values serializes X10A decimals as strings; its existing row reader decodes them before the
  // shared numeric rule. Missing/boolean/empty/unparseable values must never become zero.
  assert.equal(live(h, "25.5", null, 0).pump, 74.5);
  for (const invalid of [false, true, "", "invalid"])
    assert.equal(live(h, invalid, null, 0).pump, null);
  const unsupported = live(h, 255, null, 0);
  assert.equal(unsupported.pumpSig, 255, "retain the raw decoded telemetry value");
}
function stateContract(h) {
  const unknown = live(h, 100, null, 0);
  assert.equal(unknown.pumpOn, null);
  assert.doesNotMatch(h.INSPECT.pump.now(unknown).en, /reports stopped|status is OFF/,
    "STOP command without a reported state must not become reported OFF");
  assert.match(h.INSPECT.pump.now(unknown).en, /unknown/i);
  assert.match(h.INSPECT.pump.now(live(h, 25.5, 1, 0)).en, /not established|not confirmed/,
    "a positive command and ON report cannot prove flow");
  assert.match(h.INSPECT.pump.now(live(h, 100, 0, 12)).en, /stopped[\s\S]*12/,
    "reported OFF and positive measured flow remain a conflict");
}
function motionContract(h) {
  for (const [signal, state, flow, rotor, pipe] of [[100, null, 0, false, false],
    [100, null, 12, false, true], [100, 0, 12, false, true], [0, null, 0, false, false],
    [100, 1, 0, true, false], [25.5, 1, 12, true, true]]) {
    h.S.live = live(h, signal, state, flow);
    h.renderLive();
    assert.equal(h.node("schem").classList.contains("pump-on"), rotor,
      `reported state ${state}, not command ${signal} or flow ${flow}, controls the rotor`);
    assert.equal(h.node("fPhe").classList.contains("on"), pipe,
      `measured flow ${flow} controls the water trace independently`);
  }
}
function gatewayStateContract(h) {
  h.S.status.modbus = { enabled: true, connected: true };
  h.S._modbus = [{ off: 30, value: 1, binary: true }];
  const withoutNativeReport = live(h, 100, null, 12);
  assert.equal(withoutNativeReport.pumpOn, null, "a cached gateway report cannot establish live operation");
  h.S.live = withoutNativeReport;
  h.renderLive();
  assert.equal(h.node("schem").classList.contains("pump-on"), false);
  assert.equal(h.node("fPhe").classList.contains("on"), true);
  assert.equal(h.S._modbus[0].value, 1, "the gateway's raw sample remains available");
  assert.equal(live(h, 100, 0, 12).pumpOn, false, "the current native OFF report wins");
  h.S._values[1].held = true;
  assert.equal(h.liveData().pumpOn, null, "a held native report cannot establish live operation");
}
function rawDescriptionContract(h, lang = "en") {
  h.setLang(lang);
  const raw = h.descFor("Water pump signal (0:max-100:stop)", { reg: 0x62, conv: 152 });
  assert.ok(raw, `${lang}: the raw telemetry row needs its own explainer`);
  assert.notEqual(raw, h.descFor("Water pump operation", { reg: 0x60 }),
    "the raw command and reported operation are separate descriptions");
  const html = h.descBodyHtml(raw, 100, h.descriptionCopy(raw));
  assert.match(html, /0[\s\S]*100/, `${lang}: preserve the raw inverted endpoints`);
  assert.match(html, /RPM/, `${lang}: explain the limit of the command as a speed measurement`);
  assert.equal((html.match(/class="vdesc-p"/g) || []).length, 1,
    `${lang}: no universal fast-pump or stopped-at-idle normal rule`);
  if (lang === "en") {
    assert.match(html, /raw 0 requests maximum effort and raw 100 requests stop/);
    assert.match(html, /does not measure RPM or prove rotation or water flow/);
    assert.match(html, /reported ON\/OFF and measured flow separately/);
  }
}
function inspectorCopyContract(h) {
  assert.match(h.INSPECT.pump.what.en, /displayed command is 100 − raw X10A/);
  assert.match(h.INSPECT.pump.what.en, /0 % requests stop and 100 % maximum effort/);
  assert.match(h.INSPECT.pump.what.de, /angezeigte Ansteuerung ist 100 − X10A-Rohwert/);
  assert.match(h.INSPECT.pump.what.de, /0 % fordert Stopp und 100 % Maximum/);
}
const h = harness();
inspectorCopyContract(h);
stateContract(h);
commandContract(h);
motionContract(h);
gatewayStateContract(h);
assert.equal(h.INSPECT.pump.trend, "pump_speed", "retain the existing history key");
assert.match(h.INSPECT.pump.aria.en, /command/i);
assert.doesNotMatch(h.INSPECT.pump.what.en, /adjusts its speed|target ΔT/);
const unknownWords = { en: /unknown/, de: /unbekannt/, es: /desconocido/, fr: /inconnu/,
  it: /sconosciuto/, pl: /nieznany/, cs: /neznámý/, uk: /невідомий/, zh: /未知/, ja: /不明/,
  nb: /ukjent/, sv: /okänd/, fi: /tuntematon/ };
for (const lang of ["en", ...locales]) {
  h.setLang(lang);
  rawDescriptionContract(h, lang);
  for (const [signal, state, flow] of [[100, null, 0], [25.5, 1, 0], [100, 0, 12], [0, 1, 12],
    [null, null, null], [null, null, 12], [101, 1, null]]) {
    const d = live(h, signal, state, flow);
    const text = h.inspFieldText(h.INSPECT.pump, "now", d);
    if (signal != null || state != null || flow != null) assert.ok(text?.length, `${lang} pump evidence`);
    else assert.equal(text, null);
    assert.doesNotMatch(text || "", /undefined|NaN|null/, `${lang} must format missing evidence honestly`);
  }
  assert.ok(h.inspFieldText(h.INSPECT.pump, "aria").length, `${lang} accessible command name`);
  assert.ok(h.inspFieldText(h.INSPECT.pump, "what").length, `${lang} command limitation`);
  assert.match(h.inspFieldText(h.INSPECT.pump, "now", live(h, 100, null, 0)), unknownWords[lang],
    `${lang} must keep unknown reported activity at the STOP command`);
}

// Executable negative controls restore each former production defect. A semantic assertion, not
// a setup error, must reject the mutated live/history rule and the false stopped-state inference.
const unclamped = production.replace("pumpCommandPercent(d.pumpSig)",
  "d.pumpSig == null ? null : Math.min(100, Math.max(0, 100 - d.pumpSig))");
assert.notEqual(unclamped, production, "live mutation must reach the production rule");
assert.throws(() => commandContract(harness(unclamped)), { code: "ERR_ASSERTION" });
const historyClamp = production.replace("fn: (s) => pumpCommandPercent(s.pump_signal)",
  "fn: (s) => s.pump_signal == null ? null : Math.min(100, Math.max(0, 100 - s.pump_signal))");
assert.notEqual(historyClamp, production, "history mutation must reach the production rule");
assert.throws(() => commandContract(harness(historyClamp)), { code: "ERR_ASSERTION" });
const falseOff = production.replace("d.pumpOn === false ? words[2]", "(d.pumpOn === false || d.pump === 0) ? words[2]");
assert.notEqual(falseOff, production, "state mutation must reach the production rule");
assert.throws(() => stateContract(harness(falseOff)), { code: "ERR_ASSERTION" });
const falseRotation = production.replace('sc.classList.toggle("pump-on", active && d.pumpOn === true)',
  'sc.classList.toggle("pump-on", active && pumping === true)');
assert.notEqual(falseRotation, production, "rotor mutation must reach the production class update");
assert.throws(() => motionContract(harness(falseRotation)), { code: "ERR_ASSERTION" });
const staleGatewayRotor = production.replace("pumpOn: binaryValue(pumpX10a()),",
  "pumpOn: binaryValue(pumpX10a()) ?? mbBool(30),");
assert.notEqual(staleGatewayRotor, production, "gateway mutation must reach the live operation rule");
assert.throws(() => gatewayStateContract(harness(staleGatewayRotor)), { code: "ERR_ASSERTION" });
for (const [clarified, ambiguous] of [
  ["The displayed command is 100 − raw X10A", "X10A commands"],
  ["Die angezeigte Ansteuerung ist 100 − X10A-Rohwert", "X10A fordert"],
]) {
  const missingDisplayInversion = production.replace(clarified, ambiguous);
  assert.notEqual(missingDisplayInversion, production);
  assert.throws(() => inspectorCopyContract(harness(missingDisplayInversion)), { code: "ERR_ASSERTION" });
}
const falseRawState = production.replace("raw 0 requests maximum effort and raw 100 requests stop",
  "0 means full speed and 100 means stopped");
assert.notEqual(falseRawState, production, "raw-description mutation must reach the shipped explainer");
assert.throws(() => rawDescriptionContract(harness(falseRawState)), { code: "ERR_ASSERTION" });
console.log("pump command: production live/history, independent state/flow, raw explainer and 13 locales passed");
