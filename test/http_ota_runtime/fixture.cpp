// Execute the production upload handler; OTA worker behavior is exercised in ota_runtime.
#include "sdk.hpp"
#include "http_handlers.hpp"
#include "ota_update.hpp"
#include "config.hpp"
#include <cassert>

constexpr int HTTPD_RESP_USE_STRLEN = -1;
#include HTTP_OTA_SOURCE

namespace fixture {
bool                  dev = true, accept = true, async_ok = true;
unsigned              begun = 0, completed = 0;
daik::OtaUploadSource source;
std::string           sha, status, response;
} // namespace fixture

namespace daik {
OtaChannel config_ota_channel() { return fixture::dev ? OtaChannel::Dev : OtaChannel::Release; }
uint32_t   ota_upload_async(const OtaUploadSource& source, const char* sha) {
    fixture::source = source;
    fixture::sha    = sha;
    return fixture::accept ? 17 : 0;
}
esp_err_t http_begin_ota_upload(httpd_req_t* req, httpd_req_t** copy) {
    if (!fixture::async_ok) return ESP_FAIL;
    *copy = new httpd_req_t(*req);
    ++fixture::begun;
    return ESP_OK;
}
void http_complete_ota_upload(httpd_req_t* req) noexcept {
    fixture::status   = req->status;
    fixture::response = req->response;
    ++fixture::completed;
    delete req;
}
esp_err_t http_send_json(httpd_req_t* req, const char* json) {
    return httpd_resp_sendstr(req, json);
}
uint32_t  ota_check_async(int64_t, const OtaFeedUrls*) { return 0; }
uint32_t  ota_update_async(uint32_t, const char*, const char*, const char*, bool) { return 0; }
OtaStatus ota_status(OtaFeedUrls*) { return {}; }
bool      ota_changelog_chunk(uint32_t, size_t, char*, size_t, size_t&, size_t&) { return false; }
bool      ota_changelog_release(uint32_t) { return true; }
void      http_register_on(httpd_handle_t, HttpSurface, const char*, httpd_method_t,
                           esp_err_t (*)(httpd_req_t*)) {}
} // namespace daik

int main() {
    using namespace fixture;
    constexpr const char* query =
        "/ota/upload?sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    for (const char* bad :
         {"/ota/upload", "/ota/upload?sha256=invalid",
          "/ota/upload?sha256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}) {
        httpd_req_t req;
        req.uri         = bad;
        req.content_len = 8192;
        assert(daik::ota_upload(&req) == ESP_OK && req.status == "400 Bad Request");
        assert(begun == 0);
    }
    httpd_req_t req;
    req.uri         = query;
    req.content_len = 8192;
    req.body        = std::string(8192, 'x');
    req.fragment    = 7;
    dev             = false;
    assert(daik::ota_upload(&req) == ESP_OK && req.status == "403 Forbidden" && begun == 0);
    dev      = true;
    async_ok = false;
    assert(daik::ota_upload(&req) == ESP_OK && req.status == "503 Service Unavailable");
    async_ok = true;
    accept   = false;
    assert(daik::ota_upload(&req) == daik::HTTP_ASYNC_ACCEPTED && completed == 1);
    assert(status == "503 Service Unavailable");
    accept = true;
    for (bool installed : {false, true}) {
        assert(daik::ota_upload(&req) == daik::HTTP_ASYNC_ACCEPTED);
        assert(source.context != &req && source.length == 8192 && sha == std::string(64, 'a'));
        char bytes[32];
        assert(source.read(source.context, bytes, sizeof(bytes)) == 7);
        assert(std::string(bytes, 7) == "xxxxxxx" && req.consumed == 0);
        source.complete(source.context, installed, 17);
        assert(status == (installed ? "200 OK" : "422 Unprocessable Entity"));
        assert(response ==
               std::string("{\"ok\":") + (installed ? "true" : "false") + ",\"generation\":17}");
    }
    assert(begun == 3 && completed == 3);
    std::puts("HTTP OTA upload: channel, SHA query, async refusal, copied ingress and completion "
              "responses passed");
}
