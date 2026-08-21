#!/usr/bin/env bash
# Keep docs/ESP_IDF_MATRIX.md bound to the actual ESP-IDF surface without network access.
#
# Exit: 0 = clean, 1 = drift findings, 2 = missing runtime or malformed/vacuous audit input.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
    echo "run-esp-idf-matrix-audit: need python3" >&2
    exit 2
fi

exec python3 tools/esp_idf_matrix/check_matrix.py "$@"
