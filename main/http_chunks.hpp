#pragma once
#include "esp_http_server.h"
#include "http_handlers.hpp"
#include "logic/chunk_sink.hpp"
#include <string_view>

namespace daik {

// HTTP JSON responses share one 1 KiB transport buffer. The server consumes each view
// synchronously, so status, values and register probes can reuse the same sink implementation.
struct HttpChunkEmitter {
    httpd_req_t* req = nullptr;

    bool operator()(std::string_view bytes, bool final) const {
        if (final) {
            http_set_nodelay(req, true);
            return httpd_resp_send_chunk(req, nullptr, 0) == ESP_OK;
        }
        http_set_nodelay(req, false);
        return httpd_resp_send_chunk(req, bytes.data(), bytes.size()) == ESP_OK;
    }
};
using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 1024>;

} // namespace daik
