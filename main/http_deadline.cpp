#include "http_deadline.hpp"

#include "diag_log.hpp"
#include "logic/http_deadline.hpp"
#include "rtos_guard.hpp"
#include "task_config.hpp"
#include "arch/sys_arch.h"
#include "esp_timer.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lwip/sockets.h"

#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstdlib>

namespace daik {
namespace {

constexpr uint32_t   kWatchdogStackBytes = 3072;
constexpr TickType_t kWatchdogInitWait   = pdMS_TO_TICKS(1000);

struct DeadlineTimerState {
    esp_timer_handle_t  timer = nullptr;
    StaticSemaphore_t   init_completion_storage{};
    SemaphoreHandle_t   init_completion = nullptr;
    StaticSemaphore_t   completion_storage{};
    SemaphoreHandle_t   completion = nullptr;
    StaticSemaphore_t   owner_mutex_storage{};
    SemaphoreHandle_t   owner_mutex = nullptr;
    StaticTask_t        watchdog_task_storage{};
    StackType_t         watchdog_stack[kWatchdogStackBytes]{};
    TaskHandle_t        watchdog_task = nullptr;
    std::atomic<int>    socket{-1};
    std::atomic<bool>   fired{false};
    std::atomic<bool>   lwip_primed{false};
    std::atomic<bool>   shutdown_failed{false};
    std::atomic<bool>   ready{false};
    HttpSocketDeadline* owner = nullptr; // protected by owner_mutex; never read by the callback
    bool                init_attempted = false; // boot sequence is the sole initializer
};

DeadlineTimerState s_deadline;
static_assert(std::atomic<int>::is_always_lock_free,
              "socket publication from the timer callback must remain lock-free");
static_assert(std::atomic<bool>::is_always_lock_free,
              "deadline verdict publication from the timer callback must remain lock-free");

[[noreturn]] void deadline_fail_closed() noexcept { std::abort(); }

__attribute__((noinline)) void socket_deadline_watchdog_task(void*) noexcept {
    // With LWIP_NETCONN_SEM_PER_THREAD=1, the first BSD socket API on a task lazily allocates an
    // internal StaticSemaphore_t. Do it exactly once at boot, before TLS pressure, and verify the
    // pinned IDF port returned its initialized semaphore. In ESP-IDF v6.0.2 the API returns nullptr
    // after either allocation or static-semaphore creation failure; its sys_sem_valid macro is not
    // C++ compatible because it takes the address of a C compound literal. A failed prime leaves
    // the task parked and keeps
    // ready=false, so neither OTA nor Weather can start a transfer which cannot be interrupted.
    sys_sem_t* const thread_sem = sys_thread_sem_get();
    const bool       primed     = thread_sem != nullptr;
    s_deadline.lwip_primed.store(primed, std::memory_order_release);
    if (s_deadline.init_completion) (void)xSemaphoreGive(s_deadline.init_completion);
    if (!primed) {
        vTaskSuspend(nullptr);
        deadline_fail_closed();
    }

    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        const int socket = s_deadline.socket.load(std::memory_order_acquire);
        if (socket < 0) {
            s_deadline.shutdown_failed.store(true, std::memory_order_release);
            deadline_fail_closed();
        }

        errno                     = 0;
        const int shutdown_result = shutdown(socket, SHUT_RDWR);
        const int shutdown_errno  = errno;
        // ENOTCONN means the peer already detached the still-owner-held descriptor, which has the
        // same receive-unblocking effect. ENOMEM (including a regressed lazy lwIP allocation),
        // EBADF and every other result make exclusion unprovable and must never release the owner.
        if (shutdown_result != 0 && shutdown_errno != ENOTCONN) {
            s_deadline.shutdown_failed.store(true, std::memory_order_release);
            deadline_fail_closed();
        }
        if (!s_deadline.completion || xSemaphoreGive(s_deadline.completion) != pdTRUE) {
            s_deadline.shutdown_failed.store(true, std::memory_order_release);
            deadline_fail_closed();
        }
    }
}

void socket_deadline_expired(void*) noexcept {
    // Keep ESP_TIMER_TASK allocation- and socket-free. The dedicated static task above owns the
    // pre-primed lwIP semaphore and performs shutdown; this callback only latches the verdict and
    // wakes it. The HTTP owner joins that task's acknowledgement before fd close/reuse.
    s_deadline.fired.store(true, std::memory_order_release);
    if (!s_deadline.watchdog_task) deadline_fail_closed();
    xTaskNotifyGive(s_deadline.watchdog_task);
}

} // namespace

bool http_deadline_init() noexcept {
    if (s_deadline.init_attempted) return http_deadline_ready();
    s_deadline.init_attempted  = true;
    s_deadline.init_completion = xSemaphoreCreateBinaryStatic(&s_deadline.init_completion_storage);
    s_deadline.completion      = xSemaphoreCreateBinaryStatic(&s_deadline.completion_storage);
    s_deadline.owner_mutex     = xSemaphoreCreateMutexStatic(&s_deadline.owner_mutex_storage);
    if (!s_deadline.init_completion || !s_deadline.completion || !s_deadline.owner_mutex)
        return false;

    s_deadline.watchdog_task = xTaskCreateStatic(
        socket_deadline_watchdog_task, "http_abs_dl", kWatchdogStackBytes, nullptr,
        TASK_PRIO_HTTP_DEADLINE, s_deadline.watchdog_stack, &s_deadline.watchdog_task_storage);
    if (!s_deadline.watchdog_task ||
        xSemaphoreTake(s_deadline.init_completion, kWatchdogInitWait) != pdTRUE ||
        !s_deadline.lwip_primed.load(std::memory_order_acquire)) {
        diag_printf("http deadline: lwIP watchdog prime failed\n");
        return false;
    }

    esp_timer_create_args_t args{};
    args.callback        = socket_deadline_expired;
    args.dispatch_method = ESP_TIMER_TASK;
    args.name            = "http_abs_dl";
    const esp_err_t err  = esp_timer_create(&args, &s_deadline.timer);
    if (err != ESP_OK) {
        diag_printf("http deadline: timer init failed (%s)\n", esp_err_to_name(err));
        return false;
    }
    s_deadline.ready.store(true, std::memory_order_release);
    return true;
}

bool http_deadline_ready() noexcept { return s_deadline.ready.load(std::memory_order_acquire); }

HttpSocketDeadline::~HttpSocketDeadline() { (void)disarm(); }

esp_err_t HttpSocketDeadline::arm(esp_http_client_handle_t client, TickType_t started,
                                  TickType_t duration) noexcept {
    if (active_ || !client || duration == 0 || !http_deadline_ready() || !s_deadline.owner_mutex)
        return ESP_ERR_INVALID_STATE;

    const TickType_t now       = xTaskGetTickCount();
    const TickType_t remaining = http_deadline_remaining_ticks(started, now, duration);
    if (remaining == 0) {
        expired_latched_ = true;
        return ESP_ERR_TIMEOUT;
    }

    SemGuard owner_lock(s_deadline.owner_mutex, 0);
    if (!owner_lock || s_deadline.owner != nullptr) return ESP_ERR_INVALID_STATE;

    const int socket = esp_http_client_get_socket(client);
    if (socket < 0) return ESP_ERR_INVALID_STATE;

    // A completed prior one-shot leaves exactly one acknowledgement. Drain it before publishing
    // the new descriptor; otherwise disarm could mistake an old callback for this generation.
    while (xSemaphoreTake(s_deadline.completion, 0) == pdTRUE) {}
    s_deadline.socket.store(socket, std::memory_order_release);
    s_deadline.fired.store(false, std::memory_order_release);
    s_deadline.shutdown_failed.store(false, std::memory_order_release);

    const uint64_t remaining_us = http_deadline_ticks_to_us(
        static_cast<uint64_t>(remaining), static_cast<uint64_t>(portTICK_PERIOD_MS));
    const esp_err_t start_err = esp_timer_start_once(s_deadline.timer, remaining_us);
    if (start_err != ESP_OK) {
        s_deadline.socket.store(-1, std::memory_order_release);
        diag_printf("http deadline: arm failed (%s)\n", esp_err_to_name(start_err));
        return start_err;
    }

    started_         = started;
    duration_        = duration;
    expired_latched_ = false;
    active_          = true;
    s_deadline.owner = this;
    return ESP_OK;
}

bool HttpSocketDeadline::expired() const noexcept {
    if (expired_latched_) return true;
    if (!active_) return false;
    return s_deadline.fired.load(std::memory_order_acquire) ||
           http_deadline_reached_at(started_, xTaskGetTickCount(), duration_);
}

bool HttpSocketDeadline::disarm() noexcept {
    if (!active_) return expired_latched_;

    SemGuard owner_lock(s_deadline.owner_mutex);
    if (!owner_lock || s_deadline.owner != this) {
        // The invariant is fail-closed: an owner mismatch must never permit client cleanup while a
        // callback might still target its descriptor. Returning would let the caller recycle the
        // fd.
        diag_printf("http deadline: owner invariant failed before client cleanup\n");
        std::abort();
    }

    const esp_err_t stop_err = esp_timer_stop(s_deadline.timer);
    if (stop_err == ESP_ERR_INVALID_STATE) {
        // timer_process_alarm() removes a one-shot before invoking its callback. INVALID_STATE can
        // therefore mean "callback is queued/running", not merely "already finished". Join its
        // explicit acknowledgement before clearing the descriptor or letting cleanup continue.
        (void)xSemaphoreTake(s_deadline.completion, portMAX_DELAY);
    } else if (stop_err != ESP_OK) {
        // With the boot-owned valid handle, IDF documents no recoverable third state. Never let the
        // caller continue into close/reuse when callback exclusion could not be proven.
        diag_printf("http deadline: stop failed (%s)\n", esp_err_to_name(stop_err));
        std::abort();
    }

    expired_latched_ = expired_latched_ || s_deadline.fired.load(std::memory_order_acquire) ||
                       s_deadline.shutdown_failed.load(std::memory_order_acquire) ||
                       http_deadline_reached_at(started_, xTaskGetTickCount(), duration_);
    s_deadline.socket.store(-1, std::memory_order_release);
    s_deadline.owner = nullptr;
    active_          = false;
    return expired_latched_;
}

} // namespace daik
