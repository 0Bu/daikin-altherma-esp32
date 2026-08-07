# daikin-altherma-esp32 — Technical Reference

ESP-IDF firmware that reads a **Daikin Altherma** heat pump over its
**X10A** service port and bridges every value to Home Assistant over MQTT. Configured
at runtime from a web UI — WiFi, MQTT and the RX/TX pins (the unit model is auto-detected; the poll
interval is fixed at 1 s) — and updated over the air. User guide: [../README.md](../README.md).

For a cross-cutting catalog of the **platform features** this firmware implements — Secure Boot v2
signing, OTA + rollback health gate, the polled live UI, the ESP-IDF component inventory,
diagnostics, WiFi resilience — see [**FEATURES.md**](FEATURES.md). The features whose subject is the
**plant** rather than the board — the 24-hour checkup, the Open-Meteo forecast, the optional ENV III
climate input and heating-curve diagnosis — are in [**PLANT.md**](PLANT.md).

---

## Hardware

- **Targets:** esp32s3 only. The **M5Stack AtomS3 Lite** is the board the wiring guide is written
  for; the **Seeed XIAO ESP32-S3** is the board the compile-time pin defaults are written for.
  **≥ 4 MB flash** (dual-OTA layout: two ~2 MB app slots). No PSRAM required.
- **Heat-pump link:** the X10A port is a 5 V TTL UART at **9600 8E1**. The ESP maps any two free
  GPIOs to a hardware UART (`RX_PIN` ← X10A pin 2 / HP-TX, `TX_PIN` → X10A pin 3 / HP-RX). The
  USB/native-USB console is a *separate* UART, so device logs never collide with the HP link.
- **Reference wiring (AtomS3 Lite, Grove):** `RX = GPIO1` (G1), `TX = GPIO2` (G2), `GND` mandatory,
  `5V` optional and out of spec (see below — prefer USB power). These are **not** the shipped
  defaults, so they have to be set once via `POST /set_hp`; detection probes only the cached pair,
  the Kconfig pair and each of them swapped.
- **Default wiring (XIAO ESP32-S3):** `RX = GPIO44` (pad D7), `TX = GPIO43` (pad D6) — the
  `CONFIG_DAIKIN_RX_PIN`/`_TX_PIN` values, so this board needs no pin configuration. `GPIO16/17` —
  the classic-ESP32 default — are **not** broken out on either board, which is why pins are
  configurable.

### Voltage and wiring

X10A is 5 V TTL; the ESP32 GPIOs are 3.3 V and not officially 5 V-tolerant. A direct connection
typically works in practice, but the safe option is a level shifter
on the **HP-TX → ESP-RX** line — only on that one line: the link is request/response, so the unit's
RX demonstrably accepts the ESP's 3.3 V TX (it is a TTL input, VIH ≈ 2 V). Whatever you do,
**GND must always be common** between the ESP and X10A, even when the ESP is USB-powered.

**If you do shift, use a passive divider, not an auto-direction shifter.** A resistor divider
(e.g. 10 kΩ / 20 kΩ) is ample at 9600 baud. The popular auto-direction converter ICs (TXS0108E and
relatives) sense direction through weak pull-ups and one-shot edge accelerators — that scheme
assumes a line no one drives continuously, which is exactly what a UART is not, and it has been
observed to kill the link outright (ESP reads nothing at all). A shifter chosen wrong breaks the
bus rather than protecting it; the divider has no such failure mode.

**Powering the ESP from the X10A 5 V pin is out of spec.** Daikin rates the port at **max. 5 V /
50 mA** — that is the spec of its own [EKPCCAB PC-cable accessory][ekpccab] (p. 1), which plugs into
X10A. An ESP32 draws ~70 mA average and 240 mA+ on WiFi-TX peaks, so it exceeds the rating even at
idle. It works on many units anyway (some feed X10A from a 1 A regulator), but the headroom is
per-model and unpublished — an unstable rail is what running out of it looks like. Prefer USB power
and leave pin 1 unconnected.

[ekpccab]: https://www.daikin.co.uk/content/dam/document-library/installation-manuals/ctrl/EKPCCAB4_4PW74106-1E_2018_06_Installation%20manual.pdf

---

## Flash prebuilt artifacts

Browser flasher + captive-portal setup: [../README.md](../README.md). The flasher is served on
GitHub Pages (ESP Web Tools / Web Serial). **Two feeds are published, and only one of them is cut
by hand:**

| Feed | Installer | OTA manifest | Published by |
|------|-----------|--------------|--------------|
| Release | `…/` | `…/manifest.json` | a **manual** workflow run (Actions → *build* → *Run workflow* → `release: true`) — the only thing that creates a `v*` tag + a [GitHub release](https://github.com/0Bu/daikin-altherma-esp32/releases/latest) |
| Development | `…/dev/` | `…/dev/manifest.json` | every firmware-relevant push to `main`; no tag, no release |

A device follows one feed at a time — gear → **Firmware** → *Update channel* (`POST /set_ota`). Dev
builds are versioned `<next release>-dev.<n>`, a semver pre-release, so a dev board upgrades itself
to the next release when one is cut. Going the other way (dev → the last release) means installing
an *older* build, which the downgrade gate refuses unless the request explicitly asks for it — the
UI does exactly that after a channel switch, and confirms it first. Publishing does **not** depend on the repository being public — CI publishes the Pages
installer, the tags and the releases from a private repo too. See the policy
comment atop [`.github/workflows/build.yml`](../.github/workflows/build.yml).

> **⚠️ The Pages site is PUBLIC even when the repository is private.** Restricting who can view a
> Pages site requires an **organization on GitHub Enterprise Cloud**; it is not available to a user
> account on GitHub Pro. So the signed firmware, the browser-installer parts, the manual merged
> image and `manifest.json` are downloadable by anyone on the internet while the source stays
> private. Git tags and GitHub Releases are *not* public on a private repo — only accounts with
> repo read access see those.

> **Bringing the site up the first time — the order matters.** A repo-settings change does not itself
> run a workflow, and the Pages source cannot be pointed at a branch that does not exist yet. So:
> (1) trigger one publish — `gh workflow run build.yml` (the `workflow_dispatch` trigger exists for
> exactly this; leave `release` unchecked to publish the dev channel, check it to cut the first
> release) or push any firmware-relevant change — which creates the `gh-pages` branch, then
> (2) set **Settings → Pages → Deploy from a branch → `gh-pages` / `(root)`**. Until step 2 the
> installer URL in the top-level README 404s.

> **Required repo setting:** Pages source must be **Deploy from a branch → `gh-pages` / `(root)`**
> (Settings → Pages). CI publishes the site by pushing the `gh-pages` branch
> ([`scripts/publish-pages-branch.sh`](../scripts/publish-pages-branch.sh)) and nothing else — the
> branch model is what allows the release root and the `dev/` channel to be published
> independently, minutes or weeks apart, which the atomic whole-site Actions deployment cannot.
> Setting the source to "GitHub Actions" instead serves nothing, since no workflow uploads a Pages
> artifact.

The Web Serial installer writes separate manifest parts around `nvs@0x9000`. Declining its
**Erase** option therefore preserves WiFi, MQTT, board and X10A configuration during an update;
choosing **Erase** deliberately performs a factory reset first.

> **Deployment note:** the currently published `1.0.13` release manifest predates the sparse-part
> plan and still flashes one merged image at offset 0. Do not use that release installer when the
> existing configuration must survive. The development feed is already sparse; remove this warning
> after publishing the next release.

For a manual factory-reset flash (needs `brew install esptool`), use the **merged** image — it bakes
in the correct bootloader offset, so one command flashes the whole esp32s3 image. Its `0xff` gap
padding overwrites `nvs`, so you re-enter the configuration once:

```bash
esptool --chip esp32s3 write_flash 0x0 \
  daikin-altherma-esp32-<version>-merged.bin
```

To preserve `nvs` manually, flash the separate parts from a local `build/`:
`cd build && esptool --chip esp32s3 write_flash "@flash_args"`.

---

## Build from source

Builds run in the official **ESP-IDF Docker image, pinned to the version CI uses**
(`scripts/idf-docker.sh` reads it from `.github/workflows/build.yml`, so it never drifts) — no
local toolchain to install. Flashing is done from the host with `esptool` (Docker Desktop has no
USB passthrough).

```bash
brew install esptool                                              # host flasher (once)
git clone https://github.com/0Bu/daikin-altherma-esp32.git && cd daikin-altherma-esp32

# Build via the CI-pinned ESP-IDF image (first run pulls it — 2-4 min):
./scripts/idf-docker.sh idf.py set-target esp32s3 build

# Optional compile-time defaults (WiFi, MQTT, model, pins) — all also settable at runtime:
./scripts/idf-docker.sh idf.py menuconfig                         # → Daikin Altherma Configuration

# Flash from the host (preserves nvs — @flash_args skips nvs). Match --chip to the build:
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
```

There is also a **host-side mock build** (`scripts/run-mock-tests.sh`) that compiles and runs the
pure decoding/logic in `main/logic/` with the plain system toolchain — no ESP-IDF, no board — so
CRC, register parsing, value conversion, the config model and the HA-discovery payloads can be
*verified* in seconds (CI gates the firmware build on it). See [../test/README.md](../test/README.md).

Boot log:
```
I (520) main: daikin-altherma-esp32 1.0.0 (esp32s3)
I (540) cfg:  profile=auto  proto=I  rx=44 tx=43
I (900) wifi: connected to 'MyNetwork'  ip=192.168.1.42
I (950) hp:   X10A UART @9600 8E1  querying 9 registers, 35 values
I (1000) http: server on :80
```

---

## The Daikin X10A protocol (how values are read)

The X10A port exposes the heat pump's internal monitoring bus. The firmware is a **polling
reader** — it only reads and never actuates the heat pump (the X10A protocol has no write
command; see [X10A_PROTOCOL.md](X10A_PROTOCOL.md)).

- **Framing:** 9600 baud, 8E1. Each cycle the firmware asks for a set of **registers**
  (e.g. `0x10`, `0x20`, `0x60`, `0x61`, `0x62` …). Each register returns a fixed-length byte
  buffer; individual **values** live at known `(register, offset, size)` positions inside it.
- **Protocol `I`** (modern, default) and **protocol `S`** (older, ~2010 and earlier) differ in
  the request framing and checksum; both are implemented (`main/hp_comm.*`). A heat pump that replies `0x15 0xEA` does not understand the request →
  switch to `S`.
- **CRC:** every reply is checksum-verified; a mismatch (`Wrong CRC`) or `Timeout` almost always
  means a bad X10A cable or missing GND, not a firmware fault.
- **Decoding:** each value has a **converter id** that maps its raw bytes to a typed reading
  (temperature ×, signed/unsigned int, fixed-point, enum/label, on-off, pressure…). The
  converter table is verified against known-good reference outputs so readings are correct.

### Value definitions (model profiles)

Each value is a `{register, offset, convId, size, type, label}` row; a model profile is an array of
them. This project keeps that data but makes it **runtime-selectable**:

- One embedded profile per supported **Daikin Altherma model** (plus the Daikin mini-chillers) lives
  in `main/def/*.hpp`, curated to the useful monitoring values (temperatures, pressures, currents,
  setpoints, operating mode, errors, and the DHW/heating/pump state flags). The full register maps
  and converter reference are in [REGISTERS.md](REGISTERS.md).
- **One temporary supplement sits beside those profiles**: `main/def/overlay.hpp` carries the
  outdoor unit's page-`0x10` protection words (the retry counters and drop-control flags), which the
  offline profile generator does not emit yet. It is applied on top of the detected model's table —
  but only for a register page that model already reads, so it cannot change which model is detected
  or add a bus round-trip. Delete it once the generator emits those rows; see
  [ARCHITECTURE.md](ARCHITECTURE.md) → *Value-definition profiles*.
- The firmware **auto-detects** the unit from the X10A bus (protocol sweep + a page/capacity
  fingerprint) and selects the matching profile — there is no manual model picker; the web UI shows
  the detected model read-only. The **RX/TX pins are auto-detected** too (the firmware sweeps the
  cached pair, its swap and the board default); they show read-only while the bus answers and fall
  back to a dropdown of the chip's safe GPIOs when it doesn't (`logic/board_pins.hpp` — the ESP32-S3
  pins not reserved for flash/PSRAM, strapping, USB-JTAG or JTAG, minus the status LED's own pin;
  which of them a given board breaks out to a header is the user's to know, see the board table in
  the top-level README). The heat-pump value labels stay English-only (a separate concept from the
  UI's own language — see Configuration model below); the poll interval is fixed at 1 s.
- The **model** (active profile + fingerprint) is **re-detected on every boot** (never written to
  NVS); the **link** (RX/TX pins + protocol) is a persisted cache, tried first by the sweep. Both
  drive the poll engine (`main/hp_poll.*`). See the Configuration model below.

If the unit can't be identified at all, detection falls back to the **Generic** Altherma profile
(the universal register core) — a value whose converter is not yet implemented reads blank rather
than wrong (documented behaviour). That fallback needs **two** consecutive sweeps to agree before it
is applied: a bus that dropped one reply and a unit this catalog does not know look the same in a
single sweep, and Generic carries far fewer rows (no leaving-water measurement, no compressor speed,
no pressures), so the cheaper explanation has to be confirmed rather than assumed.

> **Deep reference.** The full wire protocol (framing, checksum, register pages, detection, a
> worked capture) is in [X10A_PROTOCOL.md](X10A_PROTOCOL.md); the complete converter/enum tables and
> a representative full register map are in [REGISTERS.md](REGISTERS.md).

---

## Configuration model

All runtime config lives in NVS namespace **`daik_cfg`**; compile-time defaults come from
`main/Kconfig.projbuild` (menu *Daikin Altherma Configuration*). The web UI is the primary way to
set everything; `menuconfig` only seeds first-boot defaults.

User credentials + the X10A link cache are persisted; the model is re-detected on every boot.

| NVS key | Meaning |
|---------|---------|
| `cfg` | **Atomic credential/service blob** (`logic/config_store.hpp`): WiFi credentials + rollback flags, MQTT, syslog, SNTP, from v2 board hardware, v3 OTA channel, v4 UI language, v5 HomeHub, v7/v8 reference-temperature mapping/freshness, v9 (retired actuation bit, now ignored), v10 Open-Meteo location, v11 ENV III wiring, v12 explicit board-preset identity, v13 reference target/readiness mappings, **v14 (retired dynamic-LWT mode byte, now written zero and ignored)** and v15 the external circulation-power witness (topic/paths/thresholds/confirm window — the independent evidence the `dhw_loss` checkup correlates against). Preset id and board pins are one atomic statement. A non-empty `mb_host` polls; empty disables the stack. Older blobs remain readable; the v9 actuation-consent bit and v14 mode byte are discarded because what they gated no longer exists. Heating-curve diagnosis derives arming from the timestamped room mapping; forecast is optional. |
| *(legacy per-key)* | `wifi_ssid`/`wifi_pass`/`wifi_ssid_back`/`wifi_pass_back`/`wifi_rollback`/`wifi_rolledbk`/`mqtt_*`/`syslog_*`/`ntp_server` — the pre-blob layout, still **read** as a fallback when `cfg` is absent (fresh device / OTA from an older build); superseded on the next save. |
| `rx_pin` / `tx_pin` / `proto` | X10A link cache (physical wiring + framing) — kept as separate self-healing keys, tried first by the sweep, re-saved on change, re-validated on load. |
| `board_set` | **Legacy migration input only.** Pre-v12 builds stored this bit without a concrete preset id. On upgrade, `true` plus an exact historical field match is migrated to the same board the old UI displayed; untouched defaults (`false`) remain unidentified. New saves store `board_user_set` and the stable preset id atomically in `cfg`. |
| `boot_fails` | Boot-loop crash counter (`safe_mode.cpp`); increments on a crash-only boot, latches recovery mode past the threshold, cleared after a healthy uptime. Lives here so a factory reset wipes it too. |

The whole namespace is what the **recovery button** erases (`nvs_erase_all`, `recovery_button.cpp`):
hold the configured button for 5 s and the device drops every stored setting and reboots into the
setup portal. It is the only config reset that does not require reaching the device over the
network — the way back in when it has joined a network you can no longer get onto.

Not persisted: the **hostname** is fixed at `daikin-altherma-esp32`, the **poll cadence** at 1 s, and
the **value-catalog labels** (the heat-pump register names) stay **English-only**; the **model**
(`profile` + the detection fingerprint) is re-detected fresh on every boot and kept in RAM (a swapped
unit is re-identified). The **UI's own language** is browser-detected the same way by default, but —
unlike the labels above — a manual pick *is* persisted (the `ui_lang` field in the `cfg` row above).
See [ARCHITECTURE.md](ARCHITECTURE.md) → Auto-detection.

`nvs` offset/size must not change across versions, or old data is stranded on OTA.

---

## HTTP API

Base: `http://<ESP32-IP>` (or `http://daikin-altherma-esp32.local`). No auth / TLS by design — trusted
LAN only, see [SECURITY.md](SECURITY.md).

```
GET  /  (alias /index.html)        # embedded web UI (gzipped into the app binary)
GET  /status[?redact=1]            # ?redact=1 = the bug-report form of this payload: the fourteen
                                   #   reporter-identifying values (wifi.ssid/ip/bssid/mac,
                                   #   mqtt.broker, reference_temperature.name/topic,
                                   #   circulation_source.name/topic, syslog.host,
                                   #   ntp.server, modbus.host plus the weather latitude/longitude
                                   #   — network/location identifiers, plus two names the user
                                   #   typed) read "<redacted>"
                                   #   (logic/redact.hpp). The KEY is always emitted — an omitted
                                   #   field is indistinguishable from an older build, and "which
                                   #   build produced this?" is the first question a frozen report
                                   #   has to answer. Substituted where each value is WRITTEN, never
                                   #   as a pass over the finished string (the httpd stack budget
                                   #   v1.0.12 overflowed). The WS broadcast is never redacted — it
                                   #   feeds the dashboard, which legitimately shows the SSID.
                                   # { version, platform, uptime_s, app_elf_sha256, pins_avail:[..],
                                   #   board:{led_gpio,led_type,led_inverted,btn_gpio,
                                   #        btn_active_low,pins_local:[..],presets:[..]},
                                   #     (pins_local = the LED/button-eligible GPIOs — WIDER than
                                   #      pins_avail by the dedicated-JTAG pads, which are legal for
                                   #      an onboard part but withheld from the X10A picker, and
                                   #      NARROWER by the link's own rx/tx, which the device would
                                   #      refuse for either local pin;
                                   #      presets = ready-made {name,led_*,btn_*} settings per
                                   #      documented board, the Hardware modal's "Board" pick)
                                   #   wifi:{ssid,rssi,ip,connected,bssid,mac,std,rolled_back},
                                   #   mqtt:{configured,connected,tls,has_creds,broker,error?},
                                   #     (has_creds = whether creds are stored, never their value)
                                   #   syslog:{configured,resolved,reachable,host,port,error?},
                                   #   ntp:{server,synced,time},   # time = RFC 3339 UTC once SNTP syncs
                                   #   hp:{proto,rx,tx,connected,last_ok_s,
                                   #        registers,values,crc_err,timeout_err},
                                   #   profile:{id},
                                   #   modbus:{enabled,connected,discovering,host,port,unit_id,rx,
                                   #           fails,values,task_stack_min_free_words,
                                   #           plant_gate_known,plant_gate_active,
                                   #           error?,error_code?,error_detail?,error_register?},
                                   #        # link diagnostics; read-only, no write API
                                   #        field is a command. Empty host disables polling/search.
                                   #   history:{dt,rows:[{id,label}]},   # rows with a 24 h trend;
                                   #        id = the concept (what /history takes), label = how the
                                   #        detected profile spells it. Absent rows are omitted.
                                   #   health:{covered_s,full_span,status,available,assessable,evaluated,
                                   #        checks:[{id,verdict,evidence,observed_s,required_s,…}]},
                                   #        # rolling X10A operating OBSERVATION, not a whole-plant
                                   #        health certificate. Storage is 23 completed 1 h buckets
                                   #        plus the pending hour, so represented span is <=24 h;
                                   #        RAM-only: reboot, explicit /detect, profile selection or
                                   #        RX/TX-pin change starts a new X10A lifecycle; a HomeHub-only
                                   #        edit does not. A reset discards an in-flight old-link sample.
                                   #        covered_s is coarse card context only. Each check's
                                   #        observed_s is its own valid evidence and required_s its
                                   #        gate; absence-of-pattern checks require full_span plus
                                   #        >=90% signal-specific evidence, while direct state and
                                   #        observation-only flow publish their shorter stated gate.
                                   #        Event states are read once per completed poll sweep, so a
                                   #        pulse wholly between sweeps can be missed. Absolute monotonic
                                   #        timestamps preserve fractional sweep time in evidence clocks.
                                   #        available = supported/reportable rows; assessable = rows with
                                   #        a bounded judgement; evaluated = assessable rows whose gate
                                   #        is complete. Observations never support aggregate "ok".
                                   #        verdict: "unavailable" (profile lacks required rows) |
                                   #        "collecting" (supported, insufficient evidence) | "ok"
                                   #        (eligible row has no finding / observation is available) |
                                   #        "info" | "warn". Top-level status "ok" means only no finding
                                   #        in the bounded checks counted by evaluated/assessable.
                                   #        evidence: "device" | "manufacturer" | "heuristic" |
                                   #        "observation" | "experimental". Only pressure >1 bar is
                                   #        a manufacturer numeric boundary. min_bar is always the raw
                                   #        minimum; <=1.0 bar is Info immediately and Warn only after
                                   #        60 continuous seconds. Cycling/defrost are
                                   #        heuristic Info, flow/heaters observations, retry changes
                                   #        experimental strict deltas.
                                   #        Named values remain stable:
                                   #          fault:{active}   cycling:{starts,mean_run_s}
                                   #          defrost:{count,paired_count,share_pct,defrost_s,run_s}
                                   #          pressure:{min_bar}   flow:{min_l_min}
                                   #          heater:{buh_min,bsh_min,buh_s,bsh_s}
                                   #          retries:{seen}
                                   #        Unsupported/unestablished numbers are null, never a
                                   #        plausible zero. Legacy heater minute fields are null for a
                                   #        positive sub-minute runtime; *_s preserves it. Legacy
                                   #        share_pct is null for a positive sub-percent ratio; raw
                                   #        defrost_s/run_s preserve and adjudicate it. NOT GET /diag,
                                   #        which is the log ring.
                                   #   sys:{free_heap,min_free_heap,max_alloc,reset_reason,safe_mode},
                                   #   last_crash: null | {reason,reason_code,fault,coredump,
                                   #        task,pc,backtrace[],corrupted,elf_sha256},
                                   #   detect:{proto,valid,capacity_kw,capacity_kw_iu,ou_eeprom,
                                   #        candidates[],families[],ambiguous,
                                   #        model:{name,family,marketing}} }
                                   #   capacity_kw = the outdoor unit's own report (null when its
                                   #        0x00 descriptor is too short to carry it);
                                   #        capacity_kw_iu = the indoor unit's rated code. Different
                                   #        halves of the plant, routinely different sizes — read
                                   #        them as two figures, never as one with a fallback.
                                   #   candidates[] = models consistent with the unit, never one
                                   #        asserted. When capacity_kw is null they are narrowed by
                                   #        capacity_kw_iu — dropping only classes that contradict
                                   #        it — so the set matches the evidence the pick used.
                                   #        Narrowing is not resolving: ambiguous can stay true.
GET  /values                       # decoded readings
                                   #   [{label,value,unit,reg,binary?,binary_semantic?,held?}]
                                   #   (last poll);
                                   #   reg = the X10A register page the row was decoded from;
                                   #   binary:true marks converter-300..307 bit flags. Their value
                                   #   remains numeric text "1"/"0". binary_semantic names the
                                   #   structural meaning; for the 3-way valve the web UI presents
                                   #   the selected path, while the 2-way-valve OUTPUT stays ON/OFF
                                   #   (it is separate from the configured/current mode, so OFF is
                                   #   not proof of Cooling); ordinary flags stay ON/OFF.
                                   #   The two marked Smart-Grid contacts additionally produce one
                                   #   combined four-state mode in the UI. It also omits redundant
                                   #   ON/OFF / On:…_Off:… legends from visible labels. Raw labels
                                   #   remain unchanged in this response.
                                   #   held:true marks a reading the outdoor unit is no longer
                                   #   refreshing — it answers pages 0x20/0x21 with its last run's
                                   #   numbers while the compressor rests. The value is still
                                   #   reported (the trend rings need it to tell "held over" from
                                   #   "no reading"), but it is not a current measurement, and the
                                   #   MQTT X10A topic withholds it entirely.
GET  /history?row=<trend id>       # one trended row's 24 h series, oldest sample first:
                                   #   {id,label,dt,unit,t0,v[],held[[from,count],…]}
                                   #   unit = the ROW's own unit (never a hardcoded °C).
                                   #   v = TENTHS of that unit (the browser scales by 10) or null.
                                   #   held run-length-marks WHICH nulls were the outdoor unit
                                   #   RESTING rather than a failure to measure — pages 0x20/0x21
                                   #   keep answering with the last run's numbers while the
                                   #   compressor is off, so those samples are not recorded as
                                   #   readings. t0 = wall-clock instant of sample 0, omitted when
                                   #   the clock has never synced (the UI then shows an age).
                                   #   Unknown id → 404. Trends are RAM: a reboot empties them.
                                   #   ids: dhw_tank, leaving_water, return_water, water_pressure,
                                   #   flow, pump_signal, circuit_pressure, comp_rps, eev,
                                   #   outdoor_air, discharge, room_temp, inv_current, ct_l1,
                                   #   ct_l2, ct_l3 — one per numeric value the dashboard drawing
                                   #   shows, plus the electrical rows its estimated-kW pill is
                                   #   computed from — and free_heap plus max_alloc, the BOARD's
                                   #   own memory in KiB, which have no register and are always
                                   #   present.
                                   #   (a row the detected profile lacks is simply absent from
                                   #   /status.history.rows — ask that, don't guess).
GET  /models                       # profile catalog + pin hint (detection is automatic; no manual picker)
GET  /diag[?verbose=0|1][?clear=1][?redact=1]
                                   # plain-text in-memory diag log (raw RX frames when verbose).
                                   #   ?redact=1 scrubs the handful of lines that interpolate a
                                   #   host, an IP or an SSID (logic/redact.hpp) and switches the
                                   #   response to CHUNKED: a replacement is longer than most values
                                   #   it replaces, so the redacted text can grow past the static
                                   #   dump buffer, and the alternatives were a second ~8 KB .bss
                                   #   buffer or a ~6 KB contiguous heap allocation
GET  /scan                         # WiFi scan → {"networks":[{ssid,rssi}]} (name + signal only, no
                                   #   auth field). Trusted-LAN only, and read by no shipped client:
                                   #   the setup portal takes a TYPED SSID and never scans. A
                                   #   diagnostic ("what does the board see, how strong?") for
                                   #   humans/scripts, like /models
GET  /coredump[?clear=1]           # stream this firmware's core-dump image (chunked; 404 if none or
                                   #   if raw flash only holds a proven foreign-build orphan);
                                   #   ?clear=1 erases the coredump partition. Decode offline with
                                   #   scripts/decode-coredump.sh coredump.bin (matching-version .elf).
POST /crash/dismiss                # DELETE this boot's crash report: erase the dump AND stop
                                   #   reporting the crash, so /status.last_crash goes null, the
                                   #   retained MQTT crash topic clears and the web UI banner is gone
                                   #   for good (it used to hide in page state, which a reload undid).
                                   #   Irreversible — download the dump first if you plan to file a
                                   #   bug report. A failed erase of current-firmware evidence answers
                                   #   500 and deletes nothing; already-suppressed foreign residue
                                   #   cannot pin a separate current-fault banner.
                                   #   The reset REASON is unaffected (/status.sys.reset_reason).
POST /set_wifi                     # { ssid, pass } → validate (ssid 1-32; pass ""|8-63) → persist +
                                   #   reboot; on failure 400 {ok:false,error} (nothing saved). Backs up
                                   #   the old creds + auto-rolls-back if the new network fails to
                                   #   connect (see ARCHITECTURE.md → Web UI config flow)
POST /set_mqtt                     # { broker, user?, pass?, clear_creds? } → pre-flight the broker
                                   #   (DNS/TCP/connect+auth) → on success persist + reboot, on failure
                                   #   400 {ok:false,error} (nothing saved). Empty user+pass keeps stored
                                   #   creds; clear_creds:true removes them (anonymous); "" broker disables.
POST /test_ref_temp                # { name, topic, temperature_path, setpoint_path, timestamp_path,
                                   #   enabled_path?, hvac_mode_path?, max_age_s }
                                   #   → temporarily subscribe on the existing authenticated MQTT
                                   #   connection and wait up to 12 s for a value accepted by the live
                                   #   JSON/timestamp/plausibility decoder. Changes neither Config nor NVS.
                                   #   Success returns current + target, typed optional gates and a proof;
                                   #   missing/stale source time or out-of-range temperatures are rejected.
POST /set_ref_temp                 # the exact mapping above + test_proof → persist + apply live. A
                                   #   non-empty topic requires a proof issued for that same topic/path/
                                   #   gate/age tuple; an empty topic is the explicit Disable operation and
                                   #   needs no readable value or proof.
POST /test_circulation             # { name, topic, power_path, timestamp_path, max_age_s,
                                   #   on_threshold_w, off_threshold_w, confirm_s } → temporarily
                                   #   subscribe and require one fresh active-power value; returns watts,
                                   #   threshold state and a mapping-bound proof. Read-only: no Shelly command.
POST /set_circulation              # the exact mapping above + test_proof → persist as blob v15 and
                                   #   apply live without reboot. Empty topic deletes the observer mapping.
                                   #   Defaults: apower, aenergy.minute_ts, 3.0/1.0 W, 120 s age,
                                   #   60 s confirmation; every field is configurable in Settings.
                                   #   (There is no POST /set_dynamic_lwt. The heating-curve diagnosis
                                   #   arms itself from the timestamped MQTT room source above. The
                                   #   forecast below is optional comparison evidence, so location
                                   #   disclosure is not a prerequisite. It records raw room error,
                                   #   not a requested LWT offset; no actuator exists.)
POST /set_weather                  # { latitude, longitude } as strict decimal strings → persist +
                                   #   wake the firmware weather task. Both empty disables weather
                                   #   traffic; otherwise both are required. Open-Meteo HTTPS/JSON
                                   #   work is asynchronous, never on the httpd worker.
POST /set_syslog                   # { host, port } → validate port range, persist + reboot ("" host
                                   #   disables). DNS/reachability resolve async, shown in /status.syslog
POST /set_ntp                      # { server } → persist + reboot, no request-path network probe (the
                                   #   SNTP client resolves + retries after reboot, same as syslog); an
                                   #   empty server resets to the compile-time default on next boot —
                                   #   SNTP has no disabled state, unlike syslog's empty-means-off.
POST /set_hp                       # { profile?, rx?, tx?, mb_host?, mb_port?,
                                   #     mb_unit_id? } → apply live (no reboot).
                                   #   Every key optional; an omitted one keeps its stored value.
                                   #   rx/tx PERSIST (pin cache), profile session-only; proto auto-detected.
                                   #   The Settings Protocol card's pin dropdown posts {profile:"auto",rx,tx} to re-detect.
                                   #   mb_host controls the SECOND, independent Modbus stack — it does
                                   #   NOT stop the X10A poll. Non-empty polls that address; empty
                                   #   disables task, discovery and requests, including after reboot.
                                   #   mb_port 1..65535, mb_unit_id 1..247, mb_host at most 512
                                   #   chars (the persisted blob's field bound; longer is a 400
                                   #   "mb_host is too long") — docs/MODBUS_PROTOCOL.md.
                                   #   The link is READ-ONLY: no actuation field is accepted and no
                                   #   HTTP raw-register route exists (docs/MODBUS_PROTOCOL.md).
POST /discover_homehub             # {} → bounded mDNS search started only by the HomeHub dialog's
                                   #   Search button. Success: {ok:true,host:"<IPv4>"}; miss: 404.
                                   #   Never persists or reconfigures — Save owns that boundary.
POST /set_board                    # { preset_id, led_gpio, led_type, led_inverted, btn_gpio,
                                   #   btn_active_low, env3_enabled, env3_sda, env3_scl }
                                   #   → validate + atomically persist the complete Board Hardware
                                   #   form; REBOOT when peripheral or sensor fields change
                                   #   (both are claimed once at task start, so they are not
                                   #   hot-swapped). The board's own onboard
                                   #   parts: indicator pin + driver (0 = plain GPIO LED, 1 = WS2812)
                                   #   + polarity, and the recovery-button pin. -1 = absent for either.
                                   #   `preset_id` is stable (`m5stack_atoms3_lite`,
                                   #   `seeed_xiao_esp32s3`, or `custom`) and is validated as an
                                   #   explicit identity independently of configurable peripherals.
                                   #   Disabling LED/reset therefore retains AtomS3 Lite. Picking
                                   #   the preset a device already carries moves
                                   #   no value, so it saves without rebooting and answers
                                   #   {ok:true,reboot:false,saved:true} — `saved` is what stops the
                                   #   UI reporting an NVS write as "no changes".
                                   #   Runtime rather than Kconfig because one published image serves
                                   #   boards with different onboard hardware. Unchanged settings
                                   #   short-circuit to {ok:true,reboot:false}. Rejects a pin the chip
                                   #   reserves, and any pin already claimed by the other of these two
                                   #   or by the X10A link (in both directions). An enabled ENV III
                                   #   is probed before the one config write, so no partial board-only
                                   #   change can land after a failed sensor test.
POST /set_env3                     # Compatibility route: { enabled, sda?, scl? } → the same
                                   #   validate + test-before-persist + reboot contract. The current
                                   #   UI uses /set_board. Enabling probes both ENV III components on the selected
                                   #   I²C pair before NVS is written: SHT30 must return a CRC-valid
                                   #   sample and QMP6988 its 0x5c chip id. A failed probe returns a
                                   #   stable `code` plus an English `error`, changes nothing and leaves
                                   #   the Board Hardware dialog open. An unchanged active mapping requires a fresh
                                   #   runtime sample. Changing an active mapping is a deliberate
                                   #   disable → reboot → rewire → enable sequence. Disabling
                                   #   (`enabled:false`) never depends on attached hardware.
#  all persistent /set_* above     # an NVS write failure → 500 {ok:false,error:"config write failed"},
                                   #   nothing applied and no reboot (the failing key is logged to /diag)
POST /detect                       # re-run auto-detection (reset profile to "auto" + invalidate fingerprint)
GET  /ota/check[?ms=<epoch>]       # start a background update check (poll /ota/status)
POST /ota/update                   # start the background self-update (downloads, then reboots)
GET  /ota/status                   # { state, progress, message, available, update_available, current }
GET  /mcp                          # static, self-contained MCP information + setup page;
                                   #   same trusted-LAN-only URL as the protocol, never SSE
POST /mcp                          # stateless, read-only Streamable-HTTP MCP server:
                                   #   initialize / tools/list / tools/call; exactly get_status and
                                   #   get_hp_values, mirroring GET /status and GET /values.
                                   #   JSON-RPC errors -32700/-32600/-32601/-32602; notifications →
                                   #   202 with no body; no SSE/session.
                                   #   Bounded parser/dispatcher: logic/mcp.hpp; see docs/MCP.md.
```

**Every** handler runs under the OOM try/catch rather than crashing (memory is the binding
constraint on these chips) and returns `503` — with no exceptions now that the raw-registered
`/events` WebSocket handler, which had to self-guard because `is_websocket` bypasses the trampoline,
is gone. `/diag` and `/coredump` stream instead of building one big buffer.

---

## Home Assistant (MQTT)

`main/mqtt_ha.cpp` mirrors every decoded value to MQTT and uses Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery) for X10A metrics
and diagnostics under one **Daikin Altherma** device — no YAML. HomeHub values remain available on
MQTT but are deliberately not announced to Home Assistant.
**Read-only:** no
command topics are subscribed. The bridge runs in its own task, independent of the poll engine.

- **Enable:** set the broker in the web UI (gear → Connections → MQTT). Stored in NVS `mqtt_uri`.
- **TLS:** a schemeless entry defaults to plaintext `mqtt://`. Credentials require an explicit
  `mqtts://` broker URL (CA-verified via the mbedTLS bundle) so the password isn't sniffable — the
  bridge **refuses** a plaintext broker with credentials rather than silently downgrading or guessing
  a TLS port. An explicit scheme is always honoured. Reason surfaces in `/status.mqtt`.
- **Node id:** the slugified base topic (`daikin-altherma-esp32` → `daikin_altherma_esp32`). It
  identifies the *device* in each discovery config's `uniq_id`/`dev.ids`, but is **not** part of the
  message topics — those sit directly under `<base>` (one board per base topic). Board-independent
  on purpose: **swap the ESP32 and Home Assistant keeps the same device and entities** (and their
  statistics). The board's own `daikin_<mac3>` remains the MQTT client id and a second `dev.ids`
  entry so an install from a MAC-identified build is merged, not duplicated — see
  [HOME_ASSISTANT.md → Device identity](HOME_ASSISTANT.md#device-identity).
- **Topics:** `<base>/x10a` (one retained JSON of X10A values, grouped by register page —
  `{ "<group>": { "<object>": value } }`, max depth 1), plus per-value discovery configs under
  `<prefix>/<component>/<node>/<group>_<object>/config` (retained) whose `value_template` reads the
  group+object out of that JSON. The entity id carries the group because a label is unique only
  within its register page while HA's id namespace is flat (#221); the JSON key does not. `<component>` is `binary_sensor` for a bit-flag value (pump running,
  3-way valve, thermostat ON/OFF), whose state rides as the number `1`/`0` so it is usable in a
  metrics store as well as in HA, and `sensor` for everything else.
  An enabled HomeHub publishes its live, flat register map independently on `<base>/modbus`, but no
  HA discovery config references that topic. An enabled ENV III likewise publishes each fresh 10 s
  sample independently on retained `<base>/env3` as
  `{"temperature_c":20.25,"humidity_pct":45.50,"pressure_hpa":1008.75}`. An unavailable or stale
  sensor publishes `{}` so consumers cannot mistake the last retained value for a current reading;
  selecting **No sensor** retracts the retained topic and its three HA discovery configurations.
  Home Assistant receives ENV III temperature, humidity and air pressure as measurement sensors;
  `{}` marks those entities unavailable while the device and unrelated entities stay online.
  On upgrade, retained tombstones remove all 27 formerly
  announced `_modbus` entities; the data stream itself remains intact. A disconnected link publishes
  `{}` and disabling the source retracts its data topic. A bounded migration probe deletes the former
  retained `<base>/modbus/status` value when it still exists because its link state already lives in
  `<base>/heartbeat`. HomeHub enums stay numeric
  constants (for example `smart_grid_operation_mode: 2`); only the web UI maps them to readable names. A short
  migration probe does the same for an old retained `<base>/state` value; an already-clean broker
  receives no publish on either retired topic.
  The optional firmware weather input is mirrored independently, only while configured, as one
  retained atomic evidence document on `<base>/weather/openmeteo/forecast`: forecast values,
  Open-Meteo/ICON provenance,
  fetch and horizon timestamps, `valid_until_unix_s`, and numeric `available`/`fresh` flags. No HA
  Discovery entities are created for weather. Upgrade cleanup retracts the four configs published
  by the earlier short-lived contract and deletes a retained `<base>/weather_forecast` predecessor
  when it exists. The current document contains no coordinates. A failed refresh can preserve the last values for later
  analysis, but marks them unavailable so a historian can prove what was known without treating an
  old forecast as current. Disabling Open-Meteo publishes no disabled document; a retained predecessor
  is probe-deleted once when present, while an already-clean broker receives no publish on this topic.
  MQTT is not required for the firmware to fetch or evaluate weather.
  Availability/LWT `<base>/status`. `<base>` defaults `daikin-altherma-esp32`,
  `<prefix>` `homeassistant`.
  There is no inbound command topic at all.
- **Type-stable, and honest about absence.** Whether a key is a JSON number or a JSON string is
  decided by the value's converter, so **no key ever changes type** between states — a stopped fan
  publishes `0`, never `"OFF"`. Textual Daikin fault fields keep their text and gain permanently
  numeric `error_active` / `warning_active` companions, since a metrics store can hold neither
  `"U4"` nor a bool. A value the firmware cannot honestly claim — a quarantined row, an unpopulated
  field, or a reading the outdoor unit is no longer refreshing — is **omitted**, so Home Assistant
  shows *unknown* rather than a plausible number nobody measured. See
  [HOME_ASSISTANT.md](HOME_ASSISTANT.md#a-fields-json-type-never-changes).
- **Diagnostics topics.** `<base>/heartbeat` (board/link health on a fixed 10 s cadence — a **flat**
  JSON of heap, uptime, WiFi/MQTT/bus counters, each field prefixed by its block name: `wifi_rssi`,
  `wifi_mac`, `wifi_bssid`, `mqtt_count`, `bus_rx_received`, …, plus `bus_ou_held_over`, which is
  *source* freshness rather than link health: it says the outdoor unit stopped refreshing its own
  pages, so its readings are missing from the X10A topic while the bus itself is fine),
  `<base>/heating_curve` (non-retained, schema-versioned room-source and read-only diagnosis evidence,
  grouped as `room` plus `diagnosis.{gates,room_evidence,last_sample,counters}` rather than mixed into
  the technical heartbeat; schema v2 adds the optional outdoor axis — `diagnosis.outdoor_available`
  and `last_sample.outdoor_temperature_c`, the outdoor air temperature as it stood at the recorded
  event where an ENV III sensor is configured and fresh, `null` otherwise and never `0`), and
  `<base>/crash` (retained;
  **crash-only** — a "dump waiting" flag, published once per (re)connect but ONLY when the boot is
  *notable*: a real fault or a dump still in flash. A normal boot publishes nothing on a clean broker;
  the bridge first probes for an older retained crash and deletes it only when one actually exists,
  so no payload-less `/crash` node is recreated on every connection. The reset reason is not
  a crash entity — it lives on the heartbeat's own "Reset Reason" sensor (the old duplicate "Last
  Reset Reason" crash entity was dropped). Republished on the heartbeat cadence if the "dump waiting"
  flag *or the notability* changes, so neither clearing a dump nor deleting the report in the web UI
  (`POST /crash/dismiss`) can leave it latched ON).
  Heartbeat and crash expose `entity_category: diagnostic` HA sensors; the heating-curve topic is
  MQTT/metrics-only. The crash topic carries only the
  reason + a hex backtrace — never a secret or the raw dump; pull the full dump from `GET /coredump`
  and decode it with `scripts/decode-coredump.sh`.
  Two heartbeat entities — *Device Time* and *WiFi Quality* — were retired under the same rule as
  *Last Reset Reason* above: each only repeated what another entity on the same device already said.
  Their retained discovery configs are actively deleted, so they disappear on upgrade without manual
  cleanup ([HOME_ASSISTANT.md](HOME_ASSISTANT.md#two-diagnostic-entities-are-retired)).
- **Autodiscovery streaming.** A full Altherma value set can exceed 10 KB of discovery JSON;
  discovery is emitted incrementally (chunked) so it never needs one large contiguous heap block.

Derived sensors (COP etc.) and a sample dashboard: [HOME_ASSISTANT.md](HOME_ASSISTANT.md).

---

## OTA (self-update)

Pull-based: the device fetches `manifest.json` from `CONFIG_DAIKIN_OTA_MANIFEST_URL` (default GitHub
Pages), compares its `version` to the running firmware, and on confirmation downloads its image
`daikin-altherma-esp32.bin` via `esp_https_ota` into the inactive OTA slot, then reboots. Tap the
firmware **version** to check — either the one in the header (next to the IP address) or the
*Version* row on gear → **Firmware**, which does the same thing and stays where you are. The UI shows
the download progress inline beside whichever version you tapped, waits for the board to come back
up and reloads itself onto the new UI. Both the check and the download run on their own task, never on the HTTP worker.

> **Which feed it checks:** the device follows one channel at a time — gear → **Firmware** → *Update
> channel* (`POST /set_ota`, applied live). `release` reads the Pages root, `dev` reads `…/dev/`;
> both are published by CI (see "Flash prebuilt artifacts" above), and the dev URL is derived from
> `CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL`, so one setting moves both. Publishing does **not** require
> the repository to be public; it does require the Pages source to point at `gh-pages`. With nothing
> served on the selected channel, a check simply reports the device is up to date. Point the two
> `CONFIG_DAIKIN_OTA_*` URLs at any HTTPS host to use your own feed.
>
> Switching from `dev` back to `release` installs an **older** build, which the gate below refuses
> unless the request explicitly asks (`?downgrade=1`) — the UI does that after a channel switch, and
> confirms it first.

- **Downgrade gate** *(implemented)*: refuses anything not strictly newer — a signature proves
  authenticity, not freshness. It is checked **twice**, and the second check is the load-bearing one:
  once against the manifest's `version` (cheap, avoids a pointless download), then again against the
  **image's own embedded version**, read from its `esp_app_desc_t` after the transfer starts but
  before anything is committed. The manifest and the image are separate artifacts, so a host that
  advertises a high version while serving a genuine, correctly-signed *old* binary would otherwise
  walk the device backwards onto a fixed bug. Ordering is numeric (`logic/version_cmp.hpp`), so
  `1.10.0 > 1.9.0`, and an unparseable version on either side refuses the update rather than guessing.
  Ordering alone is not identity, though: two *different* artifacts can each be newer than what is
  running, so the two versions must also be **exactly equal** — the manifest has to describe the
  image actually being installed, not merely advertise something newer. CI publishes both strings
  from one stamped value, so in the field a mismatch is a stale cache or a dishonest host.
- **Rollback armed** *(implemented)*: `main.cpp` defers `esp_ota_mark_app_valid_cancel_rollback()` to
  a health gate (~90 s), so a boots-but-crashes image reverts.
- **Signed images:** Secure Boot v2 RSA-3072 signing *without* hardware Secure Boot — the running
  app verifies the signature before installing an OTA (no eFuses; reversible; web installer still
  works). CI signs each image with the offline `OTA_SIGNING_KEY`. Details:
  [SECURITY.md](SECURITY.md).

Partition layout (`partitions.csv`) is dual-OTA sized to fill 4 MB (a larger flash just leaves
the top unused); app at `0x20000`.

---

## Security

Full threat model + Flash Encryption / Secure Boot notes: [SECURITY.md](SECURITY.md).

- The API has **no auth / TLS** by design (trusted LAN only) — never expose it to the internet.
- WiFi/MQTT credentials live in NVS **unencrypted** by default; enable Flash + NVS Encryption
  (irreversible) if physical access is a concern.
- X10A is read-only, and so is the HomeHub link: the register-54 actuator is retired, so no source
  file can build or issue a Modbus write ([MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md)). Its `:502` is
  unencrypted and has no Modbus-level credential, so segment or firewall the HomeHub to this device —
  other clients (Onecta, the MMI, evcc) can still write it.

---

## License

[MIT License](../LICENSE). Not affiliated with Daikin.
