#pragma once
// Read-only MQTT external electrical power meter & gas-cost tariff configuration.
// Validation, unit scaling and source-identity fingerprinting live here (IDF-free,
// -fno-exceptions-safe) so HTTP handlers, MQTT ingestion, checkup persistence and host tests share
// one contract.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string_view>

#include "config_store.hpp"          // config_crc32_update / config_crc32_final
#include "reference_temperature.hpp" // reference_topic_valid / reference_json_path_valid

namespace daik {

enum class PowerMeterUnit : uint8_t {
    Watts     = 0,
    Kilowatts = 1,
};

enum class PowerMeterScope : uint8_t {
    WholeUnit      = 0,
    CompressorOnly = 1,
};

inline constexpr size_t   POWER_METER_NAME_MAX          = 48;
inline constexpr uint32_t POWER_METER_MAX_AGE_MIN_S     = 10;
inline constexpr uint32_t POWER_METER_MAX_AGE_DEFAULT_S = 60;
inline constexpr uint32_t POWER_METER_MAX_AGE_MAX_S     = 300;
inline constexpr double   POWER_METER_MAX_W             = 50000.0;

inline constexpr uint32_t TARIFF_PRICE_MAX_TENTH_MILL = 999999; // 99.9999 currency/kWh
inline constexpr uint8_t  GAS_EFFICIENCY_MIN_PCT      = 50;
inline constexpr uint8_t  GAS_EFFICIENCY_DEFAULT_PCT  = 88;
inline constexpr uint8_t  GAS_EFFICIENCY_MAX_PCT      = 98;

inline constexpr PowerMeterUnit power_meter_unit_from_int(int v) noexcept {
    return v == static_cast<int>(PowerMeterUnit::Kilowatts) ? PowerMeterUnit::Kilowatts
                                                            : PowerMeterUnit::Watts;
}

inline constexpr uint8_t power_meter_unit_to_int(PowerMeterUnit u) noexcept {
    return static_cast<uint8_t>(u);
}

inline constexpr const char* power_meter_unit_name(PowerMeterUnit u) noexcept {
    return u == PowerMeterUnit::Kilowatts ? "kW" : "W";
}

inline bool parse_power_meter_unit(std::string_view sv, PowerMeterUnit& out) noexcept {
    if (sv == "W") {
        out = PowerMeterUnit::Watts;
        return true;
    }
    if (sv == "kW") {
        out = PowerMeterUnit::Kilowatts;
        return true;
    }
    return false;
}

inline constexpr PowerMeterScope power_meter_scope_from_int(int v) noexcept {
    return v == static_cast<int>(PowerMeterScope::CompressorOnly) ? PowerMeterScope::CompressorOnly
                                                                  : PowerMeterScope::WholeUnit;
}

inline constexpr uint8_t power_meter_scope_to_int(PowerMeterScope s) noexcept {
    return static_cast<uint8_t>(s);
}

inline constexpr const char* power_meter_scope_name(PowerMeterScope s) noexcept {
    return s == PowerMeterScope::CompressorOnly ? "compressor_only" : "whole_unit";
}

inline bool parse_power_meter_scope(std::string_view sv, PowerMeterScope& out) noexcept {
    if (sv == "whole_unit") {
        out = PowerMeterScope::WholeUnit;
        return true;
    }
    if (sv == "compressor_only") {
        out = PowerMeterScope::CompressorOnly;
        return true;
    }
    return false;
}

// Empty `topic` explicitly disables the external meter. `power_path` and `time_path` are optional
// (empty `power_path` accepts a plain numeric payload on `topic`); when non-empty, each path is
// validated with reference_json_path_valid(). A timestamp path requires a JSON power path because a
// document carrying a timestamp key is structured JSON.
inline bool power_meter_config_valid(std::string_view name, std::string_view topic,
                                     std::string_view power_path, std::string_view time_path,
                                     uint32_t max_age_s, const char** why = nullptr) {
    auto fail = [&](const char* text) {
        if (why) *why = text;
        return false;
    };
    if (name.size() > POWER_METER_NAME_MAX) return fail("Power meter name is too long");
    if (!reference_topic_valid(topic, why)) return false;
    if (topic.empty()) return true;
    if (!power_path.empty() && !reference_json_path_valid(power_path, why)) return false;
    if (!time_path.empty()) {
        if (power_path.empty()) return fail("Timestamp path requires a JSON power path");
        if (!reference_json_path_valid(time_path, why)) return false;
    }
    if (max_age_s < POWER_METER_MAX_AGE_MIN_S || max_age_s > POWER_METER_MAX_AGE_MAX_S)
        return fail("Maximum age must be between 10 and 300 seconds");
    return true;
}

// Convert a raw power reading to non-negative Watts. Rejects non-finite values, negative readings
// (which indicate PV backfeed or a whole-house grid CT rather than a unidirectional heat-pump
// sub-meter), and implausible spikes above POWER_METER_MAX_W.
inline bool power_meter_watts_from_raw(double raw, PowerMeterUnit unit, double& out_w) noexcept {
    if (!std::isfinite(raw) || raw < 0.0) return false;
    const double w = (unit == PowerMeterUnit::Kilowatts) ? raw * 1000.0 : raw;
    if (!std::isfinite(w) || w < 0.0 || w > POWER_METER_MAX_W) return false;
    out_w = w;
    return true;
}

inline bool tariff_currency_valid(std::string_view code, const char** why = nullptr) noexcept {
    auto fail = [&](const char* text) {
        if (why) *why = text;
        return false;
    };
    if (code.size() != 3) return fail("Currency must be a 3-letter ISO code");
    for (const unsigned char c : code) {
        if (c < 'A' || c > 'Z') return fail("Currency must be 3 uppercase ASCII letters");
    }
    return true;
}

// Tariffs are either both cleared to 0 (unconfigured) or both configured (> 0). Reject half-set
// tariffs so the comparison cannot silently evaluate against a 0.0000/kWh baseline.
inline bool gas_comparison_config_valid(uint32_t elec_price_tenth_mill,
                                        uint32_t gas_price_tenth_mill, uint8_t gas_efficiency_pct,
                                        std::string_view currency,
                                        const char**     why = nullptr) noexcept {
    auto fail = [&](const char* text) {
        if (why) *why = text;
        return false;
    };
    if (elec_price_tenth_mill > TARIFF_PRICE_MAX_TENTH_MILL ||
        gas_price_tenth_mill > TARIFF_PRICE_MAX_TENTH_MILL)
        return fail("Tariff price out of range");
    if ((elec_price_tenth_mill == 0) != (gas_price_tenth_mill == 0))
        return fail("Both electricity and gas tariffs must be configured, or both 0");
    if (gas_efficiency_pct < GAS_EFFICIENCY_MIN_PCT || gas_efficiency_pct > GAS_EFFICIENCY_MAX_PCT)
        return fail("Gas boiler efficiency must be between 50% and 98%");
    return tariff_currency_valid(currency, why);
}

namespace detail {
inline uint32_t pel_fp_u32(uint32_t crc, uint32_t v) noexcept {
    const uint8_t b[4] = {static_cast<uint8_t>(v), static_cast<uint8_t>(v >> 8),
                          static_cast<uint8_t>(v >> 16), static_cast<uint8_t>(v >> 24)};
    return config_crc32_update(crc, b, sizeof(b));
}
} // namespace detail

// Freshness helper matching reference_room_freshness(): when `source_time_mapped` is true
// (timestamp_path non-empty), retained payloads without a timestamp fail closed instead of
// trusting MQTT arrival time; when false, live (non-retained) deliveries age from arrival.
inline ReferenceFreshness power_meter_freshness(bool source_time_mapped, bool has_value,
                                                bool retained, bool has_source_time,
                                                int64_t source_unix_s, uint64_t received_ms,
                                                int64_t now_unix_s, uint64_t now_ms,
                                                uint32_t max_age_s) noexcept {
    return reference_room_freshness(source_time_mapped, has_value, retained, has_source_time,
                                    source_unix_s, received_ms, now_unix_s, now_ms, max_age_s);
}

// Independent electrical meter provenance fingerprint (null-delimited strings + scalar settings).
// Uses a domain tag distinct from checkup_x10a_pel_source_fingerprint() and guarantees non-zero.
inline uint32_t power_meter_source_fingerprint(const char* broker, const char* topic,
                                               const char* power_path, const char* time_path,
                                               uint32_t max_age_s, uint8_t unit, uint8_t scope,
                                               uint32_t generation) noexcept {
    static constexpr uint8_t kDomain[] = {'m', 'q', 't', 't', '-', 'p', 'e', 'l', '-', 'v', '1', 0};
    uint32_t                 crc = config_crc32_update(CONFIG_CRC32_INIT, kDomain, sizeof(kDomain));
    const uint8_t            nul = 0;
    for (const char* field : {broker, topic, power_path, time_path}) {
        size_t n = 0;
        if (field) {
            while (field[n]) ++n;
        }
        if (n) crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(field), n);
        crc = config_crc32_update(crc, &nul, 1);
    }
    crc                  = detail::pel_fp_u32(crc, max_age_s);
    crc                  = detail::pel_fp_u32(crc, unit);
    crc                  = detail::pel_fp_u32(crc, scope);
    crc                  = detail::pel_fp_u32(crc, generation);
    const uint32_t final = config_crc32_final(crc);
    return final ? final : 1u;
}

} // namespace daik
