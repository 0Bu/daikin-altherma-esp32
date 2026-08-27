#!/usr/bin/env bash
# Mutation-style checks for the line + branch coverage parser: a green gate must have input and teeth.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHECK=tools/coverage/check_gcov_report.py
# shellcheck source=/dev/null
. tools/coverage/profile.sh
TMP="$(mktemp -d "${TMPDIR:-/tmp}/daikin-coverage-selftest.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/main/logic"
touch "$TMP/main/logic/a.hpp" "$TMP/main/logic/b.hpp"
BASELINE="$TMP/branch-baseline.json"
printf '%s\n' \
    '{' \
    '  "schema": 3,' \
    '  "profiles": {' \
    '    "test": {' \
    '      "main/logic/a.hpp": {"taken": 8, "outcomes": 10},' \
    '      "main/logic/b.hpp": {"taken": 3, "outcomes": 5}' \
    '    }' \
    '  }' \
    '}' >"$BASELINE"
RAISED_BASELINE="$TMP/raised-branch-baseline.json"
printf '%s\n' \
    '{' \
    '  "schema": 3,' \
    '  "profiles": {' \
    '    "test": {' \
    '      "main/logic/a.hpp": {"taken": 9, "outcomes": 10},' \
    '      "main/logic/b.hpp": {"taken": 3, "outcomes": 5}' \
    '    }' \
    '  }' \
    '}' >"$RAISED_BASELINE"
LOWERED_BASELINE="$TMP/lowered-branch-baseline.json"
printf '%s\n' \
    '{' \
    '  "schema": 3,' \
    '  "profiles": {' \
    '    "test": {' \
    '      "main/logic/a.hpp": {"taken": 7, "outcomes": 10},' \
    '      "main/logic/b.hpp": {"taken": 3, "outcomes": 5}' \
    '    }' \
    '  }' \
    '}' >"$LOWERED_BASELINE"
pass=0
fail=0

check_status() {
    local name="$1" expected="$2" actual="$3"
    if [ "$actual" -eq "$expected" ]; then
        pass=$((pass + 1))
    else
        echo "FAIL: $name (expected $expected, got $actual)" >&2
        fail=$((fail + 1))
    fi
}

set +e
profile="$(coverage_branch_profile gcc 13 false '' '')"
[ "$profile" = gcc-13 ]
check_status "a local compiler selects its family-major profile" 0 "$?"

profile="$(coverage_branch_profile gcc 13 true Linux ubuntu24)"
[ "$profile" = gcc-13-github-linux-ubuntu24 ]
check_status "a hosted runner selects its exact image profile" 0 "$?"

profile="$(coverage_branch_profile gcc 13 true Linux ubuntu26)"
[ "$profile" = gcc-13-github-linux-ubuntu26 ]
check_status "a new hosted image cannot fall back to the old runner profile" 0 "$?"

coverage_branch_profile gcc 13 true Linux '' >/dev/null 2>&1
check_status "a hosted runner without an image identity fails closed" 2 "$?"
set -e

run_report() {
    local minimum="$1"
    shift
    python3 "$CHECK" --minimum "$minimum" --source-dir "$TMP/main/logic" "$@" \
        >/dev/null 2>&1
}

set +e
printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" |
    run_report 95
check_status "aggregate coverage at the floor passes" 0 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:94.00% of 50" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:94.00% of 50" |
    run_report 95
check_status "coverage below the floor fails" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 100" |
    run_report 95
check_status "a wholly unreported production header fails" 1 "$?"

printf "%s\n" \
    "File 'test/test_logic.cpp'" \
    "Lines executed:100.00% of 1000" \
    "File 'main/def/generated.hpp'" \
    "Lines executed:100.00% of 1000" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:0.00% of 5" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:0.00% of 5" |
    run_report 95
check_status "tests and generated profiles cannot inflate logic coverage" 1 "$?"

printf "%s\n" \
    "File 'test/test_logic.cpp'" \
    "Lines executed:100.00% of 1000" |
    run_report 95
check_status "an empty logic report fails closed" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Branches executed:100.00% of 10" \
    "Taken at least once:80.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Branches executed:100.00% of 5" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "exact per-file branch outcome counts pass" 0 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.00% of 15" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "the same rounded percentage with a changed outcome count fails" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.01% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "a rounded percentage that cannot represent integer outcomes fails" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:70.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "one newly uncovered branch outcome fails the per-file ratchet" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:90.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "an improvement fails until its versioned baseline is raised" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:90.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$RAISED_BASELINE" --branch-profile test \
        --branch-baseline-reference "$BASELINE"
check_status "an improvement passes once the versioned baseline is raised" 0 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:70.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$LOWERED_BASELINE" --branch-profile test \
        --branch-baseline-reference "$BASELINE"
check_status "lowering the versioned baseline with the regression still fails" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" \
    "File 'main/logic/new_parser.hpp'" \
    "Lines executed:100.00% of 1" \
    "Taken at least once:100.00% of 2" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "a new branch-bearing header without a reviewed floor fails" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "No branches" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile test
check_status "a baseline header missing compiler branch outcomes fails" 1 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$TMP/missing.json" --branch-profile test
check_status "an unreadable branch baseline fails closed" 2 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE" --branch-profile unknown
check_status "an unknown compiler profile fails closed" 2 "$?"

printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "Taken at least once:80.00% of 10" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" \
    "Taken at least once:60.00% of 5" |
    run_report 95 --branch-baseline "$BASELINE"
check_status "a missing compiler profile fails closed" 2 "$?"

mkdir -p "$TMP/main/logic/nested"
touch "$TMP/main/logic/nested/parser.hpp"
printf "%s\n" \
    "File 'main/logic/a.hpp'" \
    "Lines executed:100.00% of 96" \
    "File 'main/logic/b.hpp'" \
    "Lines executed:75.00% of 4" |
    run_report 95
check_status "a wholly unreported nested logic header fails" 1 "$?"
set -e

if [ "$fail" -ne 0 ]; then
    echo "coverage selftest: $fail of $((pass + fail)) checks FAILED" >&2
    exit 1
fi
echo "coverage selftest: all $pass checks passed"
