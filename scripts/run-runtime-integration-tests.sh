#!/usr/bin/env bash
# Execute the deterministic fake-IDF runtime/transport integration suite, then mutate each critical
# invariant. The named assertion must turn red; otherwise this runner is not proving the behavior it
# claims to gate.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -ne 0 ]; then
    echo "run-runtime-integration-tests: no arguments expected" >&2
    exit 2
fi

RUNTIME_TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/daikin-runtime-tests.XXXXXX")"
trap 'rm -rf "$RUNTIME_TEST_TMP"' EXIT

if command -v cmake >/dev/null 2>&1; then
    cmake -S test/runtime -B "$RUNTIME_TEST_TMP/build" -DCMAKE_BUILD_TYPE=Debug >/dev/null
    cmake --build "$RUNTIME_TEST_TMP/build" --parallel
    ctest --test-dir "$RUNTIME_TEST_TMP/build" --output-on-failure
    RUNTIME_TEST_BIN="$RUNTIME_TEST_TMP/build/runtime_integration_tests"
else
    CXX="${CXX:-}"
    if [ -z "$CXX" ]; then
        if command -v g++ >/dev/null 2>&1; then CXX=g++
        elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
        else
            echo "run-runtime-integration-tests: need cmake or a C++17 compiler" >&2
            exit 1
        fi
    fi
    RUNTIME_TEST_BIN="$RUNTIME_TEST_TMP/runtime_integration_tests"
    "$CXX" -std=c++17 -Wall -Wextra -Werror -pthread -Imain -Itest/runtime \
        -o "$RUNTIME_TEST_BIN" test/runtime/runtime_integration_tests.cpp
    "$RUNTIME_TEST_BIN"
fi

assert_mutation_detected() {
    local flag="$1"
    local expected_failure="$2"
    local label="$3"
    local mutation_output
    local mutation_rc
    set +e
    mutation_output="$($RUNTIME_TEST_BIN "$flag" 2>&1)"
    mutation_rc=$?
    set -e
    if [ "$mutation_rc" -eq 0 ]; then
        echo "run-runtime-integration-tests: $label mutation unexpectedly passed" >&2
        exit 1
    fi
    if ! grep -Fq "FAIL  $expected_failure" <<<"$mutation_output"; then
        echo "run-runtime-integration-tests: $label mutation failed outside its expected assertion" >&2
        printf '%s\n' "$mutation_output" >&2
        exit 1
    fi
    echo "runtime integration selftest: $label mutation detected"
}

assert_mutation_detected \
    --mutate-nvs-atomicity \
    "nvs atomic save, reboot and failures" \
    "NVS atomicity"
assert_mutation_detected \
    --mutate-http-header-deadline \
    "HTTP absolute deadline stops trickling headers" \
    "HTTP slow-header deadline"
assert_mutation_detected \
    --mutate-http-body-deadline \
    "HTTP absolute deadline stops trickling body" \
    "HTTP slow-body deadline"
assert_mutation_detected \
    --mutate-weather-body-completion \
    "Weather rejects incomplete HTTP body" \
    "Weather incomplete-body rejection"
