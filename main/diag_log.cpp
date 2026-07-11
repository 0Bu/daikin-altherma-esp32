// In-RAM diagnostic ring served by GET /diag. Static .bss buffer, no heap growth. See
// diag_log.hpp.
#include "diag_log.hpp"
#include "esp_log.h"
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

namespace daik {

static constexpr size_t RING = 6144;
static char             s_buf[RING];
static size_t           s_len = 0;          // bytes used (grows then wraps)
static bool             s_wrapped = false;
static bool             s_verbose = false;
static SemaphoreHandle_t s_mtx = nullptr;

void diag_log_init() { s_mtx = xSemaphoreCreateMutex(); }

static void append(const char* p, size_t n) {
    for (size_t i = 0; i < n; i++) {
        s_buf[s_len++] = p[i];
        if (s_len >= RING) { s_len = 0; s_wrapped = true; }
    }
}

void diag_printf(const char* fmt, ...) {
    char line[256];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(line, sizeof(line), fmt, ap);
    va_end(ap);
    if (n <= 0) return;
    if (n > (int)sizeof(line)) n = sizeof(line);
    if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY);
    append(line, n);
    if (s_mtx) xSemaphoreGive(s_mtx);
    ESP_LOGI("diag", "%.*s", n, line);
}

void diag_set_verbose(bool on) { s_verbose = on; }
bool diag_verbose() { return s_verbose; }

size_t diag_dump(char* out, size_t max) {
    if (!s_mtx) return 0;
    xSemaphoreTake(s_mtx, portMAX_DELAY);
    size_t n = 0;
    if (s_wrapped) { // oldest half first
        size_t tail = RING - s_len;
        size_t copy = tail < max ? tail : max;
        memcpy(out, s_buf + s_len, copy); n += copy;
    }
    size_t head = s_len < (max - n) ? s_len : (max - n);
    memcpy(out + n, s_buf, head); n += head;
    xSemaphoreGive(s_mtx);
    return n;
}

void diag_clear() {
    if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY);
    s_len = 0; s_wrapped = false;
    if (s_mtx) xSemaphoreGive(s_mtx);
}

} // namespace daik
