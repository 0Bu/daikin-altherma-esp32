#!/usr/bin/env bash
# SessionStart hook: print what this environment can and cannot do, so a session knows up front
# whether it can build/flash or is edit/review/CI-only (a cloud sandbox has no Docker daemon and
# no USB passthrough). Advisory only — never fails the session.
set -u

say() { printf '  %s\n' "$1"; }

echo "daikin-altherma-esp32 — environment capabilities:"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    say "✓ Docker daemon — firmware builds via scripts/idf-docker.sh work"
else
    say "✗ No Docker daemon — cannot build firmware here (edit/review/CI only)"
fi

if command -v esptool >/dev/null 2>&1; then
    ports=$(ls /dev/cu.usbmodem* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | tr '\n' ' ')
    [ -n "$ports" ] && say "✓ esptool + serial port(s): $ports" || say "~ esptool present, no board detected"
else
    say "✗ No esptool — cannot USB-flash here"
fi

if command -v cmake >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1; then
    say "✓ Host toolchain — scripts/run-mock-tests.sh (logic tests) works: the real local loop"
else
    say "✗ No host C++ toolchain — even the mock tests can't run"
fi

exit 0
