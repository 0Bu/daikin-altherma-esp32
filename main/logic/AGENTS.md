# Pure Logic Invariants (Zero-IDF)

1. **Strict Portability**: Files in `main/logic/` must compile with any standard C++17
   host compiler (GCC, Clang) without ESP-IDF SDK headers (`esp_log.h`, `freertos/*`,
   `nvs.h`, `sdkconfig.h` are strictly forbidden).
2. **Test Enforcement**: Any new function, converter, enum, or validator added here
   MUST have a corresponding `CHECK` in `test/test_logic.cpp`.
3. **No Generated Table Edits**: The per-model X10A profiles in `main/def/`
   (`altherma*.hpp`, `minichiller*.hpp`) are machine-generated catalog outputs. Never edit
   them directly; put overrides in `main/def/overlay.hpp`. The hand-written files there
   (`altherma3_r_erga.hpp`, `altherma4.hpp`, `homehub.hpp`, `protocol_s.hpp`, `registry.hpp`,
   `signatures.hpp`, `overlay.hpp`) are maintained in place — see the `def/` list in
   `docs/ARCHITECTURE.md`.
