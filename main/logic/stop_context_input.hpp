#pragma once

#include "checkup_persist.hpp"
#include "instrument.hpp"
#include "stop_context.hpp"

namespace daik::logic {

enum class StopContextInput : uint8_t { Rps, Lwt, Target, Request, Defrost, Route, Mode, Count };
constexpr size_t            STOP_CONTEXT_INPUTS = static_cast<size_t>(StopContextInput::Count);
inline constexpr Instrument STOP_CONTEXT_INSTRUMENTS[] = {
    Instrument::CompressorRps,   Instrument::LeavingWaterPreBuh,
    Instrument::LwSetpointMain,  Instrument::IndoorThermostat,
    Instrument::Defrost,         Instrument::DhwValve,
    Instrument::IuOperationMode,
};

// A separate consumer schema: new optional rows never invalidate the core completed-run journal.
// Resolution happens on source confirmation, not by allocating a second per-sweep row snapshot.
struct StopContextInputPlan {
    CheckupLocator rows[STOP_CONTEXT_INPUTS] = {};
    uint32_t       schema_fp                 = 0;
    uint8_t        supported                 = 0;
};

inline StopContextInputPlan stop_context_input_plan(const char*        profile_id,
                                                    const ProfileView& view) {
    StopContextInputPlan p;
    if (!profile_id || !*profile_id || !view.profile_id ||
        std::strcmp(profile_id, view.profile_id) != 0 || std::strcmp(profile_id, "auto") == 0 ||
        (view.base_count && !view.base) || (view.extra_count && !view.extra) ||
        (view.extra2_count && !view.extra2))
        return p;
    uint32_t crc = checkup_fp_u32(CONFIG_CRC32_INIT, 1); // stop-input method version
    for (size_t k = 0; k < STOP_CONTEXT_INPUTS; ++k) {
        const auto r = instrument_resolve(view, STOP_CONTEXT_INSTRUMENTS[k]);
        crc          = checkup_fp_u32(crc, static_cast<uint32_t>(r.state));
        if (r.state != InstrumentState::Supported) continue;
        const ValueDef row = adjudicated(view, static_cast<size_t>(r.row));
        p.rows[k]          = {row.reg, row.offset, row.conv};
        p.supported |= static_cast<uint8_t>(1u << k);
        crc = checkup_fp_u32(crc, checkup_schema_row_key(row));
        crc = checkup_fp_u32(crc, checkup_schema_row_fingerprint(view, row));
    }
    p.schema_fp = config_crc32_final(crc);
    if (!p.schema_fp) p.schema_fp = 1;
    return p;
}

inline bool stop_context_input_supported(const StopContextInputPlan& p, StopContextInput input) {
    return (p.supported & (1u << static_cast<unsigned>(input))) != 0;
}

inline uint8_t stop_context_capabilities(const StopContextInputPlan& p) {
    const auto has = [&](StopContextInput i) { return stop_context_input_supported(p, i); };
    if (!has(StopContextInput::Rps) || !has(StopContextInput::Route) ||
        !has(StopContextInput::Mode))
        return 0; // the named recent-heating denominator itself cannot be established
    uint8_t mask = stop_context_mask(StopContextCategory::DhwTransition) |
                   stop_context_mask(StopContextCategory::RouteModeTransition);
    if (has(StopContextInput::Lwt) && has(StopContextInput::Target)) mask |= 1u;
    if (has(StopContextInput::Request))
        mask |= stop_context_mask(StopContextCategory::RequestWithdrawal);
    if (has(StopContextInput::Defrost)) mask |= stop_context_mask(StopContextCategory::Defrost);
    return mask;
}

// Only one current-sweep row may satisfy a resolved input. Held, unknown-held, missing and
// duplicate rows are unavailable; a successful sibling page never makes any of them readable.
template <class Row>
inline const Row* stop_context_input_row(const StopContextInputPlan& p, StopContextInput input,
                                         const Row* rows, size_t count) {
    if (!rows || !stop_context_input_supported(p, input)) return nullptr;
    const auto& key   = p.rows[static_cast<size_t>(input)];
    const Row*  found = nullptr;
    for (size_t i = 0; i < count; ++i) {
        const Row& r = rows[i];
        if (!checkup_row_matches(key, r.reg, r.off, r.conv)) continue;
        if (found || r.held || r.held_unknown) return nullptr;
        found = &r;
    }
    return found;
}

template <class Row>
inline StopContextSample stop_context_collect(const StopContextInputPlan& p, const Row* rows,
                                              size_t count, bool rps_known, bool rps_running) {
    StopContextSample s;
    const auto        numeric = [&](StopContextInput i, int& out) {
        const Row* row = stop_context_input_row(p, i, rows, count);
        return row && history_parse_tenths(row->value.c_str(), out);
    };
    const auto bit = [&](StopContextInput i) {
        int n = 0;
        if (!numeric(i, n) || (n != 0 && n != 10)) return StopContextBit::Unknown;
        return n == 10 ? StopContextBit::On : StopContextBit::Off;
    };
    int n = 0;
    if (rps_known && numeric(StopContextInput::Rps, n) && n >= 0 && (n > 0) == rps_running) {
        s.rps_known = s.rps_value_known = true;
        s.rps_running                   = rps_running;
        s.rps_tenths                    = static_cast<uint16_t>(n);
    }
    // The shared parse already bounds tenths to the non-sentinel int16 domain.
    if (numeric(StopContextInput::Lwt, n)) {
        s.lwt_known  = true;
        s.lwt_tenths = static_cast<int16_t>(n);
    }
    if (numeric(StopContextInput::Target, n)) {
        s.target_known  = true;
        s.target_tenths = static_cast<int16_t>(n);
    }
    s.request        = bit(StopContextInput::Request);
    s.defrost        = bit(StopContextInput::Defrost);
    const auto route = bit(StopContextInput::Route);
    if (route != StopContextBit::Unknown)
        s.route = route == StopContextBit::On ? StopContextRoute::Dhw : StopContextRoute::Space;
    const Row* mode = stop_context_input_row(p, StopContextInput::Mode, rows, count);
    if (mode) {
        const char* text      = mode->value.c_str();
        const auto  operating = checkup_operating_mode(text);
        if (operating == CheckupOperatingMode::Heating)
            s.mode = StopContextMode::Heating;
        else if (operating == CheckupOperatingMode::Cooling)
            s.mode = StopContextMode::Cooling;
        else if (std::strcmp(text, "DHW") == 0)
            s.mode = StopContextMode::Dhw;
        else if (operating == CheckupOperatingMode::Other)
            s.mode = StopContextMode::Other;
    }
    return s;
}

} // namespace daik::logic
