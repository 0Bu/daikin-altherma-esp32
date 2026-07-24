# daikin-altherma-esp32

ESP-IDF firmware: reads a **Daikin Altherma** over the **X10A** port (UART 9600 8E1, protocol I/S)
and publishes all values to MQTT. Runtime config + OTA via an
embedded web UI. ESP32-S3 only.

## Requirements

- A Daikin Altherma with an **X10A** header.
- An ESP32-S3 with ≥4 MB flash — the wiring below is written for an **M5Stack AtomS3 Lite**; any
  ESP32-S3 works ([docs/BOARDS.md](docs/BOARDS.md)).
- JST-EH 2.5 mm 5-pin or Dupont wires, plus a **Grove → Dupont** cable for the AtomS3 Lite's Grove
  port (or plain Dupont wires into the female header on its case).
- A browser with Web Serial to flash.

## Setup

1. Flash: [web installer](https://0bu.github.io/daikin-altherma-esp32/). An update without
   **Erase** preserves the existing configuration.
2. On a first install or after **Erase**, join AP `daikin-altherma-esp32-setup`
   (captive portal / `192.168.4.1`).
3. Configure at `http://daikin-altherma-esp32.local`:
   - Set the MQTT `host:port`.
   - Model and X10A protocol are **auto-detected**. So are the RX/TX pins on a XIAO ESP32-S3, whose
     pads are the shipped defaults; on any other board — the AtomS3 Lite included — pick them once
     (see *Wiring* below), after which they too are remembered and re-detected.
   - The UI follows your browser language (**German** for a `de*` browser, else English). Heat-pump
     value labels stay English — they are the X10A register names.

## Wiring — X10A (breaker OFF)

Written for the **M5Stack AtomS3 Lite**: its Grove HY2.0-4P port carries exactly the four wires X10A
needs, so one Grove → Dupont cable reaches the service port with nothing to solder.

| X10A | Signal | X10A wire | AtomS3 Lite | Grove wire | Note |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | +5 V | Red | `5V` | Red | Optional — out of spec, prefer USB power |
| 2 | HP-TX | Brown | RX `GPIO1` (G1) | Yellow | Heat pump sends → ESP32 receives |
| 3 | HP-RX | Green | TX `GPIO2` (G2) | White | ESP32 sends → heat pump receives |
| 4 | NC | — | — | — | Not connected |
| 5 | GND | Black | `GND` | Black | Mandatory |

**Pick the two pins once.** The firmware ships with the XIAO's defaults (`RX 44` / `TX 43`), which
the AtomS3 Lite does not break out — so the bus stays silent until you set them: dashboard →
**ESP32** card → RX/TX dropdown → `1` and `2`. They are cached in NVS from then on and re-used every
boot. G1 and G2 are interchangeable: detection probes the pair both ways round, so a crossed signal
wire corrects itself. A crossed 5 V/GND does not — check those two twice.

**No Grove cable?** The female header on the case carries `5V`, `GND` and `G5`–`G8`/`G38`. Wire GND
plus the two signals to any two of those (e.g. RX `G5`, TX `G6`) and pick that pair in the dropdown
instead.

Grove wire colours above are the standard cable's (black GND, red 5 V, yellow G1, white G2); if your
adapter is coloured differently, go by the port, not the colour.

Visual diagram, the full cable chain (X10A → JST-EH pigtail → Dupont joint → Grove), the same wiring
on a XIAO ESP32-S3, and picking pins on any other board: [docs/WIRING.md](docs/WIRING.md).

## Board hardware — status LED and recovery button

One firmware image serves every ESP32-S3 board, so the parts that differ *between* boards are
runtime settings, configured in the web UI under **⚙ Settings → ESP32 → Hardware**:

| Board | Status LED | Recovery button |
| :--- | :--- | :--- |
| M5Stack AtomS3 Lite | `GPIO35`, WS2812 (addressable RGB) | `GPIO41`, active low |
| Seeed XIAO ESP32-S3 | `GPIO21`, plain LED, active low | none broken out |

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
- Two update feeds: **Release** (cut by hand) and **Development** (every merge to `main`). Pick one
  per device under the gear → **ESP32** → *Update channel*; the [dev
  installer](https://0bu.github.io/daikin-altherma-esp32/dev/) flashes the latest merge.
- Read-only monitor: it polls X10A and never actuates the heat pump (X10A has no write command).
- HA templates / COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). PR previews: `…/PR/<n>/`.

## Scope & credits

Trusted LAN only; no API auth/TLS. MIT ([LICENSE](LICENSE)); protocol / value definitions derived
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT). No warranty; not affiliated with Daikin.
