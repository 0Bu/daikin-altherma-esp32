# UI design specification

Design contract for the embedded web UI (`main/www/`) and the captive portal (`main/www/setup.html`).
Implementation-ready: colours, tokens, information architecture, per-view specs, states, and the
firmware fields the UI keys off. No framework — one self-contained gzipped page + the standalone
setup page (see `main/CMakeLists.txt`).

## 1. Principles

1. **One view at a time.** First-run setup and heat-pump operation are separate screens. The user
   sees only what is relevant to the current device state; nothing else is rendered.
2. **Ordered first-run.** Connectivity before configuration before operation:
   `WiFi → MQTT → heat pump / ESP32 → operating values`. Each step unlocks the next.
3. **Setup is a mode, not a panel.** After first-run, the dashboard is the default; setup steps are
   reachable from a settings entry, each still on its own screen.
4. **Read-only truth.** The dashboard reflects the device; it never blocks on writes. Config writes
   are explicit (Save) and report their outcome.
5. **Terse, dense, technical.** Tabular numbers, short labels, no decorative copy.

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

The SPA fetches `GET /status` on load + poll and selects exactly one **view** from the device
state. First-run walks the wizard; afterwards the dashboard is default and steps live under Settings.

```
                    ┌─────────────── served from SoftAP (192.168.4.1) ───────────────┐
                    │  VIEW: Provision (setup.html)  —  WiFi credentials only         │
                    └───────────────────────────┬────────────────────────────────────┘
                                                 │ device reboots into STA
   GET /status on the device (STA) →  stage:
        wifi.ip == none ............................ (shouldn't happen on STA; show "reconnecting")
        !setup_complete && mqtt.stage == unset ..... VIEW: Setup · WiFi status + MQTT   (step 1/2)
        !setup_complete && hp.configured == false .. VIEW: Setup · Heat pump / ESP32     (step 2/2)
        setup_complete == true ..................... VIEW: Dashboard (operating values)
```

- **`setup_complete`** is a new NVS flag (`daik_cfg/setup_done`), set true when the heat-pump step is
  saved the first time. Until then the wizard is forced; after, the dashboard leads and the wizard
  is reachable via Settings (never auto-shown).
- **`hp.configured`** = a profile is chosen AND ≥1 value is enabled (`val_mask` non-empty).
- MQTT is **skippable** (empty broker = disabled) — the step offers *Skip*; skipping still advances.
- A persistent **wizard stepper** (WiFi ✓ → MQTT ✓ → Heat pump •) sits atop setup views so the user
  knows where they are and what remains. It is absent on the dashboard.

`GET /status` must expose the fields the switch needs (extend the current shape):
`wifi{ssid,ip,rssi}`, `mqtt{configured,connected,tls,skipped}`, `hp{configured,proto,rx,tx,poll_s,
connected,…}`, `profile{id,in,out,tank,lang}`, `setup_complete`.

## 5. View specs

### 5.0 Provision (captive portal, `setup.html`)
Standalone, navy hero + one card. Only WiFi. Network dropdown from `GET /scan` (ssid · dBm),
password, **Save & reboot** → `POST /set_wifi`. Message line for scan/save state. No other controls.
On reboot the device joins STA and the main UI takes over. (This is the pre-WiFi world; the SoftAP
serves only this page.)

### 5.1 Setup · Step 1 — WiFi & MQTT  (on the device, first-run)
Header: title + stepper `① WiFi · ② MQTT · ③ Heat pump`. One card, two blocks:
- **WiFi** (read-only confirmation): SSID, IP, RSSI as an `--ok` pill "Connected". A "Change WiFi"
  link re-opens the SoftAP flow (device drops to provisioning). Rarely used here — WiFi is already
  up if this view renders.
- **MQTT** (the actual step-1 input): broker `host:port`, username, password, TLS auto-note
  ("TLS auto-enables with credentials"). Buttons: **Save & continue** → `POST /set_mqtt` (reboots to
  apply, then returns to step 2); **Skip** (no broker) → advance without reboot.
Validation inline (host:port shape). Primary action = brand button; Skip = quiet link-button.

### 5.2 Setup · Step 2 — Heat pump / ESP32  (first-run, gated on step 1)
Header + stepper `① ✓ · ② ✓ · ③ Heat pump`. One card, grouped fields, top-to-bottom:
1. **Model** — indoor / outdoor / DHW-tank selects (from `GET /models`) → resolves the value
   profile; a read-only "Profile: `<id>`" line confirms.
2. **Protocol** — `I` (default) / `S`, with a one-line hint (`0x15 0xEA` ⇒ S).
3. **Wiring (ESP32)** — RX pin, TX pin (number inputs) + a per-board pin hint from `/models`
   (`pin_hint`, e.g. XIAO S3 RX44/TX43). Language select.
4. **Values** — the profile's value catalogue as a scrollable checklist (grouped by domain, §6),
   with select-all / none; poll interval (s).
**Finish setup** → `POST /set_hp` (applies live, sets `setup_complete`) → transitions to Dashboard.
No reboot. A live "querying N registers…" note appears once polling starts.

### 5.3 Dashboard — operating values  (default after setup)
Header: title + a small **status hero** and a **settings gear** (opens §5.4). Layout, ordered:

1. **Status hero** (navy band): operation mode (Heating / Cooling / DHW / Standby / Off) as the
   headline, with fault state. Colour: `--ok` running, `--warn`/`--err` on fault; grey when no data.
2. **Health strip** (compact row of pills): WiFi (rssi), MQTT (connected/off/TLS), HP link
   (connected / `CRC n` / `timeout n`), last poll "Ns ago", firmware version. Semantic colours.
3. **Value groups** (§6) as cards, each a label→value·unit table, tabular numbers, only enabled +
   available values shown. A value that timed out this cycle shows "—" (not 0).
No setup controls on this screen — it is operation-only.

### 5.4 Settings  (from the dashboard gear)
A menu that reopens each setup step **as its own screen** (WiFi · MQTT · Heat pump), plus
Diagnostics (`GET /diag`, verbose toggle, clear) and Firmware (version, **Check for update** →
`/ota/check`→`/ota/update`). Each opens full-screen with a Back to dashboard control; the dashboard
is never shown behind a form.

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
6. **Device** — WiFi/MQTT/HP link, poll counters, uptime, firmware (also in the health strip).

Within a group: setpoints next to their measured value; temperatures before pressures before
currents. Units and `device_class` come from the value `dataType` (1=°C, 2=bar, 3=A). Groups with no
enabled/available values are hidden.

## 7. Components

- **Stepper** — 3 dots/labels; done = `--brand` filled + ✓, current = `--brand` ring, pending =
  `--muted`. Setup views only.
- **Button** — primary: `--brand` bg / white / bold; secondary: bordered, `--fg`; quiet: link-style
  `--brand`. One primary per view.
- **Input / select** — `--line` border, `--brand` focus ring; inline error text `--err` under field.
- **Pill** — rounded, semantic bg tint + text; used in the health strip and connection confirmations.
- **Value table** — two columns (label `--muted` left, value+unit right, tabular). Missing = "—".
- **Card** — `--card`, 1px `--line`, radius 12; section title small-caps `--muted`.
- **Toast** — bottom-centre, transient, for Save outcomes ("Saved", "Rebooting…", "Failed").
- **Hero** — navy band, brand/white text, one headline + one sub-line.

## 8. States & feedback

Every async action shows: idle → in-flight ("Saving…", spinner on button) → result (toast + view
transition). Specific:
- **Reboot writes** (WiFi/MQTT): after Save show "Rebooting — reconnecting…", poll `/status` until it
  answers, then advance/return.
- **Live writes** (heat pump): "Applied", stay on view or advance; poll `/values` for first data.
- **Connection loss**: dashboard health strip goes `--warn`/`--err`; hero greys to "No data"; the
  page keeps retrying `/status` with backoff, no hard error page.
- **Empty**: pre-first-poll dashboard shows "Waiting for first poll…"; unknown model shows the
  *Generic* hint.
- **Errors**: 4xx from a write → inline field error + toast; 503 (device OOM) → "Device busy, retry".

## 9. Responsive & accessibility

- Mobile-first single column; value-group tables stay single-column on phones, two-up ≥560px.
- Wide content (long value tables) never causes horizontal page scroll; the table scrolls in its card.
- Keyboard: logical tab order, visible focus ring, Enter submits the view's primary action.
- Contrast AA for text; status never conveyed by colour alone (pills carry text: "Connected",
  "CRC 3", "off").
- Respect `prefers-reduced-motion` (no non-essential transitions).

## 10. Firmware support required

The design needs these additions to the firmware (all small, tracked as follow-ups):
- `GET /status`: add `setup_complete` (NVS `daik_cfg/setup_done`), `mqtt.skipped`, `hp.configured`,
  `wifi.rssi`/`wifi.ip` (live). See `main/http_status.cpp`.
- `POST /set_hp`: set `setup_done=1` on first successful save.
- `POST /set_mqtt`: accept an explicit "skip" (empty broker already disables; mark skipped so the
  wizard advances without re-prompting).
- Optional `group` field on `ValueDef` (or generator-stamped) to drive §6 grouping; until then the
  UI groups by register-id ranges + label keywords.
- `/models`: already returns model lists, `profile_map`, `pin_hint`, per-profile value menu — the
  wizard and dashboard consume it.

## 11. Build / delivery

Unchanged pipeline: `www/index.html` (markup + `//@@INLINE` markers) + `www/style.css` + `www/app.js`
spliced by `inline_assets.cmake` into one gzipped page embedded in the firmware; `setup.html` gzipped
separately for the captive portal. The SPA is view-switched client-side from `/status`; no routing,
no external assets (CSP-clean, offline-capable on the device).
