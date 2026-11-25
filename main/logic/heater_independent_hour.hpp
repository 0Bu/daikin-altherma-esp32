#pragma once
// One atomic complete hour per heater. Data and Fence use separate Method-3
// fingerprints; no cross-heater commit is required.
#include "heater_context_cohort.hpp"
#include <cstddef>
#include <cstdint>

namespace daik::logic::heater_independent {
namespace old = heater_cohort;
namespace hd  = heater_context;
using old::Data;
using old::end_not_future;
using old::equal;
using old::Fence;
using old::Get;
using old::get_identity;
using old::Identity;
using old::in_window;
using old::Kind;
using old::Put;
using old::put_identity;
using old::slot_erased;
using old::valid_data;
using old::valid_fence;
using old::valid_identity;
using old::View;
using old::zero_object;
constexpr uint8_t METHOD     = 3;
constexpr size_t  DATA_BYTES = 192, FENCE_BYTES = 32, HOURS = 24, FENCES = 8;
constexpr int64_t HOUR_US = 3600000000LL;
inline bool       encode_data(const Data& d, uint8_t* out, size_t n) {
    if (!out || n != DATA_BYTES || !valid_data(d)) return false;
    Put w{out};
    w.value(METHOD, 1);
    w.value(d.heater, 1);
    w.value(d.flags, 2);
    put_identity(w, d.identity);
    w.value(d.first, 4);
    w.value(d.last, 4);
    w.value(d.capabilities, 2);
    w.value(d.required, 1);
    const auto& c = d.counters;
#define HC_P(field, n) w.value(c.field, n)
    HC_P(readable_us, 4);
    HC_P(on_us, 4);
    HC_P(off_us, 4);
    HC_P(transition_us, 4);
    HC_P(unreadable_us, 4);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        w.value(c.positive_us[k], 4);
        w.value(c.evaluable_on_us[k], 4);
    }
    HC_P(union_us, 4);
    HC_P(overlap_us, 4);
    HC_P(unknown_context_us, 4);
    HC_P(unclassified_us, 4);
    HC_P(complete_context_us, 4);
    HC_P(samples, 2);
    HC_P(readable_samples, 2);
    HC_P(on_samples, 2);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        w.value(c.positive_samples[k], 2);
        w.value(c.evaluable_on_samples[k], 2);
    }
    HC_P(saturated, 1);
#undef HC_P
    w.value(d.lost, 2);
    return w.at == DATA_BYTES;
}
// Output is caller-owned unpublished staging; failure never publishes a partial
// cohort.
inline bool decode_data_into(const uint8_t* b, size_t n, Data& d) {
    if (!b || n != DATA_BYTES || b[0] != METHOD) return false;
    zero_object(d);
    Get r{b};
    (void)r.value(1);
    d.heater = uint8_t(r.value(1));
    d.flags  = uint16_t(r.value(2));
    get_identity(r, d.identity);
    d.first        = uint32_t(r.value(4));
    d.last         = uint32_t(r.value(4));
    d.capabilities = uint16_t(r.value(2));
    d.required     = uint8_t(r.value(1));
    auto& c        = d.counters;
#define HC_G(field, type, n) c.field = type(r.value(n))
    HC_G(readable_us, uint32_t, 4);
    HC_G(on_us, uint32_t, 4);
    HC_G(off_us, uint32_t, 4);
    HC_G(transition_us, uint32_t, 4);
    HC_G(unreadable_us, uint32_t, 4);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        c.positive_us[k]     = uint32_t(r.value(4));
        c.evaluable_on_us[k] = uint32_t(r.value(4));
    }
    HC_G(union_us, uint32_t, 4);
    HC_G(overlap_us, uint32_t, 4);
    HC_G(unknown_context_us, uint32_t, 4);
    HC_G(unclassified_us, uint32_t, 4);
    HC_G(complete_context_us, uint32_t, 4);
    HC_G(samples, uint16_t, 2);
    HC_G(readable_samples, uint16_t, 2);
    HC_G(on_samples, uint16_t, 2);
    for (size_t k = 0; k < hd::CATEGORIES; ++k) {
        c.positive_samples[k]     = uint16_t(r.value(2));
        c.evaluable_on_samples[k] = uint16_t(r.value(2));
    }
#undef HC_G
    const auto saturated = r.value(1);
    if (saturated > 1) return false;
    c.saturated = saturated != 0;
    d.lost      = uint16_t(r.value(2));
    return r.at == DATA_BYTES && valid_data(d);
}
inline bool encode_fence(const Fence& f, uint8_t* out, size_t n) {
    if (!out || n != FENCE_BYTES || !valid_fence(f)) return false;
    Put w{out};
    w.value(METHOD, 1);
    w.value(f.reason, 1);
    w.value(0, 2);
    put_identity(w, f.identity);
    w.value(f.sequence, 8);
    return w.at == n;
}
inline bool decode_fence_into(const uint8_t* b, size_t n, Fence& f) {
    if (!b || n != FENCE_BYTES || b[0] != METHOD || b[2] || b[3]) return false;
    zero_object(f);
    Get r{b};
    (void)r.value(1);
    f.reason = uint8_t(r.value(1));
    (void)r.value(2);
    get_identity(r, f.identity);
    f.sequence = r.value(8);
    return valid_fence(f);
}
inline size_t wire_bytes(Kind k) {
    return k == Kind::Data ? DATA_BYTES : k == Kind::Fence ? FENCE_BYTES : 0;
}
inline uint32_t fingerprint(Kind k) {
    uint32_t crc = checkup_fp_u32(CONFIG_CRC32_INIT, 0x48494e44u);
    for (uint32_t v :
         {uint32_t(METHOD), uint32_t(k), uint32_t(DATA_BYTES), uint32_t(FENCE_BYTES),
          uint32_t(hd::CATEGORIES), uint32_t(hd::MAX_GAP_US), uint32_t(hd::RECOVERY_US),
          uint32_t(hd::NOTICE_US), uint32_t(hd::MILD_TENTHS)})
        crc = checkup_fp_u32(crc, v);
    const auto fp = config_crc32_final(crc);
    return fp ? fp : 1;
}
inline Kind kind(const HistoryJournalHeader& h) {
    if (h.source != uint8_t(HistoryJournalSource::Checkup)) return Kind::Unknown;
    for (auto k : {Kind::Data, Kind::Fence})
        if (h.catalog_fp == heater_independent::fingerprint(k)) return k;
    return Kind::Unknown;
}
inline bool typed(const View& v, Kind k) {
    const size_t n = heater_independent::wire_bytes(k);
    return v.header && v.payload && n && v.capacity >= n && v.physical &&
           history_journal_header_matches(*v.header, heater_independent::fingerprint(k),
                                          uint16_t(n / 2), 3600) &&
           v.header->source == uint8_t(HistoryJournalSource::Checkup) &&
           v.header->crc == history_journal_crc_bytes(*v.header, v.payload, n);
}
} // namespace daik::logic::heater_independent
