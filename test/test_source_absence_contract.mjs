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
const startAt   = mainCpp.indexOf("checkup_start()");
const histAt    = mainCpp.indexOf("history_start()");
const pollAt    = mainCpp.indexOf("hp_poll_start(");
assert.ok(startAt > 0 && histAt > 0 && pollAt > 0,
  "main.cpp must start the trends, the checkup and the poll task");
assert.ok(startAt < pollAt && histAt < pollAt,
  "history_start() and checkup_start() must run BEFORE the poll task: both adopt or wipe .noinit " +
  "rings without a lock, which is only sound while no producer exists");

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
for (const f of ["main/history.cpp", "main/checkup.cpp"]) {
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
