# GitHub Copilot & Codex Instructions

You are assisting development on **`daikin-altherma-esp32`**, an ESP-IDF firmware for the ESP32-S3 microcontroller that decodes Daikin Altherma heat pump telemetry via X10A serial and publishes to Home Assistant over MQTT.

---

## 1. Single Source of Truth (`.ai/`)

Always refer to the central documentation in [`.ai/`](../.ai/):
- **Workflows & Commands:** [`.ai/commands.md`](../.ai/commands.md) — Host tests, build, signing, flashing, debug tools.
- **Conventions & Safety:** [`.ai/conventions.md`](../.ai/conventions.md) — Coding conventions, FreeRTOS tasks, heap/stack rules.
- **Architecture & APIs:** [`.ai/architecture.md`](../.ai/architecture.md) — Component map, memory layers, HTTP API contracts.
- **Domain Logic:** [`.ai/domain.md`](../.ai/domain.md) — X10A protocol, converter IDs, plausibility rules, plant diagnostics.

---

## 2. Core Implementation Guidelines for Code Generation

1. **Target:** ESP32-S3 (`esp32s3` only), C++17/20, ESP-IDF 6.x.
2. **Logic Separation:** Keep parsing, decoding, and math in header-only files in `main/logic/`. Provide host unit tests in `test/test_logic.cpp`. Never embed hardware-independent logic inside hardware driver `.cpp` files.
3. **Memory Safety & OOM:**
   - Contiguous internal DRAM (`MALLOC_CAP_INTERNAL`) is extremely limited.
   - Do NOT allocate large contiguous `std::string` buffers; use chunked streaming.
   - Assemble JSON via successive `+=` appends, never chained `a + b + c + ...` additions.
   - Wrap FreeRTOS task loop bodies in `try ... catch` exception blocks.
   - NEVER allocate memory or perform throwing operations inside a mutex critical section.
4. **NVS Storage:** Use atomic blob saves (`logic/config_store.hpp`) for credentials; never mutate NVS partition offset `0x9000` or size. All setters in `nvs_storage.cpp` are `[[nodiscard]]`.
5. **Secure Boot v2:** Generated binaries must be signed with `espsecure.py` before flashing.
