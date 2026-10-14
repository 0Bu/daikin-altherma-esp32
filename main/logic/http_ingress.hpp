#pragma once
#include <cstdint>
#include <cstddef>
#include <limits>
#include <string_view>

namespace daik {

// One request's receive budget starts with its first socket read, before the SDK parses headers.
// Progress and body parsing retain that start. Successful settlement resets it for keep-alive;
// an expired or failed request must close its session instead.
inline constexpr int64_t HTTP_INGRESS_BUDGET_US = 30'000'000;

// Compare the wire header with the SDK's target-sized content_len. Reject a narrowed length,
// empty/malformed field or overflow instead of interpreting leftover bytes as another request.
inline bool http_content_length_matches(std::string_view text, size_t declared) noexcept {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
    while (!text.empty() && (text.back() == ' ' || text.back() == '\t')) text.remove_suffix(1);
    if (text.empty()) return false;
    size_t value = 0;
    for (const unsigned char c : text) {
        if (c < '0' || c > '9') return false;
        const size_t digit = c - '0';
        if (value > (std::numeric_limits<size_t>::max() - digit) / 10) return false;
        value = value * 10 + digit;
    }
    return value == declared;
}

struct HttpIngressBudget {
    int64_t started_us = 0;
    bool    active     = false;

    bool admit(int64_t now_us) noexcept {
        if (now_us < 0) return false;
        if (!active) {
            started_us = now_us;
            active     = true;
        }
        return !expired(now_us);
    }
    bool expired(int64_t now_us) const noexcept {
        return active && (now_us < started_us || now_us - started_us >= HTTP_INGRESS_BUDGET_US);
    }
    void finish() noexcept { active = false; }
};

} // namespace daik
