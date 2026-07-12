# daikin-altherma-esp32

ESP-IDF firmware: reads a **Daikin Altherma** over the **X10A** port (UART 9600 8E1, protocol I/S)
and publishes all values to MQTT / Home Assistant (auto-discovery). Runtime config + OTA via an
embedded web UI. Targets esp32 / esp32s3 / esp32c3 / esp32c6 / esp32c5.

Reference: [docs/README.md](docs/README.md) (protocol · API · values · build) ·
[ARCHITECTURE](docs/ARCHITECTURE.md) · [DESIGN](docs/DESIGN.md) · [SECURITY](docs/SECURITY.md).

## Requirements

- A Daikin Altherma with an **X10A** (bi-zone: **X12A**) header.
- ESP32, ≥4 MB flash. Reference board: Seeed XIAO ESP32-S3.
- A browser with Web Serial to flash; JST-EH 2.5 mm 5-pin or Dupont wires.

## Setup

1. Flash: [web installer](https://0bu.github.io/daikin-altherma-esp32/).
2. WiFi: join AP `daikin-altherma-esp32-setup` (captive portal / `192.168.4.1`).
3. Configure at `http://daikin-altherma-esp32.local`: RX/TX pins, poll interval, language,
   MQTT `host:port`. The unit model and X10A protocol are **auto-detected** from the bus — no
   manual pick. Live-applied, NVS-backed, OTA-persistent.

## Wiring — X10A (breaker OFF)

| X10A | Signal | ESP32 (XIAO S3) |
|------|--------|-----------------|
| 1 | +5 V  | `5V` (optional) |
| 2 | HP-TX | RX `GPIO44` (D7) |
| 3 | HP-RX | TX `GPIO43` (D6) |
| 5 | GND   | `GND` (mandatory) |

5 V TTL; level shifter on HP-TX→ESP-RX recommended. `GPIO16/17` absent on the XIAO → pins
configurable. `Timeout`/`Wrong CRC` = cable/GND; `0x15 0xEA` = use protocol `S`.

## Notes

- OTA from the web UI (config preserved). Web installer = first flash / recovery only.
- Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
- HA templates / COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). PR previews: `…/PR/<n>/`.

## Scope & credits

Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
