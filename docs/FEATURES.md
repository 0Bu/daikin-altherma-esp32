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
| 3 | Dual-OTA partition layout, NVS-preserving | ✅ | [`partitions.csv`](../partitions.csv) |
| 4 | OTA rollback + **connectivity-proving health gate** | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/health_gate.hpp`](../main/logic/health_gate.hpp) |
| 5 | OTA manifest check + signed download | 🔭 | [`ota_update.cpp`](../main/ota_update.cpp) |
| 6 | WebSocket live push (`/events`) — the only live transport | ✅ | [`http_status.cpp`](../main/http_status.cpp) |
| 7 | Gzipped web UI **embedded in the app image**, assembled at build time | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt) |
| 8 | HTTP handlers under an **OOM `try/catch` → 503** discipline | ✅ | [`http_common.cpp`](../main/http_common.cpp), [`http_status.cpp`](../main/http_status.cpp) |
| 9 | Home Assistant MQTT auto-discovery, grouped state, LWT | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/discovery.hpp`](../main/logic/discovery.hpp) |
| 10 | **MQTTS + CA-bundle** TLS; credentials never sent in cleartext | ✅ | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 11 | Core-dump-to-flash + summary capture + offline symbolication | ✅ | [`diag_crash.cpp`](../main/diag_crash.cpp), [`decode-coredump.sh`](../scripts/decode-coredump.sh) |
| 12 | Reset-reason + crash classification, retained to MQTT | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 13 | 16-entity device **heartbeat** diagnostics stream (heap trend + reset reason incl.) | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp) |
| 14 | Strongest-AP scan + SAE tuning + **endless reconnect** | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 15 | **ICMP gateway watchdog** (ghost-association recovery) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 16 | Captive-portal provisioning (SoftAP + UDP:53 DNS catch-all) | ✅ | [`provisioning.cpp`](../main/provisioning.cpp), [`captive_dns.cpp`](../main/captive_dns.cpp) |
| 17 | mDNS + DHCP hostname (option 12) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 18 | **In-app WiFi re-config + reason-aware one-shot credential rollback** | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`http_config.cpp`](../main/http_config.cpp), [`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp) |
| 19 | X10A auto-detection (protocol sweep → fingerprint → model) | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`logic/detect.hpp`](../main/logic/detect.hpp) |
| 20 | **IDF-free host-tested logic core** (510 checks) | 🧪 | [`main/logic/`](../main/logic), [`test/test_logic.cpp`](../test/test_logic.cpp) |
| 21 | CI pinned to the exact ESP-IDF the local Docker build uses | ✅ | [`idf-docker.sh`](../scripts/idf-docker.sh), [`build.yml`](../.github/workflows/build.yml) |
| 22 | Traceable build identity (`app_elf_sha256`) matches a dump→its ELF | ✅ | [`http_status.cpp`](../main/http_status.cpp), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 23 | Firmware-footprint trims (~15 KB of unused IDF code paths) | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 24 | Status-LED state indicator | ✅ | [`status_led.cpp`](../main/status_led.cpp) |
| 25 | Read-only MCP server route | 🔭 | [`mcp_server.cpp`](../main/mcp_server.cpp) |
| 26 | **MQTT broker save-time pre-flight** (DNS/TCP/connect+auth, heap-guarded) before persist | ✅ | [`http_config.cpp`](../main/http_config.cpp) |
| 27 | **Task Watchdog** → clean reboot on a wedged poll/publish task | ✅ | [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 28 | **`/status.sys`** always-on heap headroom + last-boot reason (LAN/WS, no broker) | ✅ 🧪 | [`http_status.cpp`](../main/http_status.cpp), [`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp) |
| 29 | **Boot-loop safe mode** — recover a bad config in-browser (crash-only counting, distinct from OTA rollback) | ✅ 🧪 | [`safe_mode.cpp`](../main/safe_mode.cpp), [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp) |
| 30 | **Config-write integrity** — field-owned commits (no cross-task revert) + an NVS failure that reaches the user (500, no reboot) instead of "saved" | ✅ 🧪 | [`config.cpp`](../main/config.cpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp), [`http_config.cpp`](../main/http_config.cpp) |

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
a full `@flash_args` flash of one also wipes the fallback slot. The project turns that sharp edge
into a hard gate:

- [`scripts/require-signed.sh`](../scripts/require-signed.sh) inspects a `.bin` with
  `espsecure signature-info-v2` and **exits non-zero with the exact signing command** if the
  signature block is absent. The [`flash-esp32`](../.claude/skills/flash-esp32/SKILL.md) skill runs
  it before every `esptool write_flash`.
- CI never publishes unsigned firmware to OTA: [`build.yml`](../.github/workflows/build.yml) hard-errors
  on a `main` build with no `OTA_SIGNING_KEY` secret (fork PRs downgrade to an unsigned *compile-only*
  build with no preview).
- CI applies the same guard to the **browser installer**, which no host-side check can reach:
  [`ci-build-all.sh`](../scripts/ci-build-all.sh) carves the app back out of the `-merged.bin` it just
  built — at the offset `flash_args` assigned it — and runs `require-signed.sh` on those bytes, so a
  signing step that silently stops covering the installer fails the build instead of shipping.

---

## 2. OTA self-update & anti-brick

See [`ARCHITECTURE.md` → OTA, signing, partitions](ARCHITECTURE.md) and
[`SECURITY.md` → Boot recovery](SECURITY.md).

- **Dual-OTA layout** ([`partitions.csv`](../partitions.csv)): two ~2.03 MB app slots (`ota_0`/`ota_1`)
  sized to fill 4 MB flash exactly, with `otadata`, `phy_init` and a `coredump` partition.
  `esp_https_ota` writes the **inactive** slot, so an update never touches `nvs@0x9000` — WiFi, MQTT
  and the X10A pin cache survive upgrades.
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
- **🟡 / 🔭 Manifest check & signed download** ([`ota_update.cpp`](../main/ota_update.cpp)): the
  rollback health gate is implemented and shipping; the manifest fetch + `esp_https_ota` download +
  downgrade gate are stubbed TODOs. `/ota/check` / `/ota/update` / `/ota/status` routes exist and
  return the current state.
- **Version pipeline**: [`next-version.sh`](../scripts/next-version.sh) auto-increments a monotonic
  patch above the latest `v*` tag (with `version.txt` as a manual floor). CI stamps the version it is
  actually publishing into `version.txt` *before* the build, so ESP-IDF bakes that exact string into
  `esp_app_get_description()->version`, and `manifest.json` is written from the **same** stamped
  string — not the next release version, which only coincides on a release-cutting push.
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
  captive portal, then re-editable from the dashboard WiFi card (pencil → modal → `POST /set_wifi`,
  validating SSID 1–32 / password empty-or-8–63). Because a bad SSID/password entered over the LAN
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
  the diag ring and the card just shows the old SSID again — API-only for now; the dashboard banner that
  reads it belongs to the web-UI write-feedback work.
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
- **Modem sleep disabled** (`WIFI_PS_NONE`): trades the idle-power saving of DTIM sleep for a
  consistently responsive HTTP UI (no ~100–300 ms wake latency per inbound request).
- **mDNS + DHCP hostname** — reachable at `daikin-altherma-esp32.local`, and the router's client list
  shows the real hostname via DHCP option 12 (set before the DHCP client runs).
- **LWIP tuned for the workload** ([`sdkconfig.defaults`](../sdkconfig.defaults)): socket cap lifted to
  16 (http server + mDNS + SNTP + MQTT + OTA can otherwise starve the download of a BSD socket), and
  the TCP send/receive windows doubled so the ~13 KB gzipped UI clears in 1–2 windows.

### Captive-portal provisioning

First boot with no WiFi config comes up as SoftAP `daikin-altherma-esp32-setup`
([`provisioning.cpp`](../main/provisioning.cpp)). A hand-rolled UDP:53 DNS server
([`captive_dns.cpp`](../main/captive_dns.cpp)) answers **every** A query with `192.168.4.1`, so a
joining phone's OS connectivity probe resolves to the device and auto-pops the setup page. The `/*`
catch-all HTTP route ([`http_status.cpp`](../main/http_status.cpp)) serves that page. One shared `:80`
`esp_http_server` handles both AP-setup and STA-run modes.

---

## 4. Web server & the WebSocket live transport

- **`esp_http_server` on `:80`** with `CONFIG_HTTPD_WS_SUPPORT=y`. The full HTTP surface is in
  [`.claude/CLAUDE.md` → HTTP API](../.claude/CLAUDE.md) and [`docs/README.md`](README.md).
- **✅ WebSocket push is the only live transport.** `GET /events` ([`http_status.cpp`](../main/http_status.cpp)):
  a client sends `sub`, gets a status+values snapshot, then the poll task pushes
  `{"type":"status"|"values",…}` frames on change (values ~1 s, status ~4 s). There is **no HTTP
  polling** — a browser without WebSocket falls back to a one-time snapshot. Broadcasts run in the poll
  task and self-guard `std::bad_alloc` per client, dropping a single frame rather than the whole poll
  cycle (the task's own guard, below, is only their backstop).
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
  state topic** `<base>/<node>/state` ([`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp)),
  republished only when the payload changes so a quiet pump doesn't spam the broker.
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
- **✅ Availability (LWT).** A retained `offline` last-will on `<base>/<node>/availability`, flipped to
  `online` on connect — HA marks every entity unavailable if the device drops.
- **Read-only by design.** No command subscriptions; the bridge only reads the pump.

---

## 6. Diagnostics & observability

A deliberately strong story for a hobby-scale device — everything needed to explain a crash *after
the fact*, from the field, without a serial cable:

- **✅ Core dump to flash (ELF format).** `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH` +
  `..._DATA_FORMAT_ELF` into a dedicated `coredump` partition. [`diag_crash.cpp`](../main/diag_crash.cpp)
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
  `<base>/<node>/crash` MQTT payload (2 diagnostic HA entities: reason + "dump waiting" flag —
  reason/backtrace only, **never** the raw dump or any secret), published per (re)connect and
  republished on the heartbeat cadence when the "dump waiting" flag changes, so it can't latch ON after
  the dump is cleared. `static_assert`s pin the IDF reset-enum
  values so a renumbering fails the build rather than mislabeling every crash.
- **✅ 🧪 16-entity device heartbeat** ([`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp)): on a fixed
  10 s cadence, `<base>/<node>/heartbeat` streams heap (free / min-free / **largest-free-block**, the
  true OOM limit — all three now their own HA entities), uptime, the **last reset reason**, WiFi RSSI +
  reconnect count, MQTT publish/fail/reconnect counters, and X10A bus rx/fail/crc/timeout stats —
  published independently of heat-pump profile detection, so board health is visible even while the
  model is still `auto`.
- **✅ 🧪 Always-on system health** ([`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp)): the
  `/status` document (and the `/events` status frame) carries a compact `sys` block — `free_heap`,
  `min_free_heap` (since-boot low-water, the leak indicator), `max_alloc` (largest contiguous block,
  the real OOM ceiling), the `reset_reason` slug and a `safe_mode` flag. Unlike `last_crash` it is
  present on **every** boot, and unlike the heartbeat it needs **no broker**, so "why did it reboot?"
  and "is the heap leaking?" are answerable from the LAN alone. `reset_reason_name()` reuses the
  crash slug vocabulary (one naming for the sys block, the crash entity and the heartbeat). The
  dashboard ESP32 card renders the reset reason (fault-coloured) and free heap.
- **✅ Build identity** — `/status.app_elf_sha256` ties a running device to the exact firmware that
  produced any dump, and the syslog boot line (below) puts the same hash in the **log stream**, so a
  captured stream stays attributable to a binary after the device has moved on.
- **✅ In-RAM diag ring** (`GET /diag`) and a **status LED** ([`status_led.cpp`](../main/status_led.cpp))
  encoding WiFi-connecting / setup-portal / all-healthy / X10A-error / MQTT-error as distinct blink
  patterns.
- **✅ Off-device log forwarding** ([`syslog.cpp`](../main/syslog.cpp)): every diag line is also
  forwarded as one RFC 5424 UDP datagram to an optional collector (`/set_syslog`; empty host = off).
  Delivery is gated on **DNS only** — the ARP/ICMP reachability probe is advisory (`/status.syslog`),
  since a healthy collector may firewall ICMP. Self-loop-guarded (drops its own `syslog:` lines).
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
  heat-pump traffic. Any two free GPIOs map to it (the RX/TX pin cache in NVS).
- **✅ 🧪 Poll engine** ([`hp_poll.cpp`](../main/hp_poll.cpp)): profile registers → query → decode →
  thread-safe value cache the web UI and MQTT read; also drives the WebSocket broadcast each cycle.
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
  extraction (`registers.hpp`), the config model/validation + the field-owned detection patches
  (`config_model.hpp` — `apply_link`/`apply_model` touch only the link / model, so a detection commit
  cannot revert a concurrent `/set_wifi`), HA-discovery payloads
  (`discovery.hpp`), detection (`detect.hpp`), the OTA health gate (`health_gate.hpp`), heartbeat &
  crash formatting (`heartbeat.hpp`, `crashinfo.hpp`), the syslog boot/crash replay records
  (`bootlog.hpp`), the syslog hard-vs-transient send-error policy (`syslog_policy.hpp`), the
  gateway-watchdog policy (`link_watch.hpp`), the WiFi credential-rollback policy
  (`wifi_rollback.hpp`), the reset-reason vocabulary (`reset_reason.hpp`),
  the boot-loop safe-mode decision (`boot_guard.hpp`), grouped state JSON (`mqtt_group.hpp`), the
  broker-URI split (`mqtt_uri.hpp`), board
  pins (`board_pins.hpp`), and **🔭 Modbus TCP framing + HomeHub register codecs** (`modbus.hpp` — MBAP
  framing without CRC, FC03/04/06/16 build+parse, `Temp16`/`Pow16`/`Int16`/`Text16` decode/encode,
  the `homehub-*` mDNS filter; the host-tested core for the *planned* firmware-exclusive HomeHub
  Modbus link (issue #32), **not yet wired into the firmware**). **522 `CHECK`s** in
  [`test/test_logic.cpp`](../test/test_logic.cpp).
- **The fast loop** — [`scripts/run-mock-tests.sh`](../scripts/run-mock-tests.sh) compiles + runs the
  suite with the plain system toolchain (`cmake` + `g++`/`clang++`, one translation unit). This is the
  real "run it and see" loop even in an environment that can't build firmware or USB-flash.
- **The rule** — new decode/config/discovery logic goes in `main/logic/` with a `CHECK`, never buried in
  a device-only `.cpp`. The [`add-logic-test`](../.claude/skills/add-logic-test/SKILL.md) skill and the
  [`x10a-decode-reviewer`](../.claude/agents/x10a-decode-reviewer.md) agent enforce it.

---

## 9. Build system & release engineering

- **✅ Deterministic toolchain.** There is no local ESP-IDF install:
  [`idf-docker.sh`](../scripts/idf-docker.sh) runs every build in the `espressif/idf` image, its version
  **read at runtime from [`.github/workflows/build.yml`](../.github/workflows/build.yml)** — a single
  source of truth (currently ESP-IDF v6.0.2, kept current by Renovate), so local builds can never drift
  from CI.
- **✅ CI gate order** ([`build.yml`](../.github/workflows/build.yml)): the fast, hardware-free
  `logic-test` job runs first; only then the per-target firmware build → sign → merge → artifact upload.
  A decode/config/discovery regression fails in seconds, not minutes.
- **✅ Crash-decodable forever.** CI archives the unstripped `.elf` (+ sha256) per version/PR, so every
  build's core dumps stay symbolizable ([`ci-build-all.sh`](../scripts/ci-build-all.sh)).
- **✅ One Pages publisher.** The browser installer is served from the **`gh-pages` branch**, pushed by
  [`publish-pages-branch.sh`](../scripts/publish-pages-branch.sh); the repo's Pages source must be set to
  that branch ([`README.md`](README.md)). The branch model is what lets every open PR serve its own
  installer at `PR/<N>/` — an atomic whole-site Actions deployment cannot — so the
  `configure-pages`/`deploy-pages` path is deliberately absent rather than redundant: a repo's Pages
  source is either a branch or Actions, never both.
- **✅ Public-only publishing gate.** While the repo is private, CI builds/tests/uploads but publishes
  nothing outward (no tags, releases, or Pages installer); every such step is gated on
  `repository.private == false` and re-enables automatically when the repo goes public.
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
| `esp_event` / `esp_netif` | event loop + network interfaces, DHCP hostname |
| `esp_http_server` | `:80` UI/API server + **WebSocket** (`CONFIG_HTTPD_WS_SUPPORT`) |
| `esp_https_ota` / `app_update` / `esp_app_format` | OTA slot writes, rollback, app descriptor (version, ELF sha) |
| `esp_http_client` / `esp-tls` | OTA fetch + TLS transport |
| `bootloader_support` | Secure Boot v2 signature verification on the update path |
| `mqtt` (managed) | HA MQTT-discovery bridge |
| `esp_crt_bundle` | CA bundle for MQTTS / OTA TLS verification |
| `lwip` (+ `ping/ping_sock`) | BSD sockets (captive DNS), ICMP gateway watchdog |
| `esp_driver_uart` | X10A 9600 8E1 link on `UART_NUM_1` |
| `esp_driver_gpio` | status LED + pin config |
| `esp_timer` | uptime, poll/serial timing |
| `mdns` (managed) | `<hostname>.local` discovery |
| `espcoredump` | core dump to flash + `esp_core_dump_get_summary` |
| `cjson` (managed) | POST body parsing (`http_config.cpp`) |

**Runtime-configurable at first boot** via `Kconfig.projbuild` (all also settable in the web UI,
NVS-overridden): WiFi SSID/pass, hostname, X10A protocol + RX/TX pins, MQTT URI/user/pass + discovery
prefix + base topic, OTA manifest/firmware URLs, status-LED GPIO/enable/inversion. See
[`main/Kconfig.projbuild`](../main/Kconfig.projbuild).

---

## What makes this project distinctive (one-paragraph pitch)

It signs and verifies its own OTA updates with **Secure Boot v2 keys but no burned eFuses** — the
security of signed firmware with none of the brick risk. It refuses to roll a bad update forward with a
**connectivity-proving health gate** (not a naive uptime timer). It ships a **live WebSocket UI embedded
and gzipped into the app image**, an **ICMP watchdog** that recovers WiFi ghost-associations no event
reports, and a **field-debuggable crash story** (flash core dumps, offline symbolication against an
sha-matched ELF, retained MQTT crash + 16-entity heartbeat diagnostics). And the risky parts — decode,
CRC, config, discovery, the health gate — are **pure IDF-free logic verified on the host** (510 checks),
gating the firmware build in CI. Everything is **runtime-configured from a captive-portal web UI**; the
heat-pump model is **re-detected on every boot**.

---

*Keep this catalog in sync with the code — when a new technical feature lands, run the
[`feature-docs`](../.claude/skills/feature-docs/SKILL.md) skill.*
