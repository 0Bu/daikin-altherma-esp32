#!/usr/bin/env bash
# Canonical contract for agent instructions and Codex configuration.
#
# Despite the historical "budget" suffix, this entry point deliberately keeps the cheap contracts
# together: parsed TOML, canonical hook dispatch, the AGENTS.md byte budget and safety invariants,
# the reviewed skill/metadata inventory, and fail-closed rejection of a reintroduced .claude tree.
set -euo pipefail

proj="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$proj/tools/agent-config/check_toml.py"
python3 "$proj/tools/agent-config/check_hooks.py"
exec node "$proj/tools/agent-config/check.mjs" "$@"
