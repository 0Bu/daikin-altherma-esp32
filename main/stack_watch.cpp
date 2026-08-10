#include "stack_watch.hpp"

#include <atomic>
#include <cstddef>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace daik {
namespace {

// .bss, not the heap: this exists to report on a board that may be out of memory, so it must not
// need any. One writer per slot (the owning task) and any number of readers, so a relaxed
// load/compare/store is the whole synchronisation — a reader racing a writer sees either the old
// or the new minimum, and both are true statements about a monotonically falling number.
std::atomic<uint32_t> s_min_free_bytes[static_cast<size_t>(StackWatch::COUNT)] = {};

} // namespace

void stack_watch_sample(StackWatch which) noexcept {
    const auto i = static_cast<size_t>(which);
    if (i >= static_cast<size_t>(StackWatch::COUNT)) return;
    // BYTES. This is an ESP-IDF DEVIATION from vanilla FreeRTOS, whose uxTaskGetStackHighWaterMark
    // returns WORDS — and getting it wrong is not a rounding error but a 4x overstatement of
    // headroom in the one metric that exists to warn about running out. Measured on the reference
    // board: hp_modbus is created with a 6144-byte stack (xTaskCreate's depth argument is bytes
    // here too, the same deviation) and reports 2660; as words that would be 10640 bytes free on a
    // 6144-byte stack. The #241 core dump agrees from the other side — `hp_poll 7664/520` on an
    // 8192 stack sums to 8184. Keep the unit in every identifier this value reaches: it becomes
    // the VictoriaMetrics series suffix, where a wrong unit word is a published false quantity
    // (the #230 LABEL-UNIT rule, applied to a board metric).
    const uint32_t free_bytes = static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr));
    const uint32_t prev = s_min_free_bytes[i].load(std::memory_order_relaxed);
    // `prev == 0` is the never-sampled sentinel, so the first sample always wins — otherwise a slot
    // would stay at 0 forever and every reporting site would render null on a task that has run.
    if (prev == 0 || free_bytes < prev)
        s_min_free_bytes[i].store(free_bytes, std::memory_order_relaxed);
}

uint32_t stack_watch_min_free_bytes(StackWatch which) noexcept {
    const auto i = static_cast<size_t>(which);
    if (i >= static_cast<size_t>(StackWatch::COUNT)) return 0;
    return s_min_free_bytes[i].load(std::memory_order_relaxed);
}

} // namespace daik
