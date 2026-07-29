#pragma once
// A single queryable value — a row of
//   {registryID, offset, convId, dataSize, dataType, label}
// These rows are generated into main/def/*.hpp from Daikin's decoded value catalog by the offline
// generator (gen_profiles.py, maintained outside this repo). IDF-free so the host tests can use it.
#include <cstdint>

namespace daik {

struct ValueDef {
    uint8_t     reg;     // registry id, e.g. 0x61
    uint8_t     offset;  // byte offset within the register reply payload
    int         conv;    // converter id (see logic/convert.hpp)
    uint8_t     size;    // number of bytes
    int         type;    // dataType / HA unit code: 1=°C, 2=bar, 3=A, -1=generic
    const char* label;   // human label (English)

    // DETECT-ONLY row: the page exists on this model (so it must keep contributing to the profile's
    // detection signature) but the VALUE is an absent-feature placeholder that must never be
    // published. Defaults false, so every generated `{reg,offset,conv,size,type,label}` row is
    // unchanged; a flagged row is written `{…,label, true}`.
    //
    // WHY A FLAG AND NOT A DELETED ROW — this is the whole point, and deleting is the obvious wrong
    // move: a profile's detection signature IS the set of pages its rows reference
    // (def/signatures.hpp builds page_mask over ALL rows, this flag included), and detect_candidates
    // picks the profile with MAXIMAL page overlap (logic/detect.hpp). The unit really does answer the
    // page — that is why the placeholder is there — so a profile that drops the row loses a page and
    // is beaten by a feature-richer, WRONG profile that kept it: the model mis-detects and the same
    // garbage returns through the wrong table. Keeping the row preserves detection; the flag stops
    // only the publish (poll cache -> /values, MQTT state, HA discovery).
    bool        no_publish = false;
};

} // namespace daik
