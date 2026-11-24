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
#     4. an unset identifier redacted into existence
#   browser (test_ui_absence_matrix.mjs)
#     6. a configured HomeHub reported as disabled because its task is not running (safe mode) —
#        /status.modbus.enabled is the one optional-source flag reporting a TASK, not the config
#     7. a cleared broker left unnamed on the circulation row, the state it answered with
#        "waiting for a message" forever
#   firmware, appended (numbers keep growing rather than being re-grouped — a seed's number is how
#   it is referred to elsewhere, so renumbering costs more than the tidier ordering is worth)
#     9. the heap watchdog gated behind the detect/sweep branch — seed 1's defect one feature over,
#        which went green because the assertion covering it was a PROXIMITY search that spans an `if`
#    10. the board trends made conditional IN PLACE — seed 1's defect written in one line, which
#        went green because the assertion anchored on the call TEXT rather than on a statement
#    11. the end-of-ladder minimal boot decided AFTER main.cpp's safe-mode gate, so the poll engine
#        and the MQTT bridge start anyway and take the heap the minimal boot exists to leave free
#    12. that latch deleted outright, which ends the restart ladder back in the unreachable
#        degraded state legacy-407 was filed about
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
#    46. link-blob allocation moved after the first durable Config write
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
#    81. HomeHub publication following retiring task lifetime instead of durable target intent
#    83. the five-minute retired-discovery retry moving behind X10A authority
#    84. a historical HomeHub discovery component/object-id literal drifting
#    85. the periodic retirement timer no longer resetting after a delete pass
#    86. a middle historical Weather discovery component/object-id literal drifting
#    94. disabled ENV III history remaining directly addressable after status/UI hide the source
#    95. an adopted dwell table resuming with its clock left at the sentinel, so the stretch from
#        esp_timer's zero to the first fold is neither elapsed nor blind
#    96. a bare literal 0 written to the dwell clock outside the origin rule
#    97. a wiped dwell table resuming from the adopted origin and booking time against nothing
#    98. the DHW adoption forgetting the current-boot monotonic age
#    99. the DHW adoption handed the restored pending bucket, so a restart discard is counted as
#        a blind abort and read as an X10A fault
#   100. the DHW handoff adopting without its confirmed current source scope
#   101. restoring undated completed DHW counters from the handoff
#   102. the dwell elapsed guard tightened from `>= 0` to `> 0`, so the adopted table's zero origin
#        reads as "no previous observation" and the first fold books nothing again
#   103. the HomeHub raster weighed from its raw ring instead of the ring this boot would adopt, so a
#        HomeHub disabled at runtime (ring frozen, sealed target no longer the configured one) makes
#        the whole RAM history stale and an unrelated source's absence costs every trend
#   104. a stale HomeHub or ENV III raster folded into the region verdict again, so one optional
#        source that stopped refuses the X10A and board trends that did not
#   105. adoption claiming the boot instant again, so the first live commit can land in the bucket the
#        claim sits in and the stretch since the last commit collapses
#   106. adoption booking no gaps, so every restart slides the older part of the curve later and the
#        slides of repeated restarts add up in one direction
#   107. the checkup's not_committed refusal dropping the one-shot DHW handoff, and with it the settle
#        timer a tank charge is owed, so a candidate hour can start inside it
#   108. adoption throwing the rounding remainder away instead of carrying it in, so restarts at a
#        fixed uptime lean the same way at every seam and the older samples drift by hours
#   109. the journal writer walking from its own cursor again instead of the one lifted over the
#        newest adopted real sample, so a seam files that reading a second time
#   110. a count computed for a raster whose rings were just retired, so the boot line reports
#        buckets booked into a ring that holds nothing
#   111. a discarded or settle-only DHW checkpoint falsely logged as a resumed candidate
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/main" "$ROOT/tools" "$ROOT/test" "$ROOT/sdkconfig.defaults" "$TMP/"
fail=0

run_contract() {
  (cd "$TMP" &&
    node test/test_source_absence_contract.mjs &&
    node test/test_mqtt_source_cleanup_contract.mjs &&
    node test/test_history_restore_guard_contract.mjs)
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

MUTATED_FILES=()
python3() {
  for arg in "$@"; do
    if [[ "$arg" == "$TMP/"* ]]; then
      local rel="${arg#$TMP/}"
      MUTATED_FILES+=("$rel")
    fi
  done
  command python3 "$@"
}

restore() {
  if [ $# -gt 0 ]; then
    for f in "$@"; do
      cp "$ROOT/$f" "$TMP/$f"
    done
    MUTATED_FILES=()
  elif [ ${#MUTATED_FILES[@]} -gt 0 ]; then
    for rel in "${MUTATED_FILES[@]}"; do
      cp "$ROOT/$rel" "$TMP/$rel"
    done
    MUTATED_FILES=()
  else
    cp -R "$ROOT/main" "$TMP/"
  fi
}

# 1. Put the board trends back behind the heat pump's poll cycle. This is the defect verbatim: the
#    call moves inside the resolved-profile branch, so a board whose X10A never answers records no
#    heap curve — on exactly the board someone is debugging.
python3 - "$TMP/main/hp_poll.cpp" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
seed = s.replace("            history_record_board();\n", "", 1)
assert seed != s, "seed 1 did not apply — the call site moved"
seed, _ = re.subn(r'if \((?:config\(\)\.profile|config_profile\(\)) != "auto"\) poll_once\(\);',
                  'if (config_profile() != "auto") { history_record_board(); poll_once(); }', seed, count=1)
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

# 4. Redact an unset identifier into existence again — the bug report then claims a broker, a room
#    source and a HomeHub on a device that has none.
python3 - "$TMP/main/http_status.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace('return {redact_identifier_view(s, redact), true};',
                 'return {redact ? std::string_view(REDACTED) : s, true};', 1)
assert seed != s, "seed 4 did not apply — the wrapper moved"
open(p, "w").write(seed)
PY
expect_red "an unset identifier redacted into existence" run_contract
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

# 9. Seed 1's defect, one feature over: the HEAP WATCHDOG moved behind the detect/sweep branch. It
#    samples at the same unconditional cycle top and for the same reason, so gated there it stops
#    watching the heap on exactly the board whose X10A never answers — the board most likely to be
#    in trouble, and the absence seed 1 exists for. Kept as its own seed rather than folded into
#    seed 1 because the two failed DIFFERENTLY: the assertion covering this one was written as a
#    proximity search (`history_record_board();[\s\S]{0,600}?heap_guard_sample();`), which spans the
#    `if` line happily, so it went green with the call sitting inside the branch.
python3 - "$TMP/main/hp_poll.cpp" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
seed, count = re.subn(r'            heap_guard_sample\(\);\n            if \((?:config\(\)\.profile|config_profile\(\)) == "auto"\) \{',
                      '            if (config_profile() == "auto") {\n                heap_guard_sample();', s, count=1)
assert count == 1, "seed 9 did not apply — the heap watchdog's call site moved"
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
                 '            if (config_profile() != "auto") history_record_board();', 1)
assert seed != s, "seed 10 did not apply — the call site moved"
open(p, "w").write(seed)
PY
expect_red "the board trends made conditional in place" run_contract
restore

# 11. legacy-407's end-of-ladder: the minimal boot decided AFTER main.cpp's safe-mode gate. It would then
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
#     legacy-407 was filed about.
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
python3 - "$TMP/main/http_chunks.hpp" <<'PY3'
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

# 46. Reintroduce an allocation after cfg was durably written. bad_alloc would make HTTP report a
#     failed save even though NVS already changed. The sequence is the shared transaction that
#     config.cpp, the host tests and the runtime harness all execute.
python3 - "$TMP/main/logic/config_transaction.hpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
pattern = (r'    const std::vector<uint8_t> link = link_blob_serialize\(\n'
           r'        LinkBlob\{c\.rx_pin, c\.tx_pin, static_cast<char>\(c\.proto\), c\.x10a_identity_fp\}\);\n')
match = re.search(pattern, s)
assert match, "seed 46 did not apply — staged link serialization moved"
declaration = match.group(0)
seed = s[:match.start()] + s[match.end():]
needle = '    const int link_err = store.write_blob(CONFIG_KEY_LINK, link.data(), link.size());\n'
assert needle in seed, "seed 46 did not apply — link write moved"
seed = seed.replace(needle, declaration + needle, 1)
open(p, "w").write(seed)
PY4
expect_red "Config discovering an allocation failure after its first durable write" run_contract
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
    "            if (modbus_was_enabled) mqtt_request_modbus_cleanup();\n",
    "            if (modbus_was_enabled && !config_modbus_enabled(c)) mqtt_request_modbus_cleanup();\n",
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
needle = "            if (modbus_was_enabled) mqtt_request_modbus_cleanup();\n"
assert needle in s, "seed 55 did not apply — ordered HomeHub cleanup moved"
s = s.replace(needle, "", 1)
save = ('        } else if (!config_save(c)) {\n'
        '            return send_err(req, "500 Internal Server Error", "config write failed");\n'
        '        }\n')
assert save in s, "seed 55 did not apply — HomeHub save boundary moved"
s = s.replace(save, save + "        if (modbus_was_enabled) mqtt_request_modbus_cleanup();\n", 1)
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
old = "            mb_reconfigure(modbus_enabled);\n"
new = "            mb_reconfigure(config_modbus_enabled(config()));\n"
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
old = ('        if (!mqtt_publish(s_modbus, js.c_str(), static_cast<int>(js.size()), 0, 1)) return false;\n')
new = ('        mqtt_publish(s_modbus, js.c_str(), static_cast<int>(js.size()), 0, 1);\n')
seed = s.replace(old, new, 1)
assert seed != s, "seed 59 did not apply — HomeHub publish acknowledgement moved"
open(p, "w").write(seed)
PY4
expect_red "HomeHub dedup advancing after broker rejection" run_contract
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
    r"service_requested_topic_cleanup\(cycle_config\);\n",
    s,
    flags=re.MULTILINE,
)
assert match, "seed 74 did not apply — cleanup call moved"
call = match.group(0)
seed = s[:match.start()] + s[match.end():]
gate = '                if (gate.publish_cycle) {\n'
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
mutated = body.replace("        s_last_modbus_digest.clear();\n", "", 1)
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
mutated = body.replace("        s_last_env3_digest.clear();\n", "", 1)
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
old = 'RETIRED_MODBUS_HA_SENSOR_COUNT + RETIRED_WEATHER_HA_SENSOR_COUNT;'
new = 'def::HOMEHUB_REG_COUNT + RETIRED_WEATHER_HA_SENSOR_COUNT;'
seed = s.replace(old, new, 1)
assert seed != s, "seed 78 did not apply — periodic retirement ledger count moved"
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

# 83. Keep connect-time/source cleanup intact but move only the five-minute HA convergence retry
#     back under the ordinary X10A gate. A permanently silent bus would then strand an entity when
#     HA was offline for the first tombstone.
python3 - "$TMP/main/mqtt_ha.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index('            // HA may have been offline for the connect-time tombstones.')
end = s.index('\n\n            if (s_connected) {\n                publish_stage = "announce";', start) + 2
block = s[start:end]
seed = s[:start] + s[end:]
gate = '                if (gate.publish_cycle) {\n'
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
old = ('                        if (!s_periodic_discovery_pending) request_periodic_discovery_retirement();\n'
       '                        ha_retire_elapsed_s = 0;\n')
new = '                        if (!s_periodic_discovery_pending) request_periodic_discovery_retirement();\n'
seed = s.replace(old, new, 1)
assert seed != s, "seed 85 did not apply — periodic retirement reset moved"
open(p, "w").write(seed)
PY4
expect_red "retired discovery timer flood" run_contract
restore

# 86. Pin all four short-lived Weather discovery topics, not just the first and last. A drift in a
#     middle literal sends the recurring tombstone to the wrong topic and strands the real entity.
python3 - "$TMP/main/logic/mqtt_weather_retirement.hpp" <<'PY4'
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

# 95. The adopted dwell table left on the -1 sentinel (seed 15's neighbour: the same clock, the other
#     end of a boot). The first fold then books dt = 0, so the interval from esp_timer's zero to it
#     — behind app_main's network wait — is neither elapsed nor blind and a run keeps `exact`
#     across a boot nobody watched. The CHECKs cannot see it: they feed dwell_step directly.
python3 - "$TMP/main/state_dwell.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("s_last_us = logic::dwell_resume_origin_us(true);", "s_last_us = -1;", 1)
assert seed != s, "seed 95 did not apply — the adopted-table origin moved"
open(p, "w").write(seed)
PY4
expect_red "an adopted dwell table resuming without the boot-to-first-fold interval" run_contract
restore

# 96. A bare literal in a writer that is NOT the origin rule. The Accept and wipe arms still read
#     right, so only the writer multiset can see that something else hands the clock a number.
python3 - "$TMP/main/state_dwell.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("    s_last_us = -1;\n    s_model_fp = 0;", "    s_last_us = 0;\n    s_model_fp = 0;", 1)
assert seed != s, "seed 96 did not apply — dwell_forget's clock reset moved"
open(p, "w").write(seed)
PY4
expect_red "a bare 0 written to the dwell clock outside the origin rule" run_contract
restore

# 97. The wiped table started from the adopted origin. Nothing was adopted, so there is no previous
#     observation to have been blind since: the boot would be booked against an imagined one.
python3 - "$TMP/main/state_dwell.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("s_last_us = logic::dwell_resume_origin_us(false);",
                 "s_last_us = logic::dwell_resume_origin_us(true);", 1)
assert seed != s, "seed 97 did not apply — the wipe-arm origin moved"
open(p, "w").write(seed)
PY4
expect_red "a wiped dwell table counting from esp_timer's zero" run_contract
restore

# 98. A literal age origin instead of the real current-boot monotonic clock.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
seed, count = re.subn(
    r"logic::dhw_loss_adopt\(s_x10a\.dhw_state,\s*s_x10a\.boot_handoff\.candidate,\s*esp_timer_get_time\(\)\)",
    "logic::dhw_loss_adopt(s_x10a.dhw_state, s_x10a.boot_handoff.candidate, 0)",
    s, count=1)
assert count == 1, "seed 98 did not apply — scoped DHW adoption moved"
open(p, "w").write(seed)
PY4
expect_red "the DHW adoption forgetting the current boot uptime" run_contract
restore

# 99. A pending bucket handed to adoption would turn board-side restart loss into a plant discard.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "logic::dhw_loss_adopt(s_x10a.dhw_state, s_x10a.boot_handoff.candidate,"
seed = s.replace(old, "logic::dhw_loss_adopt(s_x10a.dhw_state, s_x10a.P().dhw.pending, s_x10a.boot_handoff.candidate,", 1)
assert seed != s, "seed 99 did not apply — scoped DHW adoption moved"
open(p, "w").write(seed)
PY4
expect_red "the DHW adoption handed the pending bucket" run_contract
restore

# 100. Current source-scope admission withdrawn from the candidate handoff.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("s_x10a.boot_handoff.source_fp == source_fp", "true", 1)
assert seed != s, "seed 100 did not apply — handoff source admission moved"
open(p, "w").write(seed)
PY4
expect_red "DHW handoff adoption without current source scope" run_contract
restore

# 101. Completed undated counters restored from the checkpoint instead of discarded.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "slot.boot_handoff.pending = kEmptyDhwLossBucket;"
seed = s.replace(old, "slot.P().dhw.pending = slot.boot_handoff.pending;", 1)
assert seed != s, "seed 101 did not apply — handoff pending clear moved"
open(p, "w").write(seed)
PY4
expect_red "restoring undated completed DHW pending counters" run_contract
restore

# 102. The elapsed guard tightened from `>= 0` to `> 0`, the "unset" reading of the clock. esp_timer's
#      zero is the adopted table's origin (seed 95's neighbour), so the first fold books dt = 0 and
#      the boot-to-first-fold interval is unbooked again. Seeds 95-97 pin who WRITES the clock and
#      the CHECKs feed dwell_step() a dt directly, so nothing else reads this comparison.
python3 - "$TMP/main/state_dwell.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("if (s_last_us >= 0 && now_us >= s_last_us)",
                 "if (s_last_us > 0 && now_us >= s_last_us)", 1)
assert seed != s, "seed 102 did not apply — the elapsed guard moved"
open(p, "w").write(seed)
PY4
expect_red "an adopted dwell table's zero origin treated as no previous observation" run_contract
restore

# 103. The HomeHub raster weighed from its raw ring. A HomeHub disabled at runtime (/set_hp, no reboot)
#      keeps its ring but stops its raster, and its sealed target is no longer the configured one, so
#      this boot retires the ring anyway - weighing it first lets a source that is gone make the whole
#      RAM history stale, X10A and board trends included.
python3 - "$TMP/main/history.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "mb_keep && rings_have_samples(P().mb_ring, HOMEHUB_HISTORY_COUNT),"
seed = s.replace(old, "rings_have_samples(P().mb_ring, HOMEHUB_HISTORY_COUNT),", 1)
assert seed != s, "seed 103 did not apply - the HomeHub weighing moved"
open(p, "w").write(seed)
PY4
expect_red "the HomeHub raster weighed from its raw ring" run_contract
restore

# 104. The optional rasters folded back into the region verdict: one stalled HomeHub or ENV III task
#      then refuses the X10A and board trends, which are the one raster that is always meant to run.
python3 - "$TMP/main/history.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "P().boots_since_commit, plan.region_bookable);"
new = "P().boots_since_commit,\n        plan.region_bookable && !plan.retire_modbus && !plan.retire_env3);"
seed = s.replace(old, new, 1)
assert seed != s, "seed 104 did not apply - the verdict call moved"
open(p, "w").write(seed)
PY4
expect_red "a stale optional raster refusing the whole region" run_contract
restore

# 105. Adoption claiming the boot instant. The newest booked sample then sits on a different grid from
#      every later commit, and the first live commit can fall into the very wall bucket the claim
#      names.
python3 - "$TMP/main/history.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("persist_adopt(claim_us);", "persist_adopt(start_us);", 1)
assert seed != s, "seed 105 did not apply - the adoption call moved"
open(p, "w").write(seed)
PY4
expect_red "adoption claiming the boot instant" run_contract
restore

# 106. Adoption booking nothing: the stretch between the previous boot's last commit and this boot's
#      first bucket collapses, every restart slides the older samples later, and repeated restarts
#      add up without a bound.
python3 - "$TMP/main/history.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("        persist_book_unobserved(gaps);\n", "", 1)
assert seed != s, "seed 106 did not apply - the booking call moved"
open(p, "w").write(seed)
PY4
expect_red "adoption booking no gaps for the unobserved stretch" run_contract
restore

# 107. The not-aged refusal dropping the DHW handoff. It carries the settle timer a tank charge is
#      owed; without it a candidate hour can start within seconds of the restart, inside the 45
#      minutes the charge should keep quiet.
python3 - "$TMP/main/logic/checkup_persist.hpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
old = "return r == CheckupRestore::Accept || r == CheckupRestore::NotCommitted;"
seed = s.replace(old, "return r == CheckupRestore::Accept;", 1)
assert seed != s, "seed 107 did not apply - the handoff rule moved"
open(p, "w").write(seed)
PY4
expect_red "the not_committed refusal dropping the DHW handoff" run_contract
restore

# 108. Adoption throwing the rounding remainder away. Rounding alone is unbiased only for restarts at
#      random phases of the bucket; a loop at one uptime leaves the same remainder every time and
#      the remainders add up linearly.
python3 - "$TMP/main/history.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
seed, n = re.subn(r"claim_us,\s*P\(\)\.residual_us\[i\]\);", "claim_us, 0);", s, count=1)
assert n == 1, "seed 108 did not apply - the booking call moved"
open(p, "w").write(seed)
PY4
expect_red "adoption not carrying the rounding remainder" run_contract
restore

# 109. The journal writer ignoring the floor over the newest adopted real sample. The adopted ring is
#      shifted by the seam, so that reading can sit one bucket later than the bucket the previous boot
#      filed it under, and the writer files it again where nothing was measured.
python3 - "$TMP/main/history.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
new = "int64_t target = s_flash_last_bucket[src_i] == INT64_MIN ? oldest : s_flash_last_bucket[src_i] + 1;"
seed, n = re.subn(r"int64_t\s+target = cursor == INT64_MIN \? oldest : cursor \+ 1;", new, s, count=1)
assert n == 1, "seed 109 did not apply - the writer's walk moved"
open(p, "w").write(seed)
PY4
expect_red "the journal writer walking from its own cursor" run_contract
restore

# 110. A booking computed for a raster whose rings were retired a moment ago. The boot line would
#      then report buckets booked into rings that hold nothing.
python3 - "$TMP/main/history.cpp" <<'PY4'
import re, sys
p = sys.argv[1]
s = open(p).read()
seed, n = re.subn(r"if \(has\[i\]\)\s*booking = logic::history_adopt_booking\(",
                  "booking = logic::history_adopt_booking(", s, count=1)
assert n == 1, "seed 110 did not apply - the guard moved"
open(p, "w").write(seed)
PY4
expect_red "a count computed for a raster with no rings" run_contract
restore

# 111. Neutral checkpoint application replaced by a false unconditional candidate-resume claim.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("scoped DHW filter checkpoint applied", "scoped DHW candidate resumed", 1)
assert seed != s, "seed 111 did not apply — checkpoint log moved"
open(p, "w").write(seed)
PY4
expect_red "a discarded or settle-only DHW checkpoint logged as a resumed candidate" run_contract
restore

# 112. An eligible journal candidate was evicted by the fixed ring or displaced by live data,
#      yet restoration still rebuilt the ring and advertised flash provenance.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("if (!materialized)", "if (false)", 1)
assert seed != s, "seed 112 did not apply - the selected-interval guard moved"
open(p, "w").write(seed)
PY4
expect_red "zero selected flash intervals advertised as restored evidence" run_contract
restore

# 113. Manual same-source selection and an empty poll consumed the reset, but a pending
#      journal still reintroduced pre-reset diagnosis hours into the new lifecycle.
python3 - "$TMP/main/checkup.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
seed = s.replace("if (logic::checkup_flash_restore_retired(slot.persist_verdict))", "if (false)", 1)
assert seed != s, "seed 113 did not apply - the reset lifecycle guard moved"
open(p, "w").write(seed)
PY4
expect_red "pending diagnosis restore survived an explicit source reset" run_contract
restore

# 114. The flash seed drops the wall-clock fraction before combining it with monotonic age.
python3 - "$TMP/main/history.cpp" <<'PY4'
import sys
p = sys.argv[1]
s = open(p).read()
import re
seed, n = re.subn(r"logic::history_anchor_bucket\(unix_s, now_us, commit_us,\s*logic::HISTORY_DT_S, ms\)",
                  "logic::history_anchor_bucket(unix_s, now_us, commit_us, logic::HISTORY_DT_S, 0)",
                  s, count=1)
assert n == 1, "seed 114 did not apply - the subsecond seed binding moved"
open(p, "w").write(seed)
PY4
expect_red "flash seed discarded the wall-clock milliseconds" run_contract
restore


if [ "$fail" -ne 0 ]; then
  echo
  echo "The source-absence matrix no longer catches a defect it was built for."
  exit 1
fi
echo
echo "source-absence selftest: every seeded defect was caught"
