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
// gets to judge. Edge state stays an ordinary static and is never restored.  The DHW level-window
// state is also reconstructed into an ordinary static, but only from the separately sealed one-shot
// handoff an intentional esp_restart writes below.
struct PersistedDhwHandoff {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    uint32_t layout_fp;
    uint32_t model_fp;
    uint32_t crc;
    logic::DhwLossHandoffPayload payload;
};

struct PersistedCheckup {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    uint32_t layout_fp;
    uint32_t model_fp;      // which unit the buckets describe (checked at detect, not here)
    uint32_t diagnostics_generation; // consent interval; old intervals never cross a new enable
    int64_t  span_us;       // lifecycle observed up to the last commit, carried as a duration
    uint32_t crc;
    logic::CheckupRing  ring;
    logic::DhwLossRing  dhw;
    // One-shot checkpoint written by esp_restart's shutdown handler.  It has its own seal because
    // the completed ring must remain adoptable after an unexpected panic while this open state is
    // changing.  checkup_start consumes it before any producer exists.
    PersistedDhwHandoff dhw_handoff;
};

// UNINITIALISED STORAGE, and the UNION is what makes it that — history.cpp's PersistStore carries
// the same construction for the same reason, and this file shipped the bug it exists to prevent.
//
// `CheckupRing`/`DhwLossRing` carry non-static data member initialisers, several of them non-zero
// (`min_bar`/`max_loss_tenths_k_h` start at CHECKUP_ABSENT). A plain struct definition therefore
// gets an implicit default constructor that RUNS at startup and re-initialises exactly those two
// members — while `magic`, `version`, `layout_fp`, `model_fp`, `span_us` and `crc`, being bare
// scalars with no initialiser, are left untouched in .noinit.
//
// The result is the worst possible shape and is precisely what the reference board reported: the
// header survives the reboot and passes the magic, version and layout checks, the rings do not, and
// the record is rejected as `bad_crc` — a memory-fault verdict for a compiler doing its job. It
// looked like corrupted DRAM and was a missing four characters.
//
// A union with a user-provided empty constructor emits no initialisation at all, which is the
// standard C++ way to say "these bytes are whatever they were". checkup_start() then initialises
// them explicitly on every boot that does not adopt them, so nothing is read before it is written.
union PersistStore {
    PersistedCheckup v;
    PersistStore() {}      // deliberately leaves v untouched
    ~PersistStore() {}
};
__NOINIT_ATTR PersistStore s_store;

// One name for the region, so no call site has to know about the union.
inline PersistedCheckup& P() { return s_store.v; }
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
std::atomic<bool>     s_diagnostics_enabled{false};
uint32_t              s_diagnostics_generation = 0; // guarded by s_mtx after startup
bool                  s_reboot_saved_this_boot = false;
// End of the newest COMPLETED bucket in this boot's monotonic clock.  Unlike P().span_us this is not
// persisted: after a cold restore the journal's absolute end times are authoritative, and after a
// warm restore the next live commit establishes a fresh wall-clock anchor before anything new is
// appended.
constexpr int64_t      kNoCommitUs = INT64_MIN;
int64_t                s_last_commit_us = kNoCommitUs;
uint8_t                s_live_commit_count = 0; // completed in THIS monotonic clock, max 23

// One-shot cold-restore scratch. Static for the poll task's measured 8 KiB stack: 23 diagnostic
// records are roughly 2 KiB and must never become an automatic array on that task.
CheckupFlashRecord     s_restore_live[logic::CHECKUP_COMPLETED_BUCKETS];

// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
// Everything inside a critical section in this file is a plain integer copy — nothing allocates —
// so the unwind safety is belt-and-braces here rather than the reason the guard is used.
using Lock = SemGuard;

// The row a locator addresses, or -1. Composes logic/checkup.hpp's pure predicate rather than taking
// the parallel-array checkup_select(): building (reg, off, conv) views for a full resolved profile
// would consume material space on the POLL TASK's 8 KB stack every second, and that stack fails
// silently on this board (AGENTS.md → Memory, concurrency, and HTTP safety). checkup_select() still
// exists — it is what the catalog test sweeps the whole profile set with.
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

// The converter owns the enum vocabulary; the pure helper owns what it means to this check. A row
// that is missing, held out of the fresh snapshot or formatted as "?" remains Unknown.
logic::CheckupOperatingMode operating_mode(const CachedValue* v, size_t n) {
    const int i = find_row(v, n, logic::CHECKUP_LOC_IU_MODE);
    if (i < 0) return logic::CheckupOperatingMode::Unknown;
    return logic::checkup_operating_mode(v[i].value.c_str());
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
// intact day. Excluded, sealed bytes change only at a COMMIT or when a completed run is booked back
// into its retained START bucket; both paths re-seal immediately. The open hour is dropped on
// restore, which is the honest answer anyway: a partial hour was never a completed bucket.
//
// first/latest_sample_us are excluded because they are MONOTONIC and meaningless in the next boot's
// clock; the observed lifecycle rides as `span_us` instead.
uint32_t persist_crc() {
    uint32_t crc = CONFIG_CRC32_INIT;
    const auto& r = P().ring;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(r.buf), sizeof(r.buf));
    crc = config_crc32_update(crc, &r.count, sizeof(r.count));
    crc = config_crc32_update(crc, &r.head, sizeof(r.head));
    crc = config_crc32_update(crc, &r.age_buckets, sizeof(r.age_buckets));
    const auto& d = P().dhw;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(d.buf), sizeof(d.buf));
    crc = config_crc32_update(crc, &d.count, sizeof(d.count));
    crc = config_crc32_update(crc, &d.head, sizeof(d.head));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&P().span_us),
                              sizeof(P().span_us));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&P().model_fp),
                              sizeof(P().model_fp));
    crc = config_crc32_update(
        crc, reinterpret_cast<const uint8_t*>(&P().diagnostics_generation),
        sizeof(P().diagnostics_generation));
    return config_crc32_final(crc);
}

// Re-seal after a commit or a completed-run write into an older retained bucket. The ONLY writer of
// the record's header, so the seal and the bytes it covers cannot drift apart.
void persist_seal() {
    P().magic     = logic::CHECKUP_PERSIST_MAGIC;
    P().version   = logic::CHECKUP_PERSIST_VERSION;
    P().reserved  = 0;
    P().layout_fp = logic::checkup_layout_fingerprint();
    P().model_fp  = s_model_fp;
    P().diagnostics_generation = s_diagnostics_generation;
    P().span_us   = P().ring.span_us();
    P().crc       = persist_crc();
}

void persist_wipe() {
    P().ring.reset();
    P().dhw.reset();
    P().dhw_handoff.magic = 0;
    s_last_commit_us = kNoCommitUs;
    s_live_commit_count = 0;
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
    P().dhw.reset();
    s_dhw_state = logic::DhwLossState{};
    P().dhw_handoff.magic = 0;
    persist_seal();
    return true;
}

// Intentional reboot handoff.  Unlike the completed-ring seal this runs exactly once, after the OTA
// image is installed and immediately before esp_restart.  A bounded lock is load-bearing: failure
// to checkpoint may lose one candidate, while waiting forever would strand a device that has
// already switched its boot partition.
void checkup_reboot_save() {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;
    if (s_reboot_saved_this_boot) return;
    s_reboot_saved_this_boot = true;
    if (!s_mtx || xSemaphoreTake(s_mtx, pdMS_TO_TICKS(200)) != pdTRUE) {
        P().dhw_handoff.magic = 0;
        diag_printf("checkup: DHW reboot handoff skipped (checkup busy)\n");
        return;
    }

    // A configuration reset queued just before the reboot belongs to the new identity.  Consume it
    // here rather than handing the old source's candidate to the next boot.
    apply_reset_locked();
    apply_dhw_reset_locked();

    PersistedDhwHandoff& h = P().dhw_handoff;
    h.magic     = logic::CHECKUP_DHW_HANDOFF_MAGIC;
    h.version   = logic::CHECKUP_DHW_HANDOFF_VERSION;
    h.reserved  = 0;
    h.layout_fp = logic::checkup_dhw_handoff_layout_fingerprint();
    h.model_fp  = s_model_fp;
    h.payload.candidate = logic::dhw_loss_checkpoint(s_dhw_state, esp_timer_get_time());
    h.payload.pending   = P().dhw.pending;
    h.crc = logic::checkup_dhw_handoff_crc(h.model_fp, h.payload);

    const logic::DhwLossProgress p = logic::dhw_loss_progress(s_dhw_state,
                                                               esp_timer_get_time());
    xSemaphoreGive(s_mtx);
    diag_printf("checkup: DHW reboot handoff saved (%u min candidate, %u completed window(s))\n",
                static_cast<unsigned>(p.candidate_observed_s / 60),
                static_cast<unsigned>(h.payload.pending.windows));
}

} // namespace

// Judge what the previous boot left in .noinit. Called from app_main BEFORE any producer task
// exists, so the whole decision is single-threaded and needs no lock — the same property
// history_start() relies on.
void checkup_start(bool diagnostics_enabled, uint32_t diagnostics_generation) {
    // Create the lock HERE, not on first use. It used to be allocated lazily by the poll task inside
    // checkup_record(), which meant the httpd task's checkup_report() read the raw handle while
    // another core was writing it — an unsynchronized read of the very pointer that synchronizes
    // everything else in this file. Benign in practice (a report one cycle early is empty either
    // way), and free to remove: app_main calls this before any producer task exists, which is the
    // same property history_start() already relies on for the identical creation.
    if (!s_mtx) {
        s_mtx = xSemaphoreCreateMutex();
        if (!s_mtx) diag_printf("checkup: mutex alloc failed — observation disabled this boot\n");
    }
    s_last_commit_us = kNoCommitUs;
    s_live_commit_count = 0;
    s_diagnostics_enabled.store(diagnostics_enabled, std::memory_order_release);
    s_diagnostics_generation = diagnostics_generation;
    const uint32_t want_fp = logic::checkup_layout_fingerprint();
    const uint32_t reason  = static_cast<uint32_t>(esp_reset_reason());
    s_persist_verdict = logic::checkup_restore_verdict(reason, P().magic, P().version,
                                                       P().layout_fp, want_fp,
                                                       P().crc, persist_crc(),
                                                       safe_mode_active(), diagnostics_enabled,
                                                       P().diagnostics_generation,
                                                       diagnostics_generation);
    if (s_persist_verdict == logic::CheckupRestore::Accept) {
        // Adopt the completed buckets in place. The open hour is dropped (it is outside the seal),
        // the monotonic anchors restart, and the lifecycle the previous boot observed is carried
        // across as a duration — see CheckupRing::carried_span_us.
        P().ring.pending      = logic::CheckupBucket{};
        P().ring.first_sample_us  = -1;
        P().ring.latest_sample_us = -1;
        P().ring.carried_span_us  = P().span_us;
        s_model_fp = P().model_fp;
        s_adopt_detect_grace = true;
        const bool dhw_kept = logic::checkup_dhw_handoff_valid(
            P().dhw_handoff.magic, P().dhw_handoff.version, P().dhw_handoff.layout_fp,
            P().dhw_handoff.model_fp, s_model_fp, P().dhw_handoff.crc,
            P().dhw_handoff.payload);
        if (dhw_kept) {
            P().dhw.pending = P().dhw_handoff.payload.pending;
            logic::dhw_loss_adopt(s_dhw_state, P().dhw_handoff.payload.candidate,
                                  esp_timer_get_time());
            const logic::DhwLossProgress progress = logic::dhw_loss_progress(
                s_dhw_state, esp_timer_get_time());
            diag_printf("checkup: DHW candidate kept (%u min, %u completed window(s))\n",
                        static_cast<unsigned>(progress.candidate_observed_s / 60),
                        static_cast<unsigned>(P().dhw.pending.windows));
        } else {
            P().dhw.pending = logic::DhwLossBucket{};
            s_dhw_state = logic::DhwLossState{};
        }
        // One shot: a later panic in THIS boot must not replay the same handoff a second time.
        P().dhw_handoff.magic = 0;
        // Reported in h AND min. Whole hours alone round the first successful restore of a board's
        // life down to "0 h observed" — the seal lands at the hourly commit, so the carried span is
        // 0.999 h — which reads as "kept nothing" at exactly the moment this first works, and sends
        // a reader after a defect that is not there. This line is the ONLY human-readable evidence
        // that the restore did anything; there is no UI for it.
        //
        // It is the window's LIFECYCLE SPAN, not its evidence: covered_s is the seconds actually
        // observed and is reported separately on /status.health. The two are close on a board that
        // was watching continuously and are not the same quantity.
        const unsigned mins = static_cast<unsigned>(P().span_us / 60000000LL);
        diag_printf("checkup: window kept across a %s reset (%u h %u min observed, RAM survived)\n",
                    crash_reason_slug(reason), mins / 60, mins % 60);
    } else {
        persist_wipe();
        // Not noise: "wrong_layout" after an update explains a card that emptied itself for a reason
        // nobody could otherwise reconstruct, and "bad_crc" on a board that was never power-cycled
        // is a memory fault worth seeing.
        diag_printf("checkup: window starts empty (%s)\n",
                    logic::checkup_restore_slug(s_persist_verdict));
    }
    const esp_err_t shutdown_err = esp_register_shutdown_handler(checkup_reboot_save);
    if (shutdown_err != ESP_OK)
        diag_printf("checkup: DHW shutdown handler not registered (%s)\n",
                    esp_err_to_name(shutdown_err));
}

void checkup_set_diagnostics(bool enabled, uint32_t generation) {
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    s_diagnostics_enabled.store(enabled, std::memory_order_release);
    s_diagnostics_generation = generation;
    s_reset_requested.store(false);
    s_dhw_reset_requested.store(false);
    s_state = logic::CheckupState{};
    s_dhw_state = logic::DhwLossState{};
    s_cov = logic::CheckupCoverage{};
    s_fault_now = daik::FaultClass::Unknown;
    persist_wipe();
    s_persist_verdict = enabled ? logic::CheckupRestore::DiagnosticsChanged
                                : logic::CheckupRestore::DiagnosticsDisabled;
}

const char* checkup_persist_state() {
    if (!s_mtx) return logic::checkup_restore_slug(s_persist_verdict);
    Lock lk(s_mtx);
    return logic::checkup_restore_slug(s_persist_verdict);
}

void checkup_reset() {
    // Arm under the same mutex as record consumption. The HTTP path bumps the source generation
    // first, then waits here; an old-link cycle can therefore never consume this new reset and seed
    // the cleared window with its own sample.
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
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
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) {
        s_model_fp = fp;
        s_adopt_detect_grace = false;
        return;
    }
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
    s_reset_requested.store(true);
}

void checkup_dhw_reset() {
    s_dhw_reset_requested.store(true);
}

void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running,
                    const logic::CheckupCoverage& coverage, uint32_t source_generation) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;
    if (!s_mtx) return;   // checkup_start() creates it; absent means its alloc failed -> no observation
    if (!v && n) return;

    logic::CheckupSample s;
    s.rps_known   = rps_known;
    s.rps_running = rps_running;

    flag_state(v, n, logic::CHECKUP_LOC_DEFROST, s.defrost_known, s.defrost_on);
    flag_state(v, n, logic::CHECKUP_LOC_PUMP,    s.pump_known,    s.pump_on);
    flag_state(v, n, logic::CHECKUP_LOC_BSH,     s.bsh_known,     s.bsh_on);
    flag_state(v, n, logic::CHECKUP_LOC_VALVE,   s.valve_known,   s.valve_dhw);
    s.operating_mode = operating_mode(v, n);
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
    // Page 0x20 can answer with the last run's outdoor value while the unit sleeps. The shared
    // evidence helper therefore requires THIS-cycle row presence plus a positively running RPS
    // witness. In particular, `held == false` with unknown RPS is not freshness.
    const int outdoor_row = find_row(v, n, logic::CHECKUP_LOC_OUTDOOR);
    int outdoor_tenths = 0;
    if (outdoor_row >= 0 && tenths(v[static_cast<size_t>(outdoor_row)], outdoor_tenths)) {
        s.outdoor = logic::outdoor_x10a_evidence(
            true, rps_known, rps_running, static_cast<double>(outdoor_tenths) / 10.0);
    }
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
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;
    if (!hp_poll_generation_matches(source_generation)) return;

    // A request can arrive while an old-link sweep is in flight. If this cycle consumes it, discard
    // the whole sample after clearing state; otherwise the tail of old poll A would seed the window
    // that new-link poll B continues. Dropping at most the first new sample is the conservative side.
    if (apply_reset_locked()) return;
    const bool discard_dhw_sample = apply_dhw_reset_locked();
    s_cov       = coverage;
    s_fault_now = s.fault;
    P().ring.observe(now);

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
        P().ring.commit(skipped);
        P().dhw.commit(skipped);
        s_last_commit_us = now;
        const uint32_t committed_now = 1u +
            (skipped < logic::CHECKUP_COMPLETED_BUCKETS
                ? skipped : logic::CHECKUP_COMPLETED_BUCKETS);
        const uint32_t live_total = static_cast<uint32_t>(s_live_commit_count) + committed_now;
        s_live_commit_count = static_cast<uint8_t>(
            live_total < logic::CHECKUP_COMPLETED_BUCKETS
                ? live_total : logic::CHECKUP_COMPLETED_BUCKETS);
        persist_seal();          // the sealed bytes change ONLY here; see persist_crc()
        if (continuous_boundary) s_state.last_us = now; // dt=0, edge witnesses intentionally kept
        const bool reseal = logic::checkup_step(s_state, P().ring.pending, s, now, &P().ring);
        if (reseal) persist_seal();
        if (!discard_dhw_sample)
            logic::dhw_loss_step(s_dhw_state, P().dhw.pending, s, now);
    } else {
        const bool reseal = logic::checkup_step(s_state, P().ring.pending, s, now, &P().ring);
        if (reseal) persist_seal();
        if (!discard_dhw_sample)
            logic::dhw_loss_step(s_dhw_state, P().dhw.pending, s, now);
    }
    s_state.bucket      = bucket;
    s_state.have_bucket = true;
}

logic::CheckupReport checkup_report() {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return logic::CheckupReport{};
    if (!s_mtx) return logic::CheckupReport{};
    Lock lk(s_mtx);
    if (!lk.acquired()) return logic::CheckupReport{};
    // Only the record path consumes a reset, because it can also discard the in-flight sample.
    // Until then expose an empty report, never stale identity A and never consume the guard early.
    if (s_reset_requested.load()) return logic::CheckupReport{};
    logic::CheckupReport report = logic::checkup_evaluate(
        logic::checkup_aggregate(P().ring), s_cov, s_fault_now,
        s_dhw_reset_requested.load() ? logic::DhwLossWindow{}
                                     : logic::dhw_loss_aggregate(P().dhw));
    if (!s_dhw_reset_requested.load()) {
        const logic::DhwLossProgress p = logic::dhw_loss_progress(s_dhw_state,
                                                                  esp_timer_get_time());
        report.dhw_candidate_s = p.candidate_observed_s;
        report.dhw_settle_remaining_s = p.settle_remaining_s;
    }
    return report;
}

bool checkup_flash_next(int64_t now_unix_s, int64_t after_bucket,
                        int64_t& bucket, logic::CheckupJournalPayload& payload) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return false;
    if (!s_mtx || now_unix_s < 0) return false;
    Lock lk(s_mtx, 0);
    if (!lk.acquired() || s_reset_requested.load() || !s_model_fp ||
        s_last_commit_us == kNoCommitUs || !s_live_commit_count || !P().ring.count ||
        P().ring.count != P().dhw.count)
        return false;

    const int64_t now_us = esp_timer_get_time();
    if (now_us < s_last_commit_us) return false;
    const int64_t latest_end_unix_s =
        now_unix_s - (now_us - s_last_commit_us) / 1000000;
    const int64_t newest = logic::checkup_journal_bucket(latest_end_unix_s);
    if (newest == INT64_MIN) return false;
    const size_t live_count = s_live_commit_count < P().ring.count
        ? s_live_commit_count : P().ring.count;
    const int64_t target = logic::checkup_journal_next_live_bucket(
        after_bucket, newest, live_count);
    if (target == INT64_MIN) return false;

    const size_t age = static_cast<size_t>(newest - target);
    const size_t ring_i = (static_cast<size_t>(P().ring.head) +
                           logic::CHECKUP_COMPLETED_BUCKETS - 1 - age) %
                          logic::CHECKUP_COMPLETED_BUCKETS;
    const size_t dhw_i = (static_cast<size_t>(P().dhw.head) +
                          logic::CHECKUP_COMPLETED_BUCKETS - 1 - age) %
                         logic::CHECKUP_COMPLETED_BUCKETS;
    payload = logic::CheckupJournalPayload{};
    payload.model_fp = s_model_fp;
    payload.diagnostics_generation = s_diagnostics_generation;
    payload.end_unix_s = latest_end_unix_s -
        static_cast<int64_t>(age) * logic::CHECKUP_DT_S;
    payload.checkup = P().ring.buf[ring_i];
    payload.dhw = P().dhw.buf[dhw_i];
    bucket = target;
    return logic::checkup_journal_bucket(payload.end_unix_s) == target;
}

CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t now_unix_s) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire))
        return CheckupFlashRestoreResult::Ignored;
    if (!s_mtx || now_unix_s < 0 || (!records && count))
        return CheckupFlashRestoreResult::Ignored;
    Lock lk(s_mtx, 0);
    if (!lk.acquired()) return CheckupFlashRestoreResult::Deferred;
    // Detection owns the identity and queues its reset from another point in the same poll cycle.
    // Never restore in between those two acts. A valid RAM adoption is newer and loses no completed
    // hour, so it wins without mixing the same evidence in twice.
    if (!s_model_fp || s_reset_requested.load()) return CheckupFlashRestoreResult::Deferred;
    if (s_persist_verdict == logic::CheckupRestore::Accept)
        return CheckupFlashRestoreResult::Ignored;

    const int64_t now_us = esp_timer_get_time();
    size_t live_count = 0;
    if (P().ring.count && P().ring.count == P().dhw.count &&
        s_last_commit_us != kNoCommitUs && now_us >= s_last_commit_us) {
        const int64_t latest_end = now_unix_s - (now_us - s_last_commit_us) / 1000000;
        const size_t available = s_live_commit_count < P().ring.count
            ? s_live_commit_count : P().ring.count;
        const size_t oldest_i = (static_cast<size_t>(P().ring.head) +
                                 logic::CHECKUP_COMPLETED_BUCKETS - available) %
                                logic::CHECKUP_COMPLETED_BUCKETS;
        for (size_t i = 0; i < available; i++) {
            CheckupFlashRecord& rec = s_restore_live[live_count++];
            rec.payload = logic::CheckupJournalPayload{};
            rec.payload.model_fp = s_model_fp;
            rec.payload.diagnostics_generation = s_diagnostics_generation;
            rec.payload.end_unix_s = latest_end -
                static_cast<int64_t>(available - 1 - i) * logic::CHECKUP_DT_S;
            rec.payload.checkup =
                P().ring.buf[(oldest_i + i) % logic::CHECKUP_COMPLETED_BUCKETS];
            rec.payload.dhw =
                P().dhw.buf[(oldest_i + i) % logic::CHECKUP_COMPLETED_BUCKETS];
            rec.bucket = logic::checkup_journal_bucket(rec.payload.end_unix_s);
        }
    }

    int64_t earliest_bucket = INT64_MAX;
    int64_t latest_bucket = INT64_MIN;
    int64_t earliest_stored_end = INT64_MAX;
    size_t accepted = 0;
    auto consider = [&](const CheckupFlashRecord& rec, bool stored) {
        if (rec.payload.diagnostics_generation != s_diagnostics_generation ||
            rec.payload.model_fp != s_model_fp ||
            rec.bucket != logic::checkup_journal_bucket(rec.payload.end_unix_s) ||
            !logic::checkup_journal_in_window(rec.payload.end_unix_s, now_unix_s))
            return;
        if (rec.bucket < earliest_bucket) earliest_bucket = rec.bucket;
        if (rec.bucket > latest_bucket) latest_bucket = rec.bucket;
        if (stored) {
            accepted++;
            if (rec.payload.end_unix_s < earliest_stored_end)
                earliest_stored_end = rec.payload.end_unix_s;
        }
    };
    for (size_t i = 0; i < count; i++) consider(records[i], true);
    for (size_t i = 0; i < live_count; i++) consider(s_restore_live[i], false);
    if (!accepted) return CheckupFlashRestoreResult::Ignored;

    // If this boot has not completed an hour yet, explicit empty buckets represent wall time during
    // which the board was off. They age older evidence without inventing observed seconds.
    if (!live_count) {
        const int64_t before_open = logic::checkup_journal_bucket(now_unix_s) - 1;
        if (before_open > latest_bucket) latest_bucket = before_open;
    }
    const int64_t capacity_start = latest_bucket -
        static_cast<int64_t>(logic::CHECKUP_COMPLETED_BUCKETS - 1);
    if (earliest_bucket < capacity_start) earliest_bucket = capacity_start;

    const logic::CheckupBucket pending = P().ring.pending;
    const logic::DhwLossBucket dhw_pending = P().dhw.pending;
    const int64_t first_sample_us = P().ring.first_sample_us;
    const int64_t latest_sample_us = P().ring.latest_sample_us;
    const int64_t live_span_us =
        first_sample_us >= 0 && latest_sample_us >= first_sample_us
            ? latest_sample_us - first_sample_us : 0;
    P().ring.reset();
    P().dhw.reset();

    auto find = [&](int64_t wanted, logic::CheckupBucket& out,
                    logic::DhwLossBucket& dhw_out) {
        // This boot is strictly newer than flash on a collision, although normal one-hour cadence
        // makes such a collision impossible across a power gap.
        for (size_t i = 0; i < live_count; i++) {
            const auto& rec = s_restore_live[i];
            if (rec.bucket == wanted) {
                out = rec.payload.checkup; dhw_out = rec.payload.dhw; return true;
            }
        }
        for (size_t i = count; i > 0; i--) {
            const auto& rec = records[i - 1];             // a newer duplicate wins
            if (rec.bucket == wanted &&
                rec.payload.diagnostics_generation == s_diagnostics_generation &&
                rec.payload.model_fp == s_model_fp &&
                logic::checkup_journal_in_window(rec.payload.end_unix_s, now_unix_s) &&
                rec.bucket == logic::checkup_journal_bucket(rec.payload.end_unix_s)) {
                out = rec.payload.checkup; dhw_out = rec.payload.dhw; return true;
            }
        }
        return false;
    };
    for (int64_t b = earliest_bucket; b <= latest_bucket; b++) {
        logic::CheckupBucket cb;
        logic::DhwLossBucket db;
        (void)find(b, cb, db);       // absent interval stays an explicit all-zero gap
        P().ring.push(cb);
        P().dhw.push(db);
    }
    P().ring.pending = pending;
    P().dhw.pending = dhw_pending;
    P().ring.first_sample_us = first_sample_us;
    P().ring.latest_sample_us = latest_sample_us;
    P().ring.age_buckets = static_cast<uint8_t>(
        P().ring.count < logic::CHECKUP_BUCKETS ? P().ring.count : logic::CHECKUP_BUCKETS);

    const int64_t stored_start = earliest_stored_end - logic::CHECKUP_DT_S;
    int64_t wall_span_us = now_unix_s > stored_start
        ? (now_unix_s - stored_start) * 1000000 : 0;
    if (wall_span_us > logic::CHECKUP_WINDOW_US) wall_span_us = logic::CHECKUP_WINDOW_US;
    P().ring.carried_span_us = wall_span_us > live_span_us ? wall_span_us - live_span_us : 0;
    s_persist_verdict = logic::CheckupRestore::Accept;
    persist_seal();
    diag_printf("checkup: restored %u hourly bucket(s) from flash after power loss\n",
                static_cast<unsigned>(accepted));
    return CheckupFlashRestoreResult::Restored;
}

} // namespace daik
