#!/usr/bin/env bash
# Assemble the GitHub Pages site (the browser installer) into _site/ from the built dist/:
#   _site/index.html      the installer page (docs/index.html)
#   _site/manifest.json   esp-web-tools + OTA manifest
#   _site/*.bin           per-target merged (installer) + signed app (OTA) images
#
# The site hosts TWO independent feeds, because a merge to main no longer cuts a release:
#   _site/            the RELEASE channel — written only by a manual release run
#   _site/dev/        the DEV channel     — written by every firmware-relevant merge to main
#   _site/PR/<N>/     a PR preview        — written by that PR's build
# All three have the same shape (index.html + manifest.json + bins), so the installer page and the
# device OTA client work identically against any of them; only the URL differs
# (main/logic/ota_channel.hpp derives the dev one by appending "dev/").
#
# Usage: scripts/build-pages.sh [--dev | PR_NUMBER]
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d dist ] || { echo "build-pages: run scripts/ci-build-all.sh first (no dist/)" >&2; exit 1; }

ARG="${1:-}"
case "$ARG" in
    --dev) OUT="_site/dev" ;;
    "")    OUT="_site" ;;
    *)     OUT="_site/PR/$ARG" ;;
esac
rm -rf "$OUT"; mkdir -p "$OUT"

cp docs/index.html "$OUT/index.html"
cp dist/*.bin "$OUT/"
cp dist/manifest.json "$OUT/manifest.json"

echo "built $OUT (installer + manifest + $(ls dist/*.bin | wc -l | tr -d ' ') images)"
