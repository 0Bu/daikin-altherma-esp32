#!/usr/bin/env bash
# Real pinned decoder/GDB proof using synthetic temporary ELF/core fixtures only. No hardware.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
exec "$repo_root/scripts/idf-docker.sh" python tools/coredump/integration_tests.py
