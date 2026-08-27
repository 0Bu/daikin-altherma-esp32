#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! browser_bin="$(node tools/browser/find_browser.mjs)"; then
  if [[ -z "${CI:-}" && "${DAIKIN_BROWSER_ALLOW_LOCAL_SKIP:-0}" == "1" ]]; then
    echo "browser render gate explicitly skipped outside CI: Chrome/Chromium is unavailable"
    exit 0
  fi
  echo "browser render gate requires Chrome or Chromium (set DAIKIN_BROWSER_BIN to its executable)" >&2
  exit 1
fi
export DAIKIN_BROWSER_BIN="$browser_bin"

work="$(mktemp -d "${TMPDIR:-/tmp}/daikin-browser-render.XXXXXX")"
cleanup() {
  rm -rf -- "$work"
}
trap cleanup EXIT

node tools/browser/assemble_page.mjs "$work/index.html"

export DAIKIN_BROWSER_PAGE="$work/index.html"
node test/test_browser_render.mjs
node tools/browser/selftest.mjs

echo "complete browser rendering and accessibility gate passed"
