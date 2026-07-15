#pragma once
#include <cstddef>
#include <string>

namespace daik {

struct SyslogStatus {
    bool configured;   // syslog_host is set
    bool resolved;     // DNS resolved → a destination is known and lines are being forwarded
    bool reachable;    // ADVISORY: last ARP/ICMP probe answered. Never gates delivery (syslog is
                       // best-effort UDP; an ICMP-filtered host still receives) — a UI hint only.
    std::string host;
    int port;
    std::string error;
};

void syslog_init();
void syslog_send(const char* msg, size_t len);
SyslogStatus syslog_status();

} // namespace daik
