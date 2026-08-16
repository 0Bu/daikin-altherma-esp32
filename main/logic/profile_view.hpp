#pragma once
// A profile's rows AS EVERY CONSUMER MUST SEE THEM: the GENERATED per-model table (def/*.hpp) plus
// the hand-written supplements in def/overlay.hpp, presented as ONE indexable sequence.
//
// WHY A VIEW AND NOT A MERGED ARRAY — the rows are `constexpr` tables in flash; concatenating 43 of
// them at build time is not expressible, and doing it at runtime would mean a heap allocation on the
// poll path (every second) for data that never changes. A view is three pointers and three lengths,
// all
// pointing at static storage: no allocation, nothing to free, nothing to strand a mutex.
//
// WHY EVERY CONSUMER AND NOT JUST THE DECODER — four call sites read the row set, and they are not
// independent: hp_poll decodes them into the cache, mqtt_ha announces one HA discovery config per
// row, and BOTH http_status (`/values`) and mqtt_ha (the grouped X10A topic) size
// their snapshot buffer from the row COUNT, which is the exact upper bound on cached values. Grow
// the cache without growing the count and the extra values are silently TRUNCATED out of `/values`
// and out of MQTT — an absent-value bug with no error anywhere, the #35-#39 shape. So the view is
// the single thing all four read; a supplement cannot reach one of them and miss another.
#include <cstddef>
#include <cstdint>

#include "value_def.hpp"

namespace daik::logic {

// Does this table already reference `page`? (Linear over a few dozen rows, called once per resolve.)
inline bool profile_has_page(const ValueDef* v, size_t n, uint8_t page) {
    for (size_t i = 0; i < n; i++)
        if (v[i].reg == page) return true;
    return false;
}

// The base table followed by up to two applicable supplement blocks. Index 0..base_count-1 are the
// model's own generated rows in their generated order, so anything that keyed on that order still
// holds. Two spans are enough for the catalog-wide page-0x10 retry block plus the profile-specific
// observability block; both point at static flash data and allocate nothing.
struct ProfileView {
    const ValueDef* base       = nullptr;
    size_t          base_count = 0;
    const ValueDef* extra      = nullptr;   // nullptr / 0 when the supplement does not apply
    size_t          extra_count = 0;
    const ValueDef* extra2      = nullptr;
    size_t          extra2_count = 0;

    size_t count() const { return base_count + extra_count + extra2_count; }

    const ValueDef& operator[](size_t i) const {
        if (i < base_count) return base[i];
        i -= base_count;
        return i < extra_count ? extra[i] : extra2[i - extra_count];
    }
};

// THE OVERLAY RULE: a supplement block is applied ONLY IF the base profile ALREADY references the
// block's register page.
//
// This single condition buys both properties that make a hand-written supplement safe next to
// machine-generated tables:
//
//  1. DETECTION CANNOT MOVE. A profile's detection signature IS the set of pages its rows reference
//     (def/signatures.hpp), and detect_candidates() picks the candidate with MAXIMAL page overlap
//     (logic/detect.hpp) — so a row that introduces a page changes which MODEL is detected, and with
//     it every value the device publishes. A block gated on a page the base already has can never
//     set a page bit that was not already set. (Belt and braces: signatures.hpp builds its mask over
//     `def::profiles` — the BASE tables — and never sees a view at all. Either guarantee alone is
//     sufficient; keep both, because the cheap one is the one a future refactor would remove.)
//
//  2. NO EXTRA BUS TRAFFIC. hp_poll queries one register per distinct page in the row set. A block
//     on a page the unit is already asked for costs zero additional round-trips; a block on a new
//     page would add one per cycle, and on a model that does not implement it, one TIMEOUT per cycle
//     — which reads on /diag exactly like a wiring fault.
//
// Single-page blocks by construction: `extra_page` is the page ALL of `extra`'s rows sit on. A second
// supplement on a different page is a second call, not a mixed array — mixing pages would make the
// gate above per-row and this function would quietly become a filter.
inline ProfileView profile_view(const ValueDef* base, size_t n,
                                const ValueDef* extra, size_t m, uint8_t extra_page) {
    ProfileView v;
    v.base       = base;
    v.base_count = n;
    if (extra && m > 0 && profile_has_page(base, n, extra_page)) {
        v.extra       = extra;
        v.extra_count = m;
    }
    return v;
}

// Add one profile-specific mixed-page block after the ordinary single-page supplement. Every page
// named by the new rows must already exist in the GENERATED base table. This is deliberately
// all-or-nothing: a generator/profile mismatch withholds the whole observational block instead of
// publishing an accidental subset, and checking only the base table means one supplement can never
// justify a page introduced by another supplement.
inline ProfileView profile_view_extend_existing_pages(ProfileView v,
                                                       const ValueDef* extra, size_t m) {
    if (!extra || m == 0 || v.extra2 || v.extra2_count) return v;
    for (size_t i = 0; i < m; i++)
        if (!profile_has_page(v.base, v.base_count, extra[i].reg)) return v;
    v.extra2       = extra;
    v.extra2_count = m;
    return v;
}

} // namespace daik::logic
