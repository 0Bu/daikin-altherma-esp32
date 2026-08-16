#!/usr/bin/env bash
# Dashboard-schematic gate: does the drawing still say what it means?
#
# The schematic is the dashboard's whole "what is the plant doing right now" answer (DESIGN.md
# §5.3), and every defect it has shipped was invisible to every other gate here: the firmware
# builds, the logic tests pass, the domain audit sees a physically correct value, the description
# audit finds copy for it — and the picture still claims the wrong branch, floats a reading 40 px
# from the pipe it names, or strikes a label through with a riser ("HEIZUNG" rendered as
# "HEIZUNC"). That is the #35-#39 failure shape drawn in SVG: well-formed, plausible, and
# attributing a real number to the wrong thing.
#
# Three layers, all decided against the REAL markup (the SVG is parsed, the INSPECT/I18N/
# DESCRIPTIONS tables are evaluated — there is no second copy of the coordinates or the rules to
# drift): structure (hit targets ↔ inspector entries ↔ ids ↔ translations), geometry (inside the
# viewBox, no overlaps, no struck-through labels, axis-aligned runs, pills tied to their own pipe,
# rotors centred on their hub, no run's invisible tap area reaching into the fitting it meets) and
# domain (a repeated unit needs a name; a return-run reading stays
# on the common section). What it cannot decide — is the picture still TRUE, is a new part in the
# right place, is the German copy right — is the $schematic-review skill's half.
#
# Usage: scripts/run-schematic-audit.sh [extra args passed to the checker, e.g. -v]
# Exit:  0 = clean, 1 = findings, 2 = usage/parse/vacuity error.
# Requires only node — no ESP-IDF, no Docker, no board, no browser, like run-description-audit.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

# The checker needs a JS engine for the same reason run-description-audit.sh does: the bindings it
# checks the drawing against ARE JavaScript (regex semantics included), and a re-implementation
# would gate a translation of the shipped rule rather than the rule. Fail loudly rather than skip —
# a gate that quietly does nothing when its runtime is absent is worse than no gate, because the
# green check still gets believed.
if ! command -v node >/dev/null 2>&1; then
    echo "run-schematic-audit: need node (>=18). CI's ubuntu-latest ships it; on macOS: brew install node" >&2
    exit 2
fi

exec node tools/schematic/check_schematic.mjs "$@"
