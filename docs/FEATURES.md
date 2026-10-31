# Technical features

This catalog lists implemented platform mechanisms and their source evidence. Plant-level behavior
is in [PLANT.md](PLANT.md); provider/component detail is in [ESP_IDF_MATRIX.md](ESP_IDF_MATRIX.md).

**Status:** ✅ shipping implementation · 🧪 host-tested logic · 🟡 partial, with a named TODO ·
🔭 planned or stubbed. Shipping and host tests do not prove physical behavior on a particular plant.

## Feature matrix

IDs are stable and never reused; gaps identify retired entries. Each feature is stated once.

| # | Feature | Status | Source evidence |
|---|---|:---:|---|
| 1 | RSA-3072 signed applications without hardware Secure Boot or burned eFuses | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 2 | Pre-flash image structure, CRC, digest, RSA-PSS and pinned-key verification | ✅ | [`require-signed.sh`](../scripts/require-signed.sh) |
| 3 | Dual OTA slots; NVS-preserving OTA and sparse keep-data Web Serial Flash | ✅ 🧪 | [`partitions.csv`](../partitions.csv), [`check-web-installer-plan.py`](../scripts/check-web-installer-plan.py) |
| 4 | Automatic rollback until the connectivity-based health gate commits the image | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`logic/health_gate.hpp`](../main/logic/health_gate.hpp) |
| 5 | Signed HTTPS OTA, exact artifact lease, bounded resumes, heap/deadline gates and version-bound changelog | ✅ 🧪 | [`ota_update.cpp`](../main/ota_update.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp), [`http_client_diag.cpp`](../main/http_client_diag.cpp), [`http_ota.cpp`](../main/http_ota.cpp), [`www/js/settings.js`](../main/www/js/settings.js), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/http_deadline.hpp`](../main/logic/http_deadline.hpp), [`logic/ota_transport.hpp`](../main/logic/ota_transport.hpp), [`logic/fixed_text.hpp`](../main/logic/fixed_text.hpp), [`logic/ota_manifest.hpp`](../main/logic/ota_manifest.hpp), [`logic/ota_changelog_range.hpp`](../main/logic/ota_changelog_range.hpp), [`logic/ota_headroom.hpp`](../main/logic/ota_headroom.hpp), [`logic/ota_quiesce.hpp`](../main/logic/ota_quiesce.hpp) |
| 6 | Polled live UI; bounded-chunk status/values responses with explicit busy refusals | ✅ 🧪 | [`www/app.sources`](../main/www/app.sources), [`http_status.cpp`](../main/http_status.cpp), [`logic/http_values_wait.hpp`](../main/logic/http_values_wait.hpp), [`test_status_heap_contract.mjs`](../test/test_status_heap_contract.mjs), [`test_source_absence_contract.mjs`](../test/test_source_absence_contract.mjs) |
| 7 | Offline minified/gzip assets; native build-only index encoder; bounded startup/locales | ✅ 🧪 | [`main/CMakeLists.txt`](../main/CMakeLists.txt), [`encoder provenance`](../tools/web_asset/vendor/README.md), [`delivery tests`](../test/test_ui_delivery_contract.mjs) |
| 8 | HTTP receive budgets, typed configuration, valid UTF-8 and exception-aware streams | ✅ 🧪 | [`http_common.cpp`](../main/http_common.cpp), [`logic/http_ingress.hpp`](../main/logic/http_ingress.hpp), [`logic/http_config_fields.hpp`](../main/logic/http_config_fields.hpp), [`logic/json.hpp`](../main/logic/json.hpp), [`logic/utf8.hpp`](../main/logic/utf8.hpp) |
| 9 | Home Assistant discovery with injective IDs, ownership admission, independent availability and durable retirement | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`logic/discovery.hpp`](../main/logic/discovery.hpp), [`logic/mqtt_discovery_owner.hpp`](../main/logic/mqtt_discovery_owner.hpp), [MQTT contract](MQTT.md) |
| 10 | Verified MQTTS/WSS with common-root CA bundle; credentials require encrypted transport | ✅ | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 11 | Flash core dumps, strict matching-ELF symbolication; proven foreign bytes preserved but suppressed | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp), [`decode-coredump.sh`](../scripts/decode-coredump.sh) |
| 12 | Current-reset classification separate from optional stored crash evidence; retained report cleanup | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 13 | Device heartbeat diagnostics published independently of X10A availability | ✅ 🧪 | [`logic/heartbeat.hpp`](../main/logic/heartbeat.hpp), [`logic/json_integer.hpp`](../main/logic/json_integer.hpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 14 | Strongest-AP selection, SAE tuning and continuous reconnect after a working connection | ✅ | [`wifi.cpp`](../main/wifi.cpp) |
| 15 | ICMP gateway watchdog for ghost associations, with explicit unmeasurable-probe handling | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`logic/link_watch.hpp`](../main/logic/link_watch.hpp) |
| 16 | AP-only captive provisioning: typed SSID, catch-all DNS, redirects and RFC 8910 advertisement | ✅ 🧪 | [`provisioning.cpp`](../main/provisioning.cpp), [`captive_dns.cpp`](../main/captive_dns.cpp), [`logic/captive.hpp`](../main/logic/captive.hpp) |
| 17 | Stable DHCP options 12/60 and mDNS product/path/version identity on both transports | ✅ 🧪 | [`net.cpp`](../main/net.cpp), [`wifi.cpp`](../main/wifi.cpp), [`test_transport_contract.mjs`](../test/test_transport_contract.mjs) |
| 18 | WiFi credential changes with reason-aware, one-shot rollback to the previous network | ✅ 🧪 | [`wifi.cpp`](../main/wifi.cpp), [`logic/wifi_rollback.hpp`](../main/logic/wifi_rollback.hpp) |
| 19 | X10A protocol/page fingerprinting, confirmed generic fallback and order-independent model selection | ✅ 🧪 | [`hp_detect.cpp`](../main/hp_detect.cpp), [`logic/detect.hpp`](../main/logic/detect.hpp) |
| 20 | IDF-free production logic with focused host tests | 🧪 | [`main/logic/`](../main/logic), [`test/test_logic.cpp`](../test/test_logic.cpp) |
| 21 | One ESP-IDF version extractor shared by CI and local Docker builds | ✅ | [`idf-version.sh`](../scripts/idf-version.sh), [`build.yml`](../.github/workflows/build.yml) |
| 22 | Running nine-character ELF identity prefix; full artifact hashes remain separate evidence | ✅ | [`http_status.cpp`](../main/http_status.cpp), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 23 | Size optimization, compile-time-checked identical profile storage and reviewed unused ESP-IDF capability trims | ✅ 🧪 | [`sdkconfig.defaults`](../sdkconfig.defaults), [`def/profile_storage.hpp`](../main/def/profile_storage.hpp), [`logic/profile_table_equal.hpp`](../main/logic/profile_table_equal.hpp) |
| 24 | Runtime-selectable GPIO/WS2812 status indicator with one shared phase table | ✅ 🧪 | [`status_led.cpp`](../main/status_led.cpp), [`logic/led_pattern.hpp`](../main/logic/led_pattern.hpp) |
| 25 | Read-only MCP: structured snapshots, UTF-8 validation and local setup page | ✅ 🧪 | [`mcp_server.cpp`](../main/mcp_server.cpp), [`logic/mcp.hpp`](../main/logic/mcp.hpp), [`logic/chunk_sink.hpp`](../main/logic/chunk_sink.hpp), [`MCP.md`](MCP.md) |
| 26 | MQTT save-time DNS/TCP/authentication preflight; registration failure and heap pressure fail closed | ✅ 🧪 | [`http_config.cpp`](../main/http_config.cpp), [`test_mqtt_preflight_contract.mjs`](../test/test_mqtt_preflight_contract.mjs) |
| 27 | Task watchdog for blocked X10A poll and MQTT publication tasks | ✅ | [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 28 | Always-present system heap, cycle-loss and reset diagnostics without a broker | ✅ 🧪 | [`http_status.cpp`](../main/http_status.cpp), [`logic/reset_reason.hpp`](../main/logic/reset_reason.hpp) |
| 29 | Early latched boot-loop recovery suppresses optional workers; separate from OTA rollback | ✅ 🧪 | [`safe_mode.cpp`](../main/safe_mode.cpp), [`logic/boot_guard.hpp`](../main/logic/boot_guard.hpp), [`test_boot_recovery_contract.mjs`](../test/test_boot_recovery_contract.mjs) |
| 30 | CRC-checked, field-owned settings; explicit save failures and visible kept unreadable configuration | ✅ 🧪 | [`config.cpp`](../main/config.cpp), [`logic/config_store.hpp`](../main/logic/config_store.hpp), [`logic/config_transaction.hpp`](../main/logic/config_transaction.hpp), [`logic/board_pins.hpp`](../main/logic/board_pins.hpp) |
| 31 | Real converter/catalog domain audit with specification checks and decode witnesses | ✅ | [`catalog_audit.cpp`](../tools/domain/catalog_audit.cpp), [`run-domain-audit.sh`](../scripts/run-domain-audit.sh) |
| 32 | Runtime-configurable SNTP and UTC timestamps; unsynchronized time remains absent | ✅ 🧪 | [`sntp_time.cpp`](../main/sntp_time.cpp), [`logic/timestamp.hpp`](../main/logic/timestamp.hpp) |
| 33 | Single-install UART, pin remapping, checked driver errors and silent-bus backoff | ✅ 🧪 | [`hp_comm.cpp`](../main/hp_comm.cpp), [`logic/uart_plan.hpp`](../main/logic/uart_plan.hpp), [`logic/detect_backoff.hpp`](../main/logic/detect_backoff.hpp) |
| 34 | Restricted open-AP provisioning routes; operational/configuration/OTA/MCP routes on trusted LAN | ✅ 🧪 | [`http_server.cpp`](../main/http_server.cpp), [`logic/http_surface.hpp`](../main/logic/http_surface.hpp) |
| 35 | Structural plausibility filter omits invalid measurements; Home Assistant reads unknown | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`hp_convert.cpp`](../main/hp_convert.cpp) |
| 36 | Raw X10A detect/runtime page evidence on the diagnostic endpoint | ✅ 🧪 | [`logic/hexdump.hpp`](../main/logic/hexdump.hpp), [`logic/raw_capture.hpp`](../main/logic/raw_capture.hpp) |
| 37 | Five-second physical privacy reset keeping board hardware; reboot only after all required erases succeed | ✅ 🧪 | [`recovery_button.cpp`](../main/recovery_button.cpp), [`logic/button.hpp`](../main/logic/button.hpp), [`mqtt_retirement_store.cpp`](../main/mqtt_retirement_store.cpp) |
| 38 | Explicit persisted board preset and runtime peripheral pins; identity is not inferred | ✅ 🧪 | [`logic/board_presets.hpp`](../main/logic/board_presets.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 39 | Stack-overflow watchpoint at the offending write | ✅ | [`sdkconfig.defaults`](../sdkconfig.defaults), [`http_server.cpp`](../main/http_server.cpp) |
| 40 | Shared mechanical CI steps, conditional firmware compilation, ccache and no PR publication | ✅ | [`build.yml`](../.github/workflows/build.yml) |
| 41 | Audited X10A supplements for all/reference-row-identical profiles without new page queries | ✅ 🧪 | [`def/overlay.hpp`](../main/def/overlay.hpp), [`logic/profile_view.hpp`](../main/logic/profile_view.hpp), [`X10A_COVERAGE.md`](X10A_COVERAGE.md) |
| 42 | Source-scoped 24-hour trends, including MQTT room temperature, with explicit missing/held input | ✅ 🧪 | [`logic/history.hpp`](../main/logic/history.hpp), [`history.cpp`](../main/history.cpp), [`history.js`](../main/www/js/history.js) |
| 43 | Catalog explanation coverage through production table, profile-qualified descFor and English dictionary | ✅ | [`check_descriptions.mjs`](../tools/descriptions/check_descriptions.mjs), [`run-description-audit.sh`](../scripts/run-description-audit.sh) |
| 44 | SHA-pinned Actions; narrowly attested Renovate runner-pin-only native automerge exception | ✅ 🧪 | [`pr-policy.yml`](../.github/workflows/pr-policy.yml), [`renovate_action_pr.py`](../tools/agent-policy/renovate_action_pr.py) |
| 45 | SVG structure, geometry and binding audit for the live schematic | ✅ | [`check_schematic.mjs`](../tools/schematic/check_schematic.mjs), [`run-schematic-audit.sh`](../scripts/run-schematic-audit.sh) |
| 46 | On-device redaction shared by browser and direct diagnostic reports | ✅ 🧪 | [`logic/redact.hpp`](../main/logic/redact.hpp), [`REPORTING.md`](REPORTING.md) |
| 47 | Source-aware redaction coverage audit for identifying fields and diagnostic lines | ✅ | [`check_diag_coverage.py`](../tools/redact/check_diag_coverage.py), [`run-redaction-audit.sh`](../scripts/run-redaction-audit.sh) |
| 48 | Device bug report collects redacted status, feed URLs and logs plus values; read failures explicit | ✅ | [`www/js/app_state.js`](../main/www/js/app_state.js), [`REPORTING.md`](REPORTING.md) |
| 49 | Converter-derived JSON types remain stable across state changes | ✅ 🧪 | [`logic/convert.hpp`](../main/logic/convert.hpp), [`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp) |
| 50 | Structural availability adjudication, including absent hardware, conditional zeros and bit-overlay ambiguity | ✅ 🧪 | [`logic/availability.hpp`](../main/logic/availability.hpp) |
| 51 | Evidence-backed converter overrides for demonstrably incorrect generated definitions | ✅ 🧪 | [`logic/conv_override.hpp`](../main/logic/conv_override.hpp) |
| 52 | Held outdoor-unit pages are withheld as current measurements | ✅ 🧪 | [`logic/ou_stale.hpp`](../main/logic/ou_stale.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp) |
| 53 | Numeric error/warning flags alongside textual fault codes | ✅ 🧪 | [`logic/fault_state.hpp`](../main/logic/fault_state.hpp) |
| 54 | Stale/unverifiable dashboard GIF blocks merge; replacement also requires current-head review | ✅ | [`check_ui_gif.mjs`](../tools/uigif/check_ui_gif.mjs), [`require-pr-gates.sh`](../tools/agent-hooks/require-pr-gates.sh), [`record-dashboard-gif.sh`](../scripts/record-dashboard-gif.sh) |
| 56 | Group-qualified discovery and unique IDs prevent duplicate-label entity collisions | ✅ 🧪 | [`logic/discovery.hpp`](../main/logic/discovery.hpp), [`HOME_ASSISTANT.md`](HOME_ASSISTANT.md) |
| 57 | Documentation entity IDs resolve against the detectable profile catalog | ✅ | [`entity_id_audit.cpp`](../tools/docs/entity_id_audit.cpp), [`run-doc-entity-audit.sh`](../scripts/run-doc-entity-audit.sh) |
| 58 | Device-wide crash dismissal clears status/retained evidence after required erase; suppressed foreign residue cannot pin a current-fault banner | ✅ 🧪 | [`diag_crash.cpp`](../main/diag_crash.cpp), [`logic/crashinfo.hpp`](../main/logic/crashinfo.hpp) |
| 59 | Fatal return-type, format and unused-result warnings on the application component | ✅ | [`main/CMakeLists.txt`](../main/CMakeLists.txt) |
| 60 | Browser-selected language plus persisted override; device-local signed-image locale catalogs | ✅ 🧪 | [`logic/ui_lang.hpp`](../main/logic/ui_lang.hpp), [`www/js/i18n.js`](../main/www/js/i18n.js), [`www/locales/`](../main/www/locales/) |
| 61 | Optional independent read-only HomeHub Modbus TCP source with batched fast/full polling | ✅ 🧪 | [`hp_modbus.cpp`](../main/hp_modbus.cpp), [`logic/modbus.hpp`](../main/logic/modbus.hpp), [`logic/modbus_plan.hpp`](../main/logic/modbus_plan.hpp), [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md) |
| 62 | Exact MQTT room mappings and fixed/mapped target; mapped source time alone governs age, missing_source_time until received | ✅ 🧪 | [`logic/reference_temperature.hpp`](../main/logic/reference_temperature.hpp), [`http_config.cpp`](../main/http_config.cpp) |
| 66 | Deterministic production-UI interaction gate covering every modal lifecycle | ✅ 🧪 | [`test_ui_use_cases.mjs`](../test/test_ui_use_cases.mjs), [`run-ui-use-case-tests.sh`](../scripts/run-ui-use-case-tests.sh) |
| 68 | Source contracts verify target task, ordering and ownership boundaries | ✅ | [`run-contract-tests.sh`](../scripts/run-contract-tests.sh), [`test_heating_curve_diagnosis_contract.mjs`](../test/test_heating_curve_diagnosis_contract.mjs) |
| 69 | Independent optional-source absence matrix, including safe mode | ✅ | [`test_source_absence_contract.mjs`](../test/test_source_absence_contract.mjs), [`test_ui_absence_matrix.mjs`](../test/test_ui_absence_matrix.mjs), [`selftest.sh`](../tools/absence/selftest.sh) |
| 71 | 10 KiB HTTP stack with 2 KiB named-path reserve, bounded JSON recursion and fatal 2 KiB MQTT frame ceiling | ✅ | [`http_server.cpp`](../main/http_server.cpp), [`check-stack-budget.py`](../scripts/check-stack-budget.py), [`main/CMakeLists.txt`](../main/CMakeLists.txt), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 72 | Compatible RAM trends and dated flash-journal restoration; official 8 MB layout, torn-write rejection and semantic identities | ✅ 🧪 | [`logic/history_persist.hpp`](../main/logic/history_persist.hpp), [`history.cpp`](../main/history.cpp), [`partitions.csv`](../partitions.csv) |
| 73 | Sustained internal contiguous-heap exhaustion triggers bounded restart escalation into recovery mode | ✅ 🧪 | [`logic/heap_watchdog.hpp`](../main/logic/heap_watchdog.hpp), [`heap_guard.cpp`](../main/heap_guard.cpp) |
| 74 | Catalog-wide parity between browser and C++ selection/freshness/COP-boundary rules | ✅ 🧪 | [`presenter_golden_dump.cpp`](../test/presenter_golden_dump.cpp), [`presenter_parity.mjs`](../tools/presenter/presenter_parity.mjs), [`selftest.sh`](../tools/presenter/selftest.sh) |
| 75 | Unwind-safe guards, static OTA/syslog mutexes and one diagnostic per task-failure episode | ✅ 🧪 | [`rtos_guard.hpp`](../main/rtos_guard.hpp), [`logic/task_failure.hpp`](../main/logic/task_failure.hpp) |
| 76 | One declared task-priority table | ✅ | [`task_config.hpp`](../main/task_config.hpp) |
| 77 | Boot-detected W5500 Ethernet, wired-first startup, route priority and safe pin probe | ✅ 🧪 | [`logic/net_link.hpp`](../main/logic/net_link.hpp), [`net.cpp`](../main/net.cpp), [`test_transport_contract.mjs`](../test/test_transport_contract.mjs) |
| 78 | HTTP provisioning restriction follows open-AP presence independently of network transport | ✅ 🧪 | [`logic/http_surface.hpp`](../main/logic/http_surface.hpp), [`http_server.cpp`](../main/http_server.cpp) |
| 79 | Scoped dated diagnosis hours, bounded DHW transitions/read gaps, heating run-count/runtime coverage and independent circulation identity | ✅ 🧪 | [`logic/checkup_persist.hpp`](../main/logic/checkup_persist.hpp), [`logic/checkup.hpp`](../main/logic/checkup.hpp), [`checkup.cpp`](../main/checkup.cpp) |
| 80 | Cache-bound binary durations, witnessed transitions and blind gaps; version 4 restoration | ✅ 🧪 | [`logic/state_dwell.hpp`](../main/logic/state_dwell.hpp), [`logic/values_identity.hpp`](../main/logic/values_identity.hpp), [`state_dwell.cpp`](../main/state_dwell.cpp) |
| 81 | Owner-sampled task stack minima, including startup and MQTT transport; unsampled tasks remain null | ✅ | [`stack_watch.hpp`](../main/stack_watch.hpp), [`stack_watch.cpp`](../main/stack_watch.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp) |
| 82 | Locked component graph, explicit toolchain/language floors and reproducible application metadata | ✅ | [`dependencies.lock`](../dependencies.lock), [`CMakeLists.txt`](../CMakeLists.txt), [`sdkconfig.defaults`](../sdkconfig.defaults) |
| 83 | ESP32-S3 default and generated-sdkconfig comparison against every declared setting | ✅ 🧪 | [`check-sdkconfig-defaults.py`](../scripts/check-sdkconfig-defaults.py), [`ci-build-all.sh`](../scripts/ci-build-all.sh) |
| 84 | Signed-app size ceiling plus retained Flash/DIRAM/IRAM/BSS reports | ✅ 🧪 | [`report-firmware-size.py`](../scripts/report-firmware-size.py), [`build.yml`](../.github/workflows/build.yml) |
| 85 | Disconnect forgets a closed, unowned port's permission; unplugging only disconnects | ✅ 🧪 | [`serial-port-release.mjs`](serial-port-release.mjs), [`serial_port_release.test.mjs`](../test/serial_port_release.test.mjs), [`web_installer.test.mjs`](../test/web_installer.test.mjs) |
| 86 | Web Serial installer: pre-flash read of table and app, NVS-keeping Flash for this firmware, sparse writes, live log | ✅ 🧪 | [`web-installer.mjs`](web-installer.mjs), [`web_installer.test.mjs`](../test/web_installer.test.mjs) |
| 87 | Diagnosis evidence gate binds external sources, implementation rules and claim limits | ✅ | [`check_diagnostic_evidence.mjs`](../tools/diagnostic_evidence/check_diagnostic_evidence.mjs), [`run-diagnostic-evidence-audit.sh`](../scripts/run-diagnostic-evidence-audit.sh) |
| 88 | Maintained Markdown stays English; localized UI claims remain complete and bounded | ✅ 🧪 | [`english_docs.mjs`](../tools/user_docs/english_docs.mjs), [`run-user-docs-audit.sh`](../scripts/run-user-docs-audit.sh) |
| 89 | Canonical agent budgets, skills, reviewers and safety integrity; fast source audit before push | ✅ | [`run-agentic-setup-audit.sh`](../scripts/run-agentic-setup-audit.sh), [`run-agent-instructions-budget.sh`](../scripts/run-agent-instructions-budget.sh), [`selftest.sh`](../tools/agent-config/selftest.sh) |
| 90 | Revision-bound X10A publishing; Weather quiescence, transient request storage, 48/20 KiB internal-heap admission and absolute deadline | ✅ 🧪 | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`logic/x10a_snapshot.hpp`](../main/logic/x10a_snapshot.hpp), [`logic/mqtt_group.hpp`](../main/logic/mqtt_group.hpp), [`weather_forecast.cpp`](../main/weather_forecast.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp), [`logic/weather_config.hpp`](../main/logic/weather_config.hpp), [`logic/weather_forecast.hpp`](../main/logic/weather_forecast.hpp), [`test_src_runtime.mjs`](../test/test_src_runtime.mjs), [`test_x10a_publish_heap_contract.mjs`](../test/test_x10a_publish_heap_contract.mjs) |
| 91 | Connection-gated read-only X10A register probe with exact or labelled generic definitions | ✅ 🧪 | [`logic/hp_probe.hpp`](../main/logic/hp_probe.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`http_config.cpp`](../main/http_config.cpp), [`dashboard.js`](../main/www/js/dashboard.js) |
| 92 | Bench-first exact-artifact dev/release promotion; preserved channel, pending-rollback stress, valid-state proof and private one-write receipts | ✅ 🧪 | [`production-ota-gate.py`](../scripts/production-ota-gate.py), [`ota_update.cpp`](../main/ota_update.cpp), [`ota_manifest.hpp`](../main/logic/ota_manifest.hpp), [`http_ota.cpp`](../main/http_ota.cpp), [`health_gate.hpp`](../main/logic/health_gate.hpp), [`test_production_ota_gate_contract.mjs`](../test/test_production_ota_gate_contract.mjs), [`selftest.mjs`](../tools/production_ota/selftest.mjs), [`require-pr-gates.sh`](../tools/agent-hooks/require-pr-gates.sh) |
| 93 | Locale key/type/arity/table parity and canonical-copy freshness gate | ✅ 🧪 | [`run-ui-localization-audit.sh`](../scripts/run-ui-localization-audit.sh), [`test_ui_locale_catalogs.mjs`](../test/test_ui_locale_catalogs.mjs), [`selftest.mjs`](../tools/ui_localization/selftest.mjs) |
| 94 | ESP-IDF matrix gate covers linked components, defaults, headers and native/manual boundaries | ✅ | [`ESP_IDF_MATRIX.md`](ESP_IDF_MATRIX.md), [`check_matrix.py`](../tools/esp_idf_matrix/check_matrix.py), [`selftest.py`](../tools/esp_idf_matrix/selftest.py) |
| 95 | Passive fresh-sweep refrigerant observation; no full-load, charge or mechanical-EEV verdict | ✅ 🧪 | [`refrigerant_service.hpp`](../main/logic/refrigerant_service.hpp), [`hp_poll.cpp`](../main/hp_poll.cpp), [`DIAGNOSTICS.md`](DIAGNOSTICS.md#refrigerant-service-observation) |
| 96 | Signed bench-only dev/release OTA: one write, verifier/heap/stack proof, pending-rollback pressure and valid-state confirmation | ✅ 🧪 | [`production-ota-gate.py`](../scripts/production-ota-gate.py), [`agent_hook.py`](../tools/agent-hooks/agent_hook.py), [`test_production_ota_gate_contract.mjs`](../test/test_production_ota_gate_contract.mjs), [`selftest.mjs`](../tools/production_ota/selftest.mjs) |
| 97 | Commit/PR-text privacy and language audit plus current-head human hygiene review | ✅ 🧪 | [`check_pr_hygiene.mjs`](../tools/pr_hygiene/check_pr_hygiene.mjs), [`pr-hygiene-review`](../.agents/skills/pr-hygiene-review/SKILL.md), [`require-pr-gates.sh`](../tools/agent-hooks/require-pr-gates.sh) |
| 98 | 95% aggregate line floor and execution-profile-bound per-header branch-count ratchet | ✅ 🧪 | [`branch_baseline.json`](../tools/coverage/branch_baseline.json), [`profile.sh`](../tools/coverage/profile.sh), [`check_gcov_report.py`](../tools/coverage/check_gcov_report.py) |
| 99 | Deterministic hostile-input properties; required CI ASan+UBSan, capability-based local fallback | ✅ 🧪 | [`logic_property_tests.cpp`](../tools/fuzz/logic_property_tests.cpp), [`run-sanitizer-fuzz-tests.sh`](../scripts/run-sanitizer-fuzz-tests.sh) |
| 100 | Portable text invariants plus exact clang-format 18.1.8 on new/changed C/C++ | ✅ 🧪 | [`check_format.py`](../tools/format/check_format.py), [`run-format-check.sh`](../scripts/run-format-check.sh) |
| 101 | Production HTTP request, response and configuration runtime failure controls | ✅ 🧪 | [`test_http_server_runtime.mjs`](../test/test_http_server_runtime.mjs), [`test_http_stream_runtime.mjs`](../test/test_http_stream_runtime.mjs), [`test_http_config_runtime.mjs`](../test/test_http_config_runtime.mjs), [`run-runtime-integration-tests.sh`](../scripts/run-runtime-integration-tests.sh) |
| 102 | Real-browser layout, keyboard, accessibility, reduced-motion and console gates across shipped locales | ✅ 🧪 | [`test_browser_render.mjs`](../test/test_browser_render.mjs), [`run-browser-render-tests.sh`](../scripts/run-browser-render-tests.sh) |
| 103 | Isolated trusted-main signing, key continuity and source-bound artifact/tag publication | ✅ 🧪 | [`ci-build-all.sh`](../scripts/ci-build-all.sh), [`check-signing-key-continuity.py`](../scripts/check-signing-key-continuity.py), [`check-manifest-provenance.py`](../scripts/check-manifest-provenance.py), [`build.yml`](../.github/workflows/build.yml) |
| 104 | Release dispatch publication independent of separately authorized hardware acceptance | ✅ 🧪 | [`production-ota-gate.py`](../scripts/production-ota-gate.py), [`build.yml`](../.github/workflows/build.yml) |
| 105 | Protocol S legacy transport with unverified catalog; both protocols suppress hardware TX echo, Protocol I resynchronizes preambles | ✅ 🧪 | [`logic/crc.hpp`](../main/logic/crc.hpp), [`hp_comm.cpp`](../main/hp_comm.cpp), [`hp_detect.cpp`](../main/hp_detect.cpp), [`def/protocol_s.hpp`](../main/def/protocol_s.hpp), [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) |
| 106 | Native Altherma 4 read-only 42-row Modbus subset; snapshot semantics and pressure-probe heuristic, physical/scaling acceptance pending | 🟡 🧪 | [`logic/modbus_catalog.hpp`](../main/logic/modbus_catalog.hpp), [`logic/modbus_profile.hpp`](../main/logic/modbus_profile.hpp), [`def/altherma4.hpp`](../main/def/altherma4.hpp), [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md) |
| 107 | Bounded MQTT frames/start recovery; circulation mapping proof binds probe generation and original source age | ✅ 🧪 | [`logic/payload_complete.hpp`](../main/logic/payload_complete.hpp), [`logic/circulation_source.hpp`](../main/logic/circulation_source.hpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`API.md`](API.md) |
| 108 | Physical-instrument registry for new diagnosis observations: supported, absent, withheld or ambiguous per profile, bound to the older selectors; no firmware caller yet | 🧪 | [`logic/instrument.hpp`](../main/logic/instrument.hpp), [ARCHITECTURE.md](ARCHITECTURE.md#physical-instruments) |

The HTTP guard returns 503 before emission and rejects allocation-rich requests during OTA or
below a 6144 B internal contiguous block. Status, values, history, diagnostic logs and MCP use
exception-aware post-emission aborts; values stage their readings and bound dwell metadata.

Diagnosis lifecycle, dated restoration and scoped restart limits are in
[PLANT.md](PLANT.md#reboot-and-persistence); readings and evidence boundaries are in
[DIAGNOSTICS.md](DIAGNOSTICS.md).

Ordinary bench delivery is OTA. Signed USB is limited to bootstrap/recovery and an explicitly
requested exact-head pre-merge bench test; that test is separate from artifact delivery.

## Detailed references

| Topic | Authoritative reference |
|---|---|
| Components, data flow, lifecycle, resources and persistence | [ARCHITECTURE.md](ARCHITECTURE.md) |
| ESP-IDF providers, linked capabilities and defaults | [ESP_IDF_MATRIX.md](ESP_IDF_MATRIX.md) |
| Trust boundary, signing and recovery | [SECURITY.md](SECURITY.md) |
| Maintainer review, publication and hardware delivery | [MAINTENANCE.md](MAINTENANCE.md) |
| HTTP routes, input/output and errors | [API.md](API.md) |
| X10A frames, converters and registers | [X10A_PROTOCOL.md](X10A_PROTOCOL.md), [REGISTERS.md](REGISTERS.md) |
| Independent HomeHub source | [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md) |
| MQTT identity/wire contract and Home Assistant setup | [MQTT.md](MQTT.md), [HOME_ASSISTANT.md](HOME_ASSISTANT.md) |
| UI behavior and visual contract | [DESIGN.md](DESIGN.md) |
| Read-only MCP tools | [MCP.md](MCP.md) |
| Deterministic gates and their limits | [test/README.md](../test/README.md) |

Keep this catalog source-backed and concise with the
[feature-docs skill](../.agents/skills/feature-docs/SKILL.md).
