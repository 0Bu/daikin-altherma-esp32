#pragma once
// Extract the "version" field from the OTA manifest. IDF-free + host-tested.
//
// This is the ONE place a remote, attacker-influencable byte stream is parsed on this device, so it
// is pure logic with its own CHECKs rather than a strstr() in the download path. The manifest is
// fetched over TLS from the configured host, but the whole point of the downgrade gate
// (logic/version_cmp.hpp) is that the HOST ITSELF is in the threat model — so this parser assumes
// the bytes are hostile: it allocates nothing, never runs past `len`, and reports failure rather
// than producing a partial answer.
//
// Deliberately NOT a general JSON parser. It answers exactly one question — what is the top-level
// "version" string? — because a DOM parser here would mean a large contiguous allocation on a heap
// whose binding limit is the largest contiguous free block (docs/ARCHITECTURE.md → Memory).
// The manifest it reads is written by scripts/ci-build-all.sh:
//
//     { "name": "daikin-altherma-esp32", "version": "1.0.0",
//       "new_install_prompt_erase": true, "builds": [ { "chipFamily": "ESP32-S3", ... } ] }
#include <cstddef>
#include <cstring>

namespace daik {

namespace detail {

// Advance past a JSON string whose opening quote is at json[i]. Returns the index just past the
// closing quote and reports the CONTENT bounds. Honours backslash escapes so a '"' inside a string
// value cannot be mistaken for the string's end — without which a crafted value like
// "\" , \"version\": \"9.9.9" would let an attacker inject a second, higher version.
inline bool scan_string(const char* json, size_t len, size_t i, size_t& content_start,
                        size_t& content_end, size_t& next) {
    if (i >= len || json[i] != '"') return false;
    content_start = ++i;
    while (i < len && json[i] != '"') {
        if (json[i] == '\\') ++i;   // skip the escaped byte, whatever it is
        ++i;
    }
    if (i >= len) return false;     // unterminated string -> truncated/corrupt manifest
    content_end = i;
    next        = i + 1;
    return true;
}

inline bool is_ws(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

}  // namespace detail

// Copy the TOP-LEVEL "version" string into `out` (NUL-terminated). Returns false — leaving out[0]
// = 0 — if the manifest is malformed, carries no top-level "version", or the value does not FIT.
//
// Two refusals worth stating outright, because both would otherwise be silent corruption:
//
//   • It does not TRUNCATE an oversized value. Truncating "1.10.0" to "1.1" yields a perfectly
//     well-formed version string that is ORDERED WRONG, which is precisely the failure the
//     downgrade gate exists to prevent. Too long => no answer.
//   • It rejects a value containing a backslash escape rather than unescaping it. A version with
//     an escape in it is not a version this device should install, and an unescaper here would be
//     new attack surface for no gain.
//
// `depth` tracking is what makes this "top-level": a "version" key nested inside builds[] (or any
// object an attacker can add) is ignored, so the field cannot be shadowed from below.
inline bool manifest_version(const char* json, size_t len, char* out, size_t outlen) {
    if (!json || !out || outlen == 0) return false;
    out[0] = 0;
    int    depth = 0;
    size_t i     = 0;
    while (i < len) {
        const char c = json[i];
        if (c == '{' || c == '[') { ++depth; ++i; continue; }
        if (c == '}' || c == ']') { --depth; ++i; continue; }
        if (c != '"')             { ++i; continue; }

        size_t ks, ke, next;
        if (!detail::scan_string(json, len, i, ks, ke, next)) return false;
        i = next;

        // A string is a KEY only when the next non-space byte is ':'. Anything else was a value,
        // already consumed above — which is what keeps a value of "version" from being read as one.
        size_t j = i;
        while (j < len && detail::is_ws(json[j])) ++j;
        if (j >= len || json[j] != ':') continue;
        i = j + 1;

        const size_t klen = ke - ks;
        if (depth != 1 || klen != 7 || std::memcmp(json + ks, "version", 7) != 0) continue;

        while (i < len && detail::is_ws(json[i])) ++i;
        size_t vs, ve;
        if (!detail::scan_string(json, len, i, vs, ve, next)) return false;   // not a string value
        const size_t vlen = ve - vs;
        if (vlen == 0 || vlen >= outlen) return false;                        // empty or won't fit
        for (size_t k = 0; k < vlen; ++k)
            if (json[vs + k] == '\\') return false;                           // see the note above
        std::memcpy(out, json + vs, vlen);
        out[vlen] = 0;
        return true;
    }
    return false;
}

}  // namespace daik
