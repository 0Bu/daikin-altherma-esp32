// Pull-based signed OTA. See ota_update.hpp and docs/ARCHITECTURE.md → OTA.
//
// Both halves are now implemented: the DELIVERY half here (manifest check -> downgrade gate ->
// esp_http_client -> esp_ota into the inactive slot) and the ROLLBACK half further down (the health gate that
// keeps a fresh image PENDING_VERIFY until it proves healthy). They are independent safety nets and
// neither replaces the other: the gate below refuses to *start* a bad update, the health gate
// recovers from one that started and booted broken.
//
// Three properties this file is responsible for, each of which has bitten real fleets:
//   • The downgrade gate runs BEFORE any download, and against a FRESHLY fetched manifest (not the
//     one /ota/check happened to see). A signature proves authenticity, not freshness.
//   • Nothing runs on the httpd worker. /set_mqtt's ~8 s pre-flight is deliberately the ONE
//     request-path network block in this firmware (docs/ARCHITECTURE.md → HTTP API); a multi-MB
//     TLS download would park the single httpd task for minutes and take the whole web UI down with
//     it.
//   • One OTA operation at a time, ever. Two concurrent HTTPS/esp_ota sessions would each open a
//     TLS context on a heap whose binding limit is the largest CONTIGUOUS free block.
#include "ota_update.hpp"
#include "logic/health_gate.hpp"
#include "logic/ota_channel.hpp"
#include "logic/ota_headroom.hpp"
#include "logic/ota_manifest.hpp"
#include "logic/ota_transport.hpp"
#include "logic/version_cmp.hpp"
#include "config.hpp"
#include "diag_log.hpp"
#include "heap_guard.hpp"
#include "hp_modbus.hpp"
#include "hp_poll.hpp"
#include "http_client_diag.hpp"
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "provisioning.hpp"
#include "syslog.hpp"
#include "weather_forecast.hpp"
#include "wifi.hpp"
#include "esp_app_desc.h"
#include "esp_app_format.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_tls_errors.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard
#include "freertos/task.h"
#include "freertos/timers.h"
#include "psa/crypto.h"
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <exception>
#include <memory>
#include <string>

namespace daik {

namespace {

// s_status is written by the OTA task and read by the httpd task (GET /ota/status), so it needs a
// mutex. Every public text field is fixed-capacity: the one status route intentionally left open
// during TLS must not allocate merely to take its snapshot. Keep the RAII lock anyway; future code
// must not turn an exception into a permanently held mutex.
OtaStatus         s_status;
// Created at STATIC INIT — before app_main, before any task exists to race for it. The obvious
// alternative, a lazy `if (!s_mtx) s_mtx = xSemaphoreCreateMutex()` on first use, is a real bug
// here and not a theoretical one: main.cpp starts the HTTP server (line 72) BEFORE it arms the OTA
// health gate (line 79), so a GET /ota/status landing in that window runs on the httpd task while
// the main task is still walking to the arm call. Two first-callers each create a mutex, one leaks,
// and the two sides then guard s_status with DIFFERENT locks — no mutual exclusion at all, in the
// one construct whose entire job is to provide it.
SemaphoreHandle_t s_mtx = xSemaphoreCreateMutex();
// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
using Lock = SemGuard;

// One OTA operation at a time. Guarded by s_mtx (not a bare bool): /ota/check and /ota/update are
// both reachable from the network and a double-tap in the UI must not spawn two TLS sessions.
bool s_busy = false;
uint32_t s_generation = 0;

// Optional release notes are kept out of OtaStatus: /ota/status is polled once a second during the
// most heap-constrained part of an update, and copying/JSON-quoting 1 KiB of prose there would make
// the courtesy text compete with the signed install. One transient 1025-byte document slot is
// allocated only after its TLS handshake has succeeded and decoded in place. After TLS is fully
// released, only the exact decoded length is retained for one GET /ota/changelog stream or 60 s,
// whichever comes first. No release-note allocation can therefore become a boot-long heap island.
constexpr size_t kChangelogDocumentMax = 1025;
constexpr TickType_t kChangelogTimerTickTicks = pdMS_TO_TICKS(1000);
constexpr int64_t kChangelogLeaseTtlUs = 60LL * 1000LL * 1000LL;
char* s_changelog = nullptr;
size_t s_changelog_len = 0;
uint32_t s_changelog_generation = 0;
int64_t s_changelog_expiry_us = 0;
StaticTimer_t s_changelog_timer_storage;
TimerHandle_t s_changelog_timer = nullptr;

void discard_changelog_text_locked() {
    if (s_changelog) heap_caps_free(s_changelog);
    s_changelog = nullptr;
    s_changelog_len = 0;
    s_changelog_expiry_us = 0;
}

void clear_changelog_lease_locked() {
    discard_changelog_text_locked();
    s_changelog_generation = 0;
}

void changelog_lease_expired(TimerHandle_t) {
    // This is the shared FreeRTOS timer daemon: never block every software timer behind the OTA
    // mutex. The auto-reload tick guarantees another attempt one second later if it is contended.
    Lock lk(s_mtx, 0);
    if (!lk) return;
    if (s_changelog_expiry_us > 0 && esp_timer_get_time() >= s_changelog_expiry_us)
        clear_changelog_lease_locked();
    // A response/start path normally stops the timer itself. If its zero-wait queue send failed,
    // the next auto-reload callback sees the cleared deadline and retries without retained heap.
    if (s_changelog_expiry_us == 0 && s_changelog_timer)
        xTimerStop(s_changelog_timer, 0);
}

void ensure_changelog_timer_locked() {
    if (!s_changelog_timer) {
        s_changelog_timer = xTimerCreateStatic("ota_notes", kChangelogTimerTickTicks, pdTRUE,
                                               nullptr, changelog_lease_expired,
                                               &s_changelog_timer_storage);
    }
}

struct ChangelogBufferDeleter {
    void operator()(char* p) const { if (p) heap_caps_free(p); }
};
using ChangelogBuffer = std::unique_ptr<char, ChangelogBufferDeleter>;

// One OTA task can exist at a time, so one mutex-protected fixed slot is enough to carry an exact
// update expectation across the asynchronous task boundary.  It is populated before xTaskCreate
// while s_busy owns the slot and is copied by value at task entry; no request string or live config
// is consulted after acceptance.
enum class OtaTaskMode : uint8_t { Check, Update, Downgrade };
struct OtaTaskArgs {
    OtaTaskMode mode = OtaTaskMode::Check;
    OtaChannel channel = OtaChannel::Release;
    char version[32] = {0};
    char app_sha256[65] = {0};
};
OtaTaskArgs s_task_args;

// "An OTA network operation is in flight" — the ONE piece of OTA state read from outside on a
// per-second cadence
// (ota_download_active(), see the header for why this is not s_status.state). Deliberately NOT under
// s_mtx: the reader is the MQTT publish task standing aside for exactly the heap event this marks,
// and making it take the lock the OTA task holds — or copy strings to read it — would spend the
// resource it is trying to save. A stale read costs one published cycle either way, so relaxed
// ordering is enough and no reader can ever block on the writer.
std::atomic<bool> s_network_active{false};
static_assert(std::atomic<bool>::is_always_lock_free,
              "OTA quiesce signal must remain allocation- and lock-free");
std::atomic<uint32_t> s_operation_min_free{0};
std::atomic<uint32_t> s_operation_min_largest{0};
static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "OTA heap telemetry must remain allocation- and lock-free");

// Scope guard for that flag. It deliberately covers the manifest TLS handshake too: live evidence
// proved that the small response is irrelevant to the binding allocation — TLS setup itself failed
// while the MQTT publisher still competed for the largest contiguous block. The guard lives around
// the whole task operation so every manifest/download exit and exception clears it in one place.
struct OtaNetworkFlag {
    OtaNetworkFlag()  {
        s_network_active.store(true, std::memory_order_release);
        mqtt_transport_pause_for_network_heap();
    }
    ~OtaNetworkFlag() {
        mqtt_transport_resume_after_network_heap();
        s_network_active.store(false, std::memory_order_release);
    }
};

// A TLS handshake alone wants ~6 KB of stack, and fetch_manifest_version() puts another
// kManifestMax (1 KB) frame on top of it — 8192 (what the IDF OTA examples use, with no such local)
// would leave almost nothing spare. The task is transient and only ever exists one at a time, so
// the extra 2 KB is borrowed, not resident.
constexpr int  kTaskStack     = 10240;
constexpr UBaseType_t kTaskPrio = TASK_PRIO_OTA;   // see main/task_config.hpp for the tiers
constexpr int  kHttpTimeoutMs = 15000;
// A peer which sends one byte inside every socket timeout is still not allowed to hold MQTT,
// HomeHub and Syslog quiesced forever. The remaining-time setter below turns this into a real
// operation deadline, not merely a per-read timeout.
constexpr TickType_t kManifestDeadline = pdMS_TO_TICKS(30000);
constexpr TickType_t kFirmwareDeadline = pdMS_TO_TICKS(5 * 60 * 1000);
constexpr int  kChangelogHttpTimeoutMs = 6000;
constexpr TickType_t kChangelogDeadline = pdMS_TO_TICKS(30000);
constexpr int  kOtaBufSize    = 2048;   // download chunk; deliberately small (contiguous heap)
constexpr size_t kManifestMax = 1024;   // published installer+provenance manifest stays below 1 KiB
constexpr unsigned kMaxRedirects = 5;
constexpr int kDoneBeforeRebootMs = 3000;
// MQTT publishes once a second. Hold the operation flag for a little longer than one cadence before
// opening TLS so a publisher which woke just before the OTA task has time to finish and stand aside.
constexpr TickType_t kNetworkQuiesceLead = pdMS_TO_TICKS(1100);
constexpr TickType_t kAllocatorRetryDelay = pdMS_TO_TICKS(250);
constexpr TickType_t kHeadroomRetryDelay = pdMS_TO_TICKS(250);
// TLS gets a longer bounded recovery window than post-transfer validation. The production gate
// deliberately polls status while the operation is live, and recently released HTTP/TCP buffers
// may need several scheduler turns to coalesce. Neither phase may wait forever.
constexpr unsigned   kTransferHeadroomMaxAttempts = 60;    // 15 s
constexpr unsigned   kValidationHeadroomMaxAttempts = 20;  // 5 s
constexpr TickType_t kPollQuiesceWait      = pdMS_TO_TICKS(15000);
constexpr TickType_t kWeatherWait          = pdMS_TO_TICKS(kHttpTimeoutMs + 5000);

struct OtaHeapSample {
    size_t free_bytes;
    size_t largest_internal_block;
};

enum class OtaTransferFailure : uint8_t { None, Read, Write, Size, Hash, Timeout };

const char* ota_transfer_failure_name(OtaTransferFailure failure) {
    switch (failure) {
        case OtaTransferFailure::Read:  return "read";
        case OtaTransferFailure::Write: return "write";
        case OtaTransferFailure::Size:  return "size";
        case OtaTransferFailure::Hash:  return "hash";
        case OtaTransferFailure::Timeout: return "timeout";
        default:                        return "none";
    }
}

bool set_http_timeout_to_deadline(esp_http_client_handle_t client, TickType_t started,
                                  TickType_t deadline, int per_call_timeout_ms = kHttpTimeoutMs) {
    const TickType_t elapsed = xTaskGetTickCount() - started;
    if (elapsed >= deadline) return false;
    const uint64_t remaining_ms =
        static_cast<uint64_t>(deadline - elapsed) * portTICK_PERIOD_MS;
    const int timeout_ms = remaining_ms < static_cast<uint64_t>(per_call_timeout_ms)
                         ? static_cast<int>(remaining_ms) : per_call_timeout_ms;
    esp_http_client_set_timeout_ms(client, timeout_ms > 0 ? timeout_ms : 1);
    return true;
}

bool http_deadline_reached(TickType_t started, TickType_t deadline) {
    return xTaskGetTickCount() - started >= deadline;
}

void record_operation_min(std::atomic<uint32_t>& target, size_t value) {
    const uint32_t sample = value > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(value);
    uint32_t current = target.load(std::memory_order_relaxed);
    while (sample < current &&
           !target.compare_exchange_weak(current, sample, std::memory_order_relaxed)) {}
}

OtaHeapSample ota_heap_sample() {
    const OtaHeapSample sample{
        heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL),
        heap_largest_internal_block()};
    record_operation_min(s_operation_min_free, sample.free_bytes);
    record_operation_min(s_operation_min_largest, sample.largest_internal_block);
    return sample;
}

void ota_heap_operation_reset() {
    const OtaHeapSample sample{
        heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL),
        heap_largest_internal_block()};
    s_operation_min_free.store(static_cast<uint32_t>(sample.free_bytes), std::memory_order_relaxed);
    s_operation_min_largest.store(static_cast<uint32_t>(sample.largest_internal_block),
                                  std::memory_order_relaxed);
}

// Wait a bounded interval for an allocation-rich task which was already in flight when the
// lock-free OTA flag rose to unwind. This protects every fresh manifest/image TLS client and, with
// the smaller phase-specific requirement, the post-cleanup esp_ota_end Secure-Boot-v2 validation.
// Refusing on low or unstable headroom is fail-closed and retryable; lowering a threshold or
// skipping verification is not.
bool wait_for_ota_headroom(const char* phase, const OtaHeapHeadroom& requirement,
                           unsigned max_attempts, OtaHeapSample& sample) {
    unsigned stable = 0;
    for (unsigned attempt = 0; attempt < max_attempts; ++attempt) {
        sample = ota_heap_sample();
        stable = ota_headroom_streak_next(requirement, stable, sample.free_bytes,
                                          sample.largest_internal_block);
        if (stable >= requirement.stable_samples) {
            diag_printf("ota: %s heap ready (free=%u B largest=%u B stable=%u)\n", phase,
                        static_cast<unsigned>(sample.free_bytes),
                        static_cast<unsigned>(sample.largest_internal_block), stable);
            return true;
        }
        vTaskDelay(kHeadroomRetryDelay);
    }

    sample = ota_heap_sample();
    diag_printf("ota: %s blocked by low/unstable heap (free=%u B largest=%u B stable=%u; "
                "need %u/%u B for %u samples)\n",
                phase, static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block), stable,
                static_cast<unsigned>(requirement.min_free_bytes),
                static_cast<unsigned>(requirement.min_largest_block_bytes),
                requirement.stable_samples);
    return false;
}

bool wait_for_ota_headroom_until(const char* phase, const OtaHeapHeadroom& requirement,
                                 unsigned max_attempts, TickType_t operation_started,
                                 TickType_t operation_deadline, OtaHeapSample& sample) {
    unsigned stable = 0;
    for (unsigned attempt = 0; attempt < max_attempts; ++attempt) {
        if (http_deadline_reached(operation_started, operation_deadline)) return false;
        sample = ota_heap_sample();
        stable = ota_headroom_streak_next(requirement, stable, sample.free_bytes,
                                          sample.largest_internal_block);
        if (stable >= requirement.stable_samples) {
            diag_printf("ota: %s heap ready (free=%u B largest=%u B stable=%u)\n", phase,
                        static_cast<unsigned>(sample.free_bytes),
                        static_cast<unsigned>(sample.largest_internal_block), stable);
            return true;
        }
        vTaskDelay(kHeadroomRetryDelay);
    }
    sample = ota_heap_sample();
    diag_printf("ota: %s blocked by low/unstable heap before transfer deadline "
                "(free=%u B largest=%u B stable=%u)\n",
                phase, static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block), stable);
    return false;
}

void close_http_client(esp_http_client_handle_t& client) {
    if (!client) return;
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    client = nullptr;
}

struct OtaFirmwareResponseState {
    OtaRedirectLocationState redirect;
    OtaContentRangeState content_range;
};

esp_err_t firmware_http_event(esp_http_client_event_t* event) noexcept {
    if (!event || event->event_id != HTTP_EVENT_ON_HEADER || !event->user_data ||
        !event->header_key || !event->header_value) return ESP_OK;
    const std::string_view key(event->header_key);
    auto* response = static_cast<OtaFirmwareResponseState*>(event->user_data);
    if (key.size() == 8 && ota_ascii_prefix_ieq(key, "Location"))
        ota_redirect_location_observe(response->redirect, event->header_value);
    else if (key.size() == 13 && ota_ascii_prefix_ieq(key, "Content-Range"))
        ota_content_range_observe(response->content_range, event->header_value);
    return ESP_OK;
}

// Open GET and follow the same standard redirect statuses as esp_https_ota in IDF v6.0.2.  The
// client owns no body buffer supplied by the server, and the redirect budget is finite even if a
// broken feed points at itself.
esp_err_t open_firmware_stream(esp_http_client_handle_t client,
                               OtaFirmwareResponseState& response, int expected_status,
                               TickType_t operation_started, TickType_t operation_deadline,
                               int& status) {
    for (unsigned redirects = 0; redirects <= kMaxRedirects; ++redirects) {
        if (!set_http_timeout_to_deadline(client, operation_started, operation_deadline))
            return ESP_ERR_TIMEOUT;
        ota_redirect_location_reset(response.redirect);
        ota_content_range_reset(response.content_range);
        esp_err_t e = esp_http_client_open(client, 0);
        if (e != ESP_OK) {
            return http_deadline_reached(operation_started, operation_deadline)
                 ? ESP_ERR_TIMEOUT : e;
        }
        if (!set_http_timeout_to_deadline(client, operation_started, operation_deadline))
            return ESP_ERR_TIMEOUT;
        const int64_t header_result = esp_http_client_fetch_headers(client);
        if (header_result < 0) {
            return http_deadline_reached(operation_started, operation_deadline)
                 ? ESP_ERR_TIMEOUT : ESP_FAIL;
        }
        if (http_deadline_reached(operation_started, operation_deadline)) return ESP_ERR_TIMEOUT;
        status = esp_http_client_get_status_code(client);
        if (status == expected_status) return ESP_OK;
        const bool redirect = status == 301 || status == 302 || status == 303 ||
                              status == 307 || status == 308;
        if (!redirect || redirects == kMaxRedirects) return ESP_FAIL;
        if (!ota_redirect_location_accepted(response.redirect)) return ESP_ERR_INVALID_ARG;
        e = esp_http_client_set_redirection(client);
        if (e != ESP_OK) return e;
        // `set_redirection` consumes Location while the response still exists.  Only then discard
        // the old response/socket so the next esp_http_client_open starts a clean TLS request.
        esp_http_client_close(client);
        esp_http_client_clear_response_buffer(client);
    }
    return ESP_FAIL;
}

void set_state(const char* state, const char* message = "") {
    Lock lk(s_mtx);
    s_status.state   = state;
    s_status.message = message;
}

void set_progress(int pct) {
    // One sample per percentage point records a representative transfer low-water series without
    // turning every 2 KiB flash write into telemetry work. It cannot see allocations created and
    // released inside one blocking IDF call, so /ota/status names these sampled minima rather than
    // claiming a continuous allocator trough.
    ota_heap_sample();
    Lock lk(s_mtx);
    s_status.progress = pct;
}

bool wait_for_weather_quiesce() {
    if (!weather_fetch_active()) return true;
    diag_printf("ota: waiting for the in-flight weather TLS client to release heap\n");
    const TickType_t started = xTaskGetTickCount();
    while (weather_fetch_active() && xTaskGetTickCount() - started < kWeatherWait)
        vTaskDelay(kAllocatorRetryDelay);
    if (!weather_fetch_active()) return true;
    const OtaHeapSample sample = ota_heap_sample();
    diag_printf("ota: weather TLS client did not quiesce (free=%u B largest=%u B)\n",
                static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block));
    return false;
}

bool wait_for_poll_quiesce() {
    if (hp_poll_ota_quiesced()) return true;
    diag_printf("ota: waiting for the in-flight X10A poll cycle to release heap\n");
    const TickType_t started = xTaskGetTickCount();
    while (!hp_poll_ota_quiesced() && xTaskGetTickCount() - started < kPollQuiesceWait)
        vTaskDelay(kAllocatorRetryDelay);
    if (hp_poll_ota_quiesced()) return true;
    const OtaHeapSample sample = ota_heap_sample();
    diag_printf("ota: X10A poll task did not acknowledge quiesce (free=%u B largest=%u B)\n",
                static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block));
    return false;
}

bool wait_for_mqtt_quiesce() {
    if (mqtt_publish_network_quiesced()) return true;
    diag_printf("ota: waiting for the MQTT publish cycle to release heap\n");
    const TickType_t started = xTaskGetTickCount();
    while (!mqtt_publish_network_quiesced() &&
           xTaskGetTickCount() - started < kPollQuiesceWait)
        vTaskDelay(kAllocatorRetryDelay);
    if (mqtt_publish_network_quiesced()) return true;
    const OtaHeapSample sample = ota_heap_sample();
    diag_printf("ota: MQTT publisher did not acknowledge quiesce (free=%u B largest=%u B)\n",
                static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block));
    return false;
}

bool wait_for_mqtt_transport_quiesce() {
    if (mqtt_transport_network_quiesced()) return true;
    diag_printf("ota: waiting for the esp-mqtt transport to release heap\n");
    const TickType_t started = xTaskGetTickCount();
    while (!mqtt_transport_network_quiesced() &&
           xTaskGetTickCount() - started < kPollQuiesceWait)
        vTaskDelay(kAllocatorRetryDelay);
    if (mqtt_transport_network_quiesced()) return true;
    const OtaHeapSample sample = ota_heap_sample();
    diag_printf("ota: esp-mqtt transport did not acknowledge quiesce (free=%u B largest=%u B)\n",
                static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block));
    return false;
}

bool wait_for_modbus_quiesce() {
    if (mb_network_quiesced()) return true;
    diag_printf("ota: waiting for the in-flight HomeHub cycle to release heap\n");
    const TickType_t started = xTaskGetTickCount();
    while (!mb_network_quiesced() && xTaskGetTickCount() - started < kPollQuiesceWait)
        vTaskDelay(kAllocatorRetryDelay);
    if (mb_network_quiesced()) return true;
    const OtaHeapSample sample = ota_heap_sample();
    diag_printf("ota: HomeHub task did not acknowledge quiesce (free=%u B largest=%u B)\n",
                static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block));
    return false;
}

bool wait_for_syslog_quiesce() {
    if (syslog_network_quiesced()) return true;
    diag_printf("ota: waiting for the in-flight Syslog cycle to release heap\n");
    const TickType_t started = xTaskGetTickCount();
    while (!syslog_network_quiesced() && xTaskGetTickCount() - started < kPollQuiesceWait)
        vTaskDelay(kAllocatorRetryDelay);
    if (syslog_network_quiesced()) return true;
    const OtaHeapSample sample = ota_heap_sample();
    diag_printf("ota: Syslog task did not acknowledge quiesce (free=%u B largest=%u B)\n",
                static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block));
    return false;
}

// The feed this device follows right now (config ota_channel, POST /set_ota). Read fresh on every
// check/update rather than cached at boot: switching channels applies LIVE, so a user who picks
// "Development" in the UI and immediately taps check must get the dev manifest, not the one that
// was configured when the board booted.
OtaChannel channel_now() { return config_ota_channel(); }

// Fetch the manifest for `url` and extract the exact artifact identity into `out`.
// `err` receives a short, USER-FACING reason on failure — the UI shows it verbatim, so it must say
// what to do about it, not just what failed.
bool fetch_manifest_identity_once(const std::string& url, OtaManifestIdentity& out,
                                  const char*& err, bool& retryable_allocator_failure) {
    retryable_allocator_failure = false;
    // An empty URL means this build has no feed configured for the selected channel (an empty
    // firmware base URL — see logic/ota_channel.hpp). Say that, rather than letting the client
    // fail on a relative path and reporting an unreachable server.
    if (url.empty()) { err = "No update URL configured"; return false; }
    if (!ota_url_is_absolute_https(url)) { err = "Update URL must use HTTPS"; return false; }

    // A manifest is small, but its fresh TLS/X509 handshake is not. The previous implementation
    // admitted this path without any headroom check and used the verifier's much smaller budget
    // only before the later firmware connection. Apply the measured TLS budget at the last point
    // before the client allocates, after URL/task/config state already exists.
    OtaHeapSample manifest_heap{};
    if (!wait_for_ota_headroom("manifest", OTA_TRANSFER_HEADROOM,
                               kTransferHeadroomMaxAttempts, manifest_heap)) {
        err = "Not enough memory to check for updates — retry after reboot";
        return false;
    }

    const HttpClientProbe before = http_client_probe();
    esp_http_client_config_t cfg = {};
    cfg.url               = url.c_str();
    cfg.timeout_ms        = kHttpTimeoutMs;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;   // public CA bundle, same as MQTTS
    cfg.keep_alive_enable = false;
    cfg.transport_type    = HTTP_TRANSPORT_OVER_SSL;
    // Manifest redirects are unnecessary for the fixed Pages feed. Refusing them avoids a second
    // policy path where an HTTPS URL could point the client at plaintext before image signing ever
    // gets a say.
    cfg.disable_auto_redirect = true;

    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) {
        http_client_log_init_failure("ota", before);
        err = "Not enough memory for update TLS — retry after reboot";
        retryable_allocator_failure = true;
        return false;
    }

    bool ok = false;
    const TickType_t manifest_started = xTaskGetTickCount();
    esp_err_t e = esp_http_client_open(c, 0);
    const OtaHeapSample manifest_open_heap = ota_heap_sample();
    if (e != ESP_OK) {
        const HttpClientOpenFailure failure =
            http_client_log_open_failure("ota", c, e, before);
        // Retry only the allocator-shaped failures seen on the live board. DNS, TCP, certificate
        // and HTTP errors are real reachability failures; retrying those here would merely delay the
        // same answer and blur the diagnostic that distinguishes them.
        retryable_allocator_failure =
            e == ESP_ERR_NO_MEM || failure.tls_error == ESP_ERR_MBEDTLS_SSL_SETUP_FAILED;
        err = retryable_allocator_failure
            ? "Not enough memory for update TLS — retry after reboot"
            : "Can't reach the update server";
    } else if (esp_http_client_fetch_headers(c) < 0) {
        err = "No response from the update server";
    } else if (esp_http_client_get_status_code(c) != 200) {
        err = "Update server returned an error";
    } else {
        // Read into a FIXED buffer and stop there. Content-Length is a remote claim, so it may
        // never size an allocation; a hostile host advertising 2 GB must simply be truncated here
        // and then fail to parse, rather than being believed.
        char   buf[kManifestMax];
        size_t got = 0;
        bool timed_out = false;
        while (got < sizeof(buf)) {
            if (!set_http_timeout_to_deadline(c, manifest_started, kManifestDeadline)) {
                err = "Update manifest download timed out";
                timed_out = true;
                break;
            }
            const int n = esp_http_client_read(c, buf + got, static_cast<int>(sizeof(buf) - got));
            if (n <= 0) {
                if (http_deadline_reached(manifest_started, kManifestDeadline)) {
                    err = "Update manifest download timed out";
                    timed_out = true;
                }
                break;
            }
            got += static_cast<size_t>(n);
        }
        // manifest_identity() is bounded by `got`, assumes no NUL terminator and requires both the
        // top-level version and provenance.app_sha256.  A legacy/version-only manifest cannot enter
        // the exact-artifact update path.
        if (!timed_out) {
            if (got == 0)                                  err = "Empty manifest";
            else if (!manifest_identity(buf, got, out))
                err = "Manifest has no usable artifact identity";
            else                                           ok = true;
        }
    }
    diag_printf("ota: manifest TLS sample (free=%u B largest=%u B)\n",
                static_cast<unsigned>(manifest_open_heap.free_bytes),
                static_cast<unsigned>(manifest_open_heap.largest_internal_block));
    close_http_client(c);
    ota_heap_sample();
    return ok;
}

bool fetch_manifest_identity(const std::string& url, OtaManifestIdentity& out, const char*& err) {
    for (unsigned attempt = 0; attempt < 2; ++attempt) {
        bool retryable = false;
        if (fetch_manifest_identity_once(url, out, err, retryable)) return true;
        if (!retryable || attempt != 0) return false;
        diag_printf("ota: manifest TLS allocation failed, retrying once after quiesce\n");
        vTaskDelay(kAllocatorRetryDelay);
    }
    return false;
}

// Fetch the optional changelog.json published beside the selected manifest.  Failure is deliberately
// non-fatal: a self-hosted or older feed without notes still offers the exact signed artifact, while
// the UI shows an explicit localized fallback instead of inventing changes.  Unlike manifest.json,
// this body never lives on the OTA stack and never participates in update authorization.
ChangelogBuffer fetch_changelog(const std::string& manifest_url, const char* expected_version) {
    char url[256] = {};
    if (!ota_manifest_sibling_url(manifest_url, "changelog.json", url, sizeof(url)) ||
        !ota_url_is_absolute_https(url)) return {};

    // Notes open the same fresh dynamic-record TLS/X509 client as the manifest. Require the same
    // measured, stable 56/24 KiB admission at the last point before client allocation; courtesy
    // prose may disappear into the localized fallback, but may never weaken the network-heap race
    // closure which protects the authoritative update path.
    OtaHeapSample changelog_heap{};
    if (!wait_for_ota_headroom("changelog", OTA_CHANGELOG_HEADROOM,
                               kTransferHeadroomMaxAttempts, changelog_heap)) {
        diag_printf("ota: skipping changelog on low/unstable heap\n");
        return {};
    }

    const HttpClientProbe before = http_client_probe();
    esp_http_client_config_t cfg = {};
    cfg.url               = url;
    cfg.timeout_ms        = kChangelogHttpTimeoutMs;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.keep_alive_enable = false;
    cfg.transport_type    = HTTP_TRANSPORT_OVER_SSL;
    cfg.disable_auto_redirect = true;

    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) {
        http_client_log_init_failure("ota changelog", before);
        return {};
    }

    ChangelogBuffer document;
    bool ok = false;
    size_t decoded_len = 0;
    bool timed_out = false;
    const TickType_t changelog_started = xTaskGetTickCount();
    if (!set_http_timeout_to_deadline(c, changelog_started, kChangelogDeadline,
                                      kChangelogHttpTimeoutMs)) {
        close_http_client(c);
        return {};
    }
    const esp_err_t opened = esp_http_client_open(c, 0);
    if (opened == ESP_OK) {
        int64_t announced = -1;
        if (set_http_timeout_to_deadline(c, changelog_started, kChangelogDeadline,
                                         kChangelogHttpTimeoutMs))
            announced = esp_http_client_fetch_headers(c);
        else
            timed_out = true;
        if (!timed_out && !http_deadline_reached(changelog_started, kChangelogDeadline) &&
            announced >= 0 && static_cast<uint64_t>(announced) <= kChangelogDocumentMax &&
            esp_http_client_get_status_code(c) == 200) {
            // TLS owns its dynamic handshake buffers now, so this bounded courtesy allocation can
            // no longer steal the contiguous block needed to establish the connection. A refusal
            // is presentation-only and returns the localized no-notes fallback.
            document.reset(static_cast<char*>(
                heap_caps_calloc(1, kChangelogDocumentMax, MALLOC_CAP_8BIT)));
            if (!document) {
                close_http_client(c);
                return {};
            }
            size_t got = 0;
            bool read_error = false;
            while (got < kChangelogDocumentMax) {
                if (!set_http_timeout_to_deadline(c, changelog_started, kChangelogDeadline,
                                                  kChangelogHttpTimeoutMs)) {
                    timed_out = true;
                    break;
                }
                const int n = esp_http_client_read(
                    c, document.get() + got,
                    static_cast<int>(kChangelogDocumentMax - got));
                if (n <= 0) {
                    timed_out = http_deadline_reached(changelog_started, kChangelogDeadline);
                    read_error = n < 0 && !timed_out;
                    break;
                }
                got += static_cast<size_t>(n);
            }
            // If the fixed document buffer filled, prove EOF with one byte.  Otherwise a hostile
            // oversized document whose valid prefix happens to parse could be presented as complete.
            char extra = 0;
            int extra_read = 0;
            if (got == kChangelogDocumentMax) {
                if (!set_http_timeout_to_deadline(c, changelog_started, kChangelogDeadline,
                                                  kChangelogHttpTimeoutMs))
                    timed_out = true;
                else
                    extra_read = esp_http_client_read(c, &extra, 1);
            }
            if (extra_read < 0) read_error = true;
            const bool complete = extra_read == 0 && esp_http_client_is_complete_data_received(c);
            ok = !timed_out && !read_error && complete && got > 0 &&
                 manifest_changelog(document.get(), got, expected_version, document.get(),
                                    OTA_CHANGELOG_TEXT_MAX + 1);
            if (ok) decoded_len = std::strlen(document.get());
        }
    } else {
        http_client_log_open_failure("ota changelog", c, opened, before);
    }
    close_http_client(c);
    if (!ok) return {};

    // The remote-document allocation existed only after the handshake and is still deliberately
    // temporary. Once every TLS/client allocation has gone, retain exactly the decoded bytes rather
    // than leaving the 1025-byte body slot as a long-lived island between coalescing TLS blocks.
    ChangelogBuffer retained(static_cast<char*>(
        heap_caps_malloc(decoded_len + 1, MALLOC_CAP_8BIT)));
    if (!retained) return {};
    std::memcpy(retained.get(), document.get(), decoded_len + 1);
    return retained;
}

void run_check() {
    set_state("checking");
    const std::string running = esp_app_get_description()->version;
    const OtaChannel  ch      = channel_now();
    const std::string url     = ota_channel_manifest_url(CONFIG_DAIKIN_OTA_MANIFEST_URL,
                                                         CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, ch);

    OtaManifestIdentity offer{};
    const char* err       = "Update check failed";
    if (!fetch_manifest_identity(url, offer, err)) {
        diag_printf("ota: check failed (%s channel): %s\n", ota_channel_name(ch), err);
        Lock lk(s_mtx);
        s_status.state            = "error";
        s_status.message          = err;
        s_status.update_available = false;
        s_status.downgrade        = false;
        s_status.available.clear();
        s_status.available_sha256.fill('\0');
        s_status.available_channel.clear();
        return;
    }

    const bool newer = ota_is_upgrade(running, offer.version);
    // Installable but OLDER — the dev -> release direction. Reported so the UI can offer it as a
    // switch back rather than silently calling the release channel "up to date" on a dev board.
    const bool down = !newer && ota_install_allowed(running, offer.version, /*allow_downgrade=*/true);
    ChangelogBuffer changelog = (newer || down) ? fetch_changelog(url, offer.version)
                                                : ChangelogBuffer{};
    const bool have_changelog = static_cast<bool>(changelog);
    if ((newer || down) && !have_changelog)
        diag_printf("ota: %s changelog unavailable or invalid for %s\n",
                    ota_channel_name(ch), offer.version);
    diag_printf("ota: %s manifest %s, running %s -> %s\n", ota_channel_name(ch), offer.version, running.c_str(),
                newer ? "update available" : down ? "older build offered" : "up to date");
    bool changelog_timer_unavailable = false;
    {
        Lock lk(s_mtx);
        s_status.state            = "idle";
        s_status.message          = "";
        s_status.available        = offer.version;
        std::memcpy(s_status.available_sha256.data(), offer.app_sha256,
                    sizeof(s_status.available_sha256));
        s_status.available_channel = ota_channel_name(ch);
        s_status.update_available = newer;
        s_status.downgrade        = down;
        s_status.channel          = ota_channel_name(ch);
        s_changelog_len = have_changelog ? std::strlen(changelog.get()) : 0;
        s_changelog = have_changelog ? changelog.release() : nullptr;
        s_changelog_generation = s_generation;
        if (have_changelog) {
            s_changelog_expiry_us = esp_timer_get_time() + kChangelogLeaseTtlUs;
            if (!s_changelog_timer || xTimerReset(s_changelog_timer, 0) != pdPASS) {
                // Timer-queue pressure must not turn optional prose into retained heap. Preserve
                // the generation as a valid empty-note response so the signed offer reaches the UI.
                discard_changelog_text_locked();
                changelog_timer_unavailable = true;
            }
        }
    }
    if (changelog_timer_unavailable)
        diag_printf("ota: changelog expiry timer unavailable; using no-notes fallback\n");
}

void run_update(const OtaTaskArgs& request) {
    const bool allow_downgrade = request.mode == OtaTaskMode::Downgrade;
    const std::string running = esp_app_get_description()->version;
    const OtaChannel  ch      = request.channel;
    set_state("checking", "Verifying the update");

    // Re-fetch the exact channel captured by the accepted /ota/check.  The acceptance boundary has
    // already refused callers without that generation/version/SHA lease; the fresh fetch proves the
    // feed still serves the same artifact before any image bytes are requested.
    OtaManifestIdentity offer{};
    const char* err       = "Update check failed";
    if (!fetch_manifest_identity(ota_channel_manifest_url(CONFIG_DAIKIN_OTA_MANIFEST_URL,
                                                          CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, ch),
                                 offer, err)) {
        diag_printf("ota: update aborted, %s manifest fetch failed: %s\n", ota_channel_name(ch), err);
        set_state("error", err);
        return;
    }

    // The accepted request names the exact result of one completed /ota/check.  Re-fetching keeps
    // direct/UI updates fresh, while this equality gate prevents a feed replacement between check
    // and POST from redirecting an already accepted production operation.
    if (std::strcmp(offer.version, request.version) != 0 ||
        std::strcmp(offer.app_sha256, request.app_sha256) != 0) {
        diag_printf("ota: update aborted, checked artifact changed (%s channel, expected %s)\n",
                    ota_channel_name(ch), request.version);
        set_state("error", "Update offer changed — check again");
        return;
    }
    const char* avail = offer.version;

    // THE DOWNGRADE GATE — before a single byte of image is fetched. Gating the install instead of
    // the download would still let a hostile host burn the inactive slot and the bandwidth, and
    // would trust that the image we verify is the image we were offered.
    //
    // `allow_downgrade` comes from the REQUEST (?downgrade=1), never from the manifest, and only
    // relaxes the ordering — an equal version and an unparseable one are still refused. It is what
    // makes the release channel reachable from a board that has been following dev.
    if (!ota_install_allowed(running, avail, allow_downgrade)) {
        diag_printf("ota: refusing %s while running %s (%s)\n", avail, running.c_str(),
                    allow_downgrade ? "not a different version" : "not strictly newer");
        Lock lk(s_mtx);
        s_status.state            = "error";
        // With the downgrade flag set, "no NEWER firmware" would be a wrong diagnosis: the only way
        // to land here is an equal (or unparseable) version, i.e. the channel already serves what is
        // running — which is the ordinary outcome of switching to a channel you are already on.
        s_status.message          = allow_downgrade ? "This channel already serves the running build"
                                                    : "No newer firmware available";
        s_status.available        = avail;
        s_status.update_available = false;
        return;
    }

    {
        Lock lk(s_mtx);
        s_status.available        = avail;
        s_status.update_available = true;
        s_status.channel          = ota_channel_name(ch);
        s_status.progress         = 0;
        s_status.state            = "updating";
        s_status.message          = "";
    }

    const std::string url = ota_channel_firmware_url(
        CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, ch,
        std::string("daikin-altherma-esp32") + ota_img_suffix() + ".bin");
    if (url.empty()) {
        diag_printf("ota: no firmware URL configured for the %s channel\n", ota_channel_name(ch));
        set_state("error", "No update URL configured");
        return;
    }
    if (!ota_url_is_absolute_https(url)) {
        diag_printf("ota: refusing non-HTTPS firmware URL\n");
        set_state("error", "Update URL must use HTTPS");
        return;
    }
    diag_printf("ota: downloading %s (%s -> %s, %s channel)\n", url.c_str(), running.c_str(), avail,
                ota_channel_name(ch));

    // The first gate runs while the manifest client's TLS state has already been released and
    // before the firmware transfer claims another client, buffer and OTA handle.  In particular it
    // lets a poll sweep which started just before s_network_active rose finish instead of racing
    // the allocator during esp_ota_begin.
    OtaHeapSample transfer_heap{};
    if (!wait_for_ota_headroom("transfer", OTA_TRANSFER_HEADROOM,
                               kTransferHeadroomMaxAttempts, transfer_heap)) {
        set_state("error", "Not enough memory to start the update download — retry after reboot");
        return;
    }

    OtaFirmwareResponseState response_state;
    esp_http_client_config_t http = {};
    http.url               = url.c_str();
    http.timeout_ms        = kHttpTimeoutMs;
    http.crt_bundle_attach = esp_crt_bundle_attach;
    http.keep_alive_enable = false;
    http.transport_type    = HTTP_TRANSPORT_OVER_SSL;
    // Redirects are consumed only by open_firmware_stream(), after the duplicate-aware policy has
    // accepted exactly one Location. Pin the client itself to manual mode as well, so a future
    // switch from open/read to esp_http_client_perform cannot silently introduce a second,
    // unchecked path.
    http.disable_auto_redirect = true;
    http.event_handler     = firmware_http_event;
    http.user_data         = &response_state;
    // Small receive buffer on purpose. The image is ~1.5 MB but is written to flash chunk by chunk,
    // so nothing here needs to scale with it — and this allocation competes with the MQTTS session
    // for the largest CONTIGUOUS free block, which is the real ceiling on this device.
    http.buffer_size       = kOtaBufSize;

    const HttpClientProbe before = http_client_probe();
    esp_http_client_handle_t client = esp_http_client_init(&http);
    if (!client) {
        http_client_log_init_failure("ota", before);
        set_state("error", "Not enough memory for update TLS — retry after reboot");
        return;
    }

    const TickType_t transfer_started = xTaskGetTickCount();
    int status = 0;
    esp_err_t e = open_firmware_stream(client, response_state, 200, transfer_started,
                                       kFirmwareDeadline, status);
    const OtaHeapSample transfer_open_heap = ota_heap_sample();
    if (e != ESP_OK) {
        const HttpClientOpenFailure failure =
            http_client_log_open_failure("ota", client, e, before);
        close_http_client(client);
        diag_printf("ota: firmware stream failed (status=%d, err=%s, tls=0x%lx)\n", status,
                    esp_err_to_name(e), static_cast<unsigned long>(failure.tls_error));
        const bool allocator_failure =
            e == ESP_ERR_NO_MEM || failure.tls_error == ESP_ERR_MBEDTLS_SSL_SETUP_FAILED;
        set_state("error", allocator_failure
                           ? "Not enough memory for update TLS — retry after reboot"
                           : e == ESP_ERR_TIMEOUT ? "Update download timed out"
                           : status == 0 ? "Can't reach the update server"
                                         : "Update server returned an error");
        return;
    }
    diag_printf("ota: transfer TLS sample (free=%u B largest=%u B)\n",
                static_cast<unsigned>(transfer_open_heap.free_bytes),
                static_cast<unsigned>(transfer_open_heap.largest_internal_block));

    const int64_t total = esp_http_client_get_content_length(client);
    uint8_t* buffer = static_cast<uint8_t*>(
        heap_caps_malloc(kOtaBufSize, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
    if (!buffer) {
        close_http_client(client);
        const OtaHeapSample failed = ota_heap_sample();
        diag_printf("ota: download-buffer allocation failed (free=%u B largest=%u B)\n",
                    static_cast<unsigned>(failed.free_bytes),
                    static_cast<unsigned>(failed.largest_internal_block));
        set_state("error", "Not enough memory for the update download — retry after reboot");
        return;
    }

    const esp_partition_t* update_partition = esp_ota_get_next_update_partition(nullptr);
    if (!update_partition || (total > 0 && static_cast<uint64_t>(total) > update_partition->size)) {
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: no suitable update partition (image=%lld B)\n",
                    static_cast<long long>(total));
        set_state("error", "Update image does not fit this device");
        return;
    }

    // OTA_WITH_SEQUENTIAL_WRITES defers erasing the INACTIVE APP partition until the first
    // esp_ota_write(), so the header/version gates below still reject a mismatched artifact before
    // altering that slot.  esp_ota_begin() may separately invalidate rollback metadata in otadata;
    // it is therefore intentionally not described as making no flash write at all.
    esp_ota_handle_t ota_handle = 0;
    bool ota_open = false;
    e = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &ota_handle);
    if (e == ESP_OK) ota_open = true;
    if (e != ESP_OK) {
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: esp_ota_begin failed (%s)\n", esp_err_to_name(e));
        set_state("error", e == ESP_ERR_NO_MEM
                           ? "Not enough memory for the update download — retry after reboot"
                           : e == ESP_ERR_OTA_ROLLBACK_INVALID_STATE
                           ? "Firmware health check is still running — retry in a moment"
                           : "Couldn't start the download");
        return;
    }

    // Read only the fixed image header/first segment descriptor/app descriptor first.  This binds
    // the manifest version to the bytes actually served before the inactive partition is erased or
    // bulk data is accepted.  All three structures are public esp_app_format API in IDF v6.0.2.
    constexpr size_t kImageProbeSize = sizeof(esp_image_header_t) +
                                       sizeof(esp_image_segment_header_t) +
                                       sizeof(esp_app_desc_t);
    static_assert(kImageProbeSize <= kOtaBufSize, "OTA probe must fit the fixed download buffer");
    size_t probe_len = 0;
    unsigned read_timeouts = 0;
    bool header_timed_out = false;
    while (probe_len < kImageProbeSize) {
        if (!set_http_timeout_to_deadline(client, transfer_started, kFirmwareDeadline)) {
            header_timed_out = true;
            break;
        }
        const int n = esp_http_client_read(client, reinterpret_cast<char*>(buffer + probe_len),
                                           static_cast<int>(kImageProbeSize - probe_len));
        if (n <= 0 && http_deadline_reached(transfer_started, kFirmwareDeadline)) {
            header_timed_out = true;
            break;
        }
        if (n == -ESP_ERR_HTTP_EAGAIN && read_timeouts++ < 2) continue;
        if (n <= 0) break;
        probe_len += static_cast<size_t>(n);
        read_timeouts = 0;
    }
    if (probe_len != kImageProbeSize) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: incomplete image header (%u/%u B)\n",
                    static_cast<unsigned>(probe_len), static_cast<unsigned>(kImageProbeSize));
        set_state("error", header_timed_out ? "Update download timed out"
                                            : "Update image is unreadable");
        return;
    }

    esp_image_header_t image_header{};
    esp_app_desc_t img{};
    std::memcpy(&image_header, buffer, sizeof(image_header));
    std::memcpy(&img, buffer + sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t),
                sizeof(img));
    if (image_header.magic != ESP_IMAGE_HEADER_MAGIC ||
        image_header.chip_id != CONFIG_IDF_FIRMWARE_CHIP_ID ||
        img.magic_word != ESP_APP_DESC_MAGIC_WORD) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: image header rejected (magic=0x%02x chip=%u desc=0x%08lx)\n",
                    image_header.magic, static_cast<unsigned>(image_header.chip_id),
                    static_cast<unsigned long>(img.magic_word));
        set_state("error", "Update image is unreadable");
        return;
    }

    // THE GATE THAT ACTUALLY BINDS — check the IMAGE's own embedded version, not the manifest's
    // claim about it. The manifest and the image are two separate attacker-controlled artifacts: a
    // hostile host can advertise "9.9.9" and serve a genuine, correctly-signed OLD binary, and the
    // signature check would happily pass it — an authentic downgrade onto a fixed vulnerability.
    // The fixed probe above reads esp_app_desc_t out of the first bytes, so this still runs BEFORE
    // the bulk of the image is fetched and before anything is written or committed.
    // (CI already refuses to publish a manifest whose version disagrees with the built image, so in
    // the field a mismatch is a stale cache or an attack — either way, not something to install.)
    char imgver[sizeof(img.version) + 1] = {0};
    std::memcpy(imgver, img.version, sizeof(img.version));   // version[] need not be NUL-terminated
    // ...and that the image the host actually served is the one the manifest DESCRIBED. Passing the
    // ordering gate twice is not the same as passing it on one artifact: running 1.0.0, a manifest
    // claiming 9.9.9 and a signed image carrying 1.0.1 are each "newer", yet nothing checked that
    // the version this device decided to install is the version it is installing. CI publishes the
    // two strings from one stamped value (ci-build-all.sh reads the built image back), so in the
    // field a mismatch is a stale cache, a broken host or an attack.
    if (!ota_artifact_versions_match(avail, imgver)) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: REFUSING image v%s: manifest claimed %s (artifact mismatch)\n", imgver,
                    avail);
        Lock lk(s_mtx);
        s_status.state            = "error";
        s_status.message          = "Update rejected: manifest and image versions differ";
        s_status.update_available = false;
        return;
    }
    if (!ota_install_allowed(running, imgver, allow_downgrade)) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: REFUSING image v%s while running v%s (manifest claimed %s)\n", imgver,
                    running.c_str(), avail);
        Lock lk(s_mtx);
        s_status.state            = "error";
        s_status.message          = "Update rejected: not newer than the running firmware";
        s_status.update_available = false;
        return;
    }

    // Hash the exact downloaded byte stream alongside the OTA write.  Secure-Boot verification
    // proves that the image is authentic; this independent digest proves it is the one bench-tested
    // application whose SHA the accepted check/request pinned.  PSA is initialized by ESP-IDF at
    // system start and the operation object is fixed-size task stack state.
    psa_hash_operation_t hash_operation = PSA_HASH_OPERATION_INIT;
    psa_status_t hash_status = psa_hash_setup(&hash_operation, PSA_ALG_SHA_256);
    bool hash_active = hash_status == PSA_SUCCESS;
    if (!hash_active) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        heap_caps_free(buffer);
        close_http_client(client);
        diag_printf("ota: exact-artifact hash setup failed (%ld)\n", static_cast<long>(hash_status));
        set_state("error", "Couldn't verify the exact update artifact");
        return;
    }

    size_t written = 0;
    int last = -1;
    OtaTransferFailure transfer_failure = OtaTransferFailure::None;
    auto write_chunk = [&](const uint8_t* data, size_t len) -> bool {
        if ((total > 0 && written + len > static_cast<uint64_t>(total)) ||
            written + len > update_partition->size) {
            e = ESP_ERR_INVALID_SIZE;
            transfer_failure = OtaTransferFailure::Size;
            return false;
        }
        hash_status = psa_hash_update(&hash_operation, data, len);
        if (hash_status != PSA_SUCCESS) {
            transfer_failure = OtaTransferFailure::Hash;
            return false;
        }
        const esp_err_t write_e = esp_ota_write(ota_handle, data, len);
        if (write_e != ESP_OK) {
            e = write_e;
            transfer_failure = OtaTransferFailure::Write;
            return false;
        }
        written += len;
        if (total > 0) {
            const int pct = static_cast<int>((static_cast<uint64_t>(written) * 100) /
                                             static_cast<uint64_t>(total));
            if (pct != last) { set_progress(pct); last = pct; }
        }
        return true;
    };

    bool transfer_ok = write_chunk(buffer, probe_len);
    bool response_complete = false;
    unsigned resumes = 0;
    size_t stream_started_at = 0;
    read_timeouts = 0;
    while (transfer_ok) {
        if (!set_http_timeout_to_deadline(client, transfer_started, kFirmwareDeadline)) {
            e = ESP_ERR_TIMEOUT;
            transfer_failure = OtaTransferFailure::Timeout;
            transfer_ok = false;
            break;
        }
        const int n = esp_http_client_read(client, reinterpret_cast<char*>(buffer), kOtaBufSize);
        if (n <= 0 && http_deadline_reached(transfer_started, kFirmwareDeadline)) {
            e = ESP_ERR_TIMEOUT;
            transfer_failure = OtaTransferFailure::Timeout;
            transfer_ok = false;
            break;
        }
        if (n == -ESP_ERR_HTTP_EAGAIN && read_timeouts++ < 2) continue;
        if (n > 0) {
            read_timeouts = 0;
            transfer_ok = write_chunk(buffer, static_cast<size_t>(n));
            continue;
        }

        response_complete = esp_http_client_is_complete_data_received(client) &&
                            (total <= 0 || written == static_cast<uint64_t>(total));
        if (n == 0 && response_complete) break;

        const TickType_t elapsed_ticks = xTaskGetTickCount() - transfer_started;
        const uint64_t elapsed_ms_64 = static_cast<uint64_t>(elapsed_ticks) * portTICK_PERIOD_MS;
        http_client_log_read_failure(
            "ota", client, n, written, total,
            elapsed_ms_64 > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(elapsed_ms_64));

        const bool deadline_reached = http_deadline_reached(transfer_started, kFirmwareDeadline);
        const bool can_resume = total > 0 && ota_transfer_resume_allowed(
            resumes, stream_started_at, written, static_cast<uint64_t>(total), deadline_reached);
        if (!can_resume) {
            e = deadline_reached ? ESP_ERR_TIMEOUT
                : n == -ESP_ERR_HTTP_EAGAIN ? ESP_ERR_HTTP_EAGAIN : ESP_FAIL;
            transfer_failure = deadline_reached ? OtaTransferFailure::Timeout
                                                : OtaTransferFailure::Read;
            transfer_ok = false;
            break;
        }

        ++resumes;
        const uint64_t resume_at = written;
        diag_printf("ota: firmware read interrupted at %u/%lld B; attempting range resume %u/%u\n",
                    static_cast<unsigned>(resume_at), static_cast<long long>(total), resumes,
                    OTA_TRANSFER_MAX_RESUMES);

        // Free all transport-owned dynamic state before applying the same measured admission gate
        // as the initial image TLS handshake.  The OTA handle and PSA hash deliberately survive:
        // they already own the exact sequential flash/hash position represented by `written`.
        heap_caps_free(buffer);
        buffer = nullptr;
        close_http_client(client);
        ota_heap_sample();

        OtaHeapSample resume_heap{};
        if (!wait_for_ota_headroom_until("transfer resume", OTA_TRANSFER_HEADROOM,
                                         kTransferHeadroomMaxAttempts, transfer_started,
                                         kFirmwareDeadline, resume_heap)) {
            e = http_deadline_reached(transfer_started, kFirmwareDeadline)
              ? ESP_ERR_TIMEOUT : ESP_ERR_NO_MEM;
            transfer_failure = e == ESP_ERR_TIMEOUT ? OtaTransferFailure::Timeout
                                                    : OtaTransferFailure::Read;
            transfer_ok = false;
            break;
        }
        if (http_deadline_reached(transfer_started, kFirmwareDeadline)) {
            e = ESP_ERR_TIMEOUT;
            transfer_failure = OtaTransferFailure::Timeout;
            transfer_ok = false;
            break;
        }

        const HttpClientProbe resume_before = http_client_probe();
        client = esp_http_client_init(&http);
        if (!client) {
            http_client_log_init_failure("ota-resume", resume_before);
            e = ESP_ERR_NO_MEM;
            transfer_failure = OtaTransferFailure::Read;
            transfer_ok = false;
            break;
        }

        char range_header[64];
        const int range_len = std::snprintf(range_header, sizeof(range_header), "bytes=%llu-",
                                            static_cast<unsigned long long>(resume_at));
        if (range_len <= 0 || static_cast<size_t>(range_len) >= sizeof(range_header) ||
            esp_http_client_set_header(client, "Range", range_header) != ESP_OK) {
            e = ESP_ERR_NO_MEM;
            transfer_failure = OtaTransferFailure::Read;
            close_http_client(client);
            transfer_ok = false;
            break;
        }

        status = 0;
        e = open_firmware_stream(client, response_state, 206, transfer_started,
                                 kFirmwareDeadline, status);
        const OtaHeapSample resume_open_heap = ota_heap_sample();
        if (e != ESP_OK) {
            const HttpClientOpenFailure failure =
                http_client_log_open_failure("ota-resume", client, e, resume_before);
            diag_printf("ota: range resume open failed (status=%d err=%s tls=0x%lx)\n", status,
                        esp_err_to_name(e), static_cast<unsigned long>(failure.tls_error));
            close_http_client(client);
            transfer_failure = e == ESP_ERR_TIMEOUT ? OtaTransferFailure::Timeout
                                                    : OtaTransferFailure::Read;
            transfer_ok = false;
            break;
        }

        const uint64_t remaining = static_cast<uint64_t>(total) - resume_at;
        const int64_t response_length = esp_http_client_get_content_length(client);
        const bool range_ok = ota_content_range_matches(
            response_state.content_range, resume_at, static_cast<uint64_t>(total));
        if (!range_ok || esp_http_client_is_chunked_response(client) ||
            response_length < 0 || static_cast<uint64_t>(response_length) != remaining) {
            diag_printf("ota: range resume rejected (status=%d content_length=%lld expected=%llu "
                        "content_range_count=%u valid=%d start=%llu end=%llu total=%llu)\n",
                        status, static_cast<long long>(response_length),
                        static_cast<unsigned long long>(remaining),
                        response_state.content_range.header_count,
                        response_state.content_range.valid ? 1 : 0,
                        static_cast<unsigned long long>(response_state.content_range.start),
                        static_cast<unsigned long long>(response_state.content_range.end),
                        static_cast<unsigned long long>(response_state.content_range.total));
            e = ESP_ERR_INVALID_RESPONSE;
            transfer_failure = OtaTransferFailure::Read;
            close_http_client(client);
            transfer_ok = false;
            break;
        }

        buffer = static_cast<uint8_t*>(
            heap_caps_malloc(kOtaBufSize, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
        if (!buffer) {
            const OtaHeapSample failed = ota_heap_sample();
            diag_printf("ota: resume-buffer allocation failed (free=%u B largest=%u B)\n",
                        static_cast<unsigned>(failed.free_bytes),
                        static_cast<unsigned>(failed.largest_internal_block));
            e = ESP_ERR_NO_MEM;
            transfer_failure = OtaTransferFailure::Read;
            close_http_client(client);
            transfer_ok = false;
            break;
        }
        diag_printf("ota: range resume accepted at %u B (free=%u B largest=%u B)\n",
                    static_cast<unsigned>(resume_at),
                    static_cast<unsigned>(resume_open_heap.free_bytes),
                    static_cast<unsigned>(resume_open_heap.largest_internal_block));
        stream_started_at = resume_at;
        e = ESP_OK;
        transfer_failure = OtaTransferFailure::None;
        read_timeouts = 0;
    }

    const bool complete = transfer_ok && response_complete &&
                          (total <= 0 || written == static_cast<uint64_t>(total));

    // CRITICAL ORDERING: free the fixed download buffer and the HTTP/TLS client BEFORE
    // esp_ota_end().  IDF v6.0.2's esp_https_ota_finish() does the reverse — esp_ota_end first,
    // cleanup second — so RSA/PSA verification had to allocate beside TLS and failed on the live
    // board with a 632-byte low-water mark.  The raw esp_ota API preserves the exact same signed
    // image verifier while letting the transport release its heap first.
    if (buffer) heap_caps_free(buffer);
    buffer = nullptr;
    close_http_client(client);
    ota_heap_sample();

    if (!transfer_ok || !complete) {
        if (hash_active) {
            psa_hash_abort(&hash_operation);
            hash_active = false;
        }
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        const OtaHeapSample failed = ota_heap_sample();
        diag_printf("ota: download failed (class=%s err=%s, complete=%d, bytes=%u/%lld, "
                    "free=%u B largest=%u B)\n",
                    ota_transfer_failure_name(transfer_failure), esp_err_to_name(e),
                    complete ? 1 : 0, static_cast<unsigned>(written),
                    static_cast<long long>(total), static_cast<unsigned>(failed.free_bytes),
                    static_cast<unsigned>(failed.largest_internal_block));
        const char* message = transfer_failure == OtaTransferFailure::Size
                            ? "Update rejected: image size is invalid"
                            : transfer_failure == OtaTransferFailure::Hash
                            ? "Couldn't verify the exact update artifact"
                            : transfer_failure == OtaTransferFailure::Write
                            ? "Couldn't write the update"
                            : transfer_failure == OtaTransferFailure::Timeout
                            ? "Update download timed out"
                            : !complete ? "Incomplete download"
                                        : "Download failed — check the connection";
        set_state("error", message);
        return;
    }

    uint8_t actual_sha256[32] = {0};
    size_t actual_sha256_len = 0;
    hash_status = psa_hash_finish(&hash_operation, actual_sha256, sizeof(actual_sha256),
                                  &actual_sha256_len);
    if (hash_status != PSA_SUCCESS) psa_hash_abort(&hash_operation);
    hash_active = false;
    if (hash_status != PSA_SUCCESS || actual_sha256_len != sizeof(actual_sha256) ||
        !ota_sha256_matches(actual_sha256, request.app_sha256)) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        diag_printf("ota: exact-artifact SHA-256 mismatch/status=%ld — running image intact\n",
                    static_cast<long>(hash_status));
        set_state("error", "Update rejected: artifact does not match the checked build");
        return;
    }

    OtaHeapSample verify_heap{};
    if (!wait_for_ota_headroom("validation", OTA_VALIDATION_HEADROOM,
                               kValidationHeadroomMaxAttempts, verify_heap)) {
        if (ota_open) { esp_ota_abort(ota_handle); ota_open = false; }
        set_state("error", "Not enough memory to verify the update — retry after reboot");
        return;
    }

    // esp_ota_end() is the SAME IDF RSA-3072 Secure-Boot-v2 verifier selected by
    // CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y.  It runs only after TLS cleanup and only
    // with the headroom gate above; no unsigned/tampered image can reach the boot selector.  The
    // handle becomes invalid regardless of result, so mark it closed before the call.
    ota_open = false;
    e = esp_ota_end(ota_handle);
    if (e != ESP_OK) {
        const OtaHeapSample after = ota_heap_sample();
        if (e == ESP_ERR_OTA_VALIDATE_FAILED) {
            // IDF deliberately collapses bad image structure, digest/signature failure AND verifier
            // allocation failure into ESP_ERR_OTA_VALIDATE_FAILED.  Do not claim which one occurred.
            diag_printf("ota: image validation failed (%s; before free=%u B largest=%u B; "
                        "after free=%u B largest=%u B) — running image intact\n",
                        esp_err_to_name(e), static_cast<unsigned>(verify_heap.free_bytes),
                        static_cast<unsigned>(verify_heap.largest_internal_block),
                        static_cast<unsigned>(after.free_bytes),
                        static_cast<unsigned>(after.largest_internal_block));
            set_state("error", "Update rejected: image validation failed");
        } else {
            diag_printf("ota: esp_ota_end failed (%s; free=%u B largest=%u B)\n",
                        esp_err_to_name(e), static_cast<unsigned>(after.free_bytes),
                        static_cast<unsigned>(after.largest_internal_block));
            set_state("error", "Couldn't install the update");
        }
        return;
    }

    // Selection is deliberately separate and strictly AFTER successful validation. IDF validates
    // once more while setting otadata, so protect that second RSA/PSA pass with the same independent
    // post-TLS budget. A refusal still leaves the running slot selected and is safe to retry.
    OtaHeapSample selection_heap{};
    if (!wait_for_ota_headroom("boot selection", OTA_VALIDATION_HEADROOM,
                               kValidationHeadroomMaxAttempts, selection_heap)) {
        set_state("error", "Not enough memory to activate the update — retry after reboot");
        return;
    }
    e = esp_ota_set_boot_partition(update_partition);
    if (e != ESP_OK) {
        const OtaHeapSample after = ota_heap_sample();
        diag_printf("ota: validated image but boot selection failed (%s; free=%u B largest=%u B)\n",
                    esp_err_to_name(e), static_cast<unsigned>(after.free_bytes),
                    static_cast<unsigned>(after.largest_internal_block));
        set_state("error", e == ESP_ERR_OTA_VALIDATE_FAILED
                           ? "Update rejected: image validation failed"
                           : "Couldn't activate the update");
        return;
    }

    diag_printf("ota: installed %s, rebooting (health gate arms on next boot)\n", avail);
    {
        Lock lk(s_mtx);
        s_status.state    = "done";
        s_status.progress = 100;
        s_status.message  = "Rebooting into the new firmware";
    }
    // Outlive both the 1 Hz browser and the gate's 2 Hz connection-churn-bounded observer, with
    // enough LAN/HTTPD scheduling margin for either to retain completed-verifier evidence.
    vTaskDelay(pdMS_TO_TICKS(kDoneBeforeRebootMs));
    esp_restart();
}

// One task body for both operations, so there is exactly one stack and one place the busy flag is
// cleared. The body self-guards: a task is a C frame boundary like an HTTP handler is, so an
// escaping std::bad_alloc means std::terminate -> reboot — and rebooting the heat-pump bridge
// because an update CHECK ran out of memory would be absurd (AGENTS.md → Memory, concurrency, and
// HTTP safety).
void ota_task(void* arg) {
    const OtaTaskArgs request = *static_cast<const OtaTaskArgs*>(arg);
    const bool update = request.mode != OtaTaskMode::Check;
    ota_heap_operation_reset();
    {
        OtaNetworkFlag active;
        vTaskDelay(kNetworkQuiesceLead);
        try {
            // Weather uses the same TLS allocator.  Its task raises its own lock-free activity flag
            // before the race-closing OTA re-check; an already-open request gets one HTTP timeout
            // plus margin to unwind, while a new one observes this OTA flag and never starts.
            if (!wait_for_poll_quiesce()) {
                set_state("error", "Heat-pump polling is still using memory — retry shortly");
            } else if (!wait_for_mqtt_quiesce()) {
                set_state("error", "MQTT publishing is still using memory — retry shortly");
            } else if (!wait_for_mqtt_transport_quiesce()) {
                set_state("error", "MQTT transport is still using memory — retry shortly");
            } else if (!wait_for_modbus_quiesce()) {
                set_state("error", "HomeHub polling is still using memory — retry shortly");
            } else if (!wait_for_syslog_quiesce()) {
                set_state("error", "Syslog is still using memory — retry shortly");
            } else if (!wait_for_weather_quiesce()) {
                set_state("error", "Another network operation is still using memory — retry shortly");
            } else if (update) {
                run_update(request);
            } else {
                run_check();
            }
        } catch (const std::exception& ex) {
            diag_printf("ota: aborted (%s)\n", ex.what());
            set_state("error", "Out of memory — retry in a moment");
        } catch (...) {
            diag_printf("ota: aborted (unknown exception)\n");
            set_state("error", "Update failed");
        }
    }
    { Lock lk(s_mtx); s_busy = false; }
    vTaskDelete(nullptr);
}

uint32_t next_generation(uint32_t current) {
    ++current;
    return current == 0 ? 1 : current;
}

// Spawn while holding the same mutex that owns busy/generation/task arguments.  Publish the complete
// slot before xTaskCreate; the busy-owned slot stays immutable until the task has copied it, even if
// the higher-priority task runs immediately.  On task-creation failure the prior generation is
// restored, so a generation always identifies an operation that actually got a task.
uint32_t start_locked(const OtaTaskArgs& request, uint32_t previous_generation) {
    s_busy = true;
    s_task_args = request;
    s_generation = next_generation(previous_generation);
    ensure_changelog_timer_locked();
    if (s_changelog_timer) xTimerStop(s_changelog_timer, 0);
    clear_changelog_lease_locked();
    if (xTaskCreate(ota_task, "ota", kTaskStack, &s_task_args, kTaskPrio, nullptr) != pdPASS) {
        s_busy = false;
        s_generation = previous_generation;
        s_status.state = "error";
        s_status.message = "Out of memory — retry in a moment";
        return 0;
    }
    return s_generation;
}

uint32_t start_check() {
    Lock lk(s_mtx);
    if (s_busy) return 0;
    return start_locked(OtaTaskArgs{}, s_generation);
}

uint32_t start_update(uint32_t after_generation, const char* expected_channel,
                      const char* expected_version, const char* expected_app_sha256,
                      bool allow_downgrade) {
    if (!after_generation || !expected_channel || !expected_version ||
        !ota_sha256_hex_valid(expected_app_sha256)) return 0;
    const bool dev = std::strcmp(expected_channel, "dev") == 0;
    const bool release = std::strcmp(expected_channel, "release") == 0;
    if (!dev && !release) return 0;
    if (std::strlen(expected_version) == 0 ||
        std::strlen(expected_version) >= sizeof(s_task_args.version))
        return 0;

    Lock lk(s_mtx);
    if (s_busy || s_generation != after_generation || s_status.state != "idle" ||
        s_status.available_channel != expected_channel || s_status.available != expected_version ||
        std::strcmp(s_status.available_sha256.data(), expected_app_sha256) != 0 ||
        (!s_status.update_available && !(allow_downgrade && s_status.downgrade))) return 0;

    OtaTaskArgs request{};
    request.mode = allow_downgrade ? OtaTaskMode::Downgrade : OtaTaskMode::Update;
    request.channel = dev ? OtaChannel::Dev : OtaChannel::Release;
    std::memcpy(request.version, expected_version, std::strlen(expected_version) + 1);
    std::memcpy(request.app_sha256, expected_app_sha256, sizeof(request.app_sha256));
    return start_locked(request, after_generation);
}

}  // namespace

const char* ota_img_suffix() {
    return "";   // esp32s3 is the only target, no suffix needed
}

bool ota_download_active() { return s_network_active.load(std::memory_order_acquire); }

uint32_t ota_check_async(int64_t /*browser_epoch_ms*/) {
    // browser_epoch_ms stays plumbed (the route parses ?ms=) but gates nothing: TLS certificate
    // DATE validation is compiled out (MBEDTLS_HAVE_TIME_DATE is not set), so the fetch needs no
    // wall clock. SNTP exists now for syslog timestamps, but making OTA wait on it would strand a
    // board whose NTP server is unreachable — see docs/SECURITY.md.
    const uint32_t generation = start_check();
    if (!generation) ESP_LOGW("ota", "check ignored: OTA busy or task unavailable");
    return generation;
}

uint32_t ota_update_async(uint32_t after_generation, const char* expected_channel,
                          const char* expected_version, const char* expected_app_sha256,
                          bool allow_downgrade) {
    const uint32_t generation = start_update(after_generation, expected_channel, expected_version,
                                             expected_app_sha256, allow_downgrade);
    if (!generation) ESP_LOGW("ota", "update ignored: OTA busy or task unavailable");
    return generation;
}

bool ota_busy() {
    // Deliberately NOT ota_status().state != "idle": its one caller is the heap watchdog running on
    // a heap that is failing. Read only the primitive this question needs.
    Lock lk(s_mtx);
    return s_busy;
}

OtaStatus ota_status() {
    // The channel is answered from the LIVE config, not from whatever the last check left behind:
    // /ota/status is what the UI reads back after POST /set_ota, and before any check has run there
    // is nothing in s_status to read. Read BEFORE taking s_mtx; the narrow Config accessor copies
    // one enum without copying any of the string-owning service configuration.
    const char* ch = ota_channel_name(config_ota_channel());
    Lock lk(s_mtx);
    s_status.current = esp_app_get_description()->version;
    s_status.channel = ch;
    s_status.busy = s_busy;
    s_status.generation = s_generation;
    s_status.heap_min_free_bytes =
        s_operation_min_free.load(std::memory_order_relaxed);
    s_status.heap_min_largest_block_bytes =
        s_operation_min_largest.load(std::memory_order_relaxed);
    return s_status;
}

bool ota_changelog_chunk(uint32_t expected_generation, size_t offset, char* out, size_t capacity,
                         size_t& total, size_t& copied) {
    total = 0;
    copied = 0;
    if (!expected_generation || (!out && capacity)) return false;
    Lock lk(s_mtx);
    if (s_changelog_expiry_us > 0 && esp_timer_get_time() >= s_changelog_expiry_us)
        clear_changelog_lease_locked();
    if (expected_generation != s_changelog_generation) return false;
    total = s_changelog_len;
    if (offset >= total || capacity == 0) return true;
    copied = std::min(capacity, total - offset);
    if (!s_changelog) return false;
    std::memcpy(out, s_changelog + offset, copied);
    return true;
}

bool ota_changelog_release(uint32_t expected_generation) {
    if (!expected_generation) return false;
    Lock lk(s_mtx);
    if (expected_generation != s_changelog_generation) return false;
    if (s_changelog_timer) xTimerStop(s_changelog_timer, 0);
    clear_changelog_lease_locked();
    return true;
}

// Keep rollback armed until this OTA image has proven HEALTHY, not merely survived a timer. A normal
// connected boot must also retain measured internal-heap headroom, report no allocation-failure
// cycles, and — when X10A is live — complete one accepted state publish. The dev.13 incident stayed
// online while persistent publisher buffers fragmented the largest block and made /status return
// 503, so link-only health was a false positive. A provisioning portal remains a recovery surface
// for a fresh/unconfigured board. The decision is
// the host-tested daik::health_gate_decide(); see logic/health_gate.hpp + docs/SECURITY.md.
//
// Only PENDING_VERIFY images are rollback-armed, and those exist ONLY via esp_ota_set_boot_partition
// (a real OTA), which always leaves a valid previous slot. A USB/@flash_args image boots in
// UNDEFINED state (blank otadata) and short-circuits below — so this can never strand a fresh board.
static constexpr int kHealthBaseWindowS = 90;    // min uptime before committing a healthy image
static constexpr int kHealthHardCapS    = 600;   // keep trying to commit this long; a genuinely
                                                 // good image at a briefly-offline site still gets
                                                 // sealed in. Only a still-offline image past this
                                                 // is restarted while rollback remains armed.
static constexpr int kHealthPollS       = 5;     // re-evaluate cadence

static OtaServiceHealth ota_service_health() {
    const MqttSkipStats mqtt_skips = mqtt_skip_stats();
    const size_t free_bytes = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    const size_t largest = heap_largest_internal_block();
    return {
        .link = net_kind(),
        .recovery_surface = provisioning_ap_active(),
        .heap_ready = ota_health_heap_ready(free_bytes, largest),
        .allocation_failures = heap_guard_restarts() != 0 || mqtt_skips.skipped != 0 ||
                               hp_skipped_cycles() != 0,
        .x10a_required = hp_link_connected() && mqtt_x10a_publish_required(),
        .x10a_published = mqtt_x10a_publish_proven(),
    };
}

static void health_gate_task(void*) {
    const esp_partition_t* running = esp_ota_get_running_partition();
    esp_ota_img_states_t st;
    if (esp_ota_get_state_partition(running, &st) != ESP_OK || st != ESP_OTA_IMG_PENDING_VERIFY) {
        vTaskDelete(nullptr);   // not a rollback-armed OTA image (USB flash / already valid) -> nothing to do
        return;
    }
    // ONE line per boot rather than one per 5 s cycle: an allocation failure that persists for the
    // whole 600 s cap would otherwise write 120 identical lines into the 6 KB diag ring and evict the
    // boot record this window exists to explain — heap_guard.cpp's throttle, for the same reason.
    bool skip_reported = false;
    for (int elapsed = 0;; elapsed += kHealthPollS) {
        // THE BODY SELF-GUARDS, like every other allocating task loop here (AGENTS.md → Memory,
        // concurrency, and HTTP safety), and
        // it is worth saying why it counts as one: net_kind() is atomic-only,
        // provisioning_ap_active() proves the provisioning portal is actually running in this
        // boot; it is boot-latched, and health_gate_decide() is pure.
        // The window this task runs in is the worst possible place to leave that unguarded: 90-600 s
        // into an OTA boot, i.e. exactly when the MQTT discovery burst and a TLS session put the
        // heap at its peak. An escape is std::terminate -> reboot, and a reboot while PENDING_VERIFY
        // ROLLS BACK the image — so the failure mode is not "this board reboots" but "a healthy
        // update is reverted on every board that took it", arriving through the update path itself.
        // Skipping a cycle is safe and is the conservative direction: no verdict is reached, elapsed
        // still advances, and the hard cap still ends the window by leaving the image PENDING_VERIFY.
        try {
            const OtaServiceHealth service = ota_service_health();
            const HealthVerdict v = health_gate_decide(elapsed, kHealthBaseWindowS, kHealthHardCapS,
                                                       service);
            if (v == HealthVerdict::Commit) {
                // The return value decides whether this image survives the next reboot, so it is not
                // one to discard: a failed commit leaves the image PENDING_VERIFY and the bootloader
                // reverts it, and logging the success line over that call would report the opposite
                // of what happened — on the one path where the evidence has to be right.
                const esp_err_t e = esp_ota_mark_app_valid_cancel_rollback();
                if (e == ESP_OK)
                    ESP_LOGI("ota", "image marked valid (health gate passed after %ds, link=%s)",
                             elapsed, net_link_str(service.link));
                else
                    diag_printf("ota: health gate passed but marking the image valid failed (%s) — "
                                "the next reboot rolls back to the previous firmware\n",
                                esp_err_to_name(e));
                break;
            }
            if (v == HealthVerdict::GiveUp) {
                ESP_LOGW("ota", "health gate: service proof failed after %ds; rebooting while "
                                "PENDING_VERIFY -> rollback to the previous firmware", elapsed);
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
                break;  // esp_restart() does not return; keep the fail-closed intent explicit.
            }
        } catch (const std::exception& ex) {
            if (!skip_reported) {
                skip_reported = true;
                diag_printf("ota: health-gate cycle skipped (%s) — still observing\n", ex.what());
            }
        } catch (...) {
            if (!skip_reported) {
                skip_reported = true;
                diag_printf("ota: health-gate cycle skipped (unknown exception) — still observing\n");
            }
        }
        vTaskDelay(pdMS_TO_TICKS(kHealthPollS * 1000));
    }
    vTaskDelete(nullptr);
}

// 4096, raised from 3072 in the same commit that gave the loop its try/catch — the guard is the
// reason, not a round number. The deepest frame is unchanged (config() BY VALUE, ~656 B of Config
// plus its std::string copies), but a task that previously could only std::terminate now UNWINDS,
// and docs/ARCHITECTURE.md's "Memory constraints" section measures that path at ~700 B below the
// throwing frame. Adding it
// to a stack sized before it existed is how a guard against OOM becomes a stack overflow during
// one — the failure it was added to prevent, in the shape this firmware has already shipped twice
// (#241, #318). The right way to settle the number is off the ELF, which a cloud session cannot
// build; 1 KB is the conservative direction and it is TRANSIENT, since this task deletes itself
// once the window closes.
void ota_health_gate_arm() {
    // If the gate task can't be created, a PENDING_VERIFY OTA image is never marked valid and the
    // bootloader will roll it back on the next reboot — safe, but say so (a silent failure looks like
    // a healthy commit that never happened).
    if (xTaskCreate(health_gate_task, "ota_health", 4096, nullptr, TASK_PRIO_OTA_GATE, nullptr) != pdPASS)
        ESP_LOGE("ota", "health-gate task alloc failed — a pending OTA image will roll back on reboot");
}

} // namespace daik
