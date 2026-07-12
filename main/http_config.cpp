// POST config routes: /set_wifi, /set_mqtt, /set_hp, /detect. Parse JSON, validate, persist
// to NVS (config.cpp), apply live or reboot as appropriate.
#include "http_handlers.hpp"
#include "config.hpp"
#include "hp_poll.hpp"
#include "logic/config_model.hpp"

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace daik {

static void reboot_soon() { vTaskDelay(pdMS_TO_TICKS(400)); esp_restart(); }

static const char* js(cJSON* o, const char* k, const char* def = "") {
    cJSON* v = cJSON_GetObjectItem(o, k);
    return (v && cJSON_IsString(v)) ? v->valuestring : def;
}
static int ji(cJSON* o, const char* k, int def) {
    cJSON* v = cJSON_GetObjectItem(o, k);
    return (v && cJSON_IsNumber(v)) ? v->valueint : def;
}

static esp_err_t set_wifi(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_sendstr(req, "bad body"); }
    cJSON* j = cJSON_Parse(body);
    if (!j) return httpd_resp_send_500(req);
    Config c = config();
    c.wifi_ssid = js(j, "ssid");
    c.wifi_pass = js(j, "pass");
    cJSON_Delete(j);
    config_save(c);
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

static esp_err_t set_mqtt(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) return httpd_resp_send_500(req);
    cJSON* j = cJSON_Parse(body);
    if (!j) return httpd_resp_send_500(req);
    Config c = config();
    c.mqtt_uri  = js(j, "broker");
    c.mqtt_user = js(j, "user");
    c.mqtt_pass = js(j, "pass");
    cJSON_Delete(j);
    config_save(c);
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

static esp_err_t set_hp(httpd_req_t* req) {
    char body[2048];
    if (http_read_body(req, body, sizeof(body)) < 0) return httpd_resp_send_500(req);
    cJSON* j = cJSON_Parse(body);
    if (!j) return httpd_resp_send_500(req);
    Config c    = config();
    const char* prof = js(j, "profile", c.profile.c_str());
    c.profile      = prof;
    // A concrete model is a manual pin (stops auto-detect); "auto" requests a fresh detection.
    c.profile_auto = (std::string(prof) == "auto");
    if (c.profile_auto) c.fp_valid = false;
    c.lang      = js(j, "lang", c.lang.c_str());
    // proto is auto-detected (hp_detect.cpp), not set from the UI.
    c.rx_pin    = ji(j, "rx", c.rx_pin);
    c.tx_pin    = ji(j, "tx", c.tx_pin);
    c.poll_s    = ji(j, "poll_s", c.poll_s);
    { cJSON* d = cJSON_GetObjectItem(j, "demo"); if (cJSON_IsBool(d)) c.demo = cJSON_IsTrue(d); }
    // values[] -> comma-joined mask. Absent key preserves the stored mask, so the UI can send
    // partial updates (a live poll/language/demo change must not wipe the value selection).
    cJSON* arr = cJSON_GetObjectItem(j, "values");
    if (cJSON_IsArray(arr)) {
        std::string mask;
        cJSON* it;
        cJSON_ArrayForEach(it, arr) if (cJSON_IsString(it)) { if (!mask.empty()) mask += ","; mask += it->valuestring; }
        c.val_mask = mask;
    }
    cJSON_Delete(j);

    std::string reason;
    if (!validate(c, reason)) {
        httpd_resp_set_status(req, "400 Bad Request");
        std::string e = "{\"ok\":false,\"error\":\"" + reason + "\"}";
        return http_send_json(req, e.c_str());
    }
    config_save(c);
    hp_poll_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

// Re-run auto-detection: drop back to the "auto" sentinel + invalidate the stored fingerprint, so
// the next poll cycle sweeps protocol + re-fingerprints the unit (hp_poll.cpp poll_detect).
static esp_err_t do_detect(httpd_req_t* req) {
    Config c       = config();
    c.profile      = "auto";
    c.profile_auto = true;
    c.fp_valid     = false;
    config_save(c);
    hp_poll_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

void http_register_config(httpd_handle_t s) {
    httpd_uri_t routes[] = {
        {"/set_wifi", HTTP_POST, set_wifi, nullptr},
        {"/set_mqtt", HTTP_POST, set_mqtt, nullptr},
        {"/set_hp", HTTP_POST, set_hp, nullptr},
        {"/detect", HTTP_POST, do_detect, nullptr},
    };
    for (auto& r : routes) httpd_register_uri_handler(s, &r);
}

} // namespace daik
