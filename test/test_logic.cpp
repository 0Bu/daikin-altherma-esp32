// Host logic tests for the IDF-free pure headers in main/logic/. One translation unit; run via
// scripts/run-mock-tests.sh (cmake+ctest, or a direct g++/clang++ compile). CI's logic-test job
// gates the firmware build on this. Add a CHECK here whenever you touch a converter / CRC / the
// config model / a discovery payload — the riskiest, silently-wrong parts of the port.
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <string>

#include "logic/board_pins.hpp"
#include "logic/boot_guard.hpp"
#include "logic/bootlog.hpp"
#include "logic/config_model.hpp"
#include "logic/convert.hpp"
#include "logic/crashinfo.hpp"
#include "logic/crc.hpp"
#include "logic/detect.hpp"
#include "logic/discovery.hpp"
#include "logic/health_gate.hpp"
#include "logic/heartbeat.hpp"
#include "logic/http_body.hpp"
#include "logic/json.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/link_watch.hpp"
#include "logic/mqtt_uri.hpp"
#include "logic/modbus.hpp"
#include "logic/registers.hpp"
#include "logic/reset_reason.hpp"
#include "logic/syslog_policy.hpp"
#include "logic/wifi_rollback.hpp"
#include "logic/ws_policy.hpp"
#include "def/registry.hpp"
#include "def/signatures.hpp"

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

    // --- Dynamic length and safety bounds checks (Vulnerability 2.1) ---
    // Test that reply_len_dynamic parses the length byte at index 2 correctly (buf[2] + 2).
    uint8_t d_buf[] = {0x40, 0x00, 10}; // buf[2] = 10 -> reply length should be 12
    CHECK(reply_len_dynamic(d_buf) == 12);

    // Test the safety boundary check (is_valid_dynamic_len) with a 64-byte buffer:
    const size_t test_buflen = 64;
    // 1. Valid cases: length within buffer capacity
    CHECK(is_valid_dynamic_len(12, test_buflen) == true);
    CHECK(is_valid_dynamic_len(64, test_buflen) == true);
    CHECK(is_valid_dynamic_len(0, test_buflen) == true);

    // 2. Provoke and test out-of-bounds cases:
    // Length exactly 1 byte over capacity (should be rejected)
    CHECK(is_valid_dynamic_len(65, test_buflen) == false);
    // Extreme overrun case, e.g. 257 bytes due to a 0xFF corrupt length byte (should be rejected)
    CHECK(is_valid_dynamic_len(257, test_buflen) == false);
    // Negative length case (should be rejected)
    CHECK(is_valid_dynamic_len(-1, test_buflen) == false);
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

    // conv 151 = unsigned LITTLE-endian (expansion-valve pulses, 27 profiles); conv 152 reads the
    // SAME bytes big-endian. Pin both byte orders so a 151/152 transcription slip can't ship silently.
    ValueDef u151{0x30, 3, 151, 2, -1, "u151"};
    ValueDef u152{0x30, 3, 152, 2, -1, "u152"};
    const uint8_t u2b[] = {0x2C, 0x01};                // LE -> 300, BE -> 0x2C01 = 11265
    CHECK(convert(u151, u2b).ok && approx(convert(u151, u2b).value, 300.0));
    CHECK(convert(u152, u2b).ok && approx(convert(u152, u2b).value, 11265.0));
    CHECK(!approx(convert(u151, u2b).value, convert(u152, u2b).value));  // 151 != 152 on the same bytes

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
    const uint8_t m5[] = {0x05};
    const uint8_t m6[] = {0x06};
    CHECK(std::string(convert(om, m5).text) == "Auto Cool");   // mode index 5 = Auto Cool
    CHECK(std::string(convert(om, m6).text) == "Auto Heat");   // mode index 6 = Auto Heat
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

    // conv 801-805 = refrigerant type (encoded by the converter id; reads no bytes). The id -> curve
    // mapping in profile_refrigerant depends on each label decoding correctly.
    ValueDef rf{0x00, 0, 802, 0, -1, "rf"};
    CHECK(std::string(convert(rf, c).text) == "R32");
    CHECK(std::string(convert(ValueDef{0x00, 0, 801, 0, -1, "rf"}, c).text) == "R410A");
    CHECK(std::string(convert(ValueDef{0x00, 0, 803, 0, -1, "rf"}, c).text) == "R22");
    CHECK(std::string(convert(ValueDef{0x00, 0, 804, 0, -1, "rf"}, c).text) == "R407C");
    CHECK(std::string(convert(ValueDef{0x00, 0, 805, 0, -1, "rf"}, c).text) == "R134a");

    // conv 214/215 = raw EEPROM identification byte (no name table -> exposed as the byte value).
    ValueDef ee{0x11, 0, 215, 1, -1, "ee"};
    const uint8_t e34[] = {0x34};
    CHECK(convert(ee, e34).ok && approx(convert(ee, e34).value, 52.0));   // 0x34 = 52

    // conv 219 = I/U capacity code (raw byte, 43 profiles) -> exposed as the raw code value.
    ValueDef cap{0x00, 0, 219, 1, -1, "cap"};
    const uint8_t cap8[] = {0x08};
    CHECK(convert(cap, cap8).ok && approx(convert(cap, cap8).value, 8.0));

    // Refrigerant pressure->temperature curve is monotonic in the working range.
    CHECK(press2temp(20.0) < press2temp(30.0));
    // Refrigerant type selects the curve: R410A (801) and R22 (803) differ from the R32 (802)
    // default; unknown ids (804/805) fall back to R32. A conv-405 row must honour rtype.
    CHECK(!approx(press2temp(20.0, 801), press2temp(20.0, 802)));
    CHECK(!approx(press2temp(20.0, 803), press2temp(20.0, 802)));
    CHECK(approx(press2temp(20.0, 804), press2temp(20.0, 802)));
    ValueDef p405{0x62, 0, 405, 2, 1, "Pt"};
    const uint8_t p200[] = {0xC8, 0x00};               // LE 200 -> 20.0 bar in
    CHECK(!approx(convert(p405, p200, 801).value, convert(p405, p200, 802).value));
    CHECK(approx(convert(p405, p200, 802).value, convert(p405, p200).value));   // default == R32

    // profile_refrigerant: pick the 801-805 row's id, else default to R32 (802).
    const ValueDef prof801[] = {{0x00, 0, 801, 0, -1, "*Refrigerant type"}, {0x61, 0, 105, 2, 1, "T"}};
    const ValueDef prof_none[] = {{0x61, 0, 105, 2, 1, "T"}};
    CHECK(profile_refrigerant(prof801, 2) == 801);
    CHECK(profile_refrigerant(prof_none, 1) == 802);

    // display_decimals: ×0.01 -> 2, scaled families (incl. 161 CT current and 405) -> 1, integers 0.
    CHECK(display_decimals(118) == 2);
    CHECK(display_decimals(161) == 1);                 // was formatted as an integer, losing 0.5
    CHECK(display_decimals(105) == 1);
    CHECK(display_decimals(405) == 1);
    CHECK(display_decimals(152) == 0);
    CHECK(display_decimals(217) == 0);

    // Catalog-wide regression guard for the "Water pressure" quirk: the hydronic water
    // pressure at reg 0x62 offset 11 must decode as raw bar (conv 105, type 2) in EVERY profile —
    // never the refrigerant saturation-temp curve (conv 405) the catalog mis-assigned on the 4-8kW /
    // E-series models. (Legit conv-405 refrigerant "(T)" rows live at other offsets, e.g. 0x62[15].)
    int wp_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x62 && p.values[i].offset == 11) {
                CHECK(p.values[i].conv == 105 && p.values[i].type == 2);
                wp_checked++;
            }
    CHECK(wp_checked >= 40);   // every model carries this row; all must be raw bar

    // Catalog guard (#35): "Mixed water temp." at reg 0x64 offset 10 is signed BE ×0.01 (conv 118)
    // in EVERY profile — never conv 105 (signed LE ×0.1), which decodes 0D DA as -971.5 °C.
    int mw_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x64 && p.values[i].offset == 10) {
                CHECK(p.values[i].conv == 118);
                mw_checked++;
            }
    CHECK(mw_checked >= 36);    // 36 profiles carry this row; all must be conv 118

    // Catalog guard (#36): a reg 0x65 offset-0 row that is NOT a temperature (e.g. the [EKMIK]
    // mix-valve position M1S) must be a raw signed byte — size 1, non-°C (type != 1) — never the
    // size-2/type-1 (°C) shape that published the valve position as a phantom 12800 °C sensor.
    auto label_has_temp = [](const char* s) {
        std::string t(s);
        for (char& ch : t) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        return t.find("temp") != std::string::npos;
    };
    int m1s_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x65 && p.values[i].offset == 0 &&
                !label_has_temp(p.values[i].label)) {
                CHECK(p.values[i].size == 1 && p.values[i].type != 1);
                m1s_checked++;
            }
    CHECK(m1s_checked >= 4);    // the 4 EPRA M1S valve-position rows

    // Catalog guard (#38): "Target Evap./Cond. Temp." at reg 0x10 offsets 6 and 8 uses conv 114
    // (signed LE ×0.1 with the 0x8000 no-data sentinel) in EVERY profile — never conv 105, which
    // publishes the 0x8000 idle marker as a real -3276.8 °C reading.
    int tgt_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x10 &&
                (p.values[i].offset == 6 || p.values[i].offset == 8)) {
                CHECK(p.values[i].conv == 114);
                tgt_checked++;
            }
    CHECK(tgt_checked >= 80);   // both offsets across ~44 profiles

    // Catalog guard (#37): reg 0x30 offset 2 is "Fan 2 (step)" (conv 211, size 1) where present —
    // never a size-2 field. A size-2 read there swallows the Fan 2 byte into the expansion-valve
    // count (Fan 2 dropped, valve fabricated). Expansion valve 1 lives at offset 3.
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x30 && p.values[i].offset == 2)
                CHECK(p.values[i].size == 1);

    // conv 311 = BUH output-capacity step, bits 0-2 ONLY. The upper bits belong to other fields,
    // so the whole byte must never be published: 0x85 is step 5, not 133.
    ValueDef buh{0x63, 13, 311, 1, -1, "BUH output capacity"};
    const uint8_t buh85[] = {0x85};
    CHECK(convert(buh, buh85).ok && approx(convert(buh, buh85).value, 5.0));
    const uint8_t buh07[] = {0x07};
    CHECK(approx(convert(buh, buh07).value, 7.0));    // full 3-bit range passes through
    const uint8_t buhF8[] = {0xF8};
    CHECK(approx(convert(buh, buhF8).value, 0.0));    // only the high bits set -> step 0

    // Catalog guard: "BUH output capacity" at reg 0x63 offset 13 is the 3-bit conv 311 in EVERY
    // profile — never conv 152, which publishes the whole byte (0x85 -> 133 instead of 5).
    int buh_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x63 && p.values[i].offset == 13) {
                CHECK(p.values[i].conv == 311 && p.values[i].size == 1);
                buh_checked++;
            }
    CHECK(buh_checked >= 10);   // 10 profiles carry this row; all must be conv 311

    // Catalog guard: "Ext. indoor ambient sensor (R6T)" sits at reg 0x61 offset 14. At offset 13 a
    // size-2 read straddles "Indoor ambient temp. (R1T)" [12..13], assembling R6T out of R1T's high
    // byte and R6T's low byte.
    int r6t_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x61 && std::string(p.values[i].label).find("(R6T)") != std::string::npos) {
                CHECK(p.values[i].offset == 14);
                r6t_checked++;
            }
    CHECK(r6t_checked >= 39);   // 39 profiles carry this row; all at offset 14

    // Catalog guard: conv 405 converts a pressure to a saturation TEMPERATURE, so every 405 row
    // must be typed °C — type -1 strips the unit and device_class off the HA entity.
    int t405_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].conv == 405) {
                CHECK(p.values[i].type == 1);
                t405_checked++;
            }
    CHECK(t405_checked >= 40);

    // Catalog guard (generalises #37): within one register, no two rows may STRADDLE each other's
    // bytes. Sharing a field on purpose is an idiom here (raw pressure + its saturation temp; the
    // per-accessory 0x65 variants) and those windows start at the SAME offset. Two windows starting
    // at DIFFERENT offsets and overlapping have no legitimate reading: one value is assembled from
    // two unrelated fields and its neighbour's is lost.
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            for (size_t j = i + 1; j < p.count; j++) {
                const ValueDef& a = p.values[i];
                const ValueDef& b = p.values[j];
                if (a.reg != b.reg || a.size == 0 || b.size == 0) continue;
                if (a.offset == b.offset) continue;              // same start = dual view / variant
                const int a0 = a.offset, a1 = a.offset + a.size - 1;
                const int b0 = b.offset, b1 = b.offset + b.size - 1;
                CHECK(a1 < b0 || b1 < a0);                       // else: straddling collision
            }

    // HA hints derived from the dataType field.
    CHECK(std::string(unit_for_datatype(1)) == "°C");
    CHECK(std::string(device_class_for_datatype(3)) == "current");
    CHECK(std::string(unit_for_datatype(2)) == "bar");
    CHECK(std::string(unit_for_datatype(-1)).empty());
}

static void test_config_model() {
    Config c;
    c.rx_pin = 44; c.tx_pin = 43;
    std::string why;
    CHECK(validate(c, why));

    c.tx_pin = 44;                                     // rx == tx
    CHECK(!validate(c, why));

    c.tx_pin = 99;                                     // tx out of GPIO range (default max 48)
    CHECK(!validate(c, why));
    c.tx_pin = 43;
    CHECK(validate(c, why));

    c.syslog_host = "1.2.3.4";
    c.syslog_port = 0;                                 // syslog port out of range
    CHECK(!validate(c, why));
    c.syslog_port = 65536;                             // syslog port out of range
    CHECK(!validate(c, why));
    c.syslog_port = 514;                               // valid syslog port
    CHECK(validate(c, why));
    c.syslog_host = "";                                // reset to default

    // Target-aware GPIO range: the ESP32-S3 default 44/43 is valid on a 48-GPIO target but must be
    // rejected on an ESP32-C3 (max GPIO 21), where those pins physically don't exist.
    CHECK(validate(c, why, 48));
    CHECK(!validate(c, why, 21));

    // The link pair rule on its own — config.cpp applies it to the pins coming back OUT of NVS,
    // where there is no Config to validate() and no reason string to report. rx_pin/tx_pin are two
    // independent NVS commits, so the pair that matters most is the one no request could have set:
    // a half-applied swap {44,43} -> {43,44} that leaves rx == tx.
    CHECK(link_pins_valid(44, 43));
    CHECK(link_pins_valid(43, 44));                    // the swap is a legal link, just mirrored
    CHECK(!link_pins_valid(43, 43));                   // half-applied swap: rx write through, tx not
    CHECK(!link_pins_valid(-1, 43));                   // negative rx (NVS default miss)
    CHECK(!link_pins_valid(44, 99));                   // tx above the range
    CHECK(!link_pins_valid(44, 43, 21));               // valid pair, wrong chip (S3 pins on a C3)
    // Agrees with validate() on the pair, since validate() defers to it.
    c.rx_pin = 43; c.tx_pin = 43;
    CHECK(!validate(c, why) && !link_pins_valid(c.rx_pin, c.tx_pin));
    c.rx_pin = 44; c.tx_pin = 43;
    CHECK(validate(c, why) && link_pins_valid(c.rx_pin, c.tx_pin));

    CHECK(parse_protocol("S") == Protocol::S);
    CHECK(parse_protocol("I") == Protocol::I);
    CHECK(parse_protocol("") == Protocol::I);

    // WiFi credential validation (POST /set_wifi): SSID 1..32, password empty (open) or 8..63.
    std::string wr;
    CHECK(wifi_credentials_valid("MyNet", "", wr));                       // open network, ok
    CHECK(wifi_credentials_valid("MyNet", "hunter22", wr));               // 8-char password, ok
    CHECK(wifi_credentials_valid(std::string(32, 'x'), "", wr));          // 32-char SSID boundary, ok
    CHECK(wifi_credentials_valid("MyNet", std::string(63, 'p'), wr));     // 63-char password boundary, ok
    CHECK(!wifi_credentials_valid("", "password", wr));                   // empty SSID rejected
    CHECK(!wifi_credentials_valid(std::string(33, 'x'), "", wr));         // 33-char SSID rejected
    CHECK(!wifi_credentials_valid("MyNet", "short", wr));                 // <8-char password rejected
    CHECK(!wifi_credentials_valid("MyNet", std::string(64, 'p'), wr));    // >63-char password rejected

    // /set_hp fingerprint rule: a partial live update (no "profile" key) never clears the cached
    // detection, whatever the stored profile is; only an explicit "auto" does; a manual pin doesn't.
    CHECK(!set_hp_clears_fingerprint(false, "auto"));            // wiring-only patch (no "profile")
    CHECK(!set_hp_clears_fingerprint(false, "altherma_gshp"));   // partial update on a pinned model
    CHECK(set_hp_clears_fingerprint(true, "auto"));             // explicit re-detect / wiring Save
    CHECK(!set_hp_clears_fingerprint(true, "altherma_gshp"));    // manual pin keeps the fingerprint

    // Field-owned detection commits. The poll task snapshots the config, probes the bus for a whole
    // sweep, then commits — so anything it writes beyond its OWN fields is written from a snapshot
    // that may predate a /set_wifi. These patch in place and must touch nothing else.
    Config live;                                       // stand-in for the live config
    live.wifi_ssid = "new-net";                        // as if POST /set_wifi landed mid-sweep
    live.wifi_pass = "new-secret";
    live.mqtt_uri  = "mqtts://broker.lan";
    live.syslog_host = "logs.lan";
    live.rx_pin = 44; live.tx_pin = 43; live.proto = Protocol::I;

    apply_link(live, 16, 17, Protocol::S);             // detection found the wire swapped
    CHECK(live.rx_pin == 16 && live.tx_pin == 17 && live.proto == Protocol::S);
    CHECK(live.wifi_ssid == "new-net");                // #49: the credentials must survive the commit
    CHECK(live.wifi_pass == "new-secret");
    CHECK(live.mqtt_uri == "mqtts://broker.lan");
    CHECK(live.syslog_host == "logs.lan");
    CHECK(live.profile == "auto");                     // link patch leaves the model alone

    // "altherma3_r_erga" is >15 chars: past libstdc++'s SSO buffer, so this is the case that would
    // heap-allocate if apply_model copied instead of swapping (config.cpp calls it under the mutex).
    apply_model(live, "altherma3_r_erga", 0x5u, 80, "1234");
    CHECK(live.profile == "altherma3_r_erga");
    CHECK(live.fp_pages == 0x5u && live.fp_kw_tenths == 80 && live.fp_eeprom == "1234");
    CHECK(live.fp_valid);                              // a committed model is always valid
    CHECK(live.rx_pin == 16 && live.tx_pin == 17);     // model patch leaves the link alone
    CHECK(live.wifi_ssid == "new-net");                // ...and the credentials
    CHECK(live.mqtt_uri == "mqtts://broker.lan");
}

static void test_discovery() {
    CHECK(object_id("DHW Tank Temp (R5T)") == "dhw_tank_temp_r5t");
    CHECK(object_id("  A/B  ") == "a_b");

    ValueDef def{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    const std::string base = "daikin-altherma-esp32", node = "daikin_abc123";
    const std::string st = state_topic(base, node);       // ONE shared topic for every sensor
    CHECK(st == "daikin-altherma-esp32/daikin_abc123/state");
    CHECK(availability_topic(base, node) == "daikin-altherma-esp32/daikin_abc123/status");
    std::string cfg = discovery_config(node, st, availability_topic(base, node), def);
    CHECK(cfg.find("\"dev_cla\":\"temperature\"") != std::string::npos);
    CHECK(cfg.find("\"stat_cla\":\"measurement\"") != std::string::npos);
    CHECK(cfg.find("\"unit_of_meas\":\"°C\"") != std::string::npos);
    CHECK(cfg.find("\"stat_t\":\"daikin-altherma-esp32/daikin_abc123/state\"") != std::string::npos);
    CHECK(cfg.find("\"avty_t\":\"daikin-altherma-esp32/daikin_abc123/status\"") != std::string::npos);
    // Shared JSON topic -> value_template subscripts group (page 0x61 -> hydronic_temps) + object.
    CHECK(cfg.find("\"val_tpl\":\"{{ value_json['hydronic_temps']['dhw_tank_temp_r5t'] }}\"")
          != std::string::npos);
    CHECK(cfg.find("\"uniq_id\":\"daikin_abc123_dhw_tank_temp_r5t\"") != std::string::npos);

    // A slug that starts with a digit must stay valid — bracket notation, not attribute access.
    ValueDef way{0x60, 12, 307, 1, -1, "2way valve(On:Heat_Off:Cool)"};
    std::string wc = discovery_config(node, st, availability_topic(base, node), way);
    CHECK(wc.find("value_json['hydronic']['2way_valve_on_heat_off_cool']") != std::string::npos);
}

static void test_registry() {
    CHECK(std::string(def::lookup("altherma3_r_erga").id) == "altherma3_r_erga");
    CHECK(def::lookup("altherma3_r_erga").count > 10);
    CHECK(std::string(def::lookup("nonexistent").id) == "generic");   // fallback

    // --- Profile size limits (Vulnerability 2.2) ---
    // Ensure that some profiles in the registry contain more than 64 values.
    // This verifies that a hardcoded limit of 64 in Web UI / REST / WebSocket snapshots (Vulnerability 2.2)
    // would cause telemetry truncation, and validates the need for dynamic sizing via def::lookup().
    const auto& epra = def::lookup("altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o");
    CHECK(epra.count > 64);
}

// Build a page mask from a list of register pages (mirrors what hp_detect sets when a page answers).
static uint32_t mask_of(std::initializer_list<uint8_t> regs) {
    uint32_t m = 0;
    for (uint8_t r : regs) m |= page_mask_bit(r);
    return m;
}

static bool has_candidate(const char** ids, int n, const char* id) {
    for (int i = 0; i < n; i++) if (std::string(ids[i]) == id) return true;
    return false;
}

static void test_detect() {
    // ── parse_kw_class: pull the capacity class out of a profile id (0.1 kW units) ──
    int lo = -1, hi = -1;
    CHECK(parse_kw_class("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", lo, hi) && lo == 40 && hi == 80);
    CHECK(parse_kw_class("altherma_lt_11_16kw_hydrosplit_hydro_unit", lo, hi) && lo == 110 && hi == 160);
    CHECK(parse_kw_class("altherma_ebla_edla_ewaa_ewya_d_series_9_16kw", lo, hi) && lo == 90 && hi == 160);
    CHECK(parse_kw_class("altherma_erla03_d_ehfh_ehfz_dj_series_3kw", lo, hi) && lo == 30 && hi == 30);
    CHECK(parse_kw_class("altherma_monobloc_ca_05_07kw", lo, hi) && lo == 50 && hi == 70);
    CHECK(parse_kw_class("altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3", lo, hi) && lo == 60 && hi == 100);
    // Model code "12p30_50" must not be mistaken for a capacity — the "kw" token wins.
    CHECK(parse_kw_class("altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o", lo, hi) && lo == 80 && hi == 120);
    // No kW in the id -> unknown (never filters on capacity).
    CHECK(!parse_kw_class("altherma_gshp", lo, hi) && lo == -1 && hi == -1);
    CHECK(!parse_kw_class("altherma3_r_erga", lo, hi));

    // 0x11 is probed for its digits but intentionally not a page-mask bit (no profile decodes it).
    CHECK(page_bit(0x11) < 0 && page_mask_bit(0x11) == 0);
    CHECK(page_bit(0x00) >= 0 && page_bit(0x64) >= 0);

    // ── detect_candidates against the REAL derived signatures ──
    Signature sigs[64];
    const int nsig = def::build_signatures(sigs, 64);
    CHECK(nsig >= 39);                                  // Altherma-only detection models
    // Altherma-only: no non-Altherma (minichiller_*) profile is ever a detection candidate.
    for (int i = 0; i < nsig; i++) CHECK(std::strncmp(sigs[i].id, "altherma", 8) == 0);
    const char* out[64];

    // A unit exposing exactly {00,10,20,21,30,60,61,62,63,64} (no 65/A0/A1) — only egsah/geo3 and
    // gshp2 share that page set. At 16 kW the geo3 kW class [6,10] is excluded -> gshp2 alone.
    Fingerprint fp{};
    fp.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64});
    fp.kw_tenths = 160;
    int n = detect_candidates(sigs, nsig, fp, out, 64);
    CHECK(n == 1 && std::string(out[0]) == "altherma_gshp2");

    // Same pages at 8 kW: geo3 [6,10] now also matches -> ambiguous set of exactly the two.
    fp.kw_tenths = 80;
    n = detect_candidates(sigs, nsig, fp, out, 64);
    CHECK(n == 2);
    CHECK(has_candidate(out, n, "altherma_gshp2"));
    CHECK(has_candidate(out, n, "altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3"));

    // Feature-poor units drop feature-rich profiles: adding no extra pages keeps max-overlap only.
    // A unit with the group-A page set {00,10,20,21,60,61,62,64} excludes anything needing 0x30/0x63.
    Fingerprint fa{};
    fa.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x60, 0x61, 0x62, 0x64});
    fa.kw_tenths = 60;
    n = detect_candidates(sigs, nsig, fa, out, 64);
    CHECK(n >= 1);
    CHECK(!has_candidate(out, n, "altherma_gshp2"));   // needs 0x30+0x63 the unit lacks

    // No bus response -> no candidates.
    Fingerprint none{};
    CHECK(detect_candidates(sigs, nsig, none, out, 64) == 0);

    // ── detect_best: a single deterministic representative to read with ──
    // Unambiguous case (gshp2 alone at 16 kW) → best is exactly that model.
    Fingerprint g2{};
    g2.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64});
    g2.kw_tenths = 160;
    CHECK(detect_best(sigs, nsig, g2) && std::string(detect_best(sigs, nsig, g2)) == "altherma_gshp2");
    // User's ERGA04-08E fingerprint (0x1bff, ~6 kW): best is an Altherma model, is one of the
    // candidates, and is never a chiller. The exact ERGA-vs-EBLA variant is register-identical so
    // which one is named is arbitrary — but it must be a consistent candidate, not registry-order junk.
    Fingerprint erga{};
    erga.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1});
    erga.kw_tenths = 60;
    const char* eb = detect_best(sigs, nsig, erga);
    CHECK(eb && std::strncmp(eb, "altherma", 8) == 0);
    int ecount = detect_candidates(sigs, nsig, erga, out, 64);
    CHECK(ecount > 1 && has_candidate(out, ecount, eb));   // best is drawn from the candidate set
    // The candidate set spans DIFFERENT marketing families — the ERGA-E split and the EBLA monobloc
    // are register-identical on X10A — which is exactly why /status reports it ambiguous and the UI
    // must not assert one model name. Lock both members so a signature change can't silently collapse
    // this to a confident (and, for half the owners, wrong) single pick.
    CHECK(has_candidate(out, ecount, "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    CHECK(has_candidate(out, ecount, "altherma_ebla_edla_d_series_4_8kw_monobloc"));
    // No bus → no best-fit.
    CHECK(detect_best(sigs, nsig, none) == nullptr);

    // Generic Altherma fallback = the universal register core (not the old 3-row stub); an unknown id
    // resolves to it — this is what an unrecognized / S-protocol unit reads with.
    CHECK(def::lookup("generic").count > 40);
    CHECK(std::string(def::lookup("no_such_profile").id) == "generic");

    // ── EEPROM render: raw hex pairs for display ──
    const uint8_t ee[] = {0x0B, 0x02, 0x00, 0x01, 0x03, 0x02};
    char buf[32];
    eeprom_render(ee, 6, buf, sizeof(buf));
    CHECK(std::string(buf) == "0B 02 00 01 03 02");
    eeprom_render(ee, 6, buf, 5);                       // small buffer: fits one pair, still NUL-terminated
    CHECK(std::string(buf) == "0B" && std::strlen(buf) < 5);
}

static void test_json() {
    // Clean ASCII is passed through untouched — the overwhelmingly common case.
    CHECK(json_quote("") == "\"\"");
    CHECK(json_quote("FRITZ!Box 7590 GX") == "\"FRITZ!Box 7590 GX\"");

    // The two chars the encoder always handled.
    CHECK(json_quote("say \"hi\"") == "\"say \\\"hi\\\"\"");
    CHECK(json_quote("C:\\net") == "\"C:\\\\net\"");
    CHECK(json_quote("\"\\") == "\"\\\"\\\\\"");

    // RFC 8259 §7 two-char escapes for the control chars that have one.
    CHECK(json_quote("\b") == "\"\\b\"");
    CHECK(json_quote("\f") == "\"\\f\"");
    CHECK(json_quote("\n") == "\"\\n\"");
    CHECK(json_quote("\r") == "\"\\r\"");
    CHECK(json_quote("\t") == "\"\\t\"");

    // Every other control char -> \u00XX. NUL is a real byte here (std::string is not NUL-terminated
    // logic), 0x0B/0x1F have no shorthand.
    CHECK(json_quote(std::string("\0", 1)) == "\"\\u0000\"");
    CHECK(json_quote("\x01") == "\"\\u0001\"");
    CHECK(json_quote("\x0B") == "\"\\u000b\"");
    CHECK(json_quote("\x1F") == "\"\\u001f\"");

    // The reachable case: an AP named Free<LF>WiFi. A raw newline here made GET /scan emit JSON that
    // fails JSON.parse, collapsing the setup portal's network dropdown to a free-text box.
    CHECK(json_quote("Free\nWiFi") == "\"Free\\nWiFi\"");

    // EXHAUSTIVE: no byte below 0x20 may ever reach the output raw, whatever the escape form.
    for (int b = 0x00; b < 0x20; ++b) {
        const std::string out = json_quote(std::string(1, static_cast<char>(b)));
        CHECK(out.find(static_cast<char>(b)) == std::string::npos);
        CHECK(out.size() >= 4 && out[1] == '\\');            // "" plus at least a 2-char escape
    }

    // Bytes >= 0x20 that the RFC does NOT require escaping must survive verbatim. UTF-8 is the trap:
    // `char` is signed, so a lead byte like 0xC3 is negative and a signed `c < 0x20` test would
    // mangle "Café" (and every non-ASCII SSID) into garbage \u00XX.
    CHECK(json_quote("Café") == "\"Café\"");
    CHECK(json_quote("\xE2\x98\x95") == "\"\xE2\x98\x95\"");  // U+2615, 3-byte UTF-8
    CHECK(json_quote("\x7F") == "\"\x7F\"");                 // DEL: legal unescaped per RFC 8259

    // json_append_escaped appends to what is already there (it is the inside-the-quotes form) —
    // crashinfo.hpp / heartbeat.hpp build their payloads that way.
    std::string acc = "x=";
    json_append_escaped(acc, "a\tb");
    CHECK(acc == "x=a\\tb");
}

static void test_mqtt_group() {
    // Register page -> friendly group name (docs/X10A_PROTOCOL.md §5); unknown page -> "other".
    CHECK(std::string(group_for_page(0x61)) == "hydronic_temps");
    CHECK(std::string(group_for_page(0x10)) == "outdoor_state");
    CHECK(std::string(group_for_page(0x64)) == "hybrid");
    CHECK(std::string(group_for_page(0x7F)) == "other");

    // Numbers (as hp_format emits them) are emitted unquoted; enum/text stays a quoted string.
    CHECK(is_json_number("48") && is_json_number("-3.5") && is_json_number("0.0"));
    CHECK(!is_json_number("") && !is_json_number("-") && !is_json_number("3."));
    CHECK(!is_json_number("1.2.3") && !is_json_number("A1") && !is_json_number("ON"));

    // Grouped JSON: max depth 1, groups+keys in first-seen order, numeric vs string typing.
    std::vector<GroupedValue> vals = {
        {"outdoor_state", "operation_mode", "Heating"},
        {"hydronic",      "dhw_setpoint",   "48"},
        {"hydronic",      "lw_setpoint",    "35.4"},
        {"outdoor_state", "error_type",     "Normal"},   // back to an earlier group -> same bucket
    };
    const std::string j = build_grouped_json(vals);
    CHECK(j == "{\"outdoor_state\":{\"operation_mode\":\"Heating\",\"error_type\":\"Normal\"},"
               "\"hydronic\":{\"dhw_setpoint\":48,\"lw_setpoint\":35.4}}");
    CHECK(build_grouped_json({}) == "{}");

    // A text value routes through the shared logic/json.hpp encoder, so a control char in one can't
    // break the state topic's JSON either (test_json covers the escaping itself).
    CHECK(build_grouped_json({{"other", "raw", "a\nb"}}) == "{\"other\":{\"raw\":\"a\\nb\"}}");
}

static void test_mqtt_uri() {
    // Broker URI -> host / port / TLS split (logic/mqtt_uri.hpp), matching mqtt_ha's scheme policy.
    std::string host;
    int port = 0;
    bool tls = false;

    // Bare host:port -> plaintext, explicit port.
    CHECK(parse_mqtt_uri("192.168.1.10:1883", host, port, tls) && host == "192.168.1.10" && port == 1883 && !tls);
    // Bare host, no port -> default plaintext 1883.
    CHECK(parse_mqtt_uri("broker.local", host, port, tls) && host == "broker.local" && port == 1883 && !tls);
    // Explicit mqtt:// scheme keeps plaintext + its port.
    CHECK(parse_mqtt_uri("mqtt://h:1884", host, port, tls) && host == "h" && port == 1884 && !tls);
    // mqtts:// with port -> TLS.
    CHECK(parse_mqtt_uri("mqtts://h:8884", host, port, tls) && host == "h" && port == 8884 && tls);
    // mqtts:// without port -> default TLS 8883.
    CHECK(parse_mqtt_uri("mqtts://h", host, port, tls) && host == "h" && port == 8883 && tls);
    // ws:// / wss:// without port -> the WebSocket transports default to the HTTP(S) ports esp-mqtt
    // itself uses (80/443), NOT 1883/8883 — the pre-flight must probe the port the client will use.
    CHECK(parse_mqtt_uri("wss://h", host, port, tls) && host == "h" && port == 443 && tls);
    CHECK(parse_mqtt_uri("ws://h", host, port, tls) && host == "h" && port == 80 && !tls);
    // An explicit port always wins over the scheme default.
    CHECK(parse_mqtt_uri("ws://h:9001", host, port, tls) && host == "h" && port == 9001 && !tls);
    CHECK(parse_mqtt_uri("wss://h:9002", host, port, tls) && host == "h" && port == 9002 && tls);
    // Empty string -> rejected.
    CHECK(!parse_mqtt_uri("", host, port, tls));
    // Scheme only, no host -> rejected.
    CHECK(!parse_mqtt_uri("mqtts://", host, port, tls));
    // Trailing colon (empty port) -> non-numeric -> rejected.
    CHECK(!parse_mqtt_uri("host:", host, port, tls));
    // Port range: 0 and >65535 are rejected at PARSE time — the probe's htons() would truncate
    // (:65537 -> :1) and report a port reachable that the client never dials.
    CHECK(!parse_mqtt_uri("h:0", host, port, tls));
    CHECK(!parse_mqtt_uri("h:65536", host, port, tls));
    CHECK(!parse_mqtt_uri("h:99999", host, port, tls));
    CHECK(!parse_mqtt_uri("mqtt://h:-1", host, port, tls));
    // Past int range entirely (stoi throws out_of_range) -> rejected, not wrapped.
    CHECK(!parse_mqtt_uri("h:99999999999999999999", host, port, tls));
    // The range boundaries themselves stay valid.
    CHECK(parse_mqtt_uri("h:1", host, port, tls) && port == 1);
    CHECK(parse_mqtt_uri("h:65535", host, port, tls) && port == 65535);
    // Trailing garbage: stoi would stop at the first non-digit and report 1883 — reject instead, so
    // a typo can't silently probe a different port than it reads.
    CHECK(!parse_mqtt_uri("h:1883x", host, port, tls));
    CHECK(!parse_mqtt_uri("h:18 83", host, port, tls));
    // stoi also skips leading whitespace and accepts a sign; esp-mqtt's URL parser accepts neither,
    // and the pre-flight must not read a port the client wouldn't.
    CHECK(!parse_mqtt_uri("h:+1883", host, port, tls));
    CHECK(!parse_mqtt_uri("h: 1883", host, port, tls));
    // A PATH must not be mistaken for part of the port — `/mqtt` is the de-facto standard path for
    // MQTT-over-WebSocket, so this is the normal shape of a ws(s) broker. Only host/port are taken;
    // esp-mqtt still receives the full URI with its path.
    CHECK(parse_mqtt_uri("wss://broker.example:8084/mqtt", host, port, tls) &&
          host == "broker.example" && port == 8084 && tls);
    CHECK(parse_mqtt_uri("ws://h:8083/mqtt", host, port, tls) && host == "h" && port == 8083 && !tls);
    // Path with no explicit port -> scheme default, and the path never leaks into the host (it used
    // to become a bogus "h/mqtt" hostname and surfaced later as a misleading "DNS lookup failed").
    CHECK(parse_mqtt_uri("ws://h/mqtt", host, port, tls) && host == "h" && port == 80 && !tls);
    CHECK(parse_mqtt_uri("wss://h/mqtt", host, port, tls) && host == "h" && port == 443 && tls);
    CHECK(parse_mqtt_uri("mqtt://h:1883/", host, port, tls) && host == "h" && port == 1883 && !tls);
    // Path but no host -> still rejected.
    CHECK(!parse_mqtt_uri("ws:///mqtt", host, port, tls));
    // The failure reason is distinct so /set_mqtt can tell a bad port from a bad URI.
    const char* why = nullptr;
    CHECK(!parse_mqtt_uri("h:99999", host, port, tls, &why) && std::string(why) == "Invalid port");
    why = nullptr;
    CHECK(!parse_mqtt_uri("mqtts://", host, port, tls, &why) && std::string(why) == "Invalid broker URI");
    // IPv6 literal with port -> parsed with brackets intact (device AF_INET resolve then rejects it).
    CHECK(parse_mqtt_uri("[::1]:1883", host, port, tls) && host == "[::1]" && port == 1883 && !tls);
    // IPv6 literal, no port -> brackets kept, default port (colon is inside the brackets).
    CHECK(parse_mqtt_uri("[fe80::1]", host, port, tls) && host == "[fe80::1]" && port == 1883 && !tls);
}

static void test_heartbeat() {
    const std::string base = "daikin-altherma-esp32", node = "daikin_abc123";
    CHECK(heartbeat_topic(base, node) == "daikin-altherma-esp32/daikin_abc123/heartbeat");

    // wifi_signal_quality_pct: matches the observed EMS-ESP-style dBm->% samples exactly
    // (-76 dBm -> 48%, -78 dBm -> 44%), clamped at the -50/-100 dBm ends.
    CHECK(wifi_signal_quality_pct(-76) == 48);
    CHECK(wifi_signal_quality_pct(-78) == 44);
    CHECK(wifi_signal_quality_pct(-50) == 100 && wifi_signal_quality_pct(-40) == 100);
    CHECK(wifi_signal_quality_pct(-100) == 0 && wifi_signal_quality_pct(-110) == 0);

    // format_uptime: "Ddd+HH:MM:SS.mmm" — 7 days, 21:05:31.860 (a real EMS-ESP heartbeat sample).
    const uint64_t sample_ms = ((7ULL * 24 + 21) * 3600 + 5 * 60 + 31) * 1000 + 860;
    CHECK(format_uptime(sample_ms) == "007+21:05:31.860");
    CHECK(format_uptime(0) == "000+00:00:00.000");

    HeartbeatFields f;
    f.version         = "1.2.3";
    f.platform        = "esp32s3";
    f.uptime_ms       = sample_ms;
    f.free_heap       = 170000;
    f.min_free_heap   = 150000;
    f.max_alloc       = 87000;
    f.reset_reason    = "panic";
    f.wifi_connected  = true;
    f.wifi_rssi       = -76;
    f.wifi_reconnects = 3;
    f.mqtt_connected  = true;
    f.mqtt_count      = 89282;
    f.mqtt_fails      = 0;
    f.mqtt_reconnects = 1;
    f.bus_connected   = true;
    f.bus_proto       = 'I';
    f.registers       = 10;
    f.values          = 48;
    f.crc_err         = 0;
    f.timeout_err     = 2;
    f.rx_received     = 763732;
    f.rx_fails        = 2;
    f.last_ok_s       = 1;
    const std::string j = build_heartbeat_json(f);
    CHECK(j == "{\"version\":\"1.2.3\",\"platform\":\"esp32s3\","
               "\"uptime_s\":680731,\"uptime\":\"007+21:05:31.860\","
               "\"free_heap\":170000,\"min_free_heap\":150000,\"max_alloc\":87000,"
               "\"reset_reason\":\"panic\","
               "\"wifi\":{\"connected\":true,\"rssi\":-76,\"quality_pct\":48,\"reconnects\":3},"
               "\"mqtt\":{\"connected\":true,\"count\":89282,\"fails\":0,\"reconnects\":1},"
               "\"bus\":{\"connected\":true,\"proto\":\"I\",\"registers\":10,\"values\":48,\"last_ok_s\":1,"
               "\"rx\":{\"received\":763732,\"fails\":2,\"crc_err\":0,\"timeout_err\":2},"
               "\"tx\":{\"reads\":763734,\"writes\":0,\"fails\":0}}}");

    // WiFi down -> rssi/quality reported null, not a stale/garbage reading.
    HeartbeatFields down;
    down.wifi_connected = false;
    down.wifi_rssi       = -50;    // stale value must not leak into the JSON
    const std::string dj = build_heartbeat_json(down);
    CHECK(dj.find("\"rssi\":null") != std::string::npos);
    CHECK(dj.find("\"quality_pct\":null") != std::string::npos);

    // Diagnostic discovery: separate topics/component types, entity_category diagnostic, and the
    // value_template points at the heartbeat topic (not the heat-pump state topic).
    const std::string hb = heartbeat_topic(base, node);
    const std::string av = availability_topic(base, node);
    CHECK(HEARTBEAT_SENSOR_COUNT == 16);
    const HeartbeatSensor& rssi = HEARTBEAT_SENSORS[0];
    CHECK(std::string(rssi.object_id) == "wifi_signal");
    std::string dt = heartbeat_discovery_topic("homeassistant", node, rssi);
    CHECK(dt == "homeassistant/sensor/daikin_abc123/wifi_signal/config");
    std::string dc = heartbeat_discovery_config(node, hb, av, rssi);
    CHECK(dc.find("\"stat_t\":\"daikin-altherma-esp32/daikin_abc123/heartbeat\"") != std::string::npos);
    CHECK(dc.find("\"val_tpl\":\"{{ value_json.wifi.rssi }}\"") != std::string::npos);
    CHECK(dc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
    CHECK(dc.find("\"dev_cla\":\"signal_strength\"") != std::string::npos);
    CHECK(dc.find("\"stat_cla\":\"measurement\"") != std::string::npos);

    // The binary_sensor (bus_status) lands under the binary_sensor component, not sensor, and has
    // no stat_cla (not a numeric measurement).
    const HeartbeatSensor* bus = nullptr;
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
        if (std::string(HEARTBEAT_SENSORS[i].object_id) == "bus_status") bus = &HEARTBEAT_SENSORS[i];
    CHECK(bus != nullptr);
    CHECK(heartbeat_discovery_topic("homeassistant", node, *bus)
          == "homeassistant/binary_sensor/daikin_abc123/bus_status/config");
    std::string busc = heartbeat_discovery_config(node, hb, av, *bus);
    CHECK(busc.find("val_tpl\":\"{{ value_json.bus.connected }}") != std::string::npos);
    CHECK(busc.find("\"stat_cla\"") == std::string::npos);

    // A since-boot counter (e.g. mqtt_count) is "total_increasing", not "measurement" — HA's
    // long-term statistics then handle a reboot's reset to 0 correctly instead of reading it as a
    // (nonsensical) huge negative delta.
    const HeartbeatSensor* mc = nullptr;
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
        if (std::string(HEARTBEAT_SENSORS[i].object_id) == "mqtt_count") mc = &HEARTBEAT_SENSORS[i];
    CHECK(mc != nullptr);
    CHECK(heartbeat_discovery_config(node, hb, av, *mc).find("\"stat_cla\":\"total_increasing\"")
          != std::string::npos);

    // The three device-health entities added alongside /status.sys (issue #5): reset_reason is a
    // plain text sensor (no unit / device_class / state_class), min_free_heap + max_alloc are byte
    // measurements. All diagnostic, all sourced from the heartbeat topic. Count is 16, not 13.
    auto find_hb = [](const char* oid) -> const HeartbeatSensor* {
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
            if (std::string(HEARTBEAT_SENSORS[i].object_id) == oid) return &HEARTBEAT_SENSORS[i];
        return nullptr;
    };
    const HeartbeatSensor* rr = find_hb("reset_reason");
    CHECK(rr != nullptr && std::string(rr->name) == "Reset Reason");
    const std::string rrc = heartbeat_discovery_config(node, hb, av, *rr);
    CHECK(rrc.find("\"val_tpl\":\"{{ value_json.reset_reason }}\"") != std::string::npos);
    CHECK(rrc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
    CHECK(rrc.find("\"unit_of_meas\"") == std::string::npos);   // text: no unit
    CHECK(rrc.find("\"dev_cla\"") == std::string::npos);        // ...no device_class
    CHECK(rrc.find("\"stat_cla\"") == std::string::npos);       // ...no state_class

    // Heap low-water mark + largest free block: bytes, "measurement" (a fluctuating gauge, NOT a
    // since-boot counter), diagnostic, sourced from the flat payload fields (not a nested object).
    for (const char* oid : {"min_free_heap", "max_alloc"}) {
        const HeartbeatSensor* h = find_hb(oid);
        CHECK(h != nullptr);
        const std::string hc = heartbeat_discovery_config(node, hb, av, *h);
        CHECK(hc.find(std::string("\"val_tpl\":\"{{ value_json.") + oid + " }}\"") != std::string::npos);
        CHECK(hc.find("\"unit_of_meas\":\"B\"") != std::string::npos);
        CHECK(hc.find("\"stat_cla\":\"measurement\"") != std::string::npos);
        CHECK(hc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
        CHECK(hc.find("\"dev_cla\"") == std::string::npos);   // raw bytes, no device_class
    }
}

static void test_reset_reason() {
    // /status.sys.reset_reason (logic/reset_reason.hpp): a raw esp_reset_reason_t code -> a short,
    // stable slug; anything unknown/newer -> "unknown" rather than a wrong cause.
    CHECK(std::string(reset_reason_name(1)) == "poweron");
    CHECK(std::string(reset_reason_name(3)) == "sw");
    CHECK(std::string(reset_reason_name(4)) == "panic");
    CHECK(std::string(reset_reason_name(6)) == "task_wdt");
    CHECK(std::string(reset_reason_name(9)) == "brownout");
    CHECK(std::string(reset_reason_name(0)) == "unknown");
    CHECK(std::string(reset_reason_name(999)) == "unknown");

    // Parity guard: reset_reason_name and crash_reason_slug are ONE vocabulary (the sys block, the
    // crash HA entity and the heartbeat must never disagree on how a reset is named). If a future edit
    // splits them into two tables, this fails for the first code that diverges.
    for (int code = -1; code <= 20; code++)
        CHECK(std::string(reset_reason_name(code)) ==
              std::string(crash_reason_slug(static_cast<uint32_t>(code))));
}

static void test_boot_guard() {
    // Threshold rule (issue #6): safe mode on the Nth crash boot, no off-by-one (the counter is bumped
    // BEFORE the check, so with threshold 4 the 4th crash makes fail_count == threshold).
    CHECK(!boot_should_enter_safe_mode(0, 4));
    CHECK(!boot_should_enter_safe_mode(3, 4));
    CHECK(boot_should_enter_safe_mode(4, 4));
    CHECK(boot_should_enter_safe_mode(5, 4));
    CHECK(boot_should_enter_safe_mode(BOOT_FAIL_THRESHOLD));       // default threshold
    CHECK(!boot_should_enter_safe_mode(BOOT_FAIL_THRESHOLD - 1));

    // Saturating increment; a corrupt (negative or absurdly large) / first-run read starts from 0.
    CHECK(boot_next_fail_count(0) == 1);
    CHECK(boot_next_fail_count(3) == 4);
    CHECK(boot_next_fail_count(-1) == 1);
    CHECK(boot_next_fail_count(-999999) == 1);
    // A value ABOVE the cap is never written, so reading one means corruption -> treated as 0 -> 1.
    CHECK(boot_next_fail_count(BOOT_FAIL_MAX + 500) == 1);
    CHECK(boot_next_fail_count(BOOT_FAIL_MAX) == BOOT_FAIL_MAX);          // saturates at the cap
    CHECK(boot_next_fail_count(BOOT_FAIL_MAX - 1) == BOOT_FAIL_MAX);

    // A crash-loop from a clean start reaches safe mode EXACTLY on the 4th crash boot, not before.
    int c = 0;
    for (int i = 0; i < BOOT_FAIL_THRESHOLD - 1; i++) {
        c = boot_next_fail_count(c);
        CHECK(!boot_should_enter_safe_mode(c));
    }
    c = boot_next_fail_count(c);
    CHECK(c == BOOT_FAIL_THRESHOLD && boot_should_enter_safe_mode(c));

    // Crash classification: ONLY panic / int-wdt / task-wdt / other-wdt / brownout accumulate.
    CHECK(boot_reset_was_crash(4));    // panic
    CHECK(boot_reset_was_crash(5));    // int_wdt
    CHECK(boot_reset_was_crash(6));    // task_wdt
    CHECK(boot_reset_was_crash(7));    // other_wdt
    CHECK(boot_reset_was_crash(9));    // brownout
    // Clean / intentional / non-config faults do NOT — a provisioning burst is reset reason "sw" (3),
    // and power-glitch (14) / CPU-lockup (15) are hardware faults a config change can't fix, so unlike
    // crash_reason_is_fault() this set deliberately excludes them.
    CHECK(!boot_reset_was_crash(1));   // poweron
    CHECK(!boot_reset_was_crash(2));   // ext
    CHECK(!boot_reset_was_crash(3));   // sw (config-save / OTA reboot)
    CHECK(!boot_reset_was_crash(8));   // deepsleep
    CHECK(!boot_reset_was_crash(14));  // pwr_glitch
    CHECK(!boot_reset_was_crash(15));  // cpu_lockup
    CHECK(!boot_reset_was_crash(0));   // unknown
    // Consistency with the shared reset vocabulary: the crash codes boot_guard counts are a SUBSET of
    // crashinfo's fault set (both agree these five are faults), guarding against the enum drifting apart.
    for (int code : {4, 5, 6, 7, 9}) CHECK(boot_reset_was_crash(code) && crash_reason_is_fault(code));
}

static void test_health_gate() {
    // base=90s, cap=300s. STA-configured device.
    const int base = 90, cap = 300;
    // Not yet at the base window -> keep waiting even if already online.
    CHECK(health_gate_decide(0,   base, cap, /*cfg=*/true, /*conn=*/true)  == HealthVerdict::Wait);
    CHECK(health_gate_decide(85,  base, cap, true,  true)  == HealthVerdict::Wait);
    // Past the base window AND online -> commit (seal image in, cancel rollback).
    CHECK(health_gate_decide(90,  base, cap, true,  true)  == HealthVerdict::Commit);
    CHECK(health_gate_decide(120, base, cap, true,  true)  == HealthVerdict::Commit);
    // Configured but never online -> wait until the hard cap, then give up (leave rollback armed).
    CHECK(health_gate_decide(90,  base, cap, true,  false) == HealthVerdict::Wait);
    CHECK(health_gate_decide(295, base, cap, true,  false) == HealthVerdict::Wait);
    CHECK(health_gate_decide(300, base, cap, true,  false) == HealthVerdict::GiveUp);
    // No credentials = legitimate setup-AP mode: connectivity isn't expected, so it's healthy.
    CHECK(health_gate_decide(90,  base, cap, false, false) == HealthVerdict::Commit);
    CHECK(health_gate_decide(0,   base, cap, false, false) == HealthVerdict::Wait);   // still honour base window
}

static void test_board_pins() {
    auto has = [](BoardPins b, int p) {
        for (int i = 0; i < b.count; i++) if (b.pins[i] == p) return true;
        return false;
    };
    // Conservative (octal_spi=true, the default): chip-safe minus SPI flash, Octal PSRAM/flash,
    // strapping, USB-JTAG and dedicated JTAG. GPIO43/44 (the X10A Kconfig defaults) stay present.
    BoardPins s3 = board_pins("esp32s3");
    CHECK(s3.count == 23);
    CHECK(has(s3, 43) && has(s3, 44));
    CHECK(!has(s3, 33) && !has(s3, 34) && !has(s3, 35) && !has(s3, 36) && !has(s3, 37));  // Octal SPI
    CHECK(!has(s3, 0) && !has(s3, 3) && !has(s3, 45) && !has(s3, 46));                    // strapping
    CHECK(!has(s3, 19) && !has(s3, 20));                                                  // USB-JTAG
    CHECK(!has(s3, 26) && !has(s3, 32));                                                  // SPI flash
    CHECK(!has(s3, 39) && !has(s3, 42));                                                  // dedicated JTAG
    // Permissive (octal_spi=false): a Quad/no-PSRAM build frees GPIO33-37 too.
    BoardPins s3_quad = board_pins("esp32s3", false);
    CHECK(s3_quad.count == 28);
    CHECK(has(s3_quad, 33) && has(s3_quad, 34) && has(s3_quad, 35) && has(s3_quad, 36) && has(s3_quad, 37));
    // Non-empty and strictly ascending (⇒ sorted + de-duped) within GPIO range, for both variants.
    for (BoardPins b : {s3, s3_quad}) {
        CHECK(b.count > 0);
        for (int i = 0; i < b.count; i++) CHECK(gpio_in_range(b.pins[i]));
        for (int i = 1; i < b.count; i++) CHECK(b.pins[i] > b.pins[i - 1]);
    }
    // Unknown / null target falls back to the same (default-arg) conservative list.
    CHECK(board_pins("nope").count == s3.count);
    CHECK(board_pins(nullptr).count == s3.count);
    // BOARD_PINS_MAX really does bound both lists (it sizes the caller's buffer in http_status.cpp).
    CHECK(s3.count <= BOARD_PINS_MAX && s3_quad.count <= BOARD_PINS_MAX);

    // board_pins_offerable(): drops the pin the firmware itself drives (the status LED, GPIO21 by
    // default) — offering it would be a pick that cannot work, since the LED holds it as an output.
    int buf[BOARD_PINS_MAX];
    int n = board_pins_offerable(buf, BOARD_PINS_MAX, /*octal_spi=*/false, /*reserved=*/21);
    CHECK(n == s3_quad.count - 1);
    for (int i = 0; i < n; i++) CHECK(buf[i] != 21);
    for (int i = 1; i < n; i++) CHECK(buf[i] > buf[i - 1]);          // still strictly ascending
    // reserved = -1 (LED disabled) keeps every chip-safe pin, GPIO21 included.
    n = board_pins_offerable(buf, BOARD_PINS_MAX, /*octal_spi=*/false, /*reserved=*/-1);
    CHECK(n == s3_quad.count);
    CHECK(has({buf, n}, 21));
    // A reserved pin that isn't in the list at all (e.g. GPIO0) drops nothing.
    n = board_pins_offerable(buf, BOARD_PINS_MAX, /*octal_spi=*/true, /*reserved=*/0);
    CHECK(n == s3.count);
    // Honours the buffer cap instead of overrunning it.
    n = board_pins_offerable(buf, 3, /*octal_spi=*/false, /*reserved=*/-1);
    CHECK(n == 3);
}

static void test_crashinfo() {
    const std::string base = "daikin-altherma-esp32", node = "daikin_abc123";

    // Reason slug + fault classification: a software reboot (config save / OTA) and a clean power-on
    // are NORMAL; a panic / watchdog / brown-out / CPU lockup is a fault.
    CHECK(std::string(crash_reason_slug(1)) == "poweron");
    CHECK(std::string(crash_reason_slug(3)) == "sw");
    CHECK(std::string(crash_reason_slug(4)) == "panic");
    CHECK(std::string(crash_reason_slug(6)) == "task_wdt");
    CHECK(std::string(crash_reason_slug(9)) == "brownout");
    CHECK(std::string(crash_reason_slug(15)) == "cpu_lockup");
    CHECK(std::string(crash_reason_slug(999)) == "unknown");
    CHECK(!crash_reason_is_fault(1) && !crash_reason_is_fault(3) && !crash_reason_is_fault(2));
    CHECK(crash_reason_is_fault(4) && crash_reason_is_fault(5) && crash_reason_is_fault(6));
    CHECK(crash_reason_is_fault(9) && crash_reason_is_fault(14) && crash_reason_is_fault(15));

    // Clean boot: reason reported, but not notable (no banner) and no summary fields.
    CrashInfo clean;
    clean.reason = 3;   // ESP_RST_SW
    CHECK(!crash_is_notable(clean));
    CHECK(build_crash_json(clean) == "{\"reason\":\"sw\",\"reason_code\":3,\"fault\":false,\"coredump\":false}");

    // An orphan core-dump with no fault reason is still notable (a dump is waiting to be pulled).
    CrashInfo orphan;
    orphan.reason = 1;   // poweron
    orphan.coredump = true;
    CHECK(crash_is_notable(orphan));

    // A USB re-plug (ESP32-S3 native USB resets the chip on re-enumeration) is NOT a fault, so with
    // no dump in flash it must not raise the banner. The device reports `coredump` from a LIVE flash
    // read (diag_crash_info_live), not the boot-time cache: a dump erased via /coredump?clear=1 while
    // the device runs used to leave this true forever, which pinned an uncleanable "crash" banner on
    // a device that never crashed and a "Download crash report" button that 404s.
    CrashInfo usb_replug;
    usb_replug.reason   = 11;      // ESP_RST_USB
    usb_replug.coredump = false;   // image gone from flash — nothing to offer
    CHECK(std::string(crash_reason_slug(11)) == "usb");
    CHECK(!crash_reason_is_fault(11));
    CHECK(!crash_is_notable(usb_replug));
    CHECK(build_crash_json(usb_replug) ==
          "{\"reason\":\"usb\",\"reason_code\":11,\"fault\":false,\"coredump\":false}");

    // ...but clearing the dump must NOT erase the memory of a real crash: a fault reset stays
    // notable (banner + reason), it just loses the download link.
    CrashInfo fault_cleared;
    fault_cleared.reason   = 6;       // ESP_RST_TASK_WDT
    fault_cleared.coredump = false;
    CHECK(crash_is_notable(fault_cleared));

    // Panic with a parsed summary: exact JSON + text, backtrace as raw PC hex.
    CrashInfo panic;
    panic.reason       = 4;   // ESP_RST_PANIC
    panic.coredump     = true;
    panic.have_summary = true;
    std::snprintf(panic.task, sizeof(panic.task), "%s", "mqtt_pub");
    panic.pc           = 0x400d1234;
    panic.bt[0]        = 0x400d1234;
    panic.bt[1]        = 0x400d5678;
    panic.bt_depth     = 2;
    panic.bt_corrupted = false;
    std::snprintf(panic.elf_sha, sizeof(panic.elf_sha), "%s", "abc123");
    CHECK(crash_is_notable(panic));
    CHECK(build_crash_json(panic) ==
          "{\"reason\":\"panic\",\"reason_code\":4,\"fault\":true,\"coredump\":true,"
          "\"task\":\"mqtt_pub\",\"pc\":\"0x400d1234\","
          "\"backtrace\":[\"0x400d1234\",\"0x400d5678\"],\"corrupted\":false,\"elf_sha256\":\"abc123\"}");
    CHECK(build_crash_text(panic) ==
          "reset=panic  coredump=yes\ntask=mqtt_pub  pc=0x400d1234\n"
          "backtrace: 0x400d1234 0x400d5678\nelf_sha256=abc123");

    // bt_depth is clamped to the 16-entry buffer (a corrupt summary can over-report it).
    CrashInfo over = panic;
    over.bt_depth = 99;
    const std::string oj = build_crash_json(over);
    CHECK(oj.find("0x00000000") != std::string::npos);   // zero-filled tail entries, not OOB reads
    size_t cnt = 0, at = 0;
    while ((at = oj.find("0x", at)) != std::string::npos) { cnt++; at += 2; }
    CHECK(cnt == 1 /*pc*/ + 16 /*bt[16]*/);

    // Crash topic + the two diagnostic HA entities (reason sensor + coredump "problem" binary_sensor).
    CHECK(crash_topic(base, node) == "daikin-altherma-esp32/daikin_abc123/crash");
    const std::string ct = crash_topic(base, node);
    const std::string av = availability_topic(base, node);
    CHECK(CRASH_SENSOR_COUNT == 2);

    const CrashSensor& reason = CRASH_SENSORS[0];
    CHECK(std::string(reason.object_id) == "last_reset");
    CHECK(crash_discovery_topic("homeassistant", node, reason)
          == "homeassistant/sensor/daikin_abc123/last_reset/config");
    const std::string rc = crash_discovery_config(node, ct, av, reason);
    CHECK(rc.find("\"stat_t\":\"daikin-altherma-esp32/daikin_abc123/crash\"") != std::string::npos);
    CHECK(rc.find("\"val_tpl\":\"{{ value_json.reason }}\"") != std::string::npos);
    CHECK(rc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
    CHECK(rc.find("\"dev_cla\"") == std::string::npos);
    CHECK(rc.find("pl_on") == std::string::npos);

    const CrashSensor& dump = CRASH_SENSORS[1];
    CHECK(std::string(dump.component) == "binary_sensor");
    CHECK(crash_discovery_topic("homeassistant", node, dump)
          == "homeassistant/binary_sensor/daikin_abc123/coredump/config");
    const std::string dc = crash_discovery_config(node, ct, av, dump);
    CHECK(dc.find("\"val_tpl\":\"{{ value_json.coredump | lower }}\"") != std::string::npos);
    CHECK(dc.find("\"pl_on\":\"true\",\"pl_off\":\"false\"") != std::string::npos);
    CHECK(dc.find("\"dev_cla\":\"problem\"") != std::string::npos);
    CHECK(dc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
}

static void test_modbus() {
    // ── Big-endian helpers + 1-based offset -> 0-based PDU address (EKRHH guide §9.2) ──
    uint8_t w[2];
    mb_put_u16(w, 0x1234);
    CHECK(w[0] == 0x12 && w[1] == 0x34);            // Modbus is big-endian on the wire
    CHECK(mb_get_u16(w) == 0x1234);
    uint16_t addr = 0xFFFF;
    CHECK(mb_pdu_address(1, addr) && addr == 0);    // offset 1 -> PDU address 0
    CHECK(mb_pdu_address(40, addr) && addr == 39);  // input reg 40 (LWT PHE) -> 39
    CHECK(!mb_pdu_address(0, addr));                // offset 0 is invalid

    // ── FC03 read-holding request framing: MBAP[txn,proto=0,len,unit] + [fc,addr,qty] = 12 bytes ──
    uint8_t buf[64];
    int n = mb_build_read(buf, sizeof(buf), 0x0007, 1, MbFunc::ReadHolding, /*addr*/55, /*qty*/1);
    CHECK(n == 12);
    CHECK(mb_get_u16(buf + 0) == 0x0007);           // transaction id
    CHECK(mb_get_u16(buf + 2) == 0x0000);           // protocol id (always 0 for Modbus)
    CHECK(mb_get_u16(buf + 4) == 6);                // length = unit(1) + PDU(5)
    CHECK(buf[6] == 1);                             // unit id
    CHECK(buf[7] == 0x03);                          // function code FC03
    CHECK(mb_get_u16(buf + 8) == 55 && mb_get_u16(buf + 10) == 1);
    // FC04 read-input uses the same shape with a different function code.
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadInput, 40, 6) == 12 && buf[7] == 0x04);
    // Guards: a write FC, qty 0, and an undersized buffer are all rejected.
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::WriteSingle, 1, 1) == -1);
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadHolding, 1, 0) == -1);
    CHECK(mb_build_read(buf, 8, 1, 1, MbFunc::ReadHolding, 1, 1) == -1);
    // A read response states its size in ONE byte, so qty tops out at 125 (§6.3): 125 builds, 126 is
    // refused rather than sent to earn an "illegal data value" exception.
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadHolding, 1, MB_MAX_READ_REGS) == 12);
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadHolding, 1, MB_MAX_READ_REGS + 1) == -1);
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadInput, 1, 1000) == -1);

    // ── FC06 write-single request framing ──
    n = mb_build_write_single(buf, sizeof(buf), 0x0042, 1, /*addr*/55, /*value*/2000);
    CHECK(n == 12 && buf[7] == 0x06);
    CHECK(mb_get_u16(buf + 0) == 0x0042 && mb_get_u16(buf + 8) == 55 && mb_get_u16(buf + 10) == 2000);

    // ── FC16 write-multiple request framing: 2 registers -> bytecount 4, ADU 17 bytes ──
    // MBAP(7) + PDU[fc(1),addr(2),qty(2),bytecount(1),data(4)] = 7 + 10 = 17.
    const uint16_t vals[] = {0x00C8, 0xFB2E};
    n = mb_build_write_multiple(buf, sizeof(buf), 0x0001, 1, /*addr*/56, vals, 2);
    CHECK(n == 17);
    CHECK(mb_get_u16(buf + 4) == 11);               // length = unit(1) + PDU(10)
    CHECK(buf[7] == 0x10 && mb_get_u16(buf + 8) == 56 && mb_get_u16(buf + 10) == 2);
    CHECK(buf[12] == 4);                            // byte count = 2 * qty
    CHECK(mb_get_u16(buf + 13) == 0x00C8 && mb_get_u16(buf + 15) == 0xFB2E);
    CHECK(mb_build_write_multiple(buf, sizeof(buf), 1, 1, 1, vals, 0) == -1);   // qty 0 rejected
    CHECK(mb_build_write_multiple(buf, 12, 1, 1, 1, vals, 2) == -1);            // buffer too small
    // FC16 states its payload size in ONE byte, so qty tops out at 123 (§6.12). Past that the count
    // would narrow to a lie — qty 128 once framed a 256-byte payload as "0" — so the builder refuses.
    // 123 still builds, and its byte-count field must equal 2*qty (the invariant truncation broke).
    uint8_t big[300];
    uint16_t many[130] = {0};
    n = mb_build_write_multiple(big, sizeof(big), 1, 1, 1, many, MB_MAX_WRITE_REGS);
    CHECK(n == 7 + 6 + 2 * MB_MAX_WRITE_REGS);
    CHECK(big[12] == 2 * MB_MAX_WRITE_REGS && mb_get_u16(big + 10) == MB_MAX_WRITE_REGS);
    CHECK(mb_build_write_multiple(big, sizeof(big), 1, 1, 1, many, MB_MAX_WRITE_REGS + 1) == -1);
    CHECK(mb_build_write_multiple(big, sizeof(big), 1, 1, 1, many, 128) == -1);

    // ── Parse a well-formed FC03 read response: 3 registers ──
    MbResponse r;
    // MBAP(txn=7,proto=0,len=9,unit=1) + PDU[fc=03, bytecount=6, d0..d5]
    uint8_t resp[] = {0x00,0x07, 0x00,0x00, 0x00,0x09, 0x01,
                      0x03, 0x06, 0x07,0xD0, 0xFB,0x2E, 0x7F,0xFE};
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, r) == MbParse::Ok);
    CHECK(r.ok && !r.exception && r.txn == 7 && r.unit == 1 && r.fc == 0x03);
    CHECK(mb_reg_count(r) == 3);
    uint16_t rv = 0;
    CHECK(mb_reg_at(r, 0, rv) && rv == 0x07D0);     // 2000
    CHECK(mb_reg_at(r, 1, rv) && rv == 0xFB2E);     // -1234
    CHECK(mb_reg_at(r, 2, rv) && rv == 0x7FFE);     // 32766 (unavailable sentinel)
    CHECK(!mb_reg_at(r, 3, rv));                    // out-of-range index rejected

    // ── Parse a write-single echo (FC06) ──
    uint8_t wecho[] = {0x00,0x42, 0x00,0x00, 0x00,0x06, 0x01, 0x06, 0x00,0x37, 0x07,0xD0};
    CHECK(mb_parse_response(wecho, sizeof(wecho), 0x42, 1, MbFunc::WriteSingle, r) == MbParse::Ok);
    CHECK(r.ok && r.fc == 0x06);
    // A write echo is exactly [fc, addr(2), value|qty(2)]; a truncated one is Malformed, not Ok.
    uint8_t wshort[] = {0x00,0x42, 0x00,0x00, 0x00,0x04, 0x01, 0x06, 0x00,0x37};
    CHECK(mb_parse_response(wshort, sizeof(wshort), 0x42, 1, MbFunc::WriteSingle, r) == MbParse::Malformed);
    CHECK(!r.ok);

    // ── Parse a Modbus exception response (FC03 | 0x80, code 0x02 = illegal data address) ──
    uint8_t exc[] = {0x00,0x07, 0x00,0x00, 0x00,0x03, 0x01, 0x83, 0x02};
    CHECK(mb_parse_response(exc, sizeof(exc), 7, 1, MbFunc::ReadHolding, r) == MbParse::Exception);
    CHECK(!r.ok && r.exception && r.exc_code == 0x02 && r.fc == 0x03);

    // ── Parse-error paths ──
    CHECK(mb_parse_response(resp, 5, 7, 1, MbFunc::ReadHolding, r) == MbParse::TooShort);
    uint8_t badproto[] = {0x00,0x07, 0x00,0x01, 0x00,0x03, 0x01, 0x03, 0x00};  // proto id != 0
    CHECK(mb_parse_response(badproto, sizeof(badproto), 7, 1, MbFunc::ReadHolding, r) == MbParse::BadProtocol);
    uint8_t badlen[] = {0x00,0x07, 0x00,0x00, 0x00,0x09, 0x01, 0x03, 0x00};    // len 9 != actual
    CHECK(mb_parse_response(badlen, sizeof(badlen), 7, 1, MbFunc::ReadHolding, r) == MbParse::BadLength);
    CHECK(mb_parse_response(resp, sizeof(resp), 8, 1, MbFunc::ReadHolding, r) == MbParse::TxnMismatch);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 2, MbFunc::ReadHolding, r) == MbParse::UnitMismatch);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadInput, r) == MbParse::FcMismatch);
    // Consistent MBAP length (6 = unit + 5-byte PDU) but an odd register byte count (3) -> Malformed.
    uint8_t oddbc[] = {0x00,0x07, 0x00,0x00, 0x00,0x06, 0x01, 0x03, 0x03, 0x01,0x02,0x03};
    CHECK(mb_parse_response(oddbc, sizeof(oddbc), 7, 1, MbFunc::ReadHolding, r) == MbParse::Malformed);

    // ── Value codecs: decode (EKRHH guide §9.2 data formats) ──
    CHECK(approx(mb_decode(MbType::Temp16, 0x07D0).value, 20.0));     // 2000 /100
    CHECK(mb_decode(MbType::Temp16, 0x07D0).ok);
    CHECK(approx(mb_decode(MbType::Temp16, 0xFB2E).value, -12.34));   // -1234 /100 (two's complement)
    CHECK(approx(mb_decode(MbType::Pow16, 0x01C2).value, 4.5));       // 450 /100 kW
    CHECK(approx(mb_decode(MbType::Int16, 0xFFFF).value, -1.0));      // signed, as-is
    CHECK(approx(mb_decode(MbType::Int16, 0x0002).value, 2.0));       // op-mode "Cooling"
    // Text16: the unit error-code example from the guide — 0x5538 -> "U8".
    MbValue tx = mb_decode(MbType::Text16, 0x5538);
    CHECK(tx.ok && std::string(tx.text) == "U8");

    // ── Special-value guard: 32765/66/67 are "no value", boundaries are real ──
    CHECK(mb_is_special(32765) && mb_is_special(32766) && mb_is_special(32767));
    CHECK(!mb_is_special(32764) && !mb_is_special(0x8000));          // 0x8000 = -32768, a real reading
    CHECK(mb_decode(MbType::Int16, 32767).special && !mb_decode(MbType::Int16, 32767).ok);
    CHECK(mb_decode(MbType::Temp16, 32766).special);
    CHECK(mb_decode(MbType::Int16, 32764).ok && !mb_decode(MbType::Int16, 32764).special);

    // ── Encode (inverse), incl. explicit values and round-trips ──
    uint16_t e = 0;
    CHECK(mb_encode(MbType::Temp16, 20.0, e) && e == 0x07D0);
    CHECK(mb_encode(MbType::Temp16, -12.34, e) && e == 0xFB2E);
    CHECK(mb_encode(MbType::Pow16, 4.5, e) && e == 0x01C2);         // write kW: ×100
    CHECK(mb_encode(MbType::Int16, -1.0, e) && e == 0xFFFF);
    CHECK(mb_encode(MbType::Int16, 2.0, e) && e == 0x0002);
    CHECK(mb_encode_text16('U', '8') == 0x5538);
    // encode(decode(x)) == x for every non-special raw across the numeric types.
    for (uint16_t raw : {uint16_t(0x0000), uint16_t(0x0001), uint16_t(0x07D0), uint16_t(0xFB2E),
                         uint16_t(0x1234), uint16_t(0x7FFC), uint16_t(0x8000), uint16_t(0xFFFF)}) {
        for (MbType t : {MbType::Int16, MbType::Temp16, MbType::Pow16}) {
            MbValue d = mb_decode(t, raw);
            uint16_t back = 0;
            CHECK(d.ok && mb_encode(t, d.value, back) && back == raw);
        }
    }
    CHECK(mb_encode_text16(mb_decode(MbType::Text16, 0x5538).text[0],
                           mb_decode(MbType::Text16, 0x5538).text[1]) == 0x5538);

    // ── Encode rejects anything that would not round-trip, instead of wrapping silently ──
    // Out of int16 range: 400 °C once encoded to 0x9C40, which reads back as -255.36 °C.
    uint16_t untouched = 0xABCD;
    CHECK(!mb_encode(MbType::Temp16, 400.0, untouched) && untouched == 0xABCD);  // out param preserved
    CHECK(!mb_encode(MbType::Temp16, -400.0, untouched));
    CHECK(!mb_encode(MbType::Pow16, -500.0, untouched));                         // once gave +155.36 kW
    CHECK(!mb_encode(MbType::Int16, 40000.0, untouched));
    CHECK(!mb_encode(MbType::Int16, -40000.0, untouched));
    // Boundaries: the extremes of int16 still encode, one step beyond does not.
    CHECK(mb_encode(MbType::Temp16, -327.68, e) && e == 0x8000);
    CHECK(mb_encode(MbType::Int16, -32768.0, e) && e == 0x8000);
    CHECK(!mb_encode(MbType::Int16, -32769.0, untouched));
    CHECK(mb_encode(MbType::Int16, 32764.0, e) && e == 0x7FFC);
    // Encoding a sentinel is refused — we must never write a value decode reports as "no value".
    CHECK(!mb_encode(MbType::Int16, 32765.0, untouched));
    CHECK(!mb_encode(MbType::Int16, 32766.0, untouched));
    CHECK(!mb_encode(MbType::Int16, 32767.0, untouched));
    CHECK(!mb_encode(MbType::Temp16, 327.67, untouched));           // scales onto MB_UNSUPPORTED
    // Text16 is two packed chars, not a number -> rejected; mb_encode_text16 is the way.
    CHECK(!mb_encode(MbType::Text16, 1.0, untouched));
    // Non-finite input has no defined rounding -> rejected rather than fed to lround.
    CHECK(!mb_encode(MbType::Temp16, std::nan(""), untouched));
    CHECK(!mb_encode(MbType::Temp16, HUGE_VAL, untouched));
    CHECK(!mb_encode(MbType::Temp16, -HUGE_VAL, untouched));

    // ── mDNS HomeHub hostname filter: keep real HomeHubs, drop our own advert / unrelated hosts ──
    CHECK(is_homehub_hostname("homehub-524288-123456"));            // EKRHH guide §13.1.2 form
    CHECK(is_homehub_hostname("homehub-524288-1.local"));
    CHECK(is_homehub_hostname("HomeHub-524288-1"));                 // case-insensitive
    CHECK(!is_homehub_hostname("daikin-altherma-esp32"));           // THIS firmware's own advert
    CHECK(!is_homehub_hostname("home"));                            // shorter than the prefix
    CHECK(!is_homehub_hostname(""));
    CHECK(!is_homehub_hostname(nullptr));
    const char* names[] = {"daikin-altherma-esp32.local", "some-printer", "homehub-524288-9.local"};
    CHECK(mb_first_homehub(names, 3) == 2);
    const char* none[] = {"daikin-altherma-esp32", "nas"};
    CHECK(mb_first_homehub(none, 2) == -1);
}

// The syslog replay records (logic/bootlog.hpp): the build-identity boot line + the crash rendered as
// datagram-sized single-line records. syslog.cpp sends these once, after DNS resolves.
static void test_bootlog() {
    // ── Build identity: emitted on EVERY boot, clean or not — it is what ties a log stream to a binary.
    BootIdent id;
    id.version = "1.4.2";
    id.elf_sha = "deadbeef";
    id.reason  = 1;   // poweron
    CHECK(build_boot_line(id) == "boot: version=1.4.2 elf_sha256=deadbeef reset=poweron safe_mode=no");

    // Safe mode is visible in the log stream: it explains a device that is up but publishes nothing.
    BootIdent safe = id;
    safe.reason    = 6;   // task_wdt
    safe.safe_mode = true;
    CHECK(build_boot_line(safe) == "boot: version=1.4.2 elf_sha256=deadbeef reset=task_wdt safe_mode=yes");

    // Missing identity degrades to "?" — never a dangling "version= elf_sha256=".
    BootIdent blank;
    CHECK(build_boot_line(blank) == "boot: version=? elf_sha256=? reset=unknown safe_mode=no");
    BootIdent nulls;
    nulls.version = nullptr;
    nulls.elf_sha = nullptr;
    CHECK(build_boot_line(nulls) == "boot: version=? elf_sha256=? reset=unknown safe_mode=no");

    std::string lines[CRASH_LOG_LINE_MAX];

    // A clean boot produces NO crash records — the notability rule lives in the pure function, so the
    // device caller cannot spam the collector with "crash:" lines after every config-save reboot.
    CrashInfo clean;
    clean.reason = 3;   // sw
    CHECK(build_crash_log_lines(clean, lines, CRASH_LOG_LINE_MAX) == 0);

    // Orphan dump, no parsable summary: the header line alone (nothing to say about task/pc/bt).
    CrashInfo orphan;
    orphan.reason   = 1;   // poweron
    orphan.coredump = true;
    CHECK(build_crash_log_lines(orphan, lines, CRASH_LOG_LINE_MAX) == 1);
    CHECK(lines[0] == "crash: reset=poweron fault=no coredump=yes");

    // Fault with no dump (dump partition full / erased): still notable, still one header line.
    CrashInfo nodump;
    nodump.reason = 6;   // task_wdt
    CHECK(build_crash_log_lines(nodump, lines, CRASH_LOG_LINE_MAX) == 1);
    CHECK(lines[0] == "crash: reset=task_wdt fault=yes coredump=no");

    // Full panic summary → all three records, each self-contained and greppable as "crash".
    CrashInfo panic;
    panic.reason       = 4;   // ESP_RST_PANIC
    panic.coredump     = true;
    panic.have_summary = true;
    std::snprintf(panic.task, sizeof(panic.task), "%s", "mqtt_pub");
    panic.pc           = 0x400d1234;
    panic.bt[0]        = 0x400d1234;
    panic.bt[1]        = 0x400d5678;
    panic.bt_depth     = 2;
    std::snprintf(panic.elf_sha, sizeof(panic.elf_sha), "%s", "abc123");
    CHECK(build_crash_log_lines(panic, lines, CRASH_LOG_LINE_MAX) == 3);
    CHECK(lines[0] == "crash: reset=panic fault=yes coredump=yes");
    CHECK(lines[1] == "crash: task=mqtt_pub pc=0x400d1234 elf_sha256=abc123");
    CHECK(lines[2] == "crash: backtrace=0x400d1234 0x400d5678");

    // An unreliable unwind is flagged inline rather than silently passing off a bogus backtrace.
    CrashInfo corrupt = panic;
    corrupt.bt_corrupted = true;
    CHECK(build_crash_log_lines(corrupt, lines, CRASH_LOG_LINE_MAX) == 3);
    CHECK(corrupt.bt_corrupted && lines[1] == "crash: task=mqtt_pub pc=0x400d1234 corrupted=yes elf_sha256=abc123");

    // A summary with an empty backtrace drops the bt record (no "backtrace=" with nothing after it).
    CrashInfo nobt = panic;
    nobt.bt_depth = 0;
    CHECK(build_crash_log_lines(nobt, lines, CRASH_LOG_LINE_MAX) == 2);

    // bt_depth is clamped to the 16-entry buffer — a corrupt summary can over-report it (OOB read).
    CrashInfo over = panic;
    over.bt_depth = 99;
    CHECK(build_crash_log_lines(over, lines, CRASH_LOG_LINE_MAX) == 3);
    size_t cnt = 0, at = 0;
    while ((at = lines[2].find("0x", at)) != std::string::npos) { cnt++; at += 2; }
    CHECK(cnt == 16);

    // A caller with a smaller array gets a truncated set, never an overrun.
    std::string one[1];
    CHECK(build_crash_log_lines(panic, one, 1) == 1);
    CHECK(one[0] == "crash: reset=panic fault=yes coredump=yes");
    CHECK(build_crash_log_lines(panic, lines, 0) == 0);
    CHECK(build_crash_log_lines(panic, nullptr, CRASH_LOG_LINE_MAX) == 0);

    // ── The reason these records exist: EVERY line must survive a worst-case crash whole. ──
    // build_crash_text() at this input is ~340 bytes — past diag_printf's 256-byte line buffer and
    // past the 256-byte syslog queue slot, so it truncates through the backtrace and loses
    // elf_sha256 entirely. Each record here must stay under one datagram's worth. The budget is the
    // 256-byte syslog.cpp SyslogMsg slot minus the ~38-byte RFC 5424 header it is framed with.
    const size_t CRASH_LOG_LINE_BUDGET = 200;
    CrashInfo worst;
    worst.reason       = 6;
    worst.coredump     = true;
    worst.have_summary = true;
    worst.bt_corrupted = true;
    std::snprintf(worst.task, sizeof(worst.task), "%s", "123456789012345");   // fills task[16]
    worst.pc = 0xffffffff;
    for (int i = 0; i < 16; i++) worst.bt[i] = 0xffffffff;
    worst.bt_depth = 16;
    for (int i = 0; i < 64; i++) worst.elf_sha[i] = 'f';                      // fills elf_sha[65]
    const int wn = build_crash_log_lines(worst, lines, CRASH_LOG_LINE_MAX);
    CHECK(wn == 3);
    for (int i = 0; i < wn; i++) CHECK(lines[i].size() <= CRASH_LOG_LINE_BUDGET);
    CHECK(build_crash_text(worst).size() > 256);   // the multi-line block that would NOT have fitted
    // The two facts truncation used to eat are present, in full, in a record that fits.
    CHECK(lines[1].find("elf_sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
          != std::string::npos);
    CHECK(lines[2].find("0xffffffff 0xffffffff") != std::string::npos);

    // Nothing carries the "syslog:" tag: syslog_send() drops any line containing it (its self-loop
    // guard), so a record that ever picked up that substring would be silently unsendable.
    for (int i = 0; i < wn; i++) CHECK(lines[i].find("syslog:") == std::string::npos);
    CHECK(build_boot_line(id).find("syslog:") == std::string::npos);
}

// ── syslog send-failure policy (logic/syslog_policy.hpp) ─────────────────────────────────────
static void test_syslog_policy() {
    // HARD: the route or the destination is implicated, so an immediate re-resolve + re-probe is
    // worth its cost.
    CHECK(syslog_error_is_hard(ENETUNREACH));
    CHECK(syslog_error_is_hard(EHOSTUNREACH));
    CHECK(syslog_error_is_hard(ENETDOWN));
    CHECK(syslog_error_is_hard(EHOSTDOWN));
    CHECK(syslog_error_is_hard(EADDRNOTAVAIL));

    // TRANSIENT: the stack momentarily couldn't take the datagram. THE regression this guards —
    // ENOMEM is what a ghosted link returns for every send, and treating it as hard made each
    // failed diag line force a getaddrinfo() + a 3x1s ICMP probe. At an X10A timeout every ~0.3 s
    // that is a self-sustaining storm, hardest exactly when the link is worst.
    CHECK(!syslog_error_is_hard(ENOMEM));
    CHECK(!syslog_error_is_hard(ENOBUFS));
    CHECK(!syslog_error_is_hard(EAGAIN));
    CHECK(!syslog_error_is_hard(EINTR));

    // Unknown errno defaults to TRANSIENT. Safe by asymmetry: clearing the throttle only ACCELERATES
    // the next resolve (the 10 s cadence runs regardless), so a misjudged hard error costs one
    // cadence of delay, while a misjudged transient one costs the storm above.
    CHECK(!syslog_error_is_hard(0));
    CHECK(!syslog_error_is_hard(999999));
}

// ── connectivity-watchdog policy (logic/link_watch.hpp) ──────────────────────────────────────
static void test_link_watch() {
    // A link that KNOWS it is down belongs to the reconnect handler — the watchdog stays out of it
    // and forgets any history, so a router outage doesn't bank failures toward a later re-assoc.
    LinkWatch down;
    down.unreachable = 1; down.blind = 5;
    CHECK(link_watch_step(down, false, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(down.unreachable == 0 && down.blind == 0);

    // Proven silence on a previously-verified gateway: act on the SECOND consecutive miss, not the
    // first, and not before.
    LinkWatch g;
    CHECK(link_watch_step(g, true, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(g.unreachable == 1);
    CHECK(link_watch_step(g, true, GwProbe::Unreachable, true) == WdAction::Reassociate);
    CHECK(g.unreachable == 0);   // counter resets after acting — no repeat-fire on the next period

    // One reply clears the count: two misses either side of a success must not add up to a ghost.
    LinkWatch mix;
    CHECK(link_watch_step(mix, true, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(link_watch_step(mix, true, GwProbe::Reachable, true) == WdAction::None);
    CHECK(mix.unreachable == 0);
    CHECK(link_watch_step(mix, true, GwProbe::Unreachable, true) == WdAction::None);

    // A gateway that never answered ICMP may simply firewall it — never re-associate on its
    // silence, however long, or a healthy link churns every ~60 s forever.
    LinkWatch fw;
    for (int i = 0; i < 10; i++) CHECK(link_watch_step(fw, true, GwProbe::Unreachable, false) == WdAction::None);

    // THE fix. Unmeasurable is not a failure: it never trips the fast (2-period) path...
    LinkWatch b;
    for (int i = 0; i < WD_BLIND_TO_REASSOC - 1; i++)
        CHECK(link_watch_step(b, true, GwProbe::Unmeasurable, true) == WdAction::None);
    CHECK(b.unreachable == 0);   // blindness never counts as proven silence
    // ...but a SUSTAINED inability to measure while the link claims to be up is its own proven
    // fault. Previously this state returned "healthy" forever and silently: a wedged board was
    // indistinguishable from a good one, so the watchdog never fired at all.
    CHECK(link_watch_step(b, true, GwProbe::Unmeasurable, true) == WdAction::Reassociate);
    CHECK(b.blind == 0);

    // The blind path is an order of magnitude slower than the proven-silence path — acting on
    // absence of evidence stays the last resort.
    CHECK(WD_BLIND_TO_REASSOC > WD_UNREACHABLE_TO_REASSOC * 4);

    // Blindness is gated on the same baseline as silence: only ever act on a verified link.
    LinkWatch bn;
    for (int i = 0; i < WD_BLIND_TO_REASSOC * 2; i++)
        CHECK(link_watch_step(bn, true, GwProbe::Unmeasurable, false) == WdAction::None);

    // A probe that RUNS ends the blind spell whatever its verdict...
    LinkWatch c;
    link_watch_step(c, true, GwProbe::Unmeasurable, true);
    CHECK(c.blind == 1);
    link_watch_step(c, true, GwProbe::Unreachable, true);
    CHECK(c.blind == 0);
    // ...but a blind period must not LAUNDER proven silence we already observed: one miss, then a
    // blind gap, then a second miss still adds up to a ghost.
    LinkWatch l;
    CHECK(link_watch_step(l, true, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(link_watch_step(l, true, GwProbe::Unmeasurable, true) == WdAction::None);
    CHECK(l.unreachable == 1);   // still standing
    CHECK(link_watch_step(l, true, GwProbe::Unreachable, true) == WdAction::Reassociate);
}

// ── WiFi credential-rollback policy (logic/wifi_rollback.hpp) ────────────────────────────────
static void test_wifi_rollback() {
    // The whole point of the classifier: an AP that REFUSED us is evidence about the credentials; an
    // AP that was never on the air is evidence about the ROUTER and says nothing about credentials.
    CHECK(disco_class(202) == DiscoClass::Auth);        // AUTH_FAIL
    CHECK(disco_class(15)  == DiscoClass::Auth);        // 4WAY_HANDSHAKE_TIMEOUT — PSK did not verify
    CHECK(disco_class(204) == DiscoClass::Auth);        // HANDSHAKE_TIMEOUT
    CHECK(disco_class(211) == DiscoClass::Auth);        // NO_AP_FOUND_IN_AUTHMODE — security mismatch
    CHECK(disco_class(210) == DiscoClass::Auth);        // NO_AP_FOUND_W_COMPATIBLE_SECURITY
    CHECK(disco_class(201) == DiscoClass::ApAbsent);    // NO_AP_FOUND — the SSID was not there
    CHECK(disco_class(212) == DiscoClass::ApAbsent);    // NO_AP_FOUND_IN_RSSI_THRESHOLD — out of range
    CHECK(disco_class(0)   == DiscoClass::None);        // nothing observed yet
    CHECK(disco_class(200) == DiscoClass::Other);       // BEACON_TIMEOUT — a link fault, not creds
    CHECK(disco_class(8)   == DiscoClass::Other);       // ASSOC_LEAVE (deauth)

    // Nothing is decided before the ordinary window is up — not even for the auth class. Those
    // reasons double as the transient WPA3-SAE failures wifi.cpp works around, so an early one must
    // never be enough on its own to spend credentials that cannot be recovered.
    {
        RollbackWatch w;
        CHECK(rollback_step(w, DiscoClass::Auth, 0) == RollbackAction::Wait);
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S - 1) == RollbackAction::Wait);
    }

    // Wrong password: the AP answers and keeps saying no. It must SUSTAIN that across checkpoints —
    // one sample cannot tell a wrong password from a transient SAE failure that merely happened to
    // be the last thing logged when we looked — but two roll back, still within issue #47's "~1 boot
    // cycle".
    {
        RollbackWatch w;
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S) == RollbackAction::Wait);
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S * 2) == RollbackAction::RollBack);
        CHECK(WIFI_BOOT_WINDOW_S * WIFI_AUTH_TO_ROLLBACK <= 60);
    }

    // A refusal that does NOT persist must not spend the credentials: wifi.cpp clears the reason slot
    // on STA_CONNECTED, so an association mid-window reports None and breaks the streak. This is the
    // transient-SAE-then-slow-DHCP boot — the AP took us, we are just waiting on a lease.
    {
        RollbackWatch w;
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S) == RollbackAction::Wait);
        CHECK(rollback_step(w, DiscoClass::None, WIFI_BOOT_WINDOW_S * 2) == RollbackAction::Wait);
        CHECK(w.auth == 0);   // the streak is broken, not merely paused
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S * 3) == RollbackAction::Wait);
    }

    // THE fix. A router that is still rebooting shows up as an absent SSID, which the blind deadline
    // read as "wrong credentials" and answered by destroying the correct new ones. Absence of
    // evidence now buys the full grace window instead — and no amount of it ever takes the fast path.
    {
        RollbackWatch w;
        for (int t = WIFI_BOOT_WINDOW_S; t < WIFI_ROLLBACK_GRACE_S; t += WIFI_BOOT_WINDOW_S)
            CHECK(rollback_step(w, DiscoClass::ApAbsent, t) == RollbackAction::Wait);
        // Bounded, though: an SSID that never appears at all (a typo'd name) must still fall back to
        // the network we know works, rather than leaving the device off the LAN forever.
        CHECK(rollback_step(w, DiscoClass::ApAbsent, WIFI_ROLLBACK_GRACE_S) == RollbackAction::RollBack);
    }

    // Inconclusive is treated exactly like absent — associated but no DHCP lease yet, or any other
    // fault. Only the AP's own sustained "no" is allowed to be fast.
    for (DiscoClass k : {DiscoClass::None, DiscoClass::Other}) {
        RollbackWatch w;
        CHECK(rollback_step(w, k, WIFI_BOOT_WINDOW_S) == RollbackAction::Wait);
        CHECK(rollback_step(w, k, WIFI_ROLLBACK_GRACE_S) == RollbackAction::RollBack);
    }

    // The acceptance criterion from issue #47, as a check: valid new credentials with the router
    // offline for 2 minutes must still be waiting, not rolled back.
    CHECK(WIFI_ROLLBACK_GRACE_S > 120);
    {
        RollbackWatch w;
        CHECK(rollback_step(w, DiscoClass::ApAbsent, 120) == RollbackAction::Wait);
    }
    // ...and the grace must be a MATERIAL extension of the flat window, not a nudge.
    CHECK(WIFI_ROLLBACK_GRACE_S >= WIFI_BOOT_WINDOW_S * 4);
}

// ── /events WebSocket command policy (logic/ws_policy.hpp) ───────────────────────────────────
static void test_ws_policy() {
    // An empty frame carries no command and leaves no body in the stream: ignore it, keep the
    // connection. Anything that fits the command buffer is safe to read.
    CHECK(ws_frame_plan(0) == WsPlan::Skip);
    CHECK(ws_frame_plan(3) == WsPlan::Read);

    // The boundary that is the whole bug. A frame of exactly WS_CMD_MAX still fits; ONE byte more
    // used to be clamped to the buffer size, fail the read with ESP_ERR_INVALID_SIZE, and then get
    // memcmp'd anyway — comparing against stack the failed read had never written.
    CHECK(ws_frame_plan(WS_CMD_MAX)     == WsPlan::Read);
    CHECK(ws_frame_plan(WS_CMD_MAX + 1) == WsPlan::Reject);

    // The announced length is a 64-bit number the client asserts before anything is read. It must
    // reach a decision, never an allocation: sizing a buffer from it would make one frame an OOM on
    // a chip whose binding limit is the largest contiguous free block.
    CHECK(ws_frame_plan(1u << 20)            == WsPlan::Reject);
    CHECK(ws_frame_plan(SIZE_MAX)            == WsPlan::Reject);

    // The one command we speak.
    CHECK(ws_frame_action(true, "sub", 3) == WsAction::Subscribe);

    // A prefix still subscribes — that is what the handler has always accepted, and this change is
    // about frames that were never read, not about narrowing the grammar on working clients.
    CHECK(ws_frame_action(true, "sub\n", 4)     == WsAction::Subscribe);
    CHECK(ws_frame_action(true, "subscribe", 9) == WsAction::Subscribe);

    // Everything else earns nothing: no snapshot, and no slot in the broadcast list.
    CHECK(ws_frame_action(true, "nope", 4) == WsAction::Ignore);
    CHECK(ws_frame_action(true, "su",   2) == WsAction::Ignore);   // too short to be the command
    CHECK(ws_frame_action(true, "",     0) == WsAction::Ignore);

    // A binary frame is not the text protocol, whatever bytes it carries.
    CHECK(ws_frame_action(false, "sub", 3) == WsAction::Ignore);

    // A caller that passes a buffer no read filled must not be taken at its word.
    CHECK(ws_frame_action(true, nullptr, 3) == WsAction::Ignore);
}

// ── request-body reassembly (logic/http_body.hpp) ────────────────────────────────────────────
static void test_http_body() {
    // The common case: the body arrives in one recv, is NUL-terminated, and reports its length.
    {
        const std::string body = R"({"ssid":"home","pass":"secret12"})";
        char buf[128] = {};
        size_t sent = 0;
        const int r = http_body_read(buf, sizeof(buf), body.size(),
            [&](char* dst, size_t len) -> BodyChunk {
                std::memcpy(dst, body.data() + sent, len);
                sent += len;
                return { BodyRecv::Data, len };
            });
        CHECK(r == static_cast<int>(body.size()));
        CHECK(std::string(buf) == body);
    }

    // THE regression. httpd_req_recv hands over what has ARRIVED, not the whole body — its own docs
    // say a large body may take multiple calls. The old single-call read took the first segment for
    // the entire body, so a POST split across TCP segments was answered 400 "bad json" while being
    // perfectly valid. One byte per call is that failure at its most extreme.
    {
        const std::string body = R"({"broker":"mqtts://nas.lan:8883","user":"ha"})";
        char buf[128] = {};
        size_t sent = 0;
        int calls = 0;
        const int r = http_body_read(buf, sizeof(buf), body.size(),
            [&](char* dst, size_t) -> BodyChunk {
                calls++;
                dst[0] = body[sent++];
                return { BodyRecv::Data, 1 };
            });
        CHECK(r == static_cast<int>(body.size()));
        CHECK(std::string(buf) == body);
        CHECK(calls == static_cast<int>(body.size()));   // it really did reassemble, segment by segment
    }

    // A timeout is "nothing arrived yet", not "give up" — and progress clears the idle count, so a
    // body that keeps trickling in is never abandoned however long it takes overall.
    {
        const std::string body = "0123456789";
        char buf[32] = {};
        size_t sent = 0;
        int n = 0;
        const int r = http_body_read(buf, sizeof(buf), body.size(),
            [&](char* dst, size_t) -> BodyChunk {
                if (n++ % 3 != 2) return { BodyRecv::Timeout, 0 };   // 2 stalls, then a byte, forever
                dst[0] = body[sent++];
                return { BodyRecv::Data, 1 };
            });
        CHECK(r == static_cast<int>(body.size()));
        CHECK(std::string(buf) == body);
    }

    // A peer that announces a body and then goes silent must lose, and must lose BOUNDED: retrying
    // forever would park the single httpd task on one client, taking the web UI — and the OTA route
    // that is the way out of a bad config — down with it.
    {
        char buf[64] = {};
        int calls = 0;
        const int r = http_body_read(buf, sizeof(buf), 10,
            [&](char*, size_t) -> BodyChunk { calls++; return { BodyRecv::Timeout, 0 }; });
        CHECK(r == -1);
        CHECK(calls == BODY_MAX_IDLE + 1);   // it gave up, and did not spin
        // The bound is absolute, not merely relative to itself: each idle round is a full socket
        // timeout (CONFIG_HTTPD_REQ_RECV_TMO, 5 s), so it must stay small enough that one silent
        // client cannot hold the httpd task for minutes, yet leave room to ride out a slow segment.
        CHECK(BODY_MAX_IDLE >= 1 && BODY_MAX_IDLE <= 4);
    }

    // A peer that closes mid-body fails the read: half a JSON document must never reach a handler
    // as if it were whole.
    {
        char buf[64] = {};
        size_t sent = 0;
        const int r = http_body_read(buf, sizeof(buf), 20,
            [&](char* dst, size_t) -> BodyChunk {
                if (sent >= 5) return { BodyRecv::Error, 0 };
                dst[0] = 'x'; sent++;
                return { BodyRecv::Data, 1 };
            });
        CHECK(r == -1);
    }

    // The size cap is preserved, terminator included: a body of exactly `cap` has nowhere to put
    // the NUL, so it is refused rather than truncated.
    {
        char buf[16] = {};
        const auto never = [](char*, size_t) -> BodyChunk { return { BodyRecv::Error, 0 }; };
        CHECK(http_body_read(buf, sizeof(buf), sizeof(buf),     never) == -1);
        CHECK(http_body_read(buf, sizeof(buf), sizeof(buf) + 1, never) == -1);
        CHECK(http_body_read(buf, sizeof(buf), 0,               never) == -1);   // no body at all
        CHECK(http_body_read(nullptr, sizeof(buf), 4,           never) == -1);
    }

    // `bytes` bounds a write into the caller's buffer, so a recv that reports more than it was
    // asked for is refused rather than trusted.
    {
        char buf[16] = {};
        const int r = http_body_read(buf, sizeof(buf), 4,
            [](char*, size_t) -> BodyChunk { return { BodyRecv::Data, 99 }; });
        CHECK(r == -1);
    }
}

int main() {
    test_crc();
    test_registers();
    test_convert();
    test_config_model();
    test_board_pins();
    test_discovery();
    test_registry();
    test_detect();
    test_json();
    test_mqtt_group();
    test_mqtt_uri();
    test_modbus();
    test_heartbeat();
    test_crashinfo();
    test_bootlog();
    test_syslog_policy();
    test_link_watch();
    test_wifi_rollback();
    test_reset_reason();
    test_boot_guard();
    test_health_gate();
    test_ws_policy();
    test_http_body();
    if (g_failures == 0) { std::printf("all logic tests passed\n"); return 0; }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
