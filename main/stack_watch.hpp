#pragma once
// Boot-local stack minima for application-owned tasks. FreeRTOS high-water marks are
// retrospective, so each owner samples at its loop top and before retirement/restart.
#include <cstdint>

namespace daik {

enum class StackWatch : uint8_t {
    Httpd = 0, // 10240 bytes; sampled after requests, null until a request completes
    Poll,      // hp_poll — legacy-241 died here, 8192
    Mqtt,      // the publish task, whose cycle builds every payload
    Modbus,    // the HomeHub link; retires and is recreated after configuration changes
    Weather,   // Open-Meteo TLS + HTTP + JSON task; release HIL requires its post-fetch evidence
    Ota,       // boot-resident check/install worker; minimum spans operations for this boot
    Syslog,
    Env3,
    Led,
    Button,
    WifiWatchdog,
    EthFallback,
    CaptiveDns,
    OtaHealth,
    HttpDeadline,
    Main,
    SdkMqtt, // only SDK-task BEFORE_CONNECT/CONNECTED/DATA callbacks; ERROR can run on a caller
    COUNT,
};

struct StackWatchField {
    StackWatch  slot;
    const char* name;
};

// Additional /status.sys fields. Static metadata avoids one builder temporary per task.
inline constexpr StackWatchField STACK_WATCH_EXTRA_FIELDS[] = {
    {StackWatch::Ota, "ota"},
    {StackWatch::Syslog, "syslog"},
    {StackWatch::Env3, "env3"},
    {StackWatch::Led, "led"},
    {StackWatch::Button, "button"},
    {StackWatch::WifiWatchdog, "wifi_watchdog"},
    {StackWatch::EthFallback, "eth_fallback"},
    {StackWatch::CaptiveDns, "captive_dns"},
    {StackWatch::OtaHealth, "ota_health"},
    {StackWatch::HttpDeadline, "http_deadline"},
    {StackWatch::Main, "main"},
    {StackWatch::SdkMqtt, "sdk_mqtt"},
};

// MUST run on the owning task: uxTaskGetStackHighWaterMark(nullptr) reads the caller.
// Never substitute a foreign task handle. Allocation-free and noexcept, including calls
// while an HTTP handler exception unwinds. SDK-created tasks need their own proven hook.
void stack_watch_sample(StackWatch which) noexcept;

// ESP-IDF reports BYTES, unlike vanilla FreeRTOS's words. Each minimum survives task
// recreation and successive OTA operations until reboot. Zero means never sampled;
// every reporting site renders it as null, never as zero bytes of claimed headroom.
uint32_t stack_watch_min_free_bytes(StackWatch which) noexcept;

} // namespace daik
