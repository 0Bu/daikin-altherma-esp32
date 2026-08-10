#!/usr/bin/env bash
# Does the CLAUDE.md byte-budget gate still fail closed?
#
# The same contract every selftest here keeps: a check that reports "clean" is worthless until it
# has been shown to go red. This one is small because the gate is small — three seeds:
#   1. an over-budget file must fail (the gate's whole purpose)
#   2. a MISSING file must exit 2, not report success (the "no input" == "all passed" trap the
#      contract-test glob also refuses)
#   3. an in-budget file must pass (so the gate cannot be red-wired shut)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/scripts/run-claude-md-budget.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "claudemd selftest: $1" >&2; exit 1; }

# 1. over budget -> non-zero
head -c 2048 /dev/zero | tr '\0' 'x' > "$TMP/big.md"
if CLAUDE_MD_FILE="$TMP/big.md" CLAUDE_MD_BUDGET_BYTES=1024 "$GATE" >/dev/null 2>&1; then
  fail "an over-budget file passed"
fi

# 2. missing file -> exit 2, never success
set +e
CLAUDE_MD_FILE="$TMP/absent.md" "$GATE" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -eq 2 ] || fail "a missing file exited $rc instead of 2"

# 3. in budget -> pass
printf 'small\n' > "$TMP/small.md"
CLAUDE_MD_FILE="$TMP/small.md" CLAUDE_MD_BUDGET_BYTES=1024 "$GATE" >/dev/null \
  || fail "an in-budget file failed"

echo "claudemd selftest: 3 seed(s) caught"
