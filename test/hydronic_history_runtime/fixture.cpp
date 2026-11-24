// Compile the complete production History TU; physical flash and external services are host ports.
#include "sdk.hpp"
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#ifndef HISTORY_PRODUCTION_SOURCE
#error "Bind complete production main/history.cpp"
#endif
#include HISTORY_PRODUCTION_SOURCE

namespace {
const esp_partition_t partition{daik::logic::HISTORY_FLASH_PARTITION_OFFSET,
                                daik::logic::HISTORY_FLASH_PARTITION_BYTES};
}
const esp_partition_t* esp_partition_find_first(int, int, const char* label) {
    return std::strcmp(label, "history") == 0 ? &partition : nullptr;
}
esp_err_t esp_partition_read(const esp_partition_t* part, size_t offset, void* out, size_t bytes) {
    ++journal_sdk::reads;
    if (journal_sdk::fail_read == journal_sdk::reads) return ESP_FAIL;
    if (part != &partition || offset > journal_sdk::flash.size() ||
        bytes > journal_sdk::flash.size() - offset)
        return ESP_ERR_INVALID_ARG;
    std::memcpy(out, journal_sdk::flash.data() + offset, bytes);
    return ESP_OK;
}
esp_err_t esp_partition_write(const esp_partition_t* part, size_t offset, const void* in,
                              size_t bytes) {
    ++journal_sdk::writes;
    const bool fail = journal_sdk::fail_write == journal_sdk::writes;
    if (fail && !journal_sdk::accept_then_fail) return ESP_FAIL;
    if (part != &partition || offset > journal_sdk::flash.size() ||
        bytes > journal_sdk::flash.size() - offset)
        return ESP_ERR_INVALID_ARG;
    const auto* data = static_cast<const uint8_t*>(in);
    for (size_t i = 0; i < bytes; ++i) {
        if ((journal_sdk::flash[offset + i] & data[i]) != data[i])
            throw std::runtime_error("flash adapter refuses zero-to-one program");
        journal_sdk::flash[offset + i] &= data[i];
    }
    return fail ? ESP_FAIL : ESP_OK;
}
esp_err_t esp_partition_erase_range(const esp_partition_t* part, size_t offset, size_t bytes) {
    ++journal_sdk::erases;
    journal_sdk::erased_ranges.emplace_back(offset, bytes);
    if (part != &partition || offset % daik::logic::HISTORY_FLASH_ERASE_BYTES ||
        bytes % daik::logic::HISTORY_FLASH_ERASE_BYTES || offset > journal_sdk::flash.size() ||
        bytes > journal_sdk::flash.size() - offset)
        return ESP_ERR_INVALID_ARG;
    std::memset(journal_sdk::flash.data() + offset, 0xff, bytes);
    return ESP_OK;
}
namespace daik {
namespace detail {
Config        cfg;
void          config_lock() {}
void          config_unlock() {}
const Config& config_ref_locked() { return cfg; }
} // namespace detail
Config config() { return detail::cfg; }
void   diag_printf(const char*, ...) {}
bool   safe_mode_active() { return false; }
bool   time_synced() { return journal_sdk::synced; }
void   time_now(int64_t& seconds, int32_t& ms) {
    seconds = journal_sdk::unix_origin + sdk::now_us / 1000000;
    ms      = static_cast<int32_t>(sdk::now_us % 1000000 / 1000);
}
size_t                heap_largest_internal_block() { return 30000; }
uint32_t              hp_poll_generation() { return 7; }
bool                  hp_poll_generation_matches(uint32_t generation) { return generation == 7; }
uint32_t              circulation_source_generation() { return 1; }
CirculationPumpSample circulation_pump_sample() { return {}; }
void                  checkup_stop_context_expire(int64_t) { ++journal_sdk::stop_expiry; }
void                  checkup_hydronic_expire(int64_t) { ++journal_sdk::hydronic_expiry; }
bool checkup_flash_next(int64_t, int64_t, int64_t& bucket, logic::CheckupJournalPayload& payload,
                        DiagnosticsSource source) {
    if (source == DiagnosticsSource::Modbus || !journal_sdk::core_pending) return false;
    bucket  = journal_sdk::core_bucket;
    payload = {202, 101, 0, 11, bucket * 3600, {}, {}};
    return true;
}
void checkup_flash_appended(int64_t, DiagnosticsSource source) {
    if (source == DiagnosticsSource::Modbus) return;
    ++journal_sdk::core_appended;
    journal_sdk::core_pending = false;
}
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t, DiagnosticsSource                source) {
    if (source == DiagnosticsSource::Modbus) return CheckupFlashRestoreResult::Ignored;
    ++journal_sdk::core_restore;
    journal_sdk::core_restored_records = count;
    for (size_t i = 0; i < count; ++i)
        if (records[i].payload.model_fp != 202)
            throw std::runtime_error("core adapter received another logical source");
    return CheckupFlashRestoreResult::Restored;
}
bool checkup_cycling_checkpoint(logic::CheckupCyclingTrace&, logic::CyclingTraceIdentity&,
                                uint32_t&, TickType_t, bool, DiagnosticsSource) {
    return false;
}
bool                      checkup_cycling_reset_pending(DiagnosticsSource) { return false; }
void                      checkup_cycling_checkpoint_appended(uint32_t, DiagnosticsSource) {}
CheckupFlashRestoreResult checkup_cycling_restore(const logic::CheckupCyclingTrace&,
                                                  const logic::CyclingTraceIdentity&, int64_t,
                                                  TickType_t, DiagnosticsSource) {
    return CheckupFlashRestoreResult::Ignored;
}
bool checkup_cycling_runs_checkpoint(logic::CyclingRunJournalPage&, uint32_t, uint32_t&, TickType_t,
                                     uint32_t, uint32_t) {
    return false;
}
CheckupFlashRestoreResult checkup_cycling_runs_restore(const logic::CyclingRunJournalPage&,
                                                       uint32_t, TickType_t) {
    return CheckupFlashRestoreResult::Ignored;
}
void checkup_cycling_forget() {}
bool checkup_fault_checkpoint(logic::CheckupFaultTrace&, logic::CyclingTraceIdentity&, uint32_t&,
                              TickType_t, bool, bool, DiagnosticsSource) {
    return false;
}
bool                      checkup_fault_reset_pending(DiagnosticsSource) { return false; }
void                      checkup_fault_checkpoint_appended(uint32_t, DiagnosticsSource) {}
CheckupFlashRestoreResult checkup_fault_restore(const logic::CheckupFaultTrace&,
                                                const logic::CyclingTraceIdentity&, int64_t,
                                                TickType_t, DiagnosticsSource) {
    return CheckupFlashRestoreResult::Ignored;
}
void checkup_fault_forget() {}
bool checkup_dhw_trace_checkpoint(logic::DhwLossTracePage&, uint32_t&, TickType_t,
                                  DiagnosticsSource) {
    return false;
}
bool                      checkup_dhw_trace_reset_pending(DiagnosticsSource) { return false; }
void                      checkup_dhw_trace_checkpoint_appended(uint32_t, DiagnosticsSource) {}
bool                      checkup_dhw_trace_restore_ready(DiagnosticsSource) { return false; }
CheckupFlashRestoreResult checkup_dhw_trace_restore(const logic::DhwLossTracePage&, TickType_t,
                                                    DiagnosticsSource) {
    return CheckupFlashRestoreResult::Ignored;
}
void checkup_dhw_trace_forget() {}
} // namespace daik
namespace {
using namespace daik;
using namespace daik::logic;
unsigned assertions = 0;
void     require(bool ok, const char* oracle) {
    ++assertions;
    if (!ok) throw std::runtime_error(oracle);
}
int64_t               hour() { return journal_sdk::unix_origin / 3600; }
HydronicHourlyPayload hydronic_payload(int64_t bucket, uint32_t samples = 1) {
    HydronicHourlyPayload p;
    p.identity      = {101, 202, 303, 11};
    p.first_unix_us = bucket * OBSERVATION_HOUR_US + 1000000;
    p.last_unix_us  = p.first_unix_us + 10000000;
    p.observed_us = p.candidate_us = p.qualified_us = 10000000;
    p.samples                                       = samples;
    // Duration owns [first, first+10s); only a separate accepted endpoint extends the span.
    p.duration_edges = samples > 1 ? HYDRONIC_DUR_FIRST : HYDRONIC_DUR_BOTH;
    if (samples <= 1) --p.last_unix_us;
    if (samples) {
        p.first_accepted_unix_us = p.first_unix_us;
        p.last_accepted_unix_us  = samples == 1 ? p.first_unix_us : p.last_unix_us;
        p.spread                 = {6000LL * samples, 6000, 6000};
        p.flow                   = {10000LL * samples, 10000, 10000};
        p.flow_min_evidence      = hydronic_minimum_slot(p.first_accepted_unix_us);
    }
    require(hydronic_hourly_valid(p, bucket), "fixture_hydronic_payload_valid");
    return p;
}
FlashJournalRecord record(uint32_t fingerprint, uint16_t words, int64_t bucket, uint64_t sequence) {
    FlashJournalRecord r;
    std::memset(&r, 0xff, sizeof(r));
    auto& h       = r.header;
    h.magic       = HISTORY_JOURNAL_MAGIC;
    h.version     = HISTORY_JOURNAL_VERSION;
    h.source      = static_cast<uint8_t>(HistoryJournalSource::Checkup);
    h.flags       = 0;
    h.catalog_fp  = fingerprint;
    h.crc         = 0;
    h.commit      = HISTORY_JOURNAL_COMMITTED;
    h.value_count = words;
    h.slot_bytes  = HISTORY_JOURNAL_SLOT_BYTES;
    h.sequence    = sequence;
    h.bucket      = bucket;
    h.dt_s        = CHECKUP_DT_S;
    h.rings[0]    = TREND_COUNT;
    h.rings[1]    = HOMEHUB_HISTORY_COUNT;
    h.rings[2]    = ENV3_HISTORY_COUNT;
    h.reserved    = 0xffff;
    return r;
}
void crc(FlashJournalRecord& r) {
    r.header.crc =
        history_journal_crc_bytes(r.header, r.payload, history_journal_payload_bytes(r.header));
}
FlashJournalRecord hydronic_record(int64_t bucket, uint64_t sequence, uint32_t samples = 1,
                                   bool legacy = false) {
    const uint32_t family = legacy ? 3266505973u : hydronic_fingerprint();
    auto           r      = record(family, legacy ? 62 : HYDRONIC_WORDS, bucket, sequence);
    hydronic_encode(hydronic_payload(bucket, samples), r.payload, r.header);
    if (legacy) r.header.pad[8] = r.header.pad[9] = 0xff;
    crc(r);
    return r;
}
bool matches_legacy_hydronic_envelope(const FlashJournalRecord& r) {
    const auto& h = r.header;
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           history_journal_header_matches(h, 3266505973u, 62, 3600) &&
           h.crc == history_journal_crc_bytes(h, r.payload, 124) && r.payload[123] == 0;
}
FlashJournalRecord stop_record(int64_t bucket, uint64_t sequence) {
    auto r = record(observation_fingerprint(), OBSERVATION_WORDS, bucket, sequence);
    ObservationHourlyPayload p;
    p.identity      = {101, 202, 404, 11};
    p.first_unix_us = bucket * OBSERVATION_HOUR_US;
    p.last_unix_us  = p.first_unix_us + 10000000;
    p.readable_us   = 10000000;
    require(observation_payload_valid(p, bucket), "fixture_stop_payload_valid");
    observation_encode(p, r.payload);
    crc(r);
    return r;
}
FlashJournalRecord core_record(int64_t bucket, uint64_t sequence) {
    auto r = record(checkup_journal_fingerprint(), CHECKUP_JOURNAL_WORDS, bucket, sequence);
    const CheckupJournalPayload p{202, 101, 0, 11, bucket * 3600};
    std::memcpy(r.payload, &p, sizeof(p));
    crc(r);
    return r;
}
void put(size_t slot, const FlashJournalRecord& r) {
    require(slot < HISTORY_JOURNAL_SLOT_COUNT, "fixture_slot_in_range");
    std::memcpy(journal_sdk::flash.data() + history_journal_slot_offset(slot), &r, sizeof(r));
}
FlashJournalRecord get(size_t slot) {
    FlashJournalRecord r;
    require(esp_partition_read(&partition, history_journal_slot_offset(slot), &r, sizeof(r)) ==
                ESP_OK,
            "fixture_record_read");
    return r;
}
constexpr unsigned kRestoreTicks = HISTORY_FLASH_TOTAL_RINGS / 4 + 6;
void               boot(bool start_stores_first = true) {
    if (start_stores_first) {
        stop_observation_start(true, 11);
        hydronic_observation_start(true, 11);
    }
    history_start();
    if (!start_stores_first) {
        stop_observation_start(true, 11);
        hydronic_observation_start(true, 11);
    }
    stop_observation_bind(101, 202, 404, 7);
    hydronic_observation_bind(101, 202, 303, 7);
    require(s_flash_scan_ok, "complete_history_scan");
    for (unsigned i = 0; i < kRestoreTicks; ++i) history_service_flash_restore();
    require(s_flash_restore_done, "complete_trend_restore");
}
void tick(int64_t from_s, int64_t to_s) {
    sdk::now_us = to_s * 1000000;
    HydronicDelta d;
    d.from_us     = from_s * 1000000;
    d.to_us       = sdk::now_us;
    d.observed_us = d.candidate_us = d.qualified_us = d.to_us - d.from_us;
    d.accepted                                      = true;
    d.spread_milli                                  = 6000;
    d.flow_milli                                    = 10000;
    hydronic_observation_record(d);
}
void mixed_scan() {
    put(1, hydronic_record(hour() - 2, 1, 1, true));
    put(2, core_record(hour() - 1, 4));
    put(3, hydronic_record(hour() - 1, 2, 9, true));
    put(9, stop_record(hour() - 1, 3));
    put(15, hydronic_record(hour() - 1, 7, 2));
    boot(false); // journal hooks may precede Store startup
    require(s_flash_next_sequence == 8 && s_flash_next_slot == 16,
            "shared_head_includes_hydronic_sequence");
    require(journal_sdk::core_restore == 1 && journal_sdk::core_restored_records == 1,
            "core_restore_only_core_record");
    require(s_flash_last_bucket[static_cast<size_t>(HistoryJournalSource::Checkup)] == hour() - 1,
            "core_cursor_excludes_observation_formats");
    const auto h = hydronic_observation_report();
    require(h.totals.samples == 3 && h.observed_hours == 2 && !h.restore_pending,
            "hydronic_restore_uses_latest_revision_once");
    require(h.totals.flow.min_milli == 10000 && h.minimum_windows.locations_missing &&
                h.minimum_windows.first_bucket == hour() - 23 && !h.minimum_windows.masks[21] &&
                h.minimum_windows.masks[22] == 1,
            "legacy_restore_retains_minimum_without_fabricating_its_location");
    const auto s = stop_observation_report();
    require(s.readable_us == 10000000 && s.observed_hours == 1, "stop_restore_remains_independent");
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "scan_and_restore_never_rewrite_flash");
}
void retry_indexed_read() {
    const auto newer = hydronic_record(hour() - 1, 3, 3);
    put(2, hydronic_record(hour() - 2, 2, 2));
    put(3, newer);
    stop_observation_start(true, 11);
    hydronic_observation_start(true, 11);
    history_start();
    hydronic_observation_bind(101, 202, 303, 7);
    require(s_flash_scan_ok, "initial_index_is_complete");

    journal_sdk::fail_read = journal_sdk::reads + 2;
    hydronic_observation_flash_service(flash_read_hydronic_observation);
    const auto pending = hydronic_observation_report();
    require(journal_sdk::reads == journal_sdk::fail_read && !pending.totals.samples &&
                pending.restore_pending,
            "transient_indexed_read_withholds_entire_staged_replay");

    auto damaged = newer;
    damaged.payload[20] ^= 1;
    put(3, damaged);
    hydronic_observation_flash_service(flash_read_hydronic_observation);
    const auto partial = hydronic_observation_report();
    require(partial.totals.samples == 2 && partial.observed_hours == 1 && partial.partial &&
                !partial.restore_pending,
            "invalid_indexed_content_omits_only_the_damaged_hour");

    const unsigned reads = journal_sdk::reads;
    hydronic_observation_flash_service(flash_read_hydronic_observation);
    require(journal_sdk::reads == reads, "damaged_hour_does_not_force_repeated_scans");

    const auto replacement = hydronic_record(hour() - 1, 4, 3);
    put(4, replacement);
    flash_index_hydronic_observation_record(replacement, 4);
    hydronic_observation_flash_service(flash_read_hydronic_observation);
    const auto restored = hydronic_observation_report();
    require(restored.totals.samples == 5 && restored.observed_hours == 2 &&
                !restored.restore_pending && !journal_sdk::writes && !journal_sdk::erases,
            "valid_retry_restores_both_hours_without_duplicates_or_writes");
}
void corrupt_scan(const std::string& name) {
    put(2, hydronic_record(hour() - 1, 1));
    auto damaged = hydronic_record(hour() - 1, 2, 2);
    if (name == "corrupt_crc")
        damaged.payload[20] ^= 1;
    else if (name == "corrupt_source")
        damaged.header.source = 0xf1;
    else if (name == "corrupt_version")
        ++damaged.header.version;
    else if (name == "corrupt_width")
        --damaged.header.value_count;
    else if (name == "corrupt_payload") {
        damaged.payload[123] = 1;
        crc(damaged);
    } else if (name == "corrupt_minimum_metadata_crc") {
        damaged.header.pad[9] ^= 0x10;
        HydronicHourlyPayload valid_body;
        require(
            hydronic_decode(damaged.payload, HYDRONIC_PAYLOAD_BYTES, damaged.header, valid_body) &&
                !matches_legacy_hydronic_envelope(damaged),
            "metadata_change_is_valid_by_shape_but_fails_original_crc");
    } else if (name == "corrupt_minimum_metadata_span" || name == "corrupt_minimum_metadata_bits") {
        damaged.header.pad[9] = name == "corrupt_minimum_metadata_span" ? 1 : 0x80;
        crc(damaged);
        require(matches_legacy_hydronic_envelope(damaged),
                "legacy_envelope_accepts_inner_metadata_bytes_after_crc_refresh");
    } else if (name == "torn_commit")
        damaged.header.commit = HISTORY_JOURNAL_ERASED;
    else
        throw std::runtime_error("unknown_case");
    put(3, damaged);
    boot();
    const auto r = hydronic_observation_report();
    if (name == "torn_commit")
        require(r.totals.samples == 1 && !r.restore_pending,
                "uncommitted_envelope_does_not_withdraw_committed_population");
    else
        require(r.totals.samples == 0 && r.partial,
                "recognizable_damaged_envelope_withholds_restored_population");
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "corrupt_scan_does_not_repair_or_erase");
}
void append_case(const std::string& name) {
    boot();
    tick(1, 11);
    hydronic_observation_seal();
    FlashJournalRecord r;
    require(flash_build_next_hydronic_observation(r), "real_history_builder_has_sealed_delta");
    require(r.header.catalog_fp == hydronic_fingerprint() &&
                r.header.commit == HISTORY_JOURNAL_ERASED && r.header.value_count == HYDRONIC_WORDS,
            "builder_uses_independent_exact_wire_shape");
    const auto seq  = s_flash_next_sequence;
    const auto core = s_flash_last_bucket[static_cast<size_t>(HistoryJournalSource::Checkup)];
    if (name == "commit_rejected" || name == "commit_error_after_accept") {
        journal_sdk::fail_write       = journal_sdk::writes + 2;
        journal_sdk::accept_then_fail = name == "commit_error_after_accept";
    } else if (name == "readback_failure") {
        // Slot preparation first reads its erase sector; the next read is commit verification.
        journal_sdk::fail_read = journal_sdk::reads + 2;
    } else if (name != "append_commit")
        throw std::runtime_error("unknown_case");
    const size_t slot     = s_flash_next_slot;
    const auto   result   = flash_append_record(r);
    const bool   accepted = name == "append_commit" || name == "commit_error_after_accept";
    require((result == ESP_OK) == accepted, "readback_decides_commit_success");
    require(s_flash_next_sequence == seq + 1, "every_append_attempt_reserves_unique_sequence");
    require(journal_sdk::core_appended == 0 &&
                s_flash_last_bucket[static_cast<size_t>(HistoryJournalSource::Checkup)] == core,
            "hydronic_ack_never_advances_core_cursor");
    const auto stored = get(slot);
    require((stored.header.commit == HISTORY_JOURNAL_COMMITTED) == (name != "commit_rejected"),
            "adapter_keeps_accepted_commit_despite_transport_error");
    if (accepted) {
        hydronic_observation_flash_service(flash_read_hydronic_observation);
        require(!hydronic_observation_report().persistence_pending,
                "exact_verified_ack_retires_claim");
    } else {
        require(hydronic_observation_report().persistence_pending,
                "failed_or_unverified_append_keeps_claim_pending");
        require(history_flash_service_journal(1, 0) == 1,
                "failed_append_releases_claim_for_real_service_retry");
        const auto retried = hydronic_observation_report();
        require(retried.totals.samples == 1 && !retried.persistence_pending &&
                    s_flash_next_sequence == seq + 2,
                "retry_commits_exactly_one_population_and_ack");
    }
}
void shutdown_drain() {
    boot();
    tick(1, 11);
    hydronic_observation_seal();
    stop_observation_record(1000000, true);
    stop_observation_record(11000000, true);
    stop_observation_seal();
    history_flash_save();
    require(s_flash_next_sequence == 3 && journal_sdk::writes == 4,
            "shutdown_round_robin_drains_both_independent_sources");
    const auto a = get(0), b = get(1);
    require((observation_header_matches(a.header) && hydronic_header_matches(b.header)) ||
                (hydronic_header_matches(a.header) && observation_header_matches(b.header)),
            "shutdown_commits_both_distinct_formats");
    require(!hydronic_observation_report().persistence_pending &&
                !stop_observation_report().persistence_pending,
            "shutdown_verified_receipts_complete_both_claims");
    history_flash_save();
    require(journal_sdk::writes == 4, "shutdown_drain_is_once_only");
}
void stop_append_failure(bool fence) {
    boot();
    if (fence) {
        stop_observation_set_diagnostics(true, 12);
        stop_observation_bind(101, 202, 404, 7, false);
    } else {
        StopContextEvent event;
        event.valid             = true;
        event.stop_us           = 1000000;
        event.source_generation = 7;
        event.positive = event.evaluable = event.complete = STOP_CONTEXT_ALL;
        sdk::now_us                                       = 1000000;
        stop_observation_record(sdk::now_us, true, event);
        sdk::now_us = 11000000;
        stop_observation_record(sdk::now_us, true);
        stop_observation_seal();
    }
    FlashJournalRecord r;
    require(flash_build_next_stop_observation(r), "stop_builder_has_actual_data_or_fence_claim");
    require(observation_append_owned(r.header) && !observation_header_matches(r.header) &&
                !hydronic_append_owned(r.header),
            "stop_erased_request_is_owned_without_becoming_read_evidence");
    const auto sequence     = r.header.sequence;
    journal_sdk::fail_write = journal_sdk::writes + 2;
    require(flash_append_record(r) != ESP_OK && s_flash_next_sequence == sequence + 1,
            "stop_failed_commit_reserves_its_attempt_before_transport");
    require(stop_observation_report().persistence_pending,
            "failed_stop_data_or_fence_remains_pending");
    history_record_board(); // actual public poll path restores and retries through shared service
    require(!stop_observation_report().persistence_pending && s_flash_next_sequence == sequence + 2,
            "stop_failed_append_releases_for_shared_retry");
    const auto committed = get(s_flash_next_slot - 1);
    require(observation_header_matches(committed.header) &&
                ((committed.payload[offsetof(ObservationHourlyPayload, flags)] &
                  OBSERVATION_BARRIER) != 0) == fence,
            "stop_retry_commits_the_expected_data_or_fence_format");
    require(journal_sdk::core_appended == 0 && hydronic_observation_report().totals.samples == 0,
            "stop_retry_does_not_ack_core_or_invent_hydronic_population");
    if (!fence)
        require(stop_observation_report().counters.witnessed_stops_recent_heating == 1 &&
                    stop_observation_report().readable_us == 10000000,
                "stop_retry_counts_actual_population_once");
}
void core_ahead_independence() {
    boot();
    tick(1, 11);
    hydronic_observation_seal();
    stop_observation_record(1000000, true);
    stop_observation_record(11000000, true);
    stop_observation_seal();
    const auto core           = static_cast<size_t>(HistoryJournalSource::Checkup);
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = hour() + 10;
    FlashJournalRecord r;
    require(flash_build_for_service(core, r, 0), "real_core_builder_produces_future_cursor");
    require(flash_append_record(r) == ESP_OK, "real_core_append_sets_future_cursor");
    require(!flash_build_for_service(core, r, 0) && s_flash_ahead_logged[core],
            "actual_future_cursor_helper_opens_core_ahead_episode");
    require(flash_build_next_stop_observation(r) && flash_append_record(r) == ESP_OK,
            "real_stop_append_succeeds_during_core_ahead_episode");
    require(s_flash_ahead_logged[core], "stop_success_preserves_core_ahead_episode");
    require(flash_build_next_hydronic_observation(r) && flash_append_record(r) == ESP_OK,
            "real_hydronic_append_succeeds_during_core_ahead_episode");
    require(s_flash_ahead_logged[core], "hydronic_success_preserves_core_ahead_episode");
    require(s_flash_last_bucket[core] == journal_sdk::core_bucket &&
                journal_sdk::core_appended == 1,
            "independent_observation_successes_never_advance_core_cursor_or_ack");
    require(!flash_build_for_service(core, r, 0) && s_flash_ahead_logged[core],
            "future_core_cursor_remains_blocked_after_both_observation_successes");
}
void request_rejections() {
    boot();
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = hour() - 1;
    FlashJournalRecord r;
    const auto         core = static_cast<size_t>(HistoryJournalSource::Checkup);
    require(flash_build_for_service(core, r, 0),
            "real_core_builder_has_request_for_admission_test");
    const auto requested = r.header.sequence;
    for (auto wrong : {uint64_t{0}, requested + 1}) {
        r.header.sequence = wrong;
        const auto reads = journal_sdk::reads, writes = journal_sdk::writes,
                   erases = journal_sdk::erases;
        require(flash_append_record(r) == ESP_ERR_INVALID_ARG && journal_sdk::reads == reads &&
                    journal_sdk::writes == writes && journal_sdk::erases == erases &&
                    s_flash_next_sequence == requested,
                "zero_or_stale_request_rejected_before_transport");
    }
    r.header.sequence = requested;
    require(flash_append_record(r) == ESP_OK && journal_sdk::core_appended == 1,
            "exact_current_request_can_commit_after_rejections");
    const auto reads = journal_sdk::reads, writes = journal_sdk::writes,
               erases = journal_sdk::erases;
    require(flash_append_record(r) == ESP_ERR_INVALID_ARG && journal_sdk::reads == reads &&
                journal_sdk::writes == writes && journal_sdk::erases == erases &&
                journal_sdk::core_appended == 1,
            "consumed_request_has_no_transport_or_duplicate_ack");
}
void fresh_restore(const std::string& name) {
    if (name == "restore_late_delta") {
        sdk::now_us = 3606000000LL;
        boot();
        const auto r = hydronic_observation_report();
        std::cout << "WITNESS fresh_restored_samples=" << r.totals.samples
                  << " acknowledged_samples=2 qualified_us=" << r.totals.qualified_us << '\n';
        require(r.totals.samples == 2, "fresh_restore_retains_acknowledged_hydronic_late_delta");
        require(r.totals.qualified_us == 8000000 && !r.persistence_pending && !r.restore_pending &&
                    journal_sdk::writes == 0 && journal_sdk::erases == 0,
                "fresh_restore_preserves_exact_hydronic_duration_without_transport_mutation");
        return;
    }
    journal_sdk::unix_origin += 60; // new boot date follows the old transport's last endpoint
    boot();
    const auto r           = hydronic_observation_report();
    const bool expect_data = name == "restore_data" || name == "restore_uncommitted_reset";
    require(r.totals.samples == (expect_data ? 2u : 0u) && !r.restore_pending,
            "fresh_process_restores_only_compatible_committed_evidence");
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "fresh_restore_does_not_mutate_transport");
}
void wrap_slot() {
    put(1, hydronic_record(hour() - 2, 1, 3));
    const auto recent = hydronic_record(hour() - 1, 8, 7);
    put(HISTORY_JOURNAL_SLOT_COUNT - 1, recent);
    boot();
    require(s_flash_next_slot == 0 && s_flash_next_sequence == 9,
            "physical_head_wraps_after_last_slot");
    tick(1, 11);
    hydronic_observation_seal();
    require(history_flash_service_journal(1, 0) == 1 && journal_sdk::erases == 1,
            "wrapped_append_erases_only_its_landing_sector");
    require(journal_sdk::erased_ranges.size() == 1 &&
                journal_sdk::erased_ranges[0] ==
                    std::make_pair(size_t{0}, size_t{HISTORY_FLASH_ERASE_BYTES}),
            "wrap_erases_exact_landing_sector_range");
    const auto retained = get(HISTORY_JOURNAL_SLOT_COUNT - 1);
    require(std::memcmp(&recent, &retained, sizeof(recent)) == 0,
            "wrap_preserves_recent_record_in_other_sector");
    require(s_flash_next_sequence == 10 && get(0).header.sequence == 9,
            "wrapped_append_keeps_unique_monotone_sequence");
    const auto r = hydronic_observation_report();
    require(r.totals.samples == 8 && r.observed_hours == 2 && r.partial,
            "reused_sector_cannot_resurrect_erased_index_entry");
}
void seed(const std::string& name) {
    boot();
    if (name == "seed_late_delta") {
        const auto core           = static_cast<size_t>(HistoryJournalSource::Checkup);
        journal_sdk::core_pending = true;
        journal_sdk::core_bucket  = hour() - 1;
        FlashJournalRecord r;
        require(flash_build_for_service(core, r, 0) && flash_append_record(r) == ESP_OK &&
                    s_flash_next_slot == 1,
                "real_core_append_places_hydronic_request_at_mid_sector_slot");
        const auto prior_core = get(0);
        tick(3590, 3595);
        // Reader expiry closes the old hour before a delayed, still-current sweep completes.
        sdk::now_us = 3605000000LL;
        require(hydronic_observation_report().persistence_pending,
                "public_reader_closes_old_hydronic_hour_without_sealing_producer");
        require(flash_build_next_hydronic_observation(r),
                "real_builder_claims_closed_hydronic_hour");
        journal_sdk::fail_read = journal_sdk::reads + 2;
        require(flash_append_record(r) != ESP_OK, "mid_slot_hydronic_commit_outcome_is_unverified");
        journal_sdk::fail_read         = 0;
        const auto            original = get(1);
        HydronicHourlyPayload old_payload;
        require(flash_record_physically_valid(original) &&
                    hydronic_decode(original.payload, HYDRONIC_PAYLOAD_BYTES, original.header,
                                    old_payload) &&
                    old_payload.samples == 1,
                "unverified_hydronic_commit_contains_original_population");
        sdk::now_us = 3606000000LL;
        HydronicDelta late;
        late.from_us     = 3595000000LL;
        late.to_us       = 3598000000LL;
        late.observed_us = late.candidate_us = late.qualified_us = 3000000;
        late.accepted                                            = true;
        late.spread_milli                                        = 6000;
        late.flow_milli                                          = 10000;
        hydronic_observation_record(late);
        require(hydronic_observation_report().totals.samples == 2,
                "ordinary_delayed_delta_corrects_same_old_hour");
        require(history_flash_service_journal(1, 0) == 1,
                "real_service_acknowledges_corrected_hydronic_revision");
        const auto report = hydronic_observation_report();
        require(report.totals.samples == 2 && report.totals.qualified_us == 8000000 &&
                    !report.persistence_pending,
                "same_boot_acknowledged_hydronic_population_includes_late_delta");
        const auto            retry = get(HISTORY_JOURNAL_SLOTS_PER_SECTOR);
        HydronicHourlyPayload new_payload;
        require(
            flash_record_physically_valid(retry) &&
                hydronic_decode(retry.payload, HYDRONIC_PAYLOAD_BYTES, retry.header, new_payload) &&
                new_payload.samples == 2 && retry.header.bucket == original.header.bucket &&
                journal_sdk::erased_ranges.empty(),
            "both_hydronic_revisions_and_prior_core_bytes_survive_retry");
        const auto core_record_after = get(0);
        require(std::memcmp(&prior_core, &core_record_after, sizeof(prior_core)) == 0,
                "mid_sector_retry_preserves_prior_core_record");
        std::cout << "WITNESS original_slot=1 original_sequence=" << original.header.sequence
                  << " original_samples=" << old_payload.samples
                  << " retry_slot=" << HISTORY_JOURNAL_SLOTS_PER_SECTOR
                  << " retry_sequence=" << retry.header.sequence
                  << " retry_samples=" << new_payload.samples
                  << " acknowledged_samples=" << report.totals.samples << '\n';
        return;
    }
    tick(1, 11);
    tick(11, 21);
    hydronic_observation_seal();
    const uint16_t data_slot = s_flash_next_slot;
    require(history_flash_service_journal(12, 0) == 1, "seed_uses_real_shared_journal_append");
    const auto data = get(data_slot);
    require(matches_legacy_hydronic_envelope(data) && data.header.pad[8] == 1 &&
                data.header.pad[9] == 0 && data.payload[121] == 1 && data.header.pad[7] == 0xff &&
                data.header.pad[10] == 0xff,
            "new_data_uses_legacy_envelope_and_payload_with_crc_protected_minimum");
    if (name == "seed_reset" || name == "seed_uncommitted_reset") {
        hydronic_observation_reset();
        hydronic_observation_bind(101, 202, 303, 7);
        if (name == "seed_reset") {
            const uint16_t fence_slot = s_flash_next_slot;
            require(history_flash_service_journal(12, 0) == 1,
                    "reset_fence_reaches_real_committed_journal");
            const auto fence = get(fence_slot);
            require(matches_legacy_hydronic_envelope(fence) && fence.header.pad[8] == 0 &&
                        fence.header.pad[9] == 0 && fence.payload[121] == 2,
                    "new_reset_fence_uses_legacy_envelope_payload_and_crc");
        }
    } else if (name != "seed_data")
        throw std::runtime_error("unknown_case");
}
} // namespace
int main(int argc, char** argv) {
    const std::string name = argc > 1 ? argv[1] : "";
    try {
        journal_sdk::flash.assign(partition.size, 0xff);
        if (name.rfind("restore_", 0) == 0) {
            require(argc == 3, "restore_requires_transport_file");
            std::ifstream in(argv[2], std::ios::binary);
            require(static_cast<bool>(in.read(reinterpret_cast<char*>(journal_sdk::flash.data()),
                                              journal_sdk::flash.size())),
                    "transport_file_complete");
            fresh_restore(name);
        } else if (name == "mixed_scan")
            mixed_scan();
        else if (name == "retry_indexed_read")
            retry_indexed_read();
        else if (name.rfind("corrupt_", 0) == 0 || name == "torn_commit")
            corrupt_scan(name);
        else if (name == "append_commit" || name == "commit_rejected" ||
                 name == "commit_error_after_accept" || name == "readback_failure")
            append_case(name);
        else if (name == "shutdown_drain")
            shutdown_drain();
        else if (name == "stop_commit_rejected" || name == "stop_fence_commit_rejected")
            stop_append_failure(name == "stop_fence_commit_rejected");
        else if (name == "core_ahead_independence")
            core_ahead_independence();
        else if (name == "request_rejections")
            request_rejections();
        else if (name == "wrap_slot")
            wrap_slot();
        else if (name == "early_forget") {
            require(!history_flash_forget(), "unstarted_history_cannot_complete_physical_wipe");
            boot(false);
            tick(1, 11);
            hydronic_observation_seal();
            history_flash_save();
            const auto r = hydronic_observation_report();
            require(!r.confirmed && !r.restore_pending && !r.persistence_pending &&
                        r.totals.samples == 0,
                    "early_history_forget_suppresses_hydronic_start_and_report");
            require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
                    "early_forget_never_claims_an_erase_without_partition");
        } else if (name == "scan_read_failure") {
            put(1, hydronic_record(hour() - 1, 1));
            journal_sdk::fail_read = 2;
            hydronic_observation_start(true, 11);
            hydronic_observation_bind(101, 202, 303, 7);
            history_start();
            history_service_flash_restore();
            require(!s_flash_scan_ok && hydronic_observation_report().restore_pending &&
                        hydronic_observation_report().totals.samples == 0,
                    "partial_physical_scan_never_certifies_restored_population");
            require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
                    "failed_scan_does_not_repair_transport");
        } else if (name.rfind("seed_", 0) == 0) {
            require(argc == 3, "seed_requires_transport_file");
            seed(name);
            std::ofstream out(argv[2], std::ios::binary);
            out.write(reinterpret_cast<const char*>(journal_sdk::flash.data()),
                      journal_sdk::flash.size());
            require(static_cast<bool>(out), "transport_file_saved");
        } else if (name == "empty_boot") {
            boot();
            require(!hydronic_observation_report().restore_pending && journal_sdk::writes == 0,
                    "empty_journal_is_settled_without_writes");
            require(journal_sdk::stop_expiry == kRestoreTicks &&
                        journal_sdk::hydronic_expiry == kRestoreTicks,
                    "expiry_precedes_every_restore_service");
        } else
            throw std::runtime_error("unknown_case");
        require(sdk::takes == sdk::gives, "all_host_mutexes_released");
        std::cout << "PASS case=" << name << " assertions=" << assertions << '\n';
        return 0;
    } catch (const std::exception& e) {
        std::cout << "FAIL oracle=" << e.what() << " case=" << name << '\n';
        return 1;
    }
}
