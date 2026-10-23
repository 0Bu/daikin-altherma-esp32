#pragma once
// Pure decisions and the lock-free exclusion between /values snapshots and Weather's TLS phase.
// OTA and Weather expose lock-free activity flags; keeping the policy IDF-free lets host tests pin
// both owners, the exact timeout boundaries and the admission order without pretending to exercise
// FreeRTOS on the host.
#include <atomic>
#include <cstdint>

namespace daik::logic {

enum class HttpValuesWaitDecision {
    Ready,
    Wait,
    Refuse,
};

inline HttpValuesWaitDecision http_values_wait_decision(bool ota_active, bool weather_tls_active,
                                                        uint32_t elapsed_ms, uint32_t timeout_ms) {
    // OTA is the long-lived owner and must pre-empt a wait that began for Weather. Otherwise the
    // sole HTTP worker can remain parked here for four seconds after OTA starts, starving the
    // compact progress/status requests that deliberately use a one-second live-gate deadline.
    if (ota_active) return HttpValuesWaitDecision::Refuse;
    if (!weather_tls_active) return HttpValuesWaitDecision::Ready;
    return elapsed_ms >= timeout_ms ? HttpValuesWaitDecision::Refuse : HttpValuesWaitDecision::Wait;
}

// A /values response holds a model-sized snapshot (about 9-10 KB on the 129-row plant) for its
// whole stream, which does not fit beside Weather's TLS claim. It may run through Weather's lead
// and quiesce interval, though, because no TLS memory is held there. Each side announces itself
// first and reads the other second, both sequentially consistent, so at least one of them sees the
// other: a reader either backs off from a raised TLS phase or is counted before Weather's single
// heap-headroom sample.
class ValuesTlsExclusion {
public:
    // /values: count this reader, then admit it only if no TLS phase is raised.
    bool try_enter_reader() noexcept {
        readers_.fetch_add(1, std::memory_order_seq_cst);
        if (!tls_.load(std::memory_order_seq_cst)) return true;
        readers_.fetch_sub(1, std::memory_order_seq_cst);
        return false;
    }
    void leave_reader() noexcept { readers_.fetch_sub(1, std::memory_order_seq_cst); }
    // Weather: raise the phase, then wait until readers() reaches zero before allocating.
    void     begin_tls() noexcept { tls_.store(true, std::memory_order_seq_cst); }
    void     end_tls() noexcept { tls_.store(false, std::memory_order_seq_cst); }
    bool     tls_active() const noexcept { return tls_.load(std::memory_order_seq_cst); }
    uint32_t readers() const noexcept { return readers_.load(std::memory_order_seq_cst); }

private:
    std::atomic<uint32_t> readers_{0};
    std::atomic<bool>     tls_{false};
};
static_assert(std::atomic<uint32_t>::is_always_lock_free && std::atomic<bool>::is_always_lock_free,
              "the /values and Weather TLS exclusion must remain lock-free");

enum class WeatherValuesQuiesceDecision {
    Ready,
    Wait,
    Busy,
};

// Weather's bounded wait for an already-admitted /values stream after raising its TLS phase.
inline WeatherValuesQuiesceDecision
weather_values_quiesce_decision(uint32_t readers, uint32_t elapsed_ms, uint32_t timeout_ms) {
    if (readers == 0) return WeatherValuesQuiesceDecision::Ready;
    return elapsed_ms >= timeout_ms ? WeatherValuesQuiesceDecision::Busy
                                    : WeatherValuesQuiesceDecision::Wait;
}

}  // namespace daik::logic
