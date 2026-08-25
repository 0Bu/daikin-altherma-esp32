#!/usr/bin/env bash
# Contributor-authored-text privacy and language gate: the commit range and, under a `pull_request`
# event, the PR title/description — does either carry personal information (an email outside GitHub's
# own noreply/example patterns, a phone number, a GPS coordinate pair, a pasted key or credential) or
# non-English prose? See tools/pr_hygiene/check_pr_hygiene.mjs and personal_info.mjs for the exact
# shapes and why diff content is deliberately out of scope.
#
# Usage: scripts/run-pr-hygiene-audit.sh [extra args forwarded to check_pr_hygiene.mjs]
# Exit: 0 = clean/nothing to check, 1 = findings, 2 = usage/runtime error. Requires node >=18.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
    echo "run-pr-hygiene-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/pr_hygiene/check_pr_hygiene.mjs "$@"
