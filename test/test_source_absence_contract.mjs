// THE ABSENCE CONTRACT — the firmware half of the source-absence matrix.
//
// test_ui_absence_matrix.mjs walks what the BROWSER says when an optional source is gone, but it can
// only ever be as honest as the /status it is handed: it consumes a payload, so it cannot see which
// task produced a field, whether a ring has an owner that a branch can skip, or whether an absent
// feature is reported as absence or as an empty buffer. Those are claims about whole components, and
// the only instrument that settles them is source TEXT — the same argument run-contract-tests.sh
// makes for the Modbus write path and the MQTT lifecycle.
//
// Four of the five rules below pin a defect this firmware shipped. The fifth pins the shape they
// share: an optional source that goes away must take its DERIVED artefacts with it — its trend, its
// retained topic, its verdict — and must never take anything ELSE with it.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const history = read("main/history.cpp");
const checkup = read("main/checkup.cpp");
const poll = read("main/hp_poll.cpp");
const pollHeader = read("main/hp_poll.hpp");
const mqtt = read("main/mqtt_ha.cpp");
const weather = read("main/weather_forecast.cpp");
const status = read("main/http_status.cpp");
const mcp = read("main/mcp_server.cpp");
const chunkSink = read("main/logic/chunk_sink.hpp");
const redact = read("main/logic/redact.hpp");
const diagnosis = read("main/logic/heating_curve_diagnosis.hpp");

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
  /^\s*history_record_board\(\);((?:\s*\n\s*(?:\/\/[^\n]*|[A-Za-z_][A-Za-z0-9_:]*\([^;]*\);))*)\s*\n\s*if \(config\(\)\.profile == "auto"\)/m);
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
  /void checkup_reboot_save\(\)[\s\S]*?xSemaphoreTake\(s_mtx, pdMS_TO_TICKS\(200\)\)[\s\S]*?dhw_loss_checkpoint\(s_dhw_state,[\s\S]*?h\.payload\.pending\s*=\s*P\(\)\.dhw\.pending/,
  "intentional reboot must checkpoint both the in-flight DHW candidate and completed pending windows under a bounded lock");
assert.match(checkup,
  /checkup_dhw_handoff_valid\([\s\S]*?P\(\)\.dhw\.pending\s*=\s*P\(\)\.dhw_handoff\.payload\.pending;[\s\S]*?dhw_loss_adopt\(/,
  "boot must restore the separately sealed DHW handoff before producers start");
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
// seal's dirty bookkeeping (#391), and pinning adjacency would make this fail for a change that
// cannot affect what it asserts. What it still asserts is the thing that matters — inside the
// not-configured branch, the label is cleared.
assert.match(history,
  /fold_circulation_locked[\s\S]*?if \(!circulation\.configured\) \{[\s\S]{0,240}?tr\.label\[0\] = '\\0';/,
  "an unconfigured circulation witness must clear its trend label so /status stops offering it");
assert.match(status, /if \(mb\.enabled\) \{[\s\S]*?HOMEHUB_HISTORIES/,
  "HomeHub trends must be offered only while that stack is enabled");
assert.match(status, /if \(env_enabled\) \{[\s\S]*?ENV3_HISTORIES/,
  "ENV III trends must be offered only while that sensor is enabled");

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
assert.match(poll, /if \(config\(\)\.profile == "auto"\)[\s\S]{0,2200}?dwell_record\(nullptr, 0, generation\);/,
  "a board whose X10A never resolves a profile must age its restored state ages out, or a reboot " +
  "would present the frozen pre-reboot durations as current");
assert.match(poll, /checkup_record\(fresh\.data\(\)[\s\S]{0,900}?dwell_record\(fresh\.data\(\), fresh\.size\(\),\s*cycle_generation\);/,
  "the normal cycle must fold the state ages beside the checkup, from the same row set");
// The reduction has to read `fresh` — the rows that ANSWERED this cycle — and not the committed
// cache, which no longer knows which rows were missing. A row absent from `fresh` IS the evidence.
const commitAt = poll.search(/s_cache\s*=\s*std::move\(fresh\)/);
assert.ok(commitAt > 0, "poll_once must still commit the cache by moving `fresh`");
assert.ok(poll.indexOf("dwell_record(fresh.data(), fresh.size(), cycle_generation);") < commitAt,
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
const weatherActivity = weather.indexOf("NetworkActivity activity;");
const weatherLead = weather.indexOf("vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs));",
                                  weatherActivity);
const weatherOtaRecheck = weather.indexOf("ota_preempted = ota_download_active();", weatherLead);
const weatherFetch = weather.indexOf("if (!ota_preempted) ok = fetch_forecast(", weatherOtaRecheck);
assert.ok(weatherActivity >= 0 && weatherLead > weatherActivity &&
          weatherOtaRecheck > weatherLead && weatherFetch > weatherOtaRecheck,
  "weather must advertise its heap interval, wait one cadence, re-check OTA and only then fetch");
assert.match(mqtt,
  /ota_download_active\(\)[\s\S]{0,160}?weather_fetch_active\(\)[\s\S]{0,160}?ota_busy \|\| weather_busy[\s\S]{0,160}?ota_quiesce_step\(network_quiesce, network_busy\)/,
  "MQTT must apply the bounded TLS hold-off to both OTA and weather network activity");

console.log("source absence: board trends own their producer, absent sources state absence, " +
            "armed-but-inactive is named, state ages expire rather than freeze, " +
            "redaction invents nothing, TLS pressure is coordinated");

// #407 — the END of the restart ladder. The boot that inherited the full count must come up MINIMAL,
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
