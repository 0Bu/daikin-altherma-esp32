// One-shot crash/reset capture (see diag_crash.hpp). Reads the reset reason + core-dump summary
// ONCE at boot and caches it; the pure formatting lives in logic/crashinfo.hpp (host-tested).
#include "diag_crash.hpp"

#include "diag_log.hpp"

#include "esp_core_dump.h"
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

static CrashInfo s_ci;   // filled once by diag_crash_capture(); read-only thereafter

void diag_crash_capture() {
    s_ci.reason = static_cast<uint32_t>(esp_reset_reason());

    // A dump is "downloadable" on the same terms GET /coredump uses (esp_core_dump_image_get): the
    // image exists and has a non-zero size, even if its checksum is bad.
    size_t addr = 0, size = 0;
    s_ci.coredump = (esp_core_dump_image_get(&addr, &size) == ESP_OK && size > 0);

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
#endif

    if (crash_is_notable(s_ci)) {
        // Log the crash to the diag ring so GET /diag shows it too (build_crash_text is host-tested).
        diag_printf("crash: %s\n", build_crash_text(s_ci).c_str());
    }
}

const CrashInfo& diag_crash_info() { return s_ci; }

} // namespace daik
