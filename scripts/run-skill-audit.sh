#!/usr/bin/env bash
# Skill drift, structural audit, and self-optimization: checks all canonical skills in .agents/skills/
# against repository facts, partition offsets, endpoints, hardware specs, links, and baseline pinning contracts.
#
# Usage:
#   scripts/run-skill-audit.sh                     # Read-only audit of all skills and reviewers
#   scripts/run-skill-audit.sh --optimize          # Self-optimize and auto-sync checklists & partitions
#   scripts/run-skill-audit.sh [extra args forwarded to check_skills.mjs]
# Exit: 0 = clean, 1 = drift findings, 2 = usage/runtime error. Requires node >=18.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
    echo "run-skill-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/skill_audit/check_skills.mjs "$@"
