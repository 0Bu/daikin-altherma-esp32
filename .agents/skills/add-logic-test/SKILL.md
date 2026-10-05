---
name: add-logic-test
description: Add host-testable pure logic to main/logic/ and a CHECK in test/test_logic.cpp so a decode/config/discovery change is verified locally and in CI. Use when the user asks to implement or test changes to converters, CRC, config validation, or HA-discovery payloads.
---

# add-logic-test

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

The riskiest parts of this firmware are pure computations (X10A CRC, value converters, config
validation, HA-discovery JSON). They live in IDF-free headers under `main/logic/` so
`scripts/run-mock-tests.sh` can run them on the host in seconds, and CI gates the firmware build
on them (`mechanical_gates` runs the host-logic step, then the required `build` check consumes that
result). Keep that discipline.

## Steps

1. **Put the logic in `main/logic/`** as an `inline`/`constexpr` function in the right header
   (`crc.hpp`, `convert.hpp`, `registers.hpp`, `config_model.hpp`, `discovery.hpp`) — IDF-free
   (no `esp_*`, no FreeRTOS). The device `.cpp` (`hp_comm.cpp`, `hp_convert.cpp`, `config.cpp`,
   `mqtt_ha.cpp`) must be a thin wrapper that *calls* the header, never a second copy.
2. **Add a `CHECK` in `test/test_logic.cpp`.** Assert against a known-good reference — for
   converters, a known-good reference output for the same raw bytes; for CRC, a real captured frame.
3. **Run it:** `scripts/run-mock-tests.sh --coverage` (cmake + g++/clang++, no ESP-IDF). Must pass
   before handoff; run it explicitly and rely on CI as the authoritative repeat. The Codex Stop lifecycle
   hook repeats it through the same runner-neutral core. When parsing wire buffers, URLs, or external
   inputs, also run `scripts/run-sanitizer-fuzz-tests.sh` to prove deterministic safety under ASan/UBSan.
4. When adding a converter, copy the reference maths **verbatim**
   and cite the conv id in a comment — a subtle sign/scale/endianness change silently corrupts a
   reading.

## Self-analysis and test/code self-optimization

Before declaring work complete, analyze and self-optimize the implementation:
   - **Branch and edge-coverage analysis:** Run `scripts/run-mock-tests.sh --coverage` and inspect whether all branches and error paths in the new or modified `main/logic/` header are covered. If branch ratchets or taken/total edge counts regress, add targeted `CHECK` assertions.
   - **Zero-allocation & `constexpr` audit:** Confirm the logic function is strictly `constexpr` or `inline`, header-only, and free of dynamic heap allocations (no `std::string` or dynamic heap containers; use `std::string_view` or fixed-size buffers).
   - **Boundary value audit:** Verify that tests assert edge cases (e.g. empty buffers, zero values, maximum width values, invalid characters, CRC mismatches), not just the happy path.
   - **Self-optimize:** Prune dead branches, remove redundant intermediate variables or copies, and refine both the logic and the tests to be as concise, fast, and robust as possible.
