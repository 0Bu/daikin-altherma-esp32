#pragma once
// A single queryable value — a row of
//   {registryID, offset, convId, dataSize, dataType, label}
// These rows are generated into main/def/*.hpp from Daikin's decoded value catalog by the offline
// generator (gen_profiles.py, maintained outside this repo). IDF-free so the host tests can use it.
// Curated manual profiles include def/overlay.hpp (page 0x10 supplement) and def/protocol_s.hpp
// (legacy Protocol S catalog); Modbus definitions live in def/homehub.hpp and def/altherma4.hpp.
#include <cstddef>
#include <cstdint>
#include <cstdlib>

namespace daik {

struct ValueDef {
    uint16_t conv : 10;  // converter id (see logic/convert.hpp)
    uint8_t  offset : 6; // byte offset within the register reply payload
    uint8_t  reg;        // registry id, e.g. 0x61
    uint8_t  size : 3;   // number of bytes
    int8_t   type : 4;   // dataType / HA unit code: 1=°C, 2=bar, 3=A, -1=generic

    // DETECT-ONLY row: the page exists on this model (so it must keep contributing to the profile's
    // detection signature) but the VALUE is an absent-feature placeholder that must never be
    // published. Defaults false, so every generated `{reg,offset,conv,size,type,label}` row is
    // unchanged; a flagged row is written `{…,label, true}`.
    //
    // WHY A FLAG AND NOT A DELETED ROW — this is the whole point, and deleting is the obvious wrong
    // move: a profile's detection signature IS the set of pages its rows reference
    // (def/signatures.hpp builds page_mask over ALL rows, this flag included), and
    // detect_candidates picks the profile with MAXIMAL page overlap (logic/detect.hpp). The unit
    // really does answer the page — that is why the placeholder is there — so a profile that drops
    // the row loses a page and is beaten by a feature-richer, WRONG profile that kept it: the model
    // mis-detects and the same garbage returns through the wrong table. Keeping the row preserves
    // detection; the flag stops only the publish (poll cache -> /values, MQTT state, HA discovery).
    bool no_publish : 1;
    // Store the scalars in one word and keep the label pointer naturally aligned.
    const char* label; // human label (English)

    constexpr ValueDef()
        : conv(0), offset(0), reg(0), size(0), type(0), no_publish(false), label(nullptr) {}

    static constexpr bool representable(int reg, int offset, int conv, int size, int type) {
        return reg >= 0 && reg <= 255 && offset >= 0 && offset <= 63 && conv >= 0 && conv <= 1023 &&
               size >= 0 && size <= 7 && type >= -8 && type <= 7;
    }

    constexpr ValueDef(int r, int o, int c, int s, int t, const char* l = nullptr, bool np = false)
        : conv(static_cast<uint16_t>(c)), offset(static_cast<uint8_t>(o)),
          reg(static_cast<uint8_t>(r)), size(static_cast<uint8_t>(s)), type(static_cast<int8_t>(t)),
          no_publish(np), label(l) {
        // Fail constant evaluation if a generated row exceeds the packed ranges. The dynamic
        // register probe validates its coordinates before creating a row.
        if (!representable(r, o, c, s, t)) std::abort();
    }
};

static_assert(offsetof(ValueDef, label) == alignof(const char*) &&
                  sizeof(ValueDef) == alignof(const char*) + sizeof(const char*),
              "catalog rows must retain natural compact alignment");

} // namespace daik
