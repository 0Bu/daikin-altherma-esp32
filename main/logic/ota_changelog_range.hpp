#pragma once
// Select the part of a cumulative OTA changelog which belongs to one offered update.
// IDF-free, allocation-free and host-tested.
//
// Older firmware accepts exactly the existing {"version","changelog"} document and renders every
// non-empty line.  The publisher therefore keeps that schema and prefixes cumulative development
// notes with their build version:
//
//     v1.0.3-dev.19 — Preserve legacy bench restore compatibility
//     v1.0.3-dev.20 — Accept exact legacy writer evidence
//
// A new client can remove entries which its running build already contains without another HTTPS
// request or a larger retained document.  Legacy unprefixed notes remain unchanged.  A document
// which starts in the versioned format but is malformed, unordered or not bound to the offered
// target is rejected instead of presenting a plausible partial history.
#include <cstddef>
#include <cstring>

#include "version_cmp.hpp"

namespace daik {

enum class OtaChangelogRangeResult {
    Legacy,
    Selected,
    Invalid,
};

inline OtaChangelogRangeResult ota_changelog_select_range(char* text, const char* running,
                                                          const char* target) {
    if (!text || !running || !target || !version_valid(running) || !version_valid(target)) {
        if (text) text[0] = '\0';
        return OtaChangelogRangeResult::Invalid;
    }

    constexpr char   separator[]   = " — ";
    constexpr size_t separator_len = sizeof(separator) - 1;
    const size_t     text_len      = std::strlen(text);
    if (text_len == 0) return OtaChangelogRangeResult::Legacy;

    size_t selected_offset = 0;
    bool   running_seen    = false;
    bool   versioned       = false;
    char   previous[32]    = {};
    char   last[32]        = {};

    for (size_t offset = 0; offset < text_len;) {
        const size_t line_start = offset;
        while (offset < text_len && text[offset] != '\n') ++offset;
        const size_t line_end = offset;
        const size_t next     = offset < text_len ? offset + 1 : offset;
        if (line_end == line_start) {
            text[0] = '\0';
            return OtaChangelogRangeResult::Invalid;
        }

        const bool looks_versioned = text[line_start] == 'v' && line_start + 1 < line_end &&
                                     text[line_start + 1] >= '0' && text[line_start + 1] <= '9';
        size_t split = line_start + 1;
        while (split + separator_len <= line_end &&
               std::memcmp(text + split, separator, separator_len) != 0)
            ++split;
        const bool has_separator  = split + separator_len <= line_end;
        bool       compact_prefix = looks_versioned && has_separator;
        if (compact_prefix) {
            for (size_t i = line_start + 1; i < split; ++i) {
                if (static_cast<unsigned char>(text[i]) <= 0x20) {
                    compact_prefix = false;
                    break;
                }
            }
        }
        if (!compact_prefix) {
            // A legacy target-only note is arbitrary prose.  In particular, text such as
            // "v2 compatibility — improved transport" must not become invalid merely because it
            // begins with a lower-case v and a digit. Only a compact, complete publisher prefix
            // selects the versioned grammar; once selected, every later line must use it.
            if (!versioned && line_start == 0) return OtaChangelogRangeResult::Legacy;
            text[0] = '\0';
            return OtaChangelogRangeResult::Invalid;
        }
        versioned = true;

        // Cumulative lines describe an upgrade range.  A user may explicitly switch channels to
        // an older signed build, but presenting that older build's accumulated history as new
        // changes would be false.  Legacy target-only release notes retain their old behaviour.
        if (line_start == 0 && version_compare(running, target) >= 0) {
            text[0] = '\0';
            return OtaChangelogRangeResult::Invalid;
        }

        const size_t version_len = split - (line_start + 1);
        if (version_len == 0 || version_len >= sizeof(last) || split + separator_len == line_end) {
            text[0] = '\0';
            return OtaChangelogRangeResult::Invalid;
        }
        std::memcpy(last, text + line_start + 1, version_len);
        last[version_len] = '\0';
        if (!version_valid(last) || (previous[0] && version_compare(previous, last) > 0)) {
            text[0] = '\0';
            return OtaChangelogRangeResult::Invalid;
        }

        // One build may publish several user-facing lines. Advance after every matching line so a
        // device already on that build never repeats one of its notes.
        if (std::strcmp(last, running) == 0) {
            running_seen    = true;
            selected_offset = next;
        }
        std::memcpy(previous, last, sizeof(previous));
        offset = next;
    }

    if (!versioned || std::strcmp(last, target) != 0) {
        text[0] = '\0';
        return OtaChangelogRangeResult::Invalid;
    }
    if (running_seen) {
        std::memmove(text, text + selected_offset, text_len - selected_offset + 1);
    }
    return OtaChangelogRangeResult::Selected;
}

} // namespace daik
