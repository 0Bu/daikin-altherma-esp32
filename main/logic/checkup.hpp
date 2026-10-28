#pragma once
// THE ROLLING PLANT CHECKUP — what did the on-board inputs establish in at most the last 24 hours?
//
// The dashboard already answers "what is it doing right now" (the schematic) and "what did this one
// reading do today" (logic/history.hpp's trends). Neither answers the question a user actually asks
// once a month: *did the observed data contain anything worth following up?* That answer is a small
// number of COUNTED EVENTS and WINDOW MINIMA — how often the compressor started, how much of its
// runtime went into defrosting, how low the water pressure got — none of which any single reading
// can express. It is deliberately NOT a certificate that the whole plant is healthy: X10A plus an
// independent circulation-pump power witness still cannot prove
// refrigerant charge, sensor calibration, hydraulic cleanliness, air path or seasonal efficiency.
//
// Issue legacy-208 asked for it. This header is the half that can be decided; main/checkup.cpp is
// the storage, and main/www/js/dashboard.js is the card. What legacy-208 asked for and this
// deliberately does NOT do is listed at the bottom of this comment — each omission is a claim the
// bus cannot support.
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
// So this keeps its own ring — 23 completed one-hour buckets plus the open hour in static RAM —
// beside the trend rings. Keeping the open hour INSIDE the total is load-bearing: 24 completed
// buckets plus an open one would silently make a "24 h" window almost 25 hours long. It is a
// different question at a different rate, not a view of the same data.
//
// ── WHY A ROW IS ADDRESSED BY (reg, offset, CONVERTER) ──────────────────────────────────────────
// logic/history.hpp argues at length why a trend addresses its row structurally and never by label,
// and every word of it applies here. But its (reg, offset, unit) locator is NOT enough for these
// rows: `2way valve`, `3way valve`, `BSH`, `BUH Step1`, `BUH Step2`, `Water pump operation` and
// `Solar pump operation` all sit in the SAME byte — 0x60 offset 12 — and all SEVEN are
// dimensionless. They differ only in which bit their converter masks (307/306/305/304/303/301/300).
// A (reg, offset, unit) locator resolves to whichever of the seven sorts first, so the "backup
// heater ran 40 minutes" figure would in fact be the 2-way valve's position. That is the
// legacy-35–legacy-39 shape with a day's statistics in front of it.
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
//   * AN ABSOLUTE MINIMUM-FLOW THRESHOLD. The manufacturer's minimum is per model (the catalog
//   spans
//     3 kW to 18 kW), and one number laid across 44 profiles would never fire on the large units
//     and always fire on the small ones. The unit raises 7H itself when flow is genuinely
//     insufficient, and that reaches the fault check below. The minimum is REPORTED; no verdict is
//     attached to it.
//   * A DAILY START-COUNT THRESHOLD. 24 starts on a cold day is one per hour and healthy; 24 starts
//     in the shoulder season is cycling. A start count alone does not know the load. The MEAN RUN
//     LENGTH does — see CHECKUP_CYCLING_SHORT_RUN_S.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>

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

// Exact sums describe accepted samples; a complete modulating run can exceed 65535 samples.
struct CheckupOutdoorStats {
    int32_t  sum_tenths = 0;
    int16_t  min_tenths = CHECKUP_ABSENT;
    uint32_t samples    = 0;
};
static_assert(sizeof(CheckupOutdoorStats) == 12, "outdoor context cost changed");

// ── One hour of evidence ────────────────────────────────────────────────────────────────────────
// `covered_s` is the load-bearing field and the reason a fresh board cannot show a green verdict: it
// counts the seconds actually OBSERVED in this hour, so an hour the firmware slept through, or a
// device that has been up for ten minutes, reports the small number it has rather than an implied
// full day.
struct CheckupBucket {
    // Each clock belongs to one hour and is clamped at 3600 s before assignment. Five 12-bit
    // clocks share each 64-bit allocation unit: the fifteen clocks use 24 bytes instead of 30.
    // covered=any signal; rps/run=readable compressor/known running; class=paired RPS+valve+mode.
    // dfr_pair/dfr_run/defrost require paired compressor+defrost witnesses; buh/bsh are heater
    // witnesses and active time; bar is valid pressure, flow is valid flow after pump run-up;
    // retry requires every expected counter and comparable readable compressor endpoints.
    uint64_t covered_s : 12;
    uint64_t rps_observed_s : 12;
    uint64_t run_s : 12;
    uint64_t class_observed_s : 12;
    uint64_t dfr_observed_s : 12;
    uint64_t dfr_pair_observed_s : 12;
    uint64_t dfr_run_s : 12;
    uint64_t defrost_s : 12;
    uint64_t buh_observed_s : 12;
    uint64_t buh_s : 12;
    uint64_t bsh_observed_s : 12;
    uint64_t bsh_s : 12;
    uint64_t bar_observed_s : 12;
    uint64_t flow_observed_s : 12;
    uint64_t retry_observed_s : 12;
    constexpr CheckupBucket()
        : covered_s(0), rps_observed_s(0), run_s(0), class_observed_s(0), dfr_observed_s(0),
          dfr_pair_observed_s(0), dfr_run_s(0), defrost_s(0), buh_observed_s(0), buh_s(0),
          bsh_observed_s(0), bsh_s(0), bar_observed_s(0), flow_observed_s(0), retry_observed_s(0) {}
    // WHICH LOAD a compressor RUN served. RPS lives on 0x30; the 3-way valve and I/U mode live on
    // 0x60, so either page can time out alone. `class_observed_s` is the paired class clock: RPS
    // and valve must be readable together, plus I/U mode whenever the valve points at the room
    // circuit.
    //
    // The two class figures below count COMPLETED RUNS, not seconds attributed sample by sample.
    // That distinction is the whole correctness of this check. Splitting seconds by the valve while
    // the START stays on the side the run began leaves a ratio whose numerator and denominator
    // describe different populations, and DHW priority makes that a routine event rather than a
    // corner case: twelve continuous 25-minute runs that each hand over to the tank after five
    // minutes then read as a five-minute mean over twelve starts — a short-cycling verdict on a
    // plant that never short-cycled. A run is therefore the unit, and it is classified only when
    // its load identity is witnessed start-to-stop, allowing only bounded same-class gaps and the
    // known-OFF DHW valve-return tail described by the cycling state machine below.
    uint32_t space_run_s =
        0; // complete runs are attributed to their start hour, not capped at 18 h
    uint32_t dhw_run_s           = 0;
    int16_t  min_bar    = CHECKUP_ABSENT;   // tenths of bar, raw lowest valid sample seen
    int16_t  min_flow   = CHECKUP_ABSENT;   // tenths of l/min, lowest seen after pump run-up
    uint32_t min_bar_unix_s   = 0;   // exact observed time when clock is valid; 0 remains unknown
    uint8_t  starts     = 0;   // compressor 0 -> >0 transitions (saturating)
    // COMPLETED runs, per class — the denominators of the two heating/DHW means above, so each
    // ratio is formed over one population. Only the bounded interpolation/tail rules can preserve a
    // pure class; cooling is counted only to make its exclusion explicit. Everything
    // else lands in `censored_runs`, so "no verdict" can never be read as "nothing ran".
    uint8_t  space_runs = 0;
    uint8_t  dhw_runs   = 0;
    uint8_t  cooling_runs = 0; // positively identified room-circuit cooling, reported but not judged
    uint8_t  censored_runs = 0; // completed, but mixed / class-unreadable / gapped: judged by neither
    uint8_t  censored_transition_runs = 0;
    uint8_t  censored_handover_runs   = 0;
    uint8_t  censored_unreadable_runs = 0;
    uint8_t  censored_restart_runs    = 0;
    // Start-not-witnessed is the remainder of censored_runs after the four exclusive causes above.
    // A saturated runtime is a lower bound and permanently blocks this window's runtime gate.
    uint16_t censored_runtime_s = 0;
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

// 80 bytes per hour: wider completed-run/context counts and a dated pressure minimum add
// 384 bytes to the 24-slot ring. No sampling allocation or partition change is involved.
constexpr size_t CHECKUP_BYTES = sizeof(CheckupBucket) * CHECKUP_BUCKETS;
static_assert(CHECKUP_BYTES <= 1920,
              "the static checkup ring is too large for this heap-tight board");

// Saturating add for the two event counters: 255 starts in one hour is far outside anything real,
// but a wrap to 0 would turn the worst imaginable cycling into a perfect score.
constexpr uint8_t checkup_add_u8(uint8_t v, unsigned add) {
    return add > 255u - v ? uint8_t{255} : static_cast<uint8_t>(v + add);
}
constexpr uint16_t checkup_add_u16(uint16_t v, unsigned add) {
    return add > 65535u - v ? uint16_t{65535} : static_cast<uint16_t>(v + add);
}
constexpr uint16_t checkup_add_hour_s(unsigned v, unsigned add) {
    return static_cast<uint16_t>(v >= 3600u || add >= 3600u - v ? 3600u : v + add);
}
constexpr uint32_t checkup_add_u32(uint32_t v, uint32_t add) {
    return add > UINT32_MAX - v ? UINT32_MAX : v + add;
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
    // inside int32 even at the one-day sample ceiling.
    if (rounded < -3276 || rounded > 3276) return;
    const int16_t tenths = static_cast<int16_t>(rounded);
    if (!stats.samples) {
        stats.min_tenths = tenths;
        stats.sum_tenths = tenths;
        stats.samples = 1;
        return;
    }
    if (stats.samples >= CHECKUP_WINDOW_S)
        return; // bounded accepted prefix, not full weather coverage
    if (tenths < stats.min_tenths) stats.min_tenths = tenths;
    stats.sum_tenths += tenths;
    stats.samples++;
}

inline void checkup_outdoor_merge(CheckupOutdoorStats& into, const CheckupOutdoorStats& from) {
    if (!from.samples) return;
    if (!into.samples) { into = from; return; }
    const uint64_t total = static_cast<uint64_t>(into.samples) + from.samples;
    if (total > CHECKUP_WINDOW_S) return; // preserve a bounded, accurately counted prefix
    into.sum_tenths += from.sum_tenths;
    if (from.min_tenths < into.min_tenths) into.min_tenths = from.min_tenths;
    into.samples = static_cast<uint32_t>(total);
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
    // Lifecycle established by dated compatible flash intervals after clock/source confirmation
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
    uint32_t             unix_s        = 0; // only supplied after trustworthy clock synchronization
    bool rps_known     = false, rps_running  = false;
    bool defrost_known = false, defrost_on   = false;
    bool buh_known     = false, buh_on       = false;   // either BUH step
    bool bsh_known     = false, bsh_on       = false;
    bool pump_known    = false, pump_on      = false;
    bool valve_known   = false, valve_dhw    = false;
    CheckupOperatingMode operating_mode = CheckupOperatingMode::Unknown;
    bool circulation_configured = false;
    bool circulation_known = false, circulation_on = false;
    // Caller context retained for sampling compatibility. Cycling applies the same bounded
    // missing-witness rule to entirely blind and partially unreadable sweeps.
    bool x10a_blind = false;

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
constexpr uint32_t CHECKUP_CYCLING_DHW_TAIL_S = 30;
constexpr uint32_t CHECKUP_CYCLING_GAP_S      = 15;
// One completion has one cause. Highest priority wins: expired start/journal, unwitnessed start,
// unreadable evidence, ambiguous transition, positively witnessed handover.
enum class CheckupCensorCause : uint8_t { None, Handover, Transition, Unreadable, Start, Restart };

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
    bool     prev_buh_known = false, prev_buh_on = false;
    bool     prev_bsh_known = false, prev_bsh_on = false;
    bool     prev_bar_valid = false, prev_bar_low = false;
    bool     prev_flow_valid       = false;
    bool     prev_class_known      = false;
    bool     prev_any_known        = false;
    // The last KNOWN compressor state of this continuous segment (a real gap clears it), and the
    // unreadable-RPS seconds in the open run since its last known-running sample (each such sample,
    // the start included, clears them). This is integration accounting only; bridge admission uses
    // monotonic witness timestamps, independent of the hour-boundary dt discard.
    bool     last_rps_known = false, last_rps_running = false;
    uint8_t  run_blind_s           = 0;
    uint16_t pump_run_s            = 0;       // continuous known-on time, reset by off/unknown/gap
    uint16_t bar_low_run_s    = 0;       // consecutive valid samples at/below documented boundary
    uint8_t  prev_retry_known_mask = 0;
    uint8_t  prev_retry_value[CHECKUP_RETRY_COUNT] = {};
    uint32_t bucket        = 0;
    bool     have_bucket   = false;
    // ── the compressor run in flight ────────────────────────────────────────────────────────────
    // Transient on purpose: a run already standing after reboot has an unwitnessed start and can
    // only complete as censored. An open run does not enter a mean before a known OFF completes it.
    bool     run_open       = false;
    bool            run_class_pure = false; // start-to-stop class survives the bounded rules below
    CheckupRunClass run_class = CheckupRunClass::Unknown;
    uint32_t run_start_bucket = 0;    // complete-run facts age with the witnessed start edge
    uint32_t run_s          = 0;
    int64_t         run_started_us    = -1;
    int64_t         run_class_seen_us = -1;
    int64_t         run_rps_seen_us   = -1;
    int64_t         run_tail_us       = -1;
    CheckupRunClass run_last_class    = CheckupRunClass::Unknown;
    CheckupCensorCause  run_cause     = CheckupCensorCause::None;
    bool                run_had_gap   = false;
    CheckupOutdoorStats run_outdoor; // committed only if this run completes as pure space heating
};

inline void checkup_censor_run(CheckupState& st, CheckupCensorCause cause) {
    st.run_class_pure = false;
    if (static_cast<unsigned>(cause) > static_cast<unsigned>(st.run_cause)) st.run_cause = cause;
}

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
            checkup_censor_run(st, CheckupCensorCause::Restart);
        }
    }
    const bool reseal = ring && target != &b;
    if (st.run_class_pure) {
        switch (st.run_class) {
            case CheckupRunClass::Dhw:
                target->dhw_runs  = checkup_add_u8(target->dhw_runs, 1);
                target->dhw_run_s = checkup_add_u32(target->dhw_run_s, st.run_s);
                break;
            case CheckupRunClass::SpaceHeating:
                target->space_runs  = checkup_add_u8(target->space_runs, 1);
                target->space_run_s = checkup_add_u32(target->space_run_s, st.run_s);
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
        auto cause            = st.run_cause;
        if (cause == CheckupCensorCause::None) cause = CheckupCensorCause::Unreadable;
        if (cause == CheckupCensorCause::Handover && st.run_had_gap)
            cause = CheckupCensorCause::Unreadable;
        if (cause == CheckupCensorCause::Transition)
            target->censored_transition_runs = checkup_add_u8(target->censored_transition_runs, 1);
        else if (cause == CheckupCensorCause::Handover)
            target->censored_handover_runs = checkup_add_u8(target->censored_handover_runs, 1);
        else if (cause == CheckupCensorCause::Unreadable)
            target->censored_unreadable_runs = checkup_add_u8(target->censored_unreadable_runs, 1);
        else if (cause == CheckupCensorCause::Restart)
            target->censored_restart_runs = checkup_add_u8(target->censored_restart_runs, 1);
        if (cause != CheckupCensorCause::Handover) {
            uint64_t elapsed = st.run_s;
            if (st.run_started_us >= 0 && st.last_us >= st.run_started_us) {
                const auto elapsed_us = static_cast<uint64_t>(st.last_us - st.run_started_us);
                elapsed               = elapsed_us / 1000000 + (elapsed_us % 1000000 != 0);
            }
            target->censored_runtime_s =
                checkup_add_u16(target->censored_runtime_s,
                                static_cast<unsigned>(std::min<uint64_t>(UINT16_MAX, elapsed)));
        }
    }
    st.run_open = st.run_class_pure = false;
    st.run_class                    = CheckupRunClass::Unknown;
    st.run_start_bucket = 0;
    st.run_s = 0;
    st.run_started_us = st.run_class_seen_us = st.run_rps_seen_us = st.run_tail_us = -1;
    st.run_last_class = CheckupRunClass::Unknown;
    st.run_cause      = CheckupCensorCause::None;
    st.run_had_gap    = false;
    st.run_outdoor = CheckupOutdoorStats{};
    return reseal;
}

// ── DHW tank cooling / external circulation correlation ───────────────────────────────────────
// Kept in its own compact ring with a separate evidence clock. Only
// completed one-hour net temperature drops are retained. Charge/settling segments do not
// contribute observed seconds. Pump activity and draw-like drops qualify the observation rather
// than erasing it: this sensor cannot distinguish standing loss from other cooling mechanisms.
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
    uint8_t draw_windows       = 0;
    uint8_t pump_windows       = 0;
    uint8_t quiet_high_windows = 0;
};

// Context counts add 96 bytes to the 24-bucket ring, keeping net cooling visible without
// mislabelling draw-like or pump-active hours as undisturbed standing-loss measurements.
constexpr size_t DHW_LOSS_BYTES = sizeof(DhwLossBucket) * CHECKUP_BUCKETS;
static_assert(DHW_LOSS_BYTES <= 480, "DHW loss ring exceeded its static-memory budget");

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

constexpr uint32_t DHW_LOSS_SETTLE_S = 45 * 60; // issue legacy-349 method after a tank charge
// Adjacent readable endpoints must agree within two sensor steps. This rejects an isolated
// spike as an hourly endpoint without erasing a sustained real draw or steady rapid cooling.
constexpr int DHW_LOSS_ENDPOINT_DELTA_TENTHS = 2;

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
    // A FRESH filter cannot know whether a charge ended just before its first sample, so it waits
    // one settle before its first candidate. Not a charge settle: progress never reports it, it
    // books no abort, and only dhw_loss_adopt (a sealed handoff that carries the real settle)
    // clears it.
    uint32_t hold_remaining_s = DHW_LOSS_SETTLE_S;
    bool     segment_draw_like = false;
    bool     segment_pump_on   = false;
    int      endpoint_tenths   = 0;
    bool     endpoint_known    = false;

    void reset_segment() {
        segment_start_us = draw_anchor_us = -1;
        segment_carried_s = draw_anchor_carried_s = 0;
        segment_circulation_known_s = segment_circulation_on_s = 0;
        segment_blind_s = 0;
        segment_draw_like = segment_pump_on = false;
    }
};

constexpr uint32_t DHW_LOSS_WINDOW_S      = 3600; // R5T resolves only 0.1 K
// Two normal polling intervals allow one isolated bad endpoint and its confirmation to recover.
// Never reinterpret an arbitrarily long candidate as one hourly observation.
constexpr uint32_t DHW_LOSS_CLOSE_GRACE_S = 2 * CHECKUP_MAX_GAP_S;
constexpr uint32_t DHW_LOSS_DRAW_WINDOW_S = 10 * 60;
// Project filter: any positive charge witness discards the candidate. At least 120 seconds
// of witness also starts a 45-minute settling allowance. A discontinuous positive sample takes
// that conservative allowance immediately. This duration does not prove how much heat entered
// the tank; a shorter or partially unseen charge can still affect the next candidate.
constexpr uint32_t DHW_LOSS_CHARGE_MIN_S = 120;
// Four tenths within the ten-minute anchor marks a possible draw. Continuous cooling near
// 1.9 K/h also meets this shape: keep the measured rate and report the ambiguity as context.
constexpr int      DHW_LOSS_DRAW_DROP_TENTHS = 4;
constexpr int      DHW_LOSS_HIGH_TENTHS_K_H = 8;         // project heuristic, not a Daikin limit
// Missing rows are blind time, not proof of a charge or an off state. A candidate tolerates
// at most 120 consecutive blind seconds and 10% in total, subtracting them from observed time.
// These project allowances can miss a charge within a gap. Settling is spent only on samples
// that read both witnesses, an unread stretch beside a seen witness counts as charge time, and a
// fresh state holds one settle before its first candidate (it cannot see a charge that just ended).
// An integrity-valid, source-matched intentional-reboot handoff retains the remaining settle.
// See the DHW limitations in docs/DIAGNOSTIC_EVIDENCE.md; no allowance proves the tank was idle.
constexpr uint32_t DHW_LOSS_BLIND_RUN_MAX_S = 120;
constexpr uint32_t DHW_LOSS_BLIND_MAX_PCT   = 10;
constexpr uint32_t DHW_LOSS_CIRC_KNOWN_PCT = 90;
constexpr uint32_t DHW_LOSS_CIRC_MIN_ON_S = 5 * 60;
constexpr uint32_t DHW_LOSS_CIRC_OFF_SETTLE_S = 2 * 3600;
// The device cannot measure its own downtime.  Intentional esp_restart() on this board is a few
// seconds, so use the same bounded, explicit blind allowance as the persisted state-age table.  It
// advances wall-clock age but never observed evidence. It covers the downtime only; the uptime the
// new boot has already spent before the adoption is measured and booked on top
// (dhw_loss_adopt_blind_s).
constexpr uint32_t DHW_LOSS_REBOOT_BLIND_S = 5;

constexpr uint8_t DHW_LOSS_CARRY_SEGMENT = 1u << 0;
constexpr uint8_t DHW_LOSS_CARRY_DRAW     = 1u << 1;
constexpr uint8_t DHW_LOSS_CARRY_DRAW_LIKE = 1u << 2;
constexpr uint8_t DHW_LOSS_CARRY_PUMP_ON   = 1u << 3;

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
        if (st.segment_draw_like) c.flags |= DHW_LOSS_CARRY_DRAW_LIKE;
        if (st.segment_pump_on) c.flags |= DHW_LOSS_CARRY_PUMP_ON;
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

// How much unobserved time an adoption at `now_us` has to book against the carried candidate.
//
// DHW_LOSS_REBOOT_BLIND_S covers the downtime, the stretch between the checkpoint and esp_timer's
// zero. It does not cover the stretch after zero: esp_timer's zero is the start of this boot, and
// adoption happens in checkup_reset_on_detect(), after current-source confirmation. `now_us` at
// adoption therefore IS all unwatched boot time, including network startup and detection, whole
// seconds, floored like every other absolute-instant quantisation here. Booked as the constant
// alone, a boot that spent longer than DHW_LOSS_BLIND_RUN_MAX_S waiting for the network carried the
// candidate straight through an unobserved interval that the run bound exists to refuse.
// Saturating, and a clock that has not started (or a test passing zero) books no uptime.
inline uint32_t dhw_loss_adopt_blind_s(int64_t now_us) {
    const uint64_t uptime_s = now_us > 0 ? static_cast<uint64_t>(now_us) / 1000000u : 0;
    const uint64_t total    = uptime_s + DHW_LOSS_REBOOT_BLIND_S;
    return total > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(total);
}

// A carried candidate that the booked unobserved time pushes past the blind bounds ends here with
// reset_segment(), not dhw_loss_abort(), and the adoption takes no bucket: that discard is left out
// of the discarded-window count on purpose. The count stays a count of the discards dhw_loss_step
// observed. The time this adoption books is the restart allowance plus all boot time up to source
// confirmation, a
// board-side cause the blind reason cannot separate from a silent link (an unread stretch still
// open at the restart can add to it); counting the discard would add a board-side entry whenever
// a slow restart carries a candidate. The count therefore under-reports restarts and never
// overclaims.
inline void dhw_loss_adopt(DhwLossState& st, const DhwLossCarry& c, int64_t now_us) {
    st = DhwLossState{};
    st.last_us = now_us;

    st.settle_remaining_s = c.settle_remaining_s;
    st.hold_remaining_s   = 0; // the handoff carries the real settle: no fresh state
    st.charge_run_s = c.charge_run_s;
    st.blind_run_s        = c.blind_run_s; // an unread tail after a short witness still counts
    if (!(c.flags & DHW_LOSS_CARRY_SEGMENT)) return;

    // Elapsed AND blind, the same seconds on both sides: they advance the candidate's age and can
    // never buy observed evidence. One value feeds the segment, the draw anchor and the blind
    // budget so the three cannot disagree about how long this boot has been running unwatched.
    const uint32_t blind = dhw_loss_adopt_blind_s(now_us);

    st.segment_start_us = now_us;
    st.segment_carried_s    = std::min<uint32_t>(UINT32_MAX - blind, c.segment_elapsed_s) + blind;
    st.segment_start_tenths = c.segment_start_tenths;
    st.segment_circulation_known_s = c.segment_circulation_known_s;
    st.segment_circulation_on_s = c.segment_circulation_on_s;
    st.segment_blind_s             = c.segment_blind_s;
    st.segment_draw_like           = (c.flags & DHW_LOSS_CARRY_DRAW_LIKE) != 0;
    st.segment_pump_on             = (c.flags & DHW_LOSS_CARRY_PUMP_ON) != 0;
    // Attribution as "pump continuously off" cannot cross an interval nobody observed.
    st.circulation_off_run_s = 0;

    if (c.flags & DHW_LOSS_CARRY_DRAW) {
        st.draw_anchor_us = now_us;
        st.draw_anchor_carried_s =
            std::min<uint32_t>(UINT32_MAX - blind, c.draw_anchor_age_s) + blind;
        st.draw_anchor_tenths = c.draw_anchor_tenths;
    }
    if (!dhw_loss_blind_ok(st, blind)) st.reset_segment();
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

    // A single numerically plausible sample can still be a transient (for example 49, 0, 49).
    // Require a second nearby reading before either end of a rate is established. An intentional
    // restart deliberately starts this short confirmation afresh; the carried start was already
    // confirmed. Charge/settle and context still process every sample immediately.
    const bool endpoint_valid = s.r5t_ok && s.r5t_tenths >= 0 && s.r5t_tenths <= 900;
    const bool endpoint_confirmed =
        continuous && endpoint_valid && st.endpoint_known &&
        std::abs(st.endpoint_tenths - s.r5t_tenths) <= DHW_LOSS_ENDPOINT_DELTA_TENTHS;
    st.endpoint_known = endpoint_valid;
    if (endpoint_valid) st.endpoint_tenths = s.r5t_tenths;

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
        // A gap cannot establish a short witness: conservatively apply the settling allowance. The
        // unread stretch just before a continuous witness may have been charge time, so it counts.
        const uint32_t seen =
            continuous ? checkup_add_u32(st.blind_run_s, dt) : DHW_LOSS_CHARGE_MIN_S;
        st.blind_run_s  = 0;
        st.charge_run_s = std::min<uint32_t>(UINT32_MAX - seen, st.charge_run_s) + seen;
        if (st.charge_run_s >= DHW_LOSS_CHARGE_MIN_S) st.settle_remaining_s = DHW_LOSS_SETTLE_S;
        // Every positive witness ends the candidate; only a sustained witness arms settling.
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
    // The same rule after the witness: a short seen charge with an unread tail may have run on, so
    // seen + tail past the bound arms the settle at the first sample that reads both witnesses.
    if (s.valve_known && s.bsh_known) {
        if (st.charge_run_s &&
            checkup_add_u32(st.charge_run_s, st.blind_run_s) >= DHW_LOSS_CHARGE_MIN_S)
            st.settle_remaining_s = DHW_LOSS_SETTLE_S;
        st.charge_run_s = 0;
    }
    if (!continuous) {
        // Past CHECKUP_MAX_GAP_S the firmware was not watching — a wedged read, a burst of timed-out
        // pages, a reboot. That is BLIND time of a known length, not a plant state, so it is
        // budgeted exactly like an unreadable row rather than discarding the hour outright.
        if (!dhw_loss_blind_ok(st, gap_s)) dhw_loss_abort(st, b, DHW_ABORT_BLIND, now_us);
        return;
    }
    if (st.settle_remaining_s || st.hold_remaining_s) {
        // Spent only on samples that read both witnesses: an unread one may hide a charge still
        // running, which is no settling. The fresh-state hold runs on the same clock. That unread
        // time is blind time here too, so the witness rules above still see it.
        if (s.valve_known && s.bsh_known) {
            st.settle_remaining_s -= std::min(dt, st.settle_remaining_s);
            st.hold_remaining_s -= std::min(dt, st.hold_remaining_s);
            st.blind_run_s = 0;
        } else {
            st.blind_run_s = checkup_add_u32(st.blind_run_s, dt);
        }
        // Not an abort: the charge that armed this already booked one, and there is no candidate
        // left to discard. Counting these would report one aborted hour per second of settling.
        st.reset_segment();
        return;
    }

    // Actual charge witnesses already returned above. The internal hydronic pump can run during
    // space heating while R5T still observes the tank: retain that context, without inferring
    // either a standing loss or hydraulic isolation from the valve command.
    if (s.r5t_ok && (s.r5t_tenths < 0 || s.r5t_tenths > 900)) {
        dhw_loss_abort(st, b, DHW_ABORT_READING, now_us);
        return;
    }
    if (s.pump_known && s.pump_on) st.segment_pump_on = true;

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
            st.segment_draw_like = true;
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
        // A draw and rapid continuous cooling can have the same shape. Keep the net sensor
        // change, mark the ambiguity, and start a new context anchor without resetting the hour.
        st.segment_draw_like     = true;
        st.draw_anchor_us = now_us;
        st.draw_anchor_carried_s = 0;
        st.draw_anchor_tenths = s.r5t_tenths;
    }

    if (st.segment_start_us < 0) {
        if (!endpoint_confirmed) return;
        st.segment_start_us = now_us;
        st.segment_carried_s = 0;
        st.segment_start_tenths = s.r5t_tenths;
        st.segment_pump_on      = s.pump_on;
        // Context before the confirmed start is outside this window, including an unconfirmed
        // spike while waiting for its first endpoint.
        st.segment_draw_like     = false;
        st.draw_anchor_us        = now_us;
        st.draw_anchor_carried_s = 0;
        st.draw_anchor_tenths    = s.r5t_tenths;
        return;
    }
    st.segment_pump_on = st.segment_pump_on || s.pump_on;
    if (s.circulation_configured && s.circulation_known) {
        st.segment_circulation_known_s =
            std::min<uint32_t>(UINT32_MAX - dt, st.segment_circulation_known_s) + dt;
        if (s.circulation_on)
            st.segment_circulation_on_s =
                std::min<uint32_t>(UINT32_MAX - dt, st.segment_circulation_on_s) + dt;
    }

    const uint32_t elapsed_s = dhw_loss_age_s(now_us, st.segment_start_us,
                                              st.segment_carried_s);
    if (elapsed_s > DHW_LOSS_WINDOW_S + DHW_LOSS_CLOSE_GRACE_S) {
        dhw_loss_abort(st, b, DHW_ABORT_READING, now_us);
        return;
    }
    if (elapsed_s < DHW_LOSS_WINDOW_S || !endpoint_confirmed) return;
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
    if (st.segment_draw_like) b.draw_windows = checkup_add_u8(b.draw_windows, 1);
    if (st.segment_pump_on) b.pump_windows = checkup_add_u8(b.pump_windows, 1);
    if (b.max_loss_tenths_k_h == CHECKUP_ABSENT ||
        loss_tenths_k_h > b.max_loss_tenths_k_h)
        b.max_loss_tenths_k_h = static_cast<int16_t>(loss_tenths_k_h);

    if (loss_tenths_k_h >= DHW_LOSS_HIGH_TENTHS_K_H) {
        b.high_windows = checkup_add_u8(b.high_windows, 1);
        // Ordinary hot-water use can produce a large net drop. Only hours without either
        // context marker carry the project hint; marked hours remain measured observations.
        if (!st.segment_draw_like && !st.segment_pump_on)
            b.quiet_high_windows = checkup_add_u8(b.quiet_high_windows, 1);
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
    st.segment_draw_like     = false;
    st.segment_pump_on       = s.pump_on;
    st.draw_anchor_us        = now_us;
    st.draw_anchor_carried_s = 0;
    st.draw_anchor_tenths    = s.r5t_tenths;
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
    bool           reseal         = false;
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
    const bool class_state_known =
        s.valve_known && (s.valve_dhw || s.operating_mode != CheckupOperatingMode::Unknown);
    const bool any_known = s.rps_known || s.defrost_known || s.buh_known || s.bsh_known ||
                           s.pump_known || bar_valid || flow_valid ||
                           s.fault != FaultClass::Unknown || s.retry_known_mask;
    bool flow_eligible = false;
    if (continuous) {
        // Time interpolation needs readable endpoints. A recovering ON sample does not establish
        // the preceding blind interval or when the device changed state inside it.
        if (any_known && st.prev_any_known) b.covered_s = checkup_add_hour_s(b.covered_s, dt);
        if (s.rps_known && st.prev_rps_known) {
            b.rps_observed_s = checkup_add_hour_s(b.rps_observed_s, dt);
            if (s.rps_running && st.prev_rps_running) b.run_s = checkup_add_hour_s(b.run_s, dt);
        }
        // BOTH witnesses readable in THIS sample. The pairing is the same bias dfr_pair_observed_s
        // exists to prevent; here it is also the clock that decides whether the class split may be
        // believed at all.
        if (s.rps_known && st.prev_rps_known && class_state_known && st.prev_class_known)
            b.class_observed_s = checkup_add_hour_s(b.class_observed_s, dt);
        if (s.defrost_known && st.prev_dfr_known)
            b.dfr_observed_s = checkup_add_hour_s(b.dfr_observed_s, dt);
        // The defrost share is a ratio of simultaneously-known states. Counting defrost time from
        // one page against compressor time observed on another would bias low whenever the defrost
        // page timed out — exactly the false-clear direction this checkup must avoid.
        if (s.defrost_known && st.prev_dfr_known && s.rps_known && st.prev_rps_known) {
            b.dfr_pair_observed_s = checkup_add_hour_s(b.dfr_pair_observed_s, dt);
            if (s.rps_running && st.prev_rps_running) {
                b.dfr_run_s = checkup_add_hour_s(b.dfr_run_s, dt);
                if (s.defrost_on && st.prev_dfr_on)
                    b.defrost_s = checkup_add_hour_s(b.defrost_s, dt);
                checkup_outdoor_add(b.defrost_outdoor, s.outdoor);
            }
        }
        if (s.buh_known && st.prev_buh_known) {
            b.buh_observed_s = checkup_add_hour_s(b.buh_observed_s, dt);
            if (s.buh_on && st.prev_buh_on) b.buh_s = checkup_add_hour_s(b.buh_s, dt);
        }
        if (s.bsh_known && st.prev_bsh_known) {
            b.bsh_observed_s = checkup_add_hour_s(b.bsh_observed_s, dt);
            if (s.bsh_on && st.prev_bsh_on) b.bsh_s = checkup_add_hour_s(b.bsh_s, dt);
        }
        if (bar_valid) {
            if (st.prev_bar_valid) b.bar_observed_s = checkup_add_hour_s(b.bar_observed_s, dt);
            if (s.bar_tenths <= CHECKUP_BAR_WARN_TENTHS) {
                st.bar_low_run_s = st.prev_bar_valid && st.prev_bar_low
                                       ? checkup_add_u16(st.bar_low_run_s, dt)
                                       : 0;
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
            if (flow_eligible && st.prev_flow_valid && flow_dt)
                b.flow_observed_s = checkup_add_hour_s(b.flow_observed_s, flow_dt);
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
            b.retry_observed_s = checkup_add_hour_s(b.retry_observed_s, dt);
            if (retry_increased) b.flags |= CHECKUP_F_RETRY;
        }

        // Edges. Both sides must be KNOWN — an unreadable cycle in the middle of a run breaks the
        // chain rather than manufacturing a stop and a start on either side of itself. A start is
        // judged against the last KNOWN state of this continuous segment (the previous sample's
        // whenever it was readable): known OFF, unreadable, known ON hides at least one start, so
        // it is counted, and its run opens censored because its beginning was not witnessed.
        const bool rps_edge_known = st.prev_rps_known && s.rps_known;
        if (s.rps_known && s.rps_running && st.last_rps_known && !st.last_rps_running) {
            // An older run whose stop hid inside an unreadable interval must not be overwritten by
            // the new start. It completed, but neither its duration nor class survived the gap.
            if (st.run_open) {
                checkup_censor_run(st, CheckupCensorCause::Unreadable);
                reseal |= checkup_close_run(st, b, ring, current_bucket);
            }
            b.starts = checkup_add_u8(b.starts, 1);
            // Open a run. Tank/space comes from the valve; a space-side run additionally needs the
            // hydronic mode so Cooling can never be relabelled as space heating.
            st.run_open       = true;
            st.run_s          = 0;
            st.run_class      = checkup_run_class(s);
            st.run_class_pure   = st.prev_rps_known && st.run_class != CheckupRunClass::Unknown;
            st.run_start_bucket = current_bucket;
            st.run_outdoor = CheckupOutdoorStats{};
            st.run_started_us = st.run_rps_seen_us = now_us;
            st.run_class_seen_us = st.run_class == CheckupRunClass::Unknown ? -1 : now_us;
            st.run_last_class    = st.run_class;
            st.run_tail_us       = -1;
            st.run_blind_s       = 0;
            st.run_had_gap       = !st.prev_rps_known || st.run_class == CheckupRunClass::Unknown;
            st.run_cause         = !st.prev_rps_known ? CheckupCensorCause::Start
                                   : st.run_class == CheckupRunClass::Unknown
                                       ? CheckupCensorCause::Unreadable
                                       : CheckupCensorCause::None;
        }
        // Bounded interpolation is run classification only; missing seconds never become observed
        // class/RPS coverage. A changed class across a gap cannot certify a handover.
        if (st.run_open) {
            const bool was_running   = st.prev_rps_known && st.prev_rps_running;
            const auto current_class = checkup_run_class(s);
            // dt is intentionally zero at a continuous hourly rollover. Bridge admission must
            // instead bind the complete monotonic interval between the readable endpoints.
            // Every open run initializes run_rps_seen_us; this continuous segment is monotonic.
            const bool rps_gap_ok = now_us - st.run_rps_seen_us <=
                                    static_cast<int64_t>(CHECKUP_CYCLING_GAP_S) * 1000000;
            if (!s.rps_known) {
                st.run_had_gap = true;
                st.run_blind_s = checkup_add_u8(st.run_blind_s, dt);
                if (!rps_gap_ok ||
                    (current_class != CheckupRunClass::Unknown &&
                     current_class != st.run_last_class) ||
                    st.run_tail_us >= 0)
                    checkup_censor_run(st, CheckupCensorCause::Unreadable);
            } else if (s.rps_running) {
                if (!st.prev_rps_known && (!rps_gap_ok || current_class != st.run_last_class))
                    checkup_censor_run(st, CheckupCensorCause::Unreadable);
                // A pure run after an unknown predecessor can only be resuming from that bounded
                // pause; a start sample (known OFF before it) books no elapsed time.
                if (was_running || (!st.prev_rps_known && st.run_class_pure))
                    st.run_s = checkup_add_u32(st.run_s, dt + st.run_blind_s);
                // A terminal valve return is identified by readable valve+mode witnesses, not
                // by inventing a space-heating class. "DHW" mode maps to Other while the valve
                // already points to the room circuit on the reference installation.
                const bool terminal_room = s.valve_known && !s.valve_dhw &&
                                           (s.operating_mode == CheckupOperatingMode::Heating ||
                                            s.operating_mode == CheckupOperatingMode::Other);
                const bool begin_tail =
                    st.run_tail_us < 0 && terminal_room && st.run_class == CheckupRunClass::Dhw &&
                    st.run_last_class == CheckupRunClass::Dhw &&
                    st.run_cause == CheckupCensorCause::None && st.prev_rps_known &&
                    st.prev_rps_running && st.prev_class_known;
                if (begin_tail || st.run_tail_us >= 0) {
                    if (!terminal_room) {
                        const bool readable =
                            s.valve_known && s.operating_mode != CheckupOperatingMode::Unknown;
                        checkup_censor_run(st, readable ? CheckupCensorCause::Transition
                                                        : CheckupCensorCause::Unreadable);
                        if (readable) {
                            st.run_last_class    = current_class;
                            st.run_class_seen_us = now_us;
                        }
                        st.run_tail_us = -1;
                    } else {
                        if (begin_tail)
                            st.run_tail_us = now_us;
                        else if (current_class != st.run_last_class)
                            checkup_censor_run(st, CheckupCensorCause::Transition);
                        if (now_us - st.run_tail_us >
                            static_cast<int64_t>(CHECKUP_CYCLING_DHW_TAIL_S) * 1000000)
                            checkup_censor_run(st, current_class == CheckupRunClass::SpaceHeating
                                                       ? CheckupCensorCause::Handover
                                                       : CheckupCensorCause::Transition);
                        st.run_last_class    = current_class;
                        st.run_class_seen_us = now_us;
                    }
                } else if (current_class == CheckupRunClass::Unknown) {
                    st.run_had_gap = true;
                    if (st.run_class_seen_us < 0 ||
                        now_us - st.run_class_seen_us >
                            static_cast<int64_t>(CHECKUP_CYCLING_GAP_S) * 1000000)
                        checkup_censor_run(st, CheckupCensorCause::Unreadable);
                } else {
                    const bool class_gap = !st.prev_class_known;
                    const bool gap_ok    = st.run_class_seen_us >= 0 &&
                                        now_us - st.run_class_seen_us <=
                                            static_cast<int64_t>(CHECKUP_CYCLING_GAP_S) * 1000000;
                    if (class_gap && (!gap_ok || current_class != st.run_last_class))
                        checkup_censor_run(st, CheckupCensorCause::Unreadable);
                    if (current_class != st.run_last_class && !class_gap && st.prev_rps_known) {
                        const bool handover = (st.run_last_class == CheckupRunClass::SpaceHeating &&
                                               current_class == CheckupRunClass::Dhw) ||
                                              (st.run_last_class == CheckupRunClass::Dhw &&
                                               current_class == CheckupRunClass::SpaceHeating);
                        checkup_censor_run(st, handover ? CheckupCensorCause::Handover
                                                        : CheckupCensorCause::Transition);
                    }
                    st.run_last_class    = current_class;
                    st.run_class_seen_us = now_us;
                }
                st.run_rps_seen_us = now_us;
                // Page 0x20 is read before the 0x30 compressor row and holds the previous run's
                // values while the unit is idle, so only a sample whose predecessor was already
                // running is fresh outdoor context.
                if (was_running && st.run_class_pure &&
                    st.run_class == CheckupRunClass::SpaceHeating)
                    checkup_outdoor_add(st.run_outdoor, s.outdoor);
                st.run_blind_s = 0;
            }
        }
        // A known OFF completes every open run. With a known ON predecessor it is the normal edge;
        // after an unreadable sample it is still a completion, but necessarily censored.
        if (st.run_open && s.rps_known && !s.rps_running) {
            if (!rps_edge_known || !st.prev_rps_running ||
                st.run_class_seen_us < st.run_rps_seen_us)
                checkup_censor_run(st, CheckupCensorCause::Unreadable);
            if (st.run_tail_us >= 0 &&
                now_us - st.run_tail_us >
                    static_cast<int64_t>(CHECKUP_CYCLING_DHW_TAIL_S) * 1000000)
                checkup_censor_run(st, st.run_last_class == CheckupRunClass::SpaceHeating
                                           ? CheckupCensorCause::Handover
                                           : CheckupCensorCause::Transition);
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
        st.pump_run_s     = 0;
        st.bar_low_run_s  = 0;
        st.last_rps_known = false; // no edge is read across a real gap
        // A long gap forfeits classification, but does not prove a completion. Keep the candidate
        // until a known OFF rather than counting the same physical run on both sides of the gap.
        if (st.run_open) {
            st.run_had_gap = true;
            checkup_censor_run(st, CheckupCensorCause::Unreadable);
            if (s.rps_known && !s.rps_running)
                reseal |= checkup_close_run(st, b, ring, current_bucket);
        }
    }
    // The first readable ON witnesses activity even when previous polls were continuous but
    // their RPS row was unreadable. Without a known OFF->ON start, keep a censored candidate
    // until known OFF; do not invent a start count or lose the whole completion.
    if (!st.run_open && s.rps_known && s.rps_running) {
        st.run_open       = true;
        st.run_class_pure = false;
        st.run_class = st.run_last_class = checkup_run_class(s);
        st.run_start_bucket              = current_bucket;
        st.run_started_us = st.run_rps_seen_us = now_us;
        st.run_class_seen_us = st.run_class == CheckupRunClass::Unknown ? -1 : now_us;
        st.run_cause         = CheckupCensorCause::Start;
        st.run_had_gap       = true;
        st.run_blind_s       = 0;
    }

    // ── minima and flags — sampled, not integrated, so they need no continuity ───────────────────
    // Pressure is the RAW lowest valid sample. The separate CHECKUP_F_LOW_BAR flag above controls
    // whether a below-boundary sample was persistent enough for Warn; debounce must not rewrite the
    // measurement into a more reassuring minimum.
    if (bar_valid && (b.min_bar == CHECKUP_ABSENT || s.bar_tenths < b.min_bar ||
                      (s.bar_tenths == b.min_bar && b.min_bar_unix_s == 0 && s.unix_s != 0))) {
        b.min_bar        = static_cast<int16_t>(s.bar_tenths);
        b.min_bar_unix_s = s.unix_s;
    }

    // Flow is only a comparable circuit measurement after a continuously-running pump has completed
    // its run-up; a stopped/newly-started pump reading ~0 l/min is neither a restriction nor news.
    if (flow_eligible && (b.min_flow == CHECKUP_ABSENT || s.flow_tenths < b.min_flow))
        b.min_flow = static_cast<int16_t>(s.flow_tenths);

    if (fault_error_active(s.fault))   b.flags |= CHECKUP_F_FAULT;
    if (fault_warning_active(s.fault)) b.flags |= CHECKUP_F_WARNING;

    st.prev_rps_known   = s.rps_known;
    st.prev_rps_running = s.rps_running;
    if (s.rps_known) {
        st.last_rps_known   = true;
        st.last_rps_running = s.rps_running;
    }
    st.prev_dfr_known   = s.defrost_known;
    st.prev_dfr_on      = s.defrost_on;
    st.prev_pump_known  = s.pump_known;
    st.prev_pump_on     = s.pump_on;
    st.prev_buh_known        = s.buh_known;
    st.prev_buh_on           = s.buh_on;
    st.prev_bsh_known        = s.bsh_known;
    st.prev_bsh_on           = s.bsh_on;
    st.prev_bar_valid        = bar_valid;
    st.prev_bar_low          = bar_valid && s.bar_tenths <= CHECKUP_BAR_WARN_TENTHS;
    st.prev_flow_valid       = flow_valid;
    st.prev_class_known      = class_state_known;
    st.prev_any_known        = any_known;
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
    uint32_t censored_transition_runs  = 0;
    uint32_t censored_handover_runs    = 0;
    uint32_t censored_unreadable_runs  = 0;
    uint32_t censored_restart_runs     = 0;
    uint32_t censored_start_runs       = 0;
    uint32_t censored_runtime_s        = 0;
    bool     cycling_runtime_saturated = false;
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
    uint32_t min_bar_unix_s      = 0;
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
        w.censored_transition_runs += b.censored_transition_runs;
        w.censored_handover_runs += b.censored_handover_runs;
        w.censored_unreadable_runs += b.censored_unreadable_runs;
        w.censored_restart_runs += b.censored_restart_runs;
        const unsigned causes = b.censored_transition_runs + b.censored_handover_runs +
                                b.censored_unreadable_runs + b.censored_restart_runs;
        w.censored_start_runs += b.censored_runs > causes ? b.censored_runs - causes : 0;
        w.censored_runtime_s += b.censored_runtime_s;
        w.cycling_runtime_saturated |=
            b.censored_runtime_s == UINT16_MAX || b.starts == UINT8_MAX ||
            b.space_runs == UINT8_MAX || b.dhw_runs == UINT8_MAX || b.cooling_runs == UINT8_MAX ||
            b.censored_runs == UINT8_MAX || b.censored_transition_runs == UINT8_MAX ||
            b.censored_handover_runs == UINT8_MAX || b.censored_unreadable_runs == UINT8_MAX ||
            b.censored_restart_runs == UINT8_MAX || causes > b.censored_runs;
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
        if (b.min_bar != CHECKUP_ABSENT &&
            (w.min_bar == CHECKUP_ABSENT || b.min_bar < w.min_bar ||
             (b.min_bar == w.min_bar && b.min_bar_unix_s &&
              (!w.min_bar_unix_s || b.min_bar_unix_s < w.min_bar_unix_s)))) {
            w.min_bar = b.min_bar;
            w.min_bar_unix_s = b.min_bar_unix_s;
        }
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
    uint32_t draw_windows        = 0;
    uint32_t pump_windows        = 0;
    uint32_t quiet_high_windows  = 0;
    uint32_t aborts = 0;
    uint32_t best_aborted_s = 0;   // the longest DISCARDED candidate, never a completed one
    uint8_t  abort_reasons = 0;
    int max_loss_tenths_k_h = CHECKUP_ABSENT;
    // The DHW evidence itself spans 24 h (dhw_loss_scope_full). The X10A lifecycle alone does not
    // say so: a DHW-only reset or restore empties this ring without restarting that one.
    bool full_span = false;
};

// `scope_us` is when DHW evidence last restarted without the X10A lifecycle; negative when it never
// did, and the shared lifecycle decides alone.
constexpr bool dhw_loss_scope_full(bool lifecycle_full, int64_t scope_us, int64_t now_us) {
    return lifecycle_full && (scope_us < 0 || now_us - scope_us >= CHECKUP_WINDOW_US);
}

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
        w.draw_windows += b.draw_windows;
        w.pump_windows += b.pump_windows;
        w.quiet_high_windows += b.quiet_high_windows;
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
// Five wire-compatible row states. A verdict is not automatically a judgement: observation-only
// rows can be `Ok` once their value is eligible, then remain outside assessable/evaluated/overall
// below.
//
//   Unavailable  this profile cannot supply the inputs. The check is OFF, not degraded — the rule
//                logic/feature_gate.hpp states and legacy-121 / ou_stale / cop_scope each paid for.
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
        case CheckupCheck::Pressure:
            return "heuristic"; // common project boundary, no model-matched limit
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
enum class CheckupReason : uint8_t {
    None,
    Unsupported,
    DayIncomplete,
    InputCoverage,
    NoEligibleWindows,
    ClassUnavailable,
    ClassCoverage,
    HeatingRunsInsufficient,
    ClassPopulationIncomplete,
    ObservationOnly,
    NoPairedRuntime,
    TooFewDefrostEvents,
    SourceStale
};

inline const char* checkup_reason_name(CheckupReason reason) {
    switch (reason) {
    case CheckupReason::None:
        return "";
    case CheckupReason::Unsupported:
        return "unsupported";
    case CheckupReason::DayIncomplete:
        return "day_incomplete";
    case CheckupReason::InputCoverage:
        return "input_coverage";
    case CheckupReason::NoEligibleWindows:
        return "no_eligible_windows";
    case CheckupReason::ClassUnavailable:
        return "class_unavailable";
    case CheckupReason::ClassCoverage:
        return "class_coverage";
    case CheckupReason::HeatingRunsInsufficient:
        return "heating_runs_insufficient";
    case CheckupReason::ClassPopulationIncomplete:
        return "class_population_incomplete";
    case CheckupReason::ObservationOnly:
        return "observation_only";
    case CheckupReason::NoPairedRuntime:
        return "no_paired_runtime";
    case CheckupReason::TooFewDefrostEvents:
        return "defrost_events_insufficient";
    case CheckupReason::SourceStale:
        return "source_stale";
    }
    return "unsupported";
}

struct CheckupCheckResult {
    CheckupVerdict verdict = CheckupVerdict::Unavailable;
    CheckupReason  reason           = CheckupReason::Unsupported;
    bool           observation_only = false;
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
    if (r.observation_only) return "observation";
    if (c == CheckupCheck::Defrost && r.d <= 0) return "observation";
    return checkup_evidence_name(c);
}

struct CheckupOutdoorReport {
    OutdoorSource source = OutdoorSource::None;
    int min_tenths = CHECKUP_ABSENT;
    int mean_tenths = CHECKUP_ABSENT;
    uint32_t samples = 0;
};

struct CheckupCyclingEvidence {
    int32_t cycling_censored_transition_runs = -1;
    int32_t cycling_censored_handover_runs   = -1;
    int32_t cycling_censored_unreadable_runs = -1;
    int32_t cycling_censored_restart_runs    = -1;
    int32_t cycling_censored_start_runs      = -1;
    int32_t cycling_classified_runtime_s     = -1;
    int32_t cycling_censored_runtime_s       = -1;
    bool    cycling_runtime_saturated        = false;
};

inline CheckupCyclingEvidence checkup_cycling_evidence(const CheckupWindow& w,
                                                       bool                 class_witnessed) {
    CheckupCyclingEvidence e;
    if (!class_witnessed) return e;
    e.cycling_censored_transition_runs = static_cast<int32_t>(w.censored_transition_runs);
    e.cycling_censored_handover_runs   = static_cast<int32_t>(w.censored_handover_runs);
    e.cycling_censored_unreadable_runs = static_cast<int32_t>(w.censored_unreadable_runs);
    e.cycling_censored_restart_runs    = static_cast<int32_t>(w.censored_restart_runs);
    e.cycling_censored_start_runs      = static_cast<int32_t>(w.censored_start_runs);
    e.cycling_classified_runtime_s     = static_cast<int32_t>(w.space_run_s);
    e.cycling_censored_runtime_s       = static_cast<int32_t>(w.censored_runtime_s);
    e.cycling_runtime_saturated        = w.cycling_runtime_saturated;
    return e;
}

struct CheckupReport : CheckupCyclingEvidence {
    uint32_t          covered_s = 0;
    uint32_t          source_age_s        = UINT32_MAX; // unknown is null on the wire
    uint32_t          span_s              = 0; // elapsed observation horizon, capped at 24 hours
    bool              source_fresh        = false;
    uint32_t          pressure_min_unix_s = 0;
    int               pressure_current_tenths = -1;
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
    uint32_t             dhw_draw_windows       = 0;
    uint32_t             dhw_pump_windows       = 0;
    uint32_t             dhw_quiet_high_windows = 0;
    int32_t           cycling_cooling_runs = -1;
    CheckupOutdoorReport cycling_outdoor;
    CheckupOutdoorReport defrost_outdoor;
    // True only when completed, classified heating runs carry the heuristic. Pooled starts/runtime
    // remain observations and never decide the result.
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

inline void checkup_summarize(CheckupReport& r) {
    r.available = r.assessable = r.evaluated = 0;
    r.overall                                = CheckupVerdict::Unavailable;
    for (size_t i = 0; i < CHECKUP_CHECK_COUNT; ++i) {
        const auto  id = static_cast<CheckupCheck>(i);
        const auto& c  = r.checks[i];
        if (c.verdict == CheckupVerdict::Unavailable) continue;
        ++r.available;
        const bool observation =
            checkup_text_equal(checkup_result_evidence_name(id, c), "observation");
        const bool experimental = id == CheckupCheck::Retries;
        const bool finding_only = id == CheckupCheck::DhwLoss || experimental;
        if (!observation && !finding_only) {
            ++r.assessable;
            if (c.verdict != CheckupVerdict::Collecting) ++r.evaluated;
            r.overall = checkup_worse(r.overall, c.verdict);
        } else if (c.verdict == CheckupVerdict::Info || c.verdict == CheckupVerdict::Warn) {
            r.overall = checkup_worse(r.overall, c.verdict);
        }
    }
}

// A missing producer cannot renew a current state or certify absence of findings. Historical
// findings retain their strength; the runtime separately expires their dated retention slots.
inline void checkup_apply_freshness(CheckupReport& r, bool fresh, uint32_t age_s, uint32_t span_s) {
    r.source_fresh = fresh;
    r.source_age_s = age_s;
    r.span_s       = std::min(span_s, CHECKUP_WINDOW_S);
    if (!fresh) {
        r.pressure_current_tenths = -1;
        auto& fault               = r.checks[static_cast<size_t>(CheckupCheck::Fault)];
        if (fault.verdict != CheckupVerdict::Unavailable) {
            fault.a = -1;
            if (fault.verdict == CheckupVerdict::Warn) fault.verdict = CheckupVerdict::Info;
            fault.reason = CheckupReason::SourceStale;
        }
        for (size_t i = 0; i < CHECKUP_CHECK_COUNT; ++i) {
            auto&      c  = r.checks[i];
            const auto id = static_cast<CheckupCheck>(i);
            if (c.verdict == CheckupVerdict::Ok &&
                !checkup_text_equal(checkup_result_evidence_name(id, c), "observation") &&
                id != CheckupCheck::Retries) {
                c.verdict = CheckupVerdict::Collecting;
                c.reason  = CheckupReason::SourceStale;
            }
        }
        r.dhw_candidate_s = 0;
    }
    checkup_summarize(r);
}

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
        x.reason =
            v == CheckupVerdict::Unavailable ? CheckupReason::Unsupported : CheckupReason::None;
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

    // Net sensor cooling remains visible even in a draw-like or pump-active hour. Context
    // qualifies the observation; it cannot turn one tank sensor into whole-tank calorimetry.
    r.dhw_aborts = dhw.aborts;
    r.dhw_abort_reasons = dhw.abort_reasons;
    r.dhw_best_aborted_s = dhw.best_aborted_s;
    r.dhw_draw_windows       = dhw.draw_windows;
    r.dhw_pump_windows       = dhw.pump_windows;
    r.dhw_quiet_high_windows = dhw.quiet_high_windows;
    const bool dhw_supported = cov.r5t && cov.valve && cov.pump && cov.bsh;
    // "No eligible window in 24 h" needs 24 h of DHW evidence scope, not only of X10A lifecycle.
    r.dhw_blocked =
        dhw_supported && w.full_span && dhw.full_span && dhw.windows == 0 && !dhw.high_windows;
    if (!dhw_supported) {
        set(CheckupCheck::DhwLoss, CheckupVerdict::Unavailable, 0, 0);
    } else {
        const auto verdict = dhw.quiet_high_windows
                                 ? CheckupVerdict::Info
                                 : (dhw.windows ? CheckupVerdict::Ok
                                                : (r.dhw_blocked ? CheckupVerdict::Unavailable
                                                                 : CheckupVerdict::Collecting));
        set(CheckupCheck::DhwLoss, verdict, dhw.observed_s, 0,
            dhw.max_loss_tenths_k_h == CHECKUP_ABSENT ? -1 : dhw.max_loss_tenths_k_h,
            static_cast<int>(dhw.windows), static_cast<int>(dhw.high_windows),
            static_cast<int>(dhw.high_with_pump), static_cast<int>(dhw.high_pump_off),
            static_cast<int>(dhw.circulation_on_s), static_cast<int>(dhw.circulation_known_s));
        auto& c            = r.checks[static_cast<size_t>(CheckupCheck::DhwLoss)];
        c.observation_only = !dhw.quiet_high_windows;
        c.reason = dhw.windows ? CheckupReason::ObservationOnly : CheckupReason::NoEligibleWindows;
        if (dhw.quiet_high_windows) c.reason = CheckupReason::None;
    }

    // Only complete, continuously classified space-heating runs decide cycling. Starts and
    // other classes remain observations; an unfinished run cannot dilute completed short runs.
    const bool     class_witnessed = cov.valve && cov.mode && w.class_observed_s > 0;
    const uint32_t classified      = w.space_runs + w.dhw_runs + w.cooling_runs;
    const uint32_t completed       = classified + w.censored_runs;
    // A witnessed start whose completion is not in the window is an unclassified run too: one may
    // still be open, but a restored window whose hour-crossing completions never reached the
    // journal must not judge only the runs that happened to fit inside one hour.
    const uint32_t all_population = std::max<uint32_t>(completed, w.starts ? w.starts - 1 : 0);
    const uint32_t handovers      = std::min(w.censored_handover_runs, all_population);
    const uint32_t population     = all_population - handovers;
    const bool     runtime_ready  = !w.cycling_runtime_saturated && !w.censored_start_runs &&
                               !w.censored_restart_runs &&
                               static_cast<uint64_t>(w.space_run_s) * 100u >=
                                   (static_cast<uint64_t>(w.space_run_s) + w.censored_runtime_s) *
                                       CHECKUP_CYCLING_CLASSIFIED_PCT;
    const bool population_ready =
        completed && runtime_ready &&
        static_cast<uint64_t>(classified) * 100u >=
            static_cast<uint64_t>(population) * CHECKUP_CYCLING_CLASSIFIED_PCT;
    const int space_mean = w.space_runs ? static_cast<int>(w.space_run_s / w.space_runs) : -1;
    const int dhw_mean           = w.dhw_runs ? static_cast<int>(w.dhw_run_s / w.dhw_runs) : -1;
    r.cycling_cooling_runs       = class_witnessed ? static_cast<int32_t>(w.cooling_runs) : -1;
    static_cast<CheckupCyclingEvidence&>(r) = checkup_cycling_evidence(w, class_witnessed);
    CheckupReason cycling_reason = CheckupReason::None;
    if (!cov.valve || !cov.mode)
        cycling_reason = CheckupReason::ClassUnavailable;
    else if (!class_witnessed)
        cycling_reason = CheckupReason::ClassCoverage;
    else if (!population_ready &&
             w.space_runs + w.censored_runs - handovers >= CHECKUP_CYCLING_MIN_STARTS)
        cycling_reason = CheckupReason::ClassPopulationIncomplete;
    else if (w.space_runs < CHECKUP_CYCLING_MIN_STARTS)
        cycling_reason = CheckupReason::HeatingRunsInsufficient;
    else if (!population_ready)
        cycling_reason = CheckupReason::ClassPopulationIncomplete;
    const bool heating_population = cycling_reason == CheckupReason::None;
    r.cycling_split               = heating_population;
    if (!cov.rps) {
        set(CheckupCheck::Cycling, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else {
        auto       verdict = CheckupVerdict::Ok;
        const bool notable = heating_population && space_mean >= 0 &&
                             static_cast<uint32_t>(space_mean) < CHECKUP_CYCLING_SHORT_RUN_S;
        if (notable)
            verdict = CheckupVerdict::Info;
        else if (heating_population && (!w.full_span || w.class_observed_s < CHECKUP_REQUIRED_S ||
                                        w.rps_observed_s < CHECKUP_REQUIRED_S))
            verdict = CheckupVerdict::Collecting;
        else if (!heating_population && !w.rps_observed_s)
            verdict = CheckupVerdict::Collecting;
        set(CheckupCheck::Cycling, verdict,
            heating_population ? w.class_observed_s : w.rps_observed_s,
            heating_population ? CHECKUP_REQUIRED_S : 0,
            w.rps_observed_s ? static_cast<int>(w.starts) : -1, -1,
            class_witnessed ? static_cast<int>(w.space_runs) : -1,
            class_witnessed ? space_mean : -1, class_witnessed ? static_cast<int>(w.dhw_runs) : -1,
            class_witnessed ? dhw_mean : -1,
            class_witnessed ? static_cast<int>(w.censored_runs) : -1);
        auto& c            = r.checks[static_cast<size_t>(CheckupCheck::Cycling)];
        c.observation_only = !heating_population;
        c.reason           = cycling_reason;
    }

    // Paired seconds describe the observed sample population, not missing weather/coil evidence.
    if (!cov.defrost) {
        set(CheckupCheck::Defrost, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else {
        const int  share = w.dfr_run_s ? static_cast<int>(w.defrost_s * 100u / w.dfr_run_s) : -1;
        const bool population =
            cov.rps && w.dfr_run_s && w.paired_defrosts >= CHECKUP_DEFROST_MIN_COUNT;
        const bool notable =
            population && static_cast<uint64_t>(w.defrost_s) * 100u >
                              static_cast<uint64_t>(w.dfr_run_s) * CHECKUP_DEFROST_SHARE_PCT;
        auto verdict = notable ? CheckupVerdict::Info : CheckupVerdict::Ok;
        if (!w.dfr_observed_s)
            verdict = CheckupVerdict::Collecting;
        else if (population && !notable &&
                 (!w.full_span || w.dfr_pair_observed_s < CHECKUP_REQUIRED_S ||
                  w.dfr_observed_s < CHECKUP_REQUIRED_S))
            verdict = CheckupVerdict::Collecting;
        set(CheckupCheck::Defrost, verdict, population ? w.dfr_pair_observed_s : w.dfr_observed_s,
            population ? CHECKUP_REQUIRED_S : 0,
            w.dfr_observed_s ? static_cast<int>(w.defrosts) : -1, cov.rps ? share : -1,
            cov.rps && w.dfr_pair_observed_s ? static_cast<int>(w.defrost_s) : -1,
            cov.rps && w.dfr_pair_observed_s ? static_cast<int>(w.dfr_run_s) : -1,
            cov.rps && w.dfr_pair_observed_s ? static_cast<int>(w.paired_defrosts) : -1);
        auto& c            = r.checks[static_cast<size_t>(CheckupCheck::Defrost)];
        c.observation_only = !population;
        if (!population)
            c.reason = !cov.rps || !w.dfr_run_s ? CheckupReason::NoPairedRuntime
                                                : CheckupReason::TooFewDefrostEvents;
    }

    // The common pressure threshold is a project boundary. Preserve even one accepted zero;
    // publish its dated observation and whether a continuous minute was actually confirmed.
    r.pressure_min_unix_s = w.min_bar_unix_s;
    if (!cov.pressure) {
        set(CheckupCheck::Pressure, CheckupVerdict::Unavailable, 0, CHECKUP_REQUIRED_S);
    } else if (w.min_bar == CHECKUP_ABSENT) {
        set(CheckupCheck::Pressure, CheckupVerdict::Collecting, w.bar_observed_s,
            CHECKUP_REQUIRED_S);
    } else if (w.min_bar <= CHECKUP_BAR_WARN_TENTHS) {
        const bool sustained = (w.flags & CHECKUP_F_LOW_BAR) != 0;
        set(CheckupCheck::Pressure, sustained ? CheckupVerdict::Warn : CheckupVerdict::Info,
            w.bar_observed_s, 0, w.min_bar, sustained ? 1 : 0);
    } else {
        set(CheckupCheck::Pressure,
            w.full_span && w.bar_observed_s >= CHECKUP_REQUIRED_S ? CheckupVerdict::Ok
                                                                  : CheckupVerdict::Collecting,
            w.bar_observed_s, CHECKUP_REQUIRED_S, w.min_bar, 0);
    }

    if (!cov.flow || !cov.pump) {
        set(CheckupCheck::Flow, CheckupVerdict::Unavailable, 0, CHECKUP_MIN_S_FLOW);
    } else {
        set(CheckupCheck::Flow,
            w.min_flow == CHECKUP_ABSENT ? CheckupVerdict::Collecting : CheckupVerdict::Ok,
            w.flow_observed_s, 0, w.min_flow == CHECKUP_ABSENT ? -1 : w.min_flow);
    }

    // Runtime is useful immediately; absence of a supported heater reading stays null.
    if (!cov.buh && !cov.bsh) {
        set(CheckupCheck::Heater, CheckupVerdict::Unavailable, 0, 0);
    } else {
        const bool     any      = (cov.buh && w.buh_observed_s) || (cov.bsh && w.bsh_observed_s);
        const uint32_t observed = cov.buh && cov.bsh
                                      ? std::min(w.buh_observed_s, w.bsh_observed_s)
                                      : (cov.buh ? w.buh_observed_s : w.bsh_observed_s);
        set(CheckupCheck::Heater, any ? CheckupVerdict::Ok : CheckupVerdict::Collecting, observed,
            0, cov.buh && w.buh_observed_s ? static_cast<int>(w.buh_s) : -1,
            cov.bsh && w.bsh_observed_s ? static_cast<int>(w.bsh_s) : -1,
            cov.buh ? static_cast<int>(w.buh_observed_s) : -1,
            cov.bsh ? static_cast<int>(w.bsh_observed_s) : -1);
    }

    if (!cov.fault) {
        set(CheckupCheck::Fault, CheckupVerdict::Unavailable, 0, 0);
    } else if (fault_now == FaultClass::Unknown) {
        set(CheckupCheck::Fault,
            (w.flags & (CHECKUP_F_FAULT | CHECKUP_F_WARNING)) ? CheckupVerdict::Info
                                                              : CheckupVerdict::Collecting,
            0, 0);
    } else if (fault_error_active(fault_now)) {
        set(CheckupCheck::Fault, CheckupVerdict::Warn, 0, 0, 1);
    } else if (fault_warning_active(fault_now)) {
        set(CheckupCheck::Fault, CheckupVerdict::Info, 0, 0, 1);
    } else {
        set(CheckupCheck::Fault,
            (w.flags & (CHECKUP_F_FAULT | CHECKUP_F_WARNING)) ? CheckupVerdict::Info
                                                              : CheckupVerdict::Ok,
            0, 0, 0);
    }

    if (!cov.retries || !cov.rps) {
        set(CheckupCheck::Retries, CheckupVerdict::Unavailable, 0, 0);
    } else {
        const bool seen = (w.flags & CHECKUP_F_RETRY) != 0;
        set(CheckupCheck::Retries,
            seen ? CheckupVerdict::Info
                 : (w.retry_observed_s ? CheckupVerdict::Ok : CheckupVerdict::Collecting),
            w.retry_observed_s, 0, w.retry_observed_s ? (seen ? 1 : 0) : -1);
    }

    for (size_t i = 0; i < CHECKUP_CHECK_COUNT; ++i) {
        auto& c = r.checks[i];
        if (c.reason != CheckupReason::None || c.verdict == CheckupVerdict::Unavailable) continue;
        if (c.verdict == CheckupVerdict::Collecting)
            c.reason = c.required_s && !w.full_span ? CheckupReason::DayIncomplete
                                                    : CheckupReason::InputCoverage;
        else if (c.verdict == CheckupVerdict::Ok &&
                 checkup_text_equal(checkup_result_evidence_name(static_cast<CheckupCheck>(i), c),
                                    "observation"))
            c.reason = CheckupReason::ObservationOnly;
    }
    checkup_summarize(r);
    return r;
}

}  // namespace daik::logic
