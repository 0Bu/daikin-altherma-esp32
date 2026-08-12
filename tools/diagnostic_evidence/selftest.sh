#!/usr/bin/env bash
# Mutation self-test for the diagnostic-evidence gate. The production tree is never modified.
set -uo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null 2>&1 || { echo "selftest: need node (>=18)" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "selftest: need python3" >&2; exit 2; }

CHECK="$PWD/tools/diagnostic_evidence/check_diagnostic_evidence.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0 fail=0 seed_ok=1

reset() {
    seed_ok=1
    rm -rf "$WORK/main" "$WORK/docs"
    mkdir -p "$WORK/main/logic" "$WORK/main/def" "$WORK/docs"
    cp -R main/www "$WORK/main/www"
    cp main/checkup.hpp "$WORK/main/checkup.hpp"
    cp main/logic/checkup.hpp "$WORK/main/logic/checkup.hpp"
    cp main/logic/checkup_persist.hpp "$WORK/main/logic/checkup_persist.hpp"
    cp main/logic/fault_state.hpp "$WORK/main/logic/fault_state.hpp"
    cp main/checkup.cpp "$WORK/main/checkup.cpp"
    cp main/hp_poll.cpp "$WORK/main/hp_poll.cpp"
    cp main/http_status.cpp "$WORK/main/http_status.cpp"
    cp main/def/overlay.hpp "$WORK/main/def/overlay.hpp"
    cp docs/REGISTERS.md "$WORK/docs/REGISTERS.md"
    cp docs/DIAGNOSTIC_EVIDENCE.md "$WORK/docs/DIAGNOSTIC_EVIDENCE.md"
}

patch_file() {
    if python3 - "$1"; then seed_ok=1
    else seed_ok=0; echo "  SEED FAILED: $1"; fi
}

run_case() {
    local name="$1" want_rc="$2" needle="$3" out rc
    if [ "$seed_ok" -ne 1 ]; then echo "  MISSED: $name — defect was not seeded"; fail=$((fail + 1)); return; fi
    out="$(node "$CHECK" --root "$WORK" --app main/www/app.sources --evidence docs/DIAGNOSTIC_EVIDENCE.md 2>&1)"; rc=$?
    if [ "$rc" -ne "$want_rc" ] || ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — expected exit $want_rc containing '$needle', got $rc"
        printf '%s\n' "$out" | sed -n '1,6p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    echo "  PASS  $name"
    pass=$((pass + 1))
}

echo "== 0. clean reviewed contract =="
reset
run_case "current diagnostic evidence passes" 0 "diagnostic evidence audit: clean"

echo "== 1. visible diagnosis without an evidence section =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '### 5. Wasserdruck, niedrigster (`pressure`)\n'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '### 5. Wasserdruck, niedrigster (`missing_pressure`)\n', 1))
PY
run_case "missing evidence section is caught" 1 "E001 pressure"

echo "== 2. external basis removed =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '**Extern belegt:**'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '**Unbelegte Behauptung:**', 1))
PY
run_case "missing external basis is caught" 1 "E002 fault"

echo "== 3. firmware rule removed =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '**Firmware-Regel:**'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '**Unklare Regel:**', 1))
PY
run_case "missing firmware rule is caught" 1 "E003 fault"

echo "== 4. unsupported-claim boundary removed =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '**Nicht bewiesen:**'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '**Offene Frage:**', 1))
PY
run_case "missing claim boundary is caught" 1 "E004 fault"

echo "== 5. project threshold presented without a boundary =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index('### 4. Abtauvorgänge (`defrost`)'); b = s.index('### 5. Wasserdruck', a)
block = s[a:b]
if '**Projektanteil:**' not in block: sys.exit(1)
open(p, 'w').write(s[:a] + block.replace('**Projektanteil:**', '**Einordnung:**', 1) + s[b:])
PY
run_case "missing project boundary is caught" 1 "E005 defrost"

echo "== 6. external claim without a catalog source =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index('### 7. Zusatzheizer (`heater`)'); b = s.index('### 8. Schutz-Rückregelungen', a)
block = s[a:b]
if '[D1]' not in block: sys.exit(1)
open(p, 'w').write(s[:a] + block.replace('[D1]', '[unlinked source]') + s[b:])
PY
run_case "missing source id is caught" 1 "E006 heater"

echo "== 7. unresolved source URL =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '[R2-doi]: https://doi.org/10.1016/j.applthermaleng.2009.01.003\n'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '', 1))
PY
run_case "unresolved evidence URL is caught" 1 "E009 R2"

echo "== 8. manufacturer metadata weakened =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = 'Revision 2019-10'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, 'Revision unbekannt', 1))
PY
run_case "missing manufacturer revision is caught" 1 "E009 D1"

echo "== 9. implementation changed without evidence review =="
reset
printf '\n// selftest: changed diagnostic meaning\n' >> "$WORK/main/logic/checkup.hpp"
run_case "stale review fingerprint is caught" 1 "E010 docs/DIAGNOSTIC_EVIDENCE.md"

echo "== 10. changed register evidence without review =="
reset
printf '\n| selftest | Protection Retry Qty |\n' >> "$WORK/docs/REGISTERS.md"
run_case "changed project evidence is caught" 1 "E010 docs/DIAGNOSTIC_EVIDENCE.md"

echo "== 11. persistence changed without evidence review =="
reset
printf '\n// selftest: changed restore semantics\n' >> "$WORK/main/logic/checkup_persist.hpp"
run_case "changed persistence contract is caught" 1 "E010 docs/DIAGNOSTIC_EVIDENCE.md"

echo "== 12. published evidence fields changed without review =="
reset
patch_file "$WORK/main/http_status.cpp" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '        j += ",\\\"full_span\\\":";\n'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '        j += ",\\\"full_window\\\":";\n', 1))
PY
run_case "changed status evidence contract is caught" 1 "E010 docs/DIAGNOSTIC_EVIDENCE.md"

echo "== 13. reviewed implementation can be deliberately re-stamped =="
reset
printf '\n// selftest: reviewed diagnostic change\n' >> "$WORK/main/logic/checkup.hpp"
out="$(node "$CHECK" --root "$WORK" --app main/www/app.sources --evidence docs/DIAGNOSTIC_EVIDENCE.md --update 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -qF "updated review fingerprint"; then
    echo "  MISSED: reviewed evidence could not be re-stamped"
    printf '%s\n' "$out" | sed -n '1,6p' | sed 's/^/            /'
    fail=$((fail + 1))
else
    run_case "updated review fingerprint passes" 0 "diagnostic evidence audit: clean"
fi

echo
if [ "$fail" -eq 0 ]; then
    echo "diagnostic evidence audit selftest: all $pass cases caught"
else
    echo "diagnostic evidence audit selftest: $fail of $((pass + fail)) cases MISSED" >&2
fi
[ "$fail" -eq 0 ]
