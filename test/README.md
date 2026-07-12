# Host logic tests

The riskiest parts of this firmware are pure computations — the X10A **CRC**, the value
**converters** (a wrong sign/scale/endianness silently corrupts a reading), register extraction,
the **config model / validation**, and the **HA-discovery payloads**. They all live in IDF-free
headers under [`main/logic/`](../main/logic), so they can be compiled and run on the host with
the plain system toolchain — no ESP-IDF, no Docker, no board.

This is the **real local verification loop**: a cloud Claude Code session can't build firmware or
USB-flash, but it *can* run these in seconds and know a decode/config change is correct.

## Run

```bash
scripts/run-mock-tests.sh
```

Uses `cmake` + `ctest` when present, else a direct `g++`/`clang++` compile of the single
translation unit ([`test_logic.cpp`](test_logic.cpp)) with `-std=c++17 -Wall -Wextra -Werror`.
CI runs the same thing as the `logic-test` job, gating the per-target firmware builds — a logic
regression fails in seconds instead of after four ESP-IDF builds.

## Covered

- `logic/crc.hpp` — checksum, request framing (protocol I/S), reply-length, error reply.
- `logic/registers.hpp` — little-endian signed/unsigned value reads, bounds.
- `logic/convert.hpp` — numeric converters + the refrigerant pressure→temperature curve + the
  HA unit/device_class hints.
- `logic/config_model.hpp` — pin/interval/protocol validation, RX/TX collision.
- `logic/board_pins.hpp` — per-target usable X10A GPIO lists (sorted, in range; the XIAO ESP32-S3
  reference set excludes not-broken-out pins).
- `logic/discovery.hpp` — object-id slugging + the discovery config JSON.
- `def/registry.hpp` — profile lookup + generic fallback.

## Adding a test

1. Put the logic in the right `main/logic/*.hpp` (IDF-free — no `esp_*`, no FreeRTOS). The device
   `.cpp` must be a thin wrapper that calls it, never a second copy.
2. Add a `CHECK(...)` in `test_logic.cpp` asserting against a known-good reference (for converters,
   a known-good reference output for the same raw bytes; for CRC, a real captured frame).
3. `scripts/run-mock-tests.sh` — must pass (the Stop hook and CI enforce it).

See the `add-logic-test` skill (`.claude/skills/add-logic-test/`).
