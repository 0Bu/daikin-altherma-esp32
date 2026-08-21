#pragma once
// THE ONE stack-headroom sampler — the second memory budget, and the one that fails silently.
//
// Everything under "Memory constraints" about the heap is reported: /status.sys carries free /
// min-free / largest-block, two trend rings chart them, and heap_guard.cpp restarts the board when
// the largest contiguous block stays unusable. The STACK had none of that. Three overflows shipped
// (v1.0.12 on httpd, #241 on hp_poll, #318 on httpd again through OTA) and each was diagnosed the
// same way afterwards: by reading the USED/FREE column of a core dump's task table, which exists
// only once the board has already died. Between those crashes the headroom was invisible — an idle
// board looks identical at every stack size, so the frame growth that ate 1200 bytes across #318
// announced itself nowhere until the fleet updated onto it.
//
// This closes that half. `uxTaskGetStackHighWaterMark` already answers the question per task; what
// was missing was a REPORTING path, so the number reaches a metrics store while the board is alive
// and a growing frame reads as a falling line months before it reads as a panic.
//
// A RETROSPECTIVE reading: FreeRTOS keeps the lowest free stack the task has ever had, so the
// sample instant does not have to coincide with the deepest frame — which is what lets every caller
// sample at the top of its loop, the one point no branch can skip.
//
// The MINIMUM is still tracked here rather than trusted to FreeRTOS, and the reason is one task:
// hp_modbus's stack RETIRES itself when the HomeHub address is cleared and is recreated when one is
// saved, and a fresh task starts with a fresh high-water mark. Keeping the minimum across
// incarnations makes every slot mean the same thing — the worst headroom this BOARD has had since
// boot — instead of meaning that for three tasks and "since the last reconfigure" for the fourth.
#include <cstdint>

namespace daik {

// One slot per task that carries a deep frame or a documented overflow. Deliberately NOT every task
// this firmware creates: the ones left out (syslog, weather, ENV III, the LED, the button) have
// small, bounded bodies and no history here, and a payload field per task would cost every consumer
// a set of permanently-flat series to rule out — the test that retired "WiFi Quality".
enum class StackWatch : uint8_t {
    // The deepest chain in the firmware (mcp_post -> http_send_status_json -> append_status_json),
    // 16384. Sampled per
    // REQUEST, so it stays unsampled — and therefore null — on a board nobody has browsed this
    // boot. That is the right answer rather than a gap to close: the deep frame exists only while a
    // request is being served, so an idle httpd task would report the headroom of its select loop,
    // a large and entirely uninteresting number that reads as enormous margin on precisely the path
    // that has never been exercised. Null says "not measured"; a number here always means a request
    // was served to get it.
    Httpd = 0,
    Poll,        // hp_poll — #241 died here, 8192
    Mqtt,        // the publish task, whose cycle builds every payload
    Modbus,      // the HomeHub link; the only slot whose task can be destroyed and recreated
    COUNT,
};

// Record this task's high-water mark into `which`. MUST be called FROM the task that owns the slot
// — it reads the CALLING task's mark (uxTaskGetStackHighWaterMark(nullptr)), so calling it for
// another task's slot silently files one task's headroom under another's name. Lock-free and
// allocation-free: one relaxed load, one compare, at most one relaxed store, with a single writer
// per slot by that same rule.
//
// NOEXCEPT is a contract, not decoration: the httpd slot is sampled from a destructor that runs
// while a std::bad_alloc unwinds out of handle_all, and a throw from there is std::terminate — the
// exact reboot that guard exists to prevent. Nothing in either function can allocate or throw, and
// saying so makes a future edit that could a compile error rather than a crash under memory
// pressure, which is the only condition it would ever appear in.
void stack_watch_sample(StackWatch which) noexcept;

// The worst headroom that slot has reported since boot, in BYTES — the unit ESP-IDF's
// uxTaskGetStackHighWaterMark answers in, so nothing is converted and the number compares directly
// against a core dump's task table and against the stack size passed to xTaskCreate. Vanilla
// FreeRTOS returns WORDS here and ESP-IDF deliberately does not; the unit belongs in every
// identifier this value reaches, because it ends up as a VictoriaMetrics series suffix where a
// wrong unit word publishes a false quantity four times too large. See stack_watch.cpp for the two
// measurements that settle it. ZERO MEANS NEVER SAMPLED, and every reporting site
// must render that as null rather than as a number: a task that has not run yet is not a task with
// no stack left, and on a board with no HomeHub the Modbus slot stays that way forever. The
// ambiguity with a genuine zero is accepted — a task that has actually consumed its last word has
// already taken the board down with it, so there is nobody left to read the field.
uint32_t stack_watch_min_free_bytes(StackWatch which) noexcept;

} // namespace daik
