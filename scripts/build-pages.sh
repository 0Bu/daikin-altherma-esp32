#!/usr/bin/env bash
# Assemble the GitHub Pages site (the browser installer) into _site/ from the built dist/:
#   _site/index.html      the installer page (docs/index.html)
#   _site/*.mjs           local installer behavior modules
#   _site/manifest.json   esptool-js installer + OTA manifest
#   _site/*.bin           sparse installer parts + signed app (OTA) + manual merged image
#
# The site hosts TWO independent feeds, because a merge to main no longer cuts a release:
#   _site/            the RELEASE channel — written only by a manual release run
#   _site/dev/        the DEV channel     — written by every firmware-relevant merge to main
# Both have the same shape (index.html + manifest.json + bins), so the installer page and the
# device OTA client work identically against either; only the URL differs
# (main/logic/ota_channel.hpp derives the dev one by appending "dev/").
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
rm -rf "$OUT"; mkdir -p "$OUT"

cp docs/index.html docs/serial-port-release.mjs docs/web-installer.mjs "$OUT/"
cp dist/*.bin "$OUT/"
cp dist/manifest.json "$OUT/manifest.json"

echo "built $OUT (installer + manifest + $(ls dist/*.bin | wc -l | tr -d ' ') images)"
