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

1. **Two screens: the plant, and the box.** After provisioning the app opens on the **dashboard**,
   which is the heat pump — the live schematic, the detected model, every reading. The header
   **gear** opens **Settings**, which is the ESP32 and what it talks to: the Connections tile
   (WiFi/MQTT/Syslog/NTP) and the ESP32 board card (firmware/OTA, uptime, heap, X10A link, RX/TX
   pins, board hardware). Nothing sits between the gear and those cards — Settings is **flat**, no
   menu of entries to tap through, because there is little enough of it that a menu would exist only
   to hide a card behind a second tap. Settings still reports forward: a link that is **down** marks
   the gear (§5.6), so putting a card behind it hides the controls, never the failures.
2. **Provision, then run.** WiFi credentials are entered first on the captive portal (`setup.html`);
   the device reboots into your network and the app opens on the dashboard. They stay re-editable
   later from Settings › Connections › WiFi (§5.1, with automatic rollback on a bad
   change). The heat pump is fully automatic (auto-detected), so there is nothing to configure for it.
3. **Read-only truth.** The dashboard reflects the device; it never blocks on writes. The few writes
   (WiFi credentials, MQTT broker, Syslog server, NTP server, RX/TX pins, board hardware, OTA update
   channel) are explicit and report their outcome.
4. **Terse, dense, technical.** Tabular numbers, short labels, no decorative copy.
5. **Browser-detected language (de / en), no selector.** This principle scopes to the **device UI**
   (`main/www/`) — the GitHub Pages installer of §5.5 is English-only by decision, and `setup.html`
   is served before `app.js` exists. The UI **chrome** (system status block, card
   titles, connection rows, schematic labels, the inspector, modals, banners, toasts) and the tap-to-expand
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
| `--brand-navy`   | `#14285A` | `#0E1C43` | Deep navy from the logo triangle. **Defined but currently unused** — the setup hero ships on `--brand-tint` (§5.0). Kept as the reserved high-emphasis accent |
| `--brand-tint`   | `#E9F6FD` | `#12202b` | Faint cyan fill: the **setup hero band** (§5.0), selected rows, info blocks, step background |
| `--bg`           | `#F4F5F7` | `#12151A` | Page background |
| `--card`         | `#FFFFFF` | `#1B1F27` | Card / surface |
| `--fg`           | `#1C2530` | `#E6E9EE` | Body text |
| `--muted`        | `#6B7480` | `#93A0AF` | Secondary text, labels, units |
| `--line`         | `#E2E5EA` | `#2A2F39` | Borders, dividers |
| `--ok`           | `#1A9D5A` | `#3FBE7A` | Healthy / connected / running |
| `--warn`         | `#C9740A` | `#E08A2B` | Attention (reconnecting, CRC/timeout, weak signal) |
| `--err`          | `#D23B3B` | `#EA5A5A` | Fault / disconnected / invalid |
| `--flow-hot`     | `#DC5A32` | `#E06A40` | Supply/warm flow: schematic pipes in flow direction, the warm half of the drawing |
| `--flow-cold`    | `#3F7FD0` | `#5A97DE` | Return/cold flow: schematic return pipes, defrost accent |

Rules:
- **Brand = navigation & identity** (header rule, title, active step, primary button, focus ring,
  links). **Semantic = state** (ok/warn/err) for values and connection status — never recoloured
  to brand, so status is unambiguous.
- **Flow = temperature, not health.** `--flow-hot`/`--flow-cold` encode warm supply vs cold return
  in the system schematic (the universal heating-schematic convention). They
  are deliberately distinct hues from `--warn`/`--err` and never signal a state; both mode pairs
  are CVD-validated (deuteranopia/protanopia/tritanopia-separable against `--card`). The
  schematic's idle-pipe/plate-fill greys are component-level colours derived from the neutral
  ramp, not tokens.
- `--brand-tint` is for the setup hero band (§5.0) — a faint cyan fill carrying normal `--fg` text
  with a `--brand-strong` kicker, bordered like a card rather than reading as a dark chrome band.
  The dashboard has no such band: its status header sits on the system card itself (§5.3 item 1),
  so the first screen is the plant, not a coloured strip above it. Body remains on neutral `--bg`.
- Focus ring: `0 0 0 3px rgba(0,151,224,.25)` on every interactive element (keyboard-visible).
- Contrast: white on `--brand`/`--brand-strong` for bold button text; body text stays on neutral
  surfaces. `--muted` meets AA on `--card`.

Theme follows `prefers-color-scheme`; both light and dark are first-class (tokens above).

## 3. Layout tokens

- Font: system UI stack, 15px/1.5 base (mobile); the whole ramp scales ~1.15× at ≥600px (§9).
  Numbers `font-variant-numeric: tabular-nums`.
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32. Card padding 16–18. Grid gap 16.
- Radius: 8 (controls), 12 (cards), 20 (pills/toast). Elevation: 1px border + soft shadow on cards.
- Container: `max-width 720px` (mobile), widening to `820px` at ≥600px (§9), centred. Mobile-first
  (setup is done from a phone).
- Header: sticky, 2px `--brand` bottom rule, title in `--brand`.

## 4. Information architecture (the state machine)

The SPA subscribes to the `/events` WebSocket (sends `"sub"`, then receives pushed `status`/`values`
frames) — this is the **only** live transport, there is no HTTP polling. A browser without WebSocket
loads a one-time `GET /status`/`GET /values` snapshot and the user reloads the page to refresh. Once
the device is on the network the app opens on the **dashboard** and stays there unless the user asks
for **Settings** (the header gear, §5.6). That is the whole navigation tree — two screens, one way
back (the header chevron, or `Esc`):

```
                    ┌─────────────── served from SoftAP (192.168.4.1) ───────────────┐
                    │  VIEW: Provision (setup.html)  —  WiFi credentials only         │
                    └───────────────────────────┬────────────────────────────────────┘
                                                 │ device reboots into STA
   GET /status on the device (STA) →  view:
        wifi.ip == none ............... (shouldn't happen on STA; show "reconnecting")
        otherwise ..................... VIEW: Dashboard  ──── gear ────▶  Settings (§5.6)
                                                          ◀── chevron ──   · Connections tile
                                                                              └─ row ─▶ modal (§5.1)
                                                                           · ESP32 card
                                                                              └─ Hardware ─▶ modal
```

There is **no routing and no history integration**: the screen is app state, not a URL. The page is
served from the device with no paths, and a hash route would survive a reload into a screen the user
did not ask to be on.

The **dashboard** carries no config at all. Every write lives on **Settings** (§5.6): the WiFi
credentials, MQTT broker, Syslog and NTP servers are a **modal** off their row on the Connections
tile, and the RX/TX pins + board hardware are on the ESP32 card there. The one dashboard control
that isn't a reading is the **firmware version** in the header, which triggers the OTA check (§5.4).
The heat pump is otherwise **fully automatic** (auto-detected).

- There is **no in-app first-run wizard**: WiFi is provisioned first from the
  captive `setup.html` (§5.0) and thereafter re-editable from the gear → Connections → WiFi
  (§5.1, with automatic rollback to the last working network if the new
  credentials fail), the MQTT broker from the same tile's MQTT row (§5.1), the heat pump
  needs no setup (auto-detected; RX/TX pins on the ESP32 card in Settings, §5.6), and firmware
  updates are checked by tapping the version — the header meta line, or the Version row on the
  Settings ESP32 card, which does the same thing (§5.4).
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
always present — feeds the Settings ESP32 card's Last-reset and Free-heap rows),
`ota{channel}` (`"release"` | `"dev"` — which published feed the next update check reads; the
SETTING, not the running build, since a device can be set to a channel it has not installed from
yet — drives the ESP32 card's Update-channel select, §5.4),
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

### 5.1 WiFi / MQTT / Syslog / NTP edit  (modal, from the Connections tile)
The **Connections tile** on Settings (§5.6) combines WiFi, MQTT, Syslog and NTP into one row each;
every row carries a trailing **pencil** and the whole row is tappable, opening a centred **modal**
over the dimmed screen. These are the four rows edited this way, and they share the identical
overlay pattern (Cancel / backdrop / `Esc` dismiss without writing; Save reboots to apply, then closes
back to Settings — `Esc` closes the modal only, never also the screen behind it). The forms:
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
no poll-interval control (poll is fixed at 1 s). What there is to see or touch is split the way
everything else is — what the *unit* is on the dashboard, what the *board* is in Settings:
- **Model** name (the brand while offline) and detected capacity (shown only while the link is live)
  → the dashboard **Model** card (§5.3). There is no "auto-vs-manual detection" indicator.
- **X10A link** (Online/Offline), **protocol** (X10A-I/S) and the **RX/TX pins** → the **ESP32**
  card in Settings (§5.6). The RX/TX pins are the physical X10A link, so they are **persisted** (a
  manual pick survives reboot) and the detection sweep tries the cached pair first (defaults as
  fallback, so a stale cache self-heals). RX/TX are **auto-detected**: while the bus answers they show
  **read-only** (just the number). When it doesn't, each becomes a **dropdown** of the chip's safe
  GPIOs (`/status.pins_avail`, per-target `logic/board_pins.hpp` — SPI flash/strapping/JTAG pins
  never appear); picking a pin posts `{profile:"auto", rx, tx}`, which re-runs detection on the chosen
  pair (+ its swap) next cycle. The current pin is always in its own list even if off-catalogue.

### 5.3 Dashboard — the operating screen  (default after setup)
Header (an **outdoor-unit icon** — a fan + louvered condenser, the brand mark across the app — then
the **product name**, then the **settings gear** on the right, the one way off this screen, §5.6).

- **Product name** (headline line): the fixed title **`daikin-altherma-esp32`** — a stable app
  identity, not the detected model. Spelled in full lower-case exactly like
  the hostname / SoftAP / MQTT base topic (the project-wide naming convention), never "Daikin
  Altherma ESP32". The detected heat-pump model is shown instead in the **Model**
  status card (§5.3 body).
- **Meta line** (under the name): **IP address · firmware version · inline OTA status**. The IP is
  `wifi.ip`, falling back to the browser's own `location.hostname` (e.g. the mDNS name) while it is
  empty — board identity, not a WiFi *link* fact, so it lives here rather than in the Connections
  tile's WiFi row (§5.6). The **version** (`version`) sits beside it as a button: tapping it
  checks for an OTA update, and the whole check/download reports back **in this line**, right next to
  the number it is about (§5.4). Both stay `--muted`: an available update is announced by the
  confirm dialog, not by colouring the header, and the version picks up the brand tint only on
  hover/focus — the same affordance the tappable value rows use. Only the IP may ellipsise on a
  narrow screen; the version and the OTA readout are short and must stay whole. Both are `--font-mono`
  with tabular figures (§3): they are one identity string reading `<ip> · <version>`, and a split
  face makes the line look like two unrelated facts. Stated because it is easy to break invisibly —
  the version is a `<button>`, and resetting its UA styling with the `font:` SHORTHAND silently
  discards font-family *and* font-variant-numeric, dropping it back to the sans face with the
  `mono num` classes still sitting in the markup, apparently applied.

Body, ordered:

0. **Recovery-mode banner** (only when `sys.safe_mode` is true). A `--warn`-accented card **above the
   system card**: title "Recovery mode", explaining that the device restarted too many times and came up
   minimally (heat-pump polling and MQTT paused), and to correct the configuration (e.g. the RX/TX
   pins on the ESP32 card in Settings) and reboot. **Not dismissible** — it reflects a live state and clears
   itself once a healthy reboot leaves safe mode. Lives outside the poll-rebuilt card grid.
0. **WiFi-rollback banner** (only when `wifi.rolled_back` is true). A `--warn`-accented card **above
   the system card**: title "WiFi change failed — rolled back", explaining that the new credentials couldn't
   connect, so the device restored the previous network (named from `wifi.ssid`, which after the
   rollback *is* the network it fell back to) and restarted, and to open Settings › Connections ›
   WiFi to try again.
   This cannot be a toast on the save flow: the device takes 60–180 s to reach the rollback verdict
   (§5.1) — far past the save's ~21 s reconnect poll — so the outcome almost always lands after the
   user has reloaded. **Not dismissible**: the marker is sticky until the next `/set_wifi` retires it,
   which is exactly the "until the user acts on it" lifetime wanted. Without it the failure is
   invisible — the device simply reappears on the old SSID and the dashboard looks normal.
0. **Crash banner** (only when `last_crash` is set — a fault reset or a core dump waiting; hidden on a
   clean boot). An `--err`-accented card **above the system card**. The title is keyed on `fault`, i.e. on
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
1. **System card — the first thing on the dashboard, and the whole "Now" answer.** Nothing sits
   above it but the banners. There is **no status hero and no header band**: everything the old hero
   said now lives *inside the drawing*, each fact at the component it describes, so one look at the
   picture answers "what is the plant doing right now".
   **Status block** (top-left of the SVG, where a drawing's title goes — it describes the whole
   plant, not one component): a state **dot** (`--ok` running, `--err` fault, `--muted` standby *or*
   no data), the **operation mode** as the headline (Heating / Cooling / DHW / Defrost / Stop — the
   hydronic I/U mode, see item 2), and one status line under it — "Operating", "Defrosting",
   "Circulating — compressor off", "Standby — not running", "Fault · U4 — check the outdoor unit.",
   "Waiting for the heat pump…", "Can't reach the device — retrying…". The last-poll age is
   appended only when the drawing has no leaving-water pill to prove freshness itself.
   The status line is derived from the **readings** (compressor rps, defrost flag, pump/flow), never
   from the fact that the X10A bus answers: it once said "Operating" in green whenever the link was
   up, so an idle plant was announced as running directly above pills that all read zero — and a
   parked unit still reporting its last mode ("DHW") read as a live tank charge while the 3-way
   valve beside it said "→ heating". The headline names the mode; only the status line claims
   activity. **Standby mutes the dot but not the text**, which is what separates it from "no data"
   (both muted) — and the words say which it is regardless of colour (§9).
   **State flags are drawn at their component**, never as a chip row: the room thermostat is a pill
   on the **heating riser** above the emitter (`--ok` while calling), the BUH step is part of the
   **BUH label** ("BUH 1"/"BUH 2", over the existing `--warn` tint — the tint says *on*, the digit
   says how much resistive heat is being paid for), low-noise mode is a pill **on the outdoor unit**
   beside the defrost pill. Pump and defrost were already drawn (rotation + "PUMP n%", the ❄ pill +
   the reversed refrigerant loop).
   **The schematic never hides.** When the X10A link drops it is the only thing left that can say
   why, so instead every value pill blanks to "—", every animation stops, the 3-way-valve label falls
   back to a bare "3WV" (no branch claimed) and the thermostat pill disappears — an idle plant with no
   readings, not a stale one — nothing on this screen is hidden by a dead bus.
   **A sleeping outdoor unit is a related case, and it is resolved the SAME way.** The
   outdoor unit refreshes its own register pages only while it *runs*; stopped, it keeps answering
   with the last run's values (`logic/ou_stale.hpp`, host-tested against the whole catalog) — measured
   on a live unit, outdoor air held exactly 19.0 °C for five hours, stepped when the compressor
   started, then sat at exactly 25.5 °C for three hours. So the outdoor-air and discharge pills
   **blank to "—"** while the compressor is stopped, exactly as they do on a dead bus: a value the
   unit is no longer measuring is not reported, rather than reported with a caveat attached. The
   drawing has one vocabulary for "no reading right now" and this is it — a second, dimmer register
   of half-valid numbers asks the user to remember which pills mean what, on a screen whose whole
   job is to be read at a glance. What the pill cannot say, the inspector does: the outdoor unit's
   idle explanation names the reason.
   ΔT blanks for a related but distinct reason: with the pump off and flow zero, the difference
   between two *stagnant* sensors is not a stale working point, it is not a working point at all.
   The **electrical input** is the same whenever it is falling back to the
   inverter current (a `0x21` row that freezes too): a stopped compressor is not drawing the 1.4 kW
   the held current implies, it is drawing ~0. It blanks with **no sub-label**, like every other held
   pill — the one vocabulary above applies here too, and the inspector names the reason when the pill
   is tapped. What it must not do is fall back to the "no current sensor" caption it shows when the
   profile genuinely has no such row: the profile has one, it is the *reading* that is not current,
   so that caption would stand a second wrong claim in front of the one just suppressed.
   The CT-clamp path is unaffected: those sit on a live
   hydronic page, so a non-zero reading at rest is genuine standby draw and is shown normally.
   The run state itself is never affected — the compressor witness (`INV frequency`) sits on a page
   that stays live in every profile, which is what makes "Standby — not running" trustworthy beside
   blanked pills.
2. **System schematic** — the body of that card, drawing the hydraulic + refrigerant circuit
   as an inline SVG: outdoor unit (fan + compressor with rps), refrigerant lines (gas + liquid — the
   lower one is the **liquid** line, not a suction line: the expansion valve sits in the outdoor unit
   at its far end), plate heat exchanger, supply line through the backup heater **and then the
   circulation pump** to the 3-way valve, DHW tank with coil, heating circuit, and the return line.
   The component **order is the manufacturer's** (installer reference §16.2: exchanger → R1T →
   backup heater → pump → R2T → outlet, then the field-supplied 3-way valve), not a drawing
   convenience — the pump is on the **supply** side, and drawing it in the return misplaced a real
   part. Value pills sit at their physical measuring
   points (outdoor temp, high/low pressure + discharge, EEV pulses, leaving/return water, ΔT, the
   estimated **heat output and COP** at the PHE, the estimated **electrical input** on the outdoor
   unit where the power goes in, flow + water pressure, pump %, tank temp/setpoint, room
   temp/setpoint). **There is no tile row under the diagram**: the working point belongs at the
   parts it describes, so ΔT carries its target setpoint, heat output carries the COP derived from
   it, and the electrical figure carries its own provenance ("est. · CT" vs "est. · INV" — the
   clamps see the whole unit, the inverter current only the compressor, so an INV-based COP is
   flattering whenever the backup heater is firing).
   Those three are *derived*, never measured — thermal from flow × ΔT (≈4.186 kJ/kg·K), electrical
   from current at an assumed 230 V — so each is drawn with "≈" under an **"estimated"** sub-label:
   the bus has no energy registers, and a derived number must never read as a measured one. COP
   shows "—" unless the compressor is actually running, and the heat-output pill hides entirely
   when flow or ΔT is missing rather than printing a confident 0.0. The electrical pill obeys the
   held-over rule below on its INV source only: the CT clamps sit on a page the unit keeps
   refreshing (a non-zero reading at rest is genuine standby draw and is shown), while the inverter
   current freezes with the rest of the outdoor unit's pages — so with the compressor off the INV
   fallback is suppressed and the pill simply blanks, with **no sub-label at all**: the drawing has
   one vocabulary for "no reading right now" and the *reason* is the explainer's job, not a caption
   in the schematic (tapping the pill says the compressor is off and the inverter current is left
   over from the last run). What it must not do is fall through to the "no current sensor" it shows
   when the profile genuinely has no such row — suppressing one wrong claim must not stand a
   *second* one in front of it, and that one is a claim about the hardware. **The pipes animate in flow
   direction** while the pump runs — supply in `--flow-hot`, return in `--flow-cold`; the 3-way
   valve state switches the animated branch (heating circuit ↔ tank coil), a defrost cycle reverses
   the refrigerant-loop animation and shows a `--flow-cold` "❄ defrost" pill, and an active BUH
   tints its symbol `--warn`. All values map over `/values` **label patterns** (the same technique
   as `pickValue`), so the card degrades per model: a missing value renders "—", a
   missing tank/room sensor hides that schematic branch entirely. The SVG is **static DOM updated
   in place** — never innerHTML-rebuilt per poll, which would restart the CSS animations — and the
   card scrolls horizontally inside itself below 640px content width (§9). Animations are pure CSS
   and stop under `prefers-reduced-motion` (the active branch stays visible by colour).
   **The drawing is explorable.** Every value pill and every component is a hit target: hovering or
   focusing outlines it in `--brand`, and tapping it opens the **inspector** (item 3) below the SVG.
   That is the whole point of the picture — a reading is only useful once you know what it means and
   what is normal for it, so the diagram is the way in, not a separate manual. Targets are `<g>`
   elements with `role="button"` + `tabindex`, activated by pointer, Enter or Space, each named by an
   SVG `<title>` (native tooltip *and* accessible name, from the one copy source); the SVG is
   therefore a labelled `role="group"`, never `aria-hidden` — a hidden subtree must not hold focusable
   elements. Tapping the same target again, ✕, or Escape closes the panel.
3. **Inspector** — the panel directly under the drawing, in the same card, so the explanation and the
   thing it explains are on screen together. Idle it shows **nothing** and collapses — the picture's
   clickability is carried by the hit targets themselves (hover/press feedback, `role="button"`,
   the SVG's own `aria-label`), and a standing line of instructional copy under an otherwise quiet
   dashboard is exactly the decorative copy §1.4 rules out. Selected it shows:
   a **title** (the concept in the UI language, e.g. "Leaving water"), the **headline reading** for
   that target (its `/values` row, or the derived figure for ΔT / heat output — an assembly like the
   outdoor unit has no single number and gets no headline rather than a "—" that would read as a
   missing value), the **source row label** in mono (the verbatim English register name, so a number
   in the picture can be traced to the value list in item 6), a live **state sentence** in bold for
   components ("Running — compressor at 62 rps.", "Paused — the valve is feeding the hot-water tank
   right now."), the **explainer** (what it is, and `Normal:` guidance where useful), and the
   **member readings** of that component as a compact label→value list.
   The explainer copy comes from the **same `DESCRIPTIONS` table** the value rows use (§5.3 item 5) —
   one source for "what does this mean", never a second parallel one. A value target resolves it
   through a canonical register label rather than the live one, so a profile's own spelling cannot
   drift onto a neighbouring entry. Component copy (outdoor unit, PHE, ΔT, heat output, heating
   circuit) has no equivalent in `DESCRIPTIONS` — nothing there describes an assembly or a derived
   figure — and lives in the inspector's own table, bilingual in the same `{en, de}` shape.
   **The inspector blanks whatever the drawing blanks, and says why.** A reading the pill withheld —
   a held-over outdoor-unit row while the compressor rests (`logic/ou_stale.hpp`), a ΔT with no water
   moving — must not come back as the headline, as a member reading, or inside a state sentence: the
   panel is *below the pill it explains*, so a number the picture just refused to state reads as a
   correction of the picture, and it is precisely the last-run value the blanking exists to withhold.
   The gate is **structural**, on the row's `/values` register page rather than its label, so it
   covers every row and every profile's spelling of one; and because a blank pill cannot explain
   itself, the panel replaces its state sentence with the *reason* it is blank (the compressor is
   stopped and the unit only refreshes its own sensors while it runs). That division of labour is the
   whole justification for blanking in the first place (§ the outdoor-unit rule above) — the drawing
   keeps one vocabulary for "no reading right now", the inspector carries the explanation.
   For the same reason a pill drawn from a *fallback* source names that source: the high-side pill
   falls back from the frozen HP transducer to the always-live refrigerant sensor, so the headline and
   the mono source line resolve the same row the pill did, never the register the concept is named for.
   The panel re-renders every poll so an open explainer follows the live values, but only when what
   it draws actually changed — an unconditional rebuild would collapse a text selection mid-read.
   Nothing in this section hides when the X10A link drops (§8): the schematic and its inspector stay,
   blanked to "—" (item 1), because they carry the status block that says why.
   **There is no trend/history card.** The firmware stores no history and a browser-side ring buffer
   is lost on every reload, so a 30-minute sparkline could never answer a question a person actually
   has — long-term analysis belongs to Home Assistant/Grafana, which hold the real series.
4. **Model card** — styled exactly like the value groups (§6), full-width below the live section:
   the model name (full-width heading) + detected capacity, from `detect{capacity_kw,
   model}`. Both are bus-derived, so they show **only while the link is live** (`hp.connected`):
   offline the name degrades to the brand "Daikin Altherma" and the capacity is hidden — never a
   cached fingerprint read as live. There is **no** "Detection: auto/manual" row (fully automatic).
   The **ESP32** card that used to sit above it is in Settings now (§5.6): this card is the *unit*,
   that one is the *board*.
5. **Value groups** (§6) as cards, each a label→value·unit table, tabular numbers; every value of the
   detected profile is shown. A value that timed out this cycle shows "—" (not 0). The schematic
   answers "what is happening"; these tables stay as the exact-value reference — both read the same
   `/values` dataset.
   - **Tap a value → plain-language explainer.** Each value row whose label is recognised is a button
     (trailing chevron affordance, like the ESP32 card's Hardware row); tapping it slides open a short description
     beneath the row — what the reading means and, where useful, what is normal vs worth a look. The
     text is keyed to the value **label** by a first-match-wins pattern table (`DESCRIPTIONS` in
     `app.js`), the same label-pattern technique the schematic/grouping already use, so one entry serves
     every profile's spelling of a quantity; a label that matches nothing stays a plain, non-expandable
     row. **The schematic inspector (§5.3 item 3) reads this same table**, so a quantity is explained
     identically whether the user arrives from the picture or from the value list — add a concept
     once, here. Each entry carries an English `what`/`normal` plus a German `de` copy; the browser language
     (§1) picks which is shown (English fallback). The value label above the box stays the English
     register name in both languages. The open state lives in app state
     (`S.descOpen`), not the DOM, so the per-poll rebuild of `#valueGroups` re-emits an expanded row
     open instead of collapsing it every second; the click toggles the live element so the slide
     animates, and updates the set for the next rebuild.

There is **no** health/badge strip: connectivity and board identity live in Settings behind the gear
(§5.6, which marks the gear when a link is down), operation/fault in the schematic's own status
block, and every card — system card, Model card and value groups — is the same full container width,
stacked in one column (§9). The dashboard carries **no setup control at all**; it is operation-only,
and the gear is its only affordance that isn't a reading.

### 5.4 Firmware / OTA  (tap the version — either place it is printed)
The one write that is **not** behind the gear: the **version** in the dashboard's header meta line
(§5.3 header) is a button that checks for an OTA update. It stays on the dashboard because it is
board *identity* — the number a user quotes in a bug report — and because the check reports its
progress in that same line, where the page underneath stays readable.

**Tapping the version does the same thing wherever the version is printed as a row of its own** —
so the **Version** row on the Settings ESP32 card (§5.6) runs the identical check. It is one
gesture with one meaning, not a second flow: the row calls the same `checkFirmwareUpdate()`.

**And it stays on the screen it was tapped on.** The readout has **two slots**, not one — `#otaStat`
in the header line, `#otaStatSet` in the Firmware row — and `otaInline` paints both with the same
content, so whichever screen is open is the one reporting. Only one is ever visible (the other
screen is `display:none`), so this is one readout following the version, not two competing. The
first version of this row went to the dashboard before starting the check, because the readout
lived only in the header; that is a constraint being paid for by the user. An update is started
while *reading this card* — the version, the channel it follows, the build it is about to become
are all on it — and being thrown to another screen mid-thought, to watch a ring, is the app
deciding where you should be looking. Moving the readout costs a second `<span>`; moving the user
costs them their place. **Nothing in the OTA flow navigates** — the only screen change is the page
**reload** after a successful install, which is a new page, not a jump.

Because that slot is painted straight into the DOM rather than rebuilt from state, the ESP32 card
**freezes while the readout has anything to say** (`S.otaShown`, which covers the terminal messages'
linger too). Otherwise the once-a-second rebuild would blink the percentage out and restart the
spinner's animation on every frame — the same hazard the header's `#otaStat` is exempt from
re-render for. What holds still is a card of static facts plus an uptime counter, for the seconds
an update takes; the Connections tile beside it keeps updating, since a link dropping mid-download
is exactly what a user would want to see move.

- **The status reports inline, in that same line** — a small progress ring plus a short label,
  immediately after the version (`#otaStat`): `192.0.2.159 · v1.2.3 ◔ 78%`. It is deliberately
  **not** a toast. A download runs for tens of seconds and ticks a percentage the whole time, which
  as toasts stacked up into a column of near-identical "Downloading… 78%" cards covering the very
  dashboard they were reporting on, each one outliving the number it carried. Inline, the reading
  replaces itself in place, next to the version it is about, and the page stays readable underneath.
  The labels are correspondingly terse ("up to date", "78%", "rebooting…") — they share a line with
  the IP and the version, so they read as a suffix, not as sentences. The readout is an
  `aria-live="polite"` region, and it collapses to nothing when idle, so the line is just
  "IP · version" whenever no update is in flight.
- **The flow** — `GET /ota/check`, then poll `GET /ota/status` until the check finishes (every OTA
  phase is asynchronous on the device, so the UI watches a state machine it doesn't drive). While
  checking, the ring spins with no label — there is no number to show yet. Up to date → "up to date",
  which clears itself after a few seconds. Update available → a confirmation naming both
  versions; on confirm `POST /ota/update`, then poll again rendering `progress` into the ring + "n%",
  and on `done` wait for the board to come back and **reload the page** (below). A `503` from the
  shared OOM guard is reported as a retryable "device busy", never as a timeout. Errors show in
  `--err` and linger longer than a success before clearing.
- **Which feed it checks is a setting, and it lives in Settings** — the **Update channel** row on
  the ESP32 card (§5.6), a two-option select: *Release* (cut by hand) or *Development* (every merge
  to `main`). It sits directly under the **Version** row, because a channel picker with no
  version beside it asks the user to hold "what am I running" in their head while choosing what to
  run. Picking one is a live write (`POST /set_ota`, no reboot), and it then **starts the check
  immediately, without leaving the card** — nobody switches channel for the setting itself, they
  switch to get that channel's build, so making them go and find the version afterwards would be a
  two-step job. It reports into the Version row directly above, next to the very number the channel
  decides. (This too used to bounce to the dashboard to reach the readout; that is what the second
  slot removed. No ordinary control on this screen navigates.)
- **A backwards switch is stated as one** — Development → Release means installing an **older**
  build, which the device refuses unless the request explicitly asks (`?downgrade=1`). So that
  confirmation is not a courtesy like the ordinary one above: it *is* the permission, and its text
  says outright that the running build is newer. Same dialog shape, different sentence — a user who
  reads only the first line still learns which direction they are going.
- **After the install the page RELOADS, it does not just re-render** (`otaWaitReboot`). This is the
  one place the dashboard cannot use the **reboot-and-reconnect poll** the modal saves use (§5.1):
  that one re-renders from a fresh `/status`, which is right when only the *data* changed — but an
  OTA replaces the HTML, the CSS and the running script, so the tab would keep showing the old UI
  driven by new firmware. `/status` is polled in the background (per-request abort, so a socket to a
  rebooting board can't stall the loop) and the page reloads on **any** of three signals: the
  `version` changed, `uptime_s` went *backwards*, or the device was seen to go down and come back.
  Three, because none is sufficient alone — a same-version reinstall and a health-gate **rollback**
  both return on the version we started from (only uptime catches those), and a fast boot can be
  missed entirely by a poll that starts a moment too late. After ~120 s (enough for a slow boot *and*
  a rollback cycle) it gives up: if the device is answering it reloads anyway — harmless, and it
  settles the question — but if it never answered at all the readout says "installed — reload the
  page" and stays, since replacing the one status line the user has with a browser error page tells
  them less than the message does.
- **A running update is adopted on page load** (`resumeOta`). The download lives on the device, not
  in the tab, so a reload mid-update — or a second browser — would otherwise show a silent header
  while the board was busy. One `GET /ota/status` at boot joins the existing download at its current
  percentage; finding `idle` leaves the header untouched.
- **Terminal messages clear on a sequence guard, not a timer alone.** Each write to the readout bumps
  a counter and a delayed clear only fires if nothing has been written since. Tapping the version
  again inside the linger window would otherwise let the *first* run's pending timer wipe the
  *second* run's message a moment after it appeared — a check that looks like it silently did nothing.
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
- The **device log** is not surfaced in the UI (an early Diagnostics screen was dropped). It remains
  available out-of-band at `GET /diag` (verbose/clear via query); a third card on Settings is where
  it would go if it ever comes back.
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
  `:focus-visible`), plus a `--muted` note naming the target and the exact configuration boundary:
  a no-Erase update preserves NVS; choosing Erase deliberately resets it.
  esp-web-tools' `--esp-tools-button-*` custom properties are **not** used and must not come back:
  they style only the element's *own* default button, which `slot="activate"` replaces — setting
  them beside a slotted button leaves a native grey browser button sitting on the brand page (the
  state this page shipped in). A slotted button is styled by this page's CSS, full stop. The
  `unsupported` / `not-allowed` slots are `--err` text.
- **Version line** (`.ver`, between the button and the note) — names the build this page installs:
  `--muted` "Version" + the number itself in `--font-mono`/`--fg`, since that is the one string a
  user quotes back in a bug report. Read at load from **`manifest.json`** — deliberately the same
  file the install button is handed, so the version shown and the image actually written cannot
  disagree; a number typed into the page would go stale at the next release. `ci-build-all.sh`
  stamps it `1.2.3` for a release, `1.2.3-dev.<n>` on the dev channel and `1.2.3-PR-<N>` on a
  preview, so a non-release build states its provenance here as well as in the banner (which is
  keyed on the **path**, so it is right before — and even without — the manifest fetch). Injected with `textContent`, never `innerHTML`. If the fetch fails
  (no manifest, or the page opened from disk) the line **stays hidden** — showing nothing beats
  asserting a version that could not be read.
- **Steps card** — "After flashing" as a `.section-label`, then the three steps as `--line`-divided
  rows with a `--brand-tint` numbered disc, matching the dashboard's value rows. Each `<li>` is the
  flex row and its text is wrapped in a single `<span>`: without the wrapper every inline node of the
  sentence (text, `<code>`, `<a>`) becomes its own flex item and the step lays out as a row of
  columns. `<code>` chips are `--soft` on `--line` and wrap (`overflow-wrap: anywhere`) so a long
  hostname never widens the card. The first step distinguishes a first install / explicit Erase
  (join the setup AP) from a no-Erase update (the stored WiFi reconnects).
- **Provenance banner** — the same `--warn`-accented banner of §5.3 item 0, because the identical
  page is served from two paths (`scripts/build-pages.sh`): on `…/dev/` it says the build is the
  latest merge to `main` rather than a cut release. The release root shows none — a release needs
  no caveat. (A third path, `…/PR/<N>/`, had its own variant until the per-PR preview was retired.) Keyed on the **path**, not on
  the version string: the banner has to be right before `manifest.json` has been fetched, and if
  that fetch fails it is all the page can say. Both variants point at the device's own *Update
  channel* setting (§5.4), since flashing a page is a one-off but the channel is what the device
  keeps following afterwards.
- The copy states what the firmware actually does: the model is **auto-detected** and the device has
  **one dashboard** — there is no "Setup" screen, no model picker and no RX/TX step to send people to
  (§5.2, §5.3).
- **English only — deliberately, not by omission.** The de/en browser detection of §1 stops at the
  device UI: it is an `app.js` mechanism, and this page ships no `I18N` dictionary and no script
  beyond the PR-banner check. The divergence from the dashboard is **not** a gap to close — do not
  add a translation layer here to make the two consistent.

### 5.6 Settings — the screen behind the gear (Connections + ESP32)
The dashboard header's **gear** (right, `.iconbtn.bordered`) is the only way off the dashboard. It
opens **Settings**, which swaps the dashboard header for a **back header** — a chevron plus the
screen title. `Esc` leaves the same way, but only when no modal is open: a modal owns `Esc` first, so
one key press never both closes a dialog and leaves the screen behind it.

**Settings is flat.** No menu of entries, no sub-screens: the gear lands directly on the two cards,
stacked in the same single column as everything else (§9). Both are the *same* cards they were on the
dashboard — the move changed where the configuration lives, not how it looks:

1. **Connections tile** — one full-width card, `--card` bordered like the value groups, titled
   "Connections". Combines **WiFi**, **MQTT**, **Syslog** and **NTP** into one row each: a label on
   the left, a single colour-coded value on the right (`--ok` connected/synced/enabled, `--warn`
   connecting/syncing/unreachable-but-forwarding, `--err` down/disabled-by-error), and a trailing
   **pencil** — the whole row is tappable and opens that link's edit modal (§5.1). The value itself
   *is* the address/name (not a separate "Connected" word next to it), matching MQTT/Syslog/NTP's
   `host:port`/server display; because that means state is conveyed by colour alone on the row's
   face, each row's accessible name (`aria-label`) spells the status out in words for screen readers
   and colourblind users, satisfying §9's "status never conveyed by colour alone" without changing
   the visual design. MAC and BSSID are **not shown anywhere** (bus-level detail nobody edits from
   here); the IP address lives in the dashboard header instead (§5.3 body).
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
     from `ntp{server,synced}`. The synced wall clock (`ntp.time`) is **not** shown on this row (no
     room in a one-line tile); it remains available via the MQTT heartbeat's `device_time` sensor and
     `/status.ntp.time`.
2. **ESP32 card** — the board itself, styled exactly like the value groups (§6): chip (`platform`),
   uptime (`uptime_s`),
   **Last reset** (`sys.reset_reason` — warn-coloured on a fault reason: panic / any watchdog /
   brown-out, neutral on a clean boot) and **Free heap** (`sys.free_heap`, compact e.g. "145 KB"),
   the heat-pump link (Online/Offline) and X10A protocol, the **RX/TX pins** — read-only when
   detected, else a usable-GPIO dropdown (§5.2) — and the **Hardware** row (status indicator +
   recovery-button pins), which opens the board-hardware modal. From `platform`,
   `uptime_s`, `sys{reset_reason,free_heap}`, `pins_avail`, `hp{proto,rx,tx,connected,last_ok_s}`,
   `board{…}`. Then the **Version** (`version`) and the **Update channel** select
   (`ota.channel` → `POST /set_ota`, §5.4). The version being here *as well as* in the dashboard
   header serves two different needs, and each row answers the one its screen asks: the header keeps
   board identity where a user quotes it from, while this row exists so the channel selector under
   it is legible — "which feed do I follow" is unanswerable without "what am I running". What they
   no longer differ in is **behaviour**: both are the OTA trigger, and both carry a readout slot, so
   the check runs and reports **here**, without leaving Settings (§5.4). This row was read-only
   through v1.0.13 on the reasoning that the header owned the affordance; in use that only made the
   version look inert precisely where a user is already deciding which build to run.

Under both, a `--muted` monospace footer line naming the product and running version.

**The gear's attention dot** — an `--err` dot on the gear whenever a connection is **down**, since
the Connections rows are no longer on the dashboard and a broker that stopped answering would
otherwise be invisible from the screen the user is on all day. Only `--err` raises it: `--warn` is
the transient half of the vocabulary (MQTT still connecting, NTP not yet synced, a syslog host that
ignores ping) and every boot passes through it, so warning on warn would leave the gear permanently
marked and the mark would stop meaning anything. A **disabled** link is a choice, not a fault, and
raises nothing. The dot is never the only carrier: the button's `aria-label` states the count in
words (§9).

**Rebuild rule.** Both cards are rebuilt from `/status` on every push (uptime alone changes each
second), so the write goes through the same change-guard the rest of the app uses — and the rebuild
is skipped entirely while an RX/TX dropdown **or the update-channel select** has focus, or the poll
would collapse it mid-pick. (Any future select on these cards has to join that guard — an open
native dropdown is destroyed by an `innerHTML` write, and the poll is ~1×/s.)

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
6. **Device** — WiFi/MQTT/HP link, poll counters, uptime, firmware (WiFi/MQTT and HP
   link/protocol/uptime in Settings, §5.6 — the Connections tile and the ESP32 card; firmware
   version in the dashboard's header meta line §5.4; model name in the Model card, §5.3 item 4).

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
  `grid-template-rows: 0fr→1fr` transition (§5.3 item 5). Unrecognised labels render as a plain,
  non-interactive row.
- **Card** — `--card`, 1px `--line`, radius 12; section title small-caps `--muted`.
- **Toast** — bottom-centre, transient, for Save outcomes ("Saved", "Rebooting…", "Failed"). Note it
  is *not* used for OTA: see the inline readout below.
- **Inline OTA readout** — a 13px progress ring + one terse label, in the header meta line right
  after the version (§5.4). `--muted`, `--err` on failure, collapsed to nothing when idle. The one
  progress indicator that is neither a button spinner nor a toast, because it reports a long-running
  action whose number changes throughout and belongs next to the version it is about.
- **Status block** — inside the schematic, top-left (§5.3 item 1): state dot + `--fg` headline (the
  operation mode) over one `--brand-strong` status line (`--err` on fault, `--muted` when there is no
  data; on **standby** only the dot goes `--muted`, the line stays `--brand-strong`). Drawn as SVG
  text, not HTML — it is part of the picture, not a band above it.
- **System schematic** — full-width card holding the live hydraulic/refrigerant SVG (§5.3 item 2):
  neutral pipe skeleton with animated `--flow-hot`/`--flow-cold` dash overlays, `--card` value
  pills with `--line` borders, `--muted` small-caps part labels. Scrolls horizontally inside the
  card below 640px content width.
- **State pill** — a value pill carrying a flag rather than a number, sitting on the component it
  belongs to (§5.3 item 1): `--card` fill, text+border tinted `--ok`/`--warn`/`--flow-cold`/`--brand`
  while the state is active, `--muted` otherwise. The text always names the state ("Thermostat off"),
  never colour alone.
- **Inspector** — `--brand-tint` panel under the schematic (§5.3 item 3), bordered like a card: an
  uppercase `--muted` title + mono source label on the left, the headline reading on the right, then
  the explainer paragraph and a `--line`-divided list of that component's readings. Idle it collapses
  to a single muted hint line.
- **Value pill** — the schematic's unit of reading (§5.3 item 2): `--card` fill, `--line` border,
  tabular value, optional `--muted` sub-label under it (the measurement's name, or "estimated" for a
  derived one). Widened to carry a second related figure where the two belong together (ΔT + target,
  heat output + COP), and hidden outright when its model has no such reading.
- **Connections tile** — `--card` bordered like the value-group cards, full width like every other
  card (§9) — one row per link (WiFi/MQTT/Syslog/NTP), each a label + a single colour-coded value +
  a trailing pencil (§5.6).
- **Icon button** — the header gear and back chevron: a `--soft` (gear: `--card` + `--line`) circle,
  `--brand-strong` on hover, `--focus-ring` on `:focus-visible`. The gear carries an optional `--err`
  dot (§5.6) marking a connection that is down.
- **Crash banner** — `--err`-accented card above the system card (§5.3 item 0), shown only when
  `last_crash` is set: title + meta + hex backtrace, with Download / Copy-diagnostics / Dismiss
  actions. Small `.sm` buttons + a quiet `.ghost` Dismiss.
- **Recovery banner** — `--warn`-accented twin of the crash banner (reuses its layout classes), above
  the system card, shown only when `sys.safe_mode` is true: title + one explanatory line, **no actions and no
  dismiss** (it mirrors a live state, clearing itself on a healthy reboot).

## 8. States & feedback

Every async action shows: idle → in-flight ("Saving…", spinner on button) → result (toast + view
transition) — **except the OTA flow**, whose in-flight state is a *percentage that ticks for tens of
seconds*, and which therefore reports inline in the header instead (§5.4: a toast per tick buries the
page under near-identical cards). Specific:
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
- **Connection loss**: the system card's status header greys to "No data"; the Connections tile's WiFi row shows "Offline" if WiFi dropped (and the gear is marked, §5.6), and
  the **Heat-pump card collapses to a bare "Offline"** if the X10A link is down — model, protocol and
  capacity vanish rather than showing stale cached values. The schematic blanks every pill to "—"
  and stops every animation — an animated pipe over a silent bus would assert a flow nobody measured,
  and a held-over reading would assert a value nobody is still measuring. The `/events` WebSocket reconnects every
  5 s (the schematic's status block shows "Unreachable — retrying…"), no hard error page.
- **Empty**: pre-first-poll dashboard shows "Waiting for first poll…"; unknown model shows the
  *Generic* hint.
- **Recovery mode**: if `sys.safe_mode` is true (too many crash boots), the recovery banner (§5.3
  item 0) shows above the system card and the heat-pump cards stay collapsed (polling is paused); the WiFi,
  MQTT and ESP32 (RX/TX) config controls behind the gear remain usable so the bad setting can be
  corrected, then a reboot returns to normal.
- **Post-crash**: if the last reset was a fault (or a core dump is waiting), the crash banner (§5.3
  item 0) appears above the system card until dismissed — with the title distinguishing the two triggers, so
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

- **Single column at every width.** Every card — system card, Model card, value groups and the
  Connections/ESP32 cards behind the gear — is the same full container width, centred, stacked top-down. Unlike the earlier ≥560px
  two-column multicol, this never leaves an empty second column (with a stray card shadow at the column
  gap) when only one card is present — e.g. just the value groups while the heat-pump link is down.
- **Type scales up on larger viewports.** Mobile is the base ramp (15px body, `max-width: 720px`);
  at **≥600px** (tablet / desktop) the container widens to `820px` and the whole type ramp scales up
  ~1.15× **together** — otherwise the mobile-sized column reads small and sparse on a big screen (a
  wall-mounted tablet), lots of empty margin around little content. The bump lives in **one** media
  block so the ramp stays coherent; it never changes the single-column layout, only its size.
- Wide content (long value tables) never causes horizontal page scroll; the table scrolls in its card.
- Keyboard: logical tab order, visible focus ring, Enter submits the view's primary action. The
  value-description expanders (§5.3 item 5) are real `<button>`s carrying `aria-expanded`, so they
  are focusable and toggle on Enter/Space with no extra key handling; the slide honours
  `prefers-reduced-motion`.
- Contrast AA for text; status never conveyed by colour alone (pills carry text: "Connected",
  "CRC 3", "off"). The Connections rows (§5.6) are the one deliberate exception to *visible*
  text — a row shows only a colour-tinted address/name — so the status word that would otherwise
  be a pill instead goes into the row's `aria-label`, keeping the rule for screen readers and
  satisfying it programmatically rather than visually. The gear's attention dot follows the same
  rule: the button's accessible name says how many connections are down.
- Respect `prefers-reduced-motion` (no non-essential transitions).

## 10. Firmware support required

The design needs these additions to the firmware (all small, tracked as follow-ups):
- `GET /status`: `wifi.rssi`/`wifi.ip`/`wifi.connected` (live, from `wifi_info()`) — **done**; the
  Connections tile's WiFi row consumes `rssi`/`connected` (§5.6) and the dashboard header
  identity line consumes `ip` (§5.3 body). See `main/http_status.cpp`.
- `POST /set_hp`: **every field is optional** — an omitted key keeps its current value, so the
  Settings ESP32 card posts just `{profile:"auto",rx,tx}` on a pin change. `poll_s` is **not**
  accepted (fixed at 1 s); `proto` is auto-detected and not accepted; there is no value mask.
- `GET /status`: `uptime_s` (seconds since boot) feeds the Settings ESP32 card's Uptime row.
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
