// Runtime config: daik::Config backed by NVS, seeded from Kconfig defaults. See config.hpp.
#include "config.hpp"
#include "nvs_storage.hpp"
#include "diag_log.hpp"
#include "logic/config_store.hpp"   // ConfigBlob (de)serialize — the atomic CRC-checked config blob
#include "sdkconfig.h"
#include "soc/soc_caps.h"   // SOC_GPIO_PIN_COUNT — per-target GPIO count for the link-pin check
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <cstdlib>          // abort() — the fail-stop when the config mutex can't be created
#include <vector>

namespace daik {

static Config            g_cfg;
static SemaphoreHandle_t g_mtx = nullptr;   // guards g_cfg; created in config_load() before tasks start

// The board-local hardware as this BUILD was configured — the first-boot / recovery values for the
// indicator + recovery button, exactly as CONFIG_DAIKIN_RX_PIN is for the X10A link. Kconfig is the
// default only; NVS is the authority once the user has saved anything (POST /set_board), which is
// what lets one published image serve boards with different onboard parts.
static void seed_board_defaults(Config& c) {
#if CONFIG_DAIKIN_STATUS_LED_ENABLE
    c.led_gpio = CONFIG_DAIKIN_STATUS_LED_GPIO;
#else
    c.led_gpio = -1;
#endif
#ifdef CONFIG_DAIKIN_STATUS_LED_WS2812
    c.led_type = static_cast<int>(LedType::Ws2812);
#else
    c.led_type = static_cast<int>(LedType::Gpio);
#endif
#ifdef CONFIG_DAIKIN_STATUS_LED_INVERTED
    c.led_inverted = true;
#else
    c.led_inverted = false;
#endif
    c.btn_gpio = CONFIG_DAIKIN_BUTTON_GPIO;
#ifdef CONFIG_DAIKIN_BUTTON_ACTIVE_LOW
    c.btn_active_low = true;
#else
    c.btn_active_low = false;
#endif
}

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
    // FAIL STOP if the config mutex can't be created. config() is read + written concurrently by the
    // httpd and poll tasks; without the mutex it hands out TORN std::string snapshots — a real data
    // race, not a cosmetic one. Logging and continuing (the old behaviour) is not fail-safe. A mutex
    // alloc failing this early means the heap is exhausted before any task exists, so there is no safe
    // degraded mode to fall into — abort so the reset reason + coredump are visible, rather than run
    // with silent memory corruption. (Reviewed: F04.)
    if (!g_mtx) {
        ESP_LOGE("config", "config mutex alloc failed at boot — aborting (cannot run config unsynchronized)");
        abort();
    }
    Config c;
    // Persisted user settings: WiFi + MQTT + syslog + NTP. These are read FIRST from the atomic
    // CRC-checked "cfg" blob (logic/config_store.hpp); it is written all-or-nothing by config_save, so
    // it is never half-updated. If it is absent (a fresh device, or an OTA upgrade from the pre-blob
    // per-key layout) or fails its CRC, fall back to the legacy individual keys — which for a fresh
    // device are just the Kconfig defaults. (The hostname is fixed at CONFIG_DAIKIN_HOSTNAME, the poll
    // cadence at POLL_INTERVAL_S, labels are English-only.)
    ConfigBlob b;
    std::vector<uint8_t> raw;
    if (nvs_get_blob("cfg", raw) && config_blob_deserialize(raw.data(), raw.size(), b)) {
        c.wifi_ssid = b.wifi_ssid;                     c.wifi_pass = b.wifi_pass;
        c.wifi_ssid_backup = b.wifi_ssid_backup;       c.wifi_pass_backup = b.wifi_pass_backup;
        c.wifi_rollback_active = b.wifi_rollback_active; c.wifi_rolled_back = b.wifi_rolled_back;
        c.mqtt_uri = b.mqtt_uri;   c.mqtt_user = b.mqtt_user;   c.mqtt_pass = b.mqtt_pass;
        c.syslog_host = b.syslog_host; c.syslog_port = b.syslog_port; c.ntp_server = b.ntp_server;
        // has_board is false for a blob written before the board block existed (v1). Those fields
        // were compile-time then, so "absent" must read as the Kconfig default, NOT as disabled —
        // otherwise the OTA that introduces this feature turns a XIAO user's working LED off.
        if (b.has_board) {
            c.led_gpio = b.led_gpio; c.led_type = b.led_type; c.led_inverted = b.led_inverted;
            c.btn_gpio = b.btn_gpio; c.btn_active_low = b.btn_active_low;
        } else {
            seed_board_defaults(c);
        }
        // The OTA channel (blob v3). has_ota == false is a blob written before the channel existed,
        // i.e. a device from the era when there was exactly ONE feed — which is the release channel.
        // So absent and "release" mean the same thing here (unlike the board block above, where
        // absent had to fall back to Kconfig); the struct default already says so.
        if (b.has_ota) c.ota_channel = ota_channel_from_int(b.ota_channel);
    } else {
        // Legacy / first-boot fallback (per-key + Kconfig defaults).
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
        c.ntp_server = nvs_get_str("ntp_server", CONFIG_DAIKIN_NTP_SERVER);
        seed_board_defaults(c);   // the legacy layout never held these — Kconfig is all there is
    }
    // Re-check the board-local pins on the way IN, for the same reason the X10A pair is re-checked
    // below: NVS holds whatever an older build, a different board's blob or a hand-crafted POST put
    // there, and both of these pins are DRIVEN (an output, or an input with a pull). A bad one is
    // not cosmetic — pointing the indicator at a flash pad corrupts flash traffic, and pointing the
    // button at a floating pad factory-resets the device by itself. The link pins are excluded from
    // this particular check (rx/tx are re-validated separately, just below, against the board pins
    // that survive here) so the two checks can't deadlock each other into rejecting both.
    {
        Config probe = c;
        probe.rx_pin = probe.tx_pin = -1;
        std::string why;
        if (!board_hw_valid(probe, why, SOC_GPIO_PIN_COUNT - 1, hw_octal_spi())) {
            diag_printf("config: persisted board hardware rejected (%s; led=%d type=%d btn=%d) "
                        "— using build defaults\n", why.c_str(), c.led_gpio, c.led_type, c.btn_gpio);
            seed_board_defaults(c);
            probe = c;
            probe.rx_pin = probe.tx_pin = -1;
            // A build whose OWN defaults don't validate is a misconfigured Kconfig, not user input.
            // Disable both rather than drive a pin that just failed the safety rule twice.
            if (!board_hw_valid(probe, why, SOC_GPIO_PIN_COUNT - 1, hw_octal_spi())) {
                diag_printf("config: build board defaults also rejected (%s) — indicator + button off\n",
                            why.c_str());
                c.led_gpio = -1;
                c.btn_gpio = -1;
            }
        }
    }
    // "" (either no ntp_server yet, or an explicit empty save via POST /set_ntp) falls back to the
    // Kconfig default — unlike syslog_host, an empty ntp_server is not a disabled state to preserve.
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
    if (!link_pins_safe(c.rx_pin, c.tx_pin, hw_octal_spi(), config_reserved_pins(c),
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
    // Persist user settings (WiFi + MQTT + syslog + NTP) and the X10A link cache (RX/TX pins +
    // protocol). The MODEL is intentionally NOT written — profile + fingerprint (fp_*) are re-derived
    // every boot.
    //
    // ATOMIC credential/service save (F02). The credential + service fields go into ONE CRC-checked
    // blob (logic/config_store.hpp) written with a single nvs_set_blob. That entry is atomic — either
    // the whole new blob lands or the previous one survives — so the save is all-or-nothing across
    // both a mid-write NVS failure AND a power cut, with no per-key rollback and no write-ordering to
    // get right (the old multi-commit save needed both, and still left a partial state on a rollback
    // that could not complete). Because this blob is written HERE (the httpd task) alone, the poll
    // task (config_save_link) can never revert a credential change — the field-ownership guarantee is
    // kept without the narrow per-key writes.
    ConfigBlob b;
    b.wifi_ssid = c.wifi_ssid;                 b.wifi_pass = c.wifi_pass;
    b.wifi_ssid_backup = c.wifi_ssid_backup;   b.wifi_pass_backup = c.wifi_pass_backup;
    b.wifi_rollback_active = c.wifi_rollback_active; b.wifi_rolled_back = c.wifi_rolled_back;
    b.mqtt_uri = c.mqtt_uri;   b.mqtt_user = c.mqtt_user;   b.mqtt_pass = c.mqtt_pass;
    b.syslog_host = c.syslog_host; b.syslog_port = c.syslog_port; b.ntp_server = c.ntp_server;
    // Board-local hardware rides the same atomic blob: like the credentials it has exactly ONE
    // writer (the httpd task, POST /set_board), so it needs no self-healing per-key treatment — and
    // being in the blob is what makes "save the indicator pin" all-or-nothing rather than a pin
    // written without its polarity.
    b.led_gpio = c.led_gpio; b.led_type = c.led_type; b.led_inverted = c.led_inverted;
    b.btn_gpio = c.btn_gpio; b.btn_active_low = c.btn_active_low;
    // The OTA channel rides the same blob for the same reason: one writer (POST /set_ota, httpd).
    b.ota_channel = ota_channel_to_int(c.ota_channel);
    const std::vector<uint8_t> blob = config_blob_serialize(b);

    const esp_err_t e = nvs_set_blob("cfg", blob.data(), blob.size());
    if (e != ESP_OK) {
        // The atomic write failed, so the PREVIOUS blob is still intact — nothing net saved. Don't
        // publish RAM; the caller turns `false` into a 500 and skips the reboot.
        diag_printf("config: NVS blob write failed key=cfg err=%s — nothing saved\n", esp_err_to_name(e));
        return false;
    }

    // The X10A LINK cache (RX/TX/proto) stays as separate self-healing keys, NOT in the blob: it has
    // two owners (this path for a manual /set_hp override, and the poll task's config_save_link for a
    // detected pin), and a partial write self-heals on the next detect and is re-validated on load by
    // link_pins_safe. Written AFTER the blob so a link-key hiccup never taints the atomic credential
    // save; the credential/service state is already durably committed by the time we get here.
    bool link_ok = true;
    link_ok &= put_i32("rx_pin", c.rx_pin);
    link_ok &= put_i32("tx_pin", c.tx_pin);
    link_ok &= put_str("proto", std::string(1, static_cast<char>(c.proto)));
    publish(c);   // the atomic blob landed — RAM must reflect the new credential/service state
    if (!link_ok)
        diag_printf("config: link-cache key write failed after the atomic blob save "
                    "(self-heals on the next detect; re-validated on load)\n");
    return link_ok;
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

} // namespace daik
