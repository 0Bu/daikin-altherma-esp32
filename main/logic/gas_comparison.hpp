#pragma once
// Gas-boiler baseline constants, currency allowlist, and tariff validation for the 24-hour
// heat-pump working-figure cost comparison. Pure, IDF-free, and -fno-exceptions-safe.
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string_view>

namespace daik {

inline constexpr uint32_t TARIFF_PRICE_MAX_TENTH_MILL = 999999; // 99.9999 currency/kWh
inline constexpr uint8_t  GAS_EFFICIENCY_PCT = 88; // fixed Hs condensing gas boiler assumption

inline constexpr char TARIFF_CURRENCIES_PACKED[] = "EURCHFGBPUSDPLNCZKSEKNOKDKKUAHJPYCNY";

inline bool tariff_currency_valid(std::string_view code, const char** why = nullptr) noexcept {
    if (code.size() == 3) {
        for (size_t i = 0; i + 3 <= sizeof(TARIFF_CURRENCIES_PACKED) - 1; i += 3) {
            if (std::memcmp(TARIFF_CURRENCIES_PACKED + i, code.data(), 3) == 0) return true;
        }
    }
    if (why) *why = "Unsupported currency code";
    return false;
}

// Tariffs are either both cleared to 0 (unconfigured) or both configured (> 0). Reject half-set
// tariffs so the comparison cannot silently evaluate against a 0.0000/kWh baseline.
inline bool gas_comparison_config_valid(uint32_t elec_price_tenth_mill,
                                        uint32_t gas_price_tenth_mill, std::string_view currency,
                                        const char** why = nullptr) noexcept {
    auto fail = [&](const char* text) {
        if (why) *why = text;
        return false;
    };
    if (elec_price_tenth_mill > TARIFF_PRICE_MAX_TENTH_MILL ||
        gas_price_tenth_mill > TARIFF_PRICE_MAX_TENTH_MILL)
        return fail("Tariff price out of range");
    if ((elec_price_tenth_mill == 0) != (gas_price_tenth_mill == 0))
        return fail("Both electricity and gas tariffs must be configured, or both 0");
    return tariff_currency_valid(currency, why);
}

} // namespace daik
