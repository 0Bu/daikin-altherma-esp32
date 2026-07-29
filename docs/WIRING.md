# X10A Wiring

Pin table and quick-start wiring: [README.md § Wiring — X10A](../README.md#wiring--x10a-breaker-off).
This page covers the visual diagram and picking pins on a board other than the M5Stack AtomS3 Lite
the wiring guide is written for.

## Visual Wiring Diagram — M5Stack AtomS3 Lite (Grove)

The Grove HY2.0-4P port carries **GND, 5 V, G2, G1** — the same four wires X10A needs — so a
Grove breakout cable reaches the service port with nothing to solder:

```text
   Daikin X10A (5-pin)                Grove breakout             M5Stack AtomS3 Lite
   +---------------------+
   | 1  +5 V    (Red)    | ----------- Red    -------------->  5V    (optional, see below)
   | 2  HP-TX   (Brown)  | ----------- Yellow -------------->  G1 = GPIO1  (RX)
   | 3  HP-RX   (Green)  | ----------- White  -------------->  G2 = GPIO2  (TX)
   | 4  NC               |             —
   | 5  GND     (Black)  | ----------- Black  -------------->  GND   (mandatory)
   +---------------------+
```

Grove colours are the standard cable's; if your adapter differs, go by the port, not the colour.
**Without a Grove cable**, the female header on the case carries `5V`, `GND` and `G5`–`G8`/`G38` —
use any two of those for the signals (e.g. RX `G5`, TX `G6`).

Either way the two pins must be **picked once** under **⚙ Settings → ESP32** (RX/TX dropdown):
the shipped defaults are the XIAO's `44`/`43`, which this board does not break out, so nothing
answers until you set them. Their order does not matter — detection probes the pair both ways round.

5 V TTL; level shifter on HP-TX→ESP-RX recommended. Daikin rates X10A at 5 V / **50 mA**, less than
an ESP32 draws — prefer USB power ([details](README.md#voltage-and-wiring)). `GPIO16/17` — the
classic-ESP32 default — are absent on both boards, which is why the pins are configurable.
`Timeout`/`Wrong CRC` = cable/GND; `0x15 0xEA` = use protocol `S`.

### The cable chain, connector by connector

Two ready-made cables meet in the middle, so nothing is soldered and nothing is cut: a **JST-EH
2.5 mm 5-pin pigtail** plugs into the unit's X10A header and ends in **female 2.54 mm jumper**
sockets; a **Grove breakout** cable plugs into the AtomS3 Lite and ends in **male 2.54 mm** pins.
The male pins push straight into the female sockets.

```text
   Daikin X10A      JST-EH 2.5 mm 5-pin       jumper joint      Grove breakout       M5Stack AtomS3 Lite
   (unit header)    pigtail                   [F] <- [M]        breakout cable       Grove HY2.0-4P
   +------------+
   | 1  +5 V    |--- pigtail wire --------->  [F] <- [M]  ----- Red ------------->  5V   (optional)
   | 2  HP-TX   |--- pigtail wire --------->  [F] <- [M]  ----- Yellow ---------->  G1 = GPIO1  (RX)
   | 3  HP-RX   |--- pigtail wire --------->  [F] <- [M]  ----- White ----------->  G2 = GPIO2  (TX)
   | 4  NC      |--- pigtail wire --------->  [F]   (unused — insulate, don't cut)
   | 5  GND     |--- pigtail wire --------->  [F] <- [M]  ----- Black ----------->  GND  (mandatory)
   +------------+

   [F] = female 2.54 mm jumper socket, on the JST-EH pigtail
   [M] = male 2.54 mm pin, on the Grove breakout (4 pins for 5 sockets — pin 4 stays free)
```

**The two connectors are not in the same order**, so the joint has to be made wire by wire — you
cannot push two 4-way blocks together. X10A runs `+5 V, HP-TX, HP-RX, NC, GND`; Grove runs
`GND, 5 V, G2, G1`. If either cable ends in a moulded multi-way housing instead of loose singles,
either free the pins from it (small retaining tab) or bridge the joint position by position with
single male-to-female jumpers.

**Go by pin number, not by the pigtail's colours.** The Red/Brown/Green/Black in the diagram at the
top of this page are the *Daikin* harness colours; a separately bought JST-EH pigtail comes in
whatever the seller used (rainbow
ribbon is common), and its colours carry no meaning here. Identify pin 1 on the unit's header from
the Daikin service diagram, then ring the pigtail out with a multimeter before anything is plugged
in — a +5 V wire landing on a signal pin is the one mistake this chain makes easy.

**Only three of the four Grove wires are needed** if the board is USB-powered, which is the
recommendation ([50 mA](README.md#voltage-and-wiring)): leave the red 5 V pin out of the joint and
insulate it, exactly like the NC socket. GND is never optional — it must be common even on USB
power.

### Same wiring on a Seeed XIAO ESP32-S3

The board the compile-time pin defaults are written for, so it needs no pin configuration at all:

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

## Picking pins on a different board

The dropdown (`/status.pins_avail`, driven by `logic/board_pins.hpp`) is a **chip-level** safe list —
every GPIO the ESP32-S3 itself doesn't reserve for boot flash, PSRAM, strapping, USB-JTAG or JTAG,
minus the status LED's pin (`DAIKIN_STATUS_LED_GPIO`, default 21) since the firmware drives that one
itself. It is **not** aware of any specific vendor board's silkscreen, since firmware has no way to
learn which of a chip's pins are actually wired to a header on the PCB it's soldered to. To find your
two wires on a board other than the two above, cross-reference that dropdown against your board's
own pinout diagram — here's that cross-reference already done for the boards that have come up:

| Board | Chip | Safe pins this board breaks out | Exceptions (broken out but NOT in the dropdown) |
| :--- | :--- | :--- | :--- |
| M5Stack AtomS3 Lite | ESP32-S3FN8 | 1, 2 (Grove), 5, 6, 7, 8, 38 (case header) | GPIO39 ("CLK_OUT3" on this board's silkscreen) — chip-level dedicated JTAG (MTCK) regardless of what a board relabels it |
| Seeed XIAO ESP32-S3 | ESP32-S3 | 1, 2, 4, 5, 6, 7, 8, 9, 43, 44 | GPIO3 (D2) — chip-level JTAG-select strap, even though the XIAO breaks it out as a plain pad |
| Waveshare ESP32-S3-DevKitC-1 | ESP32-S3 | 1, 2, 4–18, 35, 36, 37, 38, 43, 44, 47, 48 | GPIO0/3/45/46 (strapping), 19/20 (USB-JTAG, already the console), 39–42 (dedicated JTAG), 21 (status LED) |

Pick any two distinct pins from a board's "safe pins" column for RX/TX, wire them to X10A, then set
them in the RX/TX dropdown under **⚙ Settings → ESP32** (`POST /set_hp`) — see the pin table in
[README.md § Wiring — X10A](../README.md#wiring--x10a-breaker-off) for why the firmware won't find
them on its own until you do.

## Status LED and recovery button

These are the board's own onboard parts, and they are **runtime settings**, not build options: CI
publishes one `esp32s3` image, and the boards it runs on disagree about what they have. Set them in
**⚙ Settings → ESP32 → Hardware** (`POST /set_board`); a save reboots.

| Board | Status LED | Recovery button |
| :--- | :--- | :--- |
| M5Stack AtomS3 Lite | GPIO35, **WS2812** (addressable RGB) | GPIO41, **active low** |
| Seeed XIAO ESP32-S3 | GPIO21, plain LED, **active low** | none broken out |

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
