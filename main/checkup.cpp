// The 24-hour plant diagnosis. Policy (which rows, what counts as an edge, the bucket math, the
// thresholds and the verdicts) lives in logic/checkup.hpp and is host-tested; this file is storage,
// one mutex, and the fold from a poll cycle into the open hour.
#include "checkup.hpp"
#include "diag_log.hpp"
#include "history.hpp" // startup journal availability, after history_start
#include "logic/checkup.hpp"
#include "logic/checkup_persist.hpp"  // WHEN a persisted window may be believed
#include "logic/crashinfo.hpp"        // crash_reason_slug — one reset vocabulary
#include "logic/defrost_start.hpp"
#include "logic/history.hpp" // history_parse_tenths — the ONE parse of a cached value
#include "logic/hydronic_input.hpp"
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
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>

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

struct PersistedFaultHandoff {
    uint32_t                   magic;
    uint16_t                   version;
    uint16_t                   reserved;
    uint32_t                   tail_gap_s;
    uint32_t                   model_fp;
    uint32_t                   crc;
    logic::FaultHandoffPayload payload;
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
    logic::EnergyRing   energy;
    // One-shot checkpoint written by esp_restart's shutdown handler.  It has its own seal because
    // ring integrity must remain usable to validate the handoff while this open state is changing.
    // checkup_start consumes it before any producer exists and retires all completed RAM hours.
    PersistedDhwHandoff   dhw_handoff;
    PersistedFaultHandoff fault_handoff;
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
constexpr logic::DhwLossState      kFreshDhwLossState{};
constexpr logic::DhwLossBucket     kEmptyDhwLossBucket{};
constexpr logic::EnergyBucket      kEmptyEnergyBucket{};
constexpr logic::EnergyAccumulator kEmptyEnergyAccumulator{};
constexpr logic::EnergyCoverage    kEmptyEnergyCoverage{};
constexpr logic::EnergyCoverage    kHomeHubEnergyCoverage =
    logic::energy_modbus_coverage(ModbusProfile::HomeHub);
constexpr logic::EnergyRing kEmptyEnergyRing{};
constexpr int64_t           kNoCommitUs = INT64_MIN;

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
    uint32_t                       cycling_restore_anchor    = 0;
    uint32_t                       cycling_checkpoint_anchor = 0;
    uint32_t                       cycling_checkpoint_end    = 0; // last offered monotonic end
    std::atomic<bool>              cycling_forgotten{false};
    bool                           cycling_restore_allowed = false;
    std::atomic<uint32_t>          cycling_reset_token{0};
    std::atomic<uint32_t>          cycling_reset_acked{0};
    uint32_t                       cycling_hours_epoch   = 0;
    int32_t                        cycling_newest_bucket = 0;
    logic::CheckupFaultTrace       fault_trace{};
    logic::CheckupFaultTrace       fault_restored{};
    uint32_t                       fault_restore_anchor = 0;
    int64_t                        fault_warm_gap_s     = -1;
    logic::FaultHandoffPayload     fault_boot_handoff{};
    uint32_t                       fault_boot_handoff_model      = 0;
    uint32_t                       fault_boot_handoff_tail_gap_s = 0;
    bool                           fault_boot_handoff_valid      = false;
    bool                           fault_trace_dirty             = false;
    bool                           fault_restore_allowed         = false;
    std::atomic<bool>              fault_forgotten{false};
    std::atomic<uint32_t>          fault_reset_token{0};
    std::atomic<uint32_t>          fault_reset_acked{0};
    // Capability of the CURRENT confirmed profile.
    ModbusProfile            modbus_profile = ModbusProfile::Auto;
    logic::CheckupCoverage   cov{};
    logic::EnergyCoverage    energy_cov{};
    logic::EnergyAccumulator energy_acc{};
    daik::FaultClass         fault_now      = daik::FaultClass::Unknown;
    int64_t                  source_last_us = -1; // actual source rows, never an empty gap callback
    int                      pressure_now   = -1;
    uint32_t                 pel_source_fp  = 0;
    std::atomic<bool>        reset_requested{false};
    std::atomic<bool>        dhw_reset_requested{false};
    std::atomic<bool>        energy_reset_requested{false};
    // End of the newest COMPLETED bucket in this boot's monotonic clock.
    int64_t last_commit_us = kNoCommitUs;
    // When DHW or energy evidence last restarted without the shared lifecycle, in this boot's
    // monotonic clock.
    int64_t dhw_scope_us           = -1;
    int64_t energy_scope_us        = -1;
    int64_t energy_carried_span_us = 0;
    uint8_t live_commit_count      = 0; // completed in THIS monotonic clock, max 23
    logic::CheckupJournalRevision revision{};
    std::atomic<int64_t>          revision_acked{INT64_MIN};
    int64_t                       journal_label_offset = INT64_MIN;
    bool                          dhw_restart_armed    = false;
    uint32_t                      dhw_restart_bucket   = 0;
    bool                          energy_restart_armed  = false;
    uint32_t                      energy_restart_bucket = 0;
    int64_t                       seal_bucket          = INT64_MIN;
    int64_t                       seal_end_unix_s      = INT64_MIN;
    bool                          flash_pending        = false;

    // Append optional runtime detail so existing field offsets and stack budgets stay unchanged.
    // Exact windows use their own flash page, separate from hourly aggregates.
    logic::DhwLossTrace   dhw_trace{};
    std::atomic<bool>     dhw_trace_forgotten{false};
    bool                  dhw_trace_restore_allowed = false;
    uint32_t              dhw_trace_clock_anchor_s  = 0;
    std::atomic<uint32_t> dhw_trace_barrier{0};
    std::atomic<uint32_t> dhw_trace_barrier_acked{0};
    std::atomic<uint32_t> dhw_trace_saved_end_s{0};

    CheckupSlot(PersistStore* st, uint32_t magic, bool mb)
        : store(st), persist_magic(magic), is_modbus(mb) {}
};

CheckupSlot s_x10a{&s_store, logic::CHECKUP_PERSIST_MAGIC, false};
CheckupSlot s_modbus{&s_mb_store, logic::CHECKUP_MODBUS_PERSIST_MAGIC, true};

CheckupSlot& slot_for(DiagnosticsSource source) {
    return source == DiagnosticsSource::Modbus ? s_modbus : s_x10a;
}

logic::StopContextState            s_stop_context;
logic::StopContextInputPlan        s_stop_inputs;
logic::DefrostStartTracker         s_defrost_start;
logic::CyclingRunContextTracker    s_run_ctx_tracker;
logic::CheckupRunContextTrace      s_run_ctx_trace;
logic::CheckupLocator              s_rwt_locator{};
bool                               s_defrost_air_supported = false;
bool                               s_rwt_supported         = false;
uint32_t                           s_stop_generation       = 0;
bool                               s_stop_allow_restore    = true;
int64_t                            s_stop_read_fence_us    = -1;
constexpr logic::StopContextState  kEmptyStopContext{};
constexpr CheckupStopContextReport kEmptyStopReport{};

// Called only with the Checkup lock. Recovery latches independently, before Store startup or
// while an owner is busy; retire the producer too so pending windows cannot outlive that intent.
bool stop_context_suppressed_locked() {
    if (!stop_observation_suppressed()) return false;
    s_stop_context = kEmptyStopContext;
    return true;
}

logic::HydronicTracker             s_hydronic;
logic::HydronicInputPlan           s_hydronic_inputs;
uint32_t                           s_hydronic_generation    = 0;
bool                               s_hydronic_allow_restore = true;
int64_t                            s_hydronic_read_fence_us = -1;
uint8_t                            s_hydronic_limitations   = 0;
uint8_t                            s_agree_limitations      = 0;
constexpr logic::HydronicInputPlan kEmptyHydronicInputs{};

__attribute__((noinline)) void clear_hydronic_runtime_locked() {
    s_hydronic.reset();
    // A selected capable plan is waiting for witnesses; it is not an unsupported model merely
    // because no sweep has arrived. Use the same collector's capability rules as admission.
    const auto empty = logic::hydronic_collect(
        s_hydronic_inputs, static_cast<const CachedValue*>(nullptr), 0, false, false);
    const auto base             = logic::hydronic_decide(empty);
    s_hydronic.reason           = base.reason;
    s_hydronic.agreement.reason = logic::agreement_decide(empty, base).reason;
    s_hydronic_read_fence_us    = -1;
    s_hydronic_limitations      = 0;
    s_agree_limitations         = 0;
}

void expire_hydronic_locked(int64_t now_us) {
    // Retained dated statistics do not extend a live qualification through an unread interval.
    // Expire once per completed observation; repeated readers must not keep advancing the fence.
    if (s_hydronic.last_us >= 0 &&
        (now_us < s_hydronic.last_us || now_us - s_hydronic.last_us > logic::HYDRONIC_MAX_GAP_US)) {
        logic::hydronic_poll_gap(s_hydronic);
        s_hydronic_read_fence_us = now_us;
        s_hydronic_limitations   = 0;
        s_agree_limitations      = 0;
    }
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

void retire_fault_locked(CheckupSlot& slot) {
    slot.fault_restore_allowed = false;
    slot.fault_restored.reset();
    slot.fault_restore_anchor = 0;
    slot.fault_warm_gap_s     = -1;
    slot.fault_trace_dirty    = false;
    const uint32_t next       = slot.fault_reset_token.load(std::memory_order_relaxed) + 1u;
    slot.fault_reset_token.store(next ? next : 1u, std::memory_order_release);
}

constexpr uint32_t kDhwTraceBarrierToken = uint32_t{1} << 31;

void arm_dhw_trace_barrier_locked(CheckupSlot& slot) {
    const uint32_t next = (slot.dhw_trace_barrier.load(std::memory_order_relaxed) + 1u) &
                          (kDhwTraceBarrierToken - 1u);
    slot.dhw_trace_barrier.store(kDhwTraceBarrierToken | next, std::memory_order_release);
}

void retire_dhw_trace_locked(CheckupSlot& slot) {
    slot.dhw_trace_restore_allowed = false;
    slot.dhw_trace_clock_anchor_s  = 0;
    slot.dhw_trace.reset();
    arm_dhw_trace_barrier_locked(slot);
}

[[gnu::noinline]] bool fault_snapshot_locked(CheckupSlot& slot, logic::CheckupFaultTrace& out,
                                             int64_t now_us, bool require_wall_clock) {
    if (slot.fault_forgotten.load(std::memory_order_acquire) || !slot.source_confirmed ||
        (!slot.fault_trace.count && !slot.fault_restored.count) || now_us < 0 ||
        now_us / 1000000 > logic::CheckupFaultTrace::max_second)
        return false;
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    const auto     boot_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall =
        logic::checkup_cycling_end_unix_s(now_us - now_us % 1000000, now_us, unix_s, ms);
    if (require_wall_clock && wall <= boot_s) return false;
    const uint32_t eff_wall = wall > boot_s ? wall : 0;
    if (eff_wall > boot_s)
        slot.fault_restore_anchor = std::max(slot.fault_restore_anchor, eff_wall - boot_s);
    const int64_t oldest_saved_unix = eff_wall > boot_s
                                          ? static_cast<int64_t>(slot.fault_restore_anchor) +
                                                boot_s - logic::CHECKUP_FAULT_WINDOW_S
                                          : 0;
    logic::checkup_fault_snapshot(out, slot.fault_restored, slot.fault_trace, eff_wall, boot_s,
                                  oldest_saved_unix, slot.fault_warm_gap_s);
    if (require_wall_clock && !out.unix_s) return false;
    return out.count > 0 && !slot.fault_forgotten.load(std::memory_order_acquire);
}

[[gnu::noinline]] uint8_t fault_saved_flags_locked(CheckupSlot& slot, int64_t now_us) {
    if (slot.fault_forgotten.load(std::memory_order_acquire) || !slot.source_confirmed ||
        !slot.fault_restored.count || now_us < 0 ||
        now_us / 1000000 > logic::CheckupFaultTrace::max_second)
        return 0;
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    const auto     boot_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall =
        logic::checkup_cycling_end_unix_s(now_us - now_us % 1000000, now_us, unix_s, ms);
    const uint32_t eff_wall = wall > boot_s ? wall : 0;
    if (eff_wall > boot_s)
        slot.fault_restore_anchor = std::max(slot.fault_restore_anchor, eff_wall - boot_s);
    const int64_t oldest_saved_unix = eff_wall > boot_s
                                          ? static_cast<int64_t>(slot.fault_restore_anchor) +
                                                boot_s - logic::CHECKUP_FAULT_WINDOW_S
                                          : 0;
    return logic::checkup_fault_saved_window_flags(slot.fault_restored, eff_wall, boot_s,
                                                   oldest_saved_unix, slot.fault_warm_gap_s);
}

uint32_t cycling_wall_time(int64_t now_us) {
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    return logic::checkup_cycling_end_unix_s(now_us - now_us % 1000000, now_us, unix_s, ms);
}

uint32_t cycling_restore_floor(const CheckupSlot& slot, uint32_t boot_s) {
    const int64_t floor =
        static_cast<int64_t>(slot.cycling_restore_anchor) + boot_s - logic::CHECKUP_WINDOW_S;
    return static_cast<uint32_t>(std::clamp<int64_t>(floor, 0, UINT32_MAX));
}

// The first stop after this start must be the same sample as the diagnostic stop. Treat only
// short unreadable intervals that return to a running state as continuous, as the chart does.
bool cycling_trace_has_run(const logic::CheckupCyclingTrace& trace, int64_t shift, uint32_t start_s,
                           uint32_t stop_s) {
    using Trace     = logic::CheckupCyclingTrace;
    bool    started = false;
    int64_t gap_at  = -1;
    for (size_t i = 0; i < trace.count; ++i) {
        const uint32_t record = trace.at(i);
        const int64_t  at     = shift + Trace::second(record);
        if (at < start_s) continue;
        if (at > stop_s) break;
        const auto kind = Trace::kind(record);
        if (kind == Trace::Start) {
            if (started || at != start_s) return false;
            started = true;
        } else if (started) {
            if (kind == Trace::Stop) return at == stop_s && gap_at < 0;
            if (kind == Trace::Gap) {
                if (gap_at < 0) gap_at = at;
            } else if (gap_at >= 0) {
                if (kind == Trace::Off || at - gap_at > logic::CHECKUP_CYCLING_GAP_S) return false;
                gap_at = -1;
            }
        }
    }
    return false;
}

[[gnu::noinline]] bool cycling_snapshot_locked(CheckupSlot& slot, logic::CheckupCyclingTrace& out,
                                               int64_t now_us, bool checkpoint = false) {
    if (slot.cycling_forgotten.load(std::memory_order_acquire) || !slot.source_confirmed ||
        (!slot.cycling_trace.count && !slot.cycling_restored.count) || now_us < 0 ||
        now_us / 1000000 > logic::CheckupCyclingTrace::max_second)
        return false;
    const auto     boot_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall   = cycling_wall_time(now_us);
    if (wall <= boot_s) return false;
    // Keep a monotonic age floor for restored data, even if the wall clock moves backwards.
    slot.cycling_restore_anchor = std::max(slot.cycling_restore_anchor, wall - boot_s);
    const bool journal_x10a     = checkpoint && !slot.is_modbus;
    uint32_t   frame_boot_s     = boot_s;
    uint32_t   frame_unix_s     = wall;
    if (journal_x10a) {
        // One date mapping for the X10A journal and its run details. Later corrections can
        // move the live chart, but must not re-date edges already used by a durable run record.
        const uint32_t observed_anchor = wall - boot_s;
        const int64_t step = static_cast<int64_t>(observed_anchor) - slot.cycling_checkpoint_anchor;
        if (!slot.cycling_checkpoint_anchor || step >= logic::CHECKUP_WINDOW_S ||
            step <= -static_cast<int64_t>(logic::CHECKUP_WINDOW_S)) {
            // The two date frames no longer span the same rolling day.
            slot.cycling_checkpoint_anchor = observed_anchor;
            slot.cycling_checkpoint_end    = 0;
        }
        if (wall < slot.cycling_checkpoint_anchor) return false;
        frame_boot_s = std::min(slot.cycling_trace.end_s, wall - slot.cycling_checkpoint_anchor);
        frame_unix_s = slot.cycling_checkpoint_anchor + frame_boot_s;
        // Clip future observations after a backward step, keeping the previous checkpoint if
        // the trim would drop data from a group we have already offered to flash.
        if (frame_boot_s < slot.cycling_checkpoint_end) return false;
    }
    logic::checkup_cycling_snapshot(out, slot.cycling_restored, slot.cycling_trace, frame_unix_s,
                                    frame_boot_s, cycling_restore_floor(slot, boot_s),
                                    journal_x10a);
    if (!out.unix_s || (journal_x10a && !out.live) ||
        slot.cycling_forgotten.load(std::memory_order_acquire))
        return false;
    if (journal_x10a) slot.cycling_checkpoint_end = frame_boot_s;
    return true;
}

uint32_t circulation_identity() {
    return with_config([](const Config& c) {
        return logic::checkup_dhw_source_fingerprint(
            c.mqtt_uri.c_str(), c.circulation_topic.c_str(), c.circulation_power_path.c_str(),
            c.circulation_time_path.c_str(), c.circulation_max_age_s, c.circulation_on_tenths_w,
            c.circulation_off_tenths_w, c.circulation_confirm_s);
    });
}

[[gnu::noinline]] uint32_t effective_pel_source_fp_locked(const CheckupSlot& slot) {
    if (slot.is_modbus) return logic::checkup_modbus_pel_source_fingerprint(slot.modbus_profile);
    return logic::checkup_x10a_pel_source_fingerprint(
        slot.energy_cov.ct_rows > 0, slot.energy_cov.has_inv && slot.energy_cov.has_rps);
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
    const auto& e   = p.energy;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(e.buf), sizeof(e.buf));
    crc = config_crc32_update(crc, &e.count, sizeof(e.count));
    crc = config_crc32_update(crc, &e.head, sizeof(e.head));
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

void reset_run_ctx_locked() {
    s_run_ctx_tracker.reset();
    s_run_ctx_trace.reset();
}

// `keep_handoff` spares the one-shot DHW checkpoint. Startup consumes it once and holds a
// compatible filter until current-source confirmation; every other wipe clears its record.
void persist_wipe(CheckupSlot& slot, bool keep_handoff = false) {
    slot.P().ring.reset();
    slot.P().dhw.reset();
    slot.P().energy.reset();
    slot.dhw_trace.reset();
    slot.cycling_trace.reset();
    slot.cycling_restored.reset();
    if (!slot.is_modbus) {
        s_defrost_start = {};
        reset_run_ctx_locked();
    }
    slot.cycling_restore_anchor    = 0;
    slot.cycling_checkpoint_anchor = 0;
    slot.cycling_checkpoint_end    = 0;
    slot.fault_trace.reset();
    slot.fault_restored.reset();
    slot.fault_restore_anchor = 0;
    slot.fault_warm_gap_s     = -1;
    slot.fault_trace_dirty    = false;
    for (auto& expiry : slot.slot_times.expiry_us) expiry = 0;
    for (auto& end : slot.slot_times.restored_end_unix_s) end = 0;
    ++slot.cycling_hours_epoch;
    slot.cycling_newest_bucket = 0;
    if (!keep_handoff) {
        slot.P().dhw_handoff.magic   = 0;
        slot.P().fault_handoff.magic = 0;
    }
    slot.P().boots_since_commit =
        0; // reserved integrity counter; no completed RAM hours are adopted
    slot.last_commit_us         = kNoCommitUs;
    slot.live_commit_count      = 0;
    slot.dhw_scope_us           = -1; // all rings restart together
    slot.energy_scope_us        = -1;
    slot.energy_carried_span_us = 0;
    slot.energy_acc             = kEmptyEnergyAccumulator;
    slot.source_last_us         = -1;
    slot.pressure_now           = -1;
    slot.revision               = {};    // the withdrawn hours have nothing left to re-append
    slot.dhw_restart_armed      = false; // no hour older than the wipe remains to be appended
    slot.energy_restart_armed   = false;
    slot.energy_restart_bucket  = 0;
    slot.seal_bucket = slot.seal_end_unix_s = INT64_MIN; // a wiped open hour has nothing to journal
    slot.flash_pending                      = false;
    // Retain model_fp for the next record; detection confirms it before consuming a reset.
    checkup_persist_seal(slot);
}

bool apply_reset_locked(CheckupSlot& slot) {
    if (!slot.reset_requested.exchange(false)) return false;
    slot.boot_handoff_valid       = false;
    slot.fault_boot_handoff_valid = false;
    slot.dhw_reset_requested.store(false);
    slot.energy_reset_requested.store(false);
    slot.state     = logic::CheckupState{};
    slot.dhw_state = kFreshDhwLossState;
    if (!slot.is_modbus) {
        s_stop_context = {};
        clear_hydronic_runtime_locked();
    }
    slot.cov       = logic::CheckupCoverage{};
    slot.fault_now = daik::FaultClass::Unknown;
    if (!slot.source_confirmed) {
        slot.modbus_profile = ModbusProfile::Auto;
        slot.energy_cov     = kEmptyEnergyCoverage;
    }
    slot.energy_acc             = kEmptyEnergyAccumulator;
    slot.energy_carried_span_us = 0;
    slot.energy_restart_armed   = false;
    slot.energy_restart_bucket  = 0;
    slot.pel_source_fp          = slot.source_confirmed ? effective_pel_source_fp_locked(slot) : 0;
    persist_wipe(slot); // clears rings and the checkpoint to withdraw the previous scope
    return true;
}

bool apply_dhw_reset_locked(CheckupSlot& slot) {
    if (!slot.dhw_reset_requested.exchange(false)) return false;
    slot.boot_handoff_valid = false;
    slot.P().dhw.reset();
    retire_dhw_trace_locked(slot);
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

bool apply_energy_reset_locked(CheckupSlot& slot) {
    if (!slot.energy_reset_requested.exchange(false)) return false;
    slot.P().energy.reset();
    slot.P().energy.head        = slot.P().ring.head;
    slot.P().energy.count       = slot.P().ring.count;
    slot.pel_source_fp          = effective_pel_source_fp_locked(slot);
    slot.energy_acc             = kEmptyEnergyAccumulator;
    slot.energy_carried_span_us = 0;
    slot.energy_scope_us        = esp_timer_get_time();
    slot.energy_restart_armed   = true;
    slot.energy_restart_bucket  = logic::checkup_bucket(slot.energy_scope_us);
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
        slot.P().energy.commit(slot.energy_acc.pending, skipped);
        slot.energy_acc.reset_pending(bucket, continuous_boundary ? now : -1);
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
        if (!discard_dhw_sample) {
            auto* const dhw_trace = slot.dhw_trace_forgotten.load(std::memory_order_acquire)
                                        ? nullptr
                                        : &slot.dhw_trace;
            logic::dhw_loss_step_traced(slot.dhw_state, slot.P().dhw.pending, s, dhw_trace, now);
        }
    } else {
        fold_checkup_locked(slot, s, now);
        if (!discard_dhw_sample) {
            auto* const dhw_trace = slot.dhw_trace_forgotten.load(std::memory_order_acquire)
                                        ? nullptr
                                        : &slot.dhw_trace;
            logic::dhw_loss_step_traced(slot.dhw_state, slot.P().dhw.pending, s, dhw_trace, now);
        }
    }
    if (!slot.state.have_bucket && slot.P().ring.count &&
        slot.cycling_newest_bucket != static_cast<int32_t>(bucket))
        ++slot.cycling_hours_epoch;
    slot.cycling_newest_bucket = static_cast<int32_t>(bucket);
    slot.state.bucket          = bucket;
    slot.state.have_bucket     = true;
}

[[gnu::noinline]] void fold_energy_locked(CheckupSlot& slot, const logic::EnergyStepInput& ein,
                                          uint32_t bucket, bool discard_energy_sample) {
    if (discard_energy_sample) {
        slot.energy_acc.reset_continuity();
        return;
    }
    if (!slot.energy_acc.have_bucket) {
        slot.energy_acc.bucket      = bucket;
        slot.energy_acc.have_bucket = true;
    }
    logic::working_figure_step(slot.energy_acc, slot.energy_cov, ein, nullptr);
    if (slot.energy_acc.ct_switch_reset_pending) {
        const bool cleared_ring = slot.energy_acc.acknowledge_ct_unwired_switch(slot.P().energy);
        if (cleared_ring) {
            slot.energy_carried_span_us = 0;
            slot.energy_restart_armed   = true;
            slot.energy_restart_bucket  = bucket;
            checkup_persist_seal(slot);
        }
    }
}

// Software restart: date the open hour so history_flash_save() can try to journal it.
void seal_open_hour_locked(CheckupSlot& slot) {
    if (slot.seal_bucket != INT64_MIN || !slot.state.have_bucket || !slot.model_fp ||
        !slot.source_confirmed || !slot.source_fp || slot.P().ring.count != slot.P().dhw.count ||
        slot.P().ring.count != slot.P().energy.count)
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
    payload.pel_source_fp          = slot.pel_source_fp;
    payload.energy                 = slot.energy_acc.pending;
    if (slot.state.have_bucket &&
        logic::checkup_journal_energy_withheld(
            slot.energy_restart_armed, slot.energy_restart_bucket, slot.state.bucket + 1, 0)) {
        payload.pel_source_fp = 0;
        payload.energy        = kEmptyEnergyBucket;
    }
    bucket                         = slot.seal_bucket;
    return logic::checkup_journal_bucket(payload.end_unix_s) == bucket;
}

[[gnu::noinline]] void fault_save_handoff_locked(CheckupSlot& slot, int64_t now_us) {
    PersistedFaultHandoff& fh = slot.P().fault_handoff;
    fh.magic                  = 0;
    if (!slot.source_confirmed || slot.fault_forgotten.load(std::memory_order_acquire) ||
        (!slot.fault_trace.count && !slot.fault_restored.count) || now_us < 0 ||
        now_us / 1000000 > logic::CheckupFaultTrace::max_second)
        return;
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    const auto     boot_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall =
        logic::checkup_cycling_end_unix_s(now_us - now_us % 1000000, now_us, unix_s, ms);
    const uint32_t eff_wall = wall > boot_s ? wall : 0;
    if (eff_wall > boot_s)
        slot.fault_restore_anchor = std::max(slot.fault_restore_anchor, eff_wall - boot_s);
    const int64_t oldest_saved = eff_wall > boot_s
                                     ? static_cast<int64_t>(slot.fault_restore_anchor) + boot_s -
                                           logic::CHECKUP_FAULT_WINDOW_S
                                     : 0;
    uint32_t      tail_gap_s   = 0;
    if (!logic::checkup_fault_handoff_encode_pair(slot.fault_restored, slot.fault_trace, eff_wall,
                                                  boot_s, oldest_saved, slot.fault_warm_gap_s,
                                                  slot.source_fp, s_diagnostics_generation,
                                                  fh.payload, tail_gap_s))
        return;
    fh.magic      = logic::CHECKUP_FAULT_HANDOFF_MAGIC;
    fh.version    = logic::CHECKUP_FAULT_HANDOFF_VERSION;
    fh.reserved   = 0;
    fh.tail_gap_s = tail_gap_s;
    fh.model_fp   = slot.model_fp;
    fh.crc        = logic::checkup_fault_handoff_crc(fh.model_fp, fh.payload);
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
    apply_energy_reset_locked(s_x10a);
    apply_reset_locked(s_modbus);
    apply_dhw_reset_locked(s_modbus);
    apply_energy_reset_locked(s_modbus);
    const int64_t stop_now = esp_timer_get_time();
    if (!stop_context_suppressed_locked()) {
        const auto stop_event = logic::stop_context_seal(s_stop_context);
        if (stop_event.valid) stop_observation_record(stop_now, false, stop_event);
        stop_observation_seal();
    }
    hydronic_observation_seal();
    for (int si = 0; si < 2; ++si) {
        CheckupSlot* const slot = si ? &s_modbus : &s_x10a;
        seal_open_hour_locked(*slot);

        if (!s_diagnostics_enabled.load(std::memory_order_acquire)) {
            slot->P().dhw_handoff.magic   = 0;
            slot->P().fault_handoff.magic = 0;
            continue;
        }
        PersistedDhwHandoff& h  = slot->P().dhw_handoff;
        h.magic                 = logic::CHECKUP_DHW_HANDOFF_MAGIC;
        h.version               = logic::CHECKUP_DHW_HANDOFF_VERSION;
        h.reserved              = 0;
        h.layout_fp             = logic::checkup_dhw_handoff_layout_fingerprint();
        h.model_fp              = slot->model_fp;
        h.payload.candidate     = logic::dhw_loss_checkpoint(slot->dhw_state, stop_now);
        h.payload.source_fp     = slot->source_confirmed ? slot->source_fp : 0;
        h.payload.dhw_source_fp = slot->dhw_source_fp;
        // Completed counters in the open hour have no durable age; never carry them across a boot.
        h.payload.pending = kEmptyDhwLossBucket;
        h.crc             = logic::checkup_dhw_handoff_crc(h.model_fp, h.payload);

        if (slot->fault_forgotten.load(std::memory_order_acquire)) {
            slot->P().fault_handoff.magic = 0;
        } else {
            fault_save_handoff_locked(*slot, stop_now);
        }

        diag_printf(
            "%s: DHW reboot handoff saved (%u min candidate, %u completed window(s))\n",
            slot->is_modbus ? "checkup(modbus)" : "checkup",
            static_cast<unsigned>(
                logic::dhw_loss_progress(slot->dhw_state, stop_now).candidate_observed_s / 60),
            0u);
    }
}

__attribute__((noinline)) void record_hydronic_locked(const CachedValue* values, size_t count,
                                                      bool rps_known, bool rps_running,
                                                      uint32_t source_generation,
                                                      int64_t  sweep_started_us) {
    if (hydronic_observation_suppressed() || !s_x10a.source_confirmed ||
        !s_hydronic_inputs.schema_fp)
        return;
    if (source_generation != s_hydronic_generation) {
        clear_hydronic_runtime_locked();
        s_hydronic_generation    = source_generation;
        s_hydronic_allow_restore = false;
        hydronic_observation_bind(s_x10a.source_fp, s_x10a.model_fp, s_hydronic_inputs.schema_fp,
                                  source_generation, false);
    }
    // Age includes the sweep and admission wait. A reader expiry also fences a sweep which
    // began before it: completing an old read cannot establish the first new observation.
    const int64_t accepted_us = esp_timer_get_time();
    if (!count || sweep_started_us < 0 || sweep_started_us > accepted_us ||
        sweep_started_us < s_hydronic_read_fence_us ||
        accepted_us - sweep_started_us > logic::HYDRONIC_MAX_GAP_US) {
        logic::hydronic_poll_gap(s_hydronic);
        s_hydronic_read_fence_us = accepted_us;
        s_hydronic_limitations   = 0;
        s_agree_limitations      = 0;
    } else {
        const auto sample =
            logic::hydronic_collect(s_hydronic_inputs, values, count, rps_known, rps_running);
        const auto delta = logic::hydronic_record(
            s_hydronic, sample, accepted_us, accepted_us - sweep_started_us, source_generation,
            s_diagnostics_generation, s_diagnostics_enabled.load(std::memory_order_acquire));
        s_hydronic_limitations = delta.limitations;
        s_agree_limitations    = delta.agree_limitations;
        hydronic_observation_record(delta);
    }
}

void slot_start(CheckupSlot& slot, bool diagnostics_enabled, uint32_t diagnostics_generation,
                uint32_t dhw_fp, bool flash_pending) {
    slot.last_commit_us          = kNoCommitUs;
    slot.live_commit_count       = 0;
    slot.dhw_source_fp           = dhw_fp;
    slot.modbus_profile            = ModbusProfile::Auto;
    slot.energy_cov                = kEmptyEnergyCoverage;
    slot.energy_acc                = kEmptyEnergyAccumulator;
    slot.pel_source_fp             = effective_pel_source_fp_locked(slot);
    slot.energy_carried_span_us    = 0;
    slot.energy_restart_armed      = false;
    slot.energy_restart_bucket     = 0;
    slot.cycling_restore_allowed = !safe_mode_active();
    slot.fault_restore_allowed   = !safe_mode_active();
    slot.dhw_trace_restore_allowed = !safe_mode_active();
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
    slot.fault_boot_handoff_valid =
        logic::checkup_restore_keeps_dhw_handoff(integrity) && slot.P().source_fp != 0 &&
        slot.P().fault_handoff.payload.source_fp == slot.P().source_fp &&
        logic::checkup_fault_handoff_valid(
            slot.P().fault_handoff.magic, slot.P().fault_handoff.version,
            slot.P().fault_handoff.model_fp, slot.P().model_fp, slot.P().source_fp,
            diagnostics_generation, slot.P().fault_handoff.crc, slot.P().fault_handoff.payload);
    if (slot.fault_boot_handoff_valid) {
        slot.fault_boot_handoff            = slot.P().fault_handoff.payload;
        slot.fault_boot_handoff_model      = slot.P().model_fp;
        slot.fault_boot_handoff_tail_gap_s = slot.P().fault_handoff.tail_gap_s;
    }
    // Consume before any producer or detection exists. A second panic cannot replay the handoff.
    slot.P().dhw_handoff.magic   = 0;
    slot.P().fault_handoff.magic = 0;
    slot.source_confirmed        = false;
    slot.model_fp                = 0;
    slot.source_fp               = 0;
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
    slot.boot_handoff_valid       = false;
    slot.fault_boot_handoff_valid = false;
    if (generation_changed) {
        retire_cycling_locked(slot);
        retire_fault_locked(slot);
        retire_dhw_trace_locked(slot);
        slot.reset_requested.store(false);
        slot.dhw_reset_requested.store(false);
        slot.energy_reset_requested.store(false);
        slot.state                  = logic::CheckupState{};
        slot.dhw_state              = kFreshDhwLossState;
        slot.cov                    = logic::CheckupCoverage{};
        slot.fault_now              = daik::FaultClass::Unknown;
        slot.energy_acc             = kEmptyEnergyAccumulator;
        slot.energy_carried_span_us = 0;
        slot.energy_restart_armed   = false;
        slot.energy_restart_bucket  = 0;
        persist_wipe(slot);
        slot.pel_source_fp   = slot.source_confirmed ? effective_pel_source_fp_locked(slot) : 0;
        slot.persist_verdict = enabled ? logic::CheckupRestore::DiagnosticsChanged
                                       : logic::CheckupRestore::DiagnosticsDisabled;
        return;
    }
    const bool     run_open  = slot.state.run_open;
    const uint32_t run_start = slot.state.run_start_bucket;
    if (logic::checkup_pause_state(slot.state, slot.P().ring.pending, &slot.P().ring))
        logic::checkup_journal_revision_arm(slot.revision, run_open, run_start);
    if (!slot.is_modbus) {
        s_defrost_start.pause();
        s_run_ctx_tracker.pause();
    }
    if (!enabled)
        slot.fault_trace.record(esp_timer_get_time(),
                                logic::FaultSampleDetail{logic::FaultTraceKind::Gap});
    slot.energy_acc.reset_continuity();
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

[[gnu::noinline]] void
record_cycling_run_context_locked(const logic::StopContextSample& stop_sample, const CachedValue* v,
                                  size_t n, const logic::CheckupSample& s, int outdoor_tenths,
                                  bool fresh_outdoor, int64_t now, uint32_t source_generation) {
    if (s_x10a.cycling_forgotten.load(std::memory_order_acquire)) {
        reset_run_ctx_locked();
        return;
    }
    int        rwt_t   = 0;
    const int  rwt_row = s_rwt_supported ? find_row(v, n, s_rwt_locator) : -1;
    const bool rwt_ok  = rwt_row >= 0 && !v[static_cast<size_t>(rwt_row)].held &&
                        !v[static_cast<size_t>(rwt_row)].held_unknown &&
                        tenths(v[static_cast<size_t>(rwt_row)], rwt_t) &&
                        logic::cycling_run_tenths_valid(rwt_t);
    const int  flow_row = find_row(v, n, logic::CHECKUP_LOC_FLOW);
    const bool flow_ok  = s.flow_ok && flow_row >= 0 && !v[static_cast<size_t>(flow_row)].held &&
                         !v[static_cast<size_t>(flow_row)].held_unknown &&
                         logic::cycling_run_tenths_valid(s.flow_tenths);
    const bool out_ok =
        fresh_outdoor && s.outdoor.available && logic::cycling_run_tenths_valid(outdoor_tenths);
    logic::CyclingRunSample run_sample;
    run_sample.base           = stop_sample;
    run_sample.rwt_ok         = rwt_ok;
    run_sample.rwt_tenths     = rwt_ok ? static_cast<int16_t>(rwt_t) : 0;
    run_sample.flow_ok        = flow_ok;
    run_sample.flow_tenths    = flow_ok ? static_cast<int16_t>(s.flow_tenths) : 0;
    run_sample.outdoor_ok     = out_ok;
    run_sample.outdoor_tenths = out_ok ? static_cast<int16_t>(outdoor_tenths) : 0;
    logic::cycling_run_context_step(s_run_ctx_tracker, s_run_ctx_trace, run_sample, now,
                                    source_generation);
    if (now >= 0 && now / 1000000 <= logic::CheckupCyclingTrace::max_second) {
        const auto uptime_s = static_cast<uint32_t>(now / 1000000);
        if (s.unix_s > uptime_s)
            s_x10a.cycling_restore_anchor =
                std::max(s_x10a.cycling_restore_anchor, s.unix_s - uptime_s);
        logic::cycling_run_context_finalize(s_run_ctx_trace, now, s.unix_s,
                                            cycling_restore_floor(s_x10a, uptime_s));
    }
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
    s_stop_context          = {};
    s_stop_inputs           = {};
    s_defrost_start         = {};
    reset_run_ctx_locked();
    s_rwt_locator           = {};
    s_defrost_air_supported = false;
    s_rwt_supported         = false;
    s_stop_generation    = 0;
    s_stop_allow_restore = true;
    s_stop_read_fence_us = -1;
    stop_observation_start(diagnostics_enabled, diagnostics_generation);
    clear_hydronic_runtime_locked();
    s_hydronic_inputs        = kEmptyHydronicInputs;
    s_hydronic_generation    = 0;
    s_hydronic_allow_restore = true;
    if (s_mtx) hydronic_observation_start(diagnostics_enabled, diagnostics_generation);
    const uint32_t dhw_fp = circulation_identity();
    s_requested_dhw_source_fp.store(dhw_fp);
    s_diagnostics_enabled.store(diagnostics_enabled, std::memory_order_release);
    s_diagnostics_generation    = diagnostics_generation;
    const bool flash_pending    = history_checkup_flash_pending();
    const bool mb_flash_pending = history_modbus_checkup_flash_pending();
    slot_start(s_x10a, diagnostics_enabled, diagnostics_generation, dhw_fp, flash_pending);
    slot_start(s_modbus, diagnostics_enabled, diagnostics_generation, dhw_fp, mb_flash_pending);
    const esp_err_t shutdown_err = esp_register_shutdown_handler(checkup_reboot_save);
    if (shutdown_err != ESP_OK)
        diag_printf("checkup: DHW shutdown handler not registered (%s)\n",
                    esp_err_to_name(shutdown_err));
}

__attribute__((noinline)) void set_hydronic_diagnostics_locked(bool enabled, uint32_t generation,
                                                               bool generation_changed) {
    if (generation_changed) {
        clear_hydronic_runtime_locked();
        s_hydronic_allow_restore = false;
    } else {
        s_hydronic.reset_continuity();
        s_hydronic_read_fence_us = -1;
        s_hydronic_limitations   = 0;
        s_agree_limitations      = 0;
        const auto empty_sample  = logic::hydronic_collect(
            s_hydronic_inputs, static_cast<const CachedValue*>(nullptr), 0, false, false);
        const auto empty_decide     = logic::hydronic_decide(empty_sample);
        s_hydronic.reason           = empty_decide.reason == logic::HydronicReason::Unsupported
                                          ? logic::HydronicReason::Unsupported
                                          : logic::HydronicReason::PollGap;
        s_hydronic.agreement.reason = logic::agreement_decide(empty_sample, empty_decide).reason ==
                                              logic::AgreementReason::Unsupported
                                          ? logic::AgreementReason::Unsupported
                                          : logic::AgreementReason::PollGap;
    }
    hydronic_observation_set_diagnostics(enabled, generation);
    if (s_x10a.source_confirmed && (generation_changed || s_hydronic_allow_restore))
        hydronic_observation_bind(s_x10a.source_fp, s_x10a.model_fp, s_hydronic_inputs.schema_fp,
                                  s_hydronic_generation,
                                  !generation_changed && s_hydronic_allow_restore);
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
    set_hydronic_diagnostics_locked(enabled, generation, generation_changed);
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
    retire_fault_locked(s_x10a);
    retire_dhw_trace_locked(s_x10a);
    s_x10a.boot_handoff_valid       = false;
    s_x10a.fault_boot_handoff_valid = false;
    // An explicit /detect or automatic-profile rewiring withdraws the old confirmation immediately.
    s_stop_context       = {};
    s_stop_inputs        = {};
    s_stop_allow_restore = false;
    stop_observation_reset();
    clear_hydronic_runtime_locked();
    s_hydronic_inputs        = kEmptyHydronicInputs;
    s_hydronic_allow_restore = false;
    hydronic_observation_reset();
    s_defrost_start         = {};
    reset_run_ctx_locked();
    s_rwt_locator           = {};
    s_defrost_air_supported = false;
    s_rwt_supported         = false;
    // Consuming the reset on an unidentified cycle must not let the journal re-admit the old link.
    s_x10a.source_confirmed = false;
    s_x10a.source_fp        = 0;
    s_x10a.model_fp         = 0;
    s_x10a.energy_cov       = kEmptyEnergyCoverage;
    s_x10a.pel_source_fp    = 0;
    s_x10a.persist_verdict  = logic::CheckupRestore::ModelChanged;
    s_x10a.reset_requested.store(true);
}

void checkup_modbus_reset() {
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    retire_cycling_locked(s_modbus);
    retire_fault_locked(s_modbus);
    retire_dhw_trace_locked(s_modbus);
    s_modbus.boot_handoff_valid       = false;
    s_modbus.fault_boot_handoff_valid = false;
    s_modbus.source_confirmed         = false;
    s_modbus.source_fp                = 0;
    s_modbus.model_fp                 = 0;
    s_modbus.modbus_profile           = ModbusProfile::Auto;
    s_modbus.energy_cov               = kEmptyEnergyCoverage;
    s_modbus.pel_source_fp            = 0;
    s_modbus.persist_verdict          = logic::CheckupRestore::ModelChanged;
    s_modbus.reset_requested.store(true);
}

// First automatic detection establishes this boot's full source scope. An explicit manual
// selection establishes the decoding contract for future samples, without proving a bus reply.
// Startup cached identity is only an expectation for a separately sealed handoff. Explicit resets
// retire pending journal adoption for this boot, even if selection names the same profile/link.
// Keep the additional scan outside the profile-binding frame.
[[gnu::noinline]] static bool defrost_air_supported(const logic::ProfileView& view) {
    const auto air = logic::instrument_resolve(view, logic::Instrument::OutdoorAir);
    if (air.state != logic::InstrumentState::Supported) return false;
    const auto row = logic::adjudicated(view, static_cast<size_t>(air.row));
    return logic::checkup_row_matches(logic::CHECKUP_LOC_OUTDOOR, row.reg, row.offset, row.conv);
}

[[gnu::noinline]] static logic::EnergyCoverage
energy_coverage_from_view(const logic::ProfileView& view) {
    logic::EnergyCoverage e_cov;
    for (size_t i = 0; i < view.count(); ++i) {
        if (!row_publishable(view[i])) continue;
        logic::energy_cover_row(e_cov, logic::adjudicated(view, i));
    }
    return e_cov;
}

__attribute__((noinline)) void reset_hydronic_on_detect_locked(const char* profile_id,
                                                               uint32_t source_fp, uint32_t fp,
                                                               bool first) {
    logic::fill_hydronic_input_plan(s_hydronic_inputs, profile_id, def::lookup_view(profile_id));
    clear_hydronic_runtime_locked();
    s_hydronic_generation = s_stop_generation;
    if (!first) {
        s_hydronic_allow_restore = false;
        hydronic_observation_reset();
    }
    hydronic_observation_bind(source_fp, fp, s_hydronic_inputs.schema_fp, s_hydronic_generation,
                              s_hydronic_allow_restore);
}

[[gnu::noinline]] static logic::CheckupLocator resolve_rwt_locator(const logic::ProfileView& view) {
    const auto rwt = logic::instrument_resolve(view, logic::Instrument::ReturnWater);
    if (rwt.state != logic::InstrumentState::Supported) return {0, 0, -1};
    const auto row = logic::adjudicated(view, static_cast<size_t>(rwt.row));
    return {row.reg, row.offset, row.conv};
}

void checkup_reset_on_detect(const char* profile_id, uint32_t source_fp) {
    const auto                  view        = def::lookup_view(profile_id);
    const uint32_t              fp          = logic::checkup_model_fingerprint(profile_id, view);
    const auto                  stop_inputs = logic::stop_context_input_plan(profile_id, view);
    const bool                  defrost_air = defrost_air_supported(view);
    const logic::CheckupLocator rwt_loc     = resolve_rwt_locator(view);
    const auto                  e_cov       = energy_coverage_from_view(view);
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    const bool first        = !s_x10a.source_confirmed;
    s_x10a.source_confirmed = source_fp != 0 && fp != 0;
    s_x10a.model_fp         = fp;
    s_x10a.source_fp        = source_fp;
    s_x10a.energy_cov       = s_x10a.source_confirmed ? e_cov : kEmptyEnergyCoverage;
    s_x10a.pel_source_fp    = s_x10a.source_confirmed ? effective_pel_source_fp_locked(s_x10a) : 0;
    s_stop_context          = kEmptyStopContext;
    s_stop_inputs           = stop_inputs;
    s_defrost_start         = {};
    reset_run_ctx_locked();
    s_rwt_locator           = rwt_loc;
    s_defrost_air_supported = defrost_air;
    s_rwt_supported         = rwt_loc.conv >= 0;
    s_stop_generation       = hp_poll_generation();
    reset_hydronic_on_detect_locked(profile_id, source_fp, fp, first);
    if (!first) {
        s_stop_allow_restore = false;
        stop_observation_reset();
    }
    stop_observation_bind(source_fp, fp, s_stop_inputs.schema_fp, s_stop_generation,
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
        if (s_x10a.source_confirmed && s_x10a.fault_boot_handoff_valid &&
            !s_x10a.reset_requested.load() &&
            s_diagnostics_enabled.load(std::memory_order_acquire) &&
            s_x10a.fault_boot_handoff_model == fp &&
            s_x10a.fault_boot_handoff.source_fp == source_fp &&
            logic::checkup_fault_handoff_decode(s_x10a.fault_restored, s_x10a.fault_boot_handoff)) {
            s_x10a.fault_warm_gap_s =
                s_x10a.fault_restored.unix_s > 0
                    ? -1
                    : static_cast<int64_t>(s_x10a.fault_boot_handoff_tail_gap_s) + 3;
            diag_printf("checkup: scoped fault trace handoff applied (%u event(s))\n",
                        static_cast<unsigned>(s_x10a.fault_restored.count));
        }
        s_x10a.boot_handoff_valid       = false;
        s_x10a.fault_boot_handoff_valid = false;
        checkup_persist_seal(s_x10a);
        return;
    }
    s_x10a.boot_handoff_valid       = false;
    s_x10a.fault_boot_handoff_valid = false;
    s_x10a.persist_verdict          = logic::CheckupRestore::ModelChanged;
    retire_cycling_locked(s_x10a);
    retire_fault_locked(s_x10a);
    retire_dhw_trace_locked(s_x10a);
    s_x10a.reset_requested.store(true);
}

[[gnu::noinline]] static bool modbus_confirm_commit_locked(ModbusProfile profile, uint32_t fp,
                                                           uint32_t source_fp) {
    const bool first          = !s_modbus.source_confirmed;
    s_modbus.source_confirmed = source_fp != 0 && fp != 0;
    s_modbus.model_fp         = fp;
    s_modbus.source_fp        = source_fp;
    s_modbus.modbus_profile   = s_modbus.source_confirmed ? profile : ModbusProfile::Auto;
    s_modbus.energy_cov       = (s_modbus.source_confirmed && profile == ModbusProfile::HomeHub)
                                    ? kHomeHubEnergyCoverage
                                    : kEmptyEnergyCoverage;
    s_modbus.pel_source_fp =
        s_modbus.source_confirmed ? effective_pel_source_fp_locked(s_modbus) : 0;
    return first;
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
    if (modbus_confirm_commit_locked(profile, fp, source_fp)) {
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
        if (s_modbus.source_confirmed && s_modbus.fault_boot_handoff_valid &&
            !s_modbus.reset_requested.load() &&
            s_diagnostics_enabled.load(std::memory_order_acquire) &&
            s_modbus.fault_boot_handoff_model == fp &&
            s_modbus.fault_boot_handoff.source_fp == source_fp &&
            logic::checkup_fault_handoff_decode(s_modbus.fault_restored,
                                                s_modbus.fault_boot_handoff)) {
            s_modbus.fault_warm_gap_s =
                s_modbus.fault_restored.unix_s > 0
                    ? -1
                    : static_cast<int64_t>(s_modbus.fault_boot_handoff_tail_gap_s) + 3;
            diag_printf("checkup(modbus): scoped fault trace handoff applied (%u event(s))\n",
                        static_cast<unsigned>(s_modbus.fault_restored.count));
        }
        s_modbus.boot_handoff_valid       = false;
        s_modbus.fault_boot_handoff_valid = false;
        checkup_persist_seal(s_modbus);
        return;
    }
    s_modbus.boot_handoff_valid       = false;
    s_modbus.fault_boot_handoff_valid = false;
    s_modbus.persist_verdict          = logic::CheckupRestore::ModelChanged;
    retire_cycling_locked(s_modbus);
    retire_fault_locked(s_modbus);
    retire_dhw_trace_locked(s_modbus);
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

[[gnu::noinline]] static void capture_tenths(const CachedValue& cv, bool& seen, bool& known,
                                             int32_t& dst) {
    seen    = true;
    int val = 0;
    if (tenths(cv, val)) {
        known = true;
        dst   = val;
    }
}

[[gnu::noinline]] static void energy_extract_input(const CachedValue* v, size_t n, bool rps_known,
                                                   bool rps_running, const logic::CheckupSample& s,
                                                   int                     outdoor_tenths,
                                                   logic::EnergyStepInput& ein) {
    ein                 = logic::EnergyStepInput{};
    ein.source_ok       = (n > 0);
    ein.rps_known       = rps_known;
    ein.rps_running     = rps_running;
    ein.buh_known       = s.buh_known;
    ein.buh_on          = s.buh_on;
    ein.bsh_known       = s.bsh_known;
    ein.bsh_on          = s.bsh_on;
    ein.defrost_known   = s.defrost_known;
    ein.defrost_on      = s.defrost_on;
    ein.valve_dhw_known = s.valve_known;
    ein.valve_dhw_on    = s.valve_dhw;
    ein.outdoor_known   = s.outdoor.available;
    ein.outdoor_tenths  = s.outdoor.available ? outdoor_tenths : 0;

    bool seen_lwt_t1   = false;
    bool seen_lwt_t2   = false;
    bool seen_rwt_t1   = false;
    bool seen_rwt_t2   = false;
    bool seen_post_buh = false;
    bool seen_rps      = false;
    bool seen_iu_mode  = false;
    for (size_t i = 0; i < n; ++i) {
        const CachedValue& cv  = v[i];
        int                val = 0;
        if (cv.reg == 0x63u && cv.off >= 14u && cv.off <= 16u && cv.conv == 161) {
            if (tenths(cv, val) && val >= 0 && ein.ct_valid_count < UINT8_MAX) {
                ein.ct_valid_count++;
                ein.ct_sum_tenths += val;
            }
            continue;
        }
        if (cv.reg == 0x21u && cv.off == 0u &&
            (!cv.unit || cv.unit[0] == '\0' || (cv.unit[0] == 'A' && cv.unit[1] == '\0'))) {
            if (!ein.inv_known && !cv.held && !cv.held_unknown && tenths(cv, val) && val >= 0) {
                ein.inv_known  = true;
                ein.inv_tenths = val;
            }
            continue;
        }
        if (!seen_rps && rps_known && logic::ou_is_rps_witness(cv.label, cv.reg)) {
            seen_rps = true;
            if (tenths(cv, val)) ein.rps_tenths = val;
            continue;
        }
        if (!ein.flow_known && cv.reg == 0x62u && cv.off == 9u &&
            (!cv.unit || cv.unit[0] == '\0' || logic::checkup_text_equal(cv.unit, "L/min") ||
             logic::checkup_text_equal(cv.unit, "l/min"))) {
            bool dummy = false;
            capture_tenths(cv, dummy, ein.flow_known, ein.flow_tenths);
            continue;
        }
        if (!seen_post_buh && logic::cop_is_post_buh(cv.label, cv.reg)) {
            capture_tenths(cv, seen_post_buh, ein.post_buh_known, ein.post_buh_tenths);
            continue;
        }
        if (!seen_lwt_t1 && logic::lwt_is_pre_buh(cv.label)) {
            capture_tenths(cv, seen_lwt_t1, ein.lwt_known, ein.lwt_tenths);
            continue;
        }
        if (!seen_lwt_t1 && !seen_lwt_t2 && logic::lwt_is_measurement(cv.label)) {
            capture_tenths(cv, seen_lwt_t2, ein.lwt_known, ein.lwt_tenths);
            continue;
        }
        if (!seen_rwt_t1 && logic::rwt_is_r4t(cv.label)) {
            capture_tenths(cv, seen_rwt_t1, ein.rwt_known, ein.rwt_tenths);
            continue;
        }
        if (!seen_rwt_t1 && !seen_rwt_t2 && logic::rwt_is_measurement(cv.label)) {
            capture_tenths(cv, seen_rwt_t2, ein.rwt_known, ein.rwt_tenths);
            continue;
        }
        if (!seen_iu_mode &&
            logic::checkup_row_matches(logic::CHECKUP_LOC_IU_MODE, cv.reg, cv.off, cv.conv)) {
            seen_iu_mode = true;
            ein.set_iu_mode(cv.value.c_str());
        }
    }
}

[[gnu::noinline]] static void modbus_energy_extract_input(const CachedValue* v, size_t n,
                                                          ModbusProfile               profile,
                                                          const logic::CheckupSample& s,
                                                          logic::EnergyStepInput&     ein) {
    ein                 = logic::EnergyStepInput{};
    ein.source_ok       = (n > 0);
    ein.rps_known       = s.rps_known;
    ein.rps_running     = s.rps_running;
    ein.bsh_known       = s.bsh_known;
    ein.bsh_on          = s.bsh_on;
    ein.valve_dhw_known = s.valve_known;
    ein.valve_dhw_on    = s.valve_dhw;
    ein.flow_known      = s.flow_ok;
    ein.flow_tenths     = s.flow_tenths;
    if (s.operating_mode == logic::CheckupOperatingMode::Heating) {
        ein.set_iu_mode(logic::EnergyIuMode::HeatingOrDhwOrStop);
    } else if (s.operating_mode == logic::CheckupOperatingMode::Cooling) {
        ein.set_iu_mode(logic::EnergyIuMode::CoolingDhw);
    } else {
        ein.set_iu_mode(logic::EnergyIuMode::Unknown);
    }

    bool seen_defrost  = false;
    bool seen_lwt      = false;
    bool seen_post_buh = false;
    bool seen_rwt      = false;
    bool seen_outdoor  = false;
    bool seen_power    = false;
    for (size_t i = 0; i < n; ++i) {
        const CachedValue&     cv  = v[i];
        const def::HomeHubReg* row = modbus_row_for_cv(cv, profile);
        if (!row || row->space != MbFunc::ReadInput) continue;
        switch (row->offset) {
        case 35: {
            int val = 0;
            if (!seen_defrost) {
                seen_defrost = true;
                if (exact_int(cv, val) && (val == 0 || val == 1)) {
                    ein.defrost_known = true;
                    ein.defrost_on    = (val == 1);
                }
            }
            break;
        }
        case 40:
            if (!seen_lwt) capture_tenths(cv, seen_lwt, ein.lwt_known, ein.lwt_tenths);
            break;
        case 41:
            if (!seen_post_buh)
                capture_tenths(cv, seen_post_buh, ein.post_buh_known, ein.post_buh_tenths);
            break;
        case 42:
            if (!seen_rwt) capture_tenths(cv, seen_rwt, ein.rwt_known, ein.rwt_tenths);
            break;
        case 44:
            if (!seen_outdoor)
                capture_tenths(cv, seen_outdoor, ein.outdoor_known, ein.outdoor_tenths);
            break;
        case 51:
            if (!seen_power) {
                seen_power       = true;
                const char* text = cv.value.c_str();
                if (text[0] != '\0') {
                    char*        end = nullptr;
                    const double kw  = std::strtod(text, &end);
                    if (end != text && *end == '\0' && std::isfinite(kw) && kw >= 0.0) {
                        ein.modbus_power_known = true;
                        ein.modbus_power_w     = kw * 1000.0;
                    }
                }
            }
            break;
        default:
            break;
        }
    }
}

uint32_t checkup_consent_epoch() { return s_diagnostics_epoch.load(std::memory_order_acquire); }

void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running,
                    const logic::CheckupCoverage& coverage, uint32_t source_generation,
                    uint32_t consent_epoch, bool profile_confirmed, int64_t sweep_started_us) {
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
    bool      fresh_outdoor  = false;
    if (outdoor_row >= 0 && tenths(v[static_cast<size_t>(outdoor_row)], outdoor_tenths)) {
        const auto& outdoor_value = v[static_cast<size_t>(outdoor_row)];
        fresh_outdoor             = !outdoor_value.held && !outdoor_value.held_unknown;
        s.outdoor = logic::outdoor_x10a_evidence(
            true, rps_known, rps_running, static_cast<double>(outdoor_tenths) / 10.0);
    }
    const uint32_t dhw_generation         = s_dhw_identity_generation.load();
    const uint32_t circulation_generation = circulation_source_generation();
    // Allocation-free, including on the OOM catch and TLS hold paths: the applied source epoch
    // alone withdraws a replaced witness, so no Config copy is needed on this per-cycle path.
    const CirculationPumpSample circulation = circulation_pump_sample();
    s.circulation_configured                = circulation.configured;
    s.circulation_known                     = circulation.known;
    s.circulation_on                        = circulation.on;
    s.retry_expected_mask                   = coverage.retry_mask;
    logic::EnergyStepInput ein;
    energy_extract_input(v, n, rps_known, rps_running, s, outdoor_tenths, ein);

    // Fault class is matched by converter because a profile carries it on the outdoor page AND the
    // hydronic one. Retry counters use exact page/offset/converter identities because conv 311 also
    // names unrelated values elsewhere. For faults the WORST readable class wins.
    uint8_t    fault_rows_read = 0;
    FaultClass out_cls = FaultClass::Unknown, in_cls = FaultClass::Unknown,
               other_cls = FaultClass::Unknown;
    uint16_t out_code = 0, in_code = 0, other_code = 0;
    for (size_t i = 0; i < n; i++) {
        const CachedValue& cv = v[i];
        if (logic::checkup_is_fault_class(cv.conv)) {
            const FaultClass c = fault_class_from_text(cv.value.c_str());
            if (c != FaultClass::Unknown && fault_rows_read < UINT8_MAX) fault_rows_read++;
            if (fault_error_active(c)) s.fault = FaultClass::Error;
            else if (fault_warning_active(c) && !fault_error_active(s.fault)) s.fault = c;
            else if (c == FaultClass::Normal && s.fault == FaultClass::Unknown) s.fault = c;
            if (cv.reg == 0x10u) {
                out_cls = c;
            } else if (cv.reg == 0x60u) {
                in_cls = c;
            } else if (c != FaultClass::Unknown) {
                if (fault_error_active(c) ||
                    (fault_warning_active(c) && !fault_error_active(other_cls)) ||
                    other_cls == FaultClass::Unknown)
                    other_cls = c;
            }
        } else if (cv.conv == 204) {
            const uint16_t pc = logic::fault_code_pack(cv.value.c_str());
            if (cv.reg == 0x10u) {
                if (pc) out_code = pc;
            } else if (cv.reg == 0x60u) {
                if (pc) in_code = pc;
            } else if (cv.reg != 0x55u && pc && !other_code) {
                other_code = pc;
            }
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

    const logic::FaultSampleDetail x10a_fault =
        logic::checkup_x10a_fault_detail(s.fault, out_cls, out_code, in_cls, in_code, other_code);

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
    if (!stop_context_suppressed_locked() && s_source_confirmed && s_stop_inputs.schema_fp) {
        const auto stop_sample =
            logic::stop_context_collect(s_stop_inputs, v, n, rps_known, rps_running);
        const int defrost_air = s_defrost_air_supported && fresh_outdoor && s.outdoor.available
                                    ? outdoor_tenths
                                    : logic::CHECKUP_ABSENT;
        s_defrost_start.observe(stop_sample, defrost_air, now, s.unix_s, source_generation);
        record_cycling_run_context_locked(stop_sample, v, n, s, outdoor_tenths, fresh_outdoor, now,
                                          source_generation);
        if (now >= s_stop_read_fence_us) {
            // The stop reader may retire that observer while a poll waits for the mutex. The
            // defrost tracker still needs this sample, including an unreadable defrost witness.
            if (source_generation != s_stop_generation) {
                s_stop_context       = {};
                s_stop_generation    = source_generation;
                s_stop_allow_restore = false;
                stop_observation_bind(s_x10a.source_fp, s_x10a.model_fp, s_stop_inputs.schema_fp,
                                      source_generation, false);
            }
            const auto stop_event =
                logic::stop_context_step(s_stop_context, stop_sample, now, source_generation);
            stop_observation_record(now, stop_sample.rps_known, stop_event);
        }
    }
    record_hydronic_locked(v, n, rps_known, rps_running, source_generation, sweep_started_us);
    const bool discard_dhw_sample = apply_dhw_reset_locked(s_x10a) ||
                                    dhw_generation != s_dhw_identity_generation.load() ||
                                    circulation_generation != circulation_source_generation();
    const bool discard_energy_sample = apply_energy_reset_locked(s_x10a);
    // OOM/TLS callbacks report an observation gap, not a newly resolved empty profile. A genuine
    // unidentified-profile cycle still supplies confirmed empty coverage and withdraws capability.
    if (profile_confirmed) s_x10a.cov = coverage;
    s_x10a.fault_now    = s.fault;
    s_x10a.pressure_now = s.bar_ok && s.bar_tenths >= 0 ? s.bar_tenths : -1;
    if (n) s_x10a.source_last_us = now;
    if (s_x10a.source_confirmed && now >= 0) {
        const bool was_active = logic::fault_trace_kind_active(s_x10a.fault_trace.state.kind);
        const bool now_active = logic::fault_trace_kind_active(x10a_fault.kind);
        if (s_x10a.fault_trace.record(now, x10a_fault) && (was_active || now_active))
            s_x10a.fault_trace_dirty = true;
        s_x10a.fault_trace.observe_window(static_cast<uint32_t>(now / 1000000));
    }
    commit_and_fold_locked(s_x10a, s, now, bucket, discard_dhw_sample);
    ein.now_us = now;
    fold_energy_locked(s_x10a, ein, bucket, discard_energy_sample);
}

[[gnu::noinline]] static void modbus_collect_sample(const CachedValue* v, size_t n,
                                                    ModbusProfile                 profile,
                                                    const logic::CheckupCoverage& cov,
                                                    logic::CheckupSample&         s,
                                                    uint16_t& mb_fault_code, int& mb_fault_sub) {
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
        case 22:
            mb_fault_code = logic::fault_code_pack(cv.value.c_str());
            break;
        case 23:
            if (exact_int(cv, val) && val > 0 && val <= 999) mb_fault_sub = val;
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
            if (cov.flow && !cv.modbus_flow_scale_unverified) s.flow_ok = tenths(cv, s.flow_tenths);
            break;
        default:
            break;
        }
    }
}

[[gnu::noinline]] static void modbus_fault_trace_locked(uint16_t mb_fault_code, int mb_fault_sub,
                                                        FaultClass fault, int64_t now) {
    const logic::FaultSampleDetail mb_fault =
        logic::checkup_modbus_fault_detail(fault, mb_fault_code, mb_fault_sub);
    const bool was_active = logic::fault_trace_kind_active(s_modbus.fault_trace.state.kind);
    const bool now_active = logic::fault_trace_kind_active(mb_fault.kind);
    if (s_modbus.fault_trace.record(now, mb_fault) && (was_active || now_active))
        s_modbus.fault_trace_dirty = true;
    s_modbus.fault_trace.observe_window(static_cast<uint32_t>(now / 1000000));
}

[[gnu::noinline]] static void modbus_fold_energy_locked(const CachedValue* v, size_t n,
                                                        ModbusProfile               profile,
                                                        const logic::CheckupSample& s, int64_t now,
                                                        uint32_t bucket,
                                                        bool     discard_energy_sample) {
    logic::EnergyStepInput ein;
    modbus_energy_extract_input(v, n, profile, s, ein);
    ein.now_us = now;
    fold_energy_locked(s_modbus, ein, bucket, discard_energy_sample);
}

void checkup_record_modbus(const CachedValue* v, size_t n, ModbusProfile profile,
                           uint32_t source_generation, uint32_t consent_epoch,
                           bool source_confirmed, ModbusProfileBasis basis) {
    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;
    if (!s_mtx) return;
    if (!v && n) return;

    const logic::CheckupCoverage cov = logic::checkup_modbus_coverage(profile, basis);
    logic::CheckupSample         s;
    int64_t                      unix_s  = -1;
    int32_t                      unix_ms = 0;
    time_now(unix_s, unix_ms);
    if (unix_s > 0 && unix_s <= UINT32_MAX) s.unix_s = static_cast<uint32_t>(unix_s);
    s.x10a_blind = !n;

    uint16_t mb_fault_code = 0;
    int      mb_fault_sub  = 0;
    modbus_collect_sample(v, n, profile, cov, s, mb_fault_code, mb_fault_sub);

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
    const bool discard_energy_sample = apply_energy_reset_locked(s_modbus);
    if (source_confirmed) {
        s_modbus.cov        = cov;
        s_modbus.energy_cov = logic::energy_modbus_coverage(profile, basis);
    }
    s_modbus.fault_now    = s.fault;
    s_modbus.pressure_now = -1;
    if (n) s_modbus.source_last_us = now;
    if (s_modbus.source_confirmed && now >= 0)
        modbus_fault_trace_locked(mb_fault_code, mb_fault_sub, s.fault, now);
    commit_and_fold_locked(s_modbus, s, now, bucket, discard_dhw_sample);
    modbus_fold_energy_locked(v, n, profile, s, now, bucket, discard_energy_sample);
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
    logic::cycling_run_context_expire(s_run_ctx_tracker, now_us);
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

void checkup_hydronic_expire(int64_t) {
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk || hydronic_observation_suppressed() ||
        !s_diagnostics_enabled.load(std::memory_order_acquire) || s_x10a.reset_requested.load() ||
        s_x10a.seal_bucket != INT64_MIN)
        return;
    expire_hydronic_locked(esp_timer_get_time());
}

CheckupHydronicReport checkup_hydronic_report() {
    CheckupHydronicReport r;
    if (hydronic_observation_suppressed()) {
        r.observation.restore_pending = false;
        r.reason                      = logic::HydronicReason::Forgotten;
        r.agree_reason                = logic::AgreementReason::Forgotten;
        return r;
    }
    if (!s_mtx) {
        r.observation.restore_pending = false;
        return r;
    }
    Lock lk(s_mtx);
    if (hydronic_observation_suppressed()) {
        r.observation.restore_pending = false;
        r.reason                      = logic::HydronicReason::Forgotten;
        r.agree_reason                = logic::AgreementReason::Forgotten;
        return r;
    }
    if (!lk) return r;
    if (!s_diagnostics_enabled.load(std::memory_order_acquire) || s_x10a.reset_requested.load()) {
        r.observation           = hydronic_observation_report();
        r.observation.confirmed = false;
        const bool no_consent   = !s_diagnostics_enabled.load(std::memory_order_acquire);
        r.reason = no_consent ? logic::HydronicReason::NoConsent : logic::HydronicReason::NoSource;
        r.agree_reason =
            no_consent ? logic::AgreementReason::NoConsent : logic::AgreementReason::NoSource;
        return r;
    }
    // Invalidation bumps the poll epoch before its caller can acquire this owner for reset.
    // A reader in that gap must not present the previous population as current. Leave retained
    // storage untouched; the admitted reset/new producer owns its durable identity barrier.
    if (s_x10a.source_confirmed && !hp_poll_generation_matches(s_hydronic_generation)) {
        r.reason       = logic::HydronicReason::SourceChanged;
        r.agree_reason = logic::AgreementReason::SourceChanged;
        return r;
    }
    const int64_t now = esp_timer_get_time();
    expire_hydronic_locked(now);
    r.observation = hydronic_observation_report();
    r.reason      = s_x10a.source_confirmed ? s_hydronic.reason : logic::HydronicReason::NoSource;
    r.agree_reason =
        s_x10a.source_confirmed ? s_hydronic.agreement.reason : logic::AgreementReason::NoSource;
    r.source_generation = s_x10a.source_confirmed ? s_hydronic_generation : 0;
    r.schema_fp         = s_x10a.source_confirmed ? s_hydronic_inputs.schema_fp : 0;
    r.current           = s_x10a.source_confirmed && s_x10a.seal_bucket == INT64_MIN &&
                s_hydronic.last_us >= 0 && now >= s_hydronic.last_us &&
                now - s_hydronic.last_us <= logic::HYDRONIC_MAX_GAP_US;
    r.limitations       = r.current ? s_hydronic_limitations : 0;
    r.agree_limitations = r.current ? s_agree_limitations : 0;
    r.r1_r4_supported =
        s_x10a.source_confirmed && logic::hydronic_plan_supported(s_hydronic_inputs);
    r.r2_r1_supported =
        r.r1_r4_supported && s_hydronic_inputs.post_buh_state == logic::InstrumentState::Supported;
    if (r.current && s_hydronic.secondary.current(now)) {
        const auto& sample = s_hydronic.secondary;
        r.secondary        = {sample.sum_milli, sample.duration_us, sample.samples,
                              s_hydronic_inputs.secondary_supply};
    }
    if (s_x10a.seal_bucket != INT64_MIN) {
        r.reason       = logic::HydronicReason::PollGap;
        r.agree_reason = logic::AgreementReason::PollGap;
    }
    if (r.current && r.reason == logic::HydronicReason::Settling &&
        s_hydronic.eligible_since_us >= 0 && now >= s_hydronic.eligible_since_us) {
        const int64_t elapsed = now - s_hydronic.eligible_since_us;
        if (elapsed < logic::HYDRONIC_SETTLE_US)
            r.settling_remaining_s =
                static_cast<uint32_t>((logic::HYDRONIC_SETTLE_US - elapsed + 999999) / 1000000);
    }
    if (r.current && r.agree_reason == logic::AgreementReason::Settling &&
        s_hydronic.agreement.eligible_since_us >= 0 &&
        now >= s_hydronic.agreement.eligible_since_us) {
        const int64_t elapsed = now - s_hydronic.agreement.eligible_since_us;
        if (elapsed < logic::AGREEMENT_SETTLE_US)
            r.agree_settling_remaining_s =
                static_cast<uint32_t>((logic::AGREEMENT_SETTLE_US - elapsed + 999999) / 1000000);
    }
    if (hydronic_observation_suppressed()) {
        r                             = {};
        r.observation.restore_pending = false;
        r.reason                      = logic::HydronicReason::Forgotten;
        r.agree_reason                = logic::AgreementReason::Forgotten;
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
        slot.P().energy.buf[i]              = kEmptyEnergyBucket;
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
        slot.energy_acc       = kEmptyEnergyAccumulator;
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

[[gnu::noinline]] static void copy_defrost_start_locked(logic::DefrostStartReport& out,
                                                        int64_t                    now_us) {
    if (s_x10a.source_confirmed && !stop_observation_suppressed())
        out = s_defrost_start.snapshot(now_us, hp_poll_generation());
}

// Keep the clock bracket out of the common report frame.
[[gnu::noinline]] static uint32_t dhw_trace_wall_s(uint32_t uptime_s) {
    const int64_t before_us = esp_timer_get_time();
    int64_t       unix_s    = -1;
    int32_t       ms        = 0;
    time_now(unix_s, ms);
    return logic::dhw_loss_wall_anchor_s(uptime_s, before_us, esp_timer_get_time(), unix_s, ms);
}

[[gnu::noinline]] static uint32_t dhw_trace_wall_locked(CheckupSlot& slot, uint32_t uptime_s) {
    const uint32_t now = dhw_trace_wall_s(uptime_s);
    if (!now || !slot.dhw_trace_clock_anchor_s) return now;
    const uint64_t anchored = uint64_t{slot.dhw_trace_clock_anchor_s} + uptime_s;
    if (anchored <= UINT32_MAX && now <= anchored + 1 && anchored <= uint64_t{now} + 1)
        return static_cast<uint32_t>(anchored);

    // A clock step must not re-date saved evidence or extend its lifetime on a later reboot.
    // Withdraw the pre-boot prefix, preserving this boot's measurements and monotonic frame.
    slot.dhw_trace.discard_restored();
    slot.dhw_trace_clock_anchor_s = 0;
    arm_dhw_trace_barrier_locked(slot);
    return now;
}

// The caller owns the lock and the optional output.
static __attribute__((noinline)) void copy_dhw_trace_locked(CheckupSlot&            slot,
                                                            logic::DhwLossTimeline* dhw_trace,
                                                            int64_t now_us, bool source_fresh) {
    if (dhw_trace && slot.source_confirmed && !slot.dhw_reset_requested.load() &&
        !slot.dhw_trace_forgotten.load(std::memory_order_acquire) && slot.cov.r5t &&
        slot.cov.valve && slot.cov.pump && slot.cov.bsh && slot.dhw_trace.begun) {
        const uint32_t unix_s =
            dhw_trace_wall_locked(slot, static_cast<uint32_t>(now_us / 1000000));
        if (slot.dhw_trace.snapshot(*dhw_trace, now_us, logic::CHECKUP_MAX_GAP_S)) {
            dhw_trace->live   = dhw_trace->live && source_fresh;
            dhw_trace->unix_s = unix_s;
        }
    }
    // Forget can latch without this mutex while the clock read is in flight.
    if (dhw_trace && slot.dhw_trace_forgotten.load(std::memory_order_acquire)) dhw_trace->clear();
}

logic::CheckupReport checkup_report(logic::CheckupCyclingHours* hours,
                                    logic::CheckupCyclingTrace* trace,
                                    logic::CheckupRestore* persist, DiagnosticsSource source,
                                    logic::DefrostStartReport* defrost,
                                    logic::DhwLossTimeline*    dhw_trace) {
    if (dhw_trace) dhw_trace->clear();
    if (hours) {
        hours->count = 0;
        hours->epoch = 0;
    }
    if (trace) trace->unix_s = 0;
    if (persist) *persist = logic::CheckupRestore::Unknown;
    if (defrost) *defrost = {};
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
    if (defrost && !slot.is_modbus) copy_defrost_start_locked(*defrost, now_us);
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
    window.flags = static_cast<uint8_t>(window.flags | fault_saved_flags_locked(slot, now_us));
    window.full_span         = span_s >= logic::CHECKUP_WINDOW_S;
    if (dhw_trace) copy_dhw_trace_locked(slot, dhw_trace, now_us, source_fresh);
    // The circulation reset can latch during the optional clock read. Fence the timeline,
    // aggregate, scope age and progress together; only the producer consumes the reset.
    const bool dhw_reset_pending = slot.dhw_reset_requested.load();
    if (dhw_reset_pending && dhw_trace) dhw_trace->clear();
    logic::DhwLossWindow dhw =
        dhw_reset_pending ? logic::DhwLossWindow{} : logic::dhw_loss_aggregate(slot.P().dhw);
    dhw.full_span = !dhw_reset_pending &&
                    logic::dhw_loss_scope_full(window.full_span, slot.dhw_scope_us, now_us);
    logic::CheckupReport report = logic::checkup_evaluate(
        window, slot.cov, source_fresh ? slot.fault_now : FaultClass::Unknown, dhw,
        slot.is_modbus ? logic::OutdoorSource::HomeHub : logic::OutdoorSource::X10a);
    report.pressure_current_tenths = source_fresh ? slot.pressure_now : -1;
    if (source_fresh && !dhw_reset_pending) {
        const int64_t progress_us =
            slot.dhw_state.last_us >= 0 ? std::min(now_us, slot.dhw_state.last_us) : now_us;
        const logic::DhwLossProgress p = logic::dhw_loss_progress(slot.dhw_state, progress_us);
        report.dhw_candidate_s         = p.candidate_observed_s;
        report.dhw_settle_remaining_s  = p.settle_remaining_s;
    }
    logic::checkup_apply_freshness(report, source_fresh, source_age_s, span_s);
    return report;
}

logic::WorkingFigureReport checkup_working_figure_status(const Config&     c,
                                                         DiagnosticsSource source) {
    logic::WorkingFigureReport report{};
    if (!s_mtx || !s_diagnostics_enabled.load(std::memory_order_acquire)) return report;
    logic::WorkingFigureTariffs tariffs{};
    tariffs.elec_price_tenth_mill = c.elec_price_tenth_mill;
    tariffs.gas_price_tenth_mill  = c.gas_price_tenth_mill;
    if (tariff_currency_valid(c.tariff_currency)) {
        std::memcpy(tariffs.currency, c.tariff_currency.data(), 3);
        tariffs.currency[3] = '\0';
    }
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx);
    if (!lk.acquired() || !s_diagnostics_enabled.load(std::memory_order_acquire) ||
        slot.reset_requested.load() || !slot.source_confirmed)
        return report;
    expire_restored_locked(slot);
    const int64_t now_us      = esp_timer_get_time();
    const bool    have_source = slot.source_last_us >= 0 && now_us >= slot.source_last_us;
    const bool    source_fresh =
        have_source && (now_us - slot.source_last_us) <=
                           static_cast<int64_t>(logic::CHECKUP_MAX_GAP_S) * 1000000LL;
    const bool     energy_reset = slot.energy_reset_requested.load();
    const uint32_t span_s =
        energy_reset ? 0u
                     : logic::energy_span_s(slot.energy_acc, slot.energy_carried_span_us, now_us);
    report = logic::working_figure_evaluate(
        energy_reset ? kEmptyEnergyRing : slot.P().energy,
        energy_reset ? kEmptyEnergyAccumulator : slot.energy_acc, slot.energy_cov, tariffs,
        source_fresh, span_s, energy_reset ? nullptr : slot.slot_times.expiry_us, now_us);
    return report;
}

bool checkup_flash_next(int64_t now_unix_s, int64_t after_bucket, int64_t& bucket,
                        logic::CheckupJournalPayload& payload, DiagnosticsSource source) {
    if (!s_mtx || now_unix_s < 0) return false;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx, 0);
    if (!lk.acquired() || s_diagnostics_generation == 0 || slot.reset_requested.load() ||
        !slot.model_fp || !slot.source_confirmed || !slot.source_fp ||
        slot.P().ring.count != slot.P().dhw.count || slot.P().ring.count != slot.P().energy.count)
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
            const size_t energy_i = (static_cast<size_t>(slot.P().energy.head) +
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
            payload.pel_source_fp = slot.pel_source_fp;
            payload.energy        = slot.P().energy.buf[energy_i];
            if (logic::checkup_journal_energy_withheld(slot.energy_restart_armed,
                                                       slot.energy_restart_bucket, current, age)) {
                payload.pel_source_fp = 0;
                payload.energy        = kEmptyEnergyBucket;
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
    if (P().ring.count && P().ring.count == P().dhw.count && P().ring.count == P().energy.count &&
        slot.last_commit_us != kNoCommitUs && now_us >= slot.last_commit_us) {
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

    size_t     materialized               = 0;
    int64_t    earliest_stored_end        = INT64_MAX;
    int64_t    earliest_energy_stored_end = INT64_MAX;
    const bool energy_reset_pending       = slot.energy_reset_requested.load();
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
        if (!energy_reset_pending &&
            logic::checkup_journal_pel_identity_matches(rec->payload, slot.pel_source_fp) &&
            rec->payload.end_unix_s < earliest_energy_stored_end)
            earliest_energy_stored_end = rec->payload.end_unix_s;
    }
    if (!materialized) return fresh_if_pending();
    const auto wall_span_s =
        static_cast<uint32_t>(now_unix_s - earliest_stored_end) + logic::CHECKUP_DT_S;

    bool energy_retired = false;
    if (logic::checkup_journal_rebuild(
            P().ring, P().dhw, slot.slot_times, live, records, count, earliest_bucket,
            latest_bucket, now_unix_s, now_us, slot.source_confirmed, slot.model_fp, slot.source_fp,
            s_diagnostics_generation, reset_requested, slot.dhw_source_fp,
            slot.dhw_reset_requested.load(), P().energy, slot.pel_source_fp, energy_reset_pending,
            energy_retired))
        slot.dhw_scope_us = now_us;
    if (energy_retired || earliest_energy_stored_end == INT64_MAX) {
        if (energy_retired) slot.energy_scope_us = now_us;
        slot.energy_carried_span_us = 0;
    } else {
        const auto energy_wall_span_s =
            static_cast<uint32_t>(now_unix_s - earliest_energy_stored_end) + logic::CHECKUP_DT_S;
        const int64_t live_energy_span_us =
            slot.energy_acc.first_sample_us >= 0 && now_us >= slot.energy_acc.first_sample_us
                ? now_us - slot.energy_acc.first_sample_us
                : 0;
        const int64_t energy_wall_span_us = static_cast<int64_t>(energy_wall_span_s) * 1000000LL;
        slot.energy_carried_span_us       = energy_wall_span_us > live_energy_span_us
                                                ? energy_wall_span_us - live_energy_span_us
                                                : 0;
    }
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
        !cycling_snapshot_locked(slot, trace, esp_timer_get_time(), true))
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
        s_diagnostics_generation != identity.diagnostics_generation)
        return Result::Ignored;
    if (!slot.is_modbus) {
        // Use the same boot-relative wall second as the live chart and run archive. The wall
        // sample captured before reading the flash group can round to a different boot second.
        const int64_t  now_us = esp_timer_get_time();
        const uint32_t wall   = cycling_wall_time(now_us);
        const int64_t  boot_s = now_us / 1000000;
        if (wall <= boot_s) return Result::Deferred;
        if (observed_unix_s > wall - boot_s) return Result::TryOlder;
        now_unix_s = wall;
    }
    if (trace.unix_s > now_unix_s || observed_unix_s <= now_unix_s - logic::CHECKUP_WINDOW_S)
        return slot.is_modbus ? Result::Ignored : Result::TryOlder;
    slot.cycling_restored = trace;
    return Result::Restored;
}

bool checkup_cycling_runs_checkpoint(logic::CyclingRunJournalPage& page, uint32_t after_boot_stop_s,
                                     uint32_t& last_boot_stop_s, TickType_t wait_ticks,
                                     uint32_t trace_through_boot_s, uint32_t trace_boot_unix_s) {
    if (!trace_through_boot_s || !trace_boot_unix_s || !s_mtx ||
        s_x10a.cycling_forgotten.load(std::memory_order_acquire))
        return false;
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired() || s_x10a.cycling_forgotten.load(std::memory_order_acquire) ||
        !s_x10a.source_confirmed || trace_boot_unix_s != s_x10a.cycling_checkpoint_anchor ||
        s_x10a.reset_requested.load() || checkup_cycling_reset_pending() ||
        !s_diagnostics_generation ||
        (!s_diagnostics_enabled.load(std::memory_order_acquire) &&
         !s_reboot_saved_this_boot.load(std::memory_order_acquire)))
        return false;

    const int64_t now_us = esp_timer_get_time();
    if (now_us < 0 || now_us / 1000000 > logic::CheckupCyclingTrace::max_second) return false;
    const auto     uptime_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall     = cycling_wall_time(now_us);
    if (wall <= uptime_s) return false;
    const uint32_t boot_unix_s = trace_boot_unix_s;
    if (wall < boot_unix_s) return false;
    s_x10a.cycling_restore_anchor = std::max(s_x10a.cycling_restore_anchor, wall - uptime_s);
    const uint32_t floor = wall > logic::CHECKUP_WINDOW_S ? wall - logic::CHECKUP_WINDOW_S : 0;
    logic::cycling_run_context_finalize(s_run_ctx_trace, now_us, wall,
                                        cycling_restore_floor(s_x10a, uptime_s));
    page          = {};
    page.identity = {s_x10a.model_fp, s_x10a.source_fp, s_diagnostics_generation};
    size_t count  = 0;
    for (size_t i = 0; i < s_run_ctx_trace.count && count < logic::CYCLING_RUN_JOURNAL_CAPACITY;
         ++i) {
        const auto& entry = s_run_ctx_trace.at(i);
        if (!(entry.flags & logic::RUN_CTX_F_FINALIZED) ||
            (entry.flags & logic::RUN_CTX_F_RESTORED) || entry.stop_s <= after_boot_stop_s ||
            entry.stop_s > trace_through_boot_s || entry.stop_s > uptime_s ||
            entry.stop_s > wall - boot_unix_s || entry.start_s > entry.stop_s ||
            boot_unix_s + entry.start_s < floor ||
            !cycling_trace_has_run(s_x10a.cycling_trace, 0, entry.start_s, entry.stop_s))
            continue;
        auto saved = entry;
        saved.start_s += boot_unix_s;
        saved.stop_s += boot_unix_s;
        if (!logic::cycling_run_journal_entry_valid(saved)) continue;
        page.entries[count++] = saved;
        last_boot_stop_s      = entry.stop_s;
    }
    return count > 0 && !s_x10a.cycling_forgotten.load(std::memory_order_acquire);
}

CheckupFlashRestoreResult checkup_cycling_runs_restore(const logic::CyclingRunJournalPage& page,
                                                       uint32_t now_unix_s, TickType_t wait_ticks) {
    using Result = CheckupFlashRestoreResult;
    if (s_x10a.cycling_forgotten.load(std::memory_order_acquire)) return Result::Ignored;
    if (!s_mtx) return Result::Deferred;
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired()) return Result::Deferred;
    if (!s_x10a.cycling_restore_allowed || !s_diagnostics_generation ||
        s_x10a.reset_requested.load() || s_x10a.cycling_forgotten.load(std::memory_order_acquire))
        return Result::Ignored;
    if (!s_x10a.source_confirmed || !now_unix_s) return Result::Deferred;
    const auto& trace = s_x10a.cycling_restored;
    if (!trace.count || page.identity.model_fp != s_x10a.model_fp ||
        page.identity.source_fp != s_x10a.source_fp ||
        page.identity.diagnostics_generation != s_diagnostics_generation)
        return Result::Ignored;

    const int64_t now_us = esp_timer_get_time();
    if (now_us < 0 || now_us / 1000000 > logic::CheckupCyclingTrace::max_second)
        return Result::Deferred;
    const auto     uptime_s = static_cast<uint32_t>(now_us / 1000000);
    const uint32_t wall     = cycling_wall_time(now_us);
    if (wall <= uptime_s) return Result::Deferred;
    if (trace.unix_s > wall) return Result::Ignored;
    const uint32_t boot_unix_s    = wall - uptime_s;
    s_x10a.cycling_restore_anchor = std::max(s_x10a.cycling_restore_anchor, boot_unix_s);
    const uint32_t floor          = cycling_restore_floor(s_x10a, uptime_s);
    const int64_t  shift          = static_cast<int64_t>(trace.unix_s) - trace.window_end_s;
    if (shift + trace.end_s > boot_unix_s) return Result::Ignored;

    bool added = false;
    for (size_t i = logic::cycling_run_journal_count(page); i > 0; --i) {
        auto entry = page.entries[i - 1];
        if (entry.start_s < floor || entry.stop_s >= boot_unix_s ||
            !cycling_trace_has_run(trace, shift, entry.start_s, entry.stop_s))
            continue;
        if (s_run_ctx_trace.count) {
            const auto& oldest = s_run_ctx_trace.at(0);
            if ((oldest.flags & logic::RUN_CTX_F_RESTORED) && entry.stop_s > oldest.start_s)
                continue;
        }
        entry.flags |= logic::RUN_CTX_F_RESTORED;
        if (!s_run_ctx_trace.prepend(entry)) break;
        added = true;
    }
    // A confirmed profile can restore before its first usable sample. Protect the restored
    // prefix from the tracker's normal first-sample initialization.
    if (added && !s_run_ctx_tracker.have_generation)
        s_run_ctx_tracker.reset(s_stop_generation, true);
    return added ? Result::Restored : Result::Ignored;
}

void checkup_cycling_forget() {
    s_x10a.cycling_forgotten.store(true, std::memory_order_release);
    s_modbus.cycling_forgotten.store(true, std::memory_order_release);
    checkup_fault_forget();
}

bool checkup_dhw_trace_reset_pending(DiagnosticsSource source) {
    const CheckupSlot& slot = slot_for(source);
    return slot.dhw_reset_requested.load() ||
           slot.dhw_trace_barrier.load(std::memory_order_acquire) !=
               slot.dhw_trace_barrier_acked.load(std::memory_order_acquire);
}

void checkup_dhw_trace_checkpoint_appended(uint32_t token, DiagnosticsSource source) {
    CheckupSlot& slot = slot_for(source);
    if (token & kDhwTraceBarrierToken) {
        // The journal serializes writes and acknowledgments. Clear the watermark when the fence
        // commits so an older in-flight data append cannot reinstate it after a clock step.
        slot.dhw_trace_saved_end_s.store(0, std::memory_order_relaxed);
        slot.dhw_trace_barrier_acked.store(token, std::memory_order_release);
    } else {
        slot.dhw_trace_saved_end_s.store(token, std::memory_order_release);
    }
}

void checkup_dhw_trace_forget() {
    s_x10a.dhw_trace_forgotten.store(true, std::memory_order_release);
    s_modbus.dhw_trace_forgotten.store(true, std::memory_order_release);
}

bool checkup_dhw_trace_checkpoint(logic::DhwLossTracePage& page, uint32_t& token,
                                  TickType_t wait_ticks, DiagnosticsSource source) {
    if (!s_mtx) return false;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx, wait_ticks);
    if (!lk.acquired() || slot.dhw_trace_forgotten.load(std::memory_order_acquire)) return false;
    apply_dhw_reset_locked(slot);
    const auto     uptime_s = static_cast<uint32_t>(esp_timer_get_time() / 1000000);
    const uint32_t unix_s   = (slot.dhw_trace.count || slot.dhw_trace_clock_anchor_s)
                                  ? dhw_trace_wall_locked(slot, uptime_s)
                                  : 0;
    if (slot.dhw_trace_forgotten.load(std::memory_order_acquire)) return false;
    const uint32_t barrier = slot.dhw_trace_barrier.load(std::memory_order_relaxed);
    std::memset(&page, 0, sizeof(page));
    if (barrier != slot.dhw_trace_barrier_acked.load(std::memory_order_acquire)) {
        token = barrier;
        return true;
    }
    if (!unix_s || slot.reset_requested.load() || !slot.source_confirmed ||
        s_diagnostics_generation == 0)
        return false;
    auto&          trace  = slot.dhw_trace;
    const uint32_t newest = trace.newest_end_s();
    if (newest <= trace.frame_offset_s) return false;
    token = newest - trace.frame_offset_s;
    if (token & kDhwTraceBarrierToken ||
        token <= slot.dhw_trace_saved_end_s.load(std::memory_order_acquire))
        return false;
    if (uptime_s > UINT32_MAX - trace.frame_offset_s) return false;
    const uint32_t frame_s = uptime_s + trace.frame_offset_s;
    trace.expire(frame_s);
    if (!trace.count) return false;
    page.unix_s                 = unix_s;
    page.count                  = trace.count;
    page.model_fp               = slot.model_fp;
    page.source_fp              = slot.source_fp;
    page.dhw_source_fp          = slot.dhw_source_fp;
    page.diagnostics_generation = s_diagnostics_generation;
    for (size_t i = 0; i < page.count; ++i)
        if (!logic::dhw_loss_trace_pack(
                page.records[i], trace.windows[(trace.head + i) % logic::DHW_LOSS_TRACE_CAPACITY],
                frame_s))
            return false;
    if (slot.dhw_trace_forgotten.load(std::memory_order_acquire) || slot.dhw_reset_requested.load())
        return false;
    if (!slot.dhw_trace_clock_anchor_s && unix_s >= uptime_s)
        slot.dhw_trace_clock_anchor_s = unix_s - uptime_s;
    return true;
}

[[gnu::noinline]] bool checkup_dhw_trace_restore_ready(DiagnosticsSource source) {
    if (!s_mtx) return false;
    Lock lk(s_mtx, 0);
    return lk.acquired() && slot_for(source).source_confirmed;
}

CheckupFlashRestoreResult checkup_dhw_trace_restore(const logic::DhwLossTracePage& page,
                                                    TickType_t                     wait_ticks,
                                                    DiagnosticsSource              source) {
    using Result = CheckupFlashRestoreResult;
    if (!s_mtx) return Result::Deferred;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx, wait_ticks);
    if (!lk.acquired()) return Result::Deferred;
    if (!slot.dhw_trace_restore_allowed || slot.dhw_trace_forgotten.load() ||
        slot.reset_requested.load() || slot.dhw_reset_requested.load() ||
        s_diagnostics_generation == 0)
        return Result::Ignored;
    if (!slot.source_confirmed) return Result::Deferred;
    if (page.model_fp != slot.model_fp || page.source_fp != slot.source_fp ||
        page.dhw_source_fp != slot.dhw_source_fp ||
        page.diagnostics_generation != s_diagnostics_generation)
        return Result::Ignored;
    const auto     uptime_s = static_cast<uint32_t>(esp_timer_get_time() / 1000000);
    const uint32_t unix_s   = dhw_trace_wall_s(uptime_s);
    if (slot.dhw_trace_forgotten.load() || slot.dhw_reset_requested.load()) return Result::Ignored;
    if (!unix_s) return Result::Deferred;
    if (!logic::dhw_loss_trace_restore(slot.dhw_trace, page, uptime_s, unix_s))
        return Result::Ignored;
    slot.dhw_trace_clock_anchor_s  = unix_s - uptime_s;
    slot.dhw_trace_restore_allowed = false;
    return Result::Restored;
}

bool checkup_has_cycling_run_contexts(DiagnosticsSource source, uint32_t boot_s,
                                      uint32_t timeline_unix_s) {
    if (source != DiagnosticsSource::X10a || !s_mtx ||
        !s_diagnostics_enabled.load(std::memory_order_acquire))
        return false;
    Lock lk(s_mtx);
    if (!lk.acquired() || !s_diagnostics_enabled.load(std::memory_order_acquire) ||
        s_x10a.reset_requested.load() || !s_x10a.source_confirmed ||
        s_x10a.cycling_forgotten.load(std::memory_order_acquire))
        return false;
    const uint32_t floor = cycling_restore_floor(s_x10a, boot_s);
    for (size_t i = 0; i < s_run_ctx_trace.count; ++i) {
        const auto& run = s_run_ctx_trace.at(i);
        if (run.flags & logic::RUN_CTX_F_RESTORED) {
            if (logic::cycling_run_context_restored_in_window(run, boot_s, timeline_unix_s, floor))
                return true;
        } else if (run.start_s <= boot_s && boot_s - run.start_s <= logic::CHECKUP_WINDOW_S) {
            return true;
        }
    }
    return false;
}

bool checkup_cycling_run_contexts(logic::CheckupRunContextSnapshot& out, uint32_t boot_s,
                                  DiagnosticsSource source, uint32_t timeline_unix_s) {
    out.reset();
    if (source != DiagnosticsSource::X10a || !s_mtx ||
        !s_diagnostics_enabled.load(std::memory_order_acquire))
        return false;
    Lock lk(s_mtx);
    if (!lk.acquired() || !s_diagnostics_enabled.load(std::memory_order_acquire) ||
        s_x10a.reset_requested.load() || !s_x10a.source_confirmed)
        return false;
    if (s_x10a.cycling_forgotten.load(std::memory_order_acquire)) {
        reset_run_ctx_locked();
        return false;
    }
    logic::cycling_run_context_expire(s_run_ctx_tracker, esp_timer_get_time());
    if (!s_run_ctx_trace.count) return false;
    // The report owns this time frame. Use the floor advanced by the timeline so a wall-clock
    // correction cannot make expired entries visible again.
    logic::cycling_run_context_snapshot(out, s_run_ctx_trace, boot_s, timeline_unix_s,
                                        cycling_restore_floor(s_x10a, boot_s));
    return out.count > 0;
}

CheckupFaultStatus checkup_fault_latest_status(DiagnosticsSource source, bool source_fresh) {
    CheckupFaultStatus st;
    if (!s_mtx || !s_diagnostics_enabled.load(std::memory_order_acquire)) return st;
    std::unique_ptr<logic::CheckupFaultTrace> snap(new (std::nothrow) logic::CheckupFaultTrace);
    if (!snap) return st;

    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx);
    if (!lk.acquired() || !s_diagnostics_enabled.load(std::memory_order_acquire) ||
        slot.reset_requested.load())
        return st;
    st.diagnostics_enabled = true;
    const int64_t now_us   = esp_timer_get_time();
    if (!fault_snapshot_locked(slot, *snap, now_us, false)) return st;
    st.source_live = snap->live && source_fresh;
    st.latest      = logic::checkup_fault_latest_extract(*snap, source_fresh);
    return st;
}

bool checkup_fault_timeline_snapshot(logic::CheckupFaultTrace& out, DiagnosticsSource source) {
    out.reset();
    if (!s_mtx || !s_diagnostics_enabled.load(std::memory_order_acquire)) return false;
    CheckupSlot& slot = slot_for(source);
    Lock         lk(s_mtx);
    if (!lk.acquired() || !s_diagnostics_enabled.load(std::memory_order_acquire) ||
        slot.reset_requested.load())
        return false;
    if (!fault_snapshot_locked(slot, out, esp_timer_get_time(), false)) {
        out.reset();
        return false;
    }
    return true;
}

bool checkup_fault_checkpoint(logic::CheckupFaultTrace&    trace,
                              logic::CyclingTraceIdentity& identity, uint32_t& reset_token,
                              TickType_t wait_ticks, bool periodic_due, bool dirty_due,
                              DiagnosticsSource source) {
    CheckupSlot& slot = slot_for(source);
    if (!s_mtx || slot.fault_forgotten.load(std::memory_order_acquire)) return false;
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired() || slot.fault_forgotten.load(std::memory_order_acquire)) return false;
    reset_token            = 0;
    const uint32_t pending = slot.fault_reset_token.load(std::memory_order_relaxed);
    if (pending != slot.fault_reset_acked.load(std::memory_order_acquire)) {
        trace.reset();
        trace.window_end_s = logic::CHECKUP_FAULT_WINDOW_S;
        trace.unix_s       = 1;
        trace.live         = false;
        identity           = {};
        reset_token        = pending;
        return true;
    }
    const bool allow_checkpoint = s_diagnostics_enabled.load(std::memory_order_acquire) ||
                                  s_reboot_saved_this_boot.load(std::memory_order_acquire);
    const bool want = periodic_due || (dirty_due && slot.fault_trace_dirty);
    if (!want || !allow_checkpoint || s_diagnostics_generation == 0 ||
        slot.reset_requested.load() || !slot.fault_trace.count ||
        !fault_snapshot_locked(slot, trace, esp_timer_get_time(), true))
        return false;
    slot.fault_trace_dirty = false;
    identity               = {slot.model_fp, slot.source_fp, s_diagnostics_generation};
    return true;
}

bool checkup_fault_reset_pending(DiagnosticsSource source) {
    const CheckupSlot& slot = slot_for(source);
    return slot.fault_reset_token.load(std::memory_order_acquire) !=
           slot.fault_reset_acked.load(std::memory_order_acquire);
}

void checkup_fault_checkpoint_appended(uint32_t reset_token, DiagnosticsSource source) {
    if (reset_token)
        slot_for(source).fault_reset_acked.store(reset_token, std::memory_order_release);
}

CheckupFlashRestoreResult checkup_fault_restore(const logic::CheckupFaultTrace&    trace,
                                                const logic::CyclingTraceIdentity& identity,
                                                int64_t now_unix_s, TickType_t wait_ticks,
                                                DiagnosticsSource source) {
    using Result      = CheckupFlashRestoreResult;
    CheckupSlot& slot = slot_for(source);
    if (slot.fault_forgotten.load(std::memory_order_acquire)) return Result::Ignored;
    if (!s_mtx) return Result::Deferred;
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired()) return Result::Deferred;
    if (!trace.count || !slot.fault_restore_allowed || s_diagnostics_generation == 0 ||
        slot.reset_requested.load() || slot.fault_forgotten.load(std::memory_order_acquire))
        return Result::Ignored;
    if (!slot.source_confirmed || now_unix_s <= 0) return Result::Deferred;
    const int64_t observed_unix_s =
        static_cast<int64_t>(trace.unix_s) + trace.end_s - trace.window_end_s;
    if (slot.model_fp != identity.model_fp || slot.source_fp != identity.source_fp ||
        s_diagnostics_generation != identity.diagnostics_generation || trace.unix_s > now_unix_s ||
        observed_unix_s <= now_unix_s - logic::CHECKUP_FAULT_WINDOW_S)
        return Result::Ignored;
    if (slot.fault_restored.count && slot.fault_restored.unix_s > 0 &&
        slot.fault_restored.unix_s >= trace.unix_s)
        return Result::Restored;
    slot.fault_restored   = trace;
    slot.fault_warm_gap_s = -1;
    return Result::Restored;
}

void checkup_fault_forget() {
    s_x10a.fault_forgotten.store(true, std::memory_order_release);
    s_modbus.fault_forgotten.store(true, std::memory_order_release);
}

} // namespace daik
