# daikin-altherma-esp32

ESP-IDF 5.x firmware for the ESP32 family. Reads a **Daikin Altherma** heat
pump over its **X10A** service port and bridges every value to **Home Assistant over MQTT**
(auto-discovery). Everything — WiFi (captive portal), MQTT, the unit model, the register set,
the RX/TX pins — is configured at runtime from a **web UI**; firmware is installed from a
**browser** (Web Serial) and updated **OTA**. Builds for **five targets — esp32, esp32s3,
esp32c3, esp32c6, esp32c5** — from ONE source tree; CI builds all five.

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
# Build (first run: set-target; afterwards plain `build` stays incremental). CI builds all five.
scripts/idf-docker.sh idf.py set-target esp32s3 build   # or esp32 / esp32c3 / esp32c6 / esp32c5

# Optional compile-time defaults (all also settable at runtime in the web UI)
scripts/idf-docker.sh idf.py menuconfig                 # -> Daikin Altherma Configuration

# Flash from the host (preserves nvs — @flash_args skips nvs@0x9000)
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
```

The reference board is the **Seeed XIAO ESP32-S3** — native USB-Serial/JTAG, flashes without a
BOOT-button dance. Its X10A pins default to **RX=44 (D7) / TX=43 (D6)**; GPIO16/17 are not
broken out on the XIAO.

## Architecture (component map)

```
main.cpp        boot: NVS, config, WiFi(STA)|setup-AP, mDNS, HTTP, MQTT, poll engine, OTA gate
config.cpp      runtime Config (logic/config_model.hpp) backed by NVS "daik_cfg"
nvs_storage.cpp thin NVS helpers (IDF nvs_* called with :: to avoid the daik::nvs_* collision)
wifi.cpp        STA bring-up + scan + mDNS  (reconnect/watchdog: TODO)
provisioning.cpp setup SoftAP (daikin-altherma-esp32-setup) + DHCP DNS-offer; HTTP is the shared :80 server
captive_dns.cpp UDP:53 catch-all (every name -> 192.168.4.1) so the setup portal auto-pops (AP mode only)
hp_comm.cpp     X10A UART (9600 8E1) + register query
hp_convert.cpp  device value formatting over logic/convert.hpp
hp_poll.cpp     poll engine task: profile registers -> query -> decode -> thread-safe cache
http_server.cpp esp_http_server :80; concerns register their own routes (http_handlers.hpp)
http_status.cpp GET / (setup.html in AP mode, else gzip UI) /status /values /models /diag /scan + captive catch-all
http_config.cpp POST /set_wifi /set_mqtt /set_hp /set_relays
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp (read-only MCP tools; TODO)
mqtt_ha.cpp     HA MQTT-Discovery bridge (streamed discovery; TODO esp-mqtt client)
ota_update.cpp  pull-based signed OTA + rollback health gate (check/download: TODO)
control.cpp     optional thermostat + SG-Ready relays (off unless pins set)
diag_log.cpp    in-RAM diag ring served by GET /diag
logic/          IDF-free, host-tested pure headers (crc, convert, registers, config_model,
                discovery, demo). demo.hpp fabricates plausible readings for the demo-mode toggle;
                the poll engine feeds them through the SAME convert/format path as real data.
def/            embedded per-model value profiles + registry + models_catalog.hpp (GET /models
                JSON). Profiles are machine-generated in the ValueDef row format from the X10A
                value definitions (docs/REGISTERS.md); tools/gen_defs.py imports classic .h-row files
www/            web UI sources (index.html + style.css + app.js -> one gzipped page) + setup.html
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `wifi_ssid`/`wifi_pass`, `mqtt_uri`/`mqtt_user`/`mqtt_pass`, `hostname`, `profile`, `lang`, `proto` (I/S), `rx_pin`/`tx_pin`, `poll_s`, `val_mask`, `therm_pin`/`sg1_pin`/`sg2_pin`, `demo` (0/1) |

`nvs` at `0x9000` is untouched by OTA (partitions.csv) so config survives upgrades. Keep its
offset/size stable across versions.

## HTTP API

```
GET  /            embedded web UI (gzipped into the app binary)
GET  /status      version, platform, wifi, mqtt, hp{proto,rx,tx,poll_s,connected,last_ok_s,
                  registers,values,crc_err,timeout_err,demo}, profile
GET  /values      decoded readings [{label,value,unit}]
GET  /models      model catalog: model list -> profile_map -> profile id, value menu, pin hint
                  (served from def/models_catalog.hpp; UI picks the model in the outdoor dropdown)
GET  /diag[?verbose=0|1][?clear=1]   in-memory diag log
GET  /scan        WiFi scan (setup)
POST /set_wifi    {ssid,pass} -> persist + reboot
POST /set_mqtt    {broker,user,pass} -> persist + reboot ("" disables)
POST /set_hp      {profile,lang,proto,rx,tx,poll_s,demo,values[]} -> validate + apply live (no reboot)
POST /set_relays  {therm_pin,sg1_pin,sg2_pin} -> optional control pins
GET  /api/proxy/1/version   {version, platform}
GET  /ota/check   POST /ota/update   GET /ota/status
POST /mcp         MCP server (read-only)
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
screen /dev/cu.usbmodemXXXX 115200                     # serial monitor (native USB on s3/c3/c6/c5)
curl http://daikin-altherma-esp32.local/status | jq          # device status
curl http://daikin-altherma-esp32.local/values | jq          # decoded values
esptool --chip esp32s3 -p <port> erase_flash           # wipe NVS (reset config)
```
