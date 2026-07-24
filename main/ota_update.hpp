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
// POST /ota/update. `allow_downgrade` is set ONLY by an explicit ?downgrade=1 — the UI sends it
// after the user picks a channel whose newest build is older than what is running (dev -> release).
// It relaxes the version ORDER and nothing else: the signature check is untouched, and a manifest
// can never ask for it. See logic/version_cmp.hpp → ota_install_allowed.
void ota_update_async(bool allow_downgrade = false);
void ota_health_gate_arm();                        // main.cpp: arm rollback health gate

struct OtaStatus {
    std::string state;            // idle|checking|updating|done|error
    int         progress = 0;     // 0..100
    std::string message;
    bool        update_available = false;
    std::string available;        // manifest version of the SELECTED channel
    std::string current;          // running version
    std::string channel;          // "release" | "dev" — the feed `available` was read from
    // The offered build is INSTALLABLE but OLDER than what is running (the dev -> release
    // direction). Reported separately from update_available so the UI can word it as a switch-back
    // and ask for confirmation, rather than either hiding it or calling an older build an "update".
    bool        downgrade = false;
};
OtaStatus ota_status();

} // namespace daik
