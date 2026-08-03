#!/usr/bin/env bash
set -euo pipefail

proj="$(cd "$(dirname "$0")/.." && pwd)"
cd "$proj"

# One discoverable command for the entire hardware-free UI contract. The glob intentionally makes
# a newly added test_ui_*.mjs part of the merge gate without another workflow edit.
for test_file in test/test_ui_*.mjs; do
  node "$test_file"
done
node test/test_homehub_discovery_contract.mjs
node test/test_mcp_dashboard.mjs
tools/ui/selftest.sh

echo "complete UI use-case suite passed"
