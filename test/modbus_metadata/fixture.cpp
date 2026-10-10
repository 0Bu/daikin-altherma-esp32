// Host adapters and observations only. Both consumer functions are extracted afresh from production
// by test_modbus_metadata_contract.mjs; no copy of either implementation is stored in this fixture.
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include "hp_poll.hpp"
#include "def/homehub.hpp"
#include "logic/config_model.hpp"
#include "logic/discovery.hpp"
#include "logic/homehub_map.hpp"
#include "logic/json.hpp"
#include "logic/mqtt_group.hpp"

namespace daik {

static std::vector<CachedValue> fixture_rows;
static bool fixture_live = true;
static bool replace_after_copy = false;
static ModbusProfile current_profile = ModbusProfile::HomeHub;
static unsigned profile_getter_calls = 0;
static unsigned target_generation = 1;

ModbusProfile mb_active_profile() {
    ++profile_getter_calls;
    return current_profile;
}

size_t mb_values_capacity() { return fixture_rows.size(); }

size_t mb_values_snapshot(CachedValue* out, size_t max, bool& live) {
    const size_t n = std::min(max, fixture_rows.size());
    for (size_t i = 0; i < n; ++i) out[i] = fixture_rows[i];
    live = fixture_live;
    if (replace_after_copy) {
        // The caller already owns the copied rows. Advance the independently mutable target and
        // current profile before current_modbus_values() uses any row metadata.
        fixture_rows.clear();
        current_profile = ModbusProfile::HomeHub;
        ++target_generation;
        replace_after_copy = false;
    }
    return n;
}

#include HUB_HTTP_CONSUMERS
#include HUB_MQTT_CONSUMER

static CachedValue row(bool native, uint16_t offset, uint16_t raw) {
    const def::HomeHubReg* definition = native ? def::altherma4_find(offset)
                                               : def::homehub_find(offset);
    if (!definition) throw std::runtime_error("fixture requested an absent definition");
    CachedValue value;
    value.label = definition->label;
    value.unit = definition->unit;
    value.reg = def::HOMEHUB_GROUP_REG;
    value.off = static_cast<uint8_t>(offset);
    value.modbus_definition = def::homehub_definition_id(*definition);
    char formatted[24];
    if (def::homehub_format(*definition, raw, formatted, sizeof(formatted)))
        value.value = formatted;
    return value;
}

static void emit(const char* name, const std::string& json) {
    std::string prefix = "{\"case\":";
    json_append_quoted(prefix, name);
    std::cout << prefix << ",\"value\":" << json << "}\n";
}

static void http(const char* name, const std::vector<CachedValue>& rows) {
    std::string json;
    append_modbus_values_array(json, rows);
    emit(name, json);
}

static void mqtt(const char* name, const std::vector<CachedValue>& rows, bool live = true) {
    fixture_rows = rows;
    fixture_live = live;
    bool copied_live = false;
    const auto values = current_modbus_values(copied_live);
    if (copied_live != live) throw std::runtime_error("snapshot adapter liveness mismatch");
    emit(name, build_flat_json(values));
}

static std::vector<CachedValue> same_offset_rows() {
    return {row(false, 38, 1), row(true, 38, 0), row(false, 9, 1), row(true, 9, 1),
            row(false, 58, 250), row(true, 58, 250)};
}

static std::vector<CachedValue> typed_rows() {
    auto text = row(true, 22, 0x3132); // Text16 containing digits must remain a JSON string.
    auto escaped_text = row(false, 22, 0x4131);
    escaped_text.value = "A\"\\\n";
    auto malformed = row(true, 38, 1);
    malformed.value = "Heating";
    return {row(true, 38, 7), row(true, 65, 3), row(true, 83, 7),
            row(true, 30, 1), text, escaped_text, row(true, 65, 32765), malformed};
}

static std::vector<CachedValue> invalid_rows() {
    auto absent = row(true, 38, 1);
    absent.modbus_definition = 0;
    auto invalid = row(true, 9, 1);
    invalid.modbus_definition = 255;
    auto mismatch = row(true, 9, 1);
    mismatch.off = 38;
    return {absent, invalid, mismatch};
}

static std::vector<CachedValue> native_rows() {
    return {row(true, 9, 1), row(true, 38, 0), row(true, 58, 250), row(true, 51, 350),
            row(true, 65, 3), row(true, 83, 7), row(true, 22, 0x3132)};
}

static void http_cases() {
    http("http-same-offset", same_offset_rows());
    // Each source is tested separately for MQTT because its flat key namespace intentionally
    // replaces repeated keys. HTTP can observe both exact defining rows in one array.
    http("http-typed", typed_rows());
    http("http-invalid", invalid_rows());
    fixture_rows = native_rows();
    current_profile = ModbusProfile::Altherma4;
    const auto retained_snapshot = fixture_rows;
    fixture_rows = {row(false, 9, 0)};
    current_profile = ModbusProfile::HomeHub;
    ++target_generation;
    profile_getter_calls = 0;
    http("http-owned-snapshot", retained_snapshot);
    emit("http-profile-calls", std::to_string(profile_getter_calls));
}

static void mqtt_cases() {
    mqtt("mqtt-base", {row(false, 38, 1), row(false, 9, 1), row(false, 58, 250)});
    mqtt("mqtt-native", native_rows());
    // Avoid repeated Text16 or mode keys in the flat JSON: their types must be observable without
    // JSON.parse's last-key replacement masking the first value.
    mqtt("mqtt-typed", {row(true, 38, 7), row(true, 65, 3), row(true, 83, 7),
                         row(true, 30, 1), row(true, 22, 0x3132)});
    auto text = row(true, 22, 0x4131);
    text.value = "A\"\\\n";
    mqtt("mqtt-escaped-text", {text});
    auto malformed = row(true, 38, 1);
    malformed.value = "Heating";
    mqtt("mqtt-missing", {row(true, 65, 32765), malformed});
    mqtt("mqtt-invalid", invalid_rows());
    mqtt("mqtt-not-live", native_rows(), false);
    fixture_rows = native_rows();
    fixture_live = true;
    current_profile = ModbusProfile::Altherma4;
    replace_after_copy = true;
    profile_getter_calls = 0;
    bool live = false;
    const auto retained_values = current_modbus_values(live);
    if (!live || !fixture_rows.empty() || current_profile != ModbusProfile::HomeHub)
        throw std::runtime_error("source replacement adapter did not run");
    emit("mqtt-owned-snapshot", build_flat_json(retained_values));
    emit("mqtt-profile-calls", std::to_string(profile_getter_calls));
}

} // namespace daik

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const std::string consumer = argv[1];
    if (consumer == "http") daik::http_cases();
    else if (consumer == "mqtt") daik::mqtt_cases();
    else return 2;
}
