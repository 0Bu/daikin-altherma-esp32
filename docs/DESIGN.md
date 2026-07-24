# UI design specification

Design contract for the embedded web UI (`main/www/`), the captive portal (`main/www/setup.html`)
and the browser installer served from GitHub Pages (`docs/index.html`, §5.5).
Implementation-ready: colours, tokens, information architecture, per-view specs, states, and the
firmware fields the UI keys off. No framework — one self-contained gzipped page + the standalone
setup page (see `main/CMakeLists.txt`) + the standalone installer page.

The three pages are the **one** product a user walks through in order — install, provision, operate —
so all three ship the same tokens (§2), brand mark, hero, card and primary button. The installer
page lives outside the firmware and cannot include `main/www/style.css`, so its `:root` block is a
**duplicate** of the token set: a change to the palette in §2 has to land in `style.css`,
`setup.html` **and** `docs/index.html`.

## 1. Principles

1. **One screen.** After provisioning, the app is a single dashboard — there is **no Settings page
   and no sub-screens**. Everything the device exposes lives on that one page; the little config
   there (WiFi, MQTT, Syslog and NTP via modals, RX/TX pins inline) happens in place.
2. **Provision, then run.** WiFi credentials are entered first on the captive portal (`setup.html`);
   the device reboots into your network and the app opens on the dashboard. They stay re-editable
   later from the dashboard Connections tile's WiFi row (§5.1, with automatic rollback on a bad
   change). The heat pump is fully automatic (auto-detected), so there is nothing to configure for it.
3. **Read-only truth.** The dashboard reflects the device; it never blocks on writes. The few writes
   (WiFi credentials, MQTT broker, Syslog server, NTP server, RX/TX pins) are explicit and report
   their outcome.
4. **Terse, dense, technical.** Tabular numbers, short labels, no decorative copy.
5. **Browser-detected language (de / en), no selector.** This principle scopes to the **device UI**
   (`main/www/`) — the GitHub Pages installer of §5.5 is English-only by decision, and `setup.html`
   is served before `app.js` exists. The UI **chrome** (hero states, card
   titles, connection rows, KPI/schematic labels, modals, banners, toasts) and the tap-to-expand
   value **descriptions** (§6) are rendered in German for a `de*` browser (`navigator.language`) and
   English otherwise — English is the fallback for every string. There is **no manual language
   selector** and no server round-trip: the choice is made client-side at load (`LANG` in `app.js`,
   which also stamps `<html lang>`). The **firmware is still English-only** — the heat-pump **value
   labels** arrive over `/values` as English X10A register names (`docs/REGISTERS.md`) and are shown
   verbatim in **both** languages (the German descriptions explain them); the firmware ships no
   localized strings. All UI copy lives in one `I18N` dictionary; dynamic strings go through `t()`,
   static `main/www/index.html` markup through `data-i18n` + `applyStaticI18n()` (spelled in full
   now that this contract also covers a second `index.html`, the installer of §5.5).

## 2. Brand & colour tokens

Palette taken from the Daikin logo: the cyan wordmark, the light-cyan and deep-navy triangle.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--brand`        | `#0097E0` | `#33ABE8` | Primary brand (Daikin cyan): buttons, active step, links, focus, header rule |
| `--brand-strong` | `#0079BD` | `#0097E0` | Hover/pressed, primary text-on-light |
| `--brand-sky`    | `#5AC8F0` | `#5AC8F0` | Light-cyan highlight: progress fill, chart/line, subtle gradient |
| `--brand-navy`   | `#14285A` | `#0E1C43` | Deep navy from the logo triangle. **Defined but currently unused** — the heroes ship on `--brand-tint` (§5.0, §5.3). Kept as the reserved high-emphasis accent |
| `--brand-tint`   | `#E9F6FD` | `#12202b` | Faint cyan fill: **hero bands** (setup + dashboard), selected rows, info blocks, step background |
| `--bg`           | `#F4F5F7` | `#12151A` | Page background |
| `--card`         | `#FFFFFF` | `#1B1F27` | Card / surface |
| `--fg`           | `#1C2530` | `#E6E9EE` | Body text |
| `--muted`        | `#6B7480` | `#93A0AF` | Secondary text, labels, units |
| `--line`         | `#E2E5EA` | `#2A2F39` | Borders, dividers |
| `--ok`           | `#1A9D5A` | `#3FBE7A` | Healthy / connected / running |
| `--warn`         | `#C9740A` | `#E08A2B` | Attention (reconnecting, CRC/timeout, weak signal) |
| `--err`          | `#D23B3B` | `#EA5A5A` | Fault / disconnected / invalid |
| `--flow-hot`     | `#DC5A32` | `#E06A40` | Supply/warm flow: schematic pipes in flow direction, trend "leaving water" series, heat-output meter |
| `--flow-cold`    | `#3F7FD0` | `#5A97DE` | Return/cold flow: schematic return pipes, trend "outdoor" series, defrost accent |

Rules:
- **Brand = navigation & identity** (header rule, title, active step, primary button, focus ring,
  links). **Semantic = state** (ok/warn/err) for values and connection status — never recoloured
  to brand, so status is unambiguous.
- **Flow = temperature, not health.** `--flow-hot`/`--flow-cold` encode warm supply vs cold return
  in the system schematic and the trend series (the universal heating-schematic convention). They
  are deliberately distinct hues from `--warn`/`--err` and never signal a state; both mode pairs
  are CVD-validated (deuteranopia/protanopia/tritanopia-separable against `--card`). The
  schematic's idle-pipe/plate-fill greys are component-level colours derived from the neutral
  ramp, not tokens.
- `--brand-tint` is for the setup hero band and the dashboard status hero background — a faint cyan
  fill carrying normal `--fg` text with a `--brand-strong` kicker, bordered like a card rather than
  reading as a dark chrome band. Body remains on neutral `--bg`.
- Focus ring: `0 0 0 3px rgba(0,151,224,.25)` on every interactive element (keyboard-visible).
- Contrast: white on `--brand`/`--brand-strong` for bold button text; body text stays on neutral
  surfaces. `--muted` meets AA on `--card`.

Theme follows `prefers-color-scheme`; both light and dark are first-class (tokens above).

## 3. Layout tokens

- Font: system UI stack, 15px/1.5 base (mobile); the whole ramp scales ~1.15× at ≥600px (§9).
  Numbers `font-variant-numeric: tabular-nums`.
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32. Card padding 16–18. Grid gap 16.
- Radius: 8 (controls), 12 (cards), 20 (pills/toast). Elevation: 1px border + soft shadow on hero.
- Container: `max-width 720px` (mobile), widening to `820px` at ≥600px (§9), centred. Mobile-first
  (setup is done from a phone).
- Header: sticky, 2px `--brand` bottom rule, title in `--brand`.

## 4. Information architecture (the state machine)

The SPA subscribes to the `/events` WebSocket (sends `"sub"`, then receives pushed `status`/`values`
frames) — this is the **only** live transport, there is no HTTP polling. A browser without WebSocket
loads a one-time `GET /status`/`GET /values` snapshot and the user reloads the page to refresh. Once
the device is on the network the app opens on the
**dashboard** and never leaves it — there are **no sub-screens and no Settings page**. In-place config
is the WiFi credentials, the MQTT broker, the Syslog server and the NTP server (each a **modal** off
its row in the dashboard **Connections tile**, §5.3) plus the RX/TX pins (inline on the ESP32 card).
The heat pump is otherwise **fully automatic** (auto-detected).

```
                    ┌─────────────── served from SoftAP (192.168.4.1) ───────────────┐
                    │  VIEW: Provision (setup.html)  —  WiFi credentials only         │
                    └───────────────────────────┬────────────────────────────────────┘
                                                 │ device reboots into STA
   GET /status on the device (STA) →  view:
        wifi.ip == none ............... (shouldn't happen on STA; show "reconnecting")
        otherwise ..................... VIEW: Dashboard (the only screen)
```

- There is **no in-app first-run wizard** and **no Settings page**: WiFi is provisioned first from the
  captive `setup.html` (§5.0) and thereafter re-editable from the WiFi row's pencil in the dashboard
  **Connections tile** (§5.1, with automatic rollback to the last working network if the new
  credentials fail), the MQTT broker is edited from that same tile's MQTT row (§5.1), the heat pump
  needs no setup (auto-detected; RX/TX pins on the dashboard ESP32 card, §5.3), and firmware updates
  are checked by tapping the version on that card (§5.4).
- MQTT is optional — an empty broker disables it.

`GET /status` exposes the fields the dashboard keys off:
`version`, `platform`, `uptime_s`, `app_elf_sha256` (build identity, shown in the crash banner),
`pins_avail[]` (per-target usable X10A GPIOs for the RX/TX picker),
`wifi{ssid,ip,rssi,connected,bssid,mac,std,rolled_back}` (`rolled_back` = the last `/set_wifi` was
undone by the credential rollback — sticky until the next one; drives the rollback banner, §5.3 item 0),
`mqtt{configured,connected,tls,has_creds,broker}`
(`has_creds` = whether credentials are stored, never what they are — gates the modal's remove-credentials
checkbox),
`hp{proto,rx,tx,connected,last_ok_s,…}`, `profile{id}`,
`sys{free_heap,min_free_heap,max_alloc,reset_reason,safe_mode}` (heap headroom + last boot reason,
always present — feeds the ESP32 card's Last-reset and Free-heap rows),
`last_crash` (`null` on a clean boot, else `{reason,reason_code,fault,coredump,task,pc,backtrace[],
corrupted,elf_sha256}` — drives the crash banner),
`detect{proto,valid,capacity_kw,ou_eeprom,candidates[],families[],ambiguous,model{name,family,
marketing}}` (drives the dashboard ESP32 board card + the read-only model card).

## 5. View specs

### 5.0 Provision (captive portal, `setup.html`)
Standalone, `--brand-tint` hero + one card. Only WiFi. SSID as a **typed** text field (no scan, no
dropdown — a hidden network is entered exactly like a visible one, and the page fetches nothing),
password, **Save & reboot** → `POST /set_wifi`. Message line for save state. No other controls.
On reboot the device joins STA and the main UI takes over. (This is the pre-WiFi world; the SoftAP
serves only this page.)

The credential rules are mirrored client-side (SSID 1–32, password empty or 8–63) and a rejection is
rendered inline on the message line — the page announces "Saved — rebooting" **only** on an accepted
write, since the device reboots only then and a false success sends the user off to wait for a device
that never left the setup AP. It reads the reason from the `{"ok":false,"error":…}` body and tolerates
a plain-text body too; a 503 reads as "Device busy — try again in a moment" rather than surfacing the
heap guard's raw text as a credential problem (§8).

Scan results are **attacker-controlled**: any AP in range picks its own SSID, and 32 bytes is room for
`"><svg onload=…>`. This is also the one page where the user types their WiFi password, so the options
are built as DOM nodes (`createElement` + `.value`/`.textContent`, which never parse markup) rather
than concatenated into `innerHTML`. Every network-derived string on this page must stay on a
DOM/`textContent` path — it is served standalone in AP mode and has no `esc()` helper.

### 5.1 WiFi / MQTT / Syslog / NTP edit  (modal, from the dashboard Connections tile)
The dashboard's **Connections tile** (§5.3) combines WiFi, MQTT, Syslog and NTP into one row each;
every row carries a trailing **pencil** and the whole row is tappable, opening a centred **modal**
over a dimmed dashboard. These are the four rows edited this way, and they share the identical
overlay pattern (Cancel / backdrop / `Esc` dismiss without writing; Save reboots to apply, then closes
back to the dashboard). The forms:
- **WiFi**: SSID (required, 1–32 chars) + password (empty for an open network, else 8–63 chars),
  validated both in the UI and by `POST /set_wifi`. Only the SSID prefills (the password is never
  exposed by `/status`). **Save** → `POST /set_wifi` (persist + reboot). If WiFi was already
  configured, the previous credentials are kept as a one-shot NVS backup and **automatically restored**
  (with a reboot) when the new network fails to connect — so a wrong SSID/password entered over the LAN
  self-heals instead of stranding the device. A note in the form states this. The restore is reported
  after the fact by the **rollback banner** (§5.3 item 0), not by this modal: the device takes 60–180 s
  to decide, long after Save has returned. A rejected write (4xx) keeps the modal **open** with the
  reason inline on the offending field — only an accepted write enters the reboot-poll.
- **MQTT**: broker (`host:port`, or `mqtts://host:8883` for TLS), username, password, a **remove
  stored credentials** checkbox, TLS note ("credentials require an mqtts:// URL"). **Save** →
  `POST /set_mqtt`, which **pre-flights the broker** (DNS → TCP → a real MQTT connect/auth) before
  writing: on success the device reboots to apply and the modal closes; on failure the modal **stays
  open** and shows the reason inline (e.g. "Broker port unreachable", "Invalid username or password",
  "Invalid port") — nothing is saved. **Cancel** (and the backdrop / `Esc`) dismiss without writing.
  An empty broker disables MQTT (no probe).
Only the broker prefills (username/password aren't exposed by `/status`). Because the credential
fields start blank, **leaving them empty keeps the stored credentials** — to change them, retype them.
Empty therefore can't also mean "remove", so clearing is its own explicit control: the **remove stored
credentials** checkbox (shown only when `/status.mqtt.has_creds`, and it empties + disables the two
fields while ticked) sends `clear_creds:true`. That is the only path from an authenticated `mqtts://`
broker to an anonymous one — without it the kept credentials reject every later plaintext broker with
"Credentials require mqtts://". Ticking it deliberately **leaves the broker scheme alone**: dropping
credentials is not a request to drop TLS, and an anonymous `mqtts://` broker is a valid target.
Typing a username or password **auto-upgrades the broker scheme to TLS** (`mqtt://`→`mqtts://`,
`ws://`→`wss://`, or prepends `mqtts://`) since the bridge refuses credentials over plaintext;
clearing the fields by hand strips the scheme back. Validation is also inline client-side (bare
`host:port`, or a `mqtt(s)://` / `ws(s)://` URL).
Actions row at the bottom: Cancel (secondary) + Save (brand).
- **Syslog**: host + port (`1–65535`, default 514). **Save** → `POST /set_syslog` (persist + reboot);
  an empty host disables forwarding. Only the port range is validated on the device — DNS resolution
  and the advisory reachability probe run in the syslog task after reboot and surface on that row via
  `/status.syslog`. The host prefills from `/status`.
- **NTP**: a single server field (hostname or IP), no port. **Save** → `POST /set_ntp` (persist +
  reboot); no validation beyond what the field accepts — an empty server is **not** a disabled state
  (unlike Syslog/MQTT) but a reset to the firmware's compile-time default on the next boot, since
  SNTP has nothing to turn off. The field prefills from `/status.ntp.server`.

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
  **read-only** (just the number). When it doesn't, each becomes a **dropdown** of the chip's safe
  GPIOs (`/status.pins_avail`, per-target `logic/board_pins.hpp` — SPI flash/strapping/JTAG pins
  never appear); picking a pin posts `{profile:"auto", rx, tx}`, which re-runs detection on the chosen
  pair (+ its swap) next cycle. The current pin is always in its own list even if off-catalogue.

### 5.3 Dashboard — the only screen  (default after setup)
Header (an **outdoor-unit icon** — a fan + louvered condenser, the brand mark across the app — then
the **product name**). There is **no settings gear** — the app has no other screen.

- **Product name** (headline line): the fixed title **`daikin-altherma-esp32`** — a stable app
  identity, not the detected model and no firmware version. Spelled in full lower-case exactly like
  the hostname / SoftAP / MQTT base topic (the project-wide naming convention), never "Daikin
  Altherma ESP32". Under it, a small identity line shows the current **IP address** (`wifi.ip`,
  falling back to the browser's own `location.hostname` — e.g. the mDNS name — while it is empty) —
  board identity, not a WiFi *link* fact, so it lives in the header rather than the Connections
  tile's WiFi row (§5.3 item 5). The detected heat-pump model is shown instead in the **Model**
  status card (§5.3 body).

Body, ordered:

0. **Recovery-mode banner** (only when `sys.safe_mode` is true). A `--warn`-accented card **above the
   hero**: title "Recovery mode", explaining that the device restarted too many times and came up
   minimally (heat-pump polling and MQTT paused), and to correct the configuration (e.g. the RX/TX
   pins on the ESP32 card) and reboot. **Not dismissible** — it reflects a live state and clears
   itself once a healthy reboot leaves safe mode. Lives outside the poll-rebuilt card grid.
0. **WiFi-rollback banner** (only when `wifi.rolled_back` is true). A `--warn`-accented card **above
   the hero**: title "WiFi change failed — rolled back", explaining that the new credentials couldn't
   connect, so the device restored the previous network (named from `wifi.ssid`, which after the
   rollback *is* the network it fell back to) and restarted, and to open the Connections tile's WiFi
   row to try again.
   This cannot be a toast on the save flow: the device takes 60–180 s to reach the rollback verdict
   (§5.1) — far past the save's ~21 s reconnect poll — so the outcome almost always lands after the
   user has reloaded. **Not dismissible**: the marker is sticky until the next `/set_wifi` retires it,
   which is exactly the "until the user acts on it" lifetime wanted. Without it the failure is
   invisible — the device simply reappears on the old SSID and the dashboard looks normal.
0. **Crash banner** (only when `last_crash` is set — a fault reset or a core dump waiting; hidden on a
   clean boot). An `--err`-accented card **above the hero**. The title is keyed on `fault`, i.e. on
   whether *this* boot was itself a crash: "Device restarted after a crash" when it was, else "Crash
   report waiting from an earlier restart" — an orphan dump left in flash raises the banner on every
   later boot (including a clean power-on or a USB re-plug), and must not claim a crash that did not
   happen. Then a meta line (reset reason · crashed task · fw version · short `app_elf_sha256`), the
   raw hex backtrace, and actions — **Download crash report** (`GET /coredump`, shown only while a
   dump actually exists — `/status` reports that live, so the button disappears once the dump is
   cleared), **Copy diagnostics** (`/status` + `/diag` + summary to the clipboard for a bug report),
   and **Dismiss**. Dismissal is keyed to the crash signature (reason/PC/task — *not* the dump state,
   so pulling the dump can't resurrect a dismissed banner), so a *new* crash re-shows it. Lives
   outside the poll-rebuilt card grid, so its dismissed state survives re-renders.
1. **Status hero — the "Now" panel** (`--brand-tint` band): operation mode (Heating / Cooling / DHW /
   Standby / Off) as the headline, with fault state. Colour: `--ok` running, `--warn`/`--err` on
   fault; grey when no data. Fault text and the last-poll age surface in the hero sub-line. While
   the X10A link is live the hero additionally carries **state chips** (Thermostat / Pump / BUH
   step / Defrost / Quiet — only the flags the detected profile reports; `--ok` running, `--warn`
   BUH, `--flow-cold` defrost) and **three key figures** (leaving water, outdoor, estimated heat
   output — the "est." derivation in item 3). Chips and figures hide with the link, leaving the
   original hero.
2. **System schematic** — a full-width card ("System") drawing the hydraulic + refrigerant circuit
   as an inline SVG: outdoor unit (fan + compressor with rps), refrigerant lines, plate heat
   exchanger, supply line through the backup heater to the 3-way valve, DHW tank with coil, heating
   circuit, and the return line through the pump. Value pills sit at their physical measuring
   points (outdoor temp, high/low pressure + discharge, EEV pulses, leaving/return water, ΔT, flow +
   water pressure, pump %, tank temp/setpoint, room temp/setpoint). **The pipes animate in flow
   direction** while the pump runs — supply in `--flow-hot`, return in `--flow-cold`; the 3-way
   valve state switches the animated branch (heating circuit ↔ tank coil), a defrost cycle reverses
   the refrigerant-loop animation and shows a `--flow-cold` "❄ defrost" pill, and an active BUH
   tints its symbol `--warn`. All values map over `/values` **label patterns** (the same technique
   as the hero's `pickValue`), so the card degrades per model: a missing value renders "—", a
   missing tank/room sensor hides that schematic branch entirely. The SVG is **static DOM updated
   in place** — never innerHTML-rebuilt per poll, which would restart the CSS animations — and the
   card scrolls horizontally inside itself below 640px content width (§9). Animations are pure CSS
   and stop under `prefers-reduced-motion` (the active branch stays visible by colour).
3. **KPI tiles** — a responsive grid of six compact tiles under the schematic: Compressor (rps +
   modulation bar against a nominal display maximum), Flow (l/min + pump %), ΔT water (vs. the
   target-ΔT setpoint), Water pressure (bar + bar meter), **Heat output (est.)** and **COP (est.)**.
   The two estimates are *derived* — thermal from flow × ΔT (≈4.186 kJ/kg·K), electrical from the
   CT phase currents at an assumed 230 V (falling back to the inverter primary current) — and are
   always labelled "est.": the bus has no energy registers, and a derived number must never read as
   a measured one. COP shows "—" unless the compressor is actually running.
4. **Trend card** — "Trend — last 30 min": leaving-water (`--flow-hot`) and outdoor (`--flow-cold`)
   temperature sparklines from a **client-side ring buffer** over the `/events` pushes (one sample
   per 10 s, 180 samples), with min/max axis labels, faint gridlines, endpoint dots + value labels
   and a legend naming only the series that draw. Deliberately RAM-only in the browser and lost on
   reload — the firmware stores no history, and long-term charts remain Home Assistant/Grafana's
   job. Shows "Collecting data…" until two samples exist.
   Items 2–4 (and the hero's chips/figures) render **only while the X10A link is live** — offline
   they hide entirely rather than showing stale pipes (§8).
5. **Connections tile** — one full-width card below the live section. Combines **WiFi**, **MQTT**,
   **Syslog** and **NTP** into one row each: a label on the left,
   a single colour-coded value on the right (`--ok` connected/synced/enabled, `--warn`
   connecting/syncing/unreachable-but-forwarding, `--err` down/disabled-by-error), and a trailing
   **pencil** — the whole row is tappable and opens that link's edit modal (§5.1). The value itself
   *is* the address/name (not a separate "Connected" word next to it), matching MQTT/Syslog/NTP's
   `host:port`/server display; because that means state is conveyed by colour alone on the row's
   face, each row's accessible name (`aria-label`) spells the status out in words for screen readers
   and colourblind users, satisfying §9's "status never conveyed by colour alone" without changing
   the visual design. MAC and BSSID are **not shown anywhere** (bus-level detail nobody edits from
   here); the IP address lives in the header instead (§5.3 body, above), not on this tile.
   - **WiFi** — label is the PHY standard name (e.g. "WI-FI 4"); value is signal bars + RSSI dBm +
     the SSID, coloured `--ok` while connected or plain **Offline** in `--err` otherwise (there is no
     "connecting" state in `/status.wifi`, just `connected: true/false`) — from
     `wifi{ssid,rssi,connected,std}`.
   - **MQTT** — **Disabled** (neutral, no colour) when no broker is set; else the **broker** string
     itself coloured `--ok` (Connected) / `--warn` (Connecting…) / `--err` (Error) — from
     `mqtt{configured,connected,broker,error}`. There is **no** TLS padlock marker: an `mqtts://`
     broker already shows its scheme in the URL, so the icon only restated the string (`mqtt.tls` is
     therefore unused by the UI). There is also **no** "HA discovery" row: discovery is streamed
     unconditionally on every (re)connect, so a row saying so would carry no information.
   - **Syslog** — **Disabled** (neutral) when no host is set; else `host:port` coloured `--ok` once
     DNS resolves and the advisory reachability probe answers, `--warn` while resolving or when the
     probe is silent (still forwarding — delivery is gated on DNS only), `--err` on a DNS error —
     from `syslog{configured,resolved,reachable,host,port,error}`.
   - **NTP** — the configured **server**, coloured `--ok` once the first SNTP reply of this boot has
     landed, else `--warn` (there is no "Disabled" state — SNTP always has a configured server) —
     from `ntp{server,synced}`. Unlike the earlier per-card NTP layout, the synced wall clock
     (`ntp.time`) is **not** shown on this row (no room in a one-line tile); it remains available via
     the MQTT heartbeat's `device_time` sensor and `/status.ntp.time`.
6. **Status cards** — two cards styled exactly like the value groups (§6), stacked full-width below
   the Connections tile:
   - **ESP32** — the board itself: chip (`platform`), **firmware version** (a tappable row that checks
     for an OTA update, §5.4), uptime (`uptime_s`), **Last reset** (`sys.reset_reason` — warn-coloured
     on a fault reason: panic / any watchdog / brown-out, neutral on a clean boot) and **Free heap**
     (`sys.free_heap`, compact e.g. "145 KB"), the heat-pump link (Online/Offline) and X10A
     protocol, and the **RX/TX pins** — read-only when detected, else a usable-GPIO dropdown (§5.2).
     From `platform`, `version`, `uptime_s`, `sys{reset_reason,free_heap}`, `pins_avail`,
     `hp{proto,rx,tx,connected,last_ok_s}`.
   - **Model** — the model name (full-width heading) + detected capacity, from `detect{capacity_kw,
     model}`. Both are bus-derived, so they show **only while the link is live** (`hp.connected`):
     offline the name degrades to the brand "Daikin Altherma" and the capacity is hidden — never a
     cached fingerprint read as live. There is **no** "Detection: auto/manual" row (fully automatic).
7. **Value groups** (§6) as cards, each a label→value·unit table, tabular numbers; every value of the
   detected profile is shown. A value that timed out this cycle shows "—" (not 0). The schematic
   answers "what is happening"; these tables stay as the exact-value reference — both read the same
   `/values` dataset.
   - **Tap a value → plain-language explainer.** Each value row whose label is recognised is a button
     (trailing chevron affordance, like the Firmware row); tapping it slides open a short description
     beneath the row — what the reading means and, where useful, what is normal vs worth a look. The
     text is keyed to the value **label** by a first-match-wins pattern table (`DESCRIPTIONS` in
     `app.js`), the same label-pattern technique the hero/grouping already use, so one entry serves
     every profile's spelling of a quantity; a label that matches nothing stays a plain, non-expandable
     row. Each entry carries an English `what`/`normal` plus a German `de` copy; the browser language
     (§1) picks which is shown (English fallback). The value label above the box stays the English
     register name in both languages. The open state lives in app state
     (`S.descOpen`), not the DOM, so the per-poll rebuild of `#valueGroups` re-emits an expanded row
     open instead of collapsing it every second; the click toggles the live element so the slide
     animates, and updates the set for the next rebuild.

There is **no** health/badge strip: connectivity/identity lives in the Connections tile, the board in
the ESP32/Model status cards, operation/fault in the hero, and every card — hero, Connections tile,
status cards and value groups — is the same full container width, stacked in one column (§9). The
only setup control on this screen is the ESP32 card's RX/TX pins (§5.2); otherwise it is
operation-only.

### 5.4 Firmware / OTA  (tap the version on the ESP32 card)
There is **no Settings page**. Firmware updates are triggered from the dashboard: the **Firmware**
row on the ESP32 card (§5.3) is a button (chevron affordance) that checks for an OTA update.

- **The flow** — `GET /ota/check`, then poll `GET /ota/status` until the check finishes (every OTA
  phase is asynchronous on the device, so the UI watches a state machine it doesn't drive). Up to
  date → an `ok` toast naming the running version. Update available → a confirmation naming both
  versions; on confirm `POST /ota/update`, then poll again surfacing `progress` as a toast, and on
  `done` hand off to the same **reboot-and-reconnect poll** the modal saves use (§5.1), so the page
  reconnects itself instead of going dead. A `503` from the shared OOM guard is reported as a
  retryable "Device busy", never as a timeout.
- **The one native dialog in the UI.** The update confirmation is a browser `confirm()`, not the
  modal overlay pattern every other decision uses (§5.1). Deliberate and deliberately isolated: it
  is a single yes/no with **no fields**, and the overlay machinery exists to host *inputs* — adding a
  fourth modal for one boolean would cost more UI surface than it buys. It is the **only**
  `confirm()`/`alert()` in `app.js`; if a second one is ever wanted, that is the signal to build the
  overlay properly instead of spreading native dialogs.
- **What "up to date" can also mean.** When no manifest is reachable — none has been published yet,
  or the two `CONFIG_DAIKIN_OTA_*` URLs point somewhere empty — a check legitimately
  finds nothing and says so. The UI does not distinguish "no newer version" from "no feed configured";
  both are honestly "up to date" from the device's point of view.
- The **device log** is no longer surfaced in the UI (there was a Diagnostics screen; it was removed
  with the Settings page). It remains available out-of-band at `GET /diag` (verbose/clear via query).
- There is **no manual language selector** — the UI language follows the browser (de / en), and the
  firmware itself ships no localized strings (§1).

### 5.5 Installer landing page (`docs/index.html`, GitHub Pages)
The page a user meets **first** — before the device runs any of the firmware's own UI — so it opens
on the same `--brand-tint` hero the captive portal does (§5.0), carrying the brand mark + the
monospace product name, then cards on neutral `--bg`. Same container as the dashboard
(`max-width: 720px`, `820px` + the ~1.15× type ramp at ≥600px, §9) rather than the portal's phone
width — Web Serial is desktop-only, so this page is read on a big screen. The hero takes the
**dashboard's** shape, not the portal's: a `--r-card` rounded, `--line`-bordered, `--shadow-card`
card inset to the same gutter as the cards below it (§7 "Hero" — a tinted band *bordered like a
card*), so the page is one stack of cards. The portal's full-bleed square band is right there — it
fills a phone screen edge to edge with nothing under it — and wrong here, where it sat as a square
block butted against the round CTA and steps cards below.

- **CTA card** — the `<esp-web-install-button manifest="manifest.json">` with a `slot="activate"`
  button styled as the app's `.btn.primary` (brand fill, white, `--shadow-cta`, `--focus-ring` on
  `:focus-visible`), plus a `--muted` note naming the target and that it is a full flash.
  esp-web-tools' `--esp-tools-button-*` custom properties are **not** used and must not come back:
  they style only the element's *own* default button, which `slot="activate"` replaces — setting
  them beside a slotted button leaves a native grey browser button sitting on the brand page (the
  state this page shipped in). A slotted button is styled by this page's CSS, full stop. The
  `unsupported` / `not-allowed` slots are `--err` text.
- **Steps card** — "After flashing" as a `.section-label`, then the three steps as `--line`-divided
  rows with a `--brand-tint` numbered disc, matching the dashboard's value rows. Each `<li>` is the
  flex row and its text is wrapped in a single `<span>`: without the wrapper every inline node of the
  sentence (text, `<code>`, `<a>`) becomes its own flex item and the step lays out as a row of
  columns. `<code>` chips are `--soft` on `--line` and wrap (`overflow-wrap: anywhere`) so a long
  hostname never widens the card.
- **PR-preview banner** — on a `…/PR/<N>/` path (`scripts/build-pages.sh`), the `--warn`-accented
  banner of §5.3 item 0, saying the build is that PR's and that OTA still tracks `main`.
- The copy states what the firmware actually does: the model is **auto-detected** and the device has
  **one dashboard** — there is no "Setup" screen, no model picker and no RX/TX step to send people to
  (§5.2, §5.3).
- **English only — deliberately, not by omission.** The de/en browser detection of §1 stops at the
  device UI: it is an `app.js` mechanism, and this page ships no `I18N` dictionary and no script
  beyond the PR-banner check. The divergence from the dashboard is **not** a gap to close — do not
  add a translation layer here to make the two consistent.

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
6. **Device** — WiFi/MQTT/HP link, poll counters, uptime, firmware (WiFi/MQTT in the Connections tile,
   §5.3 item 5; HP link/protocol, uptime and firmware on the ESP32 card §5.3; model name also in the
   header).

Within a group: setpoints next to their measured value; temperatures before pressures before
currents. Units and `device_class` come from the value `dataType` (1=°C, 2=bar, 3=A). Groups with no
enabled/available values are hidden.

## 7. Components

- **Button** — primary: `--brand` bg / white / bold; secondary: bordered, `--fg`; quiet: link-style
  `--brand`. One primary per view.
- **Input / select** — `--line` border, `--brand` focus ring; inline error text `--err` under field.
- **Value table** — two columns (label `--muted` left, value+unit right, tabular). Missing = "—".
  A recognised value row is also an expander: a full-width button with a trailing chevron that
  rotates on open, revealing the description in its **own inset `--brand-tint` info box** — held in
  from the row edges with a gap above/below, so the rows read as parting to make room for it rather
  than the row growing taller. Bold `--fg` "Normal:" lead-in on `--muted` body; slides down via a
  `grid-template-rows: 0fr→1fr` transition (§5.3 item 7). Unrecognised labels render as a plain,
  non-interactive row.
- **Card** — `--card`, 1px `--line`, radius 12; section title small-caps `--muted`.
- **Toast** — bottom-centre, transient, for Save outcomes ("Saved", "Rebooting…", "Failed").
- **Hero** — `--brand-tint` band bordered like a card, `--fg` text under a `--brand-strong` kicker,
  one headline + one sub-line.
- **System schematic** — full-width card holding the live hydraulic/refrigerant SVG (§5.3 item 2):
  neutral pipe skeleton with animated `--flow-hot`/`--flow-cold` dash overlays, `--card` value
  pills with `--line` borders, `--muted` small-caps part labels. Scrolls horizontally inside the
  card below 640px content width.
- **State chip** — small pill on the hero (§5.3 item 1): `--card` on `--brand-tint`, text+border
  tinted `--ok`/`--warn`/`--flow-cold` when the state is active, `--muted` otherwise. Text always
  names the state ("BUH off"), never colour alone.
- **KPI tile** — compact `--card` tile (§5.3 item 3): small-caps label, large tabular value +
  muted unit, optional 5px meter bar (`--brand`, or `--flow-hot` for the heat-output estimate).
- **Trend card** — sparkline card (§5.3 item 4): 2px series lines in the flow colours, dashed
  `--line` gridlines, `--muted` axis labels, endpoint dot ringed in `--card` + value label.
- **Connections tile** — `--card` bordered like the value-group cards, full width like every other
  card (§9) — one row per link (WiFi/MQTT/Syslog/NTP), each a label + a single colour-coded value +
  a trailing pencil (§5.3 item 5).
- **Crash banner** — `--err`-accented card above the hero (§5.3 item 0), shown only when
  `last_crash` is set: title + meta + hex backtrace, with Download / Copy-diagnostics / Dismiss
  actions. Small `.sm` buttons + a quiet `.ghost` Dismiss.
- **Recovery banner** — `--warn`-accented twin of the crash banner (reuses its layout classes), above
  the hero, shown only when `sys.safe_mode` is true: title + one explanatory line, **no actions and no
  dismiss** (it mirrors a live state, clearing itself on a healthy reboot).

## 8. States & feedback

Every async action shows: idle → in-flight ("Saving…", spinner on button) → result (toast + view
transition). Specific:
- **Reboot writes** (WiFi / MQTT / Syslog / NTP): Save disables the button and shows a spinner + "Saving…"
  while the request is in flight (the `/set_mqtt` broker pre-flight blocks up to ~8 s). **Only a 2xx**
  then shows "Rebooting — reconnecting…" and polls `/status` until it answers, closing the modal back
  to the dashboard; a `reboot:false` answer (nothing changed) closes with "No changes" and never polls.
  A rejected write must not enter the poll: with no reboot to wait for, `/status` answers on the first
  try and would report a phantom "Saved". (A WiFi change that can't reach the new network rolls back to
  the previous credentials and reboots again — see §5.1; the outcome surfaces on the rollback banner,
  §5.3 item 0, since it lands long after this poll gives up.)
- **Live writes** (heat pump): "Applied", stay on view; the `/events` WebSocket pushes the new
  values on the next poll cycle (a pin-pick also refreshes `/status` a few times to catch the connect).
- **Connection loss**: hero greys to "No data"; the Connections tile's WiFi row shows "Offline" if WiFi dropped, and
  the **Heat-pump card collapses to a bare "Offline"** if the X10A link is down — model, protocol and
  capacity vanish rather than showing stale cached values. The live section (schematic, KPI tiles,
  trend) and the hero's chips/figures **hide entirely** with the X10A link — an animated pipe over a
  silent bus would assert a flow nobody measured. The trend buffer keeps its samples, so a short
  drop resumes with its history (the gap simply isn't sampled). The `/events` WebSocket reconnects every
  5 s (hero shows "Unreachable — retrying…"), no hard error page.
- **Empty**: pre-first-poll dashboard shows "Waiting for first poll…"; unknown model shows the
  *Generic* hint.
- **Recovery mode**: if `sys.safe_mode` is true (too many crash boots), the recovery banner (§5.3
  item 0) shows above the hero and the heat-pump cards stay collapsed (polling is paused); the WiFi,
  MQTT and ESP32 (RX/TX) config controls remain usable so the bad setting can be corrected, then a
  reboot returns to normal.
- **Post-crash**: if the last reset was a fault (or a core dump is waiting), the crash banner (§5.3
  item 0) appears above the hero until dismissed — with the title distinguishing the two triggers, so
  a leftover dump alone doesn't report a crash that didn't happen this boot. "Copy diagnostics" toasts
  "Diagnostics copied — paste into a bug report" on success, or "Copy failed — open /coredump and
  /diag manually" if the clipboard is unavailable.
- **Errors**: a write that answers must be **read** before any "saved"/"rebooting" feedback. `fetch`
  rejects only on transport errors, never on status, so a refused save otherwise reads as a
  *successful* one — the device is still up, so `/status` answers immediately and the UI would confirm
  a save that never was. The reason always comes from the endpoint's `{"ok":false,"error":…}` body —
  every write endpoint answers a rejection in that shape, including the captive portal's `/set_wifi`.
  - **4xx** → inline field error + toast, modal stays open, nothing was saved.
  - **500** `{"error":"config write failed"}` (the NVS write failed — nothing saved, device did **not**
    reboot) → toast the error, leave the modal open with the values intact to retry.
  - **503** (device OOM) → "Device busy — retry in a moment": nothing was written and the same save is
    worth retrying verbatim, so it is a toast only and blames no field.

## 9. Responsive & accessibility

- **Single column at every width.** Every card — hero, Connections tile, status cards and value
  groups — is the same full container width, centred, stacked top-down. Unlike the earlier ≥560px
  two-column multicol, this never leaves an empty second column (with a stray card shadow at the column
  gap) when only one card is present — e.g. just the ESP32 card while the heat-pump link is down.
- **Type scales up on larger viewports.** Mobile is the base ramp (15px body, `max-width: 720px`);
  at **≥600px** (tablet / desktop) the container widens to `820px` and the whole type ramp scales up
  ~1.15× **together** — otherwise the mobile-sized column reads small and sparse on a big screen (a
  wall-mounted tablet), lots of empty margin around little content. The bump lives in **one** media
  block so the ramp stays coherent; it never changes the single-column layout, only its size.
- Wide content (long value tables) never causes horizontal page scroll; the table scrolls in its card.
- Keyboard: logical tab order, visible focus ring, Enter submits the view's primary action. The
  value-description expanders (§5.3 item 7) are real `<button>`s carrying `aria-expanded`, so they
  are focusable and toggle on Enter/Space with no extra key handling; the slide honours
  `prefers-reduced-motion`.
- Contrast AA for text; status never conveyed by colour alone (pills carry text: "Connected",
  "CRC 3", "off"). The Connections tile (§5.3 item 5) is the one deliberate exception to *visible*
  text — its rows show only a colour-tinted address/name — so the status word that would otherwise
  be a pill instead goes into the row's `aria-label`, keeping the rule for screen readers and
  satisfying it programmatically rather than visually.
- Respect `prefers-reduced-motion` (no non-essential transitions).

## 10. Firmware support required

The design needs these additions to the firmware (all small, tracked as follow-ups):
- `GET /status`: `wifi.rssi`/`wifi.ip`/`wifi.connected` (live, from `wifi_info()`) — **done**; the
  dashboard Connections tile's WiFi row consumes `rssi`/`connected` (§5.3 item 5) and the header
  identity line consumes `ip` (§5.3 body). See `main/http_status.cpp`.
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
