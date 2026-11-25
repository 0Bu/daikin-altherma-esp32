#pragma once

#include "hydronic_hourly.hpp"

#include <cstdint>

namespace daik::logic {

struct ModbusHeatingFlowReport {
    HydronicMinimumWindows windows;
    uint16_t               minimum_tenths = 0;
    bool                   supported      = false;
};

// Only the rounded flow and its five-minute locations are needed. A dated RAM ring keeps this
// population independent of both the persisted X10A hydronic journal and the legacy pump minimum.
class ModbusHeatingFlow {
    struct Hour {
        uint32_t utc_hour       = 0;
        uint16_t minimum_tenths = 0;
        uint16_t slots          = 0;
    };
    Hour    hours_[HYDRONIC_WINDOW_HOURS]{};
    int64_t last_us_           = -1;
    int64_t clock_offset_us_   = -1;
    int64_t eligible_since_us_ = -1;

    bool clock_matches(int64_t now_us, int64_t wall_us) const {
        if (last_us_ < 0 || now_us < last_us_ || wall_us < now_us) return false;
        const int64_t shift_us = wall_us - now_us - clock_offset_us_;
        return shift_us >= -2000000 && shift_us <= 2000000;
    }

public:
    void reset() {
        for (auto& hour : hours_) hour = {};
        last_us_           = -1;
        clock_offset_us_   = -1;
        eligible_since_us_ = -1;
    }

    void break_run() { eligible_since_us_ = -1; }

    void record(int64_t now_us, int64_t started_us, int64_t wall_us, uint16_t flow_tenths) {
        if (now_us < 0 || wall_us <= 0 || wall_us < now_us || wall_us / 1000000 > UINT32_MAX) {
            break_run();
            return;
        }
        if (last_us_ >= 0) {
            if (!clock_matches(now_us, wall_us))
                reset();
            else if (now_us - last_us_ > HYDRONIC_MAX_GAP_US)
                break_run();
        }
        if (clock_offset_us_ < 0) clock_offset_us_ = wall_us - now_us;
        last_us_ = now_us;
        if (started_us < 0 || started_us > now_us || now_us - started_us > HYDRONIC_MAX_GAP_US ||
            !flow_tenths) {
            break_run();
            return;
        }
        if (eligible_since_us_ < 0) eligible_since_us_ = now_us;
        if (now_us - eligible_since_us_ < HYDRONIC_SETTLE_US) return;

        const int64_t unix_s   = (now_us + clock_offset_us_) / 1000000;
        const auto    utc_hour = static_cast<uint32_t>(unix_s / 3600);
        const auto    bit      = static_cast<uint16_t>(1u << (unix_s % 3600 / 300));
        auto&         hour     = hours_[utc_hour % HYDRONIC_WINDOW_HOURS];
        if (hour.utc_hour != utc_hour || !hour.minimum_tenths || flow_tenths < hour.minimum_tenths)
            hour = {utc_hour, flow_tenths, bit};
        else if (hour.minimum_tenths == flow_tenths)
            hour.slots |= bit;
    }

    ModbusHeatingFlowReport report(int64_t now_us, int64_t wall_us) const {
        ModbusHeatingFlowReport r;
        r.supported = true;
        if (!clock_matches(now_us, wall_us) || wall_us / 1000000 > UINT32_MAX) return r;
        const int64_t unix_s = (now_us + clock_offset_us_) / 1000000;

        const int64_t first = unix_s / 3600 - static_cast<int64_t>(HYDRONIC_WINDOW_HOURS) + 1;
        if (first < 0) return r;
        for (const auto& hour : hours_) {
            if (!hour.minimum_tenths || hour.utc_hour < first || hour.utc_hour > unix_s / 3600)
                continue;
            if (!r.minimum_tenths || hour.minimum_tenths < r.minimum_tenths) {
                r.minimum_tenths = hour.minimum_tenths;
                r.windows        = {};
            }
            if (hour.minimum_tenths == r.minimum_tenths)
                r.windows.masks[hour.utc_hour - first] = hour.slots;
        }
        if (r.minimum_tenths) r.windows.first_bucket = first;
        return r;
    }
};

} // namespace daik::logic
