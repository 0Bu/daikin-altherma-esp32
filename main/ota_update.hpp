#pragma once
#include "logic/fixed_text.hpp"
// Pull-based signed OTA (esp_http_client -> esp_ota). Flow: check -> lease manifest channel/version/
// app SHA -> stream and hash daikin-altherma-esp32<suffix>.bin into the inactive slot -> release TLS
// -> require exact hash + verify signature -> reboot, with a downgrade gate that refuses anything
// not strictly newer.
//
// Both halves are implemented. The DELIVERY half (ota_check_async / ota_update_async) runs on one
// on-demand task, never the httpd worker; the ROLLBACK half (ota_health_gate_arm) keeps a fresh
// image PENDING_VERIFY until it survives a base window AND gets online, else a reboot reverts it.
//
// The downgrade gate is enforced TWICE — against the manifest's version and against the image's own
// embedded esp_app_desc_t version — because those are separately-controlled artifacts and only the
// second binds a lying manifest to the bytes actually served. See docs/SECURITY.md → OTA image
// signing, docs/ARCHITECTURE.md → OTA, logic/version_cmp.hpp and logic/health_gate.hpp.
#include <array>
#include <cstdint>
#include <string>

namespace daik {

// Per-target OTA image suffix (always "" since esp32s3 is the only target).
const char* ota_img_suffix();

// Accepted operations return a non-zero generation which is also exposed by ota_status(). A zero
// return means the task was not accepted (busy or task-creation failure); HTTP must not report that
// request as successful.
uint32_t ota_check_async(int64_t browser_epoch_ms);   // GET /ota/check
// POST /ota/update. `allow_downgrade` is set ONLY by an explicit ?downgrade=1 — the UI sends it
// after the user picks a channel whose newest build is older than what is running (dev -> release).
// It relaxes the version ORDER and nothing else: the signature check is untouched, and a manifest
// can never ask for it. See logic/version_cmp.hpp → ota_install_allowed.
// The update is accepted only while `after_generation` is still the most recently completed check
// and its exact channel/version/application SHA match that check's retained result.  The fixed-size
// arguments are copied into the one task slot before the task is created, so neither a later config
// change nor a replaced feed can redirect an accepted production operation.
uint32_t ota_update_async(uint32_t after_generation, const char* expected_channel,
                          const char* expected_version, const char* expected_app_sha256,
                          bool allow_downgrade = false);
void ota_health_gate_arm();                        // main.cpp: arm rollback health gate

// Is an OTA network operation in flight RIGHT NOW — manifest TLS check or image download? Read every
// second by the MQTT publish task so it can stand aside
// instead of losing the allocation race and throwing std::bad_alloc (#380, logic/ota_quiesce.hpp).
//
// Deliberately NOT `ota_status().state == "updating"`: even its fixed-capacity snapshot takes the
// OTA and Config mutexes. Asked once per second by the task standing aside, this question must be a
// lock-free atomic load that cannot throw, block or fail.
//
// Covers the manifest handshake as well as the DOWNLOAD window. The response is only ~200 B, but
// TLS setup itself can lose the largest-block race before one response byte exists.
//
// NOT THE SAME QUESTION as ota_busy() below, and the two are easy to confuse because both mean "the
// OTA subsystem is doing something". Pick by what the caller does with the answer:
//   • ota_busy()             — check OR download, mutex-guarded. For the heap watchdog, which must
//                              EXCUSE a critical reading (logic/heap_watchdog.hpp) rather than
//                              restart the board mid-install. A manifest check opens a TLS session
//                              too, so the excuse has to cover it.
//   • ota_download_active()  — network operation, lock-free. For a per-second publisher deciding
//                              whether to SKIP a cycle. The historical name is retained because it
//                              is an internal API; its scope now starts before manifest TLS setup.
// They are complementary rather than redundant: this one keeps the publisher from deepening the dip
// that the other one is there to forgive.
bool ota_download_active();

struct OtaStatus {
    FixedText<16> state;          // idle|checking|updating|done|error
    int         progress = 0;     // 0..100
    FixedText<128> message;
    bool        update_available = false;
    FixedText<32> available;      // manifest version returned by the completed check
    std::array<char, 65> available_sha256{}; // exact signed app bytes; fixed to keep status cheap
    FixedText<8> available_channel; // feed which produced available + available_sha256
    FixedText<32> current;        // running version
    FixedText<8> channel;         // "release" | "dev" — the currently selected live feed
    bool        busy = false;     // one accepted check/update task still owns the OTA operation
    uint32_t    generation = 0;   // non-zero monotonic accepted-operation identity
    uint32_t    heap_min_free_bytes = 0;     // current operation, INTERNAL 8-bit heap
    uint32_t    heap_min_largest_block_bytes = 0;
    // The offered build is INSTALLABLE but OLDER than what is running (the dev -> release
    // direction). Reported separately from update_available so the UI can word it as a switch-back
    // and ask for confirmation, rather than either hiding it or calling an older build an "update".
    bool        downgrade = false;
};
OtaStatus ota_status();

// Is a check or a download in flight? Separate from ota_status() because the caller is the heap
// watchdog (heap_guard.cpp), which runs when allocation is failing: even a fixed status snapshot
// and narrow Config read would take two locks on the path that must remain allocation-free. This
// reads the same mutex-guarded bool and returns it.
//
// The BROADER of the two flags — see ota_download_active() above for which to reach for.
bool ota_busy();

} // namespace daik
