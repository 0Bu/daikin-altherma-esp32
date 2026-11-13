#pragma once

#include <cstddef>

inline constexpr unsigned MALLOC_CAP_8BIT = 1;
inline constexpr unsigned MALLOC_CAP_INTERNAL = 2;
std::size_t heap_caps_get_free_size(unsigned caps);
