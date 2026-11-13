#include "history.hpp"

// The PSA hardware driver allocates a context even for short inputs. Use the software
// implementation already linked by this pinned SDK, with caller-owned state on the stack.
#define MBEDTLS_DECLARE_PRIVATE_IDENTIFIERS
#include "mbedtls/private/sha256.h"
#undef MBEDTLS_DECLARE_PRIVATE_IDENTIFIERS

namespace daik {

logic::HistoryModbusTarget history_modbus_target(std::string_view host, int port,
                                                 int unit) noexcept {
    if (host.empty() || host.size() > CONFIG_BLOB_MAX_STR || port < 1 || port > 65535 || unit < 1 ||
        unit > 247)
        return {};

    const auto      prefix = logic::history_modbus_target_prefix(static_cast<uint16_t>(host.size()),
                                                                 static_cast<uint16_t>(port),
                                                                 static_cast<uint8_t>(unit));
    constexpr auto& domain = logic::HISTORY_MODBUS_TARGET_DOMAIN;
    mbedtls_sha256_context context;
    mbedtls_sha256_init(&context);
    uint8_t    digest[32];
    const bool ok = mbedtls_sha256_starts(&context, 0) == 0 &&
                    mbedtls_sha256_update(&context, reinterpret_cast<const uint8_t*>(domain),
                                          sizeof(domain) - 1) == 0 &&
                    mbedtls_sha256_update(&context, prefix.data(), prefix.size()) == 0 &&
                    mbedtls_sha256_update(&context, reinterpret_cast<const uint8_t*>(host.data()),
                                          host.size()) == 0 &&
                    mbedtls_sha256_finish(&context, digest) == 0;
    mbedtls_sha256_free(&context);
    logic::HistoryModbusTarget target{};
    if (ok) std::memcpy(target.data(), digest, target.size());
    return target;
}

} // namespace daik
