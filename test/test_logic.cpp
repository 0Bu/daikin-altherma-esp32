// Host logic tests for the IDF-free pure headers in main/logic/. One translation unit; run via
// scripts/run-mock-tests.sh (cmake+ctest, or a direct g++/clang++ compile). CI's logic-test job
// gates the firmware build on this. Add a CHECK here whenever you touch a converter / CRC / the
// config model / a discovery payload — the riskiest, silently-wrong parts of the port.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>

#include "logic/config_model.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include "logic/discovery.hpp"
#include "logic/registers.hpp"
#include "def/registry.hpp"

static int g_failures = 0;
#define CHECK(cond)                                                                       \
    do {                                                                                  \
        if (!(cond)) {                                                                    \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);                   \
            g_failures++;                                                                 \
        }                                                                                 \
    } while (0)

static bool approx(double a, double b) { return std::fabs(a - b) < 1e-6; }

using namespace daik;

static void test_crc() {
    // Sum-then-NOT (ESPAltherma getCRC).
    const uint8_t d[] = {0x03, 0x40, 0x60};
    CHECK(crc(d, 3) == static_cast<uint8_t>(~(0x03 + 0x40 + 0x60)));

    uint8_t req[4];
    CHECK(build_request(0x60, Protocol::I, req) == 4);
    CHECK(req[0] == 0x03 && req[1] == 0x40 && req[2] == 0x60 && req[3] == crc(req, 3));

    CHECK(build_request(0x60, Protocol::S, req) == 3);
    CHECK(req[0] == 0x02 && req[1] == 0x60 && req[2] == crc(req, 2));

    CHECK(reply_len(0x50, Protocol::S) == 6);
    CHECK(reply_len(0x56, Protocol::S) == 4);
    CHECK(reply_len(0x99, Protocol::S) == 18);
    CHECK(reply_len(0x60, Protocol::I) == 12);

    const uint8_t err[] = {0x15, 0xea};
    CHECK(is_error_reply(err, 2));

    // A frame whose last byte is the CRC of the rest verifies.
    uint8_t frame[] = {0x40, 0x00, 0x12, 0x00};
    frame[3] = crc(frame, 3);
    CHECK(crc_ok(frame, 4));
    frame[3] ^= 0xff;
    CHECK(!crc_ok(frame, 4));
}

static void test_registers() {
    const uint8_t le[] = {0x2C, 0x01};                 // 0x012C = 300 little-endian
    CHECK(read_int(le, 2, false) == 300);
    const uint8_t neg[] = {0xFF, 0xFF};                // -1 signed
    CHECK(read_int(neg, 2, true) == -1);
    CHECK(read_int(neg, 2, false) == 65535);
    CHECK(in_bounds(2, 2, 10));
    CHECK(!in_bounds(9, 2, 10));
}

static void test_convert() {
    ValueDef temp{0x61, 0, 105, 2, 1, "T"};            // conv 105 = signed*0.1
    const uint8_t t[] = {0x2C, 0x01};                  // 300 -> 30.0
    Reading r = convert(temp, t);
    CHECK(r.ok && approx(r.value, 30.0));

    ValueDef cnt{0x30, 0, 152, 1, -1, "n"};            // conv 152 = unsigned int
    const uint8_t c[] = {0x2A};
    CHECK(approx(convert(cnt, c).value, 42.0));

    ValueDef unk{0x00, 0, 999, 1, -1, "x"};            // unimplemented -> skipped
    CHECK(convert(unk, c).unimpl);

    // Refrigerant pressure->temperature curve is monotonic in the working range.
    CHECK(press2temp(20.0) < press2temp(30.0));

    // HA hints from converter id.
    CHECK(std::string(unit_for_conv(105)) == "°C");
    CHECK(std::string(device_class_for_conv(161)) == "current");
    CHECK(std::string(unit_for_conv(152)).empty());
}

static void test_config_model() {
    Config c;
    c.rx_pin = 44; c.tx_pin = 43; c.poll_s = 30;
    std::string why;
    CHECK(validate(c, why));

    c.tx_pin = 44;                                     // rx == tx
    CHECK(!validate(c, why));

    c.tx_pin = 43; c.poll_s = 3;                       // interval too small
    CHECK(!validate(c, why));

    c.poll_s = 30; c.sg1_pin = 44;                     // control pin collides with RX
    CHECK(!validate(c, why));

    CHECK(parse_protocol("S") == Protocol::S);
    CHECK(parse_protocol("I") == Protocol::I);
    CHECK(parse_protocol("") == Protocol::I);
}

static void test_discovery() {
    CHECK(object_id("DHW Tank Temp (R5T)") == "dhw_tank_temp_r5t");
    CHECK(object_id("  A/B  ") == "a_b");

    ValueDef def{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    std::string cfg = discovery_config("daikin_abc123", "daikin-altherma/daikin_abc123/state", def);
    CHECK(cfg.find("\"dev_cla\":\"temperature\"") != std::string::npos);
    CHECK(cfg.find("\"unit_of_meas\":\"°C\"") != std::string::npos);
    CHECK(cfg.find("value_json.dhw_tank_temp_r5t") != std::string::npos);
    CHECK(cfg.find("\"uniq_id\":\"daikin_abc123_dhw_tank_temp_r5t\"") != std::string::npos);
}

static void test_registry() {
    CHECK(std::string(def::lookup("altherma3_r_erga").id) == "altherma3_r_erga");
    CHECK(def::lookup("altherma3_r_erga").count > 10);
    CHECK(std::string(def::lookup("nonexistent").id) == "generic");   // fallback
}

int main() {
    test_crc();
    test_registers();
    test_convert();
    test_config_model();
    test_discovery();
    test_registry();
    if (g_failures == 0) { std::printf("all logic tests passed\n"); return 0; }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
