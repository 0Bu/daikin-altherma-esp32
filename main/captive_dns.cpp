// Minimal captive-portal DNS server. Answers every A query with the SoftAP IP (192.168.4.1) so a
// joining phone's OS connectivity check resolves to this device and hits the setup page, popping
// the captive-portal UI. Non-A queries get an empty (0-answer) reply. See captive_dns.hpp.
#include "captive_dns.hpp"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"

#include <cstdint>

namespace daik {

static const char* TAG = "cdns";

static void dns_task(void*) {
    int sock = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (sock < 0) { ESP_LOGE(TAG, "socket failed"); vTaskDelete(nullptr); return; }

    sockaddr_in server = {};
    server.sin_family      = AF_INET;
    server.sin_addr.s_addr = htonl(INADDR_ANY);
    server.sin_port        = htons(53);
    if (::bind(sock, reinterpret_cast<sockaddr*>(&server), sizeof(server)) < 0) {
        ESP_LOGE(TAG, "bind :53 failed");
        ::close(sock);
        vTaskDelete(nullptr);
        return;
    }
    ESP_LOGI(TAG, "captive DNS on :53 -> 192.168.4.1");

    uint8_t buf[512];
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
        buf[2] = 0x84; buf[3] = 0x00;
        buf[6] = 0x00;                                 // ANCOUNT hi
        buf[8] = 0x00; buf[9] = 0x00;                  // NSCOUNT
        buf[10] = 0x00; buf[11] = 0x00;                // ARCOUNT

        if (qtype == 1 /* A */ && qend + 16 <= static_cast<int>(sizeof(buf))) {
            buf[7] = 0x01;                             // ANCOUNT = 1
            uint8_t* p = buf + qend;
            *p++ = 0xC0; *p++ = 0x0C;                  // NAME  -> pointer to the question
            *p++ = 0x00; *p++ = 0x01;                  // TYPE  A
            *p++ = 0x00; *p++ = 0x01;                  // CLASS IN
            *p++ = 0x00; *p++ = 0x00; *p++ = 0x00; *p++ = 0x3C;  // TTL 60s
            *p++ = 0x00; *p++ = 0x04;                  // RDLENGTH 4
            *p++ = 192; *p++ = 168; *p++ = 4; *p++ = 1;
            ::sendto(sock, buf, qend + 16, 0, reinterpret_cast<sockaddr*>(&client), clen);
        } else {
            buf[7] = 0x00;                             // ANCOUNT = 0 (no answer)
            ::sendto(sock, buf, qend, 0, reinterpret_cast<sockaddr*>(&client), clen);
        }
    }
}

void captive_dns_start() {
    xTaskCreate(dns_task, "captive_dns", 4096, nullptr, 5, nullptr);
}

} // namespace daik
