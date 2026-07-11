// Thin NVS helpers for the "daik_cfg" namespace. See nvs_storage.hpp. IDF's own nvs_* C
// functions are called with a leading :: so they don't collide with our daik::nvs_* wrappers.
#include "nvs_storage.hpp"
#include "nvs.h"

namespace daik {

static const char* NS = "daik_cfg";

std::string nvs_get_str(const char* key, const std::string& def) {
    nvs_handle_t h;
    if (::nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    size_t len = 0;
    std::string out = def;
    if (::nvs_get_str(h, key, nullptr, &len) == ESP_OK && len > 0) {
        out.resize(len);
        ::nvs_get_str(h, key, out.data(), &len);
        if (!out.empty() && out.back() == '\0') out.pop_back();   // drop NUL terminator
    }
    ::nvs_close(h);
    return out;
}

bool nvs_set_str(const char* key, const std::string& val) {
    nvs_handle_t h;
    if (::nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    bool ok = ::nvs_set_str(h, key, val.c_str()) == ESP_OK && ::nvs_commit(h) == ESP_OK;
    ::nvs_close(h);
    return ok;
}

int32_t nvs_get_i32(const char* key, int32_t def) {
    nvs_handle_t h;
    if (::nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    int32_t v = def;
    ::nvs_get_i32(h, key, &v);
    ::nvs_close(h);
    return v;
}

bool nvs_set_i32(const char* key, int32_t val) {
    nvs_handle_t h;
    if (::nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    bool ok = ::nvs_set_i32(h, key, val) == ESP_OK && ::nvs_commit(h) == ESP_OK;
    ::nvs_close(h);
    return ok;
}

void nvs_commit() { /* per-call commit above; kept for API symmetry */ }

} // namespace daik
