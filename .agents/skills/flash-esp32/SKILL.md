---
name: flash-esp32
description: Build (via the CI-pinned ESP-IDF Docker image) and USB-flash the firmware to a connected ESP32, preserving NVS. Use when the user asks to flash/build-and-flash a board on the local tree.
---

# flash-esp32

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

An explicit request to flash a board with this skill authorizes one unchained host signing command
that passes the offline key by path, and the unchanged repository flash plan (`build/flash_args`:
bootloader, the unchanged partition table, `otadata`, `ota_0`; `nvs` and `coredump` untouched) on
the one identified target. `erase_flash`, NVS erasure, a partition table that differs from the one
the target runs, and coredump clearing need separate explicit authorization.

Which board may receive what (`AGENTS.md`):
- A board outside the private inventory that the user names: any local head.
- The inventory `bench`: a local head only as a pre-merge test under the `$deploy-test` rules
  (identity, version floor, plan check, verification); otherwise bootstrap or recovery.
- The inventory `production`: bootstrap or recovery only.

An official dev artifact reaches a bench that can take an OTA through `$deploy-prod`'s OTA gate,
never through this skill.

Build the current tree for a target and flash it from the host, preserving NVS (WiFi/service
settings and the X10A link cache survive; detected model identity stays RAM-only and is
re-established after boot). Docker builds, host `esptool` flashes (Docker Desktop has no USB
passthrough).

## Steps

1. **Identify the target.** The target chip is always `esp32s3` (both documented boards — XIAO
   ESP32-S3 and M5Stack AtomS3 Lite — are esp32s3 with native USB-Serial/JTAG). List the candidates
   (`ls /dev/cu.usbmodem* /dev/cu.usbserial*`) and require exactly one port whose MAC
   (`esptool --port <port> chip-id`, compared case-insensitively) is the board the user named. Every
   esptool connection resets the probed chip, so probe only ports that can be the target. A port
   name alone is not an identity: several boards, including other projects' boards, can enumerate on
   the same path. If the board runs another project's firmware, stop and ask.
2. **Build** via the CI-pinned image:
   ```bash
   scripts/idf-docker.sh idf.py build
   ```
3. **Sign the app — REQUIRED, do not skip.** This build config uses the Secure Boot v2 signature
   scheme (`CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`), so an **unsigned** image
   **crash-loops at boot** (`esp_secure_boot_init_checks` abort, before `app_main`) — see
   [docs/SECURITY.md](../../../docs/SECURITY.md). Sign with the offline RSA-3072 key
   (`ota_signing_key.pem`, never in the repo; set `OTA_SIGNING_KEY_FILE=/path/to/key.pem` or pass your
   offline key path). Pass the signing command on its own and on one line — no pipe, chain,
   substitution or backslash continuation; the hook rejects a signing command that contains a newline:
   ```bash
   espsecure sign-data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
   ```
   (`espsecure.py sign_data` on esptool 4.x.) `--keyfile` must be the literal
   `"$OTA_SIGNING_KEY_FILE"` or a path whose file name is `ota_signing_key.pem` or
   `daikin_ota_signing_key.pem`; the hook admits no other key file name or position. Then, as a
   separate command, point `@flash_args` at the signed image:
   ```bash
   cp build/daikin-signed.bin build/daikin-altherma-esp32.bin
   ```
   **No key on hand?** You cannot produce a bootable local image: report local flashing as
   unavailable. For bootstrap or recovery without a key, the browser installer (`docs/index.html`)
   writes the signed official image with its complete flash plan; do not hand-write a one-part
   `ota_0` image, because `otadata` may still select `ota_1`. Never disable the signature
   requirement; step 4 refuses every image that the pinned key did not sign.
4. **Guard — refuse to flash an unsigned image.** Run the check before touching the chip; it exits
   non-zero (and prints the exact signing command) if the image is unsigned, so a crash-looping board
   is prevented rather than diagnosed after the fact:
   ```bash
   scripts/require-signed.sh build/daikin-altherma-esp32.bin
   ```
5. **Flash** from the host (preserves nvs — `@flash_args` skips `nvs@0x9000`). First confirm that
   no part of `build/flash_args`, rounded up to the 4 KiB erase sector, overlaps the `nvs` or
   `coredump` partitions, and that `partitions.csv` matches the table the target runs; a differing
   table needs separate explicit authorization. Repeat the step-1 identity check immediately before
   the write. Keep the directory change inside a subshell so the verification command still runs
   from the repository root:
   ```bash
   (cd build && esptool --chip esp32s3 -p <port> write-flash "@flash_args")
   ```
6. **Verify.** After reboot and any initial network provisioning, use the resolved host of the board
   just flashed, never a shared mDNS name that may resolve to another board. Prove the identity by
   `/status.app_elf_sha256` (a 9-hex prefix) or the serial boot line `ELF file SHA256` against
   `shasum -a 256 build/daikin-altherma-esp32.elf`, and pin the expected build version and ELF SHA:
   ```bash
   scripts/verify-device-health.sh --ip <flashed-board-host> --expected-version <version> --expected-elf-sha <elf-sha-prefix> --timeout 60
   ```
   MQTT must connect when configured; an explicitly unconfigured broker is accepted as disabled.
   Add `--require-hp` when the board is wired to a heat pump and X10A behavior is in the requested
   scope. Serial logs (`screen <port> 115200`, exit `Ctrl-A K`) supplement the API result; they do
   not replace version, crash, safe-mode, heap or requested link verification.

## Self-analysis and cleanup

Before concluding the flash operation:
   - Confirm clean boot from `/status`: verify `.last_crash.fault == false` (or null), `.sys.safe_mode == false`, a `.sys.reset_reason` that is not a fault (`usb`, `ext`, `poweron` and `sw` are normal after a USB write), `.sys.heap_restarts == 0` (a heap-watchdog restart also reads `sw`), contiguous heap `.sys.max_alloc >= 10000`, and at least 1 KiB free in every non-null `.sys.stack_min_free_bytes` entry (null means the task was never sampled).
   - Remove `build/daikin-signed.bin` only if this workflow created it as a temporary duplicate.
     Retain requested build, signing and device evidence, and preserve pre-existing user artifacts.

## Notes
- **Unsigned = crash-loop**, not a brick: this scheme burns no eFuses and leaves ROM download mode
  on, so a board that got an unsigned image is recovered by re-flashing a **signed** one (step 3→5).
  The step-4 guard exists so this never happens in the first place. Boot-recovery model +
  auto-rollback details: [docs/SECURITY.md](../../../docs/SECURITY.md) → Boot recovery.
- A fresh board without saved WiFi configuration needs the `daikin-altherma-esp32-setup` portal.
  The ordinary flash plan preserves NVS on both first and later flashes.
- A full-erase recovery is destructive and outside an ordinary flash. Use `erase_flash` only after
  separate explicit authorization, a resolved exact target and an NVS backup where applicable.
- This skill does NOT merge or release — it works on the local tree only. The supported merge path
  is `scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT
  repos/0Bu/daikin-altherma-esp32/pulls/<number>/merge -f sha=<full-current-head-sha> -f
  merge_method=squash` once every applicable gate box is ticked and SHA-stamped; see
  [`docs/AGENT_MIGRATION.md`](../../../docs/AGENT_MIGRATION.md) for the full contract and derive
  which gates apply from
  [`tools/agent-hooks/require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) rather
  than a list written down here, which goes stale as gates are added. Releases are cut by CI from
  `main` ([build.yml](../../../.github/workflows/build.yml)).
