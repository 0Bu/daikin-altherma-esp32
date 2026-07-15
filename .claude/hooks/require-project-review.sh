#!/usr/bin/env bash
# PreToolUse gate: refuse a PR *merge* until a project review has been run against the commit
# being merged. Plain `git commit` and `gh pr create` are NOT gated — the review runs only
# before merging a PR into main.
#
# Two merge paths are gated, so the gate holds in BOTH environments:
#   • Bash `gh pr merge ...`              — local terminal sessions
#   • mcp__github__merge_pull_request     — Claude Code on the web / remote (no `gh` CLI)
# Matched via the `matcher` entries in .claude/settings.json that both invoke this script.
#
# Mechanism (NO file marker — see pr-gate-lib.sh): after running /project-review and confirming
# it passes with no blocking findings, record the pass by TICKING the PR checklist box and
# STAMPING it with the reviewed commit:
#     - [x] `/project-review` clean — merge gate @ <short-sha>
# This gate allows the merge only while that box is checked AND the stamped sha still matches the
# PR's head commit. Push another commit and the stamp goes stale, forcing a fresh review + re-tick.
#
# This is UNCONDITIONAL — every PR merge needs a current project review. (The sibling
# require-feature-docs.sh gate is CONDITIONAL: it fires only when the PR touches feature surface.)
# The whole flow lives in pr-gate-lib.sh → gate_enforce; this script just names the gate.
#
# Only Claude Code sessions are gated; a human merging via the GitHub UI (or `gh` in a plain
# terminal) is unaffected. Exit codes: 0 = allow, 2 = block (stderr is fed back to Claude).

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0   # lib missing -> don't block

gate_enforce "project-review" "/project-review" "project review"
exit $?
