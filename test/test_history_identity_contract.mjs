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
const builder = functionBody("bool flash_build_next_record(", "bool flash_manifest_due(");
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
// No comparison of any kind may involve the record's bucket in the adoption path: the order is the
// append sequence, decided inside the helper.
assert.doesNotMatch(cacheAdd, /(?:[<>]=?|[=!]=)\s*h\.bucket|h\.bucket\s*(?:[<>]=?|[=!]=)/,
  "manifest adoption must not be ordered by bucket");
assert.match(functionBody("bool flash_manifest_due(", "bool flash_build_manifest_record("),
  /logic::history_manifest_due\(/);
assert.match(functionBody("esp_err_t flash_append_record_at(", "void flash_note_append_failure("),
  /flash_manifest_cache_add\(verify\)/, "an appended manifest is adopted from the read-back record");

// HIST-02/b: a cursor stamped beyond its clock is REPORTED by both builders — never rewound, never
// walked, never logged from there (the trend builder holds s_mtx, and rewinding to "nothing
// journalled" assumed the CURRENT clock is the right one). The journal service decides, outside
// s_mtx, by walking the journal below the clock; both restores re-index a future-stamped window
// before any record is read out of it.
const checkupBuilder = functionBody("bool flash_build_next_checkup_record(",
  "esp_err_t flash_append_record_at(");
for (const [what, body] of [["trend", builder], ["checkup", checkupBuilder]]) {
  assert.match(body, /logic::history_cursor_in_future\(/, "the " + what + " builder tests its cursor");
  assert.match(body, /note\.future\s*=\s*true/, "the " + what + " builder reports a future cursor");
  assert.doesNotMatch(body,
    /flash_rewind_cursor|flash_reindex|flash_publish_window|diag_printf|s_flash_last_bucket\[[^\]]*\]\s*=[^=]/,
    "the " + what + " builder must not rewind, walk or log a future cursor");
}
const forService = functionBody("bool flash_build_for_service(", "} // namespace");
assert.match(forService, /flash_build_next_checkup_record\(\s*r,\s*wait_ticks,\s*note\)/);
assert.match(forService,
  /flash_build_next_record\(\s*static_cast<HistorySource>\(src_i\),\s*r,\s*wait_ticks,\s*note\)/);
assert.match(forService, /flash_reindex_if_future\(/, "the service walks the journal for a future cursor");
assert.doesNotMatch(forService, /\bs_mtx\b/, "the walk must not run under the history mutex");
// The walk REPLACES the index and the cursor only when it met a believable record. Publishing an
// empty window on a wrong PAST clock put the cursor at INT64_MIN, the writer appended the live
// window under the wrong buckets, and those became the head that hides the genuine ones.
const reindex = functionBody("FlashReindex flash_reindex_source(", "// The one place a source's cursor");
const reindexIfBody = functionBody("FlashReindex flash_reindex_if_future(", "// Pass 1 finds");
assert.match(reindex, /logic::history_reindex_publishes\(/);
assert.ok(reindex.indexOf("history_reindex_publishes(") < reindex.indexOf("flash_publish_window(src, w)"),
  "the window is published only after the believable-record test");
assert.doesNotMatch(reindex, /flash_publish_window\(src,\s*logic::HistoryWindowIndex\s*\{\s*\}/,
  "a re-index must never publish an empty window");
assert.match(reindexIfBody, /logic::history_reindex_step\(/);
assert.ok(reindexIfBody.indexOf("HistoryReindexStep::Wait") < reindexIfBody.indexOf("flash_reindex_source("),
  "a source that was walked and has nothing believable waits instead of walking every tick");
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
assert.doesNotMatch(reindex, /FlashJournalRecord\s+\w+\s*;/,
  "the re-index must not put a 256-byte record on the poll task's stack");
// The boot scan and the re-index share ONE window rule.
assert.match(functionBody("bool flash_journal_scan()", "esp_err_t flash_region_erased("),
  /logic::history_window_index_offer\(/);
assert.match(reindex, /logic::history_window_index_offer\(/);

// HIST-02/c: a failing slot is accounted per slot, abandoned after the retry limit and logged per
// episode — the service loop itself must not print a line for every failed tick. One episode may
// abandon only a few sectors (every landing sector is erased: an unbounded sweep erased the whole
// retained history), after which the writer pauses and retries once a minute.
const noteFailure = functionBody("void flash_note_append_failure(", "void flash_note_append_success(");
assert.match(noteFailure, /logic::history_journal_failure_step\(/);
assert.match(noteFailure, /step\.paused/);
// flash_prepare_next_slot can move the cursor to the next sector by itself (a slot that was
// programmed but never committed): that abandons a sector too and counts against the same budget.
assert.match(noteFailure,
  /slot != s_flash_fail_slot\)\s*\{[\s\S]{0,800}?s_flash_fail_slot != SIZE_MAX[\s\S]{0,160}?s_flash_fail_skipped\+\+/,
  "a cursor that moved to another sector between two failures counts as an abandoned sector");
assert.match(functionBody("esp_err_t flash_append_record(FlashJournalRecord& r) {",
  "bool flash_build_for_service("), /flash_note_append_failure\(/);
// The service definition (the forward declaration at the top has no body).
const serviceAt = history.search(/static size_t history_flash_service_journal\([^;{]*\)\s*\{/);
assert.ok(serviceAt >= 0, "history_flash_service_journal definition found");
const service = history.slice(serviceAt, history.indexOf("void history_flash_save()", serviceAt));
assert.doesNotMatch(service, /append failed/, "append failures are logged once per episode, not per tick");
assert.match(service, /flash_append_record\(r\)\s*!=\s*ESP_OK\)\s*return written/,
  "a failed append still ends the tick early");
assert.match(service, /logic::history_journal_retry_due\(/, "a paused journal retries at most once a minute");
assert.ok(service.indexOf("history_journal_retry_due(") < service.indexOf("flash_build_for_service("),
  "the pause gate precedes every build and append attempt");
assert.match(service, /flash_build_for_service\(src_i, r, wait_ticks, may_reindex\)/);
// The shutdown drain is a bounded final flush: it never starts a journal walk.
assert.match(functionBody("void history_flash_save()", "// The factory reset"),
  /reindex=\*\/\s*false/);

// HIST-02/d: a source whose identity reset is pending is stepped OVER. Returning at its first ring
// left the restore unfinished for good (a disabled HomeHub never consumes its reset), and the
// journal service appends nothing for any source until the restore is done.
const pendingAt = trendRestore.indexOf("s_reset_requested.load()");
const pendingEnd = trendRestore.indexOf("const size_t source_rings");
assert.ok(pendingAt >= 0 && pendingEnd > pendingAt, "the pending-reset branch of the restore");
const pending = trendRestore.slice(pendingAt, pendingEnd);
assert.match(pending, /s_mb_reset_requested\.load\(\)/);
assert.match(pending, /flash_restore_advance_to\(\s*logic::history_restore_next_source_ring\(/,
  "a pending identity reset must advance the restore to the next source");
assert.doesNotMatch(pending, /\)\)\s*return;/, "a pending identity reset must not stall the restore");
assert.ok(pending.indexOf("flash_restore_advance_to(") < pending.lastIndexOf("return;"),
  "the pending-reset branch advances before it returns");

console.log("history snapshot epoch, epoch-bound circulation admission and journal writer contracts pass");
