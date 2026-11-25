// Host-only physical-slot fixtures. The three small History extracts below are
// copied verbatim from the reviewed r2 fixture, based on Shipping eeee4a9662a5;
// they call the actual normalized-header/payload CRC and structural match helpers.
#include "logic/heater_context_cohort.hpp"
#include <array>
#include <cstdio>
#include <cstring>
#include <new>

namespace heater_cohort_host_tests {
namespace hc    = daik::logic::heater_cohort;
namespace hd    = daik::logic::heater_context;
namespace logic = daik::logic;
using namespace daik::logic;
using namespace daik;
namespace physical {
// Exact existing History extract, retained by the reviewed cohort fixture.
struct FlashJournalRecord {
    logic::HistoryJournalHeader header;
    // Raw because ordinary trend records carry dense int16 samples, source four carries one
    // CheckupJournalPayload, and the manifest flag changes the payload to uint32 ids. For ordinary
    // and checkup records value_count remains a count of 16-bit words, so old v1 trend records stay
    // byte-for-byte readable.
    alignas(
        8) uint8_t payload[logic::HISTORY_JOURNAL_SLOT_BYTES - logic::HISTORY_JOURNAL_HEADER_BYTES];
};
static_assert(sizeof(FlashJournalRecord) == logic::HISTORY_JOURNAL_SLOT_BYTES,
              "one journal record is exactly one physical slot");
static_assert(std::is_trivially_copyable<FlashJournalRecord>::value,
              "sector scratch records must not retain resources or references");
static_assert(logic::CHECKUP_JOURNAL_PAYLOAD_BYTES <= sizeof(FlashJournalRecord::payload),
              "one diagnostic hour must fit the shared journal slot");

// Exact existing History extract, retained by the reviewed cohort fixture.
bool flash_is_manifest(const logic::HistoryJournalHeader& h) {
    return h.flags == logic::HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST &&
           h.source < static_cast<uint8_t>(logic::HistoryJournalSource::Checkup);
}

// Exact existing History extract, retained by the reviewed cohort fixture.
bool flash_record_physically_valid(const FlashJournalRecord& r) {
    const auto& h       = r.header;
    const bool  checkup = h.source == static_cast<uint8_t>(logic::HistoryJournalSource::Checkup);
    const bool  room    = h.source == static_cast<uint8_t>(logic::HistoryJournalSource::RetiredRoom);
    const bool  header_ok =
        room ? logic::history_journal_retired_room_header_matches(h)
         : checkup
             ? logic::history_journal_checkup_header_structural_matches(h, logic::CHECKUP_DT_S)
             : (flash_is_manifest(h) ? logic::history_journal_manifest_header_matches(h)
                                     : logic::history_journal_trend_header_structural_matches(h));
    const size_t payload_bytes = logic::history_journal_payload_bytes(h);
    if (!header_ok || payload_bytes > sizeof(r.payload)) return false;
    if (flash_is_manifest(h) && !logic::history_journal_manifest_payload_matches(
                                    h, reinterpret_cast<const uint32_t*>(r.payload)))
        return false;
    return header_ok && h.crc == logic::history_journal_crc_bytes(h, r.payload, payload_bytes);
}

static std::array<FlashJournalRecord, HISTORY_JOURNAL_SLOT_COUNT> flash;
static std::array<bool, HISTORY_JOURNAL_SLOT_COUNT>               bad_read;
alignas(FlashJournalRecord) static uint8_t scratch[HISTORY_FLASH_ERASE_BYTES];
static hc::Index* mutate = nullptr;
static unsigned   reads = 0, mutate_after = 0;
static bool       lie = false, mutate_model = false;
static unsigned   invalidate            = 0;
static bool       fail_invalidated_read = false;
void              reset() {
    std::memset(flash.data(), 0xff, sizeof(flash));
    bad_read.fill(false);
    reads                 = 0;
    mutate                = nullptr;
    mutate_after          = 0;
    lie                   = false;
    mutate_model          = false;
    invalidate            = 0;
    fail_invalidated_read = false;
}
struct Reader {
    bool operator()(uint16_t slot, hc::View& view) {
        ++reads;
        if (mutate && reads == mutate_after) {
            if (invalidate == 1)
                (void)hc::observe_clock(*mutate, mutate->last_now - 1);
            else if (invalidate == 2)
                mutate->incomplete = true;
            else if (invalidate == 3)
                mutate->complete = false;
            else if (invalidate == 4)
                mutate->expected_capabilities ^= hd::mask(hd::Category::Silent);
            else if (invalidate == 5)
                mutate->expected_required = 1;
            else if (mutate_model)
                ++mutate->expected.model;
            else
                ++mutate->epoch;
            if (invalidate && fail_invalidated_read) return false;
        }
        if (slot >= flash.size() || bad_read[slot]) return false;
        auto& r = *new (scratch) FlashJournalRecord;
        std::memcpy(&r, &flash[slot], sizeof(r));
        view = {&r.header, r.payload, sizeof(r.payload), lie || flash_record_physically_valid(r)};
        return true;
    }
};
void header(FlashJournalRecord& r, hc::Kind kind, int64_t bucket, uint64_t sequence) {
    std::memset(&r, 0xff, sizeof(r));
    auto& h       = r.header;
    h.magic       = HISTORY_JOURNAL_MAGIC;
    h.version     = HISTORY_JOURNAL_VERSION;
    h.source      = uint8_t(HistoryJournalSource::Checkup);
    h.flags       = 0;
    h.catalog_fp  = hc::fingerprint(kind);
    h.crc         = 0;
    h.commit      = HISTORY_JOURNAL_ERASED;
    h.value_count = uint16_t(hc::wire_bytes(kind) / 2);
    h.slot_bytes  = HISTORY_JOURNAL_SLOT_BYTES;
    h.sequence    = sequence;
    h.bucket      = bucket;
    h.dt_s        = 3600;
    h.rings[0]    = TREND_COUNT;
    h.rings[1]    = HOMEHUB_HISTORY_COUNT;
    h.rings[2]    = ENV3_HISTORY_COUNT;
    h.reserved    = 0xffff;
}
void seal(FlashJournalRecord& r) {
    r.header.crc =
        history_journal_crc_bytes(r.header, r.payload, history_journal_payload_bytes(r.header));
    r.header.commit = HISTORY_JOURNAL_COMMITTED;
}
void data(uint16_t slot, int64_t bucket, uint64_t seq, const hc::Data& d) {
    auto& r = flash[slot];
    header(r, hc::Kind::Data, bucket, seq);
    CHECK(hc::encode_data(d, r.payload, hc::DATA_BYTES));
    seal(r);
}
void commit(uint16_t slot, int64_t bucket, const hc::Commit& c) {
    auto& r = flash[slot];
    header(r, hc::Kind::Commit, bucket, c.revision);
    CHECK(hc::encode_commit(c, r.payload, hc::COMMIT_BYTES));
    seal(r);
}
void fence(uint16_t slot, int64_t bucket, uint64_t sequence, const hc::Identity& id,
           uint8_t reason = 1) {
    auto& r = flash[slot];
    header(r, hc::Kind::Fence, bucket, sequence);
    hc::Fence f;
    f.identity = id;
    f.sequence = sequence;
    f.reason   = reason;
    CHECK(hc::encode_fence(f, r.payload, hc::FENCE_BYTES));
    seal(r);
}
} // namespace physical
constexpr int64_t      S = 1000000, B = 1000;
constexpr hc::Identity ID{11, 22, 33, 0, 0};
static hc::Workspace   work;
static hc::Data        sample(uint8_t heater, uint8_t required, uint32_t on = 1000000,
                              uint32_t span = 100000000) {
    hc::Data d;
    d.identity     = ID;
    d.heater       = heater;
    d.required     = required;
    d.capabilities = hd::ALL;
    d.flags        = 1;
    d.last         = span;
    auto& c        = d.counters;
    c.readable_us = c.on_us = c.union_us = c.complete_context_us = on;
    c.samples = c.readable_samples = c.on_samples = 2;
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        c.evaluable_on_us[k]      = on;
        c.evaluable_on_samples[k] = 2;
    }
    c.positive_us[size_t(hd::Category::Silent)]      = on;
    c.positive_samples[size_t(hd::Category::Silent)] = 2;
    CHECK(hc::valid_data(d));
    return d;
}
static hc::Commit cohort(uint16_t slot, uint64_t sequence, uint8_t mask = 3, uint32_t buh = 1000000,
                         uint32_t bsh = 2000000, hc::Identity identity = ID, int64_t bucket = B,
                         uint32_t span = 100000000) {
    hc::Commit c;
    CHECK(hc::descriptor(c, identity, mask, sequence, slot, uint16_t(slot + (mask == 3)), 0, span,
                         hd::ALL, 1));
    for (size_t h = 0; h < 2; ++h)
        if (mask & (1u << h)) {
            auto d     = sample(uint8_t(h), mask, h ? bsh : buh, span);
            d.identity = identity;
            physical::data(c.slot[h], bucket, c.sequence[h], d);
        }
    physical::commit(uint16_t(slot + hc::pieces(mask)), bucket, c);
    return c;
}
static bool scan(hc::Index& i, int64_t now = B * hc::HOUR_US + 500 * S, const hc::Identity& id = ID,
                 uint32_t epoch = 1, uint8_t mask = 3) {
    CHECK(hc::begin_scan(i, id, epoch, now, hd::ALL, mask));
    physical::Reader read;
    for (uint32_t slot = 0; slot < HISTORY_JOURNAL_SLOT_COUNT; ++slot) {
        hc::View   v;
        const bool ok = read(uint16_t(slot), v);
        (void)hc::scan_slot(i, uint16_t(slot), v, ok, work);
    }
    return hc::finish_scan(i);
}
static hc::Report replay(hc::Index& i, int64_t now = B * hc::HOUR_US + 500 * S,
                         const hc::Identity& id = ID, uint32_t epoch = 1) {
    hc::Report       out;
    physical::Reader read;
    (void)hc::replay(i, read, now, id, epoch, work, out);
    return out;
}
static bool totals_empty(const hd::Totals& c) {
    if (c.readable_us || c.on_us || c.off_us || c.transition_us || c.unreadable_us || c.union_us ||
        c.overlap_us || c.unknown_context_us || c.unclassified_us || c.complete_context_us ||
        c.samples || c.readable_samples || c.on_samples || c.saturated)
        return false;
    for (size_t k = 0; k < hd::CATEGORIES; ++k)
        if (c.positive_us[k] || c.evaluable_on_us[k] || c.positive_samples[k] ||
            c.evaluable_on_samples[k])
            return false;
    return true;
}
static void opaque_fence_retirement(unsigned damage) {
    CHECK(damage < 6);
    physical::reset();
    cohort(0, 1);
    physical::fence(20, B - 30, 4, ID);
    auto& f = physical::flash[20];
    if (damage == 0) f.header.magic ^= 1;
    if (damage == 1) f.header.commit = HISTORY_JOURNAL_ERASED;
    if (damage == 2) f.header.crc ^= 1;
    if (damage == 3) f.header.catalog_fp ^= 1;
    if (damage == 4) f.payload[0] ^= 1;
    if (damage == 5) {
        f.payload[0] ^= 1;
        physical::seal(f); // CRC-valid invalid METHOD must still refuse its typed fence.
    }
    CHECK(physical::flash_record_physically_valid(f) == (damage == 5));
    hc::Index direct;
    CHECK(hc::begin_scan(direct, ID, 1, B * hc::HOUR_US + 500 * S));
    physical::Reader read;
    bool             reads_ok = true, prior_accepted = true, damaged_accepted = true;
    for (uint16_t slot = 0; slot <= 20; ++slot) {
        hc::View   view;
        const bool read_ok  = read(slot, view);
        reads_ok            = reads_ok && read_ok;
        const bool accepted = hc::scan_slot(direct, slot, view, read_ok, work);
        if (slot == 20)
            damaged_accepted = accepted;
        else
            prior_accepted = prior_accepted && accepted;
    }
    CHECK(reads_ok && prior_accepted && !damaged_accepted && direct.incomplete);
    hc::Index  i;
    const bool scanned = scan(i);
    const auto r       = replay(i);
    std::printf("WITNESS opaque-fence damage=%u scanned=%d ready=%d BUH=%llu BSH=%llu flags=%u\n",
                damage, int(scanned), int(r.ready),
                static_cast<unsigned long long>(r.heater[0].on_us),
                static_cast<unsigned long long>(r.heater[1].on_us), unsigned(r.flags));
    CHECK(!scanned && i.incomplete);
    CHECK(!r.ready && (r.flags & hc::Incomplete) && (r.flags & hc::Loss));
    CHECK(totals_empty(r.heater[0]) && totals_empty(r.heater[1]));
    CHECK(!r.hours[0] && !r.hours[1] && !r.newest_revision && !r.loss_notices);
    // Repeated complete reads cannot heal retained opaque bytes or resurrect old scope data.
    CHECK(!scan(i));
    CHECK(!replay(i).ready);
}
static void opaque_slot_controls() {
    for (unsigned damage = 0; damage < 6; ++damage) opaque_fence_retirement(damage);
    // Fully erased slots remain neutral; a real CRC-valid unknown record type is foreign,
    // unlike a damaged known type whose unchanged envelope CRC no longer matches.
    physical::reset();
    hc::Index erased;
    CHECK(scan(erased));
    auto r = replay(erased);
    CHECK(r.ready && totals_empty(r.heater[0]) && totals_empty(r.heater[1]));
    cohort(0, 1);
    physical::fence(20, B - 30, 4, ID);
    physical::flash[20].header.catalog_fp ^= 1;
    physical::seal(physical::flash[20]);
    CHECK(hc::kind(physical::flash[20].header) == hc::Kind::Unknown);
    CHECK(physical::flash_record_physically_valid(physical::flash[20]));
    hc::Index foreign;
    CHECK(scan(foreign));
    r = replay(foreign);
    CHECK(r.ready && r.heater[0].on_us == S && r.heater[1].on_us == 2 * S);
    // A legitimate power cut during Data programming has the same ambiguous footprint.
    // The archive is unavailable; an independent current live reducer keeps accumulating.
    physical::reset();
    cohort(0, 1);
    physical::data(20, B, 4, sample(0, 3));
    physical::flash[20].header.commit = HISTORY_JOURNAL_ERASED;
    hd::State  live;
    hd::Hour   live_hour;
    hd::Sample current;
    current.heater[0] = current.heater[1] = hd::Bit::On;
    current.silent                        = hd::Bit::On;
    CHECK(hd::step(live, live_hour, 0, 11, 33, 3, hd::ALL, current) == hd::Admission::Seeded);
    CHECK(hd::step(live, live_hour, S, 11, 33, 3, hd::ALL, current) == hd::Admission::Continued);
    hc::Index torn;
    CHECK(!scan(torn));
    r = replay(torn);
    CHECK(!r.ready && (r.flags & hc::Incomplete) && totals_empty(r.heater[0]) &&
          totals_empty(r.heater[1]));
    CHECK(live_hour.heater[0].on_us == S && live_hour.heater[1].on_us == S);
    CHECK(hd::step(live, live_hour, 2 * S, 11, 33, 3, hd::ALL, current) ==
          hd::Admission::Continued);
    CHECK(live_hour.heater[0].on_us == 2 * S && live_hour.heater[1].on_us == 2 * S);
    // Even one non-erased payload byte behind an erased header remains opaque.
    physical::reset();
    cohort(0, 1);
    physical::flash[20].payload[HISTORY_JOURNAL_PAYLOAD_BYTES - 1] = 0xfe;
    hc::Index tail;
    CHECK(!scan(tail));
    r = replay(tail);
    CHECK(!r.ready && totals_empty(r.heater[0]) && totals_empty(r.heater[1]));
    std::puts("CASE opaque-fence/torn-data/erased/foreign/live-independence PASS");
}
static void atomic_cases() {
    for (unsigned phase = 0; phase < 3; ++phase) {
        physical::reset();
        auto c                           = cohort(0, 1);
        physical::flash[2].header.commit = HISTORY_JOURNAL_ERASED;
        if (phase == 0) physical::flash[1].header.commit = HISTORY_JOURNAL_ERASED;
        if (phase == 2) physical::flash[2].header.commit = HISTORY_JOURNAL_COMMITTED;
        hc::Index  i;
        const bool scanned = scan(i);
        CHECK(scanned == (phase == 2));
        auto r = replay(i);
        if (phase < 2) {
            CHECK(!r.ready && (r.flags & hc::Incomplete) && (r.flags & hc::Loss));
            CHECK(totals_empty(r.heater[0]) && totals_empty(r.heater[1]));
        } else {
            CHECK(r.ready);
            CHECK(r.heater[0].on_us == S && r.heater[1].on_us == 2 * S &&
                  r.newest_revision == c.revision);
        }
    }
    physical::reset();
    cohort(0, 1);
    auto      newest = cohort(10, 4, 3, 10 * S, 20 * S);
    hc::Index i;
    CHECK(scan(i));
    auto r = replay(i);
    CHECK(r.heater[0].on_us == 10 * S && r.heater[1].on_us == 20 * S);
    CHECK(r.hours[0] == 1 && r.hours[1] == 1 && r.newest_revision == newest.revision);
    auto repeated = replay(i);
    CHECK(repeated.heater[0].on_us == r.heater[0].on_us); // no revision or replay summation
    // Newer orphan must mark the older complete cohort, never appear as a clean fallback.
    physical::reset();
    cohort(0, 1);
    auto d = sample(0, 3, 10 * S);
    physical::data(10, B, 4, d);
    hc::Index orphan;
    CHECK(scan(orphan));
    r = replay(orphan);
    CHECK(r.heater[0].on_us == S && r.heater[1].on_us == 2 * S && (r.flags & hc::Orphan) &&
          (r.flags & hc::Loss));
    // Latest committed descriptor references a failed second fragment: neither heater falls back.
    physical::reset();
    cohort(0, 1);
    cohort(10, 4, 3, 10 * S, 20 * S);
    hc::Index failure;
    CHECK(scan(failure));
    physical::bad_read[11] = true;
    r                      = replay(failure);
    CHECK(r.ready && !r.heater[0].on_us && !r.heater[1].on_us && (r.flags & hc::LatestFailure) &&
          (r.flags & hc::Loss));
    // Foreign slot overwrite after indexing must not pair old or unrelated data.
    physical::bad_read[11]              = false;
    physical::flash[11].header.sequence = UINT64_C(1) << 50;
    physical::seal(physical::flash[11]);
    r = replay(failure);
    CHECK(!r.heater[0].on_us && !r.heater[1].on_us && (r.flags & hc::LatestFailure));
    // A torn/unidentifiable descriptor could have been a fence. Even when no newer data
    // remains to supply an orphan signal, old retained counts must remain unavailable.
    for (unsigned damage = 0; damage < 2; ++damage) {
        physical::reset();
        cohort(0, 1);
        cohort(10, 4);
        std::memset(&physical::flash[10], 0xff, sizeof(physical::flash[10]));
        std::memset(&physical::flash[11], 0xff, sizeof(physical::flash[11]));
        if (damage)
            physical::flash[12].header.commit ^= 1;
        else
            physical::flash[12].header.magic ^= 1;
        hc::Index torn;
        CHECK(!scan(torn));
        r = replay(torn);
        CHECK(!r.ready && (r.flags & hc::Incomplete) && (r.flags & hc::Loss) &&
              totals_empty(r.heater[0]) && totals_empty(r.heater[1]));
    }
    std::puts("CASE atomic/torn/orphan/latest/revision PASS");
}
static void crc_and_corruption() {
    physical::reset();
    auto c = cohort(0, 1);
    CHECK(physical::flash_record_physically_valid(physical::flash[0]));
    const auto header_crc  = physical::flash[0].header.crc;
    const auto payload_crc = config_crc32_final(
        config_crc32_update(CONFIG_CRC32_INIT, physical::flash[0].payload, hc::DATA_BYTES));
    CHECK(header_crc != payload_crc);
    auto original                 = physical::flash[0];
    physical::flash[0].header.crc = payload_crc;
    CHECK(!physical::flash_record_physically_valid(physical::flash[0]));
    hc::Index bad;
    CHECK(!scan(bad));
    auto r = replay(bad);
    CHECK(!r.ready && (r.flags & hc::Incomplete));
    // Even an adapter that incorrectly says physical=true cannot bypass typed normal CRC.
    hc::View v{&physical::flash[0].header, physical::flash[0].payload, 192, true};
    CHECK(!hc::typed(v, hc::Kind::Data));
    physical::flash[0] = original;
    for (size_t byte = 0; byte < sizeof(original); ++byte) {
        physical::flash[0] = original;
        reinterpret_cast<uint8_t*>(&physical::flash[0])[byte] ^= 1;
        CHECK(!physical::flash_record_physically_valid(physical::flash[0]));
    }
    physical::flash[0] = original;
    // Codec rejection controls have a recomputed, otherwise valid real envelope CRC.
    const auto commit_original = physical::flash[2];
    for (size_t offset : {size_t(0), size_t(1), size_t(24), size_t(48), size_t(61)}) {
        physical::flash[2] = commit_original;
        physical::flash[2].payload[offset] ^= 0xff;
        physical::seal(physical::flash[2]);
        hc::Commit parsed;
        CHECK(!hc::decode_commit_into(physical::flash[2].payload, 64, parsed));
    }
    physical::flash[2] = commit_original;
    hc::Commit round;
    CHECK(hc::decode_commit_into(physical::flash[2].payload, 64, round));
    CHECK(round.revision == c.revision);
    physical::flash[0].payload[189] = 2;
    physical::seal(physical::flash[0]);
    hc::Data parsed;
    CHECK(!hc::decode_data_into(physical::flash[0].payload, 192, parsed)); // invalid bool
    std::puts("CASE actual-header-crc/all-byte-corruption/body-controls PASS");
}
static void reference_and_consistency() {
    for (unsigned variant = 0; variant < 7; ++variant) {
        physical::reset();
        cohort(0, 1);
        hc::Index i;
        CHECK(scan(i));
        auto& d = work.data;
        CHECK(hc::decode_data_into(physical::flash[1].payload, 192, d));
        if (variant == 0) ++d.identity.source;
        if (variant == 1) ++d.identity.model;
        if (variant == 2) ++d.identity.schema;
        if (variant == 3) ++d.identity.consent;
        if (variant == 4) d.heater = 0;
        if (variant == 5) --d.last;
        if (variant == 6) d.required = 2;
        CHECK(hc::encode_data(d, physical::flash[1].payload, 192));
        physical::seal(physical::flash[1]);
        auto r = replay(i);
        CHECK(!r.heater[0].on_us && !r.heater[1].on_us && (r.flags & hc::LatestFailure));
    }
    physical::reset();
    cohort(0, UINT64_C(1) << 40);
    hc::Index high;
    CHECK(scan(high));
    auto r = replay(high);
    CHECK(r.newest_revision == (UINT64_C(1) << 40) + 2 && r.heater[1].on_us == 2 * S);
    hc::Commit invalid;
    CHECK(!hc::descriptor(invalid, ID, 3, UINT64_MAX - 1, 0, 1, 0, 100 * S, hd::ALL, 1));
    CHECK(!hc::descriptor(invalid, ID, 3, 0, 0, 1, 0, 100 * S, hd::ALL, 1));
    CHECK(!hc::descriptor(invalid, ID, 3, 1, 0, 0, 0, 100 * S, hd::ALL, 1));
    CHECK(!hc::descriptor(invalid, ID, 0, 1, 0, 1, 0, 100 * S, hd::ALL, 1));
    physical::reset();
    cohort(0, UINT64_MAX - 2);
    hc::Index maximum;
    CHECK(scan(maximum));
    r = replay(maximum);
    CHECK(r.newest_revision == UINT64_MAX);
    // Reuse of sequence zero after wrap is invalid; owner must stop instead of wrapping.
    CHECK(!hc::descriptor(invalid, ID, 1, 0, 0, 1, 0, 100 * S, hd::ALL, 1));
    for (uint8_t mask : {uint8_t(1), uint8_t(2)}) {
        physical::reset();
        cohort(0, 1, mask);
        hc::Index one;
        CHECK(scan(one, B * hc::HOUR_US + 500 * S, ID, 1, mask));
        r = replay(one);
        CHECK(r.required == mask);
        CHECK(r.hours[mask == 1 ? 0 : 1] == 1 && r.hours[mask == 1 ? 1 : 0] == 0);
        CHECK(r.heater[0].on_us == (mask == 1 ? uint64_t(S) : 0) &&
              r.heater[1].on_us == (mask == 2 ? uint64_t(2 * S) : 0));
    }
    std::puts("CASE exact-refs/identity/time/64bit/one-heater PASS");
}
static void epochs_time_and_fences() {
    physical::reset();
    cohort(0, 1);
    hc::Index i;
    CHECK(scan(i));
    for (unsigned field = 0; field < 4; ++field) {
        auto other = ID;
        if (field == 0) ++other.source;
        if (field == 1) ++other.model;
        if (field == 2) ++other.schema;
        if (field == 3) ++other.consent;
        auto r = replay(i, B * hc::HOUR_US + 500 * S, other);
        CHECK(!r.ready && (r.flags & hc::ScopeMismatch));
        hc::Index rebound;
        CHECK(scan(rebound, B * hc::HOUR_US + 500 * S, other, 2));
        r = replay(rebound, B * hc::HOUR_US + 500 * S, other, 2);
        CHECK(!r.heater[0].on_us && !r.heater[1].on_us);
    }
    auto r = replay(i, B * hc::HOUR_US + 500 * S, ID, 2);
    CHECK(!r.ready && (r.flags & hc::ScopeMismatch));
    // Publication must fail if a source epoch changes during the Reader transaction.
    physical::mutate       = &i;
    physical::reads        = 0;
    physical::mutate_after = 2;
    r                      = replay(i);
    CHECK(!r.ready && (r.flags & hc::ScopeMismatch) && !r.heater[0].on_us);
    physical::mutate = nullptr;
    // Absolute future tail within the CURRENT hour is refused, although bucket itself is in range.
    hc::Index future;
    CHECK(scan(future, B * hc::HOUR_US + 50 * S));
    r = replay(future, B * hc::HOUR_US + 50 * S);
    CHECK(!r.heater[0].on_us && !r.heater[1].on_us && (r.flags & hc::Future) &&
          (r.flags & hc::LatestFailure));
    physical::reset();
    cohort(0, 1, 3, S, 2 * S, ID, B + 2);
    hc::Index future_hour;
    CHECK(scan(future_hour));
    r = replay(future_hour);
    CHECK(!r.heater[0].on_us && (r.flags & hc::Future));
    physical::reset();
    cohort(0, 1);
    hc::Index clock;
    CHECK(scan(clock));
    CHECK(replay(clock).heater[0].on_us == S);
    r = replay(clock, B * hc::HOUR_US + 400 * S);
    CHECK(!r.ready && (r.flags & hc::Clock));
    r = replay(clock, B * hc::HOUR_US + 600 * S);
    CHECK(!r.ready); // catching up never clears a clock fence requirement
    CHECK(!scan(clock,
                B * hc::HOUR_US + 600 * S)); // a complete rescan without a NEW fence also refuses
    physical::fence(20, B - 30, 4, ID, 2);
    CHECK(scan(clock, B * hc::HOUR_US + 600 * S));
    r = replay(clock, B * hc::HOUR_US + 600 * S);
    CHECK(r.ready && !r.heater[0].on_us &&
          !r.heater[1].on_us); // old measurement retired, despite aged fence
    physical::reads = 0;
    r               = replay(clock, B * hc::HOUR_US + 700 * S);
    CHECK(physical::reads == 0); // no recycled fence-slot reread
    physical::flash[20].header.commit = HISTORY_JOURNAL_ERASED;
    r                                 = replay(clock, B * hc::HOUR_US + 800 * S);
    CHECK(!r.heater[0].on_us);
    // A genuinely reconstructed boot index also honors an aged committed RESET fence.
    physical::fence(20, B - 30, 4, ID, 1);
    hc::Index boot;
    CHECK(scan(boot));
    r = replay(boot);
    CHECK(!r.heater[0].on_us);
    // Later legitimate data after the durable fence returns.
    cohort(30, 5, 3, 3 * S, 4 * S);
    hc::Index later;
    CHECK(scan(later));
    r = replay(later);
    CHECK(r.heater[0].on_us == 3 * S && r.heater[1].on_us == 4 * S);
    CHECK(hc::end_not_future(INT64_MAX / hc::HOUR_US, 0, INT64_MAX));
    CHECK(!hc::end_not_future(INT64_MAX / hc::HOUR_US, uint32_t(hc::HOUR_US), INT64_MAX));
    CHECK(!hc::end_not_future(INT64_MAX, 0, INT64_MAX));
    std::puts("CASE epoch/future/clock/reset-aged-fence/no-resurrection PASS");
}
static void scan_pressure_and_damage() {
    physical::reset();
    cohort(0, 1);
    hc::Index i;
    CHECK(hc::begin_scan(i, ID, 1, B * hc::HOUR_US + 500 * S));
    physical::Reader read;
    hc::View         v;
    CHECK(read(0, v));
    CHECK(hc::scan_slot(i, 0, v, true, work));
    CHECK(!hc::finish_scan(i));
    CHECK(!replay(i).ready); // incomplete scan cannot look like an empty complete archive
    CHECK(scan(i));
    CHECK(replay(i).heater[0].on_us == S); // full physical rescan is the recovery boundary
    CHECK(hc::begin_scan(i, ID, 2, B * hc::HOUR_US + 500 * S));
    CHECK(!hc::scan_slot(i, 1, v, true, work));
    CHECK(!hc::finish_scan(i));
    for (size_t n = 0; n < hc::FENCES + 1; ++n) {
        auto id = ID;
        id.source += uint32_t(n);
        physical::fence(uint16_t(100 + n), B - 100, uint64_t(10 + n), id);
    }
    hc::Index pressure;
    CHECK(!scan(pressure));
    CHECK(!replay(pressure).ready);
    physical::reset();
    cohort(0, 1);
    physical::bad_read[300] = true;
    hc::Index io;
    CHECK(!scan(io));
    CHECK(!replay(io).ready);
    physical::bad_read[300] = false;
    CHECK(scan(io));
    CHECK(replay(io).heater[0].on_us == S);
    physical::flash[1].payload[40] ^= 1;
    hc::Index damaged;
    CHECK(!scan(damaged));
    CHECK(!scan(damaged));
    CHECK(!replay(damaged).ready); // reset/rescan cannot heal retained corrupt bytes
    physical::reset();
    cohort(0, 1);
    hc::Index expiry;
    CHECK(scan(expiry));
    auto r = replay(expiry, (B + 24) * hc::HOUR_US);
    CHECK(r.ready && !r.heater[0].on_us); // measurements age; fence metadata does not
    std::puts("CASE ordered-full-scan/pressure/io/permanent-damage/aging PASS");
}
static void capabilities_loss_and_aliases() {
    physical::reset();
    auto c  = cohort(0, 1);
    c.flags = 5;
    c.lost  = 2;
    for (size_t h = 0; h < 2; ++h) {
        hc::Data d;
        CHECK(hc::decode_data_into(physical::flash[h].payload, 192, d));
        d.flags = 5;
        d.lost  = 2;
        CHECK(hc::encode_data(d, physical::flash[h].payload, 192));
        physical::seal(physical::flash[h]);
    }
    physical::commit(2, B, c);
    hc::Index i;
    CHECK(scan(i));
    auto r = replay(i);
    CHECK(r.loss_notices == 2 &&
          (r.flags & hc::Loss)); // common watermark is max, never double-counted per heater
    auto d = sample(1, 3);
    d.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
    CHECK(!hc::valid_data(d)); // unsupported context cannot have complete/evaluable context clocks
    const auto cold                       = size_t(hd::Category::ColdOutdoor);
    d.counters.evaluable_on_us[cold]      = 0;
    d.counters.evaluable_on_samples[cold] = 0;
    d.counters.complete_context_us        = 0;
    d.counters.unknown_context_us         = d.counters.on_us;
    CHECK(hc::valid_data(d));
    physical::data(1, B, 2, d);
    r = replay(i);
    CHECK(!r.heater[0].on_us && !r.heater[1].on_us && (r.flags & hc::LatestFailure));
    hc::Index contradicted;
    CHECK(!scan(contradicted));
    CHECK(!replay(contradicted).ready);
    // Alias-safe entry APIs: callers may pass identity directly out of their current
    // descriptor/index.
    hc::Commit alias;
    c              = hc::Commit{};
    alias.identity = ID;
    CHECK(hc::descriptor(alias, alias.identity, 3, 1, 0, 1, 0, 100 * S, hd::ALL, 1));
    CHECK(hc::equal(alias.identity, ID));
    physical::reset();
    cohort(0, 1);
    hc::Index scope;
    CHECK(scan(scope));
    CHECK(hc::begin_scan(scope, scope.expected, 2, B * hc::HOUR_US + 500 * S));
    CHECK(hc::equal(scope.expected, ID));
    CHECK(scan(scope, B * hc::HOUR_US + 500 * S, ID, 2));
    physical::mutate       = &scope;
    physical::mutate_model = true;
    physical::reads        = 0;
    physical::mutate_after = 2;
    physical::Reader read;
    hc::Report       out;
    CHECK(!hc::replay(scope, read, B * hc::HOUR_US + 500 * S, scope.expected, 2, work, out));
    CHECK(!out.ready && (out.flags & hc::ScopeMismatch) && !out.heater[0].on_us);
    physical::mutate = nullptr;
    std::puts("CASE capability-consistency/loss-watermark/aliased-scope-mutation PASS");
}
static void full_window_and_boundary_controls() {
    // Two distinct physical slots claiming the same final revision are ambiguous, never first-wins.
    physical::reset();
    cohort(0, 1);
    physical::flash[3] = physical::flash[2];
    hc::Index ambiguous;
    CHECK(!scan(ambiguous));
    CHECK(!replay(ambiguous).ready);
    // Finding a new fence during an incomplete scan does not clear the clock block.
    physical::reset();
    cohort(0, 1);
    hc::Index clock;
    CHECK(scan(clock));
    CHECK(!hc::observe_clock(clock, B * hc::HOUR_US + 400 * S));
    physical::fence(20, B - 30, 4, ID, 2);
    physical::bad_read[300] = true;
    CHECK(!scan(clock, B * hc::HOUR_US + 600 * S));
    CHECK(clock.clock_blocked);
    CHECK(!replay(clock, B * hc::HOUR_US + 600 * S).ready);
    physical::bad_read[300] = false;
    CHECK(scan(clock, B * hc::HOUR_US + 600 * S));
    CHECK(!clock.clock_blocked);
    // The clock floor includes physically valid FUTURE records excluded from the hourly index.
    physical::reset();
    cohort(0, 1);
    cohort(10, 100, 3, 3 * S, 4 * S, ID, B + 2);
    hc::Index future_floor;
    CHECK(scan(future_floor));
    CHECK(!hc::observe_clock(future_floor, B * hc::HOUR_US + 400 * S));
    physical::fence(20, B - 30, 4, ID, 2);
    CHECK(!scan(future_floor, B * hc::HOUR_US + 600 * S));
    CHECK(future_floor.clock_blocked); // fence4 cannot retire future revision102
    physical::fence(20, B - 30, 103, ID, 2);
    CHECK(scan(future_floor, B * hc::HOUR_US + 600 * S));
    CHECK(scan(future_floor, (B + 2) * hc::HOUR_US + 500 * S));
    auto retired = replay(future_floor, (B + 2) * hc::HOUR_US + 500 * S);
    CHECK(retired.ready && !retired.heater[0].on_us && !retired.heater[1].on_us);
    // Twenty-three completed hours plus the current partial hour exceed 32-bit totals safely.
    physical::reset();
    uint64_t wanted = 0;
    for (size_t hour = 0; hour < 24; ++hour) {
        const uint32_t span = hour < 23 ? uint32_t(hc::HOUR_US) : 500 * S;
        cohort(uint16_t(hour * 3), uint64_t(hour * 3 + 1), 3, span, span, ID, B + int64_t(hour),
               span);
        wanted += span;
    }
    hc::Data last;
    CHECK(hc::decode_data_into(physical::flash[69].payload, 192, last));
    last.counters.samples = last.counters.readable_samples = last.counters.on_samples = UINT16_MAX;
    last.counters.saturated                                                           = true;
    CHECK(hc::encode_data(last, physical::flash[69].payload, 192));
    physical::seal(physical::flash[69]);
    hc::Index     window;
    const int64_t now = (B + 23) * hc::HOUR_US + 500 * S;
    CHECK(scan(window, now));
    auto r = replay(window, now);
    CHECK(wanted > UINT32_MAX && r.heater[0].on_us == wanted && r.heater[1].on_us == wanted);
    CHECK(r.hours[0] == 24 && r.hours[1] == 24 && r.heater[0].saturated && (r.flags & hc::Partial));
    CHECK(hc::end_not_future(B + 23, 500 * S, now));
    CHECK(!hc::end_not_future(B + 23, 500 * S + 1, now));
    // An unavailable outdoor source identity cannot be smuggled into this X10A-only format.
    auto other    = ID;
    other.outdoor = 1;
    CHECK(!hc::valid_identity(other));
    std::puts("CASE duplicate-revision/incomplete-fence/24hour-wide/saturation/exact-now PASS");
}
static void incomplete_replay_clock_regression() {
    const int64_t now = B * hc::HOUR_US + 500 * S;
    physical::reset();
    cohort(0, 1);
    physical::bad_read[300] = true;
    hc::Index i;
    CHECK(!scan(i, now));
    CHECK(i.incomplete && i.highest_physical_sequence >= 3);
    auto partial = replay(i, now - 1);
    CHECK(!partial.ready);
    physical::bad_read[300] = false;
    const bool repaired     = scan(i, now + 1);
    auto       after        = replay(i, now + 2);
    std::printf(
        "WITNESS incomplete-replay repaired=%u blocked=%u floor=%llu ready=%u buh=%llu bsh=%llu\n",
        unsigned(repaired), unsigned(i.clock_blocked), (unsigned long long)i.fence_floor,
        unsigned(after.ready), (unsigned long long)after.heater[0].on_us,
        (unsigned long long)after.heater[1].on_us);
    CHECK(!repaired && i.clock_blocked && !after.ready && (after.flags & hc::Clock));
    CHECK(i.fence_floor >= 3 && i.highest_physical_sequence >= 3);
    CHECK(!scan(i, now + 100 * S));
    CHECK(!replay(i, now + 101 * S).ready); // catch-up is not retirement
    physical::fence(20, B - 30, 4, ID, 2);
    CHECK(scan(i, now + 101 * S));
    after = replay(i, now + 102 * S);
    CHECK(after.ready && !after.heater[0].on_us && !after.heater[1].on_us);
    std::puts("CASE r2-incomplete-replay/rollback/catchup/durable-fence PASS");
}
static void retry_highwater_clock_regression() {
    const int64_t now = B * hc::HOUR_US + 500 * S, later = (B + 2) * hc::HOUR_US + 500 * S;
    physical::reset();
    cohort(0, 1);
    cohort(10, 100, 3, 3 * S, 4 * S, ID, B + 2);
    physical::fence(20, B - 30, 50, ID, 2);
    hc::Index i;
    CHECK(scan(i, now));
    CHECK(i.highest_physical_sequence == 102);
    for (auto slot : {10, 11, 12, 20}) physical::bad_read[size_t(slot)] = true;
    CHECK(!scan(i, now + 1));
    // Isolate the highwater defect from replay ordering: observe the rollback explicitly.
    CHECK(!hc::observe_clock(i, now));
    for (auto slot : {10, 11, 12, 20}) physical::bad_read[size_t(slot)] = false;
    const bool repaired  = scan(i, now + 2);
    const bool caught_up = scan(i, later);
    auto       after     = replay(i, later);
    std::printf("WITNESS retry-highwater repaired=%u caught_up=%u blocked=%u floor=%llu high=%llu "
                "ready=%u buh=%llu bsh=%llu\n",
                unsigned(repaired), unsigned(caught_up), unsigned(i.clock_blocked),
                (unsigned long long)i.fence_floor, (unsigned long long)i.highest_physical_sequence,
                unsigned(after.ready), (unsigned long long)after.heater[0].on_us,
                (unsigned long long)after.heater[1].on_us);
    CHECK(!repaired && !caught_up && i.clock_blocked && i.fence_floor >= 102 && !after.ready);
    CHECK(i.highest_physical_sequence >= 102);
    physical::fence(20, B - 30, 103, ID, 2);
    CHECK(scan(i, later));
    after = replay(i, later);
    CHECK(after.ready && !after.heater[0].on_us && !after.heater[1].on_us);
    cohort(30, 104, 3, 5 * S, 6 * S, ID, B + 2);
    CHECK(scan(i, later));
    after = replay(i, later);
    CHECK(after.ready && after.heater[0].on_us == 5 * S && after.heater[1].on_us == 6 * S);
    std::puts("CASE r2-retry-highwater/future-sequence/old-fence/no-resurrection PASS");
}
static void final_publication_regression() {
    for (unsigned change = 1; change <= 5; ++change)
        for (bool fail : {true, false}) {
            physical::reset();
            cohort(0, 1);
            hc::Index i;
            CHECK(scan(i));
            physical::mutate                = &i;
            physical::mutate_after          = 3;
            physical::reads                 = 0;
            physical::invalidate            = change;
            physical::fail_invalidated_read = fail;
            auto after                      = replay(i);
            std::printf("WITNESS final-publication change=%u fail=%u ready=%u blocked=%u "
                        "complete=%u incomplete=%u flags=%u\n",
                        change, unsigned(fail), unsigned(after.ready), unsigned(i.clock_blocked),
                        unsigned(i.complete), unsigned(i.incomplete), unsigned(after.flags));
            CHECK(!after.ready && !after.heater[0].on_us && !after.heater[1].on_us);
            CHECK(after.flags & (change == 1   ? hc::Clock
                                 : change <= 3 ? hc::Incomplete
                                               : hc::ScopeMismatch));
            physical::mutate = nullptr;
        }
    std::puts("CASE r2-final-publication/all-gates/successful-and-failed-reader PASS");
}
static hc::Data inconsistent_data(unsigned kind) {
    auto  bad = sample(0, 3);
    auto& c   = bad.counters;
    if (kind == 0) { // complete=ON despite every category unevaluable
        for (size_t k = 0; k < hd::CATEGORIES; ++k) c.positive_us[k] = c.evaluable_on_us[k] = 0;
        c.union_us        = 0;
        c.unclassified_us = c.on_us;
    } else if (kind == 1) {
        --c.union_us;
        ++c.unclassified_us;
    } // max positive > union
    else if (kind == 2) {
        for (size_t k = 0; k < hd::CATEGORIES; ++k) c.positive_us[k] = 0;
    } // union > sum positive
    else if (kind == 3)
        c.overlap_us = c.on_us; // single positive, no excess, alleged overlap
    else if (kind == 4)
        c.positive_us[0] = c.on_us; // two positives, no overlap to carry excess
    else if (kind == 5) {
        c.complete_context_us = 0;
        c.unknown_context_us  = c.on_us;
    } // every eval=ON but no complete
    return bad;
}
static void put_u32(uint8_t* p, size_t offset, uint32_t value) {
    for (size_t b = 0; b < 4; ++b) p[offset + b] = uint8_t(value >> (8 * b));
}
static void aggregate_validation_regression(unsigned kind) {
    physical::reset();
    auto bad   = inconsistent_data(kind);
    auto valid = sample(0, 3);
    physical::data(0, B, 1, valid);
    auto&       record = physical::flash[0];
    const auto& c      = bad.counters;
    // Independently patch fixed wire time-field offsets, then recompute the ACTUAL header+payload
    // CRC.
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        put_u32(record.payload, 55 + 8 * k, c.positive_us[k]);
        put_u32(record.payload, 59 + 8 * k, c.evaluable_on_us[k]);
    }
    put_u32(record.payload, 127, c.union_us);
    put_u32(record.payload, 131, c.overlap_us);
    put_u32(record.payload, 135, c.unknown_context_us);
    put_u32(record.payload, 139, c.unclassified_us);
    put_u32(record.payload, 143, c.complete_context_us);
    physical::seal(record);
    CHECK(physical::flash_record_physically_valid(record));
    hc::Data   decoded;
    const bool accepted = hc::decode_data_into(record.payload, 192, decoded),
               native   = hc::valid_data(bad);
    std::printf("WITNESS aggregate-%u actual_crc=1 accepted=%u native=%u\n", kind,
                unsigned(accepted), unsigned(native));
    CHECK(!accepted && !native);
    uint8_t output[192];
    CHECK(!hc::encode_data(bad, output, sizeof(output)));
}
static void valid_aggregate_boundaries() {
    for (size_t positive : {size_t(2), hd::CATEGORIES}) {
        auto  d = sample(0, 3);
        auto& c = d.counters;
        for (size_t k = 0; k < hd::CATEGORIES; ++k) c.positive_us[k] = k < positive ? c.on_us : 0;
        c.overlap_us = c.on_us;
        CHECK(hc::valid_data(d)); // multiple simultaneous positives have valid excess
    }
    auto  limited = sample(0, 3);
    auto& c       = limited.counters;
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        c.positive_us[k]     = 0;
        c.evaluable_on_us[k] = k ? 0 : c.on_us;
    }
    c.union_us            = 0;
    c.unclassified_us     = c.on_us;
    c.complete_context_us = 0;
    c.unknown_context_us  = c.on_us;
    CHECK(hc::valid_data(limited));
    CHECK(!c.complete_context_us); // one known category is not full context
    for (size_t k = 0; k < hd::CATEGORIES; ++k) c.evaluable_on_us[k] = uint32_t(S / 2);
    c.complete_context_us = uint32_t(S / 5);
    c.unknown_context_us  = uint32_t(4 * S / 5);
    CHECK(hc::valid_data(
        limited)); // bounds admit legitimate non-exact marginals, no recomputation fiction
    std::puts("CASE r2-valid-aggregate-bounds/limited-context/multiple-overlap PASS");
}
static void malformed_native_and_codec_guards() {
    using D          = hc::Data;
    const auto valid = sample(0, 3);
    struct DataCase {
        const char* name;
        void (*damage)(D&);
    };
    const DataCase cases[] = {
        {"source-zero", [](D& d) { d.identity.source = 0; }},
        {"model-zero", [](D& d) { d.identity.model = 0; }},
        {"schema-zero", [](D& d) { d.identity.schema = 0; }},
        {"foreign-outdoor", [](D& d) { d.identity.outdoor = 1; }},
        {"heater-range", [](D& d) { d.heater = 2; }},
        {"no-required", [](D& d) { d.required = 0; }},
        {"unknown-required", [](D& d) { d.required = 4; }},
        {"wrong-required", [](D& d) { d.required = 2; }},
        {"unknown-capability", [](D& d) { d.capabilities = hd::ALL + 1; }},
        {"unknown-wire-flag", [](D& d) { d.flags = 0x8000; }},
        {"reversed-span", [](D& d) { d.first = d.last + 1; }},
        {"long-span", [](D& d) { d.last = uint32_t(hc::HOUR_US + 1); }},
        {"loss-without-loss-flag",
         [](D& d) {
             d.lost  = 1;
             d.flags = hc::WirePartial;
         }},
        {"loss-without-partial-flag",
         [](D& d) {
             d.lost  = 1;
             d.flags = hc::WireLoss;
         }},
        {"time-outside-span", [](D& d) { d.counters.unreadable_us = d.last; }},
        {"readable-partition", [](D& d) { ++d.counters.off_us; }},
        {"union-partition", [](D& d) { ++d.counters.unclassified_us; }},
        {"context-partition", [](D& d) { ++d.counters.unknown_context_us; }},
        {"overlap-greater-union", [](D& d) { d.counters.overlap_us = d.counters.union_us + 1; }},
        {"readable-sample-bound", [](D& d) { ++d.counters.readable_samples; }},
        {"on-sample-bound", [](D& d) { ++d.counters.on_samples; }},
        {"positive-time-bound",
         [](D& d) { ++d.counters.positive_us[size_t(hd::Category::Silent)]; }},
        {"evaluable-time-bound", [](D& d) { ++d.counters.evaluable_on_us[0]; }},
        {"positive-sample-bound",
         [](D& d) { ++d.counters.positive_samples[size_t(hd::Category::Silent)]; }},
        {"evaluable-sample-bound", [](D& d) { ++d.counters.evaluable_on_samples[0]; }},
        {"unsupported-complete",
         [](D& d) { d.capabilities ^= hd::mask(hd::Category::ColdOutdoor); }},
        {"unsupported-positive-time",
         [](D& d) {
             d.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
             d.counters.complete_context_us                            = 0;
             d.counters.unknown_context_us                             = d.counters.on_us;
             d.counters.positive_us[size_t(hd::Category::ColdOutdoor)] = d.counters.on_us;
         }},
        {"unsupported-evaluable-time",
         [](D& d) {
             d.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
             d.counters.complete_context_us = 0;
             d.counters.unknown_context_us  = d.counters.on_us;
         }},
        {"unsupported-positive-samples",
         [](D& d) {
             const auto k = size_t(hd::Category::ColdOutdoor);
             d.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
             d.counters.complete_context_us = 0;
             d.counters.unknown_context_us  = d.counters.on_us;
             d.counters.evaluable_on_us[k]  = 0;
             d.counters.positive_samples[k] = 1;
         }},
        {"unsupported-evaluable-samples",
         [](D& d) {
             const auto k = size_t(hd::Category::ColdOutdoor);
             d.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
             d.counters.complete_context_us = 0;
             d.counters.unknown_context_us  = d.counters.on_us;
             d.counters.evaluable_on_us[k]  = 0;
         }},
    };
    std::array<uint8_t, hc::DATA_BYTES + 1> bytes;
    for (const auto& item : cases) {
        auto d = valid;
        item.damage(d);
        bytes.fill(0x5a);
        CHECK(!hc::valid_data(d));
        CHECK(!hc::encode_data(d, bytes.data(), hc::DATA_BYTES));
        CHECK(bytes.front() == 0x5a && bytes.back() == 0x5a);
    }
    hc::Commit good;
    CHECK(hc::descriptor(good, ID, 1, 1, 0, 1, 0, 100 * S, hd::ALL));
    using C = hc::Commit;
    struct CommitCase {
        const char* name;
        void (*damage)(C&);
    };
    const CommitCase commits[] = {
        {"invalid-scope", [](C& c) { c.identity.schema = 0; }},
        {"no-pieces", [](C& c) { c.required = 0; }},
        {"unknown-pieces", [](C& c) { c.required = 5; }},
        {"no-preceding-sequence", [](C& c) { c.revision = 1; }},
        {"reserved", [](C& c) { c.reserved = 1; }},
        {"reversed-span", [](C& c) { c.first = c.last + 1; }},
        {"long-span", [](C& c) { c.last = uint32_t(hc::HOUR_US + 1); }},
        {"unknown-capability", [](C& c) { c.capabilities = hd::ALL + 1; }},
        {"unknown-wire-flag", [](C& c) { c.flags = 0x8000; }},
        {"unflagged-loss", [](C& c) { c.lost = 1; }},
        {"loss-without-loss-bit",
         [](C& c) {
             c.lost  = 1;
             c.flags = hc::WirePartial;
         }},
        {"loss-without-partial-bit",
         [](C& c) {
             c.lost  = 1;
             c.flags = hc::WireLoss;
         }},
        {"slot-range", [](C& c) { c.slot[0] = HISTORY_JOURNAL_SLOT_COUNT; }},
        {"sequence-reference", [](C& c) { ++c.sequence[0]; }},
        {"unused-sequence", [](C& c) { c.sequence[1] = 1; }},
        {"unused-slot", [](C& c) { c.slot[1] = 0; }},
    };
    for (const auto& item : commits) {
        auto c = good;
        item.damage(c);
        CHECK(!hc::valid_commit(c));
        CHECK(!hc::encode_commit(c, bytes.data(), hc::COMMIT_BYTES));
    }
    hc::Data decoded;
    CHECK(!hc::encode_data(valid, nullptr, hc::DATA_BYTES));
    CHECK(!hc::encode_data(valid, bytes.data(), hc::DATA_BYTES - 1));
    CHECK(!hc::encode_data(valid, bytes.data(), hc::DATA_BYTES + 1));
    CHECK(hc::encode_data(valid, bytes.data(), hc::DATA_BYTES));
    CHECK(!hc::decode_data_into(nullptr, hc::DATA_BYTES, decoded));
    CHECK(!hc::decode_data_into(bytes.data(), hc::DATA_BYTES - 1, decoded));
    CHECK(!hc::decode_data_into(bytes.data(), hc::DATA_BYTES + 1, decoded));
    ++bytes[0];
    CHECK(!hc::decode_data_into(bytes.data(), hc::DATA_BYTES, decoded));
    hc::Commit parsed;
    CHECK(!hc::encode_commit(good, nullptr, hc::COMMIT_BYTES));
    CHECK(!hc::encode_commit(good, bytes.data(), hc::COMMIT_BYTES - 1));
    CHECK(!hc::encode_commit(good, bytes.data(), hc::COMMIT_BYTES + 1));
    CHECK(hc::encode_commit(good, bytes.data(), hc::COMMIT_BYTES));
    CHECK(!hc::decode_commit_into(nullptr, hc::COMMIT_BYTES, parsed));
    CHECK(!hc::decode_commit_into(bytes.data(), hc::COMMIT_BYTES - 1, parsed));
    CHECK(!hc::decode_commit_into(bytes.data(), hc::COMMIT_BYTES + 1, parsed));
    ++bytes[0];
    CHECK(!hc::decode_commit_into(bytes.data(), hc::COMMIT_BYTES, parsed));
    hc::Fence f;
    f.identity = ID;
    f.sequence = 1;
    f.reason   = 1;
    hc::Fence parsed_fence;
    CHECK(!hc::encode_fence(f, nullptr, hc::FENCE_BYTES));
    CHECK(!hc::encode_fence(f, bytes.data(), hc::FENCE_BYTES - 1));
    CHECK(!hc::encode_fence(f, bytes.data(), hc::FENCE_BYTES + 1));
    CHECK(hc::encode_fence(f, bytes.data(), hc::FENCE_BYTES));
    CHECK(!hc::decode_fence_into(nullptr, hc::FENCE_BYTES, parsed_fence));
    CHECK(!hc::decode_fence_into(bytes.data(), hc::FENCE_BYTES - 1, parsed_fence));
    CHECK(!hc::decode_fence_into(bytes.data(), hc::FENCE_BYTES + 1, parsed_fence));
    for (size_t offset : {size_t(0), size_t(2), size_t(3)}) {
        CHECK(hc::encode_fence(f, bytes.data(), hc::FENCE_BYTES));
        ++bytes[offset];
        CHECK(!hc::decode_fence_into(bytes.data(), hc::FENCE_BYTES, parsed_fence));
    }
    for (unsigned bad : {0u, 3u, 4u}) {
        auto invalid = f;
        if (bad == 4)
            invalid.sequence = 0;
        else
            invalid.reason = uint8_t(bad);
        CHECK(!hc::valid_fence(invalid));
        CHECK(!hc::encode_fence(invalid, bytes.data(), hc::FENCE_BYTES));
    }
    f.identity.schema = 0;
    CHECK(!hc::valid_fence(f));
    CHECK(!hc::encode_fence(f, bytes.data(), hc::FENCE_BYTES));
    CHECK(hc::wire_bytes(hc::Kind::Unknown) == 0);
    hc::zero_object(good);
    static_assert(noexcept(hc::zero_object(good)), "clearing staging must not throw");
    CHECK(!good.revision && !good.slot[0] && !good.slot[1] && !good.identity.source);
    std::array<uint8_t, 1024> maximum;
    maximum.fill(0xff);
    hc::zero_object(maximum);
    bool zero = true;
    for (auto byte : maximum) zero = zero && !byte;
    CHECK(zero);
    std::puts("CASE malformed-native/codecs/null/width/reserved/bounded-zero PASS");
}
static void scope_window_and_retirement_guards() {
    constexpr int64_t now = B * hc::HOUR_US + 500 * S;
    CHECK(hc::in_window(0, 0));
    CHECK(!hc::in_window(0, -1));
    CHECK(!hc::in_window(-1, 0));
    CHECK(!hc::in_window(1, 0));
    CHECK(!hc::end_not_future(0, 0, -1));
    CHECK(!hc::end_not_future(-1, 0, 0));
    CHECK(!hc::end_not_future(0, uint32_t(hc::HOUR_US + 1), hc::HOUR_US + 1));
    hc::Index index;
    CHECK(hc::begin_scan(index, ID, 1, now));
    for (unsigned field = 0; field < 4; ++field) {
        auto other = ID;
        if (field == 0) ++other.source;
        if (field == 1) ++other.model;
        if (field == 2) ++other.schema;
        if (field == 3) ++other.consent;
        hc::Fence f;
        f.identity = other;
        f.sequence = 10 + field;
        f.reason   = 1;
        CHECK(hc::valid_fence(f) && hc::add_fence(index, f));
        CHECK(hc::fence_sequence(index, other) == 10 + field);
        --f.sequence;
        CHECK(hc::add_fence(index, f));
        CHECK(hc::fence_sequence(index, other) == 10 + field);
        f.sequence += 2;
        CHECK(hc::add_fence(index, f));
        CHECK(hc::fence_sequence(index, other) == 11 + field);
    }
    CHECK(!hc::fence_sequence(index, ID));
    hc::Fence base_fence;
    base_fence.identity = ID;
    base_fence.sequence = 20;
    base_fence.reason   = 1;
    CHECK(hc::add_fence(index, base_fence));
    CHECK(hc::fence_sequence(index, ID) == 20);
    for (unsigned invalid = 0; invalid < 4; ++invalid) {
        hc::Index i;
        CHECK(!hc::begin_scan(i, ID, 1, invalid == 0 ? -1 : now,
                              invalid == 3 ? hd::ALL + 1 : hd::ALL,
                              invalid == 1   ? 0
                              : invalid == 2 ? 4
                                             : 3));
        CHECK(i.incomplete && !i.complete);
    }
    hc::Index invalid_scope;
    auto      missing_identity = ID;
    missing_identity.source    = 0;
    CHECK(!hc::begin_scan(invalid_scope, missing_identity, 1, now));
    hc::Index startup_clock;
    CHECK(hc::observe_clock(startup_clock, 0));
    CHECK(startup_clock.last_now == 0 && !startup_clock.clock_blocked);
    physical::reset();
    cohort(0, 10);
    cohort(3, 1); // lower physical-slot order is not global sequence chronology
    cohort(6, 20, 3, S, 2 * S, ID, B - 24);
    hc::Index ordered;
    CHECK(scan(ordered));
    auto r = replay(ordered);
    CHECK(r.ready && r.newest_revision == 12 && r.heater[0].on_us == S);
    CHECK(!hc::observe_clock(ordered, -1));
    const auto floor = ordered.fence_floor;
    CHECK(!hc::observe_clock(ordered, -1) && ordered.fence_floor == floor);
    physical::reset();
    cohort(0, 1);
    hc::View good{&physical::flash[0].header, physical::flash[0].payload, hc::DATA_BYTES, true};
    CHECK(hc::typed(good, hc::Kind::Data));
    hc::View absent[] = {{nullptr, good.payload, good.capacity, true},
                         {good.header, nullptr, good.capacity, true},
                         {good.header, good.payload, hc::DATA_BYTES - 1, true},
                         {good.header, good.payload, good.capacity, false}};
    for (const auto& v : absent) CHECK(!hc::typed(v, hc::Kind::Data));
    CHECK(!hc::typed(good, hc::Kind::Unknown));
    auto foreign          = physical::flash[0];
    foreign.header.source = uint8_t(HistoryJournalSource::X10a);
    CHECK(hc::kind(foreign.header) == hc::Kind::Unknown);
    CHECK(!hc::typed({&foreign.header, foreign.payload, sizeof(foreign.payload), true},
                     hc::Kind::Data));
    const auto& erased = physical::flash[20];
    CHECK(hc::slot_erased({&erased.header, erased.payload, sizeof(erased.payload), false}));
    CHECK(!hc::slot_erased({nullptr, erased.payload, sizeof(erased.payload), false}));
    CHECK(!hc::slot_erased({&erased.header, nullptr, sizeof(erased.payload), false}));
    CHECK(!hc::slot_erased({&erased.header, erased.payload, sizeof(erased.payload) - 1, false}));
    std::puts("CASE scope/fence-upsert/invalid-clock/masks/ordered-window/view-guards PASS");
}
static void physical_admission_and_replay_binding_guards() {
    for (unsigned damage = 0; damage < 6; ++damage) {
        physical::reset();
        auto c = cohort(0, 1);
        if (damage == 0) physical::flash[0].payload[1] = 2; // invalid heater, intact real CRC
        if (damage == 1) ++physical::flash[2].payload[0];   // unsupported payload method
        if (damage == 2) {
            ++c.revision;
            ++c.sequence[0];
            ++c.sequence[1];
            CHECK(hc::encode_commit(c, physical::flash[2].payload, hc::COMMIT_BYTES));
        } // valid descriptor, different envelope revision
        if (damage == 3) {
            physical::fence(20, B - 30, 4, ID);
            ++physical::flash[20].header.sequence;
            physical::seal(physical::flash[20]);
        } // valid fence body, different envelope sequence
        if (damage == 4) {
            c.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
            CHECK(hc::encode_commit(c, physical::flash[2].payload, hc::COMMIT_BYTES));
        }
        if (damage == 5) {
            CHECK(hc::descriptor(c, ID, 1, 3, 0, 1, 0, 100 * S, hd::ALL, hc::WirePartial));
            physical::commit(2, B, c);
        }
        if (damage < 3 || damage == 4) physical::seal(physical::flash[damage ? 2 : 0]);
        const auto& damaged = physical::flash[damage == 3 ? 20 : damage ? 2 : 0];
        CHECK(physical::flash_record_physically_valid(damaged));
        hc::Index rejected;
        CHECK(!scan(rejected));
        const auto r = replay(rejected);
        CHECK(!r.ready && (r.flags & hc::Incomplete) && totals_empty(r.heater[0]) &&
              totals_empty(r.heater[1]));
    }
    // All records were physically and semantically admitted at indexing time. Changes between
    // indexing and replay must invalidate the whole referenced cohort without an older fallback.
    for (unsigned damage = 0; damage < 13; ++damage) {
        physical::reset();
        auto      c = cohort(0, 1);
        hc::Index indexed;
        CHECK(scan(indexed));
        if (damage == 0) physical::bad_read[2] = true;
        if (damage == 1) ++physical::flash[2].header.bucket;
        if (damage == 2) ++physical::flash[2].header.sequence;
        if (damage == 3) ++physical::flash[2].payload[0];
        if (damage == 4) ++c.identity.source;
        if (damage == 5)
            CHECK(hc::descriptor(c, ID, 1, 2, 0, 1, 0, 100 * S, hd::ALL, hc::WirePartial));
        if (damage == 6) c.capabilities ^= hd::mask(hd::Category::ColdOutdoor);
        if (damage == 7) {
            ++c.revision;
            ++c.sequence[0];
            ++c.sequence[1];
        }
        if (damage == 8) c.first = 1;
        if (damage == 9) {
            c.lost  = 1;
            c.flags = hc::WirePartial | hc::WireLoss;
        }
        if (damage >= 4 && damage <= 9)
            CHECK(hc::encode_commit(c, physical::flash[2].payload, hc::COMMIT_BYTES));
        if (damage >= 1 && damage <= 9) physical::seal(physical::flash[2]);
        if (damage == 10) {
            ++physical::flash[0].header.bucket;
            physical::seal(physical::flash[0]);
        }
        if (damage == 11) physical::flash[0].payload[0] ^= 1;
        if (damage == 12) physical::data(2, B, 4, sample(0, 3)); // recycled commit slot
        const auto r = replay(indexed);
        CHECK(r.ready && (r.flags & hc::LatestFailure) && (r.flags & hc::Loss));
        CHECK(totals_empty(r.heater[0]) && totals_empty(r.heater[1]) && !r.newest_revision);
    }
    physical::reset();
    auto c = cohort(0, 1);
    for (unsigned heater = 0; heater < 2; ++heater) {
        hc::Data d;
        CHECK(hc::decode_data_into(physical::flash[heater].payload, hc::DATA_BYTES, d));
        d.flags = hc::WirePartial | hc::WireClock;
        CHECK(hc::encode_data(d, physical::flash[heater].payload, hc::DATA_BYTES));
        physical::seal(physical::flash[heater]);
    }
    c.flags = hc::WirePartial | hc::WireClock;
    physical::commit(2, B, c);
    hc::Index recorded_clock;
    CHECK(scan(recorded_clock));
    auto r = replay(recorded_clock);
    CHECK(r.ready && !recorded_clock.clock_blocked && (r.flags & hc::Clock) &&
          r.heater[0].on_us == S && r.heater[1].on_us == 2 * S);
    // A completed, unsaturated, fully timed hour with no wire notice takes the quiet merge path.
    physical::reset();
    c = cohort(0, 1, 3, uint32_t(hc::HOUR_US), uint32_t(hc::HOUR_US), ID, B, uint32_t(hc::HOUR_US));
    for (unsigned heater = 0; heater < 2; ++heater) {
        hc::Data d;
        CHECK(hc::decode_data_into(physical::flash[heater].payload, hc::DATA_BYTES, d));
        d.flags = 0;
        CHECK(hc::encode_data(d, physical::flash[heater].payload, hc::DATA_BYTES));
        physical::seal(physical::flash[heater]);
    }
    c.flags = 0;
    physical::commit(2, B, c);
    hc::Index     complete_hour;
    const int64_t now = (B + 1) * hc::HOUR_US + S;
    CHECK(scan(complete_hour, now));
    r = replay(complete_hour, now);
    CHECK(r.ready && r.heater[0].on_us == uint64_t(hc::HOUR_US) && r.hours[1] == 1);
    // A boot partway into a journal hour preserves its sampled duration and partial offset.
    c.first = S;
    for (unsigned heater = 0; heater < 2; ++heater) {
        auto d  = sample(uint8_t(heater), 3, uint32_t(hc::HOUR_US - S), uint32_t(hc::HOUR_US));
        d.first = S;
        d.flags = 0;
        physical::data(uint16_t(heater), B, 1 + heater, d);
    }
    physical::commit(2, B, c);
    hc::Index partial_start;
    CHECK(scan(partial_start, now));
    r = replay(partial_start, now);
    CHECK(r.ready && (r.flags & hc::Partial) && r.heater[0].on_us == uint64_t(hc::HOUR_US - S));
    // Power loss after a whole Data fragment but before a descriptor leaves a known orphan.
    physical::reset();
    physical::data(0, B, 1, sample(0, 3));
    hc::Index data_only;
    CHECK(scan(data_only));
    r = replay(data_only);
    CHECK(r.ready && (r.flags & hc::Orphan) && (r.flags & hc::Loss) && totals_empty(r.heater[0]) &&
          totals_empty(r.heater[1]));
    // A stale adapter hint is insufficient: typed scan admission rechecks the actual CRC.
    physical::flash[0].payload[0] ^= 1;
    physical::lie = true;
    hc::Index stale_hint;
    CHECK(!scan(stale_hint));
    CHECK(!replay(stale_hint).ready);
    physical::lie = false;
    std::puts("CASE physical-vs-semantic/admission/replay-reference/clock-notice/full-hour PASS");
}

static void run() {
    malformed_native_and_codec_guards();
    scope_window_and_retirement_guards();
    physical_admission_and_replay_binding_guards();
    opaque_slot_controls();
    atomic_cases();
    crc_and_corruption();
    reference_and_consistency();
    epochs_time_and_fences();
    scan_pressure_and_damage();
    capabilities_loss_and_aliases();
    full_window_and_boundary_controls();
    CHECK(hc::DATA_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES && sizeof(hc::Index) <= 1024);
    CHECK(HISTORY_JOURNAL_SLOT_BYTES == 256 && HISTORY_FLASH_ERASE_BYTES == 4096);
    incomplete_replay_clock_regression();
    retry_highwater_clock_regression();
    final_publication_regression();
    for (unsigned kind = 0; kind < 6; ++kind) aggregate_validation_regression(kind);
    valid_aggregate_boundaries();
}
} // namespace heater_cohort_host_tests

static void test_heater_context_cohort() { heater_cohort_host_tests::run(); }
