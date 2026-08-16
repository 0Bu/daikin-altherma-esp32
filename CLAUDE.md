# Claude Code Configuration (`CLAUDE.md`)

ESP-IDF 6.x firmware for the ESP32-S3 microcontroller (`daikin-altherma-esp32`). Communicates with Daikin Altherma heat pumps via the X10A service port and bridges data to Home Assistant via MQTT Discovery.

> **Single Source of Truth:** Detailed AI knowledge is modularized under [`.ai/`](.ai/):
> - [`.ai/commands.md`](.ai/commands.md) — Complete build, test, audit, flash, and debug commands
> - [`.ai/conventions.md`](.ai/conventions.md) — Coding conventions, memory safety, NVS rules, and review gates
> - [`.ai/architecture.md`](.ai/architecture.md) — Component map, memory architecture, flash layout, and HTTP API (trusted-LAN route count (36))
> - [`.ai/domain.md`](.ai/domain.md) — X10A protocol, converter semantics, physical correctness, and checkup logic
> - [`AGENTS.md`](AGENTS.md) — Universal multi-agent entry point

---

## Fast Command Reference

```bash
# 1. Host Verification Loop (Run before opening PRs - no hardware needed)
scripts/run-mock-tests.sh --coverage   # host logic tests + 95% coverage floor
scripts/run-contract-tests.sh          # source boundary contract tests
scripts/run-domain-audit.sh            # physical domain correctness audit
scripts/run-description-audit.sh       # documentation entity descriptions
scripts/run-schematic-audit.sh         # UI SVG schematic audit
scripts/run-ui-use-case-tests.sh       # UI use-case contract tests
scripts/run-redaction-audit.sh         # bug report PII redaction audit
scripts/run-claude-md-budget.sh        # agent instruction byte-budget check

# 2. Firmware Build & Signing (Docker, target esp32s3 only)
scripts/idf-docker.sh idf.py build
espsecure.py sign_data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" \
  --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
cp build/daikin-signed.bin build/daikin-altherma-esp32.bin
scripts/require-signed.sh build/daikin-altherma-esp32.bin

# 3. Flash & Debug (Host)
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
curl http://daikin-altherma-esp32.local/status | jq
curl http://daikin-altherma-esp32.local/values | jq
scripts/decode-coredump.sh coredump.bin

# Key destructive maintenance routes require explicit POST:
# POST /diag/clear      - Erase in-RAM diagnostic log ring
# POST /coredump/clear  - Erase crash dump partition from flash
```

---

## Critical Rules & Invariants

1. **Pure Logic in `main/logic/`:** Place decoding, formatting, and calculation logic in `main/logic/` headers with unit test `CHECK` assertions in `test/test_logic.cpp`.
2. **Never Hand-Edit `main/def/`:** Profiles and signatures in `main/def/` are machine-generated.
3. **Internal Heap & OOM Safety:** The binding constraint is contiguous internal DRAM (`MALLOC_CAP_INTERNAL`). Wrap HTTP handlers in OOM guards (`handle_all` -> 503), build JSON using `+=` (never `a+b+c`), stream large responses, and never allocate while holding a mutex.
4. **NVS Separation:** HTTP handlers commit whole structs via `config_save`; polling tasks use narrow setters (`config_save_link`, `config_set_model`).
5. **Pre-Merge Review Gates:** Use dedicated review skills (`/domain-review`, `/schematic-review`, `/absence-review`, `/ui-use-case-review`, `/project-review`) prior to merging changes.
