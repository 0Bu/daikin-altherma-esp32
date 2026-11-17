// The 24-hour plant diagnosis. Policy (which rows, what counts as an edge, the bucket math, the
// thresholds and the verdicts) lives in logic/checkup.hpp and is host-tested; this file is storage,
// one mutex, and the fold from a poll cycle into the open hour.
#include "checkup.hpp"
#include "diag_log.hpp"
#include "history.hpp" // startup journal availability, after history_start
#include "logic/checkup.hpp"
#include "logic/checkup_persist.hpp"  // WHEN a persisted window may be believed
#include "logic/crashinfo.hpp"        // crash_reason_slug — one reset vocabulary
#include "logic/history.hpp"     // history_parse_tenths — the ONE parse of a cached value
#include "logic/stop_context_input.hpp"
#include "safe_mode.hpp"         // safe_mode_active — nothing ages the window there
#include "mqtt_ha.hpp"           // independent circulation-pump electrical witness
#include "config.hpp"            // allocation-free circulation identity snapshot
#include "def/homehub.hpp"       // same HomeHub/Altherma4 register semantics as hp_modbus
#include "def/overlay.hpp"       // same resolved decoder rows as the poll engine
#include "hp_modbus.hpp"         // mb_target_generation_matches
#include "sntp_time.hpp"         // pressure minimum carries a real source observation timestamp

#include "esp_attr.h"            // __NOINIT_ATTR — warm handoff and startup integrity metadata
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
    // Reserved legacy age-guard counter, sealed for integrity. Completed v4 RAM hours are retired.
    uint16_t boots_since_commit;
    uint32_t layout_fp;
    uint32_t model_fp;               // detected profile
    uint32_t source_fp;              // full detected X10A profile/link identity
    uint32_t diagnostics_generation; // consent interval; old intervals never cross a new enable
    int64_t  span_us;       // lifecycle observed up to the last commit, carried as a duration
    uint32_t crc;
    logic::CheckupRing  ring;
    logic::DhwLossRing  dhw;
    // One-shot checkpoint written by esp_restart's shutdown handler.  It has its own seal because
    // ring integrity must remain usable to validate the handoff while this open state is changing.
    // checkup_start consumes it before any producer exists and retires all completed RAM hours.
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
// the completed-hour rings on every boot, after checking the separately sealed one-shot handoff,
// so nothing is read before it is written.
union PersistStore {
    PersistedCheckup v;
    PersistStore() {}      // deliberately leaves v untouched
    ~PersistStore() {}
};
__NOINIT_ATTR PersistStore s_store;
__NOINIT_ATTR PersistStore s_mb_store;

// Copy a read-only reset template without constructing the expanded state on a caller's stack.
constexpr logic::DhwLossState  kFreshDhwLossState{};
constexpr logic::DhwLossBucket kEmptyDhwLossBucket{};
constexpr int64_t              kNoCommitUs = INT64_MIN;

// One independent source slot (X10A vs HomeHub Modbus). The two sources keep completely separate
// 24h rings, cycling traces, restore states, and flash/handoff scopes; they share only the checkup
// mutex and the user's explicit opt-in consent boundary.
struct CheckupSlot {
    PersistStore* store;
    uint32_t      persist_magic;
    bool          is_modbus;

    PersistedCheckup&       P() { return store->v; }
    const PersistedCheckup& P() const { return store->v; }

    logic::CheckupState          state{};
    logic::DhwLossState          dhw_state{};
    logic::CheckupRestore        persist_verdict  = logic::CheckupRestore::NoRecord;
    uint32_t                     model_fp         = 0;
    uint32_t                     source_fp        = 0;
    uint32_t                     dhw_source_fp    = 0;
    bool                         source_confirmed = false;
    logic::DhwLossHandoffPayload boot_handoff{};
    uint32_t                     boot_handoff_model = 0;
    bool                         boot_handoff_valid = false;
    // Exact expiry for reconstructed completed slots, including selected live intervals.
    // Current-boot completions carry the same deadline: a stopped producer must still lose old
    // hours.
    logic::CheckupJournalSlotTimes slot_times{};
    logic::CheckupCyclingTrace     cycling_trace{};
    logic::CheckupCyclingTrace     cycling_restored{};
    uint32_t                       cycling_restore_anchor = 0;
    std::atomic<bool>              cycling_forgotten{false};
    bool                           cycling_restore_allowed = false;
    std::atomic<uint32_t>          cycling_reset_token{0};
    std::atomic<uint32_t>          cycling_reset_acked{0};
    uint32_t                       cycling_hours_epoch   = 0;
    int32_t                        cycling_newest_bucket = 0;
    // Capability of the CURRENT confirmed profile.
    logic::CheckupCoverage cov{};
    daik::FaultClass       fault_now      = daik::FaultClass::Unknown;
    int64_t                source_last_us = -1; // actual source rows, never an empty gap callback
    int                    pressure_now   = -1;
    std::atomic<bool>      reset_requested{false};
    std::atomic<bool>      dhw_reset_requested{false};
    // End of the newest COMPLETED bucket in this boot's monotonic clock.
    int64_t last_commit_us = kNoCommitUs;
    // When DHW evidence last restarted without the shared lifecycle, in this boot's monotonic
    // clock.
    int64_t dhw_scope_us      = -1;
    uint8_t live_commit_count = 0; // completed in THIS monotonic clock, max 23
    logic::CheckupJournalRevision revision{};
    std::atomic<int64_t>          revision_acked{INT64_MIN};
    int64_t                       journal_label_offset = INT64_MIN;
    bool                          dhw_restart_armed    = false;
    uint32_t                      dhw_restart_bucket   = 0;
    int64_t                       seal_bucket          = INT64_MIN;
    int64_t                       seal_end_unix_s      = INT64_MIN;
    bool                          flash_pending        = false;

    CheckupSlot(PersistStore* st, uint32_t magic, bool mb)
        : store(st), persist_magic(magic), is_modbus(mb) {}
};

CheckupSlot s_x10a{&s_store, logic::CHECKUP_PERSIST_MAGIC, false};
CheckupSlot s_modbus{&s_mb_store, logic::CHECKUP_MODBUS_PERSIST_MAGIC, true};

CheckupSlot& slot_for(DiagnosticsSource source) {
    return source == DiagnosticsSource::Modbus ? s_modbus : s_x10a;
}

logic::StopContextState     s_stop_context;
logic::StopContextInputPlan s_stop_inputs;
uint32_t                    s_stop_generation    = 0;
bool                        s_stop_allow_restore = true;
int64_t                     s_stop_read_fence_us = -1;
constexpr logic::StopContextState  kEmptyStopContext{};
constexpr CheckupStopContextReport kEmptyStopReport{};

// Called only with the Checkup lock. Recovery latches independently, before Store startup or
// while an owner is busy; retire the producer too so pending windows cannot outlive that intent.
bool stop_context_suppressed_locked() {
    if (!stop_observation_suppressed()) return false;
    s_stop_context = kEmptyStopContext;
    return true;
}

std::atomic<uint32_t> s_requested_dhw_source_fp{0};
SemaphoreHandle_t     s_mtx = nullptr;
std::atomic<uint32_t> s_dhw_identity_generation{1};
std::atomic<bool>     s_diagnostics_enabled{false};
// Live admission epoch is independent of the durable consent identity: even a repeated saved
// generation cannot let a poll begun before an off/on transition enter the new interval.
std::atomic<uint32_t> s_diagnostics_epoch{1};
uint32_t              s_diagnostics_generation = 0; // guarded by s_mtx after startup
std::atomic<bool>     s_reboot_saved_this_boot{false};

bool consent_admitted(uint32_t consent_epoch) {
    return s_diagnostics_enabled.load(std::memory_order_acquire) &&
           consent_epoch == s_diagnostics_epoch.load(std::memory_order_acquire);
}

// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
using Lock = SemGuard;

void retire_cycling_locked(CheckupSlot& slot) {
    slot.cycling_restore_allowed = false;
    slot.cycling_restored.reset();
    const uint32_t next = slot.cycling_reset_token.load(std::memory_order_relaxed) + 1u;
    slot.cycling_reset_token.store(next ? next : 1u, std::memory_order_release);
}

[[gnu::noinline]] bool cycling_snapshot_locked(CheckupSlot& slot, logic::CheckupCyclingTrace& out,
                                               int64_t now_us) {
    if (slot.cycling_forgotten.load(std::memory_order_acquire) || !slot.source_confirmed ||
        (!slot.cycling_trace.count && !slot.cycling_restored.count) || now_us < 0 ||
        now_us / 1000000 > logic::CheckupCyclingTrace::max_second)
        return false;
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    const auto     boot_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall =
        logic::checkup_cycling_end_unix_s(now_us - now_us % 1000000, now_us, unix_s, ms);
    if (wall <= boot_s) return false;
    // Keep a monotonic age floor for restored data, even if the wall clock moves backwards.
    slot.cycling_restore_anchor = std::max(slot.cycling_restore_anchor, wall - boot_s);
    const int64_t oldest_saved_unix =
        static_cast<int64_t>(slot.cycling_restore_anchor) + boot_s - logic::CHECKUP_WINDOW_S;
    logic::checkup_cycling_snapshot(out, slot.cycling_restored, slot.cycling_trace, wall, boot_s,
                                    oldest_saved_unix);
    return out.unix_s != 0 && !slot.cycling_forgotten.load(std::memory_order_acquire);
}

uint32_t circulation_identity() {
    return with_config([](const Config& c) {
        return logic::checkup_dhw_source_fingerprint(
            c.mqtt_uri.c_str(), c.circulation_topic.c_str(), c.circulation_power_path.c_str(),
            c.circulation_time_path.c_str(), c.circulation_max_age_s, c.circulation_on_tenths_w,
            c.circulation_off_tenths_w, c.circulation_confirm_s);
    });
}

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

bool exact_int(const CachedValue& cv, int& out) {
    int t = 0;
    if (!tenths(cv, t) || t % 10 != 0) return false;
    out = t / 10;
    return true;
}

const def::HomeHubReg* modbus_row_for_cv(const CachedValue& cv, ModbusProfile profile) {
    if (cv.modbus_definition != 0) {
        const def::HomeHubReg* row = def::homehub_definition(cv.modbus_definition);
        if (!row) return nullptr;
        if (profile == ModbusProfile::Altherma4 &&
            !def::homehub_definition_is_altherma4(cv.modbus_definition))
            return nullptr;
        if (profile == ModbusProfile::HomeHub &&
            def::homehub_definition_is_altherma4(cv.modbus_definition))
            return nullptr;
        return row;
    }
    if (cv.reg != def::HOMEHUB_GROUP_REG) return nullptr;
    if (profile == ModbusProfile::Altherma4) return def::altherma4_find(cv.off);
    if (profile == ModbusProfile::HomeHub) {
        for (int i = 0; i < def::HOMEHUB_REG_COUNT; ++i)
            if (def::HOMEHUB_REGS[i].offset == cv.off) return &def::HOMEHUB_REGS[i];
    }
    return nullptr;
}

// A BIT-FLAG row's state. Since legacy-210 every flag reaches the cache as the numeric "1"/"0", so
// this is a plain parse — and a legacy textual "ON"/"OFF" is refused by the parse and reads as
// UNKNOWN, which is the safe direction: logic/checkup.hpp never folds unknown into off.
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
uint32_t checkup_persist_crc(const CheckupSlot& slot) {
    uint32_t crc = CONFIG_CRC32_INIT;
    const auto& p   = slot.P();
    const auto& r   = p.ring;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(r.buf), sizeof(r.buf));
    crc = config_crc32_update(crc, &r.count, sizeof(r.count));
    crc = config_crc32_update(crc, &r.head, sizeof(r.head));
    crc = config_crc32_update(crc, &r.age_buckets, sizeof(r.age_buckets));
    const auto& d   = p.dhw;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(d.buf), sizeof(d.buf));
    crc = config_crc32_update(crc, &d.count, sizeof(d.count));
    crc = config_crc32_update(crc, &d.head, sizeof(d.head));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&p.span_us), sizeof(p.span_us));
    crc =
        config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&p.model_fp), sizeof(p.model_fp));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&p.source_fp),
                              sizeof(p.source_fp));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&p.diagnostics_generation),
                              sizeof(p.diagnostics_generation));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&p.boots_since_commit),
                              sizeof(p.boots_since_commit));
    return config_crc32_final(crc);
}

void checkup_persist_seal(CheckupSlot& slot) {
    auto& p                  = slot.P();
    p.magic                  = slot.persist_magic;
    p.version                = logic::CHECKUP_PERSIST_VERSION;
    p.layout_fp              = logic::checkup_layout_fingerprint();
    p.model_fp               = slot.model_fp;
    p.source_fp              = slot.source_fp;
    p.diagnostics_generation = s_diagnostics_generation;
    p.span_us                = p.ring.span_us();
    p.crc                    = checkup_persist_crc(slot);
}

// `keep_handoff` spares the one-shot DHW checkpoint. Startup consumes it once and holds a
// compatible filter until current-source confirmation; every other wipe clears its record.
void persist_wipe(CheckupSlot& slot, bool keep_handoff = false) {
    slot.P().ring.reset();
    slot.P().dhw.reset();
    slot.cycling_trace.reset();
    slot.cycling_restored.reset();
    slot.cycling_restore_anchor = 0;
    for (auto& expiry : slot.slot_times.expiry_us) expiry = 0;
    for (auto& end : slot.slot_times.restored_end_unix_s) end = 0;
    ++slot.cycling_hours_epoch;
    slot.cycling_newest_bucket = 0;
    if (!keep_handoff) slot.P().dhw_handoff.magic = 0;
    slot.P().boots_since_commit =
        0; // reserved integrity counter; no completed RAM hours are adopted
    slot.last_commit_us    = kNoCommitUs;
    slot.live_commit_count = 0;
    slot.dhw_scope_us      = -1; // both rings restart together
    slot.source_last_us    = -1;
    slot.pressure_now      = -1;
    slot.revision          = {};    // the withdrawn hours have nothing left to re-append
    slot.dhw_restart_armed = false; // no hour older than the wipe remains to be appended
    slot.seal_bucket = slot.seal_end_unix_s = INT64_MIN; // a wiped open hour has nothing to journal
    slot.flash_pending                      = false;
    // Retain model_fp for the next record; detection confirms it before consuming a reset.
    checkup_persist_seal(slot);
}

bool apply_reset_locked(CheckupSlot& slot) {
    if (!slot.reset_requested.exchange(false)) return false;
    slot.boot_handoff_valid = false;
    slot.dhw_reset_requested.store(false);
    slot.state     = logic::CheckupState{};
    slot.dhw_state = kFreshDhwLossState;
    if (!slot.is_modbus) s_stop_context = {};
    slot.cov       = logic::CheckupCoverage{};
    slot.fault_now = daik::FaultClass::Unknown;
    persist_wipe(slot); // clears both rings and the checkpoint to withdraw the previous scope
    return true;
}

bool apply_dhw_reset_locked(CheckupSlot& slot) {
    if (!slot.dhw_reset_requested.exchange(false)) return false;
    slot.boot_handoff_valid = false;
    slot.P().dhw.reset();
    // The independent reset retires values, not the shared hourly geometry. Losing head/count
    // would suppress even unrelated journal writes until both rings saturated again.
    slot.P().dhw.head          = slot.P().ring.head;
    slot.P().dhw.count         = slot.P().ring.count;
    slot.dhw_source_fp         = s_requested_dhw_source_fp.load();
    slot.dhw_state             = kFreshDhwLossState;
    slot.dhw_scope_us          = esp_timer_get_time(); // the primary lifecycle keeps running
    slot.dhw_restart_armed     = true;
    slot.dhw_restart_bucket    = logic::checkup_bucket(slot.dhw_scope_us);
    slot.P().dhw_handoff.magic = 0;
    checkup_persist_seal(slot);
    return true;
}

// This boot's wall-clock label of the newest completed monotonic hour. Caller holds s_mtx and has
// a commit anchor; the first completed monotonic hour is 0, so the pending one is at least 1.
int64_t latched_newest_locked(CheckupSlot& slot, int64_t latest_end_unix_s) {
    const auto current = static_cast<uint32_t>(
        slot.last_commit_us / (static_cast<int64_t>(logic::CHECKUP_DT_S) * 1000000LL));
    return logic::checkup_journal_latched_newest(
        slot.journal_label_offset, logic::checkup_journal_bucket(latest_end_unix_s), current - 1);
}

// Fold one sample into `slot`. A run that completes into its already sealed start hour
// changes a record the journal may have appended while the run was open: mark that hour for
// re-appending (the oldest such hour wins, because the replay covers every later one).
void fold_checkup_locked(CheckupSlot& slot, const logic::CheckupSample& s, int64_t now) {
    const bool     run_open  = slot.state.run_open;
    const uint32_t run_start = slot.state.run_start_bucket;
    if (!logic::checkup_step(
            slot.state, slot.P().ring.pending, s, now, &slot.P().ring, &slot.cycling_trace,
            slot.is_modbus ? logic::OutdoorSource::HomeHub : logic::OutdoorSource::X10a))
        return;
    logic::checkup_journal_revision_arm(slot.revision, run_open, run_start);
    checkup_persist_seal(slot);
}

void commit_and_fold_locked(CheckupSlot& slot, const logic::CheckupSample& s, int64_t now,
                            uint32_t bucket, bool discard_dhw_sample) {
    slot.P().ring.observe(now);

    // Close the old hour before folding the current sample. For a continuous boundary, zero only
    // the cross-boundary duration while retaining the prior tri-state witnesses: step() can then
    // place an edge/current fault in the NEW bucket without retaining old seconds beyond 24 h. A
    // long gap is left intact so step() rejects both elapsed time and edges and re-baselines here.
    if (slot.state.have_bucket && bucket != slot.state.bucket) {
        bool continuous_boundary = false;
        if (slot.state.last_us >= 0 && now >= slot.state.last_us) {
            const int64_t gap_us = now - slot.state.last_us;
            continuous_boundary =
                gap_us <= static_cast<int64_t>(logic::CHECKUP_MAX_GAP_S) * 1000000;
        }
        const uint32_t skipped = logic::checkup_skipped(slot.state.bucket, bucket);
        // Every overwritten slot loses its old flash expiry, including explicit skipped gaps.
        const size_t overwritten = 1u + std::min<size_t>(skipped, logic::CHECKUP_COMPLETED_BUCKETS);
        for (size_t i = 0; i < overwritten; ++i) {
            const size_t idx = (slot.P().ring.head + i) % logic::CHECKUP_COMPLETED_BUCKETS;
            slot.slot_times.expiry_us[idx]           = 0;
            slot.slot_times.restored_end_unix_s[idx] = 0;
        }
        slot.P().ring.commit(skipped);
        slot.P().dhw.commit(skipped);
        const int64_t completed_end_us =
            (static_cast<int64_t>(slot.state.bucket) + 1) * logic::CHECKUP_DT_S * 1000000LL;
        const int64_t completed_start_us =
            completed_end_us - static_cast<int64_t>(logic::CHECKUP_DT_S) * 1000000LL;
        const size_t committed_i = (static_cast<size_t>(slot.P().ring.head) +
                                    logic::CHECKUP_COMPLETED_BUCKETS - overwritten) %
                                   logic::CHECKUP_COMPLETED_BUCKETS;
        if (skipped < logic::CHECKUP_COMPLETED_BUCKETS)
            slot.slot_times.expiry_us[committed_i] =
                logic::checkup_live_expiry_us(completed_start_us);
        slot.last_commit_us = static_cast<int64_t>(bucket) * logic::CHECKUP_DT_S * 1000000LL;
        const uint32_t committed_now =
            1u + (skipped < logic::CHECKUP_COMPLETED_BUCKETS ? skipped
                                                             : logic::CHECKUP_COMPLETED_BUCKETS);
        const uint32_t live_total = static_cast<uint32_t>(slot.live_commit_count) + committed_now;
        slot.live_commit_count = static_cast<uint8_t>(live_total < logic::CHECKUP_COMPLETED_BUCKETS
                                                          ? live_total
                                                          : logic::CHECKUP_COMPLETED_BUCKETS);
        slot.P().boots_since_commit = 0;
        checkup_persist_seal(slot);
        if (continuous_boundary) slot.state.last_us = now; // dt=0, edge witnesses kept
        fold_checkup_locked(slot, s, now);
        if (!discard_dhw_sample) logic::dhw_loss_step(slot.dhw_state, slot.P().dhw.pending, s, now);
    } else {
        fold_checkup_locked(slot, s, now);
        if (!discard_dhw_sample) logic::dhw_loss_step(slot.dhw_state, slot.P().dhw.pending, s, now);
    }
    if (!slot.state.have_bucket && slot.P().ring.count &&
        slot.cycling_newest_bucket != static_cast<int32_t>(bucket))
        ++slot.cycling_hours_epoch;
    slot.cycling_newest_bucket = static_cast<int32_t>(bucket);
    slot.state.bucket          = bucket;
    slot.state.have_bucket     = true;
}

// Software restart: date the open hour so history_flash_save() can try to journal it.
void seal_open_hour_locked(CheckupSlot& slot) {
    if (slot.seal_bucket != INT64_MIN || !slot.state.have_bucket || !slot.model_fp ||
        !slot.source_confirmed || !slot.source_fp || slot.P().ring.count != slot.P().dhw.count)
        return;
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    const int64_t now_us = esp_timer_get_time();
    const int64_t end    = logic::checkup_seal_end_unix_s(
        unix_s, now_us, slot.P().ring.latest_sample_us, slot.state.bucket);
    int64_t newest = INT64_MIN;
    if (end != INT64_MIN && slot.last_commit_us != kNoCommitUs && slot.live_commit_count &&
        now_us >= slot.last_commit_us)
        newest = latched_newest_locked(slot, unix_s - (now_us - slot.last_commit_us) / 1000000);
    const auto    covered = static_cast<unsigned>(slot.P().ring.pending.covered_s);
    const int64_t bucket  = logic::checkup_seal_bucket(end, newest, covered);
    const char*   tag     = slot.is_modbus ? "checkup(modbus)" : "checkup";
    if (bucket == INT64_MIN) {
        diag_printf("%s: open hour not journaled before reboot (%u s covered)\n", tag, covered);
        return;
    }
    slot.seal_bucket     = bucket;
    slot.seal_end_unix_s = end;
    diag_printf("%s: open hour sealed for the journal (%u s covered)\n", tag, covered);
}

// The open hour a software restart sealed, offered once every live hour is appended.
bool sealed_flash_next_locked(const CheckupSlot& slot, int64_t after_bucket, int64_t& bucket,
                              logic::CheckupJournalPayload& payload) {
    if (!logic::checkup_seal_emits(slot.seal_bucket, after_bucket) ||
        !slot.P().ring.pending.covered_s)
        return false;
    payload                        = logic::CheckupJournalPayload{};
    payload.model_fp               = slot.model_fp;
    payload.source_fp              = slot.source_fp;
    payload.dhw_source_fp          = slot.dhw_source_fp;
    payload.diagnostics_generation = s_diagnostics_generation;
    payload.end_unix_s             = slot.seal_end_unix_s;
    payload.checkup                = slot.P().ring.pending;
    payload.dhw                    = slot.P().dhw.pending;
    bucket                         = slot.seal_bucket;
    return logic::checkup_journal_bucket(payload.end_unix_s) == bucket;
}

// Best-effort intentional-reboot handoff, attempted once after OTA installation or during
// shutdown. Further shutdown work can follow. Bounded-lock failure may lose one candidate;
// waiting forever could strand a device that already switched its boot partition.
void checkup_reboot_save() {
    if (!s_mtx || s_reboot_saved_this_boot.load(std::memory_order_acquire)) return;
    // Bounded lock (200 ms): intentional reboot handoff must never strand an installed OTA image.
    Lock lk(s_mtx, pdMS_TO_TICKS(200));
    if (!lk) {
        diag_printf("checkup: DHW reboot handoff skipped (checkup busy)\n");
        return;
    }
    if (s_diagnostics_generation == 0) return;
    s_reboot_saved_this_boot.store(true, std::memory_order_release);

    apply_reset_locked(s_x10a);
    apply_dhw_reset_locked(s_x10a);
    apply_reset_locked(s_modbus);
    apply_dhw_reset_locked(s_modbus);
    if (!stop_context_suppressed_locked()) {
        const int64_t stop_now   = esp_timer_get_time();
        const auto    stop_event = logic::stop_context_seal(s_stop_context);
        if (stop_event.valid) stop_observation_record(stop_now, false, stop_event);
        stop_observation_seal();
    }
    for (CheckupSlot* slot : {&s_x10a, &s_modbus}) {
        seal_open_hour_locked(*slot);

        if (!s_diagnostics_enabled.load(std::memory_order_acquire)) {
            slot->P().dhw_handoff.magic = 0;
            continue;
        }
        PersistedDhwHandoff& h  = slot->P().dhw_handoff;
        h.magic                 = logic::CHECKUP_DHW_HANDOFF_MAGIC;
        h.version               = logic::CHECKUP_DHW_HANDOFF_VERSION;
        h.reserved              = 0;
        h.layout_fp             = logic::checkup_dhw_handoff_layout_fingerprint();
        h.model_fp              = slot->model_fp;
        h.payload.candidate     = logic::dhw_loss_checkpoint(slot->dhw_state, esp_timer_get_time());
        h.payload.source_fp     = slot->source_confirmed ? slot->source_fp : 0;
        h.payload.dhw_source_fp = slot->dhw_source_fp;
        // Completed counters in the open hour have no durable age; never carry them across a boot.
        h.payload.pending = kEmptyDhwLossBucket;
        h.crc             = logic::checkup_dhw_handoff_crc(h.model_fp, h.payload);

        const logic::DhwLossProgress p =
            logic::dhw_loss_progress(slot->dhw_state, esp_timer_get_time());
        diag_printf("%s: DHW reboot handoff saved (%u min candidate, %u completed window(s))\n",
                    slot->is_modbus ? "checkup(modbus)" : "checkup",
                    static_cast<unsigned>(p.candidate_observed_s / 60),
                    static_cast<unsigned>(h.payload.pending.windows));
    }
}

void slot_start(CheckupSlot& slot, bool diagnostics_enabled, uint32_t diagnostics_generation,
                uint32_t dhw_fp, bool flash_pending) {
    slot.last_commit_us          = kNoCommitUs;
    slot.live_commit_count       = 0;
    slot.dhw_source_fp           = dhw_fp;
    slot.cycling_restore_allowed = !safe_mode_active();
    const uint32_t want_fp       = logic::checkup_layout_fingerprint();
    const uint32_t reason        = static_cast<uint32_t>(esp_reset_reason());
    slot.persist_verdict         = logic::checkup_restore_verdict(
        reason, slot.P().magic, slot.P().version, slot.P().layout_fp, want_fp, slot.P().crc,
        checkup_persist_crc(slot), safe_mode_active(), diagnostics_enabled,
        slot.P().diagnostics_generation, diagnostics_generation, slot.P().boots_since_commit,
        slot.persist_magic);
    const logic::CheckupRestore integrity = slot.persist_verdict;
    slot.boot_handoff_valid =
        logic::checkup_restore_keeps_dhw_handoff(integrity) && slot.P().source_fp != 0 &&
        slot.P().dhw_handoff.payload.source_fp == slot.P().source_fp &&
        logic::checkup_dhw_handoff_valid(slot.P().dhw_handoff.magic, slot.P().dhw_handoff.version,
                                         slot.P().dhw_handoff.layout_fp,
                                         slot.P().dhw_handoff.model_fp, slot.P().model_fp,
                                         slot.P().dhw_handoff.crc, slot.P().dhw_handoff.payload);
    if (slot.boot_handoff_valid) {
        slot.boot_handoff         = slot.P().dhw_handoff.payload;
        slot.boot_handoff.pending = kEmptyDhwLossBucket;
        slot.boot_handoff_model   = slot.P().model_fp;
    }
    // Consume before any producer or detection exists. A second panic cannot replay the handoff.
    slot.P().dhw_handoff.magic = 0;
    slot.source_confirmed      = false;
    slot.model_fp              = 0;
    slot.source_fp             = 0;
    persist_wipe(slot);
    slot.flash_pending   = flash_pending;
    slot.persist_verdict = logic::checkup_restore_route(integrity);
    if (slot.persist_verdict == logic::CheckupRestore::FlashPending && !flash_pending)
        slot.persist_verdict = logic::CheckupRestore::Fresh;
    diag_printf("%s: completed RAM hours retired (%s); dated flash restoration requires clock and "
                "confirmed source\n",
                slot.is_modbus ? "checkup(modbus)" : "checkup",
                logic::checkup_restore_slug(slot.persist_verdict));
}

void slot_set_diagnostics(CheckupSlot& slot, bool enabled, bool generation_changed) {
    slot.boot_handoff_valid = false;
    if (generation_changed) {
        retire_cycling_locked(slot);
        slot.reset_requested.store(false);
        slot.dhw_reset_requested.store(false);
        slot.state     = logic::CheckupState{};
        slot.dhw_state = kFreshDhwLossState;
        slot.cov       = logic::CheckupCoverage{};
        slot.fault_now = daik::FaultClass::Unknown;
        persist_wipe(slot);
        slot.persist_verdict = enabled ? logic::CheckupRestore::DiagnosticsChanged
                                       : logic::CheckupRestore::DiagnosticsDisabled;
        return;
    }
    const bool     run_open  = slot.state.run_open;
    const uint32_t run_start = slot.state.run_start_bucket;
    if (logic::checkup_pause_state(slot.state, slot.P().ring.pending, &slot.P().ring))
        logic::checkup_journal_revision_arm(slot.revision, run_open, run_start);
    slot.dhw_state      = kFreshDhwLossState;
    slot.fault_now      = daik::FaultClass::Unknown;
    slot.pressure_now   = -1;
    slot.source_last_us = -1;
    if (enabled && slot.persist_verdict == logic::CheckupRestore::DiagnosticsDisabled) {
        slot.persist_verdict =
            slot.flash_pending ? logic::CheckupRestore::FlashPending : logic::CheckupRestore::Fresh;
    }
    checkup_persist_seal(slot);
}

} // namespace

// Judge what the previous boot left in .noinit. Called from app_main BEFORE any producer task
// exists, so the whole decision is single-threaded and needs no lock — the same property
// history_start() relies on.
void checkup_start(bool diagnostics_enabled, uint32_t diagnostics_generation) {
    if (!s_mtx) {
        s_mtx = xSemaphoreCreateMutex();
        if (!s_mtx) diag_printf("checkup: mutex alloc failed — observation disabled this boot\n");
    }
    s_stop_context       = {};
    s_stop_inputs        = {};
    s_stop_generation    = 0;
    s_stop_allow_restore = true;
    s_stop_read_fence_us = -1;
    stop_observation_start(diagnostics_enabled, diagnostics_generation);
    const uint32_t dhw_fp = circulation_identity();
    s_requested_dhw_source_fp.store(dhw_fp);
    s_diagnostics_enabled.store(diagnostics_enabled, std::memory_order_release);
    s_diagnostics_generation = diagnostics_generation;
    const bool flash_pending    = history_checkup_flash_pending();
    const bool mb_flash_pending = history_modbus_checkup_flash_pending();
    slot_start(s_x10a, diagnostics_enabled, diagnostics_generation, dhw_fp, flash_pending);
    slot_start(s_modbus, diagnostics_enabled, diagnostics_generation, dhw_fp, mb_flash_pending);
    const esp_err_t shutdown_err = esp_register_shutdown_handler(checkup_reboot_save);
    if (shutdown_err != ESP_OK)
        diag_printf("checkup: DHW shutdown handler not registered (%s)\n",
                    esp_err_to_name(shutdown_err));
}

void checkup_set_diagnostics(bool enabled, uint32_t generation) {
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    const bool generation_changed = generation == 0 || generation != s_diagnostics_generation;
    s_diagnostics_epoch.fetch_add(1, std::memory_order_acq_rel);
    s_diagnostics_enabled.store(enabled, std::memory_order_release);
    s_diagnostics_generation = generation;
    s_stop_context           = {};
    if (generation_changed) s_stop_allow_restore = false;
    stop_observation_set_diagnostics(enabled, generation);
    if (s_x10a.source_confirmed)
        stop_observation_bind(s_x10a.source_fp, s_x10a.model_fp, s_stop_inputs.schema_fp,
                              s_stop_generation, !generation_changed && s_stop_allow_restore);
    slot_set_diagnostics(s_x10a, enabled, generation_changed);
    slot_set_diagnostics(s_modbus, enabled, generation_changed);
}

void checkup_reset() {
    // Arm under the same mutex as record consumption. The HTTP path bumps the source generation
    // first, then waits here; an old-link cycle can therefore never consume this new reset and seed
    // the cleared window with its own sample.
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    retire_cycling_locked(s_x10a);
    s_x10a.boot_handoff_valid = false;
    // An explicit /detect or automatic-profile rewiring withdraws the old confirmation immediately.
    s_stop_context       = {};
    s_stop_inputs        = {};
    s_stop_allow_restore = false;
    stop_observation_reset();
    // Consuming the reset on an unidentified cycle must not let the journal re-admit the old link.
    s_x10a.source_confirmed = false;
    s_x10a.source_fp        = 0;
    s_x10a.model_fp         = 0;
    s_x10a.persist_verdict  = logic::CheckupRestore::ModelChanged;
    s_x10a.reset_requested.store(true);
}

void checkup_modbus_reset() {
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    retire_cycling_locked(s_modbus);
    s_modbus.boot_handoff_valid = false;
    s_modbus.source_confirmed   = false;
    s_modbus.source_fp          = 0;
    s_modbus.model_fp           = 0;
    s_modbus.persist_verdict    = logic::CheckupRestore::ModelChanged;
    s_modbus.reset_requested.store(true);
}

// First automatic detection establishes this boot's full source scope. An explicit manual
// selection establishes the decoding contract for future samples, without proving a bus reply.
// Startup cached identity is only an expectation for a separately sealed handoff. Explicit resets
// retire pending journal adoption for this boot, even if selection names the same profile/link.
void checkup_reset_on_detect(const char* profile_id, uint32_t source_fp) {
    const auto     view        = def::lookup_view(profile_id);
    const uint32_t fp          = logic::checkup_model_fingerprint(profile_id, view);
    const auto     stop_inputs = logic::stop_context_input_plan(profile_id, view);
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    const bool first        = !s_x10a.source_confirmed;
    s_x10a.source_confirmed = source_fp != 0 && fp != 0;
    s_x10a.model_fp         = fp;
    s_x10a.source_fp        = source_fp;
    s_stop_context          = {};
    s_stop_inputs           = stop_inputs;
    s_stop_generation       = hp_poll_generation();
    if (!first) {
        s_stop_allow_restore = false;
        stop_observation_reset();
    }
    stop_observation_bind(source_fp, fp, stop_inputs.schema_fp, s_stop_generation,
                          s_stop_allow_restore);
    if (first) {
        // The stored startup scope was only an expectation. This call confirms the current source.
        if (s_x10a.source_confirmed && s_x10a.boot_handoff_valid &&
            !s_x10a.reset_requested.load() && !s_x10a.dhw_reset_requested.load() &&
            s_diagnostics_enabled.load(std::memory_order_acquire) &&
            s_x10a.boot_handoff_model == fp && s_x10a.boot_handoff.source_fp == source_fp &&
            s_x10a.boot_handoff.dhw_source_fp == s_x10a.dhw_source_fp) {
            logic::dhw_loss_adopt(s_x10a.dhw_state, s_x10a.boot_handoff.candidate,
                                  esp_timer_get_time());
            diag_printf("checkup: scoped DHW filter checkpoint applied; undated completed counters "
                        "discarded\n");
        }
        s_x10a.boot_handoff_valid = false;
        checkup_persist_seal(s_x10a);
        return;
    }
    s_x10a.boot_handoff_valid = false;
    s_x10a.persist_verdict    = logic::CheckupRestore::ModelChanged;
    retire_cycling_locked(s_x10a);
    s_x10a.reset_requested.store(true);
}

void checkup_modbus_confirm_source(ModbusProfile profile, uint32_t source_fp) {
    uint32_t fp = 0;
    if (profile == ModbusProfile::HomeHub) {
        fp = logic::checkup_modbus_model_fingerprint(profile, def::HOMEHUB_REGS,
                                                     def::HOMEHUB_REG_COUNT);
    } else if (profile == ModbusProfile::Altherma4) {
        fp = logic::checkup_modbus_model_fingerprint(profile, def::ALTHERMA4_REGS,
                                                     def::ALTHERMA4_REG_COUNT);
    }
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (s_modbus.source_confirmed && s_modbus.model_fp == fp && s_modbus.source_fp == source_fp)
        return;
    const bool first          = !s_modbus.source_confirmed;
    s_modbus.source_confirmed = source_fp != 0 && fp != 0;
    s_modbus.model_fp         = fp;
    s_modbus.source_fp        = source_fp;
    if (first) {
        if (s_modbus.source_confirmed && s_modbus.boot_handoff_valid &&
            !s_modbus.reset_requested.load() && !s_modbus.dhw_reset_requested.load() &&
            s_diagnostics_enabled.load(std::memory_order_acquire) &&
            s_modbus.boot_handoff_model == fp && s_modbus.boot_handoff.source_fp == source_fp &&
            s_modbus.boot_handoff.dhw_source_fp == s_modbus.dhw_source_fp) {
            logic::dhw_loss_adopt(s_modbus.dhw_state, s_modbus.boot_handoff.candidate,
                                  esp_timer_get_time());
            diag_printf("checkup(modbus): scoped DHW filter checkpoint applied; undated completed "
                        "counters discarded\n");
        }
        s_modbus.boot_handoff_valid = false;
        checkup_persist_seal(s_modbus);
        return;
    }
    s_modbus.boot_handoff_valid = false;
    s_modbus.persist_verdict    = logic::CheckupRestore::ModelChanged;
    retire_cycling_locked(s_modbus);
    s_modbus.reset_requested.store(true);
}

void checkup_dhw_reset() {
    // The saved configuration is already committed when its MQTT owner calls this. Read it before
    // acquiring the checkup mutex; no Config/string copy or nested config/checkup lock is needed.
    s_requested_dhw_source_fp.store(circulation_identity());
    s_dhw_identity_generation.fetch_add(1);
    s_x10a.dhw_reset_requested.store(true);
    s_modbus.dhw_reset_requested.store(true);
}

uint32_t checkup_consent_epoch() { return s_diagnostics_epoch.load(std::memory_order_acquire); }

void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running,
                    const logic::CheckupCoverage& coverage, uint32_t source_generation,
                    uint32_t consent_epoch, bool profile_confirmed) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;
    if (!s_mtx) return;   // checkup_start() creates it; absent means its alloc failed -> no observation
    if (!v && n) return;

    logic::CheckupSample s;
    int64_t              unix_s  = -1;
    int32_t              unix_ms = 0;
    time_now(unix_s, unix_ms);
    if (unix_s > 0 && unix_s <= UINT32_MAX) s.unix_s = static_cast<uint32_t>(unix_s);
    s.rps_known   = rps_known;
    s.rps_running = rps_running;
    s.x10a_blind  = !n; // a held or failed cycle read nothing: bounded blind time, not a lost row

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
    const uint32_t dhw_generation         = s_dhw_identity_generation.load();
    const uint32_t circulation_generation = circulation_source_generation();
    // Allocation-free, including on the OOM catch and TLS hold paths: the applied source epoch
    // alone withdraws a replaced witness, so no Config copy is needed on this per-cycle path.
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
    if (!s_diagnostics_enabled.load(std::memory_order_acquire) ||
        consent_epoch != s_diagnostics_epoch.load(std::memory_order_acquire))
        return;
    if (!hp_poll_generation_matches(source_generation)) return;
    // A software restart sealed the open hour for the shutdown drain: keep it as it was dated.
    if (s_x10a.seal_bucket != INT64_MIN) return;

    // A request can arrive while an old-link sweep is in flight. If this cycle consumes it, discard
    // the whole sample after clearing state; otherwise the tail of old poll A would seed the window
    // that new-link poll B continues. Dropping at most the first new sample is the conservative side.
    if (apply_reset_locked(s_x10a)) return;
    const bool s_source_confirmed = s_x10a.source_confirmed;
    if (!stop_context_suppressed_locked() && s_source_confirmed && s_stop_inputs.schema_fp &&
        now >= s_stop_read_fence_us) {
        // Bind a newly admitted live generation before consuming any of its inputs. No event from
        // the preceding source is admitted into the replacement lifecycle.
        if (source_generation != s_stop_generation) {
            s_stop_context       = {};
            s_stop_generation    = source_generation;
            s_stop_allow_restore = false;
            stop_observation_bind(s_x10a.source_fp, s_x10a.model_fp, s_stop_inputs.schema_fp,
                                  source_generation, false);
        }
        const auto stop_sample =
            logic::stop_context_collect(s_stop_inputs, v, n, rps_known, rps_running);
        const auto stop_event =
            logic::stop_context_step(s_stop_context, stop_sample, now, source_generation);
        stop_observation_record(now, stop_sample.rps_known, stop_event);
    }
    const bool discard_dhw_sample = apply_dhw_reset_locked(s_x10a) ||
                                    dhw_generation != s_dhw_identity_generation.load() ||
                                    circulation_generation != circulation_source_generation();
    // OOM/TLS callbacks report an observation gap, not a newly resolved empty profile. A genuine
    // unidentified-profile cycle still supplies confirmed empty coverage and withdraws capability.
    if (profile_confirmed) s_x10a.cov = coverage;
    s_x10a.fault_now    = s.fault;
    s_x10a.pressure_now = s.bar_ok && s.bar_tenths >= 0 ? s.bar_tenths : -1;
    if (n) s_x10a.source_last_us = now;
    commit_and_fold_locked(s_x10a, s, now, bucket, discard_dhw_sample);
}

void checkup_record_modbus(const CachedValue* v, size_t n, ModbusProfile profile,
                           uint32_t source_generation, uint32_t consent_epoch,
                           bool source_confirmed) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;
    if (!s_mtx) return;
    if (!v && n) return;

    const logic::CheckupCoverage cov = logic::checkup_modbus_coverage(profile);
    logic::CheckupSample         s;
    int64_t                      unix_s  = -1;
    int32_t                      unix_ms = 0;
    time_now(unix_s, unix_ms);
    if (unix_s > 0 && unix_s <= UINT32_MAX) s.unix_s = static_cast<uint32_t>(unix_s);
    s.x10a_blind = !n;

    for (size_t i = 0; i < n; ++i) {
        const CachedValue&     cv  = v[i];
        const def::HomeHubReg* row = modbus_row_for_cv(cv, profile);
        if (!row || row->space != MbFunc::ReadInput) continue;
        int val = 0;
        switch (row->offset) {
        case 21:
            if (exact_int(cv, val)) {
                if (val == 0)
                    s.fault = FaultClass::Normal;
                else if (val == 1)
                    s.fault = FaultClass::Error;
                else if (val == 2)
                    s.fault = FaultClass::Warning;
            }
            break;
        case 30:
            if (exact_int(cv, val) && (val == 0 || val == 1)) {
                s.pump_known = true;
                s.pump_on    = (val == 1);
            }
            break;
        case 31:
            if (exact_int(cv, val) && (val == 0 || val == 1)) {
                s.rps_known   = true;
                s.rps_running = (val == 1);
            }
            break;
        case 32:
            if (exact_int(cv, val) && (val == 0 || val == 1)) {
                s.bsh_known = true;
                s.bsh_on    = (val == 1);
            }
            break;
        case 37:
            if (exact_int(cv, val) && (val == 0 || val == 1)) {
                s.valve_known = true;
                s.valve_dhw   = (val == 1);
            }
            break;
        case 38:
            if (exact_int(cv, val)) {
                if (val == 1)
                    s.operating_mode = logic::CheckupOperatingMode::Heating;
                else if (val == 2)
                    s.operating_mode = logic::CheckupOperatingMode::Cooling;
                else if (val == 0 &&
                         (profile == ModbusProfile::Altherma4 ||
                          row->kind == def::HomeHubValueKind::Altherma4CurrentOperationMode))
                    s.operating_mode = logic::CheckupOperatingMode::Other;
            }
            break;
        case 43:
            s.r5t_ok = tenths(cv, s.r5t_tenths);
            break;
        case 44: {
            int outdoor_t = 0;
            if (tenths(cv, outdoor_t)) {
                s.outdoor = logic::outdoor_homehub_evidence(true, true,
                                                            static_cast<double>(outdoor_t) / 10.0);
            }
            break;
        }
        case 49:
            if (cov.flow) s.flow_ok = tenths(cv, s.flow_tenths);
            break;
        default:
            break;
        }
    }

    const uint32_t              dhw_generation         = s_dhw_identity_generation.load();
    const uint32_t              circulation_generation = circulation_source_generation();
    const CirculationPumpSample circulation            = circulation_pump_sample();
    s.circulation_configured                           = circulation.configured;
    s.circulation_known                                = circulation.known;
    s.circulation_on                                   = circulation.on;

    const int64_t  now    = esp_timer_get_time();
    const uint32_t bucket = logic::checkup_bucket(now);

    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (!consent_admitted(consent_epoch)) return;
    if (!mb_target_generation_matches(source_generation)) return;
    if (s_modbus.seal_bucket != INT64_MIN) return;
    if (apply_reset_locked(s_modbus)) return;
    if (!source_confirmed && !s_modbus.source_confirmed) return;
    const bool discard_dhw_sample = apply_dhw_reset_locked(s_modbus) ||
                                    dhw_generation != s_dhw_identity_generation.load() ||
                                    circulation_generation != circulation_source_generation();
    if (source_confirmed) s_modbus.cov = cov;
    s_modbus.fault_now    = s.fault;
    s_modbus.pressure_now = -1;
    if (n) s_modbus.source_last_us = now;
    commit_and_fold_locked(s_modbus, s, now, bucket, discard_dhw_sample);
}

static void expire_restored_locked(CheckupSlot& slot);

void checkup_stop_context_expire(int64_t) {
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk || !s_diagnostics_enabled.load(std::memory_order_acquire) ||
        s_x10a.reset_requested.load() || s_x10a.seal_bucket != INT64_MIN)
        return;
    if (stop_context_suppressed_locked()) return;
    // A history tick may have waited behind a newer poll. Read time after admission so a stale
    // caller timestamp cannot masquerade as a regressed monotonic clock.
    const int64_t now_us = esp_timer_get_time();
    const auto    event  = logic::stop_context_expire(s_stop_context, now_us);
    if (event.valid) {
        stop_observation_record(now_us, false, event);
        s_stop_read_fence_us = now_us;
    }
}

CheckupStopContextReport checkup_stop_context_report() {
    CheckupStopContextReport r;
    if (!s_mtx) {
        r.observation.restore_pending = !stop_observation_suppressed();
        return r;
    }
    Lock lk(s_mtx);
    if (!lk) {
        r.observation.restore_pending = !stop_observation_suppressed();
        return r;
    }
    if (stop_context_suppressed_locked()) {
        r.observation.restore_pending = false;
        return r;
    }
    if (!s_diagnostics_enabled.load(std::memory_order_acquire) || s_x10a.reset_requested.load()) {
        r.observation           = stop_observation_report();
        r.observation.confirmed = false;
        return r; // preserve the reset barrier's pending durability without admitting old evidence
    }
    const int64_t now   = esp_timer_get_time();
    const auto    event = logic::stop_context_expire(s_stop_context, now);
    if (event.valid) {
        stop_observation_record(now, false, event);
        s_stop_read_fence_us = now;
    }
    r.observation     = stop_observation_report();
    r.capability_mask = logic::stop_context_capabilities(s_stop_inputs);
    r.pending         = s_stop_context.pending.valid;
    if (stop_context_suppressed_locked()) {
        r                             = kEmptyStopReport;
        r.observation.restore_pending = false;
    }
    return r;
}

static void expire_restored_locked(CheckupSlot& slot) {
    const int64_t now_us       = esp_timer_get_time();
    auto&         s_slot_times = slot.slot_times;
    bool          changed      = false;
    for (size_t i = 0; i < logic::CHECKUP_COMPLETED_BUCKETS; ++i) {
        if (!logic::checkup_restored_expired(s_slot_times.expiry_us[i], now_us)) continue;
        slot.P().ring.buf[i]                = logic::CheckupBucket{};
        slot.P().dhw.buf[i]                 = kEmptyDhwLossBucket;
        s_slot_times.expiry_us[i]           = logic::CHECKUP_EXPIRED_SLOT_US;
        s_slot_times.restored_end_unix_s[i] = 0;
        changed                             = true;
    }
    // A stopped or paused producer must not extend the pending hour's lifetime to last-sample+24 h.
    const int64_t pending_start_us =
        static_cast<int64_t>(slot.state.bucket) * logic::CHECKUP_DT_S * 1000000LL;
    if (slot.state.have_bucket &&
        logic::checkup_restored_expired(logic::checkup_live_expiry_us(pending_start_us), now_us)) {
        slot.P().ring.pending = logic::CheckupBucket{};
        slot.P().dhw.pending  = kEmptyDhwLossBucket;
        slot.state            = logic::CheckupState{};
        slot.dhw_state        = kFreshDhwLossState;
        slot.fault_now        = FaultClass::Unknown;
        slot.pressure_now     = -1;
        changed               = true;
    }
    if (changed) checkup_persist_seal(slot);
}

// The caller owns the checkup mutex and has expired the same window used by the report.
[[gnu::noinline]] static logic::CheckupCyclingHours
checkup_cycling_hours_locked(const CheckupSlot& slot, int64_t now_us) {
    auto hours  = logic::checkup_cycling_hours(slot.P().ring, slot.cov.rps);
    hours.epoch = slot.cycling_hours_epoch;
    if (!hours.count) return hours;
    hours.newest_bucket  = slot.cycling_newest_bucket;
    const auto&   ring   = slot.P().ring;
    const size_t  oldest = ring.count < logic::CHECKUP_COMPLETED_BUCKETS ? 0 : ring.head;
    const int64_t pending_start_us =
        static_cast<int64_t>(hours.newest_bucket) * logic::CHECKUP_DT_S * 1000000LL;
    hours.pending_elapsed_s = logic::checkup_cycling_elapsed_s(pending_start_us, now_us);
    int64_t unix_s          = -1;
    int32_t ms              = 0;
    time_now(unix_s, ms);
    for (size_t i = 0; i < ring.count; ++i) {
        const size_t   idx       = (oldest + i) % logic::CHECKUP_COMPLETED_BUCKETS;
        const int64_t  expiry_us = slot.slot_times.expiry_us[idx];
        const uint32_t saved_end = slot.slot_times.restored_end_unix_s[idx];
        if (expiry_us == logic::CHECKUP_EXPIRED_SLOT_US) {
            hours.hours[i].provenance = logic::CheckupCyclingSlot::Expired;
        } else if (saved_end) {
            hours.hours[i].provenance = logic::CheckupCyclingSlot::Restored;
            if (saved_end != UINT32_MAX) hours.end_unix_s[i] = saved_end;
        } else if (expiry_us > 0) {
            // The per-slot deadline follows its actual hour through journal reconstruction.
            const int64_t end_us =
                expiry_us - static_cast<int64_t>(logic::CHECKUP_RECORD_MAX_AGE_S) * 1000000LL;
            hours.end_unix_s[i] = logic::checkup_cycling_end_unix_s(end_us, now_us, unix_s, ms);
        }
    }
    return hours;
}

bool checkup_has_data(DiagnosticsSource source) {
    if (!s_mtx) return false;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx);
    if (!lk.acquired() || s_diagnostics_generation == 0 || slot.reset_requested.load())
        return false;
    expire_restored_locked(slot);
    const int64_t now_us = esp_timer_get_time();
    if (slot.source_last_us >= 0 && !logic::checkup_restored_expired(
                                        logic::checkup_live_expiry_us(slot.source_last_us), now_us))
        return true;
    const auto window = logic::checkup_aggregate(slot.P().ring);
    if (window.covered_s > 0) return true;
    const auto dhw = logic::dhw_loss_aggregate(slot.P().dhw);
    return dhw.windows > 0 || dhw.aborts > 0;
}

logic::CheckupCyclingEvidence checkup_cycling_evidence(DiagnosticsSource source) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire) || !s_mtx)
        return logic::CheckupCyclingEvidence{};
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx);
    if (!lk.acquired() || slot.reset_requested.load()) return logic::CheckupCyclingEvidence{};
    expire_restored_locked(slot);
    const auto window = logic::checkup_aggregate(slot.P().ring);
    return logic::checkup_cycling_evidence(window, slot.cov.valve && slot.cov.mode &&
                                                       window.class_observed_s > 0);
}

logic::CheckupReport checkup_report(logic::CheckupCyclingHours* hours,
                                    logic::CheckupCyclingTrace* trace,
                                    logic::CheckupRestore* persist, DiagnosticsSource source) {
    if (hours) {
        hours->count = 0;
        hours->epoch = 0;
    }
    if (trace) trace->unix_s = 0;
    if (persist) *persist = logic::CheckupRestore::Unknown;
    CheckupSlot& slot              = slot_for(source);
    const auto&  s_persist_verdict = slot.persist_verdict;
    if (!s_mtx) return logic::CheckupReport{};
    Lock lk(s_mtx);
    if (!lk.acquired()) return logic::CheckupReport{};
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) {
        if (persist) *persist = logic::CheckupRestore::DiagnosticsDisabled;
        return logic::CheckupReport{};
    }
    if (persist) *persist = s_persist_verdict;
    // Only the record path consumes a reset, because it can also discard the in-flight sample.
    // Until then expose an empty report, never stale identity A and never consume the guard early.
    if (slot.reset_requested.load()) return logic::CheckupReport{};
    expire_restored_locked(slot);
    const int64_t now_us = esp_timer_get_time();
    if (hours) *hours = checkup_cycling_hours_locked(slot, now_us);
    if (trace && !cycling_snapshot_locked(slot, *trace, now_us)) trace->unix_s = 0;
    const bool     have_source   = slot.source_last_us >= 0 && now_us >= slot.source_last_us;
    const int64_t  source_gap_us = have_source ? now_us - slot.source_last_us : 0;
    const uint32_t source_age_s =
        have_source
            ? static_cast<uint32_t>(std::min<int64_t>(source_gap_us / 1000000, UINT32_MAX - 1))
            : UINT32_MAX;
    const bool source_fresh =
        have_source && source_gap_us <= static_cast<int64_t>(logic::CHECKUP_MAX_GAP_S) * 1000000LL;
    const int64_t live_span_us =
        slot.P().ring.first_sample_us >= 0 && now_us >= slot.P().ring.first_sample_us
            ? now_us - slot.P().ring.first_sample_us
            : 0;
    const uint32_t span_s    = static_cast<uint32_t>(std::min<int64_t>(
        logic::CHECKUP_WINDOW_S, live_span_us / 1000000 + slot.P().ring.carried_span_us / 1000000));
    auto           window    = logic::checkup_aggregate(slot.P().ring);
    window.full_span         = span_s >= logic::CHECKUP_WINDOW_S;
    logic::DhwLossWindow dhw = slot.dhw_reset_requested.load()
                                   ? logic::DhwLossWindow{}
                                   : logic::dhw_loss_aggregate(slot.P().dhw);
    dhw.full_span = logic::dhw_loss_scope_full(window.full_span, slot.dhw_scope_us, now_us);
    logic::CheckupReport report = logic::checkup_evaluate(
        window, slot.cov, source_fresh ? slot.fault_now : FaultClass::Unknown, dhw,
        slot.is_modbus ? logic::OutdoorSource::HomeHub : logic::OutdoorSource::X10a);
    report.pressure_current_tenths = source_fresh ? slot.pressure_now : -1;
    if (source_fresh && !slot.dhw_reset_requested.load()) {
        const int64_t progress_us =
            slot.dhw_state.last_us >= 0 ? std::min(now_us, slot.dhw_state.last_us) : now_us;
        const logic::DhwLossProgress p = logic::dhw_loss_progress(slot.dhw_state, progress_us);
        report.dhw_candidate_s         = p.candidate_observed_s;
        report.dhw_settle_remaining_s  = p.settle_remaining_s;
    }
    logic::checkup_apply_freshness(report, source_fresh, source_age_s, span_s);
    return report;
}

bool checkup_flash_next(int64_t now_unix_s, int64_t after_bucket, int64_t& bucket,
                        logic::CheckupJournalPayload& payload, DiagnosticsSource source) {
    if (!s_mtx || now_unix_s < 0) return false;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx, 0);
    if (!lk.acquired() || s_diagnostics_generation == 0 || slot.reset_requested.load() ||
        !slot.model_fp || !slot.source_confirmed || !slot.source_fp ||
        slot.P().ring.count != slot.P().dhw.count)
        return false;

    if (slot.last_commit_us != kNoCommitUs && slot.live_commit_count && slot.P().ring.count) {
        const int64_t now_us = esp_timer_get_time();
        if (now_us < slot.last_commit_us) return false;
        const int64_t latest_end_unix_s = now_unix_s - (now_us - slot.last_commit_us) / 1000000;
        const int64_t newest            = latched_newest_locked(slot, latest_end_unix_s);
        if (newest == INT64_MIN) return false;
        const size_t live_count = slot.live_commit_count < slot.P().ring.count
                                      ? slot.live_commit_count
                                      : slot.P().ring.count;
        const auto   current    = static_cast<uint32_t>(
            slot.last_commit_us / (static_cast<int64_t>(logic::CHECKUP_DT_S) * 1000000LL));
        const int64_t revision = logic::checkup_journal_revision_take(
            slot.revision, slot.revision_acked.load(), newest, current, live_count, after_bucket);
        const int64_t target =
            logic::checkup_journal_next_target(after_bucket, newest, live_count, revision);
        if (target != INT64_MIN) {
            if (logic::checkup_journal_revision_emit(slot.revision, target, revision))
                slot.revision_acked.store(INT64_MIN);

            const size_t age = static_cast<size_t>(newest - target);
            const size_t ring_i = (static_cast<size_t>(slot.P().ring.head) +
                                   logic::CHECKUP_COMPLETED_BUCKETS - 1 - age) %
                                  logic::CHECKUP_COMPLETED_BUCKETS;
            const size_t dhw_i = (static_cast<size_t>(slot.P().dhw.head) +
                                  logic::CHECKUP_COMPLETED_BUCKETS - 1 - age) %
                                 logic::CHECKUP_COMPLETED_BUCKETS;
            payload                        = logic::CheckupJournalPayload{};
            payload.model_fp               = slot.model_fp;
            payload.source_fp              = slot.source_fp;
            payload.dhw_source_fp          = slot.dhw_source_fp;
            payload.diagnostics_generation = s_diagnostics_generation;
            payload.end_unix_s             = logic::checkup_journal_end_in_bucket(
                latest_end_unix_s - static_cast<int64_t>(age) * logic::CHECKUP_DT_S, target);
            payload.checkup = slot.P().ring.buf[ring_i];
            payload.dhw     = slot.P().dhw.buf[dhw_i];
            if (logic::checkup_journal_dhw_withheld(slot.dhw_restart_armed, slot.dhw_restart_bucket,
                                                    current, age)) {
                payload.dhw_source_fp = 0;
                payload.dhw           = kEmptyDhwLossBucket;
            }
            bucket = target;
            return logic::checkup_journal_bucket(payload.end_unix_s) == target;
        }
    }
    return sealed_flash_next_locked(slot, after_bucket, bucket, payload);
}

void checkup_flash_appended(int64_t bucket, DiagnosticsSource source) {
    slot_for(source).revision_acked.store(bucket);
}

CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t now_unix_s, DiagnosticsSource source) {
    if (!s_mtx || now_unix_s < 0 || (!records && count))
        return CheckupFlashRestoreResult::Ignored;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx, 0);
    if (!lk.acquired()) return CheckupFlashRestoreResult::Deferred;
    if (s_diagnostics_generation == 0) return CheckupFlashRestoreResult::Ignored;
    if (logic::checkup_flash_restore_retired(slot.persist_verdict))
        return CheckupFlashRestoreResult::Ignored;
    if (!logic::checkup_flash_source_ready(slot.source_confirmed, slot.model_fp, slot.source_fp,
                                           slot.reset_requested.load()))
        return CheckupFlashRestoreResult::Deferred;
    if (slot.persist_verdict == logic::CheckupRestore::Flash)
        return CheckupFlashRestoreResult::Ignored;
    const auto fresh_if_pending = [&slot] {
        slot.flash_pending = false;
        if (slot.persist_verdict == logic::CheckupRestore::FlashPending)
            slot.persist_verdict = logic::CheckupRestore::Fresh;
        return CheckupFlashRestoreResult::Ignored;
    };
    auto P = [&slot]() -> PersistedCheckup& { return slot.P(); };

    const int64_t now_us          = esp_timer_get_time();
    const bool                    reset_requested = slot.reset_requested.load();
    logic::CheckupJournalLiveSpan live;
    if (P().ring.count && P().ring.count == P().dhw.count && slot.last_commit_us != kNoCommitUs &&
        now_us >= slot.last_commit_us) {
        const int64_t latest_end   = now_unix_s - (now_us - slot.last_commit_us) / 1000000;
        const int64_t newest_label = latched_newest_locked(slot, latest_end);
        if (newest_label != INT64_MIN) {
            live.count =
                slot.live_commit_count < P().ring.count ? slot.live_commit_count : P().ring.count;
            live.oldest_slot = (static_cast<size_t>(P().ring.head) +
                                logic::CHECKUP_COMPLETED_BUCKETS - live.count) %
                               logic::CHECKUP_COMPLETED_BUCKETS;
            live.newest_label      = newest_label;
            live.newest_end_unix_s = latest_end;
        }
    }

    int64_t earliest_bucket = INT64_MAX;
    int64_t latest_bucket   = INT64_MIN;
    auto    span_to         = [&](int64_t bucket) {
        if (bucket < earliest_bucket) earliest_bucket = bucket;
        if (bucket > latest_bucket) latest_bucket = bucket;
    };
    for (size_t i = 0; i < count; i++) {
        // Saved labels cannot extend the live tail. Duplicates inside it lose to live evidence.
        if (live.count && records[i].bucket > live.newest_label) continue;
        if (!logic::checkup_journal_restore_admits(
                records[i].payload, records[i].bucket, now_unix_s, slot.source_confirmed,
                slot.model_fp, slot.source_fp, s_diagnostics_generation, reset_requested))
            continue;
        span_to(records[i].bucket);
    }
    if (earliest_bucket == INT64_MAX) return fresh_if_pending();

    for (size_t k = 0; k < live.count; k++) {
        const int64_t label = logic::checkup_journal_live_label(live, k);
        if (logic::checkup_journal_live_index(live, label, now_unix_s, slot.source_confirmed,
                                              slot.model_fp, slot.source_fp, reset_requested) != k)
            return fresh_if_pending();
        span_to(label);
    }

    if (!live.count) {
        const int64_t before_open = logic::checkup_journal_bucket(now_unix_s) - 1;
        if (before_open > latest_bucket) latest_bucket = before_open;
    }
    const int64_t capacity_start =
        latest_bucket - static_cast<int64_t>(logic::CHECKUP_COMPLETED_BUCKETS - 1);
    if (earliest_bucket < capacity_start) earliest_bucket = capacity_start;

    size_t  materialized        = 0;
    int64_t earliest_stored_end = INT64_MAX;
    for (int64_t b = earliest_bucket; b <= latest_bucket; ++b) {
        const auto* rec =
            logic::checkup_journal_choose(b, live, records, count, now_unix_s,
                                          slot.source_confirmed, slot.model_fp, slot.source_fp,
                                          s_diagnostics_generation, reset_requested)
                .stored;
        if (!rec) continue;
        ++materialized;
        if (rec->payload.end_unix_s < earliest_stored_end)
            earliest_stored_end = rec->payload.end_unix_s;
    }
    if (!materialized) return fresh_if_pending();
    const auto wall_span_s =
        static_cast<uint32_t>(now_unix_s - earliest_stored_end) + logic::CHECKUP_DT_S;

    if (logic::checkup_journal_rebuild(P().ring, P().dhw, slot.slot_times, live, records, count,
                                       earliest_bucket, latest_bucket, now_unix_s, now_us,
                                       slot.source_confirmed, slot.model_fp, slot.source_fp,
                                       s_diagnostics_generation, reset_requested,
                                       slot.dhw_source_fp, slot.dhw_reset_requested.load()))
        slot.dhw_scope_us = now_us;
    P().ring.age_buckets = static_cast<uint8_t>(
        P().ring.count < logic::CHECKUP_BUCKETS ? P().ring.count : logic::CHECKUP_BUCKETS);

    // Subtract elapsed time through this restore, matching the read-time span baseline.
    const int64_t first_sample_us = P().ring.first_sample_us;
    const int64_t live_span_us =
        first_sample_us >= 0 && now_us >= first_sample_us ? now_us - first_sample_us : 0;
    const int64_t wall_span_us = static_cast<int64_t>(wall_span_s) * 1000000LL;
    P().ring.carried_span_us   = wall_span_us > live_span_us ? wall_span_us - live_span_us : 0;
    const logic::CheckupRestore refused = slot.persist_verdict;
    slot.flash_pending                  = false;
    slot.persist_verdict                = logic::CheckupRestore::Flash;
    if (!slot.state.have_bucket)
        slot.cycling_newest_bucket = static_cast<int32_t>(logic::checkup_bucket(now_us));
    ++slot.cycling_hours_epoch;
    checkup_persist_seal(slot);
    diag_printf("%s: restored %u hourly bucket(s) from flash (RAM copy refused: %s)\n",
                slot.is_modbus ? "checkup(modbus)" : "checkup", static_cast<unsigned>(materialized),
                logic::checkup_restore_slug(refused));
    return CheckupFlashRestoreResult::Restored;
}

bool checkup_cycling_checkpoint(logic::CheckupCyclingTrace&  trace,
                                logic::CyclingTraceIdentity& identity, uint32_t& reset_token,
                                TickType_t wait_ticks, bool allow_data, DiagnosticsSource source) {
    CheckupSlot& slot = slot_for(source);
    if (!s_mtx || slot.cycling_forgotten.load(std::memory_order_acquire)) return false;
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired() || slot.cycling_forgotten.load(std::memory_order_acquire)) return false;
    reset_token            = 0;
    const uint32_t pending = slot.cycling_reset_token.load(std::memory_order_relaxed);
    if (pending != slot.cycling_reset_acked.load(std::memory_order_acquire)) {
        trace.reset();
        trace.window_end_s = logic::CHECKUP_WINDOW_S;
        trace.unix_s       = 1;
        trace.live         = false;
        identity           = {};
        reset_token        = pending;
        return true;
    }
    const bool allow_checkpoint = s_diagnostics_enabled.load(std::memory_order_acquire) ||
                                  s_reboot_saved_this_boot.load(std::memory_order_acquire);
    if (!allow_data || !allow_checkpoint || s_diagnostics_generation == 0 ||
        slot.reset_requested.load() || !slot.cycling_trace.count ||
        !cycling_snapshot_locked(slot, trace, esp_timer_get_time()))
        return false;
    identity = {slot.model_fp, slot.source_fp, s_diagnostics_generation};
    return true;
}

bool checkup_cycling_reset_pending(DiagnosticsSource source) {
    const CheckupSlot& slot = slot_for(source);
    return slot.cycling_reset_token.load(std::memory_order_acquire) !=
           slot.cycling_reset_acked.load(std::memory_order_acquire);
}

void checkup_cycling_checkpoint_appended(uint32_t reset_token, DiagnosticsSource source) {
    if (reset_token)
        slot_for(source).cycling_reset_acked.store(reset_token, std::memory_order_release);
}

CheckupFlashRestoreResult checkup_cycling_restore(const logic::CheckupCyclingTrace&  trace,
                                                  const logic::CyclingTraceIdentity& identity,
                                                  int64_t now_unix_s, TickType_t wait_ticks,
                                                  DiagnosticsSource source) {
    using Result = CheckupFlashRestoreResult;
    CheckupSlot& slot = slot_for(source);
    if (slot.cycling_forgotten.load(std::memory_order_acquire)) return Result::Ignored;
    if (!s_mtx) return Result::Deferred;
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired()) return Result::Deferred;
    if (!trace.count || !slot.cycling_restore_allowed || s_diagnostics_generation == 0 ||
        slot.reset_requested.load() || slot.cycling_forgotten.load(std::memory_order_acquire))
        return Result::Ignored;
    if (!slot.source_confirmed || now_unix_s <= 0) return Result::Deferred;
    const int64_t observed_unix_s =
        static_cast<int64_t>(trace.unix_s) + trace.end_s - trace.window_end_s;
    if (slot.model_fp != identity.model_fp || slot.source_fp != identity.source_fp ||
        s_diagnostics_generation != identity.diagnostics_generation || trace.unix_s > now_unix_s ||
        observed_unix_s <= now_unix_s - logic::CHECKUP_WINDOW_S)
        return Result::Ignored;
    slot.cycling_restored = trace;
    return Result::Restored;
}

void checkup_cycling_forget() {
    s_x10a.cycling_forgotten.store(true, std::memory_order_release);
    s_modbus.cycling_forgotten.store(true, std::memory_order_release);
}

} // namespace daik
