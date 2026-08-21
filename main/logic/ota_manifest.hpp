#pragma once
// Extract the OTA manifest version and the optional version-bound changelog. IDF-free + host-tested.
//
// This is the ONE place a remote, attacker-influencable byte stream is parsed on this device, so it
// is pure logic with its own CHECKs rather than a strstr() in the download path. The manifest is
// fetched over TLS from the configured host, but the whole point of the downgrade gate
// (logic/version_cmp.hpp) is that the HOST ITSELF is in the threat model — so this parser assumes
// the bytes are hostile: it allocates nothing, never runs past `len`, and reports failure rather
// than producing a partial answer.
//
// Deliberately NOT a general JSON parser. It answers only the two narrow questions owned by these
// public OTA documents — the manifest version, and the sibling changelog's version plus text —
// because a DOM parser here would mean a large contiguous allocation on a heap whose binding limit
// is the largest contiguous free block (docs/ARCHITECTURE.md → Memory).
// The manifest it reads is written by scripts/ci-build-all.sh:
//
//     { "name": "daikin-altherma-esp32", "version": "1.0.0",
//       "new_install_prompt_erase": true, "builds": [ { "chipFamily": "ESP32-S3", ... } ] }
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace daik {

// Release notes are a separate sibling document rather than another field in manifest.json.  The
// installer manifest is already deliberately capped at 1 KiB on the OTA task stack; keeping the
// optional prose outside it preserves that security/heap boundary.  The firmware stores at most
// this much decoded UTF-8 text and never truncates a larger document into a plausible partial note.
constexpr size_t OTA_CHANGELOG_TEXT_MAX = 960;

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

// Decode the deliberately small JSON-string subset emitted by generate-ota-changelog.py.  Raw UTF-8
// bytes are copied unchanged; JSON quotes, slashes, newlines and tabs are unescaped.  \u escapes are
// rejected instead of growing a second Unicode implementation on the OTA attack surface — the
// publisher writes UTF-8 directly (`ensure_ascii=False`).
inline bool decode_text_string(const char* json, size_t len, size_t i,
                               char* out, size_t outlen, size_t& next) {
    if (!json || !out || outlen == 0 || i >= len || json[i] != '"') return false;
    out[0] = '\0';
    size_t written = 0;
    ++i;
    while (i < len && json[i] != '"') {
        unsigned char c = static_cast<unsigned char>(json[i++]);
        if (c < 0x20) return false;  // JSON forbids unescaped controls.
        if (c == '\\') {
            if (i >= len) return false;
            const char escaped = json[i++];
            switch (escaped) {
                case '"': c = '"'; break;
                case '\\': c = '\\'; break;
                case '/': c = '/'; break;
                case 'n': c = '\n'; break;
                case 't': c = '\t'; break;
                default: return false;
            }
        }
        if (written + 1 >= outlen) { out[0] = '\0'; return false; }
        out[written++] = static_cast<char>(c);
    }
    if (i >= len || json[i] != '"') { out[0] = '\0'; return false; }
    out[written] = '\0';
    next = i + 1;
    return written > 0;
}

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

// The production promotion gate binds one checked manifest to one downloaded application.  The
// device therefore needs the two manifest fields which identify that artifact, without allocating a
// JSON DOM on the OTA/TLS heap.  `app_sha256` is deliberately read only from the top-level
// provenance object; a same-named field in builds[] or another nested object cannot shadow it.
struct OtaManifestIdentity {
    char version[32] = {0};
    char app_sha256[65] = {0};
};

inline bool ota_sha256_hex_valid(const char* value) {
    if (!value) return false;
    for (size_t i = 0; i < 64; ++i) {
        const char c = value[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return value[64] == '\0';
}

inline bool ota_sha256_matches(const uint8_t actual[32], const char* expected_hex) {
    if (!actual || !ota_sha256_hex_valid(expected_hex)) return false;
    uint8_t different = 0;
    for (size_t i = 0; i < 32; ++i) {
        const auto nibble = [](char c) -> uint8_t {
            return c <= '9' ? static_cast<uint8_t>(c - '0')
                            : static_cast<uint8_t>(c - 'a' + 10);
        };
        const uint8_t expected = static_cast<uint8_t>((nibble(expected_hex[i * 2]) << 4) |
                                                      nibble(expected_hex[i * 2 + 1]));
        different |= static_cast<uint8_t>(actual[i] ^ expected);
    }
    return different == 0;
}

inline bool manifest_identity(const char* json, size_t len, OtaManifestIdentity& out) {
    out = {};
    if (!json) return false;

    int depth = 0;
    int provenance_depth = -1;
    bool have_version = false;
    bool have_provenance = false;
    bool have_sha = false;
    size_t i = 0;

    auto copy_plain_string = [&](size_t& pos, char* target, size_t capacity) -> bool {
        while (pos < len && detail::is_ws(json[pos])) ++pos;
        size_t start, end, next;
        if (!detail::scan_string(json, len, pos, start, end, next)) return false;
        const size_t value_len = end - start;
        if (value_len == 0 || value_len >= capacity) return false;
        for (size_t k = 0; k < value_len; ++k)
            if (json[start + k] == '\\') return false;
        std::memcpy(target, json + start, value_len);
        target[value_len] = '\0';
        pos = next;
        return true;
    };

    while (i < len) {
        const char c = json[i];
        if (c == '{' || c == '[') { ++depth; ++i; continue; }
        if (c == '}' || c == ']') {
            if (depth <= 0) return false;
            if (depth == provenance_depth) provenance_depth = -1;
            --depth;
            ++i;
            continue;
        }
        if (c != '"') { ++i; continue; }

        size_t key_start, key_end, next;
        if (!detail::scan_string(json, len, i, key_start, key_end, next)) return false;
        i = next;
        size_t colon = i;
        while (colon < len && detail::is_ws(json[colon])) ++colon;
        if (colon >= len || json[colon] != ':') continue;  // this string was a value
        i = colon + 1;

        const size_t key_len = key_end - key_start;
        if (depth == 1 && key_len == 7 &&
            std::memcmp(json + key_start, "version", 7) == 0) {
            if (have_version || !copy_plain_string(i, out.version, sizeof(out.version))) return false;
            have_version = true;
            continue;
        }
        if (depth == 1 && key_len == 10 &&
            std::memcmp(json + key_start, "provenance", 10) == 0) {
            if (have_provenance) return false;
            while (i < len && detail::is_ws(json[i])) ++i;
            if (i >= len || json[i] != '{') return false;
            have_provenance = true;
            provenance_depth = depth + 1;
            continue;  // leave the opening '{' for the depth tracker
        }
        if (depth == provenance_depth && key_len == 10 &&
            std::memcmp(json + key_start, "app_sha256", 10) == 0) {
            if (have_sha || !copy_plain_string(i, out.app_sha256, sizeof(out.app_sha256)) ||
                !ota_sha256_hex_valid(out.app_sha256)) return false;
            have_sha = true;
        }
    }
    return depth == 0 && have_version && have_provenance && have_sha;
}

// Parse the optional sibling changelog.json document:
//
//     {"version":"1.2.3-dev.4","changelog":"Add …\nFix …"}
//
// The version binds the prose to the artifact already accepted from manifest.json.  Notes are not
// part of the install authorization (generation + channel + version + SHA remain authoritative),
// but stale notes would still mislead the user at the decision point, so a mismatch fails closed.
// Missing, malformed, duplicate, escaped-version or oversized fields leave `out` empty and return
// false; callers then show the localized no-notes fallback without weakening the OTA offer.
inline bool manifest_changelog(const char* json, size_t len, const char* expected_version,
                               char* out, size_t outlen) {
    if (!json || !expected_version || !out || outlen == 0) return false;
    // Exact in-place decoding lets the OTA task reuse its temporary document slot until TLS is
    // cleaned up; production then retains only decoded_len+1 bytes. Decoded bytes start before the
    // value and never catch the input cursor. Do not erase json[0] before it has been scanned; every
    // failure path below still leaves out empty.
    if (out != json) out[0] = '\0';
    char version[32] = {0};
    bool have_version = false;
    bool have_changelog = false;
    size_t i = 0;

    auto copy_plain_string = [&](size_t& pos, char* target, size_t capacity) -> bool {
        while (pos < len && detail::is_ws(json[pos])) ++pos;
        size_t start, end, next;
        if (!detail::scan_string(json, len, pos, start, end, next)) return false;
        const size_t value_len = end - start;
        if (value_len == 0 || value_len >= capacity) return false;
        for (size_t k = 0; k < value_len; ++k)
            if (json[start + k] == '\\' || static_cast<unsigned char>(json[start + k]) < 0x20)
                return false;
        std::memcpy(target, json + start, value_len);
        target[value_len] = '\0';
        pos = next;
        return true;
    };

    // The publisher emits one flat object with exactly these two string fields. Parse that shape
    // strictly instead of merely counting any opening/closing bracket as equivalent: accepting
    // `{... ]`, a missing comma or trailing bytes would contradict the documented malformed-notes
    // fallback. Unknown fields fail closed as well; they are not part of this tiny public schema.
    while (i < len && detail::is_ws(json[i])) ++i;
    if (i >= len || json[i++] != '{') { out[0] = '\0'; return false; }
    while (true) {
        while (i < len && detail::is_ws(json[i])) ++i;
        if (i >= len || json[i] != '"') { out[0] = '\0'; return false; }
        size_t key_start, key_end, next;
        if (!detail::scan_string(json, len, i, key_start, key_end, next)) {
            out[0] = '\0';
            return false;
        }
        i = next;
        size_t colon = i;
        while (colon < len && detail::is_ws(json[colon])) ++colon;
        if (colon >= len || json[colon] != ':') { out[0] = '\0'; return false; }
        i = colon + 1;

        const size_t key_len = key_end - key_start;
        if (key_len == 7 && std::memcmp(json + key_start, "version", 7) == 0) {
            if (have_version || !copy_plain_string(i, version, sizeof(version))) {
                out[0] = '\0';
                return false;
            }
            have_version = true;
        } else if (key_len == 9 && std::memcmp(json + key_start, "changelog", 9) == 0) {
            if (have_changelog) { out[0] = '\0'; return false; }
            while (i < len && detail::is_ws(json[i])) ++i;
            if (!detail::decode_text_string(json, len, i, out, outlen, next)) {
                out[0] = '\0';
                return false;
            }
            i = next;
            have_changelog = true;
        } else { out[0] = '\0'; return false; }

        while (i < len && detail::is_ws(json[i])) ++i;
        if (i < len && json[i] == ',') { ++i; continue; }
        if (i < len && json[i] == '}') { ++i; break; }
        out[0] = '\0';
        return false;
    }

    while (i < len && detail::is_ws(json[i])) ++i;
    const bool valid = i == len && have_version && have_changelog &&
                       std::strcmp(version, expected_version) == 0;
    if (!valid) out[0] = '\0';
    return valid;
}

}  // namespace daik
