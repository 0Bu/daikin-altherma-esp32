# daikin-altherma-esp32

ESP-IDF firmware: reads a **Daikin Altherma** over the **X10A** port (UART 9600 8E1, protocol I/S)
and publishes all values to MQTT / Home Assistant (auto-discovery). Runtime config + OTA via an
embedded web UI. Targets esp32s3 only.

Reference: [docs/README.md](docs/README.md) (protocol · API · values · build) ·
[ARCHITECTURE](docs/ARCHITECTURE.md) · [DESIGN](docs/DESIGN.md) · [SECURITY](docs/SECURITY.md).

## Requirements

- A Daikin Altherma with an **X10A** (bi-zone: **X12A**) header.
- ESP32-S3, ≥4 MB flash. Reference board: Seeed XIAO ESP32-S3.
- A browser with Web Serial to flash; JST-EH 2.5 mm 5-pin or Dupont wires.

## Setup

1. Flash: [web installer](https://0bu.github.io/daikin-altherma-esp32/).
2. WiFi: join AP `daikin-altherma-esp32-setup` (captive portal / `192.168.4.1`).
3. Configure at `http://daikin-altherma-esp32.local`: just the MQTT `host:port`. WiFi can also be
   changed later from the dashboard's WiFi card (a bad password rolls back to the previous network
   automatically). The unit model and
   X10A protocol are **auto-detected** from the bus on every boot; the **RX/TX pins** are auto-detected
   too (if they can't be found, the dashboard ESP32 card offers a dropdown of the board's usable GPIOs
   to pick from). The poll interval is fixed at 1 s and labels are English-only. MQTT + the RX/TX pin
   cache are NVS-backed and OTA-persistent; the model is re-detected each boot.

## Wiring — X10A (breaker OFF)

| X10A | Signal | Wire Color | ESP32 (XIAO S3) | Note |
| :---: | :--- | :--- | :--- | :--- |
| 1 | +5 V | Red | `5V` | Optional — out of spec, prefer USB power |
| 2 | HP-TX | Brown | RX `GPIO44` (D7) | Connects to ESP32 RX |
| 3 | HP-RX | Green | TX `GPIO43` (D6) | Connects to ESP32 TX |
| 4 | NC | — | — | Not connected |
| 5 | GND | Black | `GND` | Mandatory |

### Visual Wiring Diagram

```text
          Daikin X10A Connector                     Seeed Studio XIAO ESP32-S3
          +------------------------+                      +-------------+
          |  1    2   3    4    5  |                      |   [USB-C]   |
          | [R] [Br] [G] [NC] [Bk] |                      |             |
          +--|----|---|---------|--+                      |             |
             |    |   |         |             D0 (GPIO1)  | [ ]     [X] |  5V  <--- [R] (Red, Pin 1) --+
             |    |   |         +-- GND (Black, Pin 5) -->| [ ]     [X] |  GND                         |
             |    |   |                       D2 (GPIO3)  | [ ]     [ ] |  3V3                         |
             |    |   |                       D3 (GPIO4)  | [ ]     [ ] |  D10                         |
             |    |   |                       D4 (GPIO5)  | [ ]     [ ] |  D9                          |
             |    |   |                       D5 (GPIO6)  | [ ]     [ ] |  D8                          |
             |    |   +------- HP-RX (Green, Pin 3) ----->| [X]     [X] |  D7 (RX) <-- [Br] (Pin 2) -+ |
             |    |                                       (D6/TX)   (D7/RX)                          | |
             |    +----------------------------------------------------------------------------------+ |
             +-----------------------------------------------------------------------------------------+
```

5 V TTL; level shifter on HP-TX→ESP-RX recommended. Daikin rates X10A at 5 V / **50 mA**, less than
an ESP32 draws — prefer USB power ([details](docs/README.md#voltage-and-wiring)). `GPIO16/17` absent
on the XIAO → pins configurable. `Timeout`/`Wrong CRC` = cable/GND; `0x15 0xEA` = use protocol `S`.

## Notes

- OTA from the web UI (config preserved). Web installer = first flash / recovery only.
- Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
- HA templates / COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). PR previews: `…/PR/<n>/`.

## Scope & credits

Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
