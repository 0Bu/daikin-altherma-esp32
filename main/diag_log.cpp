// In-RAM diagnostic ring served by GET /diag. Static .bss buffer, no heap growth. See
// diag_log.hpp.
#include "diag_log.hpp"
#include "syslog.hpp"
#include "esp_log.h"
#include "esp_timer.h"
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
    // Uptime prefix, e.g. "[   123.456] " (seconds.milliseconds since boot) — kept even now that
    // SNTP (sntp_time.cpp) gives the device a wall clock, since it is what device-triage's boot-
    // reconstruction technique keys on (an uptime that jumps backwards = a reboot) and stays
    // available before the very first sync of a boot, when a wall-clock prefix would still be blank.
    // The wall clock reaches the log stream a different way: syslog.cpp's RFC 5424 TIMESTAMP field.
    int64_t us  = esp_timer_get_time();
    int     pre = snprintf(line, sizeof(line), "[%6lld.%03lld] ",
                           (long long)(us / 1000000), (long long)((us / 1000) % 1000));
    if (pre < 0 || pre >= (int)sizeof(line)) pre = 0;
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(line + pre, sizeof(line) - pre, fmt, ap);
    va_end(ap);
    if (n <= 0) return;
    // vsnprintf returns the length it *would* have written; clamp to what actually fit.
    if (n > (int)sizeof(line) - pre - 1) n = (int)sizeof(line) - pre - 1;
    int total = pre + n;
    if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY);
    append(line, total);
    if (s_mtx) xSemaphoreGive(s_mtx);
    syslog_send(line, total);
    ESP_LOGI("diag", "%.*s", total, line);
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
