#pragma once
#include "logic/observation_hourly.hpp"

namespace daik {

struct StopObservationReport {
    logic::StopContextCounters counters;
    uint64_t                   readable_us         = 0;
    uint16_t                   observed_hours      = 0;
    uint16_t                   dropped             = 0; // per-identity cumulative loss watermark
    bool                       confirmed           = false;
    bool                       dated               = false;
    bool                       partial             = true;
    bool                       restore_pending     = true;
    bool                       persistence_pending = false;
};

// Startup retires all RAM candidates. Only completed, dated, exact-identity flash hours return.
void stop_observation_start(bool enabled, uint32_t consent_generation);
void stop_observation_set_diagnostics(bool enabled, uint32_t consent_generation);
void stop_observation_bind(uint32_t source_fp, uint32_t model_fp, uint32_t schema_fp,
                           uint32_t source_generation, bool allow_restore = true);
void stop_observation_reset();
void stop_observation_record(int64_t sample_us, bool rps_readable,
                             const logic::StopContextEvent& finalized = {});
void stop_observation_seal();
StopObservationReport stop_observation_report();

// Mandatory root-owned hook. History invokes it before its flash lock; it must expire/censor the
// reducer's pending stop even when no new sweep arrives, and deliver that event to this store.
void checkup_stop_context_expire(int64_t now_us);

// Flash owner only. Readers return only a physically valid exact observation format and never
// call checkup. These callbacks are never used by producer/report paths.
using StopObservationReader = bool (*)(uint16_t slot, int64_t& bucket, uint64_t& sequence,
                                       logic::ObservationHourlyPayload& payload);
void stop_observation_flash_index_reset();
// A recognizable committed observation was damaged, so its reset/data kind cannot be trusted.
void stop_observation_flash_index_incomplete();
void stop_observation_flash_index(int64_t bucket, uint64_t sequence, uint16_t slot,
                                  const logic::ObservationHourlyPayload& payload);
bool stop_observation_flash_next(StopObservationReader reader, int64_t& bucket,
                                 logic::ObservationHourlyPayload& payload);
void stop_observation_flash_appended(int64_t bucket, uint64_t sequence, uint16_t slot,
                                     const logic::ObservationHourlyPayload& payload);
void stop_observation_flash_failed();
void stop_observation_flash_service(StopObservationReader reader);
void stop_observation_forget();
// Per-boot recovery privacy barrier, safe before startup and without allocation or locking.
// Only a genuine new boot can permit this store to observe again.
bool stop_observation_suppressed();

} // namespace daik
