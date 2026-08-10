#!/usr/bin/env bash
# Does the source-absence matrix still catch what it was built for?
#
# The contract tools/redact/selftest.sh, tools/domain/selftest.sh and tools/schematic/selftest.sh
# keep: a check that reports "clean" is worthless until it has been shown to go red. This one
# re-seeds every defect the matrix exists for, in a throwaway copy of the tree, and fails if any of
# them passes — one `expect_red` each, so `grep -c '^expect_red ' selftest.sh` is the count.
#
# It matters more here than for a value audit, because both halves of this gate are assertions ABOUT
# TEXT: a regex that stops matching the code it describes goes green, not red, and a green
# source-text check is indistinguishable from a correct one. Every seed below is a defect this
# firmware actually shipped.
#
#   firmware (test_source_absence_contract.mjs)
#     1. the board's memory trends folded inside the heat pump's poll cycle
#     2. the circulation ring labelled even with no source configured
#     3. /status.heating_curve publishing the raw snapshot reason beside a config-derived `armed`
#     4. an unset identifier redacted into existence
#   browser (test_ui_absence_matrix.mjs)
#     5. the heating-curve card telling a reader to set up their configured room source
#     6. a configured HomeHub reported as disabled because its task is not running (safe mode) —
#        /status.modbus.enabled is the one optional-source flag reporting a TASK, not the config
#     7. a cleared broker left unnamed on the circulation row, the state it answered with
#        "waiting for a message" forever
#     8. the outdoor-axis row offering a second door into the Board Hardware modal — the one seed
#        here that pins a CHECK rather than a shipped defect, because that guard's first version
#        could not fire (see the seed for why the row's own shape defeated it)
#   firmware, appended (numbers keep growing rather than being re-grouped — a seed's number is how
#   it is referred to elsewhere, so renumbering costs more than the tidier ordering is worth)
#     9. the heap watchdog gated behind the detect/sweep branch — seed 1's defect one feature over,
#        which went green because the assertion covering it was a PROXIMITY search that spans an `if`
#    10. the board trends made conditional IN PLACE — seed 1's defect written in one line, which
#        went green because the assertion anchored on the call TEXT rather than on a statement
#    11. the end-of-ladder minimal boot decided AFTER main.cpp's safe-mode gate, so the poll engine
#        and the MQTT bridge start anyway and take the heap the minimal boot exists to leave free
#    12. that latch deleted outright, which ends the restart ladder back in the unreachable
#        degraded state #407 was filed about
#    13. the per-row state ages left unfed on the paths that read NOTHING, so a silent bus freezes
#        every duration at the instant it went quiet and goes on presenting them as current — seed
#        1's shape a third time, and the reason the feature has three call sites rather than one
#    14. the lower-bound marker dropped from /values, so a run the board merely FOUND already
#        standing is published as one it watched arrive
#    15. the state age computed by flooring the INTERVAL instead of quantising the absolute instants,
#        which discards the sub-second remainder of every poll cycle — 23% slow forever, and the one
#        defect here that is wrong in a way no gate could see from the outside
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/main" "$ROOT/tools" "$ROOT/test" "$TMP/"
fail=0

run_contract() { (cd "$TMP" && node test/test_source_absence_contract.mjs) ; }
run_ui()       { (cd "$TMP" && node test/test_ui_absence_matrix.mjs) ; }

expect_red() {
  local what="$1" which="$2"
  if "$which" >/dev/null 2>&1; then
    echo "FAIL: the matrix stayed green with $what"
    fail=1
  else
    echo "ok:   caught $what"
  fi
}

# Baseline: the real tree must be green, or nothing below means anything.
if ! run_contract >/dev/null 2>&1 || ! run_ui >/dev/null 2>&1; then
  echo "FAIL: the unmodified tree is already red — fix that before trusting this selftest"
  run_contract || true
  run_ui || true
  exit 1
fi
echo "ok:   unmodified tree is clean"

restore() { cp -R "$ROOT/main" "$TMP/"; }

# 1. Put the board trends back behind the heat pump's poll cycle. This is the defect verbatim: the
#    call moves inside the resolved-profile branch, so a board whose X10A never answers records no
#    heap curve — on exactly the board someone is debugging.
python3 - "$TMP/main/hp_poll.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("            history_record_board();\n", "", 1)
assert seed != s, "seed 1 did not apply — the call site moved"
seed = seed.replace('if (config().profile != "auto") poll_once();',
                    'if (config().profile != "auto") { history_record_board(); poll_once(); }', 1)
open(p, "w").write(seed)
PY
expect_red "board trends recorded only once a profile is resolved" run_contract
restore

# 2. Label the circulation ring unconditionally again, so /status offers a trend the device cannot
#    fill and the card draws "no readings yet" under a row that says "not configured".
python3 - "$TMP/main/history.cpp" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
seed = re.sub(r"        if \(!circulation\.configured\) \{\n"
              r"            if \(tr\.label\[0\] \|\| tr\.unit\[0\]\) s_persist_dirty = true;\n"
              r"            tr\.label\[0\] = '\\0';\n"
              r"            tr\.unit\[0\] = '\\0';\n"
              r"            continue;\n"
              r"        \}\n", "", s, count=1)
assert seed != s, "seed 2 did not apply — the guard moved"
open(p, "w").write(seed)
PY
expect_red "an unconfigured circulation witness still offered a trend" run_contract
restore

# 3. Publish the raw snapshot reason again. /status then reports armed:true beside reason:"disabled"
#    whenever the sampler's task was never created (safe mode).
python3 - "$TMP/main/http_status.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace('logic::heating_curve_reason_name(heating_curve_reason)',
                 'logic::heating_curve_reason_name(heating_curve.reason)')
assert seed != s, "seed 3 did not apply — the reason field moved"
open(p, "w").write(seed)
PY
expect_red "the raw sampler reason published beside a config-derived armed" run_contract
restore

# 4. Redact an unset identifier into existence again — the bug report then claims a broker, a room
#    source and a HomeHub on a device that has none.
python3 - "$TMP/main/http_status.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace('return json_quote(redact_identifier(s, redact));',
                 'return json_quote(redact_or(s, redact));', 1)
assert seed != s, "seed 4 did not apply — the wrapper moved"
open(p, "w").write(seed)
PY
expect_red "an unset identifier redacted into existence" run_contract
restore

# 5. The browser half: drop the armed-but-inactive branch, so a safe-mode board tells its owner to
#    set up the room source they configured. The firmware still reports the honest reason — this
#    seeds the UI ignoring it, which is how the original defect read.
python3 - "$TMP/main/www/js/dashboard.js" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
seed = re.sub(r'  if \(d\.reason === "sampler_inactive"\) \{\n'
              r'    return \{ key: sys\.safe_mode \? "dyn\.state_safe_mode" : "dyn\.state_inactive",\n'
              r'             cls: "warn", help: "dyn\.state_help_inactive" \};\n'
              r'  \}\n', "", s, count=1)
assert seed != s, "seed 5 did not apply — the branch moved"
open(p, "w").write(seed)
PY
expect_red "a safe-mode board told to set up its configured room source" run_ui
restore

# 6. Key the HomeHub Connections row's off-state on the TASK flag instead of the saved address. In
#    safe mode mb_start() is never called, so `enabled` is false while a host IS configured — the row
#    would then tell a recovering board that its HomeHub is not set up.
python3 - "$TMP/main/www/js/dashboard.js" <<'SEED6'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    const off = !mbs.host;", "    const off = !mbs.enabled;", 1)
assert seed != s, "seed 6 did not apply — the HomeHub row's off-state moved"
open(p, "w").write(seed)
SEED6
expect_red "a configured HomeHub reported as disabled while its task is stopped" run_ui
restore

# 7. Drop the broker branch from the circulation row's status ladder. The row then answers a cleared
#    broker with "waiting for a message" again — the defect verbatim, and the one the room source one
#    row above it never had.
python3 - "$TMP/main/www/js/dashboard.js" <<'SEED7'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace(
    '  if (!mqtt.configured) return { key: "broker_off", text: t("circ.broker_off"), cls: "err" };\n',
    "", 1)
assert seed != s, "seed 7 did not apply — the broker branch moved"
open(p, "w").write(seed)
SEED7
expect_red "a cleared broker unnamed on the circulation row" run_ui
restore

# 8. Give the outdoor-axis row its configuration action back. The ENV III has exactly ONE editor —
#    the Board Hardware modal on the ESP32 card, which saves it atomically beside the board identity
#    that decides whether the Grove port exists at all — and this row was a second door into it,
#    offering hardware configuration from a card that reports EVIDENCE.
#
#    This seed is here for a sharper reason than the seven above, and it is the only one pinning a
#    check rather than a shipped defect: the first version of that guard COULD NOT FIRE. Restoring
#    the action turns the row from a whole-row accordion back into a SPLIT row, so a face matched up
#    to the first </button> stops at the info toggle and never contains the `data-act` it looks for —
#    the guard reported success on precisely the change it exists to catch. Measured, not reasoned.
python3 - "$TMP/main/www/js/dashboard.js" <<'SEED8'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace(
    'return dynamicInfoRow("outdoor", t("dyn.outdoor"), value, cls, body);',
    'return dynamicInfoRow("outdoor", t("dyn.outdoor"), value, cls, body, "board", t("board.title"));',
    1)
assert seed != s, "seed 8 did not apply — the outdoor axis row's return moved"
open(p, "w").write(seed)
SEED8
expect_red "the outdoor axis offering a second door into the Board Hardware modal" run_ui
restore

# 9. Seed 1's defect, one feature over: the HEAP WATCHDOG moved behind the detect/sweep branch. It
#    samples at the same unconditional cycle top and for the same reason, so gated there it stops
#    watching the heap on exactly the board whose X10A never answers — the board most likely to be
#    in trouble, and the absence seed 1 exists for. Kept as its own seed rather than folded into
#    seed 1 because the two failed DIFFERENTLY: the assertion covering this one was written as a
#    proximity search (`history_record_board();[\s\S]{0,600}?heap_guard_sample();`), which spans the
#    `if` line happily, so it went green with the call sitting inside the branch.
python3 - "$TMP/main/hp_poll.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace('            heap_guard_sample();\n            if (config().profile == "auto") {',
                 '            if (config().profile == "auto") {\n                heap_guard_sample();', 1)
assert seed != s, "seed 9 did not apply — the heap watchdog's call site moved"
open(p, "w").write(seed)
PY
expect_red "the heap watchdog sampling only once a profile is resolved" run_contract
restore

# 10. The same assertion's OTHER blind spot, and the one that makes it a check rather than a
#     landmark: anchoring on the call TEXT rather than on a statement. `if (…) history_record_board();`
#     contains the anchor just as well as the unconditional form, so the pattern permitted the board
#     trends to be made conditional IN PLACE — which is seed 1's defect written in one line instead
#     of two.
python3 - "$TMP/main/hp_poll.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace('            history_record_board();',
                 '            if (config().profile != "auto") history_record_board();', 1)
assert seed != s, "seed 10 did not apply — the call site moved"
open(p, "w").write(seed)
PY
expect_red "the board trends made conditional in place" run_contract
restore

# 11. #407's end-of-ladder: the minimal boot decided AFTER main.cpp's safe-mode gate. It would then
#     arrive once the poll engine and the MQTT bridge had already started and taken the heap the
#     minimal boot exists to leave free — the state reads "safe mode" while nothing was actually
#     kept out of it.
python3 - "$TMP/main/main.cpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    daik::heap_guard_begin();", "", 1)
assert seed != s, "seed 11 did not apply — heap_guard_begin()'s call site moved"
seed = seed.replace("    daik::ota_health_gate_arm();",
                    "    daik::heap_guard_begin();\n    daik::ota_health_gate_arm();", 1)
open(p, "w").write(seed)
PY2
expect_red "the end-of-ladder minimal boot decided after the safe-mode gate" run_contract
restore

# 12. ...and the latch removed altogether, so the ladder ends back in the unreachable degraded state
#     #407 was filed about.
python3 - "$TMP/main/heap_guard.cpp" <<'PY2'
import sys, re
p = sys.argv[1]
s = open(p).read()
seed = re.sub(r"\n\s*safe_mode_latch_heap\(\);", "", s, count=1)
assert seed != s, "seed 12 did not apply — the latch call moved"
open(p, "w").write(seed)
PY2
expect_red "the end-of-ladder safe-mode latch deleted" run_contract
restore

# 13. The state ages left unfed where the cycle reads NOTHING. This is seed 1's failure a third
#     time and the reason the feature has three call sites: the two that matter are the ones a
#     refactor deletes, because they look like no-ops — they pass no data. Unfed, the table simply
#     stops moving, and a board whose X10A died keeps presenting the pre-outage durations as live.
python3 - "$TMP/main/hp_poll.cpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("                dwell_record(nullptr, 0);\n", "", 1)
assert seed != s, "seed 13 did not apply — the unresolved-profile call site moved"
open(p, "w").write(seed)
PY2
expect_red "the state ages frozen on a board whose X10A never answers" run_contract
restore

# 14. The lower-bound marker dropped on the way out. Both runs carry a TRUE number and the only
#     thing separating "I watched this arrive" from "it was already like this when I started
#     looking" is this one key — so losing it is invisible in every value, payload and chart.
python3 - "$TMP/main/http_status.cpp" <<'PY2'
import sys, re
p = sys.argv[1]
s = open(p).read()
seed = re.sub(r'\n\s*if \(!dw\.exact\) j \+= ",\\"dwell_min\\":true";', "", s, count=1)
assert seed != s, "seed 14 did not apply — the lower-bound marker moved"
open(p, "w").write(seed)
PY2
expect_red "an unwitnessed state age published as a witnessed one" run_contract
restore

# 15. The dwell computed off a FLOORED INTERVAL rather than absolute instants. The poll loop sleeps
#     a whole second after a serial sweep, so the cadence is ~1.2-1.3 s and the remainder is lost on
#     every cycle, permanently. checkup_step() already carries the rule; this seed proves the
#     assertion notices when the dwell stops following it.
python3 - "$TMP/main/state_dwell.cpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("dt_s = static_cast<uint32_t>(now_us / 1000000 - s_last_us / 1000000);",
                 "dt_s = static_cast<uint32_t>((now_us - s_last_us) / 1000000);", 1)
assert seed != s, "seed 15 did not apply — the elapsed derivation moved"
open(p, "w").write(seed)
PY2
expect_red "the state age flooring each interval instead of telescoping the remainder" run_contract
restore

if [ "$fail" -ne 0 ]; then
  echo
  echo "The source-absence matrix no longer catches a defect it was built for."
  exit 1
fi
echo
echo "source-absence selftest: every seeded defect was caught"
