// GET routes: the web UI (embedded gzip), /status, /values, /models, /diag, /scan.
#include "http_handlers.hpp"
#include "config.hpp"
#include "logic/board_pins.hpp"
#include "def/model_names.hpp"
#include "def/models_catalog.hpp"
#include "def/signatures.hpp"
#include "def/registry.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "hp_poll.hpp"
#include "logic/crashinfo.hpp"
#include "logic/detect.hpp"
#include "mqtt_ha.hpp"
#include "ota_update.hpp"
#include "wifi.hpp"

#include "esp_log.h"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "esp_partition.h"
#include "esp_core_dump.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "http_server.hpp"
#include "diag_log.hpp"
#include <algorithm>
#include <new>
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
    // GPIOs the UI offers in the RX/TX pin dropdown (per-target, broken-out + safe; logic/board_pins.hpp).
    BoardPins bp = board_pins(CONFIG_IDF_TARGET);
    j += "\"pins_avail\":[";
    for (int i = 0; i < bp.count; i++) { if (i) j += ","; j += std::to_string(bp.pins[i]); }
    j += "],";
    j += "\"wifi\":{\"ssid\":" + jstr(c.wifi_ssid) + ",\"ip\":" + jstr(wi.ip) +
         ",\"rssi\":" + (wi.connected ? std::to_string(wi.rssi) : "null") +
         ",\"connected\":" + (wi.connected ? "true" : "false") + "},";
    j += "\"mqtt\":{\"configured\":" + std::string(m.configured ? "true" : "false") +
         ",\"connected\":" + (m.connected ? "true" : "false") +
         ",\"tls\":" + (m.tls ? "true" : "false") +
         ",\"broker\":" + jstr(m.broker) + (m.error.empty() ? "" : ",\"error\":" + jstr(m.error)) + "},";
    j += "\"hp\":{\"proto\":" + jstr(std::string(1, static_cast<char>(c.proto))) +
         ",\"rx\":" + std::to_string(c.rx_pin) + ",\"tx\":" + std::to_string(c.tx_pin) +
         ",\"connected\":" + (hp.connected ? "true" : "false") +
         ",\"last_ok_s\":" + std::to_string(hp.last_ok_s) +
         ",\"registers\":" + std::to_string(hp.registers) +
         ",\"values\":" + std::to_string(hp.values) +
         ",\"crc_err\":" + std::to_string(hp.crc_err) +
         ",\"timeout_err\":" + std::to_string(hp.timeout_err) + "},";
    j += "\"profile\":{\"id\":" + jstr(c.profile) + "},";

    // Last reset: null on a clean boot, else the cached crash summary (reset reason + core-dump
    // backtrace). Read from the boot-time CACHE (diag_crash.cpp) — never re-parsed from flash here,
    // since build_status_json_string() also runs in the poll task's WS broadcaster, which only
    // self-guards std::bad_alloc by dropping the frame; keep this path cheap (no flash parse).
    const CrashInfo& crash = diag_crash_info();
    j += "\"last_crash\":" + std::string(crash_is_notable(crash) ? build_crash_json(crash) : "null") + ",";

    // Auto-detection: proto/model derived from the X10A bus (hp_detect.cpp). The candidate set is
    // recomputed cheaply from the stored fingerprint (no re-probe) via the pure logic/detect.hpp;
    // the UI auto-applies a lone candidate and offers the reduced set when ambiguous.
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

static esp_err_t h_values(httpd_req_t* req) {
    const size_t cap = def::lookup(config().profile.c_str()).count;
    std::vector<CachedValue> v(cap ? cap : 1);
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

static esp_err_t h_coredump(httpd_req_t* req) {
    char q[32];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[4];
        if (httpd_query_key_value(q, "clear", v, sizeof(v)) == ESP_OK && v[0] == '1') {
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

void http_register_ws_client(int fd) {
    if (!s_ws_mtx) s_ws_mtx = xSemaphoreCreateMutex();
    xSemaphoreTake(s_ws_mtx, portMAX_DELAY);
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] == fd) {
            xSemaphoreGive(s_ws_mtx);
            return;
        }
    }
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] == -1) {
            s_ws_fds[i] = fd;
            break;
        }
    }
    xSemaphoreGive(s_ws_mtx);
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

struct WsPacketContext {
    std::string payload;
    httpd_ws_frame_t frame;
};

static void ws_transfer_complete(esp_err_t err, int socket, void *arg) {
    auto* ctx = static_cast<WsPacketContext*>(arg);
    delete ctx;
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

// Queue an async copy of `j` to every registered WS client. These broadcasts run in the poll task
// (hp_poll.cpp), which has NO OOM guard above it — so, unlike an HTTP handler, an uncaught
// std::bad_alloc here would abort the whole device. Allocate each per-client send buffer with
// nothrow-new and a guarded copy, and just skip any client we cannot allocate for this tick.
static void ws_send_to_all(const std::string& j) {
    httpd_handle_t server = http_server_handle();
    if (!server || !s_ws_mtx) return;
    xSemaphoreTake(s_ws_mtx, portMAX_DELAY);
    for (int i = 0; i < 8; i++) {
        if (s_ws_fds[i] == -1) continue;
        WsPacketContext* ctx = new (std::nothrow) WsPacketContext();
        if (!ctx) continue;
        try {
            ctx->payload = j;
        } catch (const std::bad_alloc&) {
            delete ctx;
            continue;
        }
        memset(&ctx->frame, 0, sizeof(httpd_ws_frame_t));
        ctx->frame.payload = reinterpret_cast<uint8_t*>(const_cast<char*>(ctx->payload.c_str()));
        ctx->frame.len = ctx->payload.size();
        ctx->frame.type = HTTPD_WS_TYPE_TEXT;
        ctx->frame.final = true;
        esp_err_t err = httpd_ws_send_data_async(server, s_ws_fds[i], &ctx->frame, ws_transfer_complete, ctx);
        if (err != ESP_OK) delete ctx;
    }
    xSemaphoreGive(s_ws_mtx);
}

void ws_broadcast_values() {
    if (!http_server_handle() || !s_ws_mtx || !ws_any_clients()) return;

    std::string j;
    try {
        const size_t cap = def::lookup(config().profile.c_str()).count;
        std::vector<CachedValue> v(cap ? cap : 1);
        size_t n = hp_values_snapshot(v.data(), v.size());
        j = "{\"type\":\"values\",\"values\":[";
        for (size_t i = 0; i < n; i++) {
            if (i) j += ",";
            j += "{\"label\":" + jstr(v[i].label) +
                 ",\"value\":" + (v[i].value.empty() ? "null" : jstr(v[i].value)) +
                 ",\"unit\":" + jstr(v[i].unit) + "}";
        }
        j += "]}";
    } catch (const std::bad_alloc&) {
        return;   // skip this tick under memory pressure rather than abort the poll task
    }
    ws_send_to_all(j);
}

void ws_broadcast_status() {
    if (!http_server_handle() || !s_ws_mtx || !ws_any_clients()) return;

    std::string j;
    try {
        j = "{\"type\":\"status\",\"status\":" + build_status_json_string() + "}";
    } catch (const std::bad_alloc&) {
        return;   // skip this tick under memory pressure rather than abort the poll task
    }
    ws_send_to_all(j);
}

static esp_err_t h_ws_events(httpd_req_t* req) {
    if (req->method == HTTP_GET) {
        return ESP_OK;
    }

    int fd = httpd_req_to_sockfd(req);
    http_register_ws_client(fd);

    httpd_ws_frame_t ws_pkt = {};
    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret == ESP_OK) {
        if (ws_pkt.len > 0) {
            uint8_t buf[16];
            ws_pkt.payload = buf;
            size_t max_len = ws_pkt.len < sizeof(buf) ? ws_pkt.len : sizeof(buf);
            httpd_ws_recv_frame(req, &ws_pkt, max_len);

            if (max_len >= 3 && memcmp(buf, "sub", 3) == 0) {
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
                    const size_t cap = def::lookup(config().profile.c_str()).count;
                    std::vector<CachedValue> v(cap ? cap : 1);
                    size_t n = hp_values_snapshot(v.data(), v.size());
                    std::string j_val = "{\"type\":\"values\",\"values\":[";
                    for (size_t i = 0; i < n; i++) {
                        if (i) j_val += ",";
                        j_val += "{\"label\":" + jstr(v[i].label) +
                                 ",\"value\":" + (v[i].value.empty() ? "null" : jstr(v[i].value)) +
                                 ",\"unit\":" + jstr(v[i].unit) + "}";
                    }
                    j_val += "]}";
                    httpd_ws_frame_t f_val = {};
                    f_val.payload = reinterpret_cast<uint8_t*>(const_cast<char*>(j_val.c_str()));
                    f_val.len = j_val.size();
                    f_val.type = HTTPD_WS_TYPE_TEXT;
                    f_val.final = true;
                    httpd_ws_send_frame(req, &f_val);
                } catch (const std::bad_alloc&) {
                    return ESP_OK;   // drop the subscription snapshot under OOM; client can retry
                }
            }
        }
    }
    return ESP_OK;
}

void http_register_status(httpd_handle_t s) {
    http_register(s, "/", HTTP_GET, h_index);
    http_register(s, "/index.html", HTTP_GET, h_index);
    http_register(s, "/status", HTTP_GET, h_status);
    http_register(s, "/values", HTTP_GET, h_values);

    httpd_uri_t ws_uri = {};
    ws_uri.uri          = "/events";
    ws_uri.method       = HTTP_GET;
    ws_uri.handler      = h_ws_events;
    ws_uri.user_ctx     = nullptr;
    ws_uri.is_websocket = true;
    httpd_register_uri_handler(s, &ws_uri);

    http_register(s, "/models", HTTP_GET, h_models);
    http_register(s, "/diag", HTTP_GET, h_diag);
    http_register(s, "/scan", HTTP_GET, h_scan);
    http_register(s, "/coredump", HTTP_GET, h_coredump);
}

// Captive-portal / SPA catch-all — registered LAST (after every specific route) so it only handles
// unmatched GETs: the setup page in AP mode, the web UI in STA mode (see h_index). This is what
// makes an OS connectivity probe (routed here by captive_dns.cpp) open the setup portal.
void http_register_captive(httpd_handle_t s) {
    http_register(s, "/*", HTTP_GET, h_index);
}

} // namespace daik
