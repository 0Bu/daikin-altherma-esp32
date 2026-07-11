# UI design specification

Design contract for the embedded web UI (`main/www/`) and the captive portal (`main/www/setup.html`).
Implementation-ready: colours, tokens, information architecture, per-view specs, states, and the
firmware fields the UI keys off. No framework — one self-contained gzipped page + the standalone
setup page (see `main/CMakeLists.txt`).

## 1. Principles

1. **One screen.** After provisioning, the app is a single dashboard — there is **no Settings page
   and no sub-screens**. Everything the device exposes lives on that one page; the little config
   there (MQTT via a modal, RX/TX pins inline) happens in place.
2. **Provision, then run.** WiFi credentials are entered once on the captive portal (`setup.html`);
   the device reboots into your network and the app opens on the dashboard. The heat pump is fully
   automatic (auto-detected), so there is nothing to configure for it.
3. **Read-only truth.** The dashboard reflects the device; it never blocks on writes. The few writes
   (MQTT broker, RX/TX pins) are explicit and report their outcome.
4. **Terse, dense, technical.** Tabular numbers, short labels, no decorative copy.
5. **English only.** Labels are fixed English — there is no language selector (UI or firmware).

## 2. Brand & colour tokens

Palette taken from the Daikin logo: the cyan wordmark, the light-cyan and deep-navy triangle.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--brand`        | `#0097E0` | `#33ABE8` | Primary brand (Daikin cyan): buttons, active step, links, focus, header rule |
| `--brand-strong` | `#0079BD` | `#0097E0` | Hover/pressed, primary text-on-light |
| `--brand-sky`    | `#5AC8F0` | `#5AC8F0` | Light-cyan highlight: progress fill, chart/line, subtle gradient |
| `--brand-navy`   | `#14285A` | `#0E1C43` | Deep navy: top bar / hero background, high-emphasis surfaces, footer |
| `--brand-tint`   | `#E9F6FD` | `#12202b` | Faint cyan fill: selected rows, info blocks, step background |
| `--bg`           | `#F4F5F7` | `#12151A` | Page background |
| `--card`         | `#FFFFFF` | `#1B1F27` | Card / surface |
| `--fg`           | `#1C2530` | `#E6E9EE` | Body text |
| `--muted`        | `#6B7480` | `#93A0AF` | Secondary text, labels, units |
| `--line`         | `#E2E5EA` | `#2A2F39` | Borders, dividers |
| `--ok`           | `#1A9D5A` | `#3FBE7A` | Healthy / connected / running |
| `--warn`         | `#C9740A` | `#E08A2B` | Attention (reconnecting, CRC/timeout, weak signal) |
| `--err`          | `#D23B3B` | `#EA5A5A` | Fault / disconnected / invalid |

Rules:
- **Brand = navigation & identity** (header rule, title, active step, primary button, focus ring,
  links). **Semantic = state** (ok/warn/err) for values and connection status — never recoloured
  to brand, so status is unambiguous.
- Navy is for the setup hero band and the dashboard status hero background; cyan text/icons ride on
  navy. Body remains on neutral `--bg`.
- Focus ring: `0 0 0 3px rgba(0,151,224,.25)` on every interactive element (keyboard-visible).
- Contrast: white on `--brand`/`--brand-strong` for bold button text; body text stays on neutral
  surfaces. `--muted` meets AA on `--card`.

Theme follows `prefers-color-scheme`; both light and dark are first-class (tokens above).

## 3. Layout tokens

- Font: system UI stack, 15px/1.5 base; numbers `font-variant-numeric: tabular-nums`.
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32. Card padding 16–18. Grid gap 16.
- Radius: 8 (controls), 12 (cards), 20 (pills/toast). Elevation: 1px border + soft shadow on hero.
- Container: `max-width 720px`, centred. Mobile-first (setup is done from a phone).
- Header: sticky, 2px `--brand` bottom rule, title in `--brand`.

## 4. Information architecture (the state machine)

The SPA subscribes to the `/events` WebSocket (sends `"sub"`, then receives pushed `status`/`values`
frames) — this is the **only** live transport, there is no HTTP polling. A browser without WebSocket
loads a one-time `GET /status`/`GET /values` snapshot and the user reloads the page to refresh. Once
the device is on the network the app opens on the
**dashboard** and never leaves it — there are **no sub-screens and no Settings page**. The only
in-place config is the MQTT broker (a **modal** off the dashboard's MQTT card) and the RX/TX pins
(inline on the ESP32 card). The heat pump is otherwise **fully automatic** (auto-detected).

```
                    ┌─────────────── served from SoftAP (192.168.4.1) ───────────────┐
                    │  VIEW: Provision (setup.html)  —  WiFi credentials only         │
                    └───────────────────────────┬────────────────────────────────────┘
                                                 │ device reboots into STA
   GET /status on the device (STA) →  view:
        wifi.ip == none ............... (shouldn't happen on STA; show "reconnecting")
        otherwise ..................... VIEW: Dashboard (the only screen)
```

- There is **no in-app first-run wizard** and **no Settings page**: WiFi is provisioned once from the
  captive `setup.html` (§5.0), the MQTT broker is edited from the dashboard card's pencil (§5.1), the
  heat pump needs no setup (auto-detected; RX/TX pins on the dashboard ESP32 card, §5.3), and firmware
  updates are checked by tapping the version on that card (§5.4).
- MQTT is optional — an empty broker disables it.

`GET /status` exposes the fields the dashboard keys off:
`version`, `platform`, `uptime_s`, `pins_avail[]` (per-target usable X10A GPIOs for the RX/TX picker),
`wifi{ssid,ip,rssi,connected}`, `mqtt{configured,connected,tls,broker}`,
`hp{proto,rx,tx,connected,last_ok_s,…}`, `profile{id}`,
`detect{proto,valid,capacity_kw,ou_eeprom,candidates[],families[],ambiguous,model{name,family,
marketing}}` (drives the dashboard ESP32 board card + the read-only model card).

## 5. View specs

### 5.0 Provision (captive portal, `setup.html`)
Standalone, navy hero + one card. Only WiFi. Network dropdown from `GET /scan` (ssid · dBm),
password, **Save & reboot** → `POST /set_wifi`. Message line for scan/save state. No other controls.
On reboot the device joins STA and the main UI takes over. (This is the pre-WiFi world; the SoftAP
serves only this page.)

### 5.1 MQTT edit  (modal, from the dashboard MQTT card)
The dashboard's **MQTT** status card (§5.3) carries a **pencil** in its header; tapping it opens a
centred **modal** over a dimmed dashboard (the only overlay in the app). One form:
- **MQTT**: broker (`host:port`, or `mqtts://host:8883` for TLS), username, password, TLS note
  ("credentials require an mqtts:// URL"). **Save** → `POST /set_mqtt` (reboots to apply, then closes
  back to the dashboard); **Cancel** (and the backdrop / `Esc`) dismiss without writing. An empty
  broker disables MQTT.
Only the broker prefills (username/password aren't exposed by `/status`). Validation inline
(bare `host:port`, or a `mqtt(s)://` / `ws(s)://` URL). Actions row at the bottom: Cancel
(secondary) + Save (brand).

### 5.2 Heat pump — no settings screen (fully automatic)
The heat pump has **no configuration screen**. The model is **auto-detected** from the X10A bus
(`/status.detect`) — there is no manual model picker, no protocol control, no value checklist, and
no poll-interval control (poll is fixed at 1 s). Everything the user might want to see or touch lives
on the **dashboard**:
- **Model** name (the brand while offline) and detected capacity (shown only while the link is live)
  → the dashboard **Model** card (§5.3). There is no "auto-vs-manual detection" indicator.
- **X10A link** (Online/Offline), **protocol** (X10A-I/S) and the **RX/TX pins** → the dashboard
  **ESP32** card (§5.3). The RX/TX pins are the physical X10A link, so they are **persisted** (a
  manual pick survives reboot) and the detection sweep tries the cached pair first (defaults as
  fallback, so a stale cache self-heals). RX/TX are **auto-detected**: while the bus answers they show
  **read-only** (just the number). When it doesn't, each becomes a **dropdown** of the board's usable
  GPIOs (`/status.pins_avail`, per-target `logic/board_pins.hpp` — power pads and not-broken-out pins
  never appear); picking a pin posts `{profile:"auto", rx, tx}`, which re-runs detection on the chosen
  pair (+ its swap) next cycle. The current pin is always in its own list even if off-catalogue.

### 5.3 Dashboard — the only screen  (default after setup)
Header (an **outdoor-unit icon** — a fan + louvered condenser, the brand mark across the app — then
the **product name**). There is **no settings gear** — the app has no other screen.

- **Product name** (headline line): the fixed title **"Daikin Altherma ESP32"** — a stable app
  identity, not the detected model and no firmware version. The detected/selected heat-pump model
  is shown instead in the **Model** status card (§5.3 body).

Body, ordered:

1. **Status hero** (navy band): operation mode (Heating / Cooling / DHW / Standby / Off) as the
   headline, with fault state. Colour: `--ok` running, `--warn`/`--err` on fault; grey when no data.
   Fault text and the last-poll age surface in the hero sub-line.
2. **Status cards** — four cards styled exactly like the value groups (§6), first in the same grid:
   - **ESP32** — the board itself: chip (`platform`), **firmware version** (a tappable row that checks
     for an OTA update, §5.4), uptime (`uptime_s`), the heat-pump link (Online/Offline) and X10A
     protocol, and the **RX/TX pins** — read-only when detected, else a usable-GPIO dropdown (§5.2).
     From `platform`, `version`, `uptime_s`, `pins_avail`, `hp{proto,rx,tx,connected,last_ok_s}`.
   - **WiFi** — signal bars + RSSI (`--ok`/`--warn` by strength), network (SSID), IP address; from
     `wifi{ssid,ip,rssi,connected}`. Display-only; WiFi is not re-provisionable from the app (§5.0).
   - **MQTT** — connection status, broker, TLS on/off, and Home-Assistant discovery state; from
     `mqtt{configured,connected,tls,broker}`. A **pencil** in the card header opens the MQTT edit
     modal (§5.1) — the only status card edited via a modal.
   - **ESP32** — the board's X10A bus: chip, firmware, uptime, **Heat-pump link** (Online/Offline,
     honest), **Protocol** (shown only while live), and the **RX/TX pins** (read-only when the bus
     answers, else a `pins_avail` dropdown). From `hp{proto,rx,tx,connected}` + `pins_avail[]`.
   - **Model** — the model name (full-width heading) + detected capacity, from `detect{capacity_kw,
     model}`. Both are bus-derived, so they show **only while the link is live** (`hp.connected`):
     offline the name degrades to the brand "Daikin Altherma" and the capacity is hidden — never a
     cached fingerprint read as live. There is **no** "Detection: auto/manual" row (fully automatic).
3. **Value groups** (§6) as cards, each a label→value·unit table, tabular numbers; every value of the
   detected profile is shown. A value that timed out this cycle shows "—" (not 0).

There is **no** health/badge strip: the board + connectivity/identity live in the ESP32/WiFi/MQTT/
Model status cards, operation/fault in the hero, and everything flows as one continuous card grid.
The only setup control on this screen is the ESP32 card's RX/TX pins (§5.2); otherwise it is
operation-only.

### 5.4 Firmware / OTA  (tap the version on the ESP32 card)
There is **no Settings page**. Firmware updates are triggered from the dashboard: the **Firmware**
row on the ESP32 card (§5.3) is a button (chevron affordance) that checks for an OTA update.

- **TODO** — the check is a placeholder toast today (no published GitHub release feed yet; the
  firmware `ota_update.cpp` check is also a stub). Once a release source exists it wires to
  `/ota/check` → `/ota/status` → `/ota/update`.
- The **device log** is no longer surfaced in the UI (there was a Diagnostics screen; it was removed
  with the Settings page). It remains available out-of-band at `GET /diag` (verbose/clear via query).
- There is **no language selector** — the firmware is English-only (§1).

## 6. Dashboard value grouping & order

Values are grouped by domain and ordered from "what is it doing" → detail. Grouping is derived from
the value's register/label (the generator can also stamp a `group` tag per row). Order of groups:

1. **Operation** — operation mode, thermostat/space-heating/DHW on-off, fault code, defrost.
2. **Water circuit** — leaving water temp (after PHE / after BUH), return water temp, flow (l/min),
   water pressure, heating-flow setpoint, target ΔT, pump speed, 3-way valve.
3. **Domestic hot water** — tank temp (R5T), DHW setpoint, DHW mode, extra DHW sensor.
4. **Refrigerant / outdoor** — outdoor air temp, O/U heat-exchanger temp, high/low pressure (°C),
   refrigerant liquid temp, compressor speed, fan step.
5. **Electrical** — INV primary current, INV compressor current, CT L1/L2/L3, backup-heater
   capacity + stages.
6. **Device** — WiFi/MQTT/HP link, poll counters, uptime, firmware (WiFi/MQTT in their status cards;
   HP link/protocol, uptime and firmware on the ESP32 card §5.3; model name also in the header).

Within a group: setpoints next to their measured value; temperatures before pressures before
currents. Units and `device_class` come from the value `dataType` (1=°C, 2=bar, 3=A). Groups with no
enabled/available values are hidden.

## 7. Components

- **Button** — primary: `--brand` bg / white / bold; secondary: bordered, `--fg`; quiet: link-style
  `--brand`. One primary per view.
- **Input / select** — `--line` border, `--brand` focus ring; inline error text `--err` under field.
- **Value table** — two columns (label `--muted` left, value+unit right, tabular). Missing = "—".
- **Card** — `--card`, 1px `--line`, radius 12; section title small-caps `--muted`.
- **Toast** — bottom-centre, transient, for Save outcomes ("Saved", "Rebooting…", "Failed").
- **Hero** — navy band, brand/white text, one headline + one sub-line.

## 8. States & feedback

Every async action shows: idle → in-flight ("Saving…", spinner on button) → result (toast + view
transition). Specific:
- **Reboot writes** (MQTT): after Save show "Rebooting — reconnecting…", poll `/status` until it
  answers, then close the modal back to the dashboard. (WiFi is provisioned once from `setup.html`,
  not re-written here.)
- **Live writes** (heat pump): "Applied", stay on view; the `/events` WebSocket pushes the new
  values on the next poll cycle (a pin-pick also refreshes `/status` a few times to catch the connect).
- **Connection loss**: hero greys to "No data"; the WiFi card shows "Offline" if WiFi dropped, and
  the **Heat-pump card collapses to a bare "Offline"** if the X10A link is down — model, protocol and
  capacity vanish rather than showing stale cached values. The `/events` WebSocket reconnects every
  5 s (hero shows "Unreachable — retrying…"), no hard error page.
- **Empty**: pre-first-poll dashboard shows "Waiting for first poll…"; unknown model shows the
  *Generic* hint.
- **Errors**: 4xx from a write → inline field error + toast; 503 (device OOM) → "Device busy, retry".

## 9. Responsive & accessibility

- Mobile-first single column; ≥560px the cards flow into two columns packed top-down (masonry via
  CSS multicol, not a row-aligned grid) so uneven card heights don't leave big gaps beside short cards.
- Wide content (long value tables) never causes horizontal page scroll; the table scrolls in its card.
- Keyboard: logical tab order, visible focus ring, Enter submits the view's primary action.
- Contrast AA for text; status never conveyed by colour alone (pills carry text: "Connected",
  "CRC 3", "off").
- Respect `prefers-reduced-motion` (no non-essential transitions).

## 10. Firmware support required

The design needs these additions to the firmware (all small, tracked as follow-ups):
- `GET /status`: `wifi.rssi`/`wifi.ip`/`wifi.connected` (live, from `wifi_info()`) — **done**; the
  dashboard WiFi card (§5.3) consumes them. See `main/http_status.cpp`.
- `POST /set_hp`: **every field is optional** — an omitted key keeps its current value, so the
  dashboard ESP32 card posts just `{profile:"auto",rx,tx}` on a pin change. `poll_s` is **not**
  accepted (fixed at 1 s); `proto` is auto-detected and not accepted; there is no value mask.
- `GET /status`: `uptime_s` (seconds since boot) feeds the dashboard ESP32 card's Uptime row.
- Optional `group` field on `ValueDef` (or generator-stamped) to drive §6 grouping; until then the
  UI groups by register-id ranges + label keywords.
- `/models`: returns model lists, `profile_map`, `pin_hint`, per-profile value menu — still served
  and used server-side for candidate-id → display name, though the UI no longer fetches it.
- `POST /detect`: re-run auto-detection (resets `profile` to `"auto"` + invalidates the fingerprint).
  Still served for API/MCP use; the UI no longer exposes a re-detect button.

## 11. Build / delivery

Unchanged pipeline: `www/index.html` (markup + `//@@INLINE` markers) + `www/style.css` + `www/app.js`
spliced by `inline_assets.cmake` into one gzipped page embedded in the firmware; `setup.html` gzipped
separately for the captive portal. The SPA is view-switched client-side from `/status`; no routing,
no external assets (CSP-clean, offline-capable on the device).
