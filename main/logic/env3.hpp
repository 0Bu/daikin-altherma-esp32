#pragma once
// Pure ENV III rules and sensor conversion. IDF-free so pin safety, SHT30 CRC and QMP6988
// compensation are exercised by the host suite rather than trusted only on hardware.
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <string>

#include "board_pins.hpp"
#include "board_presets.hpp"
#include "config_model.hpp"

namespace daik {

inline constexpr uint8_t ENV3_SHT30_ADDR = 0x44;
inline constexpr uint8_t ENV3_QMP6988_ADDR = 0x70;

inline uint8_t env3_sht_crc(const uint8_t* data, size_t n) {
    uint8_t crc = 0xff;
    for (size_t i = 0; i < n; ++i) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; ++bit)
            crc = static_cast<uint8_t>((crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1);
    }
    return crc;
}

inline bool env3_decode_sht30(const uint8_t raw[6], float& temperature_c, float& humidity_pct) {
    if (env3_sht_crc(raw, 2) != raw[2] || env3_sht_crc(raw + 3, 2) != raw[5]) return false;
    const uint16_t t = static_cast<uint16_t>((raw[0] << 8) | raw[1]);
    const uint16_t h = static_cast<uint16_t>((raw[3] << 8) | raw[4]);
    temperature_c = -45.0f + 175.0f * static_cast<float>(t) / 65535.0f;
    humidity_pct  = 100.0f * static_cast<float>(h) / 65535.0f;
    return true;
}

inline bool env3_sample_plausible(float temperature_c, float humidity_pct, float pressure_hpa) {
    return std::isfinite(temperature_c) && temperature_c >= -40.0f && temperature_c <= 120.0f &&
           std::isfinite(humidity_pct) && humidity_pct >= 0.0f && humidity_pct <= 100.0f &&
           std::isfinite(pressure_hpa) && pressure_hpa >= 300.0f && pressure_hpa <= 1100.0f;
}

// MQTT carries only a complete, current ENV III observation. `{}` deliberately invalidates a
// retained reading when either freshness or sensor plausibility is lost. Build with sequential
// appends: this runs on mqtt_pub, whose stack must not absorb a chain of temporary std::strings.
inline std::string build_env3_mqtt_json(bool fresh, float temperature_c, float humidity_pct,
                                        float pressure_hpa) {
    if (!fresh || !env3_sample_plausible(temperature_c, humidity_pct, pressure_hpa)) return "{}";

    char temperature[24], humidity[24], pressure[24];
    std::snprintf(temperature, sizeof(temperature), "%.2f", static_cast<double>(temperature_c));
    std::snprintf(humidity, sizeof(humidity), "%.2f", static_cast<double>(humidity_pct));
    std::snprintf(pressure, sizeof(pressure), "%.2f", static_cast<double>(pressure_hpa));

    std::string j = "{";
    j += "\"temperature_c\":";
    j += temperature;
    j += ",\"humidity_pct\":";
    j += humidity;
    j += ",\"pressure_hpa\":";
    j += pressure;
    j += "}";
    return j;
}

struct Env3QmpCalibration {
    int32_t a0 = 0, b00 = 0, a1 = 0, a2 = 0;
    int64_t bt1 = 0, bt2 = 0, bp1 = 0, b11 = 0, bp2 = 0, b12 = 0, b21 = 0, bp3 = 0;
};

inline int16_t env3_i16(uint8_t hi, uint8_t lo) {
    return static_cast<int16_t>(static_cast<uint16_t>(hi) << 8 | lo);
}
inline int32_t env3_sign20(uint32_t v) {
    return (v & 0x80000u) ? static_cast<int32_t>(v | 0xfff00000u) : static_cast<int32_t>(v);
}

inline Env3QmpCalibration env3_qmp_calibration(const uint8_t d[25]) {
    Env3QmpCalibration c;
    const int32_t raw_a0  = env3_sign20((static_cast<uint32_t>(d[18]) << 12) |
                                        (static_cast<uint32_t>(d[19]) << 4) | (d[24] & 0x0f));
    const int32_t raw_b00 = env3_sign20((static_cast<uint32_t>(d[0]) << 12) |
                                        (static_cast<uint32_t>(d[1]) << 4) | (d[24] >> 4));
    c.a0 = raw_a0; c.b00 = raw_b00;
    c.a1  = 3608L * env3_i16(d[20], d[21]) - 1731677965L;
    c.a2  = 16889L * env3_i16(d[22], d[23]) - 87619360L;
    c.bt1 = 2982LL * env3_i16(d[2], d[3]) + 107370906LL;
    c.bt2 = 329854LL * env3_i16(d[4], d[5]) + 108083093LL;
    c.bp1 = 19923LL * env3_i16(d[6], d[7]) + 1133836764LL;
    c.b11 = 2406LL * env3_i16(d[8], d[9]) + 118215883LL;
    c.bp2 = 3079LL * env3_i16(d[10], d[11]) - 181579595LL;
    c.b12 = 6846LL * env3_i16(d[12], d[13]) + 85590281LL;
    c.b21 = 13836LL * env3_i16(d[14], d[15]) + 79333336LL;
    c.bp3 = 2915LL * env3_i16(d[16], d[17]) + 157155561LL;
    return c;
}

inline int16_t env3_qmp_temperature_raw(const Env3QmpCalibration& c, int32_t dt) {
    int64_t w1 = static_cast<int64_t>(c.a1) * dt;
    int64_t w2 = (static_cast<int64_t>(c.a2) * dt) >> 14;
    w2 = (w2 * dt) >> 10;
    w2 = ((w1 + w2) / 32767) >> 19;
    return static_cast<int16_t>((c.a0 + w2) >> 4);
}

inline int32_t env3_qmp_pressure_raw(const Env3QmpCalibration& c, int32_t dp, int16_t tx) {
    int64_t w1 = c.bt1 * tx;
    int64_t w2 = (c.bp1 * dp) >> 5;
    w1 += w2;
    w2 = (c.bt2 * tx) >> 1; w2 = (w2 * tx) >> 8;
    int64_t w3 = w2;
    w2 = (c.b11 * tx) >> 4; w2 = (w2 * dp) >> 1; w3 += w2;
    w2 = (c.bp2 * dp) >> 13; w2 = (w2 * dp) >> 1; w3 += w2;
    w1 += w3 >> 14;
    w2 = c.b12 * tx; w2 = (w2 * tx) >> 22; w2 = (w2 * dp) >> 1; w3 = w2;
    w2 = (c.b21 * tx) >> 6; w2 = (w2 * dp) >> 23; w2 = (w2 * dp) >> 1; w3 += w2;
    w2 = (c.bp3 * dp) >> 12; w2 = (w2 * dp) >> 23; w2 *= dp; w3 += w2;
    w1 += w3 >> 15;
    w1 = (w1 / 32767) >> 11;
    return static_cast<int32_t>(w1 + c.b00);
}

inline void env3_decode_qmp6988(const Env3QmpCalibration& c, const uint8_t raw[6],
                                float& temperature_c, float& pressure_hpa) {
    const int32_t dp = static_cast<int32_t>((static_cast<uint32_t>(raw[0]) << 16) |
                                            (static_cast<uint32_t>(raw[1]) << 8) | raw[2]) - 8388608;
    const int32_t dt = static_cast<int32_t>((static_cast<uint32_t>(raw[3]) << 16) |
                                            (static_cast<uint32_t>(raw[4]) << 8) | raw[5]) - 8388608;
    const int16_t tx = env3_qmp_temperature_raw(c, dt);
    temperature_c = static_cast<float>(tx) / 256.0f;
    pressure_hpa = static_cast<float>(env3_qmp_pressure_raw(c, dp, tx)) / 1600.0f;
}

inline bool env3_board_supported(const Config& c) {
    return board_selected_vendor(c) == BoardVendor::M5Stack;
}

// Saving an enabled sensor is proof-gated: selecting a pair of pins is only a wiring claim, not
// evidence that an ENV III is attached there.  The HTTP handler follows this pure plan before it
// writes NVS.  A running sensor already owns I2C0 for the life of its task, so its current pins are
// verified from the latest fresh sample.  A new sensor can be probed directly.  Moving an already
// running bus must be a disable -> rewire -> enable sequence; starting a second controller on a
// partially shared pair would let two masters drive the same wire.
enum class Env3SaveCheck : uint8_t { None, RunningSample, HardwareProbe, DisableFirst };

inline Env3SaveCheck env3_save_check(const Config& current, const Config& proposed) {
    if (!proposed.env3_enabled) return Env3SaveCheck::None;
    if (!current.env3_enabled) return Env3SaveCheck::HardwareProbe;
    if (current.env3_sda == proposed.env3_sda && current.env3_scl == proposed.env3_scl)
        return Env3SaveCheck::RunningSample;
    return Env3SaveCheck::DisableFirst;
}

// Hardware result from the synchronous pre-save probe.  Adding an IDF device handle does not touch
// the wire, so reachability is stronger: SHT30 must return a CRC-valid measurement and QMP6988 must
// return its documented chip id.  Only Ok permits config_save().
enum class Env3ProbeResult : uint8_t { Ok, BusUnavailable, Sht30Unavailable, Qmp6988Unavailable };

inline bool env3_config_valid(const Config& c, std::string& reason, int max_gpio = 48,
                              bool octal_spi = true) {
    if (!c.env3_enabled) return true;
    if (!env3_board_supported(c)) {
        reason = "ENV III requires a selected M5Stack board preset"; return false;
    }
    if (c.env3_sda == c.env3_scl) { reason = "ENV III SDA and SCL must differ"; return false; }
    const ReservedPins used = config_env3_reserved_pins(c);
    if (!gpio_in_range(c.env3_sda, max_gpio) || !board_pin_offerable(c.env3_sda, octal_spi, used)) {
        reason = "ENV III SDA is unavailable or already in use"; return false;
    }
    if (!gpio_in_range(c.env3_scl, max_gpio) || !board_pin_offerable(c.env3_scl, octal_spi, used)) {
        reason = "ENV III SCL is unavailable or already in use"; return false;
    }
    return true;
}

struct Env3Preset { const char* name; int sda; int scl; };
inline constexpr int ENV3_PRESETS_MAX = 1;
inline const Env3Preset* env3_presets_all(int& count) {
    static const Env3Preset presets[] = {
        {"M5Stack AtomS3 Lite · Grove", 2, 1},
    };
    count = static_cast<int>(sizeof(presets) / sizeof(presets[0]));
    return presets;
}
inline int env3_presets_offerable(const Env3Preset** out, int cap, bool octal_spi,
                                  ReservedPins used = {}) {
    int all_n = 0, n = 0;
    const Env3Preset* all = env3_presets_all(all_n);
    for (int i = 0; i < all_n && n < cap; ++i) {
        if (all[i].sda == all[i].scl ||
            !board_pin_offerable(all[i].sda, octal_spi, used) ||
            !board_pin_offerable(all[i].scl, octal_spi, used)) continue;
        out[n++] = &all[i];
    }
    return n;
}

} // namespace daik
