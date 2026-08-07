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
const poll = read("main/hp_poll.cpp");
const status = read("main/http_status.cpp");
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
assert.match(poll,
  /history_record_board\(\);\s*\n\s*if \(config\(\)\.profile == "auto"\)/,
  "the poll task must record the board trends BEFORE it decides whether to detect or to sweep — " +
  "inside either branch is what made them depend on the heat pump being reachable");
// ...and exactly one owner: a second fold inside history_record() would put them back behind
// poll_once(), which is the branch that could skip them.
assert.doesNotMatch(history, /fold_board_locked\([^)]*\);[\s\S]*?fold_board_locked\(/,
  "the board trends must have a single producer");
assert.match(history, /if \(board_trend\(d\)\) continue;/,
  "history_record()'s row loop must SKIP board trends, leaving them to history_record_board()");

// ── 2. An unconfigured source is stated by ABSENCE, never by an empty chart ─────────────────────
// The circulation ring used to be labelled unconditionally, so /status.history.rows offered a trend
// the device could never fill and the Diagnostics card drew "no readings yet" under a row reading
// "not configured". Its two siblings were already gated; this is that rule for the third.
assert.match(history,
  /fold_circulation_locked[\s\S]*?if \(!circulation\.configured\) \{\s*\n\s*tr\.label\[0\] = '\\0';/,
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
  /if \(mb_status\(\)\.connected\) \{[\s\S]*?if \(live\) \{\s*\n\s*j \+= ",\\"modbus\\":";/,
  "/values must emit the HomeHub array only while that link is live, and omit the key otherwise");

console.log("source absence: board trends own their producer, absent sources state absence, " +
            "armed-but-inactive is named, redaction invents nothing");
