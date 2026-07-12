---
name: flash-esp32
description: Build (via the CI-pinned ESP-IDF Docker image) and USB-flash the firmware to a connected ESP32, preserving NVS. Use when the user asks to flash/build-and-flash a board on the local tree.
model: sonnet
---

# flash-esp32

Build the current tree for a target and flash it from the host, preserving NVS (WiFi + model
config survive). Docker builds, host `esptool` flashes (Docker Desktop has no USB passthrough).

## Steps

1. **Confirm the target and port.** Ask the chip (`esp32`/`esp32s3`/`esp32c3`/`esp32c6`/`esp32c5`) if
   unclear; the reference board is the XIAO ESP32-S3. Detect the port: `ls /dev/cu.usbmodem*`.
2. **Build** via the CI-pinned image:
   ```bash
   scripts/idf-docker.sh sh -c 'if [ -f sdkconfig ]; then idf.py build; else idf.py set-target <target> build; fi'
   ```
3. **Sign the app — REQUIRED, do not skip.** This build config uses the Secure Boot v2 signature
   scheme (`CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`), so an **unsigned** image
   **crash-loops at boot** (`esp_secure_boot_init_checks` abort, before `app_main`) — see
   [docs/SECURITY.md](../../../docs/SECURITY.md). Sign with the offline RSA-3072 key
   (`ota_signing_key.pem`, never in the repo), then point `@flash_args` at the signed image:
   ```bash
   espsecure.py sign_data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" \
     --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
   cp build/daikin-signed.bin build/daikin-altherma-esp32.bin   # @flash_args flashes this path
   ```
   (newer esptool: `espsecure sign-data` with a hyphen.) **No key on hand?** You cannot produce a
   bootable image locally — pull a signed build from CI, or, for a throwaway dev board only, rebuild
   with the signature requirement off (`sdkconfig.defaults` `..._NO_SECURE_BOOT` flags → `n`).
4. **Guard — refuse to flash an unsigned image.** Run the check before touching the chip; it exits
   non-zero (and prints the exact signing command) if the image is unsigned, so a crash-looping board
   is prevented rather than diagnosed after the fact:
   ```bash
   scripts/require-signed.sh build/daikin-altherma-esp32.bin
   ```
5. **Flash** from the host (preserves nvs — `@flash_args` skips `nvs@0x9000`):
   ```bash
   cd build && esptool --chip <target> -p <port> write_flash "@flash_args"
   ```
6. **Verify.** After reboot, `curl http://daikin-altherma-esp32.local/status | jq .version` (or read
   the serial log: `screen <port> 115200`, exit `Ctrl-A K`). Confirm WiFi/MQTT/hp status.

## Notes
- **Unsigned = crash-loop**, not a brick: this scheme burns no eFuses and leaves ROM download mode
  on, so a board that got an unsigned image is recovered by re-flashing a **signed** one (step 3→5).
  The step-4 guard exists so this never happens in the first place. Boot-recovery model +
  auto-rollback details: [docs/SECURITY.md](../../../docs/SECURITY.md) → Boot recovery.
- First flash of a fresh board erases NVS → set up WiFi via the `daikin-altherma-esp32-setup` portal.
- A full-erase recovery: `esptool --chip <target> -p <port> erase_flash` then reflash.
- This skill does NOT merge/release — that's the `ship` skill. It works on the local tree only.
