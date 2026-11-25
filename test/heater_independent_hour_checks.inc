// Method 3 retains the strict Data/Fence body contract while changing the envelope identity.
#include "logic/heater_independent_hour.hpp"

static void test_heater_independent_hour() {
    namespace wh = daik::logic::heater_independent;
    namespace hc = daik::logic::heater_cohort;
    using namespace heater_cohort_host_tests;
    auto    data = sample(0, 3);
    uint8_t previous[hc::DATA_BYTES], current[wh::DATA_BYTES];
    CHECK(hc::encode_data(data, previous, sizeof(previous)));
    CHECK(wh::encode_data(data, current, sizeof(current)));
    CHECK(previous[0] == 2 && current[0] == 3);
    const auto same_body = [](const auto& old_bytes, const auto& new_bytes) {
        static_assert(sizeof(old_bytes) == sizeof(new_bytes));
        for (size_t i = 1; i < sizeof(old_bytes); ++i) CHECK(old_bytes[i] == new_bytes[i]);
    };
    same_body(previous, current);
    wh::Data decoded;
    CHECK(!wh::decode_data_into(previous, sizeof(previous), decoded));
    CHECK(!hc::decode_data_into(current, sizeof(current), decoded));
    CHECK(!wh::encode_data(data, nullptr, sizeof(current)));
    CHECK(!wh::encode_data(data, current, sizeof(current) - 1));
    auto invalid_data   = data;
    invalid_data.heater = daik::logic::heater_context::HEATERS;
    CHECK(!wh::encode_data(invalid_data, current, sizeof(current)));
    CHECK(!wh::decode_data_into(nullptr, sizeof(current), decoded));
    CHECK(!wh::decode_data_into(current, sizeof(current) - 1, decoded));
    for (size_t byte = 1; byte < sizeof(current); ++byte) {
        for (unsigned bit = 0; bit < 8; ++bit) {
            const auto saved = current[byte];
            current[byte] ^= uint8_t(1u << bit);
            std::memcpy(previous, current, sizeof(previous));
            previous[0] = 2;
            hc::Data   old_value, new_value;
            const bool old_ok = hc::decode_data_into(previous, sizeof(previous), old_value);
            const bool new_ok = wh::decode_data_into(current, sizeof(current), new_value);
            CHECK(old_ok == new_ok);
            if (new_ok) {
                uint8_t old_encoded[hc::DATA_BYTES], new_encoded[wh::DATA_BYTES];
                CHECK(hc::encode_data(old_value, old_encoded, sizeof(old_encoded)));
                CHECK(wh::encode_data(new_value, new_encoded, sizeof(new_encoded)));
                same_body(old_encoded, new_encoded);
            }
            current[byte] = saved;
        }
    }
    wh::Fence fence;
    fence.identity = data.identity;
    fence.sequence = UINT64_MAX - 1;
    fence.reason   = 2;
    uint8_t old_fence[hc::FENCE_BYTES], new_fence[wh::FENCE_BYTES];
    CHECK(hc::encode_fence(fence, old_fence, sizeof(old_fence)));
    CHECK(wh::encode_fence(fence, new_fence, sizeof(new_fence)));
    same_body(old_fence, new_fence);
    wh::Fence decoded_fence;
    CHECK(!wh::decode_fence_into(old_fence, sizeof(old_fence), decoded_fence));
    CHECK(!wh::encode_fence(fence, nullptr, sizeof(new_fence)));
    CHECK(!wh::encode_fence(fence, new_fence, sizeof(new_fence) - 1));
    auto invalid_fence     = fence;
    invalid_fence.sequence = 0;
    CHECK(!wh::encode_fence(invalid_fence, new_fence, sizeof(new_fence)));
    CHECK(!wh::decode_fence_into(nullptr, sizeof(new_fence), decoded_fence));
    CHECK(!wh::decode_fence_into(new_fence, sizeof(new_fence) - 1, decoded_fence));
    for (size_t byte = 1; byte < sizeof(new_fence); ++byte) {
        for (unsigned bit = 0; bit < 8; ++bit) {
            const auto saved = new_fence[byte];
            new_fence[byte] ^= uint8_t(1u << bit);
            std::memcpy(old_fence, new_fence, sizeof(old_fence));
            old_fence[0] = 2;
            wh::Fence  old_value, new_value;
            const bool old_ok = hc::decode_fence_into(old_fence, sizeof(old_fence), old_value);
            const bool new_ok = wh::decode_fence_into(new_fence, sizeof(new_fence), new_value);
            CHECK(old_ok == new_ok);
            if (new_ok) {
                uint8_t old_encoded[hc::FENCE_BYTES], new_encoded[wh::FENCE_BYTES];
                CHECK(hc::encode_fence(old_value, old_encoded, sizeof(old_encoded)));
                CHECK(wh::encode_fence(new_value, new_encoded, sizeof(new_encoded)));
                same_body(old_encoded, new_encoded);
            }
            new_fence[byte] = saved;
        }
    }
    CHECK(wh::wire_bytes(hc::Kind::Commit) == 0);
    CHECK(wh::wire_bytes(hc::Kind::Unknown) == 0);
    CHECK(wh::wire_bytes(hc::Kind::Data) == 192);
    CHECK(wh::wire_bytes(hc::Kind::Fence) == 32);
    physical::FlashJournalRecord record;
    physical::header(record, hc::Kind::Data, B, 1);
    record.header.catalog_fp = wh::fingerprint(hc::Kind::Data);
    CHECK(wh::encode_data(data, record.payload, wh::DATA_BYTES));
    physical::seal(record);
    wh::View view{&record.header, record.payload, sizeof(record.payload), true};
    CHECK(wh::kind(record.header) == hc::Kind::Data);
    CHECK(hc::kind(record.header) == hc::Kind::Unknown);
    CHECK(wh::typed(view, hc::Kind::Data));
    CHECK(!wh::typed(view, hc::Kind::Commit));
    view.header = nullptr;
    CHECK(!wh::typed(view, hc::Kind::Data));
    view.header  = &record.header;
    view.payload = nullptr;
    CHECK(!wh::typed(view, hc::Kind::Data));
    view.payload  = record.payload;
    view.capacity = wh::DATA_BYTES - 1;
    CHECK(!wh::typed(view, hc::Kind::Data));
    view.capacity        = sizeof(record.payload);
    record.header.source = uint8_t(HistoryJournalSource::X10a);
    physical::seal(record);
    CHECK(wh::kind(record.header) == hc::Kind::Unknown);
    CHECK(!wh::typed(view, hc::Kind::Data));
    record.header.source = uint8_t(HistoryJournalSource::Checkup);
    physical::seal(record);
    view.physical = false;
    CHECK(!wh::typed(view, hc::Kind::Data));
    view.physical = true;
    ++record.header.sequence;
    CHECK(!wh::typed(view, hc::Kind::Data));
    record.header.catalog_fp = hc::fingerprint(hc::Kind::Data);
    CHECK(wh::kind(record.header) == hc::Kind::Unknown);
    CHECK(!wh::typed(view, hc::Kind::Data));
}
