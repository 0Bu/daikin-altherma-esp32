#!/usr/bin/env bash
# Fast, deterministic hostile-input properties under ASan+UBSan. No network, IDF, Docker or board.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR=build_mock/sanitizer_fuzz
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

CXX="${CXX:-}"
if [ -z "$CXX" ]; then
    if command -v clang++ >/dev/null 2>&1; then CXX=clang++
    elif command -v g++ >/dev/null 2>&1; then CXX=g++
    else echo "sanitizer-fuzz: need a C++17 compiler (clang++/g++)" >&2; exit 1
    fi
fi

SANITIZERS=address,undefined
ASAN_OPTIONS_VALUE=abort_on_error=1:detect_leaks=1:strict_string_checks=1
compile_properties() {
    "$CXX" -std=c++17 -O1 -g -Wall -Wextra -Werror -fno-omit-frame-pointer \
        -fsanitize="$1" -Imain \
        -o "$BUILD_DIR/logic_property_tests" tools/fuzz/logic_property_tests.cpp
}

# Probe the runtime, not the OS or compiler name: a Homebrew GCC on Darwin may have working ASan,
# while a broken runtime can exist elsewhere. The child is killed after two seconds, before a
# pre-main runtime hang can turn a fast gate into an unbounded one.
asan_ready=false
if compile_properties "$SANITIZERS" &&
   ASAN_OPTIONS="$ASAN_OPTIONS_VALUE" LSAN_OPTIONS=exitcode=23 \
       UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
       python3 -c '
import os
import subprocess
import sys
try:
    result = subprocess.run(
        [sys.argv[1], "sanitizer-smoke"],
        env=os.environ.copy(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=2,
        check=False,
    )
except subprocess.TimeoutExpired:
    raise SystemExit(1)
raise SystemExit(0 if result.returncode == 0 else 1)
' "$BUILD_DIR/logic_property_tests"; then
    asan_ready=true
fi

if [ "$asan_ready" != true ]; then
    if [ -n "${CI:-}" ]; then
        echo "sanitizer-fuzz: CI requires a working ASan+UBSan compile and runtime" >&2
        exit 1
    fi
    SANITIZERS=undefined
    ASAN_OPTIONS_VALUE=abort_on_error=1:detect_leaks=0:strict_string_checks=1
    echo "sanitizer-fuzz: ASan runtime unavailable; running UBSan locally (CI requires ASan+UBSan)"
    compile_properties "$SANITIZERS"
else
    echo "sanitizer-fuzz: ASan+UBSan runtime capability confirmed"
fi

ASAN_OPTIONS="$ASAN_OPTIONS_VALUE" \
LSAN_OPTIONS=exitcode=23 \
UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$BUILD_DIR/logic_property_tests" manifest modbus mqtt http

set +e
ASAN_OPTIONS="$ASAN_OPTIONS_VALUE" \
LSAN_OPTIONS=exitcode=23 \
UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$BUILD_DIR/logic_property_tests" manifest unknown >/dev/null 2>&1
selector_status=$?
set -e
if [ "$selector_status" -ne 2 ]; then
    echo "sanitizer-fuzz: unknown target selector did not fail closed (status $selector_status)" >&2
    exit 1
fi
