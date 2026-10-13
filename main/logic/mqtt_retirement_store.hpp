#pragma once

#include "config_store.hpp"
#include <cstring>
#include <string_view>

namespace daik {

inline constexpr size_t MQTT_RETIREMENT_FIELD_CAPACITY = 64;
inline constexpr size_t MQTT_RETIREMENT_STORE_BYTES    = 204;

// Last possibly announced scope, solely for retirement. Never restore it into Config or detection.
struct MqttRetirementRecord {
    char base[MQTT_RETIREMENT_FIELD_CAPACITY + 1]{};
    char board_id[MQTT_RETIREMENT_FIELD_CAPACITY + 1]{};
    char profile_id[MQTT_RETIREMENT_FIELD_CAPACITY + 1]{};
};

inline bool mqtt_retirement_record_make(MqttRetirementRecord& out, std::string_view base,
                                        std::string_view board_id,
                                        std::string_view profile_id) noexcept {
    const std::string_view fields[] = {base, board_id, profile_id};
    if (base.empty() || board_id.empty()) return false;
    for (auto field : fields)
        if (field.size() > MQTT_RETIREMENT_FIELD_CAPACITY ||
            field.find('\0') != std::string_view::npos)
            return false;
    MqttRetirementRecord staged{};
    char*                destinations[] = {staged.base, staged.board_id, staged.profile_id};
    for (size_t i = 0; i < 3; ++i)
        if (!fields[i].empty()) std::memcpy(destinations[i], fields[i].data(), fields[i].size());
    out = staged;
    return true;
}

// Explicit wire layout: MQRT, v1, three byte lengths, three 64-byte zero-padded fields, LE CRC32.
// Compiler padding, credentials and the active/detected configuration are never serialized.
inline bool mqtt_retirement_encode(const MqttRetirementRecord& record, uint8_t* data,
                                   size_t size) noexcept {
    if (!data || size != MQTT_RETIREMENT_STORE_BYTES) return false;
    const char* fields[] = {record.base, record.board_id, record.profile_id};
    size_t      lengths[3]{};
    for (size_t i = 0; i < 3; ++i) {
        while (lengths[i] <= MQTT_RETIREMENT_FIELD_CAPACITY && fields[i][lengths[i]]) ++lengths[i];
        if (lengths[i] > MQTT_RETIREMENT_FIELD_CAPACITY || (i < 2 && lengths[i] == 0)) return false;
    }
    std::memset(data, 0, size);
    std::memcpy(data, "MQRT", 4);
    data[4] = 1;
    for (size_t i = 0; i < 3; ++i) {
        data[5 + i] = static_cast<uint8_t>(lengths[i]);
        std::memcpy(data + 8 + i * MQTT_RETIREMENT_FIELD_CAPACITY, fields[i], lengths[i]);
    }
    const uint32_t crc = config_crc32(data, size - 4);
    for (size_t i = 0; i < 4; ++i) data[size - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
    return true;
}

inline bool mqtt_retirement_decode(const uint8_t* data, size_t size,
                                   MqttRetirementRecord& out) noexcept {
    if (!data || size != MQTT_RETIREMENT_STORE_BYTES || std::memcmp(data, "MQRT", 4) != 0 ||
        data[4] != 1)
        return false;
    uint32_t wanted_crc = 0;
    for (size_t i = 0; i < 4; ++i)
        wanted_crc |= static_cast<uint32_t>(data[size - 4 + i]) << (8 * i);
    if (config_crc32(data, size - 4) != wanted_crc) return false;
    MqttRetirementRecord staged{};
    char*                destinations[] = {staged.base, staged.board_id, staged.profile_id};
    for (size_t i = 0; i < 3; ++i) {
        const size_t length = data[5 + i];
        if (length > MQTT_RETIREMENT_FIELD_CAPACITY || (i < 2 && length == 0)) return false;
        const uint8_t* field = data + 8 + i * MQTT_RETIREMENT_FIELD_CAPACITY;
        for (size_t j = 0; j < MQTT_RETIREMENT_FIELD_CAPACITY; ++j)
            if ((j < length && field[j] == 0) || (j >= length && field[j] != 0)) return false;
        std::memcpy(destinations[i], field, length);
    }
    out = staged;
    return true;
}

} // namespace daik
