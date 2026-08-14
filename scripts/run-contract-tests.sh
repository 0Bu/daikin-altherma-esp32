#!/usr/bin/env bash
set -euo pipefail

proj="$(cd "$(dirname "$0")/.." && pwd)"
cd "$proj"

# The SOURCE-BOUNDARY contracts: assertions about main/*.cpp that the host suite structurally cannot
# make. test_logic.cpp links the IDF-free headers, so it can prove what a rule DECIDES but never that
# the firmware still calls it from the right task, in the right order, from the only file allowed to
# — "hp_modbus.cpp is the sole caller of mb_request_lwt_offset()" is a statement about the whole
# component, and the only way to check it is to read the text.
#
# These ran as three bare `node test/…` steps in build.yml and nothing else. That is the gap this
# script closes: every other suite here has a discoverable command, so a contributor running the
# local loop skipped exactly these, and a newly added sibling was invisible to every entry point at
# once. The GLOB is the mechanism — a new test_*_contract.mjs joins the gate with no workflow edit,
# the same property test_ui_*.mjs already had.
#
# test_homehub_discovery_contract.mjs deliberately runs HERE as well as in run-ui-use-case-tests.sh:
# its subject is the firmware's discovery lifecycle, but it also reads index.html, so both suites
# have a real claim on it and neither should be able to drop it silently.
shopt -s nullglob
tests=(test/test_*_contract.mjs)

# A glob that matched nothing must never read as "everything passed" — that is the failure mode this
# whole script exists to prevent, one level up.
if [ ${#tests[@]} -eq 0 ]; then
  echo "no test/test_*_contract.mjs found — refusing to report success" >&2
  exit 2
fi

for test_file in "${tests[@]}"; do
  node "$test_file"
done

# Source contracts can go green by quietly losing contact with the call sites they claim to pin.
# Re-seed each OTA heap regression in a throwaway tree and require this suite's exact checker to
# reject it; the real tree is never modified.
node tools/ota/selftest.mjs

./scripts/run-public-readiness-audit.sh

echo "${#tests[@]} source-boundary contract test(s) passed"
