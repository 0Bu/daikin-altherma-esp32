// POST config routes: /set_wifi, /set_mqtt, /set_syslog, /set_hp, /detect. Parse JSON, validate, then
// apply: WiFi/MQTT/syslog persist to NVS + reboot; /set_hp persists the RX/TX pin cache (no reboot)
// but keeps the model session-only; /detect re-runs detection in RAM.
#include "http_handlers.hpp"
#include "config.hpp"
#include "hp_poll.hpp"
#include "logic/config_model.hpp"

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "soc/soc_caps.h"   // SOC_GPIO_PIN_COUNT — per-target GPIO count for pin validation

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
    if (http_read_body(req, body, sizeof(body)) < 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad body");
    }
    cJSON* j = cJSON_Parse(body);
    if (!j) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad json");
    }
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
    if (http_read_body(req, body, sizeof(body)) < 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad body");
    }
    cJSON* j = cJSON_Parse(body);
    if (!j) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad json");
    }
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
    if (http_read_body(req, body, sizeof(body)) < 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad body");
    }
    cJSON* j = cJSON_Parse(body);
    if (!j) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad json");
    }
    Config c    = config();
    // The RX/TX pins are the physical X10A wiring: PERSISTED so a manual override survives a reboot
    // (config_save below). The model "profile" is session-only — only touched when the request
    // explicitly sends "profile"; a wiring-only patch omits it so it does not re-select the model or
    // invalidate a settled fingerprint (which would force a spurious re-detect next poll).
    cJSON* profItem     = cJSON_GetObjectItem(j, "profile");
    bool   profile_sent = cJSON_IsString(profItem);
    // "auto" (the UI's only value) requests a fresh detection; a concrete id pins the model for this
    // session (accepted for API flexibility, never offered in the UI).
    if (profile_sent) c.profile = profItem->valuestring;
    if (set_hp_clears_fingerprint(profile_sent, c.profile)) c.fp_valid = false;
    // proto is auto-detected (hp_detect.cpp), not set from the UI.
    c.rx_pin    = ji(j, "rx", c.rx_pin);
    c.tx_pin    = ji(j, "tx", c.tx_pin);
    cJSON_Delete(j);

    std::string reason;
    if (!validate(c, reason, SOC_GPIO_PIN_COUNT - 1)) {
        httpd_resp_set_status(req, "400 Bad Request");
        std::string e = "{\"ok\":false,\"error\":\"" + reason + "\"}";
        return http_send_json(req, e.c_str());
    }
    config_save(c);   // persist the pin cache (config_save writes link+creds; profile/fp stay RAM)
    hp_poll_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

static esp_err_t set_syslog(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad body");
    }
    cJSON* j = cJSON_Parse(body);
    if (!j) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "bad json");
    }
    std::string host = js(j, "host");
    int port = ji(j, "port", 514);
    cJSON_Delete(j);

    // Only the port range is validated synchronously (cheap). DNS resolution + reachability are done
    // asynchronously by the syslog task and surfaced via /status.syslog {resolved, reachable, error},
    // so the request path never blocks on a network probe — consistent with /set_wifi and /set_mqtt.
    if (!host.empty() && (port < 1 || port > 65535)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(req, "{\"ok\":false,\"error\":\"port out of range\"}");
    }

    Config c = config();
    c.syslog_host = host;
    c.syslog_port = port;
    config_save(c);
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

// Re-run auto-detection now (without waiting for a reboot): drop back to the "auto" sentinel +
// invalidate the fingerprint, so the next poll cycle sweeps protocol + re-fingerprints the unit
// (hp_poll.cpp poll_detect). Detection state is session-only, so this is a RAM-only reset.
static esp_err_t do_detect(httpd_req_t* req) {
    Config c   = config();
    c.profile  = "auto";
    c.fp_valid = false;
    config_set_runtime(c);
    hp_poll_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

void http_register_config(httpd_handle_t s) {
    http_register(s, "/set_wifi", HTTP_POST, set_wifi);
    http_register(s, "/set_mqtt", HTTP_POST, set_mqtt);
    http_register(s, "/set_syslog", HTTP_POST, set_syslog);
    http_register(s, "/set_hp", HTTP_POST, set_hp);
    http_register(s, "/detect", HTTP_POST, do_detect);
}

} // namespace daik
