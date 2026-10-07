#pragma once
// Request-body reassembly (http_common.cpp). Pure, IDF-free, host-tested (test/test_logic.cpp).
//
// A POST body is a TCP stream, not a datagram: esp_http_server hands over whatever has arrived,
// and its own docs say so plainly — "If content_len is too large for the buffer then user may have
// to make multiple calls to this function". http_read_body called httpd_req_recv exactly once and
// treated the result as the whole body, so a body split across segments arrived truncated and the
// handler answered 400 "bad json" to a POST that was perfectly valid. It is a rare failure on a
// quiet LAN and a reliable one on a busy or distant link, which is the worst shape of bug to own:
// it looks like the user mistyped their broker.
//
// Why the loop lives here rather than in the .cpp. The reassembly is the whole fix, and on the
// device it is only exercised by a segmentation pattern we cannot ask for. Behind a recv callback
// it becomes a handful of CHECKs — one-byte-at-a-time delivery, a mid-body error, a stalled peer —
// that run in CI on every push. http_common.cpp keeps the one thing that is genuinely IDF's: the
// mapping from httpd_req_recv's return codes onto BodyRecv.
//
// Why a stalled peer must lose. httpd_req_recv returns HTTPD_SOCK_ERR_TIMEOUT when its socket
// timeout expires with nothing new, which is recoverable and worth retrying — but only a bounded
// number of times. Retrying forever would let one client that opens a POST, announces a
// Content-Length and then goes quiet park the single httpd task indefinitely, taking the whole web
// UI (and the OTA route that is the way out of a bad config) down with it. A body that cannot
// finish within a couple of socket timeouts is not a body worth waiting for.
//
// Why the leftover is settled here too. A handler may answer without reading the whole body: a
// rejection before any read (403, 415, 503), a failed or oversized read, a route that expects no
// body. esp_http_server then purges the rest itself before it reuses the session
// (httpd_req_delete), reading every announced byte with only the per-receive socket timeout and NO
// overall limit — and after the handler returned, so the budget above never applies to it. A peer
// that announces a large Content-Length and trickles a byte inside every timeout therefore held the
// single httpd task for as long as it liked. http_body_discard() bounds that remainder; whatever it
// cannot settle makes the trampoline return ESP_FAIL, which IDF answers by closing the session
// instead of purging.
#include <cstddef>
#include <cstdint>

namespace daik {

// One recv attempt, classified. esp_http_server returns bytes>0, 0 for a peer that closed or a
// request with nothing left to read, HTTPD_SOCK_ERR_TIMEOUT (-3) for "nothing arrived in time", and
// other negatives for hard errors. Keeping that mapping in the caller keeps this header IDF-free.
enum class BodyRecv : uint8_t {
    Data,    // `bytes` bytes were written into the buffer
    Timeout, // nothing arrived within the socket timeout — recoverable, bounded by BODY_MAX_IDLE
    Error,   // peer closed, or an unrecoverable socket error
    End,     // the request owes no further body bytes (http_body_discard only)
};

struct BodyChunk {
    BodyRecv kind;
    size_t   bytes;   // meaningful only when kind == Data
};

// Consecutive timeouts tolerated before a body is abandoned. Each one is a full socket timeout
// (CONFIG_HTTPD_REQ_RECV_TMO, 5 s by default), so this is ~15 s of patience for a body that any
// healthy client sends in one segment.
inline constexpr int BODY_MAX_IDLE = 2;

// Total timeouts tolerated across the entire body reassembly. Prevents slowloris attacks from
// trickling 1 byte every 2 timeouts indefinitely and tying up the single httpd task.
inline constexpr int BODY_MAX_TOTAL_IDLE = 20;

// Read exactly `total` bytes into `buf` and NUL-terminate. Returns the byte count, or -1 if the
// body does not fit `cap` (leaving room for the terminator), is empty, or the peer failed to
// deliver it. `recv(dst, len)` must return a BodyChunk. An optional `deadline_reached` functor
// can abort the read if the overall wall-clock budget expires.
template <typename Recv, typename DeadlineReached = bool (*)()>
int http_body_read(
    char* buf, size_t cap, size_t total, Recv recv,
    DeadlineReached deadline_reached = []() { return false; }) {
    if (!buf || total == 0 || total >= cap) return -1;

    size_t got        = 0;
    int    idle       = 0;
    int    total_idle = 0;
    while (got < total) {
        if (deadline_reached()) return -1;
        const BodyChunk c = recv(buf + got, total - got);
        if (deadline_reached()) return -1;
        if (c.kind == BodyRecv::Timeout) {
            if (++idle > BODY_MAX_IDLE) return -1;
            if (++total_idle > BODY_MAX_TOTAL_IDLE) return -1;
            continue;
        }
        // A recv that reports more than we asked for would run off the buffer. It cannot happen
        // against a correct socket layer, but `bytes` decides a write bound, so it is checked
        // rather than trusted.
        if (c.kind == BodyRecv::Error || c.bytes == 0 || c.bytes > total - got) return -1;
        idle = 0;
        got += c.bytes;
    }
    buf[got] = '\0';
    return static_cast<int>(got);
}

// The leftover a session may still discard after its response: the largest route buffer
// (/set_ref_temp), within a budget checked before each receive. A receive in progress still returns
// under its socket timeout, so the worst case is the budget plus one socket timeout.
inline constexpr size_t  BODY_DISCARD_MAX_BYTES = 8192;
inline constexpr int64_t BODY_DISCARD_BUDGET_US = 2000000;

// Settle the body bytes a request still owes after its response. Returns true when nothing remains
// and the session may be reused; false when the caller must close it instead. `recv()` performs one
// receive into the caller's scratch buffer and reports End once nothing remains. A timeout is not
// retried: the response has been sent, and a silent peer is owed nothing more.
template <typename Recv, typename DeadlineReached>
bool http_body_discard(Recv recv, DeadlineReached deadline_reached,
                       size_t max_bytes = BODY_DISCARD_MAX_BYTES) {
    size_t discarded = 0;
    for (;;) {
        if (deadline_reached()) return false;
        const BodyChunk c = recv();
        if (c.kind == BodyRecv::End) return true;
        if (c.kind != BodyRecv::Data || c.bytes == 0) return false;
        if (c.bytes > max_bytes - discarded) return false;
        discarded += c.bytes;
    }
}

} // namespace daik
