#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-websocket"

if [[ "${1:-}" == "--if-ui-changed" ]]; then
  if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]] && git rev-parse --verify HEAD^1 >/dev/null 2>&1; then
    ui_pattern='^(main/www/|main/def/|main/http_|test/test_browser|test/test_ui|tools/browser/|tools/ui/|tools/schematic/|tools/web_asset/|tools/presenter/|tools/localization/|scripts/run-browser-render-tests[.]sh|[.]github/workflows/build[.]yml$)'
    if ! git diff --name-only HEAD^1 HEAD | grep -qE "$ui_pattern"; then
      echo "browser render gate: no UI/browser-relevant changes in diff; skipped"
      exit 0
    fi
  fi
  shift
fi

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

if [[ "${DAIKIN_BROWSER_PARALLEL:-1}" == "1" ]]; then
  node test/test_browser_render.mjs --viewport phone "$@" &
  pid_phone=$!
  node test/test_browser_render.mjs --viewport desktop "$@" &
  pid_desktop=$!
  wait "$pid_phone"
  wait "$pid_desktop"
else
  node test/test_browser_render.mjs "$@"
fi

node tools/browser/selftest.mjs

echo "complete browser rendering and accessibility gate passed"
