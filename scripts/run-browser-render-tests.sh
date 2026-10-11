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
  if [ "${GITHUB_EVENT_NAME:-}" = pull_request ] && \
       git rev-parse --verify -q HEAD^2 >/dev/null 2>&1; then
    range="HEAD^1 HEAD"
  # 2. Multi-commit push: BEFORE names the commit prior to the push on this branch.
  elif [ -n "$before_candidate" ]; then
    if [ "$before_candidate" != "0000000000000000000000000000000000000000" ] && \
         git cat-file -e "${before_candidate}^{commit}" 2>/dev/null; then
      range="$before_candidate HEAD"
    fi
  # 3. Explicit base SHA candidate (e.g. non-merge PR branch checkout)
  elif [ -n "$base_candidate" ]; then
    if git cat-file -e "${base_candidate}^{commit}" 2>/dev/null; then
      range="$base_candidate HEAD"
    fi
  # 4. Local single-commit fallback, only when no event comparison was supplied.
  # An unknown event SHA must run the full suite; HEAD^1 can hide an earlier UI commit.
  elif [ -z "${GITHUB_EVENT_NAME:-}" ] && git rev-parse --verify -q HEAD^1 >/dev/null 2>&1; then
    range="HEAD^1 HEAD"
  fi

  if [ -z "$range" ]; then
    echo "browser render gate: unresolvable comparison range; running full suite"
  elif ! changed_files="$(git diff --name-only $range 2>/dev/null)"; then
    echo "browser render gate: git diff failed for range '$range'; running full suite"
  # Read directly from a here-string: even a buffered printf producer can die of SIGPIPE
  # when grep -q matches early in a long list and pipefail would turn that into a false skip.
  elif ! grep -qE "$ui_pattern" <<< "$changed_files"; then
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
  exit 2
fi
export DAIKIN_BROWSER_BIN="$browser_bin"

browser_timeout="${DAIKIN_BROWSER_TIMEOUT_MS:-600000}"
if ! [[ "$browser_timeout" =~ ^[1-9][0-9]{0,6}$ ]] || (( browser_timeout > 3600000 )); then
  echo "browser render gate: DAIKIN_BROWSER_TIMEOUT_MS must be 1..3600000" >&2
  exit 2
fi

# The supervisor creates and owns its temporary page. It cancels and joins every owned process
# group before removing it, including siblings and Chrome descendants after a failure.
exec node tools/browser/run_render.mjs "$@"
