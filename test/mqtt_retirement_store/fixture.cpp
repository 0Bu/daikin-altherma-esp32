// Executes the actual NVS adapter and allocation-free codec. Mock NVS is write-through.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "nvs.h"
#include "mqtt_retirement_store.hpp"

static void check(bool value, const char* name) {
    if (!value) {
        std::fprintf(stderr, "FAIL %s\n", name);
        std::exit(1);
    }
}

struct FakeNvs {
    std::vector<uint8_t> stored;
    bool                 present    = false;
    esp_err_t            open_error = ESP_OK, query_error = ESP_OK, read_error = ESP_OK;
    esp_err_t            set_error = ESP_OK, commit_error = ESP_OK;
    int                  opens = 0, queries = 0, reads = 0, sets = 0, commits = 0, closes = 0;
    int                  returned_read_size = -1;
    nvs_open_mode_t      mode               = NVS_READONLY;
};
static FakeNvs fake;

esp_err_t nvs_open(const char* name, nvs_open_mode_t mode, nvs_handle_t* handle) {
    check(std::strcmp(name, "mqtt_retire") == 0, "DEDICATED_NAMESPACE_NEVER_SERVICE_CONFIG");
    ++fake.opens;
    fake.mode = mode;
    if (fake.open_error != ESP_OK) return fake.open_error;
    *handle = 42;
    return ESP_OK;
}
esp_err_t nvs_get_blob(nvs_handle_t handle, const char* key, void* destination, size_t* size) {
    check(handle == 42 && fake.mode == NVS_READONLY, "LOAD_USES_READONLY_HANDLE");
    check(std::strcmp(key, "provenance") == 0, "DEDICATED_KEY_NEVER_CONFIG_OR_LINK");
    if (!destination) {
        ++fake.queries;
        if (fake.query_error != ESP_OK) return fake.query_error;
        if (!fake.present) return ESP_ERR_NVS_NOT_FOUND;
        *size = fake.stored.size();
        return ESP_OK;
    }
    ++fake.reads;
    if (*size < fake.stored.size()) return ESP_ERR_NVS_INVALID_LENGTH;
    if (!fake.stored.empty()) std::memcpy(destination, fake.stored.data(), fake.stored.size());
    *size = fake.returned_read_size < 0 ? fake.stored.size()
                                        : static_cast<size_t>(fake.returned_read_size);
    // A failure may have touched the caller's byte buffer but must not touch its decoded record.
    return fake.read_error;
}
esp_err_t nvs_set_blob(nvs_handle_t handle, const char* key, const void* data, size_t size) {
    check(handle == 42 && fake.mode == NVS_READWRITE, "SAVE_USES_READWRITE_HANDLE");
    check(std::strcmp(key, "provenance") == 0, "DEDICATED_KEY_NEVER_CONFIG_OR_LINK");
    ++fake.sets;
    if (fake.set_error != ESP_OK) return fake.set_error;
    const auto* bytes = static_cast<const uint8_t*>(data);
    fake.stored.assign(bytes, bytes + size);
    fake.present = true;
    return ESP_OK;
}
esp_err_t nvs_commit(nvs_handle_t handle) {
    check(handle == 42 && fake.mode == NVS_READWRITE, "COMMIT_USES_READWRITE_HANDLE");
    ++fake.commits;
    return fake.commit_error;
}
void nvs_close(nvs_handle_t handle) {
    check(handle == 42, "ONLY_OPEN_HANDLE_CLOSED");
    ++fake.closes;
}

#include MQTT_RETIREMENT_PRODUCTION_SOURCE

using namespace daik;
static MqttRetirementRecord record(const char* base  = "daikin-altherma-esp32-test",
                                   const char* board = "daikin_altherma_esp32__board_020001123456",
                                   const char* profile = "altherma_gshp2") {
    MqttRetirementRecord result;
    check(mqtt_retirement_record_make(result, base, board, profile), "FIXTURE_RECORD_VALID");
    return result;
}
static bool equal(const MqttRetirementRecord& a, const MqttRetirementRecord& b) {
    return std::memcmp(a.base, b.base, sizeof(a.base)) == 0 &&
           std::memcmp(a.board_id, b.board_id, sizeof(a.board_id)) == 0 &&
           std::memcmp(a.profile_id, b.profile_id, sizeof(a.profile_id)) == 0;
}
static void seed(const MqttRetirementRecord& value) {
    fake.stored.resize(MQTT_RETIREMENT_STORE_BYTES);
    check(mqtt_retirement_encode(value, fake.stored.data(), fake.stored.size()),
          "FIXTURE_RECORD_ENCODED");
    fake.present = true;
}
static void reseal(std::vector<uint8_t>& bytes) {
    const uint32_t crc = config_crc32(bytes.data(), bytes.size() - 4);
    for (size_t i = 0; i < 4; ++i)
        bytes[bytes.size() - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
}
static void expect_load(MqttRetirementStoreLoad expected, const char* name) {
    auto       out      = record("sentinel-base", "sentinel-board", "sentinel-profile");
    const auto original = out;
    check(mqtt_retirement_store_load(out) == expected, name);
    check(equal(out, original), "LOAD_FAILURE_NEVER_EXPOSES_PARTIAL_RECORD");
}

static void missing() {
    fake.open_error = ESP_ERR_NVS_NOT_FOUND;
    expect_load(MqttRetirementStoreLoad::Missing, "MISSING_NAMESPACE_IS_MISSING");
    check(fake.queries == 0 && fake.closes == 0, "FAILED_OPEN_NEVER_READ_OR_CLOSE");
    fake = {};
    expect_load(MqttRetirementStoreLoad::Missing, "MISSING_KEY_IS_MISSING");
    check(fake.queries == 1 && fake.reads == 0 && fake.closes == 1,
          "MISSING_KEY_CLOSES_WITHOUT_PAYLOAD_READ");
}
static void read_failures() {
    fake.open_error = ESP_FAIL;
    expect_load(MqttRetirementStoreLoad::Error, "OPEN_ERROR_IS_NOT_MISSING");
    fake             = {};
    fake.query_error = ESP_FAIL;
    expect_load(MqttRetirementStoreLoad::Error, "QUERY_ERROR_IS_NOT_MISSING");
    check(fake.reads == 0 && fake.closes == 1, "QUERY_ERROR_CLOSES_WITHOUT_PAYLOAD_READ");
    fake = {};
    seed(record());
    fake.read_error = ESP_FAIL;
    expect_load(MqttRetirementStoreLoad::Error, "PAYLOAD_READ_ERROR_REJECTED");
    check(fake.reads == 1 && fake.closes == 1, "READ_ERROR_CLOSES_HANDLE");
    fake = {};
    seed(record());
    fake.returned_read_size = MQTT_RETIREMENT_STORE_BYTES - 1;
    expect_load(MqttRetirementStoreLoad::Incompatible, "CHANGED_READ_LENGTH_REJECTED");
}
static void bounded_load() {
    for (size_t size : {size_t(0), size_t(1), MQTT_RETIREMENT_STORE_BYTES - 1,
                        MQTT_RETIREMENT_STORE_BYTES + 1, size_t(4096)}) {
        fake         = {};
        fake.present = true;
        fake.stored.assign(size, 0xff);
        expect_load(MqttRetirementStoreLoad::Incompatible, "INCOMPATIBLE_SIZE_NOT_READ");
        check(fake.reads == 0 && fake.closes == 1, "OVERSIZED_RECORD_CANNOT_ENTER_FIXED_BUFFER");
    }
}
static void save_failures() {
    const auto value = record();
    fake.open_error  = ESP_FAIL;
    check(!mqtt_retirement_store_save(value), "SAVE_OPEN_ERROR_RETRYABLE");
    check(fake.sets == 0 && fake.commits == 0 && fake.closes == 0, "SAVE_OPEN_ERROR_HAS_NO_WRITE");
    fake = {};
    seed(record("predecessor", "previous-board", "previous-profile"));
    const auto previous = fake.stored;
    fake.set_error      = ESP_FAIL;
    check(!mqtt_retirement_store_save(value), "SET_ERROR_CANNOT_REPORT_SAVED");
    check(fake.commits == 0 && fake.closes == 1 && fake.stored == previous,
          "SET_FAILURE_CLOSES_AND_RETAINS_PRIOR_ENTRY");
    fake              = {};
    fake.commit_error = ESP_FAIL;
    check(!mqtt_retirement_store_save(value), "COMMIT_ERROR_CANNOT_REPORT_SAVED");
    check(fake.sets == 1 && fake.commits == 1 && fake.closes == 1, "COMMIT_FAILURE_CLOSES_HANDLE");
    // IDF's write-through set may already persist despite commit failure. No fake rollback claim.
    MqttRetirementRecord loaded;
    check(mqtt_retirement_store_load(loaded) == MqttRetirementStoreLoad::Ready &&
              equal(loaded, value),
          "COMMIT_ERROR_DOES_NOT_INVENT_ROLLBACK");
    fake.commit_error = ESP_OK;
    check(mqtt_retirement_store_save(value), "FAILED_SAVE_CAN_BE_RETRIED");
}
static void roundtrip() {
    for (const auto& value : {record(), record("raw-\"quoted\\base", "full-board-id", ""),
                              record("successor", "next-board", "next-profile")}) {
        check(mqtt_retirement_store_save(value), "SCOPE_RECORD_SAVE_ACCEPTED");
        MqttRetirementRecord loaded;
        check(mqtt_retirement_store_load(loaded) == MqttRetirementStoreLoad::Ready &&
                  equal(loaded, value),
              "ALL_SCOPE_FIELDS_RELOAD_EXACTLY");
        check(fake.stored.size() == 204 && fake.stored[4] == 1,
              "VERSIONED_RECORD_HAS_EXACT_BOUNDED_LAYOUT");
    }
    check(fake.opens == fake.closes && fake.sets == 3 && fake.commits == 3,
          "REPEATED_SAVE_LOAD_CLOSES_EVERY_HANDLE");
}
static void corrupt_load() {
    for (size_t offset : {size_t(0), size_t(4), size_t(5), size_t(8), size_t(72), size_t(136),
                          size_t(200), size_t(203)}) {
        fake = {};
        seed(record());
        fake.stored[offset] ^= 1;
        expect_load(MqttRetirementStoreLoad::Incompatible, "CORRUPT_RECORD_REJECTED");
    }
    fake = {};
    seed(record());
    fake.stored[4] = 2;
    reseal(fake.stored);
    expect_load(MqttRetirementStoreLoad::Incompatible, "UNKNOWN_VERSION_REJECTED");
    fake = {};
    seed(record());
    fake.stored[5] = 65;
    reseal(fake.stored);
    expect_load(MqttRetirementStoreLoad::Incompatible, "OVERSIZED_FIELD_REJECTED");
    fake = {};
    seed(record());
    fake.stored[6] = 0;
    std::fill(fake.stored.begin() + 72, fake.stored.begin() + 136, 0);
    reseal(fake.stored);
    expect_load(MqttRetirementStoreLoad::Incompatible, "EMPTY_BOARD_ID_REJECTED");
    fake = {};
    seed(record());
    fake.stored[9] = 0;
    reseal(fake.stored);
    expect_load(MqttRetirementStoreLoad::Incompatible, "EMBEDDED_NUL_REJECTED");
    fake = {};
    seed(record());
    fake.stored[71] = 1;
    reseal(fake.stored);
    expect_load(MqttRetirementStoreLoad::Incompatible, "NONCANONICAL_PADDING_REJECTED");
}
static void wire_reference() {
    const auto value = record();
    uint8_t    bytes[MQTT_RETIREMENT_STORE_BYTES];
    check(mqtt_retirement_encode(value, bytes, sizeof(bytes)), "REFERENCE_RECORD_ENCODED");
    // Independently built layout and Python zlib.crc32 reference, not a second firmware codec.
    uint8_t expected[204]{};
    std::memcpy(expected, "MQRT\x01", 5);
    const char* fields[] = {"daikin-altherma-esp32-test",
                            "daikin_altherma_esp32__board_020001123456", "altherma_gshp2"};
    for (size_t i = 0; i < 3; ++i) {
        expected[5 + i] = static_cast<uint8_t>(std::strlen(fields[i]));
        std::memcpy(expected + 8 + 64 * i, fields[i], std::strlen(fields[i]));
    }
    expected[200] = 0xf9;
    expected[201] = 0x5b;
    expected[202] = 0x34;
    expected[203] = 0x28;
    check(std::memcmp(bytes, expected, sizeof(expected)) == 0,
          "EXPLICIT_WIRE_LAYOUT_MATCHES_INDEPENDENT_CRC_REFERENCE");
    MqttRetirementRecord decoded;
    check(mqtt_retirement_decode(expected, sizeof(expected), decoded) && equal(decoded, value),
          "INDEPENDENT_WIRE_REFERENCE_DECODES_EXACTLY");
}
static void codec_boundaries() {
    auto              value    = record();
    const auto        previous = value;
    const std::string maximum(64, 'x'), oversized(65, 'y');
    check(!mqtt_retirement_record_make(value, "", "board", "") && equal(value, previous),
          "EMPTY_BASE_REJECTED_WITHOUT_PARTIAL_RECORD");
    check(!mqtt_retirement_record_make(value, "base", "", "") && equal(value, previous),
          "EMPTY_BOARD_REJECTED_WITHOUT_PARTIAL_RECORD");
    check(!mqtt_retirement_record_make(value, oversized, "board", "") && equal(value, previous),
          "OVERSIZED_BASE_REJECTED_WITHOUT_PARTIAL_RECORD");
    check(!mqtt_retirement_record_make(value, "base", oversized, "") && equal(value, previous),
          "OVERSIZED_BOARD_REJECTED_WITHOUT_PARTIAL_RECORD");
    check(!mqtt_retirement_record_make(value, "base", "board", oversized) && equal(value, previous),
          "OVERSIZED_PROFILE_REJECTED_WITHOUT_PARTIAL_RECORD");
    check(!mqtt_retirement_record_make(value, std::string_view("a\0b", 3), "board", "") &&
              equal(value, previous),
          "EMBEDDED_NUL_INPUT_REJECTED_WITHOUT_PARTIAL_RECORD");
    check(mqtt_retirement_record_make(value, maximum, maximum, maximum),
          "FULL_64_BYTE_FIELDS_ACCEPTED");
    uint8_t bytes[MQTT_RETIREMENT_STORE_BYTES];
    check(mqtt_retirement_encode(value, bytes, sizeof(bytes)), "MAXIMUM_RECORD_ENCODED");
    MqttRetirementRecord loaded;
    check(mqtt_retirement_decode(bytes, sizeof(bytes), loaded) && equal(loaded, value),
          "FULL_64_BYTE_FIELDS_DECODED_WITH_NUL_TERMINATORS");
    check(!mqtt_retirement_encode(value, nullptr, sizeof(bytes)) &&
              !mqtt_retirement_encode(value, bytes, sizeof(bytes) - 1),
          "ENCODE_REJECTS_INVALID_DESTINATION");
    check(!mqtt_retirement_decode(nullptr, sizeof(bytes), loaded) &&
              !mqtt_retirement_decode(bytes, sizeof(bytes) - 1, loaded) && equal(loaded, value),
          "DECODE_REJECTS_INVALID_INPUT_WITHOUT_PARTIAL_RECORD");
    std::memset(value.base, 'x', sizeof(value.base));
    check(!mqtt_retirement_store_save(value) && fake.opens == 0,
          "UNTERMINATED_RECORD_NEVER_OPENS_OR_WRITES_NVS");
    value         = record();
    value.base[0] = 0;
    check(!mqtt_retirement_store_save(value) && fake.opens == 0,
          "INVALID_RECORD_NEVER_OPENS_OR_WRITES_NVS");
}

int main(int argc, char** argv) {
    check(argc == 2, "SCENARIO_REQUIRED");
    const std::string name = argv[1];
    if (name == "missing")
        missing();
    else if (name == "read_failures")
        read_failures();
    else if (name == "bounded_load")
        bounded_load();
    else if (name == "save_failures")
        save_failures();
    else if (name == "roundtrip")
        roundtrip();
    else if (name == "corrupt_load")
        corrupt_load();
    else if (name == "wire_reference")
        wire_reference();
    else if (name == "codec_boundaries")
        codec_boundaries();
    else
        check(false, "UNKNOWN_SCENARIO");
    std::printf("PASS %s\n", name.c_str());
}
