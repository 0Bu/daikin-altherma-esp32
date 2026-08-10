#pragma once

// Allocation-free evidence for outbound HTTPS failures.  esp_http_client_open() deliberately
// collapses DNS, TCP and TLS setup into one call; callers used to collapse its result once more
// into a user-facing "connect failed" string, leaving no way to distinguish an unreachable host
// from a fragmented heap.  Capture the binding resources before the client is initialised and log
// the IDF/socket/TLS evidence while the handle still owns it.
#include "esp_err.h"
#include "esp_http_client.h"

#include <cstddef>
#include <cstdint>

namespace daik {

struct HttpClientProbe {
    size_t   free_internal = 0;
    size_t   largest_internal = 0;
    uint32_t stack_free_bytes = 0;
};

HttpClientProbe http_client_probe() noexcept;

// `label` must be a static, non-identifying literal ("ota" or "weather").  The logger uses only
// fixed stack buffers and integer samples, so it remains usable during the OOM it diagnoses.
void http_client_log_init_failure(const char* label, const HttpClientProbe& before) noexcept;
void http_client_log_open_failure(const char* label, esp_http_client_handle_t client,
                                  esp_err_t opened, const HttpClientProbe& before) noexcept;

}  // namespace daik
