# Boards

The supported presets are **M5Stack AtomS3 Lite** and **Seeed XIAO ESP32-S3**. One `esp32s3` image
serves both; board identity, indicator, recovery button and optional ENV III wiring are runtime
settings under **Settings → ESP32 → Hardware**. X10A RX/TX selection is under **Settings → Protocol**.

The board selection is your hardware statement, not automatic detection. It narrows the pin
selectors using [`board_presets.hpp`](../main/logic/board_presets.hpp). Editing an indicator or button
keeps that selected identity; choosing **Custom** removes the preset's accessory capability.
Board/peripheral/sensor settings are validated and persisted together. Changed peripheral settings
reboot; an identity-only change can save without rebooting.

## What the firmware requires

| Requirement | Purpose |
|---|---|
| ESP32-S3 | The only compiled and tested chip target. |
| At least **8 MB flash** | Dual OTA slots plus a 4 MiB upper-flash history journal; 4 MB boards are unsupported. |
| Two usable GPIOs | X10A receive/transmit. |
| Native USB-Serial/JTAG, preferred | The shipped serial console and Web Serial installer. External USB-UART boards need console adaptation. |

PSRAM, Bluetooth and SD storage are unused. Display-equipped boards, including AtomS3 and
M5StickS3, are unsupported; the firmware contains no display driver or remote-display role.
W5500 Ethernet is optional. [WIRING.md](WIRING.md) owns X10A voltages and connector wiring.

<a id="m5stack-atoms3-lite--the-board-the-wiring-guide-is-written-for"></a>
## M5Stack AtomS3 Lite

| Hardware | Firmware use |
|---|---|
| ESP32-S3FN8, 8 MB flash, no PSRAM | Supported target; USB-C native USB console. |
| Grove GPIO1/2 | X10A **RX 1 / TX 2**; select these once, as they are not the shipped defaults. |
| Side header GPIO5/6/7/8/38 | Alternative X10A pair or optional sensor wiring. |
| GPIO35 WS2812C-2020 | Addressable RGB status indicator. |
| GPIO41 front button, active low | Optional 5-second privacy reset. |
| GPIO4 IR LED | Unused. |

The preset key is `m5stack_atoms3_lite`. Its indicator reports setup (blue), connecting (yellow),
healthy (green), X10A down (red double-flash) or MQTT down (orange). Reset arming strobes red;
erasure is solid white.

GPIO39 is physically exposed as “CLK_OUT3” but is dedicated JTAG and unavailable for X10A or ENV III.
GPIO41 is also a JTAG pad, allowed for the board's own button; using it conflicts with an external
JTAG probe. GPIO35 is allowed in the shipped DIO/no-PSRAM build, but Octal flash/PSRAM builds reserve
GPIO33–37 and refuse them.

<a id="seeed-xiao-esp32-s3--the-board-the-pin-defaults-are-written-for"></a>
## Seeed XIAO ESP32-S3

| Hardware | Firmware use |
|---|---|
| ESP32-S3R8, 8 MB flash, 8 MB PSRAM | Supported target; PSRAM unused. |
| USB-C, native USB-Serial/JTAG | Console and Web Serial installation. |
| GPIO44 / D7 and GPIO43 / D6 | X10A **RX 44 / TX 43**, the shipped defaults. |
| GPIO1/2/4/5/6/7/8/9 | Other exposed X10A-safe pads. |
| GPIO21, plain LED, active low | The shipped indicator default. |
| Recovery button | None configured; attach a real external button only if needed. |

The preset key is `seeed_xiao_esp32s3`. GPIO3 / D2 is a strapping pin and unavailable for X10A.
GPIO16/17 are absent from its header. **ENV III is unsupported on this preset**, including with a
hand-wired Ethernet module: the runtime accessory gate requires a supported M5Stack preset.

<a id="m5stack-env-iii-outdoor-temperature-humidity-and-pressure"></a>
## M5Stack ENV III — outdoor temperature, humidity and pressure

ENV III combines SHT30 temperature/humidity (`0x44`) and QMP6988 pressure (`0x70`) on one I²C pair.
ENV, ENV II and ENV IV are different products and are not claimed compatible. Select **M5Stack
AtomS3 Lite → Outdoor sensor → ENV III** in the Hardware dialog.

| Arrangement | ENV III SDA / SCL | X10A consequence |
|---|---|---|
| ENV III on Grove | GPIO2 / GPIO1 | Move X10A to two free header pins, e.g. RX5 / TX6. |
| X10A on Grove | Two free header pins, e.g. GPIO5 / GPIO6 | Use a Grove breakout for ENV III. |
| Header adapter | Two offered pins, e.g. GPIO7 / GPIO8 | Keep both clear of other configured functions. |

The physical I²C inventory is **1, 2, 5, 6, 7, 8, 38**, minus occupied pins. GPIO39 is excluded
because reliable sensor communication there was not established. The section is hidden for Seeed
and Custom, and the API/driver also reject enabling it there. An M5Stack vendor identity alone is
insufficient without explicit connector-pin metadata.

Save proves both components before persisting: a CRC-valid SHT30 sample and QMP6988 chip id `0x5c`.
It tries only the selected pair, then that pair with SDA/SCL exchanged; a successful exchange is
saved. Failed probing leaves every proposed hardware change unsaved. An unchanged active pair
requires a fresh runtime sample. **To move an active sensor: disable → restart → rewire → enable**.
Selecting **No sensor** needs no successful probe and remains the recovery path.

Grove colours are red **5 V**, black **GND**, yellow **SDA**, white **SCL**. M5Stack lists a
−40–120 °C measurement range; ±0.2 °C accuracy and the operating range apply to **0–60 °C**.
No IP weather rating is stated. Use a ventilated sheltered enclosure for outdoor placement, away
from rain, condensation and direct sun. Placement determines whether these are outdoor or indoor
readings; they never replace Daikin's sensor. See [PLANT.md](PLANT.md#optional-env-iii-climate-input)
for their lifecycle and [MQTT.md](MQTT.md#env-iii) for publication.

## Wired networking (M5Stack ATOMIC PoE Base, W5500)

| Hardware | Mapping |
|---|---|
| WIZnet W5500, polled SPI | **SCLK5 / CS6 / MISO7 / MOSI8**; no interrupt line. |
| Detection | One boot-time `VERSIONR` probe; no network setting required. |
| Power | PoE or the base's own supply powers the board. |

If detected and DHCP succeeds, Ethernet takes priority and the WiFi radio/setup portal stay off.
If absent, the probe releases SPI and normal WiFi setup proceeds. The Connections tile shows
Ethernet speed, no cable, or cable connected without an address; `/status.net` exposes the same
facts. WiFi correctly reports offline on a wired boot.

On AtomS3 Lite the base covers the entire side header. X10A must use Grove **RX1/TX2**, leaving
**no usable pair for ENV III**. A passive Grove hub cannot share the UART pair with an I²C sensor.
Detected SPI pins are removed from all selectors and rejected by configuration saves. A hand-wired
W5500 can also use the XIAO's exposed GPIO5–8, with X10A on 44/43; ENV III remains unsupported there.

After cable loss for about 30 seconds, a wired boot with saved WiFi credentials reboots once and
tries WiFi. Without credentials it waits for Ethernet instead. Compatible saved trends survive the
reset; they do not prove that measurements were collected during the gap.

## Other ESP32-S3 boards

Use **Custom** only after checking the board's schematic against the offered chip-safe pins.
Meeting the chip/flash requirements does not establish physical board compatibility. See
[WIRING.md](WIRING.md#picking-pins-on-a-different-board) for a DevKit example.

The shipped indicator default drives GPIO21 even before a custom board is described. Set the actual
LED pin/type/polarity or **None**. Leave the recovery button on **None** unless a real button is
wired; a floating input can trigger an unintended reset.

## Recovery button

Holding a configured button for five seconds erases serialized settings, legacy WiFi credentials,
history/trend/state-age data and the raw coredump. It reboots into setup only after every erase
succeeds; an incomplete wipe remains on the current boot and is reported. Release while arming to
abort. Preserve needed configuration and crash evidence before using it.

## Feature availability by board

| Feature | AtomS3 Lite | XIAO ESP32-S3 |
|---|---|---|
| X10A | Choose Grove 1/2 or free header pair | Default 44/43 or free offered pair |
| ENV III | Optional, without PoE base | Unsupported |
| Web Serial, signed dual-slot OTA | Yes | Yes |
| Indicator | WS2812 GPIO35 | Plain LED GPIO21, active low |
| Recovery button | GPIO41, active low | External only |
| W5500 Ethernet | ATOMIC PoE Base | Hand-wired module |
| Display / IR / PSRAM use | None | None |
