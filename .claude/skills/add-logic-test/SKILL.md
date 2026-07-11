---
name: add-logic-test
description: Add host-testable pure logic to main/logic/ and a CHECK in test/test_logic.cpp so a decode/config/discovery change is verified locally and in CI. Use when adding or changing converters, CRC, config validation, or HA-discovery payloads.
---

# add-logic-test

The riskiest parts of this firmware are pure computations (X10A CRC, value converters, config
validation, HA-discovery JSON). They live in IDF-free headers under `main/logic/` so
`scripts/run-mock-tests.sh` can run them on the host in seconds, and CI gates the firmware build
on them (`logic-test` job). Keep that discipline.

## Steps

1. **Put the logic in `main/logic/`** as an `inline`/`constexpr` function in the right header
   (`crc.hpp`, `convert.hpp`, `registers.hpp`, `config_model.hpp`, `discovery.hpp`) — IDF-free
   (no `esp_*`, no FreeRTOS). The device `.cpp` (`hp_comm.cpp`, `hp_convert.cpp`, `config.cpp`,
   `mqtt_ha.cpp`) must be a thin wrapper that *calls* the header, never a second copy.
2. **Add a `CHECK` in `test/test_logic.cpp`.** Assert against a known-good reference — for
   converters, a known-good reference output for the same raw bytes; for CRC, a real captured frame.
3. **Run it:** `scripts/run-mock-tests.sh` (cmake + g++/clang++, no ESP-IDF). Must pass before
   stopping (the Stop hook enforces this).
4. When adding a converter, copy the reference maths **verbatim**
   and cite the conv id in a comment — a subtle sign/scale/endianness change silently corrupts a
   reading.
