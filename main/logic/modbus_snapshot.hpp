#pragma once
// A Modbus cache belongs to the TCP session that produced it. `connected` alone cannot prove that:
// a snapshot may copy the previous session's cache immediately before a reconnect publishes the new
// socket as connected. The generation comparison closes that window without nesting the status and
// cache mutexes. Generation zero is reserved for "no session has committed data yet".
#include <cstdint>

namespace daik::logic {

inline bool modbus_cache_is_live(bool connected, uint32_t link_generation,
                                 uint32_t cache_generation) {
    return connected && link_generation != 0 && cache_generation == link_generation;
}

}  // namespace daik::logic
