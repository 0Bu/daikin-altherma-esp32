# daikin-altherma-esp32 — Technical Reference

ESP-IDF firmware that reads a **Daikin Altherma** heat pump over its
**X10A** service port and bridges every value to Home Assistant over MQTT. Configured entirely
at runtime from a web UI — WiFi, MQTT, the unit model, the register set, the poll interval and
the RX/TX pins — and updated over the air. User guide: [../README.md](../README.md).

---

## Hardware

- **Targets:** esp32, esp32s3, esp32c3, esp32c6, esp32c5 — one source tree, per-target images (CI builds
  all). No BLE is used, so any WiFi-capable ESP32 works; the **Seeed XIAO ESP32-S3** is the
  reference board. **≥ 4 MB flash** (dual-OTA layout: two ~2 MB app slots). No PSRAM required.
- **Heat-pump link:** the X10A port is a 5 V TTL UART at **9600 8E1**. The ESP maps any two free
  GPIOs to a hardware UART (`RX_PIN` ← X10A pin 2 / HP-TX, `TX_PIN` → X10A pin 3 / HP-RX). The
  USB/native-USB console is a *separate* UART, so device logs never collide with the HP link.
- **Reference wiring (XIAO ESP32-S3):** `RX = GPIO44` (pad D7), `TX = GPIO43` (pad D6),
  `GND` mandatory, `5V` optional. `GPIO16/17` — the classic-ESP32 default — are **not** broken
  out on the XIAO, which is why pins are configurable.

### Voltage and wiring

X10A is 5 V TTL; the ESP32 GPIOs are 3.3 V and not officially 5 V-tolerant. A direct connection
typically works in practice, but the safe option is a level shifter
on the **HP-TX → ESP-RX** line. Whatever you do, **GND must always be common** between the ESP
and X10A, even when the ESP is USB-powered. The X10A 5 V pin can usually power the ESP (~70 mA);
if that rail is weak, power the ESP from USB instead.

---

## Flash prebuilt artifacts

Browser flasher + captive-portal setup: [../README.md](../README.md). The flasher is served on
GitHub Pages (ESP Web Tools / Web Serial), rebuilt and deployed by CI on every firmware change;
each change also publishes a
[GitHub release](https://github.com/0Bu/daikin-altherma-esp32/releases/latest) with the same
bins.

Flash by hand (needs `brew install esptool`). Use the per-target **merged** image — it bakes in
the correct bootloader offset, so one command works for any chip. This erases `nvs` (you re-enter
WiFi + model config once):

```bash
# <suffix>: "" for esp32, else -s3 / -c3 / -c6 / -c5
esptool --chip <esp32|esp32s3|esp32c3|esp32c6|esp32c5> write_flash 0x0 \
  daikin-altherma-esp32<suffix>-<version>-merged.bin
```

To preserve `nvs`, flash the separate parts from a local `build/`:
`cd build && esptool --chip <target> write_flash "@flash_args"`.

---

## Build from source

Builds run in the official **ESP-IDF Docker image, pinned to the version CI uses**
(`scripts/idf-docker.sh` reads it from `.github/workflows/build.yml`, so it never drifts) — no
local toolchain to install. Flashing is done from the host with `esptool` (Docker Desktop has no
USB passthrough).

```bash
brew install esptool                                              # host flasher (once)
git clone https://github.com/0Bu/daikin-altherma-esp32.git && cd daikin-altherma-esp32

# Build via the CI-pinned ESP-IDF image (first run pulls it — 2-4 min). Pick your chip:
./scripts/idf-docker.sh idf.py set-target esp32s3 build            # or esp32 / esp32c3 / esp32c6 / esp32c5

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
I (540) cfg:  model in=ETBH12E out=ERGA04-08E tank=EKHWSP  proto=I  rx=44 tx=43  poll=30s
I (900) wifi: connected to 'MyNetwork'  ip=192.0.2.42
I (950) hp:   X10A UART @9600 8E1  querying 9 registers, 35 values
I (1000) http: server on :80
```

---

## The Daikin X10A protocol (how values are read)

The X10A port exposes the heat pump's internal monitoring bus. The firmware is a **polling
reader** — it never changes settings (see [Control](#optional-control) for the separate relay
feature).

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

The classic Altherma-monitor approach compiles in one `def/<model>.h` array of `{register, offset, convId, size,
type, label}` rows and you edit which lines are active. This project keeps the **same data** but
makes it **runtime-selectable**:

- The register/label tables for the supported model families are embedded as static profiles in
  `main/def/` (generated from the classic Altherma `def/*` files, incl. the localized label sets).
- The web UI maps your **indoor + outdoor + tank** selection to a **profile id**; you then tick
  which values to actually query (a bitmask) and the label **language**.
- The active profile + value mask + pins + interval + protocol live in NVS and drive the poll
  engine (`main/hp_poll.*`). No recompile to change model, values or pins.

If no exact profile matches your unit, pick the closest or *Generic* — unimplemented registers
read blank (documented behaviour).

---

## Configuration model

All runtime config lives in NVS namespace **`daik_cfg`**; compile-time defaults come from
`main/Kconfig.projbuild` (menu *Daikin Altherma Configuration*). The web UI is the primary way to
set everything; `menuconfig` only seeds first-boot defaults.

| NVS key | Meaning |
|---------|---------|
| `wifi_ssid` / `wifi_pass` | Station credentials (else the setup AP runs). |
| `mqtt_uri` | HA-bridge broker (`host:port` or full `mqtt(s)://…`; empty = MQTT off). |
| `mqtt_user` / `mqtt_pass` | Optional broker auth. |
| `hostname` | mDNS/host name (default `daikin-altherma-esp32`). |
| `profile` | Active value-definition profile id (from the model selection). |
| `lang` | Label language (`en`/`de`/`fr`/`es`/`it`/`ja`). |
| `proto` | Heat-pump protocol (`I` or `S`). |
| `rx_pin` / `tx_pin` | X10A UART GPIOs. |
| `poll_s` | Poll interval seconds (5–600, default 30). |
| `val_mask` | Which values of the profile are queried (bitset, chunked). |
| `therm_pin` | Optional on/off thermostat relay GPIO (`-1` = disabled). |
| `sg1_pin` / `sg2_pin` | Optional SG-Ready smart-grid relay GPIOs (`-1` = disabled). |

`nvs` offset/size must not change across versions, or old data is stranded on OTA.

---

## HTTP API

Base: `http://<ESP32-IP>` (or `http://daikin-altherma-esp32.local`). No auth / TLS by design — trusted
LAN only, see [SECURITY.md](SECURITY.md).

```
GET  /  (alias /index.html)        # embedded web UI (gzipped into the app binary)
GET  /status                       # { version, platform, wifi:{ssid,rssi,ip},
                                   #   mqtt:{configured,connected,tls,broker,error?},
                                   #   hp:{proto,rx,tx,poll_s,connected,last_ok_s,
                                   #        registers,values,crc_err,timeout_err,last_error},
                                   #   profile:{id,in,out,tank,lang} }
GET  /values                       # decoded readings [{label,value,unit,raw?}] (last poll cycle)
GET  /models                       # catalog: indoor/outdoor/tank lists → profile ids, value menu
GET  /diag[?verbose=0|1][?clear=1] # plain-text in-memory diag log (raw RX frames when verbose)
POST /set_wifi                     # { ssid, pass } → persist + reboot
POST /set_mqtt                     # { broker, user?, pass? } → persist + reboot ("" disables)
POST /set_hp                       # { profile, lang, proto, rx, tx, poll_s, values[] } → apply live
POST /set_relays                   # { therm_pin?, sg1_pin?, sg2_pin? } → optional control pins
GET  /api/proxy/1/version          # { version, platform } (firmware + running chip)
GET  /ota/check[?ms=<epoch>]       # start a background update check (poll /ota/status)
POST /ota/update                   # start the background self-update (downloads, then reboots)
GET  /ota/status                   # { state, progress, message, available, update_available, current }
POST /mcp                          # MCP server for AI agents (read-only get_hp_values / get_status)
```

Every handler runs under an OOM try/catch that returns `503` rather than crashing (memory is the
binding constraint on these chips). `/diag` streams instead of building one big buffer.

---

## Home Assistant (MQTT)

`main/mqtt_ha.cpp` mirrors every decoded value to MQTT using Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery), so a **Daikin
Altherma** device with all entities appears in HA automatically — no YAML. **Read-only:** no
command topics are subscribed. The bridge runs in its own task, independent of the poll engine.

- **Enable:** set the broker in the web UI (Setup → MQTT). Stored in NVS `mqtt_uri`.
- **TLS:** a schemeless entry defaults to plaintext `mqtt://` unless credentials are present, in
  which case it defaults to `mqtts://` (CA-verified) so the password isn't sniffable; no silent
  plaintext fallback. An explicit scheme is always honoured. Reason surfaces in `/status.mqtt`.
- **Node id:** `daikin_<mac3>` from the WiFi STA MAC (stable across config changes).
- **Topics:** `<base>/<node>/state` (retained JSON of all values), plus per-value discovery
  configs under `<prefix>/<sensor>/<node>/<object>/config` (retained). Availability/LWT
  `<base>/<node>/availability`. `<base>` defaults `daikin-altherma-esp32`, `<prefix>` `homeassistant`.
- **Autodiscovery streaming.** A full Altherma value set can exceed 10 KB of discovery JSON;
  discovery is emitted incrementally (chunked) so it never needs one large contiguous heap block.

Derived sensors (COP etc.) and a sample dashboard: [HOME_ASSISTANT.md](HOME_ASSISTANT.md).

---

## OTA (self-update)

Pull-based: the device fetches `manifest.json` from
`CONFIG_DAIKIN_OTA_MANIFEST_URL` (default GitHub Pages), compares its `version` to the running
firmware, and on confirmation downloads its per-target image
`daikin-altherma-esp32<suffix>.bin` via `esp_https_ota` into the inactive OTA slot, then reboots.
`esp_https_ota` verifies the image chip-id (wrong-target image refused).

- **Downgrade gate:** before the bulk download, `ota_task` reads the image's own version and
  refuses anything not strictly newer — a signature proves authenticity, not freshness.
- **Rollback armed:** `main.cpp` defers `esp_ota_mark_app_valid_cancel_rollback()` to a health
  gate (~90 s), so a boots-but-crashes image reverts.
- **Signed images:** Secure Boot v2 RSA-3072 signing *without* hardware Secure Boot — the running
  app verifies the signature before installing an OTA (no eFuses; reversible; web installer still
  works). CI signs each image with the offline `OTA_SIGNING_KEY`. Details:
  [SECURITY.md](SECURITY.md).

Partition layout (`partitions.csv`) is dual-OTA sized to fill 4 MB (a larger flash just leaves
the top unused), so one table serves every target; app at `0x20000`.

---

## Optional control

Monitoring is read-only, but the firmware can optionally drive relays for
coarse control (it still cannot change the heat pump's internal register settings):

- **On/off thermostat relay** (`therm_pin`) — simulates an external on/off thermostat; exposed as
  a Home Assistant switch. Wire to your unit's external-thermostat input.
- **SG-Ready smart grid** (`sg1_pin` / `sg2_pin`) — the two SG contacts; publish `0..3` to
  `<base>/<node>/sg/set`, current mode on `<base>/<node>/sg/state`. Requires SG enabled in the
  heat pump's menu.
- **Operation mode via two relays** (planned option) — off / heat / cool can be selected by two
  relays wired to the unit's mode inputs; when switching, de-energise both relays first to avoid a
  transient invalid combination. Not yet exposed by the firmware; the single on/off relay above is.

Both are off by default and set from the web UI (Setup → Control). Pin choice and modes follow
the classic Altherma conventions; wiring per your unit's schematic.

---

## Security

Full threat model + Flash Encryption / Secure Boot notes: [SECURITY.md](SECURITY.md).

- The API has **no auth / TLS** by design (trusted LAN only) — never expose it to the internet.
- WiFi/MQTT credentials live in NVS **unencrypted** by default; enable Flash + NVS Encryption
  (irreversible) if physical access is a concern.
- The heat-pump link is read-only; the optional control relays are the only outputs and are
  off unless you wire and enable them.

---

## License

[MIT License](../LICENSE). Not affiliated with Daikin.
