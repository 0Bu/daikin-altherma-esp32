#pragma once

// Cycling checkpoints share the physical Checkup journal envelope but own their wire layout.
// The last page identifies the earlier slots. Each page binds the same first sequence and
// snapshot metadata and is protected by the ordinary journal CRC.
#include "logic/checkup.hpp"
#include "logic/history_persist.hpp"

#include <cstddef>
#include <cstdint>

namespace daik::logic {

inline constexpr uint32_t CYCLING_TRACE_SCHEMA                = 0x31545943u; // CYT1
inline constexpr uint32_t CYCLING_TRACE_BARRIER_SCHEMA        = 0x31525943u; // CYR1
inline constexpr uint32_t CYCLING_MODBUS_TRACE_SCHEMA         = 0x314d5943u; // CYM1
inline constexpr uint32_t CYCLING_MODBUS_TRACE_BARRIER_SCHEMA = 0x31524d43u; // CMR1
inline constexpr uint16_t CYCLING_TRACE_NO_SLOT               = UINT16_MAX;

struct CyclingTraceIdentity {
    uint32_t model_fp               = 0;
    uint32_t source_fp              = 0;
    uint32_t diagnostics_generation = 0;
};

struct CyclingTracePageInfo {
    uint64_t             first_sequence;
    CyclingTraceIdentity identity;
    uint32_t             unix_s;
    uint32_t             end_s;
    uint16_t             count;
    uint16_t             previous[HISTORY_FLASH_CYCLING_MAX_PARTS - 1];
    uint8_t              part;
    uint8_t              reserved[3];
};
static_assert(sizeof(CyclingTracePageInfo) == 40 && offsetof(CyclingTracePageInfo, part) == 36,
              "cycling checkpoint page layout");

inline constexpr size_t CYCLING_TRACE_EVENTS_PER_PART =
    (HISTORY_JOURNAL_PAYLOAD_BYTES - sizeof(CyclingTracePageInfo)) / 3;
inline constexpr size_t CYCLING_TRACE_PAGE_BYTES =
    sizeof(CyclingTracePageInfo) + 3 * CYCLING_TRACE_EVENTS_PER_PART;
static_assert(CYCLING_TRACE_PAGE_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES &&
                  CYCLING_TRACE_PAGE_BYTES % sizeof(HistorySample) == 0,
              "cycling checkpoint page must fill whole journal words");

inline constexpr size_t cycling_trace_part_count(size_t count) {
    return count ? (count - 1) / CYCLING_TRACE_EVENTS_PER_PART + 1 : 1;
}
static_assert(cycling_trace_part_count(CheckupCyclingTrace::capacity) ==
                  HISTORY_FLASH_CYCLING_MAX_PARTS,
              "complete cycling checkpoint must fit the allowed journal pages");

inline bool cycling_trace_record_valid(uint32_t record, uint32_t end_s) {
    return CheckupCyclingTrace::second(record) <= end_s &&
           CheckupCyclingTrace::kind(record) <= CheckupCyclingTrace::Stop;
}

inline bool cycling_trace_header_matches_schema(const HistoryJournalHeader& h, uint32_t data_schema,
                                                uint32_t barrier_schema) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           (h.catalog_fp == data_schema || h.catalog_fp == barrier_schema) &&
           history_journal_header_matches(
               h, h.catalog_fp,
               static_cast<uint16_t>(CYCLING_TRACE_PAGE_BYTES / sizeof(HistorySample)),
               CHECKUP_DT_S);
}

inline bool cycling_trace_header_matches(const HistoryJournalHeader& h, bool is_modbus = false) {
    return cycling_trace_header_matches_schema(
        h, is_modbus ? CYCLING_MODBUS_TRACE_SCHEMA : CYCLING_TRACE_SCHEMA,
        is_modbus ? CYCLING_MODBUS_TRACE_BARRIER_SCHEMA : CYCLING_TRACE_BARRIER_SCHEMA);
}

inline bool cycling_modbus_trace_header_matches(const HistoryJournalHeader& h) {
    return cycling_trace_header_matches(h, true);
}

inline bool cycling_trace_page_valid_schema(const HistoryJournalHeader& h,
                                            const CyclingTracePageInfo& p,
                                            uint32_t                    barrier_schema) {
    if (p.first_sequence == 0 || p.first_sequence > h.sequence ||
        (p.part == 0) != (p.first_sequence == h.sequence) || !p.unix_s ||
        h.bucket != p.unix_s / CHECKUP_DT_S || p.end_s > CHECKUP_WINDOW_S ||
        p.count > CheckupCyclingTrace::capacity || p.part >= cycling_trace_part_count(p.count) ||
        p.reserved[0] || p.reserved[1] || p.reserved[2])
        return false;
    if (h.catalog_fp == barrier_schema) {
        if (p.count || p.end_s || p.identity.model_fp || p.identity.source_fp ||
            p.identity.diagnostics_generation)
            return false;
    } else if (!p.count || !p.identity.model_fp || !p.identity.source_fp) {
        return false;
    }
    const bool final = p.part + 1u == cycling_trace_part_count(p.count);
    for (size_t i = 0; i < HISTORY_FLASH_CYCLING_MAX_PARTS - 1; ++i) {
        if (final && i < p.part) {
            if (p.previous[i] >= HISTORY_JOURNAL_SLOT_COUNT) return false;
        } else if (p.previous[i] != CYCLING_TRACE_NO_SLOT) {
            return false;
        }
    }
    return true;
}

inline bool cycling_trace_page_valid(const HistoryJournalHeader& h, const CyclingTracePageInfo& p,
                                     bool is_modbus = false) {
    return cycling_trace_page_valid_schema(
        h, p, is_modbus ? CYCLING_MODBUS_TRACE_BARRIER_SCHEMA : CYCLING_TRACE_BARRIER_SCHEMA);
}

inline bool cycling_modbus_trace_page_valid(const HistoryJournalHeader& h,
                                            const CyclingTracePageInfo& p) {
    return cycling_trace_page_valid(h, p, true);
}

inline bool cycling_trace_group_matches(const CyclingTracePageInfo& final,
                                        const CyclingTracePageInfo& part) {
    return part.first_sequence == final.first_sequence &&
           part.identity.model_fp == final.identity.model_fp &&
           part.identity.source_fp == final.identity.source_fp &&
           part.identity.diagnostics_generation == final.identity.diagnostics_generation &&
           part.unix_s == final.unix_s && part.end_s == final.end_s && part.count == final.count;
}

inline size_t cycling_trace_part_events(const CyclingTracePageInfo& p) {
    const size_t remaining = p.count - p.part * CYCLING_TRACE_EVENTS_PER_PART;
    return remaining < CYCLING_TRACE_EVENTS_PER_PART ? remaining : CYCLING_TRACE_EVENTS_PER_PART;
}

// Three explicit bytes per record. Position within 24 hours needs 17 bits and kind needs three.
inline bool cycling_trace_encode_part(const CheckupCyclingTrace&  trace,
                                      const CyclingTracePageInfo& p, uint8_t* bytes) {
    const size_t first = p.part * CYCLING_TRACE_EVENTS_PER_PART;
    for (size_t i = 0; i < cycling_trace_part_events(p); ++i) {
        const uint32_t record = trace.at(first + i);
        if (!cycling_trace_record_valid(record, p.end_s)) return false;
        bytes[3 * i]     = static_cast<uint8_t>(record);
        bytes[3 * i + 1] = static_cast<uint8_t>(record >> 8);
        bytes[3 * i + 2] = static_cast<uint8_t>(record >> 16);
    }
    return true;
}

// Caller presents validated pages in part order. A point may share an interval boundary's time,
// so preserve equal timestamps in wire order.
inline bool cycling_trace_decode_part(CheckupCyclingTrace& trace, const CyclingTracePageInfo& p,
                                      const uint8_t* bytes) {
    const size_t first = p.part * CYCLING_TRACE_EVENTS_PER_PART;
    if (trace.count != first) return false;
    for (size_t i = 0; i < cycling_trace_part_events(p); ++i) {
        const uint32_t record = static_cast<uint32_t>(bytes[3 * i]) |
                                (static_cast<uint32_t>(bytes[3 * i + 1]) << 8) |
                                (static_cast<uint32_t>(bytes[3 * i + 2]) << 16);
        const uint32_t sec = CheckupCyclingTrace::second(record);
        if (!cycling_trace_record_valid(record, p.end_s) ||
            (trace.count && sec < CheckupCyclingTrace::second(trace.at(trace.count - 1))))
            return false;
        trace.push(sec, CheckupCyclingTrace::kind(record));
    }
    return true;
}

} // namespace daik::logic
