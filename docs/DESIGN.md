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
   (WiFi/MQTT/Syslog/NTP), and the ESP32 board card split into three — ESP32 (board hardware, uptime,
   memory), Protokoll (X10A link, RX/TX pins) and Firmware (version, OTA channel, language, plant
   diagnostics). Plant diagnostics are off by default. Only after that Firmware-row opt-in do the
   **Anlagendiagnose** and **Heizkurven-Diagnose** source cards appear below Firmware.
   Nothing sits between the gear and those cards — Settings is **flat**, no
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
5. **Browser-detected language (de / en) by default, with a manual override.** This principle scopes
   to the **device UI** (`main/www/`) — the GitHub Pages installer of §5.5 is English-only by decision,
   and `setup.html` is served before the device UI script exists. The UI **chrome** (system status block, card
   titles, connection rows, schematic labels, the inspector, modals, banners, toasts) and the tap-to-expand
   value **descriptions** (§6) are rendered in German for a `de*` browser (`navigator.language`) and
   English otherwise — English is the fallback for every string. That browser guess is the **default**;
   on top of it the device carries an optional **manual override** — the Firmware settings card's
   **Sprache** picker (Browser / English / Deutsch — "Browser" because that option IS the browser's
   own guess, not a separate automatic mode) `POST`s `/set_lang`, which persists the choice in **NVS**
   (`config ui_lang`, `logic/ui_lang.hpp`) and reports it back on `/status.ui.lang`. Once the user
   picks a language it wins over the browser guess on **every** client that opens the dashboard, until
   they set it back to Browser; the browser applies it live (`setLang()` in
   `js/i18n.js` re-runs `applyStaticI18n()`), no reload. The **firmware is still English-only** — the
   heat-pump **value labels** arrive over `/values` as English X10A register names
   (`docs/REGISTERS.md`) and are shown verbatim in **both** languages (the German descriptions explain
   them); the firmware ships no localized strings. All UI copy lives in one `I18N` dictionary; dynamic
   strings go through `t()`, static `main/www/index.html` markup through `data-i18n` +
   `applyStaticI18n()` (spelled in full now that this contract also covers a second `index.html`, the
   installer of §5.5).

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

The SPA **polls** `GET /values` every 2 s and `GET /status` every 8 s — one chain, backing off to
30 s on a device that stopped answering and suspended entirely while the tab is hidden (nobody is
looking, so nobody is served). There is no push transport: the `/events` WebSocket this replaced
failed in two ways a request cannot — silently (a dropped queue message froze one stream until
reboot, #238) and globally (its broadcaster ran the `/status` builder on the task that owns the X10A
UART, #241). Every browser now gets the same live UI instead of one class getting a manual reload.
Both cadences are the SCREEN's, not the plant's: the poll engine still reads the bus at 1 Hz. Once
the device is on the network the app opens on the **dashboard** unless its URL addresses **Settings**
or one of Settings' popups. That is the whole navigation tree — two screens plus addressable modal
children, one way back at each level (the header chevron, popup close action, browser Back, or `Esc`):

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
                                                                              └─ HomeHub ─▶ modal
                                                                           · Heating-curve diagnosis
                                                                              └─ Room sources ─▶ modal
                                                                           · ESP32 card
                                                                              └─ Hardware ─▶ modal
                                                                           · Protokoll card
                                                                              └─ RX/TX ─▶ dropdown
                                                                           · Firmware card
                                                                              └─ Channel/Language ─▶ select
```

The device still serves one document and no client-side paths. Its selected place is a **hash route**,
so it never creates another firmware HTTP resource: `/` is the dashboard, `/#settings` is Settings,
and `/#settings/<popup>` addresses each dialog (for example `wifi`, `room-temperature`,
`board-hardware`, or `bug-report`). The gear and every popup open add browser-history entries.
Browser Back/Forward, the header chevron, Cancel/backdrop, Save and `Esc` all traverse or canonicalize
the same hierarchy instead of maintaining a second navigation state. Reloading or sharing one of
these URLs restores exactly that screen/dialog through its normal fill lifecycle. A first status
response may hydrate a restored form, but never overwrites a draft the user has already begun.

The **dashboard** carries no config at all. Every write lives on **Settings** (§5.6): the WiFi
credentials, MQTT broker, Syslog and NTP servers are a **modal** off their row on the Connections
tile, and the RX/TX pins are on the Protokoll card there, board hardware on the ESP32 card. The one dashboard control
that isn't a reading is the **firmware version** in the header, which triggers the OTA check (§5.4).
The heat pump is otherwise **fully automatic** (auto-detected).

- There is **no in-app first-run wizard**: WiFi is provisioned first from the
  captive `setup.html` (§5.0) and thereafter re-editable from the gear → Connections → WiFi
  (§5.1, with automatic rollback to the last working network if the new
  credentials fail), the MQTT broker from the same tile's MQTT row (§5.1), the heat pump
  transport needs no setup (auto-detected; RX/TX pins on the Protokoll card in Settings, §5.6),
  while optional heating-curve-diagnosis inputs are configured on their own Settings card; firmware
  updates are checked by tapping the version — the header meta line, or the Version row on the
  Settings Firmware card, which does the same thing (§5.4).
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
`sys{free_heap,min_free_heap,max_alloc,mqtt_skipped,mqtt_quiesced,poll_skipped,reset_reason,safe_mode}`
(heap headroom, what it already cost in dropped/held publish + poll cycles (#380), and last boot reason,
always present; the UI reads `safe_mode` for the recovery banner and `free_heap`/`max_alloc` for the
ESP32 card's two trended memory rows (§5.6) — `min_free_heap` and the reset reason stay diagnostics
served to `/status` readers, the MQTT heartbeat's diagnostic entities and `/diag`),
`ota{channel}` (`"release"` | `"dev"` — which published feed the next update check reads; the
SETTING, not the running build, since a device can be set to a channel it has not installed from
yet — drives the Firmware card's Update-channel select, §5.4),
`last_crash` (`null` on a clean boot **or once the report is deleted** via `POST /crash/dismiss`,
else `{reason,reason_code,fault,coredump,task,pc,backtrace[],corrupted,elf_sha256}` — drives the
crash banner),
`detect{proto,valid,capacity_kw,capacity_kw_iu,ou_eeprom,candidates[],families[],ambiguous,
model{name,family,marketing}}` (drives the dashboard ESP32 board card + the read-only model card;
the two capacities are the outdoor unit's own report and the indoor unit's rated code — separate
figures for separate halves of the plant, never one with a silent fallback).

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
The **Connections tile** on Settings (§5.6) combines WiFi, MQTT, Syslog, NTP and Modbus into one row
each; every row carries a trailing **pencil** and the whole row is tappable, opening a centred
**modal** over the dimmed screen. The first four rows share the identical
overlay pattern (Cancel / backdrop / `Esc` dismiss without writing; Save reboots to apply, then closes
back to Settings — `Esc` closes the modal only, never also the screen behind it). The forms:

On phones the overlay is sized from the **dynamic visible viewport** (`100dvh`, with a `100vh`
fallback), not Safari's browser-chrome-inclusive legacy viewport. A long modal card owns vertical
touch scrolling and contains overscroll; while any modal is open both possible document scrollers
are locked. Closing the final modal releases them, so a drag can reach every footer action without
moving the Settings page behind the dialog.

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
no poll-interval control (poll is fixed at 1 s). The one thing that *is* a choice is **which link**
reaches the pump — the X10A service port (the default) or a HomeHub over Modbus TCP — and that is a
   connection, not a heat-pump setting, so it lives on its own row in the Settings Connections tile
   (§5.6 item 1). Its address may be typed or found with an explicit **Search** button; firmware never
   searches at boot. Saving the address empty disables the HomeHub stack. Nothing on that row
   controls the pump. What there is to see or touch
is otherwise split the way everything else is — what the *unit* is on the dashboard, what the *board*
is in Settings:
- **Model** name (the brand while offline) and detected capacity (shown only while the link is live)
  → the dashboard **Model** card (§5.3). There is no "auto-vs-manual detection" indicator.
- **X10A link** (Online/Offline), **protocol** (X10A-I/S) and the **RX/TX pins** → the **Protokoll**
  card in Settings (§5.6). The RX/TX pins are the physical X10A link, so they are **persisted** (a
  manual pick survives reboot) and the detection sweep tries the cached pair first (defaults as
  fallback, so a stale cache self-heals). RX/TX are **auto-detected**: while the bus answers they show
  **read-only** (just the number). When it doesn't, each becomes a **dropdown** of the chip's safe
  GPIOs (`/status.pins_avail`, per-target `logic/board_pins.hpp` — SPI flash/strapping/JTAG pins
  never appear); picking a pin posts `{profile:"auto", rx, tx}`, which re-runs detection on the chosen
  pair (+ its swap) next cycle. The current pin is always in its own list even if off-catalogue.

### 5.3 Dashboard — the operating screen  (default after setup)
Header (a **48 px static three-blade heat-pump fan mark** — then the **product name**, then the
**settings gear** on the right, the one way off this screen, §5.6). The mark is the supplied
blue-and-white silhouette, served as a dedicated local PNG so its rounded blade geometry remains
unchanged. It is identity, not telemetry: only the outdoor-unit fan in the system schematic follows
inverter frequency and defrost state; the global reduced-motion preference therefore affects that
live drawing, not the header mark.

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
   pins on the Protokoll card in Settings) and reboot. **Not dismissible** — it reflects a live state and clears
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
   and **Delete report**. The delete is a **device** action (`POST /crash/dismiss`), not a per-page
   hide: the device erases the dump and stops reporting the crash, so the banner is gone from every
   browser and from Home Assistant's retained crash entity at once. It used to hide the banner in
   page state alone, which a reload — the first thing anyone does — undid. Because the delete is
   irreversible and takes the one artifact a bug report needs with it, it **asks first**: a second
   tap *inside the banner*, replacing the actions row (not a native `confirm()` — §5.4 keeps the OTA
   dialog the only one of those; this needs no fields), and the question names the dump only when one
   exists. A failed delete restores the banner rather than hiding it, because the report is still on
   the device. The banner stays keyed to the crash signature (reason/PC/task — *not* the dump state),
   so a *new* crash arriving between the two taps is not what gets deleted. Lives outside the
   poll-rebuilt card grid, so its state survives re-renders.
1. **System card — the first thing on the dashboard, and the whole "Now" answer.** Nothing sits
   above it but the banners. There is **no status hero and no header band**: everything the old hero
   said now lives *inside the drawing*, each fact at the component it describes, so one look at the
   picture answers "what is the plant doing right now".
   **Status block** (top-left of the SVG, where a drawing's title goes — it describes the whole
   plant, not one component): a state **dot** (`--ok` running, `--err` fault, `--muted` standby *or*
   no data), the **operation mode** as the headline (Heating / Cooling / DHW / Defrost / Stop — the
   hydronic I/U mode, see item 2), and one status line under it — "Operating", "Defrosting",
   "Circulating — compressor off", "Standby — not running", "Fault · U4 — check the outdoor unit.",
   "Waiting for the heat pump…", "Can't reach the device — retrying…". With X10A offline and a
   live HomeHub fallback, the same activity line is derived from the HomeHub compressor, pump,
   tank-heater and flow witnesses and appends "X10A offline · Modbus" for provenance. The last-poll
   age is appended only when the drawing has no leaving-water pill to prove freshness itself.
   The status line is derived from the **readings** (compressor rps, defrost flag, pump/flow), never
   from the fact that the X10A bus answers: it once said "Operating" in green whenever the link was
   up, so an idle plant was announced as running directly above pills that all read zero — and a
   parked unit still reporting its last mode ("DHW") read as a live tank charge while the 3-way
   valve beside it said "→ heating". The headline names the mode; only the status line claims
   activity. **Standby mutes the dot but not the text**, which is what separates it from "no data"
   (both muted) — and the words say which it is regardless of colour (§9).
   **State flags are drawn at their component**, never as a chip row: Daikin's historically named
   `Space heating Operation` is shown as normal **space heating/cooling operation** on the room-circuit
   riser (`--ok` while ON), not as a thermostat demand or heating-only claim; the BUH step is part of the
   **BUH label** ("BUH 1"/"BUH 2", over the existing `--warn` tint — the tint says *on*, the digit
   says how much resistive heat is being paid for), X10A's exact **BSH** flag puts the unbordered
   **permanent BSH state pill** inside the DHW tank. Its face always says only "E-heater"/"Heizstab":
   light grey while inactive or unknown and orange while active. The inspector and accessible name
   retain the written ON/OFF/unknown state. The active state also animates an independent hot-colour
   overlay on the heater wave (not the hydronic `fCoil` flow overlay). **Quiet and Defrost are
   permanent pills on the outdoor unit**: light grey while inactive or unknown and blue while
   active, with written state in the inspector/accessibility name and a categorical history below.
   BSH is deliberately not
   inferred from BUH, Smart Grid or Powerful DHW: the electric immersion heater can run while the
   compressor, hydronic pump and flow all read zero, so it also replaces the generic standby line
   with the unabbreviated "Electric tank heater active". Its inspector renders the raw BSH bit as
   **ON/OFF**, not the ambiguous `1`/`0`. X10A carries no dedicated BSH-power register; while BSH is
   active, the inspector adds an estimated **whole-unit** electrical input only if live CT-clamp
   currents are available, and labels it as a total rather than claiming it as heater power. Pump
   and defrost were already drawn (rotation + "PUMP n%", the ❄ pill + the reversed refrigerant loop).
   This presentation applies to every converter-300..307 bit row in both the value cards and
   schematic inspector: `/values` retains the shared numeric `1`/`0` value and adds the structural
   marker `binary:true`. The browser's final display boundary renders ordinary activity flags as
   **ON/OFF**. A second optional structural marker, `binary_semantic`, names the exceptional selector
   bits: the 3-way valve becomes **Space heating/DHW**, while the optional 2-way/shut-off-valve
   output remains **OFF/ON** (it is separate from the configured/current mode, so OFF is not proof of
   Cooling), and the two Smart-Grid contacts additionally form one four-state **Free running/Forced off/Recommended
   on/Forced on** row. This metadata changes presentation only; API, MQTT, history and HA remain
   numeric `0`/`1`. Labels and numeric magnitude are deliberately not used for type inference —
   several binary rows do not say "ON/OFF", while ordinary counters and stages can legitimately
   read zero or one. BSH remains ON/OFF because its catalog does not establish a different bit
   polarity. At that same display boundary, the browser removes
   trailing catalog value legends such as `ON/OFF` and `On:…_Off:…` from visible reading names:
   `Space heating Operation ON/OFF` therefore reads `Space heating Operation` beside its **ON/OFF**
   value. The exact catalog label remains the identity used by `/values`, MQTT, history,
   selectors and description matching. Five labels occur on more than one X10A page; those rows
   additionally carry the sparse `x10a_group` marker from the MQTT page namespace. The visual
   boundary prefixes only those names (for example `Outdoor State Error Code` and
   `Hydronic Error Code`) and scopes their accordion keys the same way. Both measurements remain
   visible, while no duplicate label and no shared open/closed state remains.
   The system-wide **BOOST pill is permanent for the same reason**. Its face always says only BOOST:
   mode 2 (Recommended on) changes border/fill/text from light grey to petrol; every other or unknown
   mode stays light grey. The inspector and accessible name retain the exact manufacturer state. Its
   timeline shows the complete four-state Smart-Grid enum — Free running, Forced off, Recommended on
   and Forced on — rather than collapsing modes 0, 1 and 3 into one visually identical "Boost off"
   phase. Only Recommended on contributes to the separate sampled Boost-duration total. It
   stays separate from the tank branch because the request is not proof that the controller has
   started a DHW charge.
   **Its two sources are ranked the opposite way round to every other paired state**, and that is
   deliberate rather than an oversight. The others have one physical subject both buses report, so
   `stateOf()`'s "X10A leads, a live gateway answers otherwise" is safe. These are two different
   subjects: HomeHub holding `56` is the request an energy manager *wrote*, while the X10A pair is
   the physical SG-Ready terminal input (`docs/REGISTERS.md` `0x60`/11 bits 1–2, in a byte of
   external inputs beside the flow switch, the tariff contact and the solar input). An installation
   driven over the network leaves those contacts unwired and reading `00` — a current, plausible
   *Free running* — so a live HomeHub always outranks them, and the contacts answer only where no
   gateway does. That case is a plant with no HomeHub at all, where the firmware already decodes and
   lists the contacts and the pill used to blank beside them. Whichever instrument answers, the
   inspector title, explainer and 24-hour lane name **that** one; with nothing to attribute, they
   describe the instrument the installation actually has, never a gateway it does not contain. The
   pill's face is unchanged either way — on a gateway-less plant every reading is X10A, so marking
   this one would be noise, and provenance belongs in the inspector regardless.
   **The schematic never hides.** When the X10A link drops, retained X10A values are never left on
   screen: animations stop, the 3-way-valve label falls back to a bare "3WV" unless the independent
   HomeHub can state its position, and every reading neither source can currently supply blanks to
   "—". A live HomeHub may stand in only for the six quantities structurally paired by
   `logic/homehub_map.hpp`; those pills turn petrol so the replacement source is visible, and the
   inspector names the exact Modbus row. Nothing on this screen is hidden by a dead bus, and nothing
   from its retained cache is presented as current.
   **A sleeping outdoor unit is a related per-reading case.** The
   outdoor unit refreshes its own register pages only while it *runs*; stopped, it keeps answering
   with the last run's values (`logic/ou_stale.hpp`, host-tested against the whole catalog) — measured
   on a live unit, outdoor air held exactly 19.0 °C for five hours, stepped when the compressor
   started, then sat at exactly 25.5 °C for three hours. Those **X10A** values are therefore never
   reported as current. Discharge temperature still blanks to "—"; outdoor air does too when no
   second source exists, but the successfully polled HomeHub outdoor-air register may stand in because
   it can continue changing while X10A rests. The replacement is petrol, not a dimmed X10A value, and its inspector
   headline/source line resolve to the HomeHub row. What the pill cannot say, the outdoor-unit
   inspector does: it names either the Modbus substitution or the reason no current X10A reading
   exists. A successful Modbus read proves transport freshness only: the register carries no source
   timestamp, so the inspector says that the underlying measurement age remains unknown.
   ΔT blanks for a related but distinct reason: with the pump off and flow zero, the difference
   between two *stagnant* sensors is not a stale working point, it is not a working point at all.
   The **thermal-capacity pill also requires a running compressor and a ΔT in the selected mode's
   useful direction**. This is stricter than arithmetic: pump-only circulation can carry 57 °C
   residual water after DHW while the controller already reports Cooling, but flow × ΔT is then
   neither heat-pump heat output nor cooling capacity. With active heating/DHW the accepted sign is
   R1T−R4T > 0; with active cooling it is R1T−R4T < 0 and the displayed capacity is its positive
   magnitude. A missing/stagnant ΔT, stopped compressor, unknown mode or opposite sign blanks the
   capacity and COP/EER to "—" instead of giving a well-formed name to an unsupported quantity. The
   inspector names pump-only residual-temperature equalisation explicitly. In the 57 °C Cooling
   case the status therefore reads **Cooling mode / residual-heat circulation — no cooling output**,
   the emitter box remains the generic **space circuit**, and the moving water paths are neutral grey.
   The valve and measured flow still show the hydraulic route toward the space branch; hiding that
   would discard a real controller state, while calling the branch Cooling would invent active heat
   removal. The **24-hour curve is deliberately not
   gated**: there a flat zero is the honest shape of a day that delivered nothing, while a gap would
   be indistinguishable from missing data — the live pill and the curve answer different questions.
   The **electrical input** is the same whenever it is falling back to the
   inverter current (a `0x21` row that freezes too): a stopped compressor is not drawing the 1.4 kW
   the held current implies, it is drawing ~0. It simply blanks, like every other held pill — the one
   vocabulary above applies here too, and the inspector names the reason when the pill is tapped.
   The pill carries no caption in either case (§5.3 item 3: the drawing states no annotations at
   all), but the *distinction* still has to be drawn where it is stated: the pel explainer answers
   "held over from the last run" and "this profile has no current row" with two different sentences,
   because collapsing the first into the second would stand a second wrong claim — one about the
   hardware — in front of the one just suppressed.
   The CT-clamp path is unaffected: those sit on a live
   hydronic page, so a non-zero reading at rest is genuine standby draw and is shown normally.
   The run state itself is never affected — the compressor witness (`INV frequency`) sits on a page
   that stays live in every profile, which is what makes "Standby — not running" trustworthy beside
   blanked pills.
2. **System schematic** — the body of that card, drawing a simplified air-source **split-system**
   hydraulic + refrigerant circuit as an inline SVG: outdoor unit (fan + compressor with rps),
   refrigerant lines (gas + liquid — the
   lower one is the **liquid** line, not a suction line: the expansion valve sits in the outdoor unit
   at its far end), plate heat exchanger, supply line through the backup heater **and then the
   circulation pump** to the 3-way valve, DHW tank or thermal store, mode-aware space circuit, and the return
   line. It explains the readings' functional relationship; it is not a model-specific piping plan.
   Monobloc, ground-source, hybrid and alternative store arrangements have different physical
   topologies, and their inspector text must say so wherever the pictured split layout matters.
   The two ROTATING parts — the outdoor fan and the pump's impeller — turn only while their part
   runs, and that is all they claim. The header is a static product mark and deliberately does not
   imply a live run state. Neither rotating schematic part carries a direction mark: a triangle in a pump circle
   IS the direction symbol, so the rotating one the drawing used to have pointed against the flow for
   half of every turn. Direction is the **pipes'** job — the flow dashes animate in the flow
   direction, everywhere, and only while there is flow. The pump's eight vanes turn
   **clockwise**; the outdoor fan keeps its own clockwise animation. Both rotors are drawn so their
   bounding box is centred on the hub (an even
   blade count, or the ring drawn inside the rotating group), because the CSS pivots on that box and
   anything else orbits its own axle.
   The component **order is the manufacturer's** (installer reference §16.2: exchanger → R1T →
   backup heater → pump → R2T → outlet, then the field-supplied 3-way valve), not a drawing
   convenience — the pump is on the **supply** side, and drawing it in the return misplaced a real
   part. For the same reason the **tank and the space circuit are on one level**, side by side
   below the 3-way valve, in the same box: they are not two stages of a flow but the two loads that
   valve alternates between, and drawing one of them above the supply line put a choice on two
   levels for no physical reason. Each box carries **its own reading and setpoint inside it** — tank
   temp for the one, room temp for the other, since the room is the controlled variable of that
   circuit — with the reading's own name kept on it ("Raum 20.0 °C", never a bare "20.0 °C" under a
   HEATING label, which would read as a water temperature). What stays *outside* the box is the
   **space heating/cooling operation** state, on the riser above it. It is drawn from
   *"Space heating Operation ON/OFF"* (`0x62/2` bit 3), but the catalog's legacy name must not turn
   it into a heating demand: the state can be ON in Cooling while thermostat and compressor are OFF.
   It remains deliberately **not** *"Thermostat ON/OFF"*,
   which it drew until #199. That row is `0x60/2` bit 3, a bit in the **indoor unit's** status byte
   beside the I/U operation mode: Daikin's thermo-ON, which a hot-water charge raises exactly as
   readily as a call for heat. Measured on a live unit over three days it was ON 128/119/91 min per
   day and *none* of those minutes had the 3-way valve on space heating. Nothing about the value was
   wrong — only what the drawing said it meant, which is the one defect class §5.3 exists to prevent
   and the reason the pill's row is pinned to its page by a catalog test. It is still published, and
   the inspector now carries it under **Operating mode**, where that status byte belongs.
   Value pills sit at their physical measuring
   points (outdoor temp, high/low pressure, discharge temp, EEV pulses, PHE water outlet/inlet, ΔT, the
   estimated mode-aware **heating/cooling capacity and COP/EER** at the PHE, the estimated **electrical input** on the outdoor
   unit where the power goes in, flow, water pressure, pump %, tank temp/setpoint, room
   temp/setpoint).
   **One pill, one reading.** Two readings sharing a pill ("28.4 bar · 71.2 °C") made one tap target
   out of two sensors, and left a "·" carrying the claim that they are separate quantities. Split
   pills sit stacked in one column on the run they describe — still visibly a pair, but each with its
   own explainer, whose headline and source line resolve from its own row: a shared entry answered a
   tap on the temperature with a pressure and named the wrong sensor under it, in the panel whose
   whole job is to say where a number came from. A pill therefore holds a second figure only when
   that figure is the SAME quantity (a reading and its setpoint).
   A pill's name sub-label is **required wherever its unit repeats** across the drawing: three pills
   read "bar" and only one of them is water, so position alone would have to carry the difference
   between a sealed heating circuit at 1.8 bar and a refrigerant circuit at 28.4 — and position is a
   weak tell for readings whose same-unit neighbours sit two components away. Naming those is
   attribution, not the commentary §5.3 keeps out of the picture.
   **There is no tile row under the diagram**: the working point belongs at the
   parts it describes — the figures that exist *across the exchanger* (signed R1T−R4T ΔT, the
   mode-qualified flow × ΔT capacity, and COP/EER from it) are drawn **on the plate itself**. They are
   shown only with a running compressor and a temperature difference in the useful direction:
   positive R1T−R4T for heating/DHW, negative for cooling. Pump-only circulation can redistribute
   residual heat and therefore never earns a capacity or efficiency value or a HEATING/COOLING field-
   circuit label. R1T/R4T are internal PHE
   sensors; neither is asserted to be the temperature at downstream room emitters. The electrical
   figure remains on the outdoor unit, where the power actually goes in.
   **The drawing carries readings, not annotations.** Nothing in it explains, qualifies or sources a
   value: the ΔT's target setpoint, the word "estimated", and which current the electrical figure
   came from (CT clamps see the whole unit, the inverter current only the compressor — which is why
   an INV-based COP flatters whenever the backup heater is firing) are all in the **inspector**, one
   tap away, where a sentence fits and a caption never did. A sub-label under a pill is therefore
   only ever the measurement's own NAME ("PHE-Aus" for the pre-BUH leaving water, "return") — that
   is attribution, without which the number above it is unowned, not commentary on it. A name terse
   enough to fit the pill may defer its disambiguating qualifier to the inspector: the pill reads
   "PHE-Aus", while the inspector's full title "PHE-Wasseraustritt · vor BUH · R1T" is what separates
   it from the post-BUH R2T.
   The one exception is the **"≈"** on the two derived pills: it is part of the reading rather than a
   note about it, and without it a bare "4.6 kW" reads as measured whenever the inspector is closed.
   Both are *derived*, never measured — thermal from flow × ΔT (≈4.186 kJ/kg·K, assuming water;
   glycol mixtures have different density and heat capacity), electrical from current at an assumed
   230 V. The X10A rows used by this view expose no direct live power measurement, so the inspector
   entries are titled "(estimated)" and open on saying so; a derived number must never read as a
   measured one.
   COP/EER and capacity stay visible but show "—" unless the compressor is actually running and the
   mode, flow, ΔT and transfer direction support the figure. Hiding both pills at idle made a supported
   profile look as though it lacked the figures entirely; a placeholder preserves the component while
   refusing the unsupported working point. The electrical pill obeys the
   held-over rule below on its INV source only: the CT clamps sit on a page the unit keeps
   refreshing (a non-zero reading at rest is genuine standby draw and is shown), while the inverter
   current freezes with the rest of the outdoor unit's pages — so with the compressor off the INV
   fallback is suppressed and the pill simply blanks: the drawing has one vocabulary for "no reading
   right now" and the *reason* is the explainer's job (tapping the pill says the compressor is off
   and the inverter current is left over from the last run). That reason must stay distinct from
   "this profile has no current row" — suppressing one wrong claim must not stand a *second* one in
   front of it, and that one is a claim about the hardware. Inside the PHE, the refrigerant and
   water circuits use the same right-angled zigzag mirrored across the plate centreline, with the
   animation running in opposite directions: refrigerant from the upper gas connection to the lower
   liquid connection, water from the lower return connection to the upper supply connection. Those
   internal channels paint behind the opaque ΔT/capacity/COP pills and stay deliberately subdued
   (20% neutral line, 35% active dashes), so they explain the exchanger without competing with its
   readings. **The pipes animate in flow
   direction** while the pump runs. Thermal colour is mode-aware: heating/DHW uses hot outlet and cold
   inlet; active cooling uses cold outlet and warm inlet; pump-only circulation is neutral because it
   may be moving residual DHW heat. The 3-way valve switches the animated branch (space circuit ↔ tank coil);
   cooling and defrost reverse the refrigerant animation, defrost additionally shows a
   `--flow-cold` "❄ defrost" pill, and an active BUH
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
   elements. Opening a target preserves the page's current scroll position: the inspector may extend
   below the viewport, but it must never pull the drawing out of sight. Tapping the same target again,
   ✕, or Escape closes the panel.
   **A junction ends every claim.** Where a shared run parts into branches, all three ways the
   drawing speaks about a pipe stop at the same point: the animated flow overlay, the hit target that
   highlights and opens it, and the readings drawn beside it. One overlay across the junction
   animates a branch nothing is flowing through; one hit target across it selects a branch its
   inspector does not describe, and silently leaves the other one out; a reading past it names the
   wrong circuit. Consequently **every branch owns both its legs** and the shared group owns only
   what is shared — and every drawn pipe belongs to some hit target, since a stretch that belongs to
   none cannot be hovered at all and reads as the neighbouring selection simply stopping. The gate
   checks all four (`E002`/`E003`/`E004`/`S011`); which pipe is a branch and which is shared it
   cannot know, and that is the judgement half's question.
   **And a run's tap area ends where the fitting begins.** A 5 px pipe is not tappable, so each run
   carries an invisible fat hit line — which means the clickable drawing is *wider* than the drawn
   one, in geometry that exists only in the stylesheet. Wherever that widening covers a component
   drawn earlier, the component keeps its outline on hover and loses the tap: the picture highlights
   the 3-way valve and opens the DHW branch. It shipped exactly so, because `stroke-linecap: round`
   adds half a stroke *past* every endpoint and each trim had been computed as if the cap were flat —
   the valve lost a fifth of its disc, and the same 9 px came out of the outdoor unit and the plate.
   **A component owns every tap inside its own shape**, and the pipe owns everything past its edge,
   with no dead strip between; `G011` re-derives each cap from the real CSS and fails the build on an
   overhang. It says nothing about two *pipes* meeting at a junction — that place is genuinely
   shared, and `E004` is what decides whose it is.
3. **Inspector** — the inset tongue attached directly below the drawing card, so the explanation and
   the thing it explains are on screen together without covering or extending the white picture.
   It uses the same tinted, bottom-rounded, top-shadowed treatment **and the same clipped 220 ms
   pull-out transition** as the other explainer tongues: the track grows from `0fr` to `1fr` while
   the body moves down 7 px from under the drawing. It stays mounted but inert while collapsed;
   toggling `hidden` would paint the complete infobox immediately instead of revealing it with the
   shared motion.
   Idle it shows **nothing** and collapses — the picture's
   clickability is carried by the hit targets themselves (hover/press feedback, `role="button"`,
   the SVG's own `aria-label`), and a standing line of instructional copy under an otherwise quiet
   dashboard is exactly the decorative copy §1.4 rules out. Selected it shows:
   a **title** (the concept in the UI language, e.g. "Leaving water"), the **headline reading** for
   that target (its `/values` row, or the derived figure for ΔT / heat output — an assembly like the
   outdoor unit has no single number and gets no headline rather than a "—" that would read as a
   missing value), the **source row label** in mono (the verbatim English register name, so a number
   in the picture can be traced to the value list in item 6), a live **state sentence** in bold for
   components ("Running — compressor at 62 rps.", "Paused — the valve is feeding the hot-water tank
   right now."), the **explainer** (what it is, and `Normal:` guidance where useful), the optional
   **trend**, and the **member readings** of that component as a compact label→value list. Those are
   three distinct vertical sections: description first, graphical history second, values last.
   For a leaf value target, that list omits the target's own X10A reading because it is already the
   headline, but keeps an available Modbus twin as its first divided value row, with the agreement or
   difference directly underneath that row while both readings are current. A grouped target keeps
   its complete value list even when one member is also the headline: the DHW tank therefore lists
   X10A tank temperature, its Modbus
   twin, setpoint and both valve readings together below the chart. An inspector's explainer contains
   explanation only, never a specially placed value line or a sentence that merely repeats those
   numbers. Component targets without a headline likewise keep their complete member list.
   The explainer copy comes from the **same `DESCRIPTIONS` table** the value rows use (§5.3 item 6) —
   one source for "what does this mean", never a second parallel one. A value target resolves it
   through a canonical register label rather than the live one, so a profile's own spelling cannot
   drift onto a neighbouring entry. Component copy (outdoor unit, PHE, ΔT, heat output, heating
   circuit) has no equivalent in `DESCRIPTIONS` — nothing there describes an assembly or a derived
   figure — and lives in the inspector's own table, bilingual in the same `{en, de}` shape.
   **The inspector follows the source the drawing chose, and says why when none can answer.** A stale
   X10A reading the pill withheld — a held-over outdoor-unit row while the compressor rests
   (`logic/ou_stale.hpp`) — must not come back as the headline, as a member reading, or inside a state
   sentence. When a structurally paired live Modbus reading stands in, it becomes the petrol headline
   under the HomeHub register name; otherwise the headline remains "—" and the panel explains why.
   The held-over gate is **structural**, on the X10A row's `/values` register page rather than its
   label, so it covers every profile's spelling. ΔT with no water moving has no second-source
   exception and remains blank for the same one-answer rule: the panel is *below the pill it explains*
   and cannot put back a number the picture just refused to state.
   **An explainer reads permanent-first: what the value IS, then what it is doing.** Every paragraph
   of the body is its own block (`.vdesc-p`), in this order — the "what is it" sentence, the timeless
   "Normal:" note, then the LIVE sentence: either the entry's own state prose or, when the reading is
   held over, the reason it is blank ("No current reading: …", in the "Normal:" shape with a lead-in
   in stronger ink). All of it in the body's own ink. The live sentence used to open the card in
   **bold**, which inverted the panel: a reader taps an explainer *because* they do not know what the
   quantity means, and three bold lines about a transient state stood in front of the answer they
   came for. Prominence follows how long a fact stays true, not how recently it changed — the pill
   above already carries the live number, and the state sentence is the caption the drawing refuses
   to print (item 3), not the headline of the explanation.
   For the same reason a pill drawn from a *fallback* source names that source: the high-side pill
   falls back from the frozen HP transducer to the always-live refrigerant sensor, so the headline and
   the mono source line resolve the same row the pill did, never the register the concept is named for.
   The panel re-renders every poll so an open explainer follows the live values, but only when what
   it draws actually changed — an unconditional rebuild would collapse a text selection mid-read.
   Nothing in this section hides when the X10A link drops (§8): the schematic and its inspector stay;
   live paired HomeHub readings remain visible in petrol and everything neither source can answer
   blanks to "—" (item 1), because the card also carries the status block that says why.
   **There is no trend/history CARD** — but a trended row carries a 24-hour sparkline in its value-row
   explainer (§6) *and* here, under this inspector's explainer text. The original rule refused history
   outright, on the premise that "the firmware stores no history and a browser-side ring buffer is
   lost on every reload". The first half of that premise no longer holds: the firmware keeps a
   fixed-cadence ring per trended row (`logic/history.hpp`, served by `GET /history`), so the series
   survives a page reload and a second browser. The second half still decides the *shape* of the
   feature — long-term analysis belongs to Home Assistant/Grafana, which hold the real series across
   reboots and years. So: no card, no dashboard-level charting, no range picker. One sparkline, in the
   panel of the row it belongs to, for a day at a 5-minute raster.
   **Every numeric trend uses one visual grammar:** a light filled area with a darker line exactly on
   its upper edge. Two-source comparisons, ENV III's three local-scale measurements and the three
   forecast continuations keep that same construction with reduced opacity, so overlaps stay visible
   instead of becoming an opaque new chart type. Gaps still split both area and line; a lone sample
   remains a dot because it has no measured interval to fill. Categorical component histories remain
   labelled state tracks rather than being misrepresented as numeric areas.
   **In the inspector it is the same chart, for the reading the pill RESOLVED.** For an unpaired
   same-stack fallback, the exact X10A row still decides it: while the high side reads the
   refrigerant sensor instead of the frozen HP transducer, the headline, mono source line and chart
   are that one row. The eight structurally paired schematic measurements are different: their X10A
   and HomeHub rings are two instruments for one concept, so the chart draws both on one time/value
   scale, names them with a blue `X10A` and petrol `HomeHub · Modbus` legend, and reads both values at
   the same cursor instant. If X10A has no sample, its line has a gap while the petrol Modbus line may
   continue; if the profile/link has no current X10A row, the Modbus ring can stand alone. It never
   revives a retained X10A value beneath a petrol headline. An ASSEMBLY (the outdoor unit, the PHE)
   still gets **no** chart, for the same reason it gets no headline — there is no one reading it
   stands for.
   **A COMPUTED pill charts its own figure, never one of its inputs.** Pump speed (the inverse of the
   raw `0=max, 100=stop` signal), ΔT, heat output, electrical input and COP have no directly matching
   displayed register value, so the firmware buffers what each is computed FROM and the curve
   is assembled in the browser (`DERIVED` in `www/js/history.js`) by the same expressions `liveData()` uses
   for the live number — one definition of each figure, rather than a firmware copy and a browser
   copy free to drift. Drawing the flow rate under a heat-output headline would be the §5.3-item-3
   substitution with a 24-hour axis in front of it, and that is precisely what is not done here: the
   series carries the figure's own unit and its own gaps. Two properties fall out of composing rings
   rather than re-deriving from `/values`: a sample is null wherever any input is, so a gap stays a
   gap; and it is marked *resting* only when EVERY missing input was — one input that genuinely
   failed to measure outranks "nothing failed", since that is the stronger claim.
   The COP is the one that is deliberately drawn on fewer samples than its own inputs. A CT-sourced
   sample is left out entirely: `cop_scope.hpp`'s live boundary can move to post-BUH R2T when the
   resistive heater fires, and R2T now has its own curve, but BSH heat crosses neither water sensor.
   The derived COP deliberately retains the conservative single-boundary rule rather than splicing
   a whole-plant quotient from five-minute last-sample rings whose heater and temperature events may
   have occurred at different instants within the bucket.
   An inverter-sourced sample needs no such evidence (both heaters sit outside both sides), which is
   why that is the branch that survives. Refusing the other is the same answer the live pill gives
   when it cannot pair the boundaries, not a relaxation of it.
   Two consequences are stated rather than left to be discovered. **A chart is named by the target's
   stable concept, never by its live title**: the COP's title says which *system* the present
   quotient describes, and a 24-hour curve cannot be named after the state of one second — it would
   have read "COP of the plant" over a series that is, by construction, the heat pump's own. And **a
   figure withheld on purpose says so in its own words**: on a CT-clamp install every COP sample is
   refused, so the generic "no readings recorded yet" would call a deliberate refusal an empty
   buffer — one line under a pill that is showing the very number. A derived series may therefore
   name its own empty case, and the COP does.
   **A chart never gets a blanked X10A number back.** During outdoor-unit rest the X10A outdoor-air
   series is held-over for exactly those samples, so its blue curve has a gap and its scrub value says
   "Outdoor unit idle". The independently polled HomeHub register may draw a petrol value at that
   same instant — explicitly under its own source name, never as a repaired X10A value. Its hover
   popup names how long the observed register plateau lasts and that measurement age is unknown. If
   neither source measured, no marker appears. Anything that clamps or interpolates the last known
   X10A sample into the live end remains the §5.3-item-3 substitution failure with a 24-hour axis in
   front of it.
   **Which rows are trended is decided by this drawing.** Every numeric value the schematic shows has
   a curve — pre- and post-BUH leaving water, return water, tank, water pressure, flow, pump signal,
   refrigerant pressure and liquid temperature, compressor rps, expansion valve, outdoor air,
   outdoor-coil and discharge temperatures, room temperature, and the five computed
   pills above — because those are the readings someone is actually looking at. That rule is also
   what keeps the cost small: the drawing holds about twenty numeric pills, while a profile publishes ~66
   numeric rows, and ringing all of them would cost ~38 KB of `.bss` — about a third of the low-water
   free heap measured on the reference board — for curves nobody opened. A value row reached through
   the LIST (§6) gets a chart where a trend already exists and none where it does not.
   HomeHub adds twelve second rings: pre- and post-BUH leaving water, return water, DHW tank, outdoor
   air, liquid refrigerant, flow and room temperature are the eight measurement concepts both sources
   structurally pair; BSH, the 3-way valve and Quiet are exact state pairs, and the twelfth ring is the
   explicit Smart-Grid-mode timeline. Every categorical timeline uses the same
   grammar: one outlined track per available source, a separate labelled colour for every valid
   state, and hatching only for missing samples. Hover, touch pinning and keyboard navigation show a
   compact popup with source, state, phase start/end and sampled duration; those details are not
   repeated as a long list below the chart. Source outline and state fill are separate visual channels, so
   X10A/HomeHub disagreement remains visible without changing what a state colour means. The valve
   therefore paints and lists both destinations instead of treating Raumkreis as an unlabeled empty
   background; Smart Grid does the same for all four manufacturer modes; binary timelines explicitly
   name both inactive and active phases. The valve names both destinations and reports
   sampled time on the DHW and space-circuit branches; its latest observed position wins each bucket.
   Quiet retains the latest sampled mode in each bucket. BSH uses event folding: once ON is observed it remains ON for that open five-minute bucket, so a
   later OFF cannot erase the event. BUH applies the same rule independently to its converter-
   qualified Step1 and Step2 bits; the browser combines the aligned rings into one component-level
   timeline with written Aus/Stufe 1/Stufe 2 states and distinct stage colours. Defrost is likewise
   event-folded into its X10A-only state timeline. The UI calls each
   sum sampled raster time, not exact runtime; a pulse entirely between poll sweeps can still be
   missed. Other setpoints, states and Modbus-only readings do not acquire a curve by resemblance of
   their labels.
   The one numeric pill with no chart is the **low-pressure** one, and it is the same honest answer
   as the high-side pill on the *other* leg of its fallback: both are the `0x20` transducer pair,
   which freezes with its page and, on the reference install, has published a flat 0.0 bar from both
   sensors for 30 days. There is no low-side equivalent of the `0x62/15` fallback, so the choice is
   an empty chart or none, and none is the one that does not look like a broken sensor. Four rules the chart inherits from the rest of this document:
   - **Every source uses one boot-aligned raster.** The 288 five-minute slots retain exactly 24 hours
     in RAM (persisting them would be ~100k NVS writes a year in the partition holding the WiFi
     credentials). Before one day of uptime every chart therefore shows the same growing span, for
     example "Aufzeichnung · 11 h". A row that resolves late, a HomeHub enabled later, or an explicit
     source-identity change keeps those elapsed slots as visible gaps instead of shortening only its
     own axis or mixing readings from two devices. After 24 hours every chart is a rolling day.
   - **A gap breaks the line.** A timed-out register or a value `reading_plausible()` refused is
     drawn as a gap, never interpolated across — the same refusal the blanked pills make (item 3).
   - **Idle is not a gap.** On the outdoor pages (0x20/0x21) a sample taken while the compressor
     rests is stored as *held over*, not as the number the bus keeps returning, and the readout says
     "Outdoor unit idle" rather than "not measured". Without that, a mild day's outdoor-air trend
     is a staircase of last-run values that reads exactly like weather.
   - **A tap PINS the readout; hover only previews it.** Reading a value must not require holding a
     finger on the glass — a tap fixes the crosshair and its bubble at that sample and they stay
     there, marked as persistent (solid line, `--brand` bubble border) so a held reading is never
     mistaken for the live one. Tapping elsewhere moves the pin, tapping the same sample clears it,
     `Esc` clears it, and collapsing the panel clears it. A mouse hover still previews transiently and
     leaves the pin untouched — the two cursors share their look and their geometry but *not* their
     element lookup, because they coexist in the DOM.
     The pin lives in app state and is anchored to the sample's **instant**, never its index: the ring
     shifts a slot every 5 minutes, so an index anchor would keep the bubble on slot 42 while slot 42
     became a different measurement — the §5.3-item-3 substitution failure with a timestamp attached
     to make it look verified. When the pinned instant rolls off the back of the day the pin is
     **dropped, not clamped** to the oldest sample: clamping would keep a readout on screen while
     silently changing which moment it describes. The resolution rule is host-tested
     (`logic/history.hpp`'s `history_pin_index`) for the same reason the other browser rules are.
     The pin is keyed by the ROW, not by the chart, so the same row open in both places (a pill in the
     picture and its line in the value list) shows one pinned moment in both — two copies of a chart
     disagreeing about which sample is pinned would be the same substitution failure the anchor rule
     exists to prevent. Both charts are frozen while either is being scrubbed, and both resume
     together: a resume that refreshed only one would leave the other showing a pin the user has since
     moved. Closing the *inspector* therefore leaves the pin alone — it belongs to the row, which may
     still be open in the value list — while collapsing a value row's own panel clears it, as before.
   - **The readout stays one shape at both ends of the chart.** The newest sample sits at the right
     edge and is where a reader looks first, so the bubble must be as legible there as in the middle.
     It is not automatic: an absolutely positioned box carrying only `left` is shrink-to-fit against
     `container − left`, so at the last sample the space it may lay out in collapses and the text
     wraps to its minimum-content width — shipped, "08:23 · X10A 46.3 °C · Modbus 46.3 °C" became a
     59 px column of seven lines hanging down over the very curve it was reading. Its width is
     therefore decoupled from its position, and its anchor SLIDES from the bubble's own left edge at
     the oldest sample to its right edge at the newest (`--tip-p`, `.vhist-tip`). Sliding rather than
     centre-and-clamp is what makes it exact rather than tuned: the bubble travels `[0, C−W]` at any
     panel width, so it can never leave the card and the crosshair always falls inside the bubble
     that belongs to it — neither of which a percentage cut-off ("anchor left below 24 %") can
     promise once a narrow panel makes the bubble nearly as wide as the chart.
4. **Model card** — styled exactly like the value groups (§6), full-width below the live section:
   the model name (full-width heading) + detected capacity, from `detect{capacity_kw,
   capacity_kw_iu, model}`. Both are bus-derived, so they show **only while the link is live**
   (`hp.connected`): offline the name degrades to the brand "Daikin Altherma" and the capacity is
   hidden — never a cached fingerprint read as live. There is **no** "Detection: auto/manual" row
   (fully automatic).
   **Capacity names its unit.** Many units never report an outdoor capacity at all (a short `0x00`
   descriptor), and the card then showed *no* capacity while the device knew the indoor unit's rated
   code the whole time. So the row falls back to `capacity_kw_iu` under its own label — "Capacity
   (indoor unit)" — rather than filling the same row silently: the two halves of a plant are
   routinely different sizes (a 6 kW outdoor unit under an 8 kW indoor unit is an ordinary pairing),
   so an unlabelled fallback would state a figure for the wrong unit. Same rule as §8's blanking —
   a reading is shown with what it actually is, or not at all.
   **The brand heading explains itself.** "Daikin Altherma" is shown whenever detection cannot name
   one model, and on its own that reads like a *failure* — the complaint it produced was "why is my
   model not recognised?" when detection had in fact succeeded as far as the bus permits. So when the
   name is withheld (`families.length > 1`) the card names the families still in play — "3 M · 3 H ·
   3 R · LT / older", the shared "Altherma " prefix dropped so four fit one row — and, whenever the
   fingerprint is valid, the **outdoor unit ID** (`ou_eeprom`) verbatim in mono. Those digits are the
   one identifier that can settle it, and only a person holding the nameplate can: the firmware has
   no digit→name table and must not invent one. A *unique* identification shows neither row — it
   needs no list of what it isn't.
   **And every row on this card explains itself** (same expander as item 6). The two rows above exist
   *because* an ambiguous detection needs explaining, but on their own they state the fact and never
   the reason — a generic brand name over a list of models it might be is also exactly what a failed
   detection would look like. So tapping a row says why the indoor unit's figure is labelled as such,
   why no single model name can be asserted (several families are register-identical, so it affects
   no reading), and what the ID digits are for. The copy is a **separate table** (`MODEL_DESCRIPTIONS`,
   keyed by row id) rather than `DESCRIPTIONS`: these labels are *translated*, so an English label
   pattern would silently stop matching on a German page, and they are not catalog labels — see
   item 6.
   The **ESP32** card that used to sit above it is in Settings now (§5.6): this card is the *unit*,
   that one is the *board*.
5. **Plant-diagnostics card** — "Anlagendiagnose · 24 h" / "Plant diagnostics · 24 h", styled exactly like the Model card, directly
   below it and above the value groups **while the Firmware master opt-in is enabled**. It answers
   the third question the dashboard has, after *what
   is it doing now* (the system card) and *what did this one reading do today* (a value row's trend):
   **what did the on-board inputs establish, and was anything worth following up?** It is deliberately not
   a health certificate for the plant. X10A cannot establish refrigerant charge, sensor calibration,
   hydraulic cleanliness, air path, mechanical condition or seasonal efficiency. Eight rows come
   from `/status.health`, in firmware reading order: unit fault, DHW tank heat loss, compressor starts, defrost cycles,
   lowest water pressure, lowest steady flow, BUH/BSH runtime and protection-retry changes.
   **Every row carries an evidence class in the API and explains it in its expander.** `device` is the unit's own fault state;
   `manufacturer` is the documented water-pressure boundary; `heuristic` marks DHW-loss/cycling/defrost
   patterns that can only be hints; `observation` is a measured fact with no universal judgement;
   and `experimental` marks retry-counter semantics that are not yet manufacturer-validated. The
   firmware classifies and supplies the evidence. The collapsed row shows only one of `OK`,
   `NOTE`, `WARNING`, `CHECKING`, `MEASURED ONLY`, `EXPERIMENTAL`, or `NOT AVAILABLE`.
   Its short expander carries the reading, assessment, evidence progress, basis and limits. Observation-only
   and experimental rows must never be promoted to `OK`. A threshold
   decided in `js/schematic.js` would be a second, ungated definition of the same rule.
   **The badge summarizes evidence, not plant health.** Its text distinguishes an active/device or
   documented-limit finding, a heuristic/experimental hint, incomplete collection and unavailable
   inputs from “no finding in the observed plant data”. It never says “healthy” or “all clear”.
   `available`, `assessable` and `evaluated` keep three different denominators visible:
   reportable rows, rows with a bounded judgement, and judgements whose evidence gate is complete.
   Thus four completed judgements read as `4/4 bewertet`; the broader count of reportable values is
   not a health score and is omitted from the headline. Flow/heater observations, count-only defrost and a stable
   experimental retry counter cannot manufacture a green summary; an actual retry increase may still
   raise `info`.
   **The window and each signal's evidence are stated in the expander, not crowded into every row.** Storage is 23 completed
   one-hour buckets plus the pending hour, so it never represents more than 24 hours; the trade-off
   is that it may contain slightly less than a day at a bucket boundary. `full_span` uses the actual
   first/latest monotonic samples rather than the number of crossed hour boundaries. The ring is
   RAM-only, so a reboot starts a new observation lifecycle; explicit X10A re-detection, profile
   selection or RX/TX-pin change also starts a new identity, while a HomeHub-only edit deliberately
   does not. A reset arriving during a sweep discards that sample, so the old link cannot seed the new
   window. Any check that concludes an *absence* of a pattern
   requires both `full_span` and at least 90% valid evidence for its own input; the direct current
   fault state and observation-only flow value instead expose their explicit eligibility target.
   Global poll uptime is never substituted for a missing compressor, pressure or heater row. Every row receives
   `observed_s` and `required_s`; “collecting” is therefore check-specific rather than one card-wide
   guess. Whole seconds are derived from absolute monotonic timestamps, so the serial sweep's
   fractional duration telescopes instead of being floored away on every interval; continuity gaps
   still use the exact microsecond delta. Event states are sampled once per completed sweep, not at a
   guaranteed 1 Hz, so a pulse entirely between sweeps remains outside the evidence.
   **A check the active profile cannot run says `NOT AVAILABLE`.** That is `unavailable`, not a permissive zero,
   and does not count as evaluated. Only 27 of 44 profiles carry a compressor-speed witness; defrost
   count remains observable without it, while the compressor-runtime share stays unavailable and
   cannot count as assessed. `paired_count` separately reports transitions with compressor evidence
   at both endpoints; only that count may satisfy the heuristic's three-cycle guard. Even with an RPS
   row, zero paired compressor runtime supplies no ratio denominator and therefore no defrost
   judgement. Those count-only cases carry `observation`, not `heuristic`, in the API and UI. BUH
   and BSH have separate capability and evidence clocks, so an absent BSH row renders as unknown,
   never “0 min”; observed seconds are carried separately so a real 1–59-second activation displays
   as `<1 min` instead of zero.
   **DHW heat loss uses clean one-hour R5T windows and an optional independent pump witness.** Tank
   charging, internal-pump/BSH operation, 45 minutes of settling and draw-like temperature steps are
   excluded. At least 0.8 K/h raises only `NOTE`; a green absence result needs a full 24-hour
   lifecycle plus six clean hours. Settings → **Plant diagnostics** configures the exact Shelly MQTT
   topic, `apower`/source-time JSON paths, maximum age, ON/OFF hysteresis and pulse-train-aware
   confirmation. The row
   distinguishes high loss during confirmed pump operation from high loss persisting after two hours
   of confirmed pump-off evidence. It never turns either correlation into proof of a diverter/check-
   valve or insulation defect: R5T is one point in a stratified tank, and draws/gravity circulation
   remain alternative causes.
   **Every row explains both the fact and its limit** (same expander and the same
   `MODEL_DESCRIPTIONS` table as item 4). Water pressure is the sole manufacturer-backed numeric
   decision: representative official manuals across monobloc, split, high-capacity, geothermal and
   hybrid Altherma families require circuit/pump-inlet pressure **above 1 bar** (linked in
   [ARCHITECTURE.md](ARCHITECTURE.md#the-host-tested-logic-core)). The displayed minimum is always the
   raw lowest valid sample: at or below 1.0 bar it raises `info` immediately, while only 60 continuous
   seconds raise `warn`. The confirmation changes warning strength, never the statistic. Cycling and
   defrost can raise `info` only as heuristics. Cycling separates complete runs into space heating,
   hot water and cooling when valve and indoor-unit mode evidence is sufficient; only confirmed
   space-heating runs are judged, while a sparse or mixed population falls back to the explicitly
   labelled pooled figure. X10A has no direct heat-demand signal for that fallback and neither
   humidity nor evaporator-surface temperature for the defrost assessment. Flow is sampled
   only after 60 seconds of continuous pump operation and remains observation-only because the
   required minimum is model-specific. BUH/BSH runtime is also observation-only because weather,
   defrost support, emergency mode, settings and PV operation change legitimate use. Protection
   retries are experimental and count only a strict increase of an individually identified 3-bit
   counter between continuous, fully comparable samples, including an increase first visible while
   stopped or at a compressor-state boundary. An absolute non-zero value is only a baseline; a
   decrease or possible reset/wrap interval proves neither an event nor the absence of one.
   Hidden entirely while the X10A link is down, like the Model card: a rolling observation presented
   beside a bus that is not answering reads as current when it is not.
6. **Value groups** (§6) as cards, each a label→value·unit table, tabular numbers; every value of the
   detected profile is shown. A value that timed out this cycle shows "—" (not 0). The schematic
   answers "what is happening"; these tables stay as the exact-value reference — both read the same
   `/values` dataset.
   - **A row that is no longer a MEASUREMENT blanks here too**, for both reasons: the X10A link is
     silent, or the outdoor unit has stopped refreshing that page (`logic/ou_stale.hpp`). Where the
     HomeHub carries the same quantity its reading *stands in*, marked as the other source; where it
     does not, the row shows "—". Being the exact-value reference is exactly why: this is the last
     place a value the unit is not measuring could still be read as current, and the pill above it,
     the inspector, the chart and MQTT all already refuse it. The device says so itself — `/values`
     carries `held` — so the tables key on that rather than re-deriving the page rule.
   - **Tap a value → plain-language explainer.** Each value row whose label is recognised is a button
     (trailing chevron affordance, like the ESP32 card's Hardware row); tapping it slides open a short description
     beneath the row — what the reading means and, where useful, what is normal vs worth a look. The
     text is keyed to the value **label** by a first-match-wins pattern table (`DESCRIPTIONS` in
     `js/descriptions.js`), the same label-pattern technique the schematic/grouping already use, so one entry serves
     every profile's spelling of a quantity; a label that matches nothing stays a plain row — unless
     the firmware keeps a **trend** for it, which opens the same panel on its own (below).
     **The schematic inspector (§5.3 item 3) reads this same table**, so a quantity is explained
     identically whether the user arrives from the picture or from the value list — add a concept
     once, here.
     **A missing explainer is a CI failure, not a quiet plain row.** Which rows are tappable is
     decided at render time, so a label nothing matches — and that the firmware keeps no trend for —
     produces no error and no log, just an absent chevron among a hundred rows, which is how
     `def/overlay.hpp` shipped eleven such rows. Since the
     profiles are machine-generated, the gap re-opens whenever the generator emits a label this table
     has never seen, so a gate asserts the two sides still line up
     (`scripts/run-description-audit.sh`, CONTRIBUTING.md). It gates *coverage*, not correctness: a
     wrong explainer is still a match, and two of those eleven rows had one — a protection flag read
     as a heat-sink temperature.
     **The Model card (item 4) uses the same expander but its own table** (`MODEL_DESCRIPTIONS`, keyed
     by row id). Those labels are translated and are not catalog labels, so they cannot be keyed by an
     English label pattern, and entries for them in `DESCRIPTIONS` would correctly read as *dead* to
     the coverage gate. The accordion markup itself is one shared builder, so the two row kinds cannot
     drift into two slightly different expanders, and Model-card keys are prefixed (`model:`) so they
     can never collide with a catalog label in the open-state set. Each entry carries an English `what`/`normal` plus a German `de` copy; the browser language
     (§1) picks which is shown (English fallback). The value label above the box stays the English
     register name in both languages.
     **A switched row's panel opens with HOW LONG IT HAS READ THAT** — the one live sentence in a
     panel whose explainer is otherwise the same copy on every device at every hour, which is why it
     goes first. Only the **state word** carries emphasis — the panel's existing `.vdesc-n` lead-in
     token, the one the "Normal:" note uses — because it is the sentence's subject; the age and its
     unobserved-time caveat after it are one uninterrupted qualifier in plain body text, so the eye
     cannot take the number and skip what bounds it. The state word is composed *outside* `t()`,
     which is why the keys carry only the predicate: markup inside a translated string is what
     `descNoteHtml` avoids, and it would force every future language to keep the subject first.
     "OFF" answers what a flag *is*,
     and for a flag that is half the question: `Powerful DHW Operation: OFF` describes a plant that
     finished a charge four seconds ago and one that has not charged since Tuesday equally well.
     Scoped to the bit flags and the fault class (`logic/state_dwell.hpp` decides which, structurally
     by converter) and deliberately not offered on measurements, where "time since the last change"
     is the poll period — a number that would read 1–3 s on ~50 rows and bury the ~34 where it means
     something. **The device states the claim and the browser only renders it**, and there are three
     of them because the number alone is not one: a run whose transition was never witnessed reads
     *"OFF ≥ 3 h 20 min"* — a weaker claim in a compact relation symbol that reads identically in both
     languages, never the same sentence as a measured run, and **floored**, since rounding a bound to
     the nearest minute would assert seconds nobody watched — and a run the bus did not answer
     for throughout names the unobserved part beside it, in `--muted` and never `--warn`, since a few
     missed sweeps is the ordinary state of this bus and colouring it as a fault teaches a reader to
     distrust a healthy plant. Where the device says nothing — a silent bus, a row unread past its
     gap bound — the line is **absent**, not zero: "0 s" reads as *just changed*. A **blanked** row
     (the rule above) states no age either, for the reason the inspector had to learn once already:
     an age under a "—" restates the very reading the row above just refused.
     The open state lives in app state
     (`S.descOpen`), not the DOM, so the per-poll rebuild of `#valueGroups` re-emits an expanded row
     open instead of collapsing it every second; the click toggles the live element so the slide
     animates, and updates the set for the next rebuild.
     Re-emitting an open state is not enough on its own, though, because **a click is not one
     event**: the browser fires it only if the node the pointer went *down* on is still in the tree
     when it comes *up*. A per-poll `innerHTML` write replaces that node, so a rebuild landing inside
     a click detaches it and **no click is fired at all** — the tap is lost silently and the row does
     not open. This is the failure the shared `setHtml()` write path already existed to prevent, by
     skipping the write when the markup is byte-identical; that check carries `#connTile` and
     `#settingsCards` on its own, because their rows are stable between pushes. It **cannot** carry
     the value grid: those rows are live readings, so the markup differs on almost every push and the
     check degrades to a plain write. Measured loss, sweeping every phase position against the ~1 s
     period: **~3 %** of taps at a 30 ms trackpad tap, **~12 %** at 120 ms, **~25 %** at 250 ms,
     **~60 %** at 600 ms — so a deliberate press reads as "the first click does nothing, the second or
     third works", while a fast tapper would barely see it.
     `setHtml()` therefore has a **second** guard: a `pointerdown` in any of the three containers
     suspends writing (`S.clickHold`), released by a timer alone and never by an event. Not by event,
     for two reasons — nothing can then leave it held, and the window extends *past* the click, since
     opening a trended row starts a fetch whose completion redraws ~80 ms later and would cut the
     220 ms open animation a third of the way through: a click that did register, looking like one
     that had not. Both halves of the race are older than the trends; §6's explainers made every
     reading tappable, which turned a latent race into the normal experience.
     A row's **24-hour trend** (§5.3 item 3) lives in the same panel, below the explainer text and
     separated by a rule — text first, then evidence. Scrubbing it is the one interaction that
     **suspends** the per-poll rebuild outright (`S.scrub`), because re-emitting the panel under an
     active pointer drops pointer capture and kills the gesture mid-drag. Re-emitting an open state
     is enough for the accordion; it is not enough for a drag. This is the dashboard's counterpart to
     the Settings cards' dropdown-focus guard (§5.6) and carries the same obligation: a suspended
     rebuild must be **impossible to leave suspended** — a `pointerdown` whose `pointerup` never
     arrives would otherwise freeze every value row indefinitely, which reads as a dead device with
     no error anywhere. `lostpointercapture` covers the normal exits including DOM removal, and a
     watchdog covers the rest. The row's own value stalls for the seconds the finger is down and
     catches up on release; that is the accepted cost, and the only one.

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
so the **Version** row on the Settings Firmware card (§5.6) runs the identical check. It is one
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

Because that slot is painted straight into the DOM rather than rebuilt from state, **all three
ESP32-family cards freeze together** while the readout has anything to say (`S.otaShown`, which
covers the terminal messages' linger too) — they are one `esp32CardHtml()` string, so there is no
freezing the Firmware card alone. Otherwise the once-a-second rebuild would blink the percentage out
and restart the spinner's animation on every frame — the same hazard the header's `#otaStat` is exempt
from re-render for. What holds still is three cards of static facts, for the seconds
an update takes; the Connections tile beside it keeps updating, since a link dropping mid-download
is exactly what a user would want to see move.

- **The status reports inline, in that same line** — a small progress ring plus a short label,
  immediately after the version (`#otaStat`): `192.168.1.42 · v1.2.3 ◔ 78%`. It is deliberately
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
  the Firmware card (§5.6), a two-option select: *Release* (cut by hand) or *Development* (every merge
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
  percentage; finding `idle` leaves the header untouched. `/status` is the largest HTTP allocation
  and may temporarily be refused while the OTA TLS task owns the scarce heap. In that window the
  successful OTA response is the stronger reachability evidence. The tab that starts installation
  stores its last complete `/status` + `/values` frame in a 15-minute `sessionStorage` entry. A
  same-tab reload restores that frame only when its version exactly matches `/ota/status.current`,
  keeps the complete dashboard and Settings visible, labels them as the **last received state**, and
  disables Settings writes until restart. A successful later `/status` + `/values` pair supersedes
  the restored frame and refreshes the bounded fallback while OTA remains active. A second tab,
  unavailable/blocked storage, an expired entry or a version mismatch still gets the conservative
  OTA-only Firmware card from current version/channel rather than invented plant or connection
  state. In both paths the dashboard names the running installation instead of showing
  **Unreachable**. The first later `/status` response can hydrate complete Settings exactly once;
  subsequent status frames remain frozen so they cannot erase the directly-painted progress
  readout. An idle OTA state and every terminal failure remove the cache.
- **Terminal messages clear on a sequence guard, not a timer alone.** Each write to the readout bumps
  a counter and a delayed clear only fires if nothing has been written since. Tapping the version
  again inside the linger window would otherwise let the *first* run's pending timer wipe the
  *second* run's message a moment after it appeared — a check that looks like it silently did nothing.
- **The one native dialog in the UI.** The update confirmation is a browser `confirm()`, not the
  modal overlay pattern every other decision uses (§5.1). Deliberate and deliberately isolated: it
  is a single yes/no with **no fields**, and the overlay machinery exists to host *inputs* — adding a
  fourth modal for one boolean would cost more UI surface than it buys. It is the **only**
  `confirm()`/`alert()` in the device UI fragments; if a second one is ever wanted, that is the signal to build the
  overlay properly instead of spreading native dialogs.
- **What "up to date" can also mean.** When no manifest is reachable — none has been published yet,
  or the two `CONFIG_DAIKIN_OTA_*` URLs point somewhere empty — a check legitimately
  finds nothing and says so. The UI does not distinguish "no newer version" from "no feed configured";
  both are honestly "up to date" from the device's point of view.
- The **device log** is not surfaced in the UI (an early Diagnostics screen was dropped). It remains
  available out-of-band at `GET /diag` (verbose/redact via query; clearing is `POST /diag/clear`);
  another card on Settings is where
  it would go if it ever comes back.
- The UI language follows the **browser** (de / en) by default, with an optional **manual override**
  on the Firmware card (Sprache → `/set_lang`, persisted in NVS as `ui_lang`; §1). The firmware itself
  ships no localized strings.

### 5.5 Installer landing page (`docs/index.html`, GitHub Pages)
This is the page a user meets **first**, before the device can serve its own UI. It therefore uses
the same brand mark, tokens, card radii and controls as the captive portal and dashboard, but as an
installer shell: product/connection top bar, four-step rail, and one main card column. At ≤780 px
the rail becomes a compact horizontal step row; at ≤520 px device facts and installation choices
stack. On wider screens the rail tint continues behind the footer to the shell's lower edge; the
mobile shell returns to the plain page background. The shell never widens the viewport.

- **One native browser surface.** `Select USB device` is the only action that invokes browser UI,
  via `navigator.serial.requestPort()`. Everything after the chooser — ESP32-S3 detection,
  compatibility, manifest download, optional erase, sparse writes, progress, reset and errors —
  stays visibly in this page. `docs/web-installer.mjs` uses the pinned official `esptool-js` API;
  there is no second installer dialog or simulated progress.
- **USB card + device facts.** The card names the exact manifest version and, after the probe,
  shows device, connection and compatibility in three `--soft` tiles. The middle **Connection**
  tile itself is the one Serial Monitor toggle. Its chevron is pinned to the tile's right edge —
  never attached to the label — and rotates when open.
- **Serial Monitor tongue.** Opening that tile slides the real 115200-baud history from underneath
  the whole USB card. The card stays above it (`z-index`), the tongue has no top border/radius, and
  its changing height pushes the installation card down. Closing cancels the reader, releases its
  stream lock and closes the port; history remains in the DOM for the next open. Flashing always
  closes the monitor first because two readers cannot own one Web Serial stream.
- **Explicit installation boundary.** Only after a compatible probe does the installation card
  appear. `Keep configuration` is selected/recommended and writes only manifest parts whose erase
  sectors are already gated away from NVS. `Erase everything` is the deliberate factory-reset path.
  The real cross-part byte progress drives the in-card bar; success appears only after the device
  was reset and the transport closed.
- **Version/provenance.** The displayed version and the flashed parts come from the same
  `manifest.json`; on fetch failure installation remains disabled instead of claiming a stale
  version. `/dev/` changes the compact channel line to `Development build · latest merge to main`;
  the release root says `Release build`. The path decides channel provenance before the manifest
  arrives.
- **Permission release.** `Remove browser permission` keeps the separate `SerialPort.forget()`
  boundary. It acts only on a closed port, never interrupts a monitor/flash stream, and disconnects
  the page state after a successful forget.
- **After-flashing card.** The three numbered rows preserve the first-install/Erase versus update
  distinction, the single-dashboard model and breaker-off X10A wiring boundary. `<code>` chips wrap
  so a long hostname never widens the card.
- The copy states what the firmware actually does: the model is **auto-detected** and the device has
  **one dashboard** — there is no "Setup" screen, no model picker and no RX/TX step to send people to
  (§5.2, §5.3).
- **English only — deliberately, not by omission.** The de/en browser detection of §1 stops at the
  device UI: this page ships no `I18N` dictionary. The divergence from the dashboard is **not** a
  gap to close — do not add a translation layer here to make the two consistent.

### 5.6 Settings — the screen behind the gear (Connections + ESP32 + heating-curve diagnosis)
The dashboard header's **gear** (right, `.iconbtn.bordered`) is the only way off the dashboard. It
opens **Settings**, which swaps the dashboard header for a **back header** — a chevron plus the
screen title. `Esc` leaves the same way, but only when no modal is open: a modal owns `Esc` first, so
one key press never both closes a dialog and leaves the screen behind it. Settings is addressable as
`#settings`; each modal extends that route with its stable human-readable name.

**Settings is flat.** No menu of entries, no sub-screens: the gear lands directly on four permanent
cards, stacked in the same single column as everything else (§9). The Connections tile is the *same*
card it was on the dashboard — the move changed where the configuration lives, not how it looks. The
board card is the same story split three ways: **ESP32** / **Protokoll** / **Firmware** answer three
different questions (the board itself, the X10A link, the running software) that one card used to
answer at once. Firmware's default-off **Plant diagnostics** selector is the one device-wide opt-in.
When enabled, the conditional **Anlagendiagnose** card configures the independent read-only
circulation-pump power source and the conditional **Heizkurven-Diagnose** card comes last. When off,
neither source card is rendered and the firmware performs none of their additional collection. All
cards are built and rebuilt together by one `esp32CardHtml()`. HomeHub/Modbus is a fifth row in the
Connections tile and follows the same row
vocabulary exactly:

1. **Connections tile** — one full-width card, `--card` bordered like the value groups, titled
   "Connections". Combines **WiFi**, **MQTT**, **Syslog**, **NTP** and **Modbus** into one row each: a label on
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
     therefore unused by the UI). A broker can be connected/green while X10A is unavailable because
     the no-LWT MQTT session may still receive the configured room-temperature source; X10A owns
     publication, not broker-link health. While disconnected with a non-empty `error`, the broker
     remains the primary value and the localised cause is shown in a red panel underneath it;
     the accessible state contains the same cause. Known firmware reasons are translated, while a
     future unknown reason falls back to the escaped API text instead of disappearing. Visually the
     cause reuses the value explainer geometry: a full-row clipped area, 10 px inset,
     explainer padding/type/line-height, no panel top border, bottom-only `--r-tile` corners,
     `--shadow-tongue`, and a one-shot `.22s` downward slide. Only its `--err-tint`/`--err` palette
     differs. The global `prefers-reduced-motion` rule removes that animation. There is also
     **no** "HA discovery" row: discovery is streamed
     unconditionally on every (re)connect, so a row saying so would carry no information.
   - **Syslog** — **Disabled** (neutral) when no host is set; else `host:port` coloured `--ok` once
     DNS resolves and the advisory reachability probe answers, `--warn` while resolving or when the
     probe is silent (still forwarding — delivery is gated on DNS only), `--err` on a DNS error —
     from `syslog{configured,resolved,reachable,host,port,error}`.
   - **NTP** — the configured **server**, coloured `--ok` once the first SNTP reply of this boot has
     landed, else `--warn` (there is no "Disabled" state — SNTP always has a configured server) —
     from `ntp{server,synced}`. The synced wall clock (`ntp.time`) is **not** shown on this row (no
     room in a one-line tile); it remains available from `/status.ntp.time` and every syslog
     TIMESTAMP — and from no HA entity (the "Device Time" sensor is retired, ARCHITECTURE.md → *The
     MQTT bridge*).
   - **HomeHub** — always present even when disabled, so the empty state still has an entry point for
     search or manual configuration. The value is the saved host followed by the configured port as
     `host:port`; tapping opens the live (`POST /set_hp`, no reboot) host/port/unit-id modal. Its
     **Search** button alone calls `POST /discover_homehub` (three browses, up to 64 HTTP responders
     each), then fills the ordinary host field without saving behind Cancel/Save. Firmware never
     searches at boot. Saving the host empty means Disabled and causes no mDNS or HomeHub requests.
     Connected uses the
     shared `--ok` connection colour, a configured-but-down host uses `--err`, and the current
     structured failure is localised as a smaller `--err` line directly below the address and included
     in the accessible name. Discovery filters on `homehub-*` and offers the responder's numeric
     IPv4 in the form; only Save persists it, while a negative result changes nothing.
     Failures are also sent to `/diag` and Syslog once per state transition. No setpoint, mode or switch appears here: this
     link remains read-only by design (`docs/SECURITY.md`). It stays a row of its own and is never
     folded into X10A state because the two sources fail independently.

2. **ESP32 card** — the board itself, styled exactly like the value groups (§6): the **Hardware**
   row (selected board, status indicator, recovery-button pins and configured ENV III marker), which
   opens the board-hardware modal, from `board{…}` + `env3{…}`. Selecting a preset fills recommended
   peripheral defaults but records physical identity independently: disabling LED or reset keeps
   AtomS3 Lite selected. A conditional **Outdoor sensor** fieldset appears inside the same modal for
   a pending M5Stack selection and is hidden/disabled for Custom or Seeed. **Save** validates the
   complete board/sensor snapshot; an enabled ENV III must pass its SHT30/QMP6988 live probe before
   one atomic write, so a rejection leaves every draft change in the open dialog and persists none.
   It carries **almost no board telemetry** — chip (`platform`) and **Last reset**
   (`sys.reset_reason`) were rows here through v1.0.14 and are gone: Settings states
   what the board is **set to**, and read-only numbers nobody acts on from this screen only pushed
   the settings that ARE actionable further down it. Neither is lost — the chip is a static fact of
   an image that only runs on one target, and the reset reason is on `/status`, `/diag` and the MQTT
   heartbeat's diagnostic entities, which is where a diagnosis is actually made.
   **Three came back**, and the two memory rows only because they stopped being spot numbers:
   **Free memory**
   (`sys.free_heap`) and **Largest free block** (`sys.max_alloc`), each an expandable row carrying a
   24-hour trend (§5.3 item 3's chart, same accordion as a value row). The original objection stands
   against the *number* — "148 KiB" is a diagnosis nobody can make — and is answered by the *curve*:
   a leak is a slope, and fragmentation is the two lines separating while the total holds. That is
   the one memory question this CARD answers, no other surface answers it (the heartbeat gives Home
   Assistant the same series, but only if a broker is configured), and it is a question the user is
   already on this screen for whenever an OTA has just failed.
   It is **not** the only memory question the firmware has — per-task stack headroom is a second one
   (`main/stack_watch.hpp`, on `/status.sys.stack_min_free_bytes` and the heartbeat) — and it gets
   no row here for the reason this paragraph already gives: only a *curve* earned the two that came
   back, and a stack high-water mark has none to draw. It falls monotonically within a boot and then
   flattens, so a 24-hour chart of it is a staircase that can only descend, and there is no trend
   ring behind it (the ring budget is at its stated ceiling). A row would be exactly the spot number
   the original objection threw out. Not `min_free_heap`: the 24-hour
   minimum is on the chart, and a since-boot scalar beside it would be a second, coarser answer to
   the same question.
   The third is **Uptime** (`uptime_s`), a plain row directly above them, and it comes back for a
   different reason than they do: it is not a quantity anyone reads for its value, it is the answer
   to *did this board restart while I wasn't looking* — which no other part of this screen gives.
   The crash banner (§5.5) fires only when the reboot was a **fault**; a config save, an OTA install,
   a brownout or a pulled plug leave the UI looking exactly as it did before. It is also what makes
   the two rows under it legible: both curves live in RAM and start over at a reboot, so a heap line
   that begins mid-chart is explained by the row above it instead of reading as lost data. Rendered
   at **two units at most, coarsest first** (`3 d 2 h`, `5 h 12 min`, `47 min`, `38 s`) — at three
   days nobody is reading the minutes, and a figure that reshuffles every second is a clock, not a
   diagnostic. The unit symbols are SI and identical in both languages, so the row needs no
   translated unit strings (the Checkup window already prints `min`/`h` untranslated).
   **The card's order encodes what the rows are**: the board's own setting (Hardware) → its own
   health (uptime, then the two memory rows).
3. **Protokoll card** — the X10A link, split out because it answers a different question than the
   board's own health does (*is the bus alive*, not *is the board healthy*): the heat-pump link
   (Online/Offline) and X10A protocol, then the **RX/TX pins** — read-only when detected, else a
   usable-GPIO dropdown (§5.2). From `pins_avail`, `hp{proto,rx,tx,connected,last_ok_s}`. **Link
   facts, top to bottom** (link, protocol, RX, TX). Each label opens the ordinary `--brand-tint`
   explanation tongue; the right-side value or pin selector remains an independent action.
4. **Firmware card** — the running software: the **Version** (`version`) and the **Update channel**
   select (`ota.channel` → `POST /set_ota`, §5.4), then **Language** (`ui.lang` → `POST /set_lang`,
   §1) — a three-option select, **Browser** / English / Deutsch, "Browser" because that option *is*
   the browser's own guess (`navigator.language`), not a separate automatic mode. Picking one is a
   live write like the channel beside it: no reboot, and the browser re-localises immediately
   (`setLang()` re-runs `applyStaticI18n()` + the schematic's hit-target labels) rather than waiting
   for the next poll to *notice* the change — the request that sets it is the same request that
   proves it. The version being here *as well as* in the dashboard
   header serves two different needs, and each row answers the one its screen asks: the header keeps
   board identity where a user quotes it from, while this row exists so the channel selector under
   it is legible — "which feed do I follow" is unanswerable without "what am I running". What they
   no longer differ in is **behaviour**: both are the OTA trigger, and both carry a readout slot, so
   the check runs and reports **here**, without leaving Settings (§5.4). This row was read-only
   through v1.0.13 on the reasoning that the header owned the affordance; in use that only made the
   version look inert precisely where a user is already deciding which build to run. Version,
   update channel and language each have the same label-owned explanation tongue as Protocol. The
   fourth row is the **Plant diagnostics** selector (`diagnostics.enabled` → `POST /set_diagnostics`).
   It defaults to Off, applies live without a reboot, and is deliberately available before any
   dependent source is configured. Enabling starts a fresh evidence generation. Disabling stops and
   clears the 24-hour checkup, room subscription, forecast traffic, circulation witness, and their
   retained diagnosis publications; normal X10A/HomeHub bridge traffic is not part of this gate.

5. **Heizkurven-Diagnose card** — the bottom-most Settings home of the room-feedback project,
   rendered only while the Firmware master opt-in is enabled. This is where its required room source
   and optional forecast are configured. The card is a DIAGNOSIS, not a control: during confirmed heating windows it records
   the raw room deviation (target minus actual; positive means too cold) every 30 minutes. That is an uncalibrated indicator,
   not a leaving-water offset; one room kelvin must never be presented as one water kelvin. Seasonal
   interpretation also needs actual LWT clipping, run time and thermostat duty. Nothing is written
   to the plant — the firmware has no write path (`docs/MODBUS_PROTOCOL.md`).

   Its four rows are **Status**, **Raumtemperaturquelle**, **Wetterprognose** and **Verfahren**.
   There is deliberately no fifth: no "Betriebsart" readout (there is no controller mode — saving
   the master opt-in plus MQTT room mapping and active HomeHub are the arming condition) and no constant "Sicherheit & Ausgabe = Nur lesend" line — with
   the write path deleted neither could ever say anything else, and a row that cannot vary is one
   more thing a reader has to rule out (the rule that dropped `bus_tx_writes`, §5.3).

   **Status** names why no sample exists yet: recording, recording without forecast, waiting for
   space heating, cooling excluded, which prerequisite is still to be set up, or the specific blocked input. An idle plant is
   NEUTRAL, never a warning — through the non-heating half of the year it is the expected reading,
   and a permanently orange row is one the user learns to ignore, which would cost exactly the months
   when it finally means something. **A setup step is likewise dim, not orange**: nothing is wrong
   with a device whose sources have not been configured yet.

   Where the block IS the room source, the row says WHICH WAY it is unusable — "Raumthermostat
   ausgeschaltet", "Raumwert zu alt" — from the source's own `/status` reason, and the source row
   below it turns amber to match. Through v1.0.0-dev.331 it read "Raumeingang fehlt" while that
   source sat green and current two rows underneath: two rows disagreeing about one source, and the
   one making the specific claim was the one that was wrong. **Nothing on this card may report an
   input as missing while another row reports the same input as fine.**

   Deleting the room source is the whole disarm: the subscription stops and runtime values clear.
   Deleting the forecast only stops Open-Meteo traffic; sampling remains armed and the state is
   "recording without forecast" when a heating window is otherwise valid. The
   room-source row opens the exact MQTT topic/path mappings, fixed or mapped target, optional source
   timestamp and maximum age; the weather row opens its location modal. **The measured-outdoor row opens
   nothing.** A row's value is an editor exactly when THIS CARD owns that source — the room mapping
   and the forecast location are configured here and nowhere else. ENV III is not: its one editor is
   the Board Hardware modal on the ESP32 card, which saves it in a single atomic `POST /set_board`
   beside the board identity that decides whether the Grove port exists at all. Opening that modal
   from here was a second door into it, offering hardware configuration from a card that reports
   EVIDENCE — and on the one row whose own copy says the value gates nothing.
   Advanced optional enabled/HVAC-mode mappings remain API-compatible but are not ordinary UI fields.
   ENV III remains a separate board accessory and never substitutes for Daikin R1T — the row records
   it as the recorded sample's own OUTDOOR AXIS, beside the forecast rather than in place of any
   plant reading, and the two labels keep MEASURED apart from FORECAST so one outdoor number cannot
   be read as the other — and the row does NOT repeat the neighbour's "Optionale", both because
   the dim unconfigured state and the tongue already carry it and because at a phone width that
   longer label squeezed the value column until the reading split from its unit. **Its face names
   the SENSOR** — `ENV III`, untranslated and inline like the forecast row's `Open-Meteo` — not the
   reading, which is what every other source row on this card already did: a measurement in the face
   made this the one row whose header was a number, so the card showed two outdoor temperatures in
   two different shapes. The readings live in the tongue, the live one beside the recorded event's
   own value. Both are still the ones the DIAGNOSIS holds, never `/status.env3` read a
   second time: a live sensor whose value has not reached the sampler must not render green here
   while the state row reports the recording stopped, which is the same-input rule above seen from
   the other side. It follows the setup-step rule too — an absent sensor is **dim**, since the axis
   gates no sampling and its absence is not a fault; only a RUNNING recorder that is not being fed
   turns amber, because only then is the sensor the thing to go and look at.

   Every row has a pull-out explanation tongue. The room-source tongue is deliberately a compact
   **live verdict**, not a second copy of its editor. One status line combines transport, freshness
   and diagnostic usability with that exact precedence. Thus a fresh MQTT packet from a thermostat
   reporting itself switched off reads **"Not usable — room thermostat switched off"**, never
   "Current" beside an amber row. If a value exists, only actual temperature, target, and **Last
   reading** follow. The last-reading age tells whether the thermostat is still reporting; only a
   stale state adds the configured maximum beside it, while a broker-replayed retained value is
   marked briefly as such. One final purpose paragraph says concisely what the source actually
   causes in user terms: comparing room and target temperature helps reveal a heating curve that is
   too high or too low over time, but never controls the heat pump. Configuration state, source name/topic/path
   prose and the generic subscription/delete manual do not belong in this status tongue: the row
   already names the source, and its pencil opens the editor where those mechanics are relevant.
   An empty row needs just one actionable verdict: not set up, add a source with the pencil.

   The compact right side **names** the single room-temperature source — the
   saved Bezeichnung, falling back to "MQTT" for a mapping saved without one — exactly as the
   Anlagendiagnose row above it names the configured pump, and the weather row names its configured
   provider. It read "Konfiguriert" through v1.0.0-dev.347: a word that restated what the presence
   of any value already said, in the one place on the row that could have identified WHICH
   thermostat is being read. That makes this a §5.6 Connections row in shape, so it takes that rule
   whole, **including the second half**: the face carries the condition in colour, and the
   accessible name spells out the same combined verdict in words (§9).
   The room-source modal saves immediately and subscribes only while the v19 Plant diagnostics
   master is enabled; its Save hint names that dormant state and explains that a readable, fresh
   MQTT frame is still required before the source becomes usable. Delete removes the saved mapping
   and captured value. A blank timestamp mapping uses live non-retained MQTT arrival time;
   retained data without trusted source time fails closed,
   and `/status` plus the grouped numeric
   `<base>/heating_curve` topic retain the full canonical and diagnosis evidence. No UI path sends a
   setpoint or HomeHub write.

**Only domain readings and settings live in the cards.** The generic *Report a bug* action was the
(then single) card's last row through v1.0.0-dev.199 and is in the footer line below all of them now:
a rare escape hatch drawn at a live reading's weight, immediately under *Largest free block*, read as
one more board fact, and each card's whole claim is that every row on it belongs to that domain.

Under all currently rendered cards, a `--muted` monospace footer line naming the product and running version — and, after
them, **Report a bug**, the screen's one action. It is the `.verlink` affordance the header's version
button uses (§5.3 header): size, weight and colour all inherited, so at rest it is indistinguishable
from the text beside it, with the brand tint + underline arriving only on hover/`:focus-visible`. It
sits here rather than on the ESP32 card because a report is a rare escape hatch, not a board fact,
and the weight of a card row said the opposite. The separator and the link **wrap as one unit** — a
stranded `·` at a line break reads as a dropped word.

Two things keep that from contradicting rules stated elsewhere. It opens the **modal**, not an
outbound link: only the device can produce the evidence half of a report, which is the whole reason
the flow exists (§5.6 bug report). And the version printed in this line stays **non-tappable**, as it
always was — §5.4's "tapping the version checks for an update" is about the version printed *as a
row of its own*, and a control landing next to it here does not make this line a second OTA trigger.

**The gear's attention dot** — an `--err` dot on the gear whenever a connection is **down**, since
the Connections rows are no longer on the dashboard and a broker that stopped answering would
otherwise be invisible from the screen the user is on all day. Only `--err` raises it: `--warn` is
the transient half of the vocabulary (MQTT still connecting, NTP not yet synced, a syslog host that
ignores ping) and every boot passes through it, so warning on warn would leave the gear permanently
marked and the mark would stop meaning anything. A **disabled** link is a choice, not a fault, and
raises nothing. The dot is never the only carrier: the button's `aria-label` states the count in
words (§9).

**Rebuild rule.** The permanent and conditional cards are rebuilt from `/status` on every push. The
Connections tile is one container; the three ESP32-family cards plus the conditional circulation
and heating-curve cards are emitted as one string by `esp32CardHtml()`. The write goes through the same
change-guard the rest of the app uses — and the rebuild is skipped entirely
while an RX/TX dropdown, the update-channel select, the language select **or the diagnostics select** has focus, or the poll
would collapse it mid-pick. (Any future select on these cards has to join that guard — an open
native dropdown is destroyed by an `innerHTML` write, and the poll is ~1×/s.)

## 6. Dashboard value grouping & order

Values are grouped by domain and ordered from "what is it doing" → detail. Grouping is derived from
the value's register/label (the generator can also stamp a `group` tag per row). Order of groups:

1. **Operation** — operation mode, thermostat/space-heating, fault **and error** code, defrost,
   silent mode. (The catalog spells the DHW on-off flag "Powerful DHW Operation. ON/OFF", so it
   lands in group 2 with the rest of the DHW rows rather than here.)
2. **Domestic hot water** — tank temp (R5T), DHW setpoint, DHW mode, the DHW on-off flag,
   extra DHW sensor.
3. **Water circuit** — leaving water temp (after PHE / after BUH), return water temp, flow (l/min),
   water pressure, heating-flow setpoint, target ΔT, pump speed, 3-way valve.
4. **Refrigerant / outdoor** — outdoor air temp, O/U heat-exchanger temp, high/low pressure (°C),
   refrigerant liquid temp, compressor speed, fan step.
5. **Protection** — the page-`0x10` protection words: five retry counters + six drop-control flags.
   Matched on "drop"/"retry" and deliberately **not** on "protection", which would also collect the
   two `default_on` *Freeze Protection* flags and present a normally-ON row as a unit in trouble.

   > **Reading order and match precedence are two different lists.** This numbered order is the
   > reading order (`GROUP_ORDER`); which group a label *belongs* to is decided by `GROUPS`, which is
   > ordered by specificity and puts **Protection first** — it is the one group whose membership is
   > exactly known, so it must not lose a row to a broader key in any other group. They were one
   > array until that cost the group two rows twice: first to Electrical (two of the eleven carry
   > "current"), then to Refrigerant (two carry "discharge"), each time leaving a group that showed
   > 9 of 11 and looked complete. A key can now be made specific without moving anything on screen.
   > `test_ui_source_matrix.mjs` resolves the real `groupOf` over every catalog label and asserts
   > both the eleven and the two lists naming the same groups.
   A flag reading ON means the unit is limiting itself **right now**, so the heading carries a
   `--warn` dot plus the words *"limiting now"* while any is ON, and those rows'
   values go `--warn`. The **counters are not** highlighted: they are cumulative, and marking both
   alike would merge *"is happening"* into *"has happened"* — the one distinction these rows exist
   to draw. Nothing shows when nothing is limiting. Scoped to this group, since ON is the normal
   resting state of plenty of rows elsewhere (pump running, thermostat, freeze protection).
6. **Electrical** — INV primary current, INV compressor current, CT L1/L2/L3 (the catalog spells
   these two ways — "CT Sensor (L1)" and "Current measured by CT sensor of L1" — and both belong
   here), backup-heater capacity + stages, and the inverter's own cooling: heat-sink and fin
   temperatures. NOT the unit nameplate ratings (O/U, I/U, Indoor Unit capacity): those are not
   electrical readings and stay in the catch-all.
7. **Device** — WiFi/MQTT/HP link, poll counters, firmware (WiFi/MQTT and HP link/protocol in
   Settings, §5.6 — the Connections tile and the Protokoll card; firmware version in the dashboard's
   header meta line §5.4; model name in the Model card, §5.3 item 4). Uptime and the heap/reset
   diagnostics are not a UI row anywhere — `/status`, `/diag` and the MQTT heartbeat carry them.

Within a group: setpoints next to their measured value; temperatures before pressures before
currents. Units and `device_class` come from the value `dataType` (1=°C, 2=bar, 3=A). Groups with no
enabled/available values are hidden.

## 7. Components

- **Button** — primary: `--brand` bg / white / bold; secondary: bordered, `--fg`; quiet: link-style
  `--brand`. One primary per view.
- **Input / select** — `--line` border, `--brand` focus ring; inline error text `--err` under field.
- **Value table** — two columns (label `--muted` left, value+unit right, tabular). Missing = "—".
  A recognised value row is also an expander: a full-width button with a trailing chevron that
  rotates on open, revealing the description in a **`--brand-tint` info box pushed out from UNDER
  the row** — flush against it, held in from the row edges, square at the top and rounded at the
  **bottom** corners only, so it reads as continuing behind the row rather than starting below it.
  An open row keeps a divider under it — the same full-width `--line` the next row draws when
  nothing is expanded — so the panel appears **between two list lines** instead of replacing one:
  the line belongs to the LIST and runs the full row width, while the panel stays inset. That is
  what makes the panel read as sliding out from beneath it. The line is drawn as an inset
  box-shadow, not a `border-bottom`, so opening adds no pixel to the row's height. The panel carries
  no top border of its own (a `--line` hairline is invisible against `--brand-tint` — 1.15:1 in
  light, 1.23:1 in dark — so it would be an edge that is drawn and cannot be seen), and an inset
  top shadow (`--shadow-tongue`, per-scheme like `--shadow-card`) is the shadow the row casts onto
  it. Bold `--fg` "Normal:" lead-in on `--muted` body. A **switched** row's panel opens with its
  STATE AGE above that (§5.3 item 6): the state word in the same `.vdesc-n` token as the "Normal:"
  lead-in, and everything after it — the age and its unobserved-time caveat alike — in plain body
  text, so the qualifier reads as one statement rather than a number with a footnote. It opens with
  the `grid-template-rows: 0fr→1fr`
  height transition (§5.3 item 6) **plus** a `translateY(-7px)→0` slide on the same `.22s` timing, so
  height and content land together; both honour `prefers-reduced-motion` — which has to be said
  explicitly, since the global reduced-motion rule kills `animation` only, not `transition`.
  The ROW itself is untouched: no radius, no border of its own. Unrecognised labels render as a
  plain, non-interactive row.
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
- **Leader tie** — the dotted `--line` hairline from a pill to the run it reads. Only pills drawn
  BESIDE a pipe carry one; a reading inside its component is attached by containment already. It
  ends half the pipe's stroke short of the centre line — it points at the run, it never draws on it
  — and it tints with its pill on hover/select, which is how the pairing stays legible on a phone,
  where there is no hover but there is a tap.
- **Bare reading** — a value drawn INSIDE the component that owns it (tank temperature, room
  temperature, the outdoor air) carries **no pill**: the component's own outline is the frame, and a
  second one around the number reads as a second thing. Where such a reading is still its own hit
  target (the room's is, the tank's is not), it carries a transparent `.sc-hitarea` for the tap and
  tints its **value** on hover/select in place of a border.
- **State pill** — a value pill carrying a flag rather than a number, sitting on the component it
  belongs to (§5.3 item 1): `--card` fill, text+border tinted `--ok`/`--warn`/`--flow-cold`/`--brand`
  while the state is active, `--muted` otherwise. State pills normally name the state ("Demand off").
  BOOST and Heizstab are the deliberate compact exception: their faces keep only the component name,
  while the accessible name and inspector spell out the state.
- **Inspector** — `--brand-tint` panel under the schematic (§5.3 item 3), bordered like a card: an
  uppercase `--muted` title + mono source label on the left, the headline reading on the right, then
  the explainer, the optional trend and a `--line`-divided list of every additional X10A/Modbus
  reading, in that order. Idle it shows
  **nothing** and collapses — see §5.3 item 3 for why a standing hint line is not offered. It keeps
  the CARD shape and does **not** take the value table's pushed-out form above: it is not opened out
  of a row, so there is nothing for it to emerge from underneath, and a top edge with no line above
  it would be an edge without a seam.
- **Value pill** — the schematic's unit of reading (§5.3 item 2): `--card` fill, `--line` border,
  tabular value, optional `--muted` sub-label under it — the measurement's NAME, never a note about
  it: annotations belong in the inspector. Holds ONE reading (§5.3 item 2) — a second figure only
  when it is the same quantity, i.e. that reading's setpoint (tank, room), stacked on its own line
  rather than run on after the first — and is hidden outright when its model has no such reading.
- **Connections tile** — `--card` bordered like the value-group cards, full width like every other
  card (§9) — one row per link (WiFi/MQTT/Syslog/NTP), each a label + a single colour-coded value +
  a trailing pencil (§5.6).
- **Icon button** — the header gear and back chevron: a `--soft` (gear: `--card` + `--line`) circle,
  `--brand-strong` on hover, `--focus-ring` on `:focus-visible`. The gear carries an optional `--err`
  dot (§5.6) marking a connection that is down.
- **Crash banner** — `--err`-accented card above the system card (§5.3 item 0), shown only when
  `last_crash` is set: title + meta + hex backtrace, with Download / Copy-diagnostics / Delete-report
  actions. Small `.sm` buttons + a quiet `.ghost` Delete report. Its confirm step replaces that row
  with one question line (`.crash-ask`) and a solid `--err` `.btn.danger` Delete beside a `.ghost`
  Keep — the only `danger` button in the UI, because it is the only irreversible action in it.
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
- **Live writes** (heat pump): "Applied", stay on view; the next `/values` poll (≤2 s) brings the new
  values (a pin-pick also refreshes `/status` a few times to catch the connect).
- **Connection loss**: the system card's status header greys to "No data" only when neither source
  can describe the plant; the Connections tile's WiFi row shows "Offline" if WiFi dropped (and the gear is marked, §5.6), and
  the **Heat-pump card collapses to a bare "Offline"** if the X10A link is down — model, protocol and
  capacity vanish rather than showing stale cached values. The schematic stops X10A-only animations,
  keeps current structurally paired HomeHub facts in petrol, and blanks every unsupported pill to
  "—" — an animated pipe over a silent source would assert a flow nobody measured, and a retained
  X10A reading would assert a value nobody is still measuring. The poll keeps retrying on
  its own cadence, backing off to at most 30 s (the schematic's status block shows "Unreachable —
  retrying…"), no hard error page; returning to the tab retries at once rather than waiting out the
  backoff. Each poll fetch is bounded at **6 s** so that state is reached on a link that drops
  *silently* too: without a timeout the request waits on the browser's default for tens of seconds,
  and for all of it the drawing would present the last poll as the plant's current state — the
  failure this section exists to rule out, in the one form that looks like nothing is wrong.
- **Empty**: pre-first-poll dashboard shows "Waiting for first poll…"; unknown model shows the
  *Generic* hint.
- **Recovery mode**: if `sys.safe_mode` is true (too many crash boots), the recovery banner (§5.3
  item 0) shows above the system card and the heat-pump cards stay collapsed (polling is paused); the WiFi,
  MQTT and Protocol (RX/TX) config controls behind the gear remain usable so the bad setting can be
  corrected, then a reboot returns to normal.
- **Post-crash**: if the last reset was a fault (or a core dump is waiting), the crash banner (§5.3
  item 0) appears above the system card until the report is deleted on the device (or the next clean
  reboot makes the boot un-notable) — with the title distinguishing the two triggers, so
  a leftover dump alone doesn't report a crash that didn't happen this boot. "Copy diagnostics" toasts
  "Diagnostics copied — paste into a bug report" on success, or "Copy failed — open /coredump and
  /diag manually" if the clipboard is unavailable; "Delete report" toasts "Crash report deleted", or
  "The device could not delete it — the report is still there" and puts the banner back.
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
  Connections tile and the three ESP32-family cards behind the gear — is the same full container width, centred, stacked top-down. Unlike the earlier ≥560px
  two-column multicol, this never leaves an empty second column (with a stray card shadow at the column
  gap) when only one card is present — e.g. just the value groups while the heat-pump link is down.
- **Type scales up on larger viewports.** Mobile is the base ramp (15px body, `max-width: 720px`);
  at **≥600px** (tablet / desktop) the container widens to `820px` and the whole type ramp scales up
  ~1.15× **together** — otherwise the mobile-sized column reads small and sparse on a big screen (a
  wall-mounted tablet), lots of empty margin around little content. The bump lives in **one** media
  block so the ramp stays coherent; it never changes the single-column layout, only its size.
- **A label and its reading stack rather than squeeze.** Every row in this UI is one pair — the name
  of a thing on the left, what it currently reads on the right — and the reading is `nowrap`, because
  breaking "46.3 °C" over two lines reads as two numbers. A `nowrap` item cannot give ground, so on a
  narrow phone whatever the row is short of comes out of the **name**, and it comes out all at once:
  "SMART GRID REQUEST VIA MODBUS" set six words deep in a 110px column beside "Free operation",
  "I/U operation mode" three lines deep in 70px beside "Heizen + Warmwasser", and — worst — an
  inspector's mono source line set **one character per line, sixteen lines tall**, with the title
  printed over the reading. So the pair **wraps**: when the two stop fitting side by side, the
  reading moves to its own line under the name, right-aligned in the same column it always occupied
  (`margin-left: auto`, since `space-between` would flush a lone item to the *left*, under the name,
  where a reading looks like a second label). Three rows carry it — the schematic inspector's head,
  the value rows and the split Settings rows — with a **different break rule** in each, and the
  difference is the point. The inspector's title breaks on `flex-basis: auto`, i.e. exactly when it
  can no longer sit beside the reading, because there the title is the thing being read. A value row
  breaks on a **share** (the label keeps 55%), because a content-sized basis would send *every* long
  catalog label's reading to a second line and double the height of a list whose two-line labels read
  perfectly well. Where a row's two halves are separate tap targets (Settings), the row's vertical
  padding sits on the **buttons**, never on the row with the buttons reaching back through it: reach-back
  targets overlap once the halves stack, and the lower one silently takes the upper one's taps.
  German is the width that decides all of this, and it is measured at 320px, not reasoned about.
- Wide content (long value tables) never causes horizontal page scroll; the table scrolls in its card.
- Long modal content scrolls inside the visible dynamic viewport; the background page is locked until
  the final dialog closes, including iOS Safari with its expanding/collapsing browser bars.
- Keyboard: logical tab order, visible focus ring, Enter submits the view's primary action. The
  value-description expanders (§5.3 items 4 and 5 — value rows and Model-card rows share one
  builder) are real `<button>`s carrying `aria-expanded`, so they are focusable and toggle on
  Enter/Space with no extra key handling; the slide honours `prefers-reduced-motion`.
- Contrast AA for text; status never conveyed by colour alone (pills normally carry text:
  "Connected", "CRC 3", "off"). Connections rows (§5.6) and the permanent BOOST/Heizstab pills are
  deliberate exceptions to *visible* state text: their accessible names spell out the status, and
  BOOST/Heizstab also expose it in the inspector. The gear's attention dot follows the same rule:
  the button's accessible name says how many connections are down.
- Respect `prefers-reduced-motion` (no non-essential transitions).

## 10. Firmware support required

The design needs these additions to the firmware (all small, tracked as follow-ups):
- `GET /status`: `wifi.rssi`/`wifi.ip`/`wifi.connected` (live, from `wifi_info()`) — **done**; the
  Connections tile's WiFi row consumes `rssi`/`connected` (§5.6) and the dashboard header
  identity line consumes `ip` (§5.3 body). See `main/http_status.cpp`.
- `POST /set_hp`: **every field is optional** — an omitted key keeps its current value, so the
  Settings Protokoll card posts just `{profile:"auto",rx,tx}` on a pin change. `poll_s` is **not**
  accepted (fixed at 1 s); `proto` is auto-detected and not accepted; there is no value mask. X10A
  (`profile`/`rx`/`tx`) and HomeHub (`mb_host`/`mb_port`/`mb_unit_id`) are separate durability domains:
  naming fields from both in one request returns 400
  `"update X10A and HomeHub in separate requests"` before anything is persisted or applied. The two
  UI forms already submit those domains separately.
- `GET /status`: `uptime_s` (seconds since boot) has **two** consumers, and they read it for
  different things: the **Uptime** row on the Settings ESP32 card (§5.6 item 2) states it, while
  §5.4's OTA flow watches it go *backwards* to detect that the device rebooted under the app (an
  install is confirmed by that as much as by a new `version`).
- Optional `group` field on `ValueDef` (or generator-stamped) to drive §6 grouping; until then the
  UI groups by register-id ranges + label keywords.
- `/models`: returns model lists, `profile_map`, `pin_hint`, per-profile value menu — still served
  and used server-side for candidate-id → display name, though the UI no longer fetches it.
- `POST /detect`: re-run auto-detection (resets `profile` to `"auto"` + invalidates the fingerprint).
  Still served for API/MCP use; the UI no longer exposes a re-detect button.

## 11. Build / delivery

Pipeline: `www/index.html` (markup + `//@@INLINE` markers) + `www/style.css` + the ordered classic-
script fragments in `www/app.sources`, spliced by `inline_assets.cmake` into one gzipped page embedded
in the firmware; `setup.html` is gzipped separately for the captive portal. The fragments remain one
lexical scope and add neither browser requests nor a package-manager dependency. The SPA is view-
switched client-side from `/status` and hash-routed through the browser History API; the hash never
reaches the firmware HTTP server. There are no external assets (CSP-clean, offline-capable on the
device).
