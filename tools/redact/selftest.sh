#!/usr/bin/env bash
# Does the redaction guard still catch what it was built for?
#
# The same contract tools/domain/selftest.sh and tools/schematic/selftest.sh keep: a check that
# reports "clean" is worthless unless it can be shown to go red. This one re-seeds the two defects
# the guard exists for, in a throwaway copy of the tree, and fails if either passes.
#
#   1. A redaction rule is deleted (the list falls behind the code it describes).
#   2. A new diag line prints a config value with no rule (the list never caught up in the first
#      place) — this is the shape of the mqtt board_id leak the guard found on its first run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/main" "$ROOT/tools" "$TMP/"
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

exit "$fail"
