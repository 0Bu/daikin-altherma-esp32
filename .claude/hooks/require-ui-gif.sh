#!/usr/bin/env bash
# Claude compatibility adapter. The runner-neutral aggregate gate keeps the UI-GIF mechanical
# audit fail-closed and requires current-head human review when a PR carries a new recording.
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$root/tools/agent-hooks/require-pr-gates.sh" --project-dir "$root"
