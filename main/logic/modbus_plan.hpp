#pragma once
// WHICH MODBUS REQUESTS ONE POLL CYCLE ISSUES — the read PLAN, separated from the socket that runs
// it (hp_modbus.cpp) and from the framing it is written in (logic/modbus.hpp).
//
// WHY. The HomeHub map was read one register at a time, once per POLL_INTERVAL_S: 32 MBAP
// round-trips a second, ~2.8 million requests a day, against a hub that also serves the Onecta app,
// the unit's MMI, evcc and whatever else on the LAN speaks to it. Nothing about the map required
// that. The EKRHH offsets fall into ten contiguous runs. Two facts are time-critical gates — plant
// operation and current mode — and input 44 is time-critical event context that #441 requires from
// the same poll cycle. Everything else is a water temperature, a flow rate or a setpoint
// read-back, none of which moves meaningfully inside five seconds, and all of which folds into a
// five-MINUTE history bucket. So: batch the runs, read the whole map on a slower cadence, and keep
// only gates plus the named outdoor context at 1 Hz.
//
// WHY PURE. Both halves are the off-by-one a .cpp hides until it is in the field, and both fail
// SILENTLY rather than loudly:
//   - a run built one register short simply stops refreshing the LAST row of every batch. The row
//     still decodes, still publishes, still looks right — it is merely frozen. That is the #35-#39
//     shape wearing a timestamp, and no other gate here can see it.
//   - a cadence rule that never fires a full cycle leaves the entire cache at whatever the first
//     cycle happened to read, which on a fresh session is nothing at all.
// Neither is observable on a bench board in an afternoon; both are one CHECK here.
//
// It takes PLAIN ARRAYS rather than def::HomeHubReg, for the reason logic/ takes no def/ dependency
// anywhere: def/homehub.hpp already includes logic/modbus.hpp, so the reverse edge would be a cycle.
// The caller passes the two columns the plan is actually a function of — and because everything here
// is constexpr, that caller can build its plan at COMPILE TIME and keep it in flash rather than
// paying RAM for a table that never changes (hp_modbus.cpp does exactly that, and static_asserts the
// result where it is built).
#include <cstddef>
#include <cstdint>

#include "modbus.hpp"

namespace daik::logic {

// One request. `first_offset` is the 1-based EKRHH data-model offset of the first register, `count`
// the register quantity to ask for. `row_first`/`row_count` index the SORTED order array, so
// decoding a batch is a walk over consecutive entries rather than a lookup per register.
struct MbBatch {
    MbFunc   space        = MbFunc::ReadInput;
    uint16_t first_offset = 0;
    uint8_t  count        = 0;
    uint8_t  row_first    = 0;
    uint8_t  row_count    = 0;
};

// The per-request register cap, deliberately far below the protocol's MB_MAX_READ_REGS (125). A
// batch is the unit of LOSS as much as the unit of saving: one dropped or exception-answered reply
// costs its whole run for that cycle. Sixteen collapses every run this map has (the longest is six)
// while bounding the worst case, and bounds a reply to MBAP + 2 + 32 = 41 bytes.
inline constexpr uint8_t MB_PLAN_MAX_REGS = 16;

// One FULL cycle every five poll ticks; the four between it read only the batches carrying a gate.
// Five rather than ten because this is also the dashboard's refresh: the browser polls /values every
// two seconds, and a HomeHub reading that can be up to ten seconds old next to a one-second X10A
// reading of the same quantity invites exactly the "which one is current?" question the two-array
// /values shape exists to make answerable. Five keeps the pairing legible and still removes ~87% of
// the traffic. It is NOT chosen from how fast water temperatures move — that would allow far more.
inline constexpr uint32_t MB_FULL_CYCLE_TICKS = 5;

// The offsets that must stay current at the poll cadence: input register 53 (normal space operation)
// and 38 (heating rather than cooling) are diagnosis gates. Input 44 is NOT a gate; it is the
// optional plant outdoor context attached to an eligible event. Its 40..45 batch does not overlap
// either gate batch, so naming it separately here deliberately spends one bundled read per gate
// cycle to make "answered this cycle" true rather than borrowing the five-second value cache.
inline constexpr uint16_t MB_GATE_OFFSETS[] = {38, 53};
inline constexpr size_t   MB_GATE_OFFSET_COUNT =
    sizeof(MB_GATE_OFFSETS) / sizeof(MB_GATE_OFFSETS[0]);
inline constexpr uint16_t MB_CONTEXT_OFFSETS[] = {44};
inline constexpr size_t   MB_CONTEXT_OFFSET_COUNT =
    sizeof(MB_CONTEXT_OFFSETS) / sizeof(MB_CONTEXT_OFFSETS[0]);

// Gates live in the INPUT space; a holding register that happens to share an offset number is a
// different register entirely (offset 3 exists in both), so the space is half the key.
constexpr bool mb_offset_is_gate(MbFunc space, uint16_t offset) {
    if (space != MbFunc::ReadInput) return false;
    for (size_t i = 0; i < MB_GATE_OFFSET_COUNT; i++)
        if (MB_GATE_OFFSETS[i] == offset) return true;
    return false;
}

constexpr bool mb_offset_is_fast_context(MbFunc space, uint16_t offset) {
    if (space != MbFunc::ReadInput) return false;
    for (size_t i = 0; i < MB_CONTEXT_OFFSET_COUNT; i++)
        if (MB_CONTEXT_OFFSETS[i] == offset) return true;
    return false;
}

// Tick 0 is FULL, and that is the load-bearing half: it makes the first cycle of a session publish a
// complete cache rather than leaving it empty after a fast-only read. The caller resets the tick on
// every reconnect for exactly that reason — a session that resumed mid-cycle would otherwise serve
// no value map until the cadence wrapped, which reads as a broken hub rather than as a cadence.
constexpr bool mb_cycle_is_full(uint32_t tick) {
    return MB_FULL_CYCLE_TICKS <= 1 || (tick % MB_FULL_CYCLE_TICKS) == 0;
}

// The link exposes ONE current error for the whole register map. A clean fast cycle proves only that
// its selected batches recovered; it says nothing about a full-cycle register that failed on
// the preceding full cycle. Clearing the global error there would make /status and Syslog oscillate
// between failure and "recovered" every five seconds without ever re-reading the failing row.
// Therefore only a clean, still-current FULL cycle is evidence for global recovery.
constexpr bool mb_cycle_proves_recovery(bool full_cycle, bool current_session) {
    return full_cycle && current_session;
}

// Sort `n` rows by (space, offset) into `out_order` (indices into the caller's arrays). Insertion
// sort because n is ~31 and this runs once, at compile time in the shipping caller: the simple thing
// that is obviously correct beats the clever one nobody can check by eye.
//
// Returns false when two rows share a (space, offset). That is not defensive tidiness — the batch
// walk below hands consecutive reply words to consecutive rows, so a duplicated coordinate would
// give one register's value to two different rows and shift every row after it by one. A caller must
// treat false as "do not use this plan".
constexpr bool mb_plan_order(const MbFunc* spaces, const uint16_t* offsets, int n,
                             uint8_t* out_order) {
    if (n < 0) return false;
    if (n > 0 && (spaces == nullptr || offsets == nullptr || out_order == nullptr)) return false;
    for (int i = 0; i < n; i++) out_order[i] = static_cast<uint8_t>(i);
    for (int i = 1; i < n; i++) {
        const uint8_t key = out_order[i];
        int j = i - 1;
        while (j >= 0) {
            const uint8_t o = out_order[j];
            const bool greater =
                (static_cast<int>(spaces[o]) > static_cast<int>(spaces[key])) ||
                (spaces[o] == spaces[key] && offsets[o] > offsets[key]);
            if (!greater) break;
            out_order[j + 1] = o;
            j--;
        }
        out_order[j + 1] = key;
    }
    for (int i = 1; i < n; i++) {
        const uint8_t a = out_order[i - 1], b = out_order[i];
        if (spaces[a] == spaces[b] && offsets[a] == offsets[b]) return false;
    }
    return true;
}

// Build the batches over an already-ordered index array. A batch breaks on a change of function
// space, a gap in the offsets, or MB_PLAN_MAX_REGS.
//
// Returns the batch count, or -1 when `max` cannot hold the plan — never a TRUNCATED plan, which
// would drop the tail of the map with nothing anywhere to say so. The safe upper bound for `max` is
// `n` (every row its own batch, i.e. the old one-request-per-register behaviour).
constexpr int mb_plan_build(const MbFunc* spaces, const uint16_t* offsets, int n,
                            const uint8_t* order, MbBatch* out, int max) {
    if (n <= 0) return 0;
    int nb = 0;
    int i = 0;
    while (i < n) {
        const uint8_t head = order[i];
        MbBatch b;
        b.space        = spaces[head];
        b.first_offset = offsets[head];
        b.count        = 1;
        b.row_first    = static_cast<uint8_t>(i);
        b.row_count    = 1;
        int j = i + 1;
        while (j < n) {
            const uint8_t r = order[j];
            if (spaces[r] != b.space) break;
            if (offsets[r] != static_cast<uint16_t>(b.first_offset + b.count)) break;
            if (b.count >= MB_PLAN_MAX_REGS) break;
            b.count = static_cast<uint8_t>(b.count + 1);
            b.row_count = static_cast<uint8_t>(b.row_count + 1);
            j++;
        }
        if (nb >= max) return -1;
        out[nb++] = b;
        i = j;
    }
    return nb;
}

// Must this batch be read on a fast cycle? Derived from the offsets the batch covers, so a batch
// containing a gate or the named event context carries its neighbours along at no extra cost. This
// is why the fast cycle also refreshes the 3-way valve, compressor flag, flow, power and room
// temperature even though only the two gates plus input 44 are committed outside the value cache.
constexpr bool mb_batch_is_fast(const MbBatch& b) {
    for (uint16_t k = 0; k < b.count; k++)
        if (mb_offset_is_gate(b.space, static_cast<uint16_t>(b.first_offset + k)) ||
            mb_offset_is_fast_context(b.space, static_cast<uint16_t>(b.first_offset + k)))
            return true;
    return false;
}

} // namespace daik::logic
