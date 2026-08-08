// The 24-hour plant diagnosis. Policy (which rows, what counts as an edge, the bucket math, the
// thresholds and the verdicts) lives in logic/checkup.hpp and is host-tested; this file is storage,
// one mutex, and the fold from a poll cycle into the open hour.
#include "checkup.hpp"
#include "diag_log.hpp"
#include "logic/checkup.hpp"
#include "logic/history.hpp"     // history_parse_tenths — the ONE parse of a cached value
#include "mqtt_ha.hpp"           // independent circulation-pump electrical witness

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard

#include <atomic>

namespace daik {

namespace {

logic::CheckupRing  s_ring;
logic::CheckupState s_state;
logic::DhwLossRing  s_dhw_ring;
logic::DhwLossState s_dhw_state;
// Capability of the CURRENT converter-adjudicated profile. hp_poll derives it from the profile rows,
// not from successful reads, so a timeout reduces evidence without pretending the feature vanished.
// Replacing instead of OR-latching it is important when model detection changes at runtime.
logic::CheckupCoverage s_cov;
daik::FaultClass      s_fault_now = daik::FaultClass::Unknown;
SemaphoreHandle_t     s_mtx = nullptr;
std::atomic<bool>     s_reset_requested{false};
std::atomic<bool>     s_dhw_reset_requested{false};

// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
// Everything inside a critical section in this file is a plain integer copy — nothing allocates —
// so the unwind safety is belt-and-braces here rather than the reason the guard is used.
using Lock = SemGuard;

// The row a locator addresses, or -1. Composes logic/checkup.hpp's pure predicate rather than taking
// the parallel-array checkup_select(): building (reg, off, conv) views for ~116 rows would cost a
// kilobyte of the POLL TASK's 8 KB stack every second, and the stack is the budget that fails
// silently on this board (CLAUDE.md → Memory constraints). checkup_select() still exists — it is what
// the catalog test sweeps the whole profile set with.
int find_row(const CachedValue* v, size_t n, const logic::CheckupLocator& l) {
    for (size_t i = 0; i < n; i++)
        if (logic::checkup_row_matches(l, v[i].reg, v[i].off, v[i].conv)) return static_cast<int>(i);
    return -1;
}

// A cached value as tenths of its unit. logic/history.hpp's parse, not a local strtod: the trends
// ask the same question of the same string one call later, and two parses that disagreed about, say,
// a non-numeric flag would make the observation counters and the charts describe different plants.
bool tenths(const CachedValue& cv, int& out) {
    return logic::history_parse_tenths(cv.value.c_str(), out);
}

// A BIT-FLAG row's state. Since #210 every flag reaches the cache as the numeric "1"/"0", so this is
// a plain parse — and a legacy textual "ON"/"OFF" is refused by the parse and reads as UNKNOWN,
// which is the safe direction: logic/checkup.hpp never folds unknown into off.
void flag_state(const CachedValue* v, size_t n, const logic::CheckupLocator& l,
                bool& known, bool& on) {
    known = false;
    on    = false;
    const int i = find_row(v, n, l);
    if (i < 0) return;
    int t = 0;
    if (!tenths(v[i], t)) return;
    known = true;
    on    = t > 0;
}

// A numeric row's reading in tenths.
bool reading(const CachedValue* v, size_t n, const logic::CheckupLocator& l, int& out) {
    const int i = find_row(v, n, l);
    if (i < 0) return false;
    return tenths(v[i], out);
}

bool apply_reset_locked() {
    if (!s_reset_requested.exchange(false)) return false;
    s_dhw_reset_requested.store(false);
    s_ring.reset();
    s_state = logic::CheckupState{};
    s_dhw_ring.reset();
    s_dhw_state = logic::DhwLossState{};
    s_cov = logic::CheckupCoverage{};
    s_fault_now = daik::FaultClass::Unknown;
    return true;
}

bool apply_dhw_reset_locked() {
    if (!s_dhw_reset_requested.exchange(false)) return false;
    s_dhw_ring.reset();
    s_dhw_state = logic::DhwLossState{};
    return true;
}

} // namespace

void checkup_reset() {
    // Do not create/take the mutex from the httpd task. The poll task remains its sole creator, and
    // only the record path consumes this request under that mutex; reports stay empty until then.
    s_reset_requested.store(true);
}

void checkup_dhw_reset() {
    s_dhw_reset_requested.store(true);
}

void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running,
                    const logic::CheckupCoverage& coverage) {
    if (!s_mtx) {
        s_mtx = xSemaphoreCreateMutex();           // created on the poll task, the only creator
        if (!s_mtx) {
            diag_printf("checkup: mutex alloc failed — observation disabled this boot\n");
            return;
        }
    }
    if (!v && n) return;

    logic::CheckupSample s;
    s.rps_known   = rps_known;
    s.rps_running = rps_running;

    flag_state(v, n, logic::CHECKUP_LOC_DEFROST, s.defrost_known, s.defrost_on);
    flag_state(v, n, logic::CHECKUP_LOC_PUMP,    s.pump_known,    s.pump_on);
    flag_state(v, n, logic::CHECKUP_LOC_BSH,     s.bsh_known,     s.bsh_on);
    flag_state(v, n, logic::CHECKUP_LOC_VALVE,   s.valve_known,   s.valve_dhw);
    // Either active step proves the aggregate BUH is on. Proving it is OFF needs every step carried
    // by this profile to be readable; one readable zero plus one timed-out step remains unknown.
    bool b1_known = false, b1_on = false, b2_known = false, b2_on = false;
    flag_state(v, n, logic::CHECKUP_LOC_BUH1, b1_known, b1_on);
    flag_state(v, n, logic::CHECKUP_LOC_BUH2, b2_known, b2_on);
    s.buh_on    = b1_on || b2_on;
    s.buh_known = s.buh_on ||
                  ((coverage.buh1 || coverage.buh2) &&
                   (!coverage.buh1 || b1_known) &&
                   (!coverage.buh2 || b2_known));

    s.bar_ok  = reading(v, n, logic::CHECKUP_LOC_PRESSURE, s.bar_tenths);
    s.flow_ok = reading(v, n, logic::CHECKUP_LOC_FLOW,     s.flow_tenths);
    s.r5t_ok  = reading(v, n, logic::CHECKUP_LOC_R5T,      s.r5t_tenths);
    const CirculationPumpSample circulation = circulation_pump_sample();
    s.circulation_configured = circulation.configured;
    s.circulation_known = circulation.known;
    s.circulation_on = circulation.on;
    s.retry_expected_mask = coverage.retry_mask;

    // Fault class is matched by converter because a profile carries it on the outdoor page AND the
    // hydronic one. Retry counters use exact page/offset/converter identities because conv 311 also
    // names unrelated values elsewhere. For faults the WORST readable class wins.
    uint8_t fault_rows_read = 0;
    for (size_t i = 0; i < n; i++) {
        const CachedValue& cv = v[i];
        if (logic::checkup_is_fault_class(cv.conv)) {
            const FaultClass c = fault_class_from_text(cv.value.c_str());
            if (c != FaultClass::Unknown && fault_rows_read < UINT8_MAX) fault_rows_read++;
            if (fault_error_active(c)) s.fault = FaultClass::Error;
            else if (fault_warning_active(c) && !fault_error_active(s.fault)) s.fault = c;
            else if (c == FaultClass::Normal && s.fault == FaultClass::Unknown) s.fault = c;
        }
        const int retry = logic::checkup_retry_index(cv.reg, cv.off, cv.conv);
        if (retry >= 0) {
            int t = 0;
            if (tenths(cv, t) && t % 10 == 0) {
                const int value = t / 10;
                if (value >= 0 && value <= 7) {
                    s.retry_known_mask |= static_cast<uint8_t>(1u << retry);
                    s.retry_value[static_cast<size_t>(retry)] = static_cast<uint8_t>(value);
                }
            }
        }
    }
    // An active class on either unit is still a finding. "Normal" requires every fault-class row
    // supplied by the profile; otherwise a timed-out outdoor page could be cleared by the indoor row.
    if (!fault_error_active(s.fault) && !fault_warning_active(s.fault) &&
        fault_rows_read < coverage.fault_rows)
        s.fault = FaultClass::Unknown;

    const int64_t  now    = esp_timer_get_time();
    const uint32_t bucket = logic::checkup_bucket(now);

    Lock lk(s_mtx);
    if (!lk.acquired()) return;

    // A request can arrive while an old-link sweep is in flight. If this cycle consumes it, discard
    // the whole sample after clearing state; otherwise the tail of old poll A would seed the window
    // that new-link poll B continues. Dropping at most the first new sample is the conservative side.
    if (apply_reset_locked()) return;
    const bool discard_dhw_sample = apply_dhw_reset_locked();
    s_cov       = coverage;
    s_fault_now = s.fault;
    s_ring.observe(now);

    // Close the old hour before folding the current sample. For a continuous boundary, zero only
    // the cross-boundary duration while retaining the prior tri-state witnesses: step() can then
    // place an edge/current fault in the NEW bucket without retaining old seconds beyond 24 h. A
    // long gap is left intact so step() rejects both elapsed time and edges and re-baselines here.
    if (s_state.have_bucket && bucket != s_state.bucket) {
        bool continuous_boundary = false;
        if (s_state.last_us >= 0 && now >= s_state.last_us) {
            const int64_t gap_us = now - s_state.last_us;
            continuous_boundary =
                gap_us <= static_cast<int64_t>(logic::CHECKUP_MAX_GAP_S) * 1000000;
        }
        const uint32_t skipped = logic::checkup_skipped(s_state.bucket, bucket);
        s_ring.commit(skipped);
        s_dhw_ring.commit(skipped);
        if (continuous_boundary) s_state.last_us = now; // dt=0, edge witnesses intentionally kept
        logic::checkup_step(s_state, s_ring.pending, s, now);
        if (!discard_dhw_sample)
            logic::dhw_loss_step(s_dhw_state, s_dhw_ring.pending, s, now);
    } else {
        logic::checkup_step(s_state, s_ring.pending, s, now);
        if (!discard_dhw_sample)
            logic::dhw_loss_step(s_dhw_state, s_dhw_ring.pending, s, now);
    }
    s_state.bucket      = bucket;
    s_state.have_bucket = true;
}

logic::CheckupReport checkup_report() {
    if (!s_mtx) return logic::CheckupReport{};
    Lock lk(s_mtx);
    if (!lk.acquired()) return logic::CheckupReport{};
    // Only the record path consumes a reset, because it can also discard the in-flight sample.
    // Until then expose an empty report, never stale identity A and never consume the guard early.
    if (s_reset_requested.load()) return logic::CheckupReport{};
    return logic::checkup_evaluate(
        logic::checkup_aggregate(s_ring), s_cov, s_fault_now,
        s_dhw_reset_requested.load() ? logic::DhwLossWindow{}
                                     : logic::dhw_loss_aggregate(s_dhw_ring));
}

} // namespace daik
