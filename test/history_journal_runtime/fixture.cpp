// Compile the complete production History TU; physical flash and external services are host ports.
#include "sdk.hpp"
#include "../history_modbus_target_stub.hpp"
#include <algorithm>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#ifndef HISTORY_PRODUCTION_SOURCE
#error "Bind complete production main/history.cpp"
#endif
namespace {
int reset_reason = esp_reset_reason();
int fixture_reset_reason() { return reset_reason; }
} // namespace
#define esp_reset_reason fixture_reset_reason
#include HISTORY_PRODUCTION_SOURCE
#undef esp_reset_reason

namespace daik {
logic::HistoryModbusTarget history_modbus_target(std::string_view host, int port,
                                                 int unit) noexcept {
    return fixture_port::history_modbus_target(host, port, unit);
}
} // namespace daik

namespace {
const esp_partition_t  partition{daik::logic::HISTORY_FLASH_PARTITION_OFFSET,
                                daik::logic::HISTORY_FLASH_PARTITION_BYTES};
const esp_partition_t* lookup_partition = &partition;
bool                   refuse_erases    = false;
size_t                 fail_restore_offset = SIZE_MAX;
unsigned               fail_restore_reads  = 0;
}
const esp_partition_t* esp_partition_find_first(int, int, const char* label) {
    if (auto hook = std::exchange(journal_sdk::during_find, nullptr)) hook();
    return std::strcmp(label, "history") == 0 ? lookup_partition : nullptr;
}
esp_err_t esp_partition_read(const esp_partition_t* part, size_t offset, void* out, size_t bytes) {
    ++journal_sdk::reads;
    if (auto hook = std::exchange(journal_sdk::during_read, nullptr)) hook();
    if (journal_sdk::fail_read == journal_sdk::reads) return ESP_FAIL;
    if (offset == fail_restore_offset && fail_restore_reads != 0) {
        --fail_restore_reads;
        return ESP_FAIL;
    }
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
    if (refuse_erases || journal_sdk::fail_erase == journal_sdk::erases) return ESP_FAIL;
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
bool checkup_flash_next(int64_t, int64_t, int64_t& bucket, logic::CheckupJournalPayload& payload) {
    if (!journal_sdk::core_pending) return false;
    bucket  = journal_sdk::core_bucket;
    payload = {202, 101, 0, 11, bucket * 3600};
    return true;
}
void checkup_flash_appended(int64_t) {
    ++journal_sdk::core_appended;
    journal_sdk::core_pending = false;
}
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t) {
    ++journal_sdk::core_restore;
    for (size_t i = 0; i < count; ++i)
        if (records[i].payload.model_fp != 202)
            throw std::runtime_error("core adapter received another logical source");
    return CheckupFlashRestoreResult::Restored;
}
} // namespace daik
namespace {
using namespace daik;
using namespace daik::logic;
unsigned assertions = 0;
void     require(bool ok, const char* oracle) {
    ++assertions;
    if (!ok) throw std::runtime_error(oracle);
}
void boot(bool clear_flash = true) {
    if (clear_flash) journal_sdk::flash.assign(HISTORY_FLASH_PARTITION_BYTES, 0xff);
    stop_observation_start(true, 11);
    history_start();
    stop_observation_bind(101, 202, 404, 7);
    require(s_flash_scan_ok, "complete_history_scan");
    for (unsigned i = 0; i < 20; ++i) history_service_flash_restore();
    require(s_flash_restore_done, "complete_trend_restore");
    require(s_flash_checkup_restore_done, "complete_core_restore");
    stop_observation_flash_service(flash_read_stop_observation);
    require(!stop_observation_report().restore_pending, "real_store_initial_restore_complete");
}
void population() {
    sdk::now_us = 1000000;
    stop_observation_record(sdk::now_us, true);
    sdk::now_us = 11000000;
    StopContextEvent event;
    event.valid             = true;
    event.stop_us           = sdk::now_us;
    event.source_generation = 7;
    event.positive = event.evaluable = event.complete = STOP_CONTEXT_ALL;
    stop_observation_record(sdk::now_us, true, event);
    stop_observation_seal();
    const auto report = stop_observation_report();
    require(report.readable_us == 10000000 && report.counters.witnessed_stops_recent_heating == 1 &&
                report.persistence_pending,
            "regular_store_calls_create_one_pending_population");
}
void append_case(bool barrier, const std::string& phase) {
    boot();
    population();
    if (barrier) {
        // The public consent transition withdraws the old population and queues a real fence.
        stop_observation_set_diagnostics(true, 12);
        stop_observation_bind(101, 202, 404, 7);
    }
    FlashJournalRecord record;
    require(flash_build_next_stop_observation(record),
            "real_history_builder_claims_pending_record");
    require(record.header.commit == HISTORY_JOURNAL_ERASED &&
                record.header.catalog_fp == observation_fingerprint(),
            "builder_uses_erased_precommit_observation_envelope");
    require(!observation_header_matches(record.header), "strict_read_matcher_rejects_erased");
    require(!flash_record_physically_valid(record), "physical_reader_rejects_erased_request");
    ObservationHourlyPayload payload;
    std::memcpy(&payload, record.payload, sizeof(payload));
    require(((payload.flags & OBSERVATION_BARRIER) != 0) == barrier &&
                payload.identity.consent_generation == (barrier ? 12u : 11u),
            "public_lifecycle_selects_data_or_barrier_kind");
    const auto sequence = s_flash_next_sequence;
    const auto slot     = s_flash_next_slot;
    if (phase == "prepare_read")
        journal_sdk::fail_read = journal_sdk::reads + 1;
    else if (phase == "prepare_erase") {
        const uint8_t dirty = 0;
        require(esp_partition_write(&partition, history_journal_slot_offset(slot), &dirty, 1) ==
                    ESP_OK,
                "transport_marks_landing_sector_used");
        journal_sdk::fail_erase = journal_sdk::erases + 1;
    } else if (phase == "body")
        journal_sdk::fail_write = journal_sdk::writes + 1;
    else if (phase == "commit" || phase == "commit_accepted_error") {
        journal_sdk::fail_write       = journal_sdk::writes + 2;
        journal_sdk::accept_then_fail = phase == "commit_accepted_error";
    } else if (phase == "readback")
        journal_sdk::fail_read = journal_sdk::reads + 2;
    else
        require(phase == "success", "known_append_phase");
    const bool accepted = phase == "success" || phase == "commit_accepted_error";
    const auto result   = flash_append_record(record);
    require((result == ESP_OK) == accepted, "verified_readback_is_commit_authority");
    require(s_flash_next_sequence == sequence + 1, "every_append_attempt_consumes_one_sequence");
    FlashJournalRecord physical;
    require(flash_read_record(slot, physical) == ESP_OK,
            "independent_transport_read_after_attempt");
    require((physical.header.commit == HISTORY_JOURNAL_COMMITTED) ==
                (accepted || phase == "readback"),
            "transport_distinguishes_rejected_from_unverified_commit");
    if (accepted) {
        stop_observation_flash_service(flash_read_stop_observation);
        require(!stop_observation_report().persistence_pending,
                "verified_success_retires_exact_data_or_barrier_claim");
    } else {
        require(stop_observation_report().persistence_pending,
                "failed_or_unverified_claim_remains_pending");
    }
    journal_sdk::fail_write       = 0;
    journal_sdk::fail_read        = 0;
    journal_sdk::fail_erase       = 0;
    journal_sdk::accept_then_fail = false;
    const size_t retried          = accepted ? 0 : history_flash_service_journal(1, 0);
    const auto   report           = stop_observation_report();
    std::cout << "WITNESS retry_written=" << retried << " sequence_before=" << sequence
              << " sequence_after=" << s_flash_next_sequence
              << " pending=" << report.persistence_pending << " readable_us=" << report.readable_us
              << " stops=" << report.counters.witnessed_stops_recent_heating << '\n';
    require(retried == (accepted ? 0u : 1u), "failed_append_releases_claim_for_real_service_retry");
    require(s_flash_next_sequence == sequence + (accepted ? 1 : 2) && !report.persistence_pending &&
                report.readable_us == (barrier ? 0u : 10000000u) &&
                report.counters.witnessed_stops_recent_heating == (barrier ? 0u : 1u),
            "retry_commits_exactly_one_population_or_barrier_ack");
    require(history_flash_service_journal(1, 0) == 0, "completed_retry_is_not_appended_twice");
    size_t committed = 0;
    for (size_t i = 0; i < HISTORY_JOURNAL_SLOT_COUNT; ++i) {
        require(flash_read_record(i, physical) == ESP_OK, "final_physical_scan_reads_slot");
        if (flash_record_physically_valid(physical)) ++committed;
    }
    require(committed == 1, "one_physically_committed_record_after_retry");
    const size_t expected_erases =
        phase == "prepare_erase" ? 2 : (phase == "commit" || phase == "readback" ? 1 : 0);
    require(journal_sdk::erased_ranges.size() == expected_erases,
            "only_torn_or_used_landing_sector_is_erased");
    for (const auto& range : journal_sdk::erased_ranges)
        require(range.first == history_journal_slot_offset(slot) &&
                    range.second == HISTORY_FLASH_ERASE_BYTES,
                "erase_is_exact_landing_sector_range");
    if (phase == "readback")
        std::cout << "LIMIT initial_outcome=unverified physical_commit=present "
                     "retry_uses_reserved_new_sequence=1\n";
}
void core_sequence(const std::string& phase) {
    boot();
    const auto core           = static_cast<size_t>(HistoryJournalSource::Checkup);
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600 - 1;
    FlashJournalRecord record;
    require(flash_build_for_service(core, record, 0), "real_core_builder_creates_sequence_request");
    const auto sequence = record.header.sequence;
    if (phase == "prepare")
        journal_sdk::fail_read = journal_sdk::reads + 1;
    else if (phase == "readback")
        journal_sdk::fail_read = journal_sdk::reads + 2;
    else if (phase == "commit_error") {
        journal_sdk::fail_write       = journal_sdk::writes + 2;
        journal_sdk::accept_then_fail = true;
    } else
        throw std::runtime_error("unknown_case");
    const bool accepted = phase == "commit_error";
    require((flash_append_record(record) == ESP_OK) == accepted,
            "core_readback_alone_decides_acknowledgment");
    require(s_flash_next_sequence == sequence + 1, "every_append_attempt_consumes_one_sequence");
    require(journal_sdk::core_pending == !accepted &&
                journal_sdk::core_appended == (accepted ? 1u : 0u),
            "failed_or_unverified_core_attempt_does_not_acknowledge");
    journal_sdk::fail_read = journal_sdk::fail_write = 0;
    journal_sdk::accept_then_fail                    = false;
    require(history_flash_service_journal(1, 0) == (accepted ? 0u : 1u),
            "real_service_retries_pending_core_with_new_sequence");
    require(s_flash_next_sequence == sequence + (accepted ? 1 : 2) && !journal_sdk::core_pending &&
                journal_sdk::core_appended == 1,
            "core_retry_reserves_distinct_sequence_and_acknowledges_once");
    require(history_flash_service_journal(1, 0) == 0 && journal_sdk::core_appended == 1,
            "core_retry_never_acknowledges_twice");
}
void sequence_rejections() {
    boot();
    const auto core           = static_cast<size_t>(HistoryJournalSource::Checkup);
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600 - 1;
    FlashJournalRecord record;
    require(flash_build_for_service(core, record, 0),
            "real_core_builder_creates_rejection_control");
    const auto original = record;
    for (const uint64_t invalid : {uint64_t{0}, original.header.sequence + 1}) {
        record.header.sequence = invalid;
        const auto reads = journal_sdk::reads, writes = journal_sdk::writes,
                   erases = journal_sdk::erases;
        require(flash_append_record(record) == ESP_ERR_INVALID_ARG &&
                    s_flash_next_sequence == original.header.sequence,
                "zero_or_out_of_order_request_is_refused_without_consuming_sequence");
        require(journal_sdk::reads == reads && journal_sdk::writes == writes &&
                    journal_sdk::erases == erases,
                "sequence_rejection_precedes_all_flash_io");
    }
    record = original;
    require(flash_append_record(record) == ESP_OK && journal_sdk::core_appended == 1,
            "exact_current_request_can_still_commit_after_rejections");
    const auto reads = journal_sdk::reads, writes = journal_sdk::writes,
               erases = journal_sdk::erases;
    require(flash_append_record(record) == ESP_ERR_INVALID_ARG &&
                s_flash_next_sequence == original.header.sequence + 1,
            "already_consumed_request_is_rejected_as_stale");
    require(journal_sdk::reads == reads && journal_sdk::writes == writes &&
                journal_sdk::erases == erases && journal_sdk::core_appended == 1,
            "stale_request_has_no_flash_io_or_duplicate_ack");
}
void core_ahead() {
    boot();
    population();
    const auto core           = static_cast<size_t>(HistoryJournalSource::Checkup);
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600 + 10;
    FlashJournalRecord record;
    require(flash_build_for_service(core, record, 0), "real_core_builder_produces_future_cursor");
    require(flash_append_record(record) == ESP_OK, "real_core_append_sets_future_cursor");
    require(!flash_build_for_service(core, record, 0) && s_flash_ahead_logged[core],
            "actual_future_cursor_helper_opens_core_ahead_episode");
    require(flash_build_next_stop_observation(record) && flash_append_record(record) == ESP_OK,
            "real_stop_append_succeeds_during_core_ahead_episode");
    require(s_flash_ahead_logged[core], "stop_success_preserves_core_ahead_episode");
    require(s_flash_last_bucket[core] == journal_sdk::core_bucket &&
                journal_sdk::core_appended == 1,
            "stop_success_never_advances_core_cursor_or_ack");
    require(!flash_build_for_service(core, record, 0) && s_flash_ahead_logged[core],
            "future_cursor_remains_blocked_after_stop_success");
}
void nor_contract() {
    boot();
    const uint8_t zero = 0, erased = 0xff;
    require(esp_partition_write(&partition, 7, &zero, 1) == ESP_OK, "nor_accepts_one_to_zero");
    bool refused = false;
    try {
        (void)esp_partition_write(&partition, 7, &erased, 1);
    } catch (const std::runtime_error&) {
        refused = true;
    }
    require(refused, "nor_refuses_zero_to_one_without_erase");
    require(esp_partition_erase_range(&partition, 1, HISTORY_FLASH_ERASE_BYTES) ==
                ESP_ERR_INVALID_ARG,
            "nor_refuses_unaligned_erase");
    require(esp_partition_erase_range(&partition, 0, HISTORY_FLASH_ERASE_BYTES) == ESP_OK &&
                journal_sdk::flash[7] == 0xff,
            "nor_erases_exact_aligned_sector");
}

enum class ForgetPoint {
    BeforeStart,
    DuringLookup,
    DuringScan,
    MissingPartition,
    WrongAddress,
    WrongSize,
    MissingHistoryMutex,
    MissingFlashMutex,
    Ready,
    AfterIncompleteScan,
};

bool forget_called = false;
bool forget_result = false;
void observe_forget() {
    const uint32_t epoch = history_epoch();
    forget_result        = history_flash_forget();
    forget_called        = true;
    require(s_flash_forgotten.load() && stop_observation_suppressed(),
            "forget_immediately_suppresses_both_owners");
    require(history_epoch() != epoch, "forget_invalidates_history_reader_lease");
}

void forget_case(ForgetPoint point) {
    journal_sdk::flash.assign(HISTORY_FLASH_PARTITION_BYTES, 0xff);
    journal_sdk::flash.front()                            = 0x25;
    journal_sdk::flash[HISTORY_FLASH_PARTITION_BYTES / 2] = 0x4a;
    journal_sdk::flash.back()                             = 0x12;
    const auto      before                                = journal_sdk::flash;
    esp_partition_t incompatible                          = partition;
    switch (point) {
    case ForgetPoint::DuringLookup:
        journal_sdk::during_find = observe_forget;
        break;
    case ForgetPoint::DuringScan:
        journal_sdk::during_read = observe_forget;
        break;
    case ForgetPoint::MissingPartition:
        lookup_partition = nullptr;
        break;
    case ForgetPoint::WrongAddress:
        incompatible.address += HISTORY_FLASH_ERASE_BYTES;
        lookup_partition = &incompatible;
        break;
    case ForgetPoint::WrongSize:
        incompatible.size -= HISTORY_FLASH_ERASE_BYTES;
        lookup_partition = &incompatible;
        break;
    case ForgetPoint::MissingHistoryMutex:
        sdk::fail_mutex_create = 1;
        break;
    case ForgetPoint::MissingFlashMutex:
        sdk::fail_mutex_create = 2;
        break;
    case ForgetPoint::AfterIncompleteScan:
        journal_sdk::fail_read = 1;
        break;
    default:
        break;
    }
    if (point != ForgetPoint::BeforeStart) {
        // Match firmware startup order. The lookup/read ports can interleave one Forget before
        // History startup returns, without seeding production handles or the privacy latches.
        history_start();
        stop_observation_start(true, 11);
    }
    if (point == ForgetPoint::AfterIncompleteScan)
        require(journal_sdk::reads == 1 && !s_flash_scan_ok,
                "incomplete_scan_reaches_read_failure");
    const bool injected = point == ForgetPoint::DuringLookup || point == ForgetPoint::DuringScan;
    if (!injected) observe_forget();
    require(forget_called, "forget_interleaving_reached_real_entry");

    const bool ready = point == ForgetPoint::Ready || point == ForgetPoint::AfterIncompleteScan;
    if (!ready) {
        require(!forget_result, "unready_forget_refuses");
        require(journal_sdk::erases == 0 && journal_sdk::writes == 0 &&
                    journal_sdk::flash == before,
                "unready_forget_preserves_nor");
        if (!injected) return;
        // After the scan completes, the same boot can retry the physical part while suppressed.
        observe_forget();
    }

    require(forget_result, "ready_forget_succeeds");
    require(journal_sdk::erased_ranges ==
                    std::vector<std::pair<size_t, size_t>>{{0, HISTORY_FLASH_PARTITION_BYTES}} &&
                journal_sdk::writes == 0 &&
                std::all_of(journal_sdk::flash.begin(), journal_sdk::flash.end(),
                            [](uint8_t value) { return value == 0xff; }),
            "successful_forget_erases_entire_journal");
}

void read_admission() {
    boot();
    population();
    FlashJournalRecord record;
    require(flash_build_next_stop_observation(record), "reader_case_uses_real_stop_builder");
    const size_t slot   = s_flash_next_slot;
    const size_t offset = history_journal_slot_offset(slot);
    require(esp_partition_write(&partition, offset, &record,
                                sizeof(record.header) + OBSERVATION_PAYLOAD_BYTES) == ESP_OK,
            "transport_programs_actual_erased_request_body");
    int64_t                  bucket   = INT64_MIN;
    uint64_t                 sequence = 0;
    ObservationHourlyPayload payload;
    require(
        observation_append_owned(record.header) &&
            !flash_read_stop_observation(static_cast<uint16_t>(slot), bucket, sequence, payload),
        "append_ownership_never_admits_uncommitted_flash_evidence");
    const uint32_t commit = HISTORY_JOURNAL_COMMITTED;
    require(esp_partition_write(&partition, offset + offsetof(HistoryJournalHeader, commit),
                                &commit, sizeof(commit)) == ESP_OK,
            "transport_commits_same_request_without_header_rewrite");
    require(flash_read_stop_observation(static_cast<uint16_t>(slot), bucket, sequence, payload) &&
                bucket == record.header.bucket && sequence == record.header.sequence &&
                payload.readable_us == 10000000 &&
                payload.counters.witnessed_stops_recent_heating == 1,
            "actual_reader_accepts_exact_committed_crc_checked_population");
    const uint8_t damaged = 100; // source_fp low byte: 101 -> 100 is a physical one-to-zero write.
    require(esp_partition_write(&partition,
                                offset + sizeof(record.header) +
                                    offsetof(ObservationHourlyPayload, identity),
                                &damaged, 1) == ESP_OK,
            "transport_corrupts_payload_with_legal_nor_program");
    require(!flash_read_stop_observation(static_cast<uint16_t>(slot), bucket, sequence, payload),
            "actual_reader_rejects_committed_payload_with_bad_crc");
}
void seed_late_correction(const char* transport_path) {
    boot();
    // Establish a non-sector-first append position through a real independent Core append.
    const auto core           = static_cast<size_t>(HistoryJournalSource::Checkup);
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600 - 1;
    FlashJournalRecord record;
    require(flash_build_for_service(core, record, 0) && flash_append_record(record) == ESP_OK,
            "real_core_append_places_stop_attempt_at_slot_one");
    require(s_flash_next_slot == 1, "stop_attempt_is_not_sector_first");

    sdk::now_us = 3590000000LL;
    stop_observation_record(sdk::now_us, true);
    sdk::now_us = 3595000000LL;
    stop_observation_record(sdk::now_us, true);
    sdk::now_us = 3605000000LL;
    stop_observation_record(sdk::now_us, false); // closes the old hour without sealing the producer
    require(flash_build_next_stop_observation(record),
            "ordinary_hour_closure_creates_pending_data");
    journal_sdk::fail_read = journal_sdk::reads + 2; // preparation succeeds; verification fails
    require(flash_append_record(record) != ESP_OK, "mid_slot_commit_outcome_is_unverified");
    journal_sdk::fail_read = 0;
    FlashJournalRecord original;
    require(flash_read_record(1, original) == ESP_OK && flash_record_physically_valid(original),
            "unverified_mid_slot_attempt_physically_committed");
    ObservationHourlyPayload original_payload;
    std::memcpy(&original_payload, original.payload, sizeof(original_payload));
    require(original_payload.readable_us == 5000000 &&
                original_payload.counters.witnessed_stops_recent_heating == 0,
            "first_physical_copy_precedes_late_correction");

    sdk::now_us = 3620000000LL;
    StopContextEvent event;
    event.valid             = true;
    event.stop_us           = 3598000000LL;
    event.source_generation = 7;
    event.positive = event.evaluable = event.complete = STOP_CONTEXT_ALL;
    stop_observation_record(sdk::now_us, false, event);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
            "ordinary_late_event_corrects_queued_old_hour");
    require(history_flash_service_journal(1, 0) == 1,
            "real_shared_retry_acknowledges_late_correction");
    const auto report = stop_observation_report();
    require(!report.persistence_pending && report.readable_us == 5000000 &&
                report.counters.witnessed_stops_recent_heating == 1,
            "same_boot_acknowledged_population_includes_late_correction");
    const size_t       retry_slot = HISTORY_JOURNAL_SLOTS_PER_SECTOR;
    FlashJournalRecord retry;
    require(flash_read_record(retry_slot, retry) == ESP_OK && flash_record_physically_valid(retry),
            "retry_lands_in_next_sector_preserving_unverified_copy");
    ObservationHourlyPayload retry_payload;
    std::memcpy(&retry_payload, retry.payload, sizeof(retry_payload));
    require(retry_payload.counters.witnessed_stops_recent_heating == 1 &&
                retry.header.bucket == original.header.bucket && journal_sdk::erased_ranges.empty(),
            "two_committed_revisions_survive_without_erasing_the_old_sector");
    std::cout << "WITNESS original_slot=1 original_sequence=" << original.header.sequence
              << " original_stops=" << original_payload.counters.witnessed_stops_recent_heating
              << " retry_slot=" << retry_slot << " retry_sequence=" << retry.header.sequence
              << " retry_stops=" << retry_payload.counters.witnessed_stops_recent_heating
              << " acknowledged_stops=" << report.counters.witnessed_stops_recent_heating << '\n';
    std::ofstream transport(transport_path, std::ios::binary);
    transport.write(reinterpret_cast<const char*>(journal_sdk::flash.data()),
                    static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport), "save_only_synthetic_nor_transport_bytes");
}
void load_synthetic_nor(const char* transport_path) {
    journal_sdk::flash.resize(HISTORY_FLASH_PARTITION_BYTES);
    std::ifstream transport(transport_path, std::ios::binary);
    transport.read(reinterpret_cast<char*>(journal_sdk::flash.data()),
                   static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport) && transport.peek() == std::char_traits<char>::eof(),
            "cold_process_loads_exact_synthetic_partition_bytes");
}

constexpr uint32_t peer_a            = 0xc0000232;
constexpr uint32_t peer_b            = 0xc0000233;
constexpr int64_t  history_bucket_us = HISTORY_DT_S * 1000000LL;
constexpr int64_t  delayed_boot_s    = 1700006400 + 12 * 3600 + 4 * 60 + 50;
constexpr auto     flow_index        = static_cast<size_t>(homehub_history_index("flow"));
constexpr auto     quiet_index       = static_cast<size_t>(homehub_history_index("quiet_state"));

logic::HistoryModbusTarget configure_homehub(const char* hostname = "synthetic-homehub.local",
                                             int         unit     = 1) {
    auto& cfg      = daik::detail::cfg;
    cfg.mb_host    = hostname;
    cfg.mb_port    = 502;
    cfg.mb_unit_id = unit;
    return history_modbus_target(cfg.mb_host, cfg.mb_port, cfg.mb_unit_id);
}
uint32_t bind_homehub(const logic::HistoryModbusTarget& configured, uint32_t ipv4) {
    history_modbus_candidate(ipv4);
    const auto generation = history_modbus_bind_peer(configured, ipv4, history_modbus_generation());
    require(generation != 0, "confirmed_peer_binds");
    return generation;
}
void record_flow(const char* value, uint32_t generation) {
    CachedValue row;
    row.off               = 49;
    row.value             = value;
    row.modbus_definition = def::homehub_definition_id(*def::homehub_find(49));
    history_record_modbus(&row, 1, generation);
    sdk::now_us += history_bucket_us;
    history_record_modbus(nullptr, 0, generation);
}
std::vector<HistorySample> flow_snapshot() {
    std::vector<HistorySample> samples(HISTORY_SAMPLES);
    samples.resize(history_modbus_snapshot(flow_index, samples.data(), samples.size()));
    return samples;
}
bool has_sample(const std::vector<HistorySample>& samples, HistorySample value) {
    return std::find(samples.begin(), samples.end(), value) != samples.end();
}
void require_no_quiet_ring_sample(const char* oracle) {
    HistorySample samples[HISTORY_SAMPLES];
    const size_t  n = P().mb_ring[quiet_index].snapshot(samples, HISTORY_SAMPLES);
    require(std::find(samples, samples + n, HistorySample{10}) == samples + n, oracle);
}
FlashJournalRecord written_flow(const logic::HistoryModbusTarget& configured, uint32_t ipv4,
                                HistorySample sample) {
    for (size_t slot = 0; slot < s_flash_next_slot; ++slot) {
        FlashJournalRecord r;
        require(flash_read_record(slot, r) == ESP_OK, "read_modbus_writer_record");
        if (!flash_record_physically_valid(r) ||
            r.header.source != static_cast<uint8_t>(HistoryJournalSource::Modbus) ||
            r.header.flags == HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST)
            continue;
        HistorySample stored;
        std::memcpy(&stored, r.payload + flow_index * sizeof(stored), sizeof(stored));
        if (stored != sample) continue;
        require(history_journal_modbus_config_matches(r.header, r.payload, sizeof(r.payload),
                                                      configured) &&
                    history_journal_scope(r.header) == ipv4,
                "writer_stamps_confirmed_peer_and_configured_target");
        require(r.header.value_count == HOMEHUB_HISTORY_COUNT + HISTORY_MODBUS_SCOPE_WORDS &&
                    !history_journal_trend_layout_matches(r.header, P().catalog_fp, TREND_COUNT,
                                                          HOMEHUB_HISTORY_COUNT,
                                                          ENV3_HISTORY_COUNT) &&
                    !history_legacy_disinfection_layout_matches(r.header) &&
                    !flash_manifest_find(r.header, 0) && r.header.pad[4] != 1,
                "old_readers_find_head_without_admitting_scoped_record");
        return r;
    }
    throw std::runtime_error("real_writer_commits_expected_flow");
}
void modbus_live_peer_change() {
    const auto configured_fp = configure_homehub();
    boot();
    const auto a_generation = bind_homehub(configured_fp, peer_a);
    record_flow("12.3", a_generation);
    require(has_sample(flow_snapshot(), 123), "first_peer_records_real_flow");
    require(history_flash_service_journal(8, 0) > 0, "first_peer_drains_real_journal");
    (void)written_flow(configured_fp, peer_a, 123);
    const auto first_bytes = journal_sdk::flash;
    const auto first_end   = history_journal_slot_offset(s_flash_next_slot);
    const auto first_epoch = history_epoch();
    require(bind_homehub(configured_fp, peer_a) == a_generation && history_epoch() == first_epoch &&
                has_sample(flow_snapshot(), 123),
            "same_ipv4_preserves_history_and_generation");

    const auto b_scope     = peer_b;
    sdk::measure_busy_lock = true;
    s_flash_mtx->owned     = true;
    history_modbus_candidate(peer_b);
    require(history_modbus_bind_peer(configured_fp, b_scope, a_generation) == 0 &&
                sdk::blocking_busy_takes == 0 && s_flash_mtx->owned,
            "peer_bind_does_not_wait_for_flash_owner");
    s_flash_mtx->owned = false;
    s_mtx->owned       = true;
    require(history_modbus_bind_peer(configured_fp, b_scope, a_generation) == 0 &&
                sdk::blocking_busy_takes == 0 && s_mtx->owned && !s_flash_mtx->owned,
            "peer_bind_does_not_wait_for_history_owner");
    s_mtx->owned           = false;
    sdk::measure_busy_lock = false;
    require(flow_snapshot().empty(), "candidate_hides_old_flow_while_journal_binding_is_busy");
    history_modbus_candidate(peer_a);
    require(history_modbus_bind_peer(configured_fp, 0, a_generation) == 0 &&
                history_modbus_generation() == a_generation && history_epoch() == first_epoch &&
                has_sample(flow_snapshot(), 123) && journal_sdk::flash == first_bytes,
            "unbound_peer_attempts_preserve_previous_history");

    const auto b_generation = bind_homehub(configured_fp, peer_b);
    require(b_generation != a_generation && history_epoch() != first_epoch &&
                !has_sample(flow_snapshot(), 123),
            "replacement_ipv4_retires_old_ram_and_browser_epoch");
    require(history_modbus_bind_peer(configured_fp, peer_a, a_generation) == 0,
            "stale_generation_cannot_bind_retired_peer");
    record_flow("87.6", a_generation);
    sdk::now_us += 24 * 60 * 60 * 1000000LL;
    history_record_modbus(nullptr, 0, b_generation);
    history_flash_service_journal(8, 0);
    require(s_flash_restore_slot_count[static_cast<size_t>(HistoryJournalSource::Modbus)] == 0 &&
                s_flash_last_bucket[static_cast<size_t>(HistoryJournalSource::Modbus)] == INT64_MIN,
            "replacement_gaps_alone_do_not_advance_modbus_cursor");
    const auto first_replacement_slot = s_flash_next_slot;
    record_flow("24.6", b_generation);
    const auto replacement = flow_snapshot();
    require(has_sample(replacement, 246) && !has_sample(replacement, 123) &&
                !has_sample(replacement, 876),
            "replacement_raster_contains_gaps_and_only_new_peer_samples");
    require(std::count(replacement.begin(), replacement.end(), HISTORY_NO_READING) > 0,
            "replacement_raster_preserves_explicit_predecessor_gaps");
    require(history_flash_service_journal(8, 0) > 0, "replacement_drains_real_journal");
    const auto first_replacement = written_flow(configured_fp, peer_b, 246);
    for (size_t slot = first_replacement_slot; slot < s_flash_next_slot; ++slot) {
        FlashJournalRecord record;
        require(flash_read_record(slot, record) == ESP_OK,
                "read_first_replacement_journal_records");
        if (record.header.source == static_cast<uint8_t>(HistoryJournalSource::Modbus) &&
            record.header.flags != HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST)
            require(record.header.sequence == first_replacement.header.sequence,
                    "replacement_journal_begins_with_first_measured_bucket");
    }
    require(journal_sdk::erases == 0 &&
                std::equal(first_bytes.begin(), first_bytes.begin() + first_end,
                           journal_sdk::flash.begin()),
            "peer_cutover_preserves_predecessor_flash_bytes");

    auto& cfg             = daik::detail::cfg;
    cfg.mb_host           = "different-configured-homehub.local";
    const auto new_config = history_modbus_target(cfg.mb_host, cfg.mb_port, cfg.mb_unit_id);
    history_modbus_reset(new_config);
    require(history_modbus_bind_peer(configured_fp, peer_b, history_modbus_generation()) == 0,
            "retired_config_cannot_bind_even_with_current_generation");
    require(flow_snapshot().empty(), "configuration_cutover_hides_previous_peer");
}
void modbus_peer_forget() {
    const auto configured_fp = configure_homehub();
    boot();
    const auto generation = bind_homehub(configured_fp, peer_a);
    const auto b_scope    = peer_b;
    const auto epoch      = history_epoch();
    sdk::before_take      = [] { s_flash_forgotten.store(true); };
    require(history_modbus_bind_peer(configured_fp, b_scope, generation) == 0 &&
                history_epoch() == epoch && history_modbus_generation() == generation,
            "peer_bind_rechecks_forget_after_locks");
    const auto takes = sdk::takes;
    require(history_modbus_bind_peer(configured_fp, b_scope, generation) == 0 &&
                sdk::takes == takes,
            "forgotten_peer_bind_skips_locks");
}
void modbus_quiet_unverified() {
    const auto configured_fp = configure_homehub();
    boot();
    const auto  generation = bind_homehub(configured_fp, peer_a);
    CachedValue quiet;
    quiet.off               = 9;
    quiet.value             = "1"; // A native Automatic word decoded through the EKRHH baseline.
    quiet.modbus_definition = def::homehub_definition_id(*def::homehub_find(9));
    history_record_modbus(&quiet, 1, generation);
    sdk::now_us += history_bucket_us;
    history_record_modbus(nullptr, 0, generation);
    require_no_quiet_ring_sample("baseline_quiet_does_not_enter_production_ring");
    HistorySample samples[HISTORY_SAMPLES];
    require(history_modbus_snapshot(quiet_index, samples, HISTORY_SAMPLES) == 0,
            "baseline_quiet_has_no_history_payload");
}
void modbus_missing_target_digest() {
    boot();
    const auto generation = history_modbus_generation();
    const auto epoch      = history_epoch();
    const auto takes      = sdk::takes;
    require(history_modbus_bind_peer({}, peer_a, generation) == 0 && sdk::takes == takes &&
                history_modbus_generation() == generation && history_epoch() == epoch &&
                flow_snapshot().empty(),
            "missing_target_digest_cannot_bind");
}
enum class ModbusTransport {
    Cold,
    Legacy,
    LegacyTagged,
    ColdCollision,
    Warm,
    WarmLegacy,
    WarmCombined,
    WarmCollision
};
constexpr const char* kLegacyModbusHost  = "old-4cc3.fixture.invalid";
constexpr const char* kAliasedModbusHost = "new-11d6d.fixture.invalid";
constexpr const char* kCollidingModbusA  = "hub-b7b9d420.local";
constexpr const char* kCollidingModbusB  = "hub-9d5d410c.local";
constexpr uint32_t    kCollidingIpv4     = 0xc0a80a0a;
constexpr uint32_t    kCollidingScope    = 0xc86c6f8a;

uint32_t configured_legacy_crc() {
    const auto& cfg = daik::detail::cfg;
    return history_homehub_target_fingerprint(cfg.mb_host.c_str(), cfg.mb_port, cfg.mb_unit_id);
}

bool modbus_transport_collision(ModbusTransport mode) {
    return mode == ModbusTransport::WarmCollision || mode == ModbusTransport::ColdCollision ||
           mode == ModbusTransport::LegacyTagged;
}

void seed_modbus_peer(const char* transport_path, ModbusTransport mode) {
    const bool     warm_legacy    = mode == ModbusTransport::WarmLegacy;
    const bool     warm_combined  = mode == ModbusTransport::WarmCombined;
    const bool     warm_collision = mode == ModbusTransport::WarmCollision;
    const bool     collision      = modbus_transport_collision(mode);
    const auto     configured_fp  = warm_legacy ? configure_homehub(kLegacyModbusHost)
                                    : collision ? configure_homehub(kCollidingModbusA)
                                                : configure_homehub();
    const uint32_t ipv4           = collision ? kCollidingIpv4 : peer_a;
    const uint32_t legacy_crc     = configured_legacy_crc();
    const uint32_t legacy_scope   = history_homehub_peer_fingerprint(legacy_crc, ipv4);
    boot();
    record_flow("12.3", bind_homehub(configured_fp, ipv4));
    require(has_sample(flow_snapshot(), 123), "seed_uses_completed_real_flow");
    std::ofstream transport(transport_path, std::ios::binary);
    if (mode == ModbusTransport::Warm || warm_legacy || warm_combined || warm_collision) {
        // Keep independent board history in the same shared region.
        history_record_board();
        sdk::now_us += history_bucket_us;
        history_record_board();
        if (warm_legacy || warm_combined) {
            P().version = warm_legacy ? HISTORY_PERSIST_VERSION : kCombinedModbusPeerPersistVersion;
            P().mb_target_fp            = warm_legacy ? legacy_crc : legacy_scope;
            s_liveness.modbus_config_fp = 0xa5a5a5a5; // formerly unchecked padding
            s_persist_dirty             = true;
            persist_seal_locked();
        }
        if (warm_collision) {
            // Restore sees the exact CRC bytes that would have named the predecessor in v6.
            P().mb_target_fp            = legacy_scope;
            s_liveness.modbus_config_fp = legacy_crc;
            s_persist_dirty             = true;
            persist_seal_locked();
        }
        history_liveness_touch();
        transport.write(reinterpret_cast<const char*>(&P()), sizeof(P()));
        transport.write(reinterpret_cast<const char*>(&s_liveness), sizeof(s_liveness));
    } else {
        require(history_flash_service_journal(8, 0) > 0, "seed_uses_real_flash_writer");
        (void)written_flow(configured_fp, ipv4, 123);
        // Introduce an old false Quiet activity column in the synthetic transport copy. Leave
        // every other payload word and the real writer's sequence and absolute bucket intact.
        auto image = journal_sdk::flash;
        for (size_t slot = 0; slot < s_flash_next_slot; ++slot) {
            FlashJournalRecord r;
            require(flash_read_record(slot, r) == ESP_OK, "read_seed_writer_slot");
            if (r.header.source != static_cast<uint8_t>(HistoryJournalSource::Modbus) ||
                r.header.flags == HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST)
                continue;
            const HistorySample old_quiet = 10;
            std::memcpy(r.payload + quiet_index * sizeof(old_quiet), &old_quiet, sizeof(old_quiet));
            const bool tagged     = mode == ModbusTransport::LegacyTagged;
            const bool old_format = mode == ModbusTransport::Legacy || tagged;
            if (old_format) {
                r.header.value_count = HOMEHUB_HISTORY_COUNT;
                r.header.rings[static_cast<size_t>(HistoryJournalSource::Modbus)] =
                    HOMEHUB_HISTORY_COUNT;
                r.header.reserved = 0xffff;
                std::fill(r.header.pad + 4, r.header.pad + sizeof(r.header.pad), 0xff);
                history_journal_set_scope(r.header, tagged ? legacy_scope : legacy_crc);
                if (tagged) {
                    r.header.pad[4] = 1;
                    for (size_t i = 0; i < 4; ++i)
                        r.header.pad[8 + i] = static_cast<uint8_t>(legacy_crc >> (8 * i));
                }
            }
            r.header.crc = history_journal_crc_bytes(r.header, r.payload,
                                                     history_journal_payload_bytes(r.header));
            require(flash_record_physically_valid(r) &&
                        history_journal_modbus_config_matches(
                            r.header, r.payload, sizeof(r.payload), configured_fp) == !old_format,
                    "synthetic_transport_keeps_valid_envelope_and_expected_peer_tag");
            std::memcpy(image.data() + history_journal_slot_offset(slot), &r, sizeof(r));
        }
        transport.write(reinterpret_cast<const char*>(image.data()),
                        static_cast<std::streamsize>(image.size()));
    }
    require(static_cast<bool>(transport), "save_exact_synthetic_modbus_transport");
}
void restore_modbus_peer(const char* transport_path, ModbusTransport mode, uint32_t ipv4,
                         bool corrupt_version = false, bool replacement = false) {
    const bool warm_legacy    = mode == ModbusTransport::WarmLegacy;
    const bool warm_combined  = mode == ModbusTransport::WarmCombined;
    const bool warm_collision = mode == ModbusTransport::WarmCollision;
    const bool warm =
        mode == ModbusTransport::Warm || warm_legacy || warm_combined || warm_collision;
    const bool collision = modbus_transport_collision(mode);
    const auto configured_fp =
        warm_legacy ? configure_homehub(kAliasedModbusHost)
        : collision ? configure_homehub(replacement ? kCollidingModbusB : kCollidingModbusA,
                                        replacement ? 2 : 1)
                    : configure_homehub();
    const bool restore_expected = (mode == ModbusTransport::Cold && ipv4 == peer_a) ||
                                  (mode == ModbusTransport::ColdCollision && !replacement);
    if (collision) {
        require(configured_legacy_crc() == 0xb078dfd9 &&
                    history_homehub_peer_fingerprint(configured_legacy_crc(), ipv4) ==
                        kCollidingScope &&
                    history_modbus_target(kCollidingModbusA, 502, 1) !=
                        history_modbus_target(kCollidingModbusB, 502, 2),
                "two_configured_targets_share_both_legacy_crcs_but_not_new_digest");
    }
    if (warm) {
        std::ifstream transport(transport_path, std::ios::binary);
        transport.read(reinterpret_cast<char*>(&P()), sizeof(P()));
        transport.read(reinterpret_cast<char*>(&s_liveness), sizeof(s_liveness));
        require(static_cast<bool>(transport) && transport.peek() == std::char_traits<char>::eof(),
                "warm_process_loads_only_production_retained_regions");
        if (warm_legacy) {
            require(P().version == HISTORY_PERSIST_VERSION &&
                        P().mb_target_fp ==
                            history_homehub_peer_fingerprint(configured_legacy_crc(), ipv4),
                    "legacy_target_hash_really_aliases_current_peer");
            if (corrupt_version) P().version = kCombinedModbusPeerPersistVersion;
        }
        if (warm_combined)
            require(P().version == kCombinedModbusPeerPersistVersion &&
                        P().mb_target_fp ==
                            history_homehub_peer_fingerprint(configured_legacy_crc(), ipv4),
                    "legacy_combined_scope_matches_before_new_format_rejects_it");
        if (warm_collision) {
            require(P().version == kModbusPeerPersistVersion &&
                        P().mb_target_fp == kCollidingScope &&
                        s_liveness.modbus_config_fp == configured_legacy_crc(),
                    "warm_transport_reproduces_both_legacy_crcs_for_replacement");
            if (corrupt_version) s_liveness.modbus_config_fp ^= 1;
        }
        reset_reason = static_cast<int>(CrashReason::SW);
    } else {
        load_synthetic_nor(transport_path);
    }
    journal_sdk::unix_origin += 2 * HISTORY_DT_S;
    boot(warm);
    if (warm)
        require(std::strcmp(history_persist_state(), corrupt_version ? "bad_crc" : "accept") == 0,
                "warm_start_exercises_real_crc_and_liveness_adoption");
    if (warm) {
        const auto board =
            std::find_if(std::begin(TRENDS), std::end(TRENDS),
                         [](const TrendDef& t) { return t.kind == TrendKind::FreeHeap; });
        require(board != std::end(TRENDS), "independent_board_series_exists");
        HistorySample samples[HISTORY_SAMPLES];
        const size_t  n = history_snapshot(static_cast<size_t>(board - std::begin(TRENDS)), samples,
                                           HISTORY_SAMPLES);
        const bool    observed =
            std::find(samples, samples + n, history_bytes_tenths_kib(100000)) != samples + n;
        require(observed != corrupt_version, "valid_legacy_board_samples_survive_modbus_migration");
        require(P().version == kModbusPeerPersistVersion && P().mb_target_fp == 0 &&
                    s_liveness.modbus_config_fp == 0,
                "warm_upgrade_reseals_without_modbus_identity");
    }
    const auto before = journal_sdk::flash;
    if (!warm) require(s_flash_next_sequence > 1, "legacy_record_still_sets_physical_journal_head");
    require(flow_snapshot().empty(), "boot_keeps_unbound_modbus_samples_invisible");
    record_flow("87.6", history_modbus_generation());
    require(flow_snapshot().empty(), "unbound_sample_does_not_publish_history");
    if (!warm)
        require(history_flash_service_journal(8, 0) == 0 && journal_sdk::flash == before,
                "unbound_history_cannot_append");
    const auto generation = bind_homehub(configured_fp, ipv4);
    for (unsigned i = 0; i < 20; ++i) history_service_flash_restore();
    const auto restored = flow_snapshot();
    if (warm) require(!has_sample(restored, 123), "warm_ram_never_restores_modbus");
    require(has_sample(restored, 123) == restore_expected,
            "restore_requires_proven_matching_peer_and_bound_format");
    require(!has_sample(restored, 876), "unbound_sample_does_not_pollute_restored_history");
    require_no_quiet_ring_sample("old_false_quiet_column_is_not_restored");
    record_flow("24.6", generation);
    const auto resumed = flow_snapshot();
    require(has_sample(resumed, 246) && has_sample(resumed, 123) == restore_expected,
            "resumed_recorder_preserves_only_compatible_history");
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0 && journal_sdk::flash == before,
            "restore_and_rebinding_preserve_raw_journal");
}

void seed_trend_read_fault(const char* transport_path) {
    const auto configured = configure_homehub();
    auto&      cfg        = daik::detail::cfg;
    cfg.board_user_set    = true;
    cfg.board_preset_id   = BoardPresetId::M5StackAtomS3Lite;
    cfg.env3_enabled      = true;
    boot();
    const auto generation = bind_homehub(configured, peer_a);
    record_flow("12.3", generation);
    record_flow("23.4", generation);
    history_record_env3(true, 25.6f, 60.0f, 1000.0f);
    sdk::now_us += history_bucket_us;
    history_record_env3(false, 0, 0, 0);
    const auto env_src = static_cast<size_t>(HistoryJournalSource::Env3);
    require(history_flash_service_journal(12, 0) >= 3 && s_flash_last_bucket[env_src] != INT64_MIN,
            "seed_commits_two_independent_sources");
    std::ofstream transport(transport_path, std::ios::binary);
    transport.write(reinterpret_cast<const char*>(journal_sdk::flash.data()),
                    static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport), "save_trend_restore_fault_transport");
}

void seed_modbus_delayed(const char* transport_path) {
    const auto configured    = configure_homehub();
    journal_sdk::unix_origin = delayed_boot_s;
    boot();
    const auto  generation = bind_homehub(configured, peer_a);
    CachedValue row;
    row.off               = 49;
    row.modbus_definition = def::homehub_definition_id(*def::homehub_find(49));
    row.value             = "12.3";
    sdk::now_us           = 305 * 1000000LL;
    history_record_modbus(&row, 1, generation);
    row.value   = "24.6";
    sdk::now_us = 615 * 1000000LL;
    history_record_modbus(&row, 1, generation);
    require(history_flash_service_journal(8, 0) > 0, "first_delayed_sweep_reaches_journal");

    row.value   = "36.9";
    sdk::now_us = 905 * 1000000LL;
    history_record_modbus(&row, 1, generation);
    // Exercise the scheduled drain even when a wrong anchor claims the already-written slot.
    history_flash_service_journal(8, 0);
    sdk::now_us = 1515 * 1000000LL;
    history_record_modbus(nullptr, 0, generation); // bucket 4 never received a cycle
    const auto live = flow_snapshot();
    require(live ==
                std::vector<HistorySample>{HISTORY_NO_READING, 123, 246, 369, HISTORY_NO_READING},
            "delayed_live_raster_keeps_measurements_and_real_gap");
    require(history_flash_service_journal(8, 0) > 0, "later_delayed_sweep_reaches_journal");
    std::ofstream transport(transport_path, std::ios::binary);
    transport.write(reinterpret_cast<const char*>(journal_sdk::flash.data()),
                    static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport), "save_delayed_modbus_nor");
}

void modbus_reply_bucket() {
    const auto configured = configure_homehub();
    boot();
    const auto  generation = bind_homehub(configured, peer_a);
    CachedValue heater;
    heater.off               = 32;
    heater.modbus_definition = def::homehub_definition_id(*def::homehub_find(32));
    heater.value             = "1";
    sdk::now_us              = history_bucket_us + 200000;
    history_record_modbus(&heater, 1, generation, history_bucket_us - 200000);
    heater.value = "0";
    history_record_modbus(&heater, 1, generation, sdk::now_us);
    sdk::now_us += history_bucket_us;
    history_record_modbus(nullptr, 0, generation);
    HistorySample samples[2];
    const auto    index = logic::homehub_history_index("bsh_state");
    require(history_modbus_snapshot(index, samples, 2) == 2 && samples[0] == 10 && samples[1] == 0,
            "heater_reply_is_recorded_in_its_own_bucket");
}

void x10a_dhw_reply_bucket() {
    boot();
    history_reset_on_detect(101);
    CachedValue rows[3];
    rows[0].label = "BSH";
    rows[1].label = "SG1";
    rows[2].label = "SG2";
    rows[0].off   = 12;
    rows[1].off = rows[2].off = 11;
    rows[0].conv              = 305;
    rows[1].conv              = 301;
    rows[2].conv              = 302;
    rows[0].value = rows[1].value = "1";
    rows[2].value                 = "0";
    for (auto& row : rows) row.reg = 0x60;

    sdk::now_us = history_bucket_us - 200000;
    history_record(nullptr, 0, 7);
    sdk::now_us += 400000;
    history_record_circulation(); // independent producer closes the slot before the poll folds
    history_record(rows, 3, 7, history_bucket_us - 200000);
    rows[0].value = rows[1].value = "0";
    history_record(rows, 3, 7, sdk::now_us);
    sdk::now_us += history_bucket_us;
    history_record(nullptr, 0, 7);

    const auto check = [](const char* id, HistorySample before, const char* oracle) {
        for (size_t i = 0; i < TREND_COUNT; ++i) {
            if (std::strcmp(TRENDS[i].id, id) != 0) continue;
            HistorySample samples[2];
            require(history_snapshot(i, samples, 2) == 2 && samples[0] == before && samples[1] == 0,
                    oracle);
            return;
        }
        require(false, oracle);
    };
    check("bsh_state", 10, "x10a_heater_uses_page_reply_bucket");
    check("smart_grid_mode", 20, "x10a_boost_uses_page_reply_bucket");
}

void restore_modbus_reply_overlap(const char* transport_path, bool partial_restore) {
    const auto configured = configure_homehub();
    load_synthetic_nor(transport_path);
    journal_sdk::unix_origin = delayed_boot_s + 1515;
    history_start();
    const auto generation = bind_homehub(configured, peer_a);
    sdk::now_us           = history_bucket_us + 200000;
    for (unsigned i = 0; i < 20 && !(partial_restore && s_mb_have_bucket); ++i)
        history_service_flash_restore();
    const auto index = static_cast<size_t>(logic::homehub_history_index("bsh_state"));
    require(s_mb_have_bucket && s_mb_bucket == 1, "restore_advanced_beyond_first_modbus_reply");
    require(partial_restore ? !s_flash_restore_done && !P().mb_ring[index].count
                            : s_flash_restore_done && P().mb_ring[index].count,
            "restore_has_expected_heater_ring_progress");

    CachedValue heater;
    heater.off               = 32;
    heater.modbus_definition = def::homehub_definition_id(*def::homehub_find(32));
    heater.value             = "1";
    history_record_modbus(&heater, 1, generation, history_bucket_us - 200000);
    for (unsigned i = 0; i < 20 && !s_flash_restore_done; ++i) history_service_flash_restore();
    require(s_flash_restore_done, "restore_finishes_after_first_modbus_reply");
    heater.value = "0";
    history_record_modbus(&heater, 1, generation, sdk::now_us);
    sdk::now_us += history_bucket_us;
    history_record_modbus(nullptr, 0, generation);

    HistorySample samples[HISTORY_SAMPLES];
    const size_t  n = history_modbus_snapshot(index, samples, HISTORY_SAMPLES);
    require(n >= 2 && samples[n - 2] == 10 && samples[n - 1] == 0,
            "modbus_delayed_reply_survives_concurrent_restore");
    require(has_sample(flow_snapshot(), 369), "modbus_delayed_reply_keeps_restored_flow");
    history_flash_service_journal(12, 0);
    const auto src     = static_cast<size_t>(HistoryJournalSource::Modbus);
    bool       written = false;
    for (size_t slot = 0; slot < s_flash_next_slot; ++slot) {
        FlashJournalRecord record;
        require(flash_read_record(slot, record) == ESP_OK, "read_heater_journal");
        if (!flash_record_physically_valid(record) || record.header.source != src ||
            record.header.flags != HISTORY_JOURNAL_FLAG_TARGET_SCOPED)
            continue;
        HistorySample sample;
        std::memcpy(&sample, record.payload + index * sizeof(sample), sizeof(sample));
        if (sample == 10 &&
            record.header.bucket == history_bucket_from_unix(delayed_boot_s + 1515 + 300))
            written = true;
    }
    require(written, "modbus_delayed_reply_reaches_journal_at_own_boundary");
}

void restore_modbus_delayed(const char* transport_path) {
    const auto configured = configure_homehub();
    load_synthetic_nor(transport_path);
    journal_sdk::unix_origin = delayed_boot_s + 1515;
    history_start();
    require(s_flash_scan_ok && !s_flash_restore_done, "scan_delayed_modbus_nor");
    const auto generation = bind_homehub(configured, peer_a);
    for (unsigned i = 0; i < 20; ++i) history_service_flash_restore();
    require(s_flash_restore_done, "finish_delayed_modbus_restore");
    const auto restored = flow_snapshot();
    const auto first    = history_bucket_from_unix(delayed_boot_s + 600);
    require(s_flash_oldest_bucket[static_cast<size_t>(HistoryJournalSource::Modbus)] == first &&
                restored == std::vector<HistorySample>{123, 246, 369, HISTORY_NO_READING,
                                                       HISTORY_NO_READING},
            "restored_delayed_modbus_has_one_sample_per_closing_boundary");

    // A new boot's first real measurement appends after the restored gaps.
    record_flow("49.2", generation);
    auto expected = restored;
    expected.push_back(492);
    require(flow_snapshot() == expected, "resumed_modbus_preserves_restored_sequence");
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "delayed_modbus_restore_is_read_only");
}

void restore_modbus_pending_at_boundary(const char* transport_path) {
    const auto configured = configure_homehub();
    load_synthetic_nor(transport_path);
    journal_sdk::unix_origin = delayed_boot_s + 1515;
    history_start();
    const auto generation = bind_homehub(configured, peer_a);
    sdk::now_us           = history_bucket_us - 200000;
    CachedValue flow;
    flow.off               = 49;
    flow.modbus_definition = def::homehub_definition_id(*def::homehub_find(49));
    flow.value             = "41.1";
    history_record_modbus(&flow, 1, generation);
    sdk::now_us = history_bucket_us + 200000;
    for (unsigned i = 0; i < 20; ++i) history_service_flash_restore();
    require(s_flash_restore_done && s_mb_last_commit_bucket == 0,
            "restore_anchors_the_completed_live_bucket");
    flow.value = "42.2";
    history_record_modbus(&flow, 1, generation);
    auto expected =
        std::vector<HistorySample>{123, 246, 369, HISTORY_NO_READING, HISTORY_NO_READING, 411};
    require(flow_snapshot() == expected, "restore_does_not_commit_the_pending_bucket_twice");
    sdk::now_us += history_bucket_us;
    history_record_modbus(nullptr, 0, generation);
    expected.push_back(422);
    require(flow_snapshot() == expected, "restore_preserves_next_live_bucket");
}

void restore_trend_read_fault(const char* transport_path, bool persistent) {
    const auto configured = configure_homehub();
    load_synthetic_nor(transport_path);
    journal_sdk::unix_origin += 4 * HISTORY_DT_S;
    history_start();
    require(s_flash_scan_ok && !s_flash_restore_done, "cold_scan_leaves_trend_restore_pending");
    bind_homehub(configured, peer_a);
    const auto src     = static_cast<size_t>(HistoryJournalSource::Modbus);
    const auto env_src = static_cast<size_t>(HistoryJournalSource::Env3);
    require(s_flash_restore_slot_count[src] == 2, "two_scoped_modbus_records_indexed");
    require(s_flash_restore_slot_count[env_src] > 0, "later_independent_env3_record_indexed");
    fail_restore_offset           = history_journal_slot_offset(s_flash_restore_slots[src][1]);
    fail_restore_reads            = persistent ? 64 : 1;
    constexpr size_t first_modbus = history_restore_next_source_ring(0);
    for (size_t i = 0; s_flash_restore_ring < first_modbus && i < 64; ++i)
        history_service_flash_restore();
    require(s_flash_restore_ring == first_modbus, "restore_reaches_modbus_before_fault");

    history_service_flash_restore();
    require(!s_flash_restore_done && s_flash_restore_ring == first_modbus,
            "failed_batch_waits_for_retry_without_retiring_later_sources");
    for (size_t i = 0; !s_flash_restore_done && i < 64; ++i) history_service_flash_restore();
    require(s_flash_restore_done, "retry_exhaustion_still_finishes_trend_restore");
    const auto flow = flow_snapshot();
    require(has_sample(flow, 234), "readable_neighbor_survives_failed_slot");
    require(has_sample(flow, 123) == !persistent, "only_persistently_unreadable_bucket_is_lost");
    HistorySample env[HISTORY_SAMPLES];
    const size_t  count = history_env3_snapshot(0, env, HISTORY_SAMPLES);
    require(std::find(env, env + count, 256) != env + count,
            "later_independent_env3_source_restores");
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "read_fault_recovery_preserves_raw_journal");
}

void restore_late_correction(const char* transport_path) {
    load_synthetic_nor(transport_path);
    sdk::now_us = 3620000000LL;
    boot(false); // real cold statics, real History scan and real Store reconstruction
    const auto report = stop_observation_report();
    std::cout << "WITNESS fresh_restored_stops=" << report.counters.witnessed_stops_recent_heating
              << " acknowledged_stops=1 readable_us=" << report.readable_us
              << " pending=" << report.persistence_pending << '\n';
    require(report.counters.witnessed_stops_recent_heating == 1,
            "fresh_restore_retains_acknowledged_late_correction");
    require(report.readable_us == 5000000 && !report.persistence_pending &&
                journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "cold_restore_preserves_exact_dated_population_without_writes");
}
void checkup_pending(const char* transport_path, bool forget_interleave) {
    load_synthetic_nor(transport_path);
    const auto before = journal_sdk::flash;
    sdk::now_us       = 3620000000LL;
    history_start();
    stop_observation_start(true, 11);
    require(history_checkup_flash_pending(), "healthy_scan_exposes_pending_core");

    if (forget_interleave) {
        // Let Forget latch suppression after the query's first load but before it acquires the
        // mutex. All erase attempts fail, so a query that only reads the scan flags sees pending.
        refuse_erases    = true;
        sdk::before_take = observe_forget;
        require(!history_checkup_flash_pending(), "pending_rechecks_forget_under_lock");
        require(forget_called && !forget_result && journal_sdk::erases == 3,
                "real_forget_interleaves_and_fails_erase");
        require(s_flash_scan_ok && !s_flash_checkup_restore_done && journal_sdk::flash == before &&
                    journal_sdk::writes == 0,
                "failed_erase_preserves_pending_flags_and_nor");
        const auto takes = sdk::takes;
        require(!history_checkup_flash_pending() && sdk::takes == takes,
                "already_forgotten_pending_skips_lock");
        history_service_flash_restore();
        require(journal_sdk::core_restore == 0, "forgotten_core_never_restores");
        return;
    }

    {
        Lock held(s_flash_mtx, 0);
        require(held.acquired(), "modeled_competing_flash_owner");
        require(!history_checkup_flash_pending(), "contended_pending_query_is_nonblocking");
    }
    require(history_checkup_flash_pending(), "contention_does_not_retire_pending_core");
    history_service_flash_restore();
    require(journal_sdk::core_restore == 1 && !history_checkup_flash_pending(),
            "real_restore_consumes_pending_core");
    require(journal_sdk::erases == 0 && journal_sdk::writes == 0 && journal_sdk::flash == before,
            "pending_queries_and_restore_preserve_nor");
}
} // namespace
int main(int argc, char** argv) {
    const std::string name = argc >= 2 ? argv[1] : "unknown_case";
    try {
        if (name == "seed_late_correction" && argc == 3)
            seed_late_correction(argv[2]);
        else if (name == "restore_late_correction" && argc == 3)
            restore_late_correction(argv[2]);
        else if (name == "seed_trend_read_fault" && argc == 3)
            seed_trend_read_fault(argv[2]);
        else if (name == "seed_modbus_delayed" && argc == 3)
            seed_modbus_delayed(argv[2]);
        else if (name == "restore_modbus_delayed" && argc == 3)
            restore_modbus_delayed(argv[2]);
        else if (name == "restore_modbus_reply_overlap" && argc == 3)
            restore_modbus_reply_overlap(argv[2], false);
        else if (name == "restore_modbus_reply_partial" && argc == 3)
            restore_modbus_reply_overlap(argv[2], true);
        else if (name == "restore_modbus_pending_at_boundary" && argc == 3)
            restore_modbus_pending_at_boundary(argv[2]);
        else if ((name == "restore_trend_read_transient" ||
                  name == "restore_trend_read_persistent") &&
                 argc == 3)
            restore_trend_read_fault(argv[2], name == "restore_trend_read_persistent");
        else if ((name == "checkup_pending_healthy" || name == "checkup_pending_forget") &&
                 argc == 3)
            checkup_pending(argv[2], name == "checkup_pending_forget");
        else if (name == "seed_modbus_cold" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::Cold);
        else if (name == "seed_modbus_legacy" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::Legacy);
        else if (name == "seed_modbus_legacy_tagged" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::LegacyTagged);
        else if (name == "seed_modbus_cold_collision" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::ColdCollision);
        else if (name == "seed_modbus_warm" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::Warm);
        else if (name == "restore_modbus_cold_same" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::Cold, peer_a);
        else if (name == "restore_modbus_cold_different" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::Cold, peer_b);
        else if (name == "restore_modbus_legacy" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::Legacy, peer_a);
        else if (name == "restore_modbus_legacy_tagged" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::LegacyTagged, kCollidingIpv4, false,
                                true);
        else if (name == "restore_modbus_cold_collision_same" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::ColdCollision, kCollidingIpv4);
        else if (name == "restore_modbus_cold_collision_replacement" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::ColdCollision, kCollidingIpv4, false,
                                true);
        else if (name == "restore_modbus_warm_same" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::Warm, peer_a);
        else if (name == "restore_modbus_warm_different" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::Warm, peer_b);
        else if (name == "seed_modbus_warm_legacy" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::WarmLegacy);
        else if (name == "restore_modbus_warm_legacy_alias" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::WarmLegacy, peer_b);
        else if (name == "restore_modbus_warm_legacy_corrupt_marker" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::WarmLegacy, peer_b, true);
        else if (name == "seed_modbus_warm_combined" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::WarmCombined);
        else if (name == "restore_modbus_warm_combined" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::WarmCombined, peer_a);
        else if (name == "seed_modbus_warm_collision" && argc == 3)
            seed_modbus_peer(argv[2], ModbusTransport::WarmCollision);
        else if (name == "restore_modbus_warm_collision_same" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::WarmCollision, kCollidingIpv4);
        else if (name == "restore_modbus_warm_collision_replacement" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::WarmCollision, kCollidingIpv4, false,
                                true);
        else if (name == "restore_modbus_warm_collision_corrupt_config" && argc == 3)
            restore_modbus_peer(argv[2], ModbusTransport::WarmCollision, kCollidingIpv4, true,
                                true);
        else if (argc != 2)
            throw std::runtime_error("unknown_case");
        else if (name == "commit_rejected")
            append_case(false, "commit");
        else if (name == "core_ahead")
            core_ahead();
        else if (name == "nor_contract")
            nor_contract();
        else if (name == "forget_before_start")
            forget_case(ForgetPoint::BeforeStart);
        else if (name == "forget_during_lookup")
            forget_case(ForgetPoint::DuringLookup);
        else if (name == "forget_during_scan")
            forget_case(ForgetPoint::DuringScan);
        else if (name == "forget_missing_partition")
            forget_case(ForgetPoint::MissingPartition);
        else if (name == "forget_wrong_address")
            forget_case(ForgetPoint::WrongAddress);
        else if (name == "forget_wrong_size")
            forget_case(ForgetPoint::WrongSize);
        else if (name == "forget_missing_history_mutex")
            forget_case(ForgetPoint::MissingHistoryMutex);
        else if (name == "forget_missing_flash_mutex")
            forget_case(ForgetPoint::MissingFlashMutex);
        else if (name == "forget_ready")
            forget_case(ForgetPoint::Ready);
        else if (name == "forget_incomplete_scan")
            forget_case(ForgetPoint::AfterIncompleteScan);
        else if (name == "read_admission")
            read_admission();
        else if (name == "sequence_rejections")
            sequence_rejections();
        else if (name == "modbus_live_peer_change")
            modbus_live_peer_change();
        else if (name == "modbus_reply_bucket")
            modbus_reply_bucket();
        else if (name == "x10a_dhw_reply_bucket")
            x10a_dhw_reply_bucket();
        else if (name == "modbus_peer_forget")
            modbus_peer_forget();
        else if (name == "modbus_missing_target_digest")
            modbus_missing_target_digest();
        else if (name == "modbus_quiet_unverified")
            modbus_quiet_unverified();
        else if (name == "core_sequence_prepare")
            core_sequence("prepare");
        else if (name == "core_sequence_readback")
            core_sequence("readback");
        else if (name == "core_sequence_commit_error")
            core_sequence("commit_error");
        else if (name.rfind("data_", 0) == 0 || name.rfind("barrier_", 0) == 0) {
            const bool barrier = name.rfind("barrier_", 0) == 0;
            const auto phase   = name.substr(barrier ? 8 : 5);
            if (phase != "prepare_read" && phase != "prepare_erase" && phase != "body" &&
                phase != "commit" && phase != "commit_accepted_error" && phase != "readback" &&
                phase != "success")
                throw std::runtime_error("unknown_case");
            append_case(barrier, phase);
        } else
            throw std::runtime_error("unknown_case");
        require(sdk::takes == sdk::gives, "all_modeled_mutexes_released");
        std::cout << "PASS case=" << name << " assertions=" << assertions << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cout << "FAIL oracle=" << error.what() << " case=" << name
                  << " assertions=" << assertions << '\n';
        return 1;
    }
}
