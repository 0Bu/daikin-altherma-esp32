// Runtime config: daik::Config backed by NVS, seeded from Kconfig defaults. See config.hpp.
#include "config.hpp"
#include "nvs_storage.hpp"
#include "diag_log.hpp"
#include "sdkconfig.h"
#include "soc/soc_caps.h"   // SOC_GPIO_PIN_COUNT — per-target GPIO count for the link-pin check
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
    c.wifi_ssid_backup = nvs_get_str("wifi_ssid_back", "");
    c.wifi_pass_backup = nvs_get_str("wifi_pass_back", "");
    c.wifi_rollback_active = nvs_get_i32("wifi_rollback", 0) != 0;
    c.wifi_rolled_back = nvs_get_i32("wifi_rolledbk", 0) != 0;
    c.mqtt_uri  = nvs_get_str("mqtt_uri", CONFIG_DAIKIN_MQTT_BROKER_URI);
    c.mqtt_user = nvs_get_str("mqtt_user", CONFIG_DAIKIN_MQTT_USERNAME);
    c.mqtt_pass = nvs_get_str("mqtt_pass", CONFIG_DAIKIN_MQTT_PASSWORD);
    c.syslog_host = nvs_get_str("syslog_host", CONFIG_DAIKIN_SYSLOG_HOST);
    c.syslog_port = nvs_get_i32("syslog_port", CONFIG_DAIKIN_SYSLOG_PORT);
    // "" on flash (either no key yet, or an explicit empty save via POST /set_ntp) both fall back to
    // the Kconfig default — unlike syslog_host, an empty ntp_server is not a disabled state to
    // preserve, so nvs_get_str's own default-on-missing-key isn't enough on its own.
    c.ntp_server = nvs_get_str("ntp_server", CONFIG_DAIKIN_NTP_SERVER);
    if (c.ntp_server.empty()) c.ntp_server = CONFIG_DAIKIN_NTP_SERVER;

    // Persisted X10A LINK cache: RX/TX pins + protocol. The wiring is physically boot-invariant, so
    // it is cached (fallback = compile-time Kconfig default) and tried FIRST by the detection sweep;
    // a change is re-persisted (hp_poll.cpp poll_detect). The sweep still tries the defaults too, so
    // a stale cache self-heals. The MODEL is NOT persisted — profile + fingerprint below stay the
    // sentinel/empty and are re-detected on every boot (a swapped unit is re-identified).
    c.rx_pin       = nvs_get_i32("rx_pin", CONFIG_DAIKIN_RX_PIN);
    c.tx_pin       = nvs_get_i32("tx_pin", CONFIG_DAIKIN_TX_PIN);
    // Re-check the pair on the way IN. BOTH write paths commit rx_pin and tx_pin as two independent
    // NVS writes — config_save and, since the field-owned split, config_save_link — so a save cut or
    // failed between them leaves a pair on flash the request path would have rejected outright:
    // correcting a swapped wire {44,43} -> {43,44} with only the rx write through leaves rx == tx ==
    // 43. Naming the failing key on /diag (put_i32) reports that write; it does not undo the one that
    // landed. validate() enforces the pair, but only on the request path (http_config.cpp); NVS stops
    // being trusted the moment a partial write is possible.
    // A guard, not a repair: the sweep already drops an rx == tx candidate and falls back to these
    // same defaults (hp_detect.cpp), so the bus still comes up. link_pins_safe adds the checks the
    // sweep lacks — the upper GPIO bound AND the chip-reserved-pin rule (board_pins.hpp), the same
    // rule the request path enforces (validate) — so a pair that reaches flash via a curl POST to
    // /set_hp (flash/strapping/JTAG pad) is not silently re-tried every boot into a crash loop, and
    // /status never reports an unconfigurable link as fact. Not re-persisted: poll_detect writes the
    // winning pins back once the bus answers; until then the line below repeats each boot.
    if (!link_pins_safe(c.rx_pin, c.tx_pin, hw_octal_spi(), hw_status_led_gpio(),
                        SOC_GPIO_PIN_COUNT - 1)) {
        diag_printf("config: persisted X10A pins rejected (rx=%d tx=%d) — using build defaults %d/%d\n",
                    c.rx_pin, c.tx_pin, CONFIG_DAIKIN_RX_PIN, CONFIG_DAIKIN_TX_PIN);
        c.rx_pin = CONFIG_DAIKIN_RX_PIN;
        c.tx_pin = CONFIG_DAIKIN_TX_PIN;
    }
    c.proto        = parse_protocol(nvs_get_str("proto", CONFIG_DAIKIN_PROTOCOL));
    c.profile      = "auto";
    c.fp_pages     = 0;
    c.fp_kw_tenths = -1;
    c.fp_eeprom    = "";
    c.fp_valid     = false;
    publish(c);
}

// One NVS write, with the failure named on /diag + syslog. The callers only learn THAT the save
// failed (they turn it into a 500); without this line nobody could tell which key died or why —
// a full partition and a wedged flash both surface as a bare "config write failed".
static bool put_str(const char* key, const std::string& val) {
    esp_err_t e = nvs_set_str(key, val);
    if (e != ESP_OK) diag_printf("config: NVS write failed key=%s err=%s\n", key, esp_err_to_name(e));
    return e == ESP_OK;
}
static bool put_i32(const char* key, int32_t val) {
    esp_err_t e = nvs_set_i32(key, val);
    if (e != ESP_OK) diag_printf("config: NVS write failed key=%s err=%s\n", key, esp_err_to_name(e));
    return e == ESP_OK;
}

bool config_save(const Config& c) {
    // Persist user settings (WiFi + MQTT) and the X10A link cache (RX/TX pins + protocol). The MODEL
    // is intentionally NOT written — profile + fingerprint (fp_*) are re-derived every boot.
    // Within a group every key is attempted even after a failure (`&=`, not short-circuit) so one bad
    // key doesn't hide the rest, and each failing one gets its own diag line. ACROSS the two WiFi
    // groups the sequence stops dead — see below.
    bool ok = true;

    // WiFi credentials vs. their rollback backup: the ORDER of these two groups matters. Every
    // nvs_set_* commits on its own (nvs_storage.cpp), so config_save is a sequence of independent
    // commits and not a transaction — a power cut lands BETWEEN two of them, and which pair it
    // straddles decides whether the device can still find its way back to a working network. The
    // rule is "write what must survive the cut before the state that points away from it", and its
    // direction flips with the change:
    //   arming a rollback (flag → true, i.e. POST /set_wifi): the backup and the flag must already
    //     be on flash when the new credentials land. Otherwise a cut arms untried credentials with
    //     no way back — precisely the failure this mechanism exists to prevent.
    //   clearing one (flag → false: a rollback restoring the old credentials, or any ordinary save
    //     that does not touch WiFi at all): the restored credentials must land before the backup
    //     that still holds them is erased.
    // Either way the worst case becomes the same harmless one — a stale backup/flag next to
    // credentials that work, which the next successful connect clears (wifi.cpp). Ordered backwards,
    // the worst case costs the credentials themselves.
    //
    // A WRITE FAILURE straddles these groups exactly like a power cut does, so the second group is
    // only written if the first one fully landed. Without that stop, an NVS error hits the identical
    // worst case the ordering exists to rule out: clearing a rollback whose credential-restore
    // failed would go on to erase the backup that still held the only working credentials, leaving
    // the bad ones on flash and nothing to roll back to. Bailing out keeps flash self-consistent —
    // it just keeps the PREVIOUS consistent state, which is what `false` then tells the caller.
    auto save_wifi_creds = [&] {
        bool g = true;
        g &= put_str("wifi_ssid", c.wifi_ssid);
        g &= put_str("wifi_pass", c.wifi_pass);
        return g;
    };
    auto save_wifi_rollback = [&] {
        bool g = true;
        g &= put_str("wifi_ssid_back", c.wifi_ssid_backup);
        g &= put_str("wifi_pass_back", c.wifi_pass_backup);
        g &= put_i32("wifi_rollback", c.wifi_rollback_active ? 1 : 0);
        g &= put_i32("wifi_rolledbk", c.wifi_rolled_back ? 1 : 0);
        return g;
    };
    if (c.wifi_rollback_active) {
        if (!save_wifi_rollback()) return false;   // no backup on flash → do NOT arm the new creds
        ok &= save_wifi_creds();
    } else {
        if (!save_wifi_creds()) return false;      // creds not on flash → do NOT erase the backup
        ok &= save_wifi_rollback();
    }

    ok &= put_str("mqtt_uri", c.mqtt_uri);
    ok &= put_str("mqtt_user", c.mqtt_user);
    ok &= put_str("mqtt_pass", c.mqtt_pass);
    ok &= put_str("syslog_host", c.syslog_host);
    ok &= put_i32("syslog_port", c.syslog_port);
    ok &= put_str("ntp_server", c.ntp_server);
    ok &= put_i32("rx_pin", c.rx_pin);
    ok &= put_i32("tx_pin", c.tx_pin);
    ok &= put_str("proto", std::string(1, static_cast<char>(c.proto)));
    if (ok) publish(c);
    return ok;
}

// ── Field-owned commits (the detection path) ─────────────────────────────────────────────────────
// These exist so the poll task never writes a field it doesn't own. It snapshots the config, then
// spends a whole sweep off-lock probing the bus; committing that stale snapshot back would revert
// any /set_wifi or /set_mqtt that landed meanwhile. See logic/config_model.hpp's ownership note.

bool config_save_link(int rx_pin, int tx_pin, Protocol proto) {
    // NVS first, off-lock (flash writes are slow — readers shouldn't queue behind them), and only
    // the three link keys: the caller's credentials are never carried along.
    bool ok = true;
    ok &= put_i32("rx_pin", rx_pin);
    ok &= put_i32("tx_pin", tx_pin);
    ok &= put_str("proto", std::string(1, static_cast<char>(proto)));
    // Patch RAM even when the cache write failed, unlike config_save's all-or-nothing publish: this
    // link is PROVEN — the bus just answered on it — and the poll engine reads the pins from here
    // every cycle. Refusing the patch would leave it hammering pins known not to work. A failed
    // write only costs the cache (detection re-runs next boot); the `false` return tells the caller.
    {
        Lock lk(g_mtx);
        apply_link(g_cfg, rx_pin, tx_pin, proto);
    }
    return ok;
}

// RAM-only by design: the model is re-detected every boot, so there is nothing to persist and no
// failure to report. Allocation happens at the call site, not under the lock (apply_model swaps).
void config_set_model(std::string profile, uint32_t fp_pages, int fp_kw_tenths, std::string fp_eeprom) {
    Lock lk(g_mtx);
    apply_model(g_cfg, std::move(profile), fp_pages, fp_kw_tenths, std::move(fp_eeprom));
}

// Whole-struct RAM publish (no NVS). Sole caller is POST /detect (http_config.cpp), which resets
// profile->"auto" + clears the fingerprint: acceptable as a whole-struct write because it runs on the
// httpd task, which OWNS the credential fields (serialized against the other /set_* handlers), so it
// cannot revert them. The poll task must NOT use this — it uses the field-owned config_set_model.
void config_set_runtime(const Config& c) { publish(c); }

// Kconfig-derived hardware facts (see config.hpp). Kept here — the one file that already owns the
// CONFIG_* → link mapping — so board_pins' octal_spi/reserved inputs have a single source of truth
// rather than a #if block duplicated across http_status.cpp, http_config.cpp and config_load().
bool hw_octal_spi() {
#if defined(CONFIG_ESPTOOLPY_OCT_FLASH) || defined(CONFIG_SPIRAM_MODE_OCTAL)
    return true;
#else
    return false;
#endif
}

int hw_status_led_gpio() {
#if CONFIG_DAIKIN_STATUS_LED_ENABLE
    return CONFIG_DAIKIN_STATUS_LED_GPIO;   // already -1 if the user disabled it in menuconfig
#else
    return -1;
#endif
}

} // namespace daik
