// Semantic contract for every HomeHub row: manufacturer label, German visual label and matching
// explanation. Coverage alone is insufficient here — a temperature setpoint used to match the
// generic "thermostat" bit text and was therefore described as an ON/OFF demand signal.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const descriptionsSource = readAppFragments(["descriptions.js"]);
const historySource = readAppFragments(["history.js"]);
const map = fs.readFileSync(new URL("../main/def/homehub.hpp", import.meta.url), "utf8");

const descriptionContext = { LANG: "en" };
vm.createContext(descriptionContext);
vm.runInContext(descriptionsSource + "\nthis.__descriptions = DESCRIPTIONS;", descriptionContext,
  { filename: "main/www/js/descriptions.js" });
const descriptions = descriptionContext.__descriptions;

const rowRe = /\{\s*(\d+)\s*,\s*MbFunc::[^}]*?"((?:[^"\\]|\\.)*)"\s*(?:,\s*HomeHubValueKind::(\w+)\s*)?\}/g;
const rows = [...map.matchAll(rowRe)].map((m) => ({
  off: Number(m[1]), label: m[2].replace(/\\(["\\])/g, "$1"), kind: m[3] || "Number",
}));
assert.equal(rows.length, 30, "all 30 curated HomeHub registers must be audited");

const firstDescription = (label) => descriptions.find((d) => {
  d.re.lastIndex = 0;
  return d.re.test(label);
});

function labels(lang) {
  const context = { LANG: lang };
  vm.createContext(context);
  vm.runInContext(historySource +
    "\nthis.__api = { displayHomeHubLabel, HOMEHUB_LABEL_DE };", context,
  { filename: "main/www/app.sources" });
  return context.__api;
}
const deLabels = labels("de");
const enLabels = labels("en");

const expected = new Map([
  [21, ["Unit abnormality", "Diagnosezustand der Anlage"]],
  [22, ["Unit abnormality code", "Fehlercode der Anlage"]],
  [23, ["Unit abnormality sub code", "Fehlersubcode der Anlage"]],
  [30, ["Circulation pump running", "Umwälzpumpe aktiv"]],
  [31, ["Compressor running", "Verdichter aktiv"]],
  [32, ["Booster heater run", "Heizstab aktiv"]],
  [37, ["3-way valve", "Position des 3-Wege-Ventils"]],
  [52, ["DHW normal operation", "Warmwasserbetrieb"]],
  [53, ["Space heating/cooling normal operation", "Raumheiz- oder Kühlbetrieb"]],
  [40, ["Leaving water temperature PHE", "Vorlauftemperatur am Plattenwärmetauscher"]],
  [41, ["Leaving water temperature BUH", "Vorlauftemperatur nach dem Zusatzheizer"]],
  [42, ["Return water temperature", "Rücklauftemperatur"]],
  [43, ["Domestic Hot Water temperature", "Warmwasserspeichertemperatur"]],
  [44, ["Outside air temperature", "Außentemperatur"]],
  [45, ["Liquid refrigerant temperature", "Kältemitteltemperatur der Flüssigkeitsleitung"]],
  [49, ["Flow rate", "Volumenstrom"]],
  [50, ["Remote controller room temperature Main", "Raumtemperatur der Hauptzone"]],
  [51, ["Heat pump power consumption", "Elektrische Leistungsaufnahme"]],
  [1, ["Leaving water Main Heating setpoint", "Heiz-Vorlaufsollwert der Hauptzone"]],
  [2, ["Leaving water Main Cooling setpoint", "Kühl-Vorlaufsollwert der Hauptzone"]],
  [3, ["Operation mode", "Heiz- oder Kühlmodus"]],
  [4, ["Space heating/cooling ON/OFF", "Raumheizung oder -kühlung freigegeben"]],
  [6, ["Room thermostat control Heating setpoint Main", "Heiz-Solltemperatur der Hauptzone"]],
  [7, ["Room thermostat control Cooling setpoint Main", "Kühl-Solltemperatur der Hauptzone"]],
  [9, ["Quiet mode operation", "Leisebetrieb"]],
  [10, ["DHW reheat setpoint", "Sollwert für Warmwasser-Nachheizung"]],
  [54, ["Leaving water Main Heating offset", "Vorlaufkorrektur der Haupt-Heizzone"]],
  [56, ["Smart Grid operation mode", "Smart-Grid-Betriebsart"]],
  [57, ["Power limit during Recommended on / buffering", "Leistungsgrenze für Pufferung"]],
  [58, ["General power limit", "Allgemeine Leistungsgrenze"]],
]);

assert.equal(expected.size, rows.length, "the expected label contract must cover every row");
for (const row of rows) {
  const names = expected.get(row.off);
  assert.ok(names, `missing expected labels for offset ${row.off}`);
  assert.equal(row.label, names[0], `manufacturer label at offset ${row.off}`);
  assert.equal(enLabels.displayHomeHubLabel(row),
    names[0].replace(/[\s.]+ON\/OFF\s*$/i, ""), `English visual label at offset ${row.off}`);
  assert.equal(deLabels.displayHomeHubLabel(row), names[1], `German visual label at offset ${row.off}`);
  assert.doesNotMatch(names[1], /[()]/,
    `German visual label at offset ${row.off} should read fluently without parenthetical qualifiers`);

  const d = firstDescription(row.label);
  assert.ok(d, `missing description for ${row.label}`);
  assert.ok(d.what?.trim() && d.de?.what?.trim(), `bilingual explanation for ${row.label}`);
  if (d.normal !== undefined) {
    assert.ok(d.normal.trim() && d.de?.normal?.trim(), `bilingual Normal text for ${row.label}`);
  }

  if (row.kind === "Binary") {
    const en = `${d.what} ${d.normal || ""}`;
    const de = `${d.de.what} ${d.de.normal || ""}`;
    for (const state of ["ON", "OFF"]) {
      assert.match(en, new RegExp(`\\b${state}\\b`), `${row.label}: English must name ${state}`);
      assert.match(de, new RegExp(`\\b${state}\\b`), `${row.label}: German must name ${state}`);
    }
    assert.doesNotMatch(de,
      /standardmäßig\s+(?:ein|aus)|\b(?:Status|Wert|Modus)\s+(?:ist|steht auf)\s+(?:ein|aus)|\b(?:eingeschaltet|ausgeschaltet)\b/i,
      `${row.label}: German status prose must use the visible ON/OFF states`);
  }
}

const enumStates = {
  UnitAbnormality: [["No error", "Kein Fehler"], ["Fault", "Fehler"], ["Warning", "Warnung"]],
  OperationMode: [["Auto", "Auto"], ["Heating", "Heizen"], ["Cooling", "Kühlen"]],
  ThreeWayValve: [["Space heating", "Raumheizung"], ["DHW", "Brauchwarmwasser"]],
  SmartGridMode: [["Free running", "Freier Betrieb"], ["Forced off", "Zwangsabschaltung"],
                  ["Recommended on", "Empfehlung ein"], ["Forced on", "Erzwungen ein"]],
};
for (const row of rows.filter((r) => enumStates[r.kind])) {
  const d = firstDescription(row.label);
  const en = `${d.what} ${d.normal || ""}`;
  const de = `${d.de.what} ${d.de.normal || ""}`;
  for (const [canonical, german] of enumStates[row.kind]) {
    assert.ok(en.includes(canonical), `${row.label}: English copy must name ${canonical}`);
    assert.ok(de.includes(german), `${row.label}: German copy must name ${german}`);
  }
}

for (const off of [6, 7]) {
  const d = firstDescription(rows.find((r) => r.off === off).label);
  assert.equal(d.exact, true, `offset ${off} needs the exact setpoint explanation`);
  assert.match(d.what, /temperature setpoint/i);
  assert.doesNotMatch(d.what, /currently asking the outdoor unit/i);
}
const quiet = firstDescription(rows.find((r) => r.off === 9).label);
assert.doesNotMatch(`${quiet.normal} ${quiet.de.normal}`, /default|standardmäßig/i);
const reheat = firstDescription(rows.find((r) => r.off === 10).label);
assert.match(`${reheat.normal} ${reheat.de.normal}`, /hysteresis/i);

const indoorMode = firstDescription("I/U operation mode");
assert.equal(indoorMode.de.what,
  "Die aktuelle Regler-Betriebsart der Wasserseite: Stopp, Heizen, Kühlen, Warmwasser oder eine Kombination. Die Betriebsart allein belegt weder einen laufenden Verdichter noch eine nutzbare Heiz- oder Kälteleistung.");
assert.match(indoorMode.de.normal, /Aktivitätszeile.*steht hier Warmwasser/);
assert.doesNotMatch(`${indoorMode.de.what} ${indoorMode.de.normal}`,
  /Wasserseite \(|Heizen\+Warmwasser|\bWW\b/,
  "the German operation-mode explanation uses fluent copy and the visible state names");

console.log("HomeHub copy: 30/30 values, labels and bilingual explanations are semantically pinned");
