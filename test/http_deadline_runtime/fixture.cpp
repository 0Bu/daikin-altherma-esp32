// Include the complete production TU. Host threads model the watchdog/owner separation;
// SDK adapters choose timer dispatch and hold shutdown until the acknowledgement oracle checks it.
#include "sdk.hpp"
#include <atomic>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <thread>
#include <unistd.h>
#ifndef HTTP_DEADLINE_PRODUCTION_SOURCE
#error "Bind the complete current main/http_deadline.cpp"
#endif
#include HTTP_DEADLINE_PRODUCTION_SOURCE

namespace sdk {
enum class Prime { Stable, Null, Unregistered, Lost };
const char* scenario       = nullptr;
Prime       prime          = Prime::Stable;
unsigned    fail_semaphore = 0;
bool        fail_task = false, timeout_init = false;
esp_err_t   timer_create_result = ESP_OK, timer_start_result = ESP_OK, timer_stop_result = ESP_OK;
std::atomic<TickType_t> ticks{10};
std::atomic<unsigned>   creates{0}, timer_creates{0}, timer_starts{0}, timer_stops{0};
std::atomic<unsigned>   prime_gets{0}, notifications{0}, callbacks{0}, callback_allocations{0};
std::atomic<unsigned>   shutdown_calls{0}, ack_gives{0}, ack_waits{0}, stale_drained{0};
std::atomic<bool>       parked{false}, shutdown_entered{false}, shutdown_finished{false};
std::atomic<bool>       hold_shutdown{false}, release_shutdown{false}, timer_armed{false};
std::atomic<bool>       pending_callback{false}, disarm_returned{false}, client_closed{false};
std::atomic<bool>       fail_ack{false};
std::atomic<int>        shutdown_result{0}, shutdown_errno{0}, shutdown_socket{-1};
uint64_t                timer_us   = 0;
unsigned                task_stack = 0, task_priority = 0;
SemaphoreHandle_t       init_sem = nullptr, completion_sem = nullptr, owner_sem = nullptr;
StaticSemaphore_t       lwip_storage;
sys_sem_t               thread_sem1 = &lwip_storage, thread_sem2 = &lwip_storage;
StaticTask_t*           watchdog = nullptr;
Timer                   timer;
esp_timer_create_args_t timer_args;
std::mutex              notify_mutex;
std::condition_variable notified;
unsigned                notify_count = 0;
thread_local bool       in_callback = false, in_watchdog = false;
std::atomic<unsigned>   expected_abort{0};
} // namespace sdk

static void require(bool pass, const char* oracle) {
    if (!pass) {
        std::fprintf(stderr, "ASSERT %s: %s\n", sdk::scenario, oracle);
        std::fflush(stderr);
        std::_Exit(1);
    }
}
template <typename Predicate> static void await(Predicate ready, const char* oracle) {
    const auto limit = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (!ready()) {
        require(std::chrono::steady_clock::now() < limit, oracle);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
}

void* operator new(size_t size) {
    if (sdk::in_callback) ++sdk::callback_allocations;
    if (void* memory = std::malloc(size ? size : 1)) return memory;
    throw std::bad_alloc();
}
void* operator new[](size_t size) { return ::operator new(size); }
void  operator delete(void* memory) noexcept { std::free(memory); }
void  operator delete[](void* memory) noexcept { std::free(memory); }
void  operator delete(void* memory, size_t) noexcept { std::free(memory); }
void  operator delete[](void* memory, size_t) noexcept { std::free(memory); }

namespace daik {
void diag_printf(const char*, ...) {}
void stack_watch_sample(StackWatch slot) noexcept {
    require(sdk::in_watchdog && slot == StackWatch::HttpDeadline,
            "stack sample belongs to watchdog");
}
} // namespace daik

const char* esp_err_to_name(esp_err_t error) {
    return error == ESP_OK ? "ESP_OK" : "fixture error";
}
int        esp_http_client_get_socket(esp_http_client_handle_t client) { return client->socket; }
TickType_t xTaskGetTickCount() { return sdk::ticks.load(); }
SemaphoreHandle_t xSemaphoreCreateBinaryStatic(StaticSemaphore_t* storage) {
    const unsigned role = ++sdk::creates;
    if (role == sdk::fail_semaphore) return nullptr;
    storage->count = 0;
    storage->role  = role;
    if (role == 1)
        sdk::init_sem = storage;
    else
        sdk::completion_sem = storage;
    return storage;
}
SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* storage) {
    const unsigned role = ++sdk::creates;
    if (role == sdk::fail_semaphore) return nullptr;
    storage->count = 1;
    storage->role  = role;
    sdk::owner_sem = storage;
    return storage;
}
BaseType_t xSemaphoreGive(SemaphoreHandle_t semaphore) {
    require(semaphore != nullptr, "no null semaphore give");
    if (semaphore == sdk::completion_sem) {
        require(sdk::in_watchdog && sdk::shutdown_finished.load(),
                "ack follows completed shutdown");
        if (sdk::fail_ack.load()) return pdFALSE;
        ++sdk::ack_gives;
    }
    std::lock_guard<std::mutex> lock(semaphore->mutex);
    if (semaphore->count) return pdFALSE;
    semaphore->count = 1;
    semaphore->changed.notify_all();
    return pdTRUE;
}
static void dispatch_callback() {
    sdk::timer_armed      = false;
    sdk::pending_callback = false;
    sdk::in_callback      = true;
    sdk::timer_args.callback(sdk::timer_args.arg);
    sdk::in_callback = false;
    ++sdk::callbacks;
    require(sdk::callback_allocations.load() == 0, "timer callback performs no allocation");
}
BaseType_t xSemaphoreTake(SemaphoreHandle_t semaphore, TickType_t wait) {
    require(semaphore != nullptr, "no null semaphore take");
    if (semaphore == sdk::init_sem && sdk::timeout_init) {
        require(wait == pdMS_TO_TICKS(1000), "boot prime has bounded wait");
        return pdFALSE;
    }
    if (semaphore == sdk::completion_sem && wait == portMAX_DELAY) {
        ++sdk::ack_waits;
        if (sdk::pending_callback.load()) dispatch_callback();
    }
    std::unique_lock<std::mutex> lock(semaphore->mutex);
    if (!semaphore->count) {
        if (wait == 0) return pdFALSE;
        if (wait == portMAX_DELAY)
            semaphore->changed.wait(lock, [&] { return semaphore->count != 0; });
        else if (!semaphore->changed.wait_for(lock,
                                              std::chrono::milliseconds(wait * portTICK_PERIOD_MS),
                                              [&] { return semaphore->count != 0; }))
            return pdFALSE;
    }
    --semaphore->count;
    if (semaphore == sdk::completion_sem && wait == 0) ++sdk::stale_drained;
    return pdTRUE;
}
TaskHandle_t xTaskCreateStatic(void (*entry)(void*), const char*, uint32_t stack_bytes, void* arg,
                               UBaseType_t priority, StackType_t* stack, StaticTask_t* storage) {
    require(stack && storage, "watchdog uses caller-owned static storage");
    sdk::task_stack    = stack_bytes;
    sdk::task_priority = priority;
    if (sdk::fail_task) return nullptr;
    sdk::watchdog = storage;
    std::thread([entry, arg] {
        sdk::in_watchdog = true;
        entry(arg);
        require(false, "watchdog must park or continue servicing notifications");
    }).detach();
    return storage;
}
void vTaskSuspend(TaskHandle_t handle) {
    require(handle == nullptr && sdk::in_watchdog, "failed prime parks its own task");
    sdk::parked = true;
    std::unique_lock<std::mutex> lock(sdk::notify_mutex);
    sdk::notified.wait(lock, [] { return false; });
}
void xTaskNotifyGive(TaskHandle_t handle) {
    require(sdk::in_callback && handle == sdk::watchdog, "timer only wakes its static watchdog");
    std::lock_guard<std::mutex> lock(sdk::notify_mutex);
    ++sdk::notify_count;
    ++sdk::notifications;
    sdk::notified.notify_one();
}
uint32_t ulTaskNotifyTake(BaseType_t clear, TickType_t wait) {
    require(sdk::in_watchdog && clear == pdTRUE && wait == portMAX_DELAY,
            "watchdog blocks normally");
    std::unique_lock<std::mutex> lock(sdk::notify_mutex);
    sdk::notified.wait(lock, [] { return sdk::notify_count != 0; });
    const unsigned count = sdk::notify_count;
    sdk::notify_count    = 0;
    return count;
}
sys_sem_t* sys_thread_sem_get() {
    require(sdk::in_watchdog, "lwIP prime belongs to watchdog task");
    const unsigned call = ++sdk::prime_gets;
    if (sdk::prime == sdk::Prime::Null) return nullptr;
    if (sdk::prime == sdk::Prime::Lost && call > 1) return nullptr;
    // Model sys_thread_sem_init ignoring pthread_setspecific(ENOMEM): first allocation is
    // nonnull but never retained, so the next get attempts another semaphore allocation.
    if (sdk::prime == sdk::Prime::Unregistered && call > 1) return &sdk::thread_sem2;
    return &sdk::thread_sem1;
}
esp_err_t esp_timer_create(const esp_timer_create_args_t* args, esp_timer_handle_t* handle) {
    ++sdk::timer_creates;
    require(args->dispatch_method == ESP_TIMER_TASK, "timer dispatch stays in SDK timer task");
    if (sdk::timer_create_result != ESP_OK) return sdk::timer_create_result;
    sdk::timer_args = *args;
    *handle         = &sdk::timer;
    return ESP_OK;
}
esp_err_t esp_timer_start_once(esp_timer_handle_t handle, uint64_t microseconds) {
    require(handle == &sdk::timer && !sdk::timer_armed.load(), "one valid one-shot timer");
    ++sdk::timer_starts;
    sdk::timer_us = microseconds;
    if (sdk::timer_start_result != ESP_OK) return sdk::timer_start_result;
    require(daik::s_deadline.socket.load() >= 0 && !daik::s_deadline.fired.load(),
            "descriptor and fresh verdict published before timer starts");
    sdk::timer_armed = true;
    return ESP_OK;
}
esp_err_t esp_timer_stop(esp_timer_handle_t handle) {
    require(handle == &sdk::timer, "stop uses boot timer");
    ++sdk::timer_stops;
    if (sdk::timer_stop_result != ESP_OK) return sdk::timer_stop_result;
    return sdk::timer_armed.exchange(false) ? ESP_OK : ESP_ERR_INVALID_STATE;
}
int shutdown(int socket, int how) {
    require(sdk::in_watchdog && !sdk::in_callback && how == SHUT_RDWR,
            "socket shutdown executes on watchdog rather than timer callback");
    ++sdk::shutdown_calls;
    sdk::shutdown_socket  = socket;
    sdk::shutdown_entered = true;
    await([] { return !sdk::hold_shutdown.load() || sdk::release_shutdown.load(); },
          "fixture releases controlled shutdown");
    require(!sdk::client_closed.load(),
            "descriptor still belongs to HTTP client until shutdown ends");
    sdk::shutdown_finished = true;
    errno                  = sdk::shutdown_errno.load();
    return sdk::shutdown_result.load();
}

// Positive fail-closed tests observe the real std::abort through SIGABRT. Only its exact
// invariant and retained descriptor count as success; unknown crashes exit 2, never a test kill.
static void on_abort(int) {
    const unsigned expected = sdk::expected_abort.load();
    const bool retained = daik::s_deadline.socket.load() == 41 && !sdk::disarm_returned.load() &&
                          !sdk::client_closed.load();
    const bool pass =
        retained &&
        ((expected == 1 && daik::s_deadline.shutdown_failed.load() && sdk::ack_gives.load() == 0) ||
         (expected == 2 && sdk::timer_stops.load() == 1 && sdk::shutdown_calls.load() == 0) ||
         (expected == 3 && sdk::timer_stops.load() == 0) ||
         (expected == 4 && sdk::notifications.load() == 0));
    const char* message = pass ? "PASS fail_closed\n" : "UNEXPECTED abort\n";
    (void)::write(pass ? STDOUT_FILENO : STDERR_FILENO, message, std::strlen(message));
    std::_Exit(pass ? 0 : 2);
}
static void boot() {
    require(daik::http_deadline_init() && daik::http_deadline_ready(), "boot publishes readiness");
#ifdef HTTP_DEADLINE_LEGACY_PRIME
    require(sdk::prime_gets.load() == 1,
            "original-source positive control performs its original prime");
#else
    require(sdk::prime_gets.load() == 2, "boot proves retained per-thread semaphore by identity");
#endif
    require(sdk::task_stack == 3072 && sdk::task_priority == daik::TASK_PRIO_HTTP_DEADLINE,
            "static watchdog stack and priority preserved");
    require(daik::http_deadline_init() && sdk::timer_creates.load() == 1 &&
                sdk::creates.load() == 3,
            "successful boot initialization does not allocate again");
}
static void arm(daik::HttpSocketDeadline& deadline, Client& client) {
    require(deadline.arm(&client, 10, 20) == ESP_OK && deadline.active(),
            "owner arms its valid socket");
}
static void close_client(Client& client) {
    require(!daik::s_deadline.owner && daik::s_deadline.socket.load() == -1 &&
                !sdk::timer_armed.load() && !sdk::pending_callback.load(),
            "client close/reuse follows callback exclusion and descriptor withdrawal");
    require(sdk::shutdown_calls.load() == 0 || sdk::shutdown_finished.load(),
            "client close/reuse cannot overtake socket shutdown");
    sdk::client_closed = true;
    client.socket      = -1;
}
static void expiry(bool queued, bool destructor) {
    boot();
    sdk::hold_shutdown = true;
    Client client{41};
    auto*  deadline = new daik::HttpSocketDeadline;
    arm(*deadline, client);
    sdk::timer_armed = false;
    if (queued)
        sdk::pending_callback = true;
    else
        dispatch_callback();
    std::thread owner([&] {
        if (destructor)
            delete deadline;
        else
            require(deadline->disarm(), "expiry remains latched after acknowledged shutdown");
        sdk::disarm_returned = true;
        close_client(client);
    });
    await([] { return sdk::shutdown_entered.load() && sdk::ack_waits.load() == 1; },
          "owner joins queued or running watchdog shutdown");
    require(!sdk::disarm_returned.load() && !sdk::client_closed.load() &&
                daik::s_deadline.socket.load() == 41 && sdk::ack_gives.load() == 0,
            "no return or close/reuse while shutdown is paused before acknowledgement");
    daik::HttpSocketDeadline competing;
    Client                   reused{41};
    require(competing.arm(&reused, 10, 20) == ESP_ERR_INVALID_STATE,
            "another owner cannot recycle socket while acknowledgement is pending");
    sdk::release_shutdown = true;
    owner.join();
    require(sdk::shutdown_socket.load() == 41 && sdk::shutdown_calls.load() == 1 &&
                sdk::ack_gives.load() == 1 && sdk::callbacks.load() == 1 &&
                sdk::notifications.load() == 1 && sdk::callback_allocations.load() == 0,
            "one allocation-free callback produces one shutdown and acknowledgement");
    if (!destructor) {
        require(!deadline->active() && deadline->expired() && deadline->disarm(),
                "disarm is idempotent and expiry remains visible");
        delete deadline;
    }
    sdk::client_closed = false;
    arm(competing, reused);
    require(!competing.expired() && !competing.disarm(),
            "same fd may start a new generation after ack");
    close_client(reused);
}

static void run(const char* scenario) {
    using daik::HttpSocketDeadline;
    sdk::scenario = scenario;
    Client             client{41};
    HttpSocketDeadline deadline;
    if (std::strcmp(scenario, "prime_null") == 0 ||
        std::strcmp(scenario, "prime_unregistered") == 0 ||
        std::strcmp(scenario, "prime_lost") == 0) {
        sdk::prime = std::strcmp(scenario, "prime_null") == 0   ? sdk::Prime::Null
                     : std::strcmp(scenario, "prime_lost") == 0 ? sdk::Prime::Lost
                                                                : sdk::Prime::Unregistered;
        require(!daik::http_deadline_init() && !daik::http_deadline_ready(),
                "null or unretained lwIP semaphore cannot publish readiness");
        await([] { return sdk::parked.load(); }, "failed prime parks before transfer");
        require(!daik::http_deadline_init() && sdk::timer_creates.load() == 0 &&
                    sdk::prime_gets.load() == (sdk::prime == sdk::Prime::Null ? 1U : 2U),
                "failed prime is latched without runtime retry or timer allocation");
        require(deadline.arm(&client, 10, 20) == ESP_ERR_INVALID_STATE &&
                    sdk::timer_starts.load() == 0,
                "failed prime rejects a transfer before timer start");
    } else if (std::strncmp(scenario, "init_sem_", 9) == 0 ||
               std::strcmp(scenario, "init_task") == 0 ||
               std::strcmp(scenario, "init_timeout") == 0 ||
               std::strcmp(scenario, "init_timer") == 0) {
        if (std::strncmp(scenario, "init_sem_", 9) == 0) sdk::fail_semaphore = scenario[9] - '0';
        sdk::fail_task    = std::strcmp(scenario, "init_task") == 0;
        sdk::timeout_init = std::strcmp(scenario, "init_timeout") == 0;
        if (std::strcmp(scenario, "init_timer") == 0) sdk::timer_create_result = ESP_FAIL;
        require(!daik::http_deadline_init() && !daik::http_deadline_ready(),
                "boot resource failure rejects readiness");
        const auto calls = sdk::timer_creates.load();
        require(!daik::http_deadline_init() && sdk::timer_creates.load() == calls &&
                    sdk::creates.load() == 3,
                "boot failure is latched without retry");
        require(deadline.arm(&client, 10, 20) == ESP_ERR_INVALID_STATE,
                "boot failure rejects later owner");
    } else if (std::strcmp(scenario, "queued_expiry") == 0 ||
               std::strcmp(scenario, "running_expiry") == 0 ||
               std::strcmp(scenario, "destructor_expiry") == 0 ||
               std::strcmp(scenario, "shutdown_enotconn") == 0) {
        if (std::strcmp(scenario, "shutdown_enotconn") == 0) {
            sdk::shutdown_result = -1;
            sdk::shutdown_errno  = ENOTCONN;
        }
        expiry(std::strcmp(scenario, "running_expiry") != 0,
               std::strcmp(scenario, "destructor_expiry") == 0);
    } else {
        boot();
        if (std::strcmp(scenario, "init_success") == 0) return;
        if (std::strcmp(scenario, "arm_validation") == 0) {
            require(deadline.arm(nullptr, 10, 20) == ESP_ERR_INVALID_STATE &&
                        deadline.arm(&client, 10, 0) == ESP_ERR_INVALID_STATE,
                    "null client and zero duration are rejected");
            client.socket = -1;
            require(deadline.arm(&client, 10, 20) == ESP_ERR_INVALID_STATE &&
                        sdk::timer_starts.load() == 0 && !daik::s_deadline.owner,
                    "invalid socket never starts timer or retains ownership");
            return;
        }
        if (std::strcmp(scenario, "arm_budget") == 0) {
            sdk::ticks = 17;
            require(deadline.arm(&client, 10, 20) == ESP_OK && sdk::timer_us == 130000,
                    "timer receives remainder of original operation budget in microseconds");
        } else if (std::strcmp(scenario, "arm_elapsed") == 0) {
            sdk::ticks = 30;
            require(deadline.arm(&client, 10, 20) == ESP_ERR_TIMEOUT && deadline.expired() &&
                        !deadline.active() && sdk::timer_starts.load() == 0,
                    "elapsed caller deadline is latched before timer/socket work");
            return;
        } else if (std::strcmp(scenario, "arm_wrap") == 0) {
            sdk::ticks = 3;
            require(deadline.arm(&client, UINT32_MAX - 6, 20) == ESP_OK && sdk::timer_us == 100000,
                    "original remaining budget survives tick wrap");
        } else if (std::strcmp(scenario, "arm_start_error") == 0) {
            sdk::timer_start_result = ESP_FAIL;
            require(deadline.arm(&client, 10, 20) == ESP_FAIL && !deadline.active() &&
                        daik::s_deadline.socket.load() == -1 && !daik::s_deadline.owner,
                    "timer-start error withdraws descriptor without taking ownership");
            sdk::timer_start_result = ESP_OK;
            arm(deadline, client);
        } else {
            if (std::strcmp(scenario, "stale_ack") == 0) sdk::completion_sem->count = 1;
            arm(deadline, client);
        }
        if (std::strcmp(scenario, "arm_owner_busy") == 0) {
            HttpSocketDeadline other;
            Client             other_client{99};
            require(deadline.arm(&client, 10, 20) == ESP_ERR_INVALID_STATE &&
                        other.arm(&other_client, 10, 20) == ESP_ERR_INVALID_STATE &&
                        sdk::timer_starts.load() == 1 && daik::s_deadline.socket.load() == 41,
                    "active owner excludes same-object and competing-object arm");
        } else if (std::strcmp(scenario, "stale_ack") == 0) {
            require(sdk::stale_drained.load() == 1 && sdk::completion_sem->count == 0,
                    "arm drains previous acknowledgement before publishing new descriptor");
            sdk::hold_shutdown    = true;
            sdk::timer_armed      = false;
            sdk::pending_callback = true;
            std::thread owner([&] {
                require(deadline.disarm(), "fresh callback expiry is latched");
                sdk::disarm_returned = true;
            });
            await([] { return sdk::shutdown_entered.load() && sdk::ack_waits.load() == 1; },
                  "fresh shutdown begins after stale acknowledgement drain");
            require(!sdk::disarm_returned.load() && daik::s_deadline.socket.load() == 41,
                    "old acknowledgement cannot let disarm return before fresh shutdown");
            sdk::release_shutdown = true;
            owner.join();
            close_client(client);
            return;
        } else if (std::strcmp(scenario, "destructor_stop") == 0) {
            require(!deadline.disarm(), "initial transfer stops without expiry");
            {
                HttpSocketDeadline scoped;
                arm(scoped, client);
            }
            require(sdk::timer_stops.load() == 2 && !sdk::timer_armed.load() &&
                        daik::s_deadline.socket.load() == -1 && !daik::s_deadline.owner,
                    "destructor stops pending timer and releases owner before close");
            close_client(client);
            return;
        } else if (std::strcmp(scenario, "stop_error") == 0 ||
                   std::strcmp(scenario, "owner_mismatch") == 0 ||
                   std::strcmp(scenario, "missing_watchdog") == 0 ||
                   std::strncmp(scenario, "shutdown_error_", 15) == 0 ||
                   std::strcmp(scenario, "ack_error") == 0) {
            std::signal(SIGABRT, on_abort);
            if (std::strcmp(scenario, "stop_error") == 0) {
                sdk::expected_abort    = 2;
                sdk::timer_stop_result = ESP_FAIL;
                (void)deadline.disarm();
            } else if (std::strcmp(scenario, "owner_mismatch") == 0) {
                sdk::expected_abort    = 3;
                daik::s_deadline.owner = nullptr;
                (void)deadline.disarm();
            } else if (std::strcmp(scenario, "missing_watchdog") == 0) {
                sdk::expected_abort            = 4;
                daik::s_deadline.watchdog_task = nullptr;
                dispatch_callback();
            } else {
                sdk::expected_abort = 1;
                if (std::strcmp(scenario, "ack_error") == 0)
                    sdk::fail_ack = true;
                else {
                    sdk::shutdown_result = -1;
                    sdk::shutdown_errno =
                        std::strcmp(scenario, "shutdown_error_enomem") == 0  ? ENOMEM
                        : std::strcmp(scenario, "shutdown_error_ebadf") == 0 ? EBADF
                                                                             : ECONNRESET;
                }
                dispatch_callback();
                (void)deadline.disarm();
            }
            sdk::disarm_returned = true;
            require(false, "unsafe timer/shutdown state must abort before client close/reuse");
        } else if (std::strcmp(scenario, "elapsed_disarm") == 0) {
            sdk::ticks = 30;
            require(deadline.expired() && deadline.disarm() && deadline.expired(),
                    "caller-clock expiry remains latched even if timer dispatch has not begun");
            close_client(client);
            return;
        }
        require(!deadline.expired() && !deadline.disarm() && !deadline.active() &&
                    !deadline.disarm(),
                "successful stop is unexpired and idempotent");
        require(sdk::callbacks.load() == 0 && sdk::shutdown_calls.load() == 0 &&
                    sdk::ack_waits.load() == 0,
                "successful stop excludes callback without waiting for nonexistent ack");
        close_client(client);
    }
}

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    run(argv[1]);
    std::printf("PASS %s\n", argv[1]);
    std::fflush(stdout);
    // The production task deliberately survives until reboot. A process per case avoids
    // introducing a test-only stop flag or changing its noexcept infinite-loop behavior.
    std::_Exit(0);
}
