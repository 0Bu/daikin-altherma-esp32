// The 24-hour plant health checkup. Policy (which rows, what counts as an edge, the bucket math, the
// thresholds and the verdicts) lives in logic/checkup.hpp and is host-tested; this file is storage,
// one mutex, and the fold from a poll cycle into the open hour.
#include "checkup.hpp"
#include "diag_log.hpp"
#include "logic/checkup.hpp"
#include "logic/history.hpp"     // history_parse_tenths — the ONE parse of a cached value

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

namespace daik {

namespace {

logic::CheckupRing  s_ring;
logic::CheckupState s_state;
// Which inputs this profile has EVER supplied. Accumulated rather than re-derived per cycle: a page
// that times out for one sweep leaves its rows out of the cache entirely (hp_poll only caches rows
// whose register answered), so a per-cycle reading of coverage would flip a check to "unavailable"
// on every dropped frame and then back — which is a broken bus reported as a missing feature.
//
// It is NOT reset when the model changes, and that is safe for a reason the trend rings could not
// claim: a trend addresses its row by (reg, offset, UNIT), which can land on a different quantity in
// another profile, while a health locator carries the CONVERTER too. (0x60, 12, 304) is "BUH Step1"
// on every profile that has it — the catalog test asserts exactly that, per locator, across the
// whole catalog — so a re-detected model cannot silently re-point one of these at something else.
logic::CheckupCoverage s_cov;
daik::FaultClass      s_fault_now = daik::FaultClass::Unknown;
SemaphoreHandle_t     s_mtx = nullptr;

// RAII lock, same idiom as history.cpp/hp_poll.cpp. Everything inside a critical section here is a
// plain integer copy — nothing allocates, so an unwind cannot strand the mutex.
struct Lock {
    SemaphoreHandle_t m;
    bool held;
    explicit Lock(SemaphoreHandle_t mtx) : m(mtx), held(mtx && xSemaphoreTake(mtx, portMAX_DELAY) == pdTRUE) {}
    ~Lock() { if (held) xSemaphoreGive(m); }
    Lock(const Lock&) = delete;
    Lock& operator=(const Lock&) = delete;
};

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
// a non-numeric flag would make the health counters and the charts describe different plants.
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

// A numeric row's reading in tenths. `require_live` drops a value the outdoor unit is no longer
// refreshing (CachedValue::held, logic/ou_stale.hpp) — used for outdoor air, where a held-over
// number would otherwise decide whether a defrost happened above the frost line.
bool reading(const CachedValue* v, size_t n, const logic::CheckupLocator& l, int& out,
             bool require_live = false) {
    const int i = find_row(v, n, l);
    if (i < 0) return false;
    if (require_live && v[i].held) return false;
    return tenths(v[i], out);
}

} // namespace

void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running) {
    if (!s_mtx) {
        s_mtx = xSemaphoreCreateMutex();           // created on the poll task, the only creator
        if (!s_mtx) {
            diag_printf("health: mutex alloc failed — checkup disabled this boot\n");
            return;
        }
    }
    if (!v || !n) return;

    logic::CheckupSample s;
    s.rps_known   = rps_known;
    s.rps_running = rps_running;

    flag_state(v, n, logic::CHECKUP_LOC_DEFROST, s.defrost_known, s.defrost_on);
    flag_state(v, n, logic::CHECKUP_LOC_PUMP,    s.pump_known,    s.pump_on);
    flag_state(v, n, logic::CHECKUP_LOC_BSH,     s.bsh_known,     s.bsh_on);
    // Either step is "the backup heater is on": step 2 without step 1 is not a state this plant
    // reaches, but reading them as one flag means a model that only reports one still counts.
    bool b1_known = false, b1_on = false, b2_known = false, b2_on = false;
    flag_state(v, n, logic::CHECKUP_LOC_BUH1, b1_known, b1_on);
    flag_state(v, n, logic::CHECKUP_LOC_BUH2, b2_known, b2_on);
    s.buh_known = b1_known || b2_known;
    s.buh_on    = b1_on || b2_on;

    s.bar_ok  = reading(v, n, logic::CHECKUP_LOC_PRESSURE, s.bar_tenths);
    s.flow_ok = reading(v, n, logic::CHECKUP_LOC_FLOW,     s.flow_tenths);
    s.oat_ok  = reading(v, n, logic::CHECKUP_LOC_OUTDOOR,  s.oat_tenths, /*require_live=*/true);

    // The fault class and the retry counters are matched by CONVERTER, not by a locator: a profile
    // carries an error class on the outdoor page AND on the hydronic one, and a fault on either unit
    // is a fault. The WORST class wins — reporting the hydronic "Normal" while the outdoor unit says
    // "Error" would be a clean bill of health issued by the half that is fine.
    bool have_rps_row = false;
    bool have_fault_row = false, have_retry_row = false;
    for (size_t i = 0; i < n; i++) {
        const CachedValue& cv = v[i];
        if (logic::ou_is_rps_witness(cv.label.c_str(), cv.reg)) have_rps_row = true;
        if (logic::checkup_is_fault_class(cv.conv)) {
            have_fault_row = true;
            const FaultClass c = fault_class_from_text(cv.value.c_str());
            if (fault_error_active(c)) s.fault = FaultClass::Error;
            else if (fault_warning_active(c) && !fault_error_active(s.fault)) s.fault = c;
            else if (c == FaultClass::Normal && s.fault == FaultClass::Unknown) s.fault = c;
        }
        if (logic::checkup_is_retry_counter(cv.conv)) {
            have_retry_row = true;
            int t = 0;
            if (tenths(cv, t)) {
                s.retry_known = true;
                if (t > s.retry_max_tenths) s.retry_max_tenths = t;
            }
        }
    }

    const int64_t  now    = esp_timer_get_time();
    const uint32_t bucket = logic::checkup_bucket(now);

    Lock lk(s_mtx);
    if (!lk.held) return;

    // Coverage is what the profile CAN supply, accumulated over the boot (see the note beside s_cov).
    s_cov.rps      |= have_rps_row;
    s_cov.defrost  |= s.defrost_known;
    s_cov.heater   |= s.buh_known || s.bsh_known;
    s_cov.pump     |= s.pump_known;
    s_cov.pressure |= s.bar_ok;
    s_cov.flow     |= s.flow_ok;
    s_cov.fault    |= have_fault_row;
    s_cov.retries  |= have_retry_row;
    s_fault_now     = s.fault;

    // Crossing into a new hour closes the open bucket; whole hours with no cycle at all are pushed
    // EMPTY (logic/checkup.hpp), which is what keeps `covered_s` an honest count of observed time.
    if (s_state.have_bucket && bucket != s_state.bucket)
        s_ring.commit(logic::checkup_skipped(s_state.bucket, bucket));
    s_state.bucket      = bucket;
    s_state.have_bucket = true;

    logic::checkup_step(s_state, s_ring.pending, s, now);
}

logic::CheckupReport checkup_report() {
    if (!s_mtx) return logic::CheckupReport{};
    Lock lk(s_mtx);
    if (!lk.held) return logic::CheckupReport{};
    return logic::checkup_evaluate(logic::checkup_aggregate(s_ring), s_cov, s_fault_now);
}

} // namespace daik
