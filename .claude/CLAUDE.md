# daikin-altherma-esp32

ESP-IDF 6.x firmware for the ESP32-S3 chip (CI pins **v6.0.2**; `main/idf_component.yml` keeps a
`>=5.5` floor on purpose — the managed components still resolve on 5.x). Reads a **Daikin Altherma**
heat pump over its **X10A** service port and bridges every value to **Home Assistant over MQTT**
(auto-discovery). WiFi (captive portal), MQTT, syslog and the RX/TX pins are configured at runtime
from a **web UI**; the unit **model** and its register set are **auto-detected** from the bus every
boot — there is no manual picker. Firmware is installed from a **browser** (Web Serial) and updated
**OTA** from one of two published feeds — a **release** (cut by hand, via a manual CI workflow run)
or the **dev** channel (every firmware-relevant merge to `main`), picked per device in the UI.
Builds for the **esp32s3** target only.

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
> contract), [`docs/WIRING.md`](../docs/WIRING.md) (X10A wiring + picking RX/TX on other boards) and
> [`docs/BOARDS.md`](../docs/BOARDS.md) (per-board hardware inventory + which parts the firmware
> uses — the place a newly-supported board's LED/button/pin facts belong).
> Contributor-facing: [`CONTRIBUTING.md`](../CONTRIBUTING.md) (what the local gates
> are, where logic goes, how PRs land on a linear+signed `main`) and
> [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — CONTRIBUTING states the outside-contributor half of
> the rules this file states for us, so a change to the gates, the `main/logic/` + test rule or the
> merge model belongs in **both**. Keep them in sync (the `project-review` skill checks for drift).

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

(Three more fast gates guard the PUBLISHED ARTIFACTS rather than the firmware —
`scripts/run-pages-publish-tests.sh`, git-only, relevant when `scripts/publish-pages-branch.sh` or
`scripts/build-pages.sh` changes; `scripts/run-web-installer-plan-tests.sh`, python-only, the
NEGATIVE half of the NVS-preservation gate (CI already ran `check-web-installer-plan.py` on the
real manifest, which only ever proved a good plan passes); and
`scripts/run-publish-version-tests.sh`, which covers `scripts/check-publish-version.sh` — the
build job's answer to "would a device on the PUBLISHED build accept the one we are about to
publish?", asked with the device's own `ota_is_upgrade()` against the gh-pages manifest of the feed
being written. That one exists because the version is DERIVED: `next-version.sh` reads the `v*` tag
list and falls back to the `version.txt` floor when it is empty, so a deleted tag silently resets
the numbering — on 2026-07-24 it republished dev/ as 1.0.0-dev.168 over 1.0.14-dev.2, green. See
CONTRIBUTING.md.)

All five are STEPS of CI's single `gates` job, which the firmware `build` job `needs` — not a job
each (the version gate itself runs inside `build`, where the stamped version exists; only its tests
are a `gates` step). Actions bills every JOB rounded up to a whole minute, so five ~15 s jobs cost
5 billed minutes for well under one minute of work. The same budget rule shapes the rest of
`.github/workflows/build.yml`, and it is worth knowing before editing it: the ~5-minute firmware
build is SKIPPED (not failed — a skipped job still reports its check, which is why the gate is a
per-job `if:` and never a workflow-level `paths-ignore:`) when the diff touches nothing the image
or the published site is made of, on pull requests as much as on pushes; ccache is carried across
runs; a PR publishes NOTHING (the per-PR preview installer at gh-pages `PR/<N>/` is retired —
each preview was a `gh-pages` push and every `gh-pages` push starts GitHub's own three-job "pages
build and deployment" run, while the dev channel answers the same question per merge); Renovate
runs daily + on demand, not once per merge. A new always-on job, an
ungated build or a per-commit publish is a real monthly cost, not a rounding error.

It covers the X10A **CRC** and framing (`logic/crc.hpp`), the **value converters**
(`logic/convert.hpp` — the riskiest part of the port), register extraction
(`logic/registers.hpp`), the **config model / validation** (`logic/config_model.hpp`) and the
**HA-discovery payloads** (`logic/discovery.hpp`). CI gates the firmware build on it
(the `gates` job's host-logic step). Add new decode/format logic to `main/logic/` and a `CHECK` in
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
does). CI gates the build on it (a `gates` step); the judgement half is the `/domain-review`
skill, a **PR-merge gate** required on **every** merge — like `/project-review`, and unlike the
conditional `/feature-docs`. Unconditional because deciding up front which files can change a
value's meaning is a guess, and it is the guess that let #35–#39 ship; a PR that cannot reach a
value clears in seconds, but a person states that rather than a regex assuming it. Adjudicated
deviations live in `tools/domain/audit_exceptions.txt`; it distinguishes an on-record ADJUDICATION
(a real per-model difference) from a temporary KNOWN-DEFECT (tracked + deleted by its fix). The four
*pre-existing* defects the audit opened with (#35–#39) are fixed (PR #82) and their entries removed —
a KNOWN-DEFECT that outlives its fix would silence the guard against the fix regressing — so the
ledger currently carries no live entries; each defect is now pinned by a catalog `CHECK` instead.

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

Two boards are documented, and they are the reference for *different* things. The compile-time X10A
pin defaults are the **Seeed XIAO ESP32-S3**'s — **RX=44 (D7) / TX=43 (D6)** — so that board finds
the bus unconfigured; GPIO16/17 are not broken out on it. The **M5Stack AtomS3 Lite** is what the
user-facing wiring (README table, `docs/WIRING.md` diagram) is written for, because its Grove
HY2.0-4P port carries GND/5 V/G2/G1 and reaches X10A with no soldering — but **RX=1 / TX=2 must be
picked once** in the UI, since detection probes only the cached pair, the Kconfig pair and each of
them swapped. Both flash over native USB-Serial/JTAG without a BOOT-button dance.

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
                whole-struct config_save. A failed NVS write names the key on /diag. A failed atomic
                blob means config_save returns false and publishes nothing; a later failure in the
                separate self-healing link cache is logged but does not falsely fail an already-saved
                service change. /set_hp explicitly requires the cache and leaves RAM untouched if it
                fails. config_save_link still patches RAM (its link is proven-good); every call site
                checks its own durability contract. The credential/service half of config_save is
                ATOMIC: those fields go into ONE CRC-checked blob (logic/config_store.hpp) written with
                a single nvs_set_blob, so a save is all-or-nothing across BOTH a write failure AND a
                power cut — no per-key rollback and no WiFi creds-vs-backup write-ordering to get right
                (both are now inside the one atomic blob). The blob is written by the httpd task alone,
                so the poll task can never revert a credential change. The RX/TX/proto LINK cache stays
                as separate self-healing keys (two owners; re-validated on load). config_load reads the
                blob first and falls back to the legacy per-key layout when it is absent (fresh device /
                pre-blob OTA) or fails its CRC. See "NVS namespaces".
                config_load re-checks the persisted RX/TX with link_pins_safe (the PAIR rule plus the
                chip-reserved-pin rule of logic/board_pins.hpp) and falls back
                to the Kconfig defaults + a diag line if they fail: rx_pin/tx_pin are two independent
                commits on BOTH write paths (config_save_link as much as config_save), so flash can
                still hold a pair (rx == tx, a pin off this chip, or a reserved flash/strapping/JTAG
                pad) the request path would have
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
                in main.cpp, once config_load() has run (the process-wide esp_netif_init() runs
                exactly once in app_main, before either STA or the setup portal creates its own
                interface); non-blocking, idles/retries on its own task until a route to the
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
provisioning.cpp setup SoftAP (daikin-altherma-esp32-setup) + DHCP DNS-offer; HTTP is the shared :80
                server. AP-ONLY: the portal takes the SSID as TYPED TEXT (setup.html has no dropdown
                and fetches nothing), so the idle STA interface an earlier APSTA version brought up
                purely to make esp_wifi_scan_start() work is gone with the scan — and a hidden network
                is entered like any other. /scan stays a trusted-LAN-only route (logic/http_surface.hpp:
                an open radio has no reason to be handed every AP in range). h_index still treats
                APSTA like AP (serve setup.html) — the STA path is WIFI_MODE_STA, so any mode with a
                live SoftAP means setup. The DHCP hand-off also advertises the RFC 8910 captive-portal
                URI (option 114, ESP_NETIF_CAPTIVEPORTAL_URI) alongside the DNS offer — recent
                iOS/Android prefer it over probing at all, and a client that ignores it still finds
                the portal via the probe redirect (logic/captive.hpp). The URI is a STATIC buffer:
                IDF stores the POINTER it is handed, not a copy, so it must outlive the DHCP server —
                the same lifetime trap as sntp_time.cpp's server string. All four steps are CHECKED
                and a failure is named on diag (serial only in AP mode — /diag is withheld from the
                open setup-AP surface); discarding those return codes is what made "the portal
                doesn't pop" a report with no evidence behind it
captive_dns.cpp UDP:53 catch-all (every name -> 192.168.4.1) so the setup portal auto-pops (setup mode
                only). The response copies the query's RD bit and sets RA (RFC 1035 4.1.1) — a stub
                resolver that sees Recursion-Desired come back cleared may discard the answer, and a
                discarded answer means the OS probe never reaches us. Non-A queries (AAAA) get a
                0-answer NOERROR, so a phone can't prefer an IPv6 route off-device
hp_comm.cpp     X10A UART (9600 8E1) + register query. hp_uart_init installs the driver ONCE, then a
                pin change is a register-only uart_set_pin remap (logic/uart_plan.hpp) — NOT a
                uart_driver_delete+install. The old reinstall-per-swap allocated a fresh RX ring +
                driver struct every call; the detect sweep alternates the pins ~2x/s on a silent bus,
                so that churn fragmented the heap until an unrelated alloc (hp_poll's vector) hit an
                unwind-starved bad_alloc -> std::terminate -> abort (confirmed by a symbolized coredump)
hp_convert.cpp  device value formatting over logic/convert.hpp; applies its reading_plausible() at
                PUBLISH time — an impossible °C reading (idle-unit 576 °C, a ±3276.x sentinel), a
                0-bar saturation temp, or a 0-bar REFRIGERANT pressure reaches HA as unavailable, not
                a false value. The pressure rule needs the whole profile table (passed down from
                hp_poll), because 0 bar is impossible for refrigerant — these are ABSOLUTE pressures
                and a sealed circuit is never at vacuum — but ordinary for WATER (a drained system).
                is_refrigerant_pressure() takes that split STRUCTURALLY, never from the label (an
                alias or a translation would flip it), on either of two signals: the PAGE (0x20/0x21/
                0xA0/0xA1 are the outdoor unit's own — no water circuit out there; measured across all
                45 profiles, every bar row on 0x20/0xA0 is refrigerant and no water row appears on
                either), or a conv-405 saturation-temperature twin at the same (reg, offset), which is
                what reaches the refrigerant rows on the MIXED hydronic page 0x62 (0x62/15 refrigerant
                vs 0x62/11 water). Covers 93 of the catalog's bar rows; the KNOWN GAP is 16
                "Refrigerant pressure sensor" + 1 "Pressure sensor" on 0x62 with no twin, left rather
                than closed by label-matching. test_refrigerant_pressure_catalog() pins both the
                coverage and the direction that matters — no water row is EVER flagged, since a false
                positive would withhold a real 0-bar reading from a drained system. Measured on a
                live 4-8 kW unit, High/Low Pressure read exactly 0.0 bar at rest AND at 42 rps while
                the 0x62/15 sensor read a correct 15.3 bar. Kept out of
                convert() so the domain audit still sees each converter's intrinsic semantics
hp_detect.cpp   auto-detect glue: protocol sweep + page probe -> fingerprint -> candidate models. The
                O/U capacity is read from a VARIABLE-LENGTH page 0x00 (a smaller unit's short reply
                omits offset 12); when absent, the I/U capacity code (0x60/6, same kW×10 units) is a
                fallback that only RANKS detect_best (never excludes a candidate; no-op when the O/U
                capacity is known). The detect diag line prints iu_kw=
hp_poll.cpp     poll engine task: (auto-detect if profile=="auto") profile registers -> query ->
                decode -> thread-safe cache; also drives the /events WebSocket push
                (ws_broadcast_values every cycle, ws_broadcast_status every 4th), with one
                outstanding async batch allowed per stream (logic/ws_tx_gate.hpp). Subscribed to the
                Task Watchdog (esp_task_wdt_add): reset per cycle + once per register in the sweep, so
                a wedged X10A read reboots cleanly (reset reason task_wdt) instead of hanging silently.
                On a SILENT bus the auto-detect sweep BACKS OFF (logic/detect_backoff.hpp): full 1s
                cadence at first, then stretched toward a 60s ceiling by SKIPPING sweep ticks (the 1s
                top-of-loop wdt reset still fires, so any ceiling is wdt-safe; the ceiling is a
                detection-latency choice, not a wdt constraint). Reset to fast cadence on a bus answer
                or via hp_poll_reconfigure() (POST /detect, POST /set_hp — atomic httpd->poll one-shot).
                poll_once reserves the value vector up front (one sized alloc, not log2(n) regrows)
http_server.cpp esp_http_server :80; concerns register their own routes (http_handlers.hpp). Picks
                the trust surface from the WiFi mode (esp_wifi_get_mode): the OPEN setup AP registers
                ONLY the provisioning routes (GET / /index.html, POST /set_wifi + captive) and
                withholds /scan /coredump /diag + the config/OTA/MCP surface from an unauthenticated
                radio client; STA (trusted LAN) registers the full API. Boundary = host-tested
                logic/http_surface.hpp, applied via http_register_on (http_common.cpp)
http_common.cpp shared HTTP helpers + the ONE OOM guard every route runs under: http_register()
                stashes the real handler in user_ctx and installs a handle_all trampoline that calls
                it inside try/catch — std::bad_alloc -> 503, any other throw -> 500, instead of
                unwinding through esp_http_server's C frames to std::terminate -> reboot. /events is
                the deliberate exception (raw registration needed for the WebSocket; it self-guards)
http_status.cpp GET / (setup.html in AP mode, else gzip UI) /status /values /models /diag /scan
                /coredump + /events (WebSocket live push; shared-payload, refcounted completion and
                bounded one-in-flight backpressure per values/status stream) + captive catch-all
http_config.cpp POST /set_wifi /set_mqtt /set_syslog /set_ntp /set_hp /set_board /set_ota /detect
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp (read-only MCP tools; TODO)
mqtt_ha.cpp     HA MQTT-Discovery bridge: esp-mqtt client + publish task; ONE shared grouped-JSON
                state topic <base>/state (logic/mqtt_group.hpp), republished on change; LWT
                availability, mqtts+CA on creds. Message topics sit DIRECTLY under <base> (no node
                segment — one board per base topic); the node id identifies the
                DEVICE only in each discovery config's uniq_id/dev.ids + the <prefix>/<component>/<node>/…
                discovery topic, and is the SLUGIFIED BASE TOPIC (logic/ha_device.hpp), NOT the
                board's MAC: the HA device is the INSTALLATION, so swapping the ESP32 keeps one
                device with its entities, history and statistics instead of creating a second one and
                restarting every statistic. The MAC-derived daikin_<mac3> lives on as (a) the MQTT
                CLIENT id — unique per connection, so two boards briefly online during a swap don't
                kick each other off — and (b) a SECOND dev.ids entry: HA matches a device by any
                identifier and merges the rest in, so an install created by a MAC-identified build is
                adopted, not duplicated. The retained configs an older build published under the MAC
                id are RETRACTED once per boot (retract_legacy_{fixed,values}) immediately BEFORE the
                replacement config for the same entity — HA drops the old registry entry, freeing its
                entity_id, and the new entity takes it back; history/statistics key on entity_id and
                carry over, per-entity UI customisations key on unique_id and do not. Only THIS
                board's own legacy topics can be retracted (a swapped-out board is gone —
                docs/HOME_ASSISTANT.md "Device identity" has the broker-side cleanup). A BIT-FLAG row (conv 300-307, conv_is_binary) is published as the JSON
                NUMBER 1/0 (binary_state_number) and typed as an HA binary_sensor (ha_component) with an
                explicit pl_on:"1"/pl_off:"0" — HA's defaults are "ON"/"OFF" and a mismatch parks the
                entity at `unknown`. The NUMBER is the point: a metrics consumer (Telegraf →
                VictoriaMetrics) drops strings AND bools, so ~30 of a profile's ~99 values reached HA but
                never a graph (measured: 58 of ~99 became series). /values, the web UI and the WebSocket
                read the poll cache and still show ON/OFF — only the wire format changed. Both call sites
                key on conv_is_binary, never on the text, so the encoding and the entity type can't drift
                apart. Builds before the split published these as `sensor`; that stale retained config is
                DELETED per binary row on each announce (retired_sensor_discovery_topic) so no duplicate
                unavailable entity survives an upgrade — the entity DOMAIN changes, so HA history for
                these does not carry over. Board/link diagnostics on <base>/heartbeat (logic/heartbeat.hpp),
                published on a fixed 10s cadence (HEARTBEAT_INTERVAL_S) — a FLAT JSON (each field
                prefixed by its block name: wifi_connected, wifi_rssi, wifi_mac, wifi_bssid, mqtt_count,
                bus_rx_received, … — no nested wifi/mqtt/bus objects; the three connectivity flags are
                1/0 NUMBERS, not bools, for the same metrics-consumer reason as the bit-flag rows, and
                bus_status carries the matching pl_on/pl_off — the crash topic keeps true/false + `| lower`
                since it is an event payload, not a metrics stream) of
                heap(free/min-free/largest-block)/uptime/reset_reason/the SNTP wall clock (sntp_time.cpp,
                "time" — HA device_class "timestamp", null until synced)/wifi(rssi+reconnects+MAC+BSSID,
                mac always present, bssid null offline)/mqtt(pub count+fails+reconnects)/X10A bus
                (rx_received/rx_fails) stats, 19 diagnostic HA entities streamed independently of profile
                detection. Also RETAINS the boot-time crash summary
                on <base>/crash (logic/crashinfo.hpp) once per (re)connect — but ONLY when the boot is
                NOTABLE (a real fault or a core-dump still in flash, crash_is_notable). A normal boot
                (USB re-enumeration, config-save/OTA reboot, clean power-on) publishes a zero-length
                RETAINED payload that CLEARS the topic (build_crash_mqtt_payload returns ""), so no
                crash message lingers once the problem is resolved; the reset reason is not lost — the
                heartbeat carries it as its own "Reset Reason" sensor. PLUS a republish on the
                heartbeat cadence whenever the "dump waiting" flag changes (diag_crash_info_live();
                a retained true would otherwise latch ON in HA until the next reconnect once the dump
                is pulled + cleared — and an orphan-dump-only boot is then re-decided not-notable and
                the topic cleared). When a crash IS reported it drives ONE diagnostic HA entity — a
                "dump waiting" flag (reason/backtrace only, never secrets or the raw dump); the reset
                reason is NOT a crash entity (it duplicated the heartbeat's own "Reset Reason" sensor,
                so the old "Last Reset Reason" crash entity was dropped + is actively retired — its
                stale retained discovery config is deleted on upgrade, RETIRED_CRASH_SENSORS). Every publish funnels through one mqtt_publish() wrapper so mqtt_count/mqtt_fails
                cover every topic, not just state. The mqtt_pub task is Task-Watchdog-subscribed
                (esp_task_wdt_add) and resets UNCONDITIONALLY at the top of each 1s cycle (not gated on
                connect/publish, so a long broker outage can't false-trip) PLUS once per publish inside
                mqtt_publish() (so a ~30-publish reconnect burst on a slow link can't exceed the 20s
                budget) — a wedged publish reboots, a slow-but-progressing one never does.
ota_update.cpp  pull-based signed OTA: manifest check -> TWO-POINT downgrade gate -> esp_https_ota
                into the inactive slot -> signature verify on install -> reboot, plus the rollback
                health gate. Reads the CHANNEL (config ota_channel, logic/ota_channel.hpp) fresh on
                every check/update, so a switch applies live: `release` = the gh-pages ROOT manifest
                (republished only by a MANUAL workflow run that tags v*), `dev` = <base>/dev/
                (republished by every firmware-relevant merge to main). A merge no longer cuts a
                release. Dev builds are stamped <next release>-dev.<n> — a semver PRE-RELEASE, so
                ordering alone gets both directions right: a dev board upgrades itself to the next
                release, a release board never drifts onto a dev build. Switching BACK (dev -> the
                last release) is an older version, refused unless the request carries ?downgrade=1
                (ota_install_allowed) — which relaxes the ORDER only: never the signature, never an
                equal version, never on the manifest's say-so, never persisted. Without it the
                release channel would be a one-way door; with it a hostile manifest host still
                cannot walk a fleet backwards. Both network ops run on ONE on-demand task (never the httpd worker —
                /set_mqtt's pre-flight is deliberately the only request-path network block) and only
                one at a time (two TLS sessions would fight over the largest contiguous block).
                s_status is mutex-guarded behind an RAII Lock, since readers copy std::strings out.
                The gate is checked against the MANIFEST version (cheap pre-check) AND against the
                image's OWN esp_app_desc_t version via esp_https_ota_get_img_desc(), then requires
                the two artifact-version strings to match exactly — the manifest and the image are
                separately-controlled artifacts, so both a signed old image and two different
                independently-newer versions are refused
status_led.cpp  onboard status-indicator task. TWO back-ends behind one host-tested pattern table
                (logic/led_pattern.hpp): a level-driven GPIO LED and an addressable WS2812 (RMT, via
                the espressif/led_strip managed component). Pin + driver + polarity are RUNTIME
                (config led_gpio/led_type/led_inverted, NVS, POST /set_board) — Kconfig
                DAIKIN_STATUS_LED_* only seeds first boot — because CI publishes ONE esp32s3 image
                and the boards disagree about their onboard parts (XIAO: plain LED GPIO21 active-low;
                M5Stack AtomS3 Lite: WS2812 GPIO35). Compiling either in would fork the artifact +
                manifest + OTA feed per board. Six operating patterns, timings unchanged: slow 1s =
                setup portal (SoftAP), fast 100ms = connecting, solid = healthy (WiFi + MQTT + X10A),
                double-flash = X10A link down, medium 300ms = X10A up but MQTT down, off = no WiFi
                mode. X10A-down outranks MQTT-down (the bus is the point of the device). Plus two
                the recovery button asserts via status_led_signal() (an atomic, so no lock is taken
                on the erase path): red 60ms strobe = factory reset ARMED, solid white = erasing.
                The override pre-empts every operating phase — a board being deliberately reset is
                usually perfectly healthy, so gating the warning on a fault would hide it exactly
                when it matters. Waits are SLICED (25ms) and re-check the signal, so the override
                shows within a slice instead of up to a full 1s pattern later. Started AFTER
                config_load (it reads the config). Exposed on /status.board (pin/driver/polarity),
                never as a value — the light itself is local-eyes-only. ANNOUNCES the resolved
                pin+driver+polarity on /diag at task start ("led: WS2812 indicator on GPIO35"), like
                recovery_button.cpp does: the failure users actually hit does NOT fail — pointed at a
                valid-but-wrong pin (the shipped XIAO default of GPIO21 on an AtomS3 Lite, whose only
                light is a WS2812 on GPIO35) init succeeds and the firmware drives a pin with nothing
                on it, so the board looks dead while being perfectly healthy and the only evidence was
                the ABSENCE of an error line — indistinguishable from a working indicator. The five
                settings that fix that are one pick in the UI (logic/board_presets.hpp). The task loop self-guards
                like mqtt_task/poll_task: wifi_info()/mqtt_status()/hp_stats() each copy std::strings
                out, so a tick can throw under memory pressure — an escape would reboot the board
                over a cosmetic LED. A dropped tick costs nothing (recomputed from scratch each time)
recovery_button.cpp  physical factory-reset button (config btn_gpio/btn_active_low, DISABLED by
                default): held BUTTON_FIRE_MS (5s) it erases the WHOLE daik_cfg NVS namespace
                (nvs_erase_all) and reboots into the setup portal. The only config reset that does
                not require reaching the device over the network — the cure for "it joined a network
                I can't reach", which wifi.cpp's credential rollback cannot cover (that handles a
                REJECTED password, not a wrong-but-accepted LAN). Press classification is the pure
                logic/button.hpp: an ARM checkpoint at 1.5s lights the warning while there is still
                time to let go, a debounced release (3 samples @20ms) means one bounced sample can
                neither cancel a hold nor silently restart its clock. Default -1 ON PURPOSE — an
                unconfigured input FLOATS, and a floating pin reading "pressed" for five seconds
                would wipe a board nobody touched. A button already held at boot is ignored until
                the pin reads released once (a stuck switch must not fire 5s into every boot). The
                erase is milliseconds, so the indicator LEADS it (250ms) and is held to 1.5s total —
                a signal that merely bracketed the write would be invisible. A FAILED erase does NOT
                reboot: coming back up on the config it just said it deleted is worse than staying up
                and logging why. Started even in safe mode (a boot-looping board is exactly when a
                physical reset is the only way in)
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
logic/          IDF-free, host-tested pure headers (crc, convert, error_codes, registers, value_def,
                config_model,
                config_store, discovery, ha_device, detect, json, mqtt_group, mqtt_uri, heartbeat, crashinfo,
                bootlog, reset_reason, boot_guard, board_pins, board_presets, modbus, syslog_policy, link_watch,
                wifi_rollback, health_gate, version_cmp, ota_manifest, ota_channel, ws_policy, ws_tx_gate,
                http_body, http_surface, query_flag, mcp_jsonrpc, timestamp, uart_plan, detect_backoff,
                hexdump, led_pattern, button, captive,
                lwt_select, ou_stale, profile_view, feature_gate).
                error_codes.hpp = the optional code -> short-English-description lookup layered on
                conv 204's raw fault code (hp_convert.cpp), e.g. "U4: Indoor/outdoor unit
                communication problem". Presentation only: it never changes what conv 204 DECODES,
                so the domain audit still sees the converter's intrinsic semantics, and an unknown
                code falls through to the bare code rather than inventing a description
                (docs/REGISTERS.md §"error codes", docs/HOME_ASSISTANT.md).
                captive.hpp = the captive-portal reply policy for the ONE catch-all route ("/*"):
                in SETUP mode an unmatched GET is a 302 to CAPTIVE_PORTAL_URI, in STA mode it is the
                dashboard's SPA shell. The portal only auto-pops if the joining OS's connectivity
                probe (captive.apple.com/hotspot-detect.html, /generate_204, /connecttest.txt) gets
                the answer that OS keys on, and a 302+Location is the only one all three agents
                understand; serving the PAGE with 200 (what this did through v1.0.7) is a heuristic
                Android may leave undecided, and dragged http_send_gzip's Content-Encoding onto a
                path walked by minimal HTTP clients, not browsers — a redirect's body is empty, so
                gzip leaves the probe path while the real browser that follows it still gets the
                compressed page. Also the ONE place the portal address is written (CAPTIVE_PORTAL_IP
                /_URI), so the DNS answer, the RFC 8910 DHCP option and the Location header cannot
                drift apart. Pure because the STA carve-out is the regression nobody would notice:
                a portal that stops popping gets reported, a dashboard deep link that starts
                redirecting does not
                led_pattern.hpp = the status indicator's state -> pattern rule + the button
                override's PRIORITY, shared by both back-ends (GPIO LED / WS2812) so they cannot
                drift apart, and so "which signal wins" is asserted rather than buried in a blink
                loop. Shape, not colour, carries the state — a monochrome LED sees no colour, so
                every phase is distinguishable by timing alone (the tests pin that exactly two
                phases are solid, and why that pair is safe).
                button.hpp = the recovery button's press classifier (arm / fire / abort +
                debounce). The interesting half is the ABORT path: the action it gates erases the
                user's whole configuration, so "held 4.9s then let go" must destroy nothing, and a
                single bounced sample must not read as a release. Pure, so that is tested rather
                than discovered by holding a button on a desk.
                lwt_select.hpp = the leaving-water MEASUREMENT picker (host-testable twin of
                www/app.js's lwtRow/vLwt): the row that feeds the UI's ΔT / heat-output / COP must be the
                pre-BUH heat-exchanger outlet (R1T) and NEVER a setpoint / mixed-zone / post-BUH (R2T)
                row — a setpoint substituted for a measurement makes all three plausibly wrong (#121,
                the #35-#39 failure shape). Keyed on the (R1T) tag so the alias label forms ("Outlet
                Water Heat Exch", "Tv inflow", "after PHE") resolve too, not just "leaving water before
                BUH". Not a firmware caller — it exists so the CI logic-test gates the browser rule
                against the whole def/ catalog (every detectable profile selects a real measurement).
                EVERY browser consumer resolves through the one lwtRow() — the schematic pill, the
                derived figures AND the inspector's leaving-water rows. A looser second copy of the
                pattern is the failure mode to watch for: it re-opens exactly the substitution this
                header exists to prevent (it matched the bizone kit's MIXED leaving-water row), and
                being a copy, the CI gate on this rule no longer covers it.
                ou_stale.hpp = which readings stop being CURRENT while the compressor is off. The
                outdoor unit refreshes its OWN pages (0x20 sensors, 0x21 inverter) only while it
                RUNS; stopped, it answers with the LAST RUN's values. Measured on a live unit:
                outdoor air read exactly 19.0 °C for five hours, stepped 19.0→23→24→25.5 at the
                instant the compressor started, then sat at 25.5 for two hours, while the HYDRONIC
                pages moved continuously the whole time (leaving water 53.4→49.2 °C over one hour) —
                so it is the unit going quiet, not the poll engine stalling. reading_plausible()
                cannot see this and neither can the domain audit: 19.0 °C IS a plausible outdoor
                temperature, the #35-#39 shape with no numeric tell. Only the PAGE plus the
                compressor state can tell, so DESIGN.md's dead-bus rule ("an idle plant with no
                readings, not a stale one") is applied to one sleeping UNIT instead of one silent
                BUS, and resolved the SAME way: www/app.js's `d.ouHeldOver` BLANKS the outdoor pills
                to "—". v1.0.13 showed them greyed with a `#heldNote` legend instead; that is
                reverted — the drawing has ONE vocabulary for "no reading right now", and a second
                dimmer register of half-valid numbers asks the reader to remember which pills mean
                what. A value the unit is no longer measuring is not reported. What the pill cannot
                say, the INSPECTOR does (the outdoor unit's idle explanation names the reason), which
                is where the "reads as a lost link" complaint is answered instead.
                ΔT blanks too — with no flow it is not a stale working point but none at all.
                Deliberately NOT
                page 0x10 — it carries Defrost Operation, which FEEDS the run-state decision, and no
                measurement could prove whether it freezes (its Target Cond. Temp. reads 0.0 even
                mid-run, a useless witness); blanking a reading costs information, suppressing a
                state input would corrupt the state machine. UNKNOWN rps (no such row in the
                profile) reads as CURRENT, never held-over — absence of evidence. Like lwt_select
                there is no firmware caller: it exists so the CI logic-test gates the browser rule
                against the whole catalog, and the load-bearing half is the SECOND assertion — every
                profile keeps "INV frequency (rps)" on a LIVE page (0x30 in all 27 that have it), which
                is what makes "Standby — not running" trustworthy while the pills around it are not.
                The rule reaches the DERIVED figures too, not just the raw pills, and the electrical
                estimate is where it bites hardest: d.pel prefers the CT clamps (page 0x63, LIVE — a
                non-zero reading at rest is real standby draw) and falls back to "INV primary
                current", which is a 0x21 row and freezes with that page. Every catalog profile has
                the INV row, only about half have CT clamps, and an idle plant reads ct == 0 — so the
                ungated fallback drew LAST RUN's amps as a live kW figure on most installs, most of
                the time, beside the "not running" headline it contradicted. The fallback is now
                gated on ouHeldOver (the test pins which page each of the two sources sits on). It
                BLANKS like every other held reading, and it is the one where blanking is not merely
                the house style but the only defensible answer: a stopped compressor is not drawing
                1.4 kW, it is drawing ~0, so the held figure is not a stale value of the quantity but
                a wrong one. The CT path is unaffected: those clamps are on a live page, so a non-zero
                reading at rest is genuine standby draw and is still shown. The held pill carries NO
                sub-label — a blank pill is the drawing's one vocabulary for "no reading right now",
                and the INSPECTOR is where the reason is stated — but it must not fall through to the
                pre-existing "no current sensor" caption either: suppressing one wrong claim must not
                substitute another (the profile HAS a current row; it is the reading that is not current)
                profile_view.hpp = the active model's rows AS EVERY CONSUMER MUST SEE THEM: the
                generated table plus the def/overlay.hpp supplement, as ONE indexable sequence (two
                spans, no allocation — the poll path reads it every second). One view rather than four
                merges because the four consumers are NOT independent: hp_poll decodes the rows,
                mqtt_ha announces one HA discovery config per row, and BOTH http_status (/values, the
                WS broadcast) and mqtt_ha (the grouped state topic) size their snapshot buffer from the
                row COUNT, which is the exact upper bound on cached values. Grow the cache without
                growing the count and the extra values are silently TRUNCATED out of /values and MQTT —
                an absent-value bug with no error anywhere, the #35-#39 shape. Carries the OVERLAY
                RULE: a supplement block applies ONLY IF the base profile already references the
                block's page. That one condition is what makes a hand-written supplement safe next to
                generated tables — it can never set a page bit that was not already set, so (a)
                detection cannot move (a profile's signature IS its page set, and detect_candidates
                picks maximal overlap) and (b) no bus round-trip is added, which on a model that does
                not answer the page would be one TIMEOUT per cycle, reading on /diag exactly like a
                wiring fault. Belt AND braces: signatures.hpp builds its mask over def::profiles (the
                BASE tables) and never sees a view at all — the test asserts the braces, since the belt
                is what a refactor would remove
                feature_gate.hpp = which derived features may HONESTLY run on the detected model, and
                the answer when they cannot: DISABLE, NEVER DEGRADE (#69 step 0.2 / #110 Part C). The
                same rule the UI already applies twice — lwt_select blanks ΔT/heat/COP rather than
                substituting a setpoint (#121), ou_stale blanks a held-over pill rather than showing a
                dimmer register of half-valid numbers — so a "reduced feature set" is that
                already-rejected second vocabulary under a new name; and a rule (or model) fit on a
                feature vector does not degrade gracefully when columns vanish, it just gets confident
                about a distribution it never saw, which is the "pretend full features" outcome #69
                rules out by name. Coverage is read off the ROWS, never off `profile == "generic"`:
                generic IS the extreme case (measured — no leaving-water MEASUREMENT, only the
                "LW setpoint (main)" that lwt_select correctly rejects; no INV frequency, no expansion
                valve, no pressure row) but NOT the only one — SIXTEEN of the 43 DETECTABLE profiles
                also lack page 0x30 and with it the compressor run-state input, so an id check would
                have let inference run without run-state on more than a third of the detected catalog.
                Takes the VIEW, not the base table: the retry counters live in the supplement, so
                coverage read off the generated rows alone would answer correctly for the wrong reason
                today and wrongly the moment the generator emits them. No firmware caller yet (#69
                Phase 3 has not landed) — pure so the policy is ASSERTED rather than re-litigated at
                the future call site, like lwt_select and ou_stale
                value_def.hpp = the ValueDef row type the generated def/ profile tables are written
                in ({reg, offset, conv, size, type, label} — registry id, byte offset in the reply
                payload, converter id for convert.hpp, byte count, HA unit code, English label): the
                shared vocabulary between the offline generator's output and the decode path. Plus an
                optional 7th field `no_publish` (defaults false, so every existing generated row is
                unchanged) = a DETECT-ONLY row: the page exists on this model and must keep counting
                toward the detection signature, but the value is an absent-feature placeholder that
                hp_poll never caches and publish_discovery never announces. Kept-not-deleted ON
                PURPOSE: a profile's signature IS the set of pages its rows reference
                (def/signatures.hpp) and detect_candidates picks MAXIMAL page overlap, so deleting the
                row makes the correct profile lose a page to a feature-richer WRONG profile that kept
                it — the model mis-detects and the same garbage returns through that table. Used for
                the 0x64 hybrid/boiler page on the non-hybrid 4-8 kW monobloc/hydrobox profiles
                (test_no_publish pins both halves)
                ha_device.hpp = the ONE Home Assistant DEVICE identity all three discovery surfaces
                share (discovery.hpp values, heartbeat.hpp diagnostics, crashinfo.hpp crash): the
                slug rules (ha_slug, which object_id now delegates to), device_node_id(base) =
                the node id derived from the MQTT BASE TOPIC — an INSTALLATION id, so a board swap
                keeps the device — and device_json(node, board_id) = the dev block, stable id first
                and this board's MAC id second (dropped when empty or equal; a duplicated identifier
                is malformed for HA). A dev block that drifted between the three builders would split
                the board across two HA devices again, so the test asserts all three carry the same one.
                json.hpp = the ONE RFC 8259 string encoder every JSON payload goes through (/status,
                /values, /scan via http_status.cpp's jstr; the MQTT state/heartbeat/crash topics).
                Escapes " and \ AND every control byte < 0x20 (\b\f\n\r\t, else \u00XX) — the strings
                are NOT all ours: an SSID is arbitrary bytes from any AP in range, and escaping only
                the first two let "Free<LF>WiFi" put a raw newline in a JSON string, so the WHOLE
                response failed JSON.parse — first seen as the setup portal's network dropdown
                collapsing to a free-text box, and still reachable via /status.wifi.ssid (the
                associated AP names itself) + /scan now that the portal takes a TYPED SSID and parses
                nothing. BENEATH the DOM-node escaping of a RENDERED SSID
                (#52, fixed in #65): orthogonal, neither subsumes the other — #65 stops hostile SSID
                MARKUP, this makes the bytes PARSE at all (a decoded SSID of `"><script>` is valid
                JSON, and #65's DOM nodes still never see it if the parse fails first).
                Bytes >= 0x20 pass through
                verbatim (raw UTF-8, 0x7F) — the cast to unsigned char is load-bearing, since `char`
                is signed and a naive c < 0x20 would mangle every non-ASCII SSID.
                ws_policy.hpp = the /events frame policy: ws_frame_plan() decides on the ANNOUNCED
                length alone (Skip empty / Read what fits the 16 B command buffer / Reject the rest)
                and ws_frame_action() classifies only bytes a read actually delivered. The length is
                a client-asserted 64-bit number read before any payload, so it must reach a decision
                and never an allocation; a rejected frame closes the connection because
                esp_http_server cannot skip a frame body and its unread payload would be parsed as
                the next frame's header. ws_tx_gate.hpp = the async-broadcast backpressure rule:
                one values and one status batch may be outstanding; a busy stream drops newer ticks
                instead of retaining another payload while IDF completion work is delayed. Clients
                in a batch share one refcounted immutable payload, and the fd-list mutex is released
                before any IDF queue call. http_body.hpp = the request-body recv loop
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
                ota_channel.hpp = which published FEED this device follows, and the URLs for it.
                Two feeds exist because a merge to main no longer cuts a release: `release` (the
                gh-pages root, cut by a manual workflow run) and `dev` (<base>/dev/, every
                firmware-relevant merge). The dev URL is DERIVED from the configured firmware base,
                never a second Kconfig string — a separately-configurable dev URL is a second thing
                that can silently point elsewhere, and the dev feed is a subdirectory of the release
                feed by construction (scripts/build-pages.sh --dev writes it, publish-pages-branch.sh
                --dev owns exactly that subtree). Pure so the join rules are asserted: a base with or
                without its trailing slash yields the same URL, and an EMPTY base yields "" (the
                caller says "no update URL configured") rather than a relative path that would be
                fetched against nothing and reported as an unreachable server
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
                Altherma-only model profiles from a bus fingerprint (page mask + capacity, O/U or the
                I/U-code fallback) to a candidate set + a best-fit representative (detect_best; ranks by
                maximal page overlap -> kW class containing the capacity -> tightest class). The set is
                register-equivalent only when the capacity is KNOWN; when it is absent the set spans kW
                classes, so the I/U-capacity fallback that ranks the representative does affect values;
                mqtt_group.hpp maps a register page to a friendly group name, builds the grouped
                state JSON, and encodes a BINARY reading for the wire (binary_state_number: "ON"->1,
                "OFF"->0, anything else -> nullptr so the caller publishes the text rather than
                inventing a 0); discovery.hpp's ha_component types the same rows as binary_sensor and
                retired_sensor_discovery_topic yields the pre-split `sensor` topic to delete;
                heartbeat.hpp builds the board/link diagnostics JSON (FLAT — each field
                prefixed by its block name, e.g. wifi_rssi/wifi_mac/bus_rx_received, not nested) + its
                diagnostic HA discovery configs; crashinfo.hpp turns a captured CrashInfo (reset reason + core-dump
                summary) into the last_crash JSON / MQTT crash payload + a paste-friendly text bundle,
                and classifies which reset reasons are faults; board_pins.hpp = the ESP32-S3 CHIP-safe
                X10A GPIOs (the RX/TX pin-picker dropdown when detection hasn't locked the pins) —
                minus flash/strapping/USB-JTAG/JTAG always, minus GPIO33-37 when the build runs Octal
                flash/PSRAM, and minus the pins the firmware itself drives (ReservedPins: the status
                indicator AND the recovery button): chip-safe is not free, and offering a pin
                status_led.cpp holds as a push-pull output — or that button.cpp holds as a pulled
                input — is a pick that cannot work. A SECOND, wider set,
                board_pin_local_io()/board_pins_local(), is what the indicator + button themselves may
                use: it adds back exactly the dedicated-JTAG pads 39-42, which the X10A list withholds
                as a PREFERENCE (keep a debug probe usable) rather than a hardware conflict — a
                preference that cannot survive an onboard part soldered there, e.g. the AtomS3 Lite's
                button on GPIO41. The reservation runs in BOTH directions and the two accessors say
                which is which: board_pins_offerable takes config_reserved_pins (indicator + button,
                withheld from the X10A picker), board_pins_local takes config_link_pins (the live
                rx/tx, withheld from the LED/button pickers). ReservedPins itself is deliberately
                anonymous about the pair (pin_a/pin_b) — naming the fields after one direction made
                the other read as a lie. Leaving pins_local unfiltered was the one place the rule ran
                one-way: the picker listed GPIO44/43, board_hw_valid then refused them, and the user
                learned of the conflict from a 400. `octal_spi` still comes from Kconfig at the call
                site (config.cpp hw_octal_spi()); both `reserved` inputs come from the live CONFIG,
                since all four pins are runtime. board_pins_offerable() fills a CALLER-owned buffer — a
                filtered static would race, as build_status_json runs on httpd AND the poll task's WS
                broadcaster. It says nothing about which pins a given BOARD breaks out to a header
                (no board-ID EEPROM exists); README.md carries that per-board table for humans;
                board_presets.hpp = the SAME per-board facts made applicable: the five board-local
                settings (led_gpio/led_type/led_inverted/btn_gpio/btn_active_low) for each documented
                board, served as /status.board.presets and filled into the Hardware modal by one
                pick. In firmware, not in www/app.js, so a preset can be host-tested against the very
                validator POST /set_board applies (board_hw_valid) and cannot drift from
                docs/BOARDS.md into pins the device would reject; board_presets_offerable() withholds
                a preset this BUILD reserves (the AtomS3 Lite's GPIO35 LED is SPIIO4 on an Octal
                build) AND one this CONFIG reserves (a link moved onto that preset's LED or button
                pin), because a pick that cannot work is not a pick — the same rule, on the same two
                axes, that the two pin dropdowns now apply. Says nothing about which board
                this IS (unknowable); picking one is the USER stating the hardware;
                modbus.hpp = Modbus TCP framing (MBAP, no CRC) + HomeHub register codecs
                (Temp16/Pow16/Int16/Text16 decode+encode) + the homehub-* mDNS filter — host-tested
                core for the PLANNED firmware-exclusive HomeHub Modbus link (issue #32), not yet wired.
                timestamp.hpp = rfc3339_utc(unix_s, ms) — the ONE UTC formatter the SNTP wall clock
                (sntp_time.cpp) renders through, for syslog.cpp's RFC 5424 TIMESTAMP field,
                /status.ntp.time, and mqtt_ha.cpp's heartbeat "time" field. A negative unix_s
                (sntp_time.cpp's "never synced" sentinel) returns
                "" rather than a plausible-looking 1970-01-01 — callers key on the empty string to
                fall back to the RFC 5424 NILVALUE / JSON null instead of asserting a wrong instant.
                hexdump.hpp = hex_render() for the RAW X10A page payloads hp_detect.cpp puts on
                /diag (pages 0x00, 0x10, 0x20, 0xA0, 0xA1, one line each, only on a detect pass —
                0x10/0x20 carry readings measured IMPOSSIBLE on a live unit yet inside
                reading_plausible()'s ±200 °C window, so nothing masks them: Target Evap. Temp.
                (0x10/6) hit 199.6 °C, and the outdoor pressures (0x20/12+14) read 0.0 bar with the
                compressor at 42 rps). HTTP exposes
                only DECODED values, so a physically impossible reading cannot be attributed to a
                wrong converter vs. a wrong byte offset vs. a per-unit layout difference without the
                wire bytes — and they otherwise never leave the device. Truncation is by WHOLE bytes:
                a trailing nibble would read as a different value, and a hex dump exists to be read
                literally. A 32-byte payload renders to 95 chars, well inside diag's 256-byte line.
def/            embedded per-model value profiles + registry (incl. the generic Altherma fallback =
                universal register core) + models_catalog.hpp (GET /models) + model_names.hpp
                (id→display/family/marketing name for /status) + signatures.hpp (Altherma-only
                detection signatures derived from the tables). Profiles are machine-generated in the
                ValueDef row format by the offline value-catalog *profile generator* (gen_profiles.py),
                which is maintained OUTSIDE this repo — do not confuse it with the in-repo
                `tools/domain/` audit tooling, which is a different toolset entirely. Never
                hand-edit a generated table: regenerate it, and verify rows against docs/REGISTERS.md
                (the in-repo source of truth, and the check any contributor can actually run).
                ONE hand-written supplement exists and is TEMPORARY: overlay.hpp, the page-0x10
                protection words (offsets 10-12, convs 303/307/310/311 — UC5's retry counters, #110
                Part B). Every generated profile carries SIX rows for page 0x10 where REGISTERS.md §5
                documents TWENTY-SIX, uniformly across all 43 tables — the generator's page-0x10 input
                is narrow, it is not a per-model absence — so conv 310 (implemented in PR #111) had no
                row to decode and decoded nothing in the field. The supplement adds the rows WITHOUT
                touching a generated table; logic/profile_view.hpp presents generated+supplement as one
                row sequence and carries the OVERLAY RULE (a block applies only if the base already
                references its page), which is why this cannot do what hand-editing would: it can
                never set a page bit that was not already set, so detection cannot move and no bus
                round-trip is added. The rows ARE audited — tools/domain/catalog_audit.cpp resolves the
                view, so they are cross-checked against REGISTERS.md §5 per profile like any generated
                row, and the page-0x10 catalog guard in test_logic.cpp (armed vacuous in #111) is live
                on them. DELETE overlay.hpp + its plumbing when gen_profiles.py emits the rows: a
                supplement that outlives its generator run is a second source of truth for the catalog.
www/            web UI sources (index.html + style.css + app.js -> one gzipped page) + setup.html
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `cfg` — the **atomic credential/service blob** (`logic/config_store.hpp`): WiFi creds + the one-shot rollback backup + flags (`wifi_rolledbk` outcome marker included), MQTT (`uri`/`user`/`pass`), syslog (empty host = off), `ntp_server` (empty = reset to the `CONFIG_DAIKIN_NTP_SERVER` compile-time default on next boot), (blob **v2**) the **board-local hardware** `led_gpio`/`led_type`/`led_inverted`/`btn_gpio`/`btn_active_low` and (blob **v3**) the **OTA update channel** (`ota_channel`, 0 = release / 1 = dev) — in the blob because, like the credentials and unlike the link cache, each has exactly ONE writer (httpd, `POST /set_board` / `POST /set_ota`). An OLDER blob is still ACCEPTED: **v1** (pre-board OTA) reports `has_board=false`, so `config_load` seeds the board fields from Kconfig instead of reading "absent" as "indicator off"; **v2** (pre-channel OTA) reports `has_ota=false`, which needs no Kconfig fallback — the pre-v3 world had exactly ONE feed, and that is the release channel the struct already defaults to. Rejecting either would drop that user's WiFi/MQTT creds on the upgrade. One CRC-checked entry written all-or-nothing, so the whole credential/service state survives a write failure or power cut together — no per-key write-ordering. The X10A **link cache** `rx_pin`/`tx_pin`/`proto` stays as SEPARATE self-healing keys (two owners: `config_save` for a manual override, `config_save_link` for a detected pin; re-validated on load). Legacy per-key credential keys (`wifi_ssid`/`wifi_pass`/`wifi_ssid_back`/…/`ntp_server`) are still READ as the fallback when `cfg` is absent (fresh device / pre-blob OTA). Plus the boot-loop **crash counter** `boot_fails` (safe_mode.cpp; here so a factory reset wipes it too). (Hostname is fixed at `CONFIG_DAIKIN_HOSTNAME`, poll cadence at `POLL_INTERVAL_S`=1 s, labels English-only.) |

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

**`config_save` can fail — every caller checks it.** The credential/service fields are written as one
CRC-checked blob with a single **atomic** `nvs_set_blob` (`logic/config_store.hpp`): it fails
all-or-nothing, so on error the PREVIOUS blob is intact and `config_save` returns `false` without
publishing to RAM — never a partial credential state, across both a write failure and a power cut.
The self-healing RX/TX/proto link keys are written after the blob; a hiccup there is logged,
self-heals on the next detect, and is re-validated by `config_load`'s `link_pins_safe`. It does not
turn an already-committed service request into a false 500; `/set_hp`, which owns the link, opts into
requiring those keys and leaves RAM untouched on failure. The decision is host-tested in
`config_save_succeeded()`.
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
                  pins the firmware itself drives — the status indicator and the recovery button —
                  logic/board_pins.hpp),
                  board{led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,pins_local[],presets[]}
                  (the runtime board-hardware config written by POST /set_board; pins_local[] is the
                  LED/button-eligible set — WIDER than pins_avail by the dedicated-JTAG pads,
                  NARROWER by the X10A link's own rx/tx (board_hw_valid refuses a local pin that
                  equals either, so offering them was offering a guaranteed 400) — it
                  drives the two pin pickers in the ESP32 card's Hardware modal; presets[] =
                  {name,led_gpio,led_type,led_inverted,btn_gpio,btn_active_low} per DOCUMENTED board
                  (logic/board_presets.hpp), the modal's "Board" dropdown, which only FILLS the five
                  fields — nothing is saved until the user submits. Carried in this payload rather
                  than a route of its own because the modal already reads pins_local from it: one
                  source, no second fetch to fail, and a preset cannot arrive disagreeing with the
                  pin lists it must fit inside. Empty on a build (or a link position) whose reserved
                  pins withhold every preset — the UI then hides the row),
                  wifi{ssid,ip,rssi,connected,bssid,mac,std,rolled_back}
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
                  ota{channel} — "release"|"dev", the FEED the next OTA check reads (POST /set_ota).
                  On /status and not only /ota/status because the Settings ESP32 card renders its
                  selector from /status like every other setting; a device can be SET to a channel it
                  is not yet running a build from, so it is reported rather than inferred from the
                  running version's "-dev.N" suffix,
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
                  model{name,family,marketing}} — drives the SETTINGS ESP32 board card (behind the
                  header gear, with the Connections tile; the dashboard keeps the model card + values)
                  and the dashboard's model card.
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
                  memcmp'd that uninitialised stack) nor skip past it. Background sends use
                  logic/ws_tx_gate.hpp: at most one values and one status batch remain in flight;
                  newer ticks are dropped until all completion callbacks release the shared payload.
GET  /models      pin hint + catalog metadata (def/models_catalog.hpp). Detection is fully automatic;
                  the UI no longer offers a manual model picker. NO shipped client reads this — the
                  web UI never fetches it, and the RX/TX dropdown takes its GPIOs from
                  /status.pins_avail (logic/board_pins.hpp), NOT from this pin_hint. Legacy metadata
                  behind a read-only inspection endpoint for humans/scripts
GET  /diag[?verbose=0|1][?clear=1]   in-memory diag log
GET  /scan        WiFi scan {"networks":[{ssid,rssi}]} — TRUSTED-LAN ONLY and read by NO shipped
                  client: the setup portal takes a TYPED SSID (no dropdown, no fetch), so this is a
                  humans/scripts diagnostic like /models, not part of the provisioning surface
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
                  Unchanged settings short-circuit to {ok:true,reboot:false}, same as /set_mqtt and
                  /set_ntp — a re-save of identical values would otherwise reboot for nothing.
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
POST /set_board   {led_gpio,led_type,led_inverted,btn_gpio,btn_active_low} -> validate + persist +
                  REBOOT. The board's own onboard parts: which pin the status indicator is on, whether
                  it is a plain LED (led_type 0) or a WS2812 (1), and which pin (if any) carries the
                  factory-reset button. -1 = absent for either pin. Runtime rather than Kconfig because
                  CI publishes ONE esp32s3 image and boards disagree about their onboard hardware.
                  Reboots (unlike /set_hp's live apply): both are claimed once at task start — the
                  WS2812 opens an RMT channel, the button installs a pull — and hot-swapping a running
                  driver from another task buys nothing for a once-per-board setting. Unchanged
                  settings short-circuit to {ok:true,reboot:false} like /set_mqtt//set_syslog//set_ntp.
                  Validation (board_hw_valid) checks the chip-safe LOCAL-I/O set — wider than the X10A
                  set by exactly the dedicated-JTAG pads 39-42, since a board's button legitimately
                  sits there (AtomS3 Lite: GPIO41) — plus the collision rules, in BOTH directions: no
                  pin may be claimed by the indicator, the button and the X10A link at once, whichever
                  endpoint is called second
   (all seven /set_*) a failed route-owned NVS write answers 500
                  {ok:false,error:"config write failed"} and does NOT reboot/apply; unrelated
                  self-healing link-cache maintenance failures are logged without rejecting a
                  committed service blob, while /set_hp requires those keys (the failing key is on /diag)
POST /set_ota     {channel:"release"|"dev"} -> validate + persist, applied LIVE (no reboot, unlike
                  /set_board: nothing claims the channel at task start — ota_update.cpp reads it when
                  it fetches, so the very next check uses the new feed). An unknown name is REJECTED,
                  not defaulted — answering ok to a typo would look like a saved setting. Unchanged
                  -> {"ok":true,"reboot":false} like the other /set_* routes
POST /detect      re-run auto-detection now (no reboot): reset profile to "auto" + invalidate the
                  fingerprint (RAM only) -> the next poll cycle sweeps protocol + re-fingerprints
GET  /ota/check   start an async manifest check (?ms= is parsed but gates nothing — TLS date
                  validation is compiled out, so OTA needs no wall clock even though SNTP now exists)
POST /ota/update[?downgrade=1]  start the async download of the SELECTED channel's build.
                  Re-fetches the manifest and re-runs the downgrade gate
                  itself rather than trusting what /ota/check left behind: this route is reachable on
                  its own, so gating only in /ota/check would mean no gate at all for a direct caller.
                  ?downgrade=1 (query_flag_on — fires on "1" and nothing else) is the CHANNEL SWITCH:
                  the only way to install a build older than the running one (dev -> the last
                  release). Per-request, never stored
GET  /ota/status  {state:idle|checking|updating|done|error, progress, message, update_available,
                  downgrade, channel, available, current} — the UI polls this; all strings go through
                  json_quote. `downgrade` = the offered build is installable but OLDER (the
                  dev -> release direction); the UI needs BOTH flags, since update_available alone
                  makes a release-channel check on a dev board read "up to date" forever
POST /mcp         MCP server (read-only; planned — route returns a JSON-RPC "not implemented" error)
```

No HTTP auth / TLS by design — trusted LAN only. See docs/SECURITY.md.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest *contiguous* free
block). Keep HTTP handlers under a try/catch that returns 503 on OOM (an uncaught throw unwinds
through C frames → `std::terminate` → reboot). Stream `/diag` and the MQTT discovery instead of
one big `std::string`. Treat any new large contiguous allocation as a crash risk. A reboot loop
also stops the poll cycle and drops MQTT availability.

**The STACK is a second, separate budget — and it fails silently.** Everything above is about the
heap; the crash that took v1.0.12 down was a *stack* overflow, and none of the heap rules could see
it. `build_status_json_string()` runs on the httpd task, which had 8 KB; the core dump's task table
read `httpd 7728/460` — 460 bytes off its floor — so it wrote past `pxStack` into its own TCB,
clobbering `pvThreadLocalStoragePointers[0]` with `0x4`, and died ~44 s later inside lwip's
`pthread_getspecific` with a backtrace pointing at an innocent WebSocket send. Two rules follow:
- **Build long JSON with successive `+=`, never one `a + b + c + …` chain.** A chain materialises
  every intermediate `std::string` at once, all live in the same frame; `+=` holds one at a time and
  takes a bare literal with no wrapper (so it also drops the allocations). http_status.cpp's board /
  presets blocks are the worked example.
- **Read the task table in any core dump you open** (`USED/FREE` per task). It is the only place this
  is visible: nothing on `/status` reports stack headroom, and a task can sit one frame from death
  while every heap number looks perfect. Anything under ~1 KB free wants raising —
  `cfg.stack_size` in http_server.cpp, `xTaskCreate` for the rest.
`CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y` (sdkconfig.defaults) now makes the *first* write past a
limit panic at the offending instruction. IDF's default canary is only compared at a context switch
and a sparsely-writing frame can skip over it — which is exactly what happened here (TLS[1], the
neighbour it would have had to cross, was left intact).

**Every allocating FreeRTOS task loop must self-guard.** A task is a C frame boundary like a
handler is: an escaping `std::bad_alloc` → `std::terminate` → reboot. Wrap the loop *body* in
`try/catch (const std::exception&)` + `catch (...)`, `diag_printf` once, skip the cycle keeping the
last good state, and continue after the normal delay — see `mqtt_task` (mqtt_ha.cpp), `poll_task`
(hp_poll.cpp), `syslog_task` (syslog.cpp — its per-cycle `config()` snapshot copies ~10 strings) and
the finer-grained `ws_broadcast_*` guards (http_status.cpp).

**Never allocate while holding a mutex.** The guard above makes an OOM survivable only if the throw
doesn't strand a lock: a mutex taken with a raw `xSemaphoreTake` is *not* released when the stack
unwinds, so every reader then blocks `portMAX_DELAY` and the device wedges into a watchdog reboot —
worse than the crash the guard prevents. Either keep the critical section non-allocating (stage the
work in locals, `swap`/move it in — `poll_once`'s commit) or take the lock through an RAII guard
(`hp_poll.cpp`'s `Lock`, for readers that must copy strings out under the lock). The status mutexes
in syslog.cpp and mqtt_ha.cpp take the first route: `set_status` stores the error as a string-LITERAL
pointer, never a `std::string`, so the writer cannot allocate at all — load-bearing for mqtt_ha's,
which runs on esp-mqtt's own unguarded event task where the rule above is unavailable.

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
