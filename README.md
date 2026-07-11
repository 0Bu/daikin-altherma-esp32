# daikin-altherma-esp32

ESP-IDF firmware turning an ESP32 (esp32 / esp32s3 / esp32c3 / esp32c6) into a **Daikin Altherma**
monitor: reads the **X10A** service port (9600 8E1, protocol I/S) and bridges every
value to Home Assistant over MQTT (auto-discovery). Browser-flashed, OTA-updated, configured
entirely from a web UI — no cloud, no LAN adapter, no recompile.

Reference: protocol / API / value model / build → **[docs/README.md](docs/README.md)** ·
architecture → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · security → [docs/SECURITY.md](docs/SECURITY.md).

## Requirements

- A Daikin Altherma with an **X10A** (or bi-zone **X12A**) header.
- An ESP32, ≥4 MB flash — reference board **Seeed XIAO ESP32-S3**. Installer auto-detects the chip.
- Desktop Chrome/Edge (Web Serial) for the one-time flash; 5-pin JST-EH 2.5 mm or 4 Dupont wires.

## Setup

1. **Flash** — [web installer](https://0bu.github.io/daikin-altherma-esp32/) → Install.
2. **WiFi** — join AP `daikin-altherma-esp32-setup` (captive portal, else `http://192.168.4.1`).
3. **Configure** — `http://daikin-altherma-esp32.local` → **Setup**: model (indoor/outdoor/tank →
   value profile), protocol `I`/`S`, label language, **RX/TX pins**, poll interval, value selection,
   MQTT `host:port`. Applied live; NVS-backed, survives OTA.

## Wiring (X10A — breaker OFF)

| X10A | Signal | ESP32 (XIAO S3 default) |
|------|--------|-------------------------|
| 1 | +5 V  | `5V` (optional; USB works too) |
| 2 | HP-TX | RX — `GPIO44` (D7) |
| 3 | HP-RX | TX — `GPIO43` (D6) |
| 5 | GND   | `GND` (**mandatory**) |

5 V TTL line; a level shifter on HP-TX→ESP-RX is the safe option (direct usually works). `GPIO16/17`
are not broken out on the XIAO — pins are configurable. `Timeout`/`Wrong CRC` ⇒ cable or GND fault;
`0x15 0xEA` ⇒ switch to protocol `S`.

## Notes

- **OTA:** tap the version in the web UI; config preserved. Web installer only for first flash / recovery.
- **Read-only** by design. Optional relays (external on/off thermostat, SG-Ready) are off unless wired
  and enabled; the firmware cannot change the pump's internal settings.
- **HA:** MQTT Discovery auto-creates a *Daikin Altherma* device. Templates/COP: [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md).
- **PR previews:** signed, browser-flashable builds at `…/PR/<n>/`.

## Scope & credits

- Local-network only; no API auth/TLS — never expose to the internet ([security](docs/SECURITY.md)).
- Heat-pump protocol, value definitions and conversions are derived from
  **[ESPAltherma](https://github.com/raomin/ESPAltherma)** (MIT). Licensed **MIT** ([LICENSE](LICENSE)).
- Use at your own risk; no warranty. Daikin and Altherma are trademarks of their owners; not
  affiliated.
