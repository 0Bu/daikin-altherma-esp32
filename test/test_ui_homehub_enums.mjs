// Execute the production HomeHub enum display boundary in a DOM-free VM. The EKRHH guide encodes
// modes, flags and numbers alike as Int16; this pins the distinction that keeps "Operation mode 1"
// from returning while true binary rows continue to use the firmware-wide 0/1 -> ON/OFF contract.
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

const SOURCE =
  span("const I18N = {", "// Localise the static markup") +
  span("const ENUM_VALUE_I18N = Object.freeze({", "// The generated X10A catalog sometimes");

function renderer(lang) {
  const context = { LANG: lang };
  vm.createContext(context);
  vm.runInContext(SOURCE + "\nthis.__displayValue = displayValue;", context,
    { filename: "main/www/app.js" });
  return context.__displayValue;
}

const en = renderer("en");
const de = renderer("de");

const modes = [
  ["Auto", "Auto"],
  ["Heating", "Heizen"],
  ["Cooling", "Kühlen"],
  ["No error", "Kein Fehler"],
  ["Fault", "Fehler"],
  ["Warning", "Warnung"],
  ["Space heating", "Raumheizung"],
  ["DHW", "Brauchwarmwasser"],
  ["Free running", "Freier Betrieb"],
  ["Forced off", "Erzwungen OFF"],
  ["Recommended on", "Empfohlen ON"],
  ["Forced on", "Erzwungen ON"],
];

for (const [canonical, german] of modes) {
  assert.equal(en({ value: canonical }), canonical, `English enum: ${canonical}`);
  assert.equal(de({ value: canonical }), german, `German enum: ${canonical}`);
}

assert.equal(en({ value: "1", binary: true }), "ON", "a real binary 1 remains ON");
assert.equal(de({ value: "0", binary: true }), "OFF", "a real binary 0 remains OFF");
assert.equal(de({ value: "1" }), "1", "an untyped numeric one is never guessed to be a switch");
assert.equal(en({ value: "Unknown (7)" }), "Unknown (7)");
assert.equal(de({ value: "Unknown (7)" }), "Unbekannt (7)");
assert.equal(de({ value: "17" }), "17", "ordinary numeric values remain numeric");

console.log("HomeHub enum UI: all manufacturer states named in English and German");
