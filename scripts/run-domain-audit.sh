#!/usr/bin/env bash
# Domain-correctness audit of the value catalog — the mechanical half of the /domain-review
# merge gate. Compiles tools/domain/catalog_audit.cpp against the REAL catalog (main/def) and the
# REAL converters (main/logic/convert.hpp) and cross-checks both against docs/REGISTERS.md §5.
#
# Answers the question the other gates cannot: are the published values physically RIGHT?
# A wrong converter still compiles, still passes every host test, and publishes -971.5 °C to Home
# Assistant. See tools/domain/catalog_audit.cpp for the checks and the reasoning behind each.
#
# Usage: scripts/run-domain-audit.sh
# Exit:  0 = clean, 1 = findings (each printed with a decode witness), 2 = usage/parse error.
# Requires only a C++17 host compiler — no ESP-IDF, no Docker, no board, like run-mock-tests.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR=build_mock   # matches .gitignore (/build_mock/)
mkdir -p "$BUILD_DIR"

CXX="${CXX:-}"
if [ -z "$CXX" ]; then
    if command -v g++ >/dev/null 2>&1; then CXX=g++
    elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
    else echo "run-domain-audit: need a C++17 compiler (g++/clang++)" >&2; exit 2
    fi
fi

"$CXX" -std=c++17 -Wall -Wextra -Werror -Imain -o "$BUILD_DIR/catalog_audit" \
    tools/domain/catalog_audit.cpp

"$BUILD_DIR/catalog_audit" docs/REGISTERS.md tools/domain/audit_exceptions.txt
