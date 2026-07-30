#!/usr/bin/env bash
# Mutation-style checks for the line-coverage parser: a green gate must have input and teeth.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHECK=tools/coverage/check_gcov_report.py
TMP="$(mktemp -d "${TMPDIR:-/tmp}/daikin-coverage-selftest.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/main/logic"
touch "$TMP/main/logic/a.hpp" "$TMP/main/logic/b.hpp"
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

run_report() {
    local minimum="$1"
    python3 "$CHECK" --minimum "$minimum" --source-dir "$TMP/main/logic" >/dev/null 2>&1
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
set -e

if [ "$fail" -ne 0 ]; then
    echo "coverage selftest: $fail of $((pass + fail)) checks FAILED" >&2
    exit 1
fi
echo "coverage selftest: all $pass checks passed"
