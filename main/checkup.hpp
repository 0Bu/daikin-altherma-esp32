#pragma once
// The rolling plant diagnosis — storage and plumbing. Everything decidable (row locators,
// the edge rules, the ring mechanics, the thresholds and the verdicts) lives in logic/checkup.hpp
// and is host-tested; this file is the static ring, one mutex, and the fold from a poll cycle's
// cached values into the open hour.
//
// STATIC, never heap — the same argument history.hpp makes: the binding limit on this board is the
// largest CONTIGUOUS free block, and a static array does not compete for it. 24 one-hour buckets
// cost logic/checkup.hpp's CHECKUP_BYTES.
//
// Still not in NVS — hourly buckets there would write into the partition holding WiFi credentials.
// Completed RAM hours are retired at every boot. The existing append-only `history` partition
// restores dated compatible completed hours after clock sync and current source confirmation,
// without reconstructing them from lossy five-minute trends. See logic/checkup_persist.hpp.
//
// An explicit X10A re-detection, profile or pin identity change still empties the window. A
// HomeHub-only edit is a separate source and deliberately does not.
#include "hp_poll.hpp"          // CachedValue
#include "freertos/FreeRTOS.h"
#include "logic/checkup.hpp"
#include "logic/checkup_persist.hpp"
#include "logic/config_model.hpp"
#include "logic/cycling_persist.hpp"
#include "logic/cycling_run_context.hpp"
#include "logic/dhw_loss_persist.hpp"
#include "logic/fault_persist.hpp"
#include "logic/fault_trace.hpp"
#include "hydronic_observation_store.hpp"
#include "stop_observation_store.hpp"

#include <cstddef>
#include <cstdint>

namespace daik {

// Transport between the checkup owner and history.cpp's shared flash-journal owner.  The absolute
// bucket is duplicated outside the payload because it belongs to the common journal header; the
// payload's exact end time is what validates age/full-span after a cold boot.
using CheckupFlashRecord = logic::CheckupJournalRecord;

enum class CheckupFlashRestoreResult : uint8_t { Deferred, Ignored, Restored };

bool checkup_dhw_trace_checkpoint(logic::DhwLossTracePage& page, uint32_t& token,
                                  TickType_t wait_ticks, DiagnosticsSource source);
bool checkup_dhw_trace_reset_pending(DiagnosticsSource source);
void checkup_dhw_trace_checkpoint_appended(uint32_t token, DiagnosticsSource source);
bool checkup_dhw_trace_restore_ready(DiagnosticsSource source);
CheckupFlashRestoreResult checkup_dhw_trace_restore(const logic::DhwLossTracePage& page,
                                                    TickType_t                     wait_ticks,
                                                    DiagnosticsSource              source);
void                      checkup_dhw_trace_forget();

bool checkup_cycling_checkpoint(logic::CheckupCyclingTrace&  trace,
                                logic::CyclingTraceIdentity& identity, uint32_t& reset_token,
                                TickType_t wait_ticks, bool allow_data,
                                DiagnosticsSource source = DiagnosticsSource::X10a);
bool checkup_cycling_reset_pending(DiagnosticsSource source = DiagnosticsSource::X10a);
void checkup_cycling_checkpoint_appended(uint32_t          reset_token,
                                         DiagnosticsSource source = DiagnosticsSource::X10a);
CheckupFlashRestoreResult
                          checkup_cycling_restore(const logic::CheckupCyclingTrace&  trace,
                                                  const logic::CyclingTraceIdentity& identity, int64_t now_unix_s,
                                                  TickType_t wait_ticks, DiagnosticsSource source = DiagnosticsSource::X10a);
void                      checkup_cycling_forget();

struct CheckupFaultStatus {
    bool                      diagnostics_enabled = false;
    bool                      source_live         = false;
    logic::CheckupFaultLatest latest{};
};

CheckupFaultStatus checkup_fault_latest_status(DiagnosticsSource source = DiagnosticsSource::X10a,
                                               bool              source_fresh = false);
bool               checkup_fault_timeline_snapshot(logic::CheckupFaultTrace& out,
                                                   DiagnosticsSource         source = DiagnosticsSource::X10a);
bool               checkup_fault_checkpoint(logic::CheckupFaultTrace&    trace,
                                            logic::CyclingTraceIdentity& identity, uint32_t& reset_token,
                                            TickType_t wait_ticks, bool periodic_due, bool dirty_due,
                                            DiagnosticsSource source = DiagnosticsSource::X10a);
bool               checkup_fault_reset_pending(DiagnosticsSource source = DiagnosticsSource::X10a);
void               checkup_fault_checkpoint_appended(uint32_t          reset_token,
                                                     DiagnosticsSource source = DiagnosticsSource::X10a);
CheckupFlashRestoreResult checkup_fault_restore(const logic::CheckupFaultTrace&    trace,
                                                const logic::CyclingTraceIdentity& identity,
                                                int64_t now_unix_s, TickType_t wait_ticks,
                                                DiagnosticsSource source = DiagnosticsSource::X10a);
void                      checkup_fault_forget();

// Capture before collecting a poll's inputs, not after the sweep. Admission rejects a token from
// before any diagnostics transition; this live epoch is independent of the saved generation.
uint32_t checkup_consent_epoch();

// Feed one poll cycle. Called from the poll task right after a sweep with that cycle's values — NOT
// under the cache mutex (this takes its own, and holding two would invent a lock order this file
// has no reason to have, exactly like history_record).
//
// `rps_known` / `rps_running` are the compressor state the poll task has ALREADY derived for the
// held-over marking (logic/ou_stale.hpp). Passed in rather than re-derived: two answers to "is the
// compressor running" is how the trend ring and the MQTT bridge would come to blank different rows,
// and here it would be how a compressor start gets counted by one rule and not the other.
// `profile_confirmed` refers to the supplied capability metadata. Temporary allocation/TLS gaps
// pass false to retain the current profile, while an unresolved profile explicitly supplies empty
// metadata. Neither an empty sample nor that flag establishes a successful bus observation.
// `sweep_started_us` is captured before the actual poll begins. Only the independent hydronic
// population uses it to refuse inputs older than its 15 s allowance; unavailable timing (-1)
// cannot qualify that population. Existing minimum-flow and other diagnosis contracts are
// unchanged.
void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running,
                    const logic::CheckupCoverage& coverage, uint32_t source_generation,
                    uint32_t consent_epoch, bool profile_confirmed = true,
                    int64_t sweep_started_us = -1);

// Feed one confirmed HomeHub/Modbus full poll cycle into the independent Modbus checkup slot.
void checkup_record_modbus(const CachedValue* v, size_t n, ModbusProfile profile,
                           uint32_t source_generation, uint32_t consent_epoch,
                           bool               source_confirmed = true,
                           ModbusProfileBasis basis            = ModbusProfileBasis::Affirmative);

// Judge the previous boot's handoff integrity and retire completed RAM hours. app_main calls ONCE,
// before any producer task exists, which is what makes the decision single-threaded and lock-free.
void checkup_start(bool diagnostics_enabled, uint32_t diagnostics_generation);

// Apply the persisted master switch live. Advancing `generation` starts a fresh evidence
// identity, while toggling `enabled` within the same non-zero `generation` pauses or resumes
// recording and preserves already-accumulated 24-hour evidence.
void checkup_set_diagnostics(bool enabled, uint32_t generation);

// Confirm this boot's detected or explicitly selected profile/link scope. Startup's cached scope
// cannot unlock flash restore. The first confirmation may resume a matching one-shot ongoing DHW
// filter; later confirmation changes retire the old window through the reset barrier. Confirmation
// also requires the exact resolved consumer schema; an unknown name cannot borrow generic's scope.
void checkup_reset_on_detect(const char* profile_id, uint32_t source_fp);

// Confirm this boot's HomeHub Modbus profile and host/port fingerprint. Unlocks independent Modbus
// flash restore or clears the Modbus slot when identity changes.
void checkup_modbus_confirm_source(ModbusProfile profile, uint32_t source_fp);

// Start a new observation identity after explicit X10A re-detection, link rewiring or profile
// selection. Cross-task safe: only record consumes it under the checkup mutex and discards that
// in-flight sample; report stays empty while the request is pending.
// HomeHub-only reconfiguration must not call this; it is an independent source.
void checkup_reset();

// Start a new Modbus observation identity after HomeHub reconfiguration/deletion.
void checkup_modbus_reset();

// Start only the DHW-loss/circulation window over after its independent source, mapping or power
// thresholds change. Other findings keep their already-collected 24-hour evidence.
void checkup_dhw_reset();

// True when the requested source has non-empty live or restored evidence in its slot.
bool checkup_has_data(DiagnosticsSource source);

// Copy the judged window, optional cycling/DHW detail, restore provenance, and the last
// observed defrost start under one lock. DHW detail is current-boot runtime evidence only.
// GET /status and MCP use this snapshot. Its POD storage does not allocate under the lock.
// An unreadable snapshot has unknown provenance and carries no accumulated evidence.
logic::CheckupReport checkup_report(logic::CheckupCyclingHours* hours     = nullptr,
                                    logic::CheckupCyclingTrace* trace     = nullptr,
                                    logic::CheckupRestore*      persist   = nullptr,
                                    DiagnosticsSource           source    = DiagnosticsSource::X10a,
                                    logic::DefrostStartReport*  defrost   = nullptr,
                                    logic::DhwLossTimeline*     dhw_trace = nullptr);

// Compact completed-run evidence for MQTT. Shares the evaluator's pure projection, without
// constructing the full eight-check report on the MQTT task's stack. No allocation under its lock.
logic::CheckupCyclingEvidence
checkup_cycling_evidence(DiagnosticsSource source = DiagnosticsSource::X10a);

struct CheckupStopContextReport {
    StopObservationReport observation;
    uint8_t               capability_mask = 0;
    bool                  pending         = false;
};

// Independent, bounded observation population; never changes the completed-run verdict.
CheckupStopContextReport checkup_stop_context_report();

struct CheckupHydronicReport {
    struct SecondarySupply {
        int64_t               sum_milli   = 0;
        uint64_t              duration_us = 0;
        uint32_t              samples     = 0;
        logic::CheckupLocator source{};
    };
    HydronicObservationReport observation;
    SecondarySupply           secondary;
    logic::HydronicReason     reason            = logic::HydronicReason::NoSource;
    uint32_t                  source_generation = 0, schema_fp = 0;
    uint32_t                  settling_remaining_s = 0;
    uint8_t                   limitations          = 0;
    bool                      current              = false;
};

// Current qualification and dated populations have independent clocks. Neither changes the
// existing flow minimum or the eight-check verdict. History calls expiry before its flash lock.
CheckupHydronicReport checkup_hydronic_report();
void                  checkup_hydronic_expire(int64_t now_us);

// Return true when volatile X10A cycling run contexts are populated for the current session.
bool checkup_has_cycling_run_contexts(DiagnosticsSource source = DiagnosticsSource::X10a);

// Copy recent RAM-only X10A cycling run start/stop contexts projected onto the timeline frame.
bool checkup_cycling_run_contexts(logic::CheckupRunContextSnapshot& out, uint32_t boot_s,
                                  DiagnosticsSource source = DiagnosticsSource::X10a);

// Copy the next completed hourly pair after `after_bucket` into a journal payload. `now_unix_s`
// supplies the wall-clock anchor; no record is produced before time is synced or before one hour
// has completed. A run that completes into an already appended start hour makes that hour the next
// record again (logic::checkup_journal_next_target). Called under the FLASH mutex, and takes only
// the independent checkup mutex.
bool checkup_flash_next(int64_t now_unix_s, int64_t after_bucket, int64_t& bucket,
                        logic::CheckupJournalPayload& payload,
                        DiagnosticsSource             source = DiagnosticsSource::X10a);

// The journal confirms that the record for `bucket` is committed. Takes no mutex (one atomic
// store): it only retires a re-appended hour, and the next checkup_flash_next applies it under the
// checkup mutex.
void checkup_flash_appended(int64_t bucket, DiagnosticsSource source = DiagnosticsSource::X10a);

// Splice journal records behind this boot's live pending hour. Deferred until profile detection has
// confirmed the current profile/link scope and consumed its reset. Current-boot pending/live data
// takes precedence; completed RAM hours were retired. Records come in journal order with at most
// one copy per hour, not necessarily in bucket order, and may contain gaps or other source
// identities, all rejected explicitly.
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t           now_unix_s,
                                                DiagnosticsSource source = DiagnosticsSource::X10a);

} // namespace daik
