#pragma once
// ONE unwind-safe RAII guard for every FreeRTOS mutex in this firmware.
//
// WHY IT IS SHARED. CLAUDE.md's "Never allocate while holding a mutex" rule gives two ways to be
// safe — keep the critical section non-allocating, or take the lock through an RAII guard — and this
// is the second one. Nine files had grown their OWN copy of it (config, hp_poll, hp_modbus, mqtt_ha,
// syslog, ota_update, history, checkup, weather_forecast), in TWO shapes that had already diverged:
// seven discard the take's return value and unconditionally give back on destruction, two record
// whether the take actually succeeded. Nothing chose between them and nothing could — a per-file
// struct is invisible to the file next to it. The divergence is benign today (a blocking take on a
// live mutex does not fail), but it means the two halves of the codebase disagree about what a
// guard IS, and only one of the shapes can express the bounded acquire below at all.
//
// WHY IT MATTERS AT ALL. C++ exceptions are enabled here and std::bad_alloc is a REACHABLE failure,
// not a theoretical one — the whole "Memory constraints" section of CLAUDE.md is about that. A raw
// xSemaphoreTake that unwinds past its give leaves every later reader blocked on portMAX_DELAY, and
// the device wedges into a watchdog reboot: strictly worse than the OOM it came from. A guard
// releases on the normal return path AND while an exception unwinds.
//
// The name is deliberately project-scoped rather than a stock `LockGuard`/`MutexGuard` in the global
// namespace: an identically-named type in any linked component would be a one-definition-rule clash,
// which is ill-formed with no diagnostic required — a class of bug this firmware would find on the
// device or not at all.
//
// TWO acquisition modes, so one type serves both contexts this firmware has:
//
//   * Blocking (default, portMAX_DELAY) — task and HTTP contexts that may wait for the lock.
//         Lock lk(s_mtx);
//         // … guarded work …            // released on scope exit or unwind
//
//   * Bounded / zero wait — callback contexts that MUST NOT block. esp-mqtt's event task is the one
//     this firmware already documents: mqtt_ha.cpp's status writer runs there and cannot use the
//     guard-the-allocation route at all, so it stores string LITERALS to stay non-allocating.
//     A ticks argument (0 == try-lock) gives that path a third option. ALWAYS check acquired()
//     before touching the guarded state — on a failed acquire the guard owns nothing and its
//     destructor gives nothing back.
//         Lock lk(s_mtx, 0);
//         if (!lk) return;               // contended — skip rather than block the callback
//
// A null handle acquires nothing (acquired() == false), matching the `if (m_)` null-guards every
// copy of this already had: a guard over a not-yet-created mutex degrades instead of dereferencing.
//
// One pointer and one bool, no allocation — a guard that could throw while being constructed to
// protect against throwing would be its own problem.
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

namespace daik {

class SemGuard {
public:
    // Blocking acquire. acquired() is true unless `sem` was null.
    explicit SemGuard(SemaphoreHandle_t sem)
        : sem_(sem),
          held_(sem != nullptr && xSemaphoreTake(sem, portMAX_DELAY) == pdTRUE) {}

    // Bounded / zero-wait acquire for contexts that must not block. Check acquired() before using
    // the guarded state.
    SemGuard(SemaphoreHandle_t sem, TickType_t ticks)
        : sem_(sem),
          held_(sem != nullptr && xSemaphoreTake(sem, ticks) == pdTRUE) {}

    ~SemGuard() { if (held_) xSemaphoreGive(sem_); }

    SemGuard(const SemGuard&)            = delete;
    SemGuard& operator=(const SemGuard&) = delete;
    SemGuard(SemGuard&&)                 = delete;
    SemGuard& operator=(SemGuard&&)      = delete;

    // True iff this guard owns the lock (took it, and will release it on scope exit).
    bool acquired() const { return held_; }
    explicit operator bool() const { return held_; }

private:
    SemaphoreHandle_t sem_;
    bool              held_;
};

} // namespace daik
