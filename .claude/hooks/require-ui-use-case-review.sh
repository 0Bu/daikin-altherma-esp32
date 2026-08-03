#!/usr/bin/env bash
# PreToolUse merge gate for the complete UI interaction contract.
#
# UI-relevant PRs require a checked, head-SHA-stamped /ui-use-case-review record. Once that record
# is current, the same deterministic suite used by CI runs again immediately before the merge. This
# catches a stale local checkout or a test that was never run by the current agent; GitHub branch
# protection independently blocks on the workflow's required `gates` job.

set -u
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0

input="$(cat 2>/dev/null)"
printf '%s' "$input" | gate_enforce "ui-use-case-review" "/ui-use-case-review" \
  "complete UI use-case review" \
  '^(main/www/|test/test_ui_|test/test_homehub_discovery_contract\.mjs$|test/test_mcp_dashboard\.mjs$|scripts/run-ui-use-case-tests\.sh$|tools/ui/|\.claude/skills/ui-use-case-review/|\.claude/hooks/(require-ui-use-case-review|pr-gate-lib)\.sh$|\.claude/settings\.json$|\.github/(pull_request_template\.md|workflows/build\.yml)$|docs/DESIGN\.md$)'
gate_rc=$?
[ "$gate_rc" -eq 0 ] || exit "$gate_rc"

# gate_enforce returns 0 for ordinary Bash calls too. Run the expensive part only for an actual PR
# merge; the matcher invokes this script for every Bash command so the distinction is essential.
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)"
is_merge=false
case "$tool" in
  mcp__github__merge_pull_request|mcp__codex_apps__github_merge_pull_request) is_merge=true ;;
  Bash)
    norm="$(printf '%s' "$cmd" | sed -E 's/^[[:space:]]+//; s/^cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*//')"
    printf '%s' "$norm" | grep -Eq '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' && is_merge=true
    ;;
esac
[ "$is_merge" = true ] || exit 0

if ! "$proj/scripts/run-ui-use-case-tests.sh"; then
  {
    echo "BLOCKED: complete UI use-case suite failed."
    echo
    echo "Run /ui-use-case-review, fix every failing interaction, then stamp the reviewed head in"
    echo "the PR body before attempting the merge again."
  } >&2
  exit 2
fi

exit 0
