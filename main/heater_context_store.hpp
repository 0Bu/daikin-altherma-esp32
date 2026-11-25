#pragma once

#include "logic/heater_independent_hour.hpp"

namespace daik {
namespace logic {
struct HeaterContextPayloadFields;
}

struct HeaterContextStatus {
    uint64_t on_us[2]{}, readable_us[2]{};
    uint32_t epoch        = 0;
    uint16_t capabilities = 0, flags = logic::heater_cohort::Partial, dropped = 0;
    uint8_t  supported_heaters = 0, observed_hours[2]{};
    bool     confirmed = false, dated = false, partial = true;
    bool     restore_pending = true, persistence_pending = false;
};
struct HeaterContextHeaterReport {
    logic::heater_context::Totals counters;
    uint32_t                      epoch = 0;
    uint16_t capabilities = 0, flags = logic::heater_cohort::Partial, dropped = 0;
    uint8_t  supported_heaters = 0, observed_hours = 0;
    bool     confirmed = false, dated = false, partial = true;
    bool     restore_pending = true, persistence_pending = false;
};
static_assert(sizeof(HeaterContextStatus) <= 96, "small all-caller projection");

// Call start once before HTTP/poll/History readers. Static mutex initialization
// precedes producers. The reducer and these counters are independent of the
// legacy core BUH/BSH observation clocks.
void heater_context_start(bool enabled, uint32_t consent_generation);
void heater_context_set_diagnostics(bool enabled, uint32_t consent_generation);
void heater_context_set_enabled(bool enabled);
void heater_context_bind(uint32_t source_fp, uint32_t model_fp, uint32_t schema_fp,
                         uint32_t source_generation, uint16_t capabilities,
                         uint8_t supported_heaters, bool allow_restore = true);
void heater_context_pause();
void heater_context_reset();
void heater_context_record(int64_t sample_us, const logic::heater_context::Sample& sample);
void heater_context_seal();
void heater_context_expire();
HeaterContextStatus heater_context_status();
void                heater_context_report(uint8_t heater, HeaterContextHeaterReport& out);
// Both heaters are projected under one lock; serializers run after it is
// released.
void heater_context_payload(logic::HeaterContextPayloadFields& out);

// Flash-owner only. No Reader is called while the heater mutex is held. Its
// header/payload storage must be distinct from owner staging and valid until
// the next Reader call.
using HeaterContextReader = bool (*)(uint16_t slot, logic::heater_cohort::View& view);
constexpr size_t  HEATER_CONTEXT_FLASH_MAX_READS = 256;
constexpr int64_t HEATER_CONTEXT_FLASH_SLICE_US  = 5000;
constexpr int64_t HEATER_CONTEXT_FLASH_RETRY_US  = 1000000;
struct HeaterContextFlashPiece {
    int64_t  bucket   = -1;
    uint64_t sequence = 0;
    uint32_t token = 0, epoch = 0;
    uint16_t bytes                  = 0;
    uint8_t  ordinal                = 0,
            remaining               = 0; // inclusive: current piece is part of remaining
    logic::heater_cohort::Kind kind = logic::heater_cohort::Kind::Unknown;
};
// Full scope-filtered rescan; false means no confirmed scope is available yet.
// The adapter may instead let budgeted service calls finish the pass after
// bind. Never interleave a partial pass and initial hour materialization.
bool heater_context_flash_scan_begin();
void heater_context_flash_scan_slot(uint16_t slot, const logic::heater_cohort::View& view,
                                    bool read_ok);
void heater_context_flash_scan_finish();
// Unknown/failed physical mutation: invalidate proof without inventing data dirtiness.
// A full reproof reconciles durable references; fence/highwater are retained.
void heater_context_flash_index_invalidate();
// Only successful real sector erase: revoke affected durable references, not unrelated hours.
// Invalid range/alignment falls back to generic proof invalidation. No Reader I/O occurs.
void heater_context_flash_sector_erased(uint16_t first_slot);
// One positive-budget call per poll tick. The budget covers index AND replay
// reads together, capped at 256 and a 5 ms soft deadline checked between Reader
// calls. Budget 0 never invokes Reader. A single Reader cannot be preempted.
// Shutdown/append callers use 0, not a whole-journal drain.
void heater_context_flash_service(HeaterContextReader reader, size_t scan_budget = 0);
// History pins this source until remaining reaches 1 and that piece ACKs, or
// failed() aborts. next_global_sequence comes from the real global sequencer;
// no reservation may reach UINT64_MAX. next performs zero Reader calls;
// remaining is always one.
bool heater_context_flash_next(HeaterContextReader reader, uint64_t next_global_sequence,
                               HeaterContextFlashPiece& out, uint8_t* payload, size_t capacity);
// Only actual physical readback may invoke appended. Metadata/CRC/payload are
// checked again. The physical Flash callbacks (including sector_erased/index_invalidate) use the
// blocking Heater lock after startup: never drop one-shot physical receipts/mutations. Flash
// retains its Reader buffer and immutable piece while waiting. No Heater-held body calls Flash,
// Reader, Checkup, Config, HTTP or an allocator; Flash -> Heater has no reverse edge.
void heater_context_flash_appended(const HeaterContextFlashPiece& piece, uint16_t slot,
                                   const logic::heater_cohort::View& readback);
void heater_context_flash_failed(const HeaterContextFlashPiece& piece);
// Erase-keeper yield before any write: preserve this immutable transaction and
// reoffer the same ordinal/sequence/bytes on the next tick, after rechecking
// the current lifecycle.
void heater_context_flash_deferred(const HeaterContextFlashPiece& piece);
// Zero I/O; lock contention conservatively reports Pending. Retire stale scope/epoch claims
// so History can release a pin after false-next, while preserving a valid reproof wait.
bool heater_context_flash_claim_pending();
enum class HeaterContextErasePermission : uint8_t { Pending, Protected, Allowed };
// One bounded 256-read / 5 ms slice. Pending retains this exact physical
// cursor; Protected may skip one sector. Validate all target fences in ONE
// combined outside pass, never one pass per fence. Root serializes writers
// until the proof completes and invalidates it after physical mutation.
HeaterContextErasePermission heater_context_flash_erase_permission(HeaterContextReader reader,
                                                                   uint16_t            first_slot);
void                         heater_context_forget();

} // namespace daik

namespace daik {
size_t heater_context_private_static_bytes();
}
