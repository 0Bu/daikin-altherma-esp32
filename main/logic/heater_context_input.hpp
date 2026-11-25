#pragma once

#include "checkup_persist.hpp"
#include "heater_context.hpp"
#include "history.hpp"
#include "instrument.hpp"
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

namespace daik::logic::heater_context_input {

namespace context = heater_context;

constexpr uint32_t INPUT_METHOD   = 2; // exact 0/1 plus complete numeric/text byte strings
constexpr size_t   MAX_FAULT_ROWS = 4;
enum class Input : uint8_t {
    Buh1,
    Buh2,
    Bsh,
    Defrost,
    Silent,
    Emergency,
    Route,
    Mode,
    Rps,
    Outdoor,
    Count
};
constexpr size_t            INPUTS        = size_t(Input::Count);
inline constexpr Instrument INSTRUMENTS[] = {Instrument::BuhStep1,      Instrument::BuhStep2,
                                             Instrument::Bsh,           Instrument::Defrost,
                                             Instrument::SilentMode,    Instrument::Emergency,
                                             Instrument::DhwValve,      Instrument::IuOperationMode,
                                             Instrument::CompressorRps, Instrument::OutdoorAir};
struct Layout {
    CheckupLocator  rows[INPUTS]{};
    InstrumentState states[INPUTS]{};
    CheckupLocator  fault_rows[MAX_FAULT_ROWS]{};
    uint32_t        schema_fp      = 0;
    uint8_t         fault_count    = 0;
    bool            fault_overflow = false;
};
inline bool has(const Layout& p, Input i) {
    return p.states[size_t(i)] == InstrumentState::Supported;
}
// Precompute from an immutable, already resolved profile OUTSIDE the HP/checkup locks. Profile
// lookup/model construction belongs to the caller and may allocate. This traversal itself owns
// no strings or containers. The resulting layout includes the independent consumer schema.
inline Layout resolve_layout(const char* id, const ProfileView& view) {
    Layout p;
    if (!id || !*id || !view.profile_id || std::strcmp(id, view.profile_id) ||
        !std::strcmp(id, "auto") || (view.base_count && !view.base) ||
        (view.extra_count && !view.extra) || (view.extra2_count && !view.extra2))
        return p;
    uint32_t crc = checkup_fp_u32(CONFIG_CRC32_INIT, 1);
    for (size_t i = 0; i < INPUTS; ++i) {
        const auto found = instrument_resolve(view, INSTRUMENTS[i]);
        p.states[i]      = found.state;
        crc              = checkup_fp_u32(crc, unsigned(found.state));
        if (found.state != InstrumentState::Supported) continue;
        const auto row = adjudicated(view, size_t(found.row));
        p.rows[i]      = {row.reg, row.offset, row.conv};
        crc            = checkup_fp_u32(crc, checkup_schema_row_key(row));
        crc            = checkup_fp_u32(crc, checkup_schema_row_fingerprint(view, row));
    }
    for (size_t i = 0; i < view.count(); ++i) {
        const auto row = adjudicated(view, i);
        if (row.conv != 203 || !row_publishable(view[i])) continue;
        crc = checkup_fp_u32(crc, checkup_schema_row_key(row));
        crc = checkup_fp_u32(crc, checkup_schema_row_fingerprint(view, row));
        if (p.fault_count == MAX_FAULT_ROWS)
            p.fault_overflow = true;
        else
            p.fault_rows[p.fault_count++] = {row.reg, row.offset, row.conv};
    }
    crc         = checkup_fp_u32(crc, p.fault_overflow);
    p.schema_fp = config_crc32_final(crc);
    if (!p.schema_fp) p.schema_fp = 1;
    crc = checkup_fp_u32(CONFIG_CRC32_INIT, 0x4843494Eu); // independent HCIN domain
    crc = checkup_fp_u32(crc, INPUT_METHOD);
    crc = checkup_fp_u32(crc, p.schema_fp); // rows, states, fault roster and decoder semantics
    p.schema_fp = config_crc32_final(crc);
    if (!p.schema_fp) p.schema_fp = 1;
    return p;
}

// Structural X10A capability is independent of a particular sweep. Missing optional inputs
// disable only their dependent categories; this collector does not admit external sources.
inline uint16_t capabilities(const Layout& p) {
    uint16_t m = 0;
    if (has(p, Input::Emergency)) m |= context::mask(context::Category::Emergency);
    if (p.fault_count && !p.fault_overflow) m |= context::mask(context::Category::Error);
    if (has(p, Input::Defrost)) m |= context::mask(context::Category::DefrostRecovery);
    if (has(p, Input::Route)) m |= context::mask(context::Category::DhwRoute);
    if (has(p, Input::Silent)) m |= context::mask(context::Category::Silent);
    const bool outdoor = has(p, Input::Outdoor) && has(p, Input::Rps);
    if (outdoor)
        m |= context::mask(context::Category::ColdOutdoor) |
             context::mask(context::Category::MildOutdoor);
    if (has(p, Input::Rps)) m |= context::mask(context::Category::CompressorOff);
    if (outdoor && has(p, Input::Silent) && has(p, Input::Route) && has(p, Input::Mode))
        m |= context::mask(context::Category::QuietMildHeating);
    return m;
}
inline uint8_t heater_support(const Layout& p) {
    return uint8_t((has(p, Input::Buh1) || has(p, Input::Buh2) ? 1u : 0u) |
                   (has(p, Input::Bsh) ? 2u : 0u));
}

template <class Row>
inline const Row* current_row(const CheckupLocator& key, const Row* rows, size_t n) {
    if (!rows) return nullptr;
    const Row* found = nullptr;
    for (size_t k = 0; k < n; ++k) {
        const auto& r = rows[k];
        if (!checkup_row_matches(key, r.reg, r.off, r.conv)) continue;
        if (found || r.held || r.held_unknown) return nullptr;
        found = &r;
    }
    return found;
}
// Supplied by the confirmed X10A lifecycle owner, not recomputed from transient rows.
// Consent generation zero remains valid; source generation zero is the existing invalid token.
struct Binding {
    uint32_t source_fp = 0, model_fp = 0, source_generation = 0;
    uint32_t consent_generation = 0, consent_epoch = 0;
};
inline bool same_binding(const Binding& a, const Binding& b) {
    return a.source_fp == b.source_fp && a.model_fp == b.model_fp &&
           a.source_generation == b.source_generation &&
           a.consent_generation == b.consent_generation && a.consent_epoch == b.consent_epoch;
}
struct Plan {
    Layout   inputs;
    Binding  binding;
    uint16_t capability_mask   = 0;
    uint8_t  supported_heaters = 0;
    bool     valid             = false;
};
// Bind only the precomputed POD layout while the owner holds its established checkup lock.
// Capture consent_generation/epoch there; do not read saved consent fields unlocked. This copy
// and fixed-size mask calculation perform no profile lookup/traversal or allocation.
inline Plan bind_plan(const Layout& layout, const Binding& binding) noexcept {
    Plan p;
    p.inputs  = layout;
    p.binding = binding;
    if (!p.inputs.schema_fp) return p;
    p.capability_mask   = capabilities(p.inputs); // X10A only; never an implicit external source
    p.supported_heaters = heater_support(p.inputs);
    p.valid             = binding.source_fp && binding.model_fp && binding.source_generation;
    return p;
}
// Convenience for callers already outside both locks. Locked lifecycle code uses bind_plan.
inline Plan make_plan(const char* id, const ProfileView& view, const Binding& binding) {
    return bind_plan(resolve_layout(id, view), binding);
}
// If false, retire the old counters/identity and pause the reducer before installing the new
// plan, including model/consent changes that leave generation/schema/masks unchanged.
inline bool same_lifecycle(const Plan& a, const Plan& b) {
    return a.valid && b.valid && same_binding(a.binding, b.binding) &&
           a.inputs.schema_fp == b.inputs.schema_fp && a.capability_mask == b.capability_mask &&
           a.supported_heaters == b.supported_heaters;
}
struct Sweep {
    Binding binding;
    // Explicit completed-sweep fact from the poll owner, not checkup_record's profile_confirmed
    // default (which is also used by failed-UART and auto/gap paths).
    bool diagnostics_enabled = false, source_confirmed = false, completed_sweep = false;
};
inline bool accepts(const Plan& p, const Sweep& current) {
    return p.valid && current.diagnostics_enabled && current.source_confirmed &&
           current.completed_sweep && same_binding(p.binding, current.binding);
}
struct Snapshot {
    context::Sample sample;
    Binding         binding;
    uint32_t        schema_fp         = 0;
    uint16_t        capability_mask   = 0;
    uint8_t         supported_heaters = 0;
    bool            admitted          = false;
};
inline bool still_current(const Plan& p, const Snapshot& s, const Sweep& current) {
    return s.admitted && accepts(p, current) && same_binding(s.binding, p.binding) &&
           s.schema_fp == p.inputs.schema_fp && s.capability_mask == p.capability_mask &&
           s.supported_heaters == p.supported_heaters;
}
// Existing C-string helpers need an explicit whole-byte-string guard for embedded NULs without
// reading past un-null-terminated string views.
template <class Row> inline bool complete_text(const Row& r) {
    const char*  text   = r.value.data();
    const size_t length = r.value.size();
    if (!text || !length) return false;
    for (size_t k = 0; k < length; ++k)
        if (!text[k]) return false;
    return true;
}
template <class Row> inline bool copy_complete_cstr(const Row& r, char (&buf)[32]) {
    if (!complete_text(r) || r.value.size() >= sizeof(buf)) return false;
    std::memcpy(buf, r.value.data(), r.value.size());
    buf[r.value.size()] = '\0';
    return true;
}
template <class Row> inline context::Bit binary(const Row* r) {
    if (!r || r->value.size() != 1) return context::Bit::Unknown;
    if (r->value[0] == '1') return context::Bit::On;
    if (r->value[0] == '0') return context::Bit::Off;
    return context::Bit::Unknown;
}
struct Number {
    int  tenths   = 0;
    bool negative = false, nonzero = false;
};
// hp_format emits fixed decimal ASCII. Parse it without libc floating conversion/allocation.
// Quantization is the existing tenths half-away rule and int16/sentinel domain; no new band.
template <class Row> inline bool numeric(const Row* r, Number& out) {
    if (!r || !r->value.size()) return false;
    const char*  text   = r->value.data();
    const size_t length = r->value.size();
    if (!text) return false;
    size_t i        = 0;
    bool   negative = false, point = false, digit = false, nonzero = false;
    if (text[i] == '-' || text[i] == '+') negative = text[i++] == '-';
    uint32_t whole    = 0;
    unsigned decimals = 0, tenth = 0, hundredth = 0;
    for (; i < length; ++i) {
        const char c = text[i];
        if (c == '.' && !point) {
            point = true;
            continue;
        }
        if (c < '0' || c > '9') return false; // includes NUL, trailing junk and nonfinite names
        const unsigned value = unsigned(c - '0');
        digit                = true;
        nonzero |= value != 0;
        if (!point) {
            if (whole > 3277u / 10u || whole * 10u + value > 3277u) return false;
            whole = whole * 10u + value;
        } else if (decimals == 0) {
            tenth = value;
            ++decimals;
        } else if (decimals == 1) {
            hundredth = value;
            ++decimals;
        }
    }
    if (!digit) return false;
    int tenths = int(whole * 10u + tenth + unsigned(hundredth >= 5));
    if (negative) tenths = -tenths;
    if (tenths <= int(HISTORY_HELD_OVER) || tenths > INT16_MAX) return false;
    out = {tenths, negative && nonzero, nonzero};
    return true;
}
// Borrow only the immutable accepted current X10A sweep array. Binding is not a sweep/replay
// sequence: the owner supplies actual current rows, folds each snapshot once, and pauses on gaps.
// After collection, recheck still_current under the established owner lock before step().
template <class Row>
inline Snapshot collect(const Plan& p, const Row* rows, size_t count, const Sweep& current) {
    Snapshot out;
    if (!accepts(p, current)) return out;
    out.binding           = p.binding;
    out.schema_fp         = p.inputs.schema_fp;
    out.capability_mask   = p.capability_mask;
    out.supported_heaters = p.supported_heaters;
    out.admitted          = true;
    auto&      s          = out.sample;
    const auto row        = [&](Input input) -> const Row* {
        if (!has(p.inputs, input)) return nullptr;
        return current_row(p.inputs.rows[size_t(input)], rows, count);
    };
    const auto bit   = [&](Input input) { return binary(row(input)); };
    const auto first = bit(Input::Buh1), second = bit(Input::Buh2);
    const bool buh_off = (has(p.inputs, Input::Buh1) || has(p.inputs, Input::Buh2)) &&
                         (p.inputs.states[size_t(Input::Buh1)] == InstrumentState::Absent ||
                          first == context::Bit::Off) &&
                         (p.inputs.states[size_t(Input::Buh2)] == InstrumentState::Absent ||
                          second == context::Bit::Off);
    if (first == context::Bit::On || second == context::Bit::On)
        s.heater[0] = context::Bit::On;
    else if (buh_off)
        s.heater[0] = context::Bit::Off;
    s.heater[1] = bit(Input::Bsh);
    s.emergency = bit(Input::Emergency);
    s.defrost   = bit(Input::Defrost);
    s.silent    = bit(Input::Silent);
    s.dhw       = bit(Input::Route);
    if (p.inputs.fault_count && !p.inputs.fault_overflow) s.error = context::Bit::Off;
    char text_buf[32]{};
    for (size_t k = 0; k < p.inputs.fault_count && !p.inputs.fault_overflow; ++k) {
        const auto* fault = current_row(p.inputs.fault_rows[k], rows, count);
        const auto  value = fault && copy_complete_cstr(*fault, text_buf)
                                ? fault_class_from_text(text_buf)
                                : FaultClass::Unknown;
        s.error           = context::tri_or(
            s.error, context::truth(value != FaultClass::Unknown, fault_error_active(value)));
    }
    if (const auto* mode = row(Input::Mode); mode && copy_complete_cstr(*mode, text_buf))
        s.mode = checkup_operating_mode(text_buf);
    Number     rps;
    const bool rps_known = numeric(row(Input::Rps), rps) && !rps.negative;
    s.compressor_off     = context::truth(rps_known, !rps.nonzero);
    Number outdoor;
    if (numeric(row(Input::Outdoor), outdoor)) {
        const auto evidence =
            outdoor_x10a_evidence(true, rps_known, rps.nonzero, outdoor.tenths / 10.0);
        if (outdoor_evidence_valid(evidence)) {
            s.outdoor_known  = true;
            s.outdoor_tenths = static_cast<int16_t>(outdoor.tenths);
            s.outdoor_source = OutdoorSource::X10a;
            // No fabricated independent-source generation or source timestamp.
        }
    }
    return out;
}
static_assert(std::is_trivially_copyable<Plan>::value && std::is_standard_layout<Plan>::value);
static_assert(std::is_trivially_copyable<Snapshot>::value &&
              std::is_standard_layout<Snapshot>::value);
static_assert(sizeof(Plan) <= 160 && sizeof(Snapshot) <= 56, "bounded heater-context inputs");

} // namespace daik::logic::heater_context_input
