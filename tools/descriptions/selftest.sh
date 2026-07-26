#!/usr/bin/env bash
# Self-test for the value-description audit: does the gate still catch what it was BUILT to catch?
#
# The failure this gate prevents is invisible by construction — a value row that simply isn't
# tappable — so nobody will notice if the checker quietly stops checking. Every case below
# re-introduces a real defect into a THROWAWAY COPY of the tree and asserts the audit fails on it
# with the right finding code. The working tree is never touched.
#
# Case 2 is the specific regression that motivated the gate: the page-0x10 protection rows shipped
# with no explainer, so removing that copy again must go red.
#
# Usage: tools/descriptions/selftest.sh     Exit: 0 = all caught, 1 = a case was missed.
# No `set -e`: a missed case must be counted and reported, not abort the suite.
set -uo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null 2>&1 || { echo "selftest: need node (>=18)" >&2; exit 2; }

CHECK="$PWD/tools/descriptions/check_descriptions.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0 fail=0

reset() {   # a pristine copy of everything the audit reads
    rm -rf "$WORK/main" "$WORK/exc.txt"
    mkdir -p "$WORK/main"
    cp -R main/www "$WORK/main/www"
    cp -R main/def "$WORK/main/def"
    cp tools/descriptions/audit_exceptions.txt "$WORK/exc.txt"
}

# run_case <name> <expect-rc> <expect-needle>
# Runs the audit over the patched copy; asserts the exit code and that the report names the finding.
run_case() {
    local name="$1" want_rc="$2" needle="$3" out rc
    out="$(node "$CHECK" --app "$WORK/main/www/app.js" --def "$WORK/main/def" \
                         --exceptions "$WORK/exc.txt" 2>&1)"; rc=$?
    if [ "$rc" -ne "$want_rc" ]; then
        echo "  MISSED: $name — expected exit $want_rc, got $rc"
        printf '%s\n' "$out" | sed -n '1,3p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    if ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — exit $rc was right, but the report never says \"$needle\""
        printf '%s\n' "$out" | sed -n '1,3p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    echo "  PASS  $name"
    pass=$((pass + 1))
}

echo "== 0. the unpatched tree is clean (otherwise every case below proves nothing) =="
reset
run_case "clean tree passes" 0 "clean"

echo "== 1. a NEW catalog label nobody wrote copy for =="
# The generator emitting one new row is the routine way this gap re-opens.
reset
python3 - "$WORK/main/def/altherma3_r_erga.hpp" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = s.replace('    {0x10,  0, 217, 1, -1, "Operation Mode"},',
              '    {0x10,  0, 217, 1, -1, "Operation Mode"},\n'
              '    {0x10,  3, 152, 1, -1, "Zorblatt Manifold Qty"},', 1)
open(p, 'w').write(s)
PY
run_case "uncovered label is caught" 1 "D001"

echo "== 2. THE regression: the page-0x10 protection copy is removed again =="
# def/overlay.hpp's 11 rows reached the UI with no explainer (9) or the wrong one (2). Deleting the
# section that fixed it must fail — this is the case the gate exists for.
reset
python3 - "$WORK/main/www/app.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
start = s.index('  // ── Protection retries & drop control')
end = s.index('  // ── Outdoor / refrigerant circuit ──')
open(p, 'w').write(s[:start] + s[end:])
PY
run_case "removing the protection copy is caught" 1 "Comp. INV Current Drop"

echo "== 3. an entry that matches nothing (a renamed label left its regex behind) =="
reset
python3 - "$WORK/main/www/app.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('const DESCRIPTIONS = [',
              'const DESCRIPTIONS = [\n  { re: /zorblatt manifold/i, what: "x", de: { what: "x" } },', 1)
open(p, 'w').write(s)
PY
run_case "dead entry is caught" 1 "D002"

echo "== 4. an entry with no German copy (a German page would print English) =="
reset
python3 - "$WORK/main/www/app.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('const DESCRIPTIONS = [',
              'const DESCRIPTIONS = [\n  { re: /outdoor air/i, what: "x" },', 1)
open(p, 'w').write(s)
PY
run_case "missing de block is caught" 1 "D004"

echo "== 4b. a MODEL_DESCRIPTIONS entry with no German copy =="
# The Model card's copy is a second table with no catalog to check coverage against, so the shape
# checks are the only thing standing between it and a German page silently printing English.
reset
python3 - "$WORK/main/www/app.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('const MODEL_DESCRIPTIONS = {',
              'const MODEL_DESCRIPTIONS = {\n  zorblatt: { what: "x" },', 1)
open(p, 'w').write(s)
PY
run_case "model entry without de is caught" 1 "MODEL_DESCRIPTIONS.zorblatt"

echo "== 5. a ledger line that no longer suppresses anything =="
reset
printf 'D002 /no such pattern ever/i\n' >> "$WORK/exc.txt"
run_case "stale ledger line is caught" 1 "D005"

echo "== 6. a D001 can NOT be adjudicated away =="
# The one finding with no legitimate adjudication. Suppressing it would restore exactly the blind
# spot this gate closes, so the ledger refuses the line outright (exit 2, not a quiet pass).
reset
python3 - "$WORK/main/def/altherma3_r_erga.hpp" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('    {0x10,  0, 217, 1, -1, "Operation Mode"},',
              '    {0x10,  0, 217, 1, -1, "Operation Mode"},\n'
              '    {0x10,  3, 152, 1, -1, "Zorblatt Manifold Qty"},', 1)
open(p, 'w').write(s)
PY
printf 'D001 Zorblatt Manifold Qty\n' >> "$WORK/exc.txt"
run_case "D001 suppression is refused" 2 "cannot be adjudicated"

echo "== 7. vacuity: an empty catalog must not read as full coverage =="
reset
rm -f "$WORK"/main/def/*.hpp
run_case "empty catalog refuses to pass" 2 "no .hpp files"

echo "== 8. vacuity: a changed row format must fail loudly, not silently match nothing =="
# The nastiest failure mode: if the generator changes the row shape and the scraper stops matching,
# "0 labels, 0 uncovered" looks exactly like success. The per-file cross-check turns that into an
# error instead.
reset
python3 - "$WORK/main/def/altherma3_r_erga.hpp" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
# A row whose label is no longer an inline string literal — the shape a generator change would
# plausibly take (a shared constant, an enum, a macro). The row still OPENS like a row, so only the
# count cross-check can notice that the scraper skipped it.
s = s.replace('{0x10,  0, 217, 1, -1, "Operation Mode"},', '{0x10,  0, 217, 1, -1, LBL_OPERATION_MODE},', 1)
open(p, 'w').write(s)
PY
run_case "unparsable row format is caught" 2 "extraction is unreliable"

echo "== 9. the DESCRIPTIONS table itself going missing is an error, not a pass =="
reset
python3 - "$WORK/main/www/app.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
open(p, 'w').write(s.replace('const DESCRIPTIONS = [', 'const DESCRIPTIONS_RENAMED = [', 1))
PY
run_case "missing table is caught" 2 "must appear exactly once"

echo
if [ "$fail" -eq 0 ]; then
    echo "description audit selftest: all $pass cases caught"
else
    echo "description audit selftest: $fail of $((pass + fail)) cases MISSED" >&2
fi
[ "$fail" -eq 0 ]
