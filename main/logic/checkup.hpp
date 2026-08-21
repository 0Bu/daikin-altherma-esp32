#pragma once
// THE ROLLING PLANT CHECKUP — what did the on-board inputs establish in at most the last 24 hours?
//
// The dashboard already answers "what is it doing right now" (the schematic) and "what did this one
// reading do today" (logic/history.hpp's trends). Neither answers the question a user actually asks
// once a month: *did the observed data contain anything worth following up?* That answer is a small
// number of COUNTED EVENTS and WINDOW MINIMA — how often the compressor started, how much of its
// runtime went into defrosting, how low the water pressure got — none of which any single reading can
// express. It is deliberately NOT a certificate that the whole plant is healthy: X10A plus an
// independent circulation-pump power witness still cannot prove
// refrigerant charge, sensor calibration, hydraulic cleanliness, air path or seasonal efficiency.
//
// Issue #208 asked for it. This header is the half that can be decided; main/checkup.cpp is the
// storage, and main/www/js/dashboard.js is the card. What #208 asked for and this deliberately does NOT do is
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
// are EVENTS, and an event has to be counted where it happens: once per completed poll sweep. A
// pulse that starts and ends between two sweeps is outside what X10A established and can still be
// missed; the card never upgrades that sampling limit into a claim of continuous event capture.
//
// So this keeps its own ring — 23 completed one-hour buckets plus the open hour in static RAM — beside the
// trend rings. Keeping the open hour INSIDE the total is load-bearing: 24 completed buckets plus an
// open one would silently make a "24 h" window almost 25 hours long. It is a different question at
// a different rate, not a view of the same data.
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
// Two inputs use broader structural predicates, deliberately:
//   * the compressor witness composes ou_is_rps_witness() (logic/ou_stale.hpp) rather than naming a
//     locator of its own — one rule, one answer, and that header already pins its own catalog
//     conformance;
//   * the fault class is matched by converter 203 because a profile carries it on BOTH the outdoor
//     and hydronic page and a fault on either unit is a fault. Retry counters instead use exact
//     (page, offset, converter) identities: conv 311 also names unrelated quantities elsewhere.
//
// ── WHAT IS NOT BUILT, AND WHY ──────────────────────────────────────────────────────────────────
//   * 3-WAY VALVE LEAKAGE from the DHW tank's cooling rate. The rate is now observed, but never
//     relabelled as a valve verdict: measured external circulation power can explain correlation or
//     establish that high loss persisted with that pump off; it still cannot distinguish gravity
//     circulation/check valve, a draw, insulation or a leaking diverter by itself.
//   * AN ABSOLUTE MINIMUM-FLOW THRESHOLD. The manufacturer's minimum is per model (the catalog spans
//     3 kW to 18 kW), and one number laid across 44 profiles would never fire on the large units and
//     always fire on the small ones. The unit raises 7H itself when flow is genuinely insufficient,
//     and that reaches the fault check below. The minimum is REPORTED; no verdict is attached to it.
//   * A DAILY START-COUNT THRESHOLD. 24 starts on a cold day is one per hour and healthy; 24 starts
//     in the shoulder season is cycling. A start count alone does not know the load. The MEAN RUN
//     LENGTH does — see CHECKUP_CYCLING_SHORT_RUN_S.
#include <algorithm>
#include <cstddef>
#include <cstdint>

#include "fault_state.hpp"   // FaultClass — the fault check composes conv 203's own class table
#include "ou_stale.hpp"      // ou_is_rps_witness — the compressor witness, called not restated
#include "outdoor_evidence.hpp" // one provenance/freshness answer shared with heating-curve events

namespace daik::logic {

// ── Window geometry ─────────────────────────────────────────────────────────────────────────────
// One bucket per hour, 24 total INCLUDING the hour currently being accumulated. The ring therefore
// retains 23 completed hours beside `pending`; at any instant its span is <=24 hours.
constexpr unsigned CHECKUP_DT_S             = 3600;
constexpr unsigned CHECKUP_BUCKETS          = 24;
constexpr unsigned CHECKUP_COMPLETED_BUCKETS = CHECKUP_BUCKETS - 1;
constexpr uint32_t CHECKUP_WINDOW_S          = CHECKUP_BUCKETS * CHECKUP_DT_S;
constexpr int64_t  CHECKUP_WINDOW_US         =
    static_cast<int64_t>(CHECKUP_WINDOW_S) * 1000000;

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
inline constexpr CheckupLocator CHECKUP_LOC_VALVE    = {0x60, 12, 306};  // 1=DHW, 0=space
inline constexpr CheckupLocator CHECKUP_LOC_R5T      = {0x61, 10, 105};  // DHW tank sensor, 0.1 °C
inline constexpr CheckupLocator CHECKUP_LOC_IU_MODE  = {0x60,  2, 315};  // Heating/Cooling/DHW
inline constexpr CheckupLocator CHECKUP_LOC_OUTDOOR  = {0x20,  0, 105};  // R1T outdoor air, 0.1 °C

// Does this row carry the value a locator addresses? Three exact comparisons; no matching, no
// heuristics, and nothing that a re-spelling or a translation could move.
constexpr bool checkup_row_matches(const CheckupLocator& l, unsigned reg, unsigned off, int conv) {
    return reg == l.reg && off == l.off && conv == l.conv;
}

// The valve separates tank from room circuit, not HEATING from COOLING. The latter is a second,
// independently decoded fact. Keep the formatted enum adapter pure and closed so checkup.cpp only
// transports it; an unknown spelling is absence, never permission to call a cooling run heating.
enum class CheckupOperatingMode : uint8_t { Unknown, Heating, Cooling, Other };

constexpr bool checkup_text_equal(const char* a, const char* b) {
    if (!a || !b) return false;
    while (*a && *b && *a == *b) { a++; b++; }
    return *a == '\0' && *b == '\0';
}

constexpr CheckupOperatingMode checkup_operating_mode(const char* text) {
    if (checkup_text_equal(text, "Heating") || checkup_text_equal(text, "Heating + DHW"))
        return CheckupOperatingMode::Heating;
    if (checkup_text_equal(text, "Cooling") || checkup_text_equal(text, "Cooling + DHW"))
        return CheckupOperatingMode::Cooling;
    if (checkup_text_equal(text, "Stop") || checkup_text_equal(text, "DHW"))
        return CheckupOperatingMode::Other;
    return CheckupOperatingMode::Unknown;
}

// Index of the addressed row, or -1 when this profile carries none. The parallel-array shape mirrors
// trend_select(): the caller builds byte-wide views on the POLL TASK's stack, which is the budget
// that fails silently on this board (AGENTS.md → Memory, concurrency, and HTTP safety).
inline int checkup_select(const CheckupLocator& l, const uint8_t* regs, const uint8_t* offs,
                         const int* convs, size_t n) {
    for (size_t i = 0; i < n; i++)
        if (checkup_row_matches(l, regs[i], offs[i], convs[i])) return static_cast<int>(i);
    return -1;
}

// Fault classes are the one quantity matched by converter alone (see the header note).
constexpr bool checkup_is_fault_class(int conv) { return conv == 203; }

// Five real counters occupy page 0x10 offsets 10-12. The sixth possible low field at 0x10/12 is
// documented "Not in use" and is deliberately absent from def/overlay.hpp. Identity matters here:
// comparing only the maximum counter would turn one counter falling while another rises into "no
// change", and a non-zero absolute value does not establish that anything happened in this window.
constexpr size_t CHECKUP_RETRY_COUNT = 5;
constexpr int checkup_retry_index(unsigned reg, unsigned off, int conv) {
    if (reg != 0x10u) return -1;
    if (off == 10u && conv == 310) return 0; // discharge temperature
    if (off == 10u && conv == 311) return 1; // compressor inverter current
    if (off == 11u && conv == 310) return 2; // high pressure
    if (off == 11u && conv == 311) return 3; // low pressure
    if (off == 12u && conv == 310) return 4; // inverter fin temperature
    return -1;
}

// Compact per-hour context, in the persisted ring. Keep the exact tenths sum: a stored running mean
// is order-dependent once finite precision rounds a small update to zero (a cold first half-hour
// followed by a warm one can otherwise remain biased cold). Eight bytes per judged context lets
// Cycling and Defrost each keep a paired population without conflating which operating evidence the
// weather describes.
struct CheckupOutdoorStats {
    int32_t  sum_tenths = 0;
    int16_t  min_tenths = CHECKUP_ABSENT;
    uint16_t samples = 0;
};
static_assert(sizeof(CheckupOutdoorStats) == 8, "outdoor context cost changed");

// ── One hour of evidence ────────────────────────────────────────────────────────────────────────
// `covered_s` is the load-bearing field and the reason a fresh board cannot show a green verdict: it
// counts the seconds actually OBSERVED in this hour, so an hour the firmware slept through, or a
// device that has been up for ten minutes, reports the small number it has rather than an implied
// full day.
struct CheckupBucket {
    uint16_t covered_s       = 0; // any continuous X10A observation (card-level context only)
    uint16_t rps_observed_s  = 0; // compressor witness was readable
    uint16_t run_s           = 0; // compressor running while that witness was readable
    // WHICH LOAD a compressor RUN served. RPS lives on 0x30; the 3-way valve and I/U mode live on
    // 0x60, so either page can time out alone. `class_observed_s` is the paired class clock: RPS and
    // valve must be readable together, plus I/U mode whenever the valve points at the room circuit.
    //
    // The two class figures below count COMPLETED RUNS, not seconds attributed sample by sample.
    // That distinction is the whole correctness of this check. Splitting seconds by the valve while
    // the START stays on the side the run began leaves a ratio whose numerator and denominator
    // describe different populations, and DHW priority makes that a routine event rather than a
    // corner case: twelve continuous 25-minute runs that each hand over to the tank after five
    // minutes then read as a five-minute mean over twelve starts — a short-cycling verdict on a
    // plant that never short-cycled. A run is therefore the unit, and it is classified only when its
    // complete load identity stayed known and unchanged for the whole witnessed length.
    uint16_t class_observed_s = 0;
    uint16_t space_run_s     = 0; // total seconds of completed runs that served the space circuit
    uint16_t dhw_run_s       = 0; // total seconds of completed runs that served the tank
    uint16_t dfr_observed_s  = 0; // defrost flag readable (count evidence)
    uint16_t dfr_pair_observed_s = 0; // defrost flag AND compressor witness readable (ratio evidence)
    uint16_t dfr_run_s       = 0; // compressor runtime inside that paired observation
    uint16_t defrost_s       = 0; // defrost active inside that paired observation
    uint16_t buh_observed_s  = 0; // backup-heater flag readable
    uint16_t buh_s           = 0; // backup heater (either step) active — SPACE heating side
    uint16_t bsh_observed_s  = 0; // tank-heater flag readable
    uint16_t bsh_s           = 0; // booster heater active — the DHW tank's immersion element
    uint16_t bar_observed_s  = 0; // valid water-pressure samples continuously observed
    uint16_t flow_observed_s = 0; // valid flow after the pump run-up
    uint16_t retry_observed_s = 0;// all counters + compressor state comparable across the interval
    int16_t  min_bar    = CHECKUP_ABSENT;   // tenths of bar, raw lowest valid sample seen
    int16_t  min_flow   = CHECKUP_ABSENT;   // tenths of l/min, lowest seen after pump run-up
    uint8_t  starts     = 0;   // compressor 0 -> >0 transitions (saturating)
    // COMPLETED runs, per class — the denominators of the two heating/DHW means above, so each ratio
    // is formed over one population. A run reaches one of these only if its valve/mode class stayed
    // readable and unchanged; cooling is counted only to make its exclusion explicit. Everything
    // else lands in `censored_runs`, so "no verdict" can never be read as "nothing ran".
    uint8_t  space_runs = 0;
    uint8_t  dhw_runs   = 0;
    uint8_t  cooling_runs = 0; // positively identified room-circuit cooling, reported but not judged
    uint8_t  censored_runs = 0; // completed, but mixed / class-unreadable / gapped: judged by neither
    uint8_t  defrosts   = 0;   // defrost off -> on transitions (saturating)
    uint8_t  paired_defrosts = 0; // same edge with readable compressor witnesses at both endpoints
    uint8_t  flags      = 0;
    CheckupOutdoorStats cycling_outdoor; // samples from completed, pure space-heating runs only
    CheckupOutdoorStats defrost_outdoor; // samples paired with known defrost + running compressor
};

// Bucket flags — facts that happened at least once in the hour and have no useful magnitude.
constexpr uint8_t CHECKUP_F_FAULT   = 1u << 0;   // conv 203 read class Error
constexpr uint8_t CHECKUP_F_WARNING = 1u << 1;   // conv 203 read class Warning/Caution
constexpr uint8_t CHECKUP_F_RETRY   = 1u << 2;   // a protection-retry counter strictly INCREASED
constexpr uint8_t CHECKUP_F_LOW_BAR = 1u << 3;   // <=1.0 bar persisted for the confirmation period

// 23 completed buckets plus the pending one: the full rolling window's actual storage cost.
//
// The bound was RAISED from 1104 to 1536 (46 -> 64 bytes per bucket) for two distinct eight-byte
// outdoor contexts. The old #441 estimate assumed one shared context; pairing Cycling only with
// completed space-heating runs and Defrost only with its known-state compressor denominator makes
// that unsafe. Exact, order-independent sums cost 16 B per bucket plus 2 B alignment: 18 x 24 =
// 432 B of .noinit DRAM. No heap or flash is used.
constexpr size_t CHECKUP_BYTES = sizeof(CheckupBucket) * CHECKUP_BUCKETS;
static_assert(CHECKUP_BYTES <= 1536, "the static checkup ring is too large for this heap-tight board");

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

inline int32_t checkup_div_round_nearest(int64_t numerator, uint32_t denominator) {
    if (!denominator) return 0;
    const int64_t half = static_cast<int64_t>(denominator) / 2;
    return static_cast<int32_t>(numerator >= 0
                              ? (numerator + half) / denominator
                              : (numerator - half) / denominator);
}

inline void checkup_outdoor_add(CheckupOutdoorStats& stats, const OutdoorEvidence& evidence) {
    if (!outdoor_evidence_valid(evidence) || evidence.source != OutdoorSource::X10a) return;
    const long rounded = std::lround(evidence.temperature_c * 10.0);
    // The real outdoor domain is far narrower; this representation guard also keeps sum_tenths
    // inside int32 even at the uint16 sample ceiling.
    if (rounded < -3276 || rounded > 3276) return;
    const int16_t tenths = static_cast<int16_t>(rounded);
    if (!stats.samples) {
        stats.min_tenths = tenths;
        stats.sum_tenths = tenths;
        stats.samples = 1;
        return;
    }
    if (stats.samples == UINT16_MAX) return; // physically >18 h at 1 Hz inside one bucket/run
    if (tenths < stats.min_tenths) stats.min_tenths = tenths;
    stats.sum_tenths += tenths;
    stats.samples = static_cast<uint16_t>(stats.samples + 1);
}

inline void checkup_outdoor_merge(CheckupOutdoorStats& into, const CheckupOutdoorStats& from) {
    if (!from.samples) return;
    if (!into.samples) { into = from; return; }
    const uint32_t total = static_cast<uint32_t>(into.samples) + from.samples;
    if (total > UINT16_MAX) return; // impossible inside one hourly bucket; preserve the valid prefix
    into.sum_tenths += from.sum_tenths;
    if (from.min_tenths < into.min_tenths) into.min_tenths = from.min_tenths;
    into.samples = static_cast<uint16_t>(total);
}

inline int checkup_outdoor_mean_tenths(const CheckupOutdoorStats& stats) {
    return stats.samples ? checkup_div_round_nearest(stats.sum_tenths, stats.samples)
                         : CHECKUP_ABSENT;
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
// Here rather than in checkup.cpp for the reason logic/history.hpp gives for TrendRing: wrap-around
// and skipped-bucket handling are the kind of off-by-one whose only symptom is a subtly wrong number
// weeks later, and a rule that lives in a .cpp can only be checked on the device.
//
// A SKIPPED bucket is pushed EMPTY, not filled with anything: an hour nobody watched contributes
// zero events and zero covered seconds, which is exactly true and is what makes the window honest
// about a device that was rebooting.
struct CheckupRing {
    CheckupBucket buf[CHECKUP_COMPLETED_BUCKETS] = {};
    uint8_t      count   = 0;              // completed buckets held (saturates at 23)
    uint8_t      head    = 0;              // next write slot
    uint8_t      age_buckets = 0;           // elapsed bucket boundaries, saturates at 24
    int64_t      first_sample_us = -1;       // real lifecycle anchor; bucket boundaries are phase-shifted
    int64_t      latest_sample_us = -1;
    // Lifecycle already observed in an EARLIER boot, carried across by the .noinit restore
    // (logic/checkup_persist.hpp). It has to be a DURATION rather than a restored anchor pair:
    // first/latest_sample_us are MONOTONIC and restart at zero every boot, so a restored pair would
    // be measured against a clock that no longer exists — `latest - first` would go negative and
    // full_span() would answer false for as long as the ring lived.
    int64_t      carried_span_us = 0;
    CheckupBucket pending;                  // the hour currently being accumulated

    void reset() {
        for (auto& b : buf) b = CheckupBucket{};
        count = 0;
        head  = 0;
        age_buckets = 0;
        first_sample_us = -1;
        latest_sample_us = -1;
        carried_span_us = 0;
        pending = CheckupBucket{};
    }

    // A bucket boundary can occur one microsecond after the first sample, so counting 24 boundaries
    // is not proof that 24 hours elapsed. Pin the real monotonic lifecycle separately. Evidence gaps
    // do not reset it; the per-signal 90% clocks below decide whether that lifecycle was observed.
    void observe(int64_t now_us) {
        if (now_us < 0) return;
        if (first_sample_us < 0) first_sample_us = now_us;
        if (latest_sample_us < 0 || now_us >= latest_sample_us) latest_sample_us = now_us;
    }

    // This boot's observed lifecycle plus whatever an earlier boot carried in. Split out from
    // full_span() so the restore has something to state and a test something to read.
    int64_t span_us() const {
        const int64_t live = (first_sample_us >= 0 && latest_sample_us >= first_sample_us)
                           ? latest_sample_us - first_sample_us
                           : 0;
        return live + carried_span_us;
    }

    bool full_span() const { return span_us() >= CHECKUP_WINDOW_US; }

    void push(const CheckupBucket& b) {
        buf[head] = b;
        head = static_cast<uint8_t>((head + 1) % CHECKUP_COMPLETED_BUCKETS);
        if (count < CHECKUP_COMPLETED_BUCKETS) count++;
    }

    void commit(uint32_t skipped) {
        push(pending);
        for (uint32_t k = 0; k < skipped && k < CHECKUP_COMPLETED_BUCKETS; k++) push(CheckupBucket{});
        const uint32_t aged = static_cast<uint32_t>(age_buckets) + 1u + skipped;
        age_buckets = static_cast<uint8_t>(aged > CHECKUP_BUCKETS ? CHECKUP_BUCKETS : aged);
        pending = CheckupBucket{};
    }

    // Locate the bucket in which a run STARTED. Complete-run statistics belong beside their start
    // edge: booking a 25-hour run into the bucket where it stopped lets 24 hours of pre-window time
    // re-enter the rolling mean. `commit()` pushes every skipped hour, so distance from the current
    // pending bucket maps directly back from `head`. Null means the start has already aged out.
    CheckupBucket* retained_bucket(uint32_t absolute_bucket, uint32_t current_bucket) {
        if (absolute_bucket > current_bucket) return nullptr;
        const uint32_t distance = current_bucket - absolute_bucket;
        if (distance == 0) return &pending;
        if (distance > count || distance > CHECKUP_COMPLETED_BUCKETS) return nullptr;
        const size_t index = (static_cast<size_t>(head) + CHECKUP_COMPLETED_BUCKETS - distance) %
                             CHECKUP_COMPLETED_BUCKETS;
        return &buf[index];
    }
};

// ── What one poll cycle saw ─────────────────────────────────────────────────────────────────────
// Every state is TRI-state on purpose. "Unknown" is never folded into "off": logic/ou_stale.hpp
// makes the same call about the compressor and states why — a profile that does not carry a row
// tells us nothing, and guessing the permissive value is how a check reports an observed zero it
// never measured.
struct CheckupSample {
    bool rps_known     = false, rps_running  = false;
    bool defrost_known = false, defrost_on   = false;
    bool buh_known     = false, buh_on       = false;   // either BUH step
    bool bsh_known     = false, bsh_on       = false;
    bool pump_known    = false, pump_on      = false;
    bool valve_known   = false, valve_dhw    = false;
    CheckupOperatingMode operating_mode = CheckupOperatingMode::Unknown;
    bool circulation_configured = false;
    bool circulation_known = false, circulation_on = false;

    bool bar_ok  = false;  int bar_tenths  = 0;
    bool flow_ok = false;  int flow_tenths = 0;
    bool r5t_ok  = false;  int r5t_tenths  = 0;
    OutdoorEvidence outdoor; // fresh X10A 0x20 only; optional context, never a gate

    FaultClass fault = FaultClass::Unknown;             // Unknown when no conv-203 row was read
    uint8_t retry_expected_mask = 0;                    // counters supplied by the active profile
    uint8_t retry_known_mask = 0;
    uint8_t retry_value[CHECKUP_RETRY_COUNT] = {};       // decoded counter values, each 0..7
};

enum class CheckupRunClass : uint8_t { Unknown, SpaceHeating, Dhw, Cooling };

constexpr CheckupRunClass checkup_run_class(const CheckupSample& s) {
    if (!s.valve_known) return CheckupRunClass::Unknown;
    if (s.valve_dhw) return CheckupRunClass::Dhw;
    if (s.operating_mode == CheckupOperatingMode::Heating)
        return CheckupRunClass::SpaceHeating;
    if (s.operating_mode == CheckupOperatingMode::Cooling)
        return CheckupRunClass::Cooling;
    return CheckupRunClass::Unknown;
}

// What has to survive between cycles for an EDGE to be decidable at all.
struct CheckupState {
    int64_t  last_us       = -1;      // when the previous sample was taken (monotonic)
    bool     prev_rps_known = false, prev_rps_running = false;
    bool     prev_dfr_known = false, prev_dfr_on      = false;
    bool     prev_pump_known = false, prev_pump_on    = false;
    uint16_t pump_run_s      = 0;       // continuous known-on time, reset by off/unknown/gap
    uint16_t bar_low_run_s    = 0;       // consecutive valid samples at/below documented boundary
    uint8_t  prev_retry_known_mask = 0;
    uint8_t  prev_retry_value[CHECKUP_RETRY_COUNT] = {};
    uint32_t bucket        = 0;
    bool     have_bucket   = false;
    // ── the compressor run in flight ────────────────────────────────────────────────────────────
    // Transient on purpose, and checkup_persist.hpp deliberately does not restore CheckupState: a
    // run straddling a reboot is therefore censored by construction, as is one already standing when
    // the board booted (no start edge ever opened it) and one still running when the window is read
    // (it has not completed). Those are three of the five censoring cases and none needed code.
    bool     run_open       = false;
    bool     run_class_pure = false;  // complete class readable and unchanged for every witnessed second
    CheckupRunClass run_class = CheckupRunClass::Unknown;
    uint32_t run_start_bucket = 0;    // complete-run facts age with the witnessed start edge
    uint32_t run_s          = 0;
    CheckupOutdoorStats run_outdoor; // committed only if this run completes as pure space heating
};

// Commit the completed run to its class, or to the censored tally when it could not be classified.
// One place, because the gap and recovered-OFF paths must reach the same conclusion as the normal
// stop edge. Returns true when an already sealed completed bucket changed and must be re-sealed.
inline bool checkup_close_run(CheckupState& st, CheckupBucket& b, CheckupRing* ring = nullptr,
                              uint32_t current_bucket = 0) {
    if (!st.run_open) return false;
    CheckupBucket* target = &b;
    if (ring) {
        target = ring->retained_bucket(st.run_start_bucket, current_bucket);
        if (!target) {
            // The start is outside the rolling window. Its duration cannot re-enter through the
            // stop bucket, but the completed activity remains visible as censored evidence.
            target = &b;
            st.run_class_pure = false;
        }
    }
    const bool reseal = ring && target != &b;
    if (st.run_class_pure) {
        switch (st.run_class) {
            case CheckupRunClass::Dhw:
                target->dhw_runs  = checkup_add_u8(target->dhw_runs, 1);
                target->dhw_run_s = checkup_add_u16(target->dhw_run_s, st.run_s);
                break;
            case CheckupRunClass::SpaceHeating:
                target->space_runs  = checkup_add_u8(target->space_runs, 1);
                target->space_run_s = checkup_add_u16(target->space_run_s, st.run_s);
                checkup_outdoor_merge(target->cycling_outdoor, st.run_outdoor);
                break;
            case CheckupRunClass::Cooling:
                target->cooling_runs = checkup_add_u8(target->cooling_runs, 1);
                break;
            case CheckupRunClass::Unknown:
                target->censored_runs = checkup_add_u8(target->censored_runs, 1);
                break;
        }
    } else {
        target->censored_runs = checkup_add_u8(target->censored_runs, 1);
    }
    st.run_open = st.run_class_pure = false;
    st.run_class = CheckupRunClass::Unknown;
    st.run_start_bucket = 0;
    st.run_s = 0;
    st.run_outdoor = CheckupOutdoorStats{};
    return reseal;
}

// ── DHW tank cooling / external circulation correlation ───────────────────────────────────────
// Kept in its own compact ring: CheckupBucket already occupies 864 of its guarded 896 bytes, and a
// per-hour DHW extension there would violate the deliberately measured heap/static budget.  Only
// completed clean one-hour windows are retained.  Draw-contaminated or charge/settling segments do
// not contribute observed seconds, so a plausible zero can never be bought with discarded data.
struct DhwLossBucket {
    uint16_t observed_s = 0;
    uint16_t circulation_known_s = 0;
    uint16_t circulation_on_s = 0;
    int16_t max_loss_tenths_k_h = CHECKUP_ABSENT;
    // WHAT THE PLANT REFUSED, not only what it granted. Everything above counts hours that COMPLETED;
    // with none of them the check reported `0 min of 6 h` and nothing else, which is the same reading
    // a board that booted a minute ago gives. The three fields below are the difference between
    // "not yet" and "not here": how many candidate hours were discarded, WHY, and how far the best
    // one got before it was. Without them a plant that structurally cannot grant a quiet hour is
    // indistinguishable from one that simply has not yet — and the check would say `collecting`
    // forever, which reads as "wait a little longer" when the truth is "never on this plant".
    uint16_t best_aborted_s = 0;
    uint8_t aborts = 0;
    uint8_t abort_reasons = 0;   // DHW_ABORT_* bits, OR-folded — a mask, never a ranking it cannot afford
    uint8_t windows = 0;
    uint8_t high_windows = 0;
    uint8_t high_with_pump = 0;
    uint8_t high_pump_off = 0;
};

// EXACTLY at the stated budget (24 x 16). The next field costs a decision about the budget rather
// than an edit — which is what the assert is for.
constexpr size_t DHW_LOSS_BYTES = sizeof(DhwLossBucket) * CHECKUP_BUCKETS;
static_assert(DHW_LOSS_BYTES <= 384, "DHW loss ring exceeded its static-memory budget");

// Why a candidate hour was discarded. A MASK on the bucket: several causes inside one hour are all
// true, and folding them to "the last one" would name whichever fired nearest the commit.
constexpr uint8_t DHW_ABORT_CHARGE  = 1u << 0;  // tank charge witness (3-way valve on DHW, or BSH)
constexpr uint8_t DHW_ABORT_PUMP    = 1u << 1;  // internal circulation pump stirred the hydronics
constexpr uint8_t DHW_ABORT_DRAW    = 1u << 2;  // R5T fell like a draw, not like a standing loss
constexpr uint8_t DHW_ABORT_READING = 1u << 3;  // R5T outside the plausible band
constexpr uint8_t DHW_ABORT_BLIND   = 1u << 4;  // too much of the hour went unobserved

inline const char* dhw_abort_reason_name(uint8_t bit) {
    switch (bit) {
        case DHW_ABORT_CHARGE:  return "charge";
        case DHW_ABORT_PUMP:    return "pump";
        case DHW_ABORT_DRAW:    return "draw";
        case DHW_ABORT_READING: return "reading";
        case DHW_ABORT_BLIND:   return "blind";
        default:                return "";
    }
}

struct DhwLossRing {
    DhwLossBucket buf[CHECKUP_COMPLETED_BUCKETS] = {};
    uint8_t count = 0;
    uint8_t head = 0;
    DhwLossBucket pending;

    void reset() {
        for (auto& b : buf) b = DhwLossBucket{};
        count = head = 0;
        pending = DhwLossBucket{};
    }
    void push(const DhwLossBucket& b) {
        buf[head] = b;
        head = static_cast<uint8_t>((head + 1) % CHECKUP_COMPLETED_BUCKETS);
        if (count < CHECKUP_COMPLETED_BUCKETS) count++;
    }
    void commit(uint32_t skipped) {
        push(pending);
        for (uint32_t i = 0; i < skipped && i < CHECKUP_COMPLETED_BUCKETS; i++)
            push(DhwLossBucket{});
        pending = DhwLossBucket{};
    }
};

struct DhwLossState {
    int64_t last_us = -1;
    int64_t segment_start_us = -1;
    int64_t draw_anchor_us = -1;
    // A reboot restarts esp_timer at zero, so an adopted candidate cannot express its earlier
    // start as an absolute timestamp in this boot.  The already-observed age rides separately and
    // the new boot's monotonic delta is added to it.  Zero during an ordinary uninterrupted boot.
    uint32_t segment_carried_s = 0;
    uint32_t draw_anchor_carried_s = 0;
    int segment_start_tenths = 0;
    int draw_anchor_tenths = 0;
    uint32_t segment_circulation_known_s = 0;
    uint32_t segment_circulation_on_s = 0;
    uint32_t circulation_off_run_s = 0;
    uint32_t settle_remaining_s = 0;
    // How long the charge witness has stood UNBROKEN. A charge earns the 45-minute settle only past
    // DHW_LOSS_CHARGE_MIN_S; see the constant. Deliberately NOT cleared by reset_segment(), which is
    // about the candidate hour — this is about the witness, and the two ended together only by
    // accident of the old code.
    uint32_t charge_run_s = 0;
    // Seconds inside the candidate segment during which the plant was NOT OBSERVED — a page that
    // timed out this sweep, or a gap past CHECKUP_MAX_GAP_S. Tracked rather than fatal; see
    // dhw_loss_step's blindness rule.
    uint32_t segment_blind_s = 0;
    uint32_t blind_run_s = 0;

    void reset_segment() {
        segment_start_us = draw_anchor_us = -1;
        segment_carried_s = draw_anchor_carried_s = 0;
        segment_circulation_known_s = segment_circulation_on_s = 0;
        segment_blind_s = 0;
    }
};

constexpr uint32_t DHW_LOSS_WINDOW_S = 3600;             // R5T resolves only 0.1 K
constexpr uint32_t DHW_LOSS_SETTLE_S = 45 * 60;          // issue #349 method after a tank charge
constexpr uint32_t DHW_LOSS_DRAW_WINDOW_S = 10 * 60;
// HOW LONG THE CHARGE WITNESS MUST STAND before it costs the 45-minute settle.
//
// The settle exists because a tank that was just heated redistributes for a while, so the loss
// measured across that stretch is not a standing loss. That is a claim about HEAT PUT INTO THE TANK
// — and a witness that stood for one poll cycle put none in. Without this bound the two were the
// same event: one sample of "3-way valve on DHW" cost the same 105 minutes (45 settle + a fresh
// 60-minute window) as a 40-minute charge. Measured against this header over an otherwise perfect
// 24 h with a standing tank, ONE ~1 s valve blip every 90 minutes took the day from 23 completed
// windows to ZERO, and the card then reported `0 min of 6 h` indefinitely with every input present
// and correct.
//
// The number is not a new guess: DHW_LOSS_BLIND_RUN_MAX_S already asserts, as its own load-bearing
// justification, that a tank charge cannot start, run and finish inside 120 seconds. This is that
// same claim used in the other direction, so the two cannot disagree about what a charge is.
//
// A SHORT witness is still a DISTURBANCE and still discards the candidate hour — the hydronics moved
// and the tank is no longer standing. What it no longer does is assert that heat went in. The
// asymmetry is deliberate and is the safe direction: the worst case of being wrong here is a
// candidate hour that starts 45 minutes earlier than the old rule allowed, on a tank that received
// at most ~120 s of charge — and the window measures a DROP (`drop_tenths` floors at 0), so a tank
// still warming from it reports no loss at all rather than a false one.
//
// An unmeasured gap counts as proven: a witness seen across an interval nobody watched could have
// been running for all of it, and that is the one direction in which guessing short would admit a
// real charge's tail as tank loss.
constexpr uint32_t DHW_LOSS_CHARGE_MIN_S = 120;
// HOW MANY DISCARDED HOURS make "this plant does not grant one" a statement rather than a guess.
// Six — the same number of clean hours the check needs before it may say the tank is fine. To claim
// the plant is healthy it wants a full day AND six completed hours; to claim it cannot be judged
// here it wants a full day AND six DISCARDED ones. Symmetric on purpose: both are conclusions about
// the whole window, and neither may be reached from a single event.
constexpr uint32_t DHW_LOSS_BLOCKED_MIN_ABORTS = 6;
// KNOWN BLIND BAND — read this before tuning either constant.
//
// The anchor is re-established every <= DHW_LOSS_DRAW_WINDOW_S and a drop of this many tenths from it
// resets the candidate segment. A STEADY decline therefore trips the draw filter as soon as it moves
// this far inside the window, so above that rate no one-hour window ever completes and the check
// reports `collecting` FOREVER rather than a finding.
//
// Measured against this header (12 h of ideal 1 Hz samples, tank standing, pump/BSH off,
// circulation known-off; completed windows out of 11):
//     0.3 K/h -> 11    (healthy, no circulation — the project's own reference figure)
//     1.2 K/h -> 11    (healthy WITH circulation — the reference figure the leak must beat)
//     1.8 K/h -> 11
//     1.84 K/h -> 10   (degradation starts)
//     1.90 K/h -> 0    (blind from here up)
//     6.0 K/h -> 0
// So the usable band is DHW_LOSS_HIGH_TENTHS_K_H (0.8 K/h) up to ~1.85 K/h. A leaking diverter — the
// case this check exists for, and by definition worse than the 1.2 K/h healthy-with-circulation
// figure — can sit in or above the blind band, where the symptom is indistinguishable from a window
// that is merely young.
//
// Widening it is a DOMAIN decision, not a code cleanup, and it trades in the direction this project
// normally refuses: a higher cut lets a real draw be counted as a standing loss, i.e. it buys
// coverage with the risk of reporting a leak that is not there. That wants the reference
// installation's own draw profile, so it belongs with a measurement and $domain-review rather than
// with a guessed constant.
//
// The stated cut and the real one also differ: at 0.1 K resolution both the anchor and the sample are
// floored, so 4 tenths is reached at ~1.85 K/h rather than at the 2.1 K/h ">0.35 K in ten minutes"
// arithmetic suggests.
constexpr int      DHW_LOSS_DRAW_DROP_TENTHS = 4;        // ~1.85 K/h effective, see above
constexpr int      DHW_LOSS_HIGH_TENTHS_K_H = 8;         // project heuristic, not a Daikin limit
// ── BLINDNESS: missing evidence is not a disqualifying plant state ─────────────────────────────
// A candidate segment has to survive a full hour, and every input it needs arrives from the X10A
// sweep — where ONE page that does not answer removes ALL of its rows from that cycle's sample
// (hp_poll.cpp replaces the cache wholesale with the rows that answered). The valve, the internal
// pump and the BSH live on page 0x60 and R5T on 0x61, so a single timed-out read makes the whole
// sample unreadable for one second out of 3600.
//
// Treating that as ineligible — which is what "unknown is not off" means everywhere else in this
// header — discarded the entire accumulated hour. On the reference installation that is not a
// corner case but the NORMAL case: 47 timeouts in 8.2 h of uptime, i.e. one relevant page missing
// roughly every hour, against a segment that needs an unbroken hour.
//
// MEASURED, because the first account of this was overstated and the correction is the interesting
// part. Replaying that installation's real 24 h through this header — drop-outs injected at the
// observed rate, 25 seeds — the old rule completes a mean of 6.1 windows (min 4, max 9) against the
// 12 the same day yields with perfect vision, and this one 11.6 (min 10). So the cost is roughly
// HALF the evidence and therefore about twice as long to reach DHW_LOSS_REQUIRED_S — not a check
// that never speaks. What the owner sees is the front of that distribution: through the first 8.2 h
// of a boot only two windows are achievable at all, the drop-outs took both, and the card read
// `collecting`, 0 min of 6 h, on a plant whose R5T, valve, pump and BSH rows were all present and
// correct. Nothing else in the checkup behaves this way: checkup_step simply does not accrue the
// second it could not read, and keeps everything it already measured.
//
// So a sample the firmware could not READ is BLIND time, not a state change: the tank did not start
// charging because a UART read timed out. It is carried, budgeted and — the half that keeps this
// honest — SUBTRACTED from the seconds the window claims to have observed.
//
// Both bounds exist to stop a window being assembled out of absence. The RUN bound is the load-
// bearing one: a tank charge cannot start, run and finish inside it, so no unobserved stretch can
// hide the event that arms the settle timer. The TOTAL is the same 90%-evidence shape the
// circulation witness already uses.
constexpr uint32_t DHW_LOSS_BLIND_RUN_MAX_S = 120;
constexpr uint32_t DHW_LOSS_BLIND_MAX_PCT   = 10;
constexpr uint32_t DHW_LOSS_CIRC_KNOWN_PCT = 90;
constexpr uint32_t DHW_LOSS_CIRC_MIN_ON_S = 5 * 60;
constexpr uint32_t DHW_LOSS_CIRC_OFF_SETTLE_S = 2 * 3600;
constexpr uint32_t DHW_LOSS_REQUIRED_S = 6 * 3600;       // plus a complete 24 h lifecycle for clear
// The device cannot measure its own downtime.  Intentional esp_restart() on this board is a few
// seconds, so use the same bounded, explicit blind allowance as the persisted state-age table.  It
// advances wall-clock age but never observed evidence.
constexpr uint32_t DHW_LOSS_REBOOT_BLIND_S = 5;

constexpr uint8_t DHW_LOSS_CARRY_SEGMENT = 1u << 0;
constexpr uint8_t DHW_LOSS_CARRY_DRAW     = 1u << 1;

// Wire-neutral checkpoint of the in-flight filter.  Absolute esp_timer timestamps cannot cross a
// reboot; ages can.  The storage seal lives in checkup_persist.hpp, while these translations stay
// beside the state machine they must agree with and are host-tested without ESP-IDF.
struct DhwLossCarry {
    uint32_t segment_elapsed_s = 0;
    uint32_t draw_anchor_age_s = 0;
    uint32_t segment_circulation_known_s = 0;
    uint32_t segment_circulation_on_s = 0;
    uint32_t settle_remaining_s = 0;
    uint32_t charge_run_s = 0;
    uint32_t segment_blind_s = 0;
    uint32_t blind_run_s = 0;
    int16_t segment_start_tenths = 0;
    int16_t draw_anchor_tenths = 0;
    uint8_t flags = 0;
};

inline uint32_t dhw_loss_age_s(int64_t now_us, int64_t anchor_us, uint32_t carried_s = 0) {
    if (anchor_us < 0 || now_us < anchor_us) return carried_s;
    const uint64_t live = static_cast<uint64_t>(now_us - anchor_us) / 1000000u;
    const uint64_t total = static_cast<uint64_t>(carried_s) + live;
    return total > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(total);
}

inline DhwLossCarry dhw_loss_checkpoint(const DhwLossState& st, int64_t now_us) {
    DhwLossCarry c;
    c.segment_circulation_known_s = st.segment_circulation_known_s;
    c.segment_circulation_on_s = st.segment_circulation_on_s;
    c.settle_remaining_s = st.settle_remaining_s;
    // A charge in progress at the reboot keeps its accumulated run: restarting the clock would let a
    // 40-minute charge that straddles an OTA look like a fresh blip and skip its settle entirely.
    c.charge_run_s = st.charge_run_s;
    c.segment_blind_s = st.segment_blind_s;
    c.blind_run_s = st.blind_run_s;
    c.segment_start_tenths = static_cast<int16_t>(st.segment_start_tenths);
    c.draw_anchor_tenths = static_cast<int16_t>(st.draw_anchor_tenths);
    if (st.segment_start_us >= 0) {
        c.flags |= DHW_LOSS_CARRY_SEGMENT;
        c.segment_elapsed_s = dhw_loss_age_s(now_us, st.segment_start_us,
                                             st.segment_carried_s);
    }
    if (st.draw_anchor_us >= 0) {
        c.flags |= DHW_LOSS_CARRY_DRAW;
        c.draw_anchor_age_s = dhw_loss_age_s(now_us, st.draw_anchor_us,
                                             st.draw_anchor_carried_s);
    }
    return c;
}

// Book `blind` unobserved seconds against the candidate segment. Returns false when the segment can
// no longer be assembled out of what was actually seen, and the caller ends it.
inline bool dhw_loss_blind_ok(DhwLossState& st, uint32_t blind) {
    // Saturating, like the two event counters: a wrap would turn a permanently blind board into a
    // segment that looks fully observed.
    st.blind_run_s = std::min<uint32_t>(UINT32_MAX - blind, st.blind_run_s) + blind;
    st.segment_blind_s = std::min<uint32_t>(UINT32_MAX - blind, st.segment_blind_s) + blind;
    return st.blind_run_s <= DHW_LOSS_BLIND_RUN_MAX_S &&
           st.segment_blind_s <= DHW_LOSS_WINDOW_S * DHW_LOSS_BLIND_MAX_PCT / 100;
}

inline void dhw_loss_adopt(DhwLossState& st, const DhwLossCarry& c, int64_t now_us) {
    st = DhwLossState{};
    st.last_us = now_us;
    st.settle_remaining_s = c.settle_remaining_s;
    st.charge_run_s = c.charge_run_s;
    if (!(c.flags & DHW_LOSS_CARRY_SEGMENT)) return;

    st.segment_start_us = now_us;
    st.segment_carried_s = std::min<uint32_t>(UINT32_MAX - DHW_LOSS_REBOOT_BLIND_S,
                                              c.segment_elapsed_s) +
                           DHW_LOSS_REBOOT_BLIND_S;
    st.segment_start_tenths = c.segment_start_tenths;
    st.segment_circulation_known_s = c.segment_circulation_known_s;
    st.segment_circulation_on_s = c.segment_circulation_on_s;
    st.segment_blind_s = c.segment_blind_s;
    st.blind_run_s = c.blind_run_s;
    // Attribution as "pump continuously off" cannot cross an interval nobody observed.
    st.circulation_off_run_s = 0;

    if (c.flags & DHW_LOSS_CARRY_DRAW) {
        st.draw_anchor_us = now_us;
        st.draw_anchor_carried_s = std::min<uint32_t>(UINT32_MAX - DHW_LOSS_REBOOT_BLIND_S,
                                                       c.draw_anchor_age_s) +
                                    DHW_LOSS_REBOOT_BLIND_S;
        st.draw_anchor_tenths = c.draw_anchor_tenths;
    }
    if (!dhw_loss_blind_ok(st, DHW_LOSS_REBOOT_BLIND_S)) st.reset_segment();
}

// Discard the candidate hour and RECORD that it happened. Only a LIVE candidate is an abort: the
// settle branch calls reset_segment() on every one of its cycles, and counting those would report
// 2250 discarded hours for one tank charge. The best-reached figure is folded here rather than at
// the commit for the same reason it is worth keeping at all — the interesting candidate is the one
// that was killed, not the one still running.
inline void dhw_loss_abort(DhwLossState& st, DhwLossBucket& b, uint8_t reason, int64_t now_us) {
    if (st.segment_start_us >= 0) {
        const uint32_t elapsed = dhw_loss_age_s(now_us, st.segment_start_us, st.segment_carried_s);
        const uint32_t observed = elapsed - std::min(elapsed, st.segment_blind_s);
        if (observed > b.best_aborted_s)
            b.best_aborted_s = static_cast<uint16_t>(std::min<uint32_t>(observed, UINT16_MAX));
        b.aborts = checkup_add_u8(b.aborts, 1);
        b.abort_reasons = static_cast<uint8_t>(b.abort_reasons | reason);
    }
    st.reset_segment();
}

struct DhwLossProgress {
    uint32_t candidate_observed_s = 0;
    uint32_t settle_remaining_s = 0;
};

inline DhwLossProgress dhw_loss_progress(const DhwLossState& st, int64_t now_us) {
    DhwLossProgress p;
    p.settle_remaining_s = st.settle_remaining_s;
    if (st.segment_start_us < 0) return p;
    const uint32_t elapsed = dhw_loss_age_s(now_us, st.segment_start_us,
                                            st.segment_carried_s);
    p.candidate_observed_s = elapsed - std::min(elapsed, st.segment_blind_s);
    return p;
}

inline void dhw_loss_step(DhwLossState& st, DhwLossBucket& b, const CheckupSample& s,
                          int64_t now_us) {
    uint32_t dt = 0;
    uint32_t gap_s = 0;
    bool continuous = false;
    if (st.last_us >= 0 && now_us >= st.last_us) {
        const int64_t gap_us = now_us - st.last_us;
        gap_s = static_cast<uint32_t>(now_us / 1000000 - st.last_us / 1000000);
        if (gap_us <= static_cast<int64_t>(CHECKUP_MAX_GAP_S) * 1000000) {
            dt = gap_s;
            continuous = true;
        }
    }
    st.last_us = now_us;

    if (continuous && s.circulation_configured && s.circulation_known && !s.circulation_on)
        st.circulation_off_run_s =
            std::min<uint32_t>(UINT32_MAX - dt, st.circulation_off_run_s) + dt;
    else
        // Plain `else`: the condition this replaced was the exact De Morgan negation of the `if`,
        // so it was unconditionally true where it was reached — stating it twice invited an edit to
        // one half that silently stopped clearing the run.
        st.circulation_off_run_s = 0;

    const bool states_known = s.valve_known && s.pump_known && s.bsh_known;
    // Any positive charge witness starts settling even when another state row timed out in this
    // sweep. Requiring all three rows here would miss the charge and could admit its steep tail as
    // tank loss as soon as the timed-out row recovered.
    const bool heating_tank = (s.valve_known && s.valve_dhw) || (s.bsh_known && s.bsh_on);
    if (heating_tank) {
        // An interval nobody measured counts as proven charge time — see DHW_LOSS_CHARGE_MIN_S.
        const uint32_t seen = continuous ? dt : DHW_LOSS_CHARGE_MIN_S;
        st.charge_run_s = std::min<uint32_t>(UINT32_MAX - seen, st.charge_run_s) + seen;
        if (st.charge_run_s >= DHW_LOSS_CHARGE_MIN_S) st.settle_remaining_s = DHW_LOSS_SETTLE_S;
        // The candidate ends either way: brief or not, the hydronics moved and the tank is no
        // longer standing. Only the 45-minute settle is withheld from a witness too short to have
        // put heat in.
        dhw_loss_abort(st, b, DHW_ABORT_CHARGE, now_us);
        return;
    }
    // AN UNREADABLE ROW IS NOT PROOF THE CHARGE ENDED — the same "unknown is not off" rule the
    // witness itself follows, and the direction that matters most here. Both witnesses live on page
    // 0x60; one timed-out sweep inside a real 40-minute charge would otherwise restart the
    // two-minute clock, and a charge that finished within two minutes of that timeout would arm no
    // settle at all and admit its own tail as standing tank loss — the false-leak direction this
    // check must never fail in. At the reference installation's measured timeout rate (47 in 8.2 h)
    // that is not a corner case. Staying armed across a blind stretch only ever spends MORE settle.
    if (s.valve_known && s.bsh_known) st.charge_run_s = 0;
    if (!continuous) {
        // Past CHECKUP_MAX_GAP_S the firmware was not watching — a wedged read, a burst of timed-out
        // pages, a reboot. That is BLIND time of a known length, not a plant state, so it is
        // budgeted exactly like an unreadable row rather than discarding the hour outright.
        if (!dhw_loss_blind_ok(st, gap_s)) dhw_loss_abort(st, b, DHW_ABORT_BLIND, now_us);
        return;
    }
    if (st.settle_remaining_s) {
        st.settle_remaining_s = dt >= st.settle_remaining_s ? 0 : st.settle_remaining_s - dt;
        // Not an abort: the charge that armed this already booked one, and there is no candidate
        // left to discard. Counting these would report one aborted hour per second of settling.
        st.reset_segment();
        return;
    }

    // A state the sweep could SEE that is incompatible with a standing tank ends the segment. The
    // two charge witnesses already returned above; what is left is the internal pump (space heating
    // stirs the hydronics R5T sits in) and an R5T outside the plausible band. `known` is required on
    // each: an unread row is judged one branch further down, never here.
    if (s.pump_known && s.pump_on) {
        dhw_loss_abort(st, b, DHW_ABORT_PUMP, now_us);
        return;
    }
    if (s.r5t_ok && (s.r5t_tenths < 0 || s.r5t_tenths > 900)) {
        dhw_loss_abort(st, b, DHW_ABORT_READING, now_us);
        return;
    }

    // Nothing said the tank is busy — but did the sweep actually READ it? A page that did not answer
    // leaves every row on it absent from this sample (hp_poll replaces the cache with the rows that
    // answered), and the tank did not change state because a UART read timed out.
    if (!states_known || !s.r5t_ok) {
        if (!dhw_loss_blind_ok(st, dt)) dhw_loss_abort(st, b, DHW_ABORT_BLIND, now_us);
        return;
    }

    if (st.blind_run_s) {
        // Vision is back. Judge the whole unobserved stretch against the anchor that was standing
        // when it began — a draw hidden inside it shows up here as one accumulated drop — and only
        // then re-arm the anchor at a temperature that was actually measured.
        if (st.draw_anchor_us >= 0 &&
            st.draw_anchor_tenths - s.r5t_tenths >= DHW_LOSS_DRAW_DROP_TENTHS)
            dhw_loss_abort(st, b, DHW_ABORT_DRAW, now_us);
        st.draw_anchor_us = now_us;
        st.draw_anchor_carried_s = 0;
        st.draw_anchor_tenths = s.r5t_tenths;
        st.blind_run_s = 0;
    }

    if (st.draw_anchor_us < 0 || now_us < st.draw_anchor_us ||
        dhw_loss_age_s(now_us, st.draw_anchor_us, st.draw_anchor_carried_s) >
            DHW_LOSS_DRAW_WINDOW_S) {
        st.draw_anchor_us = now_us;
        st.draw_anchor_carried_s = 0;
        st.draw_anchor_tenths = s.r5t_tenths;
    } else if (st.draw_anchor_tenths - s.r5t_tenths >= DHW_LOSS_DRAW_DROP_TENTHS) {
        // A draw can mimic a spectacular cooling rate. Discard everything since the anchor, then
        // start a new candidate segment at the post-draw temperature.
        dhw_loss_abort(st, b, DHW_ABORT_DRAW, now_us);
        st.draw_anchor_us = now_us;
        st.draw_anchor_carried_s = 0;
        st.draw_anchor_tenths = s.r5t_tenths;
    }

    if (st.segment_start_us < 0) {
        st.segment_start_us = now_us;
        st.segment_carried_s = 0;
        st.segment_start_tenths = s.r5t_tenths;
        return;
    }
    if (s.circulation_configured && s.circulation_known) {
        st.segment_circulation_known_s =
            std::min<uint32_t>(UINT32_MAX - dt, st.segment_circulation_known_s) + dt;
        if (s.circulation_on)
            st.segment_circulation_on_s =
                std::min<uint32_t>(UINT32_MAX - dt, st.segment_circulation_on_s) + dt;
    }

    const uint32_t elapsed_s = dhw_loss_age_s(now_us, st.segment_start_us,
                                              st.segment_carried_s);
    if (elapsed_s < DHW_LOSS_WINDOW_S) return;
    const int drop_tenths = std::max(0, st.segment_start_tenths - s.r5t_tenths);
    // The RATE is per wall-clock hour: both endpoints are measured and the tank cooled for the whole
    // span whether or not the firmware was looking. The EVIDENCE CLOCK is not — observed_s counts
    // only the seconds actually watched, so a window can never be assembled out of absence and
    // `0 min of 6 h` keeps meaning what it says.
    const uint32_t observed_s = elapsed_s - std::min(elapsed_s, st.segment_blind_s);
    const int loss_tenths_k_h = static_cast<int>(
        static_cast<uint64_t>(drop_tenths) * DHW_LOSS_WINDOW_S / elapsed_s);
    b.observed_s = checkup_add_u16(b.observed_s, observed_s);
    b.circulation_known_s = checkup_add_u16(
        b.circulation_known_s, st.segment_circulation_known_s);
    b.circulation_on_s = checkup_add_u16(b.circulation_on_s, st.segment_circulation_on_s);
    b.windows = checkup_add_u8(b.windows, 1);
    if (b.max_loss_tenths_k_h == CHECKUP_ABSENT ||
        loss_tenths_k_h > b.max_loss_tenths_k_h)
        b.max_loss_tenths_k_h = static_cast<int16_t>(loss_tenths_k_h);

    if (loss_tenths_k_h >= DHW_LOSS_HIGH_TENTHS_K_H) {
        b.high_windows = checkup_add_u8(b.high_windows, 1);
        // Against the OBSERVED seconds, not the span: the witness is only decoded on cycles this
        // segment could see, so measuring its coverage against blind time would charge it for
        // silence on a different bus.
        const bool source_covered = st.segment_circulation_known_s * 100u >=
                                    observed_s * DHW_LOSS_CIRC_KNOWN_PCT;
        if (source_covered && st.segment_circulation_on_s >= DHW_LOSS_CIRC_MIN_ON_S)
            b.high_with_pump = checkup_add_u8(b.high_with_pump, 1);
        else if (source_covered && st.segment_circulation_on_s == 0 &&
                 st.circulation_off_run_s >= DHW_LOSS_CIRC_OFF_SETTLE_S)
            b.high_pump_off = checkup_add_u8(b.high_pump_off, 1);
    }

    // Adjacent, non-overlapping one-hour windows preserve the sensor resolution and keep every
    // completed statistic inside exactly one hourly retention bucket.
    st.segment_start_us = now_us;
    st.segment_carried_s = 0;
    st.segment_start_tenths = s.r5t_tenths;
    st.segment_circulation_known_s = st.segment_circulation_on_s = 0;
    // The blind budget is PER WINDOW like the two circulation counters beside it. Carrying it over
    // would let the first hour's drop-outs spend the second hour's allowance, so a long quiet
    // stretch would grow steadily more likely to be rejected the further into it the plant got.
    st.segment_blind_s = 0;
}

// Do not sample a pump's first minute as the day's hydraulic minimum. Ramp-up, valve motion and air
// purge are real transient states but not the steady circuit flow a reader compares with the model's
// installation manual.
constexpr uint32_t CHECKUP_FLOW_RUNUP_S = 60;
// Daikin Altherma 3 R W installer reference guide 4P496758-1B, §12.3.4, states that pump-inlet
// pressure must be >1 bar.
// Confirm a below-boundary state for one continuous minute so one corrupt frame cannot make a
// day-long red verdict. The raw minimum is still retained and surfaced immediately; this debounce
// affects only the warning strength, never the measurement statistic.
constexpr int      CHECKUP_BAR_WARN_TENTHS = 10;
constexpr uint32_t CHECKUP_PRESSURE_CONFIRM_S = 60;

// Fold one poll cycle into `st.pending`. `now_us` is the monotonic clock. On a continuous hourly
// boundary the caller commits first and sets last_us=now: the current edge/fault lands in the new
// bucket while the straddling duration is conservatively discarded instead of outliving 24 hours.
//
// Away from a boundary the whole delta is booked into the open bucket.
inline bool checkup_step(CheckupState& st, CheckupBucket& b, const CheckupSample& s, int64_t now_us,
                         CheckupRing* ring = nullptr) {
    bool reseal = false;
    const uint32_t current_bucket = checkup_bucket(now_us);
    // ── continuity ──────────────────────────────────────────────────────────────────────────────
    // A gap longer than CHECKUP_MAX_GAP_S means the firmware was not watching. Seconds are not
    // accrued across it and — the half that matters — no transition is read across it either: the
    // previous state is DISCARDED, so a compressor that was off before a two-minute bus stall and
    // running after it does not book a start that may have been three.
    uint32_t dt = 0;
    bool continuous = false;
    if (st.last_us >= 0 && now_us >= st.last_us) {
        const int64_t gap_us = now_us - st.last_us;
        if (gap_us <= static_cast<int64_t>(CHECKUP_MAX_GAP_S) * 1000000) {
            // Quantise ABSOLUTE timestamps, not every interval separately. The poll loop sleeps one
            // second after a serial sweep, so a real cadence is commonly ~1.2–1.3 s. Flooring each
            // interval to 1 s would permanently lose that fraction and make the 90% evidence gate
            // unreachable; this telescopes over a continuous segment with <1 s total error.
            dt = static_cast<uint32_t>(now_us / 1000000 - st.last_us / 1000000);
            continuous = true;
        }
    }
    st.last_us = now_us;

    // Hydronic pressure and flow cannot physically be negative on these unidirectional sensors.
    // The shared signed converter can still decode a corrupt frame that way; treat it as missing
    // evidence rather than turning a negative pressure into a warning whose JSON value becomes null.
    const bool bar_valid = s.bar_ok && s.bar_tenths >= 0;
    const bool flow_valid = s.flow_ok && s.flow_tenths >= 0;
    bool flow_eligible = false;
    if (continuous) {
        const bool any_known = s.rps_known || s.defrost_known || s.buh_known || s.bsh_known ||
                               s.pump_known || bar_valid || flow_valid ||
                               s.fault != FaultClass::Unknown || s.retry_known_mask;
        if (any_known) b.covered_s = checkup_add_u16(b.covered_s, dt);
        if (s.rps_known) {
            b.rps_observed_s = checkup_add_u16(b.rps_observed_s, dt);
            if (s.rps_running) b.run_s = checkup_add_u16(b.run_s, dt);
        }
        // BOTH witnesses readable in THIS sample. The pairing is the same bias dfr_pair_observed_s
        // exists to prevent; here it is also the clock that decides whether the class split may be
        // believed at all.
        const bool class_state_known = s.valve_known &&
            (s.valve_dhw || s.operating_mode != CheckupOperatingMode::Unknown);
        if (s.rps_known && class_state_known)
            b.class_observed_s = checkup_add_u16(b.class_observed_s, dt);
        if (s.defrost_known) b.dfr_observed_s = checkup_add_u16(b.dfr_observed_s, dt);
        // The defrost share is a ratio of simultaneously-known states. Counting defrost time from
        // one page against compressor time observed on another would bias low whenever the defrost
        // page timed out — exactly the false-clear direction this checkup must avoid.
        if (s.defrost_known && s.rps_known) {
            b.dfr_pair_observed_s = checkup_add_u16(b.dfr_pair_observed_s, dt);
            if (s.rps_running) {
                b.dfr_run_s = checkup_add_u16(b.dfr_run_s, dt);
                if (s.defrost_on) b.defrost_s = checkup_add_u16(b.defrost_s, dt);
                checkup_outdoor_add(b.defrost_outdoor, s.outdoor);
            }
        }
        if (s.buh_known) {
            b.buh_observed_s = checkup_add_u16(b.buh_observed_s, dt);
            if (s.buh_on) b.buh_s = checkup_add_u16(b.buh_s, dt);
        }
        if (s.bsh_known) {
            b.bsh_observed_s = checkup_add_u16(b.bsh_observed_s, dt);
            if (s.bsh_on) b.bsh_s = checkup_add_u16(b.bsh_s, dt);
        }
        if (bar_valid) {
            b.bar_observed_s = checkup_add_u16(b.bar_observed_s, dt);
            if (s.bar_tenths <= CHECKUP_BAR_WARN_TENTHS) {
                st.bar_low_run_s = checkup_add_u16(st.bar_low_run_s, dt);
                if (st.bar_low_run_s >= CHECKUP_PRESSURE_CONFIRM_S)
                    b.flags |= CHECKUP_F_LOW_BAR;
            } else {
                st.bar_low_run_s = 0;
            }
        } else {
            st.bar_low_run_s = 0;
        }

        uint32_t flow_dt = 0;
        if (s.pump_known && s.pump_on) {
            const uint32_t before = st.pump_run_s;
            if (st.prev_pump_known && st.prev_pump_on)
                st.pump_run_s = checkup_add_u16(st.pump_run_s, dt);
            else
                st.pump_run_s = 0; // first known-on sample is the run-up baseline, not elapsed on-time
            if (st.pump_run_s > CHECKUP_FLOW_RUNUP_S)
                flow_dt = before >= CHECKUP_FLOW_RUNUP_S
                        ? dt
                        : st.pump_run_s - CHECKUP_FLOW_RUNUP_S;
            flow_eligible = st.pump_run_s >= CHECKUP_FLOW_RUNUP_S && flow_valid;
            if (flow_eligible && flow_dt)
                b.flow_observed_s = checkup_add_u16(b.flow_observed_s, flow_dt);
        } else {
            st.pump_run_s = 0;
        }

        // Retry evidence exists only when every expected counter has comparable endpoints and the
        // compressor witness is readable at both. A strict increase is an event regardless of
        // whether it becomes visible just before, during or just after an RPS transition; restricting
        // it to running→running samples silently loses exactly those boundary updates. A decrease is
        // an undocumented reset/clamp/wrap candidate, so that interval is neither an event nor
        // no-event evidence.
        bool retry_comparable = s.retry_expected_mask &&
            (s.retry_known_mask & s.retry_expected_mask) == s.retry_expected_mask &&
            (st.prev_retry_known_mask & s.retry_expected_mask) == s.retry_expected_mask &&
            st.prev_rps_known && s.rps_known;
        bool retry_increased = false;
        if (retry_comparable) {
            for (size_t i = 0; i < CHECKUP_RETRY_COUNT; i++) {
                if (!(s.retry_expected_mask & (1u << i))) continue;
                if (s.retry_value[i] < st.prev_retry_value[i]) {
                    retry_comparable = false;
                    break;
                }
                if (s.retry_value[i] > st.prev_retry_value[i]) retry_increased = true;
            }
        }
        if (retry_comparable) {
            b.retry_observed_s = checkup_add_u16(b.retry_observed_s, dt);
            if (retry_increased) b.flags |= CHECKUP_F_RETRY;
        }

        // Edges. Both sides must be KNOWN — an unreadable cycle in the middle of a run breaks the
        // chain rather than manufacturing a stop and a start on either side of itself.
        const bool rps_edge_known = st.prev_rps_known && s.rps_known;
        if (rps_edge_known && !st.prev_rps_running && s.rps_running) {
            // An older run whose stop hid inside an unreadable interval must not be overwritten by
            // the new start. It completed, but neither its duration nor class survived the gap.
            if (st.run_open) {
                st.run_class_pure = false;
                reseal |= checkup_close_run(st, b, ring, current_bucket);
            }
            b.starts = checkup_add_u8(b.starts, 1);
            // Open a run. Tank/space comes from the valve; a space-side run additionally needs the
            // hydronic mode so Cooling can never be relabelled as space heating.
            st.run_open       = true;
            st.run_s          = 0;
            st.run_class      = checkup_run_class(s);
            st.run_class_pure = st.run_class != CheckupRunClass::Unknown;
            st.run_start_bucket = current_bucket;
            st.run_outdoor = CheckupOutdoorStats{};
        }
        // Carry the run in flight. A class input that stops answering or changes forfeits the class
        // but not the run: it still completes and is counted as censored. An unreadable compressor
        // row forfeits it too — a duration nobody watched must not enter a mean.
        if (st.run_open) {
            if (!s.rps_known) {
                st.run_class_pure = false;
            } else if (s.rps_running) {
                st.run_s += dt;
                const CheckupRunClass current_class = checkup_run_class(s);
                if (current_class == CheckupRunClass::Unknown || current_class != st.run_class)
                    st.run_class_pure = false;
                if (st.run_class_pure && st.run_class == CheckupRunClass::SpaceHeating)
                    checkup_outdoor_add(st.run_outdoor, s.outdoor);
            }
        }
        // A known OFF completes every open run. With a known ON predecessor it is the normal edge;
        // after an unreadable sample it is still a completion, but necessarily censored.
        if (st.run_open && s.rps_known && !s.rps_running) {
            if (!rps_edge_known || !st.prev_rps_running) st.run_class_pure = false;
            reseal |= checkup_close_run(st, b, ring, current_bucket);
        }
        if (st.prev_dfr_known && s.defrost_known && !st.prev_dfr_on && s.defrost_on) {
            b.defrosts = checkup_add_u8(b.defrosts, 1);
            if (st.prev_rps_known && s.rps_known)
                b.paired_defrosts = checkup_add_u8(b.paired_defrosts, 1);
        }

        // Absolute non-zero values remain baselines, never events; only the comparable delta above
        // says that an increase occurred inside this observation window.
    } else {
        st.pump_run_s = 0;
        st.bar_low_run_s = 0;
        // Past the gap bound the firmware was not watching, so a run open across it has neither a
        // witnessed length nor a provable class. It is closed as CENSORED rather than dropped: it
        // happened, and the count is what stops "no verdict" from reading as "nothing ran".
        st.run_class_pure = false;
        reseal |= checkup_close_run(st, b, ring, current_bucket);
    }

    // ── minima and flags — sampled, not integrated, so they need no continuity ───────────────────
    // Pressure is the RAW lowest valid sample. The separate CHECKUP_F_LOW_BAR flag above controls
    // whether a below-boundary sample was persistent enough for Warn; debounce must not rewrite the
    // measurement into a more reassuring minimum.
    if (bar_valid && (b.min_bar == CHECKUP_ABSENT || s.bar_tenths < b.min_bar))
        b.min_bar = static_cast<int16_t>(s.bar_tenths);

    // Flow is only a comparable circuit measurement after a continuously-running pump has completed
    // its run-up; a stopped/newly-started pump reading ~0 l/min is neither a restriction nor news.
    if (flow_eligible && (b.min_flow == CHECKUP_ABSENT || s.flow_tenths < b.min_flow))
        b.min_flow = static_cast<int16_t>(s.flow_tenths);

    if (fault_error_active(s.fault))   b.flags |= CHECKUP_F_FAULT;
    if (fault_warning_active(s.fault)) b.flags |= CHECKUP_F_WARNING;

    st.prev_rps_known   = s.rps_known;
    st.prev_rps_running = s.rps_running;
    st.prev_dfr_known   = s.defrost_known;
    st.prev_dfr_on      = s.defrost_on;
    st.prev_pump_known  = s.pump_known;
    st.prev_pump_on     = s.pump_on;
    st.prev_retry_known_mask = s.retry_known_mask;
    for (size_t i = 0; i < CHECKUP_RETRY_COUNT; i++) st.prev_retry_value[i] = s.retry_value[i];
    return reseal;
}

// ── The window ──────────────────────────────────────────────────────────────────────────────────
struct CheckupWindow {
    bool     full_span       = false; // this boot has crossed a full 24 h before any "clear" verdict
    uint32_t covered_s       = 0;
    uint32_t rps_observed_s  = 0;
    uint32_t run_s           = 0;
    uint32_t class_observed_s = 0;
    uint32_t space_run_s     = 0;
    uint32_t dhw_run_s       = 0;
    uint32_t space_runs      = 0;
    uint32_t dhw_runs        = 0;
    uint32_t cooling_runs    = 0;
    uint32_t censored_runs   = 0;
    uint32_t dfr_observed_s  = 0;
    uint32_t dfr_pair_observed_s = 0;
    uint32_t dfr_run_s       = 0;
    uint32_t defrost_s       = 0;
    uint32_t buh_observed_s  = 0;
    uint32_t buh_s           = 0;
    uint32_t bsh_observed_s  = 0;
    uint32_t bsh_s           = 0;
    uint32_t bar_observed_s  = 0;
    uint32_t flow_observed_s = 0;
    uint32_t retry_observed_s = 0;
    uint32_t starts    = 0;
    uint32_t defrosts  = 0;
    uint32_t paired_defrosts = 0;
    int      min_bar   = CHECKUP_ABSENT;
    int      min_flow  = CHECKUP_ABSENT;
    uint8_t  flags     = 0;
    // Wider count/sum live only on the evaluating stack; the persisted per-hour representation
    // above stays compact while a full 24 h at one sample per second remains representable.
    int      cycling_outdoor_min_tenths = CHECKUP_ABSENT;
    int64_t  cycling_outdoor_sum_tenths = 0;
    uint32_t cycling_outdoor_samples = 0;
    int      defrost_outdoor_min_tenths = CHECKUP_ABSENT;
    int64_t  defrost_outdoor_sum_tenths = 0;
    uint32_t defrost_outdoor_samples = 0;
};

// Sum the whole ring plus the hour still being accumulated.
inline CheckupWindow checkup_aggregate(const CheckupRing& r) {
    CheckupWindow w;
    w.full_span = r.full_span();
    auto fold = [&w](const CheckupBucket& b) {
        w.covered_s       += b.covered_s;
        w.rps_observed_s  += b.rps_observed_s;
        w.run_s           += b.run_s;
        w.class_observed_s += b.class_observed_s;
        w.space_run_s     += b.space_run_s;
        w.dhw_run_s       += b.dhw_run_s;
        w.space_runs      += b.space_runs;
        w.dhw_runs        += b.dhw_runs;
        w.cooling_runs    += b.cooling_runs;
        w.censored_runs   += b.censored_runs;
        w.dfr_observed_s  += b.dfr_observed_s;
        w.dfr_pair_observed_s += b.dfr_pair_observed_s;
        w.dfr_run_s       += b.dfr_run_s;
        w.defrost_s       += b.defrost_s;
        w.buh_observed_s  += b.buh_observed_s;
        w.buh_s           += b.buh_s;
        w.bsh_observed_s  += b.bsh_observed_s;
        w.bsh_s           += b.bsh_s;
        w.bar_observed_s  += b.bar_observed_s;
        w.flow_observed_s += b.flow_observed_s;
        w.retry_observed_s += b.retry_observed_s;
        w.starts    += b.starts;
        w.defrosts  += b.defrosts;
        w.paired_defrosts += b.paired_defrosts;
        w.flags     |= b.flags;
        if (b.cycling_outdoor.samples) {
            w.cycling_outdoor_samples += b.cycling_outdoor.samples;
            w.cycling_outdoor_sum_tenths += b.cycling_outdoor.sum_tenths;
            if (w.cycling_outdoor_min_tenths == CHECKUP_ABSENT ||
                b.cycling_outdoor.min_tenths < w.cycling_outdoor_min_tenths)
                w.cycling_outdoor_min_tenths = b.cycling_outdoor.min_tenths;
        }
        if (b.defrost_outdoor.samples) {
            w.defrost_outdoor_samples += b.defrost_outdoor.samples;
            w.defrost_outdoor_sum_tenths += b.defrost_outdoor.sum_tenths;
            if (w.defrost_outdoor_min_tenths == CHECKUP_ABSENT ||
                b.defrost_outdoor.min_tenths < w.defrost_outdoor_min_tenths)
                w.defrost_outdoor_min_tenths = b.defrost_outdoor.min_tenths;
        }
        if (b.min_bar  != CHECKUP_ABSENT && (w.min_bar  == CHECKUP_ABSENT || b.min_bar  < w.min_bar))
            w.min_bar = b.min_bar;
        if (b.min_flow != CHECKUP_ABSENT && (w.min_flow == CHECKUP_ABSENT || b.min_flow < w.min_flow))
            w.min_flow = b.min_flow;
    };
    const size_t oldest = (r.count < CHECKUP_COMPLETED_BUCKETS) ? 0 : r.head;
    for (size_t i = 0; i < r.count; i++)
        fold(r.buf[(oldest + i) % CHECKUP_COMPLETED_BUCKETS]);
    fold(r.pending);
    return w;
}

struct DhwLossWindow {
    uint32_t observed_s = 0;
    uint32_t circulation_known_s = 0;
    uint32_t circulation_on_s = 0;
    uint32_t windows = 0;
    uint32_t high_windows = 0;
    uint32_t high_with_pump = 0;
    uint32_t high_pump_off = 0;
    uint32_t aborts = 0;
    uint32_t best_aborted_s = 0;   // the longest DISCARDED candidate, never a completed one
    uint8_t  abort_reasons = 0;
    int max_loss_tenths_k_h = CHECKUP_ABSENT;
};

inline DhwLossWindow dhw_loss_aggregate(const DhwLossRing& r) {
    DhwLossWindow w;
    auto fold = [&w](const DhwLossBucket& b) {
        w.observed_s += b.observed_s;
        w.circulation_known_s += b.circulation_known_s;
        w.circulation_on_s += b.circulation_on_s;
        w.windows += b.windows;
        w.high_windows += b.high_windows;
        w.high_with_pump += b.high_with_pump;
        w.high_pump_off += b.high_pump_off;
        w.aborts += b.aborts;
        w.abort_reasons = static_cast<uint8_t>(w.abort_reasons | b.abort_reasons);
        if (b.best_aborted_s > w.best_aborted_s) w.best_aborted_s = b.best_aborted_s;
        if (b.max_loss_tenths_k_h != CHECKUP_ABSENT &&
            (w.max_loss_tenths_k_h == CHECKUP_ABSENT ||
             b.max_loss_tenths_k_h > w.max_loss_tenths_k_h))
            w.max_loss_tenths_k_h = b.max_loss_tenths_k_h;
    };
    const size_t oldest = r.count < CHECKUP_COMPLETED_BUCKETS ? 0 : r.head;
    for (size_t i = 0; i < r.count; i++) fold(r.buf[(oldest + i) % CHECKUP_COMPLETED_BUCKETS]);
    fold(r.pending);
    return w;
}

// ── What the active profile can supply ──────────────────────────────────────────────────────────
// Evidence from the ROWS, never from the model id — the argument logic/feature_gate.hpp makes and
// measures: `generic` is the extreme case but not the only one, and an id check would have let a
// check run blind on a third of the detected catalog.
struct CheckupCoverage {
    bool rps      = false;   // compressor witness — 26 of the 39 detection profiles
    bool defrost  = false;
    bool buh      = false;   // either space-heating backup-heater step
    bool buh1     = false;
    bool buh2     = false;
    bool bsh      = false;   // DHW tank immersion heater
    bool pump     = false;
    bool pressure = false;
    bool flow     = false;
    bool valve    = false;
    bool mode     = false;
    bool r5t      = false;
    bool fault    = false;   // any conv-203 row
    bool retries  = false;   // any exact protection-counter identity from def/overlay.hpp
    uint8_t fault_rows = 0;  // every supported class row must be clear before "Normal" is established
    uint8_t retry_mask = 0;  // every supported counter must be readable for no-event evidence
};

// Fold one publishable, converter-adjudicated profile row into capability. Called from hp_poll before
// any bus query, so a timed-out page makes EVIDENCE sparse without pretending the model lacks the
// feature. This replaces the former "ever seen this boot" latch, which survived model changes and
// converted one successful sample into permanent availability.
inline void checkup_cover_row(CheckupCoverage& c, unsigned reg, unsigned off, int conv,
                              const char* label) {
    if (ou_is_rps_witness(label, reg)) c.rps = true;
    if (checkup_row_matches(CHECKUP_LOC_DEFROST,  reg, off, conv)) c.defrost = true;
    if (checkup_row_matches(CHECKUP_LOC_BUH1, reg, off, conv)) c.buh = c.buh1 = true;
    if (checkup_row_matches(CHECKUP_LOC_BUH2, reg, off, conv)) c.buh = c.buh2 = true;
    if (checkup_row_matches(CHECKUP_LOC_BSH,      reg, off, conv)) c.bsh = true;
    if (checkup_row_matches(CHECKUP_LOC_PUMP,     reg, off, conv)) c.pump = true;
    if (checkup_row_matches(CHECKUP_LOC_PRESSURE, reg, off, conv)) c.pressure = true;
    if (checkup_row_matches(CHECKUP_LOC_FLOW,     reg, off, conv)) c.flow = true;
    if (checkup_row_matches(CHECKUP_LOC_VALVE,    reg, off, conv)) c.valve = true;
    if (checkup_row_matches(CHECKUP_LOC_IU_MODE,  reg, off, conv)) c.mode = true;
    if (checkup_row_matches(CHECKUP_LOC_R5T,      reg, off, conv)) c.r5t = true;
    if (checkup_is_fault_class(conv)) {
        c.fault = true;
        if (c.fault_rows < UINT8_MAX) c.fault_rows++;
    }
    const int retry = checkup_retry_index(reg, off, conv);
    if (retry >= 0) {
        c.retries = true;
        c.retry_mask |= static_cast<uint8_t>(1u << retry);
    }
}

// ── Verdicts ────────────────────────────────────────────────────────────────────────────────────
// Five wire-compatible row states. A verdict is not automatically a judgement: observation-only rows
// can be `Ok` once their value is eligible, then remain outside assessable/evaluated/overall below.
//
//   Unavailable  this profile cannot supply the inputs. The check is OFF, not degraded — the rule
//                logic/feature_gate.hpp states and #121 / ou_stale / cop_scope each paid for.
//   Collecting   the inputs exist, the window does not hold enough of them yet. A device that has
//                been up ten minutes has NOT established absence of a pattern, and saying "Ok"
//                there would be a result bought with no evidence — the exact failure a fresh
//                board would show after every one of this project's reboot bursts.
enum class CheckupVerdict : uint8_t { Unavailable = 0, Ok = 1, Collecting = 2, Info = 3, Warn = 4 };

// The enum's numeric order IS the aggregation order, so `worst` is a max and there is no second
// table to disagree with it. For rows selected into the aggregate below, read it as: Warn wins; else
// Info; else Collecting (which must outrank Ok, or a half-observed day would report green); else Ok.
// Unavailable remains the aggregate when no bounded assessment is available, even if observation
// rows can still report facts.
constexpr CheckupVerdict checkup_worse(CheckupVerdict a, CheckupVerdict b) {
    return static_cast<uint8_t>(a) >= static_cast<uint8_t>(b) ? a : b;
}

// DECLARATION ORDER IS READING ORDER. /status emits the checks in this order and the card renders
// them in the order it receives them, so there is exactly one definition of "what does a person read
// first" — a second ordering table in the browser would be free to disagree with this one, and the
// row a reader most needs (an active fault) is the one that must not end up sixth.
enum class CheckupCheck : uint8_t {
    Fault = 0, DhwLoss, Cycling, Defrost, Pressure, Flow, Heater, Retries
};
constexpr size_t CHECKUP_CHECK_COUNT = 8;

// Stable wire ids — what /status.health prints and what the browser keys its copy on. Not the label:
// labels are translated in the UI, ids are not.
inline const char* checkup_check_id(CheckupCheck c) {
    switch (c) {
        case CheckupCheck::Cycling:  return "cycling";
        case CheckupCheck::DhwLoss:  return "dhw_loss";
        case CheckupCheck::Defrost:  return "defrost";
        case CheckupCheck::Pressure: return "pressure";
        case CheckupCheck::Flow:     return "flow";
        case CheckupCheck::Heater:   return "heater";
        case CheckupCheck::Fault:    return "fault";
        case CheckupCheck::Retries:  return "retries";
    }
    return "";
}

// Base evidence class per check. Defrost is refined per result below because the raw count is an
// observation and only a positive-denominator runtime share is heuristic.
inline const char* checkup_evidence_name(CheckupCheck c) {
    switch (c) {
        case CheckupCheck::Fault:    return "device";
        case CheckupCheck::Pressure: return "manufacturer";
        case CheckupCheck::Cycling:  return "heuristic";
        case CheckupCheck::DhwLoss:  return "heuristic";
        case CheckupCheck::Defrost:  return "heuristic";
        case CheckupCheck::Flow:     return "observation";
        case CheckupCheck::Heater:   return "observation";
        case CheckupCheck::Retries:  return "experimental";
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
// A "no finding" verdict needs a complete rolling-window lifecycle plus valid input for at least 90%
// of it. Exact 24 h coverage is impossible at the instant an hourly bucket expires (the pending hour
// has just opened), and demanding it would leave a continuously observed device collecting forever.
// Findings may surface earlier where stated below. Absence-of-pattern conclusions wait for this
// gate; direct current state and observation-only flow have explicit shorter eligibility targets.
constexpr uint32_t CHECKUP_REQUIRED_S     = CHECKUP_WINDOW_S * 9u / 10u; // 90% per signal
constexpr uint32_t CHECKUP_MIN_S_PRESSURE = CHECKUP_PRESSURE_CONFIRM_S;
constexpr uint32_t CHECKUP_MIN_S_FLOW     = 60;         // steady flow after run-up, observation only

// CYCLING. Two conditions, both required, and the second is the one that knows the load. The
// 10-minute window mean is this project's diagnostic heuristic, not a Daikin service limit:
// expected run length varies with model, load, weather, control and emitter system. Long DHW charges
// and cooling runs can mask short space-heating runs in the pooled fallback. The start count guards
// against reading a mean off two samples, and a match is Info, never a fault/limit verdict.
//
// A DHW charge is a LONG run, and on the reference installation every DHW cycle terminates on the
// ~100 °C discharge limit, so one tank charge is several legitimate compressor starts. Where the
// 3-way valve and I/U mode are readable those loads are now separated (see the Cycling branch)
// instead of raising a pooled mean that could carry a short-cycling space circuit over this bound;
// where they are not, the pooled mean and this masking both remain, which is the honest fallback
// rather than a second heuristic invented for a profile with less evidence.
//
// The bound stays at twelve and stays a bound on the JUDGED class. Twelve space starts is a day
// with a real duty cycle behind it; lowering it because a split leaves fewer starts on each side
// would be trading evidence for sensitivity, which is a domain decision with its own measurement.
constexpr uint32_t CHECKUP_CYCLING_MIN_STARTS   = 12;
constexpr uint32_t CHECKUP_CYCLING_SHORT_RUN_S  = 600;    // 10 minutes, mean over the window
constexpr uint32_t CHECKUP_CYCLING_CLASSIFIED_PCT = 90;   // completed runs with a usable class

// DEFROST. A share of simultaneously-observed compressor runtime, not a count. 15% is an
// intentionally broad project heuristic, not a Daikin boundary: model, humidity and coil-surface
// conditions matter, while X10A supplies neither humidity nor coil-surface temperature. A match is
// Info only. The PAIRED count guard stops one defrost in a short run from reading as 100% and
// prevents unpaired edges from lending a partial ratio a larger sample basis.
constexpr int      CHECKUP_DEFROST_SHARE_PCT = 15;
constexpr uint32_t CHECKUP_DEFROST_MIN_COUNT = 3;

// WATER PRESSURE, in tenths of bar. Many current Altherma hydronic-unit manuals require more than
// 1.0 bar, but the permitted filling and operating range is model-specific. At or below 1.0 bar is
// therefore a conservative project diagnostic, not a universal Daikin limit: it becomes Info
// immediately and Warn after CHECKUP_PRESSURE_CONFIRM_S continuously, while the UI points to the
// exact unit manual. There is deliberately neither an invented "preventive" band nor another band.

// HEATERS are observation only. Weather, emergency mode, defrost support, installer settings and PV
// surplus all change legitimate use; X10A does not provide enough context for a universal threshold.

// ── One check's answer ──────────────────────────────────────────────────────────────────────────
// The numbers ride WITH the verdict rather than being recomputed by each consumer: /status, the card
// and the tests must not be able to disagree about what a verdict was based on.
struct CheckupCheckResult {
    CheckupVerdict verdict = CheckupVerdict::Unavailable;
    uint32_t observed_s = 0; // valid evidence for THIS check, never the card's global bus time
    uint32_t required_s = 0; // evidence target; 0 for an instantaneous/direct device state
    // Per check, and only the fields that check fills. `-1` means "not established" everywhere it
    // appears, so a consumer emits null rather than a plausible zero. Defrost uses c/d for the raw
    // ratio seconds and e for paired transitions; heater uses a/b as observed seconds so 1–59 s
    // cannot collapse into "0 min".
    int a = -1;
    int b = -1;
    int c = -1;
    int d = -1;
    int e = -1;
    int f = -1;
    int g = -1;
};

// Defrost has two claim strengths under one stable row id: its transition count is an observation,
// while a share with a positive paired compressor-runtime denominator is a heuristic. Keep that
// distinction on the serialized result rather than labelling a count-only row as a judgement.
inline const char* checkup_result_evidence_name(CheckupCheck c, const CheckupCheckResult& r) {
    if (c == CheckupCheck::Defrost && r.d <= 0) return "observation";
    return checkup_evidence_name(c);
}

struct CheckupOutdoorReport {
    OutdoorSource source = OutdoorSource::None;
    int min_tenths = CHECKUP_ABSENT;
    int mean_tenths = CHECKUP_ABSENT;
    uint32_t samples = 0;
};

struct CheckupReport {
    uint32_t          covered_s = 0;
    // Progress inside the not-yet-creditable DHW hour.  Kept separate from observed_s: an hour is
    // evidence only when all its exclusion gates survive to the end, but hiding a 59-minute
    // candidate behind "0 min" made a successful OTA handoff look exactly like a reset.
    uint32_t          dhw_candidate_s = 0;
    uint32_t          dhw_settle_remaining_s = 0;
    // The window's own account of what it discarded, and whether that has become a verdict. On the
    // report rather than in CheckupCheckResult's a..g because those seven are full AND because they
    // would cost the figure on all eight checks — dhw_candidate_s set that precedent. `dhw_blocked`
    // is stated rather than inferred from `aborts > 0` beside an Unavailable verdict: a consumer
    // reconstructing it would be a second copy of the rule, and the two Unavailable causes need
    // OPPOSITE advice (a profile that cannot supply the rows is nothing the owner can act on; a
    // plant that never stands still is).
    uint32_t          dhw_aborts = 0;
    uint32_t          dhw_best_aborted_s = 0;
    int32_t           cycling_cooling_runs = -1;
    CheckupOutdoorReport cycling_outdoor;
    CheckupOutdoorReport defrost_outdoor;
    // Did the CLASS SPLIT decide the cycling verdict, or did it fall back to the pooled figure? A
    // reader cannot infer it from the fields — both are published whenever anything was witnessed —
    // and the two answers carry different caveats, so the device states which one it used.
    bool              cycling_split = false;
    uint8_t           dhw_abort_reasons = 0;
    bool              dhw_blocked = false;
    bool              full_span = false;
    uint8_t           available = 0; // checks supported by the active profile
    uint8_t           assessable = 0;// supported checks with a bounded judgement (not raw observations)
    uint8_t           evaluated = 0; // assessable checks no longer collecting
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
                                    FaultClass fault_now, const DhwLossWindow& dhw = {}) {
    CheckupReport r;
    r.covered_s = w.covered_s;
    r.full_span = w.full_span;
    if (w.cycling_outdoor_samples) {
        r.cycling_outdoor.source = OutdoorSource::X10a;
        r.cycling_outdoor.min_tenths = w.cycling_outdoor_min_tenths;
        r.cycling_outdoor.mean_tenths = checkup_div_round_nearest(
            w.cycling_outdoor_sum_tenths, w.cycling_outdoor_samples);
        r.cycling_outdoor.samples = w.cycling_outdoor_samples;
    }
    if (w.defrost_outdoor_samples) {
        r.defrost_outdoor.source = OutdoorSource::X10a;
        r.defrost_outdoor.min_tenths = w.defrost_outdoor_min_tenths;
        r.defrost_outdoor.mean_tenths = checkup_div_round_nearest(
            w.defrost_outdoor_sum_tenths, w.defrost_outdoor_samples);
        r.defrost_outdoor.samples = w.defrost_outdoor_samples;
    }

    auto set = [&r](CheckupCheck check, CheckupVerdict v, uint32_t observed_s,
                    uint32_t required_s, int a = -1, int b = -1,
                    int c = -1, int d = -1, int e = -1, int f = -1, int g = -1) {
        CheckupCheckResult& x = r.checks[static_cast<size_t>(check)];
        x.verdict = v;
        x.observed_s = observed_s;
        x.required_s = required_s;
        x.a = a;
        x.b = b;
        x.c = c;
        x.d = d;
        x.e = e;
        x.f = f;
        x.g = g;
    };

    // ── DHW loss: max clean one-hour R5T loss and independent circulation attribution ─────────
    // The 0.8 K/h boundary is the installation's project heuristic, never a manufacturer limit.
    // A high clean window is useful immediately; a reassuring absence waits for a complete 24 h
    // lifecycle and at least six clean hours.  The Shelly strengthens attribution but is optional:
    // missing/stale external evidence never erases an X10A-established high tank loss.
    r.dhw_aborts = dhw.aborts;
    r.dhw_abort_reasons = dhw.abort_reasons;
    r.dhw_best_aborted_s = dhw.best_aborted_s;
    // WHAT THE PLANT WILL NEVER GRANT is a different answer from WHAT IT HAS NOT GRANTED YET, and
    // only this check can tell them apart. A full lifecycle with not one completed hour and at least
    // DHW_LOSS_BLOCKED_MIN_ABORTS discarded ones is a plant whose own duty cycle is shorter than the
    // 105 minutes the method needs (45 settle + a 60-minute window). Reported as Unavailable — the
    // verdict that already means "this check cannot adjudicate here": it says nothing either way,
    // does not outrank Ok, and stops one permanently-unreachable check from holding the whole card
    // at `collecting` for the rest of the installation's life. `aborts` is what separates it from a
    // dead bus, where nothing was measured and `collecting` is still the honest answer.
    const bool dhw_supported = cov.r5t && cov.valve && cov.pump && cov.bsh;
    const bool dhw_blocked = dhw_supported && w.full_span && dhw.windows == 0 &&
                             dhw.aborts >= DHW_LOSS_BLOCKED_MIN_ABORTS;
    if (!dhw_supported) {
        set(CheckupCheck::DhwLoss, CheckupVerdict::Unavailable, 0, DHW_LOSS_REQUIRED_S);
    } else if (dhw.high_windows > 0) {
        // `-1` for an unestablished figure in EVERY branch, not only the Collecting one. Both of the
        // other branches imply a completed window today, which always sets the maximum — so this is
        // unreachable rather than wrong, and that is exactly the asymmetry worth removing: one edit
        // to the branch conditions and the raw CHECKUP_ABSENT sentinel would arrive here. It would
        // not reach a reader as -32768 — http_status.cpp's tenths() emits null for ANY negative — so
        // the damage is that a check with no established figure would be indistinguishable from one
        // that established nothing, which is the distinction `-1` exists to make explicit.
        set(CheckupCheck::DhwLoss, CheckupVerdict::Info,
            dhw.observed_s, DHW_LOSS_REQUIRED_S,
            dhw.max_loss_tenths_k_h == CHECKUP_ABSENT ? -1 : dhw.max_loss_tenths_k_h,
            static_cast<int>(dhw.windows), static_cast<int>(dhw.high_windows),
            static_cast<int>(dhw.high_with_pump), static_cast<int>(dhw.high_pump_off),
            static_cast<int>(dhw.circulation_on_s),
            static_cast<int>(dhw.circulation_known_s));
    } else if (dhw_blocked) {
        r.dhw_blocked = true;
        set(CheckupCheck::DhwLoss, CheckupVerdict::Unavailable,
            dhw.observed_s, DHW_LOSS_REQUIRED_S,
            dhw.max_loss_tenths_k_h == CHECKUP_ABSENT ? -1 : dhw.max_loss_tenths_k_h,
            static_cast<int>(dhw.windows), 0, 0, 0,
            static_cast<int>(dhw.circulation_on_s),
            static_cast<int>(dhw.circulation_known_s));
    } else if (!w.full_span || dhw.observed_s < DHW_LOSS_REQUIRED_S) {
        set(CheckupCheck::DhwLoss, CheckupVerdict::Collecting,
            dhw.observed_s, DHW_LOSS_REQUIRED_S,
            dhw.max_loss_tenths_k_h == CHECKUP_ABSENT ? -1 : dhw.max_loss_tenths_k_h,
            static_cast<int>(dhw.windows), 0, 0, 0,
            static_cast<int>(dhw.circulation_on_s),
            static_cast<int>(dhw.circulation_known_s));
    } else {
        set(CheckupCheck::DhwLoss, CheckupVerdict::Ok,
            dhw.observed_s, DHW_LOSS_REQUIRED_S,
            dhw.max_loss_tenths_k_h == CHECKUP_ABSENT ? -1 : dhw.max_loss_tenths_k_h,
            static_cast<int>(dhw.windows), 0, 0, 0,
            static_cast<int>(dhw.circulation_on_s),
            static_cast<int>(dhw.circulation_known_s));
    }

    // ── Cycling: starts (a), runtime per start (b), and the same pair per operating class (c–f) ──
    // Window edges can censor a run, and the aggregate carries no heat demand. The ratio is
    // therefore heuristic context, not the mean duration of completed like-for-like cycles and never
    // a plant fault. A clear result additionally needs a full rolling lifecycle and enough evidence
    // on the clock the verdict actually rests on — global bus uptime is not a substitute.
    //
    // WHICH LOAD the runs served comes from two rows: the 3-way valve separates tank from room
    // circuit, then I/U mode separates heating from cooling on the room circuit. Pooling hides the
    // finding this check exists for, because a tank charge is a LONG run (several legitimate starts
    // on a unit that terminates on its ~100 °C discharge limit), so a plant that genuinely
    // short-cycles space heating is lifted over the 10-minute mean by its own hot-water duty.
    // Cooling answers different demand too. The heuristic therefore judges confirmed SPACE HEATING
    // alone; DHW and cooling counts ride along as explicitly excluded observations, and the pooled
    // pair stays on the wire as the total.
    //
    // The unit is a COMPLETE RUN: a run reaches a class only if its valve/mode identity stayed
    // readable and unchanged for every witnessed second. A DHW handover, a heating/cooling change or
    // an unread class input makes it CENSORED and counted as such, never split — its seconds and its
    // start would otherwise describe different populations. Completed statistics are booked back
    // to the retained START bucket, so a run that began outside the rolling day cannot re-enter it
    // through its stop edge.
    //
    // A profile WITHOUT either class row keeps the pooled metric rather than losing the check:
    // `Unavailable` is reserved for inputs that do not exist, and the compressor witness does.
    const bool split_possible = cov.rps && cov.valve && cov.mode;
    // CATALOG CAPABILITY IS NOT EVIDENCE. `cov.valve`/`cov.mode` say the resolved profile carries the
    // rows, not that either ever answered — coverage is built from the profile view, so a plant
    // whose page is silent still reports the capability. Two separate questions follow from that,
    // conflating them shipped both halves of the same defect:
    //
    //   * may these fields be PRINTED?  Only once something was witnessed. Otherwise `null`, by the
    //     rule one branch down: a rendered `0` beside sixteen real starts reads as "no space heating
    //     ran today", which is the exact misreading the -1 encoding exists to prevent.
    //   * may the split DECIDE?  Only where the paired clock cleared the same bar the check has
    //     always used. A check that worked from the compressor witness alone must not begin stalling
    //     forever because a second row it can see in the catalog is silent on the wire; where the
    //     pair is too sparse it degrades to the pooled metric and its documented masking, exactly as
    //     on a profile that never had the row.
    //
    // AND THE CLOCK IS NOT THE POPULATION — the same category error one step further in, found on
    // hardware after the two above were fixed. `class_observed_s` counts readable seconds; the
    // verdict is built from completed, classified RUNS. Inputs can answer all day while changing or
    // disappearing inside each run, giving a full clock and an empty eligible set. The split used to
    // fall through to a green Ok resting on nothing. It now needs at least twelve classified runs
    // AND at least 90% of all completed runs classified. The count includes every positively known
    // class, not space heating alone: a fully observed quiet heating circuit beside DHW/cooling is a
    // real picture, while a large censored population forces the honest pooled fallback.
    const uint32_t classified_runs = w.space_runs + w.dhw_runs + w.cooling_runs;
    const uint32_t completed_runs  = classified_runs + w.censored_runs;
    const bool class_population_covered = completed_runs > 0 &&
        classified_runs * 100u >= completed_runs * CHECKUP_CYCLING_CLASSIFIED_PCT;
    const bool class_witnessed = split_possible && w.class_observed_s > 0;
    const bool split_judged    = split_possible && w.class_observed_s >= CHECKUP_REQUIRED_S &&
                                 classified_runs >= CHECKUP_CYCLING_MIN_STARTS &&
                                 class_population_covered;
    r.cycling_split = split_judged;
    r.cycling_cooling_runs = class_witnessed ? static_cast<int32_t>(w.cooling_runs) : -1;
    const int cycling_mean = w.starts ? static_cast<int>(w.run_s / w.starts) : -1;
    const int space_mean = w.space_runs ? static_cast<int>(w.space_run_s / w.space_runs) : -1;
    const int dhw_mean   = w.dhw_runs   ? static_cast<int>(w.dhw_run_s / w.dhw_runs)     : -1;
    const int space_runs_out    = class_witnessed ? static_cast<int>(w.space_runs)    : -1;
    const int dhw_runs_out      = class_witnessed ? static_cast<int>(w.dhw_runs)      : -1;
    const int censored_runs_out = class_witnessed ? static_cast<int>(w.censored_runs) : -1;
    const int space_mean_out    = class_witnessed ? space_mean : -1;
    const int dhw_mean_out      = class_witnessed ? dhw_mean   : -1;
    // READINESS stays on the compressor witness — the clock this check has always waited on, and the
    // one that cannot be starved by a second row. The DISPLAYED clock is the one the verdict used.
    const uint32_t cycling_observed_s = split_judged ? w.class_observed_s : w.rps_observed_s;
    if (!cov.rps) {
        set(CheckupCheck::Cycling, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else if (!w.full_span || w.rps_observed_s < CHECKUP_REQUIRED_S) {
        set(CheckupCheck::Cycling, CheckupVerdict::Collecting,
            w.rps_observed_s, CHECKUP_REQUIRED_S,
            w.rps_observed_s > 0 ? static_cast<int>(w.starts) : -1, -1,
            space_runs_out, space_mean_out, dhw_runs_out, dhw_mean_out, censored_runs_out);
    } else {
        // Count and mean come from ONE population — completed runs of the judged class — so the
        // numerator and denominator can never describe different events.
        const uint32_t judged_count = split_judged ? w.space_runs : w.starts;
        const int      judged_mean  = split_judged ? space_mean : cycling_mean;
        const bool notable = judged_count >= CHECKUP_CYCLING_MIN_STARTS && judged_mean >= 0 &&
                             static_cast<uint32_t>(judged_mean) < CHECKUP_CYCLING_SHORT_RUN_S;
        set(CheckupCheck::Cycling, notable ? CheckupVerdict::Info : CheckupVerdict::Ok,
            cycling_observed_s, CHECKUP_REQUIRED_S,
            static_cast<int>(w.starts), cycling_mean,
            space_runs_out, space_mean_out, dhw_runs_out, dhw_mean_out, censored_runs_out);
    }

    // ── Defrost: count (a) and share of paired compressor runtime in percent (b) ────────────────
    // A ratio is only formed from intervals where BOTH states were readable. Humidity and coil
    // temperature are absent, so even a high share remains a heuristic operating note.
    if (!cov.defrost) {
        set(CheckupCheck::Defrost, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else if (!w.full_span || w.dfr_observed_s < CHECKUP_REQUIRED_S) {
        set(CheckupCheck::Defrost, CheckupVerdict::Collecting,
            w.dfr_observed_s, CHECKUP_REQUIRED_S,
            w.dfr_observed_s > 0 ? static_cast<int>(w.defrosts) : -1,
            -1, -1, -1,
            cov.rps && w.dfr_pair_observed_s > 0
                ? static_cast<int>(w.paired_defrosts)
                : -1);
    } else if (!cov.rps) {
        // Count is fully observable without an RPS row; only the runtime share is unavailable.
        set(CheckupCheck::Defrost, CheckupVerdict::Ok,
            w.dfr_observed_s, CHECKUP_REQUIRED_S, static_cast<int>(w.defrosts),
            -1, -1, -1, -1);
    } else if (w.dfr_pair_observed_s < CHECKUP_REQUIRED_S) {
        set(CheckupCheck::Defrost, CheckupVerdict::Collecting,
            w.dfr_pair_observed_s, CHECKUP_REQUIRED_S, static_cast<int>(w.defrosts),
            -1, -1, -1,
            w.dfr_pair_observed_s > 0 ? static_cast<int>(w.paired_defrosts) : -1);
    } else {
        const int share = w.dfr_run_s
            ? static_cast<int>(w.defrost_s * 100u / w.dfr_run_s)
            : -1;
        // Judge the documented heuristic boundary on raw seconds. Comparing the integer display
        // percentage would hide every real 15.01–15.99% share behind a rounded-down 15%.
        const bool notable = w.paired_defrosts >= CHECKUP_DEFROST_MIN_COUNT && w.dfr_run_s &&
            static_cast<uint64_t>(w.defrost_s) * 100u >
                static_cast<uint64_t>(w.dfr_run_s) * CHECKUP_DEFROST_SHARE_PCT;
        set(CheckupCheck::Defrost, notable ? CheckupVerdict::Info : CheckupVerdict::Ok,
            w.dfr_pair_observed_s, CHECKUP_REQUIRED_S, static_cast<int>(w.defrosts), share,
            static_cast<int>(w.defrost_s), static_cast<int>(w.dfr_run_s),
            static_cast<int>(w.paired_defrosts));
    }

    // ── Water pressure: the window minimum in tenths of bar (a) ─────────────────────────────────
    // The raw minimum is always reported. A brief <=1.0 bar sample is an Info because it contradicts
    // the documented boundary but did not persist long enough for the anti-glitch confirmation;
    // Warn requires a continuous minute. A positive "no finding" still waits for the full gate.
    if (!cov.pressure) {
        set(CheckupCheck::Pressure, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else if (w.min_bar == CHECKUP_ABSENT) {
        set(CheckupCheck::Pressure, CheckupVerdict::Collecting,
            w.bar_observed_s, CHECKUP_MIN_S_PRESSURE,
            -1);
    } else if (w.flags & CHECKUP_F_LOW_BAR) {
        set(CheckupCheck::Pressure, CheckupVerdict::Warn,
            w.bar_observed_s, CHECKUP_MIN_S_PRESSURE, w.min_bar);
    } else if (w.min_bar <= CHECKUP_BAR_WARN_TENTHS) {
        set(CheckupCheck::Pressure, CheckupVerdict::Info,
            w.bar_observed_s, 0, w.min_bar); // one valid raw sample is the stated Info fact
    } else if (!w.full_span || w.bar_observed_s < CHECKUP_REQUIRED_S) {
        set(CheckupCheck::Pressure, CheckupVerdict::Collecting,
            w.bar_observed_s, CHECKUP_REQUIRED_S, w.min_bar);
    } else {
        set(CheckupCheck::Pressure, CheckupVerdict::Ok,
            w.bar_observed_s, CHECKUP_REQUIRED_S, w.min_bar);
    }

    // ── Flow: the minimum while the pump ran, in tenths of l/min (a) ────────────────────────────
    // OBSERVATION ONLY — never Info, never Warn. Model-specific installation documentation supplies
    // the comparison value; the generic firmware does not invent one.
    if (!cov.flow || !cov.pump) {
        set(CheckupCheck::Flow, CheckupVerdict::Unavailable, 0, CHECKUP_MIN_S_FLOW);
    } else if (w.flow_observed_s < CHECKUP_MIN_S_FLOW || w.min_flow == CHECKUP_ABSENT) {
        set(CheckupCheck::Flow, CheckupVerdict::Collecting,
            w.flow_observed_s, CHECKUP_MIN_S_FLOW,
            w.min_flow == CHECKUP_ABSENT ? -1 : w.min_flow);
    } else {
        set(CheckupCheck::Flow, CheckupVerdict::Ok,
            w.flow_observed_s, CHECKUP_MIN_S_FLOW, w.min_flow);
    }

    // ── Heater: observed BUH seconds (a) and BSH seconds (b) ────────────────────────────────────
    // Each supported heater has its own evidence clock. Missing BSH is not "zero BSH minutes", and
    // legitimate heater use has no universal threshold, so this row is observation only.
    if (!cov.buh && !cov.bsh) {
        set(CheckupCheck::Heater, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else {
        uint32_t observed = cov.buh ? w.buh_observed_s : w.bsh_observed_s;
        if (cov.buh && cov.bsh && w.bsh_observed_s < observed) observed = w.bsh_observed_s;
        const bool ready = w.full_span &&
                           (!cov.buh || w.buh_observed_s >= CHECKUP_REQUIRED_S) &&
                           (!cov.bsh || w.bsh_observed_s >= CHECKUP_REQUIRED_S);
        set(CheckupCheck::Heater, ready ? CheckupVerdict::Ok : CheckupVerdict::Collecting,
            observed, CHECKUP_REQUIRED_S,
            cov.buh && w.buh_observed_s > 0 ? static_cast<int>(w.buh_s) : -1,
            cov.bsh && w.bsh_observed_s > 0 ? static_cast<int>(w.bsh_s) : -1);
    }

    // ── Fault: no minimum window — a fault now is a fault now ───────────────────────────────────
    // An UNKNOWN class publishes nothing, exactly as logic/fault_state.hpp's companions do: 0/0 on a
    // byte nobody could decode asserts "no fault", the one direction a fault report must never fail
    // in.
    if (!cov.fault) {
        set(CheckupCheck::Fault, CheckupVerdict::Unavailable, 0, 0);
    } else if (fault_now == FaultClass::Unknown) {
        // A current timeout cannot erase a class already established in the rolling window. Keep
        // its active field unknown (`a=-1`); otherwise this is an unevaluated supported check.
        set(CheckupCheck::Fault,
            (w.flags & (CHECKUP_F_FAULT | CHECKUP_F_WARNING))
                ? CheckupVerdict::Info
                : CheckupVerdict::Collecting,
            0, 0);
    } else if (fault_error_active(fault_now)) {
        set(CheckupCheck::Fault, CheckupVerdict::Warn, 0, 0, 1);
    } else if (fault_warning_active(fault_now)) {
        set(CheckupCheck::Fault, CheckupVerdict::Info, 0, 0, 1);
    } else if (w.flags & (CHECKUP_F_FAULT | CHECKUP_F_WARNING)) {
        // Clear now, but not all day. Without a database this is the only place that fact survives,
        // and it is the one a user needs to be told before they conclude nothing ever happened.
        set(CheckupCheck::Fault, CheckupVerdict::Info, 0, 0, 0);
    } else {
        set(CheckupCheck::Fault, CheckupVerdict::Ok, 0, 0, 0);
    }

    // ── Protection retries: UC5's core signal (#69 / #110) ──────────────────────────────────────
    // Needs BOTH the counters and a compressor witness, which is exactly feature_gate.hpp's
    // uc5_supported(): without that witness, comparable counter endpoints cannot be tied to an
    // observed X10A operating interval rather than a page frozen outside a known plant state.
    if (!cov.retries || !cov.rps) {
        set(CheckupCheck::Retries, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else if (w.flags & CHECKUP_F_RETRY) {
        set(CheckupCheck::Retries, CheckupVerdict::Info,
            w.retry_observed_s, CHECKUP_REQUIRED_S, 1);
    } else if (!w.full_span || w.retry_observed_s < CHECKUP_REQUIRED_S) {
        set(CheckupCheck::Retries, CheckupVerdict::Collecting,
            w.retry_observed_s, CHECKUP_REQUIRED_S);
    } else {
        set(CheckupCheck::Retries, CheckupVerdict::Ok,
            w.retry_observed_s, CHECKUP_REQUIRED_S, 0);
    }

    // `available` means a supported row can report a fact. `assessable`, `evaluated` and `overall`
    // are narrower:
    // only checks that can actually adjudicate a bounded finding may support "no finding in the
    // evaluated X10A data". Flow/heater are observations, count-only defrost has no ratio heuristic,
    // and a stable experimental retry counter explicitly does not prove absence of limiting.
    for (size_t i = 0; i < CHECKUP_CHECK_COUNT; i++) {
        const CheckupCheck check = static_cast<CheckupCheck>(i);
        const auto& c = r.checks[i];
        if (c.verdict != CheckupVerdict::Unavailable) r.available++;
        const bool adjudicates =
            check == CheckupCheck::Fault ||
            check == CheckupCheck::DhwLoss ||
            check == CheckupCheck::Cycling ||
            check == CheckupCheck::Pressure ||
            (check == CheckupCheck::Defrost && cov.rps && w.dfr_run_s > 0);
        if (adjudicates && c.verdict != CheckupVerdict::Unavailable) r.assessable++;
        // An experimental counter increase is finding-only: surface its Info in the aggregate, but
        // never count a stable counter as an assessable absence conclusion.
        const bool finding_only =
            check == CheckupCheck::Retries && c.verdict == CheckupVerdict::Info;
        if (!adjudicates && !finding_only) continue;
        if (c.verdict != CheckupVerdict::Unavailable &&
            c.verdict != CheckupVerdict::Collecting && adjudicates) r.evaluated++;
        r.overall = checkup_worse(r.overall, c.verdict);
    }
    return r;
}

}  // namespace daik::logic
