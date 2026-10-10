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

// HIST-02/b: a cursor (or restore window) stamped beyond its clock is REPORTED and never acted on.
// The journal cannot tell a wrong far-future boot from a wrong PAST clock now, and on a mature
// journal there are always believable records below a wrong past clock, so a re-index or rewind
// publishes them, the writer appends the live window under wrong buckets, and the next correctly
// synchronised boot hides the genuine newest records. Both builders only report (to the journal
// service, which logs outside s_mtx); the restores only log; nothing rewinds or walks the journal.
const checkupBuilder = functionBody("bool flash_build_next_checkup_record(",
  "esp_err_t flash_append_record_at(");
for (const [what, body] of [["trend", builder], ["checkup", checkupBuilder]]) {
  assert.match(body,
    /logic::history_cursor_in_future\([^;]*logic::HISTORY_CURSOR_FUTURE_SLACK_BUCKETS\)/,
    "the " + what + " builder tests its cursor with the anchor slack");
  assert.match(body, /note\.future\s*=\s*true/, "the " + what + " builder reports a future cursor");
  assert.doesNotMatch(body, /diag_printf/, "the " + what + " builder must not log from a builder");
  assert.doesNotMatch(body, /s_flash_(?:last|newest|oldest)_bucket\[[^\]]*\]\s*=(?!=)/,
    "the " + what + " builder must not rewind or move any cursor");
}
// The detection is reported only for the source whose clock it was compared with.
assert.match(builder, /note\.bound\s*=\s*anchor/, "the trend builder bounds by the live anchor");
assert.match(checkupBuilder, /note\.bound\s*=\s*wall_bucket/,
  "the checkup builder bounds by the wall hour bucket");
const forService = functionBody("bool flash_build_for_service(", "} // namespace");
assert.match(forService, /flash_build_next_checkup_record\(r,\s*wait_ticks,\s*note\)/);
assert.match(forService,
  /flash_build_next_record\(static_cast<HistorySource>\(src_i\),\s*r,\s*wait_ticks,\s*note\)/);
assert.match(forService, /flash_note_cursor_ahead\(src_i,\s*note\)/,
  "the service reports a future cursor once the builder has returned");
assert.doesNotMatch(forService, /\bs_mtx\b/, "the report must not run under the history mutex");
// Nothing of the retired re-index/rewind machinery may remain anywhere in the file: no journal
// walk, no republished window, no second window rule beside the boot scan, no cursor rewind.
assert.doesNotMatch(history,
  /flash_reindex|flash_publish_window|flash_rewind_cursor|history_reindex_|history_window_index_offer|s_flash_reindex_spent|may_reindex|FlashReindex|s_flash_valid_records/,
  "records beyond the clock are reported, never re-indexed or rewound");
// A cursor field is assigned INT64_MIN only by the boot scan's initialisation, the identity resets
// and the factory forget. Anywhere else would be a rewind.
const cursorReset = /s_flash_(?:last|newest|oldest)_bucket\[[^\]]*\]\s*=\s*INT64_MIN\s*;/g;
const countResets = (text) => (text.match(cursorReset) || []).length;
const resetOwners = [
  functionBody("void history_reset()", "void history_reset_on_detect"),
  functionBody("void history_reset_on_detect", "void history_modbus_reset"),
  functionBody("void history_modbus_reset", "uint32_t history_modbus_generation"),
  functionBody("void history_checkup_reset", "// The BOARD's own 24-hour trends"),
  functionBody("bool flash_journal_scan()", "esp_err_t flash_region_erased("),
  functionBody("bool history_flash_forget()", "static void history_flash_start()"),
];
assert.equal(countResets(history), resetOwners.reduce((n, body) => n + countResets(body), 0),
  "a cursor is reset to INT64_MIN only by the scan, the identity resets and the factory forget");
// The cursor fields are otherwise written from the record just appended (and by the scan).
const appendAt = functionBody("esp_err_t flash_append_record_at(", "// One sector is abandoned");
assert.match(appendAt, /s_flash_last_bucket\[src\]\s*=\s*r\.header\.bucket/);
const trendRestore = functionBody("void history_service_flash_restore()",
  "static size_t history_flash_service_journal(");
const checkupRestore = functionBody("static void history_restore_checkup_flash()",
  "// Restore at most four rings");
for (const [what, body] of [["trend", trendRestore], ["diagnostic", checkupRestore]]) {
  assert.match(body, /flash_note_restore_ahead\(/, "the " + what + " restore reports a future window");
  assert.doesNotMatch(body, /s_flash_(?:last|newest|oldest)_bucket\[[^\]]*\]\s*=(?!=)|s_flash_restore_slot(?:s|_count)\[[^\]]*\](?:\[[^\]]*\])?\s*=(?!=)/,
    "the " + what + " restore must not move the cursor or rebuild the index");
}
// The report latches. The writer's latch is cleared ONLY by a successful DATA append: the anchor
// jitters by one bucket, so releasing it on a "not ahead" observation would make the line flap.
const noteAhead = functionBody("void flash_note_cursor_ahead(", "// The restore's counterpart");
assert.match(noteAhead, /if \(s_flash_ahead_logged\[src_i\]\) return;[\s\S]*s_flash_ahead_logged\[src_i\]\s*=\s*true;[\s\S]*diag_printf\(/,
  "the writer's report is logged once per episode");
const releases = history.match(/s_flash_ahead_logged\[[^\]]*\]\s*=\s*false/g) || [];
assert.equal(releases.length, 1, "exactly one site releases the writer's latch");
const appendFn = functionBody("esp_err_t flash_append_record(FlashJournalRecord& r) {",
  "// Log, once per source and episode");
assert.match(appendFn,
  /flash_note_append_success\(slot\);[\s\S]*if \(!flash_is_manifest\(r\.header\)\) s_flash_ahead_logged\[r\.header\.source\] = false;/,
  "the latch is released by a successful data append, not by a manifest or an observation");
const noteRestore = functionBody("void flash_note_restore_ahead(", "// The next record of source");
assert.match(noteRestore, /s_flash_restore_ahead_logged\[src_i\]\s*\|\|\s*!logic::history_cursor_in_future\(newest,\s*wall_bucket\)/,
  "the restore's report compares the indexed newest bucket with the wall bucket, without slack");
assert.equal((history.match(/s_flash_restore_ahead_logged\[[^\]]*\]\s*=\s*false/g) || []).length, 0,
  "the restore's report is once per source and boot");

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
  /slot != s_flash_fail_slot\)\s*\{[\s\S]{0,800}?s_flash_fail_slot != SIZE_MAX\)\s*flash_count_abandoned_sector\(s_flash_fail_slot,\s*slot\)/,
  "a cursor that moved to another sector between two failures counts as an abandoned sector");
// Both paths count through ONE helper, which logs the first abandon of an episode: the torn jump
// used to count silently, so an episode that began with one never printed the line.
assert.match(noteFailure, /flash_count_abandoned_sector\(slot,\s*step\.next_slot\)/,
  "the explicit skip counts through the same helper");
assert.doesNotMatch(noteFailure, /s_flash_fail_skipped\+\+/,
  "no path counts an abandoned sector without the helper that logs the first one");
const countAbandon = functionBody("void flash_count_abandoned_sector(",
  "// An append failed at `slot`.");
assert.match(countAbandon,
  /s_flash_fail_skipped\+\+;\s*if \(s_flash_fail_skipped == 1\)\s*diag_printf\(\s*"history: journal abandoned the sector/,
  "the first abandoned sector of an episode is logged whichever path found it");
assert.match(functionBody("esp_err_t flash_append_record(FlashJournalRecord& r) {",
  "bool flash_build_for_service("), /flash_note_append_failure\(/);
// The paused-retry throttle is only as good as its clock. The pure gate (history_journal_retry_due)
// is host-tested with its own model of the last attempt; what the host suite cannot see is that the
// firmware STAMPS that time. Without the stamp the last attempt stays INT64_MIN, the gate is due on
// every tick, and a paused episode re-reads, re-erases and re-programs the same sector once per poll
// tick for good — the flash churn the pause exists to prevent, only without the log spam.
const pausedAt = noteFailure.indexOf("if (step.paused) {");
const pausedReturn = noteFailure.indexOf("return;", pausedAt);
assert.ok(pausedAt >= 0 && pausedReturn > pausedAt, "the paused branch of the failure note");
// EVERY paused failure must stamp, not only the first one: the stamp is the branch's first
// statement, ahead of the first-pause-only block, or later paused failures never refresh the time
// and the gate is due on every tick from one period after the pause.
assert.match(noteFailure.slice(pausedAt, pausedReturn),
  /^if \(step\.paused\) \{\s*s_flash_fail_last_us\s*=\s*esp_timer_get_time\(\)\s*;\s*if \(!s_flash_fail_paused\)/,
  "every paused failure stamps the attempt time first, before the first-pause-only block");
assert.match(functionBody("void flash_note_append_success(", "esp_err_t flash_append_record(FlashJournalRecord& r) {"),
  /s_flash_fail_last_us\s*=\s*INT64_MIN\s*;/,
  "a successful append ends the pause episode and clears the attempt time");
// The service hands the gate the flag, the current time and THAT stamp, in this order.
assert.match(history,
  /logic::history_journal_retry_due\(\s*s_flash_fail_paused,\s*esp_timer_get_time\(\),\s*s_flash_fail_last_us\s*\)/,
  "the service gates a paused journal on the stamped attempt time");
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
assert.match(service, /flash_build_for_service\(src_i, r, wait_ticks\)/);
// The shutdown drain is the same bounded final flush as before: no journal walk exists any more.
assert.match(functionBody("void history_flash_save()", "// The factory reset"),
  /history_flash_service_journal\(\s*\/\*max_records=\*\/12,\s*pdMS_TO_TICKS\(200\)\)/);

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

// ── HIST-01: the durable identity of what a stored sample means ──────────────────────────────────
// The rules are host-tested in logic/history_persist.hpp and logic/history.hpp; these pin that the
// firmware still routes every decision through them, in an order the host suite cannot see.
const persistHeader = read("main/logic/history_persist.hpp");
const hpPoll = read("main/hp_poll.cpp");
const httpConfig = read("main/http_config.cpp");
const historyHeader = read("main/history.hpp");
const mqttHa = read("main/mqtt_ha.cpp");

// HIST-01/b: a circulation remap or consent change is DURABLE. The sealed region carries the
// identity of the ring it holds; flash records carry the identity of the circulation column; the
// restore and the splice honour it. Without any one of these a later restore splices the retired
// witness's samples back (the defect: RAM-only reset, journal untouched).
assert.match(persistHeader, /HISTORY_PERSIST_VERSION\s*=\s*3\s*;/,
  "the .noinit layout gained a sealed field: the persist version must move off 2");
assert.match(history, /uint32_t circulation_fp;/, "the sealed region names the circulation identity");
assert.match(functionBody("inline uint32_t persist_crc()", "// Called at the end of every record cycle"),
  /&P\(\)\.circulation_fp/, "the seal must cover the circulation identity it is compared with");
assert.match(functionBody("inline void persist_wipe(", "uint32_t current_mb_target_fp()"),
  /P\(\)\.circulation_fp\s*=\s*circulation_fp/);
// The ring's identity follows its reset, not the request: it is the identity of what the ring HOLDS.
{
  const body = functionBody("inline void reset_circulation_locked(", "inline void fold_circulation_locked(");
  assert.match(body, /s_circulation_reset_requested\.exchange\(false\)/);
  assert.match(body, /P\(\)\.circulation_fp\s*=\s*s_circulation_fp\.load\(\)/,
    "consuming a circulation reset moves the ring's identity to the requested one");
  assert.ok(body.indexOf("reset_with_gaps") < body.indexOf("P().circulation_fp ="),
    "the identity moves with the reset, after the old samples are gone");
}
// A reset request publishes the NEW identity (derived from the saved configuration, outside the
// history lock) together with its deferred reset, under the one mutex the folds share.
{
  const body = functionBody("void history_circulation_reset", "void history_checkup_reset");
  assert.match(body, /with_config\(\s*\[\]\(const Config& c\)\s*\{\s*return logic::history_circulation_identity\(c\);\s*\}\)/,
    "the identity is derived from the live configuration by the pure rule");
  const lock = body.indexOf("Lock lk(s_mtx)");
  assert.ok(body.indexOf("with_config(") >= 0 && body.indexOf("with_config(") < lock,
    "the config mutex is taken and released before the history lock");
  assert.ok(lock < body.indexOf("s_circulation_fp.store(identity)") &&
            body.indexOf("s_circulation_fp.store(identity)") < body.indexOf("s_circulation_reset_requested.store(true)") &&
            body.indexOf("s_circulation_reset_requested.store(true)") < body.indexOf("bump_history_epoch()"),
    "identity and pending flag are published together under the history lock");
}
// Startup: the sealed ring's identity is compared with the configured one on an adopted RAM image,
// and a mismatch drops ONLY the circulation ring; a wiped start records the configured identity.
{
  const body = functionBody("void history_start()", "const char* history_persist_state()");
  assert.match(body, /want_circulation_fp\s*=\s*logic::history_circulation_identity\(boot_config\)/);
  assert.match(body, /s_circulation_fp\.store\(want_circulation_fp\)/);
  const mismatch = body.search(/if \(P\(\)\.circulation_fp != want_circulation_fp\) \{/);
  assert.ok(mismatch >= 0, "an adopted image is compared with the configured witness identity");
  const block = body.slice(mismatch, body.indexOf("persist_adopt(", mismatch));
  assert.match(block, /if \(!circulation_trend\(logic::TRENDS\[t\]\)\) continue;/,
    "only the circulation ring is retired by an identity mismatch");
  assert.doesNotMatch(block, /mb_ring|env3_ring|x10a_target_fp/);
  assert.match(block, /P\(\)\.circulation_fp\s*=\s*want_circulation_fp/);
  assert.match(body, /persist_wipe\(want_fp,[^;]*want_circulation_fp\)/);
  assert.match(functionBody("bool history_flash_forget()", "static void history_flash_start()"),
    /persist_wipe\([^;]*s_circulation_fp\.load\(\)\)/);
}
// Writer: an X10A record names the identity of the circulation ring it was assembled from — the
// RING's identity (sealed, moves at the consumed reset), never the requested one — after the
// pending-reset guards that already stop the scope being stamped over an old unit's samples.
{
  const stampAt = builder.indexOf("history_journal_set_circulation_identity(");
  assert.ok(stampAt > x10aGuard && stampAt > modbusGuard, "the identity is stamped after the guards");
  assert.match(builder, /history_journal_set_circulation_identity\(h,\s*P\(\)\.circulation_fp\)/);
  assert.doesNotMatch(builder, /history_journal_set_circulation_identity\(h,\s*s_circulation_fp/,
    "stamping the REQUESTED identity would label the retired witness's samples as the new one's");
  const x10aBranch = builder.slice(builder.indexOf("if (src == HistorySource::X10a) {"), stampAt);
  assert.match(x10aBranch, /history_journal_set_scope\(h,\s*s_x10a_target_fp\.load\(\)\)/,
    "the identity is part of the X10A branch only");
  assert.equal((history.match(/history_journal_set_circulation_identity\(/g) || []).length, 1,
    "only the X10A data record carries the identity; manifests, HomeHub and ENV III keep it erased");
}
// Restore: the identity is read ONCE per batch, gates the circulation COLUMN per record through the
// pure rule, a block no record fed is not spliced, and the splice re-checks under the lock.
{
  assert.match(trendRestore, /circ_now\s*=\s*s_circulation_fp\.load\(\)/);
  assert.match(trendRestore, /circ_pending\s*=\s*s_circulation_reset_requested\.load\(\)/);
  assert.match(trendRestore,
    /if \(x10a && !logic::history_x10a_column_restorable\(\s*first_idx \+ b,\s*record_circulation,\s*circ_now,\s*circ_pending\)\)\s*continue;/,
    "every column of every record goes through the pure per-column rule, and a refusal skips it");
  assert.match(trendRestore,
    /history_journal_circulation_identity\(r\.header\)/, "the record's own stamp is what is compared");
  assert.ok(trendRestore.indexOf("circ_now") < trendRestore.indexOf("flash_read_record("),
    "the identity is read before any record, not per record");
  assert.match(trendRestore, /!circ_fed\[b\]\)\s*continue;/, "an unfed circulation block is not spliced");
  assert.match(trendRestore, /history_splice_snapshot\([^;]*circ_now\)/,
    "the splice is told which identity the block was assembled for");
  const splice = functionBody("static bool history_splice_snapshot(", "size_t history_label(");
  const guardAt = splice.search(/history_trend_is_circulation\(idx\)/);
  assert.ok(guardAt >= 0 && guardAt < splice.indexOf("splice_locked("),
    "the circulation guard precedes the splice");
  assert.match(splice,
    /!logic::history_circulation_restore_allowed\(circulation_identity,\s*P\(\)\.circulation_fp,\s*s_circulation_reset_requested\.load\(\)\)\)\s*return false;/,
    "the splice refuses while a reset is pending AND when the ring's identity is not the block's");
}
// The identity is never read from the live configuration on the sample hot paths.
assert.doesNotMatch(functionBody("static bool history_splice_snapshot(", "size_t history_label("), /config\(\)/);

// HIST-01/d: the X10A scope takes no input from the trend catalog or from a profile's rows. It stamps
// every X10A record as a whole, so an input that moved with a TRENDS insertion, reorder or decode fix
// would discard every X10A series on each such change (the value itself is pinned in test_logic.cpp).
// Detection and a manual /set_hp derive it through ONE function, and that function hands the four
// plain inputs to the pure fingerprint and nothing else.
assert.match(hpPoll, /identity_fp\s*=\s*history_x10a_identity\(/);
assert.match(httpConfig, /x10a_identity_fp\s*=\s*history_x10a_identity\(/);
for (const [name, text] of [["hp_poll.cpp", hpPoll], ["http_config.cpp", httpConfig], ["mqtt_ha.cpp", mqttHa],
                            ["http_status.cpp", http]])
  assert.doesNotMatch(text, /history_x10a_target_fingerprint\(/,
    name + " must derive the X10A scope through history_x10a_identity()");
{
  const body = functionBody("uint32_t history_x10a_identity(", "void history_reset()");
  assert.match(body, /return logic::history_x10a_target_fingerprint\(profile,\s*rx_pin,\s*tx_pin,\s*proto\);/,
    "the scope is the pure fingerprint of profile, pins and protocol");
  assert.doesNotMatch(body, /TRENDS|TREND_COUNT|def::|decode/, "no catalog or row input reaches the scope");
  assert.match(historyHeader, /uint32_t history_x10a_identity\(/);
}
assert.equal((history.match(/history_x10a_target_fingerprint\(/g) || []).length, 1,
  "history_x10a_identity is the only caller of the bare scope fingerprint");
{
  const at = persistHeader.indexOf("inline uint32_t history_x10a_target_fingerprint(");
  assert.ok(at >= 0, "the scope fingerprint");
  const body = persistHeader.slice(at, persistHeader.indexOf("\n}\n", at));
  assert.match(body, /history_fp_str\(crc,\s*profile\)/);
  assert.doesNotMatch(body, /TRENDS|TREND_COUNT|history_series_id|history_catalog_fingerprint|decode/,
    "the X10A scope must not read the trend catalog or a decode contract");
  assert.doesNotMatch(persistHeader, /history_x10a_decode_fingerprint|decode_fp/);
}

// HIST-01/e: the newest-sample age and sample zero's bucket leave the snapshot's own critical
// section; the standalone getters (each a second lock round-trip) are gone.
for (const name of ["history_newest_age_s", "history_modbus_newest_age_s", "history_env3_newest_age_s",
                    "history_oldest_bucket", "history_modbus_oldest_bucket", "history_env3_oldest_bucket",
                    "oldest_bucket_under_lock"])
  for (const [file, text] of [["history.cpp", history], ["history.hpp", historyHeader],
                              ["http_status.cpp", http]])
    assert.doesNotMatch(text, new RegExp("\\b" + name + "\\b"),
      file + " still names " + name + ": a separate getter reads outside the snapshot's lock");
for (const [name, next, ring, commit] of [
  ["size_t history_snapshot(", "\nsize_t ", "P().ring[t].ring", "s_last_commit_us, s_last_commit_bucket"],
  ["size_t history_modbus_snapshot(", "\nsize_t ", "P().mb_ring[t]", "s_mb_last_commit_us, s_mb_last_commit_bucket"],
  ["size_t history_env3_snapshot(", "\n// Copied out under the lock", "P().env3_ring[t]", "s_env3_last_commit_us, s_env3_last_commit_bucket"],
]) {
  const body = functionBody(name, next);
  assert.match(body, /logic::HistoryMeta\* meta/);
  const lock = body.indexOf("Lock lk(s_mtx)");
  const copy = body.indexOf(ring);
  const meta = body.indexOf("fill_snapshot_meta_locked(meta, " + commit);
  assert.ok(lock >= 0 && copy > lock && meta > copy,
    name + " fills the meta after copying, under the same lock");
  assert.ok(body.indexOf("return n;", meta) > meta, name + " returns after the meta is filled");
  assert.doesNotMatch(body.slice(meta), /Lock /, name + " takes no second lock for the meta");
  // The route's HistoryMeta is function-static: an early return that skipped the clear would hand the
  // previous request's bucket to an empty or absent series, a time axis for data that is not there.
  const clear = body.indexOf("clear_snapshot_meta(meta);");
  const firstReturn = body.search(/\breturn\b/);
  assert.ok(clear >= 0 && firstReturn > clear,
    name + " clears the meta before its first early return");
}
{
  const routeAt = http.indexOf("static esp_err_t h_history(");
  const route = http.slice(routeAt, http.indexOf("static esp_err_t h_diag(", routeAt));
  assert.ok(routeAt >= 0 && route.length > 200, "the /history route body");
  assert.match(route, /logic::HistoryMeta\s+history_meta;/);
  assert.equal((route.match(/&history_meta\)/g) || []).length, 3, "all three sources hand their meta back");
  assert.match(route, /newest_age\s*=\s*history_meta\.newest_age_s/);
  assert.match(route, /b0\s*=\s*history_meta\.oldest_bucket/);
}

console.log("history snapshot epoch, epoch-bound circulation admission, journal writer and durable identity contracts pass");
