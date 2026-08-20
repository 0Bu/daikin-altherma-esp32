#pragma once
// Register-page -> friendly MQTT group name, plus the grouped-JSON state payload builder. IDF-free
// and host-tested (test/test_logic.cpp) so the exact bytes the broker — and Home Assistant's
// value_template / a Telegraf JSON parser — receive are asserted on the host, not the device.
//
// The MQTT bridge publishes one retained X10A JSON object to <base>/x10a per cycle. Values are
// grouped one level deep by their X10A register page:
//     { "<group>": { "<object_id>": value, … }, … }   (max nesting depth 1)
// Each HA discovery config points every sensor at this shared topic with a value_template that
// subscripts the group + object (logic/discovery.hpp).
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include "convert.hpp"   // PublishedKind — the row's JSON type, taken from its DEFINITION
#include "fault_state.hpp" // derived numeric companions beside textual fault classes
#include "ha_device.hpp" // allocation-free label -> JSON-key slugging
#include "json.hpp"      // json_append_escaped — the shared RFC 8259 string encoder

namespace daik {

// Hard refusal ceilings for the X10A publisher. The JSON limit is not reserved permanently: a
// changed state owns one exact-sized transient payload, while an unchanged state only runs the
// allocation-free probe. The formatted-value ceiling covers the longest enriched fault text in
// logic/error_codes.hpp (host-audited below) as well as hp_format's 31-byte numeric buffer and
// Reading's 23-byte enum buffer.
inline constexpr size_t X10A_GROUPED_JSON_MAX_BYTES    = 12 * 1024;
inline constexpr size_t X10A_FORMATTED_VALUE_MAX_BYTES = 96;

inline constexpr size_t x10a_formatted_value_capacity(int conv) {
    if (conv == 204) return X10A_FORMATTED_VALUE_MAX_BYTES;  // enriched error-code description
    return published_kind(conv) == PublishedKind::Text ? 23u : 31u;  // Reading::text / hp_format b[]
}

// X10A register page -> stable, human-readable group key (docs/X10A_PROTOCOL.md §5 page catalog).
// Pages outside the catalog fall back to "other". Names are snake_case and safe as raw JSON keys.
inline const char* group_for_page(uint8_t reg) {
    switch (reg) {
        case 0x00: return "outdoor_identity";
        case 0x10: return "outdoor_state";
        case 0x11: return "outdoor_eeprom";
        case 0x20: return "outdoor_sensors";
        case 0x21: return "inverter";
        case 0x30: return "actuators";
        case 0xA0: return "outdoor_aux";
        case 0xA1: return "water_hx";
        case 0x60: return "hydronic";
        case 0x61: return "hydronic_temps";
        case 0x62: return "hydronic_state";
        case 0x63: return "mains_current";
        case 0x64: return "hybrid";
        case 0x65: return "mixing";
        // The synthetic page every HomeHub row carries. The Modbus MQTT payload itself is flat, but
        // this name remains the source label used by generic CachedValue consumers.
        case 0xEE: return "modbus";
        default:   return "other";
    }
}

// The group key as a Home Assistant entity-name fragment: "outdoor_state" -> "Outdoor State".
// Needed because a DERIVED companion field (logic/fault_state.hpp) has no catalog label to take a
// name from, and its JSON key is only unique WITHIN its group — a profile carries an error class on
// the outdoor page and again on the hydronic one, while HA entity ids share one flat namespace. So
// the group, which already namespaces the key in the payload, names the entity too.
//
// Mechanical (underscores to spaces, first letter of each word up) rather than a second table keyed
// on the page: group_for_page above is the one place a group is named, and a display table beside it
// would be a copy to keep in step for no gain — every key it produces is already snake_case ASCII.
inline std::string group_display_name(const std::string& group) {
    std::string out;
    out.reserve(group.size());
    bool start = true;
    for (char c : group) {
        if (c == '_') { out += ' '; start = true; continue; }
        out += (start && c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c;
        start = false;
    }
    return out;
}

// True if `s` is a JSON number as produced by hp_format ("-3.5", "48", "0.0"): an optional leading
// '-', at least one digit, at most one '.' with a digit on each side. Enum/text values ("Heating",
// "A1", "R32") are not. Numbers are emitted unquoted, text quoted.
inline bool is_json_number(std::string_view s) {
    if (s.empty()) return false;
    size_t i = 0;
    if (s[i] == '-' && ++i == s.size()) return false;
    bool digit = false, dot = false;
    for (; i < s.size(); ++i) {
        const char c = s[i];
        if (c >= '0' && c <= '9') { digit = true; continue; }
        if (c == '.' && !dot && digit) {                 // one dot, and only after a digit
            dot   = true;
            digit = false;                               // now require a fractional digit
            continue;
        }
        return false;
    }
    return digit;
}

// One publishable reading destined for the grouped JSON.
//
// `kind` is the field's JSON TYPE and it comes from the row's converter (logic/convert.hpp
// published_kind), NOT from inspecting `value`. That is the whole point of carrying it: formatting
// collapses a typed decode into a string, and a publisher that then re-infers the type from the
// string lets ONE logical field change JSON type between states — measured in #209, where fan step
// alternated between the number 30 and the string "OFF" and the metrics consumer silently kept the
// stale 30. Type is a property of the field; the value is not allowed a vote.
struct GroupedValue {
    std::string   group;   // group_for_page(reg)
    std::string   key;     // object_id(label)
    std::string   value;   // formatted string (hp_format)
    PublishedKind kind = PublishedKind::Number;
    // A stable device-side layout keeps every profile row in its original slot and only toggles
    // this bit when a page is absent or held over. The owning host/one-shot form defaults present,
    // preserving all existing aggregate initializers and wire bytes.
    bool          present = true;
};

template <typename JsonOut, typename Value>
inline void append_published_value(JsonOut& j, const Value& value) {
    if (value.kind == PublishedKind::Text) {
        j += '"'; json_append_escaped(j, value.value); j += '"';
    } else if (is_json_number(value.value)) {
        j += value.value;
    } else {
        // A Number field whose formatted value is not a number is a broken contract, not a reason
        // to change its JSON type. `null` is intentionally ignored by numeric metrics consumers.
        j += "null";
    }
}

// ── Bounded grouped-JSON builder ────────────────────────────────────────────────────────────────
//
// The DEVICE builds this payload once a second, and before this rewrite it did so into a fresh
// std::string with an incremental-doubling realloc policy on a heap whose binding limit is the
// largest contiguous block (private issue 10: `publish skipped at x10a (std::bad_alloc)`, once a
// day on the live plant). The bytes are unchanged — every host test below pins them — but the
// ownership model is different:
//
//   • `grouped_json_size` is an allocation-free counting pass that walks the SAME template
//     instantiation that writes the bytes, so the reported size is exact by construction.
//   • `append_grouped_json` writes into a caller-owned, already-reserved std::string. Writing into
//     reserved capacity performs no allocation and cannot throw, so the incremental realloc ladder
//     is gone. The direct cache path below releases its one exact payload after synchronous publish.
//   • `build_grouped_json` remains as the owning one-shot form (host tests, one-off callers): it is
//     the counting pass + reserve + append, i.e. ONE encoder, not a second copy.
//
// Group ordering (first-seen group, rows in input order) is decided WITHOUT the order/buckets
// scratch vectors the old builder allocated per call: a row opens its group exactly when no EARLIER
// row carried that group name. That is the same rule the buckets used, walked in place. O(n²)
// string compares for n ≈ 130 rows is microseconds on the target and far cheaper than the
// fragmentation the removed allocations caused.
namespace detail {
template <typename Values>
inline bool group_seen_before(const Values& vals, size_t i) {
    if (!vals[i].present) return true;
    for (size_t k = 0; k < i; ++k)
        if (vals[k].present && std::string_view(vals[k].group) == std::string_view(vals[i].group))
            return true;
    return false;
}

template <typename Out, typename Values>
inline void append_grouped_json_impl(Out& out, const Values& vals) {
    out += '{';
    bool first_group = true;
    // Groups in FIRST-SEEN order (the outer pass takes the first row of each group), rows inside a
    // group in INPUT order (the inner pass re-walks all rows) — exactly the order/buckets rule the
    // old builder implemented with two scratch vectors, here without any allocation. The inner
    // walk cannot be replaced by "rows until the next group change": groups are contiguous in the
    // page-ordered device snapshot but the builder must not depend on that.
    for (size_t g = 0; g < vals.size(); ++g) {
        if (group_seen_before(vals, g)) continue;
        if (!first_group) out += ',';
        first_group = false;
        out += '"';
        out += vals[g].group;
        out += "\":{";
        bool first_row = true;
        for (size_t r = 0; r < vals.size(); ++r) {
            if (!vals[r].present ||
                std::string_view(vals[r].group) != std::string_view(vals[g].group)) continue;
            if (!first_row) out += ',';
            first_row = false;
            out += '"';
            out += vals[r].key;
            out += "\":";
            append_published_value(out, vals[r]);
        }
        out += '}';
    }
    out += '}';
}
}  // namespace detail

// Exact byte count of the grouped payload, without allocating a single byte.
template <typename Values>
inline size_t grouped_json_size(const Values& vals) {
    CountingOut out;
    detail::append_grouped_json_impl(out, vals);
    return out.n;
}

// Append the grouped payload to `out`. The caller must have reserved capacity for
// grouped_json_size(vals) first: writing into reserved capacity performs no allocation, which is
// the entire point on the device (a grow here is what the counting pass exists to prevent).
template <typename JsonOut, typename Values>
inline void append_grouped_json(JsonOut& out, const Values& vals) {
    detail::append_grouped_json_impl(out, vals);
}

// Build the retained state payload { "<group>": { "<key>": value, … }, … }. Groups and keys keep
// first-seen order (the poll cache is already page-ordered). A Number field is emitted unquoted, a
// Text field quoted — always, in every state. Pure — the device streams the result to <base>/x10a.
inline std::string build_grouped_json(const std::vector<GroupedValue>& vals) {
    std::string j;
    j.reserve(grouped_json_size(vals));   // exact, so the append below cannot grow
    append_grouped_json(j, vals);
    return j;
}

// ── Publish dedup digest ─────────────────────────────────────────────────────────────────────────
//
// The X10A topic is retained and re-published only when it changed; the OLD guard held a copy of
// the last full payload (~3 KB permanently) and compared it byte-wise. Comparing a digest instead
// removes that permanent block and the per-cycle copy, at the cost of a theoretical 2^-64 collision.
// A collision would suppress one changed retained payload until a forced reseed (reconnect, profile
// change or X10A recovery), so this is explicitly a probabilistic dedup guard rather than exact byte
// equality. FNV-1a 64 is tiny, dependency-free and byte-stable across platforms.
inline uint64_t fnv1a64(std::string_view data) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (const unsigned char c : data) {
        h ^= c;
        h *= 0x100000001b3ULL;
    }
    return h;
}

// Allocation-free source-cache encoder. Unlike GroupedValue, a poll-cache row owns only its
// formatted value; group and JSON key are derived from the static register/label metadata. This is
// deliberate: private issue 10's first implementation kept a second vector of every row, another
// vector of every slug/group, and a 12 KiB payload block alive for the whole boot. On the real
// 129-row plant those persistent allocations drove the largest free block to 7.5 KiB and made
// /status permanently return 503. The cache encoder walks the ONE existing poll cache in place.
namespace detail {
template <typename Row>
inline bool x10a_cache_row_present(const Row& row) {
    return !row.value.empty() && !row.held;
}

template <typename Values>
inline bool x10a_cache_group_seen_before(const Values& vals, size_t i) {
    if (!x10a_cache_row_present(vals[i])) return true;
    const std::string_view group = group_for_page(vals[i].reg);
    for (size_t k = 0; k < i; ++k)
        if (x10a_cache_row_present(vals[k]) &&
            std::string_view(group_for_page(vals[k].reg)) == group) return true;
    return false;
}

template <typename Out, typename Values>
inline void append_x10a_cache_json_impl(Out& out, const Values& vals) {
    out += '{';
    bool first_group = true;
    for (size_t g = 0; g < vals.size(); ++g) {
        if (x10a_cache_group_seen_before(vals, g)) continue;
        if (!first_group) out += ',';
        first_group = false;
        const std::string_view group = group_for_page(vals[g].reg);
        out += '"'; out += group; out += "\":{";
        bool first_row = true;
        for (size_t r = 0; r < vals.size(); ++r) {
            const auto& row = vals[r];
            if (!x10a_cache_row_present(row) ||
                std::string_view(group_for_page(row.reg)) != group) continue;
            if (!first_row) out += ',';
            first_row = false;
            out += '"'; ha_slug_append(out, row.label); out += "\":";
            struct PublishedView {
                std::string_view value;
                PublishedKind kind;
            } view{std::string_view(row.value), published_kind(row.conv)};
            append_published_value(out, view);

            if (row.conv != 203) continue;
            const FaultClass fc = fault_class_from_text(row.value.c_str());
            if (!fault_companions_publishable(fc)) continue;
            for (size_t c = 0; c < FAULT_COMPANION_COUNT; ++c) {
                out += ",\""; out += FAULT_COMPANIONS[c].key; out += "\":";
                out += fault_companion_state(c, fc);
            }
        }
        out += '}';
    }
    out += '}';
}
} // namespace detail

template <typename Out, typename Values>
inline void append_x10a_cache_json(Out& out, const Values& vals) {
    detail::append_x10a_cache_json_impl(out, vals);
}

struct X10aCacheJsonProbe {
    size_t bytes = 0;
    uint64_t digest = 0xcbf29ce484222325ULL;
};

// One sink computes both the exact allocation size and the dedup digest. An unchanged snapshot
// therefore performs no payload allocation at all; a changed snapshot allocates exactly `bytes`
// once, outside the poll-cache mutex, and is serialized only if the cache revision still matches.
struct X10aCacheProbeOut {
    size_t n = 0;
    uint64_t digest = 0xcbf29ce484222325ULL;

    X10aCacheProbeOut& operator+=(char c) {
        add(std::string_view(&c, 1));
        return *this;
    }
    X10aCacheProbeOut& operator+=(const char* s) {
        add(s ? std::string_view(s) : std::string_view{});
        return *this;
    }
    X10aCacheProbeOut& operator+=(const std::string& s) {
        add(s);
        return *this;
    }
    X10aCacheProbeOut& operator+=(std::string_view s) {
        add(s);
        return *this;
    }

private:
    void add(std::string_view s) {
        n += s.size();
        for (const unsigned char c : s) {
            digest ^= c;
            digest *= 0x100000001b3ULL;
        }
    }
};

template <typename Values>
inline X10aCacheJsonProbe probe_x10a_cache_json(const Values& vals) {
    X10aCacheProbeOut out;
    append_x10a_cache_json(out, vals);
    return {out.n, out.digest};
}

// Build the HomeHub payload for <base>/modbus. The topic already identifies the source, so repeating
// a synthetic `modbus` object inside it would add nesting without information. Keys retain their
// definition-owned Number/Text type exactly like the grouped X10A encoder above.
inline std::string build_flat_json(const std::vector<GroupedValue>& vals) {
    std::string j = "{";
    j.reserve(vals.size() * 32 + 16);
    for (size_t i = 0; i < vals.size(); i++) {
        if (i) j += ',';
        j += '"'; j += vals[i].key; j += "\":";
        append_published_value(j, vals[i]);
    }
    j += '}';
    return j;
}

} // namespace daik
