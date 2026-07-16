#pragma once
// Reset-reason vocabulary for /status.sys.reset_reason and the diagnostics that answer "why did the
// device last boot?". reset_reason_name(code) maps a raw esp_reset_reason_t value to a short, stable
// slug (poweron / sw / panic / task_wdt / brownout / deepsleep / ...), degrading any unknown or newer
// code to "unknown" rather than asserting a wrong cause. Being IDF-free it is exercised directly by
// the host test suite; the device passes esp_reset_reason() straight through.
//
// SINGLE SOURCE OF TRUTH: the slug table already lives in crashinfo.hpp (crash_reason_slug), which
// backs /status.last_crash and the retained MQTT crash entity. reset_reason_name() reuses it so the
// sys block, the crash HA entity and the heartbeat reset_reason (issue #5) all speak ONE vocabulary —
// no second table to drift. This header just gives that mapping an intention-revealing name for the
// general reset-reason case (a poweron / software reboot is not a "crash"), and a stable include point
// for the HA-diagnostics follow-up to reuse.
#include "crashinfo.hpp"

namespace daik {

inline const char* reset_reason_name(int code) {
    return crash_reason_slug(static_cast<uint32_t>(code));
}

} // namespace daik
