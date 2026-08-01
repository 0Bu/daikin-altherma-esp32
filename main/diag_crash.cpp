// One-shot crash/reset capture (see diag_crash.hpp). Reads the reset reason + core-dump summary
// ONCE at boot and caches it; the pure formatting lives in logic/crashinfo.hpp (host-tested).
#include "diag_crash.hpp"

#include "diag_log.hpp"

#include "esp_app_desc.h"   // esp_app_get_elf_sha256 — the RUNNING build's ELF hash
#include "esp_core_dump.h"
#include "esp_err.h"
#include "esp_system.h"

#include <cstdlib>
#include <cstring>

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

// Filled once by diag_crash_capture(). Read-only thereafter EXCEPT for the `dismissed` byte, which
// diag_crash_dismiss() sets once (see there for why that needs no lock).
static CrashInfo s_ci;
// Set only on boot-time proof that the on-flash image belongs to another firmware. The erase is
// best-effort; this latch keeps a failed erase from making the rejected image reportable again when
// diag_crash_info_live() performs its later raw flash presence check.
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
    CrashInfo c = s_ci;                            // boot-time reason + parsed summary
    c.coredump  = diag_crash_coredump_present();   // ...but the image itself may be gone by now
    return c;
}

void diag_crash_capture() {
    s_foreign_coredump = false;
    s_ci.reason   = static_cast<uint32_t>(esp_reset_reason());
    s_ci.coredump = diag_crash_coredump_present();

#if defined(CONFIG_ESP_COREDUMP_DATA_FORMAT_ELF)
    // Parse the summary only from a VALID image (checksum ok). Allocate on the heap — the summary
    // struct is ~2 KB and this runs at boot when heap is plentiful (before WiFi/MQTT come up).
    if (s_ci.coredump && esp_core_dump_image_check() == ESP_OK) {
        auto* sum = static_cast<esp_core_dump_summary_t*>(calloc(1, sizeof(esp_core_dump_summary_t)));
        if (sum && esp_core_dump_get_summary(sum) == ESP_OK) {
            s_ci.have_summary = true;
            std::snprintf(s_ci.task, sizeof(s_ci.task), "%s", sum->exc_task);
            s_ci.pc           = sum->exc_pc;
            int depth = static_cast<int>(sum->exc_bt_info.depth);
            if (depth < 0) depth = 0;
            if (depth > static_cast<int>(sizeof(s_ci.bt) / sizeof(s_ci.bt[0])))
                depth = static_cast<int>(sizeof(s_ci.bt) / sizeof(s_ci.bt[0]));
            s_ci.bt_depth = depth;
            for (int i = 0; i < depth; i++) s_ci.bt[i] = sum->exc_bt_info.bt[i];
            s_ci.bt_corrupted = sum->exc_bt_info.corrupted;
            std::snprintf(s_ci.elf_sha, sizeof(s_ci.elf_sha), "%s", sum->app_elf_sha256);
        }
        free(sum);
    }

    // A dump can OUTLIVE the firmware that wrote it: the coredump partition survives an OTA, and a
    // panic that fails to write its own dump (a stack overflow can overrun the writer) leaves the
    // PREVIOUS build's dump in place. Such an orphan still passes esp_core_dump_image_check() — it is
    // a valid image, just of another binary — so `coredump` reads true, /status offers a download,
    // and only espcoredump three steps later rejects it on a SHA-256 mismatch (#215). Detect it by
    // comparing the dump's own app-ELF sha (from the summary) against the RUNNING build's, and erase
    // the orphan when they disagree: then `coredump` means "a dump for THIS firmware is downloadable"
    // and the next real panic writes to a clean partition. The summary fields go with it — they
    // describe the foreign binary and would symbolize to garbage against the running .elf. The erase
    // failing is logged but not fatal; coredump/summary are cleared regardless, since reporting a
    // dump we KNOW is foreign is worse than reporting none.
    if (s_ci.have_summary) {
        char run_sha[65] = {0};
        esp_app_get_elf_sha256(run_sha, sizeof(run_sha));
        if (coredump_is_foreign(s_ci.elf_sha, run_sha)) {
            s_foreign_coredump = true;
            diag_printf("crash: stale core dump from build %s (running %s) — erasing\n",
                        s_ci.elf_sha, run_sha);
            esp_err_t err = esp_core_dump_image_erase();
            if (err != ESP_OK)
                diag_printf("crash: stale core dump erase failed: %s\n", esp_err_to_name(err));
            s_ci.coredump     = false;
            s_ci.have_summary = false;
            s_ci.elf_sha[0]   = '\0';
        }
    }
#endif

    if (crash_is_notable(s_ci)) {
        // Log the crash to the diag ring so GET /diag shows it too (build_crash_text is host-tested).
        diag_printf("crash: %s\n", build_crash_text(s_ci).c_str());
    }
}

const CrashInfo& diag_crash_info() { return s_ci; }

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
// CrashInfo — no lock, and none of the paths involved may take one anyway (see CLAUDE.md).
bool diag_crash_dismiss() {
    esp_err_t err = esp_core_dump_image_erase();
    if (err != ESP_OK && coredump_erase_failure_blocks_dismiss(s_foreign_coredump)) {
        diag_printf("crash: dismiss failed — coredump erase: %s\n", esp_err_to_name(err));
        return false;
    }
    if (err != ESP_OK)
        diag_printf("crash: foreign coredump residue erase failed again: %s — report may still be dismissed\n",
                    esp_err_to_name(err));
    s_ci.dismissed = true;
    diag_printf("crash: report dismissed (reset=%s, %s)\n", crash_reason_slug(s_ci.reason),
                err == ESP_OK ? "dump erased" : "foreign dump residue suppressed");
    return true;
}

} // namespace daik
