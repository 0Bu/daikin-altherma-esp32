#pragma once
// One-shot crash/reset capture. diag_crash_capture() runs ONCE at boot: it reads the reset reason
// (esp_reset_reason) and, if a core-dump image is in flash, parses its SUMMARY
// (esp_core_dump_get_summary — crashed task, PC, backtrace, app ELF sha) into a cached CrashInfo. A
// dump whose app ELF sha does not match the RUNNING build is an ORPHAN (it survived an OTA, or a
// panic that could not write its own dump left the previous one behind) — it is erased here and,
// even if that best-effort erase fails, suppressed for this boot so `coredump` never advertises a
// download espcoredump would reject on a version mismatch (#215).
// The reason + summary are boot-time FACTS and stay cached — the summary is never re-parsed from
// flash on a request path (http_append_status_json also runs in the poll task's WS broadcaster,
// which only self-guards std::bad_alloc by dropping the frame).
//
// The `coredump` flag is the ONE field that is NOT a boot-time fact: the image it describes can be
// erased while the device runs (GET /coredump?clear=1), so a cached copy goes stale and claims a
// dump is downloadable that flash no longer holds — a crash banner that can't be cleared and a
// download that 404s. Callers that report it (/status.last_crash, the MQTT crash topic) therefore
// use diag_crash_info_live(), which re-reads the flag. See logic/crashinfo.hpp for the pure
// formatting + docs/ARCHITECTURE.md.
#include "logic/crashinfo.hpp"

namespace daik {

void             diag_crash_capture();   // call once, early in app_main (after diag_log_init)
const CrashInfo& diag_crash_info();      // cached snapshot; read-only, safe from any task

// Is a downloadable dump in flash RIGHT NOW? Cheap (one 4-byte flash read), NOT the summary parse —
// safe to call on a request path. Use this, not diag_crash_info().coredump, to decide "downloadable".
bool             diag_crash_coredump_present();

// diag_crash_info() with `coredump` refreshed from flash. Returns a COPY: refreshing the shared
// cache in place would race the WS broadcaster / HTTP / MQTT tasks that read it concurrently.
CrashInfo        diag_crash_info_live();

// Acknowledge + DELETE this boot's crash report (POST /crash/dismiss). Erases the core-dump image
// from flash and then marks the cached CrashInfo dismissed, so crash_is_notable() is false
// everywhere at once: /status.last_crash goes null, the retained MQTT crash topic is cleared on the
// next heartbeat tick, and the web UI's banner stays gone across reloads and browsers.
//
// Ordering is the contract: the erase happens FIRST and a failure on a current-firmware dump returns
// false WITHOUT marking anything — a dismissal that survived it would report "no crash" while the
// evidence stayed downloadable. The only exception is proven-foreign residue: it is already neither
// reportable nor downloadable, so its failed erase cannot pin a separate current fault banner.
// Erasing an already-empty partition is success (nothing to delete is the state being asked for), so
// a fault reset with no dump dismisses fine.
bool             diag_crash_dismiss();

} // namespace daik
