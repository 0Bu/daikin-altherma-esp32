#pragma once
// Exact, completed tank-cooling windows. Ordinary runtime RAM only: hourly journal aggregates
// cannot restore endpoint times or pair a rate with its context. Never infer them from those sums.
#include <algorithm>
#include <cstddef>
#include <cstdint>

namespace daik::logic {

constexpr size_t   DHW_LOSS_TRACE_CAPACITY = 24;
constexpr uint32_t DHW_LOSS_TRACE_WINDOW_S = 24 * 3600;

inline uint32_t dhw_loss_wall_anchor_s(uint32_t window_end_s, int64_t before_us, int64_t after_us,
                                       int64_t unix_s, int32_t unix_ms) {
    constexpr int64_t US_PER_S = 1000000;
    const int64_t     frame_us = static_cast<int64_t>(window_end_s) * US_PER_S;
    if (before_us < frame_us || after_us < before_us || unix_s <= 0 || unix_s > UINT32_MAX ||
        unix_ms < 0 || unix_ms >= 1000)
        return 0;

    // The wall clock was sampled somewhere in the monotonic bracket and truncated to milliseconds.
    const int64_t wall_us  = unix_s * US_PER_S + static_cast<int64_t>(unix_ms) * 1000;
    const int64_t earliest = (wall_us - (after_us - frame_us)) / US_PER_S;
    const int64_t latest   = (wall_us + 999 - (before_us - frame_us)) / US_PER_S;
    return earliest > 0 && earliest == latest ? static_cast<uint32_t>(earliest) : 0;
}

struct DhwLossTraceWindow {
    uint32_t start_s     = 0; // whole-second timestamps in this boot's monotonic frame
    uint32_t end_s       = 0;
    uint16_t rate_tenths = 0;     // the evaluator's nonnegative net cooling rate, not energy
    uint16_t observed_s  = 0;     // duration minus the evaluator's tolerated blind seconds
    bool     pump_marker = false; // internal hydronic pump, NOT the external circulation witness
    bool     draw_marker = false; // temperature shape, NOT proof of a water draw
};

// Caller-owned output. Clear metadata rather than constructing a large temporary on a task stack.
struct DhwLossTimeline {
    DhwLossTraceWindow windows[DHW_LOSS_TRACE_CAPACITY]{};
    uint32_t           epoch        = 0; // zero means that no eligible snapshot was supplied
    uint32_t           window_end_s = 0;
    uint32_t           since_s = 0; // collection lifecycle, NOT continuous measurement coverage
    uint32_t           observed_end_s = 0;
    uint32_t           unix_s         = 0; // optional trusted wall-clock anchor at window_end_s
    uint8_t            count          = 0;
    bool               observed       = false;
    bool               live           = false;

    void clear() {
        epoch = window_end_s = since_s = observed_end_s = unix_s = 0;
        count                                                    = 0;
        observed = live = false;
    }
};

struct DhwLossTrace {
    DhwLossTraceWindow windows[DHW_LOSS_TRACE_CAPACITY]{};
    int64_t            last_us         = 0;
    int64_t            observed_end_us = 0;
    uint32_t           epoch           = 1;
    uint32_t           since_s         = 0;
    uint8_t            head            = 0;
    uint8_t            count           = 0;
    bool               begun           = false;
    bool               observed        = false;

    void reset() {
        if (++epoch == 0) epoch = 1;
        last_us = observed_end_us = 0;
        since_s                   = 0;
        head = count = 0;
        begun = observed = false;
    }

    void expire(uint32_t now_s) {
        if (now_s < DHW_LOSS_TRACE_WINDOW_S) return;
        const uint32_t cutoff = now_s - DHW_LOSS_TRACE_WINDOW_S;
        while (count && windows[head].end_s <= cutoff) {
            head = static_cast<uint8_t>((head + 1) % DHW_LOSS_TRACE_CAPACITY);
            --count;
        }
    }

    void observe(int64_t now_us, bool inputs_readable) {
        if (now_us < 0 || now_us / 1000000 > UINT32_MAX) return;
        const auto now_s = static_cast<uint32_t>(now_us / 1000000);
        if (begun && now_us < last_us) reset(); // a different monotonic frame cannot share records
        if (!begun) {
            since_s = now_s;
            begun   = true;
        }
        last_us = now_us;
        if (inputs_readable) {
            observed_end_us = now_us;
            observed        = true;
        }
        expire(now_s);
    }

    // Called only at the evaluator's accepted completion, with its already-computed values.
    // At least an hour between adjacent completions proves the 24-record strict-horizon capacity.
    bool record(int64_t start_us, int64_t end_us, int rate_tenths, uint32_t observed_s,
                bool pump_marker, bool draw_marker) {
        if (!begun || start_us < 0 || end_us < start_us || end_us / 1000000 > UINT32_MAX)
            return false;
        const auto duration_s = static_cast<uint32_t>((end_us - start_us) / 1000000);
        if (duration_s < DHW_LOSS_TRACE_WINDOW_S / DHW_LOSS_TRACE_CAPACITY ||
            duration_s > UINT16_MAX || rate_tenths < 0 || rate_tenths > 900 ||
            observed_s > duration_s)
            return false;
        const auto end_s   = static_cast<uint32_t>(end_us / 1000000);
        const auto start_s = static_cast<uint32_t>(start_us / 1000000);
        if (end_us != last_us) return false;
        // Quantize the real endpoints independently. Reconstructing start from floor(duration)
        // would introduce artificial one-second gaps between truly adjacent windows.
        if (start_s < since_s) return false;
        if (count && windows[(head + count - 1) % DHW_LOSS_TRACE_CAPACITY].end_s > start_s)
            return false;
        expire(end_s);
        if (count == DHW_LOSS_TRACE_CAPACITY)
            return false; // capacity proof, never overwrite evidence
        auto& w       = windows[(head + count) % DHW_LOSS_TRACE_CAPACITY];
        w.start_s     = start_s;
        w.end_s       = end_s;
        w.rate_tenths = static_cast<uint16_t>(rate_tenths);
        w.observed_s  = static_cast<uint16_t>(observed_s);
        w.pump_marker = pump_marker;
        w.draw_marker = draw_marker;
        ++count;
        return true;
    }

    bool snapshot(DhwLossTimeline& out, int64_t now_us, uint32_t fresh_s) {
        out.clear();
        if (!begun || now_us < 0 || now_us / 1000000 > UINT32_MAX) return false;
        const auto now_s = static_cast<uint32_t>(now_us / 1000000);
        if (now_us < last_us) return false;
        expire(now_s); // stopped or paused producers do not extend record retention
        out.epoch          = epoch;
        out.window_end_s   = now_s;
        out.since_s        = since_s;
        out.observed_end_s = static_cast<uint32_t>(observed_end_us / 1000000);
        out.observed       = observed;
        out.live  = observed && now_us - observed_end_us <= static_cast<int64_t>(fresh_s) * 1000000;
        out.count = count;
        for (size_t i = 0; i < count; ++i)
            out.windows[i] = windows[(head + i) % DHW_LOSS_TRACE_CAPACITY];
        return true;
    }
};

static_assert(sizeof(DhwLossTraceWindow) == 16, "DHW window record exceeded its static budget");
static_assert(sizeof(DhwLossTrace) <= 416, "DHW detail ring exceeded its static budget");
static_assert(sizeof(DhwLossTimeline) <= 416, "DHW optional snapshot exceeded its heap budget");

} // namespace daik::logic
