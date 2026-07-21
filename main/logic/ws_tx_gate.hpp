#pragma once

#include <atomic>

namespace daik {

// Bounds an asynchronous WebSocket stream to one outstanding broadcast batch.  If the IDF HTTP
// server is too busy to run completion callbacks, producers drop newer frames instead of retaining
// another payload every poll tick until the heap is exhausted.
class WsTxGate {
public:
    WsTxGate() = default;
    WsTxGate(const WsTxGate&) = delete;
    WsTxGate& operator=(const WsTxGate&) = delete;

    bool try_begin() {
        bool expected = false;
        return in_flight_.compare_exchange_strong(expected, true,
                                                   std::memory_order_acq_rel,
                                                   std::memory_order_acquire);
    }

    void complete() { in_flight_.store(false, std::memory_order_release); }

    bool in_flight() const { return in_flight_.load(std::memory_order_acquire); }

private:
    std::atomic<bool> in_flight_{false};
};

} // namespace daik
