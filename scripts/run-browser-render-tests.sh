#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-websocket"

if [[ "${1:-}" == "--if-ui-changed" ]]; then
  shift
  ui_pattern='^(main/www/|main/def/|main/http_|test/test_browser|test/test_ui|tools/browser/|tools/ui/|tools/schematic/|tools/web_asset/|tools/presenter/|tools/ui_localization/|tools/localization/|scripts/run-browser-render-tests[.]sh|[.]github/workflows/build[.]yml$)'

  range=""
  before_candidate="${BEFORE:-${GITHUB_EVENT_BEFORE:-}}"
  base_candidate="${EVENT_BASE_SHA:-${BASE_SHA:-}}"

  # 1. PR merge tree: HEAD has two parents (HEAD^1 is base, HEAD^2 is PR head).
  # The diff HEAD^1..HEAD is exactly what this PR introduces relative to the base branch.
  if git rev-parse --verify -q HEAD^2 >/dev/null 2>&1; then
    range="HEAD^1 HEAD"
  # 2. Multi-commit push: BEFORE names the commit prior to the push on this branch.
  elif [ -n "$before_candidate" ] && [ "$before_candidate" != "0000000000000000000000000000000000000000" ] && \
       git cat-file -e "${before_candidate}^{commit}" 2>/dev/null; then
    range="$before_candidate HEAD"
  # 3. Explicit base SHA candidate (e.g. non-merge PR branch checkout)
  elif [ -n "$base_candidate" ] && git cat-file -e "${base_candidate}^{commit}" 2>/dev/null; then
    range="$base_candidate HEAD"
  # 4. Single-commit fallback
  elif git rev-parse --verify -q HEAD^1 >/dev/null 2>&1; then
    range="HEAD^1 HEAD"
  fi

  if [ -z "$range" ]; then
    echo "browser render gate: unresolvable comparison range; running full suite"
  elif ! changed_files="$(git diff --name-only $range 2>/dev/null)"; then
    echo "browser render gate: git diff failed for range '$range'; running full suite"
  elif ! printf '%s\n' "$changed_files" | grep -qE "$ui_pattern"; then
    echo "browser render gate: no UI/browser-relevant changes in diff ($range); skipped"
    exit 0
  else
    echo "browser render gate: UI changes detected in range '$range'; running full suite"
  fi
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
