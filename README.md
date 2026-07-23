# daikin-altherma-esp32

ESP-IDF firmware: reads a **Daikin Altherma** over the **X10A** port (UART 9600 8E1, protocol I/S)
and publishes all values to MQTT. Runtime config + OTA via an
embedded web UI. ESP32-S3 only.

## Requirements

- A Daikin Altherma with an **X10A** header.
- JST-EH 2.5 mm 5-pin or Dupont wires.
- ESP32-S3, ≥4 MB flash.
- A browser with Web Serial to flash.

## Setup

1. Flash: [web installer](https://0bu.github.io/daikin-altherma-esp32/).
2. WiFi: join AP `daikin-altherma-esp32-setup` (captive portal / `192.168.4.1`).
3. Configure at `http://daikin-altherma-esp32.local`:
   - Set the MQTT `host:port`.
   - Model, X10A protocol and RX/TX pins are **auto-detected**.

## Wiring — X10A (breaker OFF)

| X10A | Signal | Wire Color | ESP32 (XIAO S3) | Note |
| :---: | :--- | :--- | :--- | :--- |
| 1 | +5 V | Red | `5V` | Optional — out of spec, prefer USB power |
| 2 | HP-TX | Brown | RX `GPIO44` (D7) | Connects to ESP32 RX |
| 3 | HP-RX | Green | TX `GPIO43` (D6) | Connects to ESP32 TX |
| 4 | NC | — | — | Not connected |
| 5 | GND | Black | `GND` | Mandatory |

Visual wiring diagram + picking pins on a different board: [docs/WIRING.md](docs/WIRING.md).

## Reference

| Doc | Description |
| :--- | :--- |
| [docs/README.md](docs/README.md) | Technical reference: protocol, HTTP API, values, build & flash |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Deep internal reference: poll engine, MQTT bridge, WiFi/OTA |
| [docs/DESIGN.md](docs/DESIGN.md) | Web UI design contract (tokens, layout, states) |
| [docs/X10A_PROTOCOL.md](docs/X10A_PROTOCOL.md) | X10A wire protocol: framing, checksum, register pages, detection |
| [docs/REGISTERS.md](docs/REGISTERS.md) | Register map + converter/enum tables behind the value catalog |
| [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md) | MQTT topics, entities and derived (COP) sensors |
| [docs/WIRING.md](docs/WIRING.md) | Visual wiring diagram + picking RX/TX pins on other boards |
| [docs/FEATURES.md](docs/FEATURES.md) | Catalog of platform features (Secure Boot, OTA, WebSocket, diagnostics, …) |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model + OTA signing/key lifecycle |
| [docs/MCP.md](docs/MCP.md) | Planned read-only MCP surface (not yet implemented) |

## Notes

- OTA from the web UI (config preserved). Web installer = first flash / recovery only.
- Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
- HA templates / COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). PR previews: `…/PR/<n>/`.

## Scope & credits

Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
