# daikin-altherma-esp32

ESP-IDF 5.x firmware for the ESP32-S3 chip. Reads a **Daikin Altherma** heat
pump over its **X10A** service port and bridges every value to **Home Assistant over MQTT**
(auto-discovery). Everything — WiFi (captive portal), MQTT, the unit model, the register set,
the RX/TX pins — is configured at runtime from a **web UI**; firmware is installed from a
**browser** (Web Serial) and updated **OTA**. Builds for the **esp32s3** target only.

> **Deep reference:** this file holds the always-needed essentials. Full narrative for the poll
> engine, value profiles, MQTT bridge, WiFi reconnect and OTA lives in
> [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — read it on demand. The X10A wire protocol
> (framing, checksum, register pages, detection) is in
> [`docs/X10A_PROTOCOL.md`](../docs/X10A_PROTOCOL.md), and the converter-id/enum tables plus a full
> register map in [`docs/REGISTERS.md`](../docs/REGISTERS.md). A cross-cutting catalog of the
> platform features this firmware implements (Secure Boot v2 signing, OTA + health gate, WebSocket,
> ESP-IDF component inventory, diagnostics) is [`docs/FEATURES.md`](../docs/FEATURES.md) — keep it
> current with the `feature-docs` skill when a technical feature lands or changes. User-facing docs:
> [`README.md`](../README.md), [`docs/README.md`](../docs/README.md),
> [`docs/SECURITY.md`](../docs/SECURITY.md), [`docs/DESIGN.md`](../docs/DESIGN.md) (web-UI design
> contract). Keep them in sync (the `project-review` skill checks for drift).

**Conventions:** always write the full name `daikin-altherma-esp32` (hostname, SoftAP, MQTT base
topic, docs) — never shorten it to `daikin-altherma`. Do not reference other projects by name in
the code or docs; the heat-pump-protocol credit belongs only in the README "Scope & credits"
section at the bottom.

## Environment note (Claude Code on the web / remote sandbox)

A cloud session **cannot build** (no Docker daemon for `scripts/idf-docker.sh`) and **cannot
USB-flash** (no USB passthrough) — it is for editing, review and CI-driven builds. The
`report-capabilities.sh` SessionStart hook prints what the current environment supports.

**But there IS a real local verification loop** — the host mock build runs the project's pure
logic with the plain system toolchain (no ESP-IDF/Docker/board), so decoding/config/discovery
changes can be *verified*, not just reasoned about, even in a cloud session:

```bash
scripts/run-mock-tests.sh   # compile + run host logic tests in seconds (cmake + g++/clang++)
```

It covers the X10A **CRC** and framing (`logic/crc.hpp`), the **value converters**
(`logic/convert.hpp` — the riskiest part of the port), register extraction
(`logic/registers.hpp`), the **config model / validation** (`logic/config_model.hpp`) and the
**HA-discovery payloads** (`logic/discovery.hpp`). CI gates the firmware build on it
(`logic-test` job). Add new decode/format logic to `main/logic/` and a `CHECK` in
`test/test_logic.cpp` — never bury it in a `.cpp` only the device can run. Full detail:
[`test/README.md`](../test/README.md).

## Build & Flash

No local ESP-IDF — builds run via `scripts/idf-docker.sh`, which uses the `espressif/idf` Docker
image **pinned to the version CI builds with** (read at runtime from
`.github/workflows/build.yml`). Flash from the host with `esptool` (`brew install esptool`),
since Docker on macOS has no USB passthrough. The `flash-esp32` skill wraps both.
When waiting on CI, block on `gh run watch <run-id> --exit-status` — never sleep-poll.

```bash
# Build (first run: set-target; afterwards plain `build` stays incremental). CI builds esp32s3.
scripts/idf-docker.sh idf.py set-target esp32s3 build

# Optional compile-time defaults (all also settable at runtime in the web UI)
scripts/idf-docker.sh idf.py menuconfig                 # -> Daikin Altherma Configuration

# Sign the app first — REQUIRED. This config uses the Secure Boot v2 signature scheme
# (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT); an UNSIGNED image crash-loops at boot
# (esp_secure_boot_init_checks abort, before app_main). Needs the offline ota_signing_key.pem
# (never committed; see docs/SECURITY.md). No eFuses burned -> unsigned is a crash-loop, not a brick.
espsecure.py sign_data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" \
  --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
cp build/daikin-signed.bin build/daikin-altherma-esp32.bin   # @flash_args flashes this path

# Guard: refuse to flash an UNSIGNED image (would crash-loop before app_main + wipe the fallback).
# Exits non-zero with the signing command if unsigned. The flash-esp32 skill runs this for you.
scripts/require-signed.sh build/daikin-altherma-esp32.bin

# Flash from the host (preserves nvs — @flash_args skips nvs@0x9000)
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
```

The reference board is the **Seeed XIAO ESP32-S3** — native USB-Serial/JTAG, flashes without a
BOOT-button dance. Its X10A pins default to **RX=44 (D7) / TX=43 (D6)**; GPIO16/17 are not
broken out on the XIAO.

## Architecture (component map)

```
main.cpp        boot: NVS, config, safe-mode guard, WiFi(STA)|setup-AP, mDNS, HTTP, MQTT, poll, OTA gate
safe_mode.cpp   boot-loop safe mode (logic/boot_guard.hpp): counts crash-only boots in NVS "daik_cfg"
                (boot_fails); past BOOT_FAIL_THRESHOLD it latches -> main.cpp skips the poll engine + MQTT
                bridge (WiFi + web UI + OTA stay up) so a bad config (e.g. wrong RX/TX pins) is fixable
                in-browser, not over USB; a clean/intentional reboot resets the count, and a
                BOOT_HEALTHY_S-uptime timer clears it. Drives /status.sys.safe_mode + the UI recovery banner
config.cpp      runtime Config (logic/config_model.hpp): WiFi/MQTT + one-shot WiFi rollback backup +
                link cache (pins/proto) in NVS "daik_cfg"; model (profile/fingerprint) RAM-only
                (config_set_runtime); mutex-guarded
nvs_storage.cpp thin NVS helpers (IDF nvs_* called with :: to avoid the daik::nvs_* collision)
wifi.cpp        STA bring-up (all-channel scan -> strongest AP by RSSI) + endless reconnect
                (first-boot budget -> setup portal) + one-shot credential rollback (new creds fail to
                get a lease -> restore the NVS backup + reboot; runtime credential-change detection:
                >=5 consecutive AUTH_FAIL/handshake-timeout disconnects after having been online ->
                reboot to fallback) + ICMP gateway watchdog (ghost-assoc recovery; the probe is
                three-valued and the policy is host-tested in logic/link_watch.hpp — proven silence
                re-associates after 2 periods, a SUSTAINED inability to probe at all after 10, since
                "couldn't measure" previously read as "healthy" and left a wedged board undetected
                AND unlogged; decisions go to diag_printf so they reach /diag + syslog, not just the
                serial console) + scan + DHCP
                hostname (option 12) + mDNS; wifi_info() also reports the associated AP's BSSID + PHY
                standard + this STA's MAC; wifi_reconnect_count() — cumulative RE-connects since boot,
                for the MQTT heartbeat
provisioning.cpp setup SoftAP (daikin-altherma-esp32-setup) + DHCP DNS-offer; HTTP is the shared :80 server
captive_dns.cpp UDP:53 catch-all (every name -> 192.168.4.1) so the setup portal auto-pops (AP mode only)
hp_comm.cpp     X10A UART (9600 8E1) + register query
hp_convert.cpp  device value formatting over logic/convert.hpp
hp_detect.cpp   auto-detect glue: protocol sweep + page probe -> fingerprint -> candidate models
hp_poll.cpp     poll engine task: (auto-detect if profile=="auto") profile registers -> query ->
                decode -> thread-safe cache; also drives the /events WebSocket push
                (ws_broadcast_values every cycle, ws_broadcast_status every 4th). Subscribed to the
                Task Watchdog (esp_task_wdt_add): reset per cycle + once per register in the sweep, so
                a wedged X10A read reboots cleanly (reset reason task_wdt) instead of hanging silently.
http_server.cpp esp_http_server :80; concerns register their own routes (http_handlers.hpp)
http_status.cpp GET / (setup.html in AP mode, else gzip UI) /status /values /models /diag /scan
                /coredump + /events (WebSocket live push) + captive catch-all
http_config.cpp POST /set_wifi /set_mqtt /set_syslog /set_hp /detect
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp (read-only MCP tools; TODO)
mqtt_ha.cpp     HA MQTT-Discovery bridge: esp-mqtt client + publish task; ONE shared grouped-JSON
                state topic <base>/<node>/state (logic/mqtt_group.hpp), republished on change; LWT
                availability, mqtts+CA on creds; board/link diagnostics on <base>/<node>/heartbeat
                (logic/heartbeat.hpp), published on a fixed 10s cadence (HEARTBEAT_INTERVAL_S) —
                heap(free/min-free/largest-block)/uptime/reset_reason/wifi(+reconnects)/mqtt(pub
                count+fails+reconnects)/X10A bus (rx_received/rx_fails) stats, 16 diagnostic HA entities
                streamed independently of profile detection. Also RETAINS the boot-time crash summary
                on <base>/<node>/crash (logic/crashinfo.hpp) once per (re)connect PLUS a republish on
                the heartbeat cadence whenever the "dump waiting" flag changes (diag_crash_info_live();
                a retained true would otherwise latch ON in HA until the next reconnect once the dump
                is pulled + cleared) — last reset reason
                + a "dump waiting" flag as 2 more diagnostic HA entities (reason/backtrace only, never
                secrets or the raw dump). Every publish funnels through one mqtt_publish() wrapper so mqtt.count/mqtt.fails
                cover every topic, not just state. The mqtt_pub task is Task-Watchdog-subscribed
                (esp_task_wdt_add) and resets UNCONDITIONALLY at the top of each 1s cycle (not gated on
                connect/publish, so a long broker outage can't false-trip) PLUS once per publish inside
                mqtt_publish() (so a ~30-publish reconnect burst on a slow link can't exceed the 20s
                budget) — a wedged publish reboots, a slow-but-progressing one never does.
ota_update.cpp  pull-based signed OTA + rollback health gate (check/download: TODO)
diag_log.cpp    in-RAM diag ring served by GET /diag; each line is also forwarded to syslog_send()
syslog.cpp      optional syslog UDP client (RFC 5424): a task DNS-resolves the configured host, then
                forwards every diag_printf() line as one UDP datagram; disabled when syslog_host is
                empty. Delivery is gated on DNS ONLY — an ARP(local)/ICMP reachability probe is
                ADVISORY (feeds /status.syslog.reachable, never gates sends: syslog is best-effort UDP
                and a healthy collector may firewall ICMP). File-scope ping-control (like wifi.cpp's
                s_wd) so the async esp_ping callback can't use-after-free. syslog_status() feeds
                /status. Self-loop-guarded (drops "syslog:" lines). On the FIRST resolve of a boot it
                replays the boot records ONCE (logic/bootlog.hpp) straight down the socket — a
                build-identity line (version/elf_sha256/reset/safe_mode) + the crash records if the
                last boot was a fault. diag_crash_capture() runs before WiFi/this task exist, so
                without the replay the crash reached only the in-RAM ring (overwritten within a
                minute by a chatty failure mode) — never syslog. NOT via diag_printf: the queue is
                full of the boot backlog by then and the enqueue is non-blocking (it would drop
                exactly these lines). A send failure is CLASSIFIED (logic/syslog_policy.hpp): only a
                HARD errno (ENETUNREACH/EHOSTUNREACH/...) clears the resolve throttle; a TRANSIENT one
                (ENOMEM — what a ghosted link returns for every datagram) holds the destination and
                waits for the 10s cadence, so a chatty diag stream can't drive a getaddrinfo+ICMP
                storm. The errno is captured INSIDE syslog_sendto before close() (close may clobber
                it, and it now decides the throttle). Failures log the TRANSITION (one line paused,
                one recovered), not every dropped line.
diag_crash.cpp  one-shot boot capture of the reset reason (esp_reset_reason) + core-dump SUMMARY
                (esp_core_dump_get_summary: crashed task/PC/backtrace/app-elf-sha) into a cached
                CrashInfo (logic/crashinfo.hpp); read by /status.last_crash + the MQTT crash topic —
                the summary is NEVER re-parsed on a request path (build_status_json also runs in the
                poll task's WS broadcaster, which only self-guards std::bad_alloc by dropping the frame).
                EXCEPTION: the `coredump` flag is re-read from flash per request (diag_crash_info_live()
                — a 4-byte size-word read, NOT the summary parse), because /coredump?clear=1 can erase
                the image mid-session; a cached flag would strand an uncleanable crash banner + a
                download that 404s. mqtt_ha republishes the retained crash topic when the flag changes
logic/          IDF-free, host-tested pure headers (crc, convert, registers, config_model,
                discovery, detect, mqtt_group, heartbeat, crashinfo, bootlog, reset_reason,
                boot_guard, board_pins, modbus, syslog_policy, link_watch).
                bootlog.hpp = the records syslog.cpp replays once per boot: build_boot_line (version/
                elf_sha256/reset/safe_mode — the only way to tell WHICH firmware produced a log
                stream) + build_crash_log_lines (the crash as single-line, datagram-sized records;
                returns 0 for a non-notable boot, so the "don't spam the collector" rule is
                host-tested). Deliberately NOT crashinfo's multi-line build_crash_text(), which at
                worst case (~340 B) truncates past diag's 256-byte line buffer and loses elf_sha256.
                syslog_policy.hpp classifies a send errno HARD (route/destination implicated ->
                re-resolve now) vs TRANSIENT (ENOMEM/ENOBUFS: hold the destination, keep the 10s
                throttle) — treating every failure as hard turned each failed diag line into a
                getaddrinfo + 3x1s ICMP probe, a storm on a ghosted link. link_watch.hpp = the
                connectivity-watchdog policy: a gateway probe is three-valued (Reachable /
                Unreachable / Unmeasurable), so "couldn't measure" stops masquerading as healthy;
                proven silence re-associates after 2 periods, sustained blindness after 10.
                reset_reason.hpp maps a reset code to the /status.sys.reset_reason slug (reusing
                crashinfo's crash_reason_slug — one vocabulary). boot_guard.hpp = the safe-mode decision
                logic (crash-only counting, saturating increment, threshold) driving safe_mode.cpp.
                detect.hpp narrows the
                Altherma-only model profiles from a bus fingerprint (page mask + capacity) to a
                register-equivalent candidate set + a best-fit representative (detect_best);
                mqtt_group.hpp maps a register page to a friendly group name and builds the grouped
                state JSON; heartbeat.hpp builds the board/link diagnostics JSON + its diagnostic HA
                discovery configs; crashinfo.hpp turns a captured CrashInfo (reset reason + core-dump
                summary) into the last_crash JSON / MQTT crash payload + a paste-friendly text bundle,
                and classifies which reset reasons are faults; board_pins.hpp = per-target usable X10A
                GPIOs (the RX/TX pin-picker dropdown when detection hasn't locked the pins);
                modbus.hpp = Modbus TCP framing (MBAP, no CRC) + HomeHub register codecs
                (Temp16/Pow16/Int16/Text16 decode+encode) + the homehub-* mDNS filter — host-tested
                core for the PLANNED firmware-exclusive HomeHub Modbus link (issue #32), not yet wired.
def/            embedded per-model value profiles + registry (incl. the generic Altherma fallback =
                universal register core) + models_catalog.hpp (GET /models) + model_names.hpp
                (id→display/family/marketing name for /status) + signatures.hpp (Altherma-only
                detection signatures derived from the tables). Profiles are machine-generated in the
                ValueDef row format by decoding Daikin's value catalog (tools/profiles/, docs/REGISTERS.md).
www/            web UI sources (index.html + style.css + app.js -> one gzipped page) + setup.html
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `wifi_ssid`/`wifi_pass`, the one-shot WiFi rollback backup `wifi_ssid_back`/`wifi_pass_back`/`wifi_rollback` (see `/set_wifi`), `mqtt_uri`/`mqtt_user`/`mqtt_pass`, `syslog_host`/`syslog_port` (empty host = off), the X10A **link cache** `rx_pin`/`tx_pin`/`proto`, and the boot-loop **crash counter** `boot_fails` (safe_mode.cpp; here so a factory reset wipes it too). (Hostname is fixed at `CONFIG_DAIKIN_HOSTNAME`, poll cadence at `POLL_INTERVAL_S`=1 s, labels English-only.) |

**The link is persisted; the model is not.** The RX/TX pins + protocol are the physical, boot-invariant
X10A link — cached in NVS, tried FIRST by the detection sweep (defaults as fallback, so a stale cache
self-heals), and re-persisted only when they change. The **model** (`profile` + fingerprint `fp_*`) is
re-detected on **every boot**: `config_load` seeds `profile="auto"`, and `poll_detect` applies the
model in RAM only (`config_set_runtime`) — so a swapped unit is re-identified, and `profile`/`fp_*` are
**not** in NVS. `poll_detect` calls `config_save` (persist) only when pins/proto change, else `config_set_runtime`.

`nvs` at `0x9000` is untouched by OTA (partitions.csv) so config survives upgrades. Keep its
offset/size stable across versions.

## HTTP API

```
GET  /            embedded web UI (gzipped into the app binary)
GET  /status      version, platform, uptime_s, app_elf_sha256 (build identity — matches a core dump
                  to its .elf), pins_avail[] (per-target usable X10A GPIOs for the RX/TX picker —
                  logic/board_pins.hpp), wifi{ssid,ip,rssi,connected,bssid,mac,std} (bssid/std are the
                  associated AP's BSSID + PHY standard name e.g. "Wi-Fi 4", null while offline; mac is
                  this STA's own MAC, always present), mqtt,
                  syslog{configured,resolved,reachable,host,port,error},
                  hp{proto,rx,tx,connected,
                  last_ok_s,registers,values,crc_err,timeout_err}, profile{id},
                  sys{free_heap,min_free_heap,max_alloc,reset_reason,safe_mode} — heap headroom (free /
                  since-boot low-water / largest-contiguous) + why the device last booted, ALWAYS
                  present (unlike last_crash, and unlike the MQTT heartbeat needs no broker); reset_reason
                  via logic/reset_reason.hpp, safe_mode = the latched boot-loop recovery flag (safe_mode.cpp;
                  true once too many crash boots accumulated -> poll + MQTT skipped),
                  last_crash (null unless this boot was a FAULT or a dump is still in flash, else
                  {reason,reason_code,fault,coredump,task,pc,backtrace[],corrupted,elf_sha256} — the
                  reason/summary from the boot-time cache, `coredump` re-read from flash per request
                  so a cleared dump can't strand the banner; drives the crash banner, whose title keys
                  on `fault` — an orphan dump alone is NOT "restarted after a crash"),
                  detect{proto,valid,capacity_kw,ou_eeprom,candidates[],families[],ambiguous,
                  model{name,family,marketing}} — drives the dashboard ESP32 board card + model card.
                  RX/TX are auto-detected: read-only on the card while the bus answers, a pins_avail
                  dropdown (re-runs detection) when it doesn't.
GET  /values      decoded readings [{label,value,unit}]
GET  /events      WebSocket live push (is_websocket). Client sends "sub" -> gets a status+values
                  snapshot, then the poll task pushes {"type":"status"|"values",...} frames on change
                  (status ~4s, values ~1s). The ONLY live UI transport — there is no HTTP polling; a
                  browser without WebSocket loads a one-time /status+/values snapshot and the user
                  reloads to refresh. NOT under the http_register OOM guard (raw registration
                  needed) — the handler self-guards its JSON build.
GET  /models      pin hint + catalog metadata (def/models_catalog.hpp). Detection is fully automatic;
                  the UI no longer offers a manual model picker.
GET  /diag[?verbose=0|1][?clear=1]   in-memory diag log
GET  /scan        WiFi scan (setup)
GET  /coredump[?clear=1]   stream the flash core-dump image (chunked octet-stream; 404 if none);
                  ?clear=1 erases the coredump partition. Decode offline against the matching-version
                  .elf: scripts/decode-coredump.sh coredump.bin (CI archives the .elf per build). The
                  UI surfaces a crash banner + one-click download when /status.last_crash is set.
POST /set_wifi    {ssid,pass} -> validate (ssid 1-32 chars; pass empty[open] or 8-63) -> persist +
                  reboot. If WiFi was already configured, the OLD ssid/pass are stashed as a one-shot
                  NVS backup (wifi_rollback flag): after reboot, if the new creds fail to get a DHCP
                  lease, wifi_start_sta restores the backup + reboots; a successful connect clears it.
                  So a bad SSID/password entered over the LAN self-heals to the last working network
                  instead of stranding the device in the setup AP.
POST /set_mqtt    {broker,user,pass} -> pre-flight the broker synchronously (DNS -> TCP probe ->
                  short-lived esp-mqtt CONNECT/auth, mirroring mqtt_ha's creds-require-mqtts:// policy)
                  -> on success persist + reboot; on failure 400 {ok:false,error} and nothing is saved.
                  Unchanged settings short-circuit to {ok:true,reboot:false} (no probe, no reboot).
                  "" (empty broker) disables MQTT and skips the probe. Blocks up to ~8 s — the one
                  request-path network block (syslog/wifi don't); safe under the handle_all 503 guard.
POST /set_syslog  {host,port} -> validate port range -> persist + reboot. Empty host disables syslog.
                  DNS/reachability are NOT checked here (no request-path network block); they resolve
                  in the syslog task and surface via /status.syslog {resolved,reachable,error}.
POST /set_hp      {profile,rx,tx} -> validate + apply live (no reboot). rx/tx PERSIST (the physical
                  pin cache — a manual override survives reboot); profile is session-only. The UI
                  always sends profile="auto" (fully automatic — no manual model pick); a concrete id
                  is still accepted (pins the model for this session) but never offered in the UI.
                  proto is NOT accepted (auto-detected); poll_s fixed at 1 s and lang removed
                  (English-only) — neither accepted. RX/TX are auto-detected; when the bus is silent
                  the ESP32 card's pin dropdown posts {profile:"auto",rx,tx} to re-run detection.
POST /detect      re-run auto-detection now (no reboot): reset profile to "auto" + invalidate the
                  fingerprint (RAM only) -> the next poll cycle sweeps protocol + re-fingerprints
GET  /ota/check   POST /ota/update   GET /ota/status
POST /mcp         MCP server (read-only; planned — route returns a JSON-RPC "not implemented" error)
```

No HTTP auth / TLS by design — trusted LAN only. See docs/SECURITY.md.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest *contiguous* free
block). Keep HTTP handlers under a try/catch that returns 503 on OOM (an uncaught throw unwinds
through C frames → `std::terminate` → reboot). Stream `/diag` and the MQTT discovery instead of
one big `std::string`. Treat any new large contiguous allocation as a crash risk. A reboot loop
also stops the poll cycle and drops MQTT availability.

**Every allocating FreeRTOS task loop must self-guard.** A task is a C frame boundary like a
handler is: an escaping `std::bad_alloc` → `std::terminate` → reboot. Wrap the loop *body* in
`try/catch (const std::exception&)` + `catch (...)`, `diag_printf` once, skip the cycle keeping the
last good state, and continue after the normal delay — see `mqtt_task` (mqtt_ha.cpp), `poll_task`
(hp_poll.cpp) and the finer-grained `ws_broadcast_*` guards (http_status.cpp).

**Never allocate while holding a mutex.** The guard above makes an OOM survivable only if the throw
doesn't strand a lock: a mutex taken with a raw `xSemaphoreTake` is *not* released when the stack
unwinds, so every reader then blocks `portMAX_DELAY` and the device wedges into a watchdog reboot —
worse than the crash the guard prevents. Either keep the critical section non-allocating (stage the
work in locals, `swap`/move it in — `poll_once`'s commit) or take the lock through an RAII guard
(`hp_poll.cpp`'s `Lock`, for readers that must copy strings out under the lock).

## Typical debugging

```bash
scripts/run-mock-tests.sh                              # host logic tests (the fast loop)
screen /dev/cu.usbmodemXXXX 115200                     # serial monitor (native USB on s3)
curl http://daikin-altherma-esp32.local/status | jq          # device status (incl. last_crash)
curl http://daikin-altherma-esp32.local/values | jq          # decoded values
curl http://daikin-altherma-esp32.local/coredump -o coredump.bin   # pull a crash dump (if any)
scripts/decode-coredump.sh coredump.bin                # symbolize it against the matching .elf
esptool --chip esp32s3 -p <port> erase_flash           # wipe NVS (reset config)
```
