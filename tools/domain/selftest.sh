#!/usr/bin/env bash
# Self-test for the domain audit: does the gate still catch the bugs it was BUILT to catch?
#
# A checker that has quietly stopped checking is worse than no checker — it converts "the audit is
# clean" from evidence into a lie, and this gate exists precisely because plausible-but-wrong
# passes unnoticed. So every defect this gate was built to catch — the four decode bugs that actually
# shipped on main (issues #35-#38), the mislabelled fan step of #230, and enum-table drift — is
# re-introduced here, one at a time, into a THROWAWAY COPY. Each must be caught. The working tree is
# never touched.
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

# run_doc_case <name> <expect-code> <expect-needle> <python-patch> [attempted-exception-key]
# Mutates the copied register reference instead of a profile and proves the code↔docs enum contract.
run_doc_case() {
    local name="$1" code="$2" needle="$3" patch="$4" exception_key="${5:-}"
    local exceptions="tools/domain/audit_exceptions.txt"
    cp docs/REGISTERS.md "$WORK/REGISTERS.md"
    if ! FILE="$WORK/REGISTERS.md" python3 -c "$patch"; then
        echo "  MISCONFIGURED: $name — docs patch did not apply (did §4.1 change upstream?)"
        fail=$((fail + 1)); return
    fi
    if ! "$CXX" -std=c++17 -I"$WORK/main" -o "$WORK/audit" tools/domain/catalog_audit.cpp 2>"$WORK/cc.log"; then
        echo "  MISCONFIGURED: $name — audit failed to compile"
        sed -n '1,5p' "$WORK/cc.log"
        fail=$((fail + 1)); return
    fi
    if [ -n "$exception_key" ]; then
        cp tools/domain/audit_exceptions.txt "$WORK/audit_exceptions.txt"
        printf '\n%s\n' "$exception_key" >> "$WORK/audit_exceptions.txt"
        exceptions="$WORK/audit_exceptions.txt"
    fi
    local out rc
    out="$("$WORK/audit" "$WORK/REGISTERS.md" "$exceptions" 2>&1)"; rc=$?

    if [ "$rc" -eq 0 ]; then
        echo "  MISSED: $name — audit reported CLEAN on the re-introduced drift"
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

# run_logic_case <name> <file> <expect-code> <expect-needle> <python-patch>
# Re-introduces a converter-table defect while leaving the documented contract authoritative.
run_logic_case() {
    local name="$1" file="$2" code="$3" needle="$4" patch="$5"
    cp "main/logic/$file" "$WORK/main/logic/$file"
    if ! FILE="$WORK/main/logic/$file" python3 -c "$patch"; then
        echo "  MISCONFIGURED: $name — logic patch did not apply (did the table change upstream?)"
        fail=$((fail + 1)); return
    fi
    if ! "$CXX" -std=c++17 -I"$WORK/main" -o "$WORK/audit" tools/domain/catalog_audit.cpp 2>"$WORK/cc.log"; then
        echo "  MISCONFIGURED: $name — audit failed to compile against the patched converter"
        sed -n '1,5p' "$WORK/cc.log"
        fail=$((fail + 1)); return
    fi
    local out rc
    out="$("$WORK/audit" docs/REGISTERS.md tools/domain/audit_exceptions.txt 2>&1)"; rc=$?
    cp "main/logic/$file" "$WORK/main/logic/$file"

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

echo "domain-audit selftest — re-introducing the defects this gate was built to catch"

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

# #230 — a fan STEP spelled as a RATE. The row decodes correctly and sits at the documented offset
#        with the documented converter, so every other check is satisfied; what is false is the
#        UNIT inside the label, which ha_slug() turns into the published identifier. Seeded on
#        offset 2 (Fan 2) rather than the four live "Fan 1 (10 rpm)" rows, because those are on
#        record in audit_exceptions.txt and a self-test must not depend on a suppressed finding.
run_case "#230 fan step spelled as a rate" "altherma_ebla_edla_d_series_9_16kw_monobloc.hpp" \
    "LABEL-UNIT" "Fan 2 (rps)" '
import os
p=os.environ["FILE"]; s=open(p).read()
old="{0x30, 2, 211, 1, -1, \"Fan 2 (step)\"}"
assert old in s, "row not found"
open(p,"w").write(s.replace(old,"{0x30, 2, 211, 1, -1, \"Fan 2 (rps)\"}"))
'

# The visible conv-217 labels are a code↔evidence contract. A prose-only docs change must not silently
# disagree with what /values, WebSocket and MQTT publish.
run_doc_case "conv-217 label drifts from firmware" "ENUM-CONTRACT" "operation mode index 18" '
import os
p=os.environ["FILE"]; s=open(p).read()
old="| 18 | UseStrdThrm(ht)4 |"
assert old in s, "enum row not found"
open(p,"w").write(s.replace(old,"| 18 | Wrong label |"))
'

# Global code↔docs identity is not a model deviation. Even an attempted ledger entry must not turn
# an enum mismatch green.
run_doc_case "conv-217 drift cannot be suppressed" "ENUM-CONTRACT" "operation mode index 18" '
import os
p=os.environ["FILE"]; s=open(p).read()
old="| 18 | UseStrdThrm(ht)4 |"
assert old in s, "enum row not found"
open(p,"w").write(s.replace(old,"| 18 | Wrong label |"))
' "ENUM-CONTRACT:conv217:18"

# An entry beyond the catalog's 0..19 range must not silently become a new published mode. Seed an
# unsupported tail in the firmware table and require the contract to identify its exact index.
run_logic_case "conv-217 unsupported index 20 returns" "convert.hpp" \
    "ENUM-CONTRACT" "operation mode index 20" '
import os
p=os.environ["FILE"]; s=open(p).read()
old="\"UseStrdThrm(ht)3\", \"UseStrdThrm(ht)4\", \"Aux.\"};"
assert old in s, "OP_MODE tail not found"
open(p,"w").write(s.replace(old,"\"UseStrdThrm(ht)3\", \"UseStrdThrm(ht)4\", \"Aux.\", \"Unsupported\"};",1))
'

echo
if [ "$fail" -ne 0 ]; then
    echo "selftest FAILED: $pass caught, $fail missed — the gate has lost teeth it used to have."
    exit 1
fi
echo "selftest ok: $pass/$pass re-introduced bugs caught."
