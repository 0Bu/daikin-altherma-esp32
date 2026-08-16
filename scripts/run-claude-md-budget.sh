#!/usr/bin/env bash
# Compatibility command for existing Claude automation.
#
# New CI and developer tooling use run-agent-instructions-budget.sh, which also validates the
# migration manifest and cross-runner parity. Preserve the two historical environment overrides and
# exit-code contract here so older callers and tools/claudemd/selftest.sh keep working unchanged.
set -euo pipefail

proj="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AGENT_LEGACY_INSTRUCTIONS_FILE="${CLAUDE_MD_FILE:-$proj/.claude/CLAUDE.md}"
export AGENT_LEGACY_INSTRUCTIONS_BUDGET_BYTES="${CLAUDE_MD_BUDGET_BYTES:-65536}"
exec "$proj/scripts/run-agent-instructions-budget.sh" --legacy-claude-budget-only
