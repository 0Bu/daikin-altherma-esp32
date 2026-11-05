// Real production store TU, logic and CRC. Only SDK clocks/mutexes and flash transport are ports.
#include "sdk.hpp"
#include "stop_observation_store.cpp"
#include "logic/checkup_persist.hpp"
#include <array>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>

namespace daik {
bool time_synced() { return sdk::synced; }
void time_now(int64_t& seconds, int32_t& ms) {
    const int64_t at = sdk::origin_us + sdk::now_us;
    seconds          = at / 1000000;
    ms               = (at % 1000000) / 1000;
}
} // namespace daik
namespace {
using namespace daik;
using namespace daik::logic;
struct Slot {
    HistoryJournalHeader     header{};
    ObservationHourlyPayload payload;
};
std::array<Slot, 512> flash;
uint64_t              next_sequence = 1;
uint16_t              next_slot     = 0;
unsigned              assertions    = 0;
void (*before_read)()               = nullptr;
void require(bool ok, const char* oracle) {
    ++assertions;
    if (!ok) throw std::runtime_error(oracle);
}
#include "history_record.hpp" // exact production record geometry, extracted by run.py
alignas(FlashJournalRecord) uint8_t s_flash_sector[HISTORY_FLASH_ERASE_BYTES];
constexpr int ESP_OK = 0;
int           flash_read_record(size_t slot, FlashJournalRecord& out) {
    ++sdk::reads;
    if (before_read) {
        const auto hook = before_read;
        before_read     = nullptr;
        hook();
    }
    if (slot >= flash.size()) return -1;
    const auto& s = flash[slot];
    out.header    = s.header;
    std::memset(out.payload, 0xff, sizeof(out.payload));
    observation_encode(s.payload, out.payload);
    return ESP_OK;
}
#include "history_reader.hpp" // execute the exact production scratch/CRC admission path
bool reader(uint16_t slot, int64_t& bucket, uint64_t& sequence, ObservationHourlyPayload& p) {
    return flash_read_stop_observation(slot, bucket, sequence, p);
}
Slot make_slot(int64_t bucket, ObservationHourlyPayload p, uint64_t sequence) {
    Slot s;
    observation_encode(p, &s.payload);
    auto& h       = s.header;
    h.magic       = HISTORY_JOURNAL_MAGIC;
    h.version     = HISTORY_JOURNAL_VERSION;
    h.source      = static_cast<uint8_t>(HistoryJournalSource::Checkup);
    h.catalog_fp  = observation_fingerprint();
    h.commit      = HISTORY_JOURNAL_COMMITTED;
    h.value_count = OBSERVATION_WORDS;
    h.slot_bytes  = HISTORY_JOURNAL_SLOT_BYTES;
    h.sequence    = sequence;
    h.bucket      = bucket;
    h.dt_s        = 3600;
    h.rings[0]    = TREND_COUNT;
    h.rings[1]    = HOMEHUB_HISTORY_COUNT;
    h.rings[2]    = ENV3_HISTORY_COUNT;
    h.crc         = history_journal_crc_bytes(h, &s.payload, OBSERVATION_PAYLOAD_BYTES);
    return s;
}
void boot(bool clear_flash = true, uint32_t consent = 11) {
    if (clear_flash) {
        sdk::now_us   = 1000000; // a fresh trace starts before its first producer timestamp
        flash         = {};
        next_sequence = 1;
        next_slot     = 0;
    }
    stop_observation_flash_index_reset();
    stop_observation_start(true, consent);
    stop_observation_bind(101, 202, 303, 7);
    for (uint16_t i = 0; i < next_slot; ++i) {
        int64_t                  bucket;
        uint64_t                 sequence;
        ObservationHourlyPayload p;
        if (reader(i, bucket, sequence, p)) stop_observation_flash_index(bucket, sequence, i, p);
    }
    stop_observation_flash_service(reader);
}
void tick(int64_t at_s, bool readable = true, StopContextEvent e = {}) {
    sdk::now_us = at_s * 1000000;
    stop_observation_record(sdk::now_us, readable, e);
}
StopContextEvent event(int64_t at_s, uint32_t generation = 7) {
    StopContextEvent e;
    e.valid             = true;
    e.stop_us           = at_s * 1000000;
    e.source_generation = generation;
    e.positive = e.evaluable = e.complete = STOP_CONTEXT_ALL;
    return e;
}
bool append(bool busy_receipt = false) {
    int64_t                  bucket = INT64_MIN;
    ObservationHourlyPayload p;
    if (!stop_observation_flash_next(reader, bucket, p)) return false;
    require(next_slot < flash.size(), "fixture flash capacity");
    flash[next_slot] = make_slot(bucket, p, next_sequence);
    if (busy_receipt) s_mutex->owned = true;
    stop_observation_flash_appended(bucket, next_sequence++, next_slot++, p);
    if (busy_receipt) {
        stop_observation_flash_service(reader); // must be zero-wait and preserve the transaction
        s_mutex->owned = false;
    }
    stop_observation_flash_service(reader);
    return true;
}
void drain() {
    for (unsigned i = 0; i < 20 && append(); ++i) {}
}
ObservationHourlyPayload payload(int64_t bucket, uint16_t count = 1) {
    ObservationHourlyPayload p;
    p.identity                                = {101, 202, 303, 11};
    p.first_unix_us                           = bucket * OBSERVATION_HOUR_US;
    p.last_unix_us                            = p.first_unix_us + OBSERVATION_HOUR_US - 1;
    p.readable_us                             = OBSERVATION_HOUR_US;
    p.counters.witnessed_stops_recent_heating = count;
    return p;
}
void put(int64_t bucket, ObservationHourlyPayload p) {
    flash[next_slot] = make_slot(bucket, p, next_sequence);
    stop_observation_flash_index(bucket, next_sequence++, next_slot++, p);
}
void late_replay() {
    boot();
    tick(3590);
    tick(3605);
    require(append(), "hour closure persisted");
    const int64_t edge_bucket = observation_bucket(sdk::origin_us + 3598LL * 1000000);
    require(flash[0].header.bucket == edge_bucket, "closure original edge hour");
    tick(3620, false, event(3598));
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
            "late delta visible before append");
    require(append(), "late completion replay appended");
    require(flash[1].header.bucket == edge_bucket, "late completion retains original hour");
    require(flash[1].payload.counters.witnessed_stops_recent_heating == 1,
            "latest revision merged rather than replaced");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
            "late completion not double counted live");
    boot(false);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
            "latest revision restored exactly once");
    require(stop_observation_report().readable_us == 10000000,
            "seam interval split at original hour boundary");
}
void independent_clock() {
    boot();
    tick(1);
    tick(10);
    tick(30); // >15s: explicit gap
    tick(40, false);
    tick(50);
    require(stop_observation_report().readable_us == 9000000,
            "only readable endpoint pairs within15s count");
    const unsigned reads = sdk::reads;
    tick(60, false, event(55, 99));
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "generation mismatch event refused");
    require(stop_observation_report().dropped == 1, "wrong generation explicitly partial");
    require(sdk::reads == reads, "report and producer perform no flash reads");
    sdk::now_us += 25 * OBSERVATION_HOUR_US;
    require(stop_observation_report().readable_us == 0, "open expires without producer");
    drain();
    require(next_slot == 0, "expired open evidence not appended as new");
}
void busy_and_failure() {
    boot();
    tick(3590, true, event(3580));
    tick(3605);
    require(append(true), "busy zero-wait commit acknowledgement reconciled");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
            "busy commit not double counted");
    tick(3620, false, event(3598));
    int64_t                  bucket;
    ObservationHourlyPayload p;
    require(stop_observation_flash_next(reader, bucket, p), "claim correction");
    s_mutex->owned = true;
    stop_observation_flash_failed();
    s_mutex->owned = false;
    stop_observation_flash_service(reader);
    require(append(), "failed write releases pending correction for retry");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 2,
            "retry retains both independent events");
}
void reset_and_consent() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 1, payload(current - 1, 9));
    stop_observation_flash_service(reader);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 9,
            "pre-reset archive fixture admitted");
    stop_observation_reset();
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "reset withdraws previous evidence immediately");
    require(stop_observation_report().persistence_pending, "reset pending until fence commits");
    stop_observation_bind(101, 202, 303, 8, false);
    drain();
    require(!stop_observation_report().persistence_pending, "durable reset fence acknowledged");
    boot(false);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "durable same-scope reset survives reboot");
    stop_observation_set_diagnostics(false, 12);
    require(!stop_observation_report().confirmed, "consent withdrawn immediately");
    stop_observation_set_diagnostics(true, 13);
    stop_observation_bind(101, 202, 303, 9);
    drain();
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "new consent cannot restore prior consent");
}
void restore_guards() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 2, payload(current - 2, 3));
    auto wrong               = payload(current - 1, 20);
    wrong.identity.source_fp = 999;
    put(current - 1, wrong);
    auto future = payload(current + 1, 30);
    put(current + 1, future);
    stop_observation_flash_service(reader);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 3,
            "wrong source and future ignored");
    flash[0].header.commit = HISTORY_JOURNAL_ERASED;
    s_rebuild              = true;
    stop_observation_flash_service(reader);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "missing or torn indexed hour stays unobserved");
    require(stop_observation_report().partial, "torn hour reports incomplete");
    flash[0].header.commit = HISTORY_JOURNAL_COMMITTED;
    flash[0].payload.counters.witnessed_stops_recent_heating ^= 1;
    boot(false);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "CRC damage refused at reboot");
}
void queue_and_saturation() {
    boot();
    for (int hour = 0; hour < 7; ++hour) tick(hour * 3600 + 1, true, event(hour * 3600));
    require(stop_observation_report().dropped > 0, "bounded queue overflow explicit");
    require(stop_observation_report().partial, "queue overflow incomplete");
    drain();
    bool retained_loss = false;
    for (size_t i = 0; i < next_slot; ++i)
        retained_loss |= flash[i].payload.flags & OBSERVATION_QUEUE_LOSS;
    require(retained_loss, "overflow persisted on subsequent successful write");
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 2, payload(current - 2, 65535));
    put(current - 1, payload(current - 1, 1));
    stop_observation_flash_service(reader);
    auto r = stop_observation_report();
    require(r.counters.witnessed_stops_recent_heating == 65535 && r.counters.saturated,
            "aggregate counters saturate explicitly");
}
void restored_loss_watermark() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    auto          loss    = payload(current - 23, 1);
    loss.flags            = OBSERVATION_PARTIAL | OBSERVATION_QUEUE_LOSS;
    loss.dropped          = 7;
    put(current - 23, loss);
    boot(false);
    require(stop_observation_report().dropped == 7, "committed loss watermark restores");
    tick(10);
    tick(20);
    tick(3605);
    stop_observation_flash_service(reader);
    drain();
    require(next_slot > 1 && flash[next_slot - 1].payload.dropped == 7,
            "next completed hour commits the restored loss watermark");
    sdk::now_us += OBSERVATION_HOUR_US;
    stop_observation_flash_service(reader);
    const auto after = stop_observation_report();
    require(after.dropped == 7 && after.partial,
            "restored loss stays visible when its original hour expires");
    boot(false);
    require(stop_observation_report().dropped == 7,
            "subsequent hours preserve the restored watermark through another reboot");
    stop_observation_reset();
    stop_observation_bind(101, 202, 303, 8, false);
    drain();
    require(stop_observation_report().dropped == 0,
            "explicit durable reset retires loss watermark");
}
void reader_scratch_isolation() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 2, payload(current - 2, 3));
    put(current - 1, payload(current - 1, 8));
    int64_t                  bucket   = -1;
    uint64_t                 sequence = 0;
    ObservationHourlyPayload first, second;
    require(reader(0, bucket, sequence, first) &&
                first.counters.witnessed_stops_recent_heating == 3,
            "exact physical observation reader admits committed data");
    require(reader(1, bucket, sequence, second) &&
                second.counters.witnessed_stops_recent_heating == 8,
            "sector scratch can be reused for the next physical record");
    require(first.counters.witnessed_stops_recent_heating == 3,
            "reader output owns its bytes after scratch reuse");
    flash[1].header.crc ^= 1;
    require(!reader(1, bucket, sequence, first) &&
                first.counters.witnessed_stops_recent_heating == 3,
            "CRC failure cannot publish corrupted scratch bytes");
    flash[1].header.crc ^= 1;
    flash[1].header.commit = HISTORY_JOURNAL_ERASED;
    require(!reader(1, bucket, sequence, first), "reader rejects an uncommitted record");
    flash[1].header.commit = HISTORY_JOURNAL_COMMITTED;
    flash[1].header.flags  = HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST;
    require(!reader(1, bucket, sequence, first),
            "reader never admits a manifest as an observation");
    require(!reader(512, bucket, sequence, first), "physical read failure stays unavailable");
}
void long_retention_and_expiry() {
    boot();
    // Nine days with two revisions/hour; no hour raster is retained in RAM.
    for (int hour = 0; hour < 216; ++hour) {
        sdk::now_us          = static_cast<int64_t>(hour + 1) * OBSERVATION_HOUR_US + 1000000;
        const int64_t bucket = observation_bucket(sdk::origin_us + sdk::now_us) - 1;
        put(bucket, payload(bucket, 1));
        put(bucket, payload(bucket, 2));
        stop_observation_flash_service(reader);
    }
    require(!s_index.clipped, "normal nine-day revision rotation does not clip");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 46,
            "23 completed current latest revisions retained");
    const unsigned reads = sdk::reads;
    sdk::now_us += 25 * OBSERVATION_HOUR_US;
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "archive expires even without producer or flash service");
    require(sdk::reads == reads, "expiry report never reads flash");
    stop_observation_flash_service(reader);
    require(stop_observation_report().readable_us == 0, "expiry rebuild retires elapsed archive");
}
void idle_clock_correction() {
    boot();
    sdk::now_us          = 3 * OBSERVATION_HOUR_US;
    const int64_t bucket = observation_bucket(sdk::origin_us + sdk::now_us) - 1;
    put(bucket, payload(bucket, 2));
    stop_observation_flash_service(reader);
    const auto before = stop_observation_report();
    require(before.confirmed && before.dated && before.counters.witnessed_stops_recent_heating == 2,
            "restored-only positive control has dated counters");
    sdk::origin_us -= 2 * OBSERVATION_HOUR_US;
    const auto after = stop_observation_report();
    require(after.confirmed && !after.dated && after.partial,
            "idle backward wall correction withdraws date without withdrawing source");
    require(after.readable_us == 0 && after.counters.witnessed_stops_recent_heating == 0,
            "future cached hour withheld after clock correction");
    require(after.persistence_pending, "clock invalidation requires durable fence");
    drain();
    require(!stop_observation_report().dated, "committed fence cannot revalidate a broken anchor");
    boot(false);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "clock fence prevents old hour resurrection after reboot");

    // Exercise the cached service fast path without a preceding report or producer update.
    boot();
    sdk::now_us += 2 * OBSERVATION_HOUR_US;
    const int64_t second = observation_bucket(sdk::origin_us + sdk::now_us) - 1;
    put(second, payload(second, 3));
    stop_observation_flash_service(reader);
    sdk::origin_us += 3 * 1000000;
    stop_observation_flash_service(reader);
    const auto service = stop_observation_report();
    require(service.confirmed && !service.dated && service.readable_us == 0,
            "idle forward clock correction invalidates service cache");
}

void compatibility() {
    boot();
    const int64_t bucket = observation_bucket(sdk::origin_us + sdk::now_us) - 1;
    const auto    s      = make_slot(bucket, payload(bucket), 999);
    require(history_journal_checkup_header_structural_matches(s.header, CHECKUP_DT_S),
            "old structural reader sees new record physical head");
    require(s.header.crc ==
                history_journal_crc_bytes(s.header, &s.payload, OBSERVATION_PAYLOAD_BYTES),
            "old physical CRC unchanged");
    require(!history_journal_header_matches(s.header, checkup_journal_fingerprint(),
                                            CHECKUP_JOURNAL_WORDS, CHECKUP_DT_S),
            "core fingerprint refuses observation payload");
    require(HISTORY_JOURNAL_SOURCE_COUNT == 5 && HISTORY_JOURNAL_SLOT_BYTES == 256,
            "wire source count and physical slot unchanged");
    require(sizeof(CheckupBucket) == 80 && sizeof(CheckupJournalPayload) == 128,
            "core RAM and payload untouched");
    auto             clean        = payload(bucket);
    auto             poisoned     = clean;
    constexpr size_t counter_tail = offsetof(StopContextCounters, saturated) + sizeof(bool);
    constexpr size_t wire_tail    = offsetof(ObservationHourlyPayload, dropped) + sizeof(uint16_t);
    std::memset(reinterpret_cast<uint8_t*>(&poisoned.counters) + counter_tail, 0xa5,
                sizeof(StopContextCounters) - counter_tail);
    std::memset(reinterpret_cast<uint8_t*>(&poisoned) + wire_tail, 0xa5,
                sizeof(ObservationHourlyPayload) - wire_tail);
    uint8_t a[OBSERVATION_PAYLOAD_BYTES], b[OBSERVATION_PAYLOAD_BYTES];
    observation_encode(clean, a);
    observation_encode(poisoned, b);
    require(std::memcmp(a, b, sizeof(a)) == 0, "wire encoding ignores source padding bytes");
    std::cout << "ABI payload=" << sizeof(ObservationHourlyPayload)
              << " counters=" << sizeof(StopContextCounters)
              << " event=" << sizeof(StopContextEvent)
              << " index_entry=" << sizeof(ObservationIndexEntry)
              << " index=" << sizeof(ObservationIndex) << " queue=" << sizeof(s_queue)
              << " report=" << sizeof(StopObservationReport) << '\n';
}
void clock_and_undated() {
    boot();
    sdk::synced = false;
    tick(10, true, event(9));
    require(!stop_observation_report().dated, "unsynced hour not dated");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "undated stop not transplanted to sync time");
    sdk::synced = true;
    tick(20, true, event(19));
    require(stop_observation_report().dated, "fresh dated sample starts own coverage");
    require(stop_observation_report().readable_us == 0, "no fabricated pre-sync coverage");
    sdk::origin_us += 5 * 1000000;
    tick(30, true, event(29));
    require(!stop_observation_report().dated, "clock correction refuses old monotonic anchor");
    stop_observation_reset();
    stop_observation_bind(101, 202, 303, 7, false);
    drain();
    tick(40, true, event(39));
    require(stop_observation_report().dated, "explicit reset safely establishes a fresh anchor");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
            "clock mismatch did not restore earlier counters");
    stop_observation_record(sdk::now_us - 1000000, true);
    require(stop_observation_report().dated, "stale measurement does not poison current clock");
    sdk::now_us -= 1000000;
    stop_observation_record(sdk::now_us, true);
    require(!stop_observation_report().dated, "actual backwards monotonic clock refused");
}
void reset_before_commit() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 1, payload(current - 1, 9));
    stop_observation_flash_service(reader);
    stop_observation_reset();
    require(stop_observation_report().persistence_pending,
            "reset cannot claim durable success before commit");
    // This deliberately proves the documented power-loss boundary. RAM cannot remember a reset
    // whose fence never reached flash; neither a made-up epoch nor an NVS write conceals it.
    boot(false);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 9,
            "pre-commit reset is not falsely claimed durable across power loss");
}
void barrier_pressure_and_epoch() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 1, payload(current - 1, 4));
    for (int i = 0; i < 55; ++i) {
        auto p          = payload(current);
        p.first_unix_us = p.last_unix_us = current * OBSERVATION_HOUR_US;
        p.counters                       = {};
        p.readable_us                    = 0;
        p.identity.source_fp             = 500 + i;
        p.flags                          = OBSERVATION_BARRIER;
        put(current, p);
    }
    stop_observation_flash_service(reader);
    require(s_index.clipped && stop_observation_report().partial,
            "in-day fence pressure is explicit and incomplete");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "lost fence candidates cannot restore pre-reset evidence");
    sdk::now_us += 25 * OBSERVATION_HOUR_US;
    const int64_t later = observation_bucket(sdk::origin_us + sdk::now_us);
    put(later - 1, payload(later - 1, 2));
    stop_observation_flash_service(reader);
    require(!s_index.clipped, "pressure refusal expires with the affected rolling day");
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 2,
            "new compatible hour returns after pressure expiry");
    s_rebuild   = true;
    before_read = [] { stop_observation_reset(); };
    stop_observation_flash_service(reader);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "reset during one-record read prevents stale aggregate swap");
    require(stop_observation_report().persistence_pending,
            "concurrent reset still requires its durable fence");
}
void identity_and_invalid_wire() {
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    auto          p       = payload(current - 1, 5);
    p.identity.model_fp ^= 1;
    put(current - 1, p);
    p = payload(current - 2, 6);
    p.identity.schema_fp ^= 1;
    put(current - 2, p);
    p = payload(current - 3, 7);
    p.identity.consent_generation ^= 1;
    put(current - 3, p);
    p                       = payload(current - 4, 1);
    p.counters.evaluable[0] = 2;
    put(current - 4, p);
    stop_observation_flash_service(reader);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "model/schema/consent and impossible populations refused independently");
    auto wire = make_slot(current - 5, payload(current - 5), 1000);
    wire.header.catalog_fp ^= 1;
    require(!observation_header_matches(wire.header), "method/catalog mismatch refused");
    wire               = make_slot(current - 5, payload(current - 5), 1000);
    wire.header.source = static_cast<uint8_t>(HistoryJournalSource::Room);
    require(!observation_header_matches(wire.header), "different physical source refused");
    wire = make_slot(current - 5, payload(current - 5), 1000);
    wire.header.value_count -= 1;
    require(!observation_header_matches(wire.header), "wrong payload width refused");
}
void clock_lock_interleaves() {
    boot();
    tick(3590);
    sdk::before_take  = [] { tick(3605); };
    const auto report = stop_observation_report();
    require(report.dated && s_open_bucket == observation_bucket(sdk::origin_us + sdk::now_us),
            "waiting report cannot close the producer's newer open hour");
    require(s_open.readable_us == 5000000, "report preserves new-hour endpoint coverage");
    boot();
    tick(3590);
    sdk::before_take = [] { tick(3605); };
    stop_observation_record(3591LL * 1000000, true);
    require(stop_observation_report().dated && s_last_sample_us == 3605LL * 1000000,
            "waiting stale producer is ignored without marking the current clock invalid");
    s_rebuild        = true;
    sdk::before_take = [] { tick(7205); };
    stop_observation_flash_service(reader);
    require(s_open_bucket == observation_bucket(sdk::origin_us + sdk::now_us),
            "waiting archive service preserves a newer live hour");
    boot();
    const int64_t current = observation_bucket(sdk::origin_us + sdk::now_us);
    put(current - 23, payload(current - 23, 8));
    before_read = [] { sdk::now_us += OBSERVATION_HOUR_US; };
    stop_observation_flash_service(reader);
    require(stop_observation_report().counters.witnessed_stops_recent_heating == 0,
            "hour expiring during flash read cannot be published as fresh aggregate");
    require(stop_observation_report().restore_pending,
            "expired rebuild remains pending for a new bounded reconstruction");
}
} // namespace

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("one case required");
        const std::string name = argv[1];
        if (name == "late_replay")
            late_replay();
        else if (name == "independent_clock")
            independent_clock();
        else if (name == "busy_and_failure")
            busy_and_failure();
        else if (name == "reset_and_consent")
            reset_and_consent();
        else if (name == "restore_guards")
            restore_guards();
        else if (name == "queue_and_saturation")
            queue_and_saturation();
        else if (name == "restored_loss_watermark")
            restored_loss_watermark();
        else if (name == "reader_scratch_isolation")
            reader_scratch_isolation();
        else if (name == "long_retention_and_expiry")
            long_retention_and_expiry();
        else if (name == "compatibility")
            compatibility();
        else if (name == "idle_clock_correction")
            idle_clock_correction();
        else if (name == "clock_and_undated")
            clock_and_undated();
        else if (name == "reset_before_commit")
            reset_before_commit();
        else if (name == "barrier_pressure_and_epoch")
            barrier_pressure_and_epoch();
        else if (name == "identity_and_invalid_wire")
            identity_and_invalid_wire();
        else if (name == "clock_lock_interleaves")
            clock_lock_interleaves();
        else
            throw std::runtime_error("unknown case");
        std::cout << name << ": " << assertions << " assertions passed\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "FAIL " << (argc > 1 ? argv[1] : "") << ": " << e.what() << '\n';
        return 1;
    }
}
