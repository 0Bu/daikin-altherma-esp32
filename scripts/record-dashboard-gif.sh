#!/usr/bin/env bash
# Re-record docs/media/dashboard.gif — the README's picture of the dashboard — from the CURRENT
# web UI, and re-stamp it so scripts/run-ui-gif-audit.sh goes green again.
#
# The GIF is not a mockup: the page it films is main/www/{index.html,style.css,app.js} spliced
# exactly as the firmware build splices them (tools/uigif/build_demo.py), with only the DEVICE
# stubbed (tools/uigif/scenes.js). What you see is what renderLive() drew — including the honest
# blanking (an idle outdoor unit's pills read "—", not last run's numbers), which is half of why
# the picture is worth showing at all.
#
# ONE PAGE LOAD PER FRAME. Every frame is its own headless Chrome, posed at a deterministic
# animation instant by window.__pose (scenes.js) — the flow dashes, the fan and the pump must move
# in the GIF, and wall-clock time cannot survive a fresh page load. Each animation is given a WHOLE
# number of cycles across the total length so the loop closes without a jump (their real periods,
# 1.1 / 1.6 / 2.6 s, share no practical common multiple).
#
# Requires: Chrome, ffmpeg, python3. LOCAL ONLY — CI has no browser, which is why the gate that
# runs there compares a STAMP instead of re-rendering (tools/uigif/check_ui_gif.mjs).
#
# Usage: scripts/record-dashboard-gif.sh [--keep-frames]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

GIF="docs/media/dashboard.gif"
STAMP="tools/uigif/gif_stamp.txt"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8731}"

# ── Recording parameters. These are part of the artefact, so the stamp covers this file: change a
# ── crop or a frame rate and the GIF on disk no longer matches the one this script would make.
SCENES=4
PER_SCENE_MS=2240          # 28 frames of 80 ms — a whole number of frames per scene
STEP_MS=80                 # 12.5 fps
VIEWPORT="1000,760"
SCALE=2                    # device pixel ratio; the crop below is in DEVICE pixels
# The schematic card alone — NOT the header line above it. The header carries the running version,
# and a version frozen into a recording is wrong from the next release onwards, with no gate able to
# see it (this one fingerprints sources, and nothing re-renders a GIF when version.txt moves). The
# IP and the product name leave with it; the README says the name three lines up anyway.
# Measured, not guessed: #schem's box is CSS 108,96 784x463 in this viewport, so the crop is that
# card with a 12 px side margin, 8 px above and 5 px below (x 96…904, y 88…564), x SCALE.
CROP="1616:952:192:176"    # the schematic card, nothing above or below it

WIDTH=900                  # final GIF width
WATCHDOG_TICKS=200         # 0.1 s each — a ceiling per frame, not the normal path

TOTAL_MS=$((SCENES * PER_SCENE_MS))
FRAMES_PER_SCENE=$((PER_SCENE_MS / STEP_MS))
TOTAL_FRAMES=$((SCENES * FRAMES_PER_SCENE))

for tool in ffmpeg python3; do
    command -v "$tool" >/dev/null 2>&1 || { echo "record-dashboard-gif: need $tool" >&2; exit 2; }
done
[ -x "$CHROME" ] || { echo "record-dashboard-gif: no Chrome at $CHROME (set CHROME=...)" >&2; exit 2; }

WORK="$(mktemp -d)"
cleanup() {
    [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null || true
    if [ "${KEEP:-0}" = "1" ]; then echo "frames kept in $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT
[ "${1:-}" = "--keep-frames" ] && KEEP=1

mkdir -p "$WORK/frames" "$WORK/profile" "$(dirname "$GIF")"
python3 tools/uigif/build_demo.py "$ROOT" "$WORK/demo.html" >/dev/null

# file:// cannot be cache-busted reliably and blocks nothing we need — serve the one file instead.
(cd "$WORK" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SRV=$!
disown "$SRV" 2>/dev/null || true    # else job control prints "Terminated" over the last line
for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/demo.html" 2>/dev/null && break
    sleep 0.1
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/demo.html" || {
    echo "record-dashboard-gif: local server did not come up on :$PORT" >&2; exit 2; }

shoot() {                  # shoot <frame-index> <scene> <t-ms>
    local n=$1 scene=$2 t=$3 pid i out sz prev
    out="$WORK/frames/f$(printf '%04d' "$n").png"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
        --force-device-scale-factor="$SCALE" --window-size="$VIEWPORT" \
        --virtual-time-budget=2500 --user-data-dir="$WORK/profile" \
        --no-first-run --no-default-browser-check --disable-extensions \
        --disable-background-networking --disable-sync --disable-crash-reporter \
        --screenshot="$out" \
        "http://127.0.0.1:$PORT/demo.html?scene=$scene&t=$t&T=$TOTAL_MS" >/dev/null 2>&1 &
    pid=$!
    # Chrome writes the PNG and then LINGERS instead of exiting (~15 s, every frame — waiting on the
    # process made one frame cost longer than the finished GIF plays). Wait on the ARTEFACT: the
    # file appearing and its size settling. Concurrency is not the answer either: six parallel
    # headless Chromes wedged after the first batch and never returned.
    prev=-1
    for ((i = 0; i < WATCHDOG_TICKS; i++)); do
        kill -0 "$pid" 2>/dev/null || break
        if [ -f "$out" ]; then
            sz=$(wc -c < "$out")
            [ "$sz" -gt 0 ] && [ "$sz" -eq "$prev" ] && break
            prev=$sz
        fi
        sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}

echo "recording $TOTAL_FRAMES frames ($SCENES scenes x ${PER_SCENE_MS}ms @ ${STEP_MS}ms)…"
n=0
for scene in $(seq 0 $((SCENES - 1))); do
    for k in $(seq 0 $((FRAMES_PER_SCENE - 1))); do
        shoot "$n" "$scene" $(( scene * PER_SCENE_MS + k * STEP_MS ))
        n=$((n + 1))
        printf '\r  frame %d/%d' "$n" "$TOTAL_FRAMES"
    done
done
echo

have=$(find "$WORK/frames" -name 'f*.png' | wc -l | tr -d ' ')
[ "$have" -eq "$TOTAL_FRAMES" ] || {
    echo "record-dashboard-gif: captured $have of $TOTAL_FRAMES frames — refusing to build a GIF with gaps" >&2
    exit 1
}

ffmpeg -y -framerate $((1000 / STEP_MS)) -i "$WORK/frames/f%04d.png" \
    -filter_complex "crop=$CROP,scale=$WIDTH:-1:flags=lanczos,split[a][b];\
[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
    -loop 0 "$GIF" 2>/dev/null

node tools/uigif/check_ui_gif.mjs --write-stamp
echo
echo "wrote $GIF ($(wc -c < "$GIF" | tr -d ' ') bytes) and $STAMP"
echo "Look at it before committing — the gate checks that it is CURRENT, never that it is GOOD."
