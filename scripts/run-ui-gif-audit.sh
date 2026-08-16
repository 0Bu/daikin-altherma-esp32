#!/usr/bin/env bash
# README-recording gate: is docs/media/dashboard.gif still a picture of THIS UI?
#
# The GIF is the first thing a new user sees, and it is the one artefact here that rots invisibly.
# It is a recording, so it keeps rendering perfectly long after the thing it recorded changed: the
# schematic audit stays green, the description audit stays green, the domain audit stays green, and
# the README goes on showing last month's pipes. A screenshot cannot fail a test — it can only be
# out of date, and nothing else in this repo can tell.
#
# CI has no browser, so this cannot re-render and compare pixels. It fingerprints the SOURCES the
# recording depends on — the schematic markup, the CSS that draws and animates it, the assembled UI
# functions that paint it, the strings they print, the scenes, and the recorder's own
# framing — and fails when that no longer matches the stamp recorded beside the GIF. It also reads
# the GIF itself: a single-frame still, or 2-second frames, fails the one thing the recording is
# for, which is showing the flow MOVING.
#
# The fix for a failure is always to RE-RECORD (scripts/record-dashboard-gif.sh, needs Chrome +
# ffmpeg locally) — never to edit the stamp. The judgement half — are all normal operating scenes
# present, do their transitions and readings stay honest — is the $ui-gif skill.
#
# Usage: scripts/run-ui-gif-audit.sh [-v]
# Exit:  0 = current, 1 = findings, 2 = usage / the fingerprint could not be taken.
set -euo pipefail
cd "$(dirname "$0")/.."

# Same reason as run-description-audit.sh and run-schematic-audit.sh: the rules being fingerprinted
# ARE JavaScript. A gate that quietly does nothing when its runtime is absent is worse than no gate,
# because the green check still gets believed.
if ! command -v node >/dev/null 2>&1; then
    echo "run-ui-gif-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/uigif/check_ui_gif.mjs "$@"
