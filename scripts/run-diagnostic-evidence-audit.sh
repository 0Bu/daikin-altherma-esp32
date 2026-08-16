#!/usr/bin/env bash
# Source and claim-boundary gate for the visible plant diagnoses.
#
# Usage:
#   scripts/run-diagnostic-evidence-audit.sh           # validate; CI always uses this form
#   scripts/run-diagnostic-evidence-audit.sh --update  # only after $diagnostic-evidence-review
# Exit: 0 = clean/updated, 1 = findings, 2 = usage/runtime error. Requires node >=18.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
    echo "run-diagnostic-evidence-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/diagnostic_evidence/check_diagnostic_evidence.mjs "$@"
