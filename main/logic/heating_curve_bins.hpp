#pragma once

#include "outdoor_evidence.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace daik::logic {

// The current UTC date and the six preceding dates, within one boot and target/source scope.
inline constexpr size_t  HEATING_CURVE_BIN_DAYS        = 7;
inline constexpr size_t  HEATING_CURVE_BIN_COUNT       = 4;
inline constexpr int64_t HEATING_CURVE_SECONDS_PER_DAY = 86400;

struct HeatingCurveBinSummary {
    int64_t  first_unix_s       = -1;
    int64_t  last_unix_s        = -1;
    int64_t  room_sum_tenths    = 0;
    int64_t  outdoor_sum_tenths = 0;
    uint32_t samples            = 0;
    uint32_t scope_samples      = 0;
    int16_t  room_min_tenths    = 0;
    int16_t  room_max_tenths    = 0;
    int16_t  outdoor_min_tenths = 0;
    int16_t  outdoor_max_tenths = 0;
};

// Rolling 24-hour compressor-stop windows live on an independent X10A source and horizon.
// A 7-UTC-day heating-curve bin can be juxtaposed with a stop window only when that stop window
// carries proven source identity and the two UTC timestamp spans actually overlap.
inline constexpr bool heating_curve_stop_window_overlaps(const HeatingCurveBinSummary& bin,
                                                         bool    stop_source_proven,
                                                         int64_t stop_start_unix_s,
                                                         int64_t stop_end_unix_s) noexcept {
    if (!stop_source_proven || bin.samples == 0 || bin.first_unix_s < 0 ||
        bin.last_unix_s < bin.first_unix_s || stop_start_unix_s < 0 ||
        stop_end_unix_s < stop_start_unix_s)
        return false;
    return bin.first_unix_s <= stop_end_unix_s && stop_start_unix_s <= bin.last_unix_s;
}

class HeatingCurveBins {
public:
    void forget() noexcept {
        for (auto& day : days_) day.number_plus_one = 0;
        last_unix_s_plus_one_ = 0;
        target_c_             = 0.0;
        has_target_           = false;
    }

    // An unread or temporarily stale target leaves the dated evidence with its known target.
    // A new usable target ends that scope even if the sample cadence would reject this tick.
    void observe_target(double target_c) noexcept {
        if (!std::isfinite(target_c) || (has_target_ && target_c == target_c_)) return;
        forget();
        target_c_   = target_c;
        has_target_ = true;
    }

    void observe_clock(int64_t unix_s) noexcept {
        if (unix_s < 0 || unix_s < last_unix_s()) {
            // Keep the selected target. A clock regression invalidates all dated observations.
            const double target_c   = target_c_;
            const bool   has_target = has_target_;
            forget();
            target_c_   = target_c;
            has_target_ = has_target;
        }
        last_unix_s_plus_one_ = unix_s < 0 ? 0u : static_cast<uint64_t>(unix_s) + 1u;
    }

    double target_c() const noexcept {
        return has_target_ ? target_c_ : std::numeric_limits<double>::quiet_NaN();
    }

    // Call only for a sample already admitted by the existing heating-curve recorder.
    void record(int64_t unix_s, double room_error_k, const OutdoorEvidence& homehub,
                const OutdoorEvidence& env3) noexcept {
        observe_clock(unix_s);
        if (unix_s < 0 || !has_target_ || !fits_tenths(room_error_k)) return;
        const auto     room        = static_cast<int16_t>(std::lround(room_error_k * 10));
        const uint64_t day_number  = static_cast<uint64_t>(unix_s / HEATING_CURVE_SECONDS_PER_DAY);
        const uint64_t encoded_day = day_number + 1u;
        auto&          day = days_[static_cast<size_t>(day_number % HEATING_CURVE_BIN_DAYS)];
        if (day.number_plus_one != encoded_day) {
            day.number_plus_one = encoded_day;
            day.samples         = 0;
            for (auto& axis : day.axes)
                for (auto& bin : axis) bin = {};
        }
        if (day.samples == std::numeric_limits<uint16_t>::max()) return;
        ++day.samples;
        const auto second = static_cast<uint32_t>(unix_s % HEATING_CURVE_SECONDS_PER_DAY);
        add(day.axes[0], OutdoorSource::HomeHub, homehub, room, second);
        add(day.axes[1], OutdoorSource::Env3, env3, room, second);
    }

    HeatingCurveBinSummary summary(OutdoorSource source, size_t band,
                                   int64_t now_unix_s) const noexcept {
        HeatingCurveBinSummary out;
        if ((source != OutdoorSource::HomeHub && source != OutdoorSource::Env3) ||
            band >= HEATING_CURVE_BIN_COUNT || now_unix_s < 0 || now_unix_s < last_unix_s())
            return out;
        const size_t  axis  = source == OutdoorSource::HomeHub ? 0 : 1;
        const int64_t today = now_unix_s / HEATING_CURVE_SECONDS_PER_DAY;
        for (const auto& day : days_) {
            if (day.number_plus_one == 0) continue;
            const int64_t day_number = static_cast<int64_t>(day.number_plus_one - 1u);
            if (today - day_number >= static_cast<int64_t>(HEATING_CURVE_BIN_DAYS)) continue;
            out.scope_samples += day.samples;
            const auto& bin = day.axes[axis][band];
            if (!bin.samples) continue;
            const int64_t start = day_number * HEATING_CURVE_SECONDS_PER_DAY;
            const int64_t first = start + bin.first_second;
            const int64_t last  = start + bin.last_second;
            out.first_unix_s    = out.samples ? std::min(out.first_unix_s, first) : first;
            out.last_unix_s     = std::max(out.last_unix_s, last);
            out.room_min_tenths =
                out.samples ? std::min(out.room_min_tenths, bin.room_min) : bin.room_min;
            out.room_max_tenths =
                out.samples ? std::max(out.room_max_tenths, bin.room_max) : bin.room_max;
            out.outdoor_min_tenths =
                out.samples ? std::min(out.outdoor_min_tenths, bin.outdoor_min) : bin.outdoor_min;
            out.outdoor_max_tenths =
                out.samples ? std::max(out.outdoor_max_tenths, bin.outdoor_max) : bin.outdoor_max;
            out.samples += bin.samples;
            out.room_sum_tenths += bin.room_sum;
            out.outdoor_sum_tenths += bin.outdoor_sum;
        }
        return out;
    }

private:
    // Each accepted input is representable in signed tenths. A full uint16_t count times that
    // bound fits int32_t. The shared day count bounds all bin counts.
    struct Bin {
        int32_t  room_sum     = 0;
        int32_t  outdoor_sum  = 0;
        uint32_t first_second = 0;
        uint32_t last_second  = 0;
        uint16_t samples      = 0;
        int16_t  room_min     = 0;
        int16_t  room_max     = 0;
        int16_t  outdoor_min  = 0;
        int16_t  outdoor_max  = 0;
    };
    using Axis = std::array<Bin, HEATING_CURVE_BIN_COUNT>;
    // Zero-initialized representation so a static firmware instance lands in BSS instead of Flash.
    struct Day {
        uint64_t            number_plus_one = 0;
        std::array<Axis, 2> axes{};
        uint16_t            samples = 0;
    };

    int64_t last_unix_s() const noexcept {
        return last_unix_s_plus_one_ == 0 ? -1 : static_cast<int64_t>(last_unix_s_plus_one_ - 1u);
    }

    static bool fits_tenths(double value) noexcept { return value >= -3276.7 && value <= 3276.7; }

    static void add(Axis& axis, OutdoorSource source, const OutdoorEvidence& outdoor, int16_t room,
                    uint32_t second) noexcept {
        if (outdoor.source != source || !outdoor_evidence_valid(outdoor) ||
            !fits_tenths(outdoor.temperature_c))
            return;
        const double temp = outdoor.temperature_c;
        // Classify the received temperature before rounding to the fixed-point summary precision.
        const size_t band = temp < 0 ? 0 : temp < 5 ? 1 : temp < 10 ? 2 : 3;
        auto&        bin  = axis[band];
        const auto   air  = static_cast<int16_t>(std::lround(temp * 10));
        if (bin.samples == 0) {
            bin.first_second = second;
            bin.room_min = bin.room_max = room;
            bin.outdoor_min = bin.outdoor_max = air;
        } else {
            bin.room_min    = std::min(bin.room_min, room);
            bin.room_max    = std::max(bin.room_max, room);
            bin.outdoor_min = std::min(bin.outdoor_min, air);
            bin.outdoor_max = std::max(bin.outdoor_max, air);
        }
        ++bin.samples;
        bin.last_second = second;
        bin.room_sum += room;
        bin.outdoor_sum += air;
    }

    std::array<Day, HEATING_CURVE_BIN_DAYS> days_{};
    uint64_t                                last_unix_s_plus_one_ = 0;
    double                                  target_c_             = 0.0;
    bool                                    has_target_           = false;
};
static_assert(sizeof(HeatingCurveBins) <= 1704, "heating curve bin storage exceeds its bound");

} // namespace daik::logic
