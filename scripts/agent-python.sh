#!/usr/bin/env bash
# Select the supported agent-tool interpreter without changing the user's environment.
set -euo pipefail

agent_python=''
supports_agent_tools() {
  "$1" -I -c 'import sys, tomllib; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1
}

if [ -n "${AGENT_PYTHON:-}" ]; then
  agent_python="$(command -v -- "$AGENT_PYTHON" 2>/dev/null || true)"
  if [ -z "$agent_python" ] || [ ! -x "$agent_python" ] || ! supports_agent_tools "$agent_python"; then
    echo 'agent-python: AGENT_PYTHON must select an executable Python >= 3.11 with tomllib' >&2
    exit 2
  fi
else
  for agent_candidate in python3 python3.14 python3.13 python3.12 python3.11; do
    agent_candidate_path="$(command -v -- "$agent_candidate" 2>/dev/null || true)"
    if [ -n "$agent_candidate_path" ] && supports_agent_tools "$agent_candidate_path"; then
      agent_python="$agent_candidate_path"
      break
    fi
  done
  if [ -z "$agent_python" ]; then
    echo 'agent-python: Python >= 3.11 with tomllib is required; set AGENT_PYTHON to an installed supported interpreter' >&2
    exit 2
  fi
fi

if [ "${1:-}" = '--resolve' ] && [ "$#" -eq 1 ]; then
  printf '%s\n' "$agent_python"
  exit 0
fi
if [ "$#" -eq 0 ]; then
  echo 'usage: scripts/agent-python.sh <script.py | Python arguments>; --resolve prints the checked interpreter' >&2
  exit 2
fi
exec "$agent_python" "$@"
