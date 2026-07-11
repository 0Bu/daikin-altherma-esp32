// Captive setup portal: SoftAP "daikin-altherma-setup" serving www/setup.html so WiFi can be
// entered from a phone. See provisioning.hpp. SoftAP + the embedded page are wired below; the
// DNS catch-all that makes it a true captive portal and the shared /scan + /set_wifi routes are
// a TODO port from tesla-key-esp32/provisioning.cpp.
#include "provisioning.hpp"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include <cstring>

extern const unsigned char setup_html_gz_start[] asm("_binary_setup_html_gz_start");
extern const unsigned char setup_html_gz_end[]   asm("_binary_setup_html_gz_end");

namespace daik {

static const char* TAG = "prov";

static esp_err_t setup_page(httpd_req_t* req) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    return httpd_resp_send(req, reinterpret_cast<const char*>(setup_html_gz_start),
                           setup_html_gz_end - setup_html_gz_start);
}

void provisioning_start_ap() {
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));

    wifi_config_t ap = {};
    strcpy(reinterpret_cast<char*>(ap.ap.ssid), "daikin-altherma-setup");
    ap.ap.ssid_len       = strlen("daikin-altherma-setup");
    ap.ap.max_connection = 4;
    ap.ap.authmode       = WIFI_AUTH_OPEN;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "setup AP 'daikin-altherma-setup' up (http://192.168.4.1)");

    // Minimal server: the setup page on any path (wildcard) + TODO: /scan + /set_wifi + captive
    // DNS so the page opens automatically. (The full config server runs after the STA reboot.)
    httpd_handle_t s = nullptr;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn = httpd_uri_match_wildcard;
    if (httpd_start(&s, &cfg) == ESP_OK) {
        httpd_uri_t root = {"/*", HTTP_GET, setup_page, nullptr};
        httpd_register_uri_handler(s, &root);
    }
}

} // namespace daik
