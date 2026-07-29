#!/usr/bin/env bash
# Doc entity-id audit — does every Home Assistant entity id the docs quote actually exist?
#
# The docs hand the reader copy-pasteable YAML naming ids like
# `sensor.daikin_altherma_inlet_water_temp_r4t`. Each is derived from a catalog LABEL, so it is only
# as stable as that label — and the catalog spells the same quantity several ways across models.
#
# A wrong id does not error anywhere. Home Assistant creates the template sensor, its `availability`
# guard never becomes true, and it sits at `unavailable` — which reads as "my heat pump doesn't
# support this" rather than as a typo in the documentation. Nothing else here can see that: the
# firmware is correct, every value is true, and the doc is well-formed prose.
#
# Compiles tools/docs/entity_id_audit.cpp against the REAL catalog (main/def) and the REAL slug rule
# (main/logic/ha_device.hpp ha_slug), so there is no second copy of the id rule to drift.
#
# Usage: scripts/run-doc-entity-audit.sh
# Exit:  0 = clean, 1 = findings, 2 = usage/compile error.
# Requires only a C++17 host compiler — no ESP-IDF, no Docker, no board, like run-mock-tests.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR=build_mock   # matches .gitignore (/build_mock/)
mkdir -p "$BUILD_DIR"

CXX="${CXX:-}"
if [ -z "$CXX" ]; then
    if command -v g++ >/dev/null 2>&1; then CXX=g++
    elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
    else echo "run-doc-entity-audit: need a C++17 compiler (g++/clang++)" >&2; exit 2
    fi
fi

"$CXX" -std=c++17 -Wall -Wextra -Werror -Imain -o "$BUILD_DIR/entity_id_audit" \
    tools/docs/entity_id_audit.cpp

# The device-name prefix HA derives an entity_id from: the slugified device name. Kept here rather
# than in the tool so the tool stays a general "resolve these ids" checker.
PREFIX="${DOC_ENTITY_PREFIX:-daikin_altherma}"

# Every doc that can carry a copy-pasteable recipe. Not a glob: a new doc should be added
# deliberately, and a doc that quotes no ids costs nothing to scan.
"$BUILD_DIR/entity_id_audit" "$PREFIX" \
    docs/HOME_ASSISTANT.md \
    docs/README.md \
    docs/ARCHITECTURE.md \
    docs/FEATURES.md \
    docs/REPORTING.md \
    README.md
