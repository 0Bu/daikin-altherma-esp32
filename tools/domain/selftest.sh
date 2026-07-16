#!/usr/bin/env bash
# Self-test for the domain audit: does the gate still catch the bugs it was BUILT to catch?
#
# A checker that has quietly stopped checking is worse than no checker — it converts "the audit is
# clean" from evidence into a lie, and this gate exists precisely because plausible-but-wrong
# passes unnoticed. So the four decode defects that actually shipped on main (issues #35-#38) are
# re-introduced here, one at a time, into a THROWAWAY COPY of the catalog. Each must be caught.
# The working tree is never touched.
#
# This is the audit's own regression test — the same argument test/test_logic.cpp makes for the
# converters, applied to the checker itself. Run it whenever a check in catalog_audit.cpp changes:
# a refinement that silences noise must not also silence one of these.
#
# Usage: tools/domain/selftest.sh     Exit: 0 = all caught, 1 = a case was missed.
set -uo pipefail
cd "$(dirname "$0")/../.."

CXX="${CXX:-}"
if [ -z "$CXX" ]; then
    if command -v g++ >/dev/null 2>&1; then CXX=g++
    elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
    else echo "selftest: need a C++17 compiler (g++/clang++)" >&2; exit 2
    fi
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R main "$WORK/main"

pass=0 fail=0

# run_case <name> <file> <expect-code> <expect-needle> <python-patch>
# Patches one file in the copy, rebuilds the audit against it, and asserts the audit both fails
# (exit 1) and names the expected finding.
run_case() {
    local name="$1" file="$2" code="$3" needle="$4" patch="$5"
    cp "main/def/$file" "$WORK/main/def/$file"                     # reset to the fixed original
    if ! FILE="$WORK/main/def/$file" python3 -c "$patch"; then
        echo "  MISCONFIGURED: $name — patch did not apply (did the row change upstream?)"
        fail=$((fail + 1)); return
    fi
    if ! "$CXX" -std=c++17 -I"$WORK/main" -o "$WORK/audit" tools/domain/catalog_audit.cpp 2>"$WORK/cc.log"; then
        echo "  MISCONFIGURED: $name — audit failed to compile against the patched catalog"
        sed -n '1,5p' "$WORK/cc.log"
        fail=$((fail + 1)); return
    fi
    local out rc
    out="$("$WORK/audit" docs/REGISTERS.md tools/domain/audit_exceptions.txt 2>&1)"; rc=$?
    cp "main/def/$file" "$WORK/main/def/$file"                     # restore for the next case

    if [ "$rc" -eq 0 ]; then
        echo "  MISSED: $name — audit reported CLEAN on the re-introduced bug"
        fail=$((fail + 1)); return
    fi
    if ! printf '%s' "$out" | grep -q "$code"; then
        echo "  MISSED: $name — audit flagged something, but no $code finding"
        fail=$((fail + 1)); return
    fi
    if ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — $code fired but not on \"$needle\""
        fail=$((fail + 1)); return
    fi
    echo "  caught: $name  [$code]"
    pass=$((pass + 1))
}

echo "domain-audit selftest — re-introducing the four shipped decode bugs"

# #35 — "Mixed water temp." decoded signed-LE x0.1 (conv 105) instead of signed-BE x0.01 (118).
#       Shipped in 8 profiles; published -971.5 °C for a real 35.46 °C.
run_case "#35 mixed-water conv 105 (was 118)" "altherma_lt_da_04_08kw.hpp" \
    "SPEC-CONV" "Mixed water temp." '
import os
p=os.environ["FILE"]; s=open(p).read()
old="{0x64, 10, 118, 2, 1, \"Mixed water temp.\"}"
assert old in s, "row not found"
open(p,"w").write(s.replace(old,"{0x64, 10, 105, 2, 1, \"Mixed water temp.\"}"))
'

# #36 — bizone mix-valve POSITION read as a 2-byte unsigned BE and typed °C, so Home Assistant
#       got a phantom temperature sensor reading 12800 °C for a real 50 % valve position.
run_case "#36 M1S valve as °C temperature" "altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw.hpp" \
    "SEMANTICS" "valve position M1S" '
import os
p=os.environ["FILE"]; s=open(p).read()
old="{0x65, 0, 101, 1, -1, \"[EKMIK] Bizone kit mix valve position M1S\"}"
assert old in s, "row not found"
open(p,"w").write(s.replace(old,"{0x65, 0, 152, 2, 1, \"[EKMIK] Bizone kit mix valve position M1S\"}"))
'

# #37 — expansion-valve row widened to size 2 at offset 2, swallowing the Fan 2 byte: Fan 2 lost,
#       valve count fabricated from two unrelated bytes (11267 pls for a real 300).
run_case "#37 expansion valve swallows Fan 2" "altherma_lt_11_16kw_hydrosplit_hydro_unit.hpp" \
    "SPEC-LAYOUT" "Expansion valve (pls)" '
import os
p=os.environ["FILE"]; s=open(p).read()
old="""    {0x30, 2, 211, 1, -1, "Fan 2 (step)"},
    {0x30, 3, 151, 2, -1, "Expansion valve 1 (pls)"},  // default_on"""
assert old in s, "rows not found"
open(p,"w").write(s.replace(old,"""    {0x30, 2, 151, 2, -1, "Expansion valve (pls)"},  // default_on"""))
'

# #38 — target temps on conv 105 instead of 114: identical math, but 114 treats raw 0x8000 as
#       "no data". On 105 an idle unit publishes -3276.8 °C as a real reading.
run_case "#38 target temp ignores no-data sentinel" "altherma_lt_da_04_08kw.hpp" \
    "SPEC-CONV" "Target Evap. Temp." '
import os
p=os.environ["FILE"]; s=open(p).read()
old="{0x10, 6, 114, 2, 1, \"Target Evap. Temp.\"}"
assert old in s, "row not found"
open(p,"w").write(s.replace(old,"{0x10, 6, 105, 2, 1, \"Target Evap. Temp.\"}"))
'

echo
if [ "$fail" -ne 0 ]; then
    echo "selftest FAILED: $pass caught, $fail missed — the gate has lost teeth it used to have."
    exit 1
fi
echo "selftest ok: $pass/$pass re-introduced bugs caught."
