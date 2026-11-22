#pragma once
// Descriptive water-side heat-exchanger observations shared by streamed HTTP and flat MQTT.
// Borrow the compact report; never construct the full Checkup report or an owning JSON string.
#include "logic/hydronic_hourly.hpp"
#include "logic/json_output.hpp"
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace daik {

// Flat MQTT suffix: 39 comma-prefixed keys and punctuation, plus the largest encoded values.
// A duration uses up to 21 bytes, a count 20, a timestamp 13, and each range is bounded.
inline constexpr size_t HYDRONIC_FLAT_JSON_MAX_BYTES = 1067 + 505;

inline const char* hydronic_reason_id(logic::HydronicReason reason) {
    using logic::HydronicReason;
    switch (reason) {
    case HydronicReason::None:
        return "none";
    case HydronicReason::Unsupported:
        return "unsupported";
    case HydronicReason::NoConsent:
        return "no_consent";
    case HydronicReason::NoSource:
        return "no_source";
    case HydronicReason::MissingWitness:
        return "missing_witness";
    case HydronicReason::InvalidReading:
        return "invalid_reading";
    case HydronicReason::PumpOff:
        return "pump_off";
    case HydronicReason::CompressorOff:
        return "compressor_off";
    case HydronicReason::NotHeating:
        return "not_heating";
    case HydronicReason::Dhw:
        return "dhw";
    case HydronicReason::Defrost:
        return "defrost";
    case HydronicReason::Buh:
        return "buh";
    case HydronicReason::SpecialPhase:
        return "special_phase";
    case HydronicReason::Settling:
        return "settling";
    case HydronicReason::PollGap:
        return "poll_gap";
    case HydronicReason::Clock:
        return "clock";
    case HydronicReason::SourceChanged:
        return "source_changed";
    case HydronicReason::ConsentChanged:
        return "consent_changed";
    case HydronicReason::Overflow:
        return "overflow";
    case HydronicReason::Forgotten:
        return "forgotten";
    default:
        return "unknown";
    }
}

template <typename JsonOut>
inline void hydronic_json_unsigned(JsonOut& out, uint64_t value, bool known = true) {
    if (!known) {
        out += "null";
        return;
    }
    char   digits[20]; // all uint64 values, without a sign or terminator
    size_t pos = sizeof(digits);
    do {
        digits[--pos] = static_cast<char>('0' + value % 10);
        value /= 10;
    } while (value != 0);
    out += std::string_view(digits + pos, sizeof(digits) - pos);
}

template <typename JsonOut>
inline void hydronic_json_decimal(JsonOut& out, int64_t sum_milli, uint64_t count, bool known) {
    if (!known || !count) {
        out += "null";
        return;
    }
    const bool     negative  = sum_milli < 0;
    const uint64_t bits      = static_cast<uint64_t>(sum_milli);
    const uint64_t magnitude = negative ? uint64_t(0) - bits : bits;
    uint64_t       rounded   = magnitude / count;
    if (magnitude % count >= count / 2 + count % 2) ++rounded;
    if (negative && rounded) out += "-";
    hydronic_json_unsigned(out, rounded / 1000);
    const auto fraction = static_cast<unsigned>(rounded % 1000);
    if (!fraction) return;
    char   digits[4] = {'.', static_cast<char>('0' + fraction / 100),
                        static_cast<char>('0' + fraction / 10 % 10),
                        static_cast<char>('0' + fraction % 10)};
    size_t end       = sizeof(digits);
    while (digits[end - 1] == '0') --end;
    out += std::string_view(digits, end);
}

template <typename JsonOut>
inline void hydronic_json_seconds(JsonOut& out, uint64_t micros, bool known) {
    hydronic_json_unsigned(out, micros / 1000000, known);
    if (!known || micros % 1000000 == 0) return;
    uint32_t remainder = static_cast<uint32_t>(micros % 1000000);
    char     fraction[6];
    for (int i = 5; i >= 0; --i) {
        fraction[i] = static_cast<char>('0' + remainder % 10);
        remainder /= 10;
    }
    size_t end = sizeof(fraction);
    while (fraction[end - 1] == '0') --end;
    out += ".";
    out += std::string_view(fraction, end);
}

// HTTP owns one object. Flat MQTT appends comma-prefixed hydronic_* members to an existing
// object, as append_stop_context_json does. Both projections share every numeric/known gate.
namespace detail {
template <typename Report>
__attribute__((noinline)) inline void append_hydronic_json_impl(JsonOutput&   out,
                                                                const Report& report, bool flat) {
    const auto& observation = report.observation;
    const auto& totals      = observation.totals;
    const bool  confirmed   = observation.confirmed;
    const bool  known       = confirmed && observation.dated && totals.first_evidence_unix_us >= 0;
    bool        first       = true;
    const auto  key         = [&](const char* name, const char* metric = nullptr,
                         const char* unit = nullptr) {
        if (flat || !first) out += ",";
        first = false;
        out += "\"";
        if (flat) out += "hydronic_";
        if (metric) {
            out += metric;
            out += "_";
        }
        out += name;
        if (unit) {
            out += "_";
            out += unit;
        }
        out += "\":";
    };
    const auto flag = [&](bool value, bool present = true) {
        out += !present ? "null" : flat ? (value ? "1" : "0") : (value ? "true" : "false");
    };
    const auto timestamp = [&](int64_t unix_us, bool present) {
        hydronic_json_unsigned(out, unix_us >= 0 ? static_cast<uint64_t>(unix_us) / 1000000 : 0,
                               present && unix_us >= 0);
    };
    const auto range = [&](const char* nested_name, const char* metric, const char* unit,
                           const logic::HydronicRange& values, uint64_t count) {
        const bool present = known && count > 0;
        if (flat)
            key("min", metric, unit);
        else {
            key(nested_name);
            out += "{\"min\":";
        }
        hydronic_json_decimal(out, values.min_milli, 1, present);
        if (flat)
            key("mean", metric, unit);
        else
            out += ",\"mean\":";
        hydronic_json_decimal(out, values.sum_milli, count, present);
        if (flat)
            key("max", metric, unit);
        else
            out += ",\"max\":";
        hydronic_json_decimal(out, values.max_milli, 1, present);
        if (!flat) out += "}";
    };

    if (!flat) out += "{";
    key("confirmed");
    flag(confirmed);
    key("current");
    flag(report.current);
    key("dated");
    flag(observation.dated);
    key("coverage_partial");
    flag(observation.partial);
    key("restore_pending");
    flag(observation.restore_pending);
    key("persistence_pending");
    flag(observation.persistence_pending);
    key("dropped");
    hydronic_json_unsigned(out, observation.dropped, confirmed);
    key("observed_hours");
    hydronic_json_unsigned(out, observation.observed_hours, confirmed);
    key("method");
    hydronic_json_unsigned(out, logic::HYDRONIC_METHOD);
    key("window_s");
    hydronic_json_unsigned(out, logic::OBSERVATION_DAY_US / 1000000);
    key("settling_s");
    hydronic_json_unsigned(out, logic::HYDRONIC_SETTLE_US / 1000000);
    key("max_gap_s");
    hydronic_json_unsigned(out, logic::HYDRONIC_MAX_GAP_US / 1000000);
    key("reason_code");
    hydronic_json_unsigned(out, static_cast<uint8_t>(report.reason));
    if (!flat) {
        key("reason");
        out += "\"";
        out += hydronic_reason_id(report.reason);
        out += "\"";
        key("scope");
        out += "\"unit_water_heat_exchanger\"";
        key("weighting");
        out += "\"sample\"";
    }
    const bool settling_known = report.current &&
                                report.reason == logic::HydronicReason::Settling &&
                                report.settling_remaining_s > 0 &&
                                report.settling_remaining_s <= logic::HYDRONIC_SETTLE_US / 1000000;
    key("settling_remaining_s");
    hydronic_json_unsigned(out, report.settling_remaining_s, settling_known);
    key("source_generation");
    hydronic_json_unsigned(out, report.source_generation,
                           confirmed && report.source_generation != 0);
    key("schema_fp");
    hydronic_json_unsigned(out, report.schema_fp, confirmed && report.schema_fp != 0);
    key("current_limitations_mask");
    hydronic_json_unsigned(out, report.limitations, report.current);
    key("population_limitations_mask");
    hydronic_json_unsigned(out, totals.limitations, known);
    key("population_saturated");
    flag(totals.saturated, known);
    key("observed_s");
    hydronic_json_seconds(out, totals.observed_us, known);
    key("candidate_s");
    hydronic_json_seconds(out, totals.candidate_us, known);
    key("qualified_s");
    hydronic_json_seconds(out, totals.qualified_us, known);
    key("samples");
    hydronic_json_unsigned(out, totals.samples, known);
    key("command_samples");
    hydronic_json_unsigned(out, totals.command_samples, known);
    key("first_evidence_unix_s");
    timestamp(totals.first_evidence_unix_us, known);
    key("last_evidence_unix_s");
    timestamp(totals.last_evidence_unix_us, known);
    key("first_accepted_unix_s");
    timestamp(totals.first_accepted_unix_us, known && totals.samples > 0);
    key("last_accepted_unix_s");
    timestamp(totals.last_accepted_unix_us, known && totals.samples > 0);
    range("spread_k", "spread", "k", totals.spread, totals.samples);
    range("flow_l_min", "flow", "l_min", totals.flow, totals.samples);
    range("pump_command_pct", "pump_command", "pct", totals.command, totals.command_samples);
    key("target_delta_k");
    out += "null";
    key("target_supported");
    flag(false);
    if (!flat) out += "}";
}

} // namespace detail

template <typename JsonOut, typename Report>
__attribute__((noinline)) inline void append_hydronic_json(JsonOut& out, const Report& report,
                                                           bool flat = false) {
    auto sink = detail::json_output(out);
    detail::append_hydronic_json_impl(sink, report, flat);
}

} // namespace daik
