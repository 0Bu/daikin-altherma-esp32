#pragma once

#include "checkup.hpp"
#include "stop_context.hpp"

namespace daik::logic {

inline DefrostStartRoute defrost_start_route(const StopContextSample& sample) {
    if (!sample.rps_known || !sample.rps_running) return DefrostStartRoute::Unknown;
    if (sample.route == StopContextRoute::Space && sample.mode == StopContextMode::Heating)
        return DefrostStartRoute::SpaceHeating;
    if (sample.route == StopContextRoute::Dhw &&
        (sample.mode == StopContextMode::Heating || sample.mode == StopContextMode::Dhw))
        return DefrostStartRoute::Dhw;
    return DefrostStartRoute::Unknown;
}

// One volatile witnessed start. The daily count, share and outdoor totals retain their own
// population and journal. A newer readable edge with missing context replaces the older edge.
struct DefrostStartTracker {
    DefrostStartReport last;
    int64_t            previous_us      = -1;
    uint32_t           generation       = 0;
    StopContextBit     previous_defrost = StopContextBit::Unknown;
    DefrostStartRoute  previous_route   = DefrostStartRoute::Unknown;

    void pause() noexcept {
        previous_us      = -1;
        previous_defrost = StopContextBit::Unknown;
        previous_route   = DefrostStartRoute::Unknown;
    }

    void observe(const StopContextSample& sample, int outdoor_tenths, int64_t now_us,
                 uint32_t unix_s, uint32_t source_generation) {
        if (generation != source_generation || now_us <= previous_us) {
            *this      = {};
            generation = source_generation;
        }
        if (!generation || now_us < 0) return;
        const auto route = defrost_start_route(sample);
        if (previous_us >= 0 && now_us - previous_us <= CHECKUP_MAX_GAP_S * 1000000LL &&
            previous_defrost == StopContextBit::Off && sample.defrost == StopContextBit::On) {
            last             = {};
            last.observed_us = now_us;
            last.unix_s      = unix_s;
            if (route != DefrostStartRoute::Unknown && route == previous_route) {
                last.route = route;
                if (outdoor_tenths >= -3276 && outdoor_tenths <= 3276)
                    last.outdoor_tenths = static_cast<int16_t>(outdoor_tenths);
            }
        }
        previous_us      = now_us;
        previous_defrost = sample.defrost;
        previous_route   = route;
    }

    DefrostStartReport snapshot(int64_t now_us, uint32_t source_generation) const {
        return generation && source_generation == generation && last.observed_us >= 0 &&
                       now_us >= last.observed_us && now_us - last.observed_us < CHECKUP_WINDOW_US
                   ? last
                   : DefrostStartReport{};
    }
};
static_assert(sizeof(DefrostStartTracker) == 32, "defrost start tracker footprint changed");

} // namespace daik::logic
