// Host logic tests for the IDF-free pure headers in main/logic/. One translation unit; run via
// scripts/run-mock-tests.sh (cmake+ctest, or a direct g++/clang++ compile). CI's gates job runs it
// with coverage and gates the firmware build on this. Add a CHECK here whenever you touch a
// converter / CRC / the config model / a discovery payload — the riskiest, silently-wrong parts.
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <map>
#include <set>
#include <string>

#include "logic/availability.hpp"
#include "logic/conv_override.hpp"
#include "logic/board_pins.hpp"
#include "logic/board_presets.hpp"
#include "logic/fault_state.hpp"
#include "logic/raw_capture.hpp"
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
#include "logic/checkup.hpp"
#include "logic/health_gate.hpp"
#include "logic/version_cmp.hpp"
#include "logic/ota_channel.hpp"
#include "logic/ui_lang.hpp"
#include "logic/ota_manifest.hpp"
#include "logic/heartbeat.hpp"
#include "logic/http_body.hpp"
#include "logic/json.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/link_watch.hpp"
#include "logic/feature_gate.hpp"
#include "logic/history.hpp"
#include "logic/lwt_select.hpp"
#include "logic/profile_view.hpp"
#include "logic/ou_stale.hpp"
#include "logic/cop_scope.hpp"
#include "logic/mqtt_uri.hpp"
#include "logic/modbus.hpp"
#include "logic/modbus_snapshot.hpp"
#include "logic/query_flag.hpp"
#include "logic/redact.hpp"
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
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "def/signatures.hpp"
#include "def/homehub.hpp"
#include "logic/homehub_map.hpp"

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

    // Test the safety boundary check (reply_len_fits) with a 64-byte buffer:
    const size_t test_buflen = 64;
    // 1. Valid cases: length within buffer capacity
    CHECK(reply_len_fits(12, test_buflen) == true);
    CHECK(reply_len_fits(64, test_buflen) == true);
    CHECK(reply_len_fits(0, test_buflen) == true);

    // 2. Provoke and test out-of-bounds cases:
    // Length exactly 1 byte over capacity (should be rejected)
    CHECK(reply_len_fits(65, test_buflen) == false);
    // Extreme overrun case, e.g. 257 bytes due to a 0xFF corrupt length byte (should be rejected)
    CHECK(reply_len_fits(257, test_buflen) == false);
    // Negative length case (should be rejected)
    CHECK(reply_len_fits(-1, test_buflen) == false);

    // The STATIC length is now bound-checked too (hp_comm.cpp's hp_query, before the request goes
    // out) — the dynamic override was checked from the start while reply_len()'s own answer was
    // trusted. Pin the property that made that safe in practice, over EVERY register a query can
    // name rather than the four spot-checked above, so a new S-protocol entry returning something
    // larger than the 64 bytes both call sites pass fails here instead of on the bus. Also pins
    // that no reply length is negative, which is the other half of what reply_len_fits refuses.
    for (int r = 0; r <= 0xFF; r++) {
        const uint8_t reg = static_cast<uint8_t>(r);
        for (Protocol p : {Protocol::I, Protocol::S}) {
            const int n = reply_len(reg, p);
            CHECK(n > 0);
            CHECK(reply_len_fits(n, 64));
        }
    }
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

    // conv 300..307 = bit b (0 = LSB) of data[0] -> numeric 1/0.
    const uint8_t bits[] = {0x80};                     // only bit 7 set
    ValueDef b7{0x10, 1, 307, 1, -1, "b7"};
    ValueDef b0{0x10, 1, 300, 1, -1, "b0"};
    CHECK(convert(b7, bits).ok && approx(convert(b7, bits).value, 1.0));
    CHECK(convert(b0, bits).ok && approx(convert(b0, bits).value, 0.0));
    CHECK(convert(b7, bits).text[0] == '\0' && convert(b0, bits).text[0] == '\0');

    // conv 217 = operation mode; conv 315 = indoor mode from the HIGH nibble.
    ValueDef om{0x10, 0, 217, 1, -1, "om"};
    const uint8_t m1[] = {0x01};
    CHECK(std::string(convert(om, m1).text) == "Heating");
    const uint8_t m5[] = {0x05};
    const uint8_t m6[] = {0x06};
    CHECK(std::string(convert(om, m5).text) == "Auto Cool");   // mode index 5 = Auto Cool
    CHECK(std::string(convert(om, m6).text) == "Auto Heat");   // mode index 6 = Auto Heat

    // Index 0 is the IDLE state and reads "Stop" — NOT the split-air-conditioner table's "Fan
    // Only", a mode a hydronic Altherma does not have (#216). Pinned as a PAIR against the wire
    // bytes logic/raw_capture.hpp took across one stopped->running edge on a live Altherma 3 R W,
    // because a single sample cannot tell a wrong LABEL from a table shifted by one: index 0 was
    // observed only at rest and index 1 only during the run, and index 1 was already correct.
    // Nothing else can catch this — reading_plausible() returns early on text (no enum value is
    // ever bounded), the domain audit judges converter ids and byte layout rather than whether a
    // label is true of the product, and a metrics consumer drops strings entirely, so the row has
    // no VictoriaMetrics series in which a wrong mode could be noticed.
    const uint8_t m0[] = {0x00};                        // raw 0x10 [00 04 …] — compressor at rest
    CHECK(std::string(convert(om, m0).text) == "Stop");
    CHECK(std::string(convert(om, m0).text) != "Fan Only");
    CHECK(std::string(convert(om, m1).text) == "Heating");   // raw 0x10 [01 …] — same run, running
    // The idle label agrees with the INDOOR table's own index 0 (conv 315, §4.2), which had it
    // right all along — the two now answer "the plant is not running" with one word, not two.
    CHECK(std::string(convert(om, m0).text) == std::string(IU_MODE[0]));
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

    // conv 211 = numeric fan step (including 0); conv 316 = hybrid mode.
    ValueDef fs{0x30, 1, 211, 1, -1, "fs"};
    const uint8_t f0[] = {0x00};
    const uint8_t f5[] = {0x05};
    CHECK(convert(fs, f0).ok && approx(convert(fs, f0).value, 0.0));
    CHECK(convert(fs, f0).text[0] == '\0');
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

    // ── KNOWN DEFECT WITNESS — Target Evap. Temp. on page 0x10/6 (issue #194) ─────────────────────
    // The envelope above has a measured hole, and this pins it so neither side can drift silently.
    //
    // MEASURED on a live 4-8 kW unit (profile altherma_ebla_edla_d_series_4_8kw_monobloc, firmware
    // 1.0.0-dev.188, 2026-07-26): this row tracks the compressor cycle rather than sitting on a
    // placeholder. At rest it decodes to 240.6 °C and IS dropped (>200, the `evap2316` case above is
    // the same shape). During a DHW run it dips to 145.9 °C and climbs back to 199.6 °C — all of
    // which land INSIDE [-60, 200] and reach Home Assistant as real target temperatures. Three
    // separate runs in an 18-hour window showed the identical shape.
    //
    // The decode is NOT the drift: the catalog row is conv 114 / size 2 / type 1 at 0x10 offset 6 in
    // 44 of 45 profiles, docs/REGISTERS.md §5 says exactly that, and conv 114 is implemented exactly
    // as §3.1 specifies. Offset shift, endianness and width are all ruled out in #194 (a one-byte
    // shift yields 2611.2 °C or 0.9 °C at rest). What is left is a SCALE mismatch — ×0.1 is 10x too
    // coarse for this row on this family. Under ×0.01 the same raw bytes read 24.06 °C at rest
    // (ambient measured 22.5-23.0 °C, i.e. an idle coil at air temperature) and 14.59 °C running,
    // 6-8 K below ambient: a textbook air-source evaporator approach.
    //
    // RESOLVED in #194 — the scale is ÷128, i.e. the row is encoded with conv 109 and the generated
    // tables point it at conv 114. See logic/conv_override.hpp for the full argument; the decisive
    // evidence is STRUCTURAL rather than physical, which is what makes it safe to act on where a
    // range that merely "looks nicer" would not be. conv 114 publishes raw × 0.1 at one decimal, so
    // every value this row has ever published carries its 16-bit register exactly — and all 54
    // distinct integers ever observed (46 run-time from the stored series, 8 at rest from the
    // boot-time page dumps) satisfy raw == floor(128 × T) for T on an exact 0.1 K grid. The set
    // {floor(12.8k)} has density 1/12.8 among the integers, so that is p ~ 1.6e-60 against any other
    // scale. ×0.01 — #194's own preferred candidate, picked because 24.06 °C at rest "looked like
    // ambient" — has no such grid, and its ambient cross-check was against the X10A outdoor reading,
    // which #209 later proved is HELD OVER at rest (logic/ou_stale.hpp): it was comparing a stale
    // number. Against the independent HomeHub sensor the row does not track ambient at all.
    //
    // conv 114 itself is NOT touched: it is a correct ×0.1 converter and three other rows use it.
    // This is the #35-#39 shape — a wrong converter ID on a right register — not a wrong converter.
    const uint8_t evap1996[] = {0xCC, 0x07};           // LE 0x07CC = 1996 -> 199.6 °C, MEASURED
    const uint8_t evap1459[] = {0xB3, 0x05};           // LE 0x05B3 = 1459 -> 145.9 °C, MEASURED (run min)
    const uint8_t evap2406[] = {0x66, 0x09};           // LE 0x0966 = 2406 -> 240.6 °C, MEASURED (at rest)
    CHECK(approx(convert(evap, evap1996).value, 199.6));   // spec-conformant decode of the real bytes
    CHECK(approx(convert(evap, evap1459).value, 145.9));
    CHECK(approx(convert(evap, evap2406).value, 240.6));
    // The two run-time readings are impossible as an evaporating temperature — a coil that absorbs
    // heat from 22.5 °C air cannot itself be at 145-200 °C — yet the ENVELOPE admits both. That hole
    // is unchanged and is asserted here as the standing contradiction it is.
    CHECK(reading_plausible(evap, convert(evap, evap1996)));   // <- still WRONG, still inside ±200
    CHECK(reading_plausible(evap, convert(evap, evap1459)));   // <- still WRONG, still inside ±200
    CHECK(!reading_plausible(evap, convert(evap, evap2406)));  // the at-rest value IS caught (>200)
    // Decoded as the wire actually encodes it, the SAME bytes read as a textbook evaporating
    // temperature — and now inside the envelope for the right reason rather than by luck.
    const ValueDef evap_fix = logic::adjudicated(evap);
    CHECK(evap_fix.conv == 109);                                    // 114 -> 109 (÷128)
    CHECK(approx(convert(evap_fix, evap1996).value, 1996 / 128.0));   // 15.59 -> 15.6 °C; was 199.6
    CHECK(approx(convert(evap_fix, evap1459).value, 1459 / 128.0));   // 11.40 °C; was 145.9 (run min)
    CHECK(approx(convert(evap_fix, evap2406).value, 2406 / 128.0));   // 18.80 °C; was 240.6 (dropped)
    CHECK(reading_plausible(evap_fix, convert(evap_fix, evap1996)));
    CHECK(reading_plausible(evap_fix, convert(evap_fix, evap1459)));
    CHECK(reading_plausible(evap_fix, convert(evap_fix, evap2406))); // the at-rest value now SURVIVES
    // The quarantine is lifted BECAUSE the row is decoded correctly, not because anyone stopped
    // worrying: the ledger entry moved from availability.hpp to conv_override.hpp, and this asserts
    // that the row publishes again on the corrected converter.
    CHECK(row_publishable(evap_fix));
    CHECK(value_available(evap_fix, true, convert(evap_fix, evap1996).value));
    CHECK(value_available(evap_fix, true, convert(evap_fix, evap1459).value));
    // Precision comes along for free: 109 is in the ×0.1/÷256 scaled family, so it still prints one
    // decimal. A silent drop to 0 decimals would round 15.6 °C to 16 and lose the 0.1 K grid that is
    // the whole evidence base.
    CHECK(display_decimals(109) == 1);
    // Its neighbour is NOT quarantined — the row publishes, and only its unpopulated raw 0x0000 is
    // withheld (#209 defect 2). Two rows, two different verdicts, one ledger.
    const ValueDef cond{0x10, 8, 114, 2, 1, "Target Cond. Temp."};
    CHECK(row_publishable(cond));
    const uint8_t cond_zero[] = {0x00, 0x00};
    CHECK(convert(cond, cond_zero).ok && approx(convert(cond, cond_zero).value, 0.0));
    CHECK(!value_available(cond, true, convert(cond, cond_zero).value));
    // The scale hypothesis, recorded as arithmetic so #194's candidates stay concrete: the same raw
    // bytes under x0.01 are ordinary temperatures either side of the measured 22.5-23.0 °C ambient.
    CHECK(approx(convert(evap, evap2406).value * 0.1, 24.06));   // at rest  ~= ambient
    CHECK(approx(convert(evap, evap1459).value * 0.1, 14.59));   // running  ~= 8 K below ambient

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

    // The HomeHub Modbus stack (issue #32). Checked unconditionally, so the defaults must still pass
    // on a device with no HomeHub and only a bad value trips. mb_host is free text — empty is valid
    // (that IS the auto-discovery case).
    CHECK(c.mb_port == 502 && c.mb_unit_id == 1);      // the defaults from MODBUS_TCP_PORT/UNIT
    CHECK(validate(c, why));                            // default (no address at all) is valid
    c.mb_host = "";
    CHECK(validate(c, why));                            // empty host = no manual address, valid
    c.mb_host = "homehub-524288-abc.local";
    CHECK(validate(c, why));                            // an explicit .local host is fine
    c.mb_port = 0;   CHECK(!validate(c, why));          // port out of range
    c.mb_port = 65536; CHECK(!validate(c, why));
    c.mb_port = 502; CHECK(validate(c, why));
    c.mb_unit_id = 0;   CHECK(!validate(c, why));       // unit id out of the Modbus 1..247 range
    c.mb_unit_id = 248; CHECK(!validate(c, why));
    c.mb_unit_id = 1; CHECK(validate(c, why));
    c.mb_host = "";                                     // reset to default for the checks below

    // THE ADDRESS IS THE SWITCH — there is no enable flag to disagree with it. Manual entry wins
    // over what the one-shot search found, and does NOT erase it: clearing the field must fall back
    // to the search result rather than to nothing.
    Config m;
    CHECK(config_modbus_host(m).empty());               // nothing known
    CHECK(config_modbus_should_search(m));              // ... so the one-shot search is armed
    apply_modbus_found(m, "homehub-524288-abc");
    CHECK(config_modbus_host(m) == "homehub-524288-abc");
    CHECK(!config_modbus_should_search(m));             // and disarms itself
    m.mb_host = "203.0.113.131";
    CHECK(config_modbus_host(m) == "203.0.113.131");    // manual wins
    m.mb_host.clear();
    CHECK(config_modbus_host(m) == "homehub-524288-abc");   // ... without erasing the discovery
    // A search that finds NOTHING must disarm just as firmly. This is the case the latch exists for:
    // without it, a LAN with no gateway is browsed again on every boot, forever, and "one-shot" is
    // only true when the search succeeds.
    Config mb_none;
    apply_modbus_found(mb_none, "");
    CHECK(config_modbus_host(mb_none).empty() && mb_none.mb_searched);
    CHECK(!config_modbus_should_search(mb_none));
    // A typed address is enough on its own, and must NOT arm the search: typing one is a deliberate
    // act, and browsing the LAN to second-guess it would be the opposite of one-shot.
    Config mb_manual;
    mb_manual.mb_host = "10.0.0.9";
    CHECK(config_modbus_host(mb_manual) == "10.0.0.9");
    CHECK(!config_modbus_should_search(mb_manual));

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

    // ── What POST /set_board owes a request (#257) ──────────────────────────────────────────────
    // Two facts move independently, so all four combinations are asserted. The one that shipped
    // broken is `values same, statement new`: it is a SAVE with NO reboot, and collapsing it into
    // "nothing changed" dropped the statement — the modal then re-opened on "Custom" and the user
    // re-picked their own board forever, each time getting no reboot and one grey toast.
    Config stored;                       // a device still carrying the build defaults
    stored.led_gpio = 21; stored.led_type = static_cast<int>(LedType::Gpio); stored.led_inverted = true;
    stored.btn_gpio = -1; stored.btn_active_low = true; stored.board_user_set = false;
    Config want = stored;                // the user picks the preset the device already carries
    want.board_user_set = true;          // ...which the submit itself states
    CHECK(board_hw_same(want, stored));
    CHECK(board_save_needed(want, stored));      // the statement is new -> persist it
    CHECK(!board_reboot_needed(want, stored));   // ...but no driver's pin moved -> no reboot
    // Once recorded, the same submit really is a no-op: neither a save nor a reboot.
    Config recorded = stored; recorded.board_user_set = true;
    CHECK(!board_save_needed(want, recorded));
    CHECK(!board_reboot_needed(want, recorded));
    // A hardware change is both, whether or not the statement was already on record.
    Config atom = want;
    atom.led_gpio = 35; atom.led_type = static_cast<int>(LedType::Ws2812); atom.led_inverted = false;
    atom.btn_gpio = 41;
    CHECK(!board_hw_same(atom, recorded));
    CHECK(board_save_needed(atom, recorded) && board_reboot_needed(atom, recorded));
    CHECK(board_save_needed(atom, stored)   && board_reboot_needed(atom, stored));
    // Each of the five values on its own counts as a hardware change — a polarity flip is a real
    // rewiring of the drive level, not cosmetics, and an unnoticed one leaves a dark board.
    for (int f = 0; f < 5; f++) {
        Config one = recorded;
        if (f == 0) one.led_gpio = 33;
        if (f == 1) one.led_type = static_cast<int>(LedType::Ws2812);
        if (f == 2) one.led_inverted = !one.led_inverted;
        if (f == 3) one.btn_gpio = 41;
        if (f == 4) one.btn_active_low = !one.btn_active_low;
        CHECK(!board_hw_same(one, recorded));
        CHECK(board_reboot_needed(one, recorded) && board_save_needed(one, recorded));
    }
    // The statement is never RETRACTED by a request: /set_board only ever sets it, so a stored
    // `true` against a would-be `false` is not a reason to write (only the values could be).
    Config unstated = recorded; unstated.board_user_set = false;
    CHECK(!board_save_needed(unstated, recorded));
    // A fresh Config has made no claim — that is what keeps a newly flashed board unnamed.
    CHECK(!Config{}.board_user_set);

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
    //
    // The entity id also carries the row's register GROUP (#221) — unlike the val_tpl KEY above,
    // which must not change (it is the state contract and the VictoriaMetrics series suffix, #217).
    CHECK(cfg.find("\"uniq_id\":\"daikin_altherma_esp32_hydronic_temps_dhw_tank_temp_r5t\"")
          != std::string::npos);
    CHECK(cfg.find("\"uniq_id\":\"daikin_abc123") == std::string::npos);
    // An UNAMBIGUOUS label is not renamed. Load-bearing: HA derives the default entity_id from the
    // name, so rewriting every name would strand every entity's recorder history — only the handful
    // of labels the catalog reuses across pages are group-qualified (AMBIGUOUS_LABEL_SLUGS).
    CHECK(cfg.find("\"name\":\"DHW Tank Temp (R5T)\"") != std::string::npos);
    // …and the board id rides along as a SECOND device identifier: HA matches a device by any of
    // them, so an install set up under the old MAC-only identity is merged, not duplicated.
    CHECK(cfg.find("\"dev\":{\"ids\":[\"daikin_altherma_esp32\",\"daikin_abc123\"]") != std::string::npos);

    // A non-binary row keeps the sensor component and carries no binary payload contract.
    CHECK(std::string(ha_component(def)) == "sensor");
    CHECK(discovery_topic("homeassistant", node, def)
          == "homeassistant/sensor/daikin_altherma_esp32/hydronic_temps_dhw_tank_temp_r5t/config");
    // The same builder with the BOARD id yields the MAC-era topic the bridge retracts on the first
    // announce after an upgrade — the only configs a board can clean up are the ones it published.
    CHECK(discovery_topic("homeassistant", board, def)
          == "homeassistant/sensor/daikin_abc123/hydronic_temps_dhw_tank_temp_r5t/config");
    CHECK(cfg.find("\"pl_on\"") == std::string::npos);

    // --- Bit-flag rows are binary_sensors reading 1/0, not text sensors reading "ON"/"OFF" ---
    // A slug that starts with a digit must stay valid — bracket notation, not attribute access.
    ValueDef way{0x60, 12, 307, 1, -1, "2way valve(On:Heat_Off:Cool)"};
    std::string wc = discovery_config(node, board, st, availability_topic(base), way);
    CHECK(wc.find("value_json['hydronic']['2way_valve_on_heat_off_cool']") != std::string::npos);

    CHECK(std::string(ha_component(way)) == "binary_sensor");
    CHECK(discovery_topic("homeassistant", node, way)
          == "homeassistant/binary_sensor/daikin_altherma_esp32/"
             "hydronic_2way_valve_on_heat_off_cool/config");
    // pl_on/pl_off must be SPELLED OUT: the state is the number 1/0, HA's defaults are "ON"/"OFF",
    // and a mismatch leaves the entity stuck at `unknown` rather than failing loudly.
    CHECK(wc.find("\"pl_on\":\"1\",\"pl_off\":\"0\"") != std::string::npos);
    // dataType -1 -> no unit, no device_class, and hence no state_class either.
    CHECK(wc.find("\"unit_of_meas\"") == std::string::npos);
    CHECK(wc.find("\"dev_cla\"") == std::string::npos);
    CHECK(wc.find("\"stat_cla\"") == std::string::npos);
    // The two PRE-#221 shapes the bridge deletes on the first announce after an upgrade: the bare
    // label slug, no register group, under each component. Frozen literals — a delete built from
    // today's helpers would target today's topic and remove nothing.
    CHECK(ungrouped_discovery_topic("homeassistant", node, "sensor", way)
          == "homeassistant/sensor/daikin_altherma_esp32/2way_valve_on_heat_off_cool/config");
    CHECK(ungrouped_discovery_topic("homeassistant", node, "binary_sensor", way)
          == "homeassistant/binary_sensor/daikin_altherma_esp32/2way_valve_on_heat_off_cool/config");
    // …and now a NON-binary row has a stale shape to retract too. Before #221 it did not — the "old"
    // topic WAS the current one, which is precisely why the two Error Code rows shared it. This one
    // line is the fix.
    CHECK(ungrouped_discovery_topic("homeassistant", node, "sensor", def)
          != discovery_topic("homeassistant", node, def));

    // --- #221: two rows, one label, two register pages -> two entities, not one ------------------
    // The real colliding pair, on the profile the live unit detects as. Before the fix these were
    // announced under ONE uniq_id on ONE topic, so HA created a single "Error Code" entity and a
    // unit reporting both an outdoor and a hydronic fault showed one of them — with no error
    // anywhere, since the state payload was correct throughout.
    ValueDef ou_err{0x10, 5, 204, 1, -1, "Error Code"};
    ValueDef hy_err{0x60, 3, 204, 1, -1, "Error Code"};
    CHECK(object_id(ou_err.label) == object_id(hy_err.label));         // the labels DO collide...
    CHECK(discovery_topic("homeassistant", node, ou_err)               // ...the entities do not
          != discovery_topic("homeassistant", node, hy_err));
    const std::string oc = discovery_config(node, board, st, availability_topic(base), ou_err);
    const std::string hc = discovery_config(node, board, st, availability_topic(base), hy_err);
    CHECK(oc.find("\"uniq_id\":\"daikin_altherma_esp32_outdoor_state_error_code\"")
          != std::string::npos);
    CHECK(hc.find("\"uniq_id\":\"daikin_altherma_esp32_hydronic_error_code\"") != std::string::npos);
    // Distinct NAMES too, or HA derives one entity_id from both and the second lands as `..._2` —
    // the outcome this issue exists to avoid. This label is on AMBIGUOUS_LABEL_SLUGS for that reason.
    CHECK(oc.find("\"name\":\"Outdoor State Error Code\"") != std::string::npos);
    CHECK(hc.find("\"name\":\"Hydronic Error Code\"") != std::string::npos);
    // The STATE contract is untouched: same key, each already in its own group object (#217).
    CHECK(oc.find("value_json['outdoor_state']['error_code']") != std::string::npos);
    CHECK(hc.find("value_json['hydronic']['error_code']") != std::string::npos);

    // The binary family is exactly 300-307 (one bit of data[0]); neighbours are not binary.
    CHECK(!conv_is_binary(299) && !conv_is_binary(308) && !conv_is_binary(105));
    for (int c = 300; c <= 307; c++) CHECK(conv_is_binary(c));
}

// Every bit-flag row in the SHIPPED catalog must decode both states directly to numeric 1/0 AND be
// announced to Home Assistant as a binary_sensor whose payload contract matches those numbers.
// This prevents any firmware consumer from seeing text ON/OFF or HA displaying a plain numeric
// sensor, and pins the layout the discovery branch assumes (size 1, dataType -1 -> no unit/device
// class to reconcile).
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
            CHECK(on.ok && off.ok);
            CHECK(on.text[0] == '\0' && off.text[0] == '\0');
            CHECK(approx(on.value, 1.0));
            CHECK(approx(off.value, 0.0));
            // ...and 1/0 must land in the state JSON UNQUOTED, or a metrics consumer drops it again.
            CHECK(build_grouped_json({{"test", "flag", on.value ? "1" : "0"}})
                  == "{\"test\":{\"flag\":1}}");
            CHECK(build_grouped_json({{"test", "flag", off.value ? "1" : "0"}})
                  == "{\"test\":{\"flag\":0}}");
            CHECK(std::string(ha_component(d)) == "binary_sensor");
            const std::string cfg =
                discovery_config("daikin_test", "daikin_board", "daikin/state", "daikin/status", d);
            CHECK(cfg.find("\"pl_on\":\"1\",\"pl_off\":\"0\"") != std::string::npos);
            CHECK(discovery_topic("homeassistant", "daikin_test", d)
                  == "homeassistant/binary_sensor/daikin_test/" + row_object_id(d) + "/config");
            checked++;
        }
    }
    CHECK(checked > 500);   // ~30 binary rows x 44 profiles — the catalog really was traversed
    // Publication guard for a future enum that might decode to these exact words.
    CHECK(std::string(on_off_number("ON")) == "1");
    CHECK(std::string(on_off_number("OFF")) == "0");
    CHECK(on_off_number("Heating") == nullptr);
    CHECK(on_off_number("on") == nullptr);
    CHECK(on_off_number(nullptr) == nullptr);
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

// The two DEMAND flags, and the one property the web UI's row selection rests on: each of the two
// labels resolves to exactly ONE register page across the whole shipped catalog.
//
// This exists because of a defect the other gates could not see (#199). The dashboard's heating
// riser drew a pill from "Thermostat ON/OFF" and called it the room thermostat — placement, title
// and explainer all said "the room is calling for heat". But that row is 0x60/2 bit 3, a bit in the
// INDOOR UNIT's status byte, beside I/U operation mode and freeze protection: it is Daikin's
// thermo-ON, ON for a hot-water charge exactly as readily as for the house. Measured on a live unit
// over three days, it was ON 128/119/91 minutes per day and NOT ONE of those minutes had the 3-way
// valve pointing at space heating — every one was a DHW charge, drawn as a room demanding heat while
// the room sat exactly on its setpoint. A physically true reading attributed to the wrong component:
// the #35-#39 shape, which no converter, unit or spec check can catch because nothing about the
// VALUE is wrong. The branch's own request is "Space heating Operation ON/OFF" (0x62/2 bit 3), and
// that is what the pill draws now.
//
// The browser picks both rows by LABEL (www/app.js liveData). That is only sound while a label means
// one thing, and docs/REGISTERS.md §5 documents a SECOND "Thermostat ON/OFF" — page 0x10 offset 1
// bit 7, the outdoor unit's own — which no generated profile currently carries. def/overlay.hpp says
// in as many words that the generator's page-0x10 input is narrower than the spec and that the
// missing rows are expected to arrive. On the day they do, this test fails, and whoever runs the
// generator learns that the browser's selection has to become structural (keyed on `reg`, the way
// the ou_stale page rule already is) before the catalog can ship. Failing here is the point.
static void test_demand_flag_catalog() {
    int thermostat = 0, space_heating = 0;
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p);            // the rows a consumer actually sees
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef& d = v[i];
            std::string lbl;
            for (const char* c = d.label; c && *c; c++) lbl += static_cast<char>(std::tolower(*c));
            if (lbl.rfind("thermostat on", 0) == 0) {           // the JS matches /thermostat on/i
                CHECK(d.reg == 0x60); CHECK(d.offset == 2); CHECK(d.conv == 303);
                thermostat++;
            }
            // Anchored, like the JS: "Space H Operation output" (0x62/8) is the OUTPUT terminal's
            // state, a different row, and must not be mistaken for the request.
            if (lbl.rfind("space heating operation", 0) == 0) {
                CHECK(d.reg == 0x62); CHECK(d.offset == 2); CHECK(d.conv == 303);
                space_heating++;
            }
        }
    }
    // Traversal proof: both rows are near-universal, so a selection that silently stops finding
    // either (a renamed label, a dropped row) fails here rather than blanking a pill in the field.
    CHECK(thermostat    >= 35);
    CHECK(space_heating >= 40);
}

// The dashboard selects the tank's electric immersion heater with /^bsh$/i. Keep that label pinned
// to the X10A BSH run flag and separate from "Thermal protector BSH": confusing the two would either
// hide a real electric DHW boost or announce heater operation from a protection input.
static void test_bsh_flag_catalog() {
    int bsh = 0, protector = 0;
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef& d = v[i];
            std::string lbl;
            for (const char* c = d.label; c && *c; c++) lbl += static_cast<char>(std::tolower(*c));
            if (lbl == "bsh") {
                CHECK(d.reg == 0x60);
                CHECK(d.offset == 12);
                CHECK(d.conv == 305);
                bsh++;
            }
            if (lbl == "thermal protector bsh") {
                CHECK(d.reg == 0x60);
                CHECK(d.offset == 11);
                CHECK(d.conv == 305);
                protector++;
            }
        }
    }
    CHECK(bsh >= 40);
    CHECK(protector >= 40);
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

    // ── detect_best I/U-capacity fallback (a real unit's case): the full 0x1bff page set but the O/U
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

    // ── #225: the candidate SET must narrow by the same I/U capacity the representative ranks by ──
    // detect_best applied the fallback while detect_candidates ignored it, so on the live unit
    // /status reported 8 candidates across 4 marketing families while the ranking had already been
    // constrained to the 4-8 kW class. That is not cosmetic: the header's contract is that the set
    // is register-equivalent ONLY when the capacity is known, and this is precisely the state where
    // it is not — an over-broad set is a claim the code cannot back. It has already done damage on
    // paper (#213 recorded one unit as two independent families, corrected in #219).
    Fingerprint live{};                                  // the live board's fingerprint, verbatim
    live.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1});
    CHECK(live.page_mask == 0x1bff);                     // as printed by the device's detect diag line
    live.kw_tenths    = -1;                              // short 0x00 descriptor -> O/U capacity absent
    live.iu_kw_tenths = 80;                              // I/U capacity code 0x60/6 = 8.0 kW
    int lcount = detect_candidates(sigs, nsig, live, out, 64);
    CHECK(lcount == 5);                                  // was 8 before the narrowing
    // No survivor's class CONTRADICTS 8.0 kW. The 14-16 kW and 9-16 kW candidates are gone; the
    // remaining spread is 4-8 kW plus profiles that state no class at all.
    for (int i = 0; i < lcount; i++) {
        int clo = -1, chi = -1;
        if (parse_kw_class(out[i], clo, chi)) CHECK(clo <= 80 && 80 <= chi);
    }
    // The unit really installed is an Altherma 3 R W (ERGA04-08E / EHBH-E). It must survive the
    // narrowing — a filter that dropped the true model would be far worse than the broad set.
    CHECK(has_candidate(out, lcount, "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    // A class-less profile SURVIVES: nothing about it contradicts 8.0 kW, and dropping it would be
    // ranking ("a better-evidenced candidate exists") deciding membership ("consistent with the
    // unit"). Written the other way round — keep only positive matches — this filter silently
    // dropped altherma_gshp2 from a set it belongs in, which is what the case above catches.
    CHECK(has_candidate(out, lcount, "altherma_top_grade"));          // id carries no kW class
    CHECK(!parse_kw_class("altherma_top_grade", lo, hi));             // ...as this states outright
    // What it DOES exclude: a class that cannot hold 8.0 kW.
    CHECK(!has_candidate(out, lcount, "altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw"));
    CHECK(!has_candidate(out, lcount, "altherma_ebla_edla_ewaa_ewya_d_series_9_16kw"));
    // Still ambiguous, and still honestly so: no bus datum separates the survivors. Narrowing a set
    // is not resolving it, and /status must keep saying it cannot name one model.
    CHECK(lcount > 1);

    // The narrowing may not move the representative. It cannot, by construction — detect_best ranks
    // a capacity match above everything except page overlap, which the filter holds fixed — but that
    // is the kind of argument that stops being true after an edit, so it is asserted.
    CHECK(detect_best(sigs, nsig, live) && has_candidate(out, lcount, detect_best(sigs, nsig, live)));

    // The corroboration guard, in the direction that matters more: an I/U capacity contained in NO
    // surviving class (an unusual pairing, a misread byte) is not evidence about this unit. Acting
    // on it would exclude every CLASSED candidate at once and leave only the class-less ones — not
    // merely a broad set but a wrong one, and a set narrowed onto the wrong models does not read as
    // uncertain the way a broad one does. So the fallback is simply not applied.
    Fingerprint odd = live;
    odd.iu_kw_tenths = 999;                              // 99.9 kW: in no class in the catalog
    const int ocount = detect_candidates(sigs, nsig, odd, out, 64);
    CHECK(ocount == 8);                                  // unfiltered, exactly as before #225
    CHECK(has_candidate(out, ocount, "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    CHECK(detect_best(sigs, nsig, odd) != nullptr);
    // And it is a strict no-op when there is no fallback to apply at all.
    Fingerprint nofbk = live;
    nofbk.iu_kw_tenths = -1;
    CHECK(detect_candidates(sigs, nsig, nofbk, out, 64) == 8);
    // ...or when the O/U capacity IS known: signature_consistent has already filtered to matching
    // classes, so every survivor matches and the filter can remove nothing.
    Fingerprint known = live;
    known.kw_tenths = 60; known.iu_kw_tenths = 160;      // contradictory hint, deliberately
    int kcount = detect_candidates(sigs, nsig, known, out, 64);
    CHECK(kcount > 0);
    for (int i = 0; i < kcount; i++) {                   // the O/U figure decides, not the I/U one
        int clo = -1, chi = -1;                          // (class-less profiles survive here too)
        if (parse_kw_class(out[i], clo, chi)) CHECK(clo <= 60 && 60 <= chi);
    }
    // Specifically: nothing in the 16 kW class the I/U hint pointed at slipped through.
    CHECK(!has_candidate(out, kcount, "altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw"));

    // Catalog-wide: the representative is ALWAYS a member of the reported set. This is the property
    // the narrowing could most easily have broken (filter the set on one rule, rank on another, and
    // /status names a model it does not list), so it is swept over every profile's own page set at
    // several capacities rather than checked on the one fingerprint that motivated the change.
    for (int i = 0; i < nsig; i++) {
        for (const int iu : {-1, 30, 80, 160, 999}) {
            Fingerprint s{};
            s.page_mask = sigs[i].page_mask;
            s.kw_tenths = -1;
            s.iu_kw_tenths = iu;
            const char* b = detect_best(sigs, nsig, s);
            const char* sout[64];
            const int sn = detect_candidates(sigs, nsig, s, sout, 64);
            CHECK((b == nullptr) == (sn == 0));          // both find something, or neither does
            if (b) CHECK(has_candidate(sout, sn, b));
        }
    }

    // Generic Altherma fallback = the universal register core (not the old 3-row stub); an unknown id
    // resolves to it — this is what an unrecognized / S-protocol unit reads with.
    CHECK(def::lookup("generic").count > 40);
    CHECK(std::string(def::lookup("no_such_profile").id) == "generic");

    // ── #214: what ONE lost page reply costs, and the rule that stops it being acted on ──
    // The page probe gathers the unit's IDENTITY, not its values, and signature_consistent() matches
    // on page SUBSET — so clearing a single bit can make every profile inconsistent at once. Measured
    // here against the real signatures rather than asserted in prose, because the number is the whole
    // argument for retrying the probe: on the live 0x1bff fingerprint, MOST single-page losses leave
    // no candidate at all, and the caller then reads with `generic`.
    // Reuses the `live` fingerprint built for #225 above — one definition of what the real board
    // put on the bus, so the two blocks cannot come to describe different units.
    const char* live_best = detect_best(sigs, nsig, live);
    CHECK(live_best != nullptr);
    int collapses = 0, changes = 0;
    for (int b = 0; b < 13; b++) {
        if (!(live.page_mask & (1u << b))) continue;
        Fingerprint lost = live;
        lost.page_mask &= ~(1u << b);
        const char* lb = detect_best(sigs, nsig, lost);
        if (lb == nullptr) collapses++;                 // -> caller falls back to `generic`
        else if (std::string(lb) != live_best) changes++;
    }
    // Every single-page loss is consequential — none is harmless. That is the point: there is no
    // "safe" page to drop, so the probe must not drop one.
    CHECK(collapses + changes == 12);
    CHECK(collapses >= 8);                              // measured 8 of 12 fall through to `generic`

    // `generic` is not a near-miss of the real profile — it is a different instrument. Pin the gap
    // so a future catalog edit cannot quietly make the fallback look acceptable.
    CHECK(def::lookup("generic").count < def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc").count);
    {
        bool generic_has_leaving_water = false, generic_has_rps = false;
        const auto& gp = def::lookup("generic");
        for (size_t i = 0; i < gp.count; i++) {
            if (gp.values[i].reg == 0x30) generic_has_rps = true;
            if (logic::lwt_ci_contains(gp.values[i].label, "leaving water")) generic_has_leaving_water = true;
        }
        CHECK(!generic_has_leaving_water);              // no ΔT, no heat output, no COP
        CHECK(!generic_has_rps);                        // no compressor witness for ou_stale either
    }

    // The rule itself: one no-match sweep is not evidence, two are. A transient cannot survive two
    // independent passes; a genuinely unrecognised unit says it twice and is then read with generic.
    CHECK(DETECT_NO_MATCH_CONFIRMATIONS == 2);
    CHECK(!detect_commit_no_match(0));
    CHECK(!detect_commit_no_match(1));                  // the case that used to pin `generic` at once
    CHECK(detect_commit_no_match(2));
    CHECK(detect_commit_no_match(3));                   // saturates — never un-commits

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

    // Bit-flag rows arrive from hp_format as numeric text and therefore land on the wire as bare
    // JSON numbers. A JSON string or bool would be dropped by the metrics consumer.
    CHECK(is_json_number("1") && is_json_number("0"));

    // Grouped JSON: max depth 1, groups+keys in first-seen order, numeric vs string typing. The
    // TYPE comes from the row's kind (its converter), never from the value — see test_published_kind.
    std::vector<GroupedValue> vals = {
        {"outdoor_state", "operation_mode", "Heating", PublishedKind::Text},
        {"hydronic",      "dhw_setpoint",   "48",      PublishedKind::Number},
        {"hydronic",      "lw_setpoint",    "35.4",    PublishedKind::Number},
        {"outdoor_state", "error_type",     "Normal",  PublishedKind::Text},   // earlier group -> same bucket
    };
    const std::string j = build_grouped_json(vals);
    CHECK(j == "{\"outdoor_state\":{\"operation_mode\":\"Heating\",\"error_type\":\"Normal\"},"
               "\"hydronic\":{\"dhw_setpoint\":48,\"lw_setpoint\":35.4}}");
    CHECK(build_grouped_json({}) == "{}");

    // A binary row arrives here already formatted as numeric 1/0, so it must serialize as a bare
    // number next to the text values — not as "1", which would put it back out of reach.
    CHECK(build_grouped_json({{"hydronic", "thermostat_on_off", "1"},
                              {"hydronic", "silent_mode",       "0"}})
          == "{\"hydronic\":{\"thermostat_on_off\":1,\"silent_mode\":0}}");

    // A text value routes through the shared logic/json.hpp encoder, so a control char in one can't
    // break the state topic's JSON either (test_json covers the escaping itself).
    CHECK(build_grouped_json({{"other", "raw", "a\nb", PublishedKind::Text}})
          == "{\"other\":{\"raw\":\"a\\nb\"}}");

    // ── THE TYPE IS THE FIELD'S, NOT THE VALUE'S (#209 defect 3 / the telemetry-contract section) ──
    // A Text field stays quoted even when its value LOOKS numeric, and a Number field stays unquoted
    // even at zero. The measured failure was the other way round — one key alternating between the
    // number 30 and the string "OFF" — and the reason it survived review is that both payloads are
    // individually well-formed. Only asserting the SAME key across BOTH states catches it.
    CHECK(build_grouped_json({{"outdoor_state", "error_code", "00", PublishedKind::Text}})
          == "{\"outdoor_state\":{\"error_code\":\"00\"}}");   // "00" is not a number here
    CHECK(build_grouped_json({{"outdoor_state", "error_code", "U4", PublishedKind::Text}})
          == "{\"outdoor_state\":{\"error_code\":\"U4\"}}");   // …and the type did not move
    CHECK(build_grouped_json({{"actuators", "fan_1_step", "30", PublishedKind::Number}})
          == "{\"actuators\":{\"fan_1_step\":30}}");
    CHECK(build_grouped_json({{"actuators", "fan_1_step", "0", PublishedKind::Number}})
          == "{\"actuators\":{\"fan_1_step\":0}}");            // stopped: numeric zero, never "OFF"

    // FAIL-CLOSED: a Number field handed a non-numeric string is a broken contract. It must not be
    // quoted (that IS the type flip) — the key stays, the type stays, the value is null.
    CHECK(build_grouped_json({{"actuators", "fan_1_step", "OFF", PublishedKind::Number}})
          == "{\"actuators\":{\"fan_1_step\":null}}");

    // The group key doubles as an HA entity-name fragment for the DERIVED companions, which have no
    // catalog label of their own (logic/fault_state.hpp).
    CHECK(group_display_name("outdoor_state") == "Outdoor State");
    CHECK(group_display_name("hydronic") == "Hydronic");
    CHECK(group_display_name("water_hx") == "Water Hx");
    CHECK(group_display_name("") == "");
}

// ── The published JSON TYPE of every converter (#209 defect 3, the telemetry-contract section) ────
// The defect this closes is not "conv 211 is wrong today" (it was fixed in #210) but "nothing stops
// the next converter doing it again". So this walks EVERY implemented converter id over a sweep of
// raw input bytes and asserts that what convert() produces agrees with published_kind() in EVERY
// state — a converter that returns text for one byte and a number for another fails here, whichever
// way published_kind classifies it.
static void test_published_kind() {
    // The full set of ids convert() implements, taken from the switch rather than guessed: anything
    // else returns unimpl and never reaches a publish surface.
    static const int IMPLEMENTED[] = {
        101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
        114, 118, 119, 151, 152, 161, 203, 204, 211, 214, 215, 217, 219,
        300, 301, 302, 303, 304, 305, 306, 307, 310, 311, 315, 316, 405,
        801, 802, 803, 804, 805,
    };
    for (int conv : IMPLEMENTED) {
        const PublishedKind want = published_kind(conv);
        bool saw_number = false, saw_text = false;
        // A sweep wide enough to hit every branch of the enum converters: 0 and 1 (the OFF/first-label
        // cases), the nibble boundaries conv 204 indexes with, and the out-of-range values that make
        // 203/217/315/316 fall through to "?".
        for (int b0 = 0; b0 <= 255; b0++) {
            const uint8_t bytes[2] = {static_cast<uint8_t>(b0), 0x00};
            ValueDef d{0x30, 0, conv, 2, -1, "probe"};
            const Reading r = convert(d, bytes);
            if (r.unimpl) continue;
            if (r.text[0] != '\0') saw_text = true;
            else if (r.ok)         saw_number = true;
            // A row that decodes to NOTHING (conv 405's absent transducer, conv 114's 0x8000) is an
            // absence, not a type — absence is stated by omitting the key, so it constrains nothing.
        }
        // The load-bearing assertion: never both. One field, one type, in every state.
        CHECK(!(saw_number && saw_text));
        if (want == PublishedKind::Text)  CHECK(!saw_number);
        if (want == PublishedKind::Number) CHECK(!saw_text);
    }

    // Spot-check the classification itself, so a wholesale sign error in published_kind (everything
    // Text, say) cannot satisfy the loop above by making both halves vacuous.
    CHECK(published_kind(211) == PublishedKind::Number);   // fan step — the #209 defect-3 row
    CHECK(published_kind(105) == PublishedKind::Number);
    CHECK(published_kind(300) == PublishedKind::Number);   // bit flags are 1/0 NUMBERS, not a 3rd type
    CHECK(published_kind(307) == PublishedKind::Number);
    CHECK(published_kind(203) == PublishedKind::Text);
    CHECK(published_kind(204) == PublishedKind::Text);
    CHECK(published_kind(217) == PublishedKind::Text);
    CHECK(published_kind(315) == PublishedKind::Text);
    CHECK(published_kind(316) == PublishedKind::Text);
    CHECK(published_kind(802) == PublishedKind::Text);
    // An unimplemented id never publishes, so its kind is arbitrary — but it must still be a KIND,
    // not a crash or a third value.
    CHECK(published_kind(999) == PublishedKind::Number);
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
    f.reset_reason      = "panic";
    f.reset_reason_code = 4;        // CrashReason::PANIC — the numeric twin a metrics store can keep
    f.reset_fault       = true;
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
               "\"reset_reason\":\"panic\",\"reset_reason_code\":4,\"reset_fault\":1,"
               "\"wifi_connected\":1,\"wifi_rssi\":-76,\"wifi_reconnects\":3,"
               "\"wifi_mac\":\"A1:B2:C3:D4:E5:F6\",\"wifi_bssid\":\"00:11:22:33:44:55\","
               "\"mqtt_connected\":1,\"mqtt_count\":89282,\"mqtt_fails\":0,\"mqtt_reconnects\":1,"
               "\"bus_connected\":1,\"bus_proto\":\"I\",\"bus_registers\":10,\"bus_values\":48,"
               "\"bus_last_ok_s\":1,\"bus_rx_received\":763732,\"bus_rx_fails\":2,"
               "\"bus_crc_err\":0,\"bus_timeout_err\":2,\"bus_ou_held_over\":0,"
               "\"bus_tx_reads\":763734,"
               "\"modbus_enabled\":0,\"modbus_connected\":0,\"modbus_rx\":0,\"modbus_fails\":0}");

    // ── #215: the reset reason has to survive a NUMERIC-ONLY consumer ──
    // Telegraf's json parser keeps numeric fields and drops everything else, so the `reset_reason`
    // slug never became a VictoriaMetrics series — and a board restarting 55x in 7 days, 5 of them
    // panics, was unattributable in the store. The slug stays for humans; these two carry the same
    // answer as numbers. Pin that they are UNQUOTED, since a quoted "4" would be dropped exactly
    // like the slug and the fix would look done while changing nothing.
    CHECK(j.find("\"reset_reason_code\":4,") != std::string::npos);
    CHECK(j.find("\"reset_reason_code\":\"") == std::string::npos);
    CHECK(j.find("\"reset_fault\":1,") != std::string::npos);
    CHECK(j.find("\"reset_fault\":true") == std::string::npos);   // a bool is dropped like a string
    // The code is the SAME vocabulary /status.last_crash publishes as `reason_code`, so a consumer
    // that learned one table can read both — and reset_fault agrees with crash_reason_is_fault over
    // the whole enum, rather than being a second opinion about what counts as a fault.
    for (uint32_t code = 0; code <= 20; code++) {
        HeartbeatFields rf;
        rf.reset_reason_code = code;
        rf.reset_fault       = crash_reason_is_fault(code);
        const std::string rj = build_heartbeat_json(rf);
        CHECK(rj.find("\"reset_reason_code\":" + std::to_string(code) + ",") != std::string::npos);
        CHECK(rj.find(std::string("\"reset_fault\":") + (crash_reason_is_fault(code) ? "1" : "0") + ",")
              != std::string::npos);
    }
    // The two always-zero bus counters are gone: the X10A protocol has no write command, so they
    // could never be anything but 0. Neither was ever an HA entity, so nothing is orphaned.
    CHECK(j.find("bus_tx_writes") == std::string::npos);
    CHECK(j.find("bus_tx_fails") == std::string::npos);
    CHECK(j.find("\"bus_tx_reads\":") != std::string::npos);      // the real one stays

    // Modbus TCP (HomeHub) link — payload-only fields (issue #32), 0/off on this X10A snapshot. The
    // connectivity flag is a 1/0 NUMBER like the other links so a metrics consumer keeps it; there is
    // no write counter (the link is read-only).
    CHECK(j.find("\"modbus_connected\":0,") != std::string::npos);
    CHECK(j.find("\"modbus_connected\":false") == std::string::npos);   // number, not a dropped bool
    HeartbeatFields mf; mf.modbus_enabled = true; mf.modbus_connected = true; mf.modbus_rx = 12; mf.modbus_fails = 3;
    const std::string mj = build_heartbeat_json(mf);
    CHECK(mj.find("\"modbus_enabled\":1,") != std::string::npos);
    CHECK(mj.find("\"modbus_connected\":1,") != std::string::npos);
    CHECK(mj.find("\"modbus_rx\":12,") != std::string::npos);
    CHECK(mj.find("\"modbus_fails\":3}") != std::string::npos);

    // SOURCE freshness is its own field, and it is independent of bus health (#209 defect 5): the
    // link is up, the device is publishing, and the outdoor unit is simply not measuring. A consumer
    // that only had bus_connected would read the vanished outdoor keys as a broken link.
    f.ou_held_over = true;
    CHECK(build_heartbeat_json(f).find("\"bus_connected\":1,") != std::string::npos);
    CHECK(build_heartbeat_json(f).find("\"bus_ou_held_over\":1,") != std::string::npos);
    f.ou_held_over = false;

    // The SNTP wall clock and the dBm->% remap are gone from the payload with the two entities they
    // fed (RETIRED_HEARTBEAT_SENSORS). `time` said what HA's own last_updated already said, at one
    // recorder row per heartbeat; `wifi_quality_pct` was 2*(rssi+100) beside the rssi it was computed
    // from. Pinned as ABSENT, since either one lingering in the payload is the duplicate surviving
    // where nobody looks at it any more.
    CHECK(j.find("\"time\"") == std::string::npos);
    CHECK(j.find("wifi_quality") == std::string::npos);
    // ...and the facts themselves are still reported, one place each: the clock on /status.ntp
    // (+ every syslog TIMESTAMP), the signal as the dBm it was always derived from.
    CHECK(j.find("\"wifi_rssi\":-76,") != std::string::npos);

    // WiFi down -> rssi/bssid reported null, not a stale/garbage reading; mac still present.
    HeartbeatFields down;
    down.wifi_connected = false;
    down.wifi_rssi       = -50;    // stale value must not leak into the JSON
    down.wifi_mac        = "A1:B2:C3:D4:E5:F6";   // this STA's own MAC — known even while offline
    const std::string dj = build_heartbeat_json(down);
    CHECK(dj.find("\"wifi_rssi\":null") != std::string::npos);
    CHECK(dj.find("\"wifi_mac\":\"A1:B2:C3:D4:E5:F6\"") != std::string::npos);
    CHECK(dj.find("\"wifi_bssid\":null") != std::string::npos);   // no AP while offline
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
    CHECK(HEARTBEAT_SENSOR_COUNT == 18);   // -2: device_time, wifi_quality (RETIRED_HEARTBEAT_SENSORS)
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
    // measurements. All diagnostic, all sourced from the heartbeat topic.
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

    // ── Retired diagnostics: "Device Time" + "WiFi Quality" (RETIRED_HEARTBEAT_SENSORS) ──
    // Both said what another entity on the same device already said — the wall clock repeating HA's
    // own last_updated at one recorder row every 10 s, the quality percentage being 2*(rssi+100)
    // beside its own rssi. Gone from the live table...
    CHECK(RETIRED_HEARTBEAT_SENSOR_COUNT == 2);
    for (int i = 0; i < RETIRED_HEARTBEAT_SENSOR_COUNT; i++) {
        const RetiredHaSensor& r = RETIRED_HEARTBEAT_SENSORS[i];
        CHECK(find_hb(r.object_id) == nullptr);
        // ...and the topic the retraction targets is the one the entity was PUBLISHED on, byte for
        // byte. A zero-length retained message anywhere else deletes nothing and the stale entity
        // simply stays — silently, since a retraction gets no acknowledgement to check.
        CHECK(heartbeat_discovery_topic("homeassistant", r.component, node, r.object_id)
              == std::string("homeassistant/") + r.component + "/" + node + "/" + r.object_id + "/config");
    }
    // The two surviving WiFi entities are the ones that carry their own reading: dBm from the radio,
    // and the reconnect counter. Neither is derivable from the other.
    CHECK(find_hb("wifi_signal") != nullptr && find_hb("wifi_reconnects") != nullptr);

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

    // DISMISSED (POST /crash/dismiss -> diag_crash_dismiss): the user deleted the report on the
    // device. Nothing about the reset changes — the reason is still reported, and the heartbeat's own
    // "Reset Reason" sensor is untouched — but the crash stops being notable, which is what takes the
    // banner down for every browser at once and clears the retained MQTT crash topic. Asserted on
    // BOTH shapes: a fault reset that left no dump (a stack overflow overruns its own dump, so this is
    // the common case here) is the one where no flash byte changes, so `dismissed` is the only thing
    // that can carry it.
    CrashInfo dismissed_fault = fault_cleared;
    dismissed_fault.dismissed = true;
    CHECK(!crash_is_notable(dismissed_fault));
    CHECK(build_crash_mqtt_payload(dismissed_fault).empty());   // -> zero-length retained = topic cleared
    CHECK(build_crash_json(dismissed_fault) == build_crash_json(fault_cleared));   // the reset itself is untouched
    CrashInfo dismissed_orphan = orphan;
    dismissed_orphan.dismissed = true;
    CHECK(!crash_is_notable(dismissed_orphan));                 // outranks a dump the erase somehow left
    CHECK(build_crash_mqtt_payload(dismissed_orphan).empty());

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

    // ORPHAN core dump (#215): a dump survives an OTA, and a panic that fails to write its own leaves
    // the PREVIOUS build's dump in place — a valid image of another binary, which diag_crash_capture
    // erases so `coredump` never offers a download espcoredump rejects on a version mismatch. The rule
    // (coredump_is_foreign) gates that ERASE, so it fires ONLY on proof: two present shas, a
    // meaningful common prefix, and a mismatch. The costly error is the false positive — erasing a
    // dump that really is ours — so every ambiguous case answers "not foreign" and the dump is kept.
    CHECK(coredump_is_foreign("ce0adc15a", "f8814d6d5"));            // #215's exact case — different builds
    CHECK(coredump_is_foreign("deadbeef00", "deadbeef11"));         // agree on a prefix, differ past it
    CHECK(!coredump_is_foreign("f8814d6d5", "f8814d6d5"));          // same build — keep the dump
    CHECK(!coredump_is_foreign("abc123", "abc123"));                // same, shorter than the compare floor -> keep
    CHECK(!coredump_is_foreign("f8814d6d", "f8814d6d5"));           // one truncated: common prefix agrees -> keep
    // A missing sha is NOT proof of foreign origin — a dump with no parsable summary, or a build that
    // could not report its own — so the dump is left alone rather than erased on absence of evidence.
    CHECK(!coredump_is_foreign("", "f8814d6d5"));
    CHECK(!coredump_is_foreign("f8814d6d5", ""));
    CHECK(!coredump_is_foreign(nullptr, "f8814d6d5"));
    CHECK(!coredump_is_foreign("f8814d6d5", nullptr));
    // Two DIFFERENT shas that happen to agree only on a prefix SHORTER than the compare floor are not
    // trusted as different — the 32-bit floor is what keeps a pathologically short config from
    // erasing good dumps by accident (the 8-char agreement below reads as "same build", keep).
    CHECK(!coredump_is_foreign("abcdef01", "abcdef01"));
    CHECK(coredump_is_foreign("abcdef012", "abcdef019"));          // 9 chars: floor cleared, differ at char 9

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

static void test_modbus_snapshot() {
    using daik::logic::modbus_cache_is_live;
    // A disconnected link never publishes, even if the cache and last session happen to match.
    CHECK(!modbus_cache_is_live(false, 7, 7));
    // The load-bearing reconnect case: /values copied session 7's cache, then session 8 connected
    // before it sampled status. A boolean-only post-check says "live"; the generation check refuses
    // the previous session's rows until session 8 has committed its own poll.
    CHECK(!modbus_cache_is_live(true, 8, 7));
    CHECK(modbus_cache_is_live(true, 8, 8));
    // Generation zero is the pre-first-commit sentinel, not a coincidentally matching session.
    CHECK(!modbus_cache_is_live(true, 0, 0));
}

// The HomeHub Modbus register profile (def/homehub.hpp) — the DECODE MECHANICS (scaling, special
// values, text, offset -> PDU). Physical correctness of each row is an on-hardware check; what is
// host-testable is that the codecs + the extra `scale` divisor produce the right number and that a
// 32765/66/67 special is refused rather than published as a large value.
static void test_homehub() {
    using namespace daik::def;
    CHECK(HOMEHUB_REG_COUNT > 0);
    auto find = [](uint16_t off) -> const HomeHubReg* {
        for (int i = 0; i < HOMEHUB_REG_COUNT; i++)
            if (HOMEHUB_REGS[i].offset == off) return &HOMEHUB_REGS[i];
        return nullptr;
    };
    char buf[16];
    MbValue v;
    // Temperature (Temp16 = signed /100 °C) — return water at offset 42, read from an input register.
    const HomeHubReg* t = find(42);
    CHECK(t && t->type == MbType::Temp16 && t->space == MbFunc::ReadInput);
    CHECK(homehub_decode(*t, 3550, v) && approx(v.value, 35.5));
    CHECK(homehub_format(*t, 3550, buf, sizeof(buf)) && std::string(buf) == "35.5");
    // A negative temperature keeps its sign — the exact class of bug the X10A port shipped (#35-#39).
    CHECK(homehub_format(*t, static_cast<uint16_t>(-500), buf, sizeof(buf)) && std::string(buf) == "-5.0");
    // Flow is a plain Int16 carrying L/min x100, so the `scale` field divides the decode by 100.
    const HomeHubReg* f = find(49);
    CHECK(f && f->type == MbType::Int16 && f->scale == 100);
    CHECK(homehub_decode(*f, 1500, v) && approx(v.value, 15.0));
    CHECK(homehub_format(*f, 1500, buf, sizeof(buf)) && std::string(buf) == "15.0");
    // A special value (32765 wait / 32766 unavailable / 32767 unsupported) is NOT data: both refuse.
    CHECK(!homehub_decode(*t, MB_UNAVAILABLE, v));
    CHECK(!homehub_format(*t, MB_UNSUPPORTED, buf, sizeof(buf)));
    CHECK(!homehub_format(*f, MB_WAIT, buf, sizeof(buf)));
    // Text16 error code: 0x5538 -> "U8" (the guide's own worked example).
    const HomeHubReg* ec = find(22);
    CHECK(ec && ec->type == MbType::Text16);
    CHECK(homehub_format(*ec, 0x5538, buf, sizeof(buf)) && std::string(buf) == "U8");
    // An Int16 mode (no extra scale) prints as a bare integer, read back from a HOLDING register.
    const HomeHubReg* om = find(3);
    CHECK(om && om->type == MbType::Int16 && om->scale == 1 && om->space == MbFunc::ReadHolding);
    CHECK(homehub_format(*om, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    // The 1-based EKRHH offset maps to the 0-based wire PDU address.
    uint16_t pdu = 0xFFFF;
    CHECK(mb_pdu_address(t->offset, pdu) && pdu == static_cast<uint16_t>(t->offset - 1));
    // The synthetic MQTT group page resolves to "homehub" (the poll branch tags every HomeHub cache
    // row with HOMEHUB_GROUP_REG so the bridge groups them together — this pins the two in step).
    CHECK(std::string(group_for_page(HOMEHUB_GROUP_REG)) == "homehub");
}

// The syslog replay records (logic/bootlog.hpp): the build-identity boot line + the crash rendered as
// datagram-sized single-line records. syslog.cpp sends these once, after DNS resolves.
// The X10A ↔ HomeHub concept pairing (logic/homehub_map.hpp) — the ONE place the two independent
// stacks meet. The pairing must be STRUCTURAL: a label match would be both incomplete (four
// spellings of leaving water across the catalog) and wrong (the "(R1T)" tag names two different
// sensors), and a wrong pairing is worst in the FALLBACK case, where the Modbus value stands alone
// under the X10A row's name with nothing beside it to look implausible against.
static void test_homehub_map() {
    using namespace daik::logic;
    // Every paired offset is a real HomeHub register, and every concept a real trend id (the latter
    // is also a static_assert in the header — asserted here too so the failure names itself).
    for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++) {
        const auto& c = HOMEHUB_CONCEPTS[i];
        bool reg_exists = false;
        for (int k = 0; k < daik::def::HOMEHUB_REG_COUNT; k++)
            if (daik::def::HOMEHUB_REGS[k].offset == c.offset) { reg_exists = true; break; }
        CHECK(reg_exists);
        CHECK(trend_by_id(c.concept_id) != nullptr);
    }
    // Lookup both ways.
    CHECK(std::string(homehub_concept_for(43)) == "dhw_tank");
    CHECK(std::string(homehub_concept_for(40)) == "leaving_water");
    CHECK(homehub_concept_for(51) == nullptr);   // power: X10A has no equivalent, deliberately unpaired
    CHECK(homehub_concept_for(41) == nullptr);   // post-BUH: a DIFFERENT measurement point, not leaving_water
    CHECK(homehub_concept_for(999) == nullptr);

    // The X10A side resolves through trend_row_matches, so it agrees with the trend rings by
    // construction. Spot-check the locators the pairings above depend on.
    CHECK(std::string(x10a_concept_for(0x61, 10, "°C", 0)) == "dhw_tank");
    CHECK(std::string(x10a_concept_for(0x61,  2, "°C", 0)) == "leaving_water");
    CHECK(std::string(x10a_concept_for(0x61,  8, "°C", 0)) == "return_water");
    CHECK(x10a_concept_for(0x61, 10, "bar", 0) == nullptr);   // unit is part of the locator
    CHECK(x10a_concept_for(0x99,  0, "°C", 0)  == nullptr);

    // THE LOAD-BEARING ASSERTION: on every DETECTABLE profile, each paired concept must resolve to
    // exactly ONE row — otherwise the UI would either pair nothing (a Modbus value with no X10A row
    // to sit beside) or pair ambiguously. Measured across the shipped catalog rather than assumed.
    int nsig = 0;
    daik::def::signatures(nsig);
    size_t profiles_checked = 0;
    for (const auto& prof : daik::def::profiles) {
        if (!daik::def::is_detection_model(prof.id)) continue;
        const auto view = daik::def::resolved(prof);
        profiles_checked++;
        for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++) {
            const char* want = HOMEHUB_CONCEPTS[i].concept_id;
            int hits = 0;
            for (size_t k = 0; k < view.count(); k++) {
                const ValueDef d = adjudicated(view[k]);
                const char* got = x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                if (got && trend_cstr_eq(got, want)) hits++;
            }
            // 0 is legitimate — a profile need not carry every quantity (a monobloc has no room
            // sensor). 2+ is not: it would make the pairing depend on row order.
            CHECK(hits <= 1);
        }
    }
    CHECK(profiles_checked > 20);   // the assertion above must have actually run over the catalog

    // Each paired concept must resolve on at least ONE profile, or it is a pairing nobody can ever
    // see — the same "a locator that resolves nowhere is a trend nobody will see" rule history.hpp
    // states for its own coverage.
    for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++) {
        int total = 0;
        for (const auto& prof : daik::def::profiles) {
            if (!daik::def::is_detection_model(prof.id)) continue;
            const auto view = daik::def::resolved(prof);
            for (size_t k = 0; k < view.count(); k++) {
                const ValueDef d = adjudicated(view[k]);
                const char* got = x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                if (got && trend_cstr_eq(got, HOMEHUB_CONCEPTS[i].concept_id)) total++;
            }
        }
        CHECK(total > 0);
    }

    // ── STATES ────────────────────────────────────────────────────────────────────────────────
    // Same claim, one field wider. The wider key is the whole point: `3way valve`, `2way valve`,
    // `BSH`, `BUH Step1`, `BUH Step2` and `Water pump operation` all sit at 0x60/12 and differ ONLY
    // by converter, so a (reg, offset, unit) locator answers "the pump" when asked for the diverter.
    CHECK(std::string(homehub_concept_for(37)) == "valve_dhw");
    CHECK(std::string(homehub_concept_for(30)) == "pump_running");
    CHECK(std::string(homehub_concept_for(53)) == "space_op");
    // The refusal that matters: X10A's nearest DHW flag is the BOOST ("Powerful DHW Operation"),
    // which reads OFF through an ordinary hot-water cycle. Pairing it would put "off" beside a tank
    // being charged.
    CHECK(homehub_concept_for(52) == nullptr);

    // THE TRAP, asserted directly: same page, same offset, different converter → different concept.
    CHECK(std::string(x10a_concept_for(0x60, 12, "", 306)) == "valve_dhw");
    CHECK(std::string(x10a_concept_for(0x60, 12, "", 301)) == "pump_running");
    CHECK(x10a_concept_for(0x60, 12, "", 302) == nullptr);   // BSH etc. share the byte, pair nothing
    CHECK(x10a_concept_for(0x62,  2, "", 304) == nullptr);   // the DHW BOOST is deliberately unpaired

    // Over the catalog: each state locator resolves to EXACTLY ONE row per detectable profile, and
    // that row is the one the pairing names. Identity, not just count — a locator that resolves
    // uniquely onto the wrong row is the failure this whole header exists to prevent.
    for (size_t i = 0; i < HOMEHUB_STATE_COUNT; i++) {
        const auto& st = HOMEHUB_STATES[i];
        int profiles_with = 0;
        for (const auto& prof : daik::def::profiles) {
            if (!daik::def::is_detection_model(prof.id)) continue;
            const auto view = daik::def::resolved(prof);
            int hits = 0;
            for (size_t k = 0; k < view.count(); k++) {
                const ValueDef d = adjudicated(view[k]);
                const char* got = x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                if (got && trend_cstr_eq(got, st.concept_id)) {
                    hits++;
                    // A state is a BIT FLAG — if this ever resolved a numeric row, the UI would put
                    // "ON" beside a temperature.
                    CHECK(conv_is_binary(d.conv));
                }
            }
            CHECK(hits <= 1);
            if (hits == 1) profiles_with++;
        }
        CHECK(profiles_with > 20);   // a pairing carried by a handful of profiles is not a pairing
    }

    // ── COVERAGE, PINNED ──────────────────────────────────────────────────────────────────────
    // The assertions above are "at most one per profile" and "carried by enough of them" — neither
    // says how MANY profiles actually resolve each pairing, so the docs' claim that they all do was
    // an unguarded statement about the catalog. Measured: every one of the nine resolves on every
    // detectable profile. Pinned as a NUMBER rather than a >= so a regeneration that drops a row
    // from one family is a decision someone makes on purpose: a pairing that stops resolving does
    // not fail anywhere else — the second source simply, silently, stops appearing beside that row.
    {
        int detectable = 0;
        for (const auto& prof : daik::def::profiles)
            if (daik::def::is_detection_model(prof.id)) detectable++;
        CHECK(detectable == 39);

        auto resolves_everywhere = [&](const char* cid) {
            int n = 0;
            for (const auto& prof : daik::def::profiles) {
                if (!daik::def::is_detection_model(prof.id)) continue;
                const auto view = daik::def::resolved(prof);
                for (size_t k = 0; k < view.count(); k++) {
                    const ValueDef d = adjudicated(view[k]);
                    const char* got = x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                    if (got && trend_cstr_eq(got, cid)) { n++; break; }
                }
            }
            return n;
        };
        for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++)
            CHECK(resolves_everywhere(HOMEHUB_CONCEPTS[i].concept_id) == detectable);
        for (size_t i = 0; i < HOMEHUB_STATE_COUNT; i++)
            CHECK(resolves_everywhere(HOMEHUB_STATES[i].concept_id) == detectable);
    }
}

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
    // Volatile copies keep constexpr from folding every constant call away: the coverage gate must
    // observe the production branches at runtime, not merely the CHECK expressions that name them.
    const auto plan = [](bool inited, int cur_rx, int cur_tx, int new_rx, int new_tx) {
        volatile bool runtime_inited = inited;
        volatile int  runtime_cur_rx = cur_rx;
        volatile int  runtime_cur_tx = cur_tx;
        volatile int  runtime_new_rx = new_rx;
        volatile int  runtime_new_tx = new_tx;
        return uart_plan(
            runtime_inited, runtime_cur_rx, runtime_cur_tx, runtime_new_rx, runtime_new_tx);
    };

    CHECK(plan(false, -1, -1, 44, 43) == UartAction::Install);   // cold start
    // Re-probing the SAME pins is a Noop — no delete, no reinstall, no heap.
    CHECK(plan(true, 44, 43, 44, 43) == UartAction::Noop);
    // THE fix: the sweep's {44,43}<->{43,44} alternation is a genuine change -> Remap (uart_set_pin
    // only), NOT Install. This turns ~2 reinstalls/second into zero heap allocations.
    CHECK(plan(true, 44, 43, 43, 44) == UartAction::Remap);
    CHECK(plan(true, 43, 44, 44, 43) == UartAction::Remap);
    // A one-sided change (only rx, or only tx) is a Remap, never a false Noop.
    CHECK(plan(true, 44, 43, 44, 40) == UartAction::Remap);
    CHECK(plan(true, 44, 43, 40, 43) == UartAction::Remap);
    // Not-inited always installs, regardless of stale pin memory from a prior session.
    CHECK(plan(false, 44, 43, 44, 43) == UartAction::Install);
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

// ── UI language override (logic/ui_lang.hpp) ─────────────────────────────────────────────────
static void test_ui_lang() {
    CHECK(std::string(ui_lang_name(UiLang::Auto)) == "auto");
    CHECK(std::string(ui_lang_name(UiLang::De)) == "de");
    CHECK(std::string(ui_lang_name(UiLang::En)) == "en");
    CHECK(ui_lang_valid("auto") && ui_lang_valid("de") && ui_lang_valid("en"));
    // A typo is REFUSED, not defaulted: /set_lang answering ok to "german" would look like a save.
    CHECK(!ui_lang_valid("") && !ui_lang_valid("De") && !ui_lang_valid("german") && !ui_lang_valid("EN"));
    CHECK(ui_lang_parse("auto") == UiLang::Auto);
    CHECK(ui_lang_parse("de") == UiLang::De);
    CHECK(ui_lang_parse("en") == UiLang::En);
    CHECK(ui_lang_parse("nonsense") == UiLang::Auto);                 // load-path fallback
    CHECK(ui_lang_parse("nonsense", UiLang::En) == UiLang::En);
    // The on-flash byte. An unknown value decodes to Auto — a garbled NVS byte must fall back to the
    // browser default, never force a language the user never chose. Auto is what every pre-v4 device
    // is already in.
    CHECK(ui_lang_to_int(UiLang::Auto) == 0 && ui_lang_to_int(UiLang::De) == 1 && ui_lang_to_int(UiLang::En) == 2);
    CHECK(ui_lang_from_int(0) == UiLang::Auto && ui_lang_from_int(1) == UiLang::De && ui_lang_from_int(2) == UiLang::En);
    CHECK(ui_lang_from_int(3) == UiLang::Auto && ui_lang_from_int(-1) == UiLang::Auto);
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

static void test_redact() {
    // Field substitution keeps the KEY and replaces the VALUE. The caller writes the result into the
    // JSON where the value would have gone, so "off" must be an exact passthrough — a redaction that
    // normalised the untouched case would change /status for every ordinary request.
    CHECK(redact_or("MyHomeNetwork", true) == REDACTED);
    CHECK(redact_or("MyHomeNetwork", false) == "MyHomeNetwork");
    CHECK(redact_or("", true) == REDACTED);   // an empty value still redacts: absence is not privacy

    // One CHECK per shipped log statement. If a diag_printf() is reworded, the matching line here is
    // what fails — the leak itself is invisible (a correct-looking log line with a real hostname).
    CHECK(redact_diag_line("[   12.345] syslog: target set to logs.example.lan:514") ==
          "[   12.345] syslog: target set to <redacted>");
    CHECK(redact_diag_line("syslog: forwarding to logs.example.lan (192.168.1.9), reachable=yes") ==
          "syslog: forwarding to <redacted>, reachable=yes");
    CHECK(redact_diag_line("syslog: DNS lookup failed for logs.example.lan (error 202)") ==
          "syslog: DNS lookup failed for <redacted> (error 202)");
    CHECK(redact_diag_line("wifi: rollback restore to 'MyHomeNetwork' was not persisted — opening") ==
          "wifi: rollback restore to '<redacted>' was not persisted — opening");
    CHECK(redact_diag_line("wifi: could not clear the rollback backup ('MyHomeNetwork') — a later") ==
          "wifi: could not clear the rollback backup ('<redacted>') — a later");
    CHECK(redact_diag_line("sntp: time synced (pool.ntp.org)") == "sntp: time synced (<redacted>)");
    CHECK(redact_diag_line("sntp: init failed (pool.ntp.org): ESP_ERR_INVALID_STATE") ==
          "sntp: init failed (<redacted>): ESP_ERR_INVALID_STATE");
    // The MAC-derived legacy HA device id. /status redacts wifi.mac, so printing its unique half
    // here would leave the redaction incoherent — scrubbed in the JSON, spelled out in the log.
    CHECK(redact_diag_line("mqtt: retired legacy HA device daikin_a1b2c3 (now daikin-altherma-esp32)") ==
          "mqtt: retired legacy HA device <redacted> (now daikin-altherma-esp32)");
    // The DISCOVERED HomeHub hostname. `homehub-524288-<serial>` carries the hub's serial number, so
    // it identifies the reporter's hardware exactly as an SSID does — and /status?redact=1 already
    // withholds the same string as modbus.host, so an unruled log line put it back a few sections
    // below in the very same bug report.
    CHECK(redact_diag_line("modbus: one-shot mDNS search found gateway homehub-524288-15702.local") ==
          "modbus: one-shot mDNS search found gateway <redacted>");
    CHECK(redact_diag_line("modbus: 2 HomeHubs discovered via mDNS — using homehub-524288-15702") ==
          "modbus: 2 HomeHubs discovered via mDNS — using <redacted>");
    // The count SURVIVES on the several-hubs line: that more than one gateway answered is what
    // explains an unexpected pick, and it sits before the marker precisely so it can be kept.
    CHECK(redact_diag_line("modbus: 2 HomeHubs discovered via mDNS — using homehub-524288-15702")
              .find("modbus: 2 ") == 0);
    // The FAILURE half of the one-shot search is a SEPARATE diag_printf so it matches no rule and
    // survives whole. Written as one statement with a substituted tail, the two outcomes shared the
    // prefix "search found " and the only rule covering the hostname also blanked the one fact a
    // reader needs — why no hub was ever contacted.
    {
        const std::string none = "modbus: one-shot mDNS search found no gateway — not searching again";
        CHECK(redact_diag_line(none) == none);
    }

    // What must SURVIVE. Redacting the identifier is only useful if the rest still diagnoses: the
    // errno says why DNS failed, reachable= says whether the collector answers, and the esp_err
    // name says why SNTP would not start. A rule that swallowed the line would trade a leak for a
    // blind spot.
    CHECK(redact_diag_line("syslog: DNS lookup failed for h (error 202)").find("(error 202)") !=
          std::string::npos);
    CHECK(redact_diag_line("syslog: forwarding to h (1.2.3.4), reachable=no-ping-reply")
              .find("reachable=no-ping-reply") != std::string::npos);

    // FAIL CLOSED. The ring truncates, and a value cut off mid-write sits unterminated at the end of
    // the line — precisely when the end token is missing. Redact to the end rather than give up.
    CHECK(redact_diag_line("sntp: time synced (pool.ntp.o") == "sntp: time synced (<redacted>");
    CHECK(redact_diag_line("wifi: rollback restore to 'MyHome") == "wifi: rollback restore to '<redacted>");

    // The newline is not part of the value — a fail-closed span must not eat it, or the whole ring
    // collapses into one line and the redacted /diag is unreadable.
    CHECK(redact_diag_line("sntp: time synced (pool.ntp.o\n") == "sntp: time synced (<redacted>\n");
    CHECK(redact_diag_line("syslog: target set to logs.example.lan:514\n") ==
          "syslog: target set to <redacted>\n");

    // A line matching no rule is untouched — most of the ring is poll/detect chatter that names
    // nothing, and rewriting it would be noise in a diff a human reads.
    const char* plain = "[  123.456] HP timeout on register 0x60";
    CHECK(redact_diag_line(plain) == plain);
    CHECK(redact_diag_line("") == "");

    // THE DECODE WITNESS MUST SURVIVE. /diag is where the raw page bytes surface (hexdump.hpp, one
    // line per detect pass) and where a wrong value is PROVEN — issue #194 is that argument in full.
    // A future rule with a loose marker ("detect: ", or a bare "0x") would clip those bytes, and the
    // only symptom would be a witness that quietly stopped being evidence: the #35-#39 shape aimed
    // at the very tool built to catch it. So the privacy rule is pinned against the diagnostic one.
    for (const char* w : {
             "[  123.456] detect: raw 0x10 32B 00 1E 32 00 07 CF 00 00 12 34 AB CD EF 01 02 03",
             "[  123.456] detect: raw 0x20 32B FF FF 00 00 0C 80 00 00 00 00 00 00 00 00 00 00",
             "[  123.456] detect: proto=I rx=1 tx=2 pages=0x1e7f kw=60 iu_kw=80 eeprom=[1234] -> 3 candidate(s), best=x",
             // A payload whose BYTES spell a marker prefix in ASCII ("syslog: target"): safe only
             // because every marker is an English phrase a hex rendering cannot produce. Asserted
             // rather than assumed, since it is the one shape that could collide by accident.
             "[  123.456] detect: raw 0xA1 32B 73 79 73 6C 6F 67 3A 20 74 61 72 67 65 74",
         })
        CHECK(redact_diag_line(w) == w);

    // A value that itself contains the marker text: the span starts at the FIRST occurrence, so the
    // whole thing is covered — a rule that re-anchored on the last one would redact the decoy and
    // print the real host. The leftover delimiter is cosmetic; what matters is that nothing of the
    // value survives, so both halves are asserted.
    const std::string nested = redact_diag_line("sntp: time synced (sntp: time synced (evil.host))");
    CHECK(nested.find("evil.host") == std::string::npos);
    CHECK(nested == "sntp: time synced (<redacted>))");
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
    CHECK(bb[4] == CONFIG_BLOB_VERSION && CONFIG_BLOB_VERSION == 5);
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
    std::vector<uint8_t> v1 = buf;                       // `buf` is serialized as v5 by this build,
    // so build a genuine v1 body: header + the v1 fields only, by dropping every trailing block that
    // precedes the CRC — the 13-byte v2 board block (3x u32 + 1 flag byte), the 1-byte v3 channel,
    // the 1-byte v4 language and the 11-byte v5 HomeHub block (empty mb_host [2] + mb_port u32 +
    // mb_unit_id u32 + 1 flag byte) = 26 bytes.
    v1.erase(v1.end() - 4 - 26, v1.end() - 4);
    v1[4] = 1;
    restamp(v1);
    ConfigBlob legacy;
    legacy.led_gpio = 999;                               // sentinel: must be left untouched by the decode
    CHECK(config_blob_deserialize(v1.data(), v1.size(), legacy));
    CHECK(!legacy.has_board);
    CHECK(legacy.wifi_ssid == a.wifi_ssid && legacy.mqtt_uri == a.mqtt_uri);   // v1 payload intact
    CHECK(legacy.led_gpio == -1);                        // the struct default, not the 999 sentinel
    // A TRUNCATED v5 must not decode as a valid v4/v3/v2/v1 with silently-default values: the version
    // byte still says 5, so the missing v5 block is caught by the length rule, not papered over.
    std::vector<uint8_t> trunc = bb;
    trunc.erase(trunc.end() - 4 - 11, trunc.end() - 4);   // drop the 11-byte v5 HomeHub block
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
    v2.erase(v2.end() - 4 - 13, v2.end() - 4);           // drop the v3 channel + v4 language + v5 block
    v2[4] = 2;
    restamp(v2);
    ConfigBlob pre;
    pre.ota_channel = 7; pre.ui_lang = 7;               // sentinels: must be left untouched
    CHECK(config_blob_deserialize(v2.data(), v2.size(), pre));
    CHECK(!pre.has_ota && pre.ota_channel == 0);         // the struct default, not the 7 sentinel
    CHECK(!pre.has_lang && pre.ui_lang == 0);            // v2 predates the language byte too
    CHECK(!pre.has_modbus && pre.mb_port == 502 && pre.mb_unit_id == 1);
    CHECK(pre.has_board && pre.led_gpio == -1 && pre.wifi_ssid == "net");   // v2 payload intact

    // ── v4: the UI language override ──────────────────────────────────────────────────────────────
    ConfigBlob lang; lang.wifi_ssid = "net"; lang.ota_channel = 1; lang.ui_lang = 2;   // 1 = dev, 2 = en
    std::vector<uint8_t> lbv = config_blob_serialize(lang);
    ConfigBlob lrt;
    CHECK(config_blob_deserialize(lbv.data(), lbv.size(), lrt));
    CHECK(lrt.has_lang && lrt.ui_lang == 2 && lrt.has_ota && lrt.ota_channel == 1 && lrt.wifi_ssid == "net");
    lang.ui_lang = 0;                                     // auto round-trips as 0 WITH has_lang set
    lbv = config_blob_serialize(lang);
    CHECK(config_blob_deserialize(lbv.data(), lbv.size(), lrt) && lrt.ui_lang == 0 && lrt.has_lang);
    // The upgrade guarantee, one version on: a device written by a pre-language (v3) build carries a
    // v3 blob and must still decode — the channel survives, and the absent language reads as auto
    // (has_lang == false, ui_lang == 0), so the browser keeps auto-detecting exactly as before.
    std::vector<uint8_t> v3 = lbv;
    v3.erase(v3.end() - 4 - 12, v3.end() - 4);           // drop the v4 language + the v5 HomeHub block
    v3[4] = 3;
    restamp(v3);
    ConfigBlob prel;
    prel.ui_lang = 7;                                    // sentinel: must be left untouched
    CHECK(config_blob_deserialize(v3.data(), v3.size(), prel));
    CHECK(!prel.has_lang && prel.ui_lang == 0);          // the struct default, not the 7 sentinel
    CHECK(prel.has_ota && prel.ota_channel == 1 && prel.wifi_ssid == "net");   // v3 payload intact

    // ── v5: the HomeHub Modbus stack ────────────────────────────────────────────────────────────
    // v5 and not v4: the language byte and this block were written in parallel and both claimed v4.
    // main's language byte landed first and is already on published builds, so this took the later
    // number — a second, different "v4" would decode that byte as a HomeHub setting.
    ConfigBlob mb; mb.wifi_ssid = "net";
    mb.mb_host = "homehub-524288-abc.local";
    mb.mb_port = 502; mb.mb_unit_id = 3; mb.actuation_enabled = true;
    std::vector<uint8_t> mbb = config_blob_serialize(mb);
    CHECK(mbb[4] == CONFIG_BLOB_VERSION && CONFIG_BLOB_VERSION == 5);
    ConfigBlob mrt;
    CHECK(config_blob_deserialize(mbb.data(), mbb.size(), mrt));
    CHECK(mrt.has_modbus && mrt.mb_host == "homehub-524288-abc.local");
    CHECK(mrt.mb_port == 502 && mrt.mb_unit_id == 3 && mrt.actuation_enabled);
    CHECK(mrt.wifi_ssid == "net");                       // the earlier-version fields round-trip too
    // An EMPTY mb_host (= mDNS auto-discovery) must survive the string encoding, and the two booleans
    // share ONE flag byte — so they must not bleed into each other, nor from the board/ota/language
    // bytes that precede them.
    mb.mb_host = ""; mb.actuation_enabled = false;
    mbb = config_blob_serialize(mb);
    CHECK(config_blob_deserialize(mbb.data(), mbb.size(), mrt));
    CHECK(mrt.mb_host.empty() && !mrt.actuation_enabled);
    mb.actuation_enabled = true;
    mbb = config_blob_serialize(mb);
    CHECK(config_blob_deserialize(mbb.data(), mbb.size(), mrt));
    CHECK(mrt.actuation_enabled);
    // BACKWARD COMPATIBILITY: a v4 blob (a device from before the transport existed, but WITH the
    // language byte) must decode, report has_modbus == false and leave the mb_* struct defaults
    // (X10A / 502 / 1) — the same trade v1/v2/v3 already refuse to make.
    std::vector<uint8_t> v4 = mbb;
    v4.erase(v4.end() - 4 - 11, v4.end() - 4);           // drop the 11-byte v5 block (empty host)
    v4[4] = 4;
    restamp(v4);
    ConfigBlob v4rt;
    v4rt.mb_port = 9; v4rt.mb_unit_id = 9;               // sentinels: must reset
    CHECK(config_blob_deserialize(v4.data(), v4.size(), v4rt));
    CHECK(!v4rt.has_modbus && v4rt.mb_port == 502 && v4rt.mb_unit_id == 1);
    CHECK(v4rt.has_lang && v4rt.has_ota && v4rt.wifi_ssid == "net");   // the v4 payload is intact
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
                          "/crash/dismiss", "/models", "/set_wifi", "/set_mqtt", "/set_ntp",
                          "/set_hp", "/detect", "/ota/check", "/ota/update", "/mcp"}) {
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
    // …and /crash/dismiss least of all: it DESTROYS the dump and the crash record, so an
    // unauthenticated radio client could erase the evidence of a crash it never saw.
    CHECK(!http_surface_serves(ap, "/crash/dismiss", true));
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

    // The compressor WITNESS, now a shared predicate: the poll engine marks its cache with it
    // (main/hp_poll.cpp, so the MQTT bridge can withhold a held-over reading — #209 defect 5) and the
    // trend ring's trend_rps_row() finds its row with it. Two callers, one rule; a second copy of the
    // pattern is what would let one of them quietly stop covering a row.
    CHECK(logic::ou_is_rps_witness("INV frequency (rps)", 0x30));
    CHECK(!logic::ou_is_rps_witness("INV frequency (rps)", 0x21));  // must sit on a page that is LIVE,
                                                                    // or the run state comes from the
                                                                    // same frozen bytes it qualifies
    CHECK(!logic::ou_is_rps_witness("INV primary current (A)", 0x21));
    CHECK(!logic::ou_is_rps_witness("Fan 1 (step)", 0x30));
    CHECK(!logic::ou_is_rps_witness(nullptr, 0x30));

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

// ── logic/cop_scope.hpp — WHICH COP the dashboard's quotient describes ────────────────────────
// Two halves, and the first is the one with a real trap behind it: the post-BUH row must be found
// by (label, PAGE) because the catalog gives the SAME "(R2T)" tag, at the SAME offset, with the
// SAME converter, to the leaving-water outlet on 0x61 and to the compressor's discharge pipe on
// 0x20. The second half asserts the pairing rule itself — that a whole-unit denominator is never
// divided into a heat-pump-only numerator while the backup heater is firing.
static void test_cop_scope() {
    using logic::CopBlock;
    using logic::CopScope;
    using logic::PelSource;
    using logic::cop_is_post_buh;
    using logic::cop_plan;
    using logic::cop_post_buh_select;

    // --- the picker, and the collision it exists for ---------------------------------------------
    CHECK(cop_is_post_buh("Leaving water temp. after BUH (R2T)", 0x61));
    CHECK(cop_is_post_buh("Leaving Water Temp after BUH (R2T)", 0x61));
    CHECK(cop_is_post_buh("Outlet Water BUH Temp. (R2T)", 0x61));
    CHECK(cop_is_post_buh("[HPSU] Tvbh inflow Temp after Buffer/BUH (R2T)", 0x61));
    // The SAME tag on an outdoor page is the compressor's discharge pipe, not water. Identical
    // offset (4) and converter (105) — the page is the only thing that separates them, so a
    // label-only rule would feed a ~90 °C pipe temperature to the heat meter.
    CHECK(!cop_is_post_buh("Discharge pipe temp.(R2T)", 0x20));
    CHECK(!cop_is_post_buh("R2T-INV discharge pipe temp.", 0x20));
    // …and the gate is the PAGE, not the word "discharge": the same water label on a frozen page is
    // refused too, because a held-over reading is not a measurement whatever it is called.
    CHECK(!cop_is_post_buh("Leaving water temp. after BUH (R2T)", 0x20));
    CHECK(!cop_is_post_buh("Leaving water temp. after BUH (R2T)", 0x21));
    // Targets and the bizone kit's mixed circuit are not the main circuit's measurement. NEITHER
    // form is in the catalog today — every shipped setpoint and mixed row carries R1T/R7T or no tag
    // at all, so the "r2t" requirement alone already excludes them. These are the shapes the two
    // guards exist for, built by grafting the post-BUH tag onto the REAL labels "Leaving Water
    // Setpoint (main)" and "[EKMIK] Bizone kit mixed leaving water temperature R1T": a bizone kit
    // legitimately has a second circuit, and a generator run that gave it a post-BUH sensor would
    // otherwise let a mixed-zone or target row into the heat meter. Written water-token-bearing on
    // purpose — a label that is not water-ish is refused one test earlier and would assert nothing.
    CHECK(!cop_is_post_buh("Leaving Water Setpoint after BUH (R2T)", 0x61));
    CHECK(!cop_is_post_buh("[EKMIK] Bizone kit mixed leaving water temp after BUH (R2T)", 0x61));
    // The pre-BUH sensor must never satisfy the post-BUH picker — that swap is issue #121 inverted.
    CHECK(!cop_is_post_buh("Leaving water temp. before BUH (R1T)", 0x61));
    {
        const char*    labels[] = {"Discharge pipe temp.(R2T)", "Leaving water temp. after BUH (R2T)"};
        const unsigned regs[]   = {0x20, 0x61};
        CHECK(cop_post_buh_select(labels, regs, 2) == 1);   // the water row, never the pipe
        const char*    only_pipe[] = {"Discharge pipe temp.(R2T)"};
        const unsigned pipe_reg[]  = {0x20};
        CHECK(cop_post_buh_select(only_pipe, pipe_reg, 1) == -1);   // blank beats wrong
    }

    // --- the pairing rule -----------------------------------------------------------------------
    // Shorthand: the tank heater known-off, which is the branch the BUH cases are about.
    const bool BSH_OFF_K = true, BSH_OFF = false;

    // No current at all (or the only row frozen with the outdoor unit): nothing to divide by.
    CHECK(cop_plan(PelSource::None, true, false, BSH_OFF_K, BSH_OFF, true).block == CopBlock::NoPelSource);
    CHECK(!cop_plan(PelSource::None, true, false, BSH_OFF_K, BSH_OFF, true).showable());

    // Compressor-only current + pre-BUH heat = a HEAT-PUMP COP. BOTH resistive heaters sit outside
    // both sides of the fraction, so neither can unbalance them — this holds with either firing.
    for (bool buh : {false, true})
        for (bool bsh : {false, true}) {
            const auto p = cop_plan(PelSource::Inv, true, buh, true, bsh, true);
            CHECK(p.scope == CopScope::HeatPump);
            CHECK(p.showable());
            CHECK(!p.use_post_buh);      // the usual lwt_select numerator
        }

    // Whole-unit current: the numerator moves to the post-BUH row so the boundaries agree, and it
    // does so regardless of the backup heater's state — otherwise the figure would silently change
    // meaning every time the heater cycled.
    for (bool on : {false, true}) {
        const auto p = cop_plan(PelSource::Ct, true, on, BSH_OFF_K, BSH_OFF, /*has_post_buh=*/true);
        CHECK(p.scope == CopScope::Plant);
        CHECK(p.showable());
        CHECK(p.use_post_buh);
    }

    // Whole-unit current with NO post-BUH row: the pre-BUH outlet stands in only while the heater is
    // provably off. Firing -> blocked, and blocked with its OWN reason, since the UI answers each
    // block with a different sentence.
    CHECK(cop_plan(PelSource::Ct, true, false, BSH_OFF_K, BSH_OFF, false).showable());
    CHECK(cop_plan(PelSource::Ct, true, false, BSH_OFF_K, BSH_OFF, false).scope == CopScope::Plant);
    CHECK(cop_plan(PelSource::Ct, true, true, BSH_OFF_K, BSH_OFF, false).block == CopBlock::BuhNoPostBuh);
    // UNKNOWN is not OFF. Off is the permissive branch here, so guessing it is exactly what would
    // ship the collapsed quotient — the mirror of ou_stale's "unknown rps is not stopped".
    CHECK(cop_plan(PelSource::Ct, /*buh_known=*/false, false, BSH_OFF_K, BSH_OFF, false).block == CopBlock::BuhNoPostBuh);
    CHECK(cop_plan(PelSource::Ct, /*buh_known=*/false, false, BSH_OFF_K, BSH_OFF, true).showable());

    // --- the TANK heater, which no numerator can answer -----------------------------------------
    // BSH heats the DHW tank directly, downstream of the flow sensor and of both leaving-water
    // sensors. Its kilowatts enter a whole-unit divisor while its heat crosses neither R1T nor R2T,
    // so unlike the BUH case there is no row anywhere in the profile that would re-pair them.
    // Blocked even WITH a post-BUH row — that is the whole distinction from BuhNoPostBuh.
    for (bool post : {false, true}) {
        const auto p = cop_plan(PelSource::Ct, true, false, /*bsh_known=*/true, /*bsh_on=*/true, post);
        CHECK(p.block == CopBlock::TankHeater);
        CHECK(!p.showable());
        CHECK(!p.use_post_buh);      // no row is claimed — implying a pairing would be the lie
    }
    // Unknown tank-heater state is not "off" either, same reason as the BUH flag.
    CHECK(cop_plan(PelSource::Ct, true, false, /*bsh_known=*/false, false, true).block == CopBlock::TankHeater);
    // The compressor-only divisor is unaffected: BSH is outside it, so a DHW boost does not block.
    CHECK(cop_plan(PelSource::Inv, true, false, true, /*bsh_on=*/true, true).showable());
    // And the tank heater is checked BEFORE the numerator is picked — a plan that blocks must not
    // also claim a row, or the UI would show a source line for a figure it refuses to state.
    CHECK(!cop_plan(PelSource::Ct, false, true, true, true, true).use_post_buh);

    // --- catalog conformance --------------------------------------------------------------------
    // Every detectable profile resolves EXACTLY ONE post-BUH row, and the BUH state that gates the
    // rule sits on a page that stays live. If the run-state input froze with the outdoor unit the
    // block would be decided from last run's heater state — the failure ou_stale.hpp closes for pel.
    int checked = 0, with_post = 0, with_buh = 0, with_bsh = 0, with_ct = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        const char* labels[192];
        unsigned    regs[192];
        size_t      n = 0;
        for (size_t i = 0; i < p.count && n < 192; i++) {
            labels[n] = p.values[i].label;
            regs[n]   = p.values[i].reg;
            n++;
        }
        int matches = 0;
        for (size_t i = 0; i < n; i++)
            if (cop_is_post_buh(labels[i], regs[i])) matches++;
        CHECK(matches <= 1);                     // never ambiguous — two would make the pick arbitrary
        const int idx = cop_post_buh_select(labels, regs, n);
        if (idx >= 0) {
            with_post++;
            CHECK(!logic::ou_page_holds_over(regs[idx]));                  // a live page, always
            CHECK(logic::lwt_ci_contains(labels[idx], "r2t"));
            CHECK(!logic::lwt_ci_contains(labels[idx], "discharge"));      // never the pipe twin
            // The two pickers must never land on the same row: one is the heat pump's own outlet,
            // the other the outlet after the resistive heater. Collapsing them would make the
            // plant COP and the heat-pump COP the same number and hide the whole distinction.
            const int pre = logic::lwt_select(labels, n);
            CHECK(pre != idx);
        }
        bool has_ct = false, has_bsh = false;
        for (size_t i = 0; i < n; i++) {
            if (logic::lwt_ci_contains(labels[i], "buh step")) {
                CHECK(!logic::ou_page_holds_over(regs[i]));   // 0x60 — live while the O/U sleeps
                with_buh++;
            }
            // The tank heater's own flag. Anchored exactly, like the browser's /^bsh$/ — "Thermal
            // protector BSH" is a different row (a cut-out, not the heater) and must not gate a COP;
            // all 44 tables carry both labels, so an unanchored match would gate on the wrong one.
            // Case-SENSITIVE where the browser's regex is not, and deliberately so: the catalog
            // spells it "BSH" in every table, and if a generator run ever emitted "Bsh" this
            // assertion fails loudly instead of the two twins quietly disagreeing about which
            // profiles can form a plant COP. Strict here is the fail-closed direction.
            const bool is_bsh = labels[i] && (std::strcmp(labels[i], "BSH") == 0);
            if (is_bsh) {
                CHECK(!logic::ou_page_holds_over(regs[i]));   // 0x60 too — the block can't be stale
                has_bsh = true;
                with_bsh++;
            }
            if (logic::lwt_ci_contains(labels[i], "measured by ct")) { has_ct = true; with_ct++; }
        }
        // The load-bearing one. A whole-unit divisor is exactly where the tank heater unbalances the
        // fraction, so every profile that HAS CT clamps must also expose the flag that detects it —
        // otherwise the block would depend on an input that profile cannot supply, and the collapsed
        // quotient would ship on precisely the profiles this rule was written for.
        if (has_ct) CHECK(has_bsh);
        checked++;
    }
    CHECK(checked >= 39);         // the detectable Altherma catalog (mirrors test_lwt_select)
    CHECK(with_post >= checked);  // every detectable profile carries a post-BUH row -> Plant is formable
    CHECK(with_buh > 0);          // the backup-heater state exists across the catalog, not on one profile
    CHECK(with_bsh > 0);          // and so does the tank heater's
    CHECK(with_ct > 0);           // and so does the whole-unit current that makes the scope Plant
}

// ── logic/history.hpp — the 24-hour trend buffers ─────────────────────────────────────────────
// Two things are gated here, and the second is why the outdoor-air trend is not just "the DHW one
// on another page": (a) a trend resolves to exactly one real MEASUREMENT across the whole catalog,
// and (b) a sample taken while the outdoor unit is asleep is stored as HELD_OVER, not as the number
// the bus returned. Without (b) a summer day's outdoor-air trend is a staircase of last-run values
// that reads exactly like weather.
static void test_history() {
    using namespace logic;

    // --- the locator, and the two collisions a label token could not survive --------------------
    // "(R1T)" names the outdoor air sensor on page 0x20 AND the leaving-water sensor on the indoor
    // side (lwt_select keys on that very tag), so the outdoor-air trend must never resolve to a
    // hydronic row however it is spelled — and the byte window is what keeps them apart.
    {
        const uint8_t regs[]  = { 0x61, 0x20 };
        const uint8_t offs[]  = { 2,    0    };
        const char*    units[] = { "°C", "°C" };
        const TrendDef* oa = trend_by_id("outdoor_air");
        CHECK(oa != nullptr);
        CHECK(trend_select(*oa, regs, offs, units, 2) == 1);      // the 0x20 row, never the 0x61 one
        // …and the same offset on the wrong page is refused outright, not trended as outdoor air.
        const uint8_t wrong[] = { 0x61, 0x61 };
        CHECK(trend_select(*oa, wrong, offs, units, 2) == -1);
    }
    // The second collision is INSIDE one byte window: 0x20/12 carries "High Pressure" (bar) and
    // "High Pressure(T)" (its saturation temperature, °C). Only the unit tells them apart, which is
    // why it is half the locator — a bar chart drawing °C is the #35-#39 shape with a history in
    // front of it. (Neither 0x20 pressure is trended today; the rule is what is asserted.)
    {
        const TrendDef probe{ "probe", TrendKind::Row, 0x20, 12, "bar", "" };
        const uint8_t regs[]  = { 0x20,  0x20 };
        const uint8_t offs[]  = { 12,    12   };
        const char*    units[] = { "°C",  "bar" };
        CHECK(trend_select(probe, regs, offs, units, 2) == 1);    // the bar row, never its °C twin
        const TrendDef sat{ "probe", TrendKind::Row, 0x20, 12, "°C", "" };
        CHECK(trend_select(sat, regs, offs, units, 2) == 0);
    }

    // --- a trend is a measurement, never a target (issue #121's rule) ---------------------------
    // Now structural rather than checked per label: a setpoint lives at its own offset (the tank's
    // is 0x60/7), so addressing the measurement's byte window cannot reach it. The catalog test
    // below asserts the consequence over every profile — that no resolved label says "setpoint".
    {
        const TrendDef* dhw = trend_by_id("dhw_tank");
        CHECK(dhw != nullptr);
        CHECK(dhw->reg == 0x61 && dhw->off == 10);
        const uint8_t regs[]  = { 0x60, 0x61 };                  // DHW setpoint, DHW tank temp.
        const uint8_t offs[]  = { 7,    10   };
        const char*    units[] = { "°C", "°C" };
        CHECK(trend_select(*dhw, regs, offs, units, 2) == 1);     // the setpoint sorts first and loses
        CHECK(trend_select(*dhw, regs, offs, units, 1) == -1);    // …and on its own resolves nothing
    }

    CHECK(trend_by_id("nope") == nullptr);                       // unknown id -> 404, never a default
    CHECK(trend_by_id(nullptr) == nullptr);
    CHECK(trend_by_id("dhw_tan") == nullptr);                    // prefix is not a match
    CHECK(trend_by_id("dhw_tank_x") == nullptr);

    // --- what gets STORED --------------------------------------------------------------------
    // The held-over test wins over everything: the bus DID answer, and hp_format DID produce a
    // plausible value — that is exactly what makes this failure invisible without the page rule.
    CHECK(history_store(true, 235, 0x20, /*known=*/true, /*running=*/false) == HISTORY_HELD_OVER);
    CHECK(history_store(true, 235, 0x20, /*known=*/true, /*running=*/true)  == 235);
    CHECK(history_store(true, 235, 0x20, /*known=*/false, /*running=*/false) == 235);  // unknown != stopped
    CHECK(history_store(true, 416, 0x61, /*known=*/true, /*running=*/false) == 416);   // hydronic stays live
    CHECK(history_store(false, 0, 0x61, true, true) == HISTORY_NO_READING);
    CHECK(history_is_absent(HISTORY_NO_READING));
    CHECK(history_is_absent(HISTORY_HELD_OVER));
    CHECK(!history_is_absent(0));                 // 0.0 °C is a READING, not an absence
    CHECK(!history_is_absent(-400));              // and so is -40.0 °C

    // --- the compressor witness ----------------------------------------------------------------
    {
        const char* rows[] = { "R1T-Outdoor air temp.", "INV frequency (rps)" };
        const uint8_t regs[] = { 0x20,                  0x30 };
        CHECK(trend_rps_row(rows, regs, 2) == 1);
        // A witness on a FROZEN page is no witness: it would qualify the very readings it is read
        // from. Refused rather than trusted (belt to ou_stale's catalog braces).
        const uint8_t bad[] = { 0x20, 0x21 };
        CHECK(trend_rps_row(rows, bad, 2) == -1);
        const char* none[] = { "Leaving water temp." };
        const uint8_t r1[] = { 0x61 };
        CHECK(trend_rps_row(none, r1, 1) == -1);          // absent -> UNKNOWN, and unknown keeps storing
    }

    // --- bucket math ---------------------------------------------------------------------------
    // The ring advances on the MONOTONIC clock; a wall-clock bucket would leap on the first SNTP
    // sync of every boot.
    CHECK(history_bucket(0) == 0);
    CHECK(history_bucket(299'999'999LL) == 0);
    CHECK(history_bucket(300'000'000LL) == 1);
    CHECK(history_bucket(24LL * 3600 * 1000000) == HISTORY_SAMPLES);   // a full day later
    // Skipped-bucket arithmetic: adjacent buckets skip NOTHING (the once-per-5-min common case), and
    // a non-advancing clock yields 0 rather than an unsigned wrap-around that would blank the ring.
    CHECK(history_skipped(5, 6) == 0);
    CHECK(history_skipped(5, 7) == 1);
    CHECK(history_skipped(0, 10) == 9);
    CHECK(history_skipped(5, 5) == 0);
    CHECK(history_skipped(6, 5) == 0);            // never 0xFFFFFFFF

    // --- t0 must not depend on WHEN the request arrived --------------------------------------------
    // The load-bearing property. Measured on a live unit before this was fixed: two fetches 70 s
    // apart with an unchanged sample count reported t0 values 70 s apart, because t0 was `now -
    // (n-1)*dt` and assumed the newest sample was taken *now*. That drift is what let a pinned
    // readout round onto the neighbouring slot and describe a different measurement than the one
    // tapped.
    {
        // Same newest sample, three different request times → one answer.
        const int64_t t_a = history_t0(1'000'000, 0,   2, HISTORY_DT_S);
        const int64_t t_b = history_t0(1'000'070, 70,  2, HISTORY_DT_S);
        const int64_t t_c = history_t0(1'000'299, 299, 2, HISTORY_DT_S);
        CHECK(t_a == t_b);
        CHECK(t_b == t_c);
        CHECK(t_a == 1'000'000 - 300);            // sample 0 is one bucket before the newest
        // A closed bucket moves it by exactly one bucket, never by the request delay.
        CHECK(history_t0(1'000'300, 0, 3, HISTORY_DT_S) == t_a);
        // Degenerate counts must not underflow into a bogus instant.
        CHECK(history_t0(1'000'000, 0, 0, HISTORY_DT_S) == 1'000'000);
        CHECK(history_t0(1'000'000, 0, 1, HISTORY_DT_S) == 1'000'000);
        // A full ring: sample 0 is 287 buckets back, still independent of the request time.
        CHECK(history_t0(2'000'000, 0, HISTORY_SAMPLES, HISTORY_DT_S) ==
              history_t0(2'000'123, 123, HISTORY_SAMPLES, HISTORY_DT_S));
    }

    // --- pinning a readout to an instant, not a slot ---------------------------------------------
    // A tap pins the crosshair so the value stays readable. Anchored to the sample's wall-clock
    // instant: the ring shifts a slot every 5 min, so an index anchor would keep pointing at slot 42
    // while slot 42 became a different measurement.
    {
        const int64_t t0 = 1'700'000'000;
        const uint32_t dt = HISTORY_DT_S;
        CHECK(history_pin_index(t0, dt, 288, t0) == 0);                     // the oldest sample
        CHECK(history_pin_index(t0, dt, 288, t0 + 42 * dt) == 42);
        CHECK(history_pin_index(t0, dt, 288, t0 + 287 * dt) == 287);        // the newest
        // Aged out / not yet: the pin is DROPPED, never clamped to an edge — clamping would keep the
        // readout up while silently changing which moment it describes.
        CHECK(history_pin_index(t0, dt, 288, t0 - dt) == -1);
        CHECK(history_pin_index(t0, dt, 288, t0 + 288 * dt) == -1);
        // The roll: same pinned instant, and t0 has advanced by one bucket -> one slot lower.
        CHECK(history_pin_index(t0 + dt, dt, 288, t0 + 42 * dt) == 41);
        // …and after 43 rolls that same instant has fallen off the back entirely.
        CHECK(history_pin_index(t0 + 43 * dt, dt, 288, t0 + 42 * dt) == -1);
        // Nearest-bucket rounding, so a small clock adjustment between pin and re-anchor cannot
        // shift the answer by a whole slot.
        CHECK(history_pin_index(t0, dt, 288, t0 + 42 * dt + 2) == 42);
        CHECK(history_pin_index(t0, dt, 288, t0 + 42 * dt - 2) == 42);
        CHECK(history_pin_index(t0, dt, 288, t0 + 42 * dt + dt / 2 + 1) == 43);   // past halfway
        // Degenerate inputs cannot produce a bogus slot.
        CHECK(history_pin_index(t0, 0, 288, t0) == -1);
        CHECK(history_pin_index(t0, dt, 0, t0) == -1);
        // A single-sample series: only that one instant resolves.
        CHECK(history_pin_index(t0, dt, 1, t0) == 0);
        CHECK(history_pin_index(t0, dt, 1, t0 + dt) == -1);
    }

    // --- held-run encoding ---------------------------------------------------------------------
    {
        uint16_t runs[8][2];
        const HistorySample a[] = { 100, HISTORY_HELD_OVER, HISTORY_HELD_OVER, 120,
                                    HISTORY_NO_READING, HISTORY_HELD_OVER };
        size_t n = history_held_runs(a, 6, runs, 8);
        CHECK(n == 2);
        CHECK(runs[0][0] == 1 && runs[0][1] == 2);
        CHECK(runs[1][0] == 5 && runs[1][1] == 1);        // a NO_READING breaks a held run, not joins it
        // Boundaries: a run that starts at 0 and one that runs to the end.
        const HistorySample b[] = { HISTORY_HELD_OVER, HISTORY_HELD_OVER };
        CHECK(history_held_runs(b, 2, runs, 8) == 1);
        CHECK(runs[0][0] == 0 && runs[0][1] == 2);
        const HistorySample c[] = { 10, 20 };
        CHECK(history_held_runs(c, 2, runs, 8) == 0);     // nothing held -> no runs, not one empty run
        // A full alternating series must fit — HISTORY_MAX_RUNS is sized for exactly this.
        static HistorySample alt[HISTORY_SAMPLES];
        static uint16_t big[HISTORY_MAX_RUNS][2];
        for (size_t i = 0; i < HISTORY_SAMPLES; i++) alt[i] = (i % 2) ? HISTORY_HELD_OVER : 200;
        CHECK(history_held_runs(alt, HISTORY_SAMPLES, big, HISTORY_MAX_RUNS) == HISTORY_SAMPLES / 2);
    }

    // --- parsing the cache's formatted value back to tenths --------------------------------------
    {
        int v = -1;
        CHECK(history_parse_tenths("41.6", v) && v == 416);
        CHECK(history_parse_tenths("-7.5", v) && v == -75);
        CHECK(history_parse_tenths("0.0", v) && v == 0);
        CHECK(history_parse_tenths("23", v) && v == 230);        // no decimal point is still a number
        // Reject legacy/corrupt nonnumeric states rather than letting strtof turn them into a
        // confident 0.0 line. Current binary values reach history as numeric 1/0.
        CHECK(!history_parse_tenths("ON", v));
        CHECK(!history_parse_tenths("OFF", v));
        CHECK(!history_parse_tenths("U4", v));                   // a fault code
        CHECK(!history_parse_tenths("", v));                     // nothing decoded this cycle
        CHECK(!history_parse_tenths(nullptr, v));
        // Must not collide with the absence sentinels, which sit at the very bottom of int16:
        // -32768 is NO_READING and -32767 is HELD_OVER, so -3276.6 is the first real reading below
        // them. (These are also the ±3276.x "no data" sentinels the X10A units themselves emit —
        // issue #35-#39 — which reading_plausible() already refuses upstream; this is the belt.)
        CHECK(!history_parse_tenths("-3276.8", v));              // == HISTORY_NO_READING
        CHECK(!history_parse_tenths("-3276.7", v));              // == HISTORY_HELD_OVER
        CHECK(history_parse_tenths("-3276.6", v) && v == -32766); // …the first one that is a reading
        CHECK(!history_parse_tenths("nan", v));
        CHECK(!history_parse_tenths("inf", v));

        // ROUND-TRIP EXACTNESS, asserted rather than assumed. The stored sample must equal the value
        // the device published, for every 0.1 step across the plausible range — hp_convert writes
        // "%.1f" and this reads it back, and a float that landed one ULP low would truncate to the
        // wrong tenth and shift a whole chart by 0.1 °C with nothing to show it. ±200 °C is
        // reading_plausible()'s own window, so this covers everything that can reach a trend.
        int mismatches = 0;
        for (int tenths = -2000; tenths <= 2000; tenths++) {
            char buf[16];
            std::snprintf(buf, sizeof(buf), "%.1f", tenths / 10.0);
            int back = INT32_MIN;
            if (!history_parse_tenths(buf, back) || back != tenths) mismatches++;
        }
        CHECK(mismatches == 0);
    }

    // --- the ring ------------------------------------------------------------------------------
    {
        TrendRing r;
        CHECK(r.snapshot(nullptr, 0) == 0);            // empty ring reads out nothing
        static HistorySample out[HISTORY_SAMPLES + 4];

        // Folding: a real reading beats absence whenever it arrives in the bucket, a later reading
        // beats an earlier one, and absence keeps the LAST reason.
        r.fold(HISTORY_NO_READING);
        r.fold(250);
        r.fold(HISTORY_HELD_OVER);                     // absence must NOT overwrite a measurement
        CHECK(r.pending == 250);
        r.fold(260);
        CHECK(r.pending == 260);
        r.commit(0);
        CHECK(r.snapshot(out, 4) == 1 && out[0] == 260);
        CHECK(r.pending == HISTORY_NO_READING);        // the next bucket starts empty

        r.fold(HISTORY_NO_READING);
        r.fold(HISTORY_HELD_OVER);                     // last reason wins when nothing was measured
        r.commit(0);
        CHECK(r.snapshot(out, 4) == 2 && out[1] == HISTORY_HELD_OVER);

        // Skipped buckets are FILLED, not compressed: a dead bus must not slide the earlier samples
        // forward in time. Three skipped -> three NO_READING between the commits.
        r.fold(300);
        r.commit(3);
        CHECK(r.snapshot(out, 8) == 6);
        CHECK(out[2] == 300);
        CHECK(out[3] == HISTORY_NO_READING && out[4] == HISTORY_NO_READING && out[5] == HISTORY_NO_READING);
    }
    {
        // Wrap-around: fill past capacity and the readout must still be oldest-first, dropping only
        // the samples that actually fell off the back.
        TrendRing r;
        for (int i = 0; i < static_cast<int>(HISTORY_SAMPLES) + 5; i++) { r.fold(static_cast<HistorySample>(i)); r.commit(0); }
        static HistorySample out[HISTORY_SAMPLES];
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == HISTORY_SAMPLES);
        CHECK(out[0] == 5);                                   // 0..4 aged out
        CHECK(out[HISTORY_SAMPLES - 1] == static_cast<HistorySample>(HISTORY_SAMPLES + 4));
        for (size_t i = 1; i < HISTORY_SAMPLES; i++) CHECK(out[i] == out[i - 1] + 1);   // monotonic, no seam
        // A snapshot smaller than the ring takes the OLDEST n, which is what keeps the caller's
        // time axis anchored at t0 rather than silently shifting it.
        static HistorySample few[10];
        CHECK(r.snapshot(few, 10) == 10 && few[0] == 5);
        // reset() really empties it — a model change must not leave the previous unit's tail behind.
        r.reset();
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == 0);
    }
    {
        // A skip larger than the whole ring must not run away: it fills at most one full ring.
        TrendRing r;
        r.fold(100);
        r.commit(100000);
        static HistorySample out[HISTORY_SAMPLES];
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == HISTORY_SAMPLES);
        for (size_t i = 0; i < HISTORY_SAMPLES; i++) CHECK(out[i] == HISTORY_NO_READING);  // 100 aged out
    }

    // --- catalog conformance ------------------------------------------------------------------
    // The locator is only worth anything if it addresses ONE row, on EVERY profile that carries the
    // quantity — so both halves are measured here rather than assumed. `min_profiles` is the count
    // measured over today's catalog: a generated profile that moved a row, or a generator run that
    // dropped one, has to fail here and not on someone's dashboard. `unit_type` is the catalog's
    // own type code (convert.hpp: 1 = °C, 2 = bar, -1 = none) and must agree with the unit string
    // the TRENDS entry addresses the row by — GET /history prints that string into the chart's range
    // readout and its crosshair.
    struct TrendExpect { const char* id; int min_profiles; int unit_type; int size; };
    static const TrendExpect kExpect[] = {
        { "dhw_tank",         39, 1,  2 },
        { "leaving_water",    39, 1,  2 },
        { "return_water",     39, 1,  2 },
        { "water_pressure",   39, 2,  1 },   // the one bar row that is WATER, not refrigerant
        { "flow",             39, -1, 2 },   // unit lives in the label ("Flow sensor (l/min)")
        { "pump_signal",      39, -1, 1 },
        { "circuit_pressure", 24, 2,  2 },   // refrigerant, on the hydronic page — stays live
        { "comp_rps",         26, -1, 1 },   // 13 detection profiles carry no 0x30 page at all
        { "eev",              26, -1, 2 },   // same 0x30 page as comp_rps — the same 26 profiles
        { "outdoor_air",      39, 1,  2 },
        { "discharge",        39, 1,  2 },
        { "room_temp",        39, 1,  2 },   // "Indoor ambient temp. (R1T)" / "RT Temp." — one locator
        { "inv_current",      39, -1, 2 },   // every profile has it; only ~half have CT clamps
        { "ct_l1",            20, -1, 1 },
        { "ct_l2",            20, -1, 1 },
        { "ct_l3",            20, -1, 1 },
        // The board trends resolve no catalog row at all — every expectation below is skipped for
        // them, and what they must satisfy instead is asserted in its own block further down. They
        // are listed so the static_assert keeps forcing a decision for every TRENDS entry.
        { "free_heap",        0,  0,  0 },
        { "max_alloc",        0,  0,  0 },
    };
    static_assert(sizeof(kExpect) / sizeof(kExpect[0]) == TREND_COUNT,
                  "every TRENDS entry needs its measured catalog expectation here");

    // Positions of the three trends whose pick is cross-checked against another rule below, by id
    // rather than by counting rows in the table.
    size_t i_lwt = TREND_COUNT, i_rps = TREND_COUNT, i_oa = TREND_COUNT;
    for (size_t t = 0; t < TREND_COUNT; t++) {
        if (trend_cstr_eq(TRENDS[t].id, "leaving_water")) i_lwt = t;
        if (trend_cstr_eq(TRENDS[t].id, "comp_rps"))      i_rps = t;
        if (trend_cstr_eq(TRENDS[t].id, "outdoor_air"))   i_oa  = t;
    }
    CHECK(i_lwt < TREND_COUNT && i_rps < TREND_COUNT && i_oa < TREND_COUNT);

    int checked = 0;
    int found[TREND_COUNT] = {0};
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        const char* labels[512];
        const char* units[512];
        uint8_t     regs[512];
        uint8_t     offs[512];
        size_t n = p.count < 512 ? p.count : 512;
        for (size_t i = 0; i < n; i++) {
            labels[i] = p.values[i].label;
            units[i]  = unit_for_datatype(p.values[i].type);
            regs[i]   = p.values[i].reg;
            offs[i]   = p.values[i].offset;
        }

        int picked[TREND_COUNT];
        for (size_t t = 0; t < TREND_COUNT; t++) {
            const TrendDef* d = trend_by_id(kExpect[t].id);
            CHECK(d != nullptr);
            CHECK(d == &TRENDS[t]);                  // kExpect is in TRENDS order — keep it that way
            picked[t] = trend_select(*d, regs, offs, units, n);
            if (picked[t] < 0) continue;
            found[t]++;

            // ONE row, not merely a first one. Ambiguity is what a label token had and a locator is
            // supposed to remove; if a profile ever carries two rows in the same byte window with
            // the same unit, the pick becomes table order — which is not a rule anyone stated.
            int hits = 0;
            for (size_t i = 0; i < n; i++)
                if (trend_row_matches(*d, regs[i], offs[i], units[i])) hits++;
            CHECK(hits == 1);

            CHECK(p.values[picked[t]].type == kExpect[t].unit_type);
            CHECK(trend_cstr_eq(d->unit, unit_for_datatype(kExpect[t].unit_type)));
            // One width per trend, so the tenths the ring stores are exact rather than rounded.
            CHECK(p.values[picked[t]].size == kExpect[t].size);
            // The #121 rule, now a consequence of the locator rather than a filter: a target lives
            // at its own offset, so no trend can reach one. Asserted over the whole catalog because
            // a generated rename is exactly how it would come back.
            CHECK(!lwt_ci_contains(labels[picked[t]], "setpoint"));
            CHECK(!lwt_ci_contains(labels[picked[t]], "set point"));
            // A row on a frozen page is gated; one on a live page is not. Derived from the row's own
            // reg, so the two can never disagree (there is no second page field to drift).
            const bool frozen = ou_page_holds_over(regs[picked[t]]);
            CHECK(history_store(true, 190, regs[picked[t]], true, false) ==
                  (frozen ? HISTORY_HELD_OVER : 190));
        }

        // No two trends may buffer the same row — 576 bytes spent twice on one sensor, under two
        // names, in a UI that would then offer the same chart from two places.
        for (size_t a = 0; a < TREND_COUNT; a++)
            for (size_t b = a + 1; b < TREND_COUNT; b++)
                CHECK(picked[a] < 0 || picked[b] < 0 || picked[a] != picked[b]);

        // The leaving-water trend must be the row lwt_select picks — not "a leaving-water row".
        // #121 is what happens when a second, looser rule answers this question: a setpoint or a
        // mixed-zone row substituted for the pre-BUH measurement. The locator is the tighter rule of
        // the two, so binding them here is what keeps it from becoming an independent second one.
        CHECK(picked[i_lwt] == lwt_select(labels, n));
        // …and the compressor trend is the very row the held-over gate reads as its witness.
        CHECK(picked[i_rps] == trend_rps_row(labels, regs, n));
        // Outdoor air must never be a row lwt_select would take for leaving water (the "(R1T)"
        // collision, asserted from the catalog side).
        if (picked[i_oa] >= 0) CHECK(!lwt_is_measurement(labels[picked[i_oa]]));
        checked++;
    }
    CHECK(checked >= 39);        // the detectable Altherma catalog (mirrors test_lwt_select/ou_stale)

    // Coverage, measured — not a token non-zero. A trend that silently stopped resolving on half the
    // catalog would still be "working" on the author's own unit.
    for (size_t t = 0; t < TREND_COUNT; t++) CHECK(found[t] >= kExpect[t].min_profiles);

    // --- the BOARD trends: no row, no page, no profile ------------------------------------------
    // They share the table, the ring and the route with the catalog trends and must not share their
    // failure modes. Two things are asserted: a board trend carries its own label (nothing else can
    // give it one — the /status.history entry would otherwise be dropped as "profile lacks the row"),
    // and it resolves NO catalog row, on any profile, ever.
    int board_trends = 0;
    for (size_t t = 0; t < TREND_COUNT; t++) {
        if (TRENDS[t].kind == TrendKind::Row) {
            CHECK(TRENDS[t].label[0] == '\0');   // a row's label is the PROFILE's, discovered at runtime
            continue;
        }
        board_trends++;
        CHECK(TRENDS[t].label[0] != '\0');
        CHECK(trend_cstr_eq(TRENDS[t].unit, "KiB"));
        CHECK(found[t] == 0);
    }
    CHECK(board_trends == 2);
    {
        // The locator of a board trend is (0, 0) — which is a REAL byte window. Nothing may make it
        // match: the kind is checked first, so even a row crafted to look exactly like it is refused.
        const TrendDef* fh = trend_by_id("free_heap");
        CHECK(fh != nullptr && fh->kind == TrendKind::FreeHeap);
        const uint8_t regs[] = { 0 };
        const uint8_t offs[] = { 0 };
        const char*   units[] = { "KiB" };
        CHECK(trend_select(*fh, regs, offs, units, 1) == -1);
        CHECK(!trend_row_matches(*fh, 0, 0, "KiB"));
    }

    // Bytes → tenths of a KiB, the board trends' storage unit. The clamp is the point: the ring is
    // int16, and a wrapped heap figure would be a plausible small number on a chart about running
    // out of memory. Unsigned input, so no sample can ever land on an absence sentinel.
    CHECK(history_bytes_tenths_kib(0) == 0);
    CHECK(history_bytes_tenths_kib(1024) == 10);            // 1.0 KiB
    CHECK(history_bytes_tenths_kib(1536) == 15);            // 1.5 KiB
    CHECK(history_bytes_tenths_kib(150000) == 1465);        // 146.5 KiB — a realistic free heap
    CHECK(history_bytes_tenths_kib(4u * 1024 * 1024) == INT16_MAX);      // clamped, not wrapped
    CHECK(history_bytes_tenths_kib(0xFFFFFFFFu) == INT16_MAX);           // …at any size
    CHECK(!history_is_absent(history_bytes_tenths_kib(0xFFFFFFFFu)));    // and never an "absence"
    CHECK(!history_is_absent(history_bytes_tenths_kib(0)));

    // The two trends that shipped first must be UNCHANGED by the move from label tokens to
    // locators: same concept, same rows. Cheapest possible proof — the labels still say so.
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        const char* labels[512];
        const char* units[512];
        uint8_t     regs[512];
        uint8_t     offs[512];
        size_t n = p.count < 512 ? p.count : 512;
        for (size_t i = 0; i < n; i++) {
            labels[i] = p.values[i].label;
            units[i]  = unit_for_datatype(p.values[i].type);
            regs[i]   = p.values[i].reg;
            offs[i]   = p.values[i].offset;
        }
        const int dhw = trend_select(*trend_by_id("dhw_tank"), regs, offs, units, n);
        const int oa  = trend_select(*trend_by_id("outdoor_air"), regs, offs, units, n);
        CHECK(dhw >= 0 && lwt_ci_contains(labels[dhw], "dhw tank"));
        CHECK(oa >= 0 && lwt_ci_contains(labels[oa], "outdoor air"));
    }
}

// ── The 24-hour plant checkup (logic/checkup.hpp, issue #208) ─────────────────────────────────
// Three things are worth testing here and one of them is worth most of the file:
//
//  (a) the LOCATOR. Six of the rows this reads live in ONE byte (0x60 offset 12) and are told apart
//      only by which bit their converter masks. A locator that dropped the converter would resolve
//      "backup heater minutes" onto the 3-way valve's position — a plausible number, attributed to
//      the wrong thing, with a day's statistics in front of it. The catalog sweep at the bottom
//      asserts uniqueness AND identity (the resolved row's label) on every shipped profile.
//  (b) the EDGE. A compressor start is only countable if "unknown" never reads as "stopped" and a
//      poll gap never reads as a transition. Both are invisible on a board: the counter is simply
//      wrong, and there is nothing to compare it against.
//  (c) the VERDICT boundaries, and the one property that makes the card honest — a window that has
//      not collected enough can never aggregate to a green overall.
static void test_checkup() {
    using namespace logic;

    // --- the locator, and the collision it exists for ------------------------------------------
    {
        // Exactly the 0x60/12 stack, in catalog order. Every one of them is dimensionless and one
        // byte, so (reg, offset, unit) — logic/history.hpp's locator — resolves all six to the same
        // row. Only the converter separates them.
        const uint8_t regs[]  = { 0x60, 0x60, 0x60,  0x60,  0x60,  0x60 };
        const uint8_t offs[]  = { 12,   12,   12,    12,    12,    12   };
        const int     convs[] = { 307,  306,  305,   304,   303,   301  };
        //                        2way  3way  BSH    BUH1   BUH2   pump
        CHECK(checkup_select(CHECKUP_LOC_BUH1, regs, offs, convs, 6) == 3);
        CHECK(checkup_select(CHECKUP_LOC_BUH2, regs, offs, convs, 6) == 4);
        CHECK(checkup_select(CHECKUP_LOC_BSH,  regs, offs, convs, 6) == 2);
        CHECK(checkup_select(CHECKUP_LOC_PUMP, regs, offs, convs, 6) == 5);
        // The 3-way valve and the 2-way valve sit in the same byte and are addressed by neither —
        // no health check reads them, and none may resolve onto them by accident.
        for (const CheckupLocator* l : { &CHECKUP_LOC_BUH1, &CHECKUP_LOC_BUH2, &CHECKUP_LOC_BSH,
                                        &CHECKUP_LOC_PUMP }) {
            const int i = checkup_select(*l, regs, offs, convs, 6);
            CHECK(i >= 0 && convs[i] != 307 && convs[i] != 306);
        }
        // Right byte, wrong page: refused outright rather than taken as a near miss.
        const uint8_t other[] = { 0x61, 0x61, 0x61, 0x61, 0x61, 0x61 };
        CHECK(checkup_select(CHECKUP_LOC_BUH1, other, offs, convs, 6) == -1);
        // A profile that carries none of them resolves nothing — an absent feature, stated by
        // absence rather than by a zero.
        const uint8_t none_r[] = { 0x61 };
        const uint8_t none_o[] = { 2 };
        const int     none_c[] = { 105 };
        CHECK(checkup_select(CHECKUP_LOC_BUH1, none_r, none_o, none_c, 1) == -1);
    }
    // The two converter-matched inputs. They are matched by converter ALONE because a profile
    // carries an error class on the outdoor page AND the hydronic one; a locator would pick one unit
    // and miss the other's fault.
    CHECK(checkup_is_fault_class(203));
    CHECK(!checkup_is_fault_class(204));           // the CODE is textual and open-ended — not this
    CHECK(checkup_is_retry_counter(310) && checkup_is_retry_counter(311));
    CHECK(!checkup_is_retry_counter(303) && !checkup_is_retry_counter(307));   // the DROP flags, not counters

    // --- bucket math ----------------------------------------------------------------------------
    CHECK(checkup_bucket(0) == 0);
    CHECK(checkup_bucket(3599'999'999LL) == 0);
    CHECK(checkup_bucket(3600'000'000LL) == 1);
    CHECK(checkup_bucket(24LL * 3600 * 1000000) == CHECKUP_BUCKETS);
    CHECK(checkup_skipped(5, 6) == 0);             // adjacent hours skip nothing
    CHECK(checkup_skipped(5, 8) == 2);
    CHECK(checkup_skipped(5, 5) == 0);
    CHECK(checkup_skipped(6, 5) == 0);             // never an unsigned wrap-around

    // --- saturation -----------------------------------------------------------------------------
    // A wrap would turn the worst imaginable cycling into a perfect score.
    CHECK(checkup_add_u8(250, 3) == 253);
    CHECK(checkup_add_u8(254, 5) == 255);
    CHECK(checkup_add_u8(255, 1) == 255);
    CHECK(checkup_add_u16(65530, 3) == 65533);
    CHECK(checkup_add_u16(65535, 10) == 65535);

    // --- the edge, which is the whole reason this is not derived from the trend rings -----------
    {
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known = true;

        // The first sample of a boot has no predecessor: no delta, no edge, whatever it shows.
        s.rps_running = true;
        checkup_step(st, b, s, 0);
        CHECK(b.starts == 0 && b.covered_s == 0 && b.run_s == 0);

        // A running second is booked as a running second.
        checkup_step(st, b, s, 1'000'000);
        CHECK(b.covered_s == 1 && b.run_s == 1 && b.starts == 0);

        // stop → start is ONE start, and only on the transition.
        s.rps_running = false;
        checkup_step(st, b, s, 2'000'000);
        CHECK(b.starts == 0 && b.run_s == 1);
        s.rps_running = true;
        checkup_step(st, b, s, 3'000'000);
        CHECK(b.starts == 1);
        checkup_step(st, b, s, 4'000'000);
        CHECK(b.starts == 1);                     // still running is not another start
    }
    {
        // UNKNOWN is not stopped — the rule logic/ou_stale.hpp states, applied to an edge. A profile
        // that stops reporting the witness for one cycle must not book a stop and then a start.
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known = true; s.rps_running = true;
        checkup_step(st, b, s, 1'000'000);
        checkup_step(st, b, s, 2'000'000);
        s.rps_known = false; s.rps_running = false;        // the row went missing this cycle
        checkup_step(st, b, s, 3'000'000);
        s.rps_known = true;  s.rps_running = true;
        checkup_step(st, b, s, 4'000'000);
        CHECK(b.starts == 0);                     // no phantom start across the unknown cycle
        // Three deltas were observed (the first sample of a boot has no predecessor and books
        // nothing) and the UNKNOWN one is not among the running ones.
        CHECK(b.run_s == 2);
    }
    {
        // A POLL GAP breaks continuity in both directions: no seconds, and no transition. Without
        // this a two-minute bus stall would book two minutes of whatever preceded it and one start
        // that may in truth have been three.
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known = true; s.rps_running = false;
        checkup_step(st, b, s, 1'000'000);
        s.rps_running = true;
        checkup_step(st, b, s, 1'000'000 + (CHECKUP_MAX_GAP_S + 5) * 1'000'000LL);
        CHECK(b.starts == 0);
        CHECK(b.covered_s == 0);
        // …and the very next in-window sample still cannot use the pre-gap state as its predecessor:
        // the gap cycle has already replaced it (with the same value here, so the next transition is
        // measured from the post-gap reading, which is the only one that was observed).
        s.rps_running = false;
        checkup_step(st, b, s, 1'000'000 + (CHECKUP_MAX_GAP_S + 6) * 1'000'000LL);
        s.rps_running = true;
        checkup_step(st, b, s, 1'000'000 + (CHECKUP_MAX_GAP_S + 7) * 1'000'000LL);
        CHECK(b.starts == 1);
        // A gap exactly at the limit is still continuous — the boundary is inclusive.
        CheckupState st2;
        CheckupBucket b2;
        CheckupSample s2;
        s2.rps_known = true; s2.rps_running = true;
        checkup_step(st2, b2, s2, 0);
        checkup_step(st2, b2, s2, CHECKUP_MAX_GAP_S * 1'000'000LL);
        CHECK(b2.covered_s == CHECKUP_MAX_GAP_S);
    }
    {
        // Defrost: counted on the edge, and the "above the frost line" flag is read AT that edge —
        // not averaged over the window, and never from a held-over outdoor reading (health.cpp
        // passes oat_ok=false for one, so a frozen 25 °C from the last run cannot raise it).
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.defrost_known = true; s.defrost_on = false;
        s.oat_ok = true; s.oat_tenths = 200;              // 20.0 °C — no frost is possible here
        checkup_step(st, b, s, 1'000'000);
        s.defrost_on = true;
        checkup_step(st, b, s, 2'000'000);
        CHECK(b.defrosts == 1);
        CHECK((b.flags & CHECKUP_F_WARM) != 0);
        checkup_step(st, b, s, 3'000'000);
        CHECK(b.defrosts == 1 && b.defrost_s == 2);       // held on: seconds accrue, count does not
        // A cold defrost raises no flag, and an UNREADABLE outdoor temperature raises none either —
        // absence of evidence is not evidence.
        CheckupBucket c;
        CheckupState st2;
        CheckupSample s2;
        s2.defrost_known = true; s2.defrost_on = false;
        s2.oat_ok = true; s2.oat_tenths = 20;             // 2.0 °C — ordinary defrost weather
        checkup_step(st2, c, s2, 1'000'000);
        s2.defrost_on = true;
        checkup_step(st2, c, s2, 2'000'000);
        CHECK(c.defrosts == 1 && (c.flags & CHECKUP_F_WARM) == 0);
        CheckupBucket d;
        CheckupState st3;
        CheckupSample s3;
        s3.defrost_known = true; s3.defrost_on = false; s3.oat_ok = false; s3.oat_tenths = 200;
        checkup_step(st3, d, s3, 1'000'000);
        s3.defrost_on = true;
        checkup_step(st3, d, s3, 2'000'000);
        CHECK(d.defrosts == 1 && (d.flags & CHECKUP_F_WARM) == 0);
    }
    {
        // Minima. Pressure is sampled unconditionally (it is a property of the circuit whether or
        // not anything runs); FLOW is only a measurement while the pump moves water — a stopped
        // pump reads ~0 l/min, which is neither a restriction nor news, and booking it would make
        // every idle plant look blocked.
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.bar_ok = true; s.bar_tenths = 18;
        s.flow_ok = true; s.flow_tenths = 2;
        s.pump_known = true; s.pump_on = false;
        checkup_step(st, b, s, 1'000'000);
        CHECK(b.min_bar == 18);
        CHECK(b.min_flow == CHECKUP_ABSENT);               // pump off: not a flow measurement
        s.pump_on = true; s.flow_tenths = 124;
        checkup_step(st, b, s, 2'000'000);
        CHECK(b.min_flow == 124);
        s.flow_tenths = 98;
        checkup_step(st, b, s, 3'000'000);
        CHECK(b.min_flow == 98);                          // the MINIMUM, not the latest
        s.flow_tenths = 300;
        checkup_step(st, b, s, 4'000'000);
        CHECK(b.min_flow == 98);
        s.bar_tenths = 9;
        checkup_step(st, b, s, 5'000'000);
        CHECK(b.min_bar == 9);
        // An unknown pump state is NOT an on pump (the permissive branch is the wrong default here
        // for the same reason it is for the compressor).
        CheckupBucket c;
        CheckupState st2;
        CheckupSample s2;
        s2.flow_ok = true; s2.flow_tenths = 1; s2.pump_known = false; s2.pump_on = false;
        checkup_step(st2, c, s2, 1'000'000);
        CHECK(c.min_flow == CHECKUP_ABSENT);
    }
    {
        // A retry counter only means something against a RUNNING compressor — feature_gate.hpp's
        // uc5_supported() says so, and this is where that is enforced rather than restated.
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.retry_known = true; s.retry_max_tenths = 20;    // "2" retries, in the parser's tenths
        s.rps_known = true; s.rps_running = false;
        checkup_step(st, b, s, 1'000'000);
        CHECK((b.flags & CHECKUP_F_RETRY) == 0);
        s.rps_running = true;
        checkup_step(st, b, s, 2'000'000);
        CHECK((b.flags & CHECKUP_F_RETRY) != 0);
        // A zero counter while running raises nothing — 0 is the healthy reading.
        CheckupBucket c;
        CheckupState st2;
        CheckupSample s2;
        s2.retry_known = true; s2.retry_max_tenths = 0; s2.rps_known = true; s2.rps_running = true;
        checkup_step(st2, c, s2, 1'000'000);
        checkup_step(st2, c, s2, 2'000'000);
        CHECK((c.flags & CHECKUP_F_RETRY) == 0);
    }
    {
        // The fault flags come from conv 203's OWN class table (logic/fault_state.hpp), so a class
        // renamed there is understood here for free — and an UNKNOWN class sets neither flag, which
        // is the one direction a fault report must never fail in.
        CheckupState st;
        CheckupBucket b;
        CheckupSample s;
        s.fault = FaultClass::Unknown;
        checkup_step(st, b, s, 1'000'000);
        CHECK((b.flags & (CHECKUP_F_FAULT | CHECKUP_F_WARNING)) == 0);
        s.fault = FaultClass::Caution;
        checkup_step(st, b, s, 2'000'000);
        CHECK((b.flags & CHECKUP_F_WARNING) != 0 && (b.flags & CHECKUP_F_FAULT) == 0);
        s.fault = FaultClass::Error;
        checkup_step(st, b, s, 3'000'000);
        CHECK((b.flags & CHECKUP_F_FAULT) != 0);
        s.fault = FaultClass::Normal;
        checkup_step(st, b, s, 4'000'000);
        CHECK((b.flags & CHECKUP_F_FAULT) != 0);           // the flag is "happened", not "is happening"
    }

    // --- the ring -------------------------------------------------------------------------------
    {
        CheckupRing r;
        r.pending.starts = 3;
        r.pending.covered_s = 3600;
        r.commit(0);
        CHECK(r.count == 1);
        CHECK(r.pending.starts == 0 && r.pending.covered_s == 0);   // the next hour starts empty
        CheckupWindow w = checkup_aggregate(r);
        CHECK(w.starts == 3 && w.covered_s == 3600);

        // A skipped hour is pushed EMPTY, never filled with a guess: nobody watched it, so it
        // contributed nothing — which is exactly what keeps covered_s an honest number.
        r.pending.starts = 2;
        r.pending.covered_s = 3600;
        r.commit(2);
        CHECK(r.count == 4);
        w = checkup_aggregate(r);
        CHECK(w.starts == 5 && w.covered_s == 7200);      // 2 hours observed out of 4 elapsed
    }
    {
        // Wrap-around: a full day plus five hours holds exactly 24, and the oldest five are gone.
        CheckupRing r;
        for (int i = 0; i < static_cast<int>(CHECKUP_BUCKETS) + 5; i++) {
            r.pending.starts = 1;
            r.pending.covered_s = 3600;
            r.commit(0);
        }
        CHECK(r.count == CHECKUP_BUCKETS);
        const CheckupWindow w = checkup_aggregate(r);
        CHECK(w.starts == CHECKUP_BUCKETS);
        CHECK(w.covered_s == CHECKUP_BUCKETS * 3600u);
        // A skip larger than the whole ring must not run away.
        CheckupRing r2;
        r2.pending.starts = 9;
        r2.commit(100000);
        CHECK(r2.count == CHECKUP_BUCKETS);
        CHECK(checkup_aggregate(r2).starts == 0);          // the 9 aged out, nothing invented
    }
    {
        // The window minimum is the minimum ACROSS buckets, and an hour that measured nothing does
        // not drag it to a sentinel.
        CheckupRing r;
        r.pending.min_bar = 18;
        r.commit(0);
        r.commit(0);                                       // an hour with no pressure reading at all
        r.pending.min_bar = 11;
        CheckupWindow w = checkup_aggregate(r);
        CHECK(w.min_bar == 11);
        CheckupRing empty;
        CHECK(checkup_aggregate(empty).min_bar == CHECKUP_ABSENT);
        CHECK(checkup_aggregate(empty).min_flow == CHECKUP_ABSENT);
    }
    CHECK(checkup_aggregate(CheckupRing{}).covered_s == 0);
    {
        // reset() really empties it.
        CheckupRing r;
        r.pending.starts = 4;
        r.commit(0);
        r.reset();
        CHECK(r.count == 0 && checkup_aggregate(r).starts == 0);
    }

    // --- verdicts -------------------------------------------------------------------------------
    // Full coverage unless a case says otherwise; the caller's job in every block below is to move
    // ONE input across a boundary.
    CheckupCoverage full;
    full.rps = full.defrost = full.heater = full.pump = true;
    full.pressure = full.flow = full.fault = full.retries = true;

    auto day = []() {
        CheckupWindow w;
        w.covered_s = 24u * 3600;
        return w;
    };

    {
        // CYCLING. Both conditions are required, and the mean run length is what knows the load: 24
        // starts on a cold day is one an hour and healthy, 24 in the shoulder season is cycling —
        // the count alone cannot tell those apart, which is why #208's flat "> 25 = excessive"
        // threshold is not what shipped.
        CheckupWindow w = day();
        w.starts = 24;
        w.run_s  = 24u * 1800;                             // 30-minute mean — a well-behaved plant
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        // Same start count, quarter-hour cycles: still fine.
        w.run_s = 24u * 900;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        // …and the boundary itself. 600 s exactly is not "under ten minutes".
        w.run_s = 24u * CHECKUP_CYCLING_SHORT_RUN_S;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        w.run_s = 24u * (CHECKUP_CYCLING_SHORT_RUN_S - 1);
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Warn);
            CHECK(r[CheckupCheck::Cycling].a == 24);
            CHECK(r[CheckupCheck::Cycling].b == static_cast<int>(CHECKUP_CYCLING_SHORT_RUN_S) - 1);
            CHECK(r.overall == CheckupVerdict::Warn);       // one Warn carries the whole card
        }
        // Too few starts to read a mean off: below the guard the short mean is not reported as a
        // finding, because two five-minute runs in a day is a quiet plant, not a cycling one.
        w.starts = CHECKUP_CYCLING_MIN_STARTS - 1;
        w.run_s  = w.starts * 60;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        w.starts = CHECKUP_CYCLING_MIN_STARTS;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Warn);
        // A plant that never started is not cycling — and says zero rather than nothing.
        w.starts = 0;
        w.run_s  = 0;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Cycling].a == 0);
        }
    }
    {
        // COLLECTING — the property that makes a fresh board honest. This device reboots in bursts
        // (#215: 55 restarts in 7 days) and the ring is RAM-only, so a half-observed window is the
        // NORMAL case, not an edge one. It must never aggregate to a green overall.
        CheckupWindow w;
        w.covered_s = CHECKUP_MIN_S_CYCLING - 1;
        w.starts = 40;
        w.run_s  = 40 * 60;                                // cycling hard, on four hours of evidence
        const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
        CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Collecting);
        CHECK(r[CheckupCheck::Cycling].a == 40);            // the count so far is still reported
        CHECK(r.overall != CheckupVerdict::Ok);
        CHECK(r.covered_s == CHECKUP_MIN_S_CYCLING - 1);
        // One second more and the same window is judged.
        w.covered_s = CHECKUP_MIN_S_CYCLING;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Warn);
    }
    {
        // DEFROST is a SHARE of runtime, not a count: four defrosts across a day of hard running is
        // normal, four inside two hours of running is not.
        CheckupWindow w = day();
        w.defrosts  = 6;
        w.run_s     = 6u * 3600;
        w.defrost_s = 1200;                                // 5.5 % of runtime
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Ok);
        w.defrost_s = 6u * 3600 * 20 / 100;                // 20 %
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Defrost].verdict == CheckupVerdict::Warn);
            CHECK(r[CheckupCheck::Defrost].a == 6 && r[CheckupCheck::Defrost].b == 20);
        }
        // The count guard: one defrost inside a very short run reads as 100 % and must not fire.
        w.defrosts  = CHECKUP_DEFROST_MIN_COUNT - 1;
        w.run_s     = 600;
        w.defrost_s = 600;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Ok);
        // Defrosting above the frost line is Info, never Warn: it is physically odd, but humidity is
        // not on this bus and the stronger claim cannot be made.
        w = day();
        w.defrosts = 1;
        w.run_s    = 3600;
        w.flags    = CHECKUP_F_WARM;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Info);
        // A plant that never ran divides by nothing: the share is not established, and is reported
        // as such rather than as a confident zero.
        w = day();
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].b == -1);
    }
    {
        // WATER PRESSURE. Below 1.2 bar is worth mentioning; below 1.0 bar is out of specification.
        // No "critical" band underneath — the unit's own low-pressure protection defines that point,
        // its setpoint is not on the bus, and it announces itself as a fault code anyway.
        CheckupWindow w = day();
        w.min_bar = 17;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Ok);
        w.min_bar = CHECKUP_BAR_INFO_TENTHS;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Ok);                          // 1.2 bar exactly is still fine
        w.min_bar = CHECKUP_BAR_INFO_TENTHS - 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Info);
        w.min_bar = CHECKUP_BAR_WARN_TENTHS;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Info);                        // 1.0 bar exactly is the floor, not below it
        w.min_bar = CHECKUP_BAR_WARN_TENTHS - 1;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Pressure].verdict == CheckupVerdict::Warn);
            CHECK(r[CheckupCheck::Pressure].a == CHECKUP_BAR_WARN_TENTHS - 1);
        }
        // A real 0.0 bar is a reading and an alarming one — it must never be read as "never
        // sampled", which is why the sentinel is INT16_MIN and not 0.
        w.min_bar = 0;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Warn);
        // …and a window that genuinely never sampled it stays Collecting rather than alarming.
        w.min_bar = CHECKUP_ABSENT;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Collecting);
    }
    {
        // FLOW is OBSERVATION ONLY. The manufacturer's minimum is per model — this catalog spans
        // 3 kW to 18 kW — so one number laid across every profile would never fire on the large
        // units and always fire on the small ones. #208 proposed exactly that number (10 l/min);
        // this asserts it did not ship.
        CheckupWindow w = day();
        for (int f : { 5, 50, 120, 400 }) {
            w.min_flow = f;
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Flow].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Flow].a == f);
        }
        // The pump row is what makes a flow reading a measurement; without it the check is OFF.
        CheckupCoverage nopump = full;
        nopump.pump = false;
        w.min_flow = 120;
        CHECK(checkup_evaluate(w, nopump, FaultClass::Normal)[CheckupCheck::Flow].verdict ==
              CheckupVerdict::Unavailable);
    }
    {
        // HEATER. An hour of resistive space heat in a day is worth knowing — heat at a COP of 1 —
        // but never a fault: defrost support, emergency mode and a legitimate cold-snap boost all
        // land here. The DHW booster is reported beside it and carries no threshold at all.
        CheckupWindow w = day();
        w.buh_s = CHECKUP_BUH_INFO_S;
        w.bsh_s = 9000;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Heater].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Heater].a == 60 && r[CheckupCheck::Heater].b == 150);
        }
        w.buh_s = CHECKUP_BUH_INFO_S + 60;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Heater].verdict ==
              CheckupVerdict::Info);
        // Hours of DHW booster on its own is never a finding: on the reference installation it is
        // deliberately used to absorb PV surplus.
        w.buh_s = 0;
        w.bsh_s = 6u * 3600;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Heater].verdict ==
              CheckupVerdict::Ok);
    }
    {
        // FAULT has no minimum window — a fault now is a fault now — and distinguishes three states
        // no other surface keeps: active, cleared-but-seen-today, and never.
        CheckupWindow w;                                    // no window at all, deliberately
        CHECK(checkup_evaluate(w, full, FaultClass::Error)[CheckupCheck::Fault].verdict ==
              CheckupVerdict::Warn);
        CHECK(checkup_evaluate(w, full, FaultClass::Warning)[CheckupCheck::Fault].verdict ==
              CheckupVerdict::Info);
        CHECK(checkup_evaluate(w, full, FaultClass::Caution)[CheckupCheck::Fault].verdict ==
              CheckupVerdict::Info);
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Fault].verdict ==
              CheckupVerdict::Ok);
        // Clear now, but not all day. Without a database this is the only place that fact survives.
        w.flags = CHECKUP_F_FAULT;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Fault].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Fault].a == 0);           // …and it says the fault is not active NOW
        }
        // An UNDECODABLE class reports nothing rather than "no fault" — the same call
        // logic/fault_state.hpp's companions make, and the one direction this must never fail in.
        CHECK(checkup_evaluate(w, full, FaultClass::Unknown)[CheckupCheck::Fault].verdict ==
              CheckupVerdict::Unavailable);
    }
    {
        // RETRIES need the counters AND a run state — feature_gate.hpp's uc5_supported(), composed
        // rather than restated. Without the compressor state a counter cannot be told apart from a
        // value frozen with its page.
        CheckupWindow w = day();
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Ok);
        w.flags = CHECKUP_F_RETRY;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Retries].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Retries].a == 1);
        }
        CheckupCoverage norps = full;
        norps.rps = false;
        CHECK(checkup_evaluate(w, norps, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Unavailable);
        CheckupCoverage noctr = full;
        noctr.retries = false;
        CHECK(checkup_evaluate(w, noctr, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Unavailable);
    }
    {
        // AGGREGATION. Unavailable is the ONLY verdict that does not hold the overall back: a check
        // this profile cannot run is stated as such on its own row and says nothing about the plant.
        // Collecting does hold it back — that is a check that COULD run and has not got the evidence
        // yet, and calling the card green there is the false green this whole design is against.
        CHECK(checkup_worse(CheckupVerdict::Ok, CheckupVerdict::Unavailable) == CheckupVerdict::Ok);
        CHECK(checkup_worse(CheckupVerdict::Ok, CheckupVerdict::Collecting) == CheckupVerdict::Collecting);
        CHECK(checkup_worse(CheckupVerdict::Collecting, CheckupVerdict::Info) == CheckupVerdict::Info);
        CHECK(checkup_worse(CheckupVerdict::Info, CheckupVerdict::Warn) == CheckupVerdict::Warn);
        CHECK(checkup_worse(CheckupVerdict::Warn, CheckupVerdict::Warn) == CheckupVerdict::Warn);

        // A profile that can supply NOTHING: every row Unavailable, and the card says so rather
        // than claiming a clean bill of health.
        const CheckupCoverage none;
        const CheckupReport r = checkup_evaluate(day(), none, FaultClass::Unknown);
        CHECK(r.overall == CheckupVerdict::Unavailable);
        for (const auto& c : r.checks) CHECK(c.verdict == CheckupVerdict::Unavailable);
        // …and a fully-covered, fully-observed, entirely healthy day IS green.
        CheckupWindow good = day();
        good.starts = 8;
        good.run_s  = 8u * 3600;
        good.min_bar = 17;
        good.min_flow = 150;
        const CheckupReport ok = checkup_evaluate(good, full, FaultClass::Normal);
        CHECK(ok.overall == CheckupVerdict::Ok);
        // Every check must produce a wire id and a verdict name — a blank one would render as an
        // unlabelled row nobody could act on.
        for (size_t i = 0; i < CHECKUP_CHECK_COUNT; i++) {
            CHECK(checkup_check_id(static_cast<CheckupCheck>(i))[0] != '\0');
            CHECK(checkup_verdict_name(ok.checks[i].verdict)[0] != '\0');
        }
    }

    // --- catalog conformance --------------------------------------------------------------------
    // The locator is only worth anything if it resolves to ONE row, and to the RIGHT row, on every
    // profile that carries the quantity. `token` is what the resolved label must contain: without it
    // this would only prove that some row lives at that byte, which is exactly the assumption the
    // 0x60/12 stack punishes. `min_profiles` is measured over today's catalog, so a generator run
    // that moves or drops a row fails here rather than on someone's dashboard.
    struct CheckupExpect { const CheckupLocator* loc; const char* token; int min_profiles; };
    static const CheckupExpect kCheckup[] = {
        { &CHECKUP_LOC_DEFROST,  "defrost",             39 },
        { &CHECKUP_LOC_BUH1,     "buh step1",           39 },
        { &CHECKUP_LOC_BUH2,     "buh step2",           39 },
        { &CHECKUP_LOC_BSH,      "bsh",                 39 },
        { &CHECKUP_LOC_PUMP,     "water pump operation",39 },
        { &CHECKUP_LOC_PRESSURE, "water pressure",      39 },
        { &CHECKUP_LOC_FLOW,     "flow sensor",         39 },
        { &CHECKUP_LOC_OUTDOOR,  "outdoor air",         39 },
    };
    constexpr size_t kCheckupCount = sizeof(kCheckup) / sizeof(kCheckup[0]);

    int hchecked = 0;
    int hfound[kCheckupCount] = {0};
    int with_fault = 0, with_retries = 0, with_rps = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        // The VIEW, not the base table: the protection-retry counters live in def/overlay.hpp, so
        // coverage read off the generated rows alone would report `retries` false on every model —
        // the gate would answer correctly for the wrong reason today, and wrongly the moment the
        // generator emits them (the argument feature_gate.hpp already makes).
        const logic::ProfileView view = def::resolved(p);
        const size_t n = view.count();

        bool fault_row = false, retry_row = false, rps_row = false;
        for (size_t i = 0; i < n; i++) {
            if (checkup_is_fault_class(view[i].conv))   fault_row = true;
            if (checkup_is_retry_counter(view[i].conv)) retry_row = true;
            if (ou_is_rps_witness(view[i].label, view[i].reg)) rps_row = true;
        }
        with_fault   += fault_row;
        with_retries += retry_row;
        with_rps     += rps_row;

        for (size_t k = 0; k < kCheckupCount; k++) {
            const CheckupLocator& l = *kCheckup[k].loc;
            int hits = 0, idx = -1;
            for (size_t i = 0; i < n; i++)
                if (checkup_row_matches(l, view[i].reg, view[i].offset, view[i].conv)) { hits++; idx = static_cast<int>(i); }
            if (!hits) continue;
            hfound[k]++;
            // ONE row. Ambiguity is what a label token had and a locator is supposed to remove; two
            // matches would make the pick table order, which is not a rule anyone stated.
            CHECK(hits == 1);
            // …and the RIGHT one. This is the half that catches the 0x60/12 collision: five other
            // rows sit in that byte, and every one of them would satisfy a reg+offset match.
            CHECK(lwt_ci_contains(view[idx].label, kCheckup[k].token));
            // A health input must be publishable, or the poll cache never carries it and the check
            // reads Unavailable on a model that in fact has the row.
            CHECK(row_publishable(view[idx]));
        }
    }
    for (size_t k = 0; k < kCheckupCount; k++) CHECK(hfound[k] >= kCheckup[k].min_profiles);
    hchecked = with_fault;                                // every detectable profile carries a class
    CHECK(hchecked >= 39);
    // The retry counters reach 39+ profiles via the overlay, while the compressor witness reaches
    // far fewer — which is exactly why the cycling and retries checks gate on coverage instead of
    // assuming it. 16 of the detectable profiles carry no page 0x30 at all (feature_gate.hpp
    // measures the same thing from the other side).
    CHECK(with_retries >= 39);
    CHECK(with_rps >= 20 && with_rps < 39);
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
            case 307: CHECK(approx(r.value, 1.0)); seen++; break;   // bit 7 set
            case 303: CHECK(approx(r.value, 0.0)); seen++; break;   // bit 3 clear
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

    // The supplement must not introduce a DUPLICATE STATE KEY: mqtt_group.hpp nests the payload by
    // group, so two rows sharing a (group, object_id) would write one key and the second row would
    // silently never arrive — in the state topic AND in VictoriaMetrics, which is keyed on that pair.
    //
    // Scoped by group rather than global since #221. The old global form was an assertion about the
    // DELTA only, because the catalog itself carried label collisions ("Error Code" on both 0x10/5
    // and 0x60/3); those are no longer collisions at all — they are two rows in two groups, which is
    // what they always were on the wire. The supplement is page-0x10-only, so in practice this reads
    // "no supplement row may take a state key an outdoor_state row already holds".
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
            const std::string key = row_object_id(def::retry_rows[i]);
            for (size_t k = 0; k < p.count; k++) CHECK(row_object_id(p.values[k]) != key);
        }
    }

    // ── The metric IDs these rows have already become in VictoriaMetrics (#180) ──────────────────
    // Verified 2026-07-26: these 11 rows are INGESTED. Telegraf reads the grouped state topic and
    // the store carries one series per row, named `daikin_altherma_<group>_<object_id>`. That
    // promotes BOTH halves of that name from presentation to load-bearing identifier — the group
    // key and each row's label-derived slug. #180's schema-coupling note asks whether an "ingest
    // schema freeze" covers them; no such mechanism exists in this repo, so this block IS the freeze.
    //
    // Two edits break it silently and identically: renaming a label above, and — the one that note
    // singles out — gen_profiles.py emitting these rows with different label text on the day
    // def/overlay.hpp is deleted. Neither is an error anywhere downstream, which is the whole
    // problem: the old series simply stops receiving samples and a new one starts at zero, and a
    // counter that resets to zero is exactly what UC5 is watching for. A rename would therefore not
    // read as a rename — it would read as the plant going quiet. The #35-#39 shape, one layer out
    // from the device.
    //
    // The expected strings are TRANSCRIBED FROM THE LIVE STORE, never recomputed from the labels:
    // a slug derived from the same label it is checked against asserts ha_slug() against itself and
    // would follow a rename straight through the rename it exists to catch.
    //
    // Deliberately a SECOND assertion of a string test_mqtt_group already pins — not a duplicate.
    // There it is one entry in a catalog of friendly display names, a class of thing that may be
    // reworded; here it is half of eleven metric IDs the store is already keyed on. Someone
    // rewording the catalog would update that CHECK and reasonably believe they were done.
    CHECK(std::string(group_for_page(0x10)) == "outdoor_state");

    static const struct { const char* label; const char* metric; } vm_ids[] = {
        {"Discharge Temp. Drop",                   "discharge_temp_drop"},
        {"Discharge Temp. Protection Retry Qty",   "discharge_temp_protection_retry_qty"},
        {"Comp. INV Current Drop",                 "comp_inv_current_drop"},
        {"Comp. INV Current Protection Retry Qty", "comp_inv_current_protection_retry_qty"},
        {"HP Drop Control",                        "hp_drop_control"},
        {"HP Protection Retry Qty",                "hp_protection_retry_qty"},
        {"LP Drop Control",                        "lp_drop_control"},
        {"LP Protection Retry Qty",                "lp_protection_retry_qty"},
        {"Fin Temp. Drop Control",                 "fin_temp_drop_control"},
        {"Fin Temp. Protection Retry Qty",         "fin_temp_protection_retry_qty"},
        {"Other Drop Control",                     "other_drop_control"},
    };
    CHECK(sizeof(vm_ids) / sizeof(vm_ids[0]) == def::RETRY_ROW_COUNT);

    // Matched by VALUE, not by index: reordering the rows moves no series, so it must not fail here
    // — a rename or a dropped row is what must. Both halves are asserted because they fail
    // differently: the LABEL catches an edit to the table above (and is what HA shows as the entity
    // name), the SLUG catches ha_slug() itself changing, which would fork all 11 series with no
    // label touched at all.
    for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
        const std::string label = def::retry_rows[i].label;
        const std::string oid   = object_id(def::retry_rows[i].label);
        int hits = 0;
        for (const auto& e : vm_ids) if (label == e.label && oid == e.metric) hits++;
        CHECK(hits == 1);        // this row still lands on the id the store already carries
    }
    for (const auto& e : vm_ids) {
        int hits = 0;
        for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++)
            if (std::string(def::retry_rows[i].label) == e.label) hits++;
        CHECK(hits == 1);        // ...and no pinned series lost the row that feeds it
    }
}

// ── Metric identity: a label is an IDENTIFIER, and a rename forks the series (#217) ─────────────
// The block above freezes eleven metric ids that were verified in the live store (#180). This one
// answers the question that leaves open: the OTHER ~150.
//
// A published row reaches VictoriaMetrics as `daikin_altherma_<group>_<object_id>` and Home
// Assistant as an entity keyed on the same slug. Both halves are derived from the row's LABEL, so
// editing a label is not a cosmetic act — it retires one series and starts another at zero, with no
// error anywhere. It has already happened: f1a5e69 (#139) renamed
//   "Expansion valve 3 (pls)" -> "Expansion valve 3 (pls) [OU-II]"
// across 19 profiles, and in the store `daikin_altherma_outdoor_aux_expansion_valve_3_pls` simply
// stops 5.8 days before `..._expansion_valve_3_pls_ou_ii` begins. The rename was correct; going
// unnoticed was not.
//
// So: freeze the whole published identifier set. This is deliberately the set of DISTINCT
// (group, object_id) pairs over every profile — not per-profile rows — because that is exactly what
// the store is keyed on: two profiles carrying the same row contribute one series, and reordering
// or adding a profile moves nothing.
//
// WHEN THIS TEST FAILS, that is the gate working. Regenerating the list is not the fix; it is the
// decision. Adding an entry is routine (a new row = a new series). REMOVING or CHANGING one means a
// series stops and its history is stranded, so it belongs in the commit message with the reason —
// and if the row still exists under a new name, mqtt_ha.cpp's retraction machinery
// (retract_legacy_*) is what keeps Home Assistant from stranding the old entity beside the new one.
//
// Unlike #180's eleven, these are computed from the catalog rather than transcribed from the store,
// so they do not independently witness what VictoriaMetrics holds. What they do witness is CHANGE:
// the strings below are frozen literals, so a rename, a dropped row or an edit to ha_slug() itself
// all fail here — which is the property that was missing.
static void test_metric_identity() {
    // Every distinct <group>_<object_id> a published catalog row currently produces.
    static const char* const EXPECTED[] = {
    "actuators_brine_pump_feedback",
    "actuators_compressor_speed_rps",
    "actuators_expansion_valve_1_pls",
    "actuators_expansion_valve_2_pls",
    "actuators_expansion_valve_3_pls",
    "actuators_expansion_valve_4_pls",
    "actuators_fan_1_step",
    "actuators_fan_2_step",
    "actuators_inv_frequency_rps",
    "hybrid_2nd_domestic_hot_water_temperature",
    "hybrid_be_cop",
    "hybrid_boiler_dhw_demand",
    "hybrid_boiler_heating_target_temp",
    "hybrid_boiler_operation_demand",
    "hybrid_hybrid_heating_target_temp",
    "hybrid_hybrid_op_mode",
    "hybrid_mixed_water_temp",
    "hybrid_mixed_water_temp_r7t",
    "hydronic_2way_valve_on_heat_off_cool",
    "hydronic_3way_valve_on_dhw_off_space",
    "hydronic_benefit_kwh_rate_power_supply",
    "hydronic_bivalent_operation",
    "hydronic_bsh",
    "hydronic_buh_step1",
    "hydronic_buh_step2",
    "hydronic_dhw_setpoint",
    "hydronic_error_code",
    "hydronic_error_type",
    "hydronic_freeze_protection",
    "hydronic_freeze_protection_for_water_piping",
    "hydronic_i_u_capacity_code",
    "hydronic_i_u_operation_mode",
    "hydronic_indoor_unit_capacity",
    "hydronic_leaving_water_setpoint_main",
    "hydronic_lw_setpoint_main",
    "hydronic_silent_mode",
    "hydronic_smartgridcontact1",
    "hydronic_smartgridcontact2",
    "hydronic_solar_pump_operation",
    "hydronic_state_alarm_output",
    "hydronic_state_circulation_pump_operation",
    "hydronic_state_emergency_indoor_active_not_active",
    "hydronic_state_flow_rate_l_min",
    "hydronic_state_flow_sensor_l_min",
    "hydronic_state_lw_setpoint_add",
    "hydronic_state_powerful_dhw_operation_on_off",
    "hydronic_state_pressure_sensor",
    "hydronic_state_pressure_sensor_t",
    "hydronic_state_pump_speed",
    "hydronic_state_refrigerant_pressure_sensor",
    "hydronic_state_reheat_on_off",
    "hydronic_state_rt_setpoint",
    "hydronic_state_space_h_operation_output",
    "hydronic_state_space_heating_operation_on_off",
    "hydronic_state_storage_comfort_on_off",
    "hydronic_state_storage_eco_on_off",
    "hydronic_state_tank_preheat_on_off",
    "hydronic_state_water_pressure",
    "hydronic_state_water_pump_signal_0_max_100_stop",
    "hydronic_temps_dhw_tank_temp_r5t",
    "hydronic_temps_ext_indoor_ambient_sensor_r6t",
    "hydronic_temps_hpsu_tr_return_temp_r4t",
    "hydronic_temps_hpsu_tv_inflow_temp_r1t",
    "hydronic_temps_hpsu_tvbh_inflow_temp_after_buffer_buh_r2t",
    "hydronic_temps_indoor_ambient_temp_r1t",
    "hydronic_temps_inlet_water_temp_r4t",
    "hydronic_temps_leaving_water_temp_after_buh_r2t",
    "hydronic_temps_leaving_water_temp_after_phe_r1t",
    "hydronic_temps_leaving_water_temp_before_buh_r1t",
    "hydronic_temps_outdoor_ambient_or_ext_sensor",
    "hydronic_temps_outlet_water_buh_temp_r2t",
    "hydronic_temps_outlet_water_heat_exch_temp_r1t",
    "hydronic_temps_refrig_temp_liquid_side_r3t",
    "hydronic_temps_return_water_temp_before_phe_r4t",
    "hydronic_temps_rt_temp",
    "hydronic_thermal_protector_bsh",
    "hydronic_thermostat_on_off",
    "hydronic_water_flow_switch",
    "hydronic_water_pump_operation",
    "inverter_brine_inlet_temp",
    "inverter_brine_outlet_temp",
    "inverter_compressor_outlet_temperature",
    "inverter_fan1_fin_temp",
    "inverter_fan2_fin_temp",
    "inverter_injection_tube_temperature",
    "inverter_inv_compressor_current_a",
    "inverter_inv_fin_temp",
    "inverter_inv_primary_current_a",
    "inverter_inv_secondary_current_a",
    "inverter_refrig_temp_evap_in",
    "inverter_refrig_temp_evap_out",
    "mains_current_buh_output_capacity",
    "mains_current_ct_sensor_l1",
    "mains_current_ct_sensor_l2",
    "mains_current_ct_sensor_l3",
    "mains_current_current_measured_by_ct_sensor_of_l1",
    "mains_current_current_measured_by_ct_sensor_of_l2",
    "mains_current_current_measured_by_ct_sensor_of_l3",
    "mains_current_hpsu_mixed_leaving_water_temperature_after_the_tank_r7t_dlwa2",
    "mains_current_mixed_water_temp_r7t",
    "mixing_ekmik_bizone_kit_mix_valve_position_m1s",
    "mixing_ekmik_bizone_kit_mixed_leaving_water_temperature_r1t",
    "mixing_mixed_water_temp",
    "mixing_outlet_water_heat_exchanger_temp_hydro_split_model_dlwb2",
    "outdoor_aux_compressor_port_temperature",
    "outdoor_aux_expansion_valve_3_pls_ou_ii",
    "outdoor_aux_liquid_pipe_temp",
    "outdoor_aux_outdoor_heat_exchanger_temp",
    "outdoor_aux_pressure",
    "outdoor_aux_suction_temp",
    "outdoor_identity_o_u_capacity_kw",
    "outdoor_identity_refrigerant_type",
    "outdoor_sensors_2_phase_thermistor_r4t",
    "outdoor_sensors_discharge_pipe_temp",
    "outdoor_sensors_discharge_pipe_temp_r2t",
    "outdoor_sensors_entering_brine_temp_r5t",
    "outdoor_sensors_fin_temp",
    "outdoor_sensors_heat_exchanger_mid_temp",
    "outdoor_sensors_heat_exchanger_mid_temp_r5t",
    "outdoor_sensors_heat_sink_temp",
    "outdoor_sensors_heat_sink_temp_r10t",
    "outdoor_sensors_high_pressure",
    "outdoor_sensors_high_pressure_sat_c",
    "outdoor_sensors_high_pressure_t",
    "outdoor_sensors_inv_fin_temp",
    "outdoor_sensors_leaving_brine_temp_r6t",
    "outdoor_sensors_liquid_pipe_temp",
    "outdoor_sensors_liquid_pipe_temp_r6t",
    "outdoor_sensors_liquid_temperature_r3t",
    "outdoor_sensors_low_pressure",
    "outdoor_sensors_low_pressure_sat_c",
    "outdoor_sensors_low_pressure_t",
    "outdoor_sensors_o_u_heat_exch_mid_temp",
    "outdoor_sensors_o_u_heat_exch_temp",
    "outdoor_sensors_o_u_heat_exch_temp_r4t",
    "outdoor_sensors_o_u_heat_exchanger_temp",
    "outdoor_sensors_outdoor_air_temp",
    "outdoor_sensors_outdoor_air_temp_r1t",
    "outdoor_sensors_outdoor_heat_exchanger_mid_temp",
    "outdoor_sensors_outdoor_heat_exchanger_temp",
    "outdoor_sensors_pressure",
    "outdoor_sensors_pressure_sensor",
    "outdoor_sensors_pressure_sensor_t",
    "outdoor_sensors_pressure_t",
    "outdoor_sensors_r1t_outdoor_air_temp",
    "outdoor_sensors_r2t_inv_discharge_pipe_temp",
    "outdoor_sensors_r4t_deicer_temp",
    "outdoor_sensors_suction_pipe_temp",
    "outdoor_sensors_suction_pipe_temp_r3t",
    "outdoor_sensors_suction_pipe_temperature",
    "outdoor_state_defrost_operation",
    "outdoor_state_error_code",
    "outdoor_state_error_type",
    "outdoor_state_fault_code",
    "outdoor_state_operation_fault",
    "outdoor_state_operation_mode",
    "outdoor_state_target_cond_temp",
    "outdoor_state_target_discharge_temp",
    "outdoor_state_target_evap_temp",
    "water_hx_raw_data_water_heat_exchanger_inlet_temp",
    "water_hx_raw_data_water_heat_exchanger_outlet_temp",
    "water_hx_target_discharge_temp",
    "water_hx_target_port_temperature",
    };
    static const size_t EXPECTED_N = sizeof(EXPECTED) / sizeof(EXPECTED[0]);

    std::set<std::string> actual;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++) {
            const auto& v = p.values[i];
            if (v.no_publish) continue;              // detect-only: never announced, never a series
            // Through adjudicated(): the store is keyed on what the bridge PUBLISHES, and a label
            // override (logic/label_override.hpp, #230 A) changes that word — so a row's series suffix
            // is its adjudicated label's slug, not the generator's.
            actual.insert(std::string(group_for_page(v.reg)) + "_" + object_id(logic::adjudicated(v).label));
        }

    std::set<std::string> expected(EXPECTED, EXPECTED + EXPECTED_N);
    CHECK(expected.size() == EXPECTED_N);            // no duplicate literal above
    // Report the DIFFERENCE before asserting: a bare "sets differ" on 164 strings tells the next
    // person nothing, and this test's whole purpose is to make a rename legible at the moment it is
    // made.
    for (const auto& a : actual)
        if (!expected.count(a)) std::printf("  metric identity ADDED:   %s\n", a.c_str());
    for (const auto& e : expected)
        if (!actual.count(e)) std::printf("  metric identity REMOVED: %s\n", e.c_str());
    CHECK(actual == expected);

    // The rule is about the IDENTIFIER, not the prose: a reword that leaves the slug alone forks no
    // series and must not fail here, while a reword that changes it must.
    CHECK(object_id("Flow sensor (l/min)") == object_id("Flow Sensor (L/MIN)"));
    CHECK(object_id("Expansion valve 3 (pls)") != object_id("Expansion valve 3 (pls) [OU-II]"));

    // ONE identifier, two surfaces (#221): a published row's HA ENTITY id is exactly its
    // VictoriaMetrics series suffix, so the frozen list above now gates both. A label edit moves the
    // HA entity and the series together or neither — they can no longer drift apart.
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++) {
            const auto& v = p.values[i];
            if (v.no_publish) continue;
            CHECK(expected.count(row_object_id(logic::adjudicated(v))) == 1);
        }

    // ── The ambiguity ledger: which labels the catalog places on more than one page (#221) ───────
    // What stood here until #221 landed was the same computation pinned as a KNOWN DEFECT — the set
    // of label slugs whose rows collapsed into a single HA entity. The entity id now carries the
    // group, so a shared label no longer costs an entity; what it still costs is a NAME, since HA
    // derives the default entity_id from that and two "Error Code"s land as `..._error_code` and
    // `..._error_code_2`. discovery.hpp's AMBIGUOUS_LABEL_SLUGS is the ledger of rows named by their
    // group for that reason, and it is hand-maintained on purpose (a name computed from the detected
    // profile's rows would differ per model, so a re-detect would rename a live entity).
    //
    // So: same computation, opposite verdict. It must be EXACTLY the ledger — a sixth reused label
    // that nobody added to the ledger would ship two identically-named entities and a `_2`.
    //
    // Keyed on distinct PAGES, not distinct (reg, offset): the group is what disambiguates, so a
    // label reused twice on ONE page would not be fixable by scoping at all. That case is
    // test_entity_identity()'s — it asserts the property directly, on the published payload.
    std::set<std::string> ledger(AMBIGUOUS_LABEL_SLUGS,
                                 AMBIGUOUS_LABEL_SLUGS + AMBIGUOUS_LABEL_SLUG_COUNT);
    std::set<std::string> reused;
    for (const auto& p : def::profiles) {
        std::map<std::string, std::set<int>> by_obj;   // object_id -> distinct register pages
        for (size_t i = 0; i < p.count; i++) {
            const auto& v = p.values[i];
            if (v.no_publish) continue;
            by_obj[object_id(v.label)].insert(v.reg);
        }
        for (const auto& kv : by_obj)
            if (kv.second.size() > 1) reused.insert(kv.first);
    }
    for (const auto& r : reused)
        if (!ledger.count(r))
            std::printf("  label reused across pages, not in AMBIGUOUS_LABEL_SLUGS: %s\n", r.c_str());
    for (const auto& l : ledger)
        if (!reused.count(l))
            std::printf("  AMBIGUOUS_LABEL_SLUGS entry no longer reused: %s\n", l.c_str());
    CHECK(reused == ledger);
}

// ── Which identifiers a TIE-BREAK decides (#230 B) ───────────────────────────────────────────────
// test_metric_identity() above freezes the identifier set the WHOLE catalog produces. This asks the
// question that leaves open, and it is the one a device owner has: does THIS unit still publish the
// identifiers it published yesterday?
//
// Detection resolves a fingerprint to a candidate SET and then picks one representative
// (detect_best: page overlap -> kW class -> tightest class -> the lowest profile id. That last
// criterion was REGISTRY ORDER until #230 B, which is what made a mere reorder able to move a
// published series; test_tie_break_order_independence() below now forbids that, but the tie itself
// still decides an identifier and this test is what bounds WHICH.) On the live 8 kW unit three of the
// five survivors are REGISTER-EQUIVALENT —
// byte-identical (reg, offset, conv, size, type) rows — so which one wins changes not one decoded
// value. It changes the LABELS, and a label is the HA entity id plus the VictoriaMetrics series
// suffix. This is exactly the shape of #230 A's fan step: `altherma_ebla_edla_d_series_4_8kw_monobloc`
// and `altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw` were register-equivalent yet published
// `actuators_fan_1_step` vs `actuators_fan_1_10_rpm` depending on nothing but registry order. Add,
// remove or reorder a profile — none of which is a suspicious act — and the old series stops
// receiving samples while a new one starts at zero: #217's silent fork, a counter resetting to zero
// reading as the plant going quiet rather than as a rename. The fan case is now CLOSED —
// logic/label_override.hpp republishes every profile as `actuators_fan_1_step`, so that class is
// identifier-equivalent and neither fan id is tie-break-decided any more (which is why they are gone
// from the frozen set below) — but the mechanism is general and the remaining classes below still
// have it.
//
// #217's gate cannot catch it BY CONSTRUCTION: both spellings are already in its frozen set, so a
// tie-break flip introduces no new identifier and the suite stays green while the device's own
// series changes underneath it. It answers "does the catalog still produce this identifier set?",
// never "can a tie-break move which identifier a unit publishes?".
//
// The property actually wanted is that register-equivalent profiles agree on what they publish —
// then a tie-break can never move an identifier. Measured over the detectable catalog: TWELVE
// equivalence classes exist and, since #230 A's fan step was closed by logic/label_override.hpp,
// FIVE still violate it — so this is a class of hazard, not one instance. They are not all defects,
// and the difference is a judgement rather than something a test can settle:
//   • #230 A's fan step was the "simply false" kind — one spelling asserted a rate, the other a
//     step — now FIXED by logic/label_override.hpp, so it is no longer in the frozen set;
//   • one sensor named by two product FAMILIES — the ECH2O tank models call leaving water
//     "[HPSU] Tv inflow Temp  (R1T)", the standard ones "Leaving water temp. before BUH (R1T)".
//     Both are true of their own product, and docs/REGISTERS.md:196-200 says to expect exactly this;
//   • and the sharpest one, which is not a rename at all: the non-hybrid
//     `altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw` marks the page-0x64 boiler rows `no_publish`
//     (value_def.hpp's detect-only rows) while its two register-equivalent neighbours publish them.
//     A tie-break there decides whether EIGHT `hybrid_*` entities exist on that unit at all — an
//     appearing or disappearing entity, not a moved one. Which is why `no_publish` is deliberately
//     NOT part of the equivalence key: it is not a wire fact, and folding it in would split that
//     class and hide the strongest case this test has.
// Whether a given divergence is a defect or a family spelling stays a judgement; whether a NEW one
// appeared is not, and that is what this freezes.
//
// Keyed on the SORTED multiset of wire fields, not the row order: two profiles listing the same
// fields in a different order are register-equivalent too, and a tie-break between them moves an
// identifier just the same.
static void test_tie_break_identity() {
    // Every identifier whose publication depends on WHICH register-equivalent profile detection
    // happens to pick. Adding an entry means a new tie-break-decided series — say why in the commit
    // message. Removing one means the divergence is gone: a label override now makes the class agree
    // (#230 A — logic/label_override.hpp, and its audit ledger entries went with it), the generator
    // itself agrees, or a profile left the class.
    static const char* const TIE_BREAK_DECIDED[] = {
    "hybrid_2nd_domestic_hot_water_temperature",
    "hybrid_be_cop",
    "hybrid_boiler_dhw_demand",
    "hybrid_boiler_heating_target_temp",
    "hybrid_boiler_operation_demand",
    "hybrid_hybrid_heating_target_temp",
    "hybrid_hybrid_op_mode",
    "hybrid_mixed_water_temp",
    "hydronic_temps_hpsu_tr_return_temp_r4t",
    "hydronic_temps_hpsu_tv_inflow_temp_r1t",
    "hydronic_temps_hpsu_tvbh_inflow_temp_after_buffer_buh_r2t",
    "hydronic_temps_inlet_water_temp_r4t",
    "hydronic_temps_leaving_water_temp_after_buh_r2t",
    "hydronic_temps_leaving_water_temp_before_buh_r1t",
    "mains_current_hpsu_mixed_leaving_water_temperature_after_the_tank_r7t_dlwa2",
    "mains_current_mixed_water_temp_r7t",
    "mixing_ekmik_bizone_kit_mixed_leaving_water_temperature_r1t",
    "mixing_mixed_water_temp",
    "outdoor_sensors_discharge_pipe_temp",
    "outdoor_sensors_discharge_pipe_temp_r2t",
    "outdoor_sensors_heat_exchanger_mid_temp",
    "outdoor_sensors_heat_exchanger_mid_temp_r5t",
    "outdoor_sensors_liquid_pipe_temp_r6t",
    "outdoor_sensors_liquid_temperature_r3t",
    "outdoor_sensors_low_pressure",
    "outdoor_sensors_low_pressure_t",
    "outdoor_sensors_o_u_heat_exch_temp",
    "outdoor_sensors_o_u_heat_exch_temp_r4t",
    "outdoor_sensors_pressure",
    "outdoor_sensors_pressure_t",
    "outdoor_sensors_suction_pipe_temp",
    "outdoor_sensors_suction_pipe_temp_r3t",
    "outdoor_state_target_discharge_temp",
    "outdoor_state_target_evap_temp",
    };
    static const size_t TIE_BREAK_DECIDED_N = sizeof(TIE_BREAK_DECIDED) / sizeof(TIE_BREAK_DECIDED[0]);

    // profile -> the identifiers it publishes; keyed by its wire-field multiset.
    std::map<std::vector<std::string>, std::map<std::string, std::set<std::string>>> classes;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;      // `generic` + the fixture are never picked
        const logic::ProfileView view = def::resolved(p);
        std::vector<std::string>  field;                   // the WIRE, label-free
        std::set<std::string>     ids;                     // what it publishes
        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef d = logic::adjudicated(view[i]);
            char           f[48];
            std::snprintf(f, sizeof(f), "%02X/%d/%d/%d/%d", d.reg, (int)d.offset, d.conv, (int)d.size,
                          d.type);
            field.push_back(f);
            if (!row_publishable(d) || !conv_publishable(d.conv) || object_id(d.label).empty())
                continue;
            ids.insert(row_object_id(d));
        }
        std::sort(field.begin(), field.end());
        classes[field][p.id] = ids;
    }

    std::set<std::string>              decided;            // ids a tie-break can move
    std::map<std::string, std::string> carried_by;          // ...and which class member carries each
    int                                equiv_classes = 0, divergent_classes = 0;
    for (const auto& [field, members] : classes) {
        (void)field;
        if (members.size() < 2) continue;                  // nothing to tie-break between
        equiv_classes++;
        std::set<std::string> all, common = members.begin()->second;
        for (const auto& [id, ids] : members) {
            (void)id;
            all.insert(ids.begin(), ids.end());
            std::set<std::string> keep;
            std::set_intersection(common.begin(), common.end(), ids.begin(), ids.end(),
                                  std::inserter(keep, keep.end()));
            common = keep;
        }
        std::set<std::string> diff;
        std::set_difference(all.begin(), all.end(), common.begin(), common.end(),
                            std::inserter(diff, diff.end()));
        if (diff.empty()) continue;                        // identifier-equivalent: the safe shape
        divergent_classes++;
        decided.insert(diff.begin(), diff.end());
        // A bare identifier tells the next person nothing: the whole point is to make the tie-break
        // legible, so record WHICH register-equivalent profiles it hangs on.
        for (const auto& d : diff) {
            std::string on, off;
            for (const auto& [id, ids] : members) (ids.count(d) ? on : off) += " " + id;
            carried_by[d] = "on" + on + "   |   absent on" + off;
        }
    }

    std::set<std::string> expected(TIE_BREAK_DECIDED, TIE_BREAK_DECIDED + TIE_BREAK_DECIDED_N);
    CHECK(expected.size() == TIE_BREAK_DECIDED_N);          // no duplicate literal above
    for (const auto& d : decided)
        if (!expected.count(d))
            std::printf("  tie-break can now move: %s\n      %s\n", d.c_str(),
                        carried_by[d].c_str());
    for (const auto& e : expected)
        if (!decided.count(e)) std::printf("  no longer tie-break-decided: %s\n", e.c_str());
    CHECK(decided == expected);

    // Non-vacuity: the catalog really does carry register-equivalent profiles, so a future refactor
    // that made every class a singleton (or stopped resolving labels) would fail here rather than
    // report a clean sweep of nothing.
    CHECK(equiv_classes >= 8);
    CHECK(divergent_classes >= 1);
    CHECK(divergent_classes < equiv_classes);              // ...and most classes ARE safe today
}

// ── What the tie-break decides on a REAL fingerprint, and what cannot move it (#230 B) ───────────
// test_tie_break_identity() above asks a CATALOG question: which identifiers do REGISTER-EQUIVALENT
// profiles disagree about? The two tests below ask the two OPERATIONAL ones, and all three are kept
// because none subsumes another — measured, not assumed:
//
//   • the tie detect_best actually resolves is on the page COUNT and the kW-class SPAN, both coarser
//     than the row tables. So a tie can hold between profiles that are NOT register-equivalent (98 of
//     152 measured ties, row multisets up to 8 rows apart), and the register-equivalence set misses
//     32 of the identifiers a tie-break can really move;
//   • and conversely 2 identifiers (`outdoor_sensors_low_pressure{,_t}`) diverge between
//     register-equivalent profiles yet are NOT reachable, because a tighter kW class always wins on
//     criterion (3) before the tie-break is consulted. A gate that only measured reachability would
//     call that pair safe while a catalog edit could still expose it.
//
// The sweep below is every fingerprint a real unit can present: each distinct page mask the catalog
// carries (plus the live reference unit's 0x1bff), crossed with the capacity in 0.5 kW steps, in BOTH
// states a unit can report it — the O/U descriptor's own figure, and the I/U code that stands in when
// that descriptor is too short (detect_capacity). 336 fingerprints.
static std::vector<Fingerprint> tie_break_sweep() {
    std::set<uint32_t> masks{0x1bff};                       // + the live reference unit
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        uint32_t m = 0;
        const logic::ProfileView v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) m |= page_mask_bit(v[i].reg);
        masks.insert(m);
    }
    std::vector<Fingerprint> fps;
    for (uint32_t m : masks)
        for (int ou = 0; ou < 2; ou++)
            for (int cap = -1; cap <= 160; cap += (cap < 0 ? 31 : 5)) {
                if (cap >= 0 && cap < 30) continue;         // below the smallest rated class
                Fingerprint fp;
                fp.page_mask    = m;
                fp.kw_tenths    = (ou == 0) ? cap : -1;
                fp.iu_kw_tenths = (ou == 0) ? -1 : cap;
                fps.push_back(fp);
            }
    return fps;
}

// The PROPERTY, asserted directly rather than frozen as a list: reordering the registry cannot change
// what a unit publishes. detect_best's last criterion used to be "first in signature order", i.e. the
// order the tables happen to sit in def/registry.hpp — an incidental fact about a FILE. A label is an
// identifier (ha_slug -> HA entity id + VictoriaMetrics series suffix), so a moved tie-break stops one
// series and starts another at zero, which reads downstream as the plant going quiet rather than as a
// rename (#180/#217). Measured before the fix: permuting the registry moved the published identity on
// 11275 of 200x336 trials over 64 distinct identifiers. Criterion (4) is now the lowest profile id,
// which is intrinsic to the profile, so the same tie resolves the same way in any order.
//
// Permutation is hand-rolled Fisher-Yates on an LCG, NOT std::shuffle: how std::shuffle consumes its
// URBG is implementation-defined, so libstdc++ and libc++ would permute differently and a failure
// would not reproduce. This is a test about determinism; it must be deterministic itself.
static void test_tie_break_order_independence() {
    int nsig = 0;
    const Signature*       raw  = def::signatures(nsig);
    std::vector<Signature> base(raw, raw + nsig);
    const std::vector<Fingerprint> fps = tie_break_sweep();

    uint32_t s = 0x1234567u;
    auto     next = [&s]() { s = s * 1664525u + 1013904223u; return s >> 16; };

    int moved = 0;
    for (int trial = 0; trial < 50; trial++) {
        std::vector<Signature> perm = base;
        for (size_t i = perm.size(); i > 1; i--) std::swap(perm[i - 1], perm[next() % i]);
        for (const auto& fp : fps) {
            const char* a = detect_best(base.data(), (int)base.size(), fp);
            const char* b = detect_best(perm.data(), (int)perm.size(), fp);
            if ((a == nullptr) != (b == nullptr)) { moved++; continue; }
            if (a && b && std::strcmp(a, b) != 0) {
                if (moved++ < 5)
                    std::printf("  registry order moved the pick: %s -> %s\n", a, b);
            }
        }
    }
    CHECK(moved == 0);

    // Non-vacuity, both halves: the sweep must actually reach the tie-break, and the permutations must
    // actually permute — otherwise this passes by testing nothing.
    int with_tie = 0;
    for (const auto& fp : fps) {
        int bp = -1, bm = -1, bs = 0, n = 0;
        bool have = false;
        for (const auto& sig : base) {
            if (!signature_consistent(sig, fp)) continue;
            const int pop   = __builtin_popcount(sig.page_mask);
            const int match = signature_kw_contains(sig, detect_capacity(fp)) ? 1 : 0;
            const int span =
                (sig.kw_min_tenths >= 0) ? (sig.kw_max_tenths - sig.kw_min_tenths) : 1000;
            if (!have || pop > bp || (pop == bp && match > bm) ||
                (pop == bp && match == bm && span < bs)) { bp = pop; bm = match; bs = span; have = true; }
        }
        if (!have) continue;
        for (const auto& sig : base) {
            if (!signature_consistent(sig, fp)) continue;
            const int pop   = __builtin_popcount(sig.page_mask);
            const int match = signature_kw_contains(sig, detect_capacity(fp)) ? 1 : 0;
            const int span =
                (sig.kw_min_tenths >= 0) ? (sig.kw_max_tenths - sig.kw_min_tenths) : 1000;
            if (pop == bp && match == bm && span == bs) n++;
        }
        if (n >= 2) with_tie++;
    }
    CHECK(fps.size() >= 300);
    CHECK(with_tie >= 100);                                 // measured 152

    std::vector<Signature> perm = base;
    for (size_t i = perm.size(); i > 1; i--) std::swap(perm[i - 1], perm[next() % i]);
    int same_slot = 0;
    for (size_t i = 0; i < base.size(); i++)
        if (std::strcmp(base[i].id, perm[i].id) == 0) same_slot++;
    CHECK(same_slot < (int)base.size() / 2);                // the shuffle really shuffles

    // And the live reference unit is unmoved by the whole change — the reason this needed no #221
    // migration: 0 of the 336 fingerprints re-label anything, this one included.
    Fingerprint live;
    live.page_mask    = 0x1bff;
    live.iu_kw_tenths = 80;
    CHECK(std::strcmp(detect_best(base.data(), (int)base.size(), live),
                      "altherma_ebla_edla_d_series_4_8kw_monobloc") == 0);
}

// ...and the RESIDUE the property above does not remove: order-independence stops a REORDER from
// moving an identifier, but adding or removing a profile still can (a new lexicographic sibling wins
// the tie). So freeze the identifiers a tie-break can decide on a fingerprint a real unit can
// present — the question a device OWNER has, which the catalog-wide set above cannot answer.
//
// Adding an entry means a new series is tie-break-decided: say why in the commit message. Removing one
// means a divergence is gone (a label override made the class agree, the generator agrees, or a
// profile left the tie).
static void test_tie_break_reach() {
    static const char* const REACHABLE[] = {
    "actuators_expansion_valve_2_pls",
    "actuators_fan_2_step",
    "hybrid_2nd_domestic_hot_water_temperature",
    "hybrid_be_cop",
    "hybrid_boiler_dhw_demand",
    "hybrid_boiler_heating_target_temp",
    "hybrid_boiler_operation_demand",
    "hybrid_hybrid_heating_target_temp",
    "hybrid_hybrid_op_mode",
    "hybrid_mixed_water_temp",
    "hybrid_mixed_water_temp_r7t",
    "hydronic_error_type",
    "hydronic_state_pressure_sensor",
    "hydronic_state_pressure_sensor_t",
    "hydronic_state_refrigerant_pressure_sensor",
    "hydronic_state_space_h_operation_output",
    "hydronic_state_tank_preheat_on_off",
    "hydronic_temps_ext_indoor_ambient_sensor_r6t",
    "hydronic_temps_hpsu_tr_return_temp_r4t",
    "hydronic_temps_hpsu_tv_inflow_temp_r1t",
    "hydronic_temps_hpsu_tvbh_inflow_temp_after_buffer_buh_r2t",
    "hydronic_temps_indoor_ambient_temp_r1t",
    "hydronic_temps_inlet_water_temp_r4t",
    "hydronic_temps_leaving_water_temp_after_buh_r2t",
    "hydronic_temps_leaving_water_temp_before_buh_r1t",
    "hydronic_temps_outdoor_ambient_or_ext_sensor",
    "hydronic_temps_outlet_water_buh_temp_r2t",
    "hydronic_temps_outlet_water_heat_exch_temp_r1t",
    "hydronic_temps_rt_temp",
    "inverter_injection_tube_temperature",
    "mains_current_buh_output_capacity",
    "mains_current_hpsu_mixed_leaving_water_temperature_after_the_tank_r7t_dlwa2",
    "mains_current_mixed_water_temp_r7t",
    "mixing_ekmik_bizone_kit_mix_valve_position_m1s",
    "mixing_ekmik_bizone_kit_mixed_leaving_water_temperature_r1t",
    "mixing_mixed_water_temp",
    "outdoor_sensors_2_phase_thermistor_r4t",
    "outdoor_sensors_discharge_pipe_temp",
    "outdoor_sensors_discharge_pipe_temp_r2t",
    "outdoor_sensors_entering_brine_temp_r5t",
    "outdoor_sensors_heat_exchanger_mid_temp",
    "outdoor_sensors_heat_exchanger_mid_temp_r5t",
    "outdoor_sensors_heat_sink_temp",
    "outdoor_sensors_heat_sink_temp_r10t",
    "outdoor_sensors_inv_fin_temp",
    "outdoor_sensors_leaving_brine_temp_r6t",
    "outdoor_sensors_liquid_pipe_temp",
    "outdoor_sensors_liquid_pipe_temp_r6t",
    "outdoor_sensors_liquid_temperature_r3t",
    "outdoor_sensors_o_u_heat_exch_mid_temp",
    "outdoor_sensors_o_u_heat_exch_temp",
    "outdoor_sensors_o_u_heat_exch_temp_r4t",
    "outdoor_sensors_outdoor_air_temp",
    "outdoor_sensors_pressure",
    "outdoor_sensors_pressure_sensor",
    "outdoor_sensors_pressure_sensor_t",
    "outdoor_sensors_pressure_t",
    "outdoor_sensors_r1t_outdoor_air_temp",
    "outdoor_sensors_r2t_inv_discharge_pipe_temp",
    "outdoor_sensors_r4t_deicer_temp",
    "outdoor_sensors_suction_pipe_temp",
    "outdoor_sensors_suction_pipe_temp_r3t",
    "outdoor_state_target_discharge_temp",
    "outdoor_state_target_evap_temp",
    };
    static const size_t REACHABLE_N = sizeof(REACHABLE) / sizeof(REACHABLE[0]);

    // what each detectable profile publishes, resolved exactly as the bridge does
    std::map<std::string, std::set<std::string>> pub;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        std::set<std::string>    ids;
        const logic::ProfileView v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef d = logic::adjudicated(v[i]);
            if (!row_publishable(d) || !conv_publishable(d.conv) || object_id(d.label).empty())
                continue;
            ids.insert(row_object_id(d));
        }
        pub[p.id] = std::move(ids);
    }

    int nsig = 0;
    const Signature*       raw = def::signatures(nsig);
    std::vector<Signature> base(raw, raw + nsig);

    std::set<std::string> reachable;
    int                   ties = 0, deciding = 0, not_equiv = 0;
    for (const auto& fp : tie_break_sweep()) {
        int bp = -1, bm = -1, bs = 0;
        bool have = false;
        for (const auto& sig : base) {
            if (!signature_consistent(sig, fp)) continue;
            const int pop   = __builtin_popcount(sig.page_mask);
            const int match = signature_kw_contains(sig, detect_capacity(fp)) ? 1 : 0;
            const int span =
                (sig.kw_min_tenths >= 0) ? (sig.kw_max_tenths - sig.kw_min_tenths) : 1000;
            if (!have || pop > bp || (pop == bp && match > bm) ||
                (pop == bp && match == bm && span < bs)) { bp = pop; bm = match; bs = span; have = true; }
        }
        if (!have) continue;
        std::vector<std::string> tied;
        for (const auto& sig : base) {
            if (!signature_consistent(sig, fp)) continue;
            const int pop   = __builtin_popcount(sig.page_mask);
            const int match = signature_kw_contains(sig, detect_capacity(fp)) ? 1 : 0;
            const int span =
                (sig.kw_min_tenths >= 0) ? (sig.kw_max_tenths - sig.kw_min_tenths) : 1000;
            if (pop == bp && match == bm && span == bs) tied.push_back(sig.id);
        }
        if (tied.size() < 2) continue;
        ties++;
        std::set<std::string> all, common = pub[tied.front()];
        for (const auto& t : tied) {
            const auto& s = pub[t];
            all.insert(s.begin(), s.end());
            std::set<std::string> keep;
            std::set_intersection(common.begin(), common.end(), s.begin(), s.end(),
                                  std::inserter(keep, keep.end()));
            common = keep;
        }
        std::set<std::string> diff;
        std::set_difference(all.begin(), all.end(), common.begin(), common.end(),
                            std::inserter(diff, diff.end()));
        if (!diff.empty()) { deciding++; reachable.insert(diff.begin(), diff.end()); }
        // ...and the claim detect.hpp used to make: are the tied candidates register-equivalent?
        for (const auto& t : tied)
            if (pub[t].size() != pub[tied.front()].size()) { not_equiv++; break; }
    }

    std::set<std::string> expected(REACHABLE, REACHABLE + REACHABLE_N);
    CHECK(expected.size() == REACHABLE_N);                  // no duplicate literal above
    for (const auto& r : reachable)
        if (!expected.count(r)) std::printf("  tie-break can NOW decide: %s\n", r.c_str());
    for (const auto& e : expected)
        if (!reachable.count(e)) std::printf("  no longer tie-break-reachable: %s\n", e.c_str());
    CHECK(reachable == expected);

    // Non-vacuity + the measured shape of the hazard.
    CHECK(ties >= 100);                                     // measured 152
    CHECK(deciding >= 50);                                  // measured 108
    CHECK(not_equiv >= 1);                                  // tied != register-equivalent (see above)
    // Every reachable identifier is one the catalog really publishes, so a typo in the list above
    // fails here rather than silently widening the freeze.
    for (const auto& e : expected) {
        bool found = false;
        for (const auto& [id, ids] : pub) { (void)id; if (ids.count(e)) { found = true; break; } }
        CHECK(found);
    }
}

// ── Entity identity: no two announced entities may share a uniq_id (#221) ───────────────────────
// Home Assistant keys its entity registry on `uniq_id` and its discovery on the retained config
// TOPIC. Both are FLAT namespaces — while a catalog row's label is only unique within its register
// page. The catalog carries "Error Code" on the outdoor page AND on the hydronic one, so before
// #221 the two rows were announced under one id on one topic: the broker kept one payload, HA
// created one entity, and the second sensor silently did not exist. Nothing errored — in HA it
// reads as "my model doesn't have that sensor" — and the state topic was fine throughout (it nests
// by group), which is why this was invisible everywhere except Home Assistant.
//
// Measured before the fix: 44 of 45 profiles carried at least one collision, over five label slugs.
// One of them was `error_code`, the row an automation alerts on.
//
// This asserts the property directly, and over ALL FOUR entity families — catalog rows, the
// conv-203 companions, the heartbeat diagnostics and the crash diagnostics — because they share the
// one namespace and nothing else checks across them. A future label slugging to "uptime" would
// otherwise overwrite the heartbeat's own sensor.
//
// It reads the uniq_id out of the REAL discovery_config() and the object segment out of the REAL
// discovery_topic(), rather than re-deriving either from a helper. That is deliberate: the property
// belongs to what is PUBLISHED, so a future refactor that changes how an id is built cannot make
// this test agree with itself while the broker sees something else.
static std::string uniq_id_of(const std::string& cfg) {
    const std::string key = "\"uniq_id\":\"";
    const size_t b = cfg.find(key);
    if (b == std::string::npos) return "";
    const size_t s = b + key.size();
    const size_t e = cfg.find('"', s);
    return e == std::string::npos ? "" : cfg.substr(s, e - s);
}

// <prefix>/<component>/<node>/<OBJECT>/config -> OBJECT
static std::string topic_object_of(const std::string& topic) {
    const std::string tail = "/config";
    if (topic.size() < tail.size() || topic.compare(topic.size() - tail.size(), tail.size(), tail))
        return "";
    const size_t e = topic.size() - tail.size();
    const size_t b = topic.rfind('/', e - 1);
    return b == std::string::npos ? "" : topic.substr(b + 1, e - b - 1);
}

static void test_entity_identity() {
    const std::string node = "daikin_test", brd = "daikin_board", pfx = "homeassistant";
    const std::string st = "base/state", av = "base/status", hb = "base/heartbeat", cr = "base/crash";

    std::set<std::string> colliding;                 // reported once, not once per profile
    int checked = 0;

    for (const auto& p : def::profiles) {
        const logic::ProfileView view = def::resolved(p);   // the rows mqtt_ha really announces
        std::map<std::string, std::string> owner;           // uniq_id -> who claimed it first

        auto claim = [&](const std::string& uid, const std::string& who, const std::string& topic) {
            CHECK(!uid.empty());
            // The invariant that makes this a TOPIC assertion too: an entity's uniq_id is its node
            // plus the object segment of its own discovery topic, for every family. Two entities
            // therefore cannot collide on the retained config topic without colliding here.
            CHECK(uid == node + "_" + topic_object_of(topic));
            checked++;
            auto it = owner.find(uid);
            if (it != owner.end() && it->second != who) {
                if (colliding.insert(uid).second)
                    std::printf("  HA uniq_id collision on %s: %s claims %s, already held by %s\n",
                                p.id, who.c_str(), uid.c_str(), it->second.c_str());
                return;
            }
            owner.emplace(uid, who);
        };

        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef d = logic::adjudicated(view[i]);
            if (!row_publishable(d) || !conv_publishable(d.conv) || object_id(d.label).empty())
                continue;
            char loc[32];
            std::snprintf(loc, sizeof(loc), "0x%02X/%d", d.reg, (int)d.offset);
            claim(uniq_id_of(discovery_config(node, brd, st, av, d)), loc,
                  discovery_topic(pfx, node, d));
            if (d.conv == 203) {
                const std::string g = group_for_page(d.reg);
                for (size_t k = 0; k < FAULT_COMPANION_COUNT; k++)
                    claim(uniq_id_of(companion_discovery_config(node, brd, st, av, g,
                                                                FAULT_COMPANIONS[k])),
                          std::string(loc) + " companion",
                          companion_discovery_topic(pfx, node, g, FAULT_COMPANIONS[k].key));
            }
        }
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
            claim(uniq_id_of(heartbeat_discovery_config(node, brd, hb, av, HEARTBEAT_SENSORS[i])),
                  "heartbeat", heartbeat_discovery_topic(pfx, node, HEARTBEAT_SENSORS[i]));
        for (int i = 0; i < CRASH_SENSOR_COUNT; i++)
            claim(uniq_id_of(crash_discovery_config(node, brd, cr, av, CRASH_SENSORS[i])),
                  "crash", crash_discovery_topic(pfx, node, CRASH_SENSORS[i]));
        // A RETIRED id is not published any more, but it must never be RE-USED either: the whole
        // point of retiring it is that a broker somewhere still holds its retained config, and a new
        // entity claiming that id would inherit the corpse instead of getting a fresh registry entry.
        // Both surfaces retire entities (crash: "Last Reset Reason"; heartbeat: "Device Time",
        // "WiFi Quality") and uniq_id is ONE flat namespace across them, so both lists are burned.
        auto burned = [&](const RetiredHaSensor& r) {
            const std::string uid = node + "_" + r.object_id;
            auto it = owner.find(uid);
            if (it != owner.end() && colliding.insert(uid).second)
                std::printf("  live entity re-uses the RETIRED id %s on %s (claimed by %s)\n",
                            uid.c_str(), p.id, it->second.c_str());
        };
        for (int i = 0; i < RETIRED_CRASH_SENSOR_COUNT; i++)     burned(RETIRED_CRASH_SENSORS[i]);
        for (int i = 0; i < RETIRED_HEARTBEAT_SENSOR_COUNT; i++) burned(RETIRED_HEARTBEAT_SENSORS[i]);
    }

    CHECK(checked > 4000);        // every profile x every family, not a sampled subset
    CHECK(colliding.empty());
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

// ── The converter adjudication (logic/conv_override.hpp) — #194 ──────────────────────────────────
// The ledger asserts a DIFFERENT value, not merely a withheld one, so what is pinned here is the
// evidence itself: the wire integers. If a future generator run, a REGISTERS.md edit or a converter
// change ever makes the ÷128 reading stop reproducing them, this fails rather than quietly shipping
// a second wrong scale.
static void test_conv_override() {
    // Identity for everything the ledger is silent about — which is all of the catalog but one row.
    CHECK(logic::effective_conv(0x10, 8, 114) == 114);    // Target Cond. Temp.: same page, same converter
    CHECK(logic::effective_conv(0xA1, 5, 114) == 114);    // Target Discharge Temp.
    CHECK(logic::effective_conv(0xA1, 7, 114) == 114);    // Target port temperature
    CHECK(logic::effective_conv(0x61, 2, 105) == 105);    // leaving water — the row that must never move
    CHECK(logic::effective_conv(0x10, 6, 105) == 105);    // right coordinates, WRONG converter: no match
    CHECK(logic::effective_conv(0x11, 6, 114) == 114);    // right converter, wrong page
    CHECK(logic::effective_conv(0x10, 7, 114) == 114);    // right page, wrong offset
    CHECK(logic::effective_conv(0x10, 6, 114) == 109);    // the one entry

    // THE EVIDENCE. Every distinct 16-bit value this row has ever been observed to carry — 46
    // run-time (recovered exactly from the published series, since conv 114 prints raw × 0.1 at one
    // decimal) and 8 at rest (from the boot-time page dumps replayed to syslog). Under ÷128 each is
    // floor(128 × T) for T on an exact 0.1 K grid; the set {floor(12.8k)} has density 1/12.8, so
    // 54/54 is p ~ 1.6e-60 against any other scale. THIS is why the row could be re-decoded on one
    // unit's data where a merely-plausible range could not have justified it.
    static const int OBSERVED[] = {
        1331, 1344, 1369, 1382, 1395, 1408, 1420, 1433, 1446, 1459, 1472, 1484, 1510, 1536,
        1548, 1561, 1574, 1587, 1600, 1612, 1625, 1651, 1664, 1689, 1702, 1728, 1740, 1753,
        1766, 1779, 1792, 1804, 1817, 1830, 1856, 1868, 1881, 1894, 1907, 1920, 1932, 1945,
        1958, 1971, 1984, 1996,                                            // compressor running
        2201, 2214, 2240, 2304, 2342, 2393, 2406, 2432,                    // at rest
    };
    const ValueDef row = logic::adjudicated(ValueDef{0x10, 6, 114, 2, 1, "Target Evap. Temp."});
    for (size_t i = 0; i < sizeof(OBSERVED) / sizeof(OBSERVED[0]); i++) {
        const int raw = OBSERVED[i];
        const uint8_t bytes[2] = {static_cast<uint8_t>(raw & 0xFF),
                                  static_cast<uint8_t>((raw >> 8) & 0xFF)};   // s16 LE, as on the wire
        const Reading r = convert(row, bytes);
        CHECK(r.ok);
        // Lands on the 0.1 K grid. The register holds floor(128 x T), so the decoded value sits up
        // to 1/128 K BELOW the grid point — that truncation is itself part of the evidence, and the
        // assertion is that rounding to one decimal recovers T and re-encodes to the very integer
        // that came off the bus. (An exact-equality check here would be wrong, and wrong in the
        // direction that hides the finding.)
        const double t10 = r.value * 10.0;
        const int    k   = static_cast<int>(t10 < 0 ? t10 - 0.5 : t10 + 0.5);
        CHECK(r.value <= k / 10.0 + 1e-9 && r.value > k / 10.0 - 1.0 / 128.0 - 1e-9);
        CHECK(static_cast<int>(128.0 * (k / 10.0) + 1e-9) == raw);
        // And it is a temperature a heat pump can actually have, which x0.1 (133-243 °C) was not.
        CHECK(r.value > 5.0 && r.value < 25.0);
        CHECK(reading_plausible(row, r));
        CHECK(value_available(row, r.ok, r.value));
    }
    // The row publishes again, as an ordinary °C sensor.
    CHECK(row_publishable(row));
    CHECK(!conv_is_binary(row.conv));
    CHECK(display_decimals(row.conv) == 1);
}

// ── The label ledger (logic/label_override.hpp) — #230 A ──────────────────────────────────────────
// The sibling of test_conv_override(): the same "generated table is wrong, corrected in logic/,
// pinned against the real catalog" shape — but for the row's LABEL, which is the HA entity id and the
// VictoriaMetrics series suffix (logic/discovery.hpp), so the correction moves what the device
// publishes, not how a value decodes.
static void test_label_override() {
    // Identity for the rows the ledger is silent about, and the exact structural key it fires on.
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 2, 211, "Fan 2 (step)"), "Fan 2 (step)"));    // neighbour: untouched
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 1, 211, "Fan 1 (step)"), "Fan 1 (step)"));    // already correct: no `from` match
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 1, 210, "Fan 1 (10 rpm)"), "Fan 1 (10 rpm)")); // wrong converter: no match
    CHECK(logic::label_str_eq(logic::effective_label(0x31, 1, 211, "Fan 1 (10 rpm)"), "Fan 1 (10 rpm)")); // wrong page: no match
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 1, 211, "Fan 1 (10 rpm)"), "Fan 1 (step)"));   // THE entry

    // The corrected row publishes as actuators_fan_1_step — one identifier, two surfaces (#221): the
    // group-scoped HA entity id AND the un-grouped state key / VictoriaMetrics series suffix both move.
    const ValueDef row = logic::adjudicated(ValueDef{0x30, 1, 211, 1, -1, "Fan 1 (10 rpm)"});
    CHECK(logic::label_str_eq(row.label, "Fan 1 (step)"));
    CHECK(row_object_id(row) == "actuators_fan_1_step");
    CHECK(object_id(row.label) == "fan_1_step");

    // SELF-RETIRE PIN, exactly as test_conv_override() pins conv 114's 44 rows. The GENERATED tables
    // still carry the wrong label on precisely FOUR profiles; the day gen_profiles.py emits
    // "Fan 1 (step)" this count hits 0, the override matches nothing and is dead code, and this CHECK
    // trips — the signal to delete the label_override entry, this pin, and retract_relabeled_values.
    int raw_wrong = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++) {
            const auto& v = p.values[i];
            if (v.reg == 0x30 && v.offset == 1 && v.conv == 211 &&
                logic::label_str_eq(v.label, "Fan 1 (10 rpm)"))
                raw_wrong++;
        }
    CHECK(raw_wrong == 4);
}

// ── The availability ledger (logic/availability.hpp) — #209 defects 1, 2 and 6 ────────────────────
// Two things are asserted, and the second is the one that matters. The first is that each rule does
// what it says on a hand-built row. The second is what it does to the REAL CATALOG: a rule keyed on
// (page, offset, converter) is a claim about every profile at once, so the catalog loop is what
// proves it selects the quantity that was adjudicated and nothing else — the failure mode being a
// rule that silently starts suppressing a real hydronic reading on some other model.
static void test_availability() {
    // Target Evap. Temp. is NO LONGER here — #194 identified it as a mis-assigned converter rather
    // than an unmeasurable row, so its verdict lives in logic/conv_override.hpp. The ledger must be
    // silent about it, or a reader would think the quarantine is still load-bearing.
    const ValueDef evap{0x10, 6, 114, 2, 1, "Target Evap. Temp."};
    CHECK(availability_policy(evap) == AvailabilityPolicy::Always);
    CHECK(row_publishable(evap));

    // Target Cond. Temp. — the row is published; an exact zero from it is not.
    const ValueDef cond{0x10, 8, 114, 2, 1, "Target Cond. Temp."};
    CHECK(availability_policy(cond) == AvailabilityPolicy::ZeroMeansAbsent);
    CHECK(row_publishable(cond));                 // the ENTITY stays — this field can be populated
    CHECK(!value_available(cond, true, 0.0));     // raw 0x0000: unpopulated, not a 0 °C target
    CHECK(value_available(cond, true, 35.0));     // a real target still publishes
    CHECK(value_available(cond, true, -0.1));     // and the rule is an EXACT zero, not a band

    // A text/enum row has no number to judge and passes through untouched.
    CHECK(value_available(cond, false, 0.0));

    // ── Expansion valve pulses: raw 0xFFF8 is not a position ─────────────────────────────────────
    // BYTE LEVEL, because the whole finding is about which integer arrives on the wire. conv 151 is
    // u16 little-endian, so the field is {low, high}.
    const ValueDef ev1{0x30, 3, 151, 2, -1, "Expansion valve 1 (pls)"};
    const uint8_t ev_parked[]  = {0xC2, 0x01};   // 450 — the position it rests at between cycles
    const uint8_t ev_widest[]  = {0xDA, 0x01};   // 474 — the widest opening in 30 d of samples
    const uint8_t ev_shut[]    = {0x00, 0x00};   // 0 — a closed valve is a real reading, not absence
    const uint8_t ev_glitch[]  = {0xF8, 0xFF};   // 0xFFF8 — 65528 unsigned / -8 signed; neither is a
                                                 // valve position, which is why the fix is a
                                                 // withholding and not a re-read of the sign.
    CHECK(availability_policy(ev1) == AvailabilityPolicy::AboveRangeIsAbsent);
    CHECK(row_publishable(ev1));                 // the ENTITY stays — the valve is real

    // The CONVERTER is untouched: it still decodes exactly what REGISTERS.md §3.1 says it does, so
    // the domain audit's converters_equivalent() can still tell conv 151 from anything else. The
    // envelope is applied one layer up, by hp_format, exactly as it is for reading_plausible().
    CHECK(convert(ev1, ev_parked).value == 450.0);
    CHECK(convert(ev1, ev_widest).value == 474.0);
    CHECK(convert(ev1, ev_glitch).value == 65528.0);
    CHECK(convert(ev1, ev_glitch).ok);

    CHECK(value_available(ev1, true, convert(ev1, ev_parked).value));
    CHECK(value_available(ev1, true, convert(ev1, ev_widest).value));
    CHECK(value_available(ev1, true, convert(ev1, ev_shut).value));    // 0 pulses = shut, published
    CHECK(!value_available(ev1, true, convert(ev1, ev_glitch).value)); // 65528 = withheld

    // The bound is an impossibility filter, not a working-range check: a position well past anything
    // this unit reaches still publishes, because a larger model's valve legitimately might.
    CHECK(value_available(ev1, true, 1999.0));
    CHECK(value_available(ev1, true, EEV_PULSE_CEILING));   // one-sided, so the ceiling itself passes
    CHECK(!value_available(ev1, true, EEV_PULSE_CEILING + 1.0));

    // Everything the ledger says nothing about is unaffected — including the OTHER conv-114 rows and
    // a legitimate 0 °C reading, which is the one thing a global "zero means unavailable" rule would
    // have destroyed (a real thermistor crosses zero every winter).
    const ValueDef r1t{0x61, 8, 105, 2, 1, "Inlet water temp.(R4T)"};
    CHECK(availability_policy(r1t) == AvailabilityPolicy::Always);
    CHECK(row_publishable(r1t) && value_available(r1t, true, 0.0));
    const ValueDef tdis{0xA1, 5, 114, 2, 1, "Target Discharge Temp."};
    CHECK(availability_policy(tdis) == AvailabilityPolicy::Always);
    CHECK(value_available(tdis, true, 0.0));

    // The generated detect-only flag composes with the ledger rather than competing with it: both
    // reach the same predicate, so hp_poll and mqtt_ha's discovery cannot see different row sets.
    ValueDef hybrid{0x64, 2, 316, 1, -1, "Hybrid Op. Mode", true};
    CHECK(!row_publishable(hybrid));
    CHECK(availability_policy(hybrid) == AvailabilityPolicy::Always);   // orthogonal reasons

    // ── Against the real catalog ──────────────────────────────────────────────────────────────────
    int profiles_total = 0, evap_rows = 0, cond_rows = 0, suppressed = 0, odd_label = 0;
    int eev_rows = 0, conv151_rows = 0;
    for (const auto& p : def::profiles) {
        profiles_total++;
        const auto view = def::resolved(p);
        int publishable_on_0x10 = 0;
        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef& d = view[i];
            const AvailabilityPolicy pol = availability_policy(d);
            if (logic::effective_conv(d.reg, d.offset, d.conv) != d.conv) {
                suppressed++;
                evap_rows++;
                CHECK(d.reg == 0x10 && d.offset == 6 && d.conv == 114);
                CHECK(logic::adjudicated(d).conv == 109);
                // A quarantine must land on the quantity it was adjudicated for, on EVERY profile.
                // The structural key is what makes that true, and this is what proves it — including
                // the one place the catalog disagrees with ITSELF: altherma_lt_d7_e_bml labels this
                // exact register "Target Discharge Temp." while the other 43 and docs/REGISTERS.md §5
                // call it "Target Evap. Temp.". Same page, same offset, same converter, same width,
                // same dataType — one family's source catalog simply spells it differently, which is
                // the argument for keying on the register rather than the name in miniature. Under
                // either reading the ×0.1 decode is impossible (a discharge TARGET of 145-200 °C is
                // no more real than an evaporating one), so the adjudication covers both.
                if (logic::lwt_ci_contains(d.label, "target discharge")) odd_label++;
                else CHECK(logic::lwt_ci_contains(d.label, "target evap"));
            }
            if (pol == AvailabilityPolicy::ZeroMeansAbsent) {
                CHECK(logic::lwt_ci_contains(d.label, "target cond"));
                cond_rows++;
            }
            // The pulse ceiling and conv 151 must be the SAME set, in both directions. Left to
            // right: nothing but an expansion valve may acquire a ceiling meant for one. Right to
            // left: every conv-151 row is covered, since a coordinate the ledger missed would
            // publish the identical 0xFFF8 as a real position on some other model's valve.
            if (d.conv == 151) {
                conv151_rows++;
                CHECK(logic::lwt_ci_contains(d.label, "expansion valve"));
                CHECK(pol == AvailabilityPolicy::AboveRangeIsAbsent);
                CHECK(availability_rule(d)->ceiling == EEV_PULSE_CEILING);
            }
            if (pol == AvailabilityPolicy::AboveRangeIsAbsent) {
                eev_rows++;
                CHECK(d.conv == 151);
                CHECK((d.reg == 0x30 && (d.offset == 3 || d.offset == 5 || d.offset == 7 ||
                                         d.offset == 9)) ||
                      (d.reg == 0xA0 && d.offset == 8));
                CHECK(row_publishable(d));   // the valve is real — only the bad integer is withheld
            }
            // NO CORE HYDRONIC ROW MAY BE TOUCHED. The audit in #209 is explicit that the hydronic
            // decode is excellent and must not be collaterally damaged: leaving/return water, tank,
            // flow, pressure and the setpoints all live on 0x60-0x62, and not one of them may fall
            // under a rule.
            if (d.reg >= 0x60 && d.reg <= 0x62)
                CHECK(pol == AvailabilityPolicy::Always);
            if (d.reg == 0x10 && row_publishable(d)) publishable_on_0x10++;
        }
        // Page 0x10 must still be QUERIED on every profile after the quarantine — the error class,
        // the error code and the protection words live there, and so does the raw dump that is meant
        // to settle #194. A page whose rows are all unpublishable is not read at all (hp_poll).
        CHECK(publishable_on_0x10 > 0);
    }
    // The exact reach of the two rules, pinned. 44 of the 45 profiles carry both rows; the one that
    // does not is `altherma3_r_erga`, whose page-0x10 row set stops at offset 5 — it has no target
    // temperatures at all, so there is nothing to adjudicate there. Hardcoded on purpose: a changed
    // count means a profile was added or the generator's page-0x10 input moved, and either is a
    // reason to re-read the adjudication rather than let it silently re-scope itself.
    CHECK(profiles_total == 45);
    CHECK(evap_rows == 44 && cond_rows == 44);
    CHECK(evap_rows == suppressed);
    CHECK(odd_label == 1);   // exactly one family spells the re-decoded register differently
    // conv 151 has exactly ONE use in the catalog, which is the argument for covering all five of
    // its coordinates from a capture on one of them. If this count moves, the generator has started
    // emitting conv 151 somewhere new and the "it is always an expansion valve" premise needs
    // re-reading before the ceiling is allowed to follow it there.
    CHECK(conv151_rows == 113);
    CHECK(eev_rows == conv151_rows);
}

// ── Numeric fault state beside the textual code (logic/fault_state.hpp) — #209 defect 4 ──────────
static void test_fault_state() {
    // The inverse of conv 203, taken from the same ERR_TYPE table it renders from.
    CHECK(fault_class_from_text("Normal")  == FaultClass::Normal);
    CHECK(fault_class_from_text("Error")   == FaultClass::Error);
    CHECK(fault_class_from_text("Warning") == FaultClass::Warning);
    CHECK(fault_class_from_text("Caution") == FaultClass::Caution);
    CHECK(fault_class_from_text("?")       == FaultClass::Unknown);   // conv 203's out-of-range render
    CHECK(fault_class_from_text("")        == FaultClass::Unknown);
    CHECK(fault_class_from_text(nullptr)   == FaultClass::Unknown);
    CHECK(fault_class_from_text("Norma")   == FaultClass::Unknown);   // a prefix is not a match
    CHECK(fault_class_from_text("Normal2") == FaultClass::Unknown);   // nor is an extension

    // Round-trip against the real converter: whatever conv 203 emits for a byte, this reads back.
    const ValueDef etype{0x10, 4, 203, 1, -1, "Error type"};
    for (int b = 0; b < 4; b++) {
        const uint8_t raw = static_cast<uint8_t>(b);
        CHECK(fault_class_from_text(convert(etype, &raw).text) == static_cast<FaultClass>(b));
    }
    const uint8_t bogus = 9;
    CHECK(fault_class_from_text(convert(etype, &bogus).text) == FaultClass::Unknown);

    // The flags. Error is a stop; Warning and Caution are both "running and complaining".
    CHECK(!fault_error_active(FaultClass::Normal)  && !fault_warning_active(FaultClass::Normal));
    CHECK( fault_error_active(FaultClass::Error)   && !fault_warning_active(FaultClass::Error));
    CHECK(!fault_error_active(FaultClass::Warning) &&  fault_warning_active(FaultClass::Warning));
    CHECK(!fault_error_active(FaultClass::Caution) &&  fault_warning_active(FaultClass::Caution));

    // An unreadable class publishes NEITHER flag. Reporting 0/0 would assert "no fault" on a byte
    // nobody could decode — the one direction a fault flag must never fail in.
    CHECK(!fault_companions_publishable(FaultClass::Unknown));
    CHECK(fault_companions_publishable(FaultClass::Normal));

    // The wire form is always "1"/"0" — a permanently numeric field, which is the entire point.
    CHECK(FAULT_COMPANION_COUNT == 2);
    CHECK(std::string(fault_companion_state(0, FaultClass::Error))   == "1");
    CHECK(std::string(fault_companion_state(1, FaultClass::Error))   == "0");
    CHECK(std::string(fault_companion_state(0, FaultClass::Normal))  == "0");
    CHECK(std::string(fault_companion_state(1, FaultClass::Caution)) == "1");

    // ── The scenario #209 asks to be replayed: 00 -> U4 -> 00 ─────────────────────────────────────
    // The textual code keeps its type through the whole sequence (an alphanumeric code cannot become
    // a number), and the numeric flag moves 0 -> 1 -> 0 beside it, so an alert on the flag fires
    // where an alert on the code could not.
    const ValueDef ecode{0x10, 5, 204, 1, -1, "Error Code"};
    const uint8_t no_err = 0x00, u4 = 0x94, seven_h = 0xCB;   // ERR_C1/ERR_C2 nibble pairs
    CHECK(std::string(convert(ecode, &no_err).text)  == "0");   // conv 204 trims the leading space
    CHECK(std::string(convert(ecode, &u4).text)      == "U4");
    CHECK(std::string(convert(ecode, &seven_h).text) == "7H");
    const uint8_t cls_normal = 0, cls_error = 1;
    std::string seq;
    for (uint8_t c : {cls_normal, cls_error, cls_normal}) {
        const FaultClass fc = fault_class_from_text(convert(etype, &c).text);
        std::vector<GroupedValue> vals = {
            {"outdoor_state", "error_code",   "U4", PublishedKind::Text},
            {"outdoor_state", "error_active", fault_companion_state(0, fc), PublishedKind::Number},
        };
        seq += build_grouped_json(vals);
    }
    CHECK(seq == "{\"outdoor_state\":{\"error_code\":\"U4\",\"error_active\":0}}"
                 "{\"outdoor_state\":{\"error_code\":\"U4\",\"error_active\":1}}"
                 "{\"outdoor_state\":{\"error_code\":\"U4\",\"error_active\":0}}");

    // Discovery for the derived pair: group-scoped ids (a profile carries an error class on the
    // outdoor page AND on the hydronic one, and HA entity ids share one flat namespace), numeric
    // payloads spelled out, and a value_template that subscripts the row's own group.
    CHECK(companion_object_id("outdoor_state", "error_active") == "outdoor_state_error_active");
    CHECK(companion_object_id("hydronic", "error_active") == "hydronic_error_active");
    CHECK(companion_discovery_topic("homeassistant", "daikin_test", "hydronic", "warning_active")
          == "homeassistant/binary_sensor/daikin_test/hydronic_warning_active/config");
    const std::string ccfg = companion_discovery_config(
        "daikin_test", "daikin_board", "daikin/state", "daikin/status", "outdoor_state",
        FAULT_COMPANIONS[0]);
    CHECK(ccfg.find("\"name\":\"Outdoor State Error Active\"") != std::string::npos);
    CHECK(ccfg.find("\"uniq_id\":\"daikin_test_outdoor_state_error_active\"") != std::string::npos);
    CHECK(ccfg.find("\"val_tpl\":\"{{ value_json['outdoor_state']['error_active'] }}\"")
          != std::string::npos);
    CHECK(ccfg.find("\"pl_on\":\"1\",\"pl_off\":\"0\"") != std::string::npos);
    CHECK(ccfg.find("\"dev_cla\":\"problem\"") != std::string::npos);

    // Every profile that carries an error class gets the pair, and the two rows land in DIFFERENT
    // groups — which is what keeps the short JSON keys unambiguous.
    for (const auto& p : def::profiles) {
        int classes = 0;
        for (size_t i = 0; i < p.count; i++) {
            if (p.values[i].conv != 203) continue;
            classes++;
            const std::string g = group_for_page(p.values[i].reg);
            CHECK(!g.empty() && g != "other");
        }
        CHECK(classes >= 1);   // no profile is left without a numeric fault state
    }
}

// ── The run-time raw-page capture cadence (logic/raw_capture.hpp) — #194's decisive experiment ────
static void test_raw_capture() {
    logic::RawCaptureState s;
    const int64_t sec = 1000000;

    // Nothing while the compressor is stopped: that is the state hp_detect.cpp already dumps, and
    // the state in which the value under investigation is NOT wrong.
    CHECK(!logic::raw_capture_due(s, false, 0));
    CHECK(!logic::raw_capture_due(s, false, 100 * sec));
    CHECK(s.emitted == 0);

    // The stopped -> running EDGE fires immediately; the next cycle does not.
    CHECK(logic::raw_capture_due(s, true, 200 * sec));
    CHECK(!logic::raw_capture_due(s, true, 201 * sec));
    CHECK(!logic::raw_capture_due(s, true, (200 + logic::RAW_CAPTURE_PERIOD_S - 1) * sec));
    // …and then once per period, so a long run yields a short SERIES. Two candidate scales that both
    // fit one sample may not fit a curve, which is the whole reason for more than one point.
    CHECK(logic::raw_capture_due(s, true, (200 + logic::RAW_CAPTURE_PERIOD_S) * sec));
    CHECK(s.emitted == 2);

    // A stop re-arms the edge but NOT the budget: the next start dumps again, and the count keeps
    // climbing toward the per-boot ceiling.
    CHECK(!logic::raw_capture_due(s, false, 900 * sec));
    CHECK(logic::raw_capture_due(s, true, 901 * sec));
    CHECK(s.emitted == 3);

    // The ceiling holds. A unit that cycles all day cannot evict the rest of the boot's evidence
    // from the 6 KB diag ring — which is exactly how the crash records used to be lost.
    logic::RawCaptureState b;
    int fired = 0;
    for (int i = 0; i < 500; i++) {
        if (logic::raw_capture_due(b, false, i * 2000 * sec)) fired++;         // stop
        if (logic::raw_capture_due(b, true, (i * 2000 + 1) * sec)) fired++;    // start -> edge
    }
    CHECK(fired == logic::RAW_CAPTURE_MAX);
    CHECK(b.emitted == logic::RAW_CAPTURE_MAX);
    // Once exhausted it stays exhausted for the rest of the boot, in both phases.
    CHECK(!logic::raw_capture_due(b, true, 9999999 * sec));
}

int main() {
    test_crc();
    test_registers();
    test_convert();
    test_query_flag();
    test_redact();
    test_config_store();
    test_mcp_jsonrpc();
    test_http_surface();
    test_lwt_select();
    test_ou_stale();
    test_cop_scope();
    test_conv_override();
    test_label_override();
    test_availability();
    test_fault_state();
    test_raw_capture();
    test_published_kind();
    test_history();
    test_checkup();
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
    test_demand_flag_catalog();
    test_bsh_flag_catalog();
    test_registry();
    test_detect();
    test_json();
    test_mqtt_group();
    test_mqtt_uri();
    test_modbus();
    test_modbus_snapshot();
    test_homehub();
    test_homehub_map();
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
    test_http_body();
    test_uart_plan();
    test_detect_backoff();
    test_version_cmp();
    test_ota_manifest();
    test_ota_channel();
    test_ui_lang();
    test_profile_view();
    test_metric_identity();
    test_tie_break_identity();
    test_tie_break_order_independence();
    test_tie_break_reach();
    test_entity_identity();
    test_feature_gate();
    if (g_failures == 0) { std::printf("all logic tests passed\n"); return 0; }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
