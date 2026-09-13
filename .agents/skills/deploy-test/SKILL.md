---
name: deploy-test
description: Build firmware via Docker, sign with local OTA key, update/flash connected test board preserving NVS, and verify device health. Use when asked to flash and test test bench or run local hardware integration test.
---

# deploy-test

## Authorization boundary

Treat review and audit requests as read-only. A request to test or flash the test bench (or `deploy-test`)
authorizes:
- A local Docker firmware build (`scripts/idf-docker.sh idf.py build`)
- Signing the resulting binary with the local offline key `/Users/oleg/Projects/daikin_ota_signing_key.pem`
- Flashing the connected test board over USB (`/dev/cu.usbmodem*`) preserving NVS for bootstrap/recovery
- Running HTTP health checks against the test bench device (`<bench-host>`)
- When errors, test failures, or crashes occur: diagnosing the root cause (`$device-triage`), fixing the code, re-testing, and re-verifying until green (or asking the user if ambiguous)

It does **NOT** authorize:
- Touching, configuring or flashing the production board
- Erasing NVS (`0x9000`), wiping link cache or running `erase_flash`
- Modifying remote GitHub state, creating PRs, merging, or pushing branches

## Target identity

- **Test Device (Bench)**: Configured bench role in private inventory `~/.config/daikin-altherma-esp32/production-ota.json` (or `<bench-host>`).
  `hp.connected` may be `false` because the test bench is not wired to a physical heat pump.

## Delivery mode distinction

- **Ordinary bench updates**: Per AGENTS.md, ordinary bench updates must use the canonical role-bound transaction:
  `scripts/production-ota-gate.py --confirm-bench bench --install-bench`
- **USB bootstrap & recovery**: USB flashing via host `esptool` is reserved for bootstrap (initial provisioning) or recovery (unbootable firmware, partition table repair, or boot loop).

## Steps for USB Bootstrap / Recovery

1. **Confirm the USB port.**
   Locate the connected ESP32-S3 USB serial device:
   ```bash
   ls /dev/cu.usbmodem*
   ```
   If no device is found, verify the USB connection before proceeding.

2. **Build the firmware** using the CI-pinned ESP-IDF Docker container:
   ```bash
   scripts/idf-docker.sh idf.py build
   ```

3. **Sign the application image.**
   This firmware requires Secure Boot v2-compatible RSA-3072 signing. An unsigned image will crash-loop
   at boot before `app_main`:
   ```bash
   espsecure.py sign_data --version 2 --keyfile "/Users/oleg/Projects/daikin_ota_signing_key.pem" \
     --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
   cp build/daikin-signed.bin build/daikin-altherma-esp32.bin
   ```
   *(Note: newer esptool uses `espsecure sign-data` with a hyphen.)*

4. **Verify signature guard.**
   Refuse to flash an unsigned image:
   ```bash
   scripts/require-signed.sh build/daikin-altherma-esp32.bin
   ```

5. **Flash the board via USB** preserving NVS (skips `nvs@0x9000`):
   ```bash
   cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
   ```

6. **Verify health on the bench device.**
   Allow the board to reboot and verify its HTTP API, network, MQTT and crash state:
   ```bash
   scripts/verify-device-health.sh --ip <bench-host> --timeout 60
   ```
   The script asserts:
   - HTTP 200 on `/status` with valid JSON and mandatory fields
   - WiFi connection and valid IP
   - MQTT connection to broker (`.mqtt.connected: true`)
   - Clean boot (`.last_crash: null` or `.last_crash.fault: false`)
   - Safe mode inactive (`.sys.safe_mode: false`)
   - Sufficient contiguous heap headroom (`.sys.max_alloc >= 10000`)

7. **Report.**
   Summarize the build version, ELF SHA, uptime, heap, and test result.

8. **Automated diagnostic and fix loop ("on findings/errors, fix and repeat from start").**
   If a failure occurs during build, flashing, or health verification:
   - **Diagnose root cause (`$device-triage`):**
     Snapshot `/status` and `/diag?verbose=1`:
     ```bash
     curl -sS "http://<bench-host>/status" | jq .
     curl -sS "http://<bench-host>/diag?verbose=1"
     ```
     If a crash occurred (`fault: true`), download the core dump and symbolize it against the local ELF:
     ```bash
     curl -sS "http://<bench-host>/coredump" -o coredump.bin
     scripts/decode-coredump.sh coredump.bin build/daikin-altherma-esp32.elf
     ```
   - **Fix root cause in code:**
     Correct the defect in the firmware code and add or update corresponding host tests in `test/test_logic.cpp` or `main/logic/`.
   - **Re-flash and re-verify:**
     Re-run the cycle from Step 2 (Build -> Sign -> Flash -> Verify) until the bench device is completely healthy.
   - **Ask user on ambiguous issues:**
     If an issue involves hardware failure, ambiguous requirements, or non-deterministic behavior, ask the user for clarification.
