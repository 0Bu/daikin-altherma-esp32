#pragma once
#include "logic/checkup.hpp"

// Synthetic equivalent of the reported population, containing no installation identifiers. Twelve
// space runs (ten 234 s, two 2178 s), five 1800 s DHW charges with 6..22 s valve tails, and four
// uninterrupted space-to-DHW handovers. Seven space runs lose one valve row mid-run, including
// both long ones. All runs start after hour one so none ages out when the 24 h window closes.
inline daik::logic::CheckupWindow checkup_population_fixture() {
    using namespace daik::logic;
    CheckupRing   ring;
    CheckupState  state;
    CheckupSample sample;
    sample.rps_known = sample.valve_known = true;
    sample.operating_mode                 = CheckupOperatingMode::Heating;
    int64_t  seconds                      = -1;
    uint32_t previous_bucket              = 0;
    auto     tick                         = [&](bool running, bool dhw, bool valve_known = true) {
        ++seconds;
        const int64_t  now    = seconds * 1000000;
        const uint32_t bucket = checkup_bucket(now);
        if (bucket != previous_bucket) {
            ring.commit(checkup_skipped(previous_bucket, bucket));
            state.last_us   = now; // production's continuous-boundary rule
            previous_bucket = bucket;
        }
        sample.rps_running = running;
        sample.valve_dhw   = dhw;
        sample.valve_known = valve_known;
        ring.observe(now);
        checkup_step(state, ring.pending, sample, now, &ring);
    };
    while (seconds < 3600) tick(false, false);
    for (unsigned run = 0; run < 12; ++run) {
        const unsigned duration = run < 10 ? 234 : 2178;
        const bool     partial  = run < 5 || run >= 10;
        for (unsigned second = 0; second <= duration; ++second)
            tick(true, false, !(partial && second == duration / 2));
        tick(false, false);
        for (unsigned second = 0; second < 60; ++second) tick(false, false);
    }
    sample.operating_mode = CheckupOperatingMode::Other; // actual readable I/U mode: "DHW"
    for (unsigned run = 0; run < 5; ++run) {
        const unsigned tail = 6 + 4 * run;
        for (unsigned second = 0; second <= 1800 - tail; ++second) tick(true, true);
        for (unsigned second = 0; second < tail; ++second) tick(true, false);
        tick(false, false);
    }
    sample.operating_mode = CheckupOperatingMode::Heating;
    for (unsigned run = 0; run < 4; ++run) {
        for (unsigned second = 0; second < 900; ++second) tick(true, false);
        for (unsigned second = 0; second < 2400; ++second) tick(true, true);
        for (unsigned second = 0; second < 19; ++second) tick(true, false);
        tick(false, false);
    }
    while (seconds < CHECKUP_WINDOW_S) tick(false, false);
    return checkup_aggregate(ring);
}
