#pragma once
// One-shot crash/reset capture. diag_crash_capture() runs ONCE at boot: it reads the reset reason
// (esp_reset_reason) and, if a core-dump image is in flash, parses its SUMMARY
// (esp_core_dump_get_summary — crashed task, PC, backtrace, app ELF sha) into a cached CrashInfo.
// Everything downstream (GET /status.last_crash, the MQTT crash topic) reads the CACHE — the summary
// is never re-parsed from flash on a request path (build_status_json_string also runs in the poll
// task's WS broadcaster, which only self-guards std::bad_alloc by dropping the frame). See
// logic/crashinfo.hpp for the pure formatting + docs/ARCHITECTURE.md.
#include "logic/crashinfo.hpp"

namespace daik {

void             diag_crash_capture();   // call once, early in app_main (after diag_log_init)
const CrashInfo& diag_crash_info();       // cached snapshot; read-only, safe from any task

} // namespace daik
