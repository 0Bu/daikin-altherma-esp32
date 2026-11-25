#include "heater_context_store.hpp"
#include "logic/heater_context_payload.hpp"
#include "sntp_time.hpp"
#include "sdk.hpp"
#include <array>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>
using namespace daik;
using namespace daik::logic;
namespace wh        = heater_independent;
namespace hc        = heater_cohort;
namespace hd        = heater_context;
constexpr int64_t S = 1000000, H = 3600000000LL, ORIGIN = 472222LL * H;
static unsigned   checks = 0;
#define CHECK(x)                                                                                   \
    do {                                                                                           \
        ++checks;                                                                                  \
        if (!(x)) {                                                                                \
            std::fprintf(stderr, "FAIL %d: %s\n", __LINE__, #x);                                   \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (0)
struct Record {
    HistoryJournalHeader header;
    uint8_t              payload[192];
};
static_assert(sizeof(Record) == 256);
static std::array<Record, HISTORY_JOURNAL_SLOT_COUNT>   flash;
static std::array<bool, HISTORY_JOURNAL_SLOT_COUNT>     failures;
static std::array<unsigned, HISTORY_JOURNAL_SLOT_COUNT> visits;
alignas(Record) static uint8_t scratch[4096];
static uint64_t                sequence  = 1;
static uint16_t                cursor    = 0;
static int64_t                 read_cost = 0;
static HeaterContextFlashPiece piece;
static uint8_t                 wire[192];
bool                           daik::time_synced() { return sdk::synced; }
void                           daik::time_now(int64_t& seconds, int32_t& ms) {
    const auto n = sdk::origin_us + sdk::now_us;
    seconds      = n / S;
    ms           = int32_t(n % S / 1000);
}
static bool physical(const Record& r) {
    return history_journal_checkup_header_structural_matches(r.header, 3600) &&
           history_journal_payload_bytes(r.header) <= 192 &&
           r.header.crc == history_journal_crc_bytes(r.header, r.payload,
                                                     history_journal_payload_bytes(r.header));
}
static bool reader(uint16_t slot, wh::View& v) {
    CHECK(slot < flash.size());
    CHECK(!sdk::mutex || !sdk::mutex->owned);
    ++sdk::reads;
    ++visits[slot];
    sdk::now_us += read_cost;
    if (sdk::read_hook) {
        auto fn        = sdk::read_hook;
        sdk::read_hook = nullptr;
        fn();
    }
    if (failures[slot]) return false;
    auto* r = new (scratch) Record;
    std::memcpy(r, &flash[slot], sizeof(*r));
    v = {&r->header, r->payload, 192, physical(*r)};
    return true;
}
static void header(Record& r, wh::Kind kind, uint64_t seq, int64_t bucket, size_t n,
                   bool old = false) {
    std::memset(&r.header, 0xff, sizeof(r.header));
    auto& h       = r.header;
    h.magic       = HISTORY_JOURNAL_MAGIC;
    h.version     = HISTORY_JOURNAL_VERSION;
    h.source      = uint8_t(HistoryJournalSource::Checkup);
    h.flags       = 0;
    h.catalog_fp  = old ? hc::fingerprint(kind) : wh::fingerprint(kind);
    h.value_count = uint16_t(n / 2);
    h.slot_bytes  = 256;
    h.sequence    = seq;
    h.bucket      = bucket;
    h.dt_s        = 3600;
    h.rings[0]    = TREND_COUNT;
    h.rings[1]    = HOMEHUB_HISTORY_COUNT;
    h.rings[2]    = ENV3_HISTORY_COUNT;
    h.crc         = history_journal_crc_bytes(h, r.payload, n);
    h.commit      = HISTORY_JOURNAL_COMMITTED;
    CHECK(physical(r));
}
static wh::Data data(unsigned heater = 0, uint32_t first = 1 * S, uint32_t last = 11 * S) {
    wh::Data d;
    d.identity     = {11, 22, 33, 0, 0};
    d.first        = first;
    d.last         = last;
    d.required     = 3;
    d.heater       = uint8_t(heater);
    d.capabilities = hd::ALL;
    d.flags        = hc::WirePartial;
    auto& c        = d.counters;
    c.readable_us = c.on_us = c.union_us            = last - first;
    c.unknown_context_us                            = last - first;
    c.positive_us[size_t(hd::Category::Silent)]     = last - first;
    c.evaluable_on_us[size_t(hd::Category::Silent)] = last - first;
    c.samples = c.readable_samples = c.on_samples        = 2;
    c.positive_samples[size_t(hd::Category::Silent)]     = 2;
    c.evaluable_on_samples[size_t(hd::Category::Silent)] = 2;
    CHECK(wh::valid_data(d));
    return d;
}
static void put_data(uint16_t slot, uint64_t seq, const wh::Data& d, int64_t bucket = ORIGIN / H,
                     bool old = false) {
    auto& r = flash[slot];
    std::memset(&r, 0xff, sizeof(r));
    CHECK(old ? hc::encode_data(d, r.payload, 192) : wh::encode_data(d, r.payload, 192));
    header(r, wh::Kind::Data, seq, bucket, 192, old);
}
static void put_fence(uint16_t slot, uint64_t seq, bool old = false) {
    wh::Fence f;
    f.identity = {11, 22, 33, 0, 0};
    f.sequence = seq;
    f.reason   = 1;
    auto& r    = flash[slot];
    std::memset(&r, 0xff, sizeof(r));
    CHECK(old ? hc::encode_fence(f, r.payload, 32) : wh::encode_fence(f, r.payload, 32));
    header(r, wh::Kind::Fence, seq, ORIGIN / H, 32, old);
}
static hd::Sample sample(hd::Bit bit = hd::Bit::On) {
    hd::Sample s;
    s.heater[0] = s.heater[1] = bit;
    s.emergency = s.error = s.defrost = hd::Bit::Off;
    s.silent                          = hd::Bit::On;
    s.dhw                             = hd::Bit::Off;
    s.mode                            = CheckupOperatingMode::Heating;
    s.compressor_off                  = hd::Bit::Off;
    return s;
}
static void observe(int64_t at, hd::Bit bit = hd::Bit::On) {
    sdk::now_us = at;
    heater_context_record(at, sample(bit));
}
static HeaterContextHeaterReport report(uint8_t h = 0) {
    HeaterContextHeaterReport r;
    heater_context_report(h, r);
    return r;
}
static void bind(bool restore = true, uint32_t model = 22, uint32_t generation = 1,
                 uint8_t heaters = 3) {
    heater_context_bind(11, model, 33, generation, hd::ALL, heaters, restore);
}
static void reset() {
    std::memset(flash.data(), 0xff, sizeof(flash));
    failures.fill(false);
    visits.fill(0);
    sequence            = 1;
    cursor              = 0;
    read_cost           = 0;
    sdk::now_us         = 0;
    sdk::origin_us      = ORIGIN;
    sdk::synced         = true;
    sdk::busy           = false;
    sdk::reads          = 0;
    sdk::read_hook      = nullptr;
    sdk::on_wait        = nullptr;
    sdk::blocking_waits = 0;
    heater_context_start(true, 0);
    bind();
}
static void service() {
    for (unsigned i = 0; i < 150; ++i) {
        const auto n = sdk::reads;
        heater_context_flash_service(reader, 256);
        CHECK(sdk::reads - n <= 256);
        if (!heater_context_status().restore_pending || sdk::reads == n) return;
    }
    CHECK(false);
}
static bool next() {
    const auto reads = sdk::reads;
    const bool yes   = heater_context_flash_next(reader, sequence, piece, wire, 192);
    CHECK(reads == sdk::reads);
    return yes;
}
static void write(uint16_t slot, bool ack = true) {
    std::memset(&flash[slot], 0xff, sizeof(Record));
    std::memcpy(flash[slot].payload, wire, piece.bytes);
    header(flash[slot], piece.kind, piece.sequence, piece.bucket, piece.bytes);
    if (ack) {
        wh::View v;
        CHECK(reader(slot, v));
        heater_context_flash_appended(piece, slot, v);
    }
    ++sequence;
}
static unsigned drain(unsigned limit = 12) {
    unsigned n = 0;
    while (n < limit && next()) {
        write(cursor++);
        ++n;
    }
    return n;
}
static void boot_at(int64_t wall) {
    sdk::now_us    = 0;
    sdk::origin_us = wall;
    heater_context_start(true, 0);
    bind();
}
static void bootstrap() {
    reset();
    const auto reads = sdk::reads;
    heater_context_flash_service(reader, 0);
    CHECK(sdk::reads == reads);
    heater_context_flash_service(reader, 256);
    auto m = heater_context_status();
    CHECK(m.restore_pending && !(m.flags & (hc::Incomplete | hc::Clock)));
    observe(S, hd::Bit::Unknown);
    observe(11 * S);
    observe(21 * S);
    CHECK(report().counters.on_us == 10 * S);
    CHECK(report().counters.unreadable_us == 10 * S);
    service();
    CHECK(!report().restore_pending && report().counters.on_us == 10 * S);
    CHECK(!next());
    heater_context_seal();
    CHECK(drain() == 2);
    CHECK(report().counters.on_us == 10 * S);
    const auto n = sdk::reads;
    heater_context_flash_service(reader, 0);
    CHECK(sdk::reads == n);
}
static void once_merge() {
    reset();
    put_data(400, 1, data());
    put_data(401, 2, data(1));
    sequence    = 3;
    sdk::now_us = 20 * S;
    heater_context_flash_service(reader, 256);
    observe(21 * S);
    observe(31 * S);
    CHECK(report().counters.on_us == 10 * S);
    service();
    CHECK(report().counters.on_us == 20 * S && report(1).counters.on_us == 20 * S);
    CHECK(report().counters.samples == 4);
    service();
    CHECK(report().counters.on_us == 20 * S);
    heater_context_seal();
    CHECK(drain() == 2);
    CHECK(report().counters.on_us == 20 * S);
    heater_context_flash_index_invalidate();
    service();
    CHECK(report().counters.on_us == 20 * S && report().counters.samples == 4);
}
static void independent_reboot() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    observe(21 * S);
    heater_context_seal();
    CHECK(next() && piece.remaining == 1 && piece.kind == wh::Kind::Data);
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d) && d.heater == 0);
    write(0);
    CHECK(report().counters.on_us == 20 * S);
    boot_at(ORIGIN + 60 * S);
    CHECK(!report().counters.samples);
    service();
    CHECK(report().counters.on_us == 20 * S);
    CHECK(!report(1).counters.samples);
    CHECK(report().observed_hours == 1 && report(1).observed_hours == 0);
    CHECK(!report().restore_pending);
}
static void revisions() {
    reset();
    put_data(0, 1, data());
    put_data(1, 2, data(0, S, 21 * S));
    sequence    = 3;
    sdk::now_us = 60 * S;
    service();
    CHECK(report().counters.on_us == 20 * S);
    CHECK(report().counters.samples == 2);
    heater_context_flash_index_invalidate();
    service();
    CHECK(report().counters.on_us == 20 * S);
}
static void boundary_claim(bool deferred) {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    uint8_t saved[192];
    std::memcpy(saved, wire, 192);
    observe(H + 2 * S);
    CHECK(report().counters.on_us == 14 * S);
    if (deferred) {
        heater_context_flash_deferred(piece);
        CHECK(next());
        CHECK(!std::memcmp(saved, wire, 192));
    }
    write(0);
    CHECK(report().counters.on_us == 14 * S);
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d));
    CHECK(d.heater == 0 && d.counters.on_us == 12 * S);
    write(1);
    CHECK(report().counters.on_us == 14 * S);
}
static void pinned_reproof() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    auto    p = piece;
    uint8_t saved[192];
    std::memcpy(saved, wire, 192);
    heater_context_flash_deferred(piece);
    std::memset(&flash[16], 0xff, 16 * sizeof(Record));
    heater_context_flash_index_invalidate();
    CHECK(!next());
    const auto held_sequence = sequence;
    CHECK(heater_context_flash_claim_pending());
    CHECK(sequence == held_sequence); // the pinned source owns the next global sequence
    const auto before = sdk::reads;
    sdk::busy         = true;
    CHECK(heater_context_flash_claim_pending());
    sdk::busy = false;
    CHECK(sdk::reads == before);
    service();
    CHECK(!report().restore_pending);
    CHECK(next());
    CHECK(piece.sequence == p.sequence && piece.token == p.token && !std::memcmp(saved, wire, 192));
    write(0);
    CHECK(report().counters.on_us == 10 * S);
}
static void io_retry() {
    reset();
    failures[0] = true;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == 1);
    CHECK(report().flags & hc::Incomplete);
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == 1);
    sdk::now_us = 999999;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == 1);
    failures[0] = false;
    sdk::now_us = 1000001;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == 257);
    service();
    CHECK(!report().restore_pending);
}
static void slow_and_zero() {
    reset();
    read_cost = S;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == 1);
    const auto n = sdk::reads;
    for (unsigned i = 0; i < 10; ++i) heater_context_flash_service(reader, 0);
    CHECK(sdk::reads == n);
    read_cost = 0;
    service();
}
static void replay_retry() {
    reset();
    put_data(0, 1, data());
    put_data(1, 2, data(1));
    sequence    = 3;
    sdk::now_us = 60 * S;
    for (unsigned i = 0; i < 64; ++i) heater_context_flash_service(reader, 256);
    CHECK(report().restore_pending);
    heater_context_flash_service(reader, 1);
    CHECK(report().counters.on_us == 10 * S && !report(1).counters.samples);
    failures[1] = true;
    heater_context_flash_service(reader, 1);
    CHECK(report().flags & hc::Incomplete);
    CHECK(report().counters.on_us == 10 * S);
    failures[1] = false;
    sdk::now_us += 1000001;
    service();
    CHECK(report().counters.on_us == 10 * S && report(1).counters.on_us == 10 * S);
    CHECK(!report().restore_pending);
}
static void overlap() {
    reset();
    put_data(0, 1, data());
    sequence    = 2;
    sdk::now_us = 10 * S;
    observe(11 * S);
    observe(21 * S);
    service();
    CHECK(report().counters.on_us == 10 * S && report().counters.samples == 2);
    CHECK(report().restore_pending && report().flags & hc::Incomplete);
    heater_context_seal();
    CHECK(next());
    wh::Data independent;
    CHECK(wh::decode_data_into(wire, 192, independent) && independent.heater == 1);
    write(4);
    CHECK(!next()); // the unresolved BUH basis cannot be overwritten with its fresh subset
}
static void live_authority() {
    reset();
    put_data(0, 1, data());
    sequence    = 2;
    sdk::now_us = 60 * S;
    service();
    CHECK(report().counters.on_us == 10 * S);
    observe(61 * S);
    observe(71 * S);
    CHECK(report().counters.on_us == 20 * S);
    flash[0].payload[60] ^= 1;
    heater_context_flash_index_invalidate();
    service();
    CHECK(report().counters.on_us == 20 * S);
    CHECK(report().flags & hc::Incomplete);
    heater_context_seal();
    CHECK(!next());
    flash[0].payload[60] ^= 1;
    heater_context_flash_index_invalidate();
    service();
    CHECK(report().counters.on_us == 20 * S);
    heater_context_reset();
    bind(false);
    CHECK(!report().counters.on_us);
}
static void scope_and_stale() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    auto old = piece;
    heater_context_set_diagnostics(false, 1);
    bind();
    write(0);
    CHECK(!report().confirmed && !report().counters.on_us);
    wh::View v;
    CHECK(reader(0, v));
    heater_context_flash_appended(old, 0, v);
    CHECK(!report().confirmed);
    heater_context_set_diagnostics(true, 1);
    bind(false);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(1);
    CHECK(!report().counters.samples);
}
static void clock_floor(bool future) {
    reset();
    put_data(0, 102, data(), ORIGIN / H + (future ? 1 : 0));
    put_fence(1, 50);
    sequence    = 103;
    sdk::now_us = 60 * S;
    if (future) {
        service();
        CHECK(report().flags & hc::Clock);
    } else {
        service();
        CHECK(report().counters.on_us == 10 * S);
        heater_context_flash_index_invalidate();
        failures[0] = true;
        heater_context_flash_service(reader, 256);
        sdk::origin_us -= 2 * H;
        heater_context_expire();
        CHECK(report().flags & hc::Clock);
        failures[0] = false;
    }
    CHECK(!report().counters.on_us);
    sequence = 51;
    CHECK(!next());
    sequence = 103;
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(2);
    service();
    CHECK(!report().counters.on_us);
    sdk::now_us += 2 * H;
    service();
    CHECK(!report().counters.on_us);
}
static HeaterContextErasePermission permission(uint16_t first) {
    for (unsigned i = 0; i < 100; ++i) {
        const auto n = sdk::reads;
        auto       p = heater_context_flash_erase_permission(reader, first);
        CHECK(sdk::reads - n <= 256);
        if (p != HeaterContextErasePermission::Pending) return p;
    }
    CHECK(false);
    return HeaterContextErasePermission::Pending;
}
static void keeper() {
    reset();
    for (unsigned i = 0; i < 16; ++i) put_fence(uint16_t(i), 300 + i);
    sdk::now_us = 60 * S;
    service();
    const auto n = sdk::reads;
    CHECK(permission(0) == HeaterContextErasePermission::Allowed);
    CHECK(sdk::reads - n == 16384);
    put_data(32, 2, data());
    heater_context_flash_index_invalidate();
    CHECK(permission(0) == HeaterContextErasePermission::Protected);
    std::memset(&flash[32], 0xff, sizeof(Record));
    flash[48].payload[0] = 0;
    heater_context_flash_index_invalidate();
    CHECK(permission(0) == HeaterContextErasePermission::Protected);
    CHECK(permission(48) == HeaterContextErasePermission::Protected);
}
static void opaque_old() {
    reset();
    put_data(0, 1, data(), ORIGIN / H, true);
    sequence    = 2;
    sdk::now_us = 60 * S;
    service();
    CHECK(report().restore_pending && report().flags & hc::Incomplete);
    CHECK(!report().counters.on_us);
    reset();
    put_fence(0, 10, true);
    CHECK(permission(0) == HeaterContextErasePermission::Protected);
    reset();
    put_fence(0, 10);
    put_data(16, 5, data());
    flash[0].header.magic ^= 1;
    sdk::now_us = 60 * S;
    service();
    CHECK(!report().counters.on_us && report().flags & hc::Incomplete);
    CHECK(permission(0) == HeaterContextErasePermission::Protected);
}
static void aging_unknown_payload() {
    reset();
    service();
    observe(S, hd::Bit::Unknown);
    observe(11 * S, hd::Bit::Unknown);
    CHECK(report().counters.unreadable_us == 10 * S && !report().counters.readable_us);
    HeaterContextPayloadFields f;
    heater_context_payload(f);
    std::string json;
    append_heater_context_json(json, f);
    CHECK(json.find("\"on_s\":null") != std::string::npos);
    sdk::now_us += 24 * H;
    heater_context_expire();
    CHECK(!report().counters.samples);
    CHECK(report().dropped && report().flags & hc::Loss);
    reset();
    bind(true, 22, 1, 1);
    service();
    observe(S);
    observe(11 * S);
    CHECK(report().counters.on_us == 10 * S && !report(1).counters.samples);
    heater_context_seal();
    CHECK(drain() == 1);
}
static void codec() {
    auto    d = data();
    uint8_t b[192];
    CHECK(wh::encode_data(d, b, 192));
    wh::Data decoded;
    CHECK(wh::decode_data_into(b, 192, decoded));
    CHECK(!hc::decode_data_into(b, 192, decoded));
    CHECK(wh::fingerprint(wh::Kind::Data) != hc::fingerprint(hc::Kind::Data));
    b[0] = 2;
    CHECK(!wh::decode_data_into(b, 192, decoded));
    d.counters.overlap_us = d.counters.on_us;
    CHECK(!wh::valid_data(d));
    CHECK(!wh::encode_data(d, b, 192));
    d                  = data();
    d.counters.samples = d.counters.readable_samples = d.counters.on_samples = UINT16_MAX;
    CHECK(wh::encode_data(d, b, 192));
}
static void incomplete_global() {
    reset();
    put_data(0, 1, data());
    sequence    = 2;
    sdk::now_us = H + 30 * S;
    observe(H + S);
    observe(H + 11 * S);
    sdk::now_us = H + 30 * S;
    heater_context_flash_service(reader, 1);
    CHECK(report().counters.on_us == 10 * S && report().restore_pending);
    heater_context_seal();
    CHECK(!next());
    flash.back().payload[3] = 0;
    service();
    CHECK(report().flags & hc::Incomplete);
    CHECK(report().counters.on_us == 10 * S);
    CHECK(!next());
}
static void bad_latest() {
    reset();
    put_data(0, 1, data());
    put_data(1, 2, data(0, S, 21 * S));
    sequence                  = 3;
    const uint32_t impossible = 20 * S;
    for (unsigned i = 0; i < 4; ++i) flash[1].payload[131 + i] = uint8_t(impossible >> (i * 8));
    flash[1].header.crc = history_journal_crc_bytes(flash[1].header, flash[1].payload, 192);
    CHECK(physical(flash[1]));
    sdk::now_us = H;
    service();
    CHECK(!report().counters.on_us && report().flags & hc::Incomplete);
    CHECK(!next());
    CHECK(permission(0) == HeaterContextErasePermission::Protected);
}
static void keeper_append_cache() {
    reset();
    put_data(32, 1, data());
    sequence    = 2;
    sdk::now_us = 60 * S;
    service();
    bind(true, 23, 2); // the old-scope retirement is independent of the new scope's complete proof
    service();
    CHECK(!report().restore_pending);
    CHECK(permission(0) == HeaterContextErasePermission::Allowed);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(0);
    const auto n = sdk::reads;
    CHECK(permission(0) == HeaterContextErasePermission::Protected);
    CHECK(sdk::reads > n);
}
static void keeper_slices() {
    reset();
    for (unsigned i = 0; i < 16; ++i) put_fence(uint16_t(i), 300 + i);
    sdk::now_us = 60 * S;
    service();
    read_cost = S;
    auto n    = sdk::reads;
    CHECK(heater_context_flash_erase_permission(reader, 0) ==
          HeaterContextErasePermission::Pending);
    CHECK(sdk::reads - n == 1);
    n = sdk::reads;
    heater_context_flash_service(reader, 0);
    CHECK(sdk::reads == n);
    read_cost = 0;
    heater_context_reset();
    bind(false);
    n = visits[0];
    CHECK(heater_context_flash_erase_permission(reader, 0) ==
          HeaterContextErasePermission::Pending);
    CHECK(visits[0] > n);
    const auto old = visits[0];
    heater_context_flash_index_invalidate();
    CHECK(heater_context_flash_erase_permission(reader, 0) ==
          HeaterContextErasePermission::Pending);
    CHECK(visits[0] > old);
}
static void reset_callback() {
    heater_context_reset();
    bind(false);
}
static void epoch_scan() {
    reset();
    put_data(0, 1, data());
    sequence       = 2;
    sdk::now_us    = 60 * S;
    sdk::read_hook = reset_callback;
    const auto n   = sdk::reads;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads - n == 1);
    CHECK(!report().counters.samples);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(32);
    service();
    CHECK(!report().counters.samples);
}
static void epoch_replay() {
    reset();
    put_data(0, 1, data());
    sequence    = 2;
    sdk::now_us = 60 * S;
    for (unsigned i = 0; i < 64; ++i) heater_context_flash_service(reader, 256);
    sdk::read_hook = reset_callback;
    heater_context_flash_service(reader, 1);
    CHECK(!report().counters.samples);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(32);
    service();
    CHECK(!report().counters.samples);
}
static void observe_callback() { observe(40 * S); }
static void live_replay_callback() {
    reset();
    put_data(0, 1, data());
    sequence = 2;
    observe(21 * S);
    observe(31 * S);
    for (unsigned i = 0; i < 64; ++i) heater_context_flash_service(reader, 256);
    sdk::read_hook = observe_callback;
    heater_context_flash_service(reader, 1);
    service();
    CHECK(report().counters.on_us == 29 * S && report().counters.samples == 5);
}
static void no_reindex_ack() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    heater_context_seal();
    CHECK(drain() == 2);
    const auto n = sdk::reads;
    for (unsigned i = 0; i < 5; ++i) heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == n && report().counters.on_us == 10 * S && !report().restore_pending);
}
static void read_fence_gap() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    sdk::now_us = 40 * S;
    CHECK(report().counters.samples == 2);
    heater_context_record(21 * S, sample());
    CHECK(report().counters.samples == 2);
    observe(41 * S);
    observe(51 * S);
    CHECK(report().counters.samples == 4 && report().counters.on_us == 20 * S);
}
static void scope_bounds() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    bind(true, 23, 2);
    CHECK(!report().counters.samples);
    heater_context_set_diagnostics(false, 1);
    CHECK(!report().confirmed);
    heater_context_set_diagnostics(true, 2);
    bind(false, 23, 3, 0);
    CHECK(!report().counters.samples && !report().restore_pending);
    CHECK(report().supported_heaters == 0);
}
static void saturation() {
    reset();
    auto d             = data();
    d.counters.samples = d.counters.readable_samples = d.counters.on_samples = UINT16_MAX;
    put_data(0, 1, d);
    sequence = 2;
    observe(21 * S);
    observe(31 * S);
    service();
    CHECK(report().counters.samples == UINT16_MAX && report().counters.saturated);
    CHECK(report().counters.on_us == 20 * S);
    heater_context_seal();
    CHECK(next());
    wh::Data full;
    CHECK(wh::decode_data_into(wire, 192, full));
    CHECK(full.counters.saturated);
}
static void sequence_limit() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    heater_context_seal();
    sequence = 0;
    CHECK(!next());
    sequence = UINT64_MAX;
    CHECK(!next());
    sequence = UINT64_MAX - 1;
    CHECK(next());
    write(0);
    CHECK(sequence == UINT64_MAX && !next());
}
static void receipts_exact() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    heater_context_seal();
    CHECK(next());
    const auto saved = piece;
    write(0, false);
    ++flash[0].header.bucket;
    flash[0].header.crc = history_journal_crc_bytes(flash[0].header, flash[0].payload, 192);
    wh::View v;
    CHECK(reader(0, v));
    heater_context_flash_appended(saved, 0, v);
    CHECK(report().persistence_pending && report().flags & hc::Incomplete);
    --flash[0].header.bucket;
    flash[0].header.crc = history_journal_crc_bytes(flash[0].header, flash[0].payload, 192);
    CHECK(reader(0, v));
    heater_context_flash_appended(saved, 0, v);
    const auto on = report().counters.on_us;
    heater_context_flash_appended(saved, 0, v);
    CHECK(report().counters.on_us == on);
    CHECK(!heater_context_flash_claim_pending());
    heater_context_flash_index_invalidate();
    service();
    CHECK(report().counters.on_us == 10 * S);
}
static void pending_epoch_pin() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    const auto original_sequence = sequence;
    heater_context_flash_deferred(piece);
    heater_context_flash_index_invalidate();
    CHECK(!next());
    CHECK(heater_context_flash_claim_pending());
    heater_context_reset();
    bind(false);
    const auto n = sdk::reads;
    heater_context_flash_service(reader, 0);
    CHECK(sdk::reads == n && !heater_context_flash_claim_pending());
    CHECK(sequence == original_sequence);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(0);
    service();
    CHECK(!report().counters.samples);
}
static void clock_new_scope() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    sdk::origin_us -= 2 * H;
    heater_context_expire();
    CHECK(report().flags & hc::Clock);
    bind(false, 23, 2);
    CHECK(!report().counters.samples);
    CHECK(drain() == 2);
    service();
    CHECK(!(report().flags & hc::Clock));
    observe(21 * S);
    observe(31 * S);
    CHECK(report().counters.on_us == 10 * S);
}
static void retired_catalog() {
    reset();
    for (unsigned i = 0; i < 9; ++i) {
        wh::Fence f;
        f.identity = {11, 22 + i, 33, 0, 0};
        f.sequence = i + 1;
        f.reason   = 1;
        CHECK(wh::encode_fence(f, flash[i].payload, 32));
        header(flash[i], wh::Kind::Fence, i + 1, ORIGIN / H, 32);
    }
    sdk::now_us = 60 * S;
    service();
    CHECK(report().flags & hc::Incomplete);
    CHECK(permission(0) == HeaterContextErasePermission::Allowed);
    std::memset(&flash[0], 0xff, 16 * sizeof(Record));
    wh::Fence next_fence;
    next_fence.identity = {11, 77, 33, 0, 0};
    next_fence.sequence = 10;
    next_fence.reason   = 1;
    CHECK(wh::encode_fence(next_fence, flash[16].payload, 32));
    header(flash[16], wh::Kind::Fence, 10, ORIGIN / H, 32);
    heater_context_flash_index_invalidate();
    service();
    CHECK(!report().restore_pending && !(report().flags & hc::Incomplete));
}
static void shutdown_budget() {
    reset();
    service();
    for (unsigned hour = 0; hour < 24; ++hour) {
        observe(int64_t(hour) * H + S);
        observe(int64_t(hour) * H + 11 * S);
    }
    CHECK(report().counters.on_us == 240 * S && report().observed_hours == 24);
    heater_context_seal();
    const auto n = sdk::reads;
    CHECK(drain(12) == 12);
    CHECK(sdk::reads - n == 12);
    CHECK(report().persistence_pending && report().counters.on_us == 240 * S);
}
static void rollback_only_callback() { sdk::origin_us -= 2 * H; }
static void rollback_replay_callback() {
    reset();
    put_data(0, 102, data());
    put_fence(1, 50);
    sequence    = 103;
    sdk::now_us = 60 * S;
    for (unsigned i = 0; i < 64; ++i) heater_context_flash_service(reader, 256);
    sdk::read_hook = rollback_only_callback;
    heater_context_flash_service(reader, 1);
    sdk::origin_us += 2 * H;
    CHECK(!report().counters.on_us && report().flags & hc::Clock);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(32);
    service();
    CHECK(!report().counters.on_us);
}
static void failed_full_record() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    heater_context_seal();
    CHECK(next());
    write(0, false);
    heater_context_flash_failed(piece);
    CHECK(!heater_context_flash_claim_pending());
    CHECK(report().counters.on_us == 10 * S && report().dropped);
    service();
    CHECK(report().counters.on_us == 10 * S);
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d) && d.heater == 0 && d.counters.on_us == 10 * S);
    write(1);
    CHECK(next());
    write(2);
    boot_at(ORIGIN + 60 * S);
    service();
    CHECK(report().counters.on_us == 10 * S && report(1).counters.on_us == 10 * S);
}
static void notice_ack() {
    reset();
    service();
    auto value               = sample();
    value.outdoor_known      = true;
    value.outdoor_source     = OutdoorSource::X10a;
    value.outdoor_generation = 1;
    value.outdoor_tenths     = 50;
    for (unsigned n = 0; n <= 90; ++n) {
        sdk::now_us = (1 + 10 * int64_t(n)) * S;
        heater_context_record(sdk::now_us, value);
    }
    heater_context_seal();
    CHECK(report().counters.on_us == 900 * S);
    CHECK(next());
    write(0);
    CHECK(report().counters.on_us == 900 * S && report(1).counters.on_us == 900 * S);
    CHECK(next());
    write(1);
    const auto reads = sdk::reads;
    heater_context_flash_service(reader, 0);
    CHECK(reads == sdk::reads);
    HeaterContextPayloadFields fields;
    heater_context_payload(fields);
    CHECK(fields.heater[0].quiet_mild_notice && fields.heater[1].quiet_mild_notice);
}
static void release_wait() { sdk::busy = false; }
static void forced_wait() {
    sdk::busy    = true;
    sdk::on_wait = release_wait;
}
static void release_if_callback_dropped() {
    // Permit observation after the other task eventually releases its lock. A zero-wait
    // callback must still fail the semantic oracle; checking only the wait count is weaker.
    if (sdk::busy) {
        sdk::busy    = false;
        sdk::on_wait = nullptr;
    }
}
static void busy_ack() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    forced_wait();
    write(0);
    release_if_callback_dropped();
    CHECK(!heater_context_flash_claim_pending());
    CHECK(report().counters.on_us == 10 * S);
    CHECK(sdk::blocking_waits == 1);
    CHECK(next());
}
static void busy_defer() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    uint8_t saved[192];
    std::memcpy(saved, wire, 192);
    forced_wait();
    heater_context_flash_deferred(piece);
    release_if_callback_dropped();
    CHECK(next());
    CHECK(!std::memcmp(saved, wire, 192));
    CHECK(sdk::blocking_waits == 1);
}
static void busy_failed() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    forced_wait();
    heater_context_flash_failed(piece);
    release_if_callback_dropped();
    CHECK(!heater_context_flash_claim_pending());
    CHECK(report().dropped && report().restore_pending);
    CHECK(sdk::blocking_waits == 1);
}
static void busy_invalidate() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    heater_context_flash_deferred(piece);
    std::memset(&flash[16], 0xff, 16 * sizeof(Record));
    forced_wait();
    heater_context_flash_index_invalidate();
    release_if_callback_dropped();
    CHECK(!next() && heater_context_flash_claim_pending());
    CHECK(sdk::blocking_waits == 1);
    service();
    CHECK(next());
}
static void reset_while_waiting() {
    sdk::busy = false;
    heater_context_reset();
    bind(false);
}
static void epoch_wait() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    sdk::busy    = true;
    sdk::on_wait = reset_while_waiting;
    write(0);
    CHECK(sdk::blocking_waits == 1);
    CHECK(!heater_context_flash_claim_pending() && !report().counters.samples);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(1);
    service();
    CHECK(!report().counters.samples);
}
static void wide_window() {
    reset();
    uint64_t seq  = 1;
    uint16_t slot = 0;
    for (unsigned hour = 0; hour < 24; ++hour)
        for (unsigned heater = 0; heater < 2; ++heater) {
            const auto last = uint32_t(hour == 23 ? H - S : H);
            auto       d    = data(heater, 0, last);
            put_data(slot++, seq++, d, ORIGIN / H + hour);
        }
    sequence    = seq;
    sdk::now_us = 24 * H - S;
    service();
    CHECK(report().counters.on_us == uint64_t(24 * H - S) &&
          report(1).counters.on_us == uint64_t(24 * H - S));
    CHECK(report().observed_hours == 24 && report().counters.on_us > UINT32_MAX);
    sdk::now_us += S;
    heater_context_expire();
    CHECK(report().counters.on_us == uint64_t(23 * H - S) && report().observed_hours == 23);
}
static void partial_capabilities() {
    reset();
    const uint16_t caps = hd::ALL & ~hd::mask(hd::Category::Emergency);
    heater_context_bind(11, 22, 33, 1, caps, 3, true);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(0);
    service();
    observe(S);
    observe(11 * S);
    CHECK(report().counters.complete_context_us == 0 &&
          report().counters.unknown_context_us == 10 * S);
    CHECK(!report().counters.evaluable_on_us[0]);
    heater_context_seal();
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d) && d.capabilities == caps &&
          !d.counters.positive_us[0]);
    HeaterContextPayloadFields fields;
    heater_context_payload(fields);
    std::string json;
    append_heater_context_json(json, fields);
    CHECK(json.find("\"emergency\":{\"supported\":false,\"positive_s\":null") != std::string::npos);
}
static void final_scan_deadline() {
    reset();
    put_data(0, 1, data());
    sequence    = 2;
    sdk::now_us = 60 * S;
    for (unsigned i = 0; i < 63; ++i) heater_context_flash_service(reader, 256);
    heater_context_flash_service(reader, 255);
    CHECK(sdk::reads == 16383);
    const auto before = sdk::reads;
    read_cost         = S;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads - before == 1 && report().restore_pending);
    const auto noio = sdk::reads;
    heater_context_flash_service(reader, 0);
    CHECK(sdk::reads == noio);
    read_cost = 0;
    heater_context_flash_service(reader, 1);
    CHECK(sdk::reads == noio + 1 && report().counters.on_us == 10 * S);
}
static void dropped_finish() {
    reset();
    CHECK(heater_context_flash_scan_begin());
    for (uint16_t slot = 0; slot < HISTORY_JOURNAL_SLOT_COUNT; ++slot) {
        wh::View v;
        CHECK(reader(slot, v));
        heater_context_flash_scan_slot(slot, v, true);
    }
    sdk::busy = true;
    heater_context_flash_scan_finish();
    sdk::busy = false;
    CHECK(report().restore_pending);
    const auto before = sdk::reads;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == before && !report().restore_pending);
}
static void erased_sector(uint16_t first) { heater_context_flash_sector_erased(first); }
static void clock_anchor_jitter() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    sdk::origin_us -= 500000;
    observe(21 * S);
    observe(31 * S);
    sdk::now_us = 32 * S;
    CHECK(report().counters.on_us == 30 * S);
    heater_context_seal();
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d));
    CHECK(d.last - d.first == 30 * S && d.counters.readable_us == 30 * S);
}
static unsigned rotation_write(unsigned count) {
    unsigned distinct = 0;
    bool     seen[2][24]{};
    for (unsigned i = 0; i < count; ++i) {
        CHECK(next());
        if (cursor % 16 == 0) {
            CHECK(permission(cursor) == HeaterContextErasePermission::Allowed);
            std::memset(&flash[cursor], 0xff, 16 * sizeof(Record));
            erased_sector(cursor);
            heater_context_flash_deferred(piece);
            service();
            CHECK(next());
        }
        wh::Data d;
        CHECK(wh::decode_data_into(wire, 192, d));
        const auto hour = unsigned(piece.bucket - ORIGIN / H);
        CHECK(hour < 24);
        if (!seen[d.heater][hour]) {
            seen[d.heater][hour] = true;
            ++distinct;
        }
        write(cursor++);
    }
    return distinct;
}
static void erase_rotation_progress() {
    reset();
    service();
    for (unsigned h = 0; h < 20; ++h) {
        observe(int64_t(h) * H + S);
        observe(int64_t(h) * H + 11 * S);
    }
    sdk::now_us = 20 * H;
    CHECK(rotation_write(40) == 40);
    CHECK(!next());
    CHECK(report().counters.on_us == 200 * S);
    CHECK(permission(0) == HeaterContextErasePermission::Allowed);
    std::memset(&flash[0], 0xff, 16 * sizeof(Record));
    erased_sector(0);
    service();
    cursor = 48;
    CHECK(rotation_write(16) == 16);
    CHECK(!next());
    CHECK(report().counters.on_us == 200 * S);
    boot_at(ORIGIN + 20 * H + 60 * S);
    service();
    CHECK(report().counters.on_us == 200 * S && report(1).counters.on_us == 200 * S);
}
static void ghost_prefence() {
    reset();
    put_data(0, 1, data());
    put_fence(1, 2);
    sequence    = 3;
    sdk::now_us = H;
    service();
    CHECK(report().observed_hours == 0);
    heater_context_flash_index_invalidate();
    service();
    CHECK(!next());
    CHECK(report().observed_hours == 0);
}
static void clock_anchor_limits() {
    reset();
    service();
    observe(S);
    observe(11 * S);
    sdk::origin_us += 1900000;
    observe(21 * S);
    sdk::origin_us += 100000;
    observe(31 * S);
    CHECK(report().counters.on_us == 30 * S && !(report().flags & hc::Clock));
    sdk::origin_us += 100000;
    observe(41 * S);
    CHECK(!report().counters.on_us && report().flags & hc::Clock);
    CHECK(next() && piece.kind == wh::Kind::Fence);
    write(0);
    service();
    observe(51 * S);
    observe(61 * S);
    CHECK(report().counters.on_us == 10 * S);
}
static void clock_hour_jitter() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::origin_us -= 500000;
    observe(H + 2 * S);
    sdk::now_us = H + 3 * S;
    CHECK(report().counters.on_us == 14 * S);
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d));
    CHECK(d.counters.on_us == 12 * S && d.last == uint64_t(H) && d.last - d.first == 12 * S);
}
static void reference_reconcile() {
    reset();
    put_data(0, 1, data());
    sequence    = 2;
    sdk::now_us = H;
    service();
    CHECK(!next());
    heater_context_flash_index_invalidate();
    CHECK(report().restore_pending);
    service();
    CHECK(!next());
    std::memset(&flash[16], 0xff, 16 * sizeof(Record));
    erased_sector(16);
    service();
    CHECK(!next());
    auto changed             = data();
    changed.counters.samples = changed.counters.readable_samples = 3;
    put_data(0, 1, changed);
    heater_context_flash_index_invalidate();
    CHECK(report().counters.samples == 2 && report().restore_pending);
    service();
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d) && d.counters.samples == 2);
    write(32);
    CHECK(!next());
    changed = data(0, S, 21 * S);
    put_data(33, 3, changed);
    sequence = 4;
    heater_context_flash_index_invalidate();
    service();
    CHECK(report().counters.on_us == 10 * S);
    CHECK(next());
    CHECK(wh::decode_data_into(wire, 192, d) && d.counters.on_us == 10 * S);
    write(34);
    CHECK(!next());
    boot_at(ORIGIN + H + 60 * S);
    service();
    CHECK(report().counters.on_us == 10 * S && report().counters.samples == 2);
}
static void reference_metadata_ack() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    heater_context_flash_failed(piece);
    service();
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d) && d.lost == 1 && (d.flags & hc::WireLoss));
    write(0);
    CHECK(next());
    write(1);
    heater_context_flash_index_invalidate();
    service();
    CHECK(!next());
    CHECK(report().dropped == 1 && report().counters.on_us == 10 * S);
}
static void invalid_sector_range() {
    reset();
    service();
    observe(H - 12 * S);
    observe(H - 2 * S);
    sdk::now_us = H;
    CHECK(next());
    heater_context_flash_deferred(piece);
    erased_sector(UINT16_MAX);
    CHECK(!next() && heater_context_flash_claim_pending() && report().restore_pending);
    service();
    CHECK(next());
    heater_context_flash_deferred(piece);
    erased_sector(1);
    CHECK(!next() && report().restore_pending);
    service();
    CHECK(next());
}
static void ghost_empty_payload() {
    reset();
    put_data(0, 1, data());
    auto empty = data();
    wh::zero_object(empty.counters);
    empty.first = empty.last = 0;
    put_data(1, 2, empty);
    sequence    = 3;
    sdk::now_us = H;
    service();
    CHECK(!report().counters.samples && report().observed_hours == 0);
    heater_context_flash_index_invalidate();
    service();
    heater_context_seal();
    CHECK(!next());
    boot_at(ORIGIN + H + 60 * S);
    service();
    CHECK(!report().counters.samples && report().observed_hours == 0);
}
static void prefence_with_fresh() {
    reset();
    put_data(0, 1, data());
    put_fence(1, 2);
    sequence = 3;
    observe(21 * S);
    observe(31 * S);
    service();
    CHECK(report().counters.on_us == 10 * S && report().counters.samples == 2 &&
          report().observed_hours == 1);
    heater_context_seal();
    CHECK(next());
    wh::Data d;
    CHECK(wh::decode_data_into(wire, 192, d) && d.first == 21 * S && d.last == 31 * S);
}
static void prestart_guards() {
    CHECK(!sdk::mutex);
    sdk::now_us       = S;
    const auto before = heater_context_status();
    CHECK(!before.confirmed && !before.dated && before.restore_pending &&
          !before.supported_heaters && !before.on_us[0] && !before.on_us[1]);
    heater_context_record(S, sample());
    heater_context_expire();
    heater_context_flash_service(reader, 256);
    CHECK(!next() && sdk::reads == 0 && !sdk::mutex);
    HeaterContextPayloadFields payload;
    heater_context_payload(payload);
    CHECK(!heater_context_status().confirmed && sdk::reads == 0);
    reset();
    service();
    observe(S);
    observe(11 * S);
    heater_context_seal();
    CHECK(drain() == 2 && report().counters.on_us == 10 * S);
}
static void unsynced_recovery() {
    reset();
    sdk::synced = false;
    observe(S);
    observe(11 * S);
    const auto reads = sdk::reads;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == reads && !next());
    auto m = report();
    CHECK(m.confirmed && !m.dated && (m.flags & hc::Clock) && !m.counters.samples &&
          !m.counters.on_us && !m.observed_hours);
    sdk::synced = true;
    service();
    observe(21 * S);
    observe(31 * S);
    CHECK(report().dated && report().counters.on_us == 10 * S);
    sdk::synced = false;
    observe(42 * S);
    observe(52 * S);
    CHECK(!report().dated && !report().counters.on_us && !next());
    const auto lost_reads = sdk::reads;
    heater_context_flash_service(reader, 256);
    CHECK(sdk::reads == lost_reads);
    sdk::synced = true;
    CHECK(report().dated && report().counters.on_us == 10 * S);
    observe(62 * S);
    observe(72 * S);
    sdk::now_us = 73 * S;
    heater_context_seal();
    CHECK(drain() == 2 && report().counters.on_us == 20 * S);
    boot_at(ORIGIN + 74 * S);
    service();
    CHECK(report().counters.on_us == 20 * S && report(1).counters.on_us == 20 * S);
}
static void conflicting_highest_sequence() {
    reset();
    auto first = data(), conflicting = data(0, S, 21 * S);
    put_data(0, 5, first);
    put_data(1, 5, conflicting);
    sequence    = 6;
    sdk::now_us = H;
    service();
    auto m = report();
    CHECK(m.restore_pending && (m.flags & hc::Incomplete) && (m.flags & hc::Loss) &&
          !m.counters.on_us && !m.observed_hours);
    sdk::now_us += HEATER_CONTEXT_FLASH_RETRY_US + 1;
    service();
    CHECK(report().restore_pending && !report().counters.on_us && !next());
    observe(H + 2 * S);
    observe(H + 12 * S);
    CHECK(report().counters.on_us == 10 * S && report().restore_pending);
    heater_context_seal();
    CHECK(!next()); // fresh live evidence cannot bypass the global damaged archive proof
    std::memset(&flash[1], 0xff, sizeof(Record));
    heater_context_flash_index_invalidate();
    service();
    CHECK(!report().restore_pending && report().counters.on_us == 20 * S);
}
static void codec_body_parity() {
    auto    d = data();
    uint8_t previous[192], current[192];
    CHECK(hc::encode_data(d, previous, 192) && wh::encode_data(d, current, 192));
    CHECK(previous[0] == 2 && current[0] == 3 && !std::memcmp(previous + 1, current + 1, 191));
    for (size_t byte = 1; byte < 192; ++byte)
        for (unsigned bit = 0; bit < 8; ++bit) {
            const auto saved = current[byte];
            current[byte] ^= uint8_t(1u << bit);
            std::memcpy(previous, current, 192);
            previous[0] = 2;
            wh::Data   a, b;
            const bool old = hc::decode_data_into(previous, 192, a),
                       now = wh::decode_data_into(current, 192, b);
            CHECK(old == now);
            if (now) {
                uint8_t canonical_old[192], canonical_now[192];
                CHECK(hc::encode_data(a, canonical_old, 192) &&
                      wh::encode_data(b, canonical_now, 192));
                CHECK(!std::memcmp(canonical_old + 1, canonical_now + 1, 191));
            }
            current[byte] = saved;
        }
    wh::Fence fence;
    fence.identity = d.identity;
    fence.sequence = UINT64_MAX - 1;
    fence.reason   = 2;
    uint8_t old_fence[32], new_fence[32];
    CHECK(hc::encode_fence(fence, old_fence, 32) && wh::encode_fence(fence, new_fence, 32));
    CHECK(!std::memcmp(old_fence + 1, new_fence + 1, 31));
    for (size_t byte = 1; byte < 32; ++byte)
        for (unsigned bit = 0; bit < 8; ++bit) {
            const auto saved = new_fence[byte];
            new_fence[byte] ^= uint8_t(1u << bit);
            std::memcpy(old_fence, new_fence, 32);
            old_fence[0] = 2;
            wh::Fence  a, b;
            const bool old = hc::decode_fence_into(old_fence, 32, a),
                       now = wh::decode_fence_into(new_fence, 32, b);
            CHECK(old == now);
            if (now) {
                uint8_t canonical_old[32], canonical_now[32];
                CHECK(hc::encode_fence(a, canonical_old, 32) &&
                      wh::encode_fence(b, canonical_now, 32));
                CHECK(!std::memcmp(canonical_old + 1, canonical_now + 1, 31));
            }
            new_fence[byte] = saved;
        }
    CHECK(wh::fingerprint(wh::Kind::Data) != hc::fingerprint(hc::Kind::Data) &&
          wh::fingerprint(wh::Kind::Fence) != hc::fingerprint(hc::Kind::Fence));
}
int main(int argc, char** argv) {
    CHECK(argc == 2);
    const std::string name = argv[1];
    if (name == "sanitizer_tripwire") {
        volatile int maximum = INT_MAX;
        maximum              = maximum + 1;
        return maximum == 0;
    }
    if (name == "prestart_guards")
        prestart_guards();
    else if (name == "unsynced_recovery")
        unsynced_recovery();
    else if (name == "conflicting_highest_sequence")
        conflicting_highest_sequence();
    else if (name == "codec_body_parity")
        codec_body_parity();
    else if (name == "bootstrap")
        bootstrap();
    else if (name == "once_merge")
        once_merge();
    else if (name == "independent_reboot")
        independent_reboot();
    else if (name == "revisions")
        revisions();
    else if (name == "ack_race")
        boundary_claim(false);
    else if (name == "deferral")
        boundary_claim(true);
    else if (name == "pinned_reproof")
        pinned_reproof();
    else if (name == "io_retry")
        io_retry();
    else if (name == "slow_zero")
        slow_and_zero();
    else if (name == "replay_retry")
        replay_retry();
    else if (name == "overlap")
        overlap();
    else if (name == "live_authority")
        live_authority();
    else if (name == "scope_stale")
        scope_and_stale();
    else if (name == "clock_floor")
        clock_floor(false);
    else if (name == "future_floor")
        clock_floor(true);
    else if (name == "keeper")
        keeper();
    else if (name == "opaque_old")
        opaque_old();
    else if (name == "aging_payload")
        aging_unknown_payload();
    else if (name == "codec")
        codec();
    else if (name == "incomplete_global")
        incomplete_global();
    else if (name == "bad_latest")
        bad_latest();
    else if (name == "keeper_append_cache")
        keeper_append_cache();
    else if (name == "keeper_slices")
        keeper_slices();
    else if (name == "epoch_scan")
        epoch_scan();
    else if (name == "epoch_replay")
        epoch_replay();
    else if (name == "live_replay_callback")
        live_replay_callback();
    else if (name == "no_reindex_ack")
        no_reindex_ack();
    else if (name == "read_fence_gap")
        read_fence_gap();
    else if (name == "scope_bounds")
        scope_bounds();
    else if (name == "saturation")
        saturation();
    else if (name == "sequence_limit")
        sequence_limit();
    else if (name == "receipts_exact")
        receipts_exact();
    else if (name == "pending_epoch_pin")
        pending_epoch_pin();
    else if (name == "clock_new_scope")
        clock_new_scope();
    else if (name == "retired_catalog")
        retired_catalog();
    else if (name == "shutdown_budget")
        shutdown_budget();
    else if (name == "rollback_replay_callback")
        rollback_replay_callback();
    else if (name == "failed_full_record")
        failed_full_record();
    else if (name == "notice_ack")
        notice_ack();
    else if (name == "callback_busy_ack")
        busy_ack();
    else if (name == "callback_busy_defer")
        busy_defer();
    else if (name == "callback_busy_failed")
        busy_failed();
    else if (name == "callback_busy_invalidate")
        busy_invalidate();
    else if (name == "callback_epoch_wait")
        epoch_wait();
    else if (name == "wide_window")
        wide_window();
    else if (name == "partial_capabilities")
        partial_capabilities();
    else if (name == "final_scan_deadline")
        final_scan_deadline();
    else if (name == "dropped_finish")
        dropped_finish();
    else if (name == "clock_anchor_jitter")
        clock_anchor_jitter();
    else if (name == "erase_rotation_progress")
        erase_rotation_progress();
    else if (name == "ghost_prefence")
        ghost_prefence();
    else if (name == "clock_anchor_limits")
        clock_anchor_limits();
    else if (name == "clock_hour_jitter")
        clock_hour_jitter();
    else if (name == "reference_reconcile")
        reference_reconcile();
    else if (name == "reference_metadata_ack")
        reference_metadata_ack();
    else if (name == "invalid_sector_range")
        invalid_sector_range();
    else if (name == "ghost_empty_payload")
        ghost_empty_payload();
    else if (name == "prefence_with_fresh")
        prefence_with_fresh();
    else {
        std::fprintf(stderr, "FAIL unknown_case\n");
        return 1;
    }
    CHECK(!sdk::mutex || !sdk::mutex->owned);
    std::printf("PASS %s %u checks static-owner-sum=%zu (host ABI; excludes "
                "inter-symbol padding)\n",
                argv[1], checks, heater_context_private_static_bytes());
}
