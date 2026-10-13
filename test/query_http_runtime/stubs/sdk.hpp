#pragma once
// Compile-only SDK declarations for unrelated config handlers. The fixture invokes only /hp/query.
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <unistd.h>
using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1;
using TickType_t            = uint32_t;
using BaseType_t            = int;
constexpr BaseType_t pdTRUE = 1, pdFALSE = 0;
#define pdMS_TO_TICKS(x) (static_cast<TickType_t>(x))
using SemaphoreHandle_t = void*;
inline void vTaskDelay(TickType_t) { throw std::runtime_error("unrelated task delay reached"); }
inline void esp_restart() { throw std::runtime_error("unrelated restart reached"); }
inline SemaphoreHandle_t xSemaphoreCreateBinary() { return nullptr; }
inline BaseType_t        xSemaphoreTake(SemaphoreHandle_t, TickType_t) { return pdFALSE; }
inline BaseType_t        xSemaphoreGive(SemaphoreHandle_t) { return pdTRUE; }
inline void              vSemaphoreDelete(SemaphoreHandle_t) {}
using esp_event_base_t       = const char*;
using esp_mqtt_event_id_t    = int;
constexpr int MQTT_EVENT_ANY = -1, MQTT_EVENT_CONNECTED = 1, MQTT_EVENT_DISCONNECTED = 2,
              MQTT_EVENT_ERROR = 3, MQTT_ERROR_TYPE_TCP_TRANSPORT = 1, MQTT_CONNECTION_ACCEPTED = 0,
              MQTT_CONNECTION_REFUSE_BAD_USERNAME = 4, MQTT_CONNECTION_REFUSE_NOT_AUTHORIZED = 5;
struct esp_mqtt_error_codes_t {
    int error_type = 0, connect_return_code = 0;
};
struct esp_mqtt_event_t {
    esp_mqtt_error_codes_t* error_handle = nullptr;
};
using esp_mqtt_event_handle_t  = esp_mqtt_event_t*;
using esp_mqtt_client_handle_t = void*;
struct esp_mqtt_client_config_t {
    struct {
        struct {
            const char* uri = nullptr;
        } address;
        struct {
            esp_err_t (*crt_bundle_attach)(void*) = nullptr;
        } verification;
    } broker;
    struct {
        const char* client_id = nullptr;
        const char* username  = nullptr;
        struct {
            const char* password = nullptr;
        } authentication;
    } credentials;
    struct {
        int keepalive = 0;
    } session;
};
inline esp_err_t                esp_crt_bundle_attach(void*) { return ESP_OK; }
inline esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t*) {
    return nullptr;
}
inline esp_err_t esp_mqtt_client_register_event(esp_mqtt_client_handle_t, int,
                                                void (*)(void*, esp_event_base_t, int32_t, void*),
                                                void*) {
    return ESP_FAIL;
}
inline esp_err_t esp_mqtt_client_start(esp_mqtt_client_handle_t) { return ESP_FAIL; }
inline esp_err_t esp_mqtt_client_stop(esp_mqtt_client_handle_t) { return ESP_FAIL; }
inline esp_err_t esp_mqtt_client_destroy(esp_mqtt_client_handle_t) { return ESP_FAIL; }
using httpd_handle_t    = void*;
using httpd_method_t    = int;
constexpr int HTTP_POST = 1;
struct httpd_req_t {
    std::string body, response, status = "200 OK", content_type;
    unsigned    probe_calls = 0, final_chunks = 0, chunks = 0;
    size_t      max_chunk   = 0;
    int         fail_chunk  = -1;
    bool        body_failed = false;
};
inline esp_err_t httpd_resp_set_status(httpd_req_t* req, const char* status) {
    req->status = status;
    return ESP_OK;
}
inline esp_err_t httpd_resp_set_type(httpd_req_t* req, const char* type) {
    req->content_type = type;
    return ESP_OK;
}
inline esp_err_t httpd_resp_send_chunk(httpd_req_t* req, const char* bytes, size_t size) {
    if (req->fail_chunk == static_cast<int>(req->chunks)) return ESP_FAIL;
    if (!bytes)
        ++req->final_chunks;
    else {
        ++req->chunks;
        if (size > req->max_chunk) req->max_chunk = size;
        req->response.append(bytes, size);
    }
    return ESP_OK;
}
