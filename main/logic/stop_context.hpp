#pragma once

#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace daik::logic {

// Provisional project observations, not stop causes or manufacturer control thresholds. The
// temperature pair is reported pre-BUH LWT minus reported main target; it is not controlled
// overshoot. The request bit is the indoor unit's request, not an external thermostat.
constexpr int64_t  STOP_CONTEXT_WINDOW_US           = 30000000;
constexpr int64_t  STOP_CONTEXT_MAX_GAP_US          = 15000000;
constexpr int64_t  STOP_CONTEXT_TARGET_STABLE_US    = STOP_CONTEXT_WINDOW_US;
constexpr uint16_t STOP_CONTEXT_LOW_RPS_TENTHS      = 220;
constexpr int32_t  STOP_CONTEXT_ABOVE_TARGET_TENTHS = 20;

enum class StopContextBit : uint8_t { Unknown, Off, On };
enum class StopContextRoute : uint8_t { Unknown, Space, Dhw };
enum class StopContextMode : uint8_t { Unknown, Heating, Cooling, Dhw, Other };
enum class StopContextCategory : uint8_t {
    LowRpsAboveMainTarget,
    RequestWithdrawal,
    Defrost,
    DhwTransition,
    RouteModeTransition,
    Count
};
constexpr size_t  STOP_CONTEXT_CATEGORIES = static_cast<size_t>(StopContextCategory::Count);
constexpr uint8_t STOP_CONTEXT_ALL        = (1u << STOP_CONTEXT_CATEGORIES) - 1u;
constexpr uint8_t stop_context_mask(StopContextCategory c) {
    return static_cast<uint8_t>(1u << static_cast<unsigned>(c));
}

// Every known flag means supported, current-sweep readable, range-checked and bound to the same
// source by the caller. Unknown optional inputs affect their own categories only. The actual
// compressor boolean remains separate from its numeric value; disagreeing values cannot establish
// the temperature category. No held/cache value is made fresh by this reducer.
struct StopContextSample {
    bool             rps_known       = false;
    bool             rps_running     = false;
    bool             rps_value_known = false;
    uint16_t         rps_tenths      = 0;
    StopContextBit   request         = StopContextBit::Unknown;
    StopContextBit   defrost         = StopContextBit::Unknown;
    StopContextRoute route           = StopContextRoute::Unknown;
    StopContextMode  mode            = StopContextMode::Unknown;
    bool             lwt_known       = false;
    bool             target_known    = false;
    int16_t          lwt_tenths      = 0;
    int16_t          target_tenths   = 0;
};

enum class StopContextFinish : uint8_t {
    WindowEnd,
    Restart,
    Gap,
    SourceReset,
    Shutdown,
    ClockInvalid
};
constexpr uint16_t STOP_CONTEXT_F_TARGET_CHANGED = 1u << 0;
constexpr uint16_t STOP_CONTEXT_F_TIME_OVERFLOW  = 1u << 1;
constexpr uint16_t STOP_CONTEXT_F_PRE_PARTIAL    = 1u << 2;
constexpr uint16_t STOP_CONTEXT_F_POST_PARTIAL   = 1u << 3;

// Masks are overlapping observations. `evaluable` means a positive was established OR the entire
// sampled window was readable for that category; only `complete` permits a full-window negative.
// Complete means readable endpoints across the inclusive [-30,+30] s window with no >15 s gap,
// not proof that an unobserved pulse between polls did not happen. Pre/post masks expose where
// coverage was lost. An early finish never erases an already established positive observation.
struct StopContextEvent {
    int64_t  stop_us = -1; // ORIGINAL witnessed stop, including on late completion or source reset
    uint32_t source_generation = 0;
    uint16_t flags             = 0;
    uint8_t  positive          = 0;
    uint8_t  evaluable         = 0;
    uint8_t  complete          = 0;
    uint8_t  pre_complete      = 0;
    uint8_t  post_complete     = 0;
    StopContextFinish finish   = StopContextFinish::WindowEnd;
    bool              valid    = false;
};

// Standalone hourly/aggregate payload; no core checkup bucket or ring is enlarged. Every field
// counts the explicitly named population below. Unknown, partial, censored and unclassified can
// overlap each other and the positive counts. They do not form an exclusive causal partition.
struct StopContextCounters {
    uint16_t witnessed_stops_recent_heating     = 0;
    uint16_t positive[STOP_CONTEXT_CATEGORIES]  = {};
    uint16_t evaluable[STOP_CONTEXT_CATEGORIES] = {};
    uint16_t complete[STOP_CONTEXT_CATEGORIES]  = {};
    uint16_t unclassified   = 0; // no positive category established; not a proven negative
    uint16_t unknown        = 0; // at least one category not evaluable
    uint16_t partial        = 0; // at least one category lacks the full sampled window
    uint16_t censored       = 0; // restart, gap, source reset, shutdown, or invalid monotonic clock
    uint16_t target_changed = 0;
    uint16_t time_overflow  = 0;
    bool     saturated      = false; // any attempted addition exceeded the representation
};
static_assert(sizeof(StopContextCounters) <= 192, "stop-context payload exceeded its bound");

inline uint16_t stop_context_add(uint16_t a, uint16_t b, bool& saturated) noexcept {
    if (b > UINT16_MAX - a) {
        saturated = true;
        return UINT16_MAX;
    }
    return static_cast<uint16_t>(a + b);
}

inline void stop_context_merge(StopContextCounters&       into,
                               const StopContextCounters& from) noexcept {
    // Copy also makes self-merge well-defined for every field and the saturation flag.
    const StopContextCounters add = from;
    into.saturated |= add.saturated;
    into.witnessed_stops_recent_heating = stop_context_add(
        into.witnessed_stops_recent_heating, add.witnessed_stops_recent_heating, into.saturated);
    for (size_t k = 0; k < STOP_CONTEXT_CATEGORIES; ++k) {
        into.positive[k]  = stop_context_add(into.positive[k], add.positive[k], into.saturated);
        into.evaluable[k] = stop_context_add(into.evaluable[k], add.evaluable[k], into.saturated);
        into.complete[k]  = stop_context_add(into.complete[k], add.complete[k], into.saturated);
    }
    into.unclassified   = stop_context_add(into.unclassified, add.unclassified, into.saturated);
    into.unknown        = stop_context_add(into.unknown, add.unknown, into.saturated);
    into.partial        = stop_context_add(into.partial, add.partial, into.saturated);
    into.censored       = stop_context_add(into.censored, add.censored, into.saturated);
    into.target_changed = stop_context_add(into.target_changed, add.target_changed, into.saturated);
    into.time_overflow  = stop_context_add(into.time_overflow, add.time_overflow, into.saturated);
}

inline StopContextCounters stop_context_counters(const StopContextEvent& e) noexcept {
    StopContextCounters c;
    if (!e.valid) return c;
    c.witnessed_stops_recent_heating = 1;
    for (size_t k = 0; k < STOP_CONTEXT_CATEGORIES; ++k) {
        c.positive[k]  = (e.positive >> k) & 1u;
        c.evaluable[k] = (e.evaluable >> k) & 1u;
        c.complete[k]  = (e.complete >> k) & 1u;
    }
    c.unclassified   = e.positive == 0;
    c.unknown        = e.evaluable != STOP_CONTEXT_ALL;
    c.partial        = e.complete != STOP_CONTEXT_ALL;
    c.censored       = e.finish != StopContextFinish::WindowEnd;
    c.target_changed = (e.flags & STOP_CONTEXT_F_TARGET_CHANGED) != 0;
    c.time_overflow  = (e.flags & STOP_CONTEXT_F_TIME_OVERFLOW) != 0;
    return c;
}

struct StopContextState {
    StopContextEvent pending;
    int64_t          last_sample_us                             = -1;
    int64_t          last_rps_us                                = -1;
    int64_t          recent_heating_us                          = -1;
    int64_t          positive_us[STOP_CONTEXT_CATEGORIES]       = {-1, -1, -1, -1, -1};
    int64_t          readable_since_us[STOP_CONTEXT_CATEGORIES] = {-1, -1, -1, -1, -1};
    int64_t          request_us                                 = -1;
    int64_t          route_us                                   = -1;
    int64_t          mode_us                                    = -1;
    int64_t          target_us                                  = -1;
    int64_t          target_stable_us                           = -1;
    int64_t          target_changed_us                          = -1;
    uint32_t         source_generation                          = 0;
    int16_t          target_tenths                              = 0;
    StopContextBit   request                                    = StopContextBit::Unknown;
    StopContextRoute route                                      = StopContextRoute::Unknown;
    StopContextMode  mode                                       = StopContextMode::Unknown;
    bool             have_generation                            = false;
    bool             last_rps_running                           = false;
    bool             armed_off                                  = false;
    bool             witnessed_run                              = false;
};
static_assert(std::is_trivially_copyable<StopContextState>::value, "state must remain POD storage");
static_assert(std::is_standard_layout<StopContextState>::value, "state must remain POD storage");

constexpr bool stop_context_recent(int64_t then_us, int64_t now_us,
                                   int64_t span_us = STOP_CONTEXT_WINDOW_US) noexcept {
    return then_us >= 0 && now_us >= then_us && now_us - then_us <= span_us;
}

inline int64_t stop_context_deadline(const StopContextEvent& e) noexcept {
    return e.stop_us > INT64_MAX - STOP_CONTEXT_WINDOW_US ? INT64_MAX
                                                          : e.stop_us + STOP_CONTEXT_WINDOW_US;
}

inline StopContextEvent stop_context_finish(StopContextState& st, StopContextFinish reason,
                                            bool observed_window_end = false) noexcept {
    StopContextEvent e = st.pending;
    if (!e.valid) return e;
    e.finish = reason;
    if (!observed_window_end) e.post_complete = 0;
    e.complete  = e.pre_complete & e.post_complete;
    e.evaluable = e.positive | e.complete;
    if (e.pre_complete != STOP_CONTEXT_ALL) e.flags |= STOP_CONTEXT_F_PRE_PARTIAL;
    if (e.post_complete != STOP_CONTEXT_ALL) e.flags |= STOP_CONTEXT_F_POST_PARTIAL;
    st.pending = StopContextEvent{};
    return e;
}

// Seal before shutdown, source-generation replacement, or storage lifecycle reset. The returned
// event still belongs to the OLD generation/hour. The caller books it there or explicitly discards
// that generation. No evidence is carried into the fresh state, and no journal I/O occurs here.
inline StopContextEvent
stop_context_reset(StopContextState& st, uint32_t generation,
                   StopContextFinish reason = StopContextFinish::SourceReset) noexcept {
    const StopContextEvent e = stop_context_finish(st, reason);
    st                       = StopContextState{};
    st.source_generation     = generation;
    st.have_generation       = true;
    return e;
}

inline StopContextEvent stop_context_seal(StopContextState& st) noexcept {
    return stop_context_reset(st, st.source_generation, StopContextFinish::Shutdown);
}

// Read/report expiry is independent from producer updates. Time passing alone cannot establish a
// negative observation. Without a poll bracketing +30 s, expiry yields partial post coverage.
inline StopContextEvent stop_context_expire(StopContextState& st, int64_t now_us) noexcept {
    if (now_us < 0 || (st.last_sample_us >= 0 && now_us < st.last_sample_us))
        return stop_context_reset(st, st.source_generation, StopContextFinish::ClockInvalid);
    if ((st.last_sample_us >= 0 && now_us - st.last_sample_us > STOP_CONTEXT_MAX_GAP_US) ||
        (st.last_rps_us >= 0 && now_us - st.last_rps_us > STOP_CONTEXT_MAX_GAP_US))
        return stop_context_reset(st, st.source_generation, StopContextFinish::Gap);
    if (st.pending.valid && now_us >= stop_context_deadline(st.pending))
        return stop_context_finish(st, StopContextFinish::WindowEnd);
    return StopContextEvent{};
}

inline uint8_t stop_context_readable(const StopContextSample& s) noexcept {
    uint8_t mask = 0;
    if (s.request != StopContextBit::Unknown)
        mask |= stop_context_mask(StopContextCategory::RequestWithdrawal);
    if (s.defrost != StopContextBit::Unknown)
        mask |= stop_context_mask(StopContextCategory::Defrost);
    if (s.route != StopContextRoute::Unknown && s.mode != StopContextMode::Unknown) {
        mask |= stop_context_mask(StopContextCategory::DhwTransition) |
                stop_context_mask(StopContextCategory::RouteModeTransition);
        if (s.rps_known && s.rps_value_known && (s.rps_tenths > 0) == s.rps_running &&
            s.lwt_known && s.target_known)
            mask |= stop_context_mask(StopContextCategory::LowRpsAboveMainTarget);
    }
    return mask;
}

// At most one final event per call. A generation/clock/gap boundary first seals the old pending
// event and then baselines this sample conservatively. Boot-ON and ON after a readable gap cannot
// create a population member: a new known OFF then witnessed ON is required. DHW-only/cooling-only
// runs are excluded. Recent Heating may qualify a mixed run's stop context; this NEVER reclassifies
// that run as a completed pure-heating run in the independent core cycling state machine.
inline StopContextEvent stop_context_step(StopContextState& st, const StopContextSample& s,
                                          int64_t now_us, uint32_t generation) noexcept {
    StopContextEvent out;
    if (!st.have_generation || st.source_generation != generation)
        out = stop_context_reset(st, generation);
    if (now_us < 0) {
        const StopContextEvent invalid =
            stop_context_reset(st, generation, StopContextFinish::ClockInvalid);
        return out.valid ? out : invalid;
    }
    if (st.last_sample_us >= 0 && now_us < st.last_sample_us)
        out = stop_context_reset(st, generation, StopContextFinish::ClockInvalid);
    const bool gap =
        (st.last_sample_us >= 0 && now_us - st.last_sample_us > STOP_CONTEXT_MAX_GAP_US) ||
        (st.last_rps_us >= 0 && now_us - st.last_rps_us > STOP_CONTEXT_MAX_GAP_US);
    if (gap) out = stop_context_reset(st, generation, StopContextFinish::Gap);

    const bool start =
        s.rps_known && s.rps_running && st.last_rps_us >= 0 && !st.last_rps_running && st.armed_off;
    const bool stop = s.rps_known && !s.rps_running && st.last_rps_us >= 0 && st.last_rps_running;
    if (start) {
        if (st.pending.valid)
            out = stop_context_finish(st, now_us > stop_context_deadline(st.pending)
                                              ? StopContextFinish::WindowEnd
                                              : StopContextFinish::Restart);
        // No previous run's positive/stability/coverage evidence enters the next run's window.
        stop_context_reset(st, generation);
        st.witnessed_run = true;
    }

    const uint8_t readable       = stop_context_readable(s);
    const uint8_t temperature    = stop_context_mask(StopContextCategory::LowRpsAboveMainTarget);
    const bool    have_pending   = st.pending.valid;
    const bool    at_or_past_end = have_pending && now_us >= stop_context_deadline(st.pending);
    const bool    in_window      = !have_pending || now_us <= stop_context_deadline(st.pending);
    // A poll just beyond +30 s can bracket the boundary for coverage when both endpoints were
    // readable and no >15 s gap occurred. Its NEW positives are outside the window and excluded.
    if (have_pending) st.pending.post_complete &= readable;

    for (size_t k = 0; k < STOP_CONTEXT_CATEGORIES; ++k) {
        if (!(readable & (1u << k)))
            st.readable_since_us[k] = -1;
        else if (st.readable_since_us[k] < 0)
            st.readable_since_us[k] = now_us;
    }
    if (!s.target_known)
        st.target_stable_us = -1;
    else {
        const bool changed = st.target_us >= 0 && s.target_tenths != st.target_tenths;
        if (changed) {
            st.target_changed_us = now_us;
            st.positive_us[0]    = -1;
            if (have_pending) {
                // A changed bracket endpoint cannot prove stability at the window boundary even
                // when that endpoint itself is later than +30 s.
                st.pending.post_complete &= static_cast<uint8_t>(~temperature);
                if (in_window) {
                    st.pending.positive &= static_cast<uint8_t>(~temperature);
                    st.pending.flags |= STOP_CONTEXT_F_TARGET_CHANGED;
                }
            }
        }
        if (changed || st.target_stable_us < 0) st.target_stable_us = now_us;
        st.target_us     = now_us;
        st.target_tenths = s.target_tenths;
    }

    uint8_t positive = 0;
    if (s.request != StopContextBit::Unknown) {
        if (s.request == StopContextBit::Off && st.request == StopContextBit::On &&
            stop_context_recent(st.request_us, now_us, STOP_CONTEXT_MAX_GAP_US))
            positive |= stop_context_mask(StopContextCategory::RequestWithdrawal);
        st.request    = s.request;
        st.request_us = now_us;
    }
    if (s.defrost == StopContextBit::On)
        positive |= stop_context_mask(StopContextCategory::Defrost);
    if (s.route != StopContextRoute::Unknown) {
        if (st.route != StopContextRoute::Unknown && s.route != st.route &&
            stop_context_recent(st.route_us, now_us, STOP_CONTEXT_MAX_GAP_US)) {
            positive |= stop_context_mask(StopContextCategory::RouteModeTransition);
            if (s.route == StopContextRoute::Dhw || st.route == StopContextRoute::Dhw)
                positive |= stop_context_mask(StopContextCategory::DhwTransition);
        }
        st.route    = s.route;
        st.route_us = now_us;
    }
    if (s.mode != StopContextMode::Unknown) {
        if (st.mode != StopContextMode::Unknown && s.mode != st.mode &&
            stop_context_recent(st.mode_us, now_us, STOP_CONTEXT_MAX_GAP_US)) {
            positive |= stop_context_mask(StopContextCategory::RouteModeTransition);
            if (s.mode == StopContextMode::Dhw || st.mode == StopContextMode::Dhw)
                positive |= stop_context_mask(StopContextCategory::DhwTransition);
        }
        st.mode    = s.mode;
        st.mode_us = now_us;
    }
    const bool heating = s.rps_known && s.rps_running && s.route == StopContextRoute::Space &&
                         s.mode == StopContextMode::Heating;
    if (heating) st.recent_heating_us = now_us;
    if (heating && (readable & temperature) && s.rps_tenths <= STOP_CONTEXT_LOW_RPS_TENTHS &&
        st.target_stable_us >= 0 && now_us - st.target_stable_us >= STOP_CONTEXT_TARGET_STABLE_US &&
        static_cast<int32_t>(s.lwt_tenths) - s.target_tenths >= STOP_CONTEXT_ABOVE_TARGET_TENTHS)
        positive |= temperature;
    if (in_window) {
        for (size_t k = 0; k < STOP_CONTEXT_CATEGORIES; ++k)
            if (positive & (1u << k)) st.positive_us[k] = now_us;
        if (have_pending) st.pending.positive |= positive;
    }

    if (stop && st.witnessed_run && stop_context_recent(st.recent_heating_us, now_us)) {
        st.pending                   = StopContextEvent{};
        st.pending.valid             = true;
        st.pending.stop_us           = now_us;
        st.pending.source_generation = generation;
        st.pending.post_complete     = readable;
        for (size_t k = 0; k < STOP_CONTEXT_CATEGORIES; ++k) {
            if (stop_context_recent(st.positive_us[k], now_us)) st.pending.positive |= 1u << k;
            if (now_us >= STOP_CONTEXT_WINDOW_US && st.readable_since_us[k] >= 0 &&
                st.readable_since_us[k] <= now_us - STOP_CONTEXT_WINDOW_US)
                st.pending.pre_complete |= 1u << k;
        }
        if (st.target_stable_us < 0 || now_us - st.target_stable_us < STOP_CONTEXT_TARGET_STABLE_US)
            st.pending.pre_complete &= static_cast<uint8_t>(~temperature);
        if (stop_context_recent(st.target_changed_us, now_us))
            st.pending.flags |= STOP_CONTEXT_F_TARGET_CHANGED;
        if (now_us > INT64_MAX - STOP_CONTEXT_WINDOW_US)
            st.pending.flags |= STOP_CONTEXT_F_TIME_OVERFLOW;
    }
    if (s.rps_known) {
        st.last_rps_us      = now_us;
        st.last_rps_running = s.rps_running;
        if (!s.rps_running) {
            st.armed_off     = true;
            st.witnessed_run = false;
        } else
            st.armed_off = false;
    }
    st.last_sample_us = now_us;
    if (at_or_past_end) {
        // Overflow truncates the requested window, so it can never claim complete coverage.
        const bool full_end = !(st.pending.flags & STOP_CONTEXT_F_TIME_OVERFLOW);
        out                 = stop_context_finish(st, StopContextFinish::WindowEnd, full_end);
    }
    return out;
}

} // namespace daik::logic
