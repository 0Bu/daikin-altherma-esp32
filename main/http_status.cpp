// GET routes: the web UI (embedded gzip), /status, /values, /models, /diag, /scan.
#include "http_handlers.hpp"
#include "checkup.hpp"
#include "config.hpp"
#include "env3.hpp"
#include "logic/board_pins.hpp"
#include "logic/board_presets.hpp"
#include "logic/chunk_sink.hpp"
#include "logic/env3.hpp"
#include "logic/captive.hpp"
#include "def/model_names.hpp"
#include "def/models_catalog.hpp"
#include "def/homehub.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "def/signatures.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "heap_guard.hpp"
#include "stack_watch.hpp"
#include "history.hpp"
#include "state_dwell.hpp"
#include "hp_poll.hpp"
#include "hp_modbus.hpp"
#include "logic/binary_semantics.hpp"
#include "logic/homehub_map.hpp"
#include "logic/history.hpp"
#include "logic/hp_probe.hpp" // active-profile rows accepted by POST /hp/query
#include "logic/http_cache.hpp"
#include "logic/convert.hpp"   // conv_is_binary — /values marks a bit-flag row from its converter id
#include "logic/discovery.hpp" // ambiguous X10A labels need their existing MQTT page scope in the UI
#include "logic/mqtt_base.hpp"  // mqtt_base_effective — report the base actually published under
#include "logic/mqtt_group.hpp" // is_json_number — keep numeric HomeHub values numeric in /values
#include "logic/crashinfo.hpp"
#include "logic/detect.hpp"
#include "logic/json.hpp"
#include "logic/query_flag.hpp"
#include "logic/reference_temperature.hpp"
#include "logic/weather_forecast.hpp"
#include "weather_forecast.hpp"
#include "logic/redact.hpp"
#include "logic/heartbeat.hpp"   // append_stack_bytes — ONE never-sampled rendering rule
#include "logic/reset_reason.hpp"
#include "logic/timestamp.hpp"
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "ota_update.hpp"
#include "provisioning.hpp"
#include "safe_mode.hpp"
#include "sntp_time.hpp"
#include "wifi.hpp"
#include "syslog.hpp"

#include "esp_log.h"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_partition.h"
#include "esp_core_dump.h"
#include "diag_log.hpp"
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

extern const unsigned char index_html_gz_start[] asm("_binary_index_html_gz_start");
extern const unsigned char index_html_gz_end[]   asm("_binary_index_html_gz_end");
extern const unsigned char setup_html_gz_start[] asm("_binary_setup_html_gz_start");
extern const unsigned char setup_html_gz_end[]   asm("_binary_setup_html_gz_end");
extern const unsigned char favicon_ico_start[]   asm("_binary_favicon_ico_start");
extern const unsigned char favicon_ico_end[]     asm("_binary_favicon_ico_end");
extern const unsigned char heat_pump_icon_png_start[] asm("_binary_heat_pump_icon_png_start");
extern const unsigned char heat_pump_icon_png_end[]   asm("_binary_heat_pump_icon_png_end");

namespace daik {

// Quote a string for JSON via the shared RFC 8259 encoder (logic/json.hpp) — the same one the MQTT
// payloads use. Not a local escaper: /scan echoes SSIDs, i.e. arbitrary bytes chosen by any AP in
// radio range, and a control char in one used to emit unparseable JSON.
static std::string jstr(std::string_view s) { return json_quote(s); }

// The same, for the reporter-identifying values `GET /status?redact=1` withholds. Applied where
// the value is WRITTEN, never as a pass over the finished JSON: this builder runs on the httpd task
// whose stack overflow killed v1.0.12, so a second full-size buffer is exactly what the budget has
// no room for. The KEY is always emitted — an omitted field is indistinguishable from an older
// build that never had it, and "which build produced this?" is the first question a frozen bug
// report has to answer.
// redact_identifier, not redact_or: an UNSET identifier is left empty rather than substituted, so
// "this installation has no HomeHub / no room source / no broker" survives into the report instead of
// being spelled the same way as "it has one and hid it" (logic/redact.hpp carries the reasoning).
static std::string jstr_r(const std::string& s, bool redact) {
    return json_quote(redact_identifier(s, redact));
}

// The validator identifies the exact app image, so any OTA that can change an embedded asset also
// changes the ETag.  The caller adds the resource name because a strong validator must not claim
// that the dashboard, favicon and heat-pump raster are byte-identical representations.
static const char* app_image_sha() {
    static char sha[65] = {0};
    if (sha[0] == '\0') esp_app_get_elf_sha256(sha, sizeof(sha));
    return sha;
}

// Prepare safe revalidation for immutable-in-this-image assets.  `no-cache` means STORE but always
// revalidate: a same-image navigation becomes a tiny 304, while an OTA can never leave the old UI
// fresh under the same URL.  Oversized/malformed request validators fail open to a normal 200 body.
static esp_err_t static_asset_cache(httpd_req_t* req, const char* asset,
                                    char* etag, size_t etag_size, bool& not_modified) {
    not_modified = false;
    snprintf(etag, etag_size, "\"%s-%s\"", app_image_sha(), asset);
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_hdr(req, "ETag", etag);

    char candidate[192] = {0};
    const size_t len = httpd_req_get_hdr_value_len(req, "If-None-Match");
    if (len == 0 || len >= sizeof(candidate) ||
        httpd_req_get_hdr_value_str(req, "If-None-Match", candidate, sizeof(candidate)) != ESP_OK ||
        !http_if_none_match(candidate, etag)) {
        return ESP_OK;
    }

    not_modified = true;
    httpd_resp_set_status(req, "304 Not Modified");
    return httpd_resp_send(req, nullptr, 0);
}

// The boot path owns the provisioning decision. "No stored SSID" is not equivalent to a portal:
// an Ethernet-first boot deliberately keeps the radio and AP off, yet still serves the trusted-LAN
// dashboard. Key the page on the observed, boot-latched recovery surface just like http_server's
// request policy does.
static esp_err_t h_index(httpd_req_t* req) {
    if (provisioning_ap_active())
        return http_send_gzip(req, "text/html", setup_html_gz_start, setup_html_gz_end);
    char etag[80] = {0};
    bool not_modified = false;
    const esp_err_t cache_err = static_asset_cache(req, "dashboard", etag, sizeof(etag), not_modified);
    if (cache_err != ESP_OK || not_modified) return cache_err;
    return http_send_gzip(req, "text/html", index_html_gz_start, index_html_gz_end);
}

static esp_err_t h_favicon(httpd_req_t* req) {
    char etag[80] = {0};
    bool not_modified = false;
    const esp_err_t cache_err = static_asset_cache(req, "favicon", etag, sizeof(etag), not_modified);
    if (cache_err != ESP_OK || not_modified) return cache_err;
    httpd_resp_set_type(req, "image/vnd.microsoft.icon");
    return httpd_resp_send(req, reinterpret_cast<const char*>(favicon_ico_start),
                           favicon_ico_end - favicon_ico_start);
}

static esp_err_t h_heat_pump_icon(httpd_req_t* req) {
    char etag[80] = {0};
    bool not_modified = false;
    const esp_err_t cache_err = static_asset_cache(req, "heat-pump", etag, sizeof(etag), not_modified);
    if (cache_err != ESP_OK || not_modified) return cache_err;
    httpd_resp_set_type(req, "image/png");
    return httpd_resp_send(req, reinterpret_cast<const char*>(heat_pump_icon_png_start),
                           heat_pump_icon_png_end - heat_pump_icon_png_start);
}

// The catch-all ("/*"). In SETUP mode an unmatched GET is an OS connectivity probe far more often
// than it is a person typing a URL, so it gets the 302 every captive-portal agent recognises —
// serving the page with 200 (what this did before) is not a signal iOS/Android/Windows act on, and
// dragged the gzip Content-Encoding onto a probe path walked by minimal HTTP clients, not browsers.
// In STA mode this is the dashboard's SPA shell and must NOT redirect. logic/captive.hpp owns the
// split; both branches are host-tested there.
static esp_err_t h_captive(httpd_req_t* req) {
    if (captive_reply_for(req->uri, provisioning_ap_active()) == CaptiveReply::Page)
        return h_index(req);
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", CAPTIVE_PORTAL_URI);
    // The probe result must not be cached: a phone that once saw this network answer a probe from
    // cache would skip the portal on the next join, which is the same invisible failure again.
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, nullptr, 0);   // empty body — nothing to gzip, nothing to render
}

// A status/values response must never require one body-sized contiguous allocation. The emitter is
// synchronous: esp_http_server consumes each view before returning, so the sink can immediately
// reuse its one bounded buffer. Keep this definition above the status builder so GET /status and
// GET /values instantiate the exact same transport contract.
struct HttpChunkEmitter {
    httpd_req_t* req = nullptr;

    bool operator()(std::string_view bytes, bool final) const {
        if (final) return httpd_resp_send_chunk(req, nullptr, 0) == ESP_OK;
        return httpd_resp_send_chunk(req, bytes.data(), bytes.size()) == ESP_OK;
    }
};
using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 1024>;

// `redact` withholds the reporter-identifying values (logic/redact.hpp) so a snapshot can be
// pasted into a bug report. Defaulted OFF: the dashboard polls this same route and legitimately
// shows the SSID and the broker — only GET /status?redact=1 asks for the scrubbed form.
// No count here on purpose: this file IS the set (every jstr_r below is one member), and stating
// how many would be the sixth restatement of a number that had already drifted in four places.
//
// Runs on ONE task: the httpd worker. It used to run on the poll task too (the /events WebSocket
// broadcaster), and that second runner is what overflowed hp_poll's stack (#241). GET /status now
// instantiates this serializer with a 1 KiB bounded sink: the live payload is already ~8.7 KiB and a
// growing whole-body std::string needed a ~15 KiB contiguous reallocation under OTA/weather TLS,
// making the shared OOM guard return 503. The owning std::string instantiation remains only for the
// MCP get_status envelope, whose outer protocol still owns one response string. This serializer
// still takes ordinary small snapshots and formats temporary strings. If one of those allocations
// fails before the first chunk, the shared guard can return 503; after commit the bounded-stream
// helper returns ESP_FAIL so httpd closes the incomplete response instead of throwing through C.
template <typename JsonOut>
static void append_status_json(JsonOut& j, bool redact) {
    const Config& c = config();
    const BoardPreset* selected_board = board_selected_preset(c);
    HpStats     hp  = hp_stats();
    MqttStatus  m   = mqtt_status();
    ReferenceTemperatureStatus rt = reference_temperature_status();
    CirculationSourceStatus circulation = circulation_source_status();
    const logic::HeatingCurveSnapshot heating_curve = heating_curve_status();
    WeatherForecastStatus wf = weather_forecast_status();
    WifiInfo    wi  = wifi_info();
    j += "{";
    j += "\"version\":" + jstr(esp_app_get_description()->version) + ",";
    j += "\"platform\":" + jstr(CONFIG_IDF_TARGET) + ",";
    j += "\"uptime_s\":" + std::to_string(esp_timer_get_time() / 1000000) + ",";
    // Build identity: the running app's ELF sha (hex) — matches a core dump to the exact firmware
    // that produced it (scripts/decode-coredump.sh), and pairs with last_crash below.
    char elf_sha[65] = {0};
    esp_app_get_elf_sha256(elf_sha, sizeof(elf_sha));
    j += "\"app_elf_sha256\":" + jstr(elf_sha) + ",";
    // GPIOs the UI offers in the RX/TX pin dropdown. A concrete selected board narrows the generic
    // ESP32-S3 chip-safe set to pads its PCB actually exposes; Custom keeps the generic list because
    // only its owner knows that board's headers. In both cases the live reservation removes the
    // status indicator, recovery button and enabled ENV III pair, and Ethernet removes its SPI pads.
    // The same board table and reservations also gate /set_hp below, so the picker cannot advertise
    // a physically absent or already occupied GPIO that the request path would nevertheless accept.
    int pins[BOARD_PINS_MAX];
    const ReservedPins x10a_used = config_reserved_pins(c).plus(net_eth_reserved_pins());
    int npins = selected_board
        ? board_preset_x10a_pins_offerable(selected_board, pins, BOARD_PINS_MAX,
                                            hw_octal_spi(), x10a_used)
        : board_pins_offerable(pins, BOARD_PINS_MAX, hw_octal_spi(), x10a_used);
    j += "\"pins_avail\":[";
    for (int i = 0; i < npins; i++) { if (i) j += ","; j += std::to_string(pins[i]); }
    j += "],";
    // Board-local hardware: what the indicator + recovery button are configured as, plus the pins
    // they MAY be moved to. A separate list from pins_avail — wider by the dedicated-JTAG pads,
    // which are legal for an onboard LED/button but withheld from the X10A picker (board_pins.hpp
    // explains why), and narrower by the X10A link's own rx/tx, which board_hw_valid() refuses for
    // either local pin. That second filter is the mirror of the reservation pins_avail already
    // applies in the other direction. Drives the ESP32 card's hardware rows; /set_board writes them
    // back.
    int lpins[BOARD_LOCAL_PINS_MAX];
    int nlpins = board_pins_local(lpins, BOARD_LOCAL_PINS_MAX, hw_octal_spi(),
                                  config_board_reserved_pins(c).plus(net_eth_reserved_pins()));
    // Appended piece by piece with `+=` rather than as one `a + b + c + …` chain. A chain has to
    // materialise EVERY intermediate std::string at once — each one a live object in this frame — and
    // this function overflowed the httpd task's stack doing exactly that (see http_server.cpp for the
    // measurement and the crash it caused). `+=` holds one temporary at a time and takes a bare string
    // literal with no std::string wrapper at all, so it drops the allocations too. Same shape below
    // for the presets, and worth keeping if this block grows again.
    j += "\"board\":{\"led_gpio\":";  j += std::to_string(c.led_gpio);
    j += ",\"led_type\":";            j += std::to_string(c.led_type);
    j += ",\"led_inverted\":";        j += c.led_inverted ? "true" : "false";
    j += ",\"btn_gpio\":";            j += std::to_string(c.btn_gpio);
    j += ",\"btn_active_low\":";      j += c.btn_active_low ? "true" : "false";
    // Explicit board identity, atomically persisted with the hardware values. `user_set=false`
    // means untouched build defaults; `preset_id=custom` means the user deliberately saved manual
    // hardware. No consumer has to infer Atom/XIAO from pins.
    j += ",\"user_set\":";            j += c.board_user_set ? "true" : "false";
    j += ",\"preset_id\":";           j += jstr(c.board_user_set ? board_preset_key(c.board_preset_id) : "");
    j += ",\"preset_name\":";         j += jstr(selected_board ? selected_board->name : "");
    j += ",\"vendor\":";              j += jstr(board_vendor_name(board_selected_vendor(c)));
    j += ",\"pins_local\":[";
    for (int i = 0; i < nlpins; i++) { if (i) j += ","; j += std::to_string(lpins[i]); }
    // ...and the ready-made settings for the boards this project documents (logic/board_presets.hpp),
    // so the Hardware modal can fill all five fields from one pick instead of asking the user to
    // transcribe pin numbers out of docs/BOARDS.md. Sent HERE rather than from a route of their own
    // because the modal already reads pins_local from this payload: one source, no second fetch to
    // fail, and the presets cannot arrive disagreeing with the pin lists they must fit inside. Two
    // fixed rows (~170 bytes) — bounded, unlike the per-value payloads the heap rules are about.
    const BoardPreset* presets[BOARD_PRESETS_MAX];
    int npre = board_presets_offerable(presets, BOARD_PRESETS_MAX, hw_octal_spi(),
                                       config_board_reserved_pins(c));
    // An explicitly selected board is identity, not a promise that its optional onboard defaults
    // are still enabled. Keep it in the selector even when a customized LED/button or another live
    // reservation means re-applying the factory fields would currently be rejected.
    if (selected_board) {
        bool present = false;
        for (int i = 0; i < npre; ++i) present = present || presets[i] == selected_board;
        if (!present && npre < BOARD_PRESETS_MAX) presets[npre++] = selected_board;
    }
    j += "],\"presets\":[";
    for (int i = 0; i < npre; i++) {
        if (i) j += ",";
        j += "{\"id\":";              j += jstr(presets[i]->key);
        j += ",\"name\":";            j += jstr(presets[i]->name);
        j += ",\"vendor\":";          j += jstr(board_vendor_name(presets[i]->vendor));
        j += ",\"led_gpio\":";        j += std::to_string(presets[i]->led_gpio);
        j += ",\"led_type\":";        j += std::to_string(presets[i]->led_type);
        j += ",\"led_inverted\":";    j += presets[i]->led_inverted ? "true" : "false";
        j += ",\"btn_gpio\":";        j += std::to_string(presets[i]->btn_gpio);
        j += ",\"btn_active_low\":";  j += presets[i]->btn_active_low ? "true" : "false";
        // Candidate pins are board-specific and filtered by the live X10A link. The browser applies
        // the pending LED/button reservations because those can change before this atomic form is
        // submitted. AtomS3 Lite therefore exposes exactly 1/2/5/6/7/8/38; GPIO39 and chip-only
        // pads stay unavailable for ENV III.
        int bipins[BOARD_I2C_PINS_MAX];
        const int nbipins = board_preset_i2c_pins_offerable(
            presets[i], bipins, BOARD_I2C_PINS_MAX, hw_octal_spi(), config_link_pins(c).plus(net_eth_reserved_pins()));
        j += ",\"i2c_pins\":[";
        for (int k = 0; k < nbipins; ++k) { if (k) j += ","; j += std::to_string(bipins[k]); }
        j += "]";
        j += "}";
    }
    j += "]},";
    // Independent outdoor-climate observation. These values do not replace the Daikin R1T source:
    // only fresh, whole ENV III samples are exposed as numbers, while stale/error state stays
    // explicit. The integrated Board Hardware form may select AtomS3 Lite and ENV III in the same
    // atomic save, so candidate I2C pins are available even while the currently persisted board is
    // Custom/Seeed. They exclude the live X10A pair here; the browser filters its pending LED/button
    // choices and the request path validates the complete proposed snapshot authoritatively.
    const bool env_supported = env3_board_supported(c);
    const bool env_enabled = env_supported && c.env3_enabled;
    const Env3Status env = env3_status();
    int epins[BOARD_I2C_PINS_MAX];
    const int nepins = board_preset_i2c_pins_offerable(
        selected_board, epins, BOARD_I2C_PINS_MAX, hw_octal_spi(), config_link_pins(c).plus(net_eth_reserved_pins()));
    const Env3Preset* epresets[ENV3_PRESETS_MAX];
    const int nepre = env3_presets_offerable(epresets, ENV3_PRESETS_MAX, selected_board, hw_octal_spi(),
                                             config_link_pins(c).plus(net_eth_reserved_pins()));
    const bool env_fresh = env_enabled && env.fresh;
    char env_temp[24] = {0}, env_hum[24] = {0}, env_press[24] = {0};
    if (env_fresh) {
        std::snprintf(env_temp, sizeof(env_temp), "%.2f", env.temperature_c);
        std::snprintf(env_hum, sizeof(env_hum), "%.2f", env.humidity_pct);
        std::snprintf(env_press, sizeof(env_press), "%.2f", env.pressure_hpa);
    }
    j += "\"env3\":{\"type\":\"env_iii\",\"supported\":";
    j += env_supported ? "true" : "false";
    j += ",\"enabled\":"; j += env_enabled ? "true" : "false";
    j += ",\"sda\":"; j += std::to_string(c.env3_sda);
    j += ",\"scl\":"; j += std::to_string(c.env3_scl);
    j += ",\"connected\":"; j += env_enabled && env.connected ? "true" : "false";
    j += ",\"fresh\":"; j += env_fresh ? "true" : "false";
    j += ",\"age_s\":"; j += env_enabled && env.samples ? std::to_string(env.age_s) : "null";
    j += ",\"temperature_c\":"; j += env_fresh ? env_temp : "null";
    j += ",\"humidity_pct\":"; j += env_fresh ? env_hum : "null";
    j += ",\"pressure_hpa\":"; j += env_fresh ? env_press : "null";
    j += ",\"error\":";
    j += jstr(!env_supported ? "unsupported_board" : env_enabled ? env.error : "disabled");
    j += ",\"samples\":"; j += std::to_string(env.samples);
    j += ",\"errors\":"; j += std::to_string(env.errors);
    j += ",\"pins_avail\":[";
    for (int i = 0; i < nepins; ++i) { if (i) j += ","; j += std::to_string(epins[i]); }
    j += "],\"presets\":[";
    for (int i = 0; i < nepre; ++i) {
        if (i) j += ",";
        j += "{\"name\":"; j += jstr(epresets[i]->name);
        j += ",\"sda\":"; j += std::to_string(epresets[i]->sda);
        j += ",\"scl\":"; j += std::to_string(epresets[i]->scl); j += "}";
    }
    j += "]},";
    char bssid_str[18] = {0};
    char mac_str[18] = {0};
    if (wi.connected) {
        snprintf(bssid_str, sizeof(bssid_str), "%02X:%02X:%02X:%02X:%02X:%02X",
                 wi.bssid[0], wi.bssid[1], wi.bssid[2], wi.bssid[3], wi.bssid[4], wi.bssid[5]);
    }
    snprintf(mac_str, sizeof(mac_str), "%02X:%02X:%02X:%02X:%02X:%02X",
             wi.mac[0], wi.mac[1], wi.mac[2], wi.mac[3], wi.mac[4], wi.mac[5]);
    j += "\"wifi\":{\"ssid\":" + jstr_r(c.wifi_ssid, redact) + ",\"ip\":" + jstr_r(wi.ip, redact) +
         ",\"rssi\":" + (wi.connected ? std::to_string(wi.rssi) : "null") +
         ",\"connected\":" + (wi.connected ? "true" : "false") +
         ",\"bssid\":" + (wi.connected ? jstr_r(bssid_str, redact) : "null") +
         ",\"mac\":" + jstr_r(mac_str, redact) +
         ",\"std\":" + (wi.connected ? jstr(wi.std) : "null") +
         // The last credential change was undone (wifi.cpp restored the previous network). Sticky
         // until the next POST /set_wifi, because a rollback leaves no other trace: the reboot it
         // takes wipes the diag ring and the card just shows the old SSID again. The dashboard does
         // not render this yet (a banner lands with the web-UI write-feedback work, PR #65) — for
         // now it is the API's answer to "did my save actually stick?".
         ",\"rolled_back\":" + std::string(c.wifi_rolled_back ? "true" : "false") + "},";
    // WHICH TRANSPORT carries the device, and what the optional wire is doing. A separate block
    // from "wifi" rather than a widening of it, because the two describe different hardware and a
    // reader must be able to tell "no radio configured" from "no radio because there is a cable":
    // on a wired board the wifi block above is entirely honest — not connected, no RSSI, no BSSID —
    // and would be indistinguishable from a broken install without this.
    //
    // `ip` is the ACTIVE transport's address, so a client has one field to read instead of a rule
    // to re-derive; it is empty (never a stale one) while nothing holds a lease. `eth.supported`
    // says whether this BUILD carries the driver at all, which is what lets the UI hide the row
    // rather than show a permanently absent feature — the modbus_rows/env3_rows rule applied to a
    // transport. The pins are reported even with no controller present, since "where would it go"
    // is the question docs/BOARDS.md answers and the one a user wiring one asks.
    const EthInfo eth = net_eth_info();
    const EthPins eth_pins = net_eth_pins();
    char eth_mac_str[18] = {0};
    if (eth.present)
        snprintf(eth_mac_str, sizeof(eth_mac_str), "%02X:%02X:%02X:%02X:%02X:%02X",
                 eth.mac[0], eth.mac[1], eth.mac[2], eth.mac[3], eth.mac[4], eth.mac[5]);
    const NetLink kind = net_kind();
    j += "\"net\":{\"kind\":";  j += jstr(net_link_str(kind));
    j += ",\"ip\":";            j += jstr_r(kind == NetLink::Eth ? eth.ip
                                          : kind == NetLink::Wifi ? wi.ip : "", redact);
    j += ",\"eth\":{\"supported\":"; j += net_eth_pins_valid(eth_pins) ? "true" : "false";
    j += ",\"present\":";       j += eth.present ? "true" : "false";
    j += ",\"link\":";          j += eth.link ? "true" : "false";
    j += ",\"lease\":";         j += eth.lease ? "true" : "false";
    j += ",\"ip\":";            j += jstr_r(eth.ip, redact);
    j += ",\"mac\":";           j += eth.present ? jstr_r(eth_mac_str, redact) : "null";
    // Speed/duplex are the PHY's, so they mean something only while a cable is negotiated; null
    // rather than a plausible-looking 10/half on an unplugged port.
    j += ",\"speed_mbps\":";    j += eth.link ? std::to_string(eth.speed_mbps) : "null";
    j += ",\"full_duplex\":";   j += eth.link ? (eth.full_duplex ? "true" : "false") : "null";
    j += ",\"pins\":{\"sclk\":"; j += std::to_string(eth_pins.sclk);
    j += ",\"cs\":";            j += std::to_string(eth_pins.cs);
    j += ",\"miso\":";          j += std::to_string(eth_pins.miso);
    j += ",\"mosi\":";          j += std::to_string(eth_pins.mosi);
    j += "}}},";
    // has_creds says only WHETHER credentials are stored — never what they are (/status stays
    // secret-free). Read from the CONFIG, not from MqttStatus: creds outlive a disabled broker, and
    // that is exactly the state the UI must offer to clear. It drives the MQTT modal's "remove
    // stored credentials" checkbox, which is the only way to reach /set_mqtt's clear_creds.
    j += "\"mqtt\":{\"configured\":" + std::string(m.configured ? "true" : "false") +
         ",\"connected\":" + (m.connected ? "true" : "false") +
         ",\"tls\":" + (m.tls ? "true" : "false") +
         ",\"has_creds\":" + ((!c.mqtt_user.empty() || !c.mqtt_pass.empty()) ? "true" : "false") +
         ",\"broker\":" + jstr_r(m.broker, redact) + (m.error.empty() ? "" : ",\"error\":" + jstr(m.error));
    // The installation's base topic, ALWAYS the effective one — the empty stored value means "the
    // compile-time default" (logic/mqtt_base.hpp), and reporting "" would make a default device look
    // unconfigured to the modal that has to prefill this field. `base_custom` is the separate fact:
    // whether the user has stated a base, which is what the UI needs to know before offering Reset.
    // Redacted like reference_temperature.name and for the same reason — it is a word the user typed,
    // and it becomes this installation's Home Assistant device id.
    j += ",\"base\":" + jstr_r(mqtt_base_effective(c.mqtt_base, CONFIG_DAIKIN_MQTT_BASE_TOPIC), redact) +
         ",\"base_custom\":" + std::string(c.mqtt_base.empty() ? "false" : "true") + "},";
    // One exact MQTT-backed living-room source. Freshness and canonical eligibility remain separate:
    // a disabled thermostat may still expose a trustworthy temperature but cannot emit room_error_k.
    const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    const uint64_t ref_age_s = rt.has_value && now_ms >= rt.received_ms
                             ? (now_ms - rt.received_ms) / 1000 : 0;
    int64_t now_unix_s = -1;
    int32_t now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    ReferenceFreshness freshness = reference_freshness(rt.has_value, rt.retained,
        rt.has_source_time, rt.source_unix_s, rt.received_ms, now_unix_s, now_ms,
        c.ref_temp_max_age_s);
    ReferenceRoomRaw room_raw;
    room_raw.configured = !c.ref_temp_topic.empty();
    room_raw.has_temperature = rt.has_value;
    room_raw.payload_valid = rt.error.empty();
    room_raw.temperature_c = rt.temperature_c;
    room_raw.has_source_time = rt.has_source_time;
    room_raw.setpoint_mapped = c.ref_temp_fixed_setpoint_tenths != 0 ||
                               !c.ref_temp_setpoint_topic.empty() ||
                               !c.ref_temp_setpoint_path.empty();
    room_raw.has_setpoint = rt.has_setpoint;
    room_raw.setpoint_c = rt.setpoint_c;
    room_raw.enabled_mapped = !c.ref_temp_enabled_path.empty();
    room_raw.has_enabled = rt.has_enabled;
    room_raw.enabled = rt.enabled;
    room_raw.hvac_mode_mapped = !c.ref_temp_hvac_mode_path.empty();
    room_raw.has_hvac_mode = rt.has_hvac_mode;
    room_raw.hvac_mode = rt.hvac_mode;
    room_raw.payload_reason = rt.rejection_reason;
    const ReferenceRoomSample room = reference_room_sample(room_raw, freshness);
    if (!rt.error.empty()) { freshness.fresh = false; freshness.reason = "invalid"; }
    char ref_value[32] = {0};
    if (rt.has_value) std::snprintf(ref_value, sizeof(ref_value), "%.6g", rt.temperature_c);
    char ref_setpoint[32] = {0};
    if (rt.has_setpoint) std::snprintf(ref_setpoint, sizeof(ref_setpoint), "%.6g", rt.setpoint_c);
    char ref_error_k[32] = {0};
    if (room.has_room_error) std::snprintf(ref_error_k, sizeof(ref_error_k), "%.6g", room.room_error_k);
    j += "\"reference_temperature\":{\"configured\":";
    j += c.ref_temp_topic.empty() ? "false" : "true";
    j += ",\"name\":";          j += jstr_r(c.ref_temp_name, redact);
    j += ",\"topic\":";         j += jstr_r(c.ref_temp_topic, redact);
    j += ",\"temperature_path\":"; j += jstr_r(c.ref_temp_path, redact);
    j += ",\"setpoint_topic\":"; j += jstr_r(c.ref_temp_setpoint_topic, redact);
    j += ",\"setpoint_path\":"; j += jstr_r(c.ref_temp_setpoint_path, redact);
    j += ",\"fixed_setpoint_c\":";
    if (c.ref_temp_fixed_setpoint_tenths == 0) j += "null";
    else {
        char fixed_setpoint[16];
        std::snprintf(fixed_setpoint, sizeof(fixed_setpoint), "%.1f",
                      static_cast<double>(c.ref_temp_fixed_setpoint_tenths) / 10.0);
        j += fixed_setpoint;
    }
    j += ",\"timestamp_topic\":"; j += jstr_r(c.ref_temp_time_topic, redact);
    j += ",\"timestamp_path\":"; j += jstr_r(c.ref_temp_time_path, redact);
    j += ",\"enabled_path\":"; j += jstr_r(c.ref_temp_enabled_path, redact);
    j += ",\"hvac_mode_path\":"; j += jstr_r(c.ref_temp_hvac_mode_path, redact);
    j += ",\"source_id\":\""; j += REF_ROOM_SOURCE_ID; j += "\"";
    j += ",\"calibration_k\":0";
    j += ",\"temperature_min_c\":"; j += std::to_string(REF_ROOM_TEMPERATURE_MIN_C);
    j += ",\"temperature_max_c\":"; j += std::to_string(REF_ROOM_TEMPERATURE_MAX_C);
    j += ",\"max_age_s\":";     j += std::to_string(c.ref_temp_max_age_s);
    j += ",\"subscribed\":";    j += rt.subscribed ? "true" : "false";
    j += ",\"has_value\":";     j += rt.has_value ? "true" : "false";
    j += ",\"temperature_c\":"; j += rt.has_value ? ref_value : "null";
    j += ",\"has_setpoint\":"; j += rt.has_setpoint ? "true" : "false";
    j += ",\"setpoint_c\":"; j += rt.has_setpoint ? ref_setpoint : "null";
    j += ",\"enabled\":"; j += rt.has_enabled ? (rt.enabled ? "true" : "false") : "null";
    j += ",\"hvac_mode\":"; j += rt.has_hvac_mode ? jstr(rt.hvac_mode) : "null";
    j += ",\"received_at\":";
    j += rt.has_value && rt.received_unix_s >= 0 ? jstr(rfc3339_utc(rt.received_unix_s)) : "null";
    j += ",\"received_ago_s\":"; j += rt.has_value ? std::to_string(ref_age_s) : "null";
    j += ",\"source_at\":";
    j += rt.has_value && rt.has_source_time ? jstr(rfc3339_utc(rt.source_unix_s)) : "null";
    j += ",\"source_unix_s\":";
    j += rt.has_value && rt.has_source_time ? std::to_string(rt.source_unix_s) : "null";
    j += ",\"timestamp_source\":"; j += rt.has_value ? jstr(rt.timestamp_source) : "null";
    j += ",\"age_s\":";         j += freshness.age_known ? std::to_string(freshness.age_s) : "null";
    j += ",\"fresh\":";         j += freshness.fresh ? "true" : "false";
    j += ",\"freshness_reason\":"; j += jstr(freshness.reason);
    j += ",\"temperature_valid\":"; j += room.temperature_valid ? "true" : "false";
    j += ",\"setpoint_valid\":"; j += room.setpoint_valid ? "true" : "false";
    j += ",\"control_eligible\":"; j += room.control_eligible ? "true" : "false";
    j += ",\"room_error_k\":"; j += room.has_room_error ? ref_error_k : "null";
    j += ",\"reason\":"; j += jstr(reference_room_reason_name(room.reason));
    j += ",\"reason_code\":"; j += std::to_string(static_cast<unsigned>(room.reason));
    j += ",\"retained\":";      j += rt.has_value && rt.retained ? "true" : "false";
    j += ",\"messages\":";      j += std::to_string(rt.messages);
    j += ",\"errors\":";        j += std::to_string(rt.errors);
    j += ",\"rejections\":";    j += std::to_string(rt.rejections);
    if (!rt.eligibility_error.empty()) { j += ",\"eligibility_error\":"; j += jstr(rt.eligibility_error); }
    if (!rt.error.empty()) { j += ",\"error\":"; j += jstr(rt.error); }
    j += "},";
    // Heating-curve diagnosis v2: raw room error sampled only in confirmed HEATING operation. The
    // absolute timestamp + monotonic sequence is the durable event contract; no actuator-derived
    // P/quantized/bounded/requested-offset vocabulary remains.
    // `armed` is the CONFIGURATION's answer (are room mapping + HomeHub saved), while state/reason come from a
    // snapshot the MQTT publish task owns. Those two can disagree, and only in one direction: with no
    // broker configured, or in safe mode, that task is never created, so the snapshot stays
    // default-constructed at Off/Disabled while armed reads true. Published raw, that was a payload
    // contradicting itself — and "disabled" is the evaluator's word for "no room source is mapped",
    // which is exactly what the reader has already done. logic/heating_curve_diagnosis.hpp names the
    // situation instead (host-tested), so the state stays honestly `off` while the reason says the
    // sampler is not running.
    const bool heating_curve_armed = heating_curve_diagnosis_armed(c);
    const logic::HeatingCurveReason heating_curve_reason = logic::heating_curve_reported_reason(
        heating_curve_armed, heating_curve.state, heating_curve.reason);
    j += "\"heating_curve\":{\"method_version\":";
    j += std::to_string(logic::HEATING_CURVE_DIAGNOSIS_METHOD_VERSION);
    j += ",\"armed\":"; j += heating_curve_armed ? "true" : "false";
    j += ",\"state\":\""; j += logic::heating_curve_state_name(heating_curve.state); j += "\"";
    j += ",\"state_code\":"; j += std::to_string(static_cast<unsigned>(heating_curve.state));
    j += ",\"reason\":\""; j += logic::heating_curve_reason_name(heating_curve_reason); j += "\"";
    j += ",\"reason_code\":"; j += std::to_string(static_cast<unsigned>(heating_curve_reason));
    j += ",\"sample_eligible\":"; j += heating_curve.sample_eligible ? "true" : "false";
    j += ",\"current_room_error_k\":";
    j += heating_curve.has_current_room_error
       ? std::to_string(heating_curve.current_room_error_k) : "null";
    j += ",\"last_sample_room_error_k\":";
    j += heating_curve.has_last_sample
       ? std::to_string(heating_curve.last_sample_room_error_k) : "null";
    j += ",\"last_sample_unix_s\":";
    j += heating_curve.has_last_sample ? std::to_string(heating_curve.last_sample_unix_s) : "null";
    j += ",\"outdoor_temperature_c\":";
    j += heating_curve.has_outdoor_temperature
       ? std::to_string(heating_curve.outdoor_temperature_c) : "null";
    j += ",\"outdoor_source\":";
    j += heating_curve.has_outdoor_temperature
       ? jstr(logic::outdoor_source_name(heating_curve.outdoor_source)) : "null";
    j += ",\"last_sample_outdoor_temperature_c\":";
    j += heating_curve.has_last_sample_outdoor
       ? std::to_string(heating_curve.last_sample_outdoor_temperature_c) : "null";
    j += ",\"last_sample_outdoor_source\":";
    j += heating_curve.has_last_sample_outdoor
       ? jstr(logic::outdoor_source_name(heating_curve.last_sample_outdoor_source)) : "null";
    j += ",\"plant_outdoor_temperature_c\":";
    j += heating_curve.has_plant_outdoor_temperature
       ? std::to_string(heating_curve.plant_outdoor_temperature_c) : "null";
    j += ",\"plant_outdoor_source\":";
    j += heating_curve.has_plant_outdoor_temperature
       ? jstr(logic::outdoor_source_name(heating_curve.plant_outdoor_source)) : "null";
    j += ",\"last_sample_plant_outdoor_temperature_c\":";
    j += heating_curve.has_last_sample_plant_outdoor
       ? std::to_string(heating_curve.last_sample_plant_outdoor_temperature_c) : "null";
    j += ",\"last_sample_plant_outdoor_source\":";
    j += heating_curve.has_last_sample_plant_outdoor
       ? jstr(logic::outdoor_source_name(heating_curve.last_sample_plant_outdoor_source)) : "null";
    j += ",\"forecast_available\":"; j += heating_curve.forecast_available ? "true" : "false";
    j += ",\"plant_gate_known\":"; j += heating_curve.plant_gate_known ? "true" : "false";
    j += ",\"plant_gate_active\":"; j += heating_curve.plant_gate_active ? "true" : "false";
    j += ",\"heating_mode_known\":"; j += heating_curve.heating_mode_known ? "true" : "false";
    j += ",\"heating_mode_active\":"; j += heating_curve.heating_mode_active ? "true" : "false";
    j += ",\"room_source_unix_s\":";
    j += heating_curve.room_has_source_time ? std::to_string(heating_curve.room_source_unix_s) : "null";
    j += ",\"room_age_s\":";
    j += heating_curve.room_age_known ? std::to_string(heating_curve.room_age_s) : "null";
    j += ",\"sequence\":"; j += std::to_string(heating_curve.sequence);
    j += ",\"evaluations\":"; j += std::to_string(heating_curve.evaluations);
    j += ",\"samples\":"; j += std::to_string(heating_curve.samples);
    j += ",\"holds\":"; j += std::to_string(heating_curve.holds);
    j += ",\"blocks\":"; j += std::to_string(heating_curve.blocks);
    j += "},";
    // Independent electrical witness for the potable-water circulation pump. Topic/name are
    // identifying installation data and therefore follow the same redaction boundary as the room
    // source. Power and source-time remain non-secret diagnostic evidence.
    char circulation_power[32] = {0};
    if (circulation.has_value)
        std::snprintf(circulation_power, sizeof(circulation_power), "%.6g", circulation.power_w);
    auto tenths_w_text = [](uint16_t value) {
        char out[24];
        std::snprintf(out, sizeof(out), "%u.%u", static_cast<unsigned>(value / 10),
                      static_cast<unsigned>(value % 10));
        return std::string(out);
    };
    j += "\"circulation_source\":{\"configured\":";
    j += c.circulation_topic.empty() ? "false" : "true";
    j += ",\"name\":"; j += jstr_r(c.circulation_name, redact);
    j += ",\"topic\":"; j += jstr_r(c.circulation_topic, redact);
    j += ",\"power_path\":"; j += jstr_r(c.circulation_power_path, redact);
    j += ",\"timestamp_path\":"; j += jstr_r(c.circulation_time_path, redact);
    j += ",\"max_age_s\":"; j += std::to_string(c.circulation_max_age_s);
    j += ",\"on_threshold_w\":"; j += tenths_w_text(c.circulation_on_tenths_w);
    j += ",\"off_threshold_w\":"; j += tenths_w_text(c.circulation_off_tenths_w);
    j += ",\"confirm_s\":"; j += std::to_string(c.circulation_confirm_s);
    j += ",\"subscribed\":"; j += circulation.subscribed ? "true" : "false";
    j += ",\"has_value\":"; j += circulation.has_value ? "true" : "false";
    j += ",\"power_w\":"; j += circulation.has_value ? circulation_power : "null";
    j += ",\"state\":"; j += jstr(circulation_power_state_name(circulation.state));
    j += ",\"source_at\":";
    j += circulation.has_value && circulation.has_source_time
        ? jstr(rfc3339_utc(circulation.source_unix_s)) : "null";
    j += ",\"source_unix_s\":";
    j += circulation.has_value && circulation.has_source_time
        ? std::to_string(circulation.source_unix_s) : "null";
    j += ",\"timestamp_source\":";
    j += circulation.has_value ? jstr(circulation.timestamp_source) : "null";
    j += ",\"age_s\":";
    j += circulation.age_known ? std::to_string(circulation.age_s) : "null";
    j += ",\"fresh\":"; j += circulation.fresh ? "true" : "false";
    j += ",\"freshness_reason\":"; j += jstr(circulation.freshness_reason);
    j += ",\"retained\":";
    j += circulation.has_value && circulation.retained ? "true" : "false";
    j += ",\"messages\":"; j += std::to_string(circulation.messages);
    j += ",\"errors\":"; j += std::to_string(circulation.errors);
    j += ",\"rejections\":"; j += std::to_string(circulation.rejections);
    if (!circulation.error.empty()) { j += ",\"error\":"; j += jstr(circulation.error); }
    j += "},";
    // Direct Open-Meteo forecast. Fetch time is the 90-minute liveness clock; the provider does not
    // expose model-run issue time, so issued_at remains null instead of being fabricated. Failed
    // refreshes retain the last numbers for diagnosis but set available/fresh false.
    const bool weather_configured = c.weather_enabled;
    const bool weather_has_value = weather_configured && wf.has_value;
    WeatherFreshness weather = weather_freshness(
        weather_has_value, wf.fetched_unix_s, now_unix_s, WEATHER_MAX_AGE_S);
    if (!wf.available) { weather.fresh = false; weather.reason = wf.reason.empty() ? "unavailable" : wf.reason.c_str(); }
    if (!weather_configured) { weather.fresh = false; weather.reason = "not_configured"; }
    const bool weather_available = weather_configured && wf.available && weather.fresh;
    const bool weather_fetching = weather_configured && wf.fetching;
    const std::string weather_latitude = weather_configured
            ? weather_coordinate_format_e6(c.weather_latitude_e6) : std::string();
    const std::string weather_longitude = weather_configured
            ? weather_coordinate_format_e6(c.weather_longitude_e6) : std::string();
    char weather_outdoor[32] = {0}, weather_solar[32] = {0};
    if (wf.has_value) {
        std::snprintf(weather_outdoor, sizeof(weather_outdoor), "%.6g", wf.outdoor_mean_2h_c);
        std::snprintf(weather_solar, sizeof(weather_solar), "%.6g", wf.solar_energy_2h_wh_m2);
    }
    j += "\"weather_forecast\":{\"configured\":";
    j += weather_configured ? "true" : "false";
    j += ",\"provider\":\"open-meteo\"";
    j += ",\"model\":"; j += jstr(wf.model);
    j += ",\"fetch_interval_s\":"; j += std::to_string(WEATHER_FETCH_INTERVAL_S);
    j += ",\"max_age_s\":"; j += std::to_string(WEATHER_MAX_AGE_S);
    j += ",\"fetching\":"; j += weather_fetching ? "true" : "false";
    j += ",\"available\":"; j += weather_available ? "true" : "false";
    j += ",\"has_value\":"; j += weather_has_value ? "true" : "false";
    j += ",\"latitude\":"; j += weather_latitude.empty() ? "null" : jstr_r(weather_latitude, redact);
    j += ",\"longitude\":"; j += weather_longitude.empty() ? "null" : jstr_r(weather_longitude, redact);
    j += ",\"state\":";
    j += jstr(!weather_configured ? "disabled" : (safe_mode_active() ? "waiting" : wf.state));
    j += ",\"outdoor_mean_2h_c\":"; j += weather_has_value ? weather_outdoor : "null";
    j += ",\"solar_energy_2h_wh_m2\":"; j += weather_has_value ? weather_solar : "null";
    j += ",\"hourly\":[";
    if (weather_has_value) {
        const size_t count = std::min(wf.hourly_count, WEATHER_HOURLY_CAP);
        for (size_t i = 0; i < count; ++i) {
            if (i) j += ',';
            char temperature[32] = {0}, humidity[32] = {0}, pressure[32] = {0};
            std::snprintf(temperature, sizeof(temperature), "%.6g", wf.hourly_temperature_c[i]);
            std::snprintf(humidity, sizeof(humidity), "%.6g", wf.hourly_humidity_pct[i]);
            std::snprintf(pressure, sizeof(pressure), "%.6g", wf.hourly_pressure_hpa[i]);
            j += "{\"time_unix_s\":"; j += std::to_string(wf.hourly_unix_s[i]);
            j += ",\"temperature_c\":"; j += temperature;
            j += ",\"humidity_pct\":"; j += humidity;
            j += ",\"pressure_hpa\":"; j += pressure;
            j += '}';
        }
    }
    j += ']';
    j += ",\"issued_at\":";
    j += weather_has_value && wf.issued_unix_s >= 0 ? jstr(rfc3339_utc(wf.issued_unix_s)) : "null";
    j += ",\"fetched_at\":";
    j += weather_has_value ? jstr(rfc3339_utc(wf.fetched_unix_s)) : "null";
    j += ",\"valid_for_decision_at\":";
    j += weather_has_value ? jstr(rfc3339_utc(wf.decision_unix_s)) : "null";
    j += ",\"last_attempt_at\":";
    j += wf.last_attempt_unix_s >= 0 ? jstr(rfc3339_utc(wf.last_attempt_unix_s)) : "null";
    j += ",\"age_s\":"; j += weather.age_known ? std::to_string(weather.age_s) : "null";
    j += ",\"fresh\":"; j += weather.fresh ? "true" : "false";
    j += ",\"freshness_reason\":"; j += jstr(weather.reason);
    j += ",\"successes\":"; j += std::to_string(wf.successes);
    j += ",\"errors\":"; j += std::to_string(wf.errors);
    if (!weather_configured) { j += ",\"reason\":\"not_configured\""; }
    else if (safe_mode_active()) { j += ",\"reason\":\"safe_mode\""; }
    else if (!wf.reason.empty()) { j += ",\"reason\":"; j += jstr(wf.reason); }
    if (!wf.error.empty()) { j += ",\"error\":"; j += jstr(wf.error); }
    j += "},";
    SyslogStatus sy = syslog_status();
    j += "\"syslog\":{\"configured\":" + std::string(sy.configured ? "true" : "false") +
         ",\"resolved\":" + (sy.resolved ? "true" : "false") +
         ",\"reachable\":" + (sy.reachable ? "true" : "false") +
         ",\"host\":" + jstr_r(sy.host, redact) +
         ",\"port\":" + std::to_string(sy.port) +
         (sy.error.empty() ? "" : ",\"error\":" + jstr(sy.error)) + "},";
    j += "\"hp\":{\"proto\":" + jstr(std::string(1, static_cast<char>(c.proto))) +
         ",\"rx\":" + std::to_string(c.rx_pin) + ",\"tx\":" + std::to_string(c.tx_pin) +
         ",\"connected\":" + (hp.connected ? "true" : "false") +
         ",\"last_ok_s\":" + std::to_string(hp.last_ok_s) +
         ",\"registers\":" + std::to_string(hp.registers) +
         ",\"values\":" + std::to_string(hp.values) +
         ",\"crc_err\":" + std::to_string(hp.crc_err) +
         ",\"timeout_err\":" + std::to_string(hp.timeout_err) + "},";
    j += "\"profile\":{\"id\":" + jstr(c.profile) + "},";

    // The HomeHub Modbus stack — a SECOND, INDEPENDENT source, never an alternative to the X10A link
    // reported above (docs/MODBUS_PROTOCOL.md). `enabled` reports whether its runtime task exists;
    // `host` is the active target; empty after `searched:true` means persistently disabled. Manual
    // discovery is request-local and never appears here as a runtime mode. The link is READ-ONLY:
    // there is no actuator object and no actuation flag, because the write path was removed (#294).
    // Successive += with bare literals — the httpd-stack rule the rest of this builder follows.
    const ModbusStatus mb = mb_status();
    j += "\"modbus\":{\"enabled\":";  j += mb.enabled ? "true" : "false";
    j += ",\"connected\":";            j += mb.connected ? "true" : "false";
    j += ",\"discovering\":";          j += mb.discovering ? "true" : "false";
    j += ",\"searched\":";             j += c.mb_discovery_done ? "true" : "false";
    // The ADDRESS comes from the CONFIG, the STATE from the live link.
    // Reading the address off the link status was wrong before the first connect ever succeeded:
    // ModbusStatus is zero-initialised, so a device that had never dialled reported port 0 and unit
    // id 0 — settings it would itself REJECT — which the UI then prefilled into its editor.
    j += ",\"host\":";                 j += jstr_r(config_modbus_host(c), redact);
    j += ",\"port\":";                 j += std::to_string(c.mb_port);
    j += ",\"unit_id\":";              j += std::to_string(c.mb_unit_id);
    j += ",\"rx\":";                   j += std::to_string(mb.rx_ok);
    j += ",\"fails\":";                j += std::to_string(mb.rx_fail);
    j += ",\"values\":";               j += std::to_string(mb.values);
    // The Modbus task's stack headroom, from the one sampler all four watched stacks report
    // through (stack_watch.hpp) rather than from ModbusStatus, so this surface and the MQTT
    // heartbeat cannot answer the same question with two numbers. Null, not 0, when the task has
    // never run: a board with no HomeHub has no such stack, and "0 words free" is a reading.
    j += ",\"task_stack_min_free_bytes\":";
    {
        const uint32_t words = stack_watch_min_free_bytes(StackWatch::Modbus);
        if (words == 0) j += "null"; else j += std::to_string(words);
    }
    // The PLANT GATE (input register 53) is the one HomeHub fact the shadow controller consumes, so
    // it is reported here beside the link it comes from. `known` false means the register did not
    // answer or answered a sentinel — never read that as an inactive plant.
    j += ",\"plant_gate_known\":";  j += mb.plant_gate_known ? "true" : "false";
    j += ",\"plant_gate_active\":"; j += mb.plant_gate_active ? "true" : "false";
    j += ",\"heating_mode_known\":";  j += mb.heating_mode_known ? "true" : "false";
    j += ",\"heating_mode_active\":"; j += mb.heating_mode_active ? "true" : "false";
    if (!mb.last_error.empty()) {
        // `error` remains the complete English /diag + Syslog wording for API compatibility and
        // fallback clients. The structured companions let the web UI localise it without parsing
        // prose, while preserving errno/exception/parser detail and the exact EKRHH register.
        j += ",\"error\":";      j += jstr(mb.last_error);
        j += ",\"error_code\":"; j += jstr(mb.last_error_code);
        if (mb.last_error_detail >= 0) {
            j += ",\"error_detail\":"; j += std::to_string(mb.last_error_detail);
        }
        if (mb.last_error_register > 0) {
            j += ",\"error_register\":"; j += std::to_string(mb.last_error_register);
        }
    }
    j += "},";

    // Which rows carry a 24-hour trend, and at what cadence. The ID is the CONCEPT (GET /history
    // takes it); the LABEL is how the detected profile spells that row, which is what lets the UI
    // attach a trend to the value row it is already rendering. Rows the profile does not carry are
    // omitted entirely — an absent feature is stated by its absence, not by an empty chart. Built
    // with successive += like everything else here: a `a + b + c` chain materialises every
    // intermediate at once, all live in one frame on the httpd task's stack (AGENTS.md → Memory,
    // concurrency, and HTTP safety; the v1.0.12 stack overflow happened on THIS task).
    j += "\"history\":{\"dt\":" + std::to_string(logic::HISTORY_DT_S);
    // How this boot's rings came to be. "accept" = adopted across a reset that kept power; anything
    // else NAMES why they started empty. Reported because a chart that emptied itself otherwise
    // reads as a defect: "wrong_catalog" after an update and "power_cycle" after a power failure are
    // both correct behaviour, and only the device can tell which one happened.
    j += ",\"persist\":";
    j += jstr(history_persist_state());
    // The same question for the per-row STATE AGES (logic/state_dwell.hpp), which ride the same
    // .noinit medium under the same rules and therefore reset for the same reasons. It sits here
    // rather than in a block of its own for the reason this whole builder is written the way it is:
    // every byte added to /status is paid for on the httpd task's stack (AGENTS.md → Memory,
    // concurrency, and HTTP safety), and one more key in an existing object is the cheapest honest
    // place to say it.
    j += ",\"dwell_persist\":";
    j += jstr(dwell_persist_state());
    j += ",\"rows\":[";
    bool first_trend = true;
    for (size_t t = 0; t < logic::TREND_COUNT; t++) {
        char lbl[80];
        if (!history_label(t, lbl, sizeof(lbl))) continue;
        if (!first_trend) j += ",";
        first_trend = false;
        j += "{\"id\":";
        j += jstr(logic::TRENDS[t].id);
        j += ",\"label\":";
        j += jstr(lbl);
        j += "}";
    }
    j += "],\"modbus_rows\":[";
    // Paired HomeHub measurements/states get a second ring; Smart Grid and disinfection add explicit
    // state timelines without inventing a one-row X10A twin. Other states and setpoints remain live
    // rows without a chart. Keep the list empty when
    // this installation has no HomeHub stack, so old/no-gateway devices do not offer permanently
    // empty series in the browser.
    bool first_mb_trend = true;
    if (mb.enabled) {
        for (size_t mt = 0; mt < logic::HOMEHUB_HISTORY_COUNT; mt++) {
            const auto& hh = logic::HOMEHUB_HISTORIES[mt];
            const def::HomeHubReg* r = def::homehub_find(hh.offset);
            if (!r) continue;                         // compile-time table tests make this defensive
            if (!first_mb_trend) j += ",";
            first_mb_trend = false;
            j += "{\"id\":";
            j += jstr(hh.trend_id);
            j += ",\"label\":";
            j += jstr(r->label);
            j += "}";
        }
    }
    j += "],\"env3_rows\":[";
    // ENV III has its own producer task and therefore its own rings: an X10A outage must not stop
    // outdoor-climate history. Offer the fixed vocabulary only while this board has the sensor
    // enabled; a disabled accessory is absent rather than three permanently empty charts.
    if (env_enabled) {
        for (size_t et = 0; et < ENV3_HISTORY_COUNT; ++et) {
            if (et) j += ",";
            j += "{\"id\":";
            j += jstr(ENV3_HISTORIES[et].id);
            j += ",\"label\":";
            j += jstr(ENV3_HISTORIES[et].label);
            j += "}";
        }
    }
    j += "]},";

    // ── The rolling on-board plant diagnosis (logic/checkup.hpp) ────────────────────────────────
    // Counted EVENTS and window MINIMA — the questions no single reading can answer and the trend
    // rings structurally cannot either (a compressor cycle shorter than one 5-minute trend bucket
    // leaves no trace in it). Named `health` and not `diag`: GET /diag is the log ring the bug-report
    // button pulls, and two unrelated things under one word is how a reader ends up looking in the
    // wrong place.
    //
    // `covered_s` is card-level bus context. Each check additionally exposes its OWN evidence clock:
    // a mostly-readable pressure row cannot lend 24 hours to an RPS row seen for two seconds.
    //
    // A field a check has not established is emitted as `null`, never omitted — an absent key is
    // indistinguishable from an older build that never had it, the same rule logic/redact.hpp
    // states for the bug-report payload. Successive `+=` with bare literals throughout (never one
    // `a + b + c` chain): the httpd stack is the budget that killed v1.0.12, and every intermediate
    // of a chain is live in this frame at once.
    {
        const logic::CheckupReport hr = checkup_report();
        j += "\"health\":{\"covered_s\":";
        j += std::to_string(hr.covered_s);
        // How this boot's WINDOW came to be, for the reason the trends report it one block up:
        // "accept" = adopted across a reset that kept power, anything else NAMES why the card
        // started collecting again. A checkup that emptied itself otherwise reads as a defect, and
        // only the device can tell a power cut from a firmware update that moved the layout.
        j += ",\"persist\":";
        j += jstr(checkup_persist_state());
        j += ",\"full_span\":";
        j += hr.full_span ? "true" : "false";
        j += ",\"available\":";
        j += std::to_string(hr.available);
        j += ",\"assessable\":";
        j += std::to_string(hr.assessable);
        j += ",\"evaluated\":";
        j += std::to_string(hr.evaluated);
        j += ",\"status\":";
        j += jstr(logic::checkup_verdict_name(hr.overall));
        j += ",\"checks\":[";
        // An integer field, or null when the check did not establish it.
        auto num = [&j](const char* name, int v) {
            j += ",\"";
            j += name;
            j += "\":";
            if (v < 0) { j += "null"; return; }
            j += std::to_string(v);
        };
        // The same, for a value the converters produce in TENTHS of its unit (bar, l/min) — printed
        // with its one decimal so the browser never has to know the scale. Mirrors kw_field below.
        auto tenths = [&j](const char* name, int v) {
            j += ",\"";
            j += name;
            j += "\":";
            if (v < 0) { j += "null"; return; }
            j += std::to_string(v / 10);
            j += ".";
            j += std::to_string(v % 10);
        };
        auto signed_tenths = [&j](const char* name, bool known, int v) {
            j += ",\"";
            j += name;
            j += "\":";
            if (!known) { j += "null"; return; }
            if (v < 0) j += "-";
            const unsigned magnitude = static_cast<unsigned>(v < 0 ? -v : v);
            j += std::to_string(magnitude / 10);
            j += ".";
            j += std::to_string(magnitude % 10);
        };
        auto outdoor_context = [&j, &signed_tenths](const logic::CheckupOutdoorReport& context) {
            const bool known = context.samples > 0;
            j += ",\"outdoor_source\":";
            j += known ? jstr(logic::outdoor_source_name(context.source)) : "null";
            signed_tenths("outdoor_min_c", known, context.min_tenths);
            signed_tenths("outdoor_mean_c", known, context.mean_tenths);
            j += ",\"outdoor_samples\":";
            j += known ? std::to_string(context.samples) : "null";
        };
        // Compatibility minutes cannot represent a positive sub-minute runtime without lying as
        // zero or rounding up. Emit null for that one interval; the additive *_s fields preserve the
        // observed seconds accumulated between completed sweeps.
        auto whole_minutes = [](int seconds) {
            if (seconds < 0 || (seconds > 0 && seconds < 60)) return -1;
            return seconds / 60;
        };
        for (size_t i = 0; i < logic::CHECKUP_CHECK_COUNT; i++) {
            const auto  id = static_cast<logic::CheckupCheck>(i);
            const auto& ck = hr.checks[i];
            if (i) j += ",";
            j += "{\"id\":";
            j += jstr(logic::checkup_check_id(id));
            j += ",\"evidence\":";
            j += jstr(logic::checkup_result_evidence_name(id, ck));
            j += ",\"verdict\":";
            j += jstr(logic::checkup_verdict_name(ck.verdict));
            j += ",\"observed_s\":";
            j += std::to_string(ck.observed_s);
            j += ",\"required_s\":";
            j += std::to_string(ck.required_s);
            // Named per check rather than a generic pair: the browser must not have to carry a table
            // that says what `a` means for which id — that table would be a second definition of the
            // check, free to drift from this one.
            switch (id) {
                case logic::CheckupCheck::DhwLoss:
                    tenths("max_k_h", ck.a);
                    num("windows", ck.b);
                    num("high_windows", ck.c);
                    num("high_with_pump", ck.d);
                    num("high_pump_off", ck.e);
                    num("circulation_on_s", ck.f);
                    num("circulation_known_s", ck.g);
                    j += ",\"candidate_s\":";
                    j += std::to_string(hr.dhw_candidate_s);
                    j += ",\"settle_remaining_s\":";
                    j += std::to_string(hr.dhw_settle_remaining_s);
                    j += ",\"aborts\":";
                    j += std::to_string(hr.dhw_aborts);
                    j += ",\"best_aborted_s\":";
                    j += std::to_string(hr.dhw_best_aborted_s);
                    j += ",\"blocked\":";
                    j += hr.dhw_blocked ? "true" : "false";
                    // NAMES, not the raw mask: the browser would otherwise carry a copy of the bit
                    // meanings, which is a second definition of the rule free to drift from
                    // checkup.hpp's. Appended one literal at a time (the stack budget this builder
                    // is measured against — AGENTS.md → Memory, concurrency, and HTTP safety).
                    j += ",\"abort_reasons\":[";
                    {
                        bool first = true;
                        for (uint8_t bit : {logic::DHW_ABORT_CHARGE, logic::DHW_ABORT_PUMP,
                                            logic::DHW_ABORT_DRAW, logic::DHW_ABORT_READING,
                                            logic::DHW_ABORT_BLIND}) {
                            if (!(hr.dhw_abort_reasons & bit)) continue;
                            if (!first) j += ",";
                            first = false;
                            j += jstr(logic::dhw_abort_reason_name(bit));
                        }
                    }
                    j += "]";
                    break;
                case logic::CheckupCheck::Cycling:
                    // The pooled pair stays first and keeps its names: it is still the day's total,
                    // and a consumer written before the split reads exactly what it always did. The
                    // class figures count COMPLETED RUNS — `null` until one was actually witnessed,
                    // never 0, because a zero beside real starts reads as "no space heating ran".
                    // `split` says which of the two decided the verdict; the reader cannot infer it.
                    num("starts", ck.a);
                    num("mean_run_s", ck.b);
                    num("space_runs", ck.c);
                    num("space_mean_run_s", ck.d);
                    num("dhw_runs", ck.e);
                    num("dhw_mean_run_s", ck.f);
                    num("cooling_runs", hr.cycling_cooling_runs);
                    num("censored_runs", ck.g);
                    j += ",\"split\":";
                    j += hr.cycling_split ? "true" : "false";
                    outdoor_context(hr.cycling_outdoor);
                    break;
                case logic::CheckupCheck::Defrost: {
                    num("count", ck.a);
                    num("paired_count", ck.e);
                    // The legacy whole-percent field cannot express a positive share below 1%.
                    num("share_pct", ck.c > 0 && ck.b == 0 ? -1 : ck.b);
                    num("defrost_s", ck.c);
                    num("run_s", ck.d);
                    outdoor_context(hr.defrost_outdoor);
                    break;
                }
                case logic::CheckupCheck::Pressure: tenths("min_bar", ck.a);                        break;
                case logic::CheckupCheck::Flow:     tenths("min_l_min", ck.a);                      break;
                case logic::CheckupCheck::Heater:
                    num("buh_min", whole_minutes(ck.a));
                    num("bsh_min", whole_minutes(ck.b));
                    num("buh_s", ck.a);
                    num("bsh_s", ck.b);
                    break;
                case logic::CheckupCheck::Fault:    num("active", ck.a);                            break;
                case logic::CheckupCheck::Retries:  num("seen", ck.a);                              break;
            }
            j += "}";
        }
        j += "]},";
    }

    // System health: heap headroom + why the device last booted, so both are visible from the LAN
    // without a serial console (and without a broker — unlike the MQTT heartbeat). free_heap
    // is the current free, min_free_heap the since-boot low-water mark (the leak indicator), max_alloc
    // the largest CONTIGUOUS block (the true OOM ceiling on this heap-tight chip). reset_reason reuses
    // the boot-time cached reason (diag_crash.cpp) mapped via logic/reset_reason.hpp; safe_mode is the
    // latched boot-loop recovery flag (safe_mode.cpp — true once too many crash boots accumulated, so
    // poll + MQTT were skipped). heap_restarts is how many CONSECUTIVE heap-watchdog restarts
    // preceded this boot (heap_guard.cpp): that restart is an esp_restart(), so reset_reason reads
    // "sw" — the same value a config save produces — and without this field a board restarting
    // itself every five minutes would be indistinguishable from one somebody kept saving settings
    // on, which is exactly the unattributable reboot this block exists to prevent. 0 on any ordinary
    // boot. Small numbers + a short slug appended to the existing builder — no large contiguous
    // allocation, and nothing here is a `+` chain.
    //
    // Beside them, what that headroom already COST while the board DID survive (#380): cycles the two
    // 1 s task loops produced nothing on. mqtt_skipped/poll_skipped are OOM-guard catches — a reading
    // dropped, or (poll) never read at all; mqtt_quiesced is the publisher standing aside on purpose
    // while an OTA/weather TLS operation owns the heap (logic/ota_quiesce.hpp), the same gap with a
    // stated cause.
    // The three of them complete the sequence the two figures above start: min_free_heap says how
    // close the board came, these say what it lost getting there, and heap_restarts says when it did
    // not get there at all. Three atomic loads and three plain integers.
    const MqttSkipStats skips = mqtt_skip_stats();
    j += "\"sys\":{\"free_heap\":" + std::to_string(esp_get_free_heap_size()) +
         ",\"min_free_heap\":" + std::to_string(esp_get_minimum_free_heap_size()) +
         ",\"max_alloc\":" + std::to_string(heap_largest_internal_block()) +
         ",\"heap_restarts\":" + std::to_string(heap_guard_restarts()) +
         ",\"mqtt_skipped\":" + std::to_string(skips.skipped) +
         ",\"mqtt_quiesced\":" + std::to_string(skips.quiesced) +
         ",\"poll_skipped\":" + std::to_string(hp_skipped_cycles()) +
         ",\"reset_reason\":" + jstr(reset_reason_name(diag_crash_info().reason)) +
         ",\"safe_mode\":" + (safe_mode_active() ? "true" : "false") +
         // WHY it is minimal, so the recovery banner can give advice that fits the cause: a
         // crash loop points at the configuration (the RX/TX pins first), a heap give-up does
         // not, and telling that reader to check their pins sends them to fix something that
         // is already correct. null whenever safe_mode is false.
         ",\"safe_mode_cause\":" + (safe_mode_cause() ? jstr(safe_mode_cause()) : "null");
    // THE OTHER MEMORY BUDGET, on the surface that needs no broker. The MQTT heartbeat carries the
    // same four figures, but every ordinary publish — the heartbeat included — sits behind the
    // X10A publish gate (logic/mqtt_publish_gate.hpp): a board whose bus never answers publishes
    // nothing at all, and safe mode never starts the publish task in the first place. Those are
    // exactly the boards whose stack headroom someone wants, so a metric reachable only over MQTT
    // would be absent precisely where it is the evidence — the shape that once folded the board's
    // own heap trends inside the heat pump's poll cycle. Grouped under one key so the unit is
    // stated once; null per task until that task has been sampled (main/stack_watch.hpp).
    //
    // Appended with successive += rather than extended onto the chain above: this builder is the
    // one whose frame overflowed the httpd stack twice, and a chain materialises every intermediate
    // std::string in one frame (AGENTS.md → Memory, concurrency, and HTTP safety). Four integers,
    // one at a time.
    j += ",\"stack_min_free_bytes\":{\"httpd\":";
    append_stack_bytes(j, stack_watch_min_free_bytes(StackWatch::Httpd));
    j += ",\"poll\":";
    append_stack_bytes(j, stack_watch_min_free_bytes(StackWatch::Poll));
    j += ",\"mqtt\":";
    append_stack_bytes(j, stack_watch_min_free_bytes(StackWatch::Mqtt));
    j += ",\"modbus\":";
    append_stack_bytes(j, stack_watch_min_free_bytes(StackWatch::Modbus));
    j += "}},";

    // NTP: its own top-level block (not folded into sys), mirroring syslog{} — it is a runtime-
    // configurable network service like syslog/MQTT (POST /set_ntp -> NVS "ntp_server"), not a static
    // board fact like the rest of sys{}. server is the CONFIGURED address (config().ntp_server,
    // resolved from NVS/Kconfig at boot — sntp_time.cpp never changes it live, a server edit reboots),
    // not necessarily who actually answered. synced/time are null/false until the first SNTP reply of
    // this boot lands.
    const TimeStatus ts = time_status();
    j += "\"ntp\":{\"server\":" + jstr_r(ts.server, redact) +
         ",\"synced\":" + (ts.synced ? "true" : "false") +
         ",\"time\":" + (ts.synced ? jstr(rfc3339_utc(ts.unix_time)) : "null") + "},";

    // Explicit opt-in boundary for optional plant diagnostics and their external source collection.
    // Kept separate from system/link health: X10A, HomeHub and the technical heartbeat remain active.
    j += "\"diagnostics\":{\"enabled\":";
    j += c.diagnostics_enabled ? "true" : "false";
    j += "},";

    // Which OTA feed this device follows (logic/ota_channel.hpp; POST /set_ota). Reported HERE and
    // not only on /ota/status because the Settings screen's ESP32 card renders the selector from
    // /status like every other setting — reading a second endpoint on every poll just to colour one
    // dropdown would be a second fetch to fail. `dev` is the same fact the running version already
    // carries in its "-dev.N" suffix, but a device can be SET to a channel it is not running a build
    // from (that is exactly the state between picking a channel and installing from it), so the
    // setting is reported on its own rather than inferred from the version string.
    j += "\"ota\":{\"channel\":" + jstr(ota_channel_name(c.ota_channel)) + "},";

    // The web UI's manual language override (logic/ui_lang.hpp; POST /set_lang). "auto" (the default)
    // means the browser keeps detecting the language on its own; "de"/"en" force one on every client.
    // Reported here for the same reason as the channel: the ESP32 card's language selector renders
    // from /status, and the browser applies "de"/"en" over its own navigator.language guess.
    j += "\"ui\":{\"lang\":" + jstr(ui_lang_name(c.ui_lang)) + "},";

    // Last reset: null on a clean boot, else the crash summary (reset reason + core-dump backtrace).
    // The reason/backtrace come from the boot-time CACHE (diag_crash.cpp) — never re-parsed from
    // flash here: this builder answers a REQUEST, now up to once every 8 s per open dashboard, so
    // keep the path cheap (no flash PARSE).
    // `coredump` is the exception: it must reflect flash NOW, not at boot, or a dump erased via
    // POST /coredump/clear leaves a banner with no download unless this is refreshed. Refreshing it
    // costs one 4-byte flash read — the same read GET /coredump already does per request.
    const CrashInfo crash = diag_crash_info_live();
    j += "\"last_crash\":" + std::string(crash_is_notable(crash) ? build_crash_json(crash) : "null") + ",";

    // Auto-detection: proto/model derived from the X10A bus (hp_detect.cpp). The candidate set is
    // recomputed cheaply from the stored fingerprint (no re-probe) via the pure logic/detect.hpp.
    // Detection is fully automatic — the firmware applies the best-fit representative itself and the
    // UI only DISPLAYS the outcome (the Model card); candidates[]/ambiguous are reported for
    // diagnostics, not for a picker. There is no manual model selection anywhere in the UI.
    j += "\"detect\":{\"proto\":" + jstr(std::string(1, static_cast<char>(c.proto)));
    j += ",\"rx\":" + std::to_string(c.rx_pin) + ",\"tx\":" + std::to_string(c.tx_pin);
    j += ",\"valid\":" + std::string(c.fp_valid ? "true" : "false");
    // TWO capacities, reported as separate fields and never merged. `capacity_kw` is the OUTDOOR
    // unit's own report (page 0x00 offset 12), null whenever its variable-length descriptor is too
    // short to carry offset 12. `capacity_kw_iu` is the INDOOR unit's rated code (0x60 offset 6) —
    // the same 0.1 kW units, and what detection already falls back to for RANKING. They are NOT
    // interchangeable: a 6 kW outdoor unit is routinely paired with an 8 kW indoor unit, so
    // substituting one for the other under a single name would publish a figure for the wrong half
    // of the plant. Reported side by side, the UI can say which unit a shown capacity came from.
    // Successive += with bare literals (never one + chain) — see AGENTS.md → Memory, concurrency,
    // and HTTP safety:
    // the httpd task's stack is the tight one, and a chain holds every intermediate at once.
    auto kw_field = [&j](const char* name, int tenths) {
        j += ",\"";
        j += name;
        j += "\":";
        if (tenths < 0) { j += "null"; return; }
        j += std::to_string(tenths / 10);
        j += ".";
        j += std::to_string(tenths % 10);
    };
    // All three unit FACTS are gated on fp_valid, like candidates[] already is. POST /detect clears
    // the fingerprint to force a fresh pass, and until that pass lands there is nothing measured to
    // report — emitting the previous unit's capacity/EEPROM through that window is exactly the
    // "cached fingerprint presented as a live reading" docs/DESIGN.md §5.3 rules out, and it is the
    // window in which a SWAPPED unit is most likely to be misreported.
    kw_field("capacity_kw", c.fp_valid ? c.fp_kw_tenths : -1);
    kw_field("capacity_kw_iu", c.fp_valid ? c.fp_iu_kw_tenths : -1);
    j += ",\"ou_eeprom\":" + jstr(c.fp_valid ? c.fp_eeprom : std::string());
    // Candidate ids + the DISTINCT model families among them. Detection is coarse — models that share
    // a page_mask+capacity are register-identical on X10A — so the UI shows a single family only when
    // all candidates agree; a mixed set is reported honestly as "not uniquely identifiable" rather
    // than asserting the (arbitrary) best-fit's name.
    int total = 0;
    std::string cand, fams;
    if (c.fp_valid) {
        Fingerprint fp{};
        fp.page_mask = c.fp_pages;
        fp.kw_tenths = c.fp_kw_tenths;
        // Carried so this recomputed fingerprint stays a faithful copy of the one detection used —
        // and since #225 it is LOAD-BEARING here, not merely faithful: detect_candidates narrows by
        // the I/U capacity when the O/U figure is absent, so omitting this field would make /status
        // report a set the device never considered (the live unit: 8 candidates across 4 families
        // instead of 3 across 2, which is the over-broad reading that put a wrong family into #213).
        fp.iu_kw_tenths = c.fp_iu_kw_tenths;
        int nsig = 0;
        const Signature* sigs = def::signatures(nsig);
        const char* out[64];
        total = detect_candidates(sigs, nsig, fp, out, static_cast<int>(sizeof(out) / sizeof(out[0])));
        const int shown = total < 64 ? total : 64;
        std::vector<std::string> seen;
        for (int i = 0; i < shown; i++) {
            if (i) cand += ",";
            cand += jstr(out[i]);
            const def::ModelName* mn = def::model_name(out[i]);
            std::string fam = mn ? mn->family : "Altherma";
            if (std::find(seen.begin(), seen.end(), fam) == seen.end()) {
                if (!seen.empty()) fams += ",";
                fams += jstr(fam);
                seen.push_back(fam);
            }
        }
    }
    j += ",\"candidates\":[" + cand + "]";
    j += ",\"families\":[" + fams + "]";
    j += ",\"ambiguous\":" + std::string(total > 1 ? "true" : "false");
    // Display metadata for the profile actually being read (best-fit representative or generic).
    const def::ModelName* wm = def::model_name(c.profile.c_str());
    j += ",\"model\":";
    j += wm ? "{\"name\":" + jstr(wm->name) + ",\"family\":" + jstr(wm->family) +
                  ",\"marketing\":" + jstr(wm->marketing) + "}"
            : "null";
    j += "}";
    j += "}";
}

void http_append_status_json(std::string& j, bool redact) {
    append_status_json(j, redact);
}

static esp_err_t h_status(httpd_req_t* req) {
    // ?redact=1 -> the bug-report form of this payload (logic/redact.hpp). Same flag policy as
    // ?clear / ?verbose / ?downgrade: fires on exactly "1", so ?redact=0 is not a near-miss that
    // silently ships the unscrubbed body under a name that promised otherwise.
    bool redact = false;
    char q[48];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[4];
        if (httpd_query_key_value(q, "redact", v, sizeof(v)) == ESP_OK) redact = query_flag_on(v);
    }
    HttpJsonChunks chunks(HttpChunkEmitter{req});
    httpd_resp_set_type(req, "application/json");
    return finish_bounded_stream(chunks, [redact](auto& out) {
        append_status_json(out, redact);
    }) ? ESP_OK : ESP_FAIL;
}

struct ValuesSnapshot {
    std::vector<CachedValue> x10a;
    std::vector<uint8_t> x10a_label_ambiguous;
    std::vector<CachedValue> modbus;
    bool modbus_live = false;
};

// Copy every source before sending the first response byte. Besides giving the two wire surfaces
// one snapshot contract, this keeps an allocation failure in the shared HTTP guard's clean-503
// window: once chunked transfer starts, the response status can no longer be changed.
static ValuesSnapshot take_values_snapshot() {
    ValuesSnapshot snapshot;

    const size_t x10a_cap = hp_values_capacity();
    snapshot.x10a.resize(x10a_cap ? x10a_cap : 1);
    snapshot.x10a.resize(hp_values_snapshot(snapshot.x10a.data(), snapshot.x10a.size()));
    snapshot.x10a_label_ambiguous.resize(snapshot.x10a.size());
    for (size_t i = 0; i < snapshot.x10a.size(); i++) {
        // object_id()/ha_slug() owns a temporary std::string. Resolve it before transfer starts so
        // even that small allocation remains inside the clean-503 window.
        snapshot.x10a_label_ambiguous[i] =
            label_slug_is_ambiguous(object_id(snapshot.x10a[i].label)) ? 1 : 0;
    }

    // The initial status read is only a cheap skip. mb_values_snapshot() re-checks liveness after
    // copying the cache and closes both disconnect and reconnect races with generation counters.
    if (mb_status().connected) {
        const size_t modbus_cap = mb_values_capacity();
        snapshot.modbus.resize(modbus_cap ? modbus_cap : 1);
        bool live = false;
        const size_t n = mb_values_snapshot(snapshot.modbus.data(), snapshot.modbus.size(), live);
        snapshot.modbus.resize(n);
        snapshot.modbus_live = live;
        if (!live) snapshot.modbus.clear();
    }
    return snapshot;
}

// Every number emitted by /values is non-negative. Format it into a fixed stack buffer so row
// rendering remains allocation-free after the first HTTP chunk has been sent.
template <typename JsonOut>
static void append_json_uint(JsonOut& out, uint64_t value) {
    char digits[20];  // UINT64_MAX has exactly 20 decimal digits
    char* begin = digits + sizeof(digits);
    char* p = begin;
    do {
        *--p = static_cast<char>('0' + (value % 10));
        value /= 10;
    } while (value);
    out += std::string_view(p, static_cast<size_t>(begin - p));
}

// The decoded-values JSON array "[{label,value,unit,reg},…]" behind GET /values — the route the
// dashboard polls every 2 s. The caller wraps it in the {"values":…} envelope. The snapshot is
// already complete, so this serializer performs no model-sized allocation after transfer starts.
//
// `reg` is the X10A register PAGE the row was decoded from, and it is what makes the browser's
// held-over rule STRUCTURAL: logic/ou_stale.hpp's ou_page_holds_over() keys on the page (0x20/0x21
// stop being refreshed while the compressor rests), and www/js/schematic.js must apply the same rule to the
// rows it shows. Matching those rows by LABEL instead would be a second, drifting copy of the rule —
// the catalog spells them ~50 different ways across the 43 profiles ("Outdoor air temp.",
// "R1T-Outdoor air temp.", "Outdoor Air Temp (R1T)", …), so a pattern list would silently stop
// covering a row the C++ test still gates.
template <typename JsonOut>
static void append_values_array(JsonOut& j, const std::vector<CachedValue>& v,
                                const std::vector<uint8_t>& ambiguous) {
    j += "[";
    // Successive += rather than one a + b + c + … chain: a chain materialises every intermediate
    // std::string in the same frame, and this runs on the httpd task (see AGENTS.md → Memory,
    // concurrency, and HTTP safety; the v1.0.12 stack overflow).
    for (size_t i = 0; i < v.size(); i++) {
        if (i) j += ",";
        j += "{\"label\":";
        json_append_quoted(j, v[i].label);
        j += ",\"value\":";
        if (v[i].value.empty()) j += "null";
        else json_append_quoted(j, v[i].value);
        j += ",\"unit\":";
        json_append_quoted(j, v[i].unit);
        j += ",\"reg\":";
        append_json_uint(j, v[i].reg);
        // A small audited set of catalog labels occurs on more than one register page. They are not duplicate
        // measurements: for example, both the outdoor controller and the hydronic controller carry
        // their own Error Code. Sending only one would hide a real fault; sending both under the
        // same visible name made the dashboard look duplicated and also gave both accordions the
        // same browser key. Reuse discovery.hpp's mechanically audited ambiguity ledger and the
        // MQTT payload's existing page namespace, rather than maintaining another label list here.
        // The marker is sparse (only ambiguous rows carry it), so ordinary /values frames do not
        // pay a group-name payload cost for every reading.
        if (i < ambiguous.size() && ambiguous[i]) {
            j += ",\"x10a_group\":";
            json_append_quoted(j, group_for_page(v[i].reg));
        }
        // Keep the value itself at the firmware-wide numeric 0/1 boundary. The structural marker
        // is intentionally emitted only for binary rows: it lets the browser render ON/OFF without
        // treating every numeric zero/one as a switch, while adding no payload bytes to the many
        // non-binary readings.
        if (conv_is_binary(v[i].conv)) {
            j += ",\"binary\":true";
            // A selector is still a numeric bit at every published boundary, but the browser needs
            // its structural meaning to avoid presenting a selected path as a generic ON/OFF flag.
            // Emit only the four catalog identities with documented non-boolean semantics; all
            // ordinary flags retain the compact payload and the familiar ON/OFF presentation.
            if (const char* sid = logic::binary_semantic_for(v[i].reg, v[i].off, v[i].conv))
                { j += ",\"binary_semantic\":"; json_append_quoted(j, sid); }
        }
        // The DEVICE's own answer to "is this reading still current?" — logic/ou_stale.hpp applied on
        // the poll task (#209 defect 5), emitted only when true so the many live rows cost no bytes.
        // The browser still derives the same fact from `reg` + the compressor row, and the catalog
        // test gates both against every profile; this is here so a non-browser consumer of /values
        // (a script, the MCP surface) gets the answer without reimplementing the rule, and so the
        // marker travels with the row rather than being recomputed from a snapshot taken elsewhere.
        if (v[i].held) j += ",\"held\":true";
        // HOW LONG THIS STATE HAS STOOD (logic/state_dwell.hpp). Emitted only for the switched rows
        // the table tracks, so the ~65 measurement rows cost no bytes — the same rule `binary`,
        // `held` and `concept` already follow. "OFF" answers what a flag is; for a flag that is most
        // of the question, and for a temperature "time since the last change" is the poll period.
        //
        // THREE fields rather than one, because the number alone is not the claim:
        //   dwell_s        seconds the current state has stood, as far as this board could tell
        //   dwell_min      the true age is at LEAST that — the transition itself was never seen
        //                  (a run this board joined in progress, or one resumed after a long gap)
        //   dwell_blind_s  of those seconds, how many the bus did not answer for
        // A consumer that prints dwell_s and ignores the other two states something stronger than
        // the device knows, which is why they are separate keys and not a rendered string.
        //
        // GATED ON THE ROW STATING A VALUE AT ALL, which is not the same question as `known` below.
        // The slot survives a row the sweep could not read — that is the point of it, it books the
        // seconds as blind — but this row is then published with `"value":null`, and an age beside a
        // value that is not there describes nothing. The browser renders such a row as "—", so the
        // pair reads "— for 3 h 20 min": an age for a reading the device just refused to state,
        // which is ou_stale.hpp's inspector defect (a blanked pill restated one line below itself)
        // arriving in a new place. No value, no age — and the firmware decides that, so a consumer
        // that is not the browser cannot reach a different answer.
        if (logic::dwell_row_tracked(v[i].reg, v[i].off, v[i].conv) && !v[i].value.empty()) {
            const logic::DwellReading dw = dwell_reading(v[i].reg, v[i].off, v[i].conv);
            // `known` false is a first-class answer and is emitted as ABSENCE: a silent bus, a page
            // that stopped answering, a row seen too long ago to vouch for. An omitted key says "no
            // reading"; a zero would say "it changed just now".
            if (dw.known) {
                j += ",\"dwell_s\":";
                append_json_uint(j, dw.since_s);
                if (!dw.exact) j += ",\"dwell_min\":true";
                if (dw.blind_s) {
                    j += ",\"dwell_blind_s\":";
                    append_json_uint(j, dw.blind_s);
                }
            }
        }
        // The row's CONCEPT — the structural id logic/homehub_map.hpp pairs the two independent
        // sources on (logic/history.hpp's trend vocabulary, resolved through the same
        // trend_row_matches() the rings use). It is what lets the browser put a Modbus reading beside
        // this one, and stand in for it when the X10A bus is silent, WITHOUT matching on the label —
        // which would be both incomplete and wrong (the catalog spells one quantity many ways and
        // reuses tags across quantities). Emitted only where a concept exists, so the many unpaired
        // rows cost no bytes.
        // `conv` is part of the key because the STATE pairings need it: six flags share the single
        // byte 0x60/12 and differ only in which bit their converter masks, so without it the diverter
        // and the circulation pump are one row.
        if (const char* cid = logic::x10a_concept_for(v[i].reg, v[i].off, v[i].unit, v[i].conv))
            { j += ",\"concept\":"; json_append_quoted(j, cid); }
        j += "}";
    }
    j += "]";
}

// The HomeHub rows, from the OTHER stack's cache (hp_modbus.cpp). A separate array rather than mixed
// into the one above, because they are a separate source with its own liveness: merging them would
// make "is this reading current?" a per-row question the consumer cannot answer. Each row carries the
// concept it pairs on, or none when the HomeHub has no X10A counterpart for it (the real power
// measurement, the Smart-Grid mode) — those are simply Modbus-only readings.
template <typename JsonOut>
static void append_modbus_values_array(JsonOut& j, const std::vector<CachedValue>& v) {
    j += "[";
    for (size_t i = 0; i < v.size(); i++) {
        const def::HomeHubReg* reg = def::homehub_find(v[i].off);
        if (i) j += ",";
        j += "{\"label\":";
        json_append_quoted(j, v[i].label);
        j += ",\"value\":";
        if (v[i].value.empty() || !reg) j += "null";
        else if (def::homehub_is_text(*reg)) json_append_quoted(j, v[i].value);
        else if (is_json_number(v[i].value)) j += v[i].value;
        else j += "null";  // fail closed: never repair a broken numeric contract by quoting it
        j += ",\"unit\":";
        json_append_quoted(j, v[i].unit);
        j += ",\"off\":";
        append_json_uint(j, v[i].off);
        if (conv_is_binary(v[i].conv)) j += ",\"binary\":true";
        // Keep the value raw and transport-friendly. The semantic id is metadata for the browser's
        // last-mile rendering, so mode 2 can display as "Recommended on" without being sent as text.
        if (reg)
            if (const char* eid = def::homehub_enum_id(reg->kind))
                { j += ",\"enum\":"; json_append_quoted(j, eid); }
        if (const char* cid = logic::homehub_concept_for(v[i].off))
            { j += ",\"concept\":"; json_append_quoted(j, cid); }
        // History metadata is wider than source pairing: a Modbus-only timeline must be attachable
        // to this row without pretending that it has an X10A `concept` twin.
        if (const char* hid = logic::homehub_history_for(v[i].off))
            { j += ",\"history\":"; json_append_quoted(j, hid); }
        j += "}";
    }
    j += "]";
}

// The two sources ride ONE response but stay two arrays, mirroring the two stacks behind them:
// `values` is X10A, `modbus` is the HomeHub. `modbus` is emitted only for a snapshot proven live, so
// a device without one sees exactly the payload it saw before this feature existed. The one shared
// serializer keeps GET /values and MCP structuredContent byte-for-byte equivalent.
template <typename JsonOut>
static void append_values_json(JsonOut& j, const ValuesSnapshot& snapshot) {
    j += "{\"values\":";
    append_values_array(j, snapshot.x10a, snapshot.x10a_label_ambiguous);
    // Emitted only while the link is CONNECTED, not merely enabled. That is a payload invariant
    // worth having: if the `modbus` array is present, every row in it was read this cycle. Gating on
    // `enabled` alone served the last good cache after the link dropped, and a consumer has no way
    // to tell — the rows look identical. The browser is not the only consumer, so the guarantee
    // belongs here rather than in a check each client has to remember to make.
    //
    // mb_values_snapshot() tied the cache copy and the link generations into `modbus_live` before
    // transfer started. Not live → the key is not written at all: an ABSENT array and an empty one
    // are different claims, and only absence says "no current reading".
    if (snapshot.modbus_live) {
        j += ",\"modbus\":";
        append_modbus_values_array(j, snapshot.modbus);
    }
    j += "}";
}

// /values is the UI's largest model-dependent response. Building the complete body in one string
// made its contiguous allocation grow beyond the 15-16 KB block a healthy target commonly has.
// MCP get_hp_values used to repeat that defect around a JSON-RPC envelope. Both now stage their
// snapshots before the first byte and stream the same representation through this strict 1 KiB sink.
esp_err_t http_send_values_json(httpd_req_t* req, std::string_view prefix,
                                std::string_view suffix) {
    ValuesSnapshot snapshot = take_values_snapshot();
    HttpJsonChunks j(HttpChunkEmitter{req});
    httpd_resp_set_type(req, "application/json");
    j += prefix;
    append_values_json(j, snapshot);
    j += suffix;
    return j.finish() ? ESP_OK : ESP_FAIL;
}

static esp_err_t h_values(httpd_req_t* req) {
    return http_send_values_json(req);
}

static bool models_active_requested(httpd_req_t* req) {
    const size_t n = httpd_req_get_url_query_len(req);
    if (n == 0 || n >= 32) return false;
    char query[32];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) return false;
    char active[4];
    return httpd_query_key_value(query, "active", active, sizeof(active)) == ESP_OK &&
           std::strcmp(active, "1") == 0;
}

// Lazy picker feed for the expert X10A probe. It is deliberately a query variant of the existing
// model-catalog route: no extra resident URI record, and no growth of the frequently-polled
// /status or /values payloads. An unresolved/stale detected id uses the explicit generic definition
// as a diagnostic example set; `definition` + `fallback` keep that provenance distinct from the
// installation's `profile` instead of silently pretending generic was detected.
static esp_err_t h_active_model_values(httpd_req_t* req) {
    const Config c = config(); // allocate/snapshot before response headers; handle_all maps OOM to 503
    bool fallback = false;
    const def::Profile* profile = probe_catalog_profile(def::profiles, c.profile, fallback);
    HttpJsonChunks j(HttpChunkEmitter{req});
    httpd_resp_set_type(req, "application/json");
    // Detection and firmware updates can change the selected definition while this URL stays the
    // same. A cached unresolved response would leave the expert picker empty after the device has
    // newer rows, so this live, installation-specific catalog must never be reused.
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    j += "{\"profile\":";
    json_append_quoted(j, c.profile);
    j += ",\"definition\":";
    json_append_quoted(j, profile ? std::string_view(profile->id) : std::string_view{});
    j += ",\"fallback\":";
    j += fallback ? "true" : "false";
    j += ",\"values\":[";
    if (profile) {
        const auto view = def::resolved(*profile);
        bool comma = false;
        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef& row = view[i];
            if (!probe_catalog_row(row)) continue;
            if (comma) j += ',';
            comma = true;
            j += "{\"reg\":";    append_json_uint(j, row.reg);
            j += ",\"offset\":"; append_json_uint(j, row.offset);
            j += ",\"conv\":";   append_json_uint(j, static_cast<uint64_t>(row.conv));
            j += ",\"size\":";   append_json_uint(j, row.size);
            j += ",\"label\":";  json_append_quoted(j, row.label);
            j += '}';
        }
    }
    j += "]}";
    return j.finish() ? ESP_OK : ESP_FAIL;
}

// Model catalog + pin hint (def/models_catalog.hpp, generated alongside the def/*.hpp profiles).
// Without ?active=1 this remains the legacy read-only inspection payload for humans/scripts.
static esp_err_t h_models(httpd_req_t* req) {
    if (models_active_requested(req)) return h_active_model_values(req);
    return http_send_json(req, def::MODELS_JSON);
}

// GET /history?row=<trend id>[&source=modbus|env3] — one 24-hour series, oldest sample first. X10A
// is the backwards-compatible default; the external circulation witness identifies itself as MQTT,
// Modbus carries paired HomeHub measurements/state timelines, and ENV III owns three independent
// outdoor-climate rings.
//
//   {"id":"outdoor_air","source":"x10a","label":"R1T-Outdoor air temp.","dt":300,
//    "unit":"°C","t0":1784926349,"b0":5931421,"v":[131,null,…],
//    "held":[[0,42],[55,180]]}
//
// `v` holds tenths of the unit (the resolution the converters produce, so a sample is exact rather
// than rounded on the way in) or null. `held` run-length-marks WHICH of those nulls were the outdoor
// unit resting rather than a failure to measure — a plain number-or-null array stays readable by any
// consumer, and the reason for the nulls rides alongside instead of inside it (logic/history.hpp).
//
// `t0` is the wall-clock instant of sample 0, derived HERE from the newest committed sample's
// monotonic age — the ring itself advances on the monotonic clock, so it survives SNTP setting the
// time mid-boot. Omitted entirely when the clock has never synced: the UI then reads out an AGE,
// which is the same refusal-to-fabricate logic/timestamp.hpp already makes for syslog timestamps.
// `b0` is sample zero's monotonic bucket and aligns every source exactly even without wall time.
//
// Sent in CHUNKS. The body is ~1.5 KB — smaller than the model-dependent /values body — but it is a new allocation on
// a heap where the largest contiguous block is the binding limit, and chunking costs nothing here.
static esp_err_t h_history(httpd_req_t* req) {
    char q[96] = {0};
    char id[32] = {0};
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) != ESP_OK ||
        httpd_query_key_value(q, "row", id, sizeof(id)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(req, "{\"ok\":false,\"error\":\"row required\"}");
    }
    char source[12] = {0};
    const bool has_source = httpd_query_key_value(q, "source", source, sizeof(source)) == ESP_OK;
    const bool modbus = has_source && std::strcmp(source, "modbus") == 0;
    const bool env3_source = has_source && std::strcmp(source, "env3") == 0;
    if (has_source && !modbus && !env3_source && std::strcmp(source, "x10a") != 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(req, "{\"ok\":false,\"error\":\"unknown source\"}");
    }
    const logic::TrendDef* def_ = logic::trend_by_id(id);
    // An unknown id is a 404, never a defaulted trend: answering with SOME series would look like a
    // working request and quietly attach the wrong sensor's history to whatever asked.
    size_t t = 0;
    if (def_) { while (t < logic::TREND_COUNT && &logic::TRENDS[t] != def_) t++; }
    const int mb_t = modbus ? logic::homehub_history_index(id) : -1;
    const int env_t = env3_source ? env3_history_index(id) : -1;
    const bool x10a_unknown = !modbus && !env3_source && (!def_ || t >= logic::TREND_COUNT);
    if (x10a_unknown || (modbus && mb_t < 0) || (env3_source && env_t < 0)) {
        httpd_resp_set_status(req, "404 Not Found");
        return http_send_json(req, "{\"ok\":false,\"error\":\"unknown trend\"}");
    }

    // Both buffers are function-static rather than stack: this handler runs on the httpd task, whose stack
    // is the one that overflowed in v1.0.12, and 576 + 576 bytes of locals is not worth the risk.
    // Safe because esp_http_server dispatches requests one at a time on that single task.
    static logic::HistorySample samples[logic::HISTORY_SAMPLES];
    static uint16_t             runs[logic::HISTORY_MAX_RUNS][2];
    const size_t n = modbus
        ? history_modbus_snapshot(static_cast<size_t>(mb_t), samples, logic::HISTORY_SAMPLES)
        : env3_source
            ? history_env3_snapshot(static_cast<size_t>(env_t), samples, logic::HISTORY_SAMPLES)
            : history_snapshot(t, samples, logic::HISTORY_SAMPLES);
    const size_t nruns = (modbus || env3_source) ? 0
        : logic::history_held_runs(samples, n, runs, logic::HISTORY_MAX_RUNS);

    char lbl[80], unit[8];
    if (modbus) {
        const def::HomeHubReg* r = def::homehub_find(logic::HOMEHUB_HISTORIES[mb_t].offset);
        std::snprintf(lbl, sizeof(lbl), "%s", r ? r->label : "");
        std::snprintf(unit, sizeof(unit), "%s", r ? r->unit : "");
    } else if (env3_source) {
        std::snprintf(lbl, sizeof(lbl), "%s", ENV3_HISTORIES[env_t].label);
        std::snprintf(unit, sizeof(unit), "%s", ENV3_HISTORIES[env_t].unit);
    } else {
        history_label(t, lbl, sizeof(lbl));
        history_unit(t, unit, sizeof(unit));
    }

    std::string j = "{\"id\":";
    j += jstr(modbus ? logic::HOMEHUB_HISTORIES[mb_t].trend_id
                     : env3_source ? ENV3_HISTORIES[env_t].id : def_->id);
    j += ",\"source\":";
    const bool mqtt_source = !modbus && !env3_source &&
                             def_->kind == logic::TrendKind::CirculationState;
    j += jstr(modbus ? "modbus" : env3_source ? "env3" : mqtt_source ? "mqtt" : "x10a");
    j += ",\"label\":";
    j += jstr(lbl);
    j += ",\"dt\":";
    j += std::to_string(logic::HISTORY_DT_S);
    // The ROW's unit, never a hardcoded "°C": the trends mix °C, bar and unitless rows, and the
    // browser prints this string straight into the range readout and the crosshair. A bar row
    // labelled °C is exactly the #35-#39 shape.
    j += ",\"unit\":";
    j += jstr(unit);
    const TimeStatus ts = time_status();
    const int32_t newest_age = modbus ? history_modbus_newest_age_s()
        : env3_source ? history_env3_newest_age_s() : history_newest_age_s();
    if (ts.synced && n && newest_age >= 0) {
        // Derived from the AGE of the newest sample, not from `now`: the ring commits a bucket every
        // HISTORY_DT_S, so between commits the newest sample ages while `now` moves on. Measured on a
        // live unit, the old `now - (n-1)*dt` form reported t0 values 70 s apart for two fetches 70 s
        // apart with an unchanged sample count — every timestamp up to a bucket late, and a PINNED
        // readout eventually rounding onto the neighbouring sample and describing a different
        // measurement than the one tapped. logic/history_t0 carries the rule and the invariance test.
        j += ",\"t0\":";
        j += std::to_string(logic::history_t0(ts.unix_time, static_cast<uint32_t>(newest_age),
                                              n, logic::HISTORY_DT_S));
    }
    const int64_t b0 = modbus ? history_modbus_oldest_bucket(n)
        : env3_source ? history_env3_oldest_bucket(n) : history_oldest_bucket(n);
    if (b0 >= 0) {
        // Exact source alignment even before SNTP: all recorders derive this monotonic bucket from
        // the same esp_timer clock, so a Modbus line cannot slide onto the neighbouring X10A sample.
        j += ",\"b0\":";
        j += std::to_string(b0);
    }
    j += ",\"v\":[";
    httpd_resp_set_type(req, "application/json");
    for (size_t i = 0; i < n; i++) {
        if (i) j += ",";
        // TENTHS on the wire, as plain integers — the browser scales by 10. Integers rather than
        // "41.6": shorter (a 288-sample body is ~1.1 KB instead of ~1.5 KB), exactly representable,
        // and no formatting code to get the sign or a trailing zero wrong. The `unit` field says
        // what they are tenths OF, and www/js/history.js's histHtml documents the same contract on its side.
        if (logic::history_is_absent(samples[i])) j += "null";
        else j += std::to_string(static_cast<int>(samples[i]));
        // Flush every 64 samples so the peak string stays a few hundred bytes rather than the whole
        // body — the point of chunking here.
        if ((i & 63) == 63) {
            if (httpd_resp_send_chunk(req, j.c_str(), j.size()) != ESP_OK) return ESP_FAIL;
            j.clear();
        }
    }
    j += "],\"held\":[";
    for (size_t i = 0; i < nruns; i++) {
        if (i) j += ",";
        j += "[";
        j += std::to_string(runs[i][0]);
        j += ",";
        j += std::to_string(runs[i][1]);
        j += "]";
    }
    j += "]}";
    if (httpd_resp_send_chunk(req, j.c_str(), j.size()) != ESP_OK) return ESP_FAIL;
    return httpd_resp_send_chunk(req, nullptr, 0);      // terminate the chunked response
}

static esp_err_t h_diag(httpd_req_t* req) {
    bool redact = false;
    char q[64];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[4];
        // GET is read-only. Destructive clearing is POST /diag/clear, so a link, prefetch or image
        // request can never erase the evidence it was trying to retrieve.
        if (httpd_query_key_value(q, "verbose", v, sizeof(v)) == ESP_OK) diag_set_verbose(query_flag_on(v));
        if (httpd_query_key_value(q, "redact", v, sizeof(v)) == ESP_OK) redact = query_flag_on(v);
    }
    static char buf[6144];
    size_t n = diag_dump(buf, sizeof(buf));
    httpd_resp_set_type(req, "text/plain");
    if (!redact) return httpd_resp_send(req, buf, n);

    // Redacted: a handful of log statements interpolate a host, an IP or an SSID (logic/redact.hpp).
    // Rewritten line by line and flushed in ~1 KB chunks, rather than as one redacted copy of the
    // whole ring: a replacement is longer than most values it replaces, so the result can GROW, and
    // the two answers to that are a second ~8 KB .bss buffer or a ~6 KB contiguous heap allocation
    // on a heap whose real ceiling is its largest contiguous block. The chunk costs neither, and
    // batching keeps it to a handful of sends instead of one per line.
    std::string chunk;
    chunk.reserve(1280);
    for (size_t start = 0; start < n; ) {
        size_t eol = start;
        while (eol < n && buf[eol] != '\n') eol++;
        if (eol < n) eol++;                                   // keep the newline with its line
        chunk += redact_diag_line(std::string_view(buf + start, eol - start));
        start = eol;
        if (chunk.size() >= 1024) {
            if (httpd_resp_send_chunk(req, chunk.c_str(), chunk.size()) != ESP_OK) return ESP_FAIL;
            chunk.clear();
        }
    }
    if (!chunk.empty() && httpd_resp_send_chunk(req, chunk.c_str(), chunk.size()) != ESP_OK) return ESP_FAIL;
    return httpd_resp_send_chunk(req, nullptr, 0);            // terminate the chunked response
}

static esp_err_t h_diag_clear(httpd_req_t* req) {
    diag_clear();
    return http_send_json(req, "{\"ok\":true}");
}

static esp_err_t h_coredump(httpd_req_t* req) {
    // Match /status.last_crash exactly: a raw image proven to belong to another firmware is not a
    // downloadable report, even when its best-effort boot-time erase failed and bytes remain in the
    // partition. Without this gate the banner says "no dump" while the endpoint serves one that
    // esp-coredump rejects on the ELF SHA mismatch.
    if (!diag_crash_coredump_present()) {
        httpd_resp_set_status(req, "404 Not Found");
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_sendstr(req, "No reportable coredump found");
    }

    size_t address = 0;
    size_t size = 0;
    esp_err_t err = esp_core_dump_image_get(&address, &size);
    if (err == ESP_ERR_NOT_FOUND) {
        httpd_resp_set_status(req, "404 Not Found");
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_sendstr(req, "No coredump found");
    } else if (err != ESP_OK) {
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to retrieve coredump metadata");
    }

    const esp_partition_t* pt = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA,
        ESP_PARTITION_SUBTYPE_DATA_COREDUMP,
        nullptr
    );
    if (!pt) {
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Coredump partition not found");
    }

    httpd_resp_set_type(req, "application/octet-stream");
    httpd_resp_set_hdr(req, "Content-Disposition", "attachment; filename=\"coredump.bin\"");

    char chunk[512];
    size_t offset = 0;
    while (offset < size) {
        size_t to_read = (size - offset > sizeof(chunk)) ? sizeof(chunk) : (size - offset);
        if (esp_partition_read(pt, offset, chunk, to_read) != ESP_OK) {
            // Abort chunked transfer by sending end-of-chunks with error status (though HTTP protocol allows just closing connection)
            httpd_resp_send_chunk(req, nullptr, 0);
            return ESP_FAIL;
        }
        if (httpd_resp_send_chunk(req, chunk, to_read) != ESP_OK) {
            return ESP_FAIL;
        }
        offset += to_read;
    }
    // End chunked transfer
    httpd_resp_send_chunk(req, nullptr, 0);
    return ESP_OK;
}

// POST /coredump/clear erases only the raw image and deliberately preserves the reset/crash record.
// That is distinct from /crash/dismiss below, which acknowledges the whole report. Both mutations
// are POSTs so neither can be triggered by a followed link or speculative GET.
static esp_err_t h_coredump_clear(httpd_req_t* req) {
    const esp_err_t err = esp_core_dump_image_erase();
    if (err == ESP_OK) return http_send_json(req, "{\"ok\":true}");
    return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to erase coredump");
}

// POST /crash/dismiss — acknowledge + DELETE this boot's crash report: erase the core-dump image and
// mark the cached CrashInfo dismissed (diag_crash_dismiss()), so /status.last_crash goes null, the
// retained MQTT crash topic clears on the next heartbeat tick, and the UI banner is gone for good
// rather than for one page view.
//
// Separate from POST /coredump/clear rather than folded into it, because they answer different
// questions: clearing frees the flash slot for the NEXT dump and deliberately leaves the fault reset
// on record, while this says the crash itself has been dealt with. A fault reset carries no dump at
// all in the common case (a stack overflow overruns the dump too), and there /coredump/clear changes
// nothing the banner keys on.
//
// POST, unlike the GET it sits beside: this destroys the one piece of evidence a bug report needs
// (docs/REPORTING.md), so it must not be reachable by a link, a prefetch or a crawler.
static esp_err_t h_crash_dismiss(httpd_req_t* req) {
    if (!diag_crash_dismiss()) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return http_send_json(req, "{\"ok\":false,\"error\":\"coredump erase failed\"}");
    }
    return http_send_json(req, "{\"ok\":true}");
}

static esp_err_t h_scan(httpd_req_t* req) {
    WifiScanEntry e[20];
    int n = wifi_scan(e, 20);
    std::string j = "{\"networks\":[";
    for (int i = 0; i < n; i++) {
        if (i) j += ",";
        j += "{\"ssid\":" + jstr(e[i].ssid) + ",\"rssi\":" + std::to_string(e[i].rssi) + "}";
    }
    j += "]}";
    return http_send_json(req, j.c_str());
}

void http_register_status(httpd_handle_t s, HttpSurface surface) {
    // Provisioning surface (served on the open setup AP too): the setup page and its inert favicon,
    // nothing else. The portal takes a TYPED SSID, so /scan is NOT part of it
    // (see logic/http_surface.hpp).
    http_register_on(s, surface, "/", HTTP_GET, h_index);
    http_register_on(s, surface, "/index.html", HTTP_GET, h_index);
    http_register_on(s, surface, "/favicon.ico", HTTP_GET, h_favicon);

    // Everything below is trusted-LAN only — withheld from the open setup AP (F01). /diag and
    // /coredump can carry WiFi/MQTT secrets; /status/values/models expose live device state.
    if (!http_surface_serves(surface, "/status", /*is_post=*/false)) return;

    http_register(s, "/heat-pump-icon.png", HTTP_GET, h_heat_pump_icon);
    http_register(s, "/status", HTTP_GET, h_status);
    http_register(s, "/values", HTTP_GET, h_values);
    http_register(s, "/history", HTTP_GET, h_history);
    http_register(s, "/scan", HTTP_GET, h_scan);

    http_register(s, "/models", HTTP_GET, h_models);
    http_register(s, "/diag", HTTP_GET, h_diag);
    http_register(s, "/diag/clear", HTTP_POST, h_diag_clear);
    http_register(s, "/coredump", HTTP_GET, h_coredump);
    http_register(s, "/coredump/clear", HTTP_POST, h_coredump_clear);
    http_register(s, "/crash/dismiss", HTTP_POST, h_crash_dismiss);
}

// Captive-portal / SPA catch-all — registered LAST (after every specific route) so it only handles
// unmatched GETs: a 302 to the portal in AP mode, the web UI in STA mode (see h_captive). This is
// what makes an OS connectivity probe (routed here by captive_dns.cpp) open the setup portal.
void http_register_captive(httpd_handle_t s) {
    http_register(s, "/*", HTTP_GET, h_captive);
}

} // namespace daik
