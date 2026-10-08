import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const history = read("main/history.cpp");
const functionBody = (name, next) => history.slice(history.indexOf(name), history.indexOf(next,
  history.indexOf(name) + name.length));
for (const [name, next] of [
  ["void history_reset()", "void history_reset_on_detect"],
  ["void history_reset_on_detect", "void history_modbus_reset"],
  ["void history_modbus_reset", "uint32_t history_modbus_generation"],
  ["void history_circulation_reset", "void history_checkup_reset"],
]) {
  const body = functionBody(name, next);
  assert.match(body, /Lock lk\(s_mtx\)/, name + " reset must share the sample lock");
  assert.ok(body.indexOf("Lock lk(s_mtx)") < body.indexOf("bump_history_epoch()"),
    name + " changes the browser epoch inside the sample lock");
}
for (const name of ["size_t history_snapshot(", "size_t history_modbus_snapshot(",
  "size_t history_env3_snapshot("]) {
  const body = functionBody(name, "\nsize_t ");
  assert.ok(body.includes("uint32_t* epoch"));
  const lock = body.indexOf("Lock lk(s_mtx)");
  const capture = body.indexOf("*epoch = history_epoch()", lock);
  assert.ok(lock >= 0 && capture > lock && capture < body.indexOf(".snapshot(out, max)"),
    name + " captures the epoch before copying samples under the same lock");
}
const http = read("main/http_status.cpp");
assert.match(http, /&history_snapshot_epoch/);
assert.match(http, /std::to_string\(history_snapshot_epoch\)/);
assert.match(http, /history_snapshot_epoch != history_epoch\(\)/,
  "a reset during label/raster assembly must refuse the response before chunks");
// Epoch 0 is "no snapshot identity" (no history mutex or no lock), not a change a retry resolves.
assert.match(http,
  /if \(history_snapshot_epoch == 0\) \{[\s\S]{0,160}?history unavailable[\s\S]{0,200}?if \(history_snapshot_epoch != history_epoch\(\)\) \{[\s\S]{0,160}?history changed; retry/,
  "a missing snapshot identity must not be reported as a retryable history change");
assert.match(http, /reference_temperature_status\(c\)/,
  "status must bind the room sample to the same configuration snapshot");
assert.match(http, /circulation_source_status\(c\)/);
assert.equal((history.match(/circulation_generation = circulation_source_generation\(\)/g) || []).length, 2);
assert.match(history, /circulation_generation != circulation_source_generation\(\)\) return/);
assert.equal((history.match(/circulation_generation == circulation_source_generation\(\)/g) || []).length, 2,
  "mixed recording retains independent X10A rows but skips a retired circulation witness");
const checkup = read("main/checkup.cpp");
assert.match(checkup, /dhw_generation != s_dhw_identity_generation\.load\(\)/);
assert.match(checkup, /circulation_generation != circulation_source_generation\(\)/);
assert.match(checkup, /circulation_pump_sample\(\)/);
// Per-cycle poll/MQTT paths bind the witness by its applied epoch alone; a Config copy here would be
// permanent heap churn on every sweep.
assert.doesNotMatch(checkup, /config\(\)/, "checkup_record must not copy Config per cycle");
for (const [name, next] of [
  ["void history_record_circulation()", "\nvoid "],
  ["void history_record(const CachedValue*", "\nvoid "],
]) {
  assert.doesNotMatch(functionBody(name, next), /config\(\)/,
    name + " must not copy Config per cycle");
}

// ── The flash journal writer (HIST-01/a, HIST-02) ────────────────────────────────────────────────
// The rules are host-tested in logic/history_persist.hpp; these pin that the firmware still routes
// every decision through them, in an order the host suite cannot see.

// HIST-01/a: a source whose identity reset is still pending still holds the OLD unit's samples in
// its rings. The builder stamps the NEW scope, so it must refuse before it reaches the stamp —
// readers, splice and restore already do.
const builder = functionBody("bool flash_build_next_record_locked(", "bool flash_build_next_record(");
const x10aGuard = builder.search(
  /src == HistorySource::X10a\s*&&\s*\(s_x10a_target_fp\.load\(\)\s*==\s*0\s*\|\|\s*s_reset_requested\.load\(\)\)/);
const modbusGuard = builder.search(/src == HistorySource::Modbus\s*&&\s*s_mb_reset_requested\.load\(\)/);
const stamp = builder.indexOf("history_journal_set_scope(");
assert.ok(x10aGuard >= 0, "the builder must refuse X10A while its identity reset is pending");
assert.ok(modbusGuard >= 0, "the builder must refuse HomeHub while its identity reset is pending");
assert.ok(stamp > x10aGuard && stamp > modbusGuard,
  "both pending-reset guards must precede the scope stamp");

// HIST-02/a: the current manifest is the last one APPENDED. Comparing buckets made the manifest
// appended after a cursor reset (deliberately older) lose, and the writer then appended three
// manifests per poll tick forever.
const cacheAdd = functionBody("bool flash_manifest_cache_add(", "bool flash_trend_scope_matches(");
assert.match(cacheAdd, /logic::history_manifest_adopt\(/);
assert.doesNotMatch(cacheAdd, /bucket\s*>=/, "manifest adoption must not be ordered by bucket");
assert.match(functionBody("bool flash_manifest_due(", "bool flash_build_manifest_record("),
  /logic::history_manifest_due\(/);
assert.match(functionBody("esp_err_t flash_append_record_at(", "void flash_note_append_failure("),
  /flash_manifest_cache_add\(verify\)/, "an appended manifest is adopted from the read-back record");

// HIST-02/b: a cursor stamped beyond its clock is rewound by BOTH builders, and both restores
// re-index a future-stamped window before any record is read out of it.
assert.match(builder, /logic::history_cursor_in_future\(/);
assert.match(functionBody("bool flash_build_next_checkup_record(", "esp_err_t flash_append_record_at("),
  /logic::history_cursor_in_future\(/);
const reindexIf = (body, what) => {
  const at = body.indexOf("flash_reindex_if_future(");
  assert.ok(at >= 0, what + " must re-index a future-stamped window");
  return at;
};
const trendRestore = functionBody("void history_service_flash_restore()",
  "static size_t history_flash_service_journal(");
assert.ok(reindexIf(trendRestore, "the trend restore") < trendRestore.indexOf("flash_read_record("),
  "the trend restore must re-index before reading records");
const checkupRestore = functionBody("static void history_restore_checkup_flash()",
  "// Restore at most four rings");
assert.ok(reindexIf(checkupRestore, "the diagnostic restore") <
  checkupRestore.indexOf("records[count++]"),
  "the diagnostic restore must re-index before it fills the shared scratch");
// The re-index runs on the poll task: it reads through the static scratch, not a second stack record.
const reindex = functionBody("bool flash_reindex_source(", "// Pass 1 finds");
assert.doesNotMatch(reindex, /FlashJournalRecord\s+\w+\s*;/,
  "the re-index must not put a 256-byte record on the poll task's stack");
// The boot scan and the re-index share ONE window rule.
assert.match(functionBody("bool flash_journal_scan()", "esp_err_t flash_region_erased("),
  /logic::history_window_index_offer\(/);
assert.match(reindex, /logic::history_window_index_offer\(/);

// HIST-02/c: a failing slot is accounted per slot, abandoned after the retry limit and logged per
// episode — the service loop itself must not print a line for every failed tick.
assert.match(functionBody("void flash_note_append_failure(", "void flash_note_append_success("),
  /logic::history_journal_slot_after_failure\(/);
assert.match(functionBody("esp_err_t flash_append_record(FlashJournalRecord& r) {",
  "bool flash_reindex_if_future("), /flash_note_append_failure\(/);
const service = functionBody("static size_t history_flash_service_journal(size_t max_records, TickType_t wait_ticks) {",
  "void history_flash_save()");
assert.doesNotMatch(service, /append failed/, "append failures are logged once per episode, not per tick");
assert.match(service, /flash_append_record\(r\)\s*!=\s*ESP_OK\)\s*return written/,
  "a failed append still ends the tick early");

console.log("history snapshot epoch, epoch-bound circulation admission and journal writer contracts pass");
