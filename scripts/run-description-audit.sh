#!/usr/bin/env bash
# Value-description coverage gate: does every reading the user can SEE have something to read?
#
# The web UI turns a value row into a tappable explainer by matching its catalog LABEL against the
# DESCRIPTIONS table in main/www/js/descriptions.js. A label nothing matches renders as a plain row — no error,
# no log, just a missing chevron among a hundred rows. def/overlay.hpp shipped 11 such rows that
# way. The catalog is machine-generated and grows without touching this repo's JS, so the gap
# re-opens on its own; this asserts the two sides still line up.
#
# Runs the REAL DESCRIPTIONS table (evaluated, not re-implemented) against the REAL catalog.
#
# Usage: scripts/run-description-audit.sh [extra args passed to the checker, e.g. -v]
# Exit:  0 = clean, 1 = findings, 2 = usage/parse/vacuity error.
# Requires only node — no ESP-IDF, no Docker, no board, like run-mock-tests.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

# The checker needs a JS engine because the rule under test IS JavaScript regex semantics; a python
# re-implementation would gate a translation of the shipped rule rather than the rule (see the
# header of check_descriptions.mjs). Fail loudly rather than skip: a gate that quietly does nothing
# when its runtime is absent is worse than no gate, because the green check still gets believed.
if ! command -v node >/dev/null 2>&1; then
    echo "run-description-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/descriptions/check_descriptions.mjs "$@"
