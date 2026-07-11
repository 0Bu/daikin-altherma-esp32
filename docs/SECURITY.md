# Security model

daikin-altherma-esp32 is a **trusted-LAN** device. It reads a heat pump and mirrors the values to
Home Assistant; it has no internet-facing surface by design. This document is the threat model
and the OTA-signing / key lifecycle.

## Trust boundary

- **The HTTP API and web UI have no authentication or TLS.** This is deliberate — the device is
  meant to sit on a trusted home LAN. Anyone who can reach `http://daikin-altherma.local` can read
  values and change the configuration. **Never expose it to the internet.** If you need access
  control, front it with a reverse proxy or put it on an isolated VLAN.
- **The heat-pump link is read-oriented.** The firmware polls X10A registers; it cannot change the
  heat pump's internal settings. The only outputs are the **optional** control relays (thermostat
  on/off, SG-Ready), which are off unless you wire and enable them.
- **Home Assistant integration is read-only** — the MQTT bridge subscribes to no command topics.

## Credential storage

WiFi and MQTT credentials live in NVS (`daik_cfg`), **unencrypted by default**. On a factory
ESP32-S3 the flash is dumpable over USB, so treat physical access as full access. To harden a
deployed device, enable **Flash Encryption + NVS Encryption** (irreversible; do it deliberately) —
this also prevents reading the config off a stolen board.

## OTA image signing

OTA updates are **signed** (Secure Boot v2 RSA-3072 signature scheme *without* hardware Secure
Boot): the running app verifies the RSA signature of a downloaded image before installing it, so a
compromised update host (or its GitHub Pages source) cannot push unsigned or tampered firmware.

- **No eFuses are burned** — this is reversible, has no brick risk, and the browser installer /
  USB flash path keeps working. The bootloader does **not** verify on boot; only the running app
  verifies the *next* OTA image.
- **Trust is bootstrapped TOFU** — the first signed image reaches a device from the current
  unsigned build (which doesn't verify) or via USB; from then on every OTA image must be signed
  with the same offline key.
- **Downgrade gate** — before the bulk download, the running app reads the incoming image's own
  version and refuses anything not strictly newer. A signature proves authenticity, not freshness.
- **Rollback health gate** — a freshly-flashed image stays `PENDING_VERIFY` until it has run
  healthily for ~90 s (`ota_update.cpp`), so a boots-but-crashes image is reverted.

The classic ESP32 needs chip revision **v3.0+ (ECO3)** for the V2 RSA scheme
(`CONFIG_ESP32_REV_MIN_3` in `sdkconfig.defaults.esp32`); s3/c3/c6 support it at their default min
revision.

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
