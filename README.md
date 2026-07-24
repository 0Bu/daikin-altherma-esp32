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
   - The UI follows your browser language (**German** for a `de*` browser, else English). Heat-pump
     value labels stay English — they are the X10A register names.

## Wiring — X10A (breaker OFF)

| X10A | Signal | Wire Color | ESP32 (XIAO S3) | Note |
| :---: | :--- | :--- | :--- | :--- |
| 1 | +5 V | Red | `5V` | Optional — out of spec, prefer USB power |
| 2 | HP-TX | Brown | RX `GPIO44` (D7) | Connects to ESP32 RX |
| 3 | HP-RX | Green | TX `GPIO43` (D6) | Connects to ESP32 TX |
| 4 | NC | — | — | Not connected |
| 5 | GND | Black | `GND` | Mandatory |

Visual wiring diagram + picking pins on a different board: [docs/WIRING.md](docs/WIRING.md).

## Board hardware — status LED and recovery button

One firmware image serves every ESP32-S3 board, so the parts that differ *between* boards are
runtime settings, configured in the dashboard under **ESP32 → Hardware**:

| Board | Status LED | Recovery button |
| :--- | :--- | :--- |
| Seeed XIAO ESP32-S3 | `GPIO21`, plain LED, active low | none broken out |
| M5Stack AtomS3 Lite | `GPIO35`, WS2812 (addressable RGB) | `GPIO41`, active low |

The LED shows link and bus state at a glance — blue = setup portal, yellow = connecting, green =
healthy, red double-flash = X10A link down, orange = MQTT down (a plain single-colour LED shows the
same states as distinct blink patterns).

A configured **recovery button held for 5 seconds erases every stored setting** — WiFi, MQTT,
Syslog/NTP, the X10A pin cache — and reboots into the setup portal. It is the way back in when the
device has joined a network you can no longer reach, which is otherwise a USB-and-`erase_flash` job.
The LED flashes red once the reset is armed (let go to abort) and turns solid white while erasing.
Leave it set to **None** unless a button is actually wired: an unconnected pin can float and trigger
it on its own. Per-board hardware inventory: [docs/BOARDS.md](docs/BOARDS.md); wiring:
[docs/WIRING.md](docs/WIRING.md).

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
| [docs/BOARDS.md](docs/BOARDS.md) | Supported boards: what hardware each has and which parts the firmware uses |
| [docs/FEATURES.md](docs/FEATURES.md) | Catalog of platform features (Secure Boot, OTA, WebSocket, diagnostics, …) |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model + OTA signing/key lifecycle |
| [docs/MCP.md](docs/MCP.md) | Planned read-only MCP surface (not yet implemented) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | What's useful to report, the two local verification gates, how PRs land |

## Notes

- OTA from the web UI (config preserved). Web installer = first flash / recovery only.
- Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
- HA templates / COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). PR previews: `…/PR/<n>/`.

## Scope & credits

Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
