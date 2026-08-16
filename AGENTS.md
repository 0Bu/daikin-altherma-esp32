# Universal Agent Guide (`AGENTS.md`)

Welcome to **`daikin-altherma-esp32`** — an ESP-IDF firmware for the ESP32-S3 microcontroller that interfaces with Daikin Altherma heat pumps over the X10A serial port and bridges data to Home Assistant via MQTT Discovery.

---

## 1. AI Knowledge Base (`.ai/`)

This project uses a vendor-independent **Single Source of Truth** for AI coding assistants:

| Document | Content & Scope |
|---|---|
| [`.ai/commands.md`](.ai/commands.md) | Host test loops, Docker builds, signing, flashing, device inspection, and debugging commands. |
| [`.ai/conventions.md`](.ai/conventions.md) | Coding style, memory constraints (heap/stack), FreeRTOS rules, NVS persistence, and review gates. |
| [`.ai/architecture.md`](.ai/architecture.md) | Hardware targets, component map (`main/*.cpp`), memory layouts, flash partitions, and HTTP API endpoints. |
| [`.ai/domain.md`](.ai/domain.md) | Daikin X10A protocol, register pages, converter semantics, physical correctness, and plant diagnostics. |

---

## 2. Core Project Invariants (Quick Reference)

1. **Target Chip:** Target is **`esp32s3`** exclusively. Local verification runs on host compiler without hardware via `./scripts/run-mock-tests.sh --coverage`.
2. **Pure Logic in `main/logic/`:** Keep parsing, decoding, and business logic IDF-free in `main/logic/` with unit test coverage in `test/test_logic.cpp`.
3. **No Hand-Editing Generated Tables:** Files under `main/def/` are machine-generated.
4. **Memory Safety First:** Internal DRAM contiguous headroom is the critical resource. Wrap HTTP handlers in OOM guards, avoid big allocations, build JSON with `+=`, and never allocate while holding mutexes.
5. **Secure Boot Signing:** Firmware binaries must be signed with Secure Boot v2 (`espsecure.py`) before flashing; unsigned images crash-loop by design.
6. **Physical Domain Correctness:** Passing software tests does not ensure physical validity on heat pump hardware. Value modifications require domain review.

---

## 3. Fast Verification Commands

Run before submitting any code changes:

```bash
# Run host logic unit tests + code coverage floor (95%)
scripts/run-mock-tests.sh --coverage

# Run source boundary and contract tests
scripts/run-contract-tests.sh

# Run domain correctness audit
scripts/run-domain-audit.sh

# Run UI use-case contract tests
scripts/run-ui-use-case-tests.sh

# Run budget and documentation checks
scripts/run-claude-md-budget.sh
```

---

## 4. Deep-Dive Human Documentation (`docs/`)

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Comprehensive architectural narrative & memory benchmarks
- [`docs/X10A_PROTOCOL.md`](docs/X10A_PROTOCOL.md) — X10A UART wire protocol specification
- [`docs/REGISTERS.md`](docs/REGISTERS.md) — Register map, converter IDs, and enum tables
- [`docs/HOME_ASSISTANT.md`](docs/HOME_ASSISTANT.md) — Home Assistant MQTT entity contract
- [`docs/SECURITY.md`](docs/SECURITY.md) — Threat model, Secure Boot, and OTA signing keys
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Contributor guide and pull request gates
