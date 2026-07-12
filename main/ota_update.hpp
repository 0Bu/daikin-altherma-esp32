#pragma once
// Pull-based signed OTA (esp_https_ota). check -> compare manifest version -> download the
// per-target daikin-altherma-esp32<suffix>.bin into the inactive slot -> reboot. Downgrade gate
// (refuse a not-strictly-newer image), image-signature verification, and a connectivity health gate
// that keeps rollback armed until the new image proves healthy (survives a base window AND gets
// online, else it stays PENDING_VERIFY and a reboot reverts). See docs/ARCHITECTURE.md → OTA,
// docs/SECURITY.md → Boot recovery, and logic/health_gate.hpp.
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
