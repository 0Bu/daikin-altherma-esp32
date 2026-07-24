#pragma once
// Atomic config persistence (F02). The credential + service settings — WiFi credentials, the one-shot
// rollback backup + flags, MQTT, syslog, NTP and the board-local hardware (status indicator +
// recovery button, added in blob v2) — are serialized into ONE length-checked,
// CRC32-protected byte blob and written to a single NVS key ("cfg"). A single nvs_set_blob is atomic
// at the NVS entry level: either the whole new blob lands or the previous one remains. So a save is
// all-or-nothing across BOTH a mid-write NVS failure AND a power cut, with no per-key rollback and no
// write-ordering to get right (the old multi-commit save needed both, and still left a partial state
// on a rollback that could not complete — the F02 gap the reviewer flagged).
//
// Ownership: this blob is written by the httpd task ALONE (config_save), so the poll task can never
// revert a credential change. The RX/TX/proto LINK cache is deliberately NOT in here — it stays as
// separate self-healing keys written by both config_save and the poll task's config_save_link, and is
// re-validated on load (link_pins_safe). Keeping the two apart is what preserves the field-ownership
// model while making the credential/service half genuinely atomic.
//
// Pure + IDF-free so the serialize/deserialize round-trip and its corruption detection are host-tested
// (test/test_logic.cpp) rather than only exercised on a device.
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace daik {

// CRC-32/ISO-HDLC (reflected, poly 0xEDB88320) — the usual zlib/PNG CRC. Self-contained so the blob's
// integrity check is host-testable rather than reliant on esp_rom_crc32. CRC(b"123456789") == 0xCBF43926.
inline uint32_t config_crc32(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++)
            crc = (crc >> 1) ^ (0xEDB88320u & (~(crc & 1u) + 1u));   // mask = -(crc & 1), branchless
    }
    return crc ^ 0xFFFFFFFFu;
}

// The credential + service fields persisted as one atomic blob (NOT the RX/TX/proto link cache).
struct ConfigBlob {
    std::string wifi_ssid, wifi_pass;
    std::string wifi_ssid_backup, wifi_pass_backup;
    bool        wifi_rollback_active = false;
    bool        wifi_rolled_back     = false;
    std::string mqtt_uri, mqtt_user, mqtt_pass;
    std::string syslog_host;
    int32_t     syslog_port = 0;
    std::string ntp_server;
    // ── v2: board-local hardware (status indicator + recovery button) ────────────────────────────
    // In the blob rather than as separate keys because it has ONE owner, the httpd task (POST
    // /set_board), exactly like the credential fields — unlike the rx/tx/proto link cache, which
    // two tasks write and which therefore stays self-healing per-key. See config_model.hpp.
    int32_t     led_gpio       = -1;
    int32_t     led_type       = 0;
    int32_t     btn_gpio       = -1;
    bool        led_inverted   = false;
    bool        btn_active_low = true;
    // FALSE when the decoded blob predates v2, i.e. carries no board block at all. The caller must
    // then seed the board fields from the Kconfig defaults rather than from the members above:
    // a device OTA-upgraded from a pre-board build had its LED compiled in (XIAO: GPIO21,
    // active-low), and silently decoding "absent" would turn that user's working indicator off.
    // Absent is not the same as configured-off, and only the caller knows the compile-time default.
    bool        has_board = false;
};

inline constexpr uint8_t  CONFIG_BLOB_MAGIC0  = 'D', CONFIG_BLOB_MAGIC1 = 'K',
                          CONFIG_BLOB_MAGIC2  = 'C', CONFIG_BLOB_MAGIC3 = '1';
// v2 appended the board-local hardware block. Bumping the version rather than reusing v1 is what
// makes the trailing-garbage check below still exact per version; v1 blobs are ACCEPTED on read
// (see config_blob_deserialize) because rejecting them would drop a user's WiFi and MQTT
// credentials on the OTA that introduced the field — the fallback path is the legacy per-key
// layout, which a device written by a blob-era build has never populated.
inline constexpr uint8_t  CONFIG_BLOB_VERSION     = 2;
inline constexpr uint8_t  CONFIG_BLOB_VERSION_MIN = 1;
// A string field longer than this is treated as corruption on decode: real credentials are short, so a
// huge length is a garbled blob, not a value. Bounds the work and rejects a hostile/garbled length.
inline constexpr uint16_t CONFIG_BLOB_MAX_STR = 512;

namespace detail {
inline void blob_put_u16(std::vector<uint8_t>& v, uint16_t x) { v.push_back(x & 0xFF); v.push_back((x >> 8) & 0xFF); }
inline void blob_put_u32(std::vector<uint8_t>& v, uint32_t x) {
    v.push_back(x & 0xFF); v.push_back((x >> 8) & 0xFF); v.push_back((x >> 16) & 0xFF); v.push_back((x >> 24) & 0xFF);
}
inline void blob_put_str(std::vector<uint8_t>& v, const std::string& s) {
    blob_put_u16(v, static_cast<uint16_t>(s.size()));
    v.insert(v.end(), s.begin(), s.end());
}
}  // namespace detail

inline std::vector<uint8_t> config_blob_serialize(const ConfigBlob& c) {
    std::vector<uint8_t> v;
    v.push_back(CONFIG_BLOB_MAGIC0); v.push_back(CONFIG_BLOB_MAGIC1);
    v.push_back(CONFIG_BLOB_MAGIC2); v.push_back(CONFIG_BLOB_MAGIC3);
    v.push_back(CONFIG_BLOB_VERSION);
    detail::blob_put_str(v, c.wifi_ssid);
    detail::blob_put_str(v, c.wifi_pass);
    detail::blob_put_str(v, c.wifi_ssid_backup);
    detail::blob_put_str(v, c.wifi_pass_backup);
    v.push_back(static_cast<uint8_t>((c.wifi_rollback_active ? 1 : 0) | (c.wifi_rolled_back ? 2 : 0)));
    detail::blob_put_str(v, c.mqtt_uri);
    detail::blob_put_str(v, c.mqtt_user);
    detail::blob_put_str(v, c.mqtt_pass);
    detail::blob_put_str(v, c.syslog_host);
    detail::blob_put_u32(v, static_cast<uint32_t>(c.syslog_port));
    detail::blob_put_str(v, c.ntp_server);
    // v2 block. Always written — this build only ever SERIALIZES the current version; older
    // versions are a read-side concern.
    detail::blob_put_u32(v, static_cast<uint32_t>(c.led_gpio));
    detail::blob_put_u32(v, static_cast<uint32_t>(c.led_type));
    detail::blob_put_u32(v, static_cast<uint32_t>(c.btn_gpio));
    v.push_back(static_cast<uint8_t>((c.led_inverted ? 1 : 0) | (c.btn_active_low ? 2 : 0)));
    detail::blob_put_u32(v, config_crc32(v.data(), v.size()));   // CRC covers everything before it
    return v;
}

// Returns true ONLY if the blob is complete, well-formed, version-matched, in-bounds and CRC-valid.
// On any failure `out` is left untouched and the caller falls back to defaults / the legacy per-key
// layout — never a partial decode. This is the load-side half of the all-or-nothing guarantee.
inline bool config_blob_deserialize(const uint8_t* d, size_t n, ConfigBlob& out) {
    if (d == nullptr || n < 5 + 4) return false;   // magic(4)+version(1) + trailing crc(4)
    if (d[0] != CONFIG_BLOB_MAGIC0 || d[1] != CONFIG_BLOB_MAGIC1 ||
        d[2] != CONFIG_BLOB_MAGIC2 || d[3] != CONFIG_BLOB_MAGIC3) return false;
    const uint8_t version = d[4];
    if (version < CONFIG_BLOB_VERSION_MIN || version > CONFIG_BLOB_VERSION) return false;
    const uint32_t want = static_cast<uint32_t>(d[n - 4]) | (static_cast<uint32_t>(d[n - 3]) << 8) |
                          (static_cast<uint32_t>(d[n - 2]) << 16) | (static_cast<uint32_t>(d[n - 1]) << 24);
    if (config_crc32(d, n - 4) != want) return false;

    const size_t body_end = n - 4;   // exclusive of the trailing CRC
    size_t p = 5;
    ConfigBlob c;
    auto get_str = [&](std::string& s) -> bool {
        if (p + 2 > body_end) return false;
        const uint16_t len = static_cast<uint16_t>(d[p]) | (static_cast<uint16_t>(d[p + 1]) << 8);
        p += 2;
        if (len > CONFIG_BLOB_MAX_STR || p + len > body_end) return false;
        s.assign(reinterpret_cast<const char*>(d + p), len);
        p += len;
        return true;
    };
    auto get_u32 = [&](uint32_t& x) -> bool {
        if (p + 4 > body_end) return false;
        x = static_cast<uint32_t>(d[p]) | (static_cast<uint32_t>(d[p + 1]) << 8) |
            (static_cast<uint32_t>(d[p + 2]) << 16) | (static_cast<uint32_t>(d[p + 3]) << 24);
        p += 4;
        return true;
    };
    if (!get_str(c.wifi_ssid) || !get_str(c.wifi_pass) ||
        !get_str(c.wifi_ssid_backup) || !get_str(c.wifi_pass_backup)) return false;
    if (p + 1 > body_end) return false;
    const uint8_t flags = d[p++];
    uint32_t port = 0;
    if (!get_str(c.mqtt_uri) || !get_str(c.mqtt_user) || !get_str(c.mqtt_pass) ||
        !get_str(c.syslog_host) || !get_u32(port) || !get_str(c.ntp_server)) return false;
    if (version >= 2) {
        uint32_t led_gpio = 0, led_type = 0, btn_gpio = 0;
        if (!get_u32(led_gpio) || !get_u32(led_type) || !get_u32(btn_gpio)) return false;
        if (p + 1 > body_end) return false;
        const uint8_t board_flags = d[p++];
        c.led_gpio       = static_cast<int32_t>(led_gpio);
        c.led_type       = static_cast<int32_t>(led_type);
        c.btn_gpio       = static_cast<int32_t>(btn_gpio);
        c.led_inverted   = (board_flags & 1) != 0;
        c.btn_active_low = (board_flags & 2) != 0;
        c.has_board      = true;
    }
    // Exact per version: a v1 blob must END after ntp_server and a v2 blob after the board block.
    // Accepting a prefix would let a truncated v2 decode as a valid v1 with silently-default pins.
    if (p != body_end) return false;   // trailing garbage -> reject rather than accept a prefix
    c.wifi_rollback_active = (flags & 1) != 0;
    c.wifi_rolled_back     = (flags & 2) != 0;
    c.syslog_port          = static_cast<int32_t>(port);
    out = c;
    return true;
}

}  // namespace daik
