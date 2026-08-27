# Technical features & ESP-IDF building blocks

A cross-cutting catalog of **what this firmware does at the platform level** — the ESP-IDF
subsystems it puts to work, the security and update mechanisms it layers on top, and the
engineering choices that distinguish it from a stock "read a sensor, publish MQTT" sketch.

This document is an **index**, not a re-derivation. Each feature is one line: what it is, an honest
status, and a code pointer. The *why*, the wire detail and the defect history live in the deep-dive
docs, the source comments and the issues:

| Deep dive | Covers |
|-----------|--------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | component map, poll engine, detection, WiFi, MQTT, OTA/partitions, memory |
| [`ESP_IDF_MATRIX.md`](ESP_IDF_MATRIX.md) | source-linked ESP-IDF usage, evaluated alternatives and the completeness gate |
| [`SECURITY.md`](SECURITY.md) | trust boundary, credential storage, OTA signing, boot recovery, key lifecycle |
| [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) | the heat-pump wire protocol (framing, CRC, register pages, detection) |
| [`REGISTERS.md`](REGISTERS.md) | converter reference + full register/value map |
| [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md) | the optional read-only HomeHub (EKRHH) Modbus source |
| [`PLANT.md`](PLANT.md) | **plant-level** features — the checkup, the forecast, the ENV III input, heating-curve diagnosis |
| [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md) | HA topics, discovery, derived power/COP/SCOP |
| [`DESIGN.md`](DESIGN.md) | web-UI design contract |
| [`MCP.md`](MCP.md) | stateless, read-only Streamable-HTTP MCP server |

> **What belongs here** — a *mechanism* a reader would not expect from an ESP32 sketch, stated once,
> with the file that implements it. **What does not** — the bug that motivated it, the measurement
> that settled it, a per-field API listing, or a per-header rationale. Those have homes above; a
> catalog that absorbs them stops being readable as a catalog. Keep entries to a line or two (see
> [the `feature-docs` skill](../.agents/skills/feature-docs/SKILL.md)).
>
> **The subject is the BOARD.** A feature whose subject is the plant, the building or the weather
> around them belongs in [`PLANT.md`](PLANT.md), however much firmware it took — the checkup, the
> Open-Meteo forecast, the ENV III accessory and heating-curve diagnosis live there. What stays here
> is the platform half: the I²C driver and the evidence-before-save rule are mechanisms, an outdoor
> humidity reading is not.

> **Status legend** — ✅ implemented & shipping · 🧪 implemented, host-tested pure logic ·
> 🟡 partially implemented (a working core with a documented TODO) · 🔭 planned / stubbed route.
> Every ✅/🧪 claim points at the source that backs it. When in doubt, downgrade the label.

---

## Feature matrix

Ids are stable keys and are never reused — a gap means a feature was retired, not renumbered.

| # | Feature | Status | Anchored in |
|---|---------|:------:|-------------|
| 1 | Secure Boot v2 **signed images without hardware Secure Boot** (RSA-3072) | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 2 | Refuse-to-flash-untrusted guard (structure, CRC, image digest, RSA-PSS and pinned key) | ✅ | [`require-signed.sh`](../scripts/require-signed.sh) |
| 3 | Dual-OTA layout + **NVS-preserving OTA and no-Erase Web Serial updates** | ✅ 🧪 | [`partitions.csv`](../partitions.csv), [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py) |
| 4 | OTA rollback + **connectivity-proving health gate** (not an uptime timer) | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/health_gate.hpp`](../main/logic/health_gate.hpp) |
| 5 | OTA manifest check + version-bound **release/dev changelog modal** + signed manual HTTPS stream with **at most two exact fail-closed Range resumes** and two-point downgrade gate; dynamic TLS records, a boot-created absolute header/body socket watchdog, clean MQTT pause, transport cleanup, phase-specific INTERNAL-heap admission, fixed status and bounded peer coordination | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp), [`http_client_diag.cpp`](../main/http_client_diag.cpp), [`http_ota.cpp`](../main/http_ota.cpp), [`www/js/settings.js`](../main/www/js/settings.js), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/http_deadline.hpp`](../main/logic/http_deadline.hpp), [`logic/ota_transport.hpp`](../main/logic/ota_transport.hpp), [`logic/fixed_text.hpp`](../main/logic/fixed_text.hpp), [`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp), [`logic/ota_headroom.hpp`](../main/logic/ota_headroom.hpp), [`logic/ota_quiesce.hpp`](../main/logic/ota_quiesce.hpp) |
| 6 | Live UI by **polling** bounded-chunk-streamed `/status` + `/values` — no push transport, on purpose; response size does not become one contiguous heap allocation, both snapshots fail fast during OTA, and the model-sized values snapshot waits boundedly behind shorter Weather TLS | ✅ 🧪 | [`www/app.sources`](../main/www/app.sources), [`http_status.cpp`](../main/http_status.cpp), [`logic/http_values_wait.hpp`](../main/logic/http_values_wait.hpp), [`test_status_heap_contract.mjs`](../test/test_status_heap_contract.mjs), [`test_source_absence_contract.mjs`](../test/test_source_absence_contract.mjs) |
| 7 | Minified deterministic-gzip UI **embedded in the app image**: startup page under 160 KiB, each device-local locale under 32 KiB | ✅ 🧪 | [`main/CMakeLists.txt`](../main/CMakeLists.txt), [`test_ui_delivery_contract.mjs`](../test/test_ui_delivery_contract.mjs), [`test_ui_locale_catalogs.mjs`](../test/test_ui_locale_catalogs.mjs) |
| 8 | HTTP handlers under an **OOM boundary**: `503` before the first response emission; clean connection abort once a streamed response has begun | ✅ 🧪 | [`http_common.cpp`](../main/http_common.cpp), [`logic/chunk_sink.hpp`](../main/logic/chunk_sink.hpp) |
| 9 | Home Assistant MQTT auto-discovery, separate X10A/HomeHub state topics, LWT | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/discovery.hpp`](../main/logic/discovery.hpp) |
| 10 | **MQTTS + verified common-root CA bundle**; credentials never sent in cleartext, no silent fallback | ✅ | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 11 | Core dump to flash + offline symbolication, with a proven **orphan dump** erased so no undecodable download is ever offered | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp), [`decode-coredump.sh`](../scripts/decode-coredump.sh) |
| 12 | Reset-reason + crash classification, retained to MQTT and cleared when the boot is unremarkable | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 13 | 22-entity device **heartbeat** diagnostics stream, published independently of profile detection | ✅ 🧪 | [`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp) |
| 14 | Strongest-AP scan + SAE tuning + **endless reconnect** (a router reboot never strands the bridge) | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 15 | **ICMP gateway watchdog** — recovers a ghost association no event reports | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`logic/link_watch.hpp`](../main/logic/link_watch.hpp) |
| 16 | Captive-portal provisioning (AP-only, typed SSID, UDP:53 catch-all, 302 probe redirect + RFC 8910 option 114) | ✅ 🧪 | [`provisioning.cpp`](../main/provisioning.cpp), [`captive_dns.cpp`](../main/captive_dns.cpp), [`logic/captive.hpp`](../main/logic/captive.hpp) |
| 17 | Stable LAN identity — DHCP options 12/60 + mDNS HTTP product metadata | ✅ 🧪 | [`net.cpp`](../main/net.cpp), [`wifi.cpp`](../main/wifi.cpp), [`test_transport_contract.mjs`](../test/test_transport_contract.mjs) |
| 18 | In-app WiFi re-config + **reason-aware one-shot credential rollback** | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp) |
| 19 | X10A auto-detection — sweep → fingerprint → model, with a retried page probe, a second-sweep confirmation before `generic`, and an **order-independent** representative pick | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`logic/detect.hpp`](../main/logic/detect.hpp) |
| 20 | **IDF-free host-tested logic core** (§8) | 🧪 | [`main/logic/`](../main/logic), [`test/test_logic.cpp`](../test/test_logic.cpp) |
| 21 | CI pinned to the exact ESP-IDF the local Docker build uses, read by one shell extractor | ✅ | [`idf-version.sh`](../scripts/idf-version.sh), [`build.yml`](../.github/workflows/build.yml) |
| 22 | Traceable build identity (`app_elf_sha256`) matching a dump to its ELF | ✅ | [`http_status.cpp`](../main/http_status.cpp), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 23 | Firmware-footprint controls — release-size optimization plus unused IDF-path trims | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 24 | Status indicator — **runtime-selectable GPIO-LED / WS2812 back-end**, one image per board family | ✅ 🧪 | [`status_led.cpp`](../main/status_led.cpp), [`logic/led_pattern.hpp`](../main/logic/led_pattern.hpp) |
| 25 | **Read-only MCP server** — stateless Streamable HTTP, exactly bounded-chunk-streamed `get_status` + `get_hp_values`, no SSE/session, plus an embedded static setup page | ✅ 🧪 | [`mcp_server.cpp`](../main/mcp_server.cpp), [`logic/mcp.hpp`](../main/logic/mcp.hpp), [`logic/chunk_sink.hpp`](../main/logic/chunk_sink.hpp), [`MCP.md`](MCP.md) |
| 26 | **MQTT broker save-time pre-flight** (DNS/TCP/connect+auth, fail-closed under heap pressure) before persist | ✅ | [`http_config.cpp`](../main/http_config.cpp) |
| 27 | **Task Watchdog** → clean reboot on a wedged poll/publish task | ✅ | [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 28 | **`/status.sys`** — always-on heap headroom + last-boot reason, needing no broker | ✅ 🧪 | [`http_status.cpp`](../main/http_status.cpp), [`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp) |
| 29 | **Boot-loop safe mode** — recover a bad config in-browser; distinct from OTA rollback | ✅ 🧪 | [`safe_mode.cpp`](../main/safe_mode.cpp), [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp) |
| 30 | **Config-write integrity** — one atomic CRC-checked NVS blob, field-owned commits, reserved-GPIO rejection, and an NVS failure that reaches the user | ✅ 🧪 | [`config.cpp`](../main/config.cpp), [`logic/config_store.hpp`](../main/logic/config_store.hpp), [`logic/board_pins.hpp`](../main/logic/board_pins.hpp) |
| 31 | **Value-catalog domain audit** — real converters × real catalog vs the spec, each finding carrying a decode witness | ✅ | [`catalog_audit.cpp`](../tools/domain/catalog_audit.cpp), [`run-domain-audit.sh`](../scripts/run-domain-audit.sh) |
| 32 | **SNTP wall clock**, runtime-configurable server — real UTC for syslog and `/status.ntp` | ✅ 🧪 | [`sntp_time.cpp`](../main/sntp_time.cpp), [`logic/timestamp.hpp`](../main/logic/timestamp.hpp) |
| 33 | **Detect-sweep heap hardening** — install-once UART with a register-only pin remap, plus silent-bus backoff | ✅ 🧪 | [`hp_comm.cpp`](../main/hp_comm.cpp), [`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp), [`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp) |
| 34 | **HTTP trust-surface split** — the open setup AP registers only provisioning routes; diagnostics and the config/OTA/MCP surface are trusted-LAN only | ✅ 🧪 | [`http_server.cpp`](../main/http_server.cpp), [`logic/http_surface.hpp`](../main/logic/http_surface.hpp) |
| 35 | **Publish-time plausibility filter** — an out-of-envelope reading reaches HA as *unavailable*, never as a false value; refrigerant-vs-water decided structurally, never by label | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`hp_convert.cpp`](../main/hp_convert.cpp) |
| 36 | **Raw page dump on `/diag`** — the wire bytes behind a decoded value, on a detect pass and as a bounded run-time series | ✅ 🧪 | [`logic/hexdump.hpp`](../main/logic/hexdump.hpp), [`logic/raw_capture.hpp`](../main/logic/raw_capture.hpp) |
| 37 | **Physical recovery button** — a 5 s hold erases config, legacy WiFi storage, history/dwell evidence and any coredump, and reboots only after the complete privacy reset; the only reset needing no network access | ✅ 🧪 | [`recovery_button.cpp`](../main/recovery_button.cpp), [`logic/button.hpp`](../main/logic/button.hpp) |
| 38 | **Explicit board identity + runtime hardware config** — a stable preset id persisted with indicator/button pins, never inferred from matching GPIOs | ✅ 🧪 | [`logic/board_presets.hpp`](../main/logic/board_presets.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 39 | **Stack-overflow watchpoint** — the *first* write past a stack limit panics at the offending instruction | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`http_server.cpp`](../main/http_server.cpp) |
| 40 | **Cost-shaped CI** — fast mechanical gates as steps of one job, skipped compile steps when nothing relevant changed, carried ccache, no per-PR publish | ✅ | [`build.yml`](../.github/workflows/build.yml) |
| 41 | **Audited X10A telemetry supplements** — 11 outdoor protection/retry entities for all profiles plus 27 reference-monobloc control, safety and actuator fields, without new page queries | ✅ 🧪 | [`def/overlay.hpp`](../main/def/overlay.hpp), [`logic/profile_view.hpp`](../main/logic/profile_view.hpp), [`X10A_COVERAGE.md`](X10A_COVERAGE.md) |
| 42 | **24-hour trend rings** — fixed-cadence `int16` rings in static storage, addressed structurally by (page, offset, unit), distinguishing *no reading* from *held over* | ✅ 🧪 | [`logic/history.hpp`](../main/logic/history.hpp), [`history.cpp`](../main/history.cpp) |
| 43 | **Value-description coverage gate** — every catalog label the UI can show must have an explainer, asserted against the real table in a JS engine | ✅ | [`check_descriptions.mjs`](../tools/descriptions/check_descriptions.mjs), [`run-description-audit.sh`](../scripts/run-description-audit.sh) |
| 44 | **Digest-pinned CI supply chain** — every third-party Action is SHA-pinned; only the Renovate runner pin may omit human records after protected-base policy proves its immutable one-line head patch | ✅ 🧪 | [`pr-policy.yml`](../.github/workflows/pr-policy.yml), [`renovate_action_pr.py`](../tools/agent-policy/renovate_action_pr.py) |
| 45 | **Dashboard-schematic audit** — parses the real SVG and evaluates the real bindings to catch a correct value drawn on the wrong pipe | ✅ | [`check_schematic.mjs`](../tools/schematic/check_schematic.mjs), [`run-schematic-audit.sh`](../scripts/run-schematic-audit.sh) |
| 46 | **On-device redaction of a diagnostic snapshot** — so a bug report can be a *public* issue; in the firmware, so the UI and a manual `curl` cannot become two privacy rules | ✅ 🧪 | [`logic/redact.hpp`](../main/logic/redact.hpp), [`REPORTING.md`](REPORTING.md) |
| 47 | **Redaction-coverage gate** — the only gate whose subject is the *user's data*: flags a diag line carrying a config or identity value with no matching rule | ✅ | [`check_diag_coverage.py`](../tools/redact/check_diag_coverage.py), [`run-redaction-audit.sh`](../scripts/run-redaction-audit.sh) |
| 48 | **Device-assembled bug report** — the board collects its own redacted status, values and log into one pasteable report | ✅ | [`www/js/app_state.js`](../main/www/js/app_state.js), [`REPORTING.md`](REPORTING.md) |
| 49 | **Typed telemetry contract** — a field's JSON type comes from its *converter*, so one MQTT key can never change type between states | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp) |
| 50 | **Availability ledger** — is a decoded number a *measurement*, or merely something the firmware could decode? Adjudicated per structural `(page, offset, converter)` key — plus the exact generated label where one coordinate carries multiple quantities, page-keyed absent-hardware verdicts, a conditional zero refuted by a same-cycle saturation witness, and a raw-page bit-overlay rule that withholds CT-L3 instead of turning `HP Forced FG` into a fictitious +64 A | ✅ 🧪 | [`logic/availability.hpp`](../main/logic/availability.hpp) |
| 51 | **Converter adjudication** — which converter a generated row is actually *encoded* with, when the generator's id is demonstrably wrong | ✅ 🧪 | [`logic/conv_override.hpp`](../main/logic/conv_override.hpp) |
| 52 | **Source freshness ≠ publish freshness** — the outdoor unit stops refreshing its own pages when it rests, so those rows are marked and withheld rather than republished as live | ✅ 🧪 | [`logic/ou_stale.hpp`](../main/logic/ou_stale.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp) |
| 53 | **Numeric fault flags beside the textual code** — a metrics store can hold neither `"U4"` nor a dropped string, so each error row also publishes `error_active`/`warning_active` | ✅ 🧪 | [`logic/fault_state.hpp`](../main/logic/fault_state.hpp) |
| 54 | **README-recording merge gate** — every merge fails mechanically when the dashboard GIF is stale or unverifiable; red clears only by re-recording, and a new GIF/stamp additionally needs a current-head `$ui-gif` review | ✅ | [`check_ui_gif.mjs`](../tools/uigif/check_ui_gif.mjs), [`require-pr-gates.sh`](../tools/agent-hooks/require-pr-gates.sh), [`record-dashboard-gif.sh`](../scripts/record-dashboard-gif.sh) |
| 56 | **Group-scoped HA entity identity** — `uniq_id` and the discovery topic carry the register group, because a label is unique only within its page while both namespaces are flat | ✅ 🧪 | [`logic/discovery.hpp`](../main/logic/discovery.hpp), [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md) |
| 57 | **Doc entity-id gate** — resolves the docs' copy-pasteable entity ids through the real slug rule over the real catalog, and only against *detectable* profiles | ✅ | [`entity_id_audit.cpp`](../tools/docs/entity_id_audit.cpp), [`run-doc-entity-audit.sh`](../scripts/run-doc-entity-audit.sh) |
| 58 | **Deleting a crash report** (`POST /crash/dismiss`) — a device action, not page state: erase first, mark second, so status, MQTT and every browser agree | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 59 | **Pinned warning contract on `main/`** — `-Werror=return-type,format,unused-result` on that component alone, so three constructs written as if a warning were fatal actually are | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt) |
| 60 | **Device-local multilingual UI** — browser detection plus a persistent en/de/es/fr/it/pl/cs/uk/zh/ja/nb/sv/fi override, applied live from bounded signed-image locale assets | ✅ 🧪 | [`logic/ui_lang.hpp`](../main/logic/ui_lang.hpp), [`www/js/i18n.js`](../main/www/js/i18n.js), [`www/locales/`](../main/www/locales/) |
| 61 | **Second SOURCE: read-only Modbus TCP to a Daikin HomeHub (EKRHH)** — a stack beside X10A, not an alternative; no source file can frame a write; the 32-row map is batched into ten full-cycle requests while two diagnosis gates and one plant-outdoor context batch stay at 1 Hz | ✅ 🧪 | [`hp_modbus.cpp`](../main/hp_modbus.cpp), [`logic/modbus.hpp`](../main/logic/modbus.hpp), [`logic/modbus_plan.hpp`](../main/logic/modbus_plan.hpp), [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md) |
| 62 | **Configurable MQTT living-room source** — independent exact `topic$json-path` mappings for temperature, an optional source time and an MQTT-backed or fixed target; saving records the mapping even when a path is empty or wrong, but subscription/decoding starts only under the v19 Plant diagnostics master, then the next real MQTT frame supplies runtime decoder evidence; without source time, only live non-retained arrival is accepted | ✅ 🧪 | [`logic/reference_temperature.hpp`](../main/logic/reference_temperature.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 66 | **Complete UI interaction merge gate** — the assembled production UI is *executed* in a deterministic DOM harness, covering every modal in the production registry | ✅ 🧪 | [`test_ui_use_cases.mjs`](../test/test_ui_use_cases.mjs), [`run-ui-use-case-tests.sh`](../scripts/run-ui-use-case-tests.sh) |
| 68 | **Source-boundary contract gate** — source-text assertions about `main/*.cpp` the host suite structurally cannot make (task, order, and which file is entitled) | ✅ | [`run-contract-tests.sh`](../scripts/run-contract-tests.sh), [`test_heating_curve_diagnosis_contract.mjs`](../test/test_heating_curve_diagnosis_contract.mjs) |
| 69 | **Source-absence matrix gate** — every optional source (broker, room source, circulation witness, HomeHub, ENV III, weather, X10A, safe mode) can be absent independently, so the firmware invariants and the browser copy are checked over that cross product, not one feature at a time | ✅ | [`test_source_absence_contract.mjs`](../test/test_source_absence_contract.mjs), [`test_ui_absence_matrix.mjs`](../test/test_ui_absence_matrix.mjs), [`selftest.sh`](../tools/absence/selftest.sh) |
| 70 | **Runtime MQTT base topic** — the installation identity is a saved setting, not a compile-time one, so two boards on one broker stop sharing retained topics, metrics series and their HA device | ✅ 🧪 | [`logic/mqtt_base.hpp`](../main/logic/mqtt_base.hpp), [`http_config.cpp`](../main/http_config.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 71 | **Pinned stack compiler contracts on `/status` and MQTT publishing** — `http_status.cpp` stays at `-Os`, while `mqtt_ha.cpp` keeps called-once helper boundaries and a fatal 2 KiB per-function frame ceiling so size optimisation cannot silently fold transient publish state back into the fixed MQTT task frame | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt), [`http_status.cpp`](../main/http_status.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 81 | **Stack-headroom telemetry** — the second memory budget, made reportable: five deep tasks record their own FreeRTOS high-water mark and the heartbeat carries all five, so a growing call frame is a falling line rather than a core dump nobody has yet | ✅ | [`stack_watch.hpp`](../main/stack_watch.hpp), [`stack_watch.cpp`](../main/stack_watch.cpp) |
| 72 | **Power-loss-surviving 24-hour trends and opt-in plant checkup** — `.noinit` DRAM covers power-preserving resets; the upper-4-MiB append journal stores dense five-minute X10A/HomeHub/ENV III records, daily semantic-id manifests that preserve unchanged series across catalog edits, and enabled hourly diagnosis records. CRC, last-written commit and rotating sectors fail closed on torn writes; the build guards 72-hour capacity. The official 8 MB table is required; browser storage is not a measurement source | ✅ 🧪 | [`logic/history_persist.hpp`](../main/logic/history_persist.hpp), [`history.cpp`](../main/history.cpp), [`partitions.csv`](../partitions.csv) |
| 82 | **Reproducible ESP-IDF build inputs** — exact transitive component lock, explicit ESP-IDF/CMake/C++ floors and wall-clock-free app metadata | ✅ | [`dependencies.lock`](../dependencies.lock), [`CMakeLists.txt`](../CMakeLists.txt), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 83 | **Kconfig and target contract gate** — `esp32s3` is a project default and every declared default is compared with generated `sdkconfig` before compilation | ✅ 🧪 | [`check-sdkconfig-defaults.py`](../scripts/check-sdkconfig-defaults.py), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 84 | **Firmware-size evidence** — the hard app ceiling is joined by retained ESP-IDF json2 data and an Actions summary for Flash, DIRAM, IRAM and `.bss` | ✅ 🧪 | [`report-firmware-size.py`](../scripts/report-firmware-size.py), [`build.yml`](../.github/workflows/build.yml) |
| 93 | **Complete localization gate** — key/table parity plus a canonical-copy fingerprint forces all twelve device locale packs to follow every changed English or domain explainer before CI accepts the PR | ✅ 🧪 | [`run-ui-localization-audit.sh`](../scripts/run-ui-localization-audit.sh), [`test_ui_locale_catalogs.mjs`](../test/test_ui_locale_catalogs.mjs), [`selftest.mjs`](../tools/ui_localization/selftest.mjs) |
| 79 | **Reboot-surviving, generation-bound plant checkup** — the default-off 24-hour window rides the same `.noinit` DRAM only after explicit Firmware opt-in, sealed with a consent generation and a layout fingerprint over every row locator and counting threshold; Cycling and Defrost carry separately paired X10A outdoor minimum/mean context without changing a verdict | ✅ 🧪 | [`logic/checkup_persist.hpp`](../main/logic/checkup_persist.hpp), [`logic/outdoor_evidence.hpp`](../main/logic/outdoor_evidence.hpp), [`checkup.cpp`](../main/checkup.cpp) |
| 73 | **Heap watchdog** — the escalation every other OOM guard here deliberately lacks: sustained exhaustion of the largest *internal* contiguous block becomes a deliberate restart with a persisted, capped breadcrumb, because a wedge that never recovers is worse than a crash | ✅ 🧪 | [`logic/heap_watchdog.hpp`](../main/logic/heap_watchdog.hpp), [`heap_guard.cpp`](../main/heap_guard.cpp) |
| 74 | **Presenter-parity gate** — the browser's copies of the leaving-water / post-BUH / COP-scope / held-over-page rules are diffed against the C++ headers over the whole catalog, so "host-tested" stops meaning "the copy that does not ship is tested" | ✅ 🧪 | [`presenter_golden_dump.cpp`](../test/presenter_golden_dump.cpp), [`presenter_parity.mjs`](../tools/presenter/presenter_parity.mjs), [`selftest.sh`](../tools/presenter/selftest.sh) |
| 75 | **One unwind-safe mutex guard** for the whole firmware, replacing nine per-file copies that had drifted into two shapes — plus a bounded/try-lock mode for the callback contexts that must not block | ✅ | [`rtos_guard.hpp`](../main/rtos_guard.hpp) |
| 76 | **Central task-priority table** — relative priority is a property of the system, so it is declared in one place instead of as twelve bare literals the ordering had to be reconstructed from | ✅ | [`task_config.hpp`](../main/task_config.hpp) |
| 77 | **Optional wired transport (W5500 / PoE)** — a second network transport detected at boot from one SPI identity register, with the boot fork (wire → radio → portal), the route priority, the pulled-cable reboot and the probe's refusal to drive a configured pad as host-tested rules | ✅ 🧪 | [`logic/net_link.hpp`](../main/logic/net_link.hpp), [`net.cpp`](../main/net.cpp), [`test_transport_contract.mjs`](../test/test_transport_contract.mjs) |
| 78 | **Transport-independent HTTP trust surface** — the restricted provisioning route set follows the OPEN setup AP's existence rather than the WiFi mode, so a wired board is not locked out of its own API and a live AP cannot be widened by a cable | ✅ 🧪 | [`logic/http_surface.hpp`](../main/logic/http_surface.hpp), [`http_server.cpp`](../main/http_server.cpp) |
| 80 | **Per-row state age** — how long every binary row (including neutral observation-only flags) has read what it reads, published as three separate facts (the seconds, whether the transition was *witnessed*, and how much of the run the bus did not answer for) so a consumer cannot state a stronger claim than the board made | ✅ 🧪 | [`logic/state_dwell.hpp`](../main/logic/state_dwell.hpp), [`state_dwell.cpp`](../main/state_dwell.cpp) |
| 89 | **Agent instruction and configuration integrity gate** — canonical `AGENTS.md` is byte-bounded; skill identity and OpenAI metadata, reviewer sandboxing, hook dispatch, the credential-safe GitHub CLI wrapper and explicit safety invariants fail closed on drift | ✅ | [`run-agent-instructions-budget.sh`](../scripts/run-agent-instructions-budget.sh), [`gh-with-git-credentials.sh`](../scripts/gh-with-git-credentials.sh), [`selftest.sh`](../tools/agent-config/selftest.sh) |
| 97 | **PR-text hygiene gate** — exact-range commit messages and current PR text are checked mechanically, while every ordinary merge requires a current-head human privacy/language review | ✅ 🧪 | [`check_pr_hygiene.mjs`](../tools/pr_hygiene/check_pr_hygiene.mjs), [`pr-hygiene-review`](../.agents/skills/pr-hygiene-review/SKILL.md), [`require-pr-gates.sh`](../tools/agent-hooks/require-pr-gates.sh) |
| 85 | **Browser serial-permission release** — the Pages installer exposes a granted, closed port's `forget()` action without opening a chooser when nothing can be revoked or interrupting an active flash | ✅ 🧪 | [`serial-port-release.mjs`](serial-port-release.mjs), [`serial_port_release.test.mjs`](../test/serial_port_release.test.mjs) |
| 86 | **Inline Web Serial installer + monitor** — only the native port chooser leaves the branded Pages UI; ESP32-S3 probing, NVS-preserving sparse flash, cross-part progress, reset and a real 115200-baud monitor run in-page | ✅ 🧪 | [`web-installer.mjs`](web-installer.mjs), [`web_installer.test.mjs`](../test/web_installer.test.mjs) |
| 87 | **Diagnostic-evidence contract gate** — every visible plant diagnosis stays bound to an external basis, its implemented rule and an explicit claim limit | ✅ | [`check_diagnostic_evidence.mjs`](../tools/diagnostic_evidence/check_diagnostic_evidence.mjs), [`run-diagnostic-evidence-audit.sh`](../scripts/run-diagnostic-evidence-audit.sh) |
| 88 | **English-only documentation contract** — maintained Markdown stays English while localized UI copy remains independently complete and equally bounded | ✅ 🧪 | [`english_docs.mjs`](../tools/user_docs/english_docs.mjs), [`run-user-docs-audit.sh`](../scripts/run-user-docs-audit.sh) |
| 90 | **Bounded X10A publish path + weather-fetch headroom/deadline gate** — direct size/digest probing of the source-tagged poll cache avoids duplicate cache/group storage and a permanent payload block; changed state uses one exact transient payload with a revision-checked copy and a 12 KiB refusal ceiling. Open-Meteo waits for X10A/MQTT quiescence, retries below 56 KiB free / 24 KiB largest contiguous block, and shares the absolute header/body socket watchdog | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`logic/x10a_snapshot.hpp`](../main/logic/x10a_snapshot.hpp), [`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp), [`weather_forecast.cpp`](../main/weather_forecast.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp), [`logic/weather_forecast.hpp`](../main/logic/weather_forecast.hpp), [`test_x10a_publish_heap_contract.mjs`](../test/test_x10a_publish_heap_contract.mjs) |
| 91 | **X10A protocol diagnosis** — connection-gated, closed Settings tongue with an exact-or-labelled-generic `main/def` register catalog plus a bounded `POST /hp/query`: one caller-chosen page, raw/partial frame and every converter the slice admits | ✅ 🧪 | [`logic/hp_probe.hpp`](../main/logic/hp_probe.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`http_config.cpp`](../main/http_config.cpp), [`dashboard.js`](../main/www/js/dashboard.js) |
| 96 | **Fail-closed signed bench OTA delivery** — the private-inventory `bench` role is the only target of the canonical ordinary-update mode: exact official dev source/version/application-SHA, signature, ESP32-S3 metadata, current-version/MAC lease and safe preflight precede one generation-bound un-retried write; a connection-churn-bounded compact observer, verifier/operation-heap evidence, at least 1 KiB observed OTA-task stack reserve, rollback probation and fixed HTTP/TLS/MQTT pressure follow. Only the exact historical `1.0.2` writer, bound by reported version plus shortened ELF identity, may omit the later stack field; a reported value below the floor, release HIL, and every other writer still fail. The mode cannot contact production; ordinary bench delivery is OTA-only, with USB reserved for bootstrap/recovery | ✅ 🧪 | [`production-ota-gate.py`](../scripts/production-ota-gate.py), [`agent_hook.py`](../tools/agent-hooks/agent_hook.py), [`test_production_ota_gate_contract.mjs`](../test/test_production_ota_gate_contract.mjs), [`selftest.mjs`](../tools/production_ota/selftest.mjs) |
| 92 | **Fail-closed production OTA promotion** — after the exact signed dev artifact is healthy on the bench (normally through feature 96; signed USB only for bootstrap/recovery), host contracts, a healthy dwell, a complete signed release download under HTTP pressure, release probation, exact dev restore and sustained manifest pressure run on the MAC-pinned bench. The current target keeps its configured dev channel and binds only the accepted release generation to the stable release feed; the official dev manifest is hash/source/version/application-rebound both before release selection and immediately before its one write. The older release restores through the mutable dev path, so publishing must remain idle during the transaction and any drift stops before production contact. The bench-only legacy return requires a stable exact offer; production accepts no legacy fallback and atomically consumes the completed check generation plus channel/version/application-SHA. Whole-download SHA-256, completed verification and read-only X10A/weather/heap/MQTT canaries remain mandatory; the Weather canary is bound to the exact refresh token returned by its trigger, not an unrelated success-counter edge | ✅ 🧪 | [`production-ota-gate.py`](../scripts/production-ota-gate.py), [`ota_update.cpp`](../main/ota_update.cpp), [`ota_manifest.hpp`](../main/logic/ota_manifest.hpp), [`http_ota.cpp`](../main/http_ota.cpp), [`health_gate.hpp`](../main/logic/health_gate.hpp), [`test_production_ota_gate_contract.mjs`](../test/test_production_ota_gate_contract.mjs), [`selftest.mjs`](../tools/production_ota/selftest.mjs), [`require-pr-gates.sh`](../tools/agent-hooks/require-pr-gates.sh) |
| 94 | **ESP-IDF feature-matrix gate** — explicit components, managed dependencies, active defaults, application IDF headers and reviewed native/manual boundaries must stay represented by source evidence and specific official documentation | ✅ | [`ESP_IDF_MATRIX.md`](ESP_IDF_MATRIX.md), [`check_matrix.py`](../tools/esp_idf_matrix/check_matrix.py), [`selftest.py`](../tools/esp_idf_matrix/selftest.py) |
| 95 | **Fresh refrigerant service observation** — one non-persistent, generation-bound heating window from same-sweep X10A values, separate from plant health; profile-sized gap handling, latched limitations and explicit no-load/no-EEV-feedback boundaries expose service context without inventing full load, settling, charge, a universal range or a completion verdict | ✅ 🧪 | [`refrigerant_service.hpp`](../main/logic/refrigerant_service.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`DIAGNOSTICS.md`](DIAGNOSTICS.md#refrigerant-service-observation) |
| 98 | **Per-header branch-count coverage ratchet** — the 95% aggregate line floor is joined by execution-profile-specific aggregate gcov `taken/total` branch-edge floors; hosted CI also binds runner OS/image and it does not claim branch identity | ✅ 🧪 | [`branch_baseline.json`](../tools/coverage/branch_baseline.json), [`profile.sh`](../tools/coverage/profile.sh), [`check_gcov_report.py`](../tools/coverage/check_gcov_report.py) |
| 99 | **Sanitized hostile-input property gate** — deterministic malformed frames, JSON, URLs and boundary values use a capability-probed sanitizer runtime; CI requires ASan+UBSan and a local host falls back to UBSan only when ASan is unavailable | ✅ 🧪 | [`logic_property_tests.cpp`](../tools/fuzz/logic_property_tests.cpp), [`run-sanitizer-fuzz-tests.sh`](../scripts/run-sanitizer-fuzz-tests.sh) |
| 100 | **Ratcheted source-format gate** — whole-tree UTF-8/LF/exactly-one-final-newline/whitespace invariants plus exact clang-format 18.1.3 on new files and changed C/C++ hunks | ✅ 🧪 | [`check_format.py`](../tools/format/check_format.py), [`run-format-check.sh`](../scripts/run-format-check.sh) |
| 101 | **Host runtime-scenario harness** — eight scenarios run selected production parsers and serializers through simulated clock/storage/transport/broker adapters; two real POSIX socket scenarios prove joined absolute deadline aborts for trickling headers and bodies. It remains hardware-free and does not execute target glue, NVS or MCP | ✅ 🧪 | [`runtime_integration_tests.cpp`](../test/runtime/runtime_integration_tests.cpp), [`run-runtime-integration-tests.sh`](../scripts/run-runtime-integration-tests.sh) |
| 102 | **Real-browser rendering and accessibility gate** — the assembled production UI runs in Chrome across all locales and mobile/desktop widths, including native accessibility, keyboard, overflow, reduced-motion and console contracts | ✅ 🧪 | [`test_browser_render.mjs`](../test/test_browser_render.mjs), [`run-browser-render-tests.sh`](../scripts/run-browser-render-tests.sh) |
| 103 | **End-to-end release artifact trust chain** — clean rebuild identity, pinned signing-key continuity, manifest provenance, bounded delayed Pages byte readback and GitHub Release asset readback all bind the published artifact to the trusted build; a failed readback can resume the same dev/release version only for the exact published source SHA | ✅ 🧪 | [`check-reproducible-build.py`](../scripts/check-reproducible-build.py), [`check-signing-key-continuity.py`](../scripts/check-signing-key-continuity.py), [`verify-published-artifacts.py`](../scripts/verify-published-artifacts.py), [`check-publish-version.sh`](../scripts/check-publish-version.sh) |
| 104 | **Isolated release hardware gate** — the byte-identical candidate uses a transient generation-bound HTTPS feed override and must explicitly prove pending rollback, at least 1 KiB pre-reboot OTA-task stack reserve, a pre-commit controller approval under a non-renewable watchdog, committed-valid reinstall and cold restoration. The valid candidate then proves its own complete OTA writer by installing the separately pinned signed bootstrap as pending and hard-cycling back to the candidate before live stack minima and combined stress on a non-production lab can permit release publication | ✅ 🧪 | [`ota_hil_feed.hpp`](../main/logic/ota_hil_feed.hpp), [`production-ota-gate.py`](../scripts/production-ota-gate.py), [`build.yml`](../.github/workflows/build.yml) |

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

Why the combination is unusual:

- **The running app validates the *next* OTA image's RSA signature before selecting its inactive
  slot for boot**, so a compromised update host cannot activate unsigned firmware. Download bytes
  may be written only to that inactive slot before validation; the running slot stays untouched.
- **No eFuses are burned.** The bootloader does not verify on boot, so this is fully reversible,
  carries **zero brick risk**, and the browser (Web Serial) / USB install path keeps working.
- **The private key is never present at compile time** — the image is signed in a separate step
  ([`ci-build-all.sh`](../scripts/ci-build-all.sh)), so fork/PR builds without the secret still
  compile and the key stays offline.

Full key lifecycle and threat model: [`SECURITY.md`](SECURITY.md).

### The trade-off it forces — and the guard that contains it

Because the app must carry a valid signature to run, an **unsigned image crash-loops** before
`app_main` with no app-level recovery. Three guards contain that:

- [`require-signed.sh`](../scripts/require-signed.sh) exits non-zero **with the exact signing
  command** unless the `.bin` carries a structurally valid Secure Boot v2 block whose CRC, image
  digest, RSA-PSS signature and pinned RSA-3072 public-key digest all verify; the
  [`flash-esp32`](../.agents/skills/flash-esp32/SKILL.md) skill runs it before every flash.
- CI hard-errors on a `main` build with no signing key; fork PRs downgrade to an unsigned
  *compile-only* build that publishes nothing.
- CI applies the same guard to the **browser installer**, which no host-side check reaches: each
  published Web Serial part is carved out of the prepared image and re-checked, so a signing step
  that stops covering the installer fails the build instead of shipping.

---

## 2. OTA self-update & anti-brick

Deep dive: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md).

- **Dual-OTA layout** ([`partitions.csv`](../partitions.csv)): two app slots plus `otadata`,
  `phy_init` and a `coredump` partition. The `esp_ota` stream writes the **inactive** slot, so an update
  never touches `nvs@0x9000` — WiFi, MQTT and the X10A pin cache survive upgrades.
- **✅ NVS-preserving Web Serial updates**: the manifest publishes only the occupied `flash_args`
  ranges as separate parts, so a no-Erase install skips `nvs` instead of writing the merged image's
  gap through it. [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py) rounds
  every part to its real erase sectors and fails the build on an NVS overlap; its own tests feed it
  *bad* plans, since running it on the real manifest only ever proved a good plan passes. Selecting
  **Erase** remains the explicit factory-reset path.
- **✅ 🧪 Inline browser install**: the native browser chooser is the only dialog. The page probes
  the ESP32-S3, reports weighted progress across every sparse part, resets after the write, and
  exposes the same selected port as an on-page 115200-baud Serial Monitor when no flash owns it.
- **✅ 🧪 Explicit serial-permission release**: the installer shows **Remove browser permission** only
  when `Serial.getPorts()` reports an existing grant for this site. One closed port is forgotten
  directly, multiple grants use the browser chooser, and an open flash port is refused. Visibility
  is refreshed after connect/disconnect, page focus and a successful release.
- **Rollback armed until proven healthy** (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`): a fresh OTA
  image starts `PENDING_VERIFY` and the bootloader reverts if it reboots before being marked valid.
- **✅ 🧪 Health gate, not a timer** ([`logic/health_gate.hpp`](../main/logic/health_gate.hpp)): an
  image is sealed in only after a base window **and** proven connectivity (STA online, or the setup
  portal when it has no credentials). A boots-but-broken update — a WiFi regression that can never
  get back online to be re-flashed — rolls back instead of sealing the break in. Blank/no-record
  USB images make IDF's state read fail and are reported `unknown`/`rollback_pending:null`, never
  `PENDING_VERIFY`, so the gate can never strand a fresh board or invent a safe rollback state.
- **✅ 🧪 Two update channels** ([`logic/ota_channel.hpp`](../main/logic/ota_channel.hpp)):
  `release` (the gh-pages root, cut by a manual workflow run) and `dev` (every firmware-relevant
  merge). Dev builds are stamped `<next release>-dev.<n>` — a semver **pre-release**, so ordering
  alone gets both directions right. The dev URL is *derived* from the release base, never configured
  separately, so the feeds cannot drift onto different hosts.
- **✅ 🧪 Release/dev changelog modal**: CI publishes a bounded `changelog.json` beside each channel's
  manifest, derived from explicitly classified user-facing first-parent commit subjects since that
  feed's previous source. Obvious Git/issue references are rejected because the resulting selected
  subject text is public feed content even when the repository is private.
  The firmware fetches it only for a valid offer, requires the document's version to equal the
  manifest version, decodes at most 960 bytes in place in one transient 1025-byte 8-bit-heap
  document slot, and after TLS cleanup retains only the exact decoded length. The one-shot text is
  released after its response, on send failure, after a 60-second static-timer TTL, or before the
  next OTA task, so no boot-long prose BSS, heap island or PSRAM dependency is added. The optional
  second TLS request uses the same dynamic TLS-record client and first requires the same four stable
  56 KiB total-free / 24 KiB largest-INTERNAL-block samples as the manifest and image handshakes. Its
  header and body share the same 30-second socket watchdog as the manifest.
  The device-local modal shows the exact current/available versions, channel, literal change list and
  signed-update/rollback explanation in all shipped languages. Missing notes fall back locally and
  never weaken or block the signed artifact lease.
- **✅ 🧪 Manifest check & signed download**: both network operations run on **one on-demand task,
  one at a time** — never the httpd worker, and never twice concurrently (two TLS sessions compete
  for the largest contiguous block). The compact shared Web Serial/OTA manifest is bounded by one
  fixed 2 KiB body buffer inside the measured OTA function frame, while its firmware-unused full artifact
  inventory lives in sibling `artifacts.json`. The trusted packager reads that machine-readable
  firmware constant and applies the stricter 1 KiB ceiling required by the oldest supported signed
  restore release before publishing can hand either parser an artifact it cannot consume. The
  lock-free OTA heap lease begins before manifest TLS setup,
  gives the once-per-second MQTT publisher and X10A poller one cycle to stand aside, prevents a new
  weather request and waits a bounded interval for an existing one, and stays active through image
  validation. The monotonic budget starts before each open. Once `esp_http_client_open()` exposes the
  public socket, one boot-created `esp_timer` is armed for only the remaining 30-second manifest or
  five-minute firmware budget and stays armed across `fetch_headers()` and every body read. Its
  allocation-free callback only latches expiry and notifies one boot-static priority-6 watchdog
  task. That task owns a boot-primed lwIP thread semaphore, calls `shutdown(SHUT_RDWR)`, and signals
  completion; the owning OTA task joins that acknowledgement before close, redirect or Range-resume
  reuse. The watchdog task is created before networking, never at failure time, and the callback
  never enters the socket API. An unavailable timer/task/prime disables OTA and Weather for the boot;
  later location or diagnostics saves preserve that error for an active source instead of replacing
  it with a false `waiting` state.
  DNS/TCP/TLS/request setup inside `open()` is governed separately by the IDF client's 15-second
  timeout and a post-open deadline check; the application socket watchdog cannot interrupt that
  pre-socket phase. An init-OOM or
  `ESP_ERR_MBEDTLS_SSL_SETUP_FAILED` during the manifest handshake is
  retried exactly once after cleanup; DNS, TCP, certificate and HTTP failures are not relabelled or
  retried. The manifest parser
  ([`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp)) is the one place an attacker-influenced
  byte stream is parsed here: bounded, allocation-free, depth-aware, and it **refuses rather than
  truncates** an oversized value.
- **✅ 🧪 Heap-safe signed-image validation** ([`logic/ota_headroom.hpp`](../main/logic/ota_headroom.hpp)):
  the firmware streams HTTPS through a fixed 2 KiB INTERNAL buffer into the inactive partition,
  then destroys that buffer and the complete HTTP/TLS client **before** `esp_ota_end()` invokes the
  unchanged RSA-3072/PSA verifier. ESP-IDF's dynamic TLS-record buffers allocate and right-size RX/TX
  records only while needed; TLS config/key/CA lifetime is deliberately unchanged. Every manifest
  and firmware handshake first requires four stable samples at 56 KiB total free INTERNAL 8-bit
  heap **and** a 24 KiB largest contiguous INTERNAL block. After TLS cleanup, validation has its
  separate two-sample 24/12 KiB gate before `esp_ota_end()` and again before
  `esp_ota_set_boot_partition()`, because IDF validates in both calls. Each wait is bounded and fails
  closed. HomeHub and Syslog claim/recheck and acknowledge allocation-rich cycles for both OTA and
  Weather. The MQTT owner cleanly stops the complete esp-mqtt transport before either network TLS
  owner proceeds, removing MQTTS keepalive/subscription record churn, and resumes the same client
  only after the owner flag clears. MQTTS restart itself requires four stable 56/24-KiB heap samples
  and direct start failures back off exponentially to 60 seconds. Allocation-rich HTTP snapshots return an early busy-503 while
  OTA is active; compact OTA status and the static diagnostic ring remain observable. Only both
  successful validation passes may select the new slot. IDF maps structure,
  digest/signature and verifier-allocation
  failures to the same validation result, so the UI reports “image validation failed” rather than
  inventing a signature-specific diagnosis.
- **✅ 🧪 Two-point downgrade gate** ([`logic/version_cmp.hpp`](../main/logic/version_cmp.hpp)): a
  signature proves a build *authentic*, not *newer*. The gate refuses anything not strictly newer,
  checked against the manifest **and** against the image's own embedded `esp_app_desc_t` version,
  requiring the two to match exactly — so a host advertising `9.9.9` while serving a signed `1.0.0`
  is caught. Ordering is numeric and pre-release-aware, and **fails closed** on an unparseable
  version. The one relaxation is the channel switch (`?downgrade=1`), which relaxes *ordering* only:
  never the signature, never an equal version, never persisted.
- **✅ Publish-version gate** ([`check-publish-version.sh`](../scripts/check-publish-version.sh)):
  the stamped version is *derived* from the tag list, so a deleted tag can silently reset the
  numbering. Right after stamping, CI asks the device's own `ota_is_upgrade()` whether a board on
  the **already-published** build would accept the new one. A rerun may repeat an equal dev or
  release version only when the existing manifest identifies the exact same source SHA.
- **✅ Version pipeline**: CI stamps the version *before* the build, so ESP-IDF bakes that exact
  string into the app descriptor, then reads it back out of the built image and **fails the build**
  if the image, the tag and the manifest disagree.
- **✅ 🧪 Boot-loop safe mode** ([`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp)): a
  **different** failure class from image rollback — both OTA slots share one NVS, so rolling back
  the *image* cannot fix a *config* crash-loop (wrong RX/TX pins). It counts **crash-only** boots and
  past a threshold brings the device up minimally (WiFi + web UI + OTA, no poll/MQTT), so the bad
  setting is fixable in the browser instead of over USB. It **latches**: the healthy-uptime timer
  that ages the crash counter out is not armed while safe mode is active, because staying up with the
  poll engine and MQTT switched off is evidence about the *recovery surface*, not about the fault
  still sitting in the config. Arming it there produced a cycle rather than a latch — the counter
  cleared 30 s into every recovery boot, so the next crash reset started from zero and brought the
  full stack back up on the configuration already proven to crash. Nothing is stranded by refusing:
  any non-crash reset zeroes the counter, and every intentional way out (a `/set_*` save, an OTA
  install, a power cycle, the recovery button) is one — so safe mode ends when somebody acts on it,
  and only then.
- **✅ An exception boundary around the boot sequence** ([`main.cpp`](../main/main.cpp)): `app_main`
  is a C frame boundary like every handler and task loop this firmware already guards, and boot
  allocates. An escape used to reach `std::terminate` anonymously. It now `abort()`s with the phase
  named — deliberately `abort()` and not `esp_restart()`, because a "sw" reset is what `boot_guard`
  classifies as *intentional* and uses to **clear** the crash counter, so a boot that always threw
  would have restarted forever without ever accumulating one crash boot.

---

## 3. Networking & connectivity resilience

The device is a **stationary, mains-powered bridge** that must never need a human to power-cycle it
([`wifi.cpp`](../main/wifi.cpp); deep dive [`ARCHITECTURE.md`](ARCHITECTURE.md)).

- **Connect to the *strongest* AP, not the first heard** — `WIFI_ALL_CHANNEL_SCAN` +
  `WIFI_CONNECT_AP_BY_SIGNAL`, so a multi-AP/mesh SSID does not latch a distant AP. SAE tuning
  (`failure_retry_cnt`, `sae_pwe_h2e = BOTH`) absorbs transient WPA3 handshake failures.
- **An optional wired transport.** A W5500 on SPI (an ATOMIC PoE Base in practice) is *detected* at
  boot from one identity register, so one image serves both — [`net.cpp`](../main/net.cpp). A wired
  board starts no radio and opens no setup portal; the boot fork, the route priority and the
  pulled-cable reboot are host-tested rules in [`logic/net_link.hpp`](../main/logic/net_link.hpp).
- **✅ 🧪 A stable product identity on both transports.** DHCP options 12/60 and the mDNS HTTP
  instance use `daikin-altherma-esp32`; mDNS adds product/path/version but no per-installation data.
  The source contract pins the before-DHCP ordering without mutating a live lease.
- **Endless reconnect with a first-boot budget.** A boot-time failure spends a bounded budget and
  then opens the setup portal; once ever online, a drop reconnects **forever**, unconditionally on
  the disconnect reason — the reason codes that look like bad credentials are also the transient
  SAE failures above, so acting on them stranded healthy boards in the open portal.
- **✅ One ESP-NETIF initialization for both network paths** — it is a process-wide singleton, and
  the STA and portal branches run in sequence on exactly the first-boot fallback path.
- **✅ 🧪 In-app WiFi re-config with one-shot credential rollback.** `/set_wifi` stashes the previous
  working credentials as a one-shot NVS backup; if the new network never yields a lease, the backup
  is restored. The deadline is **reason-aware**
  ([`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp)) because a rollback *destroys* the
  new credentials: only an AP that **keeps refusing** them takes the fast path, while an absent SSID
  — what a rebooting router looks like — waits far longer. The outcome is reported as
  `/status.wifi.rolled_back`, since the rollback's own reboot wipes the diag ring.
- **✅ 🧪 Config-write integrity** ([`logic/config_model.hpp`](../main/logic/config_model.hpp)): two
  tasks write the config — httpd and detection — and a writer that saves a whole `Config` saves what
  it *snapshotted*. Writers now commit only the fields they **own**, via non-allocating host-tested
  patches, so a detection sweep cannot revert a credential change the user was already told
  succeeded. An NVS write failure **reaches the user** (`500`, no reboot) instead of reading as
  saved. The service blob, link blob and exact RAM successor are fully allocated/serialized before
  the first NVS write; after that boundary only checked writes and a noexcept move remain.
- **✅ 🧪 ICMP gateway watchdog.** A missed deauth leaves a ghost association — IP held, TCP timing
  out, no disconnect event ever. A background task probes the gateway and re-associates only for the
  proven ghost case. The probe is **three-valued**
  ([`logic/link_watch.hpp`](../main/logic/link_watch.hpp)): a probe that cannot be *taken* is
  `Unmeasurable` — never counted as a failure, but no longer reported as healthy either, since the
  memory pressure that blinds it accompanies the wedge it exists to break.
- **✅ Task Watchdog on the worker tasks.** The poll engine and the MQTT publish task subscribe
  themselves, feeding it per cycle **and** per register / per publish, so a slow-but-progressing
  9600-baud read or a reconnect burst is never mistaken for a hang. The default idle-task watch
  catches CPU *starvation*; this adds the *blocked-but-still-scheduled* case it cannot see.
- **✅ Stack-overflow watchpoint** (`CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y`): IDF's default
  canary is compared only at a context switch, and a sparsely-writing frame can step over it — the
  overflow then surfaces much later, somewhere unrelated. A hardware watchpoint panics at the
  offending instruction instead. It costs one of two debug watchpoints, unused here because this
  firmware is debugged from core dumps rather than JTAG.
- **Modem sleep disabled** (`WIFI_PS_NONE`) — trades idle-power saving for a consistently responsive
  HTTP UI.
- **LWIP tuned for the workload**: the socket cap is lifted (http server + mDNS + SNTP + MQTT + OTA
  can otherwise starve the download of a socket) and the TCP windows doubled. A **160 KiB gzip hard
  limit** on the single startup-page response fails the build before that response can silently
  justify more buffers; each separately requested locale asset has its own **32 KiB** limit.

  The sources keep their load-bearing comments and the artefact carries none: the offline minifier
  ([`minify_and_gzip.py`](../tools/web_asset/minify_and_gzip.py)) strips **HTML, CSS and JS**
  comments alike — markup included, since `index.html` is spliced in raw and its commentary was
  otherwise served to every client. Markup stripping is comments only (HTML whitespace is
  significant) and fails the build rather than guess on an unterminated or conditional comment.

### Captive-portal provisioning

First boot with no WiFi config comes up as SoftAP `daikin-altherma-esp32-setup`. A hand-rolled
UDP:53 server ([`captive_dns.cpp`](../main/captive_dns.cpp)) answers **every** A query with the
portal address, and one shared `:80` server handles both AP-setup and STA-run modes.

Auto-popping then depends on answering the joining OS's connectivity probe the way it recognises.
The `/*` catch-all answers all three agents (iOS/macOS, Android, Windows) with **`302` +
`Location`** — the one signal all of them act on — and the SoftAP's DHCP additionally advertises the
**RFC 8910** captive-portal URI (option 114), which recent iOS/Android prefer over probing at all.
The setup-vs-STA split is host-tested ([`logic/captive.hpp`](../main/logic/captive.hpp)): in STA
mode the same catch-all is the dashboard's SPA shell and must not redirect.

The portal takes the SSID as **typed text** — it does not scan and fetches nothing — so the radio
runs **AP-only**, with no idle station interface and no channel-hopping blip on the associated
phone. A typed SSID also handles what a picker could not: a **hidden** network is entered like any
other.

---

## 4. Web server & the live transport

- **`esp_http_server` on `:80`**, with `CONFIG_HTTPD_WS_SUPPORT=n` — stated explicitly because this
  firmware deliberately has **no** push transport. The full HTTP surface is in
  [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/README.md`](README.md).
- **✅ The live UI is a POLL, and the absence of a push is the feature.** The browser fetches
  `/values` and `/status` on one recursive-`setTimeout` chain (never `setInterval`: a slow answer
  must delay the next request, not stack one behind it), backs off while unreachable and suspends
  while the tab is hidden. The `/events` WebSocket was **removed**: a push fails silently and
  globally, a request fails loudly and locally under a `503` this server already returns. The
  measurements are in [`ARCHITECTURE.md` → "Push vs. poll"](ARCHITECTURE.md); the cost is one
  cadence of latency on a dashboard whose motion is CSS. `/status` and `/values` serialize their
  live responses through a bounded 1 KiB sink; `/values` and MCP `get_hp_values` additionally stage
  their source snapshots and share the same representation. Growing live response bodies therefore
  do not require equally-growing contiguous allocations.
- **🧪 Request bodies are reassembled, not assumed**
  ([`logic/http_body.hpp`](../main/logic/http_body.hpp)): a POST body is a TCP stream, so the loop
  runs until `content_len` is consumed. A timeout is retried only while progress resets the idle
  count — unbounded patience would let one silent client park the single httpd task.
- **✅ gzip UI embedded in the app image**: the build inlines the page and its fragments,
  minifies, and pre-compresses them deterministically (`EMBED_FILES`). gzip is deliberate because
  the trusted-LAN origin is HTTP and browsers do not consistently negotiate Brotli there.
- **✅ OOM discipline** ([`http_common.cpp`](../main/http_common.cpp)): every route runs under one
  trampoline whose `try/catch` returns **503 instead of crashing** while it still owns the response
  status. A chunked route may have sent status/headers even when its first chunk call reports a
  socket error; the bounded stream helper therefore closes the 503 window before that call and then
  consumes later exceptions so httpd closes the incomplete response. Host tests inject OOM before
  emission, after a successful first chunk, and after a failed first chunk. No path unwinds through
  esp_http_server's C frames.
- **✅ The same discipline covers every allocating FreeRTOS task loop**, since a task entry is a C
  frame boundary exactly like a handler. Its corollary: **a throw must never strand a mutex** —
  `xSemaphoreTake` is not released by unwinding, so critical sections are either non-allocating or
  taken through an RAII lock.
- **✅ Chunked streaming for the large responses** — the core-dump image, and one trended row's
  24-hour ring flushed every 64 samples, so the peak string stays a few hundred bytes. The series
  carries the **row's own** unit rather than a hardcoded one, samples as exact integer tenths, and
  nulls whose reason rides **alongside** rather than inside the value array. `t0` is derived from the
  newest sample's age on the monotonic clock — and **omitted** entirely while the clock has never
  synced, so the UI reads out an age rather than a fabricated timestamp.
- **✅ 🧪 Free register probe** ([`logic/hp_probe.hpp`](../main/logic/hp_probe.hpp)): `POST /hp/query`
  reads one caller-chosen register and returns the raw frame plus, by default, every converter the
  requested slice admits — identical decodes merged so the answer names a choice rather than repeating
  a number. It runs on the poll task (one master on a half-duplex bus), one probe in flight at a time,
  and reports a page the unit refuses as a *result* rather than an HTTP error. X10A has no write
  command in either framing, so an arbitrary register is an arbitrary **read**. The closed Settings
  tongue lazily streams the detected profile's exact `main/def` labels through `GET /models?active=1`;
  unresolved/stale detection uses explicitly labelled `generic` examples. Choosing one fills the
  editable tuple. Both responses use a bounded 1 KiB
  sink, and raw negative/partial replies survive. Trusted-LAN only.
- **✅ 🧪 Device-local multilingual UI** ([`logic/ui_lang.hpp`](../main/logic/ui_lang.hpp),
  [`www/locales/`](../main/www/locales/)): the UI detects en/de/es/fr/it/pl/cs/uk/zh/ja/nb/sv/fi from
  `navigator.language`; a persistent picker overrides that per installation and applies **live**.
  English is the startup fallback, while the other catalogs are separately compressed signed-image
  assets. Heat-pump **value labels** stay English — they are X10A register names; schematic
  inspectors, HomeHub row names and value/model accordion explanations are localized.

---

## 5. Home Assistant / MQTT bridge

[`mqtt_ha.cpp`](../main/mqtt_ha.cpp), built on **esp-mqtt** (deep dive:
[`HOME_ASSISTANT.md`](HOME_ASSISTANT.md)).

- **✅ 🧪 HA MQTT auto-discovery.** One retained discovery config per value of the active profile,
  pointing at a shared grouped source topic republished only when the payload changes. The node id
  is the slugified **base topic** (a runtime setting since blob v16), not the board's MAC, so replacing the ESP32 keeps the HA device
  with its entities and statistics instead of creating a second one.
- **✅ 🧪 The entity id carries the register group.** `uniq_id` and the discovery topic's last
  segment are `<group>_<object_id>`, because both are **flat** namespaces while a label is unique
  only within its register page — the catalog carries the same label on two pages, so one entity used
  to swallow the other with no error anywhere. The state payload and the metrics series are
  unchanged; they were already group-nested. `test_entity_identity()` asserts `uniq_id` injectivity
  catalog-wide across all four entity families.
- **✅ 🧪 Retiring or relabelling an entity is an operation, not a deletion.** A discovery config is
  **retained**, so dropping a row only stops refreshing it while the broker replays the old config
  forever. Retired entities are listed, their configs **actively deleted** under both the current and
  the legacy node id, and their `uniq_id`s **burned** so no live entity can inherit a dead registry
  entry.
- **✅ 🧪 Retained-source cleanup is ACK-bounded.** Weather, HomeHub, ENV III and retired-discovery
  tombstones run through one IDF-free scheduler with at most one cleanup QoS-1 message in flight.
  Only its exact PUBACK advances the sequence; explicit outbox-expiry evidence, a joined transport
  stop or fixed-ring evidence loss retries the same step without a second queued item. Pending
  sources stay suppressed, client replacement reconstructs the durable plan, and an 8 KiB esp-mqtt
  outbox cap bounds unrelated QoS-1 backlog. Incremental MQTT packet IDs prevent delivery evidence
  from aliasing concurrent subscription or QoS-1 traffic during that bounded lifetime.
- **✅ 🧪 Detect-only rows are never announced — and are actively retracted.** A row flagged
  `no_publish` is skipped by the cache and its discovery topic zero-lengthed. The row is **kept**
  rather than deleted because a profile's detection signature is the set of pages its rows reference:
  deleting it would hand the page to a feature-richer *wrong* profile.
- **✅ 🧪 Bit flags are typed and numeric.** A bit-flag row is an HA `binary_sensor` with explicit
  `pl_on`/`pl_off` and publishes the JSON **number** `1`/`0` — HA gets a real on/off entity, and a
  metrics consumer (which drops strings *and* bools) finally receives the ~30 binary rows per profile
  that were invisible to it.
- **✅ TLS with ESP-IDF's common-root CA bundle**: credentials present ⇒ `mqtts://` + bundle
  verification, and credentials are **never** sent over a plaintext broker — the client refuses to
  start and says so, with no silent fallback. The size-bounded bundle keeps ESP-IDF's documented
  approximately 99% public-root coverage; a broker chained only to a rarer excluded root is rejected.
- **✅ Save-time broker pre-flight**: `POST /set_mqtt` verifies before it persists — DNS, a
  non-blocking TCP probe, then a short-lived client that must actually `CONNECT` and authenticate —
  so a wrong host, closed port or bad password is rejected inline at Save. Under heap pressure it
  answers a retryable `503` rather than skipping the check or OOM-ing the live bridge. Host/port come
  from [`mqtt_uri.hpp`](../main/logic/mqtt_uri.hpp), whose scheme defaults track **esp-mqtt's own**
  so the probe dials the port the client will.
- **✅ Explicit credential clearing**: empty username+password means *keep* (the modal never
  prefills), so `clear_creds` is the explicit removal signal — the only path from an authenticated
  `mqtts://` broker back to an anonymous one.
- **✅ Availability (LWT)**: a retained `offline` last-will flipped to `online` on connect; after
  activation, X10A must remain unanswered for 15 s before it marks the installation offline, while
  shorter whole-sweep dropouts preserve availability without retaining an empty X10A document.
- **Read-only by design.** No command subscriptions and no actuation. The optional inbound reference
  subscription captures and qualifies an input for display only; it cannot reach either pump link.

---

## 6. Diagnostics & observability

Everything needed to explain a crash *after the fact*, from the field, without a serial cable:

- **✅ Core dump to flash.** The reset reason and `esp_core_dump_get_summary()` are read **once at
  boot** and cached, never re-parsed on a request path. The cheap presence flag is deliberately *not*
  cached, so a dump erased mid-session cannot strand a banner. A dump whose `app_elf_sha256` does not
  match the **running** build — an orphan that survived an OTA — is erased on **proof**, so
  `coredump` never advertises a download the decoder would reject.
- **✅ 🧪 The 24-hour plant checkup survives a reboot** ([`logic/checkup_persist.hpp`](../main/logic/checkup_persist.hpp)).
  `.noinit` preserves the active window across power-preserving resets; the upper-flash append
  journal additionally records completed enabled diagnosis hours and restores compatible coverage
  after an ordinary reboot or power loss. The open hour can be missing after an interruption. The
  lifecycle is carried as a duration (the monotonic anchors restart), and a **layout fingerprint**
  over the geometry, every row locator and every counting threshold invalidates a record when an
  update changes what a stored counter means.
  Two refusals stop the window outliving its source: safe mode never adopts, since nothing there would
  age it, and the poll loop keeps the clock running while the bus is unidentified. Cycling and
  Defrost retain separate compact X10A outdoor minimum/mean statistics over their own eligible
  populations; that context is visibly sourced and cannot alter a check's threshold or verdict.
- **✅ 🧪 English-only maintained documentation** ([`english_docs.mjs`](../tools/user_docs/english_docs.mjs)).
  The user-docs gate scans project Markdown for high-confidence German prose while continuing to
  require bounded English/German diagnosis copy. The separate localization gate requires complete,
  source-current copy in all thirteen device-UI languages.
- **✅ 🧪 The 24-hour trends survive a reboot** ([`logic/history_persist.hpp`](../main/logic/history_persist.hpp)).
  Rings live in `.noinit` DRAM rather than NVS; the official 8 MB layout appends dense 256-byte
  records to the upper-4-MiB partition. CRC, a last-written commit and rotating sectors fail closed
  on torn writes. After a successful scan, SNTP sync and first eligible commit, a power cut loses at
  most the open or just-closed bucket; before that commit flash has no RAM-only samples to restore.
  Restore waits for SNTP,
  batches four rings per poll tick and derives spans from journal buckets. Browser `sessionStorage`
  is not a history medium, and there is no fallback for the former 8 KB partition.
  `.noinit` is sealed by the order-sensitive catalog fingerprint. Flash precedes each generation
  with daily-refreshed semantic-id manifests, so unchanged series survive insertion/reordering while
  new or reinterpreted series alone start empty; unknown/ambiguous layouts fail closed and the exact
  pre-disinfection 31/12/3 catalog has an adapter. `/status.history.persist` reports RAM adoption;
  compatible flash can still refill it after SNTP.
- **✅ 🧪 The heap watchdog** ([`logic/heap_watchdog.hpp`](../main/logic/heap_watchdog.hpp),
  [`heap_guard.cpp`](../main/heap_guard.cpp)). Every other OOM guard in this firmware turns "out of
  memory" into "recover and continue" — `handle_all` answers 503, an allocating task loop catches
  `std::bad_alloc` and skips the cycle keeping its last good state, a publish is dropped — and each
  is right to, for a **transient** shortage. Nothing asked what happens when it never recovers.
  Composed, those guards describe a device that is powered, associated, answering 503 to everything
  and republishing nothing, indefinitely, while reporting no fault at all: a hang, which is the worst
  failure shape available, because a crash reboots in seconds and leaves a reset reason, a core dump
  and a syslog record, whereas a wedge looks exactly like a powered-off device and heals never. So
  when the largest **contiguous internal** block has stayed under 4 KB for five unbroken minutes —
  long enough that no burst can reach it, and an in-flight OTA *clears* the run rather than pausing
  it, so a restart can never land mid-install — the device restarts deliberately, leaving a
  `heap_rst` breadcrumb on `/status.sys.heap_restarts` and giving up after five consecutive tries.
  Sampled at the top of the poll cycle beside the board trends, which is the one path in that task no
  branch can skip. The ladder **ends in safe mode** rather than in a degraded stay-up: the boot that
  inherits the full count never starts the poll engine or the MQTT bridge, which both frees what
  those two were holding and bounds the ladder by construction (safe mode creates no poll task, and
  the sampler is only called from it). That replaced a stay-up state measured on hardware to lose
  HTTP entirely within ~7 minutes — the recovery surface the cap existed to keep (legacy-407);
  `/status.sys.safe_mode_cause` separates it from a crash loop, because the two need opposite advice. Arming and recovering ask **different thresholds** — a run opens under 4 KB and
  closes only above 8 KB — because answering both with one number let a heap hovering *at* the line
  reset its own countdown on ordinary allocator churn and never restart, measured on hardware while
  `/status` and `/values` were already answering 503 (legacy-399); the `Armed`/`Recovered` narration is
  throttled like the countdown line for the same 6 KB-diag-ring reason, with suppressed transitions
  counted rather than dropped silently. Two deliberate limits: **`MALLOC_CAP_INTERNAL`**, not `MALLOC_CAP_DEFAULT` —
  the latter answers from PSRAM on a board that has it, so every largest-block figure in the firmware
  now goes through one shared sampler rather than five call sites each spelling out a mask — and
  **not covered in safe mode**, where the poll task does not run; safe mode has already shut down the
  five largest allocators and is itself the reachable state a restart would be trying to produce.
- **✅ Offline symbolication** ([`decode-coredump.sh`](../scripts/decode-coredump.sh)): the raw image
  is symbolized against the matching **unstripped `.elf`** CI archives per build. The dump embeds
  `app_elf_sha256` and the device reports the same, so a wrong ELF is *caught*, not silently
  mis-decoded.
- **✅ 🧪 Reset/crash classification** ([`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp)): the
  summary becomes `/status.last_crash` and a **retained** crash topic driving one diagnostic entity
  (a "dump waiting" flag — reason and backtrace only, never the raw dump or any secret). The topic is
  **crash-only**: a normal boot publishes nothing on a clean broker, while a stale record is deleted
  once the device reboots cleanly. `static_assert`s pin the IDF reset enum so a renumbering fails the
  build rather than mislabeling every crash.
- **✅ 🧪 Deleting a crash report** (`POST /crash/dismiss`): a *device* action rather than a per-page
  hide — status, the retained topic and every browser agree at once. **Erase first, mark second**, so
  a failed erase answers `500` and marks nothing rather than reporting "no crash" with the dump still
  downloadable. RAM-only by design: a persisted dismissal could suppress a *new* crash. The one
  erase result that does **not** block it is `ESP_ERR_NOT_FOUND`, which means the board has no
  `coredump` partition at all — the state of every device flashed before one existed and upgraded
  over the air since, because OTA writes the inactive app slot and never the partition table
  ([`partitions.csv`](../partitions.csv) states the same premise for `history`). There is nothing to
  destroy there, so the dismissal's other job — clearing the report — must still happen; treating it
  as a failure answered `500` forever, and a fault reset carries no dump often enough (a stack
  overflow overruns it) that those boards saw exactly the banner no action could clear. Every other
  error still blocks, because then a dump may genuinely still be downloadable.
- **✅ 🧪 22-entity device heartbeat** ([`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp)): a
  **flat** JSON of heap (free / min-free / largest-free-block, the true OOM limit), uptime, reset
  reason, WiFi RSSI + reconnects + MAC/BSSID, MQTT counters and X10A bus stats — published
  independently of profile detection, so board health is visible while the model is still `auto`.
  The reset reason rides as a slug **and** as numbers, because a metrics pipeline keeps numeric
  fields and drops strings. `bus_ou_held_over` reports **source** freshness rather than link health.
  `mqtt_skipped` / `mqtt_quiesced` / `poll_skipped` count the 1 s cycles that produced **nothing** —
  an OOM guard catch, a deliberate OTA/weather TLS hold-off, and a sweep that never reached the bus (legacy-380). They
  are the counters that made a silent loss visible: 337 dropped publishes in 30 days had existed only
  as lines in a `/diag` ring the next chatty boot overwrites. `heap_restarts` — the 22nd entity —
  attributes the one reboot nothing else can: the heap watchdog restarts with `esp_restart()`, so
  every other field reports the same `sw` a settings save produces.
- **✅ Stack-headroom telemetry** ([`stack_watch.hpp`](../main/stack_watch.hpp)): five deep tasks
  (httpd, poll, MQTT, HomeHub and Weather) record their own FreeRTOS high-water mark and the
  heartbeat publishes all five as `*_stack_min_free_bytes`. Weather samples again immediately after
  its TLS/HTTP/JSON interval, before the causal refresh token can complete. The heap has `/status.sys`, two trend
  rings and a watchdog; the stack had a core dump's task table, which exists only once the board has
  died — and this firmware has shipped three stack overflows. `null` means never sampled, never zero
  headroom. The OTA delivery task uses an allocation-free sampler/status path; its boot-local result
  appears only as `ota_stack_min_free_bytes` on compact `/ota/status`, so the delivery gate captures it
  before the task reboots into the candidate. The sole exact historical `1.0.2` ordinary-bench writer
  predates that field; its one writer-side stack minimum remains unknown while completed validation,
  heap minima, target probation and stress stay mandatory. Release HIL also requires at least 1 KiB of Weather
  headroom after its mandatory real refresh. Payload-only: the audience for a headroom trend is
  whoever upgrades the firmware.
- **✅ 🧪 Always-on system health**: `/status.sys` carries heap headroom, the since-boot low-water
  mark, the largest contiguous block, the heap-watchdog restart count, per-task stack headroom
  (`stack_min_free_bytes`), the three legacy-380 cycle-loss counters, the reset-reason slug and the
  safe-mode flag. Unlike
  `last_crash` it is present on **every** boot, and unlike the heartbeat it needs **no broker** —
  which is why the stack figures are here too: every MQTT publish is X10A-gated, so a board with a
  silent bus, or one in safe mode, would otherwise report them nowhere.
- **✅ Build identity** — `/status.app_elf_sha256` ties a running device to the firmware that
  produced any dump, and the syslog boot line puts the same hash in the **log stream**.
- **✅ 🧪 Getting the evidence off the board — and what must not come with it.** *Settings → Report a
  bug* collects status, values and log into one pasteable report and opens the prefilled issue form.
  It is filed as a *public* issue, which is defensible only because the board **redacts first**
  ([`logic/redact.hpp`](../main/logic/redact.hpp)) — in the *firmware*, so the UI collector and a
  manual `curl` cannot become two privacy rules. The value is replaced and the **key kept**, since a
  dropped field is indistinguishable from an older build. The one artifact that stays private is a
  **core dump**: a short password lives *inside* its `std::string` by small-string optimisation, so a
  stack frame can carry it.
- **✅ In-RAM diag ring** (`GET /diag`) and a **status indicator** encoding six operating phases plus
  two the recovery button asserts. Two back-ends — a GPIO LED and a WS2812 over RMT — render **one**
  host-tested pattern table, with pin, driver and polarity from NVS rather than Kconfig, since CI
  publishes a single image for boards that disagree about their onboard parts. Because a monochrome
  LED sees no colour, every phase stays distinguishable by blink *shape* alone.
- **✅ 🧪 Physical recovery button** ([`logic/button.hpp`](../main/logic/button.hpp)): a 5 s hold
  erases config, legacy WiFi storage, the history journal plus trend/dwell RAM, and any raw coredump;
  it reboots into the portal only when every privacy erase succeeds. This is the only reset that does
  not go through the network, which is exactly the failure the other paths cannot reach (the device
  joined a network the user can no longer get onto). An **arm checkpoint** lights the warning while there is still
  time to let go, and a debounced release means one bounced sample can neither cancel a hold nor
  restart its clock. **Disabled by default**, since a floating pin reading "pressed" would wipe an
  untouched board.
- **✅ 🧪 SNTP wall clock, runtime-configurable** ([`sntp_time.cpp`](../main/sntp_time.cpp)): before
  it, the device had no timestamp anywhere except uptime. Non-blocking, so it idles harmlessly even
  in AP-only setup mode; before the first sync both `/status.ntp` and the syslog TIMESTAMP fall back
  to `null`/`-` rather than a fabricated epoch date.
- **✅ Off-device log forwarding** ([`syslog.cpp`](../main/syslog.cpp)): every diag line is also one
  RFC 5424 UDP datagram to an optional collector. Delivery is gated on **DNS only** — the
  reachability probe is advisory, since a healthy collector may firewall ICMP — and a send failure is
  classified hard vs. transient so a chatty stream cannot drive a resolve storm.
- **✅ 🧪 One-shot boot replay to syslog** ([`logic/bootlog.hpp`](../main/logic/bootlog.hpp)): the
  crash summary is captured before WiFi and the syslog task exist, so it could only ever reach the
  in-RAM ring, where a chatty failure overwrites it within a minute. On the first DNS resolve of a
  boot it is replayed once, straight down the socket, as **single-line datagram-sized** records.

---

## 7. Heat-pump protocol engine (X10A, and the optional HomeHub Modbus link)

Deep dives: [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md), [`REGISTERS.md`](REGISTERS.md),
[`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md).

- **✅ Dedicated hardware UART at 9600 8E1** on `UART_NUM_1`, physically separate from the USB
  console so device logs never collide with heat-pump traffic. The driver installs **once**; a pin
  change is a register-only remap, not a delete + install
  ([`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp)) — the old reinstall-per-swap fragmented the
  heap on a silent bus, where the detect sweep alternates pins twice a second.
- **✅ 🧪 Poll engine** ([`hp_poll.cpp`](../main/hp_poll.cpp)): profile registers → query → decode →
  thread-safe cache that the web UI and MQTT read. It publishes to no client itself. **X10A-only** —
  the HomeHub is a second, independent stack, so nothing here branches on a source.
- **✅ 🧪 Second SOURCE: Modbus TCP to a Daikin HomeHub (EKRHH).** An optional stack **beside** the
  X10A tap, not an alternative to it: separate tasks, caches and link states, because the two fail
  for entirely unrelated reasons and coupling them would let either failure mask the other. It costs
  nothing after an absent decision — an empty searched address creates no task or socket. Fresh
  firmware performs one bounded automatic search on its first networked boot and persists even a
  miss. A lwIP socket around
  host-tested MBAP framing with request-**bound** response parsing, a whole-reply deadline and a
  socket dropped on any desync. Both the initial search and the manual dialog action are filtered by
  hostname because this firmware answers that same browse; only the initial search or dialog Save
  persists a result. Explicitly saving empty permanently disables Modbus and dependent diagnosis. The
  link is **READ-ONLY as a property of the code**: no write entry point, function-code builder or
  value encoder exists anywhere under `main/`.
- **✅ 🧪 Batched reads on two cadences** ([`logic/modbus_plan.hpp`](../main/logic/modbus_plan.hpp)):
  the hub is **shared** — Onecta, the MMI, evcc and any LAN collector use the same `:502` — so what
  this firmware asks for is a question about someone else's device. The 32 EKRHH offsets fall into
  ten contiguous runs. The two diagnosis gates (input 53 and 38) and the plant-outdoor context
  (input 44) are time-sensitive, so a **full** cycle is ten requests every fifth poll tick and the
  ticks between it read their three batches alone: **32 → ~4.4 requests/s**. A fast cycle commits
  only those two gates and that context — its thirteen registers are not a general cache — and a
  batch answered with a Modbus exception is re-read register by
  register for the rest of the session, because an exception names one register and a batch cannot
  say which. The plan is resolved at **compile time** into flash and `static_assert`ed where it is
  built, so a register added into a gap re-prices the link visibly.
- **The two sources meet in exactly one place** ([`logic/homehub_map.hpp`](../main/logic/homehub_map.hpp)):
  a register is paired to an X10A row **structurally**, reusing the trend ids and never the label —
  the catalog spells one quantity many ways and reuses tags across different quantities, so a label
  match would be both incomplete and wrong. The UI shows both values with their difference, and lets
  Modbus stand in, marked in its own colour, when X10A is silent.
- **✅ 🧪 Silent-bus detect backoff** ([`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp)):
  while nothing answers, the sweep stretches toward a ceiling by **skipping ticks**, so the 1 s
  watchdog reset still fires and the ceiling stays a detection-latency choice rather than a WDT
  constraint. A bus answer or an explicit re-detect resets it at once.
- **✅ 🧪 Auto-detection every boot** ([`logic/detect.hpp`](../main/logic/detect.hpp)): a protocol
  sweep and page probe build a fingerprint that narrows the Altherma-only signatures to a candidate
  set. The physical **link** is cached in NVS; the **model** is re-detected in RAM every boot, so a
  swapped unit is re-identified with no reconfiguration. The fingerprint carries **both** capacities
  — the outdoor unit's own report and the indoor rated code — reported separately, since the two
  halves of a plant are routinely different sizes. Because the probe gathers the unit's **identity**
  rather than its values, each page is retried before its bit is cleared and a sweep that matched
  *nothing* waits for a second sweep to agree before falling back to `generic`. Narrowing is **not**
  resolving: an ambiguous set names the families rather than asserting one model.
- **✅ 🧪 Value converters** ([`logic/convert.hpp`](../main/logic/convert.hpp) + the generated
  [`def/`](../main/def) profiles): the converter id decides how each raw register field becomes a
  typed, unit-carrying value — the riskiest part of the port, and the most heavily host-tested.

---

## 8. The host-tested pure-logic core (the quality backbone)

The single most distinctive engineering choice: **all the risky, target-independent logic lives in
IDF-free headers under [`main/logic/`](../main/logic) and is verified on the host** — no board, no
Docker, in seconds ([`test/README.md`](../test/README.md)).

- **The fast loop** — [`run-mock-tests.sh`](../scripts/run-mock-tests.sh) compiles and runs the suite
  with the plain system toolchain. CI adds gcov and enforces a **95% executable-line floor** over
  `main/logic/` itself. Within each compiler execution profile, a per-header ratchet compares
  aggregate gcov **taken/total branch-edge counts**, preventing a large header from hiding a count
  regression in a small one. Local profiles bind compiler family/major; authoritative GitHub
  profiles additionally bind the hosted runner OS/image so packaging drift cannot borrow another
  environment's reviewed counts. Equal counts can represent different edges, so this is not branch-
  identity evidence. Selftests prove empty, malformed, missing-baseline, unknown-runner and
  below-floor reports fail closed. This is the real "run it and see" loop even in an environment
  that cannot build firmware or USB-flash.
- **The rule** — new decode/config/discovery logic goes in `main/logic/` with a `CHECK`, never buried
  in a device-only `.cpp`. The [`add-logic-test`](../.agents/skills/add-logic-test/SKILL.md) skill
  and the [`x10a-decode-reviewer`](../.codex/agents/x10a-decode-reviewer.toml) agent enforce it.
- **The hostile-input loop** — [`run-sanitizer-fuzz-tests.sh`](../scripts/run-sanitizer-fuzz-tests.sh)
  drives deterministic malformed frames, strings, URLs and numerical boundaries through production
  logic. The runner probes ASan+UBSan as a capability; CI fails unless both compile and run, while a
  local host falls back to UBSan only after the ASan probe fails. Its fixed corpus makes a failure
  reproducible; it is not a claim of open-ended fuzzing.
- **The host runtime scenarios** — [`run-runtime-integration-tests.sh`](../scripts/run-runtime-integration-tests.sh)
  call selected production config serializers, X10A/Modbus parsers, MQTT publish gating and bounded
  body/chunk logic through host-only fake time, storage, serial, TCP, broker and HTTP adapters. Eight
  scenarios model failed persistence, reconstruction, allocation failure, interleavings,
  fragmentation and reconnects. Two more use real POSIX `socketpair`/`recv` traffic to prove that
  `shutdown(SHUT_RDWR)` aborts trickling headers and bodies at an absolute deadline and is joined
  before descriptor reuse. These ten scenarios do not execute ESP-IDF target glue, real NVS or the
  production MCP/HTTP/MQTT stacks. Target compilation and hardware evidence remain separate gates.
- **The browser loop** — the deterministic DOM suite covers interaction contracts, while
  [`run-browser-render-tests.sh`](../scripts/run-browser-render-tests.sh) opens the assembled UI in a
  real Chrome engine for all shipped locales at mobile and desktop widths. It checks actual layout,
  the native accessibility tree, keyboard/Escape behavior, reduced motion and console errors.

**🧪 What's covered.** Each header states its own reasoning; this is the map, not a re-derivation:

| Concern | Headers |
|---------|---------|
| Wire decode | `crc`, `convert`, `registers`, `value_def`, `error_codes`, `hexdump`, `raw_capture`, `hp_probe` |
| Value adjudication | `availability`, `conv_override`, `label_override`, `fault_state`, `ou_stale`, `lwt_select`, `cop_scope`, `feature_gate`, `profile_view` |
| Detection | `detect`, `detect_backoff`, `uart_plan` |
| Config & board | `config_model`, `config_store`, `board_pins`, `board_presets`, `env3`, `ui_lang` |
| MQTT / HA | `discovery`, `ha_device`, `mqtt_base`, `mqtt_cleanup`, `mqtt_group`, `mqtt_uri`, `heartbeat`, `homehub_map`, `modbus`, `weather_mqtt` |
| HTTP | `http_body`, `payload_complete`, `http_surface`, `query_flag`, `captive`, `json`, `mcp`, `chunk_sink`, `redact` |
| OTA & boot | `health_gate`, `http_deadline`, `version_cmp`, `ota_manifest`, `ota_hil_feed`, `ota_channel`, `ota_transport`, `boot_guard`, `crashinfo`, `bootlog`, `reset_reason`, `heap_watchdog` |
| Network policy | `wifi_rollback`, `link_watch`, `syslog_policy`, `timestamp` |
| On-board analysis ([`PLANT.md`](PLANT.md)) | `history`, `checkup`, `outdoor_evidence`, `refrigerant_service`, `state_dwell`, `heating_curve_diagnosis`, `open_meteo`, `circulation_source` |
| Local I/O | `led_pattern`, `button` |

Four properties of that core are worth naming because they are not obvious from the list:

- **🧪 Rules with no firmware caller are still gated — and so is the copy that ships.**
  `lwt_select`, `ou_stale` and `cop_scope` exist so a **browser** rule is asserted
  against the whole `def/` catalog in CI, and those three are exactly what the parity gate below
  covers. (`feature_gate` is caller-less too, but for the other reason: it is a policy the browser
  cites rather than re-implements, so there is no second copy to diff.)
  On its own that gates the C++ copy and says nothing about
  the JavaScript one, which is the copy the user gets: a looser second copy is not a test of the
  rule, and this project has paid for that once, when a leaving-water pattern in the browser matched
  the bizone kit's **mixed-zone** row and put a correct number on the wrong sensor in ΔT, heat output
  and COP at once. [`check-presenter-parity.sh`](../scripts/check-presenter-parity.sh) closes it: a
  host dumper emits golden decisions from the real headers over every distinct (label, register) pair
  the catalog produces plus one adversarial label per structural trap, and the **production**
  `schematic.js` re-decides the identical inputs in the DOM-free VM harness the UI suite already
  uses. Nothing in the checker re-implements a rule — that would be a third copy, and drift is the
  whole finding — which is also why the tri-state "UNKNOWN is not OFF" collapse had to move *into*
  the browser's `copPlan` to be reachable at all. A renamed or inlined-away rule exits 2 rather than
  passing by comparing nothing, and [`selftest.sh`](../tools/presenter/selftest.sh) re-seeds each way
  the two can diverge — including the shipped mixed-zone defect.
- **🧪 Metric identity is frozen.** A published row reaches the metrics store and Home Assistant
  under identifiers derived from its **label**, so editing a label retires one series and starts
  another at zero with no error anywhere. `test_metric_identity()` freezes the complete identifier
  set, so a rename, a dropped row or a change to the slug rule fails the suite and prints what moved.
  Regenerating the list is the **decision**, not the fix.
- **🧪 …and so is what a detection tie-break can move.** Detection picks one representative, so where
  the ranking **ties**, the pick decides the labels — and the frozen set above cannot catch that,
  since both spellings are already in it. Separate tests freeze the identifiers a tie can move and
  assert the pick is **order-independent**, so reordering a file cannot silently reassign a series.
- **✅ The limit of all of the above — and the second loop that covers it.** The `CHECK`s verify the
  logic they are handed; none can see a value that is well-formed, compiles, drifts no doc and is
  *physically false*. So the value catalog has its own host loop:
  [`run-domain-audit.sh`](../scripts/run-domain-audit.sh) runs the **real** converters over the
  **real** catalog and cross-checks both against [`REGISTERS.md`](REGISTERS.md), reporting wrong
  converters, spec/layout drift, cross-profile outliers, non-temperatures typed °C, straddling byte
  windows and one wire field described by two physical units — each with a decode witness. Its
  [`selftest.sh`](../tools/domain/selftest.sh) re-introduces every defect the gate was built for, so
  a checker that has quietly stopped checking cannot pass as clean. The judgement half is the
  [`domain-review`](../.agents/skills/domain-review/SKILL.md) skill, a PR-merge gate on every ordinary
  or local/manual merge; only the mechanically attested Renovate Action-pin-line class is exempt.
- **✅ Diagnostic claims keep their evidence.**
  [`run-diagnostic-evidence-audit.sh`](../scripts/run-diagnostic-evidence-audit.sh) binds every visible
  plant-diagnostic row to its primary external source, the exact implemented rule and a claim
  boundary. Its fingerprint follows the evaluator and sampling semantics, while
  [`selftest.sh`](../tools/diagnostic_evidence/selftest.sh) mutates each required part so a ceremonial
  or stale evidence ledger fails CI rather than preserving an unsupported reassuring sentence.

---

## 9. Build system & release engineering

- **✅ Deterministic and reproducible toolchain.** There is no local ESP-IDF install:
  [`idf-docker.sh`](../scripts/idf-docker.sh) runs every build in the `espressif/idf` image, its
  version **read at runtime from CI's workflow** — one source of truth, so local builds cannot drift
  from CI. [`idf-version.sh`](../scripts/idf-version.sh) is the only shell extraction of that pin,
  shared by the local image selection and CI's ccache key, and exits non-zero rather than printing an
  empty version: a second copy of the grep would fail silently in the worst direction. The project
  records its real floors too: ESP-IDF 6.0 (W5500 2.x needs that `esp_eth` API), CMake 3.22 and
  GNU++17 for `main`, matching the host logic suite instead of inheriting ESP-IDF's changing app
  dialect. `CONFIG_APP_REPRODUCIBLE_BUILD=y` removes wall-clock metadata from the application image;
  a manual release additionally builds the unsigned app again in a clean build directory and
  requires byte-for-byte identity before signing.
- **✅ Locked managed-component graph.** [`dependencies.lock`](../dependencies.lock) commits the
  exact direct and transitive versions plus registry content hashes resolved by ESP-IDF 6.0.2.
  Dependency changes therefore occur as reviewable diffs: change a range in
  [`idf_component.yml`](../main/idf_component.yml), run `idf.py update-dependencies` through the
  Docker wrapper, and review both. The ccache key includes the lock as well as IDF and Kconfig.
- **✅ Build-input contracts.** `CONFIG_IDF_TARGET="esp32s3"` makes a clean `idf.py build` select the
  only supported target without mutable local setup. After configuration,
  [`check-sdkconfig-defaults.py`](../scripts/check-sdkconfig-defaults.py) compares every declared
  assignment with generated `sdkconfig`; an unknown, renamed, promptless or overridden symbol can
  no longer read like a guarantee while being ignored. Top-level `COMPONENTS main` limits CMake's
  graph to the firmware root and the transitive components it actually requires.
- **✅ Size evidence, not only a red ceiling.** The staged app still fails above the 1,952 KiB
  policy limit, including the signature sector when present. Each build now also archives ESP-IDF's
  json2 region/section report and publishes a Markdown job summary with the current app, Flash,
  DIRAM, IRAM and `.bss` usage, so growth is visible before it reaches the ceiling.
- **✅ A pinned warning contract on `main/`.** Three constructs in that component are written the way
  they are *because* a warning class is fatal there, and nothing in the repo made that true — they
  held only while ESP-IDF's own defaults happened to make them so, and IDF's `-Werror` handling is
  version- and Kconfig-dependent. `-Werror=return-type`, `-Werror=format` and `-Werror=unused-result`
  are now pinned on that component alone. Scoped rather than global for two independent reasons: a
  Kconfig key would hold ESP-IDF and the managed components to a contract that is not ours to demand,
  and `sdkconfig.defaults` is hashed into the ccache key, so a diagnostic-only change there would
  discard every cached object it cannot invalidate.
- **✅ A pinned stack contract on the `/status` builder.** `main/CMakeLists.txt` pins
  `http_status.cpp` at `-Os` independently of the project-wide setting, because
  the status serializer has overflowed a task stack twice and at `-Og` its frame reached
  **11776 bytes** against ~2.2 KB of actual locals — the rest one stack slot per string temporary in
  a 760-line function. The original `-Os` change took it to **3744** and the deepest httpd path from
  14512 to 6480 bytes. The release image now also uses size optimisation globally to fit its
  embedded catalogs. After
  the refrigerant-service object and bounded MCP status sender, the 2026-08-27 release ELF measures
  the sole bounded serializer at **4896**. The historical manual call-path walk measured **7552**
  bytes, while the automated conservative MCP gate sums **7664** of 16384 and leaves **8720 bytes**;
  the stack itself remains unchanged. The trade — less exact backtraces in
  the one file whose core dumps mattered — and the
  reproduce command are stated where the pin lives and in
  [`ARCHITECTURE.md`](ARCHITECTURE.md#memory-constraints).
  [`check-stack-budget.py`](../scripts/check-stack-budget.py) now performs that conservative call-path
  calculation on every CI-pinned ELF and fails when a required symbol disappears or a frame/path
  exceeds its committed budget. The ratchets include nested OTA manifest fetch, compact OTA status,
  the HIL-aware `/ota/check` acceptance path, the rollback-critical `ota_health` task, and both
  Weather task branches (download and JSON parse). All three task families' path ceilings leave at
  least 1 KiB of their configured stacks; the health path carries a
  separate reviewed 2048-byte IDF/logging/exception allowance. Live FreeRTOS high-water marks remain
  separate hardware evidence; release HIL captures the short-lived delivery task before reboot and
  rejects missing or sub-1-KiB Weather evidence after the deterministic live refresh.
- **✅ A pinned stack contract on MQTT publishing.** The release-wide `-Os` called-once inliner
  folded reference/circulation helpers into `mqtt_task` on ESP-IDF 6.0.2 and grew that fixed frame
  from the historical 1040 bytes to 2304 bytes. `mqtt_ha.cpp` therefore retains natural helper call
  boundaries with `-fno-inline-functions-called-once` and makes any per-function frame above 2048
  bytes a build error. The measured task frame is 1120 bytes and the largest current frame in that
  object is 1584 bytes; the FreeRTOS task remains 6144 bytes. This ceiling guards fixed frames only:
  changes must still remeasure the complete ELF call path and the live MQTT high-water mark, while
  preserving the dev.13+ scalar/cache and contiguous-heap protections described in
  [`ARCHITECTURE.md`](ARCHITECTURE.md#memory-constraints).
- **✅ Ratcheted format invariants.** [`run-format-check.sh`](../scripts/run-format-check.sh) rejects
  non-UTF-8 text, CRLF, missing or duplicate final newlines, tabs and trailing whitespace in the
  maintained C/C++ surface while excluding generated profile tables. CI then requires exact
  clang-format 18.1.3 for every new file and changed hunk, so existing hand-formatted drift is not a
  prerequisite rewrite and a runner's incidental formatter version cannot change the result. The
  canonical full-tree invocation, including maintained tooling sources, is
  `CLANG_FORMAT=clang-format-18 scripts/run-format-check.sh`.
- **✅ Agent instruction and configuration integrity gate.** [`AGENTS.md`](../AGENTS.md) is the
  runner-neutral always-loaded contract and stays below 24 KiB.
  [`run-agent-instructions-budget.sh`](../scripts/run-agent-instructions-budget.sh) also validates
  canonical skill identity and OpenAI metadata, focused-reviewer configuration, lifecycle-hook
  dispatch, the credential-safe [`gh` wrapper](../scripts/gh-with-git-credentials.sh), the
  exact noninteractive PR-publication form, the synchronous expected-head REST merge shape, and
  explicit safety invariants. The fix for a budget failure is moving narrative to `docs/`, never
  trimming a rule or raising the limit;
  [`tools/agent-config/selftest.sh`](../tools/agent-config/selftest.sh) proves each check fails closed.
- **✅ 🧪 PR-text hygiene gate.** [`check_pr_hygiene.mjs`](../tools/pr_hygiene/check_pr_hygiene.mjs)
  checks the exact PR commit range and current title/description for shaped personal information and
  high-confidence German prose. Every ordinary merge also requires a current-head
  [`pr-hygiene-review`](../.agents/skills/pr-hygiene-review/SKILL.md) of the diff and the privacy or
  non-English cases a shape check cannot recognize.
- **🔭 No generic static-analyser gate — measured, not assumed.** Recorded here so it is not
  re-litigated: clang-tidy over the pure headers reports thousands of findings on a blanket config
  (over half of them this project's own `CHECK` macro) and, curated to bug-finding checks, roughly
  fifty with **zero real defects** — the plausible ones all flag deliberate, documented code. The
  yield is that low for a structural reason visible in the source: the bug classes are **typed** out
  rather than linted out, and the defects this project actually ships fixes for are domain and
  resource-budget defects, which §8's audits already cover. There is no `.clang-tidy` file either —
  an inert config reads like a guarantee while doing nothing.
- **✅ Digest-pinned actions — the CI supply chain.** Every third-party Action is referenced by full
  commit SHA with the readable version as a trailing comment. A tag is a movable pointer, and that
  matters more here than in most repos: the trusted-main `trusted_build` job materializes the **offline OTA signing key**
  from a secret, so an action swapped underneath the pipeline is positioned to exfiltrate the key
  that makes an image trusted by every deployed board. Renovate both enforces the pin on anything
  newly added and raises PRs to move the digest forward. GitHub-native automerge is enabled only for
  the Renovate runner Action; protected-base CI waives human review records only when current same-repository
  metadata and every complete immutable file patch for the one-commit head prove the sole edit is the
  like-for-like Renovate runner pin in `renovate.yaml`. Missing/unreadable files or a partial
  three-file context hard-fail; malformed or ineligible complete context follows ordinary review.
- **✅ CI event and trust split**: one fast, hardware-free `mechanical_gates` job runs deterministic
  checks under the ordinary `pull_request` event, and the required `build` job propagates its result
  before conditionally compiling. Independently, the data-only `pr-policy.yml` workflow supplies the
  required `gates` check under `pull_request_target`, using only the protected-base verifier and
  never loading PR code. Branch protection requires both checks. Mechanical checks are **steps of
  one job, never a job each**; the additional policy job is an intentional isolation boundary.
- **✅ Crash-decodable and size-auditable.** CI archives the unstripped `.elf` (xz-wrapped, + the
  sha256 of the ELF inside) and the json2/Markdown size reports per version/PR. A release's copy is
  a Release asset and does not expire; a dev build's artifact lives 3 days, while an open PR's lives
  at most 7 days and is deleted immediately on merge because artifact storage is metered.
- **✅ One Pages publisher.** The installer is served from the **`gh-pages` branch**. The branch model
  is what lets the release root and the `dev/` channel be published independently — an atomic
  whole-site Actions deployment cannot — so the `deploy-pages` path is deliberately absent rather
  than redundant.
- **✅ Signed artifact continuity and external readback.** The trusted build parses the Secure Boot
  v2 signature sector itself, checks its CRC and image digest, verifies RSA-PSS with exponent 65537,
  and requires the public-key digest committed in `tools/release/ota_signing_key_digest.txt`. That
  digest also enters manifest provenance. The write-capable publisher receives no private key,
  repeats the signature/provenance checks after artifact handoff, then cache-busted reads the exact
  manifest and app bytes back from Pages. Release binaries are downloaded from the created GitHub
  Release and byte-compared too.
- **✅ Hardware-gated manual releases.** A release (not an ordinary dev publish) must pass the
  isolated self-hosted `release-hil` job before the publisher can run. The CI-only canonical mode
  leases the exact verified candidate on a private HTTPS feed and proves it is served byte-for-byte.
  The ordinary release binary receives that URL pair transiently on `/ota/check`; its offer binds
  URLs, generation, channel, version and SHA, and `/ota/update` consumes the same snapshot. The gate
  installs once and requires explicit `pending_verify` plus operation-local heap and OTA-task stack
  evidence before a controller-owned fail-safe power cycle, then verifies return to the distinct
  bootstrap with configuration intact. The second install must reach the same bounded pre-commit
  evidence by 45 seconds of uptime before its non-renewable 80-second watchdog is explicitly
  released. It then survives health probation, reports explicit `valid`, is cold-cycled separately,
  and retains configuration/history. Finally, that valid candidate — not merely the bootstrap —
  downloads, hashes, signature-verifies and selects the separately root-pinned bootstrap through a
  distinct static feed. The gate captures the candidate writer's heap/OTA-stack minima, observes the
  bootstrap pending, hard-cycles it back to the valid candidate, rechecks persistence, and only then
  runs live stack plus combined HTTP/MQTT/X10A/weather stress; because Weather is mandatory, its
  post-refresh high-water mark is a mandatory stack task in the private inventory. Root policy, inventory, both artifact
  identities/feeds and the feed/power controllers are distinct and deny production; the job receives
  no signing key.
- **✅ Releases are manual; merges publish a dev channel.** A push to `main` stamps a dev version and
  republishes `dev/`; a release is an explicit workflow run that tags and republishes the root. The
  current workflow emits the same shape for either slice (`index.html`, compact `manifest.json`,
  `artifacts.json`, `changelog.json`, binaries), so the installer and OTA client need no special case.
  A historical root slice remains unchanged until the next manual release. New manifests stay within
  the oldest supported signed release's 1024-byte restore reader; the sibling index binds the exact
  manifest SHA-256 plus every published binary for public readback.
- **✅ Concurrent publishers survive losing the race.** That one branch has two writers and they
  overlap routinely; Actions cannot serialize them without serializing a 5-minute build to protect a
  2-second push. So the publisher refreshes the remote ref immediately before pushing and, on a
  non-fast-forward, **re-applies its change onto the winner** and retries. This is sound only because
  every mode is **declarative** — each replaces its own subtree wholesale — so re-applying yields the
  same tree as winning would have. Guarded by a test that races two publishers against a throwaway
  repo.
- **✅ Publishes from a private repo — and the Pages site is public.** The installer and OTA feed can
  go live before the source does. Two consequences worth knowing precisely: a Pages site cannot be
  access-controlled outside an organization, so the published firmware and manifest are
  world-readable while the source stays private; and the release step is the only thing that creates
  a version tag, without which the derived version would pin the feed forever.
- **✅ CI runs inside a metered minute budget** — the fast mechanical gates are one job; firmware
  compile steps are **skipped** when the diff touches nothing the image or the site is made of, while
  the required `build` job still reports the mechanical result. This uses step conditions rather
  than a workflow-level `paths-ignore:` (a filtered workflow
  leaves a required check pending forever); ccache is carried across runs, keyed on the toolchain +
  `sdkconfig.defaults` + `dependencies.lock` rather than a hash of the workflow file; a PR publishes
  nothing; and every job carries a timeout.
- **Managed components** ([`idf_component.yml`](../main/idf_component.yml)): `mdns`, `cjson`, `mqtt`,
  `led_strip` and `w5500` are pulled as managed components (`cjson`/`mqtt`/`w5500` were all extracted
  from IDF core in v6.0); their exact graph, including transitive `wiznet_common`, is committed in
  [`dependencies.lock`](../dependencies.lock).

---

## 10. Firmware-footprint optimizations

[`sdkconfig.defaults`](../sdkconfig.defaults) selects ESP-IDF's size optimization for the release
image and drops code paths this firmware never exercises. The fixed dual-OTA layout makes flash
footprint a hard constraint; the table calls out the one deliberate compatibility bound separately:

| Setting | Drops | Why safe |
|---------|-------|----------|
| `COMPILER_OPTIMIZATION_SIZE=y` | compiler-dependent | uses ESP-IDF's release-size optimization; host gates and signed hardware acceptance exercise the result |
| `MBEDTLS_ERROR_STRINGS=n` | ~6 KB | only numeric TLS codes are logged |
| `COMPILER_OPTIMIZATION_ASSERTIONS_SILENT=y` | ~5 KB | keeps the `abort()` (→ rollback), drops assert strings |
| `MBEDTLS_*_SSL_SESSION_TICKETS=n` | ~1.8 KB | few, long-lived TLS connections gain nothing from resumption |
| `MBEDTLS_FS_IO=n` | ~1.2 KB | certs/keys come from the CA bundle + NVS, never a VFS path |
| `MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_CMN=y` | 50.8 KB in the 13-locale build | keeps CA verification with ESP-IDF's common roots (~99% coverage); rare excluded public roots are unsupported |
| `ESP_WIFI_ENABLE_WPA3_OWE_STA=n` | ~0.8 KB | joins a WPA2-PSK home network |

C++ exceptions are kept on (`COMPILER_CXX_EXCEPTIONS=y`) — they *are* the HTTP OOM guard.

---

## 11. ESP-IDF component & capability inventory

The canonical detailed inventory is [`ESP_IDF_MATRIX.md`](ESP_IDF_MATRIX.md). It distinguishes
direct API use, indirect backends and managed components from evaluated-but-unused features, with a
specific official Espressif documentation link for every row. Its mechanical gate derives the
current surface from [`main/CMakeLists.txt`](../main/CMakeLists.txt),
[`idf_component.yml`](../main/idf_component.yml), [`dependencies.lock`](../dependencies.lock),
[`sdkconfig.defaults`](../sdkconfig.defaults) and the IDF-shaped headers actually included by
`main/`; this catalog keeps only the project-level summary.

**Compile-time defaults** live in [`main/Kconfig.projbuild`](../main/Kconfig.projbuild). Only some
are also settable at runtime (web UI → NVS, which then overrides the Kconfig default):

| Kconfig default | Runtime override |
|---|---|
| `DAIKIN_WIFI_SSID` / `_PASSWORD` | ✅ `POST /set_wifi` → NVS |
| `DAIKIN_MQTT_BROKER_URI` / `_USERNAME` / `_PASSWORD` | ✅ `POST /set_mqtt` → NVS |
| `DAIKIN_SYSLOG_HOST` / `_PORT` | ✅ `POST /set_syslog` → NVS |
| `DAIKIN_NTP_SERVER` | ✅ `POST /set_ntp` → NVS (empty resets to this default, not "off" — SNTP has no disabled state) |
| `DAIKIN_RX_PIN` / `DAIKIN_TX_PIN` | ✅ auto-detected; `POST /set_hp` pins them → NVS |
| `DAIKIN_PROTOCOL` | ⚙️ auto-detected from the bus — deliberately **not** settable |
| `DAIKIN_HOSTNAME` | ❌ compile-time only |
| `DAIKIN_MQTT_DISCOVERY_PREFIX` | ❌ compile-time only |
| `DAIKIN_MQTT_BASE_TOPIC` | ✅ `POST /set_mqtt` → NVS (empty resets to the compiled default) |
| `DAIKIN_OTA_MANIFEST_URL` / `_FIRMWARE_BASE_URL` | ❌ compile-time only |
| `DAIKIN_STATUS_LED_*` | ✅ `POST /set_board` → NVS (Kconfig is only the first-boot seed) |
| `DAIKIN_BUTTON_GPIO` / `_ACTIVE_LOW` | ✅ `POST /set_board` → NVS; defaults to `-1` (**disabled**), since a floating input reading "pressed" would factory-reset an untouched board |

The **model** is not in this table at all: it is re-detected from the X10A bus on every boot and held
in RAM only — there is no manual picker and no NVS key.

---

## What makes this project distinctive (one-paragraph pitch)

It signs and verifies its own OTA updates with **Secure Boot v2 keys but no burned eFuses** — the
security of signed firmware with none of the brick risk. It refuses to roll a bad update forward with
a **connectivity-proving health gate** rather than a naive uptime timer. It ships a **live UI
embedded and pre-compressed into the app image** (polled, after a WebSocket push proved it could die
silently), an **ICMP watchdog** that recovers WiFi ghost-associations no event reports, and a
**field-debuggable crash story** — flash core dumps, offline symbolication against an sha-matched
ELF, a retained MQTT crash topic and a 22-entity heartbeat. The risky parts — decode, CRC, config,
discovery, the health gate, the OTA downgrade gate — are **pure IDF-free logic verified on the host**
and gated in CI, and a second family of audits asks the question tests cannot: whether a
well-formed value is *physically true*, whether the drawing that shows it is *right*, and whether a
bug report can still *leak the user's data*. Everything is **runtime-configured from a captive-portal
web UI**; the heat-pump model is **re-detected on every boot**.

---

*Keep this catalog in sync with the code — when a new technical feature lands, run the
[`feature-docs`](../.agents/skills/feature-docs/SKILL.md) skill.*
