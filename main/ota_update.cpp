// Pull-based signed OTA. See ota_update.hpp and docs/ARCHITECTURE.md → OTA.
//
// Both halves are now implemented: the DELIVERY half here (manifest check -> downgrade gate ->
// esp_https_ota into the inactive slot) and the ROLLBACK half further down (the health gate that
// keeps a fresh image PENDING_VERIFY until it proves healthy). They are independent safety nets and
// neither replaces the other: the gate below refuses to *start* a bad update, the health gate
// recovers from one that started and booted broken.
//
// Three properties this file is responsible for, each of which has bitten real fleets:
//   • The downgrade gate runs BEFORE any download, and against a FRESHLY fetched manifest (not the
//     one /ota/check happened to see). A signature proves authenticity, not freshness.
//   • Nothing runs on the httpd worker. /set_mqtt's ~8 s pre-flight is deliberately the ONE
//     request-path network block in this firmware (.claude/CLAUDE.md); a multi-MB TLS download
//     would park the single httpd task for minutes and take the whole web UI down with it.
//   • One OTA operation at a time, ever. Two concurrent esp_https_ota sessions would each open a
//     TLS context on a heap whose binding limit is the largest CONTIGUOUS free block.
#include "ota_update.hpp"
#include "logic/health_gate.hpp"
#include "logic/ota_channel.hpp"
#include "logic/ota_manifest.hpp"
#include "logic/version_cmp.hpp"
#include "config.hpp"
#include "diag_log.hpp"
#include "wifi.hpp"
#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard
#include "freertos/task.h"
#include <atomic>
#include <cstring>
#include <exception>
#include <string>

namespace daik {

namespace {

// s_status is written by the OTA task and read by the httpd task (GET /ota/status), so it needs a
// mutex. Readers copy std::strings out under the lock, which CAN throw — so the lock is taken
// through an RAII guard, never a bare xSemaphoreTake. A raw take that unwinds past the give leaves
// every later reader blocked on portMAX_DELAY and wedges the device into a watchdog reboot, which
// is strictly worse than the OOM it came from (.claude/CLAUDE.md → "Never allocate while holding a
// mutex").
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

// "A download is in flight" — the ONE piece of OTA state read from outside on a per-second cadence
// (ota_download_active(), see the header for why this is not s_status.state). Deliberately NOT under
// s_mtx: the reader is the MQTT publish task standing aside for exactly the heap event this marks,
// and making it take the lock the OTA task holds — or copy strings to read it — would spend the
// resource it is trying to save. A stale read costs one published cycle either way, so relaxed
// ordering is enough and no reader can ever block on the writer.
std::atomic<bool> s_downloading{false};

// Scope guard for the flag. The download window has SEVEN exits — begin failure, an unreadable
// descriptor, two refused-version gates, a failed transfer, a truncated one, and success into
// esp_restart() — and a flag cleared by hand at each is a flag that a later exit path forgets. A
// missed clear latches the publisher off for OTA_QUIESCE_MAX_CYCLES on every cycle for the rest of
// the boot (logic/ota_quiesce.hpp caps the damage; it should never have to).
struct DownloadFlag {
    DownloadFlag()  { s_downloading.store(true,  std::memory_order_relaxed); }
    ~DownloadFlag() { s_downloading.store(false, std::memory_order_relaxed); }
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

void set_state(const char* state, const char* message = "") {
    Lock lk(s_mtx);
    s_status.state   = state;
    s_status.message = message;
}

void set_progress(int pct) {
    Lock lk(s_mtx);
    s_status.progress = pct;
}

// The feed this device follows right now (config ota_channel, POST /set_ota). Read fresh on every
// check/update rather than cached at boot: switching channels applies LIVE, so a user who picks
// "Development" in the UI and immediately taps check must get the dev manifest, not the one that
// was configured when the board booted.
OtaChannel channel_now() { return config().ota_channel; }

// Fetch the manifest for `url` and extract its "version" into `out`.
// `err` receives a short, USER-FACING reason on failure — the UI shows it verbatim, so it must say
// what to do about it, not just what failed.
bool fetch_manifest_version(const std::string& url, char* out, size_t outlen, const char*& err) {
    // An empty URL means this build has no feed configured for the selected channel (an empty
    // firmware base URL — see logic/ota_channel.hpp). Say that, rather than letting the client
    // fail on a relative path and reporting an unreachable server.
    if (url.empty()) { err = "No update URL configured"; return false; }

    esp_http_client_config_t cfg = {};
    cfg.url               = url.c_str();
    cfg.timeout_ms        = kHttpTimeoutMs;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;   // public CA bundle, same as MQTTS
    cfg.keep_alive_enable = false;

    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) { err = "Out of memory"; return false; }

    bool ok = false;
    esp_err_t e = esp_http_client_open(c, 0);
    if (e != ESP_OK) {
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
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    return ok;
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
    diag_printf("ota: downloading %s (%s -> %s, %s channel)\n", url.c_str(), running.c_str(), avail,
                ota_channel_name(ch));

    esp_http_client_config_t http = {};
    http.url               = url.c_str();
    http.timeout_ms        = kHttpTimeoutMs;
    http.crt_bundle_attach = esp_crt_bundle_attach;
    http.keep_alive_enable = false;
    // Small receive buffer on purpose. The image is ~1.5 MB but is written to flash chunk by chunk,
    // so nothing here needs to scale with it — and this allocation competes with the MQTTS session
    // for the largest CONTIGUOUS free block, which is the real ceiling on this device.
    http.buffer_size       = kOtaBufSize;

    esp_https_ota_config_t ota = {};
    ota.http_config            = &http;

    // From here to the end of the function the TLS session and the download buffer are on the heap.
    // Armed BEFORE begin(), because begin() is where the handshake allocates — a publisher woken by
    // the tick in between would meet the pressure with no warning. Cleared on every exit below by
    // the destructor, and left set on the success path (esp_restart() ends the boot anyway).
    DownloadFlag downloading;

    esp_https_ota_handle_t h = nullptr;
    esp_err_t e = esp_https_ota_begin(&ota, &h);
    if (e != ESP_OK || !h) {
        diag_printf("ota: begin failed (%s)\n", esp_err_to_name(e));
        set_state("error", "Couldn't start the download");
        return;
    }

    // THE GATE THAT ACTUALLY BINDS — check the IMAGE's own embedded version, not the manifest's
    // claim about it. The manifest and the image are two separate attacker-controlled artifacts: a
    // hostile host can advertise "9.9.9" and serve a genuine, correctly-signed OLD binary, and the
    // signature check would happily pass it — an authentic downgrade onto a fixed vulnerability.
    // esp_https_ota_get_img_desc reads esp_app_desc_t out of the first chunk, so this still runs
    // BEFORE the bulk of the image is fetched and before anything is committed.
    // (CI already refuses to publish a manifest whose version disagrees with the built image, so in
    // the field a mismatch is a stale cache or an attack — either way, not something to install.)
    esp_app_desc_t img = {};
    e = esp_https_ota_get_img_desc(h, &img);
    if (e != ESP_OK) {
        diag_printf("ota: can't read image descriptor (%s)\n", esp_err_to_name(e));
        esp_https_ota_abort(h);
        set_state("error", "Update image is unreadable");
        return;
    }
    char imgver[sizeof(img.version) + 1] = {0};
    std::memcpy(imgver, img.version, sizeof(img.version));   // version[] need not be NUL-terminated
    // ...and that the image the host actually served is the one the manifest DESCRIBED. Passing the
    // ordering gate twice is not the same as passing it on one artifact: running 1.0.0, a manifest
    // claiming 9.9.9 and a signed image carrying 1.0.1 are each "newer", yet nothing checked that
    // the version this device decided to install is the version it is installing. CI publishes the
    // two strings from one stamped value (ci-build-all.sh reads the built image back), so in the
    // field a mismatch is a stale cache, a broken host or an attack.
    if (!ota_artifact_versions_match(avail, imgver)) {
        diag_printf("ota: REFUSING image v%s: manifest claimed %s (artifact mismatch)\n", imgver,
                    avail);
        esp_https_ota_abort(h);
        Lock lk(s_mtx);
        s_status.state            = "error";
        s_status.message          = "Update rejected: manifest and image versions differ";
        s_status.update_available = false;
        return;
    }
    if (!ota_install_allowed(running, imgver, allow_downgrade)) {
        diag_printf("ota: REFUSING image v%s while running v%s (manifest claimed %s)\n", imgver,
                    running.c_str(), avail);
        esp_https_ota_abort(h);
        Lock lk(s_mtx);
        s_status.state            = "error";
        s_status.message          = "Update rejected: not newer than the running firmware";
        s_status.update_available = false;
        return;
    }

    const int total = esp_https_ota_get_image_size(h);
    int       last  = -1;
    while ((e = esp_https_ota_perform(h)) == ESP_ERR_HTTPS_OTA_IN_PROGRESS) {
        if (total > 0) {
            const int pct = static_cast<int>(
                (static_cast<int64_t>(esp_https_ota_get_image_len_read(h)) * 100) / total);
            if (pct != last) { set_progress(pct); last = pct; }
        }
    }

    if (e != ESP_OK) {
        // A truncated transfer is NOT an install: esp_https_ota_abort releases the slot so a failed
        // download can't leave a half-written image behind for the bootloader to find.
        diag_printf("ota: download failed (%s)\n", esp_err_to_name(e));
        esp_https_ota_abort(h);
        set_state("error", "Download failed — check the connection");
        return;
    }
    if (!esp_https_ota_is_complete_data_received(h)) {
        diag_printf("ota: incomplete image, aborting\n");
        esp_https_ota_abort(h);
        set_state("error", "Incomplete download");
        return;
    }

    // esp_https_ota_finish is where the RSA-3072 Secure Boot v2 signature is verified
    // (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y) and the boot partition is switched. An
    // unsigned or tampered image is REFUSED here, before it can ever be selected for boot — this is
    // the check that makes an untrusted manifest host survivable, so it must never be disabled.
    e = esp_https_ota_finish(h);
    if (e != ESP_OK) {
        if (e == ESP_ERR_OTA_VALIDATE_FAILED) {
            diag_printf("ota: SIGNATURE VERIFICATION FAILED — image rejected, running image intact\n");
            set_state("error", "Update rejected: bad signature");
        } else {
            diag_printf("ota: finish failed (%s)\n", esp_err_to_name(e));
            set_state("error", "Couldn't install the update");
        }
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
// because an update CHECK ran out of memory would be absurd (.claude/CLAUDE.md → every allocating
// FreeRTOS task loop must self-guard).
void ota_task(void* arg) {
    const char mode      = arg ? *static_cast<const char*>(arg) : 0;
    const bool update    = mode != 0;
    const bool downgrade = mode == kUpdateDowngradeMode;
    try {
        if (update) run_update(downgrade);
        else        run_check();
    } catch (const std::exception& ex) {
        diag_printf("ota: aborted (%s)\n", ex.what());
        set_state("error", "Out of memory — retry in a moment");
    } catch (...) {
        diag_printf("ota: aborted (unknown exception)\n");
        set_state("error", "Update failed");
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

bool ota_download_active() { return s_downloading.load(std::memory_order_relaxed); }

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

// Keep rollback armed until this OTA image has proven HEALTHY, not merely survived a timer: it must
// have run for a base window (survives an early crash-loop -> bootloader reverts) AND reached
// connectivity (STA online, or the setup portal if it has no credentials). A boots-but-broken update
// — e.g. a WiFi regression that can never get online to be re-flashed — is left PENDING_VERIFY, so
// the next reboot rolls back to the previous slot instead of sealing the break in. The decision is
// the host-tested daik::health_gate_decide(); see logic/health_gate.hpp + docs/SECURITY.md.
//
// Only PENDING_VERIFY images are rollback-armed, and those exist ONLY via esp_ota_set_boot_partition
// (a real OTA), which always leaves a valid previous slot. A USB/@flash_args image boots in
// UNDEFINED state (blank otadata) and short-circuits below — so this can never strand a fresh board.
static constexpr int kHealthBaseWindowS = 90;    // min uptime before committing a healthy image
static constexpr int kHealthHardCapS    = 600;   // keep trying to commit this long; a genuinely
                                                 // good image at a briefly-offline site still gets
                                                 // sealed in. Only a still-offline image past this
                                                 // stays rollback-armed (reverts on next reboot).
static constexpr int kHealthPollS       = 5;     // re-evaluate cadence

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
        // THE BODY SELF-GUARDS, like every other allocating task loop here (.claude/CLAUDE.md), and
        // it is worth saying why it counts as one: wifi_info() is POD and health_gate_decide() is
        // pure, but wifi_configured() reads config() BY VALUE — ~10 std::string copies for a bool.
        // The window this task runs in is the worst possible place to leave that unguarded: 90-600 s
        // into an OTA boot, i.e. exactly when the MQTT discovery burst and a TLS session put the
        // heap at its peak. An escape is std::terminate -> reboot, and a reboot while PENDING_VERIFY
        // ROLLS BACK the image — so the failure mode is not "this board reboots" but "a healthy
        // update is reverted on every board that took it", arriving through the update path itself.
        // Skipping a cycle is safe and is the conservative direction: no verdict is reached, elapsed
        // still advances, and the hard cap still ends the window by leaving the image PENDING_VERIFY.
        try {
            const bool connected = wifi_info().connected;
            const HealthVerdict v = health_gate_decide(elapsed, kHealthBaseWindowS, kHealthHardCapS,
                                                       wifi_configured(), connected);
            if (v == HealthVerdict::Commit) {
                // The return value decides whether this image survives the next reboot, so it is not
                // one to discard: a failed commit leaves the image PENDING_VERIFY and the bootloader
                // reverts it, and logging the success line over that call would report the opposite
                // of what happened — on the one path where the evidence has to be right.
                const esp_err_t e = esp_ota_mark_app_valid_cancel_rollback();
                if (e == ESP_OK)
                    ESP_LOGI("ota", "image marked valid (health gate passed after %ds, wifi=%d)",
                             elapsed, connected);
                else
                    diag_printf("ota: health gate passed but marking the image valid failed (%s) — "
                                "the next reboot rolls back to the previous firmware\n",
                                esp_err_to_name(e));
                break;
            }
            if (v == HealthVerdict::GiveUp) {
                ESP_LOGW("ota", "health gate: no connectivity after %ds; leaving image PENDING_VERIFY "
                                "-> next reboot rolls back to the previous firmware", elapsed);
                break;
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
// and CLAUDE.md's memory section measures that path at ~700 B below the throwing frame. Adding it
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
