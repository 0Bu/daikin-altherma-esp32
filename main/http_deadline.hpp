#pragma once

// Absolute deadline guard for one blocking ESP HTTP-client socket phase.
//
// ESP-IDF v6.0.2's blocking esp_http_client_fetch_headers() and esp_http_client_read() each contain
// an internal receive loop. Updating client->timeout_ms between caller invocations therefore does
// not stop a peer which supplies one byte inside every receive timeout. This guard arms one boot-
// initialized esp_timer for the REMAINDER of the caller's original operation deadline. Its timer
// callback only notifies a statically created watchdog task whose lwIP thread semaphore was primed
// and verified at boot. That task performs BSD shutdown(SHUT_RDWR); the HTTP owner joins its
// acknowledgement before it closes/cleans the client or re-arms another socket.

#include "esp_err.h"
#include "esp_http_client.h"
#include "freertos/FreeRTOS.h"

namespace daik {

// Allocate the single small esp_timer before any OTA/Weather TLS pressure. Failure is latched and
// every later arm fails closed; no transfer path retries timer allocation beside a TLS client.
bool http_deadline_init() noexcept;

// Allocation-free boot latch used before OTA task creation and before Weather payload/client
// allocation. Once false after initialization it remains false for the complete boot.
bool http_deadline_ready() noexcept;

class HttpSocketDeadline {
public:
    HttpSocketDeadline()                                     = default;
    HttpSocketDeadline(const HttpSocketDeadline&)            = delete;
    HttpSocketDeadline& operator=(const HttpSocketDeadline&) = delete;
    ~HttpSocketDeadline();

    // Arm the public socket exposed by an already-open esp_http_client for the remainder of the
    // original operation deadline. Only one OTA/Weather TLS owner may be armed at a time.
    esp_err_t arm(esp_http_client_handle_t client, TickType_t started,
                  TickType_t duration) noexcept;

    // True while/after the timer fired or the monotonic caller deadline elapsed. This remains
    // latched after disarm so a blocking IDF call which returned at the boundary is classified as
    // a timeout rather than a reachability/read failure.
    bool expired() const noexcept;

    // Stop the one-shot or, if dispatch already began, wait for its completion acknowledgement.
    // Returns the latched expiry verdict. Safe and idempotent.
    bool disarm() noexcept;

    bool active() const noexcept { return active_; }

private:
    TickType_t started_         = 0;
    TickType_t duration_        = 0;
    bool       active_          = false;
    bool       expired_latched_ = false;
};

} // namespace daik
