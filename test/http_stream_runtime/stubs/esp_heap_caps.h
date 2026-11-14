#pragma once
#include <cstddef>

inline constexpr unsigned MALLOC_CAP_8BIT = 1;
void*                     heap_caps_malloc(std::size_t size, unsigned capabilities);
