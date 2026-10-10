#!/usr/bin/env bash
# Start a focused native review with a read-only parent and no approval channel.
set -euo pipefail

agent_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$agent_root/scripts/agent-python.sh" -B "$agent_root/tools/agent-config/review.py" "$@"
