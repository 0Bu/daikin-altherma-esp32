#pragma once
// SDK-shaped boundaries only; the complete production deadline unit owns every decision.
#include <condition_variable>
#include <cstdint>
#include <mutex>

using TickType_t            = uint32_t;
using BaseType_t            = int;
using UBaseType_t           = unsigned;
using StackType_t           = uint8_t;
constexpr BaseType_t pdTRUE = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = UINT32_MAX, portTICK_PERIOD_MS = 10;
#define pdMS_TO_TICKS(ms) (static_cast<TickType_t>((ms) / portTICK_PERIOD_MS))

struct StaticSemaphore_t {
    std::mutex              mutex;
    std::condition_variable changed;
    unsigned                count = 0;
    unsigned                role  = 0;
};
using SemaphoreHandle_t = StaticSemaphore_t*;
struct StaticTask_t {};
using TaskHandle_t = StaticTask_t*;

using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_INVALID_STATE = 0x103,
                    ESP_ERR_TIMEOUT = 0x107;
const char* esp_err_to_name(esp_err_t);
struct Client {
    int socket;
};
using esp_http_client_handle_t = Client*;
int esp_http_client_get_socket(esp_http_client_handle_t);

struct Timer {};
using esp_timer_handle_t     = Timer*;
constexpr int ESP_TIMER_TASK = 0;
struct esp_timer_create_args_t {
    void (*callback)(void*)     = nullptr;
    void*       arg             = nullptr;
    int         dispatch_method = ESP_TIMER_TASK;
    const char* name            = nullptr;
};
esp_err_t esp_timer_create(const esp_timer_create_args_t*, esp_timer_handle_t*);
esp_err_t esp_timer_start_once(esp_timer_handle_t, uint64_t);
esp_err_t esp_timer_stop(esp_timer_handle_t);

using sys_sem_t = SemaphoreHandle_t;
sys_sem_t*    sys_thread_sem_get();
constexpr int SHUT_RDWR = 2;
int           shutdown(int, int);

SemaphoreHandle_t xSemaphoreCreateBinaryStatic(StaticSemaphore_t*);
SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t*);
BaseType_t        xSemaphoreGive(SemaphoreHandle_t);
BaseType_t        xSemaphoreTake(SemaphoreHandle_t, TickType_t);
TaskHandle_t      xTaskCreateStatic(void (*)(void*), const char*, uint32_t, void*, UBaseType_t,
                                    StackType_t*, StaticTask_t*);
TickType_t        xTaskGetTickCount();
void              vTaskSuspend(TaskHandle_t);
void              xTaskNotifyGive(TaskHandle_t);
uint32_t          ulTaskNotifyTake(BaseType_t, TickType_t);
