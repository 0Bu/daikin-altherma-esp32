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
#include "logic/demo.hpp"
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
    // Sum-then-NOT (X10A checksum).
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
    const uint8_t le[] = {0x2C, 0x01};                 // little-endian 0x012C = 300
    CHECK(read_u16(le, 2, false) == 300);
    CHECK(read_u16(le, 2, true) == 0x2C01);            // big-endian view of the same bytes
    const uint8_t be[] = {0x01, 0x2C};                 // big-endian 0x012C = 300
    CHECK(read_u16(be, 2, true) == 300);
    const uint8_t neg[] = {0x9C, 0xFF};                // little-endian 0xFF9C = -100 signed
    CHECK(read_s16(neg, 2, false) == -100);
    CHECK(read_u16(neg, 2, false) == 0xFF9C);
    const uint8_t one[] = {0x2A};                      // 1-byte field reads data[0]
    CHECK(read_u16(one, 1, false) == 42);
    CHECK(read_s16(one, 1, false) == 42);              // high byte 0 -> stays positive
    CHECK(in_bounds(2, 2, 10));
    CHECK(!in_bounds(9, 2, 10));
}

static void test_convert() {
    // conv 105 = signed, little-endian, ×0.1 (temperature).
    ValueDef temp{0x61, 0, 105, 2, 1, "T"};
    const uint8_t pos[] = {0x2C, 0x01};                // LE 300 -> 30.0 °C
    CHECK(convert(temp, pos).ok && approx(convert(temp, pos).value, 30.0));
    const uint8_t negt[] = {0x9C, 0xFF};               // LE 0xFF9C = -100 -> -10.0 °C
    CHECK(approx(convert(temp, negt).value, -10.0));   // sign/endianness fix: NOT 6543.6

    // conv 152 = unsigned big-endian integer (counts/steps).
    ValueDef cnt{0x30, 0, 152, 1, -1, "n"};
    const uint8_t c[] = {0x2A};
    CHECK(approx(convert(cnt, c).value, 42.0));

    // conv 161 = unsigned big-endian ×0.5 (CT current).
    ValueDef ct{0x63, 0, 161, 1, 3, "CT"};
    const uint8_t a[] = {0x14};                        // 20 -> 10.0 A
    CHECK(approx(convert(ct, a).value, 10.0));

    ValueDef unk{0x00, 0, 998, 1, -1, "x"};            // layout marker -> unimplemented/skipped
    CHECK(convert(unk, c).unimpl);

    // ── Converters recovered from the value-definition analysis ──
    // conv 114 = signed LE ×0.1 target temp; 0x8000 (bytes 00 80) = "no data".
    ValueDef tgt{0x10, 0, 114, 2, 1, "Tt"};
    const uint8_t t441[] = {0xB9, 0x01};               // LE 0x01B9 = 441 -> 44.1 °C
    CHECK(convert(tgt, t441).ok && approx(convert(tgt, t441).value, 44.1));
    const uint8_t tnd[] = {0x00, 0x80};                // 0x8000 -> no data
    CHECK(!convert(tgt, tnd).ok);

    // conv 118 = signed big-endian ×0.01 (mixed-water temp).
    ValueDef mw{0x64, 10, 118, 2, 1, "mw"};
    const uint8_t mwb[] = {0x0D, 0xDA};                // BE 0x0DDA = 3546 -> 35.46
    CHECK(approx(convert(mw, mwb).value, 35.46));

    // conv 300..307 = bit b (0 = LSB) of data[0] -> ON/OFF.
    const uint8_t bits[] = {0x80};                     // only bit 7 set
    ValueDef b7{0x10, 1, 307, 1, -1, "b7"};
    ValueDef b0{0x10, 1, 300, 1, -1, "b0"};
    CHECK(std::string(convert(b7, bits).text) == "ON");
    CHECK(std::string(convert(b0, bits).text) == "OFF");

    // conv 217 = operation mode; conv 315 = indoor mode from the HIGH nibble.
    ValueDef om{0x10, 0, 217, 1, -1, "om"};
    const uint8_t m1[] = {0x01};
    CHECK(std::string(convert(om, m1).text) == "Heating");
    ValueDef im{0x60, 2, 315, 1, -1, "im"};
    const uint8_t im10[] = {0x10};                     // hi nibble 1 -> Heating
    CHECK(std::string(convert(im, im10).text) == "Heating");

    // conv 203 = error class; conv 204 = 2-char Daikin error code (hi/lo nibble tables).
    ValueDef et{0x10, 4, 203, 1, -1, "et"};
    const uint8_t e0[] = {0x00};
    CHECK(std::string(convert(et, e0).text) == "Normal");
    ValueDef ec{0x10, 5, 204, 1, -1, "ec"};
    const uint8_t u4[] = {0x94};                        // hi 9 -> 'U', lo 4 -> '4'
    CHECK(std::string(convert(ec, u4).text) == "U4");

    // conv 211 = fan step (0 -> OFF, else the number); conv 316 = hybrid mode.
    ValueDef fs{0x30, 1, 211, 1, -1, "fs"};
    const uint8_t f0[] = {0x00};
    const uint8_t f5[] = {0x05};
    CHECK(std::string(convert(fs, f0).text) == "OFF");
    CHECK(convert(fs, f5).ok && approx(convert(fs, f5).value, 5.0));
    ValueDef hy{0x64, 2, 316, 1, -1, "hy"};
    const uint8_t h1[] = {0x01};
    CHECK(std::string(convert(hy, h1).text) == "Hybrid");

    // conv 802 = refrigerant type (encoded by the converter id; reads no bytes).
    ValueDef rf{0x00, 0, 802, 0, -1, "rf"};
    CHECK(std::string(convert(rf, c).text) == "R32");

    // Refrigerant pressure->temperature curve is monotonic in the working range.
    CHECK(press2temp(20.0) < press2temp(30.0));

    // HA hints derived from the dataType field.
    CHECK(std::string(unit_for_datatype(1)) == "°C");
    CHECK(std::string(device_class_for_datatype(3)) == "current");
    CHECK(std::string(unit_for_datatype(2)) == "bar");
    CHECK(std::string(unit_for_datatype(-1)).empty());
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
    std::string cfg = discovery_config("daikin_abc123", "daikin-altherma-esp32/daikin_abc123/state", def);
    CHECK(cfg.find("\"dev_cla\":\"temperature\"") != std::string::npos);
    CHECK(cfg.find("\"unit_of_meas\":\"°C\"") != std::string::npos);
    CHECK(cfg.find("value_json.dhw_tank_temp_r5t") != std::string::npos);
    CHECK(cfg.find("\"uniq_id\":\"daikin_abc123_dhw_tank_temp_r5t\"") != std::string::npos);
}

static void test_demo() {
    // Demo mode fabricates raw bytes that flow through the SAME convert() path as real data; assert
    // the readings come out plausible and self-consistent (logic/demo.hpp).
    ValueDef oat {0x20, 0, 105, 2, 1,  "R1T-Outdoor air temp."};
    ValueDef lw  {0x60, 9, 105, 2, 1,  "LW setpoint (main)"};
    ValueDef tank{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    uint8_t b[2];
    for (uint32_t t = 1; t < 6; t++) {
        CHECK(demo_encode(oat, t, b) == 2);
        CHECK(convert(oat, b).value > -20.0 && convert(oat, b).value < 20.0);   // outdoor: cold-ish
        demo_encode(tank, t, b);
        CHECK(convert(tank, b).value > 40.0 && convert(tank, b).value < 60.0);  // DHW: hot
    }
    // Outdoor air reads colder than the leaving-water setpoint at a fixed tick.
    demo_encode(oat, 3, b); const double a = convert(oat, b).value;
    demo_encode(lw,  3, b); const double c = convert(lw,  b).value;
    CHECK(a < c);

    // Flags/enums land on the intended "actively heating" demo state.
    ValueDef th  {0x60, 2, 303, 1, -1, "Thermostat ON/OFF"};
    ValueDef prot{0x60, 2, 302, 1, -1, "Freeze Protection"};
    ValueDef om  {0x10, 0, 217, 1, -1, "Operation Mode"};
    demo_encode(th,   1, b); CHECK(std::string(convert(th,   b).text) == "ON");
    demo_encode(prot, 1, b); CHECK(std::string(convert(prot, b).text) == "OFF");
    demo_encode(om,   1, b); CHECK(std::string(convert(om,   b).text) == "Heating");

    // Current stays in a believable amp range.
    ValueDef ct{0x21, 0, 105, 2, -1, "INV primary current (A)"};
    demo_encode(ct, 2, b);
    CHECK(convert(ct, b).value > 1.0 && convert(ct, b).value < 8.0);

    // A converter demo doesn't fabricate -> 0 bytes, so the value is simply skipped.
    ValueDef unk{0x00, 0, 998, 1, -1, "x"};
    CHECK(demo_encode(unk, 1, b) == 0);
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
    test_demo();
    test_registry();
    if (g_failures == 0) { std::printf("all logic tests passed\n"); return 0; }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
