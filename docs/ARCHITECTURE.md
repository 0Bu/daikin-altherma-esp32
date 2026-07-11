# Architecture reference

Deep internal reference for daikin-altherma-esp32. This is the **on-demand** companion to
[`.claude/CLAUDE.md`](../.claude/CLAUDE.md): CLAUDE.md carries the always-needed essentials
(build/flash, component map, NVS table, HTTP API, memory constraints); the full narrative lives
here so it isn't reloaded into every session. Read it when working on the poll engine, the value
model, the MQTT bridge, WiFi/LAN connectivity, or OTA. Keep both in sync — the `project-review`
skill checks for drift.

## Design split

Two concerns, cleanly separated. The **domain** — the X10A protocol (I and S), the register/CRC
framing, the value-definition tables (`def/*`) and the converter functions — is reverse-engineered
heat-pump knowledge, ported byte-for-byte so readings match a known-good implementation. The
**chassis** — the ESP-IDF/CMake multi-target build, the web installer, captive-portal
provisioning, the MQTT/HA discovery bridge, signed OTA, the `main/logic/` host-test split and the
CI / Claude-Code developer setup — is the delivery machinery. Anything about *talking to the heat
pump* is the domain; anything about *installing, configuring and shipping* is the chassis. IDF
idioms are used throughout (`esp_http_server`, `uart_driver`, `esp-mqtt`).

## Component map

```
main.cpp            → boot: NVS init, WiFi (STA or setup AP), start HTTP server, start
                       poll engine + MQTT bridge, arm OTA health gate
hp_comm.cpp/.hpp    → X10A UART transport: request framing for protocol I and S, 9600 8E1,
                       CRC, timeout handling
hp_registers.cpp    → per-register request/response layout, register→value extraction
hp_convert.cpp/.hpp → converter functions: raw bytes →
                       typed reading (temp, int, fixed-point, enum/label, on/off, pressure)
hp_poll.cpp/.hpp    → poll engine task: builds the active register set from the profile+mask,
                       polls each interval, fills the thread-safe value cache, drives errors
def/*.hpp           → embedded per-model value profiles (machine-generated in the ValueDef row
                       format); def/registry.hpp maps profile id→table, models_catalog.hpp = /models
config.cpp/.hpp     → NVS-backed runtime config (daik_cfg); load/save, defaults from Kconfig
nvs_storage.cpp     → thin NVS helpers (namespaces, blobs, migration)
http_server.cpp     → esp_http_server :80, wildcard dispatch + handle_all OOM try/catch (503)
http_status.cpp     → GET / (web UI), /status, /values, /models, /diag
http_config.cpp     → POST /set_wifi, /set_mqtt, /set_hp, /set_relays
http_ota.cpp        → /ota/check|update|status
mcp_server.cpp      → /mcp — read-only MCP tools (get_status, get_hp_values) for AI agents
provisioning.cpp    → captive setup portal (SoftAP daikin-altherma-esp32-setup) when no WiFi
mqtt_ha.cpp/.hpp    → Home Assistant MQTT-Discovery bridge (streamed discovery), read-only
ota_update.cpp      → pull-based signed OTA (esp_https_ota), downgrade gate, health gate
control.cpp         → optional on/off thermostat + SG-Ready relays (off by default)
diag_log.cpp        → in-RAM console ring served by GET /diag (static .bss buffer)
www/                → web UI sources: index.html + style.css + app.js, spliced into ONE
                     self-contained page at build time (inline_assets.cmake) and served gzipped;
                     setup.html is the captive-portal page (gzipped separately)
logic/              → IDF-free, host-tested pure logic (see below)
```

## The host-tested logic core (`main/logic/`)

Everything that is pure computation lives in IDF-free headers under
`main/logic/`, so `scripts/run-mock-tests.sh` compiles + runs it with plain g++/clang++ (no
ESP-IDF, no board) and CI gates the firmware build on it (`logic-test` job). For this project the
host-testable core is unusually large and valuable, because the risky parts are all pure decoding:

- `logic/crc.hpp` — the X10A checksum for protocol I and S. Golden-vector tested against frames
  captured from a real unit.
- `logic/convert.hpp` — every converter (raw bytes → typed value). This is where a wrong sign,
  scale or endianness would silently corrupt a reading; unit-tested per converter id against
  known-good reference outputs.
- `logic/registers.hpp` — register-buffer parsing (offset/size extraction, bounds).
- `logic/config_model.hpp` — validation of pins (no overlap, in range for the target), interval
  clamps, protocol enum, profile/value-mask (de)serialization.
- `logic/discovery.hpp` — the HA MQTT-Discovery payload builder (topic + config JSON per value),
  so the exact bytes HA receives are asserted on the host, not on the device.
- `logic/demo.hpp` — demo mode: fabricates plausible register bytes per value so the poll engine
  can fill the cache with realistic readings **without a wired unit**. Isolated in one header so
  the feature is trivial to extend (a converter case) or remove; host-tested like the rest.
- `logic/detect.hpp` — model auto-detection: maps a bus `Fingerprint` (answering pages + capacity)
  against per-profile signatures to a candidate set (see the Auto-detection section). Pure, so the
  narrowing rule is asserted on the host against the real derived signatures.

`hp_convert.cpp`, `hp_comm.cpp`, `config.cpp`, `mqtt_ha.cpp` are thin device wrappers that call
these headers. Add new decode/format logic to `main/logic/` and a `CHECK` in
`test/test_logic.cpp` — never bury it in a `.cpp` that only the device can run.

The wire-level protocol these headers implement — frame layout, checksum, register pages, the unit
detection handshake — is specified in [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md); the converter-id
formulas, enum tables and a full register map are in [`REGISTERS.md`](REGISTERS.md).

## Value-definition profiles (runtime-selectable models)

The single biggest UX change: **no editing a config header + a `def/*.h` by hand.**

- Each value is a `ValueDef{reg, offset, conv, size, type, label}` row; one model profile is an
  array of them, embedded as `const` in `main/def/<profile>.hpp`. The tables are machine-generated
  from the X10A value definitions (see [`REGISTERS.md`](REGISTERS.md)) — curated to the useful
  monitoring values — and `def/registry.hpp` maps a **profile id** to its table. `tools/gen_defs.py`
  is the importer for classic `.h`-row model files in the same output format.
- At runtime `config` holds the active `profile` id + a `val_mask` (which of the profile's values
  are enabled) + `lang`. The poll engine expands this to the concrete register set to request.
- The `/models` endpoint serves the catalog (`def/models_catalog.hpp`): the model list + a
  `profile_map` (model→profile id) + pin hint, so the web UI's model dropdown resolves the profile
  without hard-coding it in JS.
- Flash cost is bounded by embedding **only the value tables** (a few hundred rows × families),
  not the whole source tree; labels are stored once per language and shared. If size ever
  pressures the 4 MB layout, profiles can move to a data partition — the indirection through
  `def/registry.hpp` makes that a non-breaking change.

Porting fidelity is enforced on the host: `test/test_defs.cpp` checks a sampling of profile rows
against the source rows so a regenerate can't silently drift.

## The poll engine (`hp_poll.cpp`)

A single task owns the X10A UART (there is exactly one link). Each cycle:

1. Build the ordered list of **registers** needed by the enabled values (dedup — one register
   read serves all its values).
2. For each register: send the protocol-`I`/`S` request, read the fixed-length reply with a
   `SER_TIMEOUT`, CRC-check it. On timeout/CRC error, record it (`crc_err`/`timeout_err`,
   `last_error`) and continue — one bad register never stalls the whole cycle.
3. Extract each enabled value from its register buffer via `(offset,size)` and convert it via its
   `convId`. Write results into the **thread-safe value cache** under a mutex.
4. Sleep `poll_s`. The MQTT bridge and HTTP `/values` read the cache; they never touch the UART.

Config changes from the web UI (`/set_hp`) apply live: the task rereads `config` at the top of the
next cycle (pins/protocol changes re-init the UART). No reboot needed for model/values/pins/
interval — only WiFi/MQTT changes reboot (they re-init network stacks).

**Demo mode** (`Config::demo`, toggled in the Heat pump settings view): when on, the task takes a
separate branch (`poll_demo()`) that **never touches the UART**. It asks `logic/demo.hpp` to
fabricate the raw bytes for each value in the active profile and runs them through the *same*
`convert()`/`hp_format()` path as real data, then fills the cache and marks the link connected. The
web UI, `/values` and the MQTT bridge are all unaware — they just read realistic readings. `demo`
is one bool in the config model + one poll-engine branch + one pure header, so the feature adds no
weight to the real path and is easy to pull out.

## Auto-detection (protocol + model) — `hp_detect.cpp` + `logic/detect.hpp`

The goal is **zero manual model/protocol picking** where the bus allows it. `Config::profile`
defaults to the sentinel `"auto"`; while it holds, the poll task runs one detection pass
(`poll_detect()`) instead of a normal cycle:

1. **Pin + protocol sweep** — try the identity page `0x00` on candidate RX/TX pairs (the configured
   pins, their **swap** — a reversed X10A wire is the commonest mistake — then the per-target
   default and its swap) × protocol `I`/`S`; keep the pins **and** framing that return a valid
   CRC-checked reply instead of `15 EA`. Only X10A-designated pins are probed (no arbitrary GPIO).
   The winning pins are persisted, so a swapped wire self-corrects.
2. **Page probe** — query every page any profile can reference (`0x00,0x10,0x20,0x21,0x30,0x60–0x65,
   0xA0,0xA1`) plus `0x11`; set a bit in a **page mask** for each page that answers.
3. **Capacity + EEPROM** — read the O/U capacity from page `0x00` offset 12 (0.1 kW units) and the
   O/U EEPROM identification digits from page `0x11`.

Those facts form a `Fingerprint`. The pure, host-tested `logic/detect.hpp` narrows the profiles:
each profile's **signature** (its page mask + a capacity class parsed from its id) is derived
automatically from the embedded `ValueDef` tables (`def/signatures.hpp`) — no hand-maintained
table. A profile is a candidate when its pages are a subset of the answering pages **and** the
unit's capacity falls in its class; among those, only the ones with **maximal page overlap** are
kept (this drops feature-poor profiles that are merely a subset of a feature-rich unit).

The result is committed only when the bus actually answered (so a not-yet-wired unit retries next
cycle instead of pinning `generic`):

- **exactly one candidate** → applied automatically; the UI shows only "Detected: <model>".
- **several candidates** → the best-fit becomes the working profile and the UI offers just the
  reduced (ambiguous) set. Many Altherma variants are electrically identical on X10A (e.g.
  EHV/EHB/EHVZ = one PCB, different packaging) and genuinely cannot be told apart from bus data —
  the EEPROM digits are shown to help the user match the nameplate but are **not** decoded to a
  model name (there is no digit→name table).
- **none** → `generic`, UI shows the full list.

`proto`, the resolved `profile`, and the fingerprint (`fp_pages`/`fp_kw`/`fp_eeprom`) are persisted,
so detection runs **once** — not on every boot. `/status.detect` recomputes the candidate set from
the stored fingerprint cheaply (no re-probe). `POST /detect` resets `profile` to `"auto"` and
invalidates the fingerprint to force a fresh pass; a manual pick from the web UI sets `prof_auto=0`
and pins the chosen profile. Protocol is no longer a UI control.

## Push vs. poll (why the engine polls)

The X10A service port is a **strict request/response bus** — the ESP is always the master and the
unit only ever answers a query (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) §1). There is no
opcode, register or framing for the unit to send unsolicited/push frames, so **the firmware must
poll**; a "the pump pushes values to us" mode is not possible at the wire level. The only push in
the system is firmware → MQTT (the bridge publishes state on its own cadence), which is independent
of the HP link.

## WiFi / LAN connectivity (reconnect + watchdog)

Two layers keep the WiFi station link up:

- **Event-driven reconnect** on every `WIFI_EVENT_STA_DISCONNECTED`. First-ever connect keeps a
  bounded budget then falls back to the **setup portal** (credentials presumed wrong); once the
  device has held an IP at least once, later drops reconnect **forever** (known-good creds — never
  strand the device on a transient AP/router outage).
- **Connectivity watchdog** (~30 s) ICMP-echoes the gateway to catch a missed-deauth "ghost"
  association (stack thinks it's up, forwards nothing). After 2 consecutive failures it forces one
  `esp_wifi_disconnect()` so the endless-retry handler reconnects. Guarded to act only on a
  believed-up link and only if the gateway has answered at least once; it **never reboots** (a
  reboot during an AP outage would drop into the setup portal and abandon good credentials).

## Home Assistant MQTT bridge (`mqtt_ha.cpp`)

The Home Assistant bridge:

- **Read-only** — no command topics (the optional control relays publish their own separate
  `sg/…` and switch topics via `control.cpp`, not this bridge).
- **Node id** `daikin_<mac3>` (WiFi STA MAC, stable across config changes).
- **Own publish task + esp-mqtt client.** The event handler only flips status flags; all publishing
  happens in the task, so the mqtt event loop is never blocked by string building.
- **Discovery is streamed.** A full Altherma value set can be 30–40+ entities; the bridge emits one
  entity's discovery config at a time (retained) on (re)connect, so it never needs one large
  contiguous heap block — the same memory discipline as the rest of the firmware. Layout-marker
  converters (docs/REGISTERS.md §3.6) get no sensor.
- **Per-value retained state topics** `<base>/<node>/<object_id>/state` (no shared JSON blob / no
  `value_template`) — this is what makes true publish-on-change possible.
- **Units + device_class** are derived from the converter id, so temperatures get `°C` +
  `temperature`, currents `A` + `current`, etc., and HA renders them correctly with history.
- **Publish-on-change.** The heat pump is polled at a short interval (default 2 s) for near-
  real-time readings, but each cycle the task publishes **only the values that changed** since the
  last cycle (`logic/mqtt_delta.hpp` `mqtt_changed`, host-tested). A full retained seed of all
  values goes out only on (re)connect (and when auto-detection resolves a new profile, which also
  re-streams discovery). So a short poll interval does not flood the broker.
- **Availability / LWT** on `<base>/<node>/status` (`online`/`offline`, retained) — the broker's
  last-will marks the device offline if it drops, and every sensor's `avty_t` points at it.
- **TLS default-on with credentials** (mqtts, CA-verified via the mbedTLS certificate bundle). If
  credentials are set but the URI is not `mqtts://`, the bridge **refuses to connect** and reports
  the reason in `/status.mqtt` rather than sending them in cleartext — no silent plaintext fallback.
  A credential-free plaintext broker on the trusted LAN is allowed (nothing secret to leak).

## OTA, signing, partitions, multi-target

Structure:

- **Targets** esp32 / esp32s3 / esp32c3 / esp32c6 / esp32c5 from one source tree; CI builds all
  (`scripts/ci-build-all.sh`). No BLE is used, so the target set is just "WiFi ESP32s with ≥4 MB
  flash". Per-target deltas are config-only (`idf.py set-target`, native USB-Serial/JTAG console
  on s3/c3/c6, UART0 on the classic esp32).
- **Dual-OTA `partitions.csv`** sized to fill 4 MB; app at `0x20000`; `nvs` at `0x9000` untouched
  by OTA so WiFi + model config survive upgrades.
- **Signed OTA** (Secure Boot v2 RSA-3072 *without* hardware Secure Boot): running app verifies
  the signature before installing; downgrade gate + ~90 s health gate as above. Web installer
  publishes per-chip merged bins + a single `manifest.json` (esp-web-tools auto-selects by chip).
- **PR preview installer**: every same-repo PR publishes a signed preview at
  `…/PR/<N>/` on the `gh-pages` branch (fork PRs get no signing key → no preview). OTA always
  checks against **main**.

## Web UI config flow

`www/` is split for edit locality (index.html markup + style.css + app.js) and spliced into ONE
self-contained, pre-gzipped page at build time (`inline_assets.cmake`). The UI's Setup panel drives the config endpoints:

- **WiFi** → `/set_wifi` (also reachable from the captive `setup.html` before WiFi exists).
- **MQTT** → `/set_mqtt`.
- **Heat pump** → `/set_hp`: the model is **auto-detected** (see Auto-detection) — the card shows
  the detected model, a reduced pick list when ambiguous, or the full list only as a fallback, plus
  an "Auto-detect again" action (`/detect`). Protocol is auto-detected and has no UI control. The
  form still sets language, RX/TX pins (with a per-board pin hint from `/models` + platform), poll
  interval, demo mode, and the per-value enable checkboxes.
- **Control** (optional) → `/set_relays`: thermostat + SG pins.

The board/platform is read from `/api/proxy/1/version` so the pin hints match the running chip
(e.g. the XIAO ESP32-S3 pad→GPIO map).

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the
largest *contiguous* free block): keep every HTTP handler under the `handle_all` try/catch (503 on
OOM), stream `/diag` and the MQTT discovery instead of building one big `std::string`, and treat
any new large contiguous allocation (big JSON, OTA TLS) as a crash risk to size-check. A reboot
loop is bad here too — it stops the poll cycle and drops MQTT availability.
