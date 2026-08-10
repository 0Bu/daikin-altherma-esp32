#include "http_client_diag.hpp"

#include "diag_log.hpp"
#include "heap_guard.hpp"

#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace daik {

HttpClientProbe http_client_probe() noexcept {
    return {
        heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL),
        heap_largest_internal_block(),
        static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr)),
    };
}

void http_client_log_init_failure(const char* label, const HttpClientProbe& before) noexcept {
    const HttpClientProbe after = http_client_probe();
    diag_printf("netdiag: %s init=oom heap=%u/%u->%u/%u stack=%lu->%lu\n", label,
                static_cast<unsigned>(before.free_internal),
                static_cast<unsigned>(before.largest_internal),
                static_cast<unsigned>(after.free_internal),
                static_cast<unsigned>(after.largest_internal),
                static_cast<unsigned long>(before.stack_free_bytes),
                static_cast<unsigned long>(after.stack_free_bytes));
}

HttpClientOpenFailure http_client_log_open_failure(const char* label,
                                                   esp_http_client_handle_t client,
                                                   esp_err_t opened,
                                                   const HttpClientProbe& before) noexcept {
    const int socket_errno = esp_http_client_get_errno(client);
    HttpClientOpenFailure failure;
    failure.opened = opened;
    failure.tls_error = esp_http_client_get_and_clear_last_tls_error(
        client, &failure.mbedtls_error, &failure.verify_flags);
    const HttpClientProbe after = http_client_probe();
    diag_printf("netdiag: %s open=%s/0x%lx errno=%d tls=%s/0x%lx mbed=%d verify=0x%x "
                "heap=%u/%u->%u/%u stack=%lu->%lu\n",
                label, esp_err_to_name(opened),
                static_cast<unsigned long>(static_cast<uint32_t>(opened)), socket_errno,
                esp_err_to_name(failure.tls_error),
                static_cast<unsigned long>(static_cast<uint32_t>(failure.tls_error)),
                failure.mbedtls_error, static_cast<unsigned>(failure.verify_flags),
                static_cast<unsigned>(before.free_internal),
                static_cast<unsigned>(before.largest_internal),
                static_cast<unsigned>(after.free_internal),
                static_cast<unsigned>(after.largest_internal),
                static_cast<unsigned long>(before.stack_free_bytes),
                static_cast<unsigned long>(after.stack_free_bytes));
    return failure;
}

}  // namespace daik
