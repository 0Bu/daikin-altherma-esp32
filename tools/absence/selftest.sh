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
#    16. flash restore deriving a series span from its first numeric value, so an all-absent but
#        recorded Modbus row disappears after a cold reboot
#    17. immutable cache metadata copied into two owning strings per row again, restoring the
#        contiguous-allocation failure beside TLS
#    18. weather advertising its network interval only after the pre-TLS grace, too late for MQTT
#        to release an already-running snapshot
#    19. MQTT quiescing for OTA but not for the weather TLS interval that caused the live failure
#    20. a copied HomeHub cache declared live without the snapshot's generation/liveness proof
#    21. HomeHub output gated on a later task-status read instead of the proven snapshot
#    22. MCP get_hp_values bypassing the shared bounded values sender
#    23. GET /values bypassing that same shared sender
#    24. the production HTTP chunk cap widened beyond the host-tested 1 KiB contract
#    25. one oversized append copied whole before the chunk sink splits it
#    26. response streaming constructed before the allocating source snapshots complete
#    27. allocating X10A label classification moved back inside streamed row rendering
#    28. owning std::to_string formatting restored after streaming begins
#    29. HomeHub rows rebuilt as a second complete temporary string
#    30. MCP's old whole-values append restored beside the bounded sender
#    31. the fixed UINT64 formatter shortened below its documented 20-digit capacity
#    32. the refrigerant-service row surviving while no X10A profile/source exists, turning the
#        tracker's default into a false unsupported-profile explanation in safe mode or at boot
#    33. Weather retaining a prior source's current-value flag after consent/source removal
#    34. diagnostics-off being mislabeled as an unconfigured Weather source
#    35. task-side Weather invalidation no longer checking its bound generation under the mutex
#    36. the Weather token bound after Config, reopening a complete A -> B -> A gap
#    37. a fetch crossing the device-wide diagnostics generation
#    38. the success commit losing its under-lock source-token recheck
#    39. a changed Weather location acknowledged before synchronous runtime invalidation
#    40. a changed (but still enabled) location keeping the old retained MQTT evidence
#    41. the MQTT worker consuming an A-to-B cleanup only when Weather is disabled
#    42. diagnostics consent removal failing to retract retained Weather evidence
#    43. the source-change RAII destructor no longer releasing admission on save failure/throw
#    44. the network owner dropping a pending mutation instead of handing admission to it
#    45. a timed-out handoff cancelling the still-authoritative source generation
#    46. link-blob allocation moved after the first durable Config write
#    47. a successful Weather tombstone retaining the old publish-dedup cache
#    48. a failed but age-young Weather value still advertised as fresh over MQTT
#    49. reboot/reconnect no longer reconstructing a pending retained Weather cleanup
#    50. reboot/reconnect no longer reconstructing a pending HomeHub cleanup
#    51. an enabled HomeHub A-to-B change retaining predecessor evidence
#    52. reboot/reconnect no longer reconstructing disabled ENV III cleanup
#    53. ENV III cleanup omitting retained state/discovery outside the X10A gate
#    54. an exception during ENV III topic construction losing the cleanup intent
#    55. HomeHub tombstone admitted before the source generation/cache cutover
#    56. a post-save HomeHub reconfigure copying the string-owning Config again
#    57. HomeHub history recomputing its fingerprint through a post-save Config copy
#    58. the post-save HomeHub runtime cutover losing its explicit noexcept boundary
#    59. HomeHub publish dedup advancing even when the broker rejects the state
#    60. Weather publish dedup advancing even when the broker rejects the state
#    61. ENV III state/sample acknowledgements advancing after a rejected publish
#    62. partial ENV III discovery publication being reported as complete
#    63. ENV III discovery being announced after a partial broker failure
#    64. retired HomeHub discovery cleanup moving back behind the X10A gate
#    65. retired Weather discovery cleanup moving back behind the X10A gate
#    66. HomeHub disable depending on a fallible Config copy after a TLS-owner delay
#    67. partial retired HomeHub discovery cleanup being acknowledged as complete
#    68. partial retired Weather discovery cleanup being acknowledged as complete
#    69. Weather cleanup acknowledging a state delete while retired discovery deletion failed
#    70. HomeHub cleanup acknowledging a state delete while retired discovery deletion failed
#    71. ENV III cleanup acknowledging a state delete while discovery deletion failed
#    72. ENV III discovery retraction hiding a partial broker failure
#    73. enabled ENV III deleting its still-valid discovery during a source cutover
#    74. every explicit source tombstone moving behind the ordinary X10A publication gate
#    75. a successful HomeHub tombstone retaining the predecessor publish-dedup cache
#    76. a successful ENV III tombstone retaining the predecessor publish-dedup cache
#    77. a successful ENV III tombstone retaining the predecessor sample acknowledgement
#    78. the frozen HomeHub retirement ledger being recoupled to the current register count
#    79. HomeHub ordinary publication recreating state in the same cycle as its cleanup
#    80. Weather ordinary publication consuming a stale Config snapshot after cleanup
#    81. HomeHub publication following retiring task lifetime instead of durable target intent
#    82. a failed Weather source save leaving its admission-lost fetch reported active
#    83. the five-minute retired-discovery retry moving behind X10A authority
#    84. a historical HomeHub discovery component/object-id literal drifting
#    85. the periodic retirement timer no longer resetting after a delete pass
#    86. a middle historical Weather discovery component/object-id literal drifting
#    87. a source/consent save erasing a boot-latched Weather task-start failure
#    88. Weather publishing task availability before task creation succeeds
#    89. intentional Weather absence leaking an unrelated worker-start error
#    90. Safe Mode freshness retaining the skipped worker's task-unavailable reason
#    91. a Weather start OOM writing string status without a usable mutex
#    92. the Weather task handle becoming a post-http-start non-atomic data race
#    93. a newly created Weather task snapshotting Config before its handle is published
#    94. disabled ENV III history remaining directly addressable after status/UI hide the source
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/main" "$ROOT/tools" "$ROOT/test" "$ROOT/sdkconfig.defaults" "$TMP/"
fail=0

run_contract() {
  (cd "$TMP" &&
    node test/test_source_absence_contract.mjs &&
    node test/test_mqtt_source_cleanup_contract.mjs)
}
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
seed = s.replace("                dwell_record(nullptr, 0, generation);\n", "", 1)
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

# 16. Put the value-dependent restore decision back. An all-NO_READING row then contributes no
#     span even though the journal contains the same bucket records as every numeric row.
python3 - "$TMP/main/history.cpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("history_flash_restore_start(\n            s_flash_oldest_bucket[src_i], newest, HISTORY_SAMPLES)",
                 "history_flash_lead_skip(s_flash_restore_blocks[0], HISTORY_SAMPLES)", 1)
assert seed != s, "seed 16 did not apply — the restore-span decision moved"
open(p, "w").write(seed)
PY2
expect_red "an all-absent journal row losing its recorded raster" run_contract
restore

# 17. Own the static label and unit again. This recreates two per-row string objects and their
#     allocations in every poll and publish snapshot.
python3 - "$TMP/main/hp_poll.hpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace('const char* label = "";', 'std::string label;', 1)
seed = seed.replace('const char* unit = "";', 'std::string unit;', 1)
assert seed != s, "seed 17 did not apply — the CachedValue metadata fields moved"
open(p, "w").write(seed)
PY2
expect_red "static cache metadata copied into owning strings" run_contract
restore

# 18. Raise the weather activity signal after the grace instead of before it. MQTT can then begin a
#     large snapshot during the delay and still own it when the handshake starts.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
old = ("                NetworkActivity activity(source_generation);\n"
       "                if (!activity) {\n"
       "                    source_preempted = true;\n"
       "                } else {\n"
       "                    vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs));")
new = ("                vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs));\n"
       "                NetworkActivity activity(source_generation);\n"
       "                if (!activity) {\n"
       "                    source_preempted = true;\n"
       "                } else {")
seed = s.replace(old, new, 1)
assert seed != s, "seed 18 did not apply — the weather grace moved"
open(p, "w").write(seed)
PY2
expect_red "weather advertising TLS activity after its grace" run_contract
restore

# 19. Quiesce only for OTA again, leaving the independently signalled weather fetch to race MQTT.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("const bool network_busy = ota_busy || weather_busy;",
                 "const bool network_busy = ota_busy;", 1)
assert seed != s, "seed 19 did not apply — the combined network gate moved"
open(p, "w").write(seed)
PY2
expect_red "weather TLS omitted from the MQTT hold-off" run_contract
restore

# 20. Ignore the liveness result returned with the copied HomeHub cache. A stale cache can then be
#     labelled current after a disconnect/reconnect generation race.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("        snapshot.modbus_live = live;",
                 "        snapshot.modbus_live = true;", 1)
assert seed != s, "seed 20 did not apply — the snapshot liveness assignment moved"
open(p, "w").write(seed)
PY3
expect_red "a HomeHub cache declared live without snapshot proof" run_contract
restore

# 21. Re-read task state while serialising instead of using the generation-bound snapshot result.
#     The cache and the later status then describe different instants.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    if (snapshot.modbus_live) {",
                 "    if (mb_status().connected) {", 1)
assert seed != s, "seed 21 did not apply — the HomeHub emission gate moved"
open(p, "w").write(seed)
PY3
expect_red "HomeHub output gated on later task state instead of its snapshot" run_contract
restore

# 22. Send MCP's already-built prefix directly again, bypassing the only sender that can append the
#     model-sized values object without materialising it.
python3 - "$TMP/main/mcp_server.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("                return http_send_values_json(req, response, suffix);",
                 "                return http_send_json(req, response.c_str());", 1)
assert seed != s, "seed 22 did not apply — the MCP values sender moved"
open(p, "w").write(seed)
PY3
expect_red "MCP get_hp_values bypassing the shared bounded sender" run_contract
restore

# 23. Bypass the same sender from GET /values. The two public representations can then drift even
#     if the MCP branch remains correct.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    return http_send_values_json(req);",
                 "    return ESP_FAIL;", 1)
assert seed != s, "seed 23 did not apply — the GET /values handler moved"
open(p, "w").write(seed)
PY3
expect_red "GET /values bypassing the shared bounded sender" run_contract
restore

# 24. Widen only the production alias. The generic sink tests would stay green while the ESP32 path
#     silently regained a larger contiguous requirement.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 1024>;",
                 "using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 2048>;", 1)
assert seed != s, "seed 24 did not apply — the production chunk alias moved"
open(p, "w").write(seed)
PY3
expect_red "the production HTTP chunk cap widened past 1 KiB" run_contract
restore

# 25. Append one large input whole. Small row fragments still look bounded, but one future builder
#     can now grow the buffer beyond MaxBytes before any flush.
python3 - "$TMP/main/logic/chunk_sink.hpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("            const size_t take = std::min(available, value.size());",
                 "            const size_t take = value.size();", 1)
assert seed != s, "seed 25 did not apply — the oversized-append split moved"
open(p, "w").write(seed)
PY3
expect_red "one oversized append copied whole before splitting" run_contract
restore

# 26. Construct the chunk stream before the source snapshots. A later bad_alloc can then arrive
#     after response state exists instead of inside the clean-503 staging window.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
old = "    ValuesSnapshot snapshot = take_values_snapshot();\n    HttpJsonChunks j(HttpChunkEmitter{req});"
new = "    HttpJsonChunks j(HttpChunkEmitter{req});\n    ValuesSnapshot snapshot = take_values_snapshot();"
seed = s.replace(old, new, 1)
assert seed != s, "seed 26 did not apply — snapshot/stream construction moved"
open(p, "w").write(seed)
PY3
expect_red "stream construction before allocating source snapshots" run_contract
restore

# 27. Recompute an ambiguous label slug inside the streamed X10A loop. object_id()/ha_slug() owns a
#     temporary string, so OOM after the first chunk can no longer become a clean 503.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("        if (i < ambiguous.size() && ambiguous[i]) {",
                 "        if (label_slug_is_ambiguous(object_id(v[i].label))) {", 1)
assert seed != s, "seed 27 did not apply — the staged ambiguity lookup moved"
open(p, "w").write(seed)
PY3
expect_red "allocating label classification inside streamed rows" run_contract
restore

# 28. Restore an owning numeric conversion in the streamed X10A loop.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("        append_json_uint(j, v[i].reg);",
                 "        j += std::to_string(v[i].reg);", 1)
assert seed != s, "seed 28 did not apply — the register formatter moved"
open(p, "w").write(seed)
PY3
expect_red "owning number formatting inside streamed rows" run_contract
restore

# 29. Reintroduce a second complete HomeHub-array string even though the outer response is chunked.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("        append_modbus_values_array(j, snapshot.modbus);",
                 "        const std::string arr = \"[]\";\n        j += arr;", 1)
assert seed != s, "seed 29 did not apply — the HomeHub serializer moved"
open(p, "w").write(seed)
PY3
expect_red "HomeHub rows rebuilt as a complete temporary string" run_contract
restore

# 30. Restore the old whole-values call in MCP. Keeping the new sender beside it must not fool the
#     positive call-path assertion into accepting the contiguous allocation again.
python3 - "$TMP/main/mcp_server.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "                return http_send_values_json(req, response, suffix);"
seed = s.replace(needle,
                 "                http_append_values_json(response);\n" + needle, 1)
assert seed != s, "seed 30 did not apply — the MCP values return moved"
open(p, "w").write(seed)
PY3
expect_red "MCP's old whole-values append restored" run_contract
restore

# 31. Make the stack formatter one digit too small for UINT64_MAX. The source contract owns this
#     width because streamed rendering must not fall back to an allocating formatter.
python3 - "$TMP/main/http_status.cpp" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    char digits[20];  // UINT64_MAX has exactly 20 decimal digits",
                 "    char digits[19];  // seeded truncation", 1)
assert seed != s, "seed 31 did not apply — the fixed number buffer moved"
open(p, "w").write(seed)
PY3
expect_red "the fixed UINT64 formatter shortened below 20 digits" run_contract
restore

# 32. Keep the healthy service object in the first X10A-absent fixture. The matrix rule must reject
#     the resulting row instead of allowing default/old service state to survive beside an
#     unresolved source.
python3 - "$TMP/test/test_ui_absence_matrix.mjs" <<'PY3'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    delete s.refrigerant_service;\n", "", 1)
assert seed != s, "seed 32 did not apply — the X10A removal moved"
open(p, "w").write(seed)
PY3
expect_red "a refrigerant-service row surviving without a detected X10A profile" run_ui
restore

# 33. Keep the bit which makes all cleared Weather scalars look current. Zero-looking values would
#     then be presented as a fresh forecast from a source which no longer exists.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
import re
p = sys.argv[1]
s = open(p).read()
seed, count = re.subn(r"^\s*replacement\.has_value\s*=\s*false;\n", "", s,
                      count=1, flags=re.MULTILINE)
assert count == 1, "seed 33 did not apply — Weather has_value clearing moved"
open(p, "w").write(seed)
PY4
expect_red "Weather retaining a prior source's current-value flag" run_contract
restore

# 34. Collapse disabled diagnostics into not-configured. The source remains configured, so the
#     actual missing prerequisite is consent rather than setup.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
import re
p = sys.argv[1]
s = open(p).read()
seed, count = re.subn(r'(:\s*!diagnostics_enabled\s*\?\s*)"diagnostics_disabled"',
                      r'\1"not_configured"', s, count=1)
assert count == 1, "seed 34 did not apply — Weather inactive reason moved"
open(p, "w").write(seed)
PY4
expect_red "diagnostics-off mislabeled as an unconfigured Weather source" run_contract
restore

# 35. Let an old inactive Config snapshot overwrite the authoritative status installed by a newer
#     HTTP commit.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("bool invalidate_if_generation(")
end = s.index("// A saved location", start)
body = s[start:end]
mutated = body.replace(
    "    if (s_source_generation.load(std::memory_order_acquire) != expected_generation) return false;\n",
    "", 1)
assert mutated != body, "seed 35 did not apply — Weather invalidation token check moved"
seed = s[:start] + mutated + s[end:]
open(p, "w").write(seed)
PY4
expect_red "a stale inactive Weather snapshot overwriting a newer HTTP commit" run_contract
restore

# 36. Bind after the Config snapshot. A complete A -> B -> A transition in that interval then
#     gives an old snapshot the new token and the post-fetch equality checks cannot distinguish it.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
pattern = (r"^\s*const uint32_t source_generation\s*=\s*"
           r"s_source_generation\.load\(std::memory_order_acquire\);\n")
s, count = re.subn(pattern, "", s, count=1, flags=re.MULTILINE)
assert count == 1, "seed 36 did not apply — Weather token binding moved"
s = s.replace("            const Config cfg = config();\n",
              "            const Config cfg = config();\n"
              "            const uint32_t source_generation =\n"
              "                s_source_generation.load(std::memory_order_acquire);\n", 1)
open(p, "w").write(s)
PY4
expect_red "Weather binding its ABA token after the Config snapshot" run_contract
restore

# 37. Let an old request cross diagnostics off -> on. Booleans and coordinates can match again,
#     but diagnostics_generation states that this is a new consent epoch.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("                current.diagnostics_generation != cfg.diagnostics_generation ||\n", "", 1)
assert seed != s, "seed 37 did not apply — diagnostics generation comparison moved"
open(p, "w").write(seed)
PY4
expect_red "a Weather fetch crossing the diagnostics consent generation" run_contract
restore

# 38. Keep the earlier unlocked check but remove the one serialized with the successful value
#     write. HTTP invalidation can then clear between those operations and the old fetch writes last.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
pattern = (r'(if \(ok\) \{\n\s*Lock lk\(s_mtx\);)\n'
           r'\s*if \(s_source_generation\.load\(std::memory_order_acquire\) != source_generation\)\n'
           r'\s*continue;')
seed, count = re.subn(pattern, r'\1', s, count=1)
assert count == 1, "seed 38 did not apply — success token check moved"
open(p, "w").write(seed)
PY4
expect_red "the Weather success commit losing its serialized source-token check" run_contract
restore

# 39. Delay source invalidation until after the response boundary. A client which immediately reads
#     /status can then combine the new Config coordinates with the previous source's values.
python3 - "$TMP/main/http_config.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static esp_err_t set_weather(")
end = s.index("// POST /set_board", start)
body = s[start:end]
mutated = body.replace("    weather_change.commit();\n",
                       "    weather_change.commit_after_response();\n", 1)
assert mutated != body, "seed 39 did not apply — synchronous Weather invalidation moved"
seed = s[:start] + mutated + s[end:]
open(p, "w").write(seed)
PY4
expect_red "a Weather location save acknowledged before runtime invalidation" run_contract
restore

# 40. Tombstone only on disable again. A -> B keeps the retained A payload even though status now
#     truthfully waits for B, so MQTT clients continue to see evidence under the old identity.
python3 - "$TMP/main/http_config.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    if (weather_was_enabled) mqtt_request_weather_cleanup();",
                 "    if (!location.enabled && weather_was_enabled) mqtt_request_weather_cleanup();", 1)
assert seed != s, "seed 40 did not apply — Weather retained cleanup moved"
open(p, "w").write(seed)
PY4
expect_red "a changed enabled Weather source keeping old retained evidence" run_contract
restore

# 41. Consume the request only while disabled again. That loses an enabled A -> B tombstone and is
#     independent of the handler-side request asserted by seed 40.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
pattern = (r'if \(s_weather_cleanup_requested\.exchange'
           r'\(false, std::memory_order_acq_rel\)\)')
seed, count = re.subn(pattern,
                      'if (!c.weather_enabled && '
                      's_weather_cleanup_requested.exchange(false, std::memory_order_acq_rel))',
                      s, count=1)
assert count == 1, "seed 41 did not apply — Weather tombstone branch moved"
open(p, "w").write(seed)
PY4
expect_red "the MQTT worker discarding an enabled Weather source-change tombstone" run_contract
restore

# 42. Keep the location but remove device-wide diagnostics consent without requesting cleanup.
python3 - "$TMP/main/http_config.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static esp_err_t set_diagnostics(")
end = s.index("static esp_err_t set_circulation", start)
body = s[start:end]
mutated = body.replace("    if (weather_was_publishable && !enabled) mqtt_request_weather_cleanup();\n", "", 1)
assert mutated != body, "seed 42 did not apply — diagnostics Weather cleanup moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "diagnostics-off keeping retained Weather evidence" run_contract
restore

# 43. A throwing/failed config_save must not wedge SourceChange forever.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("WeatherSourceChange::~WeatherSourceChange()")
end = s.index("void WeatherSourceChange::commit()", start)
body = s[start:end]
mutated = body.replace("    release_source_change();\n", "", 1)
assert mutated != body, "seed 43 did not apply — Weather RAII release moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "a failed Weather save permanently owning source admission" run_contract
restore

# 44. Drop a pending mutation when the network owner exits instead of handing it SourceChange.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static void release_admission()")
end = s.index("\n    }\n};", start)
body = s[start:end]
mutated = body.replace("expected, SourceAdmission::SourceChange,",
                       "expected, SourceAdmission::Idle,", 1)
assert mutated != body, "seed 44 did not apply — Weather handoff moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "the Weather network owner dropping a pending source mutation" run_contract
restore

# 45. A timed-out change returns 503 unchanged. Advancing its token would discard valid evidence.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
pattern = (r'(if \(s_source_admission\.compare_exchange_strong\('
           r'expected, SourceAdmission::Network,[\s\S]{0,180}?\)\)\n)(\s*)return false;')
seed, count = re.subn(pattern,
                      r'\1\2s_source_generation.fetch_add(1, std::memory_order_acq_rel);\n'
                      r'\2return false;', s, count=1)
assert count == 1, "seed 45 did not apply — Weather timeout rollback moved"
open(p, "w").write(seed)
PY4
expect_red "a rejected Weather mutation cancelling the still-authoritative request" run_contract
restore

# 46. Reintroduce an allocation after cfg was durably written. bad_alloc would make HTTP report a
#     failed save even though NVS already changed.
python3 - "$TMP/main/config.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
pattern = (r'    const std::vector<uint8_t> link = link_blob_serialize\(\n'
           r'        LinkBlob\{c\.rx_pin, c\.tx_pin, static_cast<char>\(c\.proto\), c\.x10a_identity_fp\}\);\n')
match = re.search(pattern, s)
assert match, "seed 46 did not apply — staged link serialization moved"
declaration = match.group(0)
seed = s[:match.start()] + s[match.end():]
needle = '    const esp_err_t link_err = nvs_set_blob("link", link.data(), link.size());\n'
assert needle in seed, "seed 46 did not apply — link write moved"
seed = seed.replace(needle, declaration + needle, 1)
open(p, "w").write(seed)
PY4
expect_red "Config discovering an allocation failure after its first durable write" run_contract
restore

# 47. Tombstone succeeds but dedup still remembers the predecessor, so an identical-looking new
#     source can be suppressed after the cleanup.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static void apply_source_cleanup_completion(")
end = s.index("static void service_source_cleanup_evidence", start)
body = s[start:end]
mutated = body.replace("        s_last_weather_json.clear();\n", "", 1)
assert mutated != body, "seed 47 did not apply — Weather cache clear moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "a Weather tombstone retaining the old dedup cache" run_contract
restore

# 48. Let age alone decide freshness again. Immediately after a provider failure the retained old
#     value is then `available:0` beside `fresh:1`, contradicting the same atomic status snapshot.
python3 - "$TMP/main/logic/weather_mqtt.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("if (!s.available)", "if (false && !s.available)", 1)
assert seed != s, "seed 48 did not apply — Weather MQTT availability gate moved"
open(p, "w").write(seed)
PY4
expect_red "a failed age-young Weather value still advertised as fresh over MQTT" run_contract
restore

# 49. Drop Weather from clean-client reconstruction. A reset between the durable source/consent
#     save and RAM request service would then resurrect superseded retained payload indefinitely.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "static_cast<uint8_t>(MqttCleanupSource::Weather) |"
seed = s.replace(old, "", 1)
assert seed != s, "seed 49 did not apply — broker-session cleanup reconstruction moved"
open(p, "w").write(seed)
PY4
expect_red "reset losing the pending retained Weather cleanup" run_contract
restore

# 50. The same clean-client reconstruction requirement exists for HomeHub.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "static_cast<uint8_t>(MqttCleanupSource::Modbus) |"
seed = s.replace(old, "", 1)
assert seed != s, "seed 50 did not apply — HomeHub reconnect cleanup moved"
open(p, "w").write(seed)
PY4
expect_red "reset losing the pending HomeHub cleanup" run_contract
restore

# 51. Retract only on disable again. Changing A -> B then leaves A's retained measurements visible
#     until B can publish through the X10A gate, which may never open.
python3 - "$TMP/main/http_config.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace(
    "        if (modbus_was_enabled) mqtt_request_modbus_cleanup();\n",
    "        if (modbus_was_enabled && !config_modbus_enabled(c)) mqtt_request_modbus_cleanup();\n",
    1)
assert seed != s, "seed 51 did not apply — HomeHub identity cleanup condition moved"
open(p, "w").write(seed)
PY4
expect_red "an enabled HomeHub source change retaining predecessor evidence" run_contract
restore

# 52. ENV III disable applies by reboot, so clean-client reconstruction must include it before X10A.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "static_cast<uint8_t>(MqttCleanupSource::Env3)"
seed = s.replace(old, "0", 1)
assert seed != s, "seed 52 did not apply — ENV III reconnect cleanup moved"
open(p, "w").write(seed)
PY4
expect_red "reset losing disabled ENV III retained cleanup" run_contract
restore

# 53. Keep the request flag but drop its admission into the shared scheduler.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = ("    if (s_env3_cleanup_requested.exchange(false, std::memory_order_acq_rel))\n"
       "        s_source_cleanup.request(MqttCleanupSource::Env3);\n")
seed = s.replace(old, "", 1)
assert seed != s, "seed 53 did not apply — ENV III cleanup branch moved"
open(p, "w").write(seed)
PY4
expect_red "ENV III reconnect cleanup flag with no tombstone service" run_contract
restore

# 54. Turn rejected enqueue into a fake in-flight item. Topic allocation/queue failure would then
#     strand the scheduler instead of retrying the same active step on the next cycle.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("    bool publish_queued(")
end = s.index("    bool acknowledge(", start)
body = s[start:end]
mutated = body.replace("            return false;\n", "            { in_flight_id_ = 0; return false; }\n", 1)
assert mutated != body, "seed 54 did not apply — rejected-enqueue retry moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "an ENV III cleanup allocation exception losing its intent" run_contract
restore

# 55. Arm deletion immediately after the NVS save again. mqtt_task can consume it while mb_status
#     and the cache still describe A, then republish A in the same cycle before mb_reconfigure runs.
python3 - "$TMP/main/http_config.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "        if (modbus_was_enabled) mqtt_request_modbus_cleanup();\n"
assert needle in s, "seed 55 did not apply — ordered HomeHub cleanup moved"
s = s.replace(needle, "", 1)
save = ('    if (!config_save(c, /*require_link=*/x10a_sent))\n'
        '        return send_err(req, "500 Internal Server Error", "config write failed");\n')
assert save in s, "seed 55 did not apply — HomeHub save boundary moved"
s = s.replace(save, save + "    if (modbus_was_enabled) mqtt_request_modbus_cleanup();\n", 1)
open(p, "w").write(s)
PY4
expect_red "HomeHub cleanup admitted before cache/source cutover" run_contract
restore

# 56. Re-read the string-owning Config after NVS already committed. A bad_alloc would make /set_hp
#     report 503 even though the new target is durable and could skip predecessor cleanup entirely.
python3 - "$TMP/main/http_config.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "        mb_reconfigure(modbus_enabled);\n"
new = "        mb_reconfigure(config_modbus_enabled(config()));\n"
seed = s.replace(old, new, 1)
assert seed != s, "seed 56 did not apply — staged HomeHub enable cutover moved"
open(p, "w").write(seed)
PY4
expect_red "a post-save HomeHub Config allocation" run_contract
restore

# 57. Let history fetch the target itself again. That helper copies every Config string and can
#     throw after the durable save, recreating the same split-brain response one layer earlier.
python3 - "$TMP/main/history.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "void history_modbus_reset(uint32_t target_fp) noexcept {\n"
assert needle in s, "seed 57 did not apply — staged HomeHub history boundary moved"
seed = s.replace(needle, needle + "    target_fp = current_mb_target_fp();\n", 1)
open(p, "w").write(seed)
PY4
expect_red "a post-save HomeHub history Config allocation" run_contract
restore

# 58. Remove the compiler-visible no-throw contract from the runtime cutover.
python3 - "$TMP/main/hp_modbus.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("void mb_reconfigure(bool enabled) noexcept {",
                 "void mb_reconfigure(bool enabled) {", 1)
assert seed != s, "seed 58 did not apply — HomeHub noexcept boundary moved"
open(p, "w").write(seed)
PY4
expect_red "a fallible post-save HomeHub runtime cutover" run_contract
restore

# 59. Advance HomeHub dedup after attempting, rather than successfully queueing, the publish.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = ('    if (js != s_last_modbus_json &&\n'
       '        mqtt_publish(s_modbus, js.c_str(), static_cast<int>(js.size()), 0, 1)) {\n')
new = ('    if (js != s_last_modbus_json) {\n'
       '        mqtt_publish(s_modbus, js.c_str(), static_cast<int>(js.size()), 0, 1);\n')
seed = s.replace(old, new, 1)
assert seed != s, "seed 59 did not apply — HomeHub publish acknowledgement moved"
open(p, "w").write(seed)
PY4
expect_red "HomeHub dedup advancing after broker rejection" run_contract
restore

# 60. Make the same acknowledgement error for Weather state.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = ('    if (js != s_last_weather_json &&\n'
       '        mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1)) {\n')
new = ('    if (js != s_last_weather_json) {\n'
       '        mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1);\n')
seed = s.replace(old, new, 1)
assert seed != s, "seed 60 did not apply — Weather publish acknowledgement moved"
open(p, "w").write(seed)
PY4
expect_red "Weather dedup advancing after broker rejection" run_contract
restore

# 61. Keep ENV III's dedup/sample counters even when mqtt_publish rejects the document.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = '        if (mqtt_publish(s_env3, js.c_str(), static_cast<int>(js.size()), 0, 1)) {\n'
new = ('        mqtt_publish(s_env3, js.c_str(), static_cast<int>(js.size()), 0, 1);\n'
       '        {\n')
seed = s.replace(old, new, 1)
assert seed != s, "seed 61 did not apply — ENV III state acknowledgement moved"
open(p, "w").write(seed)
PY4
expect_red "ENV III state acknowledged after broker rejection" run_contract
restore

# 62. Ignore one or more failed discovery config publishes and still return success.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = '        if (!mqtt_publish(topic, config.c_str(), 0, 0, 1)) ok = false;\n'
new = '        (void)mqtt_publish(topic, config.c_str(), 0, 0, 1);\n'
seed = s.replace(old, new, 1)
assert seed != s, "seed 62 did not apply — ENV III discovery result moved"
open(p, "w").write(seed)
PY4
expect_red "partial ENV III discovery reported as complete" run_contract
restore

# 63. Mark ENV III discovery announced regardless of the aggregate publish result.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = ('                            if (publish_env3_discovery()) {\n'
       '                                s_env3_discovery_announced = true;\n')
new = ('                            (void)publish_env3_discovery();\n'
       '                            {\n'
       '                                s_env3_discovery_announced = true;\n')
seed = s.replace(old, new, 1)
assert seed != s, "seed 63 did not apply — ENV III announcement gate moved"
open(p, "w").write(seed)
PY4
expect_red "ENV III discovery announced after partial failure" run_contract
restore

# 64. Leave HomeHub retired discovery out of the clean-client scheduler.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT  = 27",
                 "MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT  = 0", 1)
assert seed != s, "seed 64 did not apply — HomeHub retired cleanup moved"
open(p, "w").write(seed)
PY4
expect_red "retired HomeHub discovery gated on X10A" run_contract
restore

# 65. Leave retired Weather discovery out of the clean-client scheduler.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT = 4",
                 "MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT = 0", 1)
assert seed != s, "seed 65 did not apply — Weather retired cleanup moved"
open(p, "w").write(seed)
PY4
expect_red "retired Weather discovery gated on X10A" run_contract
restore

# 66. Remove the atomic task-retirement check and restore the fallible empty-host snapshot after the
#     TLS-owner delay. Persistent OOM can then keep the disabled task and predecessor socket alive.
python3 - "$TMP/main/hp_modbus.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
atomic = '        if (!s_target_enabled.load(std::memory_order_acquire)) break;\n'
assert atomic in s, "seed 66 did not apply — HomeHub disable admission moved"
seed = s.replace(atomic, "", 1)
poll = '            if (esp_timer_get_time() >= s_next_try_us) mb_poll_once();\n'
assert poll in seed, "seed 66 did not apply — HomeHub poll point moved"
seed = seed.replace(poll,
                    '            if (config_modbus_host(config()).empty()) break;\n' + poll, 1)
open(p, "w").write(seed)
PY4
expect_red "HomeHub disable blocked by Config OOM and TLS delay" run_contract
restore

# 67. Let a foreign PUBACK advance the active cleanup item.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("    bool acknowledge(")
end = s.index("    bool retry_deleted(", start)
body = s[start:end]
mutated = body.replace(" || evidence.msg_id != in_flight_id_", "", 1)
assert mutated != body, "seed 67 did not apply — exact PUBACK identity moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "foreign PUBACK advancing retained cleanup" run_contract
restore

# 68. Treat explicit outbox-deletion evidence as a PUBACK and skip the lost tombstone.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("    bool acknowledge(")
end = s.index("    bool retry_deleted(", start)
body = s[start:end]
mutated = body.replace(
    "evidence.outcome != MqttCleanupDeliveryOutcome::Published || ", "", 1)
assert mutated != body, "seed 68 did not apply — delivery outcome gate moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "expired outbox item acknowledged as published" run_contract
restore

# 69. Complete Weather after its state tombstone, before the four discovery acknowledgements.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("            return 1 + MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT;",
                 "            return 1;", 1)
assert seed != s, "seed 69 did not apply — Weather completion count moved"
open(p, "w").write(seed)
PY4
expect_red "Weather cleanup ignoring a retired-discovery failure" run_contract
restore

# 70. Complete HomeHub after its state tombstone, before 27 discovery acknowledgements.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("            return 1 + MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT;",
                 "            return 1;", 1)
assert seed != s, "seed 70 did not apply — HomeHub completion count moved"
open(p, "w").write(seed)
PY4
expect_red "HomeHub cleanup ignoring a retired-discovery failure" run_contract
restore

# 71. Complete disabled ENV III after its state tombstone, before discovery acknowledgements.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "            return active_env3_enabled_ ? 1 : 1 + MQTT_ENV3_CLEANUP_DISCOVERY_COUNT;"
seed = s.replace(old, "            return 1;", 1)
assert seed != s, "seed 71 did not apply — ENV III completion count moved"
open(p, "w").write(seed)
PY4
expect_red "ENV III cleanup ignoring a discovery failure" run_contract
restore

# 72. Drop the per-index bound so corrupt scheduler state can address an invented ENV III topic.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static std::string source_cleanup_topic(")
end = s.index("static void apply_source_cleanup_completion", start)
body = s[start:end]
mutated = body.replace("action.index < ENV3_HA_SENSOR_COUNT", "true", 1)
assert mutated != body, "seed 72 did not apply — ENV III topic bound moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "unbounded ENV III discovery cleanup index" run_contract
restore

# 73. An enabled ENV III source change invalidates state but must retain its source-independent
#     discovery identities.
python3 - "$TMP/main/logic/mqtt_cleanup.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "            return active_env3_enabled_ ? 1 : 1 + MQTT_ENV3_CLEANUP_DISCOVERY_COUNT;"
new = "            return 1 + MQTT_ENV3_CLEANUP_DISCOVERY_COUNT;"
seed = s.replace(old, new, 1)
assert seed != s, "seed 73 did not apply — ENV III enabled-source condition moved"
open(p, "w").write(seed)
PY4
expect_red "enabled ENV III discovery deleted during source cleanup" run_contract
restore

# 74. Move the entire explicit cleanup call under the X10A publication admission gate.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import re
import sys
p = sys.argv[1]
s = open(p).read()
match = re.search(
    r"^\s*const RetainedCleanupCycle\s+cleanup_cycle\s*=\s*"
    r"service_requested_topic_cleanup\(ref_config\);\n",
    s,
    flags=re.MULTILINE,
)
assert match, "seed 74 did not apply — cleanup call moved"
call = match.group(0)
seed = s[:match.start()] + s[match.end():]
gate = '            if (gate.publish_cycle) {\n'
assert gate in seed, "seed 74 did not apply — publication gate moved"
seed = seed.replace(gate, gate + "    " + call, 1)
open(p, "w").write(seed)
PY4
expect_red "all source cleanup gated on X10A" run_contract
restore

# 75. A successful HomeHub delete must invalidate the last-published payload so a later source with
#     coincidentally identical JSON is still published.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static void apply_source_cleanup_completion(")
end = s.index("static void service_source_cleanup_evidence", start)
body = s[start:end]
mutated = body.replace("        s_last_modbus_json.clear();\n", "", 1)
assert mutated != body, "seed 75 did not apply — HomeHub cache clear moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "HomeHub tombstone retaining publish dedup" run_contract
restore

# 76. ENV III needs the same payload invalidation after a successful cleanup.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static void apply_source_cleanup_completion(")
end = s.index("static void service_source_cleanup_evidence", start)
body = s[start:end]
mutated = body.replace("        s_last_env3_json.clear();\n", "", 1)
assert mutated != body, "seed 76 did not apply — ENV III cache clear moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "ENV III tombstone retaining publish dedup" run_contract
restore

# 77. Reset the independent sample acknowledgement too, or an equal counter after source replacement
#     can suppress the first real reading.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import re
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("static void apply_source_cleanup_completion(")
end = s.index("static void service_source_cleanup_evidence", start)
body = s[start:end]
mutated, count = re.subn(r"^\s*s_last_env3_samples\s*=\s*0;\n", "", body,
                         count=1, flags=re.MULTILINE)
assert count == 1, "seed 77 did not apply — ENV III sample reset moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "ENV III tombstone retaining sample acknowledgement" run_contract
restore

# 78. The cleanup set is historical evidence, not today's 32-row telemetry catalog. Even replacing
#     only the count recouples it and creates out-of-bounds/invented tombstones as the catalog grows.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'for (int i = 0; i < RETIRED_MODBUS_HA_SENSOR_COUNT; i++)'
new = 'for (int i = 0; i < def::HOMEHUB_REG_COUNT; i++)'
seed = s.replace(old, new, 1)
assert seed != s, "seed 78 did not apply — retired HomeHub ledger loop moved"
open(p, "w").write(seed)
PY4
expect_red "retired HomeHub ledger recoupled to current catalog" run_contract
restore

# 79. The MQTT loop services explicit cleanup before ordinary publication. Removing the per-cycle
#     witness lets a still-enabled A-to-B source or a retiring worker recreate retained state
#     immediately after its tombstone.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "                if (!cleanup_cycle.modbus) {\n"
new = "                if (true) {\n"
seed = s.replace(old, new, 1)
assert seed != s, "seed 79 did not apply — HomeHub cleanup-cycle gate moved"
open(p, "w").write(seed)
PY4
expect_red "HomeHub state recreated in its cleanup cycle" run_contract
restore

# 80. Diagnostics-off can commit after mqtt_task snapshots Config but before it consumes cleanup.
#     Without this witness the stale true snapshot publishes a synthetic disabled document after the
#     tombstone, briefly resurrecting the source for downstream consumers.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "                if (!cleanup_cycle.weather)\n"
new = "                if (true)\n"
seed = s.replace(old, new, 1)
assert seed != s, "seed 80 did not apply — Weather cleanup-cycle gate moved"
open(p, "w").write(seed)
PY4
expect_red "Weather stale snapshot published in its cleanup cycle" run_contract
restore

# 81. The worker remains alive until its next loop after Off. Its task-status flag is therefore stale
#     publication authority; only the atomic intent installed after the durable save is current.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "retained_source_action(mb_target_enabled(), s_modbus_disabled_cleaned)"
new = "retained_source_action(mb_status().enabled, s_modbus_disabled_cleaned)"
seed = s.replace(old, new, 1)
assert seed != s, "seed 81 did not apply — HomeHub target-intent gate moved"
open(p, "w").write(seed)
PY4
expect_red "HomeHub publication authorized by retiring task lifetime" run_contract
restore

# 82. HTTP can win source admission after the task marks fetching but before NetworkActivity starts.
#     If config_save then fails, the old source remains valid and this abandoned attempt must be
#     settled before an OTA hold-off can prolong a false fetching:true status.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("            if (source_preempted) {")
end = s.index(
    "            if (s_source_generation.load(std::memory_order_acquire) != source_generation) continue;",
    start)
body = s[start:end]
mutated = body.replace("                    s_status.fetching = false;\n", "", 1)
assert mutated != body, "seed 82 did not apply — preempted Weather finalization moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "failed Weather source save retaining fetching true" run_contract
restore

# 83. Keep connect-time/source cleanup intact but move only the five-minute HA convergence retry
#     back under the ordinary X10A gate. A permanently silent bus would then strand an entity when
#     HA was offline for the first tombstone.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index('            // HA may have been offline for the connect-time tombstones.')
end = s.index('            publish_stage = "heating_curve";', start)
block = s[start:end]
seed = s[:start] + s[end:]
gate = '            if (gate.publish_cycle) {\n'
assert gate in seed, "seed 83 did not apply — ordinary publish gate moved"
seed = seed.replace(gate, gate + block, 1)
open(p, "w").write(seed)
PY4
expect_red "retired discovery retry gated on X10A" run_contract
restore

# 84. The retirement ledger is immutable historical evidence. A kind change targets a different
#     discovery topic even though the object id still looks familiar, leaving the real entity behind.
python3 - "$TMP/main/logic/discovery.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = '{"binary_sensor", "circulation_pump_running"}'
new = '{"sensor", "circulation_pump_running"}'
seed = s.replace(old, new, 1)
assert seed != s, "seed 84 did not apply — retired HomeHub literal moved"
open(p, "w").write(seed)
PY4
expect_red "retired HomeHub literal drift" run_contract
restore

# 85. Once the five-minute interval fires, the timer must restart. Without this reset the task sends
#     every retired discovery tombstone once per second forever, creating a broker/heap flood.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = ('                        retract_weather_discovery();\n'
       '                        ha_retire_elapsed_s = 0;\n')
new = '                        retract_weather_discovery();\n'
seed = s.replace(old, new, 1)
assert seed != s, "seed 85 did not apply — periodic retirement reset moved"
open(p, "w").write(seed)
PY4
expect_red "retired discovery timer flood" run_contract
restore

# 86. Pin all four short-lived Weather discovery topics, not just the first and last. A drift in a
#     middle literal sends the recurring tombstone to the wrong topic and strands the real entity.
python3 - "$TMP/main/logic/weather_mqtt.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = '{"binary_sensor", "weather_forecast_available"}'
new = '{"sensor", "weather_forecast_available"}'
seed = s.replace(old, new, 1)
assert seed != s, "seed 86 did not apply — retired Weather literal moved"
open(p, "w").write(seed)
PY4
expect_red "retired Weather literal drift" run_contract
restore

# 87. A configured and consented source cannot become waiting when no Weather worker exists for the
#     boot. Bypassing the final-state selection recreates both races: Available -> create failure ->
#     later commit, and NotStarted staging -> deadline failure -> later commit.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "if (configured_ && diagnostics_enabled_)"
new = "if (false && configured_ && diagnostics_enabled_)"
seed = s.replace(old, new, 1)
assert seed != s, "seed 87 did not apply — final Weather task-state selection moved"
open(p, "w").write(seed)
PY4
expect_red "Weather source save erasing its boot-latched task failure" run_contract
restore

# 88. A provisional Available state opens the exact race the task-state overlay closes: an HTTP
#     source transaction can stage waiting, task creation can then fail, and its later commit can
#     overwrite the final failure forever. Availability begins only after xTaskCreate succeeds.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("void weather_forecast_start()")
end = s.index("void weather_forecast_reconfigure()", start)
body = s[start:end]
create = body.index("    if (xTaskCreate(")
available = body.index("    s_task_start_state.store(WeatherTaskStartState::Available", create)
available_end = body.index(";\n", available) + 2
block = body[available:available_end]
mutated = body[:create] + block + body[create:available] + body[available_end:]
assert mutated != body, "seed 88 did not apply — successful Weather task availability moved"
open(p, "w").write(s[:start] + mutated + s[end:])
PY4
expect_red "Weather task availability published before task creation succeeds" run_contract
restore

# 89. Worker-start errors describe an active source that cannot be serviced. Emitting the same error
#     while Weather is unconfigured or intentionally skipped in Safe Mode contradicts visible state.
python3 - "$TMP/main/http_status.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "if (weather_source_active && !wf.error.empty())"
new = "if (!wf.error.empty())"
seed = s.replace(old, new, 1)
assert seed != s, "seed 89 did not apply — Weather error authority moved"
open(p, "w").write(seed)
PY4
expect_red "intentional Weather absence leaking a worker error" run_contract
restore

# 90. Safe Mode deliberately skips the Weather task. Its freshness reason must name that deliberate
#     absence, not inherit task_unavailable from a config save performed during recovery.
python3 - "$TMP/main/http_status.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'weather.reason = "safe_mode";'
new = 'weather.reason = wf.reason.empty() ? "unavailable" : wf.reason.c_str();'
seed = s.replace(old, new, 1)
assert seed != s, "seed 90 did not apply — Weather Safe Mode freshness overlay moved"
open(p, "w").write(seed)
PY4
expect_red "Safe Mode Weather freshness reporting task unavailable" run_contract
restore

# 91. If the boot-static Weather mutex allocation failed, no task/source transaction can write the
#     default snapshot. Reintroducing the old string assignment both races HTTP/MQTT readers and may
#     throw another allocation failure from the infrastructure-OOM path.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("    if (!s_mtx) {")
state = s.index("WeatherTaskStartState::TaskStartFailed", start)
insert = s.index("\n", s.index(";", state)) + 1
seed = s[:insert] + '        s_status.error = "out_of_memory";\n' + s[insert:]
assert seed != s, "seed 91 did not apply — Weather mutex-OOM branch moved"
open(p, "w").write(seed)
PY4
expect_red "Weather mutex OOM writing unlocked allocating status" run_contract
restore

# 92. HTTP starts before Weather on an ordinary boot, so the handle write can overlap a reconfigure
#     or refresh read. A raw pointer is a C++ data race even when aligned machine loads look atomic.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
import re
p = sys.argv[1]
s = open(p).read()
seed, count = re.subn(r"std::atomic<TaskHandle_t>\s+s_task\{nullptr\};",
                      "TaskHandle_t s_task = nullptr;", s, count=1)
assert count == 1, "seed 92 did not apply — Weather task-handle declaration moved"
open(p, "w").write(seed)
PY4
expect_red "non-atomic Weather task publication after HTTP start" run_contract
restore

# 93. The scheduler may run the worker before xTaskCreate returns. Without its short publication
#     gate it can sleep on stale Config while an HTTP save sees no published handle and loses wakeup.
python3 - "$TMP/main/weather_forecast.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("void weather_task(void*)")
loop = s.index("    for (;;) {", start)
gate = s[start:loop]
begin = gate.index("    while (s_task_start_state.load")
end = gate.index("        vTaskDelay(1);", begin) + len("        vTaskDelay(1);\n")
mutated = gate[:begin] + gate[end:]
assert mutated != gate, "seed 93 did not apply — Weather publication gate moved"
open(p, "w").write(s[:start] + mutated + s[loop:])
PY4
expect_red "Weather worker reading Config before task publication" run_contract
restore

# 94. Hiding ENV III rows from /status is not enough: the direct history route must refuse retained
#     RAM/journal evidence while the source is disabled.
python3 - "$TMP/main/http_status.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "(env3_source && (!env3_configured || env_t < 0))"
new = "(env3_source && env_t < 0)"
seed = s.replace(old, new, 1)
assert seed != s, "seed 94 did not apply — disabled ENV III history authority moved"
open(p, "w").write(seed)
PY4
expect_red "disabled ENV III history still directly addressable" run_contract
restore

if [ "$fail" -ne 0 ]; then
  echo
  echo "The source-absence matrix no longer catches a defect it was built for."
  exit 1
fi
echo
echo "source-absence selftest: every seeded defect was caught"
