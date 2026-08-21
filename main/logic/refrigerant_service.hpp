#pragma once
// A read-only refrigerant-circuit SERVICE OBSERVATION, never a refrigerant diagnosis.
//
// The tracker answers one deliberately narrow question: has one uninterrupted series of fresh,
// same-sweep X10A values been observed while the compressor ran in known space heating
// mode?  It does not command a service mode, prove full load or stable thermodynamics, judge a value
// against a normal range, infer refrigerant charge, or confirm mechanical EEV movement.
//
// There is intentionally no 20-minute threshold and no Complete/OK state.  No model-specific
// Altherma primary source in this repository establishes a universal settling limit for this view.
// The firmware therefore exposes continuous observed time and interruptions, leaving model-specific
// service procedures to the qualified reader.
#include <cstddef>
#include <cstdint>
#include <climits>

namespace daik::logic {

enum class RefrigerantServiceState : uint8_t {
    Unsupported = 0,
    Waiting,
    Observing,
    Limited,
    Interrupted,
};

enum class RefrigerantServiceBlocker : uint8_t {
    None = 0,
    Unsupported,
    NoFreshRun,
    UnknownMode,
    Dhw,
    Defrost,
    Fault,
    SpecialPhase,
    MissingFreshData,
    PollGap,
};

enum RefrigerantServiceLimitation : uint8_t {
    RefrigerantServiceNoLimitation       = 0,
    RefrigerantServiceSpecialPhases      = 1U << 0,
    RefrigerantServiceTemperatures       = 1U << 1,
    RefrigerantServicePressureSides      = 1U << 2,
    RefrigerantServiceOutdoorContext     = 1U << 3,
};

enum class RefrigerantServiceMode : uint8_t { Unknown = 0, Heating, Cooling, Other };

constexpr bool refrigerant_service_text_equal(const char* a, const char* b) {
    if (!a || !b) return false;
    while (*a && *b && *a == *b) { ++a; ++b; }
    return *a == '\0' && *b == '\0';
}

// Combined DHW modes are not silently reduced to their heating/cooling half.  The 3-way valve is an
// independent witness, but an unreadable valve must not turn "Heating + DHW" into service permission.
constexpr RefrigerantServiceMode refrigerant_service_mode_from_text(const char* text) {
    if (refrigerant_service_text_equal(text, "Heating")) return RefrigerantServiceMode::Heating;
    if (refrigerant_service_text_equal(text, "Cooling")) return RefrigerantServiceMode::Cooling;
    if (refrigerant_service_text_equal(text, "Stop") ||
        refrigerant_service_text_equal(text, "DHW") ||
        refrigerant_service_text_equal(text, "Heating + DHW") ||
        refrigerant_service_text_equal(text, "Cooling + DHW"))
        return RefrigerantServiceMode::Other;
    return RefrigerantServiceMode::Unknown;
}

inline const char* refrigerant_service_state_name(RefrigerantServiceState s) {
    switch (s) {
        case RefrigerantServiceState::Unsupported: return "unsupported";
        case RefrigerantServiceState::Waiting:     return "waiting";
        case RefrigerantServiceState::Observing:   return "observing";
        case RefrigerantServiceState::Limited:     return "limited";
        case RefrigerantServiceState::Interrupted: return "interrupted";
    }
    return "unsupported";
}

inline const char* refrigerant_service_blocker_name(RefrigerantServiceBlocker b) {
    switch (b) {
        case RefrigerantServiceBlocker::None:             return "";
        case RefrigerantServiceBlocker::Unsupported:      return "unsupported_profile";
        case RefrigerantServiceBlocker::NoFreshRun:       return "compressor_not_running";
        case RefrigerantServiceBlocker::UnknownMode:      return "unsupported_or_unknown_mode";
        case RefrigerantServiceBlocker::Dhw:              return "dhw_path";
        case RefrigerantServiceBlocker::Defrost:          return "defrost";
        case RefrigerantServiceBlocker::Fault:            return "unit_fault";
        case RefrigerantServiceBlocker::SpecialPhase:     return "special_controller_phase";
        case RefrigerantServiceBlocker::MissingFreshData: return "missing_fresh_signal";
        case RefrigerantServiceBlocker::PollGap:          return "poll_gap";
    }
    return "missing_fresh_signal";
}

inline const char* refrigerant_service_mode_name(RefrigerantServiceMode m) {
    switch (m) {
        case RefrigerantServiceMode::Heating: return "heating";
        case RefrigerantServiceMode::Cooling: return "cooling";
        case RefrigerantServiceMode::Other:   return "other";
        case RefrigerantServiceMode::Unknown: return "unknown";
    }
    return "unknown";
}

// Capability comes from publishable, converter-adjudicated profile rows.  `high_pressure` includes
// the always-live hydronic-page refrigerant transducer where present; it never includes Water
// pressure.  The four special phases are profile-specific today, so their absence limits claim
// strength instead of disabling useful raw observation.
struct RefrigerantServiceCoverage {
    bool rps = false;
    bool mode = false;
    bool valve_dhw = false;
    bool defrost = false;
    bool fault = false;
    uint8_t fault_rows = 0;
    bool discharge = false;
    bool suction = false;
    bool liquid = false;
    bool eev_command = false;
    bool high_pressure = false;
    bool low_pressure = false;
    bool outdoor_air = false;
    bool outdoor_hx = false;
    bool restart_standby = false;
    bool startup = false;
    bool oil_return = false;
    bool pressure_equalizing = false;
};

inline void refrigerant_service_cover_row(RefrigerantServiceCoverage& c, unsigned reg,
                                          unsigned off, int conv, bool refrigerant_pressure) {
    if (reg == 0x30 && off == 0 && conv == 152) c.rps = true;
    if (reg == 0x60 && off == 2 && conv == 315) c.mode = true;
    if (reg == 0x60 && off == 12 && conv == 306) c.valve_dhw = true;
    if (reg == 0x10 && off == 1 && conv == 304) c.defrost = true;
    if (conv == 203) {
        c.fault = true;
        if (c.fault_rows < UINT8_MAX) c.fault_rows++;
    }
    if (reg == 0x20 && off == 4 && conv == 105) c.discharge = true;
    if (reg == 0x20 && off == 6 && conv == 105) c.suction = true;
    if (reg == 0x20 && off == 10 && conv == 105) c.liquid = true;
    if (reg == 0x30 && off == 3 && conv == 151) c.eev_command = true;
    if (refrigerant_pressure) {
        if (reg == 0x20 && off == 14) c.low_pressure = true;
        else if ((reg == 0x20 && off == 12) || (reg == 0x62 && off == 15))
            c.high_pressure = true;
    }
    if (reg == 0x20 && off == 0 && conv == 105) c.outdoor_air = true;
    if (reg == 0x20 && off == 2 && conv == 105) c.outdoor_hx = true;
    if (reg == 0x10 && off == 1 && conv == 306) c.restart_standby = true;
    if (reg == 0x10 && off == 1 && conv == 305) c.startup = true;
    if (reg == 0x10 && off == 1 && conv == 303) c.oil_return = true;
    if (reg == 0x10 && off == 1 && conv == 302) c.pressure_equalizing = true;
}

inline bool refrigerant_service_supported(const RefrigerantServiceCoverage& c) {
    return c.rps && c.mode && c.valve_dhw && c.defrost && c.fault &&
           c.discharge && c.eev_command &&
           (c.high_pressure || c.low_pressure);
}

inline bool refrigerant_service_special_phases_known(const RefrigerantServiceCoverage& c) {
    return c.restart_standby && c.startup && c.oil_return && c.pressure_equalizing;
}

struct RefrigerantServiceSample {
    bool rps_known = false;
    bool rps_running = false;
    int  rps_tenths = 0;
    RefrigerantServiceMode mode = RefrigerantServiceMode::Unknown;
    bool valve_known = false, valve_dhw = false;
    bool defrost_known = false, defrost_on = false;
    bool fault_known = false, fault_active = false;
    bool restart_known = false, restart_on = false;
    bool startup_known = false, startup_on = false;
    bool oil_return_known = false, oil_return_on = false;
    bool pressure_equalizing_known = false, pressure_equalizing_on = false;
    bool discharge_ok = false; int discharge_tenths = 0;
    bool suction_ok = false; int suction_tenths = 0;
    bool liquid_ok = false; int liquid_tenths = 0;
    bool eev_ok = false; int eev_tenths = 0;
    bool high_pressure_ok = false; int high_pressure_tenths = 0;
    bool low_pressure_ok = false; int low_pressure_tenths = 0;
    bool outdoor_air_ok = false; int outdoor_air_tenths = 0;
    bool outdoor_hx_ok = false; int outdoor_hx_tenths = 0;
};

struct RefrigerantServiceMetric {
    uint32_t samples = 0;
    int min_tenths = 0;
    int max_tenths = 0;
    int64_t sum_tenths = 0;

    void reset() { samples = 0; min_tenths = max_tenths = 0; sum_tenths = 0; }
    void fold(int value) {
        if (!samples) min_tenths = max_tenths = value;
        else {
            if (value < min_tenths) min_tenths = value;
            if (value > max_tenths) max_tenths = value;
        }
        if (samples < UINT32_MAX) samples++;
        sum_tenths += value;
    }
    int mean_tenths() const {
        if (!samples) return 0;
        return static_cast<int>(sum_tenths / static_cast<int64_t>(samples));
    }
};

struct RefrigerantServiceTracker {
    RefrigerantServiceState state = RefrigerantServiceState::Unsupported;
    RefrigerantServiceBlocker blocker = RefrigerantServiceBlocker::Unsupported;
    RefrigerantServiceMode mode = RefrigerantServiceMode::Unknown;
    uint32_t generation = 0;
    bool coverage_evaluated = false;
    int64_t last_us = -1;
    int64_t max_gap_us = 0;
    uint64_t continuous_us = 0;
    uint32_t samples = 0;
    bool active = false;
    uint8_t limitation_mask = RefrigerantServiceNoLimitation;
    bool special_phases_known = false;
    RefrigerantServiceMetric rps;
    RefrigerantServiceMetric discharge;
    RefrigerantServiceMetric eev_command;
    RefrigerantServiceMetric high_pressure;
    RefrigerantServiceMetric low_pressure;

    void clear_window() {
        continuous_us = 0;
        samples = 0;
        active = false;
        limitation_mask = RefrigerantServiceNoLimitation;
        rps.reset(); discharge.reset(); eev_command.reset();
        high_pressure.reset(); low_pressure.reset();
    }
};

struct RefrigerantServiceMetricSnapshot {
    bool available = false;
    int min_tenths = 0;
    int mean_tenths = 0;
    int max_tenths = 0;
};

struct RefrigerantServiceSnapshot {
    RefrigerantServiceState state = RefrigerantServiceState::Unsupported;
    RefrigerantServiceBlocker blocker = RefrigerantServiceBlocker::Unsupported;
    RefrigerantServiceMode mode = RefrigerantServiceMode::Unknown;
    uint32_t continuous_s = 0;
    uint32_t samples = 0;
    bool coverage_evaluated = false;
    bool special_phases_known = false;
    uint8_t limitation_mask = RefrigerantServiceNoLimitation;
    RefrigerantServiceMetricSnapshot rps;
    RefrigerantServiceMetricSnapshot discharge;
    RefrigerantServiceMetricSnapshot eev_command;
    RefrigerantServiceMetricSnapshot high_pressure;
    RefrigerantServiceMetricSnapshot low_pressure;
};

inline RefrigerantServiceMetricSnapshot refrigerant_service_metric_snapshot(
    const RefrigerantServiceMetric& m) {
    RefrigerantServiceMetricSnapshot out;
    out.available = m.samples > 0;
    out.min_tenths = m.min_tenths;
    out.mean_tenths = m.mean_tenths();
    out.max_tenths = m.max_tenths;
    return out;
}

inline RefrigerantServiceSnapshot refrigerant_service_snapshot(const RefrigerantServiceTracker& t,
                                                                int64_t now_us) {
    RefrigerantServiceSnapshot out;
    if (t.active && t.max_gap_us > 0 &&
        (now_us <= t.last_us || now_us - t.last_us > t.max_gap_us)) {
        out.state = RefrigerantServiceState::Interrupted;
        out.blocker = RefrigerantServiceBlocker::PollGap;
        out.mode = t.mode;
        out.coverage_evaluated = t.coverage_evaluated;
        out.special_phases_known = t.special_phases_known;
        out.limitation_mask = t.limitation_mask;
        return out;
    }
    out.state = t.state;
    out.blocker = t.blocker;
    out.mode = t.mode;
    out.continuous_s = static_cast<uint32_t>(t.continuous_us / 1000000ULL);
    out.samples = t.samples;
    out.coverage_evaluated = t.coverage_evaluated;
    out.special_phases_known = t.special_phases_known;
    out.limitation_mask = t.limitation_mask;
    out.rps = refrigerant_service_metric_snapshot(t.rps);
    out.discharge = refrigerant_service_metric_snapshot(t.discharge);
    out.eev_command = refrigerant_service_metric_snapshot(t.eev_command);
    out.high_pressure = refrigerant_service_metric_snapshot(t.high_pressure);
    out.low_pressure = refrigerant_service_metric_snapshot(t.low_pressure);
    return out;
}

struct RefrigerantServiceDecision {
    bool eligible = false;
    bool limited = true;
    RefrigerantServiceState state = RefrigerantServiceState::Waiting;
    RefrigerantServiceBlocker blocker = RefrigerantServiceBlocker::MissingFreshData;
    uint8_t limitation_mask = RefrigerantServiceNoLimitation;
};

inline RefrigerantServiceDecision refrigerant_service_decide(
    const RefrigerantServiceCoverage& c, const RefrigerantServiceSample& s) {
    RefrigerantServiceDecision d;
    if (!refrigerant_service_supported(c)) {
        d.state = RefrigerantServiceState::Unsupported;
        d.blocker = RefrigerantServiceBlocker::Unsupported;
        return d;
    }
    if (!s.rps_known) {
        d.blocker = RefrigerantServiceBlocker::MissingFreshData;
        return d;
    }
    if (!s.rps_running) {
        d.blocker = RefrigerantServiceBlocker::NoFreshRun;
        return d;
    }
    // The currently established pressure-side witness applies to heating.  Do not silently reuse it
    // for cooling until model-specific source evidence establishes that role there too.
    if (s.mode != RefrigerantServiceMode::Heating) {
        d.blocker = RefrigerantServiceBlocker::UnknownMode;
        return d;
    }
    if (!s.valve_known) return d;
    if (s.valve_dhw) {
        d.blocker = RefrigerantServiceBlocker::Dhw;
        return d;
    }
    if (!s.defrost_known) return d;
    if (s.defrost_on) {
        d.blocker = RefrigerantServiceBlocker::Defrost;
        return d;
    }
    if (!s.fault_known) return d;
    if (s.fault_active) {
        d.blocker = RefrigerantServiceBlocker::Fault;
        return d;
    }
    const bool special_active =
        (s.restart_known && s.restart_on) || (s.startup_known && s.startup_on) ||
        (s.oil_return_known && s.oil_return_on) ||
        (s.pressure_equalizing_known && s.pressure_equalizing_on);
    if (special_active) {
        d.blocker = RefrigerantServiceBlocker::SpecialPhase;
        return d;
    }
    // If a profile offers a special-phase witness, losing it in the current sweep is an interruption,
    // not permission to upgrade the same window after the row happens to return later.  Profiles that
    // do not expose all four witnesses remain explicitly limited for the whole window.
    if ((c.restart_standby && !s.restart_known) || (c.startup && !s.startup_known) ||
        (c.oil_return && !s.oil_return_known) ||
        (c.pressure_equalizing && !s.pressure_equalizing_known))
        return d;
    if (!s.discharge_ok || !s.eev_ok || (!s.high_pressure_ok && !s.low_pressure_ok)) return d;

    if (!refrigerant_service_special_phases_known(c))
        d.limitation_mask |= RefrigerantServiceSpecialPhases;
    if (!c.suction || !c.liquid || !s.suction_ok || !s.liquid_ok)
        d.limitation_mask |= RefrigerantServiceTemperatures;
    if (!c.high_pressure || !c.low_pressure || !s.high_pressure_ok || !s.low_pressure_ok)
        d.limitation_mask |= RefrigerantServicePressureSides;
    if (!c.outdoor_air || !c.outdoor_hx || !s.outdoor_air_ok || !s.outdoor_hx_ok)
        d.limitation_mask |= RefrigerantServiceOutdoorContext;
    d.eligible = true;
    d.limited = d.limitation_mask != RefrigerantServiceNoLimitation;
    d.state = d.limited ? RefrigerantServiceState::Limited
                        : RefrigerantServiceState::Observing;
    d.blocker = RefrigerantServiceBlocker::None;
    return d;
}

inline void refrigerant_service_record(RefrigerantServiceTracker& t,
                                       const RefrigerantServiceCoverage& c,
                                       const RefrigerantServiceSample& s,
                                       int64_t now_us, uint32_t generation,
                                       int64_t max_gap_us = 0) {
    if (generation == 0 || t.generation != generation) {
        t = RefrigerantServiceTracker{};
        t.generation = generation;
    }
    if (max_gap_us > 0) t.max_gap_us = max_gap_us;
    t.coverage_evaluated = true;
    t.special_phases_known = refrigerant_service_special_phases_known(c);
    const RefrigerantServiceDecision d = refrigerant_service_decide(c, s);

    if (!d.eligible) {
        const bool interrupted = t.active;
        t.clear_window();
        t.state = interrupted ? RefrigerantServiceState::Interrupted : d.state;
        t.blocker = d.blocker;
        t.mode = s.mode;
        t.last_us = now_us;
        return;
    }

    if (t.active && (now_us <= t.last_us || t.max_gap_us <= 0 ||
                     now_us - t.last_us > t.max_gap_us)) {
        t.clear_window();
        t.state = RefrigerantServiceState::Interrupted;
        t.blocker = RefrigerantServiceBlocker::PollGap;
        t.mode = s.mode;
        t.last_us = now_us;
        return;
    }

    if (!t.active) t.clear_window();
    else t.continuous_us += static_cast<uint64_t>(now_us - t.last_us);
    t.active = true;
    t.limitation_mask |= d.limitation_mask;  // one incomplete sweep limits the whole window
    t.state = t.limitation_mask == RefrigerantServiceNoLimitation
        ? RefrigerantServiceState::Observing : RefrigerantServiceState::Limited;
    t.blocker = RefrigerantServiceBlocker::None;
    t.mode = s.mode;
    t.last_us = now_us;
    if (t.samples < UINT32_MAX) t.samples++;
    t.rps.fold(s.rps_tenths);
    t.discharge.fold(s.discharge_tenths);
    t.eev_command.fold(s.eev_tenths);
    if (s.high_pressure_ok) t.high_pressure.fold(s.high_pressure_tenths);
    if (s.low_pressure_ok) t.low_pressure.fold(s.low_pressure_tenths);
}

// Record a cycle which deliberately did not sample X10A (network quiescence) or whose poll body
// failed before it could produce a same-sweep sample.  Feeding an empty sample through decide()
// would falsely translate "not observed" into "compressor not running"; this explicit path names
// the evidence loss and never carries the old window across it.
inline void refrigerant_service_record_poll_gap(RefrigerantServiceTracker& t,
                                                int64_t now_us, uint32_t generation) {
    if (generation == 0 || t.generation != generation) {
        t = RefrigerantServiceTracker{};
        t.generation = generation;
    }
    const bool interrupted = t.active;
    t.clear_window();
    t.state = interrupted ? RefrigerantServiceState::Interrupted
                          : RefrigerantServiceState::Waiting;
    t.blocker = RefrigerantServiceBlocker::PollGap;
    t.mode = RefrigerantServiceMode::Unknown;
    t.last_us = now_us;
}

} // namespace daik::logic
