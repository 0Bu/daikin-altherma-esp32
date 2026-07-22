# daikin-altherma-esp32 — Technical Reference

ESP-IDF firmware that reads a **Daikin Altherma** heat pump over its
**X10A** service port and bridges every value to Home Assistant over MQTT. Configured
at runtime from a web UI — WiFi, MQTT and the RX/TX pins (the unit model is auto-detected; the poll
interval is fixed at 1 s) — and updated over the air. User guide: [../README.md](../README.md).

For a cross-cutting catalog of the **platform features** this firmware implements — Secure Boot v2
signing, OTA + rollback health gate, the WebSocket live UI, the ESP-IDF component inventory,
diagnostics, WiFi resilience — see [**FEATURES.md**](FEATURES.md).

---

## Hardware

- **Targets:** esp32s3 only — the **Seeed XIAO ESP32-S3** is the
  reference board. **≥ 4 MB flash** (dual-OTA layout: two ~2 MB app slots). No PSRAM required.
- **Heat-pump link:** the X10A port is a 5 V TTL UART at **9600 8E1**. The ESP maps any two free
  GPIOs to a hardware UART (`RX_PIN` ← X10A pin 2 / HP-TX, `TX_PIN` → X10A pin 3 / HP-RX). The
  USB/native-USB console is a *separate* UART, so device logs never collide with the HP link.
- **Reference wiring (XIAO ESP32-S3):** `RX = GPIO44` (pad D7), `TX = GPIO43` (pad D6),
  `GND` mandatory, `5V` optional and out of spec (see below — prefer USB power). `GPIO16/17` — the
  classic-ESP32 default — are **not** broken out on the XIAO, which is why pins are configurable.

### Voltage and wiring

X10A is 5 V TTL; the ESP32 GPIOs are 3.3 V and not officially 5 V-tolerant. A direct connection
typically works in practice, but the safe option is a level shifter
on the **HP-TX → ESP-RX** line — only on that one line: the link is request/response, so the unit's
RX demonstrably accepts the ESP's 3.3 V TX (it is a TTL input, VIH ≈ 2 V). Whatever you do,
**GND must always be common** between the ESP and X10A, even when the ESP is USB-powered.

**If you do shift, use a passive divider, not an auto-direction shifter.** A resistor divider
(e.g. 10 kΩ / 20 kΩ) is ample at 9600 baud. The popular auto-direction converter ICs (TXS0108E and
relatives) sense direction through weak pull-ups and one-shot edge accelerators — that scheme
assumes a line no one drives continuously, which is exactly what a UART is not, and it has been
observed to kill the link outright (ESP reads nothing at all). A shifter chosen wrong breaks the
bus rather than protecting it; the divider has no such failure mode.

**Powering the ESP from the X10A 5 V pin is out of spec.** Daikin rates the port at **max. 5 V /
50 mA** — that is the spec of its own [EKPCCAB PC-cable accessory][ekpccab] (p. 1), which plugs into
X10A. An ESP32 draws ~70 mA average and 240 mA+ on WiFi-TX peaks, so it exceeds the rating even at
idle. It works on many units anyway (some feed X10A from a 1 A regulator), but the headroom is
per-model and unpublished — an unstable rail is what running out of it looks like. Prefer USB power
and leave pin 1 unconnected.

[ekpccab]: https://www.daikin.co.uk/content/dam/document-library/installation-manuals/ctrl/EKPCCAB4_4PW74106-1E_2018_06_Installation%20manual.pdf

---

## Flash prebuilt artifacts

Browser flasher + captive-portal setup: [../README.md](../README.md). The flasher is served on
GitHub Pages (ESP Web Tools / Web Serial), rebuilt and deployed by CI on every firmware change;
each change also publishes a
[GitHub release](https://github.com/0Bu/daikin-altherma-esp32/releases/latest) with the same
bins. (While the repository is **private**, CI only builds, tests and uploads the firmware as a
run artifact — the Pages installer, tags and releases activate automatically once the repo is made
public; see the gate comment atop [`.github/workflows/build.yml`](../.github/workflows/build.yml).)

> **Required repo setting:** Pages source must be **Deploy from a branch → `gh-pages` / `(root)`**
> (Settings → Pages). CI publishes the site by pushing the `gh-pages` branch
> ([`scripts/publish-pages-branch.sh`](../scripts/publish-pages-branch.sh)) and nothing else — the
> branch model is what allows each open PR to serve its own installer at `PR/<N>/`, which the
> atomic whole-site Actions deployment cannot. Setting the source to "GitHub Actions" instead
> serves nothing, since no workflow uploads a Pages artifact.

Flash by hand (needs `brew install esptool`). Use the **merged** image — it bakes in the correct
bootloader offset, so one command flashes the whole esp32s3 image. This erases `nvs` (you re-enter
WiFi + model config once):

```bash
esptool --chip esp32s3 write_flash 0x0 \
  daikin-altherma-esp32-<version>-merged.bin
```

To preserve `nvs`, flash the separate parts from a local `build/`:
`cd build && esptool --chip esp32s3 write_flash "@flash_args"`.

---

## Build from source

Builds run in the official **ESP-IDF Docker image, pinned to the version CI uses**
(`scripts/idf-docker.sh` reads it from `.github/workflows/build.yml`, so it never drifts) — no
local toolchain to install. Flashing is done from the host with `esptool` (Docker Desktop has no
USB passthrough).

```bash
brew install esptool                                              # host flasher (once)
git clone https://github.com/0Bu/daikin-altherma-esp32.git && cd daikin-altherma-esp32

# Build via the CI-pinned ESP-IDF image (first run pulls it — 2-4 min):
./scripts/idf-docker.sh idf.py set-target esp32s3 build

# Optional compile-time defaults (WiFi, MQTT, model, pins) — all also settable at runtime:
./scripts/idf-docker.sh idf.py menuconfig                         # → Daikin Altherma Configuration

# Flash from the host (preserves nvs — @flash_args skips nvs). Match --chip to the build:
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
```

There is also a **host-side mock build** (`scripts/run-mock-tests.sh`) that compiles and runs the
pure decoding/logic in `main/logic/` with the plain system toolchain — no ESP-IDF, no board — so
CRC, register parsing, value conversion, the config model and the HA-discovery payloads can be
*verified* in seconds (CI gates the firmware build on it). See [../test/README.md](../test/README.md).

Boot log:
```
I (520) main: daikin-altherma-esp32 1.0.0 (esp32s3)
I (540) cfg:  profile=auto  proto=I  rx=44 tx=43
I (900) wifi: connected to 'MyNetwork'  ip=192.0.2.42
I (950) hp:   X10A UART @9600 8E1  querying 9 registers, 35 values
I (1000) http: server on :80
```

---

## The Daikin X10A protocol (how values are read)

The X10A port exposes the heat pump's internal monitoring bus. The firmware is a **polling
reader** — it only reads and never actuates the heat pump (the X10A protocol has no write
command; see [X10A_PROTOCOL.md](X10A_PROTOCOL.md)).

- **Framing:** 9600 baud, 8E1. Each cycle the firmware asks for a set of **registers**
  (e.g. `0x10`, `0x20`, `0x60`, `0x61`, `0x62` …). Each register returns a fixed-length byte
  buffer; individual **values** live at known `(register, offset, size)` positions inside it.
- **Protocol `I`** (modern, default) and **protocol `S`** (older, ~2010 and earlier) differ in
  the request framing and checksum; both are implemented (`main/hp_comm.*`). A heat pump that replies `0x15 0xEA` does not understand the request →
  switch to `S`.
- **CRC:** every reply is checksum-verified; a mismatch (`Wrong CRC`) or `Timeout` almost always
  means a bad X10A cable or missing GND, not a firmware fault.
- **Decoding:** each value has a **converter id** that maps its raw bytes to a typed reading
  (temperature ×, signed/unsigned int, fixed-point, enum/label, on-off, pressure…). The
  converter table is verified against known-good reference outputs so readings are correct.

### Value definitions (model profiles)

Each value is a `{register, offset, convId, size, type, label}` row; a model profile is an array of
them. This project keeps that data but makes it **runtime-selectable**:

- One embedded profile per supported **Daikin Altherma model** (plus the Daikin mini-chillers) lives
  in `main/def/*.hpp`, curated to the useful monitoring values (temperatures, pressures, currents,
  setpoints, operating mode, errors, and the DHW/heating/pump state flags). The full register maps
  and converter reference are in [REGISTERS.md](REGISTERS.md).
- The firmware **auto-detects** the unit from the X10A bus (protocol sweep + a page/capacity
  fingerprint) and selects the matching profile — there is no manual model picker; the web UI shows
  the detected model read-only. The **RX/TX pins are auto-detected** too (the firmware sweeps the
  cached pair, its swap and the board default); they show read-only while the bus answers and fall
  back to a dropdown of the chip's safe GPIOs when it doesn't (`logic/board_pins.hpp` — the ESP32-S3
  pins not reserved for flash/PSRAM, strapping, USB-JTAG or JTAG, minus the status LED's own pin;
  which of them a given board breaks out to a header is the user's to know, see the board table in
  the top-level README). Labels are English-only and the poll interval is fixed at 1 s.
- The **model** (active profile + fingerprint) is **re-detected on every boot** (never written to
  NVS); the **link** (RX/TX pins + protocol) is a persisted cache, tried first by the sweep. Both
  drive the poll engine (`main/hp_poll.*`). See the Configuration model below.

If the unit can't be uniquely identified, detection falls back to the **Generic** Altherma profile
(the universal register core) — a value whose converter is not yet implemented reads blank rather
than wrong (documented behaviour).

> **Deep reference.** The full wire protocol (framing, checksum, register pages, detection, a
> worked capture) is in [X10A_PROTOCOL.md](X10A_PROTOCOL.md); the complete converter/enum tables and
> a representative full register map are in [REGISTERS.md](REGISTERS.md).

---

## Configuration model

All runtime config lives in NVS namespace **`daik_cfg`**; compile-time defaults come from
`main/Kconfig.projbuild` (menu *Daikin Altherma Configuration*). The web UI is the primary way to
set everything; `menuconfig` only seeds first-boot defaults.

User credentials + the X10A link cache are persisted; the model is re-detected on every boot.

| NVS key | Meaning |
|---------|---------|
| `cfg` | **Atomic credential/service blob** (`logic/config_store.hpp`): WiFi credentials + the one-shot rollback backup + flags, MQTT (`uri`/`user`/`pass`), syslog (host/port; empty host = off), and the SNTP server (empty = reset to the `CONFIG_DAIKIN_NTP_SERVER` default on next boot). One CRC-checked entry written with a single `nvs_set_blob`, so a save is **all-or-nothing** across a write failure *and* a power cut. WiFi rollback: the previous credentials are backed up here by `/set_wifi` and restored automatically if the new network fails to connect (reason-aware deadline, `logic/wifi_rollback.hpp`); `/status.wifi.rolled_back` reports it after the reboot. |
| *(legacy per-key)* | `wifi_ssid`/`wifi_pass`/`wifi_ssid_back`/`wifi_pass_back`/`wifi_rollback`/`wifi_rolledbk`/`mqtt_*`/`syslog_*`/`ntp_server` — the pre-blob layout, still **read** as a fallback when `cfg` is absent (fresh device / OTA from an older build); superseded on the next save. |
| `rx_pin` / `tx_pin` / `proto` | X10A link cache (physical wiring + framing) — kept as separate self-healing keys, tried first by the sweep, re-saved on change, re-validated on load. |
| `boot_fails` | Boot-loop crash counter (`safe_mode.cpp`); increments on a crash-only boot, latches recovery mode past the threshold, cleared after a healthy uptime. Lives here so a factory reset wipes it too. |

Not persisted: the **hostname** is fixed at `daikin-altherma-esp32`, the **poll cadence** at 1 s,
labels are **English-only**; and the **model** (`profile` + the detection fingerprint) is re-detected
fresh on every boot and kept in RAM (a swapped unit is re-identified). See
[ARCHITECTURE.md](ARCHITECTURE.md) → Auto-detection.

`nvs` offset/size must not change across versions, or old data is stranded on OTA.

---

## HTTP API

Base: `http://<ESP32-IP>` (or `http://daikin-altherma-esp32.local`). No auth / TLS by design — trusted
LAN only, see [SECURITY.md](SECURITY.md).

```
GET  /  (alias /index.html)        # embedded web UI (gzipped into the app binary)
GET  /status                       # { version, platform, uptime_s, app_elf_sha256, pins_avail:[..],
                                   #   wifi:{ssid,rssi,ip,connected,bssid,mac,std,rolled_back},
                                   #   mqtt:{configured,connected,tls,has_creds,broker,error?},
                                   #     (has_creds = whether creds are stored, never their value)
                                   #   syslog:{configured,resolved,reachable,host,port,error?},
                                   #   ntp:{server,synced,time},   # time = RFC 3339 UTC once SNTP syncs
                                   #   hp:{proto,rx,tx,connected,last_ok_s,
                                   #        registers,values,crc_err,timeout_err},
                                   #   profile:{id},
                                   #   sys:{free_heap,min_free_heap,max_alloc,reset_reason,safe_mode},
                                   #   last_crash: null | {reason,reason_code,fault,coredump,
                                   #        task,pc,backtrace[],corrupted,elf_sha256},
                                   #   detect:{proto,valid,capacity_kw,ou_eeprom,candidates[],
                                   #        families[],ambiguous,model:{name,family,marketing}} }
GET  /values                       # decoded readings [{label,value,unit}] (last poll cycle)
GET  /events                       # WebSocket live push (the only live UI transport). Send "sub" →
                                   #   status+values snapshot, then {"type":"status"|"values",...} on
                                   #   change. No HTTP polling; no-WebSocket browsers load once and
                                   #   the user reloads to refresh. "sub" is what subscribes: any
                                   #   other frame is ignored, and one longer than 16 B closes the
                                   #   connection (it can't be read into the command buffer, and its
                                   #   unread body would desync every frame after it).
GET  /models                       # profile catalog + pin hint (detection is automatic; no manual picker)
GET  /diag[?verbose=0|1][?clear=1] # plain-text in-memory diag log (raw RX frames when verbose)
GET  /scan                         # WiFi scan for the setup portal → {"networks":[{ssid,rssi}]}
                                   #   (no auth field — the setup UI only needs the name + signal)
GET  /coredump[?clear=1]           # stream the flash core-dump image (chunked; 404 if none);
                                   #   ?clear=1 erases the coredump partition. Decode offline with
                                   #   scripts/decode-coredump.sh coredump.bin (matching-version .elf).
POST /set_wifi                     # { ssid, pass } → validate (ssid 1-32; pass ""|8-63) → persist +
                                   #   reboot; on failure 400 {ok:false,error} (nothing saved). Backs up
                                   #   the old creds + auto-rolls-back if the new network fails to
                                   #   connect (see ARCHITECTURE.md → Web UI config flow)
POST /set_mqtt                     # { broker, user?, pass?, clear_creds? } → pre-flight the broker
                                   #   (DNS/TCP/connect+auth) → on success persist + reboot, on failure
                                   #   400 {ok:false,error} (nothing saved). Empty user+pass keeps stored
                                   #   creds; clear_creds:true removes them (anonymous); "" broker disables.
POST /set_syslog                   # { host, port } → validate port range, persist + reboot ("" host
                                   #   disables). DNS/reachability resolve async, shown in /status.syslog
POST /set_ntp                      # { server } → persist + reboot, no request-path network probe (the
                                   #   SNTP client resolves + retries after reboot, same as syslog); an
                                   #   empty server resets to the compile-time default on next boot —
                                   #   SNTP has no disabled state, unlike syslog's empty-means-off.
POST /set_hp                       # { profile?, rx?, tx? } → apply live (no reboot); rx/tx PERSIST
                                   #   (pin cache), profile session-only; proto auto-detected, not accepted.
                                   #   The ESP32 card's pin dropdown posts {profile:"auto",rx,tx} to re-detect.
#  all five /set_* above           # an NVS write failure → 500 {ok:false,error:"config write failed"},
                                   #   nothing applied and no reboot (the failing key is logged to /diag)
POST /detect                       # re-run auto-detection (reset profile to "auto" + invalidate fingerprint)
GET  /ota/check[?ms=<epoch>]       # start a background update check (poll /ota/status)
POST /ota/update                   # start the background self-update (downloads, then reboots)
GET  /ota/status                   # { state, progress, message, available, update_available, current }
POST /mcp                          # MCP server for AI agents — PLANNED (route exists; no tools yet).
                                   #   Today it returns a spec-compliant JSON-RPC 2.0 error (policy in
                                   #   logic/mcp_jsonrpc.hpp): bad JSON → -32700, invalid request →
                                   #   -32600, a notification (no id) → 204, a well-formed call →
                                   #   -32601 with its id echoed. read-only; get_status / get_hp_values
                                   #   are the intended tools.
```

Every handler runs under an OOM try/catch rather than crashing (memory is the binding constraint on
these chips): the JSON routes return `503`; the `/events` WebSocket handler is registered raw (needs
`is_websocket`), so it self-guards its JSON build, drops the frame under OOM, and bounds queued
broadcasts to one values plus one status batch while ESP-IDF completion callbacks are pending. `/diag` and
`/coredump` stream instead of building one big buffer.

---

## Home Assistant (MQTT)

`main/mqtt_ha.cpp` mirrors every decoded value to MQTT using Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery), so a **Daikin
Altherma** device with all entities appears in HA automatically — no YAML. **Read-only:** no
command topics are subscribed. The bridge runs in its own task, independent of the poll engine.

- **Enable:** set the broker in the web UI (pencil on the MQTT row of the dashboard Connections tile). Stored in NVS `mqtt_uri`.
- **TLS:** a schemeless entry defaults to plaintext `mqtt://`. Credentials require an explicit
  `mqtts://` broker URL (CA-verified via the mbedTLS bundle) so the password isn't sniffable — the
  bridge **refuses** a plaintext broker with credentials rather than silently downgrading or guessing
  a TLS port. An explicit scheme is always honoured. Reason surfaces in `/status.mqtt`.
- **Node id:** `daikin_<mac3>` from the WiFi STA MAC (stable across config changes). It disambiguates
  the *device* in each discovery config's `uniq_id`/`dev.ids`, but is **not** part of the message
  topics — those sit directly under `<base>` (one board per base topic).
- **Topics:** `<base>/state` (one retained JSON of all values, grouped by register page —
  `{ "<group>": { "<object>": value } }`, max depth 1), plus per-value discovery configs under
  `<prefix>/sensor/<node>/<object>/config` (retained) whose `value_template` reads the group+object
  out of that JSON. Availability/LWT `<base>/status`. `<base>` defaults `daikin-altherma-esp32`,
  `<prefix>` `homeassistant`.
- **Diagnostics topics.** `<base>/heartbeat` (board/link health on a fixed 10 s cadence — a **flat**
  JSON of heap, uptime, WiFi/MQTT/bus counters, each field prefixed by its block name: `wifi_rssi`,
  `wifi_mac`, `wifi_bssid`, `mqtt_count`, `bus_rx_received`, …) and `<base>/crash` (retained;
  **crash-only** — a "dump waiting" flag, published once per (re)connect but ONLY when the boot is
  *notable*: a real fault or a dump still in flash. A normal boot clears the topic with a zero-length
  retained message, so no crash message lingers once the problem is resolved. The reset reason is not
  a crash entity — it lives on the heartbeat's own "Reset Reason" sensor (the old duplicate "Last
  Reset Reason" crash entity was dropped). Republished on the heartbeat cadence if the "dump waiting"
  flag changes, so clearing a dump can't leave it latched ON)
  each expose their own `entity_category: diagnostic` HA sensors. The crash topic carries only the
  reason + a hex backtrace — never a secret or the raw dump; pull the full dump from `GET /coredump`
  and decode it with `scripts/decode-coredump.sh`.
- **Autodiscovery streaming.** A full Altherma value set can exceed 10 KB of discovery JSON;
  discovery is emitted incrementally (chunked) so it never needs one large contiguous heap block.

Derived sensors (COP etc.) and a sample dashboard: [HOME_ASSISTANT.md](HOME_ASSISTANT.md).

---

## OTA (self-update)

Pull-based: the device fetches `manifest.json` from `CONFIG_DAIKIN_OTA_MANIFEST_URL` (default GitHub
Pages), compares its `version` to the running firmware, and on confirmation downloads its image
`daikin-altherma-esp32.bin` via `esp_https_ota` into the inactive OTA slot, then reboots. Tap the
**Firmware** row on the ESP32 card to check; the UI then shows download progress and reconnects
after the reboot. Both the check and the download run on their own task, never on the HTTP worker.

> **What you need for it to find anything:** a reachable `manifest.json` + signed `.bin`. CI builds
> and stages both (`scripts/ci-build-all.sh`), but every publishing step is gated on the repository
> being **public** — while it is private nothing is served, and a check simply reports the device is
> up to date. Point the two `CONFIG_DAIKIN_OTA_*` URLs at any HTTPS host to use your own feed.

- **Downgrade gate** *(implemented)*: refuses anything not strictly newer — a signature proves
  authenticity, not freshness. It is checked **twice**, and the second check is the load-bearing one:
  once against the manifest's `version` (cheap, avoids a pointless download), then again against the
  **image's own embedded version**, read from its `esp_app_desc_t` after the transfer starts but
  before anything is committed. The manifest and the image are separate artifacts, so a host that
  advertises a high version while serving a genuine, correctly-signed *old* binary would otherwise
  walk the device backwards onto a fixed bug. Ordering is numeric (`logic/version_cmp.hpp`), so
  `1.10.0 > 1.9.0`, and an unparseable version on either side refuses the update rather than guessing.
- **Rollback armed** *(implemented)*: `main.cpp` defers `esp_ota_mark_app_valid_cancel_rollback()` to
  a health gate (~90 s), so a boots-but-crashes image reverts.
- **Signed images:** Secure Boot v2 RSA-3072 signing *without* hardware Secure Boot — the running
  app verifies the signature before installing an OTA (no eFuses; reversible; web installer still
  works). CI signs each image with the offline `OTA_SIGNING_KEY`. Details:
  [SECURITY.md](SECURITY.md).

Partition layout (`partitions.csv`) is dual-OTA sized to fill 4 MB (a larger flash just leaves
the top unused); app at `0x20000`.

---

## Security

Full threat model + Flash Encryption / Secure Boot notes: [SECURITY.md](SECURITY.md).

- The API has **no auth / TLS** by design (trusted LAN only) — never expose it to the internet.
- WiFi/MQTT credentials live in NVS **unencrypted** by default; enable Flash + NVS Encryption
  (irreversible) if physical access is a concern.
- The heat-pump link is **read-only** — the firmware polls the X10A bus and never actuates the
  unit, so there are no control outputs at all.

---

## License

[MIT License](../LICENSE). Not affiliated with Daikin.
