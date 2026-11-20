#pragma once
// Single-page flash journal wire encoding for the 24-hour fault/warning trace.
//
// Each checkpoint fits inside one 256-byte HistoryJournalHeader + payload slot so power-loss
// atomicity relies solely on the ordinary journal commit word (`CMIT`). Barriers withdraw older
// snapshots when diagnostics are reset, disabled, or replaced by a different source/model.
#include "logic/cycling_persist.hpp"
#include "logic/fault_trace.hpp"
#include "logic/history_persist.hpp"

#include <cstddef>
#include <cstdint>

namespace daik::logic {

inline constexpr uint32_t FAULT_TRACE_SCHEMA                = 0x31544c46u; // FLT1
inline constexpr uint32_t FAULT_TRACE_BARRIER_SCHEMA        = 0x31524c46u; // FLR1
inline constexpr uint32_t FAULT_MODBUS_TRACE_SCHEMA         = 0x314d4c46u; // FLM1
inline constexpr uint32_t FAULT_MODBUS_TRACE_BARRIER_SCHEMA = 0x31424d46u; // FMB1

struct FaultTracePageInfo {
    CyclingTraceIdentity identity;
    uint32_t             unix_s;
    uint32_t             end_s;
    uint16_t             count;
    uint16_t             reserved;
};
static_assert(sizeof(FaultTracePageInfo) == 24, "fault checkpoint page header layout");

inline constexpr size_t FAULT_TRACE_EVENT_BYTES = 6;
inline constexpr size_t FAULT_TRACE_MAX_EVENTS =
    (HISTORY_JOURNAL_PAYLOAD_BYTES - sizeof(FaultTracePageInfo)) / FAULT_TRACE_EVENT_BYTES;
static_assert(FAULT_TRACE_MAX_EVENTS == 28, "expected 28 packed fault records per single page");
inline constexpr size_t FAULT_TRACE_PAGE_BYTES =
    sizeof(FaultTracePageInfo) + FAULT_TRACE_EVENT_BYTES * FAULT_TRACE_MAX_EVENTS;
static_assert(FAULT_TRACE_PAGE_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES &&
                  FAULT_TRACE_PAGE_BYTES % sizeof(HistorySample) == 0,
              "fault checkpoint page must fill whole journal words");

inline bool fault_trace_header_matches(const HistoryJournalHeader& h, bool is_modbus = false) {
    const uint32_t data_schema = is_modbus ? FAULT_MODBUS_TRACE_SCHEMA : FAULT_TRACE_SCHEMA;
    const uint32_t barrier_schema =
        is_modbus ? FAULT_MODBUS_TRACE_BARRIER_SCHEMA : FAULT_TRACE_BARRIER_SCHEMA;
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           (h.catalog_fp == data_schema || h.catalog_fp == barrier_schema) &&
           history_journal_header_matches(
               h, h.catalog_fp,
               static_cast<uint16_t>(FAULT_TRACE_PAGE_BYTES / sizeof(HistorySample)), CHECKUP_DT_S);
}

inline bool fault_trace_page_valid(const HistoryJournalHeader& h, const FaultTracePageInfo& p,
                                   bool is_modbus = false) {
    const uint32_t barrier_schema =
        is_modbus ? FAULT_MODBUS_TRACE_BARRIER_SCHEMA : FAULT_TRACE_BARRIER_SCHEMA;
    if (!p.unix_s || h.bucket != p.unix_s / CHECKUP_DT_S || p.end_s > CHECKUP_FAULT_WINDOW_S ||
        p.count > FAULT_TRACE_MAX_EVENTS || p.reserved != 0)
        return false;
    if (h.catalog_fp == barrier_schema) {
        return p.count == 0 && p.end_s == 0 && p.identity.model_fp == 0 &&
               p.identity.source_fp == 0 && p.identity.diagnostics_generation == 0;
    }
    return p.count > 0 && p.identity.model_fp != 0 && p.identity.source_fp != 0;
}

inline void fault_trace_pack_record(const CheckupFaultRecord& r,
                                    uint8_t                   bytes[FAULT_TRACE_EVENT_BYTES]) {
    const uint64_t packed = (static_cast<uint64_t>(r.sec) & 0x1FFFFull) |
                            ((static_cast<uint64_t>(r.kind) & 0x7ull) << 17) |
                            ((static_cast<uint64_t>(r.unit) & 0x3ull) << 20) |
                            ((static_cast<uint64_t>(r.code) & 0x7FFull) << 22) |
                            ((static_cast<uint64_t>(r.aux) & 0x7FFFull) << 33);
    for (size_t i = 0; i < FAULT_TRACE_EVENT_BYTES; ++i)
        bytes[i] = static_cast<uint8_t>((packed >> (8u * i)) & 0xFFu);
}

inline CheckupFaultRecord fault_trace_unpack_record(const uint8_t bytes[FAULT_TRACE_EVENT_BYTES]) {
    uint64_t packed = 0;
    for (size_t i = 0; i < FAULT_TRACE_EVENT_BYTES; ++i)
        packed |= static_cast<uint64_t>(bytes[i]) << (8u * i);
    CheckupFaultRecord r;
    r.sec  = static_cast<uint32_t>(packed & 0x1FFFFull);
    r.kind = static_cast<FaultTraceKind>((packed >> 17) & 0x7ull);
    r.unit = static_cast<FaultUnitOrigin>((packed >> 20) & 0x3ull);
    r.code = static_cast<uint16_t>((packed >> 22) & 0x7FFull);
    r.aux  = static_cast<uint16_t>((packed >> 33) & 0x7FFFull);
    return r;
}

// Encode up to FAULT_TRACE_MAX_EVENTS newest records of a normalized snapshot into the wire page.
inline bool fault_trace_encode_page(const CheckupFaultTrace& snap, FaultTracePageInfo& info,
                                    uint8_t* bytes) {
    if (!snap.count || snap.end_s > CHECKUP_FAULT_WINDOW_S) return false;
    const size_t first =
        snap.count > FAULT_TRACE_MAX_EVENTS ? snap.count - FAULT_TRACE_MAX_EVENTS : 0;
    const size_t n    = snap.count - first;
    info.count        = static_cast<uint16_t>(n);
    info.reserved     = 0;
    uint32_t prev_sec = 0;
    for (size_t i = 0; i < n; ++i) {
        const CheckupFaultRecord& r = snap.at(first + i);
        if (!CheckupFaultTrace::record_valid(r, snap.end_s) || (i && r.sec < prev_sec))
            return false;
        prev_sec = r.sec;
        fault_trace_pack_record(r, bytes + i * FAULT_TRACE_EVENT_BYTES);
    }
    return true;
}

inline bool fault_trace_decode_page(CheckupFaultTrace& trace, const FaultTracePageInfo& info,
                                    const uint8_t* bytes) {
    trace.reset();
    if (!info.count || info.count > FAULT_TRACE_MAX_EVENTS || info.end_s > CHECKUP_FAULT_WINDOW_S)
        return false;
    uint32_t prev_sec = 0;
    for (size_t i = 0; i < info.count; ++i) {
        const CheckupFaultRecord r = fault_trace_unpack_record(bytes + i * FAULT_TRACE_EVENT_BYTES);
        if (!CheckupFaultTrace::record_valid(r, info.end_s) || (i && r.sec < prev_sec)) {
            trace.reset();
            return false;
        }
        prev_sec = r.sec;
        trace.push(r.sec, FaultSampleDetail{r.kind, r.unit, r.code, r.aux});
    }
    trace.end_s        = info.end_s;
    trace.window_end_s = CHECKUP_FAULT_WINDOW_S;
    trace.unix_s       = info.unix_s;
    return true;
}

inline constexpr uint32_t CHECKUP_FAULT_HANDOFF_MAGIC   = 0x544c4643u; // "CFLT" little-endian
inline constexpr uint16_t CHECKUP_FAULT_HANDOFF_VERSION = 1;

struct FaultHandoffPayload {
    uint32_t source_fp              = 0;
    uint32_t diagnostics_generation = 0;
    uint32_t unix_s                 = 0;
    uint32_t end_s                  = 0;
    uint16_t count                  = 0;
    uint16_t reserved               = 0;
    uint8_t  events[FAULT_TRACE_MAX_EVENTS * FAULT_TRACE_EVENT_BYTES]{};
};

inline uint32_t fault_handoff_u32(uint32_t crc, uint32_t v) {
    const uint8_t b[4] = {static_cast<uint8_t>(v), static_cast<uint8_t>(v >> 8),
                          static_cast<uint8_t>(v >> 16), static_cast<uint8_t>(v >> 24)};
    return config_crc32_update(crc, b, sizeof(b));
}

inline uint32_t checkup_fault_handoff_crc(uint32_t model_fp, const FaultHandoffPayload& p) {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc          = fault_handoff_u32(crc, model_fp);
    crc          = fault_handoff_u32(crc, p.source_fp);
    crc          = fault_handoff_u32(crc, p.diagnostics_generation);
    crc          = fault_handoff_u32(crc, p.unix_s);
    crc          = fault_handoff_u32(crc, p.end_s);
    crc          = fault_handoff_u32(crc, p.count);
    crc          = fault_handoff_u32(crc, p.reserved);
    const size_t nbytes =
        std::min<size_t>(p.count, FAULT_TRACE_MAX_EVENTS) * FAULT_TRACE_EVENT_BYTES;
    if (nbytes) crc = config_crc32_update(crc, p.events, nbytes);
    return config_crc32_final(crc);
}

inline bool checkup_fault_handoff_encode(const CheckupFaultTrace& snap, uint32_t source_fp,
                                         uint32_t diagnostics_generation, FaultHandoffPayload& p) {
    p                        = FaultHandoffPayload{};
    p.source_fp              = source_fp;
    p.diagnostics_generation = diagnostics_generation;
    p.unix_s                 = snap.unix_s;
    p.end_s                  = snap.end_s;
    FaultTracePageInfo info{};
    info.unix_s = snap.unix_s;
    info.end_s  = snap.end_s;
    if (!fault_trace_encode_page(snap, info, p.events)) return false;
    p.count    = info.count;
    p.reserved = 0;
    return true;
}

struct FaultHandoffPackCtx {
    FaultHandoffPayload* payload  = nullptr;
    bool                 counting = true;
    size_t               total    = 0;
    size_t               idx      = 0;
    size_t               skip     = 0;
    size_t               packed   = 0;
    uint32_t             max_sec  = 0;
    uint32_t             prev_sec = 0;
    bool                 ok       = true;
};

inline void checkup_fault_handoff_pack_emit(void* raw_ctx, uint32_t sec,
                                            const FaultSampleDetail& d) {
    auto* ctx = static_cast<FaultHandoffPackCtx*>(raw_ctx);
    if (ctx->counting) {
        ++ctx->total;
        return;
    }
    const size_t cur_idx = ctx->idx++;
    if (!ctx->ok || cur_idx < ctx->skip || ctx->packed >= FAULT_TRACE_MAX_EVENTS) return;
    const CheckupFaultRecord r{sec, d.kind, d.unit, d.code,
                               static_cast<uint16_t>(d.aux & FAULT_AUX_WIRE_MASK)};
    if (!CheckupFaultTrace::record_valid(r, ctx->max_sec) ||
        (ctx->packed && r.sec < ctx->prev_sec)) {
        ctx->ok = false;
        return;
    }
    ctx->prev_sec = r.sec;
    fault_trace_pack_record(r, ctx->payload->events + ctx->packed * FAULT_TRACE_EVENT_BYTES);
    ++ctx->packed;
}

// Zero-stack-trace encoder for shutdown handoff (mirrors checkup_fault_snapshot +
// checkup_fault_handoff_encode without allocating an intermediate CheckupFaultTrace).
inline bool checkup_fault_handoff_encode_pair(const CheckupFaultTrace& saved,
                                              const CheckupFaultTrace& current, uint32_t unix_s,
                                              uint32_t boot_s, int64_t saved_oldest_unix_s,
                                              int64_t saved_boot_gap_s, uint32_t source_fp,
                                              uint32_t             diagnostics_generation,
                                              FaultHandoffPayload& p, uint32_t& tail_gap_s) {
    p                        = FaultHandoffPayload{};
    p.source_fp              = source_fp;
    p.diagnostics_generation = diagnostics_generation;
    tail_gap_s               = 0;

    FaultHandoffPackCtx ctx{};
    ctx.payload    = &p;
    uint32_t end_s = 0;
    bool     live  = false;
    checkup_fault_walk_pair(saved, current, unix_s, boot_s, saved_oldest_unix_s, saved_boot_gap_s,
                            &checkup_fault_handoff_pack_emit, &ctx, end_s, live);
    if (!ctx.total || end_s > CHECKUP_FAULT_WINDOW_S) return false;

    ctx.counting = false;
    ctx.max_sec  = end_s;
    ctx.skip     = ctx.total > FAULT_TRACE_MAX_EVENTS ? ctx.total - FAULT_TRACE_MAX_EVENTS : 0;
    checkup_fault_walk_pair(saved, current, unix_s, boot_s, saved_oldest_unix_s, saved_boot_gap_s,
                            &checkup_fault_handoff_pack_emit, &ctx, end_s, live);
    if (!ctx.ok || !ctx.packed) return false;
    p.unix_s   = unix_s > boot_s ? unix_s : 0;
    p.end_s    = end_s;
    p.count    = static_cast<uint16_t>(ctx.packed);
    p.reserved = 0;
    if (p.unix_s == 0 && CHECKUP_FAULT_WINDOW_S > p.end_s) {
        tail_gap_s = CHECKUP_FAULT_WINDOW_S - p.end_s;
    }
    return true;
}

inline bool checkup_fault_handoff_valid(uint32_t magic, uint16_t version, uint32_t model_fp,
                                        uint32_t expected_model_fp, uint32_t expected_source_fp,
                                        uint32_t expected_generation, uint32_t stored_crc,
                                        const FaultHandoffPayload& p) {
    return magic == CHECKUP_FAULT_HANDOFF_MAGIC && version == CHECKUP_FAULT_HANDOFF_VERSION &&
           model_fp != 0 && model_fp == expected_model_fp && expected_source_fp != 0 &&
           p.source_fp == expected_source_fp && expected_generation != 0 &&
           p.diagnostics_generation == expected_generation && p.count > 0 &&
           p.count <= FAULT_TRACE_MAX_EVENTS && p.end_s <= CHECKUP_FAULT_WINDOW_S &&
           p.reserved == 0 && stored_crc == checkup_fault_handoff_crc(model_fp, p);
}

inline bool checkup_fault_handoff_decode(CheckupFaultTrace& trace, const FaultHandoffPayload& p) {
    FaultTracePageInfo info{};
    info.unix_s = p.unix_s;
    info.end_s  = p.end_s;
    info.count  = p.count;
    return fault_trace_decode_page(trace, info, p.events);
}

} // namespace daik::logic
