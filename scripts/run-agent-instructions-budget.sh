#!/usr/bin/env bash
# Canonical contract for agent instructions and configuration.
#
# Despite the historical "budget" suffix, this entry point deliberately keeps the cheap contracts
# together: parsed TOML, canonical hook dispatch, the AGENTS.md byte budget and safety invariants,
# the reviewed skill/metadata inventory, and fail-closed rejection of a reintroduced .claude tree.
set -euo pipefail

proj="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$proj/scripts/agent-python.sh" "$proj/tools/agent-config/check_toml.py"
"$proj/scripts/agent-python.sh" "$proj/tools/agent-config/check_hooks.py"
node "$proj/tools/agent-config/check.mjs" "$@"
exec "$proj/scripts/agent-python.sh" "$proj/tools/agent-config/export-subagents.py" --check
