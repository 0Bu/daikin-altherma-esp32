// Complete, device-local UI locale contract: selection, catalog parity, lazy loading and bounded
// separately compressed assets. Specialist value explainers intentionally retain their documented
// English/German layer; this gate covers every string that goes through t()/data-i18n.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { readAppFragments, readAppSource, readUiLocale } from "../tools/ui/read_app_source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codes = ["en", "de", "es", "fr", "it", "pl", "cs", "uk"];
const nativeNames = {
  en: "English", de: "Deutsch", es: "Español", fr: "Français", it: "Italiano",
  pl: "Polski", cs: "Čeština", uk: "Українська",
};
const base = readAppFragments(["i18n.js"]);

function context(language = "en", cached = null) {
  return vm.createContext({
    navigator: { language },
    localStorage: { getItem: () => cached, setItem: () => {} },
    document: { getElementById: () => null },
  });
}

const catalogContext = context();
vm.runInContext(base, catalogContext, { filename: "main/www/js/i18n.js" });
for (const code of codes.slice(1)) {
  const source = readUiLocale(code);
  assert.doesNotThrow(() => new vm.Script(source, { filename: `main/www/locales/${code}.js` }),
    `${code} locale must parse as a classic script`);
  vm.runInContext(source, catalogContext, { filename: `main/www/locales/${code}.js` });
}
vm.runInContext("globalThis.__catalog = I18N;", catalogContext);
const catalog = catalogContext.__catalog;
const englishKeys = Object.keys(catalog.en).sort();
assert.equal(englishKeys.length, 734, "the test must track the complete current UI catalog");

for (const code of codes) {
  const dict = catalog[code];
  assert.ok(dict, `${code} locale did not register itself`);
  assert.deepEqual(Object.keys(dict).sort(), englishKeys, `${code} keys differ from English`);
  let translatedStrings = 0;
  let stringCount = 0;
  for (const key of englishKeys) {
    assert.equal(typeof dict[key], typeof catalog.en[key], `${code}/${key} changes value type`);
    if (typeof catalog.en[key] === "function") {
      assert.equal(dict[key].length, catalog.en[key].length, `${code}/${key} changes function arity`);
    } else {
      stringCount += 1;
      if (dict[key] !== catalog.en[key]) translatedStrings += 1;
    }
  }
  assert.equal(dict[`lang.${code}`], nativeNames[code], `${code} must name itself in its own tongue`);
  if (code !== "en") {
    assert.ok(translatedStrings > stringCount * 0.65,
      `${code} translates too little of the catalog (${translatedStrings}/${stringCount})`);
  }
}

// Browser detection selects the primary BCP-47 subtag; unsupported languages fail closed to the
// embedded English catalog. A cached supported choice wins on first paint.
for (const code of codes) {
  const c = context(`${code}-${code.toUpperCase()}`);
  vm.runInContext(`${base}; globalThis.__lang = LANG; globalThis.__supported = UI_LANGS;`, c);
  assert.equal(c.__lang, code, `${code} browser language must be detected`);
  assert.deepEqual(Array.from(c.__supported), codes, "browser and selector language sets drifted");
}
{
  const c = context("pt-BR", "uk");
  vm.runInContext(`${base}; globalThis.__lang = LANG;`, c);
  assert.equal(c.__lang, "uk", "a valid cached device language must win on first paint");
}
{
  const c = context("pt-BR", "not-a-locale");
  vm.runInContext(`${base}; globalThis.__lang = LANG;`, c);
  assert.equal(c.__lang, "en", "unknown browser/cache languages must fall back to English");
}

// The production loader must coalesce concurrent requests and evaluate only a same-device script.
{
  let c;
  let appended = 0;
  const document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild: (script) => {
      appended += 1;
      assert.equal(script.src, "/locale.js?lang=es");
      vm.runInContext(readUiLocale("es"), c, { filename: "main/www/locales/es.js" });
      script.onload();
    } },
  };
  c = vm.createContext({
    navigator: { language: "en" }, document,
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  vm.runInContext(`${base}; globalThis.__loadLocale = loadLocale;`, c);
  const results = await Promise.all([c.__loadLocale("es"), c.__loadLocale("es")]);
  assert.deepEqual(Array.from(results), [true, true]);
  assert.equal(appended, 1, "concurrent locale loads must share one request");
}

const dashboard = readAppFragments(["dashboard.js"]);
const choices = dashboard.match(/const LANGUAGE_CHOICES = Object\.freeze\(\[([^\]]+)\]\)/)?.[1]
  .match(/"([a-z]{2})"/g)?.map((value) => value.slice(1, -1)) || [];
assert.deepEqual(choices, codes, "Firmware-card choices must match browser support exactly");
assert.match(dashboard,
  /langRow\(uiLangSupported\(s\.ui\?\.lang\) \? s\.ui\.lang : "auto"\)/,
  "Firmware-card current value must accept every supported device language");

// Locale modules are not part of the startup response, and each compressed asset has its own tight
// gate. Execute the same minifier CMake uses.
const app = readAppSource();
for (const code of codes.slice(1)) assert.doesNotMatch(app, new RegExp(`I18N\\.${code}\\s*=`));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-locales-"));
try {
  const tool = path.join(root, "tools/web_asset/minify_js_and_gzip.py");
  for (const code of codes.slice(1)) {
    const output = path.join(work, `${code}.js.gz`);
    const run = childProcess.spawnSync("python3", [
      tool, "--input", path.join(root, `main/www/locales/${code}.js`), "--output", output,
      "--max-gzip-bytes", "32768",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(fs.statSync(output).size <= 32768, `${code} locale exceeds its gzip budget`);
    const minified = zlib.gunzipSync(fs.readFileSync(output)).toString("utf8");
    assert.doesNotThrow(() => new vm.Script(minified, { filename: `${code}.min.js` }),
      `${code} minified locale must still parse`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const cmake = fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8");
const status = fs.readFileSync(path.join(root, "main/http_status.cpp"), "utf8");
const server = fs.readFileSync(path.join(root, "main/http_server.cpp"), "utf8");
assert.match(cmake, /set\(UI_LOCALE_CODES de es fr it pl cs uk\)/);
assert.match(cmake, /set\(UI_LOCALE_GZIP_MAX_BYTES 32768\)/);
assert.match(cmake, /DEPENDS "\$\{locale_src\}" "\$\{UI_LOCALE_MINIFIER\}" "\$\{UI_MINIFIER\}"/,
  "locale assets must rebuild when the shared JavaScript minifier changes");
for (const code of codes.slice(1)) {
  assert.match(status, new RegExp(`\\{"${code}", locale_${code}_js_gz_start, locale_${code}_js_gz_end\\}`),
    `${code} compressed asset is not routed`);
}
assert.match(status, /"\/locale\.js", HTTP_GET, h_locale/);
assert.match(server, /cfg\.max_uri_handlers = 37/);

console.log(`UI locales: ${codes.length} catalogs × ${englishKeys.length} keys; lazy assets bounded and routed`);
