#pragma once
// Pull-based signed OTA (esp_https_ota). Intended flow: check -> compare manifest version -> download
// the per-target daikin-altherma-esp32<suffix>.bin into the inactive slot -> reboot, with a downgrade
// gate (refuse a not-strictly-newer image) and image-signature verification.
// STATUS: only the connectivity health gate below is implemented — it keeps rollback armed until the
// new image proves healthy (survives a base window AND gets online, else it stays PENDING_VERIFY and
// a reboot reverts). The manifest check + esp_https_ota download + downgrade gate (ota_check_async /
// ota_update_async) are TODO stubs. See docs/ARCHITECTURE.md → OTA, docs/SECURITY.md → OTA image
// signing, and logic/health_gate.hpp.
#include <cstdint>
#include <string>

namespace daik {

// Per-target OTA image suffix ("" for esp32, else -s3/-c3/-c6/-c5), picked from CONFIG_IDF_TARGET.
const char* ota_img_suffix();

void ota_check_async(int64_t browser_epoch_ms);   // GET /ota/check
void ota_update_async();                           // POST /ota/update
void ota_health_gate_arm();                        // main.cpp: arm rollback health gate

struct OtaStatus {
    std::string state;            // idle|checking|updating|done|error
    int         progress = 0;     // 0..100
    std::string message;
    bool        update_available = false;
    std::string available;        // manifest version
    std::string current;          // running version
};
OtaStatus ota_status();

} // namespace daik
