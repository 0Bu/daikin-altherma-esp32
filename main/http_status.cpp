// GET routes: the web UI (embedded gzip), /status, /values, /models, /diag, /scan.
#include "http_handlers.hpp"
#include "config.hpp"
#include "logic/board_pins.hpp"
#include "logic/board_presets.hpp"
#include "logic/captive.hpp"
#include "def/model_names.hpp"
#include "def/models_catalog.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "def/signatures.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "hp_poll.hpp"
#include "logic/crashinfo.hpp"
#include "logic/detect.hpp"
#include "logic/json.hpp"
#include "logic/query_flag.hpp"
#include "logic/reset_reason.hpp"
#include "logic/timestamp.hpp"
#include "logic/ws_policy.hpp"
#include "logic/ws_tx_gate.hpp"
#include "mqtt_ha.hpp"
#include "ota_update.hpp"
#include "safe_mode.hpp"
#include "sntp_time.hpp"
#include "wifi.hpp"
#include "syslog.hpp"

#include "esp_log.h"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_heap_caps.h"
#include "esp_partition.h"
#include "esp_core_dump.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "http_server.hpp"
#include "diag_log.hpp"
#include <algorithm>
#include <atomic>
#include <new>
#include <string>
#include <utility>
#include <vector>

extern const unsigned char index_html_gz_start[] asm("_binary_index_html_gz_start");
extern const unsigned char index_html_gz_end[]   asm("_binary_index_html_gz_end");
extern const unsigned char setup_html_gz_start[] asm("_binary_setup_html_gz_start");
extern const unsigned char setup_html_gz_end[]   asm("_binary_setup_html_gz_end");

namespace daik {

// Quote a string for JSON via the shared RFC 8259 encoder (logic/json.hpp) — the same one the MQTT
// payloads use. Not a local escaper: /scan echoes SSIDs, i.e. arbitrary bytes chosen by any AP in
// radio range, and a control char in one used to emit unparseable JSON.
static std::string jstr(const std::string& s) { return json_quote(s); }

// Is a SoftAP live, i.e. are we the provisioning portal rather than the dashboard? The setup portal
// runs AP-only (provisioning.cpp); APSTA is matched too because it is never the normal operating
// mode (the STA path sets WIFI_MODE_STA), so any mode carrying a live SoftAP means "setup".
static bool setup_mode() {
    wifi_mode_t mode = WIFI_MODE_NULL;
    return esp_wifi_get_mode(&mode) == ESP_OK && (mode == WIFI_MODE_AP || mode == WIFI_MODE_APSTA);
}

// Serve the captive setup page if the device is running in SoftAP (setup) mode, or if
// WiFi is not yet configured. Otherwise serve the full dashboard web UI.
static esp_err_t h_index(httpd_req_t* req) {
    if (setup_mode() || !wifi_configured())
        return http_send_gzip(req, "text/html", setup_html_gz_start, setup_html_gz_end);
    return http_send_gzip(req, "text/html", index_html_gz_start, index_html_gz_end);
}

// The catch-all ("/*"). In SETUP mode an unmatched GET is an OS connectivity probe far more often
// than it is a person typing a URL, so it gets the 302 every captive-portal agent recognises —
// serving the page with 200 (what this did before) is not a signal iOS/Android/Windows act on, and
// dragged the gzip Content-Encoding onto a probe path walked by minimal HTTP clients, not browsers.
// In STA mode this is the dashboard's SPA shell and must NOT redirect. logic/captive.hpp owns the
// split; both branches are host-tested there.
static esp_err_t h_captive(httpd_req_t* req) {
    if (captive_reply_for(req->uri, setup_mode()) == CaptiveReply::Page) return h_index(req);
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", CAPTIVE_PORTAL_URI);
    // The probe result must not be cached: a phone that once saw this network answer a probe from
    // cache would skip the portal on the next join, which is the same invisible failure again.
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, nullptr, 0);   // empty body — nothing to gzip, nothing to render
}

static std::string build_status_json_string() {
    const Config& c = config();
    HpStats     hp  = hp_stats();
    MqttStatus  m   = mqtt_status();
    WifiInfo    wi  = wifi_info();
    std::string j = "{";
    j += "\"version\":" + jstr(esp_app_get_description()->version) + ",";
    j += "\"platform\":" + jstr(CONFIG_IDF_TARGET) + ",";
    j += "\"uptime_s\":" + std::to_string(esp_timer_get_time() / 1000000) + ",";
    // Build identity: the running app's ELF sha (hex) — matches a core dump to the exact firmware
    // that produced it (scripts/decode-coredump.sh), and pairs with last_crash below.
    char elf_sha[65] = {0};
    esp_app_get_elf_sha256(elf_sha, sizeof(elf_sha));
    j += "\"app_elf_sha256\":" + jstr(elf_sha) + ",";
    // GPIOs the UI offers in the RX/TX pin dropdown: the ESP32-S3 chip-safe set, reserving
    // GPIO33-37 only when this build's flash/PSRAM actually run Octal I/O, and dropping the pins
    // this firmware itself drives — the status indicator and the recovery button
    // (logic/board_pins.hpp). The octal-SPI fact comes from config.cpp's hw_octal_spi() and the
    // reserved pins from the live config, the same two inputs /set_hp validation and config_load
    // use, rather than a #if block copied in here.
    int pins[BOARD_PINS_MAX];
    int npins = board_pins_offerable(pins, BOARD_PINS_MAX, hw_octal_spi(), config_reserved_pins(c));
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
    int nlpins = board_pins_local(lpins, BOARD_LOCAL_PINS_MAX, hw_octal_spi(), config_link_pins(c));
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
                                       config_link_pins(c));
    j += "],\"presets\":[";
    for (int i = 0; i < npre; i++) {
        if (i) j += ",";
        j += "{\"name\":";            j += jstr(presets[i]->name);
        j += ",\"led_gpio\":";        j += std::to_string(presets[i]->led_gpio);
        j += ",\"led_type\":";        j += std::to_string(presets[i]->led_type);
        j += ",\"led_inverted\":";    j += presets[i]->led_inverted ? "true" : "false";
        j += ",\"btn_gpio\":";        j += std::to_string(presets[i]->btn_gpio);
        j += ",\"btn_active_low\":";  j += presets[i]->btn_active_low ? "true" : "false";
        j += "}";
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
    j += "\"wifi\":{\"ssid\":" + jstr(c.wifi_ssid) + ",\"ip\":" + jstr(wi.ip) +
         ",\"rssi\":" + (wi.connected ? std::to_string(wi.rssi) : "null") +
         ",\"connected\":" + (wi.connected ? "true" : "false") +
         ",\"bssid\":" + (wi.connected ? jstr(bssid_str) : "null") +
         ",\"mac\":" + jstr(mac_str) +
         ",\"std\":" + (wi.connected ? jstr(wi.std) : "null") +
         // The last credential change was undone (wifi.cpp restored the previous network). Sticky
         // until the next POST /set_wifi, because a rollback leaves no other trace: the reboot it
         // takes wipes the diag ring and the card just shows the old SSID again. The dashboard does
         // not render this yet (a banner lands with the web-UI write-feedback work, PR #65) — for
         // now it is the API's answer to "did my save actually stick?".
         ",\"rolled_back\":" + std::string(c.wifi_rolled_back ? "true" : "false") + "},";
    // has_creds says only WHETHER credentials are stored — never what they are (/status stays
    // secret-free). Read from the CONFIG, not from MqttStatus: creds outlive a disabled broker, and
    // that is exactly the state the UI must offer to clear. It drives the MQTT modal's "remove
    // stored credentials" checkbox, which is the only way to reach /set_mqtt's clear_creds.
    j += "\"mqtt\":{\"configured\":" + std::string(m.configured ? "true" : "false") +
         ",\"connected\":" + (m.connected ? "true" : "false") +
         ",\"tls\":" + (m.tls ? "true" : "false") +
         ",\"has_creds\":" + ((!c.mqtt_user.empty() || !c.mqtt_pass.empty()) ? "true" : "false") +
         ",\"broker\":" + jstr(m.broker) + (m.error.empty() ? "" : ",\"error\":" + jstr(m.error)) + "},";
    SyslogStatus sy = syslog_status();
    j += "\"syslog\":{\"configured\":" + std::string(sy.configured ? "true" : "false") +
         ",\"resolved\":" + (sy.resolved ? "true" : "false") +
         ",\"reachable\":" + (sy.reachable ? "true" : "false") +
         ",\"host\":" + jstr(sy.host) +
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

    // System health: heap headroom + why the device last booted, so both are visible from the LAN /
    // WebSocket without a serial console (and without a broker — unlike the MQTT heartbeat). free_heap
    // is the current free, min_free_heap the since-boot low-water mark (the leak indicator), max_alloc
    // the largest CONTIGUOUS block (the true OOM ceiling on this heap-tight chip). reset_reason reuses
    // the boot-time cached reason (diag_crash.cpp) mapped via logic/reset_reason.hpp; safe_mode is the
    // latched boot-loop recovery flag (safe_mode.cpp — true once too many crash boots accumulated, so
    // poll + MQTT were skipped). Small numbers + a short slug appended to the existing builder — no
    // large contiguous allocation (this also runs in the WS broadcaster).
    j += "\"sys\":{\"free_heap\":" + std::to_string(esp_get_free_heap_size()) +
         ",\"min_free_heap\":" + std::to_string(esp_get_minimum_free_heap_size()) +
         ",\"max_alloc\":" + std::to_string(heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT)) +
         ",\"reset_reason\":" + jstr(reset_reason_name(diag_crash_info().reason)) +
         ",\"safe_mode\":" + (safe_mode_active() ? "true" : "false") + "},";

    // NTP: its own top-level block (not folded into sys), mirroring syslog{} — it is a runtime-
    // configurable network service like syslog/MQTT (POST /set_ntp -> NVS "ntp_server"), not a static
    // board fact like the rest of sys{}. server is the CONFIGURED address (config().ntp_server,
    // resolved from NVS/Kconfig at boot — sntp_time.cpp never changes it live, a server edit reboots),
    // not necessarily who actually answered. synced/time are null/false until the first SNTP reply of
    // this boot lands.
    const TimeStatus ts = time_status();
    j += "\"ntp\":{\"server\":" + jstr(ts.server) +
         ",\"synced\":" + (ts.synced ? "true" : "false") +
         ",\"time\":" + (ts.synced ? jstr(rfc3339_utc(ts.unix_time)) : "null") + "},";

    // Which OTA feed this device follows (logic/ota_channel.hpp; POST /set_ota). Reported HERE and
    // not only on /ota/status because the Settings screen's ESP32 card renders the selector from
    // /status like every other setting — reading a second endpoint on every poll just to colour one
    // dropdown would be a second fetch to fail. `dev` is the same fact the running version already
    // carries in its "-dev.N" suffix, but a device can be SET to a channel it is not running a build
    // from (that is exactly the state between picking a channel and installing from it), so the
    // setting is reported on its own rather than inferred from the version string.
    j += "\"ota\":{\"channel\":" + jstr(ota_channel_name(c.ota_channel)) + "},";

    // Last reset: null on a clean boot, else the crash summary (reset reason + core-dump backtrace).
    // The reason/backtrace come from the boot-time CACHE (diag_crash.cpp) — never re-parsed from
    // flash here, since build_status_json_string() also runs in the poll task's WS broadcaster, which
    // only self-guards std::bad_alloc by dropping the frame; keep this path cheap (no flash PARSE).
    // `coredump` is the exception: it must reflect flash NOW, not at boot, or a dump erased via
    // /coredump?clear=1 leaves a banner that can't be cleared and a download that 404s. Refreshing it
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
    if (c.fp_kw_tenths >= 0)
        j += ",\"capacity_kw\":" + std::to_string(c.fp_kw_tenths / 10) + "." + std::to_string(c.fp_kw_tenths % 10);
    else
        j += ",\"capacity_kw\":null";
    j += ",\"ou_eeprom\":" + jstr(c.fp_eeprom);
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
    return j;
}

static esp_err_t h_status(httpd_req_t* req) {
    std::string j = build_status_json_string();
    return http_send_json(req, j.c_str());
}

// The decoded-values JSON array "[{label,value,unit,reg},…]" — the ONE builder behind GET /values,
// the WS "values" broadcast and the WS subscription snapshot, which all constructed the identical
// body (same snapshot call, same null-for-empty rule, same escaping). Callers wrap it in their own
// envelope ({"values":…} for HTTP, {"type":"values","values":…} for WS). Can throw std::bad_alloc —
// every caller already guards (handle_all, or the WS try/catch), so this stays unguarded.
//
// `reg` is the X10A register PAGE the row was decoded from, and it is what makes the browser's
// held-over rule STRUCTURAL: logic/ou_stale.hpp's ou_page_holds_over() keys on the page (0x20/0x21
// stop being refreshed while the compressor rests), and www/app.js must apply the same rule to the
// rows it shows. Matching those rows by LABEL instead would be a second, drifting copy of the rule —
// the catalog spells them ~50 different ways across the 43 profiles ("Outdoor air temp.",
// "R1T-Outdoor air temp.", "Outdoor Air Temp (R1T)", …), so a pattern list would silently stop
// covering a row the C++ test still gates.
static std::string build_values_array() {
    const size_t cap = def::lookup_view(config().profile.c_str()).count();
    std::vector<CachedValue> v(cap ? cap : 1);
    size_t n = hp_values_snapshot(v.data(), v.size());
    std::string j = "[";
    // Successive += rather than one a + b + c + … chain: a chain materialises every intermediate
    // std::string in the same frame, and this runs on the httpd task (see CLAUDE.md "Memory
    // constraints" — the v1.0.12 stack overflow).
    for (size_t i = 0; i < n; i++) {
        if (i) j += ",";
        j += "{\"label\":";
        j += jstr(v[i].label);
        j += ",\"value\":";
        j += v[i].value.empty() ? "null" : jstr(v[i].value);
        j += ",\"unit\":";
        j += jstr(v[i].unit);
        j += ",\"reg\":";
        j += std::to_string(v[i].reg);
        j += "}";
    }
    j += "]";
    return j;
}

static esp_err_t h_values(httpd_req_t* req) {
    std::string j = "{\"values\":" + build_values_array() + "}";
    return http_send_json(req, j.c_str());
}

// Model catalog + pin hint (def/models_catalog.hpp, generated alongside the def/*.hpp profiles).
// Detection is fully automatic, so this is NOT a picker feed — and in fact NO shipped client reads
// it: the web UI never fetches /models (the RX/TX dropdown takes its GPIOs from /status.pins_avail,
// via logic/board_pins.hpp — a separate mechanism from the embedded `pin_hint`). The whole payload
// (pin_hint, profile_map, outdoor/indoor/tank lists) is legacy metadata, kept as a read-only
// inspection endpoint for humans and scripts.
static esp_err_t h_models(httpd_req_t* req) {
    return http_send_json(req, def::MODELS_JSON);
}

static esp_err_t h_diag(httpd_req_t* req) {
    char q[32];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[4];
        // clear is DESTRUCTIVE, so it fires only on ?clear=1 (the documented value) — not on mere
        // key presence, which used to let ?clear=0 wipe the log. verbose routes through the same
        // policy: verbose=1 -> on, anything else (incl. verbose=0) -> off.
        if (httpd_query_key_value(q, "clear", v, sizeof(v)) == ESP_OK && query_flag_on(v)) diag_clear();
        if (httpd_query_key_value(q, "verbose", v, sizeof(v)) == ESP_OK) diag_set_verbose(query_flag_on(v));
    }
    static char buf[6144];
    size_t n = diag_dump(buf, sizeof(buf));
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, buf, n);
}

static esp_err_t h_coredump(httpd_req_t* req) {
    char q[32];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[4];
        if (httpd_query_key_value(q, "clear", v, sizeof(v)) == ESP_OK && query_flag_on(v)) {
            esp_err_t err = esp_core_dump_image_erase();
            if (err == ESP_OK) {
                return http_send_json(req, "{\"ok\":true}");
            } else {
                return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to erase coredump");
            }
        }
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

static SemaphoreHandle_t s_ws_mtx = nullptr;
static int s_ws_fds[8] = { -1, -1, -1, -1, -1, -1, -1, -1 };
static WsTxGate s_ws_values_gate;
static WsTxGate s_ws_status_gate;

bool http_register_ws_client(int fd) {
    // s_ws_mtx is created once in http_register_status() (single main task, at startup). It is NOT
    // lazily created here: the old lazy path handed a null xSemaphoreCreateMutex() return (OOM)
    // straight to xSemaphoreTake() — a null-deref. If it's missing, refuse the registration.
    if (!s_ws_mtx) return false;
    xSemaphoreTake(s_ws_mtx, portMAX_DELAY);
    bool registered = false;
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] == fd) { registered = true; break; }
    }
    if (!registered) {
        for (int i = 0; i < 8; i++) {
            if (s_ws_fds[i] == -1) {
                s_ws_fds[i] = fd;
                registered = true;
                break;
            }
        }
    }
    xSemaphoreGive(s_ws_mtx);
    return registered;
}

void http_unregister_ws_client(int fd) {
    if (!s_ws_mtx) return;
    xSemaphoreTake(s_ws_mtx, portMAX_DELAY);
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] == fd) {
            s_ws_fds[i] = -1;
            break;
        }
    }
    xSemaphoreGive(s_ws_mtx);
}

struct WsBroadcastContext {
    std::string payload;

    explicit WsBroadcastContext(std::string&& data, WsTxGate& tx_gate)
        : payload(std::move(data)), gate(tx_gate) {}

    void retain() { refs.fetch_add(1, std::memory_order_relaxed); }

    void release() {
        if (refs.fetch_sub(1, std::memory_order_acq_rel) == 1) {
            gate.complete();
            delete this;
        }
    }

private:
    // The initial reference protects construction while callbacks may already run on the HTTP task.
    std::atomic<unsigned> refs{1};
    WsTxGate& gate;
};

static void ws_transfer_complete(esp_err_t err, int socket, void *arg) {
    auto* ctx = static_cast<WsBroadcastContext*>(arg);
    ctx->release();
}

static bool ws_any_clients() {
    bool any = false;
    xSemaphoreTake(s_ws_mtx, portMAX_DELAY);
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] != -1) { any = true; break; }
    }
    xSemaphoreGive(s_ws_mtx);
    return any;
}

// Queue one shared immutable payload to a snapshot of the registered WS clients. The caller has
// already acquired `gate`; it remains occupied until every IDF completion callback has run. This is
// deliberate backpressure: if the HTTP task stops draining its async-work queue, later poll ticks
// are dropped and retained heap stays bounded to one values batch plus one status batch.
//
// Never hold s_ws_mtx while entering the IDF queue. Its completion/close paths run on another task
// and may unregister a client; keeping the registry lock around queue_work would couple those paths
// and can amplify a stalled HTTP task.
static void ws_send_to_all(std::string&& j, WsTxGate& gate) {
    httpd_handle_t server = http_server_handle();
    if (!server || !s_ws_mtx) {
        gate.complete();
        return;
    }

    auto* ctx = new (std::nothrow) WsBroadcastContext(std::move(j), gate);
    if (!ctx) {
        gate.complete();
        return;
    }

    int fds[8];
    int fd_count = 0;
    xSemaphoreTake(s_ws_mtx, portMAX_DELAY);
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] != -1) fds[fd_count++] = s_ws_fds[i];
    }
    xSemaphoreGive(s_ws_mtx);

    httpd_ws_frame_t frame = {};
    frame.payload = reinterpret_cast<uint8_t*>(const_cast<char*>(ctx->payload.c_str()));
    frame.len = ctx->payload.size();
    frame.type = HTTPD_WS_TYPE_TEXT;
    frame.final = true;

    for (int i = 0; i < fd_count; i++) {
        if (httpd_ws_get_fd_info(server, fds[i]) != HTTPD_WS_CLIENT_WEBSOCKET) continue;

        // Retain before queueing: the HTTP task may run the callback before this loop advances.
        ctx->retain();
        esp_err_t err = httpd_ws_send_data_async(server, fds[i], &frame,
                                                  ws_transfer_complete, ctx);
        if (err != ESP_OK) ctx->release();
    }

    // Drop the construction reference. The final queued transfer releases the gate and payload.
    ctx->release();
}

void ws_broadcast_values() {
    if (!http_server_handle() || !s_ws_mtx || !ws_any_clients()) return;
    if (!s_ws_values_gate.try_begin()) return;

    std::string j;
    try {
        j = "{\"type\":\"values\",\"values\":" + build_values_array() + "}";
    } catch (const std::bad_alloc&) {
        s_ws_values_gate.complete();
        return;   // skip this tick under memory pressure rather than abort the poll task
    }
    ws_send_to_all(std::move(j), s_ws_values_gate);
}

void ws_broadcast_status() {
    if (!http_server_handle() || !s_ws_mtx || !ws_any_clients()) return;
    if (!s_ws_status_gate.try_begin()) return;

    std::string j;
    try {
        j = "{\"type\":\"status\",\"status\":" + build_status_json_string() + "}";
    } catch (const std::bad_alloc&) {
        s_ws_status_gate.complete();
        return;   // skip this tick under memory pressure rather than abort the poll task
    }
    ws_send_to_all(std::move(j), s_ws_status_gate);
}

// The /events protocol is one command: a "sub" text frame earns a status+values snapshot and a
// slot in the broadcast list. Every decision about the frame is in logic/ws_policy.hpp, host-tested
// — the cases that matter here (a frame too long to read, a read that failed) are precisely the
// ones a browser never produces and a test can.
//
// Returning ESP_FAIL makes esp_http_server close and clean up the socket, which is the intended
// response to a frame we could neither read nor skip past: its unread body would otherwise be
// parsed as the next frame's header. close_fn (http_server.cpp) unregisters the fd on the way out.
static esp_err_t h_ws_events(httpd_req_t* req) {
    if (req->method == HTTP_GET) {
        return ESP_OK;   // handshake — no frame to read yet
    }

    // max_len = 0 reads the header only, filling in the frame's type and its ANNOUNCED length.
    httpd_ws_frame_t ws_pkt = {};
    if (httpd_ws_recv_frame(req, &ws_pkt, 0) != ESP_OK) return ESP_FAIL;

    switch (ws_frame_plan(ws_pkt.len)) {
        case WsPlan::Skip:
            return ESP_OK;
        case WsPlan::Reject:
            diag_printf("ws: frame of %llu B exceeds the %u B command buffer — closing\n",
                        static_cast<unsigned long long>(ws_pkt.len),
                        static_cast<unsigned>(WS_CMD_MAX));
            return ESP_FAIL;
        case WsPlan::Read:
            break;
    }

    uint8_t buf[WS_CMD_MAX] = {};
    ws_pkt.payload = buf;
    if (httpd_ws_recv_frame(req, &ws_pkt, sizeof(buf)) != ESP_OK) return ESP_FAIL;

    if (ws_frame_action(ws_pkt.type == HTTPD_WS_TYPE_TEXT,
                        reinterpret_cast<const char*>(buf), ws_pkt.len) != WsAction::Subscribe) {
        return ESP_OK;   // not a command we know — no snapshot, and no broadcast slot
    }

    // Subscribe only now: registering on any frame at all meant a client that never asked was still
    // pushed a frame a second, and kept a slot from one that had.
    if (!http_register_ws_client(httpd_req_to_sockfd(req))) {
        diag_printf("ws: broadcast list full — /events subscriber not registered\n");
        return ESP_OK;
    }

    // This WS route is registered with httpd_register_uri_handler (is_websocket needs the
    // raw registration), so it does NOT run under http_register's handle_all try/catch.
    // Guard the JSON build here so a std::bad_alloc under memory pressure drops the send
    // instead of unwinding through esp_http_server's C dispatch -> std::terminate -> reboot.
    try {
        // Send status
        std::string stat = build_status_json_string();
        std::string j_stat = "{\"type\":\"status\",\"status\":" + stat + "}";
        httpd_ws_frame_t f_stat = {};
        f_stat.payload = reinterpret_cast<uint8_t*>(const_cast<char*>(j_stat.c_str()));
        f_stat.len = j_stat.size();
        f_stat.type = HTTPD_WS_TYPE_TEXT;
        f_stat.final = true;
        httpd_ws_send_frame(req, &f_stat);

        // Send values
        std::string j_val = "{\"type\":\"values\",\"values\":" + build_values_array() + "}";
        httpd_ws_frame_t f_val = {};
        f_val.payload = reinterpret_cast<uint8_t*>(const_cast<char*>(j_val.c_str()));
        f_val.len = j_val.size();
        f_val.type = HTTPD_WS_TYPE_TEXT;
        f_val.final = true;
        httpd_ws_send_frame(req, &f_val);
    } catch (const std::bad_alloc&) {
        return ESP_OK;   // drop the subscription snapshot under OOM; client can retry
    }
    return ESP_OK;
}

void http_register_status(httpd_handle_t s, HttpSurface surface) {
    // Create the WS broadcast mutex ONCE, here, on the single main task — not lazily on the first
    // /events subscribe, where a null creation result was fed straight to xSemaphoreTake(). If it
    // can't be allocated, the live-push list stays disabled (register + broadcast all guard on it)
    // rather than crashing the device.
    if (!s_ws_mtx) {
        s_ws_mtx = xSemaphoreCreateMutex();
        if (!s_ws_mtx) ESP_LOGE("http", "WS broadcast mutex alloc failed — /events live push disabled");
    }
    // Provisioning surface (served on the open setup AP too): the setup page, nothing else. The
    // portal takes a TYPED SSID, so /scan is NOT part of it (see logic/http_surface.hpp).
    http_register_on(s, surface, "/", HTTP_GET, h_index);
    http_register_on(s, surface, "/index.html", HTTP_GET, h_index);

    // Everything below is trusted-LAN only — withheld from the open setup AP (F01). /diag and
    // /coredump can carry WiFi/MQTT secrets; /status/values/events/models expose live device state.
    if (!http_surface_serves(surface, "/status", /*is_post=*/false)) return;

    http_register(s, "/status", HTTP_GET, h_status);
    http_register(s, "/values", HTTP_GET, h_values);
    http_register(s, "/scan", HTTP_GET, h_scan);

    httpd_uri_t ws_uri = {};
    ws_uri.uri          = "/events";
    ws_uri.method       = HTTP_GET;
    ws_uri.handler      = h_ws_events;
    ws_uri.user_ctx     = nullptr;
    ws_uri.is_websocket = true;
    httpd_register_uri_handler(s, &ws_uri);

    http_register(s, "/models", HTTP_GET, h_models);
    http_register(s, "/diag", HTTP_GET, h_diag);
    http_register(s, "/coredump", HTTP_GET, h_coredump);
}

// Captive-portal / SPA catch-all — registered LAST (after every specific route) so it only handles
// unmatched GETs: a 302 to the portal in AP mode, the web UI in STA mode (see h_captive). This is
// what makes an OS connectivity probe (routed here by captive_dns.cpp) open the setup portal.
void http_register_captive(httpd_handle_t s) {
    http_register(s, "/*", HTTP_GET, h_captive);
}

} // namespace daik
