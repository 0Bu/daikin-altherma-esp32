#pragma once
// Crash / reset diagnostics — turns the ESP-IDF reset reason + the on-flash core-dump SUMMARY into
// a compact JSON (for /status.last_crash + the MQTT <base>/crash topic) and a paste-friendly
// text block (the diag ring + the web UI "copy diagnostics" bundle). Pure string building, IDF-free,
// host-tested (test/test_logic.cpp). The device fills CrashInfo once at boot (diag_crash.cpp) from
// esp_reset_reason() + esp_core_dump_get_summary(); nothing here touches hardware or the ELF — the
// backtrace stays as raw PC hex, symbolized offline against the matching .elf
// (scripts/decode-coredump.sh). Mirrors the heartbeat.hpp diagnostics pattern.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include "ha_device.hpp"   // device_json — one X10A HA device across values/diagnostics/crash
#include "json.hpp"        // json_append_escaped

namespace daik {

// Mirror of esp_reset_reason_t (esp_system.h). Kept as a standalone enum so this header stays
// IDF-free and host-testable; diag_crash.cpp static_asserts the numeric values still match the IDF
// enum, so a future IDF renumber fails the build rather than silently mislabeling a crash.
enum class CrashReason : uint32_t {
    UNKNOWN = 0, POWERON = 1, EXT = 2, SW = 3, PANIC = 4, INT_WDT = 5, TASK_WDT = 6,
    OTHER_WDT = 7, DEEPSLEEP = 8, BROWNOUT = 9, SDIO = 10, USB = 11, JTAG = 12,
    EFUSE = 13, PWR_GLITCH = 14, CPU_LOCKUP = 15,
};

// Short stable slug for a reset-reason code (the raw esp_reset_reason_t value).
inline const char* crash_reason_slug(uint32_t reason) {
    switch (static_cast<CrashReason>(reason)) {
        case CrashReason::POWERON:    return "poweron";
        case CrashReason::EXT:        return "ext";
        case CrashReason::SW:         return "sw";
        case CrashReason::PANIC:      return "panic";
        case CrashReason::INT_WDT:    return "int_wdt";
        case CrashReason::TASK_WDT:   return "task_wdt";
        case CrashReason::OTHER_WDT:  return "wdt";
        case CrashReason::DEEPSLEEP:  return "deepsleep";
        case CrashReason::BROWNOUT:   return "brownout";
        case CrashReason::SDIO:       return "sdio";
        case CrashReason::USB:        return "usb";
        case CrashReason::JTAG:       return "jtag";
        case CrashReason::EFUSE:      return "efuse";
        case CrashReason::PWR_GLITCH: return "pwr_glitch";
        case CrashReason::CPU_LOCKUP: return "cpu_lockup";
        case CrashReason::UNKNOWN:
        default:                      return "unknown";
    }
}

// Does this reset reason indicate a FAULT (something crashed / went wrong) rather than a normal
// boot? Drives whether the UI shows the crash banner and whether /status.last_crash is populated.
// A software reset (config save / OTA reboot), a clean power-on, an external-pin reset and a
// deep-sleep / USB / JTAG wake are all NORMAL. A watchdog, panic, brown-out, power glitch or CPU
// lockup is a fault.
inline bool crash_reason_is_fault(uint32_t reason) {
    switch (static_cast<CrashReason>(reason)) {
        case CrashReason::PANIC:
        case CrashReason::INT_WDT:
        case CrashReason::TASK_WDT:
        case CrashReason::OTHER_WDT:
        case CrashReason::BROWNOUT:
        case CrashReason::PWR_GLITCH:
        case CrashReason::CPU_LOCKUP:
            return true;
        default:
            return false;
    }
}

// Everything the device captured about the last reset. bt[] holds raw program-counter addresses
// (symbolized offline against the matching .elf); elf_sha is the crashed build's app ELF hash (hex,
// possibly truncated by CONFIG_APP_RETRIEVE_LEN_ELF_SHA — still enough to spot a cross-version dump).
struct CrashInfo {
    uint32_t reason       = 0;      // raw esp_reset_reason_t value
    bool     coredump     = false;  // a downloadable core-dump image exists in flash (GET /coredump)
    bool     dismissed    = false;  // the user ACKNOWLEDGED this crash (POST /crash/dismiss) — see below
    bool     have_summary = false;  // the summary fields below were parsed from that image
    char     task[16]     = {0};    // crashed task name (summary)
    uint32_t pc           = 0;      // exception program counter (summary)
    uint32_t bt[16]       = {0};    // backtrace PCs (summary)
    int      bt_depth     = 0;      // number of valid entries in bt[]
    bool     bt_corrupted = false;  // the unwinder flagged the backtrace as unreliable
    char     elf_sha[65]  = {0};    // crashed build's app_elf_sha256 (hex; "" if unknown)
};

// Minimum hex-char overlap two app-ELF SHA-256 strings must share before a DIFFERENCE between them is
// trusted as "different build". Both sides come from esp_app_get_elf_sha256 / the core-dump summary's
// app_elf_sha256, each truncated to CONFIG_APP_RETRIEVE_LEN_ELF_SHA256 hex chars (default 9); 8 chars
// = 32 bits, below that default, so the normal equal-length case is compared in full while a
// pathologically short config can never make two good shas look different by accident.
inline constexpr size_t ELF_SHA_MIN_COMPARE = 8;

// Does a core dump carrying app-ELF sha `dump_sha` belong to a DIFFERENT firmware than the running
// build `run_sha`? The coredump partition survives an OTA, and a panic that fails to write its own
// dump (a stack overflow can overrun the writer) leaves the PREVIOUS build's dump in place — a valid
// image that still passes esp_core_dump_image_check() but describes another binary, so a download of
// it fails espcoredump with a SHA-256 mismatch (#215). This answers true ONLY on proof — both shas
// present, a meaningful common prefix, and a mismatch within it — because the caller ERASES on true
// and erasing a dump that really IS ours (a false positive) destroys the one artifact a panic left.
// A missing sha (a dump with no parsable summary, a build that could not report its own) is NOT proof
// of foreign origin, so it returns false and the dump is left alone. Truncation to different lengths
// is fine: two renderings of the same hash agree on their common prefix.
inline bool coredump_is_foreign(const char* dump_sha, const char* run_sha) {
    if (!dump_sha || !run_sha || !*dump_sha || !*run_sha) return false;
    size_t nd = std::strlen(dump_sha), nr = std::strlen(run_sha);
    size_t n  = nd < nr ? nd : nr;
    if (n < ELF_SHA_MIN_COMPARE) return false;
    return std::strncmp(dump_sha, run_sha, n) != 0;
}

// A last_crash worth surfacing = a fault reset OR an orphan core-dump still sitting in flash. A
// clean power-on / software reboot is not notable (no banner), but its reason is still reported.
//
// ...unless the user DISMISSED it (POST /crash/dismiss -> diag_crash_dismiss()). That is a real
// deletion, not a per-browser "hide": the dump is erased from flash first and only then is this flag
// set, so `dismissed` never claims a crash is dealt with while its evidence is still downloadable.
// It lives HERE rather than in the browser because there is nowhere else it could live and stay
// true: the banner was previously suppressed in page state alone, so a reload — or a second browser,
// or Home Assistant's retained crash entity — showed the same crash again, which is exactly the
// complaint. The flag is RAM-only ON PURPOSE and needs no NVS: after any reboot the reset reason is
// no longer a fault and the dump is gone, so nothing raises the banner again — while a NEW crash
// captures a fresh CrashInfo and must show, which persisting a dismissal could suppress.
//
// The reset reason itself survives dismissal untouched (/status.sys.reset_reason and the heartbeat's
// own "Reset Reason" sensor): what the user dismissed is the crash REPORT, not the fact that the
// board rebooted the way it did.
inline bool crash_is_notable(const CrashInfo& c) {
    if (c.dismissed) return false;
    return c.coredump || crash_reason_is_fault(c.reason);
}

inline void append_hex32(std::string& out, uint32_t v) {
    char b[11];
    std::snprintf(b, sizeof(b), "0x%08x", static_cast<unsigned>(v));
    out += b;
}

// Compact JSON describing the reset. ALWAYS includes reason/reason_code/fault/coredump (so a clean
// boot still reports e.g. reason="sw"); the summary fields (task/pc/backtrace/corrupted/elf_sha256)
// are added only when a core-dump summary was parsed. Shared by /status.last_crash and the MQTT
// crash topic. bt_depth is clamped to the 16-entry buffer.
inline std::string build_crash_json(const CrashInfo& c) {
    std::string j = "{";
    j += "\"reason\":\""; j += crash_reason_slug(c.reason); j += "\",";
    j += "\"reason_code\":" + std::to_string(c.reason) + ",";
    j += "\"fault\":"; j += crash_reason_is_fault(c.reason) ? "true" : "false"; j += ",";
    j += "\"coredump\":"; j += c.coredump ? "true" : "false";
    if (c.have_summary) {
        j += ",\"task\":\""; json_append_escaped(j, c.task); j += "\",";
        j += "\"pc\":\""; append_hex32(j, c.pc); j += "\",";
        j += "\"backtrace\":[";
        const int n = c.bt_depth < 0 ? 0 : (c.bt_depth < 16 ? c.bt_depth : 16);
        for (int i = 0; i < n; i++) { if (i) j += ","; j += "\""; append_hex32(j, c.bt[i]); j += "\""; }
        j += "],";
        j += "\"corrupted\":"; j += c.bt_corrupted ? "true" : "false";
        if (c.elf_sha[0]) { j += ",\"elf_sha256\":\""; json_append_escaped(j, c.elf_sha); j += "\""; }
    }
    j += "}";
    return j;
}

// The RETAINED <base>/crash MQTT payload. A crash topic carries a message ONLY when the last reset
// is NOTABLE (a real fault OR an orphan core-dump still in flash — crash_is_notable): the crash JSON.
// Otherwise the payload is EMPTY, and the caller publishes it as a zero-length RETAINED message,
// which CLEARS the retained topic — so a normal boot (USB re-enumeration, config-save / OTA reboot,
// clean power-on) leaves no crash message, and a stale crash record disappears from the broker (and
// Home Assistant) the moment the device reboots cleanly, i.e. once the problem is resolved. The reset
// reason itself is never lost by clearing this: the heartbeat topic carries it as its own "Reset
// Reason" sensor (reset_reason_name == crash_reason_slug, host-asserted), independent of a crash.
inline std::string build_crash_mqtt_payload(const CrashInfo& c) {
    return crash_is_notable(c) ? build_crash_json(c) : std::string();
}

// Human/paste-friendly multi-line text of the same fields — logged to the diag ring at boot and
// reused wherever a plain-text crash line is nicer than JSON.
inline std::string build_crash_text(const CrashInfo& c) {
    std::string t = "reset=";
    t += crash_reason_slug(c.reason);
    t += c.coredump ? "  coredump=yes" : "  coredump=no";
    if (c.have_summary) {
        t += "\ntask="; t += c.task;
        t += "  pc="; append_hex32(t, c.pc);
        t += "\nbacktrace:";
        const int n = c.bt_depth < 0 ? 0 : (c.bt_depth < 16 ? c.bt_depth : 16);
        for (int i = 0; i < n; i++) { t += ' '; append_hex32(t, c.bt[i]); }
        if (c.bt_corrupted) t += "  (corrupted)";
        if (c.elf_sha[0]) { t += "\nelf_sha256="; t += c.elf_sha; }
    }
    return t;
}

// Crash topic: <base>/crash — retained, republished once per MQTT (re)connect so a late subscriber
// (Home Assistant, or Telegraf → VictoriaLogs) still sees the last reset.
inline std::string crash_topic(const std::string& base) {
    return base + "/crash";
}

// Diagnostic HA entities sourced from the crash topic (mirrors HeartbeatSensor). The "problem"
// binary_sensor turns ON while a downloadable dump is waiting; entity_category "diagnostic". (The
// reset reason is NOT surfaced here — the heartbeat's own "Reset Reason" sensor owns it, so a crash
// entity for it would be an exact duplicate. See RETIRED_CRASH_SENSORS.)
struct CrashSensor {
    const char* component;     // "sensor" | "binary_sensor"
    const char* object_id;
    const char* name;
    const char* json_path;     // value_json path
    const char* device_class;  // "" = none
};

inline const CrashSensor CRASH_SENSORS[] = {
    {"binary_sensor", "coredump",   "Crash Dump Waiting", "coredump", "problem"},
};
inline constexpr int CRASH_SENSOR_COUNT = sizeof(CRASH_SENSORS) / sizeof(CRASH_SENSORS[0]);

// HA entities this firmware ONCE published on the crash topic but no longer does (RetiredHaSensor +
// the why, logic/ha_device.hpp — the type is shared with heartbeat.hpp's own retired list).
// "last_reset" (the "Last Reset Reason" sensor) was dropped once it became an exact duplicate of the
// heartbeat's own "Reset Reason" sensor (reset_reason_name == crash_reason_slug, host-asserted).
inline const RetiredHaSensor RETIRED_CRASH_SENSORS[] = {
    {"sensor", "last_reset"},   // superseded by the heartbeat "Reset Reason" sensor
};
inline constexpr int RETIRED_CRASH_SENSOR_COUNT =
    sizeof(RETIRED_CRASH_SENSORS) / sizeof(RETIRED_CRASH_SENSORS[0]);

// The retained HA discovery-config topic for one entity: <prefix>/<component>/<node>/<object_id>/config.
inline std::string crash_discovery_topic(const std::string& prefix, const std::string& component,
                                         const std::string& node, const std::string& object_id) {
    return prefix + "/" + component + "/" + node + "/" + object_id + "/config";
}
inline std::string crash_discovery_topic(const std::string& prefix, const std::string& node,
                                         const CrashSensor& s) {
    return crash_discovery_topic(prefix, s.component, node, s.object_id);
}

inline std::string crash_discovery_config(const std::string& node, const std::string& board_id,
                                          const std::string& crash_top,
                                          const std::string& avail_topic, const CrashSensor& s) {
    const bool is_binary = (s.component[0] == 'b');   // "binary_sensor"
    std::string j = "{";
    j += "\"name\":\""; j += s.name; j += "\",";
    j += "\"uniq_id\":\""; j += node; j += "_"; j += s.object_id; j += "\",";
    j += "\"stat_t\":\""; j += crash_top; j += "\",";
    if (is_binary) {
        // Jinja renders the JSON bool as True/False; | lower → "true"/"false" to match pl_on/pl_off.
        j += "\"val_tpl\":\"{{ value_json."; j += s.json_path; j += " | lower }}\",";
        j += "\"pl_on\":\"true\",\"pl_off\":\"false\",";
    } else {
        j += "\"val_tpl\":\"{{ value_json."; j += s.json_path; j += " }}\",";
    }
    j += "\"avty_t\":\""; j += avail_topic; j += "\",";
    if (s.device_class[0]) { j += "\"dev_cla\":\""; j += s.device_class; j += "\","; }
    j += "\"ent_cat\":\"diagnostic\",";
    j += device_json(node, board_id);
    j += "}";
    return j;
}

} // namespace daik
