#pragma once
// Pull-based signed OTA (esp_https_ota). Flow: check -> compare the manifest version -> download
// daikin-altherma-esp32<suffix>.bin into the inactive slot -> verify signature -> reboot, with a
// downgrade gate that refuses anything not strictly newer.
//
// Both halves are implemented. The DELIVERY half (ota_check_async / ota_update_async) runs on one
// on-demand task, never the httpd worker; the ROLLBACK half (ota_health_gate_arm) keeps a fresh
// image PENDING_VERIFY until it survives a base window AND gets online, else a reboot reverts it.
//
// The downgrade gate is enforced TWICE — against the manifest's version and against the image's own
// embedded esp_app_desc_t version — because those are separately-controlled artifacts and only the
// second binds a lying manifest to the bytes actually served. See docs/SECURITY.md → OTA image
// signing, docs/ARCHITECTURE.md → OTA, logic/version_cmp.hpp and logic/health_gate.hpp.
#include <cstdint>
#include <string>

namespace daik {

// Per-target OTA image suffix (always "" since esp32s3 is the only target).
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
