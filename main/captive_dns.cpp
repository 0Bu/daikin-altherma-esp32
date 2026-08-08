// Minimal captive-portal DNS server. Answers every A query with the SoftAP IP (192.168.4.1) so a
// joining phone's OS connectivity check resolves to this device and hits the setup page, popping
// the captive-portal UI. Non-A queries get an empty (0-answer) reply. See captive_dns.hpp.
#include "captive_dns.hpp"
#include "diag_log.hpp"
#include "logic/captive.hpp"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/task.h"
#include "lwip/sockets.h"

#include <cstdint>

namespace daik {

static const char* TAG = "cdns";

static void dns_task(void*) {
    int sock = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (sock < 0) {
        ESP_LOGE(TAG, "socket failed");
        diag_printf("cdns: socket failed — portal won't auto-open (browse to %s)\n", CAPTIVE_PORTAL_IP);
        vTaskDelete(nullptr);
        return;
    }

    sockaddr_in server = {};
    server.sin_family      = AF_INET;
    server.sin_addr.s_addr = htonl(INADDR_ANY);
    server.sin_port        = htons(53);
    if (::bind(sock, reinterpret_cast<sockaddr*>(&server), sizeof(server)) < 0) {
        ESP_LOGE(TAG, "bind :53 failed");
        diag_printf("cdns: bind :53 failed — portal won't auto-open (browse to %s)\n", CAPTIVE_PORTAL_IP);
        ::close(sock);
        vTaskDelete(nullptr);
        return;
    }
    ESP_LOGI(TAG, "captive DNS on :53 -> %s", CAPTIVE_PORTAL_IP);

    unsigned answered = 0;
    uint8_t  buf[512];
    while (true) {
        sockaddr_in client;
        socklen_t   clen = sizeof(client);
        int len = ::recvfrom(sock, buf, sizeof(buf), 0, reinterpret_cast<sockaddr*>(&client), &clen);
        if (len < 12) continue;                       // smaller than a DNS header

        if (buf[2] & 0x80) continue;                  // not a query (QR set)
        if (((buf[4] << 8) | buf[5]) != 1) continue;  // exactly one question only

        // Walk the question name (labels, each prefixed by a length byte, terminated by 0x00).
        int q = 12;
        while (q < len && buf[q] != 0) { q += buf[q] + 1; }
        if (q >= len || q + 5 > len) continue;        // need null + QTYPE(2) + QCLASS(2)
        int qtype = (buf[q + 1] << 8) | buf[q + 2];
        int qend  = q + 5;                            // end of the question section

        // Rewrite the header in place as a response: QR=1, AA=1, RCODE=0; zero NS/AR counts.
        // RD is COPIED from the query and RA set, per RFC 1035 §4.1.1 — a stub resolver that sees
        // its Recursion-Desired bit come back cleared, or recursion reported unavailable, may
        // discard the answer, and a discarded answer here means the probe never reaches us and the
        // portal never pops. Zeroing ARCOUNT also drops any EDNS0 OPT record the query carried,
        // which correctly reads as "this server does not do EDNS".
        buf[2] = 0x84 | (buf[2] & 0x01);               // QR=1, AA=1, + the query's RD
        buf[3] = 0x80;                                 // RA=1, RCODE=0
        buf[6] = 0x00;                                 // ANCOUNT hi
        buf[8] = 0x00; buf[9] = 0x00;                  // NSCOUNT
        buf[10] = 0x00; buf[11] = 0x00;                // ARCOUNT

        if (qtype == 1 /* A */ && qend + 16 <= static_cast<int>(sizeof(buf))) {
            // First answered query of this boot only. Proof the client is actually resolving
            // through us — the step that silently fails when DHCP didn't offer us as DNS. A phone
            // fires dozens of lookups per join, so anything per-query would flood the ring and push
            // out the boot records; the count is what /diag needs, not each name.
            if (!answered++) diag_printf("cdns: first DNS query answered -> %s\n", CAPTIVE_PORTAL_IP);
            buf[7] = 0x01;                             // ANCOUNT = 1
            uint8_t* p = buf + qend;
            *p++ = 0xC0; *p++ = 0x0C;                  // NAME  -> pointer to the question
            *p++ = 0x00; *p++ = 0x01;                  // TYPE  A
            *p++ = 0x00; *p++ = 0x01;                  // CLASS IN
            *p++ = 0x00; *p++ = 0x00; *p++ = 0x00; *p++ = 0x3C;  // TTL 60s
            *p++ = 0x00; *p++ = 0x04;                  // RDLENGTH 4
            for (unsigned char o : CAPTIVE_PORTAL_OCTETS) *p++ = o;   // RDATA — logic/captive.hpp
            ::sendto(sock, buf, qend + 16, 0, reinterpret_cast<sockaddr*>(&client), clen);
        } else {
            buf[7] = 0x00;                             // ANCOUNT = 0 (no answer)
            ::sendto(sock, buf, qend, 0, reinterpret_cast<sockaddr*>(&client), clen);
        }
    }
}

void captive_dns_start() {
    // If the DNS-redirect task can't start, the captive portal simply won't auto-pop — the user can
    // still reach the setup page at 192.168.4.1. Non-fatal, but report it.
    if (xTaskCreate(dns_task, "captive_dns", 4096, nullptr, TASK_PRIO_CAPTIVE_DNS, nullptr) != pdPASS) {
        ESP_LOGE(TAG, "captive DNS task alloc failed — portal won't auto-open (browse to %s)", CAPTIVE_PORTAL_IP);
        diag_printf("cdns: task alloc failed — portal won't auto-open (browse to %s)\n", CAPTIVE_PORTAL_IP);
    }
}

} // namespace daik
