// Actual store TU and codecs. Only SDK clocks/mutexes and physical flash are adapters.
#include "sdk.hpp"
#include "hydronic_observation_store.cpp"
#include "logic/checkup_persist.hpp"
#include <array>
#include <iostream>
#include <stdexcept>
#include <string>

namespace daik {
bool time_synced() { return sdk::synced; }
void time_now(int64_t& seconds, int32_t& ms) {
    const int64_t at = sdk::origin_us + sdk::now_us;
    seconds          = at / 1000000;
    ms               = static_cast<int32_t>((at % 1000000) / 1000);
}
} // namespace daik
namespace {
using namespace daik;
using namespace daik::logic;
struct Slot {
    HistoryJournalHeader                               header{};
    std::array<uint8_t, HISTORY_JOURNAL_PAYLOAD_BYTES> bytes{};
};
std::array<Slot, HISTORY_JOURNAL_SLOT_COUNT> flash;
uint64_t                                     next_sequence = 1;
uint16_t                                     next_slot     = 0;
unsigned                                     assertions    = 0;
void (*before_read)()                                      = nullptr;
uint16_t retry_slot                                        = UINT16_MAX;
void     require(bool condition, const char* oracle) {
    ++assertions;
    if (!condition) throw std::runtime_error(oracle);
}
const ObservationIndex& inspected_index() {
    require(s_index_ready, "fixture inspects only a constructed Flash-owner index");
    return s_index_storage.index;
}
int64_t            wall() { return sdk::origin_us + sdk::now_us; }
int64_t            current_bucket() { return observation_bucket(wall()); }
HydronicReadResult reader(uint16_t slot, int64_t& bucket, uint64_t& sequence,
                          HydronicHourlyPayload& p) {
    ++sdk::reads;
    require(!sdk::mutex.owned, "flash reader runs outside Store lock");
    if (before_read) {
        const auto hook = before_read;
        before_read     = nullptr;
        hook();
    }
    if (slot == retry_slot) return HydronicReadResult::Retry;
    if (slot >= flash.size()) return HydronicReadResult::Invalid;
    const auto& stored = flash[slot];
    const auto& h      = stored.header;
    if (!hydronic_header_matches(h) ||
        h.crc != history_journal_crc_bytes(h, stored.bytes.data(), HYDRONIC_PAYLOAD_BYTES) ||
        !hydronic_decode(stored.bytes.data(), HYDRONIC_PAYLOAD_BYTES, h, p))
        return HydronicReadResult::Invalid;
    bucket   = h.bucket;
    sequence = h.sequence;
    return HydronicReadResult::Valid;
}
Slot make_slot(int64_t bucket, const HydronicHourlyPayload& p, uint64_t sequence,
               bool legacy = false) {
    Slot  slot;
    auto& h       = slot.header;
    h.magic       = HISTORY_JOURNAL_MAGIC;
    h.version     = HISTORY_JOURNAL_VERSION;
    h.source      = static_cast<uint8_t>(HistoryJournalSource::Checkup);
    h.catalog_fp  = hydronic_fingerprint();
    h.commit      = HISTORY_JOURNAL_COMMITTED;
    h.value_count = HYDRONIC_WORDS;
    h.slot_bytes  = HISTORY_JOURNAL_SLOT_BYTES;
    h.sequence    = sequence;
    h.bucket      = bucket;
    h.dt_s        = 3600;
    h.rings[0]    = TREND_COUNT;
    h.rings[1]    = HOMEHUB_HISTORY_COUNT;
    h.rings[2]    = ENV3_HISTORY_COUNT;
    std::memset(h.pad, 0xff, sizeof(h.pad));
    hydronic_encode(p, slot.bytes.data(), h);
    if (legacy) h.pad[8] = h.pad[9] = 0xff;
    h.crc = history_journal_crc_bytes(h, slot.bytes.data(), HYDRONIC_PAYLOAD_BYTES);
    return slot;
}
// Adapter models History's required ordering; the actual History integration has a separate
// root-owned fixture. A recognizable bad current format cannot be silently skipped as data.
void scan_slot(uint16_t slot) {
    const auto& stored = flash[slot];
    const auto& h      = stored.header;
    if (!hydronic_header_recognizable(h)) return;
    HydronicHourlyPayload p;
    if (!hydronic_header_matches(h) ||
        h.crc != history_journal_crc_bytes(h, stored.bytes.data(), HYDRONIC_PAYLOAD_BYTES) ||
        !hydronic_decode(stored.bytes.data(), HYDRONIC_PAYLOAD_BYTES, h, p)) {
        hydronic_observation_flash_index_incomplete();
        return;
    }
    hydronic_observation_flash_index(h.bucket, h.sequence, slot, p);
}
void reindex() {
    hydronic_observation_flash_index_reset();
    for (uint16_t i = 0; i < flash.size(); ++i) scan_slot(i);
}
void boot(bool clear = true, uint32_t consent = 11, bool service = true) {
    // Fixture-only model of a new process's static initialization. Production Start cannot
    // clear the privacy latch or replace its published handle within the same boot.
    s_forget_latched.store(false, std::memory_order_relaxed);
    s_mutex.store(nullptr, std::memory_order_relaxed);
    // Reuse only trivially destructible storage to model fresh process static initialization.
    // This adapter is not a public lifecycle operation and never seeds observation contents.
    ::new (&s_index_storage) HydronicIndexStorage;
    s_index_ready = false;
    if (clear) {
        flash          = {};
        next_sequence  = 1;
        next_slot      = 0;
        sdk::now_us    = 1000000;
        sdk::origin_us = 1699999200LL * 1000000;
        sdk::synced    = true;
    } else {
        // Realistic replacement monotonic epoch with exactly the same wall-clock date.
        sdk::origin_us += sdk::now_us - 1000000;
        sdk::now_us = 1000000;
    }
    hydronic_observation_start(true, consent);
    hydronic_observation_bind(101, 202, 303, 7);
    reindex();
    if (service) hydronic_observation_flash_service(reader);
}
HydronicHourlyPayload payload(int64_t bucket, uint32_t samples = 1,
                              uint32_t observed = static_cast<uint32_t>(OBSERVATION_HOUR_US)) {
    HydronicHourlyPayload p;
    p.identity      = {101, 202, 303, 11};
    p.first_unix_us = bucket * OBSERVATION_HOUR_US;
    p.last_unix_us  = p.first_unix_us + OBSERVATION_HOUR_US - 1;
    p.observed_us = p.candidate_us = p.qualified_us = observed;
    p.samples = p.command_samples = samples;
    if (samples) {
        p.first_accepted_unix_us = p.first_unix_us + 1000000;
        p.last_accepted_unix_us  = p.first_accepted_unix_us + (samples > 1 ? 1000000 : 0);
        p.spread                 = {static_cast<int64_t>(6000) * samples, 6000, 6000};
        p.flow                   = {static_cast<int64_t>(10000) * samples, 10000, 10000};
        p.command                = {static_cast<int64_t>(40000) * samples, 40000, 40000};
        p.flow_min_evidence      = hydronic_minimum_slot(p.first_accepted_unix_us);
    }
    if (observed >= 2) {
        p.duration_edges = HYDRONIC_DUR_BOTH;
    } else if (observed == 1) {
        p.last_unix_us   = samples ? p.last_accepted_unix_us : p.first_unix_us;
        p.duration_edges = samples ? HYDRONIC_DUR_FIRST : HYDRONIC_DUR_BOTH;
    } else if (samples) {
        p.first_unix_us = p.first_accepted_unix_us;
        p.last_unix_us  = p.last_accepted_unix_us;
    }
    return p;
}
void put(int64_t bucket, const HydronicHourlyPayload& p, bool legacy = false) {
    flash[next_slot] = make_slot(bucket, p, next_sequence++, legacy);
    scan_slot(next_slot);
    next_slot = (next_slot + 1) % flash.size();
}
void tick_us(int64_t from_us, int64_t to_us, bool accepted, bool command, bool observed,
             bool qualified, int32_t flow_milli = 10000) {
    sdk::now_us = to_us;
    HydronicDelta d;
    d.to_us   = sdk::now_us;
    d.from_us = from_us;
    if (observed && from_us >= 0) {
        d.observed_us = d.candidate_us = d.to_us - d.from_us;
        if (qualified) d.qualified_us = d.observed_us;
    }
    d.accepted         = accepted;
    d.command_accepted = accepted && command;
    d.spread_milli     = 6000;
    d.flow_milli       = flow_milli;
    d.command_milli    = 40000;
    if (!command) d.limitations |= HydronicCommandUnavailable;
    hydronic_observation_record(d);
}
void tick(int64_t from_s, int64_t to_s, bool accepted = true, bool command = true,
          bool observed = true, bool qualified = true) {
    tick_us(from_s < 0 ? -1 : from_s * 1000000, to_s * 1000000, accepted, command, observed,
            qualified);
}
HydronicSample heating_sample() {
    HydronicSample s;
    s.supported = s.command_supported = true;
    s.leaving_known = s.return_known = s.flow_known = s.rps_known = s.command_known = true;
    s.leaving_c                                                                     = 40;
    s.return_c                                                                      = 34;
    s.flow_l_min                                                                    = 10;
    s.rps                                                                           = 30;
    s.command_signal                                                                = 60;
    s.pump      = HydronicBit::On;
    s.valve_dhw = s.defrost = s.buh1 = s.buh2 = HydronicBit::Off;
    s.mode                                    = HydronicMode::Heating;
    s.phase_supported                         = HYDRONIC_ALL_PHASES;
    for (auto& phase : s.phase) phase = HydronicBit::Off;
    return s;
}
bool append(bool busy = false) {
    int64_t               bucket;
    HydronicHourlyPayload p;
    if (!hydronic_observation_flash_next(reader, bucket, p)) return false;
    require(hydronic_hourly_valid(p, bucket), "every issued payload has valid explicit fields");
    flash[next_slot] = make_slot(bucket, p, next_sequence);
    if (busy) sdk::mutex.owned = true;
    hydronic_observation_flash_appended(bucket, next_sequence++, next_slot, p);
    next_slot = (next_slot + 1) % flash.size();
    if (busy) {
        const unsigned reads = sdk::reads;
        hydronic_observation_flash_service(reader);
        require(sdk::reads == reads, "busy flash service does not block or call reader");
        sdk::mutex.owned = false;
    }
    hydronic_observation_flash_service(reader);
    return true;
}
void drain() {
    for (unsigned i = 0; i < 20 && append(); ++i) {}
}
void codec() {
    auto p = payload(100, 2);
    require(hydronic_hourly_valid(p, 100), "valid dated stats payload");
    std::array<uint8_t, HYDRONIC_PAYLOAD_BYTES + 2> bytes;
    bytes.fill(0xa5);
    HistoryJournalHeader wire_header{};
    wire_header.bucket = 100;
    hydronic_encode(p, bytes.data(), wire_header);
    require(bytes[HYDRONIC_PAYLOAD_BYTES] == 0xa5 && bytes.back() == 0xa5,
            "codec writes exact width without tail padding");
    require(bytes[0] == 101 && bytes[1] == 0 && bytes[4] == 202 && bytes[8] == 47 &&
                bytes[9] == 1 && bytes[122] == HYDRONIC_DUR_BOTH && bytes[123] == 0,
            "explicit little endian identity, timed edges and reserved byte");
    HydronicHourlyPayload decoded;
    require(hydronic_decode(bytes.data(), HYDRONIC_PAYLOAD_BYTES, wire_header, decoded),
            "codec round trip");
    require(decoded.samples == 2 && decoded.flow.sum_milli == 20000 &&
                decoded.first_accepted_unix_us == p.first_accepted_unix_us &&
                decoded.duration_edges == HYDRONIC_DUR_BOTH,
            "codec retains independent sample and UTC fields");
    p.spread = {-2000, -1000, -1000};
    hydronic_encode(p, bytes.data(), wire_header);
    require(hydronic_decode(bytes.data(), HYDRONIC_PAYLOAD_BYTES, wire_header, decoded) &&
                decoded.spread.sum_milli == -2000 && decoded.spread.min_milli == -1000,
            "portable signed negative spread decode");
    require(hydronic_signed64(UINT64_MAX) == -1 && hydronic_signed64(1ULL << 63) == INT64_MIN &&
                hydronic_signed32(UINT32_MAX) == -1 && hydronic_signed32(1u << 31) == INT32_MIN,
            "signed decoding covers extrema without out-of-range conversion");
    bytes[123] = 1;
    require(!hydronic_decode(bytes.data(), HYDRONIC_PAYLOAD_BYTES, wire_header, decoded),
            "reserved bits refused");
    bytes[123] = 0;
    bytes[122] = 0x80;
    require(!hydronic_decode(bytes.data(), HYDRONIC_PAYLOAD_BYTES, wire_header, decoded),
            "unknown duration edge bit refused");
    require(!hydronic_decode(bytes.data(), HYDRONIC_PAYLOAD_BYTES - 1, wire_header, decoded) &&
                !hydronic_decode(nullptr, HYDRONIC_PAYLOAD_BYTES, wire_header, decoded),
            "wrong or absent bytes refused");
    const auto valid = payload(100);
    for (unsigned i = 0; i < 21; ++i) {
        auto bad = valid;
        switch (i) {
        case 0:
            bad.identity.source_fp = 0;
            break;
        case 1:
            bad.identity.model_fp = 0;
            break;
        case 2:
            bad.identity.schema_fp = 0;
            break;
        case 3:
            bad.first_unix_us = -1;
            break;
        case 4:
            bad.last_unix_us = bad.first_unix_us - 1;
            break;
        case 5:
            ++bad.last_unix_us;
            break;
        case 6:
            bad.observed_us = UINT32_MAX;
            break;
        case 7:
            --bad.observed_us;
            break;
        case 8:
            --bad.candidate_us;
            break;
        case 9:
            ++bad.command_samples;
            break;
        case 10:
            bad.flags = 0x8000;
            break;
        case 11:
            bad.limitations = 0x80;
            break;
        case 12:
            bad.flow.min_milli = 0;
            break;
        case 13:
            bad.spread.sum_milli = INT64_MAX;
            break;
        case 14:
            bad.command.max_milli = 100001;
            break;
        case 15:
            bad.first_accepted_unix_us = -1;
            break;
        case 16:
            --bad.last_accepted_unix_us;
            break;
        case 17:
            bad.last_accepted_unix_us = bad.last_unix_us + 1;
            break;
        case 18:
            bad.kind = static_cast<HydronicHourlyKind>(0);
            break;
        case 19:
            bad.kind = HydronicHourlyKind::Fence;
            break;
        case 20:
            bad.dropped = 1;
            break;
        }
        require(!hydronic_hourly_valid(bad, 100), "inconsistent field rejected");
    }
    auto empty = payload(100, 0);
    require(hydronic_hourly_valid(empty, 100), "durations without accepted samples are valid");
    empty.command.min_milli = 1;
    require(!hydronic_hourly_valid(empty, 100), "empty command population has no invented range");
    require(!hydronic_hourly_valid(valid, 99) && !hydronic_hourly_valid(valid, -1),
            "wrong hour refused");
    auto into = payload(100, 1, 1000), add = payload(100, 1, 2000);
    into.last_unix_us           = into.first_unix_us + 1000;
    into.first_accepted_unix_us = into.last_accepted_unix_us = into.last_unix_us;
    into.duration_edges                                      = HYDRONIC_DUR_FIRST;
    add.first_unix_us                                        = into.last_unix_us;
    add.last_unix_us                                         = add.first_unix_us + 2000;
    add.first_accepted_unix_us = add.last_accepted_unix_us = add.last_unix_us;
    add.duration_edges                                     = HYDRONIC_DUR_FIRST;
    add.spread                                             = {10000, 10000, 10000};
    require(hydronic_hourly_merge(into, add) && into.samples == 2 &&
                into.spread.sum_milli == 16000 && into.spread.min_milli == 6000 &&
                into.spread.max_milli == 10000,
            "sample weighted exact-hour delta merge");
    add.identity.consent_generation++;
    require(!hydronic_hourly_merge(into, add) && into.samples == 2,
            "identity merge refusal is atomic");
    auto max            = payload(100, UINT32_MAX, 1);
    auto extra          = payload(100, 1, 0);
    extra.first_unix_us = extra.last_unix_us = max.last_unix_us;
    extra.first_accepted_unix_us = extra.last_accepted_unix_us = extra.last_unix_us;
    require(!hydronic_hourly_merge(max, extra) && max.samples == UINT32_MAX,
            "sample overflow refusal preserves last good payload");
    auto header = make_slot(100, valid, 1).header;
    require(hydronic_header_matches(header) && !observation_header_matches(header) &&
                hydronic_fingerprint() != checkup_journal_fingerprint(),
            "HYDR is distinct from Core and STOP");
    require(history_journal_checkup_header_structural_matches(header, 3600),
            "older firmware sees physical envelope");
    header.catalog_fp = observation_fingerprint();
    require(!hydronic_header_matches(header), "STOP format never admitted as HYDR");
    header.catalog_fp = hydronic_fingerprint();
    header.value_count++;
    require(!hydronic_header_matches(header), "exact width is part of format binding");
    header.value_count = HYDRONIC_WORDS;
    header.source      = 0;
    require(!hydronic_header_matches(header), "physical source binding");
    require(hydronic_header_recognizable(header),
            "damaged source does not conceal recognizable reset format");
    header.commit = HISTORY_JOURNAL_ERASED;
    require(!hydronic_header_recognizable(header),
            "uncommitted frame cannot establish a durable fence");
    require(HISTORY_JOURNAL_SOURCE_COUNT == 5 && HISTORY_JOURNAL_SLOT_BYTES == 256 &&
                HISTORY_JOURNAL_PAYLOAD_BYTES == 192 && sizeof(CheckupBucket) == 80,
            "unchanged physical source, slot, payload and core bucket budgets");
    std::cout << "Host sizes: payload=" << sizeof(HydronicHourlyPayload)
              << " wire=" << HYDRONIC_PAYLOAD_BYTES << " totals=" << sizeof(HydronicTotals)
              << " report=" << sizeof(HydronicObservationReport) << " queue=" << sizeof(s_queue)
              << " index=" << sizeof(ObservationIndex)
              << " flash_scratch=" << sizeof(s_hydronic_flash_payload)
              << " archive_edges=" << sizeof(s_archive)
              << " staged_edges=" << sizeof(s_staged_archive)
              << " fingerprint=" << hydronic_fingerprint() << '\n';
}
void seam_and_revisions() {
    boot();
    tick(-1, 3595);
    tick(3595, 3605, true, false);
    auto r = hydronic_observation_report();
    require(r.totals.samples == 2 && r.totals.command_samples == 1 &&
                r.totals.observed_us == 10000000 && r.totals.qualified_us == 10000000,
            "seam preserves sample populations and exact admitted interval");
    require(append(), "closed seam hour persisted");
    HydronicHourlyPayload p;
    int64_t               bucket;
    uint64_t              sequence;
    require(reader(0, bucket, sequence, p) == HydronicReadResult::Valid && p.samples == 1 &&
                p.observed_us == 5000000 && p.duration_edges == HYDRONIC_DUR_BOTH &&
                p.last_unix_us == (bucket + 1) * OBSERVATION_HOUR_US - 1,
            "old hour owns only its real endpoint and interval half");
    require(r.totals.last_accepted_unix_us == sdk::origin_us + 3605LL * 1000000,
            "accepted timestamps are dated UTC");
    tick(3605, 3610);
    hydronic_observation_seal();
    drain();
    boot(false);
    r = hydronic_observation_report();
    require(r.totals.samples == 3 && r.totals.command_samples == 2 &&
                r.totals.observed_us == 15000000,
            "closed hours restore exactly once across replacement monotonic epoch");
    require(r.totals.first_evidence_unix_us < r.totals.first_accepted_unix_us + 1,
            "evidence and acceptance dates retained separately");

    boot();
    tick(-1, 5);
    sdk::now_us = 3601LL * 1000000;
    hydronic_observation_report();
    require(append(), "first same-hour revision");
    HydronicDelta late;
    late.to_us    = 10LL * 1000000;
    late.accepted = late.command_accepted = true;
    late.spread_milli                     = 10000;
    late.flow_milli                       = 20000;
    late.command_milli                    = 60000;
    hydronic_observation_record(late);
    require(hydronic_observation_report().totals.samples == 2, "late uncommitted delta visible");
    require(append(), "same-hour correction appended");
    require(hydronic_observation_report().totals.samples == 2 &&
                hydronic_observation_report().totals.spread.sum_milli == 16000,
            "latest revision merges prior exact-identity base without double counting");
    boot(false);
    require(hydronic_observation_report().totals.samples == 2,
            "latest physical revision restored once");
}
void overlapping_archive_fragment(bool drain_later = false) {
    constexpr int64_t second = 1000000;
    boot();
    const int64_t hour     = current_bucket();
    auto          archived = payload(hour, 1, 1800 * second);
    archived.last_unix_us  = archived.first_unix_us + 1800 * second - 1;
    put(hour, archived);
    const uint64_t sequence_after_archive = next_sequence;
    const size_t   slot_after_archive     = next_slot;

    // The replacement clock starts ten minutes into an already recorded half hour. Delay the
    // archive reader until both individually valid fragments are in the past of that clock.
    sdk::now_us = 600 * second;
    boot(false, 11, false);
    tick(-1, 1, false, false);
    for (int sec = 16; sec <= 1201; sec += 15) tick(sec - 15, sec, true, false);
    hydronic_observation_flash_service(reader);
    auto r = hydronic_observation_report();
    require(r.partial && r.totals.observed_us == 1800 * second && r.totals.samples == 1,
            "live overlap is withheld rather than counted with the archive");

    sdk::now_us = 3001 * second; // hour boundary in the replacement clock
    r           = hydronic_observation_report();
    require(r.persistence_pending && r.totals.observed_us == 1800 * second,
            "queued overlap remains withheld until resolved");
    if (drain_later) {
        tick(-1, 3002);
        hydronic_observation_seal();
        require(append(), "later queued evidence drains in the same turn as a rejected head");
        require(next_sequence == sequence_after_archive + 1 && next_slot == slot_after_archive + 1,
                "only the later valid fragment advances the cursor");
        boot(false);
        r = hydronic_observation_report();
        require(r.dropped == 1 && r.partial && r.totals.observed_us == 1800 * second &&
                    r.totals.samples == 2,
                "drained later record carries the loss and retains the old valid archive");
        return;
    }
    require(!append(), "overlap must not issue an append payload");
    require(next_sequence == sequence_after_archive && next_slot == slot_after_archive,
            "refused overlap does not alter the storage cursor");
    hydronic_observation_flash_service(reader);
    r = hydronic_observation_report();
    require(r.dropped == 1 && r.partial && !r.persistence_pending &&
                r.totals.observed_us == 1800 * second && r.totals.samples == 1,
            "conflicting fragment retires once while the valid archive remains readable");
    require(!append() && hydronic_observation_report().dropped == 1,
            "permanent overlap is not retried");
    tick(-1, 3002);
    hydronic_observation_seal();
    require(append(), "unrelated later evidence still persists");
    boot(false);
    r = hydronic_observation_report();
    require(r.dropped == 1 && r.partial && r.totals.observed_us == 1800 * second &&
                r.totals.samples == 2,
            "later restoration keeps the original archive and visible loss without overlap");
}
void disjoint_earlier_archive_fragment() {
    constexpr int64_t second = 1000000;
    boot();
    const int64_t hour     = current_bucket();
    auto          archived = payload(hour, 1, 600 * second);
    archived.first_unix_us += 1200 * second;
    archived.last_unix_us           = archived.first_unix_us + 600 * second - 1;
    archived.first_accepted_unix_us = archived.last_accepted_unix_us = archived.first_unix_us;
    archived.flow_min_evidence = hydronic_minimum_slot(archived.first_accepted_unix_us);
    put(hour, archived);
    sdk::now_us = 300 * second;
    boot(false, 11, false);
    tick(-1, 1, false, false);
    for (int sec = 16; sec <= 301; sec += 15) tick(sec - 15, sec, true, false);
    sdk::now_us = 1501 * second;
    hydronic_observation_flash_service(reader);
    auto r = hydronic_observation_report();
    require(r.totals.observed_us == 900 * second && r.totals.samples == 21 && !r.dropped,
            "provably earlier disjoint live evidence remains visible with the archive");
    sdk::now_us = 3301 * second;
    require(append(), "earlier disjoint evidence merges without waiting for another source");
    boot(false);
    r = hydronic_observation_report();
    require(r.totals.observed_us == 900 * second && r.totals.samples == 21 && !r.dropped,
            "earlier disjoint revision restores its exact combined population");
}

void shared_duration_edge(bool check_live_report) {
    constexpr int64_t second = 1000000, t = 1200 * second;
    boot();
    tick_us(t - 20 * second, t - 10 * second, false, false, true, false);
    tick_us(t - 5 * second, t + 1, false, false, true, false);
    hydronic_observation_seal();
    require(append(), "gapped duration base persisted through normal Store");
    const auto base = hydronic_observation_report();
    require(base.totals.observed_us == 15 * second + 1 && !base.totals.samples &&
                base.totals.last_evidence_unix_us == sdk::origin_us + t &&
                (base.totals.duration_edges & HYDRONIC_DUR_LAST),
            "archive owns the last timed tick despite the interior gap");

    sdk::now_us = t; // replacement projection shares exactly the last archived tick
    boot(false);
    tick(1, 11, false, false, true, false);
    if (check_live_report)
        require(hydronic_observation_report().totals.observed_us == 15 * second + 1,
                "shared timed tick withheld from live archive report");
    hydronic_observation_seal();
    if (check_live_report) {
        const auto queued = hydronic_observation_report();
        require(queued.persistence_pending && queued.totals.observed_us == 15 * second + 1,
                "queued shared timed tick withheld from archive report");
    }
    const auto sequence = next_sequence;
    const auto slot     = next_slot;
    require(!append() && next_sequence == sequence && next_slot == slot,
            "shared timed tick rejected before append despite space in span");
    const auto retired = hydronic_observation_report();
    require(retired.dropped == 1 && !retired.persistence_pending &&
                retired.totals.observed_us == 15 * second + 1,
            "shared timed tick retires once with prior archive intact");
}

void sample_only_archive_edge(bool older_hour = false) {
    boot();
    if (older_hour) {
        auto earlier         = payload(current_bucket() - 1, 0);
        earlier.candidate_us = earlier.qualified_us = 0;
        put(current_bucket() - 1, earlier);
    }
    const uint64_t observed = 610000000 + (older_hour ? OBSERVATION_HOUR_US : 0);
    auto           sample   = heating_sample();
    sample.rps              = 0;
    HydronicTracker archived;
    for (int64_t at : {3600000000LL, 3610000000LL}) {
        sdk::now_us = at;
        hydronic_observation_record(hydronic_record(archived, sample, at, 1000, 7, 11, true));
    }
    hydronic_observation_seal();
    require(append(), "duration starts at the archived hour edge");
    sdk::now_us = 3000000000LL;
    boot(false, 11, false);
    sample.rps = 30;
    HydronicTracker fresh;
    for (int64_t at = 1000000; at <= 601000000; at += 15000000) {
        sdk::now_us = at;
        hydronic_observation_record(hydronic_record(fresh, sample, at, 1000, 7, 11, true));
    }
    sdk::now_us = 612000000;
    hydronic_observation_flash_service(reader);
    auto r = hydronic_observation_report();
    require(r.totals.observed_us == observed && r.totals.candidate_us == 600000000 &&
                !r.totals.qualified_us && r.totals.samples == 1 &&
                r.totals.last_accepted_unix_us == sdk::origin_us + 601000000 && !r.dropped,
            older_hour ? "sample-only point at newer archived hour edge remains visible"
                       : "sample-only point at first archived duration tick remains visible");
    hydronic_observation_seal();
    r = hydronic_observation_report();
    require(r.persistence_pending && r.totals.samples == 1 && r.totals.observed_us == observed,
            "queued sample-only point stays visible with archived duration");
    require(append() && append(), "adjacent hour and shared-edge point append without loss");
    HydronicHourlyPayload merged;
    int64_t               bucket;
    uint64_t              sequence;
    require(reader(next_slot - 1, bucket, sequence, merged) == HydronicReadResult::Valid &&
                merged.observed_us == 10000000 && merged.samples == 1 &&
                merged.first_accepted_unix_us == merged.first_unix_us &&
                merged.duration_edges == HYDRONIC_DUR_BOTH,
            "same-hour revision retains both duration and point at its first tick");
    boot(false);
    r = hydronic_observation_report();
    require(r.totals.observed_us == observed && r.totals.samples == 1 && !r.dropped,
            "shared-edge revision restores the exact population once");
}

void between_archived_hours() {
    boot();
    const auto hour = current_bucket();
    put(hour - 1, payload(hour - 1, 0));
    put(hour + 1, payload(hour + 1, 0));
    tick(-1, 5);
    sdk::now_us = 2 * OBSERVATION_HOUR_US + 1000000;
    hydronic_observation_flash_service(reader);
    const unsigned reads = sdk::reads;
    const auto     r     = hydronic_observation_report();
    require(r.totals.observed_us == 2 * OBSERVATION_HOUR_US && r.totals.samples == 1 &&
                r.persistence_pending && !r.dropped,
            "queued sample in empty hour between archives remains visible");
    require(sdk::reads == reads, "per-hour report admission does not read flash");
    require(append() && hydronic_observation_report().totals.samples == 1,
            "same unarchived hour appends and rebuilds exactly once");
}

void future_archive_due(bool later_hour) {
    boot();
    const auto hour     = current_bucket() + (later_hour ? 1 : 0);
    auto       future   = payload(hour, 0, 10000001);
    future.last_unix_us = future.first_unix_us + 10000000;
    put(hour, future);
    boot(false);
    require(!hydronic_observation_report().totals.observed_us,
            "quiet boot initially withholds the future archive");
    const int64_t hour_mono = future.first_unix_us - sdk::origin_us;
    if (later_hour) {
        const unsigned prior = sdk::reads;
        sdk::now_us          = hour_mono - 1000;
        hydronic_observation_flash_service(reader);
        require(sdk::reads == prior, "future bucket does not cause early reads");
        sdk::now_us = hour_mono;
        hydronic_observation_flash_service(reader);
        require(sdk::reads == prior + 1 && !hydronic_observation_report().totals.observed_us,
                "bucket opening schedules its later endpoint without early admission");
    }
    const unsigned before = sdk::reads;
    sdk::now_us           = hour_mono + 10000000 - 1000;
    hydronic_observation_flash_service(reader);
    require(sdk::reads == before, "future endpoint waits without polling flash");
    sdk::now_us += 1000;
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.observed_us == 10000001 &&
                sdk::reads == before + 1,
            later_hour ? "quiet service restores future bucket at its admitted endpoint"
                       : "quiet service restores future record at its admitted endpoint");
    hydronic_observation_flash_service(reader);
    require(sdk::reads == before + 1, "restored archive does not keep its expired wake");
}

void future_boundary_during_rebuild() {
    boot();
    auto future         = payload(current_bucket(), 0, 10000001);
    future.last_unix_us = future.first_unix_us + 10000000;
    put(current_bucket(), future);
    before_read = [] { sdk::now_us = 10000000; };
    hydronic_observation_flash_service(reader);
    const auto r = hydronic_observation_report();
    require(r.restore_pending && !r.totals.observed_us,
            "publication cannot close a rebuild that crossed its future admission boundary");
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.observed_us == 10000001,
            "next service rebuilds the newly admissible archive");
}

void saturated_sample_edge() {
    boot();
    tick(-1, 1);
    // Exercise the defensive saturation guard without billions of fixture iterations.
    s_open.samples          = UINT32_MAX;
    s_open.spread.sum_milli = 6000LL * UINT32_MAX;
    s_open.flow.sum_milli   = 10000LL * UINT32_MAX;
    const auto initial      = hydronic_observation_report();
    tick(-1, 2);
    auto r = hydronic_observation_report();
    require(r.totals.samples == UINT32_MAX && r.totals.saturated && r.dropped == 1 &&
                r.totals.last_evidence_unix_us == initial.totals.last_evidence_unix_us &&
                r.totals.last_accepted_unix_us == initial.totals.last_accepted_unix_us &&
                !r.totals.duration_edges,
            "rejected saturated point does not extend evidence");
    tick(2, 3);
    r = hydronic_observation_report();
    require(r.totals.observed_us == 1000000 && r.totals.samples == UINT32_MAX && r.dropped == 2 &&
                r.totals.last_evidence_unix_us == sdk::origin_us + 3000000 - 1 &&
                r.totals.duration_edges == HYDRONIC_DUR_LAST,
            "real duration still reaches its last tick without the rejected sample");
    tick(-1, 3600);
    require(hydronic_observation_report().totals.samples == static_cast<uint64_t>(UINT32_MAX) + 1,
            "prior hour saturation cannot refuse a sample in a fresh hour");
}
void settling_durations() {
    boot();
    auto            s = heating_sample();
    HydronicTracker tracker;
    for (int i = 0; i <= 40; ++i) {
        sdk::now_us      = (3000LL + 15 * i) * 1000000;
        const auto delta = hydronic_record(tracker, s, sdk::now_us, 1000, 7, 11, true);
        hydronic_observation_record(delta);
    }
    auto r = hydronic_observation_report();
    require(r.totals.observed_us == 600000000 && r.totals.candidate_us == 600000000 &&
                !r.totals.qualified_us && r.totals.samples == 1,
            "first qualified endpoint never retrospectively credits 600-second settling duration");
    require(r.totals.first_evidence_unix_us == sdk::origin_us + 3000LL * 1000000 &&
                r.totals.first_accepted_unix_us == sdk::origin_us + 3600LL * 1000000,
            "settling evidence span and first acceptance remain separate UTC dates");
    require(append(), "pre-settling hour closes independently of accepted endpoint hour");
    HydronicHourlyPayload old;
    int64_t               bucket;
    uint64_t              sequence;
    require(reader(0, bucket, sequence, old) == HydronicReadResult::Valid && !old.samples &&
                !old.qualified_us && old.candidate_us == 600000000 &&
                old.first_accepted_unix_us == -1,
            "old hour contains only real eligible interval and no moved sample");
    sdk::now_us = 3615LL * 1000000;
    hydronic_observation_record(hydronic_record(tracker, s, sdk::now_us, 1000, 7, 11, true));
    s.pump      = HydronicBit::Off;
    sdk::now_us = 3630LL * 1000000;
    hydronic_observation_record(hydronic_record(tracker, s, sdk::now_us, 1000, 7, 11, true));
    s.leaving_known = false;
    sdk::now_us     = 3645LL * 1000000;
    hydronic_observation_record(hydronic_record(tracker, s, sdk::now_us, 1000, 7, 11, true));
    r = hydronic_observation_report();
    require(r.totals.observed_us == 630000000 && r.totals.candidate_us == 615000000 &&
                r.totals.qualified_us == 15000000 && r.totals.samples == 2,
            "known OFF and missing observations preserve independent durations");
    require(r.totals.last_evidence_unix_us == sdk::origin_us + 3630LL * 1000000 - 1 &&
                r.totals.last_accepted_unix_us == sdk::origin_us + 3615LL * 1000000,
            "unobservable completion is not a dated evidence or acceptance timestamp");
    const unsigned reads = sdk::reads;
    hydronic_observation_bind(101, 202, 303, 7);
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().restore_pending && sdk::reads == reads,
            "idempotent same-generation binding does not re-read flash");
}
void restore_and_identity() {
    boot();
    const int64_t hour = current_bucket();
    put(hour - 2, payload(hour - 2, 3));
    auto other = payload(hour - 1, 20);
    other.identity.source_fp++;
    put(hour - 1, other);
    put(hour + 1, payload(hour + 1, 30));
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 3,
            "restore requires exact identity and past hour");
    for (unsigned i = 0; i < 4; ++i) {
        boot();
        const int64_t at = current_bucket();
        put(at - 1, payload(at - 1, 3));
        hydronic_observation_flash_service(reader);
        require(hydronic_observation_report().totals.samples == 3, "replacement precondition");
        hydronic_observation_bind(101 + (i == 0), 202 + (i == 1), 303 + (i == 2), 7 + (i == 3));
        require(hydronic_observation_report().totals.samples == 0 &&
                    hydronic_observation_report().persistence_pending,
                "source/model/schema/generation withdraw immediately");
        drain();
        require(hydronic_observation_report().totals.samples == 0,
                "replacement fence excludes prior scope");
    }
    hydronic_observation_set_diagnostics(false, 12);
    require(!hydronic_observation_report().confirmed, "consent withdrawal immediate");
    hydronic_observation_set_diagnostics(true, 13);
    hydronic_observation_bind(101, 202, 303, 8);
    drain();
    require(hydronic_observation_report().totals.samples == 0,
            "new consent never restores old consent");
    hydronic_observation_start(false, 13);
    hydronic_observation_bind(101, 202, 303, 8);
    tick(-1, 10);
    require(!hydronic_observation_report().confirmed && !append(),
            "disabled start admits no observations");
}
void reset_and_claims() {
    boot();
    tick(-1, 5);
    sdk::now_us = 3601LL * 1000000;
    hydronic_observation_report();
    int64_t               bucket;
    HydronicHourlyPayload old;
    require(hydronic_observation_flash_next(reader, bucket, old), "claim old epoch");
    hydronic_observation_reset();
    hydronic_observation_bind(101, 202, 303, 8, false);
    require(hydronic_observation_report().totals.samples == 0 &&
                hydronic_observation_report().persistence_pending,
            "reset withdraws RAM before durable fence");
    put(bucket, old); // physical completion of an already claimed old transaction
    hydronic_observation_flash_appended(bucket, next_sequence - 1, next_slot - 1, old);
    require(hydronic_observation_report().totals.samples == 0,
            "old receipt cannot publish into new epoch");
    tick(-1, 3610);
    require(append(), "reset fence is ordered before new live evidence");
    require(flash[1].bytes[121] == static_cast<uint8_t>(HydronicHourlyKind::Fence),
            "next transaction is a fence");
    hydronic_observation_seal();
    drain();
    boot(false);
    require(hydronic_observation_report().totals.samples == 1,
            "reboot retains only post-fence new live data");
    hydronic_observation_bind(101, 202, 303, 7, false);
    require(hydronic_observation_report().totals.samples == 0,
            "same identity allow_restore=false withdraws immediately");
    drain();
    boot(false);
    require(hydronic_observation_report().totals.samples == 0,
            "same-scope reset survives committed fence");
}
void queue_loss() {
    boot();
    for (int hour = 0; hour < 7; ++hour) tick(-1, hour * 3600 + 1);
    auto r = hydronic_observation_report();
    require(r.dropped > 0 && r.partial, "bounded queue loss is visible");
    const uint16_t dropped = r.dropped;
    drain();
    boot(false);
    require(hydronic_observation_report().dropped == dropped,
            "loss watermark survives restoration");
    sdk::now_us += 25 * OBSERVATION_HOUR_US;
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().dropped == dropped,
            "restored watermark survives original record expiry");
    tick(-1, sdk::now_us / 1000000 + 1);
    hydronic_observation_seal();
    drain();
    boot(false);
    require(hydronic_observation_report().dropped == dropped,
            "later records retain loss notice across another reboot");

    boot();
    tick(-1, 5);
    sdk::now_us = 3601LL * 1000000;
    hydronic_observation_report();
    int64_t               bucket;
    HydronicHourlyPayload p;
    require(hydronic_observation_flash_next(reader, bucket, p), "first delta claimed");
    HydronicDelta late;
    late.to_us        = 10LL * 1000000;
    late.accepted     = true;
    late.spread_milli = 6000;
    late.flow_milli   = 10000;
    hydronic_observation_record(late);
    hydronic_observation_report();
    require(s_queue[0].claimed && s_queue[0].payload.samples == 1 &&
                s_queue[1].payload.samples == 1,
            "claimed entry immutable while same-hour new delta queues independently");
    put(bucket, p);
    hydronic_observation_flash_appended(bucket, next_sequence - 1, next_slot - 1, p);
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 2,
            "committed base plus unclaimed delta counted once");
    drain();
    require(hydronic_observation_report().totals.samples == 2,
            "FIFO same-hour revisions stable after drain");
}
void expiry() {
    boot();
    const int64_t hour = current_bucket();
    auto          off  = payload(hour - 23, 0);
    off.candidate_us = off.qualified_us = 0;
    put(hour - 23, off);
    put(hour - 1, payload(hour - 1, 2));
    hydronic_observation_flash_service(reader);
    auto r = hydronic_observation_report();
    require(r.totals.first_evidence_unix_us == off.first_unix_us &&
                r.totals.first_accepted_unix_us == (hour - 1) * OBSERVATION_HOUR_US + 1000000,
            "known OFF evidence span differs from accepted sample span");
    const unsigned reads = sdk::reads;
    sdk::now_us += OBSERVATION_HOUR_US;
    r = hydronic_observation_report();
    require(!r.totals.samples && !r.totals.observed_us && r.restore_pending &&
                r.totals.first_evidence_unix_us == -1 && sdk::reads == reads,
            "reader alone withdraws expired closed aggregate without flash access");
    hydronic_observation_flash_service(reader);
    r = hydronic_observation_report();
    require(r.totals.samples == 2 &&
                r.totals.observed_us == static_cast<uint64_t>(OBSERVATION_HOUR_US) &&
                r.totals.first_evidence_unix_us == (hour - 1) * OBSERVATION_HOUR_US,
            "owner rebuilds smaller still-dated aggregate");
    sdk::now_us += 25 * OBSERVATION_HOUR_US;
    require(hydronic_observation_report().totals.samples == 0,
            "whole-hour evidence expires without producer");
}
void minimum_windows() {
    constexpr int64_t second = 1000000;
    boot();
    const int64_t hour = current_bucket();
    put(hour - 23, payload(hour - 23), true);
    put(hour - 1, payload(hour - 1));
    hydronic_observation_flash_service(reader);
    auto r = hydronic_observation_report();
    require(r.totals.flow.min_milli == 10000 && r.minimum_windows.first_bucket == hour - 23 &&
                r.minimum_windows.locations_missing && !r.minimum_windows.masks[0] &&
                r.minimum_windows.masks[22] == 1,
            "mixed replay marks known ties and leaves the legacy location unknown");

    sdk::now_us = 3601 * second;
    hydronic_observation_flash_service(reader);
    r = hydronic_observation_report();
    require(r.totals.samples == 1 && r.minimum_windows.first_bucket == hour - 22 &&
                !r.minimum_windows.locations_missing && r.minimum_windows.masks[21] == 1 &&
                !r.minimum_windows.masks[22],
            "expiry retires the legacy claimant and reanchors the surviving occurrence");

    tick_us(-1, 3900 * second, true, true, false, false, 9000);
    tick_us(-1, 4501 * second, true, true, false, false, 9000);
    tick_us(-1, 4801 * second, false, true, false, false, 7000);
    r = hydronic_observation_report();
    require(r.totals.flow.min_milli == 9000 && !r.minimum_windows.locations_missing &&
                !r.minimum_windows.masks[21] && r.minimum_windows.masks[23] == (2 | 8),
            "lower qualified samples replace archived hits and exclude unrelated readings");

    tick_us(-1, 7201 * second, true, true, false, false, 9000);
    const auto crosses_hour = [hour](const HydronicObservationReport& report) {
        return report.totals.flow.min_milli == 9000 && !report.minimum_windows.locations_missing &&
               report.minimum_windows.first_bucket == hour - 21 &&
               report.minimum_windows.masks[22] == (2 | 8) && report.minimum_windows.masks[23] == 1;
    };
    require(crosses_hour(hydronic_observation_report()), "open and queued tied bins stay visible");
    hydronic_observation_seal();
    drain();
    boot(false);
    require(crosses_hour(hydronic_observation_report()), "precise tied bins survive replay");
}
void archive_clock_rollback(bool with_live) {
    boot();
    const auto hour = current_bucket();
    put(hour - 1, payload(hour - 1, 0));
    if (with_live) tick(-1, 5);
    sdk::now_us                   = 10000000;
    const int64_t endpoint        = wall();
    auto          latest          = payload(hour, 1, 10000001);
    latest.first_accepted_unix_us = latest.last_accepted_unix_us = latest.last_unix_us = endpoint;
    put(hour, latest);
    hydronic_observation_flash_service(reader);
    const auto published = hydronic_observation_report();
    require(published.dated && published.totals.samples == 1 &&
                published.totals.last_evidence_unix_us == endpoint && !published.restore_pending,
            "archive is published when its last point equals wall time");

    const unsigned reads = sdk::reads;
    sdk::origin_us -= 2000000;
    auto r = hydronic_observation_report();
    require(r.confirmed && r.dated && r.restore_pending && !r.persistence_pending && !r.dropped &&
                !r.totals.observed_us && r.totals.last_evidence_unix_us <= wall() &&
                sdk::reads == reads,
            "tolerated rollback withdraws the future archive without reads or a fence");
    const uint64_t live_samples  = with_live ? 1 : 0;
    const int64_t  live_endpoint = with_live ? endpoint - 5000000 : -1;
    require(r.totals.samples == live_samples && r.totals.last_accepted_unix_us == live_endpoint,
            "unpublished archive edges no longer suppress the admitted live point");

    hydronic_observation_flash_service(reader);
    r = hydronic_observation_report();
    require(!r.restore_pending && r.totals.observed_us == OBSERVATION_HOUR_US &&
                r.totals.samples == live_samples && r.totals.last_accepted_unix_us == live_endpoint,
            "service rebuilds the still-current archive and defers its future record");
    const unsigned staged_reads = sdk::reads;
    sdk::now_us += 1999000;
    hydronic_observation_flash_service(reader);
    require(sdk::reads == staged_reads &&
                hydronic_observation_report().totals.last_evidence_unix_us < endpoint,
            "archive wake avoids early polling and publication");
    sdk::now_us += 1000;
    hydronic_observation_flash_service(reader);
    r = hydronic_observation_report();
    require(!r.restore_pending && !r.persistence_pending && !r.dropped && r.totals.samples == 1 &&
                r.totals.observed_us == OBSERVATION_HOUR_US + 10000001 &&
                r.totals.last_evidence_unix_us == endpoint &&
                r.totals.last_accepted_unix_us == endpoint && sdk::reads == staged_reads + 2 &&
                next_sequence == 3 && next_slot == 2,
            "archive wake replays the original endpoint and edges without writing");
}
void clock_cases() {
    boot();
    sdk::synced = false;
    tick(-1, 5);
    require(!hydronic_observation_report().dated && !append(),
            "undated observations cannot persist");
    sdk::synced = true;
    tick(-1, 10);
    const int64_t original = hydronic_observation_report().totals.first_accepted_unix_us;
    sdk::origin_us += 2000000;
    require(hydronic_observation_report().dated &&
                hydronic_observation_report().totals.first_accepted_unix_us == original,
            "two-second offset drift does not retime prior evidence");
    sdk::origin_us += 1000;
    require(!hydronic_observation_report().dated && !hydronic_observation_report().totals.samples &&
                hydronic_observation_report().persistence_pending,
            "larger correction invalidates projection and fences");
    require(append(), "bad clock still permits a dated reset fence");
    boot();
    tick(-1, 10);
    sdk::now_us = 9000000;
    require(!hydronic_observation_report().dated && !hydronic_observation_report().totals.samples,
            "monotonic regression withdraws old dated projection");
    boot();
    tick(-1, 10);
    const unsigned reads = sdk::reads;
    auto           d     = HydronicDelta{};
    d.to_us              = 10000000;
    d.accepted           = true;
    d.spread_milli       = 6000;
    d.flow_milli         = 10000;
    hydronic_observation_record(d);
    require(hydronic_observation_report().totals.samples == 1 && sdk::reads == reads,
            "duplicate sample rejected without retiming durable hours or reading flash");
}
void receipts() {
    boot();
    tick(-1, 5);
    sdk::now_us = 3601LL * 1000000;
    hydronic_observation_report();
    require(append(true), "busy receipt reconciled with zero-wait owner");
    require(hydronic_observation_report().totals.samples == 1,
            "deferred successful receipt applied once");
    tick(-1, 3610);
    sdk::now_us = 7201LL * 1000000;
    hydronic_observation_report();
    int64_t               bucket;
    HydronicHourlyPayload p;
    require(hydronic_observation_flash_next(reader, bucket, p),
            "next claim before transport failure");
    sdk::mutex.owned = true;
    hydronic_observation_flash_failed();
    sdk::mutex.owned = false;
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_flash_next(reader, bucket, p),
            "failed transaction retries immutable delta");
    // A transport can report a write error after the commit reached flash. History validates
    // readback and reports appended, without issuing another write or calling failed first.
    const uint16_t slot = next_slot;
    put(bucket, p);
    HydronicHourlyPayload verified;
    int64_t               checked_bucket;
    uint64_t              sequence;
    require(reader(slot, checked_bucket, sequence, verified) == HydronicReadResult::Valid,
            "readback confirms commit despite reported transport error");
    hydronic_observation_flash_appended(checked_bucket, sequence, slot, verified);
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 2 && !append(),
            "readback acknowledgement consumes one claim with no duplicate write");
}
void fences_and_index() {
    boot();
    const int64_t hour = current_bucket();
    put(hour - 1, payload(hour - 1, 9));
    hydronic_observation_flash_service(reader);
    hydronic_observation_reset();
    hydronic_observation_bind(101, 202, 303, 8, false);
    require(append(), "durable fence installed");
    const auto fence    = flash[1];
    auto       new_data = payload(hour - 1, 2);
    put(hour - 1, new_data);
    // The runtime index must retain identity+sequence, never reread a later recycled slot.
    auto unrelated = payload(hour, 1, 1);
    unrelated.identity.source_fp++;
    flash[1] = make_slot(hour, unrelated, next_sequence++);
    scan_slot(1);
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 2,
            "recycled fence slot retains its exact in-RAM scope fence");
    flash[1] = fence;
    flash[1].bytes[121] ^= 1;
    boot(false);
    require(hydronic_observation_report().totals.samples == 0 &&
                hydronic_observation_report().partial &&
                inspected_index().clipped_until_bucket == INT64_MAX,
            "recognizable corrupt fence makes cold restoration incomplete");
    flash[1] = fence;
    reindex();
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 2,
            "complete physical reindex clears fence uncertainty");
    boot();
    for (uint32_t i = 0; i < OBSERVATION_INDEX_CAP; ++i) {
        auto scope          = payload(current_bucket(), 0, 0);
        scope.first_unix_us = scope.last_unix_us = wall();
        scope.kind                               = HydronicHourlyKind::Fence;
        scope.identity.schema_fp += i;
        put(current_bucket(), scope);
    }
    auto overflow          = payload(current_bucket(), 0, 0);
    overflow.first_unix_us = overflow.last_unix_us = wall();
    overflow.kind                                  = HydronicHourlyKind::Fence;
    overflow.identity.schema_fp += 100;
    put(current_bucket(), overflow);
    require(inspected_index().clipped_until_bucket == INT64_MAX,
            "losing a fence stays incomplete until full reindex");

    boot();
    const int64_t now = current_bucket();
    for (int i = 0; i < 24; ++i) put(now - 23 + i, payload(now - 23 + i));
    for (int i = 0; i < 24; ++i) {
        auto scope          = payload(now, 0, 0);
        scope.first_unix_us = scope.last_unix_us = wall();
        scope.kind                               = HydronicHourlyKind::Fence;
        scope.identity.schema_fp += 1 + i;
        put(now, scope);
    }
    hydronic_observation_flash_service(reader);
    require(inspected_index().clipped_until_bucket == now + 1 &&
                !hydronic_observation_report().totals.samples,
            "data index loss limited until affected hour expires");
    sdk::now_us += OBSERVATION_HOUR_US;
    hydronic_observation_flash_service(reader);
    require(!inspected_index().clipped && hydronic_observation_report().totals.samples > 0,
            "finite data capacity limit clears at actual whole-hour expiry");

    boot();
    const int64_t present = current_bucket();
    put(present - 1, payload(present - 1, 9));
    auto future         = payload(present + 25, 0, 0);
    future.last_unix_us = future.first_unix_us;
    future.kind         = HydronicHourlyKind::Fence;
    put(present + 25, future);
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().totals.samples,
            "future reset date does not weaken its exact-identity sequence fence");
    put(present - 1, payload(present - 1, 2));
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 2,
            "data after future-dated fence admitted by sequence");
    auto aged         = payload(present - 100, 0, 0);
    aged.last_unix_us = aged.first_unix_us;
    aged.kind         = HydronicHourlyKind::Fence;
    put(present - 100, aged);
    boot(false);
    require(!hydronic_observation_report().totals.samples,
            "aged fence retains sequence scope on cold scan");
    flash[next_slot - 1].header.source = 0;
    reindex();
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().totals.samples &&
                inspected_index().clipped_until_bucket == INT64_MAX,
            "recognizable fence with damaged physical source fails cold restoration closed");
}
void forget_and_seal() {
    boot();
    tick(-1, 5);
    hydronic_observation_seal();
    tick(5, 10);
    require(hydronic_observation_report().totals.samples == 1,
            "shutdown seal refuses subsequent producer writes");
    drain();
    boot(false);
    require(hydronic_observation_report().totals.samples == 1,
            "shutdown-sealed partial hour is restored");
    const unsigned reads = sdk::reads;
    hydronic_observation_forget();
    require(!hydronic_observation_report().confirmed &&
                !hydronic_observation_report().totals.samples && !append() && sdk::reads == reads,
            "privacy forget withdraws RAM and disables persistence without flash reads");
}
void wide_totals() {
    boot();
    const int64_t hour = current_bucket();
    put(hour - 2, payload(hour - 2, UINT32_MAX));
    put(hour - 1, payload(hour - 1, UINT32_MAX));
    hydronic_observation_flash_service(reader);
    const auto r = hydronic_observation_report();
    require(r.totals.samples == 2ULL * UINT32_MAX &&
                r.totals.command_samples == 2ULL * UINT32_MAX &&
                r.totals.observed_us == 2ULL * OBSERVATION_HOUR_US,
            "rolling sample and duration totals do not narrow to uint32");
    require(static_cast<double>(r.totals.flow.sum_milli) / r.totals.samples / 1000 == 10.0 &&
                r.totals.flow.min_milli == 10000 && r.totals.flow.max_milli == 10000,
            "wide sample-weighted range preserves exact bounded sums");
}
void reader_races() {
    boot();
    const int64_t hour = current_bucket();
    put(hour - 1, payload(hour - 1, 9));
    before_read = [] {
        hydronic_observation_reset();
        hydronic_observation_bind(101, 202, 303, 8, false);
    };
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().totals.samples,
            "in-flight rebuild cannot publish old reset epoch");
    boot();
    put(current_bucket() - 23, payload(current_bucket() - 23, 5));
    before_read = [] { sdk::now_us += OBSERVATION_HOUR_US; };
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().totals.samples,
            "expiry during borrowed flash read cannot publish stale aggregate");
    boot();
    put(current_bucket() - 1, payload(current_bucket() - 1, 9));
    before_read = [] { hydronic_observation_bind(999, 202, 303, 8); };
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().totals.samples,
            "in-flight rebuild checks exact identity on publication");
}
void invalid_deltas() {
    for (unsigned i = 0; i < 7; ++i) {
        boot();
        HydronicDelta d;
        d.from_us = 1000000;
        d.to_us = sdk::now_us = 10000000;
        d.observed_us = d.candidate_us = d.qualified_us = 9000000;
        d.accepted = d.command_accepted = true;
        d.spread_milli                  = 6000;
        d.flow_milli                    = 10000;
        d.command_milli                 = 40000;
        switch (i) {
        case 0:
            d.observed_us = 8000000;
            break;
        case 1:
            d.to_us = 0;
            break;
        case 2:
            d.to_us = 20000000;
            break;
        case 3:
            d.flow_milli = 0;
            break;
        case 4:
            d.command_milli = -1;
            break;
        case 5:
            d.accepted = false;
            break;
        case 6:
            d.limitations = 0x80;
            break;
        }
        hydronic_observation_record(d);
        require(!hydronic_observation_report().totals.samples &&
                    !hydronic_observation_report().totals.observed_us,
                "invalid delta never partially mutates an hour");
    }
    boot();
    tick(1, 10);
    tick(5, 15);
    require(hydronic_observation_report().totals.samples == 1 &&
                hydronic_observation_report().totals.observed_us == 9000000,
            "overlapping input interval rejected without double duration");
}
void read_failures() {
    boot();
    tick(-1, 5);
    sdk::now_us = 3601LL * 1000000;
    hydronic_observation_report();
    require(append(), "read failure base installed");
    HydronicDelta late;
    late.to_us        = 10000000;
    late.accepted     = true;
    late.spread_milli = 6000;
    late.flow_milli   = 10000;
    hydronic_observation_record(late);
    hydronic_observation_report();
    retry_slot = 0;
    int64_t               bucket;
    HydronicHourlyPayload p;
    require(!hydronic_observation_flash_next(reader, bucket, p) && !s_queue[0].claimed,
            "failed prior revision read releases claim instead of issuing destructive replacement");
    retry_slot = UINT16_MAX;
    require(append() && hydronic_observation_report().totals.samples == 2,
            "read recovery merges original base and retained delta exactly once");
    retry_slot = 1;
    s_rebuild  = true;
    hydronic_observation_flash_service(reader);
    const auto pending = hydronic_observation_report();
    require(pending.totals.samples == 2 && pending.restore_pending,
            "transient replay failure preserves the previously published hour");
    retry_slot = UINT16_MAX;
    hydronic_observation_flash_service(reader);
    const auto recovered = hydronic_observation_report();
    require(recovered.totals.samples == 2 && !recovered.restore_pending,
            "successful replay clears pending without duplicating the previously published hour");
    flash[1].header.commit = HISTORY_JOURNAL_ERASED;
    s_rebuild              = true;
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().totals.samples && hydronic_observation_report().partial,
            "missing committed latest revision remains absent and explicitly limited");
    late.to_us = 15000000;
    hydronic_observation_record(late);
    tick(3601, 3611);
    sdk::now_us = 7201LL * 1000000;
    hydronic_observation_report();
    require(append() && flash[2].header.bucket == flash[1].header.bucket + 1 &&
                flash[1].header.commit == HISTORY_JOURNAL_ERASED &&
                hydronic_observation_report().dropped == 1,
            "invalid base retires one revision and allows a later hour without replacing flash");
    flash[1].header.commit = HISTORY_JOURNAL_COMMITTED;
    flash[1].bytes[0] ^= 1;
    boot(false);
    require(!hydronic_observation_report().totals.samples &&
                inspected_index().clipped_until_bucket == INT64_MAX,
            "cold current-format CRC damage cannot silently resurrect older compatible revision");
}
void reset_before_commit() {
    boot();
    const int64_t hour = current_bucket();
    put(hour - 1, payload(hour - 1, 4));
    hydronic_observation_flash_service(reader);
    hydronic_observation_reset();
    hydronic_observation_bind(101, 202, 303, 8, false);
    auto r = hydronic_observation_report();
    require(!r.totals.samples && r.persistence_pending,
            "RAM reset immediately withdraws evidence and states undurable boundary");
    boot(false);
    require(hydronic_observation_report().totals.samples == 4,
            "RAM-only same-scope reset cannot promise reboot persistence");
    hydronic_observation_reset();
    hydronic_observation_bind(101, 202, 303, 8, false);
    require(append(), "reset becomes durable only after fence transaction commits");
    boot(false);
    require(!hydronic_observation_report().totals.samples,
            "committed reset fence survives replacement monotonic epoch");
}
void early_forget() {
    require(sdk::creates == 0, "fresh process has not created Store mutex");
    hydronic_observation_forget();
    const auto early = hydronic_observation_report();
    require(!early.confirmed && !early.totals.samples && sdk::creates == 0,
            "early forget and reader do not create a mutex");
    hydronic_observation_start(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    tick(-1, 5);
    const auto after_start = hydronic_observation_report();
    require(!after_start.confirmed && !after_start.totals.samples,
            "Start and Bind cannot reactivate after pre-start forget");
    hydronic_observation_set_diagnostics(true, 12);
    hydronic_observation_start(true, 12);
    hydronic_observation_bind(101, 202, 303, 8);
    tick(-1, 10);
    require(!hydronic_observation_report().confirmed && !append(),
            "same-boot diagnostic re-enable cannot clear early forget intent");
    require(hydronic_observation_suppressed(),
            "allocation-free suppression accessor retains early forget");
}
void creation_forget() {
    sdk::before_create = [] {
        require(s_mutex.load(std::memory_order_acquire) == nullptr,
                "handle remains unpublished while mutex creation is in progress");
        const auto r = hydronic_observation_report();
        require(!r.confirmed && !r.totals.samples && sdk::creates == 1,
                "reader during creation neither allocates nor observes initialized live state");
        hydronic_observation_forget();
    };
    hydronic_observation_start(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    tick(-1, 5);
    require(hydronic_observation_suppressed() && !hydronic_observation_report().confirmed &&
                !append() && sdk::creates == 1,
            "forget during mutex creation survives handle publication");
}
void creation_publish() {
    sdk::before_take = [] {
        require(s_mutex.load(std::memory_order_acquire) == nullptr,
                "reader must not see a handle published before Store initialization");
        require(!hydronic_observation_report().confirmed && sdk::creates == 1,
                "reader at initialization lock boundary cannot recurse or allocate");
        hydronic_observation_forget();
    };
    hydronic_observation_start(true, 11);
    require(hydronic_observation_suppressed() &&
                s_mutex.load(std::memory_order_acquire) == &sdk::mutex,
            "creator publishes initialized handle without clearing a concurrent forget");
    hydronic_observation_set_diagnostics(true, 12);
    hydronic_observation_bind(101, 202, 303, 8);
    require(!hydronic_observation_report().confirmed,
            "configuration after creation race cannot bypass per-boot latch");
}
void failed_creation_forget() {
    sdk::fail_create = true;
    hydronic_observation_start(true, 11);
    require(s_mutex.load(std::memory_order_acquire) == nullptr && sdk::creates == 1,
            "failed mutex allocation never publishes a handle");
    hydronic_observation_forget();
    const auto r = hydronic_observation_report();
    require(hydronic_observation_suppressed() && !r.confirmed && !r.restore_pending &&
                sdk::creates == 1,
            "forget after failed allocation is durable for this boot without another allocation");
    sdk::fail_create = false;
    hydronic_observation_start(true, 11);
    hydronic_observation_set_diagnostics(true, 12);
    hydronic_observation_bind(101, 202, 303, 8);
    tick(-1, 5);
    require(!hydronic_observation_report().confirmed && sdk::creates == 1,
            "later allocator recovery cannot reactivate forgotten boot");
}
void staging_forget() {
    boot();
    const int64_t hour = current_bucket();
    put(hour - 2, payload(hour - 2, 3));
    put(hour - 1, payload(hour - 1, 4));
    const unsigned reads = sdk::reads;
    before_read          = [] { hydronic_observation_forget(); };
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_suppressed() && !hydronic_observation_report().confirmed &&
                !hydronic_observation_report().totals.samples && sdk::reads == reads + 1,
            "forget during staged rebuild withholds publication and stops further reads");
    hydronic_observation_start(true, 11);
    hydronic_observation_set_diagnostics(true, 12);
    hydronic_observation_bind(101, 202, 303, 8);
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_report().confirmed && sdk::reads == reads + 1,
            "same-boot Start and config cannot restart suppressed flash service");
    boot(false);
    require(
        !hydronic_observation_suppressed() && hydronic_observation_report().totals.samples == 7,
        "only modeled new-process static initialization clears latch; flash erasure is separate");
}
void claim_forget() {
    boot();
    tick(-1, 5);
    sdk::now_us = 3601LL * 1000000;
    hydronic_observation_report();
    require(append(), "claim privacy race has committed prior revision");
    HydronicDelta late;
    late.to_us        = 10000000;
    late.accepted     = true;
    late.spread_milli = 6000;
    late.flow_milli   = 10000;
    hydronic_observation_record(late);
    hydronic_observation_report();
    before_read = [] { hydronic_observation_forget(); };
    int64_t               bucket;
    HydronicHourlyPayload p;
    require(!hydronic_observation_flash_next(reader, bucket, p) &&
                hydronic_observation_suppressed(),
            "forget during prior-revision staging refuses claimed output");
    const uint8_t indexed = inspected_index().count;
    hydronic_observation_flash_appended(bucket, next_sequence, next_slot, p);
    hydronic_observation_flash_failed();
    require(inspected_index().count == indexed && !s_receipt.pending &&
                !hydronic_observation_report().confirmed,
            "late success/failure receipts cannot revive suppressed state or index new data");

    boot();
    tick(-1, 5);
    hydronic_observation_seal();
    require(hydronic_observation_flash_next(reader, bucket, p), "claim exists before busy forget");
    sdk::mutex.owned       = true;
    const unsigned creates = sdk::creates, reads = sdk::reads;
    hydronic_observation_forget();
    require(hydronic_observation_suppressed() && !hydronic_observation_report().confirmed,
            "busy Store cannot delay immediate privacy withdrawal");
    hydronic_observation_start(true, 11);
    hydronic_observation_set_diagnostics(true, 12);
    hydronic_observation_bind(101, 202, 303, 8);
    hydronic_observation_reset();
    hydronic_observation_seal();
    hydronic_observation_record(late);
    hydronic_observation_flash_service(reader);
    require(!hydronic_observation_flash_next(reader, bucket, p) && sdk::creates == creates &&
                sdk::reads == reads,
            "suppressed entry points neither wait, allocate nor read flash");
    hydronic_observation_flash_appended(bucket, next_sequence, next_slot, p);
    hydronic_observation_flash_failed();
    sdk::mutex.owned = false;
    hydronic_observation_forget();
    require(!hydronic_observation_report().totals.samples && !s_receipt.pending,
            "receipts after busy forget cannot republish claimed evidence");
}
void require_empty_index() {
    const auto& index = inspected_index();
    require(index.count == 0 && !index.clipped && index.clipped_until_bucket == INT64_MIN,
            "placement construction preserves exact shared index metadata defaults");
    bool empty = true;
    for (const auto& entry : index.entries)
        for (auto word : entry.words) empty &= word == 0;
    for (auto bits : index.fence_bits) empty &= bits == 0;
    require(empty, "placement construction initializes every entry and fence tag");
    require(reinterpret_cast<uintptr_t>(&index) % alignof(ObservationIndex) == 0,
            "constructed index has its required alignment");
}
void index_reset_before_start() {
    require(!s_index_ready && sdk::creates == 0, "index storage begins without an active index");
    hydronic_observation_flash_index_reset();
    require_empty_index();
    require(sdk::creates == 0 && !sdk::mutex.owned && sdk::reads == 0,
            "first reset hook constructs without a mutex, allocation or flash read");
    const int64_t hour = current_bucket();
    put(hour - 1, payload(hour - 1, 3));
    hydronic_observation_start(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 3,
            "Start retains records indexed by earlier Flash-owner hooks");
    hydronic_observation_flash_index_reset();
    require_empty_index();
    hydronic_observation_flash_index_reset();
    require_empty_index();
}
void index_record_before_start() {
    require(!s_index_ready, "record is first index owner hook");
    const int64_t hour = current_bucket();
    put(hour - 1, payload(hour - 1, 4));
    const auto& index = inspected_index();
    require(index.count == 1 && !index.clipped && index.clipped_until_bucket == INT64_MIN &&
                sdk::creates == 0 && !sdk::mutex.owned,
            "first valid record constructs exact defaults and indexes without Store startup");
    hydronic_observation_start(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().totals.samples == 4,
            "first-hook record reaches actual retained report after startup");
}
void index_incomplete_before_start() {
    require(!s_index_ready, "incomplete is first index owner hook");
    hydronic_observation_flash_index_incomplete();
    const auto& index = inspected_index();
    require(index.count == 0 && index.clipped && index.clipped_until_bucket == INT64_MAX &&
                sdk::creates == 0 && !sdk::mutex.owned,
            "first damaged-record hook retains uncertainty before Store startup");
    hydronic_observation_start(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    hydronic_observation_flash_service(reader);
    require(hydronic_observation_report().partial &&
                !hydronic_observation_report().totals.samples &&
                inspected_index().clipped_until_bucket == INT64_MAX,
            "Start cannot erase earlier incomplete-index evidence");
    hydronic_observation_flash_index_reset();
    require_empty_index();
}
void index_service_before_start() {
    require(!s_index_ready, "service is first index owner hook");
    hydronic_observation_flash_service(reader);
    require_empty_index();
    require(sdk::creates == 0 && sdk::reads == 0 && !sdk::mutex.owned,
            "early service construction never creates or acquires the unpublished Store mutex");
}
void index_next_before_start() {
    require(!s_index_ready, "next is first index owner hook");
    int64_t               bucket;
    HydronicHourlyPayload p;
    require(!hydronic_observation_flash_next(reader, bucket, p),
            "early next cannot issue a transaction before Store startup");
    require_empty_index();
    require(sdk::creates == 0 && sdk::reads == 0 && !sdk::mutex.owned,
            "early next construction uses neither allocation nor a Store mutex");
}
void index_producer_ownership() {
    require(!s_index_ready, "index initially belongs only to Flash-owner hooks");
    hydronic_observation_start(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    tick(-1, 5);
    require(hydronic_observation_report().totals.samples == 1 && !s_index_ready,
            "Start, producer and report never construct or read the Flash-owner index");
    hydronic_observation_seal();
    require(!s_index_ready, "producer shutdown seal does not construct the index");
    hydronic_observation_flash_service(reader);
    require_empty_index();
    require(hydronic_observation_report().totals.samples == 1,
            "first Flash-owner construction preserves queued live evidence");
}
void index_suppressed_no_init() {
    require(!s_index_ready && sdk::creates == 0,
            "forgotten boot begins with inactive index storage");
    hydronic_observation_forget();
    const int64_t hour = current_bucket();
    auto          p    = payload(hour - 1);
    hydronic_observation_flash_index_reset();
    hydronic_observation_flash_index_incomplete();
    hydronic_observation_flash_index(hour - 1, 1, 0, p);
    hydronic_observation_flash_appended(hour - 1, 1, 0, p);
    hydronic_observation_flash_failed();
    hydronic_observation_flash_service(reader);
    int64_t bucket;
    require(!hydronic_observation_flash_next(reader, bucket, p),
            "forgotten first hooks cannot issue a transaction");
    require(!s_index_ready, "forgotten first hooks do not start the index member lifetime");
    bool zero = true;
    for (auto byte : s_index_storage.bytes) zero &= byte == 0;
    require(!s_index_ready && zero && sdk::creates == 0 && sdk::reads == 0,
            "suppressed Flash hooks leave the zero-byte union member active and untouched");
    require(!hydronic_observation_report().confirmed,
            "unconstructed suppressed index never supplies retained evidence");
}
void index_suppressed_existing_reset() {
    const int64_t hour = current_bucket();
    put(hour - 1, payload(hour - 1, 3));
    require(inspected_index().count == 1 && sdk::creates == 0,
            "public record hook creates retained index before privacy cleanup");
    hydronic_observation_forget();
    hydronic_observation_flash_index_reset();
    require_empty_index();
    require(hydronic_observation_suppressed() && !hydronic_observation_report().confirmed &&
                sdk::creates == 0,
            "existing index reset after forget still clears metadata without re-enabling the boot");
}
void require_canonical_empty_report(const HydronicObservationReport& r) {
    require(!r.totals.samples && !r.totals.command_samples && !r.totals.observed_us &&
                !r.totals.candidate_us && !r.totals.qualified_us &&
                r.totals.first_evidence_unix_us == -1 && r.totals.last_evidence_unix_us == -1 &&
                r.totals.first_accepted_unix_us == -1 && r.totals.last_accepted_unix_us == -1,
            "unobserved public report keeps canonical absent dates and populations");
}
void exercise_unstarted_lifecycle() {
    hydronic_observation_set_diagnostics(true, 11);
    hydronic_observation_bind(101, 202, 303, 7);
    hydronic_observation_reset();
    tick(-1, 5);
    hydronic_observation_seal();
    const auto r = hydronic_observation_report();
    require(!r.confirmed && !r.dated && sdk::creates <= 1,
            "unpublished Store lifecycle cannot expose inactive initial values");
    require_canonical_empty_report(r);
}
void admit_first_active_observation() {
    hydronic_observation_bind(101, 202, 303, 7);
    hydronic_observation_flash_index_reset();
    hydronic_observation_flash_service(reader);
    require_canonical_empty_report(hydronic_observation_report());
    tick(-1, 20);
    hydronic_observation_seal();
    require(append() && !hydronic_observation_report().dropped &&
                hydronic_observation_report().totals.samples == 1,
            "Start installs canonical active defaults before the first queued append");
}
void inactive_startup_paths() {
    exercise_unstarted_lifecycle();
    hydronic_observation_flash_index_reset();
    hydronic_observation_flash_service(reader);
    int64_t               bucket;
    HydronicHourlyPayload p;
    require(!hydronic_observation_flash_next(reader, bucket, p),
            "first pre-Start Flash hooks cannot admit inactive globals");
    hydronic_observation_flash_index_incomplete();
    hydronic_observation_flash_index_reset();
    hydronic_observation_flash_failed();
    require(sdk::creates == 0 && sdk::reads == 0,
            "pre-Start lifecycle and first Flash hooks perform no allocation or payload read");
    hydronic_observation_start(true, 11);
    admit_first_active_observation();
}
void inactive_failed_create_recovery() {
    sdk::fail_create = true;
    hydronic_observation_start(true, 11);
    require(store_mutex() == nullptr && sdk::creates == 1,
            "failed creation leaves inactive globals behind an unpublished mutex");
    exercise_unstarted_lifecycle();
    sdk::fail_create = false;
    hydronic_observation_start(true, 11);
    admit_first_active_observation();
}
void inactive_failed_take_recovery() {
    sdk::fail_takes = 1;
    hydronic_observation_start(true, 11);
    require(store_mutex() == nullptr && !sdk::mutex.owned && !sdk::fail_takes,
            "failed first acquisition does not publish inactive live state");
    exercise_unstarted_lifecycle();
    hydronic_observation_start(true, 11);
    admit_first_active_observation();
}
void inactive_publication() {
    sdk::before_create = [] {
        require(store_mutex() == nullptr, "creation hook still sees an unpublished mutex");
        exercise_unstarted_lifecycle();
    };
    sdk::before_take = [] {
        require(
            store_mutex() == nullptr,
            "first-acquire hook still sees an unpublished mutex before canonical initialization");
        exercise_unstarted_lifecycle();
    };
    hydronic_observation_start(true, 11);
    require(store_mutex() == &sdk::mutex && sdk::creates == 1,
            "startup publishes only after canonical initialization despite early readers");
    admit_first_active_observation();
}
HydronicReadResult partial_failed_reader(uint16_t, int64_t&, uint64_t&, HydronicHourlyPayload& p) {
    ++sdk::reads;
    require(!sdk::mutex.owned, "partial reader port also runs outside Store lock");
    // An interrupted read may overwrite only part of its borrowed output. It must never
    // admit these incomplete fields, and a later successful production decode must replace them.
    p.first_unix_us = 0;
    p.samples = p.command_samples = UINT32_MAX;
    p.flags                       = 0xffff;
    p.limitations                 = 0x80;
    p.kind                        = HydronicHourlyKind::Fence;
    return HydronicReadResult::Retry;
}
void inactive_partial_reader() {
    boot();
    const int64_t hour = current_bucket();
    const auto    good = payload(hour - 1, 2);
    put(hour - 1, good);
    hydronic_observation_flash_service(partial_failed_reader);
    const auto refused = hydronic_observation_report();
    require_canonical_empty_report(refused);
    require(refused.partial && !refused.dropped,
            "partial failed output does not invent observations or queue loss");
    hydronic_observation_flash_service(reader);
    const auto restored = hydronic_observation_report();
    require(restored.totals.samples == 2 && restored.totals.command_samples == 2 &&
                restored.totals.limitations == 0 && restored.dropped == 0 &&
                restored.totals.first_evidence_unix_us == good.first_unix_us &&
                restored.totals.first_accepted_unix_us == good.first_accepted_unix_us,
            "successful real decode fully replaces inactive or partial scratch fields");
}
HydronicReadResult borrowed_then_lifecycle(uint16_t slot, int64_t& bucket, uint64_t& sequence,
                                           HydronicHourlyPayload& p, bool forget) {
    const auto result = reader(slot, bucket, sequence, p);
    if (result != HydronicReadResult::Valid) return result;
    std::array<uint8_t, HYDRONIC_PAYLOAD_BYTES> before, after;
    HistoryJournalHeader                        header{};
    hydronic_encode(p, before.data(), header);
    const auto minimum = p.flow_min_evidence;
    if (forget)
        hydronic_observation_forget();
    else {
        hydronic_observation_reset();
        hydronic_observation_bind(101, 202, 303, 8, false);
    }
    hydronic_encode(p, after.data(), header);
    require(before == after && minimum == p.flow_min_evidence,
            "reset and forget leave the Flash-owner borrowed scratch unchanged");
    return HydronicReadResult::Valid;
}
HydronicReadResult borrowed_then_reset(uint16_t slot, int64_t& bucket, uint64_t& sequence,
                                       HydronicHourlyPayload& p) {
    return borrowed_then_lifecycle(slot, bucket, sequence, p, false);
}
HydronicReadResult borrowed_then_forget(uint16_t slot, int64_t& bucket, uint64_t& sequence,
                                        HydronicHourlyPayload& p) {
    return borrowed_then_lifecycle(slot, bucket, sequence, p, true);
}
void inactive_staged_lifecycle(bool forget) {
    boot();
    put(current_bucket() - 1, payload(current_bucket() - 1, 3));
    hydronic_observation_flash_service(forget ? borrowed_then_forget : borrowed_then_reset);
    const auto r = hydronic_observation_report();
    require_canonical_empty_report(r);
    require(hydronic_observation_suppressed() == forget,
            "staged lifecycle retains its own privacy state without publishing the old payload");
}
} // namespace
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const std::string name = argv[1];
    try {
        if (name == "codec")
            codec();
        else if (name == "minimum_windows")
            minimum_windows();
        else if (name == "settling_durations")
            settling_durations();
        else if (name == "seam_and_revisions")
            seam_and_revisions();
        else if (name == "overlapping_archive_fragment")
            overlapping_archive_fragment();
        else if (name == "overlap_shutdown_drain")
            overlapping_archive_fragment(true);
        else if (name == "disjoint_earlier_archive_fragment")
            disjoint_earlier_archive_fragment();
        else if (name == "shared_duration_archive_report" ||
                 name == "shared_duration_archive_append")
            shared_duration_edge(name == "shared_duration_archive_report");
        else if (name == "sample_only_archive_edge")
            sample_only_archive_edge();
        else if (name == "sample_only_newer_archive_edge")
            sample_only_archive_edge(true);
        else if (name == "between_archived_hours")
            between_archived_hours();
        else if (name == "future_archive_due" || name == "future_bucket_due")
            future_archive_due(name == "future_bucket_due");
        else if (name == "future_boundary_during_rebuild")
            future_boundary_during_rebuild();
        else if (name == "saturated_sample_edge")
            saturated_sample_edge();
        else if (name == "restore_and_identity")
            restore_and_identity();
        else if (name == "reset_and_claims")
            reset_and_claims();
        else if (name == "queue_loss")
            queue_loss();
        else if (name == "expiry")
            expiry();
        else if (name == "archive_clock_rollback" || name == "archive_clock_rollback_live")
            archive_clock_rollback(name == "archive_clock_rollback_live");
        else if (name == "clock")
            clock_cases();
        else if (name == "receipts")
            receipts();
        else if (name == "fences_and_index")
            fences_and_index();
        else if (name == "forget_and_seal")
            forget_and_seal();
        else if (name == "wide_totals")
            wide_totals();
        else if (name == "reader_races")
            reader_races();
        else if (name == "invalid_deltas")
            invalid_deltas();
        else if (name == "read_failures")
            read_failures();
        else if (name == "reset_before_commit")
            reset_before_commit();
        else if (name == "early_forget")
            early_forget();
        else if (name == "creation_forget")
            creation_forget();
        else if (name == "creation_publish")
            creation_publish();
        else if (name == "failed_creation_forget")
            failed_creation_forget();
        else if (name == "staging_forget")
            staging_forget();
        else if (name == "claim_forget")
            claim_forget();
        else if (name == "index_reset_before_start")
            index_reset_before_start();
        else if (name == "index_record_before_start")
            index_record_before_start();
        else if (name == "index_incomplete_before_start")
            index_incomplete_before_start();
        else if (name == "index_service_before_start")
            index_service_before_start();
        else if (name == "index_next_before_start")
            index_next_before_start();
        else if (name == "index_producer_ownership")
            index_producer_ownership();
        else if (name == "index_suppressed_no_init")
            index_suppressed_no_init();
        else if (name == "index_suppressed_existing_reset")
            index_suppressed_existing_reset();
        else if (name == "inactive_startup_paths")
            inactive_startup_paths();
        else if (name == "inactive_failed_create_recovery")
            inactive_failed_create_recovery();
        else if (name == "inactive_failed_take_recovery")
            inactive_failed_take_recovery();
        else if (name == "inactive_publication")
            inactive_publication();
        else if (name == "inactive_partial_reader")
            inactive_partial_reader();
        else if (name == "inactive_staged_reset")
            inactive_staged_lifecycle(false);
        else if (name == "inactive_staged_forget")
            inactive_staged_lifecycle(true);
        else
            return 2;
        std::cout << name << ": " << assertions << " assertions passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << name << ": FAILED after " << assertions << " assertions: " << error.what()
                  << '\n';
        return 1;
    }
}
