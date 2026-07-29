#pragma once
// THE 24-HOUR PLANT HEALTH CHECKUP — is anything worth reporting, or is the plant in the green?
//
// The dashboard already answers "what is it doing right now" (the schematic) and "what did this one
// reading do today" (logic/history.hpp's trends). Neither answers the question a user actually asks
// once a month: *should I be doing something about this?* That answer is a small number of
// COUNTED EVENTS and WINDOW MINIMA — how often the compressor started, how much of its runtime went
// into defrosting, how low the water pressure got — none of which any single reading can express.
//
// Issue #208 asked for it. This header is the half that can be decided; main/checkup.cpp is the
// storage, and main/www/app.js is the card. What #208 asked for and this deliberately does NOT do is
// listed at the bottom of this comment — each omission is a claim the bus cannot support.
//
// NOT logic/health_gate.hpp, which shares only the word: that one decides whether a freshly-OTA'd
// FIRMWARE image is healthy enough to keep (WiFi up, no crash loop) before the rollback window
// closes. This one is about the PLANT.
//
// ── WHY THIS CANNOT BE DERIVED FROM THE 5-MINUTE TRENDS ─────────────────────────────────────────
// The obvious implementation is to read logic/history.hpp's rings back and count transitions in
// them. It does not work, and the way it fails is the worst possible one: TrendRing::fold() keeps
// the LAST reading of each 5-minute bucket, so a compressor cycle shorter than 5 minutes leaves no
// trace at all — that is, the short cycling this check exists to find is exactly what the 5-minute
// raster cannot see. A defrost runs 2-10 minutes and a backup-heater step can be seconds. All three
// are EVENTS, and an event has to be counted where it happens: in the poll cycle, at 1 Hz.
//
// So this keeps its own ring — 24 one-hour buckets, ~432 bytes in .bss — beside the trend rings
// rather than on top of them. It is a different question at a different rate, not a view of the
// same data.
//
// ── WHY A ROW IS ADDRESSED BY (reg, offset, CONVERTER) ──────────────────────────────────────────
// logic/history.hpp argues at length why a trend addresses its row structurally and never by label,
// and every word of it applies here. But its (reg, offset, unit) locator is NOT enough for these
// rows: `2way valve`, `3way valve`, `BSH`, `BUH Step1`, `BUH Step2`, `Water pump operation` and
// `Solar pump operation` all sit in the SAME byte — 0x60 offset 12 — and all SEVEN are
// dimensionless. They differ only in which bit their converter masks (307/306/305/304/303/301/300).
// A (reg, offset, unit) locator resolves to whichever of the seven sorts first, so the "backup
// heater ran 40 minutes" figure would in fact be the 2-way valve's position. That is the #35-#39
// shape with a day's statistics in front of it.
//
// The converter is therefore half the locator — the same structural key logic/availability.hpp and
// logic/conv_override.hpp already use, and for the same reason. The catalog test asserts that each
// locator resolves to EXACTLY ONE row on every profile that carries it.
//
// Two inputs are NOT locators, deliberately:
//   * the compressor witness composes ou_is_rps_witness() (logic/ou_stale.hpp) rather than naming a
//     locator of its own — one rule, one answer, and that header already pins its own catalog
//     conformance;
//   * the fault class and the protection-retry counters are matched by CONVERTER ALONE (203, and
//     310/311), because a profile carries them on BOTH the outdoor and the hydronic page and a
//     fault on either unit is a fault. A locator would have to pick one and would then miss the
//     other.
//
// ── WHAT IS NOT BUILT, AND WHY ──────────────────────────────────────────────────────────────────
//   * 3-WAY VALVE LEAKAGE from the DHW tank's cooling rate. Refused, not deferred. The rate is
//     dominated by things that are not the valve: measured on the reference installation, the tank
//     loses 0.30 K/h with the DHW circulation pump off and 1.20 K/h with it on — a healthy plant
//     with a circulation loop would be reported as a leaking valve every single day. A "valve:
//     sealed" verdict also asserts something a temperature slope cannot establish in either
//     direction.
//   * AN ABSOLUTE MINIMUM-FLOW THRESHOLD. The manufacturer's minimum is per model (the catalog spans
//     3 kW to 18 kW), and one number laid across 44 profiles would never fire on the large units and
//     always fire on the small ones. The unit raises 7H itself when flow is genuinely insufficient,
//     and that reaches the fault check below. The minimum is REPORTED; no verdict is attached to it.
//   * A DAILY START-COUNT THRESHOLD. 24 starts on a cold day is one per hour and healthy; 24 starts
//     in the shoulder season is cycling. A start count alone does not know the load. The MEAN RUN
//     LENGTH does — see CHECKUP_CYCLING_SHORT_RUN_S.
#include <cstddef>
#include <cstdint>

#include "fault_state.hpp"   // FaultClass — the fault check composes conv 203's own class table
#include "ou_stale.hpp"      // ou_is_rps_witness — the compressor witness, called not restated

namespace daik::logic {

// ── Window geometry ─────────────────────────────────────────────────────────────────────────────
// One bucket per hour, 24 deep. An hour is chosen against the QUESTION, not the memory: every figure
// here is a 24-hour aggregate, so the bucket only has to be fine enough that the window rolls
// smoothly. A 5-minute raster would cost 12x the storage to answer the same question no better.
constexpr unsigned CHECKUP_DT_S    = 3600;
constexpr unsigned CHECKUP_BUCKETS = 24;                 // 24 x 3600 s = 24 h exactly

// The longest gap between two poll samples that still counts as CONTINUOUS observation. Past it the
// firmware was not watching — a detect sweep on a silent bus, a wedged read, a reboot — and both the
// elapsed seconds and any state transition across the gap are discarded rather than guessed. Without
// this a five-minute bus outage would be booked as five minutes of whatever state preceded it, and
// a stop/start pair straddling it would be counted as a compressor start that may never have
// happened. The poll cadence is 1 s (POLL_INTERVAL_S), so 15 s is ~15 missed cycles.
constexpr uint32_t CHECKUP_MAX_GAP_S = 15;

// "no minimum recorded yet" for the two window minima. INT16_MIN rather than 0: a water pressure of
// 0.0 bar is a real (and alarming) reading, and conflating it with "never sampled" would either
// invent an alarm or hide one.
constexpr int CHECKUP_ABSENT = INT16_MIN;

// ── The row locators ────────────────────────────────────────────────────────────────────────────
struct CheckupLocator {
    uint8_t reg;
    uint8_t off;
    int     conv;
};

// Every one of these is measured against the shipped catalog in test_checkup()'s conformance sweep —
// coverage AND uniqueness. Note how many share (0x60, 12): the converter is what separates them, and
// dropping it from the key is the defect this header opens by describing.
inline constexpr CheckupLocator CHECKUP_LOC_DEFROST  = {0x10,  1, 304};  // "Defrost Operation"
inline constexpr CheckupLocator CHECKUP_LOC_BUH1     = {0x60, 12, 304};  // "BUH Step1"
inline constexpr CheckupLocator CHECKUP_LOC_BUH2     = {0x60, 12, 303};  // "BUH Step2"
inline constexpr CheckupLocator CHECKUP_LOC_BSH      = {0x60, 12, 305};  // "BSH" (DHW immersion heater)
inline constexpr CheckupLocator CHECKUP_LOC_PUMP     = {0x60, 12, 301};  // "Water pump operation"
inline constexpr CheckupLocator CHECKUP_LOC_PRESSURE = {0x62, 11, 105};  // "Water pressure" (bar)
inline constexpr CheckupLocator CHECKUP_LOC_FLOW     = {0x62,  9, 105};  // "Flow sensor (l/min)"
inline constexpr CheckupLocator CHECKUP_LOC_OUTDOOR  = {0x20,  0, 105};  // "R1T-Outdoor air temp."

// Does this row carry the value a locator addresses? Three exact comparisons; no matching, no
// heuristics, and nothing that a re-spelling or a translation could move.
constexpr bool checkup_row_matches(const CheckupLocator& l, unsigned reg, unsigned off, int conv) {
    return reg == l.reg && off == l.off && conv == l.conv;
}

// Index of the addressed row, or -1 when this profile carries none. The parallel-array shape mirrors
// trend_select(): the caller builds byte-wide views on the POLL TASK's stack, which is the budget
// that fails silently on this board (CLAUDE.md → Memory constraints).
inline int checkup_select(const CheckupLocator& l, const uint8_t* regs, const uint8_t* offs,
                         const int* convs, size_t n) {
    for (size_t i = 0; i < n; i++)
        if (checkup_row_matches(l, regs[i], offs[i], convs[i])) return static_cast<int>(i);
    return -1;
}

// The two converters matched by CONVERTER ALONE rather than by a locator (see the header note): the
// fault class, and the protection-retry counters #110 Part B added to def/overlay.hpp.
constexpr bool checkup_is_fault_class(int conv) { return conv == 203; }
constexpr bool checkup_is_retry_counter(int conv) { return conv == 310 || conv == 311; }

// ── One hour of evidence ────────────────────────────────────────────────────────────────────────
// `covered_s` is the load-bearing field and the reason a fresh board cannot show a green verdict: it
// counts the seconds actually OBSERVED in this hour, so an hour the firmware slept through, or a
// device that has been up for ten minutes, reports the small number it has rather than an implied
// full day.
struct CheckupBucket {
    uint16_t covered_s  = 0;   // seconds of continuous observation booked into this hour
    uint16_t run_s      = 0;   // compressor running
    uint16_t defrost_s  = 0;   // defrost active
    uint16_t buh_s      = 0;   // backup heater (either step) active — SPACE heating side
    uint16_t bsh_s      = 0;   // booster heater active — the DHW tank's immersion element
    uint8_t  starts     = 0;   // compressor 0 -> >0 transitions (saturating)
    uint8_t  defrosts   = 0;   // defrost off -> on transitions (saturating)
    int16_t  min_bar    = CHECKUP_ABSENT;   // tenths of bar, lowest seen
    int16_t  min_flow   = CHECKUP_ABSENT;   // tenths of l/min, lowest seen WHILE THE PUMP RAN
    uint8_t  flags      = 0;
};

// Bucket flags — facts that happened at least once in the hour and have no useful magnitude.
constexpr uint8_t CHECKUP_F_FAULT   = 1u << 0;   // conv 203 read class Error
constexpr uint8_t CHECKUP_F_WARNING = 1u << 1;   // conv 203 read class Warning/Caution
constexpr uint8_t CHECKUP_F_RETRY   = 1u << 2;   // a protection-retry counter was non-zero while running
constexpr uint8_t CHECKUP_F_WARM    = 1u << 3;   // a defrost STARTED with outdoor air above the frost line

// 24 hours of it. Sized here rather than in health.cpp so the cost is stated where a future field
// addition will see it.
constexpr size_t CHECKUP_BYTES = sizeof(CheckupBucket) * CHECKUP_BUCKETS;
static_assert(CHECKUP_BYTES <= 768, "the health ring is .bss on a heap-tight board — justify growth");

// Saturating add for the two event counters: 255 starts in one hour is far outside anything real,
// but a wrap to 0 would turn the worst imaginable cycling into a perfect score.
constexpr uint8_t checkup_add_u8(uint8_t v, unsigned add) {
    const unsigned s = v + add;
    return s > 255u ? uint8_t{255} : static_cast<uint8_t>(s);
}
constexpr uint16_t checkup_add_u16(uint16_t v, unsigned add) {
    const unsigned s = v + add;
    return s > 65535u ? uint16_t{65535} : static_cast<uint16_t>(s);
}

// Which hour bucket a monotonic uptime falls in. Monotonic for the same reason history_bucket() is:
// SNTP sets the wall clock abruptly and only once a route exists, so a wall-clock bucket would leap
// by decades on the first sync of every boot.
constexpr uint32_t checkup_bucket(int64_t uptime_us) {
    return static_cast<uint32_t>(uptime_us / (static_cast<int64_t>(CHECKUP_DT_S) * 1000000));
}

// How many whole hours went by with no observation between the open bucket and the current one.
// Same arithmetic (and the same wrap-around guard) as history_skipped().
constexpr uint32_t checkup_skipped(uint32_t prev, uint32_t now) {
    return now > prev ? now - prev - 1 : 0;
}

// ── The ring ────────────────────────────────────────────────────────────────────────────────────
// Here rather than in health.cpp for the reason logic/history.hpp gives for TrendRing: wrap-around
// and skipped-bucket handling are the kind of off-by-one whose only symptom is a subtly wrong number
// weeks later, and a rule that lives in a .cpp can only be checked on the device.
//
// A SKIPPED bucket is pushed EMPTY, not filled with anything: an hour nobody watched contributes
// zero events and zero covered seconds, which is exactly true and is what makes the window honest
// about a device that was rebooting.
struct CheckupRing {
    CheckupBucket buf[CHECKUP_BUCKETS] = {};
    uint8_t      count   = 0;              // buckets held (saturates at CHECKUP_BUCKETS)
    uint8_t      head    = 0;              // next write slot
    CheckupBucket pending;                  // the hour currently being accumulated

    void reset() {
        for (auto& b : buf) b = CheckupBucket{};
        count = 0;
        head  = 0;
        pending = CheckupBucket{};
    }

    void push(const CheckupBucket& b) {
        buf[head] = b;
        head = static_cast<uint8_t>((head + 1) % CHECKUP_BUCKETS);
        if (count < CHECKUP_BUCKETS) count++;
    }

    void commit(uint32_t skipped) {
        push(pending);
        for (uint32_t k = 0; k < skipped && k < CHECKUP_BUCKETS; k++) push(CheckupBucket{});
        pending = CheckupBucket{};
    }
};

// ── What one poll cycle saw ─────────────────────────────────────────────────────────────────────
// Every state is TRI-state on purpose. "Unknown" is never folded into "off": logic/ou_stale.hpp
// makes the same call about the compressor and states why — a profile that does not carry a row
// tells us nothing, and guessing the permissive value is how a check reports a clean bill of health
// it never measured.
struct CheckupSample {
    bool rps_known     = false, rps_running  = false;
    bool defrost_known = false, defrost_on   = false;
    bool buh_known     = false, buh_on       = false;   // either BUH step
    bool bsh_known     = false, bsh_on       = false;
    bool pump_known    = false, pump_on      = false;

    bool bar_ok  = false;  int bar_tenths  = 0;
    bool flow_ok = false;  int flow_tenths = 0;
    bool oat_ok  = false;  int oat_tenths  = 0;         // outdoor air, ONLY when not held over

    FaultClass fault = FaultClass::Unknown;             // Unknown when no conv-203 row was read
    // Highest protection-retry counter this cycle, in the parser's TENTHS (a counter of 2 arrives
    // as 20). Only ever tested against zero, so the scale does not enter a decision — named for
    // it anyway, because a future `> 2` written against the raw counter would be off by 10x.
    bool retry_known = false;  int retry_max_tenths = 0;
};

// What has to survive between cycles for an EDGE to be decidable at all.
struct CheckupState {
    int64_t  last_us       = -1;      // when the previous sample was taken (monotonic)
    bool     prev_rps_known = false, prev_rps_running = false;
    bool     prev_dfr_known = false, prev_dfr_on      = false;
    uint32_t bucket        = 0;
    bool     have_bucket   = false;
};

// Above this the air cannot deposit frost on the evaporator, so a defrost cycle there is reporting
// something other than ice. 12.0 °C is deliberately well clear of the 5-7 °C where a real (if
// inefficient) defrost is still ordinary — this flags the physically odd case, not the merely
// suboptimal one, because humidity is not on the X10A bus and the stronger claim cannot be made.
constexpr int CHECKUP_OAT_NO_FROST_TENTHS = 120;

// Fold one poll cycle into `st.pending`. `now_us` is the monotonic clock; the caller has already
// crossed any bucket boundary (see health.cpp), so everything here lands in the open hour.
//
// The whole delta is booked into the CURRENT bucket even when it straddles an hour boundary. With
// CHECKUP_MAX_GAP_S = 15 s that misattributes at most 15 s per hour — far below the resolution of
// anything reported — and the alternative (splitting a delta across two buckets) buys nothing for
// the extra edge case.
inline void checkup_step(CheckupState& st, CheckupBucket& b, const CheckupSample& s, int64_t now_us) {
    // ── continuity ──────────────────────────────────────────────────────────────────────────────
    // A gap longer than CHECKUP_MAX_GAP_S means the firmware was not watching. Seconds are not
    // accrued across it and — the half that matters — no transition is read across it either: the
    // previous state is DISCARDED, so a compressor that was off before a two-minute bus stall and
    // running after it does not book a start that may have been three.
    uint32_t dt = 0;
    bool continuous = false;
    if (st.last_us >= 0 && now_us >= st.last_us) {
        const int64_t gap_s = (now_us - st.last_us) / 1000000;
        if (gap_s <= static_cast<int64_t>(CHECKUP_MAX_GAP_S)) {
            dt = static_cast<uint32_t>(gap_s);
            continuous = true;
        }
    }
    st.last_us = now_us;

    if (continuous) {
        b.covered_s = checkup_add_u16(b.covered_s, dt);
        if (s.rps_known && s.rps_running)         b.run_s     = checkup_add_u16(b.run_s, dt);
        if (s.defrost_known && s.defrost_on)      b.defrost_s = checkup_add_u16(b.defrost_s, dt);
        if (s.buh_known && s.buh_on)              b.buh_s     = checkup_add_u16(b.buh_s, dt);
        if (s.bsh_known && s.bsh_on)              b.bsh_s     = checkup_add_u16(b.bsh_s, dt);

        // Edges. Both sides must be KNOWN — an unreadable cycle in the middle of a run breaks the
        // chain rather than manufacturing a stop and a start on either side of itself.
        if (st.prev_rps_known && s.rps_known && !st.prev_rps_running && s.rps_running)
            b.starts = checkup_add_u8(b.starts, 1);
        if (st.prev_dfr_known && s.defrost_known && !st.prev_dfr_on && s.defrost_on) {
            b.defrosts = checkup_add_u8(b.defrosts, 1);
            // Sampled AT THE EDGE, not averaged over the window: what matters is the air temperature
            // the unit chose to defrost at. Outdoor air lives on page 0x20, which freezes while the
            // compressor rests (logic/ou_stale.hpp) — but a defrost only happens while it runs, so
            // the reading is live exactly when this reads it. `oat_ok` is false for a held-over
            // sample regardless, so a frozen value can never raise this flag.
            if (s.oat_ok && s.oat_tenths > CHECKUP_OAT_NO_FROST_TENTHS) b.flags |= CHECKUP_F_WARM;
        }
    }

    // ── minima and flags — sampled, not integrated, so they need no continuity ───────────────────
    if (s.bar_ok && (b.min_bar == CHECKUP_ABSENT || s.bar_tenths < b.min_bar))
        b.min_bar = static_cast<int16_t>(s.bar_tenths);
    // Flow is only a measurement of the circuit while the pump is actually moving water; a stopped
    // pump reads ~0 l/min, which is neither a restriction nor news.
    if (s.flow_ok && s.pump_known && s.pump_on && (b.min_flow == CHECKUP_ABSENT || s.flow_tenths < b.min_flow))
        b.min_flow = static_cast<int16_t>(s.flow_tenths);

    if (fault_error_active(s.fault))   b.flags |= CHECKUP_F_FAULT;
    if (fault_warning_active(s.fault)) b.flags |= CHECKUP_F_WARNING;
    // A non-zero retry counter is only interpretable against a RUNNING compressor — that is exactly
    // what feature_gate.hpp's uc5_supported() says the rule needs, and it is why the retries check
    // reports Unavailable without a run-state row rather than reporting the raw counter.
    if (s.retry_known && s.retry_max_tenths > 0 && s.rps_known && s.rps_running) b.flags |= CHECKUP_F_RETRY;

    st.prev_rps_known   = s.rps_known;
    st.prev_rps_running = s.rps_running;
    st.prev_dfr_known   = s.defrost_known;
    st.prev_dfr_on      = s.defrost_on;
}

// ── The window ──────────────────────────────────────────────────────────────────────────────────
struct CheckupWindow {
    uint32_t covered_s = 0;
    uint32_t run_s     = 0;
    uint32_t defrost_s = 0;
    uint32_t buh_s     = 0;
    uint32_t bsh_s     = 0;
    uint32_t starts    = 0;
    uint32_t defrosts  = 0;
    int      min_bar   = CHECKUP_ABSENT;
    int      min_flow  = CHECKUP_ABSENT;
    uint8_t  flags     = 0;
};

// Sum the whole ring plus the hour still being accumulated.
inline CheckupWindow checkup_aggregate(const CheckupRing& r) {
    CheckupWindow w;
    auto fold = [&w](const CheckupBucket& b) {
        w.covered_s += b.covered_s;
        w.run_s     += b.run_s;
        w.defrost_s += b.defrost_s;
        w.buh_s     += b.buh_s;
        w.bsh_s     += b.bsh_s;
        w.starts    += b.starts;
        w.defrosts  += b.defrosts;
        w.flags     |= b.flags;
        if (b.min_bar  != CHECKUP_ABSENT && (w.min_bar  == CHECKUP_ABSENT || b.min_bar  < w.min_bar))
            w.min_bar = b.min_bar;
        if (b.min_flow != CHECKUP_ABSENT && (w.min_flow == CHECKUP_ABSENT || b.min_flow < w.min_flow))
            w.min_flow = b.min_flow;
    };
    const size_t oldest = (r.count < CHECKUP_BUCKETS) ? 0 : r.head;
    for (size_t i = 0; i < r.count; i++) fold(r.buf[(oldest + i) % CHECKUP_BUCKETS]);
    fold(r.pending);
    return w;
}

// ── What the active profile can supply ──────────────────────────────────────────────────────────
// Evidence from the ROWS, never from the model id — the argument logic/feature_gate.hpp makes and
// measures: `generic` is the extreme case but not the only one, and an id check would have let a
// check run blind on a third of the detected catalog.
struct CheckupCoverage {
    bool rps      = false;   // the compressor witness (ou_is_rps_witness) — only 27 of 44 profiles
    bool defrost  = false;
    bool heater   = false;   // either BUH step, or the BSH
    bool pump     = false;
    bool pressure = false;
    bool flow     = false;
    bool fault    = false;   // any conv-203 row
    bool retries  = false;   // any conv-310/311 row (def/overlay.hpp)
};

// ── Verdicts ────────────────────────────────────────────────────────────────────────────────────
// Five values, and the two that are not judgements are the point of the whole design:
//
//   Unavailable  this profile cannot supply the inputs. The check is OFF, not degraded — the rule
//                logic/feature_gate.hpp states and #121 / ou_stale / cop_scope each paid for.
//   Collecting   the inputs exist, the window does not hold enough of them yet. A device that has
//                been up ten minutes has NOT established that the plant is fine, and saying "Ok"
//                there would be a green light bought with no evidence — the exact failure a fresh
//                board would show after every one of this project's reboot bursts.
enum class CheckupVerdict : uint8_t { Unavailable = 0, Ok = 1, Collecting = 2, Info = 3, Warn = 4 };

// The enum's numeric order IS the aggregation order, so `worst` is a max and there is no second
// table to disagree with it. Read it as: a Warn anywhere wins; else an Info; else the fact that
// something is still Collecting (which must outrank Ok, or a half-observed day would report green);
// else Ok; and Unavailable only when nothing at all could be evaluated.
constexpr CheckupVerdict checkup_worse(CheckupVerdict a, CheckupVerdict b) {
    return static_cast<uint8_t>(a) >= static_cast<uint8_t>(b) ? a : b;
}

// DECLARATION ORDER IS READING ORDER. /status emits the checks in this order and the card renders
// them in the order it receives them, so there is exactly one definition of "what does a person read
// first" — a second ordering table in the browser would be free to disagree with this one, and the
// row a reader most needs (an active fault) is the one that must not end up sixth.
enum class CheckupCheck : uint8_t {
    Fault = 0, Cycling, Defrost, Pressure, Flow, Heater, Retries
};
constexpr size_t CHECKUP_CHECK_COUNT = 7;

// Stable wire ids — what /status.health prints and what the browser keys its copy on. Not the label:
// labels are translated in the UI, ids are not.
inline const char* checkup_check_id(CheckupCheck c) {
    switch (c) {
        case CheckupCheck::Cycling:  return "cycling";
        case CheckupCheck::Defrost:  return "defrost";
        case CheckupCheck::Pressure: return "pressure";
        case CheckupCheck::Flow:     return "flow";
        case CheckupCheck::Heater:   return "heater";
        case CheckupCheck::Fault:    return "fault";
        case CheckupCheck::Retries:  return "retries";
    }
    return "";
}

inline const char* checkup_verdict_name(CheckupVerdict v) {
    switch (v) {
        case CheckupVerdict::Unavailable: return "unavailable";
        case CheckupVerdict::Collecting:  return "collecting";
        case CheckupVerdict::Ok:          return "ok";
        case CheckupVerdict::Info:        return "info";
        case CheckupVerdict::Warn:        return "warn";
    }
    return "";
}

// ── Thresholds, each with the reason it is that number ──────────────────────────────────────────
// Minimum windows first. They are not padding: every one of these figures is a RATE or an EXTREME,
// and both are meaningless over a short window (two starts in ten minutes is not 288 starts a day).
constexpr uint32_t CHECKUP_MIN_S_CYCLING  = 12u * 3600;   // half a day — long enough to hold a full
constexpr uint32_t CHECKUP_MIN_S_DEFROST  = 12u * 3600;   // heating/DHW pattern rather than one phase
constexpr uint32_t CHECKUP_MIN_S_HEATER   =  6u * 3600;
constexpr uint32_t CHECKUP_MIN_S_RETRIES  =  6u * 3600;
constexpr uint32_t CHECKUP_MIN_S_PRESSURE =  1u * 3600;   // an extreme of a slow-moving quantity
constexpr uint32_t CHECKUP_MIN_S_FLOW     =  1u * 3600;

// CYCLING. Two conditions, both required, and the second is the one that knows the load. A
// modulating air-to-water unit runs 20-60 minutes per cycle when it is sized and controlled well; a
// 24-hour MEAN below ten minutes is the short-cycling signature and does not depend on how cold the
// day was. The start count is the guard against reading a mean off two samples — and it is
// deliberately not a threshold in its own right (see the header note).
//
// A DHW charge is a LONG run, so it raises the mean rather than tripping this. That matters on the
// reference installation, where every DHW cycle terminates on the ~100 °C discharge limit and a
// tank charge is therefore several legitimate compressor starts.
constexpr uint32_t CHECKUP_CYCLING_MIN_STARTS   = 12;
constexpr uint32_t CHECKUP_CYCLING_SHORT_RUN_S  = 600;    // 10 minutes, mean over the window

// DEFROST. A share of runtime, not a count: four defrosts in a day of hard running is normal, four
// in two hours of running is not. 15 % is generous — a healthy unit near freezing spends single
// digits — precisely because humidity is not measurable here and the claim has to survive a damp
// day. The count guard stops a single defrost inside a very short run from reading as 100 %.
constexpr int      CHECKUP_DEFROST_SHARE_PCT = 15;
constexpr uint32_t CHECKUP_DEFROST_MIN_COUNT = 3;

// WATER PRESSURE, in tenths of bar. Daikin requires at least 1 bar in the circuit and a filled
// system normally sits at 1.5-2.0 bar cold. So: below 1.2 bar is worth mentioning before it becomes
// a problem, below 1.0 bar is out of specification and wants topping up. There is deliberately no
// "critical" band below that — the unit's own low-pressure protection defines that point, its
// setpoint is not published on the bus, and it announces itself as a fault code anyway.
constexpr int CHECKUP_BAR_INFO_TENTHS = 12;
constexpr int CHECKUP_BAR_WARN_TENTHS = 10;

// BACKUP HEATER. An hour of resistive space heating in a day is worth knowing about — it is heat at
// a COP of 1 — but it is never a fault: defrost support, an emergency-mode run and a legitimate
// cold-snap boost all land here. So Info, never Warn. The DHW booster (BSH) is reported separately
// and carries no threshold at all: on the reference installation it is deliberately used to absorb
// PV surplus, so a daily figure is information, not a finding.
constexpr uint32_t CHECKUP_BUH_INFO_S = 3600;

// ── One check's answer ──────────────────────────────────────────────────────────────────────────
// The numbers ride WITH the verdict rather than being recomputed by each consumer: /status, the card
// and the tests must not be able to disagree about what a verdict was based on.
struct CheckupCheckResult {
    CheckupVerdict verdict = CheckupVerdict::Unavailable;
    // Per check, and only the fields that check fills. `-1` means "not established" everywhere it
    // appears, so a consumer emits null rather than a plausible zero.
    int a = -1;
    int b = -1;
};

struct CheckupReport {
    uint32_t          covered_s = 0;
    CheckupVerdict     overall   = CheckupVerdict::Unavailable;
    CheckupCheckResult checks[CHECKUP_CHECK_COUNT];

    const CheckupCheckResult& operator[](CheckupCheck c) const {
        return checks[static_cast<size_t>(c)];
    }
};

// Judge the window. Pure and total: every check returns one of the five verdicts for every possible
// input, so there is no "shouldn't happen" branch for a caller to trip over.
//
// `fault_now` is the class read on the LAST cycle, not a window aggregate: a fault that is active
// right now and one that cleared three hours ago are different findings and must not collapse into
// one badge.
inline CheckupReport checkup_evaluate(const CheckupWindow& w, const CheckupCoverage& cov,
                                    FaultClass fault_now) {
    CheckupReport r;
    r.covered_s = w.covered_s;

    auto set = [&r](CheckupCheck c, CheckupVerdict v, int a = -1, int b = -1) {
        CheckupCheckResult& x = r.checks[static_cast<size_t>(c)];
        x.verdict = v;
        x.a = a;
        x.b = b;
    };

    // ── Cycling: starts (a) and the mean run length in seconds (b) ───────────────────────────────
    if (!cov.rps) {
        set(CheckupCheck::Cycling, CheckupVerdict::Unavailable);
    } else if (w.covered_s < CHECKUP_MIN_S_CYCLING) {
        set(CheckupCheck::Cycling, CheckupVerdict::Collecting, static_cast<int>(w.starts));
    } else if (w.starts == 0) {
        // A plant that never started is not cycling. Reported as Ok with an explicit zero rather
        // than as an absence — "it did not run today" is a fact, not a missing measurement.
        set(CheckupCheck::Cycling, CheckupVerdict::Ok, 0);
    } else {
        const int mean = static_cast<int>(w.run_s / w.starts);
        const bool bad = w.starts >= CHECKUP_CYCLING_MIN_STARTS &&
                         static_cast<uint32_t>(mean) < CHECKUP_CYCLING_SHORT_RUN_S;
        set(CheckupCheck::Cycling, bad ? CheckupVerdict::Warn : CheckupVerdict::Ok,
            static_cast<int>(w.starts), mean);
    }

    // ── Defrost: count (a) and share of runtime in percent (b) ──────────────────────────────────
    if (!cov.defrost) {
        set(CheckupCheck::Defrost, CheckupVerdict::Unavailable);
    } else if (w.covered_s < CHECKUP_MIN_S_DEFROST) {
        set(CheckupCheck::Defrost, CheckupVerdict::Collecting, static_cast<int>(w.defrosts));
    } else {
        const int share = w.run_s ? static_cast<int>(w.defrost_s * 100u / w.run_s) : -1;
        CheckupVerdict v = CheckupVerdict::Ok;
        if (w.defrosts >= CHECKUP_DEFROST_MIN_COUNT && share > CHECKUP_DEFROST_SHARE_PCT)
            v = CheckupVerdict::Warn;
        else if (w.flags & CHECKUP_F_WARM)
            v = CheckupVerdict::Info;
        set(CheckupCheck::Defrost, v, static_cast<int>(w.defrosts), share);
    }

    // ── Water pressure: the window minimum in tenths of bar (a) ─────────────────────────────────
    if (!cov.pressure) {
        set(CheckupCheck::Pressure, CheckupVerdict::Unavailable);
    } else if (w.covered_s < CHECKUP_MIN_S_PRESSURE || w.min_bar == CHECKUP_ABSENT) {
        set(CheckupCheck::Pressure, CheckupVerdict::Collecting);
    } else {
        const CheckupVerdict v = w.min_bar < CHECKUP_BAR_WARN_TENTHS ? CheckupVerdict::Warn
                              : w.min_bar < CHECKUP_BAR_INFO_TENTHS ? CheckupVerdict::Info
                                                                   : CheckupVerdict::Ok;
        set(CheckupCheck::Pressure, v, w.min_bar);
    }

    // ── Flow: the minimum while the pump ran, in tenths of l/min (a) ────────────────────────────
    // OBSERVATION ONLY — never Info, never Warn. The manufacturer's minimum is per model and the
    // unit raises 7H itself; see the header note. Reported so the reader can compare it against
    // their own unit's documented minimum, which is a thing a person can do and this firmware
    // cannot.
    if (!cov.flow || !cov.pump) {
        set(CheckupCheck::Flow, CheckupVerdict::Unavailable);
    } else if (w.covered_s < CHECKUP_MIN_S_FLOW || w.min_flow == CHECKUP_ABSENT) {
        set(CheckupCheck::Flow, CheckupVerdict::Collecting);
    } else {
        set(CheckupCheck::Flow, CheckupVerdict::Ok, w.min_flow);
    }

    // ── Heater: BUH minutes (a) and BSH minutes (b) ─────────────────────────────────────────────
    if (!cov.heater) {
        set(CheckupCheck::Heater, CheckupVerdict::Unavailable);
    } else if (w.covered_s < CHECKUP_MIN_S_HEATER) {
        set(CheckupCheck::Heater, CheckupVerdict::Collecting);
    } else {
        const CheckupVerdict v = w.buh_s > CHECKUP_BUH_INFO_S ? CheckupVerdict::Info : CheckupVerdict::Ok;
        set(CheckupCheck::Heater, v, static_cast<int>(w.buh_s / 60), static_cast<int>(w.bsh_s / 60));
    }

    // ── Fault: no minimum window — a fault now is a fault now ───────────────────────────────────
    // An UNKNOWN class publishes nothing, exactly as logic/fault_state.hpp's companions do: 0/0 on a
    // byte nobody could decode asserts "no fault", the one direction a fault report must never fail
    // in.
    if (!cov.fault || fault_now == FaultClass::Unknown) {
        set(CheckupCheck::Fault, CheckupVerdict::Unavailable);
    } else if (fault_error_active(fault_now)) {
        set(CheckupCheck::Fault, CheckupVerdict::Warn, 1);
    } else if (fault_warning_active(fault_now)) {
        set(CheckupCheck::Fault, CheckupVerdict::Info, 1);
    } else if (w.flags & (CHECKUP_F_FAULT | CHECKUP_F_WARNING)) {
        // Clear now, but not all day. Without a database this is the only place that fact survives,
        // and it is the one a user needs to be told before they conclude nothing ever happened.
        set(CheckupCheck::Fault, CheckupVerdict::Info, 0);
    } else {
        set(CheckupCheck::Fault, CheckupVerdict::Ok, 0);
    }

    // ── Protection retries: UC5's core signal (#69 / #110) ──────────────────────────────────────
    // Needs BOTH the counters and a run state, which is exactly feature_gate.hpp's uc5_supported()
    // — a counter with no compressor state cannot separate "retried while running" from a value
    // frozen with its page.
    if (!cov.retries || !cov.rps) {
        set(CheckupCheck::Retries, CheckupVerdict::Unavailable);
    } else if (w.covered_s < CHECKUP_MIN_S_RETRIES) {
        set(CheckupCheck::Retries, CheckupVerdict::Collecting);
    } else {
        const bool seen = (w.flags & CHECKUP_F_RETRY) != 0;
        set(CheckupCheck::Retries, seen ? CheckupVerdict::Info : CheckupVerdict::Ok, seen ? 1 : 0);
    }

    for (const auto& c : r.checks) r.overall = checkup_worse(r.overall, c.verdict);
    return r;
}

}  // namespace daik::logic
