// /ota/check, /ota/update, /ota/status, /ota/changelog — thin HTTP layer over ota_update.cpp.
#include "http_handlers.hpp"
#include "ota_update.hpp"
#include "logic/json.hpp"        // json_append_quoted — the ONE RFC 8259 encoder every payload uses
#include "logic/query_flag.hpp"  // query_flag_on — a flag fires on "1" and nothing else
#include "esp_http_server.h"
#include <cstdio>
#include <cstdlib>
#include <string_view>

namespace daik {

static esp_err_t ota_check(httpd_req_t* req) {
    char q[48];
    int64_t ms = 0;
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
        char v[24];
        if (httpd_query_key_value(q, "ms", v, sizeof(v)) == ESP_OK) ms = strtoll(v, nullptr, 10);
    }
    const uint32_t generation = ota_check_async(ms);
    if (!generation) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        return http_send_json(req, "{\"ok\":false,\"error\":\"ota operation not accepted\"}");
    }
    char response[48];
    snprintf(response, sizeof(response), "{\"ok\":true,\"generation\":%lu}",
             static_cast<unsigned long>(generation));
    return http_send_json(req, response);
}

// POST /ota/update?after=...&channel=...&version=...&sha256=...[&downgrade=1] — atomically
// consume one completed check's exact artifact lease and start its download.
//
// ?downgrade=1 is the channel switch, and the only way to install a build that is older than the
// running one (dev -> the last release). It is a query FLAG rather than a body field on purpose and
// passes through the host-tested query_flag_on, so ?downgrade=0 cannot mean the same thing as
// ?downgrade=1. The permission travels with THIS POST only — it is never stored, so a later
// automatic check can never inherit it — and it relaxes nothing but the version ordering
// (logic/version_cmp.hpp). Evidence deletion is kept out of query flags entirely: /diag/clear and
// /coredump/clear are explicit POST routes.
static esp_err_t ota_do(httpd_req_t* req) {
    char q[192];
    char after_text[16] = {0};
    char channel[8] = {0};
    char version[32] = {0};
    char app_sha256[65] = {0};
    char downgrade_text[8] = {0};
    bool downgrade = false;
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) != ESP_OK ||
        httpd_query_key_value(q, "after", after_text, sizeof(after_text)) != ESP_OK ||
        httpd_query_key_value(q, "channel", channel, sizeof(channel)) != ESP_OK ||
        httpd_query_key_value(q, "version", version, sizeof(version)) != ESP_OK ||
        httpd_query_key_value(q, "sha256", app_sha256, sizeof(app_sha256)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(req, "{\"ok\":false,\"error\":\"checked OTA artifact identity required\"}");
    }
    if (httpd_query_key_value(q, "downgrade", downgrade_text, sizeof(downgrade_text)) == ESP_OK)
        downgrade = query_flag_on(downgrade_text);
    char* after_end = nullptr;
    const unsigned long long after_value = std::strtoull(after_text, &after_end, 10);
    if (!after_value || after_value > UINT32_MAX || !after_end || *after_end != '\0') {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(req, "{\"ok\":false,\"error\":\"invalid OTA check generation\"}");
    }
    const uint32_t generation = ota_update_async(static_cast<uint32_t>(after_value), channel,
                                                  version, app_sha256, downgrade);
    if (!generation) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        return http_send_json(req, "{\"ok\":false,\"error\":\"ota operation not accepted\"}");
    }
    char response[48];
    snprintf(response, sizeof(response), "{\"ok\":true,\"generation\":%lu}",
             static_cast<unsigned long>(generation));
    return http_send_json(req, response);
}

static esp_err_t ota_stat(httpd_req_t* req) {
    const OtaStatus s = ota_status();
    // Every string field goes through json_append_quoted (json.hpp), not raw concatenation:
    // `message` and
    // `available` ARE network-derived now that the manifest check has landed (a version parsed from
    // a remote manifest, an error string chosen from a fetch failure), and one '"' or control byte
    // there would break JSON.parse in the UI's update flow. `state`/`current` remain internal, but
    // routing every string through the one encoder is what meant the OTA work did not have to remember.
    // Keep the progress surface allocation-free: it is polled while X509 owns the heap. The 2 KiB
    // stack bound covers the worst-case RFC-8259 expansion of every fixed-capacity text field and
    // fails closed rather than reallocating if that contract ever grows.
    FixedBuffer<2048> j;
    auto number = [&j](uint32_t value) {
        char text[16];
        const int n = snprintf(text, sizeof(text), "%lu", static_cast<unsigned long>(value));
        if (n > 0) j += std::string_view(text, static_cast<size_t>(n));
    };
    j += "{\"state\":"; json_append_quoted(j, std::string_view(s.state));
    j += ",\"progress\":"; number(static_cast<uint32_t>(s.progress));
    j += ",\"message\":"; json_append_quoted(j, std::string_view(s.message));
    j += ",\"update_available\":"; j += s.update_available ? "true" : "false";
    // `downgrade` says the offered build is installable but OLDER — the dev -> release direction.
    j += ",\"downgrade\":"; j += s.downgrade ? "true" : "false";
    j += ",\"channel\":"; json_append_quoted(j, std::string_view(s.channel));
    j += ",\"busy\":"; j += s.busy ? "true" : "false";
    j += ",\"generation\":"; number(s.generation);
    j += ",\"heap_min_free_bytes\":"; number(s.heap_min_free_bytes);
    j += ",\"heap_min_largest_block_bytes\":"; number(s.heap_min_largest_block_bytes);
    j += ",\"available\":"; json_append_quoted(j, std::string_view(s.available));
    j += ",\"available_sha256\":"; json_append_quoted(j, s.available_sha256.data());
    j += ",\"available_channel\":";
    json_append_quoted(j, std::string_view(s.available_channel));
    j += ",\"current\":"; json_append_quoted(j, std::string_view(s.current));
    j += '}';
    if (!j.ok()) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return http_send_json(req, "{\"error\":\"OTA status exceeds its fixed buffer\"}");
    }
    return http_send_json(req, j.data());
}

// Stream the optional build notes separately from /ota/status.  The latter is polled at 1 Hz while
// TLS and the signed-image verifier own the scarce contiguous heap; carrying 1 KiB of courtesy copy
// through that hot JSON path would turn presentation into an OTA reliability cost.  The generation
// lease prevents a delayed browser request from showing notes belonging to a replaced offer.
static esp_err_t ota_changelog(httpd_req_t* req) {
    char query[32] = {0};
    char after_text[16] = {0};
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        httpd_query_key_value(query, "after", after_text, sizeof(after_text)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_send(req, "OTA check generation required", HTTPD_RESP_USE_STRLEN);
    }
    char* after_end = nullptr;
    const unsigned long long after_value = std::strtoull(after_text, &after_end, 10);
    if (!after_value || after_value > UINT32_MAX || !after_end || *after_end != '\0') {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_send(req, "Invalid OTA check generation", HTTPD_RESP_USE_STRLEN);
    }

    const uint32_t generation = static_cast<uint32_t>(after_value);
    size_t total = 0;
    size_t copied = 0;
    if (!ota_changelog_chunk(generation, 0, nullptr, 0, total, copied)) {
        httpd_resp_set_status(req, "409 Conflict");
        return httpd_resp_send(req, "OTA offer changed", HTTPD_RESP_USE_STRLEN);
    }
    // Notes are one-shot courtesy data. Whichever response path follows — success, 204, or a broken
    // client connection — releases the exact retained text; a static 60 s timer covers clients that
    // never request it at all. The signed artifact lease itself is independent and remains valid.
    struct ChangelogLeaseRelease {
        uint32_t generation;
        ~ChangelogLeaseRelease() { ota_changelog_release(generation); }
    } release{generation};
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_type(req, "text/plain; charset=utf-8");
    if (total == 0) {
        httpd_resp_set_status(req, "204 No Content");
        return httpd_resp_send(req, nullptr, 0);
    }

    char chunk[128];
    for (size_t offset = 0; offset < total; offset += copied) {
        if (!ota_changelog_chunk(generation, offset, chunk, sizeof(chunk), total, copied) ||
            copied == 0)
            return ESP_FAIL;
        if (httpd_resp_send_chunk(req, chunk, copied) != ESP_OK) return ESP_FAIL;
    }
    return httpd_resp_send_chunk(req, nullptr, 0);
}

void http_register_ota(httpd_handle_t s, HttpSurface surface) {
    // OTA is trusted-LAN only — never exposed on the open setup AP (F01). http_register_on withholds
    // all four on the SetupAp surface.
    http_register_on(s, surface, "/ota/check", HTTP_GET, ota_check);
    http_register_on(s, surface, "/ota/update", HTTP_POST, ota_do);
    http_register_on(s, surface, "/ota/status", HTTP_GET, ota_stat);
    http_register_on(s, surface, "/ota/changelog", HTTP_GET, ota_changelog);
}

} // namespace daik
