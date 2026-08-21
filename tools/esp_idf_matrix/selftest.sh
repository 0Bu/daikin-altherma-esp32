#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v python3 >/dev/null 2>&1; then
    echo "esp-idf-matrix selftest: need python3" >&2
    exit 2
fi

exec python3 tools/esp_idf_matrix/selftest.py
