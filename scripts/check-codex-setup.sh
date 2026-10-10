#!/usr/bin/env bash
# Read-only doctor; no global configuration, trust, tasks or live-MCP calls.
set -euo pipefail

agent_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$agent_root/scripts/agent-python.sh" "$agent_root/tools/agent-config/doctor.py" "$@"
