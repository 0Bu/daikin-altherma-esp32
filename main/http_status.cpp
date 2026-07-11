// GET routes: the web UI (embedded gzip), /status, /values, /models, /diag, /scan.
#include "http_handlers.hpp"
#include "config.hpp"
#include "def/models_catalog.hpp"
#include "def/signatures.hpp"
#include "diag_log.hpp"
#include "hp_poll.hpp"
#include "logic/detect.hpp"
#include "mqtt_ha.hpp"
#include "ota_update.hpp"
#include "wifi.hpp"

#include "esp_app_desc.h"
#include "esp_http_server.h"
#include <string>
#include <vector>

extern const unsigned char index_html_gz_start[] asm("_binary_index_html_gz_start");
extern const unsigned char index_html_gz_end[]   asm("_binary_index_html_gz_end");
extern const unsigned char setup_html_gz_start[] asm("_binary_setup_html_gz_start");
extern const unsigned char setup_html_gz_end[]   asm("_binary_setup_html_gz_end");

namespace daik {

static std::string jstr(const std::string& s) {
    std::string o = "\"";
    for (char c : s) { if (c == '"' || c == '\\') o += '\\'; o += c; }
    return o + "\"";
}

// While unprovisioned (SoftAP setup mode) serve the captive setup page; once WiFi is configured
// serve the full web UI. One shared :80 server handles both modes (see provisioning.cpp).
static esp_err_t h_index(httpd_req_t* req) {
    if (!wifi_configured())
        return http_send_gzip(req, "text/html", setup_html_gz_start, setup_html_gz_end);
    return http_send_gzip(req, "text/html", index_html_gz_start, index_html_gz_end);
}

static esp_err_t h_status(httpd_req_t* req) {
    const Config& c = config();
    HpStats     hp  = hp_stats();
    MqttStatus  m   = mqtt_status();
    std::string j = "{";
    j += "\"version\":" + jstr(esp_app_get_description()->version) + ",";
    j += "\"platform\":" + jstr(CONFIG_IDF_TARGET) + ",";
    j += "\"wifi\":{\"ssid\":" + jstr(c.wifi_ssid) + "},";   // TODO: live rssi/ip via wifi.cpp getter
    j += "\"mqtt\":{\"configured\":" + std::string(m.configured ? "true" : "false") +
         ",\"connected\":" + (m.connected ? "true" : "false") +
         ",\"tls\":" + (m.tls ? "true" : "false") +
         ",\"broker\":" + jstr(m.broker) + (m.error.empty() ? "" : ",\"error\":" + jstr(m.error)) + "},";
    j += "\"hp\":{\"proto\":" + jstr(std::string(1, static_cast<char>(c.proto))) +
         ",\"rx\":" + std::to_string(c.rx_pin) + ",\"tx\":" + std::to_string(c.tx_pin) +
         ",\"poll_s\":" + std::to_string(c.poll_s) +
         ",\"connected\":" + (hp.connected ? "true" : "false") +
         ",\"last_ok_s\":" + std::to_string(hp.last_ok_s) +
         ",\"registers\":" + std::to_string(hp.registers) +
         ",\"values\":" + std::to_string(hp.values) +
         ",\"crc_err\":" + std::to_string(hp.crc_err) +
         ",\"timeout_err\":" + std::to_string(hp.timeout_err) +
         ",\"demo\":" + (c.demo ? "true" : "false") + "},";
    j += "\"profile\":{\"id\":" + jstr(c.profile) + ",\"lang\":" + jstr(c.lang) + "},";

    // Auto-detection: proto/model derived from the X10A bus (hp_detect.cpp). The candidate set is
    // recomputed cheaply from the stored fingerprint (no re-probe) via the pure logic/detect.hpp;
    // the UI auto-applies a lone candidate and offers the reduced set when ambiguous.
    j += "\"detect\":{\"proto\":" + jstr(std::string(1, static_cast<char>(c.proto)));
    j += ",\"rx\":" + std::to_string(c.rx_pin) + ",\"tx\":" + std::to_string(c.tx_pin);
    j += ",\"auto\":" + std::string(c.profile_auto ? "true" : "false");
    j += ",\"valid\":" + std::string(c.fp_valid ? "true" : "false");
    if (c.fp_kw_tenths >= 0)
        j += ",\"capacity_kw\":" + std::to_string(c.fp_kw_tenths / 10) + "." + std::to_string(c.fp_kw_tenths % 10);
    else
        j += ",\"capacity_kw\":null";
    j += ",\"ou_eeprom\":" + jstr(c.fp_eeprom) + ",\"candidates\":[";
    int total = 0;
    if (c.fp_valid) {
        Fingerprint fp{};
        fp.page_mask = c.fp_pages;
        fp.kw_tenths = c.fp_kw_tenths;
        int nsig = 0;
        const Signature* sigs = def::signatures(nsig);
        const char* out[64];
        total = detect_candidates(sigs, nsig, fp, out, static_cast<int>(sizeof(out) / sizeof(out[0])));
        const int shown = total < 64 ? total : 64;
        for (int i = 0; i < shown; i++) { if (i) j += ","; j += jstr(out[i]); }
    }
    j += "],\"ambiguous\":" + std::string(total > 1 ? "true" : "false") + "}";
    j += "}";
    return http_send_json(req, j.c_str());
}

static esp_err_t h_values(httpd_req_t* req) {
    std::vector<CachedValue> v(64);
    size_t n = hp_values_snapshot(v.data(), v.size());
    std::string j = "{\"values\":[";
    for (size_t i = 0; i < n; i++) {
        if (i) j += ",";
        j += "{\"label\":" + jstr(v[i].label) +
             ",\"value\":" + (v[i].value.empty() ? "null" : jstr(v[i].value)) +
             ",\"unit\":" + jstr(v[i].unit) + "}";
    }
    j += "]}";
    return http_send_json(req, j.c_str());
}

// Model catalog for the Setup UI. Every embedded profile is listed as an "outdoor unit"
// choice; the web UI maps the selection to a profile id. The JSON is generated into
// def/models_catalog.hpp alongside the def/*.hpp profiles.
static esp_err_t h_models(httpd_req_t* req) {
    return http_send_json(req, def::MODELS_JSON);
}

static esp_err_t h_diag(httpd_req_t* req) {
    char q[32];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[4];
        if (httpd_query_key_value(q, "clear", v, sizeof(v)) == ESP_OK) diag_clear();
        if (httpd_query_key_value(q, "verbose", v, sizeof(v)) == ESP_OK) diag_set_verbose(v[0] == '1');
    }
    static char buf[6144];
    size_t n = diag_dump(buf, sizeof(buf));
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, buf, n);
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

void http_register_status(httpd_handle_t s) {
    httpd_uri_t routes[] = {
        {"/", HTTP_GET, h_index, nullptr},
        {"/index.html", HTTP_GET, h_index, nullptr},
        {"/status", HTTP_GET, h_status, nullptr},
        {"/values", HTTP_GET, h_values, nullptr},
        {"/models", HTTP_GET, h_models, nullptr},
        {"/diag", HTTP_GET, h_diag, nullptr},
        {"/scan", HTTP_GET, h_scan, nullptr},
    };
    for (auto& r : routes) httpd_register_uri_handler(s, &r);
}

// Captive-portal / SPA catch-all — registered LAST (after every specific route) so it only handles
// unmatched GETs: the setup page in AP mode, the web UI in STA mode (see h_index). This is what
// makes an OS connectivity probe (routed here by captive_dns.cpp) open the setup portal.
void http_register_captive(httpd_handle_t s) {
    httpd_uri_t r = {"/*", HTTP_GET, h_index, nullptr};
    httpd_register_uri_handler(s, &r);
}

} // namespace daik
