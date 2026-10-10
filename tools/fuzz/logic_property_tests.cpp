// Deterministic, bounded property tests for hostile-input pure logic. This is intentionally not a
// second copy of test/test_logic.cpp: it explores prefixes and single-byte mutations under
// ASan+UBSan, while the ordinary host suite owns exact behavioral examples and line coverage.
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include "logic/history_persist.hpp"
#include "logic/http_body.hpp"
#include "logic/http_request.hpp"
#include "logic/modbus.hpp"
#include "logic/mqtt_uri.hpp"
#include "logic/ota_changelog_range.hpp"
#include "logic/ota_manifest.hpp"

namespace {

using namespace daik;

const char* g_target = "startup";
std::size_t g_checks = 0;

[[noreturn]] void fail(const char* condition, int line) {
    std::fprintf(stderr, "property test failure [%s] check %zu, line %d: %s\n", g_target, g_checks,
                 line, condition);
    std::abort();
}

#define REQUIRE(condition)                                                                         \
    do {                                                                                           \
        ++g_checks;                                                                                \
        if (!(condition)) fail(#condition, __LINE__);                                              \
    } while (0)

std::size_t checked_string_length(const char* value, std::size_t capacity) {
    std::size_t length = 0;
    while (length < capacity && value[length] != '\0') ++length;
    REQUIRE(length < capacity);
    return length;
}

void exercise_manifest_input(const char* bytes, std::size_t length, bool test_in_place = false) {
    for (const std::size_t capacity :
         {std::size_t{1}, std::size_t{2}, std::size_t{8}, std::size_t{32}, std::size_t{65}}) {
        std::array<char, 65> version{};
        version.fill(static_cast<char>(0x5a));
        const bool version_ok = manifest_version(bytes, length, version.data(), capacity);
        if (version_ok) {
            const std::size_t version_length = checked_string_length(version.data(), capacity);
            REQUIRE(version_length > 0);
            REQUIRE(std::memchr(version.data(), '\\', version_length) == nullptr);
        } else {
            REQUIRE(version[0] == '\0');
        }
    }

    OtaManifestIdentity identity{};
    const bool          identity_ok = manifest_identity(bytes, length, identity);
    if (identity_ok) {
        REQUIRE(checked_string_length(identity.version, sizeof(identity.version)) > 0);
        REQUIRE(checked_string_length(identity.app_sha256, sizeof(identity.app_sha256)) == 64);
        REQUIRE(ota_sha256_hex_valid(identity.app_sha256));
    } else {
        // A late failure may retain a bounded partial field for diagnostics; it must never lose
        // termination or be mistaken for a successful identity.
        (void)checked_string_length(identity.version, sizeof(identity.version));
        (void)checked_string_length(identity.app_sha256, sizeof(identity.app_sha256));
    }

    std::array<char, 128> changelog{};
    changelog.fill(static_cast<char>(0x5a));
    const bool changelog_ok =
        manifest_changelog(bytes, length, "1.2.3", changelog.data(), changelog.size());
    if (changelog_ok) {
        REQUIRE(checked_string_length(changelog.data(), changelog.size()) > 0);
    } else {
        REQUIRE(changelog[0] == '\0');
    }

    if (test_in_place) {
        // The parser explicitly supports decoding the changelog into the input buffer. ASan checks
        // the tight len+1 allocation. This expensive allocation is sampled once per seed; the
        // allocation-free parsers still see every prefix and mutation below.
        std::vector<char> in_place(length + 1, '\0');
        if (length != 0) std::memcpy(in_place.data(), bytes, length);
        const bool in_place_ok =
            manifest_changelog(in_place.data(), length, "1.2.3", in_place.data(), in_place.size());
        if (in_place_ok) {
            REQUIRE(checked_string_length(in_place.data(), in_place.size()) > 0);
        } else {
            REQUIRE(in_place[0] == '\0');
        }
    }
}

void test_manifest_properties() {
    g_target = "ota-manifest";
    const std::string identity_seed =
        R"({"version":"1.2.3","provenance":{"app_sha256":")"
        R"(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}})";
    const std::vector<std::string> seeds = {
        identity_seed,
        R"({"builds":[{"version":"9.9.9"}],"version":"1.2.3"})",
        R"({"version":"1.2.3","changelog":"safe\nnotes"})",
        R"({"version":"1.2.3","provenance":{"app_sha256":"A"}})",
        R"({"version":null,"provenance":{"app_sha256":false},"changelog":[]})",
        R"({"version":"\" , \"version\": \"9.9.9"})",
        R"({"version":"1.2.3","changelog":"unterminated})",
        std::string(256, '"'),
    };
    constexpr std::array<unsigned char, 12> replacements = {
        0x00, 0x09, 0x0a, 0x22, 0x2c, 0x3a, 0x5b, 0x5c, 0x5d, 0x7b, 0x7d, 0xff,
    };

    for (const std::string& seed : seeds) {
        exercise_manifest_input(seed.data(), seed.size(), true);
        for (std::size_t sample = 0; sample <= 16; ++sample) {
            const std::size_t prefix = seed.size() * sample / 16;
            exercise_manifest_input(seed.data(), prefix);
        }
        std::string mutated = seed;
        for (std::size_t sample = 0; sample < 8 && !seed.empty(); ++sample) {
            const std::size_t   offset      = (seed.size() - 1) * sample / 7;
            const unsigned char replacement = replacements[sample % replacements.size()];
            mutated[offset]                 = static_cast<char>(replacement);
            exercise_manifest_input(mutated.data(), mutated.size());
            mutated[offset] = seed[offset];
        }
        for (std::size_t sample = 0; sample < 3 && !seed.empty(); ++sample) {
            const std::size_t offset = (seed.size() - 1) * sample / 2;
            for (const unsigned char replacement : replacements) {
                mutated[offset] = static_cast<char>(replacement);
                exercise_manifest_input(mutated.data(), mutated.size());
                mutated[offset] = seed[offset];
            }
        }
    }

    // Exhaust the JSON-forbidden raw control range at the security-sensitive version field. This
    // is the exact property that found the embedded-NUL truncation bug while this gate was built.
    const std::size_t version_offset = identity_seed.find("1.2.3");
    REQUIRE(version_offset != std::string::npos);
    for (unsigned control = 0; control < 0x20; ++control) {
        std::string mutated         = identity_seed;
        mutated[version_offset + 2] = static_cast<char>(control);
        std::array<char, 32> version{};
        REQUIRE(!manifest_version(mutated.data(), mutated.size(), version.data(), version.size()));
        REQUIRE(version[0] == '\0');
        OtaManifestIdentity identity{};
        REQUIRE(!manifest_identity(mutated.data(), mutated.size(), identity));
    }
}

void exercise_changelog_range_input(const std::string& input) {
    std::vector<char> buffer(input.begin(), input.end());
    buffer.push_back('\0');
    const OtaChangelogRangeResult result =
        ota_changelog_select_range(buffer.data(), "1.0.3-dev.17", "1.0.3-dev.20");
    if (result == OtaChangelogRangeResult::Invalid) {
        REQUIRE(buffer[0] == '\0');
    } else {
        REQUIRE(checked_string_length(buffer.data(), buffer.size()) <= input.size());
    }
}

void test_changelog_range_properties() {
    g_target                   = "ota-changelog-range";
    const std::string valid    = "v1.0.3-dev.15 — Hard-reset ESP32-S3 after serial flash\n"
                                 "v1.0.3-dev.17 — Fix OTA stress HTTP handoff\n"
                                 "v1.0.3-dev.18 — Maintenance and reliability improvements.\n"
                                 "v1.0.3-dev.19 — Preserve legacy bench restore compatibility\n"
                                 "v1.0.3-dev.20 — Accept exact legacy writer evidence";
    const std::string expected = "v1.0.3-dev.18 — Maintenance and reliability improvements.\n"
                                 "v1.0.3-dev.19 — Preserve legacy bench restore compatibility\n"
                                 "v1.0.3-dev.20 — Accept exact legacy writer evidence";
    std::vector<char> selected(valid.begin(), valid.end());
    selected.push_back('\0');
    REQUIRE(ota_changelog_select_range(selected.data(), "1.0.3-dev.17", "1.0.3-dev.20") ==
            OtaChangelogRangeResult::Selected);
    REQUIRE(std::string_view(selected.data()) == expected);

    const std::vector<std::string> seeds = {
        valid,
        "Target-only legacy note",
        "v1.0.3-dev.20 — One target note",
        "v1.0.3-dev.20 — First target note\nv1.0.3-dev.20 — Second target note",
        "v1.0.3-dev.20 — Later\nv1.0.3-dev.19 — Earlier",
        "v1.0.3-dev.20 — Valid\nlegacy line",
        "v1.0.3-dev.x — Invalid",
    };
    constexpr std::array<unsigned char, 12> replacements = {
        0x00, 0x09, 0x0a, 0x0d, 0x20, 0x2d, 0x2e, 0x76, 0x7f, 0x80, 0x94, 0xff,
    };
    for (const std::string& seed : seeds) {
        exercise_changelog_range_input(seed);
        for (std::size_t prefix = 0; prefix <= seed.size(); ++prefix)
            exercise_changelog_range_input(seed.substr(0, prefix));
        for (std::size_t offset = 0; offset < seed.size(); ++offset) {
            for (const unsigned char replacement : replacements) {
                std::string mutated = seed;
                mutated[offset]     = static_cast<char>(replacement);
                exercise_changelog_range_input(mutated);
            }
        }
    }
}

void exercise_modbus_response(const std::vector<uint8_t>& adu, uint16_t transaction, uint8_t unit,
                              MbFunc function, uint16_t quantity) {
    MbResponse     response{};
    const uint8_t* data   = adu.empty() ? nullptr : adu.data();
    const MbParse  result = mb_parse_response(data, static_cast<int>(adu.size()), transaction, unit,
                                              function, quantity, response);
    uint16_t       value  = 0xa55a;
    if (result == MbParse::Ok) {
        REQUIRE(response.ok);
        REQUIRE(!response.exception);
        REQUIRE(response.payload != nullptr);
        REQUIRE(response.payload_len >= 0 && response.payload_len % 2 == 0);
        REQUIRE(response.payload_len == static_cast<int>(quantity) * 2);
        const auto begin   = reinterpret_cast<std::uintptr_t>(adu.data());
        const auto end     = begin + adu.size();
        const auto payload = reinterpret_cast<std::uintptr_t>(response.payload);
        REQUIRE(payload >= begin);
        REQUIRE(payload + static_cast<std::size_t>(response.payload_len) <= end);
        REQUIRE(mb_reg_count(response) == static_cast<int>(quantity));
        for (int index = 0; index < mb_reg_count(response); ++index) {
            REQUIRE(mb_reg_at(response, index, value));
            const uint8_t* expected = response.payload + index * 2;
            REQUIRE(value == mb_get_u16(expected));
        }
        REQUIRE(!mb_reg_at(response, -1, value));
        REQUIRE(!mb_reg_at(response, mb_reg_count(response), value));
    } else if (result == MbParse::Exception) {
        REQUIRE(!response.ok);
        REQUIRE(response.exception);
        REQUIRE(response.payload == nullptr);
        REQUIRE(response.payload_len == 0);
    } else {
        REQUIRE(!response.ok);
        REQUIRE(!mb_reg_at(response, 0, value));
    }
}

std::vector<uint8_t> valid_modbus_response(uint16_t transaction, uint8_t unit, MbFunc function,
                                           uint16_t quantity) {
    const std::size_t    byte_count = static_cast<std::size_t>(quantity) * 2;
    std::vector<uint8_t> adu(MBAP_LEN + 2 + byte_count, 0);
    mb_put_u16(adu.data(), transaction);
    mb_put_u16(adu.data() + 2, 0);
    mb_put_u16(adu.data() + 4, static_cast<uint16_t>(3 + byte_count));
    adu[6] = unit;
    adu[7] = static_cast<uint8_t>(function);
    adu[8] = static_cast<uint8_t>(byte_count);
    for (std::size_t i = 0; i < byte_count; ++i)
        adu[9 + i] = static_cast<uint8_t>((i * 37U + quantity) & 0xffU);
    return adu;
}

void test_modbus_properties() {
    g_target                       = "modbus";
    constexpr uint16_t transaction = 0x4a31;
    constexpr uint8_t  unit        = 7;
    for (uint16_t quantity = 1; quantity <= 16; ++quantity) {
        std::vector<uint8_t> canonical =
            valid_modbus_response(transaction, unit, MbFunc::ReadInput, quantity);
        exercise_modbus_response(canonical, transaction, unit, MbFunc::ReadInput, quantity);
        for (std::size_t offset = 0; offset < canonical.size(); ++offset) {
            for (const uint8_t mask : {uint8_t{0x01}, uint8_t{0x80}, uint8_t{0xff}}) {
                canonical[offset] ^= mask;
                exercise_modbus_response(canonical, transaction, unit, MbFunc::ReadInput, quantity);
                canonical[offset] ^= mask;
            }
        }
    }

    for (std::size_t length = 0; length <= static_cast<std::size_t>(MB_ADU_MAX + 8); ++length) {
        std::vector<uint8_t> bytes(length);
        for (std::size_t i = 0; i < length; ++i)
            bytes[i] = static_cast<uint8_t>((length * 29U + i * 71U) & 0xffU);
        exercise_modbus_response(bytes, static_cast<uint16_t>(length * 13U),
                                 static_cast<uint8_t>(length), MbFunc::ReadHolding,
                                 static_cast<uint16_t>(length % (MB_MAX_READ_REGS + 1)));
    }

    std::array<uint8_t, 20> request{};
    for (std::size_t capacity = 0; capacity <= request.size(); ++capacity) {
        request.fill(0xa5);
        const int built = mb_build_read(request.data(), capacity, transaction, unit,
                                        MbFunc::ReadHolding, 0x1234, 4);
        if (capacity < 12) {
            REQUIRE(built == -1);
            for (const uint8_t byte : request) REQUIRE(byte == 0xa5);
        } else {
            REQUIRE(built == 12);
            for (std::size_t i = 12; i < request.size(); ++i) REQUIRE(request[i] == 0xa5);
        }
    }
}

void exercise_mqtt_uri(const std::string& input) {
    std::string host  = "sentinel";
    int         port  = -1;
    bool        tls   = false;
    const char* error = nullptr;
    if (!parse_mqtt_uri(input, host, port, tls, &error)) {
        REQUIRE(error != nullptr);
        return;
    }
    REQUIRE(!host.empty());
    REQUIRE(port >= 1 && port <= 65535);
    REQUIRE(error == nullptr);

    // A successful result must survive a canonical raw-MQTT URI round trip. Skip exotic
    // colon-bearing unbracketed hosts; the production parser intentionally treats their final
    // colon as a port separator.
    if (host.find(':') == std::string::npos ||
        (host.front() == '[' && host.find(']') != std::string::npos)) {
        const std::string canonical =
            std::string(tls ? "mqtts://" : "mqtt://") + host + ":" + std::to_string(port);
        std::string roundtrip_host;
        int         roundtrip_port = 0;
        bool        roundtrip_tls  = false;
        REQUIRE(parse_mqtt_uri(canonical, roundtrip_host, roundtrip_port, roundtrip_tls));
        REQUIRE(roundtrip_host == host);
        REQUIRE(roundtrip_port == port);
        REQUIRE(roundtrip_tls == tls);
    }
}

void test_mqtt_uri_properties() {
    g_target                             = "mqtt-uri";
    const std::vector<std::string> seeds = {
        "broker",         "broker:1883",      "mqtt://broker:1883",
        "mqtts://broker", "ws://broker/mqtt", "wss://broker:8084/mqtt",
        "mqtt://[::1]",   "mqtt://:1883",     "mqtt://broker:65536",
        "scheme-only://", "mqtt://broker:-1", std::string(256, '9'),
    };
    constexpr std::array<unsigned char, 10> replacements = {
        0x00, 0x09, 0x2f, 0x30, 0x39, 0x3a, 0x5b, 0x5d, 0x7f, 0xff,
    };
    for (const std::string& seed : seeds) {
        exercise_mqtt_uri(seed);
        for (std::size_t sample = 0; sample <= 12; ++sample)
            exercise_mqtt_uri(seed.substr(0, seed.size() * sample / 12));
        std::string mutated = seed;
        for (std::size_t sample = 0; sample < 12 && !seed.empty(); ++sample) {
            const std::size_t offset = (seed.size() - 1) * sample / 11;
            mutated[offset] = static_cast<char>(replacements[sample % replacements.size()]);
            exercise_mqtt_uri(mutated);
            mutated[offset] = seed[offset];
        }
        for (std::size_t sample = 0; sample < 3 && !seed.empty(); ++sample) {
            const std::size_t offset = (seed.size() - 1) * sample / 2;
            for (const unsigned char replacement : replacements) {
                mutated[offset] = static_cast<char>(replacement);
                exercise_mqtt_uri(mutated);
                mutated[offset] = seed[offset];
            }
        }
    }
    for (int digits = 1; digits <= 32; ++digits)
        exercise_mqtt_uri("mqtt://broker:" + std::string(static_cast<std::size_t>(digits), '9'));
}

void test_http_properties() {
    g_target                                = "http";
    constexpr std::string_view     hostname = "daikin-altherma-esp32";
    constexpr std::string_view     wifi     = "192.0.2.10";
    constexpr std::string_view     ethernet = "198.51.100.20";
    const std::vector<std::string> seeds    = {
        "daikin-altherma-esp32.local",
        "DAIKIN-ALTHERMA-ESP32.LOCAL:80",
        "192.0.2.10",
        "http://192.0.2.10",
        "application/json; charset=utf-8",
        "text/plain",
        "user@192.0.2.10",
        "[192.0.2.10]",
        "same-origin",
    };
    constexpr std::array<char, 8> replacements = {'\0', '/', '@', ':', '[', ']', 'A', ' '};
    for (const std::string& seed : seeds) {
        for (std::size_t prefix = 0; prefix <= seed.size(); ++prefix) {
            const std::string value = seed.substr(0, prefix);
            REQUIRE(http_ascii_iequal(value, value));
            const bool allowed = http_authority_allowed(value, hostname, wifi, ethernet);
            if (allowed) {
                std::string_view normalized = value;
                if (normalized.size() > 3 && normalized.substr(normalized.size() - 3) == ":80")
                    normalized.remove_suffix(3);
                const bool known = normalized == wifi || normalized == ethernet ||
                                   http_ascii_iequal(normalized, "daikin-altherma-esp32.local");
                REQUIRE(known);
            }
            (void)http_origin_allowed(value, hostname, wifi, ethernet);
            (void)http_json_content_type(value);
        }
        for (std::size_t offset = 0; offset < seed.size(); ++offset) {
            for (const char replacement : replacements) {
                std::string mutated = seed;
                mutated[offset]     = replacement;
                REQUIRE(http_ascii_iequal(mutated, mutated));
                (void)http_authority_allowed(mutated, hostname, wifi, ethernet);
                (void)http_origin_allowed(mutated, hostname, wifi, ethernet);
                (void)http_json_content_type(mutated);
            }
        }
    }

    const std::string payload = "{\"mqtt_uri\":\"mqtts://broker\"}";
    for (std::size_t chunk_size = 1; chunk_size <= payload.size(); ++chunk_size) {
        std::array<char, 96> output{};
        std::size_t          cursor = 0;
        int                  calls  = 0;
        const int            received =
            http_body_read(output.data(), output.size(), payload.size(),
                           [&](char* destination, std::size_t remaining) -> BodyChunk {
                               ++calls;
                               if (calls % 4 == 1) return {BodyRecv::Timeout, 0};
                               const std::size_t count =
                                   remaining < chunk_size ? remaining : chunk_size;
                               std::memcpy(destination, payload.data() + cursor, count);
                               cursor += count;
                               return {BodyRecv::Data, count};
                           });
        REQUIRE(received == static_cast<int>(payload.size()));
        REQUIRE(cursor == payload.size());
        REQUIRE(std::string_view(output.data(), payload.size()) == payload);
        REQUIRE(output[payload.size()] == '\0');
    }

    std::array<char, 8> stalled{};
    int                 timeouts = 0;
    REQUIRE(http_body_read(stalled.data(), stalled.size(), 4, [&](char*, std::size_t) -> BodyChunk {
                ++timeouts;
                return {BodyRecv::Timeout, 0};
            }) == -1);
    REQUIRE(timeouts == BODY_MAX_IDLE + 1);
    REQUIRE(http_body_read(stalled.data(), stalled.size(), 4,
                           [](char*, std::size_t remaining) -> BodyChunk {
                               return {BodyRecv::Data, remaining + 1};
                           }) == -1);
}

// The liveness record and the age guards read bytes that survived a reset in DRAM, so an image of
// arbitrary content is the hostile input: it must never be mistaken for a record, and a record that
// does verify must never turn extreme instants into signed overflow.
void test_history_liveness_properties() {
    using namespace daik::logic;
    std::uint64_t state = 0x9e3779b97f4a7c15ull;
    const auto    next  = [&state]() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        return state;
    };
    const std::int64_t extremes[]                          = {INT64_MIN,
                                                              INT64_MIN + 1,
                                                              -1'000'000'000'000'000'000LL,
                                                              -1,
                                                              0,
                                                              1,
                                                              1'000'000,
                                                              299'999'999,
                                                              300'000'000,
                                                              330'000'000,
                                                              4'611'686'018'427'387'904LL,
                                                              INT64_MAX - 1,
                                                              INT64_MAX};
    const bool         combos[8][HISTORY_LIVENESS_RASTERS] = {
        {false, false, false}, {true, false, false}, {false, true, false}, {true, true, false},
        {false, false, true},  {true, false, true},  {false, true, true},  {true, true, true}};

    // Arbitrary bytes do not verify; a flipped bit in a sealed record's covered fields does not
    // either, and the code never reports a record it could not have written as current.
    for (int i = 0; i < 4000; ++i) {
        HistoryLiveness image;
        auto*           bytes = reinterpret_cast<std::uint8_t*>(&image);
        for (std::size_t b = 0; b < sizeof(image); ++b)
            bytes[b] = static_cast<std::uint8_t>(next());
        REQUIRE(!history_liveness_valid(image));
        for (const auto& weighed : combos) {
            const HistoryRasterPlan plan = history_raster_plan(image, weighed);
            for (std::size_t i = 0; i < HISTORY_LIVENESS_RASTERS; ++i)
                REQUIRE(plan.state[i] == (weighed[i] ? HistoryRasterState::NoRecord
                                                     : HistoryRasterState::NotWeighed));
            // A record that is not one measures no raster that is asked about, and for none
            // that is not asked about it never makes the answer worse.
            REQUIRE(plan.region_bookable == !weighed[0]);
            REQUIRE(plan.retire_modbus == weighed[1] && plan.retire_env3 == weighed[2]);
        }
    }
    for (int i = 0; i < 400; ++i) {
        HistoryLiveness sealed;
        std::memset(&sealed, 0, sizeof(sealed));
        sealed.sign_us = extremes[next() % (sizeof(extremes) / sizeof(extremes[0]))];
        for (auto& c : sealed.commit_us)
            c = (next() & 1) ? extremes[next() % (sizeof(extremes) / sizeof(extremes[0]))]
                             : static_cast<std::int64_t>(next() >> 20);
        history_liveness_seal(sealed);
        REQUIRE(history_liveness_valid(sealed));
        // Every state is reachable and none of them overflows, whatever the instants.
        for (const auto& weighed : combos) {
            const HistoryRasterPlan plan = history_raster_plan(sealed, weighed);
            for (std::size_t i = 0; i < HISTORY_LIVENESS_RASTERS; ++i) {
                const HistoryRasterState state = plan.state[i];
                if (!weighed[i]) {
                    REQUIRE(state == HistoryRasterState::NotWeighed);
                } else {
                    REQUIRE(state == HistoryRasterState::Measurable ||
                            state == HistoryRasterState::NoCommit ||
                            state == HistoryRasterState::NoRecord);
                    if (sealed.sign_us == INT64_MIN) REQUIRE(state == HistoryRasterState::NoRecord);
                    // No commit recorded, one before the clock started, or one after the last
                    // sign of life measures nothing; every other record is measurable, however
                    // long ago the raster committed (there is no staleness bound).
                    const bool usable = sealed.sign_us != INT64_MIN && sealed.commit_us[i] >= 0 &&
                                        sealed.sign_us >= sealed.commit_us[i];
                    REQUIRE((state == HistoryRasterState::Measurable) == usable);
                }
            }
            // The X10A raster alone decides the region; the others retire their own rings only.
            REQUIRE(plan.region_bookable == history_raster_bookable(plan.state[0]));
            REQUIRE(plan.retire_modbus == !history_raster_bookable(plan.state[1]));
            REQUIRE(plan.retire_env3 == !history_raster_bookable(plan.state[2]));
        }
        // A raster nobody asks about never makes the answer worse.
        {
            const HistoryRasterPlan none = history_raster_plan(sealed, combos[0]);
            REQUIRE(none.region_bookable && !none.retire_modbus && !none.retire_env3);
        }
        for (std::size_t b = 0; b < sizeof(sealed); ++b) {
            // A flipped bit anywhere the CRC covers (magic, version, the instants, the CRC itself)
            // invalidates the record. The reserved word and the tail padding are not evidence.
            HistoryLiveness damaged = sealed;
            reinterpret_cast<std::uint8_t*>(&damaged)[b] ^= 0x10;
            const bool evidence = b < offsetof(HistoryLiveness, reserved) ||
                                  (b >= offsetof(HistoryLiveness, sign_us) &&
                                   b < offsetof(HistoryLiveness, crc) + sizeof(sealed.crc));
            REQUIRE(history_liveness_valid(damaged) == !evidence);
        }
    }

    // The instants helpers take any clock reading, including ones no monotonic clock produces.
    for (const std::int64_t now_us : extremes) {
        for (const std::uint32_t dt : {0u, 1u, 300u, 0xffffffffu}) {
            const std::int64_t boundary = history_raster_boundary_us(now_us, dt);
            REQUIRE(boundary >= 0);
            REQUIRE(boundary <= (now_us < 0 ? 0 : now_us));
            if (dt != 0 && now_us >= 0) {
                // On the grid, and the last grid point at or before now.
                const std::int64_t step = static_cast<std::int64_t>(dt) * 1000000;
                REQUIRE(boundary % step == 0);
                REQUIRE(now_us - boundary < step);
            }
        }
        for (const std::int64_t commit_us : extremes) {
            for (const std::int64_t unix_s :
                 {INT64_C(0), INT64_C(1'786'459'116), INT64_C(-5), INT64_C(4'000'000'000)}) {
                const std::int64_t anchor = history_anchor_bucket(unix_s, now_us, commit_us);
                if (commit_us == INT64_MIN)
                    REQUIRE(anchor == INT64_MIN);
                else
                    REQUIRE(anchor <= history_bucket_from_unix(unix_s) + 0);
            }
        }
    }

    // The booked stretch: whatever the instants and the carried remainder, never above the cap,
    // never a wrapped value, zero when nothing was measured, never fewer for a longer stretch, and
    // a remainder that stays inside half a bucket whenever old content is left to keep in place.
    const std::int32_t carries[] = {INT32_MIN, -150'000'000, -1, 0, 1, 149'999'999, INT32_MAX};
    for (const std::int64_t sign_us : extremes)
        for (const std::int64_t commit_us : extremes)
            for (const std::int64_t claim_us : extremes)
                for (const std::uint32_t downtime : {0u, 5u, 0xffffffffu})
                    for (const std::int32_t carry : carries) {
                        const HistoryAdoptBooking b =
                            history_adopt_booking(sign_us, commit_us, downtime, claim_us, carry);
                        REQUIRE(b.gaps <= HISTORY_SAMPLES);
                        const bool measured =
                            commit_us >= 0 && claim_us >= 0 && sign_us >= commit_us;
                        if (!measured) REQUIRE(b.gaps == 0 && b.residual_us == 0);
                        // A filled ring leaves nothing to carry the remainder for.
                        if (b.gaps == HISTORY_SAMPLES) REQUIRE(b.residual_us == 0);
                        if (measured && b.gaps < HISTORY_SAMPLES && carry >= -150'000'000 &&
                            carry <= 149'999'999)
                            REQUIRE(b.residual_us >= -150'000'000 && b.residual_us < 150'000'000);
                        // A later sign of life never books fewer buckets (with the same carry).
                        for (const std::int64_t later : extremes)
                            if (later >= sign_us)
                                REQUIRE(history_adopt_booking(later, commit_us, downtime, claim_us,
                                                              carry)
                                            .gaps >= b.gaps);
                        // A smaller ring caps the count and a degenerate width or an empty ring
                        // books nothing, and never divides.
                        REQUIRE(history_adopt_booking(sign_us, commit_us, downtime, claim_us, carry,
                                                      300, 7)
                                    .gaps <= 7);
                        REQUIRE(
                            history_adopt_booking(sign_us, commit_us, downtime, claim_us, carry, 0)
                                .gaps == 0);
                        REQUIRE(history_adopt_booking(sign_us, commit_us, downtime, claim_us, carry,
                                                      300, 0)
                                    .gaps == 0);
                    }
    // The journal floor: never lowers the cursor, never invents one, and no extreme overflows.
    for (const std::int64_t cursor : extremes)
        for (const std::int64_t real_bucket : extremes) {
            const std::int64_t floor_bucket = history_adopt_floor_bucket(cursor, real_bucket);
            REQUIRE(floor_bucket == INT64_MIN ||
                    (cursor != INT64_MIN && floor_bucket == real_bucket && real_bucket > cursor));
            const std::int64_t lifted = history_adopt_floor_cursor(cursor, floor_bucket);
            REQUIRE(lifted >= cursor);
            if (cursor == INT64_MIN) REQUIRE(lifted == INT64_MIN);
            if (floor_bucket == INT64_MIN) REQUIRE(lifted == cursor);
        }
    for (const std::int64_t claim_us : extremes)
        for (const std::uint32_t gaps : {0u, 1u, 287u, 288u, 0xffffffffu}) {
            const std::int64_t end = history_adopt_real_end_us(claim_us, gaps);
            if (claim_us < 0 || gaps >= HISTORY_SAMPLES)
                REQUIRE(end == INT64_MIN);
            else
                REQUIRE(end <= claim_us &&
                        claim_us - end == static_cast<std::int64_t>(gaps) * 300'000'000);
        }

    // The verdict over its whole small product: an intact, current, uncommitted-free record is the
    // only one accepted, and the order in which the refusals are reported never changes.
    const std::uint32_t reasons[] = {static_cast<std::uint32_t>(CrashReason::SW),
                                     static_cast<std::uint32_t>(CrashReason::PANIC),
                                     static_cast<std::uint32_t>(CrashReason::POWERON),
                                     static_cast<std::uint32_t>(CrashReason::BROWNOUT), 9999u};
    for (const std::uint32_t reason : reasons)
        for (int bad = 0; bad < 16; ++bad)
            for (const std::uint32_t boots : {0u, 1u, 255u, 0xffffffffu})
                for (int flags = 0; flags < 4; ++flags) {
                    const bool           safe    = flags & 1;
                    const bool           current = !(flags & 2);
                    const HistoryRestore v       = history_restore_verdict(
                        reason, (bad & 1) ? 0u : HISTORY_PERSIST_MAGIC,
                        (bad & 2) ? static_cast<std::uint16_t>(HISTORY_PERSIST_VERSION + 1)
                                        : HISTORY_PERSIST_VERSION,
                        (bad & 4) ? 1u : 2u, 2u, 7u, (bad & 8) ? 8u : 7u, safe, boots, current);
                    const bool intact = history_reset_preserves_ram(reason) && !bad;
                    REQUIRE((v == HistoryRestore::Accept) ==
                            (!safe && intact && boots == 0 && current));
                    if (safe)
                        REQUIRE(v == HistoryRestore::SafeMode);
                    else if (!history_reset_preserves_ram(reason))
                        REQUIRE(v == HistoryRestore::PowerCycle);
                    else if (bad)
                        REQUIRE(v != HistoryRestore::NotCommitted &&
                                v != HistoryRestore::StaleCommit);
                    else if (boots)
                        REQUIRE(v == HistoryRestore::NotCommitted);
                    else if (!current)
                        REQUIRE(v == HistoryRestore::StaleCommit);
                }
}

bool requested(int argc, char** argv, std::string_view target) {
    if (argc == 1) return true;
    for (int i = 1; i < argc; ++i)
        if (argv[i] == target) return true;
    return false;
}

bool known_target(std::string_view target) {
    return target == "manifest" || target == "changelog" || target == "modbus" ||
           target == "mqtt" || target == "http" || target == "liveness";
}

void require_target_checks(const char* target, std::size_t before, std::size_t minimum) {
    const std::size_t executed = g_checks - before;
    if (executed < minimum) {
        std::fprintf(stderr, "property target %s ran only %zu checks; minimum is %zu\n", target,
                     executed, minimum);
        std::abort();
    }
}

} // namespace

int main(int argc, char** argv) {
    if (argc == 2 && std::string_view(argv[1]) == "sanitizer-smoke") return 0;
    for (int i = 1; i < argc; ++i) {
        if (!known_target(argv[i])) {
            std::fprintf(stderr, "unknown property target: %s\n", argv[i]);
            return 2;
        }
    }
    bool ran = false;
    if (requested(argc, argv, "manifest")) {
        const std::size_t before = g_checks;
        test_manifest_properties();
        require_target_checks("manifest", before, 4800);
        ran = true;
    }
    if (requested(argc, argv, "changelog")) {
        const std::size_t before = g_checks;
        test_changelog_range_properties();
        require_target_checks("changelog", before, 6000);
        ran = true;
    }
    if (requested(argc, argv, "modbus")) {
        const std::size_t before = g_checks;
        test_modbus_properties();
        require_target_checks("modbus", before, 28000);
        ran = true;
    }
    if (requested(argc, argv, "mqtt")) {
        const std::size_t before = g_checks;
        test_mqtt_uri_properties();
        require_target_checks("mqtt", before, 3000);
        ran = true;
    }
    if (requested(argc, argv, "http")) {
        const std::size_t before = g_checks;
        test_http_properties();
        require_target_checks("http", before, 1500);
        ran = true;
    }
    if (requested(argc, argv, "liveness")) {
        const std::size_t before = g_checks;
        test_history_liveness_properties();
        require_target_checks("liveness", before, 25000);
        ran = true;
    }
    if (!ran) {
        std::fprintf(stderr, "usage: logic_property_tests [manifest] [changelog] [modbus] [mqtt] "
                             "[http] [liveness]\n");
        return 2;
    }
    std::printf("sanitizer/property tests passed: %zu invariant checks\n", g_checks);
    return 0;
}
