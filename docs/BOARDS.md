# Boards

Which ESP32-S3 boards this firmware runs on, what hardware each one brings, and **which of those
parts the firmware actually uses**. Wiring the X10A service port itself is
[WIRING.md](WIRING.md); this page is about the board.

The supported boards are the **M5Stack AtomS3 Lite** and **Seeed XIAO ESP32-S3**. Boards with an
integrated display, including the M5Stack AtomS3 and M5StickS3, are intentionally unsupported: the
firmware contains no display driver, display role, or remote-display MQTT path.

> **One image, several boards.** CI publishes a single `esp32s3` artifact
> ([`ci-build-all.sh`](../scripts/ci-build-all.sh)), so nothing board-specific may be a compile-time
> choice — it would fork the binary, its OTA manifest and the web installer per board. Everything
> below that differs between boards is therefore a **runtime setting** in NVS: the X10A RX/TX pins
> (auto-detected, `POST /set_hp`) and the status indicator + recovery button (`POST /set_board`,
> **⚙ Settings → ESP32 → Hardware**). Kconfig only seeds a device that has never been configured.

## What the firmware requires

| Requirement | Why |
|---|---|
| **ESP32-S3** target | The only target built. Not a hard chip limit — the code is target-agnostic — but nothing else is compiled or tested. |
| **≥ 4 MB flash** | [`partitions.csv`](../partitions.csv) is sized to fill 4 MB exactly (two ~2.03 MB OTA slots). A larger part simply leaves the top unused. |
| **Two free GPIOs** | The X10A link (RX + TX). See [WIRING.md](WIRING.md) for the chip-safe set. |
| **USB-Serial/JTAG** *(strongly preferred)* | `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG` — the serial console and the browser (Web Serial) installer. A board with only an external USB-UART bridge needs the console reconfigured. |

**Not required:** PSRAM (`CONFIG_SPIRAM` is off — the heap discipline in
[ARCHITECTURE.md](ARCHITECTURE.md) assumes internal RAM only), Bluetooth, Ethernet, or an SD slot.
None of them are used. A display is outside the supported hardware scope rather than an unused
optional peripheral.

---

## M5Stack AtomS3 Lite — the board the wiring guide is written for

A 24 × 24 mm cased board. Its two onboard parts are exactly the two the firmware can drive, and its
Grove port reaches X10A with no soldering — which is why [WIRING.md](WIRING.md) is written for it
(the README stays generic across ESP32-S3 boards).

| | |
|---|---|
| Chip / flash / PSRAM | ESP32-S3FN8 · 8 MB flash · no PSRAM |
| USB | USB-C, native USB-Serial/JTAG |
| X10A-safe pins broken out | **1, 2** (Grove), **5, 6, 7, 8, 38** (female header on the case) |
| X10A pins to set | **RX = 1 (G1)**, **TX = 2 (G2)** for the Grove port — *not* a default; pick them once |
| Status LED | **GPIO35**, WS2812C-2020 — an **addressable RGB** pixel |
| Button | **GPIO41**, front button, **active low** |
| Also on board | IR transmitter LED (GPIO4), reset button, Grove HY2.0-4P port |

**The pins are not automatic on this board.** The shipped `CONFIG_DAIKIN_RX_PIN`/`_TX_PIN` defaults
are the XIAO's 44/43, and detection only ever probes the cached pair, the default pair and each of
them swapped — none of which the AtomS3 Lite breaks out. So the bus stays silent until the pins are
picked once under **⚙ Settings → Protocol** (RX/TX dropdown, `POST /set_hp`); after that they are
cached in NVS and re-used every boot. Their order does not matter: the swap is probed too.

**Firmware mapping.** Set under **⚙ Settings → ESP32 → Hardware** (a save reboots). Pick
**M5Stack AtomS3 Lite** from the *Board* dropdown at the top of that dialog and all five fields below
fill in — the dropdown is this table, served by the firmware (`logic/board_presets.hpp`), so it
cannot drift from what follows. Nothing is written until you press Save, and editing any field
afterwards switches the dropdown back to *Custom*.

- Status LED → `led_gpio 35`, type **WS2812**. The six operating states then come out as colours —
  blue = setup portal, yellow = connecting, green = healthy, red double-flash = X10A down, orange =
  MQTT down — plus the recovery button's red strobe (armed) and solid white (erasing). *Active low*
  does not apply to a WS2812: it encodes "off" as the zero colour, so there is no drive level to
  invert.
- Recovery button → `btn_gpio 41`, **active low**. Held 5 s it erases all stored config and reboots
  into the setup portal.

**The Grove port is the tidy way in.** HY2.0-4P carries **GND, 5 V, G2, G1** — the same four wires
X10A needs — so one Grove breakout cable reaches the service port. Without one, the female header on
the case carries `5V`, `GND` and G5–G8/G38 for plain jumper wires. The 5 V level-shifter advice and
"power the board from USB, not off X10A's 50 mA" still apply exactly as in [WIRING.md](WIRING.md).

**Watch out:**

- **GPIO41 is a dedicated-JTAG pad (MTDI).** The firmware withholds GPIO39–42 from the *X10A* pin
  picker to keep an external debug probe usable — a preference, not a hardware conflict — but the
  LED/button picker offers them, because that is where this board's button physically is. Configuring
  the button costs you nothing unless you actually attach a JTAG probe.
- **GPIO39 is silkscreened "CLK_OUT3"** but is chip-level JTAG (MTCK) regardless of the label, so it
  is not offered for X10A.
- **GPIO35 is only safe because this build uses Quad (DIO) flash and no PSRAM.** On a build with
  Octal flash/PSRAM, GPIO33–37 carry SPIIO4-7/DQS and the firmware refuses them — for the indicator
  as well as for X10A.
- **The IR LED (GPIO4) has no use here.** The Altherma is controlled over X10A (and, for the planned
  HomeHub link, Modbus); there is no infrared path on the unit for the firmware to talk to.
- **No display** — the LCD is on the non-Lite AtomS3. Nothing in the firmware renders to one.

---

## Seeed XIAO ESP32-S3 — the board the pin defaults are written for

The only board that needs no pin configuration at all: `CONFIG_DAIKIN_RX_PIN`/`_TX_PIN` are its pads,
so a freshly flashed XIAO finds the bus on its own.

| | |
|---|---|
| Chip / flash / PSRAM | ESP32-S3R8 · 8 MB flash · 8 MB PSRAM (**unused** — this build runs no SPIRAM) |
| USB | USB-C, native USB-Serial/JTAG — flashes without a BOOT-button dance |
| X10A default pins | **RX = 44 (D7)**, **TX = 43 (D6)** — the `CONFIG_DAIKIN_RX_PIN`/`_TX_PIN` defaults |
| Other X10A-safe pins broken out | 1, 2, 4, 5, 6, 7, 8, 9 |
| Status LED | **GPIO21**, plain single-colour, **active low** |
| Button | none broken out |

**Firmware mapping.** Status indicator: `led_gpio 21`, `led_type` *plain LED*, **active low**
(the shipped first-boot default, so a XIAO needs no configuration). Recovery button: none — a XIAO
has no free momentary switch, so a factory reset stays a web-UI or USB job unless you wire your own
button to one of the free pins. Available as **Seeed XIAO ESP32-S3** in the *Board* dropdown under
**⚙ Settings → ESP32 → Hardware**, should the settings ever need restoring.

**Watch out:** GPIO3 (D2) is broken out as an ordinary pad but is the chip's JTAG-source-select
**strapping** pin, so the firmware never offers it for X10A. GPIO16/17 do not exist on the XIAO's
header at all.

---

## Other ESP32-S3 boards

Any board meeting *What the firmware requires* works; you supply the pin knowledge the firmware
cannot discover. There is no board-ID EEPROM on an ESP32-S3, so the firmware genuinely **cannot
know** which of the chip's pins your board breaks out — it only knows which ones the *chip* reserves
([`logic/board_pins.hpp`](../main/logic/board_pins.hpp)). Cross-reference `/status.pins_avail`
against your board's pinout; [WIRING.md](WIRING.md) has that cross-reference already done for the
boards that have come up, including the Waveshare ESP32-S3-DevKitC-1.

For the indicator and the button, read your board's schematic for the onboard LED pin, its polarity
(or whether it is a WS2812), and any free momentary switch, then enter them under
**⚙ Settings → ESP32 → Hardware** — leaving the *Board* dropdown on *Custom*, since the presets cover only the two boards
above. If your board has no LED the firmware can drive, leave the indicator on *None* — every state
it shows is also on `/status` and in the dashboard.

A board with no preset is worth knowing about for one reason: until you set the indicator, it runs
on the shipped default (a plain LED on GPIO21) and will silently drive that pin whether or not
anything is on it. `/diag` says which pin and driver it resolved to at boot (`led: LED indicator on
GPIO21 (active low)`), so a dark board is one line away from an explanation.

**Leave the recovery button on *None* unless one is really wired.** An unconfigured input pin
floats, and a floating pin that happens to read "pressed" for five seconds would erase the config of
a board nobody touched.

---

## Feature availability by board

`✅` used · `➖` present but not used by this firmware · `—` not on the board

| Firmware feature | AtomS3 Lite | XIAO ESP32-S3 |
|---|:---:|:---:|
| X10A link (2 GPIOs) | ✅ pick from 1, 2, 5–8, 38 | ✅ 44/43, the defaults |
| Browser (Web Serial) install + serial console | ✅ | ✅ |
| OTA self-update (dual slot, signed) | ✅ | ✅ |
| Status indicator | ✅ WS2812, GPIO35 | ✅ plain LED, GPIO21 |
| Recovery button (5 s factory reset) | ✅ GPIO41 | — |
| Grove connector for X10A | ✅ 5 V/GND/G1/G2 | — |
| PSRAM | — | ➖ 8 MB, unused |
| IR transmitter | ➖ no use case | — |
| Display | — (non-Lite AtomS3 only) | — |
