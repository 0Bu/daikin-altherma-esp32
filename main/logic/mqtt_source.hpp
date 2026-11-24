#pragma once
// Bounded exact MQTT mappings and source-time validation for read-only observations.
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace daik {

inline constexpr size_t  MQTT_SOURCE_TOPIC_MAX          = 192;
inline constexpr size_t  MQTT_SOURCE_PATH_MAX           = 128;
inline constexpr size_t  MQTT_SOURCE_KEY_MAX            = 64;
inline constexpr int64_t MQTT_SOURCE_FUTURE_TOLERANCE_S = 60;
// Acceptance history belongs to the exact saved source binding, independently of whether the
// latest visible sample was invalidated. A decoder rejection must not roll this high-water mark
// back; changing the binding explicitly resets it.
struct SourceTimestampHighWater {
    bool    has_timestamp = false;
    int64_t last_unix_s   = -1;

    bool allows(int64_t candidate_unix_s) const {
        return candidate_unix_s >= 0 && (!has_timestamp || candidate_unix_s >= last_unix_s);
    }
    bool accept(int64_t candidate_unix_s) {
        if (!allows(candidate_unix_s)) return false;
        has_timestamp = true;
        last_unix_s   = candidate_unix_s;
        return true;
    }
    void reset() { *this = SourceTimestampHighWater{}; }
};

// Zero is reserved for a source that has never been applied. A queued frame is accepted only by
// the very request under which its first fragment arrived, after that request was applied.
inline constexpr bool mqtt_source_epoch_current(uint32_t frame_epoch, uint32_t applied_epoch,
                                                uint32_t requested_epoch) {
    return frame_epoch != 0 && frame_epoch == applied_epoch && applied_epoch == requested_epoch;
}

// Exact topics only. Wildcards would let one small ESP32 subscription receive an unbounded set of
// unrelated payloads and make "which sensor produced this value?" ambiguous.
inline bool mqtt_source_topic_valid(std::string_view topic, const char** why = nullptr) {
    auto fail = [&](const char* text) {
        if (why) *why = text;
        return false;
    };
    if (topic.empty()) return true; // empty = feature disabled
    if (topic.size() > MQTT_SOURCE_TOPIC_MAX) return fail("MQTT topic is too long");
    if (topic.front() == '/' || topic.back() == '/')
        return fail("MQTT topic must not start or end with /");
    for (const unsigned char c : topic) {
        if (c < 0x20 || c == 0x7f) return fail("MQTT topic contains a control character");
        if (c == '+' || c == '#') return fail("MQTT topic must be exact (no + or # wildcard)");
    }
    return true;
}

// A deliberately small path language: dot-separated JSON object keys, e.g. `temperature.tC`.
// It is not branded as JSONPath because operators, filters and arrays are not supported yet.
inline bool mqtt_source_json_path_valid(std::string_view path, const char** why = nullptr) {
    auto fail = [&](const char* text) {
        if (why) *why = text;
        return false;
    };
    if (path.empty()) return fail("JSON path is required");
    if (path.size() > MQTT_SOURCE_PATH_MAX) return fail("JSON path is too long");
    size_t key_len = 0;
    for (const unsigned char c : path) {
        if (c == '.') {
            if (key_len == 0) return fail("JSON path contains an empty key");
            key_len = 0;
            continue;
        }
        if (c < 0x21 || c == 0x7f)
            return fail("JSON path contains whitespace or a control character");
        if (++key_len > MQTT_SOURCE_KEY_MAX) return fail("JSON path key is too long");
    }
    if (key_len == 0) return fail("JSON path contains an empty key");
    return true;
}

inline bool mqtt_source_leap_year(int year) {
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

inline int mqtt_source_days_in_month(int year, int month) {
    static constexpr uint8_t days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (month < 1 || month > 12) return 0;
    return month == 2 && mqtt_source_leap_year(year) ? 29 : days[month - 1];
}

inline bool mqtt_source_parse_digits(std::string_view text, size_t pos, size_t count, int& out) {
    if (pos + count > text.size()) return false;
    int value = 0;
    for (size_t i = 0; i < count; i++) {
        const char c = text[pos + i];
        if (c < '0' || c > '9') return false;
        value = value * 10 + (c - '0');
    }
    out = value;
    return true;
}

// Days since 1970-01-01. Howard Hinnant's civil-calendar mapping, kept local to avoid timegm()
// portability differences between the host tests and newlib on ESP-IDF.
inline int64_t mqtt_source_days_from_civil(int year, unsigned month, unsigned day) {
    year -= month <= 2;
    const int      era           = (year >= 0 ? year : year - 399) / 400;
    const unsigned yoe           = static_cast<unsigned>(year - era * 400);
    const unsigned shifted_month = month > 2 ? month - 3 : month + 9;
    const unsigned doy           = (153 * shifted_month + 2) / 5 + day - 1;
    const unsigned doe           = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return static_cast<int64_t>(era) * 146097 + static_cast<int64_t>(doe) - 719468;
}

// Strict timezone-qualified RFC3339 parser. Go's time.Time JSON form (including nanosecond
// fractions) is accepted, as are explicit +/-HH:MM offsets. Fractions are deliberately discarded:
// freshness is configured in whole seconds and the status contract reports whole-second age.
inline bool mqtt_source_parse_rfc3339(std::string_view text, int64_t& unix_s) {
    if (text.size() < 20 || text[4] != '-' || text[7] != '-' ||
        (text[10] != 'T' && text[10] != 't') || text[13] != ':' || text[16] != ':')
        return false;
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    if (!mqtt_source_parse_digits(text, 0, 4, year) ||
        !mqtt_source_parse_digits(text, 5, 2, month) ||
        !mqtt_source_parse_digits(text, 8, 2, day) ||
        !mqtt_source_parse_digits(text, 11, 2, hour) ||
        !mqtt_source_parse_digits(text, 14, 2, minute) ||
        !mqtt_source_parse_digits(text, 17, 2, second))
        return false;
    if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 ||
        day > mqtt_source_days_in_month(year, month) || hour > 23 || minute > 59 || second > 59)
        return false;

    size_t pos = 19;
    if (pos < text.size() && text[pos] == '.') {
        const size_t first = ++pos;
        while (pos < text.size() && text[pos] >= '0' && text[pos] <= '9') pos++;
        if (pos == first || pos - first > 9) return false;
    }
    int offset_s = 0;
    if (pos < text.size() && (text[pos] == 'Z' || text[pos] == 'z')) {
        pos++;
    } else if (pos < text.size() && (text[pos] == '+' || text[pos] == '-')) {
        const bool negative = text[pos++] == '-';
        int        offset_h = 0, offset_m = 0;
        if (!mqtt_source_parse_digits(text, pos, 2, offset_h)) return false;
        pos += 2;
        if (pos >= text.size() || text[pos++] != ':' ||
            !mqtt_source_parse_digits(text, pos, 2, offset_m))
            return false;
        pos += 2;
        if (offset_h > 23 || offset_m > 59) return false;
        offset_s = (offset_h * 60 + offset_m) * 60;
        if (negative) offset_s = -offset_s;
    } else {
        return false; // a local time is not a source instant
    }
    if (pos != text.size()) return false;
    const int64_t local_s = mqtt_source_days_from_civil(year, static_cast<unsigned>(month),
                                                        static_cast<unsigned>(day)) *
                                86400 +
                            hour * 3600 + minute * 60 + second;
    unix_s = local_s - offset_s;
    return unix_s >= 0;
}

struct MqttSourceFreshness {
    bool        fresh     = false;
    bool        age_known = false;
    uint64_t    age_s     = 0;
    const char* reason    = "no_value";
};

// A payload timestamp survives broker retention/restart and is authoritative for age. Without one,
// only a live (non-retained) delivery can use monotonic MQTT arrival time. This is the fail-closed
// distinction that prevents an old retained value from becoming "fresh" merely by reconnecting.
inline MqttSourceFreshness mqtt_source_freshness(bool has_value, bool retained,
                                                 bool has_source_time, int64_t source_unix_s,
                                                 uint64_t received_ms, int64_t now_unix_s,
                                                 uint64_t now_ms, uint32_t max_age_s) {
    MqttSourceFreshness f;
    if (!has_value) return f;
    if (has_source_time) {
        if (now_unix_s < 0) {
            f.reason = "clock_unsynced";
            return f;
        }
        if (source_unix_s < 0) {
            f.reason = "missing_source_time";
            return f;
        }
        // Both instants are nonnegative int64_t, so their signed difference cannot overflow.
        const int64_t age = now_unix_s - source_unix_s;
        if (age < -MQTT_SOURCE_FUTURE_TOLERANCE_S) {
            f.reason = "future_timestamp";
            return f;
        }
        f.age_known = true;
        f.age_s     = age < 0 ? 0 : static_cast<uint64_t>(age);
    } else {
        if (retained) {
            f.reason = "retained_without_timestamp";
            return f;
        }
        if (now_ms < received_ms) {
            f.reason = "arrival_clock_invalid";
            return f;
        }
        f.age_known = true;
        f.age_s     = (now_ms - received_ms) / 1000;
    }
    if (f.age_s > max_age_s) {
        f.reason = "stale";
        return f;
    }
    f.fresh  = true;
    f.reason = "fresh";
    return f;
}

} // namespace daik
