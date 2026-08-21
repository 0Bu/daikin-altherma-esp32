#!/usr/bin/env bash
set -euo pipefail

proj="$(cd "$(dirname "$0")/.." && pwd)"
cd "$proj"

# A dedicated, discoverable gate for every copy surface. The complete UI suite also executes these
# tests through its test_ui_*.mjs glob; keeping this entry point explicit makes translation drift a
# named CI failure instead of burying it among modal/use-case output.
node test/test_ui_locale_catalogs.mjs
node test/test_ui_error_codes.mjs
node test/test_ui_homehub_copy.mjs
node test/test_ui_live_i18n.mjs

echo "complete UI localization gate passed"
