# Security model

daikin-altherma-esp32 is a **trusted-LAN** device. It reads a heat pump and mirrors the values to
Home Assistant; it has no internet-facing surface by design. This document is the threat model
and the OTA-signing / key lifecycle.

## Trust boundary

- **The HTTP API and web UI have no authentication or TLS.** This is deliberate — the device is
  meant to sit on a trusted home LAN. Anyone who can reach `http://daikin-altherma-esp32.local` can read
  values and change the configuration. **Never expose it to the internet.** If you need access
  control, prefer an isolated VLAN. A reverse proxy works only as a deliberately separate security
  boundary: it must terminate authentication/TLS and CSRF protection, then send upstream requests
  with `Host` set to the device mDNS name/current IP and without an external browser `Origin` or
  cross-site Fetch Metadata. Passing the public proxy Host or `https://` Origin through is rejected
  by the device policy below; merely forwarding port 80 is not supported internet exposure.
- **A browser cannot extend that trust boundary through DNS rebinding or cross-site requests.** On
  the configured LAN, every route accepts `Host` only for the fixed mDNS name or the current
  WiFi/Ethernet IPv4 address. A present `Origin` must independently name one of those identities,
  and cross-site/unknown `Sec-Fetch-Site` values are rejected. Native clients normally send neither
  browser header and continue to work (an HTTP/1.0 probe may omit `Host` too); a Host they do send
  must still name the device. Every body-bearing POST requires `Content-Type: application/json`, so
  a hostile page cannot use a CORS-safelisted form or `text/plain` request to change configuration.
  The captive portal is exempt from the Host check because OS connectivity probes deliberately use
  unrelated Host names; its sole write, `/set_wifi`, still requires JSON.
- **The open setup AP exposes ONLY the provisioning surface.** When no configured network is
  reachable at boot, the device falls back to an unauthenticated `WIFI_AUTH_OPEN` SoftAP
  (`daikin-altherma-esp32-setup`) so WiFi can be entered from a phone — any radio client in range can
  associate with no credential. On that surface the HTTP server registers **only** `GET /`,
  `GET /index.html` and `POST /set_wifi` (plus the captive catch-all, which serves the setup page).
  `GET /scan` is withheld too: the portal takes the SSID as free text and never scans, so nothing is
  lost by not handing an unauthenticated radio client a survey of every AP in range (SSIDs + RSSI —
  a location fingerprint). The full read/config/OTA/MCP API — including `/coredump` and `/diag`, which can carry
  WiFi/MQTT secrets — is **withheld** on the AP and registered only on the configured WiFi/Ethernet
  LAN surface. So a nearby client can join the device to WiFi but cannot read a core dump, read live
  state, or reconfigure it. The boundary is one host-tested policy
  (`logic/http_surface.hpp`) applied at registration time in `http_start()`; a withheld GET falls
  through to the setup page, a withheld POST 404s.
- **The surface is decided by whether that AP is running — not by the WiFi mode.** It used to be
  picked from `esp_wifi_get_mode() == WIFI_MODE_STA`, which was correct while a radio was the only
  way this device could be on a network. With the optional wired transport it is wrong in **both**
  directions, and each direction is a real defect: a board carried by an Ethernet cable never starts
  a station at all, so the mode reads `WIFI_MODE_NULL` and the entire API — including everything
  needed to configure the device — would be withheld from the LAN it is reachable on, with no radio
  to fix that through; while the tempting inverse ("a wire is up, therefore trust") re-opens the
  original hole, because the setup AP can be radiating at the same moment (a cable plugged into a
  board that had already opened its portal) and `esp_http_server` registers routes per **server**,
  not per interface — one open radio client would reach everything. Keying on the AP's own existence
  is the only formulation that is right in both cases: the restricted surface exists *because* an
  unauthenticated radio can associate. `http_surface_for(setup_ap_running)` is host-tested, and
  `test/test_transport_contract.mjs` asserts over source text that nothing reintroduces the mode
  check or opens the portal outside its gate.
- **Why a runtime flag and not two servers.** The stronger construction is to give the portal its
  own HTTP server and never create the full one in that boot, so the protected routes cannot be
  registered at all. This firmware does not do that: both surfaces have shared one server since F01
  was closed by gating registration, and the portal here serves more than the two provisioning
  handlers. The flag is host-tested and pinned over source text instead. Recorded so the choice is
  not re-litigated: splitting the server is a defensible separate change, not a defect in this one.
- **A wired board does not open the setup AP at all.** With a cable holding a lease there is no open
  radio surface on the device, whether or not WiFi credentials are stored — the portal exists to
  collect credentials, and a device already on the LAN needs none.
- **`GET /coredump` streams a raw crash memory image.** It exists for post-crash diagnostics and is
  subject to the same no-auth trust boundary as the rest of the API — but a core dump is more
  sensitive than the other endpoints: it is an ELF snapshot of task stacks/RAM that **can contain
  secrets** (the WiFi/MQTT passwords and TLS session material that pass through RAM). On the trusted
  LAN this is acceptable; anywhere less trusted it is a remote credential-disclosure vector with no
  physical access needed. A dump is written only when the firmware actually crashes; erase it with
  `POST /coredump/clear` once retrieved so a stale image isn't left readable — or with the crash
  banner's **Delete report** (`POST /crash/dismiss`), which erases the same image *and* stops the
  device reporting the crash. All destructive actions are POSTs: they must not be triggerable by a
  link, prefetch or crawler.
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
- **Both links are read-only.** X10A has no write command.
  The optional HomeHub link no longer has one either: its bounded register-54 actuator was **removed**
  when dynamic LWT actuation was retired ([`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md)), so no source
  file contains a write entry point, an FC06/FC16 request builder or an issued write function code,
  and a CI contract test walks every file to keep it that way. No MQTT command subscription,
  writable HA entity, **Modbus** register route/proxy or MCP write tool exists. The trusted-LAN-only
  `POST /hp/query` is a narrower X10A exception: it can issue only the read frame defined by
  `build_request()`, returns raw reply bytes and persists nothing. X10A defines no write command in
  either supported framing, so choosing an arbitrary page does not create actuation. The unauthenticated
  `HA → MQTT/HTTP → raw Modbus → pump` bridge is therefore absent by construction rather than by
  policy — which is what lets the rest of this document accept an unauthenticated surface on a
  trusted LAN. Note the converse: `:502` has no Modbus credential, so OTHER clients on the LAN
  (Onecta, the unit's MMI, evcc) can still write the hub. Segment it.
  - **The HomeHub's own `:502` is the residual surface, and it is not ours to fix.** Modbus TCP on
    port 502 is unencrypted and carries **no Modbus-level credential** — no user, password or token
    (the guide's SKI/QR trust mechanism is EEBUS-only). On a shared LAN any host can in principle
    write to the hub, whatever this firmware does. **Segment or firewall the HomeHub's `:502`** so
    only this device reaches it; TLS `:802` is the hub's only on-wire protection and is out of scope.
    The one initial discovery and the dialog's manual search trust LAN multicast, so they accept only
    responders whose mDNS hostname matches `homehub-*`; a manually entered address is the user's
    trusted-LAN choice. See
    [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md).
- **Home Assistant integration is read-only** — the MQTT bridge subscribes to no command topics.
- **The MCP endpoint is read-only and trusted-LAN-only.** `POST /mcp` exposes exactly
  `get_status` and `get_hp_values`, which mirror the existing `GET /status` and `GET /values`
  snapshots. There is no config-write, heat-pump command, session, SSE stream, or hidden third data
  path behind it; every other tool name is rejected. It inherits the API's deliberate no-auth/no-TLS
  boundary and is withheld entirely on the open setup AP. `GET /mcp` serves only the embedded,
  dependency-free setup page. It makes no network requests and is limited by CSP to
  `connect-src 'none'`. A browser-supplied `Origin` is accepted only for the device's configured
  mDNS hostname or current IP (never merely because it matches `Host`), closing the Streamable-HTTP
  DNS-rebinding path. Never publish the endpoint outside the trusted LAN.
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
> manifest check, heap-bounded `esp_http_client` → `esp_ota` stream, signature validation before
> boot selection, and the downgrade gate).
> The release and development **feeds are live**; the Pages source points at `gh-pages`.
> Publishing does not require a public repository, but note that the resulting **Pages site is
> public regardless** of repo visibility, so the signed images it serves are world-readable (see
> [`README.md`](README.md)). The trust properties below are runtime behaviour, not intent.

OTA updates are **signed** (Secure Boot v2 RSA-3072 signature scheme *without* hardware Secure
Boot): the running app streams the download only into the inactive slot, releases the HTTP/TLS
client and its fixed buffer, then lets `esp_ota_end()` validate the complete image before that slot
can be selected for boot. A compromised update host (or its GitHub Pages source) therefore cannot
activate unsigned or tampered firmware.

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
  2. Against the **image's own embedded version** (`esp_app_desc_t`, copied from the fixed-size
     image-header probe before the first `esp_ota_write()`).
     This is what defeats a host that advertises `9.9.9` in the manifest and serves a signed 1.0.0
     binary. A mismatch between the two is refused outright — CI already verifies that a published
     manifest agrees with the image it ships, so in the field a disagreement is a stale cache or an
     attack, and neither is worth installing.

  Exact production promotion adds a third, byte-level binding: the completed check retains
  `provenance.app_sha256`; update acceptance consumes that version/SHA/channel with the check
  generation, and the OTA task calculates SHA-256 over every received byte. A same-version signed
  replacement therefore cannot pass merely because both embedded version strings still agree.
  The digest must match before `esp_ota_end()` signature validation and boot selection.

  Version ordering is numeric, not lexical (`1.10.0 > 1.9.0`) — including inside a pre-release
  identifier (`-dev.12 > -dev.9`), which is what keeps the dev channel moving forward — and **fails
  closed**: an unparseable version on either side refuses the update rather than assuming an ordering.

  **The one relaxation: an explicit channel switch.** Since releases became manual, a device can
  follow either the `release` or the `dev` feed (`POST /set_ota`). A board on `dev` runs a version
  *ahead* of the last release, so "install the latest release" is a downgrade by version and the
  gate above refuses it — which would make the release channel a one-way door. The required checked
  artifact lease on `POST /ota/update?...&downgrade=1` (`ota_install_allowed`, host-tested) relaxes
  the **ordering only**, and only for the request that carries the flag:
  - it is never inferred from the manifest, so a hostile or stale host still cannot walk a fleet
    backwards on its own say-so — the property this gate exists for is intact;
  - it is never persisted, so a later automatic check cannot inherit it;
  - it does not touch the signature check: the RSA-3072 Secure Boot v2 verification on install is
    unchanged, so the older image must still be one this project signed;
  - an **equal** version is still refused, in both modes.

  The requester is a trusted-LAN client that just picked a channel in the web UI and confirmed a
  dialog spelling out that the build is older — the same trust level that can already erase the
  config or re-point the X10A pins.
- **Heap-safe validation** *(implemented — `logic/ota_headroom.hpp`, host-tested)* — OTA raises one
  lock-free quiesce request before any network allocation. MQTT publication and X10A polling stand
  aside before building their allocation-rich snapshots, while an already-running Open-Meteo TLS
  request is given one bounded timeout to unwind. The firmware then requires both **24 KiB total
  free INTERNAL 8-bit heap** and a **12 KiB largest contiguous INTERNAL block**, first before the
  image transfer and again after the HTTP/TLS client plus fixed 2 KiB download buffer have been
  freed, immediately before RSA/PSA validation. Each wait is bounded to five seconds and refuses
  the update on failure; it never weakens or skips signature checking.

  The order is deliberate: IDF's signed-image verifier runs in `esp_ota_end()`. Keeping the TLS
  allocator alive until that call made the verifier compete for the same fragmented internal heap.
  The low-level stream retains that exact verifier while allowing transport cleanup first.
  `ESP_ERR_OTA_VALIDATE_FAILED` covers malformed image structure, digest/signature failure **and**
  verifier allocation failure, so the UI reports the defensible generic **“Update rejected: image
  validation failed”**; `/diag` records the error and heap samples without guessing a narrower cause.
- **Rollback health gate** *(implemented)* — a freshly OTA-installed image stays `PENDING_VERIFY`
  until it has run for ~90 s and then proves either an active WiFi/Ethernet link or a provisioning
  portal that is actually running (`ota_update.cpp`, `logic/health_gate.hpp`), so a
  boots-but-crashes or boots-without-a-recovery-surface image is reverted.

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
| 2 | **OTA** receives an *unsigned/tampered* image | ✅ after the inactive-slot stream and transport cleanup, `esp_ota_end()` validates the complete signed image before `esp_ota_set_boot_partition()` can activate it. Validation failure leaves the running slot selected and is reported generically because IDF does not distinguish signature, structure, digest and verifier-allocation failures in that error. |
| 2b | **OTA** installs an authentically-signed but **older** image (downgrade onto a fixed bug) | ✅ the downgrade gate above — checked against the manifest *and* against the image's own embedded version, so a host that lies in the manifest is still refused. |
| 3 | **Direct USB / Web-Serial flash** of an unsigned (or early-crashing) build | ⚠️ not auto-recoverable — see below. Prevented instead by `scripts/require-signed.sh`. |

### Why mode 3 can't roll back — and how it's contained

The rollback in mode 1 works because the *previous* firmware is selected by valid otadata while the
new one is `PENDING_VERIFY`. A **full `@flash_args` USB flash does neither**: it rewrites the
bootloader, partition table and **otadata (blanked to `0xFFFFFFFF`)** and writes `ota_0` directly.
The bootloader therefore starts it in `ESP_OTA_IMG_UNDEFINED` state (not `PENDING_VERIFY`) and has no
rollback record, even if old bytes happen to remain in `ota_1`. For a directly-flashed unsigned
build, "boot the previous FW automatically" is mechanically unavailable.

This is **never a brick**: no eFuses are burned and ROM download mode stays enabled, so the board is
always re-flashable over USB. The containment is therefore *prevention*, not recovery:

- **`scripts/require-signed.sh <app.bin>`** refuses to flash an unsigned image (it parses
  `espsecure signature-info-v2`) and prints the signing command. The `$flash-esp32` skill and the
  canonical [`AGENTS.md`](../AGENTS.md) flash rules run it before `esptool write_flash`, so the
  mode-3 crash-loop is stopped at the source. Recovery from a board that already got an unsigned
  image = re-flash a **signed** one.
- **`scripts/ci-build-all.sh`** closes the *Web-Serial* half of mode 3, which no host-side guard can
  reach: after building the canonical `-merged.bin`, it carves out the individual `flash_args`
  ranges, runs `require-signed.sh` on the final staged app and publishes those sparse parts. The
  build fails rather than publish an installer whose app is unsigned.
- The sparse Web Serial plan is also the configuration boundary: without **Erase**, no published
  part covers `nvs@0x9000`, so WiFi/MQTT/board/X10A settings survive. The build runs
  `check-web-installer-plan.py`, which requires the user-facing Erase choice and compares every
  part's rounded 4 KB erase interval with the NVS partition. Selecting **Erase** still deliberately
  erases the whole chip. The separately published `-merged.bin` remains a manual factory-reset
  image; writing it at offset 0 writes its `0xff` gap through NVS.
- The sole `history@0x400000` partition (4 MiB append journal) sits outside
  every published data part, so plant readings survive a non-Erase install exactly as the settings
  do. The former 8 KB partition at 0x1e000 is no longer part of the table. The journal is
  user data: the recovery-button factory reset erases it alongside NVS (`history_flash_forget()`),
  and a record written by a different trend catalog is refused rather
  than decoded, so stale bytes cannot be attributed to the wrong sensors.

### The health gate (mode 1)

`ota_health_gate_arm()` (`ota_update.cpp`) starts a task that runs **only** for a `PENDING_VERIFY`
image — i.e. one installed via `esp_ota_*` (a real OTA), which always leaves a valid previous slot.
It commits the image (`esp_ota_mark_app_valid_cancel_rollback()`) only once it has proven **healthy**,
not merely survived a timer or acquired an IP address. After the base window (~90 s) a normal boot
must prove all of these at the same time:

- an active IP link (`NetLink::Wifi` or `NetLink::Eth`);
- at least 24 KiB free internal heap and a 16 KiB largest contiguous internal block;
- no inherited heap-watchdog restart evidence, dropped MQTT allocation cycle, or dropped X10A poll
  cycle in this boot;
- if the X10A link is live and MQTT is configured, one X10A retained-state payload accepted by the
  MQTT client.

The provisioning portal remains a recovery exception for a fresh or unconfigured board. The
presence or absence of stored WiFi credentials is not health evidence: a wired boot deliberately
keeps the portal off, and losing that Ethernet lease must not be mistaken for a recovery surface.
If normal service proof is still missing at the ~10-minute hard cap, the firmware deliberately
restarts while the image remains `PENDING_VERIFY`, so the bootloader selects the previous slot.
The decision is the host-tested `daik::health_gate_decide()` in `main/logic/health_gate.hpp`
(covered by `test/test_logic.cpp`). A USB/`@flash_args` image is `UNDEFINED`, never `PENDING_VERIFY`,
so the gate is a no-op for it and can never strand a fresh board.

### Production OTA promotion gate

The private-inventory `production` role is updated only through the direct, unchained
`scripts/production-ota-gate.py` command. The command accepts only the official **dev** manifest,
binds the expected source SHA, version, application SHA-256, ESP32-S3 image metadata and Secure Boot
v2 signature, and refuses a dirty or different local source tree. Device hosts and MACs live only
in the untracked schema-versioned local inventory
`$XDG_CONFIG_HOME/daikin-altherma-esp32/production-ota.json` (or the same path below `~/.config`),
whose distinct `bench` and `production` roles prevent a swapped target without publishing private
installation identifiers. The exact signed artifact must first run on the MAC-bound `bench` role,
normally installed by the NVS-preserving signed USB flash workflow. The gate then runs the complete
host logic/X10A/OTA contracts and a fixed
three-minute concurrent `/status` + `/values` + `/diag` pressure window with a real OTA-manifest
TLS fetch. Optional Open-Meteo evidence is not a bench prerequisite.
The shared `/values`/MCP values sender waits in 250-ms steps for at most four seconds before taking
its model-sized snapshot while either firmware TLS owner is active. The cap remains below the gate's
five-second request timeout; expiry is a blocking busy-503, not an accepted retry. `/status`,
`/diag` and `/ota/status` are not themselves gated and resume after the bounded values request.

Only after that stage and an explicit `production` confirmation does the command perform exactly
one un-retried `POST /ota/update`. Before that sole write, `/ota/check` must synchronously return a
non-zero operation generation and `/ota/status` must return that same generation, `busy=false`, and
the exact idle dev channel/version/application-SHA offer. The update POST carries that complete
lease; firmware accepts it only while the mutex still holds the same completed check, copies it to a
fixed task slot, and returns the immediate successor generation. Busy, replaced or unavailable
operation starts are HTTP 503, so neither a stale status nor a concurrent LAN check can turn an
ignored write into false success. The task refetches only the captured channel, requires the same
manifest version and SHA, and hashes the complete downloaded byte stream against that SHA before
Secure-Boot validation and boot selection. All subsequent observation is read-only:
exact version/ELF and
MAC, rollback/crash/safe-mode state, stable heap/OOM/X10A counters, live X10A values, and the
retained X10A MQTT payload must pass a second fixed three-minute canary. The command does not create
a release and an arbitrary 48-hour wait is not a substitute for these targeted proofs. A bench
without physical X10A proves the exact binary, HTTP/TLS concurrency and heap recovery;
catalog-wide host replay and the source/mutation contracts cover the publisher, and the real
retained payload is proved only on the production role after the single update. Expected UART
timeouts on that intentionally unwired bench do not fail the bench stage; the production role keeps
the bounded X10A timeout-delta requirement. The bench always overlaps a real OTA-manifest TLS check
with the pressure workers, but does not require the optional Open-Meteo task when device-wide
diagnostics consent is off; the production role still requires a successful weather fetch.

A production image which predates the `busy`/generation/artifact handshake cannot enter this path:
the gate requires the new response fields and fails before its sole POST. Its one-time migration is
a signed, NVS-preserving USB application flash followed by the ordinary bench-first gate for later
updates. There is deliberately no timing-based legacy OTA fallback: old firmware can acknowledge an
ignored busy update with HTTP success, which is the incident this boundary prevents.

The private inventory shape is:

```json
{
  "schema_version": 1,
  "bench": { "host": "<bench-host>", "mac": "<BENCH-MAC>" },
  "production": { "host": "<production-host>", "mac": "<PRODUCTION-MAC>" }
}
```

Run from the clean, exact `main` source after the dev manifest has published and the exact signed
application has been installed on the bench board:

```bash
scripts/production-ota-gate.py \
  --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json \
  --expected-source-sha <40-lowercase-hex-main-sha> \
  --expected-version <dev-version> \
  --expected-app-sha256 <64-lowercase-hex-app-sha256> \
  --expected-current-version <production-current-version> \
  --confirm-production production --execute
```

Do not wrap, chain, shorten, or retry this command; the agent hook admits only this canonical shape.

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
  `OTA_SIGNING_KEY` repository secret, `ci-build-all.sh` signs each image, and an `always()` step
  removes the workspace file with `rm -f ota_signing_key.pem`. This is lifecycle cleanup on the
  ephemeral runner, not a claim of secure storage-media erasure.
- **Fork PRs get no secret** → they build **unsigned**, as a compile check only. Nothing is
  published or offered for flashing (an unsigned image would crash-loop at boot on a signed-build
  device).
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

**One non-security thing is also sent here: a core dump.** An ordinary bug report is filed as a
public issue and carries its device data with it, because the device redacts that data before it
leaves the board (`GET /status?redact=1` / `GET /diag?redact=1`, `main/logic/redact.hpp` — see
[REPORTING.md](REPORTING.md)). A **core dump is the exception the redaction cannot cover**: it is raw
task-stack and TCB memory, and although `CONFIG_ESP_COREDUMP_CAPTURE_DRAM` is off, a password of 15
characters or fewer lives *inside* its `std::string` object by small-string optimisation rather than
on the heap — so a stack frame holding a config snapshot can carry one. Dumps are therefore never
requested up front (`/status.last_crash` already gives reason, task, PC and backtrace) and, when one
is genuinely needed, it is sent through this private form and never attached to an issue.

Please include the firmware version (`GET /status` → `version`, or the version shown in the web UI)
and, where relevant, the `app_elf_sha256` from the same response — it pins the exact build.

There is no bug bounty and no SLA: this is a hobby project maintained in spare time. Expect a first
response within a couple of weeks, and note that the [trust boundary](#trust-boundary) above is
deliberately "trusted LAN only" — an issue that reduces to *"an attacker already on your LAN can
read the device's HTTP API"* is documented behaviour, not a vulnerability.
