#pragma once
// WHICH ROW IS PHYSICAL INSTRUMENT X ON THIS PROFILE — one owner for that question, so that a new
// diagnosis observation never resolves its inputs by itself (docs/ARCHITECTURE.md "Physical
// instruments").
//
// Several places still answer it their own way: the checkup locators, the trend table, the
// refrigerant-service coverage flags, the lwt/rwt label selectors and the browser's label patterns.
// The selectors pick the FIRST row that fits, which is table order, not a rule.
// test_instrument_registry() binds the C++ ones to this registry; the browser's patterns are not
// bound. Here an instrument resolves to exactly one of four states, and "more than one candidate"
// is a state of its own rather than a silent pick:
//
//   Supported  exactly one publishable row is identified as the instrument, and no other
//              publishable row decodes overlapping bits of the same page (a refrigerant pressure's
//              own conv-405 saturation twin excepted);
//   Absent     no row is identified as it. A row can still sit at the coordinate under an identity
//              the registry does not accept, such as a 0x62/15 bar row without its saturation twin;
//   Withheld   it is identified only in rows that may not be published (detect-only `no_publish`
//              placeholders or rows the availability ledger quarantines as Unproven);
//   Ambiguous  two publishable rows are identified as it, or another quantity decodes the same
//              bits. Neither row is trusted: at least one identity is unproven, and nothing here
//              can tell which.
//
// Resolution is STATIC, a fact about the resolved profile view. Whether a Supported row answered
// in the current poll cycle, is held over while the compressor rests, or comes from the source
// generation an accumulator is bound to are runtime facts with their own owners (hp_poll.cpp's
// per-cycle cache, ou_stale.hpp for held-over pages, outdoor_evidence.hpp for outdoor-air context);
// this header does not repeat them.
//
// The locators are exact page/offset/converter keys, as in checkup.hpp, because a byte such as
// 0x60/12 holds seven flags that only the converter separates. Where one coordinate means different
// instruments on different profiles, the locator also requires a label token: 0x20/2 is the
// outdoor coil on air-source units but a two-phase thermistor on the ground-source ones, 0x20/10 is
// the liquid pipe or the leaving brine, and 0x20/14 names its pressure side on some profiles only.
// test_instrument_registry() pins every label at every locator coordinate, accepted or rejected,
// with its profile count, so a generator change cannot move an identity silently.
#include <cstddef>
#include <cstdint>

#include "availability.hpp"
#include "conv_override.hpp"
#include "feature_gate.hpp"
#include "lwt_select.hpp"
#include "profile_view.hpp"
#include "value_def.hpp"

namespace daik::logic {

enum class Instrument : uint8_t {
    // Indoor unit, hydronic side. These pages stay live while the compressor rests.
    LeavingWaterPreBuh,
    LeavingWaterPostBuh,
    ReturnWater,
    DhwTank,
    RefrigerantLiquidIndoor,
    Flow,
    WaterPressure,
    PumpCommand, // inverted: 0 = maximum, 100 = stop
    PumpRunning,
    IndoorRefrigerantPressure,
    MixedWaterEkmik,
    // Outdoor unit. Pages 0x20/0x21 hold their last values while the compressor rests; page 0x30,
    // which carries the compressor speed, stays live.
    CompressorRps,
    ExpansionValve,
    DischargePipe,
    OutdoorAir,
    OutdoorHeatExchanger,
    SuctionPipe,
    RefrigerantLiquidOutdoor,
    HighPressure,
    LowPressure,
    InverterPrimaryCurrent,
    // Current clamps on the indoor page 0x63.
    CtL1,
    CtL2,
    CtL3,
    // Operating states.
    OperationMode,
    Defrost,
    LowNoise,
    SilentMode,
    IndoorThermostat,
    IuOperationMode,
    Bsh,
    BuhStep1,
    BuhStep2,
    DhwValve,
    SpaceHeatingOperation,
    Emergency,
    // Leaving-water targets. A target is never a measurement substitute.
    LwSetpointMain,
    LwSetpointAdd,
    // Protection and limit flags (page 0x10 supplement, def/overlay.hpp; 0x62/7 observability).
    DropInvCurrent,
    DropDischarge,
    DropLp,
    DropHp,
    DropOther,
    DropFin,
    RetryDischarge,
    RetryInvCurrent,
    RetryHp,
    RetryLp,
    RetryFin,
    PowerLimit1,
    PowerLimit2,
    PowerLimit3,
    PowerLimit4,
    Count
};

inline constexpr size_t INSTRUMENT_COUNT = static_cast<size_t>(Instrument::Count);

// How a locator identifies its instrument beyond the page/offset/converter key.
enum class InstrumentIdentity : uint8_t {
    Coordinate,          // the key alone names the instrument on every profile that carries it
    LabelToken,          // the key means different instruments across profiles; the label decides
    RefrigerantPressure, // convert.hpp's structural rule: bar, and on page 0x62 only with its
                         // conv-405 saturation twin (Water pressure is bar on the same page);
                         // with a token, the label must also name the pressure side
};

struct InstrumentLocator {
    Instrument         id;
    uint8_t            reg;
    uint8_t            off;
    uint16_t           conv;
    InstrumentIdentity identity;
    const char*        token;  // accepted case-insensitive label substring (required by LabelToken)
    const char*        token2; // optional second accepted substring
};

// An instrument may have one locator per coordinate it occupies across the catalog. All of an
// instrument's locators are searched; two matches on one profile are Ambiguous, never a preference.
inline constexpr InstrumentLocator INSTRUMENT_LOCATORS[] = {
    {Instrument::LeavingWaterPreBuh, 0x61, 2, 105, InstrumentIdentity::Coordinate, nullptr,
     nullptr},
    {Instrument::LeavingWaterPostBuh, 0x61, 4, 105, InstrumentIdentity::Coordinate, nullptr,
     nullptr},
    {Instrument::ReturnWater, 0x61, 8, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DhwTank, 0x61, 10, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RefrigerantLiquidIndoor, 0x61, 6, 105, InstrumentIdentity::Coordinate, nullptr,
     nullptr},
    {Instrument::Flow, 0x62, 9, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::WaterPressure, 0x62, 11, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::PumpCommand, 0x62, 12, 152, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::PumpRunning, 0x60, 12, 301, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::IndoorRefrigerantPressure, 0x62, 15, 105, InstrumentIdentity::RefrigerantPressure,
     nullptr, nullptr},
    // The bizone kit's mixed leaving water sits at 0x65/0 on some profiles and at 0x65/4 on others;
    // at 0x65/0 several profiles also decode a hydro-split outlet temperature from the same bytes.
    {Instrument::MixedWaterEkmik, 0x65, 0, 105, InstrumentIdentity::LabelToken, "ekmik", nullptr},
    {Instrument::MixedWaterEkmik, 0x65, 4, 105, InstrumentIdentity::LabelToken, "ekmik", nullptr},
    {Instrument::CompressorRps, 0x30, 0, 152, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::ExpansionValve, 0x30, 3, 151, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DischargePipe, 0x20, 4, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::OutdoorAir, 0x20, 0, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::OutdoorHeatExchanger, 0x20, 2, 105, InstrumentIdentity::LabelToken, "heat exch",
     "deicer"},
    {Instrument::SuctionPipe, 0x20, 6, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RefrigerantLiquidOutdoor, 0x20, 10, 105, InstrumentIdentity::LabelToken, "liquid",
     nullptr},
    {Instrument::HighPressure, 0x20, 12, 105, InstrumentIdentity::RefrigerantPressure, nullptr,
     nullptr},
    // Where 0x20/12 is no pressure, 0x20/14 is the profile's only outdoor transducer and its label
    // ("Pressure", "Pressure sensor") names no side. Nothing in the repository establishes which
    // side it measures, so only a row that says "low" is the low side.
    {Instrument::LowPressure, 0x20, 14, 105, InstrumentIdentity::RefrigerantPressure, "low",
     nullptr},
    {Instrument::InverterPrimaryCurrent, 0x21, 0, 105, InstrumentIdentity::Coordinate, nullptr,
     nullptr},
    {Instrument::CtL1, 0x63, 14, 161, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::CtL2, 0x63, 15, 161, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::CtL3, 0x63, 16, 161, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::OperationMode, 0x10, 0, 217, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::Defrost, 0x10, 1, 304, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::LowNoise, 0x10, 1, 300, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::SilentMode, 0x60, 2, 301, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::IndoorThermostat, 0x60, 2, 303, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::IuOperationMode, 0x60, 2, 315, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::Bsh, 0x60, 12, 305, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::BuhStep1, 0x60, 12, 304, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::BuhStep2, 0x60, 12, 303, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DhwValve, 0x60, 12, 306, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::SpaceHeatingOperation, 0x62, 2, 303, InstrumentIdentity::Coordinate, nullptr,
     nullptr},
    {Instrument::Emergency, 0x62, 2, 300, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::LwSetpointMain, 0x60, 9, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::LwSetpointAdd, 0x62, 3, 105, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DropInvCurrent, 0x10, 10, 303, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DropDischarge, 0x10, 10, 307, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DropLp, 0x10, 11, 303, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DropHp, 0x10, 11, 307, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DropOther, 0x10, 12, 303, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::DropFin, 0x10, 12, 307, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RetryDischarge, 0x10, 10, 310, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RetryInvCurrent, 0x10, 10, 311, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RetryHp, 0x10, 11, 310, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RetryLp, 0x10, 11, 311, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::RetryFin, 0x10, 12, 310, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::PowerLimit1, 0x62, 7, 300, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::PowerLimit2, 0x62, 7, 301, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::PowerLimit3, 0x62, 7, 302, InstrumentIdentity::Coordinate, nullptr, nullptr},
    {Instrument::PowerLimit4, 0x62, 7, 303, InstrumentIdentity::Coordinate, nullptr, nullptr},
};

// Stable identifiers for tests and documentation; never shown to users. In enum order, which the
// static_assert below enforces, so a slug lookup is an index.
struct InstrumentName {
    Instrument  id;
    const char* slug;
};

inline constexpr InstrumentName INSTRUMENT_NAMES[] = {
    {Instrument::LeavingWaterPreBuh, "leaving_water_pre_buh"},
    {Instrument::LeavingWaterPostBuh, "leaving_water_post_buh"},
    {Instrument::ReturnWater, "return_water"},
    {Instrument::DhwTank, "dhw_tank"},
    {Instrument::RefrigerantLiquidIndoor, "refrigerant_liquid_indoor"},
    {Instrument::Flow, "flow"},
    {Instrument::WaterPressure, "water_pressure"},
    {Instrument::PumpCommand, "pump_command"},
    {Instrument::PumpRunning, "pump_running"},
    {Instrument::IndoorRefrigerantPressure, "indoor_refrigerant_pressure"},
    {Instrument::MixedWaterEkmik, "mixed_water_ekmik"},
    {Instrument::CompressorRps, "compressor_rps"},
    {Instrument::ExpansionValve, "expansion_valve"},
    {Instrument::DischargePipe, "discharge_pipe"},
    {Instrument::OutdoorAir, "outdoor_air"},
    {Instrument::OutdoorHeatExchanger, "outdoor_heat_exchanger"},
    {Instrument::SuctionPipe, "suction_pipe"},
    {Instrument::RefrigerantLiquidOutdoor, "refrigerant_liquid_outdoor"},
    {Instrument::HighPressure, "high_pressure"},
    {Instrument::LowPressure, "low_pressure"},
    {Instrument::InverterPrimaryCurrent, "inverter_primary_current"},
    {Instrument::CtL1, "ct_l1"},
    {Instrument::CtL2, "ct_l2"},
    {Instrument::CtL3, "ct_l3"},
    {Instrument::OperationMode, "operation_mode"},
    {Instrument::Defrost, "defrost"},
    {Instrument::LowNoise, "low_noise"},
    {Instrument::SilentMode, "silent_mode"},
    {Instrument::IndoorThermostat, "indoor_thermostat"},
    {Instrument::IuOperationMode, "iu_operation_mode"},
    {Instrument::Bsh, "bsh"},
    {Instrument::BuhStep1, "buh_step1"},
    {Instrument::BuhStep2, "buh_step2"},
    {Instrument::DhwValve, "dhw_valve"},
    {Instrument::SpaceHeatingOperation, "space_heating_operation"},
    {Instrument::Emergency, "emergency"},
    {Instrument::LwSetpointMain, "lw_setpoint_main"},
    {Instrument::LwSetpointAdd, "lw_setpoint_add"},
    {Instrument::DropInvCurrent, "drop_inv_current"},
    {Instrument::DropDischarge, "drop_discharge"},
    {Instrument::DropLp, "drop_lp"},
    {Instrument::DropHp, "drop_hp"},
    {Instrument::DropOther, "drop_other"},
    {Instrument::DropFin, "drop_fin"},
    {Instrument::RetryDischarge, "retry_discharge"},
    {Instrument::RetryInvCurrent, "retry_inv_current"},
    {Instrument::RetryHp, "retry_hp"},
    {Instrument::RetryLp, "retry_lp"},
    {Instrument::RetryFin, "retry_fin"},
    {Instrument::PowerLimit1, "power_limit_1"},
    {Instrument::PowerLimit2, "power_limit_2"},
    {Instrument::PowerLimit3, "power_limit_3"},
    {Instrument::PowerLimit4, "power_limit_4"},
};

inline constexpr bool instrument_names_in_enum_order() {
    if (sizeof(INSTRUMENT_NAMES) / sizeof(INSTRUMENT_NAMES[0]) != INSTRUMENT_COUNT) return false;
    for (size_t k = 0; k < INSTRUMENT_COUNT; k++)
        if (static_cast<size_t>(INSTRUMENT_NAMES[k].id) != k) return false;
    return true;
}
static_assert(instrument_names_in_enum_order(), "one name per instrument, in enum order");

inline constexpr const char* instrument_slug(Instrument id) {
    const size_t k = static_cast<size_t>(id);
    return k < INSTRUMENT_COUNT ? INSTRUMENT_NAMES[k].slug : nullptr;
}

enum class InstrumentState : uint8_t { Absent, Withheld, Ambiguous, Supported };

struct InstrumentResolution {
    InstrumentState state = InstrumentState::Absent;
    int             row   = -1; // view index, set only when Supported
};

// ── Footprints: which bits of a page a decoded row reads (logic/convert.hpp semantics) ─────────
// A whole-byte answer for every converter not listed is the conservative direction: it can only
// report an overlap that is not there, which resolves to Ambiguous and fails the catalog test,
// never to a silent pick.
inline constexpr uint8_t instrument_bit_mask(uint16_t conv) {
    if (conv >= 300 && conv <= 307) return static_cast<uint8_t>(1u << (conv - 300));
    if (conv == 310) return 0x70;                // retry counter, bits 4-6
    if (conv == 311) return 0x07;                // retry counter / BUH capacity step, bits 0-2
    if (conv == 315 || conv == 316) return 0xF0; // indoor / hybrid mode, high nibble
    return 0xFF;
}

// Bytes a row decodes. The refrigerant-type identifiers read no payload byte, and conv 0 /
// 995-999 are layout markers without a value.
inline constexpr unsigned instrument_byte_count(const ValueDef& d) {
    if (d.conv == 0 || (d.conv >= 801 && d.conv <= 805) || (d.conv >= 995 && d.conv <= 999))
        return 0;
    return d.size;
}

inline constexpr bool instrument_rows_overlap(const ValueDef& a, const ValueDef& b) {
    const unsigned na = instrument_byte_count(a), nb = instrument_byte_count(b);
    if (a.reg != b.reg || na == 0 || nb == 0) return false;
    const unsigned a_end = a.offset + na, b_end = b.offset + nb;
    if (a.offset >= b_end || b.offset >= a_end) return false;
    // Only single-byte rows decode part of a byte; any wider row owns its bytes outright.
    if (na == 1 && nb == 1) return (instrument_bit_mask(a.conv) & instrument_bit_mask(b.conv)) != 0;
    return true;
}

// The conv-405 saturation temperature is derived from the same transducer as a refrigerant
// pressure row and is published beside it on purpose: the same instrument, not a competitor. The
// caller applies this only to a row identified as a refrigerant pressure.
inline constexpr bool instrument_saturation_twin(const ValueDef& pressure, const ValueDef& other) {
    return other.conv == 405 && other.reg == pressure.reg && other.offset == pressure.offset;
}

// Does view row `i` (adjudicated as `row`) carry the instrument this locator names?
inline bool instrument_locator_matches(const InstrumentLocator& l, const ProfileView& v, size_t i,
                                       const ValueDef& row) {
    if (row.reg != l.reg || row.offset != l.off || row.conv != l.conv) return false;
    const bool named = lwt_ci_contains(row.label, l.token) || lwt_ci_contains(row.label, l.token2);
    if (l.identity == InstrumentIdentity::LabelToken) return named;
    if (l.identity == InstrumentIdentity::RefrigerantPressure)
        return fg_is_refrigerant_pressure(v, i) && (!l.token || named);
    return true; // Coordinate
}

// Rows are judged as production decodes them: adjudicated (converter and label ledgers) and
// admitted only through row_publishable(), the predicate hp_poll and HA discovery share.
inline InstrumentResolution instrument_resolve(const ProfileView& v, Instrument id) {
    int  match    = -1;
    bool pressure = false;
    bool withheld = false;
    for (const auto& l : INSTRUMENT_LOCATORS) {
        if (l.id != id) continue;
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef row = adjudicated(v, i);
            if (!instrument_locator_matches(l, v, i, row)) continue;
            if (!row_publishable(v[i])) {
                withheld = true;
                continue;
            }
            if (match >= 0) return {InstrumentState::Ambiguous, -1};
            match    = static_cast<int>(i);
            pressure = l.identity == InstrumentIdentity::RefrigerantPressure;
        }
    }
    if (match < 0) return {withheld ? InstrumentState::Withheld : InstrumentState::Absent, -1};

    const ValueDef mine = adjudicated(v, static_cast<size_t>(match));
    for (size_t j = 0; j < v.count(); j++) {
        if (static_cast<int>(j) == match || !row_publishable(v[j])) continue;
        const ValueDef other = adjudicated(v, j);
        if (pressure && instrument_saturation_twin(mine, other)) continue;
        if (instrument_rows_overlap(mine, other)) return {InstrumentState::Ambiguous, -1};
    }
    return {InstrumentState::Supported, match};
}

// What one sub-observation may claim. It runs only when every instrument it needs is Supported:
// feature_gate.hpp's "disable, never degrade", applied per sub-observation so that a missing input
// switches off only the observations that read it. The first instrument that is not Supported is
// reported, so the reason names a real role rather than a summary.
struct InstrumentRequirement {
    InstrumentState state   = InstrumentState::Supported;
    Instrument      missing = Instrument::Count; // Count while every instrument is Supported
};

inline InstrumentRequirement instrument_require(const ProfileView& v, const Instrument* ids,
                                                size_t n) {
    for (size_t k = 0; k < n; k++) {
        const InstrumentResolution r = instrument_resolve(v, ids[k]);
        if (r.state != InstrumentState::Supported) return {r.state, ids[k]};
    }
    return {};
}

} // namespace daik::logic
