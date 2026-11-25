// Independent atomic per-heater hourly persistence; scope fences and physical
// readback bind each complete revision.
#include "heater_context_store.hpp"
#include "esp_timer.h"
#include "logic/heater_context_hourly.hpp"
#include "logic/heater_context_payload.hpp"
#include "rtos_guard.hpp"
#include "sntp_time.hpp"
#include <climits>
#include <cstring>

namespace daik {
namespace {
namespace wh = logic::heater_independent;
namespace hc = logic::heater_cohort;
namespace hd = logic::heater_context;
namespace hh = logic::heater_context_hourly;
enum CellState : uint8_t {
    Occupied      = 1,
    Live          = 2,
    Dirty         = 4,
    BaseKnown     = 8,
    BasePresent   = 16,
    Refused       = 32,
    DurableSeen   = 64,
    RefSuperseded = 128
};
struct Cell {
    hd::HourCounters counters;
    uint32_t         first = 0, last = 0, mutation = 0;
    uint64_t         revision = 0;
    int64_t          bucket   = 0;
    uint16_t         slot = 0, flags = 0, lost = 0;
    uint8_t          state = 0, pad = 0;
};
static_assert(sizeof(Cell) == 192, "48 complete hourly cells, including all metadata");
bool has_evidence(const hd::HourCounters& c) {
    return c.samples || c.readable_us || c.unreadable_us;
}
bool equal_counters(const hd::HourCounters& a, const hd::HourCounters& b) {
#define HEATER_EQUAL(field)                                                                        \
    if (a.field != b.field) return false
    HEATER_EQUAL(readable_us);
    HEATER_EQUAL(on_us);
    HEATER_EQUAL(off_us);
    HEATER_EQUAL(transition_us);
    HEATER_EQUAL(unreadable_us);
    HEATER_EQUAL(union_us);
    HEATER_EQUAL(overlap_us);
    HEATER_EQUAL(unknown_context_us);
    HEATER_EQUAL(unclassified_us);
    HEATER_EQUAL(complete_context_us);
    HEATER_EQUAL(samples);
    HEATER_EQUAL(readable_samples);
    HEATER_EQUAL(on_samples);
    HEATER_EQUAL(saturated);
#undef HEATER_EQUAL
    for (size_t k = 0; k < hd::CATEGORIES; ++k)
        if (a.positive_us[k] != b.positive_us[k] || a.evaluable_on_us[k] != b.evaluable_on_us[k] ||
            a.positive_samples[k] != b.positive_samples[k] ||
            a.evaluable_on_samples[k] != b.evaluable_on_samples[k])
            return false;
    return true;
}
bool clean_reference_matches(const Cell& c, const wh::Data& d) {
    return c.first == d.first && c.last == d.last && c.flags == d.flags && c.lost == d.lost &&
           equal_counters(c.counters, d.counters);
}
struct Retirement {
    wh::Identity identity;
    uint32_t     token  = 0;
    uint8_t      reason = 0;
};
struct KnownFence {
    wh::Identity identity;
    uint64_t     sequence = 0;
};
struct Scan {
    uint64_t mutation = 0, future = 0;
    int64_t  wall   = 0;
    uint32_t epoch  = 0;
    uint16_t next   = 0;
    uint8_t  replay = 0;
    bool     active = false, reading = false;
};
struct Erase {
    uint64_t                     mutation = 0, cutoff = 0;
    uint32_t                     epoch = 0;
    uint16_t                     first = 0, next = 0;
    uint8_t                      phase  = 0;
    HeaterContextErasePermission result = HeaterContextErasePermission::Pending;
};
StaticSemaphore_t       s_mutex_storage;
SemaphoreHandle_t       s_mutex = nullptr;
Cell                    s_cells[2][24];
Retirement              s_retire[8];
KnownFence              s_fences[8];
wh::Identity            s_identity;
hd::State               s_reducer{{}, {}, 0, 0, 0};
hd::Hour                s_delta;
hd::Hour                s_split_delta;
hh::Split               s_split{{{0}, {0}}};
hd::Totals              s_projection[2];
wh::Data                s_write, s_read;
wh::Fence               s_write_fence, s_read_fence;
uint8_t                 s_wire[192];
HeaterContextFlashPiece s_piece{0};
Scan                    s_scan;
Erase                   s_erase;
uint64_t                s_highest = 0, s_floor = 0, s_physical = 0, s_current_fence = 0;
uint32_t                s_epoch = 0, s_generation = 0, s_token = 0, s_claim_mutation = 0;
uint16_t                s_caps = 0, s_dropped = 0, s_flags = 0;
uint8_t                 s_heaters = 0, s_claim_heater = 0;
bool s_enabled = false, s_confirmed = false, s_sealed = false, s_clock_bad = false, s_hard = false;
bool s_proof = false, s_claim = false, s_outstanding = false, s_deferred = false;
int64_t s_offset = 0, s_last_mono = 0, s_last_wall = 0, s_sample = -1, s_read_limit = -1,
        s_retry = 0;
bool s_anchored = false;

struct Slice {
    size_t  left;
    int64_t start;
    explicit Slice(size_t n) : left(n < 256 ? n : 256), start(esp_timer_get_time()) {}
    bool take() {
        const auto now = esp_timer_get_time();
        if (!left || now < 0 || start < 0 || now < start || now - start >= 5000) return false;
        --left;
        return true;
    }
};
int64_t heater_wall_now() {
    if (!time_synced()) return -1;
    int64_t sec = -1;
    int32_t ms  = 0;
    time_now(sec, ms);
    return sec < 0 || sec > (INT64_MAX - 999999) / 1000000 || ms < 0 || ms > 999
               ? -1
               : sec * 1000000 + ms * 1000;
}
void loss() {
    if (s_dropped < UINT16_MAX) ++s_dropped;
    s_flags |= hc::Loss;
}
uint32_t token() {
    if (s_token == UINT32_MAX) {
        s_hard = true;
        return 0;
    }
    return ++s_token;
}
void invalidate() {
    s_proof = false;
    if (s_physical == UINT64_MAX)
        s_hard = true;
    else
        ++s_physical;
}
void known_append() {
    // An exact append cannot damage selected old slots, but any cached erase permission
    // must observe newly written target fences. Preserve an already finished scope proof.
    if (s_physical == UINT64_MAX) {
        s_hard = true;
        return;
    }
    ++s_physical;
    if (s_proof && s_scan.active && s_scan.reading && s_scan.epoch == s_epoch)
        s_scan.mutation = s_physical;
    s_erase.phase = 0;
}
void clear_cells() {
    for (auto& heater : s_cells)
        for (auto& cell : heater) wh::zero_object(cell);
    wh::zero_object(s_reducer);
    hd::pause(s_reducer);
    s_sample = -1;
    s_sealed = false;
    s_proof  = false;
    s_flags  = 0;
    if (s_epoch == UINT32_MAX)
        s_hard = true;
    else
        ++s_epoch;
}
void retire(const wh::Identity& id, uint8_t reason) {
    if (!wh::valid_identity(id)) return;
    for (auto& r : s_retire)
        if (r.token && wh::equal(r.identity, id)) {
            if (reason > r.reason) {
                r.reason = reason;
                r.token  = token();
            }
            return;
        }
    for (auto& r : s_retire)
        if (!r.token) {
            r.identity = id;
            r.reason   = reason;
            r.token    = token();
            return;
        }
    s_hard = true;
    loss();
}
bool pending_fence(const wh::Identity& id) {
    for (const auto& r : s_retire)
        if (r.token && wh::equal(r.identity, id)) return true;
    return false;
}
uint64_t fence_for(const wh::Identity& id) {
    for (const auto& f : s_fences)
        if (f.sequence && wh::equal(f.identity, id)) return f.sequence;
    return 0;
}
bool add_fence(const wh::Fence& value) {
    for (auto& f : s_fences)
        if (f.sequence && wh::equal(f.identity, value.identity)) {
            if (value.sequence > f.sequence) f.sequence = value.sequence;
            return true;
        }
    for (auto& f : s_fences)
        if (!f.sequence) {
            f.identity = value.identity;
            f.sequence = value.sequence;
            return true;
        }
    return false;
}
void clock_failure(int64_t now) {
    if (s_highest > s_floor) s_floor = s_highest;
    retire(s_identity, 2);
    clear_cells();
    s_clock_bad = true;
    s_anchored  = false;
    s_flags |= hc::Clock | hc::Loss;
    if (now > s_read_limit) s_read_limit = now;
}
bool clock_ok(int64_t now, int64_t wall) {
    if (s_clock_bad) return false;
    if (now < 0 || (s_anchored && (now < s_last_mono || (wall >= 0 && wall < s_last_wall)))) {
        clock_failure(now);
        return false;
    }
    if (wall < now) {
        hd::pause(s_reducer);
        return false;
    }
    const auto offset = wall - now;
    if (s_anchored && (offset > s_offset ? offset - s_offset : s_offset - offset) > 2000000) {
        clock_failure(now);
        return false;
    }
    if (!s_anchored)
        s_offset =
            offset; // one monotonic->wall anchor; accepted jitter never redates a saved interval
    s_anchored  = true;
    s_last_mono = now;
    s_last_wall = wall;
    return true;
}
void expire_locked(int64_t now, int64_t wall) {
    if (now > s_read_limit) s_read_limit = now;
    if (s_sample >= 0 && now > s_sample && now - s_sample > hd::MAX_GAP_US) hd::pause(s_reducer);
    if (!clock_ok(now, wall)) return;
    for (auto& heater : s_cells)
        for (auto& c : heater)
            if ((c.state & Occupied) && !wh::in_window(c.bucket, wall)) {
                if (c.state & Dirty) loss();
                wh::zero_object(c);
            }
}
bool current_scan() {
    return s_scan.active && s_scan.epoch == s_epoch && s_scan.mutation == s_physical && s_enabled &&
           s_confirmed;
}
void scan_error(bool io, uint16_t extra = 0) {
    s_scan.active = false;
    invalidate();
    s_flags |= hc::Incomplete | hc::Loss | extra;
    const auto now = esp_timer_get_time();
    if (io)
        s_retry = now < 0 || now > INT64_MAX - 1000000 ? INT64_MAX : now + 1000000;
    else
        s_retry = INT64_MAX; // semantic/opaque refusal needs an explicit physical
                             // invalidation
}
bool any_pending() {
    if (s_claim) return true;
    for (const auto& r : s_retire)
        if (r.token) return true;
    for (const auto& heater : s_cells)
        for (const auto& c : heater)
            if (c.state & Dirty) return true;
    return false;
}
bool restore_pending() {
    if (!s_enabled || !s_confirmed || !s_heaters) return false;
    if (!s_proof) return true;
    for (const auto& heater : s_cells)
        for (const auto& c : heater)
            if ((c.state & Occupied) && (!(c.state & BaseKnown) || (c.state & Refused)))
                return true;
    return false;
}
HeaterContextStatus project_locked() {
    HeaterContextStatus m;
    wh::zero_object(s_projection);
    const auto now = esp_timer_get_time(), wall = heater_wall_now();
    expire_locked(now, wall);
    m.epoch               = s_epoch;
    m.capabilities        = s_caps;
    m.supported_heaters   = s_heaters;
    m.dropped             = s_dropped;
    m.confirmed           = s_enabled && s_confirmed;
    m.dated               = m.confirmed && clock_ok(now, wall);
    m.restore_pending     = restore_pending();
    m.persistence_pending = any_pending();
    m.flags |= s_flags;
    if (m.dropped) m.flags |= hc::Loss;
    if (s_clock_bad || !m.dated) m.flags |= hc::Clock;
    if (s_hard) m.flags |= hc::Incomplete | hc::Loss;
    if (!m.confirmed || !m.dated) return m;
    for (size_t h = 0; h < 2; ++h)
        if (s_heaters & (1u << h))
            for (const auto& c : s_cells[h])
                if ((c.state & (Live | BasePresent)) && has_evidence(c.counters) &&
                    wh::in_window(c.bucket, wall) && wh::end_not_future(c.bucket, c.last, wall)) {
                    hd::merge(s_projection[h], c.counters);
                    ++m.observed_hours[h];
                    if (c.flags & hc::WireClock) m.flags |= hc::Clock;
                    if (c.flags & hc::WireLoss) m.flags |= hc::Loss;
                    if (c.lost > m.dropped) m.dropped = c.lost;
                }
    for (size_t h = 0; h < 2; ++h) {
        m.on_us[h]       = s_projection[h].on_us;
        m.readable_us[h] = s_projection[h].readable_us;
    }
    return m;
}
bool piece_same(const HeaterContextFlashPiece& p) {
    return s_claim && p.bucket == s_piece.bucket && p.sequence == s_piece.sequence &&
           p.token == s_piece.token && p.epoch == s_piece.epoch && p.kind == s_piece.kind &&
           p.bytes == s_piece.bytes && p.ordinal == 0 && p.remaining == 1;
}
bool claim_current() {
    if (!s_claim) return false;
    if (s_piece.kind == wh::Kind::Fence) {
        for (const auto& r : s_retire)
            if (r.token == s_piece.token && wh::equal(r.identity, s_write_fence.identity))
                return true;
        return false;
    }
    return s_piece.epoch == s_epoch && s_enabled && s_confirmed && !s_clock_bad && !s_hard &&
           wh::equal(s_write.identity, s_identity) && s_write.capabilities == s_caps &&
           s_write.required == s_heaters;
}
bool ordinary_physical(const wh::View& v) {
    return v.header && v.payload && v.capacity >= logic::HISTORY_JOURNAL_PAYLOAD_BYTES &&
           v.physical && v.header->magic == logic::HISTORY_JOURNAL_MAGIC &&
           v.header->commit == logic::HISTORY_JOURNAL_COMMITTED;
}
void settle_claim_locked() {
    if (s_claim && !claim_current()) s_claim = s_outstanding = s_deferred = false;
}
void select_slot(uint16_t slot, const wh::View& v) {
    if (wh::slot_erased(v)) return;
    if (!ordinary_physical(v)) {
        scan_error(false);
        return;
    }
    const auto& head = *v.header;
    if (head.sequence > s_highest) s_highest = head.sequence;
    if (hc::kind(head) != wh::Kind::Unknown) {
        scan_error(false, hc::ScopeMismatch);
        return;
    }
    const auto kind = wh::kind(head);
    if (kind == wh::Kind::Unknown) return;
    if (!wh::typed(v, kind)) {
        scan_error(false);
        return;
    }
    if (kind == wh::Kind::Fence) {
        if (!wh::decode_fence_into(v.payload, 32, s_read_fence) ||
            s_read_fence.sequence != head.sequence || !add_fence(s_read_fence)) {
            scan_error(false);
            return;
        }
        return;
    }
    if (!wh::decode_data_into(v.payload, 192, s_read)) {
        scan_error(false);
        return;
    }
    if (!wh::equal(s_read.identity, s_identity)) return;
    if (s_read.capabilities != s_caps || s_read.required != s_heaters) {
        scan_error(false, hc::ScopeMismatch);
        return;
    }
    if (!wh::end_not_future(head.bucket, s_read.last, s_scan.wall)) {
        if (head.bucket >= s_scan.wall / wh::HOUR_US - 23 && head.sequence > s_scan.future)
            s_scan.future = head.sequence;
        return;
    }
    if (!wh::in_window(head.bucket, s_scan.wall)) return;
    auto& c = s_cells[s_read.heater][size_t(head.bucket % 24)];
    if (c.state & BaseKnown) {
        if (c.bucket != head.bucket) return;
        if (c.revision && head.sequence > c.revision) c.state |= RefSuperseded;
        if (c.revision == head.sequence && c.slot == slot &&
            ((c.state & Dirty) || clean_reference_matches(c, s_read)))
            c.state |= DurableSeen;
        return; // authoritative materialized RAM is never an additive base again
    }
    if (!(c.state & Occupied) || c.bucket != head.bucket) {
        wh::zero_object(c);
        c.bucket = head.bucket;
        c.state  = Occupied;
    }
    if (head.sequence == c.revision && slot != c.slot) {
        scan_error(false);
        return;
    }
    if (head.sequence > c.revision) {
        c.revision = head.sequence;
        c.slot     = slot;
    }
}
void finish_scan_locked() {
    if (!current_scan()) return;
    const auto now = esp_timer_get_time(), wall = heater_wall_now();
    if (!clock_ok(now, wall) || wall < s_scan.wall ||
        wall / wh::HOUR_US != s_scan.wall / wh::HOUR_US) {
        s_scan.active = false;
        return;
    }
    const uint64_t scanned_cutoff = fence_for(s_identity);
    const uint64_t cutoff = scanned_cutoff > s_current_fence ? scanned_cutoff : s_current_fence;
    if (s_scan.future > cutoff) {
        clock_failure(now);
        s_flags |= hc::Future;
        s_scan.active = false;
        return;
    }
    if (s_floor && cutoff <= s_floor) {
        s_scan.active = false;
        s_clock_bad   = true;
        retire(s_identity, 2);
        return;
    }
    if (cutoff > s_current_fence) {
        bool materialized = false;
        for (const auto& heater : s_cells)
            for (const auto& c : heater) materialized |= (c.state & BasePresent) != 0;
        if (materialized) {
            clear_cells();
            loss();
            s_current_fence = cutoff;
            s_scan.active   = false;
            return;
        }
        s_current_fence = cutoff;
    }
    for (auto& heater : s_cells)
        for (auto& c : heater) {
            if (c.state & BaseKnown) {
                if (!has_evidence(c.counters)) {
                    wh::zero_object(c);
                    continue;
                }
                if (c.revision && (!(c.state & DurableSeen) || (c.state & RefSuperseded))) {
                    c.revision = 0;
                    c.slot     = 0;
                    c.state |= Dirty;
                    s_flags |= hc::Loss;
                }
            } else if ((c.state & Occupied) && c.revision <= cutoff) {
                c.revision = 0;
                c.slot     = 0;
                if (!has_evidence(c.counters)) wh::zero_object(c);
            }
        }
    s_scan.reading = true;
    s_scan.replay  = 0;
    s_proof        = true;
    s_retry        = 0;
    s_flags &= uint16_t(~(hc::Incomplete | hc::Future | hc::ScopeMismatch));
}
void materialize(HeaterContextReader reader, Slice& slice) {
    while (true) {
        uint8_t  index;
        uint16_t slot;
        uint64_t revision;
        int64_t  bucket;
        uint32_t epoch;
        {
            SemGuard lock(s_mutex, 0);
            if (!lock || !current_scan() || !s_scan.reading || !s_proof) return;
            if (s_scan.replay == 48) {
                s_scan.active = false;
                return;
            }
            index   = s_scan.replay;
            auto& c = s_cells[index / 24][index % 24];
            if (!(c.state & Occupied) || (c.state & BaseKnown)) {
                ++s_scan.replay;
                continue;
            }
            if (!c.revision) {
                c.state |= BaseKnown;
                ++s_scan.replay;
                continue;
            }
            slot     = c.slot;
            revision = c.revision;
            bucket   = c.bucket;
            epoch    = s_epoch;
        }
        if (!slice.take()) return;
        wh::View   v;
        const bool ok    = reader && reader(slot, v);
        const bool valid = ok && wh::typed(v, wh::Kind::Data) && v.header->sequence == revision &&
                           v.header->bucket == bucket &&
                           wh::decode_data_into(v.payload, 192, s_read);
        SemGuard lock(s_mutex, 0);
        if (!lock) return;
        expire_locked(esp_timer_get_time(), heater_wall_now());
        if (!current_scan() || s_epoch != epoch) return;
        if (!valid) {
            scan_error(!ok, hc::LatestFailure);
            return;
        }
        auto& c = s_cells[index / 24][index % 24];
        if (!(c.state & Occupied) || c.bucket != bucket || c.revision != revision || c.slot != slot)
            continue;
        if (!wh::equal(s_read.identity, s_identity) || s_read.heater != index / 24 ||
            s_read.required != s_heaters || s_read.capabilities != s_caps ||
            !wh::end_not_future(bucket, s_read.last, s_scan.wall)) {
            scan_error(false, hc::LatestFailure);
            return;
        }
        if (!has_evidence(s_read.counters)) {
            if (s_read.lost > s_dropped) s_dropped = s_read.lost;
            if (s_read.flags & hc::WireLoss) s_flags |= hc::Loss;
            if (s_read.flags & hc::WireClock) s_flags |= hc::Clock;
            if (c.state & Live) {
                c.revision = 0;
                c.slot     = 0;
                c.state |= BaseKnown;
            } else
                wh::zero_object(c);
            ++s_scan.replay;
            continue; // a zero-evidence full revision is not an observed hour or an older fallback
        }
        if ((c.state & Live) && s_read.last >= c.first) {
            c.state |= Refused;
            s_flags |= hc::Incomplete | hc::Loss;
            ++s_scan.replay;
            continue;
        }
        if (c.state & Live) {
            hd::merge(c.counters, s_read.counters);
            c.first = s_read.first;
        } else {
            c.counters = s_read.counters;
            c.first    = s_read.first;
            c.last     = s_read.last;
        }
        c.flags |= s_read.flags;
        if (s_read.lost > c.lost) c.lost = s_read.lost;
        c.state |= BaseKnown | BasePresent;
        ++s_scan.replay;
    }
}
} // namespace

void heater_context_start(bool enabled, uint32_t consent) {
    if (!s_mutex) s_mutex = xSemaphoreCreateMutexStatic(&s_mutex_storage);
    SemGuard lock(s_mutex);
    if (!lock) return;
    s_epoch            = 0;
    s_token            = 0;
    s_hard             = false;
    s_identity         = {};
    s_identity.consent = consent;
    s_generation       = 0;
    s_caps             = 0;
    s_heaters          = 0;
    s_enabled          = enabled;
    s_confirmed        = false;
    s_clock_bad        = false;
    s_anchored         = false;
    s_dropped          = 0;
    s_flags            = 0;
    s_highest = s_floor = s_physical = s_current_fence = 0;
    s_claim = s_outstanding = s_deferred = false;
    for (auto& r : s_retire) wh::zero_object(r);
    for (auto& f : s_fences) wh::zero_object(f);
    clear_cells();
    wh::zero_object(s_scan);
    wh::zero_object(s_erase);
    s_retry      = 0;
    s_read_limit = -1;
}
void heater_context_set_diagnostics(bool enabled, uint32_t consent) {
    SemGuard lock(s_mutex);
    if (!lock) return;
    retire(s_identity, 1);
    clear_cells();
    if (consent != s_identity.consent) {
        s_dropped       = 0;
        s_current_fence = 0;
    }
    s_identity.consent = consent;
    s_enabled          = enabled;
    s_confirmed        = false;
    s_read_limit       = esp_timer_get_time();
}
void heater_context_set_enabled(bool enabled) {
    SemGuard lock(s_mutex);
    if (!lock) return;
    const auto now = esp_timer_get_time();
    hd::pause(s_reducer);
    expire_locked(now, heater_wall_now());
    s_enabled    = enabled;
    s_read_limit = now;
    s_confirmed  = s_enabled && wh::valid_identity(s_identity) && s_generation &&
                  !(s_caps & ~hd::ALL) && !(s_heaters & ~3u);
}
void heater_context_bind(uint32_t source, uint32_t model, uint32_t schema, uint32_t generation,
                         uint16_t caps, uint8_t heaters, bool restore) {
    SemGuard lock(s_mutex);
    if (!lock) return;
    const wh::Identity next{source, model, schema, s_identity.consent, 0};
    const bool         changed = !wh::equal(next, s_identity) || generation != s_generation ||
                         caps != s_caps || heaters != s_heaters;
    if (changed && s_confirmed) {
        retire(s_identity, 1);
        clear_cells();
        s_read_limit = esp_timer_get_time();
    }
    if (!wh::equal(next, s_identity)) {
        s_dropped       = 0;
        s_current_fence = 0;
    }
    s_identity   = next;
    s_generation = generation;
    s_caps       = caps;
    s_heaters    = heaters;
    s_confirmed  = s_enabled && wh::valid_identity(next) && generation && !(caps & ~hd::ALL) &&
                  !(heaters & ~3u);
    if (s_confirmed && (!restore || s_clock_bad)) retire(next, s_clock_bad ? 2 : 1);
    if (changed) {
        s_proof = false;
        s_retry = 0;
    }
}
void heater_context_pause() {
    SemGuard lock(s_mutex);
    if (lock) {
        hd::pause(s_reducer);
        expire_locked(esp_timer_get_time(), heater_wall_now());
    }
}
void heater_context_reset() {
    SemGuard lock(s_mutex);
    if (lock) {
        retire(s_identity, 1);
        clear_cells();
        s_confirmed  = false;
        s_read_limit = esp_timer_get_time();
    }
}
void heater_context_forget() {
    SemGuard lock(s_mutex);
    if (lock) {
        retire(s_identity, 1);
        clear_cells();
        invalidate();
        s_confirmed  = false;
        s_read_limit = esp_timer_get_time();
    }
}
void heater_context_expire() {
    SemGuard lock(s_mutex);
    if (lock) expire_locked(esp_timer_get_time(), heater_wall_now());
}
void heater_context_seal() {
    SemGuard lock(s_mutex);
    if (lock) {
        expire_locked(esp_timer_get_time(), heater_wall_now());
        s_sealed = true;
        hd::pause(s_reducer);
    }
}
void heater_context_record(int64_t sample, const hd::Sample& input) {
    SemGuard lock(s_mutex);
    if (!lock || !s_enabled || !s_confirmed || s_sealed || s_clock_bad || s_hard || !s_heaters)
        return;
    const auto now = esp_timer_get_time(), wall = heater_wall_now();
    if (!clock_ok(now, wall) || sample < 0 || sample > now || sample <= s_read_limit ||
        (s_sample >= 0 && sample <= s_sample) || sample > INT64_MAX - s_offset)
        return;
    const auto at       = sample + s_offset,
               previous = s_reducer.previous_us < 0 ? -1 : s_reducer.previous_us + s_offset;
    wh::zero_object(s_delta);
    const auto result = hd::step(s_reducer, s_delta, sample, s_generation, s_identity.schema,
                                 s_heaters, s_caps, input);
    if (!hh::split(result, previous, at, s_split)) {
        hd::pause(s_reducer);
        return;
    }
    for (size_t i = 0; i < s_split.count; ++i) {
        const auto& p = s_split.pieces[i];
        if (!wh::in_window(p.bucket, wall)) continue;
        wh::zero_object(s_split_delta);
        if (!hh::merge_piece(s_split_delta, s_delta, s_split, i)) {
            s_hard = true;
            loss();
            hd::pause(s_reducer);
            return;
        }
        for (size_t h = 0; h < 2; ++h)
            if (s_heaters & (1u << h)) {
                auto& c = s_cells[h][size_t(p.bucket % 24)];
                if (!(c.state & Occupied) || c.bucket != p.bucket) {
                    if (c.state & Dirty) loss();
                    wh::zero_object(c);
                    c.bucket = p.bucket;
                    c.first  = p.first_offset_us;
                    c.state  = Occupied;
                    if (s_proof) c.state |= BaseKnown;
                }
                if (!(c.state & (Live | BasePresent))) c.first = p.first_offset_us;
                if (p.first_offset_us < c.first) c.first = p.first_offset_us;
                if (p.last_offset_us > c.last) c.last = p.last_offset_us;
                if (c.mutation == UINT32_MAX) {
                    s_hard = true;
                    loss();
                    return;
                }
                ++c.mutation;
                hd::merge(c.counters, s_split_delta.heater[h]);
                c.state |= Live | Dirty;
            }
    }
    s_sample = sample;
}

HeaterContextStatus heater_context_status() {
    SemGuard lock(s_mutex);
    return lock ? project_locked() : HeaterContextStatus{};
}
void heater_context_report(uint8_t heater, HeaterContextHeaterReport& out) {
    SemGuard lock(s_mutex);
    wh::zero_object(out);
    out.partial = out.restore_pending = true;
    if (!lock || heater >= 2) return;
    const auto m            = project_locked();
    out.counters            = s_projection[heater];
    out.epoch               = m.epoch;
    out.capabilities        = m.capabilities;
    out.flags               = m.flags;
    out.dropped             = m.dropped;
    out.supported_heaters   = m.supported_heaters;
    out.observed_hours      = m.observed_hours[heater];
    out.confirmed           = m.confirmed;
    out.dated               = m.dated;
    out.partial             = m.partial;
    out.restore_pending     = m.restore_pending;
    out.persistence_pending = m.persistence_pending;
}
void heater_context_payload(logic::HeaterContextPayloadFields& out) {
    SemGuard lock(s_mutex);
    if (!lock) {
        wh::zero_object(out);
        out.partial = out.restore_pending = true;
        return;
    }
    const auto m = project_locked();
    logic::heater_context_payload_project(out, s_projection, m);
}
bool heater_context_flash_scan_begin() {
    SemGuard lock(s_mutex, 0);
    if (!lock) return false;
    const auto now = esp_timer_get_time(), wall = heater_wall_now();
    expire_locked(now, wall);
    if (!clock_ok(now, wall) || !s_enabled || !s_confirmed || !s_heaters || s_proof ||
        s_clock_bad || s_hard || wall < 0 || now < s_retry || pending_fence(s_identity))
        return false;
    if (current_scan()) return true;
    wh::zero_object(s_scan);
    s_scan.epoch    = s_epoch;
    s_scan.mutation = s_physical;
    s_scan.wall     = wall;
    s_scan.active   = true;
    // Rebuild the bounded fence catalog, retaining the separately known current cutoff,
    // physical highwater and rollback floor. Safe retirement can then free old identities.
    for (auto& f : s_fences) wh::zero_object(f);
    for (auto& heater : s_cells)
        for (auto& c : heater) {
            c.state &= uint8_t(~(DurableSeen | RefSuperseded));
            if (!(c.state & BaseKnown)) {
                c.revision = 0;
                c.slot     = 0;
                c.state &= uint8_t(~Refused);
            }
        }
    return true;
}
void heater_context_flash_scan_slot(uint16_t slot, const wh::View& v, bool ok) {
    SemGuard lock(s_mutex, 0);
    if (!lock || !current_scan() || s_scan.reading) return;
    if (slot >= logic::HISTORY_JOURNAL_SLOT_COUNT || slot != s_scan.next || !ok) {
        scan_error(!ok);
        return;
    }
    ++s_scan.next;
    select_slot(slot, v);
}
void heater_context_flash_scan_finish() {
    SemGuard lock(s_mutex, 0);
    if (lock && s_scan.next == logic::HISTORY_JOURNAL_SLOT_COUNT) finish_scan_locked();
}
void heater_context_flash_index_invalidate() {
    SemGuard lock(s_mutex); // real physical mutation cannot be dropped on contention
    if (!lock) return;
    invalidate();
    s_retry = 0;
}
void heater_context_flash_sector_erased(uint16_t first) {
    SemGuard lock(s_mutex);
    if (!lock) return;
    invalidate();
    s_retry                = 0;
    constexpr uint16_t per = logic::HISTORY_FLASH_ERASE_BYTES / logic::HISTORY_JOURNAL_SLOT_BYTES;
    if (first >= logic::HISTORY_JOURNAL_SLOT_COUNT || first % per) return;
    for (auto& heater : s_cells)
        for (auto& c : heater)
            if (c.revision && c.slot >= first && c.slot < first + per) {
                c.revision = 0;
                c.slot     = 0;
                c.state &= uint8_t(~DurableSeen);
                if ((c.state & BaseKnown) && has_evidence(c.counters))
                    c.state |= Dirty;
                else if (!has_evidence(c.counters))
                    wh::zero_object(c);
                else
                    s_flags |= hc::LatestFailure | hc::Loss;
            }
}
void heater_context_flash_service(HeaterContextReader reader, size_t budget) {
    Slice slice(budget);
    {
        SemGuard lock(s_mutex, 0);
        if (!lock) return;
        expire_locked(esp_timer_get_time(), heater_wall_now());
        settle_claim_locked();
    }
    if (!budget) return;
    (void)heater_context_flash_scan_begin();
    while (true) {
        uint16_t slot;
        {
            SemGuard lock(s_mutex, 0);
            if (!lock || !current_scan() || s_scan.reading) break;
            // A previous zero-wait finish may have yielded after the final slot. Finalize
            // before another Reader call, never offer the one-past-the-end physical index.
            if (s_scan.next == logic::HISTORY_JOURNAL_SLOT_COUNT) {
                finish_scan_locked();
                break;
            }
            slot = s_scan.next;
        }
        if (!slice.take()) return;
        wh::View   v;
        const bool ok = reader && reader(slot, v);
        heater_context_flash_scan_slot(slot, v, ok);
        if (slot + 1 == logic::HISTORY_JOURNAL_SLOT_COUNT) heater_context_flash_scan_finish();
    }
    materialize(reader, slice);
}

bool heater_context_flash_next(HeaterContextReader, uint64_t sequence, HeaterContextFlashPiece& out,
                               uint8_t* payload, size_t capacity) {
    SemGuard lock(s_mutex, 0);
    if (!lock || !payload || capacity < 192) return false;
    const auto now = esp_timer_get_time(), wall = heater_wall_now();
    expire_locked(now, wall);
    if (wall < 0 || !sequence || sequence == UINT64_MAX || sequence <= s_highest) return false;
    if (s_claim) {
        if (!claim_current()) {
            s_claim = s_outstanding = false;
            return false;
        }
        if (s_outstanding && !s_deferred) return false;
        if (s_piece.sequence != sequence) return false;
        if (s_piece.kind == wh::Kind::Data && (!s_proof || pending_fence(s_identity))) return false;
        s_deferred    = false;
        s_outstanding = true;
        std::memcpy(payload, s_wire, s_piece.bytes);
        out = s_piece;
        return true;
    }
    wh::zero_object(s_piece);
    s_piece.sequence       = sequence;
    s_piece.epoch          = s_epoch;
    s_piece.remaining      = 1;
    Retirement* retirement = nullptr;
    for (auto& r : s_retire)
        if (r.token) {
            retirement = &r;
            break;
        }
    bool encoded = false;
    if (retirement) {
        wh::zero_object(s_write_fence);
        s_write_fence.identity = retirement->identity;
        s_write_fence.reason   = retirement->reason;
        s_write_fence.sequence = sequence;
        s_piece.kind           = wh::Kind::Fence;
        s_piece.bytes          = 32;
        s_piece.token          = retirement->token;
        s_piece.bucket         = wall / wh::HOUR_US;
        encoded                = wh::encode_fence(s_write_fence, s_wire, 32);
    } else {
        if (!clock_ok(now, wall) || !s_proof || !s_enabled || !s_confirmed || s_clock_bad ||
            s_hard || pending_fence(s_identity))
            return false;
        Cell* chosen = nullptr;
        for (size_t h = 0; h < 2; ++h)
            if (s_heaters & (1u << h))
                for (auto& c : s_cells[h])
                    if ((c.state & (Occupied | Dirty | BaseKnown)) ==
                            (Occupied | Dirty | BaseKnown) &&
                        !(c.state & Refused) && has_evidence(c.counters) &&
                        wh::in_window(c.bucket, wall) &&
                        wh::end_not_future(c.bucket, c.last, wall) &&
                        (c.bucket < wall / wh::HOUR_US || s_sealed) &&
                        (!chosen || c.bucket < chosen->bucket)) {
                        chosen         = &c;
                        s_claim_heater = uint8_t(h);
                    }
        if (!chosen) return false;
        wh::zero_object(s_write);
        s_write.identity     = s_identity;
        s_write.heater       = s_claim_heater;
        s_write.required     = s_heaters;
        s_write.capabilities = s_caps;
        s_write.first        = chosen->first;
        s_write.last         = chosen->last;
        s_write.counters     = chosen->counters;
        s_write.flags        = chosen->flags | hc::WirePartial;
        s_write.lost         = chosen->lost;
        if (s_dropped > s_write.lost) s_write.lost = s_dropped;
        if (s_write.lost) s_write.flags |= hc::WirePartial | hc::WireLoss;
        s_piece.kind   = wh::Kind::Data;
        s_piece.bytes  = 192;
        s_piece.bucket = chosen->bucket;
        s_piece.token  = token();
        if (!s_piece.token) return false;
        s_claim_mutation = chosen->mutation;
        encoded          = wh::encode_data(s_write, s_wire, 192);
    }
    if (!encoded) {
        s_hard = true;
        loss();
        return false;
    }
    s_claim = s_outstanding = true;
    s_deferred              = false;
    std::memcpy(payload, s_wire, s_piece.bytes);
    out = s_piece;
    return true;
}
void heater_context_flash_deferred(const HeaterContextFlashPiece& p) {
    SemGuard lock(s_mutex); // preserve the sole writer's immutable reservation
    if (lock && piece_same(p) && s_outstanding) {
        s_deferred    = true;
        s_outstanding = false;
    }
}
void heater_context_flash_failed(const HeaterContextFlashPiece& p) {
    SemGuard lock(s_mutex); // an actual write failure must always retire the claim
    if (lock && piece_same(p)) {
        s_claim = s_outstanding = s_deferred = false;
        loss();
        invalidate();
        s_retry = 0;
    }
}
bool heater_context_flash_claim_pending() {
    SemGuard lock(s_mutex, 0);
    if (!lock) return true;
    settle_claim_locked();
    return s_claim;
}
void heater_context_flash_appended(const HeaterContextFlashPiece& p, uint16_t slot,
                                   const wh::View& v) {
    SemGuard lock(s_mutex); // one-shot verified ACK: never silently lose it
    if (!lock || !piece_same(p) || !s_outstanding) return;
    if (slot >= logic::HISTORY_JOURNAL_SLOT_COUNT || !wh::typed(v, p.kind) ||
        v.header->sequence != p.sequence || v.header->bucket != p.bucket ||
        std::memcmp(v.payload, s_wire, p.bytes)) {
        s_flags |= hc::Incomplete | hc::Loss;
        invalidate();
        s_claim = s_outstanding = s_deferred = false;
        return;
    }
    if (p.sequence > s_highest) s_highest = p.sequence;
    known_append();
    if (!claim_current()) {
        if (p.kind == wh::Kind::Data) retire(s_write.identity, 1);
        invalidate();
        s_retry = 0;
        s_claim = s_outstanding = s_deferred = false;
        return;
    }
    if (p.kind == wh::Kind::Fence) {
        if (!add_fence(s_write_fence)) {
            s_hard = true;
            loss();
        }
        for (auto& r : s_retire)
            if (r.token == p.token) wh::zero_object(r);
        if (wh::equal(s_write_fence.identity, s_identity)) {
            s_current_fence = p.sequence;
            if (s_write_fence.reason == 2 && p.sequence > s_floor) {
                s_clock_bad  = false;
                s_anchored   = false;
                s_read_limit = esp_timer_get_time();
                hd::pause(s_reducer);
            }
        }
        if (!s_proof) {
            invalidate();
            s_retry = 0;
        }
    } else {
        auto& c = s_cells[s_claim_heater][size_t(p.bucket % 24)];
        if ((c.state & Occupied) && c.bucket == p.bucket) {
            c.revision = p.sequence;
            c.slot     = slot;
            c.flags |= s_write.flags;
            if (s_write.lost > c.lost) c.lost = s_write.lost;
            if (c.mutation == s_claim_mutation) c.state &= uint8_t(~Dirty);
        }
    }
    s_claim = s_outstanding = s_deferred = false;
}

HeaterContextErasePermission heater_context_flash_erase_permission(HeaterContextReader reader,
                                                                   uint16_t            first) {
    constexpr uint16_t per = logic::HISTORY_FLASH_ERASE_BYTES / logic::HISTORY_JOURNAL_SLOT_BYTES;
    if (!reader || first >= logic::HISTORY_JOURNAL_SLOT_COUNT || first % per)
        return HeaterContextErasePermission::Protected;
    Slice slice(256);
    while (true) {
        uint16_t slot;
        uint32_t epoch;
        uint64_t mutation;
        {
            SemGuard lock(s_mutex, 0);
            if (!lock) return HeaterContextErasePermission::Pending;
            if (!s_erase.phase || s_erase.epoch != s_epoch || s_erase.mutation != s_physical ||
                s_erase.first != first) {
                wh::zero_object(s_erase);
                s_erase.first    = first;
                s_erase.next     = first;
                s_erase.epoch    = s_epoch;
                s_erase.mutation = s_physical;
                s_erase.phase    = 1;
            }
            if (s_erase.phase == 3) return s_erase.result;
            slot     = s_erase.next;
            epoch    = s_epoch;
            mutation = s_physical;
        }
        if (!slice.take()) return HeaterContextErasePermission::Pending;
        wh::View   v;
        const bool ok = reader(slot, v);
        SemGuard   lock(s_mutex, 0);
        if (!lock || s_epoch != epoch || s_physical != mutation)
            return HeaterContextErasePermission::Pending;
        bool protect = !ok;
        if (ok && !wh::slot_erased(v)) {
            if (!ordinary_physical(v))
                protect = true;
            else {
                const auto kind = wh::kind(*v.header), oldkind = hc::kind(*v.header);
                if (s_erase.phase == 1 && oldkind != wh::Kind::Unknown) protect = true;
                if (kind != wh::Kind::Unknown && !wh::typed(v, kind)) protect = true;
                if (kind == wh::Kind::Data && !wh::decode_data_into(v.payload, 192, s_read))
                    protect = true;
                if (kind == wh::Kind::Fence) {
                    if (!wh::decode_fence_into(v.payload, 32, s_read_fence) ||
                        s_read_fence.sequence != v.header->sequence)
                        protect = true;
                    else if (s_erase.phase == 1 && s_read_fence.sequence > s_erase.cutoff)
                        s_erase.cutoff = s_read_fence.sequence;
                }
                if (s_erase.phase == 2 &&
                    (kind == wh::Kind::Data || oldkind == wh::Kind::Data ||
                     oldkind == wh::Kind::Commit) &&
                    v.header->sequence <= s_erase.cutoff)
                    protect = true;
            }
        }
        if (protect) {
            s_erase.phase  = 3;
            s_erase.result = HeaterContextErasePermission::Protected;
            return s_erase.result;
        }
        ++s_erase.next;
        if (s_erase.phase == 1 && s_erase.next == first + per) {
            if (!s_erase.cutoff) {
                s_erase.phase  = 3;
                s_erase.result = HeaterContextErasePermission::Allowed;
                return s_erase.result;
            }
            s_erase.phase = 2;
            s_erase.next  = 0;
        }
        if (s_erase.phase == 2) {
            if (s_erase.next == first) s_erase.next = uint16_t(first + per);
            if (s_erase.next == logic::HISTORY_JOURNAL_SLOT_COUNT) {
                s_erase.phase  = 3;
                s_erase.result = HeaterContextErasePermission::Allowed;
                return s_erase.result;
            }
        }
    }
}
size_t heater_context_private_static_bytes() {
    return sizeof(s_cells) + sizeof(s_retire) + sizeof(s_fences) + sizeof(s_identity) +
           sizeof(s_reducer) + sizeof(s_delta) + sizeof(s_split_delta) + sizeof(s_split) +
           sizeof(s_projection) + sizeof(s_write) + sizeof(s_read) + sizeof(s_write_fence) +
           sizeof(s_read_fence) + sizeof(s_wire) + sizeof(s_piece) + sizeof(s_scan) +
           sizeof(s_erase) + sizeof(s_mutex_storage) + sizeof(s_mutex) + sizeof(s_highest) * 4 +
           sizeof(s_epoch) * 4 + sizeof(s_caps) * 3 + sizeof(s_heaters) * 2 +
           sizeof(s_enabled) * 9 + sizeof(s_offset) * 6 + sizeof(s_anchored);
}
} // namespace daik
