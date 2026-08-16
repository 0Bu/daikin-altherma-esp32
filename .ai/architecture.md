# System Architecture & Component Map

This document describes the software architecture, component responsibilities, data flow, memory model, and API contracts for `daikin-altherma-esp32`.

---

## 1. System Overview & Tech Stack

- **Target Chip:** Espressif ESP32-S3 (`esp32s3` target only).
- **Framework:** ESP-IDF 6.x (CI pinned to `v6.0.2`; component floor `>=5.5`).
- **Core Functionality:** Communicates with Daikin Altherma heat pumps via the **X10A** serial service port, auto-detects unit models and registers at boot, provides a self-contained Web UI, and bridges telemetry to Home Assistant via MQTT Discovery.
- **Optional Extensions:**
  - Daikin HomeHub (EKRHH) Modbus TCP integration (read-only secondary telemetry source).
  - M5Stack ENV III sensor (I2C ambient temperature/humidity/pressure).
  - Open-Meteo weather forecast client.
  - W5500 SPI Ethernet transport.
- **Security & Boot:** Secure Boot v2 application signing (`CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`), safe-mode boot-loop recovery latch, internal heap watchdog ladder.

---

## 2. Hardware Targets & Pin Wiring

| Board | Role / Pin Configuration | Detection & Flashing |
|---|---|---|
| **Seeed XIAO ESP32-S3** | Compile-time default: **RX=44 (D7) / TX=43 (D6)**. | Connects directly without UI configuration. Flashes over native USB-Serial/JTAG. |
| **M5Stack AtomS3 Lite** | Primary user documentation board: **RX=1 / TX=2** via Grove port. | Requires selecting RX=1 / TX=2 once in UI. Supports AtomS3 PoE Base (W5500) and ENV III accessory. |

---

## 3. Component Map (`main/`)

| File / Component | Responsibility & Architectural Invariants |
|---|---|
| `main.cpp` | Boot orchestration: NVS, config, safe-mode guard, WiFi/AP, SNTP, mDNS, HTTP, MQTT, polling, OTA gate. Runs in an exception boundary that calls `abort()` (not `esp_restart`, so crash counters remain intact). |
| `safe_mode.cpp` | Crash-loop safe mode (`logic/boot_guard.hpp`). Counts crash boots in NVS (`boot_fails`). At `BOOT_FAIL_THRESHOLD`, latches safe mode (skips polling + MQTT; keeps WiFi, Web UI, OTA active). |
| `heap_guard.cpp` | Internal heap watchdog (`logic/heap_watchdog.hpp`). Monitors largest contiguous block of internal RAM (`MALLOC_CAP_INTERNAL`) below `HEAP_CRITICAL_BYTES`. Restarts via bounded ladder ending in safe mode. |
| `config.cpp` | Runtime configuration management (`logic/config_model.hpp`) in NVS namespace `daik_cfg`. Supports atomic service blob saves and narrow link/model saves. |
| `nvs_storage.cpp` | Low-level NVS helpers. All setters are `[[nodiscard]]` returning `esp_err_t`. |
| `wifi.cpp` | Station connection (all-channel scan, strongest AP selection), reconnect loop, reason-aware credential rollback (`logic/wifi_rollback.hpp`), ICMP gateway monitor (`logic/link_watch.hpp`). |
| `net.cpp` | Optional W5500 SPI Ethernet transport. Runtime-detected; probe refuses to run if pins are claimed (`logic/net_link.hpp`). Wire wins default route priority. Hosts mDNS service. |
| `sntp_time.cpp` | SNTP time synchronization client. Stores server hostname in file-scope string to satisfy lwIP pointer-lifetime requirements. |
| `provisioning.cpp` | SoftAP setup portal, DHCP DNS option 114 (RFC 8910 captive portal URI). AP-only mode accepts SSID as direct text without active STA scanning. |
| `captive_dns.cpp` | UDP:53 catch-all DNS server forwarding to `192.168.4.1` during setup mode. |
| `hp_comm.cpp` | X10A UART driver (9600 baud, 8E1). Driver installed once; pin swaps use register-level `uart_set_pin` remapping (`logic/uart_plan.hpp`). |
| `hp_convert.cpp` | Value decoding and unit formatting over `logic/convert.hpp`. Applies plausibility and availability checks at publish time. |
| `hp_detect.cpp` | Bus protocol sweep, register page probing (`DETECT_PAGE_TRIES=3`), fingerprint matching, model candidate ranking. |
| `hp_modbus.cpp` | Daikin HomeHub (EKRHH) Modbus TCP polling stack. Strictly read-only secondary source (no write builder exists in firmware). |
| `hp_poll.cpp` | Main X10A polling task. Task watchdog subscribed (reset per cycle and register). Captures compressor raw cycles, samples heap headroom, updates history rings. |
| `env3.cpp` | M5Stack ENV III (SHT30 + QMP6988) I2C sensor driver. Hardware probe verification on enable. Provides context for heating-curve diagnosis. |
| `weather_forecast.cpp` | Open-Meteo forecast client. Location coordinates in config represent explicit user consent. Dedicated task with bounded JSON parser. |
| `history.cpp` | 24-hour trend rings allocated in `.noinit` DRAM (never heap or NVS). Sealed by catalog fingerprint on restore. Coarse 30-min snapshot saved to `history` flash partition on reboot. |
| `checkup.cpp` | 24-hour plant checkup (`/status.health`). Evaluates short cycling, compressor run counts, defrost events, and window minima. |
| `state_dwell.cpp` | Tracks duration of binary and switched state values in `.noinit` DRAM. |
| `http_server.cpp` | Embedded web server (`:80`). Handler slots `cfg.max_uri_handlers` sized to exact trusted-LAN route count (36). Limits AP mode to provisioning routes (`logic/http_surface.hpp`). |
| `http_common.cpp` | HTTP response helpers and global OOM exception trampoline (`handle_all`). |
| `http_status.cpp` | Endpoints: `GET /`, `/status`, `/values`, `/history`, `/models`, `/diag`, `/scan`, `/coredump`, `POST /diag/clear`, `POST /coredump/clear`, `POST /crash/dismiss`. |
| `http_config.cpp` | All configuration POST endpoints (`/set_*`, `/test_*`, `/detect`, `/discover_homehub`). |
| `http_ota.cpp` | OTA management endpoints (`/ota/check`, `/ota/update`, `/ota/status`). |
| `mcp_server.cpp` | Stateless read-only Model Context Protocol (MCP) server endpoint at `/mcp`. |
| `mqtt_ha.cpp` | Home Assistant MQTT Discovery bridge. Group-scoped entity IDs, slugified base topic installation identity, retained state lifecycle and retraction management. |
| `ota_update.cpp` | Signed HTTPS OTA updates from GitHub Pages releases/dev feeds. Two-point downgrade protection (manifest version and `esp_app_desc_t`). |
| `status_led.cpp` | Visual feedback patterns for GPIO and WS2812 RGB LEDs (`logic/led_pattern.hpp`). |
| `recovery_button.cpp` | Factory-reset push button. 5-second hold erases NVS configuration and restarts device (`logic/button.hpp`). |
| `diag_log.cpp` | In-RAM ring buffer for diagnostic logging (`GET /diag`). Streams output chunked to avoid large heap allocations. |
| `syslog.cpp` | RFC 5424 UDP syslog client. Replays early boot logs upon initial DNS resolution (`logic/bootlog.hpp`). |
| `diag_crash.cpp` | Captures reset reasons and core dump metadata at boot into cached `CrashInfo`. |
| `stack_watch.cpp` | High-water mark headroom tracker for key FreeRTOS tasks (httpd, poll, mqtt, modbus). |
| `task_config.hpp` | Central priority definitions for all FreeRTOS tasks (`TASK_PRIO_*`). |
| `logic/` | Header-only, host-tested algorithms (availability, convert, detect, JSON encoding, redaction, etc.). |
| `def/` | Value profiles, registry tables, and hardware signature definitions (machine-generated). |
| `www/` | Web UI source files compiled and minified into a single gzipped asset (`UI_GZIP_MAX_BYTES` <= 150 KB). |

---

## 4. Flash Partition Layout & Memory Architecture

```
+-------------------------------------------------------------------------+
| Partition Table (partitions.csv)                                        |
| - nvs         (0x9000, 24 KB)   : daik_cfg atomic blob, crash counters  |
| - otadata     (0xF000, 8 KB)    : OTA boot partition selector           |
| - app0 (ota_0)(0x20000, 2944 KB): Primary firmware image slot           |
| - app1 (ota_1)(0x300000, 2944 KB): Secondary firmware image slot        |
| - history     (0x1E000, 8 KB)   : Optional 24h coarse trend snapshot    |
| - coredump    (0x5E0000, 64 KB) : Crash dump partition                  |
+-------------------------------------------------------------------------+
```

### Memory Layers
1. **Internal DRAM (`.noinit` section):** Stores 24-hour history rings (`history.cpp`), checkup event rings (`checkup.cpp`), and dwell timers (`state_dwell.cpp`). Survives software restarts without re-initialization.
2. **NVS Partition (`0x9000`):** Preserves `daik_cfg` atomic blob across OTA updates. Must not change offset or size.
3. **Internal SRAM vs PSRAM:** Driver DMA, FreeRTOS stacks, and critical buffers require internal contiguous SRAM. PSRAM is not utilized for critical paths.

---

## 5. HTTP API Specification

| Method | Endpoint | Purpose & Invariants |
|---|---|---|
| `GET` | `/` | Web UI single page application (`setup.html` in SoftAP mode). |
| `GET` | `/status[?redact=1]` | Unified system snapshot JSON. `?redact=1` masks PII for bug reporting (`logic/redact.hpp`). |
| `GET` | `/values` | Decoded real-time readings array `[{label, value, unit, reg}]` + `modbus` array. |
| `GET` | `/history?row=<id>&source=<src>` | 24-hour sensor trend series (values in tenths). |
| `GET` | `/models` | Model catalog metadata. |
| `GET` | `/diag[?verbose][?redact=1]` | Diagnostic log buffer. Chunked streaming. |
| `POST` | `/diag/clear` | Erases in-RAM diagnostic log ring. |
| `GET` | `/scan` | WiFi network scan results (trusted LAN only). |
| `GET` | `/coredump` | Downloads raw core dump binary. |
| `POST` | `/coredump/clear` | Erases core dump partition from flash. |
| `POST` | `/crash/dismiss` | Dismisses crash notification and clears dump state. |
| `POST` | `/set_wifi` | Updates WiFi credentials; triggers rollback timer on failure. |
| `POST` | `/set_mqtt` | Configures MQTT broker, credentials, and base topic. Synchronous preflight check (~8s). |
| `POST` | `/set_syslog` | Configures RFC 5424 syslog destination. |
| `POST` | `/set_ntp` | Configures SNTP server. |
| `POST` | `/test_ref_temp` | Validates reference room temperature MQTT topic (issues single-use proof token). |
| `POST` | `/set_ref_temp` | Persists reference room topic mapping (requires valid test proof). |
| `POST` | `/test_circulation` | Validates external circulation power MQTT topic (proof token). |
| `POST` | `/set_circulation` | Persists circulation power witness config (requires proof). |
| `POST` | `/set_weather` | Sets latitude/longitude for Open-Meteo forecast (saving implies user consent). |
| `POST` | `/set_board` | Configures board hardware presets, status LED pins, and ENV III port. |
| `POST` | `/set_hp` | Sets X10A RX/TX pins, profile, and HomeHub Modbus target host/port. |
| `POST` | `/discover_homehub` | Triggers mDNS search for Daikin HomeHub (EKRHH). |
| `POST` | `/detect` | Resets active model to auto and initiates hardware detection sweep. |
| `POST` | `/set_ota` | Selects OTA release channel (`release` or `dev`). |
| `POST` | `/set_lang` | Sets UI language preference (`auto`, `de`, `en`). |
| `GET` | `/ota/check` | Asynchronously queries update manifest. |
| `POST` | `/ota/update[?downgrade=1]` | Initiates signed OTA download and flash process. |
| `GET` | `/ota/status` | Queries OTA download/flash progress and status. |
| `GET/POST`| `/mcp` | Stateless Model Context Protocol endpoint for AI tooling. |

> **Note:** There is **no live WebSocket / SSE push endpoint** by design (`no /events`). Web UI clients poll `/values` (every 2s) and `/status` (every 8s).
