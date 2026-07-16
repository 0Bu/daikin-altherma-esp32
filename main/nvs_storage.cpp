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

esp_err_t nvs_set_str(const char* key, const std::string& val) {
    nvs_handle_t h;
    esp_err_t e = ::nvs_open(NS, NVS_READWRITE, &h);
    if (e != ESP_OK) return e;
    e = ::nvs_set_str(h, key, val.c_str());
    if (e == ESP_OK) e = ::nvs_commit(h);   // the set is only durable once committed
    ::nvs_close(h);
    return e;
}

int32_t nvs_get_i32(const char* key, int32_t def) {
    nvs_handle_t h;
    if (::nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    int32_t v = def;
    ::nvs_get_i32(h, key, &v);
    ::nvs_close(h);
    return v;
}

esp_err_t nvs_set_i32(const char* key, int32_t val) {
    nvs_handle_t h;
    esp_err_t e = ::nvs_open(NS, NVS_READWRITE, &h);
    if (e != ESP_OK) return e;
    e = ::nvs_set_i32(h, key, val);
    if (e == ESP_OK) e = ::nvs_commit(h);
    ::nvs_close(h);
    return e;
}

} // namespace daik
