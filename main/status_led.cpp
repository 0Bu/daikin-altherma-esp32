// Physical status indicator — see status_led.hpp. Two back-ends behind one pattern table
// (logic/led_pattern.hpp): a level-driven GPIO LED and an RMT-driven WS2812 pixel, selected at boot
// from the runtime config so ONE published image serves both reference boards.
#include "status_led.hpp"
#include "config.hpp"
#include "wifi.hpp"
#include "mqtt_ha.hpp"
#include "hp_poll.hpp"
#include "diag_log.hpp"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/task.h"
#include "led_strip.h"
#include <atomic>

namespace daik {

// The button's override, published across tasks. std::atomic because button.cpp's task writes it
// while the indicator task reads it every slice; a plain bool would be a data race, and a mutex
// would let a starved indicator task block the button's erase path. Lock-free on this target.
static std::atomic<LedSignal> s_signal{LedSignal::None};

void status_led_signal(LedSignal s) { s_signal.store(s, std::memory_order_relaxed); }

namespace {

// Resolved once at task start from the config snapshot, then const for the task's life: a pin or
// driver change is persisted + rebooted (POST /set_board), never hot-swapped. Re-initialising an
// RMT channel underneath a running blink is a whole class of failure this feature does not need.
gpio_num_t          s_gpio     = GPIO_NUM_NC;
LedType             s_type     = LedType::Gpio;
bool                s_inverted = false;
led_strip_handle_t  s_strip    = nullptr;

// Emit one on/off step. The GPIO back-end ignores the colour; the WS2812 one ignores `s_inverted`
// (there is no active-low for a data-encoded pixel — "off" is the all-zero colour).
void emit(bool on, const LedPattern& pat) {
    if (s_type == LedType::Ws2812) {
        if (!s_strip) return;
        // A refresh failure is not worth a diag line every 100 ms on a fast blink — the indicator is
        // cosmetic and the next slice retries anyway.
        if (on) led_strip_set_pixel(s_strip, 0, pat.r, pat.g, pat.b);
        else    led_strip_set_pixel(s_strip, 0, 0, 0, 0);
        led_strip_refresh(s_strip);
        return;
    }
    if (s_gpio == GPIO_NUM_NC) return;
    gpio_set_level(s_gpio, (on ^ s_inverted) ? 1 : 0);
}

// Sleep `ms`, but in slices, returning EARLY if the button's override changes. The override exists
// to be seen the moment it is asserted: without this, arming the wipe during the setup-portal
// pattern would take up to a full second to show, and the "erasing now" signal could be missed
// entirely on a pattern whose dark gap is longer than the erase. Also bounds how long a released
// button keeps the warning lit.
// Returns true if the signal changed (caller re-decides the phase immediately).
bool sleep_slices(int ms, LedSignal at_start) {
    const int SLICE_MS = 25;
    for (int left = ms; left > 0; left -= SLICE_MS) {
        vTaskDelay(pdMS_TO_TICKS(left < SLICE_MS ? left : SLICE_MS));
        if (s_signal.load(std::memory_order_relaxed) != at_start) return true;
    }
    return false;
}

// One repeat of the current phase's pattern. Split out of the task loop so the loop can guard it —
// see there for why.
void status_led_tick() {
    wifi_mode_t mode = WIFI_MODE_NULL;
    esp_wifi_get_mode(&mode);

    LedInputs in;
    in.ap_mode  = (mode == WIFI_MODE_AP || mode == WIFI_MODE_APSTA);
    in.sta_mode = (mode == WIFI_MODE_STA);
    // Only read the status snapshots the phase actually needs — each of these copies std::strings
    // out from under a lock, so skipping them in the AP/override cases is a real saving on a tight
    // heap (and it is exactly the case where the heap is least predictable).
    if (in.sta_mode) {
        const WifiInfo wi = wifi_info();
        in.wifi_connected = wi.connected;
        if (wi.connected) {
            const MqttStatus ms = mqtt_status();
            const HpStats    hp = hp_stats();
            in.mqtt_configured = ms.configured;
            in.mqtt_connected  = ms.connected;
            in.hp_connected    = hp.connected;
        }
    }
    const LedSignal sig = s_signal.load(std::memory_order_relaxed);
    in.signal = sig;

    const LedPattern pat = led_pattern(led_phase(in));
    for (int i = 0; i < pat.pulses; i++) {
        emit(true, pat);
        if (sleep_slices(pat.on_ms, sig)) { emit(false, pat); return; }
        if (pat.off_ms > 0) {
            emit(false, pat);
            if (sleep_slices(pat.off_ms, sig)) return;
        }
    }
    if (pat.gap_ms > 0 || pat.pulses == 0) {
        emit(false, pat);
        sleep_slices(pat.gap_ms > 0 ? pat.gap_ms : 1000, sig);
    }
}

bool indicator_init(const Config& c) {
    s_gpio     = static_cast<gpio_num_t>(c.led_gpio);
    s_type     = static_cast<LedType>(c.led_type);
    s_inverted = c.led_inverted;

    if (s_type == LedType::Ws2812) {
        led_strip_config_t sc = {};
        sc.strip_gpio_num   = c.led_gpio;
        sc.max_leds         = 1;
        sc.led_model        = LED_MODEL_WS2812;
        sc.color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB;
        sc.flags.invert_out = false;
        led_strip_rmt_config_t rc = {};
        rc.clk_src        = RMT_CLK_SRC_DEFAULT;
        rc.resolution_hz  = 10 * 1000 * 1000;   // 10 MHz — 0.1 us tick, the WS2812 timing standard
        rc.mem_block_symbols = 64;
        rc.flags.with_dma = false;              // one pixel: DMA would cost more than it saves
        const esp_err_t e = led_strip_new_rmt_device(&sc, &rc, &s_strip);
        if (e != ESP_OK) {
            // Say so rather than blink nothing and look like a dead board: an RMT channel can be
            // exhausted or the pin rejected, and the user's next move (re-pick the pin, or the
            // wrong led_type for their board) depends on knowing which.
            diag_printf("led: WS2812 init failed on GPIO%d (%s) — indicator disabled\n",
                        c.led_gpio, esp_err_to_name(e));
            s_strip = nullptr;
            return false;
        }
        led_strip_clear(s_strip);
        return true;
    }

    gpio_config_t io_conf = {};
    io_conf.intr_type    = GPIO_INTR_DISABLE;
    io_conf.mode         = GPIO_MODE_OUTPUT;
    io_conf.pin_bit_mask = (1ULL << c.led_gpio);
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en   = GPIO_PULLUP_DISABLE;
    const esp_err_t e = gpio_config(&io_conf);
    if (e != ESP_OK) {
        diag_printf("led: GPIO%d config failed (%s) — indicator disabled\n", c.led_gpio, esp_err_to_name(e));
        s_gpio = GPIO_NUM_NC;
        return false;
    }
    return true;
}

// Announce which pin and driver the indicator actually resolved to, exactly as recovery_button.cpp
// announces its pin. Until this line existed, only a FAILED init said anything — and the failure
// that actually reaches users does not fail: pointed at a valid-but-wrong pin (the shipped XIAO
// default of GPIO21 on an AtomS3 Lite, whose only light is a WS2812 on GPIO35), init succeeds and
// the firmware drives a pin with nothing on it. The board looks dead while being perfectly healthy,
// and the sole evidence on /diag was the ABSENCE of an error — which reads identically to a working
// indicator. One line turns "the LED doesn't light" into a five-second diagnosis.
void log_indicator(const Config& c) {
    if (static_cast<LedType>(c.led_type) == LedType::Ws2812)
        diag_printf("led: WS2812 indicator on GPIO%d\n", c.led_gpio);
    else
        diag_printf("led: LED indicator on GPIO%d (active %s)\n",
                    c.led_gpio, c.led_inverted ? "low" : "high");
}

void status_led_task(void*) {
    const Config c = config();
    if (!indicator_init(c)) {
        vTaskDelete(nullptr);
        return;
    }
    log_indicator(c);
    emit(false, LedPattern{});   // start dark, whatever the pin's reset state was

    for (;;) {
        // Guarded like mqtt_task/poll_task (.claude/CLAUDE.md → Memory constraints): wifi_info(),
        // mqtt_status() and hp_stats() each copy std::strings out of a locked snapshot, so any of
        // them can throw std::bad_alloc under memory pressure — and a task entry is a C frame
        // boundary, so an escape means std::terminate() and a reboot triggered by a cosmetic LED.
        // The pattern is recomputed from scratch each tick, so dropping one costs nothing.
        try {
            status_led_tick();
        } catch (...) {
            emit(false, LedPattern{});                         // don't leave it stuck lit
            vTaskDelay(pdMS_TO_TICKS(1000));                   // and don't hot-spin while starved
        }
    }
}

}  // namespace

void status_led_start() {
    const Config c = config();
    if (c.led_gpio < 0) return;   // no indicator on this board — nothing to drive
    // Purely cosmetic, so a failed task is harmless — but don't swallow the allocation failure
    // silently. 3 KB (up from 2 KB): the WS2812 path calls into led_strip/RMT from this stack.
    if (xTaskCreate(status_led_task, "status_led", 3072, nullptr, TASK_PRIO_LED, nullptr) != pdPASS)
        ESP_LOGW("led", "status-LED task alloc failed — indicator disabled this boot");
}

} // namespace daik
