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
// ── Why a trend needs a PAGE, not just a label ──────────────────────────────────────────────────
// "(R1T)" names two unrelated sensors in this catalog: the OUTDOOR unit's air-inlet sensor
// ("R1T-Outdoor air temp.", page 0x20) and the INDOOR unit's leaving-water sensor, which
// lwt_select.hpp keys on by that very tag. A label token alone would let an outdoor-air trend
// resolve to leaving water on a profile that spells the row differently — the #35-#39 shape, drawn
// as a 24-hour chart. Each trend therefore states the page CLASS its row must sit on, and the
// catalog test asserts the two never cross.
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
// This is the ONE place the outdoor-air trend differs in kind from the DHW-tank trend, and it is
// why the second trend is not simply "the same thing with another label": the tank sits on a
// hydronic page that is resampled every cycle, so its buffer fills continuously.
#include <cstddef>
#include <cstdint>
#include <cstdlib>

#include "logic/lwt_select.hpp"   // lwt_ci_contains — one substring matcher for both pickers
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

// ── Which page class a trended row must sit on ──────────────────────────────────────────────────
enum class TrendPage : unsigned char {
    Hydronic,   // resampled every cycle — the buffer fills continuously
    Outdoor,    // 0x20/0x21: frozen while the compressor rests, so samples are gated (see below)
};

constexpr bool trend_page_matches(TrendPage want, unsigned reg) {
    return want == TrendPage::Outdoor ? ou_page_holds_over(reg) : !ou_page_holds_over(reg);
}

// ── The trend catalog ───────────────────────────────────────────────────────────────────────────
// `id` is the stable wire name (GET /history?row=<id>, and the /status.history entry). It is NOT the
// display label: labels differ per profile and would make a bookmarked/scripted request model-
// specific, while the id is the concept.
struct TrendDef {
    const char* id;
    const char* token;      // lowercase label token identifying the concept (with `page`, uniquely)
    TrendPage   page;
};

// Adding a trend is one row here. Keep every entry's row on a page the catalog test can confirm,
// and never trend a SETPOINT — a target is not a measurement (issue #121's rule, applied to trends).
inline constexpr TrendDef TRENDS[] = {
    { "dhw_tank",    "dhw tank",    TrendPage::Hydronic },
    { "outdoor_air", "outdoor air", TrendPage::Outdoor  },
};
constexpr size_t TREND_COUNT = sizeof(TRENDS) / sizeof(TRENDS[0]);
static_assert(TREND_COUNT * HISTORY_BYTES_PER_TREND <= 4096,
              "trend buffers are .bss on a heap-tight board — justify the growth before raising this");

// A trended row is a MEASUREMENT: a setpoint that happens to carry the token must never win. The
// tank's own target ("DHW setpoint") does not contain "dhw tank", but a future generated label like
// "DHW tank setpoint" would — and would draw a flat 48 °C line that looks exactly like a healthy,
// perfectly-held tank.
inline bool trend_is_measurement(const char* label) {
    return label && !lwt_ci_contains(label, "setpoint") && !lwt_ci_contains(label, "set point");
}

inline bool trend_row_matches(const TrendDef& d, const char* label, unsigned reg) {
    return trend_is_measurement(label) && lwt_ci_contains(label, d.token) &&
           trend_page_matches(d.page, reg);
}

// Index of the row a trend should buffer, or -1 when this profile carries no such row (the UI then
// offers no trend for it — an absent feature, stated by omission rather than an empty chart).
inline int trend_select(const TrendDef& d, const char* const* labels, const unsigned* regs, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (trend_row_matches(d, labels[i], regs[i])) return static_cast<int>(i);
    return -1;
}

// Look a trend up by its wire id (GET /history?row=…). Returns nullptr for an unknown id — the
// route answers 404 rather than defaulting to a trend the caller did not ask for.
inline const TrendDef* trend_by_id(const char* id) {
    if (!id) return nullptr;
    for (const auto& d : TRENDS) {
        const char* a = d.id;
        const char* b = id;
        while (*a && *a == *b) { ++a; ++b; }
        if (!*a && !*b) return &d;
    }
    return nullptr;
}

// The compressor witness — "INV frequency (rps)" — which is what makes a held-over page decidable
// at all. It MUST sit on a page that stays live, or the run state would be derived from the same
// frozen bytes it is meant to qualify; ou_stale's catalog test already pins that across the whole
// catalog, and the page condition here is the belt to that braces. -1 means the profile carries no
// witness, which is UNKNOWN and NOT stopped — history_store then keeps storing readings, because a
// unit we cannot ask about is not a unit we may declare asleep.
inline int trend_rps_row(const char* const* labels, const unsigned* regs, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (labels[i] && lwt_ci_contains(labels[i], "inv frequency") && !ou_page_holds_over(regs[i]))
            return static_cast<int>(i);
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
// Returns false for an empty value (the cycle produced nothing) and for a non-numeric one. That
// second case is load-bearing: a bit-flag row publishes "ON"/"OFF", and strtof would read "ON" as
// 0 and quietly draw a 0.0 °C line. Values that would collide with the two absence sentinels are
// refused too — a real -3276.7 would otherwise be stored as "no reading".
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
