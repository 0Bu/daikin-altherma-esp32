#pragma once
// Thin NVS helpers used by config.cpp (and any module needing small persisted state). All keys
// live in the "daik_cfg" namespace. Keep the nvs partition offset/size stable across versions
// (partitions.csv) so OTA preserves config.
#include <string>
#include <cstdint>
#include <cstddef>
#include <vector>
#include "esp_err.h"

namespace daik {

// The setters return the failing esp_err_t rather than a bare bool: config.cpp logs the key + the
// error name to /diag + syslog, which is the only way to tell WHICH write failed and why (a full
// partition reads very differently from a wedged flash).
// MIND THE POLARITY: esp_err_t is an int and ESP_OK is 0, so `if (nvs_set_str(...))` compiles and
// means "if it FAILED" — the inverse of the bool these once returned. Always compare to ESP_OK.
// They are also [[nodiscard]], which is what keeps that trap from being theoretical: a dropped write
// is otherwise silent (NVS can be full or the flash worn), and only the caller knows what the
// failure costs — safe_mode.cpp cannot latch without its counter. `bool ok = nvs_set_i32(...)` still
// compiles and still lies; [[nodiscard]] at least makes the *ignored* result a build error rather
// than a review catch. main/ builds with -Werror, so this bites.
std::string nvs_get_str(const char* key, const std::string& def = "");
[[nodiscard]] esp_err_t nvs_set_str(const char* key, const std::string& val);
int32_t     nvs_get_i32(const char* key, int32_t def);   // used for the persisted RX/TX pin cache
[[nodiscard]] esp_err_t nvs_set_i32(const char* key, int32_t val);

// Blob get/set for the atomic config store (logic/config_store.hpp). nvs_set_blob writes the whole
// value as ONE NVS entry (atomic: the old entry survives a failed/interrupted write), which is what
// makes config_save all-or-nothing. nvs_get_blob returns false on a missing key or any read error,
// so a fresh device / an OTA from the pre-blob layout falls back to the legacy per-key load.
[[nodiscard]] esp_err_t nvs_set_blob(const char* key, const void* data, size_t len);
bool                    nvs_get_blob(const char* key, std::vector<uint8_t>& out);

// Erase the ENTIRE "daik_cfg" namespace: WiFi credentials + the rollback backup, MQTT broker and
// credentials, syslog, NTP, the X10A link cache and the safe-mode crash counter. The factory reset
// behind the physical recovery button (recovery_button.cpp) — the only config reset that does not
// require reaching the device over the network. A missing namespace counts as success (nothing
// stored = nothing to erase); anything else is reported so the caller can refuse to reboot into a
// config it just claimed to have deleted.
[[nodiscard]] esp_err_t nvs_erase_all();

} // namespace daik
