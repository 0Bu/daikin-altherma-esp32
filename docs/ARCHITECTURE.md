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
**chassis** — the ESP-IDF/CMake esp32s3 build, the web installer, captive-portal
provisioning, the MQTT/HA discovery bridge, signed OTA, the `main/logic/` host-test split and the
CI / Claude-Code developer setup — is the delivery machinery. Anything about *talking to the heat
pump* is the domain; anything about *installing, configuring and shipping* is the chassis. IDF
idioms are used throughout (`esp_http_server`, `uart_driver`, `esp-mqtt`).

## Component map

```
main.cpp            → boot: NVS init, safe-mode guard, WiFi (STA or setup AP), start HTTP server,
                       start poll engine + MQTT bridge (both SKIPPED in safe mode), arm OTA health gate
safe_mode.cpp/.hpp  → boot-loop safe mode (logic/boot_guard.hpp): crash-only boot counter in NVS
                       (boot_fails) → past a threshold, come up minimally (WiFi + web UI + OTA, no
                       poll/MQTT) to recover a bad config in-browser. See "Boot-loop safe mode" below
wifi.cpp/.hpp       → STA bring-up (all-channel scan → strongest AP by RSSI) + endless reconnect
                       (first-boot budget → setup portal) + one-shot credential rollback (new creds
                       fail to get a lease → restore NVS backup + reboot; ≥5 consecutive AUTH_FAIL/
                       handshake-timeout disconnects after having been online → reboot to fallback) +
                       ICMP gateway watchdog + DHCP hostname + mDNS; wifi_info() also reports the AP's
                       BSSID + PHY standard + this STA's MAC
hp_comm.cpp/.hpp    → X10A UART transport: request framing for protocol I and S, 9600 8E1,
                       CRC, timeout handling
hp_detect.cpp/.hpp  → auto-detect glue: protocol sweep + page probe → bus fingerprint → candidate
                       models (logic/detect.hpp); register→value extraction is in logic/registers.hpp
hp_convert.cpp/.hpp → converter functions: raw bytes →
                       typed reading (temp, int, fixed-point, enum/label, on/off, pressure)
hp_poll.cpp/.hpp    → poll engine task: builds the active register set from the profile,
                       polls each interval, fills the thread-safe value cache, drives errors, and
                       pushes the /events WebSocket (values each cycle, status every 4th)
def/*.hpp           → embedded per-model value profiles (machine-generated in the ValueDef row
                       format); def/registry.hpp maps profile id→table, models_catalog.hpp = /models
config.cpp/.hpp     → runtime config (daik_cfg): WiFi/MQTT + the one-shot WiFi rollback backup + link
                      cache (pins/proto) persisted, model RAM-only; mutex-guarded snapshot via config()
nvs_storage.cpp     → thin NVS helpers (namespaces, blobs, migration)
http_server.cpp     → esp_http_server :80, wildcard dispatch + handle_all OOM try/catch (503)
http_status.cpp     → GET / (web UI), /status, /values, /models, /diag, /scan, /coredump, and the
                      /events WebSocket (live status/values push)
http_config.cpp     → POST /set_wifi, /set_mqtt, /set_syslog, /set_hp, /detect
http_ota.cpp        → /ota/check|update|status
mcp_server.cpp      → /mcp — read-only MCP tools (get_status, get_hp_values) for AI agents — PLANNED
                      (route exists; returns a JSON-RPC "not implemented" error for now)
provisioning.cpp    → captive setup portal (SoftAP daikin-altherma-esp32-setup) when no WiFi
captive_dns.cpp     → UDP:53 catch-all (every name → 192.168.4.1) so the setup portal auto-pops
mqtt_ha.cpp/.hpp    → Home Assistant MQTT-Discovery bridge (streamed discovery), read-only
ota_update.cpp      → OTA: rollback health gate (implemented); pull check/download + downgrade
                      gate via esp_https_ota (TODO stubs — see ota_update.hpp)
diag_log.cpp        → in-RAM console ring served by GET /diag (static .bss buffer); each line is
                      also handed to syslog_send() for optional off-device forwarding
syslog.cpp          → optional syslog UDP client (RFC 5424, off when syslog_host is empty). A task
                      DNS-resolves the host and forwards each diag line as one UDP datagram, gated on
                      DNS only; an ARP(local)/ICMP reachability probe is ADVISORY (feeds
                      /status.syslog.reachable, never gates delivery — syslog is best-effort UDP and a
                      collector may firewall ICMP). File-scope ping-control (like wifi.cpp s_wd) keeps
                      the async esp_ping callback from a use-after-free. Self-loop-guarded (drops
                      "syslog:" lines); syslog_status() feeds /status
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
- `logic/config_model.hpp` — validation of pins (no overlap, in range for the target), protocol
  enum, and the fixed `POLL_INTERVAL_S` constant.
- `logic/discovery.hpp` — the HA MQTT-Discovery payload builder (topic + config JSON per value),
  so the exact bytes HA receives are asserted on the host, not on the device.
- `logic/detect.hpp` — model auto-detection: maps a bus `Fingerprint` (answering pages + capacity)
  against per-profile signatures to a candidate set (see the Auto-detection section). Pure, so the
  narrowing rule is asserted on the host against the real derived signatures.
- `logic/board_pins.hpp` — per-target list of usable X10A GPIOs (the pins broken out + safe on each
  chip's reference board; the XIAO ESP32-S3 is authoritative). Feeds `/status.pins_avail` and hence
  the dashboard RX/TX pin dropdown. Pure, so the lists are asserted host-side (sorted, in range, and
  the reference-board set excludes not-broken-out pins like GPIO47).
- `logic/reset_reason.hpp` — maps a raw `esp_reset_reason()` code to the stable slug used by
  `/status.sys.reset_reason` and the heartbeat, reusing `crashinfo`'s table so there is one vocabulary.
- `logic/boot_guard.hpp` — the boot-loop safe-mode decision logic (crash-only reset classification,
  saturating crash counter, threshold rule) behind `safe_mode.cpp`; asserted host-side so the "enter
  on the Nth crash, never on a provisioning reboot" contract can't silently regress.

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
  monitoring values — and `def/registry.hpp` maps a **profile id** to its table. `tools/profiles/`
  decodes Daikin's proprietary value catalog (encrypted `.ldd` = zlib + NRBF) into these tables
  (`gen_profiles.py`) and the id→name table (`gen_names_generic.py`).
- At runtime `config` holds the active `profile` id. The poll engine expands it to the concrete
  register set to request (every value of the profile — there is no per-value enable mask). Labels
  are English-only — there is no `lang` field.
- The `/models` endpoint serves the catalog (`def/models_catalog.hpp`): the profile list + pin
  hint. Detection is fully automatic (see the Auto-detection section) — the web UI shows the
  detected model read-only, so this is metadata only; there is no manual model dropdown.
- Flash cost is bounded by embedding **only the value tables** (a few hundred rows × families),
  not the whole source tree; labels are English-only. If size ever pressures the 4 MB layout,
  profiles can move to a data partition — the indirection through `def/registry.hpp` makes that a
  non-breaking change.

Porting fidelity is enforced on the host: `test/test_defs.cpp` checks a sampling of profile rows
against the source rows so a regenerate can't silently drift.

## The poll engine (`hp_poll.cpp`)

A single task owns the X10A UART (there is exactly one link). Each cycle:

1. Build the ordered list of **registers** needed by the profile's values (dedup — one register
   read serves all its values).
2. For each register: send the protocol-`I`/`S` request, read the fixed-length reply with a
   `SER_TIMEOUT`, CRC-check it. On timeout/CRC error, stage it (`crc_err`/`timeout_err`,
   `last_error`) in locals and continue — one bad register never stalls the whole cycle.
3. Extract each value from its register buffer via `(offset,size)` and convert it via its
   `convId`. Write the results into the **thread-safe value cache** — and fold the staged stat
   deltas into `s_stats` — under the mutex, in **one** commit at the end of the cycle. The sweep
   itself never touches shared state: the readers (`hp_stats()`) copy `s_stats` under the same
   mutex, so an unlocked mid-sweep write to `last_error` would free a `std::string` buffer under a
   reader. See *Memory constraints* for why the commit must also stay non-allocating.
4. Sleep `POLL_INTERVAL_S` (fixed 1 s — see `config.cpp`). The MQTT bridge and HTTP `/values` read
   the cache; they never touch the UART.

Config changes from the web UI (`/set_hp`) apply live: the task rereads `config` at the top of the
next cycle (pins/protocol changes re-init the UART). No reboot needed for model/pins — only
WiFi/MQTT changes reboot (they re-init network stacks).

**Task Watchdog.** The poll task is the one worker that does real, potentially-blocking I/O (the
X10A UART reads), so it subscribes itself to the ESP Task Watchdog Timer (`esp_task_wdt_add`) and
feeds it (`esp_task_wdt_reset`) **at the top of every cycle and once per register during the
sweep** — a slow-but-progressing 9600-baud sweep (worst case a silent bus, ~13 regs × 300 ms ≈ 4 s)
keeps feeding it, so only a genuinely *stuck* read trips the 20 s timeout. The idle-task watch
catches CPU starvation; this adds the blocked-but-still-scheduled case it can't see. On a trip,
`CONFIG_ESP_TASK_WDT_PANIC=y` turns the hang into a clean reboot whose `esp_reset_reason()` is
`ESP_RST_TASK_WDT` — classified as a fault by `logic/crashinfo.hpp` and surfaced on
`/status.last_crash` + the retained MQTT crash topic (see *Diagnostics*). The detection pass
(`poll_detect()`, ~7 s worst case) is bounded by the same per-cycle reset, so it needs no internal
feed. Config keys live in [`sdkconfig.defaults`](../sdkconfig.defaults).

## Auto-detection (protocol + model) — `hp_detect.cpp` + `logic/detect.hpp`

The goal is **zero manual model/protocol picking** where the bus allows it, on **every boot**. The
**model** is never persisted: `config_load` always seeds `Config::profile` with the sentinel
`"auto"`, so a fresh identification runs after every reset (a swapped unit is re-identified). The
**link** (RX/TX pins + protocol) *is* persisted as a boot-invariant cache — loaded first, tried
first, re-saved on change — with the compile-time defaults as fallback so a stale cache self-heals.
While `profile == "auto"`, the poll task runs one detection pass (`poll_detect()`) instead of a
normal cycle:

1. **Pin + protocol sweep** — try the identity page `0x00` on candidate RX/TX pairs (the cached
   pins first, their **swap** — a reversed X10A wire is the commonest mistake — then the per-target
   default and its swap) × protocol (cached framing first, then the other); keep the pins **and**
   framing that return a valid CRC-checked reply instead of `15 EA`. Only X10A-designated pins are
   probed (no arbitrary GPIO). The winning pins/protocol are re-persisted only when they changed
   (a UI pin override survives reboot); an unchanged link is confirmed with no NVS write.
2. **Page probe** — query every page any profile can reference (`0x00,0x10,0x20,0x21,0x30,0x60–0x65,
   0xA0,0xA1`) plus `0x11`; set a bit in a **page mask** for each page that answers.
3. **Capacity + EEPROM** — read the O/U capacity from page `0x00` offset 12 (0.1 kW units) and the
   O/U EEPROM identification digits from page `0x11`.

Those facts form a `Fingerprint`. The pure, host-tested `logic/detect.hpp` narrows the **Altherma-only**
profiles (`def/signatures.hpp::is_detection_model` excludes the non-Altherma mini-chillers so they
can't be false candidates): each profile's **signature** (its page mask + a capacity class parsed from
its id) is derived automatically from the embedded `ValueDef` tables — no hand-maintained table. A
profile is a candidate when its pages are a subset of the answering pages **and** the unit's capacity
falls in its class; among those, only the ones with **maximal page overlap** are kept (dropping
feature-poor profiles). `detect_best()` then picks one deterministic representative (maximal overlap →
tightest kW class → stable order) — never the old blind `candidates.front()` registry order.

The result is applied only when the bus actually answered (a not-yet-wired unit retries next cycle
instead of pinning `generic`); the model goes to the in-RAM config (`config_set_runtime`), while a
changed link cache (pins/proto) is persisted (`config_save`):

- **exactly one candidate** → applied; the UI shows "Detected: <family> · ~kW".
- **several candidates** → the best-fit representative is read with — **every candidate is
  register-equivalent, so the decoded VALUES are identical regardless of which is named**. The 41
  Altherma models collapse to a few page-mask classes; within a class they differ only by untestable
  flag bits (e.g. an ERGA split vs an EBLA monobloc differ by one bit with identical labels), so the
  exact model **cannot** be determined from bus data. The UI reports this honestly — the distinct
  candidate **families** plus the O/U EEPROM digits to match the nameplate — rather than asserting a
  guessed name. The EEPROM is **not** decoded to a model name (no digit→name table; the one real path
  to exact ID would need an external EEPROM-code table).
- **none, bus answered** → the **generic Altherma profile** (`def/registry.hpp` `generic[]` = the ≥95%
  universal register core), so an unrecognized or S-protocol unit still reports every essential value.
- **no bus** → stays `auto` and retries; the UI reports the unit isn't responding (check X10A wiring).

The resolved `profile` and fingerprint (`fp_pages`/`fp_kw`/`fp_eeprom`) live only in the in-RAM config
— **the model is never persisted**, so it is re-identified on **every boot** (a unit moved to another
pump is always re-detected; no stale model survives a reset). The `proto`/`rx_pin`/`tx_pin` link cache
*is* persisted (see above). Within the session, `/status.detect` recomputes the candidates, their
distinct `families`, and the
`model{name,family,marketing}` display name from the in-RAM fingerprint cheaply (no re-probe; names
from `def/model_names.hpp`). `POST /detect` resets `profile` to `"auto"` and invalidates the
fingerprint to force a fresh pass immediately (no reboot needed). Detection is **fully automatic** —
there is no manual model selection or protocol control in the UI, and the UI shows model/protocol
only while the link is live (a cached fingerprint is never presented as a live reading).

## Push vs. poll (why the engine polls)

The X10A service port is a **strict request/response bus** — the ESP is always the master and the
unit only ever answers a query (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) §1). There is no
opcode, register or framing for the unit to send unsolicited/push frames, so **the firmware must
poll**; a "the pump pushes values to us" mode is not possible at the wire level. The pushes in the
system are all firmware → client: firmware → MQTT (the bridge publishes state on its own cadence)
and firmware → browser over the `/events` WebSocket (the poll task broadcasts values/status on
change). Both are downstream of — and independent of — the polled HP link.

## WiFi / LAN connectivity (reconnect + watchdog)

**Modem sleep is disabled** (`esp_wifi_set_ps(WIFI_PS_NONE)` right after `esp_wifi_start()`). The
IDF default `WIFI_PS_MIN_MODEM` parks the radio between DTIM beacons, adding ~100–300 ms (and, with
TCP retransmits, occasionally seconds) of non-deterministic latency to every inbound request — which
shows up as the web UI "sometimes taking very long to answer". This is a mains-powered bridge, so we
keep the radio awake for a consistently responsive HTTP UI and MQTT link.

**Strongest AP is selected, not the first one heard.** The STA config sets
`scan_method = WIFI_ALL_CHANNEL_SCAN` + `sort_method = WIFI_CONNECT_AP_BY_SIGNAL`. The IDF default
`WIFI_FAST_SCAN` stops at the first matching BSSID (channel-order/timing dependent), so on a
multi-AP network (mesh / several access points sharing one SSID) this stationary bridge would latch
onto whatever answered first — often a distant, weak AP — and never roam off it (the "weak WiFi
signal" symptom). The all-channel scan adds ~1–2 s per connect; the config persists, so every
reconnect re-selects the strongest AP. `failure_retry_cnt = 3` makes the STA **retry the ranked
(strongest) AP** a few times before falling back to the next one — without it the default (0) drops
to a weaker AP on the first association hiccup (observed live: a transient WPA3-SAE Hunt-and-Peck
auth failure on the −47 dBm AP handed the bridge a −74 dBm one). `sae_pwe_h2e = WPA3_SAE_PWE_BOTH`
advertises Hash-to-Element so the faster/robuster PWE is used when the AP supports it (H&P stays the
fallback). The `STA_DISCONNECTED` handler logs the disconnect `reason` (15/202/204 = transient
SAE/handshake, 201/211 = wrong creds) so a failed connect is diagnosable from `/diag`.

Three layers keep the WiFi station link up:

- **Event-driven reconnect** on every `WIFI_EVENT_STA_DISCONNECTED`. First-ever connect keeps a
  bounded budget then falls back to the **setup portal** (credentials presumed wrong); once the
  device has held an IP at least once, later drops reconnect **forever** (known-good creds — never
  strand the device on a transient AP/router outage).
- **Connectivity watchdog** (~30 s) ICMP-echoes the gateway to catch a missed-deauth "ghost"
  association (stack thinks it's up, forwards nothing). After 2 consecutive failures it forces one
  `esp_wifi_disconnect()` so the endless-retry handler reconnects. Guarded to act only on a
  believed-up link and only if the gateway has answered at least once; it **never reboots** (a
  reboot during an AP outage would drop into the setup portal and abandon good credentials).
- **Credential-change recovery** for WiFi edited *from the dashboard* (see "Web UI config flow"):
  the one-shot `/set_wifi` backup lets a bad new SSID/password roll back to the last working network,
  and a runtime guard reboots to that fallback after ≥5 consecutive AUTH_FAIL/handshake-timeout
  disconnects that begin only *after* the device had been online (the "password changed on the router"
  case) — distinct from the first-boot budget, which handles creds that were wrong from the start.

## Home Assistant MQTT bridge (`mqtt_ha.cpp`)

The Home Assistant bridge:

- **Read-only** — no command topics. The firmware only mirrors X10A telemetry; it never actuates
  the heat pump (the X10A protocol has no write command), so there is nothing to subscribe to.
- **Node id** `daikin_<mac3>` (WiFi STA MAC, stable across config changes).
- **Own publish task + esp-mqtt client.** The event handler only flips status flags; all publishing
  happens in the task, so the mqtt event loop is never blocked by string building.
- **Discovery is streamed.** A full Altherma value set can be 30–40+ entities; the bridge emits one
  entity's discovery config at a time (retained) on (re)connect, so it never needs one large
  contiguous heap block — the same memory discipline as the rest of the firmware. Layout-marker
  converters (docs/REGISTERS.md §3.6) get no sensor.
- **One shared grouped-JSON state topic** `<base>/<node>/state` (retained). Each cycle the task
  builds a single JSON object of every value, grouped one level deep by X10A register page
  (`logic/mqtt_group.hpp`, host-tested): `{ "<group>": { "<object_id>": value, … }, … }` (max
  nesting depth 1, e.g. `hydronic`, `outdoor_state`, `inverter`). Numbers are emitted unquoted,
  enum/text quoted. Every sensor's discovery config points at this one topic and subscripts its
  value out with a `value_template` (`value_json['<group>']['<object_id>']` — bracket notation, so a
  digit-leading slug like `2way_valve…` stays valid).
- **Units + device_class** are derived from each value's `dataType` field (the def's HA unit hint —
  1 = °C/temperature, 2 = bar/pressure, 3 = A/current; `unit_for_datatype`/`device_class_for_datatype`
  in `logic/convert.hpp`), so temperatures get `°C` + `temperature`, currents `A` + `current`, etc.,
  and HA renders them correctly with history.
- **Publish-on-change.** The heat pump is polled at a fixed 1 s interval for near-real-time readings,
  but the task republishes the state JSON **only when the payload actually changed** since the last
  publish (a plain string compare — a single JSON topic can't be updated per-value, so it is
  all-or-nothing). A full retained (re)seed goes out on (re)connect and when auto-detection resolves
  a new profile (which also re-streams discovery). So an idle pump does not flood the broker. The
  per-cycle build is wrapped in a try/catch: an OOM `std::string` build skips the cycle rather than
  throwing through the FreeRTOS task and rebooting.
- **Availability / LWT** on `<base>/<node>/status` (`online`/`offline`, retained) — the broker's
  last-will marks the device offline if it drops, and every sensor's `avty_t` points at it.
- **Heartbeat topic** `<base>/<node>/heartbeat` (not retained) carries board/link diagnostics,
  separate from heat-pump values, built by `logic/heartbeat.hpp` (host-tested):
  - **Board**: `version`, `platform`, `uptime_s` + a `"Ddd+HH:MM:SS.mmm"` `uptime` display string
    (`format_uptime`), `free_heap` / `min_free_heap` / `max_alloc` (largest free block — the
    binding OOM limit on this firmware).
  - **`wifi`**: `connected`, `rssi`, `quality_pct` (0-100%, `wifi_signal_quality_pct` — the
    standard dBm→% mapping, -50 dBm=100%/-100 dBm=0%), `reconnects` (cumulative RE-connects since
    boot, `wifi_reconnect_count()` in `wifi.cpp`, excludes the first-ever connect).
  - **`mqtt`**: `connected`, `count`/`fails` (every `esp_mqtt_client_publish()` call funnels through
    one `mqtt_publish()` wrapper in `mqtt_ha.cpp` so these cover discovery+state+heartbeat+LWT, not
    just one topic), `reconnects` (cumulative, excludes the first-ever connect).
  - **`bus`**: the X10A stats already tracked in `HpStats` — `connected`, `proto`, `registers`,
    `values`, `last_ok_s`, and nested:
    - **`rx`**: `received` / `fails` (cumulative successful/failed register reads, `HpStats.rx_ok`/`rx_fail_total`),
      `crc_err` / `timeout_err` (breakdown).
    - **`tx`**: `reads` (= `received + fails`, i.e. every register-read request sent), `writes`/`fails` always `0`
      (reported for schema parity since the X10A bridge is read-only).

  Published on a fixed `HEARTBEAT_INTERVAL_S` (10 s) cadence — unlike the state topic, this is
  diagnostics rather than real-time telemetry, so it always sends the latest snapshot rather than
  only on change. 16 diagnostic HA entities (WiFi signal/quality/reconnects, heap free/min-free/
  largest-block, uptime, last reset reason, X10A bus status/CRC/timeout/rx errors/rx received, MQTT
  publish count/fails/reconnects — tagged `"ent_cat":"diagnostic"`) point at this topic via their own
  discovery configs, streamed once per
  connection independently of heat-pump profile detection — so they show up even while the model is
  still "auto". Cumulative since-boot counters get `"stat_cla":"total_increasing"` (not
  `"measurement"`) so HA's long-term statistics handle a reboot's reset to 0 correctly. Mirrors the
  "device diagnostics" pattern of other ESP32 HA bridges (e.g. EMS-ESP's `heartbeat` topic).
- **TLS default-on with credentials** (mqtts, CA-verified via the mbedTLS certificate bundle). If
  credentials are set but the URI is not `mqtts://`, the bridge **refuses to connect** and reports
  the reason in `/status.mqtt` rather than sending them in cleartext — no silent plaintext fallback.
  A credential-free plaintext broker on the trusted LAN is allowed (nothing secret to leak).
- **Task-Watchdog-subscribed.** The `mqtt_pub` publish task subscribes to the Task Watchdog and
  feeds it **unconditionally at the top of its 1 s loop** — deliberately *not* gated on `s_connected`
  or an actual publish, because the loop keeps spinning during a broker outage (it just doesn't
  publish), and a reset gated on publishing would false-trip. It **also** feeds once per publish
  inside `mqtt_publish()` (the funnel every message goes through), mirroring `poll_once`'s
  per-register reset: a single (re)connect cycle bursts ~30 publishes (discovery + crash + state +
  heartbeat) and each `esp_mqtt_client_publish()` can block up to the client network timeout, so
  without a per-publish feed a slow-but-alive link could push one burst past the 20 s budget. So only
  a publish that genuinely wedges reboots the device; see *The poll engine → Task Watchdog* for the
  shared mechanism.

## OTA, signing, partitions

Structure:

- **Target:** esp32s3 only (`scripts/ci-build-all.sh`). No BLE is used, so the target is just "WiFi ESP32-S3s with ≥4 MB flash". Uses native USB-Serial/JTAG console.
- **Dual-OTA `partitions.csv`** sized to fill 4 MB; app at `0x20000`; `nvs` at `0x9000` untouched
  by OTA so WiFi + model config survive upgrades.
- **Core Dump to Flash (Crash Archiving)**:
  - Enabled via `CONFIG_ESP_COREDUMP_ENABLE`, `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH`, and `CONFIG_ESP_COREDUMP_DATA_FORMAT_ELF` in `sdkconfig.defaults`.
  - A dedicated `coredump` partition of size `0xc000` (48 KB) is placed at offset `0x12000` (in the unused gap between `phy_init` and `ota_0`), leaving the start offsets of `nvs`, `otadata`, `phy_init`, `ota_0`, and `ota_1` completely untouched for backward compatibility and OTA safety.
  - Exposed via a chunked HTTP GET endpoint `/coredump` (implemented in `http_status.cpp`) that streams the binary crash dump in 512-byte blocks to prevent OOM errors on the tight ESP32 heap.
  - Supports erasing the partition via `GET /coredump?clear=1` (invokes `esp_core_dump_image_erase()`).
  - **Boot-time capture + surfacing (so a crash isn't a silent blob in flash).** `diag_crash.cpp`
    runs once early in `app_main`: it reads `esp_reset_reason()` and, if a valid dump exists, parses
    its **summary** (`esp_core_dump_get_summary()` — crashed task, exception PC, backtrace PCs, and
    the crashed build's `app_elf_sha256`) into a cached `CrashInfo`. The pure formatting is
    `logic/crashinfo.hpp` (host-tested); the summary is parsed **once** and cached — never re-read
    from flash on a request path, since `build_status_json_string()` also runs in the poll task's
    WebSocket broadcaster (which only self-guards `std::bad_alloc` by dropping the frame). The
    `coredump` **presence flag** is the one exception: it IS re-checked from flash per request
    (`diag_crash_info_live()` — a 4-byte size-word read, not the summary reparse), because the image
    can be erased mid-session via `/coredump?clear=1` and a cached flag would then advertise a dump
    that flash no longer holds. A *fault* reset (panic / watchdog / brown-out / CPU lockup) or an
    orphan dump is "notable"; a clean power-on / software reboot is not.
  - **Always-on system health (no fault required).** `build_status_json_string()` also carries a
    compact `sys` block — `free_heap` / `min_free_heap` (since-boot low-water, the leak indicator) /
    `max_alloc` (largest contiguous block, the true OOM ceiling), the `reset_reason` slug (via
    `logic/reset_reason.hpp`, reusing the same vocabulary as `last_crash`) and a `safe_mode` flag
    (always `false` until the boot-loop safe-mode feature lands). These answer "why did it reboot?"
    and "is the heap leaking?" from the LAN / `/events` WebSocket **on every boot** and **without a
    broker** — the MQTT heartbeat carries the same heap figures, but only when MQTT is configured. The
    dashboard ESP32 card shows the reset reason (fault-coloured) and free heap.
  - **How a user hands a crash over.** `GET /status.last_crash` is `null` on a clean boot, else the
    boot-time cached reason/summary — with `coredump` re-read live from flash on every request
    (`diag_crash_info_live()`), so a dump cleared via `/coredump?clear=1` can't leave a stale banner or
    a dead download link. The running app's `app_elf_sha256` is also on `/status`. The web UI shows a
    crash **banner** (`renderCrashBanner()`) — titled on `fault`, so an orphan dump doesn't claim this
    boot crashed — with the reset reason + hex backtrace, a one-click `coredump.bin` download, and a
    "copy diagnostics" bundle (`/status` + `/diag` + summary) for a bug report. The MQTT bridge
    additionally **retains** the summary on `<base>/<node>/crash` (reason + "dump waiting" flag as 2
    diagnostic HA entities — reason/backtrace only, never secrets or the raw dump), so Home Assistant
    (or Telegraf → VictoriaLogs) sees crashes over time; it is published once per (re)connect **and**
    republished on the heartbeat cadence whenever the `coredump` flag changes, so a retained "Crash
    Dump Waiting" can't stay latched ON after the dump is pulled and cleared.
  - **Decoding (maintainer side).** A raw dump is useless without the *matching-version* unstripped
    `.elf` (the shipped `.bin` has no symbols), so CI archives `daikin-altherma-esp32.elf` + its
    sha256 per build (artifact + Release asset, `scripts/ci-build-all.sh`). `scripts/decode-coredump.sh
    coredump.bin [app.elf]` runs `esp-coredump info_corefile` inside the CI-pinned ESP-IDF Docker
    image and matches the dump to the ELF by `app_elf_sha256` (warns on mismatch). VictoriaTraces is
    *not* the sink for this — a crash is a log/event, not a span; VictoriaLogs (via the retained MQTT
    topic + Telegraf) is.
- **Signed OTA** (Secure Boot v2 RSA-3072 *without* hardware Secure Boot): the running app verifies
  the signature before installing. The **connectivity health gate is implemented** (commit only after
  a base window AND getting online, else stay `PENDING_VERIFY` → a reboot rolls back); the **pull
  check/download + downgrade gate are TODO stubs** (`ota_update.cpp`). Web installer publishes
  merged bin + a single `manifest.json` (esp-web-tools loads this).
- **Boot recovery / anti-brick** — an unsigned app aborts pre-`app_main`, so only the bootloader can
  recover, and only via a previous OTA slot; a direct USB flash of an unsigned build both crash-loops
  and wipes the fallback. Contained by the pre-flash guard `scripts/require-signed.sh`. Full model,
  including the three failure modes and the health gate, in [SECURITY.md](SECURITY.md) → Boot recovery.
- **PR preview installer**: every same-repo PR publishes a signed preview at
  `…/PR/<N>/` on the `gh-pages` branch (fork PRs get no signing key → no preview). OTA always
  checks against **main**.

## Boot-loop safe mode (config recovery)

The OTA rollback health gate recovers a bad *firmware image*. It does **not** help a bad *config* —
both OTA slots read the same `daik_cfg` NVS, so rolling the image back keeps the offending setting
(most plausibly wrong RX/TX pins, or anything that crashes a background task at start-up). Left
alone, that is a reboot loop whose only exit is `esptool erase_flash` over USB — which breaks the
"recover everything from the web UI" promise. Safe mode closes that gap:

- **Decision logic** is the pure, host-tested `logic/boot_guard.hpp`: `boot_reset_was_crash()`
  classifies a reset as a crash **only** for panic / interrupt-wdt / task-wdt / other-wdt / brownout
  (deliberately narrower than `crashinfo`'s fault set — a power-glitch or CPU-lockup a config change
  can't fix does not count); `boot_next_fail_count()` is a saturating increment that treats a
  corrupt/first-run read as 0; `boot_should_enter_safe_mode()` is the threshold rule
  (`BOOT_FAIL_THRESHOLD`, default 4).
- **Device glue** is `safe_mode.cpp`, called from `app_main` right after `config_load` and **before**
  any risky subsystem. On a crash reset it increments the `boot_fails` counter in `daik_cfg` and
  **commits it before** the poll engine / MQTT start (so the bump survives another crash), latching
  safe mode at the threshold. A clean or intentional reboot (power-on, a config-save restart, OTA)
  **resets the counter to 0** — this is the key correctness point, because provisioning is a rapid
  burst of config-save reboots that must never be mistaken for a crash-loop. A one-shot timer clears
  the counter after `BOOT_HEALTHY_S` (30 s) of continuous uptime, so a single old crash doesn't
  accumulate with a much later, unrelated one.
- **In safe mode** `main.cpp` starts only WiFi + the HTTP web UI + the OTA health gate and **skips**
  the X10A poll engine and the MQTT bridge (the two background subsystems a bad config could crash
  on). The full recovery surface (`/set_wifi`, `/set_mqtt`, `/set_hp`, and — once #9 lands — factory
  reset / import) stays available. `/status.sys.safe_mode` is `true` and the UI shows a warn-accented
  **Recovery mode** banner. The counter lives in `daik_cfg`, so a factory reset wipes it too.

This is distinct from the image anti-brick recovery above; both are covered in
[SECURITY.md](SECURITY.md) → Boot recovery.

## Web UI config flow

`www/` is split for edit locality (index.html markup + style.css + app.js) and spliced into ONE
self-contained, pre-gzipped page at build time (`inline_assets.cmake`). The UI is a **single
dashboard** — no Settings page, no sub-screens; it drives the config endpoints in place:

- **WiFi** → `/set_wifi`, provisioned first from the captive `setup.html` and thereafter **re-editable
  from a dashboard modal** off the WiFi card (pencil). Save validates SSID (1–32) + password (empty or
  8–63) both in the UI and via the host-tested `wifi_credentials_valid()` (`logic/config_model.hpp`),
  then persists + reboots. The dashboard shows the live link (SSID + IP + RSSI signal bars, plus the
  associated AP's PHY standard + BSSID and this STA's MAC) from `/status.wifi`, populated by
  `wifi_info()`. **One-shot rollback:** if new credentials were entered over the LAN and the STA can't
  get a lease after the reboot, `wifi_start_sta()` restores the previous credentials from an NVS backup
  and reboots again (cleared on a successful connect) — so a wrong SSID/password never strands the
  device in the setup AP. A runtime guard also reboots to the fallback after ≥5 consecutive
  AUTH_FAIL/handshake-timeout disconnects that begin only after the device had been online.
- **MQTT** → `/set_mqtt` (edited from a dashboard modal off the MQTT card). Unlike Syslog, Save
  **pre-flights the broker synchronously** (DNS → TCP port → a short-lived esp-mqtt connect/auth,
  heap-guarded) and only persists + reboots on success — a bad host/port/password is rejected inline;
  an empty username+password keeps the stored credentials.
- **Syslog** → `/set_syslog` (edited from a dashboard modal off the Syslog card). Save only
  validates the port range (no request-path network block); an empty host disables forwarding. DNS
  resolution and the advisory reachability probe run in the syslog task and surface on the card via
  `/status.syslog` (`resolved`/`reachable`/`error`) — "Enabled", "…host not answering ping", or "DNS
  lookup failed" — after the reboot.
- **Heat pump** → `/set_hp`: fully automatic. The model is **auto-detected** (see Auto-detection) and
  shown read-only on the dashboard **Model** card. The dashboard **ESP32** card shows the X10A link +
  protocol and the **RX/TX pins**, which are also auto-detected: **read-only** while the bus answers,
  and a **dropdown** of the board's usable GPIOs (`/status.pins_avail`) when it doesn't — picking a
  pin posts `{profile:"auto", rx, tx}` to re-run detection on that pair. The RX/TX pins are
  **persisted** (a manual pick survives reboot); the model is session-only. Protocol is auto-detected
  (no UI control), the poll interval is fixed at 1 s (not sent), and labels are English-only (no
  `lang`). `/set_hp` accepts only `{profile, rx, tx}`.
- **Firmware / OTA** — tapping the version on the ESP32 card checks for an update (`/ota/*`; a TODO
  placeholder until a release feed exists, see `ota_update.cpp`).

The board/platform is reported by `/status.platform` — the chip name
shows on the dashboard ESP32 card.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the
largest *contiguous* free block): keep every HTTP handler under the `handle_all` try/catch (503 on
OOM), stream `/diag` and the MQTT discovery instead of building one big `std::string`, and treat
any new large contiguous allocation (big JSON, OTA TLS) as a crash risk to size-check. A reboot
loop is bad here too — it stops the poll cycle and drops MQTT availability.

Two rules follow from that, and they apply to **every** FreeRTOS task loop that allocates, not just
to HTTP handlers:

1. **The task loop self-guards.** A task entry is a C frame boundary exactly like a handler is, so an
   escaping `std::bad_alloc` means `std::terminate()` → reboot. Wrap the loop *body* in
   `try/catch (const std::exception&)` + `catch (...)`, `diag_printf` once, skip the cycle keeping
   the last good state, and continue after the normal delay. `mqtt_task` (`mqtt_ha.cpp`) and
   `poll_task` (`hp_poll.cpp`) both do this; `ws_broadcast_values`/`ws_broadcast_status`
   (`http_status.cpp`) keep their own finer-grained guards inside it — they skip a single client or
   frame rather than the whole cycle, and the task guard is only their backstop.
2. **Nothing allocates while a mutex is held.** Rule 1 only makes an OOM survivable if the throw
   doesn't strand a lock: `xSemaphoreTake` is not released by stack unwinding, so a throw inside a
   critical section leaves the mutex taken forever, every reader blocks on `portMAX_DELAY`, and the
   device wedges into a watchdog reboot — the failure the guard was supposed to prevent, in a worse
   form. So either the critical section is non-allocating — `poll_once` stages its stat deltas and
   error text in locals and folds them in with `+=`/`swap` (noexcept), so the commit cannot throw —
   or the lock is taken through an RAII guard, like `hp_poll.cpp`'s `Lock`, which the readers
   (`hp_stats`, `hp_values_snapshot`) need because they copy `std::string`s out under the lock.
