// Complete production heater Store in another TU; unchanged, explicitly scoped History bodies
// below. Flash, clocks/mutexes and unrelated source services are host recording ports.
#include "sdk.hpp"
#include "checkup.hpp"
#include "heater_context_store.hpp"
#include "hydronic_observation_store.hpp"
#include "stop_observation_store.hpp"
#include "logic/checkup_persist.hpp"
#include "logic/cycling_persist.hpp"
#include "logic/cycling_run_persist.hpp"
#include "logic/dhw_loss_persist.hpp"
#include "logic/fault_persist.hpp"
#include "rtos_guard.hpp"
#include <array>
#include <atomic>
#include <climits>
#include <cstdio>
#include <cstring>
#include <new>
#include <string>
#include <type_traits>

namespace fixture {
namespace logic = daik::logic;
namespace hc    = logic::heater_cohort;
namespace wh    = logic::heater_independent;
namespace hd    = logic::heater_context;
alignas(
    logic::HistoryJournalHeader) std::array<uint8_t, logic::HISTORY_FLASH_PARTITION_BYTES> bytes;
esp_partition_t partition{bytes.size()};
unsigned        assertions = 0, reads = 0, programs = 0, erases = 0;
unsigned        record_reads = 0, region_reads = 0;
std::array<unsigned, logic::HISTORY_JOURNAL_SLOT_COUNT> reads_by_slot{};
unsigned core_acks = 0, stop_acks = 0, manifest_acks = 0;
int      fail_record_slot   = -1;
bool     fail_next_readback = false, corrupt_next_commit = false, error_after_next_commit = false;
void (*before_readback)()    = nullptr;
void (*record_read_hook)()   = nullptr;
unsigned record_read_hook_at = 0;
uint32_t expected_source = 101, expected_consent = 11;
bool     offer_legacy     = false;
bool     busy_after_erase = false, fail_next_erase = false;
enum class DispatchProbe : uint8_t { Disabled, Built, OrdinaryFalse, Future };
DispatchProbe dispatch_probe = DispatchProbe::Disabled;
unsigned      provider_calls[3]{}, provider_returns[3]{}, provider_active = 0, cursor_logs = 0;
size_t        provider_source = SIZE_MAX, cursor_log_source = SIZE_MAX;
TickType_t    provider_wait   = 0;
int64_t       provider_cursor = 12345, provider_bound = 12000;
int64_t       cursor_log_cursor = 0, cursor_log_bound = 0;
void          require(bool value, const char* oracle) {
    ++assertions;
    if (!value) throw std::runtime_error(oracle);
}
} // namespace fixture

esp_err_t esp_partition_read(const esp_partition_t* part, size_t offset, void* into, size_t count) {
    using namespace fixture;
    if (sdk::store_mutex && sdk::store_mutex->owned)
        throw std::runtime_error("physical Reader runs outside heater owner mutex");
    ++reads;
    if (part != &partition || !into || offset > bytes.size() || count > bytes.size() - offset)
        return ESP_ERR_INVALID_ARG;
    if (count == logic::HISTORY_JOURNAL_SLOT_BYTES) {
        ++record_reads;
        ++reads_by_slot[offset / logic::HISTORY_JOURNAL_SLOT_BYTES];
        sdk::now_us += sdk::record_read_cost_us;
        if (record_read_hook && record_reads == record_read_hook_at) {
            const auto hook  = record_read_hook;
            record_read_hook = nullptr;
            hook();
        }
    } else
        ++region_reads;
    if (count == logic::HISTORY_JOURNAL_SLOT_BYTES &&
        int(offset / logic::HISTORY_JOURNAL_SLOT_BYTES) == fail_record_slot)
        return ESP_FAIL;
    if (programs && count == logic::HISTORY_JOURNAL_SLOT_BYTES && before_readback) {
        const auto hook = before_readback;
        before_readback = nullptr;
        hook();
    }
    if (programs && count == logic::HISTORY_JOURNAL_SLOT_BYTES && fail_next_readback) {
        fail_next_readback = false;
        return ESP_FAIL;
    }
    std::memcpy(into, bytes.data() + offset, count);
    return ESP_OK;
}

esp_err_t esp_partition_write(const esp_partition_t* part, size_t offset, const void* from,
                              size_t count) {
    using namespace fixture;
    ++programs;
    if (part != &partition || !from || offset > bytes.size() || count > bytes.size() - offset)
        return ESP_ERR_INVALID_ARG;
    const auto* input = static_cast<const uint8_t*>(from);
    for (size_t i = 0; i < count; ++i)
        if ((bytes[offset + i] & input[i]) != input[i]) return ESP_ERR_INVALID_STATE;
    for (size_t i = 0; i < count; ++i) bytes[offset + i] &= input[i];
    const bool commit =
        count == sizeof(uint32_t) &&
        offset % logic::HISTORY_JOURNAL_SLOT_BYTES == offsetof(logic::HistoryJournalHeader, commit);
    if (commit && corrupt_next_commit) {
        corrupt_next_commit = false;
        const size_t start  = offset - offsetof(logic::HistoryJournalHeader, commit);
        bytes[start + logic::HISTORY_JOURNAL_HEADER_BYTES] &= uint8_t(~2u);
    }
    if (commit && error_after_next_commit) {
        error_after_next_commit = false;
        return ESP_FAIL; // the actual readback, not this reported error, decides acceptance
    }
    return ESP_OK;
}

esp_err_t esp_partition_erase_range(const esp_partition_t* part, size_t offset, size_t count) {
    using namespace fixture;
    ++erases;
    if (part != &partition || offset % logic::HISTORY_FLASH_ERASE_BYTES ||
        count != logic::HISTORY_FLASH_ERASE_BYTES || offset > bytes.size() ||
        count > bytes.size() - offset)
        return ESP_ERR_INVALID_ARG;
    const bool failed = fail_next_erase;
    fail_next_erase   = false;
    if (!failed) std::memset(bytes.data() + offset, 0xff, count);
    if (busy_after_erase) {
        busy_after_erase = false;
        sdk::store_busy  = true;
    }
    return failed ? ESP_FAIL : ESP_OK;
}

namespace daik {
#ifdef HEATER_JOURNAL_LEGACY_SECTOR_CALLBACK
// Before-only port: the frozen old owner had only generic invalidation.
void heater_context_flash_sector_erased(uint16_t) { heater_context_flash_index_invalidate(); }
#endif
bool time_synced() { return sdk::synced; }
void time_now(int64_t& seconds, int32_t& milliseconds) {
    const int64_t wall = sdk::origin_us + sdk::now_us;
    seconds            = wall / 1000000;
    milliseconds       = int32_t(wall % 1000000 / 1000);
}
void diag_printf(const char*, ...) {
} // bounded log sink, no formatting/heap or hidden device access
void checkup_flash_appended(int64_t, DiagnosticsSource) { ++fixture::core_acks; }
bool checkup_cycling_reset_pending(DiagnosticsSource) { return false; }
bool checkup_fault_reset_pending(DiagnosticsSource) { return false; }
bool checkup_dhw_trace_reset_pending(DiagnosticsSource) { return false; }
void stop_observation_flash_appended(int64_t, uint64_t, uint16_t,
                                     const logic::ObservationHourlyPayload&) {
    ++fixture::stop_acks;
}
void stop_observation_flash_failed() {}
void stop_observation_flash_service(StopObservationReader) {}
void hydronic_observation_flash_appended(int64_t, uint64_t, uint16_t,
                                         const logic::HydronicHourlyPayload&) {}
void hydronic_observation_flash_failed() {}
void hydronic_observation_flash_service(HydronicObservationReader) {}
} // namespace daik

namespace journal {
using namespace daik;
using namespace daik::logic;
using Lock = SemGuard;
#include "history_geometry.hpp"
#include "history_source.hpp"
#include "history_state.hpp"
#include "history_failure_state.hpp"
#include "history_future_note.hpp"
alignas(FlashJournalRecord) uint8_t s_flash_sector[HISTORY_FLASH_ERASE_BYTES];
bool s_flash_ahead_logged[kJournalServiceSources]{};

// Explicitly excluded source services. Their calls remain visible and fail closed unless a
// test offers a bounded ordinary X10A record solely to compete with the real heater producer.
struct FlashManifestCache {};
bool flash_manifest_cache_add(const FlashJournalRecord&) {
    ++fixture::manifest_acks;
    return false;
}
bool flash_trend_scope_matches(const HistoryJournalHeader&) { return false; }
bool flash_current_layout_matches(const HistoryJournalHeader&) { return false; }
const FlashManifestCache* flash_manifest_find(const HistoryJournalHeader&) { return nullptr; }
bool flash_read_stop_observation(uint16_t, int64_t&, uint64_t&, ObservationHourlyPayload&) {
    return false;
}
HydronicReadResult flash_read_hydronic_observation(uint16_t, int64_t&, uint64_t&,
                                                   HydronicHourlyPayload&) {
    return HydronicReadResult::Invalid;
}
void flash_hydronic_appended(const FlashJournalRecord&, uint16_t) {}
void flash_cycling_appended(uint16_t, uint64_t, bool) {}
void flash_fault_appended(bool) {}
void flash_dhw_appended(const HistoryJournalHeader&, bool) {}
bool flash_build_next_hydronic_observation(FlashJournalRecord&) { return false; }
bool flash_build_next_cycling_runs(FlashJournalRecord&, TickType_t, bool) { return false; }
bool flash_build_next_cycling(FlashJournalRecord&, TickType_t, bool, bool) { return false; }
bool flash_build_next_fault(FlashJournalRecord&, TickType_t, bool, bool) { return false; }
bool flash_build_next_dhw(FlashJournalRecord&, TickType_t, bool) { return false; }
void history_restore_cycling_flash(TickType_t) {}
void history_restore_fault_flash(TickType_t) {}
void history_restore_dhw_flash(TickType_t) {}
struct ProviderObservation {
    unsigned provider;
    ProviderObservation(unsigned which, size_t source, TickType_t wait) : provider(which) {
        fixture::require(sdk::flash_mutex.owned, "dispatcher provider keeps the sole Flash owner");
        ++fixture::provider_calls[provider];
        ++fixture::provider_active;
        fixture::provider_source = source;
        fixture::provider_wait   = wait;
    }
    ~ProviderObservation() {
        --fixture::provider_active;
        ++fixture::provider_returns[provider];
    }
};
bool probe_provider(FlashJournalRecord& record, FutureCursorNote* note) {
    if (fixture::dispatch_probe == fixture::DispatchProbe::Future && note) {
        note->future = true;
        note->cursor = fixture::provider_cursor;
        note->bound  = fixture::provider_bound;
    }
    if (fixture::dispatch_probe != fixture::DispatchProbe::Built) return false;
    record.header.sequence = 777; // recording-port marker, never a physical record
    return true;
}
bool flash_build_next_stop_observation(FlashJournalRecord& record) {
    if (fixture::dispatch_probe == fixture::DispatchProbe::Disabled) return false;
    ProviderObservation observation(0, kStopObservationSource, 0);
    return probe_provider(record, nullptr);
}
bool flash_build_next_checkup_record(FlashJournalRecord& record, TickType_t wait,
                                     FutureCursorNote& note, bool is_modbus = false) {
    if (fixture::dispatch_probe == fixture::DispatchProbe::Disabled) return false;
    ProviderObservation observation(
        1, is_modbus ? kCheckupModbusSource : size_t(HistoryJournalSource::Checkup), wait);
    return probe_provider(record, &note);
}
void flash_note_cursor_ahead(size_t source, const FutureCursorNote& note) {
    fixture::require(sdk::flash_mutex.owned && fixture::provider_active == 0 &&
                         fixture::provider_calls[0] == fixture::provider_returns[0] &&
                         fixture::provider_calls[1] == fixture::provider_returns[1] &&
                         fixture::provider_calls[2] == fixture::provider_returns[2],
                     "future log follows every completed provider observation");
    ++fixture::cursor_logs;
    fixture::cursor_log_source = source;
    fixture::cursor_log_cursor = note.cursor;
    fixture::cursor_log_bound  = note.bound;
}
bool flash_manifest_due(HistorySource, int64_t) { return false; }
bool flash_build_manifest_record(HistorySource, int64_t, FlashJournalRecord&) {
    throw std::runtime_error("excluded manifest builder was called");
}

void raw_record(FlashJournalRecord& record, uint64_t sequence, int64_t bucket, uint32_t fingerprint,
                uint16_t words, HistoryJournalSource source = HistoryJournalSource::Checkup) {
    std::memset(&record, 0xff, sizeof(record));
    auto& h       = record.header;
    h.magic       = HISTORY_JOURNAL_MAGIC;
    h.version     = HISTORY_JOURNAL_VERSION;
    h.source      = uint8_t(source);
    h.flags       = 0;
    h.catalog_fp  = fingerprint;
    h.crc         = 0;
    h.commit      = HISTORY_JOURNAL_ERASED;
    h.value_count = words;
    h.slot_bytes  = HISTORY_JOURNAL_SLOT_BYTES;
    h.sequence    = sequence;
    h.bucket      = bucket;
    h.dt_s        = source == HistoryJournalSource::Checkup ? CHECKUP_DT_S : HISTORY_DT_S;
    h.rings[0]    = TREND_COUNT;
    h.rings[1]    = HOMEHUB_HISTORY_COUNT;
    h.rings[2]    = ENV3_HISTORY_COUNT;
    h.reserved    = 0xffff;
    if (source == HistoryJournalSource::X10a || source == HistoryJournalSource::Modbus) {
        h.flags = HISTORY_JOURNAL_FLAG_TARGET_SCOPED;
        history_journal_set_scope(h, 404);
    }
    std::memset(record.payload, 0, size_t(words) * 2);
    h.crc = history_journal_crc_bytes(h, record.payload, size_t(words) * 2);
}

bool flash_build_next_record(HistorySource source, FlashJournalRecord& out, TickType_t wait,
                             FutureCursorNote& note) {
    if (fixture::dispatch_probe != fixture::DispatchProbe::Disabled) {
        ProviderObservation observation(2, size_t(source), wait);
        return probe_provider(out, &note);
    }
    if (!fixture::offer_legacy || source != HistorySource::X10a) return false;
    raw_record(out, s_flash_next_sequence, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
    return true;
}

#include "history_checkup_owned.hpp"
#include "body_0.hpp"
#include "body_1.hpp"
#include "body_2.hpp"
#include "body_3.hpp"
#include "body_4.hpp"
#include "body_5.hpp"
#include "body_6.hpp"
#include "body_7.hpp"
#include "body_8.hpp"
#include "body_9.hpp"
#include "body_10.hpp"
#include "body_11.hpp"
#include "body_16.hpp"
#include "body_17.hpp"
#include "body_12.hpp"
#include "body_13.hpp"
#include "body_15.hpp"
static size_t history_flash_service_journal(size_t max_records, TickType_t wait_ticks,
                                            bool shutdown = false);
#include "body_14.hpp"
} // namespace journal

namespace fixture {
using namespace daik;
using namespace journal;
static_assert(HEATER_CONTEXT_FLASH_MAX_READS == 256, "reviewed per-slice read ceiling");
static_assert(HEATER_CONTEXT_FLASH_SLICE_US == 5000, "reviewed soft inter-read deadline");
static_assert(HEATER_CONTEXT_FLASH_RETRY_US == 1000000, "reviewed IO retry backoff");

int64_t      wall_bucket() { return (sdk::origin_us + sdk::now_us) / hc::HOUR_US; }
hc::Identity identity() { return {expected_source, 202, 303, expected_consent, 0}; }

void settle_store() {
    // Setup explicitly drives bounded call steps. Zero-duration host reads do not require
    // moving an already admitted clock backwards. This is not a production per-tick budget.
    constexpr size_t passes = 2 * HISTORY_JOURNAL_SLOT_COUNT / 256 + 8;
    unsigned         idle   = 0;
    for (size_t pass = 0; pass < passes; ++pass) {
        const unsigned before = record_reads;
        heater_context_flash_service(flash_read_heater_context, 256);
        if (record_reads == before) {
            if (++idle == 2) return;
        } else
            idle = 0;
    }
    throw std::runtime_error("explicit bounded setup scan did not settle");
}

void boot_store(bool initial = false, bool settle = true) {
    require(sdk::lock_depth == 0, "startup has no producer or flash lock");
    if (initial) {
        bytes.fill(0xff);
        s_flash_part    = &partition;
        s_flash_mtx     = &sdk::flash_mutex;
        s_flash_scan_ok = s_flash_restore_done = s_flash_checkup_restore_done = true;
        s_flash_service_source = kHeaterContextSource;
        s_flash_next_sequence  = 1;
        s_flash_next_slot      = 0;
    } else {
        const int64_t wall = sdk::origin_us + sdk::now_us;
        sdk::now_us        = 1000000;
        sdk::origin_us     = wall - sdk::now_us;
    }
    heater_context_start(true, expected_consent);
    heater_context_bind(expected_source, 202, 303, 7, hd::ALL, 3);
    if (settle) settle_store();
}

hd::Sample active_sample() {
    hd::Sample sample;
    sample.heater[0] = sample.heater[1] = hd::Bit::On;
    sample.emergency = sample.error = sample.defrost = sample.silent = hd::Bit::Off;
    sample.dhw = sample.compressor_off = hd::Bit::Off;
    sample.mode                        = CheckupOperatingMode::Heating;
    sample.outdoor_known               = true;
    sample.outdoor_source              = OutdoorSource::X10a;
    sample.outdoor_tenths              = 30;
    return sample;
}

void sample_at(int64_t seconds) {
    sdk::now_us = seconds * 1000000;
    heater_context_record(sdk::now_us, active_sample());
}

void queue_hour() {
    sample_at(2);
    sample_at(12);
    sdk::now_us = 3600000000LL;
    heater_context_expire(); // only a genuinely closed hour becomes eligible
}

void require_core_untouched() {
    const size_t source = size_t(HistoryJournalSource::Checkup);
    require(core_acks == 0 && stop_acks == 0 && manifest_acks == 0 &&
                s_flash_last_bucket[source] == INT64_MIN &&
                s_flash_newest_bucket[source] == INT64_MIN,
            "heater kinds never ACK or advance the legacy core cursor");
}

void append_piece() {
    FlashJournalRecord record;
    require(flash_build_next_heater_context(record), "real heater builder offers current piece");
    require(flash_append_record(record) == ESP_OK, "actual physical append and readback succeed");
    require_core_untouched();
}

wh::Data read_data(uint16_t slot) {
    hc::View view;
    require(flash_read_heater_context(slot, view) && wh::typed(view, wh::Kind::Data),
            "independent data uses actual physical slot and normalized CRC");
    wh::Data data;
    require(wh::decode_data_into(view.payload, wh::DATA_BYTES, data) && view.payload[0] == 3,
            "atomic Method3 data192 decodes without a cohort descriptor");
    return data;
}

void seed_record(uint16_t slot, FlashJournalRecord& record) {
    record.header.commit = HISTORY_JOURNAL_COMMITTED;
    require(flash_record_physically_valid(record),
            "preexisting fixture record has real normalized CRC");
    std::memcpy(bytes.data() + history_journal_slot_offset(slot), &record, sizeof(record));
}

void seed_fence(uint16_t slot, uint64_t sequence, int64_t bucket, bool torn = false) {
    wh::Fence fence;
    fence.sequence = sequence;
    fence.identity = identity();
    fence.reason   = 1;
    FlashJournalRecord record;
    raw_record(record, sequence, bucket, wh::fingerprint(hc::Kind::Fence), wh::FENCE_BYTES / 2);
    require(wh::encode_fence(fence, record.payload, wh::FENCE_BYTES), "fixture fence encodes");
    record.header.crc = history_journal_crc_bytes(record.header, record.payload, wh::FENCE_BYTES);
    seed_record(slot, record);
    if (torn) {
        std::memset(bytes.data() + history_journal_slot_offset(slot) +
                        offsetof(HistoryJournalHeader, commit),
                    0xff, sizeof(uint32_t));
        // Setup a retained preexisting torn record, not a flash program.
    }
}

void seed_hours(uint16_t first_slot, uint64_t first_sequence, int64_t bucket) {
    hd::State state;
    hd::Hour  hour;
    hd::step(state, hour, 1000000, 7, 303, 3, hd::ALL, active_sample());
    hd::step(state, hour, 2000000, 7, 303, 3, hd::ALL, active_sample());
    for (uint8_t heater = 0; heater < 2; ++heater) {
        wh::Data data;
        data.identity     = identity();
        data.first        = 1000000;
        data.last         = 2000000;
        data.counters     = hour.heater[heater];
        data.heater       = heater;
        data.required     = 3;
        data.capabilities = hd::ALL;
        FlashJournalRecord record;
        raw_record(record, first_sequence + heater, bucket, wh::fingerprint(wh::Kind::Data),
                   wh::DATA_BYTES / 2);
        require(wh::encode_data(data, record.payload, wh::DATA_BYTES),
                "fixture independent hour encodes");
        record.header.crc =
            history_journal_crc_bytes(record.header, record.payload, wh::DATA_BYTES);
        seed_record(first_slot + heater, record);
    }
}

HeaterContextErasePermission settle_permission(uint16_t first) {
    for (size_t step = 0; step < HISTORY_JOURNAL_SLOT_COUNT / 256 + 8; ++step) {
        const auto result = heater_context_flash_erase_permission(flash_read_heater_context, first);
        if (result != HeaterContextErasePermission::Pending) return result;
    }
    throw std::runtime_error("bounded explicit keeper proof did not settle");
}

void clear_read_measurement() {
    reads = record_reads = region_reads = 0;
    reads_by_slot.fill(0);
}

void cohort_actual_slots() {
    boot_store(true);
    queue_hour();
    s_flash_next_slot                     = 5;
    bytes[history_journal_slot_offset(5)] = 0;
    append_piece();
    append_piece();
    const auto a = read_data(16), b = read_data(17);
    require(a.heater == 0 && b.heater == 1 && a.counters.on_us == 10000000 &&
                b.counters.on_us == 10000000,
            "independent complete heater leaves occupy actual slots after abandonment");
    require(s_flash_next_sequence == 3, "one global sequence per atomic heater leaf");
    for (uint16_t slot : {uint16_t(16), uint16_t(17)}) {
        FlashJournalRecord stored;
        require(flash_read_record(slot, stored) == ESP_OK && !flash_record_valid(stored) &&
                    wh::kind(stored.header) == wh::Kind::Data && stored.header.value_count == 96,
                "atomic heater leaves are excluded from legacy core restore");
    }
    boot_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 0 && status.on_us[1] == 0 && (status.flags & hc::Incomplete),
            "retained unidentifiable torn bytes keep restoration explicitly incomplete");
}

void service_pins_across_ticks() {
    boot_store(true);
    queue_hour();
    offer_legacy = true;
    require(history_flash_service_journal(1, 0) == 1, "one real journal append per bounded tick");
    require(read_data(0).heater == 0, "first independent heater ACKs without waiting for BSH");
    require(!s_flash_heater_pinned && !heater_context_flash_claim_pending(),
            "a complete one-piece hour releases its claim after actual ACK");
    require(history_flash_service_journal(1, 0) == 1,
            "ordinary writer may interleave independent hours");
    FlashJournalRecord ordinary;
    require(flash_read_record(1, ordinary) == ESP_OK &&
                ordinary.header.source == uint8_t(HistoryJournalSource::X10a),
            "independent ACK permits ordinary source fairness");
    require(history_flash_service_journal(1, 0) == 1 && read_data(2).heater == 1 &&
                s_flash_next_sequence == 4,
            "second heater retains its own counters across an ordinary sequence");
    require_core_untouched();
}

void protected_sector(const std::string& name) {
    boot_store(true);
    seed_fence(0, 4, wall_bucket() - 30, name == "protected_torn_sector");
    if (name == "protected_corrupt_sector") bytes[HISTORY_JOURNAL_HEADER_BYTES] ^= 1;
    if (name == "protected_read_failure") fail_record_slot = 0;
    FlashJournalRecord legacy;
    raw_record(legacy, 1, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
    const auto program_before = programs, erase_before = erases;
    require(flash_append_record(legacy) == ESP_ERR_NOT_FINISHED && s_flash_retention_yield &&
                s_flash_next_slot == HISTORY_JOURNAL_SLOTS_PER_SECTOR &&
                programs == program_before && erases == erase_before,
            "damaged torn or unreadable guard yields one protected sector without a write");
    require(s_flash_fail_total == 0 && s_flash_fail_skipped == 0 && !s_flash_fail_episode,
            "known unwritten retention yield is not an IO failure episode");
}

void sequence_exhaustion() {
    boot_store(true);
    queue_hour();
    s_flash_next_sequence = UINT64_MAX;
    FlashJournalRecord record;
    require(!flash_build_next_heater_context(record),
            "exhaustion cannot claim an independent hour");
    raw_record(record, UINT64_MAX, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
    size_t slot = 0;
    require(flash_append_record_at(record, slot) == ESP_ERR_INVALID_STATE && programs == 0 &&
                erases == 0,
            "exhausted sequence fails before slot preparation erase or program");
    s_flash_next_sequence = UINT64_MAX - 1;
    require(history_flash_service_journal(3, 0) == 1 && programs == 2 &&
                s_flash_next_sequence == UINT64_MAX,
            "one final atomic hour may commit without wrapping or consuming another sequence");
    require(read_data(0).heater == 0 && !flash_build_next_heater_context(record),
            "the other heater remains unwritten at exact sequence exhaustion");
}

void inflight_sector_deferral() {
    boot_store(true);
    queue_hour();
    FlashJournalRecord staged;
    require(flash_build_next_heater_context(staged), "independent immutable data claim staged");
    const auto piece = s_flash_heater_piece;
    bytes[0]         = 0;
    require(flash_append_record(staged) == ESP_ERR_NOT_FINISHED && s_flash_heater_pinned &&
                programs == 0,
            "opaque target defers the exact data claim without programming");
    require(esp_partition_erase_range(&partition, 0, HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
            "fixture removes a known test-only opaque sector before reproof");
    heater_context_flash_index_invalidate();
    offer_legacy = true;
    clear_read_measurement();
    require(history_flash_service_journal(1, 0) == 0 && s_flash_heater_pinned &&
                heater_context_flash_claim_pending() && s_flash_next_sequence == piece.sequence &&
                reads == 0,
            "false next with proof pending retains pin and sequence against ordinary writer");
    unsigned slices = 0;
    while (heater_context_status().restore_pending && slices < 80) {
        const auto before = record_reads;
        flash_progress_heater_context();
        ++slices;
        require(record_reads > before && record_reads - before <= 256,
                "positive restore leaf progresses even while History is pinned");
        if (heater_context_status().restore_pending) {
            const auto before_writer = record_reads;
            require(history_flash_service_journal(1, 0) == 0 && record_reads == before_writer &&
                        s_flash_heater_pinned && s_flash_next_sequence == piece.sequence &&
                        programs == 0,
                    "zero-budget competing writer cannot consume a reproof reservation");
        }
    }
    require(slices > 1 && !heater_context_status().restore_pending,
            "reproof requires several bounded slices");
    FlashJournalRecord again;
    require(flash_build_next_heater_context(again) &&
                !std::memcmp(&staged, &again, sizeof(staged)) &&
                s_flash_heater_piece.token == piece.token &&
                s_flash_heater_piece.sequence == piece.sequence,
            "deferred erase reproof preserves exact bytes token sequence and ACK identity");
    require(flash_append_record(again) == ESP_OK && !heater_context_flash_claim_pending(),
            "reproved immutable leaf receives exactly one real physical ACK");
    require(s_flash_next_sequence == piece.sequence + 1 && read_data(16).heater == 0,
            "only successful ACK consumes the reserved sequence");
    append_piece();
    boot_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 10000000 && status.on_us[1] == 10000000,
            "independent data restores each heater exactly once after deferred erase reproof");
}

void bad_data_readback(bool unreadable = false) {
    boot_store(true);
    queue_hour();
    if (unreadable)
        fail_next_readback = true;
    else
        corrupt_next_commit = true;
    FlashJournalRecord record;
    require(flash_build_next_heater_context(record), "data leaf staged before readback fault");
    require(flash_append_record(record) != ESP_OK && !s_flash_heater_pinned &&
                !heater_context_flash_claim_pending(),
            "failed physical readback aborts the independent claim");
    boot_store();
    const auto status = heater_context_status();
    if (unreadable)
        require(status.on_us[0] == 10000000 && status.on_us[1] == 0,
                "uncertain readback may restore its actually valid atomic leaf exactly once");
    else
        require(status.on_us[0] == 0 && status.on_us[1] == 0 && (status.flags & hc::Incomplete),
                "CRC damaged independent data cannot restore a counter");
}

void accepted_program_error() {
    boot_store(true);
    queue_hour();
    error_after_next_commit = true;
    append_piece();
    require(!heater_context_flash_claim_pending() &&
                !(heater_context_status().flags & hc::Incomplete),
            "exact physical readback ACK releases only its matching claim");
    append_piece();
    require(s_flash_next_sequence == 3 && !s_flash_fail_episode,
            "valid independent readback accepts a reported program error once");
    boot_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 10000000 && status.on_us[1] == 10000000,
            "reported program error does not duplicate independently restored counters");
    heater_context_reset();
    heater_context_bind(expected_source, 202, 303, 7, hd::ALL, 3, false);
    append_piece();
    FlashJournalRecord fence;
    require(flash_read_record(2, fence) == ESP_OK && wh::kind(fence.header) == wh::Kind::Fence &&
                fence.header.value_count == 16 && fence.payload[0] == 3 &&
                !flash_record_valid(fence),
            "Method3 fence32 is physical but excluded from legacy core cursor");
}

void core_cursor_control() {
    boot_store(true);
    FlashJournalRecord core;
    raw_record(core, 1, wall_bucket(), checkup_journal_fingerprint(), CHECKUP_JOURNAL_WORDS);
    require(flash_append_record(core) == ESP_OK && core_acks == 1 &&
                s_flash_last_bucket[size_t(HistoryJournalSource::Checkup)] == wall_bucket(),
            "ordinary core cursor ACK recording port is live in the same append body");
}

void owner_interleave(const std::string& name) {
    boot_store(true);
    queue_hour();
    if (name == "source_interleave")
        before_readback = [] {
            expected_source = 909;
            heater_context_bind(expected_source, 202, 303, 8, hd::ALL, 3, false);
        };
    else if (name == "consent_interleave")
        before_readback = [] {
            heater_context_set_diagnostics(false, 11);
            expected_consent = 12;
            heater_context_set_diagnostics(true, expected_consent);
            heater_context_bind(expected_source, 202, 303, 7, hd::ALL, 3, false);
        };
    else
        before_readback = [] {
            sdk::origin_us += 3000000;
            heater_context_expire();
        };
    append_piece();
    FlashJournalRecord next;
    if (flash_build_next_heater_context(next))
        require(wh::kind(next.header) == wh::Kind::Fence,
                "retired in-flight data yields only a retirement fence");
    const auto status = heater_context_status();
    require(status.on_us[0] == 0 && status.on_us[1] == 0,
            "source consent or observed clock cutover rejects old receipt and counters");
}

void keeper_fence_outside_records() {
    boot_store(true);
    const int64_t old_bucket = wall_bucket() - 30;
    seed_hours(32, 1, old_bucket);
    seed_fence(0, 4, old_bucket);
    s_flash_next_sequence = 5;
    FlashJournalRecord legacy;
    raw_record(legacy, 5, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
    require(flash_append_record(legacy) == ESP_ERR_NOT_FINISHED && programs == 0 && erases == 0,
            "aged keeper fence survives while lower sequences remain in another sector");
    require(settle_permission(0) == HeaterContextErasePermission::Protected,
            "outside lower sequences keep the fully checked fence sector protected");
    require(esp_partition_erase_range(&partition, history_journal_slot_offset(32),
                                      HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
            "fixture physically retires every outside lower-sequence record");
    heater_context_flash_index_invalidate();
    s_flash_next_slot = 0;
    require(settle_permission(0) == HeaterContextErasePermission::Allowed,
            "removal of all outside lower sequences permits a fresh completed proof");
    require(flash_append_record(legacy) == ESP_OK && erases == 2 && programs == 2,
            "keeper sector may erase only after all lower physical records disappeared");
}

void late_revision_deferred_bytes() {
    boot_store(true);
    sample_at(3597);
    sample_at(3598);
    sdk::now_us = 3600000000LL;
    heater_context_expire();
    append_piece();  // acknowledged complete BUH base is already authoritative in warm RAM
    sample_at(3602); // 2s old hour plus2s live new hour; never add acknowledged base twice
    require(heater_context_status().on_us[0] == 5000000 &&
                heater_context_status().on_us[1] == 5000000,
            "warm acknowledged cumulative hour plus new RAM delta remains exact");
    FlashJournalRecord revised;
    require(flash_build_next_heater_context(revised), "late closed-hour revision is offered");
    wh::Data data;
    require(wh::decode_data_into(revised.payload, wh::DATA_BYTES, data) && data.heater == 0 &&
                data.counters.on_us == 3000000,
            "revision is a full cumulative independent hour not an additive delta");
    s_flash_next_slot                      = 16;
    bytes[history_journal_slot_offset(16)] = 0;
    const auto saved                       = revised;
    const auto token                       = s_flash_heater_piece.token;
    require(flash_append_record(revised) == ESP_ERR_NOT_FINISHED,
            "late revision defers before programming opaque target");
    require(esp_partition_erase_range(&partition, history_journal_slot_offset(16),
                                      HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
            "fixture clears test-only torn sector before reproof");
    heater_context_flash_index_invalidate();
    settle_store();
    FlashJournalRecord again;
    require(flash_build_next_heater_context(again) && !std::memcmp(&saved, &again, sizeof(saved)) &&
                s_flash_heater_piece.token == token,
            "deferred revision reoffers identical full bytes without remerging acknowledged base");
    require(flash_append_record(again) == ESP_OK, "revised BUH leaf gets actual ACK");
    append_piece();
    boot_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 3000000 && status.on_us[1] == 3000000,
            "cold latest independent revision replaces predecessor without double counting or lost "
            "RAM resurrection");
}

void bounded_tick_budget() {
    boot_store(true, false);
    for (uint16_t slot = 0; slot < HISTORY_JOURNAL_SLOTS_PER_SECTOR; ++slot)
        seed_fence(slot, slot + 1, wall_bucket() - 30);
    heater_context_flash_index_invalidate();
    clear_read_measurement();
    flash_progress_heater_context(); // exact production leaf used by the real restore entry
    require(record_reads > 0 && record_reads <= 256,
            "one explicit restore progress slice respects the256-read ceiling");
    const auto pending = heater_context_status();
    require(pending.restore_pending && !(pending.flags & (hc::Clock | hc::Incomplete)),
            "healthy partial scan reports pending without a corruption or clock claim");
    const unsigned after_progress = record_reads;
    for (unsigned call = 0; call < 4; ++call) {
        heater_context_flash_service(flash_read_heater_context, 0);
        require(history_flash_service_journal(3, 0) == 0,
                "an empty pending archive creates no journal writes");
    }
    require(record_reads == after_progress,
            "zero-budget writer calls do not multiply archive progress");
    FlashJournalRecord legacy;
    raw_record(legacy, 17, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
    s_flash_next_sequence = 17;
    require(flash_append_record(legacy) == ESP_ERR_NOT_FINISHED && s_flash_next_slot == 0,
            "same tick may start one keeper slice while archive scanning is partial");
    require(record_reads > after_progress && record_reads <= after_progress + 256,
            "composed tick adds at most one separate keeper slice to its archive budget");
    require(programs == 0 && erases == 0, "archive progress remains read-only");
}

void seed_fence_sector() {
    const int64_t bucket = wall_bucket() - 30;
    for (uint16_t slot = 0; slot < HISTORY_JOURNAL_SLOTS_PER_SECTOR; ++slot)
        seed_fence(slot, slot + 1, bucket);
    heater_context_flash_index_invalidate();
    settle_store(); // finish ordinary index setup before measuring the independent keeper proof
}

void keeper_pending_cursor() {
    boot_store(true);
    seed_fence_sector();
    queue_hour();
    s_flash_next_sequence = 17;
    s_flash_next_slot     = 0;
    FlashJournalRecord data;
    require(flash_build_next_heater_context(data), "post-fence independent data stages");
    const auto staged = data;
    clear_read_measurement();
    flash_progress_heater_context();
    const auto progress = record_reads;
    require(flash_append_record(data) == ESP_ERR_NOT_FINISHED && s_flash_retention_yield &&
                s_flash_next_slot == 0 && s_flash_heater_pinned && programs == 0 && erases == 0,
            "pending keeper proof retains the same cursor without a write");
    require(record_reads <= progress + 256 && progress <= 256,
            "one tick spends one archive and one keeper slice");
    require(!s_flash_fail_episode && s_flash_fail_total == 0 && s_flash_fail_skipped == 0,
            "pending keeper proof is not an IO episode");
    FlashJournalRecord again;
    require(flash_build_next_heater_context(again) && !std::memcmp(&again, &staged, sizeof(again)),
            "pending keeper yield preserves exact independent bytes");
    require(settle_permission(0) == HeaterContextErasePermission::Allowed,
            "one completed outside proof permits keeper erase");
    require(flash_append_record(again) == ESP_OK && s_flash_next_sequence == 18,
            "completed keeper proof permits one atomic data ACK");
    settle_store();
    append_piece();
    require(read_data(1).heater == 1 && s_flash_next_sequence == 19,
            "remaining heater waits for independent post-erase proof and gets its own sequence");
}

void keeper_combined_fences() {
    boot_store(true);
    seed_fence_sector();
    clear_read_measurement();
    require(settle_permission(0) == HeaterContextErasePermission::Allowed,
            "sixteen same-sector fences complete one combined outside proof");
    require(record_reads >= HISTORY_JOURNAL_SLOT_COUNT - HISTORY_JOURNAL_SLOTS_PER_SECTOR &&
                record_reads <= HISTORY_JOURNAL_SLOT_COUNT + 3 * HISTORY_JOURNAL_SLOTS_PER_SECTOR,
            "sixteen fences require one outside pass rather than sixteen full passes");
    for (size_t slot = HISTORY_JOURNAL_SLOTS_PER_SECTOR; slot < reads_by_slot.size(); ++slot)
        require(reads_by_slot[slot] <= 1,
                "each outside slot is checked at most once for the fence set");
    const unsigned complete = record_reads;
    require(heater_context_flash_erase_permission(flash_read_heater_context, 0) ==
                    HeaterContextErasePermission::Allowed &&
                record_reads <= complete + 16,
            "unchanged completed proof does not launch another outside pass");
}

void slow_reader_deadline() {
    boot_store(true, false);
    clear_read_measurement();
    sdk::record_read_cost_us = 1000000; // one callback itself may block beyond the soft deadline
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads == 1, "archive slice checks its soft deadline between slow Reader calls");
    const unsigned after_archive = record_reads;
    heater_context_flash_service(flash_read_heater_context, 0);
    require(record_reads == after_archive, "zero budget remains zero IO after a slow callback");
    sdk::record_read_cost_us = 0;
    for (uint16_t slot = 0; slot < HISTORY_JOURNAL_SLOTS_PER_SECTOR; ++slot)
        seed_fence(slot, slot + 1, wall_bucket() - 30);
    heater_context_flash_index_invalidate();
    clear_read_measurement();
    sdk::record_read_cost_us = 1000000;
    require(heater_context_flash_erase_permission(flash_read_heater_context, 0) ==
                    HeaterContextErasePermission::Pending &&
                record_reads == 1,
            "keeper target and outside phases share a soft inter-read deadline");
    sdk::record_read_cost_us = 0;
    require(programs == 0 && erases == 0, "soft deadline expiration never permits an erase");
}

void replay_budget() {
    boot_store(true, false);
    sdk::now_us          = 10000000;
    const int64_t newest = wall_bucket();
    for (uint16_t hour = 0; hour < 24; ++hour) seed_hours(hour * 2, hour * 2 + 1, newest - hour);
    heater_context_flash_index_invalidate();
    clear_read_measurement();
    for (unsigned pass = 0; pass < 63; ++pass) {
        const unsigned before = record_reads;
        heater_context_flash_service(flash_read_heater_context, 256);
        require(record_reads - before <= 256, "index and replay share a single call budget");
    }
    for (unsigned slot = 0; slot < 255; ++slot) {
        const unsigned before = record_reads;
        heater_context_flash_service(flash_read_heater_context, 1);
        require(record_reads - before <= 1, "one-read budget advances only one physical slot");
    }
    const unsigned before_last = record_reads;
    sdk::record_read_cost_us   = 1000000;
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads - before_last == 1,
            "finishing the index cannot bypass the deadline with a synchronous full replay");
    sdk::record_read_cost_us   = 0;
    const unsigned before_zero = record_reads;
    for (unsigned call = 0; call < 4; ++call)
        heater_context_flash_service(flash_read_heater_context, 0);
    require(record_reads == before_zero, "pending replay spends no IO with zero budget");
    for (unsigned call = 0; call < 3 * 24 + 8 && heater_context_status().restore_pending; ++call) {
        const unsigned before = record_reads;
        heater_context_flash_service(flash_read_heater_context, 1);
        require(record_reads - before <= 1,
                "independent replay preserves its state between one-read slices");
    }
    const auto status = heater_context_status();
    require(!status.restore_pending && status.on_us[0] == 24000000 && status.on_us[1] == 24000000,
            "incremental replay publishes all24 exact independent hours per heater after the last "
            "staged read");
}

void io_retry_repair() {
    boot_store(true, false);
    sdk::now_us = 10000000;
    seed_hours(0, 1, wall_bucket() - 1);
    heater_context_flash_index_invalidate();
    clear_read_measurement();
    fail_record_slot = 0;
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads == 1, "one failed Reader stops the current scan slice");
    for (unsigned call = 0; call < 4; ++call)
        heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads == 1, "same-time retries do not launch repeated failed scans");
    sdk::now_us += HEATER_CONTEXT_FLASH_RETRY_US - 1;
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads == 1, "IO backoff remains active until the monotonic retry deadline");
    fail_record_slot = -1;
    sdk::now_us += 2;
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads > 1 && record_reads <= 257 && reads_by_slot[0] == 2,
            "repaired IO restarts with a bounded fresh pass after backoff");
    settle_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 1000000 && status.on_us[1] == 1000000 && !(status.flags & hc::Clock),
            "IO repair restores genuine cohorts without inventing a clock fault");
}

void partial_keeper_invalidation(bool epoch_change) {
    require(esp_partition_erase_range(&partition, 0, HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
            "fixture creates an erased target sector for a separate keeper phase");
    seed_fence_sector();
    clear_read_measurement();
    require(heater_context_flash_erase_permission(flash_read_heater_context, 0) ==
                    HeaterContextErasePermission::Pending &&
                record_reads <= 256,
            "keeper proof remains partial after its first bounded slice");
    if (epoch_change) {
        heater_context_reset();
        heater_context_bind(expected_source, 202, 303, 9, hd::ALL, 3, false);
    } else {
        require(esp_partition_erase_range(&partition, HISTORY_FLASH_ERASE_BYTES,
                                          HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
                "fixture performs a real physical mutation outside the target sector");
        heater_context_flash_index_invalidate();
    }
    clear_read_measurement();
    require(heater_context_flash_erase_permission(flash_read_heater_context, 0) ==
                    HeaterContextErasePermission::Pending &&
                reads_by_slot[0] > 0,
            "epoch or physical mutation retires the partial keeper proof and rechecks its target");
}

void partial_epoch_invalidation() {
    boot_store(true, false);
    sdk::now_us = 10000000;
    seed_hours(0, 1, wall_bucket() - 1);
    heater_context_flash_index_invalidate();
    clear_read_measurement();
    record_read_hook_at = 10;
    record_read_hook    = [] {
        expected_source = 909;
        heater_context_bind(expected_source, 202, 303, 8, hd::ALL, 3, false);
    };
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_read_hook == nullptr && record_reads <= 256,
            "mid-scan owner cutover is observed inside the bounded callback slice");
    clear_read_measurement();
    heater_context_flash_service(flash_read_heater_context, 0);
    require(record_reads == 0, "retired partial scans cannot silently restart on zero budget");
    heater_context_flash_service(flash_read_heater_context, 256);
    require(record_reads == 0,
            "replacement scope cannot scan before pending retirement fences ACK");
    s_flash_next_sequence = 3;
    s_flash_next_slot     = 128;
    for (unsigned fence = 0; fence < 2; ++fence) {
        FlashJournalRecord record;
        require(flash_build_next_heater_context(record) &&
                    wh::kind(record.header) == wh::Kind::Fence,
                "old and replacement scope fences precede replacement scan");
        require(flash_append_record(record) == ESP_OK,
                "replacement retirement fence receives real ACK");
    }
    clear_read_measurement();
    heater_context_flash_service(flash_read_heater_context, 256);
    require(reads_by_slot[0] != 0, "replacement epoch begins a new scope-filtered pass at slot0");
    settle_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 0 && status.on_us[1] == 0,
            "retired partial index never publishes predecessor cohorts under the new source");
    partial_keeper_invalidation(true);
}

void partial_erase_invalidation() {
    boot_store(true, false);
    sdk::now_us = 10000000;
    seed_hours(0, 1, wall_bucket() - 1);
    heater_context_flash_index_invalidate();
    heater_context_flash_service(flash_read_heater_context, 256);
    require(heater_context_status().restore_pending,
            "partial physical scan is not a restored archive");
    require(esp_partition_erase_range(&partition, 0, HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
            "fixture physically removes previously scanned records");
    heater_context_flash_index_invalidate();
    clear_read_measurement();
    heater_context_flash_service(flash_read_heater_context, 0);
    require(record_reads == 0, "erase invalidation does not create hidden zero-budget work");
    heater_context_flash_service(flash_read_heater_context, 256);
    require(reads_by_slot[0] != 0, "physical mutation invalidates the old partial scan cursor");
    settle_store();
    const auto status = heater_context_status();
    require(status.on_us[0] == 0 && status.on_us[1] == 0,
            "erased candidates cannot survive in the completed incremental index");
    partial_keeper_invalidation(false);
}

void shutdown_budget() {
    boot_store(true, false);
    offer_legacy           = true;
    s_flash_service_source = 0;
    clear_read_measurement();
    require(history_flash_service_journal(12, 0) == 12 && programs == 24,
            "shutdown drain retains its exact twelve-record ceiling");
    require(record_reads <= 2 * 12 + 3 && region_reads <= 12 && erases == 0,
            "shutdown record budget cannot hide a journal-wide scan");
}

void independent_heater_eligibility() {
    boot_store(true);
    auto sample      = active_sample();
    sample.heater[1] = hd::Bit::Off;
    sdk::now_us      = 2000000;
    heater_context_record(sdk::now_us, sample);
    sdk::now_us = 12000000;
    heater_context_record(sdk::now_us, sample);
    FlashJournalRecord record;
    require(!flash_build_next_heater_context(record),
            "open unsealed hour cannot become a persistence record");
    const auto live = heater_context_status();
    require(live.on_us[0] == 10000000 && live.on_us[1] == 0 && live.readable_us[1] == 10000000,
            "independent BUH on and BSH off populations remain distinct");
    sdk::now_us = 3600000000LL;
    heater_context_expire();
    append_piece();
    append_piece();
    const auto a = read_data(0), b = read_data(1);
    require(a.heater == 0 && a.counters.on_us == 10000000 && b.heater == 1 &&
                b.counters.on_us == 0 && b.counters.off_us == 10000000,
            "closed hour persists two complete independent heater populations");
    boot_store();
    const auto restored = heater_context_status();
    require(restored.on_us[0] == 10000000 && restored.on_us[1] == 0 &&
                restored.readable_us[1] == 10000000,
            "cold independent replay preserves known off without copying BUH");
}

void pending_reset(bool consent) {
    boot_store(true);
    queue_hour();
    FlashJournalRecord staged;
    require(flash_build_next_heater_context(staged),
            "pending reset starts with genuine reserved data");
    const auto sequence = s_flash_heater_piece.sequence;
    bytes[0]            = 0;
    require(flash_append_record(staged) == ESP_ERR_NOT_FINISHED && s_flash_heater_pinned,
            "reset witness has a real deferred pinned claim");
    require(esp_partition_erase_range(&partition, 0, HISTORY_FLASH_ERASE_BYTES) == ESP_OK,
            "fixture erases only synthetic torn bytes");
    heater_context_flash_index_invalidate();
    if (consent) {
        expected_consent = 12;
        heater_context_set_diagnostics(true, expected_consent);
    } else
        expected_source = 909;
    heater_context_bind(expected_source, 202, 303, 8, hd::ALL, 3, false);
    offer_legacy = true;
    require(history_flash_service_journal(1, 0) == 0 && !s_flash_heater_pinned &&
                !heater_context_flash_claim_pending() && s_flash_next_sequence == sequence,
            "source or consent retirement releases obsolete proof pin without spending sequence");
    require(history_flash_service_journal(1, 0) == 1,
            "retirement fence resumes on the next actual writer tick");
    FlashJournalRecord fence;
    require(flash_read_record(16, fence) == ESP_OK && wh::kind(fence.header) == wh::Kind::Fence &&
                fence.header.sequence == sequence && fence.payload[0] == 3,
            "retirement fence takes released sequence instead of stale pending data or core");
    const auto status = heater_context_status();
    require(status.on_us[0] == 0 && status.on_us[1] == 0,
            "retirement cannot resurrect abandoned live counters");
}

void incompatible_archive(bool legacy) {
    boot_store(true, false);
    if (legacy) {
        hd::State state;
        hd::Hour  hour;
        hd::step(state, hour, 1000000, 7, 303, 3, hd::ALL, active_sample());
        hd::step(state, hour, 2000000, 7, 303, 3, hd::ALL, active_sample());
        hc::Data data;
        data.identity     = identity();
        data.first        = 1000000;
        data.last         = 2000000;
        data.counters     = hour.heater[0];
        data.heater       = 0;
        data.required     = 3;
        data.capabilities = hd::ALL;
        FlashJournalRecord old;
        raw_record(old, 1, wall_bucket() - 1, hc::fingerprint(hc::Kind::Data), hc::DATA_BYTES / 2);
        require(hc::encode_data(data, old.payload, hc::DATA_BYTES),
                "legacy Method2 seed uses its actual old codec");
        old.header.crc = history_journal_crc_bytes(old.header, old.payload, hc::DATA_BYTES);
        seed_record(0, old);
    } else
        bytes[0] = 0;
    heater_context_flash_index_invalidate();
    settle_store();
    auto status = heater_context_status();
    require(status.restore_pending && (status.flags & hc::Incomplete) && status.on_us[0] == 0 &&
                status.on_us[1] == 0,
            "opaque or legacy Method2 never publishes a compatible archive");
    if (legacy)
        require((status.flags & hc::ScopeMismatch) != 0, "Method2 is an explicit scope mismatch");
    queue_hour();
    FlashJournalRecord record;
    require(!flash_build_next_heater_context(record) && programs == 0 && erases == 0,
            "unproven incompatible archive cannot admit new independent data writes");
    require(settle_permission(0) == HeaterContextErasePermission::Protected,
            "opaque and legacy Method2 sectors are retained rather than automatically erased");
    status = heater_context_status();
    require(status.on_us[0] == 10000000 && status.on_us[1] == 10000000,
            "archive refusal preserves separately observed live heater counters");
}

void latest_revision_replace() {
    boot_store(true, false);
    seed_hours(0, 1, wall_bucket() - 1);
    hd::State state;
    hd::Hour  hour;
    hd::step(state, hour, 1000000, 7, 303, 3, hd::ALL, active_sample());
    hd::step(state, hour, 6000000, 7, 303, 3, hd::ALL, active_sample());
    wh::Data data;
    data.identity     = identity();
    data.first        = 1000000;
    data.last         = 6000000;
    data.counters     = hour.heater[0];
    data.heater       = 0;
    data.required     = 3;
    data.capabilities = hd::ALL;
    FlashJournalRecord revision;
    raw_record(revision, 3, wall_bucket() - 1, wh::fingerprint(wh::Kind::Data), wh::DATA_BYTES / 2);
    require(wh::encode_data(data, revision.payload, wh::DATA_BYTES),
            "latest complete independent revision encodes");
    revision.header.crc =
        history_journal_crc_bytes(revision.header, revision.payload, wh::DATA_BYTES);
    seed_record(2, revision);
    heater_context_flash_index_invalidate();
    settle_store();
    auto status = heater_context_status();
    require(!status.restore_pending && status.on_us[0] == 5000000 && status.on_us[1] == 1000000,
            "cold highest revision replaces exactly one heater hour without additive duplication");
    heater_context_flash_index_invalidate();
    settle_store();
    status = heater_context_status();
    require(status.on_us[0] == 5000000 && status.on_us[1] == 1000000,
            "physical reproof cannot merge an already authoritative hourly base again");
}

// The complete History prepare/append/ACK path is used below. Explicit cursor placement at
// occupied fixture sectors witnesses rotation without claiming a full-journal wear test.
void dirty_live_hours(unsigned count, bool seal = false) {
    for (unsigned hour = 0; hour < count; ++hour) {
        sample_at(int64_t(hour) * 3600 + 2);
        sample_at(int64_t(hour) * 3600 + 12);
    }
    if (seal) {
        sdk::now_us += 1000000;
        heater_context_seal();
    } else {
        sdk::now_us = int64_t(count) * hc::HOUR_US;
        heater_context_expire();
    }
}
void seed_ordinary(uint16_t slot, uint64_t sequence) {
    FlashJournalRecord ordinary;
    raw_record(ordinary, sequence, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
    seed_record(slot, ordinary);
}
void positive_tick() {
    const unsigned before = record_reads;
    {
        SemGuard flash(s_flash_mtx);
        require(flash.acquired(), "the scheduled restore leaf owns Flash serialization");
        flash_progress_heater_context();
    }
    require(record_reads - before <= 256, "one scheduled leaf spends at most256 archive reads");
}
unsigned written_key(uint16_t slot, int64_t first_bucket) {
    hc::View view;
    wh::Data data;
    require(flash_read_heater_context(slot, view) && wh::typed(view, wh::Kind::Data) &&
                wh::decode_data_into(view.payload, wh::DATA_BYTES, data),
            "rotation counts only actual normalized-CRC Data readbacks");
    const auto hour = view.header->bucket - first_bucket;
    require(hour >= 0 && hour < 24 && data.heater < 2,
            "physical rotated record belongs to the expected independent cell");
    return unsigned(data.heater) * 24 + unsigned(hour);
}
void shutdown_48_cells_best_effort() {
    boot_store(true);
    require(heater_context_private_static_bytes() <= 4800,
            "heater Store static DRAM stays within 4800 B budget");
    for (unsigned hour = 0; hour < 22; ++hour) {
        sample_at(int64_t(hour) * 3600 + 2);
        sample_at(int64_t(hour) * 3600 + 12);
        sdk::now_us = int64_t(hour + 1) * hc::HOUR_US;
        heater_context_expire();
        require(history_flash_service_journal(2, 0) == 2,
                "each closed hour flushes and demotes to flash-backed clean archive");
    }
    sample_at(22 * 3600 + 2);
    sample_at(22 * 3600 + 12);
    sample_at(23 * 3600 + 2);
    sample_at(23 * 3600 + 12);
    sdk::now_us += 1000000;
    heater_context_seal();
    require(heater_context_status().observed_hours[0] == 24 &&
                heater_context_status().observed_hours[1] == 24,
            "all48 independent materialized cells are available before bounded shutdown");
    s_flash_next_slot = 128;
    clear_read_measurement();
    const unsigned programs_before = programs;
    const uint64_t seq_before      = s_flash_next_sequence;
    require(history_flash_service_journal(2, 0) == 2 && programs == programs_before + 4 &&
                s_flash_next_sequence == seq_before + 2,
            "bounded shutdown drains two of four hot dirty cells");
    require(heater_context_status().persistence_pending && record_reads <= 4 && region_reads <= 2,
            "best effort shutdown leaves remaining hot hours pending without hidden archive scan");
    require(history_flash_service_journal(12, 0) == 2 &&
                !heater_context_status().persistence_pending,
            "remaining two dirty hot cells complete within twelve-record ceiling");
}

void clean_archive() {
    boot_store(true, false);
    sdk::now_us = 10000000;
    for (uint16_t hour = 0; hour < 24; ++hour)
        seed_hours(hour * 2, hour * 2 + 1, wall_bucket() - hour);
    heater_context_flash_index_invalidate();
    settle_store();
    require(heater_context_status().observed_hours[0] == 24 &&
                heater_context_status().observed_hours[1] == 24,
            "verified clean archive has48 authoritative materialized cells");
}
void unrelated_erase_no_rewrite() {
    clean_archive();
    seed_ordinary(256, 49);
    s_flash_next_slot      = 256;
    s_flash_next_sequence  = 50;
    s_flash_service_source = size_t(HistoryJournalSource::X10a);
    offer_legacy           = true;
    require(history_flash_service_journal(1, 0) == 1 && erases == 1 && programs == 2,
            "unrelated sector is erased by the real ordinary History append");
    offer_legacy = false;
    settle_store();
    require(history_flash_service_journal(12, 0) == 0 && programs == 2 &&
                !heater_context_status().persistence_pending,
            "unrelated actual sector erase never rewrites the48 unaffected durable cells");
    require(heater_context_status().on_us[0] == 24000000 &&
                heater_context_status().on_us[1] == 24000000,
            "unrelated sector proof preserves the same exact admitted counts");
}
void unknown_mutation_no_rewrite() {
    clean_archive();
    s_flash_next_sequence = 49;
    s_flash_next_slot     = 128;
    heater_context_flash_index_invalidate();
    require(heater_context_status().restore_pending,
            "unknown physical mutation withdraws proof before writing");
    require(history_flash_service_journal(12, 0) == 0 && programs == 0,
            "unknown mutation blocks all Data writes until complete reproof");
    settle_store();
    require(history_flash_service_journal(12, 0) == 0 && programs == 0 &&
                !heater_context_status().persistence_pending,
            "unchanged physical reproof does not dirty authoritative durable cells");
}
void clock_negative_jitter() {
    boot_store(true);
    sample_at(2);
    sample_at(12);
    sdk::origin_us -= 500000;
    sample_at(22);
    sample_at(32);
    sdk::now_us = 33000000; // actual UTC has caught up with the fixed anchored end
    heater_context_seal();
    require(history_flash_service_journal(3, 0) == 2 && programs == 4,
            "accepted negative clock jitter still commits both complete atomic hour records");
    const auto data = read_data(0);
    require(data.counters.on_us == 30000000 && data.last - data.first == 30000000,
            "fixed anchor dates both interval endpoints without shortening observed duration");
    boot_store();
    require(heater_context_status().on_us[0] == 30000000 &&
                heater_context_status().on_us[1] == 30000000,
            "actual cold History reads restore both jittered records exactly once");
}
void rotation_progress() {
    boot_store(true);
    const int64_t first_bucket = wall_bucket();
    // Three occupied sectors force three genuine prepare/keeper/erase callbacks.
    for (unsigned i = 0; i < 3; ++i) seed_ordinary(uint16_t(128 + i * 16), i + 1);
    s_flash_next_slot     = 128;
    s_flash_next_sequence = 4;
    std::array<bool, 48> seen{};
    unsigned             distinct = 0, committed = 0;
    for (unsigned h = 0; h < 20; ++h) {
        sample_at(int64_t(h) * 3600 + 2);
        sample_at(int64_t(h) * 3600 + 12);
        sdk::now_us = int64_t(h + 1) * hc::HOUR_US;
        heater_context_expire();
        unsigned hour_committed = 0;
        for (unsigned tick = 0; tick < 100 && hour_committed < 2; ++tick) {
            positive_tick();
            if (!history_flash_service_journal(1, 0)) continue;
            ++committed;
            ++hour_committed;
            const auto key =
                written_key(uint16_t((s_flash_next_slot + HISTORY_JOURNAL_SLOT_COUNT - 1) %
                                     HISTORY_JOURNAL_SLOT_COUNT),
                            first_bucket);
            if (!seen[key]) {
                seen[key] = true;
                ++distinct;
            }
        }
        require(hour_committed == 2,
                "each streamed closed hour commits and demotes cleanly within bounded ticks");
    }
    require(committed == 40 && distinct == 40 && seen[19] && seen[43] && erases == 3,
            "real multi-sector rotation advances all40 distinct cells including youngest hours");
    require(!heater_context_status().persistence_pending &&
                history_flash_service_journal(12, 0) == 0,
            "completed rotation leaves no artificial all-hours dirty backlog");
    // Simulate ring wrap into the first written sector: active clean cells protect it from erase.
    s_flash_next_slot      = 128;
    s_flash_service_source = size_t(HistoryJournalSource::X10a);
    offer_legacy           = true;
    require(settle_permission(128) == HeaterContextErasePermission::Protected,
            "active clean-cell sector is protected during rotation");
    require(history_flash_service_journal(1, 0) == 0 && s_flash_next_slot == 144 && erases == 3,
            "ring wrap skips protected clean-cell sector without erasing it");
    // Unrelated sector 176 erases without dirtying any of the 40 clean cells.
    seed_ordinary(176, 90);
    s_flash_next_slot = 176;
    require(history_flash_service_journal(1, 0) == 1 && erases == 4,
            "unrelated sector erases cleanly without disturbing protected clean cells");
    offer_legacy = false;
    settle_store();
    require(!heater_context_status().persistence_pending &&
                history_flash_service_journal(12, 0) == 0,
            "unrelated erase after rotation leaves all40 clean cells clean");
    require(heater_context_status().on_us[0] == 200000000 &&
                heater_context_status().on_us[1] == 200000000,
            "rotation never alters authoritative observed counters");
    boot_store();
    require(heater_context_status().on_us[0] == 200000000 &&
                heater_context_status().on_us[1] == 200000000,
            "cold latest full revisions restore each rotated hour without summation");
}
void clean_sector_protection_and_rebuild() {
    boot_store(true, false);
    require(heater_context_private_static_bytes() <= 4800,
            "heater Store static DRAM stays within 4800 B budget");
    sdk::now_us          = 23 * hc::HOUR_US + 60000000LL;
    const int64_t oldest = wall_bucket() - 23;
    for (uint16_t h = 0; h < 23; ++h) seed_hours(h * 2, h * 2 + 1, oldest + h);
    s_flash_next_sequence = 47;
    heater_context_flash_index_invalidate();
    settle_store();
    auto status = heater_context_status();
    require(!status.restore_pending && status.observed_hours[0] == 23 &&
                status.on_us[0] == 23000000 && status.on_us[1] == 23000000,
            "clean archive restores 23 closed hours per heater into clean totals");
    s_flash_next_slot      = 0;
    s_flash_service_source = size_t(HistoryJournalSource::X10a);
    offer_legacy           = true;
    require(settle_permission(0) == HeaterContextErasePermission::Protected,
            "active clean-cell sector returns Protected against rotation erase");
    require(history_flash_service_journal(1, 0) == 0 && s_flash_next_slot == 16 && erases == 0,
            "History prepare skips protected clean-cell sector without erasing");
    offer_legacy = false;
    sdk::now_us  = 24 * hc::HOUR_US;
    heater_context_expire();
    status = heater_context_status();
    require(status.restore_pending && status.on_us[0] == 0 && status.on_us[1] == 0,
            "expired clean archive hides stale clean totals until targeted rebuild completes");
    clear_read_measurement();
    positive_tick();
    status = heater_context_status();
    require(record_reads <= 46 && !status.restore_pending && status.observed_hours[0] == 22 &&
                status.on_us[0] == 22000000 && status.on_us[1] == 22000000,
            "targeted clean rebuild restores exact 22 hours without full archive scan");
}
void ghost_no_data() {
    boot_store(true, false);
    sdk::now_us = hc::HOUR_US;
    seed_hours(0, 1, wall_bucket() - 1);
    seed_fence(2, 3, wall_bucket() - 1);
    s_flash_next_sequence = 4;
    s_flash_next_slot     = 16;
    heater_context_flash_index_invalidate();
    settle_store();
    require(!heater_context_status().observed_hours[0] &&
                !heater_context_status().observed_hours[1],
            "prefence candidate slots never become observed heater hours");
    heater_context_flash_index_invalidate();
    settle_store();
    require(history_flash_service_journal(12, 0) == 0 && programs == 0 &&
                !heater_context_status().persistence_pending &&
                !heater_context_status().observed_hours[0] &&
                !heater_context_status().observed_hours[1],
            "real History writer never emits empty ghost Data after prefence reproof");
}

void callback_contention(const std::string& name) {
    boot_store(true);
    queue_hour();
    FlashJournalRecord record;
    require(flash_build_next_heater_context(record),
            "callback witness stages genuine immutable data");
    const auto saved = record;
    if (name == "blocking_deferred") {
        bytes[0]            = 0;
        record_read_hook_at = record_reads + 1;
        record_read_hook    = [] { sdk::store_busy = true; };
        require(flash_append_record(record) == ESP_ERR_NOT_FINISHED && !sdk::store_busy &&
                    sdk::busy_blocking_takes == 1,
                "deferred callback waits through owner contention instead of losing reservation");
        FlashJournalRecord again;
        require(flash_build_next_heater_context(again) &&
                    !std::memcmp(&again, &saved, sizeof(saved)),
                "contended deferred callback preserves immediately reoffered bytes");
    } else if (name == "blocking_invalidate" || name == "blocking_unknown_invalidate") {
        // A committed foreign record makes the real prepare body erase its sector.
        FlashJournalRecord ordinary;
        raw_record(ordinary, 1, 1, 0x5452454e, TREND_COUNT, HistoryJournalSource::X10a);
        seed_record(0, ordinary);
        busy_after_erase = true;
        if (name == "blocking_unknown_invalidate") {
            fail_next_erase = true;
            // Observe prepare's notification before outer append-failed can independently
            // withdraw proof and mask a dropped one-shot invalidation.
            size_t target_slot = SIZE_MAX;
            require(
                flash_append_record_at(record, target_slot) != ESP_OK && !sdk::store_busy &&
                    sdk::busy_blocking_takes == 1 && heater_context_status().restore_pending,
                "failed erase generic invalidation waits through contention and withdraws proof");
            heater_context_flash_failed(s_flash_heater_piece);
            require(!heater_context_flash_claim_pending(),
                    "failed erase claim retires after the separate failure callback");
            return;
        }
        require(flash_append_record(record) == ESP_OK && !sdk::store_busy &&
                    sdk::busy_blocking_takes == 1 && heater_context_status().restore_pending,
                "physical erase invalidation waits through contention and withdraws old proof");
    } else {
        before_readback = [] { sdk::store_busy = true; };
        if (name == "blocking_failed") fail_next_readback = true;
        const auto result = flash_append_record(record);
        require((name == "blocking_failed" ? result != ESP_OK : result == ESP_OK) &&
                    !sdk::store_busy && sdk::busy_blocking_takes == 1 &&
                    !heater_context_flash_claim_pending(),
                "ACK or failed callback waits through contention and settles exact claim");
    }
}

void dispatcher_sources() {
    boot_store(true);
    queue_hour();
    dispatch_probe = DispatchProbe::Built;
    FlashJournalRecord   record{};
    constexpr TickType_t wait = 37;
    {
        SemGuard flash(s_flash_mtx);
        require(flash_build_for_service(kStopObservationSource, record, wait) &&
                    provider_calls[0] == 1 && provider_calls[1] == 0 && provider_calls[2] == 0 &&
                    provider_source == kStopObservationSource && record.header.sequence == 777,
                "actual dispatcher selects the Stop provider only");
        const auto core = size_t(HistoryJournalSource::Checkup);
        require(flash_build_for_service(core, record, wait) && provider_calls[1] == 1 &&
                    provider_source == core && provider_wait == wait &&
                    record.header.sequence == 777,
                "actual dispatcher selects core with the original wait budget");
        const size_t trends[] = {size_t(HistorySource::X10a), size_t(HistorySource::Modbus),
                                 size_t(HistorySource::Env3)};
        unsigned     calls    = 0;
        for (const auto source : trends) {
            require(flash_build_for_service(source, record, wait) && provider_calls[2] == ++calls &&
                        provider_source == source && provider_wait == wait &&
                        record.header.sequence == 777,
                    "actual dispatcher preserves every trend source and wait budget");
        }
        require(flash_build_for_service(kHeaterContextSource, record, wait) &&
                    wh::kind(record.header) == wh::Kind::Data &&
                    record.header.sequence == s_flash_next_sequence && provider_calls[0] == 1 &&
                    provider_calls[1] == 1 && provider_calls[2] == 3,
                "actual dispatcher keeps the real independent Heater builder");
        wh::Data data;
        require(wh::decode_data_into(record.payload, wh::DATA_BYTES, data) &&
                    data.counters.on_us == 10000000 && cursor_logs == 0,
                "real Heater output retains witnessed counters without a fabricated future note");
        heater_context_flash_failed(s_flash_heater_piece);
    }
    require(provider_active == 0 && provider_calls[0] == provider_returns[0] &&
                provider_calls[1] == provider_returns[1] &&
                provider_calls[2] == provider_returns[2],
            "all dispatcher provider observations finish before returning");
}
void dispatcher_future_note() {
    boot_store(true);
    FlashJournalRecord   record{};
    constexpr TickType_t wait = 41;
    {
        SemGuard flash(s_flash_mtx);
        dispatch_probe = DispatchProbe::OrdinaryFalse;
        require(!flash_build_for_service(kStopObservationSource, record, wait) && cursor_logs == 0,
                "ordinary Stop refusal never invents a future log");
        const size_t sources[] = {size_t(HistoryJournalSource::Checkup),
                                  size_t(HistorySource::X10a), size_t(HistorySource::Modbus),
                                  size_t(HistorySource::Env3)};
        for (const auto source : sources) {
            dispatch_probe    = DispatchProbe::Future;
            provider_cursor   = 12345 + int64_t(source) * 100;
            provider_bound    = provider_cursor - 45;
            const auto before = cursor_logs;
            require(!flash_build_for_service(source, record, wait) && cursor_logs == before + 1 &&
                        cursor_log_source == source && cursor_log_cursor == provider_cursor &&
                        cursor_log_bound == provider_bound && provider_wait == wait,
                    "actual wrapper reports rejected future cursor once after provider return");
            dispatch_probe = DispatchProbe::OrdinaryFalse;
            require(!flash_build_for_service(source, record, wait) && cursor_logs == before + 1,
                    "ordinary provider refusal receives a fresh empty note and never logs");
            dispatch_probe = DispatchProbe::Built;
            require(flash_build_for_service(source, record, wait) && cursor_logs == before + 1 &&
                        record.header.sequence == 777,
                    "successful provider output preserves its return value without a future log");
        }
        dispatch_probe = DispatchProbe::Future;
        require(!flash_build_for_service(kHeaterContextSource, record, wait) && cursor_logs == 4 &&
                    provider_active == 0,
                "ordinary real Heater refusal cannot borrow a modeled future note");
    }
}

unsigned traced_calls = 0, traced_out_of_range = 0;
bool     traced_history_reader(uint16_t slot, hc::View& view) {
    ++traced_calls;
    if (slot >= HISTORY_JOURNAL_SLOT_COUNT) ++traced_out_of_range;
    return flash_read_heater_context(slot, view);
}
void lost_scan_finish() {
    boot_store(true, false);
    sdk::now_us = 10000000;
    seed_hours(0, 1, wall_bucket() - 1);
    heater_context_flash_index_invalidate();
    for (unsigned pass = 0; pass < 63; ++pass)
        heater_context_flash_service(traced_history_reader, 256);
    for (unsigned pass = 0; pass < 255; ++pass)
        heater_context_flash_service(traced_history_reader, 1);
    require(traced_calls == HISTORY_JOURNAL_SLOT_COUNT - 1,
            "finish contention starts exactly before final physical slot");
    record_read_hook_at = record_reads + 1;
    record_read_hook    = [] { sdk::busy_after_store_give = true; };
    heater_context_flash_service(traced_history_reader, 1);
    require(traced_calls == HISTORY_JOURNAL_SLOT_COUNT && sdk::store_busy &&
                sdk::busy_zero_waits > 0,
            "scan_slot completes before only scan_finish loses zero-wait owner contention");
    sdk::store_busy = false; // the independent owner has run before the next scheduled service
    heater_context_flash_service(traced_history_reader, 256);
    require(traced_out_of_range == 0, "lost finish resumes without any out-of-range Reader");
    const auto status = heater_context_status();
    require(!status.restore_pending && status.on_us[0] == 1000000 && status.on_us[1] == 1000000,
            "retried finalization materializes real independent leaves without restarting or loss");
}
} // namespace fixture

int main(int argc, char** argv) {
    const std::string name = argc == 2 ? argv[1] : "";
    if (name == "sanitizer_tripwire") {
        volatile int maximum = INT_MAX;
        maximum              = maximum + 1;
        std::printf("unexpected sanitizer continuation %d\n", int(maximum));
        return 0;
    }
    try {
        using namespace fixture;
        if (name == "cohort_actual_slots")
            cohort_actual_slots();
        else if (name == "service_pins_across_ticks")
            service_pins_across_ticks();
        else if (name == "protected_corrupt_sector" || name == "protected_torn_sector" ||
                 name == "protected_read_failure")
            protected_sector(name);
        else if (name == "keeper_fence_outside_records")
            keeper_fence_outside_records();
        else if (name == "inflight_sector_deferral")
            inflight_sector_deferral();
        else if (name == "sequence_exhaustion")
            sequence_exhaustion();
        else if (name == "bad_data_readback")
            bad_data_readback();
        else if (name == "unreadable_data_readback")
            bad_data_readback(true);
        else if (name == "accepted_program_error")
            accepted_program_error();
        else if (name == "late_revision_deferred_bytes")
            late_revision_deferred_bytes();
        else if (name == "source_interleave" || name == "consent_interleave" ||
                 name == "clock_interleave")
            owner_interleave(name);
        else if (name == "core_cursor_control")
            core_cursor_control();
        else if (name == "bounded_tick_budget")
            bounded_tick_budget();
        else if (name == "keeper_pending_cursor")
            keeper_pending_cursor();
        else if (name == "keeper_combined_fences")
            keeper_combined_fences();
        else if (name == "slow_reader_deadline")
            slow_reader_deadline();
        else if (name == "replay_budget")
            replay_budget();
        else if (name == "io_retry_repair")
            io_retry_repair();
        else if (name == "partial_epoch_invalidation")
            partial_epoch_invalidation();
        else if (name == "partial_erase_invalidation")
            partial_erase_invalidation();
        else if (name == "shutdown_budget")
            shutdown_budget();
        else if (name == "independent_heater_eligibility")
            independent_heater_eligibility();
        else if (name == "pending_source_reset" || name == "pending_consent_reset")
            pending_reset(name == "pending_consent_reset");
        else if (name == "opaque_archive" || name == "legacy_method2_archive")
            incompatible_archive(name == "legacy_method2_archive");
        else if (name == "latest_revision_replace")
            latest_revision_replace();
        else if (name == "shutdown_48_cells_best_effort")
            shutdown_48_cells_best_effort();
        else if (name == "unrelated_erase_no_rewrite")
            unrelated_erase_no_rewrite();
        else if (name == "unknown_mutation_no_rewrite")
            unknown_mutation_no_rewrite();
        else if (name == "clock_negative_jitter")
            clock_negative_jitter();
        else if (name == "rotation_progress")
            rotation_progress();
        else if (name == "clean_sector_protection_and_rebuild")
            clean_sector_protection_and_rebuild();
        else if (name == "ghost_no_data")
            ghost_no_data();
        else if (name == "dispatcher_sources")
            dispatcher_sources();
        else if (name == "dispatcher_future_note")
            dispatcher_future_note();
        else if (name == "blocking_ack" || name == "blocking_failed" ||
                 name == "blocking_deferred" || name == "blocking_invalidate" ||
                 name == "blocking_unknown_invalidate")
            callback_contention(name);
        else if (name == "lost_scan_finish")
            lost_scan_finish();
        else
            throw std::runtime_error("known_case");
        require(sdk::lock_depth == 0 && sdk::takes == sdk::gives && !sdk::flash_mutex.owned,
                "all modeled mutexes balance after the transaction");
        std::printf(
            "PASS case=%s assertions=%u reads=%u records=%u regions=%u programs=%u erases=%u\n",
            name.c_str(), assertions, reads, record_reads, region_reads, programs, erases);
        return 0;
    } catch (const std::exception& error) {
        std::printf("FAIL oracle=%s case=%s\n", error.what(), name.c_str());
        return 1;
    }
}
