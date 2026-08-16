#!/usr/bin/env bash
# Runner-neutral PR evidence syntax/freshness policy for CI and local canaries.
#
# The neutral hook core owns gate names, relevance and stamp parsing. CI supplies an already-fetched
# body, current head SHA and complete changed-file list, then disables discovery so missing or partial
# evidence cannot be mistaken for an irrelevant PR.
# This proves the record, not who edited the PR body. GitHub merge authorization and maintainer review
# remain the actor trust boundary.
set -euo pipefail

proj="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AGENT_POLICY_CI=1
export AGENT_PROJECT_DIR="${AGENT_PROJECT_DIR:-$proj}"
exec "$proj/tools/agent-hooks/require-pr-gates.sh" --no-discovery "$@"
