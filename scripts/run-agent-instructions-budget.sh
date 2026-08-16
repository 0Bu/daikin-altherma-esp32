#!/usr/bin/env bash
# Canonical, runner-neutral contract for agent instructions and compatibility mappings.
#
# Despite the historical "budget" suffix, this entry point deliberately owns all three cheap
# invariants that must move together during the migration:
#   - always-loaded instruction files stay within their byte budgets;
#   - every legacy .claude file occurs exactly once in .codex/migration-manifest.json, every
#     declared canonical/adapter target exists, and the reviewed legacy path/byte fingerprint holds;
#   - skill identity/metadata and the explicit cross-runner safety invariants stay in parity.
#
# Keep the old scripts/run-claude-md-budget.sh name as a compatibility adapter only. New tooling and
# CI call this command so the required check is independent of the agent that happens to run it.
set -euo pipefail

proj="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" != "--legacy-claude-budget-only" ]; then
    python3 "$proj/tools/agent-config/check_toml.py"
    python3 "$proj/tools/agent-config/check_hooks.py"
fi
exec node "$proj/tools/agent-config/check.mjs" "$@"
