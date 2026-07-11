#!/usr/bin/env bash
# Stop hook: run the host logic tests before the session ends, so a decode/config/discovery
# regression is caught locally (not only in CI). If they fail, block the stop with the reason so
# the session fixes it first. No-op (allows stop) when no host toolchain is available.
set -u

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Only bother if there are changes to logic-bearing files (fast path for doc/CI-only sessions).
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git diff --quiet -- main/ test/ 2>/dev/null && git diff --cached --quiet -- main/ test/ 2>/dev/null; then
        exit 0
    fi
fi

command -v cmake >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || exit 0

if out="$(scripts/run-mock-tests.sh 2>&1)"; then
    exit 0
fi

# Block the stop: emit the failure so the session addresses it.
printf '{"decision":"block","reason":%s}\n' \
    "$(printf '%s' "Host logic tests failed — fix before stopping:\n$out" | head -c 4000 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '"host logic tests failed (scripts/run-mock-tests.sh)"')"
exit 0
