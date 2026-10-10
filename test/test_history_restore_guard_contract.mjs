import assert from "node:assert/strict";
import fs from "node:fs";

// The age guards of the .noinit restore (HIST-03). The rules are host-tested in
// logic/history_persist.hpp and logic/checkup_persist.hpp; test_logic.cpp can prove what they
// decide but not that the firmware still feeds them the facts, in the order that makes them true.
// These pin the wiring: which inputs the boot verdict receives, where the sealed counter moves,
// where the liveness record is written, and that the poll task signs it on every cycle. The fix
// round adds three more: which rasters are weighed (and that an unmeasurable optional one retires
// alone), that adoption books the unobserved stretch and claims the raster boundary, and that the
// checkup keeps its DHW handoff across a not_committed refusal. The second round: a stall the
// liveness record measures is BOOKED (no staleness bound is left), the rounding remainder is
// carried in a sealed field, the boot line reports only what was booked, and the journal writer
// does not file the newest adopted sample twice.

const raw = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
// Code only, one space between tokens: a comment must neither satisfy nor break an assertion, and
// the formatter is free to re-wrap a call.
const code = (file) => raw(file).replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ");
const history = code("main/history.cpp");
const checkup = code("main/checkup.cpp");
const poll = code("main/hp_poll.cpp");
const persist = raw("main/logic/history_persist.hpp");
const persistCheckup = raw("main/logic/checkup_persist.hpp");

// The text from `signature` to the brace that closes the block it opens.
const body = (text, signature) => {
  const at = text.indexOf(signature);
  assert.ok(at >= 0, "missing: " + signature);
  const open = text.indexOf("{", at + signature.length - (signature.endsWith("{") ? 1 : 0));
  assert.ok(open > at, "no block after: " + signature);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(at, i + 1);
  }
  assert.fail("unbalanced block after: " + signature);
};
const count = (text, re) => (text.match(re) || []).length;

// ── a) boot: the verdict receives all three facts, and judges the OLD liveness record ───────────
const start = body(history, "void history_start()");
assert.match(start, /const bool safe = safe_mode_active\(\);/,
  "history_start must read the latched safe mode");
const verdictCall = start.slice(start.indexOf("s_persist_verdict = logic::history_restore_verdict("));
const verdictArgs = verdictCall.slice(0, verdictCall.indexOf(");"));
assert.match(verdictArgs, /\bsafe\b/, "the verdict must be given safe mode");
assert.match(verdictArgs, /P\(\)\.boots_since_commit/, "the verdict must be given the sealed counter");
assert.match(verdictArgs, /plan\.region_bookable/,
  "the verdict must be given whether the liveness record can measure the X10A raster");
const planAt = start.indexOf("logic::history_raster_plan(s_liveness, weighed)");
const liveBegin = start.indexOf("logic::history_liveness_begin(s_liveness");
assert.ok(planAt >= 0 && liveBegin > planAt,
  "the previous boot's liveness record must be judged before this boot overwrites it");
assert.equal(count(start, /logic::history_liveness_begin\(s_liveness/g), 2,
  "both the adopting and the wiping path start a fresh liveness record");
// The rasters weighed are the ones this boot would ADOPT, by the same rule the retire steps use: a
// HomeHub ring only for the target it was sealed under, an ENV III ring only when its sensor ran
// and runs. A HomeHub disabled at runtime keeps its frozen ring but not its target, so weighing the
// raw ring made the whole region stale (a source that is gone costing the trends that are not).
assert.match(start, /const bool mb_keep = P\(\)\.mb_target_fp == want_mb_target_fp;/,
  "the HomeHub raster is weighed under the same keep rule as its retire step");
const weighedDecl = start.slice(start.indexOf("const bool weighed["),
  start.indexOf("const logic::HistoryRasterPlan plan"));
assert.match(weighedDecl, /x10a_rings_have_samples\(\)/);
assert.match(weighedDecl, /mb_keep && rings_have_samples\(P\(\)\.mb_ring, HOMEHUB_HISTORY_COUNT\)/);
assert.match(weighedDecl, /env3_keep && rings_have_samples\(P\(\)\.env3_ring, ENV3_HISTORY_COUNT\)/);
assert.doesNotMatch(start, /history_commit_state|HistoryCommitState/,
  "the whole-region aggregate is retired: the X10A raster alone decides the region");
// A raster that merely stalled is measurable and is booked: there is no staleness bound left to
// refuse it with, in the logic or at the call site.
assert.doesNotMatch(raw("main/logic/history_persist.hpp") + raw("main/history.cpp"),
  /HISTORY_LIVENESS_SLACK_S|HistoryRasterState::Stale|HistoryRasterState::Current|history_raster_vouched/,
  "a measurable stall is booked, never refused for staleness");
// And the plan is what decides the retirements: a stale optional raster resets its own rings, in
// the accepting branch only, and never touches the verdict.
const adoptAt = start.indexOf("if (s_persist_verdict == logic::HistoryRestore::Accept) {");
const adopt = start.slice(adoptAt, start.indexOf("} else {", adoptAt));
assert.match(adopt, /if \(plan\.retire_modbus\) \{ for \(auto& r : P\(\)\.mb_ring\) r\.reset\(\);/,
  "a stale HomeHub raster retires its own rings");
assert.match(adopt, /if \(plan\.retire_env3\) \{ for \(auto& r : P\(\)\.env3_ring\) r\.reset\(\);/,
  "a stale ENV III raster retires its own ring");
assert.equal(count(start, /plan\.retire_/g), 2, "only the two optional rasters retire alone");
assert.doesNotMatch(verdictArgs, /retire_/, "a retirement never reaches the verdict");

// Adoption: the counter moves and is sealed BEFORE the rings are re-anchored, so a crash between
// the two cannot leave an adopted region that still reads as committed.
const counterBump = adopt.indexOf("logic::history_counter_next(P().boots_since_commit)");
const sealAfter = adopt.indexOf("persist_seal_locked();", counterBump);
const reanchor = adopt.indexOf("persist_adopt(");
assert.ok(counterBump >= 0 && sealAfter > counterBump && reanchor > sealAfter,
  "adoption must increment and reseal the counter before persist_adopt");
// The unobserved stretch is measured from the PREVIOUS boot's record (before it is overwritten),
// booked into the rings before the seal that covers them, and the newest booked sample claims the
// raster boundary of this boot - not the boot instant, which collapsed the stretch to nothing and
// let the collapses of repeated restarts add up in one direction.
const claimAt = adopt.indexOf("const int64_t claim_us = logic::history_raster_boundary_us(start_us);");
const gapAt = adopt.indexOf("logic::history_adopt_booking(s_liveness.sign_us, s_liveness.commit_us[i],");
const bookAt = adopt.indexOf("persist_book_unobserved(gaps);");
const beginAt = adopt.indexOf("logic::history_liveness_begin(s_liveness, start_us);");
assert.ok(claimAt >= 0 && gapAt > claimAt && bookAt > gapAt && sealAfter > bookAt && beginAt > sealAfter,
  "the stretch is measured from the previous record, booked, sealed and only then is the record replaced");
assert.match(adopt, /history_adopt_booking\([^;]*DWELL_REBOOT_BLIND_S, claim_us, P\(\)\.residual_us\[i\]\)/,
  "the downtime allowance is the project's one restart allowance, the stretch runs to the claim " +
  "and the previous adoption's remainder is carried in");

// The rounding remainder is carried: read from the sealed region, written back before the single
// reseal the adoption does, covered by the seal's CRC, and gone with every wipe and retirement.
assert.match(adopt, /P\(\)\.residual_us\[i\] = booking\.residual_us;/,
  "the new remainder replaces the old one");
assert.ok(adopt.indexOf("P().residual_us[i] = booking.residual_us;") < sealAfter,
  "the remainder is stored before the seal that covers it");
assert.match(history, /int32_t residual_us\[logic::HISTORY_LIVENESS_RASTERS\];/,
  "one remainder per raster, in the sealed region");
assert.match(body(history, "inline uint32_t persist_crc()"), /P\(\)\.residual_us/,
  "the remainder is inside the seal, so a flipped bit is a bad_crc and not a forgiven drift");
assert.match(body(history, "inline void persist_wipe("), /for \(auto& r : P\(\)\.residual_us\) r = 0;/,
  "a refusal and a wipe start the diffusion over");
assert.match(adopt,
  /P\(\)\.x10a_target_fp = boot_config\.x10a_identity_fp; P\(\)\.residual_us\[static_cast<size_t>\(logic::HistoryJournalSource::X10a\)\] = 0;/,
  "an X10A identity change retires its rings and their remainder");
assert.match(body(history, "void history_record(const CachedValue"),
  /P\(\)\.x10a_target_fp = s_x10a_target_fp\.load\(\); P\(\)\.residual_us\[static_cast<size_t>\(logic::HistoryJournalSource::X10a\)\] = 0;/,
  "a runtime X10A reset zeroes the remainder with the rings");
assert.match(body(history, "void history_record_modbus("),
  /P\(\)\.mb_target_fp = s_mb_target_fp\.load\(\); P\(\)\.residual_us\[static_cast<size_t>\(logic::HistoryJournalSource::Modbus\)\] = 0;/,
  "a runtime HomeHub reset zeroes the remainder with the rings");

// The boot line says what was booked: only a raster whose rings hold samples AFTER the retire
// steps has a seam, and every other count is zero before it is booked or logged.
const retireEnv3At = adopt.indexOf("if (plan.retire_env3) {");
const hasAt = adopt.indexOf("const bool has[logic::HISTORY_LIVENESS_RASTERS] = {");
assert.ok(retireEnv3At >= 0 && hasAt > retireEnv3At,
  "which rasters hold samples is decided after every retire step, not before");
assert.match(adopt.slice(hasAt, bookAt),
  /x10a_rings_have_samples\(\), rings_have_samples\(P\(\)\.mb_ring, HOMEHUB_HISTORY_COUNT\), rings_have_samples\(P\(\)\.env3_ring, ENV3_HISTORY_COUNT\)\};/);
assert.match(adopt, /HistoryAdoptBooking booking\{0, 0\}; if \(has\[i\]\) booking = /,
  "a raster without samples books nothing and carries nothing");
assert.ok(adopt.indexOf("gaps[0]") > bookAt, "the boot line prints the counts that were booked");
assert.doesNotMatch(adopt.slice(0, bookAt), /gaps\[[012i]\] = logic::history_adopt/,
  "no count is computed for a raster before its rings are known");

// The journal must not file an adopted sample twice: the instant the newest REAL adopted sample
// ended is remembered per raster (and only for rasters that hold samples), the writer's first
// look decides once whether the journal already holds it, and every reset of a source's cursor
// forgets the floor with it.
assert.match(adopt, /s_adopt_real_end_us\[i\] = has\[i\] \? logic::history_adopt_real_end_us\(claim_us, booking\.gaps\) : INT64_MIN;/,
  "a real-sample instant exists only for a raster that holds samples");
const floorBuilder = body(history, "bool flash_build_next_record(");
const decideAt = floorBuilder.indexOf("s_adopt_floor_bucket[src_i] = logic::history_adopt_floor_bucket(");
const spendAt = floorBuilder.indexOf("s_adopt_real_end_us[src_i] = INT64_MIN;");
const liftAt = floorBuilder.indexOf("logic::history_adopt_floor_cursor(s_flash_last_bucket[src_i], s_adopt_floor_bucket[src_i])");
const targetAt = floorBuilder.indexOf("int64_t target = cursor == INT64_MIN ? oldest : cursor + 1;");
assert.ok(decideAt >= 0 && spendAt > decideAt && liftAt > spendAt && targetAt > liftAt,
  "the writer decides the floor once, spends the instant, lifts the cursor and walks from it");
assert.match(floorBuilder, /history_adopt_floor_bucket\( s_flash_last_bucket\[src_i\], wall_bucket_of_instant_locked\(s_adopt_real_end_us\[src_i\]\)\);/,
  "from the journal's own cursor and the wall bucket of the newest real adopted sample");
assert.ok(decideAt > floorBuilder.indexOf("history_cursor_in_future("),
  "a cursor ahead of the clock is reported before any floor is considered");
assert.doesNotMatch(floorBuilder, /s_flash_last_bucket\[src_i\] \+ 1|s_flash_last_bucket\[src_i\] == INT64_MIN\s*\?/,
  "the walk starts from the lifted cursor only");
assert.equal(count(history, /forget_adopt_floor\(src\);/g), 4,
  "history_reset, the detection reset, the HomeHub reset and the factory wipe forget the floor");
assert.match(body(history, "inline void forget_adopt_floor("), /s_adopt_real_end_us\[src\] = INT64_MIN; s_adopt_floor_bucket\[src\] = INT64_MIN;/);
assert.match(adopt, /persist_adopt\(claim_us\);/, "the rings are re-anchored on the claimed boundary");
assert.doesNotMatch(adopt, /persist_adopt\(start_us\)/, "never on the boot instant");
const bookFn = body(history, "inline void persist_book_unobserved(");
assert.equal(count(bookFn, /\.append_gaps\(gaps\[[012]\]\)/g), 3,
  "all three rasters book their own count into their own rings");
assert.match(bookFn, /P\(\)\.ring\) t\.ring\.append_gaps\(gaps\[0\]\)/);
assert.match(bookFn, /P\(\)\.mb_ring\) r\.append_gaps\(gaps\[1\]\)/);
assert.match(bookFn, /P\(\)\.env3_ring\) r\.append_gaps\(gaps\[2\]\)/);
assert.match(history, /#include "logic\/state_dwell\.hpp"/);
const dwellBlind = Number(raw("main/logic/state_dwell.hpp").match(/DWELL_REBOOT_BLIND_S\s*=\s*(\d+);/)[1]);
const dhwBlind = Number(raw("main/logic/checkup.hpp").match(/DHW_LOSS_REBOOT_BLIND_S\s*=\s*(\d+);/)[1]);
assert.equal(dwellBlind, dhwBlind, "one restart allowance across the state ages, the DHW handoff and this");

// The counter and the ENV III flag are inside the seal.
const crcBody = body(history, "inline uint32_t persist_crc()");
assert.match(crcBody, /&P\(\)\.boots_since_commit/);
assert.match(crcBody, /&P\(\)\.env3_live/);

// ── a) commits: each raster zeroes the counter and notes its commit ─────────────────────────────
for (const [signature, source] of [
  ["inline void advance_raster_locked(", "X10a"],
  ["void history_record_modbus(", "Modbus"],
  ["void history_record_env3(", "Env3"],
]) {
  const fn = body(history, signature);
  // A seed of an empty raster is not a commit of what was adopted: the counter is zeroed only on
  // the bucket-crossing branch, which is the one that also assigns the commit instant of `now`.
  assert.equal(count(fn, /boots_since_commit = 0;/g), 1, signature + " zeroes the sealed counter once");
  assert.match(fn, /boots_since_commit = 0; (?:logic::)?history_liveness_commit\(s_liveness, logic::HistoryJournalSource::(X10a|Modbus|Env3), now_us\);/,
    signature + " zeroes the counter and notes the commit together");
  assert.equal(count(fn, new RegExp("history_liveness_commit\\(s_liveness, logic::HistoryJournalSource::" + source, "g")), 2,
    signature + " notes both its seed and its commit in the liveness record");
}
// Adoption and the flash seed note the commit too, or the next boot cannot weigh them.
const adoptFn = body(history, "inline void persist_adopt(");
assert.equal(count(adoptFn, /history_liveness_commit\(s_liveness/g), 3);
assert.equal(count(adoptFn, /history_liveness_commit\(s_liveness, logic::HistoryJournalSource::\w+, claim_us\)/g), 3,
  "adoption notes the claimed boundary as each raster's commit, not the boot instant");
assert.doesNotMatch(adoptFn, /now_us/, "persist_adopt knows only the claim");
const seed = body(history, "bool seed_source_timeline_locked(");
assert.match(seed, /logic::history_raster_boundary_us\(now_us\)/,
  "the flash seed claims the last monotonic boundary");
assert.match(seed, /logic::history_anchor_bucket\(unix_s, now_us, commit_us\)/);
assert.equal(count(seed, /history_liveness_commit\(s_liveness/g), 3);
assert.doesNotMatch(history + code("main/logic/history_persist.hpp"), /history_anchor_commit_us/,
  "the wall-bucket seed anchor is retired");
assert.match(body(history, "int64_t wall_bucket_of_instant_locked("), /logic::history_anchor_bucket\(/,
  "the live anchor, the floor and the seed share one derivation");
assert.match(body(history, "int64_t source_anchor_bucket_locked("), /wall_bucket_of_instant_locked\(source_last_commit_us\(src\)\)/);

// A wipe starts the counter over, and the factory-reset wipe starts the liveness record over.
assert.match(body(history, "inline void persist_wipe("),
  /P\(\)\.boots_since_commit = 0; for \(auto& r : P\(\)\.residual_us\) r = 0; P\(\)\.env3_live = /);
assert.match(body(history, "bool history_flash_forget()"), /logic::history_liveness_begin\(s_liveness/);

// ── a) the sign of life: allocation-free, try-lock, every poll cycle, every branch ─────────────
const touch = body(history, "void history_liveness_touch() noexcept");
assert.match(touch, /Lock lk\(s_mtx, 0\)/, "the per-cycle touch must never wait for the history lock");
assert.doesNotMatch(touch, /std::string|\bnew\b|diag_printf|config\(|ESP_LOG|vector/,
  "the per-cycle touch must not allocate or log");
assert.match(raw("main/history.hpp"), /void history_liveness_touch\(\) noexcept;/);
assert.match(history, /__NOINIT_ATTR logic::HistoryLiveness s_liveness;/);
assert.match(history, /static_assert\( ?std::is_trivially_default_constructible<logic::HistoryLiveness>/,
  "an initialiser on the liveness record would be dropped from .noinit silently");

const task = body(poll, "static void poll_task(void*)");
const touchAt = task.indexOf("history_liveness_touch();");
assert.ok(touchAt >= 0, "the poll task must sign its liveness record");
assert.equal(count(task, /history_liveness_touch\(\)/g), 1);
assert.ok(touchAt < task.indexOf("ota_quiesce_step(network_quiesce") && touchAt < task.indexOf("try {"),
  "the sign of life precedes the network hold-off branch and the try block, so no cycle skips it");
assert.match(task.slice(0, touchAt), /for \(;;\) \{ esp_task_wdt_reset\(\); stack_watch_sample\(StackWatch::Poll\); $/,
  "and it sits at the top of the cycle loop, unconditionally");

// The shutdown handler signs once more, and exists whether or not a journal does.
const shutdown = body(history, "void history_flash_save() {");
const shutdownWait = shutdown.match(/Lock lk\(s_mtx, pdMS_TO_TICKS\((\d+)\)\)/);
assert.ok(shutdownWait && Number(shutdownWait[1]) <= 200,
  "bounded (no longer than the journal drain's own 200 ms): a restart must not be stranded");
assert.ok(shutdown.indexOf("logic::history_liveness_touch(s_liveness") >= 0 &&
  shutdown.indexOf("logic::history_liveness_touch(s_liveness") < shutdown.indexOf("if (!s_flash_part"),
  "the shutdown handler signs life before it looks for a journal to drain, and whether or not one exists");
assert.equal(count(history, /esp_register_shutdown_handler\(/g), 1);
assert.match(start, /esp_register_shutdown_handler\(history_flash_save\)/,
  "registered by history_start, not by the journal's own start (which a missing partition skips)");

// ── e) ENV III: producer existence decided once; the journal needs a fed ring ───────────────────
assert.match(start,
  /s_env3_enabled = !safe && boot_config\.env3_enabled && env3_board_supported\(boot_config\)/,
  "ENV III is live only when env3_start() will create its task");
assert.match(start, /history_env3_ring_adoptable\(P\(\)\.env3_live != 0, s_env3_enabled\)/);
assert.match(adopt, /P\(\)\.env3_live = s_env3_enabled \? 1 : 0;/);
assert.match(adopt,
  /if \(!env3_keep && rings_have_samples\(P\(\)\.env3_ring, ENV3_HISTORY_COUNT\)\) \{[^}]*for \(auto& r : P\(\)\.env3_ring\) r\.reset\(\);/,
  "a ring the sensor did not feed (or will not feed) is retired, not adopted");
const builder = body(history, "bool flash_build_next_record(");
const gate = builder.search(
  /src == HistorySource::Env3 && !logic::history_env3_append_allowed\(s_env3_enabled, s_env3_fed\)/);
assert.ok(gate >= 0 && gate < builder.indexOf("source_anchor_bucket_locked(src)"),
  "ENV III records are refused before the writer derives an anchor for the ring");
const recordEnv3 = body(history, "void history_record_env3(");
assert.ok(recordEnv3.indexOf("s_env3_fed = true;") > recordEnv3.indexOf("s_flash_forgotten.load()"),
  "the producer marks its ring fed once it owns the lock");
assert.doesNotMatch(history.replace(recordEnv3, ""), /s_env3_fed = true/,
  "only the ENV III producer may mark the ring fed");

// Checkup completed hours always start empty. Integrity only gates the separate handoff.
const cStart = body(checkup, "void checkup_start(");
assert.match(cStart, /s_source_confirmed = false;/);
assert.match(cStart, /s_source_fp = 0;/);
assert.match(cStart, /persist_wipe\(\);/);
assert.match(cStart, /checkup_restore_route\(integrity\)/);
assert.doesNotMatch(cStart, /carried_span_us = P\(\)\.span_us|dhw_loss_adopt\(/);
assert.ok(cStart.indexOf("P().dhw_handoff.magic = 0;") < cStart.indexOf("persist_wipe();"));
assert.match(cStart, /s_boot_handoff\.pending = logic::DhwLossBucket\{\};/);
const explicitReset = body(checkup, "void checkup_reset()");
assert.match(explicitReset, /s_source_confirmed = false;/);
assert.match(explicitReset, /s_source_fp = 0;/);
assert.match(explicitReset, /s_model_fp = 0;/);
const detect = body(checkup, "void checkup_reset_on_detect(");
assert.match(detect, /s_source_confirmed = source_fp != 0;/);
assert.match(detect, /s_boot_handoff\.source_fp == source_fp/);
assert.match(detect, /!s_reset_requested\.load\(\) && !s_dhw_reset_requested\.load\(\)/);
assert.match(detect, /s_boot_handoff_valid = false;/);
assert.match(body(checkup, "void checkup_reboot_save()"), /h\.payload\.pending = logic::DhwLossBucket\{\};/);
const cFlash = body(checkup, "CheckupFlashRestoreResult checkup_flash_restore(");
assert.match(cFlash, /checkup_flash_source_ready/);
assert.match(cFlash, /checkup_journal_restore_admits/);
assert.match(cFlash, /checkup_journal_select_slot/);
const noMaterialized = cFlash.indexOf("if (!materialized)");
assert.ok(noMaterialized >= 0 && noMaterialized < cFlash.indexOf("P().ring.reset();"),
  "zero selected flash intervals must not rebuild the ring or report restoration");
assert.match(cFlash, /const auto\* rec = find\(b, from_flash\); if \(!rec \|\| !from_flash\) continue;/);
assert.match(cFlash, /static_cast<unsigned>\(materialized\)/,
  "restoration count describes selected flash intervals, not admitted candidates");
assert.match(cFlash, /checkup_restore_expiry_us/);
assert.match(cFlash, /s_persist_verdict = logic::CheckupRestore::Flash;/);
assert.doesNotMatch(cFlash, /s_persist_verdict = logic::CheckupRestore::Accept/);
assert.match(body(checkup, "logic::CheckupReport checkup_report()"), /expire_restored_locked\(\);/);
assert.match(body(checkup, "void expire_restored_locked()"), /checkup_restored_expired/);
console.log("history restore guard contract: ok");
