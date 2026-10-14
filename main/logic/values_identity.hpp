#pragma once
#include <cstdint>
#include <string_view>

namespace daik {

// Plain commit identity; profile_id borrows the immutable generated catalog ID.
struct HpValuesIdentity {
    const char* profile_id        = "";
    uint64_t    identity_fp       = 0;
    uint32_t    source_generation = 0;
    uint32_t    cache_revision    = 0;
};

inline bool hp_values_identity_matches(const HpValuesIdentity& a,
                                       const HpValuesIdentity& b) noexcept {
    return a.source_generation != 0 && a.source_generation == b.source_generation &&
           a.cache_revision == b.cache_revision && a.identity_fp == b.identity_fp && a.profile_id &&
           b.profile_id && std::string_view(a.profile_id) == b.profile_id;
}

} // namespace daik
