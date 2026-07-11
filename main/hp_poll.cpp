// Heat-pump poll engine. One task owns the X10A UART; each cycle it queries the active
// profile's registers, decodes the enabled values, and publishes them to a thread-safe cache.
#include "hp_poll.hpp"
#include "config.hpp"
#include "def/registry.hpp"
#include "diag_log.hpp"
#include "hp_comm.hpp"
#include "hp_convert.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <vector>

namespace daik {

static SemaphoreHandle_t      s_mtx = nullptr;
static std::vector<CachedValue> s_cache;
static HpStats               s_stats;
static int64_t               s_last_ok_us = -1;

// TODO: honour Config::val_mask (currently every value in the profile is queried).
static void poll_once() {
    const Config& c    = config();
    const auto&   prof = def::lookup(c.profile.c_str());
    hp_uart_init(c.rx_pin, c.tx_pin);

    std::vector<CachedValue> fresh;
    bool    any_ok = false;
    int     regs   = 0;
    uint8_t seen[256] = {0};

    for (size_t i = 0; i < prof.count; i++) {
        uint8_t reg = prof.values[i].reg;
        if (seen[reg]) continue;
        seen[reg] = 1;
        regs++;

        uint8_t buf[64];
        int n = hp_query(reg, c.proto, buf, sizeof(buf));
        if (n < 0) {
            if (n == -1)      s_stats.timeout_err++;
            else if (n == -3) s_stats.crc_err++;
            s_stats.last_error = "reg error 0x" ;
            continue;
        }
        any_ok = true;
        const int      poff    = payload_offset(c.proto);
        const int      paylen  = n - poff - 1;                 // minus header, minus CRC byte
        const uint8_t* payload = buf + poff;

        for (size_t k = 0; k < prof.count; k++) {
            if (prof.values[k].reg != reg) continue;
            CachedValue cv;
            cv.label = prof.values[k].label;
            cv.unit  = unit_for_datatype(prof.values[k].type);
            std::string val;
            if (hp_format(prof.values[k], payload, paylen, val)) cv.value = val;
            fresh.push_back(std::move(cv));
        }
    }

    xSemaphoreTake(s_mtx, portMAX_DELAY);
    s_cache            = std::move(fresh);
    s_stats.connected  = any_ok;
    s_stats.registers  = regs;
    s_stats.values     = static_cast<int>(s_cache.size());
    if (any_ok) s_last_ok_us = esp_timer_get_time();
    xSemaphoreGive(s_mtx);
}

static void poll_task(void*) {
    for (;;) {
        poll_once();
        vTaskDelay(pdMS_TO_TICKS(config().poll_s * 1000));     // re-reads poll_s each cycle
    }
}

void hp_poll_start() {
    s_mtx = xSemaphoreCreateMutex();
    xTaskCreate(poll_task, "hp_poll", 4096, nullptr, 5, nullptr);
}

size_t hp_values_snapshot(CachedValue* out, size_t max) {
    if (!s_mtx) return 0;
    xSemaphoreTake(s_mtx, portMAX_DELAY);
    size_t n = s_cache.size() < max ? s_cache.size() : max;
    for (size_t i = 0; i < n; i++) out[i] = s_cache[i];
    xSemaphoreGive(s_mtx);
    return n;
}

HpStats hp_stats() {
    HpStats st;
    if (!s_mtx) return st;
    xSemaphoreTake(s_mtx, portMAX_DELAY);
    st = s_stats;
    st.last_ok_s = s_last_ok_us < 0 ? -1
                 : static_cast<int32_t>((esp_timer_get_time() - s_last_ok_us) / 1000000);
    xSemaphoreGive(s_mtx);
    return st;
}

void hp_poll_reconfigure() { /* poll_task re-reads config() at the top of each cycle */ }

} // namespace daik
