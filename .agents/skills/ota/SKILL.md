---
name: ota
description: Build, sign and upload the current daikin-altherma-esp32 working tree via /ota/upload for an explicitly requested quick HTTP OTA test on any board on the dev channel.
---

# Quick local OTA

Use `$ota` for an explicitly requested local HTTP OTA test on any named or agreed board (`bench`,
`production`, or an explicit board IP/hostname). Follow
[Local dev OTA tests](../../../docs/MAINTENANCE.md#local-dev-ota-tests).

## Authorization boundary

Editing or reading this skill is read-only. An explicit local OTA test request authorizes building
the current checkout, signing on the host by key path, and sending one `POST /ota/upload` via
`scripts/dev-ota-upload.py` to the requested board while its saved channel is already `dev`.
Changing a board's saved channel, pushing, opening PRs, merging or official feed promotion requires
separate explicit authorization.

## Steps

1. **Build** the current working tree for `esp32s3` with the pinned Docker toolchain:
   ```bash
   scripts/idf-docker.sh idf.py -B build/local-ota -D IDF_TARGET=esp32s3 -D SDKCONFIG=/project/build/local-ota/sdkconfig build
   ```
2. **Sign on the host** by key path to a unique `.bin` file (one unchained line; `--keyfile` must be
   `"$OTA_SIGNING_KEY_FILE"` or an offline path ending in `ota_signing_key.pem` or
   `daikin_ota_signing_key.pem`; use `espsecure.py sign_data` on esptool 4.x) and compute its
   SHA-256:
   ```bash
   espsecure sign-data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" --output build/local-ota/signed-<attempt-id>.bin build/local-ota/daikin-altherma-esp32.bin
   shasum -a 256 build/local-ota/signed-<attempt-id>.bin
   ```
3. **Upload once** with the direct, unchained repository uploader. Pass `--target bench`,
   `--target production`, or `--target <board-ip-or-host>` (add `--expected-mac <AA:BB:CC:DD:EE:FF>`
   when binding MAC explicitly or when targeting the shared `daikin-altherma-esp32.local` mDNS
   name). Omit `--execute` for a read-only preflight; include `--execute` for the authorized upload:
   ```bash
   scripts/dev-ota-upload.py --target <bench|production|ip-or-host> --image /absolute/path/build/local-ota/signed-<attempt-id>.bin --expected-app-sha256 <64-lowercase-hex> --execute
   ```
   Boards addressed by IP/hostname do not require a local `production-ota.json` inventory file;
   their live MAC is pinned during preflight and verified across reboot.
4. **Verify and report.** Confirm the distinct `boot_id`, `pending_verify` to `valid` probation
   acceptance, heap/stack health, and requested behavior within the authorized scope.

A quick local OTA requires no Codex CLI, source receipt, clean commit, published feed or
independent review. Run the applicable host tests, audits and reviews before push.

## Self-analysis

Distinguish HTTP 200 upload validation from the observed reboot, probation acceptance and requested
plant/UI behavior. After a failed or uncertain attempt, inspect `/ota/status` and `/status`
read-only and never resend.
