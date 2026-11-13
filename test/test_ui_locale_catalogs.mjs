// Complete, device-local UI locale contract: selection, compact-catalog parity, lazy loading,
// specialist copy for every visible explainer, and bounded lossless asset delivery.
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
assert.equal(englishKeys.length, 969, "the test must track the complete current UI catalog");
for (const [code, source] of localeSources) {
  const sections = [`INSPECT_I18N.${code}`, `MODEL_DESCRIPTION_I18N.${code}`]
    .map(marker => source.indexOf(marker)).filter(index => index >= 0);
  const specialist = sections.length ? Math.min(...sections) : -1;
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
  const savedTime = dict["check.hour.saved"]("12:34");
  assert.equal(savedTime.match(/12:34/g)?.length, 1, `${code} preserves the supplied saved time`);
  assert.notEqual(savedTime, dict["check.hour.ending"]("12:34"),
    `${code} distinguishes saved times from interval ends`);
  if (code !== "en") {
    assert.ok(translatedStrings > stringCount * 0.65,
      `${code} translates too little of the catalog (${translatedStrings}/${stringCount})`);
  }
}
// Keep the completed-run count and its optional average independently readable in each locale.
for (const code of codes) {
  const dict = catalog[code];
  const runs = dict["check.cycling.runs"];
  for (const n of [0, 1, 12]) {
    assert.deepEqual(runs(n).match(/\d+/g), [String(n)], `${code} keeps one run count`);
    assert.notEqual(runs(n), dict["check.starts"](n), `${code} distinguishes runs from starts`);
  }
  const mean = dict["check.cycling.mean"]("16 min");
  assert.equal(mean.match(/16 min/g)?.length, 1, `${code} preserves the supplied mean duration`);
  const assessments = ["short", "normal", "few", "waiting", "class_unavailable", "unavailable", "stale"]
    .map(key => dict[`check.cycling.${key}`]);
  assert.equal(new Set(assessments).size, assessments.length, `${code} distinguishes assessment states`);
  for (const value of assessments) {
    assert.ok(value.trim(), `${code} assessment is empty`);
    if (code !== "en") assert.ok(!Object.values(catalog.en).includes(value),
      `${code} assessment falls back to English`);
  }
}
// Completed DHW windows are counts. The current candidate and settling remainder are durations;
// there is no six-hour assessment target and no second unit may be added to a duration.
for (const code of ["ja", "fi", "zh"]) {
  const dict = catalog[code];
  for (const key of ["check.detail.dhw_candidate", "check.detail.dhw_settling", "check.detail.dhw_waiting"]) {
    const args = key.endsWith("candidate") ? ["2", "", "20 min", "1 h"]
      : key.endsWith("settling") ? ["2", "", "45 min"] : ["2", ""];
    const text = dict[key](...args);
    for (const arg of args) assert.ok(text.includes(arg), `${code}/${key} lost duration ${arg}`);
    assert.doesNotMatch(text, /6 h/, `${code}/${key} invents an assessment target`);
    assert.doesNotMatch(text, /(?:h|min)\s*(?:件|个|分鐘|分钟)|puhdasta tunnin ikkunaa valmiina|puhdas tunnin ikkuna valmis/,
      `${code}/${key} treats a formatted duration as a count or adds a second unit`);
  }
}
assert.doesNotMatch(catalog.ja["check.detail.collecting"]("2 h", "24 h"), /(?:h|min)件/,
  "Japanese collecting progress must describe elapsed time, not item counts");

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
// observation. Pin the surfaces that render abort, paired and completed-run populations.
assert.match(catalog.de["check.detail.dhw_blocked_link"](1, 20), /Abgebrochene Fenster: 1,/);
assert.match(catalog.de["check.detail.dhw_blocked_link"](2, 20), /Abgebrochene Fenster: 2,/);
// Structural markers only, not meaning: every locale's blind list item carries no parentheses (it
// is inserted into an already parenthesised list). The
// cause-neutral MEANING ("blind" is unobserved time from the X10A link or the board's own pauses;
// the unread input is the readings the check needs) is pinned for EN and DE in test_ui_checkup.mjs
// and for ZH, JA and CS below; the other locales rely on human review of each translation and on
// the translation-source marker, which goes stale when the English source changes.
for (const code of codes) {
  const label = catalog[code]["check.detail.dhw_reason.blind"];
  assert.doesNotMatch(label, /[()（）]/, `${code} blind reason label must not nest parentheses`);
  const verdict = catalog[code]["check.detail.dhw_blocked_link"](2, 20);
  assert.ok(verdict.trim(), `${code} blind verdict must explain the missing evidence`);
  assert.doesNotMatch(verdict, /RX\/TX/, `${code} must not prescribe wiring work from an unobserved interval`);
  const noAttempt = catalog[code]["check.detail.dhw_blocked"](0, "", "0 min");
  assert.ok(noAttempt.includes("24"), `${code} retains the no-window day scope`);
  assert.doesNotMatch(noAttempt, /0 min|\(\)|（）|\b0\b/,
    `${code} no confirmed opening must not invent discarded candidates`);
}
// This reason includes a plausible endpoint that was not confirmed within the closing grace.
// It must not claim that every failed confirmation was an implausible R5T reading.
for (const [code, unconfirmed] of Object.entries({
  en: /unconfirmed/, de: /unbestätigt/, es: /sin confirmar/, fr: /non confirmé/,
  it: /non confermato/, pl: /niepotwierdzone/, cs: /nepotvrzené/, uk: /непідтверджене/,
  zh: /未确认/, ja: /未確認/, nb: /ubekreftet/, sv: /obekräftad/, fi: /vahvistamaton/,
})) assert.match(catalog[code]["check.detail.dhw_reason.reading"], unconfirmed,
  `${code} reading reason must include unconfirmed endpoints`);
// ZH once said the tank "has no problem", a reassurance a NOT AVAILABLE result cannot give; it must
// stay as neutral as the English "says nothing about the tank". JA uses one term for "paused" in
// both the list item and the verdict. Missing replies and local query pauses remain distinct.
assert.match(catalog.zh["check.detail.dhw_blocked_link"](2, 20), /不说明水箱状态/);
assert.doesNotMatch(catalog.zh["check.detail.dhw_blocked_link"](2, 20), /有问题|没有问题|正常/);
assert.match(catalog.ja["check.detail.dhw_reason.blind"], /一時停止/);
assert.match(catalog.ja["check.detail.dhw_blocked_link"](2, 20), /応答欠落|ポーリング停止/);
assert.match(catalog.cs["check.detail.dhw_blocked_link"](2, 20), /Chybějící odpovědi či pauzy dotazování/);
assert.equal(catalog.de["check.paired_cycles"](1), "1 zugeordnet");
assert.match(catalog.es["check.detail.dhw_blocked"](1, "x", 20), /Ventanas descartadas: 1 \(x\)/);
assert.match(catalog.es["check.detail.dhw_blocked"](2, "x", 20), /Ventanas descartadas: 2 \(x\)/);
assert.equal(catalog.es["check.paired_cycles"](1), "1 emparejado");
assert.equal(catalog.es["check.cycling.runs"](1), "1 ciclo");
assert.match(catalog.fr["check.detail.dhw_blocked_link"](1, 20), /Fenêtres interrompues : 1,/);
assert.equal(catalog.fr["check.paired_cycles"](1), "1 apparié");
assert.equal(catalog.fr["check.cycling.runs"](1), "1 cycle");
assert.equal(catalog.it["check.paired_cycles"](1), "1 abbinato");
assert.equal(catalog.it["check.cycling.runs"](1), "1 ciclo");
assert.deepEqual([1, 2, 12].map(catalog.cs["check.cycling.runs"]), ["1 cyklus", "2 cykly", "12 cyklů"]);
assert.deepEqual([1, 2, 12].map(catalog.pl["check.cycling.runs"]), ["1 cykl", "2 cykle", "12 cykli"]);
assert.deepEqual([1, 2, 12].map(catalog.uk["check.cycling.runs"]), ["1 цикл", "2 цикли", "12 циклів"]);
assert.equal(catalog.sv["check.summary.warnings"](1), "1 varning");
assert.equal(catalog.sv["check.summary.warnings"](2), "2 varningar");
assert.match(catalog.sv["check.detail.dhw_aborted"](1, "x", 20), /1 kandidat blev förkastad/);
assert.match(catalog.sv["check.detail.dhw_aborted"](2, "x", 20), /2 kandidater blev förkastade/);
assert.equal(catalog.sv["check.cycling.runs"](1), "1 körning");
assert.equal(catalog.sv["check.cycling.runs"](2), "2 körningar");
assert.equal(catalog.de["check.cycling.runs"](12), "12 Läufe");
assert.equal(catalog.de["check.cycling.mean"]("16 min"), "Ø 16 min");
assert.equal(catalog.en["check.cycling.short"], "Heating runs are short on average.");
assert.equal(catalog.de["check.cycling.short"], "Die Heizläufe sind im Schnitt kurz.");
assert.equal(catalog.en["check.cycling.normal"], "Heating runs are long enough on average.");
assert.equal(catalog.de["check.cycling.normal"], "Die Heizläufe dauern im Schnitt lang genug.");

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
// Defrost share uses only compressor runtime with both input states readable.
const defrostDenominators = {
  es: [/estados de compresor y desescarche legibles/, /tiempo de marcha del compresor/],
  fr: [/états compresseur et dégivrage lisibles/, /temps de marche du compresseur/],
  it: [/stati compressore e sbrinamento leggibili/, /tempo di marcia del compressore/],
  pl: [/czytelnych stanach sprężarki i odszraniania/, /czasu pracy sprężarki/],
  cs: [/čitelném stavu kompresoru i odmrazení/, /doby chodu kompresoru/],
  uk: [/читабельними станами компресора й розморожування/, /часу роботи компресора/],
  zh: [/压缩机及除霜状态均可读/, /压缩机运行时间/],
  ja: [/圧縮機と除霜の状態が両方読める/, /圧縮機運転時間/],
  nb: [/både kompressor- og avrimingsstatus er lesbar/, /kompressorens driftstid/],
  sv: [/både kompressor- och avfrostningsstatus kan läsas/, /kompressorns drifttid/],
  fi: [/sekä kompressorin että sulatuksen tila on luettavissa/, /kompressorin käyntiajasta/],
};
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
// German model explanations share the existing lazy asset; loading only its short UI catalog
// cannot mark a partial module ready. English remains the inlined fallback.
assert.deepEqual(Object.keys(catalogContext.__modelDescriptionCopy.de), Object.keys(modelSchema),
  "German external model copy must cover the complete canonical model scope");
assert.deepEqual([...sourceAssignment(localeSources.get("de"), "MODEL_DESCRIPTION_I18N.de", "\n]);")
  .matchAll(/\/\*\s*([^*]+?)\s*\*\//g)].map(match => match[1].trim()), Object.keys(modelSchema),
  "German model-copy comments must preserve the canonical key order");
checkLocalizedRows("de", Object.values(catalogContext.__modelDescriptionCopy.de),
  Object.values(modelSchema), "model-description");
assert.equal(vm.runInContext("localeReady('de')", catalogContext), true);
assert.equal(vm.runInContext(`(() => {
  const saved = MODEL_DESCRIPTION_I18N.de;
  MODEL_DESCRIPTION_I18N.de = null;
  const ready = localeReady('de');
  MODEL_DESCRIPTION_I18N.de = saved;
  return ready;
})()`, catalogContext), false, "an incomplete German module must retain the English fallback");
for (const code of codes.slice(2)) {
  const inspect = catalogContext.__inspectCopy[code];
  assert.ok(inspect, `${code} specialist inspector copy did not register itself`);
  assert.deepEqual(Object.keys(inspect).filter((key) => key !== "held" && key !== "held_unknown").sort(), inspectKeys,
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
  assert.equal(typeof inspect.held_unknown, "string", `${code}/INSPECT.held_unknown is missing`);

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
  assert.doesNotMatch(joined("health_dhw_loss"), /1[,.]85/,
    `${code} must not revive the removed upper cooling detection limit`);
  assert.doesNotMatch(joined("health_cycling"), /\d|X10A|Daikin|rps/,
    `${code} cycling model copy must stay in plain language`);
  assert.match(joined("health_defrost"), /15\s*%/, `${code} loses the 15% defrost heuristic`);
  assert.match(joined("health_defrost"), /\b3\b/, `${code} loses the three-defrost minimum`);
  assert.match(joined("health_defrost"), defrostDenominators[code][0],
    `${code} defrost runtime must require both readable states`);
  assert.match(joined("health_defrost"), defrostDenominators[code][1],
    `${code} defrost share must name compressor runtime`);
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
    document: { getElementById: id => id === "inspClose" ? { setAttribute() {} } : null,
      documentElement: {}, querySelectorAll: () => [] },
    S: { status: { hp: { connected: true } }, _values: [] },
  });
  const runtimeSource = readAppFragments(["i18n.js", "descriptions.js", "history.js", "schematic.js"]) +
    codes.slice(1).map((code) => readUiLocale(code)).join("");
  vm.runInContext(`${runtimeSource}; globalThis.__copyRuntime = { activateLang, esc, DESCRIPTIONS,
    MODEL_DESCRIPTIONS, descBodyHtml, descriptionCopy, modelDescriptionCopy, faultCodeDetailHtml,
    DAIKIN_FAULT_CODES, FAULT_CODE_I18N, MB_DELTA_I18N, mbDeltaHtml, INSPECT, inspFieldText, t,
    inspNowText };`, runtimeContext,
    { filename: "localized-description-runtime.js" });
  const api = runtimeContext.__copyRuntime;
  const separateWaterEvidence = {
    en: /heater activity and water circulation.*separate/i,
    de: /Heizereinsatz und Wasserumlauf.*separate/,
    es: /calentadores eléctricos.*circulación del agua.*por separado/,
    fr: /appoints électriques.*circulation de l’eau.*séparément/,
    it: /resistenze elettriche.*circolazione dell’acqua.*separatamente/,
    pl: /grzałek elektrycznych.*obieg wody.*osobno/,
    cs: /elektrického ohřevu.*oběh vody.*samostatně/,
    uk: /електронагрівачів.*циркуляцію води.*окремо/,
    zh: /电加热器.*水是否循环.*分别/,
    ja: /電気ヒーター.*水の循環.*別々/,
    nb: /varmeelementer.*vannsirkulasjon.*separat/,
    sv: /Elvärmarnas drift.*vattencirkulationen.*separat/,
    fi: /Sähkölämmittimien toiminta.*veden kierto.*erikseen/,
  };
  const compressorFlag = api.DESCRIPTIONS.find(entry => entry.re.test("Compressor running"));
  for (const code of codes) {
    api.activateLang(code);
    const flagCopy = api.descBodyHtml(compressorFlag, undefined, api.descriptionCopy(compressorFlag));
    assert.match(flagCopy, /HomeHub/);
    for (const state of ["state.on", "state.off"])
      assert.ok(flagCopy.includes(api.t(state)), `${code}: the HomeHub flag names its binary state`);
    const parked = { compressorOn: false, flow: 12, buh1: true, mbFields: new Set(["out"]) };
    for (const x10a of [true, false]) {
      runtimeContext.S.status.hp.connected = x10a;
      const frame = { ...parked, rps: x10a ? 0 : null, ouHeldOver: x10a, mbCompressorOn: false };
      const stopped = api.inspNowText(api.INSPECT.ou, { ...frame, out: 0 });
      assert.match(stopped, separateWaterEvidence[code], `${code}: preserve heater and water-circuit evidence`);
      assert.ok(stopped.includes(api.t(x10a ? "schem.outdoor_held" : "sys.x10a_down")));
      assert.ok(stopped.includes(api.t("schem.outdoor_homehub")),
        `${code}: credit HomeHub for the displayed outdoor reading even when X10A is offline`);
      assert.equal(stopped.includes(api.t("schem.homehub_compressor_off")), !x10a,
        `${code}: attribute the OFF report when X10A supplies no speed`);
      assert.ok(!api.inspNowText(api.INSPECT.ou, { ...frame, out: null }).includes(api.t("schem.outdoor_homehub")),
        `${code}: source metadata without an outdoor value cannot earn a source claim`);
    }
    runtimeContext.S.status.hp.connected = true;
    const unknown = api.inspNowText(api.INSPECT.ou, { rps: null, compressorOn: null });
    assert.equal(unknown, api.t("dyn.state_gate"), `${code}: no compressor witness cannot establish a stop`);
    const conflict = api.inspNowText(api.INSPECT.ou, {
      ...parked, rps: 0, mbCompressorOn: true, ouHeldOver: true, out: 5,
    });
    assert.ok(conflict.includes(`X10A 0 rps · HomeHub ${api.t("state.on")}`));
    assert.ok(conflict.includes(api.t("schem.outdoor_homehub")));
    for (const valveDhw of [true, false, null]) {
      const d = { valveDhw, flow: 12.3, lwt: 34.7, ret: 31, tank: 42,
        pthKind: "cooling", thermalMode: "cool", rps: 20 };
      for (const [key, route] of [["wtank", true], ["wheat", false], ["heat", false]]) {
        const text = api.inspNowText(api.INSPECT[key], d);
        if (valveDhw == null) {
          assert.equal(text, api.t("schem.water_route_unknown"), `${code}/${key}: common flow cannot pick a branch`);
        } else {
          assert.equal(text.includes((34.7).toLocaleString(code)), valveDhw === route,
            `${code}/${key}: positive flow copy requires the matching reported route`);
        }
      }
      if (valveDhw !== false) {
        for (const key of ["heat", "wheat"])
          assert.equal(api.inspFieldText(api.INSPECT[key], "t", d),
            api.inspFieldText(api.INSPECT[key], "t", { ...d, pthKind: null }),
            `${code}/${key}: a branch title needs the matching reported route`);
      }
    }
    for (const key of ["ou", "rhot", "rcold"]) {
      const gateway = api.inspNowText(api.INSPECT[key], { rps: null, compressorOn: true });
      assert.match(gateway, /^HomeHub|^Der HomeHub/, `${code}/${key}: lead with the reported compressor state`);
      assert.match(gateway, /X10A/, `${code}/${key}: distinguish detailed readings from the HomeHub flag`);
    }
    for (const pth of [-5, 0, 5]) {
      const frame = { defrost: true, pthKind: "transfer", pth, rps: 18, dtStale: false };
      const sign = api.t("schem.transfer_sign");
      assert.equal(api.inspFieldText(api.INSPECT.pth, "t", frame), api.t("schem.defrost_transfer"));
      assert.ok(api.inspFieldText(api.INSPECT.pth, "what", frame).includes(sign));
      assert.match(api.inspFieldText(api.INSPECT.pth, "what", frame), /R1T−R4T/);
      const reading = pth.toLocaleString(code, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      assert.equal(api.inspNowText(api.INSPECT.pth, frame), `≈ ${reading} kW.`);
      assert.equal(api.inspNowText(api.INSPECT.phe, frame), `≈ ${reading} kW. ${sign}`);
    }
    const base = { efficiencyKind: "eer", pthKind: "cooling", cop: 2.2, pth: 4.5, rps: 18,
      copPth: 3.3, pel: 2.5, copPel: 1.5 };
    const copy = (field, extra) => api.inspFieldText(api.INSPECT.cop, field, { ...base, ...extra });
    const ctPost = { pelSrc: "CT", copScope: "plant", copPostBuh: true };
    const ctPre = { pelSrc: "CT", copScope: "plant", copPostBuh: false };
    const inverter = { pelSrc: "CT", copScope: "hp", copPostBuh: false };
    assert.match(copy("what", ctPost), /R2T/);
    assert.doesNotMatch(copy("what", ctPost), /R1T/);
    for (const plan of [ctPre, inverter]) {
      assert.match(copy("what", plan), /R1T/);
      assert.doesNotMatch(copy("what", plan), /R2T/);
    }
    for (const plan of [ctPre, ctPost, inverter]) assert.match(copy("what", plan), /R4T/);
    assert.notEqual(copy("t", ctPost), copy("t", inverter), `${code}: title distinguishes CT from inverter`);
    assert.notEqual(copy("what", ctPre), copy("what", inverter), `${code}: CT and inverter evidence differ`);
    assert.ok(copy("now", inverter).includes((1.5).toLocaleString(code)),
      `${code}: the ratio shows its inverter denominator independently of the input pill`);
    assert.doesNotMatch(api.inspNowText(api.INSPECT.pth, { ...base, ...ctPost }), /EER/,
      `${code}: PHE estimate has no EER across a different outlet`);
    for (const copBlock of ["tank_heater", "backup_heater", "no_pel"]) {
      const blocked = { ...ctPre, copBlock, cop: null };
      assert.match(copy("t", blocked), /EER/);
      assert.doesNotMatch(copy("what", blocked), /R[12]T/);
      assert.match(copy("now", blocked), /EER/);
      assert.doesNotMatch(copy("now", blocked), /COP/);
      if (copBlock === "no_pel")
        assert.equal(copy("now", blocked), api.t("schem.no_usable_power", "EER"));
    }
    const speedRequirement = api.t("schem.capacity_low_speed");
    assert.match(speedRequirement, /X10A/);
    assert.match(speedRequirement, /5/);
    for (const rps of [null, 5]) {
      const unqualified = { rps, compressorOn: true, dt: -2, dtStale: false,
        pth: null, cop: null, efficiencyKind: "eer" };
      assert.equal(api.inspNowText(api.INSPECT.phe, unqualified), speedRequirement);
      assert.equal(api.inspNowText(api.INSPECT.pth, unqualified), speedRequirement);
      assert.ok(api.inspNowText(api.INSPECT.dt, unqualified).endsWith(speedRequirement));
      assert.equal(copy("now", unqualified), api.t("schem.efficiency_no_capacity", "EER") + " " + speedRequirement);
    }
  }
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
let firmwareLocaleGzipTotal = 0;
let bundleGzipTotal = 0;
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
    {
      // Keep both independent per-source encoders checked even though the firmware embeds one
      // joint bundle. Neither encoding may change any minified source byte or exceed 32 KiB.
      const packed = path.join(work, `${code}.zopfli.js.gz`);
      const encode = () => childProcess.spawnSync("python3", [
        tool, "--input", path.join(root, `main/www/locales/${code}.js`), "--output", packed,
        "--gzip-encoder", "zopfli", "--max-gzip-bytes", "32768",
      ], { cwd: root, encoding: "utf8" });
      const first = encode();
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const bytes = fs.readFileSync(packed);
      firmwareLocaleGzipTotal += bytes.length;
      assert.equal(zlib.gunzipSync(bytes).toString("utf8"), minified,
        "firmware locale compression must preserve every minified source byte");
      assert.ok(bytes.length < gzipBytes, "the pinned encoder must reduce the embedded locale");
      if (code === "de") {
        const second = encode();
        assert.equal(second.status, 0, second.stderr || second.stdout);
        assert.deepEqual(fs.readFileSync(packed), bytes, "locale encoding must be deterministic");
      }
    }
  }
  const bundle = path.join(work, "locale-bundle.js.gz");
  const metadata = path.join(work, "locale-bundle.json");
  const bundled = childProcess.spawnSync("python3", [
    path.join(root, "tools/web_asset/build_locale_bundle.py"),
    "--locale-dir", path.join(root, "main/www/locales"), "--locales", ...codes.slice(1),
    "--output", bundle, "--metadata", metadata, "--max-gzip-bytes", "289792",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(bundled.status, 0, bundled.stderr || bundled.stdout);
  bundleGzipTotal = fs.statSync(bundle).size;
  const manifest = JSON.parse(fs.readFileSync(metadata, "utf8"));
  assert.deepEqual(manifest.locales, codes.slice(1), "joint resource must include every external locale");
  assert.equal(manifest.bundle_gzip_bytes, bundleGzipTotal);
  assert.equal(manifest.sources.reduce((n, item) => n + item.source_gzip_bytes, 0),
    firmwareLocaleGzipTotal, "bundle quality gates must use the same per-file minifier and encoder");
  assert.ok(manifest.framed_bytes <= 1048576, "decoded locale frame must stay within 1 MiB");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
// Apply the existing 283 KiB flash-growth guard to the bytes actually embedded. Per-source 32 KiB
// quality caps, decoded-source parity (test_locale_bundle.mjs), and the signed image gate remain
// independent. A less efficient host-only zlib proxy no longer represents the firmware resource.
assert.ok(bundleGzipTotal <= 289792,
  `embedded locale bundle uses ${bundleGzipTotal} bytes and exceeds the 283 KiB growth guard`);
assert.ok(firmwareLocaleGzipTotal <= localeGzipTotal - 4096,
  "pinned per-source compression must recover at least one flash sector without dropping copy");
assert.ok(bundleGzipTotal <= firmwareLocaleGzipTotal - 4096,
  "joint locale delivery must recover at least one flash sector without dropping copy");

const cmake = fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8");
const status = fs.readFileSync(path.join(root, "main/http_status.cpp"), "utf8");
const server = fs.readFileSync(path.join(root, "main/http_server.cpp"), "utf8");
assert.match(cmake, /set\(UI_LOCALE_CODES de es fr it pl cs uk zh ja nb sv fi\)/);
assert.match(cmake, /set\(UI_LOCALE_GZIP_MAX_BYTES 32768\)/);
assert.match(cmake, /set\(UI_LOCALE_BUNDLE_MAX_BYTES 289792\)/);
assert.match(cmake, /"\$\{UI_LOCALE_BUNDLE_GZIP\}"/, "the joint locale resource must be embedded");
assert.doesNotMatch(cmake, /EMBED_FILES[\s\S]*\$\{UI_LOCALE_GZIP_FILES\}/,
  "individual quality-check artifacts must not also consume firmware flash");
assert.match(cmake, /--output "\$\{locale_gz\}"\s+--gzip-encoder zopfli/,
  "firmware locales must retain the pinned compression that fits the signed image");
assert.match(cmake, /DEPENDS "\$\{locale_src\}" "\$\{UI_LOCALE_MINIFIER\}" "\$\{UI_MINIFIER\}"/,
  "locale assets must rebuild when the shared JavaScript minifier changes");
for (const code of codes.slice(1)) {
  assert.match(status, new RegExp(`\\{"${code}", locale_bundle_js_gz_start, locale_bundle_js_gz_end\\}`),
    `${code} compressed asset is not routed`);
}
assert.match(status,
  /http_send_gzip\(req,\s*"text\/javascript; charset=utf-8",\s*asset\.start,\s*asset\.end\)/,
  "locale route must serve the checked gzip artifacts");
assert.match(status, /"\/locale\.js", HTTP_GET, h_locale/);
assert.match(server, /cfg\.max_uri_handlers = 40/);

console.log(`UI locales: ${codes.length} catalogs × ${englishKeys.length} keys; lazy assets bounded and routed`);
