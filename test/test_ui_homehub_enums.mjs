// Execute the production HomeHub enum display boundary in a DOM-free VM. The EKRHH guide encodes
// modes, flags and numbers alike as Int16; public values must retain those raw numeric constants,
// while structural enum metadata keeps the visual UI readable and true flags remain 0/1 -> ON/OFF.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const appStateSource = readAppFragments(["app_state.js"]);
const schematicSource = readAppFragments(["schematic.js"]);

function renderer(lang) {
  const source = readAppFragments(["i18n.js"]) +
    (lang === "en" ? "" : readUiLocale(lang)) +
    readAppFragments(["history.js", "descriptions.js", "schematic.js"]);
  const context = {
    document: { getElementById: () => null },
    fetch: () => { throw new Error("unexpected fetch in enum test"); },
    localStorage: { getItem: () => lang, setItem: () => {} },
    navigator: { language: lang },
    S: { status: { hp: { connected: true }, modbus: { enabled: true, connected: true },
      history: { rows: [], modbus_rows: [], env3_rows: [] } },
      _values: [], _modbus: [], descOpen: new Set(), hist: new Map() },
  };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.__ui = { displayValue, displayUnit, displayReadingLabel, displayHomeHubLabel, descFor, mbNoteHtml, vDescRow, inspectSig, INSPECT, state: S, operationModeText, operationModeFromFlags, labels: I18N[LANG]," +
    " sgModeText: (mode) => t(`sg.mode${mode}`)," +
    " sgBoostText: () => t(\"schem.sg_boost\") };", context,
    { filename: "main/www/app.sources" });
  return context.__ui;
}

const en = renderer("en");
const de = renderer("de");

const modes = [
  ["operation_mode", 0, "Auto", "Auto"],
  ["operation_mode", 1, "Heating", "Heizen"],
  ["operation_mode", 2, "Cooling", "Kühlen"],
  ["current_operation_mode", 1, "Heating", "Heizen"],
  ["current_operation_mode", 2, "Cooling", "Kühlen"],
  ["unit_abnormality", 0, "No error", "Kein Fehler"],
  ["unit_abnormality", 1, "Fault", "Fehler"],
  ["unit_abnormality", 2, "Warning", "Warnung"],
  ["three_way_valve", 0, "Space heating", "Raumheizung"],
  ["three_way_valve", 1, "DHW", "Brauchwarmwasser"],
  ["smart_grid_mode", 0, "Free running", "Freier Betrieb"],
  ["smart_grid_mode", 1, "Forced off", "Zwangsabschaltung"],
  ["smart_grid_mode", 2, "Recommended on", "Empfehlung ein"],
  ["smart_grid_mode", 3, "Forced on", "Erzwungen ein"],
];

for (const [semantic, value, english, german] of modes) {
  const row = { value, enum: semantic };
  assert.equal(en.displayValue(row), english, `${semantic}=${value} English named state`);
  assert.equal(de.displayValue(row), german, `${semantic}=${value} German named state`);
}
const nativeModes = [
  ["altherma4_current_operation_mode", 0, "None", "Keine"],
  ["altherma4_current_operation_mode", 1, "Heating", "Heizen"],
  ["altherma4_current_operation_mode", 2, "Cooling", "Kühlen"],
  ["altherma4_demand_response", 0, "Free running", "Freier Betrieb"],
  ["altherma4_demand_response", 1, "Forced off", "Zwangsabschaltung"],
  ["altherma4_demand_response", 2, "Forced on", "Erzwungen ein"],
  ["altherma4_demand_response", 3, "Recommended on", "Empfehlung ein"],
  ["altherma4_demand_response", 4, "Reduced", "Reduziert"],
  ["altherma4_unit_operation_mode", 0, "Stop", "Stopp"],
  ["altherma4_unit_operation_mode", 1, "Tank heat-up", "Speicheraufheizung"],
  ["altherma4_unit_operation_mode", 2, "Space heating", "Raumheizung"],
  ["altherma4_unit_operation_mode", 3, "Space cooling", "Raumkühlung"],
  ["altherma4_unit_operation_mode", 4, "Actuator", "Stellantrieb"],
  ["altherma4_quiet_selection", 0, "OFF", "OFF"],
  ["altherma4_quiet_selection", 1, "Automatic", "Automatisch"],
  ["altherma4_quiet_selection", 2, "Manual", "Manuell"],
];
for (const [semantic, value, english, german] of nativeModes) {
  assert.equal(en.displayValue({value, enum: semantic}), english, `${semantic}=${value}`);
  assert.equal(de.displayValue({value, enum: semantic}), german, `${semantic}=${value} German`);
  assert.equal(en.displayValue({value: 7, enum: semantic}), "Unknown (7)");
}
for (const lang of ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"]) {
  const ui = renderer(lang);
  for (const [off, key] of [[9, "quiet_selection"], [54, "heating_offset"], [58, "imposed_power_limit"],
    [65, "demand_response"], [74, "pre_phe_outdoor"], [80, "main_target"], [83, "unit_operation"]]) {
    assert.equal(ui.displayHomeHubLabel({off, label: "obsolete label", profile: "altherma4"}),
      ui.labels[`a4.${key}`], `${lang}/${off}: native label uses its reviewed translation`);
  }
  for (const [off, key] of [[9, "quiet_help"], [38, "current_help"], [49, "flow_help"],
    [54, "heating_offset_help"], [58, "limit_help"], [65, "demand_help"], [68, "pump_help"],
    [74, "pre_phe_outdoor_help"], [79, "pressure_help"], [83, "operation_help"]]) {
    assert.equal(ui.descFor("obsolete base label", {off, profile: "altherma4"}).what,
      ui.labels[`a4.${key}`], `${lang}/${off}: native explanation cannot inherit base semantics`);
  }
  for (const [semantic, value] of nativeModes)
    assert.doesNotMatch(ui.displayValue({value, enum: semantic}), /^(?:enum\.|a4\.)/);
  for (const [off, label, unit, concept, key] of [
    [49, "Flow rate", "L/min", "flow", "flow_help"],
    [79, "Water pressure", "bar", "water_pressure", "pressure_help"],
  ]) {
    const x = { label: off === 49 ? "Flow sensor" : "Water Pressure", value: "2.5", unit, concept };
    const native = { off, label, value: 2, unit, concept, profile: "altherma4" };
    const escaped = ui.labels[`a4.${key}`].replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const comparison = ui.mbNoteHtml(x, native);
    assert.ok(comparison.includes(escaped), `${lang}/${off}: paired reading exposes its native limit`);
    assert.ok(!comparison.includes('class="mb-delta"'),
      `${lang}/${off}: unverified scaling cannot assert a physical difference or agreement`);
    assert.ok(!ui.mbNoteHtml(x, {...native, profile: "homehub"}).includes(escaped),
      `${lang}/${off}: the independent base comparison keeps its established meaning`);
    ui.state._values = [x]; ui.state._modbus = [native]; ui.state.status.hp.connected = false;
    const fallback = ui.vDescRow(x);
    assert.ok(fallback.includes(escaped), `${lang}/${off}: native replacement exposes its own limit`);
    assert.ok(!fallback.includes('class="mb-delta"'), `${lang}/${off}: no stale-source difference`);
    ui.state.status.hp.connected = true;
    ui.state.live = { flow: 2.5, wp: 2.5, ouHeldOver: false };
    ui.state.insp = off === 49 ? "flow" : "wp";
    ui.state._modbus = [{...native, profile: "homehub"}];
    const baseSignature = ui.inspectSig(ui.INSPECT[ui.state.insp]);
    ui.state._modbus[0].profile = "altherma4";
    assert.notEqual(ui.inspectSig(ui.INSPECT[ui.state.insp]), baseSignature,
      `${lang}/${off}: source metadata alone must refresh an open inspector's meaning`);
  }
}
assert.equal(en.displayHomeHubLabel({off: 58, label: "Power consumption"}), "Power consumption",
  "the independent base profile keeps its actual power-consumption label");
for (const [off, label, key] of [[49, "Flow rate", "flow_help"],
  [68, "Circulation pump speed", "pump_help"], [79, "Water pressure", "pressure_help"]]) {
  for (const profile of [undefined, "homehub"])
    assert.notEqual(en.descFor(label, {off, profile}).what, en.labels[`a4.${key}`],
      `${off}/${profile}: native interpretation limits cannot replace another source's explanation`);
}
assert.equal(en.displayValue({ value: "Recommended on" }), "Recommended on",
  "the derived X10A Smart-Grid row may still use its local canonical display text");

assert.deepEqual([0, 1, 2, 3].map(en.sgModeText),
  ["Free running", "Forced off", "Recommended on", "Forced on"]);
assert.deepEqual([0, 1, 2, 3].map(de.sgModeText),
  ["Freier Betrieb", "Zwangsabschaltung", "Empfehlung ein", "Erzwungen ein"]);
assert.equal(en.sgBoostText(), "BOOST", "English boost marker is compact and source-free");
assert.equal(de.sgBoostText(), "BOOST", "German boost marker is compact and source-free");

assert.equal(en.displayValue({ value: "1", binary: true }), "ON", "a real binary 1 remains ON");
assert.equal(de.displayValue({ value: "0", binary: true }), "OFF", "a real binary 0 remains OFF");
const selectorStates = [
  ["valve_dhw", "0", "Space heating", "Raumheizung"],
  ["valve_dhw", "1", "DHW", "Brauchwarmwasser"],
  // `valve_heat` is the legacy stable id for an optional shut-off-valve OUTPUT. It is not the
  // independently configured/current heating-cooling mode and therefore stays electrical ON/OFF.
  ["valve_heat", "0", "OFF", "OFF"],
  ["valve_heat", "1", "ON", "ON"],
];
for (const [semantic, value, english, german] of selectorStates) {
  const row = { value, binary: true, binary_semantic: semantic };
  assert.equal(en.displayValue(row), english, `${semantic}=${value} English named state`);
  assert.equal(de.displayValue(row), german, `${semantic}=${value} German named state`);
}
const heatingMode = { value: 1, enum: "operation_mode" };
const idleValve = { value: "0", binary: true, binary_semantic: "valve_heat" };
assert.equal(de.displayValue(heatingMode), "Heizen",
  "the configured HomeHub mode remains Heating while space operation is idle");
assert.equal(de.displayValue(idleValve), "OFF",
  "the independent 2WV output remains OFF and must not invent Cooling");
assert.notEqual(de.displayValue(idleValve), "Kühlen");
assert.equal(de.displayValue({ value: "1", binary: true, binary_semantic: "smart_grid_contact_1" }),
  "ON", "an individual Smart-Grid contact remains an electrical ON/OFF fact");
assert.equal(en.displayValue({ value: "0", binary: true, binary_semantic: "unknown_future" }),
  "OFF", "an unknown semantic id fails back to the ordinary flag contract");
assert.equal(de.displayValue({ value: "1" }), "1", "an untyped numeric one is never guessed to be a switch");
assert.equal(en.displayValue({ value: 7, enum: "operation_mode" }), "Unknown (7)");
assert.equal(de.displayValue({ value: 7, enum: "operation_mode" }), "Unbekannt (7)");
assert.equal(en.displayValue({ value: 0, enum: "current_operation_mode" }), "Unknown (0)",
  "input 38 has no Auto value; zero must not be borrowed from holding register 3");
assert.equal(en.displayValue({ value: -1, enum: "unknown_future" }), "Unknown (-1)");
assert.equal(de.displayValue({ value: "17" }), "17", "ordinary numeric values remain numeric");

// Legacy X10A catalog rows put these units in the label while HomeHub carries a dedicated field.
// Both must cross the visual boundary as the same label/value shape, without guessing that every
// parenthetical suffix is a unit.
const legacyUnits = [
  ["Flow sensor (l/min)", "Flow sensor", "L/min"],
  ["O/U capacity (kW)", "O/U capacity", "kW"],
  ["INV primary current (A)", "INV primary current", "A"],
  ["INV frequency (rps)", "INV frequency", "rps"],
  ["Expansion valve 1 (pls)", "Expansion valve 1", "pls"],
  ["Fan 1 (step)", "Fan 1", "step"],
];
for (const [label, shown, unit] of legacyUnits) {
  const row = { label, unit: "" };
  assert.equal(en.displayReadingLabel(label), shown, `${label}: unit leaves the visual label`);
  assert.equal(en.displayUnit(row), unit, `${label}: unit moves beside the visual value`);
}
assert.equal(en.displayUnit({ label: "Flow sensor (l/min)", unit: "L/min" }), "L/min",
  "an explicit HomeHub-style unit wins without duplication");
assert.equal(en.displayUnit({ label: "Flow sensor", unit: "l/min" }), "L/min",
  "flow-unit spelling is canonical across both sources");
assert.equal(en.displayReadingLabel("Outdoor Air Temp (R1T)"), "Outdoor Air Temp (R1T)",
  "a sensor name in parentheses is not mistaken for a unit");
assert.equal(en.displayReadingLabel("High Pressure (sat. °C)"), "High Pressure (sat. °C)",
  "a semantic saturation-temperature qualifier stays in the label");

// The catalog deliberately carries a few same-named readings on different X10A pages. They are
// independent values (notably outdoor-controller and hydronic-controller fault channels), so the
// sparse structural marker from /values must make every visible label unique without renaming an
// ordinary row or trusting prose to identify its source.
const scopedLabels = [
  [{ label: "Error type", reg: 0x10, x10a_group: "outdoor_state" }, "Outdoor State Error type"],
  [{ label: "Error type", reg: 0x60, x10a_group: "hydronic" }, "Hydronic Error type"],
  [{ label: "Error Code", reg: 0x10, x10a_group: "outdoor_state" }, "Outdoor State Error Code"],
  [{ label: "Error Code", reg: 0x60, x10a_group: "hydronic" }, "Hydronic Error Code"],
  [{ label: "Mixed water temp.", reg: 0x65, x10a_group: "mixing" }, "Mixing Mixed water temp."],
  [{ label: "Thermostat ON/OFF", reg: 0x10, x10a_group: "outdoor_state" },
    "Outdoor State Thermostat"],
  [{ label: "Thermostat ON/OFF", reg: 0x60, x10a_group: "hydronic" },
    "Hydronic Thermostat"],
];
for (const [row, shown] of scopedLabels) {
  assert.equal(en.displayReadingLabel(row.label, row), shown, `${shown}: structural page scope shown`);
  assert.equal(de.displayReadingLabel(row.label, row), shown,
    `${shown}: stable technical X10A label remains language-independent`);
}
assert.equal(en.displayReadingLabel("Error Code", { label: "Error Code", reg: 0x10 }), "Error Code",
  "a row is never qualified merely by guessing from its label or register");

const operationModes = [
  ["Stop", "Stop", "Stopp"],
  ["Heating", "Heating", "Heizen"],
  ["Cooling", "Cooling", "Kühlen"],
  ["DHW", "Hot water", "Warmwasser"],
  ["Heating + DHW", "Heating + hot water", "Heizen + Warmwasser"],
  ["Cooling + DHW", "Cooling + hot water", "Kühlen + Warmwasser"],
];
for (const [raw, english, german] of operationModes) {
  assert.equal(en.operationModeText(raw), english, `English schematic mode: ${raw}`);
  assert.equal(de.operationModeText(raw), german, `German schematic mode: ${raw}`);
}
assert.equal(de.operationModeText("Future mode"), "Future mode", "unknown modes remain visible");
assert.equal(de.operationModeText(null), null, "an absent mode stays absent");
assert.equal(de.operationModeFromFlags(true, false), "Warmwasser",
  "the HomeHub DHW flag feeds the same German schematic vocabulary");
assert.equal(de.operationModeFromFlags(false, true), "Raumbetrieb",
  "the HomeHub space flag does not invent Heating when it cannot distinguish Heating/Cooling");
assert.equal(de.operationModeFromFlags(true, true), "Raumbetrieb + Warmwasser",
  "simultaneous HomeHub flags stay generic about the unsupported space-mode direction");
assert.equal(de.operationModeFromFlags(false, false), "Stopp",
  "inactive HomeHub flags feed the same German schematic vocabulary");
assert.equal(de.operationModeFromFlags(null, false), null,
  "incomplete HomeHub flags do not guess an operation mode");
const modelLabels = {
  capacity: "Nennleistung der Außeneinheit",
  capacity_iu: "Nennleistung der Inneneinheit",
  oueeprom: "Kennung der Außeneinheit",
};
for (const [key, expected] of Object.entries(modelLabels)) {
  const actual = de.labels[`card.${key}`];
  assert.equal(actual, expected, `German model-card label: ${key}`);
  assert.doesNotMatch(actual, /[()]/, `German model-card label has no parenthetical qualifier: ${key}`);
}
assert.match(appStateSource,
  /const mode = schematicOperationMode\(\);/,
  "the schematic headline must use the shared X10A and HomeHub mode resolver");
assert.match(schematicSource,
  /head: \(\) => schematicOperationMode\(\)/,
  "the open operation-mode explainer must use the same localised fallback headline");

console.log("HomeHub enums and schematic operation modes: all states named in English and German");
