#pragma once
#include <cstddef>
#include <string_view>
#include <type_traits>

namespace daik::detail {

// Borrow the caller's output only for one synchronous formatter invocation. Each append must
// consume the view before returning; the formatter may reuse its stack buffer immediately.
struct JsonOutput {
    void* context;
    void (*append)(void*, std::string_view);
    void operator+=(std::string_view part) { append(context, part); }
};

template <typename JsonOut, typename = void> struct has_data_size_append : std::false_type {};
template <typename JsonOut>
struct has_data_size_append<JsonOut, std::void_t<decltype(std::declval<JsonOut&>().append(
                                         static_cast<const char*>(nullptr), size_t{0}))>>
    : std::true_type {};

template <typename JsonOut> inline JsonOutput json_output(JsonOut& out) {
    return {&out, [](void* context, std::string_view part) {
                auto& dst = *static_cast<JsonOut*>(context);
                if constexpr (has_data_size_append<JsonOut>::value)
                    dst.append(part.data(), part.size());
                else
                    dst += part;
            }};
}

} // namespace daik::detail
