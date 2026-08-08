#pragma once
// The firmware's FreeRTOS task PRIORITIES, in one place.
//
// Every xTaskCreate site used to spell its priority as a bare literal in its own file, so the only
// way to answer "what preempts what?" was to grep twelve files and sort the answers by hand — and
// docs/ARCHITECTURE.md's task inventory, which states the ordering in prose, had nothing to drift
// against. Relative priority is a property of the SYSTEM, not of any one module: it is only
// meaningful next to the other eleven, so it is declared next to them.
//
// STACK SIZES deliberately stay at the call sites. They are the opposite kind of fact — each one is
// justified by what that particular task's deepest call chain does (syslog's getaddrinfo + socket
// chain, the OTA task's TLS handshake, the poll task's decode) and CLAUDE.md's memory section is
// emphatic that a stack budget is read off a measured frame, not chosen from a table. A shared table
// of sizes would invite exactly the copy-the-neighbour sizing it warns against.
//
// Relative ordering (higher preempts lower):
//   5 — work that must not starve behind anything else of ours. The poll task OWNS the X10A UART and
//       is Task-Watchdog-subscribed, so a delayed cycle is a step toward a watchdog reboot; the
//       setup portal's DNS catch-all has to answer a joining phone's connectivity probe inside that
//       probe's own timeout, or the captive portal never pops and the device looks unprovisionable.
//   4 — supervisors and bridge publishers: periodic, latency-tolerant, but expected to run promptly
//       when due. The MQTT bridge, the second (HomeHub) source, the optional ENV III sensor, the
//       connectivity watchdog, and the two OTA tasks — which hold a TLS peer that will time out.
//   3 — local reporting with relaxed deadlines: best-effort UDP syslog, the 45-minute weather fetch,
//       and the recovery button's debounced sampling.
//   2 — cosmetics. The status indicator is below everything: a dropped tick costs nothing (the next
//       one recomputes the pattern from scratch).
// The esp_http_server task and esp-mqtt's own event task are created by ESP-IDF with their own
// Kconfig-set priorities and are not governed by this table.
#include "freertos/FreeRTOS.h"

namespace daik {

inline constexpr UBaseType_t TASK_PRIO_POLL        = 5;  // hp_poll.cpp         X10A bus owner, wdt-subscribed
inline constexpr UBaseType_t TASK_PRIO_CAPTIVE_DNS = 5;  // captive_dns.cpp     setup-AP DNS catch-all (setup mode only)
inline constexpr UBaseType_t TASK_PRIO_MQTT        = 4;  // mqtt_ha.cpp         HA bridge publisher + inbound sources
inline constexpr UBaseType_t TASK_PRIO_MODBUS      = 4;  // hp_modbus.cpp       the second, independent HomeHub source
inline constexpr UBaseType_t TASK_PRIO_ENV3        = 4;  // env3.cpp            optional ENV III climate sensor
inline constexpr UBaseType_t TASK_PRIO_WIFI_WD     = 4;  // wifi.cpp            ghost-association watchdog
inline constexpr UBaseType_t TASK_PRIO_OTA         = 4;  // ota_update.cpp      manifest check / download (transient)
inline constexpr UBaseType_t TASK_PRIO_OTA_GATE    = 4;  // ota_update.cpp      one-shot rollback health gate
inline constexpr UBaseType_t TASK_PRIO_SYSLOG      = 3;  // syslog.cpp          best-effort UDP forwarder (opt-in)
inline constexpr UBaseType_t TASK_PRIO_WEATHER     = 3;  // weather_forecast.cpp Open-Meteo fetch (opt-in)
inline constexpr UBaseType_t TASK_PRIO_BUTTON      = 3;  // recovery_button.cpp physical factory reset (opt-in)
inline constexpr UBaseType_t TASK_PRIO_LED         = 2;  // status_led.cpp      status indicator

} // namespace daik
