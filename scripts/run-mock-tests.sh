#!/usr/bin/env bash
# Host-side mock build: compile and run the IDF-free pure-logic tests (test/) with the system
# toolchain — no ESP-IDF, no Docker, no board. Catches decode/config/discovery regressions in
# seconds, in any environment (local terminal, CI, Claude Code web session). This is the real
# "run it and see" loop a cloud session has (it cannot build firmware or USB-flash).
#
# Usage: scripts/run-mock-tests.sh [--coverage]
# Requires a C++17 host compiler (g++/clang++); cmake is used when present, with a direct-
# compiler fallback otherwise (the suite is one translation unit — see test/CMakeLists.txt).
# Coverage mode always uses that direct compile so GCC/gcov and Clang/llvm-cov see the exact same
# translation unit and the result can gate the aggregate executable lines under main/logic/.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR=build_mock   # matches .gitignore (/build_mock/)
COVERAGE=false

for arg in "$@"; do
    case "$arg" in
        --coverage|-c) COVERAGE=true ;;
        *) echo "run-mock-tests: unknown argument '$arg' (expected --coverage)" >&2; exit 2 ;;
    esac
done

CXX="${CXX:-}"
if { [ "$COVERAGE" = true ] || ! command -v cmake >/dev/null 2>&1; } && [ -z "$CXX" ]; then
    if command -v g++ >/dev/null 2>&1; then CXX=g++
    elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
    else echo "run-mock-tests: need a C++17 compiler (g++/clang++)" >&2; exit 1
    fi
fi

if [ "$COVERAGE" = true ]; then
    COVERAGE_DIR="$BUILD_DIR/coverage"
    rm -rf "$COVERAGE_DIR"
    mkdir -p "$COVERAGE_DIR"

    "$CXX" -std=c++17 -Wall -Wextra -Werror --coverage -Imain \
        -o "$COVERAGE_DIR/logic_tests" test/test_logic.cpp
    "$COVERAGE_DIR/logic_tests"

    GCDA="$(find "$COVERAGE_DIR" -name '*.gcda' -print -quit)"
    [ -n "$GCDA" ] || {
        echo "run-mock-tests: compiler produced no coverage data" >&2
        exit 1
    }

    COMPILER_VERSION="$("$CXX" --version 2>/dev/null || true)"
    if printf '%s' "$COMPILER_VERSION" | grep -qi clang; then
        if command -v xcrun >/dev/null 2>&1 &&
           xcrun --find llvm-cov >/dev/null 2>&1; then
            GCOV_REPORT="$(xcrun llvm-cov gcov -n -b -c "$GCDA" 2>&1)"
        elif command -v llvm-cov >/dev/null 2>&1; then
            GCOV_REPORT="$(llvm-cov gcov -n -b -c "$GCDA" 2>&1)"
        else
            echo "run-mock-tests: clang coverage needs llvm-cov" >&2
            exit 1
        fi
    elif command -v gcov >/dev/null 2>&1; then
        GCOV_REPORT="$(gcov -n -b -c "$GCDA" 2>&1)"
    else
        echo "run-mock-tests: GCC coverage needs gcov" >&2
        exit 1
    fi

    # value_def.hpp declares the row struct and has no executable line. Every other logic header
    # must appear in gcov's inventory; otherwise a new, wholly untested header could be invisible
    # while the aggregate percentage stayed green.
    printf '%s\n' "$GCOV_REPORT" |
        python3 tools/coverage/check_gcov_report.py \
            --minimum 95 --source-dir main/logic --exclude value_def.hpp
elif command -v cmake >/dev/null 2>&1; then
    cmake -S test -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Debug >/dev/null
    cmake --build "$BUILD_DIR" --parallel
    ctest --test-dir "$BUILD_DIR" --output-on-failure
else
    mkdir -p "$BUILD_DIR"
    "$CXX" -std=c++17 -Wall -Wextra -Werror -Imain -o "$BUILD_DIR/logic_tests" test/test_logic.cpp
    "$BUILD_DIR/logic_tests"
fi

# The host suite gates the C++ copy of the leaving-water / post-BUH / COP-scope / held-over-page
# rules. Those four headers each say they have no firmware caller — they exist to gate a rule the
# BROWSER applies — so gating only the C++ leaves the copy that actually ships unchecked. Run here
# rather than as a step of its own because this is where a C++ compiler is already guaranteed, and
# because a rule change and its parity failure belong in the same command.
"$(dirname "$0")/check-presenter-parity.sh"
