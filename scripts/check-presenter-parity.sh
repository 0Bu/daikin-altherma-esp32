#!/usr/bin/env bash
# Verify the browser's copies of three presenter rules against the C++ headers they mirror:
#
#   main/www/js/schematic.js          main/logic/…
#   ─────────────────────────────     ────────────────────────────────────────────────
#   lwtIsPreBuh / lwtIsMeasurement    lwt_select.hpp  lwt_is_pre_buh / lwt_is_measurement
#   rwtIsR4t / rwtIsMeasurement       rwt_select.hpp  rwt_is_r4t / rwt_is_measurement
#   isPostBuhRow / postBuhRow         cop_scope.hpp   cop_is_post_buh / cop_post_buh_select
#   copPlan                           cop_scope.hpp   cop_plan
#   OU_HELD_PAGES                     ou_stale.hpp    ou_page_holds_over
#
# Compile a tiny host dumper against the REAL headers and the REAL def/ catalog, emit golden decision
# vectors, and have the REAL production JavaScript re-decide the identical inputs and diff.
#
# It exists because each of those headers says, in its own comments, that it has no firmware caller:
# it is there so CI can gate a rule the browser applies. That gates the C++ copy and says nothing
# about the JavaScript one — the copy that actually ships. docs/FEATURES.md documents what that costs,
# and it has been paid once: a looser leaving-water pattern matched the bizone kit's MIXED row,
# putting a correct number on the wrong sensor in ΔT, heat output and COP at once.
#
# Needs a C++17 compiler + node — both present in CI's `mechanical_gates` job. Run directly, or automatically at
# the end of scripts/run-mock-tests.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT=build_mock          # matches .gitignore (/build_mock/)
mkdir -p "$OUT"

golden_tsv=""
if [ "${1:-}" = "--golden" ]; then
    [ "$#" -ge 2 ] || { echo "check-presenter-parity: --golden requires a path" >&2; exit 2; }
    golden_tsv="$2"
    shift 2
fi

if [ -n "$golden_tsv" ]; then
    [ -f "$golden_tsv" ] || { echo "check-presenter-parity: golden file not found: $golden_tsv" >&2; exit 2; }
    command -v node >/dev/null 2>&1 || { echo "check-presenter-parity: need node" >&2; exit 1; }
    node tools/presenter/presenter_parity.mjs "$golden_tsv"
    exit 0
fi

CXX="${CXX:-}"
if [ -z "$CXX" ]; then
    if   command -v g++     >/dev/null 2>&1; then CXX=g++
    elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
    else echo "check-presenter-parity: need a C++17 compiler (g++/clang++)" >&2; exit 1
    fi
fi
command -v node >/dev/null 2>&1 || {
    echo "check-presenter-parity: need node" >&2; exit 1
}

need_compile=false
if [ ! -x "$OUT/presenter_golden_dump" ]; then
    need_compile=true
elif [ -n "$(find test/presenter_golden_dump.cpp main/logic main/def -type f -newer "$OUT/presenter_golden_dump" 2>/dev/null)" ]; then
    need_compile=true
fi

if [ "$need_compile" = true ]; then
    "$CXX" -std=c++17 -Wall -Wextra -Werror -Imain \
        -o "$OUT/presenter_golden_dump" test/presenter_golden_dump.cpp
    "$OUT/presenter_golden_dump" > "$OUT/presenter_golden.tsv"
elif [ ! -f "$OUT/presenter_golden.tsv" ]; then
    "$OUT/presenter_golden_dump" > "$OUT/presenter_golden.tsv"
fi

node tools/presenter/presenter_parity.mjs "$OUT/presenter_golden.tsv"
