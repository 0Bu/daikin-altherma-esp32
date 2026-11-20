#pragma once
// Second-resolution fault/warning history for the rolling 24-hour Plant diagnostics row.
//
// Each interval records the highest active severity, unit origin (outdoor/indoor on X10A), packed
// 2-character Daikin code, and optional Modbus sub-code or secondary X10A code. Missing/unreadable
// polls record explicit Gap intervals so silent buses never merge separate events or look clear.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>

#include "fault_state.hpp"

namespace daik::logic {

inline constexpr uint32_t CHECKUP_FAULT_WINDOW_S = 24u * 3600u;
inline constexpr uint32_t CHECKUP_FAULT_GAP_S    = 15u;
inline constexpr uint8_t  CHECKUP_FAULT_FLAG_ERR = 1u << 0; // matches CHECKUP_F_FAULT
inline constexpr uint8_t  CHECKUP_FAULT_FLAG_WRN = 1u << 1; // matches CHECKUP_F_WARNING

enum class FaultTraceKind : uint8_t {
    Gap     = 0,
    Normal  = 1,
    Caution = 2,
    Warning = 3,
    Error   = 4,
};

enum class FaultUnitOrigin : uint8_t {
    Unspecified = 0,
    Outdoor     = 1,
    Indoor      = 2,
    Both        = 3,
};

inline constexpr bool fault_trace_kind_active(FaultTraceKind kind) {
    return kind == FaultTraceKind::Caution || kind == FaultTraceKind::Warning ||
           kind == FaultTraceKind::Error;
}

inline constexpr uint8_t fault_code_char_index(char ch) {
    if (ch >= '0' && ch <= '9') return static_cast<uint8_t>(1 + (ch - '0'));
    if (ch >= 'A' && ch <= 'Z') return static_cast<uint8_t>(11 + (ch - 'A'));
    if (ch >= 'a' && ch <= 'z') return static_cast<uint8_t>(11 + (ch - 'a'));
    return 0;
}

inline constexpr char fault_code_char_from_index(uint8_t idx) {
    if (idx >= 1 && idx <= 10) return static_cast<char>('0' + (idx - 1));
    if (idx >= 11 && idx <= 36) return static_cast<char>('A' + (idx - 11));
    return '\0';
}

// Pack a 1- or 2-character Daikin error code ("U4", "7H", "9", or "U4: description") into 1..1368.
// Returns 0 for empty, "0", "00", placeholders ("-", "--", "?"), or non-code text ("Normal").
inline uint16_t fault_code_pack(const char* text) {
    if (!text) return 0;
    while (*text == ' ' || *text == '\t') ++text;
    const uint8_t c1 = fault_code_char_index(text[0]);
    if (!c1) return 0;
    auto is_delim = [](char ch) {
        return ch == '\0' || ch == ':' || ch == ' ' || ch == '\t' || ch == '-';
    };
    if (is_delim(text[1])) {
        if (text[0] == '0') return 0;
        return static_cast<uint16_t>(c1 * 37u);
    }
    const uint8_t c2 = fault_code_char_index(text[1]);
    if (!c2 || !is_delim(text[2])) return 0;
    if (text[0] == '0' && text[1] == '0') return 0;
    return static_cast<uint16_t>(c1 * 37u + c2);
}

inline bool fault_code_unpack(uint16_t packed, char out[3]) {
    if (!out) return false;
    out[0] = '\0';
    if (packed == 0 || packed > 36u * 37u + 36u) return false;
    const uint8_t c1 = static_cast<uint8_t>(packed / 37u);
    const uint8_t c2 = static_cast<uint8_t>(packed % 37u);
    const char    a  = fault_code_char_from_index(c1);
    if (!a) return false;
    out[0] = a;
    if (c2) {
        const char b = fault_code_char_from_index(c2);
        if (!b) {
            out[0] = '\0';
            return false;
        }
        out[1] = b;
        out[2] = '\0';
    } else {
        out[1] = '\0';
    }
    return true;
}

// Aux packing (fits in 15 bits: bits 0..14):
// - Bit 14 (0x4000): secondary X10A code present alongside primary (bits 12..13 = kind - Caution,
//                    bits 0..10 = secondary packed code <= 1368).
// - Bit 13 (0x2000, when bit 14 == 0): Modbus subcode present (bits 0..12 = subcode 1..999).
inline constexpr uint16_t FAULT_AUX_SECONDARY_FLAG = 0x4000u;
inline constexpr uint16_t FAULT_AUX_SUBCODE_FLAG   = 0x2000u;
inline constexpr uint16_t FAULT_AUX_WIRE_MASK      = 0x7FFFu;

inline constexpr uint16_t fault_aux_subcode(int subcode) {
    if (subcode <= 0 || subcode > 999) return 0;
    return static_cast<uint16_t>(FAULT_AUX_SUBCODE_FLAG | static_cast<uint16_t>(subcode));
}

inline constexpr uint16_t fault_aux_get_subcode(uint16_t aux) {
    if ((aux & FAULT_AUX_SECONDARY_FLAG) != 0 || (aux & FAULT_AUX_SUBCODE_FLAG) == 0) return 0;
    const uint16_t sub = static_cast<uint16_t>(aux & 0x1FFFu);
    return (sub > 0 && sub <= 999) ? sub : 0;
}

inline constexpr uint16_t fault_aux_secondary(FaultTraceKind kind, uint16_t code) {
    if (!fault_trace_kind_active(kind) || code == 0 || code > 36u * 37u + 36u) return 0;
    const uint16_t k = static_cast<uint16_t>(static_cast<uint8_t>(kind) -
                                             static_cast<uint8_t>(FaultTraceKind::Caution));
    return static_cast<uint16_t>(FAULT_AUX_SECONDARY_FLAG | ((k & 3u) << 12) | (code & 0x07FFu));
}

inline constexpr bool fault_aux_get_secondary(uint16_t aux, FaultTraceKind& kind_out,
                                              uint16_t& code_out) {
    if ((aux & FAULT_AUX_SECONDARY_FLAG) == 0) return false;
    const uint8_t  k = static_cast<uint8_t>((aux >> 12) & 3u);
    const uint16_t c = static_cast<uint16_t>(aux & 0x07FFu);
    if (k > 2 || c == 0 || c > 36u * 37u + 36u) return false;
    kind_out = static_cast<FaultTraceKind>(static_cast<uint8_t>(FaultTraceKind::Caution) + k);
    code_out = c;
    return true;
}

inline size_t fault_code_format(uint16_t packed, uint16_t aux, char out[10]) {
    if (!out) return 0;
    char base[3] = {};
    if (!fault_code_unpack(packed, base)) {
        out[0] = '\0';
        return 0;
    }
    const uint16_t sub = fault_aux_get_subcode(aux);
    if (sub > 0) {
        const int n = std::snprintf(out, 10, sub < 100 ? "%s-%02u" : "%s-%u", base,
                                    static_cast<unsigned>(sub));
        return n > 0 ? static_cast<size_t>(n) : 0;
    }
    const int n = std::snprintf(out, 10, "%s", base);
    return n > 0 ? static_cast<size_t>(n) : 0;
}

struct FaultSampleDetail {
    FaultTraceKind  kind = FaultTraceKind::Gap;
    FaultUnitOrigin unit = FaultUnitOrigin::Unspecified;
    uint16_t        code = 0;
    uint16_t        aux  = 0;

    bool operator==(const FaultSampleDetail& o) const {
        return kind == o.kind && unit == o.unit && code == o.code && aux == o.aux;
    }
    bool operator!=(const FaultSampleDetail& o) const { return !(*this == o); }
};

inline constexpr FaultTraceKind fault_trace_kind_from_class(FaultClass c) {
    if (c == FaultClass::Error) return FaultTraceKind::Error;
    if (c == FaultClass::Warning) return FaultTraceKind::Warning;
    if (c == FaultClass::Caution) return FaultTraceKind::Caution;
    return FaultTraceKind::Gap;
}

inline FaultSampleDetail checkup_x10a_fault_detail(FaultClass overall, FaultClass out_cls,
                                                   uint16_t out_code, FaultClass in_cls,
                                                   uint16_t in_code, uint16_t other_code) {
    FaultSampleDetail detail{FaultTraceKind::Gap};
    if (overall == FaultClass::Unknown) return detail;
    const auto ok = fault_trace_kind_from_class(out_cls);
    const auto ik = fault_trace_kind_from_class(in_cls);
    const bool oa = fault_trace_kind_active(ok);
    const bool ia = fault_trace_kind_active(ik);
    if (oa && ia) {
        const bool out_primary = (ok >= ik);
        detail.kind            = out_primary ? ok : ik;
        detail.code            = out_primary ? out_code : in_code;
        const auto     sec_k   = out_primary ? ik : ok;
        const uint16_t sec_c   = out_primary ? in_code : out_code;
        if (sec_k == detail.kind && sec_c == detail.code) {
            detail.unit = FaultUnitOrigin::Both;
        } else {
            detail.unit = out_primary ? FaultUnitOrigin::Outdoor : FaultUnitOrigin::Indoor;
            detail.aux  = fault_aux_secondary(sec_k, sec_c);
        }
        return detail;
    }
    if (oa) {
        detail.kind = ok;
        detail.unit = FaultUnitOrigin::Outdoor;
        detail.code = out_code;
        return detail;
    }
    if (ia) {
        detail.kind = ik;
        detail.unit = FaultUnitOrigin::Indoor;
        detail.code = in_code;
        return detail;
    }
    if (fault_error_active(overall) || fault_warning_active(overall)) {
        detail.kind = fault_trace_kind_from_class(overall);
        detail.unit = FaultUnitOrigin::Unspecified;
        detail.code = other_code;
        return detail;
    }
    detail.kind = FaultTraceKind::Normal;
    return detail;
}

inline FaultSampleDetail checkup_modbus_fault_detail(FaultClass overall, uint16_t fault_code,
                                                     uint16_t fault_sub) {
    if (fault_error_active(overall)) {
        return {FaultTraceKind::Error, FaultUnitOrigin::Unspecified, fault_code,
                fault_aux_subcode(fault_sub)};
    }
    if (fault_warning_active(overall)) {
        return {FaultTraceKind::Warning, FaultUnitOrigin::Unspecified, fault_code,
                fault_aux_subcode(fault_sub)};
    }
    if (overall == FaultClass::Normal) {
        return {FaultTraceKind::Normal};
    }
    return {FaultTraceKind::Gap};
}

struct CheckupFaultRecord {
    uint32_t        sec  = 0;
    FaultTraceKind  kind = FaultTraceKind::Gap;
    FaultUnitOrigin unit = FaultUnitOrigin::Unspecified;
    uint16_t        code = 0;
    uint16_t        aux  = 0;
};

struct CheckupFaultTrace {
    static constexpr size_t   capacity   = 64;
    static constexpr uint32_t max_second = UINT32_MAX >> 3;
    CheckupFaultRecord        records[capacity]{};
    uint32_t                  end_s = 0, window_end_s = 0, unix_s = 0, boot_s = 0;
    uint16_t                  head = 0, count = 0;
    FaultSampleDetail         state{};
    bool                      live = false;

    void reset() {
        head = count = 0;
        end_s = window_end_s = unix_s = boot_s = 0;
        state                                  = FaultSampleDetail{};
        live                                   = false;
    }

    const CheckupFaultRecord& at(size_t i) const {
        return records[(head + capacity - count + i) % capacity];
    }

    static bool record_valid(const CheckupFaultRecord& r, uint32_t max_sec) {
        return r.sec <= max_sec &&
               static_cast<uint8_t>(r.kind) <= static_cast<uint8_t>(FaultTraceKind::Error) &&
               static_cast<uint8_t>(r.unit) <= static_cast<uint8_t>(FaultUnitOrigin::Both) &&
               r.code <= 36u * 37u + 36u && (r.aux & ~FAULT_AUX_WIRE_MASK) == 0;
    }

    void push(uint32_t sec, const FaultSampleDetail& d) {
        if (sec > max_second) return;
        records[head] = CheckupFaultRecord{sec, d.kind, d.unit, d.code,
                                           static_cast<uint16_t>(d.aux & FAULT_AUX_WIRE_MASK)};
        head          = static_cast<uint16_t>((head + 1) % capacity);
        if (count < capacity) ++count;
    }

    bool record(int64_t now_us, const FaultSampleDetail& next) {
        if (now_us < 0 || now_us / 1000000 > max_second) return false;
        const auto now = static_cast<uint32_t>(now_us / 1000000);
        if (count == 0) {
            state = next;
            end_s = now;
            if (next.kind == FaultTraceKind::Gap) return false;
            push(now, next);
            return true;
        }
        const uint32_t clamped_now = now < end_s ? end_s : now;
        bool           changed     = false;
        if (clamped_now > end_s && (clamped_now - end_s) > CHECKUP_FAULT_GAP_S &&
            state.kind != FaultTraceKind::Gap) {
            push(end_s, FaultSampleDetail{FaultTraceKind::Gap});
            state   = FaultSampleDetail{};
            changed = true;
        }
        if (next != state) {
            // Normal->Normal or Gap->Gap already coalesced; transition at clamped_now.
            if (next.kind != FaultTraceKind::Gap || state.kind != FaultTraceKind::Gap) {
                push(clamped_now, next);
                changed = true;
            }
            state = next;
        }
        end_s = clamped_now;
        return changed;
    }

    void observe_window(uint32_t now) {
        const uint32_t cutoff = now > CHECKUP_FAULT_WINDOW_S ? now - CHECKUP_FAULT_WINDOW_S : 0;
        size_t         remove = 0;
        for (size_t i = 0; i < count; ++i) {
            if (at(i).sec >= cutoff) break;
            remove = i;
        }
        count = static_cast<uint16_t>(count - remove);
    }
};

// Traverse saved (warm .noinit or dated Flash) + current-boot fault traces onto [0..86400] without
// template/lambda duplication so snapshot construction and .noinit shutdown handoff share one copy.
inline void checkup_fault_walk_pair(const CheckupFaultTrace& saved,
                                    const CheckupFaultTrace& current, uint32_t unix_s,
                                    uint32_t boot_s, int64_t saved_oldest_unix_s,
                                    int64_t saved_boot_gap_s,
                                    void (*emit)(void*, uint32_t, const FaultSampleDetail&),
                                    void* ctx, uint32_t& out_end_s, bool& out_live) {
    out_end_s       = 0;
    out_live        = false;
    bool have_any   = false;
    bool last_gap   = false;
    auto push_entry = [&](uint32_t sec, const FaultSampleDetail& d) {
        emit(ctx, sec, d);
        have_any = true;
        last_gap = (d.kind == FaultTraceKind::Gap);
    };
    auto feed = [&](const CheckupFaultTrace& trace, int64_t shift, int64_t cutoff) {
        FaultSampleDetail leading{};
        bool              have_leading = false;
        bool              first        = true;
        for (size_t i = 0; i < trace.count; ++i) {
            const auto&       r = trace.at(i);
            FaultSampleDetail d{r.kind, r.unit, r.code, r.aux};
            const int64_t     at = shift + static_cast<int64_t>(r.sec);
            if (at < cutoff) {
                leading      = d;
                have_leading = true;
                continue;
            }
            if (first && at > cutoff && have_leading && leading.kind != FaultTraceKind::Gap) {
                push_entry(static_cast<uint32_t>(cutoff), leading);
            }
            first = false;
            push_entry(static_cast<uint32_t>(at), d);
        }
        if (first && have_leading && leading.kind != FaultTraceKind::Gap) {
            push_entry(static_cast<uint32_t>(cutoff), leading);
        }
    };

    const int64_t live_offset = static_cast<int64_t>(CHECKUP_FAULT_WINDOW_S) - boot_s;
    if (unix_s > boot_s && saved.count && saved.unix_s > 0 && saved.unix_s <= unix_s) {
        const int64_t saved_offset = static_cast<int64_t>(saved.unix_s) - unix_s;
        const int64_t saved_end    = saved_offset + saved.end_s;
        const int64_t saved_cutoff =
            std::max<int64_t>(0, saved_oldest_unix_s - unix_s + CHECKUP_FAULT_WINDOW_S);
        if (saved_end >= saved_cutoff && saved_end <= live_offset) {
            feed(saved, saved_offset, saved_cutoff);
            out_end_s = static_cast<uint32_t>(saved_end);
        }
    } else if (saved.count && saved.unix_s == 0 && saved_boot_gap_s >= 0) {
        // Warm .noinit handoff created before SNTP synced.
        const int64_t saved_end    = live_offset - saved_boot_gap_s;
        const int64_t saved_offset = saved_end - saved.end_s;
        if (saved_end >= 0 && saved_end <= live_offset) {
            feed(saved, saved_offset, 0);
            out_end_s = static_cast<uint32_t>(saved_end);
        }
    }

    if (current.count && current.end_s <= boot_s && live_offset + current.end_s >= 0) {
        if (have_any && !last_gap) push_entry(out_end_s, FaultSampleDetail{FaultTraceKind::Gap});
        feed(current, live_offset, 0);
        out_end_s = static_cast<uint32_t>(live_offset + current.end_s);
        out_live  = true;
    }
}

inline void checkup_fault_snapshot_emit(void* ctx, uint32_t sec, const FaultSampleDetail& d) {
    static_cast<CheckupFaultTrace*>(ctx)->push(sec, d);
}

// Normalize saved (warm .noinit or dated Flash) + current-boot fault traces onto [0..86400].
// Works both with wall-clock time (`unix_s > boot_s`) and before SNTP sync (`unix_s == 0`) when
// `saved` is a warm same-session handoff with `saved_boot_gap_s >= 0`.
inline void checkup_fault_snapshot(CheckupFaultTrace& out, const CheckupFaultTrace& saved,
                                   const CheckupFaultTrace& current, uint32_t unix_s,
                                   uint32_t boot_s, int64_t saved_oldest_unix_s,
                                   int64_t saved_boot_gap_s = -1) {
    out.reset();
    out.window_end_s = CHECKUP_FAULT_WINDOW_S;
    out.boot_s       = boot_s;
    out.unix_s       = 0;
    checkup_fault_walk_pair(saved, current, unix_s, boot_s, saved_oldest_unix_s, saved_boot_gap_s,
                            &checkup_fault_snapshot_emit, &out, out.end_s, out.live);
    if (out.count) out.unix_s = unix_s > boot_s ? unix_s : 0;
}

inline uint8_t checkup_fault_record_flags(const CheckupFaultRecord& r) {
    uint8_t flags = 0;
    if (r.kind == FaultTraceKind::Error) {
        flags |= CHECKUP_FAULT_FLAG_ERR;
    } else if (r.kind == FaultTraceKind::Warning || r.kind == FaultTraceKind::Caution) {
        flags |= CHECKUP_FAULT_FLAG_WRN;
    }
    FaultTraceKind sec_kind = FaultTraceKind::Gap;
    uint16_t       sec_code = 0;
    if (fault_aux_get_secondary(r.aux, sec_kind, sec_code)) {
        if (sec_kind == FaultTraceKind::Error)
            flags |= CHECKUP_FAULT_FLAG_ERR;
        else if (fault_trace_kind_active(sec_kind))
            flags |= CHECKUP_FAULT_FLAG_WRN;
    }
    return flags;
}

inline uint8_t checkup_fault_window_flags(const CheckupFaultTrace& snap) {
    uint8_t flags = 0;
    for (size_t i = 0; i < snap.count; ++i) {
        const auto& r = snap.at(i);
        if (r.sec > snap.end_s) break;
        flags |= checkup_fault_record_flags(r);
    }
    return flags;
}

inline uint8_t checkup_fault_saved_window_flags(const CheckupFaultTrace& saved, uint32_t unix_s,
                                                uint32_t boot_s, int64_t saved_oldest_unix_s,
                                                int64_t saved_boot_gap_s = -1) {
    if (!saved.count) return 0;
    const int64_t live_offset = static_cast<int64_t>(CHECKUP_FAULT_WINDOW_S) - boot_s;
    int64_t       shift       = 0;
    int64_t       cutoff      = 0;
    int64_t       saved_end   = -1;
    if (unix_s > boot_s && saved.unix_s > 0 && saved.unix_s <= unix_s) {
        shift     = static_cast<int64_t>(saved.unix_s) - unix_s;
        saved_end = shift + saved.end_s;
        cutoff    = std::max<int64_t>(0, saved_oldest_unix_s - unix_s + CHECKUP_FAULT_WINDOW_S);
    } else if (saved.unix_s == 0 && saved_boot_gap_s >= 0) {
        saved_end = live_offset - saved_boot_gap_s;
        shift     = saved_end - saved.end_s;
        cutoff    = 0;
    }
    if (saved_end < cutoff || saved_end > live_offset || saved_end <= 0) return 0;
    uint8_t flags = 0;
    for (size_t i = 0; i < saved.count; ++i) {
        const auto&   r  = saved.at(i);
        const uint8_t rf = checkup_fault_record_flags(r);
        if (!rf) continue;
        const int64_t seg_start = shift + r.sec;
        const int64_t seg_end   = (i + 1 < saved.count) ? shift + saved.at(i + 1).sec : saved_end;
        if (seg_end > cutoff || (seg_end == seg_start && seg_end == cutoff)) flags |= rf;
    }
    return flags;
}

struct CheckupFaultLatest {
    bool            present      = false;
    bool            ongoing      = false;
    bool            stop_unknown = false;
    FaultTraceKind  kind         = FaultTraceKind::Gap;
    FaultUnitOrigin unit         = FaultUnitOrigin::Unspecified;
    uint16_t        code         = 0;
    uint16_t        aux          = 0;
    uint32_t        start_s      = 0;
    uint32_t        stop_s       = 0;
    uint32_t        age_s        = 0; // elapsed since start (ongoing) or since end (past)
    uint32_t        duration_s   = 0;
    uint32_t        start_unix_s = 0;
    uint32_t        end_unix_s   = 0;
};

inline constexpr const char* fault_trace_kind_name(FaultTraceKind k) {
    switch (k) {
    case FaultTraceKind::Error:
        return "error";
    case FaultTraceKind::Warning:
        return "warning";
    case FaultTraceKind::Caution:
        return "caution";
    case FaultTraceKind::Normal:
        return "normal";
    default:
        return "gap";
    }
}

inline constexpr const char* fault_unit_origin_name(FaultUnitOrigin u) {
    switch (u) {
    case FaultUnitOrigin::Outdoor:
        return "outdoor";
    case FaultUnitOrigin::Indoor:
        return "indoor";
    case FaultUnitOrigin::Both:
        return "both";
    default:
        return "";
    }
}

// Extract the active or most recent fault/warning episode from a normalized [0..86400] snapshot.
inline CheckupFaultLatest checkup_fault_latest_extract(const CheckupFaultTrace& snap,
                                                       bool                     source_fresh) {
    CheckupFaultLatest out;
    if (!snap.count || snap.window_end_s == 0) return out;
    const uint32_t win_end = snap.window_end_s;
    const uint32_t obs_end = std::min(snap.end_s, win_end);

    bool     in_ep       = false;
    bool     can_merge   = false;
    size_t   ep_idx      = 0;
    size_t   ep_last_idx = 0;
    uint32_t ep_start    = 0;
    uint32_t ep_stop     = 0;

    for (size_t i = 0; i < snap.count; ++i) {
        const auto&    r = snap.at(i);
        const uint32_t next_sec =
            (i + 1 < snap.count) ? std::min(snap.at(i + 1).sec, obs_end) : obs_end;
        if (!fault_trace_kind_active(r.kind)) {
            // Intervening Normal or Gap breaks contiguity even if timestamps collide at the same
            // second.
            can_merge = false;
            continue;
        }
        // Merge consecutive active records only if identical state and contiguous.
        if (in_ep && can_merge) {
            const auto& prev = snap.at(ep_idx);
            if (prev.kind == r.kind && prev.unit == r.unit && prev.code == r.code &&
                prev.aux == r.aux && ep_stop == r.sec) {
                ep_last_idx = i;
                ep_stop     = next_sec;
                continue;
            }
        }
        in_ep       = true;
        can_merge   = true;
        ep_idx      = i;
        ep_last_idx = i;
        ep_start    = r.sec;
        ep_stop     = next_sec;
    }

    if (!in_ep) return out;
    const auto& r      = snap.at(ep_idx);
    const bool  at_end = (ep_last_idx + 1 == snap.count);
    const bool  is_live =
        at_end && source_fresh && snap.live && (win_end - obs_end <= CHECKUP_FAULT_GAP_S);
    const bool stop_gap =
        !at_end ? (snap.at(ep_last_idx + 1).kind != FaultTraceKind::Normal) : !is_live;

    out.present    = true;
    out.kind       = r.kind;
    out.unit       = r.unit;
    out.code       = r.code;
    out.aux        = r.aux;
    out.start_s    = ep_start;
    out.stop_s     = ep_stop;
    out.duration_s = ep_stop >= ep_start ? ep_stop - ep_start : 0;
    if (is_live) {
        out.ongoing      = true;
        out.stop_unknown = false;
        out.age_s        = win_end >= ep_start ? win_end - ep_start : 0;
    } else {
        out.ongoing      = false;
        out.stop_unknown = stop_gap;
        out.age_s        = win_end >= ep_stop ? win_end - ep_stop : 0;
    }
    if (snap.unix_s > win_end) {
        out.start_unix_s = snap.unix_s - (win_end - ep_start);
        if (!out.ongoing) out.end_unix_s = snap.unix_s - (win_end - ep_stop);
    }
    return out;
}

} // namespace daik::logic
