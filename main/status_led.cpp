// Physische Status-LED-Unterstützung.
// Steuert die onboard LED, um Systemzustände (WiFi-Verbindung, SoftAP-Modus, X10A-Fehler) anzuzeigen.
#include "status_led.hpp"
#include "config.hpp"
#include "wifi.hpp"
#include "mqtt_ha.hpp"
#include "hp_poll.hpp"
#include "driver/gpio.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

namespace daik {

#if CONFIG_DAIKIN_STATUS_LED_ENABLE

static const gpio_num_t s_led_gpio = static_cast<gpio_num_t>(CONFIG_DAIKIN_STATUS_LED_GPIO);
static const bool s_inverted = CONFIG_DAIKIN_STATUS_LED_INVERTED;

static void set_led(bool on) {
    if (s_led_gpio < 0) return;
    gpio_set_level(s_led_gpio, (on ^ s_inverted) ? 1 : 0);
}

static void status_led_task(void*) {
    if (s_led_gpio < 0) {
        vTaskDelete(nullptr);
        return;
    }

    gpio_config_t io_conf = {};
    io_conf.intr_type    = GPIO_INTR_DISABLE;
    io_conf.mode         = GPIO_MODE_OUTPUT;
    io_conf.pin_bit_mask = (1ULL << s_led_gpio);
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en   = GPIO_PULLUP_DISABLE;
    gpio_config(&io_conf);

    // Initial state: OFF
    set_led(false);

    for (;;) {
        wifi_mode_t mode = WIFI_MODE_NULL;
        esp_wifi_get_mode(&mode);

        if (mode == WIFI_MODE_AP || mode == WIFI_MODE_APSTA) {
            // SoftAP (Setup Portal) active -> Slow blink (1s ON, 1s OFF)
            set_led(true);
            vTaskDelay(pdMS_TO_TICKS(1000));
            set_led(false);
            vTaskDelay(pdMS_TO_TICKS(1000));
        } else if (mode == WIFI_MODE_STA) {
            WifiInfo wi = wifi_info();
            if (!wi.connected) {
                // WiFi connecting -> Fast blink (100ms ON, 100ms OFF)
                set_led(true);
                vTaskDelay(pdMS_TO_TICKS(100));
                set_led(false);
                vTaskDelay(pdMS_TO_TICKS(100));
            } else {
                // WiFi connected. Check MQTT and HP link.
                MqttStatus ms = mqtt_status();
                HpStats hp = hp_stats();

                bool mqtt_ok = !ms.configured || ms.connected;
                bool hp_ok = hp.connected;

                if (mqtt_ok && hp_ok) {
                    // All OK -> Solid ON
                    set_led(true);
                    vTaskDelay(pdMS_TO_TICKS(500));
                } else if (!hp_ok) {
                    // X10A Link Down / Error -> Doppel-Blitzen (überwiegend AUS, zwei kurze Blitze)
                    set_led(false);
                    vTaskDelay(pdMS_TO_TICKS(1000));
                    set_led(true);
                    vTaskDelay(pdMS_TO_TICKS(120));
                    set_led(false);
                    vTaskDelay(pdMS_TO_TICKS(150));
                    set_led(true);
                    vTaskDelay(pdMS_TO_TICKS(120));
                    set_led(false);
                    vTaskDelay(pdMS_TO_TICKS(150));
                } else {
                    // MQTT error but HP is OK -> Medium blink (300ms ON, 300ms OFF)
                    set_led(true);
                    vTaskDelay(pdMS_TO_TICKS(300));
                    set_led(false);
                    vTaskDelay(pdMS_TO_TICKS(300));
                }
            }
        } else {
            // No wifi mode or disabled -> OFF
            set_led(false);
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }
}

#endif // CONFIG_DAIKIN_STATUS_LED_ENABLE

void status_led_start() {
#if CONFIG_DAIKIN_STATUS_LED_ENABLE
    if (CONFIG_DAIKIN_STATUS_LED_GPIO >= 0) {
        xTaskCreate(status_led_task, "status_led", 2048, nullptr, 2, nullptr);
    }
#endif
}

} // namespace daik
