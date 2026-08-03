#pragma once
#include <cstdint>

namespace daik {

struct Env3Status {
    bool started = false;
    bool connected = false;
    bool fresh = false;
    float temperature_c = 0.0f;
    float humidity_pct = 0.0f;
    float pressure_hpa = 0.0f;
    uint32_t age_s = 0;
    uint32_t samples = 0;
    uint32_t errors = 0;
    const char* error = "not_started";
};

void env3_start();
Env3Status env3_status();

} // namespace daik
