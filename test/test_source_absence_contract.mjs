// THE ABSENCE CONTRACT — the firmware half of the source-absence matrix.
//
// test_ui_absence_matrix.mjs walks what the BROWSER says when an optional source is gone, but it can
// only ever be as honest as the /status it is handed: it consumes a payload, so it cannot see which
// task produced a field, whether a ring has an owner that a branch can skip, or whether an absent
// feature is reported as absence or as an empty buffer. Those are claims about whole components, and
// the only instrument that settles them is source TEXT — the same argument run-contract-tests.sh
// makes for the Modbus write path and the MQTT lifecycle.
//
// The rules below pin both shipped defects and the shared shape behind them: an optional source
// which goes away must take its derived artefacts with it — its trend, retained topic and verdict —
// and must never take anything else with it.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const history = read("main/history.cpp");
const checkup = read("main/checkup.cpp");
const checkupPersist = read("main/logic/checkup_persist.hpp");
const poll = read("main/hp_poll.cpp");
const pollHeader = read("main/hp_poll.hpp");
const modbus = read("main/hp_modbus.cpp");
const mqtt = read("main/mqtt_ha.cpp");
const httpConfig = read("main/http_config.cpp");
const configSource = read("main/config.cpp");
const status = read("main/http_status.cpp");
const chunks = read("main/http_chunks.hpp");
const mcp = read("main/mcp_server.cpp");
const chunkSink = read("main/logic/chunk_sink.hpp");
const redact = read("main/logic/redact.hpp");
const mqttPublishGate = read("main/logic/mqtt_publish_gate.hpp");

// Preserve the circulation receiver's independent epoch, decode and allocation boundaries.
const captureFrame = mqtt.slice(mqtt.indexOf("static void capture_circulation_frame("),
  mqtt.indexOf("struct DecodedCirculationFrame"));
assert.match(captureFrame,
  /if \(e->current_data_offset == 0\) \{[\s\S]*?s_inbound_rx\.circulation_epoch\s*=\s*s_circulation_requested_epoch\.load/,
  "a fragmented circulation frame must keep the epoch of its first fragment");
const decoder = mqtt.slice(mqtt.indexOf("decode_circulation_frame("),
  mqtt.indexOf("static MqttSourceFreshness circulation_frame_freshness("));
assert.match(decoder, /JsonGuard root\(cJSON_ParseWithLengthOpts/,
  "MQTT parsed input trees must unwind through a scoped owner");
assert.doesNotMatch(decoder, /cJSON_Delete\(root\)/);
assert.match(mqtt,
  /const uint32_t circulation_epoch\s*=\s*s_circulation_requested_epoch\.load[\s\S]{0,130}?const Config cycle_config = config\(\)/,
  "capture the circulation request epoch before copying Config");
const circulationFrames = mqtt.slice(mqtt.indexOf("void service_circulation_frame("),
  mqtt.indexOf("void service_circulation_frames("));
assert.match(circulationFrames,
  /circulation_request_current_locked\(frame\.circulation_epoch, c\)[\s\S]*?candidate\s*=\s*s_circulation_status/,
  "circulation decoding must snapshot only the matching applied Config and frame request");
assert.match(circulationFrames,
  /if \(!circulation_request_current_locked\(frame\.circulation_epoch, c\)\) return;\s*s_circulation_status\s*=\s*std::move\(candidate\);\s*s_circulation_tracker\s*=\s*tracker;\s*s_circulation_source_time\s*=\s*source_time;/,
  "circulation raw values, counters, tracker and source clock must commit atomically after staging");
assert.doesNotMatch(circulationFrames, /s_circulation_status\.[a-z_]+\s*(?:=|\+\+)/,
  "circulation allocation failure must preserve every field of the previous raw aggregate");
const circulationReconfigure = mqtt.slice(mqtt.indexOf("void mqtt_circulation_reconfigure("),
  mqtt.indexOf("void mqtt_request_modbus_cleanup()"));
assert.match(circulationReconfigure,
  /if \(lk\.acquired\(\)\) \{\s*reset_circulation_status_locked\(configured\);/,
  "circulation status reset requires the shared lock");
assert.ok(circulationReconfigure.indexOf("reset_circulation_status_locked(configured)") >= 0 &&
  circulationReconfigure.indexOf("history_circulation_reset()") >
    circulationReconfigure.indexOf("reset_circulation_status_locked(configured)"),
  "circulation reconfigure must withdraw the old witness before invalidating its consumers");
assert.doesNotMatch(circulationReconfigure, /s_circulation_source_time\.(reset|accept)/,
  "policy/consent/label wakeups cannot roll back the circulation accepted source clock");

// ── 1. The BOARD's own trends have ONE owner, and it is not the heat pump ───────────────────────
// free_heap/max_alloc describe the ESP32. They used to be folded inside history_record(), which is
// reached only from poll_once(), which the poll task calls only once a profile is RESOLVED — so a
// board whose X10A never answers (wrong pins, unplugged cable, unit off) kept the profile on "auto"
// forever and recorded no heap curve at all. The two memory rows then vanished from
// /status.history.rows entirely, on precisely the board someone is diagnosing. poll_once()'s own
// UART-init early return did the same to a resolved profile.
assert.match(history, /void history_record_board\(\)\s*\{[\s\S]*?advance_raster_locked\([\s\S]*?fold_board_locked\(/,
  "history_record_board() must advance the shared raster and fold the board trends");
// The assertion is that nothing BRANCHES between the record and the detect/sweep decision — not that
// the two lines are adjacent. heap_guard_sample() is the other unconditional cycle-top reading of the
// board's own state (it decides whether an exhausted heap has stopped recovering, logic/heap_watchdog
// .hpp), and it belongs in exactly the same place for exactly the same reason, so the pattern admits
// sibling STATEMENTS while still refusing an `if` or a `return`.
// `^\s*` (multiline) anchors the call to the START of its line, so it is a STATEMENT rather than a
// branch consequent. Without it the pattern anchors on the call text wherever it appears, and
// `if (something) history_record_board();` matches exactly as well as the unconditional form — the
// assertion would then permit the very defect it was written for, since the board trends' original
// failure was being reachable only when the heat pump was.
const prologue = poll.match(
  /^\s*history_record_board\(\);((?:\s*\n\s*(?:\/\/[^\n]*|[A-Za-z_][A-Za-z0-9_:]*\([^;]*\);))*)\s*\n\s*if \((?:config\(\)\.profile|config_profile\(\)) == "auto"\)/m);
assert.ok(prologue,
  "the poll task must record the board trends BEFORE it decides whether to detect or to sweep — " +
  "inside either branch is what made them depend on the heat pump being reachable");
// The heap watchdog rides that same guarantee: it samples on the one path in this task that no
// branch can skip. Behind the detect/sweep decision it would stop watching the heap on exactly the
// board whose X10A never answers — the absence the assertion above exists for, one feature over.
//
// Asserted against the CAPTURED PROLOGUE — the run of comments and bare statements the match above
// proved contains no branch — and not as a second, free-standing "these two calls are near each
// other" search. That distinction is the whole assertion: a proximity pattern spans the `if` line
// happily, so it holds just as well when the call has been moved INSIDE the detect branch. Measured
// — with the previous `[\s\S]{0,600}?` form, moving `heap_guard_sample()` behind
// `if (config().profile == "auto")` passed this file with exit 0, which is precisely the defect the
// board trends already shipped once, one feature over.
assert.ok(prologue[1].includes("heap_guard_sample();"),
  "heap_guard_sample() must sit with history_record_board() at the unconditional top of the cycle, " +
  "before the detect/sweep branch — not merely somewhere nearby");
// ...and exactly one owner: a second fold inside history_record() would put them back behind
// poll_once(), which is the branch that could skip them.
assert.doesNotMatch(history, /fold_board_locked\([^)]*\);[\s\S]*?fold_board_locked\(/,
  "the board trends must have a single producer");
assert.match(history, /if \(board_trend\(d\)\) continue;/,
  "history_record()'s row loop must SKIP board trends, leaving them to history_record_board()");

// ── 1b. The .noinit restore is decided BEFORE a producer task exists ───────────────────────────
// checkup_start() and history_start() adopt or wipe ~30 KB of prior state by reading memory nothing
// has initialised. That is only single-threaded — and therefore lock-free, which is how both are
// written — while no task can be folding into those rings yet. Ordering is the whole safety
// argument, and it lives in one file, so a source-text check is exactly the instrument for it:
// moving either call after hp_poll_start()/mqtt_start() would race a producer against a wipe, and
// nothing else here could see it.
const mainCpp = read("main/main.cpp");
const startAt   = mainCpp.indexOf("checkup_start(");
const histAt    = mainCpp.indexOf("history_start()");
const dwellAt   = mainCpp.indexOf("dwell_start()");
const pollAt    = mainCpp.indexOf("hp_poll_start(");
assert.ok(startAt > 0 && histAt > 0 && dwellAt > 0 && pollAt > 0,
  "main.cpp must start the trends, the checkup, the state ages and the poll task");
assert.ok(startAt < pollAt && histAt < pollAt && dwellAt < pollAt,
  "history_start(), checkup_start() and dwell_start() must run BEFORE the poll task: all three " +
  "adopt or wipe .noinit state without a lock, which is only sound while no producer exists");

// ── 1c. Each poll worker must re-prove the branch from ITS OWN config snapshot ───────────────────────
// The two config() calls in poll_task() are only routing hints. There are two adversarial windows:
// (1) it observes "auto", then /set_hp installs a concrete profile before poll_detect() starts;
// (2) it observes a concrete profile, then /detect installs "auto" before poll_once() starts.
// Generation/CAS checks reject changes AFTER a worker has captured its own snapshot, but cannot
// reject either change that completed BEFORE that capture. Pin both snapshot-owned mode guards
// ahead of the first bus/decode operation so neither stale task-level decision can touch the bus or
// publish a result for the opposite mode.
const pollOnceStart = poll.indexOf("static void poll_once()");
const pollDetectStart = poll.indexOf("static bool poll_detect()");
const pollDetectEnd = poll.indexOf("// The cycle body allocates freely", pollDetectStart);
assert.ok(pollOnceStart >= 0 && pollDetectStart > pollOnceStart && pollDetectEnd > pollDetectStart,
  "hp_poll.cpp must retain independently inspectable poll_once() and poll_detect() workers");

const pollOnceBody = poll.slice(pollOnceStart, pollDetectStart);
const onceSnapshotAt = pollOnceBody.search(/const\s+Config\s*&\s*c\s*=\s*config\(\)\s*;/);
const onceModeGuardAt = pollOnceBody.search(
  /if\s*\(c\.profile\s*==\s*"auto"\)\s*(?:\{\s*retire_saturation_witness\(\);\s*)?return;/);
const onceDecodeAt = pollOnceBody.indexOf("def::lookup(c.profile.c_str())");
const onceBusAt = pollOnceBody.indexOf("hp_uart_init(c.rx_pin, c.tx_pin)");
assert.ok(onceSnapshotAt >= 0 && onceModeGuardAt > onceSnapshotAt &&
          onceDecodeAt > onceModeGuardAt && onceBusAt > onceModeGuardAt,
  "poll_once must fail closed on its OWN auto snapshot before profile lookup or UART work; this " +
  "closes concrete->auto between poll_task's branch and the worker snapshot");

const pollDetectBody = poll.slice(pollDetectStart, pollDetectEnd);
const detectSnapshotAt = pollDetectBody.search(/const\s+Config\s+expected\s*=\s*config\(\)\s*;/);
const detectModeGuardAt = pollDetectBody.indexOf('if (expected.profile != "auto") return true;');
const detectSweepAt = pollDetectBody.search(/(?:DetectResult\s+)?d\s*=\s*hp_detect_run\(\)\s*;/);
const detectCommitAt = pollDetectBody.indexOf("config_commit_detected_link(");
assert.ok(detectSnapshotAt >= 0 && detectModeGuardAt > detectSnapshotAt &&
          detectSweepAt > detectModeGuardAt && detectCommitAt > detectSweepAt,
  "poll_detect must fail closed on its OWN concrete snapshot before the sweep and commit; this " +
  "closes auto->concrete between poll_task's branch and the worker snapshot");

assert.match(checkupPersist,
  /checkup_restore_keeps_dhw_handoff\(CheckupRestore r\) \{\s*return r == CheckupRestore::Accept \|\| r == CheckupRestore::NotCommitted;/,
  "an integrity-valid one-shot DHW candidate survives a not-committed completed-hour refusal");

// Only the ongoing DHW candidate may cross an intentional reboot. Completed pending counters
// have no absolute age and must be cleared both when sealing and when staging a valid handoff.
// The shutdown lock remains bounded: a busy observer can cost a candidate, never strand OTA.
assert.match(checkup, /constexpr logic::DhwLossBucket\s+kEmptyDhwLossBucket\{\};/,
  "the empty pending-counter template retains the production bucket defaults");
assert.match(checkup,
  /void checkup_reboot_save\(\)[\s\S]*?(?:Lock\s+lk\(s_mtx,\s*pdMS_TO_TICKS\(200\)\)|xSemaphoreTake\(s_mtx,\s*pdMS_TO_TICKS\(200\)\))[\s\S]*?dhw_loss_checkpoint\(slot->dhw_state,[\s\S]*?h\.payload\.pending\s*=\s*kEmptyDhwLossBucket/,
  "intentional reboot must checkpoint only the ongoing DHW candidate and clear undated pending counters under a bounded lock");
assert.doesNotMatch(checkup, /h\.payload\.pending\s*=\s*slot->P\(\)\.dhw\.pending/,
  "undated completed pending counters must not enter the reboot checkpoint");
assert.match(checkup,
  /checkup_restore_keeps_dhw_handoff\(integrity\)[\s\S]*?checkup_dhw_handoff_valid\([\s\S]*?slot\.boot_handoff\s*=\s*slot\.P\(\)\.dhw_handoff\.payload;\s*slot\.boot_handoff\.pending\s*=\s*kEmptyDhwLossBucket/,
  "startup must stage only an integrity-valid candidate and explicitly discard its undated pending counters");
assert.doesNotMatch(checkup, /P\(\)\.dhw\.pending\s*=\s*(?:slot\.P\(\)\.dhw_handoff\.payload|slot\.boot_handoff)\.pending/,
  "startup must not restore undated completed pending counters");
assert.match(checkup,
  /if \(s_x10a\.source_confirmed && s_x10a\.boot_handoff_valid[\s\S]*?s_diagnostics_enabled\.load\(std::memory_order_acquire\)[\s\S]*?s_x10a\.boot_handoff_model == fp[\s\S]*?s_x10a\.boot_handoff\.source_fp == source_fp[\s\S]*?s_x10a\.boot_handoff\.dhw_source_fp == s_x10a\.dhw_source_fp\) \{\s*logic::dhw_loss_adopt\(s_x10a\.dhw_state,\s*s_x10a\.boot_handoff\.candidate,\s*esp_timer_get_time\(\)\)/,
  "DHW adoption requires current consent, matching model/link and circulation identities, and the real boot clock");
assert.match(checkup,
  /slot\.P\(\)\.dhw_handoff\.magic = 0;[\s\S]*?slot\.source_confirmed\s*=\s*false;[\s\S]*?persist_wipe\(slot\);/,
  "startup must consume the one-shot handoff before producers and retire undated completed RAM hours");
// Adoption may retain only a charge/settle deadline, or reject a carried segment after the blind
// allowance. A neutral applied-checkpoint log must not claim that every candidate resumed.
assert.match(checkup,
  /scoped DHW filter checkpoint applied; undated completed counters(?:\s|"\s*")*discarded/,
  "the applied-checkpoint log must stay neutral when adoption discards or only carries settle state");
assert.doesNotMatch(checkup, /scoped DHW candidate resumed/,
  "a rejected or settle-only handoff must never be logged as a resumed candidate");
assert.match(checkup, /esp_register_shutdown_handler\(checkup_reboot_save\)/,
  "checkup_start must register the intentional-reboot DHW handoff");

// ── 1c. Every .noinit region must be UNINITIALISED storage ─────────────────────────────────────
// `__NOINIT_ATTR` places an object in a NOLOAD section; it does NOT stop C++ from initialising it.
// Both ring types here carry non-static data member initialisers, several non-zero, so a PLAIN
// definition gets an implicit default constructor that runs at startup and re-initialises exactly
// those members — while the bare scalars around them (magic, version, crc) are left untouched.
//
// That is not a theoretical hazard. It shipped: the checkup's window was rejected on the reference
// board as `bad_crc` after a real reboot, because the header survived and passed the magic, version
// and layout checks while the rings had been quietly reset under it. It reads as corrupted DRAM and
// is a missing four characters. history.cpp had already solved it with a union carrying a
// user-provided empty constructor, and documented why — and the second implementation reintroduced
// the bug anyway, which is exactly when a mechanical check earns its place.
//
// Asserted over source text because it is a property of a DECLARATION that no host test can reach:
// the failure is created by the compiler, downstream of anything `logic/` can see.
for (const f of ["main/history.cpp", "main/checkup.cpp", "main/state_dwell.cpp"]) {
  const src = read(f);
  const decls = [...src.matchAll(/__NOINIT_ATTR\s+(\w+)\s+(\w+)\s*;/g)];
  assert.ok(decls.length > 0, `${f} must still declare its .noinit region`);
  for (const [, type] of decls) {
    const def = new RegExp(`union\\s+${type}\\s*\\{[\\s\\S]*?${type}\\(\\)\\s*\\{\\s*\\}`);
    assert.match(src, def,
      `${f}: __NOINIT_ATTR ${type} must be a UNION with a user-provided empty constructor, or the ` +
      `members carrying data-member initialisers are silently re-initialised at every boot while ` +
      `the bare scalars beside them survive — the shape that reports as bad_crc`);
  }
}

// ── 2. An unconfigured source is stated by ABSENCE, never by an empty chart ─────────────────────
// The circulation ring used to be labelled unconditionally, so /status.history.rows offered a trend
// the device could never fill and the Diagnostics card drew "no readings yet" under a row reading
// "not configured". Its two siblings were already gated; this is that rule for the third.
// The window is bounded rather than "the very next line": the branch also carries the persistence
// seal's dirty bookkeeping (legacy-391), and pinning adjacency would make this fail for a change that
// cannot affect what it asserts. What it still asserts is the thing that matters — inside the
// not-configured branch, the label is cleared.
assert.match(history,
  /fold_circulation_locked[\s\S]*?if \(!circulation\.configured\) \{[\s\S]{0,240}?tr\.label\[0\] = '\\0';/,
  "an unconfigured circulation witness must clear its trend label so /status stops offering it");
assert.match(status, /if \(mb\.enabled\) \{[\s\S]*?HOMEHUB_HISTORIES/,
  "HomeHub trends must be offered only while that stack is enabled");
assert.match(status, /if \(env_enabled\) \{[\s\S]*?ENV3_HISTORIES/,
  "ENV III trends must be offered only while that sensor is enabled");
const historyRoute = status.slice(status.indexOf("static esp_err_t h_history("));
assert.match(historyRoute, /bool\s+env3_configured\s*=\s*false;/);
assert.match(historyRoute,
  /const Config active_config = config\(\);\s*env3_configured = active_config\.env3_enabled && env3_board_supported\(active_config\);[\s\S]*?env3_source && \(!env3_configured \|\| env_t < 0\)/,
  "an explicitly requested ENV III history must fail closed while the source is disabled");

// ── 3. A never-started task must not make a CONFIGURED source read as absent ────────────────────
// `configured` answers "did the user set this up", which is a fact about the CONFIG. Reading it off
// a task-maintained status struct would report false whenever that task does not exist — no broker,
// or safe mode — and the UI would then offer to set up something already set up.
for (const [block, field] of [
  ["circulation_source", "c.circulation_topic"],
]) {
  const re = new RegExp(`"${block}\\\\":\\{\\\\"configured\\\\":";\\s*\\n\\s*j \\+= ${
    field.replace(/[.]/g, "\\.")}\\.empty\\(\\) \\? "false" : "true";`);
  assert.match(status, re,
    `/status.${block}.configured must come from the config, not from a task's status struct`);
}
// config_save() must not discover another allocation failure after the first durable write. Stage
// both serialized blobs and the exact RAM successor first; publication after the writes is a noexcept
// move. The sequence is config_save_transaction(), which save_whole() runs for both config_save and
// the X10A config_save_link() (the X10A path skips the service blob but stages the same way).
const transactionSource = read("main/logic/config_transaction.hpp");
const configSaveStart = transactionSource.indexOf("ConfigSaveOutcome config_save_transaction(");
const configSaveEnd = transactionSource.indexOf("\ntemplate <class Store>", configSaveStart);
const configSaveBody = transactionSource.slice(configSaveStart, configSaveEnd);
const serviceSerialize = configSaveBody.indexOf("config_blob_serialize(b)");
const linkSerialize = configSaveBody.indexOf("link_blob_serialize(", serviceSerialize);
const stagedConfigMatch = configSaveBody.slice(linkSerialize)
  .search(/Config\s+published\s*=\s*std::move\(c\)/);
const stagedConfig = stagedConfigMatch < 0 ? -1 : linkSerialize + stagedConfigMatch;
const serviceWrite = configSaveBody.indexOf("store.write_blob(CONFIG_KEY_SERVICE", stagedConfig);
const linkWrite = configSaveBody.indexOf("store.write_blob(CONFIG_KEY_LINK", serviceWrite);
const ramPublishMatch = configSaveBody.slice(linkWrite)
  .search(/live\s*=\s*std::move\(published\)/);
const ramPublish = ramPublishMatch < 0 ? -1 : linkWrite + ramPublishMatch;
assert.ok(configSaveStart >= 0 && configSaveEnd > configSaveStart && serviceSerialize >= 0 &&
  linkSerialize > serviceSerialize && stagedConfig > linkSerialize && serviceWrite > stagedConfig &&
  linkWrite > serviceWrite && ramPublish > linkWrite,
  "config_save must finish every allocation before its first NVS write and publish staged RAM last");
assert.match(configSaveBody,
  /static_assert\(std::is_nothrow_move_assignable_v<Config>/,
  "the only post-NVS Config publication operation must be statically non-throwing");
assert.match(configSource, /config_save_transaction\(g_cfg, requested, owns_link, store, s_load_yield,\s*require_current\)/,
  "save_whole must run the transaction whose staging order is pinned above");

const cleanupStart = mqtt.indexOf("static RetainedCleanupCycle service_requested_topic_cleanup(");
const cleanupEnd = mqtt.indexOf("static void publish_env3_state(", cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
const cleanup = mqtt.slice(cleanupStart, cleanupEnd);
assert.match(mqtt,
  /#include "logic\/mqtt_cleanup\.hpp"/,
  "retained cleanup scheduling must live in an IDF-free host-tested boundary");
const weatherRequest = cleanup.indexOf("s_weather_cleanup_requested.exchange(false");
const modbusRequest = cleanup.indexOf("s_modbus_cleanup_requested.exchange(false");
const env3Request = cleanup.indexOf("s_env3_cleanup_requested.exchange(false");
const ackBefore = cleanup.indexOf("service_source_cleanup_evidence()", env3Request);
const nextAction = cleanup.indexOf("s_source_cleanup.next_action", ackBefore);
const trackedPublish = cleanup.indexOf('mqtt_enqueue_id(topic, "", 0, 1, 1)', nextAction);
const rememberId = cleanup.indexOf("s_source_cleanup.publish_queued(epoch, msg_id)", trackedPublish);
const ackAfter = cleanup.indexOf("service_source_cleanup_evidence()", rememberId);
assert.ok(weatherRequest >= 0 && modbusRequest > weatherRequest && env3Request > modbusRequest &&
  ackBefore > env3Request && nextAction > ackBefore && trackedPublish > nextAction &&
  rememberId > trackedPublish && ackAfter > rememberId,
"all source requests must enter one PUBACK-tracked queue outside the X10A gate");
assert.doesNotMatch(cleanup, /retract_(?:weather|modbus|env3)_discovery\(1\)/,
  "source discovery cleanup must be sequential rather than a reconnect burst");
const mqttTaskStartForCleanup = mqtt.indexOf("static void mqtt_task(");
const cleanupCall = mqtt.indexOf("service_requested_topic_cleanup(cycle_config)",
                                  mqttTaskStartForCleanup);
const publishCycle = mqtt.indexOf("if (gate.publish_cycle)", cleanupCall);
assert.ok(cleanupCall >= 0 && publishCycle > cleanupCall,
  "explicit Weather cleanup must run even when X10A has not admitted a publish cycle");
const mqttConnected = mqtt.indexOf("case MQTT_EVENT_CONNECTED:");
const mqttDisconnected = mqtt.indexOf("case MQTT_EVENT_DISCONNECTED:", mqttConnected);
const connectedHandler = mqtt.slice(mqttConnected, mqttDisconnected);
assert.match(connectedHandler,
  /s_connected_client_epoch\.store\(s_mqtt_client_epoch\.load/,
  "a new client epoch must reconstruct all retained cleanup through the pure scheduler");
assert.doesNotMatch(connectedHandler, /s_(?:weather|modbus|env3)_cleanup_requested\.store/,
  "same-client reconnect must not blindly duplicate a queued QoS-1 tombstone");
assert.ok(cleanupCall > mqttDisconnected && cleanupCall < publishCycle,
  "reconstructed Weather cleanup must be serviced outside the X10A publication gate");
const publishCycleBody = mqtt.slice(publishCycle);
assert.match(mqtt, /s_weather_cleanup_requested\s*\{true\}/,
  "the retired retained forecast is withdrawn on the first reachable broker session");
assert.doesNotMatch(mqtt, /publish_weather_state|publish_heating_curve_telemetry/,
  "retired state cannot be recreated after a tombstone");
assert.doesNotMatch(status, /\\"(?:heating_curve|weather_forecast|reference_temperature|room_rows)\\":/,
  "the status serializer must never offer the retired sources");
assert.match(publishCycleBody,
  /if \(!cleanup_cycle\.modbus\)[\s\S]*?retained_source_action\(mb_target_enabled\(\), s_modbus_disabled_cleaned\)/,
  "a HomeHub cleanup must suppress same-cycle recreation and later follow target intent");
assert.doesNotMatch(publishCycleBody, /mb_status\(\)\.enabled/,
  "HomeHub task lifetime must not be used as current source-publication intent");
assert.match(mqttPublishGate,
  /if \(target_enabled\) return RetainedSourceAction::PublishCurrent;[\s\S]*?retained_deleted \? RetainedSourceAction::Idle\s*:\s*RetainedSourceAction::DeleteRetained/,
  "disabled+deleted HomeHub state must stay idle while enabled A-to-B remains publishable");
const setHpStart = httpConfig.indexOf("static esp_err_t set_hp(");
const setHpEnd = httpConfig.indexOf("static esp_err_t discover_homehub_now", setHpStart);
const setHp = httpConfig.slice(setHpStart, setHpEnd);
const mbFingerprint = setHp.indexOf("const uint32_t modbus_target_fp");
const mbEnabled = setHp.indexOf("const bool modbus_enabled", mbFingerprint);
const mbSave = setHp.indexOf("} else if (!config_save(c))", mbEnabled);
const mbHistoryReset = setHp.indexOf("history_modbus_reset(modbus_target_fp)", mbSave);
const mbReconfigure = setHp.indexOf("mb_reconfigure(modbus_enabled)", mbHistoryReset);
const mbCleanupRequest = setHp.indexOf("mqtt_request_modbus_cleanup()", mbReconfigure);
assert.ok(mbFingerprint >= 0 && mbEnabled > mbFingerprint && mbSave > mbEnabled,
  "HomeHub post-save cutover values must be staged before the durable boundary");
assert.ok(mbHistoryReset > mbSave && mbReconfigure > mbHistoryReset &&
          mbCleanupRequest > mbReconfigure,
  "HomeHub generation/cache invalidation must precede predecessor cleanup admission");
assert.match(history,
  /void history_modbus_reset\(uint32_t target_fp\) noexcept/,
  "HomeHub history cutover must accept a staged POD fingerprint without a Config copy");
const mbHistoryResetStart = history.indexOf(
  "void history_modbus_reset(uint32_t target_fp) noexcept");
const mbHistoryResetEnd = history.indexOf(
  "\nuint32_t history_modbus_generation()", mbHistoryResetStart);
const mbHistoryResetBody = history.slice(mbHistoryResetStart, mbHistoryResetEnd);
assert.ok(mbHistoryResetStart >= 0 && mbHistoryResetEnd > mbHistoryResetStart,
  "HomeHub history cutover must remain an identifiable no-throw boundary");
assert.doesNotMatch(mbHistoryResetBody, /current_mb_target_fp\s*\(|\bconfig\s*\(/,
  "HomeHub history cutover must not reconstruct the target through a Config allocation");
const mbReconfigureStart = modbus.indexOf("void mb_reconfigure(bool enabled) noexcept");
const mbReconfigureEnd = modbus.indexOf("\nsize_t mb_values_capacity()", mbReconfigureStart);
const mbReconfigureBody = modbus.slice(mbReconfigureStart, mbReconfigureEnd);
assert.ok(mbReconfigureStart >= 0 && mbReconfigureEnd > mbReconfigureStart,
  "HomeHub runtime cutover must remain explicitly noexcept");
assert.doesNotMatch(mbReconfigureBody, /\bconfig\s*\(/,
  "HomeHub runtime cutover must not allocate by copying Config after persistence");
const mbTaskStart = modbus.indexOf("static void mb_task(void*)");
const mbTaskEnd = modbus.indexOf("static void mb_task_start_if_enabled()", mbTaskStart);
const mbTask = modbus.slice(mbTaskStart, mbTaskEnd);
const mbDisableIntent = mbTask.indexOf(
  "if (!s_target_enabled.load(std::memory_order_acquire)) break;");
const mbTlsHold = mbTask.indexOf("if (ota_download_active())");
assert.ok(mbDisableIntent >= 0 && mbTlsHold > mbDisableIntent,
  "HomeHub disable must retire the task before TLS delay and any Config allocation");
assert.doesNotMatch(mbTask, /config_modbus_host\(config\(\)\)\.empty\(\)/,
  "HomeHub disable must not loop forever when a Config snapshot cannot allocate");
assert.match(setHp.slice(mbReconfigure, mbCleanupRequest + 80),
  /if \(modbus_was_enabled\) mqtt_request_modbus_cleanup\(\);/,
  "an enabled HomeHub identity change must retract its predecessor, not only a disable");

// Retained dedup state is an acknowledgement cache, not a build cache. A failed broker publish must
// leave it unchanged so the next cycle retries the exact current document/discovery.
const modbusPublishStart = mqtt.indexOf("static bool publish_modbus_state(bool& published_live)");
const modbusPublishEnd = mqtt.indexOf("\n}\n\nstruct RetainedCleanupCycle", modbusPublishStart) + 2;
const modbusPublish = mqtt.slice(modbusPublishStart, modbusPublishEnd);
assert.match(modbusPublish,
  /if \(!s_last_modbus_digest\.matches\(js\)\) \{\s*if \(!mqtt_publish\(s_modbus,[\s\S]*?\)\) return false;\s*s_last_modbus_digest\.record\(js\);\s*\}/,
  "HomeHub dedup may advance only after the broker accepts current state");
const env3PublishStart = mqtt.indexOf("static void publish_env3_state()");
const env3PublishEnd = mqtt.indexOf("\n}\n\n// Stream one retained", env3PublishStart) + 2;
const env3Publish = mqtt.slice(env3PublishStart, env3PublishEnd);
assert.match(env3Publish,
  /if \(new_sample \|\| !s_last_env3_digest\.matches\(js\)\) \{\s*if \(mqtt_publish\(s_env3,[\s\S]*?\)\) \{\s*s_last_env3_digest\.record\(js\);\s*s_last_env3_samples\s*=\s*env\.samples;\s*\}\s*\}/,
  "ENV III value and sample acknowledgements must advance only after publish success");
assert.match(mqtt,
  /static bool publish_env3_discovery\(\)[\s\S]*?if \(!mqtt_publish\([^;]*\)\) ok = false[\s\S]*?return ok/,
  "ENV III discovery must report partial broker failure");
assert.match(mqtt,
  /if \(!s_env3_discovery_announced\)[\s\S]*?if \(publish_env3_discovery\(\)\)[\s\S]*?s_env3_discovery_announced = true/,
  "ENV III discovery may be acknowledged only after every config publish succeeds");

// ── 5. Redaction must not invent an identifier that does not exist ──────────────────────────────
// A bug report is a public GitHub issue whose first question is which optional sources this
// installation is even running. "<redacted>" over an EMPTY field answers it wrongly: a device with
// no witness, no HomeHub and no collector reads exactly like one that has all three and hid them.
// mqtt.broker is the sharpest case — empty IS the disabled state.
assert.match(redact,
  /inline std::string_view redact_identifier_view\(std::string_view value, bool on\) \{\s*\n\s*return on && !value\.empty\(\)/,
  "the streamed identifier wrapper must leave an unset value alone");
assert.match(status,
  /static RedactedJson jstr_r\(std::string_view s, bool redact\) noexcept \{\s*\n\s*return \{redact_identifier_view\(s, redact\), true\};/,
  "the /status builder's identifier wrapper must use redact_identifier_view, not the raw primitive");

// ── 6. An ABSENT array and an EMPTY one are different claims ────────────────────────────────────
// Only absence says "no current reading". /values omits the HomeHub key entirely when that link is
// not live, rather than shipping [] under a guarantee that every row in it was read this cycle.
assert.match(status,
  /if \(mb_status\(\)\.connected\) \{[\s\S]*?mb_values_snapshot\([\s\S]*?snapshot\.modbus_live = live;/,
  "/values must prove HomeHub liveness against the copied cache before transfer starts");
assert.match(status,
  /if \(snapshot\.modbus_live\) \{\s*\n\s*j \+= ",\\"modbus\\":";\s*\n\s*append_modbus_values_array\(j, snapshot\.modbus\);/,
  "/values must emit the HomeHub array only while that link is live, and omit the key otherwise");

// The complete 129-row target body is larger than the contiguous block a healthy running board can
// commonly provide. Both GET /values and MCP must therefore reuse the exact serializer through the
// production bounded sink, never rebuild the whole JSON or a secondary whole HomeHub array.
assert.match(chunks,
  /using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 1024>;/,
  "values responses must bind the host-tested sink to a strict 1 KiB HTTP chunk bound");
assert.match(chunkSink,
  /while \(!value\.empty\(\)\)[\s\S]*?const size_t take = std::min\(available, value\.size\(\)\)[\s\S]*?value\.remove_prefix\(take\)/,
  "one oversized append must be split before it can grow the production buffer past its bound");
assert.match(status,
  /esp_err_t http_send_values_json\([\s\S]*?ValuesSnapshot snapshot = take_values_snapshot\(\);[\s\S]*?HttpJsonChunks j\(HttpChunkEmitter\{req\}\);[\s\S]*?return finish_bounded_stream\(j,\s*\[prefix, suffix, &snapshot\]\(auto& out\)\s*\{\s*out \+= prefix;\s*append_values_json\(out, snapshot\);\s*out \+= suffix;\s*\}\)\s*\? ESP_OK\s*: ESP_FAIL;/,
  "the shared sender must snapshot before guarded prefix + values + suffix emission and propagate failure");
assert.match(chunkSink,
  /inline bool finish_bounded_stream\(Sink& sink, Append&& append\)\s*\{\s*try\s*\{\s*std::forward<Append>\(append\)\(sink\);\s*return sink\.finish\(\);\s*\}\s*catch\s*\(\.\.\.\)\s*\{\s*if\s*\(!sink\.emission_started\(\)\)\s*throw;\s*return false;/,
  "stream failures must rethrow before emission for 503/500 and abort after emission without finishing");
const valuesSerializerStart = status.indexOf("static void append_values_array(");
const valuesSerializerEnd = status.indexOf("\n}\n\n// The HomeHub rows", valuesSerializerStart);
assert.ok(valuesSerializerStart >= 0 && valuesSerializerEnd > valuesSerializerStart,
  "the source contract must be able to isolate the streamed X10A row serializer");
const valuesSerializer = status.slice(valuesSerializerStart, valuesSerializerEnd);
assert.doesNotMatch(valuesSerializer, /object_id\(|std::to_string\(/,
  "streamed X10A rows must not allocate after the first response chunk");
assert.match(status,
  /snapshot\.x10a_label_ambiguous\.resize\([\s\S]*?label_slug_is_ambiguous\(object_id\(snapshot\.x10a\[i\]\.label\)\)/,
  "allocating label classification must be staged before the response stream is constructed");
assert.match(status,
  /static void append_json_uint\([\s\S]*?char digits\[20\][\s\S]*?out \+= std::string_view/,
  "streamed numeric fields must use the fixed stack formatter rather than an owning string");
assert.match(status, /static esp_err_t h_values\(httpd_req_t\* req\) \{\s*\n\s*return http_send_values_json\(req\);/,
  "GET /values must use the shared bounded sender");
assert.match(mcp,
  /mcp_tool_result_begin\(response, "Current device and heat-pump status\."\);[\s\S]{0,400}?mcp_tool_result_end\(suffix\);[\s\S]{0,200}?mcp_result_end\(suffix\);[\s\S]{0,200}?return http_send_status_json\(req, response, suffix, false\);/,
  "MCP get_status must stream its JSON-RPC prefix and suffix around the shared status object");
assert.match(mcp,
  /mcp_tool_result_begin\(response, "Current decoded heat-pump readings\."\);[\s\S]{0,400}?mcp_tool_result_end\(suffix\);[\s\S]{0,200}?mcp_result_end\(suffix\);[\s\S]{0,200}?return http_send_values_json\(req, response, suffix\);/,
  "MCP get_hp_values must stream its JSON-RPC prefix and suffix around the shared values object");
assert.doesNotMatch(mcp, /http_append_values_json\s*\(\s*response\s*\)/,
  "MCP must never materialise the complete values object in its response string");
assert.doesNotMatch(status, /build_modbus_values_array|const std::string arr\s*=/,
  "HomeHub rows must stream into the same bounded sink instead of a secondary whole-array string");

// ── 7. A SILENT BUS must age the state ages out, not freeze them ────────────────────────────────
// The per-row state ages (logic/state_dwell.hpp) claim how long a flag has read what it reads, so
// they are only true while somebody is watching. Every path through the poll cycle that produces no
// readable rows must still call dwell_record(): that is what books blind seconds and eventually
// stops the row claiming anything at all. Miss one and the table simply stops moving — every
// duration frozen at the instant the bus went quiet and still presented as current, which is the
// exact failure the feature exists to prevent, arriving through a missing call rather than a wrong
// rule. THREE paths reach it, and the two failure paths are the ones a refactor drops.
assert.match(poll, /if \(!hp_uart_init\([\s\S]{0,900}?dwell_record\(nullptr, 0, cycle_generation\);/,
  "a cycle that could not bring up the UART must book blind time, not skip the table");
assert.match(poll, /if \((?:config\(\)\.profile|config_profile\(\)) == "auto"\)[\s\S]{0,2200}?dwell_record\(nullptr, 0, generation\);/,
  "a board whose X10A never resolves a profile must age its restored state ages out, or a reboot " +
  "would present the frozen pre-reboot durations as current");
// The reduction has to read `fresh` — the rows that ANSWERED this cycle — and not the committed
// cache, which no longer knows which rows were missing. A row absent from `fresh` IS the evidence.
const dwellCheckupAt = poll.indexOf("checkup_record(fresh.data()");
const dwellTokenAt = poll.indexOf("HpValuesIdentity pending_cache_identity;", dwellCheckupAt);
const dwellFoldAt = poll.indexOf("dwell_record(fresh.data()", dwellTokenAt);
const commitAt = poll.search(/logic::commit_cached_values_in_place\(s_cache,\s*fresh\)/);
assert.ok(dwellCheckupAt >= 0 && dwellTokenAt > dwellCheckupAt && dwellFoldAt > dwellTokenAt &&
          commitAt > dwellFoldAt,
  "poll must stage the next cache identity, fold dwell from fresh rows, then commit those rows");
assert.match(poll.slice(dwellTokenAt, dwellFoldAt),
  /\{\s*Lock lk\(s_mtx\);\s*if \(s_target_generation\.load\(std::memory_order_acquire\) != cycle_generation\) return;\s*pending_cache_identity = \{prof\.id, c\.x10a_identity_fp, cycle_generation,\s*s_cache_revision \+ 1\};\s*\}/,
  "the prospective dwell token must include the profile, source and next revision under the cache lock");
assert.match(poll.slice(dwellFoldAt, commitAt),
  /dwell_record\(fresh\.data\(\), fresh\.size\(\),\s*cycle_generation,\s*static_cast<uint32_t>\(\(service_max_gap_us \+ 999999\) \/ 1000000\),\s*&pending_cache_identity\);/,
  "the normal dwell fold must preserve fresh-row absence, the service-gap bound and its cache token");
assert.match(poll.slice(commitAt),
  /logic::commit_cached_values_in_place\(s_cache,\s*fresh\);\s*s_cache_profile\s*= prof\.id;\s*s_cache_identity_fp\s*= c\.x10a_identity_fp;\s*\+\+s_cache_revision;\s*s_cache_source_generation = cycle_generation;/,
  "the committed cache must update rows in place (freeing excess storage outside s_mtx) and publish the same profile, source generation and staged next revision");

// ── 8. `known == false` renders as an ABSENT key, never as a zero ───────────────────────────────
// Section 6's rule one field down. A dwell of 0 is a real reading ("it changed just now"); a row the
// device declines to describe must therefore omit the key entirely, or a silent bus reads as a plant
// whose every flag just switched.
assert.match(status, /if \(dw\.known\) \{\s*\n\s*j \+= ",\\"dwell_s\\":";/,
  "/values must emit a state age only when the device has one to state");
// And only for a row that STATES A VALUE. The slot outlives a row the sweep could not read — that is
// what booking blind seconds means — but such a row is published as `"value":null`, and an age
// beside a value that is not there describes nothing: rendered, the pair reads "— for 3 h 20 min".
assert.match(status, /logic::dwell_row_tracked\(v\[i\]\.reg, v\[i\]\.off, v\[i\]\.conv\) && !v\[i\]\.value\.empty\(\)/,
  "/values must withhold the state age for a row it is publishing as null");

// ── 9. Whole seconds come from ABSOLUTE timestamps, never from a floored interval ───────────────
// The poll loop sleeps a whole second AFTER a serial sweep, so the real cadence is ~1.2-1.3 s.
// Flooring each interval and restarting the clock from `now` discards that fraction every cycle and
// it never returns — measured, 23% slow forever, so a three-hour state publishes as "2 h 19 min".
// checkup_step() already states this rule; the dwell shipped the defect it warns about, so assert
// the SHAPE rather than trusting that the next edit remembers.
const dwellSrc = read("main/state_dwell.cpp");
// The lock is created BEFORE any producer exists, like history_start()/checkup_start(). Created
// lazily in the 1 Hz record path instead, the httpd task's dwell_reading() reads the raw handle
// while another core writes it — the unsynchronized read of the very pointer that synchronizes
// everything else in the file, which checkup.cpp carries a note about having removed.
assert.match(dwellSrc, /void dwell_start\(\)[\s\S]{0,900}?s_mtx = xSemaphoreCreateMutex\(\);/,
  "dwell_start() must create the table's mutex, before any producer task exists");
assert.doesNotMatch(dwellSrc, /void dwell_record\([\s\S]{0,400}?xSemaphoreCreateMutex/,
  "the 1 Hz record path must not create the mutex — that is the race checkup.cpp removed");
assert.match(dwellSrc, /now_us \/ 1000000 - s_last_us \/ 1000000/,
  "the state ages must quantise absolute instants so the sub-second remainder telescopes");
assert.doesNotMatch(dwellSrc, /\(now_us - s_last_us\) \/ 1000000/,
  "flooring the INTERVAL loses the remainder on every cycle — the defect this rule exists for");
// esp_timer's ZERO is a valid previous instant: an adopted table resumes from it
// (dwell_resume_origin_us(true) below), so its first fold has to book [0, now]. The only "no
// previous observation" value is -1. Reading the guard as "unset" and tightening it to `> 0` looks
// like a cleanup and silently re-opens the boot-to-first-fold gap, because the host CHECKs drive
// dwell_step() with an explicit dt and never reach this line.
assert.match(dwellSrc, /if \(s_last_us >= 0 && now_us >= s_last_us\)\s*dt_s = /,
  "the elapsed guard must accept esp_timer's zero as a previous instant (>= 0, never > 0)");
assert.doesNotMatch(dwellSrc, /\bs_last_us\s*>\s*0\b/,
  "a `s_last_us > 0` test treats the adopted table's zero origin as unset and books nothing");

// An ADOPTED table resumes from esp_timer's zero. dwell_adopt() books only the downtime; the first
// fold of the boot comes after app_main's network wait, and with `s_last_us` left at its -1
// initialiser that fold books dt = 0, so the whole stretch is neither elapsed nor blind and a run
// keeps `exact` across a boot nobody watched. The origin is a host-tested rule, so the glue has to
// ask it rather than hold a literal that the CHECKs cannot see.
const dwellStartBody = dwellSrc.slice(dwellSrc.indexOf("void dwell_start()"),
  dwellSrc.indexOf("const char* dwell_persist_state()"));
const dwellAcceptBranch = dwellStartBody.slice(dwellStartBody.indexOf("DwellRestore::Accept) {"),
  dwellStartBody.indexOf("} else {"));
const dwellWipeBranch = dwellStartBody.slice(dwellStartBody.indexOf("} else {"));
assert.match(dwellAcceptBranch,
  /logic::dwell_adopt\([^;]*\);[\s\S]*?s_last_us = logic::dwell_resume_origin_us\(true\);[\s\S]*?persist_seal\(\);/,
  "an adopted dwell table must resume from dwell_resume_origin_us(true), before the seal — " +
  "otherwise the boot-to-first-fold interval is booked as nothing");
assert.match(dwellWipeBranch,
  /persist_wipe\(\);[\s\S]*?s_last_us = logic::dwell_resume_origin_us\(false\);/,
  "a wiped dwell table has no previous observation: its first fold only anchors");
assert.doesNotMatch(dwellWipeBranch, /dwell_resume_origin_us\(true\)/,
  "only an ADOPTED table may start counting from esp_timer's zero");
// No other writer may hand the clock a literal: the only values s_last_us takes are the sentinel
// (the initialiser, apply_reset_locked(), dwell_forget()), the origin rule's two arms and the
// fold's own `now_us`.
const dwellOriginWrites = [...dwellSrc.matchAll(/\bs_last_us\s*=(?!=)\s*([^;]+);/g)]
  .map((m) => m[1].trim()).sort();
assert.deepEqual(dwellOriginWrites, [
  "-1", "-1", "-1", "logic::dwell_resume_origin_us(false)", "logic::dwell_resume_origin_us(true)",
  "now_us",
].sort(), "s_last_us must be written only by the static sentinel, apply_reset_locked(), " +
  "dwell_forget(), the two origin arms and the fold itself — never a bare 0");

assert.match(status, /if \(!dw\.exact\) j \+= ",\\"dwell_min\\":true";/,
  "an unwitnessed run must carry its lower-bound marker, or the browser states a stronger claim " +
  "than the device made");

// ── 10. A journal record is evidence even when its value is absent ─────────────────────────────
// Fully absent Modbus rows used to lose their complete post-reboot raster because restore searched
// for the first numeric value. The record buckets are the authority for the span; NO_READING is a
// recorded sample, not padding.
assert.match(history,
  /history_flash_restore_start\(\s*s_flash_oldest_bucket\[src_i\], newest, HISTORY_SAMPLES\)/,
  "flash restore must derive the span from journal buckets so an all-null row survives");
assert.doesNotMatch(history, /history_flash_lead_skip/,
  "flash restore must not infer whether a bucket exists from the sample value");

// ── 11. TLS pressure must not require another oversized telemetry allocation ──────────────────
// Labels and units originate in static generated tables. Owning a string copy of each in every
// snapshot made one X10A vector larger than the biggest block left by weather TLS on the reference
// board. The formatted value remains owned; the immutable metadata is borrowed.
assert.match(pollHeader,
  /struct CachedValue\s*\{[\s\S]*?const char\* label[\s\S]*?std::string value[\s\S]*?const char\* unit/,
  "CachedValue must borrow static label/unit metadata so a full snapshot fits beside TLS");
assert.doesNotMatch(pollHeader, /std::string\s+(?:label|unit)\s*;/,
  "CachedValue must not restore per-row owning strings for static metadata");

const mqttTaskStart = mqtt.indexOf("static void mqtt_task(");
const mqttTaskEnd = mqtt.indexOf("static bool build_client(", mqttTaskStart);
const mqttTask = mqtt.slice(mqttTaskStart, mqttTaskEnd);
const mqttOtaBusy = mqttTask.indexOf("ota_download_active()");
const mqttHoldCall = mqttTask.indexOf("mqtt_network_hold_step(network_quiesce, ota_busy", mqttOtaBusy);
const mqttHoldStart = mqtt.search(/static __attribute__\(\(noinline\)\) bool\s+mqtt_network_hold_step\(/);
const mqttHoldEnd = mqtt.indexOf(
  "static __attribute__((noinline)) bool mqtt_transport_resume_step(", mqttHoldStart);
const mqttHold = mqtt.slice(mqttHoldStart, mqttHoldEnd);
assert.ok(mqttTaskStart >= 0 && mqttTaskEnd > mqttTaskStart && mqttOtaBusy >= 0 &&
          mqttHoldCall > mqttOtaBusy && mqttHoldStart >= 0 && mqttHoldEnd > mqttHoldStart,
  "MQTT must check OTA activity before entering its stack-bounded hold helper");
assert.match(mqttHold, /ota_quiesce_step\(quiesce, ota_busy\)/,
  "the MQTT helper must retain the bounded OTA hold-off");
assert.match(poll,
  /network_active = ota_download_active\(\);[\s\S]{0,120}?ota_quiesce_step\(network_quiesce, network_active\)/,
  "X10A polling must retain its bounded hold-off for OTA TLS activity");

console.log("source absence: independent board trends, retained-topic cleanup, state ages, redaction and OTA coordination");

// legacy-407 — the END of the restart ladder. The boot that inherited the full count must come up MINIMAL,
// and that decision has to be made in heap_guard_begin(), which main.cpp runs BEFORE its
// `if (!safe_mode_active())` gate. Made anywhere later it would arrive after the poll engine and the
// MQTT bridge had already started and taken the heap the minimal boot exists to leave free.
//
// This is also what BOUNDS the ladder: safe mode never creates the poll task, heap_guard_sample() is
// only ever called from it, so no further restart is reachable. Asserted over source text because
// it is a claim about which file calls what in which order — the one thing the host suite, which
// links the pure headers alone, structurally cannot see.
const guard = fs.readFileSync(new URL("../main/heap_guard.cpp", import.meta.url), "utf8");
assert.match(guard, /heap_boot_must_be_minimal\(s_restarts\)[\s\S]{0,200}?safe_mode_latch_heap\(\)/,
  "heap_guard_begin() must latch safe mode for a boot that inherited the full restart count");
const mainSrc = fs.readFileSync(new URL("../main/main.cpp", import.meta.url), "utf8");
assert.ok(mainSrc.indexOf("heap_guard_begin()") < mainSrc.indexOf("safe_mode_active()"),
  "heap_guard_begin() must run BEFORE main.cpp's safe-mode gate, or the minimal boot starts the very "
  + "subsystems it exists to leave unstarted");

// Browser lifetime and producer admission are independent. Public source/consent changes publish
// a new lifetime even if a second client restores identical config before the next status poll.
const historySource = read("main/history.cpp");
for (const fn of ["history_reset()", "history_reset_on_detect(uint32_t identity_fp)",
  "history_modbus_reset(uint32_t target_fp) noexcept", "history_circulation_reset()",
  "history_checkup_reset()", "history_flash_forget()"]) {
  const at = historySource.indexOf(fn);
  const next = historySource.indexOf("\n}", at);
  assert.ok(at >= 0 && next > at && historySource.slice(at, next).includes("bump_history_epoch()"),
    `${fn} must retire browser leases at its lifecycle boundary`);
}
assert.match(historySource, /uint32_t history_epoch\(\) noexcept[\s\S]*?memory_order_acquire/);
assert.match(historySource, /compare_exchange_weak[\s\S]*?memory_order_release/);

assert.doesNotMatch(read("main/mqtt_ha.hpp"), /\bcirculation_source_status\(\);/,
  "circulation status must not regain a Config-copying no-argument overload");

// Dual-source fault timeline isolation and redaction contracts:
// X10A and Modbus maintain separate fault traces/resets, shutdown saves respect fault_forgotten,
// and ?redact=1 omits timeline coordinates plus wall-clock start/end timestamps.
assert.match(checkup,
  /checkup_fault_forget\(\)[\s\S]{0,400}?s_x10a\.fault_forgotten\.store\(true[\s\S]{0,120}?s_modbus\.fault_forgotten\.store\(true/,
  "checkup_fault_forget must suppress both independent fault sources");
assert.match(checkup,
  /fault_save_handoff_locked[\s\S]{0,200}?slot\.fault_forgotten\.load\(std::memory_order_acquire\)/,
  "shutdown fault handoff must respect factory-reset suppression");
const faultStatusAt = status.indexOf("append_status_fault_check_json(");
const faultStatusEnd = status.indexOf("static void append_status_json(", faultStatusAt);
assert.ok(faultStatusAt >= 0 && faultStatusEnd > faultStatusAt);
const faultStatusFn = status.slice(faultStatusAt, faultStatusEnd);
assert.match(faultStatusFn,
  /if \(!redact && latest\.start_unix_s > 0\)[\s\S]*?if \(!redact\) \{[\s\S]*?checkup_fault_timeline_snapshot\(/,
  "/status?redact=1 must omit fault timeline segments and wall-clock timestamps while keeping X10A/Modbus isolation");
