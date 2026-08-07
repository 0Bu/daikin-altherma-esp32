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

if [ "$fail" -ne 0 ]; then
  echo
  echo "The source-absence matrix no longer catches a defect it was built for."
  exit 1
fi
echo
echo "source-absence selftest: every seeded defect was caught"
