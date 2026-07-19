// /ota/check, /ota/update, /ota/status — thin HTTP layer over ota_update.cpp.
#include "http_handlers.hpp"
#include "ota_update.hpp"
#include "logic/json.hpp"   // json_quote — the ONE RFC 8259 encoder every payload goes through
#include "esp_http_server.h"
#include <cstdlib>
#include <string>

namespace daik {

static esp_err_t ota_check(httpd_req_t* req) {
    char q[48];
    int64_t ms = 0;
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[24];
        if (httpd_query_key_value(q, "ms", v, sizeof(v)) == ESP_OK) ms = strtoll(v, nullptr, 10);
    }
    ota_check_async(ms);
    return http_send_json(req, "{\"ok\":true}");
}

static esp_err_t ota_do(httpd_req_t* req) {
    ota_update_async();
    return http_send_json(req, "{\"ok\":true}");
}

static esp_err_t ota_stat(httpd_req_t* req) {
    OtaStatus s = ota_status();
    // Every string field goes through json_quote (json.hpp), not raw concatenation: `message` and
    // `available` ARE network-derived now that the manifest check has landed (a version parsed from
    // a remote manifest, an error string chosen from a fetch failure), and one '"' or control byte
    // there would break JSON.parse in the UI's update flow. `state`/`current` remain internal, but
    // routing all four through the one encoder is what meant the OTA work did not have to remember.
    // json_quote emits the surrounding quotes.
    std::string j = "{\"state\":" + json_quote(s.state) +
                    ",\"progress\":" + std::to_string(s.progress) +
                    ",\"message\":" + json_quote(s.message) +
                    ",\"update_available\":" + (s.update_available ? "true" : "false") +
                    ",\"available\":" + json_quote(s.available) +
                    ",\"current\":" + json_quote(s.current) + "}";
    return http_send_json(req, j.c_str());
}

void http_register_ota(httpd_handle_t s) {
    http_register(s, "/ota/check", HTTP_GET, ota_check);
    http_register(s, "/ota/update", HTTP_POST, ota_do);
    http_register(s, "/ota/status", HTTP_GET, ota_stat);
}

} // namespace daik
