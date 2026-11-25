#pragma once
// Independent heater-hour cohorts in the existing journal envelope. Required fragments are
// published together only after exact identity, revision, slot and CRC validation. The owner
// supplies exclusive scan/lifecycle control and separate unpublished scratch. Archive readiness
// is not live-source confirmation, physical heater evidence or a full-span absence verdict.
#include "checkup_persist.hpp"
#include "heater_context.hpp"
#include "history_persist.hpp"
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

namespace daik::logic::heater_cohort {
template <class T> inline void zero_object(T& object) noexcept {
    static_assert(std::is_trivially_copyable<T>::value && std::is_standard_layout<T>::value,
                  "only bounded plain staging objects may be cleared");
    static_assert(sizeof(T) <= 1024, "no unbounded clear or aggregate stack temporary");
    auto* bytes = reinterpret_cast<unsigned char*>(&object);
    for (size_t n = 0; n < sizeof(T); ++n) bytes[n] = 0;
}
namespace hd                 = heater_context;
constexpr size_t  DATA_BYTES = 192, COMMIT_BYTES = 64, FENCE_BYTES = 32, HOURS = 24, FENCES = 8;
constexpr uint8_t METHOD  = 2;
constexpr int64_t HOUR_US = 3600000000LL;
enum class Kind : uint8_t { Unknown, Data, Commit, Fence };
enum ReportFlag : uint16_t {
    Partial       = 1,
    Loss          = 2,
    Orphan        = 4,
    LatestFailure = 8,
    Clock         = 16,
    Incomplete    = 32,
    ScopeMismatch = 64,
    Future        = 128
};
enum WireFlag : uint16_t { WirePartial = 1, WireClock = 2, WireLoss = 4 };
constexpr uint16_t WIRE_FLAGS_MASK = WirePartial | WireClock | WireLoss;
static_assert(uint16_t(WireLoss) != uint16_t(Loss) && uint16_t(WireClock) != uint16_t(Clock),
              "wire/report domains differ");
struct Identity {
    uint32_t source = 0, model = 0, schema = 0, consent = 0, outdoor = 0;
};
inline bool equal(const Identity& a, const Identity& b) {
    return a.source == b.source && a.model == b.model && a.schema == b.schema &&
           a.consent == b.consent && a.outdoor == b.outdoor;
}
inline bool valid_identity(const Identity& i) {
    return i.source && i.model && i.schema && !i.outdoor;
}
struct Data {
    Identity         identity;
    uint32_t         first = 0, last = 0;
    hd::HourCounters counters;
    uint16_t         capabilities = 0, flags = 0; // flags are WireFlag bits, never ReportFlag bits
    uint8_t          heater = 0, required = 0;
    uint16_t         lost = 0;
};
struct Commit {
    uint64_t revision = 0, sequence[2]{};
    Identity identity;
    uint32_t first = 0, last = 0;
    uint16_t slot[2]{UINT16_MAX, UINT16_MAX};
    uint16_t capabilities = 0, flags = 0, lost = 0; // flags are WireFlag bits
    uint8_t  required = 0, reserved = 0;
};
struct Fence {
    uint64_t sequence = 0;
    Identity identity;
    uint8_t  reason = 0, pad[3]{};
};
static_assert(sizeof(Data) == 192 && sizeof(Commit) == 64 && sizeof(Fence) == 32,
              "bounded native staging");
inline unsigned pieces(uint8_t mask) { return unsigned(!!(mask & 1)) + unsigned(!!(mask & 2)); }
inline bool     valid_data(const Data& p) {
    const auto& c = p.counters;
    if (!valid_identity(p.identity) || p.heater >= 2 || !p.required || (p.required & ~3u) ||
        !(p.required & (1u << p.heater)) || (p.capabilities & ~hd::ALL) ||
        (p.flags & ~WIRE_FLAGS_MASK) || p.first > p.last || p.last > uint64_t(HOUR_US) ||
        (p.lost && ((p.flags & (WirePartial | WireLoss)) != (WirePartial | WireLoss))))
        return false;
    if (uint64_t(c.readable_us) + c.unreadable_us > uint64_t(p.last) - p.first ||
        uint64_t(c.on_us) + c.off_us + c.transition_us != c.readable_us ||
        uint64_t(c.union_us) + c.unclassified_us != c.on_us ||
        uint64_t(c.unknown_context_us) + c.complete_context_us != c.on_us ||
        c.overlap_us > c.union_us || c.readable_samples > c.samples ||
        c.on_samples > c.readable_samples || (p.capabilities != hd::ALL && c.complete_context_us))
        return false;
    uint64_t positive_sum = 0, evaluable_sum = 0, max_positive = 0, min_evaluable = c.on_us;
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        if (c.positive_us[k] > c.evaluable_on_us[k] || c.evaluable_on_us[k] > c.on_us ||
            c.positive_samples[k] > c.evaluable_on_samples[k] ||
            c.evaluable_on_samples[k] > c.on_samples ||
            (!(p.capabilities & (1u << k)) && (c.positive_us[k] || c.evaluable_on_us[k] ||
                                               c.positive_samples[k] || c.evaluable_on_samples[k])))
            return false;
        positive_sum += c.positive_us[k];
        evaluable_sum += c.evaluable_on_us[k];
        if (c.positive_us[k] > max_positive) max_positive = c.positive_us[k];
        if (c.evaluable_on_us[k] < min_evaluable) min_evaluable = c.evaluable_on_us[k];
    }
    if (max_positive > c.union_us || c.union_us > positive_sum) return false;
    const uint64_t excess = positive_sum - c.union_us;
    if (c.overlap_us > excess || excess > uint64_t(hd::CATEGORIES - 1) * c.overlap_us) return false;
    const uint64_t outside_complete = uint64_t(hd::CATEGORIES - 1) * c.on_us;
    const uint64_t minimum_complete =
        evaluable_sum > outside_complete ? evaluable_sum - outside_complete : 0;
    return c.complete_context_us >= minimum_complete && c.complete_context_us <= min_evaluable;
}
inline bool valid_commit(const Commit& c) {
    const unsigned count = pieces(c.required);
    if (!valid_identity(c.identity) || !count || (c.required & ~3u) || c.revision <= count ||
        c.reserved || c.first > c.last || c.last > uint64_t(HOUR_US) ||
        (c.capabilities & ~hd::ALL) || (c.flags & ~WIRE_FLAGS_MASK) ||
        (c.lost && ((c.flags & (WirePartial | WireLoss)) != (WirePartial | WireLoss))))
        return false;
    unsigned rank = 0;
    for (size_t h = 0; h < 2; ++h) {
        if (c.required & (1u << h)) {
            if (c.slot[h] >= HISTORY_JOURNAL_SLOT_COUNT ||
                c.sequence[h] != c.revision - count + rank++)
                return false;
        } else if (c.sequence[h] || c.slot[h] != UINT16_MAX)
            return false;
    }
    return count != 2 || c.slot[0] != c.slot[1];
}
inline bool descriptor(Commit& c, const Identity& id, uint8_t required, uint64_t first_sequence,
                       uint16_t buh_slot, uint16_t bsh_slot, uint32_t first, uint32_t last,
                       uint16_t capabilities, uint16_t flags = 0, uint16_t lost = 0) {
    const unsigned count = pieces(required);
    if (!count || !first_sequence || first_sequence > UINT64_MAX - count) return false;
    const Identity pinned = id;
    zero_object(c);
    c.slot[0] = c.slot[1] = UINT16_MAX;
    c.identity            = pinned;
    c.required            = required;
    c.revision            = first_sequence + count;
    c.first               = first;
    c.last                = last;
    c.capabilities        = capabilities;
    c.flags               = flags;
    c.lost                = lost;
    unsigned rank         = 0;
    for (size_t h = 0; h < 2; ++h)
        if (required & (1u << h)) {
            c.sequence[h] = first_sequence + rank++;
            c.slot[h]     = h ? bsh_slot : buh_slot;
        }
    return valid_commit(c);
}
struct Put {
    uint8_t* p;
    size_t   at = 0;
    void     value(uint64_t v, size_t n) {
        for (size_t i = 0; i < n; ++i) p[at++] = uint8_t(v >> (i * 8));
    }
};
struct Get {
    const uint8_t* p;
    size_t         at = 0;
    uint64_t       value(size_t n) {
        uint64_t v = 0;
        for (size_t i = 0; i < n; ++i) v |= uint64_t(p[at++]) << (i * 8);
        return v;
    }
};
inline void put_identity(Put& w, const Identity& i) {
    w.value(i.source, 4);
    w.value(i.model, 4);
    w.value(i.schema, 4);
    w.value(i.consent, 4);
    w.value(i.outdoor, 4);
}
inline void get_identity(Get& r, Identity& i) {
    i.source  = uint32_t(r.value(4));
    i.model   = uint32_t(r.value(4));
    i.schema  = uint32_t(r.value(4));
    i.consent = uint32_t(r.value(4));
    i.outdoor = uint32_t(r.value(4));
}
inline bool encode_data(const Data& d, uint8_t* out, size_t n) {
    if (!out || n != DATA_BYTES || !valid_data(d)) return false;
    Put w{out};
    w.value(METHOD, 1);
    w.value(d.heater, 1);
    w.value(d.flags, 2);
    put_identity(w, d.identity);
    w.value(d.first, 4);
    w.value(d.last, 4);
    w.value(d.capabilities, 2);
    w.value(d.required, 1);
    const auto& c = d.counters;
#define HC_P(field, n) w.value(c.field, n)
    HC_P(readable_us, 4);
    HC_P(on_us, 4);
    HC_P(off_us, 4);
    HC_P(transition_us, 4);
    HC_P(unreadable_us, 4);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        w.value(c.positive_us[k], 4);
        w.value(c.evaluable_on_us[k], 4);
    }
    HC_P(union_us, 4);
    HC_P(overlap_us, 4);
    HC_P(unknown_context_us, 4);
    HC_P(unclassified_us, 4);
    HC_P(complete_context_us, 4);
    HC_P(samples, 2);
    HC_P(readable_samples, 2);
    HC_P(on_samples, 2);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        w.value(c.positive_samples[k], 2);
        w.value(c.evaluable_on_samples[k], 2);
    }
    HC_P(saturated, 1);
#undef HC_P
    w.value(d.lost, 2);
    return w.at == DATA_BYTES;
}
// Output is caller-owned unpublished staging; failure never publishes a partial cohort.
inline bool decode_data_into(const uint8_t* b, size_t n, Data& d) {
    if (!b || n != DATA_BYTES || b[0] != METHOD) return false;
    zero_object(d);
    Get r{b};
    (void)r.value(1);
    d.heater = uint8_t(r.value(1));
    d.flags  = uint16_t(r.value(2));
    get_identity(r, d.identity);
    d.first        = uint32_t(r.value(4));
    d.last         = uint32_t(r.value(4));
    d.capabilities = uint16_t(r.value(2));
    d.required     = uint8_t(r.value(1));
    auto& c        = d.counters;
#define HC_G(field, type, n) c.field = type(r.value(n))
    HC_G(readable_us, uint32_t, 4);
    HC_G(on_us, uint32_t, 4);
    HC_G(off_us, uint32_t, 4);
    HC_G(transition_us, uint32_t, 4);
    HC_G(unreadable_us, uint32_t, 4);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        c.positive_us[k]     = uint32_t(r.value(4));
        c.evaluable_on_us[k] = uint32_t(r.value(4));
    }
    HC_G(union_us, uint32_t, 4);
    HC_G(overlap_us, uint32_t, 4);
    HC_G(unknown_context_us, uint32_t, 4);
    HC_G(unclassified_us, uint32_t, 4);
    HC_G(complete_context_us, uint32_t, 4);
    HC_G(samples, uint16_t, 2);
    HC_G(readable_samples, uint16_t, 2);
    HC_G(on_samples, uint16_t, 2);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        c.positive_samples[k]     = uint16_t(r.value(2));
        c.evaluable_on_samples[k] = uint16_t(r.value(2));
    }
#undef HC_G
    const auto saturated = r.value(1);
    if (saturated > 1) return false;
    c.saturated = saturated != 0;
    d.lost      = uint16_t(r.value(2));
    return r.at == DATA_BYTES && valid_data(d);
}
inline bool encode_commit(const Commit& c, uint8_t* out, size_t n) {
    if (!out || n != COMMIT_BYTES || !valid_commit(c)) return false;
    Put w{out};
    w.value(METHOD, 1);
    w.value(c.required, 1);
    w.value(c.flags, 2);
    put_identity(w, c.identity);
    w.value(c.revision, 8);
    w.value(c.first, 4);
    w.value(c.last, 4);
    w.value(c.capabilities, 2);
    w.value(c.lost, 2);
    for (auto seq : c.sequence) w.value(seq, 8);
    for (auto slot : c.slot) w.value(slot, 2);
    return w.at == COMMIT_BYTES;
}
inline bool decode_commit_into(const uint8_t* b, size_t n, Commit& c) {
    if (!b || n != COMMIT_BYTES || b[0] != METHOD) return false;
    zero_object(c);
    Get r{b};
    (void)r.value(1);
    c.required = uint8_t(r.value(1));
    c.flags    = uint16_t(r.value(2));
    get_identity(r, c.identity);
    c.revision     = r.value(8);
    c.first        = uint32_t(r.value(4));
    c.last         = uint32_t(r.value(4));
    c.capabilities = uint16_t(r.value(2));
    c.lost         = uint16_t(r.value(2));
    for (auto& seq : c.sequence) seq = r.value(8);
    for (auto& slot : c.slot) slot = uint16_t(r.value(2));
    return r.at == COMMIT_BYTES && valid_commit(c);
}
inline bool valid_fence(const Fence& f) {
    return valid_identity(f.identity) && f.sequence && (f.reason == 1 || f.reason == 2);
}
inline bool encode_fence(const Fence& f, uint8_t* out, size_t n) {
    if (!out || n != FENCE_BYTES || !valid_fence(f)) return false;
    Put w{out};
    w.value(METHOD, 1);
    w.value(f.reason, 1);
    w.value(0, 2);
    put_identity(w, f.identity);
    w.value(f.sequence, 8);
    return w.at == n;
}
inline bool decode_fence_into(const uint8_t* b, size_t n, Fence& f) {
    if (!b || n != FENCE_BYTES || b[0] != METHOD || b[2] || b[3]) return false;
    zero_object(f);
    Get r{b};
    (void)r.value(1);
    f.reason = uint8_t(r.value(1));
    (void)r.value(2);
    get_identity(r, f.identity);
    f.sequence = r.value(8);
    return valid_fence(f);
}
inline size_t wire_bytes(Kind k) {
    return k == Kind::Data     ? DATA_BYTES
           : k == Kind::Commit ? COMMIT_BYTES
           : k == Kind::Fence  ? FENCE_BYTES
                               : 0;
}
inline uint32_t fingerprint(Kind k) {
    uint32_t crc = checkup_fp_u32(CONFIG_CRC32_INIT, 0x48434F48u);
    for (uint32_t v :
         {uint32_t(METHOD), uint32_t(k), uint32_t(DATA_BYTES), uint32_t(COMMIT_BYTES),
          uint32_t(FENCE_BYTES), uint32_t(hd::CATEGORIES), uint32_t(hd::MAX_GAP_US),
          uint32_t(hd::RECOVERY_US), uint32_t(hd::NOTICE_US), uint32_t(hd::MILD_TENTHS)})
        crc = checkup_fp_u32(crc, v);
    const uint32_t fp = config_crc32_final(crc);
    return fp ? fp : 1;
}
inline Kind kind(const HistoryJournalHeader& h) {
    if (h.source != uint8_t(HistoryJournalSource::Checkup)) return Kind::Unknown;
    for (auto k : {Kind::Data, Kind::Commit, Kind::Fence})
        if (h.catalog_fp == fingerprint(k)) return k;
    return Kind::Unknown;
}
struct View {
    const HistoryJournalHeader* header   = nullptr;
    const uint8_t*              payload  = nullptr;
    size_t                      capacity = 0;
    bool                        physical = false;
};
inline bool slot_erased(const View& v) {
    if (!v.header || !v.payload || v.capacity < HISTORY_JOURNAL_PAYLOAD_BYTES) return false;
    const auto* header = reinterpret_cast<const uint8_t*>(v.header);
    for (size_t n = 0; n < sizeof(*v.header); ++n)
        if (header[n] != 0xff) return false;
    for (size_t n = 0; n < HISTORY_JOURNAL_PAYLOAD_BYTES; ++n)
        if (v.payload[n] != 0xff) return false;
    return true;
}
inline bool typed(const View& v, Kind k) {
    const size_t n = wire_bytes(k);
    return v.header && v.payload && n && v.capacity >= n && v.physical &&
           history_journal_header_matches(*v.header, fingerprint(k), uint16_t(n / 2), 3600) &&
           v.header->source == uint8_t(HistoryJournalSource::Checkup) &&
           v.header->crc == history_journal_crc_bytes(*v.header, v.payload, n);
}
inline bool in_window(int64_t bucket, int64_t now) {
    return now >= 0 && bucket >= 0 && bucket <= now / HOUR_US && bucket > now / HOUR_US - 24;
}
inline bool end_not_future(int64_t bucket, uint32_t offset, int64_t now) {
    return bucket >= 0 && now >= 0 && bucket <= INT64_MAX / HOUR_US &&
           offset <= uint64_t(HOUR_US) && int64_t(offset) <= INT64_MAX - bucket * HOUR_US &&
           bucket * HOUR_US + offset <= now;
}
struct HourEntry {
    int64_t  bucket          = -1;
    uint64_t commit_sequence = 0, newest_data_sequence = 0;
    uint16_t commit_slot = UINT16_MAX, flags = 0;
};
struct FenceEntry {
    uint32_t key[4]{};
    uint64_t sequence = 0;
};
struct Index {
    HourEntry  hours[HOURS];
    FenceEntry fences[FENCES];
    Identity   expected;
    uint16_t   expected_capabilities = 0;
    uint8_t    expected_required     = 0;
    // Exclusive owner: last_now is also the fixed scan timestamp until finish_scan.
    int64_t  last_now                  = -1;
    uint64_t highest_physical_sequence = 0, fence_floor = 0;
    uint32_t epoch = 0, next_slot = 0;
    uint8_t  fence_count = 0;
    bool     incomplete = false, complete = false, clock_blocked = false;
    uint16_t scan_flags = 0;
};
static_assert(sizeof(HourEntry) == 32 && sizeof(FenceEntry) == 24 && sizeof(Index) <= 1024,
              "fixed index ceiling");
struct Workspace {
    Data     data;
    Commit   commit;
    Fence    fence;
    hd::Hour cohort;
};
struct Report {
    hd::Totals heater[2];
    Identity   identity;
    uint64_t   newest_revision = 0;
    uint32_t   epoch           = 0;
    uint16_t   flags = 0, capabilities = 0, loss_notices = 0;
    uint8_t    hours[2]{}, required = 0;
    bool       ready = false;
};
static_assert(std::is_trivially_copyable<Index>::value &&
                  std::is_trivially_copyable<Workspace>::value &&
                  std::is_trivially_copyable<Report>::value,
              "caller-owned POD, no allocation");
inline uint64_t fence_sequence(const Index& i, const Identity& id) {
    for (size_t k = 0; k < i.fence_count; ++k) {
        const auto& f = i.fences[k];
        if (f.key[0] == id.source && f.key[1] == id.model && f.key[2] == id.schema &&
            f.key[3] == id.consent)
            return f.sequence;
    }
    return 0;
}
inline uint64_t maximum_sequence(const Index& i) { return i.highest_physical_sequence; }
inline bool     begin_scan(Index& i, const Identity& expected, uint32_t epoch, int64_t now,
                           uint16_t capabilities = hd::ALL, uint8_t required = 3) {
    const Identity pinned             = expected;
    const uint64_t physical_highwater = maximum_sequence(i);
    const bool     blocked = i.clock_blocked || (i.last_now >= 0 && now < i.last_now);
    const uint64_t floor   = i.clock_blocked ? i.fence_floor : maximum_sequence(i);
    zero_object(i);
    for (auto& h : i.hours) {
        h.bucket      = -1;
        h.commit_slot = UINT16_MAX;
    }
    i.expected              = pinned;
    i.expected_capabilities = capabilities;
    i.expected_required     = required;
    // A failed/partial retry cannot revoke knowledge of valid physical sequences already seen.
    i.highest_physical_sequence = physical_highwater;
    i.epoch                     = epoch;
    i.last_now                  = now;
    i.clock_blocked             = blocked;
    i.fence_floor               = blocked ? floor : 0;
    i.incomplete = !valid_identity(pinned) || now < 0 || !required || (required & ~3u) ||
                   (capabilities & ~hd::ALL);
    return !i.incomplete;
}
inline bool add_fence(Index& i, const Fence& f) {
    for (size_t k = 0; k < i.fence_count; ++k) {
        auto& e = i.fences[k];
        if (e.key[0] == f.identity.source && e.key[1] == f.identity.model &&
            e.key[2] == f.identity.schema && e.key[3] == f.identity.consent) {
            if (f.sequence > e.sequence) e.sequence = f.sequence;
            return true;
        }
    }
    if (i.fence_count == FENCES) {
        i.incomplete = true;
        return false;
    }
    auto& e    = i.fences[i.fence_count++];
    e.key[0]   = f.identity.source;
    e.key[1]   = f.identity.model;
    e.key[2]   = f.identity.schema;
    e.key[3]   = f.identity.consent;
    e.sequence = f.sequence;
    return true;
}
inline bool scan_slot(Index& i, uint16_t slot, const View& v, bool read_ok, Workspace& w) {
    if (i.complete || slot != i.next_slot || i.next_slot >= HISTORY_JOURNAL_SLOT_COUNT) {
        i.incomplete = true;
        return false;
    }
    ++i.next_slot;
    if (!read_ok || !v.header) {
        i.incomplete = true;
        return false;
    }
    const auto& h = *v.header;
    if (h.magic != HISTORY_JOURNAL_MAGIC || h.commit != HISTORY_JOURNAL_COMMITTED) {
        if (slot_erased(v)) return true;
        // Opaque bytes may be a torn retirement fence. Their former kind and scope
        // cannot be recovered safely, so retained pre-fence counts stay unavailable.
        i.scan_flags |= Partial | Loss;
        i.incomplete = true;
        return false;
    }
    if (!v.physical) {
        i.incomplete = true;
        return false;
    } // cannot trust a damaged record's former kind
    if (h.sequence > i.highest_physical_sequence) i.highest_physical_sequence = h.sequence;
    const auto k = kind(h);
    if (k == Kind::Unknown) return true;
    if (!typed(v, k)) {
        i.incomplete = true;
        return false;
    }
    if (k == Kind::Fence) {
        if (!decode_fence_into(v.payload, FENCE_BYTES, w.fence) || w.fence.sequence != h.sequence) {
            i.incomplete = true;
            return false;
        }
        return add_fence(i, w.fence); // never age or reread a recycled fence slot
    }
    Identity identity;
    if (k == Kind::Data) {
        if (!decode_data_into(v.payload, DATA_BYTES, w.data)) {
            i.incomplete = true;
            return false;
        }
        identity = w.data.identity;
    } else {
        if (!decode_commit_into(v.payload, COMMIT_BYTES, w.commit) ||
            w.commit.revision != h.sequence) {
            i.incomplete = true;
            return false;
        }
        identity = w.commit.identity;
    }
    if (!equal(identity, i.expected)) return true;
    if ((k == Kind::Data && (w.data.capabilities != i.expected_capabilities ||
                             w.data.required != i.expected_required)) ||
        (k == Kind::Commit && (w.commit.capabilities != i.expected_capabilities ||
                               w.commit.required != i.expected_required))) {
        i.incomplete = true;
        return false;
    }
    if (h.bucket > i.last_now / HOUR_US) {
        i.scan_flags |= Partial | Future;
        return true;
    }
    if (!in_window(h.bucket, i.last_now)) return true;
    auto& e = i.hours[size_t(h.bucket % 24)];
    if (e.bucket != h.bucket) {
        zero_object(e);
        e.bucket      = h.bucket;
        e.commit_slot = UINT16_MAX;
    }
    if (k == Kind::Data) {
        if (h.sequence > e.newest_data_sequence) e.newest_data_sequence = h.sequence;
    } else if (h.sequence > e.commit_sequence) {
        e.commit_sequence = h.sequence;
        e.commit_slot     = slot;
    } else if (h.sequence == e.commit_sequence && slot != e.commit_slot) {
        i.incomplete = true;
        return false;
    }
    return true;
}
inline bool finish_scan(Index& i) {
    if (i.next_slot != HISTORY_JOURNAL_SLOT_COUNT) {
        i.incomplete = true;
        return false;
    }
    i.complete = true;
    if (!i.incomplete && i.clock_blocked && fence_sequence(i, i.expected) > i.fence_floor)
        i.clock_blocked = false;
    return !i.incomplete && !i.clock_blocked;
}
inline bool observe_clock(Index& i, int64_t now) {
    if (now < 0 || (i.last_now >= 0 && now < i.last_now)) {
        if (!i.clock_blocked) i.fence_floor = maximum_sequence(i);
        i.clock_blocked = true;
    }
    if (!i.clock_blocked) i.last_now = now;
    return !i.clock_blocked;
}
inline uint16_t publication_rejection(const Index& i, const Identity& expected, uint32_t epoch,
                                      uint16_t capabilities, uint8_t required) {
    uint16_t flags = 0;
    if (epoch != i.epoch || !equal(i.expected, expected) ||
        capabilities != i.expected_capabilities || required != i.expected_required)
        flags |= ScopeMismatch;
    if (!i.complete || i.incomplete) flags |= Incomplete;
    if (i.clock_blocked) flags |= Clock;
    return flags;
}
template <class Reader>
inline bool replay(Index& i, Reader& read, int64_t now, const Identity& expected, uint32_t epoch,
                   Workspace& w, Report& out) {
    const Identity pinned = expected;
    zero_object(out);
    out.identity     = pinned;
    out.epoch        = epoch;
    out.flags        = Partial;
    out.capabilities = i.expected_capabilities;
    out.required     = i.expected_required;
    if (!equal(pinned, i.expected) || epoch != i.epoch) {
        out.flags |= ScopeMismatch;
        return false;
    }
    const bool clock_current = observe_clock(i, now);
    if (!clock_current) out.flags |= Clock | Loss;
    if (!i.complete || i.incomplete) {
        out.flags |= Incomplete | Loss;
        return false;
    }
    if (!clock_current) return false;
    out.flags |= i.scan_flags;
    const uint64_t fence = fence_sequence(i, pinned);
    for (const auto& e : i.hours) {
        if (!in_window(e.bucket, now)) continue;
        if (e.newest_data_sequence > fence && e.newest_data_sequence > e.commit_sequence)
            out.flags |= Partial | Loss | Orphan;
        if (!e.commit_sequence || e.commit_sequence <= fence) continue;
        View v;
        bool ok = read(e.commit_slot, v) && typed(v, Kind::Commit) &&
                  v.header->bucket == e.bucket && v.header->sequence == e.commit_sequence &&
                  decode_commit_into(v.payload, COMMIT_BYTES, w.commit);
        auto&      c      = w.commit;
        const bool future = ok && !end_not_future(e.bucket, c.last, now);
        if (ok)
            ok = c.revision == e.commit_sequence && equal(c.identity, pinned) &&
                 c.required == i.expected_required && c.capabilities == i.expected_capabilities &&
                 !future;
        uint16_t flags = 0;
        zero_object(w.cohort);
        if (ok)
            for (size_t h = 0; h < 2; ++h)
                if (c.required & (1u << h)) {
                    ok = c.sequence[h] > fence && read(c.slot[h], v) && typed(v, Kind::Data) &&
                         v.header->bucket == e.bucket && v.header->sequence == c.sequence[h] &&
                         decode_data_into(v.payload, DATA_BYTES, w.data);
                    const auto& d = w.data;
                    if (ok)
                        ok = d.heater == h && equal(d.identity, pinned) &&
                             d.required == c.required && d.capabilities == c.capabilities &&
                             d.first == c.first && d.last == c.last && d.lost == c.lost &&
                             end_not_future(e.bucket, d.last, now);
                    if (!ok) break;
                    flags |= d.flags;
                    w.cohort.heater[h] = d.counters;
                }
        if (ok) ok = flags == c.flags;
        if (!ok) {
            out.flags |= Partial | Loss | LatestFailure;
            if (future) out.flags |= Future;
            continue;
        }
        if (const auto rejected =
                publication_rejection(i, pinned, epoch, out.capabilities, out.required)) {
            zero_object(out);
            out.flags = Partial | Loss | rejected;
            return false;
        }
        for (size_t h = 0; h < 2; ++h)
            if (c.required & (1u << h)) {
                hd::merge(out.heater[h], w.cohort.heater[h]);
                ++out.hours[h];
                if (w.cohort.heater[h].saturated || c.first || c.last != uint64_t(HOUR_US) || flags)
                    out.flags |= Partial;
            }
        if (c.flags & WireClock) out.flags |= Clock;
        if (c.flags & WireLoss) out.flags |= Loss;
        if (c.lost > out.loss_notices) out.loss_notices = c.lost;
        if (c.revision > out.newest_revision) out.newest_revision = c.revision;
    }
    // Failed-read paths also reach this gate; readiness cannot rely on a successful cohort read.
    if (const auto rejected =
            publication_rejection(i, pinned, epoch, out.capabilities, out.required)) {
        zero_object(out);
        out.flags = Partial | Loss | rejected;
        return false;
    }
    // Readiness is only archive validation, never a full-span/absence verdict.
    out.ready = true;
    return true;
}
static_assert(DATA_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES &&
                  COMMIT_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES &&
                  HISTORY_JOURNAL_SLOT_BYTES == 256 && HISTORY_FLASH_ERASE_BYTES == 4096,
              "unchanged physical limits");
} // namespace daik::logic::heater_cohort
