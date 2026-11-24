// Compile the complete production History TU; physical flash and external services are host ports.
#include "sdk.hpp"
#include <algorithm>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#ifndef HISTORY_PRODUCTION_SOURCE
#error "Bind complete production main/history.cpp"
#endif
#include HISTORY_PRODUCTION_SOURCE

namespace {
const esp_partition_t  partition{daik::logic::HISTORY_FLASH_PARTITION_OFFSET,
                                daik::logic::HISTORY_FLASH_PARTITION_BYTES};
const esp_partition_t* lookup_partition = &partition;
bool                   refuse_erases    = false;
unsigned                         core_backlog         = 0;
constexpr uint32_t               cycling_model        = 202;
constexpr uint32_t               cycling_source       = 101;
constexpr uint32_t               cycling_generation   = 11;
constexpr uint32_t               kCyclingOfferEndS    = 86000;
constexpr uint32_t kCyclingOfferLagS = daik::logic::CHECKUP_WINDOW_S - kCyclingOfferEndS;
uint32_t                         cycling_offer_unix_s = 0;
uint32_t                         cycling_offer_through_s = 300;
uint32_t                         cycling_reset_token  = 0;
uint32_t                         cycling_ack          = 0;
uint32_t                         cycling_offer_model  = cycling_model;
bool                             cycling_forgotten    = false;
daik::logic::CheckupCyclingTrace cycling_restored;
unsigned                         cycling_run_offers  = 0;
bool                             tear_run_checkpoint = false;
std::vector<uint32_t>            cycling_run_restored_starts;
bool                             mb_core_pending         = false;
int64_t                          mb_core_bucket          = 0;
unsigned                         mb_core_appended        = 0;
unsigned                         mb_core_restore         = 0;
constexpr uint32_t               mb_cycling_model        = 303;
constexpr uint32_t               mb_cycling_source       = 404;
uint32_t                         mb_cycling_offer_unix_s = 0;
uint32_t                         mb_cycling_reset_token  = 0;
uint32_t                         mb_cycling_ack          = 0;
daik::logic::CheckupCyclingTrace mb_cycling_restored;
uint32_t                         fault_offer_unix_s = 0;
uint32_t                         fault_reset_token  = 0;
uint32_t                         fault_ack          = 0;
bool                             fault_forgotten    = false;
daik::logic::CheckupFaultTrace   fault_restored;
uint32_t                         mb_fault_offer_unix_s = 0;
uint32_t                         mb_fault_reset_token  = 0;
uint32_t                         mb_fault_ack          = 0;
daik::logic::CheckupFaultTrace   mb_fault_restored;

struct DhwJournalPort {
    daik::logic::DhwLossTracePage offer{};
    daik::logic::DhwLossTrace     restored{};
    uint32_t                      pending       = 0;
    uint32_t                      ack           = 0;
    uint32_t                      after_barrier = 0;
    unsigned                      restore_calls = 0;
    bool                          reset_pending = false;
    bool                          confirmed     = true;
    bool                          restore_busy  = false;
    bool                          scope_matches = true;
};
DhwJournalPort     dhw_ports[2];
bool               dhw_forgotten          = false;
constexpr unsigned dhw_seed_uptime_s      = 7230;
constexpr unsigned dhw_reboot_delay_s     = 600;
constexpr uint32_t dhw_circulation_fps[2] = {505, 606};
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
    if (tear_run_checkpoint && bytes >= sizeof(daik::logic::HistoryJournalHeader)) {
        daik::logic::HistoryJournalHeader header;
        std::memcpy(&header, in, sizeof(header));
        if (header.catalog_fp == daik::logic::CYCLING_RUN_JOURNAL_SCHEMA) {
            tear_run_checkpoint     = false;
            journal_sdk::fail_write = journal_sdk::writes + 1; // Withhold the commit word.
        }
    }
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

void                      checkup_hydronic_expire(int64_t) {}
bool                      hydronic_forgotten = false;
void                      hydronic_observation_start(bool, uint32_t) { hydronic_forgotten = false; }
bool                      hydronic_observation_suppressed() { return hydronic_forgotten; }
void                      hydronic_observation_set_diagnostics(bool, uint32_t) {}
void                      hydronic_observation_bind(uint32_t, uint32_t, uint32_t, uint32_t, bool) {}
void                      hydronic_observation_reset() {}
void                      hydronic_observation_record(const logic::HydronicDelta&) {}
void                      hydronic_observation_seal() {}
HydronicObservationReport hydronic_observation_report() { return {}; }
void                      hydronic_observation_flash_index_reset() {}
void                      hydronic_observation_flash_index_incomplete() {}
void                      hydronic_observation_flash_index(int64_t, uint64_t, uint16_t,
                                                           const logic::HydronicHourlyPayload&) {}
bool                      hydronic_observation_flash_next(HydronicObservationReader, int64_t&,
                                                          logic::HydronicHourlyPayload&) {
    return false;
}
void hydronic_observation_flash_appended(int64_t, uint64_t, uint16_t,
                                         const logic::HydronicHourlyPayload&) {}
void hydronic_observation_flash_failed() {}
void hydronic_observation_flash_service(HydronicObservationReader) {}
void hydronic_observation_forget() { hydronic_forgotten = true; }
bool checkup_flash_next(int64_t, int64_t, int64_t& bucket, logic::CheckupJournalPayload& payload,
                        DiagnosticsSource source) {
    if (source == DiagnosticsSource::Modbus) {
        if (!mb_core_pending) return false;
        bucket  = mb_core_bucket;
        payload = {mb_cycling_model, mb_cycling_source, 0, 11, bucket * 3600, {}, {}};
        return true;
    }
    if (!journal_sdk::core_pending) return false;
    bucket  = journal_sdk::core_bucket;
    payload = {202, 101, 0, 11, bucket * 3600, {}, {}};
    return true;
}
void checkup_flash_appended(int64_t, DiagnosticsSource source) {
    if (source == DiagnosticsSource::Modbus) {
        ++mb_core_appended;
        mb_core_pending = false;
        return;
    }
    ++journal_sdk::core_appended;
    if (core_backlog) {
        --core_backlog;
        ++journal_sdk::core_bucket;
    }
    journal_sdk::core_pending = core_backlog > 0;
}
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t, DiagnosticsSource                source) {
    if (source == DiagnosticsSource::Modbus) {
        ++mb_core_restore;
        for (size_t i = 0; i < count; ++i)
            if (records[i].payload.model_fp != mb_cycling_model)
                throw std::runtime_error("modbus adapter received x10a checkup source");
        return CheckupFlashRestoreResult::Restored;
    }
    ++journal_sdk::core_restore;
    for (size_t i = 0; i < count; ++i)
        if (records[i].payload.model_fp != 202)
            throw std::runtime_error("core adapter received another logical source");
    return CheckupFlashRestoreResult::Restored;
}
bool checkup_cycling_checkpoint(logic::CheckupCyclingTrace& trace, logic::CyclingTraceIdentity& id,
                                uint32_t& token, TickType_t, bool allow_data,
                                DiagnosticsSource source) {
    const bool     is_mb      = source == DiagnosticsSource::Modbus;
    const uint32_t offer_unix = is_mb ? mb_cycling_offer_unix_s : cycling_offer_unix_s;
    const uint32_t reset_tok  = is_mb ? mb_cycling_reset_token : cycling_reset_token;
    if (cycling_forgotten || (!reset_tok && (!allow_data || !offer_unix))) return false;
    token = reset_tok;
    trace.reset();
    trace.unix_s       = token ? 1 : offer_unix;
    trace.window_end_s = logic::CHECKUP_WINDOW_S;
    trace.live         = !token;
    id                 = {};
    if (!token) {
        for (uint32_t i = 0; i < trace.capacity; ++i)
            trace.push(80000 + 31 * i, static_cast<logic::CheckupCyclingTrace::Kind>(i % 7));
        trace.end_s  = kCyclingOfferEndS;
        trace.boot_s = kCyclingOfferLagS + cycling_offer_through_s;
        id          = is_mb ? logic::CyclingTraceIdentity{mb_cycling_model, mb_cycling_source,
                                                 cycling_generation}
                            : logic::CyclingTraceIdentity{cycling_offer_model, cycling_source,
                                                 cycling_generation};
    }
    return true;
}
bool checkup_cycling_reset_pending(DiagnosticsSource source) {
    return (source == DiagnosticsSource::Modbus ? mb_cycling_reset_token : cycling_reset_token) !=
           0;
}
void checkup_cycling_checkpoint_appended(uint32_t reset_token, DiagnosticsSource source) {
    if (source == DiagnosticsSource::Modbus) {
        mb_cycling_ack         = reset_token;
        mb_cycling_reset_token = 0;
        return;
    }
    cycling_ack         = reset_token;
    cycling_reset_token = 0;
}
CheckupFlashRestoreResult checkup_cycling_restore(const logic::CheckupCyclingTrace&  trace,
                                                  const logic::CyclingTraceIdentity& id,
                                                  int64_t           unix_s, TickType_t,
                                                  DiagnosticsSource source) {
    const bool     is_mb = source == DiagnosticsSource::Modbus;
    const uint32_t exp_m = is_mb ? mb_cycling_model : cycling_model;
    const uint32_t exp_s = is_mb ? mb_cycling_source : cycling_source;
    if (!trace.count || cycling_forgotten || id.model_fp != exp_m)
        return CheckupFlashRestoreResult::Ignored;
    if (id.source_fp != exp_s || id.diagnostics_generation != cycling_generation)
        throw std::runtime_error("cycling adapter received foreign physical source or consent");
    if (!is_mb && static_cast<int64_t>(trace.unix_s) + trace.end_s - trace.window_end_s > unix_s)
        return CheckupFlashRestoreResult::TryOlder;
    if (is_mb)
        mb_cycling_restored = trace;
    else
        cycling_restored = trace;
    return CheckupFlashRestoreResult::Restored;
}
bool checkup_cycling_runs_checkpoint(logic::CyclingRunJournalPage& page, uint32_t after_boot_stop_s,
                                     uint32_t& last_stop_s, TickType_t,
                                     uint32_t trace_through_boot_s, uint32_t trace_boot_unix_s) {
    if (cycling_forgotten || cycling_reset_token) return false;
    size_t count = 0;
    for (unsigned i = 0; i < cycling_run_offers && count < logic::CYCLING_RUN_JOURNAL_CAPACITY;
         ++i) {
        const uint32_t stop_s = (i + 1) * 20;
        if (stop_s <= after_boot_stop_s || stop_s > trace_through_boot_s) continue;
        auto& run               = page.entries[count++];
        run                     = logic::cycling_run_context_empty();
        run.start_s             = trace_boot_unix_s + stop_s - 10;
        run.stop_s              = run.start_s + 10;
        run.mode                = static_cast<uint8_t>(logic::CyclingRunMode::Space);
        run.stop_kind           = static_cast<uint8_t>(logic::CyclingStopKind::Normal);
        run.flags               = logic::RUN_CTX_F_STOPPED | logic::RUN_CTX_F_FINALIZED;
        run.flow_tenths         = 170;
        run.flow_typical_tenths = 210;
        last_stop_s             = stop_s;
    }
    if (count) page.identity = {cycling_model, cycling_source, cycling_generation};
    return count != 0;
}
CheckupFlashRestoreResult checkup_cycling_runs_restore(const logic::CyclingRunJournalPage& page,
                                                       uint32_t, TickType_t) {
    if (!cycling_restored.count || page.identity.model_fp != cycling_model ||
        page.identity.source_fp != cycling_source ||
        page.identity.diagnostics_generation != cycling_generation)
        throw std::runtime_error(
            "run-detail adapter received a page without restored X10A lineage");
    for (size_t i = logic::cycling_run_journal_count(page); i > 0; --i) {
        const auto& run = page.entries[i - 1];
        if (run.flow_tenths != 170 || run.flow_typical_tenths != 210)
            throw std::runtime_error("run-detail adapter received a changed measurement");
        cycling_run_restored_starts.push_back(run.start_s);
    }
    return CheckupFlashRestoreResult::Restored;
}
void checkup_cycling_forget() {
    cycling_forgotten = true;
    fault_forgotten   = true;
}
bool checkup_fault_checkpoint(logic::CheckupFaultTrace& trace, logic::CyclingTraceIdentity& id,
                              uint32_t& token, TickType_t, bool periodic_due, bool,
                              DiagnosticsSource source) {
    const bool     is_mb      = source == DiagnosticsSource::Modbus;
    const uint32_t offer_unix = is_mb ? mb_fault_offer_unix_s : fault_offer_unix_s;
    const uint32_t reset_tok  = is_mb ? mb_fault_reset_token : fault_reset_token;
    if (fault_forgotten || (!reset_tok && (!periodic_due || !offer_unix))) return false;
    token = reset_tok;
    trace.reset();
    trace.unix_s       = token ? 1 : offer_unix;
    trace.window_end_s = logic::CHECKUP_FAULT_WINDOW_S;
    id                 = {};
    if (!token) {
        trace.push(86000, {logic::FaultTraceKind::Normal});
        trace.push(86010, {logic::FaultTraceKind::Error, logic::FaultUnitOrigin::Indoor,
                           logic::fault_code_pack("7H"), 0});
        trace.push(86035, {logic::FaultTraceKind::Normal});
        trace.end_s = 86100;
        id          = is_mb ? logic::CyclingTraceIdentity{mb_cycling_model, mb_cycling_source,
                                                 cycling_generation}
                            : logic::CyclingTraceIdentity{cycling_offer_model, cycling_source,
                                                 cycling_generation};
    }
    return true;
}
bool checkup_fault_reset_pending(DiagnosticsSource source) {
    return (source == DiagnosticsSource::Modbus ? mb_fault_reset_token : fault_reset_token) != 0;
}
void checkup_fault_checkpoint_appended(uint32_t reset_token, DiagnosticsSource source) {
    if (source == DiagnosticsSource::Modbus) {
        mb_fault_ack         = reset_token;
        mb_fault_reset_token = 0;
        return;
    }
    fault_ack         = reset_token;
    fault_reset_token = 0;
}
CheckupFlashRestoreResult checkup_fault_restore(const logic::CheckupFaultTrace&    trace,
                                                const logic::CyclingTraceIdentity& id, int64_t,
                                                TickType_t, DiagnosticsSource source) {
    const bool     is_mb = source == DiagnosticsSource::Modbus;
    const uint32_t exp_m = is_mb ? mb_cycling_model : cycling_model;
    const uint32_t exp_s = is_mb ? mb_cycling_source : cycling_source;
    if (!trace.count || fault_forgotten || id.model_fp != exp_m)
        return CheckupFlashRestoreResult::Ignored;
    if (id.source_fp != exp_s || id.diagnostics_generation != cycling_generation)
        throw std::runtime_error("fault adapter received foreign physical source or consent");
    if (is_mb)
        mb_fault_restored = trace;
    else
        fault_restored = trace;
    return CheckupFlashRestoreResult::Restored;
}
void checkup_fault_forget() { fault_forgotten = true; }

bool checkup_dhw_trace_checkpoint(logic::DhwLossTracePage& page, uint32_t& token, TickType_t,
                                  DiagnosticsSource source) {
    const auto& port = dhw_ports[source == DiagnosticsSource::Modbus];
    if (dhw_forgotten || !port.pending) return false;
    token = port.pending;
    page  = port.reset_pending ? logic::DhwLossTracePage{} : port.offer;
    return true;
}
bool checkup_dhw_trace_reset_pending(DiagnosticsSource source) {
    return dhw_ports[source == DiagnosticsSource::Modbus].reset_pending;
}
void checkup_dhw_trace_checkpoint_appended(uint32_t token, DiagnosticsSource source) {
    auto& port = dhw_ports[source == DiagnosticsSource::Modbus];
    port.ack   = token;
    if (token == port.pending) {
        port.pending       = port.reset_pending ? port.after_barrier : 0;
        port.reset_pending = false;
    }
}
bool checkup_dhw_trace_restore_ready(DiagnosticsSource source) {
    return dhw_ports[source == DiagnosticsSource::Modbus].confirmed;
}
CheckupFlashRestoreResult checkup_dhw_trace_restore(const logic::DhwLossTracePage& page, TickType_t,
                                                    DiagnosticsSource              source) {
    const bool is_mb = source == DiagnosticsSource::Modbus;
    auto&      port  = dhw_ports[is_mb];
    ++port.restore_calls;
    if (dhw_forgotten || port.reset_pending || !port.scope_matches)
        return CheckupFlashRestoreResult::Ignored;
    if (!port.confirmed || !journal_sdk::synced || port.restore_busy)
        return CheckupFlashRestoreResult::Deferred;
    if (page.model_fp != (is_mb ? mb_cycling_model : cycling_model) ||
        page.source_fp != (is_mb ? mb_cycling_source : cycling_source) ||
        page.diagnostics_generation != cycling_generation ||
        page.dhw_source_fp != dhw_circulation_fps[is_mb])
        throw std::runtime_error("tank-cooling port received another logical source");
    const auto uptime = static_cast<uint32_t>(sdk::now_us / 1000000);
    const auto unix_s = static_cast<uint32_t>(journal_sdk::unix_origin) + uptime;
    return logic::dhw_loss_trace_restore(port.restored, page, uptime, unix_s)
               ? CheckupFlashRestoreResult::Restored
               : CheckupFlashRestoreResult::Ignored;
}
void checkup_dhw_trace_forget() { dhw_forgotten = true; }
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
    for (unsigned i = 0; i < HISTORY_FLASH_TOTAL_RINGS / 4 + 6; ++i)
        history_service_flash_restore();
    require(s_flash_restore_done, "complete_trend_restore");
    require(s_flash_checkup_restore_done, "complete_core_restore");
    require(s_flash_mb_checkup.restore_done, "complete_modbus_core_restore");
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
    require(s_flash_forgotten.load() && stop_observation_suppressed() &&
                hydronic_observation_suppressed(),
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
void poll_during_shutdown_claim() {
    boot();
    cycling_offer_unix_s = static_cast<uint32_t>(journal_sdk::unix_origin);
    // The shutdown callback has claimed its drain but has not acquired the flash lock yet.
    s_flash_shutdown_started.store(true);
    require(history_flash_service_journal(3, 0) == 3 && s_flash_cycling.pending &&
                !s_flash_cycling.shutdown_offered,
            "poll_does_not_take_over_shutdown_budget");
}
void cycling_reset_before_last_page() {
    boot();
    cycling_offer_unix_s = static_cast<uint32_t>(journal_sdk::unix_origin);
    require(history_flash_service_journal(3, 0) == 3 && s_flash_cycling.pending,
            "ordinary_checkpoint_waits_for_its_final_page");
    cycling_reset_token = 9;
    require(history_flash_service_journal(1, 0) == 1 && cycling_ack == 9 &&
                !s_flash_cycling.pending,
            "reset_commits_in_place_of_retired_checkpoint_final_page");
}
void cycling_reset_before_trend_restore(bool trace_ready) {
    boot();
    cycling_offer_unix_s         = static_cast<uint32_t>(journal_sdk::unix_origin);
    cycling_reset_token          = 9;
    s_flash_restore_done         = false;
    s_flash_cycling.restore_done = trace_ready;
    history_flash_save();
    require(cycling_ack == 9 && journal_sdk::writes == 2,
            "shutdown_commits_only_reset_while_trends_restore");
}
void cycling_reset_before_time_sync() {
    boot();
    journal_sdk::synced  = false;
    cycling_reset_token  = 9;
    cycling_offer_unix_s = static_cast<uint32_t>(journal_sdk::unix_origin);
    history_flash_save();
    require(cycling_ack == 9 && journal_sdk::writes == 2,
            "shutdown_commits_undated_reset_without_observations");
}
void seed_cycling(const char* transport_path, const std::string& phase) {
    boot();
    cycling_offer_unix_s = static_cast<uint32_t>(journal_sdk::unix_origin);
    require(history_flash_service_journal(3, 0) == 3 && s_flash_cycling.pending,
            "normal_poll_bounds_multislot_checkpoint_work");
    require(history_flash_service_journal(3, 0) == 1 && !s_flash_cycling.pending,
            "last_page_finishes_normal_checkpoint_once");
    require(journal_sdk::core_appended == 0 && s_flash_last_bucket[3] == INT64_MIN,
            "cycling_never_updates_core_hour_cursor");
    if (phase == "shutdown") {
        sdk::now_us += 10000000;
        cycling_offer_unix_s += 10;
        require(history_flash_service_journal(3, 0) == 0,
                "checkpoint_throttle_withholds_normal_write");
        core_backlog              = 13;
        journal_sdk::core_pending = true;
        journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600 - core_backlog;
        history_flash_save();
        require(journal_sdk::core_appended == 12 && journal_sdk::core_pending && core_backlog == 1,
                "shutdown_cycling_preserves_full_ordinary_journal_budget");
        require(journal_sdk::writes == 40 && !s_flash_cycling.pending,
                "shutdown_adds_exactly_one_complete_fresh_checkpoint");
        history_flash_save();
        require(journal_sdk::writes == 40 && core_backlog == 1, "shutdown_does_not_drain_twice");
    } else if (phase == "barrier_early_shutdown") {
        cycling_reset_token  = 9;
        s_flash_restore_done = s_flash_cycling.restore_done = false;
        history_flash_save();
        require(cycling_ack == 9 && journal_sdk::writes == 10,
                "shutdown_commits_only_reset_while_trends_restore");
    } else if (phase == "barrier") {
        cycling_reset_token = 9;
        require(history_flash_service_journal(3, 0) == 1 && cycling_ack == 9,
                "barrier_is_immediate_and_acked_after_verified_commit");
    } else if (phase == "torn" || phase == "corrupt" || phase == "incompatible" ||
               phase == "future") {
        constexpr int64_t next_interval_s = HISTORY_FLASH_CYCLING_INTERVAL_S + 10;
        sdk::now_us += next_interval_s * 1000000;
        cycling_offer_unix_s += static_cast<uint32_t>(next_interval_s);
        if (phase == "incompatible") cycling_offer_model = 303;
        if (phase == "future") cycling_offer_unix_s += 7200;
        require(history_flash_service_journal(3, 0) == 3,
                "newer_checkpoint_prefix_lands_before_failure");
        if (phase == "torn") {
            journal_sdk::fail_write = journal_sdk::writes + 2;
            require(history_flash_service_journal(3, 0) == 0,
                    "newer_checkpoint_final_commit_is_torn");
        } else {
            require(history_flash_service_journal(3, 0) == 1,
                    "newer_checkpoint_final_page_is_committed");
            if (phase == "corrupt") {
                const size_t offset = history_journal_slot_offset(5) +
                                      HISTORY_JOURNAL_HEADER_BYTES + sizeof(CyclingTracePageInfo);
                journal_sdk::flash[offset] &= 0xf0;
            }
        }
    }
    std::ofstream transport(transport_path, std::ios::binary);
    transport.write(reinterpret_cast<const char*>(journal_sdk::flash.data()),
                    static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport), "save_only_cycling_synthetic_nor_transport");
}

void restore_cycling(const char* transport_path, const std::string& phase) {
    load_synthetic_nor(transport_path);
    sdk::now_us = 250000000;
    if (phase == "future") {
        history_start();
        require(s_flash_scan_ok, "cold_future_checkpoint_indexes_flash");
        history_restore_cycling_flash(0);
        require(!s_flash_cycling.restore_done && s_flash_cycling.restore_index == 1 &&
                    !cycling_restored.count && !s_flash_cycling_runs.restore_index,
                "future_same_lineage_checkpoint_defers_to_predecessor_on_next_tick");
        history_restore_cycling_flash(0);
        require(s_flash_cycling.restore_done && s_flash_cycling.restore_index == 1,
                "previous_compatible_group_restores_on_next_tick");
    } else {
        boot(false);
    }
    require(journal_sdk::writes == 0 && journal_sdk::erases == 0,
            "cycling_restore_never_writes_or_erases");
    if (phase == "barrier" || phase == "barrier_early_shutdown" || phase == "incompatible") {
        require(cycling_restored.count == 0, "retired_checkpoint_is_not_readmitted");
        return;
    }
    require(cycling_restored.count == cycling_restored.capacity &&
                cycling_restored.end_s == kCyclingOfferEndS &&
                cycling_restored.window_end_s == CHECKUP_WINDOW_S &&
                cycling_restored.unix_s ==
                    journal_sdk::unix_origin + (phase == "shutdown" ? 10 : 0),
            "cold_restore_picks_latest_complete_checkpoint_and_keeps_its_time");
    for (uint32_t i = 0; i < cycling_restored.count; ++i)
        require(cycling_restored.at(i) == (80000 + 31 * i) * 8 + i % 7,
                "cold_restore_keeps_every_ordered_record");
}

void seed_cycling_runs(const char* transport_path, const std::string& phase) {
    boot();
    sdk::now_us        = 300000000;
    cycling_run_offers = 1;
    if (phase == "trace-torn") cycling_offer_through_s = 20;
    cycling_offer_unix_s =
        static_cast<uint32_t>(journal_sdk::unix_origin + cycling_offer_through_s);
    const auto expected_anchor =
        static_cast<uint32_t>(journal_sdk::unix_origin - kCyclingOfferLagS);
    FlashJournalRecord before_trace;
    require(!flash_build_next_cycling_runs(before_trace, 0, false),
            "run_detail_waits_for_first_trace_checkpoint");
    require(history_flash_service_journal(3, 0) == 3 && s_flash_cycling.pending &&
                !s_flash_cycling_runs.trace_through_boot_s &&
                !s_flash_cycling_runs.trace_boot_unix_s &&
                !flash_build_next_cycling_runs(before_trace, 0, false),
            "partial_trace_does_not_certify_run_coverage");
    while (history_flash_service_journal(3, 0)) {}
    require(s_flash_cycling_runs.trace_through_boot_s == cycling_offer_through_s &&
                s_flash_cycling_runs.trace_boot_unix_s == expected_anchor &&
                s_flash_cycling_runs.committed_stop_s == 20 && journal_sdk::writes == 10,
            "one_finalized_run_has_own_verified_slot_beside_four_trace_pages");
    require(journal_sdk::core_appended == 0 && s_flash_last_bucket[3] == INT64_MIN,
            "run_detail_never_updates_the_hourly_diagnosis_cursor");

    if (phase == "shutdown") {
        sdk::now_us += 10000000;
        cycling_offer_unix_s += 10;
        cycling_offer_through_s += 10;
        cycling_run_offers = 12;
        require(history_flash_service_journal(3, 0) == 0, "ordinary_run_batch_waits_four_minutes");
        core_backlog              = 13;
        journal_sdk::core_pending = true;
        journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600 - core_backlog;
        history_flash_save();
        require(s_flash_cycling_runs.committed_stop_s == 220 && journal_sdk::core_appended == 12 &&
                    journal_sdk::writes == 46,
                "shutdown_drains_two_run_pages_without_spending_ordinary_budget");
        FlashJournalRecord timeline, detail;
        require(flash_read_record(8, timeline) == ESP_OK &&
                    timeline.header.catalog_fp == CYCLING_TRACE_SCHEMA &&
                    flash_read_record(s_flash_next_slot - 2, detail) == ESP_OK &&
                    detail.header.catalog_fp == CYCLING_RUN_JOURNAL_SCHEMA &&
                    detail.header.sequence > timeline.header.sequence,
                "shutdown_run_pages_follow_last_timeline_page");
    } else if (phase == "barrier") {
        cycling_reset_token = 9;
        require(history_flash_service_journal(3, 0) == 1 && cycling_ack == 9 &&
                    !s_flash_cycling_runs.trace_through_boot_s &&
                    !s_flash_cycling_runs.trace_boot_unix_s,
                "retirement_writes_existing_x10a_fence");
        sdk::now_us += 250000000;
        cycling_offer_unix_s += 250;
        while (history_flash_service_journal(3, 0)) {}
        require(s_flash_next_sequence == 11, "fresh_compatible_trace_follows_fence");
    } else if (phase == "trace-torn") {
        constexpr int64_t step_s = HISTORY_FLASH_CYCLING_INTERVAL_S + 1;
        sdk::now_us += step_s * 1000000;
        cycling_offer_unix_s += static_cast<uint32_t>(step_s);
        cycling_offer_through_s = 120;
        cycling_run_offers      = 6;
        require(history_flash_service_journal(3, 0) == 3 && s_flash_cycling.pending &&
                    s_flash_cycling_runs.trace_through_boot_s == 20 &&
                    s_flash_cycling_runs.trace_boot_unix_s == expected_anchor,
                "new_trace_prefix_preserves_only_previous_durable_coverage");
        journal_sdk::fail_write = journal_sdk::writes + 2;
        require(history_flash_service_journal(3, 0) == 0 &&
                    s_flash_cycling_runs.trace_through_boot_s == 20 &&
                    s_flash_cycling_runs.trace_boot_unix_s == expected_anchor &&
                    !flash_build_next_cycling_runs(before_trace, 0, false) &&
                    s_flash_cycling_runs.committed_stop_s == 20,
                "torn_final_trace_page_never_admits_a_newer_run");
    } else {
        cycling_run_offers = 6;
        sdk::now_us += (HISTORY_FLASH_CYCLING_RUN_INTERVAL_S - 1) * 1000000;
        FlashJournalRecord record;
        require(!flash_build_next_cycling_runs(record, 0, false),
                "write_budget_throttles_an_available_delta");
        sdk::now_us += 1000000;
        require(flash_build_next_cycling_runs(record, 0, false),
                "new_delta_is_offered_at_budget_boundary");
        if (phase == "torn") journal_sdk::fail_write = journal_sdk::writes + 2;
        const auto written = flash_append_record(record);
        if (phase == "torn")
            require(written != ESP_OK && s_flash_cycling_runs.committed_stop_s == 20,
                    "torn_commit_does_not_acknowledge_the_next_run_batch");
        else
            require(written == ESP_OK && s_flash_cycling_runs.committed_stop_s == 120,
                    "verified_next_batch_advances_its_own_cursor");
    }

    std::ofstream transport(transport_path, std::ios::binary);
    transport.write(reinterpret_cast<const char*>(journal_sdk::flash.data()),
                    static_cast<std::streamsize>(journal_sdk::flash.size()));
    require(static_cast<bool>(transport), "save_only_run_detail_synthetic_nor_transport");
}

void restore_cycling_runs(const char* transport_path, const std::string& phase) {
    load_synthetic_nor(transport_path);
    sdk::now_us           = 600000000;
    const bool fail_retry = phase == "read-persistent";
    if (phase == "read-retry" || fail_retry) {
        history_start();
        require(s_flash_scan_ok, "cold_run_retry_indexes_flash");
        history_restore_cycling_flash(0);
        require(s_flash_cycling.restore_done, "cold_run_retry_adopts_trace");
        journal_sdk::fail_read = journal_sdk::reads + 1;
        history_restore_cycling_runs_flash();
        require(!s_flash_cycling_runs.restore_index && cycling_run_restored_starts.empty(),
                "transient_read_failure_keeps_archive_candidate");
        if (fail_retry) journal_sdk::fail_read = journal_sdk::reads + 1;
        history_restore_cycling_runs_flash();
        require(s_flash_cycling_runs.restore_index == 1 &&
                    cycling_run_restored_starts.size() == (fail_retry ? 0u : 5u),
                fail_retry ? "unreadable_archive_candidate_is_skipped_after_one_retry"
                           : "archive_candidate_restores_on_next_tick");
        history_restore_cycling_runs_flash();
    } else {
        boot(false);
    }
    require(cycling_restored.count != 0 && !journal_sdk::writes && !journal_sdk::erases,
            "cold_run_restore_reuses_existing_trace_without_writes");
    const bool     only_oldest = phase == "torn" || phase == "trace-torn" || fail_retry;
    const unsigned expected    = phase == "shutdown"  ? 11
                                 : only_oldest        ? 1
                                 : phase == "barrier" ? 0
                                                      : 6;
    require(cycling_run_restored_starts.size() == expected,
            "cold_run_restore_admits_only_verified_unfenced_batches");
    const auto anchor = static_cast<uint32_t>(journal_sdk::unix_origin - kCyclingOfferLagS);
    for (unsigned i = 0; i < expected; ++i)
        require(cycling_run_restored_starts[i] == anchor + (expected - i) * 20 - 10,
                "cold_run_restore_offers_newest_pages_first");
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

void restore_before_pending_bucket() {
    boot();
    journal_sdk::unix_origin = journal_sdk::unix_origin / HISTORY_DT_S * HISTORY_DT_S + 299;
    sdk::now_us              = 299000000;
    advance_raster_locked(sdk::now_us, 0);
    P().ring[0].ring.fold(430);

    sdk::now_us = 301500000;
    const auto stored_anchor =
        history_anchor_bucket(journal_sdk::unix_origin, 0, 0, HISTORY_DT_S, 0);
    const HistorySample stored[] = {400, 410};
    require(splice_locked(HistorySource::X10a, 0, stored, 2, 1, stored_anchor),
            "restore_splices_older_history");
    HistorySample samples[4] = {};
    HistoryMeta   meta;
    require(history_snapshot(0, samples, 4, nullptr, &meta) == 2 && meta.oldest_bucket == -2 &&
                meta.newest_age_s == 301 && meta.newest_commit_us == 0 && samples[0] == 400 &&
                samples[1] == 410,
            "restore_keeps_pending_bucket_open");
    advance_raster_locked(sdk::now_us, 1);
    require(history_snapshot(0, samples, 4, nullptr, &meta) == 3 && meta.oldest_bucket == -2 &&
                meta.newest_age_s == 1 && meta.newest_commit_us == 300000000 && samples[0] == 400 &&
                samples[1] == 410 && samples[2] == 430,
            "first_commit_preserves_restored_sample_identity");
    require(source_anchor_bucket_locked(HistorySource::X10a) == stored_anchor + 1,
            "late_first_commit_keeps_its_journal_bucket");
}
void write_nor_file(const char* nor_path) {
    FILE* out = std::fopen(nor_path, "wb");
    require(out != nullptr, "open_nor_for_write");
    const size_t written =
        std::fwrite(journal_sdk::flash.data(), 1, journal_sdk::flash.size(), out);
    std::fclose(out);
    require(written == journal_sdk::flash.size(), "write_nor_image");
}
void read_nor_file(const char* nor_path) {
    journal_sdk::flash.assign(HISTORY_FLASH_PARTITION_BYTES, 0xff);
    FILE* in = std::fopen(nor_path, "rb");
    require(in != nullptr, "open_nor_for_read");
    const size_t read_bytes =
        std::fread(journal_sdk::flash.data(), 1, journal_sdk::flash.size(), in);
    std::fclose(in);
    require(read_bytes == journal_sdk::flash.size(), "read_nor_image");
}
void seed_modbus_checkup_journal(const char* nor_path) {
    boot();
    mb_core_pending         = true;
    mb_core_bucket          = journal_sdk::unix_origin / 3600 - 1;
    mb_cycling_offer_unix_s = static_cast<uint32_t>(journal_sdk::unix_origin);
    while (history_flash_service_journal(3, 0) > 0) {}
    require(mb_core_appended == 1 && journal_sdk::core_appended == 0 &&
                s_flash_mb_checkup.last_bucket == mb_core_bucket &&
                s_flash_last_bucket[static_cast<size_t>(HistoryJournalSource::Checkup)] ==
                    INT64_MIN,
            "modbus_checkup_hour_uses_independent_cursor");
    write_nor_file(nor_path);
}
void restore_modbus_checkup_journal(const char* nor_path) {
    read_nor_file(nor_path);
    boot(false);
    require(mb_core_restore == 1 && journal_sdk::core_restore == 0 &&
                mb_cycling_restored.count == mb_cycling_restored.capacity &&
                cycling_restored.count == 0,
            "modbus_journal_restores_without_touching_x10a");

    mb_cycling_reset_token = 5;
    require(history_flash_service_journal(1, 0) == 1 && mb_cycling_ack == 5,
            "modbus_cycling_barrier_commits_without_affecting_x10a");
    write_nor_file(nor_path);
}
void verify_modbus_barrier_journal(const char* nor_path) {
    read_nor_file(nor_path);
    boot(false);
    require(mb_cycling_restored.count == 0 && mb_core_restore == 1 &&
                journal_sdk::core_restore == 0,
            "modbus_cycling_barrier_retires_prior_checkpoint");
}
void seed_fault_journal(const char* nor_path) {
    boot();
    fault_offer_unix_s    = static_cast<uint32_t>(journal_sdk::unix_origin);
    mb_fault_offer_unix_s = static_cast<uint32_t>(journal_sdk::unix_origin + 5);
    while (history_flash_service_journal(4, 0) > 0) {}
    write_nor_file(nor_path);
}
void restore_fault_journal(const char* nor_path) {
    read_nor_file(nor_path);
    boot(false);
    require(fault_restored.count == 3 && fault_restored.at(1).code == fault_code_pack("7H") &&
                fault_restored.unix_s == static_cast<uint32_t>(journal_sdk::unix_origin) &&
                mb_fault_restored.count == 3 &&
                mb_fault_restored.unix_s == static_cast<uint32_t>(journal_sdk::unix_origin + 5),
            "fault_flash_restores_x10a_and_modbus_independently");
    fault_reset_token = 9;
    require(history_flash_service_journal(1, 0) == 1 && fault_ack == 9 && mb_fault_reset_token == 0,
            "fault_barrier_retires_x10a_without_touching_modbus");
    write_nor_file(nor_path);
}
void verify_fault_barrier_journal(const char* nor_path) {
    read_nor_file(nor_path);
    boot(false);
    require(fault_restored.count == 0 && mb_fault_restored.count == 3,
            "fault_barrier_retires_x10a_while_modbus_survives");
}

void offer_dhw_window(bool is_mb, uint32_t token, uint16_t rate) {
    auto&      port                   = dhw_ports[is_mb];
    const auto uptime                 = static_cast<uint32_t>(sdk::now_us / 1000000);
    port.pending                      = token;
    port.offer                        = {};
    port.offer.model_fp               = is_mb ? mb_cycling_model : cycling_model;
    port.offer.source_fp              = is_mb ? mb_cycling_source : cycling_source;
    port.offer.dhw_source_fp          = dhw_circulation_fps[is_mb];
    port.offer.diagnostics_generation = cycling_generation;
    port.offer.unix_s                 = static_cast<uint32_t>(journal_sdk::unix_origin) + uptime;
    port.offer.count                  = 1;
    const DhwLossTraceWindow window{uptime - 3630, uptime - 30, rate, 3595, !is_mb, is_mb};
    require(dhw_loss_trace_pack(port.offer.records[0], window, uptime),
            "tank_cooling_fixture_encodes_an_exact_completed_hour");
}
void dhw_shutdown_checkpoint_after_barrier() {
    boot();
    sdk::now_us = dhw_seed_uptime_s * 1000000LL;
    offer_dhw_window(false, 9, 21);
    dhw_ports[0].pending       = 8;
    dhw_ports[0].after_barrier = 9;
    dhw_ports[0].reset_pending = true;
    core_backlog               = 13;
    journal_sdk::core_pending  = true;
    journal_sdk::core_bucket   = journal_sdk::unix_origin / 3600 - 13;

    history_flash_save();
    require(dhw_ports[0].ack == 9 && !dhw_ports[0].pending,
            "tank_cooling_shutdown_commits_replacement_after_barrier");
    require(journal_sdk::core_appended == 12 && core_backlog == 1 && journal_sdk::core_pending,
            "tank_cooling_shutdown_uses_no_ordinary_drain_slots");
    FlashJournalRecord record;
    require(flash_read_record(0, record) == ESP_OK && flash_record_physically_valid(record) &&
                record.header.catalog_fp == dhw_loss_trace_schema(false, true),
            "tank_cooling_shutdown_barrier_is_durable");
    require(flash_read_record(1, record) == ESP_OK && flash_record_physically_valid(record) &&
                record.header.catalog_fp == dhw_loss_trace_schema(false, false),
            "tank_cooling_shutdown_replacement_is_independent_committed_page");
}
void require_dhw_restored_window(bool is_mb, uint16_t rate) {
    DhwLossTimeline snapshot;
    require(dhw_ports[is_mb].restored.snapshot(snapshot, sdk::now_us, 15) && snapshot.count == 1 &&
                !snapshot.live && !snapshot.observed,
            "tank_cooling_checkpoint_restores_history_without_live_freshness");
    const auto&    window = snapshot.windows[0];
    const uint32_t now_s  = static_cast<uint32_t>(sdk::now_us / 1000000);
    require(snapshot.window_end_s - window.start_s == now_s + dhw_reboot_delay_s + 3630 &&
                snapshot.window_end_s - window.end_s == now_s + dhw_reboot_delay_s + 30 &&
                window.rate_tenths == rate && window.observed_s == 3595 &&
                window.pump_marker != is_mb && window.draw_marker == is_mb,
            "tank_cooling_restore_preserves_time_rate_coverage_and_both_markers");
}

void seed_combined_diagnostic_journal(const char* nor_path, const std::string& phase) {
    boot();
    sdk::now_us        = dhw_seed_uptime_s * 1000000LL;
    cycling_run_offers = 1;
    cycling_offer_unix_s =
        static_cast<uint32_t>(journal_sdk::unix_origin + cycling_offer_through_s);
    offer_dhw_window(false, 7, 21);
    offer_dhw_window(true, 8, 17);

    require(history_flash_service_journal(3, 0) == 3 && history_flash_service_journal(3, 0) == 3 &&
                history_flash_service_journal(3, 0) == 1,
            "combined_journal_dispatches_all_seven_pages_in_bounded_polls");
    require(s_flash_cycling_runs.committed_stop_s == 20 && dhw_ports[0].ack == 7 &&
                dhw_ports[1].ack == 8 && s_flash_next_sequence == 8 &&
                !journal_sdk::core_appended && s_flash_last_bucket[3] == INT64_MIN,
            "combined_journal_acknowledges_each_logical_owner_with_one_shared_cursor");

    if (phase == "dhw-fence") {
        dhw_ports[0].pending       = 9;
        dhw_ports[0].reset_pending = true;
        require(history_flash_service_journal(3, 0) == 1 && dhw_ports[0].ack == 9,
                "combined_journal_commits_x10a_tank_fence");
    } else if (phase == "cycling-fence") {
        cycling_reset_token = 9;
        require(history_flash_service_journal(3, 0) == 1 && cycling_ack == 9,
                "combined_journal_commits_x10a_cycling_fence");
    } else if (phase == "shutdown-run-torn") {
        sdk::now_us += 10000000;
        cycling_offer_unix_s += 10;
        cycling_offer_through_s += 10;
        cycling_run_offers         = 12;
        dhw_ports[0].pending       = 9;
        dhw_ports[0].reset_pending = true;
        core_backlog               = 13;
        journal_sdk::core_pending  = true;
        journal_sdk::core_bucket   = journal_sdk::unix_origin / 3600 - core_backlog;
        tear_run_checkpoint        = true;

        history_flash_save();
        require(dhw_ports[0].ack == 9 && !dhw_ports[0].pending,
                "failed_optional_run_does_not_preempt_pending_tank_fence");
        require(journal_sdk::core_appended == 12 && core_backlog == 1,
                "failed_optional_run_does_not_preempt_ordinary_drain");
        require(!tear_run_checkpoint && s_flash_fail_total == 1 &&
                    s_flash_cycling_runs.committed_stop_s == 20,
                "shutdown_attempts_optional_run_after_full_drain_and_rejects_torn_commit");
    }
    write_nor_file(nor_path);
}

void restore_combined_diagnostic_journal(const char* nor_path, const std::string& phase) {
    read_nor_file(nor_path);
    const auto anchor = static_cast<uint32_t>(journal_sdk::unix_origin - kCyclingOfferLagS);
    journal_sdk::unix_origin += dhw_seed_uptime_s + dhw_reboot_delay_s;
    boot(false);
    const bool     torn_run               = phase == "shutdown-run-torn";
    const unsigned expected_next_sequence = torn_run ? 25 : phase == "normal" ? 8 : 9;
    require(!journal_sdk::writes && !journal_sdk::erases &&
                s_flash_next_sequence == expected_next_sequence,
            "combined_journal_cold_scan_keeps_the_committed_head_without_writes");
    if (phase == "cycling-fence") {
        require(cycling_run_restored_starts.empty() && !cycling_restored.count,
                "combined_journal_cycling_fence_withdraws_only_its_history");
    } else {
        require(cycling_run_restored_starts.size() == 1 &&
                    cycling_run_restored_starts.front() == anchor + 10,
                "combined_journal_cold_scan_restores_dated_run_details");
    }
    if (phase == "dhw-fence" || torn_run) {
        require(!dhw_ports[0].restored.count && !dhw_ports[0].restore_calls,
                "combined_journal_tank_fence_withdraws_only_x10a_tank_history");
    } else {
        require_dhw_restored_window(false, 21);
    }
    require_dhw_restored_window(true, 17);
}

void seed_dhw_journal(const char* nor_path) {
    boot();
    sdk::now_us = dhw_seed_uptime_s * 1000000LL;
    offer_dhw_window(false, 7, 21);
    offer_dhw_window(true, 8, 17);
    require(history_flash_service_journal(2, 0) == 2 && dhw_ports[0].ack == 7 &&
                dhw_ports[1].ack == 8,
            "tank_cooling_checkpoints_commit_and_acknowledge_independently");

    sdk::now_us += 60 * 1000000LL;
    offer_dhw_window(false, 9, 30);
    journal_sdk::fail_write = journal_sdk::writes + 2; // NOR body written, commit word withheld.
    require(history_flash_service_journal(1, 0) == 0 && dhw_ports[0].pending == 9 &&
                dhw_ports[0].ack == 7,
            "torn_tank_cooling_checkpoint_keeps_revision_pending");
    write_nor_file(nor_path);
}
void restore_dhw_journal(const char* nor_path) {
    read_nor_file(nor_path);
    journal_sdk::unix_origin += dhw_seed_uptime_s + dhw_reboot_delay_s;
    journal_sdk::synced    = false;
    dhw_ports[0].confirmed = false;
    stop_observation_start(true, 11);
    history_start();
    stop_observation_bind(101, 202, 404, 7);
    history_service_flash_restore();
    require(s_flash_scan_ok && !dhw_ports[0].restore_calls && !dhw_ports[1].restore_calls,
            "tank_cooling_restore_waits_for_synchronized_wall_clock");

    journal_sdk::synced = true;
    for (unsigned i = 0; i < HISTORY_FLASH_TOTAL_RINGS / 4 + 6; ++i)
        history_service_flash_restore();
    require(s_flash_restore_done && !s_flash_dhw[0].restore_done && s_flash_dhw[1].restore_done &&
                !dhw_ports[0].restore_calls && !dhw_ports[0].restored.count,
            "tank_cooling_restore_waits_for_each_own_source");
    require_dhw_restored_window(true, 17);
    const auto reads = journal_sdk::reads;
    history_service_flash_restore();
    history_service_flash_restore();
    require(journal_sdk::reads == reads, "unconfirmed_tank_source_does_not_reread_nor");
    sdk::now_us = dhw_seed_uptime_s * 1000000LL;
    offer_dhw_window(false, 10, 12);
    require(history_flash_service_journal(1, 0) == 0 && dhw_ports[0].pending == 10,
            "tank_cooling_append_cannot_replace_checkpoint_pending_restore");
    dhw_ports[0].confirmed    = true;
    dhw_ports[0].restore_busy = true;
    history_service_flash_restore();
    const auto deferred_reads = journal_sdk::reads;
    require(dhw_ports[0].restore_calls == 1 && !s_flash_dhw[0].restore_done,
            "tank_cooling_restore_can_defer_after_read");
    dhw_ports[0].restore_busy = false;
    history_service_flash_restore();
    require(journal_sdk::reads == deferred_reads,
            "deferred_tank_restore_waits_before_rereading_nor");
    sdk::now_us += 10 * 1000000LL;
    history_service_flash_restore();
    require_dhw_restored_window(false, 21); // Incomplete newest NOR body was ignored.

    journal_sdk::synced        = false;
    dhw_ports[0].pending       = 11;
    dhw_ports[0].reset_pending = true;
    history_flash_save();
    require(dhw_ports[0].ack == 11 && !dhw_ports[0].reset_pending && !dhw_ports[1].ack,
            "tank_cooling_shutdown_commits_only_reset_barrier_without_wall_time");
    // Keep a valid head after the barrier. The damaged-barrier replay needs both records to
    // survive the next write without the shared cursor erasing their sector.
    journal_sdk::synced       = true;
    journal_sdk::core_pending = true;
    journal_sdk::core_bucket  = journal_sdk::unix_origin / 3600;
    require(history_flash_service_journal(1, 0) == 1 && journal_sdk::core_appended == 1,
            "tank_cooling_fixture_keeps_trusted_head_after_barrier");
    write_nor_file(nor_path);
}
void verify_dhw_barrier_journal(const char* nor_path) {
    read_nor_file(nor_path);
    journal_sdk::unix_origin += dhw_seed_uptime_s + dhw_reboot_delay_s;
    boot(false);
    require(s_flash_dhw[0].restore_done && !dhw_ports[0].restore_calls &&
                !dhw_ports[0].restored.count,
            "tank_cooling_committed_barrier_withdraws_older_windows");
    require_dhw_restored_window(true, 17);
}
void verify_dhw_damaged_barrier_journal(const char* nor_path) {
    read_nor_file(nor_path);
    bool damaged = false;
    for (size_t slot = 0; slot < HISTORY_JOURNAL_SLOT_COUNT; ++slot) {
        const size_t       offset = history_journal_slot_offset(slot);
        FlashJournalRecord record;
        std::memcpy(&record, journal_sdk::flash.data() + offset, sizeof(record));
        if (record.header.catalog_fp != dhw_loss_trace_schema(false, true) ||
            record.header.commit != HISTORY_JOURNAL_COMMITTED)
            continue;
        const uint64_t damaged_sequence = record.header.sequence ^ (uint64_t{1} << 63);
        std::memcpy(journal_sdk::flash.data() + offset + offsetof(HistoryJournalHeader, sequence),
                    &damaged_sequence, sizeof(damaged_sequence));
        damaged = true;
        break;
    }
    require(damaged, "tank_cooling_fixture_damages_committed_barrier_sequence");
    journal_sdk::unix_origin += dhw_seed_uptime_s + dhw_reboot_delay_s;
    boot(false);
    require(s_flash_dhw[0].restore_done && s_flash_dhw[0].damaged_barriers_fp &&
                !dhw_ports[0].restore_calls,
            "tank_cooling_damaged_barrier_withholds_older_restore");
    require_dhw_restored_window(true, 17);

    sdk::now_us = dhw_seed_uptime_s * 1000000LL;
    offer_dhw_window(false, 31, 19);
    const auto next = s_flash_next_sequence;
    require(history_flash_service_journal(1, 0) == 1 && dhw_ports[0].ack == 31 &&
                s_flash_next_sequence == next + 1 && s_flash_dhw[0].fence == 0,
            "tank_cooling_data_commits_without_trusting_corrupt_barrier_sequence");
    write_nor_file(nor_path);
}
void verify_dhw_recovered_after_damage(const char* nor_path) {
    read_nor_file(nor_path);
    journal_sdk::unix_origin += 2 * (dhw_seed_uptime_s + dhw_reboot_delay_s);
    boot(false);
    require(s_flash_dhw[0].damaged_barriers_fp && dhw_ports[0].restored.count == 1,
            "tank_cooling_new_checkpoint_restores_while_damaged_barrier_remains");
    require_dhw_restored_window(false, 19);
}
void verify_dhw_incompatible_journal(const char* nor_path) {
    read_nor_file(nor_path);
    journal_sdk::unix_origin += dhw_seed_uptime_s + dhw_reboot_delay_s;
    dhw_ports[0].scope_matches = false;
    boot(false);
    require(s_flash_dhw[0].restore_done && dhw_ports[0].restore_calls &&
                !dhw_ports[0].restored.count,
            "tank_cooling_incompatible_scope_stops_restore_without_splicing");
    require_dhw_restored_window(true, 17);
}
} // namespace
int main(int argc, char** argv) {
    const std::string name = argc >= 2 ? argv[1] : "unknown_case";
    try {
        if (name == "seed_late_correction" && argc == 3)
            seed_late_correction(argv[2]);
        else if (name == "restore_late_correction" && argc == 3)
            restore_late_correction(argv[2]);
        else if (name == "seed_modbus_checkup_journal" && argc == 3)
            seed_modbus_checkup_journal(argv[2]);
        else if (name == "restore_modbus_checkup_journal" && argc == 3)
            restore_modbus_checkup_journal(argv[2]);
        else if (name == "verify_modbus_barrier_journal" && argc == 3)
            verify_modbus_barrier_journal(argv[2]);
        else if (name == "seed_fault_journal" && argc == 3)
            seed_fault_journal(argv[2]);
        else if (name == "restore_fault_journal" && argc == 3)
            restore_fault_journal(argv[2]);
        else if (name == "verify_fault_barrier_journal" && argc == 3)
            verify_fault_barrier_journal(argv[2]);
        else if (name == "seed_dhw_journal" && argc == 3)
            seed_dhw_journal(argv[2]);
        else if (name == "restore_dhw_journal" && argc == 3)
            restore_dhw_journal(argv[2]);
        else if (name == "verify_dhw_barrier_journal" && argc == 3)
            verify_dhw_barrier_journal(argv[2]);
        else if (name == "verify_dhw_damaged_barrier_journal" && argc == 3)
            verify_dhw_damaged_barrier_journal(argv[2]);
        else if (name == "verify_dhw_recovered_after_damage" && argc == 3)
            verify_dhw_recovered_after_damage(argv[2]);
        else if (name == "verify_dhw_incompatible_journal" && argc == 3)
            verify_dhw_incompatible_journal(argv[2]);
        else if (name == "seed_cycling" && argc == 4)
            seed_cycling(argv[2], argv[3]);
        else if (name == "restore_cycling" && argc == 4)
            restore_cycling(argv[2], argv[3]);
        else if (name == "seed_cycling_runs" && argc == 4)
            seed_cycling_runs(argv[2], argv[3]);
        else if (name == "restore_cycling_runs" && argc == 4)
            restore_cycling_runs(argv[2], argv[3]);
        else if (name == "seed_combined_diagnostic_journal" && argc == 4)
            seed_combined_diagnostic_journal(argv[2], argv[3]);
        else if (name == "restore_combined_diagnostic_journal" && argc == 4)
            restore_combined_diagnostic_journal(argv[2], argv[3]);
        else if ((name == "checkup_pending_healthy" || name == "checkup_pending_forget") &&
                 argc == 3)
            checkup_pending(argv[2], name == "checkup_pending_forget");
        else if (argc != 2)
            throw std::runtime_error("unknown_case");
        else if (name == "commit_rejected")
            append_case(false, "commit");
        else if (name == "core_ahead")
            core_ahead();
        else if (name == "nor_contract")
            nor_contract();
        else if (name == "restore_before_pending_bucket")
            restore_before_pending_bucket();
        else if (name == "poll_during_shutdown_claim")
            poll_during_shutdown_claim();
        else if (name == "cycling_reset_before_last_page")
            cycling_reset_before_last_page();
        else if (name == "cycling_reset_before_trend_restore")
            cycling_reset_before_trend_restore(false);
        else if (name == "cycling_reset_after_trace_restore")
            cycling_reset_before_trend_restore(true);
        else if (name == "cycling_reset_before_time_sync")
            cycling_reset_before_time_sync();
        else if (name == "dhw_shutdown_checkpoint_after_barrier")
            dhw_shutdown_checkpoint_after_barrier();
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
