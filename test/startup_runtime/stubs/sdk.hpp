#pragma once
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1;
inline const char*  esp_err_to_name(esp_err_t e) { return e == ESP_OK ? "ESP_OK" : "ESP_FAIL"; }
using TickType_t            = uint32_t;
using BaseType_t            = int;
using UBaseType_t           = unsigned;
using TaskHandle_t          = void*;
constexpr BaseType_t pdPASS = 1;
#define pdMS_TO_TICKS(n) (static_cast<TickType_t>(n))
#define ESP_LOGW(...) ((void)0)
using gpio_num_t                       = int;
constexpr gpio_num_t GPIO_NUM_NC       = -1;
constexpr int        GPIO_INTR_DISABLE = 0, GPIO_MODE_INPUT = 1, GPIO_MODE_OUTPUT = 2;
constexpr int        GPIO_PULLDOWN_DISABLE = 0, GPIO_PULLDOWN_ENABLE = 1;
constexpr int        GPIO_PULLUP_DISABLE = 0, GPIO_PULLUP_ENABLE = 1;
struct gpio_config_t {
    uint64_t pin_bit_mask = 0;
    int      mode = 0, pull_up_en = 0, pull_down_en = 0, intr_type = 0;
};
using wifi_mode_t                    = int;
constexpr wifi_mode_t WIFI_MODE_NULL = 0, WIFI_MODE_STA = 1, WIFI_MODE_AP = 2, WIFI_MODE_APSTA = 3;
constexpr int         LED_MODEL_WS2812 = 1, LED_STRIP_COLOR_COMPONENT_FMT_GRB = 1;
constexpr int         RMT_CLK_SRC_DEFAULT = 0;
struct FakeStrip {};
using led_strip_handle_t = FakeStrip*;
struct led_strip_config_t {
    int      strip_gpio_num = -1;
    unsigned max_leds       = 0;
    int      led_model = 0, color_component_format = 0;
    struct {
        bool invert_out = false;
    } flags;
};
struct led_strip_rmt_config_t {
    int      clk_src           = 0;
    uint32_t resolution_hz     = 0;
    unsigned mem_block_symbols = 0;
    struct {
        bool with_dma = false;
    } flags;
};
namespace sdk {
inline unsigned    config_copies = 0, config_refs = 0, config_locks = 0, config_unlocks = 0;
inline unsigned    lock_depth = 0, task_creates = 0, task_deletes = 0;
inline unsigned    gpio_configs = 0, gpio_reads = 0, gpio_writes = 0;
inline unsigned    strip_creates = 0, strip_clears = 0, strip_pixels = 0, strip_refreshes = 0;
inline unsigned    mqtt_reads = 0, hp_reads = 0, destructive_calls = 0, delays = 0;
inline bool        fail_mqtt_snapshot = false, fail_hp_snapshot = false;
inline wifi_mode_t wifi_mode = WIFI_MODE_NULL;
inline int      read_level = 1, read_gpio = -1, first_gpio = -1, first_level = -1, last_level = -1;
inline uint32_t strip_r = 99, strip_g = 99, strip_b = 99;
inline int64_t  now_us = 1000000;
inline gpio_config_t          gpio_configured;
inline led_strip_config_t     strip_configured;
inline led_strip_rmt_config_t rmt_configured;
inline FakeStrip              strip;
inline void (*task_fn)(void*)       = nullptr;
inline void (*on_delay)(TickType_t) = nullptr;
inline char        task_name[32]{};
inline uint32_t    task_stack    = 0;
inline UBaseType_t task_priority = 0;
} // namespace sdk
inline esp_err_t gpio_config(const gpio_config_t* c) {
    ++sdk::gpio_configs;
    sdk::gpio_configured = *c;
    return ESP_OK;
}
inline esp_err_t gpio_set_level(gpio_num_t pin, int level) {
    if (!sdk::gpio_writes) {
        sdk::first_gpio  = pin;
        sdk::first_level = level;
    }
    ++sdk::gpio_writes;
    sdk::last_level = level;
    return ESP_OK;
}
inline int gpio_get_level(gpio_num_t pin) {
    ++sdk::gpio_reads;
    sdk::read_gpio = pin;
    return sdk::read_level;
}
inline esp_err_t esp_wifi_get_mode(wifi_mode_t* mode) {
    *mode = sdk::wifi_mode;
    return ESP_OK;
}
inline esp_err_t led_strip_new_rmt_device(const led_strip_config_t*     c,
                                          const led_strip_rmt_config_t* r,
                                          led_strip_handle_t*           strip) {
    ++sdk::strip_creates;
    sdk::strip_configured = *c;
    sdk::rmt_configured   = *r;
    *strip                = &sdk::strip;
    return ESP_OK;
}
inline esp_err_t led_strip_clear(led_strip_handle_t) {
    ++sdk::strip_clears;
    return ESP_OK;
}
inline esp_err_t led_strip_set_pixel(led_strip_handle_t, uint32_t index, uint32_t r, uint32_t g,
                                     uint32_t b) {
    if (index != 0) return ESP_FAIL;
    ++sdk::strip_pixels;
    sdk::strip_r = r;
    sdk::strip_g = g;
    sdk::strip_b = b;
    return ESP_OK;
}
inline esp_err_t led_strip_refresh(led_strip_handle_t) {
    ++sdk::strip_refreshes;
    return ESP_OK;
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char* name, uint32_t stack, void*,
                              UBaseType_t priority, TaskHandle_t*) {
    ++sdk::task_creates;
    sdk::task_fn       = fn;
    sdk::task_stack    = stack;
    sdk::task_priority = priority;
    std::snprintf(sdk::task_name, sizeof(sdk::task_name), "%s", name);
    return pdPASS;
}
inline void vTaskDelete(TaskHandle_t) { ++sdk::task_deletes; }
inline void vTaskDelay(TickType_t ticks) {
    ++sdk::delays;
    sdk::now_us += static_cast<int64_t>(ticks) * 1000;
    if (sdk::on_delay) sdk::on_delay(ticks);
}
inline int64_t esp_timer_get_time() { return sdk::now_us; }
inline void    esp_restart() { ++sdk::destructive_calls; }
