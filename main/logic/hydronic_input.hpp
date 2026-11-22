#pragma once
#include "checkup_persist.hpp"
#include "hydronic_observation.hpp"
#include "instrument.hpp"
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace daik::logic {

enum class HydronicInput : uint8_t {
    Leaving,
    Return,
    Flow,
    Command,
    Pump,
    Rps,
    Mode,
    Valve,
    Defrost,
    Buh1,
    Buh2,
    Restart,
    Startup,
    OilReturn,
    Equalizing,
    Count
};
constexpr size_t            HYDRONIC_INPUTS        = static_cast<size_t>(HydronicInput::Count);
inline constexpr Instrument HYDRONIC_INSTRUMENTS[] = {
    Instrument::LeavingWaterPreBuh, Instrument::ReturnWater, Instrument::Flow,
    Instrument::PumpCommand,        Instrument::PumpRunning, Instrument::CompressorRps,
    Instrument::IuOperationMode,    Instrument::DhwValve,    Instrument::Defrost,
    Instrument::BuhStep1,           Instrument::BuhStep2};
static_assert(sizeof(HYDRONIC_INSTRUMENTS) / sizeof(HYDRONIC_INSTRUMENTS[0]) == 11,
              "first 11 HydronicInput values must align with HYDRONIC_INSTRUMENTS");
struct HydronicInputPlan {
    CheckupLocator  rows[HYDRONIC_INPUTS]   = {};
    InstrumentState states[HYDRONIC_INPUTS] = {};
    uint32_t        schema_fp               = 0;
};

// The four established refrigerant-service phase coordinates are not registry instruments yet.
// Apply the registry's uniqueness, publishability and overlapping-bit rule, never a label search.
inline InstrumentResolution hydronic_phase_resolve(const ProfileView& v, uint16_t conv) {
    int  match    = -1;
    bool withheld = false;
    for (size_t i = 0; i < v.count(); ++i) {
        const auto row = adjudicated(v, i);
        if (row.reg != 0x10 || row.offset != 1 || row.conv != conv) continue;
        if (!row_publishable(v[i])) {
            withheld = true;
            continue;
        }
        if (match >= 0) return {InstrumentState::Ambiguous, -1};
        match = static_cast<int>(i);
    }
    if (match < 0) return {withheld ? InstrumentState::Withheld : InstrumentState::Absent, -1};
    const auto mine = adjudicated(v, static_cast<size_t>(match));
    for (size_t i = 0; i < v.count(); ++i)
        if (static_cast<int>(i) != match && row_publishable(v[i]) &&
            instrument_rows_overlap(mine, adjudicated(v, i)))
            return {InstrumentState::Ambiguous, -1};
    return {InstrumentState::Supported, match};
}
inline void fill_hydronic_input_plan(HydronicInputPlan& p, const char* profile_id,
                                     const ProfileView& v) {
    static constexpr HydronicInputPlan empty{};
    p = empty;
    if (!profile_id || !*profile_id || !v.profile_id ||
        std::strcmp(profile_id, v.profile_id) != 0 || std::strcmp(profile_id, "auto") == 0 ||
        (v.base_count && !v.base) || (v.extra_count && !v.extra) || (v.extra2_count && !v.extra2))
        return;
    constexpr uint16_t phase_converters[] = {306, 305, 303, 302};
    uint32_t           crc                = checkup_fp_u32(CONFIG_CRC32_INIT, 1);
    for (size_t k = 0; k < HYDRONIC_INPUTS; ++k) {
        const auto r = k < 11 ? instrument_resolve(v, HYDRONIC_INSTRUMENTS[k])
                              : hydronic_phase_resolve(v, phase_converters[k - 11]);
        p.states[k]  = r.state;
        crc          = checkup_fp_u32(crc, static_cast<uint32_t>(r.state));
        if (r.state != InstrumentState::Supported) continue;
        const auto row = adjudicated(v, static_cast<size_t>(r.row));
        p.rows[k]      = {row.reg, row.offset, row.conv};
        crc            = checkup_fp_u32(crc, checkup_schema_row_key(row));
        crc            = checkup_fp_u32(crc, checkup_schema_row_fingerprint(v, row));
    }
    p.schema_fp = config_crc32_final(crc);
    if (!p.schema_fp) p.schema_fp = 1;
}
inline HydronicInputPlan hydronic_input_plan(const char* profile_id, const ProfileView& v) {
    HydronicInputPlan p;
    fill_hydronic_input_plan(p, profile_id, v);
    return p;
}
inline bool hydronic_input_supported(const HydronicInputPlan& p, HydronicInput input) {
    const size_t k = static_cast<size_t>(input);
    return k < HYDRONIC_INPUTS && p.schema_fp && p.states[k] == InstrumentState::Supported;
}
template <class Row>
inline const Row* hydronic_input_row(const HydronicInputPlan& p, HydronicInput input,
                                     const Row* rows, size_t count) {
    if (!rows || !hydronic_input_supported(p, input)) return nullptr;
    const auto& key   = p.rows[static_cast<size_t>(input)];
    const Row*  found = nullptr;
    for (size_t i = 0; i < count; ++i) {
        const auto& r = rows[i];
        if (!checkup_row_matches(key, r.reg, r.off, r.conv)) continue;
        if (found || r.held || r.held_unknown) return nullptr;
        found = &r;
    }
    return found;
}
template <class Row>
inline HydronicSample hydronic_collect(const HydronicInputPlan& p, const Row* rows, size_t count,
                                       bool rps_known, bool rps_running) {
    HydronicSample s;
    s.supported = p.schema_fp != 0;
    for (size_t k = 0; k < 11; ++k)
        if (k != static_cast<size_t>(HydronicInput::Command) &&
            !hydronic_input_supported(p, static_cast<HydronicInput>(k)))
            s.supported = false;
    s.command_supported = hydronic_input_supported(p, HydronicInput::Command);
    const auto numeric  = [&](HydronicInput input, double& value) {
        const Row* r = hydronic_input_row(p, input, rows, count);
        if (!r || r->value.empty()) return false;
        const char* text = r->value.c_str();
        if (!((*text >= '0' && *text <= '9') || *text == '-' || *text == '+')) return false;
        char* end = nullptr;
        value     = std::strtod(text, &end);
        return end != text && end == text + r->value.size() && std::isfinite(value);
    };
    const auto bit = [&](HydronicInput input) {
        const Row* r = hydronic_input_row(p, input, rows, count);
        if (!r || r->value.size() != 1) return HydronicBit::Unknown;
        return r->value[0] == '1'   ? HydronicBit::On
               : r->value[0] == '0' ? HydronicBit::Off
                                    : HydronicBit::Unknown;
    };
    s.leaving_known = numeric(HydronicInput::Leaving, s.leaving_c);
    s.return_known  = numeric(HydronicInput::Return, s.return_c);
    s.flow_known    = numeric(HydronicInput::Flow, s.flow_l_min);
    // Reuse the poll task's compressor witness, as the core checkup and stop-context consumer
    // do. The current exact RPS row must independently agree; neither answer repairs the other.
    s.rps_known = rps_known && numeric(HydronicInput::Rps, s.rps) && s.rps >= 0 && s.rps <= 65535 &&
                  (s.rps > 0) == rps_running; // conv-152 encoding bound
    s.command_known = numeric(HydronicInput::Command, s.command_signal);
    s.pump          = bit(HydronicInput::Pump);
    s.valve_dhw     = bit(HydronicInput::Valve);
    s.defrost       = bit(HydronicInput::Defrost);
    s.buh1          = bit(HydronicInput::Buh1);
    s.buh2          = bit(HydronicInput::Buh2);
    const Row* mode = hydronic_input_row(p, HydronicInput::Mode, rows, count);
    if (mode) {
        const auto equal = [&](const char* text) {
            return mode->value.size() == std::strlen(text) &&
                   std::memcmp(mode->value.c_str(), text, mode->value.size()) == 0;
        };
        if (equal("Heating"))
            s.mode = HydronicMode::Heating;
        else if (equal("Cooling"))
            s.mode = HydronicMode::Cooling;
        else if (equal("Stop") || equal("DHW") || equal("Heating + DHW") || equal("Cooling + DHW"))
            s.mode = HydronicMode::Other;
    }
    for (unsigned k = 0; k < 4; ++k) {
        const auto input = static_cast<HydronicInput>(11 + k);
        if (hydronic_input_supported(p, input)) s.phase_supported |= static_cast<uint8_t>(1u << k);
        if (p.states[11 + k] == InstrumentState::Ambiguous) s.phase_ambiguous = true;
        s.phase[k] = bit(input);
    }
    return s;
}

} // namespace daik::logic
