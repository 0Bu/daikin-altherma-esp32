# daikin-altherma-esp32

ESP-IDF 6.x firmware for the ESP32-S3 chip (CI pins **v6.0.2**; `main/idf_component.yml` keeps a
`>=5.5` floor on purpose — the managed components still resolve on 5.x). Reads a **Daikin Altherma**
heat pump over its **X10A** service port and bridges every value to **Home Assistant over MQTT**
(auto-discovery). WiFi (captive portal), MQTT, syslog and the RX/TX pins are configured at runtime
from a **web UI**; the unit **model** and its register set are **auto-detected** from the bus every
boot — there is no manual picker. Firmware is installed from a **browser** (Web Serial) and updated
**OTA**. Builds for the **esp32s3** target only.

> **Deep reference:** this file holds the always-needed essentials. Full narrative for the poll
> engine, value profiles, MQTT bridge, WiFi reconnect and OTA lives in
> [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — read it on demand. The X10A wire protocol
> (framing, checksum, register pages, detection) is in
> [`docs/X10A_PROTOCOL.md`](../docs/X10A_PROTOCOL.md), and the converter-id/enum tables plus a full
> register map in [`docs/REGISTERS.md`](../docs/REGISTERS.md). A cross-cutting catalog of the
> platform features this firmware implements (Secure Boot v2 signing, OTA + health gate, WebSocket,
> ESP-IDF component inventory, diagnostics) is [`docs/FEATURES.md`](../docs/FEATURES.md) — keep it
> current with the `feature-docs` skill when a technical feature lands or changes. The MQTT/HA entity
> contract as seen from Home Assistant is [`docs/HOME_ASSISTANT.md`](../docs/HOME_ASSISTANT.md), and
> the (planned) read-only MCP surface is [`docs/MCP.md`](../docs/MCP.md). User-facing docs:
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
scripts/run-mock-tests.sh    # compile + run host logic tests in seconds (cmake + g++/clang++)
scripts/run-domain-audit.sh  # is the value catalog physically RIGHT? (the domain-correctness gate)
```

It covers the X10A **CRC** and framing (`logic/crc.hpp`), the **value converters**
(`logic/convert.hpp` — the riskiest part of the port), register extraction
(`logic/registers.hpp`), the **config model / validation** (`logic/config_model.hpp`) and the
**HA-discovery payloads** (`logic/discovery.hpp`). CI gates the firmware build on it
(`logic-test` job). Add new decode/format logic to `main/logic/` and a `CHECK` in
`test/test_logic.cpp` — never bury it in a `.cpp` only the device can run. Full detail:
[`test/README.md`](../test/README.md).

**Passing the tests is not the same as being RIGHT.** The tests verify the logic they are handed;
they cannot see a value that is well-formed, compiles, drifts no doc — and is physically false. A
wrong converter id published `-971.5 °C` as a mixed-water temperature on eight profiles, a valve
*position* reached Home Assistant as a 12800 °C temperature sensor, and a "no data" sentinel was
published as a real `-3276.8 °C` reading (issues #35–#39) — all found by slow manual review. So the
value catalog has its own gate, separate from the technical ones:

```bash
scripts/run-domain-audit.sh   # real converters x real catalog, cross-checked vs docs/REGISTERS.md §5
tools/domain/selftest.sh      # does the audit still catch the four bugs it was built for?
```

It reports wrong converters, spec/layout drift, cross-profile outliers, non-temperatures typed °C,
and straddling byte windows — each with a decode witness (wire bytes → what it should read → what it
does). CI gates the build on it (`domain-audit` job); the judgement half is the `/domain-review`
skill, a **PR-merge gate** required on **every** merge — like `/project-review`, and unlike the
conditional `/feature-docs`. Unconditional because deciding up front which files can change a
value's meaning is a guess, and it is the guess that let #35–#39 ship; a PR that cannot reach a
value clears in seconds, but a person states that rather than a regex assuming it. Adjudicated
deviations live in `tools/domain/audit_exceptions.txt` (which also ledgers the four *pre-existing*
defects the audit found on its first run).

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
main.cpp        boot: NVS, config, safe-mode guard, WiFi(STA)|setup-AP, SNTP, mDNS, HTTP, MQTT, poll, OTA gate
safe_mode.cpp   boot-loop safe mode (logic/boot_guard.hpp): counts crash-only boots in NVS "daik_cfg"
                (boot_fails); past BOOT_FAIL_THRESHOLD it latches -> main.cpp skips the poll engine + MQTT
                bridge (WiFi + web UI + OTA stay up) so a bad config (e.g. wrong RX/TX pins) is fixable
                in-browser, not over USB; a clean/intentional reboot resets the count, and a
                BOOT_HEALTHY_S-uptime timer clears it. Drives /status.sys.safe_mode + the UI recovery banner
config.cpp      runtime Config (logic/config_model.hpp): WiFi/MQTT + one-shot WiFi rollback backup +
                link cache (pins/proto) in NVS "daik_cfg"; model (profile/fingerprint) RAM-only
                (config_set_model); mutex-guarded. Writers commit only the fields they OWN: the two
                writing tasks (httpd /set_*, poll detection) would otherwise revert each other from a
                stale snapshot — detection uses config_save_link/config_set_model, HTTP keeps
                whole-struct config_save. A failed NVS write names the key on /diag and returns false
                — config_save then publishes nothing, config_save_link still patches RAM (its link is
                proven-good); every call site checks it. See "NVS namespaces".
                config_load re-checks the persisted RX/TX as a PAIR (link_pins_valid) and falls back
                to the Kconfig defaults + a diag line if they fail: rx_pin/tx_pin are two independent
                commits on BOTH write paths (config_save_link as much as config_save), so flash can
                still hold a pair (rx == tx, or a pin off this chip) the request path would have
                rejected — a failure named on /diag is not a pair fixed on flash
nvs_storage.cpp thin NVS helpers (IDF nvs_* called with :: to avoid the daik::nvs_* collision);
                the setters return esp_err_t so config.cpp can name the failing key + error on /diag,
                and are [[nodiscard]] (main/ builds -Werror) — safe_mode.cpp silently dropped its
                crash-counter write, which left safe mode unable to latch on the wedged flash that is
                itself a plausible crash-loop cause. Compare to ESP_OK, never coerce to bool
wifi.cpp        STA bring-up (all-channel scan -> strongest AP by RSSI) + endless reconnect
                (first-boot budget -> setup portal; once online it NEVER reboots — no reason code
                ends the retry, since 15/202/204 are also the transient WPA3-SAE failures this file
                works around, and a runtime auth-fail reboot let an RF storm strand a healthy board
                in the open portal) + REASON-AWARE one-shot credential rollback (new creds fail to
                get a lease -> restore the NVS backup + reboot, marking wifi_rolledbk so /status can
                say so; policy host-tested in logic/wifi_rollback.hpp — only an AP that KEEPS refusing
                the creds takes the fast path, and must sustain it across 2 checkpoints (~60 s), since
                one sample can't tell a wrong password from a transient SAE fail; an ABSENT SSID (a
                router still rebooting, 1-3 min) gets a 180 s grace instead, since the blind deadline
                destroyed valid new creds; a pending change also suspends the first-boot retry budget)
                + ICMP gateway watchdog (ghost-assoc recovery; the probe is
                three-valued and the policy is host-tested in logic/link_watch.hpp — proven silence
                re-associates after 2 periods, a SUSTAINED inability to probe at all after 10, since
                "couldn't measure" previously read as "healthy" and left a wedged board undetected
                AND unlogged; decisions go to diag_printf so they reach /diag + syslog, not just the
                serial console) + scan + DHCP
                hostname (option 12) + mDNS; wifi_info() also reports the associated AP's BSSID + PHY
                standard + this STA's MAC; wifi_reconnect_count() — cumulative RE-connects since boot,
                for the MQTT heartbeat
sntp_time.cpp   SNTP client (esp_netif_sntp, config().ntp_server — NVS "ntp_server" override of
                CONFIG_DAIKIN_NTP_SERVER default "pool.ntp.org", runtime-editable via POST /set_ntp
                exactly like syslog_host/POST /set_syslog) — started right after WiFi(STA)|setup-AP
                in main.cpp, once config_load() has run (both WiFi paths already call
                esp_netif_init()); non-blocking, idles/retries on its own task until a route to the
                server exists, so it is harmless to start in AP-only setup mode too. Before this the
                device had no wall clock at all: diag_printf's "[uptime]" prefix and syslog's RFC 5424
                TIMESTAMP were the only timestamps anywhere, both relative to an unknown boot instant.
                time_synced()/time_now()/time_status() expose the sync flag + current UTC instant
                (read straight from newlib's clock, which the sync callback drives via
                settimeofday() — no separate offset-tracking to drift out of sync with it);
                logic/timestamp.hpp renders it as RFC 3339 for syslog.cpp's TIMESTAMP field and the
                top-level /status.ntp block. The uptime prefix stays as-is everywhere it already was
                (device-triage's boot-reconstruction technique keys on it jumping backwards on a
                reboot, and it is available before the very first sync of a boot, when the wall clock
                is still unset) — SNTP adds a second, absolute clock rather than replacing the first.
                The server string is resolved ONCE at startup into a file-scope std::string (lwip's
                SNTP module stores the raw pointer it's given, not a copy, so it must outlive the
                client) — a later /set_ntp edit reboots into a fresh config_load() rather than
                mutating it live.
provisioning.cpp setup SoftAP (daikin-altherma-esp32-setup) + DHCP DNS-offer; HTTP is the shared :80 server
captive_dns.cpp UDP:53 catch-all (every name -> 192.168.4.1) so the setup portal auto-pops (AP mode only)
hp_comm.cpp     X10A UART (9600 8E1) + register query. hp_uart_init installs the driver ONCE, then a
                pin change is a register-only uart_set_pin remap (logic/uart_plan.hpp) — NOT a
                uart_driver_delete+install. The old reinstall-per-swap allocated a fresh RX ring +
                driver struct every call; the detect sweep alternates the pins ~2x/s on a silent bus,
                so that churn fragmented the heap until an unrelated alloc (hp_poll's vector) hit an
                unwind-starved bad_alloc -> std::terminate -> abort (confirmed by a symbolized coredump)
hp_convert.cpp  device value formatting over logic/convert.hpp
hp_detect.cpp   auto-detect glue: protocol sweep + page probe -> fingerprint -> candidate models
hp_poll.cpp     poll engine task: (auto-detect if profile=="auto") profile registers -> query ->
                decode -> thread-safe cache; also drives the /events WebSocket push
                (ws_broadcast_values every cycle, ws_broadcast_status every 4th). Subscribed to the
                Task Watchdog (esp_task_wdt_add): reset per cycle + once per register in the sweep, so
                a wedged X10A read reboots cleanly (reset reason task_wdt) instead of hanging silently.
                On a SILENT bus the auto-detect sweep BACKS OFF (logic/detect_backoff.hpp): full 1s
                cadence at first, then stretched toward a 60s ceiling by SKIPPING sweep ticks (the 1s
                top-of-loop wdt reset still fires, so any ceiling is wdt-safe; the ceiling is a
                detection-latency choice, not a wdt constraint). Reset to fast cadence on a bus answer
                or via hp_poll_reconfigure() (POST /detect, POST /set_hp — atomic httpd->poll one-shot).
                poll_once reserves the value vector up front (one sized alloc, not log2(n) regrows)
http_server.cpp esp_http_server :80; concerns register their own routes (http_handlers.hpp)
http_common.cpp shared HTTP helpers + the ONE OOM guard every route runs under: http_register()
                stashes the real handler in user_ctx and installs a handle_all trampoline that calls
                it inside try/catch — std::bad_alloc -> 503, any other throw -> 500, instead of
                unwinding through esp_http_server's C frames to std::terminate -> reboot. /events is
                the deliberate exception (raw registration needed for the WebSocket; it self-guards)
http_status.cpp GET / (setup.html in AP mode, else gzip UI) /status /values /models /diag /scan
                /coredump + /events (WebSocket live push) + captive catch-all
http_config.cpp POST /set_wifi /set_mqtt /set_syslog /set_ntp /set_hp /detect
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp (read-only MCP tools; TODO)
mqtt_ha.cpp     HA MQTT-Discovery bridge: esp-mqtt client + publish task; ONE shared grouped-JSON
                state topic <base>/<node>/state (logic/mqtt_group.hpp), republished on change; LWT
                availability, mqtts+CA on creds; board/link diagnostics on <base>/<node>/heartbeat
                (logic/heartbeat.hpp), published on a fixed 10s cadence (HEARTBEAT_INTERVAL_S) —
                heap(free/min-free/largest-block)/uptime/reset_reason/the SNTP wall clock (sntp_time.cpp,
                "time" — HA device_class "timestamp", null until synced)/wifi(+reconnects)/mqtt(pub
                count+fails+reconnects)/X10A bus (rx_received/rx_fails) stats, 17 diagnostic HA entities
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
status_led.cpp  onboard-LED status indicator task (compile-time only, DAIKIN_STATUS_LED_* Kconfig):
                samples WiFi mode + wifi/mqtt/hp state per tick and blinks the pattern — slow 1s =
                setup portal (SoftAP), fast 100ms = connecting, solid = healthy (WiFi + MQTT + X10A),
                double-flash = X10A link down, medium 300ms = X10A up but MQTT down, off = no WiFi
                mode. X10A-down outranks MQTT-down (the bus is the point of the device). GPIO
                defaults to 21 (XIAO ESP32-S3 onboard LED) and
                INVERTED=y (active-low on XIAO); -1 disables. Not runtime-configurable and not on
                /status — it is a local-eyes-only signal. The task loop self-guards like mqtt_task/
                poll_task: wifi_info()/mqtt_status()/hp_stats() each copy std::strings out, so a tick
                can throw under memory pressure — an escape would reboot the board over a cosmetic
                LED. A dropped tick costs nothing (the pattern is recomputed from scratch each time)
diag_log.cpp    in-RAM diag ring served by GET /diag; each line is also forwarded to syslog_send()
syslog.cpp      optional syslog UDP client (RFC 5424): a task DNS-resolves the configured host, then
                forwards every diag_printf() line as one UDP datagram; disabled when syslog_host is
                empty. The RFC 5424 TIMESTAMP field is the SNTP wall clock (sntp_time.cpp,
                logic/timestamp.hpp) once synced, else the "-" NILVALUE a collector conventionally
                substitutes its own receive time for — so a boot's first few lines (sent before the
                client's first sync lands) just carry a slightly-later effective timestamp, never a
                fabricated pre-epoch one. Delivery is gated on DNS ONLY — an ARP(local)/ICMP reachability probe is
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
logic/          IDF-free, host-tested pure headers (crc, convert, registers, value_def, config_model,
                discovery, detect, json, mqtt_group, mqtt_uri, heartbeat, crashinfo, bootlog,
                reset_reason, boot_guard, board_pins, modbus, syslog_policy, link_watch,
                wifi_rollback, health_gate, ws_policy, http_body, timestamp, uart_plan,
                detect_backoff).
                value_def.hpp = the ValueDef row type the generated def/ profile tables are written
                in ({reg, offset, conv, size, type, label} — registry id, byte offset in the reply
                payload, converter id for convert.hpp, byte count, HA unit code, English label): the
                shared vocabulary between the offline generator's output and the decode path.
                json.hpp = the ONE RFC 8259 string encoder every JSON payload goes through (/status,
                /values, /scan via http_status.cpp's jstr; the MQTT state/heartbeat/crash topics).
                Escapes " and \ AND every control byte < 0x20 (\b\f\n\r\t, else \u00XX) — the strings
                are NOT all ours: an SSID is arbitrary bytes from any AP in range, and escaping only
                the first two let "Free<LF>WiFi" put a raw newline in a JSON string, so GET /scan
                failed JSON.parse and setup.html's .catch fallback collapsed the network dropdown to
                a free-text box for every portal user. BENEATH the portal's DOM-node SSID escaping
                (#52, fixed in #65): orthogonal, neither subsumes the other — #65 stops hostile SSID
                MARKUP, this makes the bytes PARSE at all (a decoded SSID of `"><script>` is valid
                JSON, and #65's DOM nodes still never see it if the parse fails first). #65 kept the
                .catch(textInput) fallback, so the scan-UI denial was live until this landed.
                Bytes >= 0x20 pass through
                verbatim (raw UTF-8, 0x7F) — the cast to unsigned char is load-bearing, since `char`
                is signed and a naive c < 0x20 would mangle every non-ASCII SSID.
                ws_policy.hpp = the /events frame policy: ws_frame_plan() decides on the ANNOUNCED
                length alone (Skip empty / Read what fits the 16 B command buffer / Reject the rest)
                and ws_frame_action() classifies only bytes a read actually delivered. The length is
                a client-asserted 64-bit number read before any payload, so it must reach a decision
                and never an allocation; a rejected frame closes the connection because
                esp_http_server cannot skip a frame body and its unread payload would be parsed as
                the next frame's header. http_body.hpp = the request-body recv loop
                (http_body_read), templated over a classified recv so segment-by-segment
                reassembly, a mid-body close and a stalled peer are host-tested; the IDF return-code
                mapping stays in http_common.cpp. A timeout is retried at most BODY_MAX_IDLE times —
                unbounded retries would park the single httpd task on one silent client.
                mqtt_uri.hpp = the broker-URI split (host/port/TLS) behind the /set_mqtt pre-flight.
                Its scheme defaults track esp-mqtt's OWN (mqtt 1883, mqtts 8883, ws 80, wss 443) —
                the probe must dial the port the client will: 1883/8883 for ws(s) probed a port
                nothing listens on. A port outside 1-65535 is rejected at PARSE time, since the
                probe's htons() truncates (:65537 -> :1) and would call a wrong port reachable; the
                port must be ALL digits (stoi alone skips whitespace, takes a sign and stops at the
                first non-digit -> "1883x" read as 1883, which esp-mqtt's own parser would reject).
                A URL path is trimmed BEFORE the port split: `/mqtt` is the de-facto standard path
                for MQTT-over-WebSocket, so wss://host:8084/mqtt is the NORMAL shape of a ws(s)
                broker — untrimmed it lands in the port field (or, portless, in the host, where it
                surfaced as a misleading "DNS lookup failed"). Only host/port are taken here; the
                caller hands esp-mqtt the full URI, path included.
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
                wifi_rollback.hpp = the credential-rollback policy: classifies a disconnect reason by
                what it says about the CREDENTIALS (Auth = the AP refused them -> evidence; ApAbsent/
                None/Other = a router still rebooting or a slow DHCP -> no evidence) and gates the
                boot-window decision on it. A rollback is destructive (the new creds are gone), so
                absence of evidence buys the 180 s grace and only the AP's own "no" is fast.
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
                and classifies which reset reasons are faults; board_pins.hpp = the ESP32-S3 CHIP-safe
                X10A GPIOs (the RX/TX pin-picker dropdown when detection hasn't locked the pins) —
                minus flash/strapping/USB-JTAG/JTAG always, minus GPIO33-37 when the build runs Octal
                flash/PSRAM, and minus the status LED's own pin: chip-safe is not free, and offering a
                pin status_led.cpp holds as a push-pull output is a pick that cannot work. Both
                inputs (octal_spi, reserved) come from Kconfig at the http_status.cpp call site, since
                logic/ must not see CONFIG_*. board_pins_offerable() fills a CALLER-owned buffer — a
                filtered static would race, as build_status_json runs on httpd AND the poll task's WS
                broadcaster. It says nothing about which pins a given BOARD breaks out to a header
                (no board-ID EEPROM exists); README.md carries that per-board table for humans;
                modbus.hpp = Modbus TCP framing (MBAP, no CRC) + HomeHub register codecs
                (Temp16/Pow16/Int16/Text16 decode+encode) + the homehub-* mDNS filter — host-tested
                core for the PLANNED firmware-exclusive HomeHub Modbus link (issue #32), not yet wired.
                timestamp.hpp = rfc3339_utc(unix_s, ms) — the ONE UTC formatter the SNTP wall clock
                (sntp_time.cpp) renders through, for syslog.cpp's RFC 5424 TIMESTAMP field,
                /status.ntp.time, and mqtt_ha.cpp's heartbeat "time" field. A negative unix_s
                (sntp_time.cpp's "never synced" sentinel) returns
                "" rather than a plausible-looking 1970-01-01 — callers key on the empty string to
                fall back to the RFC 5424 NILVALUE / JSON null instead of asserting a wrong instant.
def/            embedded per-model value profiles + registry (incl. the generic Altherma fallback =
                universal register core) + models_catalog.hpp (GET /models) + model_names.hpp
                (id→display/family/marketing name for /status) + signatures.hpp (Altherma-only
                detection signatures derived from the tables). Profiles are machine-generated in the
                ValueDef row format by the offline value-catalog decode tooling (gen_profiles.py),
                which is maintained OUTSIDE this repo — there is no tools/ directory on main. Never
                hand-edit a generated table: regenerate it, and verify rows against docs/REGISTERS.md
                (the in-repo source of truth, and the check any contributor can actually run).
www/            web UI sources (index.html + style.css + app.js -> one gzipped page) + setup.html
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `wifi_ssid`/`wifi_pass`, the one-shot WiFi rollback backup `wifi_ssid_back`/`wifi_pass_back`/`wifi_rollback` plus the `wifi_rolledbk` outcome marker (see `/set_wifi`; `config_save` writes the backup+flag BEFORE the creds when arming and AFTER them when clearing — each `nvs_set_*` commits on its own, so the order decides what a power cut leaves behind), `mqtt_uri`/`mqtt_user`/`mqtt_pass`, `syslog_host`/`syslog_port` (empty host = off), `ntp_server` (empty = reset to the `CONFIG_DAIKIN_NTP_SERVER` compile-time default on next boot — unlike `syslog_host`, SNTP has no disabled state to preserve), the X10A **link cache** `rx_pin`/`tx_pin`/`proto`, and the boot-loop **crash counter** `boot_fails` (safe_mode.cpp; here so a factory reset wipes it too). (Hostname is fixed at `CONFIG_DAIKIN_HOSTNAME`, poll cadence at `POLL_INTERVAL_S`=1 s, labels English-only.) |

**The link is persisted; the model is not.** The RX/TX pins + protocol are the physical, boot-invariant
X10A link — cached in NVS, tried FIRST by the detection sweep (defaults as fallback, so a stale cache
self-heals), and re-persisted only when they change. The **model** (`profile` + fingerprint `fp_*`) is
re-detected on **every boot**: `config_load` seeds `profile="auto"`, and `poll_detect` applies the
model in RAM only (`config_set_model`) — so a swapped unit is re-identified, and `profile`/`fp_*` are
**not** in NVS. `poll_detect` calls `config_save_link` (persist) only when pins/proto change.

**Writers commit only the fields they own.** Two tasks write the config — httpd (`/set_*`) and poll
(detection) — so a writer that saves a whole `Config` saves whatever it snapshotted, including fields
someone else has since changed. Detection snapshots, then probes the bus for a whole sweep before
committing, so it must never write back a whole struct: that would revert a `/set_wifi` that landed
during the sweep, *after* the user got `{"ok":true}`. It therefore uses the narrow setters
`config_save_link` (rx/tx/proto, persisted) and `config_set_model` (profile/`fp_*`, RAM), which patch
the live config in place under the mutex via `apply_link`/`apply_model` (`logic/config_model.hpp`,
host-tested). Whole-struct `config_save` stays for the HTTP handlers: they own the credential fields
and are serialized on the single httpd task. The rule is deliberately **asymmetric** — it closes
poll→httpd, not httpd→poll (a `/set_*` save can still revert a link commit from its own tiny
snapshot→save window); that direction self-corrects on the next detect, the credentials it protects
do not.

**`config_save` can fail — every caller checks it.** It returns `false` on any NVS error and then
does *not* publish to RAM either, so an ignored return means reporting a save the device never made.
The `/set_*` handlers answer `500 {"ok":false,"error":"config write failed"}` and skip the reboot;
the WiFi rollback-restore falls through to the setup portal rather than rebooting into a loop it
cannot persist its way out of (the restore lives in NVS alone, so an unpersisted one is re-decided
identically on every boot); `config_save` itself logs the failing key + `esp_err_t` to `/diag` +
syslog.

`nvs` at `0x9000` is untouched by OTA (partitions.csv) so config survives upgrades. Keep its
offset/size stable across versions.

## HTTP API

```
GET  /            embedded web UI (gzipped into the app binary)
GET  /status      version, platform, uptime_s, app_elf_sha256 (build identity — matches a core dump
                  to its .elf), pins_avail[] (the chip-safe X10A GPIOs for the RX/TX picker, minus the
                  status LED's pin — logic/board_pins.hpp), wifi{ssid,ip,rssi,connected,bssid,mac,std,rolled_back}
                  (bssid/std are the associated AP's BSSID + PHY standard name e.g. "Wi-Fi 4", null
                  while offline; mac is this STA's own MAC, always present; rolled_back = the last
                  /set_wifi was UNDONE by the credential rollback — sticky until the next /set_wifi,
                  and the only trace of it, since the rollback reboots and the SSID shown is just the
                  old one again),
                  mqtt{configured,connected,tls,has_creds,broker,error} (has_creds = whether creds are
                  stored, never their value; read from the CONFIG not the client — creds outlive a
                  disabled broker, which is exactly the state the UI must offer to clear via
                  /set_mqtt's clear_creds),
                  syslog{configured,resolved,reachable,host,port,error},
                  ntp{server,synced,time} — server is the CONFIGURED address (config().ntp_server:
                  NVS "ntp_server" override of CONFIG_DAIKIN_NTP_SERVER, runtime-editable via
                  POST /set_ntp exactly like syslog_host/POST /set_syslog), not necessarily who
                  answered; synced/time are false/null until the first SNTP reply of this boot lands,
                  else RFC 3339 UTC (logic/timestamp.hpp) — mirrors syslog{} rather than sys{} below,
                  since it is a runtime-configurable network service too, not a static board fact,
                  hp{proto,rx,tx,connected,
                  last_ok_s,registers,values,crc_err,timeout_err}, profile{id},
                  sys{free_heap,min_free_heap,max_alloc,reset_reason,safe_mode} — heap
                  headroom (free / since-boot low-water / largest-contiguous) + why the device last
                  booted, ALWAYS present (unlike last_crash, and unlike the MQTT heartbeat needs no
                  broker); reset_reason via logic/reset_reason.hpp, safe_mode = the latched boot-loop
                  recovery flag (safe_mode.cpp; true once too many crash boots accumulated -> poll +
                  MQTT skipped),
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
                  needed) — the handler self-guards its JSON build. Frame handling is decided by
                  logic/ws_policy.hpp, never inline: ONLY a "sub" text frame takes a broadcast slot
                  (registering on any frame at all pushed a frame per second to a client that never
                  asked, and held a slot from one that had), and a frame longer than the 16 B command
                  buffer is refused + the connection closed — its announced length is an unbacked
                  64-bit client claim, so it may never size a buffer, and esp_http_server can neither
                  read it into a smaller one (ESP_ERR_INVALID_SIZE, buffer untouched — the old code
                  memcmp'd that uninitialised stack) nor skip past it.
GET  /models      pin hint + catalog metadata (def/models_catalog.hpp). Detection is fully automatic;
                  the UI no longer offers a manual model picker. NO shipped client reads this — the
                  web UI never fetches it, and the RX/TX dropdown takes its GPIOs from
                  /status.pins_avail (logic/board_pins.hpp), NOT from this pin_hint. Legacy metadata
                  behind a read-only inspection endpoint for humans/scripts
GET  /diag[?verbose=0|1][?clear=1]   in-memory diag log
GET  /scan        WiFi scan (setup)
GET  /coredump[?clear=1]   stream the flash core-dump image (chunked octet-stream; 404 if none);
                  ?clear=1 erases the coredump partition. Decode offline against the matching-version
                  .elf: scripts/decode-coredump.sh coredump.bin (CI archives the .elf per build). The
                  UI surfaces a crash banner + one-click download when /status.last_crash is set.
POST /set_wifi    {ssid,pass} -> validate (ssid 1-32 chars; pass empty[open] or 8-63) -> persist +
                  reboot. A rejection is 400 {ok:false,error} like every other write endpoint (the
                  shared send_err) — it used to be bare text, which the setup portal couldn't tell
                  apart from success. If WiFi was already configured, the OLD ssid/pass are stashed as a one-shot
                  NVS backup (wifi_rollback flag) and wifi_rolledbk is cleared (a new attempt retires
                  the old verdict): after reboot, if the new creds fail to get a DHCP lease,
                  wifi_start_sta restores the backup + reboots (setting wifi_rolledbk ->
                  /status.wifi.rolled_back); a successful connect clears the backup. So a bad
                  SSID/password entered over the LAN self-heals to the last working network instead of
                  stranding the device in the setup AP. The deadline is REASON-aware
                  (logic/wifi_rollback.hpp): rolling back is destructive, so only an AP that SUSTAINS
                  its refusal (auth class at 2 consecutive 30 s checkpoints, ~60 s) spends them — an
                  absent SSID or a slow DHCP is no evidence against them and gets 180 s, long enough
                  for a rebooting router. wifi.cpp clears the reason on STA_CONNECTED, so an earlier
                  refusal can't outlive the association that disproved it.
POST /set_mqtt    {broker,user,pass,clear_creds} -> pre-flight the broker synchronously (DNS -> TCP
                  probe -> short-lived esp-mqtt CONNECT/auth, mirroring mqtt_ha's creds-require-mqtts://
                  policy) -> on success persist + reboot; on failure 400 {ok:false,error} and nothing is
                  saved. Unchanged settings short-circuit to {ok:true,reboot:false} (no probe, no reboot).
                  "" (empty broker) disables MQTT and skips the probe. Blocks up to ~8 s — the one
                  request-path network block (syslog/wifi don't); safe under the handle_all 503 guard.
                  CREDENTIALS: the modal never prefills them, so an empty user+pass means KEEP the
                  stored ones (else an unrelated broker edit would wipe a working login). Empty can
                  therefore not also mean "clear" — clear_creds:true (the UI's "remove stored
                  credentials" checkbox, shown when /status.mqtt.has_creds) is the explicit signal; a
                  non-empty user/pass is an explicit SET and wins over the flag. Without it an
                  authenticated mqtts:// broker can never migrate to an anonymous mqtt:// one: disable
                  + re-add both send empty creds -> both keep -> the kept creds then 400 every
                  plaintext broker ("Credentials require mqtts://"). Only a flash erase escaped that.
POST /set_syslog  {host,port} -> validate port range -> persist + reboot. Empty host disables syslog.
                  DNS/reachability are NOT checked here (no request-path network block); they resolve
                  in the syslog task and surface via /status.syslog {resolved,reachable,error}.
POST /set_ntp     {server} -> persist + reboot. No request-path network probe (the SNTP client
                  resolves + retries on its own task after reboot, same as syslog); an empty server
                  is accepted and read by config_load() on the next boot as "reset to the
                  CONFIG_DAIKIN_NTP_SERVER compile-time default" (SNTP has no disabled state, unlike
                  syslog_host's empty-means-off). Unchanged settings short-circuit to
                  {ok:true,reboot:false}, same as /set_mqtt.
POST /set_hp      {profile,rx,tx} -> validate + apply live (no reboot). rx/tx PERSIST (the physical
                  pin cache — a manual override survives reboot); profile is session-only. The UI
                  always sends profile="auto" (fully automatic — no manual model pick); a concrete id
                  is still accepted (pins the model for this session) but never offered in the UI.
                  proto is NOT accepted (auto-detected); poll_s fixed at 1 s and lang removed
                  (English-only) — neither accepted. RX/TX are auto-detected; when the bus is silent
                  the ESP32 card's pin dropdown posts {profile:"auto",rx,tx} to re-run detection.
   (all five /set_*) a failed NVS write answers 500 {ok:false,error:"config write failed"} and does
                  NOT reboot/apply — config_save publishes nothing on failure, so an "ok" + reboot
                  would silently come back up on the OLD config (the failing key is on /diag)
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
scripts/run-domain-audit.sh                            # are the catalog's values physically right?
screen /dev/cu.usbmodemXXXX 115200                     # serial monitor (native USB on s3)
curl http://daikin-altherma-esp32.local/status | jq          # device status (incl. last_crash)
curl http://daikin-altherma-esp32.local/values | jq          # decoded values
curl http://daikin-altherma-esp32.local/coredump -o coredump.bin   # pull a crash dump (if any)
scripts/decode-coredump.sh coredump.bin                # symbolize it against the matching .elf
esptool --chip esp32s3 -p <port> erase_flash           # wipe NVS (reset config)
```
