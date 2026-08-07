#pragma once
// Atomic config persistence (F02). The credential + service settings — WiFi credentials, the one-shot
// rollback backup + flags, MQTT, syslog, NTP, board-local hardware (v2) and its explicit preset
// identity (v11) — are serialized into ONE length-checked,
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
    // ── v3: the OTA update channel (logic/ota_channel.hpp; 0 = release, 1 = dev) ─────────────────
    // Here for the same reason the board block is: ONE writer (the httpd task, POST /set_ota), so it
    // needs no self-healing per-key treatment. Which feed a device follows is a persistent user
    // choice — a board put on the dev channel must still be on it after a reboot, or every crash
    // would silently move it back to releases.
    int32_t     ota_channel = 0;
    // FALSE when the decoded blob predates v3 (no channel byte). Unlike has_board this needs no
    // Kconfig fallback — the pre-v3 world had exactly one feed, which IS the release channel — but
    // the caller still distinguishes "absent" from "explicitly release" for the diag line.
    bool        has_ota = false;
    // ── v4: the web-UI language override (logic/ui_lang.hpp; 0 = auto, 1 = de, 2 = en) ────────────
    // ONE writer (the httpd task, POST /set_lang), same as the channel and the board block. Auto by
    // default; a pre-v4 blob (no language byte) is read as auto, which is exactly right — the browser
    // kept auto-detecting before this setting existed, so absent means "keep letting the browser
    // decide" with no Kconfig fallback to consult.
    int32_t     ui_lang = 0;
    bool        has_lang = false;   // FALSE when the decoded blob predates v4 (no language byte)
    // ── v5: the HomeHub Modbus stack (issue #32) ─────────────────────────────────────────────────
    // Here for the same reason as the board block, the channel and the language: exactly ONE writer
    // (the httpd task, POST /set_hp), so no self-healing per-key treatment is needed.
    //
    // This is v5 and NOT v4 on purpose: this block and the UI-language byte were developed in
    // parallel and BOTH claimed v4. main's language byte landed first and is already on published
    // builds, so a device may well carry it — appending this as a second, different "v4" would
    // decode that byte as a HomeHub setting. Version numbers are an on-flash contract, so the later
    // block takes the later number.
    //
    // There is no "transport" field: the HomeHub is a SECOND source, not an alternative to X10A
    // (config_model.hpp). Current firmware uses mb_host alone: empty is disabled, non-empty is the
    // address to poll. `homehub_enabled` is retained only as a decoded/encoded v6 compatibility
    // mirror so the on-flash layout stays readable by the immediately preceding build.
    bool        homehub_enabled   = false;
    std::string mb_host;                // "" = disabled; discovery is an explicit UI action
    int32_t     mb_port           = 502;
    int32_t     mb_unit_id        = 1;
    // ── v7/v8/v13: one MQTT-backed reference-temperature source ───────────────────────────────
    std::string ref_temp_name, ref_temp_topic, ref_temp_path;
    // v8 adds the source timestamp mapping and the freshness limit. Defaults migrate a v7 blob
    // written by the hardware-tested capture slice without discarding its topic or credentials.
    std::string ref_temp_time_path;
    uint32_t    ref_temp_max_age_s = 600;
    // v13 appends control-readiness mappings at the END of the blob so every earlier version keeps
    // its byte-exact layout. Empty on v7-v12 migration: the old source remains observable but cannot
    // produce an eligible room error until a target mapping is explicitly saved.
    std::string ref_temp_setpoint_path;
    std::string ref_temp_enabled_path;
    std::string ref_temp_hvac_mode_path;
    bool        has_ref_temp = false;
    bool        has_ref_control = false;
    // ── v14: RETIRED controller-mode byte. The heating-curve diagnosis arms itself from its
    // required MQTT room source (config_model.hpp's heating_curve_diagnosis_armed), so there is no
    // mode to store; the optional forecast never gates sampling. The
    // byte keeps its place in the layout — the exact-length rule below is what refuses a truncated
    // newer blob, and shrinking v14 would make a v13 blob decode as one — and is written as zero and
    // ignored on read, exactly as the v9 actuation-consent bit is. `has_dynamic_lwt` stays as the
    // "this blob was at least v14" witness the migration tests read.
    bool        has_dynamic_lwt = false;
    // ── v15: independent MQTT power witness for the potable-water circulation pump ────────────
    std::string circulation_name, circulation_topic, circulation_power_path,
                circulation_time_path;
    uint32_t    circulation_max_age_s = 120;
    uint32_t    circulation_on_tenths_w = 30;
    uint32_t    circulation_off_tenths_w = 10;
    uint32_t    circulation_confirm_s = 60;
    bool        has_circulation = false;
    // ── v10: direct Open-Meteo location ────────────────────────────────────────────────────────
    bool        weather_enabled = false;
    int32_t     weather_latitude_e6 = 0;
    int32_t     weather_longitude_e6 = 0;
    bool        has_weather = false;
    // ── v11: optional ENV III I2C sensor ───────────────────────────────────────────────────────
    bool        env3_enabled = false;
    int32_t     env3_sda = 2;
    int32_t     env3_scl = 1;
    bool        has_env3 = false;
    // ── v12: explicit board-preset identity ─────────────────────────────────────────────────────
    // Stored atomically beside the v2 hardware block. 0 = Custom, 1 = AtomS3 Lite, 2 = XIAO;
    // board_user_set distinguishes deliberate Custom from untouched Kconfig defaults.
    int32_t     board_preset_id = 0;
    bool        board_user_set = false;
    bool        has_board_identity = false;
    // FALSE when the decoded blob predates v5 (no HomeHub block). The current empty-host default is
    // disabled, so an upgrade never starts LAN discovery without an explicit user action.
    bool        has_modbus = false;
    // FALSE when the decoded blob predates v2, i.e. carries no board block at all. The caller must
    // then seed the board fields from the Kconfig defaults rather than from the members above:
    // a device OTA-upgraded from a pre-board build had its LED compiled in (XIAO: GPIO21,
    // active-low), and silently decoding "absent" would turn that user's working indicator off.
    // Absent is not the same as configured-off, and only the caller knows the compile-time default.
    bool        has_board = false;
};

inline constexpr uint8_t  CONFIG_BLOB_MAGIC0  = 'D', CONFIG_BLOB_MAGIC1 = 'K',
                          CONFIG_BLOB_MAGIC2  = 'C', CONFIG_BLOB_MAGIC3 = '1';
// v2 appended the board-local hardware block, v3 the OTA update channel, v4 the UI language override,
// v5 the HomeHub Modbus stack, v6 its now-legacy enable compatibility bit, v7 one MQTT-backed
// reference-temperature mapping, v8 its source timestamp + maximum-age fields, and v9 activates the
// formerly inert actuation bit without changing the byte layout, and v10 the direct Open-Meteo
// location, v11 appends ENV III enable + SDA/SCL pins, and v12 appends the explicit board-preset id
// + selected flag, v13 appends room setpoint/enabled/HVAC mappings, and v14 appends one byte that
// carried the OFF/SHADOW dynamic-LWT mode and is now retired — written zero, ignored on read, since
// the diagnosis arms itself from its configured sources; v15 appends the independent circulation-
// pump MQTT power mapping. Current firmware
// derives HomeHub enabled solely from whether mb_host is empty;
// v5-v8 actuation bits decode OFF and every pre-v14 controller mode migrates OFF.
// Bumping the version rather than reusing the previous one is what makes the trailing-garbage check
// below still exact per version; OLDER blobs are ACCEPTED on read (see config_blob_deserialize)
// because rejecting them would drop a user's WiFi and MQTT credentials on the OTA that introduced the
// field — the fallback path is the legacy per-key layout, which a device written by a blob-era build
// has never populated.
inline constexpr uint8_t  CONFIG_BLOB_VERSION     = 15;
inline constexpr uint8_t  CONFIG_BLOB_VERSION_MIN = 1;
// A string field longer than this is treated as corruption on decode: real credentials are short, so a
// huge length is a garbled blob, not a value. Bounds the work and rejects a hostile/garbled length.
inline constexpr uint16_t CONFIG_BLOB_MAX_STR = 512;

// THE WRITE SIDE OF THAT SAME BOUND. The decoder rejects the WHOLE BLOB when any string exceeds it,
// so a serializer that writes one is not producing a slightly-wrong config — it is producing a config
// that cannot be read back at all, and the fallback is the legacy per-key layout a blob-era device has
// never populated. The board then boots into the setup portal having silently lost WiFi, MQTT, syslog,
// NTP, board hardware, OTA channel, language, ENV III, both MQTT sources and the weather location.
//
// It was reachable: every other string here is bounded by its own validator or by its route's body
// buffer, but `mb_host` was documented as "free text like syslog_host" while its route reads a 2048-byte
// body — so a >512-character HomeHub address saved with {"ok":true} and destroyed the config on the
// next boot. Checked HERE rather than only in validate() because this is where the constant that
// decides it lives: a bound enforced next to the decode rule it must agree with cannot drift from it,
// and a future field added to ConfigBlob is covered without anyone remembering to add a check.
// Every std::string in ConfigBlob, in declaration order. A new string field belongs in this list AND
// in test_config_blob_strings_fit()'s own field list, which is what proves the invariant this exists
// for (fit() ⟹ the blob round-trips). Stated precisely because the test cannot discover a member
// nobody added to it: C++ gives it no way to enumerate the struct, so the `== 21` pin catches a field
// dropped from the TEST, not one added to the STRUCT and forgotten in both places.
inline bool config_blob_strings_fit(const ConfigBlob& c) {
    for (const std::string* s : {
             &c.wifi_ssid, &c.wifi_pass, &c.wifi_ssid_backup, &c.wifi_pass_backup,
             &c.mqtt_uri, &c.mqtt_user, &c.mqtt_pass, &c.syslog_host, &c.ntp_server,
             &c.mb_host,
             &c.ref_temp_name, &c.ref_temp_topic, &c.ref_temp_path, &c.ref_temp_setpoint_path,
             &c.ref_temp_time_path, &c.ref_temp_enabled_path, &c.ref_temp_hvac_mode_path,
             &c.circulation_name, &c.circulation_topic, &c.circulation_power_path,
             &c.circulation_time_path })
        if (s->size() > CONFIG_BLOB_MAX_STR) return false;
    return true;
}

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
    // v3 block: the OTA channel, one byte (there are two feeds, not two billion).
    v.push_back(static_cast<uint8_t>(c.ota_channel & 0xFF));
    // v4 block: the UI language, one byte (auto/de/en, room to grow).
    v.push_back(static_cast<uint8_t>(c.ui_lang & 0xFF));
    // v5/v6 block: HomeHub transport fields. Bit1 remains populated as a compatibility mirror for
    // the short-lived v6 Auto/Manual/Off build, but current firmware derives it from the address.
    detail::blob_put_str(v, c.mb_host);
    detail::blob_put_u32(v, static_cast<uint32_t>(c.mb_port));
    detail::blob_put_u32(v, static_cast<uint32_t>(c.mb_unit_id));
    // Bit0 was the v9 actuation-consent flag. The write path is RETIRED (#294), so it is written
    // as 0 forever and ignored on decode; the byte itself stays so the blob layout is unchanged.
    v.push_back(static_cast<uint8_t>(!c.mb_host.empty() ? 2 : 0));
    detail::blob_put_str(v, c.ref_temp_name);
    detail::blob_put_str(v, c.ref_temp_topic);
    detail::blob_put_str(v, c.ref_temp_path);
    detail::blob_put_str(v, c.ref_temp_time_path);
    detail::blob_put_u32(v, c.ref_temp_max_age_s);
    detail::blob_put_u32(v, static_cast<uint32_t>(c.weather_latitude_e6));
    detail::blob_put_u32(v, static_cast<uint32_t>(c.weather_longitude_e6));
    v.push_back(c.weather_enabled ? 1u : 0u);
    v.push_back(c.env3_enabled ? 1 : 0);
    detail::blob_put_u32(v, static_cast<uint32_t>(c.env3_sda));
    detail::blob_put_u32(v, static_cast<uint32_t>(c.env3_scl));
    v.push_back(static_cast<uint8_t>(c.board_preset_id));
    v.push_back(c.board_user_set ? 1 : 0);
    // v13 block: appended after the v12 identity rather than inserted beside v8, preserving every
    // historical version's exact body. The timestamp remains in v8; these fields add eligibility.
    detail::blob_put_str(v, c.ref_temp_setpoint_path);
    detail::blob_put_str(v, c.ref_temp_enabled_path);
    detail::blob_put_str(v, c.ref_temp_hvac_mode_path);
    // v14 block: the retired controller-mode byte, always zero (see the field's comment above).
    v.push_back(0);
    // v15 block. Thresholds are tenths of watts to keep the persisted representation exact and
    // portable across host/newlib floating-point implementations.
    detail::blob_put_str(v, c.circulation_name);
    detail::blob_put_str(v, c.circulation_topic);
    detail::blob_put_str(v, c.circulation_power_path);
    detail::blob_put_str(v, c.circulation_time_path);
    detail::blob_put_u32(v, c.circulation_max_age_s);
    detail::blob_put_u32(v, c.circulation_on_tenths_w);
    detail::blob_put_u32(v, c.circulation_off_tenths_w);
    detail::blob_put_u32(v, c.circulation_confirm_s);
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
    if (version >= 3) {
        if (p + 1 > body_end) return false;
        c.ota_channel = static_cast<int32_t>(d[p++]);
        c.has_ota     = true;
    }
    if (version >= 4) {
        if (p + 1 > body_end) return false;
        c.ui_lang  = static_cast<int32_t>(d[p++]);
        c.has_lang = true;
    }
    if (version >= 5) {
        uint32_t mb_port = 0, mb_unit_id = 0;
        if (!get_str(c.mb_host) || !get_u32(mb_port) || !get_u32(mb_unit_id)) return false;
        if (p + 1 > body_end) return false;
        const uint8_t mb_flags = d[p++];
        c.mb_port           = static_cast<int32_t>(mb_port);
        c.mb_unit_id        = static_cast<int32_t>(mb_unit_id);
        // Bit0 (v9 actuation consent) is deliberately DISCARDED: the write path it gated no longer
        // exists (#294). Reading it back would resurrect consent for a capability the firmware has
        // dropped, so a stored 1 must not survive into any decoded config.
        (void)mb_flags;
        // Keep the legacy member coherent for round-trip diagnostics, but do not let either v5's
        // ambiguous bit or v6's short-lived Auto mode override the current empty-host rule.
        c.homehub_enabled   = !c.mb_host.empty();
        c.has_modbus        = true;
    }
    if (version >= 7) {
        if (!get_str(c.ref_temp_name) || !get_str(c.ref_temp_topic) ||
            !get_str(c.ref_temp_path)) return false;
        c.has_ref_temp = true;
    }
    if (version >= 8) {
        if (!get_str(c.ref_temp_time_path) || !get_u32(c.ref_temp_max_age_s)) return false;
    }
    if (version >= 10) {
        uint32_t latitude = 0, longitude = 0;
        if (!get_u32(latitude) || !get_u32(longitude) || p + 1 > body_end) return false;
        c.weather_latitude_e6 = static_cast<int32_t>(latitude);
        c.weather_longitude_e6 = static_cast<int32_t>(longitude);
        c.weather_enabled = d[p++] != 0;
        c.has_weather = true;
    }
    if (version >= 11) {
        if (p + 1 > body_end) return false;
        c.env3_enabled = d[p++] != 0;
        uint32_t sda = 0, scl = 0;
        if (!get_u32(sda) || !get_u32(scl)) return false;
        c.env3_sda = static_cast<int32_t>(sda);
        c.env3_scl = static_cast<int32_t>(scl);
        c.has_env3 = true;
    }
    if (version >= 12) {
        if (p + 2 > body_end) return false;
        c.board_preset_id = static_cast<int32_t>(d[p++]);
        c.board_user_set = d[p++] != 0;
        c.has_board_identity = true;
    }
    if (version >= 13) {
        if (!get_str(c.ref_temp_setpoint_path) || !get_str(c.ref_temp_enabled_path) ||
            !get_str(c.ref_temp_hvac_mode_path)) return false;
        c.has_ref_control = true;
    }
    if (version >= 14) {
        if (p + 1 > body_end) return false;
        p++;   // retired controller-mode byte, whatever it holds — arming is derived, not stored
        c.has_dynamic_lwt = true;
    }
    if (version >= 15) {
        if (!get_str(c.circulation_name) || !get_str(c.circulation_topic) ||
            !get_str(c.circulation_power_path) || !get_str(c.circulation_time_path) ||
            !get_u32(c.circulation_max_age_s) || !get_u32(c.circulation_on_tenths_w) ||
            !get_u32(c.circulation_off_tenths_w) || !get_u32(c.circulation_confirm_s)) return false;
        c.has_circulation = true;
    }
    // Exact per version: a v1 blob must END after ntp_server, a v2 blob after the board block, a v3
    // blob after the channel byte, a v4 blob after the language byte, v5/v6 after the HomeHub block
    // v7 after the reference-source strings, v8/v9 after timestamp/max-age, and v10 after the
    // Open-Meteo location, v11 after ENV III, v12 after the explicit board identity, v13 after the
    // three room-control mapping strings, v14 after its one retired byte, and v15 after the
    // circulation-pump source mapping and thresholds.
    // v6 and v9 change a flag's meaning without changing the HomeHub block's size, as does v14's
    // retirement of the mode byte — the LENGTH is the contract here, not what a byte still means.
    // Accepting a prefix would let a truncated v2 decode as a valid v1 with silently-default pins.
    if (p != body_end) return false;   // trailing garbage -> reject rather than accept a prefix
    c.wifi_rollback_active = (flags & 1) != 0;
    c.wifi_rolled_back     = (flags & 2) != 0;
    c.syslog_port          = static_cast<int32_t>(port);
    out = c;
    return true;
}

}  // namespace daik
