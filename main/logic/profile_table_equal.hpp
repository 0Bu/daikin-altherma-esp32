#pragma once

// Exact ordered equality for the handwritten profile-storage sharing layer. Compile-time guards
// compare every generated field; a future catalog change must break an obsolete sharing alias.
#include "value_def.hpp"
#include <cstddef>

namespace daik::logic {

inline constexpr bool profile_table_labels_equal(const char* a, const char* b) noexcept {
    if (!a || !b) return !a && !b;
    while (*a || *b) {
        if (*a != *b) return false;
        ++a;
        ++b;
    }
    return true;
}

inline constexpr bool profile_tables_equal(const ValueDef* a, size_t count_a, const ValueDef* b,
                                           size_t count_b) noexcept {
    if (count_a != count_b) return false;
    if (count_a == 0) return true;
    if (!a || !b) return false;
    for (size_t i = 0; i < count_a; ++i) {
        const ValueDef& x = a[i];
        const ValueDef& y = b[i];
        if (x.reg != y.reg || x.offset != y.offset || x.conv != y.conv || x.size != y.size ||
            x.type != y.type || x.no_publish != y.no_publish ||
            !profile_table_labels_equal(x.label, y.label))
            return false;
    }
    return true;
}

} // namespace daik::logic
