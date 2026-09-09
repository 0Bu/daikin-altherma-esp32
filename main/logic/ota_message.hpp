#pragma once
// Bounded, non-allocating message string for status and error reporting (F07).
// Fixed 128-byte buffer guarantee prevents secondary std::bad_alloc during OOM recovery.
#include <cstddef>
#include <cstring>
#include <string>
#include <string_view>
#include <type_traits>

namespace daik {

struct OtaMessage {
    char buf[128] = {0};
    OtaMessage() = default;
    OtaMessage(const char* s) noexcept { assign(s); }
    OtaMessage(const std::string& s) noexcept { assign(s.c_str()); }
    OtaMessage& operator=(const char* s) noexcept { assign(s); return *this; }
    OtaMessage& operator=(const std::string& s) noexcept { assign(s.c_str()); return *this; }
    void assign(const char* s) noexcept {
        if (!s) { buf[0] = '\0'; return; }
        std::strncpy(buf, s, sizeof(buf) - 1);
        buf[sizeof(buf) - 1] = '\0';
    }
    const char* c_str() const noexcept { return buf; }
    operator std::string_view() const noexcept { return std::string_view(buf); }
    bool empty() const noexcept { return buf[0] == '\0'; }
    void clear() noexcept { buf[0] = '\0'; }
    bool operator==(const char* s) const noexcept { return std::strcmp(buf, s ? s : "") == 0; }
    bool operator!=(const char* s) const noexcept { return !(*this == s); }
    bool operator==(const std::string& s) const noexcept { return std::strcmp(buf, s.c_str()) == 0; }
    bool operator!=(const std::string& s) const noexcept { return !(*this == s); }
    bool operator==(const OtaMessage& other) const noexcept { return std::strcmp(buf, other.buf) == 0; }
    bool operator!=(const OtaMessage& other) const noexcept { return !(*this == other); }
    friend bool operator==(const char* a, const OtaMessage& b) noexcept { return b == a; }
    friend bool operator!=(const char* a, const OtaMessage& b) noexcept { return !(b == a); }
    friend bool operator==(const std::string& a, const OtaMessage& b) noexcept { return b == a; }
    friend bool operator!=(const std::string& a, const OtaMessage& b) noexcept { return !(b == a); }
};

static_assert(std::is_nothrow_default_constructible<OtaMessage>::value,
              "OtaMessage must be nothrow default constructible");
static_assert(std::is_nothrow_copy_constructible<OtaMessage>::value,
              "OtaMessage must be nothrow copy constructible");
static_assert(std::is_nothrow_copy_assignable<OtaMessage>::value,
              "OtaMessage must be nothrow copy assignable");
static_assert(std::is_nothrow_move_constructible<OtaMessage>::value,
              "OtaMessage must be nothrow move constructible");
static_assert(std::is_nothrow_move_assignable<OtaMessage>::value,
              "OtaMessage must be nothrow move assignable");

} // namespace daik
