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

// esp_http_client_get_and_clear_last_tls_error() is destructive: once the diagnostic logger has
// captured the reason, its caller cannot ask the handle again whether the failure was DNS/TCP or
// TLS setup. Return the allocation-free evidence so a caller may apply a narrowly-scoped recovery
// policy without parsing its own log line.
struct HttpClientOpenFailure {
    esp_err_t opened       = ESP_OK;
    esp_err_t tls_error    = ESP_OK;
    int       mbedtls_error = 0;
    int       verify_flags  = 0;
};

struct HttpClientReadFailure {
    int       read_result   = 0;
    int       socket_errno  = 0;
    esp_err_t tls_error     = ESP_OK;
    int       mbedtls_error = 0;
    int       verify_flags  = 0;
    HttpClientProbe sample{};
};

HttpClientProbe http_client_probe() noexcept;

// `label` must be a static, non-identifying literal ("ota" or "weather").  The logger uses only
// fixed stack buffers and integer samples, so it remains usable during the OOM it diagnoses.
void http_client_log_init_failure(const char* label, const HttpClientProbe& before) noexcept;
HttpClientOpenFailure http_client_log_open_failure(const char* label,
                                                   esp_http_client_handle_t client,
                                                   esp_err_t opened,
                                                   const HttpClientProbe& before) noexcept;

// Capture a mid-stream read failure while the live client still owns its socket/TLS error state.
// The logger is fixed-format and allocation-free so it remains safe when a dynamic TLS record
// allocation is the failure being diagnosed.
HttpClientReadFailure http_client_log_read_failure(const char* label,
                                                   esp_http_client_handle_t client,
                                                   int read_result, size_t written,
                                                   int64_t total,
                                                   uint32_t elapsed_ms) noexcept;

}  // namespace daik
