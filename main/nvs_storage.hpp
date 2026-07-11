#pragma once
// Thin NVS helpers used by config.cpp (and any module needing small persisted state). All keys
// live in the "daik_cfg" namespace. Keep the nvs partition offset/size stable across versions
// (partitions.csv) so OTA preserves config.
#include <string>
#include <cstdint>

namespace daik {

std::string nvs_get_str(const char* key, const std::string& def = "");
bool        nvs_set_str(const char* key, const std::string& val);
int32_t     nvs_get_i32(const char* key, int32_t def);
bool        nvs_set_i32(const char* key, int32_t val);
void        nvs_commit();

} // namespace daik
