#pragma once
// One atomic history-journal page per source for exact completed DHW windows.
#include "logic/dhw_loss_trace.hpp"
#include "logic/history_persist.hpp"

namespace daik::logic {

constexpr uint32_t dhw_loss_trace_schema(bool is_modbus, bool barrier) {
    if (is_modbus) return barrier ? 0x32524d44u : 0x32544d44u; // DMR2 / DMT2
    return barrier ? 0x32525844u : 0x32545844u;                // DXR2 / DXT2
}

struct DhwLossTracePage {
    uint32_t model_fp;
    uint32_t source_fp;
    uint32_t dhw_source_fp;
    uint32_t diagnostics_generation;
    uint32_t unix_s;
    uint32_t damaged_barriers_fp; // Writer's view of damaged reset records, data pages only.
    uint8_t  count;
    uint8_t  reserved[3];
    uint8_t  records[DHW_LOSS_TRACE_CAPACITY][6];
};
static_assert(sizeof(DhwLossTracePage) == 172 &&
              sizeof(DhwLossTracePage) <= HISTORY_JOURNAL_PAYLOAD_BYTES &&
              sizeof(DhwLossTracePage) % sizeof(HistorySample) == 0);

inline bool dhw_loss_trace_header_matches(const HistoryJournalHeader& h, bool is_modbus) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           (h.catalog_fp == dhw_loss_trace_schema(is_modbus, false) ||
            h.catalog_fp == dhw_loss_trace_schema(is_modbus, true)) &&
           history_journal_header_matches(h, h.catalog_fp,
                                          sizeof(DhwLossTracePage) / sizeof(HistorySample), 3600);
}

inline bool dhw_loss_trace_pack(uint8_t (&bytes)[6], const DhwLossTraceWindow& w,
                                uint32_t frame_end_s) {
    if (w.start_s > w.end_s || w.end_s > frame_end_s) return false;
    const uint32_t age      = frame_end_s - w.end_s;
    const uint32_t duration = w.end_s - w.start_s;
    const uint8_t  circ     = static_cast<uint8_t>(w.circ);
    if (age >= DHW_LOSS_TRACE_WINDOW_S || duration < DHW_LOSS_TRACE_MIN_DURATION_S ||
        duration > DHW_LOSS_TRACE_MAX_DURATION_S || w.observed_s > duration ||
        w.rate_tenths > 900 || circ > 3u)
        return false;
    const uint64_t bits = age | (uint64_t{duration - DHW_LOSS_TRACE_MIN_DURATION_S} << 17) |
                          (uint64_t{w.observed_s} << 22) | (uint64_t{w.rate_tenths} << 34) |
                          (uint64_t{w.pump_marker} << 44) | (uint64_t{w.draw_marker} << 45) |
                          (uint64_t{circ} << 46);
    for (size_t i = 0; i < sizeof(bytes); ++i) bytes[i] = static_cast<uint8_t>(bits >> (8 * i));
    return true;
}

// Decode in a frame with room for an entire rolling day and the oldest window's start.
inline bool dhw_loss_trace_unpack(const uint8_t (&bytes)[6], uint32_t frame_end_s,
                                  DhwLossTraceWindow& w) {
    uint64_t bits = 0;
    for (size_t i = 0; i < sizeof(bytes); ++i) bits |= uint64_t{bytes[i]} << (8 * i);
    const auto age      = static_cast<uint32_t>(bits & 0x1ffff);
    const auto duration = DHW_LOSS_TRACE_MIN_DURATION_S + static_cast<uint32_t>((bits >> 17) & 31);
    const auto observed = static_cast<uint16_t>((bits >> 22) & 0xfff);
    const auto rate     = static_cast<uint16_t>((bits >> 34) & 0x3ff);
    const auto circ     = static_cast<DhwCircState>((bits >> 46) & 3u);
    if (age >= DHW_LOSS_TRACE_WINDOW_S || age + duration > frame_end_s || observed > duration ||
        rate > 900)
        return false;
    const uint32_t end = frame_end_s - age;
    w                  = {end - duration,
                          end,
                          rate,
                          observed,
                          (bits & (1ull << 44)) != 0,
                          (bits & (1ull << 45)) != 0,
                          circ};
    return true;
}

inline bool dhw_loss_trace_page_valid(const DhwLossTracePage& page, bool barrier) {
    for (uint8_t byte : page.reserved)
        if (byte) return false;
    if (barrier)
        return !page.count && !page.unix_s && !page.model_fp && !page.source_fp &&
               !page.dhw_source_fp && !page.diagnostics_generation;
    if (!page.unix_s || !page.model_fp || !page.source_fp || !page.diagnostics_generation ||
        !page.count || page.count > DHW_LOSS_TRACE_CAPACITY)
        return false;

    uint32_t previous_end = 0;
    for (size_t i = 0; i < page.count; ++i) {
        DhwLossTraceWindow w;
        if (!dhw_loss_trace_unpack(page.records[i], DHW_LOSS_TRACE_RESTORE_OFFSET_S, w) ||
            w.start_s < previous_end)
            return false;
        previous_end = w.end_s;
    }
    return true;
}

inline bool dhw_loss_trace_restore(DhwLossTrace& trace, const DhwLossTracePage& page,
                                   uint32_t now_s, uint32_t unix_s) {
    constexpr uint32_t offset = DHW_LOSS_TRACE_RESTORE_OFFSET_S;
    if (trace.frame_offset_s || now_s > UINT32_MAX - offset || unix_s < now_s ||
        page.unix_s > unix_s - now_s || !dhw_loss_trace_page_valid(page, false))
        return false;
    const uint32_t age_of_page = unix_s - page.unix_s;
    if (age_of_page >= DHW_LOSS_TRACE_WINDOW_S) return false;
    const uint32_t checkpoint_frame = offset + now_s - age_of_page;
    trace.expire(now_s);
    for (size_t i = page.count; i > 0; --i) {
        DhwLossTraceWindow w;
        if (!dhw_loss_trace_unpack(page.records[i - 1], checkpoint_frame, w) ||
            w.end_s <= offset + now_s - DHW_LOSS_TRACE_WINDOW_S)
            break;
        if (!trace.frame_offset_s) trace.extend_frame_for_restore(now_s);
        trace.prepend_restored(w);
    }
    return trace.frame_offset_s != 0;
}

} // namespace daik::logic
