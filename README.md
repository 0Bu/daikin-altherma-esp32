# daikin-altherma-esp32

Turns an ESP32 (esp32 / esp32s3 / esp32c3 / esp32c6) into a **monitoring bridge for Daikin
Altherma** heat pumps — and the ROTEX / HOVAL Belaria units built on the same platform. It
connects to the heat pump's **X10A service port**, decodes the internal register protocol,
and streams every value straight into
[Home Assistant over MQTT](#step-6--home-assistant) with auto-discovery. No cloud, no Daikin
LAN adapter, no fees.

Everything is configured **in the browser** — WiFi, MQTT, the Home Assistant bridge, *which
Daikin unit you own* (indoor, outdoor, domestic-hot-water tank), which values to read, and
even the **RX/TX GPIO pins** you wired to X10A. There is no source file to edit and no
recompile: flash once from the web installer, then set everything from a phone.

Full protocol, API and value model: [docs/README.md](docs/README.md).

---

## Requirements

- **A Daikin Altherma** (or ROTEX / HOVAL Belaria) heat pump with an **X10A** service connector
  on the main PCB. *(Older ~2010-and-earlier units speak the "S" protocol — also supported.)*
- **An ESP32 board** — esp32, esp32s3, esp32c3 or esp32c6. The reference board is the
  **Seeed Studio XIAO ESP32-S3** (small, USB-C, cheap); the installer auto-detects the chip.
- A **browser with Web Serial** (Chrome / Edge, desktop) for the one-time install.
- A **5-pin JST-EH 2.5 mm** connector or 4 Dupont wires to reach X10A.

*Wiring, voltage levels and safety are covered in [Step 5](#step-5--connect-to-the-heat-pump).*

---

## Step 1 — Install the firmware

- Open the web installer: **https://0bu.github.io/daikin-altherma-esp32/**
- Click **Install** and pick the serial port. The installer does a full flash and reboots the
  board into its setup portal.

The installer flashes firmware only — it never carries your WiFi password or heat-pump model;
those are set on the device in the next steps.

---

## Step 2 — Connect to WiFi (captive portal)

1. On your phone/laptop, join the device's WiFi network **`daikin-altherma-esp32-setup`**.
2. The setup page opens automatically (captive portal). If not, browse to `http://192.168.4.1`.
3. Pick your WiFi network from the scan list, enter the password, save. The device reboots and
   joins your network. The setup network reappears any time no WiFi is configured, so you can
   always get back in.

---

## Step 3 — Open the web UI

`http://daikin-altherma-esp32.local` (or the device IP from your router).

The dashboard shows connection health (WiFi, MQTT), the live decoded values once the heat pump
is wired, and the **Setup** panel where everything below is configured.

---

## Step 4 — Configure your Daikin unit and pins

This is the part that replaces hand-editing a config header + a `def/*.h` model file —
here it is all in the **Setup → Heat pump** panel:

1. **Select your model.** Choose your **indoor unit**, **outdoor unit** and **DHW tank** from
   the lists (e.g. indoor `ETBH12E`, outdoor `ERGA04-08E`, tank `EKHWSP`). This picks the right
   built-in **value definition** (register map + labels). Not sure? Pick the closest match or
   *Generic* — worst case a few values read blank.
2. **Choose the protocol.** Leave on **`I`** (modern units). Switch to **`S`** only for older
   (~2010 and earlier) Altherma/ROTEX units.
3. **Pick the label language** — English, German, French, Spanish, Italian, Japanese.
4. **Set the RX/TX pins** you wired to X10A. Defaults match the reference board
   (**XIAO ESP32-S3: RX = GPIO44 / TX = GPIO43**), but any two free GPIOs work — the UI has a
   per-board hint. `GPIO16/17` (the classic ESP32 default) do **not** exist on the XIAO.
5. **Select which values to query** and the **poll interval** (default 30 s). Fewer values =
   smaller MQTT messages and faster cycles.

Save — the device applies it live (no reflash). All of this is stored in NVS and survives
reboots and OTA updates.

---

## Step 5 — Connect to the heat pump

> ⚠️ **Turn the heat pump OFF at the circuit breaker before wiring anything.**

1. Open the indoor unit and locate the **X10A** connector on the main PCB. *(If a bi-zone
   module occupies X10A, use the identical **X12A** on that module.)*
2. Wire the ESP32 to X10A — pin numbers per the schematic in [docs/README.md](docs/README.md):

   | X10A | Signal | → ESP32 (XIAO ESP32-S3) |
   |------|--------|--------------------------|
   | 1 | +5 V | `5V` *(can power the ESP; optional if USB-powered)* |
   | 2 | HP-TX | **RX pin** — default `GPIO44` (pad **D7**) |
   | 3 | HP-RX | **TX pin** — default `GPIO43` (pad **D6**) |
   | 5 | GND | `GND` — **always connect, even when USB-powered** |

3. Double-check the orientation and the GND wire, close up, switch the breaker back on.

Within one poll interval the decoded values appear in the web UI and — if MQTT is set — in Home
Assistant. *A dead X10A cable is the single most common fault; if you see CRC/timeout errors in
the log, re-seat or replace the cable and confirm GND first.*

The X10A serial line is 5 V TTL and the ESP32 is 3.3 V. In practice a direct connection works, but a level shifter on the HP-TX → ESP-RX line is the safe
option. See [docs/README.md → Voltage](docs/README.md#voltage-and-wiring).

---

## Step 6 — Home Assistant

The device can publish **everything it reads** — every temperature, flow, pressure, current,
operating mode and its own WiFi/MQTT health — straight into Home Assistant over MQTT. It is
**read-only by design**: Home Assistant only *sees* the values.

1. In the web UI open **Setup → MQTT** and enter your broker as `IP:PORT`
   (e.g. `203.0.113.27:1883`), plus username/password if your broker needs them. Save.
2. With the [Home Assistant MQTT integration](https://www.home-assistant.io/integrations/mqtt/)
   enabled, a **Daikin Altherma** device appears automatically with all sensors — no YAML
   (Home Assistant [MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery)).
   Clear the broker field to turn MQTT off again.

A COP (coefficient of performance) template and other derived sensors are documented in
[docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md).

---

## Notes

- Keep the device on permanent power near the indoor unit (USB charger, or the X10A 5 V pin).
- **Updates are over-the-air:** open `http://daikin-altherma-esp32.local`, tap the firmware version,
  confirm — the device updates itself and reboots. WiFi, MQTT and your model/pin config are
  preserved. The web installer is only needed for the first install or to recover a device.
- **Optional heat-pump control.** The firmware can optionally drive a relay wired as an
  *external on/off thermostat* and expose the SG-Ready smart-grid contacts — both configured in
  the UI and off by default. It **cannot** change the heat pump's internal settings (the X10A
  protocol is read-oriented). See [docs/README.md → Control](docs/README.md#optional-control).
- **Try a PR before merge:** every same-repo pull request publishes a signed preview build you
  can browser-flash from `https://0bu.github.io/daikin-altherma-esp32/PR/<PR-number>/`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Installer shows no serial port | Chrome/Edge desktop, use a **data** USB cable; on a classic ESP32 hold **BOOT** while plugging in. |
| `daikin-altherma-esp32.local` won't load | Use the device IP from your router. |
| Need to change WiFi | The `daikin-altherma-esp32-setup` network reappears whenever no WiFi is configured — rejoin it. |
| Log shows `Timeout` / `Wrong CRC` | X10A cable or GND fault (most common). Re-seat/replace the cable; confirm GND; check RX/TX pins in Setup. |
| Log shows `0x15 0xEA` from the HP | The unit speaks the older **S** protocol — switch protocol to `S` in Setup. |
| A value always reads 0 / blank | That register isn't implemented on your unit, or the wrong model profile is selected — pick the closest, or deselect the value. |

---

## Scope & credits

- **Local network only** — keep it on a trusted LAN, never expose it to the internet
  ([security](docs/SECURITY.md)).
- Heat-pump protocol, value definitions and conversions are derived from
  **[ESPAltherma](https://github.com/raomin/ESPAltherma)** by raomin (MIT) — the reverse
  engineering and register maps are theirs. This project re-homes that work on ESP-IDF with a
  browser installer, a full web-UI configuration flow, OTA and CI.
- Licensed under the **MIT License** ([LICENSE](LICENSE)), matching ESPAltherma.
- Use entirely at your own risk. Interacting with your heat pump's service port is as safe as
  serial monitoring gets, but there is no warranty. Daikin, Altherma, ROTEX and HOVAL are
  trademarks of their owners; this project is not affiliated with or endorsed by them.
