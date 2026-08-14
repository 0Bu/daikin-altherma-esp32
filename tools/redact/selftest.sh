#!/usr/bin/env bash
# Does the redaction guard still catch what it was built for?
#
# The same contract tools/domain/selftest.sh and tools/schematic/selftest.sh keep: a check that
# reports "clean" is worthless unless it can be shown to go red. This one re-seeds every defect the
# guard exists for, in a throwaway copy of the tree, and fails if any of them passes — one
# `expect_red` each, so `grep -c '^expect_red ' selftest.sh` is the count. Both halves are covered:
#
#   /diag   — a redaction rule is deleted (the list falls behind the code it describes); a new diag
#             line prints a config value with no rule (the list never caught up in the first place,
#             the shape of the mqtt board_id leak the guard found on its first run); the
#             DISCOVERED-identity shape, which the heuristic sees only because SENSITIVE lists bland
#             names rather than the /status field names alone; and a line printing the ROOM SOURCE's
#             topic, which pins the four fields SENSITIVE was missing while /status already redacted
#             them — the one case that is silently green if that list narrows again.
#   /status — a field stops being wrapped, the declared count drifts while the code is right, a new
#             Config identifier is never wrapped, and the public field table drops a documented row.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/main" "$ROOT/tools" "$ROOT/docs" "$TMP/"
CHECK="$TMP/tools/redact/check_diag_coverage.py"
fail=0

expect_red() {
  local what="$1"
  if python3 "$CHECK" >/dev/null 2>&1; then
    echo "FAIL: the guard stayed green with $what"
    fail=1
  else
    echo "ok:   caught $what"
  fi
}

# Baseline: the real tree must be green, or nothing below means anything.
if ! python3 "$CHECK" >/dev/null 2>&1; then
  echo "FAIL: the unmodified tree is already red — fix that before trusting this selftest"
  python3 "$CHECK" || true
  exit 1
fi
echo "ok:   unmodified tree is clean"

# 1. Delete a rule. The line it covered is still in the source, so it must be reported.
python3 - "$TMP/main/logic/redact.hpp" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
s2 = re.sub(r'\n\s*\{"syslog: target set to ", ""\},', '', s, count=1)
assert s2 != s, "seed 1 did not apply — the rule text moved"
open(p, "w").write(s2)
PY
expect_red "a deleted redaction rule (syslog: target set to)"

cp -R "$ROOT/main/logic/redact.hpp" "$TMP/main/logic/redact.hpp"

# 2. Add a new leaking line with no rule.
python3 - "$TMP/main/syslog.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "void syslog_send"
i = s.index(needle)
s = s[:i] + 'static void seeded() { diag_printf("syslog: seeded leak %s\\n", c.syslog_host.c_str()); }\n\n' + s[i:]
open(p, "w").write(s)
PY
expect_red "a new diag line printing a config value with no rule"

cp -R "$ROOT/main/syslog.cpp" "$TMP/main/syslog.cpp"

# 3. The DISCOVERED-identity shape, which is the one that got through. hp_modbus.cpp's initial or
#    manual mDNS search puts the HomeHub's resolved LAN IPv4 into a local called
#    `found` and logs it. That is not a config value copied into a local — it is a value the device
#    LEARNS at runtime and then treats as one, and /status?redact=1 withholds the very same string as
#    modbus.host. The heuristic missed it because the identifier says nothing about what it holds,
#    which is exactly why SENSITIVE lists bland names rather than the /status field names alone.
#    Seeded by deleting the RULE, so what is under test is the heuristic's ability to see the line.
python3 - "$TMP/main/logic/redact.hpp" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
s2 = re.sub(r'\n\s*\{" mDNS search found gateway ", ""\},', '', s, count=1)
assert s2 != s, "seed 3 did not apply — the rule text moved"
open(p, "w").write(s2)
PY
expect_red "an unruled diag line printing a DISCOVERED HomeHub IPv4"

cp -R "$ROOT/main/logic/redact.hpp" "$TMP/main/logic/redact.hpp"

# 4. The /status half, in the direction that LEAKS: a field stops being wrapped. This is not a
#    hypothetical — it is the shipped shape of the same defect one layer up, where the declared count
#    sat at 10 while the builder wrapped 12 and nothing compared them. Un-wrapping the room topic
#    (a path through the reporter's own broker, usually carrying a room or device name) drops the
#    derived count below the declaration, which is the only signal available: the JSON still parses,
#    the key is still there, and the value is simply real.
python3 - "$TMP/main/http_status.cpp" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
s2 = re.sub(r"jstr_r\(c\.ref_temp_topic,\s*redact\)", "jstr(c.ref_temp_topic)", s, count=1)
assert s2 != s, "seed 4 did not apply — the reference-topic call site moved"
open(p, "w").write(s2)
PY
expect_red "a /status field that stopped being redacted"

cp -R "$ROOT/main/http_status.cpp" "$TMP/main/http_status.cpp"

# 5. The same comparison from the other side: the DECLARATION drifts while the code is right. Seeded
#    with the exact number the header carried before this check existed.
python3 - "$TMP/main/logic/redact.hpp" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
s2 = re.sub(r"(REDACTED_STATUS_FIELDS\s*=\s*)\d+", r"\g<1>10", s, count=1)
assert s2 != s, "seed 5 did not apply — REDACTED_STATUS_FIELDS moved"
open(p, "w").write(s2)
PY
expect_red "a stale REDACTED_STATUS_FIELDS declaration"

cp -R "$ROOT/main/logic/redact.hpp" "$TMP/main/logic/redact.hpp"

# 6. The heuristic's own coverage, on the four fields it was MISSING until this list was widened:
#    the room source's name and topic and the house coordinates were redacted in /status while
#    nothing in SENSITIVE matched them, so a log line naming the reporter's living room was
#    invisible to the check that exists to see exactly that. Seeded on the room topic, since it is
#    the one whose value is a path through the reporter's own broker and normally carries a room or
#    a device name. Without the widening this case is silently green.
python3 - "$TMP/main/http_config.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "static esp_err_t set_syslog"
i = s.index(needle)
s = s[:i] + ('static void seeded_ref() { diag_printf("mqtt: reference source %s\\n",'
             ' c.ref_temp_topic.c_str()); }\n\n') + s[i:]
open(p, "w").write(s)
PY
expect_red "a diag line printing the room source's topic with no rule"

cp -R "$ROOT/main/http_config.cpp" "$TMP/main/http_config.cpp"

# 7. Add a new identifying /status field through plain jstr(), without changing the wrapped count.
#    This is the direction the old count explicitly could not see: the JSON is valid and all existing
#    wrappers remain present, but a user-entered value was never sent through the redactor at all.
python3 - "$TMP/main/http_status.cpp" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = 'j += "\\\"reference_temperature\\\":{\\\"configured\\\":";'
i = s.index(needle)
seed = 'j += "\\\"seeded_identifier\\\":"; j += jstr(c.ref_temp_topic);\n    '
s = s[:i] + seed + s[i:]
open(p, "w").write(s)
PY
expect_red "a never-wrapped /status Config identifier"

cp -R "$ROOT/main/http_status.cpp" "$TMP/main/http_status.cpp"

# 8. Drop one row from the public documentation. The field list is maintained prose, but its names
#    are compared with redact.hpp's machine-readable array so users of old firmware never receive an
#    incomplete manual scrub checklist again.
python3 - "$TMP/docs/REPORTING.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = '| `reference_temperature.temperature_path` |'
lines = s.splitlines(True)
s2 = ''.join(line for line in lines if needle not in line)
assert s2 != s, "seed 8 did not apply — REPORTING field row moved"
open(p, "w").write(s2)
PY
expect_red "a missing public redaction-documentation row"

exit "$fail"
