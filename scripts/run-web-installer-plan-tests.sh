#!/usr/bin/env bash
# Prove that the NVS-preservation gate fails closed, not only that today's safe manifest passes.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 test/test_web_installer_plan.py
