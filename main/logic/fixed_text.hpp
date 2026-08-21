#pragma once
// Allocation-free bounded text used by memory-pressure status surfaces. FixedText owns one
// NUL-terminated value; FixedBuffer appends a complete bounded response and reports overflow rather
// than reallocating or silently emitting a truncated document.
#include <array>
#include <cstddef>
#include <string_view>

namespace daik {

template <size_t Capacity>
class FixedText {
    static_assert(Capacity > 0, "fixed text needs room for a terminator");

public:
    FixedText() = default;
    FixedText(const char* value) { assign(value ? std::string_view(value) : std::string_view()); }
    FixedText(std::string_view value) { assign(value); }

    FixedText& operator=(const char* value) {
        assign(value ? std::string_view(value) : std::string_view());
        return *this;
    }
    FixedText& operator=(std::string_view value) {
        assign(value);
        return *this;
    }

    void assign(std::string_view value) {
        size_ = value.size() < Capacity - 1 ? value.size() : Capacity - 1;
        for (size_t i = 0; i < size_; ++i) bytes_[i] = value[i];
        bytes_[size_] = '\0';
    }
    void clear() {
        size_ = 0;
        bytes_[0] = '\0';
    }

    const char* data() const { return bytes_.data(); }
    size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }
    operator std::string_view() const { return std::string_view(bytes_.data(), size_); }
    bool operator==(std::string_view other) const { return std::string_view(*this) == other; }
    bool operator!=(std::string_view other) const { return !(*this == other); }

private:
    std::array<char, Capacity> bytes_{};
    size_t size_ = 0;
};

template <size_t Capacity>
class FixedBuffer {
    static_assert(Capacity > 0, "fixed buffer needs room for a terminator");

public:
    FixedBuffer& operator+=(std::string_view value) {
        append(value);
        return *this;
    }
    FixedBuffer& operator+=(const char* value) {
        append(value ? std::string_view(value) : std::string_view());
        return *this;
    }
    FixedBuffer& operator+=(char value) {
        append(std::string_view(&value, 1));
        return *this;
    }

    void append(std::string_view value) {
        if (overflowed_) return;
        if (value.size() > Capacity - 1 - size_) {
            overflowed_ = true;
            return;
        }
        for (const char c : value) bytes_[size_++] = c;
        bytes_[size_] = '\0';
    }

    const char* data() const { return bytes_.data(); }
    size_t size() const { return size_; }
    bool ok() const { return !overflowed_; }

private:
    std::array<char, Capacity> bytes_{};
    size_t size_ = 0;
    bool overflowed_ = false;
};

} // namespace daik
