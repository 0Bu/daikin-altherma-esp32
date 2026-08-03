#!/usr/bin/env bash
# Re-record docs/media/dashboard.gif — the README's picture of the dashboard — from the CURRENT
# web UI, and re-stamp it so scripts/run-ui-gif-audit.sh goes green again.
#
# The GIF is not a mockup: the page it films is main/www/{index.html,style.css,app.js} spliced
# exactly as the firmware build splices them (tools/uigif/build_demo.py), with only the DEVICE
# stubbed (tools/uigif/scenes.js). What you see is what renderLive() drew — including the honest
# standby arbitration (held X10A readings disappear, while current paired HomeHub readings stand in
# with petrol provenance), which is half of why the picture is worth showing at all.
#
# ONE PAGE LOAD PER SOURCE IMAGE. A steady frame needs one screenshot; a transition frame needs the
# outgoing and incoming scene at the same deterministic instant, then ffmpeg blends them. Every
# screenshot is posed by window.__pose (scenes.js) — the flow dashes, fan and pump must move in the
# GIF, and wall-clock time cannot survive a fresh page load. Each animation is given a WHOLE number
# of cycles across the total length so the loop closes without a jump (their real periods,
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
# Extra flags for the headless Chrome, empty by default. The case this exists for is running as ROOT
# (a container), where Chrome refuses to start at all without --no-sandbox and every frame comes back
# missing — which this script then correctly reports as "captured 0 of N frames" without saying why.
# Deliberately NOT defaulted to --no-sandbox: on a normal desktop run the sandbox should stay on, and
# a flag that silently disables it for everyone is the wrong trade for one environment's convenience.
#   CHROME_FLAGS=--no-sandbox scripts/record-dashboard-gif.sh
CHROME_FLAGS="${CHROME_FLAGS:-}"

# ── Recording parameters. These are part of the artefact, so the stamp covers this file: change a
# ── crop or a frame rate and the GIF on disk no longer matches the one this script would make.
SCENES=9                   # every normal plant state + every published hydronic mode
DWELL_FRAMES=10            # 1.0 s fully readable at 100 ms/frame
TRANSITION_FRAMES=5        # 500 ms crossfade to the next scene (including last -> first)
STEP_MS=100                # 10 fps; avoids wagon-wheel reversal of the eight-vane pump
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

SLOT_FRAMES=$((DWELL_FRAMES + TRANSITION_FRAMES))
TOTAL_FRAMES=$((SCENES * SLOT_FRAMES))
TOTAL_MS=$((TOTAL_FRAMES * STEP_MS))

# The pump turns once per 1.6 s in the live UI and has eight identical vanes. At 8 fps its posed
# phase advanced farther than half the 45° vane spacing per frame, so the GIF appeared to turn the
# opposite way (the wagon-wheel effect). Keep the sampled advance strictly below that ambiguity
# limit. This protects the recording without changing the live animation's speed or direction.
PUMP_CYCLES=$(((TOTAL_MS + 800) / 1600))
if [ $((2 * PUMP_CYCLES * 8)) -ge "$TOTAL_FRAMES" ]; then
    echo "record-dashboard-gif: frame rate aliases the pump direction — raise the sampling rate" >&2
    exit 2
fi

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

mkdir -p "$WORK/frames" "$WORK/blend" "$WORK/profile" "$(dirname "$GIF")"
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

# ...and prove it is OUR server. A health check on the URL alone answers "something is listening",
# which is a different question: $PORT is also build-ui-prototype.sh's port, so a prototype server
# left running from an earlier session keeps the bind, our http.server exits "Address already in
# use", and every frame is then filmed off SOMEONE ELSE'S page — silently, because the stale page is
# a perfectly good dashboard. That is worse than a crash: the run finishes, the stamp is written
# from the CURRENT sources, and the gate goes green over a recording of the old UI — the exact
# false-current state this whole gate exists to make impossible. Observed on 2026-07-29: a server
# from 15:29 served a five-hour-old page to a 20:41 recording, byte-for-byte reproducing the GIF it
# was meant to replace. Compare the bytes rather than trusting the port.
if [ "$(curl -fsS "http://127.0.0.1:$PORT/demo.html" | shasum -a 256 | cut -d' ' -f1)" \
     != "$(shasum -a 256 < "$WORK/demo.html" | cut -d' ' -f1)" ]; then
    echo "record-dashboard-gif: :$PORT is serving a DIFFERENT page than the one just built —" >&2
    echo "  something else holds the port (build-ui-prototype.sh uses it too). Free it, or" >&2
    echo "  re-run with PORT=<other>. Recording now would film that page, not this tree." >&2
    exit 2
fi

shoot() {                  # shoot <output-path> <scene> <t-ms>
    local out=$1 scene=$2 t=$3 pid i sz prev
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars ${CHROME_FLAGS:+$CHROME_FLAGS} \
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

echo "recording $TOTAL_FRAMES frames ($SCENES scenes, ${DWELL_FRAMES} steady + ${TRANSITION_FRAMES} transition @ ${STEP_MS}ms)…"
n=0
for scene in $(seq 0 $((SCENES - 1))); do
    next=$(( (scene + 1) % SCENES ))
    for k in $(seq 0 $((SLOT_FRAMES - 1))); do
        t=$((n * STEP_MS))
        frame="$WORK/frames/f$(printf '%04d' "$n").png"
        if [ "$k" -lt "$DWELL_FRAMES" ]; then
            shoot "$frame" "$scene" "$t"
        else
            # Crossfade both real UI states. The last blend is 100 % incoming, so the final
            # transition lands exactly on scene 0 and the GIF loops without a state jump.
            blend_k=$((k - DWELL_FRAMES + 1))
            a="$WORK/blend/a$(printf '%04d' "$n").png"
            b="$WORK/blend/b$(printf '%04d' "$n").png"
            shoot "$a" "$scene" "$t"
            shoot "$b" "$next" "$t"
            ffmpeg -y -i "$a" -i "$b" \
                -filter_complex "blend=all_expr='A*($TRANSITION_FRAMES-$blend_k)/$TRANSITION_FRAMES+B*$blend_k/$TRANSITION_FRAMES'" \
                -frames:v 1 "$frame" 2>/dev/null
        fi
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
