#!/usr/bin/env bash
# Runner-neutral PR evidence syntax/freshness policy for CI and local canaries.
#
# The neutral hook core owns gate names, relevance and stamp parsing. Protected-base CI supplies an
# already-fetched body, current head SHA and complete changed-file list, then disables discovery so
# missing or partial evidence cannot be mistaken for an irrelevant PR. Ordinary merges still rely on
# maintainer review and GitHub authorization; the sole record-free Renovate runner-pin class also
# supplies immutable exact-head commit evidence and is decided in the data-only protected-base
# pr-policy workflow, which never loads PR code.
set -euo pipefail

proj="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AGENT_POLICY_CI=1
export AGENT_PROJECT_DIR="${AGENT_PROJECT_DIR:-$proj}"
exec "$proj/tools/agent-hooks/require-pr-gates.sh" --no-discovery "$@"
