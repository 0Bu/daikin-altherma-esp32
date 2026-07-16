#pragma once
// Boot records for the LOG STREAM (syslog → VictoriaLogs) — the one-shot lines syslog.cpp replays
// once a collector is resolved. Pure string building, IDF-free, host-tested (test/test_logic.cpp).
//
// Why this exists rather than reusing build_crash_text():
//   * TIMING — diag_crash_capture() runs at the top of app_main, before WiFi and before the syslog
//     task exists, so its "crash:" line only ever reaches the in-RAM diag ring. The ring is 6 KB and
//     a chatty failure mode (an X10A timeout every ~0.3 s) overwrites it within a minute, so in
//     practice the crash is readable NOWHERE. syslog.cpp replays these records after DNS resolves.
//   * SIZE — build_crash_text() is one multi-line block; at worst case (16-deep backtrace + a 64-char
//     ELF hash) it is ~340 bytes, past diag_printf's 256-byte line buffer AND past the 256-byte
//     syslog queue slot, so it truncates exactly where the backtrace and elf_sha256 live. These
//     records are single-line and each fits one datagram whole (see the CRASH_LOG_LINE_BUDGET test).
// build_crash_text() stays as-is: it is the paste-friendly block for /diag + the UI bundle, where
// multi-line is a feature and nothing truncates it.
//
// Format is logfmt-ish (key=value, space separated) so a collector can extract fields without a
// custom parser, and each line carries a leading "boot:"/"crash:" module tag matching the rest of
// the diag vocabulary.
#include "crashinfo.hpp"

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
};

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
    return s;
}

// Upper bound on the records build_crash_log_lines() can produce (header / summary / backtrace).
inline constexpr int CRASH_LOG_LINE_MAX = 3;

// Render a captured crash as up to CRASH_LOG_LINE_MAX single-line records into out[], returning how
// many were written. Returns 0 for a boot that is not notable (a clean power-on / software reboot
// with no orphan dump) — the "only replay a real crash" rule lives HERE, host-tested, rather than in
// the device caller. Writes at most `max` entries, so a caller with a smaller array cannot overrun.
inline int build_crash_log_lines(const CrashInfo& c, std::string* out, int max) {
    if (!out || max <= 0 || !crash_is_notable(c)) return 0;
    int n = 0;

    std::string head = "crash: reset=";
    head += crash_reason_slug(c.reason);
    head += crash_reason_is_fault(c.reason) ? " fault=yes" : " fault=no";
    head += c.coredump ? " coredump=yes" : " coredump=no";
    out[n++] = head;

    if (!c.have_summary) return n;   // orphan dump / no parsable summary: the header is all there is

    if (n < max) {
        std::string s = "crash: task=";
        s += c.task;
        s += " pc=";
        append_hex32(s, c.pc);
        if (c.bt_corrupted) s += " corrupted=yes";
        if (c.elf_sha[0]) { s += " elf_sha256="; s += c.elf_sha; }
        out[n++] = s;
    }

    // Raw PCs, symbolized offline against the matching .elf (scripts/decode-coredump.sh). Depth is
    // clamped to the 16-entry buffer — a corrupt summary can over-report it (mirrors build_crash_json).
    const int depth = c.bt_depth < 0 ? 0 : (c.bt_depth < 16 ? c.bt_depth : 16);
    if (depth > 0 && n < max) {
        std::string s = "crash: backtrace=";
        for (int i = 0; i < depth; i++) { if (i) s += ' '; append_hex32(s, c.bt[i]); }
        out[n++] = s;
    }
    return n;
}

} // namespace daik
