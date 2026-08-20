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
#include "hp_poll.hpp"
#include "http_client_diag.hpp"
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "provisioning.hpp"
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
#include "esp_tls_errors.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard
#include "freertos/task.h"
#include <atomic>
#include <cstdint>
#include <cstring>
#include <exception>
#include <string>

namespace daik {

namespace {

// s_status is written by the OTA task and read by the httpd task (GET /ota/status), so it needs a
// mutex. Readers copy std::strings out under the lock, which CAN throw — so the lock is taken
// through an RAII guard, never a bare xSemaphoreTake. A raw take that unwinds past the give leaves
// every later reader blocked on portMAX_DELAY and wedges the device into a watchdog reboot, which
// is strictly worse than the OOM it came from (AGENTS.md → Memory, concurrency, and HTTP safety).
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

// Scope guard for that flag. It deliberately covers the manifest TLS handshake too: live evidence
// proved that the small response is irrelevant to the binding allocation — TLS setup itself failed
// while the MQTT publisher still competed for the largest contiguous block. The guard lives around
// the whole task operation so every manifest/download exit and exception clears it in one place.
struct OtaNetworkFlag {
    OtaNetworkFlag()  { s_network_active.store(true,  std::memory_order_release); }
    ~OtaNetworkFlag() { s_network_active.store(false, std::memory_order_release); }
};

// A TLS handshake alone wants ~6 KB of stack, and fetch_manifest_version() puts another
// kManifestMax (1 KB) frame on top of it — 8192 (what the IDF OTA examples use, with no such local)
// would leave almost nothing spare. The task is transient and only ever exists one at a time, so
// the extra 2 KB is borrowed, not resident.
constexpr int  kTaskStack     = 10240;
constexpr UBaseType_t kTaskPrio = TASK_PRIO_OTA;   // see main/task_config.hpp for the tiers
constexpr int  kHttpTimeoutMs = 15000;
constexpr int  kOtaBufSize    = 2048;   // download chunk; deliberately small (contiguous heap)
constexpr size_t kManifestMax = 1024;   // the real manifest is ~200 B; anything larger is not ours
constexpr unsigned kMaxRedirects = 5;
// MQTT publishes once a second. Hold the operation flag for a little longer than one cadence before
// opening TLS so a publisher which woke just before the OTA task has time to finish and stand aside.
constexpr TickType_t kNetworkQuiesceLead = pdMS_TO_TICKS(1100);
constexpr TickType_t kAllocatorRetryDelay = pdMS_TO_TICKS(250);
constexpr TickType_t kVerifyHeadroomRetryDelay = pdMS_TO_TICKS(250);
constexpr unsigned   kVerifyHeadroomMaxAttempts = 20;  // 5 s: transient churn may unwind, never wait forever
constexpr TickType_t kPollQuiesceWait      = pdMS_TO_TICKS(15000);
constexpr TickType_t kWeatherWait          = pdMS_TO_TICKS(kHttpTimeoutMs + 5000);

struct OtaHeapSample {
    size_t free_bytes;
    size_t largest_internal_block;
};

enum class OtaTransferFailure : uint8_t { None, Read, Write, Size };

const char* ota_transfer_failure_name(OtaTransferFailure failure) {
    switch (failure) {
        case OtaTransferFailure::Read:  return "read";
        case OtaTransferFailure::Write: return "write";
        case OtaTransferFailure::Size:  return "size";
        default:                        return "none";
    }
}

OtaHeapSample ota_heap_sample() {
    return {heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL),
            heap_largest_internal_block()};
}

// Wait a short, bounded interval for an allocation-rich task which was already in flight when the
// lock-free OTA flag rose to unwind.  This is called twice by run_update(): before the transfer owns
// an OTA handle, and after HTTP/TLS plus the download buffer have been freed but before esp_ota_end
// invokes Secure-Boot-v2 validation.  Refusing on low headroom is fail-closed and retryable; lowering
// the threshold or skipping verification is not.
bool wait_for_ota_verify_headroom(const char* phase, OtaHeapSample& sample) {
    for (unsigned attempt = 0; attempt < kVerifyHeadroomMaxAttempts; ++attempt) {
        sample = ota_heap_sample();
        if (ota_verify_headroom_ok(sample.free_bytes, sample.largest_internal_block)) {
            diag_printf("ota: %s heap ready (free=%u B largest=%u B)\n", phase,
                        static_cast<unsigned>(sample.free_bytes),
                        static_cast<unsigned>(sample.largest_internal_block));
            return true;
        }
        vTaskDelay(kVerifyHeadroomRetryDelay);
    }

    sample = ota_heap_sample();
    diag_printf("ota: %s blocked by low heap (free=%u B largest=%u B; need %u/%u B)\n",
                phase, static_cast<unsigned>(sample.free_bytes),
                static_cast<unsigned>(sample.largest_internal_block),
                static_cast<unsigned>(OTA_VERIFY_MIN_FREE_BYTES),
                static_cast<unsigned>(OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES));
    return false;
}

void close_http_client(esp_http_client_handle_t& client) {
    if (!client) return;
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    client = nullptr;
}

esp_err_t firmware_http_event(esp_http_client_event_t* event) {
    if (!event || event->event_id != HTTP_EVENT_ON_HEADER || !event->user_data ||
        !event->header_key || !event->header_value) return ESP_OK;
    const std::string_view key(event->header_key);
    if (key.size() != 8 || !ota_ascii_prefix_ieq(key, "Location")) return ESP_OK;
    auto* policy = static_cast<OtaRedirectLocationState*>(event->user_data);
    ota_redirect_location_observe(*policy, event->header_value);
    return ESP_OK;
}

// Open GET and follow the same standard redirect statuses as esp_https_ota in IDF v6.0.2.  The
// client owns no body buffer supplied by the server, and the redirect budget is finite even if a
// broken feed points at itself.
esp_err_t open_firmware_stream(esp_http_client_handle_t client, OtaRedirectLocationState& policy,
                               int& status) {
    for (unsigned redirects = 0; redirects <= kMaxRedirects; ++redirects) {
        ota_redirect_location_reset(policy);
        esp_err_t e = esp_http_client_open(client, 0);
        if (e != ESP_OK) return e;
        if (esp_http_client_fetch_headers(client) < 0) return ESP_FAIL;
        status = esp_http_client_get_status_code(client);
        if (status == 200) return ESP_OK;
        const bool redirect = status == 301 || status == 302 || status == 303 ||
                              status == 307 || status == 308;
        if (!redirect || redirects == kMaxRedirects) return ESP_FAIL;
        if (!ota_redirect_location_accepted(policy)) return ESP_ERR_INVALID_ARG;
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

// The feed this device follows right now (config ota_channel, POST /set_ota). Read fresh on every
// check/update rather than cached at boot: switching channels applies LIVE, so a user who picks
// "Development" in the UI and immediately taps check must get the dev manifest, not the one that
// was configured when the board booted.
OtaChannel channel_now() { return config().ota_channel; }

// Fetch the manifest for `url` and extract its "version" into `out`.
// `err` receives a short, USER-FACING reason on failure — the UI shows it verbatim, so it must say
// what to do about it, not just what failed.
bool fetch_manifest_version_once(const std::string& url, char* out, size_t outlen,
                                 const char*& err, bool& retryable_allocator_failure) {
    retryable_allocator_failure = false;
    // An empty URL means this build has no feed configured for the selected channel (an empty
    // firmware base URL — see logic/ota_channel.hpp). Say that, rather than letting the client
    // fail on a relative path and reporting an unreachable server.
    if (url.empty()) { err = "No update URL configured"; return false; }
    if (!ota_url_is_absolute_https(url)) { err = "Update URL must use HTTPS"; return false; }

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
        err = "Out of memory";
        retryable_allocator_failure = true;
        return false;
    }

    bool ok = false;
    esp_err_t e = esp_http_client_open(c, 0);
    if (e != ESP_OK) {
        const HttpClientOpenFailure failure =
            http_client_log_open_failure("ota", c, e, before);
        // Retry only the allocator-shaped failures seen on the live board. DNS, TCP, certificate
        // and HTTP errors are real reachability failures; retrying those here would merely delay the
        // same answer and blur the diagnostic that distinguishes them.
        retryable_allocator_failure =
            e == ESP_ERR_NO_MEM || failure.tls_error == ESP_ERR_MBEDTLS_SSL_SETUP_FAILED;
        err = "Can't reach the update server";
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
        while (got < sizeof(buf)) {
            const int n = esp_http_client_read(c, buf + got, static_cast<int>(sizeof(buf) - got));
            if (n <= 0) break;
            got += static_cast<size_t>(n);
        }
        // manifest_version() is bounded by `got` and never assumes NUL termination.
        if (got == 0)                                   err = "Empty manifest";
        else if (!manifest_version(buf, got, out, outlen)) err = "Manifest has no usable version";
        else                                            ok = true;
    }
    close_http_client(c);
    return ok;
}

bool fetch_manifest_version(const std::string& url, char* out, size_t outlen, const char*& err) {
    for (unsigned attempt = 0; attempt < 2; ++attempt) {
        bool retryable = false;
        if (fetch_manifest_version_once(url, out, outlen, err, retryable)) return true;
        if (!retryable || attempt != 0) return false;
        diag_printf("ota: manifest TLS allocation failed, retrying once after quiesce\n");
        vTaskDelay(kAllocatorRetryDelay);
    }
    return false;
}

void run_check() {
    set_state("checking");
    const std::string running = esp_app_get_description()->version;
    const OtaChannel  ch      = channel_now();
    const std::string url     = ota_channel_manifest_url(CONFIG_DAIKIN_OTA_MANIFEST_URL,
                                                         CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, ch);

    char        avail[32] = {0};
    const char* err       = "Update check failed";
    if (!fetch_manifest_version(url, avail, sizeof(avail), err)) {
        diag_printf("ota: check failed (%s channel): %s\n", ota_channel_name(ch), err);
        Lock lk(s_mtx);
        s_status.state            = "error";
        s_status.message          = err;
        s_status.update_available = false;
        s_status.downgrade        = false;
        s_status.channel          = ota_channel_name(ch);
        return;
    }

    const bool newer = ota_is_upgrade(running, avail);
    // Installable but OLDER — the dev -> release direction. Reported so the UI can offer it as a
    // switch back rather than silently calling the release channel "up to date" on a dev board.
    const bool down = !newer && ota_install_allowed(running, avail, /*allow_downgrade=*/true);
    diag_printf("ota: %s manifest %s, running %s -> %s\n", ota_channel_name(ch), avail, running.c_str(),
                newer ? "update available" : down ? "older build offered" : "up to date");
    Lock lk(s_mtx);
    s_status.state            = "idle";
    s_status.message          = "";
    s_status.available        = avail;
    s_status.update_available = newer;
    s_status.downgrade        = down;
    s_status.channel          = ota_channel_name(ch);
}

void run_update(bool allow_downgrade) {
    const std::string running = esp_app_get_description()->version;
    const OtaChannel  ch      = channel_now();
    set_state("checking", "Verifying the update");

    // Re-fetch the manifest instead of trusting whatever /ota/check left in s_status. Two reasons,
    // and the second is the one that matters: (a) the manifest can change between check and update,
    // and (b) POST /ota/update is reachable on its own — without this, a client that skipped
    // /ota/check would drive the download with a STALE or EMPTY `available`, i.e. with no gate at
    // all. The gate has to sit on the path that downloads, not on the path that merely informs.
    char        avail[32] = {0};
    const char* err       = "Update check failed";
    if (!fetch_manifest_version(ota_channel_manifest_url(CONFIG_DAIKIN_OTA_MANIFEST_URL,
                                                         CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, ch),
                                avail, sizeof(avail), err)) {
        diag_printf("ota: update aborted, %s manifest fetch failed: %s\n", ota_channel_name(ch), err);
        set_state("error", err);
        return;
    }

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
    if (!wait_for_ota_verify_headroom("transfer", transfer_heap)) {
        set_state("error", "Not enough memory to verify the update — retry after reboot");
        return;
    }

    OtaRedirectLocationState redirect_policy;
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
    http.user_data         = &redirect_policy;
    // Small receive buffer on purpose. The image is ~1.5 MB but is written to flash chunk by chunk,
    // so nothing here needs to scale with it — and this allocation competes with the MQTTS session
    // for the largest CONTIGUOUS free block, which is the real ceiling on this device.
    http.buffer_size       = kOtaBufSize;

    const HttpClientProbe before = http_client_probe();
    esp_http_client_handle_t client = esp_http_client_init(&http);
    if (!client) {
        http_client_log_init_failure("ota", before);
        set_state("error", "Couldn't start the download");
        return;
    }

    int status = 0;
    esp_err_t e = open_firmware_stream(client, redirect_policy, status);
    if (e != ESP_OK) {
        const HttpClientOpenFailure failure =
            http_client_log_open_failure("ota", client, e, before);
        close_http_client(client);
        diag_printf("ota: firmware stream failed (status=%d, err=%s, tls=0x%lx)\n", status,
                    esp_err_to_name(e), static_cast<unsigned long>(failure.tls_error));
        set_state("error", status == 0 ? "Can't reach the update server"
                                        : "Update server returned an error");
        return;
    }

    const int64_t total = esp_http_client_get_content_length(client);
    uint8_t* buffer = static_cast<uint8_t*>(
        heap_caps_malloc(kOtaBufSize, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
    if (!buffer) {
        close_http_client(client);
        const OtaHeapSample failed = ota_heap_sample();
        diag_printf("ota: download-buffer allocation failed (free=%u B largest=%u B)\n",
                    static_cast<unsigned>(failed.free_bytes),
                    static_cast<unsigned>(failed.largest_internal_block));
        set_state("error", "Not enough memory to verify the update — retry after reboot");
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
                           ? "Not enough memory to verify the update — retry after reboot"
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
    while (probe_len < kImageProbeSize) {
        const int n = esp_http_client_read(client, reinterpret_cast<char*>(buffer + probe_len),
                                           static_cast<int>(kImageProbeSize - probe_len));
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
        set_state("error", "Update image is unreadable");
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
    read_timeouts = 0;
    while (transfer_ok) {
        const int n = esp_http_client_read(client, reinterpret_cast<char*>(buffer), kOtaBufSize);
        if (n == -ESP_ERR_HTTP_EAGAIN && read_timeouts++ < 2) continue;
        if (n < 0) {
            e = static_cast<esp_err_t>(-n);
            transfer_failure = OtaTransferFailure::Read;
            transfer_ok = false;
            break;
        }
        if (n == 0) break;
        read_timeouts = 0;
        transfer_ok = write_chunk(buffer, static_cast<size_t>(n));
    }

    const bool complete = esp_http_client_is_complete_data_received(client) &&
                          (total <= 0 || written == static_cast<uint64_t>(total));

    // CRITICAL ORDERING: free the fixed download buffer and the HTTP/TLS client BEFORE
    // esp_ota_end().  IDF v6.0.2's esp_https_ota_finish() does the reverse — esp_ota_end first,
    // cleanup second — so RSA/PSA verification had to allocate beside TLS and failed on the live
    // board with a 632-byte low-water mark.  The raw esp_ota API preserves the exact same signed
    // image verifier while letting the transport release its heap first.
    heap_caps_free(buffer);
    buffer = nullptr;
    close_http_client(client);

    if (!transfer_ok || !complete) {
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
                            : transfer_failure == OtaTransferFailure::Write
                            ? "Couldn't write the update"
                            : !complete ? "Incomplete download"
                                        : "Download failed — check the connection";
        set_state("error", message);
        return;
    }

    OtaHeapSample verify_heap{};
    if (!wait_for_ota_verify_headroom("validation", verify_heap)) {
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

    // Selection is deliberately separate and strictly AFTER successful validation.  IDF validates
    // once more while setting otadata; any failure still leaves the running slot selected.
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
    vTaskDelay(pdMS_TO_TICKS(600));   // let the UI poll /ota/status once more before the link drops
    esp_restart();
}

// The three modes, carried through xTaskCreate's void* parameter: nullptr = check, otherwise a
// pointer to one of these static bytes whose VALUE says which install. Static storage, so there is
// no lifetime question and no allocation; distinct VALUES rather than distinct addresses, because
// two identical const objects are exactly what a linker doing identical-code/data folding may merge
// — and a merged pair would silently turn every update into a downgrade-permitted one.
//
// A static bool alongside the busy flag would also work, but it would be state that outlives the
// task and could be read by the NEXT run: "install an older build" must not be inheritable.
const char kUpdateMode          = 1;
const char kUpdateDowngradeMode = 2;

// One task body for both operations, so there is exactly one stack and one place the busy flag is
// cleared. The body self-guards: a task is a C frame boundary like an HTTP handler is, so an
// escaping std::bad_alloc means std::terminate -> reboot — and rebooting the heat-pump bridge
// because an update CHECK ran out of memory would be absurd (AGENTS.md → Memory, concurrency, and
// HTTP safety).
void ota_task(void* arg) {
    const char mode      = arg ? *static_cast<const char*>(arg) : 0;
    const bool update    = mode != 0;
    const bool downgrade = mode == kUpdateDowngradeMode;
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
            } else if (!wait_for_weather_quiesce()) {
                set_state("error", "Another network operation is still using memory — retry shortly");
            } else if (update) {
                run_update(downgrade);
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

// Spawn the single OTA task, refusing if one is already running. Returns false if busy.
bool start(bool update, bool allow_downgrade = false) {
    {
        Lock lk(s_mtx);
        if (s_busy) return false;
        s_busy = true;
    }
    const char* sentinel = allow_downgrade ? &kUpdateDowngradeMode : &kUpdateMode;
    void* mode = update ? const_cast<void*>(static_cast<const void*>(sentinel)) : nullptr;
    if (xTaskCreate(ota_task, "ota", kTaskStack, mode, kTaskPrio, nullptr) != pdPASS) {
        // Task creation failed (no heap). Clear the flag — otherwise the guard above latches ON for
        // the rest of the boot and OTA is dead until a reboot, with no way for the user to tell.
        Lock lk(s_mtx);
        s_busy         = false;
        s_status.state = "error";
        s_status.message = "Out of memory — retry in a moment";
        return false;
    }
    return true;
}

}  // namespace

const char* ota_img_suffix() {
    return "";   // esp32s3 is the only target, no suffix needed
}

bool ota_download_active() { return s_network_active.load(std::memory_order_acquire); }

void ota_check_async(int64_t /*browser_epoch_ms*/) {
    // browser_epoch_ms stays plumbed (the route parses ?ms=) but gates nothing: TLS certificate
    // DATE validation is compiled out (MBEDTLS_HAVE_TIME_DATE is not set), so the fetch needs no
    // wall clock. SNTP exists now for syslog timestamps, but making OTA wait on it would strand a
    // board whose NTP server is unreachable — see docs/SECURITY.md.
    if (!start(/*update=*/false)) ESP_LOGW("ota", "check ignored: an OTA operation is already running");
}

void ota_update_async(bool allow_downgrade) {
    if (!start(/*update=*/true, allow_downgrade))
        ESP_LOGW("ota", "update ignored: an OTA operation is already running");
}

bool ota_busy() {
    // Deliberately NOT ota_status().state != "idle": that builder copies four std::strings out and
    // also takes the CONFIG mutex, and its one caller here is the heap watchdog running on a heap
    // that is failing. This critical section allocates nothing at all.
    Lock lk(s_mtx);
    return s_busy;
}

OtaStatus ota_status() {
    // The channel is answered from the LIVE config, not from whatever the last check left behind:
    // /ota/status is what the UI reads back after POST /set_ota, and before any check has run there
    // is nothing in s_status to read. Read BEFORE taking s_mtx — config() takes the config mutex
    // and copies strings out of it, and nesting one status lock inside another buys a lock-order
    // rule to remember for a value that is one enum wide.
    const char* ch = ota_channel_name(config().ota_channel);
    Lock lk(s_mtx);
    s_status.current = esp_app_get_description()->version;
    s_status.channel = ch;
    return s_status;
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
