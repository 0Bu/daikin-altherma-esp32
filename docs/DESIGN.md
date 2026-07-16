# UI design specification

Design contract for the embedded web UI (`main/www/`) and the captive portal (`main/www/setup.html`).
Implementation-ready: colours, tokens, information architecture, per-view specs, states, and the
firmware fields the UI keys off. No framework — one self-contained gzipped page + the standalone
setup page (see `main/CMakeLists.txt`).

## 1. Principles

1. **One screen.** After provisioning, the app is a single dashboard — there is **no Settings page
   and no sub-screens**. Everything the device exposes lives on that one page; the little config
   there (WiFi, MQTT and Syslog via modals, RX/TX pins inline) happens in place.
2. **Provision, then run.** WiFi credentials are entered first on the captive portal (`setup.html`);
   the device reboots into your network and the app opens on the dashboard. They stay re-editable
   later from the dashboard WiFi card (§5.1, with automatic rollback on a bad change). The heat pump
   is fully automatic (auto-detected), so there is nothing to configure for it.
3. **Read-only truth.** The dashboard reflects the device; it never blocks on writes. The few writes
   (WiFi credentials, MQTT broker, Syslog server, RX/TX pins) are explicit and report their outcome.
4. **Terse, dense, technical.** Tabular numbers, short labels, no decorative copy.
5. **English only.** Labels are fixed English — there is no language selector (UI or firmware).

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

Rules:
- **Brand = navigation & identity** (header rule, title, active step, primary button, focus ring,
  links). **Semantic = state** (ok/warn/err) for values and connection status — never recoloured
  to brand, so status is unambiguous.
- `--brand-tint` is for the setup hero band and the dashboard status hero background — a faint cyan
  fill carrying normal `--fg` text with a `--brand-strong` kicker, bordered like a card rather than
  reading as a dark chrome band. Body remains on neutral `--bg`.
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
**dashboard** and never leaves it — there are **no sub-screens and no Settings page**. In-place config
is the WiFi credentials, the MQTT broker and the Syslog server (each a **modal** off its dashboard
card) plus the RX/TX pins (inline on the ESP32 card). The heat pump is otherwise **fully automatic**
(auto-detected).

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
  captive `setup.html` (§5.0) and thereafter re-editable from the dashboard WiFi card's pencil (§5.1,
  with automatic rollback to the last working network if the new credentials fail), the MQTT broker
  is edited from the dashboard card's pencil (§5.1), the heat pump needs no setup (auto-detected; RX/TX
  pins on the dashboard ESP32 card, §5.3), and firmware updates are checked by tapping the version on
  that card (§5.4).
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
Standalone, `--brand-tint` hero + one card. Only WiFi. Network dropdown from `GET /scan` (ssid · dBm),
password, **Save & reboot** → `POST /set_wifi`. Message line for scan/save state. No other controls.
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

### 5.1 WiFi / MQTT / Syslog edit  (modal, from the dashboard status card)
The dashboard's **WiFi**, **MQTT** and **Syslog** status cards (§5.3) each carry a **pencil** in the
header; tapping it opens a centred **modal** over a dimmed dashboard. These are the three status cards
edited this way, and they share the identical overlay pattern (Cancel / backdrop / `Esc` dismiss
without writing; Save reboots to apply, then closes back to the dashboard). The forms:
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
  and the advisory reachability probe run in the syslog task after reboot and surface on the card via
  `/status.syslog`. The host prefills from `/status`.

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

- **Product name** (headline line): the fixed title **`daikin-altherma-esp32`** — a stable app
  identity, not the detected model and no firmware version. Spelled in full lower-case exactly like
  the hostname / SoftAP / MQTT base topic (the project-wide naming convention), never "Daikin
  Altherma ESP32". The detected heat-pump model is shown instead in the **Model** status card
  (§5.3 body).

Body, ordered:

0. **Recovery-mode banner** (only when `sys.safe_mode` is true). A `--warn`-accented card **above the
   hero**: title "Recovery mode", explaining that the device restarted too many times and came up
   minimally (heat-pump polling and MQTT paused), and to correct the configuration (e.g. the RX/TX
   pins on the ESP32 card) and reboot. **Not dismissible** — it reflects a live state and clears
   itself once a healthy reboot leaves safe mode. Lives outside the poll-rebuilt card grid.
0. **WiFi-rollback banner** (only when `wifi.rolled_back` is true). A `--warn`-accented card **above
   the hero**: title "WiFi change failed — rolled back", explaining that the new credentials couldn't
   connect, so the device restored the previous network (named from `wifi.ssid`, which after the
   rollback *is* the network it fell back to) and restarted, and to open the WiFi card to try again.
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
1. **Status hero** (`--brand-tint` band): operation mode (Heating / Cooling / DHW / Standby / Off) as the
   headline, with fault state. Colour: `--ok` running, `--warn`/`--err` on fault; grey when no data.
   Fault text and the last-poll age surface in the hero sub-line.
2. **Status cards** — five cards styled exactly like the value groups (§6), first in the same grid:
   - **ESP32** — the board itself: chip (`platform`), **firmware version** (a tappable row that checks
     for an OTA update, §5.4), uptime (`uptime_s`), **Last reset** (`sys.reset_reason` — warn-coloured
     on a fault reason: panic / any watchdog / brown-out, neutral on a clean boot) and **Free heap**
     (`sys.free_heap`, compact e.g. "145 KB"), the heat-pump link (Online/Offline) and X10A
     protocol, and the **RX/TX pins** — read-only when detected, else a usable-GPIO dropdown (§5.2).
     From `platform`, `version`, `uptime_s`, `sys{reset_reason,free_heap}`, `pins_avail`,
     `hp{proto,rx,tx,connected,last_ok_s}`.
   - **WiFi** — a header row combining the PHY standard name (e.g. "WI-FI 4"), signal bars + RSSI
     (`--ok`/`--warn` by strength) and the SSID (green), then IP address, MAC and BSSID; from
     `wifi{ssid,ip,rssi,connected,bssid,mac,std}`. A **pencil** in the card header opens the WiFi edit
     modal (§5.1); offline the card collapses to "Offline".
   - **MQTT** — **Disabled** when no broker is set, else two rows: **Status** (Connected / Error /
     Connecting…) and **Broker**, the latter trailed by a small grey **padlock** when the link is TLS
     (`mqtts://`) — encryption is an inline marker, not a row of its own. There is **no** "HA
     discovery" row: discovery is streamed unconditionally on every (re)connect, so a row saying so
     would carry no information. From `mqtt{configured,connected,tls,broker,error}`. A **pencil** in
     the card header opens the MQTT edit modal (§5.1) — one of the three status cards edited via a
     modal (the others are WiFi and Syslog).
   - **Syslog** — off-device log forwarding status: **Disabled** when no host is set, else the
     server (`host:port`) and a state badge — **Enabled** once DNS resolves (delivery is best-effort
     UDP, gated on resolution only), warn-flagged **"host not answering ping"** when the advisory
     reachability probe is silent (still forwarding), or a **DNS error** — from
     `syslog{configured,resolved,reachable,host,port,error}`. A **pencil** opens the Syslog edit modal
     (§5.1), which posts `host:port` to `/set_syslog`.
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
- **Hero** — `--brand-tint` band bordered like a card, `--fg` text under a `--brand-strong` kicker,
  one headline + one sub-line.
- **Crash banner** — `--err`-accented card above the hero (§5.3 item 0), shown only when
  `last_crash` is set: title + meta + hex backtrace, with Download / Copy-diagnostics / Dismiss
  actions. Small `.sm` buttons + a quiet `.ghost` Dismiss.
- **Recovery banner** — `--warn`-accented twin of the crash banner (reuses its layout classes), above
  the hero, shown only when `sys.safe_mode` is true: title + one explanatory line, **no actions and no
  dismiss** (it mirrors a live state, clearing itself on a healthy reboot).

## 8. States & feedback

Every async action shows: idle → in-flight ("Saving…", spinner on button) → result (toast + view
transition). Specific:
- **Reboot writes** (WiFi / MQTT / Syslog): Save disables the button and shows a spinner + "Saving…"
  while the request is in flight (the `/set_mqtt` broker pre-flight blocks up to ~8 s). **Only a 2xx**
  then shows "Rebooting — reconnecting…" and polls `/status` until it answers, closing the modal back
  to the dashboard; a `reboot:false` answer (nothing changed) closes with "No changes" and never polls.
  A rejected write must not enter the poll: with no reboot to wait for, `/status` answers on the first
  try and would report a phantom "Saved". (A WiFi change that can't reach the new network rolls back to
  the previous credentials and reboots again — see §5.1; the outcome surfaces on the rollback banner,
  §5.3 item 0, since it lands long after this poll gives up.)
- **Live writes** (heat pump): "Applied", stay on view; the `/events` WebSocket pushes the new
  values on the next poll cycle (a pin-pick also refreshes `/status` a few times to catch the connect).
- **Connection loss**: hero greys to "No data"; the WiFi card shows "Offline" if WiFi dropped, and
  the **Heat-pump card collapses to a bare "Offline"** if the X10A link is down — model, protocol and
  capacity vanish rather than showing stale cached values. The `/events` WebSocket reconnects every
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
