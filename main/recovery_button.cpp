// Physical recovery button — see recovery_button.hpp. GPIO sampling + the NVS erase + the indicator
// hand-off; the press classification itself is logic/button.hpp (pure, host-tested).
#include "recovery_button.hpp"
#include "config.hpp"
#include "diag_log.hpp"
#include "history.hpp"
#include "nvs_storage.hpp"
#include "status_led.hpp"
#include "logic/button.hpp"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace daik {
namespace {

// How long the "erasing now" indication is held. The erase itself is a handful of flash page writes
// — single-digit milliseconds — so a signal that merely brackets it would be invisible: the user
// would hold the button, see the armed strobe, and then watch the board reboot with no confirmation
// that anything was erased rather than that they simply held it wrong. The indicator therefore
// leads the erase (so it is already lit while flash is being written, which is what the signal
// claims) and is held afterwards to a total that a human actually registers.
constexpr int WIPE_LEAD_MS   = 250;    // > sleep_slices' 25 ms slice, so the indicator is lit first
constexpr int WIPE_TOTAL_MS  = 1500;

void factory_reset() {
    status_led_signal(LedSignal::Wiping);
    diag_printf("button: held %lus — FACTORY RESET, erasing all stored config (daik_cfg)\n",
                static_cast<unsigned long>(BUTTON_FIRE_MS / 1000));
    const int64_t t0 = esp_timer_get_time();
    vTaskDelay(pdMS_TO_TICKS(WIPE_LEAD_MS));

    const esp_err_t e = nvs_erase_all();
    // The day of plant readings recorded beside that config is the user's too, so it goes with it.
    // This ALSO suppresses the shutdown handler that would otherwise write the whole snapshot back
    // out milliseconds later, on the very reboot this reset triggers.
    history_flash_forget();

    // Hold the signal to its full visible duration regardless of how fast the erase ran.
    const int elapsed = static_cast<int>((esp_timer_get_time() - t0) / 1000);
    if (elapsed < WIPE_TOTAL_MS) vTaskDelay(pdMS_TO_TICKS(WIPE_TOTAL_MS - elapsed));

    if (e != ESP_OK) {
        // Rebooting now would come back up on the config we just told the user was gone. Stay up,
        // hand the indicator back, and name the error — the web UI is still reachable on the old
        // network (which is the failure this button exists for, so the user is probably not on it),
        // but /diag + syslog at least record WHY the reset did nothing.
        diag_printf("button: factory reset FAILED (%s) — config left intact, NOT rebooting\n",
                    esp_err_to_name(e));
        status_led_signal(LedSignal::None);
        return;
    }
    diag_printf("button: config erased — rebooting into the setup portal\n");
    esp_restart();
}

void button_task(void*) {
    const Config c = config();
    const gpio_num_t pin = static_cast<gpio_num_t>(c.btn_gpio);
    const bool active_low = c.btn_active_low;

    gpio_config_t io{};
    io.intr_type    = GPIO_INTR_DISABLE;
    io.mode         = GPIO_MODE_INPUT;
    io.pin_bit_mask = (1ULL << c.btn_gpio);
    // Pull the pin to its INACTIVE level. Without this an open switch leaves the input floating and
    // ambient noise reads as a press — on a pin whose press erases the device's whole config.
    io.pull_up_en   = active_low ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE;
    io.pull_down_en = active_low ? GPIO_PULLDOWN_DISABLE : GPIO_PULLDOWN_ENABLE;
    if (gpio_config(&io) != ESP_OK) {
        diag_printf("button: GPIO%d config failed — recovery button disabled this boot\n", c.btn_gpio);
        vTaskDelete(nullptr);
        return;
    }

    // A button already held at boot is NOT a press. A stuck switch, a wiring short, or a user who
    // powered the board up with a finger on it would otherwise start a hold that fires 5 s into the
    // boot — before the user could possibly have decided to reset anything. Wait for the pin to
    // read released once before arming the state machine.
    bool ready = false;
    ButtonState st;

    diag_printf("button: recovery button on GPIO%d (active %s) — hold %lus to factory reset\n",
                c.btn_gpio, active_low ? "low" : "high",
                static_cast<unsigned long>(BUTTON_FIRE_MS / 1000));

    for (;;) {
        // Same self-guard as the other task loops (.claude/CLAUDE.md → Memory constraints):
        // diag_printf allocates, and an escaping bad_alloc from a task entry is std::terminate ->
        // reboot. A dropped sample costs nothing — the hold is re-evaluated from scratch next tick.
        try {
            const bool pressed = (gpio_get_level(pin) == 0) == active_low;
            if (!ready) {
                if (!pressed) ready = true;      // pin has been observed released — now it's live
            } else {
                switch (button_update(st, pressed, esp_timer_get_time() / 1000)) {
                case ButtonEvent::Armed:
                    diag_printf("button: held — release now to abort, keep holding to factory reset\n");
                    status_led_signal(LedSignal::WipeArmed);
                    break;
                case ButtonEvent::Aborted:
                    diag_printf("button: released before the threshold — nothing erased\n");
                    status_led_signal(LedSignal::None);
                    break;
                case ButtonEvent::Fired:
                    // Reboots on success. If it returns, the erase FAILED — and the state is left
                    // alone deliberately: `st.fired` stays set, so the still-held button cannot
                    // re-fire every five seconds and bury the one diag line that explains why in a
                    // repeating loop of identical attempts. Retrying costs the user a release and a
                    // second press, which is the right price for an operation that just reported a
                    // wedged flash.
                    factory_reset();
                    break;
                case ButtonEvent::None:
                    break;
                }
            }
        } catch (...) {
            status_led_signal(LedSignal::None);  // never strand the indicator in a warning
        }
        vTaskDelay(pdMS_TO_TICKS(BUTTON_SAMPLE_MS));
    }
}

}  // namespace

void recovery_button_start() {
    const Config c = config();
    if (c.btn_gpio < 0) return;   // no button configured — the default
    if (xTaskCreate(button_task, "recovery_btn", 3072, nullptr, 3, nullptr) != pdPASS)
        ESP_LOGW("button", "recovery-button task alloc failed — factory-reset button disabled this boot");
}

} // namespace daik
