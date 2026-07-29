# daikin-altherma-esp32

ESP-IDF firmware: reads a **Daikin Altherma** over the **X10A** port (UART 9600 8E1, protocol I/S)
and publishes all values to MQTT. Runtime config + OTA via an
embedded web UI. ESP32-S3 only.

## Requirements

- A Daikin Altherma with an **X10A** header.
- Any ESP32-S3 board with ≥4 MB flash ([docs/BOARDS.md](docs/BOARDS.md)).
- A JST-EH 2.5 mm 5-pin connector to reach the X10A header.
- A browser with Web Serial to flash.

## Setup

1. Flash: [web installer](https://0bu.github.io/daikin-altherma-esp32/).
2. On a first install or after **Erase**, join AP `daikin-altherma-esp32-setup`
   (captive portal / `192.168.4.1`).
3. Configure at `http://daikin-altherma-esp32.local`.

## Wiring X10A

Breaker OFF. Three wires reach the heat pump: the two signals and ground.

![The X10A header on the indoor unit's PCB: pin 1 (+5 V) at the right, pin 5 (GND) at the left. The TX/RX labels name the ESP32's side of each signal.](docs/media/x10a-header.jpg)

| X10A | Signal | X10A wire | ESP32-S3 | Note |
| :---: | :--- | :--- | :--- | :--- |
| 1 | +5 V | Red | — | Optional — out of spec, prefer USB power |
| 2 | HP-TX | Brown | RX GPIO | Heat pump sends → ESP32 receives |
| 3 | HP-RX | Green | TX GPIO | ESP32 sends → heat pump receives |
| 4 | NC | — | — | Not connected |
| 5 | GND | Black | `GND` | Mandatory |

**Tell the firmware which two pins you used.** The signals can go to any two free GPIOs, so the
firmware cannot know them:

1. Wire HP-TX and HP-RX to two free GPIOs on your board.
2. Select those two in the RX/TX dropdown under **⚙ Settings → ESP32**. It lists only the GPIOs
   this chip allows. The choice is saved and reused on every boot.

Until that setting matches your wiring, no values arrive: the firmware tries the saved pins and its
built-in defaults (`RX 44` / `TX 43`) — it does not scan every pin. Mixing up RX and TX is harmless,
both orders are tried automatically; mixing up 5 V and GND is not.

Visual diagram, the full cable chain, and the wiring worked through on specific boards:
[docs/WIRING.md](docs/WIRING.md).

## UI

One screen, live from the bus: what the unit is doing right now, with any reading the firmware
cannot currently stand behind shown as `—` rather than as a number.

![The dashboard through four operating states: standby, domestic hot water, space heating, and heating + DHW](docs/media/dashboard.gif)

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
| [docs/FEATURES.md](docs/FEATURES.md) | Catalog of platform features (Secure Boot, OTA, diagnostics, …) |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model + OTA signing/key lifecycle |
| [docs/MCP.md](docs/MCP.md) | Planned read-only MCP surface (not yet implemented) |
| [docs/REPORTING.md](docs/REPORTING.md) | Reporting a bug: the public issue, the private device report, what gets redacted |
| [CONTRIBUTING.md](CONTRIBUTING.md) | What's useful to report, the local verification loop, how PRs land |

## Scope & credits

Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
