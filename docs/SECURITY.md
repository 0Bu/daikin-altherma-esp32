# Security model

daikin-altherma-esp32 is a **trusted-LAN** device. It reads a heat pump and mirrors the values to
Home Assistant; it has no internet-facing surface by design. This document is the threat model
and the OTA-signing / key lifecycle.

## Trust boundary

- **The HTTP API and web UI have no authentication or TLS.** This is deliberate — the device is
  meant to sit on a trusted home LAN. Anyone who can reach `http://daikin-altherma-esp32.local` can read
  values and change the configuration. **Never expose it to the internet.** If you need access
  control, front it with a reverse proxy or put it on an isolated VLAN.
- **The heat-pump link is read-only.** The firmware only polls X10A registers; the X10A protocol
  has no write command, so the firmware cannot change the heat pump's settings or actuate it in any
  way. There are no control outputs.
- **Home Assistant integration is read-only** — the MQTT bridge subscribes to no command topics.
- **MQTT credentials are never sent in cleartext.** If an MQTT username/password is configured, the
  bridge requires an `mqtts://` broker URI and verifies the broker against the mbedTLS certificate
  bundle; a non-TLS URI with credentials is **refused** (the reason shows in `/status.mqtt`) rather
  than falling back to plaintext. A credential-free broker may be plaintext on the trusted LAN.

## Credential storage

WiFi and MQTT credentials live in NVS (`daik_cfg`), **unencrypted by default**. On a factory
ESP32-S3 the flash is dumpable over USB, so treat physical access as full access. To harden a
deployed device, enable **Flash Encryption + NVS Encryption** (irreversible; do it deliberately) —
this also prevents reading the config off a stolen board.

## OTA image signing

> **Implementation status.** The *flash-time* signing described here and the **rollback health gate**
> are implemented and host-tested. The **pull-OTA path itself — manifest check, image download, and
> the downgrade gate — is not yet implemented**: `ota_update.cpp`'s `ota_check_async` /
> `ota_update_async` are TODO stubs. The signature-verify-on-update and downgrade-gate points below
> describe the intended design that lands with that path, not current runtime behaviour.

OTA updates are **signed** (Secure Boot v2 RSA-3072 signature scheme *without* hardware Secure
Boot): the running app verifies the RSA signature of a downloaded image before installing it, so a
compromised update host (or its GitHub Pages source) cannot push unsigned or tampered firmware.

- **No eFuses are burned** — this is reversible, has no brick risk, and the browser installer /
  USB flash path keeps working. The bootloader does **not** verify on boot; only the running app
  verifies the *next* OTA image.
- **Trust is bootstrapped TOFU** — the first signed image reaches a device from the current
  unsigned build (which doesn't verify) or via USB; from then on every OTA image must be signed
  with the same offline key.
- **Downgrade gate** *(planned — not yet implemented)* — before the bulk download, the running app
  reads the incoming image's own version and refuses anything not strictly newer. A signature proves
  authenticity, not freshness.
- **Rollback health gate** *(implemented)* — a freshly-flashed image stays `PENDING_VERIFY` until it
  has run healthily for ~90 s (`ota_update.cpp`, `logic/health_gate.hpp`), so a boots-but-crashes
  image is reverted.

The classic ESP32 needs chip revision **v3.0+ (ECO3)** for the V2 RSA scheme
(`CONFIG_ESP32_REV_MIN_3` in `sdkconfig.defaults.esp32`); s3/c3/c6/c5 support it at their default min
revision.

## Boot recovery (anti-brick)

A signed-app build has a sharp edge: **an unsigned app does not boot.** It aborts in
`check_signature_on_update_check()` (ESP-IDF `bootloader_support`, called from `esp_efuse_startup`)
**before `app_main`** — the running app verifies it carries a signature block so it can vouch for the
*next* OTA, and `abort()`s if it doesn't. Because this is pre-`app_main`, **no firmware code can
intercept it** (not the health gate, not a recovery handler); only the bootloader can pick a
different image, and only if a good one still exists on the chip.

Three failure modes, and what recovers each:

| # | How a bad image arrives | Auto-recovery |
|---|---|---|
| 1 | **OTA** installs an image that boots but is broken/crashes | ✅ dual-OTA + `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` + the health gate. The image boots `PENDING_VERIFY`; it must prove healthy or the bootloader reverts to the previous slot. |
| 2 | **OTA** installs an *unsigned/tampered* image | ✅ by design — `esp_https_ota` verifies the RSA signature before it ever writes/activates the slot. *(The pull-OTA download is currently a TODO stub, so no OTA image installs yet; this is the behaviour that lands with it.)* |
| 3 | **Direct USB / Web-Serial flash** of an unsigned (or early-crashing) build | ⚠️ not auto-recoverable — see below. Prevented instead by `scripts/require-signed.sh`. |

### Why mode 3 can't roll back — and how it's contained

The rollback in mode 1 works because the *previous* firmware is still intact in the other OTA slot
and otadata marks the new one `PENDING_VERIFY`. A **full `@flash_args` USB flash does neither**: it
rewrites the bootloader, partition table and **otadata (blanked to `0xFFFFFFFF`)** and writes only
`ota_0`. After it, `ota_1` is empty and otadata is blank → the bootloader boots `ota_0` in
`ESP_OTA_IMG_UNDEFINED` state (not `PENDING_VERIFY`), and **there is no previous firmware anywhere on
the chip to fall back to.** So for a directly-flashed unsigned build, "boot the previous FW" is
mechanically impossible regardless of mechanism — the previous FW was overwritten.

This is **never a brick**: no eFuses are burned and ROM download mode stays enabled, so the board is
always re-flashable over USB. The containment is therefore *prevention*, not recovery:

- **`scripts/require-signed.sh <app.bin>`** refuses to flash an unsigned image (it parses
  `espsecure signature-info-v2`) and prints the signing command. The `flash-esp32` skill and the
  CLAUDE.md flash steps run it before `esptool write_flash`, so the mode-3 crash-loop is stopped at
  the source. Recovery from a board that already got an unsigned image = re-flash a **signed** one.

### The health gate (mode 1)

`ota_health_gate_arm()` (`ota_update.cpp`) starts a task that runs **only** for a `PENDING_VERIFY`
image — i.e. one installed via `esp_ota_*` (a real OTA), which always leaves a valid previous slot.
It commits the image (`esp_ota_mark_app_valid_cancel_rollback()`) only once it has proven **healthy**,
not merely survived a timer: it must run past a base window (~90 s — survives an early crash-loop) AND
reach connectivity (STA online, or the setup portal when no credentials are stored). An update that
boots but can't get online — e.g. a WiFi regression that could never be re-flashed OTA — is left
`PENDING_VERIFY` up to a hard cap (~10 min, forgiving of a briefly-offline site); the next reboot
then rolls it back to the previous firmware. The decision is the host-tested `daik::health_gate_decide()` in `main/logic/health_gate.hpp`
(covered by `test/test_logic.cpp`). A USB/`@flash_args` image is `UNDEFINED`, never `PENDING_VERIFY`,
so the gate is a no-op for it and can never strand a fresh board.

> **Manual updates and rollback:** only the OTA path (`esp_ota_*`, which writes the *inactive* slot
> and arms `PENDING_VERIFY`) is auto-rollback-protected. A host `esptool` flash overwrites the running
> slot in place and cannot roll back — which is why the signed-image guard gates that path instead.

## Signing key lifecycle

- The private key is an **RSA-3072 PEM** kept **offline**. It is never committed (`.gitignore`
  blocks `*.pem`) and, in CI, exists only transiently: `build.yml` writes it from the
  `OTA_SIGNING_KEY` repository secret, `ci-build-all.sh` signs each image, and a `always()` step
  shreds it.
- **Fork PRs get no secret** → they build **unsigned** (a compile check only) and publish **no**
  preview (an unsigned image would crash-loop at boot on a signed-build device).
- **Main never publishes unsigned** — if the secret is missing on a main build, CI hard-errors
  rather than shipping an image devices would reject.
- **Rotation:** generate a new key, flash a build signed with it via USB (breaking TOFU
  intentionally), update the `OTA_SIGNING_KEY` secret. Devices on the old key must be USB-reflashed
  once to adopt the new trust anchor.

  ```bash
  # Generate an OTA signing key (RSA-3072)
  espsecure.py generate_signing_key --version 2 --scheme rsa3072 ota_signing_key.pem
  ```

## Reporting

Found a security issue? Open a GitHub issue for non-sensitive reports, or contact the maintainer
privately for anything exploitable. There is no bug bounty — this is a hobby project.
