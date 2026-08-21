// The Error code explainer must resolve only the currently reported code while its internal lookup
// stays aligned with the firmware's complete two-character vocabulary. This catches drifted English
// meanings, any missing locale meaning and the 63-code catalogue accidentally becoming visible again.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const descriptionsSource = readAppFragments(["descriptions.js"]);
const baseSource = readAppFragments(["i18n.js", "descriptions.js"]);
const header = fs.readFileSync(new URL("../main/logic/error_codes.hpp", import.meta.url), "utf8");

const tableContext = {
  LANG: "en",
  navigator: { language: "en" },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { getElementById: () => null },
  esc: (value) => String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
};
vm.createContext(tableContext);
vm.runInContext(baseSource, tableContext, { filename: "main/www/app.sources" });
for (const lang of ["de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"])
  vm.runInContext(readUiLocale(lang), tableContext, { filename: `main/www/locales/${lang}.js` });
vm.runInContext("this.__ui = { codes: DAIKIN_FAULT_CODES, packs: FAULT_CODE_I18N," +
  " render: faultCodeDetailHtml, setLang: (lang) => { LANG = lang; } };", tableContext,
  { filename: "main/www/app.sources" });
const languages = ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"];
const uiCodes = Array.from(tableContext.__ui.codes, (entry, index) => Object.fromEntries(
  [["code", entry.code], ...languages.map((lang) =>
    [lang, tableContext.__ui.packs[lang]?.values[index] || entry[lang]])],
));

const firmwareCodes = [...header.matchAll(/\{"([0-9A-Z]{2})",\s*"([^"]+)"\}/g)]
  .map((m) => ({ code: m[1], en: m[2] }));
assert.equal(firmwareCodes.length, 63, "the source-backed firmware table contains 63 main codes");
assert.equal(uiCodes.length, firmwareCodes.length, "the UI lookup must know every firmware code");
assert.deepEqual(uiCodes.map(({ code, en }) => ({ code, en })), firmwareCodes,
  "UI codes and English meanings must stay aligned with logic/error_codes.hpp");
assert.equal(new Set(uiCodes.map((entry) => entry.code)).size, uiCodes.length,
  "fault-code lookup must not contain duplicates");
for (const entry of uiCodes)
  for (const lang of languages)
    assert.ok(entry[lang]?.trim(), `${entry.code} needs a short ${lang} meaning`);

assert.doesNotMatch(descriptionsSource, /Der Daikin-Fehlercode \(z\. B\. U4, H3\)/,
  "the generic placeholder paragraph must not return");
assert.match(descriptionsSource, /\{ re: \/error code\|fault code\/i, faultCode: true,/,
  "X10A error-code rows must opt into current-code lookup");
assert.match(descriptionsSource, /re: \/\^unit abnormality code\$\/i, faultCode: true,/,
  "HomeHub error-code rows must opt into current-code lookup");

function render(lang, currentValue) {
  tableContext.__ui.setLang(lang);
  return tableContext.__ui.render(currentValue);
}

for (const lang of languages) {
  const html = render(lang, "U4: current fault");
  assert.match(html, /class="fault-code-current"/,
    `${lang}: current code gets the compact detail row`);
  assert.ok(html.includes("<code>U4</code>"), `${lang}: current code is named`);
  assert.ok(html.includes(uiCodes.find((entry) => entry.code === "U4")[lang]),
    `${lang}: current code meaning is shown`);
  assert.ok(!html.includes("<code>7H</code>") && !html.includes("<code>UF</code>"),
    `${lang}: unrelated codes must stay hidden`);
}

assert.match(render("de", "--"), /Aktuell wird kein Fehlercode übertragen\./,
  "an unavailable HomeHub value must not claim that the unit has no fault");
assert.match(render("en", "--"), /No fault code is currently being transmitted\./);
assert.match(render("de", "ZZ"), /<code>ZZ<\/code>[\s\S]*Keine Kurzbeschreibung/,
  "an unknown two-character code stays visible without an invented meaning");

console.log("Error-code UI: 63-code 13-language lookup is complete; only the current code is rendered");
