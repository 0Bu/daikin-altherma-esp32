# Commands & Workflows

This document outlines all build, test, lint, verification, flashing, and debugging commands for `daikin-altherma-esp32`.

---

## 1. Local Verification Loop (Host Tests)

The firmware logic can be verified completely on the host system using standard system toolchains (`clang++`/`g++`, `node`, `python3`), without hardware or ESP-IDF. Run these before opening a PR:

```bash
# Host logic unit tests + 95% coverage floor + presenter parity
scripts/run-mock-tests.sh --coverage

# Verify coverage floor failure modes
tools/coverage/selftest.sh

# Source boundary & contract tests (Node.js)
scripts/run-contract-tests.sh

# Domain correctness audit (verifies value catalog physical correctness)
scripts/run-domain-audit.sh

# Description audit (verifies user-facing value documentation)
scripts/run-description-audit.sh

# Schematic drawing audit (verifies dashboard SVG connections)
scripts/run-schematic-audit.sh

# UI use-case contract tests (Node.js)
scripts/run-ui-use-case-tests.sh

# Bug report redaction audit (verifies no PII leakage in reports)
scripts/run-redaction-audit.sh

# Documentation entity ID audit (verifies entity IDs in docs exist)
scripts/run-doc-entity-audit.sh

# Claude / Agent instruction byte-budget check
scripts/run-claude-md-budget.sh

# Presenter parity check (C++ vs JS mirror logic)
scripts/check-presenter-parity.sh

# Web installer plan tests
scripts/run-web-installer-plan-tests.sh
```

---

## 2. Firmware Build & Flash (ESP-IDF via Docker)

Builds require Docker and target `esp32s3` exclusively. CI pins ESP-IDF `v6.0.2` (managed components require `>=5.5`).

```bash
# Build firmware (first run sets target; subsequent runs are incremental)
scripts/idf-docker.sh idf.py set-target esp32s3 build

# Incremental build
scripts/idf-docker.sh idf.py build

# Interactive compile-time configuration (Kconfig)
scripts/idf-docker.sh idf.py menuconfig

# Build single gzipped Web UI bundle
scripts/build-pages.sh
```

### Firmware Signing (MANDATORY)
The configuration uses Secure Boot v2 signature validation (`CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`). An **unsigned image crash-loops at boot** (`esp_secure_boot_init_checks` aborts before `app_main`).

```bash
# Sign firmware binary with offline private key
espsecure.py sign_data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" \
  --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
cp build/daikin-signed.bin build/daikin-altherma-esp32.bin

# Pre-flash signature check (fails non-zero if unsigned)
scripts/require-signed.sh build/daikin-altherma-esp32.bin
```

### Flashing to Target Board
Flash from the host via `esptool` (macOS Docker does not support USB passthrough):

```bash
# Flash application (preserves NVS partition at 0x9000)
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"

# Erase NVS partition (factory reset configuration)
esptool --chip esp32s3 -p <port> erase_flash
```

---

## 3. Runtime Inspection & Debugging

```bash
# Serial monitor (115200 baud, native USB-JTAG on ESP32-S3)
screen /dev/cu.usbmodemXXXX 115200

# Query device status snapshot (JSON)
curl http://daikin-altherma-esp32.local/status | jq

# Query decoded real-time values (JSON)
curl http://daikin-altherma-esp32.local/values | jq

# Download core dump from device (if crash occurred)
curl http://daikin-altherma-esp32.local/coredump -o coredump.bin

# Decode and symbolize core dump against ELF
scripts/decode-coredump.sh coredump.bin

# Trigger manual model detection sweep
curl -X POST http://daikin-altherma-esp32.local/detect
```

---

## 4. Stack Frame Measurement

Stack budgets must be checked on the compiled ELF rather than idle heap readings:

```bash
scripts/idf-docker.sh bash -c 'A=$(xtensa-esp32s3-elf-nm build/daikin-altherma-esp32.elf | grep " T _ZN4daik23http_append_status_json" | cut -d" " -f1); xtensa-esp32s3-elf-objdump -d --start-address=0x$A --stop-address=$((0x$A+8)) build/daikin-altherma-esp32.elf | grep entry'
```

---

## 5. CI & PR Workflows

```bash
# Count total CI gate steps
sed -n '/^  gates:/,/^  build:/p' .github/workflows/build.yml | grep -c 'run: \./\(scripts\|tools\)/'

# Watch running GitHub Action workflow
gh run watch <run-id> --exit-status
```
