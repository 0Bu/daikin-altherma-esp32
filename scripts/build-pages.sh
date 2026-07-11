#!/usr/bin/env bash
# Assemble the GitHub Pages site (the browser installer) into _site/ from the built dist/:
#   _site/index.html      the installer page (docs/index.html)
#   _site/manifest.json   esp-web-tools + OTA manifest
#   _site/*.bin           per-target merged (installer) + signed app (OTA) images
#
# For a PR preview, pass the PR number as $1 and the site is written to _site/PR/<N>/ with a
# PR-scoped manifest version (publish-pages-branch.sh syncs it onto gh-pages).
# Usage: scripts/build-pages.sh [PR_NUMBER]
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d dist ] || { echo "build-pages: run scripts/ci-build-all.sh first (no dist/)" >&2; exit 1; }

PR="${1:-}"
OUT="_site"; [ -n "$PR" ] && OUT="_site/PR/$PR"
rm -rf "$OUT"; mkdir -p "$OUT"

cp docs/index.html "$OUT/index.html"
cp dist/*.bin "$OUT/"
cp dist/manifest.json "$OUT/manifest.json"

echo "built $OUT (installer + manifest + $(ls dist/*.bin | wc -l | tr -d ' ') images)"
