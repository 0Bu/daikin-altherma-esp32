// Complete, device-local UI locale contract: selection, compact-catalog parity, lazy loading,
// specialist copy for every visible explainer, and bounded separately compressed assets.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { readAppFragments, readAppSource, readUiLocale } from "../tools/ui/read_app_source.mjs";
import { translationSourceFingerprint } from "../tools/ui_localization/source_fingerprint.mjs";

const root = process.env.DAIKIN_UI_ROOT
  ? path.resolve(process.env.DAIKIN_UI_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codes = ["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"];
const nativeNames = {
  en: "English", de: "Deutsch", es: "Español", fr: "Français", it: "Italiano",
  pl: "Polski", cs: "Čeština", uk: "Українська", zh: "简体中文", ja: "日本語",
  nb: "Norsk", sv: "Svenska", fi: "Suomi",
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
const translationSource = translationSourceFingerprint(root);
const localeSources = new Map();
for (const code of codes.slice(1)) {
  const source = readUiLocale(code);
  localeSources.set(code, source);
  const sourceStamp = source.match(/^\/\/ translation-source: ([a-f0-9]{64})$/m)?.[1];
  assert.equal(sourceStamp, translationSource,
    `${code} translation source is stale; review every changed canonical text, update this locale, ` +
    `then set its translation-source marker to ${translationSource}`);
  assert.doesNotThrow(() => new vm.Script(source, { filename: `main/www/locales/${code}.js` }),
    `${code} locale must parse as a classic script`);
  assert.match(source, new RegExp(`(?:^|\\n)I18N\\.${code}\\s*=\\s*localeValues\\(\\[`),
    `${code} must omit repeated catalog keys through the positional locale loader`);
  vm.runInContext(source, catalogContext, { filename: `main/www/locales/${code}.js` });
}
vm.runInContext(
  "globalThis.__catalog = I18N; globalThis.__inspectCopy = INSPECT_I18N; " +
  "globalThis.__homeHubCopy = HOMEHUB_LABEL_I18N; " +
  "globalThis.__descriptionCopy = DESCRIPTION_I18N; " +
  "globalThis.__modelDescriptionCopy = MODEL_DESCRIPTION_I18N; " +
  "globalThis.__faultCodeCopy = FAULT_CODE_I18N; globalThis.__mbDeltaCopy = MB_DELTA_I18N; " +
  "globalThis.__inspectLocaleKeys = INSPECT_LOCALE_KEYS; " +
  "globalThis.__homeHubLocaleOffsets = HOMEHUB_LOCALE_OFFSETS;",
  catalogContext,
);
const catalog = catalogContext.__catalog;
const lazyDomainCodes = ["zh", "ja", "nb", "sv", "fi"];
const englishKeys = Object.keys(catalog.en).sort();
const englishKeyOrder = Object.keys(catalog.en);
assert.equal(englishKeys.length, 840, "the test must track the complete current UI catalog");
for (const [code, source] of localeSources) {
  const specialist = source.indexOf(`INSPECT_I18N.${code}`);
  const baseSource = specialist < 0 ? source : source.slice(0, specialist);
  const annotatedKeys = [...baseSource.matchAll(/\/\*\s*([^*]+?)\s*\*\//g)]
    .map((match) => match[1].trim());
  assert.deepEqual(annotatedKeys, englishKeyOrder,
    `${code} positional UI comments are not in canonical English key order`);
}

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
for (const code of lazyDomainCodes) {
  const faults = catalogContext.__faultCodeCopy[code];
  assert.equal(faults?.values?.length, 63, `${code} must register all fault-code meanings`);
  assert.ok(faults.none?.trim() && faults.unknown?.trim(), `${code} needs both fault-code fallbacks`);
  assert.deepEqual(Object.keys(catalogContext.__mbDeltaCopy[code] || {}).sort(),
    ["outdoor_air", "room_temp"], `${code} must register both source-difference explanations`);
}

// Polish uses one / 2-4 (except 12-14) / remaining forms. These counters routinely cross five and
// the cycling diagnosis starts judging at twelve, so a binary singular/plural split is visibly wrong.
for (const [count, cycle, start, gap] of [
  [1, "1 cykl", "1 uruchomienie", "1 przerwa — brak pomiaru"],
  [2, "2 cykle", "2 uruchomienia", "2 przerwy — brak pomiaru"],
  [5, "5 cykli", "5 uruchomień", "5 przerw — brak pomiaru"],
  [12, "12 cykli", "12 uruchomień", "12 przerw — brak pomiaru"],
  [22, "22 cykle", "22 uruchomienia", "22 przerwy — brak pomiaru"],
  [25, "25 cykli", "25 uruchomień", "25 przerw — brak pomiaru"],
]) {
  assert.equal(catalog.pl["check.cycles"](count), cycle);
  assert.equal(catalog.pl["check.starts"](count), start);
  assert.equal(catalog.pl["hist.gaps"](count), gap);
  assert.match(catalog.pl["nav.settings_alert"](count), new RegExp(
    count === 1 ? "1 połączenie niedostępne$"
      : [2, 22].includes(count) ? `${count} połączenia niedostępne$`
      : `${count} połączeń niedostępnych$`));
}

// Count-bearing diagnosis copy must not silently keep a plural adjective/verb for a real singular
// observation. Pin the surfaces that render abort, paired, cooling and unclassified populations.
assert.match(catalog.de["check.detail.dhw_blocked_link"](1, 20), /der einzige Kandidat wurde/);
assert.match(catalog.de["check.detail.dhw_blocked_link"](2, 20), /alle 2 Kandidaten wurden/);
assert.equal(catalog.de["check.paired_cycles"](1), "1 zugeordnet");
assert.match(catalog.es["check.detail.dhw_blocked"](1, "x", 20), /se descartó 1 ventana/);
assert.match(catalog.es["check.detail.dhw_blocked"](2, "x", 20), /se descartaron 2 ventanas/);
assert.equal(catalog.es["check.paired_cycles"](1), "1 emparejado");
assert.equal(catalog.es["check.cycling_cooling"](1), "refrigeración: se excluyó 1");
assert.match(catalog.fr["check.detail.dhw_blocked_link"](1, 20), /l’unique fenêtre candidate/);
assert.equal(catalog.fr["check.paired_cycles"](1), "1 apparié");
assert.equal(catalog.fr["check.cycling_censored"](1), "1 non classé");
assert.equal(catalog.it["check.paired_cycles"](1), "1 abbinato");
assert.equal(catalog.it["check.cycling_cooling"](1), "raffrescamento: 1 escluso");
assert.equal(catalog.it["check.cycling_censored"](1), "1 non classificato");
assert.equal(catalog.cs["check.cycling_censored"](1), "1 nezařazený");
assert.equal(catalog.sv["check.summary"]("OK", 1, 8), "OK · 1/8 bedömd");
assert.equal(catalog.sv["check.summary"]("OK", 2, 8), "OK · 2/8 bedömda");
assert.match(catalog.sv["check.detail.dhw_aborted"](1, "x", 20), /1 kandidat blev förkastad/);
assert.match(catalog.sv["check.detail.dhw_aborted"](2, "x", 20), /2 kandidater blev förkastade/);
assert.equal(catalog.sv["check.cycling_cooling"](1), "Kylning 1 utelämnad");
assert.equal(catalog.sv["check.cycling_cooling"](2), "Kylning 2 utelämnade");

// The specialist copy visible under the schematic remains lazy, but it is no longer allowed to
// fall back to English for any added language. Every diagram target gets a native title and a
// concise explanation; HomeHub register names are keyed by their stable offset, never by prose.
const index = fs.readFileSync(path.join(root, "main/www/index.html"), "utf8");
const inspectKeys = [...new Set([...index.matchAll(/data-insp="([^"]+)"/g)].map((m) => m[1]))].sort();
assert.equal(inspectKeys.length, 40, "specialist-copy gate must track every schematic target");
const inspectNowKeys = new Set(["sgrequest", "ou", "phe", "dt", "pth", "cop", "buh", "bsh",
  "valve", "valve2", "heat", "pump", "pel", "defrost", "quiet", "rhot", "rcold", "wsup",
  "wtank", "wheat", "wret", "flow_switch"]);
const homeHubOffsets = [1, 2, 3, 4, 6, 7, 9, 10, 21, 22, 23, 30, 31, 32, 33, 37,
  38, 40, 41, 42, 43, 44, 45, 49, 50, 51, 52, 53, 54, 56, 57, 58];

function sourceAssignment(source, start, terminator) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing positional source section ${start}`);
  const to = source.indexOf(terminator, from + start.length);
  assert.notEqual(to, -1, `missing close for positional source section ${start}`);
  return source.slice(from, to);
}
function lineAnnotations(source) {
  return [...source.matchAll(/\/\/\s*([a-z0-9_]+)\s*$/gmi)].map((match) => match[1]);
}

function tableLiteral(source, open, close) {
  const from = source.indexOf(open);
  assert.notEqual(from, -1, `missing ${open}`);
  const start = from + open.length - 1;
  const end = source.indexOf(close, start);
  assert.notEqual(end, -1, `missing close for ${open}`);
  const closing = open.endsWith("[") ? "]" : "}";
  const closeAt = source.indexOf(closing, end);
  assert.notEqual(closeAt, -1, `missing literal close for ${open}`);
  return vm.runInNewContext(`(${source.slice(start, closeAt + 1)})`);
}
const descriptionsSource = readAppFragments(["descriptions.js"]);
const historySource = readAppFragments(["history.js"]);
const faultSchema = tableLiteral(descriptionsSource,
  "const DAIKIN_FAULT_CODES = Object.freeze([", "\n]);");
const descriptionSchema = tableLiteral(descriptionsSource, "const DESCRIPTIONS = [", "\n];");
const modelSchema = tableLiteral(historySource, "const MODEL_DESCRIPTIONS = {", "\n};");
assert.equal(descriptionSchema.length, 125, "specialist-copy gate must track every value description");
assert.deepEqual(Object.keys(modelSchema), ["health_fault", "health_dhw_loss", "health_cycling",
  "health_defrost", "health_pressure", "health_flow", "health_heater", "health_retries",
  "free_heap", "max_alloc", "capacity", "capacity_iu", "candidates", "candidates_nocap",
  "oueeprom"], "model-description locale order drifted");
const faultCodes = Array.from(faultSchema, (entry) => entry.code);
assert.equal(faultCodes.length, 63, "fault-code locale order must track every canonical code");
for (const code of lazyDomainCodes) {
  const source = localeSources.get(code);
  const block = source.match(new RegExp(
    `FAULT_CODE_I18N\\.${code}\\s*=\\s*faultCodeValues\\(\\[([\\s\\S]*?)\\],`))?.[1] || "";
  const annotatedCodes = [...block.matchAll(/\/\/\s*([0-9A-Z]{2})\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(annotatedCodes, faultCodes,
    `${code} fault-code translations are not in canonical DAIKIN order`);
}
// The five latest packs also carry fault/Modbus prose and were authored as one positional unit.
// Pin every source annotation there; older packs predate readable per-row annotations, while their
// runtime shape/fingerprint contracts remain covered below.
for (const code of lazyDomainCodes) {
  const source = localeSources.get(code);
  assert.deepEqual(lineAnnotations(sourceAssignment(source, `INSPECT_I18N.${code}`, "\n);")),
    Array.from(catalogContext.__inspectLocaleKeys),
    `${code} inspector translations are not in canonical target order`);
  assert.deepEqual(lineAnnotations(sourceAssignment(source, `HOMEHUB_LABEL_I18N.${code}`, "\n]);")),
    Array.from(catalogContext.__homeHubLocaleOffsets),
    `${code} HomeHub translations are not in canonical offset order`);
  assert.deepEqual(lineAnnotations(sourceAssignment(source, `DESCRIPTION_I18N.${code}`, "\n]);")),
    Array.from({ length: descriptionSchema.length }, (_, index) => String(index)),
    `${code} value descriptions are not in canonical row order`);
  const modelAnnotations = lineAnnotations(
    sourceAssignment(source, `MODEL_DESCRIPTION_I18N.${code}`, "\n]);"));
  const modelKeys = Object.keys(modelSchema);
  const numericModelOrder = modelKeys.map((_, index) => String(index));
  assert.ok(
    modelAnnotations.length === modelKeys.length &&
      modelAnnotations.every((value, index) =>
        value === modelKeys[index] || value === numericModelOrder[index]),
    `${code} model descriptions are not in canonical key order`,
  );
}

function checkLocalizedRows(code, rows, schema, kind) {
  assert.ok(rows, `${code} ${kind} copy did not register itself`);
  assert.equal(rows.length, schema.length, `${code} ${kind} row count differs from English`);
  rows.forEach((row, index) => {
    assert.ok(Array.isArray(row), `${code} ${kind} row ${index} is not positional copy`);
    assert.ok(row.length === 1 || row.length === 2,
      `${code} ${kind} row ${index} must contain translated what and optional normal copy`);
    row.forEach((text, field) => assert.ok(typeof text === "string" && text.trim(),
      `${code} ${kind} row ${index}/${field} is empty`));
    assert.notEqual(row[0], schema[index].what,
      `${code} ${kind} row ${index} silently retained the English explanation`);
    if (row[1] != null && schema[index].normal != null) {
      assert.notEqual(row[1], schema[index].normal,
        `${code} ${kind} row ${index} silently retained the English normal context`);
    }
  });
}
for (const code of codes.slice(2)) {
  const inspect = catalogContext.__inspectCopy[code];
  assert.ok(inspect, `${code} specialist inspector copy did not register itself`);
  assert.deepEqual(Object.keys(inspect).filter((key) => key !== "held").sort(), inspectKeys,
    `${code} specialist inspector targets differ from the SVG`);
  for (const key of inspectKeys) {
    assert.ok(["string", "function"].includes(typeof inspect[key].t),
      `${code}/INSPECT.${key}.t is missing`);
    assert.ok(["string", "function"].includes(typeof inspect[key].what),
      `${code}/INSPECT.${key}.what is missing`);
    assert.equal(typeof inspect[key].aria, "string", `${code}/INSPECT.${key}.aria is missing`);
    if (inspectNowKeys.has(key)) assert.equal(typeof inspect[key].now, "function",
      `${code}/INSPECT.${key}.now is missing`);
  }
  assert.equal(typeof inspect.held?.lead, "string", `${code}/INSPECT.held.lead is missing`);
  assert.equal(typeof inspect.held?.why, "string", `${code}/INSPECT.held.why is missing`);

  const labels = catalogContext.__homeHubCopy[code];
  assert.ok(labels, `${code} HomeHub label table did not register itself`);
  assert.deepEqual(Object.keys(labels).map(Number).sort((a, b) => a - b), homeHubOffsets,
    `${code} HomeHub label offsets differ from the firmware contract`);
  for (const offset of homeHubOffsets)
    assert.ok(String(labels[offset]).trim(), `${code}/HomeHub ${offset} is empty`);

  checkLocalizedRows(code, catalogContext.__descriptionCopy[code], descriptionSchema,
    "value-description");
  const modelCopy = catalogContext.__modelDescriptionCopy[code] || {};
  const modelRows = Object.values(modelCopy);
  checkLocalizedRows(code, modelRows, Object.values(modelSchema), "model-description");
  const joined = (id) => modelCopy[id].join(" ");
  assert.match(joined("health_dhw_loss"), /0[,.]8/, `${code} loses the 0.8 K/h project threshold`);
  assert.match(joined("health_dhw_loss"), /1[,.]85/, `${code} loses the 1.85 K/h detection limit`);
  assert.match(joined("health_cycling"), /\b10\b/, `${code} loses the 10 min cycling threshold`);
  assert.match(joined("health_cycling"), /\b12\b/, `${code} loses the 12-run population`);
  assert.match(joined("health_defrost"), /15\s*%/, `${code} loses the 15% defrost heuristic`);
  assert.match(joined("health_defrost"), /\b3\b/, `${code} loses the three-defrost minimum`);
  assert.match(joined("health_pressure"), /1[,.]0|1\s*bar/i,
    `${code} loses the 1.0 bar pressure threshold`);
  assert.match(joined("health_pressure"), /\b60\b/, `${code} loses the 60 s warning dwell`);
  assert.match(joined("health_flow"), /\b60\b/, `${code} loses the pump run-up window`);
  assert.match(joined("health_heater"), /BUH/, `${code} loses the space-heater scope`);
  assert.match(joined("health_heater"), /BSH/, `${code} loses the tank-heater scope`);
  assert.match(joined("free_heap"), /\b24\b/, `${code} loses the 24-hour trend context`);
  assert.match(joined("free_heap"), /5/, `${code} loses the five-minute flash-bucket context`);
  assert.match(joined("max_alloc"), /TLS/, `${code} loses the contiguous-block TLS context`);
  assert.match(joined("max_alloc"), /OTA/, `${code} loses the contiguous-block OTA context`);
}

// Registration alone is insufficient: the screenshot regression was a native row heading whose
// real accordion renderer still chose English prose. Execute the production resolver and body
// builder for every localized row so a table that exists but is not wired into a render path fails.
{
  const runtimeContext = vm.createContext({
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, documentElement: {}, querySelectorAll: () => [] },
    labelSchematicHits: () => {},
  });
  const runtimeSource = readAppFragments(["i18n.js", "descriptions.js", "history.js"]) +
    codes.slice(1).map((code) => readUiLocale(code)).join("");
  vm.runInContext(`${runtimeSource}; globalThis.__copyRuntime = { activateLang, esc, DESCRIPTIONS,
    MODEL_DESCRIPTIONS, descBodyHtml, descriptionCopy, modelDescriptionCopy, faultCodeDetailHtml,
    DAIKIN_FAULT_CODES, FAULT_CODE_I18N, MB_DELTA_I18N, mbDeltaHtml };`, runtimeContext,
    { filename: "localized-description-runtime.js" });
  const api = runtimeContext.__copyRuntime;
  for (const code of codes.slice(2)) {
    api.activateLang(code);
    api.DESCRIPTIONS.forEach((entry, index) => {
      if (entry.faultCode) return; // faultCodeDetailHtml has its own separately gated 13-language map
      const localized = api.descriptionCopy(entry);
      const html = api.descBodyHtml(entry, "", localized);
      assert.ok(html.includes(api.esc(localized[0])),
        `${code} value-description ${index} renderer did not use its native text`);
    });
    for (const [id, entry] of Object.entries(api.MODEL_DESCRIPTIONS)) {
      const localized = api.modelDescriptionCopy(id);
      const html = api.descBodyHtml(entry, undefined, localized);
      assert.ok(html.includes(api.esc(localized[0])),
        `${code} model-description ${id} renderer did not use its native text`);
    }
    if (lazyDomainCodes.includes(code)) {
      const fault = api.FAULT_CODE_I18N[code];
      const u4 = api.DAIKIN_FAULT_CODES.findIndex((entry) => entry.code === "U4");
      assert.ok(api.faultCodeDetailHtml("U4").includes(api.esc(fault.values[u4])),
        `${code} fault-code renderer did not use its lazy native meaning`);
      const reason = api.MB_DELTA_I18N[code].outdoor_air;
      assert.ok(api.mbDeltaHtml({ concept: "outdoor_air", value: "--" }, { value: "--" })
        .includes(api.esc(reason)), `${code} source-difference renderer did not use its lazy native reason`);
    }
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
  const c = context("no-NO");
  vm.runInContext(`${base}; globalThis.__lang = LANG;`, c);
  assert.equal(c.__lang, "nb", "generic Norwegian browser language must select Bokmal");
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

// A classic script can execute its first assignment and then fail; browsers still complete the
// network load. Do not activate that half-registered language and expose English specialist islands.
{
  let c;
  const document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild: (script) => {
      vm.runInContext("I18N.es = {};", c);
      script.onload();
    } },
  };
  c = vm.createContext({ navigator: { language: "en" }, document,
    localStorage: { getItem: () => null, setItem: () => {} } });
  vm.runInContext(`${base}; globalThis.__loadLocale = loadLocale;`, c);
  assert.equal(await c.__loadLocale("es"), false,
    "a partial locale must fail closed until every specialist table registered");
}

const dashboard = readAppFragments(["dashboard.js"]);
const choices = dashboard.match(/const LANGUAGE_CHOICES = Object\.freeze\(\[([^\]]+)\]\)/)?.[1]
  .match(/"([a-z]{2})"/g)?.map((value) => value.slice(1, -1)) || [];
assert.deepEqual(choices, codes, "Firmware-card choices must match browser support exactly");
assert.match(dashboard,
  /langRow\(uiLangSupported\(s\.ui\?\.lang\) \? s\.ui\.lang : "auto"\)/,
  "Firmware-card current value must accept every supported device language");
assert.match(dashboard,
  /descBodyHtml\(d,\s*undefined,\s*modelDescriptionCopy\(id\)\)/,
  "the ESP32 free-heap and largest-block accordions must pass their localized model copy");

// Locale modules are not part of the startup response, and each compressed asset has its own tight
// gate. Execute the same minifier CMake uses.
const app = readAppSource();
for (const code of codes.slice(1)) assert.doesNotMatch(app, new RegExp(`I18N\\.${code}\\s*=`));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-locales-"));
let localeGzipTotal = 0;
try {
  const tool = path.join(root, "tools/web_asset/minify_js_and_gzip.py");
  for (const code of codes.slice(1)) {
    const output = path.join(work, `${code}.js.gz`);
    const run = childProcess.spawnSync("python3", [
      tool, "--input", path.join(root, `main/www/locales/${code}.js`), "--output", output,
      "--max-gzip-bytes", "32768",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const gzipBytes = fs.statSync(output).size;
    localeGzipTotal += gzipBytes;
    assert.ok(gzipBytes <= 32768, `${code} locale exceeds its gzip budget`);
    const minified = zlib.gunzipSync(fs.readFileSync(output)).toString("utf8");
    assert.doesNotThrow(() => new vm.Script(minified, { filename: `${code}.min.js` }),
      `${code} minified locale must still parse`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
assert.ok(localeGzipTotal <= 278528,
  `locale assets use ${localeGzipTotal} bytes and exhaust the signed application budget`);

const cmake = fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8");
const status = fs.readFileSync(path.join(root, "main/http_status.cpp"), "utf8");
const server = fs.readFileSync(path.join(root, "main/http_server.cpp"), "utf8");
assert.match(cmake, /set\(UI_LOCALE_CODES de es fr it pl cs uk zh ja nb sv fi\)/);
assert.match(cmake, /set\(UI_LOCALE_GZIP_MAX_BYTES 32768\)/);
assert.match(cmake, /DEPENDS "\$\{locale_src\}" "\$\{UI_LOCALE_MINIFIER\}" "\$\{UI_MINIFIER\}"/,
  "locale assets must rebuild when the shared JavaScript minifier changes");
for (const code of codes.slice(1)) {
  assert.match(status, new RegExp(`\\{"${code}", locale_${code}_js_gz_start, locale_${code}_js_gz_end\\}`),
    `${code} compressed asset is not routed`);
}
assert.match(status,
  /http_send_gzip\(req,\s*"text\/javascript; charset=utf-8",\s*asset\.start,\s*asset\.end\)/,
  "locale route must serve the checked gzip artifacts");
assert.match(status, /"\/locale\.js", HTTP_GET, h_locale/);
assert.match(server, /cfg\.max_uri_handlers = 38/);

console.log(`UI locales: ${codes.length} catalogs × ${englishKeys.length} keys; lazy assets bounded and routed`);
