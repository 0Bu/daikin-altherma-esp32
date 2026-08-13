# daikin-altherma-esp32

ESP-IDF 6.x firmware for the ESP32-S3 chip (CI pins **v6.0.2**; `main/idf_component.yml` requires
`>=6.0` because the managed W5500 2.x component uses the ESP-IDF 6 `esp_eth` API). Reads a
**Daikin Altherma** heat pump over its **X10A** service port and bridges every value to
**Home Assistant over MQTT**
(auto-discovery). WiFi (captive portal), MQTT, syslog and the RX/TX pins are configured at runtime
from a **web UI**; the unit **model** and its register set are **auto-detected** from the bus every
boot — there is no manual picker. Firmware is installed from a **browser** (Web Serial) and updated
**OTA** from one of two published feeds — a **release** (cut by hand, via a manual CI workflow run)
or the **dev** channel (every firmware-relevant merge to `main`), picked per device in the UI.
Builds for the **esp32s3** target only.

> **Deep reference:** this file holds the always-needed essentials — and ONLY those. The full
> narrative (poll engine, value profiles, MQTT bridge, WiFi reconnect, OTA, the complete HTTP API
> field reference, the memory measurements) lives in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
> — read it on demand. The X10A wire protocol is [`docs/X10A_PROTOCOL.md`](../docs/X10A_PROTOCOL.md);
> converter-id/enum tables + register map: [`docs/REGISTERS.md`](../docs/REGISTERS.md). The OPTIONAL
> second SOURCE — the READ-ONLY Modbus TCP link to a Daikin HomeHub (EKRHH) — is
> [`docs/MODBUS_PROTOCOL.md`](../docs/MODBUS_PROTOCOL.md): a second source, never an alternative
> transport; both stacks run independently, and a device without a HomeHub runs no Modbus task at
> all. Platform-feature catalog: [`docs/FEATURES.md`](../docs/FEATURES.md); its SIBLING
> [`docs/PLANT.md`](../docs/PLANT.md) carries the features whose subject is the PLANT (24-hour
> checkup, Open-Meteo forecast, ENV III, heating-curve diagnosis) — same scope rule each file
> states, same `feature-docs` skill maintains both. The MQTT/HA entity contract:
> [`docs/HOME_ASSISTANT.md`](../docs/HOME_ASSISTANT.md); the read-only MCP surface:
> [`docs/MCP.md`](../docs/MCP.md). User-facing: [`README.md`](../README.md),
> [`docs/README.md`](../docs/README.md), [`docs/SECURITY.md`](../docs/SECURITY.md),
> [`docs/DESIGN.md`](../docs/DESIGN.md) (web-UI design contract),
> [`docs/WIRING.md`](../docs/WIRING.md), [`docs/BOARDS.md`](../docs/BOARDS.md) (per-board hardware
> facts) and [`docs/REPORTING.md`](../docs/REPORTING.md) (how a bug is filed: ONE public issue
> carrying the device's own report, defensible because the DEVICE redacts first —
> `logic/redact.hpp`; the sole exception is a CORE DUMP, raw stack memory, via the private advisory
> form). Contributor-facing: [`CONTRIBUTING.md`](../CONTRIBUTING.md) — it states the
> outside-contributor half of the rules this file states for us (the local gates, the
> `main/logic/` + test rule, the strictly-linear merge model), so a change to any of those belongs
> in **both**; keep them in sync (the `project-review` skill checks for drift).

**Conventions:** always write the full name `daikin-altherma-esp32` (hostname, SoftAP, MQTT base
topic, docs) — never shorten it to `daikin-altherma`. Do not reference other projects by name in
the code or docs; the heat-pump-protocol credit belongs only in the README "Scope & credits"
section at the bottom.

**How this file stays small:** a new finding lands here as the RULE plus at most a sentence of
consequence and a pointer; the measurement, the defect story and the issue archaeology go to
`docs/` (ARCHITECTURE.md for the chassis, PLANT.md for plant features, CONTRIBUTING.md for the
gates). This file is loaded into every session, so every byte here is paid on every turn —
`scripts/run-claude-md-budget.sh` enforces the byte budget as a CI `gates` step, and the correct
response to it firing is to move narrative out, never to trim a rule.

## Environment note (Claude Code on the web / remote sandbox)

A cloud session **cannot build** (no Docker daemon for `scripts/idf-docker.sh`) and **cannot
USB-flash** — it is for editing, review and CI-driven builds. The `report-capabilities.sh`
SessionStart hook prints what the current environment supports.

**But there IS a real local verification loop** — these run with the plain system toolchain
(g++/clang++, node, python3), no board needed. Run them all before opening a PR; each is a CI
`gates` step except the GIF audit. The full rationale for every gate, its exceptions ledger and its
selftest is in [`CONTRIBUTING.md`](../CONTRIBUTING.md) → "The local loop":

```bash
scripts/run-mock-tests.sh --coverage  # host logic tests + 95% coverage floor + presenter parity
scripts/run-contract-tests.sh     # do the firmware's SOURCE boundaries still hold? (node-only)
scripts/run-domain-audit.sh  # is the value catalog physically RIGHT? (the domain-correctness gate)
scripts/run-description-audit.sh  # can the user find out what each value IS? (node-only)
scripts/run-user-docs-audit.sh  # can a non-specialist understand and act on each diagnosis? (node-only)
scripts/run-schematic-audit.sh    # does the DRAWING still say what it means? (node-only)
scripts/run-ui-use-case-tests.sh  # do all visible UI actions actually work? (node-only)
scripts/run-redaction-audit.sh    # can a bug report still leak the USER's data? (python-only)
scripts/run-ui-gif-audit.sh       # is the README's RECORDING still of this UI? (node-only)
scripts/run-doc-entity-audit.sh   # do the docs' copy-paste ENTITY IDS exist? (c++ host compiler)
scripts/run-claude-md-budget.sh   # is .claude/CLAUDE.md still inside its byte budget?
```

Rules an agent needs before touching any of that:

- **Passing the tests is not the same as being RIGHT.** The tests verify the logic they are handed;
  they cannot see a well-formed value that is physically false (#35–#39 shipped that way). The
  domain audit is the mechanical half; the `/domain-review` skill is the judgement half and is a
  **PR-merge gate on every merge** — unconditional, because deciding up front which files can change
  a value's meaning is the guess that let #35–#39 ship.
- Three more review skills are CONDITIONAL merge gates — `/schematic-review`, `/absence-review`,
  `/ui-use-case-review` — each keyed on a diff regex whose ONLY definition is its
  `.claude/hooks/require-*.sh` hook; read the regex there, never trust a list written elsewhere.
- The plant-diagnostics user contract is maintained by `/user-docs-review` and
  `scripts/run-user-docs-audit.sh`: every visible result needs bilingual meaning, limits and a safe
  next step, while a source fingerprint makes `docs/DIAGNOSTICS.md` stale after evaluator/UI drift.
- Adjudicated audit findings live in per-tool `audit_exceptions.txt` ledgers (domain, descriptions,
  schematic, redaction) — an ADJUDICATION cites evidence, a KNOWN-DEFECT is deleted by its fix, and
  each tool's `selftest.sh` proves the gate still catches the defects it was built for. Counting
  conventions live in the selftests themselves (anchored greps, e.g. `grep -c '^run_case '`).
- The GIF audit is deliberately NOT a CI step: its only remedy is a local re-record
  (`scripts/record-dashboard-gif.sh`, Chrome + ffmpeg), so a CI gate would buy re-stamping instead;
  the `/ui-gif` skill audits + re-records + re-stamps in one place.
- There is deliberately **no clang-tidy/cppcheck gate and no `.clang-tidy` file** — measured, not
  assumed (CONTRIBUTING.md has the numbers); an inert config reads like a guarantee. What `main/*.cpp`
  has instead is a PINNED warning contract: `main/CMakeLists.txt` sets `-Werror=return-type`,
  `-Werror=format`, `-Werror=unused-result` on that component alone (only the firmware `build` job
  compiles it, so the host loop cannot see those).
- **CI cost is a budget rule** (`.github/workflows/build.yml`): every fast gate is a STEP of the one
  `gates` job, never a job each (Actions bills per job, rounded up to a whole minute). The ~5-min
  firmware build is SKIPPED via a per-job `if:` — never a workflow-level `paths-ignore:`, since a
  skipped job still reports its required check — when the diff touches nothing the image or the
  published site is made of. ccache is keyed on the toolchain + `sdkconfig.defaults` +
  `dependencies.lock` (via `scripts/idf-version.sh`, the one shell reader of the
  `esp_idf_version:` pin) and deliberately NOT
  on a hash of `build.yml`, so editing the workflow does not discard a cache nothing invalidated. A
  PR publishes NOTHING (per-PR gh-pages previews are retired). A new always-on job, an ungated build
  or a per-commit publish is a real monthly cost, not a rounding error.
- Count the gates with
  `sed -n '/^  gates:/,/^  build:/p' .github/workflows/build.yml | grep -c 'run: \./\(scripts\|tools\)/'`
  — scoped to the JOB, since the workflow-wide pattern also matches the `build` job's own steps.

Add new decode/format logic to `main/logic/` and a `CHECK` in `test/test_logic.cpp` — never bury it
in a `.cpp` only the device can run. Full detail: [`test/README.md`](../test/README.md).

## Build & Flash

No local ESP-IDF — builds run via `scripts/idf-docker.sh`, which uses the `espressif/idf` Docker
image **pinned to the version CI builds with** (read at runtime from
`.github/workflows/build.yml`). Flash from the host with `esptool` (`brew install esptool`),
since Docker on macOS has no USB passthrough. The `flash-esp32` skill wraps both.
When waiting on CI, block on `gh run watch <run-id> --exit-status` — never sleep-poll.

```bash
# The esp32s3 target is pinned in sdkconfig.defaults, including on the first build.
scripts/idf-docker.sh idf.py build

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

Two boards are documented, for *different* things. The compile-time X10A pin defaults are the
**Seeed XIAO ESP32-S3**'s — **RX=44 (D7) / TX=43 (D6)** — so that board finds the bus unconfigured.
The **M5Stack AtomS3 Lite** is what the user-facing wiring (README table, `docs/WIRING.md`) is
written for (Grove port reaches X10A with no soldering), but **RX=1 / TX=2 must be picked once** in
the UI — detection probes only the cached pair, the Kconfig pair and each of them swapped. Both
flash over native USB-Serial/JTAG without a BOOT-button dance.

## Architecture (component map)

One line of identity plus the invariant(s) that must survive any edit. The narrative behind every
entry is in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) (same component names).

```
main.cpp        boot: NVS, config, safe-mode guard, WiFi(STA)|setup-AP, SNTP, mDNS, HTTP, MQTT,
                poll, OTA gate. The sequence runs inside an EXCEPTION BOUNDARY that abort()s with
                the phase named — abort and NOT esp_restart, because a "sw" reset is classified
                INTENTIONAL and would clear the crash counter, so a boot that always threw would
                loop forever without ever reaching safe mode
safe_mode.cpp   boot-loop safe mode (logic/boot_guard.hpp): counts CRASH-ONLY boots in NVS
                (boot_fails); past BOOT_FAIL_THRESHOLD it latches -> main.cpp skips poll + MQTT
                (WiFi + web UI + OTA stay up). A LATCH, not a cycle: the healthy-uptime timer that
                clears the counter is NOT armed while latched — any non-crash reset already zeroes
                it, and every intentional exit is one. Second entry route: heap_guard latches it
                when the heap watchdog's restart ladder is exhausted (no crash counter touched);
                safe_mode_cause() says which ("heap" needs the OPPOSITE advice of "crash_loop")
heap_guard.cpp  THE HEAP WATCHDOG (logic/heap_watchdog.hpp): largest contiguous INTERNAL block
                under HEAP_CRITICAL_BYTES for an unbroken hold -> deliberate esp_restart, capped by
                the NVS "heap_rst" breadcrumb; the ladder ENDS IN SAFE MODE (#407). Arming and
                recovery use DIFFERENT thresholds (recovery = 2x) — one number lets a hovering heap
                reset the clock forever (#399). Also the home of heap_largest_internal_block(), THE
                ONE largest-block sampler every reporting site uses (MALLOC_CAP_INTERNAL — the
                default cap answers from PSRAM and hides internal exhaustion). Sampled by hp_poll
                at the top of every cycle; NOT in safe mode, which is stated, not hidden
config.cpp      runtime Config (logic/config_model.hpp) in NVS "daik_cfg". WRITERS COMMIT ONLY THE
                FIELDS THEY OWN: httpd (/set_*) uses whole-struct config_save, poll detection uses
                config_save_link/config_set_model — a whole-struct save from detection would revert
                a /set_wifi that landed during the sweep. Credential/service fields are ONE atomic
                CRC-checked blob (logic/config_store.hpp, single nvs_set_blob, all-or-nothing);
                the RX/TX/proto link cache stays separate self-healing keys (two owners,
                re-validated on load via link_pins_safe — flash can hold a pair the request path
                would have rejected). config_save can FAIL and every caller checks its own
                durability contract; a failure names the key on /diag
nvs_storage.cpp thin NVS helpers; setters return esp_err_t and are [[nodiscard]] (the component's
                -Werror=unused-result makes a dropped write a build error). Compare to ESP_OK,
                never coerce to bool
wifi.cpp        STA bring-up (all-channel scan -> strongest AP) + endless reconnect (once online it
                NEVER reboots on a disconnect reason — 15/202/204 are also transient WPA3-SAE
                failures) + REASON-AWARE one-shot credential rollback (logic/wifi_rollback.hpp:
                only a SUSTAINED auth refusal, 2 checkpoints ~60 s, is fast; an absent SSID gets
                180 s — a router still rebooting is not evidence against new creds) + ICMP gateway
                watchdog (logic/link_watch.hpp: three-valued probe — "couldn't measure" must never
                read as "healthy")
net.cpp         OPTIONAL WIRED TRANSPORT (W5500 on SPI; AtomS3 Lite + PoE base). A second
                TRANSPORT, never a second source. Runtime-DETECTED (VERSIONR read once; no W5500 ->
                SPI bus freed, pads stay offerable). The probe REFUSES to run when a pad is already
                claimed (logic/net_link.hpp) — its clock edges would land on the X10A bus. Wire
                wins the default route (route_prio 128, off-link only); pulled cable on a
                came-up-wired board = deliberate reboot after ~30 s (re-runs the one boot fork).
                mDNS lives here (net_mdns_start, idempotent)
sntp_time.cpp   SNTP client (config().ntp_server, POST /set_ntp). The server string is resolved
                once into a file-scope std::string — lwip stores the raw POINTER, so it must
                outlive the client; an edit applies by reboot. Uptime prefix stays beside the wall
                clock everywhere it already was (triage keys on it)
provisioning.cpp setup SoftAP + DHCP DNS-offer + RFC 8910 option 114 (captive-portal URI — a STATIC
                buffer, same pointer-lifetime trap as the SNTP server). AP-ONLY: the portal takes
                the SSID as TYPED TEXT, no scan, no STA interface. Every step's return is checked
                and named on diag (serial only — /diag is withheld from the open AP)
captive_dns.cpp UDP:53 catch-all -> 192.168.4.1 (setup mode only). Copies RD, sets RA (a stub
                resolver may discard the answer otherwise); AAAA gets a 0-answer NOERROR
hp_comm.cpp     X10A UART (9600 8E1). Driver installed ONCE; a pin change is a register-only
                uart_set_pin remap (logic/uart_plan.hpp) — reinstall-per-swap fragmented the heap
                into an abort on a silent bus
hp_convert.cpp  formatting over logic/convert.hpp; applies reading_plausible() + value_available()
                at PUBLISH time. Refrigerant-vs-water 0-bar is decided STRUCTURALLY (page or
                conv-405 twin), never from the label; a false positive would withhold a real 0-bar
                water reading from a drained system
hp_detect.cpp   protocol sweep + page probe -> fingerprint -> candidates. Each page is RETRIED
                (DETECT_PAGE_TRIES=3): the probe gathers IDENTITY, signature matching is on page
                SUBSET, and there is no page it is safe to drop (8 of 12 single-page losses leave
                NO candidate). I/U capacity is a ranking fallback, and (#225) narrows candidates
                only where a surviving class corroborates it
hp_modbus.cpp   THE HOMEHUB MODBUS STACK — second, INDEPENDENT source (own task/cache/link state;
                shares nothing with hp_poll but the plant). Non-empty mb_host = poll exactly that
                target; empty = NO task, socket, mDNS or stack. READ-ONLY as a property of the
                CODE: no write builder exists anywhere under main/ and
                test_heating_curve_diagnosis_contract.mjs keeps it so. mDNS browse ONLY from the
                explicit POST /discover_homehub action. MbResponse BORROWS its caller-owned ADU.
                logic/modbus_plan.hpp batches the map: full cycle every 5 s; fast batches carrying
                gates (input 53 + 38) or plant-outdoor context (input 44, never a gate) at 1 Hz; only a clean
                FULL cycle clears the map-wide current error
hp_poll.cpp     poll engine task: X10A ONLY, wdt-subscribed (reset per cycle + per register).
                heap_guard_sample() + history_record_board() at the top of EVERY cycle — the one
                path no branch can skip (pinned by test_source_absence_contract.mjs). Detect
                backoff on a silent bus (logic/detect_backoff.hpp; wdt-safe by skipping ticks).
                Skips rows row_publishable() refuses; MARKS held-over outdoor rows (marked, not
                dropped — history needs HELD_OVER vs NO_READING); dumps raw 0x10/0x20 while the
                compressor RUNS (logic/raw_capture.hpp); carries the cross-page saturation witness
                to the NEXT cycle (it EXPIRES unconditionally each cycle). CachedValue owns only
                the formatted value; label/unit borrow firmware-lifetime catalog strings so the
                full snapshot remains one TLS-safe contiguous allocation. It publishes to no
                client — the browser polls (#241; no WebSocket, see "no /events")
env3.cpp        OPTIONAL M5Stack ENV III (SHT30+QMP6988, one I2C bus) — THIRD source, own task.
                Gate is literal: disabled or non-M5Stack vendor -> no task, no bus, no pullups
                (env3_start re-checks itself). A SAVE is HARDWARE-PROVEN (logic/env3.hpp: probe on
                enable, DisableFirst on pin move, disabling checks NOTHING — the recovery path);
                applies by REBOOT (the I2C driver owns the bus). Machine codes beside English
                errors. NOT in /values or the checkup (an accessory is not a plant reading); its
                ONE firmware consumer is the heating-curve outdoor axis — CONTEXT, never a gate.
                samples/errors ride BOTH document shapes (two counters, never a pre-divided rate)
weather_forecast.cpp  Open-Meteo client. THE SAVED LOCATION IS THE WHOLE GATE: saving coordinates
                IS the consent to send them (+ the source IP); clearing is set_disabled() and
                retracts the retained MQTT doc through the ONE cleanup route. Own task (12288 stack
                — TLS+HTTP+JSON on one frame; both catch halves on the loop). Everything else is
                refusal: bounded response, units re-verified, backward provider timestamp rejected,
                issued_at stays null (never backfilled), a location edit invalidates the stored
                value. A lock-free flag plus 1.1 s lead lets MQTT release its snapshot before TLS;
                the bounded OTA quiesce budget is shared. The MQTT evidence doc carries NO
                coordinates (host-test pinned)
history.cpp     24-hour trend rings: STATIC, in .noinit DRAM (never heap — the binding limit is the
                largest CONTIGUOUS block; never NVS — ~100k writes/yr beside the WiFi creds).
                THREE instruments (x10a/modbus/env3), never merged — separate liveness. Survives
                power-kept resets in place; upper-flash `history` APPENDS one dense source record
                per completed 5-min bucket across reboot/OTA/power loss on the official 8 MB layout.
                Commit word LAST; torn record ignored, previous records stay valid; 4 KiB sectors
                rotate over the whole partition. There is no old-table/coarse fallback: install the
                table once by USB/Web Serial. Browser storage is not a history source. Every restore path
                is sealed by a CATALOG FINGERPRINT (rings are addressed by INDEX — reordering
                trends would hand one row's day to another, #35–#39 via update); the seal EXCLUDES
                the open bucket. Journal BUCKETS define the restored span, not the first numeric
                value, so an all-NO_READING row keeps its raster. NO_READING vs HELD_OVER
                distinguished; POST /detect discards
                rings (a different profile is a different sensor). /status.history.persist names
                how this boot's rings came to be
checkup.cpp     24-hour PLANT CHECKUP (/status.health): counted EVENTS + window minima — NOT a
                view over the trend rings (fold keeps the LAST reading per bucket; short cycling is
                invisible there). Fed at 1 Hz beside history_record with the compressor state
                HANDED OVER, never re-derived. Rings in .noinit under a LAYOUT fingerprint;
                model identity is checked at DETECTION (checkup_reset_on_detect), not at boot;
                SAFE MODE never adopts (nothing would age the window). covered_s / per-check
                observed_s keep the honesty: no green verdict without evidence
state_dwell.cpp HOW LONG each switched row has read what it reads (bit flags + fault class only;
                48 scalar slots, 768 B — a ring would cost 576 B/row). THREE facts on /values
                (dwell_s / dwell_min lower-bound / dwell_blind_s), because the number alone claims
                more than the device knows. WITNESSED is strict (previous cycle); whole seconds
                quantise ABSOLUTE instants (flooring intervals ran 23% slow); past DWELL_MAX_GAP_S
                a slot reports NOTHING. In .noinit — the __NOINIT_ATTR object MUST be a union with
                a user-provided empty ctor or NSDMIs silently re-initialise (#417, reads as
                bad_crc)
http_server.cpp esp_http_server :80; routes register themselves. cfg.max_uri_handlers is sized
                EXACTLY to the trusted-LAN route count (34) — raise/lower it in the SAME commit
                that adds/retires a route; an overflow is silent and the casualty is whatever
                registers LAST (the SPA catch-all). Trust surface picked from the SETUP AP's
                existence (logic/http_surface.hpp): the open AP gets only provisioning routes
http_common.cpp shared helpers + THE ONE OOM guard: http_register() wraps every handler in the
                handle_all trampoline (bad_alloc -> 503, other throw -> 500). No route is exempt
http_status.cpp GET / /status /values /history /models /diag /scan /coredump + POST /crash/dismiss
                + captive catch-all. http_append_status_json() runs on the httpd task ALONE (#241)
http_config.cpp ALL SIXTEEN write routes (see HTTP API below) — the count is what
                cfg.max_uri_handlers is sized to. Four of them write no config: the two /test_*
                probes, /discover_homehub, /detect
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp: stateless read-only MCP (initialize/tools/list/tools/call; reuses the exact
                HTTP snapshot builders); GET serves an embedded static page, never SSE
mqtt_ha.cpp     HA MQTT-Discovery bridge. Load-bearing rules: a field's JSON TYPE comes from its
                CONVERTER (PublishedKind), never re-inferred from the formatted string; binary rows
                publish the NUMBER 1/0 with explicit pl_on/pl_off (metrics consumers drop strings
                AND bools); conv-203 rows also publish error_active/warning_active
                (logic/fault_state.hpp — UNKNOWN class publishes NEITHER); entity ids are
                group-scoped <group>_<object_id> (#221 — labels collide across pages); the HA
                device id is the SLUGIFIED BASE TOPIC (installation identity — a board swap keeps
                the device), the MAC lives on as client id + second dev.ids entry; every
                superseded retained identity is RETRACTED in one pass BEFORE replacements go out;
                retired entities' uniq_ids are BURNED (test_entity_identity). Heartbeat: flat JSON,
                10 s cadence, numeric flags; stack budgets as *_stack_min_free_bytes (bytes — IDF's
                high-water mark answers bytes, and a wrong unit word in a series name is #230's
                LABEL-UNIT rule on a board metric). Crash topic retained only when NOTABLE; probes
                before deleting so a clean broker sees no empty publish. wdt: unconditional
                top-of-loop reset + per-publish reset. X10A installation availability uses the
                monotonic last-good age: a sustained 15 s loss publishes offline, while a shorter
                all-page timeout neither flaps availability nor retains an empty state. THREE
                inbound things ride this task: the
                room-source test/live decode (POST /test_ref_temp issues a PROOF bound to all seven
                behavioural fields — testing topic A cannot license saving topic B), the
                heating-curve sampler (gate order HomeHub -> plant -> heating-mode -> room -> X10A;
                consent = the SAVED room mapping, deleting it disarms and clears), and the
                circulation witness (#361, same consent shape). Before allocating a publish
                snapshot it applies one bounded hold-off to OTA OR weather TLS activity
ota_update.cpp  pull-based signed OTA. Channel read FRESH on every check (release = gh-pages root,
                dev = <base>/dev/; dev builds are semver PRE-releases so ordering does the work).
                TWO-POINT downgrade gate: manifest version AND the image's own esp_app_desc_t,
                exact match required; ?downgrade=1 relaxes ORDER only, never signature, never
                persisted. Both network ops on ONE on-demand task, one at a time (two TLS sessions
                fight over the largest block). The publisher QUIESCES from before manifest TLS
                setup through the download (logic/ota_quiesce.hpp, bounded); only init-OOM and TLS
                setup allocation failures get one cleanup-and-retry
status_led.cpp  status indicator: TWO back-ends (GPIO / WS2812) behind one host-tested pattern
                table (logic/led_pattern.hpp). Pin+driver+polarity are RUNTIME (CI ships ONE
                image; boards disagree). X10A-down outranks MQTT-down. Button override pre-empts
                every phase; waits are sliced 25 ms. ANNOUNCES the resolved config on /diag at
                start — a wrong-but-valid pin FAILS SILENTLY (init succeeds, board looks dead).
                Task loop self-guards (string copies can throw; an escape reboots over a cosmetic
                LED)
recovery_button.cpp  factory-reset button (default -1 = DISABLED — a floating pin reading
                "pressed" 5 s would wipe a board nobody touched). Hold 5 s = erase daik_cfg +
                reboot; ARM warning at 1.5 s; debounced release (logic/button.hpp). Held at boot =
                ignored until released once. A FAILED erase does NOT reboot. Started even in safe
                mode
diag_log.cpp    in-RAM diag ring (GET /diag); each line also forwarded to syslog_send()
syslog.cpp      optional RFC 5424 UDP client. TIMESTAMP = SNTP wall clock once synced, else the
                "-" NILVALUE (never a fabricated 1970 instant). Gated on DNS only; ICMP probe is
                ADVISORY. On the FIRST resolve of a boot it replays the boot records ONCE
                (logic/bootlog.hpp) straight down the socket — NOT via diag_printf (the queue is
                full and non-blocking exactly then). Send failures are CLASSIFIED
                (logic/syslog_policy.hpp): only a HARD errno re-resolves; errno captured INSIDE
                syslog_sendto before close()
diag_crash.cpp  one-shot boot capture of reset reason + core-dump SUMMARY into a cached CrashInfo
                — never re-parsed on a request path. An ORPHAN dump (foreign app-elf-sha) is
                erased at capture, on PROOF only; proven-foreign stays suppressed all boot even if
                the erase fails. The `coredump` flag alone is re-read from flash per request
                (?clear=1 can erase mid-session). Dismissal: ERASE FIRST, mark second
rtos_guard.hpp  THE ONE unwind-safe RAII mutex guard (daik::SemGuard, aliased `Lock`) — replaced
                nine per-file copies that had diverged; adds the bounded/zero-wait acquire callback
                contexts need
task_config.hpp THE task priority table (TASK_PRIO_*) — relative priority is a system property, so
                it is declared once; THE TABLE IS THE COUNT. Stack sizes deliberately stay at call
                sites (each justified by its own measured deepest frame)
stack_watch.cpp THE ONE stack-headroom sampler (four slots: httpd/poll/mqtt/modbus), published as
                *_stack_min_free_bytes. MUST be called from the owning task
                (uxTaskGetStackHighWaterMark answers for the CALLER). ZERO = never sampled,
                rendered null everywhere (a board with no HomeHub has no such task; "0 free" is a
                reading). Lock- and allocation-free by construction. The httpd slot samples per
                REQUEST and stays null until someone browses — the right answer, not a gap
logic/          IDF-free, host-tested pure headers. THE LIST IS THE DIRECTORY — diff any inventory
                against `ls main/logic/` rather than reading it (both drift directions have
                happened: ten headers unlisted, and one listed that never existed). Highlights an
                agent must know exist before re-inventing them: availability.hpp (per-row
                adjudications: ZeroMeansAbsent, ZeroAbsentAboveSaturation, AboveRangeIsAbsent,
                PAGE_ABSENCE_RULES — adding a rule carries the domain-ledger evidence bar),
                conv_override.hpp + label_override.hpp (converter/label adjudications with
                raw-count pins that force deletion when the generator catches up), lwt_select /
                ou_stale / cop_scope / feature_gate (browser-rule gates with no firmware caller;
                presenter parity diffs the JS copies — keep both sides addressable as named
                functions), history.hpp (trend addressing by (reg, offset, unit), NEVER by label;
                the ring budget static_assert lives there), history_persist.hpp /
                checkup_persist.hpp (when persisted state may be believed: reset-reason ALLOW
                list, catalog fingerprints, live-sample-wins splice), homehub_map.hpp (the
                ENTIRETY of X10A<->HomeHub sharing: same quantity, same point, or nothing — keyed
                on trend ids, never labels), redact.hpp (the ONE redaction rule set; /status by
                field, /diag by line, fails closed, unset fields stay EMPTY), json.hpp (the ONE
                RFC 8259 encoder — escapes every control byte; SSIDs are hostile input),
                http_surface.hpp (trust boundary keyed on the setup AP), config_store.hpp (the
                atomic blob), mqtt_base.hpp (base topic = installation identity; a base that
                slugifies to nothing is refused), detect.hpp (tie-break = lowest profile id, #230
                B — file order must never decide published identifiers), ws_policy/ws_tx_gate are
                DELETED with the /events push (do not reintroduce a push without answering #238 +
                #241)
def/            embedded per-model value profiles + registry + signatures — MACHINE-GENERATED by
                an out-of-repo generator; NEVER hand-edit a generated table (regenerate + verify
                against docs/REGISTERS.md §5). ONE hand-written supplement exists and is
                TEMPORARY: overlay.hpp (page-0x10 protection words) — profile_view.hpp's overlay
                rule (a block applies only if the base already references its page) is what keeps
                it from moving detection. When deleting it, the 11 labels must come back
                BYTE-IDENTICAL (VictoriaMetrics series are keyed on them; test_logic.cpp pins all
                11 + the frozen identifier set of #217 — regenerating that list is a DECISION for
                the commit message, not a fix)
www/            web UI sources -> ONE gzipped page. WRITE THE COMMENTS: sources are documentation;
                the minifier strips HTML, CSS and JS comments under the 153600-byte delivery
                budget (UI_GZIP_MAX_BYTES, build-breaking, pinned by
                test_ui_delivery_contract.mjs). The schematic SVG has its own audit + the
                /schematic-review skill; any change here also ages the README's RECORDING
                (docs/media/dashboard.gif -> /ui-gif skill)
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `cfg` — the **atomic credential/service blob** (`logic/config_store.hpp`): WiFi credentials and rollback state; MQTT (broker, credentials AND this installation's base topic, v16); syslog and SNTP; board-local hardware; OTA channel/language; HomeHub; the MQTT reference-room mapping/freshness/readiness fields; optional Open-Meteo location; ENV III; the v15 external circulation-power witness (name/topic/paths/max_age/on+off thresholds/confirm window — the independent evidence the `dhw_loss` checkup correlates against); and board-preset identity. The v9 actuation bit and v14 dynamic-LWT mode byte are layout-compatible retired bytes: both serialize as zero and are ignored on read. Heating-curve diagnosis derives arming from the timestamped MQTT room mapping only; forecast is optional and has its own location-consent boundary. Blob versions v1–v16 remain exact-length/CRC checked, so a truncated newer blob is never accepted as an older one. Non-empty `mb_host` enables read-only polling; no setting enables writing. Legacy per-key credentials remain read-only fallback; `boot_fails` is the boot-loop crash counter, and `heap_rst` the heap watchdog's consecutive-restart breadcrumb (i32, cleared on any ordinary boot, capped so a restart LOOP is bounded). |

**Flash partitions beyond NVS.** The official 8 MB table keeps every deployed address through
`ota_1` unchanged, then assigns the whole upper 4 MiB to `history` at 0x400000. Its circular journal
uses 256-byte slots today (31/12/3 dense int16 values per X10A/HomeHub/ENV III record), sixteen per
4 KiB erase sector. A completed source bucket appends once; a final CRC-protected commit word is
written last. A non-erased torn mid-sector slot skips to the next sector instead of erasing valid
predecessors. Slot size grows by powers of two with the catalog and the build asserts at least 72 h
with all three sources active; unused depth is wear reserve, not eagerly erased retention. The
former 8 KB partition at 0x1e000 is removed and its gap stays unused. Because `esp_https_ota` never
writes the partition table, an old-layout board needs one USB/Web-Serial re-flash. Deliberately NOT
in `nvs` (24 KB shared with credentials must not take this traffic); keep NVS/OTA offsets stable.

**The link is persisted; the model is not.** RX/TX pins + protocol are the physical, boot-invariant
X10A link — cached in NVS, tried FIRST by detection (defaults as fallback, so a stale cache
self-heals). The **model** (`profile` + fingerprint `fp_*`) is re-detected every boot: RAM only
(`config_set_model`), so a swapped unit is re-identified. `poll_detect` calls `config_save_link`
(persist) only when pins/proto change.

**Writers commit only the fields they own.** Two tasks write the config — httpd (`/set_*`) and poll
(detection). Detection snapshots, then probes for a whole sweep, so it must never write back a
whole struct: that would revert a `/set_wifi` that landed mid-sweep, *after* the user got
`{"ok":true}`. It uses the narrow setters (`config_save_link`, `config_set_model`), which patch the
live config under the mutex (`apply_link`/`apply_model`, host-tested). Whole-struct `config_save`
stays for the HTTP handlers (they own the credentials and are serialized on the one httpd task).
The rule is deliberately asymmetric — it closes poll→httpd; the httpd→poll direction self-corrects
on the next detect.

**`config_save` can fail — every caller checks it.** The blob write is atomic: on error the
previous blob is intact, `config_save` returns `false` and publishes nothing to RAM. The `/set_*`
handlers answer `500 {"ok":false,"error":"config write failed"}` and skip the reboot; the WiFi
rollback-restore falls through to the setup portal rather than looping; a link-cache hiccup is
logged but does not fail an already-committed service blob (`/set_hp`, which owns the link,
requires those keys). `config_save` logs the failing key + `esp_err_t` to `/diag` + syslog.

`nvs` at `0x9000` is untouched by OTA (partitions.csv) so config survives upgrades.

## HTTP API

Compact contract. The FULL field-by-field payload reference — every `/status` block, every
refusal code, every consent boundary — is [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) →
"HTTP API reference". No HTTP auth / TLS by design — trusted LAN only (`docs/SECURITY.md`); the
open setup AP gets only the provisioning routes (`logic/http_surface.hpp`).

```
GET  /            embedded web UI (setup.html in AP mode)
GET  /status      the one status snapshot (wifi/net/mqtt/hp/modbus/env3/weather/heating_curve/
                  sys/health/history/detect/board/last_crash/…). ?redact=1 = the bug-report form:
                  every reporter-identifying value reads "<redacted>" — read the set off
                  logic/redact.hpp, not off any list; unset fields stay EMPTY (a substituted
                  empty value manufactures a source the device does not have), keys are always
                  emitted (an omitted field is indistinguishable from an older build)
GET  /values      decoded readings [{label,value,unit,reg}] + "binary"/"held" (emitted only when
                  true) + dwell_s/dwell_min/dwell_blind_s on switched rows (absence is a
                  first-class answer — a zero would say "changed just now") + `concept` where
                  homehub_map pairs a row. HomeHub rows ride a SECOND array `modbus`, emitted
                  ONLY while the link is live at snapshot time — absent key and empty array are
                  different claims. The browser matches on `concept`/`reg` structurally, NEVER on
                  labels
GET  /history?row=<trend id>[&source=x10a|modbus|env3]   one source's 24-h series; v[] in TENTHS;
                  held[] marks resting-unit nulls; t0 OMITTED when the clock never synced (an age,
                  not a fabricated time); unknown id = 404, never a default
GET  /models      catalog metadata; read by NO shipped client
GET  /diag[?verbose][?clear=1][?redact=1]   in-RAM diag ring; redacted form is CHUNKED (a
                  replacement can GROW past the static buffer)
GET  /scan        trusted-LAN-only WiFi scan; read by no shipped client
GET  /coredump[?clear=1]   stream the current-firmware dump (404 for none/foreign); decode with
                  scripts/decode-coredump.sh against the matching .elf
POST /crash/dismiss   erase dump + mark dismissed (device-wide, erase-first). POST because it
                  destroys the one artifact a bug report needs
POST /set_wifi    validate -> persist + reboot; old creds stashed as one-shot rollback backup
POST /set_mqtt    synchronous broker pre-flight (the ONE request-path network block, ~8 s) -> on
                  success persist + reboot. Empty user+pass = KEEP stored creds (the modal never
                  prefills); clear_creds:true is the explicit clear. `base` = the installation's
                  base topic; ABSENT means KEEP, never "reset to default". Unchanged settings
                  short-circuit {ok:true,reboot:false} (as do /set_syslog and /set_ntp)
POST /set_syslog  validate port -> persist + reboot; empty host disables; no network probe
POST /set_ntp     persist + reboot; empty = reset to compile-time default (SNTP has no off state)
POST /test_ref_temp   subscribe the CANDIDATE room mapping on the existing client, decode through
                  the LIVE path, return a single-use test_proof (RAM-only; bound to all seven
                  behavioural fields). Writes NOTHING; empty topic is 400
POST /set_ref_temp    non-empty mapping REQUIRES a valid test_proof (409 otherwise) — the one
                  route demanding evidence, because a typo'd mapping fails silently into a
                  plausible room error. Save applies live; empty topic = disable, needs no proof
                  (removal must never depend on the thing being removed still working). The SAVE
                  is the consent to subscribe; deleting unsubscribes + clears captured state
POST /test_circulation / POST /set_circulation   same probe/proof shape for the external
                  circulation power witness (#361); unchanged mapping short-circuits
POST /set_weather {latitude,longitude} strings, strictly parsed; BOTH empty = disabled, exactly
                  one empty = 400. Saving IS the consent to fetch; clearing requests the retained
                  topic's cleanup. No network work on the request path
POST /set_env3    compatibility shim since #339 — the UI posts env3_* through /set_board; both
                  run the ONE env3_save_preflight (hardware-proven, graded 422/503/409)
POST /set_hp      {profile,rx,tx,mb_host,mb_port,mb_unit_id} — every key optional, omitted keeps.
                  rx/tx persist; profile is session-only ("auto" = re-detect); proto is NOT
                  accepted. mb_host non-empty = the whole HomeHub intent, applied live
                  (mb_reconfigure); length-bounded (an over-long string used to poison the whole
                  blob on next boot). actuation_enabled is NOT accepted
POST /discover_homehub   explicit bounded mDNS browse -> {host}; writes nothing; 404 on miss
POST /set_board   ONE atomic form: board preset + LED/button + ENV III. Values decide the REBOOT;
                  the submit itself is the user STATING the hardware (user_set), so an identical
                  pick is still a save ({ok,reboot:false,saved:true}). Validation via
                  board_hw_valid over the LOCAL-I/O set, collision rules in BOTH directions
POST /set_ota     {channel} validated, applied LIVE (unknown name REJECTED, not defaulted)
POST /set_lang    {lang auto|de|en} validated, applied LIVE (same rejection rule)
POST /detect      reset profile to "auto" + invalidate fingerprint (RAM only) -> next cycle sweeps
GET  /ota/check   async manifest check
POST /ota/update[?downgrade=1]   re-fetches manifest and RE-RUNS the downgrade gate itself (the
                  route is reachable on its own); ?downgrade=1 relaxes order only, per-request
GET  /ota/status  UI polls this; `downgrade` and `update_available` are BOTH needed
GET/POST /mcp     read-only MCP (mirrors /status + /values); GET = embedded static page
(no /events)      There is NO live-push route. The UI polls /values (2 s) + /status (8 s), one
                  chain, 30 s backoff, suspended while hidden. Do not reintroduce a push without
                  answering #238 (silent global death) and #241 (builder on the UART task)
```

Every `/set_*` route: a failed route-owned NVS write answers
`500 {"ok":false,"error":"config write failed"}` and does not reboot/apply. Refusals carry a
machine `code` beside the one English `error` wherever the bilingual UI must translate.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest *contiguous* free
block). Keep HTTP handlers under a try/catch that returns 503 on OOM (an uncaught throw unwinds
through C frames → `std::terminate` → reboot). Stream `/diag` and the MQTT discovery instead of
one big `std::string`. Treat any new large contiguous allocation as a crash risk. A reboot loop
also stops the poll cycle and drops MQTT availability.

**The STACK is a second, separate budget — and it fails silently.** Three overflows shipped
(v1.0.12 httpd, #241 hp_poll, #318 httpd through OTA), each invisible on an idle board at every
stack size; the full post-mortems and the 2026-08-07 re-measurement are in
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) → "Memory constraints". The rules they bought:

- **Build long JSON with successive `+=`, never one `a + b + c + …` chain.** A chain materialises
  every intermediate `std::string` at once in one frame; `+=` holds one at a time.
  http_status.cpp's board/presets blocks are the worked example.
- **A builder shared by two tasks is only as safe as its smallest stack** — check every runner,
  not the one that crashed. And **measure the worst PATH, not the biggest FRAME**: the httpd
  ceiling is `mcp_post` → `http_append_status_json`, not the `/status` route itself.
- **Anything that grows /status grows every stack that builds it** — a change that hands a task a
  large new builder raises that task's stack in the same commit.
- **Read the task table in any core dump you open** (USED/FREE per task) — the only place the
  exact figure is visible. Anything under ~1 KB free wants raising. The trend no longer waits for
  a crash: `main/stack_watch.hpp` publishes the four watched high-water marks on the heartbeat.
- A stack budget is read off the ELF, never off an idle heap reading:

```bash
scripts/idf-docker.sh bash -c 'A=$(xtensa-esp32s3-elf-nm build/daikin-altherma-esp32.elf | grep " T _ZN4daik23http_append_status_json" | cut -d" " -f1); xtensa-esp32s3-elf-objdump -d --start-address=0x$A --stop-address=$((0x$A+8)) build/daikin-altherma-esp32.elf | grep entry'
```

- **`http_status.cpp` compiles at `-Os` on purpose** (`main/CMakeLists.txt`,
  per-source-file — never a global `CONFIG_COMPILER_*` key): at the project default `-Og` the
  builder's frame is ~3x larger purely from un-coalesced string-temporary slots (measured
  11776 → 3744 bytes; deepest path 14512 → 6480 of the 16384 httpd stack). If that line is ever
  reverted, `cfg.stack_size` must go to 20480 in the same commit.
- `CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y` makes the first write past a limit panic at the
  offending instruction (the default canary is only checked at a context switch).

**Every allocating FreeRTOS task loop must self-guard.** A task is a C frame boundary like a
handler: wrap the loop *body* in `try/catch (const std::exception&)` + `catch (...)`,
`diag_printf` once, skip the cycle keeping the last good state, continue after the normal delay —
see `mqtt_task`, `poll_task`, `syslog_task`, `status_led_task`, `weather_task`.

**Never allocate while holding a mutex.** The guard above makes an OOM survivable only if the
throw doesn't strand a lock: a raw `xSemaphoreTake` is *not* released by unwinding, so every
reader then blocks `portMAX_DELAY` and the device wedges — worse than the crash the guard
prevents. Either keep the critical section non-allocating (stage in locals, `swap`/move in —
`poll_once`'s commit) or take the lock through the RAII `Lock` (`main/rtos_guard.hpp`). The
syslog/mqtt status mutexes store error text as string-LITERAL pointers so the writer cannot
allocate at all — load-bearing for mqtt_ha's, which runs on esp-mqtt's own unguarded event task.
`diag_log.cpp` deliberately keeps its bare takes (pure `memcpy` sections).

## Typical debugging

```bash
scripts/run-mock-tests.sh --coverage                   # host logic tests + 95% coverage floor
tools/coverage/selftest.sh                             # prove the floor fails closed
scripts/run-domain-audit.sh                            # are the catalog's values physically right?
scripts/run-schematic-audit.sh                         # does the dashboard drawing still say what it means?
scripts/run-ui-use-case-tests.sh                       # do all visible UI actions actually work?
scripts/run-contract-tests.sh                          # do the firmware's source boundaries hold?
screen /dev/cu.usbmodemXXXX 115200                     # serial monitor (native USB on s3)
curl http://daikin-altherma-esp32.local/status | jq          # device status (incl. last_crash)
curl http://daikin-altherma-esp32.local/values | jq          # decoded values
curl http://daikin-altherma-esp32.local/coredump -o coredump.bin   # pull a crash dump (if any)
scripts/decode-coredump.sh coredump.bin                # symbolize it against the matching .elf
esptool --chip esp32s3 -p <port> erase_flash           # wipe NVS (reset config)
```
