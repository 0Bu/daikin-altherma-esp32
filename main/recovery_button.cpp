// Physical recovery button — see recovery_button.hpp. GPIO sampling + the NVS erase + the indicator
// hand-off; the press classification itself is logic/button.hpp (pure, host-tested).
#include "recovery_button.hpp"
#include "stack_watch.hpp"
#include "config.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "history.hpp"
#include "mqtt_retirement_store.hpp"
#include "nvs_storage.hpp"
#include "state_dwell.hpp"
#include "status_led.hpp"
#include "wifi.hpp"
#include "logic/button.hpp"
#include "logic/config_transaction.hpp" // CONFIG_KEY_SERVICE — the "cfg" blob the seed restores

#include "driver/gpio.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/task.h"

#include <cstdint>
#include <vector>

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
    // Erases the stored config (daik_cfg), history, coredump and MQTT retirement record; the board
    // hardware statement is kept (the seed below).
    diag_printf("button: held %lus — FACTORY RESET, erasing all but the board hardware\n",
                static_cast<unsigned long>(BUTTON_FIRE_MS / 1000));
    const int64_t t0 = esp_timer_get_time();
    // The board-hardware statement (preset, indicator, this button) survives the reset: without it
    // the next boot would come up with the build's default indicator and no button, and the
    // recovery path the user just used would be gone from the board until someone restates it
    // in the Board hardware dialog. It is built from the RAM config (with any pin this boot's X10A
    // fallback disabled restored to its stored value) BEFORE anything is erased, so a failure
    // here (out of memory) costs only the seed — the reset proceeds without it and says so — and
    // nothing after the first erase has to allocate for it.
    std::vector<uint8_t> seed;
    const bool           have_seed = config_factory_seed_blob(seed);
    vTaskDelay(pdMS_TO_TICKS(WIPE_LEAD_MS));

    const esp_err_t e = nvs_erase_all();
    // Do not destroy history after a FAILED config wipe: that leaves the device running with its old
    // settings while silently deleting a different class of user data. Once NVS is gone, suppress
    // producers under the history flash lock and erase the journal before the reboot handler runs.
    // The raw coredump can contain credentials too, so a new owner must never inherit it.
    const esp_err_t wifi_e = e == ESP_OK ? wifi_forget_persisted_config() : e;
    const bool history_erased = e == ESP_OK && wifi_e == ESP_OK ? history_flash_forget() : false;
    if (e == ESP_OK && wifi_e == ESP_OK && history_erased) dwell_forget();
    const bool crash_erased = e == ESP_OK && wifi_e == ESP_OK && history_erased
        ? diag_crash_forget() : false;
    // The MQTT retirement record lives in its own "mqtt_retire" namespace, which nvs_erase_all()
    // does not touch. It names the base, board and profile this installation last announced — the
    // previous owner's broker layout — and a reset that left it behind would start the next owner's
    // first discovery from someone else's history. A REQUIRED step: its failure leaves the reset
    // incomplete like the erases above. Its writer refuses behind the latch nvs_erase_all() just
    // set, so the running MQTT task cannot recreate it before the reboot.
    const bool retire_erased = crash_erased && mqtt_retirement_forget();

    // Hold the signal to its full visible duration regardless of how fast the erase ran.
    const int elapsed = static_cast<int>((esp_timer_get_time() - t0) / 1000);
    if (elapsed < WIPE_TOTAL_MS) vTaskDelay(pdMS_TO_TICKS(WIPE_TOTAL_MS - elapsed));

    if (e != ESP_OK) {
        // A failed namespace erase does NOT mean nothing was erased: IDF removes the entries one by
        // one, so a flash error can leave part of the stored config gone, and a failed commit can
        // follow an erase that already landed. Rebooting would come back up on whatever survived.
        // Stay up on the intact RAM config instead — nvs_erase_all() has released its latch, so the
        // next successful settings save rewrites the stored config blob from it — hand the
        // indicator back, and name the error: the web UI is still reachable on the old network
        // (which is the failure this button exists for, so the user is probably not on it), but
        // /diag + syslog at least record WHY the reset did not finish.
        diag_printf("button: factory reset FAILED (%s) — config may be partly erased; NOT "
                    "rebooting, hold again to retry\n",
                    esp_err_to_name(e));
        status_led_signal(LedSignal::None);
        return;
    }
    if (wifi_e != ESP_OK || !history_erased || !crash_erased) {
        // NVS is already empty, but rebooting would turn a partial reset into a privacy breach: the
        // next setup could restore old trend data or expose an old raw memory dump. Stay in this
        // boot with producers suppressed; releasing and holding again retries the failed erase.
        diag_printf("button: factory reset INCOMPLETE — wifi=%s history=%s coredump=%s "
                    "mqtt_retire=%s; NOT rebooting, hold again to retry\n",
                    esp_err_to_name(wifi_e), history_erased ? "erased" : "pending",
                    crash_erased ? "erased" : "pending", "pending");
        status_led_signal(LedSignal::None);
        return;
    }
    if (!retire_erased) {
        // Everything else is gone; the retirement record is not. Same rule, same retry (and the
        // same line): the NVS latch stays set, so nothing recreates the record while this boot
        // waits for the next hold.
        diag_printf("button: factory reset INCOMPLETE — wifi=%s history=%s coredump=%s "
                    "mqtt_retire=%s; NOT rebooting, hold again to retry\n",
                    "ESP_OK", "erased", "erased", "pending");
        status_led_signal(LedSignal::None);
        return;
    }
    // Every required erase succeeded. Only now is the board-hardware seed written back — through
    // the one write the latch still allows, and never ahead of an erase that could still fail. Best
    // effort: without it the reset is still complete and private; the next boot merely starts with
    // the build's default indicator and no button, which the user can restate in the Board hardware
    // dialog once the device is back on WiFi (the setup portal accepts WiFi credentials only).
    const esp_err_t seed_e =
        have_seed ? nvs_set_blob_after_factory_reset(CONFIG_KEY_SERVICE, seed.data(), seed.size())
                  : ESP_FAIL;
    if (seed_e != ESP_OK)
        diag_printf("button: board hardware not kept (%s) — set it again under Board hardware\n",
                    have_seed ? esp_err_to_name(seed_e) : "seed unavailable");
    diag_printf("button: factory reset complete — rebooting into the setup portal\n");
    stack_watch_sample(StackWatch::Button);
    esp_restart();
}

void button_task(void*) {
    int  gpio       = -1;
    bool active_low = true;
    with_config([&](const Config& c) {
        gpio       = c.btn_gpio;
        active_low = c.btn_active_low;
    });
    const gpio_num_t pin = static_cast<gpio_num_t>(gpio);

    gpio_config_t io{};
    io.intr_type    = GPIO_INTR_DISABLE;
    io.mode         = GPIO_MODE_INPUT;
    io.pin_bit_mask = (1ULL << gpio);
    // Pull the pin to its INACTIVE level. Without this an open switch leaves the input floating and
    // ambient noise reads as a press — on a pin whose press erases the device's whole config.
    io.pull_up_en   = active_low ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE;
    io.pull_down_en = active_low ? GPIO_PULLDOWN_DISABLE : GPIO_PULLDOWN_ENABLE;
    if (gpio_config(&io) != ESP_OK) {
        diag_printf("button: GPIO%d config failed — recovery button disabled this boot\n", gpio);
        stack_watch_sample(StackWatch::Button);
        vTaskDelete(nullptr);
        return;
    }

    // A button already held at boot is NOT a press. A stuck switch, a wiring short, or a user who
    // powered the board up with a finger on it would otherwise start a hold that fires 5 s into the
    // boot — before the user could possibly have decided to reset anything. The state machine goes
    // live only after the pin has read released for BUTTON_RELEASE_SAMPLES consecutive samples
    // (logic/button.hpp, button_boot_gate_open): a single bounced "released" sample of a contact
    // that is in fact still closed is not that evidence.
    ButtonBootGate gate;
    ButtonState    st;

    diag_printf("button: recovery button on GPIO%d (active %s) — hold %lus to factory reset\n",
                gpio, active_low ? "low" : "high",
                static_cast<unsigned long>(BUTTON_FIRE_MS / 1000));

    for (;;) {
        stack_watch_sample(StackWatch::Button);
        // Same self-guard as the other task loops (AGENTS.md → Memory, concurrency, and HTTP
        // safety). A dropped sample costs nothing — the hold is re-evaluated next tick.
        try {
            const bool pressed = (gpio_get_level(pin) == 0) == active_low;
            // Until the gate opens every sample is consumed here; the one that opens it is a
            // released sample, which button_update treats as idle.
            if (button_boot_gate_open(gate, pressed)) {
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
                    // Reboots on success. If it returns, the reset FAILED or is INCOMPLETE, it has
                    // already handed the indicator back (LedSignal::None) — and the state is left
                    // alone deliberately: `st.fired` stays set, so the still-held button cannot
                    // re-fire every five seconds and bury the one diag line that explains why in a
                    // repeating loop of identical attempts, and `st.armed` stays set with it, so
                    // the same hold cannot re-light the armed warning either. Its release is silent
                    // (None, not Aborted). Retrying costs the user a release and a second press,
                    // which is the right price for an operation that just reported a wedged flash.
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
    int gpio = -1;
    with_config([&gpio](const Config& c) { gpio = c.btn_gpio; });
    if (gpio < 0) return; // no button configured — the default
    // A configured recovery button that silently does not exist is the worst way for this to fail:
    // the owner finds out only when holding it is their last way in. /diag + syslog, not just the
    // serial console nobody has attached.
    if (xTaskCreate(button_task, "recovery_btn", 3072, nullptr, TASK_PRIO_BUTTON, nullptr) != pdPASS)
        diag_printf("button: recovery-button task alloc failed — button disabled this boot\n");
}

} // namespace daik
