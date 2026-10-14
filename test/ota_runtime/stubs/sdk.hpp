#pragma once
// Deterministic SDK boundaries for the complete production OTA translation unit.
#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <new>
using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_NO_MEM = 0x101, ESP_ERR_INVALID_ARG = 0x102,
                    ESP_ERR_INVALID_STATE = 0x103, ESP_ERR_INVALID_SIZE = 0x104,
                    ESP_ERR_TIMEOUT = 0x107, ESP_ERR_INVALID_RESPONSE = 0x108,
                    ESP_ERR_HTTP_EAGAIN = 0x7007, ESP_ERR_MBEDTLS_SSL_SETUP_FAILED = 0x8017,
                    ESP_ERR_OTA_ROLLBACK_INVALID_STATE = 0x1501,
                    ESP_ERR_OTA_VALIDATE_FAILED        = 0x1503;
inline const char* esp_err_to_name(esp_err_t e) { return e == ESP_OK ? "ESP_OK" : "fixture_error"; }
using TickType_t            = uint32_t;
using UBaseType_t           = unsigned;
using BaseType_t            = int;
using StackType_t           = uint8_t;
constexpr BaseType_t pdTRUE = 1, pdPASS = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY      = UINT32_MAX;
constexpr unsigned   portTICK_PERIOD_MS = 1;
constexpr unsigned   portBYTE_ALIGNMENT = 16;
#define pdMS_TO_TICKS(x) static_cast<TickType_t>(x)
#define CONFIG_IDF_FIRMWARE_CHIP_ID 9
#define CONFIG_DAIKIN_OTA_MANIFEST_URL "https://fixture.invalid/manifest.json"
#define CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL "https://fixture.invalid/"
struct StaticTask_t {};
struct StaticTimer_t {};
struct FakeTask {
    void (*fn)(void*) = nullptr;
    void* arg         = nullptr;
};
using TaskHandle_t  = FakeTask*;
using TimerHandle_t = StaticTimer_t*;
struct FakeMutex {
    std::mutex mutex;
};
using SemaphoreHandle_t = FakeMutex*;
using StaticSemaphore_t = FakeMutex;
struct esp_app_desc_t {
    uint32_t magic_word = 0, secure_version = 0, reserv1[2]{};
    char     version[32]{}, project_name[32]{}, time[16]{}, date[16]{}, idf_ver[32]{};
    uint8_t  app_elf_sha256[32]{};
    uint32_t reserv2[20]{};
};
static_assert(sizeof(esp_app_desc_t) == 256);
struct esp_image_header_t {
    uint8_t  magic = 0, segment_count = 0, spi_mode = 0, spi_speed_size = 0;
    uint32_t entry_addr        = 0;
    uint8_t  wp_pin            = 0, spi_pin_drv[3]{};
    uint16_t chip_id           = 0;
    uint8_t  min_chip_rev      = 0;
    uint16_t min_chip_rev_full = 0, max_chip_rev_full = 0;
    uint8_t  reserved[4]{}, hash_appended             = 0;
} __attribute__((packed));
static_assert(sizeof(esp_image_header_t) == 24);
struct esp_image_segment_header_t {
    uint32_t load_addr = 0, data_len = 0;
};
constexpr uint8_t  ESP_IMAGE_HEADER_MAGIC  = 0xe9;
constexpr uint32_t ESP_APP_DESC_MAGIC_WORD = 0xabcd5432;
struct esp_partition_t {
    size_t size = 8192;
};
using esp_ota_handle_t                      = uint32_t;
constexpr size_t OTA_WITH_SEQUENTIAL_WRITES = static_cast<size_t>(-2);
enum esp_ota_img_states_t {
    ESP_OTA_IMG_NEW,
    ESP_OTA_IMG_PENDING_VERIFY,
    ESP_OTA_IMG_VALID,
    ESP_OTA_IMG_INVALID,
    ESP_OTA_IMG_ABORTED,
    ESP_OTA_IMG_UNDEFINED
};
struct FakeHttpClient;
using esp_http_client_handle_t = FakeHttpClient*;
struct esp_http_client_event_t {
    int   event_id     = 0;
    void* user_data    = nullptr;
    char* header_key   = nullptr;
    char* header_value = nullptr;
};
constexpr int HTTP_EVENT_ON_HEADER = 1, HTTP_TRANSPORT_OVER_SSL = 2;
struct esp_http_client_config_t {
    const char* url                       = nullptr;
    int         timeout_ms                = 0;
    esp_err_t (*crt_bundle_attach)(void*) = nullptr;
    bool keep_alive_enable                = false;
    int  transport_type                   = 0;
    bool disable_auto_redirect            = false;
    int  buffer_size = 0, buffer_size_tx = 0;
    esp_err_t (*event_handler)(esp_http_client_event_t*) = nullptr;
    void* user_data                                      = nullptr;
};
struct FakeHttpClient {
    bool                     used = false, manifest = false, resumed = false, closed = false;
    size_t                   offset = 0;
    esp_http_client_config_t cfg{};
    int                      sequence = 0;
};
using psa_status_t                     = int;
constexpr psa_status_t PSA_SUCCESS     = 0;
constexpr int          PSA_ALG_SHA_256 = 0x02000009;
struct psa_hash_operation_t {
    bool   active = false;
    size_t bytes  = 0;
};
#define PSA_HASH_OPERATION_INIT                                                                    \
    {}
constexpr unsigned MALLOC_CAP_8BIT = 1, MALLOC_CAP_INTERNAL = 2;
namespace sdk {
struct Stop {};
enum class Fault {
    None,
    HeaderException,
    HashException,
    ResumeException,
    AfterTlsException,
    BufferNull,
    ResumeBufferNull,
    ReadError,
    WriteError,
    HashError,
    HashMismatch,
    ValidationError,
    SelectionError,
    ResumeSuccess,
    WrongRange,
    ChunkedSuccess,
    ShortChunked,
    BodyTimeout,
    BeginProbation
};
struct State {
    Fault     fault    = Fault::None;
    bool      injected = false, invalid_release = false, deadline_armed = false;
    bool      reject_new = false, interrupt = false;
    bool      fail_task_create = false, health_offline = false;
    bool      recovery_ap = false, hp_live = false, x10a_required = false, x10a_proven = false;
    // Factory-reset latch adapter: `reset_latched` is what nvs_factory_reset_latched() reads
    // (operation start); `reset_hold` is what the last-moment restart refusal answers.
    bool                 reset_latched = false, reset_hold = false;
    size_t    free_bytes = 128 * 1024, largest_block = 64 * 1024;
    uint8_t   heap_restarts = 0;
    uint32_t  mqtt_skips = 0, poll_skips = 0;
    esp_err_t state_result = ESP_OK, mark_result = ESP_OK;
    esp_ota_img_states_t image_state = ESP_OTA_IMG_VALID;
    int                  marked = 0, created = 0;
    int                  stalled_service = 0;
    TickType_t           marked_at = 0, restarted_at = 0;
    TickType_t           heal_at = 0, release_hold_at = 0; // 0 = never (health_timeout_held)
    TickType_t           ticks         = 1000;
    int                  notifications = 0, withdraw = 0, pause = 0, resume = 0, restart = 0;
    int client_acquired = 0, client_closed = 0, client_cleaned = 0, firmware_acquired = 0,
        firmware_cleaned = 0;
    int buffer_acquired = 0, buffer_freed = 0, ota_begun = 0, ota_aborted = 0, ota_ended = 0,
        selected   = 0;
    int hash_setup = 0, hash_aborted = 0, hash_finished = 0, active_clients = 0, active_buffers = 0;
    bool          ota_live = false, hash_live = false;
    size_t        written       = 0;
    int           deadline_arms = 0, deadline_disarms = 0;
    int           static_creations = 0, dynamic_creations = 0;
    bool          fail_dynamic_create = false;
    StackType_t*  health_stack        = nullptr;
    StaticTask_t* health_storage      = nullptr;
    unsigned      health_stack_bytes  = 0;
    unsigned      health_stack_samples = 0;
    bool          health_task_running  = false;
    void (*health_entry)(void*)       = nullptr;
    void*          buffers[8]{};
    FakeHttpClient clients[8]{};
    char           manifest[256]{};
    uint8_t        image[2048]{};
    size_t         image_size = 2048;
    esp_app_desc_t app{};
};
extern State state;
void         inject(Fault);
} // namespace sdk
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    return nullptr; // deterministic dynamic-mutex allocation failure, including static init
}
inline SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* storage) { return storage; }
inline BaseType_t        xSemaphoreTake(SemaphoreHandle_t m, TickType_t ticks) {
    if (!m) return 0;
    if (ticks == 0) return m->mutex.try_lock() ? pdTRUE : pdFALSE;
    m->mutex.lock();
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t m) {
    m->mutex.unlock();
    return pdTRUE;
}
inline TickType_t   xTaskGetTickCount() { return sdk::state.ticks; }
inline void         vTaskDelay(TickType_t n) {
    sdk::state.ticks += n;
    // Scripted health_timeout_held timeline: the service recovers, later the reset hold ends.
    if (sdk::state.heal_at && sdk::state.ticks >= sdk::state.heal_at)
        sdk::state.health_offline = false;
    if (sdk::state.release_hold_at && sdk::state.ticks >= sdk::state.release_hold_at)
        sdk::state.reset_hold = false;
}
inline void         vTaskDelete(TaskHandle_t) {}
inline TaskHandle_t xTaskCreateStatic(void (*fn)(void*), const char* name, unsigned bytes,
                                      void* arg, unsigned, StackType_t* stack,
                                      StaticTask_t* storage) {
    ++sdk::state.created;
    ++sdk::state.static_creations;
    if (sdk::state.fail_task_create) return nullptr;
    static FakeTask worker, health;
    FakeTask&       task = std::strcmp(name, "ota_health") == 0 ? health : worker;
    if (std::strcmp(name, "ota_health") == 0) {
        sdk::state.health_stack       = stack;
        sdk::state.health_storage     = storage;
        sdk::state.health_stack_bytes = bytes;
        sdk::state.health_entry       = fn;
    }
    task = {fn, arg};
    return &task;
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, unsigned, void* arg, unsigned,
                              TaskHandle_t* out) {
    ++sdk::state.created;
    ++sdk::state.dynamic_creations;
    if (sdk::state.fail_task_create || sdk::state.fail_dynamic_create) return pdFALSE;
    static FakeTask task;
    task = {fn, arg};
    if (out) *out = &task;
    return pdPASS;
}
inline uint32_t ulTaskNotifyTake(BaseType_t, TickType_t) {
    if (sdk::state.notifications++ != 0) throw sdk::Stop{};
    return 1;
}
inline void          xTaskNotifyGive(TaskHandle_t) {}
inline TimerHandle_t xTimerCreateStatic(const char*, TickType_t, BaseType_t, void*,
                                        void (*)(TimerHandle_t), StaticTimer_t* storage) {
    return storage;
}
inline BaseType_t xTimerStop(TimerHandle_t, TickType_t) { return pdPASS; }
inline BaseType_t xTimerReset(TimerHandle_t, TickType_t) { return pdPASS; }
inline int64_t    esp_timer_get_time() { return static_cast<int64_t>(sdk::state.ticks) * 1000; }
inline const esp_app_desc_t* esp_app_get_description() { return &sdk::state.app; }
inline esp_err_t             esp_crt_bundle_attach(void*) { return ESP_OK; }
void*                        heap_caps_malloc(size_t, unsigned);
inline void*                 heap_caps_calloc(size_t n, size_t size, unsigned caps) {
    void* p = heap_caps_malloc(n * size, caps);
    if (p) std::memset(p, 0, n * size);
    return p;
}
void                     heap_caps_free(void*) noexcept;
size_t                   heap_caps_get_free_size(unsigned);
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t*);
esp_err_t                esp_http_client_open(esp_http_client_handle_t, int);
int64_t                  esp_http_client_fetch_headers(esp_http_client_handle_t);
int                      esp_http_client_get_status_code(esp_http_client_handle_t);
int64_t                  esp_http_client_get_content_length(esp_http_client_handle_t);
int                      esp_http_client_read(esp_http_client_handle_t, char*, int);
bool                     esp_http_client_is_complete_data_received(esp_http_client_handle_t);
bool                     esp_http_client_is_chunked_response(esp_http_client_handle_t);
esp_err_t                esp_http_client_close(esp_http_client_handle_t) noexcept;
esp_err_t                esp_http_client_cleanup(esp_http_client_handle_t) noexcept;
inline esp_err_t esp_http_client_clear_response_buffer(esp_http_client_handle_t) { return ESP_OK; }
inline esp_err_t esp_http_client_set_redirection(esp_http_client_handle_t) { return ESP_FAIL; }
inline esp_err_t esp_http_client_set_timeout_ms(esp_http_client_handle_t, int) { return ESP_OK; }
esp_err_t        esp_http_client_set_header(esp_http_client_handle_t, const char*, const char*);
const esp_partition_t* esp_ota_get_next_update_partition(const esp_partition_t*);
const esp_partition_t* esp_ota_get_running_partition();
esp_err_t              esp_ota_get_state_partition(const esp_partition_t*, esp_ota_img_states_t*);
esp_err_t              esp_ota_begin(const esp_partition_t*, size_t, esp_ota_handle_t*);
esp_err_t              esp_ota_write(esp_ota_handle_t, const void*, size_t);
esp_err_t              esp_ota_abort(esp_ota_handle_t) noexcept;
esp_err_t              esp_ota_end(esp_ota_handle_t);
esp_err_t              esp_ota_set_boot_partition(const esp_partition_t*);
inline esp_err_t       esp_ota_mark_app_valid_cancel_rollback() {
    ++sdk::state.marked;
    sdk::state.marked_at = sdk::state.ticks;
    return sdk::state.mark_result;
}
inline void esp_restart() {
    ++sdk::state.restart;
    sdk::state.restarted_at = sdk::state.ticks;
}
psa_status_t psa_hash_setup(psa_hash_operation_t*, int);
psa_status_t psa_hash_update(psa_hash_operation_t*, const uint8_t*, size_t);
psa_status_t psa_hash_finish(psa_hash_operation_t*, uint8_t*, size_t, size_t*);
psa_status_t psa_hash_abort(psa_hash_operation_t*) noexcept;
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
