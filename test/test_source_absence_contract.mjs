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
const poll = read("main/hp_poll.cpp");
const pollHeader = read("main/hp_poll.hpp");
const modbus = read("main/hp_modbus.cpp");
const mqtt = read("main/mqtt_ha.cpp");
const weather = read("main/weather_forecast.cpp");
const httpConfig = read("main/http_config.cpp");
const configSource = read("main/config.cpp");
const status = read("main/http_status.cpp");
const mcp = read("main/mcp_server.cpp");
const chunkSink = read("main/logic/chunk_sink.hpp");
const redact = read("main/logic/redact.hpp");
const diagnosis = read("main/logic/heating_curve_diagnosis.hpp");
const weatherLogic = read("main/logic/weather_forecast.hpp");
const weatherMqtt = read("main/logic/weather_mqtt.hpp");
const mqttPublishGate = read("main/logic/mqtt_publish_gate.hpp");

// Pure binding/epoch/watermark CHECKs prove the rules; these pin their production owner/callback
// placement, including commits after parsing has yielded to a concurrent HTTP reconfigure.
const captureFrame = mqtt.slice(mqtt.indexOf("static void capture_reference_frame("),
  mqtt.indexOf("static cJSON* reference_json_item("));
assert.match(captureFrame,
  /if \(e->current_data_offset == 0\) \{\s*s_ref_rx\.reference_epoch\s*=\s*s_ref_requested_epoch\.load/,
  "a fragmented MQTT frame must keep the request epoch of its first fragment");
const referenceFrames = mqtt.slice(mqtt.indexOf("static void service_reference_frames("),
  mqtt.indexOf("static void mqtt_transport_before_connect("));
assert.ok(referenceFrames.indexOf("service_circulation_frame(frame, c)") <
  referenceFrames.indexOf("reference_request_current_locked(frame.reference_epoch, c)"),
  "independent circulation frames must be served before a stale room-source epoch is discarded");
const invalidReference = referenceFrames.slice(referenceFrames.indexOf("if (!decoded.valid)"),
  referenceFrames.indexOf("prepared_error_log;"));
assert.match(invalidReference,
  /candidate\.has_value = false/,
  "invalid payload withdrawal must be staged in the uncommitted candidate");
assert.match(referenceFrames,
  /candidate_watermark\.accept\(decoded\.source_unix_s\)/,
  "acceptance must stage the timestamp highwatermark independently of the committed one");
assert.match(referenceFrames,
  /Lock lk\(s_mtx\);\s*if \(!reference_request_current_locked\(frame\.reference_epoch, c\)\) continue;[\s\S]*?s_ref_status\s*=\s*std::move\(candidate\);\s*s_ref_source_time\s*=\s*candidate_watermark;/,
  "valid and invalid status/clock candidates must commit together after the guarded epoch check");
assert.doesNotMatch(referenceFrames, /s_ref_status\.[a-z_]+\s*=/,
  "no field of the committed raw aggregate may change before all throwing staging has finished");
const referenceGetter = mqtt.slice(
  mqtt.indexOf("ReferenceTemperatureStatus reference_temperature_status(const Config&"),
  mqtt.indexOf("logic::HeatingCurveSnapshot heating_curve_status()"));
assert.match(referenceGetter,
  /Lock lk\(s_mtx\);[\s\S]*?reference_request_current_locked\(requested, expected\)[\s\S]*?return s_ref_status/,
  "the room getter must bind raw observations to the caller's exact Config and applied request");
const referenceReconfigure = mqtt.slice(mqtt.indexOf("void mqtt_reference_reconfigure()"),
  mqtt.indexOf("CirculationSourceStatus circulation_source_status(const Config& c)"));
assert.match(referenceReconfigure,
  /Lock\s+lk\(s_mtx\);[\s\S]*?s_ref_requested_epoch\.store[\s\S]*?s_ref_status = ReferenceTemperatureStatus\{\}/,
  "reconfigure must atomically withdraw the old raw sample before the owner task resumes");
// Without the mutex (safe mode, failed boot allocation) no task publishes a status: the epoch bump
// withdraws readers, and the shared defaults are not written unsynchronised.
assert.match(referenceReconfigure,
  /if \(lk\.acquired\(\)\) s_ref_status = ReferenceTemperatureStatus\{\};/,
  "the room status may be reset only under a held mutex");
const circulationReconfigureBody = mqtt.slice(mqtt.indexOf("void mqtt_circulation_reconfigure("),
  mqtt.indexOf("void mqtt_request_weather_cleanup()"));
assert.match(circulationReconfigureBody,
  /if \(lk\.acquired\(\)\) \{\s*reset_circulation_status_locked\(configured\);/,
  "the circulation status may be reset only under a held mutex");
assert.doesNotMatch(referenceReconfigure, /s_ref_source_time\.(reset|accept)/,
  "a no-op wakeup must not discard the accepted source timestamp highwatermark");
const configEpochCapture = mqtt.search(/const uint32_t\s+reference_epoch\s*=\s*s_ref_requested_epoch\.load/);
const referenceConfigCopy = mqtt.indexOf("const Config ref_config = config()", configEpochCapture);
assert.ok(configEpochCapture >= 0 && referenceConfigCopy > configEpochCapture,
  "the owner must capture its request epoch before copying Config");
for (const [begin, end] of [
  ["static DecodedReferenceFrame decode_reference_frame(", "struct DecodedCirculationFrame"],
  ["static DecodedCirculationFrame decode_circulation_frame(", "static ReferenceFreshness circulation_frame_freshness("],
]) {
  const decoder = mqtt.slice(mqtt.indexOf(begin), mqtt.indexOf(end));
  assert.match(decoder, /JsonGuard root\(cJSON_ParseWithLengthOpts/,
    "MQTT parsed input trees must unwind through a scoped owner on string allocation failure");
  assert.doesNotMatch(decoder, /cJSON_Delete\(root\)/,
    "MQTT scoped input trees must not also be deleted manually");
}

const circulationFrames = mqtt.slice(mqtt.indexOf("static void service_circulation_frame("),
  mqtt.indexOf("static void service_reference_frames("));
assert.match(circulationFrames,
  /circulation_request_current_locked\(frame\.circulation_epoch, c\)[\s\S]*?candidate\s*=\s*s_circulation_status/,
  "circulation decoding must snapshot only the matching applied Config and frame request");
assert.match(circulationFrames,
  /if \(!circulation_request_current_locked\(frame\.circulation_epoch, c\)\) return;\s*s_circulation_status\s*=\s*std::move\(candidate\);\s*s_circulation_tracker\s*=\s*tracker;\s*s_circulation_source_time\s*=\s*source_time;/,
  "circulation raw values, counters, tracker and source clock must commit atomically after staging");
assert.doesNotMatch(circulationFrames, /s_circulation_status\.[a-z_]+\s*(?:=|\+\+)/,
  "circulation allocation failure must preserve every field of the previous raw aggregate");
const circulationReconfigure = mqtt.slice(mqtt.indexOf("void mqtt_circulation_reconfigure("),
  mqtt.indexOf("void mqtt_request_weather_cleanup()"));
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
const onceSnapshotAt = pollOnceBody.indexOf("const Config& c    = config();");
const onceModeGuardAt = pollOnceBody.indexOf('if (c.profile == "auto") return;');
const onceDecodeAt = pollOnceBody.indexOf("def::lookup(c.profile.c_str())");
const onceBusAt = pollOnceBody.indexOf("hp_uart_init(c.rx_pin, c.tx_pin)");
assert.ok(onceSnapshotAt >= 0 && onceModeGuardAt > onceSnapshotAt &&
          onceDecodeAt > onceModeGuardAt && onceBusAt > onceModeGuardAt,
  "poll_once must fail closed on its OWN auto snapshot before profile lookup or UART work; this " +
  "closes concrete->auto between poll_task's branch and the worker snapshot");

const pollDetectBody = poll.slice(pollDetectStart, pollDetectEnd);
const detectSnapshotAt = pollDetectBody.indexOf("const Config expected = config();");
const detectModeGuardAt = pollDetectBody.indexOf('if (expected.profile != "auto") return true;');
const detectSweepAt = pollDetectBody.indexOf("DetectResult d = hp_detect_run();");
const detectCommitAt = pollDetectBody.indexOf("config_commit_detected_link(");
assert.ok(detectSnapshotAt >= 0 && detectModeGuardAt > detectSnapshotAt &&
          detectSweepAt > detectModeGuardAt && detectCommitAt > detectSweepAt,
  "poll_detect must fail closed on its OWN concrete snapshot before the sweep and commit; this " +
  "closes auto->concrete between poll_task's branch and the worker snapshot");

// The DHW loss filter needs one whole clean hour.  Its candidate and any completed-but-still-open
// window are checkpointed exactly at intentional esp_restart(), rather than being reset by every
// dev-channel OTA shorter than an hour.  The handler is bounded so a busy observer can cost one
// candidate but can never strand an already-installed OTA image.
assert.match(checkup,
  /void checkup_reboot_save\(\)[\s\S]*?(?:Lock\s+lk\(s_mtx,\s*pdMS_TO_TICKS\(200\)\)|xSemaphoreTake\(s_mtx,\s*pdMS_TO_TICKS\(200\)\))[\s\S]*?dhw_loss_checkpoint\(s_dhw_state,[\s\S]*?h\.payload\.pending\s*=\s*P\(\)\.dhw\.pending/,
  "intentional reboot must checkpoint both the in-flight DHW candidate and completed pending windows under a bounded lock");
assert.match(checkup,
  /checkup_dhw_handoff_valid\([\s\S]*?P\(\)\.dhw\.pending\s*=\s*P\(\)\.dhw_handoff\.payload\.pending;[\s\S]*?dhw_loss_adopt\(/,
  "boot must restore the separately sealed DHW handoff before producers start");
assert.match(checkup, /esp_register_shutdown_handler\(checkup_reboot_save\)/,
  "checkup_start must register the intentional-reboot DHW handoff");
// The adoption derives the unobserved boot uptime from its `now_us` (dhw_loss_adopt_blind_s:
// esp_timer's zero is the boot, and checkup_start() runs behind app_main's network wait). The glue
// therefore has to pass the real clock; a literal would put the defect back with every CHECK green.
// The clock is read ONCE into a local declared directly above the call, and the same local is what
// the restart report is judged against (below), so the line cannot describe a different instant
// than the one the adoption booked. The call is deliberately three-argument: it takes no bucket,
// because a candidate it discards is not entered in the discarded-window count (as a blind abort
// the board-side restart cause would be worded "X10A not answering" by the UI).
assert.match(checkup,
  /const\s+int64_t\s+(\w+)\s*=\s*esp_timer_get_time\(\)\s*;\s*logic::dhw_loss_adopt\(\s*s_dhw_state,\s*P\(\)\.dhw_handoff\.payload\.candidate,\s*\1\s*\)/,
  "the DHW adoption must be handed one esp_timer_get_time() reading so the boot uptime is booked as blind");
// A carried candidate segment that the adoption ended (segment_start_us back at -1) must be reported
// as discarded, with the unobserved seconds booked at the SAME instant; only the other outcomes may
// read "kept". Logging the discard as "kept (0 min ...)" told a syslog reader the opposite.
assert.match(checkup,
  /logic::dhw_loss_adopt\([^;]*?(\w+)\s*\);[\s\S]*?DHW_LOSS_CARRY_SEGMENT[\s\S]*?s_dhw_state\.segment_start_us\s*<\s*0[\s\S]*?carried DHW candidate discarded[\s\S]*?dhw_loss_adopt_blind_s\(\s*\1\s*\)[\s\S]*?DHW candidate kept/,
  "a carried DHW candidate that the adoption discarded must be logged as discarded with the booked blind seconds, not as kept");

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
assert.match(status,
  /const bool env3_configured\s*=\s*active_config\.env3_enabled && env3_board_supported\(active_config\);[\s\S]*?env3_source && \(!env3_configured \|\| env_t < 0\)/,
  "an explicitly requested ENV III history must fail closed while the source is disabled");

// ── 3. A never-started task must not make a CONFIGURED source read as absent ────────────────────
// `configured` answers "did the user set this up", which is a fact about the CONFIG. Reading it off
// a task-maintained status struct would report false whenever that task does not exist — no broker,
// or safe mode — and the UI would then offer to set up something already set up.
for (const [block, field] of [
  ["reference_temperature", "c.ref_temp_topic"],
  ["circulation_source", "c.circulation_topic"],
]) {
  const re = new RegExp(`"${block}\\\\":\\{\\\\"configured\\\\":";\\s*\\n\\s*j \\+= ${
    field.replace(/[.]/g, "\\.")}\\.empty\\(\\) \\? "false" : "true";`);
  assert.match(status, re,
    `/status.${block}.configured must come from the config, not from a task's status struct`);
}
assert.match(status, /const bool weather_configured = c\.weather_enabled;/,
  "/status.weather_forecast.configured must come from the config");
assert.match(weather,
  /hourly=temperature_2m,relative_humidity_2m,surface_pressure,shortwave_radiation/,
  "the graphical climate forecast must be additive and retain the solar evidence input");
assert.match(status,
  /\\"hourly\\":\[.*hourly_temperature_c.*hourly_humidity_pct.*hourly_pressure_hpa/s,
  "/status must expose bounded timestamped climate points for the future graph");
const weatherStatusStart = status.indexOf("// Direct Open-Meteo forecast.");
const weatherStatusEnd = status.indexOf('j += "},";', weatherStatusStart);
const weatherStatus = status.slice(weatherStatusStart, weatherStatusEnd);
assert.ok(weatherStatusStart >= 0 && weatherStatusEnd > weatherStatusStart,
  "/status Weather serialization must remain an identifiable complete operation");
assert.match(weatherStatus,
  /const bool\s+weather_safe_mode\s*=\s*safe_mode_active\(\)[\s\S]*?weather_source_active\s*=\s*weather_configured && c\.diagnostics_enabled && !weather_safe_mode[\s\S]*?weather_has_value\s*=\s*weather_source_active && wf\.has_value/,
  "Weather values must have active source, diagnostics-consent and non-safe-mode authority");
assert.match(weatherStatus,
  /if \(!weather_configured\)[\s\S]*?weather\.reason = "not_configured"[\s\S]*?else if \(weather_safe_mode\)[\s\S]*?weather\.reason = "safe_mode"[\s\S]*?else if \(!c\.diagnostics_enabled\)[\s\S]*?weather\.reason = "diagnostics_disabled"/,
  "Weather freshness must state the same intentional absence reason as its visible source state");
assert.match(weatherStatus,
  /!weather_configured\s*\?\s*"disabled"[\s\S]*?: weather_safe_mode\s*\?\s*"waiting"[\s\S]*?: !c\.diagnostics_enabled\s*\?\s*"disabled"/,
  "Weather visible state must distinguish unconfigured, safe-mode and consent-disabled absence");
assert.match(weatherStatus,
  /if \(weather_source_active && !wf\.error\.empty\(\)\)/,
  "an intentionally absent Weather source must not leak a contradictory worker error");

// Weather values are source-bound evidence, not a cache which may survive consent or identity
// changes. Invalidation clears every scalar, series and timestamp synchronously; the RAM generation
// additionally closes A -> B -> A and diagnostics off -> on ABA races around an in-flight fetch.
const invalidateStart = weather.indexOf("WeatherForecastStatus invalidated_status_for(");
const invalidateEnd = weather.indexOf("\n}\n\nstatic_assert", invalidateStart);
assert.ok(invalidateStart >= 0 && invalidateEnd > invalidateStart,
  "Weather invalidation must remain an identifiable complete operation");
const invalidate = weather.slice(invalidateStart, invalidateEnd);
for (const field of ["available", "has_value", "outdoor_mean_2h_c", "solar_energy_2h_wh_m2",
  "hourly_count", "hourly_unix_s", "hourly_temperature_c", "hourly_humidity_pct",
  "hourly_pressure_hpa", "issued_unix_s", "fetched_unix_s", "decision_unix_s",
  "last_attempt_unix_s", "successes", "errors", "latitude", "longitude"]) {
  assert.match(invalidate, new RegExp(`replacement\\.${field}`),
    `Weather invalidation must clear source-bound ${field}`);
}
assert.match(invalidate, /diagnostics_disabled[\s\S]{0,100}?location_changed/,
  "Weather must distinguish missing consent from a changed configured location");
assert.match(weatherLogic,
  /WeatherTaskStartState[\s\S]*?NotStarted[\s\S]*?Available[\s\S]*?DeadlineUnavailable[\s\S]*?TaskStartFailed/,
  "Weather task availability must have explicit boot-latched states");
assert.match(weather,
  /std::atomic<WeatherTaskStartState>\s+s_task_start_state\s*\{\s*WeatherTaskStartState::NotStarted\s*\}/,
  "Weather must fail closed until its worker has actually become available");
assert.match(weather, /std::atomic<TaskHandle_t>\s+s_task\s*\{\s*nullptr\s*\}/,
  "Weather must publish its post-http-start task handle without a C++ data race");
assert.match(weather,
  /static_assert\(std::atomic<TaskHandle_t>::is_always_lock_free/,
  "Weather task-handle publication must remain lock-free on the firmware target");
assert.match(invalidate,
  /weather_task_failure\(\s*configured,\s*diagnostics_enabled,\s*task_state\s*\)[\s\S]*?if \(task_failure\)[\s\S]*?replacement\.state\s*=\s*"error"[\s\S]*?task_failure\.reason[\s\S]*?task_failure\.error/,
  "Weather invalidation must map an explicit task-start state to a fail-closed source status");
assert.match(invalidate,
  /WeatherForecastStatus invalidated_status\([\s\S]*?invalidated_status_for\(\s*configured,\s*diagnostics_enabled,\s*s_task_start_state\.load\([^)]*\)\s*\)/,
  "task-side Weather invalidation must consume the boot-latched task state");
const weatherStart = weather.slice(weather.indexOf("void weather_forecast_start()"),
  weather.indexOf("void weather_forecast_reconfigure()"));
const weatherTask = weather.slice(weather.indexOf("void weather_task(void*)"),
  weather.indexOf("for (;;) {", weather.indexOf("void weather_task(void*)")));
assert.match(weatherTask,
  /s_task_start_state\.load\(std::memory_order_acquire\)[\s\S]*?WeatherTaskStartState::Available[\s\S]*?vTaskDelay\(1\)/,
  "a newly scheduled Weather worker must not snapshot Config before its handle/availability edge");
assert.match(weatherStart,
  /if \(!s_mtx\)[\s\S]*?WeatherTaskStartState::TaskStartFailed/,
  "Weather must latch mutex allocation failure as task unavailable");
assert.doesNotMatch(weatherStart, /s_status\./,
  "Weather start failures must not allocate or race through mutable string status");
assert.match(weatherStart,
  /if \(!http_deadline_ready\(\)\)[\s\S]*?WeatherTaskStartState::DeadlineUnavailable/,
  "Weather must latch a missing absolute-deadline owner for the whole boot");
const weatherCreate = weatherStart.indexOf("if (xTaskCreate(");
const weatherCreateFailure = weatherStart.indexOf("WeatherTaskStartState::TaskStartFailed",
  weatherCreate);
const weatherCreateFailureReturn = weatherStart.indexOf("return;", weatherCreateFailure);
const weatherHandlePublish = weatherStart.indexOf("s_task.store(created_task",
  weatherCreateFailureReturn);
const weatherAvailable = weatherStart.indexOf("WeatherTaskStartState::Available");
assert.ok(weatherCreate >= 0 && weatherCreateFailure > weatherCreate &&
  weatherCreateFailureReturn > weatherCreateFailure &&
  weatherHandlePublish > weatherCreateFailureReturn && weatherAvailable > weatherHandlePublish,
  "Weather may publish task availability only after xTaskCreate succeeds; a provisional available " +
  "state lets a concurrent source save erase the final task-start failure");
assert.match(weatherStart,
  /TaskHandle_t created_task\s*=\s*nullptr[\s\S]*?xTaskCreate\([\s\S]*?&created_task[\s\S]*?s_task\.store\(created_task, std::memory_order_release\)[\s\S]*?s_task_start_state\.store\(WeatherTaskStartState::Available, std::memory_order_release\)/,
  "Weather must publish the created handle before opening the worker's first Config snapshot");
assert.match(weather,
  /void weather_forecast_reconfigure\(\)[\s\S]*?s_task\.load\(std::memory_order_acquire\)[\s\S]*?xTaskNotifyGive\(task\)/,
  "Weather reconfigure must notify only an acquire-loaded task handle");
assert.match(weather,
  /bool weather_forecast_request_refresh\([\s\S]*?s_task\.load\(std::memory_order_acquire\)[\s\S]*?Lock lk\(s_mtx\)[\s\S]*?s_task\.load\(std::memory_order_acquire\)[\s\S]*?xTaskNotifyGive\(task\)/,
  "Weather refresh admission and wake must use the published task handle under the token mutex");
const weatherSnapshotStart = weather.indexOf("WeatherForecastStatus weather_forecast_status()");
const weatherSnapshotEnd = weather.indexOf("bool weather_fetch_active()", weatherSnapshotStart);
const weatherSnapshot = weather.slice(weatherSnapshotStart, weatherSnapshotEnd);
assert.match(weatherSnapshot,
  /WeatherForecastStatus status[\s\S]*?\{[\s\S]*?Lock lk\(s_mtx\)[\s\S]*?status\s*=\s*s_status[\s\S]*?\}[\s\S]*?weather_task_failure\(\s*true,\s*true,\s*s_task_start_state\.load\([^)]*\)\s*\)[\s\S]*?status\.configured\s*=\s*true[\s\S]*?status\.fetching\s*=\s*false[\s\S]*?status\.available\s*=\s*false[\s\S]*?status\.state\s*=\s*"error"[\s\S]*?task_failure\.reason[\s\S]*?task_failure\.error/,
  "Weather snapshots must materialise the atomic start failure only after releasing the optional mutex");
assert.match(mqtt,
  /publish_weather_state\(bool config_enabled\)[\s\S]*?weather_forecast_status\(\)[\s\S]*?weather_mqtt_action\(config_enabled, status\.configured\)[\s\S]*?WeatherMqttAction::Publish[\s\S]*?build_weather_mqtt_json/,
  "an active Weather config must publish its materialised boot-start failure atomically over MQTT");
const internalInvalidateStart = weather.indexOf("bool invalidate_if_generation(");
const internalInvalidateEnd = weather.indexOf("\n}\n\n// A saved location", internalInvalidateStart);
const internalInvalidate = weather.slice(internalInvalidateStart, internalInvalidateEnd);
assert.match(internalInvalidate,
  /WeatherForecastStatus replacement = invalidated_status\([\s\S]*?Lock lk\(s_mtx\)[\s\S]*?s_source_generation\.load\([^)]*\) != expected_generation[\s\S]*?return false[\s\S]*?swap\(s_status, replacement\)/,
  "a task-side stale source snapshot must not overwrite the authoritative HTTP commit");
const tokenBind = weather.indexOf("const uint32_t source_generation");
const configSnapshot = weather.indexOf("const Config cfg = config();", tokenBind);
assert.ok(tokenBind >= 0 && configSnapshot > tokenBind,
  "Weather must bind the ABA token before taking the Config snapshot");
assert.match(weather,
  /current\.diagnostics_generation\s*!=\s*cfg\.diagnostics_generation/,
  "an in-flight Weather result must not cross a diagnostics consent generation");
assert.match(weather,
  /const Config before_fetch = config\(\)[\s\S]{0,500}?s_source_generation\.load\([^)]*\) != source_generation[\s\S]{0,500}?before_fetch\.diagnostics_generation != cfg\.diagnostics_generation[\s\S]{0,500}?!source_preempted\)[\s\S]{0,100}?ok = fetch_forecast/,
  "Weather must revalidate token, consent and location after quiesce and before starting HTTPS");
const successStart = weather.indexOf("if (ok) {");
const successEnd = weather.indexOf("if (updated)", successStart);
const successCommit = weather.slice(successStart, successEnd);
const successLock = successCommit.indexOf("Lock lk(s_mtx)");
const successToken = successCommit.indexOf(
  "s_source_generation.load(std::memory_order_acquire) != source_generation", successLock);
const successValue = successCommit.indexOf("s_status.has_value = true", successToken);
assert.ok(successStart >= 0 && successEnd > successStart && successLock >= 0 &&
  successToken > successLock && successValue > successToken,
  "Weather success must re-check the source token under the same mutex as its value commit");
const failureStart = weather.indexOf("const std::string failure", successEnd);
const failureEnd = weather.indexOf("diag_printf(\"weather: Open-Meteo fetch failed", failureStart);
const failureCommit = weather.slice(failureStart, failureEnd);
const failureLock = failureCommit.indexOf("Lock lk(s_mtx)");
const failureToken = failureCommit.indexOf(
  "s_source_generation.load(std::memory_order_acquire) != source_generation", failureLock);
const failureValue = failureCommit.indexOf("s_status.error = failure", failureToken);
assert.ok(failureStart >= 0 && failureEnd > failureStart && failureLock >= 0 &&
  failureToken > failureLock && failureValue > failureToken,
  "Weather failure must not overwrite a newer synchronous invalidation");
const setWeatherStart = httpConfig.indexOf("static esp_err_t set_weather(");
const setWeatherEnd = httpConfig.indexOf("\n}\n\n// POST /set_board", setWeatherStart);
const setWeather = httpConfig.slice(setWeatherStart, setWeatherEnd);
const configSave = setWeather.indexOf("config_save(c)");
const sourceChangeBegin = setWeather.indexOf(
  "WeatherSourceChange weather_change(location.enabled, c.diagnostics_enabled)");
const sourceCommit = setWeather.indexOf("weather_change.commit()", configSave);
const retainedCleanup = setWeather.indexOf("mqtt_request_weather_cleanup()", sourceCommit);
const savedAck = setWeather.indexOf('"saved\\":true', retainedCleanup);
assert.ok(sourceChangeBegin >= 0 && configSave > sourceChangeBegin &&
  sourceCommit > configSave &&
  retainedCleanup > sourceCommit && savedAck > retainedCleanup,
  "a changed Weather source must clear live and retained old evidence before save acknowledgement");
assert.match(setWeather, /if \(weather_was_enabled\) mqtt_request_weather_cleanup\(\);/,
  "changing or disabling a previously enabled Weather source must tombstone its retained evidence");
const diagnosticsStart = httpConfig.indexOf("static esp_err_t set_diagnostics(");
const diagnosticsEnd = httpConfig.indexOf("\n}\n\nstatic esp_err_t set_circulation", diagnosticsStart);
const setDiagnostics = httpConfig.slice(diagnosticsStart, diagnosticsEnd);
const diagnosticsGeneration = setDiagnostics.indexOf("diagnostics_next_generation(");
const diagnosticsBegin = setDiagnostics.indexOf(
  "WeatherSourceChange weather_change(c.weather_enabled, enabled)", diagnosticsGeneration);
const diagnosticsSave = setDiagnostics.indexOf("config_save(c)", diagnosticsBegin);
const diagnosticsCommit = setDiagnostics.indexOf("weather_change.commit()", diagnosticsSave);
const diagnosticsCleanup = setDiagnostics.indexOf("mqtt_request_weather_cleanup()",
                                                    diagnosticsCommit);
const diagnosticsAck = setDiagnostics.indexOf('"saved\\":true', diagnosticsCleanup);
assert.ok(diagnosticsGeneration >= 0 && diagnosticsBegin > diagnosticsGeneration &&
  diagnosticsSave > diagnosticsBegin && diagnosticsCommit > diagnosticsSave &&
  diagnosticsCleanup > diagnosticsCommit &&
  diagnosticsAck > diagnosticsCleanup,
  "a diagnostics consent mutation must hold Weather admission through save/invalidation and " +
  "tombstone retained evidence before acknowledgement");

// A single atomic state is the admission handshake. Weather and the HTTP mutation cannot both win:
// NetworkActivity owns Idle->Network until its destructor, while the mutation owns
// Idle->SourceChange across config_save() and the staged status swap.
const networkActivityStart = weather.indexOf("struct NetworkActivity {");
const networkActivityEnd = weather.indexOf("\n};", networkActivityStart);
const networkActivity = weather.slice(networkActivityStart, networkActivityEnd);
assert.match(networkActivity,
  /compare_exchange_strong\([\s\S]*?SourceAdmission::Network[\s\S]*?s_source_generation\.load\([\s\S]*?SourceAdmission::Idle/,
  "Weather network admission must atomically exclude a source mutation and recheck its token");
assert.match(networkActivity,
  /~NetworkActivity\(\)[\s\S]*?mqtt_transport_resume_after_network_heap\(\)[\s\S]*?release_admission\(\)[\s\S]*?SourceChangePending[\s\S]*?SourceChange[\s\S]*?SourceAdmission::Network[\s\S]*?SourceAdmission::Idle/,
  "Weather must hand a completed network interval directly to a pending source mutation, or release Idle");
const beginChangeStart = weather.indexOf("static bool begin_source_change()");
const releaseChangeStart = weather.indexOf("static void release_source_change()",
                                            beginChangeStart);
const constructorStart = weather.indexOf("WeatherSourceChange::WeatherSourceChange(",
                                          releaseChangeStart);
const destructorStart = weather.indexOf("WeatherSourceChange::~WeatherSourceChange()",
                                         constructorStart);
const commitChangeStart = weather.indexOf("void WeatherSourceChange::commit()", destructorStart);
const requestRefreshStart = weather.indexOf("bool weather_forecast_request_refresh(uint64_t& token) noexcept",
                                             commitChangeStart);
assert.ok(requestRefreshStart > commitChangeStart,
  "Weather source-change assertions must end at the current refresh-request function boundary");
const beginChange = weather.slice(beginChangeStart, releaseChangeStart);
const releaseChange = weather.slice(releaseChangeStart, constructorStart);
const constructor = weather.slice(constructorStart, destructorStart);
const destructor = weather.slice(destructorStart, commitChangeStart);
const commitChange = weather.slice(commitChangeStart, requestRefreshStart);
assert.match(beginChange,
  /SourceAdmission::Idle[\s\S]*?SourceAdmission::SourceChange[\s\S]*?SourceAdmission::Network[\s\S]*?SourceAdmission::SourceChangePending[\s\S]*?kSourceCancelWait/,
  "source changes must either acquire Idle or request a direct network handoff within a bound");
assert.match(beginChange,
  /SourceAdmission::SourceChangePending[\s\S]*?SourceAdmission::Network[\s\S]*?return false[\s\S]*?expected == SourceAdmission::SourceChange[\s\S]*?return true/,
  "a timed-out handoff must restore Network while a won handoff acquires the transaction");
assert.doesNotMatch(beginChange, /s_source_generation\.fetch_add/,
  "a fallible source save must not invalidate the still-durable source generation");
const timeoutRollback = beginChange.indexOf("expected, SourceAdmission::Network");
const timeoutReturn = beginChange.indexOf("return false", timeoutRollback);
assert.ok(timeoutRollback >= 0 && timeoutReturn > timeoutRollback);
assert.doesNotMatch(beginChange.slice(timeoutRollback, timeoutReturn),
  /s_source_generation\.fetch_add/,
  "a 503 timeout must not invalidate the still-authoritative source request");
assert.match(releaseChange, /SourceAdmission::SourceChange[\s\S]*?SourceAdmission::Idle/,
  "the source-change admission state must have one fail-closed release primitive");
const stagedReplacement = constructor.indexOf("replacement_(invalidated_status_for(");
const stagedAvailable = constructor.indexOf("WeatherTaskStartState::Available", stagedReplacement);
const stagedFailureStrings = constructor.indexOf('failure_state_("error")', stagedAvailable);
const stagedAdmission = constructor.indexOf("held_(s_mtx && begin_source_change())",
  stagedFailureStrings);
assert.ok(stagedReplacement >= 0 && stagedAvailable > stagedReplacement &&
  stagedFailureStrings > stagedAvailable && stagedAdmission > stagedFailureStrings,
  "the transaction must stage its normal and every task-failure replacement before admission");
assert.match(destructor, /if \(!held_\) return;[\s\S]*?release_source_change\(\)/,
  "an exception or failed Config save must release Weather admission by RAII");
assert.match(commitChange,
  /Lock lk\(s_mtx\)[\s\S]*?if \(\s*configured_ && diagnostics_enabled_\s*\)[\s\S]*?s_task_start_state\.load\([^)]*\)[\s\S]*?case WeatherTaskStartState::Available[\s\S]*?case WeatherTaskStartState::DeadlineUnavailable[\s\S]*?deadline_reason_[\s\S]*?deadline_error_[\s\S]*?case WeatherTaskStartState::TaskStartFailed[\s\S]*?task_start_reason_[\s\S]*?task_start_error_[\s\S]*?case WeatherTaskStartState::NotStarted[\s\S]*?not_started_reason_[\s\S]*?not_started_error_[\s\S]*?swap\(replacement_\.state, failure_state_\)[\s\S]*?swap\(replacement_\.reason, \*failure_reason\)[\s\S]*?swap\(replacement_\.error, \*failure_error\)/,
  "Weather source commit must select the final exact task-start failure allocation-free under its mutex");
assert.match(commitChange,
  /Lock lk\(s_mtx\)[\s\S]*?s_source_generation\.fetch_add\(1[\s\S]*?weather_refresh_cancel_outstanding[\s\S]*?swap\(s_status, replacement_\)[\s\S]*?release_source_change\(\)[\s\S]*?held_ = false/,
  "only a successful Config save may advance generation, cancel refresh and install staged status");
const preemptedStart = weather.indexOf("if (source_preempted) {");
const preemptedEnd = weather.indexOf(
  "if (s_source_generation.load(std::memory_order_acquire) != source_generation) continue;",
  preemptedStart);
const preempted = weather.slice(preemptedStart, preemptedEnd);
assert.ok(preemptedStart >= 0 && preemptedEnd > preemptedStart,
  "the source-preempted Weather finalization must remain identifiable");
assert.match(preempted,
  /Lock lk\(s_mtx\)[\s\S]*?s_source_generation\.load[\s\S]*?s_status\.fetching\s*=\s*false[\s\S]*?s_status\.state\s*=\s*"waiting"[\s\S]*?refresh_attempt\.finish\(false\)/,
  "a failed source save must not leave its admission-lost fetch reported as active");
assert.match(weather,
  /bool weather_fetch_active\(\)[\s\S]*?state == SourceAdmission::Network \|\|[\s\S]*?state == SourceAdmission::SourceChangePending/,
  "a pending handoff must remain truthfully visible as an active Weather network interval");

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
assert.match(configSource, /config_save_transaction\(g_cfg, requested, owns_link, store\)/,
  "save_whole must run the transaction whose staging order is pinned above");

const cleanupStart = mqtt.indexOf("static RetainedCleanupCycle service_requested_topic_cleanup(");
const cleanupEnd = mqtt.indexOf("\n}\n\nstatic void publish_weather_state", cleanupStart);
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
const cleanupCall = mqtt.indexOf("service_requested_topic_cleanup(ref_config)",
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
assert.match(publishCycleBody,
  /if \(!cleanup_cycle\.weather\)[\s\S]*?publish_weather_state/,
  "a Weather cleanup must suppress stale-snapshot publication for the rest of its MQTT cycle");
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
const mbTlsHold = mbTask.indexOf("if (ota_download_active() || weather_fetch_active())");
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
  /if \(js != s_last_modbus_json\) \{\s*if \(!mqtt_publish\(s_modbus,[\s\S]*?\)\) return false;\s*s_last_modbus_json = js;\s*\}/,
  "HomeHub dedup may advance only after the broker accepts current state");
const weatherPublishStart = mqtt.indexOf("static void publish_weather_state(");
const weatherPublishEnd = mqtt.indexOf("\n}\n\n// ENV III", weatherPublishStart) + 2;
const weatherPublish = mqtt.slice(weatherPublishStart, weatherPublishEnd);
assert.match(weatherPublish,
  /if \(js != s_last_weather_json &&\s*mqtt_publish\(s_weather,[\s\S]*?\)\) \{\s*s_last_weather_json = js;\s*\}/,
  "Weather dedup may advance only after the broker accepts current state");
const env3PublishStart = mqtt.indexOf("static void publish_env3_state()");
const env3PublishEnd = mqtt.indexOf("\n}\n\n// Stream one retained", env3PublishStart) + 2;
const env3Publish = mqtt.slice(env3PublishStart, env3PublishEnd);
assert.match(env3Publish,
  /if \(new_sample \|\| js != s_last_env3_json\) \{\s*if \(mqtt_publish\(s_env3,[\s\S]*?\)\) \{\s*s_last_env3_json\s*=\s*js;\s*s_last_env3_samples\s*=\s*env\.samples;\s*\}\s*\}/,
  "ENV III value and sample acknowledgements must advance only after publish success");
assert.match(mqtt,
  /static bool publish_env3_discovery\(\)[\s\S]*?if \(!mqtt_publish\([^;]*\)\) ok = false[\s\S]*?return ok/,
  "ENV III discovery must report partial broker failure");
assert.match(mqtt,
  /if \(!s_env3_discovery_announced\)[\s\S]*?if \(publish_env3_discovery\(\)\)[\s\S]*?s_env3_discovery_announced = true/,
  "ENV III discovery may be acknowledged only after every config publish succeeds");

// A retained historical value is not fresh evidence after the current source reports failure.
// Apply configured/current-availability gates before the ordinary age calculation, and publish the
// resulting combined verdict rather than the age-only result.
const mqttFreshStart = weatherMqtt.indexOf("inline WeatherFreshness weather_mqtt_freshness(");
const mqttFreshEnd = weatherMqtt.indexOf("\n}\n\ninline std::string build_weather_mqtt_json", mqttFreshStart);
const mqttFresh = weatherMqtt.slice(mqttFreshStart, mqttFreshEnd);
assert.ok(mqttFreshStart >= 0 && mqttFreshEnd > mqttFreshStart,
  "Weather MQTT must have one identifiable effective-freshness gate");
const configuredGate = mqttFresh.indexOf("if (!s.configured)");
const availabilityGate = mqttFresh.indexOf("if (!s.available)", configuredGate);
const ageGate = mqttFresh.indexOf("return weather_freshness(", availabilityGate);
assert.ok(configuredGate >= 0 && availabilityGate > configuredGate && ageGate > availabilityGate,
  "Weather MQTT freshness must fail closed on configuration and current availability before age");
assert.match(mqttFresh,
  /!s\.available[\s\S]*?s\.reason\.empty\(\) \? "unavailable" : s\.reason\.c_str\(\)/,
  "an unavailable Weather snapshot must name its current failure instead of claiming age-fresh");
assert.match(weatherMqtt,
  /const WeatherFreshness freshness = weather_mqtt_freshness\(s, now_unix_s\)[\s\S]*?out \+= freshness\.fresh \? "1" : "0"[\s\S]*?"freshness_reason", freshness\.reason/,
  "the retained document must emit the effective freshness verdict and reason atomically");

// ── 4. An ARMED diagnosis whose sampler never ran must not report itself DISABLED ───────────────
// The sampler lives on the MQTT publish task, which safe mode never creates, while /status derives
// `armed` from the configuration at request time. Published raw that was a self-contradicting
// payload — armed:true beside reason:"disabled" — and "disabled" is the evaluator's word for "no
// room source is mapped", so the card told the reader to set up the source sitting configured one
// row below it.
assert.match(diagnosis, /HeatingCurveReason::SamplerInactive/,
  "the untouched-snapshot state needs a reason of its own, distinct from Disabled");
assert.match(diagnosis,
  /inline bool heating_curve_sampler_inactive\([\s\S]*?armed_by_config && state == HeatingCurveState::Off &&\s*\n\s*reason == HeatingCurveReason::Disabled;/,
  "the rule must be pure, so both the substitution and its narrowness are host-tested");
assert.match(status,
  /logic::heating_curve_reported_reason\(\s*\n?\s*heating_curve_armed, heating_curve\.state, heating_curve\.reason\)/,
  "/status must publish the REPORTED reason, not the raw snapshot's");
// BOTH published forms must read the substituted value. Asserted positively rather than as a
// doesNotMatch on the raw field: a negative match over C++ string-escaping is easy to write so that
// it can never fire, which is a check that is green because it is broken. (It was, until the
// selftest re-seeded the defect and this stayed clean.)
assert.match(status, /heating_curve_reason_name\(heating_curve_reason\)/,
  "the reason NAME must come from heating_curve_reported_reason");
assert.match(status, /static_cast<unsigned>\(heating_curve_reason\)/,
  "the reason CODE must come from the same substitution, or the two disagree in one payload");

// ── 5. Redaction must not invent an identifier that does not exist ──────────────────────────────
// A bug report is a public GitHub issue whose first question is which optional sources this
// installation is even running. "<redacted>" over an EMPTY field answers it wrongly: a device with
// no room source, no witness, no HomeHub and no collector read exactly like one that has all four
// and hid them. mqtt.broker is the sharpest case — empty IS the disabled state.
assert.match(redact,
  /inline std::string redact_identifier\(const std::string& value, bool on\) \{\s*\n\s*return on && !value\.empty\(\)/,
  "the identifier wrapper must leave an unset value alone");
assert.match(status, /static std::string jstr_r\(const std::string& s, bool redact\) \{\s*\n\s*return json_quote\(redact_identifier\(s, redact\)\);/,
  "the /status builder's identifier wrapper must use redact_identifier, not the raw primitive");

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
assert.match(status,
  /using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 1024>;/,
  "values responses must bind the host-tested sink to a strict 1 KiB HTTP chunk bound");
assert.match(chunkSink,
  /while \(!value\.empty\(\)\)[\s\S]*?const size_t take = std::min\(available, value\.size\(\)\)[\s\S]*?value\.remove_prefix\(take\)/,
  "one oversized append must be split before it can grow the production buffer past its bound");
assert.match(status,
  /esp_err_t http_send_values_json\([\s\S]*?ValuesSnapshot snapshot = take_values_snapshot\(\);[\s\S]*?HttpJsonChunks j\(HttpChunkEmitter\{req\}\);[\s\S]*?j \+= prefix;[\s\S]*?append_values_json\(j, snapshot\);[\s\S]*?j \+= suffix;[\s\S]*?j\.finish\(\)/,
  "the shared sender must snapshot before streaming prefix + values + suffix through one sink");
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
assert.match(poll, /checkup_record\(fresh\.data\(\)[\s\S]{0,900}?dwell_record\(fresh\.data\(\), fresh\.size\(\),\s*cycle_generation,\s*static_cast<uint32_t>\(\(service_max_gap_us \+ 999999\) \/ 1000000\)\);/,
  "the normal cycle must fold the state ages beside the checkup, from the same row set");
// The reduction has to read `fresh` — the rows that ANSWERED this cycle — and not the committed
// cache, which no longer knows which rows were missing. A row absent from `fresh` IS the evidence.
const commitAt = poll.search(/s_cache\s*=\s*std::move\(fresh\)/);
assert.ok(commitAt > 0, "poll_once must still commit the cache by moving `fresh`");
assert.ok(poll.indexOf("dwell_record(fresh.data(), fresh.size(), cycle_generation,") < commitAt,
  "dwell_record must see `fresh` before the commit moves it away, or absent rows read as unchanged");

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

// Weather raises its lock-free activity signal, then leaves one complete MQTT cadence before
// starting HTTPS. Otherwise the publisher can already own the large vector when TLS begins, and an
// activity check in the next cycle is too late. OTA and weather now also close their simultaneous-
// start race: weather raises its own flag first, waits the grace interval, re-reads OTA's flag and
// starts HTTPS only if OTA did not win. Assert the ordered block rather than an arbitrary character
// distance — the race explanation between those statements is deliberately allowed to be explicit.
const weatherActivity = weather.indexOf("NetworkActivity activity(source_generation);");
const weatherLead = weather.indexOf("vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs));",
                                  weatherActivity);
const weatherPollBarrier = weather.indexOf("hp_poll_network_quiesced()", weatherLead);
const weatherMqttBarrier = weather.indexOf("mqtt_publish_network_quiesced()", weatherPollBarrier);
const weatherOtaRecheckMatch = weather.slice(weatherMqttBarrier).search(
  /ota_preempted\s*=\s*ota_download_active\(\);/);
const weatherOtaRecheck = weatherOtaRecheckMatch < 0 ? -1
  : weatherMqttBarrier + weatherOtaRecheckMatch;
const weatherFetchMatch = weather.slice(weatherOtaRecheck).search(/ok\s*=\s*fetch_forecast\(/);
const weatherFetch = weatherFetchMatch < 0 ? -1 : weatherOtaRecheck + weatherFetchMatch;
assert.ok(weatherActivity >= 0 && weatherLead > weatherActivity &&
          weatherPollBarrier > weatherLead && weatherMqttBarrier > weatherPollBarrier &&
          weatherOtaRecheck > weatherMqttBarrier &&
          weatherFetch > weatherOtaRecheck,
  "weather must advertise its heap interval, wait for X10A and MQTT, re-check OTA and only then fetch");
const mqttTaskStart = mqtt.indexOf("static void mqtt_task(");
const mqttTaskEnd = mqtt.indexOf("static bool build_client(", mqttTaskStart);
const mqttTask = mqtt.slice(mqttTaskStart, mqttTaskEnd);
const mqttOtaBusy = mqttTask.indexOf("ota_download_active()");
const mqttWeatherBusy = mqttTask.indexOf("weather_fetch_active()", mqttOtaBusy);
const mqttNetworkBusy = mqttTask.indexOf("ota_busy || weather_busy", mqttWeatherBusy);
const mqttHoldCall = mqttTask.indexOf("mqtt_network_hold_step(network_quiesce, network_busy",
                                         mqttNetworkBusy);
const mqttHoldStart = mqtt.indexOf(
  "static __attribute__((noinline)) bool mqtt_network_hold_step(");
const mqttHoldEnd = mqtt.indexOf(
  "static __attribute__((noinline)) bool mqtt_transport_resume_step(", mqttHoldStart);
const mqttHold = mqtt.slice(mqttHoldStart, mqttHoldEnd);
assert.ok(mqttTaskStart >= 0 && mqttTaskEnd > mqttTaskStart && mqttOtaBusy >= 0 &&
          mqttWeatherBusy > mqttOtaBusy && mqttNetworkBusy > mqttWeatherBusy &&
          mqttHoldCall > mqttNetworkBusy && mqttHoldStart >= 0 && mqttHoldEnd > mqttHoldStart,
  "MQTT must combine OTA and weather activity before entering its stack-bounded hold helper");
assert.match(mqttHold, /ota_quiesce_step\(quiesce, network_busy\)/,
  "the MQTT helper must apply the bounded TLS hold-off to the combined network activity");
assert.match(poll,
  /ota_download_active\(\)[\s\S]{0,200}?weather_fetch_active\(\)[\s\S]{0,200}?ota_active \|\| weather_active[\s\S]{0,200}?ota_quiesce_step\(network_quiesce, network_active\)/,
  "X10A polling must apply the same bounded hold-off to both OTA and weather TLS activity");

console.log("source absence: board trends own their producer, absent sources state absence, " +
            "armed-but-inactive is named, state ages expire rather than freeze, " +
            "redaction invents nothing, TLS pressure is coordinated");

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

// A mapped room timestamp that never arrives must not let MQTT arrival time stand in for it
// (MQTT-05/a). Every room-source age decision therefore goes through the mapping-aware helper; the
// bare helper stays legitimate only for the circulation witness, whose payload carries its own time.
{
  const bare = (src) => (src.match(/\breference_freshness\(/g) || []).length;
  const room = (src) => (src.match(/\breference_room_freshness\(/g) || []).length;
  const bodyOf = (src, signature) => {
    const at = src.indexOf(signature);
    const end = src.indexOf("\n}\n", at);
    assert.ok(at >= 0 && end > at, `missing ${signature}`);
    return src.slice(at, end);
  };
  const circulationCalls = [
    "static ReferenceFreshness circulation_frame_freshness(",
    "CirculationSourceStatus circulation_source_status(const Config& c)",
    "CirculationPumpSample circulation_pump_sample()",
  ].reduce((n, signature) => n + bare(bodyOf(mqtt, signature)), 0);
  assert.equal(bare(status), 0, "/status must not age a room value without its timestamp mapping");
  assert.ok(room(status) >= 1, "/status must judge room freshness through the mapping-aware helper");
  assert.equal(bare(mqtt), circulationCalls,
    "outside the circulation witness, mqtt_ha.cpp must not age a room value by MQTT arrival alone");
  assert.ok(room(mqtt) >= 1, "mqtt_ha.cpp must judge room freshness through the mapping-aware helper");
  // Every call passes the derived mapping, never a constant that would silently restore the
  // arrival-time fallback for a mapped timestamp.
  for (const [name, src] of [["http_status.cpp", status], ["mqtt_ha.cpp", mqtt]]) {
    for (const call of src.matchAll(/\breference_room_freshness\(\s*/g)) {
      const first = src.slice(call.index + call[0].length, call.index + call[0].length + 80);
      assert.match(first, /^(reference_source_time_mapped\(\w+\.ref_temp_time_topic, \w+\.ref_temp_time_path\)|timestamp_mapped),/,
        `${name}: reference_room_freshness() must receive the derived timestamp mapping, got ${first}`);
    }
  }
  assert.equal((mqtt.match(/ref_temp_time_topic\.empty\(\) \|\|\s*!\w+\.ref_temp_time_path/g) || []).length,
    0, "the room timestamp mapping must be derived by reference_source_time_mapped() alone");
  // MQTT-05/b: a decoder error that still blocks an incomplete aggregate keeps its own reason;
  // the frame loop may report Eligible (code 0) only once no error remains.
  const frames = bodyOf(mqtt, "static void service_reference_frames(const Config& c)");
  assert.doesNotMatch(frames, /^\s*candidate\.rejection_reason\s*=\s*ReferenceRoomReason::Eligible;/m,
    "the frame loop must not reset the rejection reason while a blocking error remains");
  assert.match(frames,
    /if \(candidate\.error\.empty\(\)\) candidate\.rejection_reason = ReferenceRoomReason::Eligible;/,
    "the frame loop must restore Eligible only once the decoder error has cleared");
  // Status getters take the caller's Config; a no-argument overload would copy the whole Config per
  // call and invite that churn back into per-cycle paths.
  const mqttHeader = read("main/mqtt_ha.hpp");
  assert.doesNotMatch(mqttHeader, /\b(reference_temperature_status|circulation_source_status)\(\);/,
    "room/circulation status getters must not regain a Config-copying no-argument overload");
}
