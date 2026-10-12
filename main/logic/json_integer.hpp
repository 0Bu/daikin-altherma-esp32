#pragma once
// Integer fields for MQTT builders, without one temporary owning string per field.
#include <charconv>
#include <cstdint>
#include <string>
#include <string_view>
#include <type_traits>

namespace daik {

// One out-of-line integer append avoids a temporary owning string and repeated cleanup code
// for every field in the MQTT builders. Twenty digits cover uint64_t; sign is emitted separately.
__attribute__((noinline)) inline void json_append_integer_field_impl(std::string&     out,
                                                                     std::string_view prefix,
                                                                     uint64_t         magnitude,
                                                                     bool negative, bool valid) {
    out.append(prefix.data(), prefix.size());
    if (!valid) {
        out += "null";
        return;
    }
    char       digits[20];
    const auto result = std::to_chars(digits, digits + sizeof(digits), magnitude);
    if (negative) out += '-';
    out.append(digits, static_cast<size_t>(result.ptr - digits));
}

template <typename Integer>
__attribute__((always_inline)) inline void
json_append_integer_field(std::string& out, std::string_view prefix, Integer value,
                          bool valid = true) {
    static_assert(std::is_integral_v<Integer> && !std::is_same_v<Integer, bool>);
    using Unsigned           = std::make_unsigned_t<Integer>;
    const bool     negative  = std::is_signed_v<Integer> && value < 0;
    const Unsigned bits      = static_cast<Unsigned>(value);
    const Unsigned magnitude = negative ? Unsigned(0) - bits : bits;
    json_append_integer_field_impl(out, prefix, static_cast<uint64_t>(magnitude), negative, valid);
}

} // namespace daik
