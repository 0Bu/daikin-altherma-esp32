#!/usr/bin/env bash
# Redaction gate: does every diag line that prints an identifying value still have a rule?
#
# A bug report is filed as a PUBLIC GitHub issue and carries the device's own /status, /values and
# /diag with it (docs/REPORTING.md). That is only defensible because the device redacts first —
# `GET /status?redact=1` and `GET /diag?redact=1`, main/logic/redact.hpp. There is no second private
# channel behind it and no human reviewing each report before it is posted, so this redaction is the
# ONLY control, and its /diag half is an ALLOWLIST of specific log statements.
#
# An allowlist falls behind silently. A new diag_printf that interpolates a hostname or an SSID
# simply is not covered, and the symptom is a correct-looking log line with a real value in it —
# there is nothing to notice, no error, no failing test. This catches the shape: a diag line whose
# arguments carry a config or board-identity value, with no matching rule. On its first run it found
# `mqtt: retired legacy HA device %s` printing the unique half of the MAC that /status was busy
# redacting.
#
# It is a heuristic on identifier names, not a proof. It catches the failure that occurs — someone
# adds a log line for a value they are debugging — and not a value laundered through an unrelated
# local first. tools/redact/selftest.sh proves it still catches both defects it was built for.
#
# Usage: scripts/run-redaction-audit.sh [--list]
# Exit:  0 = clean, 1 = findings, 2 = usage/runtime error. Needs only python3.
set -euo pipefail
cd "$(dirname "$0")/.."

# Fail loudly rather than skip: a gate that quietly does nothing when its runtime is missing is
# worse than no gate, because the green check still gets believed.
if ! command -v python3 >/dev/null 2>&1; then
    echo "run-redaction-audit: need python3. CI's ubuntu-latest ships it; on macOS it is preinstalled" >&2
    exit 2
fi

exec python3 tools/redact/check_diag_coverage.py "$@"
