#pragma once
// Snapshot-owned register provenance. Tokens are local to one firmware image, never persisted.
#include <cstddef>
#include <cstdint>

namespace daik::logic {

// Public row selectors currently use offsets. Reject FC-space collisions rather than silently
// letting table order choose what the browser's offset-based selectors mean.
template <typename Reg, size_t N> constexpr bool modbus_offsets_unique(const Reg (&rows)[N]) {
    for (size_t i = 0; i < N; ++i)
        for (size_t j = i + 1; j < N; ++j)
            if (rows[i].offset == rows[j].offset) return false;
    return true;
}

template <typename Reg, size_t N, size_t M>
constexpr uint8_t modbus_definition_id(const Reg (&base)[N], const Reg (&native)[M], const Reg& row) {
    static_assert(N + M <= 255, "Modbus definition tokens exceed their cache byte");
    for (size_t i = 0; i < N; ++i)
        if (&row == &base[i]) return static_cast<uint8_t>(i + 1);
    for (size_t i = 0; i < M; ++i)
        if (&row == &native[i]) return static_cast<uint8_t>(N + i + 1);
    return 0;
}

template <typename Reg, size_t N, size_t M>
constexpr const Reg* modbus_definition(const Reg (&base)[N], const Reg (&native)[M], uint8_t token) {
    if (token == 0) return nullptr;
    const size_t index = token - 1;
    if (index < N) return &base[index];
    return index < N + M ? &native[index - N] : nullptr;
}

} // namespace daik::logic
