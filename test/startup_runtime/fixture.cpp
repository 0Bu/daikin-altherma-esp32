// Complete production LED/button objects link separately; no copied task or startup logic.
#include "sdk.hpp"
#include "config.hpp"
#include "status_led.hpp"
#include "recovery_button.hpp"
#include "mqtt_ha.hpp"
#include "hp_poll.hpp"
#include "logic/button.hpp"
#include "task_config.hpp"
#include "stack_watch.hpp"
#include "logic/heartbeat.hpp"
#include <cstdlib>
#include <new>
#include <string>
namespace adapter {
daik::Config cfg;
bool         button = false, ws2812 = false, disabled = false;
const char*  scenario = nullptr;
} // namespace adapter
namespace daik {
// Deliberate adapter contract: ANY legacy full snapshot fails, while actual with_config runs.
Config config() {
    ++sdk::config_copies;
    throw std::bad_alloc();
}
namespace detail {
void config_lock() {
    ++sdk::lock_depth;
    ++sdk::config_locks;
}
void config_unlock() {
    --sdk::lock_depth;
    ++sdk::config_unlocks;
}
const Config& config_ref_locked() {
    ++sdk::config_refs;
    return adapter::cfg;
}
} // namespace detail
void       diag_printf(const char*, ...) {}
bool       net_eth_present() { return false; }
bool       net_is_up() { return true; }
MqttStatus mqtt_status() {
    ++sdk::mqtt_reads;
    if (sdk::fail_mqtt_snapshot) throw std::bad_alloc();
    MqttStatus out;
    out.configured = true;
    out.connected  = true;
    return out;
}
HpStats hp_stats() {
    ++sdk::hp_reads;
    if (sdk::fail_hp_snapshot) throw std::bad_alloc();
    HpStats out;
    out.connected = true;
    return out;
}
esp_err_t nvs_erase_all() {
    ++sdk::destructive_calls;
    return ESP_FAIL;
}
esp_err_t wifi_forget_persisted_config() {
    ++sdk::destructive_calls;
    return ESP_FAIL;
}
bool history_flash_forget() {
    ++sdk::destructive_calls;
    return false;
}
void dwell_forget() { ++sdk::destructive_calls; }
bool diag_crash_forget() {
    ++sdk::destructive_calls;
    return false;
}
} // namespace daik
static void oracle(bool pass, const char* name) {
    if (!pass) {
        std::fprintf(stderr, "FAIL oracle=%s scenario=%s\n", name, adapter::scenario);
        std::exit(1);
    }
}
static void first_delay(TickType_t ticks) {
    using namespace daik;
    const StackWatch expected = adapter::button ? StackWatch::Button : StackWatch::Led;
    oracle(stack_watch_min_free_bytes(expected) == 2048, "accessory_task_samples_exact_owner_slot");
    for (unsigned i = 0; i < static_cast<unsigned>(StackWatch::COUNT); ++i)
        if (static_cast<StackWatch>(i) != expected)
            oracle(stack_watch_min_free_bytes(static_cast<StackWatch>(i)) == 0,
                   "accessory_task_does_not_sample_foreign_slot");
    oracle(sdk::delays == 1, "first_controlled_delay");
    oracle(sdk::config_copies == 0, adapter::button ? "button_task_startup_no_config_copy"
                                                    : "led_task_startup_no_config_copy");
    oracle(sdk::config_refs == 2 && sdk::config_locks == 2 && sdk::config_unlocks == 2 &&
               sdk::lock_depth == 0,
           "scalar_snapshots_unlock_before_task_wait");
    oracle(sdk::destructive_calls == 0, "no_erase_restart_or_forget_path");
    oracle(sdk::task_deletes == 0, "configured_task_starts");
    if (adapter::button) {
        oracle(ticks == pdMS_TO_TICKS(BUTTON_SAMPLE_MS), "button_normal_sample_delay");
        oracle(sdk::gpio_configs == 1 &&
                   sdk::gpio_configured.pin_bit_mask == (1ULL << adapter::cfg.btn_gpio) &&
                   sdk::gpio_configured.mode == GPIO_MODE_INPUT &&
                   sdk::gpio_configured.intr_type == GPIO_INTR_DISABLE,
               "button_pin_and_input_mode");
        oracle(sdk::gpio_configured.pull_up_en ==
                       (adapter::cfg.btn_active_low ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE) &&
                   sdk::gpio_configured.pull_down_en ==
                       (adapter::cfg.btn_active_low ? GPIO_PULLDOWN_DISABLE : GPIO_PULLDOWN_ENABLE),
               "button_inactive_pull_matches_polarity");
        oracle(sdk::gpio_reads == 1 && sdk::read_gpio == adapter::cfg.btn_gpio &&
                   sdk::gpio_writes == 0 && sdk::strip_creates == 0,
               "button_samples_configured_released_input");
    } else {
        oracle(ticks == (sdk::fail_mqtt_snapshot || sdk::fail_hp_snapshot ? 1000U : 25U),
               "led_first_slice_or_oom_backoff_delay");
        if (adapter::ws2812) {
            oracle(sdk::strip_creates == 1 &&
                       sdk::strip_configured.strip_gpio_num == adapter::cfg.led_gpio &&
                       sdk::strip_configured.max_leds == 1 &&
                       sdk::strip_configured.led_model == LED_MODEL_WS2812 &&
                       sdk::strip_configured.color_component_format ==
                           LED_STRIP_COLOR_COMPONENT_FMT_GRB &&
                       !sdk::strip_configured.flags.invert_out,
                   "ws2812_pin_driver_color_and_polarity");
            oracle(sdk::rmt_configured.clk_src == RMT_CLK_SRC_DEFAULT &&
                       sdk::rmt_configured.resolution_hz == 10000000 &&
                       sdk::rmt_configured.mem_block_symbols == 64 &&
                       !sdk::rmt_configured.flags.with_dma,
                   "ws2812_rmt_settings");
            oracle(sdk::strip_clears == 1 && sdk::strip_pixels == 2 && sdk::strip_refreshes == 2 &&
                       sdk::strip_r == 0 && sdk::strip_g == 0 && sdk::strip_b == 0 &&
                       sdk::gpio_configs == 0 && sdk::gpio_writes == 0,
                   "ws2812_starts_dark");
        } else {
            oracle(sdk::gpio_configs == 1 &&
                       sdk::gpio_configured.pin_bit_mask == (1ULL << adapter::cfg.led_gpio) &&
                       sdk::gpio_configured.mode == GPIO_MODE_OUTPUT &&
                       sdk::gpio_configured.intr_type == GPIO_INTR_DISABLE &&
                       sdk::gpio_configured.pull_up_en == GPIO_PULLUP_DISABLE &&
                       sdk::gpio_configured.pull_down_en == GPIO_PULLDOWN_DISABLE,
                   "led_pin_and_output_mode");
            oracle(sdk::first_gpio == adapter::cfg.led_gpio && sdk::gpio_writes == 2 &&
                       sdk::first_level == (adapter::cfg.led_inverted ? 1 : 0) &&
                       sdk::last_level == sdk::first_level && sdk::strip_creates == 0,
                   "gpio_led_starts_dark_with_configured_polarity");
        }
        if (sdk::fail_mqtt_snapshot)
            oracle(sdk::mqtt_reads == 1 && sdk::hp_reads == 0, "led_mqtt_snapshot_oom_contained");
        else if (sdk::fail_hp_snapshot)
            oracle(sdk::mqtt_reads == 1 && sdk::hp_reads == 1, "led_hp_snapshot_oom_contained");
        else
            oracle(sdk::mqtt_reads == 0 && sdk::hp_reads == 0,
                   "idle_led_avoids_allocating_status_snapshots");
    }
    std::printf("PASS scenario=%s zero Config copies; scalar startup snapshots; first delay=%u; "
                "pin/mode/polarity verified; no destructive calls\n",
                adapter::scenario, ticks);
    // Exit the host process at the first scheduled wait; no synthetic exception enters task catch.
    std::exit(0);
}
static void stack_minimum_contract() {
    using namespace daik;
    for (unsigned i = 0; i < static_cast<unsigned>(StackWatch::COUNT); ++i) {
        const auto  slot = static_cast<StackWatch>(i);
        std::string rendered;
        append_stack_bytes(rendered, stack_watch_min_free_bytes(slot));
        oracle(rendered == "null", "never_sampled_slot_renders_null");
    }
    constexpr auto extra_count = sizeof(STACK_WATCH_EXTRA_FIELDS) / sizeof(StackWatchField);
    oracle(extra_count + 5 == static_cast<unsigned>(StackWatch::COUNT),
           "status_table_covers_all_additional_slots");
    for (unsigned i = 0; i < extra_count; ++i)
        for (unsigned k = i + 1; k < extra_count; ++k)
            oracle(STACK_WATCH_EXTRA_FIELDS[i].slot != STACK_WATCH_EXTRA_FIELDS[k].slot &&
                       std::strcmp(STACK_WATCH_EXTRA_FIELDS[i].name,
                                   STACK_WATCH_EXTRA_FIELDS[k].name) != 0,
                   "status_field_names_and_slots_are_unique");
    sdk::in_task = true;
    stack_watch_sample(StackWatch::Led);
    oracle(stack_watch_min_free_bytes(StackWatch::Led) == 2048,
           "stack_minimum_retains_exact_esp_idf_byte_unit");
    sdk::current_stack_bytes = 1000;
    stack_watch_sample(StackWatch::Led);
    sdk::current_stack_bytes = 3072; // a fresh incarnation has a higher FreeRTOS watermark
    stack_watch_sample(StackWatch::Led);
    oracle(stack_watch_min_free_bytes(StackWatch::Led) == 1000,
           "boot_minimum_survives_task_recreation");
    stack_watch_sample(StackWatch::Button);
    oracle(stack_watch_min_free_bytes(StackWatch::Button) == 3072 &&
               stack_watch_min_free_bytes(StackWatch::Led) == 1000 &&
               stack_watch_min_free_bytes(StackWatch::SdkMqtt) == 0,
           "stack_minima_are_independent_between_owners");
    std::string rendered;
    append_stack_bytes(rendered, stack_watch_min_free_bytes(StackWatch::Led));
    oracle(rendered == "1000", "sampled_stack_minimum_renders_numeric_bytes");
    std::printf("PASS scenario=stack_minima null/byte-unit/independent slots; boot minimum across "
                "task recreation; complete unique status table\n");
}
int main(int argc, char** argv) {
    oracle(argc == 2, "scenario_argument");
    adapter::scenario          = argv[1];
    const std::string scenario = argv[1];
    if (scenario == "stack_minima") {
        stack_minimum_contract();
        return 0;
    }
    adapter::button            = scenario.rfind("button_", 0) == 0;
    adapter::ws2812            = scenario == "led_ws2812";
    adapter::disabled          = scenario == "led_disabled" || scenario == "button_disabled";
    adapter::cfg.led_gpio      = adapter::disabled ? -1 : 4;
    adapter::cfg.led_type =
        static_cast<int>(adapter::ws2812 ? daik::LedType::Ws2812 : daik::LedType::Gpio);
    adapter::cfg.led_inverted   = scenario == "led_gpio_low" || adapter::ws2812;
    adapter::cfg.btn_gpio       = adapter::disabled ? -1 : 7;
    adapter::cfg.btn_active_low = scenario != "button_high";
    sdk::read_level             = adapter::cfg.btn_active_low ? 1 : 0;
    sdk::fail_mqtt_snapshot     = scenario == "led_mqtt_oom";
    sdk::fail_hp_snapshot       = scenario == "led_hp_oom";
    sdk::fail_gpio_config       = scenario == "led_init_fail" || scenario == "button_init_fail";
    if (sdk::fail_mqtt_snapshot || sdk::fail_hp_snapshot) sdk::wifi_mode = WIFI_MODE_STA;
    sdk::on_delay = first_delay;
    try {
        if (adapter::button)
            daik::recovery_button_start();
        else
            daik::status_led_start();
    } catch (...) {
        oracle(false,
               adapter::button ? "button_starter_no_config_copy" : "led_starter_no_config_copy");
    }
    oracle(sdk::config_copies == 0 && sdk::lock_depth == 0,
           "starter_scalar_snapshot_no_copy_or_lock_retention");
    if (adapter::disabled) {
        for (unsigned i = 0; i < static_cast<unsigned>(daik::StackWatch::COUNT); ++i)
            oracle(daik::stack_watch_min_free_bytes(static_cast<daik::StackWatch>(i)) == 0,
                   "disabled_accessory_stack_slots_remain_unsampled");
        oracle(sdk::config_refs == 1 && sdk::task_creates == 0 && sdk::destructive_calls == 0 &&
                   sdk::gpio_configs == 0 && sdk::strip_creates == 0,
               "disabled_startup_has_no_task_or_hardware_operations");
        std::printf("PASS scenario=%s disabled startup; zero Config copies; no "
                    "task/hardware/destructive operations\n",
                    adapter::scenario);
        return 0;
    }
    oracle(sdk::task_creates == 1 && sdk::task_fn && sdk::task_stack == 3072 &&
               sdk::task_priority ==
                   (adapter::button ? daik::TASK_PRIO_BUTTON : daik::TASK_PRIO_LED) &&
               std::strcmp(sdk::task_name, adapter::button ? "recovery_btn" : "status_led") == 0,
           "production_task_registered_with_stack_and_priority");
    try {
        sdk::in_task = true;
        sdk::task_fn(nullptr);
    } catch (...) {
        oracle(false, adapter::button ? "button_task_startup_no_config_copy"
                                      : "led_task_startup_no_config_copy");
    }
    if (sdk::fail_gpio_config) {
        oracle(sdk::task_deletes == 1 && sdk::delays == 0 && sdk::destructive_calls == 0,
               "failed_accessory_init_retires_without_loop_or_destructive_effect");
        oracle(daik::stack_watch_min_free_bytes(adapter::button ? daik::StackWatch::Button
                                                                : daik::StackWatch::Led) == 2048,
               "failed_accessory_init_samples_owner_before_delete");
        std::printf("PASS scenario=%s owner sample before task retirement\n", adapter::scenario);
        return 0;
    }
    oracle(false, "task_reaches_first_controlled_delay");
}
