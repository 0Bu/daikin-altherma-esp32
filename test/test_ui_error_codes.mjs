// The Error code explainer must resolve only the currently reported code while its internal lookup
// stays aligned with the firmware's complete two-character vocabulary. This catches drifted English
// meanings, untranslated German copy and the 63-code catalogue accidentally becoming visible again.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const descriptionsSource = readAppFragments(["descriptions.js"]);
const header = fs.readFileSync(new URL("../main/logic/error_codes.hpp", import.meta.url), "utf8");

const tableContext = {
  LANG: "en",
  esc: (value) => String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  t: () => "Normal:",
};
vm.createContext(tableContext);
vm.runInContext(descriptionsSource + "\nthis.__ui = { codes: DAIKIN_FAULT_CODES," +
  " render: faultCodeDetailHtml, setLang: (lang) => { LANG = lang; } };", tableContext,
  { filename: "main/www/app.sources" });
const uiCodes = Array.from(tableContext.__ui.codes, (entry) => ({
  code: entry.code, en: entry.en, de: entry.de,
}));

const firmwareCodes = [...header.matchAll(/\{"([0-9A-Z]{2})",\s*"([^"]+)"\}/g)]
  .map((m) => ({ code: m[1], en: m[2] }));
assert.equal(firmwareCodes.length, 63, "the source-backed firmware table contains 63 main codes");
assert.equal(uiCodes.length, firmwareCodes.length, "the UI lookup must know every firmware code");
assert.deepEqual(uiCodes.map(({ code, en }) => ({ code, en })), firmwareCodes,
  "UI codes and English meanings must stay aligned with logic/error_codes.hpp");
assert.equal(new Set(uiCodes.map((entry) => entry.code)).size, uiCodes.length,
  "fault-code lookup must not contain duplicates");
for (const entry of uiCodes) {
  assert.ok(entry.de?.trim(), `${entry.code} needs a short German meaning`);
}

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

for (const [lang, meaningKey] of [["en", "en"], ["de", "de"]]) {
  const html = render(lang, "U4: current fault");
  assert.match(html, /class="fault-code-current"/,
    `${lang}: current code gets the compact detail row`);
  assert.ok(html.includes("<code>U4</code>"), `${lang}: current code is named`);
  assert.ok(html.includes(uiCodes.find((entry) => entry.code === "U4")[meaningKey]),
    `${lang}: current code meaning is shown`);
  assert.ok(!html.includes("<code>7H</code>") && !html.includes("<code>UF</code>"),
    `${lang}: unrelated codes must stay hidden`);
}

assert.match(render("de", "--"), /Aktuell wird kein Fehlercode übertragen\./,
  "an unavailable HomeHub value must not claim that the unit has no fault");
assert.match(render("en", "--"), /No fault code is currently being transmitted\./);
assert.match(render("de", "ZZ"), /<code>ZZ<\/code>[\s\S]*Keine Kurzbeschreibung/,
  "an unknown two-character code stays visible without an invented meaning");

console.log("Error-code UI: 63-code bilingual lookup is complete; only the current code is rendered");
