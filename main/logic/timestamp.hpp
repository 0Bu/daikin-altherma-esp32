#pragma once
// Pure UTC timestamp formatting for the wall clock the SNTP client (main/sntp_time.cpp) establishes
// once synced. IDF-free (just <ctime>), so the framing is host-tested rather than only exercised
// once a real NTP reply lands on a board. Three consumers: syslog.cpp's RFC 5424 TIMESTAMP field
// (else the "-" NILVALUE), /status.ntp.time, and mqtt_ha.cpp's heartbeat "time" field.
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <string>

namespace daik {

// Formats unix_s (seconds since epoch, UTC) + ms (0-999) as RFC 3339 / ISO 8601:
// "YYYY-MM-DDTHH:MM:SS.mmmZ" — the exact profile RFC 5424 §6.2.3 requires for its TIMESTAMP field,
// so the same string serves both callers. Returns "" for unix_s < 0 rather than rendering a garbage
// 1970-01-01 date: the caller's contract is "call this only once synced" (time_synced()), but a
// not-yet-synced sentinel must fail visibly, not silently mislabel every line as the epoch.
inline std::string rfc3339_utc(int64_t unix_s, int32_t ms = 0) {
    if (unix_s < 0) return "";
    if (ms < 0) ms = 0;
    if (ms > 999) ms = 999;
    std::time_t t = static_cast<std::time_t>(unix_s);
    std::tm tm_utc{};
    gmtime_r(&t, &tm_utc);   // UTC always — never the locale/TZ-dependent localtime_r
    char buf[32];
    // ms cast to int for %d: int32_t is `long int` on the xtensa-esp32s3 toolchain (though plain
    // `int` on the host), so passing it through unchanged is a real type mismatch there even though
    // it's a no-op on the platforms where int32_t already IS int — caught by -Werror=format= in CI
    // (pinned on main/ in main/CMakeLists.txt), not by scripts/run-mock-tests.sh's host build.
    int n = std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                          tm_utc.tm_year + 1900, tm_utc.tm_mon + 1, tm_utc.tm_mday,
                          tm_utc.tm_hour, tm_utc.tm_min, tm_utc.tm_sec, static_cast<int>(ms));
    if (n <= 0) return "";
    return buf;
}

} // namespace daik
