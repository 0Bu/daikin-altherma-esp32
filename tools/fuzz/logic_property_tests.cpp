// Deterministic, bounded property tests for hostile-input pure logic. This is intentionally not a
// second copy of test/test_logic.cpp: it explores prefixes and single-byte mutations under
// ASan+UBSan, while the ordinary host suite owns exact behavioral examples and line coverage.
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include "logic/http_body.hpp"
#include "logic/http_request.hpp"
#include "logic/modbus.hpp"
#include "logic/mqtt_uri.hpp"
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

bool requested(int argc, char** argv, std::string_view target) {
    if (argc == 1) return true;
    for (int i = 1; i < argc; ++i)
        if (argv[i] == target) return true;
    return false;
}

bool known_target(std::string_view target) {
    return target == "manifest" || target == "modbus" || target == "mqtt" || target == "http";
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
    if (!ran) {
        std::fprintf(stderr, "usage: logic_property_tests [manifest] [modbus] [mqtt] [http]\n");
        return 2;
    }
    std::printf("sanitizer/property tests passed: %zu invariant checks\n", g_checks);
    return 0;
}
