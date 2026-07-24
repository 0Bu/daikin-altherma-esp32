# X10A Wiring

Pin table and quick-start wiring: [README.md § Wiring — X10A](../README.md#wiring--x10a-breaker-off).
This page covers the visual diagram and picking pins on a board other than the reference XIAO.

## Visual Wiring Diagram

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
an ESP32 draws — prefer USB power ([details](README.md#voltage-and-wiring)). `GPIO16/17` absent
on the XIAO → pins configurable. `Timeout`/`Wrong CRC` = cable/GND; `0x15 0xEA` = use protocol `S`.

## Picking pins on a different board

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
them in the dashboard's dropdown (`POST /set_hp`) — see the pin table in
[README.md § Wiring — X10A](../README.md#wiring--x10a-breaker-off) for why the firmware won't find
them on its own until you do.

On the AtomS3 Lite the **Grove HY2.0-4P port carries GND, 5 V, G2 and G1** — the same four wires
X10A needs — so a Grove cable is the tidiest way to reach the service port. The 5 V/level-shifter
and "power the board over USB, not off X10A's 50 mA" notes in the README apply unchanged.

## Status LED and recovery button

These are the board's own onboard parts, and they are **runtime settings**, not build options: CI
publishes one `esp32s3` image, and the boards it runs on disagree about what they have. Set them in
the dashboard under **ESP32 → Hardware** (`POST /set_board`); a save reboots.

| Board | Status LED | Recovery button |
| :--- | :--- | :--- |
| Seeed XIAO ESP32-S3 | GPIO21, plain LED, **active low** | none broken out |
| M5Stack AtomS3 Lite | GPIO35, **WS2812** (addressable RGB) | GPIO41, **active low** |

The picker for these two offers a slightly **wider** pin set than the RX/TX one: it also includes
the dedicated-JTAG pads GPIO39–42. Those are withheld from the X10A dropdown only to keep an
external debug probe usable — a preference, not a hardware conflict — and it is exactly where the
AtomS3 Lite's button sits (GPIO41 = MTDI). Flash, strapping and the USB-Serial/JTAG console pins
stay excluded from both.

Leave the button on **None** unless one is really wired. An unconnected input pin floats, and a
floating pin that happens to read "pressed" for five seconds would factory-reset a board nobody
touched. When one *is* configured, holding it erases every stored setting (WiFi, MQTT, Syslog/NTP,
the X10A pin cache) and reboots into the setup portal — the LED flashes red once the reset is armed
(release to abort), then goes solid white while erasing.
