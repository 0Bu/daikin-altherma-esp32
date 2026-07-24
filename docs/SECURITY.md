# Security model

daikin-altherma-esp32 is a **trusted-LAN** device. It reads a heat pump and mirrors the values to
Home Assistant; it has no internet-facing surface by design. This document is the threat model
and the OTA-signing / key lifecycle.

## Trust boundary

- **The HTTP API and web UI have no authentication or TLS.** This is deliberate — the device is
  meant to sit on a trusted home LAN. Anyone who can reach `http://daikin-altherma-esp32.local` can read
  values and change the configuration. **Never expose it to the internet.** If you need access
  control, front it with a reverse proxy or put it on an isolated VLAN.
- **The open setup AP exposes ONLY the provisioning surface.** When no configured network is
  reachable at boot, the device falls back to an unauthenticated `WIFI_AUTH_OPEN` SoftAP
  (`daikin-altherma-esp32-setup`) so WiFi can be entered from a phone — any radio client in range can
  associate with no credential. On that surface the HTTP server registers **only** `GET /`,
  `GET /index.html`, `GET /scan` and `POST /set_wifi` (plus the captive catch-all, which serves the
  setup page). The full read/config/OTA/MCP API — including `/coredump` and `/diag`, which can carry
  WiFi/MQTT secrets — is **withheld** on the AP and registered only once the device is on the
  configured STA network (the trusted LAN). So a nearby client can join the device to WiFi but cannot
  read a core dump, read live state, or reconfigure it. The boundary is one host-tested policy
  (`logic/http_surface.hpp`) applied at registration time in `http_start()`, which reads the WiFi
  mode (`esp_wifi_get_mode()`) to pick the surface; a withheld GET falls through to the setup page, a
  withheld POST 404s.
- **`GET /coredump` streams a raw crash memory image.** It exists for post-crash diagnostics and is
  subject to the same no-auth trust boundary as the rest of the API — but a core dump is more
  sensitive than the other endpoints: it is an ELF snapshot of task stacks/RAM that **can contain
  secrets** (the WiFi/MQTT passwords and TLS session material that pass through RAM). On the trusted
  LAN this is acceptable; anywhere less trusted it is a remote credential-disclosure vector with no
  physical access needed. A dump is written only when the firmware actually crashes; erase it with
  `GET /coredump?clear=1` once retrieved so a stale image isn't left readable.
  - **The crash *summary* is deliberately not sensitive.** What the firmware surfaces automatically —
    `/status.last_crash`, the web-UI banner, and the retained `<base>/crash` MQTT topic — is
    only the reset reason, the crashed task name, and raw program-counter/backtrace **addresses**.
    Those hold no credentials, so it is safe to publish them to Home Assistant / VictoriaLogs. The
    full memory image stays behind the manual `GET /coredump` pull; the automation never egresses it.
  - **The archived `.elf` reveals symbols, not secrets.** CI keeps the unstripped ELF per build (to
    decode dumps, `scripts/decode-coredump.sh`). It exposes function names and layout — expected for
    an open-source firmware — but contains **no** runtime secrets (WiFi/MQTT credentials live only in
    device NVS, never in the image). Signing still uses the offline OTA key, which is never built into
    or derivable from the ELF.
- **The heat-pump link is read-only.** The firmware only polls X10A registers; the X10A protocol
  has no write command, so the firmware cannot change the heat pump's settings or actuate it in any
  way. There are no control outputs.
- **Home Assistant integration is read-only** — the MQTT bridge subscribes to no command topics.
- **MQTT credentials are never sent in cleartext.** If an MQTT username/password is configured, the
  bridge requires an `mqtts://` broker URI and verifies the broker against the mbedTLS certificate
  bundle; a non-TLS URI with credentials is **refused** (the reason shows in `/status.mqtt`) rather
  than falling back to plaintext. A credential-free broker may be plaintext on the trusted LAN.
- **Syslog forwarding is cleartext, unauthenticated UDP** — opt-in and off by default (empty
  `syslog_host`). When enabled, every diag-log line (WiFi/MQTT/X10A state, timeouts, reset reasons)
  is sent as a plaintext RFC 5424 datagram to the configured host; there is no TLS option, unlike
  MQTT. Once per boot the syslog task additionally replays two record types that are **not** diag-log
  lines (`logic/bootlog.hpp`): a build-identity line (firmware version + `elf_sha256`) and, after a
  fault, the crash records (reset reason, crashed task name, exception PC, raw backtrace PCs). Like
  the MQTT crash topic, these carry **reason/backtrace only — never the raw core dump** (that stays
  on flash behind `GET /coredump`) and never a secret. So the whole flow — diag lines and replay
  alike — carries **no credentials** (no WiFi/MQTT passwords or TLS material pass through it) and is
  operational metadata rather than secret disclosure; it does reveal your firmware version and
  internal code addresses, which is fingerprinting material. Like the rest of the API it assumes the
  trusted LAN. Don't point it at an untrusted collector or across the internet.

## Credential storage

WiFi and MQTT credentials live in NVS (`daik_cfg`), **unencrypted by default**. On a factory
ESP32-S3 the flash is dumpable over USB, so treat physical access as full access. To harden a
deployed device, enable **Flash Encryption + NVS Encryption** (irreversible; do it deliberately) —
this also prevents reading the config off a stolen board.

## OTA image signing

> **Implementation status.** All of it is implemented: flash-time signing, the **rollback health
> gate**, and the **pull-OTA path** (`ota_check_async` / `ota_update_async` in `ota_update.cpp` —
> manifest check, `esp_https_ota` download, signature verify on install, and the downgrade gate).
> The **feed** has preconditions outside the firmware: every publishing step in CI is gated on the
> repository being public, and the Pages source must point at `gh-pages` — with no manifest or image
> served, a check reports "up to date". The trust properties below are runtime behaviour, not intent.

OTA updates are **signed** (Secure Boot v2 RSA-3072 signature scheme *without* hardware Secure
Boot): the running app verifies the RSA signature of a downloaded image before installing it, so a
compromised update host (or its GitHub Pages source) cannot push unsigned or tampered firmware.

- **No eFuses are burned** — this is reversible, has no brick risk, and the browser installer /
  USB flash path keeps working. The bootloader does **not** verify on boot; only the running app
  verifies the *next* OTA image.
- **Trust is bootstrapped TOFU** — the first signed image reaches a device from the current
  unsigned build (which doesn't verify) or via USB; from then on every OTA image must be signed
  with the same offline key.
- **Downgrade gate** *(implemented — `logic/version_cmp.hpp`, host-tested)* — the running app
  refuses anything not strictly newer. A signature proves authenticity, not freshness: without this,
  a compromised host could serve a genuine, correctly-signed **older** image and walk a fleet
  backwards onto an already-fixed vulnerability, and every signature check would pass.

  It is enforced at **two** points, because the manifest and the image are two separately-controlled
  artifacts and only the second one binds:

  1. Against the **manifest's** `version`, before the download starts — cheap, and stops a pointless
     transfer. On its own this is *not* sufficient: it only checks what the host *claims*.
  2. Against the **image's own embedded version** (`esp_app_desc_t`, read via
     `esp_https_ota_get_img_desc()` once the transfer has begun but before anything is committed).
     This is what defeats a host that advertises `9.9.9` in the manifest and serves a signed 1.0.0
     binary. A mismatch between the two is refused outright — CI already verifies that a published
     manifest agrees with the image it ships, so in the field a disagreement is a stale cache or an
     attack, and neither is worth installing.

  Version ordering is numeric, not lexical (`1.10.0 > 1.9.0`), and **fails closed**: an unparseable
  version on either side refuses the update rather than assuming an ordering.
- **Rollback health gate** *(implemented)* — a freshly-flashed image stays `PENDING_VERIFY` until it
  has run healthily for ~90 s (`ota_update.cpp`, `logic/health_gate.hpp`), so a boots-but-crashes
  image is reverted.

The ESP32-S3 supports the V2 RSA scheme at its default minimum revision.

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
| 2 | **OTA** installs an *unsigned/tampered* image | ✅ `esp_https_ota_finish()` verifies the RSA-3072 signature before the slot is ever activated; a failure is surfaced to the UI as "Update rejected: bad signature" and the running image is untouched. |
| 2b | **OTA** installs an authentically-signed but **older** image (downgrade onto a fixed bug) | ✅ the downgrade gate above — checked against the manifest *and* against the image's own embedded version, so a host that lies in the manifest is still refused. |
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
- **`scripts/ci-build-all.sh`** closes the *Web-Serial* half of mode 3, which no host-side guard can
  reach: after building the installer's `-merged.bin` it carves the app back out at the offset
  `flash_args` assigned it and runs `require-signed.sh` on that region. The build fails rather than
  publish an installer image whose app is unsigned, so the browser path cannot hand out a
  crash-looping board.

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

### Config crash-loop recovery (safe mode) — a distinct failure class

The anti-brick model above protects the *firmware image*. It does **nothing** for a bad
*configuration*: both OTA slots read the same `daik_cfg` NVS, so an image rollback keeps the
offending setting (most plausibly wrong RX/TX pins, but any config that crashes a background task at
start-up). Without a separate mechanism the only exit is `esptool erase_flash` over USB — the same
cable-bound recovery the web-UI design exists to avoid.

**Safe mode** (`safe_mode.cpp` over the host-tested `logic/boot_guard.hpp`) is that mechanism. It
counts **crash-only** boots (panic / interrupt-wdt / task-wdt / other-wdt / brownout — a clean or
intentional config-save reboot resets the count, so provisioning never trips it) in the `boot_fails`
NVS key; once `BOOT_FAIL_THRESHOLD` (4) accumulate, the device comes up **minimally** — WiFi + the
web UI + the OTA health gate only, with the X10A poll engine and the MQTT bridge skipped. The user
fixes the config in the browser and reboots; a healthy 30 s of uptime also clears the counter. This
recovers a *config* crash-loop the image health gate cannot, and needs no USB cable.

Security note: safe mode **reduces** the running surface (it starts strictly fewer subsystems) and
adds no new endpoint or privilege — the recovery controls are the same `/set_*` handlers already
present on the trusted LAN. The counter lives in `daik_cfg`, so a factory reset clears it too.

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

Found a security issue?

- **Anything exploitable — report it privately**, via
  [GitHub's private vulnerability reporting](https://github.com/0Bu/daikin-altherma-esp32/security/advisories/new)
  (Security → Advisories → *Report a vulnerability*). That channel is a private advisory draft
  visible only to the maintainer, so a working exploit never sits in a public issue while a fix is
  written.
- **Anything non-sensitive** — a hardening suggestion, a question about the trust boundary, a doc
  correction — is fine as a normal [GitHub issue](https://github.com/0Bu/daikin-altherma-esp32/issues).

Please include the firmware version (`GET /status` → `version`, or the version shown in the web UI)
and, where relevant, the `app_elf_sha256` from the same response — it pins the exact build.

There is no bug bounty and no SLA: this is a hobby project maintained in spare time. Expect a first
response within a couple of weeks, and note that the [trust boundary](#trust-boundary) above is
deliberately "trusted LAN only" — an issue that reduces to *"an attacker already on your LAN can
read the device's HTTP API"* is documented behaviour, not a vulnerability.
