#!/usr/bin/env bash
# Claude compatibility adapter. The runner-neutral aggregate gate enforces project-review and every
# other applicable current-head PR review in one fail-closed policy evaluation.
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$root/tools/agent-hooks/require-pr-gates.sh" --project-dir "$root"
