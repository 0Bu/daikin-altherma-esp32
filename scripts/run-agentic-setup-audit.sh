#!/usr/bin/env bash
# Fast, read-only source check behind $agentic-setup and the native pre-push hook.
# No network, model turn, source edits, runtime trust, build, or extra review stamp.
set -euo pipefail

agent_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# Push checks always examine this checkout, never a caller's fixture or relaxed budget.
export AGENT_CONFIG_ROOT="$agent_root"
unset AGENT_INSTRUCTIONS_BUDGET_BYTES AGENT_EFFECTIVE_INSTRUCTIONS_BUDGET_BYTES
"$agent_root/scripts/run-agent-instructions-budget.sh"
"$agent_root/scripts/run-skill-audit.sh"
printf '%s\n' 'agentic-setup: source contracts verified; native execution and independent review are separate evidence.'
