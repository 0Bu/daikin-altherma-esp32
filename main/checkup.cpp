// The 24-hour plant diagnosis. Policy (which rows, what counts as an edge, the bucket math, the
// thresholds and the verdicts) lives in logic/checkup.hpp and is host-tested; this file is storage,
// one mutex, and the fold from a poll cycle into the open hour.
#include "checkup.hpp"
#include "diag_log.hpp"
#include "logic/checkup.hpp"
#include "logic/checkup_persist.hpp"  // WHEN a persisted window may be believed
#include "logic/crashinfo.hpp"        // crash_reason_slug — one reset vocabulary
#include "logic/history.hpp"     // history_parse_tenths — the ONE parse of a cached value
#include "safe_mode.hpp"         // safe_mode_active — nothing ages the window there
#include "mqtt_ha.hpp"           // independent circulation-pump electrical witness

#include "esp_attr.h"            // __NOINIT_ATTR — the whole of the restore rests on this attribute
#include "esp_system.h"          // esp_reset_reason
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard

#include <atomic>

namespace daik {

namespace {

// The two rings and their seal, in .noinit DRAM — see logic/checkup_persist.hpp. Not initialised at
// startup, which is the entire mechanism: whatever the previous boot left is what checkup_start()
// gets to judge. The in-flight states stay ORDINARY statics below and are deliberately never
// restored; a reboot is the discontinuity both step functions already handle.
struct PersistStore {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    uint32_t layout_fp;
    uint32_t model_fp;      // which unit the buckets describe (checked at detect, not here)
    int64_t  span_us;       // lifecycle observed up to the last commit, carried as a duration
    uint32_t crc;
    logic::CheckupRing  ring;
    logic::DhwLossRing  dhw;
};
__NOINIT_ATTR PersistStore s_store;

logic::CheckupRing& s_ring     = s_store.ring;
logic::DhwLossRing& s_dhw_ring = s_store.dhw;
logic::CheckupState s_state;
logic::DhwLossState s_dhw_state;

logic::CheckupRestore s_persist_verdict = logic::CheckupRestore::NoRecord;
// The first detection after an ADOPTED boot defers to the model check instead of wiping on sight.
bool s_adopt_detect_grace = false;
uint32_t s_model_fp = 0;
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

// WHAT THE SEAL COVERS — and the fields it deliberately does not.
//
// `pending` is EXCLUDED, for history.cpp's reason: it changes on every fold, i.e. once a second, so
// a seal covering it would be stale for all but microseconds of every hour — and a panic, the case
// this exists for most, would land in the stale window essentially always and discard a whole
// intact day. Excluded, the sealed bytes change only at a COMMIT, so the seal written after one
// stays valid right up to the next. The open hour is dropped on restore, which is the honest answer
// anyway: a partial hour was never a completed bucket.
//
// first/latest_sample_us are excluded because they are MONOTONIC and meaningless in the next boot's
// clock; the observed lifecycle rides as `span_us` instead.
uint32_t persist_crc() {
    uint32_t crc = CONFIG_CRC32_INIT;
    const auto& r = s_store.ring;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(r.buf), sizeof(r.buf));
    crc = config_crc32_update(crc, &r.count, sizeof(r.count));
    crc = config_crc32_update(crc, &r.head, sizeof(r.head));
    crc = config_crc32_update(crc, &r.age_buckets, sizeof(r.age_buckets));
    const auto& d = s_store.dhw;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(d.buf), sizeof(d.buf));
    crc = config_crc32_update(crc, &d.count, sizeof(d.count));
    crc = config_crc32_update(crc, &d.head, sizeof(d.head));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&s_store.span_us),
                              sizeof(s_store.span_us));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&s_store.model_fp),
                              sizeof(s_store.model_fp));
    return config_crc32_final(crc);
}

// Re-seal after a commit. The ONLY writer of the record's header, so the seal and the bytes it
// covers cannot drift apart.
void persist_seal() {
    s_store.magic     = logic::CHECKUP_PERSIST_MAGIC;
    s_store.version   = logic::CHECKUP_PERSIST_VERSION;
    s_store.reserved  = 0;
    s_store.layout_fp = logic::checkup_layout_fingerprint();
    s_store.model_fp  = s_model_fp;
    s_store.span_us   = s_ring.span_us();
    s_store.crc       = persist_crc();
}

void persist_wipe() {
    s_ring.reset();
    s_dhw_ring.reset();
    persist_seal();     // keeps s_model_fp: the identity belongs to what is recorded NEXT, and the
}                       // reset is consumed asynchronously, after checkup_reset_on_detect set it

bool apply_reset_locked() {
    if (!s_reset_requested.exchange(false)) return false;
    s_dhw_reset_requested.store(false);
    s_state = logic::CheckupState{};
    s_dhw_state = logic::DhwLossState{};
    s_cov = logic::CheckupCoverage{};
    s_fault_now = daik::FaultClass::Unknown;
    persist_wipe();     // clears both rings AND the record, so the next boot cannot re-adopt them
    return true;
}

bool apply_dhw_reset_locked() {
    if (!s_dhw_reset_requested.exchange(false)) return false;
    s_dhw_ring.reset();
    s_dhw_state = logic::DhwLossState{};
    persist_seal();
    return true;
}

} // namespace

// Judge what the previous boot left in .noinit. Called from app_main BEFORE any producer task
// exists, so the whole decision is single-threaded and needs no lock — the same property
// history_start() relies on.
void checkup_start() {
    const uint32_t want_fp = logic::checkup_layout_fingerprint();
    const uint32_t reason  = static_cast<uint32_t>(esp_reset_reason());
    s_persist_verdict = logic::checkup_restore_verdict(reason, s_store.magic, s_store.version,
                                                       s_store.layout_fp, want_fp,
                                                       s_store.crc, persist_crc(),
                                                       safe_mode_active());
    if (s_persist_verdict == logic::CheckupRestore::Accept) {
        // Adopt the completed buckets in place. The open hour is dropped (it is outside the seal),
        // the monotonic anchors restart, and the lifecycle the previous boot observed is carried
        // across as a duration — see CheckupRing::carried_span_us.
        s_ring.pending      = logic::CheckupBucket{};
        s_dhw_ring.pending  = logic::DhwLossBucket{};
        s_ring.first_sample_us  = -1;
        s_ring.latest_sample_us = -1;
        s_ring.carried_span_us  = s_store.span_us;
        s_model_fp = s_store.model_fp;
        s_adopt_detect_grace = true;
        diag_printf("checkup: window kept across a %s reset (%u h observed, RAM survived)\n",
                    crash_reason_slug(reason),
                    static_cast<unsigned>(s_store.span_us / 3600000000LL));
    } else {
        persist_wipe();
        // Not noise: "wrong_layout" after an update explains a card that emptied itself for a reason
        // nobody could otherwise reconstruct, and "bad_crc" on a board that was never power-cycled
        // is a memory fault worth seeing.
        diag_printf("checkup: window starts empty (%s)\n",
                    logic::checkup_restore_slug(s_persist_verdict));
    }
}

const char* checkup_persist_state() { return logic::checkup_restore_slug(s_persist_verdict); }

void checkup_reset() {
    // Do not create/take the mutex from the httpd task. The poll task remains its sole creator, and
    // only the record path consumes this request under that mutex; reports stay empty until then.
    s_reset_requested.store(true);
}

// Detection resolves a profile on EVERY boot — the model is RAM-only by design — so "detection
// resolved" is NOT evidence that the unit changed. Treating it as such was harmless while the window
// died at every reboot anyway; the moment .noinit carries it across, it would adopt the window at
// boot and throw it away four seconds later, on exactly the boards that have a heat pump attached.
// That is the defect history.cpp shipped and documented, avoided here rather than rediscovered.
//
// So the FIRST detection after an adopted boot compares the resolved profile against the one the
// record was written under and keeps the window only if it is the same unit. Every later call resets
// exactly as before, so a genuine re-detect, a link rewire or a /set_hp model change is unaffected.
void checkup_reset_on_detect(const char* profile_id) {
    const uint32_t fp = logic::checkup_model_fingerprint(profile_id);
    if (s_adopt_detect_grace) {
        s_adopt_detect_grace = false;
        if (fp == s_model_fp) {
            diag_printf("checkup: restored window belongs to this unit (%s) — kept\n",
                        profile_id ? profile_id : "?");
            return;
        }
        s_persist_verdict = logic::CheckupRestore::ModelChanged;
        diag_printf("checkup: restored window was another unit — discarded for %s\n",
                    profile_id ? profile_id : "?");
    }
    s_model_fp = fp;
    checkup_reset();
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
        persist_seal();          // the sealed bytes change ONLY here; see persist_crc()
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
