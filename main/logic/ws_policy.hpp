#pragma once
// /events WebSocket command policy (http_status.cpp). Pure, IDF-free, host-tested (test/test_logic.cpp).
//
// /events speaks exactly one command — the client sends the text "sub" and gets a status+values
// snapshot, after which the poll task pushes it frames. Everything here decides what an arriving
// frame MEANS, split in two because the handler must decide twice, and the first decision is the
// one that used to be missing.
//
// Why the length is a PLAN input and never an allocation. httpd_ws_recv_frame(max_len=0) parses
// only the header, so `len` at that point is a number the client asserted — RFC 6455 allows 64
// bits of it, and nothing has been read to back it up. On a chip whose binding limit is the
// largest contiguous free block, sizing a buffer from it would hand any client on the LAN a
// one-frame OOM. So the frame is measured against a fixed command buffer and refused if it does
// not fit; it is never accommodated.
//
// Why refusing has to mean CLOSING. esp_http_server's recv fails a too-long frame outright
// (ESP_ERR_INVALID_SIZE) and, crucially, leaves the body in the socket — and it offers no way to
// skip N bytes. So after an oversized frame the stream is desynchronized: the unread payload would
// be parsed as the next frame's header. Draining it is exactly the allocation we just refused to
// make, which leaves dropping the connection as the only honest exit. Our own client only ever
// sends 3 bytes, so this costs a real user nothing.
//
// What went wrong before. The handler clamped max_len to its 16-byte buffer, discarded the recv
// return, and memcmp'd the buffer anyway — so an oversized frame compared against stack that the
// failed read had never written. Uninitialized stack that happens to open with "sub" would serve
// an unsolicited snapshot; the frame stayed unconsumed either way. Separately, ANY frame at all
// registered the socket into the broadcast list, so a client that never subscribed still got
// pushed a frame every second. Both are the same root cause — acting on a frame before
// establishing what it was — which is why the decision is a pure function with a name, and not an
// `if` in the middle of the handler.
#include <cstddef>
#include <cstdint>

namespace daik {

// The fixed command buffer /events reads a frame into. "sub" is the whole vocabulary; the headroom
// is only so a slightly-off client (trailing newline, say) still parses rather than being dropped.
inline constexpr size_t WS_CMD_MAX = 16;

// What to do with a frame of a given announced length, decided BEFORE its payload is touched.
enum class WsPlan : uint8_t {
    Skip,     // empty frame: carries no command, and has no body to leave behind — just ignore it
    Read,     // fits the command buffer: safe to read, then classify with ws_frame_action()
    Reject,   // longer than any command we accept: undrainable, so the connection must go
};

inline constexpr WsPlan ws_frame_plan(size_t announced_len) {
    if (announced_len == 0)         return WsPlan::Skip;
    if (announced_len > WS_CMD_MAX) return WsPlan::Reject;
    return WsPlan::Read;
}

// What a frame we successfully read actually asks for.
enum class WsAction : uint8_t {
    Ignore,      // not a command we know — no snapshot, and no slot in the broadcast list
    Subscribe,   // a "sub" text frame: send the snapshot and start pushing to this socket
};

// `payload`/`len` are the bytes ACTUALLY received — call this only after a read that returned OK,
// never on a buffer a failed read left untouched. Matching a prefix rather than the exact 3 bytes
// is deliberate: it is what the handler has always accepted, and this change is about frames that
// were never read, not about narrowing the command grammar.
inline WsAction ws_frame_action(bool is_text, const char* payload, size_t len) {
    if (!is_text || !payload || len < 3) return WsAction::Ignore;
    if (payload[0] == 's' && payload[1] == 'u' && payload[2] == 'b') return WsAction::Subscribe;
    return WsAction::Ignore;
}

} // namespace daik
