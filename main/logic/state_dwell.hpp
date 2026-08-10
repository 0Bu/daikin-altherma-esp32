#pragma once
// HOW LONG A SWITCHED ROW HAS READ WHAT IT READS — and how much of that was actually observed.
//
// The value list answers "what is it now". For a MEASUREMENT that is the whole question; for a
// SWITCHED row it is half of one. `Powerful DHW Operation: OFF` describes a plant that finished a
// charge four seconds ago and a plant that has not charged since Tuesday equally well, and the row
// cannot tell them apart. This header is the other half: the DWELL, the time the current state has
// stood.
//
// ── Why a scalar and not a ring ─────────────────────────────────────────────────────────────────
// logic/history.hpp already answers a richer version of this for NINE rows (`defrost_state`,
// `bsh_state`, `valve_dhw`, …): a 24-hour categorical timeline whose tooltip names phase start, end
// and sampled duration. It is the better answer where it exists and this header does not compete
// with it. What it cannot be is EXTENDED to the rest: a ring costs HISTORY_BYTES_PER_TREND (576 B)
// and the trend budget is exactly full (TREND_COUNT * 576 == 17856, the static_assert ceiling), the
// rows in question are not on the schematic and so are excluded by that file's own selection rule,
// and each one would need a hand-written browser legend. A dwell is ~16 bytes and answers the
// question that was actually asked.
//
// ── The four ways this number can lie ───────────────────────────────────────────────────────────
// Every one of them has already shipped here in some other form, which is why this is a pure header
// with tests rather than a counter next to the poll loop.
//
//  1. BEFORE THE FIRST OBSERVATION IS UNKNOWN. A board up for ten minutes whose row read OFF
//     throughout has established "OFF for at LEAST ten minutes" and nothing more. Reported as
//     `exact = false`, which the UI must render as a lower bound. Stating a bare "OFF for 10 min"
//     would be the #35-#39 shape: a true number presented as a stronger claim than it is.
//
//  2. BLIND TIME IS NOT UNCHANGED TIME. hp_poll replaces the whole cache each cycle
//     (`s_cache = std::move(fresh)`), so a page that does not answer removes its rows outright —
//     measured on the reference installation, 47 timeouts in 8.2 h. A flag can go ON and back OFF
//     inside such a gap, and a counter that simply kept adding seconds would report an unbroken run
//     straight through it. This is #413/#414's finding one row at a time: a sample the firmware
//     could not READ is blind, not unchanged. Short gaps are absorbed and COUNTED (`blind_s`, so the
//     caveat travels with the number); a gap past DWELL_MAX_GAP_S breaks continuity and the slot
//     stops claiming anything until it is seen again.
//
//  3. THE RASTER IS 1 Hz. A pulse entirely between two sweeps is invisible, exactly as
//     docs/DESIGN.md already says of the state timelines ("sampled raster time, not exact runtime").
//     Nothing here can fix that; the wording downstream must not overstate it.
//
//  4. A REBOOT IS NOT A CHANGE. RAM-only, the dwell would restart at zero on every OTA — on the
//     `dev` channel, often. The slots are carried across a reset that kept power (see
//     DwellRestore below), on history_persist.hpp's terms and with its seal.
//
// ── The key is structural ───────────────────────────────────────────────────────────────────────
// (register page, byte offset, converter) — the identity logic/binary_semantics.hpp and
// logic/homehub_map.hpp already use. NEVER the label: the catalog spells one quantity several ways
// across the 43 profiles and reuses tags across different quantities, so a label key is both
// incomplete and wrong. The converter is load-bearing rather than defensive — six flags share the
// single byte 0x60/12 and differ only in which bit they mask, so without it the diverter valve and
// the circulation pump are one row.
#include "logic/convert.hpp"        // conv_is_binary — the one definition of "this row is a flag"
#include "logic/config_store.hpp"   // config_crc32_* — the firmware's ONE CRC implementation
#include "logic/fault_state.hpp"    // FaultClass + fault_class_from_text — conv 203's own vocabulary
#include "logic/history_persist.hpp" // history_reset_preserves_ram — ONE answer to "did DRAM survive?"

#include <cstddef>
#include <cstdint>

namespace daik::logic {

// ── Which rows are tracked ──────────────────────────────────────────────────────────────────────
// The bit flags (conv 300-307) plus the fault CLASS (conv 203). Both are states rather than
// measurements, which is the whole selection rule: for a temperature "time since the last change"
// is the poll period, because a thermistor at 0.1 K resolution moves constantly — a number that
// would read 1-3 s on ~50 rows and bury the ~34 where it means something.
//
// Conv 204 (the raw Daikin code, "U4"/"7H") is deliberately NOT tracked even though it is textual
// and changes rarely. It is the SAME EVENT as its 203 companion spelled differently — the class row
// sits on the same page and moves at the same instant — so a second dwell beside it is not a second
// reading, it is a second thing to rule out. That is the rule that already retired the crash topic's
// "Last Reset Reason" and the heartbeat's `device_time` (logic/heartbeat.hpp).
// Not constexpr only because conv_is_binary is not: composing it is still the point — a converter
// added to the binary family is tracked here without anyone remembering to say so twice.
inline bool dwell_tracked(int conv) { return conv_is_binary(conv) || conv == 203; }

// Upper bound on tracked rows in one profile. Measured over the shipped catalog the worst case is
// 32 generated rows plus def/overlay.hpp's page-0x10 drop-control flags; test_state_dwell()'s
// catalog sweep pins the real maximum against this so a generator run that adds flags fails the
// suite instead of silently dropping the last rows. Kept at or below 64 because dwell_step marks
// observed slots in one uint64_t rather than allocating.
inline constexpr size_t DWELL_MAX_SLOTS = 48;
static_assert(DWELL_MAX_SLOTS <= 64, "the observed-slot mask is a uint64_t");

// How long a row may go unread before its run stops being believable. A flag can pulse and return
// inside a gap, so past this the slot reports NOTHING rather than a run it cannot vouch for — the
// absence rule this project applies everywhere else (a value the unit is not measuring is never
// reported). Two minutes matches CHECKUP_MAX_GAP_S / DHW_LOSS_BLIND_RUN_MAX_S rather than inventing
// a third idea of how long the bus may be quiet.
inline constexpr uint32_t DWELL_MAX_GAP_S = 120;

// ── The state code ──────────────────────────────────────────────────────────────────────────────
// A small dense integer, because comparing FORMATTED TEXT is how a field comes to change type
// between states (#209 defect 3). 0 is reserved for "no usable state": the row answered, but with
// something this header refuses to call a state — an empty value (the row was refused by
// reading_plausible/value_available upstream) or conv 203's "?" class, which must never read as
// "no fault". A 0 code is treated exactly like a row that did not answer at all: blind, not
// unchanged.
inline constexpr uint8_t DWELL_CODE_NONE = 0;

inline uint8_t dwell_code(int conv, const char* text) {
    if (!text || !text[0]) return DWELL_CODE_NONE;
    if (conv_is_binary(conv)) {
        // Binary rows are the firmware-wide numeric 1/0 boundary (#210). Anything else is a
        // contract break upstream, and answering "state 0" for it would invent one.
        if (text[1] == '\0' && text[0] == '0') return 1;
        if (text[1] == '\0' && text[0] == '1') return 2;
        return DWELL_CODE_NONE;
    }
    if (conv == 203) {
        const FaultClass c = fault_class_from_text(text);
        if (c == FaultClass::Unknown) return DWELL_CODE_NONE;
        return static_cast<uint8_t>(static_cast<int>(c) + 1);
    }
    return DWELL_CODE_NONE;
}

// What the poll task hands over each cycle: one entry per tracked row that produced a usable state.
// A row that timed out, was refused or decoded to no state is simply ABSENT from this array — the
// caller never has to encode "present but unknown", because the two are the same thing here.
struct DwellObservation {
    uint8_t reg  = 0;
    uint8_t off  = 0;
    int16_t conv = 0;
    uint8_t code = DWELL_CODE_NONE;
};

// Slot flags. `Exact` is the difference between "OFF since 3 h 20 min" and "OFF for at least
// 3 h 20 min" and is therefore the field a UI must not ignore.
inline constexpr uint8_t DWELL_F_USED  = 0x01;  // this slot addresses a row
inline constexpr uint8_t DWELL_F_EXACT = 0x02;  // the transition INTO the current state was seen
inline constexpr uint8_t DWELL_F_STALE = 0x04;  // unread past DWELL_MAX_GAP_S — claims nothing

// Field order is chosen for SIZE, not for reading order: 48 of these sit in .noinit and a slip that
// pads each one costs the whole table. 4+4+2+2+1+1+1+1 packs to exactly 16 with no hole.
struct DwellSlot {
    uint32_t since_s = 0;   // seconds the current state has stood, as far as this board can tell
    uint32_t blind_s = 0;   // of those, how many were NOT observed (bus quiet, page refused)
    uint16_t gap_s   = 0;   // the CURRENT unbroken blind run; reset by any observation, saturating
    int16_t  conv    = 0;
    uint8_t  reg     = 0;
    uint8_t  off     = 0;
    uint8_t  code    = DWELL_CODE_NONE;
    uint8_t  flags   = 0;
};
static_assert(sizeof(DwellSlot) == 16, "slot layout grew — re-check the .noinit budget");

// Saturating adds. A wrap would turn a long run into a fresh one, which reads exactly like a state
// change that never happened — the one failure mode this header exists to avoid, arriving through
// arithmetic instead of through the bus.
inline uint32_t dwell_add_u32(uint32_t a, uint32_t b) {
    return (a > UINT32_MAX - b) ? UINT32_MAX : static_cast<uint32_t>(a + b);
}
inline uint16_t dwell_add_u16(uint16_t a, uint32_t b) {
    const uint32_t v = static_cast<uint32_t>(a) + b;
    return v > UINT16_MAX ? UINT16_MAX : static_cast<uint16_t>(v);
}

// What a consumer gets back. `known` false means "this board has nothing to say about that row",
// which is a first-class answer here: an unconfigured bus, a page that stopped answering, a row this
// profile does not carry and a row whose state cannot be decoded all land on it, and none of them
// may render as a duration.
struct DwellReading {
    bool     known   = false;
    bool     exact   = false;
    uint32_t since_s = 0;
    uint32_t blind_s = 0;
};

inline int dwell_find(const DwellSlot* slots, size_t n, uint8_t reg, uint8_t off, int conv) {
    for (size_t i = 0; i < n; i++)
        if ((slots[i].flags & DWELL_F_USED) && slots[i].reg == reg && slots[i].off == off &&
            slots[i].conv == static_cast<int16_t>(conv))
            return static_cast<int>(i);
    return -1;
}

inline DwellReading dwell_lookup(const DwellSlot* slots, size_t n, uint8_t reg, uint8_t off,
                                 int conv) {
    DwellReading r;
    const int i = dwell_find(slots, n, reg, off, conv);
    if (i < 0) return r;
    const DwellSlot& s = slots[static_cast<size_t>(i)];
    if (s.flags & DWELL_F_STALE) return r;   // unread too long — say nothing, not "unchanged"
    r.known   = true;
    r.exact   = (s.flags & DWELL_F_EXACT) != 0;
    r.since_s = s.since_s;
    r.blind_s = s.blind_s;
    return r;
}

// ── The step ────────────────────────────────────────────────────────────────────────────────────
// One poll cycle. `dt_s` is the elapsed seconds since the previous call; the caller derives it from
// the monotonic clock, so an SNTP jump mid-boot cannot move a dwell.
//
// The three outcomes per slot, and why each is what it is:
//
//   OBSERVED, SAME STATE   -> the run grows. This is the only branch that adds OBSERVED seconds.
//   OBSERVED, NEW STATE    -> the run restarts, and the transition was WITNESSED, so `exact` is set.
//                             Any blind time that preceded it belonged to the OLD run and dies with
//                             it: the new state's clock starts now.
//   NOT OBSERVED           -> the run grows AND `blind_s` grows with it. The wall clock does not stop
//                             because the bus went quiet, but the OBSERVATION did, and reporting one
//                             without the other is the lie. Past DWELL_MAX_GAP_S the slot goes stale
//                             and stops claiming anything at all.
//
// A slot seen for the first time starts NOT exact: it is a run this board joined in progress, and
// only a witnessed transition can upgrade it.
inline void dwell_step(DwellSlot* slots, size_t n, const DwellObservation* obs, size_t obs_n,
                       uint32_t dt_s) {
    // CONTINUITY FIRST — checkup_step()'s other half, and it has to travel with the absolute-instant
    // quantisation rather than being left behind with it. That function gates the whole computation
    // on `gap_us <= CHECKUP_MAX_GAP_S` and DISCARDS the previous state past it; taking only the
    // quantisation leaves this rule enforced solely in the unseen loop below, i.e. only for rows
    // that were missing. A row PRESENT at both ends of a stall — the poll task starved through an
    // OTA install, a cycle dropped by poll_task's bad_alloc guard — was equally unwatched in
    // between, and the observed branch would book the entire stall as time somebody watched. The
    // whole feature is the difference between elapsed and observed, so the bound must apply to the
    // CLOCK, not only to the rows. Marked stale here and adjudicated by the ordinary paths below:
    // an observed slot restarts as a fresh lower-bound run, an unobserved one goes on saying
    // nothing.
    // Booked exactly as the unseen loop below would have booked it, one slot at a time, because that
    // is what the elapsed time WAS for every row alike: unobserved. Advancing gap_s is the
    // load-bearing half — `witnessed` reads it, so a slot left at gap_s == 0 would have its next
    // transition called exact on the strength of an observation from before the stall.
    if (dt_s > DWELL_MAX_GAP_S)
        for (size_t k = 0; k < n; k++) {
            DwellSlot& s = slots[k];
            if (!(s.flags & DWELL_F_USED) || (s.flags & DWELL_F_STALE)) continue;
            s.gap_s   = dwell_add_u16(s.gap_s, dt_s);
            s.since_s = dwell_add_u32(s.since_s, dt_s);
            s.blind_s = dwell_add_u32(s.blind_s, dt_s);
            s.flags  |= DWELL_F_STALE;   // the unseen loop then skips it, so nothing double-counts
        }

    uint64_t seen = 0;
    for (size_t o = 0; o < obs_n; o++) {
        const DwellObservation& ob = obs[o];
        if (ob.code == DWELL_CODE_NONE || !dwell_tracked(ob.conv)) continue;
        int i = dwell_find(slots, n, ob.reg, ob.off, ob.conv);
        if (i < 0) {
            // Allocate. A full table drops the row rather than evicting a live one — the catalog
            // sweep is what keeps this unreachable, and silently replacing somebody else's run
            // would be worse than admitting one row has no dwell.
            for (size_t k = 0; k < n && i < 0; k++)
                if (!(slots[k].flags & DWELL_F_USED)) i = static_cast<int>(k);
            if (i < 0) continue;
            DwellSlot& s = slots[static_cast<size_t>(i)];
            s = DwellSlot{};
            s.reg = ob.reg; s.off = ob.off; s.conv = ob.conv;
            s.code = ob.code;
            s.flags = DWELL_F_USED;          // deliberately NOT exact — joined in progress
        } else {
            DwellSlot& s = slots[static_cast<size_t>(i)];
            const bool was_stale = (s.flags & DWELL_F_STALE) != 0;
            if (was_stale || s.code != ob.code) {
                // WITNESSED means the previous state was seen in the IMMEDIATELY PRECEDING cycle, so
                // the transition is located to within one poll period. Any blind time at all breaks
                // that: the change happened somewhere inside the gap, and calling it exact would
                // publish "OFF for 0 s" — a precise-looking claim about an instant nobody observed —
                // for a flag that may have switched a minute ago. The gap need not be long enough to
                // have gone stale for this to be wrong, which is why the test is `gap_s == 0` and
                // not `!was_stale`. Reported as a lower bound instead, which is exactly true and
                // self-corrects: every observed second afterwards raises the floor.
                const bool witnessed = (s.gap_s == 0);
                s.since_s = 0;
                s.blind_s = 0;
                s.code    = ob.code;
                s.flags   = static_cast<uint8_t>(DWELL_F_USED | (witnessed ? DWELL_F_EXACT : 0));
            } else {
                s.since_s = dwell_add_u32(s.since_s, dt_s);
            }
            s.gap_s = 0;
        }
        seen |= (uint64_t{1} << static_cast<unsigned>(i));
    }

    for (size_t k = 0; k < n; k++) {
        DwellSlot& s = slots[k];
        if (!(s.flags & DWELL_F_USED)) continue;
        if (seen & (uint64_t{1} << static_cast<unsigned>(k))) continue;
        if (s.flags & DWELL_F_STALE) continue;       // already saying nothing; nothing to add
        s.gap_s   = dwell_add_u16(s.gap_s, dt_s);
        s.since_s = dwell_add_u32(s.since_s, dt_s);
        s.blind_s = dwell_add_u32(s.blind_s, dt_s);
        if (s.gap_s > DWELL_MAX_GAP_S) s.flags |= DWELL_F_STALE;
    }
}

// ── Persistence ─────────────────────────────────────────────────────────────────────────────────
// Same machinery, same reasoning and the same seal as logic/checkup_persist.hpp: a magic, a version,
// a fingerprint over what a stored byte MEANS, a reset-reason allowlist and a named verdict for
// every way the answer can be no. .noinit DRAM only — a power cycle starts over and says so.
//
// The restore needs no clock, and that is a property of the medium rather than an assumption:
// history_persist.hpp's argument transfers exactly — if the bytes survived, power was never lost, so
// the downtime is a reset of about a second. The slots are adopted in place. What the reboot DID
// cost is one unobserved window, so DWELL_REBOOT_BLIND_S is booked against every adopted run rather
// than pretending the gap was watched. It is deliberately a small CONSTANT and not a measurement:
// the device cannot time its own downtime, and a fabricated duration is the one thing
// logic/timestamp.hpp already refuses to produce for an unsynced clock.
inline constexpr uint32_t DWELL_PERSIST_MAGIC   = 0x4c4c5744u;   // "DWLL" little-endian
inline constexpr uint16_t DWELL_PERSIST_VERSION = 1;
inline constexpr uint32_t DWELL_REBOOT_BLIND_S  = 5;

enum class DwellRestore : uint8_t {
    Accept,
    NoRecord,       // magic absent — a fresh board, or DRAM that was never written
    PowerCycle,     // the reset reason does not preserve RAM
    WrongVersion,   // this build's record layout differs
    WrongCatalog,   // the tracked-row rule or the slot layout moved
    BadCrc,         // present and current, but not intact
    ModelChanged,   // adopted at boot, then detection resolved a DIFFERENT unit
    SafeMode,       // latched boot-loop recovery: no poll task, so nothing would ever age these
};

inline constexpr const char* dwell_restore_slug(DwellRestore r) {
    switch (r) {
        case DwellRestore::Accept:       return "accept";
        case DwellRestore::NoRecord:     return "no_record";
        case DwellRestore::PowerCycle:   return "power_cycle";
        case DwellRestore::WrongVersion: return "wrong_version";
        case DwellRestore::WrongCatalog: return "wrong_catalog";
        case DwellRestore::BadCrc:       return "bad_crc";
        case DwellRestore::ModelChanged: return "model_changed";
        case DwellRestore::SafeMode:     return "safe_mode";
    }
    return "unknown";
}

// Order is the cheapest and most explanatory refusal first, for checkup_persist.hpp's reason: a
// power-cycled board holds garbage that would usually fail the CRC too, and reporting "bad_crc" for
// it sends a reader looking for a memory fault that is not there.
//
// SAFE MODE refuses outright and is not about the bytes at all. Safe mode never starts the poll
// task, so nothing would age these slots: an adopted table would sit frozen at its pre-reboot
// content and go on reporting "OFF for 3 h" for as long as the latch holds — evidence outliving the
// source that produced it, which is exactly what checkup_persist.hpp refuses for the same reason.
inline constexpr DwellRestore dwell_restore_verdict(uint32_t reset_reason, uint32_t magic,
                                                    uint16_t version, uint32_t catalog_fp,
                                                    uint32_t want_catalog_fp, uint32_t stored_crc,
                                                    uint32_t actual_crc, bool safe_mode = false) {
    if (safe_mode)                                  return DwellRestore::SafeMode;
    if (!history_reset_preserves_ram(reset_reason)) return DwellRestore::PowerCycle;
    if (magic != DWELL_PERSIST_MAGIC)               return DwellRestore::NoRecord;
    if (version != DWELL_PERSIST_VERSION)           return DwellRestore::WrongVersion;
    if (catalog_fp != want_catalog_fp)              return DwellRestore::WrongCatalog;
    if (stored_crc != actual_crc)                   return DwellRestore::BadCrc;
    return DwellRestore::Accept;
}

inline uint32_t dwell_fp_u32(uint32_t crc, uint32_t v) {
    const uint8_t b[4] = {static_cast<uint8_t>(v), static_cast<uint8_t>(v >> 8),
                          static_cast<uint8_t>(v >> 16), static_cast<uint8_t>(v >> 24)};
    return config_crc32_update(crc, b, sizeof(b));
}

// Everything that decides what a stored slot MEANS. A slot is an anonymous pair of counters plus a
// code, so a build that changed which converters are tracked, what a code stands for, or the gap
// rule would hand the previous build's seconds to a slot that now means something else by them — a
// valid CRC over bytes whose meaning quietly moved. Derived rather than a hand-maintained version
// byte, precisely so nobody can forget to bump it.
//
// The tracked set is addressed by a PREDICATE rather than a table, so the fingerprint asks it the
// same question the recorder does, over the converter space it answers for.
inline uint32_t dwell_catalog_fingerprint() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = dwell_fp_u32(crc, static_cast<uint32_t>(sizeof(DwellSlot)));
    crc = dwell_fp_u32(crc, static_cast<uint32_t>(DWELL_MAX_SLOTS));
    crc = dwell_fp_u32(crc, DWELL_MAX_GAP_S);
    crc = dwell_fp_u32(crc, DWELL_REBOOT_BLIND_S);
    for (int conv = 0; conv <= 512; conv++)
        if (dwell_tracked(conv)) crc = dwell_fp_u32(crc, static_cast<uint32_t>(conv));
    // The code mapping is part of the meaning: a build that renumbered the fault classes would read
    // the previous one's stored code as a different state and book a change that never happened.
    crc = dwell_fp_u32(crc, static_cast<uint32_t>(FAULT_CLASS_COUNT));
    return config_crc32_final(crc);
}

// Adopting a table across a reset. The slots are taken in place; what cannot be taken in place is
// the claim that the reboot window was watched, so it is booked as blind on every live run. A stale
// slot is left stale — it was already saying nothing and a reboot is not evidence that it should
// start.
inline void dwell_adopt(DwellSlot* slots, size_t n) {
    for (size_t i = 0; i < n; i++) {
        DwellSlot& s = slots[i];
        if (!(s.flags & DWELL_F_USED) || (s.flags & DWELL_F_STALE)) continue;
        s.since_s = dwell_add_u32(s.since_s, DWELL_REBOOT_BLIND_S);
        s.blind_s = dwell_add_u32(s.blind_s, DWELL_REBOOT_BLIND_S);
        // ACCUMULATE, never assign: a slot that was already mid-gap when the board went down has
        // been unread for its own gap PLUS the reboot, and resetting the counter here would hand it
        // a fresh DWELL_MAX_GAP_S on the other side — a run vouched for across nearly twice the
        // continuity bound the rule states.
        s.gap_s   = dwell_add_u16(s.gap_s, DWELL_REBOOT_BLIND_S);
        if (s.gap_s > DWELL_MAX_GAP_S) s.flags |= DWELL_F_STALE;
    }
}

} // namespace daik::logic
