# daikin-altherma-esp32

ESP-IDF firmware: reads a **Daikin Altherma** over the **X10A** port (UART 9600 8E1, protocol I/S)
and publishes all values to MQTT / Home Assistant (auto-discovery). Runtime config + OTA via an
embedded web UI. Targets esp32s3 only.

Reference: [docs/README.md](docs/README.md) (protocol · API · values · build) ·
[ARCHITECTURE](docs/ARCHITECTURE.md) · [DESIGN](docs/DESIGN.md) · [SECURITY](docs/SECURITY.md).

## Requirements

- A Daikin Altherma with an **X10A** header.
- ESP32-S3, ≥4 MB flash. Reference board: Seeed XIAO ESP32-S3.
- A browser with Web Serial to flash.
- JST-EH 2.5 mm 5-pin or Dupont wires.

## Setup

1. Flash: [web installer](https://0bu.github.io/daikin-altherma-esp32/).
2. WiFi: join AP `daikin-altherma-esp32-setup` (captive portal / `192.168.4.1`).
3. Configure at `http://daikin-altherma-esp32.local`: just the MQTT `host:port`. WiFi can also be
   changed later from the dashboard's WiFi card (a bad password rolls back to the previous network
   automatically). The unit model and
   X10A protocol are **auto-detected** from the bus on every boot; the **RX/TX pins** are auto-detected
   too (if they can't be found, the dashboard ESP32 card offers a dropdown of the chip's safe GPIOs
   to pick from — see "Picking pins on a different board" below). The poll interval is fixed at 1 s
   and labels are English-only. MQTT + the RX/TX pin
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

### Picking pins on a different board

The dropdown (`/status.pins_avail`, driven by `logic/board_pins.hpp`) is a **chip-level** safe list —
every GPIO the ESP32-S3 itself doesn't reserve for boot flash, PSRAM, strapping, USB-JTAG or JTAG,
minus the status LED's pin (`DAIKIN_STATUS_LED_GPIO`, default 21) since the firmware drives that one
itself. It is **not** aware of any specific vendor board's silkscreen, since firmware has no way to
learn which of a chip's pins are actually wired to a header on the PCB it's soldered to. To find your
two wires on a board other than the XIAO, cross-reference that dropdown against your board's own
pinout diagram — here's that cross-reference already done for the boards that have come up:

| Board | Chip | Safe pins this board breaks out | Exceptions (broken out but NOT in the dropdown) |
| :--- | :--- | :--- | :--- |
| Seeed XIAO ESP32-S3 | ESP32-S3 | 1, 2, 4, 5, 6, 7, 8, 9, 43, 44 | GPIO3 (D2) — chip-level JTAG-select strap, even though the XIAO breaks it out as a plain pad |
| Waveshare ESP32-S3-DevKitC-1 | ESP32-S3 | 1, 2, 4–18, 35, 36, 37, 38, 43, 44, 47, 48 | GPIO0/3/45/46 (strapping), 19/20 (USB-JTAG, already the console), 39–42 (dedicated JTAG), 21 (status LED) |
| M5Stack AtomS3 Lite | ESP32-S3FN8 | 1, 2, 5, 6, 7, 8, 38 | GPIO39 ("CLK_OUT3" on this board's silkscreen) — chip-level dedicated JTAG (MTCK) regardless of what a board relabels it |

Pick any two distinct pins from a board's "safe pins" column for RX/TX, wire them to X10A, then set
them in the dashboard's dropdown (`POST /set_hp`) — see "Wiring" above for why the firmware won't
find them on its own until you do.

## Notes

- OTA from the web UI (config preserved). Web installer = first flash / recovery only.
- Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
- HA templates / COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). PR previews: `…/PR/<n>/`.

## Scope & credits

Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
