# ESP-IDF feature matrix

This is the source-linked inventory of ESP-IDF and official Espressif features considered by
`daikin-altherma-esp32`. It separates APIs the application calls directly, linked backends and
managed components from features that were evaluated but are not used.

The project is pinned to **ESP-IDF 6.0.2** and targets **ESP32-S3**. The general entry point requested
for this inventory is Espressif's [ESP32 Get Started guide][idf-esp32-start]; feature rows use the
corresponding [ESP32-S3 6.0.2 API reference][idf-s3-api] because ESP32-S3 is the only supported
target. Official components extracted from ESP-IDF are linked to the Espressif Component Registry.

<!-- esp-idf-matrix:metadata {"target":"esp32s3","version":"6.0.2","idf_floor":">=6.0"} -->

## Scope and status

The **used** table is mechanically complete for the current application surface: explicit CMake
components, direct managed dependencies, active `sdkconfig.defaults` assignments and ESP-IDF-shaped
headers included under `main/`. The negative table is deliberately curated; no offline gate can
prove that it names every feature in the upstream ESP-IDF universe. An ESP-IDF version change forces
this document back through review.

| Status | Meaning |
|---|---|
| ✅ Direct | Application code calls the API directly or enables the capability explicitly |
| 🧩 Backend | Linked or configured below another API; application code does not call it directly |
| 📦 Managed | Direct dependency from the Espressif Component Registry |
| 🔬 Evaluate | A bounded comparison could plausibly improve the project |
| ⏸ Conditional | Useful only after a product, security or hardware requirement changes |
| 🚫 Not planned | Available, but no current use case justifies its cost |
| ⛔ Unsupported | Not native on the ESP32-S3 hardware or current toolchain contract |

## Used ESP-IDF and Espressif features

The **Component/source** column is machine-readable. Backticked names are the exact explicit CMake
component or direct managed dependency keys audited by `scripts/run-esp-idf-matrix-audit.sh`.

<!-- esp-idf-matrix:used:start -->
| ID | Feature | Status | Component/source | Project use | Evidence | Official documentation |
|---|---|---|---|---|---|---|
| U01 | Build system, ESP32-S3 target and reproducible application metadata | ✅ Direct | IDF core | One `main` component, C++17, 8 MiB flash and a target/version-pinned build with release-time byte-identical clean rebuild proof | [`CMakeLists.txt`](../CMakeLists.txt), [`sdkconfig.defaults`](../sdkconfig.defaults), [`dependencies.lock`](../dependencies.lock), [`check-reproducible-build.py`](../scripts/check-reproducible-build.py) | [Build system](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/build-system.html) |
| U02 | FreeRTOS kernel | ✅ Direct | IDF core | Tasks, queues, semaphores, event groups, stack high-water marks, a boot-static socket-deadline worker and ELF frame/path budgets | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp), [`stack_watch.cpp`](../main/stack_watch.cpp), [`check-stack-budget.py`](../scripts/check-stack-budget.py) | [FreeRTOS](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/freertos.html) |
| U03 | System, heap, logging and MAC APIs | ✅ Direct | IDF core | Reset/restart state, internal-heap telemetry, logs and MAC-derived identity | [`main.cpp`](../main/main.cpp), [`heap_guard.cpp`](../main/heap_guard.cpp), [`net.cpp`](../main/net.cpp) | [System API](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/misc_system_api.html), [memory allocation](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/mem_alloc.html), [logging](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/log.html) |
| U04 | High-resolution timer and Task Watchdog | ✅ Direct | `esp_timer` | Poll timing, deadlines, one boot-created absolute HTTP timer plus static notifier task, and watchdog coverage for blocking workers | [`hp_poll.cpp`](../main/hp_poll.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults) | [ESP Timer](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/esp_timer.html), [watchdogs](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/wdts.html) |
| U05 | Non-volatile storage | ✅ Direct | `nvs_flash` | Atomic versioned configuration blob and X10A link cache | [`nvs_storage.cpp`](../main/nvs_storage.cpp), [`config.cpp`](../main/config.cpp) | [NVS Flash](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/storage/nvs_flash.html) |
| U06 | Partition API and custom flash layout | ✅ Direct | `esp_partition` | Raw power-loss-safe history journal, coredump streaming and running-slot lookup | [`history.cpp`](../main/history.cpp), [`partitions.csv`](../partitions.csv) | [Partition API](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/storage/partition.html) |
| U07 | Core dump to flash | ✅ Direct | `espcoredump` | Summary, provenance, HTTP download and explicit dismissal lifecycle | [`diag_crash.cpp`](../main/diag_crash.cpp), [`http_status.cpp`](../main/http_status.cpp) | [Core dump](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/core_dump.html) |
| U08 | Wi-Fi station and SoftAP | ✅ Direct | `esp_wifi` | Strongest-AP selection, reconnect policy, gateway recovery and setup AP | [`wifi.cpp`](../main/wifi.cpp), [`provisioning.cpp`](../main/provisioning.cpp) | [Wi-Fi](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/esp_wifi.html) |
| U09 | Event loop and network interfaces | ✅ Direct | `esp_event`, `esp_netif` | Shared Wi-Fi/Ethernet lifecycle, DHCP identity and interface state | [`main.cpp`](../main/main.cpp), [`net.cpp`](../main/net.cpp), [`wifi.cpp`](../main/wifi.cpp) | [Event loop](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/esp_event.html), [ESP-NETIF](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/esp_netif.html) |
| U10 | lwIP sockets, ICMP echo and SNTP | ✅ Direct | `lwip` | Captive DNS, read-only Modbus TCP, syslog, gateway ping, wall-clock synchronization and boot-primed cross-task `shutdown()` interruption of blocking HTTP receive loops | [`captive_dns.cpp`](../main/captive_dns.cpp), [`hp_modbus.cpp`](../main/hp_modbus.cpp), [`sntp_time.cpp`](../main/sntp_time.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp) | [lwIP](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/lwip.html), [ICMP echo](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/icmp_echo.html), [ESP-NETIF SNTP](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/esp_netif_programming.html#sntp-service) |
| U11 | External W5500 Ethernet over SPI | ✅ Direct + 📦 Managed | `esp_eth`, `esp_driver_spi`, `espressif/w5500` | Optional wired transport detected at boot; W5500 MAC/PHY comes from the registry component | [`net.cpp`](../main/net.cpp), [`idf_component.yml`](../main/idf_component.yml) | [Ethernet](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/esp_eth.html), [W5500 component](https://components.espressif.com/components/espressif/w5500) |
| U12 | HTTP server | ✅ Direct | `esp_http_server` | Trusted-LAN UI/API and restricted setup-AP surface with bounded chunk streaming | [`http_server.cpp`](../main/http_server.cpp), [`http_common.cpp`](../main/http_common.cpp) | [HTTP server](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/esp_http_server.html) |
| U13 | HTTP client, TLS and certificate bundle | ✅ Direct + 🧩 Backend | `esp_http_client`, `esp-tls` | HTTPS OTA/weather downloads, verified public-root TLS transport and public socket access for joined header/body deadline enforcement after open | [`ota_update.cpp`](../main/ota_update.cpp), [`weather_forecast.cpp`](../main/weather_forecast.cpp), [`http_deadline.cpp`](../main/http_deadline.cpp) | [HTTP client](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/esp_http_client.html), [ESP-TLS](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/esp_tls.html), [certificate bundle](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/esp_crt_bundle.html) |
| U14 | MQTT client | ✅ Direct + 📦 Managed | `mqtt`, `espressif/mqtt` | Home Assistant discovery, state, optional source subscriptions, last will and incremental-id-correlated PUBACK/expiry cleanup under a bounded outbox | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`mqtt_cleanup.hpp`](../main/logic/mqtt_cleanup.hpp), [`sdkconfig.defaults`](../sdkconfig.defaults), [`idf_component.yml`](../main/idf_component.yml) | [ESP-MQTT component](https://components.espressif.com/components/espressif/mqtt) |
| U15 | Multicast DNS | ✅ Direct + 📦 Managed | `mdns`, `espressif/mdns` | Device HTTP service advertisement and explicit HomeHub discovery | [`net.cpp`](../main/net.cpp), [`hp_modbus.cpp`](../main/hp_modbus.cpp) | [mDNS component](https://components.espressif.com/components/espressif/mdns) |
| U16 | cJSON | ✅ Direct + 📦 Managed | `espressif/cjson` | Bounded config, MQTT and weather-response parsing; large output remains streamed | [`http_config.cpp`](../main/http_config.cpp), [`weather_forecast.cpp`](../main/weather_forecast.cpp) | [cJSON component](https://components.espressif.com/components/espressif/cjson) |
| U17 | OTA, app-image format, signed-image validation and rollback | ✅ Direct + 🧩 Backend | `app_update`, `esp_app_format`, `bootloader_support` | Boot-resident static delivery worker, low-level slot writes, embedded descriptor checks, generation-bound transient HIL feeds, boot-local OTA-stack evidence, boot-latched pending/valid state, signed-update verification, isolated rollback/cold-cycle proof and a rollback-safe candidate-writer round trip through the pinned bootstrap | [`ota_update.cpp`](../main/ota_update.cpp), [`ota_hil_feed.hpp`](../main/logic/ota_hil_feed.hpp), [`stack_watch.hpp`](../main/stack_watch.hpp), [`sdkconfig.defaults`](../sdkconfig.defaults), [`production-ota-gate.py`](../scripts/production-ota-gate.py) | [OTA](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/ota.html), [application image format](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/app_image_format.html) |
| U18 | Mbed TLS and PSA Crypto | ✅ Direct + 🧩 Backend | `mbedtls` | Dynamic TLS record buffers, direct PSA SHA-256 OTA binding and host verification of the signed-image RSA-PSS trust anchor | [`ota_update.cpp`](../main/ota_update.cpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`sdkconfig.defaults`](../sdkconfig.defaults), [`check-signing-key-continuity.py`](../scripts/check-signing-key-continuity.py) | [Mbed TLS support](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/mbedtls.html) |
| U19 | UART driver | ✅ Direct | `esp_driver_uart` | X10A 9600 8E1 request/response link | [`hp_comm.cpp`](../main/hp_comm.cpp) | [UART](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/peripherals/uart.html) |
| U20 | I2C master driver | ✅ Direct | `esp_driver_i2c` | Optional ENV III sensor bus using the current master-bus/device API | [`env3.cpp`](../main/env3.cpp) | [I2C](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/peripherals/i2c.html) |
| U21 | GPIO driver | ✅ Direct | `esp_driver_gpio` | Plain status LED, recovery button and runtime pin configuration | [`status_led.cpp`](../main/status_led.cpp), [`recovery_button.cpp`](../main/recovery_button.cpp) | [GPIO](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/peripherals/gpio.html) |
| U22 | RMT-backed addressable LED | ✅ Direct + 🧩 Backend + 📦 Managed | `esp_driver_rmt`, `led_strip`, `espressif/led_strip` | Application calls `led_strip`; the component owns the RMT channel and waveform | [`status_led.cpp`](../main/status_led.cpp), [`idf_component.yml`](../main/idf_component.yml) | [RMT](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/peripherals/rmt.html), [LED Strip component](https://components.espressif.com/components/espressif/led_strip) |
| U23 | USB Serial/JTAG console | ✅ Direct | IDF core | Native USB console remains separate from the X10A UART | [`sdkconfig.defaults`](../sdkconfig.defaults), [`BOARDS.md`](BOARDS.md) | [USB Serial/JTAG](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/usb-serial-jtag-console.html) |
<!-- esp-idf-matrix:used:end -->

## Evaluated but not used

These rows record deliberate decisions, not promises of future implementation. A status change must
move the feature into the used table and add real source evidence.

<!-- esp-idf-matrix:evaluated:start -->
| ID | Feature | Status | Origin | Decision | Checked against | Official documentation |
|---|---|---|---|---|---|---|
| N01 | ESP-Modbus TCP master | 🔬 Evaluate | Registry component | Only credible near-term replacement candidate; benchmark footprint, deadlines, error parity and read-only construction before adoption | [`hp_modbus.cpp`](../main/hp_modbus.cpp), [`idf_component.yml`](../main/idf_component.yml) | [ESP-Modbus](https://components.espressif.com/components/espressif/esp-modbus) |
| N02 | Network Provisioning and Protocomm | ⏸ Conditional | Registry component + IDF core | Consider only if per-device proof-of-possession, an app or a CLI becomes preferable to app-free browser setup | [`provisioning.cpp`](../main/provisioning.cpp), [`SECURITY.md`](SECURITY.md) | [Network Provisioning](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/provisioning/provisioning.html), [Protocomm](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/provisioning/protocomm.html) |
| N03 | HMAC-backed NVS encryption | ⏸ Conditional | IDF security capability | Valuable credential-at-rest hardening, but requires per-device eFuse/key provisioning and a migration/recovery design | [`SECURITY.md`](SECURITY.md), [`partitions.csv`](../partitions.csv) | [NVS encryption](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/storage/nvs_flash.html#nvs-encryption) |
| N04 | ESP Wi-Fi Service | ⏸ Conditional | Registry component | Broad overlap with the existing connection/provisioning policy, but the 0.x service is not yet a lower-risk replacement | [`wifi.cpp`](../main/wifi.cpp), [`idf_component.yml`](../main/idf_component.yml) | [ESP Wi-Fi Service](https://components.espressif.com/components/espressif/esp_wifi_service) |
| N05 | ESP Config Manager | ⏸ Conditional | Registry component | Overlaps CRC, schema and storage backends; current field ownership and atomic blob semantics still need application logic | [`config.cpp`](../main/config.cpp), [`idf_component.yml`](../main/idf_component.yml) | [ESP Config Manager](https://components.espressif.com/components/espressif/esp_config_manager) |
| N06 | `esp_https_ota` convenience layer | 🚫 Not planned | IDF core | IDF 6.0.2 validates before freeing TLS/HTTP resources; the measured project path must free them first and also binds manifest, version and digest | [`ota_update.cpp`](../main/ota_update.cpp) | [ESP HTTPS OTA](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/esp_https_ota.html) |
| N07 | HTTPS server | ⏸ Conditional | IDF core | TLS alone is not authentication; adopt only with a managed certificate or mTLS lifecycle and measured internal-heap budget | [`http_server.cpp`](../main/http_server.cpp), [`SECURITY.md`](SECURITY.md) | [HTTPS server](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/esp_https_server.html) |
| N08 | Hardware Secure Boot v2 and Flash Encryption | ⏸ Conditional | IDF security capabilities | Possible hardened production profile; intentionally not the reversible default because eFuse and recovery effects are permanent | [`sdkconfig.defaults`](../sdkconfig.defaults), [`SECURITY.md`](SECURITY.md) | [Secure Boot v2](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/security/secure-boot-v2.html), [Flash Encryption](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/security/flash-encryption.html) |
| N09 | FATFS, SPIFFS, LittleFS and Wear Levelling | 🚫 Not planned | IDF core + external component | No file namespace is needed; the history partition already has rotating sectors, CRC and a commit word | [`history.cpp`](../main/history.cpp), [`partitions.csv`](../partitions.csv) | [File-system considerations](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/file-system-considerations.html), [Wear Levelling](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/storage/wear-levelling.html) |
| N10 | ESP-DL | 🚫 Not planned | Registry component | ESP32-S3 is supported, but this firmware has no validated on-device model, feature pipeline or ground truth contract | [`idf_component.yml`](../main/idf_component.yml), [`sdkconfig.defaults`](../sdkconfig.defaults) | [ESP-DL](https://docs.espressif.com/projects/esp-dl/en/latest/getting_started/readme.html) |
| N11 | ESP-DSP | 🚫 Not planned | Registry component | Revisit only for a measured FFT, filter, matrix or vector hotspot | [`idf_component.yml`](../main/idf_component.yml) | [ESP-DSP](https://docs.espressif.com/projects/esp-dsp/en/latest/esp32/index.html) |
| N12 | NimBLE and Bluetooth LE | ⏸ Conditional | IDF core | Possible provisioning transport, but adds radio coexistence, flash and heap cost; no runtime BLE feature exists | [`sdkconfig.defaults`](../sdkconfig.defaults), [`BOARDS.md`](BOARDS.md) | [NimBLE](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/bluetooth/nimble/index.html) |
| N13 | ESP-Matter | 🚫 Not planned | Espressif solution SDK | Duplicates the established MQTT/Home Assistant integration and adds commissioning, flash and compatibility cost | [`mqtt_ha.cpp`](../main/mqtt_ha.cpp), [`idf_component.yml`](../main/idf_component.yml) | [ESP-Matter](https://github.com/espressif/esp-matter) |
| N14 | ESP Insights, ESP Diagnostics and RainMaker | 🚫 Not planned | Registry/cloud services | Cloud diagnostics and device management duplicate the local coredump, syslog, HTTP and MQTT evidence paths | [`diag_crash.cpp`](../main/diag_crash.cpp), [`syslog.cpp`](../main/syslog.cpp) | [ESP Insights](https://components.espressif.com/components/espressif/esp_insights), [ESP RainMaker](https://github.com/espressif/esp-rainmaker) |
| N15 | ESP-NOW, Wi-Fi Mesh, DPP and SmartConfig | 🚫 Not planned | IDF core | The product is one LAN bridge, not a peer network; credential-only onboarding is narrower than the existing setup flow | [`wifi.cpp`](../main/wifi.cpp), [`provisioning.cpp`](../main/provisioning.cpp) | [ESP-NOW](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/esp_now.html), [Wi-Fi provisioning protocols](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/index.html) |
| N16 | PSRAM | ⏸ Conditional | ESP32-S3 capability | Optional non-critical buffers could use it, but it does not replace the binding largest contiguous internal block or DMA-capable memory | [`sdkconfig.defaults`](../sdkconfig.defaults), [`BOARDS.md`](BOARDS.md) | [External RAM](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/external-ram.html) |
| N17 | Heap tracing, Application Trace, GDB Stub and ESP Console | ⏸ Conditional | IDF development features | Useful in explicit laboratory builds; they do not replace field coredumps, stack/heap telemetry or `/diag` | [`diag_crash.cpp`](../main/diag_crash.cpp), [`heap_guard.cpp`](../main/heap_guard.cpp) | [Heap debugging](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/heap_debug.html), [Application Trace](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/app_trace.html) |
| N18 | HTTP WebSockets | 🚫 Not planned | IDF HTTP server option | Deliberately disabled; transport support does not solve bounded fan-out, ownership or backpressure | [`sdkconfig.defaults`](../sdkconfig.defaults), [`ARCHITECTURE.md`](ARCHITECTURE.md) | [HTTP server WebSocket support](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/protocols/esp_http_server.html#websocket-server) |
| N19 | Power management, sleep modes and ULP | 🚫 Not planned | ESP32-S3 capability | A continuously reachable X10A, MQTT and HTTP bridge cannot hand its network duties to sleep or the ULP | [`wifi.cpp`](../main/wifi.cpp), [`hp_poll.cpp`](../main/hp_poll.cpp) | [Sleep modes](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/sleep_modes.html), [ULP](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/system/ulp.html) |
| N20 | USB OTG, TinyUSB and DFU | 🚫 Not planned | ESP32-S3 capability | Native USB Serial/JTAG already owns the device-console contract; no USB product function is required | [`sdkconfig.defaults`](../sdkconfig.defaults), [`BOARDS.md`](BOARDS.md) | [USB device stack](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/peripherals/usb_device.html) |
| N21 | OpenThread and Zigbee | ⛔ Unsupported | External radio required | ESP32-S3 has no integrated IEEE 802.15.4 radio; a separate RCP would add hardware without serving the bridge | [`BOARDS.md`](BOARDS.md) | [OpenThread](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/openthread.html) |
| N22 | SDMMC, TWAI, I2S, LCD/camera, ADC/touch, MCPWM and PCNT | 🚫 Not planned | ESP32-S3 peripherals | No supported board or product path needs these peripherals | [`BOARDS.md`](BOARDS.md), [`WIRING.md`](WIRING.md) | [Peripheral API index](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/peripherals/index.html) |
| N23 | ESP-WHO and ESP-SR | 🚫 Not planned | Espressif solution SDKs | No camera, microphone, vision or speech product requirement exists | [`BOARDS.md`](BOARDS.md) | [ESP-WHO](https://github.com/espressif/esp-who), [ESP-SR](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/index.html) |
| N24 | Bluetooth Classic | ⛔ Unsupported | Not present on ESP32-S3 | ESP32-S3 supports Bluetooth LE, not Bluetooth Classic | [`BOARDS.md`](BOARDS.md) | [ESP32-S3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf) |
| N25 | Internal Ethernet EMAC | ⛔ Unsupported | Not present on ESP32-S3 | Wired networking correctly uses an external W5500 over SPI | [`net.cpp`](../main/net.cpp), [`BOARDS.md`](BOARDS.md) | [Ethernet](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/network/esp_eth.html) |
<!-- esp-idf-matrix:evaluated:end -->

## Active ESP-IDF configuration contract

Every active assignment from `sdkconfig.defaults`, including explicit `=n` decisions, appears here
exactly once. Comments and the commented PSRAM example are not active assignments. The gate compares
this appendix byte-for-byte at the value level and rejects an unknown setting until it is assigned
to a used feature row.

<!-- esp-idf-matrix:sdkconfig:start -->
| Setting | Value | Feature ID |
|---|---|---|
| `CONFIG_IDF_TARGET` | `"esp32s3"` | U01 |
| `CONFIG_APP_REPRODUCIBLE_BUILD` | `y` | U01 |
| `CONFIG_ESPTOOLPY_FLASHSIZE_8MB` | `y` | U01 |
| `CONFIG_PARTITION_TABLE_CUSTOM` | `y` | U06 |
| `CONFIG_PARTITION_TABLE_CUSTOM_FILENAME` | `"partitions.csv"` | U06 |
| `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG` | `y` | U23 |
| `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` | `y` | U17 |
| `CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT` | `y` | U17 |
| `CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME` | `y` | U17 |
| `CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT` | `y` | U17 |
| `CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES` | `n` | U17 |
| `CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM` | `10` | U08 |
| `CONFIG_ESP_WIFI_DYNAMIC_RX_BUFFER_NUM` | `32` | U08 |
| `CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER` | `y` | U08 |
| `CONFIG_HTTPD_MAX_REQ_HDR_LEN` | `1024` | U12 |
| `CONFIG_HTTPD_MAX_URI_LEN` | `512` | U12 |
| `CONFIG_MQTT_REPORT_DELETED_MESSAGES` | `y` | U14 |
| `CONFIG_MQTT_MSG_ID_INCREMENTAL` | `y` | U14 |
| `CONFIG_LWIP_MAX_SOCKETS` | `16` | U10 |
| `CONFIG_LWIP_DHCP_DISABLE_VENDOR_CLASS_ID` | `n` | U10 |
| `CONFIG_LWIP_DHCP_OPTIONS_LEN` | `109` | U10 |
| `CONFIG_LWIP_TCP_SND_BUF_DEFAULT` | `11520` | U10 |
| `CONFIG_LWIP_TCP_WND_DEFAULT` | `11520` | U10 |
| `CONFIG_ESP_MAIN_TASK_STACK_SIZE` | `6144` | U02 |
| `CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK` | `y` | U02 |
| `CONFIG_LOG_DEFAULT_LEVEL_INFO` | `y` | U03 |
| `CONFIG_HTTPD_WS_SUPPORT` | `n` | U12 |
| `CONFIG_COMPILER_OPTIMIZATION_SIZE` | `y` | U01 |
| `CONFIG_MBEDTLS_ERROR_STRINGS` | `n` | U18 |
| `CONFIG_MBEDTLS_CLIENT_SSL_SESSION_TICKETS` | `n` | U18 |
| `CONFIG_MBEDTLS_SERVER_SSL_SESSION_TICKETS` | `n` | U18 |
| `CONFIG_MBEDTLS_FS_IO` | `n` | U18 |
| `CONFIG_MBEDTLS_DYNAMIC_BUFFER` | `y` | U18 |
| `CONFIG_MBEDTLS_DYNAMIC_FREE_CONFIG_DATA` | `n` | U18 |
| `CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_CMN` | `y` | U13 |
| `CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_SILENT` | `y` | U01 |
| `CONFIG_ESP_WIFI_ENABLE_WPA3_OWE_STA` | `n` | U08 |
| `CONFIG_COMPILER_CXX_EXCEPTIONS` | `y` | U01 |
| `CONFIG_ESP_COREDUMP_ENABLE` | `y` | U07 |
| `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH` | `y` | U07 |
| `CONFIG_ESP_TASK_WDT_EN` | `y` | U04 |
| `CONFIG_ESP_TASK_WDT_INIT` | `y` | U04 |
| `CONFIG_ESP_TASK_WDT_TIMEOUT_S` | `20` | U04 |
| `CONFIG_ESP_TASK_WDT_PANIC` | `y` | U04 |
<!-- esp-idf-matrix:sdkconfig:end -->

## What the gate proves

`scripts/run-esp-idf-matrix-audit.sh` fails when:

- an explicit CMake component or direct managed dependency has no used row;
- the pinned IDF version, target or manifest floor differs from this document;
- an active `sdkconfig.defaults` assignment is missing, stale or assigned to a non-used row;
- application code includes an unclassified ESP-IDF-shaped header;
- a required evaluated feature disappears, or a row has a duplicate id, an invalid status, a
  missing evidence target or no version-pinned official documentation link;
- a reviewed native/manual boundary changes silently: low-level OTA, custom read-only Modbus,
  captive DNS or the indirect RMT backend.

Its mutation selftest reintroduces each class of drift in a throwaway tree. The checker does not
access the network and therefore validates official link ownership and shape, not remote uptime.

[idf-esp32-start]: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html
[idf-s3-api]: https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/api-reference/index.html
