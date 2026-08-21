#!/usr/bin/env bash
# Self-test for the schematic audit: does the gate still catch what it was BUILT to catch?
#
# Every defect below is one this drawing actually SHIPPED (git log on main/www/index.html), and
# every one of them was invisible to every other gate in this repo — the firmware built, the logic
# tests passed, the value was physically correct, the copy existed, and the picture still said
# something false. So a checker that quietly stops checking here restores exactly the blind spot it
# was built to close, and nothing would notice. Each case re-introduces a real defect into a
# THROWAWAY COPY of the tree and asserts the audit fails on it with the right finding code. The
# working tree is never touched.
#
# The seven-defect corpus (cases 1-6 plus 1b):
#   1  a three-blade rotor whose bounding box is not centred on its hub — it orbits, it does not spin
#   2  the leaving-water pill floating ~40 px above the pipe it names
#   3  the return-temperature pill past the tank junction, claiming the heating branch
#   4  the "HEIZUNG" label struck through by the heating riser (it rendered as "HEIZUNC")
#   5  a horizontal run off the drawing's two-level grid
#   6  a "bar" pill with no name, while two other "bar" pills exist
#   1b the pump rotating counter-clockwise instead of its specified clockwise direction
# and cases 3b-3d, found the same way the seven were — by a person looking at (and clicking) the
# picture. All three sit on the ONE structure the seven never touched, the branch junction:
#   3b a flow overlay drawn ACROSS the branch junction, so a DHW cycle animated heating pipe
#   3c a hit target owning pipe on BOTH sides of it — the highlight making the same false claim
#   3d a pipe inside no hit target at all, which is why 3c read as a selection that merely stops
#
# Usage: tools/schematic/selftest.sh     Exit: 0 = all caught, 1 = a case was missed.
# No `set -e`: a missed case must be counted and reported, not abort the suite.
set -uo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null 2>&1 || { echo "selftest: need node (>=18)" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "selftest: need python3 (the patches are python)" >&2; exit 2; }

CHECK="$PWD/tools/schematic/check_schematic.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0 fail=0

reset() {   # a pristine copy of everything the audit reads
    seed_ok=1
    rm -rf "$WORK/main" "$WORK/exc.txt"
    mkdir -p "$WORK/main"
    cp -R main/www "$WORK/main/www"
    cp -R main/def "$WORK/main/def"
    cp tools/schematic/audit_exceptions.txt "$WORK/exc.txt"
}

# patch_file <file> — apply a python patch read from stdin (the patch exits non-zero when the text
# it edits is gone). A seeded defect that silently failed to seed produces a green case proving
# NOTHING — the same lie as a checker that stopped checking — so the failure is carried into
# run_case rather than swallowed.
seed_ok=1
patch_file() {
    local f="$1"
    if python3 - "$f"; then seed_ok=1
    else seed_ok=0; echo "  SEED FAILED: $f — the patch did not apply (the markup moved under this case)"; fi
}

# run_case <name> <expect-rc> <expect-needle>
run_case() {
    local name="$1" want_rc="$2" needle="$3" out rc
    if [ "$seed_ok" -ne 1 ]; then echo "  MISSED: $name — the defect was never seeded"; fail=$((fail + 1)); return; fi
    out="$(node "$CHECK" --html "$WORK/main/www/index.html" --app "$WORK/main/www/app.sources" \
                         --css "$WORK/main/www/style.css" --def "$WORK/main/def" \
                         --exceptions "$WORK/exc.txt" 2>&1)"; rc=$?
    if [ "$rc" -ne "$want_rc" ]; then
        echo "  MISSED: $name — expected exit $want_rc, got $rc"
        printf '%s\n' "$out" | sed -n '1,4p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    if ! printf '%s' "$out" | grep -qF "$needle"; then
        echo "  MISSED: $name — exit $rc was right, but the report never says \"$needle\""
        printf '%s\n' "$out" | sed -n '1,4p' | sed 's/^/            /'
        fail=$((fail + 1)); return
    fi
    echo "  PASS  $name"
    pass=$((pass + 1))
}

echo "== 0. the unpatched tree is clean (otherwise every case below proves nothing) =="
reset
run_case "clean tree passes" 0 "clean"

echo "== 1. the rotor's bounding box comes off its hub (the fan wobble) =="
# The rotor is safe to spin for TWO independent reasons, and the seed has to break both or it proves
# nothing: a circle centred on the hub sits inside the rotating group and dominates its bounding box
# (the CSS pivots on `transform-box: fill-box`, i.e. on that box), AND the four blades at 90° are
# symmetric by themselves. Remove the ring and drop one blade — three blades at 0/90/180 with no
# ring is exactly the shape whose box comes off the hub, which is the wobble this drawing shipped.
# (This case went vacuous once before, when the artwork changed from three blades to four and moving
#  the ring alone stopped producing the defect. A seed that no longer reproduces is a MISS, not a
#  pass — which is the only reason it was noticed.)
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
s2 = re.sub(r' *<circle r="42"[^\n]*\n', '', s, count=1)
if s2 == s: sys.exit(1)
s = s2
s2 = re.sub(r' *<use href="#fanBlade" transform="rotate\(270\)"/>\n', '', s, count=1)
if s2 == s: sys.exit(1)
open(p, 'w').write(s2)
PY
run_case "off-hub rotor is caught" 1 "G007"

echo "== 1b. the pump rotates counter-clockwise instead of clockwise =="
reset
patch_file "$WORK/main/www/style.css" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '@keyframes pump-spin { to { transform: rotate(360deg); } }'
if old not in s: sys.exit(1)
new = '@keyframes pump-spin { to { transform: rotate(-360deg); } }'
open(p, 'w').write(s.replace(old, new, 1))
PY
run_case "counter-clockwise pump is caught" 1 "G012"

echo "== 2. a value pill floating ~40 px above the pipe it names =="
# The high-pressure pill sits just above the refrigerant run BECAUSE that is where it is measured;
# drifted up while its tie stays behind in the pipe band, it names nothing and the reader is left to
# guess which run it belongs to. Seeded on `hp`, not the leaving-water pill: R1T is deliberately lifted but has a
# mechanically verified tie to its outlet, so moving that pill together with its tie would remain
# correctly attributed and seed no defect.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
i = s.index('data-insp="hp"')
j = s.index('</g>', i)
blk = s[i:j]
new = blk.replace('y="146"', 'y="106"').replace('y="161"', 'y="121"')
if new == blk: sys.exit(1)
open(p, 'w').write(s[:i] + new + s[j:])
PY
run_case "pill floating off its run is caught" 1 "G006"

echo "== 2b. a lifted supply pill whose tie stops short of its run =="
# R2T is allowed beyond the ordinary 14 px only because its visible leader reaches the post-pump
# run. Shortening that leader must restore G006; otherwise `.sc-tie` would be a decorative bypass.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = 'd="M572.5 156 V 176"'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, 'd="M572.5 156 V 164"', 1))
PY
run_case "a lifted pill with a leader that stops short is caught" 1 "G006"

echo "== 3. the return-temperature pill past the tank junction =="
# R4T is at the indoor unit's water INLET, downstream of where the tank return joins the heating
# return: it reads whichever branch is flowing and belongs to NEITHER. Drawn right of that junction
# the picture answers "which return is this?" with "the heating's" — a claim no sensor there makes.
# The junction is derived from the drawing, so this fires wherever the tank riser actually is.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
i = s.index('data-insp="rwt"')
j = s.index('</g>', i)
blk = s[i:j]
new = blk.replace('x="386"', 'x="640"').replace('x="419"', 'x="673"').replace('M419 431', 'M673 431')
if new == blk: sys.exit(1)
open(p, 'w').write(s[:i] + new + s[j:])
PY
run_case "pill on the wrong branch is caught" 1 "E002"

echo "== 3b. a flow overlay spanning the branch junction =="
# The bug this rule was written from: the return's two overlays were split at an arbitrary point on
# the heating drop instead of AT the merge, so the shared overlay reached back across the
# heating-only section — and a DHW cycle animated a stretch of pipe nothing was flowing through.
# Geometry was fine, the overlay traced a real pipe, every pill sat on its own run: nothing else
# sees it. Reported by a user looking at the drawing, which is the gap this case closes.
reset
patch_file "$WORK/main/www/index.html" <<'SEED'
import sys
p = sys.argv[1]; s = open(p).read()
old = '<path class="sc-flow water-flow cold" id="fRet" d="M610 420 H 378"/>'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '<path class="sc-flow water-flow cold" id="fRet" d="M720 420 H 378"/>'))
SEED
run_case "an overlay across the junction is caught" 1 "E003"

echo "== 3c. a hit target owning pipe on both sides of the junction =="
# The second half of the same report, and the half no rule saw: the RETURN group owned the heating
# branch's leg as well as the shared run, so hovering the return highlighted one circuit's return
# and not the other's. Every pipe was in the right place and every overlay traced one, which is why
# 3b's rule passed it — a highlight is a claim about what belongs together, and nothing checked it.
reset
patch_file "$WORK/main/www/index.html" <<'SEED'
import sys
p = sys.argv[1]; s = open(p).read()
pipe = '                  <path class="sc-pipe" d="M720 398 V 420 H 610"/>\n'
hit = '                  <path class="sc-hitline" d="M720 398 V 420 H 620"/>\n'
ret = '                  <path class="sc-pipe" d="M610 420 H 378"/>\n'
if pipe not in s or hit not in s or ret not in s: sys.exit(1)
s = s.replace(pipe, '', 1).replace(hit, '', 1)
open(p, 'w').write(s.replace(ret, pipe + hit + ret, 1))
SEED
run_case "a hit target across the junction is caught" 1 "E004"

echo "== 3d. a pipe inside no hit target at all =="
# And the half that made 3c look like a selection that merely STOPS: the tank's return leg was drawn
# outside its branch group (only the hitline was inside), so that stretch could not be hovered,
# tapped or selected. It fails by absence — nothing renders wrong, nothing logs — so the only
# witness is the pointer, and the neighbouring reachable pipe explains the gap away.
reset
patch_file "$WORK/main/www/index.html" <<'SEED'
import sys
p = sys.argv[1]; s = open(p).read()
leg = '                    <path class="sc-pipe" d="M720 398 V 420 H 610"/>\n'
after = '                  <path class="sc-flow water-flow hot" id="fTank" d="M610 180 H 720 V 290"/>\n'
if leg not in s or after not in s: sys.exit(1)
open(p, 'w').write(s.replace(leg, '', 1).replace(after, after + leg, 1))
SEED
run_case "a pipe in no hit target is caught" 1 "S011"

echo "== 4. the HEIZUNG label struck through by the heating riser =="
# It rendered as "HEIZUNC". A label may still sit ON a pipe when an opaque pill or box painted after
# it covers the stroke (that is how the thermostat pill sits on the riser), so the check is paint
# order, not overlap — and this label, moved onto the run, has nothing over it.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '<text class="sc-lbl" x="578" y="310" text-anchor="middle"\n                        id="svSpaceCircuit" data-i18n="schem.space_circuit">'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '<text class="sc-lbl" x="578" y="186" text-anchor="middle"\n                        id="svSpaceCircuit" data-i18n="schem.space_circuit">', 1))
PY
run_case "label struck through by a pipe is caught" 1 "G003"

echo "== 5. a horizontal run off the two-level grid =="
# "TWO horizontal runs, and everything that flows sits on one of them" (index.html's own GEOMETRY
# note). One segment nudged 6 px puts a third level in the drawing: at a glance it reads as a step
# in a straight pipe, i.e. as a component that is not there.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'M469 180 H 515' not in s: sys.exit(1)
open(p, 'w').write(s.replace('M469 180 H 515', 'M469 186 H 515'))   # pipe, hit line AND flow overlay
PY
run_case "off-grid run is caught" 1 "G008"

echo "== 6. a bar pill loses its name while two other bar pills exist =="
# "bar" appears three times and only one of them is water. Without the name, position alone carries
# the difference between a sealed heating circuit at 1.8 bar and a refrigerant circuit at 28.4 —
# and position is a weak tell for a reading whose same-unit neighbours sit two components away.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
new = re.sub(r'\n *<text class="sc-sub"[^\n]*data-i18n="schem.water_press"[^\n]*\n', '\n', s, count=1)
if new == s: sys.exit(1)
open(p, 'w').write(new)
PY
run_case "unnamed pill with a repeated unit is caught" 1 "E001 wp"

echo "== 7. a hit target that opens nothing =="
# The drawing's whole premise is that it is explorable (DESIGN.md §5.3 item 2). A target with no
# INSPECT entry opens an empty panel — no error, no log, the same silent shape as a value row with
# no explainer.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'data-insp="wp"' not in s: sys.exit(1)
open(p, 'w').write(s.replace('data-insp="wp"', 'data-insp="zorblatt"', 1))
PY
run_case "dead hit target is caught" 1 "S001"

echo "== 7b. …and it can NOT be adjudicated away =="
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
open(p, 'w').write(s.replace('data-insp="wp"', 'data-insp="zorblatt"', 1))
PY
printf 'S001 zorblatt\n' >> "$WORK/exc.txt"
run_case "S001 suppression is refused" 2 "cannot be adjudicated"

echo "== 7c. …neither can a pill on the wrong branch =="
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
i = s.index('data-insp="rwt"'); j = s.index('</g>', i)
blk = s[i:j]
open(p, 'w').write(s[:i] + blk.replace('x="386"', 'x="640"').replace('x="419"', 'x="673"').replace('M419 431', 'M673 431') + s[j:])
PY
printf 'E002 rwt\n' >> "$WORK/exc.txt"
run_case "E002 suppression is refused" 2 "cannot be adjudicated"

echo "== 8. an id the SVG declares and the UI never writes (and the reverse) =="
# A setTxt() on a missing id is a silent no-op and an unwritten id keeps its "—" forever: the
# reading simply never appears, with nothing anywhere to say why.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'id="svFlow"' not in s: sys.exit(1)
open(p, 'w').write(s.replace('id="svFlow"', 'id="svFlowRate"', 1))
PY
run_case "id drift is caught in both directions" 1 "S005 svFlow"

echo "== 9. a data-i18n key with no German =="
# The static markup is localised at boot from I18N; a key missing from one separately shipped locale
# prints the English fallback. One label in a German drawing, silently.
reset
patch_file "$WORK/main/www/locales/de.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '/* schem.space_circuit */ "RAUMKREIS",'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '/* schem.space_circuit */ undefined,', 1))
PY
run_case "missing German label is caught" 1 "S006 schem.space_circuit/de"

echo "== 10. an INSPECT sample that resolves to no explainer =="
# `sample` is how a pill's copy is looked up in DESCRIPTIONS. A typo does not throw — the panel just
# opens with an empty body, which is the D001 shape one layer over.
reset
patch_file "$WORK/main/www/js/schematic.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'sample: "Flow sensor"' not in s: sys.exit(1)
open(p, 'w').write(s.replace('sample: "Flow sensor"', 'sample: "Zorblatt Manifold Qty"', 1))
PY
run_case "unresolvable sample is caught" 1 "S010"

echo "== 11. a ledger line that no longer suppresses anything =="
reset
printf 'E001 zorblatt\n' >> "$WORK/exc.txt"
run_case "stale ledger line is caught" 1 "S000"

echo "== 12. vacuity: a renamed vocabulary must fail loudly, not audit nothing =="
# The nastiest failure mode by far: if the pill/pipe class names are restyled and the parser stops
# recognising them, "0 findings" looks exactly like success. Refuse to pass instead.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
i = s.index('<div class="schem-scroll">')
open(p, 'w').write(s[:i] + re.sub(r'(?<=[" ])sc-pill(?=[" ])', 'sc-chip', s[i:]))
PY
run_case "renamed vocabulary refuses to pass" 2 "vocabulary changed"

echo "== 13. vacuity: the drawing itself going missing is an error, not a pass =="
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
open(p, 'w').write(s.replace('<div class="schem-scroll">', '<div class="schem-scroll-renamed">', 1))
PY
run_case "missing schematic is caught" 2 "must appear exactly once"

echo "== 14. the rest of the geometry rules, one seeded defect each =="
# Every rule the audit carries needs a case, or it is a rule nobody has ever seen fire — and a rule
# that has never fired is indistinguishable from one that cannot.

# 14a — two readings drawn on top of each other.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'x="214" y="192"' not in s: sys.exit(1)                       # the discharge pill, under the hot run
open(p, 'w').write(s.replace('x="214" y="192"', 'x="214" y="154"', 1))   # slid up onto the pressure pill
PY
run_case "overlapping pills are caught" 1 "G002"

# 14b — a label that no longer fits the pill it is printed in.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'x="522" y="255" width="112"' not in s: sys.exit(1)           # the thermostat pill
open(p, 'w').write(s.replace('x="522" y="255" width="112"', 'x="522" y="255" width="34"', 1))
PY
run_case "text overflowing its pill is caught" 1 "G004"

# 14bb — the markup/English/German all fit, but a lazy locale does not. The production regression
# was Ukrainian, and a bilingual-only width sweep stayed green despite loading every locale catalog.
reset
patch_file "$WORK/main/www/locales/uk.js" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
new = re.sub(r'/\* schem\.defrost_pill \*/ "[^"]+"',
             '/* schem.defrost_pill */ "❄ надзвичайно-довге-розморожування"', s, count=1)
if new == s: sys.exit(1)
open(p, 'w').write(new)
PY
run_case "a non-English locale overflowing its pill is caught" 1 "G004 defrost/uk"

# 14bc — two separate captions can each fit their own component and still run into each other.
reset
patch_file "$WORK/main/www/locales/uk.js" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
new = re.sub(r'/\* schem\.return \*/ "[^"]+"',
             '/* schem.return */ "НАДЗВИЧАЙНО ДОВГИЙ ВХІД ПЛАСТИНЧАТОГО ТЕПЛООБМІННИКА"', s, count=1)
if new == s: sys.exit(1)
open(p, 'w').write(new)
PY
run_case "neighbouring locale labels overlapping are caught" 1 "G013"

# 14c — a pipe that is not axis-aligned. A 4 px skew over an 80 px run is invisible in review and
# permanent in the image.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'd="M378 180 H 425"' not in s: sys.exit(1)
open(p, 'w').write(s.replace('d="M378 180 H 425"', 'd="M378 180 L 425 184"', 1))
PY
run_case "a skewed pipe is caught" 1 "G005"

# 14d — a run moved without the boxes it passes through. Both runs cross the plate and the outdoor
# unit, so those margins ARE the drawing's grid.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'x="290" y="150" width="88" height="300"' not in s: sys.exit(1)      # the plate
open(p, 'w').write(s.replace('x="290" y="150" width="88" height="300"', 'x="290" y="140" width="88" height="310"', 1))
PY
run_case "unequal run margins are caught" 1 "G009"

# 14e — the animated overlay and the pipe it traces drifting apart. They are two copies of one path,
# so an edit to either leaves the flow animating where no pipe is drawn.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '<path class="sc-flow water-flow hot" id="fSup1" d="M378 180 H 425"/>'
if old not in s: sys.exit(1)
open(p, 'w').write(s.replace(old, '<path class="sc-flow water-flow hot" id="fSup1" d="M378 180 H 419"/>', 1))
PY
run_case "a flow overlay off its pipe is caught" 1 "G010"

# 14f — a <use> whose target is gone. It draws nothing at all, silently: a missing blade, not an error.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
i = s.index('<div class="schem-scroll">')
head, tail = s[:i], s[i:]
if '<circle class="sc-comp"' not in tail: sys.exit(1)
tail = tail.replace('<circle class="sc-comp"', '<use href="#nothingHere"/><circle class="sc-comp"', 1)
open(p, 'w').write(head + tail)
PY
run_case "a dangling <use> is caught" 1 "S008"

# 14g — something drawn outside the viewBox. The SVG scales to fit the card, so it is simply not on
# screen — and nothing anywhere says so.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'x="660" y="290" width="120"' not in s: sys.exit(1)           # the DHW tank box, 10 px off the edge
open(p, 'w').write(s.replace('x="660" y="290" width="120"', 'x="660" y="290" width="180"', 1))
PY
run_case "drawing past the viewBox is caught" 1 "G001"

# 15 — the shipped defect: a pipe's tap area reaching into the fitting it meets. The space riser's hit
# line was trimmed to y=194, the 3-way valve's own bottom edge — correct if the cap were flat, but
# `stroke-linecap: round` puts it back at y=185 and 18 % of the valve answered "space branch" instead.
# Nothing visible changes, which is the whole point: only a pointer at the valve's rim can tell.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'd="M610 203 V 290"' not in s: sys.exit(1)
open(p, 'w').write(s.replace('d="M610 203 V 290"', 'd="M610 194 V 290"', 1))
PY
run_case "a hit line reaching into a fitting is caught" 1 "G011 wheat|valve"

# 15b — the same rule against a RECTANGULAR component. G011 measures a circle and a box by different
# geometry, so one case would leave half the rule free to rot: the supply run's hit line trimmed to
# the plate's own edge, where the cap puts it 9 px inside the exchanger.
reset
patch_file "$WORK/main/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'd="M387 180 H 425"' not in s: sys.exit(1)
open(p, 'w').write(s.replace('d="M387 180 H 425"', 'd="M378 180 H 425"', 1))
PY
run_case "…and it measures boxes, not just discs" 1 "G011 wsup|phe"

echo
if [ "$fail" -eq 0 ]; then
    echo "schematic audit selftest: all $pass cases caught"
else
    echo "schematic audit selftest: $fail of $((pass + fail)) cases MISSED" >&2
fi
[ "$fail" -eq 0 ]
