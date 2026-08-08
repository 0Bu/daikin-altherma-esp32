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

// Is an image download in flight RIGHT NOW — i.e. does esp_https_ota hold a TLS session and the
// download buffer on the heap? Read every second by the MQTT publish task so it can stand aside
// instead of losing the allocation race and throwing std::bad_alloc (#380, logic/ota_quiesce.hpp).
//
// Deliberately NOT `ota_status().state == "updating"`: that copies three std::strings out under a
// mutex, so the question "is the heap under pressure?" would itself allocate — asked once per second
// by the very task the pressure is aimed at, on a lock the OTA task holds while it works. This is a
// lock-free atomic load of a bool and cannot throw, block or fail.
//
// Covers the DOWNLOAD window only (esp_https_ota_begin .. finish/abort), not the manifest check and
// not the pre-reboot delay: the check is a ~200 B fetch no publisher has ever lost a block to, and
// there is nothing worth holding off in the 600 ms before esp_restart().
//
// NOT THE SAME QUESTION as ota_busy() below, and the two are easy to confuse because both mean "the
// OTA subsystem is doing something". Pick by what the caller does with the answer:
//   • ota_busy()             — check OR download, mutex-guarded. For the heap watchdog, which must
//                              EXCUSE a critical reading (logic/heap_watchdog.hpp) rather than
//                              restart the board mid-install. A manifest check opens a TLS session
//                              too, so the excuse has to cover it.
//   • ota_download_active()  — download only, lock-free. For a per-second publisher deciding whether
//                              to SKIP a cycle. Standing aside for a 200 B manifest fetch would drop
//                              readings for nothing, and taking a mutex once a second — one the OTA
//                              task holds while it works — is a cost the watchdog pays once and a
//                              publisher would pay 86 400 times a day.
// They are complementary rather than redundant: this one keeps the publisher from deepening the dip
// that the other one is there to forgive.
bool ota_download_active();

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

// Is a check or a download in flight? Separate from ota_status() because the caller is the heap
// watchdog (heap_guard.cpp), which runs when allocation is failing: copying an OtaStatus copies four
// std::strings out under the lock and can itself throw std::bad_alloc, on the one path that must
// stay allocation-free. This reads the same mutex-guarded bool and returns it.
//
// The BROADER of the two flags — see ota_download_active() above for which to reach for.
bool ota_busy();

} // namespace daik
