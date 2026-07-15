#!/usr/bin/env bash
# PreToolUse gate: refuse a PR *merge* until the feature-docs sync has been run against the commit
# being merged — but ONLY when the PR actually changes technical-feature surface. A docs-only,
# script-only or chore PR is not gated (the sibling require-project-review.sh already covers every
# merge; this narrower gate targets exactly "a new/changed technical feature landed").
#
# Relevance = the PR changed at least one file under main/ or test/, or sdkconfig.defaults /
# partitions.csv / the CI build workflow — i.e. the surface docs/FEATURES.md catalogs (ESP-IDF
# components, sdkconfig capabilities, HTTP/OTA/security/network/diagnostic mechanisms, logic core).
# If the PR touches none of those, the gate does not apply. If GitHub is unreadable, it fails CLOSED
# (requires the record) rather than guessing the PR is irrelevant — see gate_pr_changed_files.
#
# Same two merge paths, same record mechanism as require-project-review.sh: run /feature-docs, then
# tick + SHA-stamp its box in the PR body:
#     - [x] `/feature-docs` synced — merge gate @ <short-sha>
# Allowed only while checked AND stamped with the PR head. The shared flow is pr-gate-lib.sh →
# gate_enforce; this script just names the gate + the relevance filter.
#
# Exit codes: 0 = allow, 2 = block (stderr is fed back to Claude).

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0   # lib missing -> don't block

gate_enforce "feature-docs" "/feature-docs" "feature-docs sync" \
  '^(main/|test/|sdkconfig\.defaults$|partitions\.csv$|\.github/workflows/build\.yml$)'
exit $?
