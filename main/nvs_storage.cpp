// Thin NVS helpers for the "daik_cfg" namespace. See nvs_storage.hpp. IDF's own nvs_* C
// functions are called with a leading :: so they don't collide with our daik::nvs_* wrappers.
#include "nvs_storage.hpp"
#include "nvs.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rtos_guard.hpp"
#include <atomic>
#include <cstdlib>

namespace daik {

static const char* NS = "daik_cfg";
static SemaphoreHandle_t s_write_mtx = nullptr;
static std::atomic<bool> s_writes_disabled{false};

namespace {
using Lock = SemGuard;
}

void nvs_storage_init() {
    if (s_write_mtx) return;
    s_write_mtx = xSemaphoreCreateMutex();
    if (!s_write_mtx) {
        ESP_LOGE("nvs", "write mutex alloc failed — aborting (factory reset cannot be serialized)");
        abort();
    }
}

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
    Lock lk(s_write_mtx);
    if (!lk.acquired() || s_writes_disabled.load(std::memory_order_acquire))
        return ESP_ERR_INVALID_STATE;
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
    Lock lk(s_write_mtx);
    if (!lk.acquired() || s_writes_disabled.load(std::memory_order_acquire))
        return ESP_ERR_INVALID_STATE;
    nvs_handle_t h;
    esp_err_t e = ::nvs_open(NS, NVS_READWRITE, &h);
    if (e != ESP_OK) return e;
    e = ::nvs_set_i32(h, key, val);
    if (e == ESP_OK) e = ::nvs_commit(h);
    ::nvs_close(h);
    return e;
}

esp_err_t nvs_set_blob(const char* key, const void* data, size_t len) {
    Lock lk(s_write_mtx);
    if (!lk.acquired() || s_writes_disabled.load(std::memory_order_acquire))
        return ESP_ERR_INVALID_STATE;
    nvs_handle_t h;
    esp_err_t e = ::nvs_open(NS, NVS_READWRITE, &h);
    if (e != ESP_OK) return e;
    e = ::nvs_set_blob(h, key, data, len);
    if (e == ESP_OK) e = ::nvs_commit(h);   // one atomic entry: the old value survives a failed write
    ::nvs_close(h);
    return e;
}

esp_err_t nvs_erase_all() {
    Lock lk(s_write_mtx);
    if (!lk.acquired()) return ESP_ERR_NO_MEM;
    // The lock waits out any setter that passed its precondition before the button fired. Once this
    // flag is visible, every later setter fails before opening the namespace and the latch remains
    // set after a successful erase even if a later history/coredump wipe keeps this boot alive.
    s_writes_disabled.store(true, std::memory_order_release);
    nvs_handle_t h;
    esp_err_t e = ::nvs_open(NS, NVS_READWRITE, &h);
    // Nothing has ever been written to this namespace, so there is nothing to erase and the caller's
    // intent ("leave no stored config behind") is already satisfied — report success rather than
    // making a factory reset fail on a device that was already factory-fresh.
    if (e == ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
    if (e != ESP_OK) {
        s_writes_disabled.store(false, std::memory_order_release);
        return e;
    }
    e = ::nvs_erase_all(h);
    if (e == ESP_OK) e = ::nvs_commit(h);   // same as every setter: the erase is durable only on commit
    ::nvs_close(h);
    if (e != ESP_OK) s_writes_disabled.store(false, std::memory_order_release);
    return e;
}

bool nvs_get_blob(const char* key, std::vector<uint8_t>& out) {
    nvs_handle_t h;
    if (::nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t len = 0;
    esp_err_t e = ::nvs_get_blob(h, key, nullptr, &len);   // query size first
    if (e != ESP_OK || len == 0) { ::nvs_close(h); return false; }
    out.resize(len);
    e = ::nvs_get_blob(h, key, out.data(), &len);
    ::nvs_close(h);
    return e == ESP_OK;
}

} // namespace daik
