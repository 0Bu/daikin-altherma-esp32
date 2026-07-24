# Technical features & ESP-IDF building blocks

A cross-cutting catalog of **what this firmware does at the platform level** — the ESP-IDF
subsystems it puts to work, the security and update mechanisms it layers on top, and the
engineering choices that distinguish it from a stock "read a sensor, publish MQTT" sketch.

This document is an **index**, not a re-derivation. Each feature is stated with a code pointer and
an honest status, then links to the deep-dive doc that explains the *why* and the *wire detail*:

| Deep dive | Covers |
|-----------|--------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | component map, poll engine, detection, WiFi, MQTT, OTA/partitions, memory |
| [`SECURITY.md`](SECURITY.md) | trust boundary, credential storage, OTA signing, boot recovery, key lifecycle |
| [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) | the heat-pump wire protocol (framing, CRC, register pages, detection) |
| [`REGISTERS.md`](REGISTERS.md) | converter reference + full register/value map |
| [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md) | HA topics, discovery, derived power/COP/SCOP |
| [`DESIGN.md`](DESIGN.md) | web-UI design contract |
| [`MCP.md`](MCP.md) | MCP server (planned) |

> **Status legend** — ✅ implemented & shipping · 🧪 implemented, host-tested pure logic ·
> 🟡 partially implemented (a working core with a documented TODO) · 🔭 planned / stubbed route.
> Every ✅/🧪 claim below points at the source that backs it; keep this file honest (see
> [the `feature-docs` skill](../.claude/skills/feature-docs/SKILL.md)).

---

## Feature matrix (the short version)

| # | Feature | Status | Anchored in |
|---|---------|:------:|-------------|
| 1 | Secure Boot v2 **signed images without hardware Secure Boot** (RSA-3072) | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 2 | Refuse-to-flash-unsigned guard | ✅ | [`require-signed.sh`](../scripts/require-signed.sh) |
| 3 | Dual-OTA layout + **NVS-preserving OTA and no-Erase Web Serial updates** | ✅ | [`partitions.csv`](../partitions.csv), [`ci-build-all.sh`](../scripts/ci-build-all.sh), [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py) |
| 4 | OTA rollback + **connectivity-proving health gate** | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/health_gate.hpp`](../main/logic/health_gate.hpp) |
| 5 | OTA manifest check + signed download + **two-point downgrade gate** | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/version_cmp.hpp`](../main/logic/version_cmp.hpp), [`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp) |
| 6 | WebSocket live push (`/events`) — bounded async backpressure, the only live transport | ✅ 🧪 | [`http_status.cpp`](../main/http_status.cpp), [`logic/ws_tx_gate.hpp`](../main/logic/ws_tx_gate.hpp) |
| 7 | Gzipped web UI **embedded in the app image**, assembled at build time | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt) |
| 8 | HTTP handlers under an **OOM `try/catch` → 503** discipline | ✅ | [`http_common.cpp`](../main/http_common.cpp), [`http_status.cpp`](../main/http_status.cpp) |
| 9 | Home Assistant MQTT auto-discovery, grouped state, LWT | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/discovery.hpp`](../main/logic/discovery.hpp) |
| 10 | **MQTTS + CA-bundle** TLS; credentials never sent in cleartext | ✅ | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 11 | Core-dump-to-flash + summary capture + offline symbolication | ✅ | [`diag_crash.cpp`](../main/diag_crash.cpp), [`decode-coredump.sh`](../scripts/decode-coredump.sh) |
| 12 | Reset-reason + crash classification, retained to MQTT | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 13 | 19-entity device **heartbeat** diagnostics stream (heap trend + reset reason + SNTP wall clock + WiFi MAC/BSSID incl.) | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp) |
| 14 | Strongest-AP scan + SAE tuning + **endless reconnect** | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 15 | **ICMP gateway watchdog** (ghost-association recovery) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 16 | Captive-portal provisioning (AP-only SoftAP, typed SSID, UDP:53 DNS catch-all, 302 probe redirect + RFC 8910 option 114) | ✅ 🧪 | [`provisioning.cpp`](../main/provisioning.cpp), [`captive_dns.cpp`](../main/captive_dns.cpp), [`logic/captive.hpp`](../main/logic/captive.hpp) |
| 17 | mDNS + DHCP hostname (option 12) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 18 | **In-app WiFi re-config + reason-aware one-shot credential rollback** | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`http_config.cpp`](../main/http_config.cpp), [`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp) |
| 19 | X10A auto-detection (protocol sweep → fingerprint → model, **I/U-capacity fallback** when the O/U 0x00 descriptor omits its capacity byte) | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`logic/detect.hpp`](../main/logic/detect.hpp) |
| 20 | **IDF-free host-tested logic core** (1101 checks) | 🧪 | [`main/logic/`](../main/logic), [`test/test_logic.cpp`](../test/test_logic.cpp) |
| 21 | CI pinned to the exact ESP-IDF the local Docker build uses | ✅ | [`idf-docker.sh`](../scripts/idf-docker.sh), [`build.yml`](../.github/workflows/build.yml) |
| 22 | Traceable build identity (`app_elf_sha256`) matches a dump→its ELF | ✅ | [`http_status.cpp`](../main/http_status.cpp), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 23 | Firmware-footprint trims (~15 KB of unused IDF code paths) | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 24 | Status indicator — **runtime-selectable GPIO-LED / WS2812 back-end**, one image per board family | ✅ 🧪 | [`status_led.cpp`](../main/status_led.cpp), [`logic/led_pattern.hpp`](../main/logic/led_pattern.hpp) |
| 25 | Read-only MCP server route | 🔭 | [`mcp_server.cpp`](../main/mcp_server.cpp) |
| 26 | **MQTT broker save-time pre-flight** (DNS/TCP/connect+auth, heap-guarded) before persist | ✅ | [`http_config.cpp`](../main/http_config.cpp) |
| 27 | **Task Watchdog** → clean reboot on a wedged poll/publish task | ✅ | [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 28 | **`/status.sys`** always-on heap headroom + last-boot reason (LAN/WS, no broker) | ✅ 🧪 | [`http_status.cpp`](../main/http_status.cpp), [`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp) |
| 29 | **Boot-loop safe mode** — recover a bad config in-browser (crash-only counting, distinct from OTA rollback) | ✅ 🧪 | [`safe_mode.cpp`](../main/safe_mode.cpp), [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp) |
| 30 | **Config-write integrity** — the credential/service config is one **atomic CRC-checked NVS blob** (all-or-nothing across a write failure AND a power cut); field-owned commits (the poll task never reverts an HTTP credential write; the reverse — an HTTP save clobbering a self-healing link commit — is left open by design, detection re-runs it), reserved-GPIO rejection on both the request and the load path, + an NVS failure that reaches the user (500, no reboot) instead of "saved" | ✅ 🧪 | [`config.cpp`](../main/config.cpp), [`logic/config_store.hpp`](../main/logic/config_store.hpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp), [`logic/board_pins.hpp`](../main/logic/board_pins.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 31 | **Value-catalog domain audit** — real converters × real catalog vs the spec, each finding carrying a decode witness; co-gates CI, plus a selftest that re-catches the four decode bugs that shipped | ✅ | [`catalog_audit.cpp`](../tools/domain/catalog_audit.cpp), [`run-domain-audit.sh`](../scripts/run-domain-audit.sh), [`selftest.sh`](../tools/domain/selftest.sh) |
| 32 | **SNTP wall clock**, runtime-configurable server — real UTC for the syslog TIMESTAMP field + `/status.ntp` | ✅ 🧪 | [`sntp_time.cpp`](../main/sntp_time.cpp), [`logic/timestamp.hpp`](../main/logic/timestamp.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 33 | **Detect-sweep heap hardening** — install-once UART + register-only pin remap (no per-swap driver realloc) and silent-bus detect backoff, closing a fragmentation panic caught by a symbolized coredump | ✅ 🧪 | [`hp_comm.cpp`](../main/hp_comm.cpp), [`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp) |
| 34 | **HTTP trust-surface split** — the open setup AP registers only the provisioning routes; `/coredump`, `/diag` and the config/OTA/MCP surface exist only on the trusted STA LAN | ✅ 🧪 | [`http_server.cpp`](../main/http_server.cpp), [`logic/http_surface.hpp`](../main/logic/http_surface.hpp), [`http_common.cpp`](../main/http_common.cpp) |
| 35 | **Publish-time value-plausibility filter** — a decoded °C reading outside a physical envelope, a saturation temp from a 0-bar sensor, or a **refrigerant pressure at ≤ 0 bar** (absolute; a sealed circuit is never at vacuum) is dropped at publish (HA gets *unavailable*, never a false 576 °C / −51.2 °C / 0.0 bar); the runtime backstop to the build-time catalog audit (#31), kept out of `convert()` so the audit still distinguishes the intrinsic converters. Refrigerant vs. water is decided **structurally** — outdoor page, or a conv-405 saturation twin — never by label, and a catalog-wide test pins that no water-pressure row is ever caught (a drained system's real 0 bar must still publish) | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`hp_convert.cpp`](../main/hp_convert.cpp) |
| 36 | **Raw page dump on `/diag`** — the wire bytes of pages `0x00`/`0x10`/`0x20`/`0xA0`/`0xA1`, one line per detect pass. Everything else the device exposes is *decoded*, so an impossible reading cannot be attributed to a wrong converter vs. a wrong offset vs. a per-unit layout difference without these bytes — and they otherwise never leave the board. `0x10`/`0x20` cover impossible readings that fall *inside* the plausibility window and are therefore never masked | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`logic/hexdump.hpp`](../main/logic/hexdump.hpp) |
| 37 | **Physical recovery button** — a 5 s hold erases the whole stored config and reboots into the setup portal: the only config reset that needs no network access to the device. Armed/erasing are signalled on the status indicator, and the destructive path (arm checkpoint, debounced abort) is host-tested | ✅ 🧪 | [`recovery_button.cpp`](../main/recovery_button.cpp), [`logic/button.hpp`](../main/logic/button.hpp), [`nvs_storage.cpp`](../main/nvs_storage.cpp) |
| 38 | **Board-hardware runtime config** (`POST /set_board`) — indicator pin/driver/polarity + button pin live in NVS, not Kconfig, so one published image serves boards with different onboard parts; per-board **presets** (`/status.board.presets`) fill all five fields from one pick and are host-tested against the request path's own validator, and the indicator **announces its resolved pin/driver on `/diag`** at boot — a valid-but-wrong pin initialises fine and drives nothing, which otherwise looks exactly like a working LED | ✅ 🧪 | [`http_config.cpp`](../main/http_config.cpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp), [`logic/board_pins.hpp`](../main/logic/board_pins.hpp), [`logic/board_presets.hpp`](../main/logic/board_presets.hpp), [`status_led.cpp`](../main/status_led.cpp) |
| 39 | **Stack-overflow watchpoint** — a hardware watchpoint on every task's stack limit, so the *first* write past it panics at the offending instruction instead of corrupting a neighbour silently. IDF's default canary is only compared at a context switch and a sparsely-writing frame can step over it — which is how a v1.0.12 `httpd` overflow overwrote its own TCB and died 44 s later in unrelated lwip code. Shipped with the `httpd` stack raised to 12 KB and the `/status` JSON built by `+=` rather than long `+` chains | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`http_server.cpp`](../main/http_server.cpp), [`http_status.cpp`](../main/http_status.cpp) |
| 40 | **Cost-shaped CI** — Actions bills per job rounded up to the whole minute, so the three fast gates are one job, the firmware build is *skipped* (not failed) when nothing the image or the site is made of changed, ccache is carried across runs, the per-PR preview installer is retired in favour of the dev channel, and every job has a timeout | ✅ | [`build.yml`](../.github/workflows/build.yml), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |

---

## 1. Secure boot & firmware signing

### Secure Boot v2 signature scheme — *without* burning eFuses

The build enables the Secure Boot v2 **RSA-3072 signature scheme** but deliberately does **not**
enable hardware Secure Boot ([`sdkconfig.defaults`](../sdkconfig.defaults)):

```
CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT=y
CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME=y
CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y
CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES=n   # CI signs post-build, offline key never at compile time
```

What this buys, and why the combination is unusual:

- **The running app verifies the *next* OTA image's RSA signature before writing it.** A compromised
  update host can no longer push unsigned firmware — trust is *trust-on-first-use* from the running
  app's own signature block, enforced by `bootloader_support`/`app_update` on the update path.
- **No eFuses are burned.** The bootloader does *not* verify on boot, so this is fully reversible,
  carries **zero brick risk**, and the browser (Web Serial) / USB-flash install path keeps working.
- **The private key is never present at compile time.** `BUILD_SIGNED_BINARIES=n` means the image is
  signed in a *separate* step ([`ci-build-all.sh`](../scripts/ci-build-all.sh) →
  `espsecure.py sign_data --version 2`), so fork/PR builds without the secret still compile, and the
  key stays offline.

Full key lifecycle, threat model, and the boot-recovery reasoning: [`SECURITY.md`](SECURITY.md).

### The trade-off it forces — and the guard that contains it

Because the app itself must carry a valid signature to run under this config, an **unsigned image
crash-loops** in `esp_secure_boot_init_checks` *before* `app_main`, with no app-level recovery — and
a full `@flash_args` flash also blanks otadata, leaving the bootloader no rollback record. The
project turns that sharp edge into a hard gate:

- [`scripts/require-signed.sh`](../scripts/require-signed.sh) inspects a `.bin` with
  `espsecure signature-info-v2` and **exits non-zero with the exact signing command** if the
  signature block is absent. The [`flash-esp32`](../.claude/skills/flash-esp32/SKILL.md) skill runs
  it before every `esptool write_flash`.
- CI never publishes unsigned firmware to OTA: [`build.yml`](../.github/workflows/build.yml) hard-errors
  on a `main` build with no `OTA_SIGNING_KEY` secret (fork PRs downgrade to an unsigned
  *compile-only* build — nothing is published or offered for flashing).
- CI applies the same guard to the **browser installer**, which no host-side check can reach:
  [`ci-build-all.sh`](../scripts/ci-build-all.sh) carves each published Web Serial part out of the
  prepared `-merged.bin`, then runs `require-signed.sh` on the final staged app bytes. A signing step
  that silently stops covering the installer therefore fails the build instead of shipping.

---

## 2. OTA self-update & anti-brick

See [`ARCHITECTURE.md` → OTA, signing, partitions](ARCHITECTURE.md) and
[`SECURITY.md` → Boot recovery](SECURITY.md).

- **Dual-OTA layout** ([`partitions.csv`](../partitions.csv)): two ~2.03 MB app slots (`ota_0`/`ota_1`)
  sized to fill 4 MB flash exactly, with `otadata`, `phy_init` and a `coredump` partition.
  `esp_https_ota` writes the **inactive** slot, so an update never touches `nvs@0x9000` — WiFi, MQTT
  and the X10A pin cache survive upgrades.
- **✅ NVS-preserving Web Serial updates** ([`ci-build-all.sh`](../scripts/ci-build-all.sh)):
  `merge_bin` remains the canonical prepared image, but the manifest publishes only the occupied
  `flash_args` ranges as separate parts. A no-Erase install therefore skips `nvs@0x9000` instead of
  writing the merged image's `0xff` gap through it. The independent
  [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py) gate requires the Erase
  choice to remain enabled, rounds every part to its actual 4 KB erase sectors and fails the build
  if any overlaps NVS. Selecting **Erase** in ESP Web Tools remains the explicit factory-reset path.
- **Rollback armed until proven healthy** (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`): a freshly-booted
  OTA image starts `PENDING_VERIFY`. If it reboots before being marked valid, the bootloader reverts.
- **✅ 🧪 Health gate, not a timer** — the distinctive part. Instead of blindly committing after an
  uptime window, [`ota_update.cpp`](../main/ota_update.cpp) drives the host-tested state machine in
  [`logic/health_gate.hpp`](../main/logic/health_gate.hpp): an image is sealed in only once it has run
  a base window (≥90 s, survives an early crash-loop) **and** proven connectivity (STA online, or the
  setup portal when it has no credentials). A boots-but-broken update — e.g. a WiFi regression that can
  never get back online to be re-flashed — is left un-committed and **rolls back on the next reboot**
  instead of sealing the break in. USB/`@flash_args` images boot `UNDEFINED`, never `PENDING_VERIFY`,
  so the gate can never strand a fresh board.
- **✅ 🧪 Update channels** ([`logic/ota_channel.hpp`](../main/logic/ota_channel.hpp), `POST /set_ota`,
  `/status.ota.channel`): a merge to `main` no longer cuts a release, so CI publishes **two** feeds —
  `release` (the gh-pages root, republished only by a manual workflow run that tags `v*`) and `dev`
  (`…/dev/`, republished by every firmware-relevant merge) — and each device follows one. The dev
  URL is *derived* from the configured firmware base (`…/dev/`), never configured separately, so the
  two feeds cannot drift onto different hosts. Persisted in the config blob (v3, one writer) and
  applied **live** — no reboot, since nothing claims a channel at task start. Dev builds are stamped
  `<next release>-dev.<n>`: a semver **pre-release**, so ordering alone gets both directions right —
  a dev board upgrades itself to the next release, a release board never drifts onto a dev build.
- **✅ 🧪 Manifest check & signed download** ([`ota_update.cpp`](../main/ota_update.cpp)):
  `/ota/check` fetches the **selected channel's** `manifest.json` over TLS (public CA bundle) and
  compares its `version` to the running image; `/ota/update` streams the signed `.bin` into the inactive slot via `esp_https_ota`,
  reporting progress on `/ota/status`. Both run on **one on-demand task, one at a time** — never on
  the httpd worker (a multi-MB TLS download would park the single HTTP task and take the web UI down
  with it), and never twice concurrently (two TLS sessions compete for the largest *contiguous*
  block). The manifest is parsed by [`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp) —
  bounded, allocation-free, depth-aware, and it **refuses rather than truncates** an oversized value.
- **✅ 🧪 Two-point downgrade gate** ([`logic/version_cmp.hpp`](../main/logic/version_cmp.hpp)): a
  signature proves a build is *authentic*, not *newer*, so an attacker who can serve a genuine old
  image could otherwise walk a fleet backwards onto a fixed bug. The gate refuses anything not
  strictly newer, checked **twice**: against the manifest's `version` (cheap, avoids a pointless
  download) and — the check that actually binds — against the **image's own embedded
  `esp_app_desc_t` version**, read via `esp_https_ota_get_img_desc()` before anything is committed.
  The manifest and the image are separately-controlled artifacts, so only the second check catches a
  host that advertises `9.9.9` while serving a signed `1.0.0`. Ordering is numeric
  (`1.10.0 > 1.9.0` — a `strcmp` gets this backwards), pre-release identifiers compare numerically
  too (`-dev.12 > -dev.9`, semver §11.4 — a `strcmp` freezes a dev board at the ninth build of a
  series), and it **fails closed** on an unparseable version. The one relaxation is the **channel
  switch**: going from the dev feed back to the last release is an older version by definition, so
  `POST /ota/update?downgrade=1` (`ota_install_allowed`) relaxes the *ordering* — never the
  signature check, never an equal version, never on the manifest's say-so, and never persisted.
  Without it the release channel would be unreachable from a dev board; with it, the property that
  matters still holds — a hostile manifest host cannot walk a fleet backwards on its own.
- **✅ The feeds themselves**: both are live on the `gh-pages` branch and published by CI — the
  RELEASE channel at the root (`manifest.json` + the images, written only by a manual release run)
  and the DEV channel at `dev/` (rewritten by every firmware-relevant merge to main). The
  precondition outside the firmware is met: the repo's Pages source points at `gh-pages` /
  `(root)` ([`README.md`](README.md)), which is why the branch had to exist first. (The repo does
  not have to be public — that gate was removed; note the resulting Pages site *is* public
  regardless of repo visibility.) A device follows one feed at a time
  (`ota_channel`, above); against a channel with nothing served a check honestly reports "up to
  date" rather than failing, which is also what a self-hosted setup falls back to — point
  `CONFIG_DAIKIN_OTA_MANIFEST_URL` / `CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL` at any HTTPS host to run
  your own (the dev URL is derived from the latter, so one setting moves both).
- **Version pipeline**: [`next-version.sh`](../scripts/next-version.sh) prints either the next
  **release** (`patch`/`minor`/`major` above the latest `v*` tag, with `version.txt` as a manual
  floor) or the next **dev** version (`--dev` → `<next patch>-dev.<commits since the tag>`). Which
  one a run stamps is decided by the run mode: a merge to `main` is always a dev build, and only a
  manual `workflow_dispatch` with `release: true` produces a tagged release. CI stamps that version
  into `version.txt` *before* the build, so ESP-IDF bakes that exact string into
  `esp_app_get_description()->version`, and `manifest.json` is written from the **same** stamped
  string.
  [`ci-build-all.sh`](../scripts/ci-build-all.sh) then reads the version back out of the built
  image's app descriptor and **fails the build** if the two disagree, so the running image, the
  release tag and the manifest can't drift apart: OTA compares the manifest against the version the
  running app reports, making a mismatch a permanent re-download loop rather than a cosmetic slip.
- **✅ 🧪 Boot-loop safe mode (config recovery)** ([`safe_mode.cpp`](../main/safe_mode.cpp),
  [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp)): a **different** failure class from the image
  rollback above — both OTA slots share the same `daik_cfg` NVS, so rolling back the *image* can't fix
  a *config* crash-loop (e.g. wrong RX/TX pins). Safe mode counts **crash-only** boots (a clean/
  config-save reboot resets the count, so provisioning never trips it) and, past a threshold, brings
  the device up minimally — WiFi + web UI + OTA, no poll/MQTT — so the bad setting is fixable in the
  browser instead of over USB. `/status.sys.safe_mode` + a warn-accented **Recovery mode** banner
  surface it. The counter lives in `daik_cfg`, so a factory reset clears it too.

---

## 3. Networking & connectivity resilience

The device is a **stationary, mains-powered bridge** that must never need a human to power-cycle it.
[`wifi.cpp`](../main/wifi.cpp) layers several IDF features toward that (deep dive:
[`ARCHITECTURE.md` → WiFi/LAN](ARCHITECTURE.md)):

- **Connect to the *strongest* AP, not the first heard.** `WIFI_ALL_CHANNEL_SCAN` +
  `WIFI_CONNECT_AP_BY_SIGNAL` so a multi-AP/mesh SSID doesn't latch a distant, weak AP (the classic
  "weak WiFi" symptom on a non-roaming STA). `failure_retry_cnt = 3` keeps the top-ranked AP across a
  transient SAE hiccup; `sae_pwe_h2e = WPA3_SAE_PWE_BOTH` advertises both Hash-to-Element and
  Hunt-and-Peck.
- **Endless reconnect with a first-boot budget.** A boot-time connect failure spends a bounded budget
  (10 attempts) → tears the STA stack down → opens the setup portal (creds presumed wrong). Once ever
  online, a drop reconnects **forever** — a router reboot never strands the bridge. That guarantee is
  unconditional on the disconnect *reason*: an earlier revision rebooted after ≥5 consecutive
  `AUTH_FAIL`/handshake-timeout drops, which let a transient WPA3-SAE storm — the very thing
  `failure_retry_cnt`/`sae_pwe_h2e` above exist to absorb — spend the boot budget against a healthy AP
  and strand the bridge in the open portal with good credentials still in NVS. The budget is also
  suspended while a credential change is pending, so ten fast `NO_AP_FOUND` scans can't pre-empt the
  rollback grace below.
- **✅ In-app WiFi re-config with one-shot credential rollback.** WiFi is provisioned first from the
  captive portal, then re-editable from the WiFi row of the Connections tile in Settings (gear → Connections →
  WiFi → modal → `POST /set_wifi`, validating SSID 1–32 / password empty-or-8–63). Because a bad SSID/password entered over the LAN
  would otherwise strand the device in the setup AP, `/set_wifi` stashes the previous working
  credentials as a **one-shot NVS backup**; on the reboot into the new network, if the STA never gets a
  DHCP lease `wifi_start_sta()` restores the backup and reboots again — a successful connect clears it.
  The reboot is gated on the restore having **persisted**; if the NVS write fails the device opens the
  setup portal rather than rebooting into a restore it would have to re-decide identically every boot.
  The deadline is **reason-aware** ([`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp)),
  because a rollback *destroys* the new credentials and must not be spent on a guess: only an AP that
  **keeps refusing** them (auth class, sustained across two 30 s checkpoints — one sample cannot tell a
  wrong password from a transient SAE failure) takes the fast path. An **absent SSID** says nothing about the
  credentials — it is what a router that is still rebooting looks like, and re-pointing the device at a
  just-reconfigured router is the main reason anyone edits these at all — so it waits 180 s. The blind
  30 s deadline this replaces did the opposite: it restored an old SSID for a network that no longer
  existed and threw the correct new credentials away. The outcome is recorded as
  `/status.wifi.rolled_back` (sticky until the next `/set_wifi`), since the rollback's own reboot wipes
  the diag ring and the Connections tile's WiFi row just shows the old SSID again. The dashboard reads it as a **rollback
  banner** — necessarily a banner off `/status` rather than a toast on the save, because the verdict
  takes 60–180 s and lands long after the save's ~21 s reconnect poll has given up.
- **✅ 🧪 Config-write integrity** ([`config.cpp`](../main/config.cpp),
  [`logic/config_model.hpp`](../main/logic/config_model.hpp)). Two tasks write the config — httpd
  (`/set_*`) and poll (detection) — and a writer that saves a whole `Config` saves whatever it
  *snapshotted*. Detection snapshots, then probes the bus for seconds before committing, so a
  whole-struct write-back reverted any `/set_wifi` that landed during the sweep, silently, after the
  user was told `{"ok":true}`. Writers now commit only the fields they **own**: `config_save_link`
  (rx/tx/proto, persisted) and `config_set_model` (profile/`fp_*`, RAM) patch the live config in place
  under the mutex via `apply_link`/`apply_model` — non-allocating, so the critical section stays
  throw-free, and host-tested so "touches nothing else" is proven rather than argued. The rule is
  deliberately asymmetric (it closes poll→httpd, not httpd→poll: a reverted link self-corrects on the
  next detect, credentials do not). Separately, an NVS write failure now **reaches the user** — the
  `/set_*` handlers answer `500 {"ok":false,"error":"config write failed"}` and skip the reboot rather
  than coming back up on the old config behind an `{"ok":true}`, `config_save` names the failing key +
  `esp_err_t` on `/diag`, and the two WiFi credential groups stop dead rather than half-write (a
  partial save would defeat the very ordering that protects the rollback backup).
- **✅ ICMP gateway watchdog (ghost-association recovery).** The reconnect handler can only see drops
  the STA *knows* about. A missed deauth leaves a "ghost" association — IP held, TCP timing out, no
  `STA_DISCONNECTED` event ever fires. A background task ICMP-echoes the default gateway every 30 s and,
  **only** for the proven ghost case (link up, yet a gateway that *has* answered before now doesn't),
  forces one `esp_wifi_disconnect()` to re-associate. It never reboots and never false-alarms on a
  router that simply drops LAN ICMP. The probe is three-valued and its policy is host-tested
  ([`logic/link_watch.hpp`](../main/logic/link_watch.hpp)): a probe that cannot be *taken* is
  `Unmeasurable`, never counted as a failure — but no longer reported as *healthy* either. That
  conflation left a **blind** watchdog indistinguishable from a good link, and the memory pressure
  that blinds it is what accompanies the wedge it exists to break, so a *sustained* inability to
  measure (10 periods, ~5 min vs. 2 for proven silence) now re-associates too. Decisions log via
  `diag_printf` — reaching `/diag` + syslog — rather than the serial-only `ESP_LOGW` that left a
  wedged board with no off-device trace.
- **✅ Task Watchdog on the worker tasks.** The two tasks that do real, potentially-blocking I/O —
  the poll engine ([`hp_poll.cpp`](../main/hp_poll.cpp), X10A UART reads) and the MQTT publish task
  ([`mqtt_ha.cpp`](../main/mqtt_ha.cpp)) — subscribe themselves to the ESP Task Watchdog Timer
  (`CONFIG_ESP_TASK_WDT_*` in [`sdkconfig.defaults`](../sdkconfig.defaults), `TIMEOUT_S=20`,
  `PANIC=y`). `hp_poll` feeds it per cycle **and once per register** during the sweep (so a
  slow-but-progressing 9600-baud read is never mistaken for a hang); `mqtt_pub` feeds it
  unconditionally at the top of its 1 s loop (**not** gated on connection/publish, so a long broker
  outage can't false-trip) **and once per publish** (a ~30-message reconnect burst on a slow link
  stays within budget — the symmetric analogue of the per-register poll reset). The default
  idle-task watch catches CPU *starvation*; this adds the *blocked-but-still-scheduled* case (a
  wedged UART read or a stuck publish) it can't see. On a trip the device reboots cleanly with
  `esp_reset_reason() == ESP_RST_TASK_WDT` — classified as a fault and surfaced on
  `/status.last_crash` + the retained MQTT crash topic (§6), so a genuine hang becomes a
  diagnosable, self-healing reboot instead of a silent stall that needs a power-cycle.
- **✅ Stack-overflow watchpoint** (`CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y` in
  [`sdkconfig.defaults`](../sdkconfig.defaults)). A hardware watchpoint on each task's stack limit, so
  the **first** write past it panics at the offending instruction. IDF's default is the canary check,
  which is only compared at a context switch — and v1.0.12 is the case it misses: the `httpd` task ran
  460 bytes off its floor (`httpd 7728/460` in the core dump's task table), wrote past `pxStack` into
  its own TCB, overwrote `pvThreadLocalStoragePointers[0]` with `0x4`, and kept going; it died ~44 s
  later inside lwip's `pthread_getspecific` with a backtrace pointing at a WebSocket send that had
  nothing to do with it. A sparsely-writing frame can step over the canary words entirely (the
  neighbouring TLS[1] survived, which is how we know it did). Costs one of the two ESP32-S3 debug
  watchpoints — unused here, since this firmware is debugged from core dumps rather than JTAG. The
  same fix raised `httpd` to 12 KB ([`http_server.cpp`](../main/http_server.cpp)) and cut the peak by
  building the `/status` JSON with `+=` instead of long `+` chains
  ([`http_status.cpp`](../main/http_status.cpp)).
- **Modem sleep disabled** (`WIFI_PS_NONE`): trades the idle-power saving of DTIM sleep for a
  consistently responsive HTTP UI (no ~100–300 ms wake latency per inbound request).
- **mDNS + DHCP hostname** — reachable at `daikin-altherma-esp32.local`, and the router's client list
  shows the real hostname via DHCP option 12 (set before the DHCP client runs).
- **LWIP tuned for the workload** ([`sdkconfig.defaults`](../sdkconfig.defaults)): socket cap lifted to
  16 (http server + mDNS + SNTP + MQTT + OTA can otherwise starve the download of a BSD socket), and
  the TCP send/receive windows doubled — `CONFIG_LWIP_TCP_{SND_BUF,WND}_DEFAULT=11520`, 2× the IDF
  default of 5760 — which halves the round-trips the page costs. The page is **~71 KB gzipped**
  (229 KB spliced, ~3.1× compression), so it still spans ~7 window-fulls: the win is halving that,
  not clearing it in one. It has grown with the interactive schematic and is worth re-measuring when
  `www/` gains weight — run the build's own splice
  ([`inline_assets.cmake`](../main/www/inline_assets.cmake)) and `gzip -9`, since nothing minifies or
  strips comments (the served page is byte-identical to a hand-written monolithic `index.html`).

### Captive-portal provisioning

First boot with no WiFi config comes up as SoftAP `daikin-altherma-esp32-setup`
([`provisioning.cpp`](../main/provisioning.cpp)). A hand-rolled UDP:53 DNS server
([`captive_dns.cpp`](../main/captive_dns.cpp)) answers **every** A query with `192.168.4.1`, so a
joining phone's OS connectivity probe resolves to the device. One shared `:80` `esp_http_server`
handles both AP-setup and STA-run modes.

Auto-popping the portal then depends on answering that probe the way the OS recognises. Each one
fetches a well-known URL over plain HTTP right after associating — iOS/macOS
`captive.apple.com/hotspot-detect.html` (expects a `Success` body), Android
`connectivitycheck.gstatic.com/generate_204` (expects `204` + empty body), Windows
`msftconnecttest.com/connecttest.txt`. The `/*` catch-all
([`http_status.cpp`](../main/http_status.cpp)) answers all of them with **`302` +
`Location: http://192.168.4.1/`** plus `Cache-Control: no-store`, which is the one signal all three
agents act on; the portal root itself serves the page. Through **v1.0.7** the catch-all served the
page directly with `200`, which is only a heuristic (Android additionally weighs a parallel HTTPS
probe it cannot reach here) and sent `Content-Encoding: gzip` to probe agents that are minimal HTTP
clients rather than browsers — a redirect has an empty body, so gzip leaves the probe path entirely
while the browser that follows the redirect still gets the compressed page. Belt and braces, the
SoftAP's DHCP also advertises the **RFC 8910** captive-portal URI (option 114), which recent
iOS/Android prefer over probing at all. The setup-vs-STA split is
[`logic/captive.hpp`](../main/logic/captive.hpp), host-tested — in STA mode the same catch-all is the
dashboard's SPA shell and must not redirect.

The portal takes the SSID as **typed text** — it does not scan, offers no network dropdown, and
fetches nothing. So the radio runs **AP-only**: an earlier version ran APSTA with an idle station
interface for the single reason that `esp_wifi_scan_start()` needs a *started* STA, and without one
`GET /scan` failed and the dropdown fell back to a free-text box anyway. With the scan gone, so are
the extra interface and the channel-hopping blip a scan inflicts on the associated phone. `GET /scan`
itself survives as a trusted-LAN diagnostic; it is not on the open AP's surface
([`logic/http_surface.hpp`](../main/logic/http_surface.hpp)).

A typed SSID also handles what the picker could not: a **hidden** (non-broadcasting) network is
entered exactly like a visible one.

---

## 4. Web server & the WebSocket live transport

- **`esp_http_server` on `:80`** with `CONFIG_HTTPD_WS_SUPPORT=y`. The full HTTP surface is in
  [`.claude/CLAUDE.md` → HTTP API](../.claude/CLAUDE.md) and [`docs/README.md`](README.md).
- **✅ WebSocket push is the only live transport.** `GET /events` ([`http_status.cpp`](../main/http_status.cpp)):
  a client sends `sub`, gets a status+values snapshot, then the poll task pushes
  `{"type":"status"|"values",…}` frames on change (values ~1 s, status ~4 s). There is **no HTTP
  polling** — a browser without WebSocket falls back to a one-time snapshot. Broadcasts run in the poll
  task and self-guard `std::bad_alloc`, dropping a frame rather than the whole poll cycle (the task's
  own guard, below, is only their backstop).
- **🧪 Async sends have bounded backpressure**
  ([`logic/ws_tx_gate.hpp`](../main/logic/ws_tx_gate.hpp)). ESP-IDF queues each cross-task send and
  owns only a shallow frame copy until its completion callback runs. A congested HTTP control queue
  can therefore retain a payload after `httpd_ws_send_data_async()` has returned success. One
  independent gate for values and one for status admits at most one outstanding broadcast of each
  kind; while a callback is pending, newer ticks are dropped instead of consuming heap every second.
  Every client in a batch shares one immutable payload through a completion refcount, and the client
  list is snapshotted under its mutex before any IDF queue call. Thus a delayed or lost callback can
  hold at most two application payloads, not drain the whole device heap or couple the queue to the
  socket-close path.
- **🧪 Frame handling is a policy, not an `if`** ([`logic/ws_policy.hpp`](../main/logic/ws_policy.hpp)).
  Two rules, both host-tested. **Only a `sub` text frame takes a broadcast slot** — registering on any
  frame at all meant a client that never subscribed was still pushed a frame a second, and held one of
  the 8 slots from a client that had. And **a frame that does not fit the 16-byte command buffer is
  refused, not clamped**: the length known at that point is one `httpd_ws_recv_frame` read out of the
  header, which RFC 6455 lets a client set to any 64-bit value with nothing read to back it up — on a
  chip bounded by its largest contiguous free block it may decide, never allocate. Refusing means
  closing the connection, because the IDF fails an oversized read with `ESP_ERR_INVALID_SIZE`, leaves
  the body in the socket, and offers no way to skip it — so the unread payload would otherwise be
  parsed as the next frame's header.
- **🧪 Request bodies are reassembled, not assumed**
  ([`logic/http_body.hpp`](../main/logic/http_body.hpp)). A POST body is a TCP stream and
  `httpd_req_recv` returns only what has arrived — the IDF's own docs say a large body may take several
  calls. `http_read_body` loops until `content_len` is consumed, keeping the size cap and the 503
  guard, so a body split across segments no longer reaches the handler truncated and comes back as a
  spurious 400 "bad json". A `HTTPD_SOCK_ERR_TIMEOUT` is retried while progress keeps resetting the
  idle count, but only `BODY_MAX_IDLE` times consecutively: unbounded patience would let one client
  that announces a Content-Length and goes quiet park the single httpd task.
- **✅ Gzipped UI embedded in the app image.** [`main/CMakeLists.txt`](../main/CMakeLists.txt) inlines
  `www/{index.html,style.css,app.js}` into one page and pre-gzips it at build time (`EMBED_FILES` →
  `_binary_index_html_gz_*`); shipping it pre-compressed cuts first-paint bytes ~3× over WiFi. The
  captive `setup.html` is embedded the same way.
- **✅ OOM discipline** ([`http_common.cpp`](../main/http_common.cpp)): request handlers run under a
  `try/catch` that returns **503 instead of crashing**, because an uncaught throw would unwind through
  esp_http_server's C frames → `std::terminate` → reboot. Large output is streamed, not built as one
  contiguous `std::string`. This is a first-class constraint on this heap-tight target — see
  [`ARCHITECTURE.md` → Memory constraints](ARCHITECTURE.md).
- **✅ The same discipline covers every allocating FreeRTOS task loop**, since a task entry is a C
  frame boundary exactly like a handler is: `poll_task` ([`hp_poll.cpp`](../main/hp_poll.cpp)),
  `mqtt_task` ([`mqtt_ha.cpp`](../main/mqtt_ha.cpp)) and `status_led_task`
  ([`status_led.cpp`](../main/status_led.cpp)) each wrap their loop body, log once and skip the cycle
  keeping the last good state. Its corollary is that **a throw must never strand a mutex**:
  `xSemaphoreTake` is not released by unwinding, so a throw inside a critical section would leave the
  lock held and wedge every reader — worse than the reboot the guard prevents. Two mechanisms cover
  it: `hp_poll.cpp`'s stat commit is written to be non-allocating (staged deltas folded in with `+=`
  and a `noexcept` swap) so it cannot throw at all, and the readers that must copy `std::string`s out
  under the lock — `hp_stats`/`hp_values_snapshot`, and `config()` in
  [`config.cpp`](../main/config.cpp) — take it through an RAII `Lock` that releases on unwind.
- **✅ Chunked core-dump streaming** (`GET /coredump`): the flash core-dump image is streamed in 512-byte
  chunks, never buffered whole.

---

## 5. Home Assistant / MQTT bridge

[`mqtt_ha.cpp`](../main/mqtt_ha.cpp) (deep dive: [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md),
[`ARCHITECTURE.md` → MQTT bridge](ARCHITECTURE.md)). Built on **esp-mqtt** (a managed component since
IDF v6.0 extracted it from core — [`idf_component.yml`](../main/idf_component.yml)):

- **✅ 🧪 HA MQTT auto-discovery.** One retained discovery config per value of the active profile
  ([`logic/discovery.hpp`](../main/logic/discovery.hpp)); every sensor points at **one shared grouped
  state topic** `<base>/state` ([`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp)),
  republished only when the payload changes so a quiet pump doesn't spam the broker. The message
  topics sit directly under `<base>` (one board per base topic); the node id
  ([`logic/ha_device.hpp`](../main/logic/ha_device.hpp)) identifies the device only in each discovery
  config's `uniq_id`/`dev.ids`, not the payload path — and it is the slugified **base topic**, not
  the board's MAC, so replacing the ESP32 keeps one HA device with its entities and statistics
  instead of creating a second one (the MAC id stays on as the MQTT client id + a second `dev.ids`
  entry HA merges on, and the configs published under it are retracted once per boot).
  A **bit-flag** value (converter family 300-307, `conv_is_binary`) is typed as a `binary_sensor` with
  an explicit `pl_on:"1"`/`pl_off:"0"` and published as the JSON **number** `1`/`0`
  (`binary_state_number`) — HA gets a real on/off entity, and a metrics consumer (which drops strings
  *and* bools) finally gets the ~30 binary rows per profile that used to be invisible to it. The
  device's own `/values`, web UI and WebSocket keep showing `ON`/`OFF`. The pre-split `sensor`
  discovery config is actively deleted on upgrade (`retired_sensor_discovery_topic`).
- **✅ 🧪 Detect-only rows are never announced — and are actively retracted.** A profile row flagged
  `ValueDef::no_publish` ([`logic/value_def.hpp`](../main/logic/value_def.hpp)) is skipped by the poll
  cache, and `publish_discovery` publishes a **zero-length retained** payload to its discovery topic
  so an install upgrading from a build that *did* announce the row doesn't keep a retained config —
  and therefore a permanently-unavailable HA entity — forever. This covers an absent-feature register
  such as the `0x64` hybrid/boiler page on a non-hybrid monobloc/hydrobox: the unit answers the page,
  but every value on it is a placeholder (a `-40.4 °C` 2nd-DHW probe that does not exist, `Hybrid Op.
  Mode` "Boiler only" with no boiler). The row is **kept** rather than deleted because a profile's
  detection signature is the set of pages its rows reference (`def/signatures.hpp`) and
  `detect_candidates` picks maximal page overlap — dropping the row would make the correct profile
  lose a page to a feature-richer *wrong* profile that kept it, so the model would mis-detect and the
  same garbage would return through that table. Pinned by `test_no_publish()`.
- **✅ TLS with the IDF CA bundle.** Credentials present ⇒ `mqtts://` + `esp_crt_bundle` verification.
  Credentials are **never** sent over a plaintext broker — the client refuses to start and surfaces
  the reason in `/status.mqtt`, with **no silent fallback**.
- **✅ Save-time broker pre-flight** ([`http_config.cpp`](../main/http_config.cpp)): `POST /set_mqtt`
  verifies the broker **before** it persists — WiFi up → the same `mqtts://`-for-credentials policy as
  the bridge → DNS → a non-blocking TCP port probe → a short-lived esp-mqtt client that must actually
  `CONNECT` (and authenticate) — so a wrong host, closed port or bad password is rejected **inline at
  Save** rather than failing silently after the reboot. The transient (TLS) validation client is
  guarded by a largest-free-block check: under heap pressure it skips the connect probe (DNS + port
  were already checked) rather than risk OOM-ing the live bridge. The parsed host/port come from the
  host-tested [`mqtt_uri.hpp`](../main/logic/mqtt_uri.hpp), whose scheme defaults track **esp-mqtt's
  own** (`mqtt://` 1883, `mqtts://` 8883, `ws://` 80, `wss://` 443) so the probe dials the port the
  client will, which keeps a WebSocket broker's URL path (`wss://host:8084/mqtt`) out of the host and
  port while esp-mqtt still receives the full URI, and which rejects a non-digit port or one outside
  1–65535 at parse time (the probe's `htons()` truncates `:65537` to `:1`).
- **✅ Explicit credential clearing** ([`http_config.cpp`](../main/http_config.cpp)): empty
  username+password means *keep the stored credentials* — the modal never prefills them, so a
  broker-only edit never wipes them. Empty therefore can't also mean *remove*, so `clear_creds:true`
  (the MQTT modal's "remove stored credentials" checkbox, gated on `/status.mqtt.has_creds` — whether
  credentials are stored, never their value) is the explicit signal; a non-empty username/password is
  an explicit set and wins over the flag. It is the only path from an authenticated `mqtts://` broker
  to an anonymous one — previously the kept credentials rejected every plaintext broker and only a
  flash erase escaped.
- **✅ Availability (LWT).** A retained `offline` last-will on `<base>/status`, flipped to
  `online` on connect — HA marks every entity unavailable if the device drops.
- **Read-only by design.** No command subscriptions; the bridge only reads the pump.

---

## 6. Diagnostics & observability

A deliberately strong story for a hobby-scale device — everything needed to explain a crash *after
the fact*, from the field, without a serial cable:

- **✅ Core dump to flash (ELF format).** `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH` into a dedicated
  `coredump` partition; ELF is the only core-dump format IDF v6 emits, so nothing selects it
  explicitly. [`diag_crash.cpp`](../main/diag_crash.cpp)
  reads the reset reason + `esp_core_dump_get_summary()` **once at boot** (crashed task/PC/backtrace/
  app-elf-sha), caches it, and never re-parses on a request path. The cheap `coredump` **presence
  flag** is deliberately *not* cached — `diag_crash_info_live()` re-reads it (one 4-byte flash read)
  per request, so a dump erased via `/coredump?clear=1` can't strand a banner advertising a dump that
  is gone.
- **✅ Offline symbolication** ([`decode-coredump.sh`](../scripts/decode-coredump.sh)): `GET /coredump`
  pulls the raw image; the script symbolizes it with `esp-coredump` in the CI-pinned IDF image against
  the matching **unstripped `.elf`** (archived per build/PR by CI). The dump embeds `app_elf_sha256`
  and the device reports the same on `/status`, so a wrong ELF is *caught*, not silently mis-decoded.
- **✅ 🧪 Reset/crash classification** ([`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp)): the
  captured summary becomes the `/status.last_crash` JSON (drives the UI crash banner, whose title keys
  on `fault` — an orphan dump alone never claims the device crashed *this* boot) and a **retained**
  `<base>/crash` MQTT payload (**one** diagnostic HA entity: a "dump waiting" flag —
  reason/backtrace only, **never** the raw dump or any secret; the reset reason is the heartbeat's own
  "Reset Reason" sensor, so the old duplicate "Last Reset Reason" crash entity was dropped + is
  actively retired — its stale retained discovery config is deleted on upgrade). The crash topic is
  **crash-only**:
  `build_crash_mqtt_payload()` emits the JSON only when the boot is *notable* (a real fault **or** a
  core-dump still in flash) and returns `""` otherwise, which the bridge publishes as a **zero-length
  retained** message that **clears** the topic — so a normal boot (USB re-enumeration, config-save/OTA
  reboot, clean power-on) sends no crash message, and a stale crash record disappears from the broker
  (and HA) as soon as the device reboots cleanly, i.e. once the problem is resolved. Clearing loses no
  information — the reset reason is carried unconditionally by the heartbeat's own "Reset Reason"
  sensor (`reset_reason_name` == `crash_reason_slug`, host-asserted). Published per (re)connect and
  republished on the heartbeat cadence when the "dump waiting" flag changes, so it can't latch ON after
  the dump is cleared (and an orphan-dump-only boot is then re-decided not-notable and cleared).
  `static_assert`s pin the IDF reset-enum values so a renumbering fails the build rather than
  mislabeling every crash.
- **✅ 🧪 19-entity device heartbeat** ([`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp)): on a fixed
  10 s cadence, `<base>/heartbeat` streams a **flat** JSON (each field prefixed by its block name —
  `wifi_rssi`, `wifi_mac`, `bus_rx_received`, … — no nested `wifi`/`mqtt`/`bus` sub-objects) of heap
  (free / min-free / **largest-free-block**, the true OOM limit — all three now their own HA entities),
  uptime, the **last reset reason**, the **SNTP wall clock** (`sntp_time.cpp`,
  `device_class:"timestamp"` — HA's native "N ago" entity, the one HA-idiomatic use of the device's
  own clock; `null` until synced, never a fabricated epoch date), WiFi RSSI + reconnect count + the
  STA **MAC** and associated-AP **BSSID**, MQTT publish/fail/reconnect counters, and X10A bus
  rx/fail/crc/timeout stats — published independently of heat-pump profile detection, so board
  health is visible even while the model is still `auto`.
- **✅ 🧪 Always-on system health** ([`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp)): the
  `/status` document (and the `/events` status frame) carries a compact `sys` block — `free_heap`,
  `min_free_heap` (since-boot low-water, the leak indicator), `max_alloc` (largest contiguous block,
  the real OOM ceiling), the `reset_reason` slug and a `safe_mode` flag. Unlike `last_crash` it is
  present on **every** boot, and unlike the heartbeat it needs **no broker**, so "why did it reboot?"
  and "is the heap leaking?" are answerable from the LAN alone. `reset_reason_name()` reuses the
  crash slug vocabulary (one naming for the sys block, the `last_crash`/crash payload and the
  heartbeat's "Reset Reason" sensor). The
  Settings ESP32 card renders the reset reason (fault-coloured) and free heap.
- **✅ Build identity** — `/status.app_elf_sha256` ties a running device to the exact firmware that
  produced any dump, and the syslog boot line (below) puts the same hash in the **log stream**, so a
  captured stream stays attributable to a binary after the device has moved on.
- **✅ In-RAM diag ring** (`GET /diag`) and a **status indicator** ([`status_led.cpp`](../main/status_led.cpp))
  encoding setup-portal / WiFi-connecting / all-healthy / X10A-error / MQTT-error / no-WiFi-mode as
  six distinct blink patterns (X10A-error outranks MQTT-error — the bus is the point of the device),
  plus two the recovery button asserts (reset armed / erasing). Two back-ends — a level-driven GPIO
  LED and an addressable WS2812 over RMT — render **one** host-tested pattern table
  ([`logic/led_pattern.hpp`](../main/logic/led_pattern.hpp)), and the pin, driver and polarity come
  from NVS (`POST /set_board`), not Kconfig: CI publishes a single `esp32s3` image, while a Seeed
  XIAO ESP32-S3 (plain LED, GPIO21, active-low) and an M5Stack AtomS3 Lite (WS2812, GPIO35) disagree
  about their onboard parts, so compiling one in would fork the artifact, the manifest and the OTA
  feed per board. Because a monochrome LED sees no colour, every phase stays distinguishable by
  blink *shape* alone; the colour is a bonus on an RGB board, never the sole carrier of a state.
- **✅ 🧪 Physical recovery button** ([`recovery_button.cpp`](../main/recovery_button.cpp)): held for
  5 s it erases the whole `daik_cfg` NVS namespace and reboots into the setup portal. It is the only
  config reset that does not go through the network, which is exactly the failure the other paths
  cannot reach: the device joined a network the user can no longer get onto. (The credential rollback
  in [`wifi.cpp`](../main/wifi.cpp) covers a *rejected* password — not a wrong-but-accepted LAN.)
  Before this, the cure was opening the enclosure for USB + `erase_flash`. Classification is pure and
  host-tested ([`logic/button.hpp`](../main/logic/button.hpp)): an **arm checkpoint** at 1.5 s lights
  the warning while there is still time to let go, and a debounced release means one bounced sample
  can neither cancel a hold nor silently restart its clock. It is **disabled by default** (`-1`) —
  an unconfigured input floats, and a floating pin reading "pressed" for five seconds would wipe a
  board nobody touched — and a button already held at boot is ignored until the pin reads released
  once. The erase itself is milliseconds, so the indicator leads it and is held to a duration a human
  registers; a **failed** erase deliberately does not reboot, since coming back up on the config it
  just claimed to delete is worse than staying up and logging why.
- **✅ 🧪 SNTP wall clock, runtime-configurable** ([`sntp_time.cpp`](../main/sntp_time.cpp)): before
  this the device had no timestamp anywhere except uptime-since-boot. `esp_netif_sntp` polls the
  configured server (`config().ntp_server` — NVS `ntp_server` override of `CONFIG_DAIKIN_NTP_SERVER`
  default `pool.ntp.org`, editable at runtime via `POST /set_ntp` and the NTP row of the Connections
  tile in Settings, exactly like Syslog) once online — non-blocking, so it idles/retries harmlessly
  even during AP-only setup mode. Once synced, the RFC 3339 UTC instant
  ([`logic/timestamp.hpp`](../main/logic/timestamp.hpp)) reaches the top-level `/status.ntp` block
  (`{server,synced,time}`, mirroring `syslog{}` rather than `sys{}` — it's a runtime-configurable
  service, not a static board fact) and the syslog TIMESTAMP field below; before the first sync of a
  boot both fall back to `null`/`-` rather than a fabricated epoch date. The NTP row shows
  the configured server, coloured `--ok` once synced and `--warn` while syncing (DESIGN.md §5.6,
  the Connections tile) — the synced wall clock itself isn't shown on the row (no room in a
  one-line tile), but remains
  available via the MQTT heartbeat's `device_time` sensor and `/status.ntp.time`. An empty
  `/set_ntp` save is read on the next boot as "reset to the compile-time
  default" — unlike Syslog/MQTT, SNTP has no disabled state to preserve, so empty can't mean "off"
  here. The diag ring's uptime prefix is unchanged — it's what `device-triage` keys on to reconstruct
  reboots (an uptime that jumps backwards) and stays available before SNTP has synced, when a
  wall-clock prefix would still be blank.
- **✅ Off-device log forwarding** ([`syslog.cpp`](../main/syslog.cpp)): every diag line is also
  forwarded as one RFC 5424 UDP datagram to an optional collector (`/set_syslog`; empty host = off).
  The TIMESTAMP field is the SNTP wall clock once synced, else the `-` NILVALUE a collector
  conventionally substitutes its own receive time for. Delivery is gated on **DNS only** — the
  ARP/ICMP reachability probe is advisory (`/status.syslog`), since a healthy collector may firewall
  ICMP. Self-loop-guarded (drops its own `syslog:` lines).
- **✅ 🧪 One-shot boot replay to syslog** ([`logic/bootlog.hpp`](../main/logic/bootlog.hpp)): the
  crash summary is captured at the top of `app_main` — before WiFi and before the syslog task exists —
  so it could only ever reach the in-RAM ring, where a chatty failure mode overwrites it within a
  minute. On the **first DNS resolve of a boot** the syslog task replays it once, straight down the
  socket (the queue is full of the boot backlog by then, and the enqueue is non-blocking): a
  build-identity line (`version` / `elf_sha256` / `reset` / `safe_mode`) always, plus the reset reason
  and crashed task/PC/backtrace when the last boot was a fault. Records are **single-line and
  datagram-sized** — the multi-line `build_crash_text()` is ~340 B at worst case and truncates past
  diag's 256-byte line buffer, losing the backtrace tail and `elf_sha256`. Host tests assert the size
  budget and that a clean boot emits **zero** crash lines.

---

## 7. Heat-pump protocol engine (X10A)

Deep dives: [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md), [`REGISTERS.md`](REGISTERS.md).

- **✅ Dedicated hardware UART at 9600 8E1** ([`hp_comm.cpp`](../main/hp_comm.cpp)) on `UART_NUM_1`,
  physically separate from the native USB-Serial/JTAG console, so device logs never collide with
  heat-pump traffic. Any two free GPIOs map to it (the RX/TX pin cache in NVS). The driver installs
  **once**; a pin change is a register-only `uart_set_pin` **remap**, not a `uart_driver_delete` +
  `install` (host-tested decision in [`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp)). The old
  reinstall-per-swap allocated a fresh RX ring + driver struct every call, and the detect sweep
  alternates the pins ~2×/s on a silent bus — that alloc/free churn fragmented the heap until an
  unrelated allocation ([`hp_poll.cpp`](../main/hp_poll.cpp)'s value `vector`) threw a `std::bad_alloc`
  too starved to unwind → `std::terminate` → `abort`, **confirmed by a symbolized coredump**.
- **✅ 🧪 Poll engine** ([`hp_poll.cpp`](../main/hp_poll.cpp)): profile registers → query → decode →
  thread-safe value cache the web UI and MQTT read; also drives the WebSocket broadcast each cycle.
  The value vector is `reserve`d to its exact upper bound (one sized allocation, not `log2(n)` regrows).
- **✅ 🧪 Silent-bus detect backoff** ([`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp)):
  while no unit answers, the auto-detect sweep stretches from the 1 s poll cadence toward a 60 s
  ceiling by **skipping sweep ticks** — the poll task's 1 s top-of-loop watchdog reset still fires, so
  any ceiling stays watchdog-safe and the ceiling is a detection-latency choice, not a WDT constraint.
  A bus answer, `POST /detect` or `POST /set_hp` (new pins) resets it to full cadence at once, so a
  just-wired unit is still detected on the next cycle.
- **✅ 🧪 Auto-detection every boot** ([`hp_detect.cpp`](../main/hp_detect.cpp),
  [`logic/detect.hpp`](../main/logic/detect.hpp)): a protocol sweep + page probe builds a bus
  *fingerprint* (page mask + capacity + OU EEPROM) that narrows the Altherma-only signatures to a
  register-equivalent candidate set. The physical **link** (pins/proto) is cached in NVS; the **model**
  is re-detected in RAM every boot, so a swapped unit is re-identified with no reconfiguration.
- **✅ 🧪 Value converters** ([`logic/convert.hpp`](../main/logic/convert.hpp) + 44 generated
  [`def/`](../main/def) profiles): the converter-id decides how each raw register field becomes a typed,
  unit-carrying value — the riskiest part of the port, and the most heavily host-tested.

---

## 8. The host-tested pure-logic core (the quality backbone)

The single most distinctive engineering choice: **all the risky, target-independent logic lives in
IDF-free headers under [`main/logic/`](../main/logic) and is verified on the host** — no board, no
Docker, in seconds ([`test/README.md`](../test/README.md), [`ARCHITECTURE.md` → logic core](ARCHITECTURE.md)).

- **🧪 What's covered** — CRC & framing (`crc.hpp`), value converters (`convert.hpp`), register
  extraction (`registers.hpp`), the `ValueDef` profile-row type the generated `def/*` tables are
  written in (`value_def.hpp`), the config model/validation + the field-owned detection patches
  (`config_model.hpp` — `apply_link`/`apply_model` touch only the link / model, so a detection commit
  cannot revert a concurrent `/set_wifi`), HA-discovery payloads
  (`discovery.hpp`) and the HA **device identity** every one of them shares (`ha_device.hpp` — the
  node id is the slugified MQTT base topic, so replacing the board keeps one device in Home
  Assistant instead of duplicating it), detection (`detect.hpp`), the OTA health gate (`health_gate.hpp`), heartbeat &
  crash formatting (`heartbeat.hpp`, `crashinfo.hpp`), the syslog boot/crash replay records
  (`bootlog.hpp`), the syslog hard-vs-transient send-error policy (`syslog_policy.hpp`), the
  gateway-watchdog policy (`link_watch.hpp`), the WiFi credential-rollback policy
  (`wifi_rollback.hpp`), the reset-reason vocabulary (`reset_reason.hpp`),
  the boot-loop safe-mode decision (`boot_guard.hpp`), grouped state JSON (`mqtt_group.hpp`), the
  RFC 8259 JSON string encoder every payload shares (`json.hpp` — escapes `"`, `\` and every control
  byte, so an SSID from any AP in radio range can't emit JSON the setup portal fails to parse), the
  broker-URI split (`mqtt_uri.hpp`), the X10A GPIOs the RX/TX picker may offer
  (`board_pins.hpp` — the ESP32-S3 chip-safe set, minus GPIO33-37 on Octal flash/PSRAM builds and
  minus the pins the firmware itself drives (`ReservedPins`: the status indicator **and** the
  recovery button), since chip-safe is not the same as free: `status_led.cpp` holds its pin as a
  push-pull output and `recovery_button.cpp` holds its own as a pulled input, so offering either
  would be a pick that cannot work — and
  `board_pin_offerable()` makes that list a *rule* rather than a dropdown filter, enforced on the
  request path (`validate()`, naming the offending pin) and on the load path (`config_load()` via
  `link_pins_safe()`), so neither a raw `POST /set_hp` nor a stale NVS link cache can route the X10A
  UART onto a flash/strapping/JTAG pad and crash-loop the board; the *different* local-I/O set
  (`board_pin_local_io()`) is what the indicator and button themselves may use — wider by the
  four dedicated-JTAG pads, withheld from the X10A list only to keep a debug probe usable, which is
  a preference an onboard part soldered to GPIO41 simply overrides, and **narrower** by the X10A
  link's own `rx`/`tx`, because the reservation runs in **both** directions: `board_hw_valid()`
  refuses a local pin that equals either link pin, so a picker still listing them offers a choice
  whose only outcome is a `400`. `ReservedPins` is deliberately anonymous about which pair it carries
  (`pin_a`/`pin_b`) — naming its fields after one direction made the other read as a lie — and the
  two factories `config_reserved_pins()` / `config_link_pins()` state the direction at the call site),
  the ready-made per-board settings behind the Hardware modal's *Board* pick
  (`board_presets.hpp` — the five board-local fields for each **documented** board, served as
  `/status.board.presets`; in firmware rather than in `www/app.js` precisely so these `CHECK`s can
  assert every offered preset passes the same `board_hw_valid()` the request path applies, and so a
  preset this **build** reserves (an Octal build over the AtomS3 Lite's GPIO35) or this **config**
  reserves (a link moved onto that preset's LED or button pin) is withheld instead of offered as a
  pick `POST /set_board` would refuse — it asserts nothing about which board this *is*, which stays
  unknowable),
  the status indicator's state→pattern rule and the button override's priority
  (`led_pattern.hpp` — shared by the GPIO and WS2812 back-ends so they cannot drift apart; *shape*,
  not colour, carries the state, since a monochrome LED sees no colour at all),
  the recovery button's press classifier (`button.hpp` — the tested half is the **abort** path: the
  action it gates erases the user's whole configuration, so "held 4.9 s then let go" must destroy
  nothing and one bounced sample must not read as a release),
  the `/events` frame policy (`ws_policy.hpp` — an announced frame length is
  a client-asserted 64-bit number, so it decides and never allocates; only a `sub` **text** frame
  earns a broadcast slot), its async-send backpressure (`ws_tx_gate.hpp` — at most one values and one
  status batch are retained while the HTTP task is busy), request-body reassembly
  (`http_body.hpp` — a body arrives across as many TCP segments as the network chooses, and a peer
  that stalls forever must lose *bounded*),
  the captive-portal reply policy (`captive.hpp` — whether the `/*` catch-all answers an unmatched
  GET with the page or a `302` to the portal. The tested half is the **STA carve-out**: in setup
  mode the OS connectivity probes must get the redirect all three agents act on, but in STA mode the
  same route is the dashboard's SPA shell and must not redirect — and of those two regressions only
  the first gets reported, so the second is exactly the kind that needs a `CHECK`. It also pins the
  portal address to one literal, since a redirect to a host the captive DNS does not answer for is a
  dead end nothing on the device would notice),
  the X10A UART (re)init decision (`uart_plan.hpp` — probing the same pins is a no-op and a pin change
  is a register-only remap, not a driver reinstall, so the detect sweep stops churning the heap),
  the silent-bus detect backoff (`detect_backoff.hpp` — full cadence through a grace window, then
  geometric growth clamped to the ceiling, monotonic and overflow-safe, reset the instant the bus answers),
  the English description lookup layered on the conv-204 fault code
  (`error_codes.hpp` — a presentation-only enrichment: it never changes what conv 204 decodes,
  and a code outside its coverage still publishes as the bare code),
  **🔭 Modbus TCP framing + HomeHub register codecs** (`modbus.hpp` — MBAP
  framing without CRC, FC03/04/06/16 build + **request-bound** parse (an exception PDU must be exactly
  2 bytes, a read reply must carry the requested register quantity, and a write echo must match the
  requested address + value/quantity), `Temp16`/`Pow16`/`Int16`/`Text16` decode/encode,
  the `homehub-*` mDNS filter; the host-tested core for the *planned* firmware-exclusive HomeHub
  Modbus link (issue #32), **not yet wired into the firmware**), and the SNTP wall-clock RFC 3339
  formatter (`timestamp.hpp` — the one place the syslog TIMESTAMP field, `/status.ntp.time` and the
  MQTT heartbeat's `time` field render through; a negative/never-synced input renders `""`, never a
  fabricated `1970-01-01`), the **OTA downgrade gate** (`version_cmp.hpp` — numeric dotted-version
  ordering plus `ota_is_upgrade()`, which fails closed on anything it can't parse) and the **OTA
  manifest parser** (`ota_manifest.hpp` — the one place a remote, attacker-influencable byte stream is
  parsed on this device: bounded, allocation-free, depth-aware, escape-aware, and it refuses rather
  than truncates an oversized value), the **HTTP trust-surface boundary** (`http_surface.hpp` — which
  routes each surface exposes, so the open setup AP serves only the provisioning routes while
  `/coredump`, `/diag` and the config/OTA/MCP surface stay trusted-LAN-only), the **atomic config
  save** (`config_store.hpp` — the credential/service fields are one CRC-checked NVS blob so a save is
  all-or-nothing across a write failure or a power cut), the **JSON-RPC 2.0 response policy** for the
  planned MCP route (`mcp_jsonrpc.hpp` — parse-error / invalid-request / notification-no-response /
  method-not-found, and which id may be echoed) and the **query-flag policy** (`query_flag.hpp` — a `?clear=1`-style flag
  acts only on exactly `1`, so `?clear=0` no longer wipes the diag log), and the **leaving-water
  measurement picker** (`lwt_select.hpp` — the host-testable twin of the web UI's `lwtRow`/`vLwt`,
  through which *every* browser consumer resolves — the schematic pill, the derived figures and the
  inspector's leaving-water rows alike, so a looser second copy cannot re-open the substitution
  outside the gate's reach: the row
  that feeds the dashboard's ΔT / heat output / COP must be the pre-BUH heat-exchanger outlet (R1T)
  and never a setpoint / mixed-zone / post-BUH (R2T) row — a setpoint substituted for a measurement
  makes all three plausibly wrong, issue #121, the #35–#39 failure shape; keyed on the (R1T) tag so
  the alias label forms resolve too, and gated catalog-wide so every detectable profile selects a
  real measurement), the **held-over outdoor reading rule** (`ou_stale.hpp` — the other host-testable
  twin of a browser rule: the outdoor unit refreshes its *own* register pages (`0x20` sensors, `0x21`
  inverter) only while it runs, and stopped it answers with the last run's values, so the schematic
  stops drawing them as live — measured, outdoor air held
  exactly 19.0 °C for five hours and stepped only when the compressor started. Page `0x10` is
  deliberately excluded: it carries `Defrost Operation`, a run-state input, and blanking a reading
  costs information where suppressing a state input would corrupt the state machine. Gated
  catalog-wide, and the load-bearing half is the second assertion — every profile keeps
  `INV frequency (rps)` on a page that stays live, which is what makes "Standby — not running"
  trustworthy beside the held ones. **How** they stop being drawn as live splits on what the
  quantity is. A held *measurement* is greyed with the `#heldNote` legend rather than hidden — it is
  a real reading, just old, and blanking it read as a lost link (the v1.0.11 bug report). A held
  *working point* is blanked, because at rest it is not an old value of the quantity but a wrong
  one: ΔT with no flow, and the **electrical estimate**, which prefers the CT clamps on the live
  hydronic page `0x63` and falls back to
  `INV primary current`, a `0x21` row that freezes with the rest of that page. Every catalog profile
  carries the INV row and only about half carry CT clamps, and an idle plant reads a CT sum of 0 — so
  an ungated fallback drew the last run's amps as a live kW figure on most installs most of the time,
  and a stopped compressor draws ~0, not the 1.4 kW the frozen current implies.
  The catalog test pins which page each of the two sources sits on, and both the sub-label and the
  inspector distinguish "compressor off · no live reading" from "no current sensor": suppressing one
  wrong claim must not substitute another), and the **raw-page hex rendering** (`hexdump.hpp` — the wire bytes of pages
  `0x00`/`0x10`/`0x20`/`0xA0`/`0xA1` on `/diag`; truncation stops after the last *complete* byte, since a trailing
  nibble would read as a different value, and degenerate inputs still terminate the buffer the caller
  hands to a `diag_printf` `%s`).
  **1169 `CHECK`s** in
  [`test/test_logic.cpp`](../test/test_logic.cpp).
- **The fast loop** — [`scripts/run-mock-tests.sh`](../scripts/run-mock-tests.sh) compiles + runs the
  suite with the plain system toolchain (`cmake` + `g++`/`clang++`, one translation unit). This is the
  real "run it and see" loop even in an environment that can't build firmware or USB-flash.
- **The rule** — new decode/config/discovery logic goes in `main/logic/` with a `CHECK`, never buried in
  a device-only `.cpp`. The [`add-logic-test`](../.claude/skills/add-logic-test/SKILL.md) skill and the
  [`x10a-decode-reviewer`](../.claude/agents/x10a-decode-reviewer.md) agent enforce it.
- **✅ The limit of the above — and the second loop that covers it.** The `CHECK`s verify the logic
  they are handed; none of them can see a value that is well-formed, compiles, drifts no doc, and is
  *physically false*. A wrong converter id published `-971.5 °C` as a mixed-water temperature on eight
  profiles, a valve **position** reached Home Assistant as a 12800 °C temperature sensor, and a "no
  data" sentinel was published as a real `-3276.8 °C` reading (issues #35–#39) — all green, all
  shipped, all found only by slow manual review. So the value catalog has its own host loop:
  [`scripts/run-domain-audit.sh`](../scripts/run-domain-audit.sh) runs the **real** converters over the
  **real** `def/*` catalog and cross-checks both against [`REGISTERS.md` §5](REGISTERS.md) — one source
  of truth, nothing to drift. It reports wrong converters, spec/layout drift, cross-profile outliers,
  non-temperatures typed °C, and straddling byte windows, each with a decode witness (wire bytes → what
  the value should read → what the row makes of it).
  [`tools/domain/selftest.sh`](../tools/domain/selftest.sh) re-introduces all four shipped bugs into a
  throwaway copy and requires the audit to catch each, so a checker that has quietly stopped checking
  cannot pass as "clean". Adjudicated deviations live in
  [`audit_exceptions.txt`](../tools/domain/audit_exceptions.txt) and stay visible in the audit's
  `suppressed` output. The judgement half is the
  [`domain-review`](../.claude/skills/domain-review/SKILL.md) skill, a PR-merge gate required on every
  merge.

---

## 9. Build system & release engineering

- **✅ Deterministic toolchain.** There is no local ESP-IDF install:
  [`idf-docker.sh`](../scripts/idf-docker.sh) runs every build in the `espressif/idf` image, its version
  **read at runtime from [`.github/workflows/build.yml`](../.github/workflows/build.yml)** — a single
  source of truth (currently ESP-IDF v6.0.2, kept current by Renovate), so local builds can never drift
  from CI.
- **✅ CI gate order** ([`build.yml`](../.github/workflows/build.yml)): one fast, hardware-free
  `gates` job runs first and the firmware build `needs` it — the host logic suite, the
  value-catalog audit + its selftest (§8) and the Pages-publish test, as three steps; only then the
  esp32s3 firmware build → sign → merge → artifact upload. A decode/config/discovery regression, or
  a value that is well-formed but physically false, fails in seconds, not minutes. Three steps and
  not three jobs because Actions bills each **job** rounded up to a whole minute: the same ~40
  seconds of checking cost 3 billed minutes as jobs and 1 as steps.
- **✅ Crash-decodable forever.** CI archives the unstripped `.elf` (+ sha256) per version/PR, so every
  build's core dumps stay symbolizable ([`ci-build-all.sh`](../scripts/ci-build-all.sh)).
- **✅ One Pages publisher.** The browser installer is served from the **`gh-pages` branch**, pushed by
  [`publish-pages-branch.sh`](../scripts/publish-pages-branch.sh); the repo's Pages source must be set to
  that branch ([`README.md`](README.md)). The branch model is what lets the release root and the
  `dev/` channel be published independently — an atomic whole-site Actions deployment replaces the
  whole site at once and cannot — so the
  `configure-pages`/`deploy-pages` path is deliberately absent rather than redundant: a repo's Pages
  source is either a branch or Actions, never both.
- **✅ Releases are manual; merges publish a dev channel.** ([`build.yml`](../.github/workflows/build.yml))
  A push to `main` builds, stamps `<next release>-dev.<n>` and republishes **`gh-pages` `dev/`** —
  no tag, no GitHub Release. A release is an explicit act: *Run workflow* with `release: true` and a
  bump level, which stamps `X.Y.Z`, creates the `v*` tag + Release, and republishes the **root**.
  The two feeds are otherwise identical in shape, so the installer page, `esp-web-tools` and the
  device OTA client work against either without a special case. Before this, every firmware-relevant
  merge auto-tagged a release, so "the latest release" only ever meant "the last thing merged" and
  there was no way to run a build that had been deliberately cut.
- **✅ Concurrent publishers survive losing the race.** That one branch has *two* writers — the
  release root publish and every merge's `dev/` publish — and they overlap routinely. Actions cannot serialize them: a `concurrency:` group is per **job**, and the publish is
  the last step of a ~5-minute firmware build, so grouping would serialize that entire build across
  a merge to protect a 2-second push. So the script survives the race instead of avoiding it — it
  refreshes `origin/gh-pages` immediately before publishing (never trusting the ref
  `actions/checkout` froze at job start) and, on a non-fast-forward, re-applies its change onto the
  winner's commit and pushes again, up to 5 attempts. Only a lost race retries; an auth or
  hook rejection is fatal at once. This is sound only because every mode is **declarative** —
  `--dev` replaces `dev/` wholesale and root replaces everything except `dev/` — so re-applying
  yields the same tree as winning would have.
  Naming `dev/` in the root's sweep is load-bearing, not tidiness: a release would otherwise take
  the dev feed offline until the next merge happened to republish it, silently, since nothing else
  reads that path. Guarded by
  [`run-pages-publish-tests.sh`](../scripts/run-pages-publish-tests.sh) (a CI `gates` step),
  which races two publishers against a throwaway bare repo, including one that lands *between* the
  loser's fetch and its push. Before this, the loser's push was simply rejected and its whole build
  went red — and because a re-run always went green, it read as a flake rather than a bug.
- **✅ Publishes from a private repo — and the Pages site is public.** The pipeline no longer gates
  publishing on `repository.private == false`; that gate was removed so the installer and the OTA feed
  can go live before the source does. Two consequences worth knowing precisely: **(a)** a Pages site
  cannot be access-controlled outside an *organization* on GitHub Enterprise Cloud, so the signed
  firmware, browser-installer parts, manual merged image and `manifest.json` are world-readable
  while the source stays private — tags/releases are *not* (repo-read only); **(b)** ungating Pages
  alone would have been useless: the
  release step is the only thing that creates a `v*` tag,
  [`next-version.sh`](../scripts/next-version.sh) derives the next version from the latest tag, and
  with no tags it returns the `version.txt` floor forever — a live feed pinned at 1.0.0 where every
  device reports "up to date" and never updates. A settings change still triggers no run: one
  `workflow_dispatch` or push is what brings the site up ([`README.md`](README.md)).
- **✅ CI runs inside a metered minute budget.** Actions bills each **job** rounded up to the next
  whole minute, and this repo merges often, so the pipeline is shaped by cost as much as by
  correctness ([`build.yml`](../.github/workflows/build.yml)): the three fast gates are **one job**
  (3 billed minutes → 1); the ~5-minute firmware build is **skipped** — not failed — when the diff
  touches nothing the image or the published site is made of, on pull requests as well as pushes,
  which is why the gate is a per-job `if:` and not a workflow-level `paths-ignore:` (a filtered
  workflow leaves a required check pending forever, a skipped job reports and satisfies it);
  **ccache** is carried across runs so the compile does not start from zero after `set-target`
  wipes the build directory (~3 of the build job's ~5 minutes; the other ~2 are the
  `espressif/idf` image pull, which nothing here can shorten); a PR **publishes nothing** — the
  per-PR preview installer at `PR/<N>/` is retired, since each preview was a `gh-pages` push and
  every `gh-pages` push starts GitHub's own *pages build and deployment* run on top of this one,
  while the dev channel already serves "flash what is on main" for one publish per merge; PR build artifacts
  expire after 7 days instead of 90; Renovate runs on its daily schedule and on demand rather than
  once per merge; and every job carries a `timeout-minutes` so a wedged runner cannot spend hours
  of the allowance unnoticed.
- **Managed components** ([`idf_component.yml`](../main/idf_component.yml)): `mdns`, `cjson` and `mqtt`
  are pulled as managed components (the latter two were extracted from IDF core in v6.0).

---

## 10. Firmware-footprint optimizations

Zero-behaviour-change trims in [`sdkconfig.defaults`](../sdkconfig.defaults) that drop code paths this
firmware never exercises (~15 KB total), because the binding constraint on this target is the largest
*contiguous* free heap block:

| Setting | Drops | Why safe |
|---------|-------|----------|
| `MBEDTLS_ERROR_STRINGS=n` | ~6 KB | only numeric TLS codes are logged |
| `COMPILER_OPTIMIZATION_ASSERTIONS_SILENT=y` | ~5 KB | keeps the `abort()` (→ rollback), drops assert strings |
| `MBEDTLS_*_SSL_SESSION_TICKETS=n` | ~1.8 KB | few, long-lived TLS connections gain nothing from resumption |
| `MBEDTLS_FS_IO=n` | ~1.2 KB | certs/keys come from the CA bundle + NVS, never a VFS path |
| `ESP_WIFI_ENABLE_WPA3_OWE_STA=n` | ~0.8 KB | joins a WPA2-PSK home network |

C++ exceptions are kept on (`COMPILER_CXX_EXCEPTIONS=y`) — they *are* the HTTP OOM guard.

---

## 11. ESP-IDF component & capability inventory

Every ESP-IDF component this firmware links, and what it powers (from
[`main/CMakeLists.txt`](../main/CMakeLists.txt) `REQUIRES` + [`idf_component.yml`](../main/idf_component.yml)):

| Component | Powers |
|-----------|--------|
| `nvs_flash` | runtime config + X10A link cache (`daik_cfg` namespace) |
| `esp_wifi` | STA (strongest-AP scan, SAE) + SoftAP setup portal |
| `esp_event` / `esp_netif` | event loop + network interfaces, DHCP hostname, SNTP client (`esp_netif_sntp`) |
| `esp_http_server` | `:80` UI/API server + **WebSocket** (`CONFIG_HTTPD_WS_SUPPORT`) |
| `esp_https_ota` / `app_update` / `esp_app_format` | OTA slot writes, rollback, app descriptor (version, ELF sha) |
| `esp_http_client` / `esp-tls` | OTA fetch + TLS transport |
| `bootloader_support` | Secure Boot v2 signature verification on the update path |
| `mqtt` (managed) | HA MQTT-discovery bridge |
| `esp_crt_bundle` | CA bundle for MQTTS / OTA TLS verification |
| `lwip` (+ `ping/ping_sock`) | BSD sockets (captive DNS), ICMP gateway watchdog, SNTP protocol |
| `esp_driver_uart` | X10A 9600 8E1 link on `UART_NUM_1` |
| `esp_driver_gpio` | status indicator (GPIO back-end), recovery-button input + pin config |
| `esp_driver_rmt` | RMT peripheral behind the WS2812 indicator back-end |
| `led_strip` (managed) | WS2812/WS2812C pixel driver — an addressable LED encodes its colour in pulse timings, so it cannot be driven with `gpio_set_level` |
| `esp_timer` | uptime, poll/serial timing |
| `mdns` (managed) | `<hostname>.local` discovery |
| `espcoredump` | core dump to flash + `esp_core_dump_get_summary` |
| `cjson` (managed) | POST body parsing (`http_config.cpp`) |

**Compile-time defaults** live in [`main/Kconfig.projbuild`](../main/Kconfig.projbuild). Only some of
them are also settable at runtime (web UI → NVS, which then overrides the Kconfig default):

| Kconfig default | Runtime override |
|---|---|
| `DAIKIN_WIFI_SSID` / `_PASSWORD` | ✅ `POST /set_wifi` → NVS |
| `DAIKIN_MQTT_BROKER_URI` / `_USERNAME` / `_PASSWORD` | ✅ `POST /set_mqtt` → NVS |
| `DAIKIN_SYSLOG_HOST` / `_PORT` | ✅ `POST /set_syslog` → NVS |
| `DAIKIN_NTP_SERVER` | ✅ `POST /set_ntp` → NVS (empty resets to this default, not "off" — SNTP has no disabled state) |
| `DAIKIN_RX_PIN` / `DAIKIN_TX_PIN` | ✅ auto-detected; `POST /set_hp` pins them → NVS |
| `DAIKIN_PROTOCOL` | ⚙️ auto-detected from the bus — deliberately **not** settable (`/set_hp` rejects `proto`) |
| `DAIKIN_HOSTNAME` | ❌ compile-time only |
| `DAIKIN_MQTT_DISCOVERY_PREFIX` / `_BASE_TOPIC` | ❌ compile-time only |
| `DAIKIN_OTA_MANIFEST_URL` / `_FIRMWARE_BASE_URL` | ❌ compile-time only |
| `DAIKIN_STATUS_LED_ENABLE` / `_GPIO` / `_WS2812` / `_INVERTED` | ✅ `POST /set_board` → NVS (these are only the first-boot seed) |
| `DAIKIN_BUTTON_GPIO` / `_ACTIVE_LOW` | ✅ `POST /set_board` → NVS; defaults to `-1` (**disabled**) because an unconfigured input floats and a floating pin reading "pressed" would factory-reset an untouched board |

The **model** is not in this table at all: it is re-detected from the X10A bus on every boot and held
in RAM only — there is no manual picker and no NVS key (see [`ARCHITECTURE.md`](ARCHITECTURE.md)).

---

## What makes this project distinctive (one-paragraph pitch)

It signs and verifies its own OTA updates with **Secure Boot v2 keys but no burned eFuses** — the
security of signed firmware with none of the brick risk. It refuses to roll a bad update forward with a
**connectivity-proving health gate** (not a naive uptime timer). It ships a **live WebSocket UI embedded
and gzipped into the app image**, an **ICMP watchdog** that recovers WiFi ghost-associations no event
reports, and a **field-debuggable crash story** (flash core dumps, offline symbolication against an
sha-matched ELF, retained MQTT crash + 19-entity heartbeat diagnostics). And the risky parts — decode,
CRC, config, discovery, the health gate, the OTA downgrade gate — are **pure IDF-free logic verified
on the host** (922 checks),
gating the firmware build in CI. Everything is **runtime-configured from a captive-portal web UI**; the
heat-pump model is **re-detected on every boot**.

---

*Keep this catalog in sync with the code — when a new technical feature lands, run the
[`feature-docs`](../.claude/skills/feature-docs/SKILL.md) skill.*
