# daikin-altherma-esp32

ESP-IDF 5.x firmware for the ESP32-S3 chip. Reads a **Daikin Altherma** heat
pump over its **X10A** service port and bridges every value to **Home Assistant over MQTT**
(auto-discovery). Everything — WiFi (captive portal), MQTT, the unit model, the register set,
the RX/TX pins — is configured at runtime from a **web UI**; firmware is installed from a
**browser** (Web Serial) and updated **OTA**. Builds for the **esp32s3** target only.

> **Deep reference:** this file holds the always-needed essentials. Full narrative for the poll
> engine, value profiles, MQTT bridge, WiFi reconnect and OTA lives in
> [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — read it on demand. The X10A wire protocol
> (framing, checksum, register pages, detection) is in
> [`docs/X10A_PROTOCOL.md`](../docs/X10A_PROTOCOL.md), and the converter-id/enum tables plus a full
> register map in [`docs/REGISTERS.md`](../docs/REGISTERS.md). User-facing docs:
> [`README.md`](../README.md), [`docs/README.md`](../docs/README.md),
> [`docs/SECURITY.md`](../docs/SECURITY.md), [`docs/DESIGN.md`](../docs/DESIGN.md) (web-UI design
> contract). Keep them in sync (the `project-review` skill checks for drift).

**Conventions:** always write the full name `daikin-altherma-esp32` (hostname, SoftAP, MQTT base
topic, docs) — never shorten it to `daikin-altherma`. Do not reference other projects by name in
the code or docs; the heat-pump-protocol credit belongs only in the README "Scope & credits"
section at the bottom.

## Environment note (Claude Code on the web / remote sandbox)

A cloud session **cannot build** (no Docker daemon for `scripts/idf-docker.sh`) and **cannot
USB-flash** (no USB passthrough) — it is for editing, review and CI-driven builds. The
`report-capabilities.sh` SessionStart hook prints what the current environment supports.

**But there IS a real local verification loop** — the host mock build runs the project's pure
logic with the plain system toolchain (no ESP-IDF/Docker/board), so decoding/config/discovery
changes can be *verified*, not just reasoned about, even in a cloud session:

```bash
scripts/run-mock-tests.sh   # compile + run host logic tests in seconds (cmake + g++/clang++)
```

It covers the X10A **CRC** and framing (`logic/crc.hpp`), the **value converters**
(`logic/convert.hpp` — the riskiest part of the port), register extraction
(`logic/registers.hpp`), the **config model / validation** (`logic/config_model.hpp`) and the
**HA-discovery payloads** (`logic/discovery.hpp`). CI gates the firmware build on it
(`logic-test` job). Add new decode/format logic to `main/logic/` and a `CHECK` in
`test/test_logic.cpp` — never bury it in a `.cpp` only the device can run. Full detail:
[`test/README.md`](../test/README.md).

## Build & Flash

No local ESP-IDF — builds run via `scripts/idf-docker.sh`, which uses the `espressif/idf` Docker
image **pinned to the version CI builds with** (read at runtime from
`.github/workflows/build.yml`). Flash from the host with `esptool` (`brew install esptool`),
since Docker on macOS has no USB passthrough. The `flash-esp32` skill wraps both.
When waiting on CI, block on `gh run watch <run-id> --exit-status` — never sleep-poll.

```bash
# Build (first run: set-target; afterwards plain `build` stays incremental). CI builds esp32s3.
scripts/idf-docker.sh idf.py set-target esp32s3 build

# Optional compile-time defaults (all also settable at runtime in the web UI)
scripts/idf-docker.sh idf.py menuconfig                 # -> Daikin Altherma Configuration

# Sign the app first — REQUIRED. This config uses the Secure Boot v2 signature scheme
# (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT); an UNSIGNED image crash-loops at boot
# (esp_secure_boot_init_checks abort, before app_main). Needs the offline ota_signing_key.pem
# (never committed; see docs/SECURITY.md). No eFuses burned -> unsigned is a crash-loop, not a brick.
espsecure.py sign_data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" \
  --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
cp build/daikin-signed.bin build/daikin-altherma-esp32.bin   # @flash_args flashes this path

# Guard: refuse to flash an UNSIGNED image (would crash-loop before app_main + wipe the fallback).
# Exits non-zero with the signing command if unsigned. The flash-esp32 skill runs this for you.
scripts/require-signed.sh build/daikin-altherma-esp32.bin

# Flash from the host (preserves nvs — @flash_args skips nvs@0x9000)
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
```

The reference board is the **Seeed XIAO ESP32-S3** — native USB-Serial/JTAG, flashes without a
BOOT-button dance. Its X10A pins default to **RX=44 (D7) / TX=43 (D6)**; GPIO16/17 are not
broken out on the XIAO.

## Architecture (component map)

```
main.cpp        boot: NVS, config, WiFi(STA)|setup-AP, mDNS, HTTP, MQTT, poll engine, OTA gate
config.cpp      runtime Config (logic/config_model.hpp): WiFi/MQTT + link cache (pins/proto) in NVS
                "daik_cfg"; model (profile/fingerprint) RAM-only (config_set_runtime); mutex-guarded
nvs_storage.cpp thin NVS helpers (IDF nvs_* called with :: to avoid the daik::nvs_* collision)
wifi.cpp        STA bring-up (all-channel scan -> strongest AP by RSSI) + endless reconnect
                (first-boot budget -> setup portal) + ICMP gateway watchdog (ghost-assoc
                recovery) + scan + DHCP hostname (option 12) + mDNS; wifi_reconnect_count() —
                cumulative RE-connects since boot, for the MQTT heartbeat
provisioning.cpp setup SoftAP (daikin-altherma-esp32-setup) + DHCP DNS-offer; HTTP is the shared :80 server
captive_dns.cpp UDP:53 catch-all (every name -> 192.168.4.1) so the setup portal auto-pops (AP mode only)
hp_comm.cpp     X10A UART (9600 8E1) + register query
hp_convert.cpp  device value formatting over logic/convert.hpp
hp_detect.cpp   auto-detect glue: protocol sweep + page probe -> fingerprint -> candidate models
hp_poll.cpp     poll engine task: (auto-detect if profile=="auto") profile registers -> query ->
                decode -> thread-safe cache; also drives the /events WebSocket push
                (ws_broadcast_values every cycle, ws_broadcast_status every 4th)
http_server.cpp esp_http_server :80; concerns register their own routes (http_handlers.hpp)
http_status.cpp GET / (setup.html in AP mode, else gzip UI) /status /values /models /diag /scan
                /coredump + /events (WebSocket live push) + captive catch-all
http_config.cpp POST /set_wifi /set_mqtt /set_hp /detect
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp (read-only MCP tools; TODO)
mqtt_ha.cpp     HA MQTT-Discovery bridge: esp-mqtt client + publish task; ONE shared grouped-JSON
                state topic <base>/<node>/state (logic/mqtt_group.hpp), republished on change; LWT
                availability, mqtts+CA on creds; board/link diagnostics on <base>/<node>/heartbeat
                (logic/heartbeat.hpp), published on a fixed 10s cadence (HEARTBEAT_INTERVAL_S) —
                heap/uptime/wifi(+reconnects)/mqtt(pub count+fails+reconnects)/X10A bus
                (rx_received/rx_fails) stats, 13 diagnostic HA entities streamed independently of
                profile detection. Every publish funnels through one mqtt_publish() wrapper so
                mqtt.count/mqtt.fails cover every topic, not just state.
ota_update.cpp  pull-based signed OTA + rollback health gate (check/download: TODO)
diag_log.cpp    in-RAM diag ring served by GET /diag
logic/          IDF-free, host-tested pure headers (crc, convert, registers, config_model,
                discovery, detect, mqtt_group, heartbeat, board_pins). detect.hpp narrows the
                Altherma-only model profiles from a bus fingerprint (page mask + capacity) to a
                register-equivalent candidate set + a best-fit representative (detect_best);
                mqtt_group.hpp maps a register page to a friendly group name and builds the grouped
                state JSON; heartbeat.hpp builds the board/link diagnostics JSON + its diagnostic HA
                discovery configs; board_pins.hpp = per-target usable X10A GPIOs (the RX/TX
                pin-picker dropdown when detection hasn't locked the pins).
def/            embedded per-model value profiles + registry (incl. the generic Altherma fallback =
                universal register core) + models_catalog.hpp (GET /models) + model_names.hpp
                (id→display/family/marketing name for /status) + signatures.hpp (Altherma-only
                detection signatures derived from the tables). Profiles are machine-generated in the
                ValueDef row format by decoding Daikin's value catalog (tools/profiles/, docs/REGISTERS.md).
www/            web UI sources (index.html + style.css + app.js -> one gzipped page) + setup.html
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `wifi_ssid`/`wifi_pass`, `mqtt_uri`/`mqtt_user`/`mqtt_pass`, and the X10A **link cache** `rx_pin`/`tx_pin`/`proto`. (Hostname is fixed at `CONFIG_DAIKIN_HOSTNAME`, poll cadence at `POLL_INTERVAL_S`=1 s, labels English-only.) |

**The link is persisted; the model is not.** The RX/TX pins + protocol are the physical, boot-invariant
X10A link — cached in NVS, tried FIRST by the detection sweep (defaults as fallback, so a stale cache
self-heals), and re-persisted only when they change. The **model** (`profile` + fingerprint `fp_*`) is
re-detected on **every boot**: `config_load` seeds `profile="auto"`, and `poll_detect` applies the
model in RAM only (`config_set_runtime`) — so a swapped unit is re-identified, and `profile`/`fp_*` are
**not** in NVS. `poll_detect` calls `config_save` (persist) only when pins/proto change, else `config_set_runtime`.

`nvs` at `0x9000` is untouched by OTA (partitions.csv) so config survives upgrades. Keep its
offset/size stable across versions.

## HTTP API

```
GET  /            embedded web UI (gzipped into the app binary)
GET  /status      version, platform, uptime_s, pins_avail[] (per-target usable X10A GPIOs for the
                  RX/TX picker — logic/board_pins.hpp), wifi, mqtt, hp{proto,rx,tx,connected,
                  last_ok_s,registers,values,crc_err,timeout_err}, profile{id},
                  detect{proto,valid,capacity_kw,ou_eeprom,candidates[],families[],ambiguous,
                  model{name,family,marketing}} — drives the dashboard ESP32 board card + model card.
                  RX/TX are auto-detected: read-only on the card while the bus answers, a pins_avail
                  dropdown (re-runs detection) when it doesn't.
GET  /values      decoded readings [{label,value,unit}]
GET  /events      WebSocket live push (is_websocket). Client sends "sub" -> gets a status+values
                  snapshot, then the poll task pushes {"type":"status"|"values",...} frames on change
                  (status ~4s, values ~1s). The ONLY live UI transport — there is no HTTP polling; a
                  browser without WebSocket loads a one-time /status+/values snapshot and the user
                  reloads to refresh. NOT under the http_register OOM guard (raw registration
                  needed) — the handler self-guards its JSON build.
GET  /models      pin hint + catalog metadata (def/models_catalog.hpp). Detection is fully automatic;
                  the UI no longer offers a manual model picker.
GET  /diag[?verbose=0|1][?clear=1]   in-memory diag log
GET  /scan        WiFi scan (setup)
GET  /coredump[?clear=1]   stream the flash core-dump image (chunked octet-stream; 404 if none);
                  ?clear=1 erases the coredump partition
POST /set_wifi    {ssid,pass} -> persist + reboot
POST /set_mqtt    {broker,user,pass} -> persist + reboot ("" disables)
POST /set_hp      {profile,rx,tx} -> validate + apply live (no reboot). rx/tx PERSIST (the physical
                  pin cache — a manual override survives reboot); profile is session-only. The UI
                  always sends profile="auto" (fully automatic — no manual model pick); a concrete id
                  is still accepted (pins the model for this session) but never offered in the UI.
                  proto is NOT accepted (auto-detected); poll_s fixed at 1 s and lang removed
                  (English-only) — neither accepted. RX/TX are auto-detected; when the bus is silent
                  the ESP32 card's pin dropdown posts {profile:"auto",rx,tx} to re-run detection.
POST /detect      re-run auto-detection now (no reboot): reset profile to "auto" + invalidate the
                  fingerprint (RAM only) -> the next poll cycle sweeps protocol + re-fingerprints
GET  /ota/check   POST /ota/update   GET /ota/status
POST /mcp         MCP server (read-only; planned — route returns a JSON-RPC "not implemented" error)
```

No HTTP auth / TLS by design — trusted LAN only. See docs/SECURITY.md.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest *contiguous* free
block). Keep HTTP handlers under a try/catch that returns 503 on OOM (an uncaught throw unwinds
through C frames → `std::terminate` → reboot). Stream `/diag` and the MQTT discovery instead of
one big `std::string`. Treat any new large contiguous allocation as a crash risk. A reboot loop
also stops the poll cycle and drops MQTT availability.

## Typical debugging

```bash
scripts/run-mock-tests.sh                              # host logic tests (the fast loop)
screen /dev/cu.usbmodemXXXX 115200                     # serial monitor (native USB on s3)
curl http://daikin-altherma-esp32.local/status | jq          # device status
curl http://daikin-altherma-esp32.local/values | jq          # decoded values
esptool --chip esp32s3 -p <port> erase_flash           # wipe NVS (reset config)
```
