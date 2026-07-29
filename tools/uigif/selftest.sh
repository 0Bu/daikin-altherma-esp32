#!/usr/bin/env bash
# Does the GIF gate still catch a stale recording?
#
# This gate protects an artefact that CANNOT fail on its own — a recording renders perfectly
# forever, whatever the UI has since become. So the only thing standing between the README and a
# picture of last month's dashboard is this checker still reacting. A checker that has stopped
# reacting turns "clean" from evidence into a lie, and there would be no second symptom: the GIF
# would still look fine.
#
# Every case is re-created in a THROWAWAY COPY of the tree — the working tree is never touched.
#
# Usage: tools/uigif/selftest.sh
# Exit:  0 = every defect still caught, 1 = the gate has gone blind.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

command -v node >/dev/null 2>&1 || { echo "selftest: need node" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

# A copy holding only what the checker reads.
seed() {
    local d="$WORK/$1"; rm -rf "$d"
    mkdir -p "$d/main/www" "$d/tools/uigif" "$d/scripts" "$d/docs/media"
    cp "$ROOT"/main/www/{index.html,style.css,app.js} "$d/main/www/"
    cp "$ROOT"/tools/uigif/{check_ui_gif.mjs,scenes.js} "$d/tools/uigif/"
    cp "$ROOT/tools/uigif/gif_stamp.txt" "$d/tools/uigif/"
    cp "$ROOT/scripts/record-dashboard-gif.sh" "$d/scripts/"
    cp "$ROOT/docs/media/dashboard.gif" "$d/docs/media/"
    cp "$ROOT/README.md" "$d/"
    echo "$d"
}

# check <case> <expected-exit> <expected-code-or-"-"> <mutation…>
check() {
    local name=$1 want_exit=$2 want_code=$3; shift 3
    local d; d="$(seed "$name")"
    ( cd "$d" && "$@" )
    local out rc
    set +e
    out="$(cd "$d" && node tools/uigif/check_ui_gif.mjs 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne "$want_exit" ]; then
        printf '  ✗ %-28s exit %s, expected %s\n%s\n' "$name" "$rc" "$want_exit" "$out"; fails=$((fails + 1)); return
    fi
    if [ "$want_code" != "-" ] && ! grep -q "$want_code" <<<"$out"; then
        printf '  ✗ %-28s exit %s but no %s in:\n%s\n' "$name" "$rc" "$want_code" "$out"; fails=$((fails + 1)); return
    fi
    if [ "$want_code" = "-" ]; then
        printf '  ✓ %-28s %s\n' "$name" "$([ "$want_exit" = 0 ] && echo "still clean" || echo "exit $want_exit — refuses to check")"
    else
        printf '  ✓ %-28s %s\n' "$name" "$want_code"
    fi
}

echo "uigif selftest — the recording gate:"

# 0. The tree as it stands must PASS, or every case below proves nothing.
check "unchanged tree"        0 -    true

# 1. The defect the gate exists for: the drawing moves, the recording does not.
check "schematic markup moved" 1 U001 \
    perl -0pi -e 's/(<figure\b[^>]*\bid="schem")/$1 data-selftest="moved"/' main/www/index.html
check "schematic css changed"  1 U001 \
    perl -0pi -e 's/(svg \.sc-flow\.on \{[^}]*)/$1 stroke-width: 9px;/' main/www/style.css
check "painting code changed"  1 U001 \
    perl -0pi -e 's/(function renderLive\(\) \{)/$1\n  \/\* selftest \*\//' main/www/app.js
check "scenes changed"         1 U001 \
    perl -0pi -e 's/(name: "Standby")/$1 \/* selftest *\//' tools/uigif/scenes.js
check "recorder framing changed" 1 U001 \
    perl -0pi -e 's/^WIDTH=900.*$/WIDTH=640/m' scripts/record-dashboard-gif.sh

# 2. The artefact swapped or edited outside the recorder.
check "gif replaced"           1 U002 \
    sh -c 'printf "\x00" >> docs/media/dashboard.gif'
check "gif deleted"            1 U003 rm docs/media/dashboard.gif
check "readme drops the gif"   1 U003 \
    perl -0pi -e 's/!\[[^\]]*\]\(docs\/media\/dashboard\.gif\)//' README.md

# 3. The point of the recording: MOTION. A still satisfies every other check on this page — it is a
#    valid GIF, of the right UI, linked from the README — so only the frame count can refuse it.
#    Written byte by byte rather than via ffmpeg: a case that silently tests something else when a
#    tool is missing is exactly the blindness this file exists to rule out.
check "gif is a single still"  1 U004 \
    node -e 'require("fs").writeFileSync("docs/media/dashboard.gif", Buffer.from(
        "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b", "hex"))'

# 4. No stamp at all is not a pass.
check "stamp missing"          1 U005 rm tools/uigif/gif_stamp.txt

# 5. Vacuity: if the checker can no longer FIND what it fingerprints, it must stop loudly (exit 2)
#    rather than fingerprint nothing and call the tree clean.
check "painting fn renamed"    2 -  \
    perl -0pi -e 's/function renderLive\(/function renderLiveXX(/' main/www/app.js
check "schematic css gone"     2 -  \
    perl -0pi -e 's/\.sc-flow/.zz-flow/g' main/www/style.css

echo
if [ "$fails" -eq 0 ]; then echo "uigif selftest: all cases still caught"; exit 0; fi
echo "uigif selftest: $fails case(s) NOT caught — the gate has gone blind" >&2
exit 1
