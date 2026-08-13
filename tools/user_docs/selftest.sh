#!/usr/bin/env bash
# Self-test for the user-documentation gate. Each case changes a throwaway copy only and proves the
# checker catches the maintenance failures it exists for.
set -uo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null 2>&1 || { echo "selftest: need node (>=18)" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "selftest: need python3" >&2; exit 2; }

CHECK="$PWD/tools/user_docs/check_user_docs.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0 fail=0 seed_ok=1

reset() {
    seed_ok=1
    rm -rf "$WORK/main" "$WORK/docs"
    mkdir -p "$WORK/main/logic" "$WORK/docs"
    cp -R main/www "$WORK/main/www"
    cp main/logic/checkup.hpp "$WORK/main/logic/checkup.hpp"
    cp main/checkup.cpp "$WORK/main/checkup.cpp"
    cp docs/DIAGNOSTICS.md "$WORK/docs/DIAGNOSTICS.md"
    cp docs/DIAGNOSTIC_EVIDENCE.md "$WORK/docs/DIAGNOSTIC_EVIDENCE.md"
}

patch_file() {
    if python3 - "$1"; then seed_ok=1
    else seed_ok=0; echo "  SEED FAILED: $1"; fi
}

run_case() {
    local name="$1" want_rc="$2" needle="$3" out rc
    if [ "$seed_ok" -ne 1 ]; then echo "  MISSED: $name — defect was not seeded"; fail=$((fail + 1)); return; fi
    out="$(node "$CHECK" --root "$WORK" --app main/www/app.sources --doc docs/DIAGNOSTICS.md --evidence docs/DIAGNOSTIC_EVIDENCE.md 2>&1)"; rc=$?
    if [ "$rc" -ne "$want_rc" ] || ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — expected exit $want_rc containing '$needle', got $rc"
        printf '%s\n' "$out" | sed -n '1,5p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    echo "  PASS  $name"
    pass=$((pass + 1))
}

echo "== 0. clean tree =="
reset
run_case "current user docs pass" 0 "user docs audit: clean"

echo "== 1. visible row without a supported next step =="
reset
patch_file "$WORK/main/www/js/history.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index('  health_cycling: {'); b = s.index('  health_defrost: {', a)
block = s[a:b]
if '          action:' not in block: sys.exit(1)
open(p, 'w').write(s[:a] + block.replace('          action:', '          missing_action:', 1) + s[b:])
PY
run_case "short localized action is caught" 1 "U003 health_cycling.de.action"

echo "== 2. visible row without a documentation section =="
reset
patch_file "$WORK/docs/DIAGNOSTICS.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '<!-- user-docs: health_pressure -->\n'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '', 1))
PY
run_case "missing result section is caught" 1 "U007 health_pressure"

echo "== 3. section that names a metric but gives no next step =="
reset
patch_file "$WORK/docs/DIAGNOSTICS.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index('<!-- user-docs: health_flow -->'); b = s.index('<!-- user-docs: health_heater -->', a)
block = s[a:b]
if '**What you can do:**' not in block: sys.exit(1)
open(p, 'w').write(s[:a] + block.replace('**What you can do:**', '**Technical note:**', 1) + s[b:])
PY
run_case "missing user action in the guide is caught" 1 "U008 health_flow"

echo "== 4. whole-plant reassurance from one bounded check =="
reset
patch_file "$WORK/main/www/js/history.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index('  health_guide: {'); b = s.index('  health_fault: {', a)
block = s[a:b]
start = block.index('          action: "')
end = block.index('" } },', start)
block = block[:start] + '          action: "Die Anlage ist in Ordnung. Weitere Prüfung ist nicht erforderlich.' + block[end:]
open(p, 'w').write(s[:a] + block + s[b:])
PY
run_case "false whole-plant reassurance is caught" 1 "U006 German whole-plant all-clear"

echo "== 5. diagnosis logic changed without a documentation review =="
reset
printf '\n// selftest: changed diagnostic meaning\n' >> "$WORK/main/logic/checkup.hpp"
run_case "stale source stamp is caught" 1 "U010 docs/DIAGNOSTICS.md"

echo "== 6. a new visible diagnosis without UI copy or docs =="
reset
patch_file "$WORK/main/www/js/dashboard.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = 'const CHECKUP_ROW = {'
if s.count(old) != 1: sys.exit(1)
open(p, 'w').write(s.replace(old, 'const CHECKUP_ROW = {\n  mystery:  "check.mystery",', 1))
PY
run_case "new undocumented result is caught" 1 "U001 health_mystery"

echo "== 7. reviewed source change can be deliberately re-stamped =="
reset
printf '\n// selftest: reviewed diagnostic change\n' >> "$WORK/main/logic/checkup.hpp"
out="$(node "$CHECK" --root "$WORK" --app main/www/app.sources --doc docs/DIAGNOSTICS.md --update 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -qF "updated source stamp"; then
    echo "  MISSED: reviewed source could not be re-stamped"
    printf '%s\n' "$out" | sed -n '1,5p' | sed 's/^/            /'
    fail=$((fail + 1))
else
    run_case "updated stamp passes normal validation" 0 "user docs audit: clean"
fi

echo "== 8. visible diagnosis without an evidence section =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); old = '### 5. Lowest water pressure (`pressure`)\n'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '### 5. Lowest water pressure (`missing_pressure`)\n', 1))
PY
run_case "missing evidence section is caught" 1 "U011 pressure"

echo "== 9. evidence section without an explicit claim boundary =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index('### 4. Defrost events (`defrost`)'); b = s.index('### 5. Lowest water pressure', a)
block = s[a:b]
if '**Not established:**' not in block: sys.exit(1)
open(p, 'w').write(s[:a] + block.replace('**Not established:**', '**Open question:**', 1) + s[b:])
PY
run_case "missing evidence claim boundary is caught" 1 "U012 defrost"

echo "== 10. cited source without a resolved primary-source URL =="
reset
patch_file "$WORK/docs/DIAGNOSTIC_EVIDENCE.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '[R2-doi]: https://doi.org/10.1016/j.applthermaleng.2009.01.003\n'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '', 1))
PY
run_case "unresolved evidence URL is caught" 1 "U013 R2"

echo "== 11. German prose in any maintained Markdown guide =="
reset
printf '\nDieser Abschnitt erklärt die Prüfung.\n' > "$WORK/docs/UNEXPECTED_GERMAN.md"
run_case "German documentation is caught" 1 "U014 docs/UNEXPECTED_GERMAN.md:2"

echo "== 12. German prose without umlauts =="
reset
printf '\nDiese Dokumentation ist nicht in englischer Sprache.\n' > "$WORK/docs/ASCII_GERMAN.md"
run_case "ASCII-only German documentation is caught" 1 "U014 docs/ASCII_GERMAN.md:2"

echo
if [ "$fail" -eq 0 ]; then
    echo "user docs audit selftest: all $pass cases caught"
else
    echo "user docs audit selftest: $fail of $((pass + fail)) cases MISSED" >&2
fi
[ "$fail" -eq 0 ]
