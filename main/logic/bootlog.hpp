#pragma once
// Boot records for the LOG STREAM (syslog → VictoriaLogs) — the one-shot lines syslog.cpp replays
// once a collector is resolved. Pure string building, IDF-free, host-tested (test/test_logic.cpp).
//
// Why this exists rather than reusing build_crash_text():
//   * TIMING — diag_crash_capture() runs at the top of app_main, before WiFi and before the syslog
//     task exists, so its "crash:" line only ever reaches the in-RAM diag ring. The ring is 6 KB
//     and a chatty failure mode (an X10A timeout every ~0.3 s) overwrites it within a minute, so in
//     practice the crash is readable NOWHERE. syslog.cpp replays these records after DNS resolves.
//   * SIZE — build_crash_text() is one multi-line block; at worst case (16-deep backtrace + a
//   64-char
//     ELF hash) it exceeds diag_printf's 256-byte line buffer AND the 256-byte
//     syslog queue slot, so it truncates exactly where the backtrace and elf_sha256 live. These
//     records are single-line and each fits one datagram whole (see the CRASH_LOG_LINE_BUDGET
//     test).
// build_crash_text() is the paste-friendly block for the UI copy bundle. Capture logs to the diag
// ring can still truncate that block; these separate bounded records preserve the full backtrace.
//
// Format is logfmt-ish (key=value, space separated) so a collector can extract fields without a
// custom parser, and each line carries a leading "boot:"/"crash:" module tag matching the rest of
// the diag vocabulary.
#include "crashinfo.hpp"

#include <cstdio>
#include <cstring>
#include <string>

namespace daik {

// Build identity of the RUNNING image + why it booted. Without this in the log stream there is no
// way to tell which firmware produced a given line: /status.app_elf_sha256 answers it only for the
// image running right now, and only while the device is reachable — a log stream that outlives the
// build is otherwise unattributable. elf_sha matches the hash a core dump reports, so a dump and a
// log stream can be tied to the same binary.
struct BootIdent {
    const char* version   = "";   // esp_app_get_description()->version
    const char* elf_sha   = "";   // esp_app_get_elf_sha256() of the running image
    uint32_t    reason    = 0;    // raw esp_reset_reason_t value
    bool        safe_mode = false; // the latched boot-loop recovery flag (safe_mode.cpp)

    // The recovery state this boot established, APPENDED after the fields above so a collector that
    // already extracts version/elf_sha256/reset/safe_mode keeps working unchanged. Every one of
    // these is decided before the syslog task exists — the crash counter and NVS state at the very
    // top of app_main — so their own /diag lines never reach the log stream; this record is the
    // only way they leave the device without somebody reading /diag in time.
    const char* cause         = nullptr; // safe_mode_cause(): "crash_loop", "heap", or nullptr
    int         crash_boots   = 0;    // safe_mode_crash_boots(): the crash count this boot acted on
    unsigned    heap_restarts = 0;    // heap_guard_restarts(): the heap ladder position honoured
    bool        nvs_ok        = true; // nvs_storage_available(): false = no persistence this boot
};

// The `cause=` value. A closed vocabulary rather than the caller's string verbatim: the record is
// logfmt, an unexpected value with a space in it would split the field, and safe_mode.cpp only ever
// assigns the two literals below. Anything else is named "unknown" instead of being passed through.
inline const char* boot_cause_slug(const char* cause) noexcept {
    if (!cause || !cause[0]) return "none";
    if (std::strcmp(cause, "crash_loop") == 0) return "crash_loop";
    if (std::strcmp(cause, "heap") == 0) return "heap";
    return "unknown";
}

// One line, always emitted (a clean boot is worth a build-identity marker too). Empty version/hash
// degrade to "?" rather than an empty value, so the key never renders as a dangling "version=".
inline std::string build_boot_line(const BootIdent& b) {
    std::string s = "boot: version=";
    s += (b.version && b.version[0]) ? b.version : "?";
    s += " elf_sha256=";
    s += (b.elf_sha && b.elf_sha[0]) ? b.elf_sha : "?";
    s += " reset=";
    s += crash_reason_slug(b.reason);   // ONE reset vocabulary — see reset_reason.hpp
    s += b.safe_mode ? " safe_mode=yes" : " safe_mode=no";
    // The appended recovery fields in one allocation-free step. Every value is bounded — a closed
    // slug, two integers, a two-way flag: at most 79 characters even for INT_MIN and UINT_MAX — so
    // the buffer cannot truncate.
    char tail[112];
    std::snprintf(tail, sizeof(tail), " cause=%s crash_boots=%d heap_restarts=%u nvs=%s",
                  boot_cause_slug(b.cause), b.crash_boots, b.heap_restarts,
                  b.nvs_ok ? "ok" : "degraded");
    s += tail;
    return s;
}

// Header + task/PC + ELF identity + two backtrace records. Separating ELF identity preserves the
// 200-byte bound even for 15 escaped task bytes and a full 64-character hash. Eight PCs per record
// retain all 16 PCs while every stored record repeats provenance (a collector may get only one).
inline constexpr int CRASH_LOG_LINE_MAX = 5;

// Render current reset facts and any stored summary as up to CRASH_LOG_LINE_MAX records into out[],
// returning the count. Returns 0 for a boot that is not notable (a clean power-on / software reboot
// with no orphan dump) — the notability rule lives HERE, host-tested, rather than in
// the device caller. Writes at most `max` entries, so a caller with a smaller array cannot overrun.
inline int build_crash_log_lines(const CrashInfo& c, std::string* out, int max) {
    if (!out || max <= 0 || !crash_is_notable(c)) return 0;
    int n = 0;

    std::string head = "crash: reset=";
    head += crash_reason_slug(c.reason);
    head += crash_reason_is_fault(c.reason) ? " fault=yes" : " fault=no";
    head += c.coredump ? " coredump=yes" : " coredump=no";
    head += " source=current_boot";
    out[n++] = head;

    if (!c.have_summary) return n;   // orphan dump / no parsable summary: the header is all there is

    if (n < max) {
        std::string s = "crash: source=stored_dump age=unknown reset_relation=unknown task=";
        append_crash_log_value(s, c.task);
        s += " pc=";
        append_hex32(s, c.pc);
        if (c.bt_corrupted) s += " corrupted=yes";
        out[n++] = s;
    }

    if (c.elf_sha[0] && n < max) {
        std::string s = "crash: source=stored_dump age=unknown reset_relation=unknown elf_sha256=";
        append_crash_log_value(s, c.elf_sha);
        out[n++] = s;
    }

    // Raw PCs, symbolized offline against the matching .elf (scripts/decode-coredump.sh). Depth is
    // clamped to the 16-entry buffer — a corrupt summary can over-report it (mirrors build_crash_json).
    const int depth = c.bt_depth < 0 ? 0 : (c.bt_depth < 16 ? c.bt_depth : 16);
    for (int start = 0; start < depth && n < max; start += 8) {
        std::string s   = "crash: source=stored_dump age=unknown reset_relation=unknown backtrace=";
        const int   end = start + 8 < depth ? start + 8 : depth;
        for (int i = start; i < end; i++) {
            if (i > start) s += ' ';
            append_hex32(s, c.bt[i]);
        }
        out[n++] = s;
    }
    return n;
}

} // namespace daik
