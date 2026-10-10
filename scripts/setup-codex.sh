#!/usr/bin/env bash
# Regenerate project-local registrations. User trust and Git config remain manual.
set -euo pipefail

agent_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$#" -ne 0 ]; then
  echo 'usage: scripts/setup-codex.sh' >&2
  exit 2
fi
exec "$agent_root/scripts/agent-python.sh" "$agent_root/tools/agent-config/export-subagents.py" --write
