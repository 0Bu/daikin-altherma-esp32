// Runtime config: daik::Config backed by NVS, seeded from Kconfig defaults. See config.hpp.
#include "config.hpp"
#include "nvs_storage.hpp"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

namespace daik {

static Config            g_cfg;
static SemaphoreHandle_t g_mtx = nullptr;   // guards g_cfg; created in config_load() before tasks start

// RAII guard around g_mtx. Releases on exception too, so a std::bad_alloc thrown while copying
// g_cfg's std::strings can't leave the mutex held (which would deadlock every later config() call).
namespace {
struct Lock {
    explicit Lock(SemaphoreHandle_t m) : m_(m) { if (m_) xSemaphoreTake(m_, portMAX_DELAY); }
    ~Lock() { if (m_) xSemaphoreGive(m_); }
    SemaphoreHandle_t m_;
};
}  // namespace

// Return a CONSISTENT SNAPSHOT (by value) taken under the lock: a reader never observes a torn
// Config while a writer swaps g_cfg (config_save / config_set_runtime run from the HTTP and poll
// tasks). Callers bind `const Config& c = config();` -> the returned temporary is lifetime-extended,
// giving them a stable copy for the rest of the scope.
Config config() {
    Lock lk(g_mtx);
    return g_cfg;
}

static void publish(const Config& c) {   // swap g_cfg under the lock
    Lock lk(g_mtx);
    g_cfg = c;
}

void config_load() {
    g_mtx = xSemaphoreCreateMutex();
    Config c;
    // Persisted user settings: WiFi + MQTT credentials. (The hostname is fixed at
    // CONFIG_DAIKIN_HOSTNAME, the poll cadence at POLL_INTERVAL_S, labels are English-only.)
    c.wifi_ssid = nvs_get_str("wifi_ssid", CONFIG_DAIKIN_WIFI_SSID);
    c.wifi_pass = nvs_get_str("wifi_pass", CONFIG_DAIKIN_WIFI_PASSWORD);
    c.mqtt_uri  = nvs_get_str("mqtt_uri", CONFIG_DAIKIN_MQTT_BROKER_URI);
    c.mqtt_user = nvs_get_str("mqtt_user", CONFIG_DAIKIN_MQTT_USERNAME);
    c.mqtt_pass = nvs_get_str("mqtt_pass", CONFIG_DAIKIN_MQTT_PASSWORD);

    // Persisted X10A LINK cache: RX/TX pins + protocol. The wiring is physically boot-invariant, so
    // it is cached (fallback = compile-time Kconfig default) and tried FIRST by the detection sweep;
    // a change is re-persisted (hp_poll.cpp poll_detect). The sweep still tries the defaults too, so
    // a stale cache self-heals. The MODEL is NOT persisted — profile + fingerprint below stay the
    // sentinel/empty and are re-detected on every boot (a swapped unit is re-identified).
    c.rx_pin       = nvs_get_i32("rx_pin", CONFIG_DAIKIN_RX_PIN);
    c.tx_pin       = nvs_get_i32("tx_pin", CONFIG_DAIKIN_TX_PIN);
    c.proto        = parse_protocol(nvs_get_str("proto", CONFIG_DAIKIN_PROTOCOL));
    c.profile      = "auto";
    c.fp_pages     = 0;
    c.fp_kw_tenths = -1;
    c.fp_eeprom    = "";
    c.fp_valid     = false;
    publish(c);
}

bool config_save(const Config& c) {
    // Persist user settings (WiFi + MQTT) and the X10A link cache (RX/TX pins + protocol). The MODEL
    // is intentionally NOT written — profile + fingerprint (fp_*) are re-derived every boot.
    bool ok = true;
    ok &= nvs_set_str("wifi_ssid", c.wifi_ssid);
    ok &= nvs_set_str("wifi_pass", c.wifi_pass);
    ok &= nvs_set_str("mqtt_uri", c.mqtt_uri);
    ok &= nvs_set_str("mqtt_user", c.mqtt_user);
    ok &= nvs_set_str("mqtt_pass", c.mqtt_pass);
    ok &= nvs_set_i32("rx_pin", c.rx_pin);
    ok &= nvs_set_i32("tx_pin", c.tx_pin);
    ok &= nvs_set_str("proto", std::string(1, static_cast<char>(c.proto)));
    if (ok) publish(c);
    return ok;
}

void config_set_runtime(const Config& c) { publish(c); }

} // namespace daik
