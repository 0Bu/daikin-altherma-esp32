#pragma once

// Present JSON fields must match their documented type. Missing fields retain each route's
// existing patch/default/disabled semantics; a mistyped field must never acquire those meanings.
#include <cmath>
#include <limits>

namespace daik {

enum class HttpConfigFieldType { Missing, String, Boolean, Number, Integer, Other };

inline bool http_config_integer_value(double value, int& out) noexcept {
    if (!std::isfinite(value) || value < std::numeric_limits<int>::min() ||
        value > std::numeric_limits<int>::max() || std::trunc(value) != value)
        return false;
    out = static_cast<int>(value);
    return true;
}

inline bool http_config_field_valid(HttpConfigFieldType expected, HttpConfigFieldType actual,
                                    double number = 0.0) noexcept {
    if (actual == HttpConfigFieldType::Missing) return true;
    if (expected == HttpConfigFieldType::Integer) {
        int value = 0;
        return actual == HttpConfigFieldType::Number && http_config_integer_value(number, value);
    }
    if (expected == HttpConfigFieldType::Number)
        return actual == HttpConfigFieldType::Number && std::isfinite(number);
    return (expected == HttpConfigFieldType::String || expected == HttpConfigFieldType::Boolean) &&
           actual == expected;
}

} // namespace daik
