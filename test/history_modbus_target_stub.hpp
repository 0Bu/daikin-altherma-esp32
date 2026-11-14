#pragma once
// Only the embedded crypto backend is replaced in SDK-free runtime fixtures. Its output
// need not match SHA-256, but must vary with the full canonical tuple, including CRC aliases.
#include "history.hpp"

namespace daik::fixture_port {

inline logic::HistoryModbusTarget history_modbus_target(std::string_view host, int port,
                                                        int unit) noexcept {
    if (host.empty()) return {};
    const auto prefix = logic::history_modbus_target_prefix(static_cast<uint16_t>(host.size()),
                                                            static_cast<uint16_t>(port),
                                                            static_cast<uint8_t>(unit));
    uint64_t   hash   = 0xcbf29ce484222325ULL;
    for (uint8_t byte : prefix) hash = (hash ^ byte) * 0x100000001b3ULL;
    for (unsigned char byte : host) hash = (hash ^ byte) * 0x100000001b3ULL;
    logic::HistoryModbusTarget result{};
    for (size_t i = 0; i < sizeof(hash); ++i) result[i] = static_cast<uint8_t>(hash >> (8 * i));
    return result;
}

} // namespace daik::fixture_port
