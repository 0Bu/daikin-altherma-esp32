---
name: flash-esp32
description: Build (via the CI-pinned ESP-IDF Docker image) and USB-flash the firmware to a connected ESP32, preserving NVS. Use when the user asks to flash/build-and-flash a board on the local tree.
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
3. **Flash** from the host (preserves nvs — `@flash_args` skips `nvs@0x9000`):
   ```bash
   cd build && esptool --chip <target> -p <port> write_flash "@flash_args"
   ```
4. **Verify.** After reboot, `curl http://daikin-altherma-esp32.local/status | jq .version` (or read
   the serial log: `screen <port> 115200`, exit `Ctrl-A K`). Confirm WiFi/MQTT/hp status.

## Notes
- First flash of a fresh board erases NVS → set up WiFi via the `daikin-altherma-esp32-setup` portal.
- A full-erase recovery: `esptool --chip <target> -p <port> erase_flash` then reflash.
- This skill does NOT merge/release — that's the `ship` skill. It works on the local tree only.
