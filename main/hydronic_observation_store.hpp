#pragma once
#include "logic/hydronic_hourly.hpp"

namespace daik {

// Retained dated evidence only. Current eligibility, settling and reasons belong to the
// caller's live tracker. Empty populations have no defined mean or accepted timestamps.
struct HydronicObservationReport {
    logic::HydronicTotals         totals;
    logic::HydronicMinimumWindows minimum_windows;
    uint16_t              observed_hours      = 0;
    uint16_t              dropped             = 0; // cumulative per-identity loss watermark
    bool                  confirmed           = false;
    bool                  dated               = false;
    bool                  partial             = true;
    bool                  restore_pending     = true;
    bool                  persistence_pending = false;
};

void hydronic_observation_start(bool enabled, uint32_t consent_generation);
// Per-boot, allocation-free privacy fence. Recovery may latch forget before Start creates
// the mutex; no Start/bind/configuration call can re-enable this boot afterwards.
bool hydronic_observation_suppressed();
void hydronic_observation_set_diagnostics(bool enabled, uint32_t consent_generation);
void hydronic_observation_bind(uint32_t source_fp, uint32_t model_fp, uint32_t schema_fp,
                               uint32_t source_generation, bool allow_restore = true);
void hydronic_observation_reset();
void hydronic_observation_record(const logic::HydronicDelta& delta);
void hydronic_observation_seal();
HydronicObservationReport hydronic_observation_report();

// Flash owner only, with History -> Store zero-wait locking. The callback borrows the
// caller-owned output for this one read and must never call Checkup or retain that reference.
enum class HydronicReadResult : uint8_t { Valid, Invalid, Retry };
using HydronicObservationReader = HydronicReadResult (*)(uint16_t slot, int64_t& bucket,
                                                         uint64_t&                     sequence,
                                                         logic::HydronicHourlyPayload& payload);
void hydronic_observation_flash_index_reset();
// History calls this for recognizable committed HYDR envelopes before its generic physical
// valid filter: a corrupt record may have been a fence, so its kind cannot be guessed.
void hydronic_observation_flash_index_incomplete();
void hydronic_observation_flash_index(int64_t bucket, uint64_t sequence, uint16_t slot,
                                      const logic::HydronicHourlyPayload& payload);
bool hydronic_observation_flash_next(HydronicObservationReader reader, int64_t& bucket,
                                     logic::HydronicHourlyPayload& payload);
void hydronic_observation_flash_appended(int64_t bucket, uint64_t sequence, uint16_t slot,
                                         const logic::HydronicHourlyPayload& payload);
void hydronic_observation_flash_failed();
void hydronic_observation_flash_service(HydronicObservationReader reader);
void hydronic_observation_forget();

} // namespace daik
