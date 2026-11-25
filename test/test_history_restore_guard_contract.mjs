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
const verdictCall = start.slice(start.indexOf("const auto persist_verdict = logic::history_restore_verdict("));
const verdictArgs = verdictCall.slice(0, verdictCall.indexOf(");"));
assert.match(verdictArgs, /\bsafe\b/, "the verdict must be given safe mode");
assert.match(verdictArgs, /P\(\)\.boots_since_commit/, "the verdict must be given the sealed counter");
assert.match(verdictArgs, /plan\.region_bookable/,
  "the verdict must be given whether the liveness record can measure the X10A raster");
assert.match(start, /s_persist_verdict\.store\(persist_verdict, std::memory_order_relaxed\);/,
  "publish the standalone boot verdict for concurrent status readers");
assert.match(body(history, "const char* history_persist_state()"),
  /s_persist_verdict\.load\(std::memory_order_relaxed\)/,
  "status must load the verdict without racing the recovery button or taking the History lock");
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
const adoptAt = start.indexOf("if (persist_verdict == logic::HistoryRestore::Accept) {");
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
assert.match(body(history, "inline uint32_t history_persist_crc()"), /P\(\)\.residual_us/,
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
const crcBody = body(history, "inline uint32_t history_persist_crc()");
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
assert.match(seed, /uint32_t bucket = logic::history_bucket\(now_us\);/,
  "a recorder without an open bucket starts at the current monotonic boundary");
for (const [source, prefix] of [["X10a", "s_"], ["Modbus", "s_mb_"], ["Env3", "s_env3_"]]) {
  assert.ok(seed.includes(`case HistorySource::${source}: if (${prefix}have_bucket) bucket = ${prefix}bucket; break;`),
    `the flash seed preserves the pending ${source} bucket`);
}
assert.match(seed, /commit_us = static_cast<int64_t>\(bucket\) \* logic::HISTORY_DT_S \* 1000000;/,
  "the flash seed claims the boundary of the selected open bucket");
assert.match(seed, /logic::history_anchor_bucket\(unix_s, now_us, commit_us, logic::HISTORY_DT_S, ms\)/,
  "the seed combines the actual wall-clock milliseconds with the monotonic age");
assert.equal(count(seed, /history_liveness_commit\(s_liveness/g), 3);
assert.doesNotMatch(history + code("main/logic/history_persist.hpp"), /history_anchor_commit_us/,
  "the wall-bucket seed anchor is retired");
assert.match(body(history, "int64_t wall_bucket_of_instant_locked("),
  /logic::history_anchor_bucket\(unix_s, esp_timer_get_time\(\), instant_us, logic::HISTORY_DT_S, ms\)/,
  "the live anchor, the floor and the seed share one derivation");
assert.match(body(history, "int64_t source_anchor_bucket_locked("),
  /commit_us = source_last_commit_us\(src\); if \(commit_us == kNoCommitUs\) return INT64_MIN; return wall_bucket_of_instant_locked\(logic::history_raster_boundary_us\(commit_us\)\)/);

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
const cStart = body(checkup, "void slot_start(");
assert.match(cStart, /slot\.source_confirmed = false;/);
assert.match(cStart, /slot\.source_fp = 0;/);
assert.match(cStart, /persist_wipe\(slot\);/);
assert.match(cStart, /checkup_restore_route\(integrity\)/);
assert.doesNotMatch(cStart, /carried_span_us = slot\.P\(\)\.span_us|dhw_loss_adopt\(/);
assert.ok(cStart.indexOf("slot.P().dhw_handoff.magic = 0;") < cStart.indexOf("persist_wipe(slot);"));
assert.match(checkup, /constexpr logic::DhwLossBucket\s+kEmptyDhwLossBucket\{\};/);
assert.match(checkup, /constexpr logic::DhwLossState\s+kFreshDhwLossState\{\};/);
assert.match(cStart, /slot\.boot_handoff\.pending = kEmptyDhwLossBucket;/);
const explicitReset = body(checkup, "void checkup_reset()");
assert.match(explicitReset, /s_x10a\.source_confirmed = false;/);
assert.match(explicitReset, /s_x10a\.source_fp = 0;/);
assert.match(explicitReset, /s_x10a\.model_fp = 0;/);
const detect = body(checkup, "void checkup_reset_on_detect(");
assert.match(detect, /s_x10a\.source_confirmed = source_fp != 0 && fp != 0;/);
// Resolve the shared immutable view before acquiring the owner locks. Detection binds its POD
// result; core identity and all independent input plans must use that same catalog view.
const profileLayout = body(checkup, "void checkup_profile_layout(");
const detectView = profileLayout.match(/const auto ([A-Za-z_]\w*) = def::lookup_view\(profile_id\);/);
assert.ok(detectView, "detection must resolve an immutable structural view for the selected profile");
assert.equal(count(profileLayout, /def::lookup_view\(/g), 1,
  "core identity and all independent input plans must share exactly one catalog lookup");
const coreFingerprint = `logic::checkup_model_fingerprint(profile_id, ${detectView[1]})`;
const stopInputPlan = `logic::stop_context_input_plan(profile_id, ${detectView[1]})`;
const heaterInputPlan = `logic::heater_context_input::resolve_layout(profile_id, ${detectView[1]})`;
const hydronicInputPlan = `logic::fill_hydronic_input_plan(out.hydronic, profile_id, ${detectView[1]})`;
for (const [field, expression] of [["model_fp", coreFingerprint], ["stop", stopInputPlan],
  ["heater", heaterInputPlan]]) {
  assert.ok(profileLayout.indexOf(`out.${field} = ${expression};`) > detectView.index,
    `${field} must consume the same resolved structural view`);
}
assert.ok(profileLayout.indexOf(`${hydronicInputPlan};`) > detectView.index,
  "hydronic input plan must consume the same resolved structural view");
assert.doesNotMatch(profileLayout, /(?:Lock|SemGuard)\s/,
  "profile traversal must remain outside the HP/checkup critical sections");
assert.doesNotMatch(detect,
  /lookup_view|checkup_model_fingerprint|stop_context_input_plan|resolve_layout|fill_hydronic_input_plan/,
  "locked detection consumes the prepared layout without resolving another profile");
assert.match(detect, /const uint32_t fp\s*=\s*layout\.model_fp;/);
assert.match(detect, /const auto&\s+stop_inputs\s*=\s*layout\.stop;/);
assert.match(detect, /reset_hydronic_on_detect_locked\(layout\.hydronic,/);
assert.match(detect, /bind_heater_locked\(layout\.heater, s_stop_generation,/);
assert.match(detect, /s_x10a\.model_fp = fp;/,
  "the core identity derived from the shared view must become the active model fingerprint");
assert.match(detect, /s_stop_inputs = stop_inputs;/,
  "the source-bound plan derived from the shared view must become the active stop-input plan");
assert.match(detect, /if \(s_x10a\.source_confirmed && s_x10a\.boot_handoff_valid/);
assert.match(detect, /s_x10a\.boot_handoff\.source_fp == source_fp/);
assert.match(detect, /s_x10a\.boot_handoff\.dhw_source_fp == s_x10a\.dhw_source_fp/,
  "an intentional restart cannot revive a candidate from a replaced circulation witness");
assert.match(detect, /!s_x10a\.reset_requested\.load\(\) &&\s*!s_x10a\.dhw_reset_requested\.load\(\)/);
assert.match(detect, /s_x10a\.boot_handoff_valid = false;/);
assert.match(body(checkup, "void checkup_reboot_save()"), /h\.payload\.pending = kEmptyDhwLossBucket;/);
assert.match(body(checkup, "void checkup_reboot_save()"), /h\.payload\.dhw_source_fp = slot->dhw_source_fp;/);
const circulationIdentity = body(checkup, "uint32_t circulation_identity()");
assert.match(circulationIdentity, /with_config\(/);
for (const field of ["mqtt_uri", "circulation_topic", "circulation_power_path", "circulation_time_path",
  "circulation_max_age_s", "circulation_on_tenths_w", "circulation_off_tenths_w", "circulation_confirm_s"])
  assert.ok(circulationIdentity.includes("c." + field), "DHW witness identity must include " + field);
assert.doesNotMatch(circulationIdentity, /config\(\)|circulation_name/,
  "the identity must not copy Config or change when a display name changes");
const dhwReset = body(checkup, "bool apply_dhw_reset_locked(");
assert.match(dhwReset, /slot\.P\(\)\.dhw\.head = slot\.P\(\)\.ring\.head;/);
assert.match(dhwReset, /slot\.P\(\)\.dhw\.count = slot\.P\(\)\.ring\.count;/,
  "DHW-only reset keeps the shared hourly geometry and unrelated persistence writable");
const cFlash = body(checkup, "CheckupFlashRestoreResult checkup_flash_restore(");
assert.match(explicitReset, /s_x10a\.persist_verdict = logic::CheckupRestore::ModelChanged;/);
assert.match(cFlash, /if \(logic::checkup_flash_restore_retired\(slot\.persist_verdict\)\) return CheckupFlashRestoreResult::Ignored;/);
assert.ok(cFlash.indexOf("checkup_flash_restore_retired") < cFlash.indexOf("checkup_flash_source_ready"),
  "explicit resets retire old journal adoption even after same-source manual confirmation");
assert.match(cFlash, /checkup_flash_source_ready/);
assert.match(cFlash, /checkup_journal_restore_admits/);
assert.match(cFlash, /logic::checkup_journal_choose\(/);
assert.doesNotMatch(checkup, /s_restore_live/,
  "this boot's completed hours compete in place, never through a static copy");
assert.match(cFlash,
  /if \(logic::checkup_journal_rebuild\( ?P\(\)\.ring, P\(\)\.dhw, slot\.slot_times, live, records, count, earliest_bucket, latest_bucket, now_unix_s, now_us, slot\.source_confirmed, slot\.model_fp, slot\.source_fp, s_diagnostics_generation, reset_requested, slot\.dhw_source_fp, slot\.dhw_reset_requested\.load\(\), P\(\)\.energy, slot\.pel_source_fp, energy_reset_pending, energy_retired\)\) slot\.dhw_scope_us = now_us;/,
  "a mismatched circulation mapping must retire DHW alone, while admitting dated checks");
assert.match(cFlash,
  /if \(energy_retired \|\| earliest_energy_stored_end == INT64_MAX\) \{ if \(energy_retired\) slot\.energy_scope_us = now_us;/,
  "a mismatched electrical identity must retire energy alone while admitting dated checkup and DHW checks");
assert.doesNotMatch(cFlash, /\.reset\(\);/, "the rebuild must not clear the live hours it keeps");
const noMaterialized = cFlash.indexOf("if (!materialized)");
assert.ok(noMaterialized >= 0 && noMaterialized < cFlash.indexOf("logic::checkup_journal_rebuild("),
  "zero selected flash intervals must not rebuild the ring or report restoration");
assert.match(cFlash, /\.stored; if \(!rec\) continue; \+\+materialized;/);
assert.match(cFlash, /static_cast<unsigned>\(materialized\)/,
  "restoration count describes selected flash intervals, not admitted candidates");
assert.match(persistCheckup,
  /struct CheckupJournalPayload \{[\s\S]*?uint32_t\s+pel_source_fp\s*=\s*0;[\s\S]*?EnergyBucket\s+energy;\s*\};/,
  "CheckupPersist must embed EnergyBucket inside CheckupJournalPayload with zero extra journal slots");
const payloadSize = Number(persistCheckup.match(/static_assert\(sizeof\(CheckupJournalPayload\)\s*==\s*(\d+)/)?.[1]);
assert.ok(Number.isInteger(payloadSize) && payloadSize <= 192,
  `sizeof(CheckupJournalPayload) must remain <= 192 bytes (got ${payloadSize})`);
assert.match(persistCheckup,
  /static_assert\(sizeof\(CheckupJournalPayload\) <= HISTORY_JOURNAL_PAYLOAD_BYTES,/,
  "CheckupJournalPayload must statically remain within one 192-byte history journal slot");
const persistRebuild = body(code("main/logic/checkup_persist.hpp"), "inline bool checkup_journal_rebuild(");
assert.match(persistRebuild, /checkup_restore_expiry_us/);
assert.match(persistRebuild,
  /const bool keep_dhw = !dhw_reset_requested && checkup_journal_dhw_identity_matches\( ?c\.stored->payload, dhw_source_fp\);/,
  "a stored hour keeps DHW evidence only under the current circulation identity");
assert.match(persistRebuild,
  /const bool keep_energy = !energy_reset_requested && checkup_journal_pel_identity_matches\( ?c\.stored->payload, pel_source_fp\);/,
  "a stored hour keeps energy evidence only under the current electrical-source identity");
assert.match(persistRebuild,
  /ring\.buf\[p\] = c\.stored->payload\.checkup; dhw\.buf\[p\] = keep_dhw \? c\.stored->payload\.dhw : DhwLossBucket\{\}; energy\.buf\[p\] = keep_energy \? c\.stored->payload\.energy : EnergyBucket\{\}; dhw_retired = dhw_retired \|\| !keep_dhw; energy_retired = energy_retired \|\| !keep_energy;/,
  "a pel_source_fp mismatch must retire only energy while retaining ring and dhw checkup hours");
assert.match(persistRebuild,
  /std::rotate\(ring\.buf, ring\.buf \+ start, ring\.buf \+ kSlots\); std::rotate\(dhw\.buf, dhw\.buf \+ start, dhw\.buf \+ kSlots\); std::rotate\(energy\.buf, energy\.buf \+ start, energy\.buf \+ kSlots\); std::rotate\(expiry_us, expiry_us \+ start, expiry_us \+ kSlots\); std::rotate\(restored_end_unix_s, restored_end_unix_s \+ start, restored_end_unix_s \+ kSlots\); ring\.count = dhw\.count = energy\.count = static_cast<uint8_t>\(n\); ring\.head = dhw\.head = energy\.head = static_cast<uint8_t>\(n % kSlots\);/,
  "a ring that is not full keeps its oldest hour in slot 0, which all three aggregates read first");
assert.match(persistRebuild,
  /const size_t p = \(start \+ j\) % kSlots; restored_end_unix_s\[p\] = 0;/,
  "unrestored slots start without a stored wall time");
assert.match(persistRebuild,
  /const int64_t end = c\.stored->payload\.end_unix_s; restored_end_unix_s\[p\] = end > 0 && end < UINT32_MAX \? static_cast<uint32_t>\(end\) : UINT32_MAX;/,
  "a restored interval takes its own saved wall time");
assert.match(cFlash, /slot\.persist_verdict = logic::CheckupRestore::Flash;/);
assert.doesNotMatch(cFlash, /persist_verdict = logic::CheckupRestore::Accept/);
assert.match(body(checkup, "logic::CheckupReport checkup_report("), /expire_restored_locked\(slot\);/);
assert.match(body(checkup, "void expire_restored_locked(CheckupSlot& slot) {"), /checkup_restored_expired/);
const cRecord = body(checkup, "void checkup_record(");
const cCommitFold = body(checkup, "void commit_and_fold_locked(");
assert.match(cRecord, /if \(profile_confirmed\) s_x10a\.cov = coverage;/,
  "temporary empty cycles must not overwrite the current profile's capabilities");
assert.match(cRecord, /if \(n\) s_x10a\.source_last_us = now;/,
  "empty callbacks must not renew successful source observation age");
assert.match(cCommitFold,
  /const int64_t completed_start_us = completed_end_us - static_cast<int64_t>\(logic::CHECKUP_DT_S\) \* 1000000LL;/,
  "completed-hour expiry must use the bucket start, matching ordinary ring replacement");
assert.match(cCommitFold, /slot\.slot_times\.expiry_us\[committed_i\] = logic::checkup_live_expiry_us\(completed_start_us\);/,
  "a stalled producer cannot keep completed findings for an extra hour");
assert.match(cCommitFold, /slot\.slot_times\.expiry_us\[idx\] = 0; slot\.slot_times\.restored_end_unix_s\[idx\] = 0;/,
  "the same overwritten slot loses both its deadline and its stored time");
assert.match(body(checkup, "void persist_wipe("),
  /for \(auto& expiry : slot\.slot_times\.expiry_us\) expiry = 0;/,
  "a new checkup lifecycle clears all expiry markers");
assert.match(body(checkup, "void expire_restored_locked(CheckupSlot& slot) {"),
  /s_slot_times\.expiry_us\[i\] = logic::CHECKUP_EXPIRED_SLOT_US; s_slot_times\.restored_end_unix_s\[i\] = 0;/,
  "an expired interval drops its wall time but retains its blank slot");
assert.match(body(checkup, "static logic::CheckupCyclingHours checkup_cycling_hours_locked("),
  /if \(expiry_us == logic::CHECKUP_EXPIRED_SLOT_US\) \{ hours\.hours\[i\]\.provenance = logic::CheckupCyclingSlot::Expired;/,
  "the chart keeps expiration distinct from ordinary gaps and restored hours");
const cReport = body(checkup, "logic::CheckupReport checkup_report(");
assert.match(cReport, /Lock lk\(s_mtx\);.*expire_restored_locked\(slot\);.*if \(hours\) \*hours = checkup_cycling_hours_locked\(slot,\s*now_us\);/,
  "cycling hours and the judged diagnosis share the same admitted snapshot");
assert.match(cReport, /source_fresh \? slot\.fault_now : FaultClass::Unknown/,
  "the last cycle's fault class must not masquerade as a current observation after a stall");
assert.match(cReport, /logic::checkup_apply_freshness\(report, source_fresh, source_age_s, span_s\);/,
  "the pure freshness policy receives read-time source age and actual lifecycle span");
assert.match(cReport,
  /copy_dhw_trace_locked\(slot, dhw_trace, now_us, source_fresh\);.*const bool dhw_reset_pending = slot\.dhw_reset_requested\.load\(\);/,
  "the report observes a reset that latched during the optional clock read");
assert.equal([...cReport.matchAll(/slot\.dhw_reset_requested\.load\(\)/g)].length, 1,
  "one reset decision keeps the DHW report internally consistent");
assert.match(cReport, /dhw\.full_span = !dhw_reset_pending && logic::dhw_loss_scope_full\(/,
  "a pending reset clears elapsed time from the previous DHW scope");
assert.match(cReport,
  /if \(source_fresh && !dhw_reset_pending\) \{[^}]*report\.dhw_candidate_s = p\.candidate_observed_s;[^}]*report\.dhw_settle_remaining_s = p\.settle_remaining_s;/,
  "DHW progress requires a fresh source and the same admitted scope as the chart");
assert.match(cReport,
  /logic::checkup_apply_freshness\(report, source_fresh, source_age_s, span_s\); return report; \}$/,
  "no later report population may reintroduce current state after the freshness gate");
assert.match(body(checkup, "void expire_restored_locked(CheckupSlot& slot) {"),
  /const int64_t pending_start_us = static_cast<int64_t>\(slot\.state\.bucket\) \* logic::CHECKUP_DT_S \* 1000000LL;/,
  "open-hour expiry must use the bucket start, not rejuvenating it at the last sample");
assert.match(body(checkup, "void expire_restored_locked(CheckupSlot& slot) {"),
  /if \(slot\.state\.have_bucket && logic::checkup_restored_expired\(logic::checkup_live_expiry_us\(pending_start_us\), now_us\)\)/,
  "the open hour needs a valid bucket and the same start-based expiry across pauses and producer stalls");
assert.match(body(checkup, "void expire_restored_locked(CheckupSlot& slot) {"),
  /slot\.P\(\)\.ring\.pending = logic::CheckupBucket\{\};[\s\S]*changed = true; \} if \(changed\) checkup_persist_seal\(slot\);/,
  "pending-only expiry must reseal even when no completed slot expired");
const gapCallback = body(poll, "static void checkup_record_poll_gap(");
assert.match(gapCallback, /bool profile_confirmed = false\)/,
  "temporary gap callbacks preserve capabilities unless their caller explicitly withdraws them");
assert.match(gapCallback,
  /(?:static constexpr logic::CheckupCoverage kEmptyCoverage\{\};\s*)?checkup_record\(nullptr, 0, false, false, (?:kEmptyCoverage|logic::CheckupCoverage\{\}), generation, checkup_consent_epoch\(\), profile_confirmed\);/,
  "the gap helper forwards its caller's capability decision and captures the current consent");
assert.equal(count(task, /checkup_record_poll_gap\(generation\);/g), 3,
  "the TLS hold and both OOM handlers preserve resolved profile capabilities");
assert.equal(count(task, /checkup_record_poll_gap\(generation, true\);/g), 1,
  "the unidentified-profile path still explicitly withdraws profile capability");

// The blind-time and DHW-scope rules in logic/checkup.hpp are host-tested; these pin the facts the
// target glue feeds them. An empty sweep (a held or failed cycle) is the one blind sample: neither
// a constant nor a later overwrite may replace it.
assert.match(cRecord, /s\.x10a_blind = !n;/,
  "the X10A sample's blindness must come from the empty-sweep condition");
assert.match(body(checkup, "void checkup_record_modbus("), /s\.x10a_blind = !n;/,
  "the Modbus sample's blindness must come from the empty-sweep condition");
assert.equal(count(checkup, /\.x10a_blind =/g), 2,
  "no other assignment may override the empty-sweep blindness of either source sample");
// Every restart of DHW evidence without the shared lifecycle stamps its scope start, so a DHW
// window cannot claim full-day coverage across that restart.
assert.match(dhwReset, /slot\.dhw_scope_us = esp_timer_get_time\(\);/,
  "the DHW-only reset must stamp the DHW scope start");
assert.match(cFlash, /energy_reset_pending, energy_retired\)\) slot\.dhw_scope_us = now_us;/,
  "a restore that refuses DHW identity must stamp the DHW scope at the restore instant");
assert.match(persistRebuild, /dhw_retired = dhw_retired \|\| !keep_dhw;/);
assert.match(persistRebuild, /if \(dhw_reset_requested \|\| !dhw_source_fp\) \{ dhw\.buf\[p\] = DhwLossBucket\{\}; dhw_retired = true; \}/,
  "a kept live hour loses only its DHW bucket when the circulation identity is gone");
assert.match(cFlash, /const int64_t now_us = esp_timer_get_time\(\);/,
  "the restore instant must be the current monotonic time");
assert.equal(count(checkup, /slot\.dhw_scope_us = /g), 3,
  "the DHW scope changes only at the shared wipe, the DHW-only reset and the refused restore");

// The consent generation the journal admission compares: the first opt-in from the default 0 takes
// the platform random draw, so a counter restarted after a lost config cannot re-admit old records.
const httpConfig = code("main/http_config.cpp");
assert.match(httpConfig, /#include "esp_random\.h"/,
  "the consent handler must include the platform random source");
const setDiagnostics = body(httpConfig, "static esp_err_t set_diagnostics(httpd_req_t* req)");
const nextGeneration =
  "c.diagnostics_generation = diagnostics_next_generation(c.diagnostics_generation, esp_random());";
assert.ok(setDiagnostics.includes(nextGeneration),
  "set_diagnostics must pass esp_random() as the generation entropy");
assert.ok(setDiagnostics.indexOf(nextGeneration) < setDiagnostics.indexOf("config_save(c)"),
  "the new generation must be persisted by the transition's own save");
assert.equal(count(httpConfig, /c\.diagnostics_generation = diagnostics_next_generation\(/g), 1,
  "no second consent transition may advance the generation without the random draw");
// Late completions of already journaled start hours. logic/checkup_persist.hpp decides which hour
// is armed, when a revision retires, which record is next, which hours lose their DHW identity and
// which copies a boot restores; test_logic.cpp checks those rules and replays the 13-run witness
// through them. These pin the target glue: every fold arms through the pure rule, the writer takes
// and emits the revision through it, only the journal's own commit confirms it, and the boot scan
// indexes checkup records solely through the pure index.
const fold = body(checkup, "void fold_checkup_locked(");
assert.equal(count(checkup, /logic::checkup_step\(/g), 1,
  "the checkup is folded only through fold_checkup_locked");
assert.equal(count(cCommitFold, /fold_checkup_locked\(slot, s, now\);/g), 2,
  "both the hour-boundary and the ordinary sample fold arm late completions");
assert.equal(count(cRecord, /commit_and_fold_locked\(s_x10a,/g), 1,
  "X10A commits through commit_and_fold_locked");
assert.equal(count(body(checkup, "void checkup_record_modbus("), /commit_and_fold_locked\(s_modbus,/g), 1,
  "Modbus commits through commit_and_fold_locked");
assert.ok(fold.indexOf("const bool run_open = slot.state.run_open;") <
          fold.indexOf("logic::checkup_step("),
  "the open run and its start hour are captured before the fold closes them");
assert.match(fold,
  /if \(!logic::checkup_step\([^;]*\)\) return; logic::checkup_journal_revision_arm\(slot\.revision, run_open, run_start\);/,
  "only a fold that booked something arms, through the pure oldest-start-hour rule");
const flashNext = body(checkup, "bool checkup_flash_next(");
const take = "logic::checkup_journal_revision_take( slot.revision, slot.revision_acked.load(), newest, current, live_count, after_bucket)";
assert.ok(flashNext.includes(take),
  "the revision maps through the same live anchor as the record and retires on its own commit");
assert.match(flashNext,
  /logic::checkup_journal_next_target\(after_bucket, newest, live_count, revision\)/,
  "the writer's next record comes from the pure target rule");
assert.ok(flashNext.indexOf(take) < flashNext.indexOf("logic::checkup_journal_next_target("),
  "the revision is settled before the next record is chosen");
assert.match(flashNext,
  /if \(logic::checkup_journal_revision_emit\(slot\.revision, target, revision\)\) slot\.revision_acked\.store\(INT64_MIN\);/,
  "an earlier commit of the same bucket must not retire a new revision");
assert.match(body(checkup, "void persist_wipe("), /slot\.revision = \{\};/,
  "a wipe withdraws a pending revision together with its hours");
assert.match(checkup, /void checkup_flash_appended\(int64_t bucket, DiagnosticsSource source\) \{ slot_for\(source\)\.revision_acked\.store\(bucket\); \}/,
  "the journal's commit confirmation writes the acknowledgement");
assert.equal(count(checkup, /revision_acked\.store\(/g), 2,
  "only the emit reset and the journal's commit confirmation write the acknowledgement");
// One wall-clock label per monotonic hour for the whole boot, in the writer and in the restore's
// live records alike; a record's end time is kept inside the bucket its label names.
assert.equal(count(checkup, /latched_newest_locked\(/g), 4,
  "the writer, the restore and the planned-restart seal label hours through the boot latch");
assert.match(flashNext, /const int64_t newest = latched_newest_locked\(slot, latest_end_unix_s\);/);
assert.match(flashNext, /logic::checkup_journal_end_in_bucket\( latest_end_unix_s - static_cast<int64_t>\(age\) \* logic::CHECKUP_DT_S, target\)/);
assert.match(cFlash, /const int64_t newest_label = latched_newest_locked\(slot, latest_end\);/);
assert.match(cFlash, /live\.newest_label = newest_label; live\.newest_end_unix_s = latest_end;/);
assert.match(body(code("main/logic/checkup_persist.hpp"), "inline constexpr int64_t checkup_journal_live_end("),
  /return checkup_journal_end_in_bucket\( live\.newest_end_unix_s - static_cast<int64_t>\(live\.count - 1 - k\) \* CHECKUP_DT_S, checkup_journal_live_label\(live, k\)\);/,
  "a live hour's end stays inside the bucket its latched label names");
// A DHW-only restart empties the hours before it: an append made later never presents them as
// the current circulation source's evidence.
assert.match(dhwReset, /slot\.dhw_restart_armed = true; slot\.dhw_restart_bucket = logic::checkup_bucket\(slot\.dhw_scope_us\);/,
  "the DHW-only reset records its monotonic hour");
assert.match(flashNext,
  /if \(logic::checkup_journal_dhw_withheld\(slot\.dhw_restart_armed, slot\.dhw_restart_bucket, current, age\)\) \{ payload\.dhw_source_fp = 0; payload\.dhw = kEmptyDhwLossBucket; \}/,
  "pre-restart hours carry no DHW identity");
const energyReset = body(checkup, "bool apply_energy_reset_locked(");
assert.match(energyReset, /slot\.P\(\)\.energy\.head = slot\.P\(\)\.ring\.head; slot\.P\(\)\.energy\.count = slot\.P\(\)\.ring\.count;/,
  "energy-only reset keeps the shared hourly geometry so checkup and DHW persistence stay writable");
assert.match(energyReset, /slot\.energy_restart_armed = true; slot\.energy_restart_bucket = logic::checkup_bucket\(slot\.energy_scope_us\);/,
  "the energy-only reset records its monotonic hour");
assert.match(flashNext,
  /if \(logic::checkup_journal_energy_withheld\(slot\.energy_restart_armed, slot\.energy_restart_bucket, current, age\)\) \{ payload\.pel_source_fp = 0; payload\.energy = kEmptyEnergyBucket; \}/,
  "pre-restart hours withhold old electrical identity while retaining ring and dhw buckets");
assert.match(body(checkup, "bool sealed_flash_next_locked("),
  /logic::checkup_journal_energy_withheld\( slot\.energy_restart_armed, slot\.energy_restart_bucket, slot\.state\.bucket \+ 1, 0\)\) \{ payload\.pel_source_fp = 0; payload\.energy = kEmptyEnergyBucket; \}/,
  "sealed open hour withholds old electrical identity after an energy-only reset");
assert.match(persistRebuild,
  /if \(energy_reset_requested \|\| !pel_source_fp\) \{ energy\.buf\[p\] = EnergyBucket\{\}; energy_retired = true; \}/,
  "a kept live hour loses only its energy bucket when the electrical identity is gone");
assert.match(body(checkup, "void persist_wipe("), /slot\.dhw_restart_armed = false;/);
const appendAt2 = body(history, "esp_err_t flash_append_record_at(");
assert.match(appendAt2,
  /s_flash_last_bucket\[src\] = r\.header\.bucket;[^}]*if \(src == static_cast<size_t>\(logic::HistoryJournalSource::Checkup\)\) checkup_flash_appended\(r\.header\.bucket\);/,
  "only a verified data commit of the checkup source confirms a revision");
assert.match(appendAt2, /checkup_flash_appended\(r\.header\.bucket, DiagnosticsSource::Modbus\);/,
  "Modbus checkup appends acknowledge only the Modbus revision");
const scan = body(history, "bool flash_journal_scan()");
assert.match(scan, /if \(src == checkup_src\) \{[^]*?logic::checkup_journal_index_step\(s_flash_checkup_index, r\.header\.bucket\)/,
  "checkup records are indexed only through the pure revision-aware index");
assert.match(scan, /logic::checkup_journal_index_step\( s_flash_mb_checkup\.index, r\.header\.bucket\)/,
  "Modbus checkup records are indexed independently through the pure revision-aware index");
assert.match(scan, /clip_checkup_index\(s_flash_checkup_index,/,
  "X10A checkup candidates are clipped to the window ending at the newest indexed hour");
assert.match(scan, /clip_checkup_index\(s_flash_mb_checkup\.index,/,
  "Modbus checkup candidates are clipped to the window ending at the newest indexed hour");
const clipCheckup = body(history, "void clip_checkup_index(");
assert.match(clipCheckup, /logic::checkup_journal_index_retained\(ix, i\)/,
  "the shared clip helper retains only candidates in the window ending at the newest indexed hour");
assert.doesNotMatch(scan, /CHECKUP_COMPLETED_BUCKETS/,
  "the trend retention path no longer carries a checkup branch");

// A software restart dates the open hour for the shutdown drain. esp_restart runs shutdown
// handlers in reverse registration order, so the seal registers after the history drain; it runs
// after the queued resets, freezes the record path, and is offered only after every live hour.
const startup = code("main/main.cpp");
assert.ok(startup.indexOf("daik::history_start();") >= 0 &&
  startup.indexOf("daik::history_start();") < startup.indexOf("daik::checkup_start("),
  "the checkup shutdown handler must register after history's drain so it runs first");
const rebootSave = body(checkup, "void checkup_reboot_save()");
assert.ok(rebootSave.indexOf("apply_dhw_reset_locked(s_x10a);") < rebootSave.indexOf("seal_open_hour_locked(*slot);") &&
          rebootSave.indexOf("apply_dhw_reset_locked(s_modbus);") < rebootSave.indexOf("seal_open_hour_locked(*slot);"),
  "queued resets retire the open hour before it can be sealed");
const sealOpen = body(checkup, "void seal_open_hour_locked(");
assert.match(sealOpen, /time_now\(unix_s, ms\);/);
assert.match(sealOpen,
  /logic::checkup_seal_end_unix_s\(\s*unix_s, now_us, slot\.P\(\)\.ring\.latest_sample_us, slot\.state\.bucket\)/);
assert.match(sealOpen, /newest = latched_newest_locked\(slot, unix_s - \(now_us - slot\.last_commit_us\) \/ 1000000\);/);
assert.match(sealOpen, /logic::checkup_seal_bucket\(end, newest, covered\)/);
assert.match(cRecord, /if \(s_x10a\.seal_bucket != INT64_MIN\) return;/,
  "a sealed open hour must not change before the drain journals it");
assert.equal(count(flashNext, /return sealed_flash_next_locked\(slot, after_bucket, bucket, payload\);/g), 1,
  "the sealed hour is offered only when no live hour is due, from one inlinable call site");
assert.ok(flashNext.indexOf("checkup_journal_next_target") <
  flashNext.lastIndexOf("sealed_flash_next_locked"), "every live target is appended first");
const sealedNext = body(checkup, "bool sealed_flash_next_locked(");
assert.match(sealedNext, /logic::checkup_seal_emits\(slot\.seal_bucket, after_bucket\)/);
assert.match(sealedNext, /payload\.checkup = slot\.P\(\)\.ring\.pending; payload\.dhw = slot\.P\(\)\.dhw\.pending;/);
assert.match(body(checkup, "void persist_wipe("), /slot\.seal_bucket = slot\.seal_end_unix_s = INT64_MIN;/,
  "a wipe leaves no sealed hour to journal");

// Single-sweep X10A `pel` and `cop` capability must come from `poll_once()`'s adjudicated profile
// pass rather than a second `with_config` / `def::lookup` walk or an unbudgeted `noinline` callee
// underneath `history_record()`'s 3.1 KiB local arrays on `poll_task`'s 8 KiB stack.
function verifyPollHistoryStackBoundary(historySrc, pollSrc) {
  const histRec = body(historySrc, "void history_record(const CachedValue");
  const evalDerived = body(historySrc, "SweepDerivedSamples evaluate_sweep_derived(");
  const pollOnce = body(pollSrc, "inline static void poll_once()");
  if (/derived_coverage_for_target/.test(historySrc)) return "derived_coverage_for_target present";
  if (/__attribute__\s*\(\(\s*noinline\s*\)\)\s*SweepDerivedSamples/.test(historySrc))
    return "evaluate_sweep_derived marked noinline";
  if (!/\[\[gnu::always_inline\]\]\s*inline\s+SweepDerivedSamples\s+evaluate_sweep_derived\b/.test(historySrc))
    return "evaluate_sweep_derived not always_inline";
  if (/\b(?:with_config|lookup|adjudicated)\s*\(/.test(histRec) || /\b(?:with_config|lookup|adjudicated)\s*\(/.test(evalDerived))
    return "Config/profile walk inside history_record";
  if (!/s_poll_cop_inputs/.test(evalDerived))
    return "HistoryCopInputs not in static poll scratch";
  const setCovAt = pollOnce.indexOf("history_set_derived_coverage(history_coverage);");
  const recAt = pollOnce.indexOf("history_record(fresh.data(), fresh.size(), cycle_generation);");
  if (setCovAt < 0 || recAt < 0 || setCovAt >= recAt)
    return "poll_once does not hand off history_coverage before history_record";
  if (!/logic::history_cover_derived_row\(history_coverage,\s*row\.label,\s*unit_for_row\(row\),\s*row\.reg,\s*row\.offset,\s*row\.conv\);/.test(pollOnce))
    return "poll_once does not populate history_coverage from adjudicated publishable rows";
  return "";
}
assert.equal(verifyPollHistoryStackBoundary(history, poll), "",
  "poll_once must pass static derived coverage into always_inline evaluate_sweep_derived without stacking noinline/Config frames on poll_task");
// Negative controls: reintroducing an unbudgeted noinline child frame, a Config/profile walk, or a
// missing poll_once handoff must fail this contract check.
assert.equal(verifyPollHistoryStackBoundary(
  history.replace("[[gnu::always_inline]] inline SweepDerivedSamples", "__attribute__((noinline)) SweepDerivedSamples"),
  poll), "evaluate_sweep_derived marked noinline");
assert.equal(verifyPollHistoryStackBoundary(
  history.replace("if (!cov.pel_supported()) return out;", "with_config([](const Config&){}); if (!cov.pel_supported()) return out;"),
  poll), "Config/profile walk inside history_record");
assert.equal(verifyPollHistoryStackBoundary(
  history, poll.replace("history_set_derived_coverage(history_coverage);", "")),
  "poll_once does not hand off history_coverage before history_record");

console.log("history restore guard contract: ok");
