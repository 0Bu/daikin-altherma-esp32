#pragma once
// The 24-hour trend buffers: WHICH readings get one, and when a stored sample is a MEASUREMENT
// rather than a repeat of one.
//
// The firmware keeps a fixed-cadence ring per trended row and serves it from GET /history; the web
// UI draws it under a value row's explainer. Everything that decides *what* is trended and *whether
// a sample counts* lives here rather than at the call site, for the same reason lwt_select.hpp and
// ou_stale.hpp do: the rule runs against the generated def/ profile tables, which are C++, so the
// CI logic-test can gate it against the whole catalog instead of one profile someone happened to
// own. Adding a trend is one row in TRENDS below — the ring, the route and the browser are already
// generic over it.
//
// ── Why a trend is a LOCATOR and not a label ────────────────────────────────────────────────────
// A trend names the row it buffers by (register page, byte offset, unit) — never by its text. The
// catalog spells one quantity many ways and the same way for many quantities, so a label token
// cannot address a row:
//
//   * "(R1T)" names two unrelated sensors — the OUTDOOR unit's air inlet ("R1T-Outdoor air temp.",
//     page 0x20) and the INDOOR leaving-water sensor lwt_select.hpp keys on by that very tag.
//   * The leaving-water row itself comes in four spellings, one of them with a DOUBLE space
//     ("[HPSU] Tv inflow Temp  (R1T)").
//   * The suction-side pressure is called just "Pressure" on 13 profiles — and "Pressure" on page
//     0xA0 is a different quantity on a second outdoor unit.
//   * At 0x20/12 the SAME offset carries "High Pressure" (bar, conv 105) and "High Pressure(T)"
//     (the saturation temperature, conv 405). A token match takes whichever sorts first, so half
//     the catalog would draw °C into a chart whose axis says bar — the #35-#39 shape, with a
//     24-hour history in front of it to make it look verified.
//
// The unit is the second half of the locator precisely because of that last case: (reg, offset)
// alone is ambiguous where a value and its derived twin share a byte window. Measured over the 39
// detection profiles, (reg, offset, unit) resolves to exactly ONE row on every one of them, and the
// catalog test asserts that rather than assuming it.
//
// Two rules that used to be conditions are now consequences of addressing a row this way, and are
// asserted in the catalog test instead of re-checked per sample: a trend can no longer resolve to a
// SETPOINT (targets live at other offsets — 0x60/7, 0x62/5 — never at a measurement's), and the
// held-over page class is the locator's own `reg`, not a separate field that could disagree with it.
//
// ── Why a stored sample can be absent ───────────────────────────────────────────────────────────
// Two different things make a slot empty, and conflating them would misattribute one to the other:
//
//   NoReading — the register timed out, or hp_convert's reading_plausible() refused the value.
//               Something failed to measure.
//   HeldOver  — the outdoor unit was asleep (ou_stale.hpp): pages 0x20/0x21 keep ANSWERING with the
//               last run's numbers while the compressor is off. Nothing failed; the unit simply was
//               not measuring. Storing what the bus returned would fill a summer day's outdoor-air
//               trend with a staircase of last-run values that is indistinguishable from weather.
//               Measured on a live unit: outdoor air read exactly 19.0 °C for five hours, then
//               stepped 19.0 → 25.5 the instant the compressor started.
//
// This is the ONE way the outdoor-air trend differs in kind from the hydronic ones, and it is why
// it is not simply "the same thing on another page": the hydronic rows are resampled every cycle,
// so their buffers fill continuously, while every outdoor sample has to pass the gate above.
#include <cstddef>
#include <cstdint>
#include <cstdlib>

#include "logic/lwt_select.hpp"   // lwt_ci_contains — the compressor witness still matches by label
#include "logic/ou_stale.hpp"     // ou_reading_held_over — the held-over rule, composed not copied

namespace daik::logic {

// ── Ring geometry ───────────────────────────────────────────────────────────────────────────────
// One sample per HISTORY_DT_S, HISTORY_SAMPLES deep. 5 minutes is chosen against the SIGNAL, not
// against the memory: a DHW charge cycle runs 30-60 minutes and a compressor run likewise, so a
// 5-minute raster resolves every feature either curve has. The cost is the reason it can be spent
// freely — see HISTORY_BYTES_PER_TREND.
constexpr unsigned HISTORY_DT_S    = 300;
constexpr unsigned HISTORY_SAMPLES = 288;                       // 288 x 300 s = 24 h exactly

// Stored as tenths of the unit (deci-°C), which is the resolution the X10A converters produce —
// so a sample is exact, not rounded on the way in. int16 spans -3276.8 .. 3276.7.
using HistorySample = int16_t;
constexpr HistorySample HISTORY_NO_READING = INT16_MIN;         // measured nothing
constexpr HistorySample HISTORY_HELD_OVER  = INT16_MIN + 1;     // unit asleep — see the header note

constexpr bool history_is_absent(HistorySample s) {
    return s == HISTORY_NO_READING || s == HISTORY_HELD_OVER;
}

// The whole point of the memory analysis, stated where a future trend addition will see it: one
// trend costs 576 bytes. Put the buffers in .bss, never on the heap — free heap is not the binding
// limit on this board, the largest CONTIGUOUS block is, and a static array does not compete for it.
constexpr size_t HISTORY_BYTES_PER_TREND = HISTORY_SAMPLES * sizeof(HistorySample);
static_assert(HISTORY_BYTES_PER_TREND == 576, "trend cost changed — re-check the memory budget");

// Byte-for-byte C-string equality, constexpr and dependency-free (this header is IDF-free and the
// host tests build it standalone). Both the id lookup and the unit half of the locator use it.
constexpr bool trend_cstr_eq(const char* a, const char* b) {
    if (!a || !b) return false;
    while (*a && *a == *b) { ++a; ++b; }
    return *a == *b;
}

// ── The trend catalog ───────────────────────────────────────────────────────────────────────────
// `id` is the stable wire name (GET /history?row=<id>, and the /status.history entry). It is NOT the
// display label: labels differ per profile and would make a bookmarked/scripted request model-
// specific, while the id is the concept.
//
// Two kinds of trend, in one table and one id space so the ring array, the route and the browser
// stay generic over all of them. A Row trend is a decoded X10A reading found by the locator; a BOARD
// trend is the ESP32's own memory, which has no register, no profile and no held-over state — it is
// sampled directly by the recorder on the same cadence.
enum class TrendKind : uint8_t {
    Row,        // a decoded value from the poll cache, addressed by (reg, off, unit)
    FreeHeap,   // esp_get_free_heap_size()
    MaxAlloc,   // largest CONTIGUOUS free block — the real OOM ceiling on this board
};

// `reg`/`off`/`unit` are the LOCATOR for a Row (see the header note). `unit` is the string the poll
// cache carries for the row — convert.hpp's unit_for_datatype(): "°C", "bar", "A", or "" for a row
// whose unit lives in its label ("Flow sensor (l/min)"). It is spelled out here rather than taken as
// a type code so this header stays free of convert.hpp; the catalog test checks the two agree.
//
// `label` is EMPTY for a Row — which profile row it resolved to is discovered at runtime, and its
// label is how the browser attaches the series to the value row it is already drawing. A board trend
// has no profile to ask, so it carries its own fixed English label (like every catalog label, and
// for the same reason: /status and /history are read by scripts as well as by this UI).
struct TrendDef {
    const char* id;
    TrendKind   kind;
    uint8_t     reg;
    uint8_t     off;
    const char* unit;
    const char* label;
};

// Adding a trend is one row here — the ring, the route and the browser are already generic over it.
// Take the (reg, offset, unit) from docs/REGISTERS.md §5 / the generated def/ tables, and add the
// row's measured coverage to the catalog test: a locator that resolves on no profile is a trend
// nobody will ever see, and the test is where that becomes a failure rather than a mystery.
inline constexpr TrendDef TRENDS[] = {
    // Pages that are resampled every cycle, so these buffers fill continuously. Grouped by that,
    // not by circuit: 0x62/15 is a REFRIGERANT reading that happens to live on a hydronic page.
    { "dhw_tank",         TrendKind::Row, 0x61, 10, "°C",  "" },  // DHW tank temp. (R5T)
    { "leaving_water",    TrendKind::Row, 0x61,  2, "°C",  "" },  // pre-BUH outlet — lwt_select's row
    { "return_water",     TrendKind::Row, 0x61,  8, "°C",  "" },  // Inlet water temp. (R4T)
    { "water_pressure",   TrendKind::Row, 0x62, 11, "bar", "" },  // the WATER circuit, not refrigerant
    { "flow",             TrendKind::Row, 0x62,  9, "",    "" },  // Flow sensor (l/min) — unit in label
    { "pump_signal",      TrendKind::Row, 0x62, 12, "",    "" },  // INVERTED (0 = max, 100 = stop)
    // The high-side refrigerant pressure the UI actually draws. NOT the 0x20/12+14 transducers: the
    // pill already falls back off them (they freeze with their page), and on the measured unit they
    // read exactly 0.0 bar at rest AND at 42 rps — which reading_plausible() refuses as impossible
    // for a sealed circuit — while this sensor read a correct 15.3 bar. A ring on them would be a
    // permanently empty chart bought with 576 bytes.
    { "circuit_pressure", TrendKind::Row, 0x62, 15, "bar", "" },
    { "comp_rps",         TrendKind::Row, 0x30,  0, "",    "" },  // INV frequency (rps) — run/idle
    // Outdoor — 0x20/0x21 freeze while the compressor rests, so every sample passes the held-over
    // gate below and the chart shows gaps rather than a staircase of the last run's numbers.
    { "outdoor_air",      TrendKind::Row, 0x20,  0, "°C",  "" },  // R1T-Outdoor air temp.
    // The BOARD's own memory. Not a plant reading, and here for the reason the single numbers on
    // /status could never answer: whether the heap is DRIFTING. A leak or a creeping fragmentation
    // shows as a slope over hours and is invisible in any one sample, which is why the spot figures
    // were dropped from the UI once (#186) — a diagnosis nobody could make from what was shown.
    // Both are in KiB: bytes would overflow the int16 ring at 32.8 kB of heap.
    { "free_heap",        TrendKind::FreeHeap, 0, 0, "KiB", "Free heap" },
    { "max_alloc",        TrendKind::MaxAlloc, 0, 0, "KiB", "Largest free block" },
};
constexpr size_t TREND_COUNT = sizeof(TRENDS) / sizeof(TRENDS[0]);
// 11 trends = 6336 bytes of ring (plus ~78 bytes of label/unit/counters each in history.cpp). The
// ceiling is a deliberate stop sign, not a hardware limit: .bss does not compete for the largest
// CONTIGUOUS free block, which is what actually binds on this board, so the cost of a trend is a
// few per cent of free heap and nothing at all of the fragmentation budget. Raise it only with the
// same arithmetic in hand, and measure /status.sys (free_heap, max_alloc) on a real board after —
// which is now a thing the device itself will draw you a curve of.
static_assert(TREND_COUNT * HISTORY_BYTES_PER_TREND <= 7168,
              "trend buffers are .bss on a heap-tight board — justify the growth before raising this");

// A board metric in bytes, as the ring stores it: tenths of a KiB (~102-byte resolution, finer than
// anything worth reading off a 24-hour chart). CLAMPED, never wrapped: the ring is int16, so this
// tops out at 3276.7 KiB — above every internal-RAM figure this chip can report (512 KiB of SRAM),
// but NOT above a PSRAM build's heap. A clamped sample is a ceiling and reads as one (a flat line at
// the top); a wrapped one would be a plausible small number, which is the failure this whole file is
// written against. If CONFIG_SPIRAM is ever enabled, revisit the unit here rather than the clamp.
constexpr HistorySample history_bytes_tenths_kib(uint32_t bytes) {
    const uint64_t tenths = (static_cast<uint64_t>(bytes) * 10u + 512u) / 1024u;   // 64-bit: *10 of
    return tenths > static_cast<uint64_t>(INT16_MAX) ? INT16_MAX                   // a uint32 wraps
                                                     : static_cast<HistorySample>(tenths);
}

// Does this cached row carry the value a trend addresses? Three exact comparisons, no matching and
// no heuristics: whatever the profile calls the row, the byte window and the unit are the value's
// identity. A profile that does not carry the row yields no match at all (see trend_select).
// A BOARD trend matches nothing here — it is not looking for a row, and a locator of (0, 0) must
// never be allowed to collide with one.
constexpr bool trend_row_matches(const TrendDef& d, unsigned reg, unsigned off, const char* unit) {
    return d.kind == TrendKind::Row && reg == d.reg && off == d.off && trend_cstr_eq(unit, d.unit);
}

// Index of the row a trend should buffer, or -1 when this profile carries no such row (the UI then
// offers no trend for it — an absent feature, stated by omission rather than an empty chart).
//
// The page/offset views are uint8_t because that is what they ARE (ValueDef and CachedValue both
// store them as one byte), and because the caller builds these views on the POLL TASK's 8 KB stack:
// as `unsigned` the two arrays alone would cost 2 KB of it per cycle, a quarter of the task, for
// two values that never exceed 255. The stack is the budget that fails silently here (CLAUDE.md →
// Memory constraints, the v1.0.12 overflow), so it is spent by the byte.
inline int trend_select(const TrendDef& d, const uint8_t* regs, const uint8_t* offs,
                        const char* const* units, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (trend_row_matches(d, regs[i], offs[i], units[i])) return static_cast<int>(i);
    return -1;
}

// Look a trend up by its wire id (GET /history?row=…). Returns nullptr for an unknown id — the
// route answers 404 rather than defaulting to a trend the caller did not ask for.
inline const TrendDef* trend_by_id(const char* id) {
    if (!id) return nullptr;
    for (const auto& d : TRENDS)
        if (trend_cstr_eq(d.id, id)) return &d;
    return nullptr;
}

// The compressor witness — "INV frequency (rps)" — which is what makes a held-over page decidable
// at all. It MUST sit on a page that stays live, or the run state would be derived from the same
// frozen bytes it is meant to qualify; ou_stale's catalog test already pins that across the whole
// catalog, and the page condition here is the belt to that braces. -1 means the profile carries no
// witness, which is UNKNOWN and NOT stopped — history_store then keeps storing readings, because a
// unit we cannot ask about is not a unit we may declare asleep.
inline int trend_rps_row(const char* const* labels, const uint8_t* regs, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (ou_is_rps_witness(labels[i], regs[i])) return static_cast<int>(i);
    return -1;
}

// Which 5-minute bucket a monotonic uptime falls in. The ring advances on the MONOTONIC clock, never
// on the wall clock: SNTP sets the time abruptly (and only once a route to the server exists), so a
// wall-clock bucket would jump the ring by years on the first sync of every boot. The absolute
// timestamps the UI shows are derived at SERVE time instead (see the /history route).
constexpr uint32_t history_bucket(int64_t uptime_us) {
    return static_cast<uint32_t>(uptime_us / (static_cast<int64_t>(HISTORY_DT_S) * 1000000));
}

// How many buckets went by with no poll cycle at all, between the bucket that was open (`prev`) and
// the one we are now in (`now`). Pure because it is an off-by-one with no visible symptom: get it
// wrong by one and every earlier sample sits one bucket off on the time axis, which no test of the
// ring itself would catch and no reader could see. Adjacent buckets skip NOTHING (the common case,
// once per HISTORY_DT_S). A `now` that is not ahead of `prev` yields 0 — esp_timer's clock is
// monotonic so it cannot happen, but returning a huge unsigned wrap-around here would blank the
// whole ring on the one cycle it did.
constexpr uint32_t history_skipped(uint32_t prev, uint32_t now) {
    return now > prev ? now - prev - 1 : 0;
}

// The wall-clock instant of sample 0, and the one property that matters about it: it must be
// INVARIANT to when the request arrived.
//
// The route first derived it as `now - (n-1)*dt`, which silently assumes the newest sample was taken
// *now*. It was not: the ring commits a bucket every HISTORY_DT_S, so between two commits the newest
// sample ages while `now` keeps moving — measured on a live unit, two fetches 70 s apart with an
// unchanged sample count reported t0 values exactly 70 s apart. Two consequences, and the second is
// the one that corrupts a reading rather than merely mislabelling it:
//
//   * Every timestamp shown was up to one bucket (5 min) late.
//   * A PINNED readout is anchored to an instant and re-resolved against a fresh t0. Once the drift
//     passes half a bucket, history_pin_index rounds to the NEIGHBOURING slot — so the bubble goes on
//     standing there while describing a different measurement than the one the user tapped. The
//     anchor was defeated by its own reference point.
//
// So the caller passes the AGE of the newest sample, measured on the monotonic clock (seconds since
// the last bucket commit), and the answer stops depending on request timing. Monotonic on purpose:
// the commit may well have happened before SNTP ever synced, so its wall-clock instant is not
// knowable — its age always is.
constexpr int64_t history_t0(int64_t now_unix, uint32_t newest_age_s, size_t n, uint32_t dt) {
    return now_unix - static_cast<int64_t>(newest_age_s)
                    - static_cast<int64_t>(n ? n - 1 : 0) * static_cast<int64_t>(dt);
}

// Which sample a PINNED readout refers to, after the ring may have rolled under it.
//
// The web UI lets a tap pin the crosshair so the value stays readable without holding a finger down.
// That pin must be anchored to the sample's WALL-CLOCK INSTANT, never to its index: the ring shifts
// one slot every HISTORY_DT_S, so an index-anchored pin would go on pointing at slot 42 while slot 42
// became a different measurement — a label silently re-pointed at another reading, which is the
// #35-#39 shape with a timestamp attached to make it look verified.
//
// Returns -1 when the pinned instant is no longer in the window: aged off the back as the day rolled,
// or ahead of the newest sample. The caller then DROPS the pin rather than clamping it to the nearest
// edge — clamping would keep a readout on screen while quietly changing which moment it describes,
// and "the value you pinned has scrolled out of the day" is honestly expressed by it going away.
//
// Pure here, with no firmware caller, for the same reason lwt_select.hpp and ou_stale.hpp are: the
// rule runs in the browser, but CI can only gate it as C++.
inline int history_pin_index(int64_t t0, uint32_t dt, size_t n, int64_t pinned) {
    if (!dt || !n) return -1;
    // Round to the nearest bucket rather than truncating: the pin was made FROM a rendered sample, so
    // it lands exactly on a boundary in the normal case, and a ±1 s clock adjustment between the pin
    // and the re-anchor must not shift the answer by a whole 5-minute slot.
    const int64_t rel = pinned - t0;
    const int64_t half = static_cast<int64_t>(dt) / 2;
    const int64_t i = (rel >= 0 ? (rel + half) : (rel - half)) / static_cast<int64_t>(dt);
    if (i < 0 || i >= static_cast<int64_t>(n)) return -1;
    return static_cast<int>(i);
}

// Run-length encode the HELD_OVER stretches of a snapshot into {from, count} pairs. The wire format
// keeps `v` a plain number-or-null array (any JSON consumer can read it) and carries the reason for
// the nulls alongside — a mixed-type array would make the common case harder to parse for the sake
// of the rare one. Returns the number of runs written; stops at `max` rather than overflowing.
inline size_t history_held_runs(const HistorySample* v, size_t n, uint16_t (*out)[2], size_t max) {
    size_t runs = 0;
    size_t i = 0;
    while (i < n) {
        if (v[i] != HISTORY_HELD_OVER) { ++i; continue; }
        size_t start = i;
        while (i < n && v[i] == HISTORY_HELD_OVER) ++i;
        if (runs >= max) break;
        out[runs][0] = static_cast<uint16_t>(start);
        out[runs][1] = static_cast<uint16_t>(i - start);
        ++runs;
    }
    return runs;
}

// Worst case: alternating held/measured samples. Sized for it so the encoder can never truncate a
// real series — 144 pairs is 576 bytes, the same as one trend's ring.
constexpr size_t HISTORY_MAX_RUNS = HISTORY_SAMPLES / 2 + 1;

// ── What to store this cycle ────────────────────────────────────────────────────────────────────
// `has_value` is what the decode path already decided (hp_format returned false for a timed-out
// register or a reading reading_plausible() refused). The held-over test composes ou_stale.hpp
// rather than restating it, so a change to which pages freeze reaches the trends automatically.
constexpr HistorySample history_store(bool has_value, int value_tenths, unsigned reg,
                                      bool rps_known, bool rps_running) {
    return ou_reading_held_over(reg, rps_known, rps_running) ? HISTORY_HELD_OVER
         : !has_value                                        ? HISTORY_NO_READING
         : static_cast<HistorySample>(value_tenths);
}

// A reading in tenths of its unit, parsed back from the FORMATTED string the poll cache holds.
// Parsing rather than reaching into the decode path is deliberate: the converters stay the single
// source of what a value means, so the domain audit keeps seeing them unchanged and a trend can
// never disagree with the number shown next to it. Locale is not a concern — hp_format writes a
// plain "%.1f" with '.' and the firmware runs the C locale.
//
// Returns false for an empty value (the cycle produced nothing) and for a non-numeric one. The
// second case rejects legacy/corrupt textual states that strtof would otherwise read as 0 and draw
// as a confident 0.0 line; current bit flags are numeric 1/0 upstream. Values that would collide
// with the two absence sentinels are refused too — a real -3276.7 would otherwise be stored as
// "no reading".
inline bool history_parse_tenths(const char* s, int& out) {
    if (!s || !*s) return false;
    char* end = nullptr;
    const double f = std::strtod(s, &end);
    if (end == s) return false;                       // no digits consumed: "ON", "OFF", "U4", …
    if (!(f > -1e6 && f < 1e6)) return false;         // also rejects NaN/inf (both fail the compare)
    const long t = static_cast<long>(f * 10.0 + (f < 0 ? -0.5 : 0.5));
    if (t <= static_cast<long>(HISTORY_HELD_OVER) || t > INT16_MAX) return false;
    out = static_cast<int>(t);
    return true;
}

// ── The ring itself ─────────────────────────────────────────────────────────────────────────────
// Here rather than in history.cpp because it IS logic — bucket folding, wrap-around ordering and
// skipped-bucket filling are exactly the kind of off-by-one that only shows up as a subtly wrong
// chart three weeks later, and a rule buried in a .cpp can only be verified on the device. Storage,
// the mutex and the string parsing stay in history.cpp; everything decidable is here.
struct TrendRing {
    HistorySample buf[HISTORY_SAMPLES] = {};
    uint16_t      count   = 0;                     // samples held (saturates at HISTORY_SAMPLES)
    uint16_t      head    = 0;                     // next write slot
    HistorySample pending = HISTORY_NO_READING;    // the bucket currently being folded

    void reset() { count = 0; head = 0; pending = HISTORY_NO_READING; }

    void push(HistorySample s) {
        buf[head] = s;
        head = static_cast<uint16_t>((head + 1) % HISTORY_SAMPLES);
        if (count < HISTORY_SAMPLES) count++;
    }

    // Fold one poll cycle into the open bucket. A real reading anywhere in the 5 minutes beats
    // absence, and a later reading beats an earlier one; absence survives only a bucket in which
    // nothing was measured at all, and then carries the LAST reason — the one still true at commit.
    void fold(HistorySample s) {
        if (!history_is_absent(s) || history_is_absent(pending)) pending = s;
    }

    // Close the open bucket and open the next. `skipped` is how many buckets went by with no cycle
    // at all (a sweep that blocked for minutes on a dead bus); they are filled with NO_READING so
    // the time axis stays LINEAR. Compressing them would slide every earlier sample forward in time
    // and mislabel the whole curve — a chart that is wrong about *when*, with nothing to show it.
    void commit(uint32_t skipped) {
        push(pending);
        for (uint32_t k = 0; k < skipped && k < HISTORY_SAMPLES; k++) push(HISTORY_NO_READING);
        pending = HISTORY_NO_READING;
    }

    // Copy out oldest-first. Until the ring wraps the oldest sample is slot 0; after that it is
    // `head` — the slot about to be overwritten is also the one holding the oldest sample.
    size_t snapshot(HistorySample* out, size_t max) const {
        const size_t n = count < max ? count : max;
        const size_t oldest = (count < HISTORY_SAMPLES) ? 0 : head;
        for (size_t i = 0; i < n; i++) out[i] = buf[(oldest + i) % HISTORY_SAMPLES];
        return n;
    }
};

} // namespace daik::logic
