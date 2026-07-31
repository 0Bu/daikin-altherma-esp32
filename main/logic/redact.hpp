#pragma once
// What a diagnostic snapshot must NOT carry when it leaves the device — the one implementation of
// that rule, for `GET /status?redact=1` and `GET /diag?redact=1` (http_status.cpp).
//
// Why here and not in the browser: the web UI's "Report a bug" action, the manual curl fallback in
// docs/REPORTING.md and any future collector all need the same answer, and a rule that exists twice
// is a rule one copy stops covering. The copy that silently misses a newly-added field is the one
// that leaks it — the same argument logic/lwt_select.hpp and logic/ou_stale.hpp make about second
// copies of a rule the CI gate can only see in one place.
//
// TWO SHAPES, because the two routes leak differently:
//   * /status leaks by FIELD — eight named values in a JSON object built field by field, so the
//     substitution happens where the value is written (http_status.cpp calls redact_or) and never as
//     a post-processing pass over the finished string. That matters: http_append_status_json() runs
//     on the httpd task whose stack overflow killed v1.0.12, and a second full-size buffer is
//     exactly what that budget has no room for.
//   * /diag leaks by LINE — a handful of log statements interpolate a host, an IP or an SSID into
//     free text. That is the non-trivial half and the one the CHECKs are really about.
//
// The VALUE is replaced, the KEY is kept. Dropping the field instead would be indistinguishable
// from an OLDER firmware that never had it, and "which build produced this?" is the first question
// triage asks of a frozen report (.claude/skills/bug-triage) — a privacy measure must not forge a
// version signal.
//
// Deliberately NOT redacted, because they identify the FIRMWARE rather than the reporter:
// version, app_elf_sha256, uptime, heap, the X10A pins, the detected model. And not wifi.rssi /
// wifi.connected / syslog.port either — the point of the report is that those still answer.
#include <cstddef>
#include <string>
#include <string_view>

namespace daik {

// The one replacement token. Callers of the report format (and the bug-triage skill) key on this
// exact string to tell "the reporter scrubbed it" apart from a JSON null (the device reported
// nothing, e.g. bssid while offline) and from an absent key (an older build).
inline constexpr const char* REDACTED = "<redacted>";

// The eight /status values http_status.cpp passes through redact_or. Listed here rather than only at
// the call sites so the set is reviewable in one place; the header cannot enforce that every call
// site uses it (that stays a review point — see .claude/CLAUDE.md), but it can at least state it.
//   wifi.ssid  wifi.ip  wifi.bssid  wifi.mac  mqtt.broker  syslog.host  ntp.server  modbus.host
// modbus.host joined the set with the HomeHub transport (#32): it is a LAN address, and — when the
// hub was auto-discovered — its LAN IPv4 address, which identifies the reporter's network just as
// surely as a manually entered address does.
inline constexpr std::size_t REDACTED_STATUS_FIELDS = 8;

// Field-level substitution for the /status builder. Returns by value because every caller feeds it
// straight into json_quote(), which copies anyway.
inline std::string redact_or(const std::string& value, bool on) {
    return on ? std::string(REDACTED) : value;
}

// One diag-line rule: everything between the end of `marker` and the next `end` is replaced.
struct DiagRedaction {
    const char* marker;   // matched anywhere in the line; the value starts right after it
    const char* end;      // the value ends here (exclusive). Empty = run to the end of the line.
};

// The log statements that interpolate an identifier. Each entry is one diag_printf() in the
// firmware; the comment names it, because a reworded log line silently stops matching and the only
// symptom is a leak nobody sees.
inline constexpr DiagRedaction DIAG_REDACTIONS[] = {
    // syslog.cpp "syslog: target set to %s:%d" — the port goes with it (no end token). /status
    // carries syslog.port, so nothing diagnostic is lost, and guessing where the host stops in a
    // string that may itself contain a colon is not worth the risk.
    {"syslog: target set to ", ""},
    // syslog.cpp "syslog: forwarding to %s (%s), reachable=%s" — host AND resolved IP in one span;
    // reachable= survives, which is the half that says whether the collector answers.
    {"syslog: forwarding to ", ", reachable="},
    // syslog.cpp "syslog: DNS lookup failed for %s (error %d)" — the errno is the diagnosis, keep it.
    {"syslog: DNS lookup failed for ", " (error"},
    // wifi.cpp "wifi: rollback restore to '%s' was not persisted — ..."
    {"wifi: rollback restore to '", "'"},
    // wifi.cpp "wifi: could not clear the rollback backup ('%s') — ..."
    {"wifi: could not clear the rollback backup ('", "'"},
    // sntp_time.cpp "sntp: time synced (%s)" and "sntp: init failed (%s): %s" — the trailing
    // esp_err_to_name() of the failure case survives, only the server name goes.
    {"sntp: time synced (", ")"},
    {"sntp: init failed (", ")"},
    // mqtt_ha.cpp "mqtt: retired legacy HA device %s (now %s)". The first id is board_id() =
    // "daikin_<low 3 bytes of the STA MAC>" — the unique half of the MAC, which is exactly what
    // /status withholds by redacting wifi.mac, so leaving it here would have made the redaction
    // incoherent: scrubbed in the JSON, printed in the log two sections below it. The second id is
    // the slugified base topic (a fixed compile-time name) and stays.
    {"mqtt: retired legacy HA device ", " (now "},
    // hp_modbus.cpp "modbus: one-shot mDNS search found gateway %s" — the DISCOVERED HomeHub IPv4.
    // /status?redact=1 already withholds it as
    // modbus.host, and without this rule the same string was printed in /diag a few sections below
    // it in the very same bug report — the incoherence the mqtt rule above exists to prevent, in a
    // second place. The failure line contains no address and therefore survives whole.
    {"modbus: one-shot mDNS search found gateway ", ""},
    // hp_modbus.cpp "modbus: %d HomeHubs discovered via mDNS — using %s" — the same IPv4 on the
    // several-hubs path. The marker starts AFTER the count, because a rule matches the RENDERED
    // line and "%d" never appears in one; the count therefore survives, which is the diagnostic
    // half — that more than one gateway answered is what explains an unexpected pick.
    {" HomeHubs discovered via mDNS — using ", ""},
};
inline constexpr std::size_t DIAG_REDACTION_COUNT = sizeof(DIAG_REDACTIONS) / sizeof(DIAG_REDACTIONS[0]);

// Redact one /diag line. A line matching no rule is returned unchanged — the ring is mostly poll
// and detect chatter that names nothing.
//
// FAILS CLOSED: if the end token is not found (a line the ring truncated mid-value, which is
// exactly when a value is most likely to be sitting unterminated at the end), the redaction runs to
// the end of the line rather than giving up and leaving the value in place.
//
// A trailing newline is preserved rather than swallowed by that fail-closed span, so the caller can
// hand lines over with or without their terminator and the ring's line structure survives either
// way — a /diag whose lines ran together would be redacted and unreadable.
inline std::string redact_diag_line(std::string_view line) {
    std::string out(line);
    std::size_t limit = out.size();
    while (limit > 0 && (out[limit - 1] == '\n' || out[limit - 1] == '\r')) limit--;
    for (std::size_t i = 0; i < DIAG_REDACTION_COUNT; i++) {
        const DiagRedaction& r = DIAG_REDACTIONS[i];
        std::string_view marker(r.marker);
        std::size_t start = out.find(marker);
        if (start == std::string::npos || start + marker.size() > limit) continue;
        start += marker.size();
        std::string_view end_tok(r.end);
        std::size_t stop = end_tok.empty() ? std::string::npos : out.find(end_tok, start);
        if (stop == std::string::npos || stop > limit) stop = limit;   // fail closed, keep the newline
        std::size_t before = stop - start;
        out.replace(start, before, REDACTED);
        limit = limit - before + std::string_view(REDACTED).size();
    }
    return out;
}

}  // namespace daik
