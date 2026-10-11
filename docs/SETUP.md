# Setup

Follow these steps to obtain live X10A readings, then add MQTT or optional sources. The device reads
the heat pump and does not change its settings. Keep its web UI on a trusted LAN; it has no user
authentication or API TLS.

## 1. Choose and wire the hardware

Use an **ESP32-S3 with at least 8 MB flash**. [BOARDS.md](BOARDS.md) lists the supported presets and
accessory limits. The common signal pairs are:

| Board | ESP32 RX | ESP32 TX |
|---|---:|---:|
| Seeed XIAO ESP32-S3 | GPIO44 / D7 | GPIO43 / D6 |
| M5Stack AtomS3 Lite, Grove port | GPIO1 / G1 | GPIO2 / G2 |

Switch off the heat pump at the breaker before connecting its service port. Follow
[WIRING.md](WIRING.md) for connector orientation, signal direction and voltage protection. Use USB
power; X10A's 5 V / 50 mA supply is insufficient for the ESP32. Common ground is required even with
USB power. Record the two GPIOs you wired so you can select them later.

## 2. Install the firmware

Connect the board by USB using a data-capable cable. Open the
[web installer](https://0bu.github.io/daikin-altherma-esp32/) in a browser that supports Web Serial,
select the board's serial port and install the release firmware.

Leave **Erase** unchecked when updating a configured board: the installer writes around NVS and
preserves its settings. **Erase** is a factory reset and removes them. The manual merged image also
overwrites NVS; it is not a settings-preserving update.

Published application images are signed. A source build requires signing and
`scripts/require-signed.sh` before flashing; an unsigned application cannot boot. The complete
source-build and manual-flash procedure is in [MAINTENANCE.md](MAINTENANCE.md).

If the browser still holds the port after the installer closes, select **Release serial port** on
the installer page. It releases this site's permission when no flash is active.

## 3. Join the network

On a WiFi boot with no usable credentials:

1. Join the open network **`daikin-altherma-esp32-setup`**.
2. Open **`http://192.168.4.1`** if the setup page does not open automatically.
3. Type your home WiFi network name exactly, including case and any spaces. The portal does not
   scan for networks. Enter its password and select **Save & reboot**.
4. Wait for the save to succeed, then rejoin your home network.
5. Open **`http://daikin-altherma-esp32.local`**. If mDNS does not resolve, use the address shown in
   your router's DHCP client list.

The SSID must be 1–32 bytes; a password is empty for an open network or 8–63 bytes.
Non-ASCII characters can use multiple bytes; the server may reject input that passes the form's
length check.
A rejected save stays on the portal and shows the error. When changing an already working WiFi
configuration, the firmware retains the previous credentials for automatic rollback if connection
to the new network fails.

An optional detected W5500 Ethernet controller takes priority at boot. If it obtains an address,
WiFi and the setup portal remain off: find the board in DHCP and open its web UI there. See
[wired networking](BOARDS.md#wired-networking-m5stack-atomic-poe-base-w5500) for pins and fallback.

## 4. Set the board and X10A pins

Open the header gear (**Settings**).

1. Under **ESP32 → Hardware**, select the physical board and save. This sets its indicator/button
   defaults and limits pin selectors to its exposed pads. Peripheral changes reboot the board.
   For another board use **Custom** and its actual schematic; select **None** for absent hardware.
2. Under **Protocol**, select the **RX/TX** GPIOs you wired. The XIAO pair is the firmware default;
   AtomS3 Lite Grove wiring requires GPIO1/2 to be selected once. The working pair is saved.

Detection tries the saved pair, the firmware-default pair and each pair exchanged. It does not scan
all GPIOs. Once a link answers, the working pins display read-only. The protocol and model are
detected automatically; there is no manual model picker. Model identity is established again on
every boot.

## 5. Check the first readings

Confirm that **Settings → Protocol** shows an online X10A link and the expected pins. On the
dashboard, compare the Model card's **family and outdoor-unit identifier** with the unit labels.
Only fields shared by the detection candidates are established. The selected register table
(`profile.id`) can serve indistinguishable models and does not prove an exact physical model.

Compare readable water temperatures and operating state with the heat pump's own display. An idle
outdoor unit can hold its previous readings; those are marked rather than presented as fresh
measurements. A dash means a reading is unavailable, unsupported or not current—it is not zero.

If the link stays offline, check the selected pair, connector numbering, common ground and cable
continuity. Disconnect power before changing wiring. A timeout or CRC error is evidence of a link
problem, not proof of one particular defective component. If the model or values remain wrong,
collect a [bug report](REPORTING.md).

## 6. Add only the sources you need

- **Home Assistant:** configure **Settings → Connections → MQTT**, then follow
  [HOME_ASSISTANT.md](HOME_ASSISTANT.md). Give each installation a distinct base topic.
- **HomeHub:** configure its separate Modbus source under **Settings → Connections → HomeHub**.
  A fresh device searches once; the dialog's **Search** fills the address, and **Save** applies it.
  Saving an empty address disables further polling/search. See [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md).
- **ENV III:** on a supported M5Stack preset, use **ESP32 → Hardware → Outdoor sensor**.
  [BOARDS.md](BOARDS.md#m5stack-env-iii-outdoor-temperature-humidity-and-pressure) explains pin conflicts.
- **Plant diagnostics:** enable it under **Settings → Firmware**. It is off by default. Then
  configure the optional room, circulation and forecast inputs described in [PLANT.md](PLANT.md).

To update later, tap the firmware version in the header or **Settings → Firmware**. Read the offered
version, channel and changelog before confirming. An unreachable or invalid feed is a check error,
not an “up to date” result. Release and development feeds are selected under **Update channel**.
