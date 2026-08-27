#!/usr/bin/env bash
# Host-side mock build: compile and run the IDF-free pure-logic tests (test/) with the system
# toolchain — no ESP-IDF, no Docker, no board. Catches decode/config/discovery regressions in
# seconds, in any environment (local terminal, CI, or agent sandbox). This is the fast hardware-free
# "run it and see" loop even when a session has neither Docker nor USB access.
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
        COMPILER_RELEASE="$(printf '%s\n' "$COMPILER_VERSION" |
            sed -nE 's/.*clang version ([0-9]+([.][0-9]+){1,2}).*/\1/p' | head -n 1)"
        [ -n "$COMPILER_RELEASE" ] || {
            echo "run-mock-tests: cannot identify clang release" >&2
            exit 1
        }
        COMPILER_MAJOR="${COMPILER_RELEASE%%.*}"
        BRANCH_FAMILY=clang
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
        COMPILER_RELEASE="$("$CXX" -dumpfullversion -dumpversion 2>/dev/null)"
        [ -n "$COMPILER_RELEASE" ] || {
            echo "run-mock-tests: cannot identify GCC release" >&2
            exit 1
        }
        COMPILER_MAJOR="${COMPILER_RELEASE%%.*}"
        BRANCH_FAMILY=gcc
        GCOV_REPORT="$(gcov -n -b -c "$GCDA" 2>&1)"
    else
        echo "run-mock-tests: GCC coverage needs gcov" >&2
        exit 1
    fi

    # A GitHub-hosted runner and the pinned ESP-IDF container can carry the same upstream GCC
    # family/major while producing different gcov edge inventories. Bind authoritative CI to its
    # runner image as well; an unreviewed image name deliberately selects a missing profile and
    # fails closed instead of silently borrowing a superficially compatible local baseline.
    # shellcheck source=/dev/null
    . tools/coverage/profile.sh
    if ! BRANCH_PROFILE="$(coverage_branch_profile "$BRANCH_FAMILY" "$COMPILER_MAJOR" \
        "${GITHUB_ACTIONS:-false}" "${RUNNER_OS:-}" "${ImageOS:-}")"; then
        echo "run-mock-tests: cannot identify the coverage execution profile" >&2
        exit 1
    fi

    # Bind profile changes to repository history as well as to the report. HEAD catches a dirty
    # local baseline edit; HEAD^1 is the protected base in GitHub's merge checkout (and the previous
    # commit on a push). The first revision introducing the baseline legitimately has no reference.
    COVERAGE_CHECK_ARGS=(
        --minimum 95
        --source-dir main/logic
        --exclude value_def.hpp
        --branch-baseline tools/coverage/branch_baseline.json
        --branch-profile "$BRANCH_PROFILE"
    )
    reference_index=0
    for reference_revision in HEAD 'HEAD^1'; do
        reference_file="$COVERAGE_DIR/branch-baseline-reference-$reference_index.json"
        if git show "$reference_revision:tools/coverage/branch_baseline.json" \
            >"$reference_file" 2>/dev/null; then
            COVERAGE_CHECK_ARGS+=(--branch-baseline-reference "$reference_file")
            reference_index=$((reference_index + 1))
        fi
    done

    # value_def.hpp declares the row struct and has no executable line. Every other logic header
    # must appear in gcov's inventory; otherwise a new, wholly untested header could be invisible
    # while the aggregate percentage stayed green.
    printf '%s\n' "$GCOV_REPORT" |
        python3 tools/coverage/check_gcov_report.py "${COVERAGE_CHECK_ARGS[@]}"
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

# Browser-side Web Serial permission lifecycle and the real sparse-flash plan. Both modules are
# published next to the installer, but their decisions are deterministic enough to gate without a
# browser or board; a hardware flash remains the separate integration boundary.
node --test test/serial_port_release.test.mjs test/web_installer.test.mjs
