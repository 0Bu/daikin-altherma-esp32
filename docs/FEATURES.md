# Technical features & ESP-IDF building blocks

A cross-cutting catalog of **what this firmware does at the platform level** — the ESP-IDF
subsystems it puts to work, the security and update mechanisms it layers on top, and the
engineering choices that distinguish it from a stock "read a sensor, publish MQTT" sketch.

This document is an **index**, not a re-derivation. Each feature is stated with a code pointer and
an honest status, then links to the deep-dive doc that explains the *why* and the *wire detail*:

| Deep dive | Covers |
|-----------|--------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | component map, poll engine, detection, WiFi, MQTT, OTA/partitions, memory |
| [`SECURITY.md`](SECURITY.md) | trust boundary, credential storage, OTA signing, boot recovery, key lifecycle |
| [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) | the heat-pump wire protocol (framing, CRC, register pages, detection) |
| [`REGISTERS.md`](REGISTERS.md) | converter reference + full register/value map |
| [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md) | HA topics, discovery, derived power/COP/SCOP |
| [`DESIGN.md`](DESIGN.md) | web-UI design contract |
| [`MCP.md`](MCP.md) | stateless, read-only Streamable-HTTP MCP server |

> **Status legend** — ✅ implemented & shipping · 🧪 implemented, host-tested pure logic ·
> 🟡 partially implemented (a working core with a documented TODO) · 🔭 planned / stubbed route.
> Every ✅/🧪 claim below points at the source that backs it; keep this file honest (see
> [the `feature-docs` skill](../.claude/skills/feature-docs/SKILL.md)).

---

## Feature matrix (the short version)

| # | Feature | Status | Anchored in |
|---|---------|:------:|-------------|
| 1 | Secure Boot v2 **signed images without hardware Secure Boot** (RSA-3072) | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 2 | Refuse-to-flash-unsigned guard | ✅ | [`require-signed.sh`](../scripts/require-signed.sh) |
| 3 | Dual-OTA layout + **NVS-preserving OTA and no-Erase Web Serial updates** | ✅ 🧪 | [`partitions.csv`](../partitions.csv), [`ci-build-all.sh`](../scripts/ci-build-all.sh), [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py), [`test_web_installer_plan.py`](../test/test_web_installer_plan.py) |
| 4 | OTA rollback + **connectivity-proving health gate** | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/health_gate.hpp`](../main/logic/health_gate.hpp) |
| 5 | OTA manifest check + signed download + **two-point downgrade gate** | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/version_cmp.hpp`](../main/logic/version_cmp.hpp), [`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp) |
| 6 | Live UI by **polling** `/status` + `/values` — no push transport, on purpose (#238/#241) | ✅ | [`www/app.sources`](../main/www/app.sources), [`http_status.cpp`](../main/http_status.cpp) |
| 7 | Gzipped web UI **embedded in the app image**, assembled at build time | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt) |
| 8 | HTTP handlers under an **OOM `try/catch` → 503** discipline | ✅ | [`http_common.cpp`](../main/http_common.cpp), [`http_status.cpp`](../main/http_status.cpp) |
| 9 | Home Assistant MQTT auto-discovery, grouped state, LWT | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/discovery.hpp`](../main/logic/discovery.hpp) |
| 10 | **MQTTS + CA-bundle** TLS; credentials never sent in cleartext | ✅ | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 11 | Core-dump-to-flash + summary capture + offline symbolication, with an **orphan dump** (foreign `app_elf_sha256`) erased at boot so `coredump` never offers an undecodable download | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp), [`decode-coredump.sh`](../scripts/decode-coredump.sh) |
| 12 | Reset-reason + crash classification, retained to MQTT | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 13 | 18-entity device **heartbeat** diagnostics stream (heap trend + reset reason + WiFi MAC/BSSID + outdoor-page source freshness incl.; two retired entities are actively retracted) | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp) |
| 14 | Strongest-AP scan + SAE tuning + **endless reconnect** | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 15 | **ICMP gateway watchdog** (ghost-association recovery) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 16 | Captive-portal provisioning (AP-only SoftAP, typed SSID, UDP:53 DNS catch-all, 302 probe redirect + RFC 8910 option 114) | ✅ 🧪 | [`provisioning.cpp`](../main/provisioning.cpp), [`captive_dns.cpp`](../main/captive_dns.cpp), [`logic/captive.hpp`](../main/logic/captive.hpp) |
| 17 | mDNS + DHCP hostname (option 12) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 18 | **In-app WiFi re-config + reason-aware one-shot credential rollback** | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`http_config.cpp`](../main/http_config.cpp), [`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp) |
| 19 | X10A auto-detection (protocol sweep → fingerprint → model, **I/U-capacity fallback** when the O/U 0x00 descriptor omits its capacity byte — it both ranks the representative and **narrows the candidate set**, dropping only classes that contradict it, **retried page probe + a second-sweep confirmation** before falling back to `generic`, and an **order-independent** representative pick so a reordered registry cannot move a published entity id or series) | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`logic/detect.hpp`](../main/logic/detect.hpp) |
| 20 | **IDF-free host-tested logic core** (2204 checks, re-derived — see §8) | 🧪 | [`main/logic/`](../main/logic), [`test/test_logic.cpp`](../test/test_logic.cpp) |
| 21 | CI pinned to the exact ESP-IDF the local Docker build uses | ✅ | [`idf-docker.sh`](../scripts/idf-docker.sh), [`build.yml`](../.github/workflows/build.yml) |
| 22 | Traceable build identity (`app_elf_sha256`) matches a dump→its ELF | ✅ | [`http_status.cpp`](../main/http_status.cpp), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 23 | Firmware-footprint trims (~15 KB of unused IDF code paths) | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 24 | Status indicator — **runtime-selectable GPIO-LED / WS2812 back-end**, one image per board family | ✅ 🧪 | [`status_led.cpp`](../main/status_led.cpp), [`logic/led_pattern.hpp`](../main/logic/led_pattern.hpp) |
| 25 | **Read-only MCP server + self-documenting setup page** — stateless Streamable HTTP with host-tested JSON-RPC parsing/version negotiation, exactly `get_status` + `get_hp_values`, no SSE/session/control path, and an embedded dependency-free static GET information page | ✅ 🧪 | [`mcp_server.cpp`](../main/mcp_server.cpp), [`logic/mcp.hpp`](../main/logic/mcp.hpp), [`mcp_dashboard.html`](../main/www/mcp_dashboard.html), [`MCP.md`](MCP.md) |
| 26 | **MQTT broker save-time pre-flight** (DNS/TCP/connect+auth, heap-guarded) before persist | ✅ | [`http_config.cpp`](../main/http_config.cpp) |
| 27 | **Task Watchdog** → clean reboot on a wedged poll/publish task | ✅ | [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 28 | **`/status.sys`** always-on heap headroom + last-boot reason (LAN/WS, no broker) | ✅ 🧪 | [`http_status.cpp`](../main/http_status.cpp), [`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp) |
| 29 | **Boot-loop safe mode** — recover a bad config in-browser (crash-only counting, distinct from OTA rollback) | ✅ 🧪 | [`safe_mode.cpp`](../main/safe_mode.cpp), [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp) |
| 30 | **Config-write integrity** — the credential/service config is one **atomic CRC-checked NVS blob** (all-or-nothing across a write failure AND a power cut); field-owned commits (the poll task never reverts an HTTP credential write; the reverse — an HTTP save clobbering a self-healing link commit — is left open by design, detection re-runs it), reserved-GPIO rejection on both the request and the load path, + an NVS failure that reaches the user (500, no reboot) instead of "saved" | ✅ 🧪 | [`config.cpp`](../main/config.cpp), [`logic/config_store.hpp`](../main/logic/config_store.hpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp), [`logic/board_pins.hpp`](../main/logic/board_pins.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 31 | **Value-catalog domain audit** — real converters × real catalog vs the spec, each finding carrying a decode witness; co-gates CI, plus a selftest that re-catches the four decode bugs that shipped | ✅ | [`catalog_audit.cpp`](../tools/domain/catalog_audit.cpp), [`run-domain-audit.sh`](../scripts/run-domain-audit.sh), [`selftest.sh`](../tools/domain/selftest.sh) |
| 32 | **SNTP wall clock**, runtime-configurable server — real UTC for the syslog TIMESTAMP field + `/status.ntp` | ✅ 🧪 | [`sntp_time.cpp`](../main/sntp_time.cpp), [`logic/timestamp.hpp`](../main/logic/timestamp.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 33 | **Detect-sweep heap hardening** — install-once UART + register-only pin remap (no per-swap driver realloc) and silent-bus detect backoff, closing a fragmentation panic caught by a symbolized coredump | ✅ 🧪 | [`hp_comm.cpp`](../main/hp_comm.cpp), [`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp) |
| 34 | **HTTP trust-surface split** — the open setup AP registers only the provisioning routes; `/coredump`, `/diag` and the config/OTA/MCP surface exist only on the trusted STA LAN | ✅ 🧪 | [`http_server.cpp`](../main/http_server.cpp), [`logic/http_surface.hpp`](../main/logic/http_surface.hpp), [`http_common.cpp`](../main/http_common.cpp) |
| 35 | **Publish-time value-plausibility filter** — a decoded °C reading outside a physical envelope, a saturation temp from a 0-bar sensor, or a **refrigerant pressure at ≤ 0 bar** (absolute; a sealed circuit is never at vacuum) is dropped at publish (HA gets *unavailable*, never a false 576 °C / −51.2 °C / 0.0 bar); the runtime backstop to the build-time catalog audit (#31), kept out of `convert()` so the audit still distinguishes the intrinsic converters. Refrigerant vs. water is decided **structurally** — outdoor page, or a conv-405 saturation twin — never by label, and a catalog-wide test pins that no water-pressure row is ever caught (a drained system's real 0 bar must still publish) | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`hp_convert.cpp`](../main/hp_convert.cpp) |
| 36 | **Raw page dump on `/diag`** — the wire bytes of pages `0x00`/`0x10`/`0x20`/`0xA0`/`0xA1`, one line per detect pass. Everything else the device exposes is *decoded*, so an impossible reading cannot be attributed to a wrong converter vs. a wrong offset vs. a per-unit layout difference without these bytes — and they otherwise never leave the board. `0x10`/`0x20` cover impossible readings that fall *inside* the plausibility window and are therefore never masked. **Plus a run-time capture** ([#194](https://github.com/0Bu/daikin-altherma-esp32/issues/194), [#209](https://github.com/0Bu/daikin-altherma-esp32/issues/209)): "one line per detect pass" used to be the catch — a detect pass never coincides with a compressor run, so a row that is only wrong *while the unit runs* (`Target Evap. Temp.`) could not be caught in the act and its diagnosis had to back-derive the bytes from the rounded published value. The poll path now dumps `0x10`/`0x20` on the stopped→running edge and every 5 min during a run, at most 8 times per boot and never refilled — a *series* rather than a point, because two candidate scales that both fit one sample may not fit a curve, and bounded so it cannot evict the rest of the boot's evidence from the 6 KB diag ring | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`logic/hexdump.hpp`](../main/logic/hexdump.hpp), [`logic/raw_capture.hpp`](../main/logic/raw_capture.hpp) |
| 37 | **Physical recovery button** — a 5 s hold erases the whole stored config and reboots into the setup portal: the only config reset that needs no network access to the device. Armed/erasing are signalled on the status indicator, and the destructive path (arm checkpoint, debounced abort) is host-tested | ✅ 🧪 | [`recovery_button.cpp`](../main/recovery_button.cpp), [`logic/button.hpp`](../main/logic/button.hpp), [`nvs_storage.cpp`](../main/nvs_storage.cpp) |
| 38 | **Board-hardware runtime config** (`POST /set_board`) — indicator pin/driver/polarity + button pin live in NVS, not Kconfig, so one published image serves boards with different onboard parts; per-board **presets** (`/status.board.presets`) fill all five fields from one pick and are host-tested against the request path's own validator, and the indicator **announces its resolved pin/driver on `/diag`** at boot — a valid-but-wrong pin initialises fine and drives nothing, which otherwise looks exactly like a working LED | ✅ 🧪 | [`http_config.cpp`](../main/http_config.cpp), [`logic/config_model.hpp`](../main/logic/config_model.hpp), [`logic/board_pins.hpp`](../main/logic/board_pins.hpp), [`logic/board_presets.hpp`](../main/logic/board_presets.hpp), [`status_led.cpp`](../main/status_led.cpp) |
| 39 | **Stack-overflow watchpoint** — a hardware watchpoint on every task's stack limit, so the *first* write past it panics at the offending instruction instead of corrupting a neighbour silently. IDF's default canary is only compared at a context switch and a sparsely-writing frame can step over it — which is how a v1.0.12 `httpd` overflow overwrote its own TCB and died 44 s later in unrelated lwip code. Shipped with the `httpd` **and** `hp_poll` stacks raised to 12 KB (both run the `/status` builder — raising only the one that crashed left the other to be re-discovered, #241) and the `/status` and `/values` JSON built by `+=` rather than long `+` chains | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`http_server.cpp`](../main/http_server.cpp), [`http_status.cpp`](../main/http_status.cpp) |
| 40 | **Cost-shaped CI** — Actions bills per job rounded up to the whole minute, so every fast gate is a *step* of one job rather than a job of its own, the firmware build is *skipped* (not failed) when nothing the image or the site is made of changed, ccache is carried across runs (keyed on the toolchain + build config, not on the workflow file, so editing the workflow does not discard it), the per-PR preview installer is retired in favour of the dev channel, and every job has a timeout | ✅ | [`build.yml`](../.github/workflows/build.yml), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 41 | **Protection-retry telemetry** — the outdoor unit's page-`0x10` protection words (5 retry counters + 6 drop-control flags) reach MQTT/Home Assistant as 11 entities. The signal a unit is quietly backing off to protect itself while still meeting demand — degradation with no temperature tell. Converter 310 shipped earlier with no catalog row to decode; the rows now come from a **temporary** hand-written supplement applied only to a page the detected model already reads, so it cannot move model detection or add a bus round-trip, and they are cross-checked against [`REGISTERS.md`](REGISTERS.md) §5 by the domain audit like generated rows | ✅ 🧪 | [`def/overlay.hpp`](../main/def/overlay.hpp), [`logic/profile_view.hpp`](../main/logic/profile_view.hpp), [`logic/convert.hpp`](../main/logic/convert.hpp) |
| 42 | **24-hour trend rings** — a fixed-cadence (5 min × 288) `int16` ring per trended row, **static** rather than on the heap (the binding limit here is the largest *contiguous* block, and a static array does not compete for it: 576 B each, **18 trends = 10368 B** of ring plus ~78 B of label/unit apiece, under an 11520 B ceiling assert). Measured with `idf.py size` across the change that raised it, the cost is **+4576 B** — and it lands in `.data`, not `.bss`, because `Trend::pending` initialises to a non-zero sentinel, so each ring also costs its own size again in the flash image. Served by chunked `GET /history` and drawn as a sparkline in the value row's explainer **and** in the schematic inspector, for the row the tapped pill actually resolves to. Two absences are **distinguished**, because conflating them misattributes one to the other: a register that did not answer vs. the outdoor unit **resting** — pages `0x20`/`0x21` keep answering with the last run's numbers, so an ungated ring fills a mild day's outdoor-air trend with a staircase that reads exactly like weather. WHICH rows get one is a rule rather than a taste: every numeric value the dashboard **schematic** draws, because those are the readings someone is actually looking at — which is also what keeps the budget small (the drawing holds ~16 numeric pills; the ~66 numeric rows a profile publishes would be ~38 KB). The four **computed** pills (ΔT, heat output, electrical input, COP) have no register to buffer, so `www/js/history.js`'s `DERIVED` assembles their curve out of the rings of what they are computed from — `inv_current` and `ct_l1..3` are in `TRENDS` for exactly that — using the same expressions the live figure uses, so there is one definition per figure rather than a firmware copy and a browser copy free to drift. Two of the eighteen are not catalog rows at all — the board's own **free heap** and **largest contiguous block**, in KiB, sampled by the same recorder and drawn on the Settings ESP32 card: a single heap number is a diagnosis nobody can make, while a day of it shows a leak as a slope and fragmentation as the two lines separating. Adding a trend is one row in `TRENDS`, which addresses a catalog row by **(register page, byte offset, unit)** and never by its label: the catalog spells leaving water four ways (one with a double space), calls the suction pressure just `"Pressure"` on 13 profiles — a name page `0xA0` reuses for another quantity — and puts a bar reading and its saturation-°C twin at the *same* `0x20/12`, so a token match would draw °C into a chart whose axis says bar. A catalog guard pins that each trend resolves to **exactly one** row, of one `type` code and one width (which is what makes the tenths exact), on every profile that carries it | ✅ 🧪 | [`logic/history.hpp`](../main/logic/history.hpp), [`history.cpp`](../main/history.cpp), [`http_status.cpp`](../main/http_status.cpp), [`www/js/history.js`](../main/www/js/history.js) |
| 43 | **Value-description coverage gate** — every catalog label the web UI can show must have a plain-language explainer, asserted in CI. Which rows are tappable is decided by a pattern sweep at render time, so a label nothing matches is a silently plain row: no error, no log, just an absent chevron — how `def/overlay.hpp`'s 11 protection rows shipped unexplained (2 of them matching the *wrong* entry, a protection flag read as a heat-sink temperature). The profiles are machine-generated, so the gap re-opens without touching the UI. The real table is **evaluated in a JS engine** rather than re-implemented, and row extraction is cross-checked per file so a changed catalog format fails loudly instead of reporting full coverage of nothing. Gates coverage, not correctness — a wrong explainer is still a match | ✅ | [`check_descriptions.mjs`](../tools/descriptions/check_descriptions.mjs), [`run-description-audit.sh`](../scripts/run-description-audit.sh), [`selftest.sh`](../tools/descriptions/selftest.sh), [`www/js/descriptions.js`](../main/www/js/descriptions.js) |
| 44 | **Digest-pinned CI supply chain** — every third-party GitHub Action this repo runs is pinned to a full commit SHA, not a tag. A tag is a *movable pointer*: whoever owns the action can repoint `v4` at new code, and every workflow that names the tag runs it on the next push, with the OTA signing key in scope. The readable version rides along as a trailing `# vN` comment, and Renovate is configured to keep the pin *and* bump the digest, so pinning does not decay into pinned-and-forgotten | ✅ | [`build.yml`](../.github/workflows/build.yml), [`renovate.yaml`](../.github/workflows/renovate.yaml), [`renovate.json`](../.github/renovate.json) |
| 45 | **Dashboard-schematic audit** — the drawing itself is gated, because the two audits above can both be clean while the picture is false: a pill can carry a physically correct value, have copy for it, and still be drawn on the wrong pipe. This one shipped a rotor spinning around a point beside its own axle (the CSS pivots on the *bounding box*), the leaving-water pill floating 40 px off the run it names, the return temperature on the heating-only section, and "HEIZUNG" struck through by a riser so it rendered "HEIZUNC" — the #35–#39 shape drawn in SVG. It **parses the real SVG** (coordinates, transforms, path geometry, text metrics) and **evaluates the real binding tables**, so there is no second copy of either to drift, and reports in three layers: structure (hit target ↔ inspector entry ↔ id ↔ translation), geometry (viewBox, overlaps, struck-through labels, axis-aligned runs, a pill's tie to its own pipe, rotor symmetry, and a run's **invisible** tap area not reaching into the fitting it meets — the hit lines are `stroke-linecap: round` and so cover half a stroke past each declared endpoint, while every trim in the drawing had been computed as if the cap were flat: the 3-way valve outlined itself on hover and opened the DHW branch, and measured on the real engine it was answering only 78.9 % of the taps on its own disc) and domain — a repeated unit needs a name, and at a **branch junction** every claim stops: no reading, no flow overlay and no hit target may span it, and no pipe may sit in no hit target at all. The selftest re-seeds every historical defect into a throwaway copy (one `run_case` each, so `grep -c run_case` is the count — never restate it here). Gates placement and reachability, not truth — whether the drawing is still true of the plant is the [`schematic-review`](../.claude/skills/schematic-review/SKILL.md) skill's half, itself a PR-merge gate ([`require-schematic-review.sh`](../.claude/hooks/require-schematic-review.sh)) that fires conditionally, on a diff reaching the drawing, its contract or the tools that judge it — that hook's regex is the one definition of the set, never restated elsewhere | ✅ | [`check_schematic.mjs`](../tools/schematic/check_schematic.mjs), [`run-schematic-audit.sh`](../scripts/run-schematic-audit.sh), [`selftest.sh`](../tools/schematic/selftest.sh), [`www/index.html`](../main/www/index.html) |
| 46 | **On-device redaction of a diagnostic snapshot** (`GET /status?redact=1`, `GET /diag?redact=1`) — the eight reporter-identifying values read `<redacted>` and the log lines that interpolate a host/IP/SSID are scrubbed, so a bug report can be filed as a *public* issue carrying the device's own status, readings and log. In the firmware rather than in the browser, so the web UI's collector and the manual `curl` fallback cannot drift into two privacy rules. The **value** is replaced and the **key** kept — a dropped field is indistinguishable from an older build, and triage reads that as evidence. Substituted where each value is *written*, never as a pass over the finished JSON (the httpd stack budget v1.0.12 overflowed); `/diag` streams chunked, because a replacement is longer than most values it replaces | ✅ 🧪 | [`logic/redact.hpp`](../main/logic/redact.hpp), [`http_status.cpp`](../main/http_status.cpp), [`REPORTING.md`](REPORTING.md) |
| 47 | **Redaction-coverage gate** — the `/diag` half of #46 is an *allowlist* of named log statements, and an allowlist falls behind in silence: a new `diag_printf` interpolating a hostname is simply uncovered, and the only symptom is a correct-looking log line containing a real value. The one gate here whose subject is the **user's data** rather than the firmware's correctness. Flags any diag line whose *arguments* carry a config or board-identity value with no matching rule — a heuristic on identifier names, not a proof, so it catches the line someone adds while debugging and not a value laundered through an unrelated local first. Found on its first run: `mqtt: retired legacy HA device %s` printing the unique half of the MAC that `/status` was redacting three sections above it | ✅ | [`check_diag_coverage.py`](../tools/redact/check_diag_coverage.py), [`run-redaction-audit.sh`](../scripts/run-redaction-audit.sh), [`selftest.sh`](../tools/redact/selftest.sh) |
| 48 | **Device-assembled bug report** (web UI → Settings → the footer line → *Report a bug*) — the board collects its own `/status`, `/values`, `/ota/status` and `/diag`, redacted, into one pasteable report and opens the prefilled issue form. Unconditional, unlike the crash banner that used to hold the only copy affordance in the whole UI — so a wrong reading or an MQTT dropout, the two commonest reports, finally have a way in. A failed fetch is written *into* the report and an over-long `/diag` is truncated with the count said out loud, because a report that looks complete and is not is the failure the whole flow exists to prevent | ✅ | [`www/js/app_state.js`](../main/www/js/app_state.js), [`bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml), [`REPORTING.md`](REPORTING.md) |
| 49 | **Typed telemetry contract** — a published field's JSON type comes from its *converter*, not from sniffing the value currently in it, so one MQTT key can never change type between states. Measured before it was enforced ([#209](https://github.com/0Bu/daikin-altherma-esp32/issues/209)): fan step published the number `30` while the fan ran and the string `"OFF"` when it stopped — both payloads well-formed, and downstream Telegraf's numeric parser dropped the string, VictoriaMetrics never received a zero, and the last running step stayed on the chart as though the fan were still turning. A catalog-wide test walks **every implemented converter over every input byte** and fails if any one produces text in one state and a number in another; a `Number` handed a non-numeric string publishes `null` rather than flipping to a quoted string | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 50 | **Per-row availability ledger** — is a decoded number a *measurement*, or merely something the firmware could decode? The wire format's own `0x8000` marker, the plausibility envelope (#35) and the generator's detect-only flag each answer a narrower question; what is left is a field that decodes to an entirely ordinary number which measures nothing. Two verdicts are live. `Target Cond. Temp.`'s raw `0x0000` is **absent, not 0 °C** (flat through a full compressor cycle while the inverter reached 32 rps and the discharge pipe passed 100 °C). And the **expansion valve** pulse rows (conv 151) refuse a value above a physical ceiling: 30 days of published samples run 0–474 pulses and then carry six of exactly `0xFFF8`, with nothing in between. "conv 151 should have been signed" is *refuted*, not merely unproven — a valve nudged past its zero would report a spread of small negatives reached from positions near 0, while every occurrence is the identical integer sitting between neighbouring samples of ~450, and no valve travels 450 → −8 → 450 in 30 s. Both readings (65528, −8) are impossible positions, so withholding is what they agree on and the documented `u16` decode stays untouched. It is a value test that still cannot live in the plausibility envelope, which is keyed on the dataType and so cannot reach a dataType `-1` row — the only other handle being the `(pls)` in the label. The `Unproven` verdict — withhold the row entirely, retract its retained config — is implemented with **no live entry**: it held `Target Evap. Temp.` while that row's scale was unknown, and #194 then showed the row was mis-*decoded* rather than unmeasurable, so the verdict moved to the converter adjudication (row 51). Keyed on `(page, offset, converter)` — never a label, never a profile-id list — and a catalog test proves the rule selects the adjudicated quantity across all 45 profiles. Deliberately per row: a global "0 °C is unavailable" rule would destroy every thermistor reading that crosses zero | ✅ 🧪 | [`logic/availability.hpp`](../main/logic/availability.hpp), [`hp_convert.cpp`](../main/hp_convert.cpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 51 | **Converter adjudication** — which converter a generated row is actually *encoded* with, when the id the offline generator emitted is demonstrably wrong. Sibling of the availability ledger and a stronger claim: that one withholds a value, this one asserts a **different** one, so the bar is structural evidence rather than a range that merely looks plausible. One entry: `Target Evap. Temp.` (`0x10/6`) conv `114` → `109`. With `×0.1` it published 145.9–199.6 °C mid-run; all **54** distinct wire integers ever observed satisfy `raw == floor(128 × T)` on an exact 0.1 K grid (p ≈ 1.6e-60 against any other scale), and `÷128` reads 10.4–15.6 °C running / 17.2–19.0 °C at rest. conv `109` already existed, so this is a wrong converter **id** on a right register (#35–#39's shape), not a wrong converter — `114` keeps its `×0.1` semantics and its three other rows, which are deliberately left alone for want of evidence. Applied where a row *enters* the pipeline so the decode, the cached id, the published JSON type and the HA component cannot disagree | ✅ 🧪 | [`logic/conv_override.hpp`](../main/logic/conv_override.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 52 | **Source freshness ≠ publish freshness** — the outdoor unit refreshes pages `0x20`/`0x21` only while it runs; stopped, it keeps answering with the last run's numbers. The web UI had applied that rule since v1.0.13, the firmware had not, so the MQTT state topic republished the last run's outdoor air in a freshly-timestamped payload every second — measured against a HomeHub reference, exact agreement at every point while the compressor ran and a mean 1.19 K (max 2.0 K) error across the 195 points while it rested, which no downstream "time since last message" check could ever see. The poll engine now marks each cached row with the shared compressor-witness rule; `/values` emits `"held":true`, the MQTT bridge withholds the row, and the heartbeat's `bus_ou_held_over` says why, so a resting unit does not read as a broken link. The value is *kept* in the cache, because the trend ring needs it to tell **held over** from **no reading** | ✅ 🧪 | [`logic/ou_stale.hpp`](../main/logic/ou_stale.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp) |
| 53 | **Numeric fault state beside the textual code** — converters 203/204 stay text (`"Normal"`, `"U4"`, `"7H"`), which is what a human and HA want and what Daikin's alphanumeric code space actually is. A metrics consumer can store neither: `"00"` may become a numeric `0` but `"U4"` is simply dropped, so the series sits at its last no-error value and an alert on `error_code != 0` never fires for the very faults it exists to catch. Every error-class row therefore publishes two permanently-numeric companions in its own group — `error_active` / `warning_active`, each its own `binary_sensor` — derived through the inverse of conv 203's own `ERR_TYPE` lookup rather than a second opinion about the labels. An unreadable class publishes **neither**: reporting `0/0` would assert "no fault" on a byte nobody could decode | ✅ 🧪 | [`logic/fault_state.hpp`](../main/logic/fault_state.hpp), [`logic/discovery.hpp`](../main/logic/discovery.hpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 54 | **README-recording check** (deliberately **not** a CI gate — its only remedy is a local re-record, which no runner can perform, and a gate whose fix is unavailable where it fires gets the stamp rewritten rather than the recording re-made; run on demand by the [`ui-gif`](../.claude/skills/ui-gif/SKILL.md) skill) — the animated dashboard in the README ([`dashboard.gif`](media/dashboard.gif)) is the first thing a new reader sees and the one artefact here that rots *invisibly*: a recording renders perfectly forever, whatever the UI has since become, so #43/#45 and the domain audit all stay green while the page shows a drawing that no longer exists. A screenshot cannot fail a test; it can only be out of date, and it looks exactly as good either way. CI has no browser, so this cannot re-render and diff pixels — it **fingerprints the sources the recording was made from** (the schematic markup, the CSS that draws and animates it, the assembled UI functions that paint it — each *required* to exist, or it exits 2 rather than fingerprint nothing — the strings it prints, the scenes, and the recorder's own framing) and fails when they no longer match the per-source hashes stamped beside the GIF, so a failure names what moved. The frame is the schematic card **alone**: the dashboard header above it was cropped out because it prints the running version, which a recording cannot keep current (nothing re-renders a GIF when `version.txt` moves), and its markup, CSS and `renderHeaderMeta` left the fingerprint with it — a source that cannot change a pixel must not be able to fail a stamp-based gate. It also parses the GIF itself: a single frame, or frames held over 200 ms, fails the one thing a recording is for. Deliberately narrower than all of `main/www` — a settings-modal edit cannot change a frame, and a gate that fires on changes it knows are irrelevant is one people learn to re-stamp without looking. **No exceptions ledger**, unlike #31/#43/#45: their findings are questions about intent, this one has a single answer — re-record. Gates currency, not quality; whether the four scenes still show honestly what the firmware does is the [`ui-gif`](../.claude/skills/ui-gif/SKILL.md) skill's half | ✅ | [`check_ui_gif.mjs`](../tools/uigif/check_ui_gif.mjs), [`run-ui-gif-audit.sh`](../scripts/run-ui-gif-audit.sh), [`record-dashboard-gif.sh`](../scripts/record-dashboard-gif.sh), [`selftest.sh`](../tools/uigif/selftest.sh) |
| 55 | **Rolling X10A operating observation (up to 24 h)** — reports what the service bus actually established, never a certificate that the whole plant is healthy. Events are sampled once per completed poll sweep because a 5-minute trend bucket can erase a short compressor, defrost or heater event; a pulse entirely between sweeps can still be missed. Storage is 23 completed one-hour buckets plus the pending hour, so the represented span is never the former almost-25-hour “24 h”; `full_span` uses real first/latest monotonic timestamps, and absolute-timestamp evidence accumulation preserves the serial sweep's fractional seconds. Reboot, explicit detection, profile or RX/TX identity changes reset the window without mixing an in-flight old-link sample; HomeHub-only edits do not. Any check that concludes absence of a pattern needs a complete `full_span` lifecycle and at least 90% valid evidence for its own signal, while direct current state and observation-only flow expose their shorter eligibility targets. `/status.health` keeps its existing ids/verdict strings, adds `available`/`assessable`/`evaluated`, and every check carries `evidence`, `observed_s` and `required_s`; supported observations are visible but cannot support aggregate `ok`. Claim strength is explicit: current unit fault = direct `device` state; raw water-pressure minimum plus the documented **above 1 bar** `manufacturer` boundary (brief low = `Info`, 60 s continuous = `Warn`); cycling and a positive-denominator defrost ratio = `heuristic` `Info` only (mixed modes and missing load, humidity and coil-temperature context). Defrost exposes raw `count` plus `paired_count`; only paired transitions satisfy its three-cycle guard, while count-only/zero-denominator defrost is `observation`. Flow after a 60-second pump run-up and separately covered BUH/BSH observed seconds are likewise `observation` only. Protection retries are `experimental`, raised only by a strict increase of one exact page-`0x10` 3-bit counter between comparable samples, never by an absolute non-zero value or guessed wrap; stable counters do not prove absence. There is no universal flow threshold, heater-runtime diagnosis, flat start-count alarm, inferred valve leakage or overall “healthy” verdict | ✅ 🧪 | [`logic/checkup.hpp`](../main/logic/checkup.hpp), [`checkup.cpp`](../main/checkup.cpp), [`http_status.cpp`](../main/http_status.cpp), [`www/js/dashboard.js`](../main/www/js/dashboard.js) |
| 56 | **Group-scoped HA entity identity** — a value's `uniq_id` *and* the last segment of its discovery topic are `<group>_<object_id>`, not the label slug alone. Both are **flat** namespaces while a label is unique only within its register page, and the catalog carries *"Error Code"* on the outdoor page and on the hydronic one — so the second discovery config landed on the first one's retained topic under the first one's id, HA created **one** entity, and a unit reporting two faults showed one of them. Measured: 44 of 45 profiles collided, over five label slugs; on the live unit the surviving `error_code` entity read the *hydronic* fault, leaving the outdoor unit's — the row an automation alerts on — with no entity at all. Nothing errored, because the state payload was correct throughout (it nests by group), which is why this was invisible outside Home Assistant. The state key and the VictoriaMetrics series are deliberately **unchanged** ([#217](https://github.com/0Bu/daikin-altherma-esp32/issues/217)); the five reused labels are also *named* by their group, since HA derives the default `entity_id` from the name and two identically-named entities land as `…_2` | ✅ 🧪 | [`logic/discovery.hpp`](../main/logic/discovery.hpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md) |
| 57 | **Doc entity-id gate** — the docs hand a reader copy-pasteable YAML naming Home Assistant entity ids, each derived from a catalog **label**, so an id is only as stable as the label — and the catalog spells one quantity several ways across models. A wrong id errors *nowhere*: HA builds the template sensor, its `availability` guard never becomes true, the entity sits at `unavailable`, and that reads as "my heat pump doesn't support this" rather than as a typo in the docs. Every other gate is green while it happens. Resolves each quoted id through the real `ha_slug` over the real catalog, and only against **detectable** profiles — the heat-meter recipe had named a row existing solely in the host-test fixture `altherma3_r_erga` since #206, which a whole-registry check would have passed. Deliberately not a demand that an id be right on *every* profile | ✅ | [`entity_id_audit.cpp`](../tools/docs/entity_id_audit.cpp), [`run-doc-entity-audit.sh`](../scripts/run-doc-entity-audit.sh), [`selftest.sh`](../tools/docs/selftest.sh) |
| 58 | **Deleting a crash report** (`POST /crash/dismiss`) — the crash banner's dismiss was *page state*, so the first reload brought the same crash straight back and a second browser (or Home Assistant's retained crash entity) never saw the dismissal at all. It is now a device action: erase the dump image, **then** mark the cached `CrashInfo` dismissed, so `crash_is_notable()` is false everywhere at once — `/status.last_crash` goes `null`, the retained crash topic clears on the next heartbeat tick, and the banner is gone across reloads and browsers. Erase first, mark second: a failed erase answers `500` and marks nothing, since a dismissal that outlived it would report "no crash" with the dump still downloadable. RAM-only on purpose — after any reboot the reason is no longer a fault and the dump is gone, while a *new* crash must show, which a persisted dismissal could suppress. The reset **reason** is untouched, so the heartbeat's own sensor still says how the board rebooted. `POST`, not a `GET` beside `/coredump`: it destroys the one artifact a bug report needs, so no link or prefetch may reach it | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp), [`http_status.cpp`](../main/http_status.cpp), [`www/js/app_state.js`](../main/www/js/app_state.js) |
| 59 | **Pinned warning contract on `main/`** — three places in that component are written the way they are *because* a warning class is fatal there (the `[[nodiscard]]` on the NVS setters, an unreachable `return false`, a `static_cast<int>` onto a `%d`), and nothing in the repo made that true: `main/` carried no warning policy of its own, so all three held only while ESP-IDF's defaults happened to make them fatal — and IDF's `-Werror` handling is version- *and* Kconfig-dependent, so a bump could have retired them silently. `-Werror=return-type`, `-Werror=format` and `-Werror=unused-result` are now pinned on that component alone. The `unused-result` one is the sharpest: a dropped NVS write is silent, and exactly one left safe mode unable to latch its crash counter. Scoped rather than global for two independent reasons — a `CONFIG_COMPILER_*` key would hold ESP-IDF and the managed components to a contract that is not ours to demand, and `sdkconfig.defaults` is hashed into CI's ccache key, so a diagnostic-only change there would discard every cached object it cannot invalidate. Costs no CI minute: the firmware `build` job is already the only compile of `main/*.cpp`, which is also why `run-mock-tests.sh` cannot see the format case (`int32_t` is `long int` on xtensa, plain `int` on the host). Deliberately **not** accompanied by a clang-tidy/cppcheck gate — measured at ~7000 findings blanket and ~50 curated with **zero** real defects, since the bug classes here are typed out rather than linted out (§9) | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt), [`nvs_storage.hpp`](../main/nvs_storage.hpp), [`logic/timestamp.hpp`](../main/logic/timestamp.hpp) |
| 60 | **Manual UI-language override** — the bilingual (de/en) web UI is browser-detected by default; a persistent **Sprache** picker (Browser / English / Deutsch) on the Firmware settings card now overrides that per installation, winning over the browser guess on every client. Stored in the atomic config blob (**v4**, one writer, `auto` decoded defensively so a pre-v4 OTA keeps the browser default instead of dropping credentials) and applied **live** — the browser reads `/status.ui.lang` and re-localises the chrome + schematic with no reload. Landed alongside a split of the single ESP32 settings card into three (ESP32 / Protokoll / Firmware) | ✅ 🧪 | [`logic/ui_lang.hpp`](../main/logic/ui_lang.hpp), [`http_config.cpp`](../main/http_config.cpp), [`http_status.cpp`](../main/http_status.cpp), [`www/js/i18n.js`](../main/www/js/i18n.js) |
| 61 | **Second SOURCE: read-only Modbus TCP to a Daikin HomeHub (EKRHH)** — an *optional* second stack beside the X10A tap, **not an alternative to it**: separate task, separate cache, separate link state, both running at once. The two fail for entirely unrelated reasons (X10A at the cable, the pin or the framing; Modbus at the LAN, mDNS or the hub), so coupling them would let either failure mask the other — pull the service cable and the HomeHub keeps reporting; lose the LAN and X10A keeps polling. It costs **nothing when absent**: the task exists only while the configured ADDRESS, which is what let the X10A poll task give back the 4 KB an earlier revision took from it. **One-shot mDNS auto-discovery** — browse `_http._tcp` once, on the first boot with no address at all, filter the `homehub-*` hostname (mandatory: this firmware answers that same browse), then persist and fill the responder's resolved **IPv4**, not its serial-derived mDNS name. The outcome PERSISTS, including "found nothing", so a LAN without a hub is not browsed again on every boot; a hub added later is typed in by hand. A lwIP socket around the host-tested MBAP framing with **request-bound** parsing and a whole-reply deadline. The first concrete transport/protocol failure is preserved, exposed as a localisable code plus errno/exception/register detail, shown as quiet red text below the host and logged once per state transition to `/diag` + Syslog; a clean cycle logs recovery. The two sources meet in exactly one place — `logic/homehub_map.hpp`, which pairs a register to an X10A row **structurally** (reusing `history.hpp`'s trend ids, `static_assert`ed) and never by label, since the catalog spells one quantity many ways and reuses tags across quantities. The UI shows both side by side with their difference **while both are up**, and lets Modbus **stand in, marked, when X10A is silent** — where it shows *no* comparison at all, because the only X10A number left is one the bus stopped refreshing and a "difference" against it would state something about two *instants* in the shape of a statement about two *instruments*. That rule is one predicate, not a habit at each call site: a *second* opinion presupposes a first, so `mbTwin()` returns nothing once the bus is silent, and the same question is asked of the inspector's own reading and of its member rows. `/values` carries the guarantee underneath it — the `modbus` array is emitted **only while the link is live at the moment the snapshot is taken**, so if it is present, every row in it was read this cycle; liveness and the cache sit behind two mutexes, so the snapshot reports the link state *after* the copy, and when it is not live the key is omitted rather than emitted empty. **Read-only by design:** unlike X10A — which simply *has* no write command — this wire *would* allow one, so the restraint is the firmware's; no write function, no MQTT subscribe, no writable entity, no HTTP write route (grep-verifiable) | ✅ 🧪 | [`hp_modbus.cpp`](../main/hp_modbus.cpp), [`logic/modbus.hpp`](../main/logic/modbus.hpp), [`logic/homehub_map.hpp`](../main/logic/homehub_map.hpp), [`def/homehub.hpp`](../main/def/homehub.hpp), [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md) |

---

## 1. Secure boot & firmware signing

### Secure Boot v2 signature scheme — *without* burning eFuses

The build enables the Secure Boot v2 **RSA-3072 signature scheme** but deliberately does **not**
enable hardware Secure Boot ([`sdkconfig.defaults`](../sdkconfig.defaults)):

```
CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT=y
CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME=y
CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y
CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES=n   # CI signs post-build, offline key never at compile time
```

What this buys, and why the combination is unusual:

- **The running app verifies the *next* OTA image's RSA signature before writing it.** A compromised
  update host can no longer push unsigned firmware — trust is *trust-on-first-use* from the running
  app's own signature block, enforced by `bootloader_support`/`app_update` on the update path.
- **No eFuses are burned.** The bootloader does *not* verify on boot, so this is fully reversible,
  carries **zero brick risk**, and the browser (Web Serial) / USB-flash install path keeps working.
- **The private key is never present at compile time.** `BUILD_SIGNED_BINARIES=n` means the image is
  signed in a *separate* step ([`ci-build-all.sh`](../scripts/ci-build-all.sh) →
  `espsecure.py sign_data --version 2`), so fork/PR builds without the secret still compile, and the
  key stays offline.

Full key lifecycle, threat model, and the boot-recovery reasoning: [`SECURITY.md`](SECURITY.md).

### The trade-off it forces — and the guard that contains it

Because the app itself must carry a valid signature to run under this config, an **unsigned image
crash-loops** in `esp_secure_boot_init_checks` *before* `app_main`, with no app-level recovery — and
a full `@flash_args` flash also blanks otadata, leaving the bootloader no rollback record. The
project turns that sharp edge into a hard gate:

- [`scripts/require-signed.sh`](../scripts/require-signed.sh) inspects a `.bin` with
  `espsecure signature-info-v2` and **exits non-zero with the exact signing command** if the
  signature block is absent. The [`flash-esp32`](../.claude/skills/flash-esp32/SKILL.md) skill runs
  it before every `esptool write_flash`.
- CI never publishes unsigned firmware to OTA: [`build.yml`](../.github/workflows/build.yml) hard-errors
  on a `main` build with no `OTA_SIGNING_KEY` secret (fork PRs downgrade to an unsigned
  *compile-only* build — nothing is published or offered for flashing).
- CI applies the same guard to the **browser installer**, which no host-side check can reach:
  [`ci-build-all.sh`](../scripts/ci-build-all.sh) carves each published Web Serial part out of the
  prepared `-merged.bin`, then runs `require-signed.sh` on the final staged app bytes. A signing step
  that silently stops covering the installer therefore fails the build instead of shipping.

---

## 2. OTA self-update & anti-brick

See [`ARCHITECTURE.md` → OTA, signing, partitions](ARCHITECTURE.md) and
[`SECURITY.md` → Boot recovery](SECURITY.md).

- **Dual-OTA layout** ([`partitions.csv`](../partitions.csv)): two ~2.03 MB app slots (`ota_0`/`ota_1`)
  sized to fill 4 MB flash exactly, with `otadata`, `phy_init` and a `coredump` partition.
  `esp_https_ota` writes the **inactive** slot, so an update never touches `nvs@0x9000` — WiFi, MQTT
  and the X10A pin cache survive upgrades.
- **✅ NVS-preserving Web Serial updates** ([`ci-build-all.sh`](../scripts/ci-build-all.sh)):
  `merge_bin` remains the canonical prepared image, but the manifest publishes only the occupied
  `flash_args` ranges as separate parts. A no-Erase install therefore skips `nvs@0x9000` instead of
  writing the merged image's `0xff` gap through it. The independent
  [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py) gate requires the Erase
  choice to remain enabled, rounds every part to its actual 4 KB erase sectors and fails the build
  if any overlaps NVS. Selecting **Erase** in ESP Web Tools remains the explicit factory-reset path.
  Two things make that gate evidence rather than ceremony. It is checked for **fail-closed**
  behaviour by [`test_web_installer_plan.py`](../test/test_web_installer_plan.py)
  ([`run-web-installer-plan-tests.sh`](../scripts/run-web-installer-plan-tests.sh), a CI `gates`
  step): running it on the real manifest only ever proved that today's good plan passes, so the
  tests feed it the bad ones — a part over `nvs`, a path outside the manifest directory, a directory
  where an image belongs, a `true` where an offset belongs, malformed JSON. And the parts are
  checked for **length**, not just for address: `ci-build-all.sh` verifies each carved file is
  exactly the size its offset plan declares, because a short `dd` produces a truncated image that
  the overlap check still calls safe.
- **Rollback armed until proven healthy** (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`): a freshly-booted
  OTA image starts `PENDING_VERIFY`. If it reboots before being marked valid, the bootloader reverts.
- **✅ 🧪 Health gate, not a timer** — the distinctive part. Instead of blindly committing after an
  uptime window, [`ota_update.cpp`](../main/ota_update.cpp) drives the host-tested state machine in
  [`logic/health_gate.hpp`](../main/logic/health_gate.hpp): an image is sealed in only once it has run
  a base window (≥90 s, survives an early crash-loop) **and** proven connectivity (STA online, or the
  setup portal when it has no credentials). A boots-but-broken update — e.g. a WiFi regression that can
  never get back online to be re-flashed — is left un-committed and **rolls back on the next reboot**
  instead of sealing the break in. USB/`@flash_args` images boot `UNDEFINED`, never `PENDING_VERIFY`,
  so the gate can never strand a fresh board.
- **✅ 🧪 Update channels** ([`logic/ota_channel.hpp`](../main/logic/ota_channel.hpp), `POST /set_ota`,
  `/status.ota.channel`): a merge to `main` no longer cuts a release, so CI publishes **two** feeds —
  `release` (the gh-pages root, republished only by a manual workflow run that tags `v*`) and `dev`
  (`…/dev/`, republished by every firmware-relevant merge) — and each device follows one. The dev
  URL is *derived* from the configured firmware base (`…/dev/`), never configured separately, so the
  two feeds cannot drift onto different hosts. Persisted in the config blob (v3, one writer) and
  applied **live** — no reboot, since nothing claims a channel at task start. Dev builds are stamped
  `<next release>-dev.<n>`: a semver **pre-release**, so ordering alone gets both directions right —
  a dev board upgrades itself to the next release, a release board never drifts onto a dev build.
- **✅ 🧪 Manifest check & signed download** ([`ota_update.cpp`](../main/ota_update.cpp)):
  `/ota/check` fetches the **selected channel's** `manifest.json` over TLS (public CA bundle) and
  compares its `version` to the running image; `/ota/update` streams the signed `.bin` into the inactive slot via `esp_https_ota`,
  reporting progress on `/ota/status`. Both run on **one on-demand task, one at a time** — never on
  the httpd worker (a multi-MB TLS download would park the single HTTP task and take the web UI down
  with it), and never twice concurrently (two TLS sessions compete for the largest *contiguous*
  block). The manifest is parsed by [`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp) —
  bounded, allocation-free, depth-aware, and it **refuses rather than truncates** an oversized value.
- **✅ 🧪 Two-point downgrade gate** ([`logic/version_cmp.hpp`](../main/logic/version_cmp.hpp)): a
  signature proves a build is *authentic*, not *newer*, so an attacker who can serve a genuine old
  image could otherwise walk a fleet backwards onto a fixed bug. The gate refuses anything not
  strictly newer, checked **twice**: against the manifest's `version` (cheap, avoids a pointless
  download) and — the check that actually binds — against the **image's own embedded
  `esp_app_desc_t` version**, read via `esp_https_ota_get_img_desc()` before anything is committed.
  The manifest and the image are separately-controlled artifacts, so only the second check catches a
  host that advertises `9.9.9` while serving a signed `1.0.0`; it also requires both artifact-version
  strings to match exactly, so two independently “newer” but different artifacts are refused.
  Ordering is numeric
  (`1.10.0 > 1.9.0` — a `strcmp` gets this backwards), pre-release identifiers compare numerically
  too (`-dev.12 > -dev.9`, semver §11.4 — a `strcmp` freezes a dev board at the ninth build of a
  series), and it **fails closed** on an unparseable version. The one relaxation is the **channel
  switch**: going from the dev feed back to the last release is an older version by definition, so
  `POST /ota/update?downgrade=1` (`ota_install_allowed`) relaxes the *ordering* — never the
  signature check, never an equal version, never on the manifest's say-so, and never persisted.
  Without it the release channel would be unreachable from a dev board; with it, the property that
  matters still holds — a hostile manifest host cannot walk a fleet backwards on its own.
- **✅ The feeds themselves**: both are live on the `gh-pages` branch and published by CI — the
  RELEASE channel at the root (`manifest.json` + the images, written only by a manual release run)
  and the DEV channel at `dev/` (rewritten by every firmware-relevant merge to main). The
  precondition outside the firmware is met: the repo's Pages source points at `gh-pages` /
  `(root)` ([`README.md`](README.md)), which is why the branch had to exist first. (The repo does
  not have to be public — that gate was removed; note the resulting Pages site *is* public
  regardless of repo visibility.) A device follows one feed at a time
  (`ota_channel`, above); against a channel with nothing served a check honestly reports "up to
  date" rather than failing, which is also what a self-hosted setup falls back to — point
  `CONFIG_DAIKIN_OTA_MANIFEST_URL` / `CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL` at any HTTPS host to run
  your own (the dev URL is derived from the latter, so one setting moves both).
- **Version pipeline**: [`next-version.sh`](../scripts/next-version.sh) prints either the next
  **release** (`patch`/`minor`/`major` above the latest `v*` tag, with `version.txt` as a manual
  floor) or the next **dev** version (`--dev` → `<next patch>-dev.<commits since the tag>`). Which
  one a run stamps is decided by the run mode: a merge to `main` is always a dev build, and only a
  manual `workflow_dispatch` with `release: true` produces a tagged release. CI stamps that version
  into `version.txt` *before* the build, so ESP-IDF bakes that exact string into
  `esp_app_get_description()->version`, and `manifest.json` is written from the **same** stamped
  string.
  [`ci-build-all.sh`](../scripts/ci-build-all.sh) then reads the version back out of the built
  image's app descriptor and **fails the build** if the two disagree, so the running image, the
  release tag and the manifest can't drift apart: OTA compares the manifest against the version the
  running app reports, making a mismatch a permanent re-download loop rather than a cosmetic slip.
- **✅ Publish-version gate — the feed may not move backwards**
  ([`check-publish-version.sh`](../scripts/check-publish-version.sh),
  [`publish_gate.cpp`](../tools/version/publish_gate.cpp)). The check above pins the version to *this
  build's* image; this one pins it to what the feed **already serves**. Right after stamping, the
  build job reads the published version out of the `gh-pages` branch — root for a release, `dev/`
  for a merge — and asks the device's own `ota_is_upgrade()` whether a board on that build would
  accept the new one; a release additionally has to be a plain version, since ordering alone would
  happily put a `-dev.N` build on the hand-cut feed. Necessary because the stamped version is
  *derived*: `next-version.sh` reads the `v*` tag list and falls back to the `version.txt` floor when
  it is empty, so a deleted tag resets the numbering with nothing failing. That is not hypothetical
  — on 2026-07-24 the repository's tags were deleted and the next merge republished `dev/` as
  `1.0.0-dev.168` over the `1.0.14-dev.2` it had served minutes earlier, green build, every device
  correctly refusing an "update" that went backwards. Tested by
  [`run-publish-version-tests.sh`](../scripts/run-publish-version-tests.sh) (a CI `gates` step),
  including that exact regression.
- **✅ 🧪 Boot-loop safe mode (config recovery)** ([`safe_mode.cpp`](../main/safe_mode.cpp),
  [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp)): a **different** failure class from the image
  rollback above — both OTA slots share the same `daik_cfg` NVS, so rolling back the *image* can't fix
  a *config* crash-loop (e.g. wrong RX/TX pins). Safe mode counts **crash-only** boots (a clean/
  config-save reboot resets the count, so provisioning never trips it) and, past a threshold, brings
  the device up minimally — WiFi + web UI + OTA, no poll/MQTT — so the bad setting is fixable in the
  browser instead of over USB. `/status.sys.safe_mode` + a warn-accented **Recovery mode** banner
  surface it. The counter lives in `daik_cfg`, so a factory reset clears it too.

---

## 3. Networking & connectivity resilience

The device is a **stationary, mains-powered bridge** that must never need a human to power-cycle it.
[`wifi.cpp`](../main/wifi.cpp) layers several IDF features toward that (deep dive:
[`ARCHITECTURE.md` → WiFi/LAN](ARCHITECTURE.md)):

- **Connect to the *strongest* AP, not the first heard.** `WIFI_ALL_CHANNEL_SCAN` +
  `WIFI_CONNECT_AP_BY_SIGNAL` so a multi-AP/mesh SSID doesn't latch a distant, weak AP (the classic
  "weak WiFi" symptom on a non-roaming STA). `failure_retry_cnt = 3` keeps the top-ranked AP across a
  transient SAE hiccup; `sae_pwe_h2e = WPA3_SAE_PWE_BOTH` advertises both Hash-to-Element and
  Hunt-and-Peck.
- **Endless reconnect with a first-boot budget.** A boot-time connect failure spends a bounded budget
  (10 attempts) → tears the STA stack down → opens the setup portal (creds presumed wrong). Once ever
  online, a drop reconnects **forever** — a router reboot never strands the bridge. That guarantee is
  unconditional on the disconnect *reason*: an earlier revision rebooted after ≥5 consecutive
  `AUTH_FAIL`/handshake-timeout drops, which let a transient WPA3-SAE storm — the very thing
  `failure_retry_cnt`/`sae_pwe_h2e` above exist to absorb — spend the boot budget against a healthy AP
  and strand the bridge in the open portal with good credentials still in NVS. The budget is also
  suspended while a credential change is pending, so ten fast `NO_AP_FOUND` scans can't pre-empt the
  rollback grace below.
- **✅ One ESP-NETIF initialization for both network paths.** [`main.cpp`](../main/main.cpp) calls
  `esp_netif_init()` once at startup; [`wifi.cpp`](../main/wifi.cpp) and
  [`provisioning.cpp`](../main/provisioning.cpp) only create and destroy their *own* interfaces.
  It is a process-wide singleton, and each branch used to initialize it itself — which is fine
  until they run in sequence, i.e. on exactly the first-boot STA-failure → setup-portal fallback
  that leads into the recovery path. The same teardown now also deletes the STA event group it
  discards, so falling back to the portal no longer leaks it.
- **✅ In-app WiFi re-config with one-shot credential rollback.** WiFi is provisioned first from the
  captive portal, then re-editable from the WiFi row of the Connections tile in Settings (gear → Connections →
  WiFi → modal → `POST /set_wifi`, validating SSID 1–32 / password empty-or-8–63). Because a bad SSID/password entered over the LAN
  would otherwise strand the device in the setup AP, `/set_wifi` stashes the previous working
  credentials as a **one-shot NVS backup**; on the reboot into the new network, if the STA never gets a
  DHCP lease `wifi_start_sta()` restores the backup and reboots again — a successful connect clears it.
  The reboot is gated on the restore having **persisted**; if the NVS write fails the device opens the
  setup portal rather than rebooting into a restore it would have to re-decide identically every boot.
  The deadline is **reason-aware** ([`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp)),
  because a rollback *destroys* the new credentials and must not be spent on a guess: only an AP that
  **keeps refusing** them (auth class, sustained across two 30 s checkpoints — one sample cannot tell a
  wrong password from a transient SAE failure) takes the fast path. An **absent SSID** says nothing about the
  credentials — it is what a router that is still rebooting looks like, and re-pointing the device at a
  just-reconfigured router is the main reason anyone edits these at all — so it waits 180 s. The blind
  30 s deadline this replaces did the opposite: it restored an old SSID for a network that no longer
  existed and threw the correct new credentials away. The outcome is recorded as
  `/status.wifi.rolled_back` (sticky until the next `/set_wifi`), since the rollback's own reboot wipes
  the diag ring and the Connections tile's WiFi row just shows the old SSID again. The dashboard reads it as a **rollback
  banner** — necessarily a banner off `/status` rather than a toast on the save, because the verdict
  takes 60–180 s and lands long after the save's ~21 s reconnect poll has given up.
- **✅ 🧪 Config-write integrity** ([`config.cpp`](../main/config.cpp),
  [`logic/config_model.hpp`](../main/logic/config_model.hpp)). Two tasks write the config — httpd
  (`/set_*`) and poll (detection) — and a writer that saves a whole `Config` saves whatever it
  *snapshotted*. Detection snapshots, then probes the bus for seconds before committing, so a
  whole-struct write-back reverted any `/set_wifi` that landed during the sweep, silently, after the
  user was told `{"ok":true}`. Writers now commit only the fields they **own**: `config_save_link`
  (rx/tx/proto, persisted) and `config_set_model` (profile/`fp_*`, RAM) patch the live config in place
  under the mutex via `apply_link`/`apply_model` — non-allocating, so the critical section stays
  throw-free, and host-tested so "touches nothing else" is proven rather than argued. The rule is
  deliberately asymmetric (it closes poll→httpd, not httpd→poll: a reverted link self-corrects on the
  next detect, credentials do not). Separately, an NVS write failure now **reaches the user**:
  failure of the route-owned atomic blob answers `500 {"ok":false,"error":"config write failed"}` and
  skips the reboot; failure of an unrelated self-healing link-cache maintenance write is logged but
  does not falsely reject an already-committed service change. `/set_hp` is the exception because it
  owns the link: it requires all three cache keys and leaves RAM untouched if one fails. The
  distinction is host-tested in `config_save_succeeded()`. `config_save` names every failing key +
  `esp_err_t` on `/diag`, and the two WiFi credential groups stop dead rather than half-write (a
  partial blob save would defeat the ordering that protects the rollback backup).
- **✅ ICMP gateway watchdog (ghost-association recovery).** The reconnect handler can only see drops
  the STA *knows* about. A missed deauth leaves a "ghost" association — IP held, TCP timing out, no
  `STA_DISCONNECTED` event ever fires. A background task ICMP-echoes the default gateway every 30 s and,
  **only** for the proven ghost case (link up, yet a gateway that *has* answered before now doesn't),
  forces one `esp_wifi_disconnect()` to re-associate. It never reboots and never false-alarms on a
  router that simply drops LAN ICMP. The probe is three-valued and its policy is host-tested
  ([`logic/link_watch.hpp`](../main/logic/link_watch.hpp)): a probe that cannot be *taken* is
  `Unmeasurable`, never counted as a failure — but no longer reported as *healthy* either. That
  conflation left a **blind** watchdog indistinguishable from a good link, and the memory pressure
  that blinds it is what accompanies the wedge it exists to break, so a *sustained* inability to
  measure (10 periods, ~5 min vs. 2 for proven silence) now re-associates too. Decisions log via
  `diag_printf` — reaching `/diag` + syslog — rather than the serial-only `ESP_LOGW` that left a
  wedged board with no off-device trace.
- **✅ Task Watchdog on the worker tasks.** The two tasks that do real, potentially-blocking I/O —
  the poll engine ([`hp_poll.cpp`](../main/hp_poll.cpp), X10A UART reads) and the MQTT publish task
  ([`mqtt_ha.cpp`](../main/mqtt_ha.cpp)) — subscribe themselves to the ESP Task Watchdog Timer
  (`CONFIG_ESP_TASK_WDT_*` in [`sdkconfig.defaults`](../sdkconfig.defaults), `TIMEOUT_S=20`,
  `PANIC=y`). `hp_poll` feeds it per cycle **and once per register** during the sweep (so a
  slow-but-progressing 9600-baud read is never mistaken for a hang); `mqtt_pub` feeds it
  unconditionally at the top of its 1 s loop (**not** gated on connection/publish, so a long broker
  outage can't false-trip) **and once per publish** (a ~30-message reconnect burst on a slow link
  stays within budget — the symmetric analogue of the per-register poll reset). The default
  idle-task watch catches CPU *starvation*; this adds the *blocked-but-still-scheduled* case (a
  wedged UART read or a stuck publish) it can't see. On a trip the device reboots cleanly with
  `esp_reset_reason() == ESP_RST_TASK_WDT` — classified as a fault and surfaced on
  `/status.last_crash` + the retained MQTT crash topic (§6), so a genuine hang becomes a
  diagnosable, self-healing reboot instead of a silent stall that needs a power-cycle.
- **✅ Stack-overflow watchpoint** (`CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y` in
  [`sdkconfig.defaults`](../sdkconfig.defaults)). A hardware watchpoint on each task's stack limit, so
  the **first** write past it panics at the offending instruction. IDF's default is the canary check,
  which is only compared at a context switch — and v1.0.12 is the case it misses: the `httpd` task ran
  460 bytes off its floor (`httpd 7728/460` in the core dump's task table), wrote past `pxStack` into
  its own TCB, overwrote `pvThreadLocalStoragePointers[0]` with `0x4`, and kept going; it died ~44 s
  later inside lwip's `pthread_getspecific` with a backtrace pointing at a WebSocket send that had
  nothing to do with it. A sparsely-writing frame can step over the canary words entirely (the
  neighbouring TLS[1] survived, which is how we know it did). It then earned its keep on the OTHER
  runner of that same builder: `hp_poll` (whose WebSocket broadcaster also called
  `http_append_status_json()`) was still at 8192 when #229 and #231 grew `/status` to ~3.5 KB, and
  the watchpoint caught it **at** the offending instruction — `exccause 0x41`, `hp_poll 7664/520`,
  inside a `malloc()` under `Config::Config` — instead of months later somewhere unrelated (#241).
  That second runner is now **gone** with the WebSocket push: `/status` is built on the httpd task
  alone (12 KB, 1456 used under 4376 concurrent requests) and `hp_poll` is back to 8 KB, since the
  builder is what it could not fit. The watchpoint stays — it is the only thing that reports a stack
  overflow *where it happens*. Costs one of the two ESP32-S3 debug
  watchpoints — unused here, since this firmware is debugged from core dumps rather than JTAG. The
  same fix raised `httpd` to 12 KB ([`http_server.cpp`](../main/http_server.cpp)) and cut the peak by
  building the `/status` JSON with `+=` instead of long `+` chains
  ([`http_status.cpp`](../main/http_status.cpp)).
- **Modem sleep disabled** (`WIFI_PS_NONE`): trades the idle-power saving of DTIM sleep for a
  consistently responsive HTTP UI (no ~100–300 ms wake latency per inbound request).
- **mDNS + DHCP hostname** — reachable at `daikin-altherma-esp32.local`, and the router's client list
  shows the real hostname via DHCP option 12 (set before the DHCP client runs).
- **LWIP tuned for the workload** ([`sdkconfig.defaults`](../sdkconfig.defaults)): socket cap lifted to
  16 (http server + mDNS + SNTP + MQTT + OTA can otherwise starve the download of a BSD socket), and
  the TCP send/receive windows doubled — `CONFIG_LWIP_TCP_{SND_BUF,WND}_DEFAULT=11520`, 2× the IDF
  default of 5760 — which halves the round-trips the page costs. The page is **~71 KB gzipped**
  (229 KB spliced, ~3.1× compression), so it still spans ~7 window-fulls: the win is halving that,
  not clearing it in one. It has grown with the interactive schematic and is worth re-measuring when
  `www/` gains weight — run the build's own splice
  ([`inline_assets.cmake`](../main/www/inline_assets.cmake)) and `gzip -9`, since nothing minifies or
  strips comments (the served page is byte-identical to a hand-written monolithic `index.html`).

### Captive-portal provisioning

First boot with no WiFi config comes up as SoftAP `daikin-altherma-esp32-setup`
([`provisioning.cpp`](../main/provisioning.cpp)). A hand-rolled UDP:53 DNS server
([`captive_dns.cpp`](../main/captive_dns.cpp)) answers **every** A query with `192.168.4.1`, so a
joining phone's OS connectivity probe resolves to the device. One shared `:80` `esp_http_server`
handles both AP-setup and STA-run modes.

Auto-popping the portal then depends on answering that probe the way the OS recognises. Each one
fetches a well-known URL over plain HTTP right after associating — iOS/macOS
`captive.apple.com/hotspot-detect.html` (expects a `Success` body), Android
`connectivitycheck.gstatic.com/generate_204` (expects `204` + empty body), Windows
`msftconnecttest.com/connecttest.txt`. The `/*` catch-all
([`http_status.cpp`](../main/http_status.cpp)) answers all of them with **`302` +
`Location: http://192.168.4.1/`** plus `Cache-Control: no-store`, which is the one signal all three
agents act on; the portal root itself serves the page. Through **v1.0.7** the catch-all served the
page directly with `200`, which is only a heuristic (Android additionally weighs a parallel HTTPS
probe it cannot reach here) and sent `Content-Encoding: gzip` to probe agents that are minimal HTTP
clients rather than browsers — a redirect has an empty body, so gzip leaves the probe path entirely
while the browser that follows the redirect still gets the compressed page. Belt and braces, the
SoftAP's DHCP also advertises the **RFC 8910** captive-portal URI (option 114), which recent
iOS/Android prefer over probing at all. The setup-vs-STA split is
[`logic/captive.hpp`](../main/logic/captive.hpp), host-tested — in STA mode the same catch-all is the
dashboard's SPA shell and must not redirect.

The portal takes the SSID as **typed text** — it does not scan, offers no network dropdown, and
fetches nothing. So the radio runs **AP-only**: an earlier version ran APSTA with an idle station
interface for the single reason that `esp_wifi_scan_start()` needs a *started* STA, and without one
`GET /scan` failed and the dropdown fell back to a free-text box anyway. With the scan gone, so are
the extra interface and the channel-hopping blip a scan inflicts on the associated phone. `GET /scan`
itself survives as a trusted-LAN diagnostic; it is not on the open AP's surface
([`logic/http_surface.hpp`](../main/logic/http_surface.hpp)).

A typed SSID also handles what the picker could not: a **hidden** (non-broadcasting) network is
entered exactly like a visible one.

---

## 4. Web server & the live transport

- **`esp_http_server` on `:80`**, with `CONFIG_HTTPD_WS_SUPPORT=n` — stated explicitly because this
  firmware deliberately has **no** push transport (below). The full HTTP surface is in
  [`.claude/CLAUDE.md` → HTTP API](../.claude/CLAUDE.md) and [`docs/README.md`](README.md).
- **✅ The live UI is a POLL, and the absence of a push is the feature.** `www/js/bootstrap.js` fetches
  `GET /values` every 2 s and `GET /status` every 8 s on one recursive-`setTimeout` chain (never
  `setInterval`: a slow answer must delay the next request, not stack a second behind it), backs off
  to 30 s while the device is unreachable, suspends entirely while the tab is hidden, and refetches
  at once when it becomes visible. `GET /events` — a WebSocket push with a broadcast registry, a
  frame policy (`ws_policy.hpp`) and two one-in-flight backpressure gates (`ws_tx_gate.hpp`) — was
  **removed**, and the reasoning is in [`ARCHITECTURE.md` → "Push vs. poll"](ARCHITECTURE.md):
  4376 concurrent `GET /status` never crashed the board, while 3 WebSocket subscribers crashed it in
  seconds; one silently-dropped IDF queue message froze a stream until reboot with nothing logged
  (#238); and running the push from the poll task put the ~3.5 KB `/status` builder on the task that
  owns the X10A UART until it overflowed its stack (#241). A push fails silently and globally; a
  request fails loudly and locally, under a `503` this server already returns. The cost is one
  cadence of latency on a dashboard whose motion is CSS.
- **🧪 Request bodies are reassembled, not assumed**
  ([`logic/http_body.hpp`](../main/logic/http_body.hpp)). A POST body is a TCP stream and
  `httpd_req_recv` returns only what has arrived — the IDF's own docs say a large body may take several
  calls. `http_read_body` loops until `content_len` is consumed, keeping the size cap and the 503
  guard, so a body split across segments no longer reaches the handler truncated and comes back as a
  spurious 400 "bad json". A `HTTPD_SOCK_ERR_TIMEOUT` is retried while progress keeps resetting the
  idle count, but only `BODY_MAX_IDLE` times consecutively: unbounded patience would let one client
  that announces a Content-Length and goes quiet park the single httpd task.
- **✅ Gzipped UI embedded in the app image.** [`main/CMakeLists.txt`](../main/CMakeLists.txt) inlines
  `www/index.html`, `www/style.css` and the `www/app.sources` fragments into one page and pre-gzips it at build time (`EMBED_FILES` →
  `_binary_index_html_gz_*`); shipping it pre-compressed cuts first-paint bytes ~3× over WiFi. The
  captive `setup.html` is embedded the same way.
- **✅ OOM discipline** ([`http_common.cpp`](../main/http_common.cpp)): request handlers run under a
  `try/catch` that returns **503 instead of crashing**, because an uncaught throw would unwind through
  esp_http_server's C frames → `std::terminate` → reboot. Large output is streamed, not built as one
  contiguous `std::string`. This is a first-class constraint on this heap-tight target — see
  [`ARCHITECTURE.md` → Memory constraints](ARCHITECTURE.md).
- **✅ The same discipline covers every allocating FreeRTOS task loop**, since a task entry is a C
  frame boundary exactly like a handler is: `poll_task` ([`hp_poll.cpp`](../main/hp_poll.cpp)),
  `mqtt_task` ([`mqtt_ha.cpp`](../main/mqtt_ha.cpp)) and `status_led_task`
  ([`status_led.cpp`](../main/status_led.cpp)) each wrap their loop body, log once and skip the cycle
  keeping the last good state. Its corollary is that **a throw must never strand a mutex**:
  `xSemaphoreTake` is not released by unwinding, so a throw inside a critical section would leave the
  lock held and wedge every reader — worse than the reboot the guard prevents. Two mechanisms cover
  it: `hp_poll.cpp`'s stat commit is written to be non-allocating (staged deltas folded in with `+=`
  and a `noexcept` swap) so it cannot throw at all, and the readers that must copy `std::string`s out
  under the lock — `hp_stats`/`hp_values_snapshot`, and `config()` in
  [`config.cpp`](../main/config.cpp) — take it through an RAII `Lock` that releases on unwind.
- **✅ Chunked core-dump streaming** (`GET /coredump`): the flash core-dump image is streamed in 512-byte
  chunks, never buffered whole.
- **✅ Chunked trend series** (`GET /history?row=<trend id>`): one trended row's 24-hour ring, flushed
  every 64 samples so the peak string stays a few hundred bytes rather than the whole ~1.1 kB body.
  Four decisions are worth naming. The `unit` is the **row's own**, read from the cached value rather
  than hardcoded — the shipped trends mix °C, bar and unitless rows, and the browser prints this
  string into the range readout and the crosshair.
  The samples are **tenths as plain integers** — the resolution the
  converters produce, so a stored sample is exact rather than rounded on the way in, and the body is
  a third shorter than formatted decimals. The nulls carry their reason **alongside** rather than
  inside: `v` stays a number-or-null array any consumer can read, and `held` run-length-marks which
  nulls were the outdoor unit resting. And `t0` — the wall-clock instant of sample 0 — is derived from
  the **age of the newest sample**, measured on the monotonic clock since its bucket was committed, so
  the answer does not depend on when the request arrived. The obvious `now - (n-1)*dt` form is wrong
  and was measured wrong on a live unit: the ring commits a bucket every 5 minutes, so between commits
  the newest sample ages while `now` moves on, and two fetches 70 s apart with an unchanged sample
  count reported t0 values 70 s apart. That made every timestamp up to a bucket late, and let a
  **pinned** readout round onto the neighbouring sample and describe a different measurement than the
  one tapped. Monotonic rather than a stored wall-clock instant because a commit may predate the first
  SNTP sync — its instant is then unknowable, its age never is; `t0` is **omitted** entirely while the
  clock has never synced or nothing has been committed, so the UI reads out an age instead of a
  fabricated timestamp. An unknown trend id is a 404, never a defaulted series.
- **✅ 🧪 Manual UI-language override** ([`logic/ui_lang.hpp`](../main/logic/ui_lang.hpp),
  `POST /set_lang`, `/status.ui.lang`). The web UI is bilingual (de/en) and picks its language
  client-side from `navigator.language` by default; on top of that the device now carries a persistent
  **manual override** — the Firmware settings card's **Sprache** picker (Browser / English / Deutsch;
  "Browser" rather than "Automatic" because that option IS the browser's own `navigator.language`
  guess). `auto` is a first-class value (browser-detected); `de`/`en` force a language on **every**
  client that opens the dashboard. It rides the atomic config blob (**v4**, one writer, decoded
  defensively — an unknown byte reads as `auto`, and a pre-v4 blob decodes as `auto` so the OTA that
  introduces the field keeps the browser default rather than dropping credentials), and applies
  **live**: the browser reads `/status.ui.lang` on its next poll and `setLang()` re-runs
  `applyStaticI18n()` + `labelSchematicHits()` with no reload. The contract is
  [`DESIGN.md` §1](DESIGN.md); the heat-pump **value labels** stay English in both languages (they are
  X10A register names) — only the UI chrome and descriptions translate. This landed alongside a split
  of the single ESP32 settings card into **three** — ESP32 / Protokoll / Firmware — with the language
  picker in the Firmware card.

---

## 5. Home Assistant / MQTT bridge

[`mqtt_ha.cpp`](../main/mqtt_ha.cpp) (deep dive: [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md),
[`ARCHITECTURE.md` → MQTT bridge](ARCHITECTURE.md)). Built on **esp-mqtt** (a managed component since
IDF v6.0 extracted it from core — [`idf_component.yml`](../main/idf_component.yml)):

- **✅ 🧪 HA MQTT auto-discovery.** One retained discovery config per value of the active profile
  ([`logic/discovery.hpp`](../main/logic/discovery.hpp)); X10A sensors point at the shared grouped
  source topic `<base>/x10a` ([`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp)),
  republished only when the payload changes so a quiet pump doesn't spam the broker. The message
  topics sit directly under `<base>` (one board per base topic); the node id
  ([`logic/ha_device.hpp`](../main/logic/ha_device.hpp)) identifies the device only in each discovery
  config's `uniq_id`/`dev.ids`, not the payload path — and it is the slugified **base topic**, not
  the board's MAC, so replacing the ESP32 keeps the HA installation device with its entities and statistics
  instead of creating a second one (the MAC id stays on as the MQTT client id + a second `dev.ids`
  entry HA merges on, and the configs published under it are retracted — the diagnostics once per
  boot, the value entities once per detected profile, in the same pass that clears the pre-#221
  un-grouped ids).
  An enabled HomeHub publishes its live register map as flat JSON on `<base>/modbus`, under the same
  **Daikin Altherma** HA device as X10A and diagnostics but with a collision-free `_modbus` entity
  namespace. Existing installations are moved from the earlier separate Modbus device by a
  persisted one-time retained-config delete/re-add with a three-second HA processing window; topics,
  unique ids, entity ids, history and customisations stay unchanged. A dead link yields `{}` and a disabled stack
  retracts the value/link-status topics and discovery configs. HA requires both the board LWT and
  `<base>/modbus/status` online. Its Int16 enums remain numeric constants on MQTT/HA (mode 2 stays
  `2`, never `"Recommended on"`); the browser names them from separate semantic metadata. A bounded
  read-only migration probe deletes a legacy retained `<base>/state` value when one exists; clean
  brokers receive no empty `/state` publish on reconnect.
  A **bit-flag** value (converter family 300-307, `conv_is_binary`) is typed as a `binary_sensor` with
  an explicit `pl_on:"1"`/`pl_off:"0"` and published as the JSON **number** `1`/`0`
  — HA gets a real on/off entity, and a metrics consumer (which drops strings *and* bools) finally
  gets the ~30 binary rows per profile that used to be invisible to it. The poll cache, `/values`
  and its payloads, history and MQTT keep the common `1`/`0` representation; `/values` adds
  `binary:true` so the web UI can distinguish those exact rows without guessing from a label or
  misreading an ordinary numeric zero/one as a switch. Ordinary flags remain **ON/OFF**; optional
  structural `binary_semantic` metadata gives the two valve selectors named states and lets the two
  Smart-Grid contact bits form one four-state UI row. Every published boundary remains numeric 0/1.
  For a consistent value list, the same UI boundary removes redundant trailing catalog legends such as
  `ON/OFF` and `On:…_Off:…` from visible reading names; raw labels remain unchanged in APIs, MQTT,
  history identities, selectors and description matching. The
  pre-split `sensor` discovery config is actively deleted on upgrade
  (`ungrouped_discovery_topic`).
- **✅ 🧪 The entity id carries the register group.** A value's `uniq_id` and the last segment of its
  discovery topic are `<group>_<object_id>`, not the label slug alone
  ([`logic/discovery.hpp`](../main/logic/discovery.hpp) `row_object_id`). Both are **flat**
  namespaces, while a label is unique only within its register page: the catalog carries *"Error
  Code"* on the outdoor page and on the hydronic one, so before #221 the second discovery config
  landed on the first one's topic under the first one's id — HA created **one** entity and a unit
  reporting two faults showed one, with no error anywhere. Measured: 44 of 45 profiles carried at
  least one collision, over five label slugs. The five reused labels are also **named** by their
  group (`AMBIGUOUS_LABEL_SLUGS`), since HA derives the default `entity_id` from the name and two
  identically-named entities land as `…_2`; every other name is untouched, so ~154 entities reclaim
  their `entity_id` — and their recorder history — across the upgrade. The state payload and the
  VictoriaMetrics series are **unchanged**: they were already group-nested (#217).
  `test_entity_identity()` asserts `uniq_id` injectivity catalog-wide across all four entity families
  (values, fault companions, heartbeat, crash), reading the id out of the real discovery config
  rather than re-deriving it.
- **✅ 🧪 Detect-only rows are never announced — and are actively retracted.** A profile row flagged
  `ValueDef::no_publish` ([`logic/value_def.hpp`](../main/logic/value_def.hpp)) is skipped by the poll
  cache, and `publish_discovery` publishes a **zero-length retained** payload to its discovery topic
  so an install upgrading from a build that *did* announce the row doesn't keep a retained config —
  and therefore a permanently-unavailable HA entity — forever. This covers an absent-feature register
  such as the `0x64` hybrid/boiler page on a non-hybrid monobloc/hydrobox: the unit answers the page,
  but every value on it is a placeholder (a `-40.4 °C` 2nd-DHW probe that does not exist, `Hybrid Op.
  Mode` "Boiler only" with no boiler). The row is **kept** rather than deleted because a profile's
  detection signature is the set of pages its rows reference (`def/signatures.hpp`) and
  `detect_candidates` picks maximal page overlap — dropping the row would make the correct profile
  lose a page to a feature-richer *wrong* profile that kept it, so the model would mis-detect and the
  same garbage would return through that table. Pinned by `test_no_publish()`.
- **✅ TLS with the IDF CA bundle.** Credentials present ⇒ `mqtts://` + `esp_crt_bundle` verification.
  Credentials are **never** sent over a plaintext broker — the client refuses to start and surfaces
  the reason in `/status.mqtt`, with **no silent fallback**.
- **✅ Save-time broker pre-flight** ([`http_config.cpp`](../main/http_config.cpp)): `POST /set_mqtt`
  verifies the broker **before** it persists — WiFi up → the same `mqtts://`-for-credentials policy as
  the bridge → DNS → a non-blocking TCP port probe → a short-lived esp-mqtt client that must actually
  `CONNECT` (and authenticate) — so a wrong host, closed port or bad password is rejected **inline at
  Save** rather than failing silently after the reboot. The transient (TLS) validation client is
  guarded by a largest-free-block check: under heap pressure it skips the connect probe (DNS + port
  were already checked) rather than risk OOM-ing the live bridge. The parsed host/port come from the
  host-tested [`mqtt_uri.hpp`](../main/logic/mqtt_uri.hpp), whose scheme defaults track **esp-mqtt's
  own** (`mqtt://` 1883, `mqtts://` 8883, `ws://` 80, `wss://` 443) so the probe dials the port the
  client will, which keeps a WebSocket broker's URL path (`wss://host:8084/mqtt`) out of the host and
  port while esp-mqtt still receives the full URI, and which rejects a non-digit port or one outside
  1–65535 at parse time (the probe's `htons()` truncates `:65537` to `:1`).
- **✅ Explicit credential clearing** ([`http_config.cpp`](../main/http_config.cpp)): empty
  username+password means *keep the stored credentials* — the modal never prefills them, so a
  broker-only edit never wipes them. Empty therefore can't also mean *remove*, so `clear_creds:true`
  (the MQTT modal's "remove stored credentials" checkbox, gated on `/status.mqtt.has_creds` — whether
  credentials are stored, never their value) is the explicit signal; a non-empty username/password is
  an explicit set and wins over the flag. It is the only path from an authenticated `mqtts://` broker
  to an anonymous one — previously the kept credentials rejected every plaintext broker and only a
  flash erase escaped.
- **✅ Availability (LWT).** A retained `offline` last-will on `<base>/status`, flipped to
  `online` on connect — HA marks every entity unavailable if the device drops.
- **Read-only by design.** No command subscriptions; the bridge only reads the pump.

---

## 6. Diagnostics & observability

A deliberately strong story for a hobby-scale device — everything needed to explain a crash *after
the fact*, from the field, without a serial cable:

- **✅ Core dump to flash (ELF format).** `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH` into a dedicated
  `coredump` partition; ELF is the only core-dump format IDF v6 emits, so nothing selects it
  explicitly. [`diag_crash.cpp`](../main/diag_crash.cpp)
  reads the reset reason + `esp_core_dump_get_summary()` **once at boot** (crashed task/PC/backtrace/
  app-elf-sha), caches it, and never re-parses on a request path. The cheap `coredump` **presence
  flag** is deliberately *not* cached — `diag_crash_info_live()` re-reads it (one 4-byte flash read)
  per request, so a dump erased via `/coredump?clear=1` can't strand a banner advertising a dump that
  is gone. A dump whose parsed `app_elf_sha256` doesn't match the **running** build — an orphan that
  survived an OTA, or one a panic left behind when it couldn't write its own — is **erased at
  capture** (`coredump_is_foreign()`, host-tested), so `coredump` never advertises a download
  `esp-coredump` rejects on a SHA-256 mismatch ([#215](https://github.com/0Bu/daikin-altherma-esp32/issues/215)).
  The erase fires only on **proof** (two shas present, a common prefix, a mismatch within it), since
  erasing a dump that *is* ours would destroy the one artifact a panic left behind.
- **✅ Offline symbolication** ([`decode-coredump.sh`](../scripts/decode-coredump.sh)): `GET /coredump`
  pulls the raw image; the script symbolizes it with `esp-coredump` in the CI-pinned IDF image against
  the matching **unstripped `.elf`** (archived per build/PR by CI). The dump embeds `app_elf_sha256`
  and the device reports the same on `/status`, so a wrong ELF is *caught*, not silently mis-decoded.
- **✅ 🧪 Reset/crash classification** ([`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp)): the
  captured summary becomes the `/status.last_crash` JSON (drives the UI crash banner, whose title keys
  on `fault` — an orphan dump alone never claims the device crashed *this* boot) and a **retained**
  `<base>/crash` MQTT payload (**one** diagnostic HA entity: a "dump waiting" flag —
  reason/backtrace only, **never** the raw dump or any secret; the reset reason is the heartbeat's own
  "Reset Reason" sensor, so the old duplicate "Last Reset Reason" crash entity was dropped + is
  actively retired — its stale retained discovery config is deleted on upgrade). The crash topic is
  **crash-only**:
  `build_crash_mqtt_payload()` emits the JSON only when the boot is *notable* (a real fault **or** a
  core-dump still in flash) and returns `""` otherwise, which the bridge publishes as a **zero-length
  retained** message that **clears** the topic — so a normal boot (USB re-enumeration, config-save/OTA
  reboot, clean power-on) sends no crash message, and a stale crash record disappears from the broker
  (and HA) as soon as the device reboots cleanly, i.e. once the problem is resolved. Clearing loses no
  information — the reset reason is carried unconditionally by the heartbeat's own "Reset Reason"
  sensor (`reset_reason_name` == `crash_reason_slug`, host-asserted). Published per (re)connect and
  republished on the heartbeat cadence when the "dump waiting" flag **or the notability** changes, so
  it can't latch ON after the dump is cleared (and an orphan-dump-only boot is then re-decided
  not-notable and cleared).
  `static_assert`s pin the IDF reset-enum values so a renumbering fails the build rather than
  mislabeling every crash.
- **✅ 🧪 Deleting a crash report (`POST /crash/dismiss`)** ([`diag_crash.cpp`](../main/diag_crash.cpp),
  `CrashInfo::dismissed`): the crash banner's third action, and a *device* action rather than a
  per-page hide — `diag_crash_dismiss()` erases the dump image and then marks the cached `CrashInfo`
  dismissed, so `crash_is_notable()` is false everywhere at once: `/status.last_crash` goes `null`,
  the retained MQTT crash topic clears on the next heartbeat tick, and the banner is gone across
  reloads, browsers and Home Assistant. The old dismiss lived in page state alone and survived exactly
  until the next reload. **Erase first, mark second** — a failed erase answers `500` and marks
  nothing, since a dismissal outliving it would report "no crash" with the dump still downloadable.
  RAM-only by design: after any reboot the reason is no longer a fault and the dump is gone, while a
  *new* crash must show, which a persisted dismissal could suppress. The reset **reason** is
  untouched, so the heartbeat's "Reset Reason" sensor and `/status.sys.reset_reason` still say how the
  board rebooted. Because it destroys the one artifact a bug report needs, the UI asks first (a second
  tap inside the banner) and the route is `POST`, unreachable by a link or a prefetch.
- **✅ 🧪 18-entity device heartbeat** ([`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp)): on a fixed
  10 s cadence, `<base>/heartbeat` streams a **flat** JSON (each field prefixed by its block name —
  `wifi_rssi`, `wifi_mac`, `bus_rx_received`, … — no nested `wifi`/`mqtt`/`bus` sub-objects) of heap
  (free / min-free / **largest-free-block**, the true OOM limit — all three now their own HA entities),
  uptime, the **last reset reason**, WiFi RSSI + reconnect count + the
  STA **MAC** and associated-AP **BSSID**, MQTT publish/fail/reconnect counters, and X10A bus
  rx/fail/crc/timeout stats, and `bus_ou_held_over` — **source** freshness rather than link health:
  the outdoor unit refreshes its own pages only while it runs, so this says *why* the outdoor keys
  vanished from the X10A topic while the bus is up and the device is publishing. Published
  independently of heat-pump profile detection, so board health is visible even while the model is
  still `auto`.
  The last-boot reason rides as **three** renderings of one cached answer: the `reset_reason` slug a
  human reads, `reset_reason_code` (the raw `CrashReason` value — the same number
  `/status.last_crash` publishes as `reason_code`) and `reset_fault` (`1`/`0`). The numbers exist
  because a metrics pipeline keeps numeric fields and drops strings, so the slug alone never became a
  series — a board restarting 55 times in 7 days, 5 of them panics, was unattributable in the store
  and had to be reconstructed from syslog (#215). They are deliberately **not** new HA entities: the
  "Reset Reason" text sensor already answers a human, and a numeric twin beside it is exactly the
  duplicate that got the crash topic's "Last Reset Reason" retired.
- **✅ 🧪 Retiring a diagnostic entity is an operation, not a deletion**
  ([`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp) `RETIRED_HEARTBEAT_SENSORS`,
  [`logic/ha_device.hpp`](../main/logic/ha_device.hpp) `RetiredHaSensor`): a discovery config is
  **retained**, so dropping a row from the sensor table only stops refreshing it — the broker replays
  the old config to Home Assistant forever and the entity lingers as a permanently-`unavailable`
  duplicate. A retired entity is therefore listed, and its config **actively deleted** (zero-length
  retained publish) on every reconnect under the current node id **and** the legacy MAC-derived one.
  Its `uniq_id` is then **burned**: `test_entity_identity()` walks both retired lists and refuses to
  let any live entity claim one back, since it would inherit the dead registry entry instead of
  getting a fresh one. Two heartbeat entities are retired under one rule — an entity that repeats
  what another entity on the same device already says is not a second reading, it is a second thing
  to rule out. **"Device Time"** published the SNTP wall clock every 10 s, which HA renders as "N
  seconds ago" — what its own `last_updated` shows for every entity here without needing a clock —
  at one recorder row every 10 s forever; the never-synced/drifted clock it was meant to catch is
  stated by `/status.ntp` `{server,synced,time}` and by every syslog TIMESTAMP. **"WiFi Quality"**
  published `2*(rssi+100)` beside the "WiFi Signal" sensor carrying that rssi: a deterministic
  function of another entity cannot disagree with it or fail independently of it. Both payload
  fields went with them — a field whose only consumer is gone leaves the duplicate in every
  heartbeat while hiding it from the one place it was visible. The same mechanism retired the crash
  topic's "Last Reset Reason" (`RETIRED_CRASH_SENSORS`), which is why the type is shared.
- **✅ 🧪 Always-on system health** ([`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp)): the
  `/status` document carries a compact `sys` block — `free_heap`,
  `min_free_heap` (since-boot low-water, the leak indicator), `max_alloc` (largest contiguous block,
  the real OOM ceiling), the `reset_reason` slug and a `safe_mode` flag. Unlike `last_crash` it is
  present on **every** boot, and unlike the heartbeat it needs **no broker**, so "why did it reboot?"
  and "is the heap leaking?" are answerable from the LAN alone. `reset_reason_name()` reuses the
  crash slug vocabulary (one naming for the sys block, the `last_crash`/crash payload and the
  heartbeat's "Reset Reason" sensor). The web UI reads three of the block's five fields: `safe_mode`
  (the recovery banner) and — as the two trended rows at the bottom of the Settings ESP32 card
  (entry 42) — `free_heap` and `max_alloc`. Both were removed as **spot numbers** in v1.0.14 and
  came back only once each carried a 24-hour curve, which is the form in which they answer
  something ("is it drifting?") that one figure cannot. `min_free_heap` and `reset_reason` stayed
  out and are read from `/status`, `/diag` and the heartbeat instead — the 24-hour minimum is
  already on the chart, and a reboot's cause is a diagnosis rather than a screen-glance. What the
  card does state beside them is the top-level `uptime_s`, which is not a `sys` field and answers
  the one question this screen otherwise cannot: whether the board restarted at all (the crash
  banner appears only when the reboot was a **fault**, so an OTA, a config save or a power cut
  leave no trace in the UI) — and it is what explains a heap curve that starts mid-chart, since
  both rings are RAM and begin again at a boot.
- **✅ Build identity** — `/status.app_elf_sha256` ties a running device to the exact firmware that
  produced any dump, and the syslog boot line (below) puts the same hash in the **log stream**, so a
  captured stream stays attributable to a binary after the device has moved on.
- **✅ 🧪 Getting the evidence off the board — and what must not come with it.** Everything above is
  useless if a user cannot produce it, and until now the only copy affordance in the whole web UI sat
  inside the crash banner, which never renders unless the device actually crashed: a wrong reading or
  an MQTT dropout, the two commonest reports, had no way in at all. **Settings → *Report a bug***
  collects `/status`, `/values`, `/ota/status` and `/diag` into one pasteable report and opens
  the prefilled issue form ([`REPORTING.md`](REPORTING.md)). It is filed as a *public* issue, which is
  defensible only because the board **redacts first**: [`logic/redact.hpp`](../main/logic/redact.hpp)
  behind `?redact=1` replaces the eight reporter-identifying values (`wifi.ssid`/`ip`/`bssid`/`mac`,
  `mqtt.broker`, `syslog.host`, `ntp.server`, `modbus.host` — the last a LAN address and, when the
  HomeHub was auto-discovered, its resolved IPv4) and scrubs the log lines that interpolate a host, an IP
  or an SSID. In the *firmware*, not in `www/js/app_state.js`, so the collector and the manual `curl` fallback
  cannot become two privacy rules; the value is replaced and the **key kept**, since a dropped field
  is indistinguishable from an older build and triage reads that as a version signal. It **fails
  closed** — a rule whose end token is missing redacts to end of line — and the `CHECK`s pin that a
  **decode witness survives it**: the raw page bytes above are on the same `/diag`, so a future rule
  with a loose marker would clip the evidence and the only symptom would be a witness that quietly
  stopped being one. The one artifact that stays private is a **core dump**: `CAPTURE_DRAM` is off,
  but a password of ≤15 characters lives *inside* its `std::string` by small-string optimisation
  rather than on the heap, so a stack frame holding a config snapshot can carry it — it is never in
  the report, and `/status.last_crash` already gives reason, task, PC and backtrace.
- **✅ In-RAM diag ring** (`GET /diag`) and a **status indicator** ([`status_led.cpp`](../main/status_led.cpp))
  encoding setup-portal / WiFi-connecting / all-healthy / X10A-error / MQTT-error / no-WiFi-mode as
  six distinct blink patterns (X10A-error outranks MQTT-error — the bus is the point of the device),
  plus two the recovery button asserts (reset armed / erasing). Two back-ends — a level-driven GPIO
  LED and an addressable WS2812 over RMT — render **one** host-tested pattern table
  ([`logic/led_pattern.hpp`](../main/logic/led_pattern.hpp)), and the pin, driver and polarity come
  from NVS (`POST /set_board`), not Kconfig: CI publishes a single `esp32s3` image, while a Seeed
  XIAO ESP32-S3 (plain LED, GPIO21, active-low) and an M5Stack AtomS3 Lite (WS2812, GPIO35) disagree
  about their onboard parts, so compiling one in would fork the artifact, the manifest and the OTA
  feed per board. Because a monochrome LED sees no colour, every phase stays distinguishable by
  blink *shape* alone; the colour is a bonus on an RGB board, never the sole carrier of a state.
- **✅ 🧪 Physical recovery button** ([`recovery_button.cpp`](../main/recovery_button.cpp)): held for
  5 s it erases the whole `daik_cfg` NVS namespace and reboots into the setup portal. It is the only
  config reset that does not go through the network, which is exactly the failure the other paths
  cannot reach: the device joined a network the user can no longer get onto. (The credential rollback
  in [`wifi.cpp`](../main/wifi.cpp) covers a *rejected* password — not a wrong-but-accepted LAN.)
  Before this, the cure was opening the enclosure for USB + `erase_flash`. Classification is pure and
  host-tested ([`logic/button.hpp`](../main/logic/button.hpp)): an **arm checkpoint** at 1.5 s lights
  the warning while there is still time to let go, and a debounced release means one bounced sample
  can neither cancel a hold nor silently restart its clock. It is **disabled by default** (`-1`) —
  an unconfigured input floats, and a floating pin reading "pressed" for five seconds would wipe a
  board nobody touched — and a button already held at boot is ignored until the pin reads released
  once. The erase itself is milliseconds, so the indicator leads it and is held to a duration a human
  registers; a **failed** erase deliberately does not reboot, since coming back up on the config it
  just claimed to delete is worse than staying up and logging why.
- **✅ 🧪 SNTP wall clock, runtime-configurable** ([`sntp_time.cpp`](../main/sntp_time.cpp)): before
  this the device had no timestamp anywhere except uptime-since-boot. `esp_netif_sntp` polls the
  configured server (`config().ntp_server` — NVS `ntp_server` override of `CONFIG_DAIKIN_NTP_SERVER`
  default `pool.ntp.org`, editable at runtime via `POST /set_ntp` and the NTP row of the Connections
  tile in Settings, exactly like Syslog) once online — non-blocking, so it idles/retries harmlessly
  even during AP-only setup mode. Once synced, the RFC 3339 UTC instant
  ([`logic/timestamp.hpp`](../main/logic/timestamp.hpp)) reaches the top-level `/status.ntp` block
  (`{server,synced,time}`, mirroring `syslog{}` rather than `sys{}` — it's a runtime-configurable
  service, not a static board fact) and the syslog TIMESTAMP field below; before the first sync of a
  boot both fall back to `null`/`-` rather than a fabricated epoch date. The NTP row shows
  the configured server, coloured `--ok` once synced and `--warn` while syncing (DESIGN.md §5.6,
  the Connections tile) — the synced wall clock itself isn't shown on the row (no room in a
  one-line tile), but remains
  available from `/status.ntp.time` and every syslog TIMESTAMP — and deliberately from no HA entity
  (the "Device Time" sensor is retired: `RETIRED_HEARTBEAT_SENSORS`). An empty
  `/set_ntp` save is read on the next boot as "reset to the compile-time
  default" — unlike Syslog/MQTT, SNTP has no disabled state to preserve, so empty can't mean "off"
  here. The diag ring's uptime prefix is unchanged — it's what `device-triage` keys on to reconstruct
  reboots (an uptime that jumps backwards) and stays available before SNTP has synced, when a
  wall-clock prefix would still be blank.
- **✅ Off-device log forwarding** ([`syslog.cpp`](../main/syslog.cpp)): every diag line is also
  forwarded as one RFC 5424 UDP datagram to an optional collector (`/set_syslog`; empty host = off).
  The TIMESTAMP field is the SNTP wall clock once synced, else the `-` NILVALUE a collector
  conventionally substitutes its own receive time for. Delivery is gated on **DNS only** — the
  ARP/ICMP reachability probe is advisory (`/status.syslog`), since a healthy collector may firewall
  ICMP. Self-loop-guarded (drops its own `syslog:` lines).
- **✅ 🧪 One-shot boot replay to syslog** ([`logic/bootlog.hpp`](../main/logic/bootlog.hpp)): the
  crash summary is captured at the top of `app_main` — before WiFi and before the syslog task exists —
  so it could only ever reach the in-RAM ring, where a chatty failure mode overwrites it within a
  minute. On the **first DNS resolve of a boot** the syslog task replays it once, straight down the
  socket (the queue is full of the boot backlog by then, and the enqueue is non-blocking): a
  build-identity line (`version` / `elf_sha256` / `reset` / `safe_mode`) always, plus the reset reason
  and crashed task/PC/backtrace when the last boot was a fault. Records are **single-line and
  datagram-sized** — the multi-line `build_crash_text()` is ~340 B at worst case and truncates past
  diag's 256-byte line buffer, losing the backtrace tail and `elf_sha256`. Host tests assert the size
  budget and that a clean boot emits **zero** crash lines.

---

## 7. Heat-pump protocol engine (X10A, and the optional HomeHub Modbus link)

Deep dives: [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md), [`REGISTERS.md`](REGISTERS.md), and — for the
optional second source — [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md).

- **✅ Dedicated hardware UART at 9600 8E1** ([`hp_comm.cpp`](../main/hp_comm.cpp)) on `UART_NUM_1`,
  physically separate from the native USB-Serial/JTAG console, so device logs never collide with
  heat-pump traffic. Any two free GPIOs map to it (the RX/TX pin cache in NVS). The driver installs
  **once**; a pin change is a register-only `uart_set_pin` **remap**, not a `uart_driver_delete` +
  `install` (host-tested decision in [`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp)). The old
  reinstall-per-swap allocated a fresh RX ring + driver struct every call, and the detect sweep
  alternates the pins ~2×/s on a silent bus — that alloc/free churn fragmented the heap until an
  unrelated allocation ([`hp_poll.cpp`](../main/hp_poll.cpp)'s value `vector`) threw a `std::bad_alloc`
  too starved to unwind → `std::terminate` → `abort`, **confirmed by a symbolized coredump**.
- **✅ 🧪 Poll engine** ([`hp_poll.cpp`](../main/hp_poll.cpp)): profile registers → query → decode →
  thread-safe value cache the web UI (by polling) and MQTT read. It publishes to no client itself —
  that was the WebSocket broadcaster, and its removal took the `/status` builder off this task.
  The value vector is `reserve`d to its exact upper bound (one sized allocation, not `log2(n)` regrows).
  It is **X10A-only**: the HomeHub is a second, independent stack with its own task and cache
  (`hp_modbus.cpp`), so nothing here branches on a source and this task's 8 KB stack is the one it ran
  on for months.
- **✅ 🧪 Second SOURCE: read-only Modbus TCP to a Daikin HomeHub (EKRHH)**
  ([`hp_modbus.cpp`](../main/hp_modbus.cpp), [`logic/modbus.hpp`](../main/logic/modbus.hpp),
  [`logic/homehub_map.hpp`](../main/logic/homehub_map.hpp), [`def/homehub.hpp`](../main/def/homehub.hpp);
  deep dive [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md)). An **optional second stack beside** the X10A
  tap — **not an alternative to it**. Both run at once, with separate tasks, caches and link states,
  because the two fail for entirely unrelated reasons (X10A at the cable, the pin or the framing;
  Modbus at the LAN, mDNS or the hub) and coupling them would let either failure mask the other: pull
  the service cable and the HomeHub keeps reporting; lose the LAN and X10A keeps polling. It costs
  **nothing when absent** — the task exists only while the configured ADDRESS, which is what let the X10A
  poll task give its 4 KB back after an earlier revision had polled both links from one task.
  A lwIP socket around the host-tested MBAP framing: request-**bound** response parsing (transaction
  id, unit, register count), a whole-reply deadline, and a socket dropped on any framing/desync error
  so the next cycle reconnects. **mDNS auto-discovery** with no user entry: browse `_http._tcp` (what
  the hub advertises) and filter the `homehub-*` hostname — mandatory, because this firmware answers
  that same browse. A failed connect **backs off** through the X10A sweep's own host-tested policy.
  The two sources meet in exactly **one** place: `logic/homehub_map.hpp` pairs a register to an X10A
  row **structurally**, reusing `history.hpp`'s trend ids (`static_assert`ed against them) and never
  the label — the catalog spells one quantity many ways across 43 profiles and reuses tags across
  different quantities, so a label match would be both incomplete and wrong. Six registers pair, and
  all six resolve on all 39 detectable profiles. The UI shows both values with their **difference**,
  and lets Modbus **stand in, marked in its own colour, when X10A is silent**.
  **READ-ONLY BY DESIGN, and that is the point:** the wire *would* allow a write (unlike X10A, which
  has no write command), so the restraint is the firmware's — there is no write function, no MQTT
  subscribe/command topic, no writable HA entity and no HTTP route that can set a pump register. The
  `actuation_enabled` flag is persisted, defaults **false**, and gates nothing today because nothing
  writes. No new ESP-IDF component: the `mdns` and `lwip` ones were already linked.
- **✅ 🧪 Silent-bus detect backoff** ([`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp)):
  while no unit answers, the auto-detect sweep stretches from the 1 s poll cadence toward a 60 s
  ceiling by **skipping sweep ticks** — the poll task's 1 s top-of-loop watchdog reset still fires, so
  any ceiling stays watchdog-safe and the ceiling is a detection-latency choice, not a WDT constraint.
  A bus answer, `POST /detect` or `POST /set_hp` (new pins) resets it to full cadence at once, so a
  just-wired unit is still detected on the next cycle.
- **✅ 🧪 Auto-detection every boot** ([`hp_detect.cpp`](../main/hp_detect.cpp),
  [`logic/detect.hpp`](../main/logic/detect.hpp)): a protocol sweep + page probe builds a bus
  *fingerprint* (page mask + capacity + OU EEPROM) that narrows the Altherma-only signatures to a
  candidate set — **register-equivalent when the capacity is known**, which is the qualifier that
  matters: with the O/U figure absent the set spans kW classes and the members are *not*
  interchangeable. The physical **link** (pins/proto) is cached in NVS; the **model**
  is re-detected in RAM every boot, so a swapped unit is re-identified with no reconfiguration.
  The fingerprint carries **both** capacities — the outdoor unit's own report and the indoor unit's
  rated code — reported separately (`/status.detect.capacity_kw` / `capacity_kw_iu`), since a unit
  with a short `0x00` descriptor reports no outdoor capacity at all and the two halves of a plant are
  routinely different sizes. The indoor code is not only a tie-breaker: when the outdoor figure is
  missing it also **narrows the candidate set** ([#225](https://github.com/0Bu/daikin-altherma-esp32/issues/225)),
  dropping a profile whose kW class *contradicts* it while keeping one that states no class at all —
  so the set reflects the same evidence the representative was ranked by, instead of listing 14–16 kW
  models beside an 8 kW unit. Narrowing is **not** resolving: when the set still spans several
  marketing families the UI names the families and shows the O/U EEPROM digits instead of asserting
  one model.
  The probe gathers the unit's **identity**, not its values, so it is hardened against a single lost
  frame: each page is retried up to `DETECT_PAGE_TRIES` (3) times before its bit is cleared, and a
  sweep that answered but matched *nothing* waits for a second sweep to agree
  (`detect_commit_no_match`) before the unit is read with `generic`. Both matter because
  `signature_consistent` matches on page **subset** — measured over the shipped signatures, all 12
  single-page losses on a live fingerprint change the answer and 8 leave no candidate at all, and
  `generic` carries 53 rows against ~99 with no leaving-water measurement, no compressor speed and
  no pressures. An all-zero payload still sets its page bit on purpose: zeros mean the *feature* is
  absent, not the *page*, and that is [`logic/availability.hpp`](../main/logic/availability.hpp)'s
  question. Nothing here is persisted — the model is still re-derived every boot.
- **✅ 🧪 Value converters** ([`logic/convert.hpp`](../main/logic/convert.hpp) + 44 generated
  [`def/`](../main/def) profiles): the converter-id decides how each raw register field becomes a typed,
  unit-carrying value — the riskiest part of the port, and the most heavily host-tested.

---

## 8. The host-tested pure-logic core (the quality backbone)

The single most distinctive engineering choice: **all the risky, target-independent logic lives in
IDF-free headers under [`main/logic/`](../main/logic) and is verified on the host** — no board, no
Docker, in seconds ([`test/README.md`](../test/README.md), [`ARCHITECTURE.md` → logic core](ARCHITECTURE.md)).

- **🧪 What's covered** — CRC & framing (`crc.hpp`), value converters (`convert.hpp`), register
  extraction (`registers.hpp`), the `ValueDef` profile-row type the generated `def/*` tables are
  written in (`value_def.hpp`), the config model/validation + the field-owned detection patches
  (`config_model.hpp` — `apply_link`/`apply_model` touch only the link / model, so a detection commit
  cannot revert a concurrent `/set_wifi`), HA-discovery payloads
  (`discovery.hpp`) and the HA **source-device identities** (`ha_device.hpp` — X10A uses the slugified
  MQTT base topic and Modbus its `_modbus` derivative, so replacing the board keeps both groups
  instead of duplicating them), detection (`detect.hpp`), the OTA health gate (`health_gate.hpp`), heartbeat &
  crash formatting (`heartbeat.hpp`, `crashinfo.hpp`), the syslog boot/crash replay records
  (`bootlog.hpp`), the syslog hard-vs-transient send-error policy (`syslog_policy.hpp`), the
  gateway-watchdog policy (`link_watch.hpp`), the WiFi credential-rollback policy
  (`wifi_rollback.hpp`), the reset-reason vocabulary (`reset_reason.hpp`),
  the boot-loop safe-mode decision (`boot_guard.hpp`), grouped state JSON (`mqtt_group.hpp`), the
  RFC 8259 JSON string encoder every payload shares (`json.hpp` — escapes `"`, `\` and every control
  byte, so an SSID from any AP in radio range can't emit JSON the setup portal fails to parse), the
  broker-URI split (`mqtt_uri.hpp`), the X10A GPIOs the RX/TX picker may offer
  (`board_pins.hpp` — the ESP32-S3 chip-safe set, minus GPIO33-37 on Octal flash/PSRAM builds and
  minus the pins the firmware itself drives (`ReservedPins`: the status indicator **and** the
  recovery button), since chip-safe is not the same as free: `status_led.cpp` holds its pin as a
  push-pull output and `recovery_button.cpp` holds its own as a pulled input, so offering either
  would be a pick that cannot work — and
  `board_pin_offerable()` makes that list a *rule* rather than a dropdown filter, enforced on the
  request path (`validate()`, naming the offending pin) and on the load path (`config_load()` via
  `link_pins_safe()`), so neither a raw `POST /set_hp` nor a stale NVS link cache can route the X10A
  UART onto a flash/strapping/JTAG pad and crash-loop the board; the *different* local-I/O set
  (`board_pin_local_io()`) is what the indicator and button themselves may use — wider by the
  four dedicated-JTAG pads, withheld from the X10A list only to keep a debug probe usable, which is
  a preference an onboard part soldered to GPIO41 simply overrides, and **narrower** by the X10A
  link's own `rx`/`tx`, because the reservation runs in **both** directions: `board_hw_valid()`
  refuses a local pin that equals either link pin, so a picker still listing them offers a choice
  whose only outcome is a `400`. `ReservedPins` is deliberately anonymous about which pair it carries
  (`pin_a`/`pin_b`) — naming its fields after one direction made the other read as a lie — and the
  two factories `config_reserved_pins()` / `config_link_pins()` state the direction at the call site),
  the ready-made per-board settings behind the Hardware modal's *Board* pick
  (`board_presets.hpp` — the five board-local fields for each **documented** board, served as
  `/status.board.presets`; in firmware rather than in `www/js/settings.js` precisely so these `CHECK`s can
  assert every offered preset passes the same `board_hw_valid()` the request path applies, and so a
  preset this **build** reserves (an Octal build over the AtomS3 Lite's GPIO35) or this **config**
  reserves (a link moved onto that preset's LED or button pin) is withheld instead of offered as a
  pick `POST /set_board` would refuse — it asserts nothing about which board this *is*, which stays
  unknowable), and whether the user has **stated** that hardware at all (`Config::board_user_set`,
  NVS key `board_set`, served as `/status.board.user_set`) — which is a different question from the
  unknowable one above and the only one a device can answer: the five stored values cannot
  distinguish a XIAO owner's deliberate save from a board nobody has configured, because the Kconfig
  defaults *equal* the XIAO preset, so the Hardware modal names the board only once someone has said
  so. It is also what splits the route's two obligations — the five values decide the **reboot**
  (both parts are claimed once at task start), the statement decides only a **save**, so picking the
  preset a device already carries persists something while restarting nothing
  (`board_save_needed()` / `board_reboot_needed()`, both host-tested),
  the status indicator's state→pattern rule and the button override's priority
  (`led_pattern.hpp` — shared by the GPIO and WS2812 back-ends so they cannot drift apart; *shape*,
  not colour, carries the state, since a monochrome LED sees no colour at all),
  the recovery button's press classifier (`button.hpp` — the tested half is the **abort** path: the
  action it gates erases the user's whole configuration, so "held 4.9 s then let go" must destroy
  nothing and one bounced sample must not read as a release),
  request-body reassembly
  (`http_body.hpp` — a body arrives across as many TCP segments as the network chooses, and a peer
  that stalls forever must lose *bounded*),
  the captive-portal reply policy (`captive.hpp` — whether the `/*` catch-all answers an unmatched
  GET with the page or a `302` to the portal. The tested half is the **STA carve-out**: in setup
  mode the OS connectivity probes must get the redirect all three agents act on, but in STA mode the
  same route is the dashboard's SPA shell and must not redirect — and of those two regressions only
  the first gets reported, so the second is exactly the kind that needs a `CHECK`. It also pins the
  portal address to one literal, since a redirect to a host the captive DNS does not answer for is a
  dead end nothing on the device would notice),
  the X10A UART (re)init decision (`uart_plan.hpp` — probing the same pins is a no-op and a pin change
  is a register-only remap, not a driver reinstall, so the detect sweep stops churning the heap),
  the silent-bus detect backoff (`detect_backoff.hpp` — full cadence through a grace window, then
  geometric growth clamped to the ceiling, monotonic and overflow-safe, reset the instant the bus answers),
  the English description lookup layered on the conv-204 fault code
  (`error_codes.hpp` — a presentation-only enrichment: it never changes what conv 204 decodes,
  and a code outside its coverage still publishes as the bare code),
  **🔭 Modbus TCP framing + HomeHub register codecs** (`modbus.hpp` — MBAP
  framing without CRC, FC03/04/06/16 build + **request-bound** parse (an exception PDU must be exactly
  2 bytes, a read reply must carry the requested register quantity, and a write echo must match the
  requested address + value/quantity), `Temp16`/`Pow16`/`Int16`/`Text16` decode/encode,
  the `homehub-*` mDNS filter; the host-tested core for the *planned* firmware-exclusive HomeHub
  Modbus link (issue #32), **not yet wired into the firmware**), and the SNTP wall-clock RFC 3339
  formatter (`timestamp.hpp` — the one place the syslog TIMESTAMP field and `/status.ntp.time`
  render through; a negative/never-synced input renders `""`, never a
  fabricated `1970-01-01`), the **OTA downgrade gate** (`version_cmp.hpp` — numeric dotted-version
  ordering plus `ota_is_upgrade()`, which fails closed on anything it can't parse, and exact
  manifest↔image artifact binding) and the **OTA manifest parser** (`ota_manifest.hpp` — the one
  place a remote, attacker-influencable byte stream is
  parsed on this device: bounded, allocation-free, depth-aware, escape-aware, and it refuses rather
  than truncates an oversized value), the **HTTP trust-surface boundary** (`http_surface.hpp` — which
  routes each surface exposes, so the open setup AP serves only the provisioning routes while
  `/coredump`, `/diag` and the config/OTA/MCP surface stay trusted-LAN-only), the **atomic config
  save** (`config_store.hpp` — the credential/service fields are one CRC-checked NVS blob so a save is
  all-or-nothing across a write failure or a power cut), the complete **MCP/JSON-RPC 2.0 core**
  (`mcp.hpp` — bounded/depth-aware scanner, exact id echo, revision negotiation, read-only
  method/tool dispatch, parse/invalid-request/method-or-tool-not-found/invalid-params errors, and
  notification handling) and the **query-flag policy** (`query_flag.hpp` — a `?clear=1`-style flag
  acts only on exactly `1`, so `?clear=0` no longer wipes the diag log), and the **leaving-water
  measurement picker** (`lwt_select.hpp` — the host-testable twin of the web UI's `lwtRow`/`vLwt`,
  through which *every* browser consumer resolves — the schematic pill, the derived figures and the
  inspector's leaving-water rows alike, so a looser second copy cannot re-open the substitution
  outside the gate's reach: the row
  that feeds the dashboard's ΔT / heat output / COP must be the pre-BUH heat-exchanger outlet (R1T)
  and never a setpoint / mixed-zone / post-BUH (R2T) row — a setpoint substituted for a measurement
  makes all three plausibly wrong, issue #121, the #35–#39 failure shape; keyed on the (R1T) tag so
  the alias label forms resolve too, and gated catalog-wide so every detectable profile selects a
  real measurement), the **held-over outdoor reading rule** (`ou_stale.hpp` — the other host-testable
  twin of a browser rule: the outdoor unit refreshes its *own* register pages (`0x20` sensors, `0x21`
  inverter) only while it runs, and stopped it answers with the last run's values, so the schematic
  stops drawing them as live — measured, outdoor air held
  exactly 19.0 °C for five hours and stepped only when the compressor started. Page `0x10` is
  deliberately excluded: it carries `Defrost Operation`, a run-state input, and blanking a reading
  costs information where suppressing a state input would corrupt the state machine. Gated
  catalog-wide, and the load-bearing half is the second assertion — every profile keeps
  `INV frequency (rps)` on a page that stays live, which is what makes "Standby — not running"
  trustworthy beside the held ones. **How** they stop being drawn as live is one rule for every
  quantity: the pill blanks to "—", the same answer the drawing gives on a dead bus, so nothing on
  screen has to be read as half-valid. That covers held *measurements* (outdoor air, discharge) and
  held *working points* alike — ΔT with no flow **and the heat output computed from it**, which is
  the one case where the number being replaced was arithmetically *true* (flow × ΔT at zero flow
  really is 0.0 kW) and so read as a measured plant output rather than as the absence of one:
  measured beside a DHW tank climbing at ~2.7 kW on its immersion heater, which sits inside the tank
  past the flow sensor and both leaving-water sensors, so no row on this bus can state its power.
  Only the live pill is gated; the 24-hour curve keeps its flat zero, where that is the honest shape
  of a day that delivered nothing and a gap would be indistinguishable from missing data. Then the
  **electrical estimate**, which prefers the CT clamps on the live
  hydronic page `0x63` and falls back to
  `INV primary current`, a `0x21` row that freezes with the rest of that page. Every catalog profile
  carries the INV row and only about half carry CT clamps, and an idle plant reads a CT sum of 0 — so
  an ungated fallback drew the last run's amps as a live kW figure on most installs most of the time,
  and a stopped compressor draws ~0, not the 1.4 kW the frozen current implies.
  The catalog test pins which page each of the two sources sits on; the pill then blanks with no
  sub-label (the drawing's one vocabulary for "no reading right now") and the inspector explains
  which of the two states it is — never the "no current sensor" caption, since suppressing one wrong
  claim must not substitute another. The **inspector obeys the same rule** rather than merely
  explaining it: it read every row straight off `/values`, so tapping a blanked pill printed the
  held-over number back as its headline — the withheld value restated one line under the picture that
  had just refused it. Its gate is the row's **register page**, which `/values` carries as `reg`, so
  it applies `ou_page_holds_over()` itself instead of a label list that would be a second, drifting
  copy of a rule gated here in C++; a held headline replaces the entry's state sentence with the
  reason it is blank), the **COP boundary rule** (`cop_scope.hpp` — *which* COP the dashboard's
  quotient describes, and when it is none. The pill divides a heat figure by an electrical one and
  the two picks need not describe the same **system**: a quotient of two correct numbers taken across
  two boundaries is not a worse COP, it is a different quantity under the same name. The CT clamps
  (`0x63`) see the whole unit including the backup heater; `INV primary current` (`0x21`) sees the
  compressor alone; the heat side is `lwt_select`'s pre-BUH outlet, i.e. heat-pump heat with the
  resistive heater deliberately uncredited. INV therefore pairs correctly — the heater sits outside
  *both* sides and cannot unbalance them — while CT does not: the heater's kilowatts land in the
  divisor while its heat never reaches the dividend, so the quotient collapses exactly when the heater
  runs and reads as a failing heat pump while nothing is wrong. The fix moves the **numerator**, not
  the denominator: a whole-unit divisor takes the post-BUH (R2T) outlet, the same pairing
  [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md#both-sides-must-describe-the-same-system)'s heat-meter
  recipe makes for an external meter. Where no honest pairing exists — whole-unit current, heater
  firing, no post-BUH row — it publishes nothing, `feature_gate.hpp`'s rule. The plant has **two**
  resistive heaters and they are not the same problem, hence two block codes: the **BUH** sits in the
  space-heating flow between R1T and R2T, so its heat crosses the water circuit and moving the
  numerator downstream re-pairs the boundaries — while the **BSH**, the immersion heater inside the
  DHW tank, heats tank water directly, downstream of the flow sensor and of *both* leaving-water
  sensors. Its kilowatts enter a whole-unit divisor while its heat crosses neither, so no row in the
  profile would re-pair them: unfixable rather than merely unfixed, blocked whatever the R2T row says,
  and named in the UI as the different fact it is (the profile is not missing a reading — the bus has
  none that would serve). It bites exactly where the rule is aimed: all 21 CT-clamp profiles carry a
  BSH row, the heater can run with compressor, pump and flow at zero, and the catalog test asserts
  that CT implies BSH so the block can never depend on an input a profile cannot supply. **Unknown** heater state
  is not *off*: off is the permissive branch here, so guessing it is precisely what would ship the
  collapsed quotient, the mirror of `ou_stale`'s "unknown rps is not stopped" — and measured, the
  strictness costs nothing, since 43 of the 44 profile tables carry `BUH Step1/2`, all 44 carry a
  post-BUH row, and the BUH rows sit on page `0x60`, which stays live while the outdoor unit sleeps.
  The post-BUH picker takes the row's **page**, not its label alone, because the catalog reuses the
  tag: `(R2T)` names the leaving-water outlet on `0x61/4` *and* `Discharge pipe temp.(R2T)` on
  `0x20/4` — same offset, same converter 105, 14 profiles. The water tokens happen to separate those
  two today, but that is how one row was spelled, not a property of the data; the page carries the
  guarantee the tokens cannot, since a row on a page the outdoor unit stops refreshing is a held-over
  reading whatever it is called. Gated catalog-wide: exactly one post-BUH row per profile, always on a
  live page, never the row `lwt_select` already picked), the **24-hour trend rules** (`history.hpp` — which rows carry a trend, when a
  stored sample is a measurement rather than a repeat of one, and the ring itself. A trend addresses
  its row by **(page, offset, unit)** and never by a label token, because the catalog neither names
  one quantity consistently nor names different quantities differently: `(R1T)` is both the outdoor
  air inlet on `0x20` and the indoor leaving-water sensor `lwt_select` keys on by that very tag, and
  `0x20/12` carries a bar reading and its saturation-°C twin in the same byte window — either
  ambiguity drawn as a 24-hour chart is the #35–#39 shape with a history in front of it. Two rules
  are consequences of addressing a row that way rather than conditions on it, and are asserted over
  the catalog instead of re-checked per sample: a trend cannot resolve to a **setpoint** (targets sit
  at their own offsets), and the held-over page class is the locator's own `reg`, so there is no
  second page field to drift from it. `history_store` **composes** `ou_reading_held_over` rather than
  restating it, so a change to which pages freeze reaches the trends automatically; that is what
  keeps a mild day's outdoor-air trend from filling with a staircase of last-run values. The **ring**
  lives here rather than in `history.cpp` because bucket folding, wrap-around and skipped-bucket
  filling are exactly the off-by-one that surfaces as a subtly wrong chart weeks later, and a rule in
  a `.cpp` can only be verified on the device — skipped buckets are *filled* (`history_skipped()`),
  never compressed, since compressing them slides every earlier sample forward in time and mislabels
  the whole curve, and that count is an off-by-one with no visible symptom. The
  value parse is here for the same reason: legacy/corrupt nonnumeric text must not be accepted as
  zero by `strtof` and drawn as a confident 0.0 line — its exactness is pinned by a round-trip over
  every 0.1 step across `reading_plausible()`'s own ±200 °C window. And `history_pin_index()`, which
  re-resolves a **pinned** readout after the ring has rolled: anchored to the sample's instant, never
  its index, and DROPPED rather than clamped once that instant leaves the day — clamping would keep a
  bubble on screen while silently changing which moment it describes. Its reference point is
  `history_t0()`, whose asserted property is INVARIANCE rather than a formula: the same newest sample
  must yield the same `t0` however long after the last bucket commit the request arrives, because the
  drift in the obvious form is what let that pinned bubble slide onto its neighbour), and the **raw-page hex rendering** (`hexdump.hpp` — the wire bytes of pages
  `0x00`/`0x10`/`0x20`/`0xA0`/`0xA1` on `/diag`; truncation stops after the last *complete* byte, since a trailing
  nibble would read as a different value, and degenerate inputs still terminate the buffer the caller
  hands to a `diag_printf` `%s`).
  the **availability ledger** (`availability.hpp` — the adjudicated per-row verdicts of #209,
  asserted against all 45 catalog profiles: that the rule selects the quantity it was adjudicated
  for, that no core hydronic row is ever touched, that page `0x10` is still queried, and that a
  legitimate 0 °C reading on any other row still publishes),
  the **converter adjudication** (`conv_override.hpp` — #194's `0x10/6` conv `114` → `109`, pinned
  against all **54** wire integers the row has been observed to carry, each asserted to land on the
  0.1 K grid and re-encode to the very byte pair that came off the bus; plus the catalog tripwire
  that exactly 44 profiles still carry `(0x10, 6, 114)`, so the day the generator emits `109` the
  override becomes a keyed no-op and the count fails rather than leaving dead code),
  the **label adjudication** (`label_override.hpp` — #230 A's `0x30/1` conv 211
  *"Fan 1 (10 rpm)"* → *"Fan 1 (step)"*, the sibling of the converter adjudication for the row's
  identity word: `effective_label` keyed match, the corrected row publishing as
  `actuators_fan_1_step`, and the same tripwire — exactly **4** profiles still carry the raw
  *"Fan 1 (10 rpm)"*, so the day the generator emits *"Fan 1 (step)"* the count fails rather than
  leaving dead code),
  the **published-type contract** (`convert.hpp`'s `published_kind` — every implemented converter
  swept over every input byte, failing if any produces text in one state and a number in another),
  the **numeric fault flags** (`fault_state.hpp` — round-tripped against conv 203's own output, plus
  the `00 → U4 → 00` replay #209 asks for, asserting the textual code keeps its type while the flag
  moves `0 → 1 → 0`), the **run-time raw-capture cadence** (`raw_capture.hpp` — the edge, the period
  and the per-boot budget, whose failure modes are invisible on a board until the log is ruined),
  the **diagnostic-snapshot redaction** (`redact.hpp` — which log lines leak a host/IP/SSID and how
  the substitution fails *closed* when a truncated line never reaches its end token; the same tests
  pin that a raw-page hex line passes through untouched, so the privacy rule cannot silently clip the
  decode witness the rule above exists to deliver),
  the **rolling X10A operating observation** (`checkup.hpp` — compressor/defrost edges across
  unknown samples, hourly boundaries and poll gaps; 23 completed buckets plus the pending hour;
  per-signal evidence clocks and the full-span + 90% clear gate; the 60-second flow run-up;
  independent BUH/BSH evidence; strict per-counter retry deltas including run-state boundaries but
  excluding decreases from no-event evidence; the documented >1 bar pressure boundary; stable wire
  ids/verdicts; and a production-equivalent, converter-adjudicated catalog sweep proving each
  `(page, offset, converter)` locator resolves to exactly one right row),
  **2204 `CHECK`s** in
  [`test/test_logic.cpp`](../test/test_logic.cpp) — the three counts in this file are one number and
  drift together, so re-derive them rather than adjust one:
  `grep -o 'CHECK(' test/test_logic.cpp | wc -l` minus the macro's own definition line.
- **The fast loop** — [`scripts/run-mock-tests.sh`](../scripts/run-mock-tests.sh) compiles + runs the
  suite with the plain system toolchain (`g++`/`clang++`, one translation unit). CI additionally
  enables gcov instrumentation and enforces at least 95% aggregate executable-line coverage over
  `main/logic/` itself — never the test driver or generated profiles — with a selftest that proves
  an empty report and a below-floor report fail closed. This is the real "run it and see" loop even
  in an environment that can't build firmware or USB-flash.
- **🧪 Metric identity is frozen** — a published row reaches VictoriaMetrics as
  `daikin_altherma_<group>_<object_id>` and Home Assistant as an entity keyed on the same slug, both
  derived from the row's **label**. Editing a label is therefore not cosmetic: it retires one series
  and starts another at zero, with no error anywhere. `test_metric_identity()` freezes the complete
  set of **163** distinct `<group>_<object_id>` identifiers the catalog produces, so a rename, a
  dropped row or a change to `ha_slug()` itself fails the suite and prints which identifier moved.
  Built because the hazard already fired: `f1a5e69` (#139) renamed *"Expansion valve 3 (pls)"* to
  *"… [OU-II]"* across 19 profiles, and the store shows the old series stopping 5.8 days before the
  new one starts. Regenerating the list is the **decision**, not the fix (#217). Since #221 the same
  block also ties the two surfaces together — every published row's HA entity id must be in that
  frozen list, so a label edit moves the entity and the series together or neither — and pins
  `AMBIGUOUS_LABEL_SLUGS` as exactly the set of labels the catalog reuses across pages, so a sixth
  cannot appear unnoticed. Both the frozen set and its assertion resolve through `adjudicated()`, so
  a label override (above) moves the frozen id together with the series it names.
- **🧪 …and which identifiers a detection TIE-BREAK can move** — the question the frozen set above
  leaves open, and the one a device owner actually has: does *this* unit still publish the identifiers
  it published yesterday? Detection picks one representative, so where the ranking **ties** the pick
  decides the labels, hence the entity ids and the series. The gate above cannot
  fail on that *by construction*: both spellings are already in its frozen set, so a flip introduces
  no new identifier and the suite stays green while the device's own series changes underneath it.
  Measured over the detectable catalog: **12** equivalence classes exist and — since #230 A's fan
  step was closed by `label_override.hpp` — **5** still disagree about what they publish, so
  `test_tie_break_identity()` freezes exactly the **34** identifiers a tie-break can move (the fan
  class is now identifier-equivalent, so neither fan id is among them). Not all are defects — three
  classes are one sensor named by two product *families*
  (`[HPSU] Tv inflow Temp  (R1T)` vs `Leaving water temp. before BUH (R1T)`), which
  [`REGISTERS.md`](REGISTERS.md) says to expect — and the sharpest case is not a rename at all: the
  non-hybrid `altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw` marks the page-`0x64` boiler rows
  `no_publish` while its two register-equivalent neighbours publish them, so the tie-break decides
  whether **eight** `hybrid_*` entities exist on that unit. `no_publish` is therefore deliberately
  *not* part of the equivalence key: it is not a wire fact, and folding it in would split that class
  and hide the strongest case the test has
  ([#230](https://github.com/0Bu/daikin-altherma-esp32/issues/230)).
- **🧪 …and the tie-break can no longer be moved by the order of a file** (#230 B) — the criterion was
  *"first in signature order"*, i.e. the order the tables happen to sit in `def/registry.hpp`. A label
  is an identifier, so that let adding, removing or merely **reordering** a profile silently reassign
  published series: measured at **11275** moved publications over 200 registry permutations × 336
  fingerprints, across **64** distinct identifiers. Criterion (4) is now the **lowest profile id**,
  which is intrinsic to the profile, and `test_tie_break_order_independence()` asserts the property by
  permuting the registry and requiring the same pick. Adopting it moved **nothing** — 0 of the 336
  fingerprints re-label anything, the live reference unit included — so unlike #230 A it needed no
  series migration. It is deliberately **not** a better guess: preferring the majority spelling would
  assert a model the bus cannot evidence, and two alternatives were measured and rejected
  (fewest-identifiers moves 13 ids on 8 fingerprints for no evidentiary gain; exact-page-mask changes
  nothing at all, an inert rule that would read like a guarantee). The residue is **bounded, not
  solved**: `test_tie_break_reach()` freezes the **64** identifiers a tie-break can still decide on a
  fingerprint a real unit can present, and neither that set nor the **34** above contains the other —
  the tie is on the page *count* and the class *span*, both coarser than register-equivalence, so 32
  reachable ids sit outside the equivalence set while 2 equivalence-only ids are unreachable because a
  tighter kW class always wins first. The same measurement retired a claim this catalog and
  [`ARCHITECTURE.md`](ARCHITECTURE.md) both used to make — that tied candidates are register-identical
  so *"the decoded VALUES are identical"*: **98** of **152** ties are between profiles whose row
  multisets differ, by up to **8** rows.
- **The rule** — new decode/config/discovery logic goes in `main/logic/` with a `CHECK`, never buried in
  a device-only `.cpp`. The [`add-logic-test`](../.claude/skills/add-logic-test/SKILL.md) skill and the
  [`x10a-decode-reviewer`](../.claude/agents/x10a-decode-reviewer.md) agent enforce it.
- **✅ The limit of the above — and the second loop that covers it.** The `CHECK`s verify the logic
  they are handed; none of them can see a value that is well-formed, compiles, drifts no doc, and is
  *physically false*. A wrong converter id published `-971.5 °C` as a mixed-water temperature on eight
  profiles, a valve **position** reached Home Assistant as a 12800 °C temperature sensor, and a "no
  data" sentinel was published as a real `-3276.8 °C` reading (issues #35–#39) — all green, all
  shipped, all found only by slow manual review. So the value catalog has its own host loop:
  [`scripts/run-domain-audit.sh`](../scripts/run-domain-audit.sh) runs the **real** converters over the
  **real** `def/*` catalog and cross-checks both against [`REGISTERS.md` §5](REGISTERS.md) — one source
  of truth, nothing to drift. It reports wrong converters, spec/layout drift, cross-profile outliers,
  non-temperatures typed °C, straddling byte windows, and — since #230 — **one wire field described by
  two different physical units** (`LABEL-UNIT`), each with a decode witness (wire bytes → what
  the value should read → what the row makes of it). That last check is the only one whose subject is
  the **label**, because a label is an identifier: page `0x30`/1 (conv 211) reads *"Fan 1 (step)"* on 22
  profiles and *"Fan 1 (10 rpm)"* on four, at the same offset with the same converter and width, so a
  reader of `actuators_fan_1_10_rpm` takes a `30` for 300 rpm rather than step 30 — while `SPEC-CONV`
  matches *by* label and misses it, `SPEC-LAYOUT` sees a conforming layout, `CONSENSUS` groups *by*
  label so the two spellings never meet, and the frozen identifier set already contains both. #230 A
  is now **fixed** by `label_override.hpp`, which republishes those four rows as *"Fan 1 (step)"*; the
  audit resolves the **published** (adjudicated) label at row collection, so `LABEL-UNIT` judges what
  the device actually announces and no longer fires on them (the converter checks stay on the raw
  generated `conv`, whose intrinsic semantics are their subject). It
  compares the **unit alone**, never the rest of the label: the catalog legitimately spells one
  quantity several ways per family, so a text check would demand prose the source data does not have.
  [`tools/domain/selftest.sh`](../tools/domain/selftest.sh) re-introduces every defect the gate was
  built for — the four shipped decode bugs plus #230's mislabelled fan step — into a
  throwaway copy and requires the audit to catch each, so a checker that has quietly stopped checking
  cannot pass as "clean". Adjudicated deviations live in
  [`audit_exceptions.txt`](../tools/domain/audit_exceptions.txt) and stay visible in the audit's
  `suppressed` output. The judgement half is the
  [`domain-review`](../.claude/skills/domain-review/SKILL.md) skill, a PR-merge gate required on every
  merge.
- **🧩 One row view, four consumers** ([`logic/profile_view.hpp`](../main/logic/profile_view.hpp), [`def/overlay.hpp`](../main/def/overlay.hpp)). The rows a model publishes are the
  generated `def/*` table **plus** the temporary hand-written `def/overlay.hpp` supplement (the
  page-`0x10` protection words the offline generator does not emit yet — see
  [ARCHITECTURE.md](ARCHITECTURE.md) *Value-definition profiles*), presented as one indexable
  sequence. It is one view rather than four merges because the consumers are coupled: `hp_poll`
  decodes the rows, `mqtt_ha` announces one HA discovery config per row, and **both** `http_status`
  and `mqtt_ha` size their snapshot buffer from the row **count**. A consumer reading a shorter row
  set than the cache holds would silently truncate values out of `/values` and MQTT — an absent-value
  bug with no error anywhere. The **overlay rule** (a supplement applies only if the base profile
  already references its page) is what makes a hand-written block safe beside generated tables: it
  cannot set a page bit that was not already set, so it cannot move detection and cannot add a bus
  round-trip. The supplement's rows are audited by the domain gate exactly like generated ones.
- **🚦 Disable, never degrade** ([`logic/feature_gate.hpp`](../main/logic/feature_gate.hpp)). Which derived features may honestly run on the
  detected model, decided from the **rows** rather than from the profile id, and the answer when the
  signals are missing: off. It is the fourth instance of a rule the UI already applies three times —
  `lwt_select` blanks ΔT/heat/COP rather than substituting a setpoint, `ou_stale` blanks a held-over
  reading rather than showing a dimmer register of half-valid numbers, `cop_scope` blanks the
  quotient rather than pairing two boundaries that do not match. Reading coverage off the rows
  is what makes it correct: the `generic` fallback is the obvious starved case, but sixteen of the 43
  *detectable* profiles also lack register page `0x30` and with it the compressor run-state input, so
  an id check on `"generic"` would have let a decision layer run without run-state on more than a
  third of the detected catalog. Groundwork for the on-device optimizer epic (#69); no firmware
  caller yet, pure so the policy is asserted rather than re-argued at the future call site.

---

## 9. Build system & release engineering

- **✅ Deterministic toolchain.** There is no local ESP-IDF install:
  [`idf-docker.sh`](../scripts/idf-docker.sh) runs every build in the `espressif/idf` image, its version
  **read at runtime from [`.github/workflows/build.yml`](../.github/workflows/build.yml)** — a single
  source of truth (currently ESP-IDF v6.0.2, kept current by Renovate), so local builds can never drift
  from CI. One reader backs that claim: [`idf-version.sh`](../scripts/idf-version.sh) is the only shell
  extraction of the pin, shared by the local image selection and by CI's ccache key, and it exits
  non-zero rather than printing an empty version — a second copy of the grep is how one of them
  quietly stops matching after the field moves, and this one would fail *silently in the worst
  direction* (a toolchain bump served the previous toolchain's cached objects).
- **✅ A pinned warning contract on `main/`.** Three places in that component are written the way they
  are *because* a warning class is fatal there — the `[[nodiscard]]` on the NVS setters
  ([`nvs_storage.hpp`](../main/nvs_storage.hpp)), an unreachable `return false`
  ([`hp_comm.cpp`](../main/hp_comm.cpp)), and the `static_cast<int>(ms)` on a `%d` argument
  ([`logic/timestamp.hpp`](../main/logic/timestamp.hpp)) — and until now nothing in the repo made that
  true. [`main/CMakeLists.txt`](../main/CMakeLists.txt) pins `-Werror=return-type`, `-Werror=format`
  and `-Werror=unused-result` via `target_compile_options(… PRIVATE)`. The `unused-result` one is the
  sharpest: a dropped NVS write is *silent* (a full partition, a worn flash), and exactly one of them
  left safe mode unable to latch its crash counter — an attribute only bites if the ignored result is
  an **error**, not a warning scrolling past in a 5-minute build log. The `format` one covers the 124
  `diag_printf` call sites in the component (the function carries
  `__attribute__((format(printf, 1, 2)))`) and is the *only* thing that can catch the timestamp case:
  `int32_t` is `long int` on the xtensa toolchain and plain `int` on the host, so the mismatch is
  invisible to [`run-mock-tests.sh`](../scripts/run-mock-tests.sh). All three were **inherited** before
  this — they held only while ESP-IDF's own defaults made them fatal, and IDF's `-Werror` handling is
  version- *and* Kconfig-dependent (`COMPILER_DISABLE_DEFAULT_ERRORS` rewrites `-Werror` to
  `-Werror=all`), so a toolchain bump could have retired them with nothing here to notice. Scoped to
  this component rather than set as a `CONFIG_COMPILER_*` key for two independent reasons: a Kconfig
  key is global, so it would hold ESP-IDF itself and the managed components to a contract that is not
  ours to demand; and `sdkconfig.defaults` is hashed into CI's ccache key, so a diagnostic-only change
  there would discard every cached object it cannot possibly invalidate. Costs no CI minute — the
  firmware `build` job is already the only compile of `main/*.cpp`. `-Wall` is left out because IDF
  already passes it and restating it would read as ownership while changing nothing; `-Wextra` because
  IDF suppresses `-Wunused-parameter` globally and this component's mandated-signature IDF callbacks
  would fill the log with warnings nobody can act on.
- **🔭 No generic static-analyser gate — measured, not assumed.** Deliberately absent, and recorded
  here so it is not re-litigated from scratch. clang-tidy over [`main/logic/`](../main/logic) +
  [`main/def/`](../main/def): a blanket config reports **~7000** findings, **3622** of them this
  project's own `CHECK` macro (1802 `cppcoreguidelines-avoid-do-while` + 1820 `pro-type-vararg`).
  Curated to bug-finding checks only it reports **~50 with zero real defects** — the three plausible
  ones flag deliberate, documented code: [`logic/history.hpp`](../main/logic/history.hpp)'s explicit
  `int16` clamp (whose comment explains why it clamps rather than wraps),
  [`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp)'s `if (s[i] == '-' && ++i == s.size())` (well
  defined — `&&` sequences), and a [`logic/profile_view.hpp`](../main/logic/profile_view.hpp) reference
  return reachable only by violating the documented `count()` bound. `clang-analyzer-*`: 2, both false.
  `performance-unnecessary-value-param`: **0**. `-Wconversion`: 3, all
  [`logic/config_store.hpp`](../main/logic/config_store.hpp) byte-packing that already masks with
  `& 0xFF`. `-Wshadow`: 3, all in the test file. The yield is that low for a structural reason visible
  in the code — the bug classes are **typed** out rather than linted out (wire bytes are `uint8_t*`
  everywhere so char-signedness cannot occur, every enum subscript is bounds-checked, structs carry
  NSDMIs) — and the defects this project actually ships fixes for are **domain** and resource-budget
  defects, which §8's audits already cover. There is no `.clang-tidy` file either: an inert config
  reads like a guarantee while doing nothing. The gap that survey *did* find was the warning contract
  above, on the other half of the firmware.
- **✅ Digest-pinned actions — the CI supply chain.** Every third-party GitHub Action in
  [`build.yml`](../.github/workflows/build.yml) and [`renovate.yaml`](../.github/workflows/renovate.yaml)
  is referenced by **full commit SHA**, with the readable version as a trailing `# vN` comment. A tag
  is a movable pointer — the action's owner can repoint `v4` at different code, and every workflow
  naming the tag picks it up on the next push. That matters more here than in most repos: the build
  job materializes the **offline OTA signing key** from a secret (§1), so an action swapped underneath
  the pipeline is positioned to exfiltrate the key that makes a firmware image trusted by every
  deployed board. A SHA cannot be repointed. Pinning alone would only trade that risk for staleness,
  so Renovate's `helpers:pinGitHubActionDigests` preset ([`renovate.yaml`](../.github/workflows/renovate.yaml))
  both enforces the pin on anything newly added and raises PRs to move the digest forward — and those
  bumps are *not* in the never-auto-merge list ([`renovate.json`](../.github/renovate.json)), because
  unlike an ESP-IDF or esp-web-tools bump, a green build is genuine evidence for them.
- **✅ CI gate order** ([`build.yml`](../.github/workflows/build.yml)): one fast, hardware-free
  `gates` job runs first and the firmware build `needs` it — the host logic suite with its 95% line
  floor, the value-catalog audit (§8), the value-description coverage audit, each audit's selftest,
  and the publish-side checks (Pages publish, the Web Serial NVS plan, the publish-version gate);
  only then the esp32s3 firmware build → sign → merge → artifact upload. A
  decode/config/discovery regression, a value that is well-formed but physically false, or a reading
  the UI can no longer explain fails in seconds, not minutes. They are **steps of one job, never a
  job each** — Actions bills every **job** rounded
  up to a whole minute, so a handful of ~15-second checks cost one billed minute as steps and one
  minute *each* as jobs, while a step boundary names the failure just as precisely. (The list is
  deliberately not counted here: it grows, and a restated count is what goes stale — read the job.)
- **✅ Crash-decodable forever.** CI archives the unstripped `.elf` (+ sha256) per version/PR, so every
  build's core dumps stay symbolizable ([`ci-build-all.sh`](../scripts/ci-build-all.sh)).
- **✅ One Pages publisher.** The browser installer is served from the **`gh-pages` branch**, pushed by
  [`publish-pages-branch.sh`](../scripts/publish-pages-branch.sh); the repo's Pages source must be set to
  that branch ([`README.md`](README.md)). The branch model is what lets the release root and the
  `dev/` channel be published independently — an atomic whole-site Actions deployment replaces the
  whole site at once and cannot — so the
  `configure-pages`/`deploy-pages` path is deliberately absent rather than redundant: a repo's Pages
  source is either a branch or Actions, never both.
- **✅ Releases are manual; merges publish a dev channel.** ([`build.yml`](../.github/workflows/build.yml))
  A push to `main` builds, stamps `<next release>-dev.<n>` and republishes **`gh-pages` `dev/`** —
  no tag, no GitHub Release. A release is an explicit act: *Run workflow* with `release: true` and a
  bump level, which stamps `X.Y.Z`, creates the `v*` tag + Release, and republishes the **root**.
  The two feeds are otherwise identical in shape, so the installer page, `esp-web-tools` and the
  device OTA client work against either without a special case. Before this, every firmware-relevant
  merge auto-tagged a release, so "the latest release" only ever meant "the last thing merged" and
  there was no way to run a build that had been deliberately cut.
- **✅ Concurrent publishers survive losing the race.** That one branch has *two* writers — the
  release root publish and every merge's `dev/` publish — and they overlap routinely. Actions cannot serialize them: a `concurrency:` group is per **job**, and the publish is
  the last step of a ~5-minute firmware build, so grouping would serialize that entire build across
  a merge to protect a 2-second push. So the script survives the race instead of avoiding it — it
  refreshes `origin/gh-pages` immediately before publishing (never trusting the ref
  `actions/checkout` froze at job start) and, on a non-fast-forward, re-applies its change onto the
  winner's commit and pushes again, up to 5 attempts. Only a lost race retries; an auth or
  hook rejection is fatal at once. This is sound only because every mode is **declarative** —
  `--dev` replaces `dev/` wholesale and root replaces everything except `dev/` — so re-applying
  yields the same tree as winning would have.
  Naming `dev/` in the root's sweep is load-bearing, not tidiness: a release would otherwise take
  the dev feed offline until the next merge happened to republish it, silently, since nothing else
  reads that path. Guarded by
  [`run-pages-publish-tests.sh`](../scripts/run-pages-publish-tests.sh) (a CI `gates` step),
  which races two publishers against a throwaway bare repo, including one that lands *between* the
  loser's fetch and its push. Before this, the loser's push was simply rejected and its whole build
  went red — and because a re-run always went green, it read as a flake rather than a bug.
- **✅ Publishes from a private repo — and the Pages site is public.** The pipeline no longer gates
  publishing on `repository.private == false`; that gate was removed so the installer and the OTA feed
  can go live before the source does. Two consequences worth knowing precisely: **(a)** a Pages site
  cannot be access-controlled outside an *organization* on GitHub Enterprise Cloud, so the signed
  firmware, browser-installer parts, manual merged image and `manifest.json` are world-readable
  while the source stays private — tags/releases are *not* (repo-read only); **(b)** ungating Pages
  alone would have been useless: the
  release step is the only thing that creates a `v*` tag,
  [`next-version.sh`](../scripts/next-version.sh) derives the next version from the latest tag, and
  with no tags it returns the `version.txt` floor forever — a live feed pinned at 1.0.0 where every
  device reports "up to date" and never updates. A settings change still triggers no run: one
  `workflow_dispatch` or push is what brings the site up ([`README.md`](README.md)).
- **✅ CI runs inside a metered minute budget.** Actions bills each **job** rounded up to the next
  whole minute, and this repo merges often, so the pipeline is shaped by cost as much as by
  correctness ([`build.yml`](../.github/workflows/build.yml)): the three fast gates are **one job**
  (3 billed minutes → 1); the ~5-minute firmware build is **skipped** — not failed — when the diff
  touches nothing the image or the published site is made of, on pull requests as well as pushes,
  which is why the gate is a per-job `if:` and not a workflow-level `paths-ignore:` (a filtered
  workflow leaves a required check pending forever, a skipped job reports and satisfies it);
  **ccache** is carried across runs so the compile does not start from zero after `set-target`
  wipes the build directory (~3 of the build job's ~5 minutes; the other ~2 are the
  `espressif/idf` image pull, which nothing here can shorten) — keyed on the **toolchain version +
  `sdkconfig.defaults`**, the two things that actually make cached objects stale, rather than on a
  hash of the workflow file, which made every edit to it (a comment included) pay a cold compile;
  a PR **publishes nothing** — the
  per-PR preview installer at `PR/<N>/` is retired, since each preview was a `gh-pages` push and
  every `gh-pages` push starts GitHub's own *pages build and deployment* run on top of this one,
  while the dev channel already serves "flash what is on main" for one publish per merge; PR build artifacts
  expire after 7 days instead of 90; Renovate runs on its daily schedule and on demand rather than
  once per merge; and every job carries a `timeout-minutes` so a wedged runner cannot spend hours
  of the allowance unnoticed.
- **Managed components** ([`idf_component.yml`](../main/idf_component.yml)): `mdns`, `cjson` and `mqtt`
  are pulled as managed components (the latter two were extracted from IDF core in v6.0).

---

## 10. Firmware-footprint optimizations

Zero-behaviour-change trims in [`sdkconfig.defaults`](../sdkconfig.defaults) that drop code paths this
firmware never exercises (~15 KB total), because the binding constraint on this target is the largest
*contiguous* free heap block:

| Setting | Drops | Why safe |
|---------|-------|----------|
| `MBEDTLS_ERROR_STRINGS=n` | ~6 KB | only numeric TLS codes are logged |
| `COMPILER_OPTIMIZATION_ASSERTIONS_SILENT=y` | ~5 KB | keeps the `abort()` (→ rollback), drops assert strings |
| `MBEDTLS_*_SSL_SESSION_TICKETS=n` | ~1.8 KB | few, long-lived TLS connections gain nothing from resumption |
| `MBEDTLS_FS_IO=n` | ~1.2 KB | certs/keys come from the CA bundle + NVS, never a VFS path |
| `ESP_WIFI_ENABLE_WPA3_OWE_STA=n` | ~0.8 KB | joins a WPA2-PSK home network |

C++ exceptions are kept on (`COMPILER_CXX_EXCEPTIONS=y`) — they *are* the HTTP OOM guard.

---

## 11. ESP-IDF component & capability inventory

Every ESP-IDF component this firmware links, and what it powers (from
[`main/CMakeLists.txt`](../main/CMakeLists.txt) `REQUIRES` + [`idf_component.yml`](../main/idf_component.yml)):

| Component | Powers |
|-----------|--------|
| `nvs_flash` | runtime config + X10A link cache (`daik_cfg` namespace) |
| `esp_wifi` | STA (strongest-AP scan, SAE) + SoftAP setup portal |
| `esp_event` / `esp_netif` | event loop + network interfaces, DHCP hostname, SNTP client (`esp_netif_sntp`) |
| `esp_http_server` | `:80` UI/API server. `CONFIG_HTTPD_WS_SUPPORT=n` — the WebSocket push is gone (#238/#241), so the `CONFIG_HTTPD_QUEUE_WORK_BLOCKING=y` backstop it needed went with it: `httpd_queue_work()` has no caller left, and an inert setting reads as a live safeguard |
| `esp_https_ota` / `app_update` / `esp_app_format` | OTA slot writes, rollback, app descriptor (version, ELF sha) |
| `esp_http_client` / `esp-tls` | OTA fetch + TLS transport |
| `bootloader_support` | Secure Boot v2 signature verification on the update path |
| `mqtt` (managed) | HA MQTT-discovery bridge |
| `esp_crt_bundle` | CA bundle for MQTTS / OTA TLS verification |
| `lwip` (+ `ping/ping_sock`) | BSD sockets (captive DNS), ICMP gateway watchdog, SNTP protocol |
| `esp_driver_uart` | X10A 9600 8E1 link on `UART_NUM_1` |
| `esp_driver_gpio` | status indicator (GPIO back-end), recovery-button input + pin config |
| `esp_driver_rmt` | RMT peripheral behind the WS2812 indicator back-end |
| `led_strip` (managed) | WS2812/WS2812C pixel driver — an addressable LED encodes its colour in pulse timings, so it cannot be driven with `gpio_set_level` |
| `esp_timer` | uptime, poll/serial timing |
| `mdns` (managed) | `<hostname>.local` discovery |
| `espcoredump` | core dump to flash + `esp_core_dump_get_summary` |
| `cjson` (managed) | POST body parsing (`http_config.cpp`) |

**Compile-time defaults** live in [`main/Kconfig.projbuild`](../main/Kconfig.projbuild). Only some of
them are also settable at runtime (web UI → NVS, which then overrides the Kconfig default):

| Kconfig default | Runtime override |
|---|---|
| `DAIKIN_WIFI_SSID` / `_PASSWORD` | ✅ `POST /set_wifi` → NVS |
| `DAIKIN_MQTT_BROKER_URI` / `_USERNAME` / `_PASSWORD` | ✅ `POST /set_mqtt` → NVS |
| `DAIKIN_SYSLOG_HOST` / `_PORT` | ✅ `POST /set_syslog` → NVS |
| `DAIKIN_NTP_SERVER` | ✅ `POST /set_ntp` → NVS (empty resets to this default, not "off" — SNTP has no disabled state) |
| `DAIKIN_RX_PIN` / `DAIKIN_TX_PIN` | ✅ auto-detected; `POST /set_hp` pins them → NVS |
| `DAIKIN_PROTOCOL` | ⚙️ auto-detected from the bus — deliberately **not** settable (`/set_hp` rejects `proto`) |
| `DAIKIN_HOSTNAME` | ❌ compile-time only |
| `DAIKIN_MQTT_DISCOVERY_PREFIX` / `_BASE_TOPIC` | ❌ compile-time only |
| `DAIKIN_OTA_MANIFEST_URL` / `_FIRMWARE_BASE_URL` | ❌ compile-time only |
| `DAIKIN_STATUS_LED_ENABLE` / `_GPIO` / `_WS2812` / `_INVERTED` | ✅ `POST /set_board` → NVS (these are only the first-boot seed) |
| `DAIKIN_BUTTON_GPIO` / `_ACTIVE_LOW` | ✅ `POST /set_board` → NVS; defaults to `-1` (**disabled**) because an unconfigured input floats and a floating pin reading "pressed" would factory-reset an untouched board |

The **model** is not in this table at all: it is re-detected from the X10A bus on every boot and held
in RAM only — there is no manual picker and no NVS key (see [`ARCHITECTURE.md`](ARCHITECTURE.md)).

---

## What makes this project distinctive (one-paragraph pitch)

It signs and verifies its own OTA updates with **Secure Boot v2 keys but no burned eFuses** — the
security of signed firmware with none of the brick risk. It refuses to roll a bad update forward with a
**connectivity-proving health gate** (not a naive uptime timer). It ships a **live UI embedded
and gzipped into the app image** (polled, after a WebSocket push proved it could die silently), an **ICMP watchdog** that recovers WiFi ghost-associations no event
reports, and a **field-debuggable crash story** (flash core dumps, offline symbolication against an
sha-matched ELF, retained MQTT crash + 18-entity heartbeat diagnostics). And the risky parts — decode,
CRC, config, discovery, the health gate, the OTA downgrade gate — are **pure IDF-free logic verified
on the host** (2204 checks),
gating the firmware build in CI. Everything is **runtime-configured from a captive-portal web UI**; the
heat-pump model is **re-detected on every boot**.

---

*Keep this catalog in sync with the code — when a new technical feature lands, run the
[`feature-docs`](../.claude/skills/feature-docs/SKILL.md) skill.*
