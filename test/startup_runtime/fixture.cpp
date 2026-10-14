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
#include "mqtt_retirement_store.hpp"
#include "nvs_storage.hpp"
#include <cstdlib>
#include <initializer_list>
#include <new>
#include <string>
#include <vector>
namespace adapter {
daik::Config cfg;
bool         button = false, ws2812 = false, disabled = false;
const char*  scenario = nullptr;
// Hold scenarios: what each reset step returns, and the order the production reset called them.
esp_err_t   erase_result = ESP_FAIL, wifi_result = ESP_FAIL, seed_write_result = ESP_OK;
bool        history_result = false, crash_result = false, retire_result = false;
bool        seed_result = true;
std::string order;
unsigned    erase_calls = 0, seed_calls = 0, seed_writes = 0;
// /diag lines by kind — the format string is what identifies them; the adapter never formats.
unsigned diag_lines = 0, armed_lines = 0, fired_lines = 0, failed_lines = 0;
unsigned incomplete_lines = 0, not_kept_lines = 0, alloc_lines = 0;
// The input script of a hold scenario: consecutive (samples, pressed) runs.
struct Run {
    unsigned samples;
    bool     pressed;
};
std::vector<Run> script;
unsigned         script_total = 0, phase_end = 0;
bool             phase_checked = false;

void step(const char* name) {
    if (!order.empty()) order += ',';
    order += name;
}
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
void diag_printf(const char* fmt, ...) {
    ++adapter::diag_lines;
    const std::string line = fmt;
    if (line.rfind("button: held — release now", 0) == 0) ++adapter::armed_lines;
    if (line.find("FACTORY RESET") != std::string::npos) ++adapter::fired_lines;
    if (line.find("factory reset FAILED") != std::string::npos) ++adapter::failed_lines;
    if (line.find("factory reset INCOMPLETE") != std::string::npos) ++adapter::incomplete_lines;
    if (line.find("board hardware not kept") != std::string::npos) ++adapter::not_kept_lines;
    if (line.find("task alloc failed") != std::string::npos) ++adapter::alloc_lines;
}
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
// Every destructive step is counted (the startup scenarios require zero) and, for the hold
// scenarios, recorded in call order with a scenario-chosen result.
esp_err_t nvs_erase_all() {
    ++sdk::destructive_calls;
    ++adapter::erase_calls;
    adapter::step("erase");
    return adapter::erase_result;
}
esp_err_t wifi_forget_persisted_config() {
    ++sdk::destructive_calls;
    adapter::step("wifi");
    return adapter::wifi_result;
}
bool history_flash_forget() {
    ++sdk::destructive_calls;
    adapter::step("history");
    return adapter::history_result;
}
void dwell_forget() {
    ++sdk::destructive_calls;
    adapter::step("dwell");
}
bool diag_crash_forget() {
    ++sdk::destructive_calls;
    adapter::step("crash");
    return adapter::crash_result;
}
bool mqtt_retirement_forget() noexcept {
    ++sdk::destructive_calls;
    adapter::step("retire");
    return adapter::retire_result;
}
// The board-hardware seed: built from RAM (not destructive), written only behind the latch.
bool config_factory_seed_blob(std::vector<uint8_t>& out) {
    ++adapter::seed_calls;
    adapter::step("seed");
    if (!adapter::seed_result) return false;
    out = {0x44, 0x4b, 0x43, 0x31};
    return true;
}
esp_err_t nvs_set_blob_after_factory_reset(const char* key, const void* data, size_t len) {
    ++sdk::destructive_calls;
    ++adapter::seed_writes;
    const auto* bytes = static_cast<const uint8_t*>(data);
    const bool  exact =
        std::string(key) == "cfg" && len == 4 && bytes[0] == 0x44 && bytes[3] == 0x31;
    adapter::step(exact ? "seed_write" : "seed_write_wrong_payload");
    return adapter::seed_write_result;
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
// ── Hold scenarios: a scripted input drives the production button task through its boot gate,
// a full hold and the real factory_reset(). 20 ms per sample, as every vTaskDelay advances the
// adapter clock by its own length; the factory reset's own waits read no GPIO.
static int scripted_level(unsigned read_index) {
    bool pressed = false; // past the script: released
    for (const adapter::Run& run : adapter::script) {
        if (read_index < run.samples) {
            pressed = run.pressed;
            break;
        }
        read_index -= run.samples;
    }
    return (pressed == adapter::cfg.btn_active_low) ? 0 : 1;
}
static void use_script(std::initializer_list<adapter::Run> runs) {
    adapter::script.assign(runs);
    adapter::script_total = 0;
    for (const adapter::Run& run : adapter::script) adapter::script_total += run.samples;
    sdk::level_for_read = scripted_level;
}
static void finish_hold(const char* summary) {
    std::printf("PASS scenario=%s %s; order=%s\n", adapter::scenario, summary,
                adapter::order.empty() ? "-" : adapter::order.c_str());
    std::exit(0);
}
static void hold_scenario_end() {
    const std::string s = adapter::scenario;
    if (s == "button_boot_gate") {
        // The gate opened only on the three released samples; the hold that followed armed once,
        // fired once, and its failed erase neither rebooted nor reached any later step.
        oracle(adapter::armed_lines == 1 && adapter::fired_lines == 1,
               "gated_hold_arms_and_fires_once");
        oracle(adapter::order == "seed,erase" && adapter::failed_lines == 1 && sdk::restarts == 0,
               "failed_erase_stops_before_any_later_step_or_restart");
        finish_hold("bounced boot never armed; three released samples opened the gate");
    }
    if (s == "button_reset_retire_fail") {
        oracle(adapter::order == "seed,erase,wifi,history,dwell,crash,retire",
               "reset_runs_every_erase_in_fail_closed_order");
        oracle(adapter::incomplete_lines == 1 && adapter::seed_writes == 0 && sdk::restarts == 0,
               "retirement_erase_failure_is_incomplete_without_seed_or_restart");
        oracle(adapter::fired_lines == 1, "held_button_fires_once_after_incomplete_reset");
        finish_hold("unerased retirement record kept the board up");
    }
    oracle(false, "hold_scenario_reaches_restart_or_end");
}
static void hold_delay(TickType_t) {
    if (!adapter::phase_checked && adapter::phase_end && sdk::gpio_reads >= adapter::phase_end) {
        adapter::phase_checked = true;
        // Held through boot with a one-sample and a two-sample released bounce, then held for
        // six more seconds: neither bounce is a release, so the state machine never went live.
        oracle(adapter::armed_lines == 0 && adapter::fired_lines == 0 && adapter::seed_calls == 0 &&
                   adapter::erase_calls == 0,
               "boot_gate_holds_through_one_and_two_sample_bounces");
    }
    if (sdk::gpio_reads >= adapter::script_total) hold_scenario_end();
}
static void hold_restart() {
    const std::string s = adapter::scenario;
    // The scenarios whose reset must NOT finish fail here under their own oracle names.
    oracle(s != "button_boot_gate", "failed_erase_stops_before_any_later_step_or_restart");
    oracle(s != "button_reset_retire_fail",
           "retirement_erase_failure_is_incomplete_without_seed_or_restart");
    oracle(adapter::fired_lines == 1 && adapter::armed_lines == 1, "complete_hold_arms_then_fires");
    if (s == "button_reset_complete") {
        oracle(adapter::order == "seed,erase,wifi,history,dwell,crash,retire,seed_write",
               "reset_order_is_seed_then_every_erase_then_seed_write");
        oracle(adapter::not_kept_lines == 0 && adapter::incomplete_lines == 0,
               "complete_reset_keeps_board_hardware");
        finish_hold("every erase, then the seed write, then the one restart");
    }
    if (s == "button_reset_seed_fail") {
        oracle(adapter::order == "seed,erase,wifi,history,dwell,crash,retire,seed_write" &&
                   adapter::not_kept_lines == 1,
               "failed_seed_write_is_reported_and_reset_still_completes");
        finish_hold("seed write failed; reset still completed");
    }
    if (s == "button_reset_no_seed") {
        oracle(adapter::order == "seed,erase,wifi,history,dwell,crash,retire" &&
                   adapter::seed_writes == 0 && adapter::not_kept_lines == 1,
               "unbuilt_seed_is_reported_and_reset_still_completes");
        finish_hold("no seed; reset still completed");
    }
    oracle(false, "restart_only_after_a_complete_reset");
}
static bool start_hold_scenario(const std::string& s) {
    if (s == "button_boot_gate") {
        // Held at boot; one released bounce; held; two released; held 6 s — still gated. Then
        // three released samples open the gate, and a 6 s hold arms and fires (erase fails).
        use_script({{20, true},
                    {1, false},
                    {20, true},
                    {2, false},
                    {300, true},
                    {3, false},
                    {300, true},
                    {5, false}});
        adapter::phase_end = 20 + 1 + 20 + 2 + 300;
    } else if (s == "button_reset_complete" || s == "button_reset_seed_fail" ||
               s == "button_reset_no_seed" || s == "button_reset_retire_fail") {
        use_script({{3, false}, {300, true}, {5, false}});
        adapter::erase_result      = ESP_OK;
        adapter::wifi_result       = ESP_OK;
        adapter::history_result    = true;
        adapter::crash_result      = true;
        adapter::retire_result     = s != "button_reset_retire_fail";
        adapter::seed_result       = s != "button_reset_no_seed";
        adapter::seed_write_result = s == "button_reset_seed_fail" ? ESP_FAIL : ESP_OK;
    } else {
        return false;
    }
    sdk::on_delay   = hold_delay;
    sdk::on_restart = hold_restart;
    return true;
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
    sdk::fail_task_create = scenario == "button_task_alloc_fail";
    sdk::on_delay = first_delay;
    start_hold_scenario(scenario); // a hold scenario replaces the first-delay exit with its script
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
    if (sdk::fail_task_create) {
        // A configured button whose task could not be created must say so where the owner looks.
        oracle(sdk::task_creates == 0 && adapter::alloc_lines == 1 && adapter::diag_lines == 1 &&
                   sdk::destructive_calls == 0,
               "button_task_alloc_failure_reaches_diag");
        std::printf("PASS scenario=%s task allocation failure reported through /diag\n",
                    adapter::scenario);
        return 0;
    }
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
