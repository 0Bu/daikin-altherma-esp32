#pragma once
// Pure decision for the bounded /values wait in front of its model-sized heap snapshot. OTA and
// Weather expose lock-free activity flags; keeping the policy IDF-free lets host tests pin both
// owners and the exact timeout boundary without pretending to exercise FreeRTOS on the host.
#include <cstdint>

namespace daik::logic {

enum class HttpValuesWaitDecision {
    Ready,
    Wait,
    Refuse,
};

inline HttpValuesWaitDecision http_values_wait_decision(bool ota_active, bool weather_active,
                                                         uint32_t elapsed_ms,
                                                         uint32_t timeout_ms) {
    // OTA is the long-lived owner and must pre-empt a wait that began for Weather. Otherwise the
    // sole HTTP worker can remain parked here for four seconds after OTA starts, starving the
    // compact progress/status requests that deliberately use a one-second live-gate deadline.
    if (ota_active) return HttpValuesWaitDecision::Refuse;
    if (!weather_active) return HttpValuesWaitDecision::Ready;
    return elapsed_ms >= timeout_ms ? HttpValuesWaitDecision::Refuse : HttpValuesWaitDecision::Wait;
}

}  // namespace daik::logic
