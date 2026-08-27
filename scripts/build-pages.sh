#!/usr/bin/env bash
# Assemble the GitHub Pages site (the browser installer) into _site/ from the built dist/:
#   _site/index.html      the installer page (docs/index.html)
#   _site/*.mjs           local installer behavior modules
#   _site/heat-pump-icon.png  the same canonical brand mark embedded in the firmware UI
#   _site/manifest.json   esptool-js installer + OTA manifest
#   _site/artifacts.json  exact manifest-bound inventory for public-byte readback
#   _site/changelog.json  version-bound notes shown by the firmware OTA confirmation
#   _site/LICENSE.txt + THIRD_PARTY_NOTICES.md + Apache-2.0.txt  redistribution notices
#   _site/*.bin           sparse installer parts + signed app (OTA) + manual merged image
#
# The site hosts TWO independent feeds, because a merge to main no longer cuts a release:
#   _site/            the RELEASE channel — written only by a manual release run
#   _site/dev/        the DEV channel     — written by every firmware-relevant merge to main
# Every slice emitted by this workflow has the same shape (index.html + manifest.json +
# artifacts.json + changelog.json + bins), so the installer page and the device OTA client need no
# feed-specific parser; only the URL differs (main/logic/ota_channel.hpp derives the dev one by
# appending "dev/"). A historical root slice keeps its old shape until the next manual release.
#
# A third target used to exist — _site/PR/<N>/, a per-PR preview installer built by every PR run.
# It is retired: the dev channel covers "flash what is on main from a browser" at one publish per
# merge rather than one per PR commit, and each publish also triggers a GitHub Pages deployment.
#
# Usage: scripts/build-pages.sh [--dev]
set -euo pipefail
cd "$(dirname "$0")/.."

ARG="${1:-}"
# Validate the argument BEFORE the dist/ check, and before the `rm -rf "$OUT"` below: OUT is what
# this script deletes, so a malformed call has to fail while it still names nothing. Neither mode
# takes a value — a second word (`--dev 12`, or the retired `--pr 12`) is a call that meant
# something else, not one word too many.
[ "$#" -le 1 ] || { echo "build-pages: expected at most one argument" >&2; exit 1; }
case "$ARG" in
    --dev) OUT="_site/dev" ;;
    "")    OUT="_site" ;;
    *)     echo "build-pages: unknown argument '$ARG' (expected none, or --dev)" >&2; exit 1 ;;
esac

[ -d dist ] || { echo "build-pages: run scripts/ci-build-all.sh first (no dist/)" >&2; exit 1; }
[ -f dist/artifacts.json ] || { echo "build-pages: dist/artifacts.json is missing" >&2; exit 1; }
[ -f dist/changelog.json ] || { echo "build-pages: dist/changelog.json is missing" >&2; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"

cp docs/index.html docs/serial-port-release.mjs docs/web-installer.mjs "$OUT/"
cp main/www/heat_pump_icon.png "$OUT/heat-pump-icon.png"
cp LICENSE "$OUT/LICENSE.txt"
cp THIRD_PARTY_NOTICES.md "$OUT/THIRD_PARTY_NOTICES.md"
cp tools/web_asset/vendor/LICENSE "$OUT/Apache-2.0.txt"
cp dist/*.bin "$OUT/"
cp dist/manifest.json "$OUT/manifest.json"
cp dist/artifacts.json "$OUT/artifacts.json"
cp dist/changelog.json "$OUT/changelog.json"

echo "built $OUT (installer + manifest + $(ls dist/*.bin | wc -l | tr -d ' ') images)"
