#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "checkup.hpp"
#include "stop_context.hpp"

namespace daik::logic {

// Per-run diagnostic context retained in RAM alongside CheckupCyclingTrace for X10A runs.
// Uses the same boot-relative monotonic second frame and provisional observation thresholds as
// stop_context.hpp without touching persisted flash-journal schemas.
constexpr size_t   CYCLING_RUN_CONTEXT_CAP         = 48;
constexpr int64_t  CYCLING_RUN_AFTER_DEFROST_US    = 600000000LL; // 10 min
constexpr int64_t  CYCLING_RUN_AFTER_DHW_US        = 900000000LL; // 15 min
constexpr int64_t  CYCLING_RUN_START_EVENT_US      = 30000000LL;  // 30 s pre-start window
constexpr int64_t  CYCLING_RUN_FLOW_WARMUP_US      = 30000000LL;  // 30 s pump/flow settling
constexpr int64_t  CYCLING_RUN_POST_REFINE_US      = STOP_CONTEXT_WINDOW_US;
constexpr int64_t  CYCLING_RUN_DEFROST_TAIL_MAX_US = 30000000LL; // 30 s startup tail cap
constexpr int64_t  CYCLING_RUN_DEFROST_CLEAR_US = 15000000LL; // 15 s continuous defrost-off confirm
constexpr uint32_t CYCLING_RUN_TYPICAL_MIN_DUR_S = 600; // >=10 min heating runs for typical flow

enum class CyclingRunMode : uint8_t { Unknown = 0, Space = 1, Dhw = 2, Cooling = 3, Other = 4 };

enum class CyclingStartKind : uint8_t {
    Unknown         = 0,
    CooldownRestart = 1,
    RequestOn       = 2,
    TargetRaised    = 3,
    AfterDefrost    = 4,
    AfterDhw        = 5,
    DefrostStart    = 6,
    DhwStart        = 7,
};

enum class CyclingStopKind : uint8_t {
    Unknown           = 0,
    LowRpsAboveTarget = 1,
    RequestWithdrawal = 2,
    TargetChanged     = 3,
    Defrost           = 4,
    DhwTransition     = 5,
    Normal            = 6,
};

constexpr uint8_t RUN_CTX_F_STOPPED           = 1u << 0;
constexpr uint8_t RUN_CTX_F_LOW_RPS_ABOVE_TGT = 1u << 1;

constexpr bool cycling_run_tenths_valid(int v) noexcept {
    return v > CHECKUP_ABSENT && v <= INT16_MAX;
}

inline const char* cycling_run_mode_name(CyclingRunMode m) noexcept {
    switch (m) {
    case CyclingRunMode::Space:
        return "space";
    case CyclingRunMode::Dhw:
        return "dhw";
    case CyclingRunMode::Cooling:
        return "cooling";
    case CyclingRunMode::Other:
        return "other";
    default:
        return "unknown";
    }
}

inline const char* cycling_start_kind_name(CyclingStartKind k) noexcept {
    switch (k) {
    case CyclingStartKind::CooldownRestart:
        return "cooldown_restart";
    case CyclingStartKind::RequestOn:
        return "request_on";
    case CyclingStartKind::TargetRaised:
        return "target_raised";
    case CyclingStartKind::AfterDefrost:
        return "after_defrost";
    case CyclingStartKind::AfterDhw:
        return "after_dhw";
    case CyclingStartKind::DefrostStart:
        return "defrost_start";
    case CyclingStartKind::DhwStart:
        return "dhw_start";
    default:
        return "unknown";
    }
}

inline const char* cycling_stop_kind_name(CyclingStopKind k) noexcept {
    switch (k) {
    case CyclingStopKind::LowRpsAboveTarget:
        return "low_rps_above_target";
    case CyclingStopKind::RequestWithdrawal:
        return "request_withdrawal";
    case CyclingStopKind::TargetChanged:
        return "target_changed";
    case CyclingStopKind::Defrost:
        return "defrost";
    case CyclingStopKind::DhwTransition:
        return "dhw_transition";
    case CyclingStopKind::Normal:
        return "normal";
    default:
        return "unknown";
    }
}

struct CyclingRunContext {
    uint32_t start_s               = 0;
    uint32_t stop_s                = 0;
    int16_t  start_lwt_tenths      = 0;
    int16_t  start_tgt_tenths      = 0;
    int16_t  start_tgt_prev_tenths = 0;
    int16_t  stop_lwt_tenths       = 0;
    int16_t  stop_rwt_tenths       = 0;
    int16_t  stop_tgt_tenths       = 0;
    int16_t  stop_tgt_prev_tenths  = 0;
    int16_t  flow_tenths           = 0;
    int16_t  outdoor_tenths        = 0;
    uint16_t min_rps_tenths        = 0;
    uint8_t  mode                  = 0;
    uint8_t  start_kind            = 0;
    uint8_t  stop_kind             = 0;
    uint8_t  flags                 = 0;
};
static_assert(sizeof(CyclingRunContext) == 32 &&
                  std::is_trivially_copyable<CyclingRunContext>::value &&
                  std::is_standard_layout<CyclingRunContext>::value,
              "CyclingRunContext must stay 32-byte POD");

constexpr CyclingRunContext cycling_run_context_empty() noexcept {
    CyclingRunContext c;
    c.start_lwt_tenths      = CHECKUP_ABSENT;
    c.start_tgt_tenths      = CHECKUP_ABSENT;
    c.start_tgt_prev_tenths = CHECKUP_ABSENT;
    c.stop_lwt_tenths       = CHECKUP_ABSENT;
    c.stop_rwt_tenths       = CHECKUP_ABSENT;
    c.stop_tgt_tenths       = CHECKUP_ABSENT;
    c.stop_tgt_prev_tenths  = CHECKUP_ABSENT;
    c.flow_tenths           = CHECKUP_ABSENT;
    c.outdoor_tenths        = CHECKUP_ABSENT;
    return c;
}

struct CyclingRunSample {
    StopContextSample base;
    bool              rwt_ok         = false;
    int16_t           rwt_tenths     = 0;
    bool              flow_ok        = false;
    int16_t           flow_tenths    = 0;
    bool              outdoor_ok     = false;
    int16_t           outdoor_tenths = 0;
};

struct CheckupRunContextTrace {
    CyclingRunContext entries[CYCLING_RUN_CONTEXT_CAP]{};
    uint16_t          head  = 0;
    uint16_t          count = 0;

    void reset() noexcept { head = count = 0; }

    const CyclingRunContext& at(size_t i) const noexcept {
        return entries[(head + CYCLING_RUN_CONTEXT_CAP - count + i) % CYCLING_RUN_CONTEXT_CAP];
    }

    void push(const CyclingRunContext& c) noexcept {
        entries[head] = c;
        head          = static_cast<uint16_t>((head + 1u) % CYCLING_RUN_CONTEXT_CAP);
        if (count < CYCLING_RUN_CONTEXT_CAP) ++count;
    }

    CyclingRunContext* latest_mut() noexcept {
        if (!count) return nullptr;
        const size_t idx = (head + CYCLING_RUN_CONTEXT_CAP - 1u) % CYCLING_RUN_CONTEXT_CAP;
        return &entries[idx];
    }
};

struct CheckupRunContextSnapshot {
    CyclingRunContext entries[CYCLING_RUN_CONTEXT_CAP]{};
    uint8_t           count               = 0;
    int16_t           flow_typical_tenths = 0;

    void reset() noexcept {
        count               = 0;
        flow_typical_tenths = CHECKUP_ABSENT;
    }
};

struct CyclingRunContextTracker {
    int64_t          last_sample_us            = 0;
    int64_t          last_rps_us               = 0;
    int64_t          request_on_us             = 0;
    int64_t          request_us                = 0;
    int64_t          target_us                 = 0;
    int64_t          target_stable_us          = 0;
    int64_t          target_raised_us          = 0;
    int64_t          last_stop_us              = 0;
    int64_t          run_start_us              = 0;
    int64_t          pending_stop_us           = 0;
    int64_t          run_defrost_us            = 0;
    int64_t          run_defrost_off_us        = 0;
    int64_t          run_dhw_hand_us           = 0;
    int64_t          run_tgt_drop_us           = 0;
    int64_t          run_req_off_us            = 0;
    int64_t          run_low_rps_us            = 0;
    uint32_t         source_generation         = 0;
    uint32_t         run_flow_sum              = 0;
    uint16_t         run_flow_cnt              = 0;
    uint32_t         all_flow_sum              = 0;
    uint16_t         all_flow_cnt              = 0;
    uint16_t         min_rps_settled           = 0;
    uint16_t         min_rps_any               = 0;
    int16_t          last_lwt_tenths           = 0;
    int16_t          last_rwt_tenths           = 0;
    int16_t          last_tgt_tenths           = 0;
    int16_t          raised_prev_t             = 0;
    int16_t          raised_to_t               = 0;
    int16_t          drop_prev_t               = 0;
    int16_t          drop_new_t                = 0;
    int16_t          last_outdoor_t            = 0;
    uint8_t          last_stop_mode            = 0;
    uint8_t          last_stop_kind            = 0;
    StopContextBit   last_request              = StopContextBit::Unknown;
    StopContextRoute last_route                = StopContextRoute::Unknown;
    StopContextMode  last_mode                 = StopContextMode::Unknown;
    bool             initialized               = false;
    bool             have_generation           = false;
    bool             prev_rps_known            = false;
    bool             prev_rps_running          = false;
    bool             last_rps_running          = false;
    bool             armed_off                 = false;
    bool             run_active                = false;
    bool             run_defrost_seen          = false;
    bool             run_started_after_defrost = false;
    bool             run_saw_space             = false;

    void reset(uint32_t generation = 0, bool keep_gen = false) noexcept {
        std::memset(this, 0, sizeof(*this));
        source_generation = generation;
        have_generation   = keep_gen;
    }

    void pause() noexcept { reset(source_generation, have_generation); }
};
static_assert(std::is_trivially_copyable<CyclingRunContextTracker>::value &&
                  std::is_standard_layout<CyclingRunContextTracker>::value,
              "CyclingRunContextTracker must stay POD");

inline void cycling_run_context_init_fields(CyclingRunContextTracker& st) noexcept {
    st.last_sample_us     = -1;
    st.last_rps_us        = -1;
    st.request_on_us      = -1;
    st.request_us         = -1;
    st.target_us          = -1;
    st.target_stable_us   = -1;
    st.target_raised_us   = -1;
    st.last_stop_us       = -1;
    st.run_start_us       = -1;
    st.pending_stop_us    = -1;
    st.run_defrost_us     = -1;
    st.run_defrost_off_us = -1;
    st.run_dhw_hand_us    = -1;
    st.run_tgt_drop_us    = -1;
    st.run_req_off_us     = -1;
    st.run_low_rps_us     = -1;
    st.last_lwt_tenths    = CHECKUP_ABSENT;
    st.last_rwt_tenths    = CHECKUP_ABSENT;
    st.last_tgt_tenths    = CHECKUP_ABSENT;
    st.raised_prev_t      = CHECKUP_ABSENT;
    st.raised_to_t        = CHECKUP_ABSENT;
    st.drop_prev_t        = CHECKUP_ABSENT;
    st.drop_new_t         = CHECKUP_ABSENT;
    st.last_outdoor_t     = CHECKUP_ABSENT;
    st.initialized        = true;
}

inline void cycling_run_context_reset_and_init(CyclingRunContextTracker& st, uint32_t generation,
                                               bool keep_gen) noexcept {
    st.reset(generation, keep_gen);
    cycling_run_context_init_fields(st);
}

inline CyclingRunMode cycling_run_classify_mode(const StopContextSample& s) noexcept {
    if (s.defrost == StopContextBit::On) return CyclingRunMode::Other;
    if (s.route == StopContextRoute::Dhw || s.mode == StopContextMode::Dhw)
        return CyclingRunMode::Dhw;
    if (s.mode == StopContextMode::Cooling && s.route != StopContextRoute::Dhw)
        return CyclingRunMode::Cooling;
    if (s.mode == StopContextMode::Heating && s.route == StopContextRoute::Space)
        return CyclingRunMode::Space;
    if (s.mode == StopContextMode::Other) return CyclingRunMode::Other;
    return CyclingRunMode::Unknown;
}

inline void cycling_run_clear_active(CyclingRunContextTracker& st) noexcept {
    st.run_active                = false;
    st.run_start_us              = -1;
    st.run_defrost_us            = -1;
    st.run_defrost_off_us        = -1;
    st.run_dhw_hand_us           = -1;
    st.run_tgt_drop_us           = -1;
    st.run_req_off_us            = -1;
    st.run_low_rps_us            = -1;
    st.run_flow_sum              = 0;
    st.run_flow_cnt              = 0;
    st.all_flow_sum              = 0;
    st.all_flow_cnt              = 0;
    st.min_rps_settled           = 0;
    st.min_rps_any               = 0;
    st.drop_prev_t               = CHECKUP_ABSENT;
    st.drop_new_t                = CHECKUP_ABSENT;
    st.run_defrost_seen          = false;
    st.run_started_after_defrost = false;
    st.run_saw_space             = false;
}

inline uint8_t cycling_stop_priority(CyclingStopKind k) noexcept {
    switch (k) {
    case CyclingStopKind::Defrost:
        return 6;
    case CyclingStopKind::DhwTransition:
        return 5;
    case CyclingStopKind::TargetChanged:
        return 4;
    case CyclingStopKind::LowRpsAboveTarget:
        return 3;
    case CyclingStopKind::RequestWithdrawal:
        return 2;
    case CyclingStopKind::Normal:
        return 1;
    default:
        return 0;
    }
}

inline void cycling_run_context_expire(CyclingRunContextTracker& st, int64_t now_us) noexcept {
    if (!st.initialized) return;
    if (now_us < 0 || (st.last_sample_us >= 0 && now_us < st.last_sample_us)) {
        st.reset(st.source_generation, st.have_generation);
        return;
    }
    if ((st.last_sample_us >= 0 && now_us - st.last_sample_us > STOP_CONTEXT_MAX_GAP_US) ||
        (st.last_rps_us >= 0 && now_us - st.last_rps_us > STOP_CONTEXT_MAX_GAP_US)) {
        st.reset(st.source_generation, st.have_generation);
        return;
    }
    if (st.pending_stop_us >= 0 && now_us - st.pending_stop_us >= CYCLING_RUN_POST_REFINE_US) {
        st.pending_stop_us = -1;
    }
}

inline void cycling_run_context_step(CyclingRunContextTracker& st, CheckupRunContextTrace& trace,
                                     const CyclingRunSample& s, int64_t now_us,
                                     uint32_t generation) noexcept {
    if (!st.have_generation || st.source_generation != generation) {
        cycling_run_context_reset_and_init(st, generation, true);
        trace.reset();
    } else if (!st.initialized) {
        cycling_run_context_init_fields(st);
    }
    if (now_us < 0 || static_cast<uint64_t>(now_us / 1000000) > CheckupCyclingTrace::max_second ||
        (st.last_sample_us >= 0 && now_us < st.last_sample_us)) {
        cycling_run_context_reset_and_init(st, generation, true);
        return;
    }
    const bool gap =
        (st.last_sample_us >= 0 && now_us - st.last_sample_us > STOP_CONTEXT_MAX_GAP_US) ||
        (st.last_rps_us >= 0 && now_us - st.last_rps_us > STOP_CONTEXT_MAX_GAP_US);
    if (gap) {
        // Re-baseline safely across gaps without fabricating a stop or carry-over run context.
        cycling_run_context_reset_and_init(st, generation, true);
    }

    const StopContextSample& b     = s.base;
    const bool               start = !gap && b.rps_known && b.rps_running && st.prev_rps_known &&
                       !st.prev_rps_running && st.armed_off;
    const bool stop = !gap && st.run_active && b.rps_known && !b.rps_running &&
                      st.last_rps_us >= 0 && st.last_rps_running;

    // Update target & request edges before judging `start` so same-poll events register on the run.
    bool req_off_edge = false;
    if (b.request != StopContextBit::Unknown) {
        if (b.request == StopContextBit::On && st.last_request == StopContextBit::Off &&
            stop_context_recent(st.request_us, now_us, STOP_CONTEXT_MAX_GAP_US)) {
            st.request_on_us = now_us;
        } else if (b.request == StopContextBit::Off && st.last_request == StopContextBit::On &&
                   stop_context_recent(st.request_us, now_us, STOP_CONTEXT_MAX_GAP_US)) {
            req_off_edge = true;
            if (st.run_active ||
                (st.pending_stop_us >= 0 &&
                 stop_context_recent(st.pending_stop_us, now_us, CYCLING_RUN_POST_REFINE_US))) {
                st.run_req_off_us = now_us;
            }
        }
        st.last_request = b.request;
        st.request_us   = now_us;
    }

    if (b.target_known && cycling_run_tenths_valid(b.target_tenths)) {
        const bool changed = st.target_us >= 0 && b.target_tenths != st.last_tgt_tenths;
        if (changed) {
            st.run_low_rps_us = -1;
            if (b.target_tenths > st.last_tgt_tenths) {
                st.target_raised_us = now_us;
                st.raised_prev_t    = st.last_tgt_tenths;
                st.raised_to_t      = b.target_tenths;
            } else if (st.run_active || (st.pending_stop_us >= 0 &&
                                         stop_context_recent(st.pending_stop_us, now_us,
                                                             CYCLING_RUN_POST_REFINE_US))) {
                st.run_tgt_drop_us = now_us;
                st.drop_prev_t     = st.last_tgt_tenths;
                st.drop_new_t      = b.target_tenths;
            }
            st.target_stable_us = now_us;
        } else if (st.target_stable_us < 0) {
            st.target_stable_us = now_us;
        }
        st.target_us       = now_us;
        st.last_tgt_tenths = b.target_tenths;
    } else if (!b.target_known) {
        st.target_stable_us = -1;
    }

    if (b.lwt_known && cycling_run_tenths_valid(b.lwt_tenths)) st.last_lwt_tenths = b.lwt_tenths;
    if (s.rwt_ok && cycling_run_tenths_valid(s.rwt_tenths)) st.last_rwt_tenths = s.rwt_tenths;
    if (s.outdoor_ok && cycling_run_tenths_valid(s.outdoor_tenths))
        st.last_outdoor_t = s.outdoor_tenths;

    const CyclingRunMode cur_mode = cycling_run_classify_mode(b);

    if (start) {
        cycling_run_clear_active(st);
        st.pending_stop_us = -1;
        st.run_active      = true;
        st.run_start_us    = now_us;

        CyclingRunContext entry = cycling_run_context_empty();
        entry.start_s           = static_cast<uint32_t>(now_us / 1000000);
        entry.start_lwt_tenths  = st.last_lwt_tenths;
        entry.start_tgt_tenths  = st.last_tgt_tenths;
        entry.outdoor_tenths    = st.last_outdoor_t;
        entry.mode              = static_cast<uint8_t>(cur_mode);

        CyclingStartKind sk = CyclingStartKind::Unknown;
        const bool       after_defrost =
            st.last_stop_us >= 0 &&
            stop_context_recent(st.last_stop_us, now_us, CYCLING_RUN_AFTER_DEFROST_US) &&
            (st.last_stop_mode == static_cast<uint8_t>(CyclingRunMode::Other) ||
             st.last_stop_kind == static_cast<uint8_t>(CyclingStopKind::Defrost));
        st.run_started_after_defrost = after_defrost;
        const bool after_dhw =
            st.last_stop_us >= 0 &&
            stop_context_recent(st.last_stop_us, now_us, CYCLING_RUN_AFTER_DHW_US) &&
            (st.last_stop_mode == static_cast<uint8_t>(CyclingRunMode::Dhw) ||
             st.last_stop_kind == static_cast<uint8_t>(CyclingStopKind::DhwTransition));

        if (b.defrost == StopContextBit::On) {
            sk         = CyclingStartKind::DefrostStart;
            entry.mode = static_cast<uint8_t>(CyclingRunMode::Other);
        } else if (cur_mode == CyclingRunMode::Dhw) {
            sk = CyclingStartKind::DhwStart;
        } else if (after_defrost && cur_mode == CyclingRunMode::Space) {
            sk = CyclingStartKind::AfterDefrost;
        } else if (after_dhw && cur_mode == CyclingRunMode::Space) {
            sk = CyclingStartKind::AfterDhw;
        } else if (st.request_on_us >= 0 &&
                   stop_context_recent(st.request_on_us, now_us, CYCLING_RUN_START_EVENT_US)) {
            sk = CyclingStartKind::RequestOn;
        } else if (st.target_raised_us >= 0 &&
                   stop_context_recent(st.target_raised_us, now_us, CYCLING_RUN_START_EVENT_US) &&
                   st.last_tgt_tenths >= st.raised_to_t) {
            sk                          = CyclingStartKind::TargetRaised;
            entry.start_tgt_prev_tenths = st.raised_prev_t;
            entry.start_tgt_tenths      = st.raised_to_t;
        } else if (st.last_request == StopContextBit::On &&
                   entry.start_lwt_tenths != CHECKUP_ABSENT &&
                   entry.start_tgt_tenths != CHECKUP_ABSENT &&
                   entry.start_lwt_tenths < entry.start_tgt_tenths) {
            sk = CyclingStartKind::CooldownRestart;
        }
        entry.start_kind = static_cast<uint8_t>(sk);
        trace.push(entry);
    }

    if (st.run_active && b.rps_known && b.rps_running) {
        if (b.defrost == StopContextBit::On) {
            st.run_defrost_seen   = true;
            st.run_defrost_us     = now_us;
            st.run_defrost_off_us = -1;
        } else if (st.run_defrost_seen && b.defrost == StopContextBit::Off) {
            if (st.run_defrost_off_us < 0) st.run_defrost_off_us = now_us;
            if ((cur_mode == CyclingRunMode::Space || cur_mode == CyclingRunMode::Dhw) &&
                st.run_defrost_us >= st.run_start_us &&
                (st.run_defrost_us - st.run_start_us) <= CYCLING_RUN_DEFROST_TAIL_MAX_US &&
                (now_us - st.run_defrost_off_us) >= CYCLING_RUN_DEFROST_CLEAR_US) {
                st.run_defrost_seen   = false;
                st.run_defrost_us     = -1;
                st.run_defrost_off_us = -1;
                if (CyclingRunContext* cur = trace.latest_mut()) {
                    cur->mode = static_cast<uint8_t>(cur_mode);
                    if (cur->start_kind == static_cast<uint8_t>(CyclingStartKind::DefrostStart)) {
                        cur->start_kind = static_cast<uint8_t>(
                            cur_mode == CyclingRunMode::Dhw
                                ? CyclingStartKind::DhwStart
                                : (st.run_started_after_defrost ? CyclingStartKind::AfterDefrost
                                                                : CyclingStartKind::Unknown));
                    }
                }
            }
        }
        if (cur_mode == CyclingRunMode::Space) st.run_saw_space = true;
        if (st.run_saw_space &&
            (b.route == StopContextRoute::Dhw || b.mode == StopContextMode::Dhw)) {
            st.run_dhw_hand_us = now_us;
        }

        if (CyclingRunContext* cur = trace.latest_mut()) {
            const int64_t elapsed = now_us - st.run_start_us;
            if (cur->start_lwt_tenths == CHECKUP_ABSENT && st.last_lwt_tenths != CHECKUP_ABSENT &&
                elapsed <= 5000000LL)
                cur->start_lwt_tenths = st.last_lwt_tenths;
            if (cur->start_tgt_tenths == CHECKUP_ABSENT && st.last_tgt_tenths != CHECKUP_ABSENT &&
                elapsed <= 5000000LL)
                cur->start_tgt_tenths = st.last_tgt_tenths;
            if (st.last_outdoor_t != CHECKUP_ABSENT) cur->outdoor_tenths = st.last_outdoor_t;

            if (st.run_defrost_seen) {
                cur->mode = static_cast<uint8_t>(CyclingRunMode::Other);
                if (elapsed <= 15000000LL &&
                    cur->start_kind == static_cast<uint8_t>(CyclingStartKind::Unknown))
                    cur->start_kind = static_cast<uint8_t>(CyclingStartKind::DefrostStart);
            } else if (cur_mode != CyclingRunMode::Unknown) {
                // Keep Space identity on Space -> DHW handover so the stop reads as DhwTransition.
                if (!(cur->mode == static_cast<uint8_t>(CyclingRunMode::Space) &&
                      cur_mode == CyclingRunMode::Dhw)) {
                    cur->mode = static_cast<uint8_t>(cur_mode);
                }
                if (elapsed <= 15000000LL && cur_mode == CyclingRunMode::Dhw &&
                    cur->start_kind == static_cast<uint8_t>(CyclingStartKind::Unknown))
                    cur->start_kind = static_cast<uint8_t>(CyclingStartKind::DhwStart);
            }

            if (b.rps_value_known && b.rps_tenths > 0) {
                if (st.min_rps_any == 0 || b.rps_tenths < st.min_rps_any)
                    st.min_rps_any = b.rps_tenths;
                if (elapsed >= CYCLING_RUN_FLOW_WARMUP_US &&
                    (st.min_rps_settled == 0 || b.rps_tenths < st.min_rps_settled))
                    st.min_rps_settled = b.rps_tenths;
            }

            if (s.flow_ok && s.flow_tenths > 0) {
                st.all_flow_sum += static_cast<uint32_t>(s.flow_tenths);
                st.all_flow_cnt += 1u;
                if (elapsed >= CYCLING_RUN_FLOW_WARMUP_US) {
                    st.run_flow_sum += static_cast<uint32_t>(s.flow_tenths);
                    st.run_flow_cnt += 1u;
                }
            }

            const bool heating_now = b.route == StopContextRoute::Space &&
                                     b.mode == StopContextMode::Heating && !st.run_defrost_seen;
            if (heating_now && b.rps_value_known && b.rps_tenths > 0 &&
                b.rps_tenths <= STOP_CONTEXT_LOW_RPS_TENTHS && b.lwt_known && b.target_known &&
                st.target_stable_us >= 0 &&
                now_us - st.target_stable_us >= STOP_CONTEXT_TARGET_STABLE_US &&
                static_cast<int32_t>(b.lwt_tenths) - b.target_tenths >=
                    STOP_CONTEXT_ABOVE_TARGET_TENTHS) {
                st.run_low_rps_us = now_us;
            }
        }
    }

    if (stop) {
        if (b.defrost == StopContextBit::On) {
            st.run_defrost_seen = true;
            st.run_defrost_us   = now_us;
        }
        if (st.run_saw_space &&
            (b.route == StopContextRoute::Dhw || b.mode == StopContextMode::Dhw)) {
            st.run_dhw_hand_us = now_us;
        }
        if (CyclingRunContext* cur = trace.latest_mut()) {
            cur->stop_s          = static_cast<uint32_t>(now_us / 1000000);
            cur->stop_lwt_tenths = st.last_lwt_tenths;
            cur->stop_rwt_tenths = st.last_rwt_tenths;
            cur->stop_tgt_tenths = st.last_tgt_tenths;
            cur->min_rps_tenths  = st.min_rps_settled ? st.min_rps_settled : st.min_rps_any;
            if (st.last_outdoor_t != CHECKUP_ABSENT) cur->outdoor_tenths = st.last_outdoor_t;
            if (st.run_flow_cnt > 0) {
                cur->flow_tenths = static_cast<int16_t>((st.run_flow_sum + st.run_flow_cnt / 2u) /
                                                        st.run_flow_cnt);
            } else if (st.all_flow_cnt > 0) {
                cur->flow_tenths = static_cast<int16_t>((st.all_flow_sum + st.all_flow_cnt / 2u) /
                                                        st.all_flow_cnt);
            } else if (s.flow_ok && cycling_run_tenths_valid(s.flow_tenths) && s.flow_tenths >= 0) {
                cur->flow_tenths = s.flow_tenths;
            }
            cur->flags |= RUN_CTX_F_STOPPED;

            const bool low_rps_recent = stop_context_recent(st.run_low_rps_us, now_us);
            if (low_rps_recent && cur->mode == static_cast<uint8_t>(CyclingRunMode::Space))
                cur->flags |= RUN_CTX_F_LOW_RPS_ABOVE_TGT;

            CyclingStopKind sk = CyclingStopKind::Unknown;
            if (cur->mode == static_cast<uint8_t>(CyclingRunMode::Other) && st.run_defrost_seen) {
                sk = CyclingStopKind::Defrost;
            } else if (stop_context_recent(st.run_defrost_us, now_us)) {
                sk = CyclingStopKind::Defrost;
            } else if (stop_context_recent(st.run_dhw_hand_us, now_us)) {
                sk = CyclingStopKind::DhwTransition;
            } else if (stop_context_recent(st.run_tgt_drop_us, now_us)) {
                sk                        = CyclingStopKind::TargetChanged;
                cur->stop_tgt_prev_tenths = st.drop_prev_t;
                cur->stop_tgt_tenths      = st.drop_new_t;
            } else if (cur->flags & RUN_CTX_F_LOW_RPS_ABOVE_TGT) {
                sk = CyclingStopKind::LowRpsAboveTarget;
            } else if (stop_context_recent(st.run_req_off_us, now_us)) {
                sk = CyclingStopKind::RequestWithdrawal;
            } else if (cur->mode != static_cast<uint8_t>(CyclingRunMode::Unknown)) {
                sk = CyclingStopKind::Normal;
            }
            cur->stop_kind    = static_cast<uint8_t>(sk);
            st.last_stop_us   = now_us;
            st.last_stop_mode = cur->mode;
            st.last_stop_kind = cur->stop_kind;
        }
        cycling_run_clear_active(st);
        st.pending_stop_us = now_us;
    } else if (st.pending_stop_us >= 0) {
        if (now_us - st.pending_stop_us <= CYCLING_RUN_POST_REFINE_US) {
            CyclingRunContext* cur = trace.latest_mut();
            if (cur && (cur->flags & RUN_CTX_F_STOPPED)) {
                CyclingStopKind post = CyclingStopKind::Unknown;
                if (b.defrost == StopContextBit::On) {
                    post = CyclingStopKind::Defrost;
                } else if (cur->mode == static_cast<uint8_t>(CyclingRunMode::Space) &&
                           (b.route == StopContextRoute::Dhw || b.mode == StopContextMode::Dhw)) {
                    post = CyclingStopKind::DhwTransition;
                } else if (st.run_tgt_drop_us >= st.pending_stop_us) {
                    post = CyclingStopKind::TargetChanged;
                } else if (req_off_edge) {
                    post = CyclingStopKind::RequestWithdrawal;
                }
                if (cycling_stop_priority(post) >
                    cycling_stop_priority(static_cast<CyclingStopKind>(cur->stop_kind))) {
                    cur->stop_kind = static_cast<uint8_t>(post);
                    if (post == CyclingStopKind::TargetChanged) {
                        cur->flags &= static_cast<uint8_t>(~RUN_CTX_F_LOW_RPS_ABOVE_TGT);
                        cur->stop_tgt_prev_tenths = st.drop_prev_t;
                        cur->stop_tgt_tenths      = st.drop_new_t;
                    }
                    st.last_stop_kind = cur->stop_kind;
                }
            }
        } else {
            st.pending_stop_us = -1;
        }
    }

    if (b.route != StopContextRoute::Unknown) st.last_route = b.route;
    if (b.mode != StopContextMode::Unknown) st.last_mode = b.mode;
    st.prev_rps_known   = b.rps_known;
    st.prev_rps_running = b.rps_running;
    if (b.rps_known) {
        st.last_rps_us      = now_us;
        st.last_rps_running = b.rps_running;
        if (!b.rps_running)
            st.armed_off = true;
        else
            st.armed_off = false;
    }
    st.last_sample_us = now_us;
}

inline void cycling_run_context_snapshot(CheckupRunContextSnapshot&    out,
                                         const CheckupRunContextTrace& trace,
                                         uint32_t                      boot_s) noexcept {
    out.reset();
    const int64_t live_offset = static_cast<int64_t>(CHECKUP_WINDOW_S) - boot_s;
    int16_t       long_flows[CYCLING_RUN_CONTEXT_CAP]{};
    size_t        flow_count = 0;

    for (size_t i = 0; i < trace.count && out.count < CYCLING_RUN_CONTEXT_CAP; ++i) {
        const CyclingRunContext& src = trace.at(i);
        if (src.start_s > boot_s) continue;
        const int64_t win_start = live_offset + static_cast<int64_t>(src.start_s);
        if (win_start < 0 || win_start > CHECKUP_WINDOW_S) continue;

        CyclingRunContext& dst = out.entries[out.count];
        dst                    = src;
        dst.start_s            = static_cast<uint32_t>(win_start);
        if (dst.flags & RUN_CTX_F_STOPPED) {
            if (src.stop_s <= boot_s && src.stop_s >= src.start_s) {
                const int64_t win_stop = live_offset + static_cast<int64_t>(src.stop_s);
                dst.stop_s             = win_stop > CHECKUP_WINDOW_S ? CHECKUP_WINDOW_S
                                                                     : static_cast<uint32_t>(win_stop);
                if (dst.mode == static_cast<uint8_t>(CyclingRunMode::Space) &&
                    dst.stop_s >= dst.start_s &&
                    (dst.stop_s - dst.start_s) >= CYCLING_RUN_TYPICAL_MIN_DUR_S &&
                    dst.flow_tenths != CHECKUP_ABSENT && dst.flow_tenths > 0) {
                    long_flows[flow_count++] = dst.flow_tenths;
                }
            } else {
                dst.flags &= static_cast<uint8_t>(~RUN_CTX_F_STOPPED);
                dst.stop_s    = 0;
                dst.stop_kind = 0;
            }
        }
        ++out.count;
    }

    if (flow_count > 0) {
        for (size_t i = 1; i < flow_count; ++i) {
            const int16_t key = long_flows[i];
            size_t        j   = i;
            while (j > 0 && long_flows[j - 1] > key) {
                long_flows[j] = long_flows[j - 1];
                --j;
            }
            long_flows[j] = key;
        }
        if (flow_count % 2 == 1) {
            out.flow_typical_tenths = long_flows[flow_count / 2];
        } else {
            out.flow_typical_tenths =
                static_cast<int16_t>((static_cast<int32_t>(long_flows[flow_count / 2 - 1]) +
                                      static_cast<int32_t>(long_flows[flow_count / 2])) /
                                     2);
        }
    }
}

} // namespace daik::logic
