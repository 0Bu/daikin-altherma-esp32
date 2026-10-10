// Compile the actual flat encoder, then count only its payload allocation. Input keys come from
// the real native catalog; the vector and input strings are prepared before the watched call.
#include <cstdlib>
#include <iostream>
#include <new>
#include <string>
#include <vector>
#include "def/homehub.hpp"
#include HUB_FLAT_ENCODER

static bool   allocation_watch = false;
static size_t allocations      = 0;

void* operator new(size_t bytes) {
    if (allocation_watch) ++allocations;
    if (void* p = std::malloc(bytes ? bytes : 1)) return p;
    throw std::bad_alloc();
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, size_t) noexcept { std::free(p); }

int main() {
    using namespace daik;
    const std::vector<GroupedValue> sparse = {
        {"modbus", ha_slug(def::altherma4_find(54)->label), "0", PublishedKind::Number},
        {"modbus", ha_slug(def::altherma4_find(74)->label), "1.0", PublishedKind::Number},
        {"modbus", ha_slug(def::altherma4_find(80)->label), "1.0", PublishedKind::Number}};
    allocation_watch   = true;
    const auto payload = build_flat_json(sparse);
    allocation_watch   = false;
    std::cout << "{\"case\":\"flat-sparse-allocation-count\",\"value\":" << allocations << "}\n";
    bool oversize_refused = false;
    try {
        build_flat_json({{"modbus", "code", std::string(MODBUS_FLAT_JSON_MAX_BYTES, 'x'),
                          PublishedKind::Text}});
    } catch (const std::bad_alloc&) {
        oversize_refused = true;
    }
    std::cout << "{\"case\":\"flat-oversize-refused\",\"value\":"
              << (oversize_refused ? "true" : "false") << "}\n";
    return payload.size() == flat_json_size(sparse) ? 0 : 2;
}
