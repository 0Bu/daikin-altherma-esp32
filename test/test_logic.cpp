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
#include "logic/board_presets.hpp"
#include "logic/captive.hpp"
#include "logic/boot_guard.hpp"
#include "logic/button.hpp"
#include "logic/led_pattern.hpp"
#include "logic/bootlog.hpp"
#include "logic/config_model.hpp"
#include "logic/convert.hpp"
#include "logic/crashinfo.hpp"
#include "logic/crc.hpp"
#include "logic/detect.hpp"
#include "logic/detect_backoff.hpp"
#include "logic/discovery.hpp"
#include "logic/error_codes.hpp"
#include "logic/health_gate.hpp"
#include "logic/version_cmp.hpp"
#include "logic/ota_channel.hpp"
#include "logic/ota_manifest.hpp"
#include "logic/heartbeat.hpp"
#include "logic/http_body.hpp"
#include "logic/json.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/link_watch.hpp"
#include "logic/feature_gate.hpp"
#include "logic/lwt_select.hpp"
#include "logic/profile_view.hpp"
#include "logic/ou_stale.hpp"
#include "logic/mqtt_uri.hpp"
#include "logic/modbus.hpp"
#include "logic/query_flag.hpp"
#include "logic/config_store.hpp"
#include "logic/mcp_jsonrpc.hpp"
#include "logic/http_surface.hpp"
#include "logic/registers.hpp"
#include "logic/reset_reason.hpp"
#include "logic/syslog_policy.hpp"
#include "logic/hexdump.hpp"
#include "logic/timestamp.hpp"
#include "logic/uart_plan.hpp"
#include "logic/wifi_rollback.hpp"
#include "logic/ws_policy.hpp"
#include "logic/ws_tx_gate.hpp"
#include "def/overlay.hpp"
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

    // error_codes.hpp: English description lookup on top of the raw conv-204 code, keyed on the
    // exact same code strings ERR_C1/ERR_C2 produce (docs/REGISTERS.md §4.3).
    CHECK(std::string(error_code_description("U4")) == "Indoor/outdoor unit communication problem");
    CHECK(std::string(error_code_description("E3")) == "Outdoor unit high-pressure switch activated");
    CHECK(std::string(error_code_description("7H")) == "Water flow problem");
    CHECK(std::string(error_code_description("UF")) == "Reversed piping or faulty communication wiring detected");
    CHECK(std::string(error_code_description("ZZ")) == "");    // not in the table -> empty, not a guess
    CHECK(std::string(format_error_code("U4")) == "U4: Indoor/outdoor unit communication problem");
    CHECK(std::string(format_error_code("ZZ")) == "ZZ");       // unknown code -> bare code, unchanged

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

    // conv 405 saturation temp from a 0-bar sensor (absent on many hydrobox units, or the compressor
    // simply off) must NOT publish its press2temp(0) ≈ -51 °C placeholder — drop it INTRINSICALLY in
    // convert() (the 0-bar decision needs the raw pressure, which the publish-time filter never sees).
    const uint8_t zerobar[] = {0x00, 0x00};            // 0 bar in -> no meaningful sat temp
    CHECK(!convert(p405, zerobar).ok);
    const uint8_t realbar[] = {0x64, 0x00};            // LE 100 -> 10.0 bar -> a real sat temp kept
    CHECK(convert(p405, realbar).ok);

    // reading_plausible: the publish-time °C envelope (TEMP_MIN_C/TEMP_MAX_C), applied by hp_format —
    // NOT inside convert(), which keeps its intrinsic per-converter semantics so the catalog audit can
    // still tell conv 105 from conv 114 (see convert.hpp / tools/domain/selftest.sh #38). This is what
    // stops an idle OU's 576 °C outdoor-HX or a 231.6 °C target-evap reaching Home Assistant.
    ValueDef ot{0x20, 2, 105, 2, 1, "outdoor HX"};
    const uint8_t hot576[] = {0x80, 0x16};             // LE 0x1680 = 5760 -> 576.0 °C, impossible
    CHECK(convert(ot, hot576).ok);                     // convert() still decodes it (intrinsic, unchanged)
    CHECK(!reading_plausible(ot, convert(ot, hot576)));// but it is not fit to publish
    ValueDef evap{0x10, 6, 114, 2, 1, "evap"};
    const uint8_t evap2316[] = {0x0C, 0x09};           // LE 0x090C = 2316 -> 231.6 °C, impossible
    CHECK(!reading_plausible(evap, convert(evap, evap2316)));
    const uint8_t warm[] = {0xF4, 0x01};               // LE 500 -> 50.0 °C, a real reading
    CHECK(reading_plausible(ot, convert(ot, warm)) && approx(convert(ot, warm).value, 50.0));
    // A ±3276.x no-data sentinel on conv 105 (which has NO intrinsic guard) is also caught here — the
    // general backstop that #35–#39 never had for conv 105.
    const uint8_t nd105[] = {0x00, 0x80};              // 0x8000 -> -3276.8 °C on conv 105
    CHECK(convert(ot, nd105).ok && !reading_plausible(ot, convert(ot, nd105)));
    // Keyed on the °C dataType, never the converter id: conv 105 also carries kW / COP rows at
    // dataType -1 (e.g. BE_COP), which must publish even when numerically large.
    ValueDef cop{0x64, 3, 105, 2, -1, "BE_COP"};
    const uint8_t cop3000[] = {0xB8, 0x0B};            // LE 3000 -> 300.0, must NOT be clipped (not °C)
    CHECK(reading_plausible(cop, convert(cop, cop3000)) && approx(convert(cop, cop3000).value, 300.0));

    // A REFRIGERANT pressure of 0 bar is an unreported transducer, not a reading: these are ABSOLUTE
    // pressures and a sealed circuit is never at vacuum. Measured on a live 4-8 kW unit, High/Low
    // Pressure (0x20/12+14) read exactly 0.0 bar both at rest and at 42 rps, while the 0x62/15
    // refrigerant sensor read a correct 15.3 bar — so the 0.0 reached HA as a real pressure (#35-#39
    // shape). WATER pressure must keep publishing 0 bar: a drained system genuinely reads it.
    // The refrigerant/water split is taken from the CATALOG — a conv-405 saturation-temperature
    // companion at the same (reg, offset) — never from the label, which an alias could flip.
    const ValueDef pprof[] = {
        {0x20, 12, 105, 2, 2, "High Pressure"}, {0x20, 12, 405, 2, 1, "High Pressure(T)"},
        {0x62, 11, 105, 1, 2, "Water pressure"},                       // no 405 companion -> water
        {0x62, 15, 105, 2, 2, "Refrigerant pressure sensor"}, {0x62, 15, 405, 2, 1, "Pressure sensor(T)"},
    };
    const size_t pn = sizeof(pprof) / sizeof(pprof[0]);
    CHECK(is_refrigerant_pressure(pprof[0], pprof, pn));      // 0x20/12 — outdoor page AND a 405 twin
    CHECK(is_refrigerant_pressure(pprof[3], pprof, pn));      // 0x62/15 — hydronic page, reached by the twin
    CHECK(!is_refrigerant_pressure(pprof[2], pprof, pn));     // 0x62/11 water pressure: neither signal
    // The PAGE signal alone must carry an outdoor bar row that has no 405 twin (0xA0 "Pressure"),
    // and must not need the profile at all — that is what makes signal 1 independent of signal 2.
    const ValueDef aux{0xA0, 6, 119, 2, 2, "Pressure"};
    CHECK(is_refrigerant_pressure(aux, pprof, pn));
    CHECK(is_refrigerant_pressure(aux, nullptr, 0));
    // Same (reg,offset) but a different PAGE must not borrow the twin: 0x20/12 vs 0x62/12.
    const ValueDef otherpage{0x62, 12, 105, 2, 2, "some other bar"};
    CHECK(!is_refrigerant_pressure(otherpage, pprof, pn));
    // A non-bar row on an outdoor page is not a pressure at all — the page signal must not swallow it.
    const ValueDef outdoor_temp{0x20, 2, 105, 2, 1, "R1T-Outdoor air temp."};
    CHECK(!is_refrigerant_pressure(outdoor_temp, pprof, pn));
    const uint8_t p0bar[]  = {0x00, 0x00};                    // 0 -> 0.0 bar
    const uint8_t bar153[] = {0x99, 0x00};                    // LE 153 -> 15.3 bar, the real at-rest value
    CHECK(convert(pprof[0], p0bar).ok);                                      // still decoded (intrinsic)
    CHECK(!reading_plausible(pprof[0], convert(pprof[0], p0bar), pprof, pn));    // but not published
    CHECK(reading_plausible(pprof[3], convert(pprof[3], bar153), pprof, pn) &&
          approx(convert(pprof[3], bar153).value, 15.3));                     // a real one survives
    CHECK(reading_plausible(pprof[2], convert(pprof[2], p0bar), pprof, pn));  // 0 bar WATER publishes
    // Called WITHOUT a profile, the two signals degrade differently, and that split is the point:
    // the PAGE signal needs no table, so an outdoor 0-bar row is still withheld...
    CHECK(!reading_plausible(pprof[0], convert(pprof[0], p0bar)));            // 0x20 — still caught
    // ...while the conv-405 twin cannot be looked up, so a hydronic refrigerant row falls back to
    // publishing rather than being guessed at. A caller with no table in hand gets the weaker
    // guarantee, never a wrong one.
    CHECK(reading_plausible(pprof[3], convert(pprof[3], p0bar)));             // 0x62/15 — not caught
    CHECK(!reading_plausible(pprof[3], convert(pprof[3], p0bar), pprof, pn)); // ...but caught with it

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

    // conv 310 = protection-retry counter, bits 4-6 ONLY (docs/REGISTERS.md §3.3). Page 0x10 bytes
    // 10-12 pack a drop-control flag (bit 7, conv 307), this counter (bits 4-6), a second drop flag
    // (bit 3, conv 303) and a second counter (bits 0-2, conv 311) into ONE byte, so an unmasked read
    // would publish a retry count of 1 as 149. This is UC5's core signal (issue #69 step 0.2).
    ValueDef retry{0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty"};
    const uint8_t rt95[] = {0x95};   // 1001 0101: drop set, retry 1, low counter 5
    CHECK(convert(retry, rt95).ok && approx(convert(retry, rt95).value, 1.0));
    CHECK(approx(convert(ValueDef{0x10, 10, 311, 1, -1, "low"}, rt95).value, 5.0));  // same byte, other window
    const uint8_t rt70[] = {0x70};
    CHECK(approx(convert(retry, rt70).value, 7.0));   // full 3-bit range passes through
    const uint8_t rt8F[] = {0x8F};
    CHECK(approx(convert(retry, rt8F).value, 0.0));   // only bits OUTSIDE the window set -> 0
    const uint8_t rtFF[] = {0xFF};
    CHECK(approx(convert(retry, rtFF).value, 7.0));   // saturates at 7, never 255
    // A retry count is a whole number of retries — "1.0 retries" in HA would be a formatting bug.
    CHECK(display_decimals(310) == 0);

    // Catalog guard for page 0x10 offsets 10-12, the four-fields-per-byte protection words. Armed
    // ahead of the rows in PR #111, when it was vacuous by construction; it is LIVE now that
    // def/overlay.hpp supplies them (#110 Part B), and it runs over the RESOLVED view so it covers
    // the supplement exactly as it would cover the generator's output when that finally lands.
    // The failures it guards against: a size-2 read straddling two protection words, a plain byte
    // converter publishing 149 where the spec says 1, and — the #36 failure mode — a dimensionless
    // retry COUNT typed as °C, which reaches Home Assistant as a phantom temperature entity that
    // looks entirely plausible. None of the four fields packed into these bytes is a temperature:
    // two are drop-control flags, two are counters. type 1 (°C) is always wrong here.
    int prot_checked = 0;
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++)
            if (v[i].reg == 0x10 && v[i].offset >= 10 && v[i].offset <= 12) {
                CHECK(v[i].size == 1);
                const int c = v[i].conv;
                CHECK(c == 303 || c == 307 || c == 310 || c == 311);
                CHECK(v[i].type != 1);   // never °C — see #36
                prot_checked++;
            }
    }
    // No longer vacuous: 11 supplement rows on every profile that reads page 0x10 (all 45).
    CHECK(prot_checked >= 11 * 45);

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
    // The atomic service blob and the self-healing link cache have different success contracts.
    // Ordinary service routes own only blob fields, so a cache-maintenance hiccup after that commit
    // must not report a false 500; /set_hp owns the cache and therefore does require it.
    CHECK(config_save_succeeded(true, true, false));
    CHECK(config_save_succeeded(true, false, false));
    CHECK(config_save_succeeded(true, true, true));
    CHECK(!config_save_succeeded(true, false, true));
    CHECK(!config_save_succeeded(false, true, false));
    CHECK(!config_save_succeeded(false, true, true));

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

    // Chip-reserved-pin rule (#103): a range-valid, DISTINCT pair is still an illegal link if either
    // pin is a pad this chip/build reserves — the hole that let a curl POST to /set_hp route the X10A
    // UART onto the SPI-flash pins and crash-loop the board. board_pin_offerable is the membership
    // test; link_pins_safe and validate both defer to it.
    CHECK(board_pin_offerable(44, /*octal*/true, /*reserved*/-1));   // the X10A default is offerable
    CHECK(board_pin_offerable(43, true, -1));
    CHECK(!board_pin_offerable(27, true, -1));                       // GPIO27 = SPI flash — never offerable
    CHECK(!board_pin_offerable(0,  true, -1));                       // GPIO0  = strapping
    CHECK(!board_pin_offerable(19, true, -1));                       // GPIO19 = USB-Serial/JTAG
    CHECK(board_pin_offerable(33,  /*octal*/false, -1));             // GPIO33 free on a Quad-SPI build
    CHECK(!board_pin_offerable(33, /*octal*/true,  -1));             // ...reserved on an Octal build
    CHECK(!board_pin_offerable(21, true, /*reserved*/21));           // the status-LED pin is claimed

    CHECK(link_pins_safe(44, 43, true, -1));                         // the pair rule AND the reserved rule
    CHECK(!link_pins_safe(27, 43, true, -1));                        // rx on flash
    CHECK(!link_pins_safe(44, 27, true, -1));                        // tx on flash
    CHECK(!link_pins_safe(44, 44, true, -1));                        // still catches rx == tx
    CHECK(!link_pins_safe(44, 21, true, /*reserved*/21));            // tx is the LED pin

    // validate() names WHICH pin is reserved (the device passes the real octal/reserved facts).
    c.rx_pin = 27; c.tx_pin = 43;                                    // rx on SPI flash
    CHECK(!validate(c, why, 48, /*octal*/true, /*reserved*/-1));
    c.rx_pin = 44; c.tx_pin = 21;                                    // tx is the status-LED pin
    CHECK(!validate(c, why, 48, true, /*reserved*/21));
    CHECK(validate(c, why, 48, true, /*reserved*/-1));               // ...allowed when the LED is off
    c.rx_pin = 44; c.tx_pin = 43;                                    // restore

    // ── Board-local hardware (POST /set_board) ───────────────────────────────────────────────────
    // Both pins are optional and default to absent; the button defaults to absent DELIBERATELY (an
    // unconfigured input floats, and a floating pin reading "pressed" would factory-reset a board
    // nobody touched), so a default Config must validate with both off.
    Config b;
    CHECK(b.led_gpio == -1 && b.btn_gpio == -1);
    CHECK(b.led_type == static_cast<int>(LedType::Gpio) && b.btn_active_low);
    CHECK(board_hw_valid(b, why, 48, /*octal*/false));

    // The reference boards must both configure cleanly: XIAO (plain LED on 21, no button) and
    // AtomS3 Lite (WS2812 on 35, button on the JTAG pad 41).
    b.led_gpio = 21; b.led_type = static_cast<int>(LedType::Gpio); b.led_inverted = true;
    CHECK(board_hw_valid(b, why, 48, false));
    b.led_gpio = 35; b.led_type = static_cast<int>(LedType::Ws2812); b.btn_gpio = 41;
    CHECK(board_hw_valid(b, why, 48, /*octal*/false));
    // ...but GPIO35 is genuinely unsafe on a build whose flash/PSRAM run Octal I/O.
    CHECK(!board_hw_valid(b, why, 48, /*octal*/true));

    b.led_gpio = 35; b.btn_gpio = 41;
    CHECK(!board_hw_valid(b, why, 21, false));                 // pins don't exist on a 21-GPIO target
    b.led_type = 7;
    CHECK(!board_hw_valid(b, why, 48, false));                 // unknown driver id
    b.led_type = static_cast<int>(LedType::Ws2812);

    // Hard chip conflicts are refused for a local LED too — the wider local-I/O set adds ONLY the
    // dedicated-JTAG pads, not flash or the USB console.
    b.led_gpio = 27;
    CHECK(!board_hw_valid(b, why, 48, false));                 // SPI flash
    b.led_gpio = 19;
    CHECK(!board_hw_valid(b, why, 48, false));                 // USB-Serial/JTAG console
    b.led_gpio = 35;

    // No pin may be claimed twice, in EITHER direction — whichever endpoint is called second has to
    // see the other's pins, or /set_board and /set_hp would happily hand the same GPIO to both.
    b.btn_gpio = 35;
    CHECK(!board_hw_valid(b, why, 48, false));                 // button == indicator
    b.btn_gpio = 41;
    b.rx_pin = 35;                                             // X10A already owns the indicator's pin
    CHECK(!board_hw_valid(b, why, 48, false));
    b.rx_pin = 44; b.tx_pin = 41;                              // ...and the button's
    CHECK(!board_hw_valid(b, why, 48, false));
    b.tx_pin = 43;
    CHECK(board_hw_valid(b, why, 48, false));
    // The mirror image: with the indicator + button configured, /set_hp must not be able to take
    // their pins. config_reserved_pins is the one accessor both sides read.
    CHECK(config_reserved_pins(b).pin_a == 35 && config_reserved_pins(b).pin_b == 41);
    // ...and the mirror accessor names the OTHER pair, for the LED/button pickers. Two factories,
    // one anonymous two-slot struct: which pins are spoken for is stated at the call site.
    CHECK(config_link_pins(b).pin_a == 44 && config_link_pins(b).pin_b == 43);
    CHECK(config_link_pins(b).claims(44) && config_link_pins(b).claims(43));
    CHECK(!config_link_pins(b).claims(35) && !config_link_pins(b).claims(-1));
    Config steal = b;
    steal.rx_pin = 35;                                          // try to route X10A RX onto the LED
    CHECK(!validate(steal, why, 48, false, config_reserved_pins(b)));
    steal.rx_pin = 44; steal.tx_pin = 41;                       // ...or TX onto the button
    CHECK(!validate(steal, why, 48, false, config_reserved_pins(b)));
    steal.tx_pin = 43;
    CHECK(validate(steal, why, 48, false, config_reserved_pins(b)));
    // With no board hardware configured, both pins are free again.
    Config none;
    none.rx_pin = 35; none.tx_pin = 41;
    CHECK(config_reserved_pins(none).pin_a == -1 && config_reserved_pins(none).pin_b == -1);
    CHECK(!validate(none, why, 48, false, config_reserved_pins(none)));   // 41 is JTAG: never an X10A pin
    none.tx_pin = 43;
    CHECK(validate(none, why, 48, false, config_reserved_pins(none)));    // 35 is fine on a Quad build

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
    apply_model(live, "altherma3_r_erga", 0x5u, -1, 80, "1234");
    CHECK(live.profile == "altherma3_r_erga");
    CHECK(live.fp_pages == 0x5u && live.fp_eeprom == "1234");
    CHECK(live.fp_valid);                              // a committed model is always valid
    // The two capacities are carried SEPARATELY and neither stands in for the other. This is the real
    // shape of a unit with a short 0x00 descriptor (no O/U capacity at all) beside an indoor unit
    // that does report 8.0 kW. Folding the I/U code into fp_kw_tenths would publish the indoor unit's
    // size as the outdoor unit's — wrong for any plant whose halves differ, e.g. a 6 kW outdoor unit
    // under an 8 kW indoor unit, which is an ordinary pairing.
    CHECK(live.fp_kw_tenths == -1 && live.fp_iu_kw_tenths == 80);
    apply_model(live, "altherma3_r_erga", 0x5u, 60, 80, "1234");
    CHECK(live.fp_kw_tenths == 60 && live.fp_iu_kw_tenths == 80);   // both kept, both distinct
    CHECK(live.rx_pin == 16 && live.tx_pin == 17);     // model patch leaves the link alone
    CHECK(live.wifi_ssid == "new-net");                // ...and the credentials
    CHECK(live.mqtt_uri == "mqtts://broker.lan");
}

// The HA DEVICE identity (logic/ha_device.hpp). The one property that matters: it is a pure
// function of the MQTT base topic and contains nothing board-specific — replacing the ESP32 must
// keep ONE device in HA (and with it the entities, their history and their statistics), which the
// old MAC-derived node id could not do.
static void test_ha_device() {
    CHECK(device_node_id("daikin-altherma-esp32") == "daikin_altherma_esp32");
    CHECK(device_node_id("home/heating/daikin altherma") == "home_heating_daikin_altherma");
    CHECK(device_node_id("Daikin_2") == "daikin_2");
    // A base topic that slugifies to nothing must still yield a usable discovery-topic segment —
    // an empty node would produce "homeassistant/sensor//x/config", which HA silently ignores.
    CHECK(device_node_id("///") == "daikin");
    CHECK(device_node_id("") == "daikin");
    // Two base topics stay two devices (that is how a second board is separated), one base topic
    // stays ONE device no matter which hardware publishes it.
    CHECK(device_node_id("daikin-altherma-esp32") != device_node_id("daikin-altherma-esp32-2"));

    // The device block: stable id FIRST (the anchor HA matches on after a swap), board id second.
    CHECK(device_json("daikin_altherma_esp32", "daikin_abc123") ==
          "\"dev\":{\"ids\":[\"daikin_altherma_esp32\",\"daikin_abc123\"],"
          "\"name\":\"Daikin Altherma\",\"mf\":\"Daikin\",\"mdl\":\"Altherma\"}");
    // No board id, or a board id that IS the node id -> a single identifier. A duplicated entry
    // would be a malformed device for HA, not a harmless repeat.
    CHECK(device_json("daikin_altherma_esp32", "").find("\"ids\":[\"daikin_altherma_esp32\"],")
          != std::string::npos);
    CHECK(device_json("daikin_x", "daikin_x").find("\"ids\":[\"daikin_x\"],") != std::string::npos);

    // All THREE discovery surfaces must describe the same device — values, board diagnostics and the
    // crash entity. A dev block that drifted between them would split the board across two HA
    // devices again, which is the failure this identity exists to remove.
    const std::string node = device_node_id("daikin-altherma-esp32"), brd = "daikin_abc123";
    const std::string dev  = device_json(node, brd);
    ValueDef v{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    CHECK(discovery_config(node, brd, "s", "a", v).find(dev) != std::string::npos);
    CHECK(heartbeat_discovery_config(node, brd, "s", "a", HEARTBEAT_SENSORS[0]).find(dev)
          != std::string::npos);
    CHECK(crash_discovery_config(node, brd, "s", "a", CRASH_SENSORS[0]).find(dev)
          != std::string::npos);
}

static void test_discovery() {
    CHECK(object_id("DHW Tank Temp (R5T)") == "dhw_tank_temp_r5t");
    CHECK(object_id("  A/B  ") == "a_b");

    ValueDef def{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    const std::string base  = "daikin-altherma-esp32";
    const std::string node  = device_node_id(base);        // the INSTALLATION — survives a board swap
    const std::string board = "daikin_abc123";             // this board's own MAC-derived id
    CHECK(node == "daikin_altherma_esp32");
    const std::string st = state_topic(base);             // ONE shared topic for every sensor
    CHECK(st == "daikin-altherma-esp32/state");            // node NOT in the message topic (one board/base)
    CHECK(availability_topic(base) == "daikin-altherma-esp32/status");
    std::string cfg = discovery_config(node, board, st, availability_topic(base), def);
    CHECK(cfg.find("\"dev_cla\":\"temperature\"") != std::string::npos);
    CHECK(cfg.find("\"stat_cla\":\"measurement\"") != std::string::npos);
    CHECK(cfg.find("\"unit_of_meas\":\"°C\"") != std::string::npos);
    CHECK(cfg.find("\"stat_t\":\"daikin-altherma-esp32/state\"") != std::string::npos);
    CHECK(cfg.find("\"avty_t\":\"daikin-altherma-esp32/status\"") != std::string::npos);
    // Shared JSON topic -> value_template subscripts group (page 0x61 -> hydronic_temps) + object.
    CHECK(cfg.find("\"val_tpl\":\"{{ value_json['hydronic_temps']['dhw_tank_temp_r5t'] }}\"")
          != std::string::npos);
    // The node id identifies the DEVICE in uniq_id/dev.ids — just not in the message topic. It is
    // the BASE-TOPIC id, so a replacement board publishes the same unique_ids and HA keeps the
    // entities (and their statistics) instead of starting a second device from scratch.
    CHECK(cfg.find("\"uniq_id\":\"daikin_altherma_esp32_dhw_tank_temp_r5t\"") != std::string::npos);
    CHECK(cfg.find("\"uniq_id\":\"daikin_abc123") == std::string::npos);
    // …and the board id rides along as a SECOND device identifier: HA matches a device by any of
    // them, so an install set up under the old MAC-only identity is merged, not duplicated.
    CHECK(cfg.find("\"dev\":{\"ids\":[\"daikin_altherma_esp32\",\"daikin_abc123\"]") != std::string::npos);

    // A non-binary row keeps the sensor component and carries no binary payload contract.
    CHECK(std::string(ha_component(def)) == "sensor");
    CHECK(discovery_topic("homeassistant", node, def)
          == "homeassistant/sensor/daikin_altherma_esp32/dhw_tank_temp_r5t/config");
    // The same builder with the BOARD id yields the legacy topic the bridge retracts on the first
    // announce after an upgrade — the only configs a board can clean up are the ones it published.
    CHECK(discovery_topic("homeassistant", board, def)
          == "homeassistant/sensor/daikin_abc123/dhw_tank_temp_r5t/config");
    CHECK(cfg.find("\"pl_on\"") == std::string::npos);

    // --- Bit-flag rows are binary_sensors reading 1/0, not text sensors reading "ON"/"OFF" ---
    // A slug that starts with a digit must stay valid — bracket notation, not attribute access.
    ValueDef way{0x60, 12, 307, 1, -1, "2way valve(On:Heat_Off:Cool)"};
    std::string wc = discovery_config(node, board, st, availability_topic(base), way);
    CHECK(wc.find("value_json['hydronic']['2way_valve_on_heat_off_cool']") != std::string::npos);

    CHECK(std::string(ha_component(way)) == "binary_sensor");
    CHECK(discovery_topic("homeassistant", node, way)
          == "homeassistant/binary_sensor/daikin_altherma_esp32/2way_valve_on_heat_off_cool/config");
    // pl_on/pl_off must be SPELLED OUT: the state is the number 1/0, HA's defaults are "ON"/"OFF",
    // and a mismatch leaves the entity stuck at `unknown` rather than failing loudly.
    CHECK(wc.find("\"pl_on\":\"1\",\"pl_off\":\"0\"") != std::string::npos);
    // dataType -1 -> no unit, no device_class, and hence no state_class either.
    CHECK(wc.find("\"unit_of_meas\"") == std::string::npos);
    CHECK(wc.find("\"dev_cla\"") == std::string::npos);
    CHECK(wc.find("\"stat_cla\"") == std::string::npos);
    // The pre-split `sensor` config for the SAME row is what the bridge deletes on announce, so it
    // must keep pointing at the old topic (only the component segment differs).
    CHECK(retired_sensor_discovery_topic("homeassistant", node, way)
          == "homeassistant/sensor/daikin_altherma_esp32/2way_valve_on_heat_off_cool/config");
    CHECK(retired_sensor_discovery_topic("homeassistant", node, way)
          != discovery_topic("homeassistant", node, way));
    // For a non-binary row nothing is retired — the "old" topic IS the current one.
    CHECK(retired_sensor_discovery_topic("homeassistant", node, def)
          == discovery_topic("homeassistant", node, def));

    // The binary family is exactly 300-307 (one bit of data[0]); neighbours are not binary.
    CHECK(!conv_is_binary(299) && !conv_is_binary(308) && !conv_is_binary(105));
    for (int c = 300; c <= 307; c++) CHECK(conv_is_binary(c));
}

// Every bit-flag row in the SHIPPED catalog must survive the whole binary path: convert() has to
// decode both bit states to text binary_state_number() recognises, or the bridge silently falls back
// to publishing "ON"/"OFF" as a string into an entity HA has typed as a binary_sensor — a value that
// would read `unknown` in HA and never reach a metrics store. Also pins the layout the discovery
// branch assumes (size 1, dataType -1 -> no unit/device_class to reconcile).
static void test_binary_catalog() {
    int checked = 0;
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < p.count; i++) {
            const ValueDef& d = p.values[i];
            if (!conv_is_binary(d.conv)) continue;
            CHECK(d.size == 1);
            CHECK(d.type == -1);
            const uint8_t bit = static_cast<uint8_t>(1u << (d.conv - 300));
            const uint8_t set_byte = bit, clear_byte = static_cast<uint8_t>(~bit);
            Reading on  = convert(d, &set_byte);
            Reading off = convert(d, &clear_byte);
            CHECK(std::string(on.text)  == "ON");
            CHECK(std::string(off.text) == "OFF");
            const char* n_on  = binary_state_number(on.text);
            const char* n_off = binary_state_number(off.text);
            CHECK(n_on  != nullptr); CHECK(std::string(n_on  ? n_on  : "") == "1");
            CHECK(n_off != nullptr); CHECK(std::string(n_off ? n_off : "") == "0");
            // ...and 1/0 must land in the state JSON UNQUOTED, or a metrics consumer drops it again.
            CHECK(is_json_number(n_on ? n_on : ""));
            CHECK(is_json_number(n_off ? n_off : ""));
            checked++;
        }
    }
    CHECK(checked > 500);   // ~30 binary rows x 44 profiles — the catalog really was traversed
}

// is_refrigerant_pressure() across the SHIPPED catalog. The production rule is STRUCTURAL (outdoor
// page, or a conv-405 saturation twin) and must never consult the label — an alias or a translation
// would flip it. The TEST is allowed to know exactly what the rule must not depend on: it uses the
// label as an independent oracle to prove the structural rule agrees with reality.
//
// The load-bearing assertion is the NEGATIVE one. A false positive here withholds a legitimate 0-bar
// reading from a drained water circuit — inventing missing data — which is worse than the 0-bar
// refrigerant reading the filter exists to suppress. So: no row that names itself water may ever be
// classified refrigerant, on any profile, by either signal.
static void test_refrigerant_pressure_catalog() {
    int refrig = 0, water = 0, outdoor = 0;
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < p.count; i++) {
            const ValueDef& d = p.values[i];
            if (d.type != 2) continue;                       // bar rows only
            std::string lbl;
            for (const char* c = d.label; c && *c; c++) lbl += static_cast<char>(std::tolower(*c));
            const bool names_water = lbl.find("water") != std::string::npos;
            const bool flagged     = is_refrigerant_pressure(d, p.values, p.count);
            if (names_water) { CHECK(!flagged); water++; }   // <- the one that must never fail
            if (flagged) refrig++;
            // Every bar row on an outdoor page is refrigerant by the page signal alone, profile or no
            // profile: there is no water circuit in the outdoor unit.
            if (d.reg == 0x20 || d.reg == 0x21 || d.reg == 0xA0 || d.reg == 0xA1) {
                CHECK(flagged);
                CHECK(is_refrigerant_pressure(d, nullptr, 0));
                outdoor++;
            }
        }
    }
    // Traversal proof + coverage floor, so a regression that quietly stops classifying anything
    // (or stops finding the catalog at all) fails here instead of passing silently.
    CHECK(water   >= 40);    // ~44 water-pressure rows across the catalog
    CHECK(outdoor >= 80);    // ~85 outdoor bar rows
    CHECK(refrig  >= 90);    // outdoor + the 0x62 rows a 405 twin reaches
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

    // ── detect_best I/U-capacity fallback (.159's real case): the full 0x1bff page set but the O/U
    //    capacity ABSENT (a short 0x00 descriptor -> kw_tenths=-1). Without a capacity hint the
    //    tightest-span rule lands on a 14-16 kW class; the I/U capacity code (reg 0x60/6 = 80 ->
    //    8.0 kW) must steer the representative to a class that CONTAINS 8.0 kW instead. ──
    Fingerprint amb{};
    amb.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1});
    amb.kw_tenths = -1;                                 // O/U capacity unreadable (short 0x00 reply)
    const char* nofb = detect_best(sigs, nsig, amb);   // no capacity hint at all
    int nlo = -1, nhi = -1;
    CHECK(nofb && parse_kw_class(nofb, nlo, nhi) && !(nlo <= 80 && 80 <= nhi));  // wrong class w/o hint
    amb.iu_kw_tenths = 80;                              // I/U capacity code fallback = 8.0 kW
    const char* withfb = detect_best(sigs, nsig, amb);
    int wlo = -1, whi = -1;
    CHECK(withfb && parse_kw_class(withfb, wlo, whi) && wlo <= 80 && 80 <= whi);  // class now holds 8 kW
    int acount = detect_candidates(sigs, nsig, amb, out, 64);
    CHECK(has_candidate(out, acount, withfb));          // representative still drawn from the set
    // The I/U fallback must NEVER override a KNOWN O/U capacity: set kw_tenths to 16 kW and the 8 kW
    // I/U hint is ignored — the representative stays in the 16 kW class.
    amb.kw_tenths = 160;
    const char* ou = detect_best(sigs, nsig, amb);
    int olo = -1, ohi = -1;
    CHECK(ou && parse_kw_class(ou, olo, ohi) && olo <= 160 && 160 <= ohi);

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

    // The reachable case: an AP named Free<LF>WiFi. A raw newline here makes the WHOLE response fail
    // JSON.parse — /status.wifi.ssid on the dashboard, /scan on the LAN (and, before the portal took
    // a typed SSID, its network dropdown, which collapsed to a free-text box).
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

    // Bit-flag rows go on the wire as the NUMBERS 1/0 — a JSON string OR a JSON bool is dropped by a
    // metrics consumer (measured: Telegraf's json parser drops both), and HA reads them back via
    // pl_on "1" / pl_off "0". Anything that is not the expected ON/OFF text returns nullptr so the
    // caller publishes the decoded text rather than inventing a 0.
    CHECK(std::string(binary_state_number("ON")) == "1");
    CHECK(std::string(binary_state_number("OFF")) == "0");
    CHECK(binary_state_number("Heating") == nullptr);
    CHECK(binary_state_number("") == nullptr);
    CHECK(binary_state_number("on") == nullptr);      // decoded text is upper-case; no fuzzy matching
    CHECK(is_json_number("1") && is_json_number("0"));   // ...so they land unquoted in the payload

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

    // A binary row arrives here already re-encoded (mqtt_ha's current_grouped), so it must serialize
    // as a bare 1/0 next to the text values — not as "1", which would put it back out of reach.
    CHECK(build_grouped_json({{"hydronic", "thermostat_on_off", "1"},
                              {"hydronic", "silent_mode",       "0"}})
          == "{\"hydronic\":{\"thermostat_on_off\":1,\"silent_mode\":0}}");

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
    const std::string base = "daikin-altherma-esp32", node = device_node_id(base),
                      board = "daikin_abc123";   // installation id + this board's own id
    CHECK(heartbeat_topic(base) == "daikin-altherma-esp32/heartbeat");   // node NOT in the message topic

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
    f.wifi_mac        = "A1:B2:C3:D4:E5:F6";
    f.wifi_bssid      = "00:11:22:33:44:55";
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
    // FLAT payload: the former wifi/mqtt/bus sub-objects are gone, each field carried under its block
    // name as a prefix (wifi_connected, mqtt_count, bus_rx_received, …). MAC/BSSID ride the wifi_ set.
    CHECK(j == "{\"version\":\"1.2.3\",\"platform\":\"esp32s3\","
               "\"uptime_s\":680731,\"uptime\":\"007+21:05:31.860\","
               "\"free_heap\":170000,\"min_free_heap\":150000,\"max_alloc\":87000,"
               "\"reset_reason\":\"panic\",\"time\":null,"
               "\"wifi_connected\":1,\"wifi_rssi\":-76,\"wifi_quality_pct\":48,\"wifi_reconnects\":3,"
               "\"wifi_mac\":\"A1:B2:C3:D4:E5:F6\",\"wifi_bssid\":\"00:11:22:33:44:55\","
               "\"mqtt_connected\":1,\"mqtt_count\":89282,\"mqtt_fails\":0,\"mqtt_reconnects\":1,"
               "\"bus_connected\":1,\"bus_proto\":\"I\",\"bus_registers\":10,\"bus_values\":48,"
               "\"bus_last_ok_s\":1,\"bus_rx_received\":763732,\"bus_rx_fails\":2,"
               "\"bus_crc_err\":0,\"bus_timeout_err\":2,"
               "\"bus_tx_reads\":763734,\"bus_tx_writes\":0,\"bus_tx_fails\":0}");

    // Synced: "time" carries the RFC 3339 instant verbatim (the caller — mqtt_ha.cpp — already
    // rendered it via logic/timestamp.hpp; this header only decides null-vs-quoted).
    f.time = "2026-07-17T21:15:00.000Z";
    CHECK(build_heartbeat_json(f).find("\"reset_reason\":\"panic\",\"time\":\"2026-07-17T21:15:00.000Z\",")
          != std::string::npos);

    // WiFi down -> rssi/quality/bssid reported null, not a stale/garbage reading; mac still present.
    HeartbeatFields down;
    down.wifi_connected = false;
    down.wifi_rssi       = -50;    // stale value must not leak into the JSON
    down.wifi_mac        = "A1:B2:C3:D4:E5:F6";   // this STA's own MAC — known even while offline
    const std::string dj = build_heartbeat_json(down);
    CHECK(dj.find("\"wifi_rssi\":null") != std::string::npos);
    CHECK(dj.find("\"wifi_quality_pct\":null") != std::string::npos);
    CHECK(dj.find("\"wifi_mac\":\"A1:B2:C3:D4:E5:F6\"") != std::string::npos);
    CHECK(dj.find("\"wifi_bssid\":null") != std::string::npos);   // no AP while offline
    CHECK(dj.find("\"time\":null") != std::string::npos);   // never synced -> null, not 1970-01-01
    // The connectivity flags are 1/0 NUMBERS in both directions — never JSON bools, which a metrics
    // consumer drops exactly like it drops a string (these three were the only heartbeat fields
    // missing from VictoriaMetrics before this).
    CHECK(dj.find("\"wifi_connected\":0") != std::string::npos);
    CHECK(dj.find("\"mqtt_connected\":0") != std::string::npos);
    CHECK(dj.find("\"bus_connected\":0")  != std::string::npos);
    CHECK(dj.find("true")  == std::string::npos);
    CHECK(dj.find("false") == std::string::npos);

    // Diagnostic discovery: separate topics/component types, entity_category diagnostic, and the
    // value_template points at the heartbeat topic (not the heat-pump state topic).
    const std::string hb = heartbeat_topic(base);
    const std::string av = availability_topic(base);
    CHECK(HEARTBEAT_SENSOR_COUNT == 19);   // +2: wifi_mac, wifi_bssid
    const HeartbeatSensor& rssi = HEARTBEAT_SENSORS[0];
    CHECK(std::string(rssi.object_id) == "wifi_signal");
    std::string dt = heartbeat_discovery_topic("homeassistant", node, rssi);
    CHECK(dt == "homeassistant/sensor/daikin_altherma_esp32/wifi_signal/config");
    std::string dc = heartbeat_discovery_config(node, board, hb, av, rssi);
    CHECK(dc.find("\"stat_t\":\"daikin-altherma-esp32/heartbeat\"") != std::string::npos);
    CHECK(dc.find("\"val_tpl\":\"{{ value_json.wifi_rssi }}\"") != std::string::npos);   // flat key
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
          == "homeassistant/binary_sensor/daikin_altherma_esp32/bus_status/config");
    std::string busc = heartbeat_discovery_config(node, board, hb, av, *bus);
    CHECK(busc.find("val_tpl\":\"{{ value_json.bus_connected }}") != std::string::npos);   // flat key
    CHECK(busc.find("\"stat_cla\"") == std::string::npos);
    // ...and it must declare the 1/0 payload contract. Without this the entity inherits HA's "ON"/"OFF"
    // defaults, matches neither 1/0 nor the `True`/`False` a JSON bool rendered as, and sits at
    // `unknown` forever — silently, since a non-matching payload is simply ignored.
    CHECK(busc.find("\"pl_on\":\"1\",\"pl_off\":\"0\"") != std::string::npos);
    // A plain sensor must NOT carry the binary contract.
    CHECK(dc.find("\"pl_on\"") == std::string::npos);

    // A since-boot counter (e.g. mqtt_count) is "total_increasing", not "measurement" — HA's
    // long-term statistics then handle a reboot's reset to 0 correctly instead of reading it as a
    // (nonsensical) huge negative delta.
    const HeartbeatSensor* mc = nullptr;
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
        if (std::string(HEARTBEAT_SENSORS[i].object_id) == "mqtt_count") mc = &HEARTBEAT_SENSORS[i];
    CHECK(mc != nullptr);
    CHECK(heartbeat_discovery_config(node, board, hb, av, *mc).find("\"stat_cla\":\"total_increasing\"")
          != std::string::npos);

    // The three device-health entities added alongside /status.sys (issue #5): reset_reason is a
    // plain text sensor (no unit / device_class / state_class), min_free_heap + max_alloc are byte
    // measurements. All diagnostic, all sourced from the heartbeat topic. Count is 19, not 13.
    auto find_hb = [](const char* oid) -> const HeartbeatSensor* {
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
            if (std::string(HEARTBEAT_SENSORS[i].object_id) == oid) return &HEARTBEAT_SENSORS[i];
        return nullptr;
    };
    // wifi_mac / wifi_bssid: plain text diagnostics (no unit/device_class/state_class), read from the
    // flat wifi_ keys — which board, which AP.
    for (const char* oid : {"wifi_mac", "wifi_bssid"}) {
        const HeartbeatSensor* h = find_hb(oid);
        CHECK(h != nullptr);
        const std::string hc = heartbeat_discovery_config(node, board, hb, av, *h);
        CHECK(hc.find(std::string("\"val_tpl\":\"{{ value_json.") + oid + " }}\"") != std::string::npos);
        CHECK(hc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
        CHECK(hc.find("\"unit_of_meas\"") == std::string::npos);
        CHECK(hc.find("\"dev_cla\"") == std::string::npos);
        CHECK(hc.find("\"stat_cla\"") == std::string::npos);
    }
    const HeartbeatSensor* rr = find_hb("reset_reason");
    CHECK(rr != nullptr && std::string(rr->name) == "Reset Reason");
    const std::string rrc = heartbeat_discovery_config(node, board, hb, av, *rr);
    CHECK(rrc.find("\"val_tpl\":\"{{ value_json.reset_reason }}\"") != std::string::npos);
    CHECK(rrc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
    CHECK(rrc.find("\"unit_of_meas\"") == std::string::npos);   // text: no unit
    CHECK(rrc.find("\"dev_cla\"") == std::string::npos);        // ...no device_class
    CHECK(rrc.find("\"stat_cla\"") == std::string::npos);       // ...no state_class

    // device_time: HA's native "timestamp" device_class (renders as "N minutes ago", the one
    // HA-idiomatic use of the SNTP wall clock) — no unit, no state_class (not a numeric measurement).
    const HeartbeatSensor* dtm = find_hb("device_time");
    CHECK(dtm != nullptr);
    const std::string dtc = heartbeat_discovery_config(node, board, hb, av, *dtm);
    CHECK(dtc.find("\"val_tpl\":\"{{ value_json.time }}\"") != std::string::npos);
    CHECK(dtc.find("\"dev_cla\":\"timestamp\"") != std::string::npos);
    CHECK(dtc.find("\"unit_of_meas\"") == std::string::npos);
    CHECK(dtc.find("\"stat_cla\"") == std::string::npos);

    // Heap low-water mark + largest free block: bytes, "measurement" (a fluctuating gauge, NOT a
    // since-boot counter), diagnostic, sourced from the flat payload fields (not a nested object).
    for (const char* oid : {"min_free_heap", "max_alloc"}) {
        const HeartbeatSensor* h = find_hb(oid);
        CHECK(h != nullptr);
        const std::string hc = heartbeat_discovery_config(node, board, hb, av, *h);
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

    // ── Two reservations, not one ────────────────────────────────────────────────────────────────
    // The firmware now drives TWO pins of its own: the status indicator and the recovery button.
    // A ReservedPins carrying both must drop both; carrying one (the old single-int call shape,
    // which still compiles by design) must drop exactly that one.
    n = board_pins_offerable(buf, BOARD_PINS_MAX, /*octal_spi=*/false, ReservedPins{35, 41});
    CHECK(n == s3_quad.count - 1);                   // 41 was never in the X10A list (JTAG); 35 was
    for (int i = 0; i < n; i++) CHECK(buf[i] != 35 && buf[i] != 41);
    CHECK(!board_pin_offerable(35, false, ReservedPins{35, 41}));
    CHECK(!board_pin_offerable(21, false, ReservedPins{21}));           // implicit single-pin ctor
    CHECK(board_pin_offerable(21, false, ReservedPins{35, 41}));        // neither reservation matches
    // "nothing reserved" must not claim the -1 sentinel (parenthesised: a braced initialiser inside
    // a macro argument reads as two arguments).
    CHECK((ReservedPins{}.claims(-1)) == false);
    CHECK((ReservedPins{-1, -1}.claims(-1)) == false);
}

// The local-I/O set: which pins the status indicator and the recovery button may use. Deliberately
// WIDER than the X10A set by exactly the four dedicated-JTAG pads — the AtomS3 Lite's onboard button
// is on GPIO41, and withholding it would make that board's only button unusable to protect a debug
// probe that isn't attached. Everything the chip hard-reserves must still be refused.
static void test_board_pins_local() {
    CHECK(board_pin_local_io(41, /*octal_spi=*/false));    // AtomS3 Lite button (MTDI)
    CHECK(board_pin_local_io(39, false) && board_pin_local_io(40, false) && board_pin_local_io(42, false));
    CHECK(board_pin_local_io(35, false));                  // AtomS3 Lite WS2812, Quad-flash build
    CHECK(!board_pin_local_io(35, /*octal_spi=*/true));     // ...but a real Octal build reserves it
    CHECK(board_pin_local_io(21, false));                  // XIAO onboard LED
    CHECK(!board_pin_local_io(27, false));                 // SPI flash — a hard conflict, still out
    CHECK(!board_pin_local_io(0, false) && !board_pin_local_io(45, false));   // strapping
    CHECK(!board_pin_local_io(19, false) && !board_pin_local_io(20, false));  // USB-Serial/JTAG console

    int buf[BOARD_LOCAL_PINS_MAX];
    const int n = board_pins_local(buf, BOARD_LOCAL_PINS_MAX, /*octal_spi=*/false);
    CHECK(n == board_pins("esp32s3", false).count + 4);    // exactly the four JTAG pads added
    CHECK(n <= BOARD_LOCAL_PINS_MAX);                      // the constant really does size the buffer
    for (int i = 1; i < n; i++) CHECK(buf[i] > buf[i - 1]);   // strictly ascending — the UI renders it verbatim
    auto in_list = [&](int p) { for (int i = 0; i < n; i++) if (buf[i] == p) return true; return false; };
    CHECK(in_list(38) && in_list(39) && in_list(41) && in_list(42) && in_list(43));
    CHECK(!in_list(27) && !in_list(19));
    // The merge in board_pins_local assumes the two input lists are DISJOINT (no de-duplication).
    // If board_pins() ever gained a JTAG pad, the merge would emit it twice and break the ordering
    // assert above — pin the assumption itself so the failure names the cause.
    BoardPins base = board_pins("esp32s3", false);
    for (int i = 0; i < base.count; i++) CHECK(base.pins[i] < 39 || base.pins[i] > 42);
    // Every element of the list must itself pass the membership predicate, and vice versa.
    for (int i = 0; i < n; i++) CHECK(board_pin_local_io(buf[i], false));
    // Cap honoured, like board_pins_offerable.
    CHECK(board_pins_local(buf, 5, false) == 5);

    // ── The reservation runs in BOTH directions ──────────────────────────────────────────────────
    // board_pins_offerable() has always withheld the indicator's and the button's pins from the X10A
    // dropdown. The mirror was missing: the LED/button dropdowns still listed the X10A link's own
    // rx/tx, which board_hw_valid() then refuses ("… is in use by the X10A link") — a pick whose only
    // possible outcome is a 400. Pin both halves here, so neither can regress into a one-way rule.
    Config link;                                   // the shipped XIAO default pair
    link.rx_pin = 44; link.tx_pin = 43;
    const int nl = board_pins_local(buf, BOARD_LOCAL_PINS_MAX, false, config_link_pins(link));
    CHECK(nl == n - 2);                            // exactly the two link pins dropped
    auto in_local = [&](int p) { for (int i = 0; i < nl; i++) if (buf[i] == p) return true; return false; };
    CHECK(!in_local(44) && !in_local(43));
    CHECK(in_local(21) && in_local(35) && in_local(41));   // the onboard parts both boards use
    for (int i = 1; i < nl; i++) CHECK(buf[i] > buf[i - 1]);   // still strictly ascending after filtering
    // Nothing the filtered list offers can collide with the link — the property the UI depends on.
    for (int i = 0; i < nl; i++) {
        Config c = link;
        c.led_gpio = buf[i];
        c.btn_gpio = -1;
        std::string why;
        CHECK(board_hw_valid(c, why, 48, /*octal_spi=*/false));
    }
    // A link on a JTAG pad is not reachable through the UI (board_pin_offerable withholds 39-42) but
    // IS reachable by a raw POST /set_hp, so the filter must cover that pad too, not just the base set.
    Config jt;
    jt.rx_pin = 41; jt.tx_pin = 40;
    const int nj = board_pins_local(buf, BOARD_LOCAL_PINS_MAX, false, config_link_pins(jt));
    CHECK(nj == n - 2);
    for (int i = 0; i < nj; i++) CHECK(buf[i] != 41 && buf[i] != 40);
    // An unreserved call is unchanged — the default argument keeps every existing caller honest.
    CHECK(board_pins_local(buf, BOARD_LOCAL_PINS_MAX, false, ReservedPins{}) == n);
}

// The board-hardware presets the UI's "Board" dropdown fills its five fields from. The whole point
// of keeping this table in firmware rather than in www/app.js is that these CHECKs can run against
// the very validator POST /set_board applies — a preset that fills pins the device then rejects
// would be worse than no preset at all.
static void test_board_presets() {
    int all_n = 0;
    const BoardPreset* all = board_presets_all(all_n);
    CHECK(all_n == BOARD_PRESETS_MAX);          // the constant really does size a caller's buffer

    // EVERY preset must pass the request-path validator, on a build that reserves nothing extra.
    // This is the check the JS-side table could never have.
    for (int i = 0; i < all_n; i++) {
        Config c;
        c.rx_pin = c.tx_pin = -1;               // isolate: the X10A collision rule is tested below
        c.led_gpio = all[i].led_gpio; c.led_type = all[i].led_type;
        c.led_inverted = all[i].led_inverted;
        c.btn_gpio = all[i].btn_gpio; c.btn_active_low = all[i].btn_active_low;
        std::string why;
        CHECK(board_hw_valid(c, why, 48, /*octal_spi=*/false));
        CHECK(led_type_valid(all[i].led_type));
        CHECK(all[i].name != nullptr && all[i].name[0] != '\0');
    }
    // Names are what the user picks by, so they must be distinct — two "AtomS3 Lite" rows would make
    // the dropdown a coin toss.
    for (int i = 0; i < all_n; i++)
        for (int k = i + 1; k < all_n; k++) CHECK(std::string(all[i].name) != all[k].name);

    // The two documented boards, by their docs/BOARDS.md facts. Pinned as VALUES: this table is the
    // executed half of that doc, and a silent edit here is a user flashing the wrong pin.
    CHECK(std::string(all[0].name) == "M5Stack AtomS3 Lite");
    CHECK(all[0].led_gpio == 35 && all[0].led_type == 1 && !all[0].led_inverted);
    CHECK(all[0].btn_gpio == 41 && all[0].btn_active_low);
    CHECK(std::string(all[1].name) == "Seeed XIAO ESP32-S3");
    CHECK(all[1].led_gpio == 21 && all[1].led_type == 0 && all[1].led_inverted);
    CHECK(all[1].btn_gpio == -1);               // no button broken out — never guess a pin for one

    // The AtomS3 Lite's button sits on a dedicated-JTAG pad. That it is legal for board-local I/O but
    // NOT for the X10A picker is the exact asymmetry this preset depends on (board_pins.hpp).
    CHECK(board_pin_local_io(41, /*octal_spi=*/false));
    CHECK(!board_pin_offerable(41, /*octal_spi=*/false));

    // Offering is build-aware: GPIO35 is free on this project's Quad-flash build and is SPIIO4 on an
    // Octal one, so an Octal build withholds the AtomS3 Lite preset instead of offering a pick that
    // POST /set_board would refuse.
    const BoardPreset* buf[BOARD_PRESETS_MAX];
    int n = board_presets_offerable(buf, BOARD_PRESETS_MAX, /*octal_spi=*/false);
    CHECK(n == all_n);
    n = board_presets_offerable(buf, BOARD_PRESETS_MAX, /*octal_spi=*/true);
    CHECK(n == 1 && std::string(buf[0]->name) == "Seeed XIAO ESP32-S3");
    // Whatever survives the filter must still validate under the SAME build flag it was filtered by.
    for (int oct = 0; oct <= 1; oct++) {
        n = board_presets_offerable(buf, BOARD_PRESETS_MAX, oct != 0);
        for (int i = 0; i < n; i++) {
            Config c;
            c.rx_pin = c.tx_pin = -1;
            c.led_gpio = buf[i]->led_gpio; c.led_type = buf[i]->led_type;
            c.btn_gpio = buf[i]->btn_gpio;
            std::string why;
            CHECK(board_hw_valid(c, why, 48, oct != 0));
        }
    }
    // Cap honoured, like board_pins_offerable/board_pins_local.
    CHECK(board_presets_offerable(buf, 1, /*octal_spi=*/false) == 1);
    CHECK(board_presets_offerable(buf, 0, /*octal_spi=*/false) == 0);

    // Offering is also LINK-aware, the same mirror board_pins_local now applies to the two pin
    // dropdowns: a preset that collides with where the X10A link currently sits is withheld, because
    // board_hw_valid() would refuse it and a dropdown entry whose only outcome is a 400 is not a
    // pick. The AtomS3 Lite's WS2812 (GPIO35) against a link moved onto 35 is exactly that case.
    Config on35;
    on35.rx_pin = 35; on35.tx_pin = 44;
    n = board_presets_offerable(buf, BOARD_PRESETS_MAX, /*octal_spi=*/false, config_link_pins(on35));
    CHECK(n == 1 && std::string(buf[0]->name) == "Seeed XIAO ESP32-S3");
    // ...and its BUTTON pin counts too, not just the indicator.
    Config on41;
    on41.rx_pin = 41; on41.tx_pin = 44;
    n = board_presets_offerable(buf, BOARD_PRESETS_MAX, false, config_link_pins(on41));
    CHECK(n == 1 && std::string(buf[0]->name) == "Seeed XIAO ESP32-S3");
    // The shipped default link (44/43) collides with neither board, so both stay on offer.
    Config def;
    def.rx_pin = 44; def.tx_pin = 43;
    CHECK(board_presets_offerable(buf, BOARD_PRESETS_MAX, false, config_link_pins(def)) == all_n);
    // Whatever survives BOTH filters validates against that same link — the property the modal needs.
    for (const Config& link : {def, on35, on41}) {
        n = board_presets_offerable(buf, BOARD_PRESETS_MAX, false, config_link_pins(link));
        for (int i = 0; i < n; i++) {
            Config c = link;
            c.led_gpio = buf[i]->led_gpio; c.led_type = buf[i]->led_type;
            c.btn_gpio = buf[i]->btn_gpio;
            std::string why;
            CHECK(board_hw_valid(c, why, 48, /*octal_spi=*/false));
        }
    }

    // The request path stays the authority regardless: a preset applied onto a colliding link — via
    // a raw POST, or a link changed after the modal was filled — is still rejected, with the link
    // named. Withholding it from the dropdown is the courtesy; this is the guarantee.
    Config c;
    c.rx_pin = 35; c.tx_pin = 44;
    c.led_gpio = all[0].led_gpio; c.led_type = all[0].led_type;
    c.btn_gpio = all[0].btn_gpio;
    std::string why;
    CHECK(!board_hw_valid(c, why, 48, /*octal_spi=*/false));
    CHECK(why.find("X10A") != std::string::npos);
}

// The status indicator's state -> pattern rule, shared by the GPIO and WS2812 back-ends.
static void test_led_pattern() {
    LedInputs in;
    // No WiFi mode at all -> dark.
    CHECK(led_phase(in) == LedPhase::Off);
    // SoftAP (setup portal) wins over everything below it — APSTA counts as AP, as it did before.
    in.ap_mode = true;
    CHECK(led_phase(in) == LedPhase::SetupPortal);
    in.ap_mode = false;

    in.sta_mode = true;
    CHECK(led_phase(in) == LedPhase::Connecting);            // associated? not yet
    in.wifi_connected = true;
    CHECK(led_phase(in) == LedPhase::BusDown);               // WiFi up, X10A silent
    in.hp_connected = true;
    CHECK(led_phase(in) == LedPhase::Healthy);               // MQTT unconfigured is NOT a fault
    in.mqtt_configured = true;
    CHECK(led_phase(in) == LedPhase::MqttDown);
    in.mqtt_connected = true;
    CHECK(led_phase(in) == LedPhase::Healthy);
    // X10A-down outranks MQTT-down: with BOTH down the bus fault is what shows.
    in.mqtt_connected = false;
    in.hp_connected   = false;
    CHECK(led_phase(in) == LedPhase::BusDown);

    // The button's override pre-empts every operating phase — including Healthy, which is the
    // NORMAL state of a board someone is deliberately factory-resetting. Gating the warning on a
    // fault would hide it in exactly the case it exists for.
    LedInputs healthy;
    healthy.sta_mode = healthy.wifi_connected = healthy.hp_connected = true;
    CHECK(led_phase(healthy) == LedPhase::Healthy);
    healthy.signal = LedSignal::WipeArmed;
    CHECK(led_phase(healthy) == LedPhase::WipeArmed);
    healthy.signal = LedSignal::Wiping;
    CHECK(led_phase(healthy) == LedPhase::Wiping);
    // ...and over the setup portal / a disconnected board too (no WiFi state can suppress it).
    LedInputs dark;
    dark.signal = LedSignal::Wiping;
    CHECK(led_phase(dark) == LedPhase::Wiping);

    // Every phase must produce a pattern with a non-zero period: a zero-length one would spin the
    // indicator task at 100% CPU instead of blinking.
    for (LedPhase p : {LedPhase::Off, LedPhase::SetupPortal, LedPhase::Connecting, LedPhase::Healthy,
                       LedPhase::BusDown, LedPhase::MqttDown, LedPhase::WipeArmed, LedPhase::Wiping})
        CHECK(led_pattern_period_ms(led_pattern(p)) > 0);

    // The six operating patterns keep the exact timings the pre-refactor status_led.cpp shipped —
    // this split must not silently re-teach a user's board a new vocabulary.
    CHECK(led_pattern(LedPhase::SetupPortal).on_ms == 1000 && led_pattern(LedPhase::SetupPortal).off_ms == 1000);
    CHECK(led_pattern(LedPhase::Connecting).on_ms == 100 && led_pattern(LedPhase::Connecting).off_ms == 100);
    CHECK(led_pattern(LedPhase::MqttDown).on_ms == 300 && led_pattern(LedPhase::MqttDown).off_ms == 300);
    const LedPattern bus = led_pattern(LedPhase::BusDown);
    CHECK(bus.pulses == 2 && bus.on_ms == 120 && bus.off_ms == 150 && bus.gap_ms == 1000);
    CHECK(led_pattern(LedPhase::Off).pulses == 0);

    // Shape, not colour, has to carry the state — a monochrome LED sees no colour at all. Exactly
    // two phases are solid (Healthy and Wiping); see led_phase_is_solid's note for why that pair is
    // safe. Everything else must be distinguishable by blink timing.
    int solid = 0;
    for (LedPhase p : {LedPhase::Off, LedPhase::SetupPortal, LedPhase::Connecting, LedPhase::Healthy,
                       LedPhase::BusDown, LedPhase::MqttDown, LedPhase::WipeArmed, LedPhase::Wiping})
        if (led_phase_is_solid(p)) solid++;
    CHECK(solid == 2);
    CHECK(led_phase_is_solid(LedPhase::Healthy) && led_phase_is_solid(LedPhase::Wiping));
    // The armed strobe must be strictly faster than every operating blink, or "something is
    // counting down" reads as ordinary activity.
    const LedPattern armed = led_pattern(LedPhase::WipeArmed);
    CHECK(armed.on_ms < led_pattern(LedPhase::Connecting).on_ms);
    // led_type round-trips through the int the config blob stores it as.
    CHECK(led_type_valid(0) && led_type_valid(1));
    CHECK(!led_type_valid(2) && !led_type_valid(-1));
}

// The recovery button's press classifier. What is really under test is the ABORT path: the action
// it gates erases the user's whole configuration, so "held 4.9 s then let go" must destroy nothing.
static void test_button() {
    ButtonState st;
    uint64_t t = 0;
    auto step = [&](bool pressed, uint64_t dt) { t += dt; return button_update(st, pressed, t); };

    // A short press does nothing at all — not even an indicator hand-back (nothing was asserted).
    CHECK(step(true, 20) == ButtonEvent::None);
    CHECK(step(true, 200) == ButtonEvent::None);
    for (int i = 0; i < BUTTON_RELEASE_SAMPLES; i++) step(false, 20);
    CHECK(!st.down && !st.armed);

    // A full hold: Armed at the checkpoint, then Fired — each exactly once, even though the
    // predicate stays true for every later sample of the hold.
    st = ButtonState{};
    t = 0;
    CHECK(step(true, 20) == ButtonEvent::None);
    CHECK(step(true, BUTTON_ARM_MS - 100) == ButtonEvent::None);       // not there yet
    CHECK(step(true, 200) == ButtonEvent::Armed);
    CHECK(step(true, 20) == ButtonEvent::None);                        // ...and not again
    int armed_again = 0, fired = 0;
    while (t < BUTTON_FIRE_MS + 500) {
        const ButtonEvent e = step(true, BUTTON_SAMPLE_MS);
        if (e == ButtonEvent::Armed) armed_again++;
        if (e == ButtonEvent::Fired) fired++;
    }
    CHECK(armed_again == 0 && fired == 1);

    // ABORT: released after the warning but before the threshold -> Aborted, and NOTHING fired.
    st = ButtonState{};
    t = 0;
    step(true, 20);
    CHECK(step(true, BUTTON_ARM_MS) == ButtonEvent::Armed);
    step(true, BUTTON_FIRE_MS - BUTTON_ARM_MS - 200);                  // right up to the edge
    CHECK(!st.fired);
    CHECK(step(false, 20) == ButtonEvent::None);                       // debouncing, not yet a release
    CHECK(step(false, 20) == ButtonEvent::None);
    CHECK(step(false, 20) == ButtonEvent::Aborted);                    // third consecutive sample
    CHECK(!st.down && !st.armed && !st.fired);

    // A single stray released sample mid-hold is BOUNCE, not a release: it must neither cancel the
    // hold nor restart its clock, or a user holding the button through a noisy contact would get a
    // silent abort with nothing on screen to explain it.
    st = ButtonState{};
    t = 0;
    step(true, 20);
    const uint64_t started = st.down_at_ms;
    step(true, 1000);
    CHECK(step(false, 20) == ButtonEvent::None);                       // one bad sample
    CHECK(st.down && st.down_at_ms == started);                        // hold intact, clock unchanged
    step(true, 20);
    CHECK(st.release_run == 0);                                        // the bounce counter reset
    CHECK(step(true, BUTTON_ARM_MS) == ButtonEvent::Armed);            // and the hold still counts from `started`

    // A coarse sample period that crosses both thresholds at once fires: the user held it long
    // enough, and reporting Armed first would just delay what they asked for by a whole sample.
    st = ButtonState{};
    t = 0;
    step(true, 20);
    CHECK(step(true, BUTTON_FIRE_MS + 1000) == ButtonEvent::Fired);

    // Released while idle stays silent no matter how long.
    st = ButtonState{};
    for (int i = 0; i < 50; i++) CHECK(step(false, 100) == ButtonEvent::None);

    // A release AFTER firing is not an "abort" — there is nothing left to abort, and the caller has
    // already rebooted in the normal case.
    st = ButtonState{};
    t = 0;
    step(true, 20);
    step(true, BUTTON_FIRE_MS + 100);
    CHECK(st.fired);
    step(false, 20); step(false, 20);
    CHECK(step(false, 20) == ButtonEvent::None);

    // Thresholds are ordered and the arm point leaves real time to react.
    CHECK(BUTTON_ARM_MS < BUTTON_FIRE_MS);
    CHECK(BUTTON_FIRE_MS - BUTTON_ARM_MS >= 2000);
    CHECK(BUTTON_RELEASE_SAMPLES * BUTTON_SAMPLE_MS < BUTTON_ARM_MS);   // debounce can't eat the warning
}

static void test_crashinfo() {
    const std::string base = "daikin-altherma-esp32", node = device_node_id(base),
                      board = "daikin_abc123";   // installation id + this board's own id

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

    // The RETAINED <base>/crash MQTT payload is crash-ONLY: it carries the crash JSON when the boot
    // is notable, and "" otherwise. The caller publishes "" as a zero-length retained message, which
    // CLEARS the topic — so a normal boot sends no crash message and a stale crash record disappears
    // once the device reboots cleanly (the problem resolved). Reset reason is not lost: the heartbeat
    // carries it independently (parity asserted in test_boot_guard: reset_reason_name==crash_reason_slug).
    CHECK(build_crash_mqtt_payload(clean).empty());       // config-save/OTA reboot -> clear
    CHECK(build_crash_mqtt_payload(usb_replug).empty());  // USB re-enumeration -> clear
    CHECK(build_crash_mqtt_payload(orphan) == build_crash_json(orphan));            // dump waiting -> report
    CHECK(build_crash_mqtt_payload(fault_cleared) == build_crash_json(fault_cleared)); // fault sans dump -> report

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
    CHECK(build_crash_mqtt_payload(panic) == build_crash_json(panic));   // notable -> full report

    // bt_depth is clamped to the 16-entry buffer (a corrupt summary can over-report it).
    CrashInfo over = panic;
    over.bt_depth = 99;
    const std::string oj = build_crash_json(over);
    CHECK(oj.find("0x00000000") != std::string::npos);   // zero-filled tail entries, not OOB reads
    size_t cnt = 0, at = 0;
    while ((at = oj.find("0x", at)) != std::string::npos) { cnt++; at += 2; }
    CHECK(cnt == 1 /*pc*/ + 16 /*bt[16]*/);

    // Crash topic + its ONE diagnostic HA entity (the coredump "problem" binary_sensor). The reset
    // reason is NOT a crash entity — it is the heartbeat's own "Reset Reason" sensor, so a crash entity
    // for it would be an exact duplicate; it was dropped and is now actively retired (below).
    CHECK(crash_topic(base) == "daikin-altherma-esp32/crash");   // node NOT in the message topic
    const std::string ct = crash_topic(base);
    const std::string av = availability_topic(base);
    CHECK(CRASH_SENSOR_COUNT == 1);

    const CrashSensor& dump = CRASH_SENSORS[0];
    CHECK(std::string(dump.component) == "binary_sensor");
    CHECK(std::string(dump.object_id) == "coredump");
    CHECK(crash_discovery_topic("homeassistant", node, dump)
          == "homeassistant/binary_sensor/daikin_altherma_esp32/coredump/config");
    const std::string dc = crash_discovery_config(node, board, ct, av, dump);
    CHECK(dc.find("\"stat_t\":\"daikin-altherma-esp32/crash\"") != std::string::npos);
    CHECK(dc.find("\"val_tpl\":\"{{ value_json.coredump | lower }}\"") != std::string::npos);
    CHECK(dc.find("\"pl_on\":\"true\",\"pl_off\":\"false\"") != std::string::npos);
    CHECK(dc.find("\"dev_cla\":\"problem\"") != std::string::npos);
    CHECK(dc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);

    // No crash entity publishes the reset reason any more (it duplicated the heartbeat's).
    for (int i = 0; i < CRASH_SENSOR_COUNT; i++)
        CHECK(std::string(CRASH_SENSORS[i].object_id) != "last_reset");

    // The retired "Last Reset Reason" sensor: its discovery config must be actively DELETED on
    // upgrade (the device publishes a zero-length RETAINED message to this exact topic), or an old
    // install keeps a stale, permanently-unavailable entity forever. The 2-arg topic builder used to
    // clear it must match the 3-arg one that once created it.
    CHECK(RETIRED_CRASH_SENSOR_COUNT == 1);
    const RetiredHaSensor& retired = RETIRED_CRASH_SENSORS[0];
    CHECK(std::string(retired.component) == "sensor");
    CHECK(std::string(retired.object_id) == "last_reset");
    CHECK(crash_discovery_topic("homeassistant", retired.component, node, retired.object_id)
          == "homeassistant/sensor/daikin_altherma_esp32/last_reset/config");
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
    // The parse is request-bound: pass the address + quantity that were requested (addr is unused for
    // reads — a read reply doesn't echo it — but the register count MUST match the requested qty=3).
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, /*addr*/40, /*qty*/3, r) == MbParse::Ok);
    CHECK(r.ok && !r.exception && r.txn == 7 && r.unit == 1 && r.fc == 0x03);
    CHECK(mb_reg_count(r) == 3);
    uint16_t rv = 0;
    CHECK(mb_reg_at(r, 0, rv) && rv == 0x07D0);     // 2000
    CHECK(mb_reg_at(r, 1, rv) && rv == 0xFB2E);     // -1234
    CHECK(mb_reg_at(r, 2, rv) && rv == 0x7FFE);     // 32766 (unavailable sentinel)
    CHECK(!mb_reg_at(r, 3, rv));                    // out-of-range index rejected
    // Asking for a different quantity than the reply carries is a desync (QtyMismatch), not Ok.
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, 40, 2, r) == MbParse::QtyMismatch);
    CHECK(!r.ok);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, 40, 4, r) == MbParse::QtyMismatch);

    // ── Parse a write-single echo (FC06): addr 0x37, value 0x07D0 ──
    uint8_t wecho[] = {0x00,0x42, 0x00,0x00, 0x00,0x06, 0x01, 0x06, 0x00,0x37, 0x07,0xD0};
    CHECK(mb_parse_response(wecho, sizeof(wecho), 0x42, 1, MbFunc::WriteSingle, /*addr*/0x37, /*value*/0x07D0, r) == MbParse::Ok);
    CHECK(r.ok && r.fc == 0x06 && r.echo_addr == 0x37 && r.echo_value == 0x07D0);   // echo exposed
    // The echo must match the request: a different echoed address or value is EchoMismatch, never a
    // confirmed write (the hub acted on a register/value we didn't ask for).
    CHECK(mb_parse_response(wecho, sizeof(wecho), 0x42, 1, MbFunc::WriteSingle, 0x38, 0x07D0, r) == MbParse::EchoMismatch);
    CHECK(!r.ok);
    CHECK(mb_parse_response(wecho, sizeof(wecho), 0x42, 1, MbFunc::WriteSingle, 0x37, 0x07D1, r) == MbParse::EchoMismatch);
    // FC16 write-multiple echo [fc, addr(2), qty(2)]: addr 56, qty 2.
    uint8_t wmecho[] = {0x00,0x01, 0x00,0x00, 0x00,0x06, 0x01, 0x10, 0x00,0x38, 0x00,0x02};
    CHECK(mb_parse_response(wmecho, sizeof(wmecho), 1, 1, MbFunc::WriteMultiple, /*addr*/56, /*qty*/2, r) == MbParse::Ok);
    CHECK(r.ok && r.echo_addr == 56 && r.echo_value == 2);
    CHECK(mb_parse_response(wmecho, sizeof(wmecho), 1, 1, MbFunc::WriteMultiple, 56, 3, r) == MbParse::EchoMismatch);   // qty
    // A write echo is exactly [fc, addr(2), value|qty(2)]; a truncated one is Malformed, not Ok.
    uint8_t wshort[] = {0x00,0x42, 0x00,0x00, 0x00,0x04, 0x01, 0x06, 0x00,0x37};
    CHECK(mb_parse_response(wshort, sizeof(wshort), 0x42, 1, MbFunc::WriteSingle, 0x37, 0x07D0, r) == MbParse::Malformed);
    CHECK(!r.ok);

    // ── Parse a Modbus exception response (FC03 | 0x80, code 0x02 = illegal data address) ──
    uint8_t exc[] = {0x00,0x07, 0x00,0x00, 0x00,0x03, 0x01, 0x83, 0x02};
    CHECK(mb_parse_response(exc, sizeof(exc), 7, 1, MbFunc::ReadHolding, /*addr*/0, /*qty*/1, r) == MbParse::Exception);
    CHECK(!r.ok && r.exception && r.exc_code == 0x02 && r.fc == 0x03);
    // An exception PDU with a TRAILING byte (len bumped to 4, an extra 0x00) must be Malformed — the
    // old `pdu_len < 2` check accepted [fc|0x80, code, <junk>] as a clean exception.
    uint8_t exctrail[] = {0x00,0x07, 0x00,0x00, 0x00,0x04, 0x01, 0x83, 0x02, 0x00};
    CHECK(mb_parse_response(exctrail, sizeof(exctrail), 7, 1, MbFunc::ReadHolding, 0, 1, r) == MbParse::Malformed);

    // ── Parse-error paths ──
    CHECK(mb_parse_response(resp, 5, 7, 1, MbFunc::ReadHolding, 40, 3, r) == MbParse::TooShort);
    uint8_t badproto[] = {0x00,0x07, 0x00,0x01, 0x00,0x03, 0x01, 0x03, 0x00};  // proto id != 0
    CHECK(mb_parse_response(badproto, sizeof(badproto), 7, 1, MbFunc::ReadHolding, 40, 3, r) == MbParse::BadProtocol);
    uint8_t badlen[] = {0x00,0x07, 0x00,0x00, 0x00,0x09, 0x01, 0x03, 0x00};    // len 9 != actual
    CHECK(mb_parse_response(badlen, sizeof(badlen), 7, 1, MbFunc::ReadHolding, 40, 3, r) == MbParse::BadLength);
    CHECK(mb_parse_response(resp, sizeof(resp), 8, 1, MbFunc::ReadHolding, 40, 3, r) == MbParse::TxnMismatch);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 2, MbFunc::ReadHolding, 40, 3, r) == MbParse::UnitMismatch);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadInput, 40, 3, r) == MbParse::FcMismatch);
    // Consistent MBAP length (6 = unit + 5-byte PDU) but an odd register byte count (3) -> Malformed.
    uint8_t oddbc[] = {0x00,0x07, 0x00,0x00, 0x00,0x06, 0x01, 0x03, 0x03, 0x01,0x02,0x03};
    CHECK(mb_parse_response(oddbc, sizeof(oddbc), 7, 1, MbFunc::ReadHolding, 40, 3, r) == MbParse::Malformed);

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

// ── RFC 3339 UTC timestamp formatting (logic/timestamp.hpp) ─────────────────────────────────
static void test_timestamp() {
    // The Unix epoch itself — the one instant every implementation agrees on without a reference
    // library, so it doubles as a sanity check on the leap-year/month-length math in gmtime_r.
    CHECK(rfc3339_utc(0) == "1970-01-01T00:00:00.000Z");
    // A known instant with a non-trivial date/time (cross-checked against `date -u -d @...`).
    CHECK(rfc3339_utc(1700000000) == "2023-11-14T22:13:20.000Z");
    // Millisecond formatting: zero-padded to 3 digits, not truncated/rounded.
    CHECK(rfc3339_utc(1700000000, 7) == "2023-11-14T22:13:20.007Z");
    CHECK(rfc3339_utc(1700000000, 999) == "2023-11-14T22:13:20.999Z");
    // A leap-year Feb 29 and a year boundary — both exercise gmtime_r's calendar math, not just the
    // snprintf formatting.
    CHECK(rfc3339_utc(1709208296) == "2024-02-29T12:04:56.000Z");   // 2024 is a leap year
    CHECK(rfc3339_utc(1735689599) == "2024-12-31T23:59:59.000Z");
    // "Never synced" (sntp_time.cpp's time_now() sentinel) must render as empty, never as a
    // plausible-looking 1970-01-01 — a caller forwarding this straight into the RFC 5424 TIMESTAMP
    // field falls back to "-" (the NILVALUE) exactly because this is "" rather than the epoch.
    CHECK(rfc3339_utc(-1) == "");
    CHECK(rfc3339_utc(-1000) == "");
    // Out-of-range ms clamps rather than corrupting the format string.
    CHECK(rfc3339_utc(0, -5) == "1970-01-01T00:00:00.000Z");
    CHECK(rfc3339_utc(0, 5000) == "1970-01-01T00:00:00.999Z");
}

// ── raw page hex rendering (logic/hexdump.hpp) ───────────────────────────────────────────────
static void test_hexdump() {
    char out[128];

    // Basic rendering: lowercase, space-separated, no trailing space. The return value is the
    // character count WITHOUT the terminator, so a caller can compare it against the 3*len-1 a
    // complete dump needs to detect truncation.
    const uint8_t p[] = {0xA0, 0x00, 0x1F, 0xFF};
    CHECK(hex_render(p, 4, out, sizeof(out)) == 11);
    CHECK(std::string(out) == "a0 00 1f ff");

    // A single byte gets no leading space.
    CHECK(hex_render(p, 1, out, sizeof(out)) == 2);
    CHECK(std::string(out) == "a0");

    // Leading zeros are preserved — a page payload is read positionally, so "0f" must not print
    // as "f" or the offsets shift for whoever reads the dump.
    const uint8_t z[] = {0x00, 0x0F, 0x09};
    hex_render(z, 3, out, sizeof(out));
    CHECK(std::string(out) == "00 0f 09");

    // Truncation stops after the last COMPLETE byte and still terminates: a trailing nibble would
    // read as a different value entirely. "a0 00 1f" is 8 chars + NUL = 9, so a 9-byte buffer holds
    // exactly three bytes and must not begin a fourth (which would need 12).
    CHECK(hex_render(p, 4, out, 9) == 8);
    CHECK(std::string(out) == "a0 00 1f");
    // One char less and the third byte no longer fits with its separator + NUL, so it is dropped
    // whole rather than emitting "a0 00 1" — the half-byte a naive bound would leave behind.
    CHECK(hex_render(p, 4, out, 8) == 5);
    CHECK(std::string(out) == "a0 00");

    // Degenerate inputs must terminate the buffer rather than leave it unwritten — the caller
    // passes `out` straight into a diag_printf %s, so an untouched buffer would print stack garbage.
    out[0] = 'X';
    CHECK(hex_render(nullptr, 4, out, sizeof(out)) == 0);
    CHECK(out[0] == '\0');
    out[0] = 'X';
    CHECK(hex_render(p, 0, out, sizeof(out)) == 0);
    CHECK(out[0] == '\0');
    out[0] = 'X';
    CHECK(hex_render(p, -1, out, sizeof(out)) == 0);
    CHECK(out[0] == '\0');
    // A zero/negative-sized buffer must write nothing at all (not even the terminator).
    out[0] = 'X';
    CHECK(hex_render(p, 4, out, 0) == 0);
    CHECK(out[0] == 'X');
    CHECK(hex_render(p, 4, nullptr, sizeof(out)) == 0);
    // A 1-char buffer holds only the terminator — no room for even one pair.
    CHECK(hex_render(p, 4, out, 1) == 0);
    CHECK(out[0] == '\0');

    // The real call path: a full 32-byte page payload renders to 95 chars and fits hp_detect's
    // 104-byte buffer complete — i.e. the on-device dump is never truncated.
    uint8_t page[32];
    for (int i = 0; i < 32; i++) page[i] = static_cast<uint8_t>(i);
    char big[104];
    CHECK(hex_render(page, 32, big, sizeof(big)) == 95);
    CHECK(std::string(big).substr(0, 11) == "00 01 02 03");
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

// ── captive-portal reply policy (logic/captive.hpp) ──────────────────────────────────────────
static void test_captive() {
    // SETUP MODE (SoftAP live). The OS connectivity probes are the whole point: each must get the
    // 302 that its captive-portal agent recognises, NOT the 200 + gzipped setup page that used to be
    // served here and left the portal silently un-popped.
    CHECK(captive_reply_for("/hotspot-detect.html", true)   == CaptiveReply::Redirect);  // iOS/macOS
    CHECK(captive_reply_for("/generate_204", true)          == CaptiveReply::Redirect);  // Android
    CHECK(captive_reply_for("/connecttest.txt", true)       == CaptiveReply::Redirect);  // Windows
    CHECK(captive_reply_for("/ncsi.txt", true)              == CaptiveReply::Redirect);  // Windows (legacy)
    CHECK(captive_reply_for("/success.txt", true)           == CaptiveReply::Redirect);  // Firefox
    CHECK(captive_reply_for("/favicon.ico", true)           == CaptiveReply::Redirect);

    // ...but the portal root itself must SERVE the page, or following that redirect loops forever.
    CHECK(captive_reply_for("/", true)           == CaptiveReply::Page);
    CHECK(captive_reply_for("/index.html", true) == CaptiveReply::Page);

    // STA MODE: this same catch-all is the dashboard's SPA shell. Redirecting here would break every
    // deep link — and unlike a portal that stops popping, nobody reports it as a captive-portal bug.
    CHECK(captive_reply_for("/", false)                   == CaptiveReply::Page);
    CHECK(captive_reply_for("/index.html", false)         == CaptiveReply::Page);
    CHECK(captive_reply_for("/hotspot-detect.html", false) == CaptiveReply::Page);
    CHECK(captive_reply_for("/anything/at/all", false)    == CaptiveReply::Page);

    // The four advertisements of the portal address must agree, or the redirect points somewhere
    // the DNS never answers for and nothing on the device would notice. The octets feed the DNS
    // A-record RDATA and the SoftAP's own DHCP address; the string feeds the Location header and
    // the RFC 8910 option-114 payload.
    CHECK(std::string(CAPTIVE_PORTAL_URI) == "http://" + std::string(CAPTIVE_PORTAL_IP) + "/");
    CHECK(std::to_string(CAPTIVE_PORTAL_OCTETS[0]) + "." + std::to_string(CAPTIVE_PORTAL_OCTETS[1]) +
          "." + std::to_string(CAPTIVE_PORTAL_OCTETS[2]) + "." + std::to_string(CAPTIVE_PORTAL_OCTETS[3])
          == std::string(CAPTIVE_PORTAL_IP));
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

// ── /events async-send backpressure (logic/ws_tx_gate.hpp) ──────────────────────────────────
static void test_ws_tx_gate() {
    WsTxGate values;
    WsTxGate status;

    CHECK(!values.in_flight());
    CHECK(values.try_begin());
    CHECK(values.in_flight());

    // A stalled completion callback cannot admit another payload on the same stream.
    CHECK(!values.try_begin());
    CHECK(values.in_flight());

    // Values and status use independent gates: a slow values frame must not suppress every status
    // update, while each stream still retains at most one payload batch.
    CHECK(status.try_begin());
    CHECK(status.in_flight());

    values.complete();
    CHECK(!values.in_flight());
    CHECK(values.try_begin());
    values.complete();
    status.complete();
    CHECK(!values.in_flight());
    CHECK(!status.in_flight());
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

static void test_uart_plan() {
    CHECK(uart_plan(false, -1, -1, 44, 43) == UartAction::Install);   // cold start
    // Re-probing the SAME pins is a Noop — no delete, no reinstall, no heap.
    CHECK(uart_plan(true, 44, 43, 44, 43) == UartAction::Noop);
    // THE fix: the sweep's {44,43}<->{43,44} alternation is a genuine change -> Remap (uart_set_pin
    // only), NOT Install. This turns ~2 reinstalls/second into zero heap allocations.
    CHECK(uart_plan(true, 44, 43, 43, 44) == UartAction::Remap);
    CHECK(uart_plan(true, 43, 44, 44, 43) == UartAction::Remap);
    // A one-sided change (only rx, or only tx) is a Remap, never a false Noop.
    CHECK(uart_plan(true, 44, 43, 44, 40) == UartAction::Remap);
    CHECK(uart_plan(true, 44, 43, 40, 43) == UartAction::Remap);
    // Not-inited always installs, regardless of stale pin memory from a prior session.
    CHECK(uart_plan(false, 44, 43, 44, 43) == UartAction::Install);
}

static void test_detect_backoff() {
    // WIRED common case: through the grace window the interval stays at the floor, so backoff never
    // delays a bus that answers early.
    CHECK(detect_backoff_interval_s(0) == DETECT_MIN_INTERVAL_S);
    CHECK(detect_backoff_interval_s(DETECT_BACKOFF_AFTER) == DETECT_MIN_INTERVAL_S);    // still floor
    CHECK(detect_backoff_interval_s(DETECT_BACKOFF_AFTER + 1) > DETECT_MIN_INTERVAL_S); // then it grows
    CHECK(detect_backoff_interval_s(1000000) == DETECT_MAX_INTERVAL_S);                 // shift guard: no UB
    int prev = 0;                                                                       // monotonic, clamped
    for (int n = 0; n < 200; n++) {
        const int v = detect_backoff_interval_s(n);
        CHECK(v >= DETECT_MIN_INTERVAL_S && v <= DETECT_MAX_INTERVAL_S && v >= prev);
        prev = v;
    }
    CHECK(DETECT_MAX_INTERVAL_S > DETECT_MIN_INTERVAL_S * 4);   // a material stretch, not a nudge
    // step(): full cadence through the grace window, then back off, and a fingerprint resets at once.
    DetectBackoff s;
    for (int i = 0; i < DETECT_BACKOFF_AFTER; i++)
        CHECK(detect_backoff_step(s, false) == DETECT_MIN_INTERVAL_S);
    CHECK(s.silent == DETECT_BACKOFF_AFTER);
    CHECK(detect_backoff_step(s, false) > DETECT_MIN_INTERVAL_S);   // silent past grace -> grows
    CHECK(detect_backoff_step(s, true) == DETECT_MIN_INTERVAL_S);   // a swapped-in unit is swept at once
    CHECK(s.silent == 0);
    // Saturation: no overflow however long the bus stays silent; interval pinned at the ceiling.
    for (int i = 0; i < 10000; i++) detect_backoff_step(s, false);
    CHECK(s.silent == DETECT_SILENT_MAX);
    CHECK(detect_backoff_step(s, false) == DETECT_MAX_INTERVAL_S);
}

// ── OTA downgrade gate (logic/version_cmp.hpp) ───────────────────────────────────────────────
static void test_version_cmp() {
    // The ordering the whole gate rests on: numeric, not lexical. A strcmp would call 1.9.0 the
    // newer build and strand every device one release short, forever.
    CHECK(version_compare("1.10.0", "1.9.0") > 0);
    CHECK(version_compare("1.9.0", "1.10.0") < 0);
    CHECK(version_compare("2.0.0", "1.99.99") > 0);
    CHECK(version_compare("1.0.0", "1.0.0") == 0);
    CHECK(version_compare("1.0", "1.0.0") == 0);       // missing segments read as 0
    CHECK(version_compare("1.0.1", "1.0.0") > 0);

    // The gate itself: strictly newer only. Equal and older are refused — a signature proves a
    // build is authentic, not that it is newer, so an authentically-signed OLD image must not pass.
    CHECK(ota_is_upgrade("1.0.0", "1.0.1"));
    CHECK(ota_is_upgrade("1.9.0", "1.10.0"));
    CHECK(!ota_is_upgrade("1.0.0", "1.0.0"));          // equal -> no update, no reboot loop
    CHECK(!ota_is_upgrade("1.0.1", "1.0.0"));          // older -> the downgrade attack
    CHECK(!ota_is_upgrade("2.0.0", "1.99.99"));

    // Fails CLOSED. "We could not parse it" must never be answered the same way as "it is newer":
    // an empty manifest field, an HTML error page a broken host served, a NUL version.
    CHECK(!ota_is_upgrade("1.0.0", ""));
    CHECK(!ota_is_upgrade("", "1.0.1"));
    CHECK(!ota_is_upgrade("1.0.0", "unknown"));
    CHECK(!ota_is_upgrade("1.0.0", "<!DOCTYPE html>"));
    CHECK(!version_valid("") && !version_valid("v") && !version_valid("abc"));
    CHECK(version_valid("1") && version_valid("1.0.0") && version_valid("v1.0.0"));
    CHECK(!version_valid(".1") && !version_valid("1.") && !version_valid("1..0"));
    CHECK(!version_valid("1.2.3.4.5"));             // comparer intentionally supports at most 4
    CHECK(!version_valid("1.0.0-") && !version_valid("1.0.0-dev."));
    CHECK(!version_valid("1.0.0+") && !version_valid("1.0.0+build+again"));

    // A git tag pasted into the manifest ("v1.0.1"). Without the 'v' skip its core parses as 0 and
    // it compares BELOW every real version — a silent, permanent refusal to ever update.
    CHECK(ota_is_upgrade("1.0.0", "v1.0.1"));
    CHECK(!ota_is_upgrade("1.0.1", "v1.0.0"));
    CHECK(version_compare("v1.0.0", "1.0.0") == 0);

    // Semver pre-release ordering, and the case that matters: a pre-release of the version we
    // already run is NOT an upgrade.
    CHECK(version_compare("1.0.0-rc1", "1.0.0") < 0);
    CHECK(!ota_is_upgrade("1.0.0", "1.0.0-rc1"));
    CHECK(ota_is_upgrade("1.0.0", "1.0.1-rc1"));       // pre-release of a NEWER version still is
    CHECK(version_compare("1.0.0-rc2", "1.0.0-rc1") > 0);
    // A local git-describe build ("1.0.0-3-gabc123") still accepts the next real release.
    CHECK(ota_is_upgrade("1.0.0-3-gabc123", "1.0.1"));
    // Build metadata identifies an artifact but does not change SemVer precedence. Treating it as
    // a pre-release could permit a same-version reinstall and reboot loop.
    CHECK(version_valid("1.0.0+build.1"));
    CHECK(version_compare("1.0.0+build.2", "1.0.0+build.1") == 0);
    CHECK(version_compare("1.0.0-rc.1+build.2", "1.0.0-rc.1+build.1") == 0);
    CHECK(!ota_is_upgrade("1.0.0+build.1", "1.0.0+build.2"));

    // A hostile 400-digit version must not overflow a signed long long (UB). Saturation gives a
    // defined, ordered result instead: it ranks ABOVE a real version (harmless — passing the
    // downgrade gate is not permission to install; the RSA-3072 signature check still has to pass),
    // and two saturated versions compare EQUAL, which the gate refuses.
    const std::string huge(400, '9');
    CHECK(ota_is_upgrade("1.0.0", huge));     // orders above a real version, no UB
    CHECK(!ota_is_upgrade(huge, "1.0.0"));    // and a real version is not "newer" than it
    CHECK(!ota_is_upgrade(huge, huge));       // saturated-equal -> refused, not "newer"

    // ── The dev channel's versions (CI stamps "<next release>-dev.<n>", scripts/next-version.sh) ──
    // A device on the dev feed compares one dev build against the next, so the pre-release
    // identifiers must compare NUMERICALLY. A plain strcmp reads "dev.12" as older than "dev.9"
    // ('1' < '9') and freezes a dev board at the ninth build of a series until the next release.
    CHECK(ota_is_upgrade("1.0.8-dev.9", "1.0.8-dev.12"));
    CHECK(!ota_is_upgrade("1.0.8-dev.12", "1.0.8-dev.9"));
    CHECK(version_compare("1.0.8-dev.10", "1.0.8-dev.9") > 0);
    CHECK(version_compare("1.0.8-dev.2", "1.0.8-dev.10") < 0);
    CHECK(version_compare("1.0.8-dev.3", "1.0.8-dev.3") == 0);
    // Fewer identifiers rank lower; a numeric identifier ranks below an alphanumeric one (semver).
    CHECK(version_compare("1.0.0-dev", "1.0.0-dev.1") < 0);
    CHECK(version_compare("1.0.0-1", "1.0.0-alpha") < 0);
    // A dev build is BELOW the release it leads to, and above the release it followed — which is
    // what makes "dev -> next release" a plain upgrade needing no downgrade flag at all.
    CHECK(ota_is_upgrade("1.0.8-dev.4", "1.0.8"));
    CHECK(!ota_is_upgrade("1.0.8", "1.0.8-dev.4"));
    CHECK(ota_is_upgrade("1.0.7", "1.0.8-dev.1"));
    // The old alphanumeric behaviour is untouched where it was already right.
    CHECK(version_compare("1.0.0-rc2", "1.0.0-rc1") > 0);
    CHECK(version_compare("1.0.0-3-gabc123", "1.0.0") < 0);

    // ── The CHANNEL SWITCH: an explicit downgrade, and only an explicit one ──────────────────────
    // Going from the dev feed back to the last release means installing an OLDER version. Without
    // this the release channel would be unreachable from a dev board — a one-way door — but the
    // permission must come from the request (POST /ota/update?downgrade=1), never from the manifest.
    CHECK(!ota_is_upgrade("1.0.8-dev.4", "1.0.7"));                          // the automatic gate refuses
    CHECK(ota_install_allowed("1.0.8-dev.4", "1.0.7", /*allow_downgrade=*/true));
    CHECK(!ota_install_allowed("1.0.8-dev.4", "1.0.7", /*allow_downgrade=*/false));
    // EQUAL is refused in BOTH modes: re-installing what is already running is not a channel switch.
    CHECK(!ota_install_allowed("1.0.7", "1.0.7", true));
    CHECK(!ota_install_allowed("1.0.7", "v1.0.7", true));
    // And it still fails closed on an unparseable version — the flag opens the ORDER, not the parse.
    CHECK(!ota_install_allowed("1.0.7", "", true));
    CHECK(!ota_install_allowed("", "1.0.7", true));
    CHECK(!ota_install_allowed("1.0.7", "<!DOCTYPE html>", true));
    // Newer still installs with the flag set (a channel switch that happens to be an upgrade).
    CHECK(ota_install_allowed("1.0.7", "1.0.8", true));

    // The manifest and the image must describe the SAME artifact, not merely two artifacts that
    // each happen to pass the ordering gate. This is the lying-host case the second OTA check exists
    // to catch: both 9.9.9 and 1.0.1 are newer than 1.0.0, but they are not the same update.
    CHECK(ota_artifact_versions_match("1.0.1", "1.0.1"));
    CHECK(ota_artifact_versions_match("1.0.8-dev.12", "1.0.8-dev.12"));
    CHECK(!ota_artifact_versions_match("9.9.9", "1.0.1"));
    CHECK(!ota_artifact_versions_match("v1.0.1", "1.0.1"));  // exact published identity
    CHECK(!ota_artifact_versions_match("", ""));
}

// ── OTA update channel (logic/ota_channel.hpp) ───────────────────────────────────────────────
static void test_ota_channel() {
    CHECK(std::string(ota_channel_name(OtaChannel::Release)) == "release");
    CHECK(std::string(ota_channel_name(OtaChannel::Dev)) == "dev");
    CHECK(ota_channel_valid("release") && ota_channel_valid("dev"));
    // A typo is REFUSED, not defaulted: /set_ota answering ok to "develop" would look like a save.
    CHECK(!ota_channel_valid("") && !ota_channel_valid("Dev") && !ota_channel_valid("develop"));
    CHECK(ota_channel_parse("dev") == OtaChannel::Dev);
    CHECK(ota_channel_parse("release") == OtaChannel::Release);
    CHECK(ota_channel_parse("nonsense") == OtaChannel::Release);          // load-path fallback
    CHECK(ota_channel_parse("nonsense", OtaChannel::Dev) == OtaChannel::Dev);
    // The on-flash byte. An unknown value decodes to Release — a garbled NVS byte must not move a
    // board onto the fast feed, and "release" is the state every pre-v3 device is already in.
    CHECK(ota_channel_to_int(OtaChannel::Release) == 0 && ota_channel_to_int(OtaChannel::Dev) == 1);
    CHECK(ota_channel_from_int(0) == OtaChannel::Release && ota_channel_from_int(1) == OtaChannel::Dev);
    CHECK(ota_channel_from_int(2) == OtaChannel::Release && ota_channel_from_int(-1) == OtaChannel::Release);

    // The URL joins. The release feed is the configured manifest URL verbatim; the dev feed is
    // always <firmware base>/dev/manifest.json, so the two cannot be pointed at different sites.
    const std::string mf   = "https://x.github.io/p/manifest.json";
    const std::string base = "https://x.github.io/p/";
    CHECK(ota_channel_manifest_url(mf, base, OtaChannel::Release) == mf);
    CHECK(ota_channel_manifest_url(mf, base, OtaChannel::Dev) == "https://x.github.io/p/dev/manifest.json");
    // A base without its trailing slash must produce the SAME URL — Kconfig documents the slash but
    // does not enforce it, and "…/pdev/manifest.json" would be a 404 nobody could explain.
    CHECK(ota_channel_manifest_url(mf, "https://x.github.io/p", OtaChannel::Dev) ==
          "https://x.github.io/p/dev/manifest.json");
    CHECK(ota_channel_firmware_url(base, OtaChannel::Release, "daikin-altherma-esp32.bin") ==
          "https://x.github.io/p/daikin-altherma-esp32.bin");
    CHECK(ota_channel_firmware_url(base, OtaChannel::Dev, "daikin-altherma-esp32.bin") ==
          "https://x.github.io/p/dev/daikin-altherma-esp32.bin");
    // An EMPTY base yields an EMPTY url, never a relative path: the caller must say "no update URL
    // configured" rather than fetch nothing and report an unreachable server.
    CHECK(ota_channel_manifest_url("", "", OtaChannel::Dev).empty());
    CHECK(ota_channel_firmware_url("", OtaChannel::Dev, "x.bin").empty());
    CHECK(ota_channel_firmware_url("", OtaChannel::Release, "x.bin").empty());

    // The dev LABEL (display only — the install decision is version_cmp's). Keyed on the
    // pre-release identifier, not on the substring: an "-rcdev" build is not a dev build.
    CHECK(ota_version_is_dev("1.0.8-dev.3") && ota_version_is_dev("1.0.8-dev"));
    CHECK(!ota_version_is_dev("1.0.8") && !ota_version_is_dev("1.0.8-rcdev") && !ota_version_is_dev(""));
    CHECK(!ota_version_is_dev("1.0.8-PR-42"));      // a PR preview build is its own thing
}

// ── OTA manifest parsing (logic/ota_manifest.hpp) ────────────────────────────────────────────
static void test_ota_manifest() {
    char v[32];
    // The real manifest, exactly as scripts/ci-build-all.sh writes it.
    const char* real =
        "{\n  \"name\": \"daikin-altherma-esp32\",\n  \"version\": \"1.0.0\",\n"
        "  \"new_install_prompt_erase\": true,\n"
        "  \"builds\": [{\"chipFamily\":\"ESP32-S3\",\"parts\":["
        "{\"path\":\"x-web-bootloader.bin\",\"offset\":0},"
        "{\"path\":\"x-web-partition-table.bin\",\"offset\":32768},"
        "{\"path\":\"x-web-ota_data_initial.bin\",\"offset\":61440},"
        "{\"path\":\"x.bin\",\"offset\":131072}]}]\n}\n";
    CHECK(manifest_version(real, std::strlen(real), v, sizeof(v)) && std::string(v) == "1.0.0");

    // Whitespace-free and reordered variants still parse.
    const char* tight = "{\"version\":\"2.3.4\",\"name\":\"x\"}";
    CHECK(manifest_version(tight, std::strlen(tight), v, sizeof(v)) && std::string(v) == "2.3.4");

    // Top-level ONLY: a "version" nested inside builds[] must not be picked up, or an attacker who
    // can add an array element could shadow the real field from below.
    const char* nested =
        "{\"name\":\"x\",\"builds\":[{\"version\":\"9.9.9\"}],\"version\":\"1.0.0\"}";
    CHECK(manifest_version(nested, std::strlen(nested), v, sizeof(v)) && std::string(v) == "1.0.0");
    const char* only_nested = "{\"builds\":[{\"version\":\"9.9.9\"}]}";
    CHECK(!manifest_version(only_nested, std::strlen(only_nested), v, sizeof(v)) && v[0] == 0);

    // A STRING whose content is "version" is a value, not a key — it must not be mistaken for one.
    const char* as_value = "{\"name\":\"version\",\"version\":\"1.2.3\"}";
    CHECK(manifest_version(as_value, std::strlen(as_value), v, sizeof(v)) && std::string(v) == "1.2.3");

    // Escape handling: a crafted value must not be able to close its own string early and inject a
    // second, higher "version" key.
    const char* inject = "{\"name\":\"\\\" , \\\"version\\\": \\\"9.9.9\\\"\",\"version\":\"1.0.0\"}";
    CHECK(manifest_version(inject, std::strlen(inject), v, sizeof(v)) && std::string(v) == "1.0.0");

    // Never TRUNCATE: "1.10.0" cut to "1.1" is a well-formed version that is ordered WRONG — the
    // exact failure the downgrade gate exists to prevent. Too long => no answer at all.
    char tiny[4];
    CHECK(!manifest_version(tight, std::strlen(tight), tiny, sizeof(tiny)) && tiny[0] == 0);

    // Malformed / missing / hostile inputs -> false, never a partial answer.
    CHECK(!manifest_version("", 0, v, sizeof(v)));
    CHECK(!manifest_version("not json at all", 15, v, sizeof(v)));
    CHECK(!manifest_version("{\"name\":\"x\"}", 12, v, sizeof(v)));          // no version key
    const char* unterminated = "{\"version\":\"1.0.0";
    CHECK(!manifest_version(unterminated, std::strlen(unterminated), v, sizeof(v)));
    const char* nonstring = "{\"version\":123}";
    CHECK(!manifest_version(nonstring, std::strlen(nonstring), v, sizeof(v)));
    const char* empty_val = "{\"version\":\"\"}";
    CHECK(!manifest_version(empty_val, std::strlen(empty_val), v, sizeof(v)));
    const char* escaped_val = "{\"version\":\"1.0\\u0030\"}";
    CHECK(!manifest_version(escaped_val, std::strlen(escaped_val), v, sizeof(v)));

    // It must respect `len` and never read past it — the device hands it a fixed buffer that is NOT
    // NUL-terminated at the point the version would appear if the response was cut short.
    const char* cut = "{\"version\":\"1.0.0\"}";
    CHECK(!manifest_version(cut, 12, v, sizeof(v)));   // len stops mid-value

    // End to end: what the parser yields feeds the gate.
    CHECK(manifest_version(real, std::strlen(real), v, sizeof(v)));
    CHECK(ota_is_upgrade("0.9.0", v) && !ota_is_upgrade("1.0.0", v));
}

static void test_query_flag() {
    // A flag fires only on exactly "1" — the value the HTTP API documents for ?clear / ?verbose.
    CHECK(query_flag_on("1"));
    // The regression this guards: ?clear=0 (present, but not "1") must NOT trigger the destructive
    // clear — the old handler acted on key PRESENCE and wiped the diag log / coredump on ?clear=0.
    CHECK(!query_flag_on("0"));
    CHECK(!query_flag_on(""));      // ?clear= (empty value)
    CHECK(!query_flag_on(nullptr)); // key absent
    CHECK(!query_flag_on("10"));    // exactly "1", not a prefix
    CHECK(!query_flag_on("1x"));
    CHECK(!query_flag_on("true"));
    CHECK(!query_flag_on("2"));
}

static void test_config_store() {
    // CRC-32 golden vector (the check byte itself is what makes the blob all-or-nothing on load).
    CHECK(config_crc32(reinterpret_cast<const uint8_t*>("123456789"), 9) == 0xCBF43926u);
    CHECK(config_crc32(nullptr, 0) == 0u);

    // Round-trip every field, including bytes that must survive verbatim (spaces are valid SSID/user
    // bytes — the F08 fix — and a blob must not mangle them), and the two packed flags.
    ConfigBlob a;
    a.wifi_ssid = " my wifi ";  a.wifi_pass = "p@ss word";
    a.wifi_ssid_backup = "old"; a.wifi_pass_backup = "";
    a.wifi_rollback_active = true; a.wifi_rolled_back = false;
    a.mqtt_uri = "mqtts://broker:8883"; a.mqtt_user = "u ser"; a.mqtt_pass = "";
    a.syslog_host = "logs.example.com"; a.syslog_port = 514;
    a.ntp_server = "pool.ntp.org";
    std::vector<uint8_t> buf = config_blob_serialize(a);
    ConfigBlob b;
    CHECK(config_blob_deserialize(buf.data(), buf.size(), b));
    CHECK(b.wifi_ssid == a.wifi_ssid && b.wifi_pass == a.wifi_pass);
    CHECK(b.wifi_ssid_backup == a.wifi_ssid_backup && b.wifi_pass_backup == a.wifi_pass_backup);
    CHECK(b.wifi_rollback_active == true && b.wifi_rolled_back == false);
    CHECK(b.mqtt_uri == a.mqtt_uri && b.mqtt_user == a.mqtt_user && b.mqtt_pass == a.mqtt_pass);
    CHECK(b.syslog_host == a.syslog_host && b.syslog_port == 514);
    CHECK(b.ntp_server == a.ntp_server);

    // The other flag combination, and a negative-looking port stored as-is.
    ConfigBlob c; c.wifi_rolled_back = true; c.wifi_rollback_active = false; c.syslog_port = 65535;
    std::vector<uint8_t> cb = config_blob_serialize(c);
    ConfigBlob d;
    CHECK(config_blob_deserialize(cb.data(), cb.size(), d));
    CHECK(d.wifi_rolled_back == true && d.wifi_rollback_active == false && d.syslog_port == 65535);

    // All-or-nothing on LOAD: any corruption -> reject (false), never a partial decode. `out` is left
    // untouched so the caller falls back to defaults / the legacy per-key layout.
    ConfigBlob out; out.wifi_ssid = "sentinel";
    std::vector<uint8_t> bad = buf;
    bad[10] ^= 0xFF;                                                   // flip a payload byte -> CRC fails
    CHECK(!config_blob_deserialize(bad.data(), bad.size(), out) && out.wifi_ssid == "sentinel");
    CHECK(!config_blob_deserialize(buf.data(), buf.size() - 1, out)); // truncated (CRC + length short)
    CHECK(!config_blob_deserialize(buf.data(), 4, out));              // shorter than the header+crc floor
    CHECK(!config_blob_deserialize(nullptr, 0, out));
    CHECK(!config_blob_deserialize(buf.data(), 0, out));             // zero length
    std::vector<uint8_t> badmagic = buf; badmagic[0] = 'X';
    CHECK(!config_blob_deserialize(badmagic.data(), badmagic.size(), out));
    // Helper: re-stamp a valid CRC over v[0 .. size-4) so that ONLY a non-CRC rule can reject v.
    auto restamp = [](std::vector<uint8_t>& v) {
        const uint32_t k = config_crc32(v.data(), v.size() - 4);
        v[v.size()-4] = k & 0xFF; v[v.size()-3] = (k>>8) & 0xFF;
        v[v.size()-2] = (k>>16) & 0xFF; v[v.size()-1] = (k>>24) & 0xFF;
    };
    // Unknown version, CRC re-stamped: rejected by the version check alone — on BOTH sides of the
    // accepted range, so a future v3 blob written by a newer build is refused rather than
    // half-decoded by this one.
    std::vector<uint8_t> newver = buf; newver[4] = CONFIG_BLOB_VERSION + 1; restamp(newver);
    CHECK(!config_blob_deserialize(newver.data(), newver.size(), out));
    std::vector<uint8_t> oldver = buf; oldver[4] = CONFIG_BLOB_VERSION_MIN - 1; restamp(oldver);
    CHECK(!config_blob_deserialize(oldver.data(), oldver.size(), out));
    // Trailing garbage after a valid body, CRC re-stamped: rejected by the "p != body_end" rule alone.
    std::vector<uint8_t> extra = buf; extra.insert(extra.end() - 4, 0x00); restamp(extra);
    CHECK(!config_blob_deserialize(extra.data(), extra.size(), out));

    // ── v2: the board-local hardware block ───────────────────────────────────────────────────────
    ConfigBlob board;
    board.wifi_ssid = "net";
    board.led_gpio = 35; board.led_type = 1; board.led_inverted = false;
    board.btn_gpio = 41; board.btn_active_low = true;
    std::vector<uint8_t> bb = config_blob_serialize(board);
    CHECK(bb[4] == CONFIG_BLOB_VERSION && CONFIG_BLOB_VERSION == 3);
    ConfigBlob rt;
    CHECK(config_blob_deserialize(bb.data(), bb.size(), rt));
    CHECK(rt.has_board && rt.led_gpio == 35 && rt.led_type == 1 && !rt.led_inverted);
    CHECK(rt.btn_gpio == 41 && rt.btn_active_low);
    CHECK(rt.wifi_ssid == "net");                       // the v1 fields still round-trip unchanged
    // The two board booleans are packed into one flag byte — they must not bleed into each other.
    board.led_inverted = true; board.btn_active_low = false;
    bb = config_blob_serialize(board);
    CHECK(config_blob_deserialize(bb.data(), bb.size(), rt));
    CHECK(rt.led_inverted && !rt.btn_active_low);
    // Negative pins (the -1 "absent" sentinel) survive the unsigned encoding.
    board.led_gpio = -1; board.btn_gpio = -1;
    bb = config_blob_serialize(board);
    CHECK(config_blob_deserialize(bb.data(), bb.size(), rt));
    CHECK(rt.led_gpio == -1 && rt.btn_gpio == -1);

    // BACKWARD COMPATIBILITY, and it is not optional: a device OTA-upgraded from a pre-board build
    // has a v1 blob on flash and NOTHING in the legacy per-key layout. Rejecting v1 would drop that
    // user's WiFi and MQTT credentials on the upgrade. It must decode, and it must report
    // has_board == false so the caller seeds the Kconfig defaults instead of reading "absent" as
    // "indicator disabled" (which would silently darken every XIAO's LED).
    std::vector<uint8_t> v1 = buf;                       // `buf` was serialized... as v3 by this build,
    // so build a genuine v1 body: header + the v1 fields only, taken from the v3 encoding by
    // dropping the 13-byte board block (3x u32 + 1 flag byte) AND the 1-byte v3 channel that
    // precede the CRC.
    v1.erase(v1.end() - 4 - 14, v1.end() - 4);
    v1[4] = 1;
    restamp(v1);
    ConfigBlob legacy;
    legacy.led_gpio = 999;                               // sentinel: must be left untouched by the decode
    CHECK(config_blob_deserialize(v1.data(), v1.size(), legacy));
    CHECK(!legacy.has_board);
    CHECK(legacy.wifi_ssid == a.wifi_ssid && legacy.mqtt_uri == a.mqtt_uri);   // v1 payload intact
    CHECK(legacy.led_gpio == -1);                        // the struct default, not the 999 sentinel
    // A TRUNCATED v3 must not decode as a valid v2/v1 with silently-default pins: the version byte
    // still says 3, so the missing blocks are caught by the length rule, not papered over.
    std::vector<uint8_t> trunc = bb;
    trunc.erase(trunc.end() - 4 - 14, trunc.end() - 4);
    restamp(trunc);
    CHECK(!config_blob_deserialize(trunc.data(), trunc.size(), out));

    // ── v3: the OTA update channel ───────────────────────────────────────────────────────────────
    ConfigBlob chan; chan.wifi_ssid = "net"; chan.ota_channel = 1;   // 1 = dev
    std::vector<uint8_t> cbv = config_blob_serialize(chan);
    ConfigBlob crt;
    CHECK(config_blob_deserialize(cbv.data(), cbv.size(), crt));
    CHECK(crt.has_ota && crt.ota_channel == 1 && crt.wifi_ssid == "net");
    chan.ota_channel = 0;
    cbv = config_blob_serialize(chan);
    CHECK(config_blob_deserialize(cbv.data(), cbv.size(), crt) && crt.ota_channel == 0 && crt.has_ota);
    // The same upgrade guarantee v1 got: a device that has only ever been written by a pre-channel
    // build carries a v2 blob, and it must decode — losing the credentials to gain a channel byte
    // would be a spectacularly bad trade. has_ota == false is how the caller tells "no channel
    // stored" from "explicitly release"; both mean release, only the diag line differs.
    std::vector<uint8_t> v2 = bb;
    v2.erase(v2.end() - 4 - 1, v2.end() - 4);            // drop the v3 channel byte
    v2[4] = 2;
    restamp(v2);
    ConfigBlob pre;
    pre.ota_channel = 7;                                 // sentinel: must be left untouched
    CHECK(config_blob_deserialize(v2.data(), v2.size(), pre));
    CHECK(!pre.has_ota && pre.ota_channel == 0);         // the struct default, not the 7 sentinel
    CHECK(pre.has_board && pre.led_gpio == -1 && pre.wifi_ssid == "net");   // v2 payload intact
}

static void test_mcp_jsonrpc() {
    auto make = [](bool vj, bool obj, bool jr, bool m, JrIdKind id) {
        JrRequest r; r.valid_json = vj; r.is_object = obj; r.jsonrpc_ok = jr; r.has_method = m; r.id_kind = id;
        return r;
    };
    // Not JSON at all -> Parse error, id null.
    JrDecision d = mcp_jsonrpc_decide(make(false, false, false, false, JrIdKind::None));
    CHECK(d.action == JrAction::Error && d.code == -32700 && !mcp_jsonrpc_echo_id(d));

    // Valid JSON but not a conforming Request object -> Invalid Request (-32600), id null. Each of the
    // structural faults on its own must trip it: not an object, wrong jsonrpc, missing method, or an
    // id of a disallowed type (array/object/bool) — which must never be mirrored back.
    CHECK(mcp_jsonrpc_decide(make(true, false, true,  true,  JrIdKind::Number)).code == -32600);  // not object
    CHECK(mcp_jsonrpc_decide(make(true, true,  false, true,  JrIdKind::Number)).code == -32600);  // jsonrpc != 2.0
    CHECK(mcp_jsonrpc_decide(make(true, true,  true,  false, JrIdKind::Number)).code == -32600);  // no method
    d = mcp_jsonrpc_decide(make(true, true, true, true, JrIdKind::Invalid));                      // bad id type
    CHECK(d.code == -32600 && !mcp_jsonrpc_echo_id(d));

    // Well-formed NOTIFICATION (no id) -> NO response, even for an unknown method.
    d = mcp_jsonrpc_decide(make(true, true, true, true, JrIdKind::None));
    CHECK(d.action == JrAction::NoResponse);

    // Well-formed request with a valid id -> Method not found (-32601), and the request's id IS echoed.
    for (JrIdKind k : {JrIdKind::Number, JrIdKind::String, JrIdKind::Null}) {
        d = mcp_jsonrpc_decide(make(true, true, true, true, k));
        CHECK(d.action == JrAction::Error && d.code == -32601 && mcp_jsonrpc_echo_id(d));
    }
    CHECK(std::string(mcp_jsonrpc_message(-32700)) == "Parse error");
    CHECK(std::string(mcp_jsonrpc_message(-32600)) == "Invalid Request");
    CHECK(std::string(mcp_jsonrpc_message(-32601)) == "Method not found");
}

static void test_http_surface() {
    const HttpSurface ap  = HttpSurface::SetupAp;
    const HttpSurface lan = HttpSurface::TrustedLan;

    // Trusted LAN exposes the full API — every route, either method.
    for (const char* p : {"/", "/index.html", "/scan", "/status", "/values", "/diag", "/coredump",
                          "/models", "/set_wifi", "/set_mqtt", "/set_ntp", "/set_hp", "/detect",
                          "/ota/check", "/ota/update", "/mcp"}) {
        CHECK(http_surface_serves(lan, p, false));
        CHECK(http_surface_serves(lan, p, true));
    }

    // Open setup AP: ONLY the provisioning routes.
    CHECK(http_surface_serves(ap, "/", false));
    CHECK(http_surface_serves(ap, "/index.html", false));
    CHECK(http_surface_serves(ap, "/set_wifi", true));

    // …and nothing that reads state, carries secrets, or reconfigures the device. This is the F01
    // regression: /coredump and /diag can hold WiFi/MQTT credentials, and the config/OTA/MCP routes
    // reprogram the board — none may be reachable from an unauthenticated radio client.
    CHECK(!http_surface_serves(ap, "/status", false));
    CHECK(!http_surface_serves(ap, "/values", false));
    CHECK(!http_surface_serves(ap, "/diag", false));
    CHECK(!http_surface_serves(ap, "/coredump", false));
    CHECK(!http_surface_serves(ap, "/models", false));
    // …including /scan: the portal takes a TYPED SSID (main/www/setup.html has no dropdown and issues
    // no fetch), so an open radio has no reason to be handed a list of every AP in range.
    CHECK(!http_surface_serves(ap, "/scan", false));
    CHECK(!http_surface_serves(ap, "/set_mqtt", true));
    CHECK(!http_surface_serves(ap, "/set_syslog", true));
    CHECK(!http_surface_serves(ap, "/set_ntp", true));
    CHECK(!http_surface_serves(ap, "/set_hp", true));
    CHECK(!http_surface_serves(ap, "/detect", true));
    CHECK(!http_surface_serves(ap, "/ota/check", false));
    CHECK(!http_surface_serves(ap, "/ota/update", true));
    CHECK(!http_surface_serves(ap, "/mcp", true));

    // Method matters on the AP: /set_wifi is POST-only and the page routes are GET-only — the
    // mismatched method is withheld (a GET /set_wifi must not slip through the provisioning
    // allow-list, nor a POST to the setup page).
    CHECK(!http_surface_serves(ap, "/set_wifi", false));
    CHECK(!http_surface_serves(ap, "/", true));
    CHECK(!http_surface_serves(ap, "/index.html", true));
}

// logic/lwt_select.hpp — the leaving-water MEASUREMENT picker that feeds ΔT / heat output / COP.
// Host-testable twin of www/app.js pickLwtRow(); guards issue #121 (a setpoint must never be
// selected) and the post-BUH mis-credit (R2T must never win over R1T), across the real profile
// catalog and the alias label forms plain "leaving water.*before" misses.
static void test_lwt_select() {
    using logic::lwt_select;

    // --- the #121 case: a "Leaving water" SETPOINT sorts before the R1T measurement (the fixture
    //     layout). The old fallback `vNum(/leaving water/i)` picked index 0 — a 45 °C setpoint. ---
    {
        const char* rows[] = {
            "Leaving Water Setpoint (main)",       // 0x60 — sorts FIRST, must be refused
            "Leaving Water Temp after PHE (R1T)",  // 0x61 — the correct pre-BUH sensor
            "Leaving Water Temp after BUH (R2T)",  // 0x61 — post-BUH, must be refused
        };
        CHECK(lwt_select(rows, 3) == 1);           // R1T, not the setpoint, not R2T
    }

    // --- the 44+ mainstream profiles: "before BUH (R1T)" wins over its R2T twin and the setpoint,
    //     regardless of which sorts first. ---
    {
        const char* rows[] = {
            "Leaving Water Setpoint (main)",
            "Leaving water temp. before BUH (R1T)",
            "Leaving water temp. after BUH (R2T)",
        };
        CHECK(lwt_select(rows, 3) == 1);
    }

    // --- alias label forms that carry NO "leaving water" string, so the old primary+fallback both
    //     missed and the tiles went blank. Now the (R1T) tier lights them up. ---
    {
        const char* hpsu[] = {                     // HPSU / hybrid
            "LW setpoint (main)",
            "Outlet Water Heat Exch. Temp. (R1T)",
            "Outlet Water BUH Temp. (R2T)",
        };
        CHECK(lwt_select(hpsu, 3) == 1);
        const char* ech2o[] = {                    // ECH2O D-series
            "LW setpoint (main)",
            "[HPSU] Tv inflow Temp  (R1T)",
            "[HPSU] Tvbh inflow Temp after Buffer/BUH (R2T)",
        };
        CHECK(lwt_select(ech2o, 3) == 1);
    }

    // --- traps that must NOT be selected as the main leaving-water measurement ---
    {
        // EKMIK bizone mixed-zone R1T must lose to the main circuit's before-BUH R1T ("mixed" reject).
        const char* bizone[] = {
            "Leaving water temp. before BUH (R1T)",
            "[EKMIK] Bizone kit mixed leaving water temperature R1T",
        };
        CHECK(lwt_select(bizone, 2) == 0);

        // DLWB2 hydro-split outlet carries no (R1T): the pre-BUH R1T must win even when DLWB2 sorts
        // first — proving Tier 1 beats a generic outlet-water row by rank, not by table order.
        const char* dlwb2[] = {
            "Outlet water heat exchanger temp (hydro split model) DLWB2",
            "Leaving water temp. before BUH (R1T)",
        };
        CHECK(lwt_select(dlwb2, 2) == 1);

        // A bare "heat exch" keyword would grab these refrigerant/outdoor rows — the picker must not.
        const char* refr[] = { "O/U Heat Exch. Temp.(R4T)", "Outdoor heat exchanger temp." };
        CHECK(lwt_select(refr, 2) == -1);
    }

    // --- Tier 2 fallback: an un-tagged leaving-water measurement is still selected (not a setpoint) ---
    {
        const char* generic[] = { "DHW setpoint", "Leaving water temperature" };
        CHECK(lwt_select(generic, 2) == 1);
        // ...but if the ONLY leaving-water row is a setpoint, select nothing (blank beats wrong).
        const char* only_sp[] = { "Leaving Water Setpoint (main)", "DHW setpoint" };
        CHECK(lwt_select(only_sp, 2) == -1);
    }

    // --- catalog conformance: EVERY detectable profile must resolve a real pre-BUH measurement,
    //     and it must never be a setpoint / mixed-zone / post-BUH row. Fails loudly if a future
    //     generated profile introduces a leaving-water row that trips the selection (the issue's
    //     "so no future generated profile can reintroduce this"). ---
    int detectable_checked = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;   // generic + fixture + minichillers excluded
        const char* labels[128];
        size_t n = 0;
        for (size_t i = 0; i < p.count && n < 128; i++) labels[n++] = p.values[i].label;
        int idx = lwt_select(labels, n);
        CHECK(idx >= 0);                                // no detectable profile is blank any more
        if (idx >= 0) {
            const char* sel = labels[idx];
            CHECK(logic::lwt_is_water(sel) && !logic::lwt_is_reject(sel));   // measurement, not setpoint/mixed/R2T
        }
        detectable_checked++;
    }
    CHECK(detectable_checked >= 39);                    // the current detectable Altherma catalog

    // The non-detection fixture reproduces the #121 layout (setpoint, then after-PHE R1T): assert
    // the picker refuses its setpoint too, pinning the exact scenario the issue was filed on.
    {
        const auto& fx = def::lookup("altherma3_r_erga");
        const char* labels[128];
        size_t n = 0;
        for (size_t i = 0; i < fx.count && n < 128; i++) labels[n++] = fx.values[i].label;
        int idx = lwt_select(labels, n);
        CHECK(idx >= 0);
        if (idx >= 0) CHECK(!logic::lwt_is_reject(labels[idx]) && logic::lwt_ci_contains(labels[idx], "r1t"));
    }
}

// ── logic/ou_stale.hpp — readings the outdoor unit stops refreshing while the compressor is off ──
// The unit answers its own pages with the LAST RUN's values when it is stopped (see the header for
// the measurement). Two halves are gated here, and the second is the important one: the readings
// that DECIDE the run state must live on pages that stay live, or "Standby — not running" would be
// derived from the same frozen bytes it is contradicting.
static void test_ou_stale() {
    using logic::ou_page_holds_over;
    using logic::ou_reading_held_over;

    // The two outdoor-unit pages, and only those.
    CHECK(ou_page_holds_over(0x20));
    CHECK(ou_page_holds_over(0x21));
    CHECK(!ou_page_holds_over(0x10));      // carries Defrost Operation — a state input, never silenced
    CHECK(!ou_page_holds_over(0x30));      // INV frequency (rps) — the compressor witness
    CHECK(!ou_page_holds_over(0x60));      // indoor/hydronic
    CHECK(!ou_page_holds_over(0x61));
    CHECK(!ou_page_holds_over(0x62));

    // UNKNOWN compressor state is not "stopped": a profile with no rps row must not have its outdoor
    // readings blanked on a guess. Only a known-stopped compressor is evidence of a held-over page.
    CHECK(ou_reading_held_over(0x20, /*known=*/true, /*running=*/false));
    CHECK(!ou_reading_held_over(0x20, /*known=*/true, /*running=*/true));
    CHECK(!ou_reading_held_over(0x20, /*known=*/false, /*running=*/false));   // unknown -> current
    CHECK(!ou_reading_held_over(0x61, /*known=*/true, /*running=*/false));    // hydronic stays live

    // --- catalog conformance -------------------------------------------------------------------
    // Every detectable profile: the readings the UI blanks must sit on a held-over page, and the
    // compressor witness must NOT. A future generated profile that moves "INV frequency (rps)" onto
    // 0x20/0x21 would make the run state stale-derived and must fail loudly here.
    int rps_rows = 0, out_rows = 0, disch_rows = 0, inv_rows = 0, ct_rows = 0, rp_rows = 0, checked = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        for (size_t i = 0; i < p.count; i++) {
            const char* l = p.values[i].label;
            const unsigned reg = p.values[i].reg;
            if (logic::lwt_ci_contains(l, "inv frequency")) {
                CHECK(!ou_page_holds_over(reg));   // the run-state witness must stay live
                rps_rows++;
            }
            if (logic::lwt_ci_contains(l, "outdoor air temp")) {
                CHECK(ou_page_holds_over(reg));    // the pill the UI blanks
                out_rows++;
            }
            if (logic::lwt_ci_contains(l, "discharge pipe temp")) {
                CHECK(ou_page_holds_over(reg));
                disch_rows++;
            }
            // The ELECTRICAL-INPUT sources, and they fall on opposite sides of the rule — which is
            // the whole reason www/app.js has to pick between them rather than blanking the pill
            // wholesale. "INV primary current" is an outdoor-unit row and freezes with the rest of
            // 0x21; the CT clamps sit on the hydronic 0x63 and keep measuring. The browser's d.pel
            // used the INV row as an unconditional fallback whenever the CT sum read 0 — which is
            // exactly what an idle plant reads — so a stopped unit drew a plausible kW figure out of
            // its last run, beside a "not running" headline. Same shape as #35-#39, no numeric tell.
            if (logic::lwt_ci_contains(l, "inv primary current")) {
                CHECK(ou_page_holds_over(reg));    // held over -> the browser must gate on ouHeldOver
                inv_rows++;
            }
            if (logic::lwt_ci_contains(l, "current measured by ct")) {
                CHECK(!ou_page_holds_over(reg));   // live -> a non-zero CT reading is real standby draw
                ct_rows++;
            }
            // The high-side pill's AT-REST source. The compressor's own HP transducer is a 0x20 row
            // and freezes with that page, so the browser falls back to this one — and the inspector
            // now names it as the source line beside the number. That only holds while it is LIVE:
            // on a held-over page it would be the same stale bar under a more trustworthy name.
            if (logic::lwt_ci_contains(l, "refrigerant pressure sensor")) {
                CHECK(!ou_page_holds_over(reg));   // 0x62, the hydronic side — resampled at rest
                rp_rows++;
            }
        }
        checked++;
    }
    CHECK(checked >= 39);        // the current detectable Altherma catalog (mirrors test_lwt_select)
    CHECK(rps_rows >= 20);       // the witness exists across the catalog, not on one profile
    CHECK(out_rows >= 20);
    CHECK(disch_rows >= 20);
    // Every detectable profile carries the INV row, and only about half carry CT clamps — so the
    // stale fallback was not an edge case, it was the default path on the majority of installs.
    CHECK(inv_rows >= checked);
    CHECK(ct_rows > 0);
    CHECK(rp_rows > 0);          // the at-rest high-side fallback exists in the catalog
}

// ── ValueDef::no_publish — the detect-only row flag ───────────────────────────────────────────
// The 0x64 hybrid/boiler page is absent-feature on a non-hybrid monobloc/hydrobox: the unit ANSWERS
// the page, but every value on it is a placeholder (2nd DHW -40.4 °C, "Boiler only", Mixed water
// 0.0). The rows are deliberately KEPT and flagged rather than deleted — deleting them drops the
// page from the profile's detection signature (def/signatures.hpp builds page_mask over every row)
// and detect_candidates picks MAXIMAL page overlap, so the correct profile would lose to a
// feature-richer WRONG one that kept 0x64: the model mis-detects and the same garbage returns
// through that table. This test pins BOTH halves — the rows are flagged, and the signature that
// makes detection work is unchanged.
static void test_no_publish() {
    static const char* kFlagged[] = {
        "altherma_ebla_edla_d_series_4_8kw_monobloc",
        "altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw",
        "altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw",
        "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw",
    };
    for (const char* id : kFlagged) {
        const auto& p = def::lookup(id);
        CHECK(std::string(p.id) == id);                    // profile really exists under this id
        int      flagged = 0;
        uint32_t mask    = 0;
        for (size_t i = 0; i < p.count; i++) {
            mask |= page_mask_bit(p.values[i].reg);        // signature spans EVERY row, flagged too
            if (p.values[i].no_publish) {
                flagged++;
                CHECK(p.values[i].reg == 0x64);            // only the hybrid page is detect-only
            }
        }
        CHECK(flagged == 8);                               // the whole 0x64 hybrid/boiler cluster
        CHECK((mask & page_mask_bit(0x64)) != 0);          // SIGNATURE INTACT — the reason for the flag
    }
    // Contained: nothing outside the non-hybrid 4-8 kW set is flagged (a genuine hybrid must keep
    // publishing its boiler values).
    int total = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].no_publish) total++;
    CHECK(total == 8 * 4);
    // Defaults false: an ordinary generated `{reg,offset,conv,size,type,label}` row stays publishable
    // without having to say so, so the flag is additive to every existing table.
    const auto& m = def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc");
    for (size_t i = 0; i < m.count; i++)
        if (m.values[i].reg != 0x64) CHECK(!m.values[i].no_publish);
}

// ── logic/profile_view.hpp + def/overlay.hpp — the page-0x10 protection-word supplement (#110 B) ──
static void test_profile_view() {
    using namespace daik::logic;

    // THE OVERLAY RULE: a supplement applies only if the base already reads its page. This is what
    // keeps a hand-written block from doing what hand-editing a generated table would do — move
    // detection — and from adding a per-cycle bus round-trip (and, on a model that does not answer,
    // a per-cycle TIMEOUT that reads on /diag exactly like a wiring fault).
    ValueDef base_with[]    = {{0x10, 0, 217, 1, -1, "Operation Mode"}, {0x60, 3, 204, 1, -1, "Error Code"}};
    ValueDef base_without[] = {{0x60, 3, 204, 1, -1, "Error Code"}};
    ValueDef extra[]        = {{0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty"}};

    const auto applied = profile_view(base_with, 2, extra, 1, 0x10);
    CHECK(applied.count() == 3);
    CHECK(applied[0].conv == 217 && applied[1].conv == 204);   // base rows keep their order + indices
    CHECK(applied[2].conv == 310 && applied[2].offset == 10);  // supplement lands after them

    const auto skipped = profile_view(base_without, 1, extra, 1, 0x10);
    CHECK(skipped.count() == 1);          // page absent -> block withheld entirely
    CHECK(skipped.extra_count == 0);
    CHECK(!profile_has_page(base_without, 1, 0x10));
    CHECK(profile_has_page(base_with, 2, 0x10));

    // An empty supplement is a no-op, not a crash: the block is deleted the day the generator emits
    // these rows, and the deletion must not have to be atomic with the call-site cleanup.
    CHECK(profile_view(base_with, 2, nullptr, 0, 0x10).count() == 2);

    // ── The real catalog ────────────────────────────────────────────────────────────────────────
    // Every profile reads page 0x10, so every profile gets the supplement. If a future generated
    // profile drops the page this CHECK fails rather than the device quietly gaining a round-trip.
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p);
        CHECK(v.count() == p.count + def::RETRY_ROW_COUNT);
        CHECK(v.extra_count == def::RETRY_ROW_COUNT);
    }

    // DETECTION IS UNMOVED — the load-bearing claim. Belt: signatures are built over def::profiles
    // (the BASE tables) and never see a view. Braces: even resolved, the page mask is identical,
    // because the rule cannot set a bit that was not already set. Assert the braces, since the belt
    // is the one a refactor would remove.
    for (const auto& p : def::profiles) {
        uint32_t base_mask = 0, view_mask = 0;
        for (size_t i = 0; i < p.count; i++) base_mask |= daik::page_mask_bit(p.values[i].reg);
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) view_mask |= daik::page_mask_bit(v[i].reg);
        CHECK(base_mask == view_mask);
    }

    // The supplement transcribes docs/REGISTERS.md §5 register 0x10: 11 rows over offsets 10-12,
    // four packed fields per byte minus the one Daikin labels "Not in use". Every row dimensionless
    // and 1 byte — pinned by a static_assert too, because hp_poll hands the BASE table (not the
    // view) to profile_refrigerant() and reading_plausible().
    CHECK(def::RETRY_ROW_COUNT == 11);
    int c310 = 0, c311 = 0, c307 = 0, c303 = 0;
    for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
        const ValueDef& d = def::retry_rows[i];
        CHECK(d.reg == 0x10 && d.offset >= 10 && d.offset <= 12);
        CHECK(d.size == 1 && d.type == -1 && !d.no_publish);
        CHECK(d.conv != 405);
        if (d.conv == 310) c310++;
        if (d.conv == 311) c311++;
        if (d.conv == 307) c307++;
        if (d.conv == 303) c303++;
    }
    CHECK(c310 == 3);   // Discharge Temp. / HP / Fin Temp. retry counters — UC5's signal
    CHECK(c311 == 2);   // Comp. INV Current / LP retry counters ("Not in use" omitted)
    CHECK(c307 == 3 && c303 == 3);   // the drop-control flags sharing those bytes

    // The rows DECODE, end to end, through the real converter — the half PR #111 could not reach
    // because no row used conv 310. 0x95 on offset 10 is 1 discharge retry with the drop flag set
    // and 5 INV-current retries, NOT 149.
    const uint8_t word[] = {0x95};
    int seen = 0;
    for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
        if (def::retry_rows[i].offset != 10) continue;
        const auto r = convert(def::retry_rows[i], word);
        CHECK(r.ok);
        switch (def::retry_rows[i].conv) {
            case 310: CHECK(approx(r.value, 1.0)); seen++; break;
            case 311: CHECK(approx(r.value, 5.0)); seen++; break;
            case 307: CHECK(r.text == std::string("ON"));  seen++; break;   // bit 7 set
            case 303: CHECK(r.text == std::string("OFF")); seen++; break;   // bit 3 clear
            default: CHECK(false); break;
        }
    }
    CHECK(seen == 4);

    // A bit-flag row publishes as an HA binary_sensor and a COUNTER as a number — they share a byte,
    // so a split that keyed on the label instead of the converter would type all four alike.
    CHECK(conv_is_binary(307) && conv_is_binary(303));
    CHECK(!conv_is_binary(310) && !conv_is_binary(311));
    for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
        const ValueDef& d = def::retry_rows[i];
        CHECK(!object_id(d.label).empty());   // an empty object_id is a row publish_discovery drops
        CHECK(std::string(ha_component(d)) == (conv_is_binary(d.conv) ? "binary_sensor" : "sensor"));
    }

    // The supplement must not introduce a DUPLICATE object_id: entities are keyed by it, so two rows
    // sharing one would collapse into a single HA entity and the second row would silently never
    // arrive. (The catalog already contains pre-existing duplicates — e.g. "Error Code" on both
    // 0x10/5 and 0x60/3 — so the assertion is the DELTA, not an absolute: no id the supplement adds
    // may already be taken by the profile it is applied to.)
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
            const std::string oid = object_id(def::retry_rows[i].label);
            for (size_t k = 0; k < p.count; k++) CHECK(object_id(p.values[k].label) != oid);
        }
    }
}

// ── logic/feature_gate.hpp — what may honestly run on the detected profile (#110 Part C) ─────────
static void test_feature_gate() {
    using namespace daik::logic;

    // `generic` is the case #69 names: detection failed, so the fallback carries the universal
    // register core and nothing else. Measured, not assumed — it has no leaving-water MEASUREMENT
    // (only "LW setpoint (main)", which the lwt_select rule correctly rejects), no INV frequency, no
    // expansion valve and no pressure row. The decision is DISABLE, so both gates are false.
    const auto gen = feature_coverage(def::lookup_view("generic"));
    CHECK(!gen.leaving_water);
    CHECK(!gen.run_state);
    CHECK(!gen.expansion_valve);
    CHECK(!gen.refrigerant_pressure);
    CHECK(gen.retry_counters);              // the supplement reaches `generic` too — it reads 0x10
    CHECK(!uc5_supported(gen));             // counters with no run-state to interpret them against
    CHECK(!inference_supported(gen));

    // A fully-equipped detected model is the opposite end: everything on, both gates open.
    const auto full = feature_coverage(def::lookup_view("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    CHECK(full.leaving_water && full.run_state && full.retry_counters);
    CHECK(full.expansion_valve && full.refrigerant_pressure);
    CHECK(uc5_supported(full));
    CHECK(inference_supported(full));

    // WHY THIS IS NOT AN `id == "generic"` CHECK, pinned as a measurement: the starvation is not
    // unique to the fallback. Across the DETECTABLE catalog a substantial minority carry no page
    // 0x30, hence no INV frequency and no expansion valve — an id check would have let inference run
    // without a run-state input on every one of them.
    int detectable = 0, no_run_state = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        detectable++;
        const auto c = feature_coverage(def::resolved(p));
        // Universal across the catalog: a leaving-water measurement (so lwt_select always resolves —
        // the #121 guarantee) and, now, the retry counters.
        CHECK(c.leaving_water);
        CHECK(c.retry_counters);
        if (!c.run_state) {
            no_run_state++;
            CHECK(!uc5_supported(c));        // disabled, never degraded
            CHECK(!inference_supported(c));
            CHECK(!c.expansion_valve);       // both live on page 0x30 — they go together
        } else {
            CHECK(uc5_supported(c));
        }
    }
    CHECK(detectable >= 39);
    CHECK(no_run_state >= 10);               // a real minority, not a rounding error
    CHECK(no_run_state < detectable);        // ...and not the whole catalog, or the gate says nothing

    // inference_supported() is strictly stronger than uc5_supported(): anything that can run a
    // trained model can run the rule. A hand-built coverage that has the counters + run-state but
    // lacks the hydronic/refrigerant signals must open exactly one of the two gates.
    FeatureCoverage partial;
    partial.retry_counters = true;
    partial.run_state      = true;
    CHECK(uc5_supported(partial));
    CHECK(!inference_supported(partial));

    // A detect-only placeholder is not coverage: the row exists to hold a page in the detection
    // signature, and the value is an absent feature. Counting it would be the "pretend full
    // features" outcome #69 rules out by name.
    ValueDef ghost[] = {{0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty", true}};
    const auto ghost_cov = feature_coverage(profile_view(ghost, 1, nullptr, 0, 0x10));
    CHECK(!ghost_cov.retry_counters);
    CHECK(!uc5_supported(ghost_cov));
}

int main() {
    test_crc();
    test_registers();
    test_convert();
    test_query_flag();
    test_config_store();
    test_mcp_jsonrpc();
    test_http_surface();
    test_lwt_select();
    test_ou_stale();
    test_no_publish();
    test_config_model();
    test_board_pins();
    test_ha_device();
    test_board_pins_local();
    test_board_presets();
    test_led_pattern();
    test_button();
    test_discovery();
    test_binary_catalog();
    test_refrigerant_pressure_catalog();
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
    test_timestamp();
    test_hexdump();
    test_link_watch();
    test_wifi_rollback();
    test_reset_reason();
    test_boot_guard();
    test_health_gate();
    test_captive();
    test_ws_policy();
    test_ws_tx_gate();
    test_http_body();
    test_uart_plan();
    test_detect_backoff();
    test_version_cmp();
    test_ota_manifest();
    test_ota_channel();
    test_profile_view();
    test_feature_gate();
    if (g_failures == 0) { std::printf("all logic tests passed\n"); return 0; }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
