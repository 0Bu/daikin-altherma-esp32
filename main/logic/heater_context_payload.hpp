#pragma once

#include "heater_context.hpp"
#include "heater_context_cohort.hpp"
#include "json_integer.hpp"
#include "json_output.hpp"
#include <charconv>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace daik::logic {

inline constexpr const char* HEATER_CONTEXT_CATEGORY_IDS[] = {
    "emergency",    "error",        "defrost_recovery", "dhw_route",         "silent",
    "cold_outdoor", "mild_outdoor", "compressor_off",   "quiet_mild_heating"};
static_assert(sizeof(HEATER_CONTEXT_CATEGORY_IDS) / sizeof(*HEATER_CONTEXT_CATEGORY_IDS) ==
              heater_context::CATEGORIES);

struct HeaterContextHeaterFields {
    uint32_t readable_s = 0, on_s = 0, off_s = 0, transition_s = 0, unreadable_s = 0;
    uint32_t union_s = 0, overlap_s = 0, unknown_context_s = 0, unclassified_s = 0;
    uint32_t complete_context_s = 0;
    uint32_t positive_s[heater_context::CATEGORIES]{}, evaluable_on_s[heater_context::CATEGORIES]{};
    uint32_t positive_samples[heater_context::CATEGORIES]{};
    uint32_t samples = 0, readable_samples = 0, on_samples = 0;
    uint16_t evaluable_mask = 0;
    uint8_t  observed_hours = 0;
    bool     saturated = false, quiet_mild_notice = false;
    bool     has_observed = false, has_readable = false;
};
struct HeaterContextPayloadFields {
    HeaterContextHeaterFields heater[heater_context::HEATERS];
    uint32_t                  epoch        = 0;
    uint16_t                  capabilities = 0, flags = 0, dropped = 0;
    uint8_t                   supported_heaters = 0;
    bool                      confirmed = false, dated = false, partial = true;
    bool                      restore_pending = true, persistence_pending = false;
};
static_assert(sizeof(HeaterContextPayloadFields) <= 368,
              "bounded atomic two-heater output snapshot");

// Meta is an owner snapshot with the named scalar fields below. This keeps the pure projection
// independent of FreeRTOS/the Store. The owner supplies both totals and metadata under ONE lock;
// formatting and all allocating appends happen only after releasing that lock.
template <class Meta>
inline void heater_context_payload_project(HeaterContextPayloadFields& out,
                                           const heater_context::Totals (&totals)[2],
                                           const Meta& meta) {
    static constexpr HeaterContextPayloadFields empty{};
    out                     = empty;
    out.epoch               = meta.epoch;
    out.capabilities        = meta.capabilities;
    out.flags               = meta.flags;
    out.dropped             = meta.dropped;
    out.supported_heaters   = meta.supported_heaters;
    out.confirmed           = meta.confirmed;
    out.dated               = meta.dated;
    out.partial             = meta.partial;
    out.restore_pending     = meta.restore_pending;
    out.persistence_pending = meta.persistence_pending;
    for (size_t h = 0; h < heater_context::HEATERS; ++h) {
        const auto& from = totals[h];
        auto&       to   = out.heater[h];
        to.saturated     = from.saturated;
        to.has_observed  = from.samples || from.readable_us || from.unreadable_us;
        to.has_readable  = from.readable_samples || from.readable_us;
        // Keep one saturating conversion body for the repeated scalar and category fields.
        const auto seconds = [&to](uint64_t us) __attribute__((noinline)) {
            const uint64_t value = us / 1000000;
            if (value > UINT32_MAX) {
                to.saturated = true;
                return UINT32_MAX;
            }
            return uint32_t(value);
        };
#define HC_SECONDS(field) to.field##_s = seconds(from.field##_us)
        HC_SECONDS(readable);
        HC_SECONDS(on);
        HC_SECONDS(off);
        HC_SECONDS(transition);
        HC_SECONDS(unreadable);
        HC_SECONDS(union);
        HC_SECONDS(overlap);
        HC_SECONDS(unknown_context);
        HC_SECONDS(unclassified);
        HC_SECONDS(complete_context);
#undef HC_SECONDS
        to.samples          = from.samples;
        to.readable_samples = from.readable_samples;
        to.on_samples       = from.on_samples;
        to.observed_hours   = meta.observed_hours[h];
        for (size_t k = 0; k < heater_context::CATEGORIES; ++k) {
            to.positive_s[k]       = seconds(from.positive_us[k]);
            to.evaluable_on_s[k]   = seconds(from.evaluable_on_us[k]);
            to.positive_samples[k] = from.positive_samples[k];
            if (from.evaluable_on_samples[k] || from.evaluable_on_us[k])
                to.evaluable_mask |= uint16_t(1u << k);
        }
        to.quiet_mild_notice =
            from.positive_us[size_t(heater_context::Category::QuietMildHeating)] >=
            heater_context::NOTICE_US;
    }
}

namespace detail {

__attribute__((noinline)) inline void
append_heater_context_json_impl(daik::detail::JsonOutput& j, const HeaterContextPayloadFields& f,
                                bool flat = false, int selected_heater = 0) {
    bool first = true;
    auto key   = [&j, &first](const char* name, const char* category = nullptr) {
        if (!first) j += ",";
        first = false;
        j += "\"";
        if (category) {
            j += category;
            j += "_";
        }
        j += name;
        j += "\":";
    };
    // Wire scalars are uint32_t or narrower; microseconds are projected before formatting.
    static_assert(heater_context::MAX_GAP_US / 1000000 <= UINT32_MAX &&
                  heater_context::RECOVERY_US / 1000000 <= UINT32_MAX &&
                  heater_context::NOTICE_US / 1000000 <= UINT32_MAX &&
                  heater_context::MILD_TENTHS >= 0 && heater_context::MILD_TENTHS <= UINT32_MAX);
    auto number = [&j](uint32_t value, bool known = true) {
        if (!known) {
            j += "null";
            return;
        }
        char        digits[10];
        char* const end = digits + sizeof(digits);
        char*       at  = end;
        do {
            *--at = char('0' + value % 10);
            value /= 10;
        } while (value);
        j += std::string_view(at, size_t(end - at));
    };
    auto flag = [&j, flat](bool value, bool known = true) {
        j += !known ? "null" : flat ? (value ? "1" : "0") : (value ? "true" : "false");
    };
    j += "{";
    key("confirmed");
    flag(f.confirmed);
    key("epoch");
    number(f.epoch, f.confirmed);
    key("dated");
    flag(f.dated);
    key("coverage_partial");
    flag(f.partial);
    key("restore_pending");
    flag(f.restore_pending);
    key("persistence_pending");
    flag(f.persistence_pending);
    key("archive_incomplete");
    flag((f.flags & heater_cohort::Incomplete) != 0);
    key("clock_uncertain");
    flag((f.flags & heater_cohort::Clock) != 0);
    key("storage_loss");
    flag((f.flags & heater_cohort::Loss) != 0);
    key("capability_mask");
    number(f.capabilities, f.confirmed);
    key("flags");
    number(f.flags, f.confirmed);
    key("dropped");
    number(f.dropped, f.confirmed);
    key("max_gap_s");
    number(heater_context::MAX_GAP_US / 1000000);
    key("recovery_s");
    number(heater_context::RECOVERY_US / 1000000);
    key("notice_s");
    number(heater_context::NOTICE_US / 1000000);
    key("mild_boundary_tenths_c");
    number(heater_context::MILD_TENTHS);
    key("categories_overlap");
    flag(true);
    if (flat) {
        key("heater");
        number(selected_heater < 0 ? 0 : uint32_t(selected_heater),
               selected_heater >= 0 && selected_heater < int(heater_context::HEATERS));
    }
    for (size_t h = 0; h < heater_context::HEATERS; ++h) {
        if (flat && selected_heater != int(h)) continue;
        const char* id        = h ? "bsh" : "buh";
        const auto& c         = f.heater[h];
        const bool  supported = (f.supported_heaters & (1u << h)) != 0;
        const bool  observed  = f.confirmed && supported && c.has_observed;
        const bool  readable  = observed && c.has_readable;
        if (!flat) {
            j += ",\"";
            j += id;
            j += "\":{";
            first = true;
        }
        const auto field = [&](const char* name) { key(name); };
        field("supported");
        flag(supported, f.confirmed);
        field("readable_s");
        number(c.readable_s, observed);
        field("on_s");
        number(c.on_s, readable);
        field("off_s");
        number(c.off_s, readable);
        field("transition_s");
        number(c.transition_s, observed);
        field("unreadable_s");
        number(c.unreadable_s, observed);
        field("union_s");
        number(c.union_s, readable);
        field("overlap_s");
        number(c.overlap_s, readable);
        field("unknown_context_s");
        number(c.unknown_context_s, readable);
        field("unclassified_s");
        number(c.unclassified_s, readable);
        field("complete_context_s");
        number(c.complete_context_s, readable);
        field("samples");
        number(c.samples, f.confirmed && supported);
        field("readable_samples");
        number(c.readable_samples, observed);
        field("on_samples");
        number(c.on_samples, readable);
        field("observed_hours");
        number(c.observed_hours, f.confirmed && supported);
        field("saturated");
        flag(c.saturated, observed);
        const bool quiet_known =
            readable &&
            (f.capabilities & heater_context::mask(heater_context::Category::QuietMildHeating)) &&
            (c.evaluable_mask & heater_context::mask(heater_context::Category::QuietMildHeating));
        field("quiet_mild_notice");
        flag(c.quiet_mild_notice, quiet_known);
        if (!flat) j += ",\"categories\":{";
        for (size_t k = 0; k < heater_context::CATEGORIES; ++k) {
            const char* category = HEATER_CONTEXT_CATEGORY_IDS[k];
            const bool  capable  = (f.capabilities & (1u << k)) != 0;
            const bool  known    = readable && capable && (c.evaluable_mask & (1u << k));
            if (!flat) {
                if (k) j += ",";
                j += "\"";
                j += category;
                j += "\":{";
                first = true;
            }
            const auto category_field = [&](const char* name) {
                key(name, flat ? category : nullptr);
            };
            category_field("supported");
            flag(capable, f.confirmed && supported);
            category_field("positive_s");
            number(c.positive_s[k], known);
            category_field("evaluable_on_s");
            number(c.evaluable_on_s[k], known);
            category_field("positive_samples");
            number(c.positive_samples[k], known);
            if (!flat) j += "}";
        }
        if (!flat) j += "}}";
    }
    j += "}";
}

} // namespace detail

// Same field semantics for HTTP's bounded sink and numeric MQTT leaves. Each heater keeps its
// own flag-time population. Numeric mode emits ONE heater on its own small MQTT topic; it does
// not expand the technical heartbeat. Categories overlap and never identify causes or kWh.
template <class JsonOut>
__attribute__((noinline)) inline void
append_heater_context_json(JsonOut& j, const HeaterContextPayloadFields& f, bool flat = false,
                           int selected_heater = 0) {
    auto sink = daik::detail::json_output(j);
    detail::append_heater_context_json_impl(sink, f, flat, selected_heater);
}

} // namespace daik::logic
