#!/usr/bin/env bash
set -euo pipefail

proj="$(cd "$(dirname "$0")/.." && pwd)"

# Is .claude/CLAUDE.md still inside its byte budget?
#
# That file is loaded into EVERY Claude Code session, so every byte in it is paid on every turn —
# and it grows by accretion: each merged PR is tempted to leave its story there, which is how it
# reached 329 KB (~80k tokens, ~40% of a context window) before the 2026-08 reduction moved the
# narrative into docs/ (ARCHITECTURE.md, CONTRIBUTING.md) and left the rules. Without a gate the
# cut regrows; with one, the pressure lands where the file's own header points it — a new finding
# goes in as the RULE plus a pointer, and the measurement goes to docs/.
#
# The budget is bytes, not lines, because tokens track bytes and lines can be arbitrarily long.
# 64 KiB is ~35% headroom over the reduced file: room for months of rule-sized additions, binding
# against essay-sized ones. When this fires, MOVE NARRATIVE OUT — never trim a rule, and never
# raise the number without the same scrutiny a stack-size bump gets.
#
# CLAUDE_MD_FILE is overridable for the selftest only (tools/claudemd/selftest.sh), which proves
# the gate fails closed — a checker that has stopped checking reports the loudest possible green.
file="${CLAUDE_MD_FILE:-$proj/.claude/CLAUDE.md}"
budget="${CLAUDE_MD_BUDGET_BYTES:-65536}"

if [ ! -f "$file" ]; then
  echo "claude-md-budget: $file does not exist — refusing to report success" >&2
  exit 2
fi

size=$(wc -c < "$file" | tr -d ' ')

if [ "$size" -gt "$budget" ]; then
  echo "claude-md-budget: $file is $size bytes, over the $budget-byte budget." >&2
  echo "Move narrative to docs/ (ARCHITECTURE.md / PLANT.md / CONTRIBUTING.md) — do not trim rules" >&2
  echo "and do not raise the budget to clear the red." >&2
  exit 1
fi

echo "claude-md-budget: $size of $budget bytes ($((100 * size / budget))%)"
