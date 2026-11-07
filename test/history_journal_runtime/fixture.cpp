// Compile the complete production History TU; physical flash and external services are host ports.
#include "sdk.hpp"
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
#include HISTORY_PRODUCTION_SOURCE

namespace {
const esp_partition_t partition{daik::logic::HISTORY_FLASH_PARTITION_OFFSET,
                                daik::logic::HISTORY_FLASH_PARTITION_BYTES};
const esp_partition_t* lookup_partition = &partition;
}
const esp_partition_t* esp_partition_find_first(int, int, const char* label) {
    if (auto hook = std::exchange(journal_sdk::during_find, nullptr)) hook();
    return std::strcmp(label, "history") == 0 ? lookup_partition : nullptr;
}
esp_err_t esp_partition_read(const esp_partition_t* part, size_t offset, void* out, size_t bytes) {
    ++journal_sdk::reads;
    if (auto hook = std::exchange(journal_sdk::during_read, nullptr)) hook();
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
    if (journal_sdk::fail_erase == journal_sdk::erases) return ESP_FAIL;
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
void restore_late_correction(const char* transport_path) {
    journal_sdk::flash.resize(HISTORY_FLASH_PARTITION_BYTES);
    std::ifstream transport(transport_path, std::ios::binary);
    transport.read(reinterpret_cast<char*>(journal_sdk::flash.data()),
                   static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport) && transport.peek() == std::char_traits<char>::eof(),
            "cold_process_loads_exact_synthetic_partition_bytes");
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
} // namespace
int main(int argc, char** argv) {
    const std::string name = argc >= 2 ? argv[1] : "unknown_case";
    try {
        if (name == "seed_late_correction" && argc == 3)
            seed_late_correction(argv[2]);
        else if (name == "restore_late_correction" && argc == 3)
            restore_late_correction(argv[2]);
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
