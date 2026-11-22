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
__attribute__((noinline)) inline void hydronic_json_unsigned(JsonOut& out, uint64_t value,
                                                             bool known = true) {
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
__attribute__((noinline)) inline void hydronic_json_decimal(JsonOut& out, int64_t sum_milli,
                                                            uint64_t count, bool known) {
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
__attribute__((noinline)) inline void hydronic_json_seconds(JsonOut& out, uint64_t micros,
                                                            bool known) {
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
struct HydronicJsonWriter {
    JsonOutput& out;
    bool        flat;
    bool        first = true;

    [[gnu::noinline]] void key(const char* name, const char* metric = nullptr,
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
    }
    [[gnu::noinline]] void flag(const char* name, bool value, bool present = true) {
        key(name);
        out += !present ? "null" : flat ? (value ? "1" : "0") : (value ? "true" : "false");
    }
    [[gnu::noinline]] void u64(const char* name, uint64_t value, bool known = true) {
        key(name);
        hydronic_json_unsigned(out, value, known);
    }
    [[gnu::noinline]] void sec(const char* name, uint64_t micros, bool known) {
        key(name);
        hydronic_json_seconds(out, micros, known);
    }
    [[gnu::noinline]] void ts(const char* name, int64_t unix_us, bool present) {
        key(name);
        hydronic_json_unsigned(out, unix_us >= 0 ? static_cast<uint64_t>(unix_us) / 1000000 : 0,
                               present && unix_us >= 0);
    }
    [[gnu::noinline]] void range(const char* nested_name, const char* metric, const char* unit,
                                 const logic::HydronicRange& values, uint64_t count, bool known) {
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
    }
};

template <typename Report>
__attribute__((noinline)) inline void append_hydronic_json_impl(JsonOutput&   out,
                                                                const Report& report, bool flat) {
    const auto&        observation = report.observation;
    const auto&        totals      = observation.totals;
    const bool         confirmed   = observation.confirmed;
    const bool         known = confirmed && observation.dated && totals.first_evidence_unix_us >= 0;
    HydronicJsonWriter w{out, flat};

    if (!flat) out += "{";
    w.flag("confirmed", confirmed);
    w.flag("current", report.current);
    w.flag("dated", observation.dated);
    w.flag("coverage_partial", observation.partial);
    w.flag("restore_pending", observation.restore_pending);
    w.flag("persistence_pending", observation.persistence_pending);
    w.u64("dropped", observation.dropped, confirmed);
    w.u64("observed_hours", observation.observed_hours, confirmed);
    static constexpr struct {
        const char* name;
        uint64_t    value;
    } kConstants[4] = {
        {"method", logic::HYDRONIC_METHOD},
        {"window_s", logic::OBSERVATION_DAY_US / 1000000},
        {"settling_s", logic::HYDRONIC_SETTLE_US / 1000000},
        {"max_gap_s", logic::HYDRONIC_MAX_GAP_US / 1000000},
    };
    for (const auto& c : kConstants) w.u64(c.name, c.value);
    w.u64("reason_code", static_cast<uint8_t>(report.reason));
    if (!flat) {
        w.key("reason");
        out += "\"";
        out += hydronic_reason_id(report.reason);
        out += "\"";
        w.key("scope");
        out += "\"unit_water_heat_exchanger\"";
        w.key("weighting");
        out += "\"sample\"";
    }
    const bool settling_known = report.current &&
                                report.reason == logic::HydronicReason::Settling &&
                                report.settling_remaining_s > 0 &&
                                report.settling_remaining_s <= logic::HYDRONIC_SETTLE_US / 1000000;
    w.u64("settling_remaining_s", report.settling_remaining_s, settling_known);
    w.u64("source_generation", report.source_generation,
          confirmed && report.source_generation != 0);
    w.u64("schema_fp", report.schema_fp, confirmed && report.schema_fp != 0);
    w.u64("current_limitations_mask", report.limitations, report.current);
    w.u64("population_limitations_mask", totals.limitations, known);
    w.flag("population_saturated", totals.saturated, known);
    w.sec("observed_s", totals.observed_us, known);
    w.sec("candidate_s", totals.candidate_us, known);
    w.sec("qualified_s", totals.qualified_us, known);
    w.u64("samples", totals.samples, known);
    w.u64("command_samples", totals.command_samples, known);
    w.ts("first_evidence_unix_s", totals.first_evidence_unix_us, known);
    w.ts("last_evidence_unix_s", totals.last_evidence_unix_us, known);
    w.ts("first_accepted_unix_s", totals.first_accepted_unix_us, known && totals.samples > 0);
    w.ts("last_accepted_unix_s", totals.last_accepted_unix_us, known && totals.samples > 0);
    w.range("spread_k", "spread", "k", totals.spread, totals.samples, known);
    w.range("flow_l_min", "flow", "l_min", totals.flow, totals.samples, known);
    w.range("pump_command_pct", "pump_command", "pct", totals.command, totals.command_samples,
            known);
    w.key("target_delta_k");
    out += "null";
    w.flag("target_supported", false);
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
