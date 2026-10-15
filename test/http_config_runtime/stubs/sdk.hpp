#pragma once
// SDK boundaries for the full production configuration TU; none contact a network or device.
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <unistd.h>
#include <sys/socket.h>
#include <netdb.h>
#include <fcntl.h>

using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_NOT_FOUND = 0x105,
                    ESP_ERR_HTTPD_RESULT_TRUNC = 0x7001;
using TickType_t                               = uint32_t;
using BaseType_t                               = int;
constexpr BaseType_t pdTRUE = 1, pdFALSE = 0;
#define pdMS_TO_TICKS(x) (static_cast<TickType_t>(x))
using SemaphoreHandle_t = void*;
void              vTaskDelay(TickType_t);
void              esp_restart();
SemaphoreHandle_t xSemaphoreCreateBinary();
BaseType_t        xSemaphoreTake(SemaphoreHandle_t, TickType_t);
BaseType_t        xSemaphoreGive(SemaphoreHandle_t);
void              vSemaphoreDelete(SemaphoreHandle_t);
uint32_t          esp_random(); // fixture-controlled entropy; calls are counted

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
using esp_mqtt_event_handle_t = esp_mqtt_event_t*;
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
using esp_mqtt_client_handle_t = void*;
esp_err_t                esp_crt_bundle_attach(void*);
esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t*);
esp_err_t                esp_mqtt_client_register_event(esp_mqtt_client_handle_t, int,
                                                        void (*)(void*, esp_event_base_t, int32_t, void*), void*);
esp_err_t                esp_mqtt_client_start(esp_mqtt_client_handle_t);
esp_err_t                esp_mqtt_client_stop(esp_mqtt_client_handle_t);
esp_err_t                esp_mqtt_client_destroy(esp_mqtt_client_handle_t);

using httpd_handle_t    = void*;
using httpd_method_t    = int;
constexpr int HTTP_POST = 1, HTTP_GET = 0, HTTPD_414_URI_TOO_LONG = 414,
              HTTPD_400_BAD_REQUEST = 400, HTTPD_RESP_USE_STRLEN = -1;
struct httpd_req_t {
    std::string body, response, status = "200 OK", content_type, query;
    bool        body_failed = false;
    unsigned    chunks = 0, final_chunks = 0;
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
    if (!bytes)
        ++req->final_chunks;
    else {
        ++req->chunks;
        req->response.append(bytes, size);
    }
    return ESP_OK;
}
size_t    httpd_req_get_url_query_len(httpd_req_t*);
esp_err_t httpd_req_get_url_query_str(httpd_req_t*, char*, size_t);
esp_err_t httpd_query_key_value(const char*, const char*, char*, size_t);
size_t    httpd_req_get_hdr_value_len(httpd_req_t*, const char*);
esp_err_t httpd_req_get_hdr_value_str(httpd_req_t*, const char*, char*, size_t);
esp_err_t httpd_resp_send_err(httpd_req_t*, int, const char*);
esp_err_t httpd_resp_send(httpd_req_t*, const char*, int);
esp_err_t httpd_resp_set_hdr(httpd_req_t*, const char*, const char*);

int  config_fixture_socket(int, int, int);
int  config_fixture_connect(int, const sockaddr*, socklen_t);
int  config_fixture_select(int, fd_set*, fd_set*, fd_set*, timeval*);
int  config_fixture_getsockopt(int, int, int, void*, socklen_t*);
int  config_fixture_close(int);
int  config_fixture_fcntl(int, int, ...);
int  config_fixture_getaddrinfo(const char*, const char*, const addrinfo*, addrinfo**);
void config_fixture_freeaddrinfo(addrinfo*);
