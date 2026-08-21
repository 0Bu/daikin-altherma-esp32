// Mutation tests for the localization gate. A green checker is only evidence when it still rejects
// changed source copy without refreshed locales, omitted specialist/domain tables, and reordered
// positional copy whose row count alone still looks complete.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-ui-localization-"));
const test = path.join(root, "test/test_ui_locale_catalogs.mjs");

function copy(relative) {
  const from = path.join(root, relative), to = path.join(work, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function run() {
  return childProcess.spawnSync(process.execPath, [test], {
    cwd: root,
    env: { ...process.env, DAIKIN_UI_ROOT: work },
    encoding: "utf8",
  });
}

try {
  for (const relative of ["main/www", "main/CMakeLists.txt", "main/http_status.cpp",
    "main/http_server.cpp", "tools/web_asset"]) copy(relative);

  let result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log("ok: current translation source and all locale packs agree");

  const i18n = path.join(work, "main/www/js/i18n.js");
  const originalI18n = fs.readFileSync(i18n, "utf8");
  const changedI18n = originalI18n.replace('"No data"', '"No current data"');
  assert.notEqual(changedI18n, originalI18n, "source-copy mutation did not apply");
  fs.writeFileSync(i18n, changedI18n);
  result = run();
  assert.notEqual(result.status, 0, "gate accepted edited English copy without locale review");
  assert.match(`${result.stdout}\n${result.stderr}`, /translation source is stale/);
  console.log("ok: changed canonical copy requires every locale to be reviewed again");
  fs.writeFileSync(i18n, originalI18n);

  const spanish = path.join(work, "main/www/locales/es.js");
  const originalSpanish = fs.readFileSync(spanish, "utf8");
  const changedSpanish = originalSpanish.replace("DESCRIPTION_I18N.es =", "DESCRIPTION_I18N.missing_es =");
  assert.notEqual(changedSpanish, originalSpanish, "specialist-copy mutation did not apply");
  fs.writeFileSync(spanish, changedSpanish);
  result = run();
  assert.notEqual(result.status, 0, "gate accepted a locale without value descriptions");
  assert.match(`${result.stdout}\n${result.stderr}`, /es value-description copy did not register itself/);
  console.log("ok: a compact catalog without specialist copy is rejected");
  fs.writeFileSync(spanish, originalSpanish);

  const japanese = path.join(work, "main/www/locales/ja.js");
  const originalJapanese = fs.readFileSync(japanese, "utf8");
  const changedJapanese = originalJapanese.replace(
    /([^\n]+\/\/ 7H\n)([^\n]+\/\/ 80\n)/,
    "$2$1",
  );
  assert.notEqual(changedJapanese, originalJapanese, "fault-order mutation did not apply");
  fs.writeFileSync(japanese, changedJapanese);
  result = run();
  assert.notEqual(result.status, 0, "gate accepted reordered positional fault-code copy");
  assert.match(`${result.stdout}\n${result.stderr}`, /fault-code translations are not in canonical DAIKIN order/);
  console.log("ok: reordered positional fault-code copy is rejected");
  fs.writeFileSync(japanese, originalJapanese);

  const chinese = path.join(work, "main/www/locales/zh.js");
  const originalChinese = fs.readFileSync(chinese, "utf8");
  const changedChinese = originalChinese.replace("FAULT_CODE_I18N.zh =", "FAULT_CODE_I18N.missing_zh =");
  assert.notEqual(changedChinese, originalChinese, "lazy fault-pack mutation did not apply");
  fs.writeFileSync(chinese, changedChinese);
  result = run();
  assert.notEqual(result.status, 0, "gate accepted a lazy locale without fault-code copy");
  assert.match(`${result.stdout}\n${result.stderr}`, /zh must register all fault-code meanings/);
  console.log("ok: a lazy locale without fault-code copy is rejected");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("UI localization selftest: every seeded omission was caught");
