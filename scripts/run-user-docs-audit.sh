#!/usr/bin/env bash
# Plain-language user-documentation gate.
#
# Every visible plant-diagnostics result must answer, in both UI languages: what was observed, how
# narrowly to interpret it, and what a non-specialist can safely do next. Maintained repository
# documentation is English-only; localized prose stays in main/www. docs/DIAGNOSTICS.md must carry
# a matching English section for every row. It reuses the dedicated evidence contract so unsupported
# claims cannot pass here, while scripts/run-diagnostic-evidence-audit.sh owns the separate
# source/implementation review fingerprint.
#
# Usage:
#   scripts/run-user-docs-audit.sh           # validate; CI always uses this form
#   scripts/run-user-docs-audit.sh --update  # re-stamp after the prose was reviewed and updated
# Exit: 0 = clean/updated, 1 = findings, 2 = usage/runtime error. Requires node >=18.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
    echo "run-user-docs-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/user_docs/check_user_docs.mjs "$@"
