// One-shot crash/reset capture (see diag_crash.hpp). Reads the reset reason + core-dump summary
// ONCE at boot and caches it; the pure formatting lives in logic/crashinfo.hpp (host-tested).
#include "diag_crash.hpp"

#include "diag_log.hpp"

#include "esp_app_desc.h"   // esp_app_get_elf_sha256 — the RUNNING build's ELF hash
#include "esp_core_dump.h"
#include "esp_err.h"
#include "esp_system.h"

#include <cstdlib>
#include <atomic>
#include <cstring>
#include <new>

namespace daik {

// The pure logic/crashinfo.hpp CrashReason enum mirrors esp_reset_reason_t by value so the header
// stays IDF-free; if the IDF enum is ever renumbered these asserts fail the build (a silent
// mismatch would mislabel every crash). Spot-check the values the fault classifier depends on.
static_assert(static_cast<uint32_t>(CrashReason::POWERON)    == ESP_RST_POWERON,    "reset enum drift");
static_assert(static_cast<uint32_t>(CrashReason::SW)         == ESP_RST_SW,         "reset enum drift");
static_assert(static_cast<uint32_t>(CrashReason::PANIC)      == ESP_RST_PANIC,      "reset enum drift");
static_assert(static_cast<uint32_t>(CrashReason::INT_WDT)    == ESP_RST_INT_WDT,    "reset enum drift");
static_assert(static_cast<uint32_t>(CrashReason::TASK_WDT)   == ESP_RST_TASK_WDT,   "reset enum drift");
static_assert(static_cast<uint32_t>(CrashReason::BROWNOUT)   == ESP_RST_BROWNOUT,   "reset enum drift");

// Filled once by diag_crash_capture() and read-only thereafter. Dismissal is the only cross-task
// field and therefore lives in its own atomic rather than racing a request against /status/MQTT.
static CrashInfo s_ci;
static std::atomic<bool> s_dismissed{false};
// Set only on boot-time proof that the on-flash image belongs to another firmware. Preserve its
// private bytes; this latch suppresses attribution/download for this boot even though the raw flash
// presence check still finds an image. Only an explicit clear/dismiss/factory-reset may erase it.
static bool s_foreign_coredump = false;

// A dump is "downloadable" on EXACTLY the terms GET /coredump uses: the raw image must exist AND must
// not be the proven-foreign image rejected during boot capture. h_coredump calls this same predicate
// before streaming, so /status cannot advertise a dump the endpoint refuses or vice versa. (An
// ESP_OK image_get return already guarantees a sane size: esp_core_dump_partition_and_size_get
// rejects a blank partition — size word 0xffffffff — with ESP_ERR_NOT_FOUND, and anything < 4 bytes
// with ESP_ERR_INVALID_SIZE.) Cost is one 4-byte flash read — much cheaper than parsing the summary.
bool diag_crash_coredump_present() {
    size_t addr = 0, size = 0;
    const bool image_present = esp_core_dump_image_get(&addr, &size) == ESP_OK;
    return coredump_is_reportable(image_present, s_foreign_coredump);
}

CrashInfo diag_crash_info_live() {
    CrashInfo c = diag_crash_info();               // boot-time reason + atomic dismissal state
    c.coredump  = diag_crash_coredump_present();   // ...but the image itself may be gone by now
    return c;
}

void diag_crash_capture() {
    s_foreign_coredump = false;
    s_dismissed.store(false);
    s_ci.reason   = static_cast<uint32_t>(esp_reset_reason());
    s_ci.coredump = diag_crash_coredump_present();

#if CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH
    // Parse the summary only from a VALID image (checksum ok). This boot-only allocation is
    // fallible: a missing summary leaves the reset reason and private flash evidence intact.
    if (s_ci.coredump && esp_core_dump_image_check() == ESP_OK) {
        auto* sum = static_cast<esp_core_dump_summary_t*>(calloc(1, sizeof(esp_core_dump_summary_t)));
        if (sum && esp_core_dump_get_summary(sum) == ESP_OK) {
            s_ci.have_summary = true;
            std::snprintf(s_ci.task, sizeof(s_ci.task), "%.*s",
                          static_cast<int>(sizeof(sum->exc_task)), sum->exc_task);
            s_ci.pc           = sum->exc_pc;
            int depth = static_cast<int>(sum->exc_bt_info.depth);
            if (depth < 0) depth = 0;
            if (depth > static_cast<int>(sizeof(s_ci.bt) / sizeof(s_ci.bt[0])))
                depth = static_cast<int>(sizeof(s_ci.bt) / sizeof(s_ci.bt[0]));
            s_ci.bt_depth = depth;
            for (int i = 0; i < depth; i++) s_ci.bt[i] = sum->exc_bt_info.bt[i];
            s_ci.bt_corrupted = sum->exc_bt_info.corrupted;
            std::snprintf(s_ci.elf_sha, sizeof(s_ci.elf_sha), "%.*s",
                          static_cast<int>(sizeof(sum->app_elf_sha256)),
                          reinterpret_cast<const char*>(sum->app_elf_sha256));
        }
        free(sum);
    }

    // The reset reason describes this boot; these summary fields describe the stored image. A
    // matching ELF cannot prove that the image was written by the latest fault: a failed same-ELF
    // write can leave an earlier incident behind. Reject proven foreign attribution without
    // destroying its private evidence. The same latch drives /status and GET /coredump.
    if (s_ci.have_summary) {
        char run_sha[65] = {0};
        esp_app_get_elf_sha256(run_sha, sizeof(run_sha));
        if (coredump_is_foreign(s_ci.elf_sha, run_sha)) {
            s_foreign_coredump = true;
            diag_printf(
                "crash: foreign core dump from build %s (running %s) — preserved, suppressed\n",
                s_ci.elf_sha, run_sha);
            s_ci.coredump     = false;
            s_ci.have_summary = false;
            s_ci.elf_sha[0]   = '\0';
        }
    }
#endif

    if (crash_is_notable(s_ci)) {
        // Formatting is best-effort. OOM must not abort boot or discard the captured facts.
        try {
            diag_printf("crash: %s\n", build_crash_text(s_ci).c_str());
        } catch (const std::bad_alloc&) {
            diag_printf("crash: diagnostic text unavailable (OOM); cached reset and stored "
                        "evidence retained\n");
        }
    }
}

CrashInfo diag_crash_info() {
    CrashInfo c = s_ci;
    c.dismissed = s_dismissed.load();
    return c;
}

// Acknowledge + delete this boot's crash report (see diag_crash.hpp). Erase FIRST, mark second: on a
// failed erase of CURRENT-FIRMWARE evidence nothing is marked, so the banner comes back rather than
// the device claiming a downloadable crash is gone. Proven-foreign residue is the deliberate
// exception: it is already hidden from /status and GET /coredump, so an erase failure cannot pin an
// otherwise-dismissible current fault banner.
//
// The erase is unconditional, not gated on diag_crash_coredump_present(): esp_core_dump_image_erase()
// succeeds on an already-blank partition (it erases and writes the blank size word), and gating it on
// the presence check would leave behind exactly the images that check REJECTS — a truncated or
// checksum-broken dump, which is stale crash residue like any other. ESP_ERR_NOT_FOUND here means the
// PARTITION is missing, not the image.
//
// `dismissed` is written from the httpd task while the poll task's WS broadcaster and the MQTT task
// read s_ci concurrently. That is a single byte store which only ever goes false -> true, so a
// concurrent reader sees one state or the other and both are self-consistent renderings of the same
// CrashInfo — no lock, and none of the paths involved may take one anyway (see AGENTS.md → Memory,
// concurrency, and HTTP safety).
// The IDF-free mirror in logic/crashinfo.hpp must be the real value, or the rule above would key on
// a code the device never returns and quietly go back to blocking every dismissal on a board with no
// coredump partition.
static_assert(ESP_ERR_NOT_FOUND_MIRROR == ESP_ERR_NOT_FOUND,
              "logic/crashinfo.hpp's ESP_ERR_NOT_FOUND mirror has drifted from esp_err.h");

bool diag_crash_dismiss() {
    esp_err_t err = esp_core_dump_image_erase();
    if (coredump_erase_failure_blocks_dismiss(static_cast<int>(err), s_foreign_coredump)) {
        diag_printf("crash: dismiss failed — coredump erase: %s\n", esp_err_to_name(err));
        return false;
    }
    // Three ways to get here, and they are three different facts about the device rather than one
    // outcome, so each says which it was: the dump was destroyed; there was no partition holding one
    // (an OTA-upgraded board flashed before `coredump` existed, per partitions.csv); or the residue
    // is a proven-foreign image already suppressed everywhere it could be reported.
    const char* how = err == ESP_OK           ? "dump erased"
                    : err == ESP_ERR_NOT_FOUND ? "no coredump partition on this board — nothing to erase"
                                               : "foreign dump residue suppressed";
    if (err != ESP_OK)
        diag_printf("crash: coredump erase returned %s — %s\n", esp_err_to_name(err), how);
    s_dismissed.store(true);
    diag_printf("crash: report dismissed (reset=%s, %s)\n", crash_reason_slug(s_ci.reason), how);
    return true;
}

bool diag_crash_forget() {
    const esp_err_t err = esp_core_dump_image_erase();
    if (err != ESP_OK && err != ESP_ERR_NOT_FOUND) {
        diag_printf("crash: factory-reset coredump erase failed: %s\n", esp_err_to_name(err));
        return false;
    }
    s_dismissed.store(true);
    return true;
}

} // namespace daik
