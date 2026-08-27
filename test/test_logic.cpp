// Host logic tests for the IDF-free pure headers in main/logic/. One translation unit; run via
// scripts/run-mock-tests.sh (cmake+ctest, or a direct g++/clang++ compile). CI's mechanical_gates
// job runs it with coverage and gates the firmware build on this. Add a CHECK here whenever you
// touch a converter / CRC / the config model / a discovery payload — the riskiest, silently-wrong
// parts.
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <limits>
#include <map>
#include <new>
#include <set>
#include <string>
#include <vector>

#include "logic/availability.hpp"
#include "logic/conv_override.hpp"
#include "logic/board_pins.hpp"
#include "logic/board_presets.hpp"
#include "logic/binary_semantics.hpp"
#include "logic/chunk_sink.hpp"
#include "logic/fault_state.hpp"
#include "logic/raw_capture.hpp"
#include "logic/state_dwell.hpp"
#include "logic/captive.hpp"
#include "logic/boot_guard.hpp"
#include "logic/heap_watchdog.hpp"
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
#include "logic/heating_curve_diagnosis.hpp"
#include "logic/heating_curve_mqtt.hpp"
#include "logic/error_codes.hpp"
#include "logic/checkup.hpp"
#include "logic/health_gate.hpp"
#include "logic/version_cmp.hpp"
#include "logic/ota_channel.hpp"
#include "logic/ui_lang.hpp"
#include "logic/ota_headroom.hpp"
#include "logic/ota_hil_feed.hpp"
#include "logic/ota_manifest.hpp"
#include "logic/ota_changelog_range.hpp"
#include "logic/payload_complete.hpp"
#include "logic/ota_transport.hpp"
#include "logic/heartbeat.hpp"
#include "logic/hp_query_log.hpp"
#include "logic/http_body.hpp"
#include "logic/http_cache.hpp"
#include "logic/http_deadline.hpp"
#include "logic/http_request.hpp"
#include "logic/json.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/mqtt_cleanup.hpp"
#include "logic/mqtt_publish_gate.hpp"
#include "logic/ota_quiesce.hpp"
#include "logic/link_watch.hpp"
#include "logic/feature_gate.hpp"
#include "logic/fixed_text.hpp"
#include "logic/history.hpp"
#include "logic/checkup_persist.hpp"
#include "logic/history_persist.hpp"
#include "logic/lwt_select.hpp"
#include "logic/profile_view.hpp"
#include "logic/ou_stale.hpp"
#include "logic/cop_scope.hpp"
#include "logic/mqtt_base.hpp"
#include "logic/mqtt_uri.hpp"
#include "logic/reference_temperature.hpp"
#include "logic/refrigerant_service.hpp"
#include "logic/weather_forecast.hpp"
#include "logic/x10a_snapshot.hpp"
#include "logic/weather_mqtt.hpp"
#include "logic/open_meteo.hpp"
#include "logic/modbus.hpp"
#include "logic/modbus_plan.hpp"
#include "logic/modbus_snapshot.hpp"
#include "logic/query_flag.hpp"
#include "logic/redact.hpp"
#include "logic/config_store.hpp"
#include "logic/env3.hpp"
#include "logic/mcp.hpp"
#include "logic/http_surface.hpp"
#include "logic/http_values_wait.hpp"
#include "logic/registers.hpp"
#include "logic/reset_reason.hpp"
#include "logic/syslog_policy.hpp"
#include "logic/hexdump.hpp"
#include "logic/hp_probe.hpp"
#include "logic/timestamp.hpp"
#include "logic/uart_plan.hpp"
#include "logic/net_link.hpp"
#include "logic/wifi_rollback.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "def/signatures.hpp"
#include "def/homehub.hpp"
#include "logic/homehub_map.hpp"

static int g_failures = 0;
#define CHECK(cond)                                                                                \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);                            \
            g_failures++;                                                                          \
        }                                                                                          \
    } while (0)

static bool approx(double a, double b) { return std::fabs(a - b) < 1e-6; }

using namespace daik;

static void test_http_cache() {
    constexpr std::string_view tag = "\"012345abcdef\"";
    CHECK(http_if_none_match(tag, tag));
    CHECK(http_if_none_match(" W/\"012345abcdef\" ", tag));
    CHECK(http_if_none_match("\"old\", W/\"012345abcdef\", \"new\"", tag));
    CHECK(http_if_none_match("*", tag));
    CHECK(http_if_none_match("\"comma,inside\", \"012345abcdef\"", tag));
    CHECK(!http_if_none_match("\"012345abcde\"", tag));
    CHECK(!http_if_none_match("\"x012345abcdefx\"", tag));
    CHECK(!http_if_none_match("", tag));
    CHECK(!http_if_none_match(tag, ""));
}

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
    frame[3]        = crc(frame, 3);
    CHECK(crc_ok(frame, 4));
    frame[3] ^= 0xff;
    CHECK(!crc_ok(frame, 4));

    // Protocol-I identity is part of validity: a CRC-correct frame for page 0x61 must never be
    // attached to a query for 0x60. Negative and partial replies retain distinct classifications.
    uint8_t good_i[] = {0x40, 0x60, 0x04, 0xaa, 0xbb, 0};
    good_i[5]        = crc(good_i, 5);
    CHECK(hp_reply_classify(0x60, Protocol::I, good_i, 6, 6) == HpReplyKind::Ok);
    uint8_t wrong_i[] = {0x40, 0x61, 0x04, 0xaa, 0xbb, 0};
    wrong_i[5]        = crc(wrong_i, 5);
    CHECK(hp_reply_classify(0x60, Protocol::I, wrong_i, 6, 6) == HpReplyKind::UnexpectedReply);
    CHECK(hp_reply_classify(0x60, Protocol::I, good_i, 4, 6) == HpReplyKind::ShortReply);
    good_i[5] ^= 0xff;
    CHECK(hp_reply_classify(0x60, Protocol::I, good_i, 6, 6) == HpReplyKind::BadCrc);
    CHECK(hp_reply_classify(0x60, Protocol::I, err, 2, 6) == HpReplyKind::Rejected);
    CHECK(hp_reply_classify(0x60, Protocol::I, nullptr, 0, 6) == HpReplyKind::NoReply);

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
    CHECK(reply_len_valid(Protocol::I, 4, test_buflen));
    CHECK(!reply_len_valid(Protocol::I, 3, test_buflen));
    CHECK(reply_len_valid(Protocol::S, 2, test_buflen));
    CHECK(!reply_len_valid(Protocol::S, 1, test_buflen));

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

static void test_hp_query_log_policy() {
    // Detection probes the union of all known model pages. A rejected/absent page is therefore a
    // fingerprint bit, not an incident; corruption remains visible. Polling a detected profile
    // keeps every failure because those pages were selected as part of this unit's live contract.
    CHECK(!hp_query_should_log(HpQueryLogPolicy::IntegrityOnly, HpQueryFailure::NoReply));
    CHECK(!hp_query_should_log(HpQueryLogPolicy::IntegrityOnly, HpQueryFailure::Rejected));
    CHECK(hp_query_should_log(HpQueryLogPolicy::IntegrityOnly, HpQueryFailure::ShortReply));
    CHECK(hp_query_should_log(HpQueryLogPolicy::IntegrityOnly, HpQueryFailure::InvalidLength));
    CHECK(hp_query_should_log(HpQueryLogPolicy::IntegrityOnly, HpQueryFailure::BadCrc));
    CHECK(hp_query_should_log(HpQueryLogPolicy::IntegrityOnly, HpQueryFailure::UnexpectedReply));
    CHECK(hp_query_should_log(HpQueryLogPolicy::All, HpQueryFailure::NoReply));
    CHECK(hp_query_should_log(HpQueryLogPolicy::All, HpQueryFailure::Rejected));
}

static void test_registers() {
    const uint8_t le[] = {0x2C, 0x01}; // little-endian 0x012C = 300
    CHECK(read_u16(le, 2, false) == 300);
    CHECK(read_u16(le, 2, true) == 0x2C01); // big-endian view of the same bytes
    const uint8_t be[] = {0x01, 0x2C};      // big-endian 0x012C = 300
    CHECK(read_u16(be, 2, true) == 300);
    const uint8_t neg[] = {0x9C, 0xFF}; // little-endian 0xFF9C = -100 signed
    CHECK(read_s16(neg, 2, false) == -100);
    CHECK(read_u16(neg, 2, false) == 0xFF9C);
    const uint8_t one[] = {0x2A}; // 1-byte field reads data[0]
    CHECK(read_u16(one, 1, false) == 42);
    CHECK(read_s16(one, 1, false) == 42); // high byte 0 -> stays positive
    CHECK(in_bounds(2, 2, 10));
    CHECK(!in_bounds(9, 2, 10));
}

static void test_convert() {
    // conv 105 = signed, little-endian, ×0.1 (temperature).
    ValueDef      temp{0x61, 0, 105, 2, 1, "T"};
    const uint8_t pos[] = {0x2C, 0x01}; // LE 300 -> 30.0 °C
    CHECK(convert(temp, pos).ok && approx(convert(temp, pos).value, 30.0));
    const uint8_t negt[] = {0x9C, 0xFF};             // LE 0xFF9C = -100 -> -10.0 °C
    CHECK(approx(convert(temp, negt).value, -10.0)); // sign/endianness fix: NOT 6543.6

    // conv 152 = unsigned big-endian integer (counts/steps).
    ValueDef      cnt{0x30, 0, 152, 1, -1, "n"};
    const uint8_t c[] = {0x2A};
    CHECK(approx(convert(cnt, c).value, 42.0));

    // conv 151 = unsigned LITTLE-endian (expansion-valve pulses, 27 profiles); conv 152 reads the
    // SAME bytes big-endian. Pin both byte orders so a 151/152 transcription slip can't ship
    // silently.
    ValueDef      u151{0x30, 3, 151, 2, -1, "u151"};
    ValueDef      u152{0x30, 3, 152, 2, -1, "u152"};
    const uint8_t u2b[] = {0x2C, 0x01}; // LE -> 300, BE -> 0x2C01 = 11265
    CHECK(convert(u151, u2b).ok && approx(convert(u151, u2b).value, 300.0));
    CHECK(convert(u152, u2b).ok && approx(convert(u152, u2b).value, 11265.0));
    CHECK(!approx(convert(u151, u2b).value,
                  convert(u152, u2b).value)); // 151 != 152 on the same bytes

    // conv 161 = unsigned big-endian ×0.5 (CT current).
    ValueDef      ct{0x63, 0, 161, 1, 3, "CT"};
    const uint8_t a[] = {0x14}; // 20 -> 10.0 A
    CHECK(approx(convert(ct, a).value, 10.0));

    ValueDef unk{0x00, 0, 998, 1, -1, "x"}; // layout marker -> unimplemented/skipped
    CHECK(convert(unk, c).unimpl);

    // ── Converters recovered from the value-definition analysis ──
    // conv 114 = signed LE ×0.1 target temp; 0x8000 (bytes 00 80) = "no data".
    ValueDef      tgt{0x10, 0, 114, 2, 1, "Tt"};
    const uint8_t t441[] = {0xB9, 0x01}; // LE 0x01B9 = 441 -> 44.1 °C
    CHECK(convert(tgt, t441).ok && approx(convert(tgt, t441).value, 44.1));
    const uint8_t tnd[] = {0x00, 0x80}; // 0x8000 -> no data
    CHECK(!convert(tgt, tnd).ok);

    // conv 118 = signed big-endian ×0.01 (mixed-water temp).
    ValueDef      mw{0x64, 10, 118, 2, 1, "mw"};
    const uint8_t mwb[] = {0x0D, 0xDA}; // BE 0x0DDA = 3546 -> 35.46
    CHECK(approx(convert(mw, mwb).value, 35.46));

    // conv 300..307 = bit b (0 = LSB) of data[0] -> numeric 1/0.
    const uint8_t bits[] = {0x80}; // only bit 7 set
    ValueDef      b7{0x10, 1, 307, 1, -1, "b7"};
    ValueDef      b0{0x10, 1, 300, 1, -1, "b0"};
    CHECK(convert(b7, bits).ok && approx(convert(b7, bits).value, 1.0));
    CHECK(convert(b0, bits).ok && approx(convert(b0, bits).value, 0.0));
    CHECK(convert(b7, bits).text[0] == '\0' && convert(b0, bits).text[0] == '\0');

    // conv 217 = operation mode; conv 315 = indoor mode from the HIGH nibble.
    ValueDef      om{0x10, 0, 217, 1, -1, "om"};
    const uint8_t m1[] = {0x01};
    CHECK(std::string(convert(om, m1).text) == "Heating");
    const uint8_t m5[]   = {0x05};
    const uint8_t m6[]   = {0x06};
    const uint8_t m18[]  = {0x12};
    const uint8_t m19[]  = {0x13};
    const uint8_t m20[]  = {0x14};
    const uint8_t m255[] = {0xFF};
    CHECK(std::string(convert(om, m5).text) == "Auto Cool"); // mode index 5 = Auto Cool
    CHECK(std::string(convert(om, m6).text) == "Auto Heat"); // mode index 6 = Auto Heat
    // Index 19 is catalog-only and unmeasured on a live hydronic unit. Pin its recovered spelling
    // without claiming the mode is physically available; the next index must fail closed.
    CHECK(OP_MODE_COUNT == 20);
    CHECK(std::string(convert(om, m18).text) == "UseStrdThrm(ht)4");
    CHECK(std::string(convert(om, m19).text) == "Aux.");
    CHECK(std::string(convert(om, m20).text) == "?");
    CHECK(std::string(convert(om, m255).text) == "?");

    // Index 0 is the IDLE state and reads "Stop" — NOT the split-air-conditioner table's "Fan
    // Only", a mode a hydronic Altherma does not have (#216). Pinned as a PAIR against the wire
    // bytes logic/raw_capture.hpp took across one stopped->running edge on a live Altherma 3 R W,
    // because a single sample cannot tell a wrong LABEL from a table shifted by one: index 0 was
    // observed only at rest and index 1 only during the run, and index 1 was already correct.
    // Nothing else can catch this — reading_plausible() returns early on text (no enum value is
    // ever bounded), the domain audit judges converter ids and byte layout rather than whether a
    // label is true of the product, and a metrics consumer drops strings entirely, so the row has
    // no VictoriaMetrics series in which a wrong mode could be noticed.
    const uint8_t m0[] = {0x00}; // raw 0x10 [00 04 …] — compressor at rest
    CHECK(std::string(convert(om, m0).text) == "Stop");
    CHECK(std::string(convert(om, m0).text) != "Fan Only");
    CHECK(std::string(convert(om, m1).text) == "Heating"); // raw 0x10 [01 …] — same run, running
    // The idle label agrees with the INDOOR table's own index 0 (conv 315, §4.2), which had it
    // right all along — the two now answer "the plant is not running" with one word, not two.
    CHECK(std::string(convert(om, m0).text) == std::string(IU_MODE[0]));
    ValueDef      im{0x60, 2, 315, 1, -1, "im"};
    const uint8_t im10[] = {0x10}; // hi nibble 1 -> Heating
    CHECK(std::string(convert(im, im10).text) == "Heating");

    // conv 203 = error class; conv 204 = 2-char Daikin error code (hi/lo nibble tables).
    ValueDef      et{0x10, 4, 203, 1, -1, "et"};
    const uint8_t e0[] = {0x00};
    CHECK(std::string(convert(et, e0).text) == "Normal");
    ValueDef      ec{0x10, 5, 204, 1, -1, "ec"};
    const uint8_t u4[] = {0x94}; // hi 9 -> 'U', lo 4 -> '4'
    CHECK(std::string(convert(ec, u4).text) == "U4");

    // error_codes.hpp: English description lookup on top of the raw conv-204 code, keyed on the
    // exact same code strings ERR_C1/ERR_C2 produce (docs/REGISTERS.md §4.3).
    CHECK(std::string(error_code_description("U4")) == "Indoor/outdoor unit communication problem");
    CHECK(std::string(error_code_description("E3")) ==
          "Outdoor unit high-pressure switch activated");
    CHECK(std::string(error_code_description("7H")) == "Water flow problem");
    CHECK(std::string(error_code_description("UF")) ==
          "Reversed piping or faulty communication wiring detected");
    CHECK(std::string(error_code_description("ZZ")) ==
          ""); // not in the table -> empty, not a guess
    CHECK(std::string(format_error_code("U4")) == "U4: Indoor/outdoor unit communication problem");
    CHECK(std::string(format_error_code("ZZ")) == "ZZ"); // unknown code -> bare code, unchanged

    // conv 211 = numeric fan step (including 0); conv 316 = hybrid mode.
    ValueDef      fs{0x30, 1, 211, 1, -1, "fs"};
    const uint8_t f0[] = {0x00};
    const uint8_t f5[] = {0x05};
    CHECK(convert(fs, f0).ok && approx(convert(fs, f0).value, 0.0));
    CHECK(convert(fs, f0).text[0] == '\0');
    CHECK(convert(fs, f5).ok && approx(convert(fs, f5).value, 5.0));
    ValueDef      hy{0x64, 2, 316, 1, -1, "hy"};
    const uint8_t h1[] = {0x01};
    CHECK(std::string(convert(hy, h1).text) == "Hybrid");

    // conv 801-805 = refrigerant type (encoded by the converter id; reads no bytes). The id ->
    // curve mapping in profile_refrigerant depends on each label decoding correctly.
    ValueDef rf{0x00, 0, 802, 0, -1, "rf"};
    CHECK(std::string(convert(rf, c).text) == "R32");
    CHECK(std::string(convert(ValueDef{0x00, 0, 801, 0, -1, "rf"}, c).text) == "R410A");
    CHECK(std::string(convert(ValueDef{0x00, 0, 803, 0, -1, "rf"}, c).text) == "R22");
    CHECK(std::string(convert(ValueDef{0x00, 0, 804, 0, -1, "rf"}, c).text) == "R407C");
    CHECK(std::string(convert(ValueDef{0x00, 0, 805, 0, -1, "rf"}, c).text) == "R134a");

    // conv 214/215 = raw EEPROM identification byte (no name table -> exposed as the byte value).
    ValueDef      ee{0x11, 0, 215, 1, -1, "ee"};
    const uint8_t e34[] = {0x34};
    CHECK(convert(ee, e34).ok && approx(convert(ee, e34).value, 52.0)); // 0x34 = 52

    // conv 219 = I/U capacity code (raw byte, 43 profiles) -> exposed as the raw code value.
    ValueDef      cap{0x00, 0, 219, 1, -1, "cap"};
    const uint8_t cap8[] = {0x08};
    CHECK(convert(cap, cap8).ok && approx(convert(cap, cap8).value, 8.0));

    // Refrigerant pressure->temperature curve is monotonic in the working range.
    CHECK(press2temp(20.0) < press2temp(30.0));
    // Refrigerant type selects the curve: R410A (801) and R22 (803) differ from the R32 (802)
    // default; unknown ids (804/805) fall back to R32. A conv-405 row must honour rtype.
    CHECK(!approx(press2temp(20.0, 801), press2temp(20.0, 802)));
    CHECK(!approx(press2temp(20.0, 803), press2temp(20.0, 802)));
    CHECK(approx(press2temp(20.0, 804), press2temp(20.0, 802)));
    ValueDef      p405{0x62, 0, 405, 2, 1, "Pt"};
    const uint8_t p200[] = {0xC8, 0x00}; // LE 200 -> 20.0 bar in
    CHECK(!approx(convert(p405, p200, 801).value, convert(p405, p200, 802).value));
    CHECK(approx(convert(p405, p200, 802).value, convert(p405, p200).value)); // default == R32

    // conv 405 saturation temp from a 0-bar sensor (absent on many hydrobox units, or the
    // compressor simply off) must NOT publish its press2temp(0) ≈ -51 °C placeholder — drop it
    // INTRINSICALLY in convert() (the 0-bar decision needs the raw pressure, which the publish-time
    // filter never sees).
    const uint8_t zerobar[] = {0x00, 0x00}; // 0 bar in -> no meaningful sat temp
    CHECK(!convert(p405, zerobar).ok);
    const uint8_t realbar[] = {0x64, 0x00}; // LE 100 -> 10.0 bar -> a real sat temp kept
    CHECK(convert(p405, realbar).ok);

    // reading_plausible: the publish-time °C envelope (TEMP_MIN_C/TEMP_MAX_C), applied by hp_format
    // — NOT inside convert(), which keeps its intrinsic per-converter semantics so the catalog
    // audit can still tell conv 105 from conv 114 (see convert.hpp / tools/domain/selftest.sh #38).
    // This is what stops an idle OU's 576 °C outdoor-HX or a 231.6 °C target-evap reaching Home
    // Assistant.
    ValueDef      ot{0x20, 2, 105, 2, 1, "outdoor HX"};
    const uint8_t hot576[] = {0x80, 0x16}; // LE 0x1680 = 5760 -> 576.0 °C, impossible
    CHECK(convert(ot, hot576).ok);         // convert() still decodes it (intrinsic, unchanged)
    CHECK(!reading_plausible(ot, convert(ot, hot576))); // but it is not fit to publish
    ValueDef      evap{0x10, 6, 114, 2, 1, "evap"};
    const uint8_t evap2316[] = {0x0C, 0x09}; // LE 0x090C = 2316 -> 231.6 °C, impossible
    CHECK(!reading_plausible(evap, convert(evap, evap2316)));
    const uint8_t warm[] = {0xF4, 0x01}; // LE 500 -> 50.0 °C, a real reading
    CHECK(reading_plausible(ot, convert(ot, warm)) && approx(convert(ot, warm).value, 50.0));
    // A ±3276.x no-data sentinel on conv 105 (which has NO intrinsic guard) is also caught here —
    // the general backstop that #35–#39 never had for conv 105.
    const uint8_t nd105[] = {0x00, 0x80}; // 0x8000 -> -3276.8 °C on conv 105
    CHECK(convert(ot, nd105).ok && !reading_plausible(ot, convert(ot, nd105)));
    // Keyed on the °C dataType, never the converter id: conv 105 also carries kW / COP rows at
    // dataType -1 (e.g. BE_COP), which must publish even when numerically large.
    ValueDef      cop{0x64, 3, 105, 2, -1, "BE_COP"};
    const uint8_t cop3000[] = {0xB8, 0x0B}; // LE 3000 -> 300.0, must NOT be clipped (not °C)
    CHECK(reading_plausible(cop, convert(cop, cop3000)) &&
          approx(convert(cop, cop3000).value, 300.0));

    // ── KNOWN DEFECT WITNESS — Target Evap. Temp. on page 0x10/6 (issue #194)
    // ───────────────────── The envelope above has a measured hole, and this pins it so neither
    // side can drift silently.
    //
    // MEASURED on a live 4-8 kW unit (profile altherma_ebla_edla_d_series_4_8kw_monobloc, firmware
    // 1.0.0-dev.188, 2026-07-26): this row tracks the compressor cycle rather than sitting on a
    // placeholder. At rest it decodes to 240.6 °C and IS dropped (>200, the `evap2316` case above
    // is the same shape). During a DHW run it dips to 145.9 °C and climbs back to 199.6 °C — all of
    // which land INSIDE [-60, 200] and reach Home Assistant as real target temperatures. Three
    // separate runs in an 18-hour window showed the identical shape.
    //
    // The decode is NOT the drift: the catalog row is conv 114 / size 2 / type 1 at 0x10 offset 6
    // in 44 of 45 profiles, docs/REGISTERS.md §5 says exactly that, and conv 114 is implemented
    // exactly as §3.1 specifies. Offset shift, endianness and width are all ruled out in #194 (a
    // one-byte shift yields 2611.2 °C or 0.9 °C at rest). What is left is a SCALE mismatch — ×0.1
    // is 10x too coarse for this row on this family. Under ×0.01 the same raw bytes read 24.06 °C
    // at rest (ambient measured 22.5-23.0 °C, i.e. an idle coil at air temperature) and 14.59 °C
    // running, 6-8 K below ambient: a textbook air-source evaporator approach.
    //
    // RESOLVED in #194 — the scale is ÷128, i.e. the row is encoded with conv 109 and the generated
    // tables point it at conv 114. See logic/conv_override.hpp for the full argument; the decisive
    // evidence is STRUCTURAL rather than physical, which is what makes it safe to act on where a
    // range that merely "looks nicer" would not be. conv 114 publishes raw × 0.1 at one decimal, so
    // every value this row has ever published carries its 16-bit register exactly — and all 54
    // distinct integers ever observed (46 run-time from the stored series, 8 at rest from the
    // boot-time page dumps) satisfy raw == floor(128 × T) for T on an exact 0.1 K grid. The set
    // {floor(12.8k)} has density 1/12.8 among the integers, so that is p ~ 1.6e-60 against any
    // other scale. ×0.01 — #194's own preferred candidate, picked because 24.06 °C at rest "looked
    // like ambient" — has no such grid, and its ambient cross-check was against the X10A outdoor
    // reading, which #209 later proved is HELD OVER at rest (logic/ou_stale.hpp): it was comparing
    // a stale number. Against the independent HomeHub sensor the row does not track ambient at all.
    //
    // conv 114 itself is NOT touched: it is a correct ×0.1 converter and three other rows use it.
    // This is the #35-#39 shape — a wrong converter ID on a right register — not a wrong converter.
    const uint8_t evap1996[] = {0xCC, 0x07}; // LE 0x07CC = 1996 -> 199.6 °C, MEASURED
    const uint8_t evap1459[] = {0xB3, 0x05}; // LE 0x05B3 = 1459 -> 145.9 °C, MEASURED (run min)
    const uint8_t evap2406[] = {0x66, 0x09}; // LE 0x0966 = 2406 -> 240.6 °C, MEASURED (at rest)
    CHECK(approx(convert(evap, evap1996).value, 199.6)); // spec-conformant decode of the real bytes
    CHECK(approx(convert(evap, evap1459).value, 145.9));
    CHECK(approx(convert(evap, evap2406).value, 240.6));
    // The two run-time readings are impossible as an evaporating temperature — a coil that absorbs
    // heat from 22.5 °C air cannot itself be at 145-200 °C — yet the ENVELOPE admits both. That
    // hole is unchanged and is asserted here as the standing contradiction it is.
    CHECK(reading_plausible(evap, convert(evap, evap1996)));  // <- still WRONG, still inside ±200
    CHECK(reading_plausible(evap, convert(evap, evap1459)));  // <- still WRONG, still inside ±200
    CHECK(!reading_plausible(evap, convert(evap, evap2406))); // the at-rest value IS caught (>200)
    // Decoded as the wire actually encodes it, the SAME bytes read as a textbook evaporating
    // temperature — and now inside the envelope for the right reason rather than by luck.
    const ValueDef evap_fix = logic::adjudicated(evap);
    CHECK(evap_fix.conv == 109);                                    // 114 -> 109 (÷128)
    CHECK(approx(convert(evap_fix, evap1996).value, 1996 / 128.0)); // 15.59 -> 15.6 °C; was 199.6
    CHECK(approx(convert(evap_fix, evap1459).value, 1459 / 128.0)); // 11.40 °C; was 145.9 (run min)
    CHECK(approx(convert(evap_fix, evap2406).value, 2406 / 128.0)); // 18.80 °C; was 240.6 (dropped)
    CHECK(reading_plausible(evap_fix, convert(evap_fix, evap1996)));
    CHECK(reading_plausible(evap_fix, convert(evap_fix, evap1459)));
    CHECK(
        reading_plausible(evap_fix, convert(evap_fix, evap2406))); // the at-rest value now SURVIVES
    // The quarantine is lifted BECAUSE the row is decoded correctly, not because anyone stopped
    // worrying: the ledger entry moved from availability.hpp to conv_override.hpp, and this asserts
    // that the row publishes again on the corrected converter.
    CHECK(row_publishable(evap_fix));
    CHECK(value_available(evap_fix, true, convert(evap_fix, evap1996).value));
    CHECK(value_available(evap_fix, true, convert(evap_fix, evap1459).value));
    // Precision comes along for free: 109 is in the ×0.1/÷256 scaled family, so it still prints one
    // decimal. A silent drop to 0 decimals would round 15.6 °C to 16 and lose the 0.1 K grid that
    // is the whole evidence base.
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
    CHECK(approx(convert(evap, evap2406).value * 0.1, 24.06)); // at rest  ~= ambient
    CHECK(approx(convert(evap, evap1459).value * 0.1, 14.59)); // running  ~= 8 K below ambient

    // A REFRIGERANT pressure of 0 bar is an unreported transducer, not a reading: these are
    // ABSOLUTE pressures and a sealed circuit is never at vacuum. Measured on a live 4-8 kW unit,
    // High/Low Pressure (0x20/12+14) read exactly 0.0 bar both at rest and at 42 rps, while the
    // 0x62/15 refrigerant sensor read a correct 15.3 bar — so the 0.0 reached HA as a real pressure
    // (#35-#39 shape). WATER pressure must keep publishing 0 bar: a drained system genuinely reads
    // it. The refrigerant/water split is taken from the CATALOG — a conv-405 saturation-temperature
    // companion at the same (reg, offset) — never from the label, which an alias could flip.
    const ValueDef pprof[] = {
        {0x20, 12, 105, 2, 2, "High Pressure"},
        {0x20, 12, 405, 2, 1, "High Pressure(T)"},
        {0x62, 11, 105, 1, 2, "Water pressure"}, // no 405 companion -> water
        {0x62, 15, 105, 2, 2, "Refrigerant pressure sensor"},
        {0x62, 15, 405, 2, 1, "Pressure sensor(T)"},
    };
    const size_t pn = sizeof(pprof) / sizeof(pprof[0]);
    CHECK(is_refrigerant_pressure(pprof[0], pprof, pn)); // 0x20/12 — outdoor page AND a 405 twin
    CHECK(is_refrigerant_pressure(pprof[3], pprof,
                                  pn)); // 0x62/15 — hydronic page, reached by the twin
    CHECK(!is_refrigerant_pressure(pprof[2], pprof, pn)); // 0x62/11 water pressure: neither signal
    // The PAGE signal alone must carry an outdoor bar row that has no 405 twin (0xA0 "Pressure"),
    // and must not need the profile at all — that is what makes signal 1 independent of signal 2.
    const ValueDef aux{0xA0, 6, 119, 2, 2, "Pressure"};
    CHECK(is_refrigerant_pressure(aux, pprof, pn));
    CHECK(is_refrigerant_pressure(aux, nullptr, 0));
    // Same (reg,offset) but a different PAGE must not borrow the twin: 0x20/12 vs 0x62/12.
    const ValueDef otherpage{0x62, 12, 105, 2, 2, "some other bar"};
    CHECK(!is_refrigerant_pressure(otherpage, pprof, pn));
    // A non-bar row on an outdoor page is not a pressure at all — the page signal must not swallow
    // it.
    const ValueDef outdoor_temp{0x20, 2, 105, 2, 1, "R1T-Outdoor air temp."};
    CHECK(!is_refrigerant_pressure(outdoor_temp, pprof, pn));
    const uint8_t p0bar[]  = {0x00, 0x00}; // 0 -> 0.0 bar
    const uint8_t bar153[] = {0x99, 0x00}; // LE 153 -> 15.3 bar, the real at-rest value
    CHECK(convert(pprof[0], p0bar).ok);    // still decoded (intrinsic)
    CHECK(!reading_plausible(pprof[0], convert(pprof[0], p0bar), pprof, pn)); // but not published
    CHECK(reading_plausible(pprof[3], convert(pprof[3], bar153), pprof, pn) &&
          approx(convert(pprof[3], bar153).value, 15.3)); // a real one survives
    CHECK(
        reading_plausible(pprof[2], convert(pprof[2], p0bar), pprof, pn)); // 0 bar WATER publishes
    // Called WITHOUT a profile, the two signals degrade differently, and that split is the point:
    // the PAGE signal needs no table, so an outdoor 0-bar row is still withheld...
    CHECK(!reading_plausible(pprof[0], convert(pprof[0], p0bar))); // 0x20 — still caught
    // ...while the conv-405 twin cannot be looked up, so a hydronic refrigerant row falls back to
    // publishing rather than being guessed at. A caller with no table in hand gets the weaker
    // guarantee, never a wrong one.
    CHECK(reading_plausible(pprof[3], convert(pprof[3], p0bar))); // 0x62/15 — not caught
    CHECK(
        !reading_plausible(pprof[3], convert(pprof[3], p0bar), pprof, pn)); // ...but caught with it

    // profile_refrigerant: pick the 801-805 row's id, else default to R32 (802).
    const ValueDef prof801[]   = {{0x00, 0, 801, 0, -1, "*Refrigerant type"},
                                  {0x61, 0, 105, 2, 1, "T"}};
    const ValueDef prof_none[] = {{0x61, 0, 105, 2, 1, "T"}};
    CHECK(profile_refrigerant(prof801, 2) == 801);
    CHECK(profile_refrigerant(prof_none, 1) == 802);

    // display_decimals: ×0.01 -> 2, scaled families (incl. 161 CT current and 405) -> 1, integers
    // 0.
    CHECK(display_decimals(118) == 2);
    CHECK(display_decimals(161) == 1); // was formatted as an integer, losing 0.5
    CHECK(display_decimals(105) == 1);
    CHECK(display_decimals(405) == 1);
    CHECK(display_decimals(152) == 0);
    CHECK(display_decimals(217) == 0);

    // Catalog-wide regression guard for the "Water pressure" quirk: the hydronic water
    // pressure at reg 0x62 offset 11 must decode as raw bar (conv 105, type 2) in EVERY profile —
    // never the refrigerant saturation-temp curve (conv 405) the catalog mis-assigned on the 4-8kW
    // / E-series models. (Legit conv-405 refrigerant "(T)" rows live at other offsets, e.g.
    // 0x62[15].)
    int wp_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x62 && p.values[i].offset == 11) {
                CHECK(p.values[i].conv == 105 && p.values[i].type == 2);
                wp_checked++;
            }
    CHECK(wp_checked >= 40); // every model carries this row; all must be raw bar

    // Catalog guard (#35): "Mixed water temp." at reg 0x64 offset 10 is signed BE ×0.01 (conv 118)
    // in EVERY profile — never conv 105 (signed LE ×0.1), which decodes 0D DA as -971.5 °C.
    int mw_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x64 && p.values[i].offset == 10) {
                CHECK(p.values[i].conv == 118);
                mw_checked++;
            }
    CHECK(mw_checked >= 36); // 36 profiles carry this row; all must be conv 118

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
    CHECK(m1s_checked >= 4); // the 4 EPRA M1S valve-position rows

    // Catalog guard (#38): "Target Evap./Cond. Temp." at reg 0x10 offsets 6 and 8 uses conv 114
    // (signed LE ×0.1 with the 0x8000 no-data sentinel) in EVERY profile — never conv 105, which
    // publishes the 0x8000 idle marker as a real -3276.8 °C reading.
    int tgt_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x10 && (p.values[i].offset == 6 || p.values[i].offset == 8)) {
                CHECK(p.values[i].conv == 114);
                tgt_checked++;
            }
    CHECK(tgt_checked >= 80); // both offsets across ~44 profiles

    // Catalog guard (#37): reg 0x30 offset 2 is "Fan 2 (step)" (conv 211, size 1) where present —
    // never a size-2 field. A size-2 read there swallows the Fan 2 byte into the expansion-valve
    // count (Fan 2 dropped, valve fabricated). Expansion valve 1 lives at offset 3.
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x30 && p.values[i].offset == 2) CHECK(p.values[i].size == 1);

    // conv 310 = protection-retry counter, bits 4-6 ONLY (docs/REGISTERS.md §3.3). Page 0x10 bytes
    // 10-12 pack a drop-control flag (bit 7, conv 307), this counter (bits 4-6), a second drop flag
    // (bit 3, conv 303) and a second counter (bits 0-2, conv 311) into ONE byte, so an unmasked
    // read would publish a retry count of 1 as 149. This is UC5's core signal (issue #69 step 0.2).
    ValueDef      retry{0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty"};
    const uint8_t rt95[] = {0x95}; // 1001 0101: drop set, retry 1, low counter 5
    CHECK(convert(retry, rt95).ok && approx(convert(retry, rt95).value, 1.0));
    CHECK(approx(convert(ValueDef{0x10, 10, 311, 1, -1, "low"}, rt95).value,
                 5.0)); // same byte, other window
    const uint8_t rt70[] = {0x70};
    CHECK(approx(convert(retry, rt70).value, 7.0)); // full 3-bit range passes through
    const uint8_t rt8F[] = {0x8F};
    CHECK(approx(convert(retry, rt8F).value, 0.0)); // only bits OUTSIDE the window set -> 0
    const uint8_t rtFF[] = {0xFF};
    CHECK(approx(convert(retry, rtFF).value, 7.0)); // saturates at 7, never 255
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
                CHECK(v[i].type != 1); // never °C — see #36
                prot_checked++;
            }
    }
    // No longer vacuous: 11 supplement rows on every profile that reads page 0x10 (all 45).
    CHECK(prot_checked >= 11 * 45);

    // conv 311 = BUH output-capacity step, bits 0-2 ONLY. The upper bits belong to other fields,
    // so the whole byte must never be published: 0x85 is step 5, not 133.
    ValueDef      buh{0x63, 13, 311, 1, -1, "BUH output capacity"};
    const uint8_t buh85[] = {0x85};
    CHECK(convert(buh, buh85).ok && approx(convert(buh, buh85).value, 5.0));
    const uint8_t buh07[] = {0x07};
    CHECK(approx(convert(buh, buh07).value, 7.0)); // full 3-bit range passes through
    const uint8_t buhF8[] = {0xF8};
    CHECK(approx(convert(buh, buhF8).value, 0.0)); // only the high bits set -> step 0

    // Catalog guard: "BUH output capacity" at reg 0x63 offset 13 is the 3-bit conv 311 in EVERY
    // profile — never conv 152, which publishes the whole byte (0x85 -> 133 instead of 5).
    int buh_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x63 && p.values[i].offset == 13) {
                CHECK(p.values[i].conv == 311 && p.values[i].size == 1);
                buh_checked++;
            }
    CHECK(buh_checked >= 10); // 10 profiles carry this row; all must be conv 311

    // Catalog guard: "Ext. indoor ambient sensor (R6T)" sits at reg 0x61 offset 14. At offset 13 a
    // size-2 read straddles "Indoor ambient temp. (R1T)" [12..13], assembling R6T out of R1T's high
    // byte and R6T's low byte.
    int r6t_checked = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x61 &&
                std::string(p.values[i].label).find("(R6T)") != std::string::npos) {
                CHECK(p.values[i].offset == 14);
                r6t_checked++;
            }
    CHECK(r6t_checked >= 39); // 39 profiles carry this row; all at offset 14

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
                if (a.offset == b.offset) continue; // same start = dual view / variant
                const int a0 = a.offset, a1 = a.offset + a.size - 1;
                const int b0 = b.offset, b1 = b.offset + b.size - 1;
                CHECK(a1 < b0 || b1 < a0); // else: straddling collision
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
    c.rx_pin = 44;
    c.tx_pin = 43;
    std::string why;
    CHECK(validate(c, why));

    c.tx_pin = 44; // rx == tx
    CHECK(!validate(c, why));

    c.tx_pin = 99; // tx out of GPIO range (default max 48)
    CHECK(!validate(c, why));
    c.tx_pin = 43;
    CHECK(validate(c, why));

    c.syslog_host = "1.2.3.4";
    c.syslog_port = 0; // syslog port out of range
    CHECK(!validate(c, why));
    c.syslog_port = 65536; // syslog port out of range
    CHECK(!validate(c, why));
    c.syslog_port = 514; // valid syslog port
    CHECK(validate(c, why));
    c.syslog_host = ""; // reset to default

    // The HomeHub Modbus stack (issue #32). Checked unconditionally, so the defaults must still
    // pass on a device with no HomeHub and only a bad value trips. mb_host is free text — empty is
    // valid (that IS the disabled case).
    CHECK(c.mb_port == 502 && c.mb_unit_id == 1); // the defaults from MODBUS_TCP_PORT/UNIT
    CHECK(validate(c, why));                      // default (no address at all) is valid
    c.mb_host = "";
    CHECK(validate(c, why)); // empty host = no manual address, valid
    c.mb_host = "homehub-524288-example.local";
    CHECK(validate(c, why)); // an explicit .local host is fine
    c.mb_port = 0;
    CHECK(!validate(c, why)); // port out of range
    c.mb_port = 65536;
    CHECK(!validate(c, why));
    c.mb_port = 502;
    CHECK(validate(c, why));
    c.mb_unit_id = 0;
    CHECK(!validate(c, why)); // unit id out of the Modbus 1..247 range
    c.mb_unit_id = 248;
    CHECK(!validate(c, why));
    c.mb_unit_id = 1;
    CHECK(validate(c, why));
    c.mb_host = ""; // reset to default for the checks below

    // Fresh is the one automatic-search state. A completed empty decision is disabled forever; a
    // non-empty manual or discovered address is the exact polling target and never searches.
    Config m;
    CHECK(config_modbus_host(m).empty());
    CHECK(!config_modbus_enabled(m));
    CHECK(config_modbus_should_search(m));
    CHECK(!config_modbus_discovery_done_on_load(false, false, false));
    CHECK(config_modbus_discovery_done_on_load(true, false, false)); // pre-v18 safety migration
    CHECK(!config_modbus_discovery_done_on_load(true, true, false)); // v18 explicit pending
    CHECK(config_modbus_discovery_done_on_load(false, true, true));
    m.mb_discovery_done = true;
    CHECK(!config_modbus_should_search(m));
    m.mb_host = "192.0.2.137";
    CHECK(config_modbus_host(m) == "192.0.2.137");
    CHECK(config_modbus_enabled(m));
    CHECK(!config_modbus_should_search(m));
    m.mb_host = "192.0.2.131";
    CHECK(config_modbus_host(m) == "192.0.2.131");
    m.mb_host.clear();
    CHECK(config_modbus_host(m).empty());
    CHECK(!config_modbus_enabled(m));

    // Target-aware GPIO range: the ESP32-S3 default 44/43 is valid on a 48-GPIO target but must be
    // rejected on an ESP32-C3 (max GPIO 21), where those pins physically don't exist.
    CHECK(validate(c, why, 48));
    CHECK(!validate(c, why, 21));

    // The link pair rule on its own — config.cpp applies it to the pins coming back OUT of NVS,
    // where there is no Config to validate() and no reason string to report. rx_pin/tx_pin are two
    // independent NVS commits, so the pair that matters most is the one no request could have set:
    // a half-applied swap {44,43} -> {43,44} that leaves rx == tx.
    CHECK(link_pins_valid(44, 43));
    CHECK(link_pins_valid(43, 44));      // the swap is a legal link, just mirrored
    CHECK(!link_pins_valid(43, 43));     // half-applied swap: rx write through, tx not
    CHECK(!link_pins_valid(-1, 43));     // negative rx (NVS default miss)
    CHECK(!link_pins_valid(44, 99));     // tx above the range
    CHECK(!link_pins_valid(44, 43, 21)); // valid pair, wrong chip (S3 pins on a C3)
    // Agrees with validate() on the pair, since validate() defers to it.
    c.rx_pin = 43;
    c.tx_pin = 43;
    CHECK(!validate(c, why) && !link_pins_valid(c.rx_pin, c.tx_pin));
    c.rx_pin = 44;
    c.tx_pin = 43;
    CHECK(validate(c, why) && link_pins_valid(c.rx_pin, c.tx_pin));

    // Chip-reserved-pin rule (#103): a range-valid, DISTINCT pair is still an illegal link if
    // either pin is a pad this chip/build reserves — the hole that let a curl POST to /set_hp route
    // the X10A UART onto the SPI-flash pins and crash-loop the board. board_pin_offerable is the
    // membership test; link_pins_safe and validate both defer to it.
    CHECK(
        board_pin_offerable(44, /*octal*/ true, /*reserved*/ -1)); // the X10A default is offerable
    CHECK(board_pin_offerable(43, true, -1));
    CHECK(!board_pin_offerable(27, true, -1));           // GPIO27 = SPI flash — never offerable
    CHECK(!board_pin_offerable(0, true, -1));            // GPIO0  = strapping
    CHECK(!board_pin_offerable(19, true, -1));           // GPIO19 = USB-Serial/JTAG
    CHECK(board_pin_offerable(33, /*octal*/ false, -1)); // GPIO33 free on a Quad-SPI build
    CHECK(!board_pin_offerable(33, /*octal*/ true, -1)); // ...reserved on an Octal build
    CHECK(!board_pin_offerable(21, true, /*reserved*/ 21)); // the status-LED pin is claimed

    CHECK(link_pins_safe(44, 43, true, -1));               // the pair rule AND the reserved rule
    CHECK(!link_pins_safe(27, 43, true, -1));              // rx on flash
    CHECK(!link_pins_safe(44, 27, true, -1));              // tx on flash
    CHECK(!link_pins_safe(44, 44, true, -1));              // still catches rx == tx
    CHECK(!link_pins_safe(44, 21, true, /*reserved*/ 21)); // tx is the LED pin

    // validate() names WHICH pin is reserved (the device passes the real octal/reserved facts).
    c.rx_pin = 27;
    c.tx_pin = 43; // rx on SPI flash
    CHECK(!validate(c, why, 48, /*octal*/ true, /*reserved*/ -1));
    c.rx_pin = 44;
    c.tx_pin = 21; // tx is the status-LED pin
    CHECK(!validate(c, why, 48, true, /*reserved*/ 21));
    CHECK(validate(c, why, 48, true, /*reserved*/ -1)); // ...allowed when the LED is off
    c.rx_pin = 44;
    c.tx_pin = 43; // restore

    // ── Board-local hardware (POST /set_board) ───────────────────────────────────────────────────
    // Both pins are optional and default to absent; the button defaults to absent DELIBERATELY (an
    // unconfigured input floats, and a floating pin reading "pressed" would factory-reset a board
    // nobody touched), so a default Config must validate with both off.
    Config b;
    CHECK(b.led_gpio == -1 && b.btn_gpio == -1);
    CHECK(b.led_type == static_cast<int>(LedType::Gpio) && b.btn_active_low);
    CHECK(board_hw_valid(b, why, 48, /*octal*/ false));

    // The reference boards must both configure cleanly: XIAO (plain LED on 21, no button) and
    // AtomS3 Lite (WS2812 on 35, button on the JTAG pad 41).
    b.led_gpio     = 21;
    b.led_type     = static_cast<int>(LedType::Gpio);
    b.led_inverted = true;
    CHECK(board_hw_valid(b, why, 48, false));
    b.led_gpio = 35;
    b.led_type = static_cast<int>(LedType::Ws2812);
    b.btn_gpio = 41;
    CHECK(board_hw_valid(b, why, 48, /*octal*/ false));
    // ...but GPIO35 is genuinely unsafe on a build whose flash/PSRAM run Octal I/O.
    CHECK(!board_hw_valid(b, why, 48, /*octal*/ true));

    b.led_gpio = 35;
    b.btn_gpio = 41;
    CHECK(!board_hw_valid(b, why, 21, false)); // pins don't exist on a 21-GPIO target
    b.led_type = 7;
    CHECK(!board_hw_valid(b, why, 48, false)); // unknown driver id
    b.led_type = static_cast<int>(LedType::Ws2812);

    // Hard chip conflicts are refused for a local LED too — the wider local-I/O set adds ONLY the
    // dedicated-JTAG pads, not flash or the USB console.
    b.led_gpio = 27;
    CHECK(!board_hw_valid(b, why, 48, false)); // SPI flash
    b.led_gpio = 19;
    CHECK(!board_hw_valid(b, why, 48, false)); // USB-Serial/JTAG console
    b.led_gpio = 35;

    // No pin may be claimed twice, in EITHER direction — whichever endpoint is called second has to
    // see the other's pins, or /set_board and /set_hp would happily hand the same GPIO to both.
    b.btn_gpio = 35;
    CHECK(!board_hw_valid(b, why, 48, false)); // button == indicator
    b.btn_gpio = 41;
    b.rx_pin   = 35; // X10A already owns the indicator's pin
    CHECK(!board_hw_valid(b, why, 48, false));
    b.rx_pin = 44;
    b.tx_pin = 41; // ...and the button's
    CHECK(!board_hw_valid(b, why, 48, false));
    b.tx_pin = 43;
    CHECK(board_hw_valid(b, why, 48, false));
    // The mirror image: with the indicator + button configured, /set_hp must not be able to take
    // their pins. config_reserved_pins is the one accessor both sides read.
    CHECK(config_reserved_pins(b).claims(35) && config_reserved_pins(b).claims(41));
    // ...and the mirror accessor names the OTHER pair, for the LED/button pickers. Two factories,
    // one anonymous two-slot struct: which pins are spoken for is stated at the call site.
    CHECK(config_link_pins(b).claims(44) && config_link_pins(b).claims(43));
    CHECK(config_link_pins(b).claims(44) && config_link_pins(b).claims(43));
    CHECK(!config_link_pins(b).claims(35) && !config_link_pins(b).claims(-1));
    Config steal = b;
    steal.rx_pin = 35; // try to route X10A RX onto the LED
    CHECK(!validate(steal, why, 48, false, config_reserved_pins(b)));
    steal.rx_pin = 44;
    steal.tx_pin = 41; // ...or TX onto the button
    CHECK(!validate(steal, why, 48, false, config_reserved_pins(b)));
    steal.tx_pin = 43;
    CHECK(validate(steal, why, 48, false, config_reserved_pins(b)));
    // With no board hardware configured, both pins are free again.
    Config none;
    none.rx_pin = 35;
    none.tx_pin = 41;
    CHECK(!config_reserved_pins(none).claims(0) && !config_reserved_pins(none).claims(21));
    CHECK(!validate(none, why, 48, false,
                    config_reserved_pins(none))); // 41 is JTAG: never an X10A pin
    none.tx_pin = 43;
    CHECK(validate(none, why, 48, false, config_reserved_pins(none))); // 35 is fine on a Quad build

    // ── What POST /set_board owes a request (#257) ──────────────────────────────────────────────
    // Two facts move independently, so all four combinations are asserted. The one that shipped
    // broken is `values same, statement new`: it is a SAVE with NO reboot, and collapsing it into
    // "nothing changed" dropped the statement — the modal then re-opened on "Custom" and the user
    // re-picked their own board forever, each time getting no reboot and one grey toast.
    Config stored; // a device still carrying the build defaults
    stored.led_gpio       = 21;
    stored.led_type       = static_cast<int>(LedType::Gpio);
    stored.led_inverted   = true;
    stored.btn_gpio       = -1;
    stored.btn_active_low = true;
    stored.board_user_set = false;
    Config want           = stored; // the user picks the preset the device already carries
    want.board_user_set   = true;   // ...which the submit itself states
    want.board_preset_id  = BoardPresetId::SeeedXiaoEsp32S3;
    CHECK(board_hw_same(want, stored));
    CHECK(board_save_needed(want, stored));    // the statement is new -> persist it
    CHECK(!board_reboot_needed(want, stored)); // ...but no driver's pin moved -> no reboot
    // Once recorded, the same submit really is a no-op: neither a save nor a reboot.
    Config recorded = want;
    CHECK(!board_save_needed(want, recorded));
    CHECK(!board_reboot_needed(want, recorded));
    // A hardware change is both, whether or not the statement was already on record.
    Config atom          = want;
    atom.board_preset_id = BoardPresetId::M5StackAtomS3Lite;
    atom.led_gpio        = 35;
    atom.led_type        = static_cast<int>(LedType::Ws2812);
    atom.led_inverted    = false;
    atom.btn_gpio        = 41;
    CHECK(!board_hw_same(atom, recorded));
    CHECK(board_save_needed(atom, recorded) && board_reboot_needed(atom, recorded));
    CHECK(board_save_needed(atom, stored) && board_reboot_needed(atom, stored));
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
    // Identity moves independently from hardware: explicit Custom is saved without a reboot, and
    // untouched defaults remain unnamed even when their hardware happens to match XIAO.
    Config custom          = recorded;
    custom.board_preset_id = BoardPresetId::Custom;
    CHECK(board_save_needed(custom, recorded) && !board_reboot_needed(custom, recorded));
    CHECK(!Config{}.board_user_set && Config{}.board_preset_id == BoardPresetId::Custom);

    CHECK(parse_protocol("S") == Protocol::S);
    CHECK(parse_protocol("I") == Protocol::I);
    CHECK(parse_protocol("") == Protocol::I);

    // WiFi credential validation (POST /set_wifi): SSID 1..32, password empty (open) or 8..63.
    std::string wr;
    CHECK(wifi_credentials_valid("MyNet", "", wr));              // open network, ok
    CHECK(wifi_credentials_valid("MyNet", "hunter22", wr));      // 8-char password, ok
    CHECK(wifi_credentials_valid(std::string(32, 'x'), "", wr)); // 32-char SSID boundary, ok
    CHECK(
        wifi_credentials_valid("MyNet", std::string(63, 'p'), wr)); // 63-char password boundary, ok
    CHECK(!wifi_credentials_valid("", "password", wr));             // empty SSID rejected
    CHECK(!wifi_credentials_valid(std::string(33, 'x'), "", wr));   // 33-char SSID rejected
    CHECK(!wifi_credentials_valid("MyNet", "short", wr));           // <8-char password rejected
    CHECK(!wifi_credentials_valid("MyNet", std::string(64, 'p'), wr)); // >63-char password rejected

    // /set_hp fingerprint rule: a partial live update (no "profile" key) never clears the cached
    // detection, whatever the stored profile is; only an explicit "auto" does; a manual pin
    // doesn't.
    CHECK(!set_hp_clears_fingerprint(false, "auto"));          // wiring-only patch (no "profile")
    CHECK(!set_hp_clears_fingerprint(false, "altherma_gshp")); // partial update on a pinned model
    CHECK(set_hp_clears_fingerprint(true, "auto"));            // explicit re-detect / wiring Save
    CHECK(!set_hp_clears_fingerprint(true, "altherma_gshp"));  // manual pin keeps the fingerprint
    CHECK(!set_hp_resets_checkup(false, 44, 43, 44, 43));      // HomeHub-only update
    CHECK(set_hp_resets_checkup(true, 44, 43, 44, 43));        // explicit profile/re-detect
    CHECK(set_hp_resets_checkup(false, 44, 43, 18, 17));       // physically different X10A link
    CHECK(!set_hp_updates_x10a(false, false, false));          // HomeHub host update/clear only
    CHECK(set_hp_updates_x10a(true, false, false));            // explicit profile statement
    CHECK(set_hp_updates_x10a(false, true, false));            // RX-only raw patch
    CHECK(set_hp_updates_x10a(false, false, true));            // TX-only raw patch
    CHECK(set_hp_update_domains_compatible(true, false));      // X10A owns its link-cache result
    CHECK(set_hp_update_domains_compatible(false, true));      // HomeHub owns the blob result
    CHECK(set_hp_update_domains_compatible(false, false));     // no-op remains harmless
    CHECK(!set_hp_update_domains_compatible(true, true));      // no partial cross-domain save
    CHECK(!homehub_history_identity_changed("hub.local", 502, 1, "hub.local", 502, 1));
    CHECK(homehub_history_identity_changed("hub-a.local", 502, 1, "hub-b.local", 502, 1));
    CHECK(homehub_history_identity_changed("hub.local", 502, 1, "hub.local", 1502, 1));
    CHECK(homehub_history_identity_changed("hub.local", 502, 1, "hub.local", 502, 2));

    // Field-owned detection commits. The poll task snapshots the config, probes the bus for a whole
    // sweep, then commits — so anything it writes beyond its OWN fields is written from a snapshot
    // that may predate a /set_wifi. These patch in place and must touch nothing else.
    Config live;                  // stand-in for the live config
    live.wifi_ssid   = "new-net"; // as if POST /set_wifi landed mid-sweep
    live.wifi_pass   = "new-secret";
    live.mqtt_uri    = "mqtts://broker.lan";
    live.syslog_host = "logs.lan";
    live.rx_pin      = 44;
    live.tx_pin      = 43;
    live.proto       = Protocol::I;

    apply_link(live, 16, 17, Protocol::S); // detection found the wire swapped
    CHECK(live.rx_pin == 16 && live.tx_pin == 17 && live.proto == Protocol::S);
    CHECK(live.wifi_ssid == "new-net"); // #49: the credentials must survive the commit
    CHECK(live.wifi_pass == "new-secret");
    CHECK(live.mqtt_uri == "mqtts://broker.lan");
    CHECK(live.syslog_host == "logs.lan");
    CHECK(live.profile == "auto"); // link patch leaves the model alone

    // "altherma3_r_erga" is >15 chars: past libstdc++'s SSO buffer, so this is the case that would
    // heap-allocate if apply_model copied instead of swapping (config.cpp calls it under the
    // mutex).
    apply_model(live, "altherma3_r_erga", 0x5u, -1, 80, "1234");
    CHECK(live.profile == "altherma3_r_erga");
    CHECK(live.fp_pages == 0x5u && live.fp_eeprom == "1234");
    CHECK(live.fp_valid); // a committed model is always valid
    // The two capacities are carried SEPARATELY and neither stands in for the other. This is the
    // real shape of a unit with a short 0x00 descriptor (no O/U capacity at all) beside an indoor
    // unit that does report 8.0 kW. Folding the I/U code into fp_kw_tenths would publish the indoor
    // unit's size as the outdoor unit's — wrong for any plant whose halves differ, e.g. a 6 kW
    // outdoor unit under an 8 kW indoor unit, which is an ordinary pairing.
    CHECK(live.fp_kw_tenths == -1 && live.fp_iu_kw_tenths == 80);
    apply_model(live, "altherma3_r_erga", 0x5u, 60, 80, "1234");
    CHECK(live.fp_kw_tenths == 60 && live.fp_iu_kw_tenths == 80); // both kept, both distinct
    CHECK(live.rx_pin == 16 && live.tx_pin == 17); // model patch leaves the link alone
    CHECK(live.wifi_ssid == "new-net");            // ...and the credentials
    CHECK(live.mqtt_uri == "mqtts://broker.lan");
}

// The HA installation DEVICE identity (logic/ha_device.hpp). The one property that matters: it is a
// pure function of the MQTT base topic and contains nothing board-specific — replacing the ESP32
// must keep the X10A device in HA (and with it the entities, their history and their statistics),
// which the old MAC-derived node id could not do.
static void test_ha_device() {
    CHECK(device_node_id("daikin-altherma-esp32") == "daikin_altherma_esp32");
    CHECK(device_node_id("home/heating/daikin altherma") == "home_heating_daikin_altherma");
    CHECK(device_node_id("Daikin_2") == "daikin_2");
    // A base topic that slugifies to nothing must still yield a usable discovery-topic segment —
    // an empty node would produce "homeassistant/sensor//x/config", which HA silently ignores.
    CHECK(device_node_id("///") == "daikin");
    CHECK(device_node_id("") == "daikin");
    // Two base topics stay two devices (that is how a second installation is separated), one base
    // topic stays one device no matter which hardware or source publishes it.
    CHECK(device_node_id("daikin-altherma-esp32") != device_node_id("daikin-altherma-esp32-2"));

    // The device block: stable id FIRST (the anchor HA matches on after a swap), board id second.
    CHECK(device_json("daikin_altherma_esp32", "daikin_abc123") ==
          "\"dev\":{\"ids\":[\"daikin_altherma_esp32\",\"daikin_abc123\"],"
          "\"name\":\"Daikin Altherma\",\"mf\":\"Daikin\","
          "\"mdl\":\"Altherma X10A\"}");
    // No board id, or a board id that IS the node id -> a single identifier. A duplicated entry
    // would be a malformed device for HA, not a harmless repeat.
    CHECK(device_json("daikin_altherma_esp32", "").find("\"ids\":[\"daikin_altherma_esp32\"],") !=
          std::string::npos);
    CHECK(device_json("daikin_x", "daikin_x").find("\"ids\":[\"daikin_x\"],") != std::string::npos);

    // All FOUR discovery surfaces must describe the same device — values, board diagnostics, the
    // crash entity and ENV III. A dev block that drifted between them would split the board across
    // two HA devices again, which is the failure this identity exists to remove.
    const std::string node = device_node_id("daikin-altherma-esp32"), brd = "daikin_abc123";
    const std::string dev = device_json(node, brd);
    ValueDef          v{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    CHECK(discovery_config(node, brd, "s", "a", v).find(dev) != std::string::npos);
    CHECK(heartbeat_discovery_config(node, brd, "s", "a", HEARTBEAT_SENSORS[0]).find(dev) !=
          std::string::npos);
    CHECK(crash_discovery_config(node, brd, "s", "a", CRASH_SENSORS[0]).find(dev) !=
          std::string::npos);
    CHECK(env3_discovery_config(node, brd, "env", "a", ENV3_HA_SENSORS[0]).find(dev) !=
          std::string::npos);

    // The retired Modbus namespace stays frozen so an upgrade can delete the exact retained topics.
    // It is not a live discovery surface and therefore has no device/config payload builder.
    CHECK(modbus_entity_node_id(node) == "daikin_altherma_esp32_modbus");
}

static void test_discovery() {
    CHECK(object_id("DHW Tank Temp (R5T)") == "dhw_tank_temp_r5t");
    CHECK(object_id("  A/B  ") == "a_b");

    ValueDef          def{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    const std::string base  = "daikin-altherma-esp32";
    const std::string node  = device_node_id(base); // the INSTALLATION — survives a board swap
    const std::string board = "daikin_abc123";      // this board's own MAC-derived id
    CHECK(node == "daikin_altherma_esp32");
    const std::string st = x10a_topic(base);   // shared by the X10A sensors only
    CHECK(st == "daikin-altherma-esp32/x10a"); // node NOT in the message topic (one board/base)
    CHECK(modbus_topic(base) == "daikin-altherma-esp32/modbus");
    CHECK(env3_topic(base) == "daikin-altherma-esp32/env3");
    CHECK(ENV3_HA_SENSOR_COUNT == 3);
    CHECK(env3_discovery_topic("homeassistant", node, ENV3_HA_SENSORS[0]) ==
          "homeassistant/sensor/daikin_altherma_esp32/env3_temperature/config");
    CHECK(env3_discovery_topic("homeassistant", node, ENV3_HA_SENSORS[1]) ==
          "homeassistant/sensor/daikin_altherma_esp32/env3_humidity/config");
    CHECK(env3_discovery_topic("homeassistant", node, ENV3_HA_SENSORS[2]) ==
          "homeassistant/sensor/daikin_altherma_esp32/env3_pressure/config");
    for (size_t i = 0; i < ENV3_HA_SENSOR_COUNT; ++i) {
        const Env3HaSensor& sensor = ENV3_HA_SENSORS[i];
        const std::string   env_cfg =
            env3_discovery_config(node, board, env3_topic(base), availability_topic(base), sensor);
        CHECK(env_cfg.find(std::string("\"uniq_id\":\"") + node + "_" + sensor.object_id + "\"") !=
              std::string::npos);
        CHECK(env_cfg.find("\"stat_t\":\"daikin-altherma-esp32/env3\"") != std::string::npos);
        CHECK(env_cfg.find(std::string("value_json.get('") + sensor.json_key + "')") !=
              std::string::npos);
        CHECK(env_cfg.find("\"availability_mode\":\"all\"") != std::string::npos);
        CHECK(env_cfg.find("{\"topic\":\"daikin-altherma-esp32/status\"}") != std::string::npos);
        CHECK(env_cfg.find("{\"topic\":\"daikin-altherma-esp32/env3\",\"value_template\":") !=
              std::string::npos);
        CHECK(env_cfg.find("is number else 'offline'") != std::string::npos);
        CHECK(env_cfg.find(std::string("\"unit_of_meas\":\"") + sensor.unit + "\"") !=
              std::string::npos);
        CHECK(env_cfg.find(std::string("\"dev_cla\":\"") + sensor.device_class + "\"") !=
              std::string::npos);
        CHECK(env_cfg.find("\"stat_cla\":\"measurement\"") != std::string::npos);
    }
    const std::string retired_status = retired_modbus_status_topic(base);
    CHECK(retired_status == "daikin-altherma-esp32/modbus/status");
    CHECK(legacy_state_topic(base) == "daikin-altherma-esp32/state");
    const std::string legacy = legacy_state_topic(base);
    CHECK(retained_cleanup_candidate(legacy, legacy.data(), static_cast<int>(legacy.size()), true,
                                     123, 0));
    CHECK(retained_cleanup_candidate(retired_status, retired_status.data(),
                                     static_cast<int>(retired_status.size()), true, 7, 0));
    const std::string crash = crash_topic(base);
    CHECK(retained_cleanup_candidate(crash, crash.data(), static_cast<int>(crash.size()), true, 42,
                                     0));
    CHECK(!retained_cleanup_candidate(legacy, legacy.data(), static_cast<int>(legacy.size()), false,
                                      123, 0)); // live message, not retained
    CHECK(!retained_cleanup_candidate(legacy, legacy.data(), static_cast<int>(legacy.size()), true,
                                      0, 0)); // tombstone echo
    CHECK(!retained_cleanup_candidate(legacy, legacy.data(), static_cast<int>(legacy.size()), true,
                                      123, 64)); // later payload fragment
    const std::string legacy_child = legacy + "/child";
    CHECK(!retained_cleanup_candidate(legacy, legacy_child.data(),
                                      static_cast<int>(legacy_child.size()), true, 123, 0));
    CHECK(!retained_cleanup_candidate(legacy, nullptr, 0, true, 123, 0));
    CHECK(!retained_cleanup_candidate(retired_status, legacy.data(),
                                      static_cast<int>(legacy.size()), true, 123, 0));
    CHECK(availability_topic(base) == "daikin-altherma-esp32/status");
    std::string cfg = discovery_config(node, board, st, availability_topic(base), def);
    CHECK(cfg.find("\"dev_cla\":\"temperature\"") != std::string::npos);
    CHECK(cfg.find("\"stat_cla\":\"measurement\"") != std::string::npos);
    CHECK(cfg.find("\"unit_of_meas\":\"°C\"") != std::string::npos);
    CHECK(cfg.find("\"stat_t\":\"daikin-altherma-esp32/x10a\"") != std::string::npos);
    CHECK(cfg.find("\"avty_t\":\"daikin-altherma-esp32/status\"") != std::string::npos);
    // Shared JSON topic -> value_template subscripts group (page 0x61 -> hydronic_temps) + object.
    CHECK(cfg.find("\"val_tpl\":\"{{ value_json['hydronic_temps']['dhw_tank_temp_r5t'] }}\"") !=
          std::string::npos);
    // The node id identifies the DEVICE in uniq_id/dev.ids — just not in the message topic. It is
    // the BASE-TOPIC id, so a replacement board publishes the same unique_ids and HA keeps the
    // entities (and their statistics) instead of starting a second device from scratch.
    //
    // The entity id also carries the row's register GROUP (#221) — unlike the val_tpl KEY above,
    // which must not change (it is the state contract and the VictoriaMetrics series suffix, #217).
    CHECK(cfg.find("\"uniq_id\":\"daikin_altherma_esp32_hydronic_temps_dhw_tank_temp_r5t\"") !=
          std::string::npos);
    CHECK(cfg.find("\"uniq_id\":\"daikin_abc123") == std::string::npos);
    // An UNAMBIGUOUS label is not renamed. Load-bearing: HA derives the default entity_id from the
    // name, so rewriting every name would strand every entity's recorder history — only the handful
    // of labels the catalog reuses across pages are group-qualified (AMBIGUOUS_LABEL_SLUGS).
    CHECK(cfg.find("\"name\":\"DHW Tank Temp (R5T)\"") != std::string::npos);
    // …and the board id rides along as a SECOND device identifier: HA matches a device by any of
    // them, so an install set up under the old MAC-only identity is merged, not duplicated.
    CHECK(cfg.find("\"dev\":{\"ids\":[\"daikin_altherma_esp32\",\"daikin_abc123\"]") !=
          std::string::npos);

    // A non-binary row keeps the sensor component and carries no binary payload contract.
    CHECK(std::string(ha_component(def)) == "sensor");
    CHECK(discovery_topic("homeassistant", node, def) ==
          "homeassistant/sensor/daikin_altherma_esp32/hydronic_temps_dhw_tank_temp_r5t/config");
    // The same builder with the BOARD id yields the MAC-era topic the bridge retracts on the first
    // announce after an upgrade — the only configs a board can clean up are the ones it published.
    CHECK(discovery_topic("homeassistant", board, def) ==
          "homeassistant/sensor/daikin_abc123/hydronic_temps_dhw_tank_temp_r5t/config");
    CHECK(cfg.find("\"pl_on\"") == std::string::npos);

    // --- Bit-flag rows are binary_sensors reading 1/0, not text sensors reading "ON"/"OFF" ---
    // A slug that starts with a digit must stay valid — bracket notation, not attribute access.
    ValueDef    way{0x60, 12, 307, 1, -1, "2way valve(On:Heat_Off:Cool)"};
    std::string wc = discovery_config(node, board, st, availability_topic(base), way);
    CHECK(wc.find("value_json['hydronic']['2way_valve_on_heat_off_cool']") != std::string::npos);

    CHECK(std::string(ha_component(way)) == "binary_sensor");
    CHECK(discovery_topic("homeassistant", node, way) ==
          "homeassistant/binary_sensor/daikin_altherma_esp32/"
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
    CHECK(ungrouped_discovery_topic("homeassistant", node, "sensor", way) ==
          "homeassistant/sensor/daikin_altherma_esp32/2way_valve_on_heat_off_cool/config");
    CHECK(ungrouped_discovery_topic("homeassistant", node, "binary_sensor", way) ==
          "homeassistant/binary_sensor/daikin_altherma_esp32/2way_valve_on_heat_off_cool/config");
    // …and now a NON-binary row has a stale shape to retract too. Before #221 it did not — the
    // "old" topic WAS the current one, which is precisely why the two Error Code rows shared it.
    // This one line is the fix.
    CHECK(ungrouped_discovery_topic("homeassistant", node, "sensor", def) !=
          discovery_topic("homeassistant", node, def));

    // --- #221: two rows, one label, two register pages -> two entities, not one ------------------
    // The real colliding pair, on the profile the live unit detects as. Before the fix these were
    // announced under ONE uniq_id on ONE topic, so HA created a single "Error Code" entity and a
    // unit reporting both an outdoor and a hydronic fault showed one of them — with no error
    // anywhere, since the state payload was correct throughout.
    ValueDef ou_err{0x10, 5, 204, 1, -1, "Error Code"};
    ValueDef hy_err{0x60, 3, 204, 1, -1, "Error Code"};
    CHECK(object_id(ou_err.label) == object_id(hy_err.label)); // the labels DO collide...
    CHECK(discovery_topic("homeassistant", node, ou_err)       // ...the entities do not
          != discovery_topic("homeassistant", node, hy_err));
    const std::string oc = discovery_config(node, board, st, availability_topic(base), ou_err);
    const std::string hc = discovery_config(node, board, st, availability_topic(base), hy_err);
    CHECK(oc.find("\"uniq_id\":\"daikin_altherma_esp32_outdoor_state_error_code\"") !=
          std::string::npos);
    CHECK(hc.find("\"uniq_id\":\"daikin_altherma_esp32_hydronic_error_code\"") !=
          std::string::npos);
    // Distinct NAMES too, or HA derives one entity_id from both and the second lands as `..._2` —
    // the outcome this issue exists to avoid. This label is on AMBIGUOUS_LABEL_SLUGS for that
    // reason.
    CHECK(oc.find("\"name\":\"Outdoor State Error Code\"") != std::string::npos);
    CHECK(hc.find("\"name\":\"Hydronic Error Code\"") != std::string::npos);
    // The STATE contract is untouched: same key, each already in its own group object (#217).
    CHECK(oc.find("value_json['outdoor_state']['error_code']") != std::string::npos);
    CHECK(hc.find("value_json['hydronic']['error_code']") != std::string::npos);

    // --- HomeHub MQTT remains, but its exact historical 27-entity HA set is retired. ------------
    // Pin the complete broker ledger independently of today's larger HomeHub register catalog.
    // This duplicate list is intentional test evidence: deriving expectations from production's
    // ledger would let a moved/added cleanup target make both implementation and test green.
    static constexpr const char* expected_retired_modbus_topics[] = {
        "sensor/daikin_altherma_esp32_modbus/unit_abnormality",
        "sensor/daikin_altherma_esp32_modbus/unit_abnormality_code",
        "sensor/daikin_altherma_esp32_modbus/unit_abnormality_sub_code",
        "binary_sensor/daikin_altherma_esp32_modbus/circulation_pump_running",
        "sensor/daikin_altherma_esp32_modbus/3_way_valve",
        "binary_sensor/daikin_altherma_esp32_modbus/dhw_normal_operation",
        "binary_sensor/daikin_altherma_esp32_modbus/space_heating_cooling_normal_operation",
        "sensor/daikin_altherma_esp32_modbus/leaving_water_temperature_phe",
        "sensor/daikin_altherma_esp32_modbus/leaving_water_temperature_buh",
        "sensor/daikin_altherma_esp32_modbus/return_water_temperature",
        "sensor/daikin_altherma_esp32_modbus/domestic_hot_water_temperature",
        "sensor/daikin_altherma_esp32_modbus/outside_air_temperature",
        "sensor/daikin_altherma_esp32_modbus/liquid_refrigerant_temperature",
        "sensor/daikin_altherma_esp32_modbus/remote_controller_room_temperature_main",
        "sensor/daikin_altherma_esp32_modbus/flow_rate",
        "sensor/daikin_altherma_esp32_modbus/heat_pump_power_consumption",
        "sensor/daikin_altherma_esp32_modbus/leaving_water_main_heating_setpoint",
        "sensor/daikin_altherma_esp32_modbus/leaving_water_main_cooling_setpoint",
        "sensor/daikin_altherma_esp32_modbus/operation_mode",
        "binary_sensor/daikin_altherma_esp32_modbus/space_heating_cooling_on_off",
        "sensor/daikin_altherma_esp32_modbus/room_thermostat_control_heating_setpoint_main",
        "sensor/daikin_altherma_esp32_modbus/room_thermostat_control_cooling_setpoint_main",
        "binary_sensor/daikin_altherma_esp32_modbus/quiet_mode_operation",
        "sensor/daikin_altherma_esp32_modbus/dhw_reheat_setpoint",
        "sensor/daikin_altherma_esp32_modbus/smart_grid_operation_mode",
        "sensor/daikin_altherma_esp32_modbus/power_limit_during_recommended_on_buffering",
        "sensor/daikin_altherma_esp32_modbus/general_power_limit",
    };
    constexpr size_t expected_retired_modbus_count =
        sizeof(expected_retired_modbus_topics) / sizeof(expected_retired_modbus_topics[0]);
    CHECK(RETIRED_MODBUS_HA_SENSOR_COUNT == 27);
    CHECK(expected_retired_modbus_count == static_cast<size_t>(RETIRED_MODBUS_HA_SENSOR_COUNT));
    CHECK(def::HOMEHUB_REG_COUNT > RETIRED_MODBUS_HA_SENSOR_COUNT);
    for (int i = 0; i < RETIRED_MODBUS_HA_SENSOR_COUNT; ++i) {
        const std::string topic =
            retired_modbus_discovery_topic("homeassistant", node, RETIRED_MODBUS_HA_SENSORS[i]);
        CHECK(topic ==
              std::string("homeassistant/") + expected_retired_modbus_topics[i] + "/config");
    }
    // Rows added after retirement never had an HA config, so the ledger must not tombstone them.
    for (const char* never_published :
         {"compressor_running", "booster_heater_run", "disinfection_operation",
          "current_operation_mode", "leaving_water_main_heating_offset"}) {
        bool found = false;
        for (const RetiredModbusHaSensor& sensor : RETIRED_MODBUS_HA_SENSORS)
            found = found || std::strcmp(sensor.object_id, never_published) == 0;
        CHECK(!found);
    }

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
            const uint8_t bit      = static_cast<uint8_t>(1u << (d.conv - 300));
            const uint8_t set_byte = bit, clear_byte = static_cast<uint8_t>(~bit);
            Reading       on  = convert(d, &set_byte);
            Reading       off = convert(d, &clear_byte);
            CHECK(on.ok && off.ok);
            CHECK(on.text[0] == '\0' && off.text[0] == '\0');
            CHECK(approx(on.value, 1.0));
            CHECK(approx(off.value, 0.0));
            // ...and 1/0 must land in the state JSON UNQUOTED, or a metrics consumer drops it
            // again.
            CHECK(build_grouped_json({{"test", "flag", on.value ? "1" : "0"}}) ==
                  "{\"test\":{\"flag\":1}}");
            CHECK(build_grouped_json({{"test", "flag", off.value ? "1" : "0"}}) ==
                  "{\"test\":{\"flag\":0}}");
            CHECK(std::string(ha_component(d)) == "binary_sensor");
            const std::string cfg =
                discovery_config("daikin_test", "daikin_board", "daikin/x10a", "daikin/status", d);
            CHECK(cfg.find("\"pl_on\":\"1\",\"pl_off\":\"0\"") != std::string::npos);
            CHECK(discovery_topic("homeassistant", "daikin_test", d) ==
                  "homeassistant/binary_sensor/daikin_test/" + row_object_id(d) + "/config");
            checked++;
        }
    }
    CHECK(checked > 500); // ~30 binary rows x 44 profiles — the catalog really was traversed
    // Publication guard for a future enum that might decode to these exact words.
    CHECK(std::string(on_off_number("ON")) == "1");
    CHECK(std::string(on_off_number("OFF")) == "0");
    CHECK(on_off_number("Heating") == nullptr);
    CHECK(on_off_number("on") == nullptr);
    CHECK(on_off_number(nullptr) == nullptr);
}

// The few bit rows whose 0/1 selects a named state must be identifiable without consulting their
// generated English labels. All other bits remain ordinary ON/OFF flags. The catalog traversal pins
// both sides: every semantic id resolves only to its intended structural row, and every occurrence
// of those rows in all shipped profiles is covered.
static void test_binary_semantics() {
    CHECK(std::string(logic::binary_semantic_for(0x60, 12, 306)) == "valve_dhw");
    CHECK(std::string(logic::binary_semantic_for(0x60, 12, 307)) == "valve_heat");
    CHECK(std::string(logic::binary_semantic_for(0x60, 11, 301)) == "smart_grid_contact_1");
    CHECK(std::string(logic::binary_semantic_for(0x60, 11, 302)) == "smart_grid_contact_2");
    CHECK(logic::binary_semantic_for(0x60, 12, 305) == nullptr); // BSH polarity is undocumented
    CHECK(logic::binary_semantic_for(0x62, 2, 303) == nullptr);  // ordinary activity flag
    CHECK(logic::binary_semantic_for(0x60, 11, 303) == nullptr);

    int valve_dhw = 0, valve_heat = 0, contact_1 = 0, contact_2 = 0, semantic_rows = 0;
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < p.count; i++) {
            const ValueDef& d        = p.values[i];
            const char*     semantic = logic::binary_semantic_for(d.reg, d.offset, d.conv);
            if (!semantic) continue;
            CHECK(conv_is_binary(d.conv));
            semantic_rows++;
            const std::string id(semantic);
            if (id == "valve_dhw") {
                CHECK(std::string(d.label) == "3way valve(On:DHW_Off:Space)");
                valve_dhw++;
            } else if (id == "valve_heat") {
                CHECK(std::string(d.label) == "2way valve(On:Heat_Off:Cool)");
                valve_heat++;
            } else if (id == "smart_grid_contact_1") {
                CHECK(std::string(d.label) == "SmartGridContact1");
                contact_1++;
            } else if (id == "smart_grid_contact_2") {
                CHECK(std::string(d.label) == "SmartGridContact2");
                contact_2++;
            } else {
                CHECK(false);
            }
        }
    }
    CHECK(valve_dhw == 44);
    CHECK(valve_heat == 44);
    CHECK(contact_1 == 16);
    CHECK(contact_2 == 16);
    CHECK(semantic_rows == 120);
}

// is_refrigerant_pressure() across the SHIPPED catalog. The production rule is STRUCTURAL (outdoor
// page, or a conv-405 saturation twin) and must never consult the label — an alias or a translation
// would flip it. The TEST is allowed to know exactly what the rule must not depend on: it uses the
// label as an independent oracle to prove the structural rule agrees with reality.
//
// The load-bearing assertion is the NEGATIVE one. A false positive here withholds a legitimate
// 0-bar reading from a drained water circuit — inventing missing data — which is worse than the
// 0-bar refrigerant reading the filter exists to suppress. So: no row that names itself water may
// ever be classified refrigerant, on any profile, by either signal.
static void test_refrigerant_pressure_catalog() {
    int refrig = 0, water = 0, outdoor = 0;
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < p.count; i++) {
            const ValueDef& d = p.values[i];
            if (d.type != 2) continue; // bar rows only
            std::string lbl;
            for (const char* c = d.label; c && *c; c++) lbl += static_cast<char>(std::tolower(*c));
            const bool names_water = lbl.find("water") != std::string::npos;
            const bool flagged     = is_refrigerant_pressure(d, p.values, p.count);
            if (names_water) {
                CHECK(!flagged);
                water++;
            } // <- the one that must never fail
            if (flagged) refrig++;
            // Every bar row on an outdoor page is refrigerant by the page signal alone, profile or
            // no profile: there is no water circuit in the outdoor unit.
            if (d.reg == 0x20 || d.reg == 0x21 || d.reg == 0xA0 || d.reg == 0xA1) {
                CHECK(flagged);
                CHECK(is_refrigerant_pressure(d, nullptr, 0));
                outdoor++;
            }
        }
    }
    // Traversal proof + coverage floor, so a regression that quietly stops classifying anything
    // (or stops finding the catalog at all) fails here instead of passing silently.
    CHECK(water >= 40);   // ~44 water-pressure rows across the catalog
    CHECK(outdoor >= 80); // ~85 outdoor bar rows
    CHECK(refrig >= 90);  // outdoor + the 0x62 rows a 405 twin reaches
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
// valve pointing at space heating — every one was a DHW charge, drawn as a room demanding heat
// while the room sat exactly on its setpoint. A physically true reading attributed to the wrong
// component: the #35-#39 shape, which no converter, unit or spec check can catch because nothing
// about the VALUE is wrong. The branch's own request is "Space heating Operation ON/OFF" (0x62/2
// bit 3), and that is what the pill draws now.
//
// docs/REGISTERS.md §5 documents a SECOND "Thermostat ON/OFF" — page 0x10 offset 1 bit 7, the
// outdoor unit's own — and the reference profile now publishes it. `/values` qualifies both reused
// labels by their page group; the status inspector structurally selects `hydronic`, while the value
// list exposes both. This test pins the two distinct locators so a later first-label-wins refactor
// cannot silently attribute the outdoor flag to the indoor unit again.
static void test_demand_flag_catalog() {
    int indoor_thermostat = 0, outdoor_thermostat = 0, space_heating = 0;
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p); // the rows a consumer actually sees
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef& d = v[i];
            std::string     lbl;
            for (const char* c = d.label; c && *c; c++) lbl += static_cast<char>(std::tolower(*c));
            if (lbl.rfind("thermostat on", 0) == 0) { // the JS matches /thermostat on/i
                if (d.reg == 0x60) {
                    CHECK(d.offset == 2);
                    CHECK(d.conv == 303);
                    indoor_thermostat++;
                } else {
                    CHECK(d.reg == 0x10);
                    CHECK(d.offset == 1);
                    CHECK(d.conv == 307);
                    CHECK(std::string(p.id) == def::OBSERVABILITY_PROFILE);
                    outdoor_thermostat++;
                }
            }
            // Anchored, like the JS: "Space H Operation output" (0x62/8) is the OUTPUT terminal's
            // state, a different row, and must not be mistaken for the request.
            if (lbl.rfind("space heating operation", 0) == 0) {
                CHECK(d.reg == 0x62);
                CHECK(d.offset == 2);
                CHECK(d.conv == 303);
                space_heating++;
            }
        }
    }
    // Traversal proof: both rows are near-universal, so a selection that silently stops finding
    // either (a renamed label, a dropped row) fails here rather than blanking a pill in the field.
    CHECK(indoor_thermostat >= 35);
    CHECK(outdoor_thermostat == 1);
    CHECK(space_heating >= 40);
}

// The dashboard selects the tank's electric immersion heater with /^bsh$/i. Keep that label pinned
// to the X10A BSH run flag and separate from "Thermal protector BSH": confusing the two would
// either hide a real electric DHW boost or announce heater operation from a protection input.
static void test_bsh_flag_catalog() {
    int bsh = 0, protector = 0;
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef& d = v[i];
            std::string     lbl;
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
    CHECK(std::string(def::lookup("nonexistent").id) == "generic"); // fallback

    // --- Profile size limits (Vulnerability 2.2) ---
    // Ensure that some profiles in the registry contain more than 64 values.
    // This verifies that a hardcoded limit of 64 in Web UI / REST / WebSocket snapshots
    // (Vulnerability 2.2) would cause telemetry truncation, and validates the need for dynamic
    // sizing via def::lookup().
    const auto& epra = def::lookup("altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o");
    CHECK(epra.count > 64);
}

// Build a page mask from a list of register pages (mirrors what hp_detect sets when a page
// answers).
static uint32_t mask_of(std::initializer_list<uint8_t> regs) {
    uint32_t m = 0;
    for (uint8_t r : regs) m |= page_mask_bit(r);
    return m;
}

static bool has_candidate(const char** ids, int n, const char* id) {
    for (int i = 0; i < n; i++)
        if (std::string(ids[i]) == id) return true;
    return false;
}

static void test_detect() {
    // ── parse_kw_class: pull the capacity class out of a profile id (0.1 kW units) ──
    int lo = -1, hi = -1;
    CHECK(parse_kw_class("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", lo, hi) && lo == 40 &&
          hi == 80);
    CHECK(parse_kw_class("altherma_lt_11_16kw_hydrosplit_hydro_unit", lo, hi) && lo == 110 &&
          hi == 160);
    CHECK(parse_kw_class("altherma_ebla_edla_ewaa_ewya_d_series_9_16kw", lo, hi) && lo == 90 &&
          hi == 160);
    CHECK(parse_kw_class("altherma_erla03_d_ehfh_ehfz_dj_series_3kw", lo, hi) && lo == 30 &&
          hi == 30);
    CHECK(parse_kw_class("altherma_monobloc_ca_05_07kw", lo, hi) && lo == 50 && hi == 70);
    CHECK(parse_kw_class("altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3", lo, hi) && lo == 60 &&
          hi == 100);
    // Model code "12p30_50" must not be mistaken for a capacity — the "kw" token wins.
    CHECK(parse_kw_class("altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o", lo, hi) &&
          lo == 80 && hi == 120);
    // No kW in the id -> unknown (never filters on capacity).
    CHECK(!parse_kw_class("altherma_gshp", lo, hi) && lo == -1 && hi == -1);
    CHECK(!parse_kw_class("altherma3_r_erga", lo, hi));

    // 0x11 is probed for its digits but intentionally not a page-mask bit (no profile decodes it).
    CHECK(page_bit(0x11) < 0 && page_mask_bit(0x11) == 0);
    CHECK(page_bit(0x00) >= 0 && page_bit(0x64) >= 0);

    // ── detect_candidates against the REAL derived signatures ──
    Signature sigs[64];
    const int nsig = def::build_signatures(sigs, 64);
    CHECK(nsig >= 39); // Altherma-only detection models
    // Altherma-only: no non-Altherma (minichiller_*) profile is ever a detection candidate.
    for (int i = 0; i < nsig; i++) CHECK(std::strncmp(sigs[i].id, "altherma", 8) == 0);
    const char* out[64];

    // A unit exposing exactly {00,10,20,21,30,60,61,62,63,64} (no 65/A0/A1) — only egsah/geo3 and
    // gshp2 share that page set. At 16 kW the geo3 kW class [6,10] is excluded -> gshp2 alone.
    Fingerprint fp{};
    fp.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64});
    fp.kw_tenths = 160;
    int n        = detect_candidates(sigs, nsig, fp, out, 64);
    CHECK(n == 1 && std::string(out[0]) == "altherma_gshp2");

    // Same pages at 8 kW: geo3 [6,10] now also matches -> ambiguous set of exactly the two.
    fp.kw_tenths = 80;
    n            = detect_candidates(sigs, nsig, fp, out, 64);
    CHECK(n == 2);
    CHECK(has_candidate(out, n, "altherma_gshp2"));
    CHECK(has_candidate(out, n, "altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3"));

    // Feature-poor units drop feature-rich profiles: adding no extra pages keeps max-overlap only.
    // A unit with the group-A page set {00,10,20,21,60,61,62,64} excludes anything needing
    // 0x30/0x63.
    Fingerprint fa{};
    fa.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x60, 0x61, 0x62, 0x64});
    fa.kw_tenths = 60;
    n            = detect_candidates(sigs, nsig, fa, out, 64);
    CHECK(n >= 1);
    CHECK(!has_candidate(out, n, "altherma_gshp2")); // needs 0x30+0x63 the unit lacks

    // No bus response -> no candidates.
    Fingerprint none{};
    CHECK(detect_candidates(sigs, nsig, none, out, 64) == 0);

    // ── detect_best: a single deterministic representative to read with ──
    // Unambiguous case (gshp2 alone at 16 kW) → best is exactly that model.
    Fingerprint g2{};
    g2.page_mask = mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64});
    g2.kw_tenths = 160;
    CHECK(detect_best(sigs, nsig, g2) &&
          std::string(detect_best(sigs, nsig, g2)) == "altherma_gshp2");
    // User's ERGA04-08E fingerprint (0x1bff, ~6 kW): best is an Altherma model, is one of the
    // candidates, and is never a chiller. The exact ERGA-vs-EBLA variant is register-identical so
    // which one is named is arbitrary — but it must be a consistent candidate, not registry-order
    // junk.
    Fingerprint erga{};
    erga.page_mask =
        mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1});
    erga.kw_tenths = 60;
    const char* eb = detect_best(sigs, nsig, erga);
    CHECK(eb && std::strncmp(eb, "altherma", 8) == 0);
    int ecount = detect_candidates(sigs, nsig, erga, out, 64);
    CHECK(ecount > 1 && has_candidate(out, ecount, eb)); // best is drawn from the candidate set
    // The candidate set spans DIFFERENT marketing families — the ERGA-E split and the EBLA monobloc
    // are register-identical on X10A — which is exactly why /status reports it ambiguous and the UI
    // must not assert one model name. Lock both members so a signature change can't silently
    // collapse this to a confident (and, for half the owners, wrong) single pick.
    CHECK(has_candidate(out, ecount, "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    CHECK(has_candidate(out, ecount, "altherma_ebla_edla_d_series_4_8kw_monobloc"));
    // No bus → no best-fit.
    CHECK(detect_best(sigs, nsig, none) == nullptr);

    // ── detect_best I/U-capacity fallback (a real unit's case): the full 0x1bff page set but the
    // O/U
    //    capacity ABSENT (a short 0x00 descriptor -> kw_tenths=-1). Without a capacity hint the
    //    tightest-span rule lands on a 14-16 kW class; the I/U capacity code (reg 0x60/6 = 80 ->
    //    8.0 kW) must steer the representative to a class that CONTAINS 8.0 kW instead. ──
    Fingerprint amb{};
    amb.page_mask =
        mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1});
    amb.kw_tenths    = -1;                           // O/U capacity unreadable (short 0x00 reply)
    const char* nofb = detect_best(sigs, nsig, amb); // no capacity hint at all
    int         nlo = -1, nhi = -1;
    CHECK(nofb && parse_kw_class(nofb, nlo, nhi) &&
          !(nlo <= 80 && 80 <= nhi)); // wrong class w/o hint
    amb.iu_kw_tenths   = 80;          // I/U capacity code fallback = 8.0 kW
    const char* withfb = detect_best(sigs, nsig, amb);
    int         wlo = -1, whi = -1;
    CHECK(withfb && parse_kw_class(withfb, wlo, whi) && wlo <= 80 &&
          80 <= whi); // class now holds 8 kW
    int acount = detect_candidates(sigs, nsig, amb, out, 64);
    CHECK(has_candidate(out, acount, withfb)); // representative still drawn from the set
    // The I/U fallback must NEVER override a KNOWN O/U capacity: set kw_tenths to 16 kW and the 8
    // kW I/U hint is ignored — the representative stays in the 16 kW class.
    amb.kw_tenths   = 160;
    const char* ou  = detect_best(sigs, nsig, amb);
    int         olo = -1, ohi = -1;
    CHECK(ou && parse_kw_class(ou, olo, ohi) && olo <= 160 && 160 <= ohi);

    // ── #225: the candidate SET must narrow by the same I/U capacity the representative ranks by
    // ── detect_best applied the fallback while detect_candidates ignored it, so on the live unit
    // /status reported 8 candidates across 4 marketing families while the ranking had already been
    // constrained to the 4-8 kW class. That is not cosmetic: the header's contract is that the set
    // is register-equivalent ONLY when the capacity is known, and this is precisely the state where
    // it is not — an over-broad set is a claim the code cannot back. It has already done damage on
    // paper (#213 recorded one unit as two independent families, corrected in #219).
    Fingerprint live{}; // the live board's fingerprint, verbatim
    live.page_mask =
        mask_of({0x00, 0x10, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1});
    CHECK(live.page_mask == 0x1bff); // as printed by the device's detect diag line
    live.kw_tenths    = -1;          // short 0x00 descriptor -> O/U capacity absent
    live.iu_kw_tenths = 80;          // I/U capacity code 0x60/6 = 8.0 kW
    int lcount        = detect_candidates(sigs, nsig, live, out, 64);
    CHECK(lcount == 5); // was 8 before the narrowing
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
    CHECK(has_candidate(out, lcount, "altherma_top_grade")); // id carries no kW class
    CHECK(!parse_kw_class("altherma_top_grade", lo, hi));    // ...as this states outright
    // What it DOES exclude: a class that cannot hold 8.0 kW.
    CHECK(!has_candidate(out, lcount, "altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw"));
    CHECK(!has_candidate(out, lcount, "altherma_ebla_edla_ewaa_ewya_d_series_9_16kw"));
    // Still ambiguous, and still honestly so: no bus datum separates the survivors. Narrowing a set
    // is not resolving it, and /status must keep saying it cannot name one model.
    CHECK(lcount > 1);

    // The narrowing may not move the representative. It cannot, by construction — detect_best ranks
    // a capacity match above everything except page overlap, which the filter holds fixed — but
    // that is the kind of argument that stops being true after an edit, so it is asserted.
    CHECK(detect_best(sigs, nsig, live) &&
          has_candidate(out, lcount, detect_best(sigs, nsig, live)));

    // The corroboration guard, in the direction that matters more: an I/U capacity contained in NO
    // surviving class (an unusual pairing, a misread byte) is not evidence about this unit. Acting
    // on it would exclude every CLASSED candidate at once and leave only the class-less ones — not
    // merely a broad set but a wrong one, and a set narrowed onto the wrong models does not read as
    // uncertain the way a broad one does. So the fallback is simply not applied.
    Fingerprint odd  = live;
    odd.iu_kw_tenths = 999; // 99.9 kW: in no class in the catalog
    const int ocount = detect_candidates(sigs, nsig, odd, out, 64);
    CHECK(ocount == 8); // unfiltered, exactly as before #225
    CHECK(has_candidate(out, ocount, "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    CHECK(detect_best(sigs, nsig, odd) != nullptr);
    // And it is a strict no-op when there is no fallback to apply at all.
    Fingerprint nofbk  = live;
    nofbk.iu_kw_tenths = -1;
    CHECK(detect_candidates(sigs, nsig, nofbk, out, 64) == 8);
    // ...or when the O/U capacity IS known: signature_consistent has already filtered to matching
    // classes, so every survivor matches and the filter can remove nothing.
    Fingerprint known  = live;
    known.kw_tenths    = 60;
    known.iu_kw_tenths = 160; // contradictory hint, deliberately
    int kcount         = detect_candidates(sigs, nsig, known, out, 64);
    CHECK(kcount > 0);
    for (int i = 0; i < kcount; i++) { // the O/U figure decides, not the I/U one
        int clo = -1, chi = -1;        // (class-less profiles survive here too)
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
            s.page_mask    = sigs[i].page_mask;
            s.kw_tenths    = -1;
            s.iu_kw_tenths = iu;
            const char* b  = detect_best(sigs, nsig, s);
            const char* sout[64];
            const int   sn = detect_candidates(sigs, nsig, s, sout, 64);
            CHECK((b == nullptr) == (sn == 0)); // both find something, or neither does
            if (b) CHECK(has_candidate(sout, sn, b));
        }
    }

    // Generic Altherma fallback = the universal register core (not the old 3-row stub); an unknown
    // id resolves to it — this is what an unrecognized / S-protocol unit reads with.
    CHECK(def::lookup("generic").count > 40);
    CHECK(std::string(def::lookup("no_such_profile").id) == "generic");

    // ── #214: what ONE lost page reply costs, and the rule that stops it being acted on ──
    // The page probe gathers the unit's IDENTITY, not its values, and signature_consistent()
    // matches on page SUBSET — so clearing a single bit can make every profile inconsistent at
    // once. Measured here against the real signatures rather than asserted in prose, because the
    // number is the whole argument for retrying the probe: on the live 0x1bff fingerprint, MOST
    // single-page losses leave no candidate at all, and the caller then reads with `generic`.
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
        if (lb == nullptr)
            collapses++; // -> caller falls back to `generic`
        else if (std::string(lb) != live_best)
            changes++;
    }
    // Every single-page loss is consequential — none is harmless. That is the point: there is no
    // "safe" page to drop, so the probe must not drop one.
    CHECK(collapses + changes == 12);
    CHECK(collapses >= 8); // measured 8 of 12 fall through to `generic`

    // `generic` is not a near-miss of the real profile — it is a different instrument. Pin the gap
    // so a future catalog edit cannot quietly make the fallback look acceptable.
    CHECK(def::lookup("generic").count <
          def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc").count);
    {
        bool        generic_has_leaving_water = false, generic_has_rps = false;
        const auto& gp = def::lookup("generic");
        for (size_t i = 0; i < gp.count; i++) {
            if (gp.values[i].reg == 0x30) generic_has_rps = true;
            if (logic::lwt_ci_contains(gp.values[i].label, "leaving water"))
                generic_has_leaving_water = true;
        }
        CHECK(!generic_has_leaving_water); // no ΔT, no heat output, no COP
        CHECK(!generic_has_rps);           // no compressor witness for ou_stale either
    }

    // The rule itself: one no-match sweep is not evidence, two are. A transient cannot survive two
    // independent passes; a genuinely unrecognised unit says it twice and is then read with
    // generic.
    CHECK(DETECT_NO_MATCH_CONFIRMATIONS == 2);
    CHECK(!detect_commit_no_match(0));
    CHECK(!detect_commit_no_match(1)); // the case that used to pin `generic` at once
    CHECK(detect_commit_no_match(2));
    CHECK(detect_commit_no_match(3)); // saturates — never un-commits

    // ── EEPROM render: raw hex pairs for display ──
    const uint8_t ee[] = {0x0B, 0x02, 0x00, 0x01, 0x03, 0x02};
    char          buf[32];
    eeprom_render(ee, 6, buf, sizeof(buf));
    CHECK(std::string(buf) == "0B 02 00 01 03 02");
    eeprom_render(ee, 6, buf, 5); // small buffer: fits one pair, still NUL-terminated
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

    // Every other control char -> \u00XX. NUL is a real byte here (std::string is not
    // NUL-terminated logic), 0x0B/0x1F have no shorthand.
    CHECK(json_quote(std::string("\0", 1)) == "\"\\u0000\"");
    CHECK(json_quote("\x01") == "\"\\u0001\"");
    CHECK(json_quote("\x0B") == "\"\\u000b\"");
    CHECK(json_quote("\x1F") == "\"\\u001f\"");

    // The reachable case: an AP named Free<LF>WiFi. A raw newline here makes the WHOLE response
    // fail JSON.parse — /status.wifi.ssid on the dashboard, /scan on the LAN (and, before the
    // portal took a typed SSID, its network dropdown, which collapsed to a free-text box).
    CHECK(json_quote("Free\nWiFi") == "\"Free\\nWiFi\"");

    // EXHAUSTIVE: no byte below 0x20 may ever reach the output raw, whatever the escape form.
    for (int b = 0x00; b < 0x20; ++b) {
        const std::string out = json_quote(std::string(1, static_cast<char>(b)));
        CHECK(out.find(static_cast<char>(b)) == std::string::npos);
        CHECK(out.size() >= 4 && out[1] == '\\'); // "" plus at least a 2-char escape
    }

    // Bytes >= 0x20 that the RFC does NOT require escaping must survive verbatim. UTF-8 is the
    // trap: `char` is signed, so a lead byte like 0xC3 is negative and a signed `c < 0x20` test
    // would mangle "Café" (and every non-ASCII SSID) into garbage \u00XX.
    CHECK(json_quote("Café") == "\"Café\"");
    CHECK(json_quote("\xE2\x98\x95") == "\"\xE2\x98\x95\""); // U+2615, 3-byte UTF-8
    CHECK(json_quote("\x7F") == "\"\x7F\"");                 // DEL: legal unescaped per RFC 8259

    // json_append_escaped appends to what is already there (it is the inside-the-quotes form) —
    // crashinfo.hpp / heartbeat.hpp build their payloads that way.
    std::string acc = "x=";
    json_append_escaped(acc, "a\tb");
    CHECK(acc == "x=a\\tb");

    // The streaming whole-value form is the exact same encoder used by /values and MCP. A tiny
    // chunk bound forces quotes, UTF-8 and every escape family across transport boundaries.
    const std::string mixed = std::string("Café \\\"\n\t") + std::string("\0\x1f", 2);
    std::string       streamed;
    size_t            finals = 0;
    auto              emit   = [&](std::string_view bytes, bool final) {
        if (final)
            finals++;
        else
            streamed.append(bytes.data(), bytes.size());
        return true;
    };
    BoundedChunkSink<decltype(emit), 4> chunks(emit);
    json_append_quoted(chunks, mixed);
    CHECK(chunks.finish());
    CHECK(streamed == json_quote(mixed));
    CHECK(finals == 1 && chunks.max_buffered() <= 4);

    // An OOM before the first emission must escape to the HTTP trampoline, which can still select a
    // 503 response. The same failure after a successful flush must be consumed at the stream
    // boundary: headers may be committed, so the only truthful result is a failed response.
    size_t oom_data_chunks  = 0;
    size_t oom_final_chunks = 0;
    auto   oom_emit         = [&](std::string_view, bool final) {
        if (final)
            ++oom_final_chunks;
        else
            ++oom_data_chunks;
        return true;
    };
    BoundedChunkSink<decltype(oom_emit), 4> precommit(oom_emit);
    bool                                    precommit_rethrew = false;
    try {
        (void)finish_bounded_stream(precommit, [](auto& out) {
            out += "abc";
            throw std::bad_alloc();
        });
    } catch (const std::bad_alloc&) {
        precommit_rethrew = true;
    }
    CHECK(precommit_rethrew && !precommit.emission_started());
    CHECK(oom_data_chunks == 0 && oom_final_chunks == 0);

    BoundedChunkSink<decltype(oom_emit), 4> postcommit(oom_emit);
    CHECK(!finish_bounded_stream(postcommit, [](auto& out) {
        out += "abcde"; // fifth byte forces the first four-byte chunk onto the wire
        throw std::bad_alloc();
    }));
    CHECK(postcommit.emission_started());
    CHECK(oom_data_chunks == 1 && oom_final_chunks == 0);

    // httpd may have sent status/headers before reporting failure from the first chunk. Treat an
    // attempted-but-failed emit as started too, so a later OOM cannot trigger a second 503
    // response.
    size_t failed_emit_attempts = 0;
    auto   fail_first_emit      = [&](std::string_view, bool) {
        ++failed_emit_attempts;
        return false;
    };
    BoundedChunkSink<decltype(fail_first_emit), 4> transport_failed(fail_first_emit);
    CHECK(!finish_bounded_stream(transport_failed, [](auto& out) {
        out += "abcde";
        throw std::bad_alloc();
    }));
    CHECK(transport_failed.emission_started() && transport_failed.failed());
    CHECK(failed_emit_attempts == 1);

    // The compact /ota/status route uses only fixed-capacity text and a fixed response buffer while
    // TLS owns the heap. Assignment always terminates and truncates deterministically; response
    // overflow is explicit and never emits a silently truncated JSON document.
    FixedText<5> fixed = "abcdef";
    CHECK(fixed.size() == 4 && std::string(fixed.data()) == "abcd");
    fixed = std::string_view("ok");
    CHECK(fixed == "ok" && !fixed.empty());
    fixed.clear();
    CHECK(fixed.empty() && std::string(fixed.data()).empty());

    FixedBuffer<16> bounded;
    json_append_quoted(bounded, "a\nb");
    CHECK(bounded.ok() && std::string(bounded.data()) == "\"a\\nb\"");
    bounded += "0123456789";
    CHECK(!bounded.ok());
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
    // TYPE comes from the row's kind (its converter), never from the value — see
    // test_published_kind.
    std::vector<GroupedValue> vals = {
        {"outdoor_state", "operation_mode", "Heating", PublishedKind::Text},
        {"hydronic", "dhw_setpoint", "48", PublishedKind::Number},
        {"hydronic", "lw_setpoint", "35.4", PublishedKind::Number},
        {"outdoor_state", "error_type", "Normal",
         PublishedKind::Text}, // earlier group -> same bucket
    };
    const std::string j = build_grouped_json(vals);
    CHECK(j == "{\"outdoor_state\":{\"operation_mode\":\"Heating\",\"error_type\":\"Normal\"},"
               "\"hydronic\":{\"dhw_setpoint\":48,\"lw_setpoint\":35.4}}");
    CHECK(build_grouped_json({}) == "{}");

    // A binary row arrives here already formatted as numeric 1/0, so it must serialize as a bare
    // number next to the text values — not as "1", which would put it back out of reach.
    CHECK(build_grouped_json(
              {{"hydronic", "thermostat_on_off", "1"}, {"hydronic", "silent_mode", "0"}}) ==
          "{\"hydronic\":{\"thermostat_on_off\":1,\"silent_mode\":0}}");

    // A text value routes through the shared logic/json.hpp encoder, so a control char in one can't
    // break the X10A topic's JSON either (test_json covers the escaping itself).
    CHECK(build_grouped_json({{"other", "raw", "a\nb", PublishedKind::Text}}) ==
          "{\"other\":{\"raw\":\"a\\nb\"}}");

    // ── THE TYPE IS THE FIELD'S, NOT THE VALUE'S (#209 defect 3 / the telemetry-contract section)
    // ── A Text field stays quoted even when its value LOOKS numeric, and a Number field stays
    // unquoted even at zero. The measured failure was the other way round — one key alternating
    // between the number 30 and the string "OFF" — and the reason it survived review is that both
    // payloads are individually well-formed. Only asserting the SAME key across BOTH states catches
    // it.
    CHECK(build_grouped_json({{"outdoor_state", "error_code", "00", PublishedKind::Text}}) ==
          "{\"outdoor_state\":{\"error_code\":\"00\"}}"); // "00" is not a number here
    CHECK(build_grouped_json({{"outdoor_state", "error_code", "U4", PublishedKind::Text}}) ==
          "{\"outdoor_state\":{\"error_code\":\"U4\"}}"); // …and the type did not move
    CHECK(build_grouped_json({{"actuators", "fan_1_step", "30", PublishedKind::Number}}) ==
          "{\"actuators\":{\"fan_1_step\":30}}");
    CHECK(build_grouped_json({{"actuators", "fan_1_step", "0", PublishedKind::Number}}) ==
          "{\"actuators\":{\"fan_1_step\":0}}"); // stopped: numeric zero, never "OFF"

    // FAIL-CLOSED: a Number field handed a non-numeric string is a broken contract. It must not be
    // quoted (that IS the type flip) — the key stays, the type stays, the value is null.
    CHECK(build_grouped_json({{"actuators", "fan_1_step", "OFF", PublishedKind::Number}}) ==
          "{\"actuators\":{\"fan_1_step\":null}}");

    // The Modbus topic is source-specific and therefore flat. It has the exact same permanent type
    // contract and escaping behaviour as the grouped X10A encoder.
    CHECK(build_flat_json({{"modbus", "return_water_temperature", "35.5", PublishedKind::Number},
                           {"modbus", "smart_grid_operation_mode", "2", PublishedKind::Number},
                           {"modbus", "broken_numeric", "OFF", PublishedKind::Number}}) ==
          "{\"return_water_temperature\":35.5,"
          "\"smart_grid_operation_mode\":2,\"broken_numeric\":null}");
    CHECK(build_flat_json({}) == "{}");

    // The group key doubles as an HA entity-name fragment for the DERIVED companions, which have no
    // catalog label of their own (logic/fault_state.hpp).
    CHECK(group_display_name("outdoor_state") == "Outdoor State");
    CHECK(group_display_name("hydronic") == "Hydronic");
    CHECK(group_display_name("water_hx") == "Water Hx");
    CHECK(group_display_name("") == "");

    // ── Bounded builder (private issue 10 A): the counting pass + append into reserved capacity ──
    // must produce the EXACT bytes the owning build_grouped_json produces — the MQTT contract may
    // not change by a single byte — for every shape the device can hand over: all four kinds of
    // value, escaping, non-numeric Numbers, interleaved and repeated groups, empty rows and rows
    // whose group name itself needs escaping discipline.
    {
        const std::vector<GroupedValue> corpus = {
            {"outdoor_state", "operation_mode", "Heating", PublishedKind::Text},
            {"hydronic", "dhw_setpoint", "48", PublishedKind::Number},
            {"actuators", "raw", "a\nb\"\\\x01", PublishedKind::Text},
            {"hydronic", "lw_setpoint", "35.4", PublishedKind::Number},
            {"outdoor_state", "error_type", "Normal", PublishedKind::Text},
            {"actuators", "broken", "OFF", PublishedKind::Number}, // -> null
            {"", "", "", PublishedKind::Number},
            {"other", "raw2", "\x1f\x7f\xc3\xa9", PublishedKind::Text},
        };
        const std::string golden = build_grouped_json(corpus);
        CHECK(grouped_json_size(corpus) == golden.size());
        std::string bounded;
        bounded.reserve(grouped_json_size(corpus));
        append_grouped_json(bounded, corpus);
        CHECK(bounded == golden);
        CHECK(bounded.size() == grouped_json_size(corpus)); // exact: the reserve was a no-op
    }
    // The same byte-identity for the existing fixtures above, which pin the contract.
    for (const std::vector<GroupedValue>& fixture : std::vector<std::vector<GroupedValue>>{
             vals,
             {},
             {{"hydronic", "thermostat_on_off", "1"}, {"hydronic", "silent_mode", "0"}},
             {{"other", "raw", "a\nb", PublishedKind::Text}},
             {{"actuators", "fan_1_step", "OFF", PublishedKind::Number}}}) {
        const std::string golden = build_grouped_json(fixture);
        std::string       bounded;
        bounded.reserve(grouped_json_size(fixture));
        append_grouped_json(bounded, fixture);
        CHECK(bounded == golden);
        CHECK(bounded.size() == grouped_json_size(fixture));
    }
    // Writing into reserved capacity performs no allocation: a deliberately small buffer must NOT
    // be grown by the append itself (callers own the one-time reserve; a grow here is the churn the
    // counting pass exists to prevent).
    {
        const std::vector<GroupedValue> one = {
            {"hydronic", "dhw_setpoint", "48", PublishedKind::Number}};
        std::string tight;
        tight.reserve(grouped_json_size(one));
        const size_t cap_before = tight.capacity();
        append_grouped_json(tight, one);
        CHECK(tight.capacity() == cap_before);
        CHECK(tight == build_grouped_json(one));
    }
    // Device path: derive group/key/type/companions directly from the ONE committed poll cache.
    // This must stay byte-identical to the owning GroupedValue builder while omitting empty/held
    // rows, and its combined count+digest pass must describe exactly the bytes later written.
    {
        struct CacheRow {
            const char* label;
            std::string value;
            uint8_t     reg;
            bool        held;
            int         conv;
        };
        const std::vector<CacheRow> cache = {
            {"Operation Mode", "Heating", 0x10, false, 217},
            {"Error type", "Error", 0x10, false, 203},
            {"R1T-Outdoor air temp.", "10.0", 0x20, true, 105},
            {"Missing row", "", 0x21, false, 105},
            {"DHW setpoint", "48.0", 0x60, false, 105},
            {"Error type", "Warning", 0x60, false, 203},
            {"Odd / Label", "a\n\"b", 0x62, false, 217},
        };
        const std::string golden =
            "{\"outdoor_state\":{\"operation_mode\":\"Heating\",\"error_type\":\"Error\","
            "\"error_active\":1,\"warning_active\":0},"
            "\"hydronic\":{\"dhw_setpoint\":48.0,\"error_type\":\"Warning\","
            "\"error_active\":0,\"warning_active\":1},"
            "\"hydronic_state\":{\"odd_label\":\"a\\n\\\"b\"}}";
        const X10aCacheJsonProbe probe = probe_x10a_cache_json(cache);
        CHECK(probe.bytes == golden.size());
        CHECK(probe.digest == fnv1a64(golden));
        std::string actual;
        actual.reserve(probe.bytes);
        append_x10a_cache_json(actual, cache);
        CHECK(actual == golden);
        CHECK(actual.capacity() >= probe.bytes);

        CountingOut slug_count;
        ha_slug_append(slug_count, "  Outdoor air temp. (R1T)  ");
        CHECK(slug_count.n == ha_slug("  Outdoor air temp. (R1T)  ").size());
    }
    // A stopped/held page changes only the direct view of the existing cache. Reuse one already
    // reserved transient sink through thousands of full/held/full transitions: exact bytes and
    // digest must recover without any capacity growth in the encoder.
    {
        struct CacheRow {
            const char* label;
            std::string value;
            uint8_t     reg;
            bool        held;
            int         conv;
        };
        std::vector<CacheRow> cache = {
            {"Operation Mode", "Heating", 0x10, false, 217},
            {"R1T Outdoor Air Temp", "10.0", 0x20, false, 105},
            {"DHW Setpoint", "48.0", 0x60, false, 105},
        };
        const X10aCacheJsonProbe full_probe = probe_x10a_cache_json(cache);
        std::string              out;
        out.reserve(full_probe.bytes);
        const size_t capacity = out.capacity();
        append_x10a_cache_json(out, cache);
        const std::string full = out;
        for (int cycle = 0; cycle < 4000; ++cycle) {
            cache[1].held                       = true;
            const X10aCacheJsonProbe held_probe = probe_x10a_cache_json(cache);
            out.clear();
            append_x10a_cache_json(out, cache);
            CHECK(out.size() == held_probe.bytes);
            CHECK(fnv1a64(out) == held_probe.digest);
            CHECK(out.capacity() == capacity);

            cache[1].held = false;
            out.clear();
            append_x10a_cache_json(out, cache);
            CHECK(out == full);
            CHECK(out.size() == full_probe.bytes);
            CHECK(fnv1a64(out) == full_probe.digest);
            CHECK(out.capacity() == capacity);
        }
    }
    // The counting sink shares the ESCAPING template: counted bytes == written bytes for hostile
    // text, on both encoders (json.hpp CountingOut + the group builder above).
    for (const char* hostile : {"", "a", "a\nb", "\"", "\\", "\x01\x1f\x7f", "Café", "a\tb\r"}) {
        CHECK(json_quoted_size(hostile) ==
              build_grouped_json({{"g", "k", hostile, PublishedKind::Text}}).size() - 12u);
        CHECK(json_escaped_size(hostile) + 2 == json_quoted_size(hostile));
    }

    // ── Publish dedup digest (private issue 10 C)
    // ───────────────────────────────────────────────── FNV-1a 64 known-answer vectors pin the
    // implementation across host/target; the semantics test mirrors publish_x10a_state: equal
    // payloads share a digest (skip), any change differs (send).
    CHECK(fnv1a64("") == 0xcbf29ce484222325ULL);
    CHECK(fnv1a64("a") == 0xaf63dc4c8601ec8cULL);
    CHECK(fnv1a64("foobar") == 0x85944171f73967e8ULL);
    CHECK(X10A_GROUPED_JSON_MAX_BYTES == 12u * 1024u);
    CHECK(X10A_FORMATTED_VALUE_MAX_BYTES == 96u);
    for (const ErrorCodeEntry& entry : ERROR_CODE_TABLE)
        CHECK(std::strlen(entry.code) + 2u + std::strlen(entry.description) <=
              X10A_FORMATTED_VALUE_MAX_BYTES);
    // Catalog-wide hard-cap proof: fill every publishable row with the longest representation its
    // device slot permits, include every possible fault companion, and require every resolved
    // profile to fit the 12 KiB refusal ceiling. A catalog growth that exceeds it must fail here,
    // not first appear as a silently refused state document on hardware.
    struct CatalogCacheRow {
        const char* label;
        std::string value;
        uint8_t     reg;
        bool        held;
        int         conv;
    };
    for (const auto& p : def::profiles) {
        const logic::ProfileView     profile = def::resolved(p);
        std::vector<GroupedValue>    worst;
        std::vector<CatalogCacheRow> direct_cache;
        std::vector<GroupedValue>    direct_expected;
        std::set<std::string>        aligned_identities;
        for (size_t i = 0; i < profile.count(); i++) {
            const ValueDef d = logic::adjudicated(profile[i]);
            if (!row_publishable(d)) continue;
            const std::string identity = std::to_string(d.reg) + "/" + std::to_string(d.offset) +
                                         "/" + std::to_string(d.conv) + "/" + d.label;
            CHECK(aligned_identities.insert(identity).second);
            worst.push_back(
                {group_for_page(d.reg), ha_slug(d.label),
                 std::string(x10a_formatted_value_capacity(d.conv),
                             published_kind(d.conv) == PublishedKind::Text ? '\x01' : '9'),
                 published_kind(d.conv)});
            if (d.conv == 203)
                for (const FaultCompanion& companion : FAULT_COMPANIONS)
                    worst.push_back(
                        {group_for_page(d.reg), companion.key, "1", PublishedKind::Number});

            const PublishedKind kind  = published_kind(d.conv);
            const std::string   value = d.conv == 203                 ? "Error"
                                        : kind == PublishedKind::Text ? std::string("a\n\"\\\x01")
                                                                      : std::string("999.9");
            direct_cache.push_back({d.label, value, d.reg, false, d.conv});
            direct_expected.push_back({group_for_page(d.reg), ha_slug(d.label), value, kind});
            if (d.conv == 203) {
                const FaultClass fc = fault_class_from_text(value.c_str());
                for (size_t c = 0; c < FAULT_COMPANION_COUNT; ++c)
                    direct_expected.push_back({group_for_page(d.reg), FAULT_COMPANIONS[c].key,
                                               fault_companion_state(c, fc),
                                               PublishedKind::Number});
            }
        }
        CHECK(grouped_json_size(worst) <= X10A_GROUPED_JSON_MAX_BYTES);
        const X10aCacheJsonProbe direct_probe = probe_x10a_cache_json(direct_cache);
        std::string              direct_json;
        direct_json.reserve(direct_probe.bytes);
        append_x10a_cache_json(direct_json, direct_cache);
        CHECK(direct_json == build_grouped_json(direct_expected));
        CHECK(direct_json.size() == direct_probe.bytes);
        CHECK(fnv1a64(direct_json) == direct_probe.digest);
    }
    {
        const std::string a = build_grouped_json(vals);
        const std::string b = build_grouped_json(vals);
        CHECK(fnv1a64(a) == fnv1a64(b)); // unchanged -> dedup skips the publish
        const std::vector<GroupedValue> changed = vals;
        const std::string               c       = build_grouped_json(changed);
        CHECK(fnv1a64(a) == fnv1a64(c)); // same rows, same payload
        CHECK(fnv1a64(a) != fnv1a64(build_grouped_json(
                                {{"hydronic", "dhw_setpoint", "49", PublishedKind::Number}})));
    }
    // ha_slug_into re-slugs into a reused slot and matches the owning form byte-for-byte.
    {
        std::string slot;
        ha_slug_into(slot, "Outdoor air temp. (R1T)");
        CHECK(slot == ha_slug("Outdoor air temp. (R1T)"));
        const size_t cap = slot.capacity();
        ha_slug_into(slot, "DHW setpoint");
        CHECK(slot == ha_slug("DHW setpoint"));
        CHECK(slot.capacity() == cap); // into-slot reuse: no reallocation
    }
}

static void test_x10a_snapshot_align() {
    struct Row {
        const char* label;
        std::string value;
        uint8_t     reg;
        uint8_t     off;
        bool        held;
        int         conv;
    };
    std::vector<Row> layout = {
        {"A", "old-a", 0x10, 0, false, 217},
        {"B", "old-b", 0x20, 2, false, 105},
        {"C", "old-c", 0x21, 4, true, 105},
    };
    CHECK(logic::x10a_snapshot_source_matches("generic", 0x1234, "generic", 0x1234));
    CHECK(!logic::x10a_snapshot_source_matches("generic", 0x1234, "altherma_bizone_cb_04_08kw",
                                               0x5678));
    CHECK(!logic::x10a_snapshot_source_matches("generic", 0x1234, "generic", 0x5678));
    for (Row& row : layout) row.value.reserve(16);
    const std::vector<size_t> capacities = {layout[0].value.capacity(), layout[1].value.capacity(),
                                            layout[2].value.capacity()};

    // Compact source order is irrelevant; a missing row becomes absent and held follows its own
    // identity. The copied label has different storage, exercising strcmp rather than pointer luck.
    const std::string      copied_b = "B";
    const std::vector<Row> source   = {
        {copied_b.c_str(), "2.5", 0x20, 2, true, 105},
        {"A", "Heating", 0x10, 0, false, 217},
    };
    CHECK(logic::x10a_snapshot_align(layout.data(), layout.size(), source.data(), source.size()) ==
          logic::X10aSnapshotAlignResult::Ok);
    CHECK(layout[0].value == "Heating" && !layout[0].held);
    CHECK(layout[1].value == "2.5" && layout[1].held);
    CHECK(layout[2].value.empty() && !layout[2].held);
    for (size_t i = 0; i < layout.size(); i++) CHECK(layout[i].value.capacity() == capacities[i]);

    // Validation is transactional: an extra/changed identity, a duplicate source or a value over
    // capacity refuses the snapshot without partially clearing the last good aligned state.
    const std::vector<std::string> before = {layout[0].value, layout[1].value, layout[2].value};
    const Row                      unknown{"D", "1", 0x30, 1, false, 300};
    CHECK(logic::x10a_snapshot_align(layout.data(), layout.size(), &unknown, 1) ==
          logic::X10aSnapshotAlignResult::IdentityMismatch);
    CHECK(layout[0].value == before[0] && layout[1].value == before[1] &&
          layout[2].value == before[2]);
    const Row duplicate[] = {source[0], source[0]};
    CHECK(logic::x10a_snapshot_align(layout.data(), layout.size(), duplicate, 2) ==
          logic::X10aSnapshotAlignResult::IdentityMismatch);
    Row oversized{"A", std::string(layout[0].value.capacity() + 1, 'x'), 0x10, 0, false, 217};
    CHECK(logic::x10a_snapshot_align(layout.data(), layout.size(), &oversized, 1) ==
          logic::X10aSnapshotAlignResult::ValueTooLarge);
    CHECK(layout[0].value == before[0] && layout[1].value == before[1] &&
          layout[2].value == before[2]);
}

// ── The published JSON TYPE of every converter (#209 defect 3, the telemetry-contract section)
// ──── The defect this closes is not "conv 211 is wrong today" (it was fixed in #210) but "nothing
// stops the next converter doing it again". So this walks EVERY implemented converter id over a
// sweep of raw input bytes and asserts that what convert() produces agrees with published_kind() in
// EVERY state — a converter that returns text for one byte and a number for another fails here,
// whichever way published_kind classifies it.
static void test_published_kind() {
    // The full set of ids convert() implements, taken from the switch rather than guessed: anything
    // else returns unimpl and never reaches a publish surface.
    static const int IMPLEMENTED[] = {
        101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 114, 118, 119,
        151, 152, 161, 203, 204, 211, 214, 215, 217, 219, 300, 301, 302, 303,
        304, 305, 306, 307, 310, 311, 315, 316, 405, 801, 802, 803, 804, 805,
    };
    for (int conv : IMPLEMENTED) {
        const PublishedKind want       = published_kind(conv);
        bool                saw_number = false, saw_text = false;
        // A sweep wide enough to hit every branch of the enum converters: 0 and 1 (the
        // OFF/first-label cases), the nibble boundaries conv 204 indexes with, and the out-of-range
        // values that make 203/217/315/316 fall through to "?".
        for (int b0 = 0; b0 <= 255; b0++) {
            const uint8_t bytes[2] = {static_cast<uint8_t>(b0), 0x00};
            ValueDef      d{0x30, 0, conv, 2, -1, "probe"};
            const Reading r = convert(d, bytes);
            if (r.unimpl) continue;
            if (r.text[0] != '\0')
                saw_text = true;
            else if (r.ok)
                saw_number = true;
            // A row that decodes to NOTHING (conv 405's absent transducer, conv 114's 0x8000) is an
            // absence, not a type — absence is stated by omitting the key, so it constrains
            // nothing.
        }
        // The load-bearing assertion: never both. One field, one type, in every state.
        CHECK(!(saw_number && saw_text));
        if (want == PublishedKind::Text) CHECK(!saw_number);
        if (want == PublishedKind::Number) CHECK(!saw_text);
    }

    // Spot-check the classification itself, so a wholesale sign error in published_kind (everything
    // Text, say) cannot satisfy the loop above by making both halves vacuous.
    CHECK(published_kind(211) == PublishedKind::Number); // fan step — the #209 defect-3 row
    CHECK(published_kind(105) == PublishedKind::Number);
    CHECK(published_kind(300) ==
          PublishedKind::Number); // bit flags are 1/0 NUMBERS, not a 3rd type
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

static void test_mqtt_base() {
    // WHICH base topic this installation publishes under (logic/mqtt_base.hpp). The setting exists
    // because two boards on one base become ONE thing to every consumer — one set of retained
    // topics, one metrics series per field, one HA device — silently, since each individual value
    // stays plausible (#215).
    MqttBaseRefusal refusal;

    // Empty is VALID and means the compile-time default. This is the whole no-migration property:
    // every already-deployed device decodes empty and keeps publishing exactly where it did.
    CHECK(mqtt_base_valid(""));
    CHECK(mqtt_base_effective("", "daikin-altherma-esp32") == "daikin-altherma-esp32");
    CHECK(mqtt_base_effective("bench-2", "daikin-altherma-esp32") == "bench-2");
    // A null compiled default cannot produce a "null" topic string.
    CHECK(mqtt_base_effective("", nullptr).empty());

    // Ordinary shapes, including the multi-segment one a broker layout may want.
    CHECK(mqtt_base_valid("daikin-altherma-esp32"));
    CHECK(mqtt_base_valid("home/heating/daikin-altherma-esp32"));
    CHECK(mqtt_base_valid("d"));

    // Wildcards: meaningless in a topic being PUBLISHED to, and a broker refuses the PUBLISH —
    // which would present as "MQTT quietly stopped working" after a save that answered ok.
    CHECK(!mqtt_base_valid("daikin/#", &refusal));
    CHECK(!mqtt_base_valid("daikin/+/x", &refusal));
    // The broker's own reserved tree.
    CHECK(!mqtt_base_valid("$SYS/daikin", &refusal));
    // Leading/trailing slash and empty segments produce "//" in every derived topic.
    CHECK(!mqtt_base_valid("/daikin", &refusal));
    CHECK(!mqtt_base_valid("daikin/", &refusal));
    CHECK(!mqtt_base_valid("home//daikin", &refusal));
    // Control bytes are forbidden in MQTT topic names; a space is legal but unusable at a CLI.
    CHECK(!mqtt_base_valid(std::string("daikin\n2"), &refusal));
    CHECK(!mqtt_base_valid("daikin bench", &refusal));
    // Length bound.
    CHECK(mqtt_base_valid(std::string(MQTT_BASE_MAX_LEN, 'a')));
    CHECK(!mqtt_base_valid(std::string(MQTT_BASE_MAX_LEN + 1, 'a'), &refusal));

    // THE LOAD-BEARING ONE. device_node_id() falls back to the constant "daikin" when a base
    // slugifies to nothing, so a base of "___" would put two boards back on ONE Home Assistant
    // device — the exact collision this setting exists to end, re-created by a value that passes
    // every other rule. It must be refused here, not absorbed by the fallback.
    CHECK(!mqtt_base_valid("___", &refusal));
    CHECK(!mqtt_base_valid("-", &refusal));
    CHECK(device_node_id("___") == "daikin"); // the fallback the rule above exists to avoid

    // Every refusal must hand back a non-empty code AND message: http_config.cpp interpolates both
    // into JSON unescaped, so an empty one is an error with no text and a null would be a crash.
    // The CODE is what the localized UI keys on, so a blank one silently loses the translation.
    for (const char* bad :
         {"daikin/#", "$SYS/x", "/daikin", "daikin/", "home//daikin", "___", "daikin bench"}) {
        MqttBaseRefusal r;
        CHECK(!mqtt_base_valid(bad, &r));
        CHECK(r.code != nullptr && r.code[0] != '\0' && r.message != nullptr &&
              r.message[0] != '\0');
    }
    // One code PER RULE — a single "invalid base topic" code would make the UI say the same thing
    // about a 70-character name and about one that would collide in Home Assistant.
    MqttBaseRefusal wild, slug;
    CHECK(!mqtt_base_valid("daikin/#", &wild) && !mqtt_base_valid("___", &slug));
    CHECK(std::string(wild.code) != std::string(slug.code));
    // A PASSING base must leave the refusal untouched, so a caller that forgets to check the return
    // value cannot read a stale reason out of it.
    MqttBaseRefusal untouched;
    CHECK(mqtt_base_valid("daikin-altherma-esp32", &untouched));
    CHECK(std::string(untouched.code).empty() && std::string(untouched.message).empty());
    // A distinct base really does yield a distinct HA device id — the point of the whole exercise.
    CHECK(device_node_id("daikin-altherma-esp32") != device_node_id("daikin-bench-2"));
}

static void test_mqtt_uri() {
    // Broker URI -> host / port / TLS split (logic/mqtt_uri.hpp), matching mqtt_ha's scheme policy.
    std::string host;
    int         port = 0;
    bool        tls  = false;

    // Bare host:port -> plaintext, explicit port.
    CHECK(parse_mqtt_uri("192.0.2.10:1883", host, port, tls) && host == "192.0.2.10" &&
          port == 1883 && !tls);
    // Bare host, no port -> default plaintext 1883.
    CHECK(parse_mqtt_uri("broker.local", host, port, tls) && host == "broker.local" &&
          port == 1883 && !tls);
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
    CHECK(parse_mqtt_uri("ws://h:8083/mqtt", host, port, tls) && host == "h" && port == 8083 &&
          !tls);
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
    CHECK(!parse_mqtt_uri("mqtts://", host, port, tls, &why) &&
          std::string(why) == "Invalid broker URI");
    // IPv6 literal with port -> parsed with brackets intact (device AF_INET resolve then rejects
    // it).
    CHECK(parse_mqtt_uri("[::1]:1883", host, port, tls) && host == "[::1]" && port == 1883 && !tls);
    // IPv6 literal, no port -> brackets kept, default port (colon is inside the brackets).
    CHECK(parse_mqtt_uri("[fe80::1]", host, port, tls) && host == "[fe80::1]" && port == 1883 &&
          !tls);
}

// #380 — the publish task stands aside while a known TLS operation owns the heap, BOUNDED so one
// that never finishes cannot silence the bridge for the rest of the boot.
static void test_ota_quiesce() {
    OtaQuiesceState st;

    // No download: never hold off, and the budget stays untouched.
    for (int i = 0; i < 1000; i++) CHECK(!ota_quiesce_step(st, false));
    CHECK(st.held == 0);
    CHECK(!ota_quiesce_exhausted(st, false));

    // Download running: hold off every cycle, up to and including the cap.
    for (uint32_t i = 0; i < OTA_QUIESCE_MAX_CYCLES; i++) {
        CHECK(ota_quiesce_step(st, true));
        CHECK(st.held == i + 1);
    }
    CHECK(ota_quiesce_exhausted(st, true));

    // THE LOAD-BEARING CASE. The flag is set by another task and cleared on ITS exit paths; a stall
    // behind a dead TCP connection, a wedged TLS read or a missed clear must not mean silence
    // forever. Past the cap the publisher resumes and takes its chances with the OOM guard — which
    // is exactly the behaviour that shipped before this file existed, so the worst case of the fix
    // is the status quo, not a new failure mode.
    for (int i = 0; i < 100; i++) CHECK(!ota_quiesce_step(st, true));
    CHECK(st.held == OTA_QUIESCE_MAX_CYCLES); // saturates; no wrap on a long-running download

    // The download ends -> the budget is restored IN FULL. A board that installs many updates over
    // a long uptime must get the whole hold-off for each one, not a share of a per-boot allowance.
    CHECK(!ota_quiesce_step(st, false));
    CHECK(st.held == 0);
    CHECK(!ota_quiesce_exhausted(st, false));
    CHECK(ota_quiesce_step(st, true));
    CHECK(st.held == 1);

    // A download shorter than the budget (every real one: tens of seconds against a 5-minute cap)
    // leaves no residue for the next.
    OtaQuiesceState brief;
    for (int i = 0; i < 30; i++) CHECK(ota_quiesce_step(brief, true));
    CHECK(!ota_quiesce_step(brief, false));
    CHECK(brief.held == 0);

    // The cap must be long enough to cover a real install and short enough to bound the outage. At
    // the 1 s publish cadence: minutes, not seconds, and not the rest of the boot.
    CHECK(OTA_QUIESCE_MAX_CYCLES >= 60);
    CHECK(OTA_QUIESCE_MAX_CYCLES > 480); // must outlive the authoritative full-OTA observer
    CHECK(OTA_QUIESCE_MAX_CYCLES <= 900);
}

// The verifier needs BOTH aggregate capacity and one sufficiently large INTERNAL block. The live
// failure is the adversarial shape here: aggregate free heap can look plausible while fragmentation
// leaves RSA/PSA no usable block. Pin every threshold edge independently so changing && to ||,
// using the total for both inputs, or weakening either comparison is observable on the host.
static void test_ota_headroom() {
    CHECK(OTA_TRANSFER_HEADROOM.min_free_bytes == 56u * 1024u);
    CHECK(OTA_TRANSFER_HEADROOM.min_largest_block_bytes == 24u * 1024u);
    CHECK(OTA_TRANSFER_HEADROOM.stable_samples == 4u);
    CHECK(OTA_VALIDATION_HEADROOM.min_free_bytes == 24u * 1024u);
    CHECK(OTA_VALIDATION_HEADROOM.min_largest_block_bytes == 12u * 1024u);
    CHECK(OTA_VALIDATION_HEADROOM.stable_samples == 2u);
    CHECK(OTA_VERIFY_MIN_FREE_BYTES == 24u * 1024u);
    CHECK(OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES == 12u * 1024u);

    CHECK(ota_headroom_ok(OTA_TRANSFER_HEADROOM, 56u * 1024u, 24u * 1024u));
    CHECK(!ota_headroom_ok(OTA_TRANSFER_HEADROOM, 56u * 1024u - 1, 32u * 1024u));
    CHECK(!ota_headroom_ok(OTA_TRANSFER_HEADROOM, 64u * 1024u, 24u * 1024u - 1));
    CHECK(ota_verify_headroom_ok(OTA_VERIFY_MIN_FREE_BYTES, OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES));
    CHECK(ota_verify_headroom_ok(OTA_VERIFY_MIN_FREE_BYTES + 1,
                                 OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES + 1));

    // Plenty in aggregate cannot compensate for the 632-byte fragmented block observed live.
    CHECK(!ota_verify_headroom_ok(64u * 1024u, 632));
    CHECK(!ota_verify_headroom_ok(64u * 1024u, OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES - 1));
    // One large block cannot compensate for too little total verifier working memory.
    CHECK(!ota_verify_headroom_ok(OTA_VERIFY_MIN_FREE_BYTES - 1, 32u * 1024u));
    // Neither-short case closes the vacuous path where only one side is really consulted.
    CHECK(!ota_verify_headroom_ok(0, 0));

    unsigned streak = 0;
    streak = ota_headroom_streak_next(OTA_TRANSFER_HEADROOM, streak, 60u * 1024u, 32u * 1024u);
    CHECK(streak == 1u);
    streak = ota_headroom_streak_next(OTA_TRANSFER_HEADROOM, streak, 60u * 1024u, 32u * 1024u);
    CHECK(streak == 2u);
    // One trough resets the evidence; samples on opposite sides may not be combined.
    streak = ota_headroom_streak_next(OTA_TRANSFER_HEADROOM, streak, 55u * 1024u, 32u * 1024u);
    CHECK(streak == 0u);
    for (unsigned i = 0; i < 6; ++i)
        streak = ota_headroom_streak_next(OTA_TRANSFER_HEADROOM, streak, 60u * 1024u, 32u * 1024u);
    CHECK(streak == OTA_TRANSFER_HEADROOM.stable_samples);

    // Courtesy notes use the same dynamic-TLS admission budget as the manifest/image client.
    CHECK(OTA_CHANGELOG_HEADROOM.min_free_bytes == OTA_TRANSFER_HEADROOM.min_free_bytes);
    CHECK(OTA_CHANGELOG_HEADROOM.min_largest_block_bytes ==
          OTA_TRANSFER_HEADROOM.min_largest_block_bytes);
    CHECK(OTA_CHANGELOG_HEADROOM.stable_samples == OTA_TRANSFER_HEADROOM.stable_samples);
    CHECK(ota_changelog_tls_headroom_ok(56u * 1024u, 24u * 1024u));
    CHECK(!ota_changelog_tls_headroom_ok(56u * 1024u - 1, 64u * 1024u));
    CHECK(!ota_changelog_tls_headroom_ok(64u * 1024u, 24u * 1024u - 1));
}

// The weather fetch's own headroom gate (private issue 10 D) — same predicate shape as the OTA
// gate above, but with evidence-based floors that reject the measured 15.9 KiB fragmentation
// trough, admit the board's healthy 31.7 KiB ceiling and preserve aggregate reserve around the
// fetch's measured ~40 KiB transient claim.
static void test_weather_fetch_headroom() {
    CHECK(WEATHER_FETCH_MIN_FREE_BYTES == 56u * 1024u);
    CHECK(WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES == 24u * 1024u);

    CHECK(weather_fetch_headroom_ok(WEATHER_FETCH_MIN_FREE_BYTES,
                                    WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES));
    CHECK(weather_fetch_headroom_ok(WEATHER_FETCH_MIN_FREE_BYTES + 1,
                                    WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES + 1));

    // The live fragmentation trough from the issue: plenty of aggregate bytes, but the largest
    // block does not leave enough room for the complete TLS/HTTP setup — retry later.
    CHECK(!weather_fetch_headroom_ok(59u * 1024u, WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES - 1));
    // Aggregate exhaustion is refused even with a large block free.
    CHECK(!weather_fetch_headroom_ok(WEATHER_FETCH_MIN_FREE_BYTES - 1, 32u * 1024u));
    CHECK(!weather_fetch_headroom_ok(0, 0));

    CHECK(http_body_complete(128, 128, true));
    CHECK(!http_body_complete(128, 127, true));
    CHECK(!http_body_complete(128, 129, true));
    CHECK(!http_body_complete(128, 128, false));
    CHECK(http_body_complete(-1, 128, true));
    CHECK(!http_body_complete(-1, 128, false));
    CHECK(json_suffix_is_whitespace(""));
    CHECK(json_suffix_is_whitespace(" \t\r\n"));
    CHECK(!json_suffix_is_whitespace(" trailing"));
    CHECK(!json_suffix_is_whitespace(std::string_view("\0", 1)));
}

// /values waits boundedly behind the short Weather TLS allocator, but a newly active OTA owner must
// pre-empt that wait immediately. Otherwise the sole HTTP worker stays parked while /status and
// /ota/status queue behind it. Pin the transition as well as the exact inclusive Weather timeout.
static void test_http_values_wait() {
    using logic::HttpValuesWaitDecision;
    CHECK(logic::http_values_wait_decision(false, false, 0, 4000) == HttpValuesWaitDecision::Ready);
    CHECK(logic::http_values_wait_decision(true, false, 0, 4000) == HttpValuesWaitDecision::Refuse);
    CHECK(logic::http_values_wait_decision(false, true, 3999, 4000) ==
          HttpValuesWaitDecision::Wait);
    CHECK(logic::http_values_wait_decision(true, true, 3999, 4000) ==
          HttpValuesWaitDecision::Refuse);
    CHECK(logic::http_values_wait_decision(false, true, 4000, 4000) ==
          HttpValuesWaitDecision::Refuse);
    CHECK(logic::http_values_wait_decision(false, false, 4000, 4000) ==
          HttpValuesWaitDecision::Ready);
}

// The initial feed must be absolute HTTPS; redirects may use an ordinary relative reference but
// can never downgrade the transport or hide a new authority behind `//`. Exercise parser-confusion
// shapes as well as the happy path because esp_http_client, not this small policy, does full URL
// parsing after the policy admits a value.
static void test_ota_transport() {
    CHECK(ota_url_is_absolute_https("https://updates.example/firmware.bin"));
    CHECK(ota_url_is_absolute_https("HTTPS://UPDATES.EXAMPLE/firmware.bin"));
    CHECK(ota_url_is_absolute_https("https://[2001:db8::1]/firmware.bin"));
    CHECK(!ota_url_is_absolute_https(""));
    CHECK(!ota_url_is_absolute_https("https://"));
    CHECK(!ota_url_is_absolute_https("https:///firmware.bin"));
    CHECK(!ota_url_is_absolute_https("https://?firmware.bin"));
    CHECK(!ota_url_is_absolute_https("https://#firmware.bin"));
    CHECK(!ota_url_is_absolute_https("http://updates.example/firmware.bin"));
    CHECK(!ota_url_is_absolute_https(" https://updates.example/firmware.bin"));
    CHECK(!ota_url_is_absolute_https("https://updates.example\\firmware.bin"));
    CHECK(!ota_url_is_absolute_https(std::string("https://updates.example/") + char(0x7f)));
    CHECK(!ota_url_is_absolute_https(std::string("https://updates.example/") + char(0x1f)));

    CHECK(ota_url_is_https_or_relative("https://updates.example/next.bin"));
    CHECK(ota_url_is_https_or_relative("/next.bin"));
    CHECK(ota_url_is_https_or_relative("next.bin"));
    CHECK(ota_url_is_https_or_relative("../next.bin"));
    CHECK(ota_url_is_https_or_relative("?version=2"));
    CHECK(ota_url_is_https_or_relative("#fragment"));
    CHECK(ota_url_is_https_or_relative("path/value:still-a-path"));
    CHECK(!ota_url_is_https_or_relative(""));
    CHECK(!ota_url_is_https_or_relative("//attacker.example/next.bin"));
    CHECK(!ota_url_is_https_or_relative("http://updates.example/next.bin"));
    CHECK(!ota_url_is_https_or_relative("HtTp://updates.example/next.bin"));
    CHECK(!ota_url_is_https_or_relative("https:next.bin"));
    CHECK(!ota_url_is_https_or_relative("data:application/octet-stream,x"));
    CHECK(!ota_url_is_https_or_relative("C:/next.bin"));
    CHECK(!ota_url_is_https_or_relative("\\\\attacker.example\\next.bin"));
    CHECK(!ota_url_is_https_or_relative("next file.bin"));

    // ESP-IDF concatenates duplicate Location values internally. The policy must therefore reject
    // the whole response rather than let either the first or last header decide which scheme the
    // client eventually parses.
    OtaRedirectLocationState redirect;
    CHECK(!ota_redirect_location_accepted(redirect));
    ota_redirect_location_observe(redirect, "http://attacker.example/fw.bin");
    CHECK(!ota_redirect_location_accepted(redirect));
    ota_redirect_location_observe(redirect, "https://updates.example/fw.bin");
    CHECK(!ota_redirect_location_accepted(redirect)); // insecure -> secure stays ambiguous

    ota_redirect_location_reset(redirect);
    ota_redirect_location_observe(redirect, "https://updates.example/fw.bin");
    CHECK(ota_redirect_location_accepted(redirect));
    ota_redirect_location_observe(redirect, "http://attacker.example/fw.bin");
    CHECK(!ota_redirect_location_accepted(redirect)); // secure -> insecure stays ambiguous

    ota_redirect_location_reset(redirect);
    ota_redirect_location_observe(redirect, "/fw.bin");
    CHECK(ota_redirect_location_accepted(redirect));
    ota_redirect_location_observe(redirect, "/same-origin.bin");
    CHECK(!ota_redirect_location_accepted(redirect)); // even two secure values are ambiguous

    uint64_t start = 0, end = 0, total = 0;
    CHECK(ota_content_range_parse("bytes 797696-1839103/1839104", start, end, total));
    CHECK(start == 797696 && end == 1839103 && total == 1839104);
    CHECK(ota_content_range_parse("\tbytes\t1-1/2 \t", start, end, total));
    CHECK(start == 1 && end == 1 && total == 2);
    CHECK(!ota_content_range_parse("Bytes 1-1/2", start, end, total));
    CHECK(!ota_content_range_parse("bytes */1839104", start, end, total));
    CHECK(!ota_content_range_parse("bytes 2-1/3", start, end, total));
    CHECK(!ota_content_range_parse("bytes 1-3/3", start, end, total));
    CHECK(!ota_content_range_parse("bytes 1-2/*", start, end, total));
    CHECK(!ota_content_range_parse("bytes 1-2/3, bytes 1-2/3", start, end, total));
    CHECK(!ota_content_range_parse("bytes 18446744073709551616-2/3", start, end, total));
    CHECK(!ota_content_range_parse("bytes 1-2/18446744073709551616", start, end, total));

    OtaContentRangeState range;
    ota_content_range_observe(range, "bytes 797696-1839103/1839104");
    CHECK(ota_content_range_matches(range, 797696, 1839104));
    CHECK(!ota_content_range_matches(range, 797695, 1839104));
    CHECK(!ota_content_range_matches(range, 797696, 1839105));
    ota_content_range_observe(range, "bytes 797696-1839103/1839104");
    CHECK(!ota_content_range_matches(range, 797696, 1839104)); // duplicate stays ambiguous
    ota_content_range_reset(range);
    ota_content_range_observe(range, "bytes 797696-1839102/1839104");
    CHECK(!ota_content_range_matches(range, 797696, 1839104)); // suffix must reach total - 1

    CHECK(ota_transfer_resume_allowed(0, 0, 797696, 1839104, false));
    CHECK(ota_transfer_resume_allowed(1, 797696, 1190912, 1839104, false));
    CHECK(!ota_transfer_resume_allowed(2, 1190912, 1453056, 1839104, false));
    CHECK(!ota_transfer_resume_allowed(1, 797696, 797696, 1839104, false));
    CHECK(!ota_transfer_resume_allowed(0, 0, 0, 1839104, false));
    CHECK(!ota_transfer_resume_allowed(0, 0, 1839104, 1839104, false));
    CHECK(!ota_transfer_resume_allowed(0, 0, 797696, 0, false));
    CHECK(!ota_transfer_resume_allowed(0, 0, 797696, 1839104, true));
}

static void test_heartbeat() {
    const std::string base = "daikin-altherma-esp32", node = device_node_id(base),
                      board = "daikin_abc123"; // installation id + this board's own id
    CHECK(heartbeat_topic(base) ==
          "daikin-altherma-esp32/heartbeat"); // node NOT in the message topic

    // format_uptime: "Ddd+HH:MM:SS.mmm" — 7 days, 21:05:31.860 (a real EMS-ESP heartbeat sample).
    const uint64_t sample_ms = ((7ULL * 24 + 21) * 3600 + 5 * 60 + 31) * 1000 + 860;
    CHECK(format_uptime(sample_ms) == "007+21:05:31.860");
    CHECK(format_uptime(0) == "000+00:00:00.000");

    HeartbeatFields f;
    f.version           = "1.2.3";
    f.platform          = "esp32s3";
    f.uptime_ms         = sample_ms;
    f.free_heap         = 170000;
    f.min_free_heap     = 150000;
    f.max_alloc         = 87000;
    f.reset_reason      = "panic";
    f.reset_reason_code = 4; // CrashReason::PANIC — the numeric twin a metrics store can keep
    f.reset_fault       = true;
    f.wifi_connected    = true;
    f.wifi_rssi         = -76;
    f.wifi_reconnects   = 3;
    f.wifi_mac          = "02:00:00:00:00:01";
    f.wifi_bssid        = "02:00:00:00:00:02";
    f.net_link          = static_cast<uint8_t>(NetLink::Wifi);
    f.mqtt_connected    = true;
    f.mqtt_count        = 89282;
    f.mqtt_fails        = 0;
    f.mqtt_reconnects   = 1;
    f.bus_connected     = true;
    f.bus_proto         = 'I';
    f.registers         = 10;
    f.values            = 48;
    f.crc_err           = 0;
    f.timeout_err       = 2;
    f.rx_received       = 763732;
    f.rx_fails          = 2;
    f.last_ok_s         = 1;
    // #380 — the cycles that produced nothing. The two skip figures are the real 30-day counts off
    // the wired board's syslog (337 publishes, 32 sweeps); mqtt_quiesced is the deliberate
    // hold-off.
    f.mqtt_skipped  = 337;
    f.mqtt_quiesced = 42;
    f.poll_skipped  = 32;
    // The heap watchdog's own ladder position, and the OTHER memory budget. The two stack figures
    // are the real ones off this project's crashes, and they are BYTES: 1872 is the httpd headroom
    // measured on
    // `main` behind the deepest call chain (mcp_post -> http_append_status_json) before -Os, and
    // 520 is what hp_poll had left in the #241 core dump's task table. mqtt is left UNSAMPLED so
    // the same payload pins the null rendering beside two real numbers.
    f.heap_restarts              = 2;
    f.httpd_stack_min_free_bytes = 1872;
    f.poll_stack_min_free_bytes  = 520;
    const std::string j          = build_heartbeat_json(f);
    // FLAT payload: the former wifi/mqtt/bus sub-objects are gone, each field carried under its
    // block name as a prefix (wifi_connected, mqtt_count, bus_rx_received, …). MAC/BSSID ride the
    // wifi_ set.
    CHECK(j == "{\"version\":\"1.2.3\",\"platform\":\"esp32s3\","
               "\"uptime_s\":680731,\"uptime\":\"007+21:05:31.860\","
               "\"free_heap\":170000,\"min_free_heap\":150000,\"max_alloc\":87000,"
               "\"heap_restarts\":2,"
               "\"httpd_stack_min_free_bytes\":1872,\"poll_stack_min_free_bytes\":520,"
               "\"mqtt_stack_min_free_bytes\":null,\"weather_stack_min_free_bytes\":null,"
               "\"reset_reason\":\"panic\",\"reset_reason_code\":4,\"reset_fault\":1,"
               "\"wifi_connected\":1,\"wifi_rssi\":-76,\"wifi_reconnects\":3,"
               "\"wifi_mac\":\"02:00:00:00:00:01\",\"wifi_bssid\":\"02:00:00:00:00:02\","
               "\"net_link\":1,\"eth_present\":0,\"eth_link\":0,"
               "\"mqtt_connected\":1,\"mqtt_count\":89282,\"mqtt_fails\":0,\"mqtt_reconnects\":1,"
               "\"mqtt_skipped\":337,\"mqtt_quiesced\":42,\"poll_skipped\":32,"
               "\"bus_connected\":1,\"bus_proto\":\"I\",\"bus_registers\":10,\"bus_values\":48,"
               "\"bus_last_ok_s\":1,\"bus_rx_received\":763732,\"bus_rx_fails\":2,"
               "\"bus_crc_err\":0,\"bus_timeout_err\":2,\"bus_ou_held_over\":0,"
               "\"bus_tx_reads\":763734,"
               "\"modbus_enabled\":0,\"modbus_connected\":0,\"modbus_rx\":0,\"modbus_fails\":0,"
               "\"modbus_stack_min_free_bytes\":null}");

    // ── #215: the reset reason has to survive a NUMERIC-ONLY consumer ──
    // Telegraf's json parser keeps numeric fields and drops everything else, so the `reset_reason`
    // slug never became a VictoriaMetrics series — and a board restarting 55x in 7 days, 5 of them
    // panics, was unattributable in the store. The slug stays for humans; these two carry the same
    // answer as numbers. Pin that they are UNQUOTED, since a quoted "4" would be dropped exactly
    // like the slug and the fix would look done while changing nothing.
    CHECK(j.find("\"reset_reason_code\":4,") != std::string::npos);
    CHECK(j.find("\"reset_reason_code\":\"") == std::string::npos);
    CHECK(j.find("\"reset_fault\":1,") != std::string::npos);
    CHECK(j.find("\"reset_fault\":true") == std::string::npos); // a bool is dropped like a string
    // The code is the SAME vocabulary /status.last_crash publishes as `reason_code`, so a consumer
    // that learned one table can read both — and reset_fault agrees with crash_reason_is_fault over
    // the whole enum, rather than being a second opinion about what counts as a fault.
    for (uint32_t code = 0; code <= 20; code++) {
        HeartbeatFields rf;
        rf.reset_reason_code = code;
        rf.reset_fault       = crash_reason_is_fault(code);
        const std::string rj = build_heartbeat_json(rf);
        CHECK(rj.find("\"reset_reason_code\":" + std::to_string(code) + ",") != std::string::npos);
        CHECK(rj.find(std::string("\"reset_fault\":") + (crash_reason_is_fault(code) ? "1" : "0") +
                      ",") != std::string::npos);
    }
    // ── #380: the loss has to be COUNTABLE, not just loggable ──
    // 337 dropped publishes and 32 dropped sweeps in 30 days existed only as `/diag` lines in a
    // ring a chatty boot overwrites. Same numeric-consumer rule as reset_reason_code above: quoted,
    // these would be dropped by Telegraf's json parser and the fix would look done while changing
    // nothing.
    CHECK(j.find("\"mqtt_skipped\":337,") != std::string::npos);
    CHECK(j.find("\"mqtt_quiesced\":42,") != std::string::npos);
    CHECK(j.find("\"poll_skipped\":32,") != std::string::npos);
    CHECK(j.find("\"mqtt_skipped\":\"") == std::string::npos);
    CHECK(j.find("\"mqtt_quiesced\":\"") == std::string::npos);
    CHECK(j.find("\"poll_skipped\":\"") == std::string::npos);
    // …and each must reach HA as its own diagnostic entity. A counter with no consumer is how this
    // stayed invisible in the first place, so the payload field alone is not the fix.
    for (const char* path : {"mqtt_skipped", "mqtt_quiesced", "poll_skipped"}) {
        bool found = false;
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++) {
            if (std::string(HEARTBEAT_SENSORS[i].json_path) != path) continue;
            found = true;
            // A since-boot counter, and a reboot ends every episode these count — so HA's long-term
            // statistics must read the reset as a reset, not as a cliff down to zero.
            CHECK(std::string(HEARTBEAT_SENSORS[i].state_class) == "total_increasing");
        }
        CHECK(found);
    }
    // ── The heap watchdog's ladder position has to be ATTRIBUTABLE ──
    // heap_guard.cpp restarts the board with esp_restart(), so the reset reason is the same "sw" a
    // /set_* save produces and reset_fault stays 0 — every other field in this payload agrees that
    // nothing went wrong. Without this count a board cycling its restart ladder every few minutes
    // is indistinguishable in a metrics store from one somebody keeps saving settings on, which is
    // the "reboot nobody can attribute" #215 spent a week reconstructing from syslog.
    CHECK(j.find("\"heap_restarts\":2,") != std::string::npos);
    CHECK(j.find("\"heap_restarts\":\"") == std::string::npos); // quoted, a metrics store drops it
    {
        bool found = false;
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++) {
            if (std::string(HEARTBEAT_SENSORS[i].json_path) != "heap_restarts") continue;
            found = true;
            // MEASUREMENT, never total_increasing: the value is the count this BOOT inherited and
            // heap_guard_begin() clears the breadcrumb, so it returns to 0 on the next healthy
            // boot. Typed monotonic, HA's long-term statistics would read every recovery as a
            // counter reset and report the ladder as a fresh total instead of as the fault it was.
            CHECK(std::string(HEARTBEAT_SENSORS[i].state_class) == "measurement");
        }
        CHECK(found); // an ENTITY, unlike the stack marks below — the OWNER acts on this one
    }

    // ── The STACK is the second memory budget, and it fails silently ──
    // Three overflows shipped (v1.0.12 httpd, #241 hp_poll, #318 httpd through OTA) and every one
    // was diagnosed from a core dump's task table AFTER the board died. Nothing reported headroom
    // while it was alive, so #318's 1200 bytes of frame growth accumulated across releases with no
    // single change announcing it. These five fields are that missing reporting path.
    CHECK(j.find("\"httpd_stack_min_free_bytes\":1872,") != std::string::npos);
    CHECK(j.find("\"poll_stack_min_free_bytes\":520,") != std::string::npos);
    // NEVER SAMPLED IS NULL, NOT ZERO — the load-bearing half. A task that has not run is not a
    // task with no stack left, and the Modbus slot stays unsampled forever on the majority of
    // boards (no HomeHub, no task). Rendered as 0 those boards would publish "0 bytes free" — a
    // plausible number for a stack that does not exist, drawing a flat line at the bottom of the
    // chart this exists to make readable. A null field is DROPPED by a metrics consumer, which is
    // the honest outcome: no sample rather than a false one.
    CHECK(j.find("\"mqtt_stack_min_free_bytes\":null,") != std::string::npos);
    CHECK(j.find("\"weather_stack_min_free_bytes\":null,") != std::string::npos);
    CHECK(j.find("\"modbus_stack_min_free_bytes\":null}") != std::string::npos);
    CHECK(j.find("\"mqtt_stack_min_free_bytes\":0,") == std::string::npos);
    CHECK(j.find("\"weather_stack_min_free_bytes\":0,") == std::string::npos);
    CHECK(j.find("\"modbus_stack_min_free_bytes\":0}") == std::string::npos);
    // A sampled slot is a bare NUMBER, not a string, and the first sample wins even when it is
    // lower than everything after it (append_stack_bytes is the one rendering rule for all five).
    {
        HeartbeatFields sf;
        sf.httpd_stack_min_free_bytes   = 1; // one byte: real, and the closest to the boundary
        sf.weather_stack_min_free_bytes = 1024;
        sf.modbus_stack_min_free_bytes = 731;
        const std::string sj            = build_heartbeat_json(sf);
        CHECK(sj.find("\"httpd_stack_min_free_bytes\":1,") != std::string::npos);
        CHECK(sj.find("\"weather_stack_min_free_bytes\":1024,") != std::string::npos);
        CHECK(sj.find("\"modbus_stack_min_free_bytes\":731}") != std::string::npos);
        CHECK(sj.find("\"httpd_stack_min_free_bytes\":\"") == std::string::npos);
        // Unsampled tasks in the SAME payload still read null, so one running task cannot make the
        // other four look like they were measured.
        CHECK(sj.find("\"poll_stack_min_free_bytes\":null,") != std::string::npos);
        CHECK(sj.find("\"mqtt_stack_min_free_bytes\":null,") != std::string::npos);
    }
    // THE UNIT IS PART OF THE IDENTIFIER, and it is BYTES. ESP-IDF's uxTaskGetStackHighWaterMark
    // answers in bytes where vanilla FreeRTOS answers in words, and this field name becomes the
    // VictoriaMetrics series suffix — so spelling it `_words` would publish a headroom four times
    // larger than the truth in the one metric that exists to warn about running out (the #230
    // LABEL-UNIT rule, applied to a board metric rather than a catalog row). It shipped that way
    // on `modbus_stack_min_free_words` until the arithmetic was checked: a 6144-byte task cannot
    // have 2660 words free. Pin the spelling in BOTH directions so neither can drift back.
    CHECK(j.find("_stack_min_free_words") == std::string::npos);
    for (const char* f : {"httpd", "poll", "mqtt", "weather", "modbus"}) {
        const std::string key = std::string("\"") + f + "_stack_min_free_bytes\":";
        CHECK(j.find(key) != std::string::npos);
    }
    // PAYLOAD-ONLY, deliberately: no HA entity for any of the five. The value is a TREND a
    // maintainer reads across firmware versions, not a fact a device owner acts on, and five
    // permanently-flat diagnostic entities are five more things to rule out — the test that retired
    // "WiFi Quality" and "Device Time".
    for (const char* path :
         {"httpd_stack_min_free_bytes", "poll_stack_min_free_bytes", "mqtt_stack_min_free_bytes",
          "weather_stack_min_free_bytes", "modbus_stack_min_free_bytes"}) {
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
            CHECK(std::string(HEARTBEAT_SENSORS[i].json_path) != path);
    }

    // The two always-zero bus counters are gone: the X10A protocol has no write command, so they
    // could never be anything but 0. Neither was ever an HA entity, so nothing is orphaned.
    CHECK(j.find("bus_tx_writes") == std::string::npos);
    CHECK(j.find("bus_tx_fails") == std::string::npos);
    CHECK(j.find("\"bus_tx_reads\":") != std::string::npos); // the real one stays

    // Modbus TCP (HomeHub) link — payload-only fields. Connectivity and every boolean
    // fact use numeric 1/0 so a metrics consumer keeps them.
    CHECK(j.find("\"modbus_connected\":0,") != std::string::npos);
    CHECK(j.find("\"modbus_connected\":false") == std::string::npos); // number, not a dropped bool
    // Room-source and heating-curve domain data have their own topic and grouped payload. Nothing
    // from that contract may leak back into the technical heartbeat.
    CHECK(j.find("room_source") == std::string::npos);
    CHECK(j.find("room_temperature") == std::string::npos);
    CHECK(j.find("heating_curve") == std::string::npos);
    CHECK(heating_curve_topic(base) == "daikin-altherma-esp32/heating_curve");
    HeatingCurveMqttFields cf;
    cf.room_temperature_valid            = true;
    cf.room_setpoint_valid               = true;
    cf.room_control_eligible             = true;
    cf.room_has_source_time              = true;
    cf.room_age_known                    = true;
    cf.room_temperature_c                = 20.5;
    cf.room_setpoint_c                   = 22.0;
    cf.room_error_k                      = 1.5;
    cf.room_source_unix_s                = 1785830400;
    cf.room_age_s                        = 17;
    cf.room_reason_code                  = static_cast<uint8_t>(ReferenceRoomReason::Eligible);
    cf.room_messages                     = 42;
    cf.room_errors                       = 2;
    cf.room_rejections                   = 7;
    cf.method_version                    = 2;
    cf.armed                             = true;
    cf.state                             = 3;
    cf.reason                            = 10;
    cf.sample_eligible                   = true;
    cf.forecast_available                = true;
    cf.outdoor_available                 = true;
    cf.outdoor_source                    = logic::OutdoorSource::Env3;
    cf.has_last_sample_outdoor           = true;
    cf.last_sample_outdoor_temperature_c = -4.25;
    cf.last_sample_outdoor_source        = logic::OutdoorSource::Env3;
    cf.plant_outdoor_available           = true;
    cf.plant_outdoor_source              = logic::OutdoorSource::HomeHub;
    cf.has_last_sample_plant_outdoor     = true;
    cf.last_sample_plant_outdoor_temperature_c = -5.5;
    cf.last_sample_plant_outdoor_source        = logic::OutdoorSource::HomeHub;
    cf.plant_gate_known                        = true;
    cf.plant_gate_active                       = true;
    cf.heating_mode_known                      = true;
    cf.heating_mode_active                     = true;
    cf.has_current_room_error                  = true;
    cf.has_last_sample                         = true;
    cf.has_diagnosis_room_source_time          = true;
    cf.diagnosis_room_age_known                = true;
    cf.current_room_error_k                    = -2.9;
    cf.last_sample_room_error_k                = -2.8;
    cf.diagnosis_room_source_unix_s            = 1770000000;
    cf.diagnosis_room_age_s                    = 12;
    cf.last_sample_unix_s                      = 1770000001;
    cf.sequence                                = 7;
    cf.evaluations                             = 12;
    cf.samples                                 = 7;
    cf.holds                                   = 2;
    cf.blocks                                  = 3;
    const std::string cj                       = build_heating_curve_mqtt_json(cf);
    CHECK(cj == "{\"schema_version\":3,\"room\":{"
                "\"source_id\":\"living_room\",\"calibration_k\":0,"
                "\"temperature_valid\":1,\"setpoint_valid\":1,\"control_eligible\":1,"
                "\"temperature_c\":20.500000,\"setpoint_c\":22.000000,\"error_k\":1.500000,"
                "\"source_unix_s\":1785830400,\"age_s\":17,\"reason_code\":0,"
                "\"counters\":{\"messages\":42,\"errors\":2,\"rejections\":7}},"
                "\"diagnosis\":{\"method_version\":2,\"armed\":1,\"state\":3,\"reason\":10,"
                "\"sample_eligible\":1,\"forecast_available\":1,\"outdoor_available\":1,"
                "\"outdoor_source\":\"env3\",\"outdoor_source_code\":3,"
                "\"plant_outdoor_available\":1,\"plant_outdoor_source\":\"homehub\","
                "\"plant_outdoor_source_code\":2,"
                "\"gates\":{\"plant_known\":1,\"plant_active\":1,"
                "\"heating_mode_known\":1,\"heating_mode_active\":1},"
                "\"room_evidence\":{\"current_error_k\":-2.900000,"
                "\"source_unix_s\":1770000000,\"age_s\":12},"
                "\"last_sample\":{\"room_error_k\":-2.800000,"
                "\"outdoor_temperature_c\":-4.250000,\"outdoor_source\":\"env3\","
                "\"outdoor_source_code\":3,\"plant_outdoor_temperature_c\":-5.500000,"
                "\"plant_outdoor_source\":\"homehub\",\"plant_outdoor_source_code\":2,"
                "\"unix_s\":1770000001,"
                "\"sequence\":7},\"counters\":{\"evaluations\":12,\"samples\":7,"
                "\"holds\":2,\"blocks\":3}}}");
    CHECK(cj.find("lwt_controller_") == std::string::npos);
    const std::string empty_curve = build_heating_curve_mqtt_json(HeatingCurveMqttFields{});
    CHECK(empty_curve.find("\"temperature_c\":null") != std::string::npos);
    CHECK(empty_curve.find("\"setpoint_c\":null") != std::string::npos);
    CHECK(empty_curve.find("\"current_error_k\":null") != std::string::npos);
    CHECK(empty_curve.find("\"room_error_k\":null") != std::string::npos);
    // No sensor -> null, never 0: a metrics consumer must not read absence as a freezing day.
    CHECK(empty_curve.find("\"outdoor_available\":0") != std::string::npos);
    CHECK(empty_curve.find("\"outdoor_temperature_c\":null") != std::string::npos);
    CHECK(empty_curve.find("\"plant_outdoor_available\":0") != std::string::npos);
    CHECK(empty_curve.find("\"plant_outdoor_temperature_c\":null") != std::string::npos);
    CHECK(empty_curve.find("\"plant_outdoor_source\":\"none\"") != std::string::npos);
    CHECK(empty_curve.find("\"unix_s\":null") != std::string::npos);
    CHECK(empty_curve.find("true") == std::string::npos);
    CHECK(empty_curve.find("false") == std::string::npos);
    HeartbeatFields mf;
    mf.modbus_enabled              = true;
    mf.modbus_connected            = true;
    mf.modbus_rx                   = 12;
    mf.modbus_fails                = 3;
    mf.modbus_stack_min_free_bytes = 731;
    const std::string mj           = build_heartbeat_json(mf);
    CHECK(mj.find("\"modbus_enabled\":1,") != std::string::npos);
    CHECK(mj.find("\"modbus_connected\":1,") != std::string::npos);
    CHECK(mj.find("\"modbus_rx\":12,") != std::string::npos);
    CHECK(mj.find("\"modbus_fails\":3,") != std::string::npos);
    // Last field of the payload now that the actuator block is gone (#294) — hence the closing
    // brace rather than a comma, which is itself the assertion that nothing follows it.
    CHECK(mj.find("\"modbus_stack_min_free_bytes\":731}") != std::string::npos);

    // SOURCE freshness is its own field, and it is independent of bus health (#209 defect 5): the
    // link is up, the device is publishing, and the outdoor unit is simply not measuring. A
    // consumer that only had bus_connected would read the vanished outdoor keys as a broken link.
    f.ou_held_over = true;
    CHECK(build_heartbeat_json(f).find("\"bus_connected\":1,") != std::string::npos);
    CHECK(build_heartbeat_json(f).find("\"bus_ou_held_over\":1,") != std::string::npos);
    f.ou_held_over = false;

    // The SNTP wall clock and the dBm->% remap are gone from the payload with the two entities they
    // fed (RETIRED_HEARTBEAT_SENSORS). `time` said what HA's own last_updated already said, at one
    // recorder row per heartbeat; `wifi_quality_pct` was 2*(rssi+100) beside the rssi it was
    // computed from. Pinned as ABSENT, since either one lingering in the payload is the duplicate
    // surviving where nobody looks at it any more.
    CHECK(j.find("\"time\"") == std::string::npos);
    CHECK(j.find("wifi_quality") == std::string::npos);
    // ...and the facts themselves are still reported, one place each: the clock on /status.ntp
    // (+ every syslog TIMESTAMP), the signal as the dBm it was always derived from.
    CHECK(j.find("\"wifi_rssi\":-76,") != std::string::npos);

    // WiFi down -> rssi/bssid reported null, not a stale/garbage reading; mac still present.
    HeartbeatFields down;
    down.wifi_connected  = false;
    down.wifi_rssi       = -50;                 // stale value must not leak into the JSON
    down.wifi_mac        = "02:00:00:00:00:01"; // this STA's own MAC — known even while offline
    const std::string dj = build_heartbeat_json(down);
    CHECK(dj.find("\"wifi_rssi\":null") != std::string::npos);
    CHECK(dj.find("\"wifi_mac\":\"02:00:00:00:00:01\"") != std::string::npos);
    CHECK(dj.find("\"wifi_bssid\":null") != std::string::npos); // no AP while offline
    // The connectivity flags are 1/0 NUMBERS in both directions — never JSON bools, which a metrics
    // consumer drops exactly like it drops a string (these three were the only heartbeat fields
    // missing from VictoriaMetrics before this).
    CHECK(dj.find("\"wifi_connected\":0") != std::string::npos);
    CHECK(dj.find("\"mqtt_connected\":0") != std::string::npos);
    CHECK(dj.find("\"bus_connected\":0") != std::string::npos);
    CHECK(dj.find("true") == std::string::npos);
    CHECK(dj.find("false") == std::string::npos);

    // Diagnostic discovery: separate topics/component types, entity_category diagnostic, and the
    // value_template points at the heartbeat topic (not a heat-pump source topic).
    const std::string hb = heartbeat_topic(base);
    const std::string av = availability_topic(base);
    // -2: device_time, wifi_quality (RETIRED_HEARTBEAT_SENSORS); +3 in #380: mqtt_skipped,
    // mqtt_quiesced, poll_skipped — the cycles that produced nothing; +1: heap_restarts, the only
    // field that can attribute the heap watchdog's "sw" reset. The five stack watermarks landed in
    // the same change and deliberately added NOTHING here — they are payload-only, so this pin
    // rising by one rather than six is itself the assertion that the split held.
    CHECK(HEARTBEAT_SENSOR_COUNT == 22);
    const HeartbeatSensor& rssi = HEARTBEAT_SENSORS[0];
    CHECK(std::string(rssi.object_id) == "wifi_signal");
    std::string dt = heartbeat_discovery_topic("homeassistant", node, rssi);
    CHECK(dt == "homeassistant/sensor/daikin_altherma_esp32/wifi_signal/config");
    std::string dc = heartbeat_discovery_config(node, board, hb, av, rssi);
    CHECK(dc.find("\"stat_t\":\"daikin-altherma-esp32/heartbeat\"") != std::string::npos);
    CHECK(dc.find("\"val_tpl\":\"{{ value_json.wifi_rssi }}\"") != std::string::npos); // flat key
    CHECK(dc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
    CHECK(dc.find("\"dev_cla\":\"signal_strength\"") != std::string::npos);
    CHECK(dc.find("\"stat_cla\":\"measurement\"") != std::string::npos);

    // The binary_sensor (bus_status) lands under the binary_sensor component, not sensor, and has
    // no stat_cla (not a numeric measurement).
    const HeartbeatSensor* bus = nullptr;
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
        if (std::string(HEARTBEAT_SENSORS[i].object_id) == "bus_status")
            bus = &HEARTBEAT_SENSORS[i];
    CHECK(bus != nullptr);
    CHECK(heartbeat_discovery_topic("homeassistant", node, *bus) ==
          "homeassistant/binary_sensor/daikin_altherma_esp32/bus_status/config");
    std::string busc = heartbeat_discovery_config(node, board, hb, av, *bus);
    CHECK(busc.find("val_tpl\":\"{{ value_json.bus_connected }}") != std::string::npos); // flat key
    CHECK(busc.find("\"stat_cla\"") == std::string::npos);
    // ...and it must declare the 1/0 payload contract. Without this the entity inherits HA's
    // "ON"/"OFF" defaults, matches neither 1/0 nor the `True`/`False` a JSON bool rendered as, and
    // sits at `unknown` forever — silently, since a non-matching payload is simply ignored.
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
    CHECK(heartbeat_discovery_config(node, board, hb, av, *mc)
              .find("\"stat_cla\":\"total_increasing\"") != std::string::npos);

    // The three device-health entities added alongside /status.sys (issue #5): reset_reason is a
    // plain text sensor (no unit / device_class / state_class), min_free_heap + max_alloc are byte
    // measurements. All diagnostic, all sourced from the heartbeat topic.
    auto find_hb = [](const char* oid) -> const HeartbeatSensor* {
        for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
            if (std::string(HEARTBEAT_SENSORS[i].object_id) == oid) return &HEARTBEAT_SENSORS[i];
        return nullptr;
    };
    // wifi_mac / wifi_bssid: plain text diagnostics (no unit/device_class/state_class), read from
    // the flat wifi_ keys — which board, which AP.
    for (const char* oid : {"wifi_mac", "wifi_bssid"}) {
        const HeartbeatSensor* h = find_hb(oid);
        CHECK(h != nullptr);
        const std::string hc = heartbeat_discovery_config(node, board, hb, av, *h);
        CHECK(hc.find(std::string("\"val_tpl\":\"{{ value_json.") + oid + " }}\"") !=
              std::string::npos);
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
    CHECK(rrc.find("\"unit_of_meas\"") == std::string::npos); // text: no unit
    CHECK(rrc.find("\"dev_cla\"") == std::string::npos);      // ...no device_class
    CHECK(rrc.find("\"stat_cla\"") == std::string::npos);     // ...no state_class

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
        CHECK(heartbeat_discovery_topic("homeassistant", r.component, node, r.object_id) ==
              std::string("homeassistant/") + r.component + "/" + node + "/" + r.object_id +
                  "/config");
    }
    // The two surviving WiFi entities are the ones that carry their own reading: dBm from the
    // radio, and the reconnect counter. Neither is derivable from the other.
    CHECK(find_hb("wifi_signal") != nullptr && find_hb("wifi_reconnects") != nullptr);

    // Heap low-water mark + largest free block: bytes, "measurement" (a fluctuating gauge, NOT a
    // since-boot counter), diagnostic, sourced from the flat payload fields (not a nested object).
    for (const char* oid : {"min_free_heap", "max_alloc"}) {
        const HeartbeatSensor* h = find_hb(oid);
        CHECK(h != nullptr);
        const std::string hc = heartbeat_discovery_config(node, board, hb, av, *h);
        CHECK(hc.find(std::string("\"val_tpl\":\"{{ value_json.") + oid + " }}\"") !=
              std::string::npos);
        CHECK(hc.find("\"unit_of_meas\":\"B\"") != std::string::npos);
        CHECK(hc.find("\"stat_cla\":\"measurement\"") != std::string::npos);
        CHECK(hc.find("\"ent_cat\":\"diagnostic\"") != std::string::npos);
        CHECK(hc.find("\"dev_cla\"") == std::string::npos); // raw bytes, no device_class
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
    // crash HA entity and the heartbeat must never disagree on how a reset is named). If a future
    // edit splits them into two tables, this fails for the first code that diverges.
    for (int code = -1; code <= 20; code++)
        CHECK(std::string(reset_reason_name(code)) ==
              std::string(crash_reason_slug(static_cast<uint32_t>(code))));
}

static void test_boot_guard() {
    // Threshold rule (issue #6): safe mode on the Nth crash boot, no off-by-one (the counter is
    // bumped BEFORE the check, so with threshold 4 the 4th crash makes fail_count == threshold).
    CHECK(!boot_should_enter_safe_mode(0, 4));
    CHECK(!boot_should_enter_safe_mode(3, 4));
    CHECK(boot_should_enter_safe_mode(4, 4));
    CHECK(boot_should_enter_safe_mode(5, 4));
    CHECK(boot_should_enter_safe_mode(BOOT_FAIL_THRESHOLD)); // default threshold
    CHECK(!boot_should_enter_safe_mode(BOOT_FAIL_THRESHOLD - 1));

    // Saturating increment; a corrupt (negative or absurdly large) / first-run read starts from 0.
    CHECK(boot_next_fail_count(0) == 1);
    CHECK(boot_next_fail_count(3) == 4);
    CHECK(boot_next_fail_count(-1) == 1);
    CHECK(boot_next_fail_count(-999999) == 1);
    // A value ABOVE the cap is never written, so reading one means corruption -> treated as 0 -> 1.
    CHECK(boot_next_fail_count(BOOT_FAIL_MAX + 500) == 1);
    CHECK(boot_next_fail_count(BOOT_FAIL_MAX) == BOOT_FAIL_MAX); // saturates at the cap
    CHECK(boot_next_fail_count(BOOT_FAIL_MAX - 1) == BOOT_FAIL_MAX);

    // A crash-loop from a clean start reaches safe mode EXACTLY on the 4th crash boot, not before.
    int c = 0;
    for (int i = 0; i < BOOT_FAIL_THRESHOLD - 1; i++) {
        c = boot_next_fail_count(c);
        CHECK(!boot_should_enter_safe_mode(c));
    }
    c = boot_next_fail_count(c);
    CHECK(c == BOOT_FAIL_THRESHOLD && boot_should_enter_safe_mode(c));

    // The healthy-uptime timer arms on an ordinary boot and is REFUSED while safe mode is latched.
    CHECK(boot_healthy_timer_arms(false));
    CHECK(!boot_healthy_timer_arms(true));

    // The PROPERTY that condition exists for, asserted over a run of boots rather than as two
    // return values: once safe mode is latched, a further crash reset must still find the counter
    // above the threshold and re-latch at once. Arming the timer in safe mode zeroes that counter
    // BOOT_HEALTHY_S into the recovery boot, so the next crash starts from scratch and the device
    // brings the full stack — the configuration already proven to crash four times — back up for
    // another BOOT_FAIL_THRESHOLD rounds. Run with the guard and without it, and count the boots
    // that started the poll engine + MQTT.
    auto full_stack_boots = [](bool arm_in_safe_mode) {
        int  fails      = 0;
        bool latched    = false;
        bool was_crash  = false;
        int  full_stack = 0;
        for (int i = 0; i < 12; i++) {
            // safe_mode_begin()
            if (was_crash) {
                fails   = boot_next_fail_count(fails);
                latched = boot_should_enter_safe_mode(fails);
            } else {
                fails   = 0;
                latched = false;
            }
            if (!latched) full_stack++;
            // safe_mode_arm_healthy(), then BOOT_HEALTHY_S of uptime. A full-stack boot never
            // reaches it here (the fault takes the device down first); a safe-mode boot always
            // does.
            if ((arm_in_safe_mode || boot_healthy_timer_arms(latched)) && latched) fails = 0;
            was_crash = true; // the fault also lives behind a subsystem safe mode keeps running
        }
        return full_stack;
    };
    // Guarded: exactly BOOT_FAIL_THRESHOLD full-stack boots, then it parks for good — a latch.
    CHECK(full_stack_boots(/*arm_in_safe_mode=*/false) == BOOT_FAIL_THRESHOLD);
    // Unguarded (the shipped defect): every safe-mode boot throws the evidence away, so the device
    // keeps returning to the configuration that crashed it — strictly more full-stack boots.
    CHECK(full_stack_boots(/*arm_in_safe_mode=*/true) > BOOT_FAIL_THRESHOLD);

    // Crash classification: ONLY panic / int-wdt / task-wdt / other-wdt / brownout accumulate.
    CHECK(boot_reset_was_crash(4)); // panic
    CHECK(boot_reset_was_crash(5)); // int_wdt
    CHECK(boot_reset_was_crash(6)); // task_wdt
    CHECK(boot_reset_was_crash(7)); // other_wdt
    CHECK(boot_reset_was_crash(9)); // brownout
    // Clean / intentional / non-config faults do NOT — a provisioning burst is reset reason "sw"
    // (3), and power-glitch (14) / CPU-lockup (15) are hardware faults a config change can't fix,
    // so unlike crash_reason_is_fault() this set deliberately excludes them.
    CHECK(!boot_reset_was_crash(1));  // poweron
    CHECK(!boot_reset_was_crash(2));  // ext
    CHECK(!boot_reset_was_crash(3));  // sw (config-save / OTA reboot)
    CHECK(!boot_reset_was_crash(8));  // deepsleep
    CHECK(!boot_reset_was_crash(14)); // pwr_glitch
    CHECK(!boot_reset_was_crash(15)); // cpu_lockup
    CHECK(!boot_reset_was_crash(0));  // unknown
    // Consistency with the shared reset vocabulary: the crash codes boot_guard counts are a SUBSET
    // of crashinfo's fault set (both agree these five are faults), guarding against the enum
    // drifting apart.
    for (int code : {4, 5, 6, 7, 9})
        CHECK(boot_reset_was_crash(code) && crash_reason_is_fault(code));
}

static void test_heap_watchdog() {
    // A healthy heap says nothing, repeatedly. `Ok` twice over is the state the device is in for
    // essentially its whole life, so it must cost no log line and no state change.
    HeapWatchdog w;
    CHECK(heap_watch(w, {HEAP_CRITICAL_BYTES, 1000, false}).action == HeapAction::Ok);
    CHECK(heap_watch(w, {64 * 1024, 2000, false}).action == HeapAction::Ok);
    CHECK(!w.critical);

    // Dropping below the threshold ARMS a run; staying below WATCHES it; the elapsed time reported
    // is the run's own, not the configured hold.
    HeapVerdict v = heap_watch(w, {HEAP_CRITICAL_BYTES - 1, 10000, false});
    CHECK(v.action == HeapAction::Armed && v.critical_ms == 0 && w.critical);
    v = heap_watch(w, {512, 70000, false});
    CHECK(v.action == HeapAction::Watching && v.critical_ms == 60000);
    CHECK(heap_restart_in_ms(v.critical_ms) == HEAP_CRITICAL_HOLD_MS - 60000);

    // Merely TOUCHING the arm threshold does NOT end the run. This CHECK used to assert the
    // opposite, and asserting the opposite is what #399 was: on hardware a heap hovering at exactly
    // HEAP_CRITICAL_BYTES ended its run every second or two, reset the 300 s clock, and never
    // restarted — while /status and /values were already answering 503, i.e. while the device was
    // in the very wedge the watchdog exists to escape.
    v = heap_watch(w, {HEAP_CRITICAL_BYTES, 90000, false});
    CHECK(v.action == HeapAction::Watching && w.critical);

    // Climbing clear of the BAND ends it — and reports how long it ran, which is the difference
    // between "the device healed itself" and a silence the reader has to interpret.
    v = heap_watch(w, {HEAP_RECOVERY_BYTES, 95000, false});
    CHECK(v.action == HeapAction::Recovered && v.critical_ms == 85000 && !v.ota_excused);
    CHECK(!w.critical);
    // ...and the NEXT healthy sample is silent again rather than repeating the recovery.
    CHECK(heap_watch(w, {64 * 1024, 96000, false}).action == HeapAction::Ok);

    // The hold has to ELAPSE. One sample short is still Watching; reaching it exactly fires.
    HeapWatchdog h;
    CHECK(heap_watch(h, {0, 0, false}).action == HeapAction::Armed);
    CHECK(heap_watch(h, {0, HEAP_CRITICAL_HOLD_MS - 1, false}).action == HeapAction::Watching);
    v = heap_watch(h, {0, HEAP_CRITICAL_HOLD_MS, false});
    CHECK(v.action == HeapAction::Restart && v.critical_ms == HEAP_CRITICAL_HOLD_MS);
    CHECK(heap_restart_in_ms(v.critical_ms) == 0);
    // A fired run keeps firing while it lasts (the sample site decides whether it may still act),
    // and the countdown saturates at 0 instead of wrapping into a ~49-day figure.
    CHECK(heap_watch(h, {0, HEAP_CRITICAL_HOLD_MS * 2, false}).action == HeapAction::Restart);
    CHECK(heap_restart_in_ms(HEAP_CRITICAL_HOLD_MS + 1) == 0);

    // A 32-bit millisecond wrap inside the hold window must measure the TRUE elapsed time. Naive
    // signed subtraction would go hugely negative here and never fire; naive unsigned comparison of
    // absolute values would fire instantly. Arm 1 s before the wrap, then sample 1 s after it.
    HeapWatchdog   wrap;
    const uint32_t before = 0xFFFFFFFFu - 999u;
    CHECK(heap_watch(wrap, {0, before, false}).action == HeapAction::Armed);
    v = heap_watch(wrap, {0, 1000u, false});
    CHECK(v.action == HeapAction::Watching && v.critical_ms == 2000);

    // An OTA holds the largest allocations this firmware ever makes, so a low reading during one
    // proves nothing. It CLEARS the run rather than pausing it: a run that started before the
    // download must not resume its clock afterwards and fire mid-install.
    HeapWatchdog o;
    CHECK(heap_watch(o, {0, 0, false}).action == HeapAction::Armed);
    v = heap_watch(o, {0, 60000, /*ota_busy=*/true});
    CHECK(v.action == HeapAction::Recovered && v.ota_excused && v.critical_ms == 60000);
    CHECK(!o.critical);
    // The clock really did restart: HEAP_CRITICAL_HOLD_MS after the EXCUSAL is only Armed+Watching,
    // where a merely-paused run would already have fired.
    CHECK(heap_watch(o, {0, 61000, false}).action == HeapAction::Armed);
    CHECK(heap_watch(o, {0, 61000 + HEAP_CRITICAL_HOLD_MS - 1, false}).action ==
          HeapAction::Watching);
    // An OTA running while the heap is HEALTHY again is an ordinary recovery, not an excusal — the
    // two get different sentences in the log, so they must not collapse into one flag.
    HeapWatchdog e;
    CHECK(heap_watch(e, {0, 0, false}).action == HeapAction::Armed);
    v = heap_watch(e, {64 * 1024, 1000, /*ota_busy=*/true});
    CHECK(v.action == HeapAction::Recovered && !v.ota_excused);

    // OSCILLATION across the threshold — the input class that had NO coverage here, and the one a
    // real heap actually presents on its way down (#399). Every CHECK above feeds a monotonic
    // scripted sequence; a heap hovering AT HEAP_CRITICAL_BYTES was found on hardware to end its
    // run every second or two, reset the 300 s clock and never restart, while /status and /values
    // were already answering 503. The run must SURVIVE the flicker.
    HeapWatchdog osc;
    CHECK(heap_watch(osc, {HEAP_CRITICAL_BYTES - 512, 0, false}).action == HeapAction::Armed);
    for (uint32_t t = 1000; t < HEAP_CRITICAL_HOLD_MS; t += 1000) {
        // Alternate either side of the ARM threshold, exactly as the board did. Touching
        // HEAP_CRITICAL_BYTES is not a recovery; only clearing HEAP_RECOVERY_BYTES is.
        const size_t block = (t / 1000) % 2 ? HEAP_CRITICAL_BYTES : HEAP_CRITICAL_BYTES - 512;
        CHECK(heap_watch(osc, {block, t, false}).action == HeapAction::Watching);
    }
    CHECK(heap_watch(osc, {HEAP_CRITICAL_BYTES, HEAP_CRITICAL_HOLD_MS, false}).action ==
          HeapAction::Restart);

    // ...and the band is a BAND, not a second threshold to sit on: clearing it really does end the
    // run, or the fix would have turned a watchdog that never fires into one that never stops.
    HeapWatchdog band;
    CHECK(heap_watch(band, {0, 0, false}).action == HeapAction::Armed);
    CHECK(heap_watch(band, {HEAP_RECOVERY_BYTES - 1, 1000, false}).action == HeapAction::Watching);
    CHECK(heap_watch(band, {HEAP_RECOVERY_BYTES, 2000, false}).action == HeapAction::Recovered);
    // Inside the band with no run open: neither arms nor narrates. Ok, both sides of the arm line.
    CHECK(heap_watch(band, {HEAP_CRITICAL_BYTES, 3000, false}).action == HeapAction::Ok);
    CHECK(heap_watch(band, {HEAP_RECOVERY_BYTES - 1, 4000, false}).action == HeapAction::Ok);
    // Below the ARM threshold it still arms — the band must not have raised the bar for arming.
    CHECK(heap_watch(band, {HEAP_CRITICAL_BYTES - 1, 5000, false}).action == HeapAction::Armed);

    // The excusal keys on the RECOVERY level too, or an OTA during a flicker would be filed as the
    // heap having healed: inside the band the heap has NOT climbed clear, so the OTA is what ended
    // the run and the log must say so.
    HeapWatchdog ox;
    CHECK(heap_watch(ox, {0, 0, false}).action == HeapAction::Armed);
    v = heap_watch(ox, {HEAP_RECOVERY_BYTES - 1, 1000, /*ota_busy=*/true});
    CHECK(v.action == HeapAction::Recovered && v.ota_excused);

    CHECK(HEAP_RECOVERY_BYTES > HEAP_CRITICAL_BYTES);

    // THE END OF THE LADDER (#407): the boot that inherits the full count comes up MINIMAL, and
    // every boot below it comes up normally. Composed from heap_may_restart rather than restated,
    // so the ladder and its ending cannot disagree about where the cap is.
    for (uint8_t n = 0; n < HEAP_MAX_CONSECUTIVE_RESTARTS; n++)
        CHECK(!heap_boot_must_be_minimal(n));
    CHECK(heap_boot_must_be_minimal(HEAP_MAX_CONSECUTIVE_RESTARTS));
    CHECK(heap_boot_must_be_minimal(255));
    // An ordinary boot is never minimal — the common case, and the one a wrong rule would punish.
    CHECK(!heap_boot_must_be_minimal(0));
    // The two halves must agree in BOTH directions, or a boot could be told to restart AND to come
    // up minimal, or neither.
    for (int n = 0; n <= 255; n++) {
        const uint8_t c = static_cast<uint8_t>(n);
        CHECK(heap_may_restart(c) != heap_boot_must_be_minimal(c));
    }
    // A garbled breadcrumb must fail towards a NORMAL boot, never into safe mode: forcing safe mode
    // takes away the heat pump readings that are the point of the device. This is the asymmetry
    // heap_restart_count_sane already states, seen from the consumer that would suffer from it.
    CHECK(!heap_boot_must_be_minimal(heap_restart_count_sane(-1)));
    CHECK(!heap_boot_must_be_minimal(heap_restart_count_sane(2147483647)));
    CHECK(!heap_boot_must_be_minimal(heap_restart_count_sane(HEAP_MAX_CONSECUTIVE_RESTARTS + 1)));
    // ...but a breadcrumb that legitimately reads the cap still does.
    CHECK(heap_boot_must_be_minimal(heap_restart_count_sane(HEAP_MAX_CONSECUTIVE_RESTARTS)));

    // The restart LADDER is bounded, and the bound is on the count that PRECEDED this boot.
    for (uint8_t n = 0; n < HEAP_MAX_CONSECUTIVE_RESTARTS; n++) CHECK(heap_may_restart(n));
    CHECK(!heap_may_restart(HEAP_MAX_CONSECUTIVE_RESTARTS));
    CHECK(!heap_may_restart(255));

    // The persisted breadcrumb can only ever UNDER-count. Over-counting would SUPPRESS a restart
    // the device needs, so every unusable value reads as 0 rather than as the cap.
    CHECK(heap_restart_count_sane(0) == 0);
    CHECK(heap_restart_count_sane(3) == 3);
    CHECK(heap_restart_count_sane(HEAP_MAX_CONSECUTIVE_RESTARTS) == HEAP_MAX_CONSECUTIVE_RESTARTS);
    CHECK(heap_restart_count_sane(-1) == 0);
    CHECK(heap_restart_count_sane(-999999) == 0);
    CHECK(heap_restart_count_sane(HEAP_MAX_CONSECUTIVE_RESTARTS + 1) == 0);
    CHECK(heap_restart_count_sane(2147483647) == 0);
    // A sane count always leaves the ladder able to act — the whole point of failing this way
    // round.
    CHECK(heap_may_restart(heap_restart_count_sane(2147483647)));

    // The threshold is stated in the units the sample is taken in, and sits far below the smallest
    // contiguous block this firmware's own pre-flight (http_config.cpp) will start work at.
    CHECK(HEAP_CRITICAL_BYTES < 12u * 1024u);
}

static void test_health_gate() {
    // base=90s, cap=300s. A normal boot needs link + service proof; a real portal is its own
    // recovery surface for an unconfigured board.
    const int              base = 90, cap = 300;
    const OtaServiceHealth healthy_wifi{
        .link       = NetLink::Wifi,
        .heap_ready = true,
    };
    const OtaServiceHealth healthy_eth{
        .link       = NetLink::Eth,
        .heap_ready = true,
    };
    // Not yet at the base window -> keep waiting even if already online.
    CHECK(health_gate_decide(0, base, cap, healthy_wifi) == HealthVerdict::Wait);
    CHECK(health_gate_decide(85, base, cap, healthy_wifi) == HealthVerdict::Wait);
    // Past the base window AND online -> commit (seal image in, cancel rollback). The Ethernet case
    // is load-bearing: a wired boot intentionally never starts STA even when an SSID is stored.
    CHECK(health_gate_decide(90, base, cap, healthy_wifi) == HealthVerdict::Commit);
    CHECK(health_gate_decide(90, base, cap, healthy_eth) == HealthVerdict::Commit);
    CHECK(health_gate_decide(120, base, cap, healthy_eth) == HealthVerdict::Commit);
    OtaServiceHealth fragmented = healthy_wifi;
    fragmented.heap_ready       = false;
    CHECK(health_gate_decide(90, base, cap, fragmented) == HealthVerdict::Wait);
    OtaServiceHealth skipped    = healthy_wifi;
    skipped.allocation_failures = true;
    CHECK(health_gate_decide(90, base, cap, skipped) == HealthVerdict::Wait);
    OtaServiceHealth x10a_wait = healthy_wifi;
    x10a_wait.x10a_required    = true;
    CHECK(health_gate_decide(90, base, cap, x10a_wait) == HealthVerdict::Wait);
    x10a_wait.x10a_published = true;
    CHECK(health_gate_decide(90, base, cap, x10a_wait) == HealthVerdict::Commit);
    // No transport and no portal -> wait until the hard cap, then leave rollback armed.
    const OtaServiceHealth offline{};
    CHECK(health_gate_decide(90, base, cap, offline) == HealthVerdict::Wait);
    CHECK(health_gate_decide(295, base, cap, offline) == HealthVerdict::Wait);
    CHECK(health_gate_decide(300, base, cap, offline) == HealthVerdict::GiveUp);
    // A portal that is actually running is a valid recovery surface after the base window.
    OtaServiceHealth portal{};
    portal.recovery_surface = true;
    CHECK(health_gate_decide(90, base, cap, portal) == HealthVerdict::Commit);
    CHECK(health_gate_decide(0, base, cap, portal) == HealthVerdict::Wait);
    // Critical wired/no-SSID loss: lack of credentials does not invent a portal that boot kept off.
    CHECK(health_gate_decide(90, base, cap, offline) != HealthVerdict::Commit);
    CHECK(ota_health_heap_ready(24u * 1024u, 16u * 1024u));
    CHECK(!ota_health_heap_ready(24u * 1024u - 1, 16u * 1024u));
    CHECK(!ota_health_heap_ready(24u * 1024u, 16u * 1024u - 1));
}

static void test_board_pins() {
    auto has = [](BoardPins b, int p) {
        for (int i = 0; i < b.count; i++)
            if (b.pins[i] == p) return true;
        return false;
    };
    // Conservative (octal_spi=true, the default): chip-safe minus SPI flash, Octal PSRAM/flash,
    // strapping, USB-JTAG and dedicated JTAG. GPIO43/44 (the X10A Kconfig defaults) stay present.
    BoardPins s3 = board_pins("esp32s3");
    CHECK(s3.count == 23);
    CHECK(has(s3, 43) && has(s3, 44));
    CHECK(!has(s3, 33) && !has(s3, 34) && !has(s3, 35) && !has(s3, 36) &&
          !has(s3, 37));                                               // Octal SPI
    CHECK(!has(s3, 0) && !has(s3, 3) && !has(s3, 45) && !has(s3, 46)); // strapping
    CHECK(!has(s3, 19) && !has(s3, 20));                               // USB-JTAG
    CHECK(!has(s3, 26) && !has(s3, 32));                               // SPI flash
    CHECK(!has(s3, 39) && !has(s3, 42));                               // dedicated JTAG
    // Permissive (octal_spi=false): a Quad/no-PSRAM build frees GPIO33-37 too.
    BoardPins s3_quad = board_pins("esp32s3", false);
    CHECK(s3_quad.count == 28);
    CHECK(has(s3_quad, 33) && has(s3_quad, 34) && has(s3_quad, 35) && has(s3_quad, 36) &&
          has(s3_quad, 37));
    // Non-empty and strictly ascending (⇒ sorted + de-duped) within GPIO range, for both variants.
    for (BoardPins b : {s3, s3_quad}) {
        CHECK(b.count > 0);
        for (int i = 0; i < b.count; i++) CHECK(gpio_in_range(b.pins[i]));
        for (int i = 1; i < b.count; i++) CHECK(b.pins[i] > b.pins[i - 1]);
    }
    // Unknown / null target falls back to the same (default-arg) conservative list.
    CHECK(board_pins("nope").count == s3.count);
    CHECK(board_pins(nullptr).count == s3.count);
    // BOARD_PINS_MAX really does bound both lists (it sizes the caller's buffer in
    // http_status.cpp).
    CHECK(s3.count <= BOARD_PINS_MAX && s3_quad.count <= BOARD_PINS_MAX);

    // board_pins_offerable(): drops the pin the firmware itself drives (the status LED, GPIO21 by
    // default) — offering it would be a pick that cannot work, since the LED holds it as an output.
    int buf[BOARD_PINS_MAX];
    int n = board_pins_offerable(buf, BOARD_PINS_MAX, /*octal_spi=*/false, /*reserved=*/21);
    CHECK(n == s3_quad.count - 1);
    for (int i = 0; i < n; i++) CHECK(buf[i] != 21);
    for (int i = 1; i < n; i++) CHECK(buf[i] > buf[i - 1]); // still strictly ascending
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
    CHECK(n == s3_quad.count - 1); // 41 was never in the X10A list (JTAG); 35 was
    for (int i = 0; i < n; i++) CHECK(buf[i] != 35 && buf[i] != 41);
    CHECK(!board_pin_offerable(35, false, ReservedPins{35, 41}));
    CHECK(!board_pin_offerable(21, false, ReservedPins{21}));    // implicit single-pin ctor
    CHECK(board_pin_offerable(21, false, ReservedPins{35, 41})); // neither reservation matches
    // "nothing reserved" must not claim the -1 sentinel (parenthesised: a braced initialiser inside
    // a macro argument reads as two arguments).
    CHECK((ReservedPins{}.claims(-1)) == false);
    CHECK((ReservedPins{-1, -1}.claims(-1)) == false);
}

// The local-I/O set: which pins the status indicator and the recovery button may use. Deliberately
// WIDER than the X10A set by exactly the four dedicated-JTAG pads — the AtomS3 Lite's onboard
// button is on GPIO41, and withholding it would make that board's only button unusable to protect a
// debug probe that isn't attached. Everything the chip hard-reserves must still be refused.
static void test_board_pins_local() {
    CHECK(board_pin_local_io(41, /*octal_spi=*/false)); // AtomS3 Lite button (MTDI)
    CHECK(board_pin_local_io(39, false) && board_pin_local_io(40, false) &&
          board_pin_local_io(42, false));
    CHECK(board_pin_local_io(35, false));               // AtomS3 Lite WS2812, Quad-flash build
    CHECK(!board_pin_local_io(35, /*octal_spi=*/true)); // ...but a real Octal build reserves it
    CHECK(board_pin_local_io(21, false));               // XIAO onboard LED
    CHECK(!board_pin_local_io(27, false));              // SPI flash — a hard conflict, still out
    CHECK(!board_pin_local_io(0, false) && !board_pin_local_io(45, false)); // strapping
    CHECK(!board_pin_local_io(19, false) &&
          !board_pin_local_io(20, false)); // USB-Serial/JTAG console

    int       buf[BOARD_LOCAL_PINS_MAX];
    const int n = board_pins_local(buf, BOARD_LOCAL_PINS_MAX, /*octal_spi=*/false);
    CHECK(n == board_pins("esp32s3", false).count + 4); // exactly the four JTAG pads added
    CHECK(n <= BOARD_LOCAL_PINS_MAX);                   // the constant really does size the buffer
    for (int i = 1; i < n; i++)
        CHECK(buf[i] > buf[i - 1]); // strictly ascending — the UI renders it verbatim
    auto in_list = [&](int p) {
        for (int i = 0; i < n; i++)
            if (buf[i] == p) return true;
        return false;
    };
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
    // board_pins_offerable() has always withheld the indicator's and the button's pins from the
    // X10A dropdown. The mirror was missing: the LED/button dropdowns still listed the X10A link's
    // own rx/tx, which board_hw_valid() then refuses ("… is in use by the X10A link") — a pick
    // whose only possible outcome is a 400. Pin both halves here, so neither can regress into a
    // one-way rule.
    Config link; // the shipped XIAO default pair
    link.rx_pin  = 44;
    link.tx_pin  = 43;
    const int nl = board_pins_local(buf, BOARD_LOCAL_PINS_MAX, false, config_link_pins(link));
    CHECK(nl == n - 2); // exactly the two link pins dropped
    auto in_local = [&](int p) {
        for (int i = 0; i < nl; i++)
            if (buf[i] == p) return true;
        return false;
    };
    CHECK(!in_local(44) && !in_local(43));
    CHECK(in_local(21) && in_local(35) && in_local(41)); // the onboard parts both boards use
    for (int i = 1; i < nl; i++)
        CHECK(buf[i] > buf[i - 1]); // still strictly ascending after filtering
    // Nothing the filtered list offers can collide with the link — the property the UI depends on.
    for (int i = 0; i < nl; i++) {
        Config c   = link;
        c.led_gpio = buf[i];
        c.btn_gpio = -1;
        std::string why;
        CHECK(board_hw_valid(c, why, 48, /*octal_spi=*/false));
    }
    // A link on a JTAG pad is not reachable through the UI (board_pin_offerable withholds 39-42)
    // but IS reachable by a raw POST /set_hp, so the filter must cover that pad too, not just the
    // base set.
    Config jt;
    jt.rx_pin    = 41;
    jt.tx_pin    = 40;
    const int nj = board_pins_local(buf, BOARD_LOCAL_PINS_MAX, false, config_link_pins(jt));
    CHECK(nj == n - 2);
    for (int i = 0; i < nj; i++) CHECK(buf[i] != 41 && buf[i] != 40);
    // An unreserved call is unchanged — the default argument keeps every existing caller honest.
    CHECK(board_pins_local(buf, BOARD_LOCAL_PINS_MAX, false, ReservedPins{}) == n);
}

// The board-hardware presets the UI's "Board" dropdown fills its five fields from. The whole point
// of keeping this table in firmware rather than in www/js/settings.js is that these CHECKs can run
// against the very validator POST /set_board applies — a preset that fills pins the device then
// rejects would be worse than no preset at all.
static void test_board_presets() {
    int                all_n = 0;
    const BoardPreset* all   = board_presets_all(all_n);
    CHECK(all_n == BOARD_PRESETS_MAX); // the constant really does size a caller's buffer

    // EVERY preset must pass the request-path validator, on a build that reserves nothing extra.
    // This is the check the JS-side table could never have.
    for (int i = 0; i < all_n; i++) {
        Config c;
        c.rx_pin = c.tx_pin = -1; // isolate: the X10A collision rule is tested below
        c.led_gpio          = all[i].led_gpio;
        c.led_type          = all[i].led_type;
        c.led_inverted      = all[i].led_inverted;
        c.btn_gpio          = all[i].btn_gpio;
        c.btn_active_low    = all[i].btn_active_low;
        std::string why;
        CHECK(board_hw_valid(c, why, 48, /*octal_spi=*/false));
        CHECK(led_type_valid(all[i].led_type));
        CHECK(all[i].key != nullptr && all[i].key[0] != '\0');
        CHECK(all[i].name != nullptr && all[i].name[0] != '\0');
    }
    // Names are what the user picks by, so they must be distinct — two "AtomS3 Lite" rows would
    // make the dropdown a coin toss.
    for (int i = 0; i < all_n; i++)
        for (int k = i + 1; k < all_n; k++) {
            CHECK(all[i].id != all[k].id);
            CHECK(std::string(all[i].key) != all[k].key);
            CHECK(std::string(all[i].name) != all[k].name);
        }

    // The two documented boards, by their docs/BOARDS.md facts. Pinned as VALUES: this table is the
    // executed half of that doc, and a silent edit here is a user flashing the wrong pin.
    CHECK(std::string(all[0].name) == "M5Stack AtomS3 Lite");
    CHECK(all[0].id == BoardPresetId::M5StackAtomS3Lite);
    CHECK(std::string(all[0].key) == "m5stack_atoms3_lite");
    CHECK(all[0].vendor == BoardVendor::M5Stack);
    CHECK(all[0].led_gpio == 35 && all[0].led_type == 1 && !all[0].led_inverted);
    CHECK(all[0].btn_gpio == 41 && all[0].btn_active_low);
    const int atom_x10a[] = {1, 2, 5, 6, 7, 8, 38};
    CHECK(all[0].x10a_pin_count == static_cast<int>(sizeof(atom_x10a) / sizeof(atom_x10a[0])));
    CHECK(all[0].x10a_pin_count <= BOARD_X10A_PINS_MAX);
    for (int i = 0; i < all[0].x10a_pin_count; ++i) CHECK(all[0].x10a_pins[i] == atom_x10a[i]);
    const int atom_i2c[] = {1, 2, 5, 6, 7, 8, 38};
    CHECK(all[0].i2c_pin_count == static_cast<int>(sizeof(atom_i2c) / sizeof(atom_i2c[0])));
    CHECK(all[0].i2c_pin_count <= BOARD_I2C_PINS_MAX);
    for (int i = 0; i < all[0].i2c_pin_count; ++i) CHECK(all[0].i2c_pins[i] == atom_i2c[i]);
    CHECK(std::string(all[1].name) == "Seeed XIAO ESP32-S3");
    CHECK(all[1].id == BoardPresetId::SeeedXiaoEsp32S3);
    CHECK(std::string(all[1].key) == "seeed_xiao_esp32s3");
    CHECK(all[1].vendor == BoardVendor::Seeed);
    CHECK(all[1].led_gpio == 21 && all[1].led_type == 0 && all[1].led_inverted);
    CHECK(all[1].btn_gpio == -1); // no button broken out — never guess a pin for one
    const int xiao_x10a[] = {1, 2, 4, 5, 6, 7, 8, 9, 43, 44};
    CHECK(all[1].x10a_pin_count == static_cast<int>(sizeof(xiao_x10a) / sizeof(xiao_x10a[0])));
    CHECK(all[1].x10a_pin_count <= BOARD_X10A_PINS_MAX);
    for (int i = 0; i < all[1].x10a_pin_count; ++i) CHECK(all[1].x10a_pins[i] == xiao_x10a[i]);
    CHECK(all[1].i2c_pins == nullptr && all[1].i2c_pin_count == 0);
    CHECK(board_preset_by_key("m5stack_atoms3_lite") == &all[0]);
    CHECK(board_preset_by_id(BoardPresetId::SeeedXiaoEsp32S3) == &all[1]);
    CHECK(board_preset_by_key("atoms3_lite") == nullptr); // no fuzzy/model-name identity

    // Vendor-gated features depend on an explicitly selected preset, never on boot defaults or a
    // display-name prefix. Connector-bound features additionally require that preset's physical
    // I2C inventory, so a future board cannot inherit the Atom layout by vendor name alone.
    Config identified;
    identified.led_gpio       = all[0].led_gpio;
    identified.led_type       = all[0].led_type;
    identified.led_inverted   = all[0].led_inverted;
    identified.btn_gpio       = all[0].btn_gpio;
    identified.btn_active_low = all[0].btn_active_low;
    CHECK(board_selected_vendor(identified) == BoardVendor::Unknown);
    identified.board_user_set  = true;
    identified.board_preset_id = BoardPresetId::M5StackAtomS3Lite;
    CHECK(board_selected_vendor(identified) == BoardVendor::M5Stack);
    identified.led_inverted = !identified.led_inverted; // irrelevant for WS2812 identity
    CHECK(board_selected_vendor(identified) == BoardVendor::M5Stack);
    // Identity is independent of configurable peripherals. Disabling or moving the indicator and
    // reset input must not silently turn a physical Atom into Custom or remove M5Stack accessories.
    identified.led_gpio = -1;
    identified.btn_gpio = -1;
    CHECK(board_selected_vendor(identified) == BoardVendor::M5Stack);
    std::string identity_why;
    CHECK(board_identity_valid(identified, identity_why));
    identified.board_preset_id = BoardPresetId::Custom;
    CHECK(board_identity_valid(identified, identity_why));
    Config legacy_identity         = identified;
    legacy_identity.led_gpio       = all[0].led_gpio;
    legacy_identity.led_type       = all[0].led_type;
    legacy_identity.led_inverted   = all[0].led_inverted;
    legacy_identity.btn_gpio       = all[0].btn_gpio;
    legacy_identity.btn_active_low = all[0].btn_active_low;
    CHECK(board_legacy_preset_id(legacy_identity) == BoardPresetId::M5StackAtomS3Lite);
    legacy_identity.board_user_set = false;
    CHECK(board_legacy_preset_id(legacy_identity) == BoardPresetId::Custom);

    // The AtomS3 Lite's button sits on a dedicated-JTAG pad. That it is legal for board-local I/O
    // but NOT for the X10A picker is the exact asymmetry this preset depends on (board_pins.hpp).
    CHECK(board_pin_local_io(41, /*octal_spi=*/false));
    CHECK(!board_pin_offerable(41, /*octal_spi=*/false));

    // X10A uses the selected board's physical header inventory in addition to the generic chip
    // safety policy. ENV III reservations remove its active pair from Atom, while a chip-safe but
    // unexposed pin (XIAO GPIO10 / Atom GPIO44) never appears and never validates.
    CHECK(board_preset_x10a_pin_offerable(&all[0], 1, false));
    CHECK(board_preset_x10a_pin_offerable(&all[0], 38, false));
    CHECK(!board_preset_x10a_pin_offerable(&all[0], 44, false));
    CHECK(board_preset_x10a_pin_offerable(&all[1], 44, false));
    CHECK(!board_preset_x10a_pin_offerable(&all[1], 10, false));
    int       x10a_buf[BOARD_X10A_PINS_MAX];
    const int atom_without_env = board_preset_x10a_pins_offerable(
        &all[0], x10a_buf, BOARD_X10A_PINS_MAX, false, ReservedPins{2, 1});
    CHECK(atom_without_env == 5);
    CHECK(x10a_buf[0] == 5 && x10a_buf[1] == 6 && x10a_buf[2] == 7 && x10a_buf[3] == 8 &&
          x10a_buf[4] == 38);
    for (int i = 0; i < atom_without_env; ++i)
        CHECK(board_preset_x10a_pin_offerable(&all[0], x10a_buf[i], false, ReservedPins{2, 1}));
    CHECK(board_preset_x10a_pins_offerable(&all[1], x10a_buf, 3, false) == 3);
    CHECK(board_preset_x10a_pins_offerable(nullptr, x10a_buf, BOARD_X10A_PINS_MAX, false) == 0);

    // ENV III uses the selected board's TESTED connector inventory, not every safe chip pad.
    // GPIO39 is exposed but deliberately unavailable after failed ENV III hardware tests; GPIO10 is
    // chip-safe but absent from the Atom headers. Neither may appear or validate.
    CHECK(board_preset_i2c_pin_offerable(&all[0], 38, false));
    CHECK(!board_preset_i2c_pin_offerable(&all[0], 39, false));
    CHECK(!board_preset_i2c_pin_offerable(&all[0], 10, false));
    CHECK(!board_preset_i2c_pin_offerable(&all[1], 38, false));
    int i2c_buf[BOARD_I2C_PINS_MAX];
    int ni2c = board_preset_i2c_pins_offerable(&all[0], i2c_buf, BOARD_I2C_PINS_MAX, false,
                                               ReservedPins{1, 35});
    CHECK(ni2c == all[0].i2c_pin_count - 1); // GPIO1 occupied; non-header GPIO35 changes nothing
    CHECK(i2c_buf[0] == 2 && i2c_buf[ni2c - 1] == 38);
    // The DOCUMENTED AtomS3 Lite wiring (docs/WIRING.md: X10A over the Grove port, RX=1/TX=2) takes
    // BOTH Grove pads, so ENV III is left with the case header alone — GPIO5-GPIO8 and GPIO38. This
    // is the configuration a user reported as "GPIO1/2 are not offered at all": correct, because
    // one pad cannot carry the X10A UART and the I2C bus at once. Pinned because the Hardware
    // modal's hint (i18n `env.atoms3_header_hint`) states exactly this set, and a hint that names
    // pins the picker cannot offer is how that report happened the first time — the earlier copy
    // led with "use Grove GPIO2/1", the one pair this wiring can never produce.
    const int grove_x10a = board_preset_i2c_pins_offerable(&all[0], i2c_buf, BOARD_I2C_PINS_MAX,
                                                           false, ReservedPins{1, 2});
    CHECK(grove_x10a == 5);
    CHECK(i2c_buf[0] == 5 && i2c_buf[1] == 6 && i2c_buf[2] == 7 && i2c_buf[3] == 8 &&
          i2c_buf[4] == 38);
    // ...and the only shipped ENV III preset IS the Grove pair, so that same wiring offers none.
    // The web UI never renders /status.env3.presets, so this absence is invisible there; the hint
    // above is the only thing that can explain it, which is why it must not promise Grove.
    const Env3Preset* epre[ENV3_PRESETS_MAX];
    CHECK(env3_presets_offerable(epre, ENV3_PRESETS_MAX, &all[0], false, ReservedPins{1, 2}) == 0);
    CHECK(env3_presets_offerable(epre, ENV3_PRESETS_MAX, &all[0], false, ReservedPins{44, 43}) ==
          1);
    CHECK(board_preset_i2c_pins_offerable(&all[0], i2c_buf, 2, false) == 2);
    CHECK(board_preset_i2c_pins_offerable(nullptr, i2c_buf, BOARD_I2C_PINS_MAX, false) == 0);

    // Offering is build-aware: GPIO35 is free on this project's Quad-flash build and is SPIIO4 on
    // an Octal one, so an Octal build withholds the AtomS3 Lite preset instead of offering a pick
    // that POST /set_board would refuse.
    const BoardPreset* buf[BOARD_PRESETS_MAX];
    int                n = board_presets_offerable(buf, BOARD_PRESETS_MAX, /*octal_spi=*/false);
    CHECK(n == all_n);
    n = board_presets_offerable(buf, BOARD_PRESETS_MAX, /*octal_spi=*/true);
    CHECK(n == 1 && std::string(buf[0]->name) == "Seeed XIAO ESP32-S3");
    // Whatever survives the filter must still validate under the SAME build flag it was filtered
    // by.
    for (int oct = 0; oct <= 1; oct++) {
        n = board_presets_offerable(buf, BOARD_PRESETS_MAX, oct != 0);
        for (int i = 0; i < n; i++) {
            Config c;
            c.rx_pin = c.tx_pin = -1;
            c.led_gpio          = buf[i]->led_gpio;
            c.led_type          = buf[i]->led_type;
            c.btn_gpio          = buf[i]->btn_gpio;
            std::string why;
            CHECK(board_hw_valid(c, why, 48, oct != 0));
        }
    }
    // Cap honoured, like board_pins_offerable/board_pins_local.
    CHECK(board_presets_offerable(buf, 1, /*octal_spi=*/false) == 1);
    CHECK(board_presets_offerable(buf, 0, /*octal_spi=*/false) == 0);

    // Offering is also LINK-aware, the same mirror board_pins_local now applies to the two pin
    // dropdowns: a preset that collides with where the X10A link currently sits is withheld,
    // because board_hw_valid() would refuse it and a dropdown entry whose only outcome is a 400 is
    // not a pick. The AtomS3 Lite's WS2812 (GPIO35) against a link moved onto 35 is exactly that
    // case.
    Config on35;
    on35.rx_pin = 35;
    on35.tx_pin = 44;
    n           = board_presets_offerable(buf, BOARD_PRESETS_MAX, /*octal_spi=*/false,
                                          config_link_pins(on35));
    CHECK(n == 1 && std::string(buf[0]->name) == "Seeed XIAO ESP32-S3");
    // ...and its BUTTON pin counts too, not just the indicator.
    Config on41;
    on41.rx_pin = 41;
    on41.tx_pin = 44;
    n           = board_presets_offerable(buf, BOARD_PRESETS_MAX, false, config_link_pins(on41));
    CHECK(n == 1 && std::string(buf[0]->name) == "Seeed XIAO ESP32-S3");
    // The shipped default link (44/43) collides with neither board, so both stay on offer.
    Config def;
    def.rx_pin = 44;
    def.tx_pin = 43;
    CHECK(board_presets_offerable(buf, BOARD_PRESETS_MAX, false, config_link_pins(def)) == all_n);
    // Whatever survives BOTH filters validates against that same link — the property the modal
    // needs.
    for (const Config& link : {def, on35, on41}) {
        n = board_presets_offerable(buf, BOARD_PRESETS_MAX, false, config_link_pins(link));
        for (int i = 0; i < n; i++) {
            Config c   = link;
            c.led_gpio = buf[i]->led_gpio;
            c.led_type = buf[i]->led_type;
            c.btn_gpio = buf[i]->btn_gpio;
            std::string why;
            CHECK(board_hw_valid(c, why, 48, /*octal_spi=*/false));
        }
    }

    // The request path stays the authority regardless: a preset applied onto a colliding link — via
    // a raw POST, or a link changed after the modal was filled — is still rejected, with the link
    // named. Withholding it from the dropdown is the courtesy; this is the guarantee.
    Config c;
    c.rx_pin   = 35;
    c.tx_pin   = 44;
    c.led_gpio = all[0].led_gpio;
    c.led_type = all[0].led_type;
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

    in.link_mode = true;
    CHECK(led_phase(in) == LedPhase::Connecting); // associated? not yet
    in.link_up = true;
    CHECK(led_phase(in) == LedPhase::BusDown); // WiFi up, X10A silent
    in.hp_connected = true;
    CHECK(led_phase(in) == LedPhase::Healthy); // MQTT unconfigured is NOT a fault
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
    healthy.link_mode = healthy.link_up = healthy.hp_connected = true;
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
    for (LedPhase p :
         {LedPhase::Off, LedPhase::SetupPortal, LedPhase::Connecting, LedPhase::Healthy,
          LedPhase::BusDown, LedPhase::MqttDown, LedPhase::WipeArmed, LedPhase::Wiping})
        CHECK(led_pattern_period_ms(led_pattern(p)) > 0);

    // The six operating patterns keep the exact timings the pre-refactor status_led.cpp shipped —
    // this split must not silently re-teach a user's board a new vocabulary.
    CHECK(led_pattern(LedPhase::SetupPortal).on_ms == 1000 &&
          led_pattern(LedPhase::SetupPortal).off_ms == 1000);
    CHECK(led_pattern(LedPhase::Connecting).on_ms == 100 &&
          led_pattern(LedPhase::Connecting).off_ms == 100);
    CHECK(led_pattern(LedPhase::MqttDown).on_ms == 300 &&
          led_pattern(LedPhase::MqttDown).off_ms == 300);
    const LedPattern bus = led_pattern(LedPhase::BusDown);
    CHECK(bus.pulses == 2 && bus.on_ms == 120 && bus.off_ms == 150 && bus.gap_ms == 1000);
    CHECK(led_pattern(LedPhase::Off).pulses == 0);

    // Shape, not colour, has to carry the state — a monochrome LED sees no colour at all. Exactly
    // two phases are solid (Healthy and Wiping); see led_phase_is_solid's note for why that pair is
    // safe. Everything else must be distinguishable by blink timing.
    int solid = 0;
    for (LedPhase p :
         {LedPhase::Off, LedPhase::SetupPortal, LedPhase::Connecting, LedPhase::Healthy,
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
    uint64_t    t    = 0;
    auto        step = [&](bool pressed, uint64_t dt) {
        t += dt;
        return button_update(st, pressed, t);
    };

    // A short press does nothing at all — not even an indicator hand-back (nothing was asserted).
    CHECK(step(true, 20) == ButtonEvent::None);
    CHECK(step(true, 200) == ButtonEvent::None);
    for (int i = 0; i < BUTTON_RELEASE_SAMPLES; i++) step(false, 20);
    CHECK(!st.down && !st.armed);

    // A full hold: Armed at the checkpoint, then Fired — each exactly once, even though the
    // predicate stays true for every later sample of the hold.
    st = ButtonState{};
    t  = 0;
    CHECK(step(true, 20) == ButtonEvent::None);
    CHECK(step(true, BUTTON_ARM_MS - 100) == ButtonEvent::None); // not there yet
    CHECK(step(true, 200) == ButtonEvent::Armed);
    CHECK(step(true, 20) == ButtonEvent::None); // ...and not again
    int armed_again = 0, fired = 0;
    while (t < BUTTON_FIRE_MS + 500) {
        const ButtonEvent e = step(true, BUTTON_SAMPLE_MS);
        if (e == ButtonEvent::Armed) armed_again++;
        if (e == ButtonEvent::Fired) fired++;
    }
    CHECK(armed_again == 0 && fired == 1);

    // ABORT: released after the warning but before the threshold -> Aborted, and NOTHING fired.
    st = ButtonState{};
    t  = 0;
    step(true, 20);
    CHECK(step(true, BUTTON_ARM_MS) == ButtonEvent::Armed);
    step(true, BUTTON_FIRE_MS - BUTTON_ARM_MS - 200); // right up to the edge
    CHECK(!st.fired);
    CHECK(step(false, 20) == ButtonEvent::None); // debouncing, not yet a release
    CHECK(step(false, 20) == ButtonEvent::None);
    CHECK(step(false, 20) == ButtonEvent::Aborted); // third consecutive sample
    CHECK(!st.down && !st.armed && !st.fired);

    // A single stray released sample mid-hold is BOUNCE, not a release: it must neither cancel the
    // hold nor restart its clock, or a user holding the button through a noisy contact would get a
    // silent abort with nothing on screen to explain it.
    st = ButtonState{};
    t  = 0;
    step(true, 20);
    const uint64_t started = st.down_at_ms;
    step(true, 1000);
    CHECK(step(false, 20) == ButtonEvent::None); // one bad sample
    CHECK(st.down && st.down_at_ms == started);  // hold intact, clock unchanged
    step(true, 20);
    CHECK(st.release_run == 0); // the bounce counter reset
    CHECK(step(true, BUTTON_ARM_MS) ==
          ButtonEvent::Armed); // and the hold still counts from `started`

    // A coarse sample period that crosses both thresholds at once fires: the user held it long
    // enough, and reporting Armed first would just delay what they asked for by a whole sample.
    st = ButtonState{};
    t  = 0;
    step(true, 20);
    CHECK(step(true, BUTTON_FIRE_MS + 1000) == ButtonEvent::Fired);

    // Released while idle stays silent no matter how long.
    st = ButtonState{};
    for (int i = 0; i < 50; i++) CHECK(step(false, 100) == ButtonEvent::None);

    // A release AFTER firing is not an "abort" — there is nothing left to abort, and the caller has
    // already rebooted in the normal case.
    st = ButtonState{};
    t  = 0;
    step(true, 20);
    step(true, BUTTON_FIRE_MS + 100);
    CHECK(st.fired);
    step(false, 20);
    step(false, 20);
    CHECK(step(false, 20) == ButtonEvent::None);

    // Thresholds are ordered and the arm point leaves real time to react.
    CHECK(BUTTON_ARM_MS < BUTTON_FIRE_MS);
    CHECK(BUTTON_FIRE_MS - BUTTON_ARM_MS >= 2000);
    CHECK(BUTTON_RELEASE_SAMPLES * BUTTON_SAMPLE_MS <
          BUTTON_ARM_MS); // debounce can't eat the warning
}

static void test_crashinfo() {
    const std::string base = "daikin-altherma-esp32", node = device_node_id(base),
                      board = "daikin_abc123"; // installation id + this board's own id

    // Reason slug + fault classification: a software reboot (config save / OTA) and a clean
    // power-on are NORMAL; a panic / watchdog / brown-out / CPU lockup is a fault.
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
    clean.reason = 3; // ESP_RST_SW
    CHECK(!crash_is_notable(clean));
    CHECK(build_crash_json(clean) ==
          "{\"reason\":\"sw\",\"reason_code\":3,\"fault\":false,\"coredump\":false}");

    // A proven-foreign image is never reportable, even if its best-effort boot-time erase failed
    // and the raw partition still looks occupied. Current-firmware evidence keeps the fail-closed
    // erase rule; foreign residue cannot pin a current fault banner that has no downloadable dump
    // behind it.
    CHECK(coredump_is_reportable(true, false));
    CHECK(!coredump_is_reportable(false, false));
    CHECK(!coredump_is_reportable(true, true));
    // A real erase FAILURE on current-firmware evidence still blocks: the dump may remain
    // downloadable, and a dismissal would assert it is gone.
    const int kFail = 0x103; // ESP_ERR_INVALID_STATE — a stand-in for "the erase genuinely failed"
    CHECK(coredump_erase_failure_blocks_dismiss(kFail, false));
    CHECK(!coredump_erase_failure_blocks_dismiss(kFail, true));
    // ESP_OK obviously permits it...
    CHECK(!coredump_erase_failure_blocks_dismiss(0, false));
    CHECK(!coredump_erase_failure_blocks_dismiss(0, true));
    // ...and so does ESP_ERR_NOT_FOUND, which is the whole point: it means the board has no
    // `coredump` partition at all — the state of every device flashed before one existed and
    // upgraded over the air since, because OTA never rewrites the partition table (partitions.csv).
    // There is nothing to destroy, so the dismissal's other job — clearing the report — must still
    // happen. Blocking it answered 500 forever, and a fault reset carries no dump often enough
    // (a stack overflow overruns it) that those boards saw a banner no action could clear.
    CHECK(!coredump_erase_failure_blocks_dismiss(ESP_ERR_NOT_FOUND_MIRROR, false));
    CHECK(!coredump_erase_failure_blocks_dismiss(ESP_ERR_NOT_FOUND_MIRROR, true));
    // The exemption is NARROW by construction — neighbouring error codes must not inherit it, or
    // "erase failed" would start reading as "nothing to erase".
    CHECK(coredump_erase_failure_blocks_dismiss(ESP_ERR_NOT_FOUND_MIRROR - 1, false));
    CHECK(coredump_erase_failure_blocks_dismiss(ESP_ERR_NOT_FOUND_MIRROR + 1, false));

    // An orphan core-dump with no fault reason is still notable (a dump is waiting to be pulled).
    CrashInfo orphan;
    orphan.reason   = 1; // poweron
    orphan.coredump = true;
    CHECK(crash_is_notable(orphan));

    // A USB re-plug (ESP32-S3 native USB resets the chip on re-enumeration) is NOT a fault, so with
    // no dump in flash it must not raise the banner. The device reports `coredump` from a LIVE
    // flash read (diag_crash_info_live), not the boot-time cache: a dump erased via POST
    // /coredump/clear while the device runs used to leave this true forever, which pinned an
    // uncleanable "crash" banner on a device that never crashed and a "Download crash report"
    // button that 404s.
    CrashInfo usb_replug;
    usb_replug.reason   = 11;    // ESP_RST_USB
    usb_replug.coredump = false; // image gone from flash — nothing to offer
    CHECK(std::string(crash_reason_slug(11)) == "usb");
    CHECK(!crash_reason_is_fault(11));
    CHECK(!crash_is_notable(usb_replug));
    CHECK(build_crash_json(usb_replug) ==
          "{\"reason\":\"usb\",\"reason_code\":11,\"fault\":false,\"coredump\":false}");

    // ...but clearing the dump must NOT erase the memory of a real crash: a fault reset stays
    // notable (banner + reason), it just loses the download link.
    CrashInfo fault_cleared;
    fault_cleared.reason   = 6; // ESP_RST_TASK_WDT
    fault_cleared.coredump = false;
    CHECK(crash_is_notable(fault_cleared));

    // The RETAINED <base>/crash MQTT payload is crash-ONLY: it carries the crash JSON when the boot
    // is notable, and "" otherwise. Empty means NO crash publish; the caller probes the broker and
    // sends a tombstone only when a stale retained crash actually exists. Thus a normal boot is
    // silent on a clean broker while still removing an older crash. Reset reason is not lost: the
    // heartbeat carries it independently (parity asserted in test_boot_guard).
    CHECK(build_crash_mqtt_payload(clean).empty());      // config-save/OTA reboot -> no publish
    CHECK(build_crash_mqtt_payload(usb_replug).empty()); // USB re-enumeration -> no publish
    CHECK(build_crash_mqtt_payload(orphan) == build_crash_json(orphan)); // dump waiting -> report
    CHECK(build_crash_mqtt_payload(fault_cleared) ==
          build_crash_json(fault_cleared)); // fault sans dump -> report

    // DISMISSED (POST /crash/dismiss -> diag_crash_dismiss): the user deleted the report on the
    // device. Nothing about the reset changes — the reason is still reported, and the heartbeat's
    // own "Reset Reason" sensor is untouched — but the crash stops being notable, which is what
    // takes the banner down for every browser at once and clears the retained MQTT crash topic.
    // Asserted on BOTH shapes: a fault reset that left no dump (a stack overflow overruns its own
    // dump, so this is the common case here) is the one where no flash byte changes, so `dismissed`
    // is the only thing that can carry it.
    CrashInfo dismissed_fault = fault_cleared;
    dismissed_fault.dismissed = true;
    CHECK(!crash_is_notable(dismissed_fault));
    CHECK(build_crash_mqtt_payload(dismissed_fault).empty()); // -> probe + delete only if retained
    CHECK(build_crash_json(dismissed_fault) ==
          build_crash_json(fault_cleared)); // the reset itself is untouched
    CrashInfo dismissed_orphan = orphan;
    dismissed_orphan.dismissed = true;
    CHECK(!crash_is_notable(dismissed_orphan)); // outranks a dump the erase somehow left
    CHECK(build_crash_mqtt_payload(dismissed_orphan).empty());

    // Panic with a parsed summary: exact JSON + text, backtrace as raw PC hex.
    CrashInfo panic;
    panic.reason       = 4; // ESP_RST_PANIC
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
          "\"backtrace\":[\"0x400d1234\",\"0x400d5678\"],\"corrupted\":false,\"elf_sha256\":"
          "\"abc123\"}");
    CHECK(build_crash_text(panic) == "reset=panic  coredump=yes\ntask=mqtt_pub  pc=0x400d1234\n"
                                     "backtrace: 0x400d1234 0x400d5678\nelf_sha256=abc123");
    CHECK(build_crash_mqtt_payload(panic) == build_crash_json(panic)); // notable -> full report

    // bt_depth is clamped to the 16-entry buffer (a corrupt summary can over-report it).
    CrashInfo over       = panic;
    over.bt_depth        = 99;
    const std::string oj = build_crash_json(over);
    CHECK(oj.find("0x00000000") != std::string::npos); // zero-filled tail entries, not OOB reads
    size_t cnt = 0, at = 0;
    while ((at = oj.find("0x", at)) != std::string::npos) {
        cnt++;
        at += 2;
    }
    CHECK(cnt == 1 /*pc*/ + 16 /*bt[16]*/);

    // ORPHAN core dump (#215): a dump survives an OTA, and a panic that fails to write its own
    // leaves the PREVIOUS build's dump in place — a valid image of another binary, which
    // diag_crash_capture erases so `coredump` never offers a download espcoredump rejects on a
    // version mismatch. The rule (coredump_is_foreign) gates that ERASE, so it fires ONLY on proof:
    // two present shas, a meaningful common prefix, and a mismatch. The costly error is the false
    // positive — erasing a dump that really is ours — so every ambiguous case answers "not foreign"
    // and the dump is kept.
    CHECK(coredump_is_foreign("ce0adc15a", "f8814d6d5")); // #215's exact case — different builds
    CHECK(coredump_is_foreign("deadbeef00", "deadbeef11")); // agree on a prefix, differ past it
    CHECK(!coredump_is_foreign("f8814d6d5", "f8814d6d5"));  // same build — keep the dump
    CHECK(!coredump_is_foreign("abc123", "abc123")); // same, shorter than the compare floor -> keep
    CHECK(!coredump_is_foreign("f8814d6d",
                               "f8814d6d5")); // one truncated: common prefix agrees -> keep
    // A missing sha is NOT proof of foreign origin — a dump with no parsable summary, or a build
    // that could not report its own — so the dump is left alone rather than erased on absence of
    // evidence.
    CHECK(!coredump_is_foreign("", "f8814d6d5"));
    CHECK(!coredump_is_foreign("f8814d6d5", ""));
    CHECK(!coredump_is_foreign(nullptr, "f8814d6d5"));
    CHECK(!coredump_is_foreign("f8814d6d5", nullptr));
    // Two DIFFERENT shas that happen to agree only on a prefix SHORTER than the compare floor are
    // not trusted as different — the 32-bit floor is what keeps a pathologically short config from
    // erasing good dumps by accident (the 8-char agreement below reads as "same build", keep).
    CHECK(!coredump_is_foreign("abcdef01", "abcdef01"));
    CHECK(
        coredump_is_foreign("abcdef012", "abcdef019")); // 9 chars: floor cleared, differ at char 9

    // Crash topic + its ONE diagnostic HA entity (the coredump "problem" binary_sensor). The reset
    // reason is NOT a crash entity — it is the heartbeat's own "Reset Reason" sensor, so a crash
    // entity for it would be an exact duplicate; it was dropped and is now actively retired
    // (below).
    CHECK(crash_topic(base) == "daikin-altherma-esp32/crash"); // node NOT in the message topic
    const std::string ct = crash_topic(base);
    const std::string av = availability_topic(base);
    CHECK(CRASH_SENSOR_COUNT == 1);

    const CrashSensor& dump = CRASH_SENSORS[0];
    CHECK(std::string(dump.component) == "binary_sensor");
    CHECK(std::string(dump.object_id) == "coredump");
    CHECK(crash_discovery_topic("homeassistant", node, dump) ==
          "homeassistant/binary_sensor/daikin_altherma_esp32/coredump/config");
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
    // install keeps a stale, permanently-unavailable entity forever. The 2-arg topic builder used
    // to clear it must match the 3-arg one that once created it.
    CHECK(RETIRED_CRASH_SENSOR_COUNT == 1);
    const RetiredHaSensor& retired = RETIRED_CRASH_SENSORS[0];
    CHECK(std::string(retired.component) == "sensor");
    CHECK(std::string(retired.object_id) == "last_reset");
    CHECK(crash_discovery_topic("homeassistant", retired.component, node, retired.object_id) ==
          "homeassistant/sensor/daikin_altherma_esp32/last_reset/config");
}

static void test_modbus() {
    // ── Big-endian helpers + 1-based offset -> 0-based PDU address (EKRHH guide §9.2) ──
    uint8_t w[2];
    mb_put_u16(w, 0x1234);
    CHECK(w[0] == 0x12 && w[1] == 0x34); // Modbus is big-endian on the wire
    CHECK(mb_get_u16(w) == 0x1234);
    uint16_t addr = 0xFFFF;
    CHECK(mb_pdu_address(1, addr) && addr == 0);   // offset 1 -> PDU address 0
    CHECK(mb_pdu_address(40, addr) && addr == 39); // input reg 40 (LWT PHE) -> 39
    CHECK(!mb_pdu_address(0, addr));               // offset 0 is invalid

    // ── FC03 read-holding request framing: MBAP[txn,proto=0,len,unit] + [fc,addr,qty] = 12 bytes
    // ──
    uint8_t buf[64];
    int n = mb_build_read(buf, sizeof(buf), 0x0007, 1, MbFunc::ReadHolding, /*addr*/ 55, /*qty*/ 1);
    CHECK(n == 12);
    CHECK(mb_get_u16(buf + 0) == 0x0007); // transaction id
    CHECK(mb_get_u16(buf + 2) == 0x0000); // protocol id (always 0 for Modbus)
    CHECK(mb_get_u16(buf + 4) == 6);      // length = unit(1) + PDU(5)
    CHECK(buf[6] == 1);                   // unit id
    CHECK(buf[7] == 0x03);                // function code FC03
    CHECK(mb_get_u16(buf + 8) == 55 && mb_get_u16(buf + 10) == 1);
    // FC04 read-input uses the same shape with a different function code.
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadInput, 40, 6) == 12 && buf[7] == 0x04);
    // Guards: qty 0 and an undersized buffer are rejected. A write function code is not part of
    // MbFunc at all, so a caller cannot even express a write request.
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadHolding, 1, 0) == -1);
    CHECK(mb_build_read(buf, 8, 1, 1, MbFunc::ReadHolding, 1, 1) == -1);
    // A read response states its size in ONE byte, so qty tops out at 125 (§6.3): 125 builds, 126
    // is refused rather than sent to earn an "illegal data value" exception.
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadHolding, 1, MB_MAX_READ_REGS) == 12);
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadHolding, 1, MB_MAX_READ_REGS + 1) ==
          -1);
    CHECK(mb_build_read(buf, sizeof(buf), 1, 1, MbFunc::ReadInput, 1, 1000) == -1);

    // The FC06/FC16 request builders, response vocabulary and value encoders are GONE (#294): this
    // firmware cannot frame, confirm or prepare a Modbus write. Reintroducing a caller does not
    // compile, which is stronger than a runtime assertion.

    // ── Parse a well-formed FC03 read response: 3 registers ──
    MbResponse r;
    // MBAP(txn=7,proto=0,len=9,unit=1) + PDU[fc=03, bytecount=6, d0..d5]
    uint8_t resp[] = {0x00, 0x07, 0x00, 0x00, 0x00, 0x09, 0x01, 0x03,
                      0x06, 0x07, 0xD0, 0xFB, 0x2E, 0x7F, 0xFE};
    // The parse is request-bound: the register count MUST match the requested quantity=3. A read
    // reply does not echo its start address, so transaction id + function + quantity are the proof.
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, /*qty*/ 3, r) ==
          MbParse::Ok);
    CHECK(r.ok && !r.exception && r.txn == 7 && r.unit == 1 && r.fc == 0x03);
    CHECK(mb_reg_count(r) == 3);
    uint16_t rv = 0;
    CHECK(mb_reg_at(r, 0, rv) && rv == 0x07D0); // 2000
    CHECK(mb_reg_at(r, 1, rv) && rv == 0xFB2E); // -1234
    CHECK(mb_reg_at(r, 2, rv) && rv == 0x7FFE); // 32766 (unavailable sentinel)
    CHECK(!mb_reg_at(r, 3, rv));                // out-of-range index rejected
    // The parse BORROWS: `payload` points into the caller's ADU buffer rather than copying it,
    // which is why an MbResponse may never outlive the bytes it was parsed from. Pinned because the
    // consequence of getting it wrong is not a crash but a PLAUSIBLE wrong register value read out
    // of a dead frame — hp_modbus.cpp shipped exactly that until the buffer moved to the caller.
    CHECK(r.payload >= resp && r.payload < resp + sizeof(resp));
    CHECK(r.payload + r.payload_len <= resp + sizeof(resp));
    // The receive buffer size is a property of the protocol, so it is stated with the parser: MBAP
    // header plus the 253-byte maximum PDU. A buffer shorter than this cannot hold a legal reply.
    CHECK(MB_ADU_MAX == 260);
    // Asking for a different quantity than the reply carries is a desync (QtyMismatch), not Ok.
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, 2, r) ==
          MbParse::QtyMismatch);
    CHECK(!r.ok);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadHolding, 4, r) ==
          MbParse::QtyMismatch);

    // ── Parse a Modbus exception response (FC03 | 0x80, code 0x02 = illegal data address) ──
    uint8_t exc[] = {0x00, 0x07, 0x00, 0x00, 0x00, 0x03, 0x01, 0x83, 0x02};
    CHECK(mb_parse_response(exc, sizeof(exc), 7, 1, MbFunc::ReadHolding, /*qty*/ 1, r) ==
          MbParse::Exception);
    CHECK(!r.ok && r.exception && r.exc_code == 0x02 && r.fc == 0x03);
    CHECK(std::string(mb_exception_reason(r.exc_code)) == "illegal data address");
    CHECK(std::string(mb_exception_reason(11)) == "gateway target failed to respond");
    CHECK(std::string(mb_exception_reason(0x7f)) == "unknown exception");
    // An exception PDU with a TRAILING byte (len bumped to 4, an extra 0x00) must be Malformed —
    // the old `pdu_len < 2` check accepted [fc|0x80, code, <junk>] as a clean exception.
    uint8_t exctrail[] = {0x00, 0x07, 0x00, 0x00, 0x00, 0x04, 0x01, 0x83, 0x02, 0x00};
    CHECK(mb_parse_response(exctrail, sizeof(exctrail), 7, 1, MbFunc::ReadHolding, 1, r) ==
          MbParse::Malformed);

    // ── Parse-error paths ──
    CHECK(mb_parse_response(resp, 5, 7, 1, MbFunc::ReadHolding, 3, r) == MbParse::TooShort);
    uint8_t badproto[] = {0x00, 0x07, 0x00, 0x01, 0x00, 0x03, 0x01, 0x03, 0x00}; // proto id != 0
    CHECK(mb_parse_response(badproto, sizeof(badproto), 7, 1, MbFunc::ReadHolding, 3, r) ==
          MbParse::BadProtocol);
    uint8_t badlen[] = {0x00, 0x07, 0x00, 0x00, 0x00, 0x09, 0x01, 0x03, 0x00}; // len 9 != actual
    CHECK(mb_parse_response(badlen, sizeof(badlen), 7, 1, MbFunc::ReadHolding, 3, r) ==
          MbParse::BadLength);
    CHECK(mb_parse_response(resp, sizeof(resp), 8, 1, MbFunc::ReadHolding, 3, r) ==
          MbParse::TxnMismatch);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 2, MbFunc::ReadHolding, 3, r) ==
          MbParse::UnitMismatch);
    CHECK(mb_parse_response(resp, sizeof(resp), 7, 1, MbFunc::ReadInput, 3, r) ==
          MbParse::FcMismatch);
    CHECK(std::string(mb_parse_reason(MbParse::BadProtocol)) == "invalid protocol id");
    CHECK(std::string(mb_parse_reason(MbParse::TxnMismatch)) == "transaction id mismatch");
    // Consistent MBAP length (6 = unit + 5-byte PDU) but an odd register byte count (3) ->
    // Malformed.
    uint8_t oddbc[] = {0x00, 0x07, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x03, 0x01, 0x02, 0x03};
    CHECK(mb_parse_response(oddbc, sizeof(oddbc), 7, 1, MbFunc::ReadHolding, 3, r) ==
          MbParse::Malformed);

    // ── Value codecs: decode (EKRHH guide §9.2 data formats) ──
    CHECK(approx(mb_decode(MbType::Temp16, 0x07D0).value, 20.0)); // 2000 /100
    CHECK(mb_decode(MbType::Temp16, 0x07D0).ok);
    CHECK(approx(mb_decode(MbType::Temp16, 0xFB2E).value, -12.34)); // -1234 /100 (two's complement)
    CHECK(approx(mb_decode(MbType::Pow16, 0x01C2).value, 4.5));     // 450 /100 kW
    CHECK(approx(mb_decode(MbType::Int16, 0xFFFF).value, -1.0));    // signed, as-is
    CHECK(approx(mb_decode(MbType::Int16, 0x0002).value, 2.0));     // op-mode "Cooling"
    // Text16: the unit error-code example from the guide — 0x5538 -> "U8".
    MbValue tx = mb_decode(MbType::Text16, 0x5538);
    CHECK(tx.ok && std::string(tx.text) == "U8");

    // ── Special-value guard: 32765/66/67 are "no value", boundaries are real ──
    CHECK(mb_is_special(32765) && mb_is_special(32766) && mb_is_special(32767));
    CHECK(!mb_is_special(32764) && !mb_is_special(0x8000)); // 0x8000 = -32768, a real reading
    CHECK(mb_decode(MbType::Int16, 32767).special && !mb_decode(MbType::Int16, 32767).ok);
    CHECK(mb_decode(MbType::Temp16, 32766).special);
    CHECK(mb_decode(MbType::Int16, 32764).ok && !mb_decode(MbType::Int16, 32764).special);

    // ── mDNS HomeHub hostname filter: keep real HomeHubs, drop our own advert / unrelated hosts ──
    CHECK(is_homehub_hostname("homehub-524288-example")); // EKRHH guide §13.1.2 form
    CHECK(is_homehub_hostname("homehub-524288-fixture.local"));
    CHECK(is_homehub_hostname("HomeHub-524288-Test"));    // case-insensitive
    CHECK(!is_homehub_hostname("daikin-altherma-esp32")); // THIS firmware's own advert
    CHECK(!is_homehub_hostname("homehubitat"));           // prefix must include the dash
    CHECK(!is_homehub_hostname("home"));                  // shorter than the prefix
    CHECK(!is_homehub_hostname(""));
    CHECK(!is_homehub_hostname(nullptr));
    const char* names[] = {"daikin-altherma-esp32.local", "some-printer",
                           "homehub-524288-fixture.local"};
    CHECK(mb_first_homehub(names, 3) == 2);
    const char* none[] = {"daikin-altherma-esp32", "nas"};
    CHECK(mb_first_homehub(none, 2) == -1);
    // Discovery exposes the selected A record for this session, never the serial-derived mDNS
    // label.
    CHECK(mb_ipv4_string(192, 0, 2, 137) == "192.0.2.137");
    CHECK(mb_ipv4_string(255, 0, 10, 1) == "255.0.10.1");
    CHECK(mb_ipv4_string(256, 0, 0, 1).empty());
}

// The READ PLAN (logic/modbus_plan.hpp): which requests one poll cycle issues. Two silent failure
// modes to pin — a batch one register short (the last row of every run quietly stops refreshing)
// and a cadence that never fires a full cycle (the whole cache frozen at the first one).
static void test_modbus_plan() {
    using namespace daik::logic;

    // ── The cadence ─────────────────────────────────────────────────────────────────────────────
    // Tick 0 MUST be full: a session that opened with a fast cycle would leave /values empty until
    // the cadence wrapped, which reads as a broken hub rather than as a cadence.
    CHECK(mb_cycle_is_full(0));
    CHECK(!mb_cycle_is_full(1));
    CHECK(!mb_cycle_is_full(MB_FULL_CYCLE_TICKS - 1));
    CHECK(mb_cycle_is_full(MB_FULL_CYCLE_TICKS));
    CHECK(mb_cycle_is_full(MB_FULL_CYCLE_TICKS * 97));
    // A successful fast cycle has not re-read a full-cycle row that failed on the preceding full
    // cycle, so it cannot clear the one global Modbus error. Only a clean full cycle on the current
    // session proves whole-map recovery.
    CHECK(!mb_cycle_proves_recovery(false, true));
    CHECK(!mb_cycle_proves_recovery(true, false));
    CHECK(mb_cycle_proves_recovery(true, true));
    // A full cycle really does come round — a rule that never fires is the failure this pins.
    int full = 0;
    for (uint32_t t = 0; t < 100; t++)
        if (mb_cycle_is_full(t)) full++;
    CHECK(full == static_cast<int>(100 / MB_FULL_CYCLE_TICKS));
    // The wrap of a uint32 tick counter is not a cadence event: at ~1 Hz it is 136 years away, but
    // a rule that skipped a full cycle there would be unreachable by any test that did not ask.
    CHECK(mb_cycle_is_full(0xFFFFFFFFu - (0xFFFFFFFFu % MB_FULL_CYCLE_TICKS)));

    // ── Gate identity ───────────────────────────────────────────────────────────────────────────
    // Space is half the key: offset 3 exists in BOTH spaces and is a different register in each.
    CHECK(mb_offset_is_gate(MbFunc::ReadInput, 53));
    CHECK(mb_offset_is_gate(MbFunc::ReadInput, 38));
    CHECK(!mb_offset_is_gate(MbFunc::ReadHolding, 53));
    CHECK(!mb_offset_is_gate(MbFunc::ReadInput, 52)); // DHW operation is not a gate

    // ── Batching ────────────────────────────────────────────────────────────────────────────────
    // A run, a gap, and a space change, in one fixture. Deliberately given OUT of order, because
    // the shipped table is out of order too (holding rows sit after input rows with lower offsets).
    {
        const MbFunc   sp[]     = {MbFunc::ReadInput, MbFunc::ReadInput, MbFunc::ReadHolding,
                                   MbFunc::ReadInput, MbFunc::ReadInput, MbFunc::ReadHolding};
        const uint16_t off[]    = {41, 40, 2, 50, 42, 1};
        uint8_t        order[6] = {0};
        CHECK(mb_plan_order(sp, off, 6, order));
        MbBatch   b[6];
        const int nb = mb_plan_build(sp, off, 6, order, b, 6);
        CHECK(nb == 3);
        // Holding sorts before input (0x03 < 0x04); within a space, by offset.
        CHECK(b[0].space == MbFunc::ReadHolding && b[0].first_offset == 1 && b[0].count == 2);
        CHECK(b[1].space == MbFunc::ReadInput && b[1].first_offset == 40 && b[1].count == 3);
        CHECK(b[2].space == MbFunc::ReadInput && b[2].first_offset == 50 && b[2].count == 1);
        // Every row is covered exactly once — the property whose absence freezes rows silently.
        int covered = 0;
        for (int i = 0; i < nb; i++) covered += b[i].row_count;
        CHECK(covered == 6);
        // row_first indexes the ORDER array, so a batch decodes as a walk. Check it actually lands
        // on the rows the batch claims: b[1] covers offsets 40,41,42 in that order.
        CHECK(off[order[b[1].row_first + 0]] == 40);
        CHECK(off[order[b[1].row_first + 1]] == 41);
        CHECK(off[order[b[1].row_first + 2]] == 42);
        // None carries either a gate or the named fast context.
        CHECK(!mb_batch_is_fast(b[0]) && !mb_batch_is_fast(b[1]) && !mb_batch_is_fast(b[2]));
    }

    // A duplicated (space, offset) is REFUSED, not silently deduplicated: the batch walk hands
    // consecutive reply words to consecutive rows, so a duplicate would give one register's value
    // to two rows and shift every row after it by one.
    {
        const MbFunc   sp[]     = {MbFunc::ReadInput, MbFunc::ReadInput};
        const uint16_t off[]    = {40, 40};
        uint8_t        order[2] = {0};
        CHECK(!mb_plan_order(sp, off, 2, order));
    }
    // The same offset in the two spaces is NOT a duplicate.
    {
        const MbFunc   sp[]     = {MbFunc::ReadInput, MbFunc::ReadHolding};
        const uint16_t off[]    = {3, 3};
        uint8_t        order[2] = {0};
        CHECK(mb_plan_order(sp, off, 2, order));
        MbBatch b[2];
        CHECK(mb_plan_build(sp, off, 2, order, b, 2) == 2);
    }

    // A run longer than the cap splits, and the split loses nothing.
    {
        constexpr int N = MB_PLAN_MAX_REGS + 3;
        MbFunc        sp[N];
        uint16_t      off[N];
        for (int i = 0; i < N; i++) {
            sp[i]  = MbFunc::ReadInput;
            off[i] = static_cast<uint16_t>(1 + i);
        }
        uint8_t order[N] = {0};
        CHECK(mb_plan_order(sp, off, N, order));
        MbBatch   b[N];
        const int nb = mb_plan_build(sp, off, N, order, b, N);
        CHECK(nb == 2);
        CHECK(b[0].count == MB_PLAN_MAX_REGS);
        CHECK(b[1].count == 3);
        CHECK(b[1].first_offset == static_cast<uint16_t>(1 + MB_PLAN_MAX_REGS));
        int covered = 0;
        for (int i = 0; i < nb; i++) covered += b[i].row_count;
        CHECK(covered == N);
    }

    // Too little room answers -1 rather than a truncated plan: a plan missing its tail drops rows
    // with nothing anywhere to say so.
    {
        const MbFunc   sp[]     = {MbFunc::ReadInput, MbFunc::ReadInput};
        const uint16_t off[]    = {10, 20};
        uint8_t        order[2] = {0};
        CHECK(mb_plan_order(sp, off, 2, order));
        MbBatch b[2];
        CHECK(mb_plan_build(sp, off, 2, order, b, 1) == -1);
    }

    // ── The SHIPPED map ─────────────────────────────────────────────────────────────────────────
    // The measurement the change was made for, asserted rather than remembered. Every row covered
    // exactly once, every batch inside the protocol cap, and the request count per cycle — so a
    // future register added to def/homehub.hpp in a gap re-prices the link visibly instead of
    // quietly restoring the per-register sweep.
    {
        constexpr int N = daik::def::HOMEHUB_REG_COUNT;
        MbFunc        sp[N];
        uint16_t      off[N];
        for (int i = 0; i < N; i++) {
            sp[i]  = daik::def::HOMEHUB_REGS[i].space;
            off[i] = daik::def::HOMEHUB_REGS[i].offset;
        }
        uint8_t order[N] = {0};
        CHECK(mb_plan_order(sp, off, N, order));
        MbBatch   b[N];
        const int nb = mb_plan_build(sp, off, N, order, b, N);
        CHECK(nb == 10); // was N requests, one per register
        int covered = 0, fast_batches = 0, fast_regs = 0;
        for (int i = 0; i < nb; i++) {
            covered += b[i].row_count;
            CHECK(b[i].count >= 1 && b[i].count <= MB_PLAN_MAX_REGS);
            CHECK(b[i].count <= MB_MAX_READ_REGS);
            if (mb_batch_is_fast(b[i])) {
                fast_batches++;
                fast_regs += b[i].count;
            }
        }
        CHECK(covered == N);
        // BOTH gates must be reachable on a fast cycle. If a future map moved 38 or 53 so that one
        // of them fell into a full-only batch, the diagnosis would silently evaluate a gate that
        // is refreshed once per full cycle instead of once per second.
        CHECK(fast_batches == 3);
        CHECK(fast_regs == 13);
        // Every gate offset really is inside some fast batch — the assertion above counts batches,
        // this one proves the coverage it is standing in for.
        for (size_t g = 0; g < MB_GATE_OFFSET_COUNT; g++) {
            bool found = false;
            for (int i = 0; i < nb && !found; i++) {
                if (!mb_batch_is_fast(b[i])) continue;
                for (uint16_t k = 0; k < b[i].count; k++)
                    if (b[i].first_offset + k == MB_GATE_OFFSETS[g]) {
                        found = true;
                        break;
                    }
            }
            CHECK(found);
        }
        // Input 44 is not a gate and its 40..45 batch does not overlap either gate batch. It is
        // explicitly selected as fast context, spending one bundled request to make 1 Hz freshness
        // real rather than borrowing the last five-second cache cycle.
        bool outdoor_in_fast_batch = false;
        for (int i = 0; i < nb; i++) {
            if (!mb_batch_is_fast(b[i]) || b[i].space != MbFunc::ReadInput) continue;
            outdoor_in_fast_batch = b[i].first_offset <= 44 &&
                                    static_cast<uint16_t>(b[i].first_offset + b[i].count) > 44;
            if (outdoor_in_fast_batch) break;
        }
        CHECK(outdoor_in_fast_batch);
        // What the cycle actually costs, stated as the arithmetic rather than as a remembered
        // number.
        const double per_s = (fast_batches * (MB_FULL_CYCLE_TICKS - 1) + nb) /
                             static_cast<double>(MB_FULL_CYCLE_TICKS);
        CHECK(approx(per_s, 4.4));
        CHECK(per_s < N / 5.0); // at least a five-fold reduction against one request per register
    }
}

static void test_modbus_snapshot() {
    using daik::logic::modbus_cache_is_live;
    // A disconnected link never publishes, even if the cache and last session happen to match.
    CHECK(!modbus_cache_is_live(false, 7, 7, 3, 3));
    // The load-bearing reconnect case: /values copied session 7's cache, then session 8 connected
    // before it sampled status. A boolean-only post-check says "live"; the generation check refuses
    // the previous session's rows until session 8 has committed its own poll.
    CHECK(!modbus_cache_is_live(true, 8, 7, 3, 3));
    CHECK(modbus_cache_is_live(true, 8, 8, 3, 3));
    // A saved target invalidates the previous cache immediately, before the poll task gets CPU time
    // to close its old socket and publish a replacement cycle.
    CHECK(!modbus_cache_is_live(true, 8, 8, 4, 3));
    // Generation zero is the pre-first-commit sentinel, not a coincidentally matching session.
    CHECK(!modbus_cache_is_live(true, 0, 0, 3, 3));
    CHECK(!modbus_cache_is_live(true, 8, 8, 0, 0));
}

// The HomeHub Modbus register profile (def/homehub.hpp) — the DECODE MECHANICS (scaling, special
// values, text, offset -> PDU). Physical correctness of each row is an on-hardware check; what is
// host-testable is that the codecs + the extra `scale` divisor produce the right number and that a
// 32765/66/67 special is refused rather than published as a large value.
static void test_homehub() {
    using namespace daik::def;
    CHECK(HOMEHUB_REG_COUNT > 0);
    auto find = [](uint16_t off) -> const HomeHubReg* { return homehub_find(off); };
    // Every register must remain independently addressable in the flat /modbus payload and HA
    // discovery namespace. A label-slug collision would silently overwrite one JSON key/entity.
    for (int i = 0; i < HOMEHUB_REG_COUNT; i++) {
        CHECK(homehub_find(HOMEHUB_REGS[i].offset) == &HOMEHUB_REGS[i]);
        CHECK(!object_id(HOMEHUB_REGS[i].label).empty());
        for (int k = i + 1; k < HOMEHUB_REG_COUNT; k++)
            CHECK(object_id(HOMEHUB_REGS[i].label) != object_id(HOMEHUB_REGS[k].label));
    }
    char    buf[32];
    MbValue v;
    // Temperature (Temp16 = signed /100 °C) — return water at offset 42, read from an input
    // register.
    const HomeHubReg* t = find(42);
    CHECK(t && t->type == MbType::Temp16 && t->space == MbFunc::ReadInput);
    CHECK(homehub_decode(*t, 3550, v) && approx(v.value, 35.5));
    CHECK(homehub_format(*t, 3550, buf, sizeof(buf)) && std::string(buf) == "35.5");
    // A negative temperature keeps its sign — the exact class of bug the X10A port shipped
    // (#35-#39).
    CHECK(homehub_format(*t, static_cast<uint16_t>(-500), buf, sizeof(buf)) &&
          std::string(buf) == "-5.0");
    // Flow is a plain Int16 carrying L/min x100, so the `scale` field divides the decode by 100.
    const HomeHubReg* f = find(49);
    CHECK(f && f->type == MbType::Int16 && f->scale == 100);
    CHECK(homehub_decode(*f, 1500, v) && approx(v.value, 15.0));
    CHECK(homehub_format(*f, 1500, buf, sizeof(buf)) && std::string(buf) == "15.0");
    // A special value (32765 wait / 32766 unavailable / 32767 unsupported) is NOT data: both
    // refuse.
    CHECK(!homehub_decode(*t, MB_UNAVAILABLE, v));
    CHECK(!homehub_format(*t, MB_UNSUPPORTED, buf, sizeof(buf)));
    CHECK(!homehub_format(*f, MB_WAIT, buf, sizeof(buf)));
    // Text16 error code: 0x5538 -> "U8" (the guide's own worked example).
    const HomeHubReg* ec = find(22);
    CHECK(ec && ec->type == MbType::Text16);
    CHECK(homehub_format(*ec, 0x5538, buf, sizeof(buf)) && std::string(buf) == "U8");
    CHECK(homehub_is_text(*ec));
    // Dimensionless Int16 does not determine the SEMANTICS. EKRHH 4P744838-1E §9.2 uses the same
    // numeric wire type for one real number (the error sub-code), six binary flags and four enums.
    // Pin the complete classification and the one true text row.
    int dimensionless = 0, statuses = 0, text_rows = 0;
    for (int i = 0; i < HOMEHUB_REG_COUNT; i++) {
        const HomeHubReg& r = HOMEHUB_REGS[i];
        if (homehub_is_text(r)) text_rows++;
        if (r.type != MbType::Int16 || r.scale != 1 || r.unit[0] != '\0') continue;
        dimensionless++;
        if (r.kind == HomeHubValueKind::Number)
            CHECK(r.offset == 23); // actual numeric sub-code
        else
            statuses++;
    }
    CHECK(dimensionless == 14 && statuses == 13 && text_rows == 1);

    const HomeHubReg* compressor = find(31);
    CHECK(compressor && compressor->kind == HomeHubValueKind::Binary &&
          compressor->space == MbFunc::ReadInput);
    CHECK(homehub_format(*compressor, 0, buf, sizeof(buf)) && std::string(buf) == "0");
    CHECK(homehub_format(*compressor, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    const HomeHubReg* tank_heater = find(32);
    CHECK(tank_heater && tank_heater->kind == HomeHubValueKind::Binary &&
          tank_heater->space == MbFunc::ReadInput);

    // Enums retain the raw constants on every public wire. /values carries a separate semantic id
    // so the browser can still display the manufacturer's state names at the visual boundary.
    // Holding 3: 0 Auto, 1 Heating, 2 Cooling. Heating-only units return the unavailable sentinel.
    const HomeHubReg* om = find(3);
    CHECK(om && om->kind == HomeHubValueKind::OperationMode && om->space == MbFunc::ReadHolding);
    CHECK(homehub_format(*om, 0, buf, sizeof(buf)) && std::string(buf) == "0");
    CHECK(homehub_format(*om, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    CHECK(homehub_format(*om, 2, buf, sizeof(buf)) && std::string(buf) == "2");
    CHECK(homehub_format(*om, 7, buf, sizeof(buf)) && std::string(buf) == "7");
    CHECK(!homehub_is_text(*om));
    CHECK(std::string(homehub_enum_id(om->kind)) == "operation_mode");
    // Input 38 is the CURRENT operating mode used as an independent heating-vs-cooling witness;
    // holding 3 above is the requested/selected mode and cannot prove what is running now.
    const HomeHubReg* current_mode = find(38);
    CHECK(current_mode && current_mode->kind == HomeHubValueKind::CurrentOperationMode &&
          current_mode->space == MbFunc::ReadInput);
    CHECK(homehub_format(*current_mode, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    CHECK(homehub_format(*current_mode, 2, buf, sizeof(buf)) && std::string(buf) == "2");
    CHECK(std::string(homehub_enum_id(current_mode->kind)) == "current_operation_mode");

    const HomeHubReg* abnormal = find(21);
    CHECK(abnormal && abnormal->kind == HomeHubValueKind::UnitAbnormality &&
          !homehub_is_binary(*abnormal));
    CHECK(homehub_format(*abnormal, 0, buf, sizeof(buf)) && std::string(buf) == "0");
    CHECK(homehub_format(*abnormal, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    CHECK(homehub_format(*abnormal, 2, buf, sizeof(buf)) && std::string(buf) == "2");
    CHECK(std::string(homehub_enum_id(abnormal->kind)) == "unit_abnormality");

    const HomeHubReg* valve = find(37);
    CHECK(valve && valve->kind == HomeHubValueKind::ThreeWayValve && !homehub_is_binary(*valve));
    CHECK(homehub_format(*valve, 0, buf, sizeof(buf)) && std::string(buf) == "0");
    CHECK(homehub_format(*valve, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    CHECK(std::string(homehub_enum_id(valve->kind)) == "three_way_valve");

    const HomeHubReg* sg = find(56);
    CHECK(sg && sg->kind == HomeHubValueKind::SmartGridMode && !homehub_is_binary(*sg));
    for (int i = 0; i < 4; i++) {
        CHECK(homehub_format(*sg, static_cast<uint16_t>(i), buf, sizeof(buf)) &&
              std::string(buf) == std::to_string(i));
    }
    CHECK(std::string(homehub_enum_id(sg->kind)) == "smart_grid_mode");

    const HomeHubReg* lwt_offset = find(54);
    CHECK(lwt_offset && lwt_offset->space == MbFunc::ReadHolding &&
          lwt_offset->type == MbType::Int16 && lwt_offset->scale == 1);
    CHECK(std::string(lwt_offset->unit) == "K");
    CHECK(homehub_format(*lwt_offset, static_cast<uint16_t>(-3), buf, sizeof(buf)) &&
          std::string(buf) == "-3");

    // Real flags keep numeric 1/0 at the API boundary and are marked structurally for ON/OFF UI.
    for (uint16_t off : {30, 32, 33, 52, 53, 4, 9}) {
        const HomeHubReg* flag = find(off);
        CHECK(flag && homehub_is_binary(*flag));
        CHECK(!homehub_is_text(*flag));
        CHECK(homehub_enum_id(flag->kind) == nullptr);
        CHECK(homehub_format(*flag, 0, buf, sizeof(buf)) && std::string(buf) == "0");
        CHECK(homehub_format(*flag, 1, buf, sizeof(buf)) && std::string(buf) == "1");
    }
    // The 1-based EKRHH offset maps to the 0-based wire PDU address.
    uint16_t pdu = 0xFFFF;
    CHECK(mb_pdu_address(t->offset, pdu) && pdu == static_cast<uint16_t>(t->offset - 1));
    // The synthetic MQTT group page resolves to "modbus" (the poll branch tags every HomeHub cache
    // row with HOMEHUB_GROUP_REG so the bridge groups them together — this pins the two in step).
    CHECK(std::string(group_for_page(HOMEHUB_GROUP_REG)) == "modbus");
    CHECK(homehub_find(999) == nullptr);
}

// The syslog replay records (logic/bootlog.hpp): the build-identity boot line + the crash rendered
// as datagram-sized single-line records. syslog.cpp sends these once, after DNS resolves. The X10A
// ↔ HomeHub concept pairing (logic/homehub_map.hpp) — the ONE place the two independent stacks
// meet. The pairing must be STRUCTURAL: a label match would be both incomplete (four spellings of
// leaving water across the catalog) and wrong (the "(R1T)" tag names two different sensors), and a
// wrong pairing is worst in the FALLBACK case, where the Modbus value stands alone under the X10A
// row's name with nothing beside it to look implausible against.
static void test_homehub_map() {
    using namespace daik::logic;
    // Every paired offset is a real HomeHub register, and every concept a real trend id (the latter
    // is also a static_assert in the header — asserted here too so the failure names itself).
    for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++) {
        const auto& c          = HOMEHUB_CONCEPTS[i];
        bool        reg_exists = false;
        for (int k = 0; k < daik::def::HOMEHUB_REG_COUNT; k++)
            if (daik::def::HOMEHUB_REGS[k].offset == c.offset) {
                reg_exists = true;
                break;
            }
        CHECK(reg_exists);
        CHECK(trend_by_id(c.concept_id) != nullptr);
        CHECK(homehub_concept_index(c.concept_id) == static_cast<int>(i));
    }
    // The history set repeats the paired concepts, adds the derived Smart-Grid state, then the
    // deliberately Modbus-only disinfection operation. Every entry names a real register; only an
    // entry declared as an X10A timeline may share a real TRENDS id.
    CHECK(HOMEHUB_HISTORY_COUNT == HOMEHUB_CONCEPT_COUNT + 2);
    for (size_t i = 0; i < HOMEHUB_HISTORY_COUNT; i++) {
        const auto& h          = HOMEHUB_HISTORIES[i];
        bool        reg_exists = false;
        for (int k = 0; k < daik::def::HOMEHUB_REG_COUNT; k++)
            if (daik::def::HOMEHUB_REGS[k].offset == h.offset) {
                reg_exists = true;
                break;
            }
        CHECK(reg_exists);
        CHECK((trend_by_id(h.trend_id) != nullptr) == h.has_x10a);
        CHECK(homehub_history_index(h.trend_id) == static_cast<int>(i));
    }
    CHECK(std::string(HOMEHUB_HISTORIES[HOMEHUB_HISTORY_COUNT - 1].trend_id) ==
          "disinfection_state");
    CHECK(HOMEHUB_HISTORIES[HOMEHUB_HISTORY_COUNT - 1].offset == 33);
    CHECK(HOMEHUB_HISTORIES[HOMEHUB_HISTORY_COUNT - 1].event);
    CHECK(!HOMEHUB_HISTORIES[HOMEHUB_HISTORY_COUNT - 1].has_x10a);
    CHECK(homehub_history_index("valve_dhw") >= 0);
    CHECK(homehub_history_index("quiet_state") >= 0);
    CHECK(homehub_history_index("disinfection_state") >= 0);
    CHECK(std::string(homehub_history_for(33)) == "disinfection_state");
    CHECK(homehub_history_for(51) == nullptr);
    CHECK(homehub_history_index("heat_pump_power") == -1);
    CHECK(homehub_history_index(nullptr) == -1);
    // Lookup both ways.
    CHECK(std::string(homehub_concept_for(43)) == "dhw_tank");
    CHECK(std::string(homehub_concept_for(40)) == "leaving_water");
    CHECK(std::string(homehub_concept_for(41)) == "leaving_water_post_buh");
    CHECK(std::string(homehub_concept_for(45)) == "refrigerant_liquid");
    CHECK(std::string(homehub_concept_for(32)) == "bsh_state");
    CHECK(std::string(homehub_concept_for(37)) == "valve_dhw");
    CHECK(std::string(homehub_concept_for(9)) == "quiet_state");
    CHECK(homehub_concept_for(56) == nullptr); // historied state, but not a one-row X10A pairing
    CHECK(homehub_concept_for(33) ==
          nullptr); // disinfection is HomeHub-only; preheat is not its twin
    CHECK(homehub_concept_for(51) ==
          nullptr); // power: X10A has no equivalent, deliberately unpaired
    CHECK(homehub_concept_for(999) == nullptr);
    CHECK(homehub_concept_index("heat_pump_power") == -1);
    CHECK(homehub_concept_index(nullptr) == -1);

    // The X10A side resolves through trend_row_matches, so it agrees with the trend rings by
    // construction. Spot-check the locators the pairings above depend on.
    CHECK(std::string(x10a_concept_for(0x61, 10, "°C", 0)) == "dhw_tank");
    CHECK(std::string(x10a_concept_for(0x61, 2, "°C", 0)) == "leaving_water");
    CHECK(std::string(x10a_concept_for(0x61, 4, "°C", 0)) == "leaving_water_post_buh");
    CHECK(std::string(x10a_concept_for(0x61, 6, "°C", 0)) == "refrigerant_liquid");
    CHECK(std::string(x10a_concept_for(0x61, 8, "°C", 0)) == "return_water");
    CHECK(std::string(x10a_concept_for(0x60, 12, "", 305)) == "bsh_state");
    CHECK(std::string(x10a_concept_for(0x60, 12, "", 306)) == "valve_dhw");
    CHECK(std::string(x10a_concept_for(0x60, 2, "", 301)) == "quiet_state");
    CHECK(x10a_concept_for(0x61, 10, "bar", 0) == nullptr); // unit is part of the locator
    CHECK(x10a_concept_for(0x99, 0, "°C", 0) == nullptr);

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
            int         hits = 0;
            for (size_t k = 0; k < view.count(); k++) {
                const ValueDef d = adjudicated(view[k]);
                const char*    got =
                    x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                if (got && trend_cstr_eq(got, want)) hits++;
            }
            // 0 is legitimate — a profile need not carry every quantity (a monobloc has no room
            // sensor). 2+ is not: it would make the pairing depend on row order.
            CHECK(hits <= 1);
        }
    }
    CHECK(profiles_checked > 20); // the assertion above must have actually run over the catalog

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
                const char*    got =
                    x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                if (got && trend_cstr_eq(got, HOMEHUB_CONCEPTS[i].concept_id)) total++;
            }
        }
        CHECK(total > 0);
    }

    // ── STATES ────────────────────────────────────────────────────────────────────────────────
    // Same claim, one field wider. The wider key is the whole point: `3way valve`, `2way valve`,
    // `BSH`, `BUH Step1`, `BUH Step2` and `Water pump operation` all sit at 0x60/12 and differ ONLY
    // by converter, so a (reg, offset, unit) locator answers "the pump" when asked for the
    // diverter.
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
    CHECK(x10a_concept_for(0x60, 12, "", 302) ==
          nullptr); // another bit sharing the byte stays unpaired
    CHECK(x10a_concept_for(0x62, 2, "", 304) == nullptr); // the DHW BOOST is deliberately unpaired

    // Over the catalog: each state locator resolves to EXACTLY ONE row per detectable profile, and
    // that row is the one the pairing names. Identity, not just count — a locator that resolves
    // uniquely onto the wrong row is the failure this whole header exists to prevent.
    for (size_t i = 0; i < HOMEHUB_STATE_COUNT; i++) {
        const auto& st            = HOMEHUB_STATES[i];
        int         profiles_with = 0;
        for (const auto& prof : daik::def::profiles) {
            if (!daik::def::is_detection_model(prof.id)) continue;
            const auto view = daik::def::resolved(prof);
            int        hits = 0;
            for (size_t k = 0; k < view.count(); k++) {
                const ValueDef d = adjudicated(view[k]);
                const char*    got =
                    x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
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
        CHECK(profiles_with > 20); // a pairing carried by a handful of profiles is not a pairing
    }

    // ── COVERAGE, PINNED ──────────────────────────────────────────────────────────────────────
    // The assertions above are "at most one per profile" and "carried by enough of them" — neither
    // says how MANY profiles actually resolve each pairing, so the docs' claim that they all do was
    // an unguarded statement about the catalog. Measured: every one of the ten resolves on every
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
                    const char*    got =
                        x10a_concept_for(d.reg, d.offset, unit_for_datatype(d.type), d.conv);
                    if (got && trend_cstr_eq(got, cid)) {
                        n++;
                        break;
                    }
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
    // ── Build identity: emitted on EVERY boot, clean or not — it is what ties a log stream to a
    // binary.
    BootIdent id;
    id.version = "1.4.2";
    id.elf_sha = "deadbeef";
    id.reason  = 1; // poweron
    CHECK(build_boot_line(id) ==
          "boot: version=1.4.2 elf_sha256=deadbeef reset=poweron safe_mode=no");

    // Safe mode is visible in the log stream: it explains a device that is up but publishes
    // nothing.
    BootIdent safe = id;
    safe.reason    = 6; // task_wdt
    safe.safe_mode = true;
    CHECK(build_boot_line(safe) ==
          "boot: version=1.4.2 elf_sha256=deadbeef reset=task_wdt safe_mode=yes");

    // Missing identity degrades to "?" — never a dangling "version= elf_sha256=".
    BootIdent blank;
    CHECK(build_boot_line(blank) == "boot: version=? elf_sha256=? reset=unknown safe_mode=no");
    BootIdent nulls;
    nulls.version = nullptr;
    nulls.elf_sha = nullptr;
    CHECK(build_boot_line(nulls) == "boot: version=? elf_sha256=? reset=unknown safe_mode=no");

    std::string lines[CRASH_LOG_LINE_MAX];

    // A clean boot produces NO crash records — the notability rule lives in the pure function, so
    // the device caller cannot spam the collector with "crash:" lines after every config-save
    // reboot.
    CrashInfo clean;
    clean.reason = 3; // sw
    CHECK(build_crash_log_lines(clean, lines, CRASH_LOG_LINE_MAX) == 0);

    // Orphan dump, no parsable summary: the header line alone (nothing to say about task/pc/bt).
    CrashInfo orphan;
    orphan.reason   = 1; // poweron
    orphan.coredump = true;
    CHECK(build_crash_log_lines(orphan, lines, CRASH_LOG_LINE_MAX) == 1);
    CHECK(lines[0] == "crash: reset=poweron fault=no coredump=yes");

    // Fault with no dump (dump partition full / erased): still notable, still one header line.
    CrashInfo nodump;
    nodump.reason = 6; // task_wdt
    CHECK(build_crash_log_lines(nodump, lines, CRASH_LOG_LINE_MAX) == 1);
    CHECK(lines[0] == "crash: reset=task_wdt fault=yes coredump=no");

    // Full panic summary → all three records, each self-contained and greppable as "crash".
    CrashInfo panic;
    panic.reason       = 4; // ESP_RST_PANIC
    panic.coredump     = true;
    panic.have_summary = true;
    std::snprintf(panic.task, sizeof(panic.task), "%s", "mqtt_pub");
    panic.pc       = 0x400d1234;
    panic.bt[0]    = 0x400d1234;
    panic.bt[1]    = 0x400d5678;
    panic.bt_depth = 2;
    std::snprintf(panic.elf_sha, sizeof(panic.elf_sha), "%s", "abc123");
    CHECK(build_crash_log_lines(panic, lines, CRASH_LOG_LINE_MAX) == 3);
    CHECK(lines[0] == "crash: reset=panic fault=yes coredump=yes");
    CHECK(lines[1] == "crash: task=mqtt_pub pc=0x400d1234 elf_sha256=abc123");
    CHECK(lines[2] == "crash: backtrace=0x400d1234 0x400d5678");

    // An unreliable unwind is flagged inline rather than silently passing off a bogus backtrace.
    CrashInfo corrupt    = panic;
    corrupt.bt_corrupted = true;
    CHECK(build_crash_log_lines(corrupt, lines, CRASH_LOG_LINE_MAX) == 3);
    CHECK(corrupt.bt_corrupted &&
          lines[1] == "crash: task=mqtt_pub pc=0x400d1234 corrupted=yes elf_sha256=abc123");

    // A summary with an empty backtrace drops the bt record (no "backtrace=" with nothing after
    // it).
    CrashInfo nobt = panic;
    nobt.bt_depth  = 0;
    CHECK(build_crash_log_lines(nobt, lines, CRASH_LOG_LINE_MAX) == 2);

    // bt_depth is clamped to the 16-entry buffer — a corrupt summary can over-report it (OOB read).
    CrashInfo over = panic;
    over.bt_depth  = 99;
    CHECK(build_crash_log_lines(over, lines, CRASH_LOG_LINE_MAX) == 3);
    size_t cnt = 0, at = 0;
    while ((at = lines[2].find("0x", at)) != std::string::npos) {
        cnt++;
        at += 2;
    }
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
    CrashInfo    worst;
    worst.reason       = 6;
    worst.coredump     = true;
    worst.have_summary = true;
    worst.bt_corrupted = true;
    std::snprintf(worst.task, sizeof(worst.task), "%s", "123456789012345"); // fills task[16]
    worst.pc = 0xffffffff;
    for (int i = 0; i < 16; i++) worst.bt[i] = 0xffffffff;
    worst.bt_depth = 16;
    for (int i = 0; i < 64; i++) worst.elf_sha[i] = 'f'; // fills elf_sha[65]
    const int wn = build_crash_log_lines(worst, lines, CRASH_LOG_LINE_MAX);
    CHECK(wn == 3);
    for (int i = 0; i < wn; i++) CHECK(lines[i].size() <= CRASH_LOG_LINE_BUDGET);
    CHECK(build_crash_text(worst).size() > 256); // the multi-line block that would NOT have fitted
    // The two facts truncation used to eat are present, in full, in a record that fits.
    CHECK(lines[1].find(
              "elf_sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") !=
          std::string::npos);
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

    // Unknown errno defaults to TRANSIENT. Safe by asymmetry: clearing the throttle only
    // ACCELERATES the next resolve (the 10 s cadence runs regardless), so a misjudged hard error
    // costs one cadence of delay, while a misjudged transient one costs the storm above.
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
    CHECK(rfc3339_utc(1709208296) == "2024-02-29T12:04:56.000Z"); // 2024 is a leap year
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
// ── logic/hp_probe.hpp — the free register probe ────────────────────────────────────────────────
// The sweep is the part that carries risk: it pairs EVERY candidate converter with caller-chosen
// bytes, a far wider input domain than the poll path reaches (the catalog only ever pairs a
// converter with the offsets its own model uses). Enum-table bounds, sentinel handling and the
// dedup rule are therefore asserted here rather than discovered on a board.
static const ProbeDecode* probe_find(const ProbeDecode* d, int n, int conv) {
    for (int i = 0; i < n; i++)
        if (d[i].conv == conv) return &d[i];
    return nullptr;
}
static bool probe_has_alias(const ProbeDecode& d, int conv) {
    for (int i = 0; i < d.alias_count; i++)
        if (d.alias[i] == conv) return true;
    return false;
}
static const ProbeDecode* probe_find_or_alias(const ProbeDecode* d, int n, int conv) {
    for (int i = 0; i < n; i++)
        if (d[i].conv == conv || probe_has_alias(d[i], conv)) return &d[i];
    return nullptr;
}

static void test_hp_probe() {
    // ── The request slot. The gate mutex serialises CALLERS but not a caller against the poll
    // task, so the interleaving below is reachable on a real device and is where the bug was: a
    // caller whose timeout expired walks away mid-round-trip, the next one arms its own register,
    // and the abandoned service completes. Replayed here because no device test can reach it.
    CHECK(probe_pack(1, 0x60) == ((1u << 8) | 0x60));
    CHECK(probe_reg_of(probe_pack(7, 0xA1)) == 0xA1);
    CHECK(probe_ticket_of(probe_pack(7, 0xA1)) == 7u);
    CHECK(probe_reply_matches(7, 7));
    CHECK(!probe_reply_matches(7, 8));
    // 0 is "no request", so a masked-zero ticket must never be handed out — otherwise probing
    // register 0x00, the first page anyone walking the map asks for, would pack to exactly "none".
    CHECK(probe_ticket_normalize(0) == 1u);
    CHECK(probe_pack(0, 0x00) != 0u);
    CHECK(probe_pack(1u << 24, 0x00) != 0u);
    // The field is 24 bits and the counter is 32, so the match test must compare the MASKED ticket:
    // a raw comparison would reject every reply after 2^24 probes and time the route out forever on
    // a device that is working perfectly.
    CHECK(probe_ticket_of(probe_pack(1u << 24 | 5u, 0x10)) == 5u);
    CHECK(probe_reply_matches(probe_ticket_of(probe_pack(1u << 24 | 5u, 0x10)), (1u << 24) | 5u));

    {
        // Replay: A arms 0x60, the poll task takes it, A gives up, B arms 0x61, A's service
        // commits.
        uint32_t       slot = 0, reply_ticket = 0;
        uint8_t        reply_reg = 0;
        const uint32_t a = probe_ticket_normalize(1), b = probe_ticket_normalize(2);

        slot                 = probe_pack(a, 0x60); // A submits
        const uint32_t taken = slot;                // poll task takes it and starts a query
        CHECK(probe_reg_of(taken) == 0x60);

        uint32_t mine = probe_pack(a, 0x60); // A times out and withdraws ITS request
        if (slot == mine) slot = 0;          // (compare-exchange)
        CHECK(slot == 0);

        slot = probe_pack(b, 0x61); // B arms its own register

        reply_reg       = probe_reg_of(taken); // A's service completes
        reply_ticket    = probe_ticket_of(taken);
        uint32_t served = taken;
        if (slot == served) slot = 0; // withdraw only what WAS served
        // B's request survived: an unconditional reset here discarded it and B waited out its whole
        // timeout for a query that was never put on the bus.
        CHECK(slot == probe_pack(b, 0x61));
        // ...and B refuses the reply it was woken by, because it is A's.
        CHECK(!probe_reply_matches(reply_ticket, b));
        CHECK(reply_reg == 0x60);
        // B's own service then answers B.
        reply_ticket = probe_ticket_of(slot);
        reply_reg    = probe_reg_of(slot);
        CHECK(probe_reply_matches(reply_ticket, b));
        CHECK(reply_reg == 0x61);
    }

    // ── Request bounds: everything decidable WITHOUT the reply is decided before the bus is used.
    ProbeRequest q{0x60, 11, 1, 105};
    CHECK(probe_validate(q) == ProbeReject::None);
    CHECK(probe_validate({-1, 0, 1, PROBE_SWEEP}) == ProbeReject::Register);
    CHECK(probe_validate({0x100, 0, 1, PROBE_SWEEP}) == ProbeReject::Register);
    CHECK(probe_validate({0x60, -1, 1, PROBE_SWEEP}) == ProbeReject::Offset);
    CHECK(probe_validate({0x60, PROBE_MAX_PAYLOAD, 1, PROBE_SWEEP}) == ProbeReject::Offset);
    CHECK(probe_validate({0x60, 0, 0, PROBE_SWEEP}) == ProbeReject::Size);
    CHECK(probe_validate({0x60, 0, 3, PROBE_SWEEP}) == ProbeReject::Size);
    CHECK(probe_validate({0x60, 0, 2, 1000}) == ProbeReject::Converter);
    // The sweep sentinel is NOT an out-of-range converter, and an UNIMPLEMENTED id is not rejected:
    // "nothing decodes this" is an answer the probe exists to give, not a request to refuse.
    CHECK(probe_validate({0x60, 0, 2, PROBE_SWEEP}) == ProbeReject::None);
    CHECK(probe_validate({0x60, 0, 2, 462}) == ProbeReject::None);
    CHECK(std::string(probe_reject_name(ProbeReject::None)).empty());
    for (auto r :
         {ProbeReject::Register, ProbeReject::Offset, ProbeReject::Size, ProbeReject::Converter})
        CHECK(probe_reject_name(r)[0] != '\0');
    CHECK(std::string(probe_reject_name(static_cast<ProbeReject>(99))) == "invalid request");

    // ── hp_query's negative returns keep exactly one interpretation.
    CHECK(probe_status_from_query(12) == ProbeStatus::Ok);
    CHECK(probe_status_from_query(-1) == ProbeStatus::NoReply);
    CHECK(probe_status_from_query(-2) == ProbeStatus::Rejected);
    CHECK(probe_status_from_query(-3) == ProbeStatus::BadCrc);
    for (auto st : {ProbeStatus::Ok, ProbeStatus::Busy, ProbeStatus::NoLink, ProbeStatus::Timeout,
                    ProbeStatus::NoReply, ProbeStatus::Rejected, ProbeStatus::BadCrc,
                    ProbeStatus::UnexpectedReply, ProbeStatus::InvalidLength,
                    ProbeStatus::ShortReply, ProbeStatus::OutOfBounds})
        CHECK(probe_status_name(st)[0] != '\0');
    CHECK(std::string(probe_status_name(ProbeStatus::Ok)) == "ok");
    CHECK(std::string(probe_status_name(ProbeStatus::OutOfBounds)) == "out_of_bounds");
    CHECK(std::string(probe_status_name(ProbeStatus::UnexpectedReply)) == "unexpected_reply");
    CHECK(std::string(probe_status_name(ProbeStatus::InvalidLength)) == "invalid_length");
    CHECK(probe_status_from_reply(HpReplyKind::InvalidLength) == ProbeStatus::InvalidLength);
    CHECK(std::string(probe_status_name(static_cast<ProbeStatus>(99))) == "error");

    // ── The slice bound applied AFTER the reply: a page shorter than the caller assumed is a
    // finding, not a transport error.
    CHECK(probe_slice_fits(0, 2, 2));
    CHECK(probe_slice_fits(6, 2, 8));
    CHECK(!probe_slice_fits(7, 2, 8));
    CHECK(!probe_slice_fits(-1, 2, 8));
    CHECK(!probe_slice_fits(0, 0, 8));
    CHECK(!probe_slice_fits(0, 2, 0));

    ProbeDecode d[PROBE_MAX_DECODES];

    // ── A 2-byte field: 0x010A little-endian = 266 raw, 26.6 as a ×0.1 temperature.
    const uint8_t two[2] = {0x0A, 0x01};
    int           n      = probe_sweep(two, 2, 0, 2, d, PROBE_MAX_DECODES);
    CHECK(n > 0 && n <= PROBE_MAX_DECODES);
    const ProbeDecode* t = probe_find(d, n, 105);
    CHECK(t && t->ok && !t->is_text && t->value == 26.6);
    // 107/114/119 are the same maths with a sentinel test that does not fire here, so they must
    // MERGE into 105's row rather than repeat the number three more times.
    CHECK(t && probe_has_alias(*t, 107) && probe_has_alias(*t, 114) && probe_has_alias(*t, 119));
    CHECK(probe_find(d, n, 107) == nullptr);
    // Endianness genuinely differs, so 106 stays its own row (and takes 108 with it).
    const ProbeDecode* be = probe_find(d, n, 106);
    CHECK(be && be->value == 256.1 && probe_has_alias(*be, 108));
    // Signed and unsigned agree on a positive value — an honest merge, not a lost row.
    const ProbeDecode* raw = probe_find(d, n, 101);
    CHECK(raw && raw->value == 266.0 && probe_has_alias(*raw, 151));
    // Distinct scales must NOT merge: 103 (/256) and 109 (/256 ×2) differ by a factor of two, and
    // choosing between them is the whole point of a sweep.
    const ProbeDecode* s256 = probe_find(d, n, 103);
    const ProbeDecode* s512 = probe_find(d, n, 109);
    CHECK(s256 && s512 && s256->value != s512->value);
    // conv 405 reads the same bytes as a pressure and answers a saturation temperature.
    const ProbeDecode* sat = probe_find(d, n, 405);
    CHECK(sat && sat->ok && sat->value != 26.6);

    // ── The 0x8000 sentinel is exactly where 105 and 107 part company, and getting that wrong is
    // the difference between publishing -3276.8 °C and reporting "no data".
    const uint8_t sentinel[2] = {0x00, 0x80};
    n                         = probe_sweep(sentinel, 2, 0, 2, d, PROBE_MAX_DECODES);
    const ProbeDecode* plain  = probe_find(d, n, 105);
    CHECK(plain && plain->ok && plain->value == -3276.8);
    const ProbeDecode* guarded = probe_find(d, n, 107);
    CHECK(guarded && !guarded->ok && !guarded->is_text);
    CHECK(guarded && probe_has_alias(*guarded, 114) && probe_has_alias(*guarded, 119));

    // ── A converter that RAN and refused is kept as its own answer: 405 on 0 bar is an absent
    // transducer, which is a different finding from "no converter decodes this".
    const uint8_t zero[2]      = {0x00, 0x00};
    n                          = probe_sweep(zero, 2, 0, 2, d, PROBE_MAX_DECODES);
    const ProbeDecode* refused = probe_find(d, n, 405);
    CHECK(refused && !refused->ok && !refused->is_text);

    // ── A 1-byte field, 0x05: bits 0 and 2 set, and every enum table indexed by a byte the poll
    // path may never have handed it. OP_MODE[5] is "Auto Cool"; conv 203/316 have no entry for 5
    // and must answer "?" rather than read past their tables.
    const uint8_t one[1]       = {0x05};
    n                          = probe_sweep(one, 1, 0, 1, d, PROBE_MAX_DECODES);
    const ProbeDecode* rawbyte = probe_find_or_alias(d, n, 211);
    CHECK(rawbyte && rawbyte->value == 5.0);
    CHECK(rawbyte && probe_find_or_alias(d, n, 219) == rawbyte &&
          probe_find_or_alias(d, n, 214) == rawbyte);
    // conv 311 masks the low three bits, which on 0x05 is the whole byte — so it merges, correctly.
    CHECK(rawbyte && probe_find_or_alias(d, n, 311) == rawbyte);
    const ProbeDecode* scaled  = probe_find_or_alias(d, n, 105);
    const ProbeDecode* current = probe_find_or_alias(d, n, 161);
    CHECK(scaled && scaled->ok && scaled->value == 0.5);
    CHECK(current && current->ok && current->value == 2.5);
    const ProbeDecode* mode = probe_find(d, n, 217);
    CHECK(mode && mode->is_text && std::string(mode->text) == "Auto Cool");
    const ProbeDecode* cls = probe_find(d, n, 203);
    CHECK(cls && cls->is_text && std::string(cls->text) == "?");
    const ProbeDecode* code = probe_find(d, n, 204);
    CHECK(code && code->is_text && std::string(code->text) == "5");
    const ProbeDecode* iu = probe_find(d, n, 315);
    CHECK(iu && iu->is_text && std::string(iu->text) == "Stop");
    // The set bit and the clear bits are different answers; the clear ones merge with each other.
    const ProbeDecode* bit0 = probe_find(d, n, 300);
    CHECK(bit0 && bit0->value == 1.0 && probe_has_alias(*bit0, 302));
    CHECK(probe_find(d, n, 301) == nullptr || probe_find(d, n, 301)->value == 0.0);

    // Every byte value must stay inside every enum table — the sweep is what makes 0..255 reachable
    // on converters the catalog only ever pairs with a few offsets.
    for (int b = 0; b <= 0xFF; b++) {
        const uint8_t byte[1] = {static_cast<uint8_t>(b)};
        const int     m       = probe_sweep(byte, 1, 0, 1, d, PROBE_MAX_DECODES);
        CHECK(m > 0 && m <= PROBE_MAX_DECODES);
        for (int i = 0; i < m; i++) CHECK(d[i].alias_count <= PROBE_MAX_ALIASES);
    }

    // Concrete catalog witnesses for the width-1 numeric converters that the original sweep
    // omitted: 0x50 is 8.0 kW through conv 105 and 16.0 A through conv 161.
    const uint8_t width_one[1] = {0x50};
    n                          = probe_sweep(width_one, 1, 0, 1, d, PROBE_MAX_DECODES);
    const ProbeDecode* kw      = probe_find_or_alias(d, n, 105);
    const ProbeDecode* amps    = probe_find_or_alias(d, n, 161);
    const ProbeDecode* u8      = probe_find_or_alias(d, n, 101);
    const ProbeDecode* s8      = probe_find_or_alias(d, n, 152);
    CHECK(kw && kw->value == 8.0);
    CHECK(amps && amps->value == 40.0);
    CHECK(u8 && u8->value == 80.0);
    CHECK(s8 && s8->value == 80.0);

    // Every implemented, data-consuming (converter,width) pair used by any resolved production
    // profile must be available in the default sweep. This derives coverage from the real catalog,
    // so a regenerated profile cannot silently add another omitted width.
    const uint8_t sample_bytes[2] = {1, 0};
    for (const auto& profile : def::profiles) {
        const auto view = def::resolved(profile);
        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef& row = view[i];
            if (!probe_catalog_row(row)) continue;
            const Reading reading = convert(row, sample_bytes);
            if (!reading.unimpl) CHECK(probe_candidate_offered(row.conv, row.size));
        }
    }
    CHECK(probe_profile_exact(def::profiles, "generic") == &def::profiles[0]);
    CHECK(probe_profile_exact(def::profiles, "auto") == nullptr);
    CHECK(probe_profile_exact(def::profiles, "nonexistent") == nullptr);
    bool catalog_fallback = false;
    CHECK(probe_catalog_profile(def::profiles, "generic", catalog_fallback) == &def::profiles[0]);
    CHECK(!catalog_fallback);
    CHECK(probe_catalog_profile(def::profiles, "auto", catalog_fallback) == &def::profiles[0]);
    CHECK(catalog_fallback);
    CHECK(probe_catalog_profile(def::profiles, "nonexistent", catalog_fallback) ==
          &def::profiles[0]);
    CHECK(catalog_fallback);

    // ── Refusals and bounds.
    CHECK(probe_sweep(two, 2, 1, 2, d, PROBE_MAX_DECODES) == 0); // slice past the payload
    CHECK(probe_sweep(nullptr, 2, 0, 2, d, PROBE_MAX_DECODES) == 0);
    CHECK(probe_sweep(two, 2, 0, 2, nullptr, PROBE_MAX_DECODES) == 0);
    CHECK(probe_sweep(two, 2, 0, 2, d, 0) == 0);
    CHECK(probe_sweep(two, 2, 0, 2, d, 1) == 1); // bounded output, not a crash

    // ── One named converter: the same row shape as a sweep, so the caller sees one schema.
    ProbeDecode single;
    bool        unimpl = false;
    CHECK(probe_decode_one(two, 2, 0, 2, 105, single, unimpl) && !unimpl);
    CHECK(single.conv == 105 && single.value == 26.6 && single.alias_count == 0);
    // An id the catalog documents but this firmware has not ported reports UNIMPLEMENTED — a real
    // answer for a contributor holding a converter id from the reference tables.
    CHECK(!probe_decode_one(two, 2, 0, 2, 462, single, unimpl) && unimpl);
    CHECK(!probe_decode_one(two, 2, 1, 2, 105, single, unimpl) && !unimpl);
    CHECK(!probe_decode_one(nullptr, 2, 0, 2, 105, single, unimpl));
    // A converter that runs and refuses is a successful decode with ok=false, not a failure.
    CHECK(probe_decode_one(zero, 2, 0, 2, 405, single, unimpl) && !single.ok && !unimpl);

    // The output bound is structural: no field width can offer more candidates than one answer
    // holds.
    CHECK(probe_candidate_count_for(1) <= PROBE_MAX_DECODES);
    CHECK(probe_candidate_count_for(2) <= PROBE_MAX_DECODES);
    CHECK(probe_candidate_count_for(4) == 0);
    CHECK(probe_catalog_row({0x00, 12, 105, 1, -1, "O/U capacity (kW)"}));
    CHECK(!probe_catalog_row({0x00, 0, 802, 0, -1, "Refrigerant type"}));
    CHECK(!probe_catalog_row({0x00, 0, 105, 1, -1, "", false}));
    CHECK(!probe_catalog_row({0x00, 0, 105, 1, -1, "detect", true}));
}

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
    // passes `out` straight into a diag_printf %s, so an untouched buffer would print stack
    // garbage.
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
    down.unreachable = 1;
    down.blind       = 5;
    CHECK(link_watch_step(down, false, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(down.unreachable == 0 && down.blind == 0);

    // Proven silence on a previously-verified gateway: act on the SECOND consecutive miss, not the
    // first, and not before.
    LinkWatch g;
    CHECK(link_watch_step(g, true, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(g.unreachable == 1);
    CHECK(link_watch_step(g, true, GwProbe::Unreachable, true) == WdAction::Reassociate);
    CHECK(g.unreachable == 0); // counter resets after acting — no repeat-fire on the next period

    // One reply clears the count: two misses either side of a success must not add up to a ghost.
    LinkWatch mix;
    CHECK(link_watch_step(mix, true, GwProbe::Unreachable, true) == WdAction::None);
    CHECK(link_watch_step(mix, true, GwProbe::Reachable, true) == WdAction::None);
    CHECK(mix.unreachable == 0);
    CHECK(link_watch_step(mix, true, GwProbe::Unreachable, true) == WdAction::None);

    // A gateway that never answered ICMP may simply firewall it — never re-associate on its
    // silence, however long, or a healthy link churns every ~60 s forever.
    LinkWatch fw;
    for (int i = 0; i < 10; i++)
        CHECK(link_watch_step(fw, true, GwProbe::Unreachable, false) == WdAction::None);

    // THE fix. Unmeasurable is not a failure: it never trips the fast (2-period) path...
    LinkWatch b;
    for (int i = 0; i < WD_BLIND_TO_REASSOC - 1; i++)
        CHECK(link_watch_step(b, true, GwProbe::Unmeasurable, true) == WdAction::None);
    CHECK(b.unreachable == 0); // blindness never counts as proven silence
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
    CHECK(l.unreachable == 1); // still standing
    CHECK(link_watch_step(l, true, GwProbe::Unreachable, true) == WdAction::Reassociate);
}

// ── WiFi credential-rollback policy (logic/wifi_rollback.hpp) ────────────────────────────────
static void test_wifi_rollback() {
    // The whole point of the classifier: an AP that REFUSED us is evidence about the credentials;
    // an AP that was never on the air is evidence about the ROUTER and says nothing about
    // credentials.
    CHECK(disco_class(202) == DiscoClass::Auth); // AUTH_FAIL
    CHECK(disco_class(15) == DiscoClass::Auth);  // 4WAY_HANDSHAKE_TIMEOUT — PSK did not verify
    CHECK(disco_class(204) == DiscoClass::Auth); // HANDSHAKE_TIMEOUT
    CHECK(disco_class(211) == DiscoClass::Auth); // NO_AP_FOUND_IN_AUTHMODE — security mismatch
    CHECK(disco_class(210) == DiscoClass::Auth); // NO_AP_FOUND_W_COMPATIBLE_SECURITY
    CHECK(disco_class(201) == DiscoClass::ApAbsent); // NO_AP_FOUND — the SSID was not there
    CHECK(disco_class(212) == DiscoClass::ApAbsent); // NO_AP_FOUND_IN_RSSI_THRESHOLD — out of range
    CHECK(disco_class(0) == DiscoClass::None);       // nothing observed yet
    CHECK(disco_class(200) == DiscoClass::Other);    // BEACON_TIMEOUT — a link fault, not creds
    CHECK(disco_class(8) == DiscoClass::Other);      // ASSOC_LEAVE (deauth)

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
    // be the last thing logged when we looked — but two roll back, still within issue #47's "~1
    // boot cycle".
    {
        RollbackWatch w;
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S) == RollbackAction::Wait);
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S * 2) ==
              RollbackAction::RollBack);
        CHECK(WIFI_BOOT_WINDOW_S * WIFI_AUTH_TO_ROLLBACK <= 60);
    }

    // A refusal that does NOT persist must not spend the credentials: wifi.cpp clears the reason
    // slot on STA_CONNECTED, so an association mid-window reports None and breaks the streak. This
    // is the transient-SAE-then-slow-DHCP boot — the AP took us, we are just waiting on a lease.
    {
        RollbackWatch w;
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S) == RollbackAction::Wait);
        CHECK(rollback_step(w, DiscoClass::None, WIFI_BOOT_WINDOW_S * 2) == RollbackAction::Wait);
        CHECK(w.auth == 0); // the streak is broken, not merely paused
        CHECK(rollback_step(w, DiscoClass::Auth, WIFI_BOOT_WINDOW_S * 3) == RollbackAction::Wait);
    }

    // THE fix. A router that is still rebooting shows up as an absent SSID, which the blind
    // deadline read as "wrong credentials" and answered by destroying the correct new ones. Absence
    // of evidence now buys the full grace window instead — and no amount of it ever takes the fast
    // path.
    {
        RollbackWatch w;
        for (int t = WIFI_BOOT_WINDOW_S; t < WIFI_ROLLBACK_GRACE_S; t += WIFI_BOOT_WINDOW_S)
            CHECK(rollback_step(w, DiscoClass::ApAbsent, t) == RollbackAction::Wait);
        // Bounded, though: an SSID that never appears at all (a typo'd name) must still fall back
        // to the network we know works, rather than leaving the device off the LAN forever.
        CHECK(rollback_step(w, DiscoClass::ApAbsent, WIFI_ROLLBACK_GRACE_S) ==
              RollbackAction::RollBack);
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
    // 302 that its captive-portal agent recognises, NOT the 200 + gzipped setup page that used to
    // be served here and left the portal silently un-popped.
    CHECK(captive_reply_for("/hotspot-detect.html", true) == CaptiveReply::Redirect); // iOS/macOS
    CHECK(captive_reply_for("/generate_204", true) == CaptiveReply::Redirect);        // Android
    CHECK(captive_reply_for("/connecttest.txt", true) == CaptiveReply::Redirect);     // Windows
    CHECK(captive_reply_for("/ncsi.txt", true) == CaptiveReply::Redirect);    // Windows (legacy)
    CHECK(captive_reply_for("/success.txt", true) == CaptiveReply::Redirect); // Firefox
    CHECK(captive_reply_for("/favicon.ico", true) == CaptiveReply::Redirect);

    // ...but the portal root itself must SERVE the page, or following that redirect loops forever.
    CHECK(captive_reply_for("/", true) == CaptiveReply::Page);
    CHECK(captive_reply_for("/index.html", true) == CaptiveReply::Page);

    // STA MODE: this same catch-all is the dashboard's SPA shell. Redirecting here would break
    // every deep link — and unlike a portal that stops popping, nobody reports it as a
    // captive-portal bug.
    CHECK(captive_reply_for("/", false) == CaptiveReply::Page);
    CHECK(captive_reply_for("/index.html", false) == CaptiveReply::Page);
    CHECK(captive_reply_for("/hotspot-detect.html", false) == CaptiveReply::Page);
    CHECK(captive_reply_for("/anything/at/all", false) == CaptiveReply::Page);

    // The four advertisements of the portal address must agree, or the redirect points somewhere
    // the DNS never answers for and nothing on the device would notice. The octets feed the DNS
    // A-record RDATA and the SoftAP's own DHCP address; the string feeds the Location header and
    // the RFC 8910 option-114 payload.
    CHECK(std::string(CAPTIVE_PORTAL_URI) == "http://" + std::string(CAPTIVE_PORTAL_IP) + "/");
    CHECK(std::to_string(CAPTIVE_PORTAL_OCTETS[0]) + "." +
              std::to_string(CAPTIVE_PORTAL_OCTETS[1]) + "." +
              std::to_string(CAPTIVE_PORTAL_OCTETS[2]) + "." +
              std::to_string(CAPTIVE_PORTAL_OCTETS[3]) ==
          std::string(CAPTIVE_PORTAL_IP));
}

// ── request-body reassembly (logic/http_body.hpp) ────────────────────────────────────────────
static void test_http_body() {
    // The common case: the body arrives in one recv, is NUL-terminated, and reports its length.
    {
        const std::string body     = R"({"ssid":"home","pass":"secret12"})";
        char              buf[128] = {};
        size_t            sent     = 0;
        const int         r =
            http_body_read(buf, sizeof(buf), body.size(), [&](char* dst, size_t len) -> BodyChunk {
                std::memcpy(dst, body.data() + sent, len);
                sent += len;
                return {BodyRecv::Data, len};
            });
        CHECK(r == static_cast<int>(body.size()));
        CHECK(std::string(buf) == body);
    }

    // THE regression. httpd_req_recv hands over what has ARRIVED, not the whole body — its own docs
    // say a large body may take multiple calls. The old single-call read took the first segment for
    // the entire body, so a POST split across TCP segments was answered 400 "bad json" while being
    // perfectly valid. One byte per call is that failure at its most extreme.
    {
        const std::string body     = R"({"broker":"mqtts://nas.lan:8883","user":"ha"})";
        char              buf[128] = {};
        size_t            sent     = 0;
        int               calls    = 0;
        const int         r =
            http_body_read(buf, sizeof(buf), body.size(), [&](char* dst, size_t) -> BodyChunk {
                calls++;
                dst[0] = body[sent++];
                return {BodyRecv::Data, 1};
            });
        CHECK(r == static_cast<int>(body.size()));
        CHECK(std::string(buf) == body);
        CHECK(calls ==
              static_cast<int>(body.size())); // it really did reassemble, segment by segment
    }

    // A timeout is "nothing arrived yet", not "give up" — and progress clears the idle count, so a
    // body that keeps trickling in is never abandoned however long it takes overall.
    {
        const std::string body    = "0123456789";
        char              buf[32] = {};
        size_t            sent    = 0;
        int               n       = 0;
        const int         r =
            http_body_read(buf, sizeof(buf), body.size(), [&](char* dst, size_t) -> BodyChunk {
                if (n++ % 3 != 2) return {BodyRecv::Timeout, 0}; // 2 stalls, then a byte, forever
                dst[0] = body[sent++];
                return {BodyRecv::Data, 1};
            });
        CHECK(r == static_cast<int>(body.size()));
        CHECK(std::string(buf) == body);
    }

    // A peer that announces a body and then goes silent must lose, and must lose BOUNDED: retrying
    // forever would park the single httpd task on one client, taking the web UI — and the OTA route
    // that is the way out of a bad config — down with it.
    {
        char      buf[64] = {};
        int       calls   = 0;
        const int r       = http_body_read(buf, sizeof(buf), 10, [&](char*, size_t) -> BodyChunk {
            calls++;
            return {BodyRecv::Timeout, 0};
        });
        CHECK(r == -1);
        CHECK(calls == BODY_MAX_IDLE + 1); // it gave up, and did not spin
        // The bound is absolute, not merely relative to itself: each idle round is a full socket
        // timeout (CONFIG_HTTPD_REQ_RECV_TMO, 5 s), so it must stay small enough that one silent
        // client cannot hold the httpd task for minutes, yet leave room to ride out a slow segment.
        CHECK(BODY_MAX_IDLE >= 1 && BODY_MAX_IDLE <= 4);
    }

    // A peer that closes mid-body fails the read: half a JSON document must never reach a handler
    // as if it were whole.
    {
        char      buf[64] = {};
        size_t    sent    = 0;
        const int r = http_body_read(buf, sizeof(buf), 20, [&](char* dst, size_t) -> BodyChunk {
            if (sent >= 5) return {BodyRecv::Error, 0};
            dst[0] = 'x';
            sent++;
            return {BodyRecv::Data, 1};
        });
        CHECK(r == -1);
    }

    // The size cap is preserved, terminator included: a body of exactly `cap` has nowhere to put
    // the NUL, so it is refused rather than truncated.
    {
        char       buf[16] = {};
        const auto never   = [](char*, size_t) -> BodyChunk { return {BodyRecv::Error, 0}; };
        CHECK(http_body_read(buf, sizeof(buf), sizeof(buf), never) == -1);
        CHECK(http_body_read(buf, sizeof(buf), sizeof(buf) + 1, never) == -1);
        CHECK(http_body_read(buf, sizeof(buf), 0, never) == -1); // no body at all
        CHECK(http_body_read(nullptr, sizeof(buf), 4, never) == -1);
    }

    // `bytes` bounds a write into the caller's buffer, so a recv that reports more than it was
    // asked for is refused rather than trusted.
    {
        char      buf[16] = {};
        const int r       = http_body_read(
            buf, sizeof(buf), 4, [](char*, size_t) -> BodyChunk { return {BodyRecv::Data, 99}; });
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
        return uart_plan(runtime_inited, runtime_cur_rx, runtime_cur_tx, runtime_new_rx,
                         runtime_new_tx);
    };

    CHECK(plan(false, -1, -1, 44, 43) == UartAction::Install); // cold start
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
    CHECK(detect_backoff_interval_s(DETECT_BACKOFF_AFTER) == DETECT_MIN_INTERVAL_S); // still floor
    CHECK(detect_backoff_interval_s(DETECT_BACKOFF_AFTER + 1) >
          DETECT_MIN_INTERVAL_S);                                       // then it grows
    CHECK(detect_backoff_interval_s(1000000) == DETECT_MAX_INTERVAL_S); // shift guard: no UB
    int prev = 0;                                                       // monotonic, clamped
    for (int n = 0; n < 200; n++) {
        const int v = detect_backoff_interval_s(n);
        CHECK(v >= DETECT_MIN_INTERVAL_S && v <= DETECT_MAX_INTERVAL_S && v >= prev);
        prev = v;
    }
    CHECK(DETECT_MAX_INTERVAL_S > DETECT_MIN_INTERVAL_S * 4); // a material stretch, not a nudge
    // step(): full cadence through the grace window, then back off, and a fingerprint resets at
    // once.
    DetectBackoff s;
    for (int i = 0; i < DETECT_BACKOFF_AFTER; i++)
        CHECK(detect_backoff_step(s, false) == DETECT_MIN_INTERVAL_S);
    CHECK(s.silent == DETECT_BACKOFF_AFTER);
    CHECK(detect_backoff_step(s, false) > DETECT_MIN_INTERVAL_S); // silent past grace -> grows
    CHECK(detect_backoff_step(s, true) ==
          DETECT_MIN_INTERVAL_S); // a swapped-in unit is swept at once
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
    CHECK(version_compare("1.0", "1.0.0") == 0); // missing segments read as 0
    CHECK(version_compare("1.0.1", "1.0.0") > 0);

    // The gate itself: strictly newer only. Equal and older are refused — a signature proves a
    // build is authentic, not that it is newer, so an authentically-signed OLD image must not pass.
    CHECK(ota_is_upgrade("1.0.0", "1.0.1"));
    CHECK(ota_is_upgrade("1.9.0", "1.10.0"));
    CHECK(!ota_is_upgrade("1.0.0", "1.0.0")); // equal -> no update, no reboot loop
    CHECK(!ota_is_upgrade("1.0.1", "1.0.0")); // older -> the downgrade attack
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
    CHECK(!version_valid("1.2.3.4.5")); // comparer intentionally supports at most 4
    CHECK(!version_valid("1.0.0-") && !version_valid("1.0.0-dev."));
    CHECK(!version_valid("1.0.0+") && !version_valid("1.0.0+build+again"));
    CHECK(!version_valid(static_cast<const char*>(nullptr)));
    CHECK(version_compare(static_cast<const char*>("1.0.3-dev.20"),
                          static_cast<const char*>("1.0.3-dev.19")) > 0);

    // A git tag pasted into the manifest ("v1.0.1"). Without the 'v' skip its core parses as 0 and
    // it compares BELOW every real version — a silent, permanent refusal to ever update.
    CHECK(ota_is_upgrade("1.0.0", "v1.0.1"));
    CHECK(!ota_is_upgrade("1.0.1", "v1.0.0"));
    CHECK(version_compare("v1.0.0", "1.0.0") == 0);

    // Semver pre-release ordering, and the case that matters: a pre-release of the version we
    // already run is NOT an upgrade.
    CHECK(version_compare("1.0.0-rc1", "1.0.0") < 0);
    CHECK(!ota_is_upgrade("1.0.0", "1.0.0-rc1"));
    CHECK(ota_is_upgrade("1.0.0", "1.0.1-rc1")); // pre-release of a NEWER version still is
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
    CHECK(ota_is_upgrade("1.0.0", huge));  // orders above a real version, no UB
    CHECK(!ota_is_upgrade(huge, "1.0.0")); // and a real version is not "newer" than it
    CHECK(!ota_is_upgrade(huge, huge));    // saturated-equal -> refused, not "newer"

    // ── The dev channel's versions (CI stamps "<next release>-dev.<n>", scripts/next-version.sh)
    // ── A device on the dev feed compares one dev build against the next, so the pre-release
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
    // permission must come from the request (POST /ota/update?downgrade=1), never from the
    // manifest.
    CHECK(!ota_is_upgrade("1.0.8-dev.4", "1.0.7")); // the automatic gate refuses
    CHECK(ota_install_allowed("1.0.8-dev.4", "1.0.7", /*allow_downgrade=*/true));
    CHECK(!ota_install_allowed("1.0.8-dev.4", "1.0.7", /*allow_downgrade=*/false));
    // EQUAL is refused in BOTH modes: re-installing what is already running is not a channel
    // switch.
    CHECK(!ota_install_allowed("1.0.7", "1.0.7", true));
    CHECK(!ota_install_allowed("1.0.7", "v1.0.7", true));
    // And it still fails closed on an unparseable version — the flag opens the ORDER, not the
    // parse.
    CHECK(!ota_install_allowed("1.0.7", "", true));
    CHECK(!ota_install_allowed("", "1.0.7", true));
    CHECK(!ota_install_allowed("1.0.7", "<!DOCTYPE html>", true));
    // Newer still installs with the flag set (a channel switch that happens to be an upgrade).
    CHECK(ota_install_allowed("1.0.7", "1.0.8", true));

    // The manifest and the image must describe the SAME artifact, not merely two artifacts that
    // each happen to pass the ordering gate. This is the lying-host case the second OTA check
    // exists to catch: both 9.9.9 and 1.0.1 are newer than 1.0.0, but they are not the same update.
    CHECK(ota_artifact_versions_match("1.0.1", "1.0.1"));
    CHECK(ota_artifact_versions_match("1.0.8-dev.12", "1.0.8-dev.12"));
    CHECK(!ota_artifact_versions_match("9.9.9", "1.0.1"));
    CHECK(!ota_artifact_versions_match("v1.0.1", "1.0.1")); // exact published identity
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
    CHECK(ota_channel_parse("nonsense") == OtaChannel::Release); // load-path fallback
    CHECK(ota_channel_parse("nonsense", OtaChannel::Dev) == OtaChannel::Dev);
    // The on-flash byte. An unknown value decodes to Release — a garbled NVS byte must not move a
    // board onto the fast feed, and "release" is the state every pre-v3 device is already in.
    CHECK(ota_channel_to_int(OtaChannel::Release) == 0 && ota_channel_to_int(OtaChannel::Dev) == 1);
    CHECK(ota_channel_from_int(0) == OtaChannel::Release &&
          ota_channel_from_int(1) == OtaChannel::Dev);
    CHECK(ota_channel_from_int(2) == OtaChannel::Release &&
          ota_channel_from_int(-1) == OtaChannel::Release);

    // The URL joins. The release feed is the configured manifest URL verbatim; the dev feed is
    // always <firmware base>/dev/manifest.json, so the two cannot be pointed at different sites.
    const std::string mf   = "https://x.github.io/p/manifest.json";
    const std::string base = "https://x.github.io/p/";
    CHECK(ota_channel_manifest_url(mf, base, OtaChannel::Release) == mf);
    CHECK(ota_channel_manifest_url(mf, base, OtaChannel::Dev) ==
          "https://x.github.io/p/dev/manifest.json");
    // A base without its trailing slash must produce the SAME URL — Kconfig documents the slash but
    // does not enforce it, and "…/pdev/manifest.json" would be a 404 nobody could explain.
    CHECK(ota_channel_manifest_url(mf, "https://x.github.io/p", OtaChannel::Dev) ==
          "https://x.github.io/p/dev/manifest.json");
    char sibling_url[128] = {};
    CHECK(ota_manifest_sibling_url(mf, "changelog.json", sibling_url, sizeof(sibling_url)));
    CHECK(std::string(sibling_url) == "https://x.github.io/p/changelog.json");
    CHECK(ota_manifest_sibling_url("https://x.github.io/p/dev/manifest.json", "changelog.json",
                                   sibling_url, sizeof(sibling_url)));
    CHECK(std::string(sibling_url) == "https://x.github.io/p/dev/changelog.json");
    CHECK(!ota_manifest_sibling_url("manifest.json", "changelog.json", sibling_url,
                                    sizeof(sibling_url)) &&
          sibling_url[0] == 0);
    CHECK(!ota_manifest_sibling_url(mf, "", sibling_url, sizeof(sibling_url)) &&
          sibling_url[0] == 0);
    char tiny_sibling_url[8] = {};
    CHECK(!ota_manifest_sibling_url(mf, "changelog.json", tiny_sibling_url,
                                    sizeof(tiny_sibling_url)) &&
          tiny_sibling_url[0] == 0);
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
    CHECK(!ota_version_is_dev("1.0.8") && !ota_version_is_dev("1.0.8-rcdev") &&
          !ota_version_is_dev(""));
    CHECK(!ota_version_is_dev("1.0.8-PR-42")); // a PR preview build is its own thing
}

// ── Ephemeral release-HIL OTA feed lease (logic/ota_hil_feed.hpp) ─────────────────────────────
static void test_ota_hil_feed() {
    std::array<char, 4> fixed_text{};
    size_t              fixed_length = 0;
    CHECK(ota_fixed_text_append(fixed_text, fixed_length, "abc"));
    CHECK(std::string(fixed_text.data()) == "abc");
    CHECK(!ota_fixed_text_append(fixed_text, fixed_length, "x"));
    fixed_length = fixed_text.size();
    CHECK(!ota_fixed_text_append(fixed_text, fixed_length, {}));

    OtaFeedUrls defaults{};
    CHECK(ota_default_feed_urls(OtaChannel::Release, "https://updates.invalid/custom-manifest.json",
                                "https://updates.invalid/firmware", defaults));
    CHECK(std::string(defaults.manifest.data()) == "https://updates.invalid/custom-manifest.json");
    CHECK(std::string(defaults.firmware_base.data()) == "https://updates.invalid/firmware/");
    CHECK(ota_default_feed_urls(OtaChannel::Release, "https://updates.invalid/custom-manifest.json",
                                "https://updates.invalid/firmware/", defaults));
    CHECK(std::string(defaults.firmware_base.data()) == "https://updates.invalid/firmware/");
    CHECK(ota_default_feed_urls(OtaChannel::Dev, "https://unused.invalid/manifest.json",
                                "https://updates.invalid/firmware", defaults));
    CHECK(std::string(defaults.manifest.data()) ==
          "https://updates.invalid/firmware/dev/manifest.json");
    CHECK(std::string(defaults.firmware_base.data()) == "https://updates.invalid/firmware/dev/");
    CHECK(ota_default_feed_urls(OtaChannel::Dev, "ignored", "", defaults));
    CHECK(defaults.manifest[0] == '\0' && defaults.firmware_base[0] == '\0');

    const std::string oversized_url(OTA_FEED_URL_MAX + 1, 'x');
    CHECK(!ota_default_feed_urls(OtaChannel::Release, oversized_url,
                                 "https://updates.invalid/firmware/", defaults));
    CHECK(!ota_default_feed_urls(OtaChannel::Release, "https://updates.invalid/manifest.json",
                                 oversized_url, defaults));
    std::string full_release_root(OTA_FEED_URL_MAX, 'r');
    CHECK(!ota_default_feed_urls(OtaChannel::Release, "https://updates.invalid/manifest.json",
                                 full_release_root, defaults));

    std::string oversized_root(OTA_FEED_URL_MAX, 'x');
    CHECK(!ota_default_feed_urls(OtaChannel::Dev, "ignored", oversized_root, defaults));
    CHECK(defaults.manifest[0] == '\0' && defaults.firmware_base[0] == '\0');
    std::string near_full_root(250, 'd');
    near_full_root.back() = '/';
    CHECK(!ota_default_feed_urls(OtaChannel::Dev, "ignored", near_full_root, defaults));
    std::string manifest_overflow_root(240, 'm');
    manifest_overflow_root.back() = '/';
    CHECK(!ota_default_feed_urls(OtaChannel::Dev, "ignored", manifest_overflow_root, defaults));

    OtaFeedUrls feed{};
    CHECK(!ota_feed_urls_copy(feed, oversized_url, "https://stale.invalid/"));
    CHECK(!ota_feed_urls_copy(feed, "https://stale.invalid/manifest.json", oversized_url));
    CHECK(
        ota_feed_urls_copy(feed, "https://stale.invalid/manifest.json", "https://stale.invalid/"));
    CHECK(ota_hil_feed_headers(false, {}, false, {}, feed) == OtaHilFeedHeaderResult::DefaultFeed);
    CHECK(feed.manifest[0] == '\0' && feed.firmware_base[0] == '\0');

    CHECK(ota_hil_feed_headers(true, "https://hil.invalid/manifest.json", false, {}, feed) ==
          OtaHilFeedHeaderResult::PartialPair);
    CHECK(ota_hil_feed_headers(false, {}, true, "https://hil.invalid/", feed) ==
          OtaHilFeedHeaderResult::PartialPair);
    CHECK(ota_hil_feed_headers(true, {}, true, "https://hil.invalid/", feed) ==
          OtaHilFeedHeaderResult::InvalidUrl);
    CHECK(ota_hil_feed_headers(true, "https://hil.invalid/manifest.json", true, {}, feed) ==
          OtaHilFeedHeaderResult::InvalidUrl);

    const std::string manifest      = "https://hil.invalid/lease/manifest.json";
    const std::string firmware_base = "https://hil.invalid/lease/";
    CHECK(ota_hil_feed_headers(true, manifest, true, firmware_base, feed) ==
          OtaHilFeedHeaderResult::OverrideFeed);
    CHECK(std::string(feed.manifest.data()) == manifest);
    CHECK(std::string(feed.firmware_base.data()) == firmware_base);
    CHECK(ota_feed_urls_valid(feed));

    // The HTTP handler reads directly into the output struct.  Parsing must therefore remain safe
    // when both string_views alias `out`; clearing it before the bounded copy would erase the
    // input.
    OtaFeedUrls aliased{};
    CHECK(ota_feed_urls_copy(aliased, manifest, firmware_base));
    CHECK(ota_hil_feed_headers(true, std::string_view(aliased.manifest.data()), true,
                               std::string_view(aliased.firmware_base.data()),
                               aliased) == OtaHilFeedHeaderResult::OverrideFeed);
    CHECK(std::string(aliased.manifest.data()) == manifest);
    CHECK(std::string(aliased.firmware_base.data()) == firmware_base);

    std::string max_manifest = "https://h/";
    max_manifest.append(OTA_FEED_URL_MAX - max_manifest.size(), 'm');
    std::string max_base = "https://h/";
    max_base.append(OTA_FEED_URL_MAX - max_base.size() - 1, 'b');
    max_base.push_back('/');
    CHECK(max_manifest.size() == OTA_FEED_URL_MAX && max_base.size() == OTA_FEED_URL_MAX);
    CHECK(ota_hil_feed_headers(true, max_manifest, true, max_base, feed) ==
          OtaHilFeedHeaderResult::OverrideFeed);
    CHECK(std::strlen(feed.manifest.data()) == OTA_FEED_URL_MAX);
    CHECK(std::strlen(feed.firmware_base.data()) == OTA_FEED_URL_MAX);
    OtaFeedUrls unterminated = feed;
    unterminated.manifest.fill('x');
    CHECK(!ota_feed_urls_valid(unterminated));
    unterminated = feed;
    unterminated.firmware_base.fill('x');
    CHECK(!ota_feed_urls_valid(unterminated));
    max_manifest.push_back('x');
    CHECK(ota_hil_feed_headers(true, max_manifest, true, max_base, feed) ==
          OtaHilFeedHeaderResult::InvalidUrl);
    max_base.push_back('x');
    CHECK(ota_hil_feed_headers(true, manifest, true, max_base, feed) ==
          OtaHilFeedHeaderResult::InvalidUrl);

    CHECK(ota_hil_feed_headers(true, "http://hil.invalid/manifest.json", true, firmware_base,
                               feed) == OtaHilFeedHeaderResult::InvalidUrl);
    CHECK(ota_hil_feed_headers(true, manifest, true, "https://hil.invalid/lease", feed) ==
          OtaHilFeedHeaderResult::InvalidUrl);
    CHECK(ota_hil_feed_headers(true, "https://hil.invalid/manifest\\name", true, firmware_base,
                               feed) == OtaHilFeedHeaderResult::InvalidUrl);
    const std::string controlled = std::string("https://hil.invalid/") + '\n' + "manifest.json";
    CHECK(ota_hil_feed_headers(true, controlled, true, firmware_base, feed) ==
          OtaHilFeedHeaderResult::InvalidUrl);

    CHECK(ota_hil_feed_headers(true, manifest, true, firmware_base, feed) ==
          OtaHilFeedHeaderResult::OverrideFeed);
    const std::string sha(64, 'a');
    OtaOfferBinding   binding{};
    CHECK(!ota_offer_binding_set(binding, 0, "release", "1.2.3", sha.c_str(), feed));
    CHECK(!ota_offer_binding_set(binding, 17, "preview", "1.2.3", sha.c_str(), feed));
    CHECK(!ota_offer_binding_set(binding, 17, "release", "", sha.c_str(), feed));
    CHECK(!ota_offer_binding_set(binding, 17, "release", std::string(32, 'v'), sha.c_str(), feed));
    CHECK(!ota_offer_binding_set(binding, 17, "release", "1.2.3", "invalid", feed));
    OtaFeedUrls invalid_feed{};
    CHECK(ota_feed_urls_copy(invalid_feed, manifest, "https://hil.invalid/lease"));
    CHECK(!ota_offer_binding_set(binding, 17, "release", "1.2.3", sha.c_str(), invalid_feed));
    CHECK(ota_offer_binding_set(binding, 17, "release", "1.2.3", sha.c_str(), feed));
    OtaFeedUrls update_feed{};
    CHECK(ota_offer_binding_copy_feed(binding, 17, "release", "1.2.3", sha.c_str(), update_feed));
    CHECK(std::string(update_feed.manifest.data()) == manifest);
    CHECK(std::string(update_feed.firmware_base.data()) == firmware_base);

    CHECK(!ota_offer_binding_copy_feed(binding, 0, "release", "1.2.3", sha.c_str(), update_feed));
    CHECK(!ota_offer_binding_copy_feed(binding, 18, "release", "1.2.3", sha.c_str(), update_feed));
    CHECK(update_feed.manifest[0] == '\0' && update_feed.firmware_base[0] == '\0');
    CHECK(!ota_offer_binding_copy_feed(binding, 17, "dev", "1.2.3", sha.c_str(), update_feed));
    CHECK(!ota_offer_binding_copy_feed(binding, 17, "release", "1.2.4", sha.c_str(), update_feed));
    std::string other_sha(64, 'b');
    CHECK(!ota_offer_binding_copy_feed(binding, 17, "release", "1.2.3", "invalid", update_feed));
    CHECK(!ota_offer_binding_copy_feed(binding, 17, "release", "1.2.3", other_sha.c_str(),
                                       update_feed));

    OtaOfferBinding malformed_binding = binding;
    malformed_binding.channel.fill('x');
    CHECK(!ota_offer_binding_copy_feed(malformed_binding, 17, "release", "1.2.3", sha.c_str(),
                                       update_feed));
    malformed_binding = binding;
    malformed_binding.version.fill('x');
    CHECK(!ota_offer_binding_copy_feed(malformed_binding, 17, "release", "1.2.3", sha.c_str(),
                                       update_feed));

    OtaFeedUrls next_feed{};
    CHECK(ota_feed_urls_copy(next_feed, "https://next.invalid/manifest.json",
                             "https://next.invalid/"));
    CHECK(ota_offer_binding_set(binding, 18, "release", "1.2.4", other_sha.c_str(), next_feed));
    CHECK(!ota_offer_binding_copy_feed(binding, 17, "release", "1.2.3", sha.c_str(), update_feed));
    CHECK(ota_offer_binding_copy_feed(binding, 18, "release", "1.2.4", other_sha.c_str(),
                                      update_feed));
    CHECK(std::string(update_feed.manifest.data()) == "https://next.invalid/manifest.json");
}

// ── UI language override (logic/ui_lang.hpp) ─────────────────────────────────────────────────
static void test_ui_lang() {
    CHECK(std::string(ui_lang_name(UiLang::Auto)) == "auto");
    CHECK(std::string(ui_lang_name(UiLang::De)) == "de");
    CHECK(std::string(ui_lang_name(UiLang::En)) == "en");
    CHECK(std::string(ui_lang_name(UiLang::Es)) == "es");
    CHECK(std::string(ui_lang_name(UiLang::Fr)) == "fr");
    CHECK(std::string(ui_lang_name(UiLang::It)) == "it");
    CHECK(std::string(ui_lang_name(UiLang::Pl)) == "pl");
    CHECK(std::string(ui_lang_name(UiLang::Cs)) == "cs");
    CHECK(std::string(ui_lang_name(UiLang::Uk)) == "uk");
    CHECK(std::string(ui_lang_name(UiLang::Zh)) == "zh");
    CHECK(std::string(ui_lang_name(UiLang::Ja)) == "ja");
    CHECK(std::string(ui_lang_name(UiLang::Nb)) == "nb");
    CHECK(std::string(ui_lang_name(UiLang::Sv)) == "sv");
    CHECK(std::string(ui_lang_name(UiLang::Fi)) == "fi");
    for (const char* lang :
         {"auto", "de", "en", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"}) {
        CHECK(ui_lang_valid(lang));
    }
    // A typo is REFUSED, not defaulted: /set_lang answering ok to "german" would look like a save.
    CHECK(!ui_lang_valid("") && !ui_lang_valid("De") && !ui_lang_valid("german") &&
          !ui_lang_valid("EN"));
    CHECK(ui_lang_parse("auto") == UiLang::Auto);
    CHECK(ui_lang_parse("de") == UiLang::De);
    CHECK(ui_lang_parse("en") == UiLang::En);
    CHECK(ui_lang_parse("es") == UiLang::Es);
    CHECK(ui_lang_parse("fr") == UiLang::Fr);
    CHECK(ui_lang_parse("it") == UiLang::It);
    CHECK(ui_lang_parse("pl") == UiLang::Pl);
    CHECK(ui_lang_parse("cs") == UiLang::Cs);
    CHECK(ui_lang_parse("uk") == UiLang::Uk);
    CHECK(ui_lang_parse("zh") == UiLang::Zh);
    CHECK(ui_lang_parse("ja") == UiLang::Ja);
    CHECK(ui_lang_parse("nb") == UiLang::Nb);
    CHECK(ui_lang_parse("sv") == UiLang::Sv);
    CHECK(ui_lang_parse("fi") == UiLang::Fi);
    CHECK(ui_lang_parse("nonsense") == UiLang::Auto); // load-path fallback
    CHECK(ui_lang_parse("nonsense", UiLang::En) == UiLang::En);
    // The on-flash byte. An unknown value decodes to Auto — a garbled NVS byte must fall back to
    // the browser default, never force a language the user never chose. Auto is what every pre-v4
    // device is already in.
    CHECK(ui_lang_to_int(UiLang::Auto) == 0 && ui_lang_to_int(UiLang::De) == 1 &&
          ui_lang_to_int(UiLang::En) == 2 && ui_lang_to_int(UiLang::Es) == 3 &&
          ui_lang_to_int(UiLang::Fr) == 4 && ui_lang_to_int(UiLang::It) == 5 &&
          ui_lang_to_int(UiLang::Pl) == 6 && ui_lang_to_int(UiLang::Cs) == 7 &&
          ui_lang_to_int(UiLang::Uk) == 8 && ui_lang_to_int(UiLang::Zh) == 9 &&
          ui_lang_to_int(UiLang::Ja) == 10 && ui_lang_to_int(UiLang::Nb) == 11 &&
          ui_lang_to_int(UiLang::Sv) == 12 && ui_lang_to_int(UiLang::Fi) == 13);
    CHECK(ui_lang_from_int(0) == UiLang::Auto && ui_lang_from_int(1) == UiLang::De &&
          ui_lang_from_int(2) == UiLang::En && ui_lang_from_int(3) == UiLang::Es &&
          ui_lang_from_int(4) == UiLang::Fr && ui_lang_from_int(5) == UiLang::It &&
          ui_lang_from_int(6) == UiLang::Pl && ui_lang_from_int(7) == UiLang::Cs &&
          ui_lang_from_int(8) == UiLang::Uk && ui_lang_from_int(9) == UiLang::Zh &&
          ui_lang_from_int(10) == UiLang::Ja && ui_lang_from_int(11) == UiLang::Nb &&
          ui_lang_from_int(12) == UiLang::Sv && ui_lang_from_int(13) == UiLang::Fi);
    CHECK(ui_lang_from_int(14) == UiLang::Auto && ui_lang_from_int(-1) == UiLang::Auto);
}

// ── OTA manifest parsing (logic/ota_manifest.hpp) ────────────────────────────────────────────
static void test_ota_manifest() {
    char v[32];
    // The real manifest, exactly as scripts/ci-build-all.sh writes it.
    const char* real = "{\n  \"name\": \"daikin-altherma-esp32\",\n  \"version\": \"1.0.0\",\n"
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
    CHECK(manifest_version(as_value, std::strlen(as_value), v, sizeof(v)) &&
          std::string(v) == "1.2.3");

    // Escape handling: a crafted value must not be able to close its own string early and inject a
    // second, higher "version" key.
    const char* inject =
        "{\"name\":\"\\\" , \\\"version\\\": \\\"9.9.9\\\"\",\"version\":\"1.0.0\"}";
    CHECK(manifest_version(inject, std::strlen(inject), v, sizeof(v)) && std::string(v) == "1.0.0");

    // Never TRUNCATE: "1.10.0" cut to "1.1" is a well-formed version that is ordered WRONG — the
    // exact failure the downgrade gate exists to prevent. Too long => no answer at all.
    char tiny[4];
    CHECK(!manifest_version(tight, std::strlen(tight), tiny, sizeof(tiny)) && tiny[0] == 0);

    // Malformed / missing / hostile inputs -> false, never a partial answer.
    CHECK(!manifest_version("", 0, v, sizeof(v)));
    CHECK(!manifest_version("not json at all", 15, v, sizeof(v)));
    CHECK(!manifest_version("{\"name\":\"x\"}", 12, v, sizeof(v))); // no version key
    const char* unterminated = "{\"version\":\"1.0.0";
    CHECK(!manifest_version(unterminated, std::strlen(unterminated), v, sizeof(v)));
    const char* nonstring = "{\"version\":123}";
    CHECK(!manifest_version(nonstring, std::strlen(nonstring), v, sizeof(v)));
    const char* empty_val = "{\"version\":\"\"}";
    CHECK(!manifest_version(empty_val, std::strlen(empty_val), v, sizeof(v)));
    const char* escaped_val = "{\"version\":\"1.0\\u0030\"}";
    CHECK(!manifest_version(escaped_val, std::strlen(escaped_val), v, sizeof(v)));
    const char embedded_nul[] = "{\"version\":\"1.2\0.3\"}";
    CHECK(!manifest_version(embedded_nul, sizeof(embedded_nul) - 1, v, sizeof(v)) && v[0] == 0);

    // It must respect `len` and never read past it — the device hands it a fixed buffer that is NOT
    // NUL-terminated at the point the version would appear if the response was cut short.
    const char* cut = "{\"version\":\"1.0.0\"}";
    CHECK(!manifest_version(cut, 12, v, sizeof(v))); // len stops mid-value

    // End to end: what the parser yields feeds the gate.
    CHECK(manifest_version(real, std::strlen(real), v, sizeof(v)));
    CHECK(ota_is_upgrade("0.9.0", v) && !ota_is_upgrade("1.0.0", v));

    // Production promotion binds the checked version AND the exact signed application bytes.  The
    // SHA is accepted only from the top-level provenance object and only in canonical lowercase
    // form, so a builds[] field or a visually-equivalent alternate spelling cannot replace it.
    constexpr const char* sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const std::string     identity_json =
        std::string("{\"builds\":[{\"app_sha256\":\"") + std::string(64, 'f') +
        "\"}],\"provenance\":{\"source_sha\":\"abc\",\"app_sha256\":\"" + sha +
        "\"},\"version\":\"1.2.3-dev.4\"}";
    OtaManifestIdentity identity;
    CHECK(manifest_identity(identity_json.data(), identity_json.size(), identity));
    CHECK(std::string(identity.version) == "1.2.3-dev.4");
    CHECK(std::string(identity.app_sha256) == sha);
    const std::string identity_with_ws = identity_json + " \r\n\t";
    CHECK(manifest_identity(identity_with_ws.data(), identity_with_ws.size(), identity));
    const std::string missing_root_comma =
        std::string("{\"version\":\"1.2.3\" \"provenance\":{\"app_sha256\":\"") + sha + "\"}}";
    CHECK(!manifest_identity(missing_root_comma.data(), missing_root_comma.size(), identity));
    const std::string missing_provenance_comma =
        std::string("{\"version\":\"1.2.3\",\"provenance\":{\"source_sha\":\"abc\" ") +
        "\"app_sha256\":\"" + sha + "\"}}";
    CHECK(!manifest_identity(missing_provenance_comma.data(), missing_provenance_comma.size(),
                             identity));
    const std::string mismatched_provenance =
        std::string("{\"version\":\"1.2.3\",\"provenance\":{\"app_sha256\":\"") + sha + "\"]}";
    CHECK(!manifest_identity(mismatched_provenance.data(), mismatched_provenance.size(), identity));
    const std::string trailing_identity = identity_json + "{}";
    CHECK(!manifest_identity(trailing_identity.data(), trailing_identity.size(), identity));
    std::string  control_identity = identity_json;
    const size_t version_byte     = control_identity.find("1.2.3-dev.4");
    CHECK(version_byte != std::string::npos);
    control_identity[version_byte + 3] = '\0';
    CHECK(!manifest_identity(control_identity.data(), control_identity.size(), identity));

    uint8_t digest[32];
    for (size_t i = 0; i < sizeof(digest); ++i)
        digest[i] = static_cast<uint8_t>((((i * 2) % 16) << 4) | ((i * 2 + 1) % 16));
    CHECK(ota_sha256_matches(digest, sha));
    digest[31] ^= 1;
    CHECK(!ota_sha256_matches(digest, sha));
    CHECK(
        !ota_sha256_hex_valid("0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"));

    const std::string nested_sha = std::string("{\"provenance\":{\"nested\":{\"app_sha256\":\"") +
                                   sha + "\"}},\"version\":\"1.2.3\"}";
    CHECK(!manifest_identity(nested_sha.data(), nested_sha.size(), identity));
    const std::string duplicate_sha =
        std::string("{\"version\":\"1.2.3\",\"provenance\":{\"app_sha256\":\"") + sha +
        "\",\"app_sha256\":\"" + sha + "\"}}";
    CHECK(!manifest_identity(duplicate_sha.data(), duplicate_sha.size(), identity));
    const std::string upper_sha =
        "{\"version\":\"1.2.3\",\"provenance\":{\"app_sha256\":\"" + std::string(64, 'A') + "\"}}";
    CHECK(!manifest_identity(upper_sha.data(), upper_sha.size(), identity));

    // The human-readable notes live in a separate, version-bound document so the security-critical
    // installer manifest stays under its fixed 2 KiB stack cap.  The parser allocates nothing,
    // decodes only the publisher's explicit UTF-8 JSON subset and never returns partial prose.
    char        changelog[OTA_CHANGELOG_TEXT_MAX + 1];
    const char* notes_json = "{\"version\":\"1.2.3-dev.4\",\"changelog\":\"Add German UI\\nFix "
                             "\\\"OTA\\\" path \\\\ status\\tready\"}";
    CHECK(manifest_changelog(notes_json, std::strlen(notes_json), "1.2.3-dev.4", changelog,
                             sizeof(changelog)));
    CHECK(std::string(changelog) == "Add German UI\nFix \"OTA\" path \\ status\tready");
    char in_place_notes[256] =
        "{\"version\":\"1.2.3-dev.4\",\"changelog\":\"In-place line 1\\nIn-place line 2\"}";
    CHECK(manifest_changelog(in_place_notes, std::strlen(in_place_notes), "1.2.3-dev.4",
                             in_place_notes, sizeof(in_place_notes)));
    CHECK(std::string(in_place_notes) == "In-place line 1\nIn-place line 2");

    // Production reuses its one bounded transient body slot. Decoding into the exact same
    // allocation is safe and must produce the same bounded text without preserving a second
    // candidate.
    char in_place[] =
        "{\"version\":\"1.2.3-dev.4\",\"changelog\":\"Add German UI\\nFix \\\"OTA\\\" path\"}";
    CHECK(manifest_changelog(in_place, std::strlen(in_place), "1.2.3-dev.4", in_place,
                             sizeof(in_place)));
    CHECK(std::string(in_place) == "Add German UI\nFix \"OTA\" path");

    const char* slash_json =
        "{\"changelog\":\"See https:\\/\\/example.test\",\"version\":\"1.2.3\"}";
    CHECK(manifest_changelog(slash_json, std::strlen(slash_json), "1.2.3", changelog,
                             sizeof(changelog)));
    CHECK(std::string(changelog) == "See https://example.test");

    CHECK(!manifest_changelog(notes_json, std::strlen(notes_json), "1.2.3-dev.5", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* no_notes = "{\"version\":\"1.2.3\"}";
    CHECK(!manifest_changelog(no_notes, std::strlen(no_notes), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* nested_notes = "{\"version\":\"1.2.3\",\"nested\":{\"changelog\":\"Wrong depth\"}}";
    CHECK(!manifest_changelog(nested_notes, std::strlen(nested_notes), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* duplicate_notes =
        "{\"version\":\"1.2.3\",\"changelog\":\"One\",\"changelog\":\"Two\"}";
    CHECK(!manifest_changelog(duplicate_notes, std::strlen(duplicate_notes), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* escaped_unicode = "{\"version\":\"1.2.3\",\"changelog\":\"No \\u0041SCII fork\"}";
    CHECK(!manifest_changelog(escaped_unicode, std::strlen(escaped_unicode), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* escaped_version = "{\"version\":\"1.2.\\u0033\",\"changelog\":\"Wrong identity\"}";
    CHECK(!manifest_changelog(escaped_version, std::strlen(escaped_version), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* cut_notes = "{\"version\":\"1.2.3\",\"changelog\":\"unfinished";
    CHECK(!manifest_changelog(cut_notes, std::strlen(cut_notes), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* mismatched_notes = "{\"version\":\"1.2.3\",\"changelog\":\"Wrong closer\"]";
    CHECK(!manifest_changelog(mismatched_notes, std::strlen(mismatched_notes), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* missing_comma = "{\"version\":\"1.2.3\" \"changelog\":\"No separator\"}";
    CHECK(!manifest_changelog(missing_comma, std::strlen(missing_comma), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);
    const char* trailing_notes = "{\"version\":\"1.2.3\",\"changelog\":\"Trailing\"}garbage";
    CHECK(!manifest_changelog(trailing_notes, std::strlen(trailing_notes), "1.2.3", changelog,
                              sizeof(changelog)) &&
          changelog[0] == 0);

    const std::string max_notes(OTA_CHANGELOG_TEXT_MAX, 'x');
    const std::string max_notes_json =
        "{\"version\":\"1.2.3\",\"changelog\":\"" + max_notes + "\"}";
    CHECK(manifest_changelog(max_notes_json.data(), max_notes_json.size(), "1.2.3", changelog,
                             sizeof(changelog)));
    CHECK(std::strlen(changelog) == OTA_CHANGELOG_TEXT_MAX);
    const std::string too_many_notes(OTA_CHANGELOG_TEXT_MAX + 1, 'y');
    const std::string too_many_notes_json =
        "{\"version\":\"1.2.3\",\"changelog\":\"" + too_many_notes + "\"}";
    CHECK(!manifest_changelog(too_many_notes_json.data(), too_many_notes_json.size(), "1.2.3",
                              changelog, sizeof(changelog)) &&
          changelog[0] == 0);
    char tiny_notes[8];
    CHECK(!manifest_changelog(notes_json, std::strlen(notes_json), "1.2.3-dev.4", tiny_notes,
                              sizeof(tiny_notes)) &&
          tiny_notes[0] == 0);
}

static void test_ota_changelog_range() {
    char legacy[] = "Add target-only note\nKeep <script> literal";
    CHECK(ota_changelog_select_range(legacy, "1.0.3-dev.19", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Legacy);
    CHECK(std::string(legacy) == "Add target-only note\nKeep <script> literal");

    char legacy_v_prefix[] = "v2 compatibility improvements\nKeep target-only release notes";
    CHECK(ota_changelog_select_range(legacy_v_prefix, "1.0.3-dev.19", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Legacy);
    CHECK(std::string(legacy_v_prefix) ==
          "v2 compatibility improvements\nKeep target-only release notes");

    char legacy_v_prefix_separator[] =
        "v2 compatibility — improved transport\nKeep target-only release notes";
    CHECK(ota_changelog_select_range(legacy_v_prefix_separator, "1.0.3-dev.19",
                                     "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Legacy);
    CHECK(std::string(legacy_v_prefix_separator) ==
          "v2 compatibility — improved transport\nKeep target-only release notes");

    constexpr const char* cumulative =
        "v1.0.3-dev.15 — Hard-reset ESP32-S3 after serial flash\n"
        "v1.0.3-dev.17 — Fix OTA stress HTTP handoff\n"
        "v1.0.3-dev.18 — Maintenance and reliability improvements.\n"
        "v1.0.3-dev.19 — Preserve legacy bench restore compatibility\n"
        "v1.0.3-dev.20 — Accept exact legacy writer evidence";

    char from_dev14[512];
    std::strcpy(from_dev14, cumulative);
    CHECK(ota_changelog_select_range(from_dev14, "1.0.3-dev.14", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Selected);
    CHECK(std::string(from_dev14) == cumulative);

    char from_dev17[512];
    std::strcpy(from_dev17, cumulative);
    CHECK(ota_changelog_select_range(from_dev17, "1.0.3-dev.17", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Selected);
    CHECK(std::string(from_dev17) ==
          "v1.0.3-dev.18 — Maintenance and reliability improvements.\n"
          "v1.0.3-dev.19 — Preserve legacy bench restore compatibility\n"
          "v1.0.3-dev.20 — Accept exact legacy writer evidence");

    char from_dev19[512];
    std::strcpy(from_dev19, cumulative);
    CHECK(ota_changelog_select_range(from_dev19, "1.0.3-dev.19", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Selected);
    CHECK(std::string(from_dev19) ==
          "v1.0.3-dev.20 — Accept exact legacy writer evidence");

    char same_build_lines[] =
        "v1.0.3-dev.19 — First dev.19 note\n"
        "v1.0.3-dev.19 — Second dev.19 note\n"
        "v1.0.3-dev.20 — Target note";
    CHECK(ota_changelog_select_range(same_build_lines, "1.0.3-dev.19", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Selected);
    CHECK(std::string(same_build_lines) == "v1.0.3-dev.20 — Target note");

    char downgrade[] =
        "v1.0.3-dev.19 — Earlier\n"
        "v1.0.3-dev.20 — Target";
    CHECK(ota_changelog_select_range(downgrade, "1.0.3-dev.21", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Invalid);
    CHECK(downgrade[0] == 0);

    char same_version[] = "v1.0.3-dev.20 — Target";
    CHECK(ota_changelog_select_range(same_version, "1.0.3-dev.20", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Invalid);
    CHECK(same_version[0] == 0);

    char legacy_downgrade[] = "Target-only release downgrade note";
    CHECK(ota_changelog_select_range(legacy_downgrade, "1.0.4-dev.1", "1.0.3") ==
          OtaChangelogRangeResult::Legacy);
    CHECK(std::string(legacy_downgrade) == "Target-only release downgrade note");

    char wrong_target[] =
        "v1.0.3-dev.19 — Earlier\n"
        "v1.0.3-dev.20 — Target";
    CHECK(ota_changelog_select_range(wrong_target, "1.0.3-dev.18", "1.0.3-dev.21") ==
          OtaChangelogRangeResult::Invalid);
    CHECK(wrong_target[0] == 0);

    char out_of_order[] =
        "v1.0.3-dev.20 — Later\n"
        "v1.0.3-dev.19 — Earlier";
    CHECK(ota_changelog_select_range(out_of_order, "1.0.3-dev.18", "1.0.3-dev.19") ==
          OtaChangelogRangeResult::Invalid);
    CHECK(out_of_order[0] == 0);

    char malformed[] =
        "v1.0.3-dev.19 — Valid\n"
        "v1.0.3-dev.20 - wrong separator";
    CHECK(ota_changelog_select_range(malformed, "1.0.3-dev.18", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Invalid);
    CHECK(malformed[0] == 0);

    char empty[] = "";
    CHECK(ota_changelog_select_range(empty, "1.0.3-dev.19", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Legacy);
    char invalid_versions[] = "v1.0.3-dev.20 — Note";
    CHECK(ota_changelog_select_range(invalid_versions, "unknown", "1.0.3-dev.20") ==
          OtaChangelogRangeResult::Invalid);
    CHECK(invalid_versions[0] == 0);
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
    // Field substitution keeps the KEY and replaces the VALUE. The caller writes the result into
    // the JSON where the value would have gone, so "off" must be an exact passthrough — a redaction
    // that normalised the untouched case would change /status for every ordinary request.
    CHECK(redact_or("ExampleNet", true) == REDACTED);
    CHECK(redact_or("ExampleNet", false) == "ExampleNet");
    CHECK(redact_or("", true) == REDACTED); // the PRIMITIVE substitutes whatever it is handed

    // The /status builder wraps its identifier fields in redact_identifier instead, which leaves an
    // UNSET one alone. "<redacted>" over an empty value invents an identifier the installation does
    // not have, and a bug report then cannot be read for the first thing triage needs from it:
    // which optional sources this device is even running. mqtt.broker is the sharpest case — empty
    // IS the disabled state, so every broker-less device used to report a hidden broker.
    CHECK(redact_identifier("192.0.2.27:1883", true) == REDACTED);
    CHECK(redact_identifier("192.0.2.27:1883", false) == "192.0.2.27:1883");
    CHECK(redact_identifier("", true).empty()); // not set -> nothing to hide, and nothing invented
    CHECK(redact_identifier("", false).empty());

    // One CHECK per shipped log statement. If a diag_printf() is reworded, the matching line here
    // is what fails — the leak itself is invisible (a correct-looking log line with a real
    // hostname).
    CHECK(redact_diag_line("[   12.345] syslog: target set to logs.example.lan:514") ==
          "[   12.345] syslog: target set to <redacted>");
    CHECK(redact_diag_line("syslog: forwarding to logs.example.lan (192.0.2.9), reachable=yes") ==
          "syslog: forwarding to <redacted>, reachable=yes");
    CHECK(redact_diag_line("syslog: DNS lookup failed for logs.example.lan (error 202)") ==
          "syslog: DNS lookup failed for <redacted> (error 202)");
    CHECK(redact_diag_line("wifi: rollback restore to 'ExampleNet' was not persisted — opening") ==
          "wifi: rollback restore to '<redacted>' was not persisted — opening");
    CHECK(redact_diag_line("wifi: could not clear the rollback backup ('ExampleNet') — a later") ==
          "wifi: could not clear the rollback backup ('<redacted>') — a later");
    CHECK(redact_diag_line("sntp: time synced (pool.ntp.org)") == "sntp: time synced (<redacted>)");
    CHECK(redact_diag_line("sntp: init failed (pool.ntp.org): ESP_ERR_INVALID_STATE") ==
          "sntp: init failed (<redacted>): ESP_ERR_INVALID_STATE");
    // The DISCOVERED HomeHub IPv4 identifies the reporter's LAN just like a manually entered
    // address, so /status withholds it as modbus.host and /diag must not put it back.
    CHECK(redact_diag_line("modbus: manual mDNS search found gateway 192.0.2.137") ==
          "modbus: manual mDNS search found gateway <redacted>");
    CHECK(redact_diag_line("modbus: initial mDNS search found gateway 192.0.2.137") ==
          "modbus: initial mDNS search found gateway <redacted>");
    CHECK(redact_diag_line("modbus: 2 HomeHubs discovered via mDNS — using 192.0.2.137") ==
          "modbus: 2 HomeHubs discovered via mDNS — using <redacted>");
    // The count SURVIVES on the several-hubs line: that more than one gateway answered is what
    // explains an unexpected pick, and it sits before the marker precisely so it can be kept.
    CHECK(redact_diag_line("modbus: 2 HomeHubs discovered via mDNS — using 192.0.2.137")
              .find("modbus: 2 ") == 0);
    // The failure contains no address, matches no rule and survives whole.
    {
        const std::string none = "modbus: no HomeHub found via manual mDNS search after 3 attempts";
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

    // FAIL CLOSED. The ring truncates, and a value cut off mid-write sits unterminated at the end
    // of the line — precisely when the end token is missing. Redact to the end rather than give up.
    CHECK(redact_diag_line("sntp: time synced (pool.ntp.o") == "sntp: time synced (<redacted>");
    CHECK(redact_diag_line("wifi: rollback restore to 'MyHome") ==
          "wifi: rollback restore to '<redacted>");

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
    // line per detect pass) and where a wrong value is PROVEN — issue #194 is that argument in
    // full. A future rule with a loose marker ("detect: ", or a bare "0x") would clip those bytes,
    // and the only symptom would be a witness that quietly stopped being evidence: the #35-#39
    // shape aimed at the very tool built to catch it. So the privacy rule is pinned against the
    // diagnostic one.
    for (const char* w : {
             "[  123.456] detect: raw 0x10 32B 00 1E 32 00 07 CF 00 00 12 34 AB CD EF 01 02 03",
             "[  123.456] detect: raw 0x20 32B FF FF 00 00 0C 80 00 00 00 00 00 00 00 00 00 00",
             "[  123.456] detect: proto=I rx=1 tx=2 pages=0x1e7f kw=60 iu_kw=80 eeprom=[1234] -> 3 "
             "candidate(s), best=x",
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
    const std::string nested =
        redact_diag_line("sntp: time synced (sntp: time synced (evil.host))");
    CHECK(nested.find("evil.host") == std::string::npos);
    CHECK(nested == "sntp: time synced (<redacted>))");
}

static void test_config_store() {
    // CRC-32 golden vector (the check byte itself is what makes the blob all-or-nothing on load).
    CHECK(config_crc32(reinterpret_cast<const uint8_t*>("123456789"), 9) == 0xCBF43926u);
    CHECK(config_crc32(nullptr, 0) == 0u);

    // The separately-owned X10A cache is atomic too: a swapped pin pair and protocol are one CRC'd
    // entry, so failure cannot leave the first pin durable and return HTTP 500 before the second.
    LinkBlob             link{43, 44, 'S', 0x12345678u};
    std::vector<uint8_t> link_bytes = link_blob_serialize(link);
    CHECK(link_bytes.size() == LINK_BLOB_BYTES);
    LinkBlob link_rt;
    CHECK(link_blob_deserialize(link_bytes.data(), link_bytes.size(), link_rt));
    CHECK(link_rt.rx_pin == 43 && link_rt.tx_pin == 44 && link_rt.proto == 'S' &&
          link_rt.identity_fp == 0x12345678u);
    std::vector<uint8_t> link_bad = link_bytes;
    link_bad[9] ^= 1;
    CHECK(!link_blob_deserialize(link_bad.data(), link_bad.size(), link_rt));
    CHECK(!link_blob_deserialize(link_bytes.data(), link_bytes.size() - 1, link_rt));

    // Round-trip every field, including bytes that must survive verbatim (spaces are valid
    // SSID/user bytes — the F08 fix — and a blob must not mangle them), and the two packed flags.
    ConfigBlob a;
    a.wifi_ssid              = " my wifi ";
    a.wifi_pass              = "p@ss word";
    a.wifi_ssid_backup       = "old";
    a.wifi_pass_backup       = "";
    a.wifi_rollback_active   = true;
    a.wifi_rolled_back       = false;
    a.mqtt_uri               = "mqtts://broker:8883";
    a.mqtt_user              = "u ser";
    a.mqtt_pass              = "";
    a.syslog_host            = "logs.example.com";
    a.syslog_port            = 514;
    a.ntp_server             = "pool.ntp.org";
    a.board_preset_id        = static_cast<int32_t>(BoardPresetId::M5StackAtomS3Lite);
    a.board_user_set         = true;
    a.diagnostics_enabled    = true;
    a.diagnostics_generation = 7;
    std::vector<uint8_t> buf = config_blob_serialize(a);
    ConfigBlob           b;
    CHECK(config_blob_deserialize(buf.data(), buf.size(), b));
    CHECK(b.wifi_ssid == a.wifi_ssid && b.wifi_pass == a.wifi_pass);
    CHECK(b.wifi_ssid_backup == a.wifi_ssid_backup && b.wifi_pass_backup == a.wifi_pass_backup);
    CHECK(b.wifi_rollback_active == true && b.wifi_rolled_back == false);
    CHECK(b.mqtt_uri == a.mqtt_uri && b.mqtt_user == a.mqtt_user && b.mqtt_pass == a.mqtt_pass);
    CHECK(b.syslog_host == a.syslog_host && b.syslog_port == 514);
    CHECK(b.ntp_server == a.ntp_server);
    CHECK(b.has_ref_temp && b.ref_temp_name.empty() && b.ref_temp_topic.empty() &&
          b.ref_temp_path.empty());
    CHECK(b.ref_temp_time_path.empty() && b.ref_temp_max_age_s == 600 && b.has_ref_control);
    CHECK(b.ref_temp_setpoint_path.empty() && b.ref_temp_enabled_path.empty() &&
          b.ref_temp_hvac_mode_path.empty());
    CHECK(b.has_weather && !b.weather_enabled && b.weather_latitude_e6 == 0 &&
          b.weather_longitude_e6 == 0);
    CHECK(b.has_env3 && !b.env3_enabled && b.env3_sda == 2 && b.env3_scl == 1);
    CHECK(b.has_board_identity && b.board_user_set &&
          b.board_preset_id == static_cast<int32_t>(BoardPresetId::M5StackAtomS3Lite));
    // v14's byte is RETIRED — only the "this blob was at least v14" witness survives it.
    CHECK(b.has_dynamic_lwt);
    CHECK(b.has_circulation && b.circulation_topic.empty() && b.circulation_max_age_s == 120 &&
          b.circulation_on_tenths_w == 30 && b.circulation_off_tenths_w == 10 &&
          b.circulation_confirm_s == 60);
    CHECK(b.has_ref_multi_source && b.ref_temp_setpoint_topic.empty() &&
          b.ref_temp_time_topic.empty() && b.ref_temp_fixed_setpoint_tenths == 0);
    CHECK(b.has_diagnostics && b.diagnostics_enabled && b.diagnostics_generation == 7);

    // v15 is append-only: the complete source mapping and exact tenths-of-watt thresholds
    // round-trip, while a genuine v14 blob remains readable and reports the source absent.
    ConfigBlob circ;
    circ.wifi_ssid                      = "net";
    circ.circulation_name               = "DHW circulation";
    circ.circulation_topic              = "fixture/circulation/status";
    circ.circulation_power_path         = "apower";
    circ.circulation_time_path          = "aenergy.minute_ts";
    circ.circulation_max_age_s          = 120;
    circ.circulation_on_tenths_w        = 30;
    circ.circulation_off_tenths_w       = 10;
    circ.circulation_confirm_s          = 60;
    const std::vector<uint8_t> circ_buf = config_blob_serialize(circ);
    ConfigBlob                 circ_rt;
    CHECK(config_blob_deserialize(circ_buf.data(), circ_buf.size(), circ_rt));
    CHECK(circ_rt.has_circulation && circ_rt.circulation_name == circ.circulation_name &&
          circ_rt.circulation_topic == circ.circulation_topic &&
          circ_rt.circulation_power_path == "apower" &&
          circ_rt.circulation_time_path == "aenergy.minute_ts");
    CHECK(circ_rt.circulation_max_age_s == 120 && circ_rt.circulation_on_tenths_w == 30 &&
          circ_rt.circulation_off_tenths_w == 10 && circ_rt.circulation_confirm_s == 60);

    // v16's base topic is exercised after `restamp` and `out` come into scope, below.
    CHECK(b.has_mqtt_base && b.mqtt_base.empty());

    // The other flag combination, and a negative-looking port stored as-is.
    ConfigBlob c;
    c.wifi_rolled_back      = true;
    c.wifi_rollback_active  = false;
    c.syslog_port           = 65535;
    std::vector<uint8_t> cb = config_blob_serialize(c);
    ConfigBlob           d;
    CHECK(config_blob_deserialize(cb.data(), cb.size(), d));
    CHECK(d.wifi_rolled_back == true && d.wifi_rollback_active == false && d.syslog_port == 65535);

    // All-or-nothing on LOAD: any corruption -> reject (false), never a partial decode. `out` is
    // left untouched so the caller falls back to defaults / the legacy per-key layout.
    ConfigBlob out;
    out.wifi_ssid            = "sentinel";
    std::vector<uint8_t> bad = buf;
    bad[10] ^= 0xFF; // flip a payload byte -> CRC fails
    CHECK(!config_blob_deserialize(bad.data(), bad.size(), out) && out.wifi_ssid == "sentinel");
    CHECK(!config_blob_deserialize(buf.data(), buf.size() - 1,
                                   out));                // truncated (CRC + length short)
    CHECK(!config_blob_deserialize(buf.data(), 4, out)); // shorter than the header+crc floor
    CHECK(!config_blob_deserialize(nullptr, 0, out));
    CHECK(!config_blob_deserialize(buf.data(), 0, out)); // zero length
    std::vector<uint8_t> badmagic = buf;
    badmagic[0]                   = 'X';
    CHECK(!config_blob_deserialize(badmagic.data(), badmagic.size(), out));
    // Helper: re-stamp a valid CRC over v[0 .. size-4) so that ONLY a non-CRC rule can reject v.
    auto restamp = [](std::vector<uint8_t>& v) {
        const uint32_t k = config_crc32(v.data(), v.size() - 4);
        v[v.size() - 4]  = k & 0xFF;
        v[v.size() - 3]  = (k >> 8) & 0xFF;
        v[v.size() - 2]  = (k >> 16) & 0xFF;
        v[v.size() - 1]  = (k >> 24) & 0xFF;
    };
    // The append-only tails every serialized blob now carries. Named once and ADDED to each
    // older-version suffix rather than folded into the literals, so a new blob version is one edit
    // here instead of fifteen scattered ones — and each literal still reads as the blocks v<N>
    // predates.
    const size_t base_suffix_bytes        = 2;
    const size_t ref_multi_suffix_bytes   = 2 + 2 + 4;
    const size_t discovery_suffix_bytes   = 1;
    const size_t diagnostics_suffix_bytes = 1 + 4;
    const size_t current_suffix_bytes     = base_suffix_bytes + ref_multi_suffix_bytes +
                                        discovery_suffix_bytes + diagnostics_suffix_bytes;
    const size_t circ_suffix_bytes =
        2 + circ.circulation_name.size() + 2 + circ.circulation_topic.size() + 2 +
        circ.circulation_power_path.size() + 2 + circ.circulation_time_path.size() + 16;
    std::vector<uint8_t> v14 = circ_buf;
    v14.erase(v14.end() - 4 - (circ_suffix_bytes + current_suffix_bytes), v14.end() - 4);
    v14[4] = 14;
    restamp(v14);
    ConfigBlob v14_rt;
    CHECK(config_blob_deserialize(v14.data(), v14.size(), v14_rt));
    CHECK(v14_rt.wifi_ssid == "net" && !v14_rt.has_circulation && v14_rt.circulation_topic.empty());
    // Unknown version, CRC re-stamped: rejected by the version check alone — on BOTH sides of the
    // accepted range, so a future v3 blob written by a newer build is refused rather than
    // half-decoded by this one.
    std::vector<uint8_t> newver = buf;
    newver[4]                   = CONFIG_BLOB_VERSION + 1;
    restamp(newver);
    CHECK(!config_blob_deserialize(newver.data(), newver.size(), out));
    std::vector<uint8_t> oldver = buf;
    oldver[4]                   = CONFIG_BLOB_VERSION_MIN - 1;
    restamp(oldver);
    CHECK(!config_blob_deserialize(oldver.data(), oldver.size(), out));
    // Trailing garbage after a valid body, CRC re-stamped: rejected by the "p != body_end" rule
    // alone.
    std::vector<uint8_t> extra = buf;
    extra.insert(extra.end() - 4, 0x00);
    restamp(extra);
    CHECK(!config_blob_deserialize(extra.data(), extra.size(), out));

    // ── v2: the board-local hardware block ───────────────────────────────────────────────────────
    ConfigBlob board;
    board.wifi_ssid         = "net";
    board.led_gpio          = 35;
    board.led_type          = 1;
    board.led_inverted      = false;
    board.btn_gpio          = 41;
    board.btn_active_low    = true;
    board.board_preset_id   = static_cast<int32_t>(BoardPresetId::M5StackAtomS3Lite);
    board.board_user_set    = true;
    std::vector<uint8_t> bb = config_blob_serialize(board);
    CHECK(bb[4] == CONFIG_BLOB_VERSION && CONFIG_BLOB_VERSION == 19);
    ConfigBlob rt;
    CHECK(config_blob_deserialize(bb.data(), bb.size(), rt));
    CHECK(rt.has_board && rt.led_gpio == 35 && rt.led_type == 1 && !rt.led_inverted);
    CHECK(rt.btn_gpio == 41 && rt.btn_active_low);
    CHECK(rt.has_board_identity && rt.board_user_set &&
          rt.board_preset_id == static_cast<int32_t>(BoardPresetId::M5StackAtomS3Lite));
    CHECK(rt.wifi_ssid == "net"); // the v1 fields still round-trip unchanged
    // The two board booleans are packed into one flag byte — they must not bleed into each other.
    board.led_inverted   = true;
    board.btn_active_low = false;
    bb                   = config_blob_serialize(board);
    CHECK(config_blob_deserialize(bb.data(), bb.size(), rt));
    CHECK(rt.led_inverted && !rt.btn_active_low);
    // Negative pins (the -1 "absent" sentinel) survive the unsigned encoding.
    board.led_gpio = -1;
    board.btn_gpio = -1;
    bb             = config_blob_serialize(board);
    CHECK(config_blob_deserialize(bb.data(), bb.size(), rt));
    CHECK(rt.led_gpio == -1 && rt.btn_gpio == -1);

    // BACKWARD COMPATIBILITY, and it is not optional: a device OTA-upgraded from a pre-board build
    // has a v1 blob on flash and NOTHING in the legacy per-key layout. Rejecting v1 would drop that
    // user's WiFi and MQTT credentials on the upgrade. It must decode, and it must report
    // has_board == false so the caller seeds the Kconfig defaults instead of reading "absent" as
    // "indicator disabled" (which would silently darken every XIAO's LED).
    std::vector<uint8_t> v1 = buf; // `buf` is serialized as v12 by this build,
    // so build a genuine v1 body: header + the v1 fields only, by dropping every trailing block
    // that precedes the CRC — the 13-byte v2 board block (3x u32 + 1 flag byte), the 1-byte v3
    // channel, the 1-byte v4 language and the 11-byte v5 HomeHub block (empty mb_host [2] + mb_port
    // u32 + mb_unit_id u32 + 1 flag byte), three empty v7 strings (6 bytes), and the empty v8
    // timestamp path + max-age u32 (6 bytes), weather (9), ENV III (9), board identity (2), and the
    // three empty v13 room-control strings (6), v14 controller mode (1), the empty/default v15
    // circulation-source block (24), and the empty v16 base topic (2) = 91 bytes.
    v1.erase(v1.end() - 4 - (89 + current_suffix_bytes), v1.end() - 4);
    v1[4] = 1;
    restamp(v1);
    ConfigBlob legacy;
    legacy.led_gpio = 999; // sentinel: must be left untouched by the decode
    CHECK(config_blob_deserialize(v1.data(), v1.size(), legacy));
    CHECK(!legacy.has_board);
    CHECK(legacy.wifi_ssid == a.wifi_ssid && legacy.mqtt_uri == a.mqtt_uri); // v1 payload intact
    CHECK(legacy.led_gpio == -1); // the struct default, not the 999 sentinel
    // A TRUNCATED v14 must not decode with a partial room-control/mode suffix.
    std::vector<uint8_t> trunc = bb;
    trunc.erase(trunc.end() - 4 - 6, trunc.end() - 4); // lop six bytes off the tail
    restamp(trunc);
    CHECK(!config_blob_deserialize(trunc.data(), trunc.size(), out));

    // ── v16/v17/v18: MQTT base, room-value mappings and HomeHub discovery latch ────────────────
    // The default blob round-tripped above carries it EMPTY and still reports has_mqtt_base,
    // because empty is a VALUE here ("use the compile-time default"), not an absence — which is
    // what makes this upgrade a no-op for every deployed device: nothing to migrate, nothing to
    // seed.
    ConfigBlob base_blob;
    base_blob.wifi_ssid                 = "net";
    base_blob.mqtt_base                 = "daikin-bench-2";
    const std::vector<uint8_t> base_buf = config_blob_serialize(base_blob);
    ConfigBlob                 base_rt;
    CHECK(config_blob_deserialize(base_buf.data(), base_buf.size(), base_rt));
    CHECK(base_rt.has_mqtt_base && base_rt.mqtt_base == "daikin-bench-2" &&
          base_rt.wifi_ssid == "net");
    CHECK(base_rt.has_ref_multi_source);
    CHECK(base_rt.has_modbus_discovery_state && !base_rt.mb_discovery_done);
    CHECK(base_rt.has_diagnostics && !base_rt.diagnostics_enabled &&
          base_rt.diagnostics_generation == 0);
    ConfigBlob multi_source;
    multi_source.ref_temp_setpoint_topic        = "thermostat/status";
    multi_source.ref_temp_time_topic            = "fixture/room-temperature/time";
    multi_source.ref_temp_fixed_setpoint_tenths = 205;
    const std::vector<uint8_t> multi_buf        = config_blob_serialize(multi_source);
    ConfigBlob                 multi_rt;
    CHECK(config_blob_deserialize(multi_buf.data(), multi_buf.size(), multi_rt));
    CHECK(multi_rt.has_ref_multi_source &&
          multi_rt.ref_temp_setpoint_topic == multi_source.ref_temp_setpoint_topic &&
          multi_rt.ref_temp_time_topic == multi_source.ref_temp_time_topic &&
          multi_rt.ref_temp_fixed_setpoint_tenths == 205);
    ConfigBlob discovered;
    discovered.mb_discovery_done              = true;
    const std::vector<uint8_t> discovered_buf = config_blob_serialize(discovered);
    ConfigBlob                 discovered_rt;
    CHECK(config_blob_deserialize(discovered_buf.data(), discovered_buf.size(), discovered_rt));
    CHECK(discovered_rt.has_modbus_discovery_state && discovered_rt.mb_discovery_done);
    // A genuine v17 blob has the independent room mappings but no discovery decision. The load
    // layer uses has_modbus_discovery_state=false to apply the conservative pre-v18 migration.
    std::vector<uint8_t> v17 = base_buf;
    v17.erase(v17.end() - 4 - (discovery_suffix_bytes + diagnostics_suffix_bytes), v17.end() - 4);
    v17[4] = 17;
    restamp(v17);
    ConfigBlob v17_rt;
    CHECK(config_blob_deserialize(v17.data(), v17.size(), v17_rt));
    CHECK(v17_rt.has_ref_multi_source && !v17_rt.has_modbus_discovery_state);
    // A genuine v16 blob has the base topic but not the v17 room-topic extension.
    std::vector<uint8_t> v16 = base_buf;
    v16.erase(v16.end() - 4 -
                  (ref_multi_suffix_bytes + discovery_suffix_bytes + diagnostics_suffix_bytes),
              v16.end() - 4);
    v16[4] = 16;
    restamp(v16);
    ConfigBlob v16_rt;
    CHECK(config_blob_deserialize(v16.data(), v16.size(), v16_rt));
    CHECK(v16_rt.has_mqtt_base && v16_rt.mqtt_base == "daikin-bench-2" &&
          !v16_rt.has_ref_multi_source);
    // A genuine v15 blob (the build immediately before this field) must still decode — the same
    // upgrade guarantee v1 and v2 got — and report the base absent rather than refusing the blob
    // and taking the user's credentials down with it.
    std::vector<uint8_t> v15 = base_buf;
    v15.erase(v15.end() - 4 -
                  (16 + ref_multi_suffix_bytes + discovery_suffix_bytes + diagnostics_suffix_bytes),
              v15.end() - 4);
    v15[4] = 15;
    restamp(v15);
    ConfigBlob v15_rt;
    CHECK(config_blob_deserialize(v15.data(), v15.size(), v15_rt));
    CHECK(!v15_rt.has_mqtt_base && v15_rt.mqtt_base.empty() && v15_rt.wifi_ssid == "net");
    CHECK(v15_rt.has_circulation); // every earlier block still decoded
    // A genuine v18 blob has the HomeHub decision but no diagnostics consent. It migrates OFF with
    // a zero generation; a v19 stamp missing that complete five-byte block is truncated and
    // rejected.
    std::vector<uint8_t> v18 = base_buf;
    v18.erase(v18.end() - 4 - diagnostics_suffix_bytes, v18.end() - 4);
    v18[4] = 18;
    restamp(v18);
    ConfigBlob v18_rt;
    CHECK(config_blob_deserialize(v18.data(), v18.size(), v18_rt));
    CHECK(v18_rt.has_modbus_discovery_state && !v18_rt.has_diagnostics &&
          !v18_rt.diagnostics_enabled && v18_rt.diagnostics_generation == 0);
    std::vector<uint8_t> v19_short = v18;
    v19_short[4]                   = 19;
    restamp(v19_short);
    CHECK(!config_blob_deserialize(v19_short.data(), v19_short.size(), out));

    // ── v3: the OTA update channel ───────────────────────────────────────────────────────────────
    ConfigBlob chan;
    chan.wifi_ssid           = "net";
    chan.ota_channel         = 1; // 1 = dev
    std::vector<uint8_t> cbv = config_blob_serialize(chan);
    ConfigBlob           crt;
    CHECK(config_blob_deserialize(cbv.data(), cbv.size(), crt));
    CHECK(crt.has_ota && crt.ota_channel == 1 && crt.wifi_ssid == "net");
    chan.ota_channel = 0;
    cbv              = config_blob_serialize(chan);
    CHECK(config_blob_deserialize(cbv.data(), cbv.size(), crt) && crt.ota_channel == 0 &&
          crt.has_ota);
    // The same upgrade guarantee v1 got: a device that has only ever been written by a pre-channel
    // build carries a v2 blob, and it must decode — losing the credentials to gain a channel byte
    // would be a spectacularly bad trade. has_ota == false is how the caller tells "no channel
    // stored" from "explicitly release"; both mean release, only the diag line differs.
    std::vector<uint8_t> v2 = bb;
    v2.erase(v2.end() - 4 - (76 + current_suffix_bytes), v2.end() - 4);
    v2[4] = 2;
    restamp(v2);
    ConfigBlob pre;
    pre.ota_channel = 7;
    pre.ui_lang     = 7; // sentinels: must be left untouched
    CHECK(config_blob_deserialize(v2.data(), v2.size(), pre));
    CHECK(!pre.has_ota && pre.ota_channel == 0); // the struct default, not the 7 sentinel
    CHECK(!pre.has_lang && pre.ui_lang == 0);    // v2 predates the language byte too
    CHECK(!pre.has_modbus && pre.mb_port == 502 && pre.mb_unit_id == 1);
    CHECK(pre.has_board && pre.led_gpio == -1 && pre.wifi_ssid == "net"); // v2 payload intact

    // ── v4: the UI language override
    // ──────────────────────────────────────────────────────────────
    ConfigBlob lang;
    lang.wifi_ssid           = "net";
    lang.ota_channel         = 1;
    lang.ui_lang             = 2; // 1 = dev, 2 = en
    std::vector<uint8_t> lbv = config_blob_serialize(lang);
    ConfigBlob           lrt;
    CHECK(config_blob_deserialize(lbv.data(), lbv.size(), lrt));
    CHECK(lrt.has_lang && lrt.ui_lang == 2 && lrt.has_ota && lrt.ota_channel == 1 &&
          lrt.wifi_ssid == "net");
    lang.ui_lang = 8; // the extended v4 byte carries Ukrainian
    lbv          = config_blob_serialize(lang);
    CHECK(config_blob_deserialize(lbv.data(), lbv.size(), lrt) && lrt.ui_lang == 8 && lrt.has_lang);
    lang.ui_lang = 0; // auto round-trips as 0 WITH has_lang set
    lbv          = config_blob_serialize(lang);
    CHECK(config_blob_deserialize(lbv.data(), lbv.size(), lrt) && lrt.ui_lang == 0 && lrt.has_lang);
    // The upgrade guarantee, one version on: a device written by a pre-language (v3) build carries
    // a v3 blob and must still decode — the channel survives, and the absent language reads as auto
    // (has_lang == false, ui_lang == 0), so the browser keeps auto-detecting exactly as before.
    std::vector<uint8_t> v3 = lbv;
    v3.erase(v3.end() - 4 - (75 + current_suffix_bytes), v3.end() - 4);
    v3[4] = 3;
    restamp(v3);
    ConfigBlob prel;
    prel.ui_lang = 7; // sentinel: must be left untouched
    CHECK(config_blob_deserialize(v3.data(), v3.size(), prel));
    CHECK(!prel.has_lang && prel.ui_lang == 0); // the struct default, not the 7 sentinel
    CHECK(prel.has_ota && prel.ota_channel == 1 && prel.wifi_ssid == "net"); // v3 payload intact

    // ── v5: the HomeHub Modbus stack ────────────────────────────────────────────────────────────
    // v5 and not v4: the language byte and this block were written in parallel and both claimed v4.
    // main's language byte landed first and is already on published builds, so this took the later
    // number — a second, different "v4" would decode that byte as a HomeHub setting.
    ConfigBlob mb;
    mb.wifi_ssid             = "net";
    mb.mb_host               = "homehub-524288-example.local";
    mb.mb_port               = 502;
    mb.mb_unit_id            = 3;
    mb.homehub_enabled       = false;
    std::vector<uint8_t> mbb = config_blob_serialize(mb);
    CHECK(mbb[4] == CONFIG_BLOB_VERSION && CONFIG_BLOB_VERSION == 19);
    ConfigBlob mrt;
    CHECK(config_blob_deserialize(mbb.data(), mbb.size(), mrt));
    CHECK(mrt.has_modbus && mrt.mb_host == "homehub-524288-example.local");
    CHECK(mrt.mb_port == 502 && mrt.mb_unit_id == 3 && mrt.homehub_enabled);
    CHECK(mrt.wifi_ssid == "net"); // the earlier-version fields round-trip too
    // An EMPTY mb_host (= disabled) must survive the string encoding, and the compatibility bit
    // must not bleed into the board/ota/language bytes that precede it.
    mb.mb_host         = "";
    mb.homehub_enabled = false;
    mbb                = config_blob_serialize(mb);
    CHECK(config_blob_deserialize(mbb.data(), mbb.size(), mrt));
    CHECK(mrt.mb_host.empty() && !mrt.homehub_enabled);
    mb.homehub_enabled = true; // ignored: an empty host always serializes as disabled
    mbb                = config_blob_serialize(mb);
    CHECK(config_blob_deserialize(mbb.data(), mbb.size(), mrt));
    CHECK(!mrt.homehub_enabled);
    // The RETIRED v9 actuation-consent bit (bit0 of the HomeHub flag byte, #294): a stored 1 must
    // not survive into a decoded config, because the capability it consented to no longer exists.
    // Set it by hand on a current-version blob and prove the decoder ignores it while the rest
    // round-trips. Needs a NON-EMPTY host so the flag byte's bit1 (the host-derived compatibility
    // mirror) is set, which is what pins the byte offset below: with an empty host every bit there
    // is 0 and a wrong index would make these checks assert nothing at all.
    ConfigBlob consent_src         = mb;
    consent_src.mb_host            = "homehub-524288-example.local";
    std::vector<uint8_t> consent   = config_blob_serialize(consent_src);
    const size_t         flag_byte = consent.size() - 5 - 63 - current_suffix_bytes;
    CHECK((consent[flag_byte] & 2u) != 0); // offset pinned by the mirror bit
    CHECK((consent[flag_byte] & 1u) == 0); // the encoder never sets the consent bit
    consent[flag_byte] |= 1u;
    restamp(consent);
    ConfigBlob consent_rt;
    CHECK(config_blob_deserialize(consent.data(), consent.size(), consent_rt));
    CHECK(consent_rt.has_modbus && consent_rt.mb_host == consent_src.mb_host);
    // The load-bearing half: decode -> encode must CLEAR it again. If the field were still carried
    // anywhere in ConfigBlob, this round trip would write the consent bit back out.
    const std::vector<uint8_t> consent_again = config_blob_serialize(consent_rt);
    CHECK((consent_again[flag_byte] & 1u) == 0 && (consent_again[flag_byte] & 2u) != 0);
    // The immediately preceding v6 build could persist enabled+empty as Auto. Preserve its wire
    // shape as an upgrade fixture: current firmware must ignore that bit and decode empty as Off.
    std::vector<uint8_t> legacy_v6_auto = mbb;
    legacy_v6_auto.erase(legacy_v6_auto.end() - 4 - (63 + current_suffix_bytes),
                         legacy_v6_auto.end() - 4);
    legacy_v6_auto[4] = 6;
    legacy_v6_auto[legacy_v6_auto.size() - 5] |= 2u;
    restamp(legacy_v6_auto);
    ConfigBlob legacy_v6_rt;
    CHECK(config_blob_deserialize(legacy_v6_auto.data(), legacy_v6_auto.size(), legacy_v6_rt));
    CHECK(legacy_v6_rt.mb_host.empty() && !legacy_v6_rt.homehub_enabled);
    // A v5 empty-host blob also decodes disabled. Its historical flag was ambiguous, so it cannot
    // arm discovery in the current explicit-search contract.
    std::vector<uint8_t> v5 = mbb;
    v5.erase(v5.end() - 4 - (63 + current_suffix_bytes), v5.end() - 4);
    v5[4] = 5;
    v5[v5.size() - 5] &= static_cast<uint8_t>(~2u); // HomeHub flag byte immediately before CRC
    restamp(v5);
    ConfigBlob v5rt;
    CHECK(config_blob_deserialize(v5.data(), v5.size(), v5rt));
    CHECK(v5rt.has_modbus && !v5rt.homehub_enabled);
    // v8 carried the same bit as an inert placeholder. It stays inert forever now that the write
    // path is gone: the transport survives the migration and nothing decodes a consent flag.
    std::vector<uint8_t> v8 = mbb;
    v8.erase(v8.end() - 4 - (51 + current_suffix_bytes), v8.end() - 4);
    v8[4] = 8;
    restamp(v8);
    ConfigBlob v8rt;
    CHECK(config_blob_deserialize(v8.data(), v8.size(), v8rt));
    CHECK(v8rt.has_modbus && v8rt.mb_host == mb.mb_host);
    // BACKWARD COMPATIBILITY: a v4 blob (a device from before the transport existed, but WITH the
    // language byte) must decode, report has_modbus == false and leave the mb_* struct defaults
    // (X10A / 502 / 1) — the same trade v1/v2/v3 already refuse to make.
    std::vector<uint8_t> v4 = mbb;
    v4.erase(v4.end() - 4 - (74 + current_suffix_bytes), v4.end() - 4);
    v4[4] = 4;
    restamp(v4);
    ConfigBlob v4rt;
    v4rt.mb_port    = 9;
    v4rt.mb_unit_id = 9; // sentinels: must reset
    CHECK(config_blob_deserialize(v4.data(), v4.size(), v4rt));
    CHECK(!v4rt.has_modbus && v4rt.mb_port == 502 && v4rt.mb_unit_id == 1);
    CHECK(v4rt.has_lang && v4rt.has_ota && v4rt.wifi_ssid == "net"); // the v4 payload is intact

    // ── v7/v8: exact MQTT mapping, source timestamp and freshness ──────────────────────────────
    ConfigBlob ref;
    ref.wifi_ssid                   = "net";
    ref.ref_temp_name               = "Example sensor";
    ref.ref_temp_topic              = "fixture/room-temperature/status";
    ref.ref_temp_path               = "temperature.tC";
    ref.ref_temp_time_path          = "thermostat.read_at";
    ref.ref_temp_setpoint_path      = "thermostat.target_temperature_c";
    ref.ref_temp_enabled_path       = "thermostat.enabled";
    ref.ref_temp_hvac_mode_path     = "thermostat.hvac_mode";
    ref.ref_temp_max_age_s          = 900;
    const std::vector<uint8_t> refb = config_blob_serialize(ref);
    ConfigBlob                 refrt;
    CHECK(config_blob_deserialize(refb.data(), refb.size(), refrt));
    CHECK(refrt.has_ref_temp && refrt.ref_temp_name == ref.ref_temp_name);
    CHECK(refrt.ref_temp_topic == ref.ref_temp_topic && refrt.ref_temp_path == ref.ref_temp_path);
    CHECK(refrt.ref_temp_time_path == ref.ref_temp_time_path && refrt.ref_temp_max_age_s == 900);
    CHECK(refrt.has_ref_control && refrt.ref_temp_setpoint_path == ref.ref_temp_setpoint_path &&
          refrt.ref_temp_enabled_path == ref.ref_temp_enabled_path &&
          refrt.ref_temp_hvac_mode_path == ref.ref_temp_hvac_mode_path);

    // v13 already has room control but predates the controller mode; it must migrate OFF.
    std::vector<uint8_t> v13 = refb;
    v13.erase(v13.end() - 4 - (25 + current_suffix_bytes), v13.end() - 4);
    v13[4] = 13;
    restamp(v13);
    ConfigBlob v13rt;
    CHECK(config_blob_deserialize(v13.data(), v13.size(), v13rt));
    CHECK(v13rt.has_ref_control && !v13rt.has_dynamic_lwt);

    // v12 migrates the already deployed current/source-time mapping without inventing control
    // authorization. It remains observable and explicitly lacks target/eligibility mappings.
    const size_t v13_ref_bytes = 2 + ref.ref_temp_setpoint_path.size() + 2 +
                                 ref.ref_temp_enabled_path.size() + 2 +
                                 ref.ref_temp_hvac_mode_path.size();
    std::vector<uint8_t> v12 = refb;
    v12.erase(v12.end() - 4 - (v13_ref_bytes + 25 + current_suffix_bytes), v12.end() - 4);
    v12[4] = 12;
    restamp(v12);
    ConfigBlob v12rt;
    CHECK(config_blob_deserialize(v12.data(), v12.size(), v12rt));
    CHECK(v12rt.has_ref_temp && !v12rt.has_ref_control &&
          v12rt.ref_temp_topic == ref.ref_temp_topic && v12rt.ref_temp_setpoint_path.empty());

    // The hardware-tested capture slice wrote v7 with only name/topic/value-path. It must migrate
    // in place: keep that mapping, add no imaginary timestamp path, and use the 10-minute default.
    std::vector<uint8_t> v7 = refb;
    v7.erase(v7.end() - 4 -
                 (2 + ref.ref_temp_time_path.size() + 4 + 20 + v13_ref_bytes + 25 +
                  current_suffix_bytes),
             v7.end() - 4);
    v7[4] = 7;
    restamp(v7);
    ConfigBlob v7rt;
    CHECK(config_blob_deserialize(v7.data(), v7.size(), v7rt));
    CHECK(v7rt.has_ref_temp && v7rt.ref_temp_topic == ref.ref_temp_topic);
    CHECK(v7rt.ref_temp_time_path.empty() && v7rt.ref_temp_max_age_s == 600);

    // A genuine v6 blob still carries every earlier setting and reports the new mapping absent.
    std::vector<uint8_t> v6 = mbb;
    v6.erase(v6.end() - 4 - (63 + current_suffix_bytes), v6.end() - 4);
    v6[4] = 6;
    restamp(v6);
    ConfigBlob v6rt;
    CHECK(config_blob_deserialize(v6.data(), v6.size(), v6rt));
    CHECK(v6rt.has_modbus && !v6rt.has_ref_temp && v6rt.ref_temp_topic.empty());

    // ── v10: direct Open-Meteo location ────────────────────────────────────────────────────────
    ConfigBlob weather;
    weather.wifi_ssid                   = "net";
    weather.weather_enabled             = true;
    weather.weather_latitude_e6         = 12345678;
    weather.weather_longitude_e6        = 23456789;
    const std::vector<uint8_t> weatherb = config_blob_serialize(weather);
    ConfigBlob                 weatherrt;
    CHECK(config_blob_deserialize(weatherb.data(), weatherb.size(), weatherrt));
    CHECK(weatherrt.has_weather && weatherrt.weather_enabled);
    CHECK(weatherrt.weather_latitude_e6 == 12345678 && weatherrt.weather_longitude_e6 == 23456789);
    // A genuine v10 blob keeps weather but predates ENV III and explicit board identity.
    std::vector<uint8_t> v10 = weatherb;
    v10.erase(v10.end() - 4 - (42 + current_suffix_bytes), v10.end() - 4);
    v10[4] = 10;
    restamp(v10);
    ConfigBlob v10rt;
    CHECK(config_blob_deserialize(v10.data(), v10.size(), v10rt));
    CHECK(v10rt.has_weather && v10rt.weather_enabled && !v10rt.has_env3 &&
          !v10rt.has_board_identity);

    // ── v11/v12: ENV III wiring and explicit board identity ────────────────────────────────────
    ConfigBlob envb;
    envb.wifi_ssid              = "net";
    envb.env3_enabled           = true;
    envb.env3_sda               = 5;
    envb.env3_scl               = 6;
    std::vector<uint8_t> envbuf = config_blob_serialize(envb);
    ConfigBlob           envrt;
    CHECK(config_blob_deserialize(envbuf.data(), envbuf.size(), envrt));
    CHECK(envrt.has_env3 && envrt.env3_enabled && envrt.env3_sda == 5 && envrt.env3_scl == 6);
    // v11 already carried ENV III but no explicit board id. It remains readable so the load path
    // can migrate the old `board_set` statement instead of losing credentials or sensor wiring.
    std::vector<uint8_t> v11 = envbuf;
    v11.erase(v11.end() - 4 - (33 + current_suffix_bytes), v11.end() - 4);
    v11[4] = 11;
    restamp(v11);
    ConfigBlob v11rt;
    CHECK(config_blob_deserialize(v11.data(), v11.size(), v11rt));
    CHECK(v11rt.has_weather && v11rt.has_env3 && !v11rt.has_board_identity &&
          !v11rt.board_user_set);

    // A v9 upgrade predates both independent outdoor sources and remains disabled by default.
    std::vector<uint8_t> v9 = weatherb;
    v9.erase(v9.end() - 4 - (51 + current_suffix_bytes), v9.end() - 4);
    v9[4] = 9;
    restamp(v9);
    ConfigBlob v9rt;
    CHECK(config_blob_deserialize(v9.data(), v9.size(), v9rt));
    CHECK(!v9rt.has_weather && !v9rt.weather_enabled && v9rt.weather_latitude_e6 == 0 &&
          v9rt.weather_longitude_e6 == 0);
    CHECK(!v9rt.has_env3 && !v9rt.env3_enabled && v9rt.env3_sda == 2 && v9rt.env3_scl == 1);
}

// THE WRITE SIDE OF CONFIG_BLOB_MAX_STR — the invariant the atomic-blob design rests on and the one
// it did not actually have: what config_save writes, config_load must be able to read back.
//
// The decoder rejects the WHOLE blob when any string exceeds the bound, and the fallback is the
// legacy per-key layout a blob-era device has never populated — so an over-long field does not save
// a slightly-wrong config, it destroys the entire config at the next boot and lands the board in
// the setup portal with WiFi, MQTT, syslog, NTP, board hardware, OTA channel, language, ENV III,
// both MQTT sources and the weather location gone. Every string was bounded by its own validator or
// by its route's body buffer EXCEPT mb_host, whose route reads a 2048-byte body: a >512-character
// HomeHub address answered {"ok":true} and took the config with it.
//
// Asserted as the IMPLICATION rather than as a list of field lengths — fit() ⟹ it round-trips — so
// a string field added to ConfigBlob and forgotten in fit() fails HERE rather than in someone's
// flash.
static void test_config_blob_strings_fit() {
    const std::string at_max(CONFIG_BLOB_MAX_STR, 'x');
    const std::string over(CONFIG_BLOB_MAX_STR + 1, 'x');

    // Exactly at the bound is legal and must survive the round trip.
    ConfigBlob max_all;
    max_all.wifi_ssid = max_all.wifi_pass = max_all.wifi_ssid_backup = max_all.wifi_pass_backup =
        max_all.mqtt_uri = max_all.mqtt_user = max_all.mqtt_pass = max_all.syslog_host =
            max_all.ntp_server = max_all.mb_host = max_all.ref_temp_name = max_all.ref_temp_topic =
                max_all.ref_temp_path                           = max_all.ref_temp_setpoint_path =
                    max_all.ref_temp_time_path                  = max_all.ref_temp_enabled_path =
                        max_all.ref_temp_hvac_mode_path         = max_all.circulation_name =
                            max_all.circulation_topic           = max_all.circulation_power_path =
                                max_all.circulation_time_path   = max_all.ref_temp_setpoint_topic =
                                    max_all.ref_temp_time_topic = at_max;
    CHECK(config_blob_strings_fit(max_all));
    const std::vector<uint8_t> maxbuf = config_blob_serialize(max_all);
    ConfigBlob                 maxrt;
    CHECK(config_blob_deserialize(maxbuf.data(), maxbuf.size(), maxrt));
    CHECK(maxrt.mb_host == at_max && maxrt.wifi_ssid == at_max &&
          maxrt.circulation_time_path == at_max);

    // ONE field over the bound at a time: fit() must refuse it, AND the blob it would have produced
    // must genuinely be unreadable — that second half is what makes fit() a real guard rather than
    // a stricter opinion. Every string field is exercised, so one missing from fit() fails here.
    std::string ConfigBlob::*const kStrings[] = {
        &ConfigBlob::wifi_ssid,
        &ConfigBlob::wifi_pass,
        &ConfigBlob::wifi_ssid_backup,
        &ConfigBlob::wifi_pass_backup,
        &ConfigBlob::mqtt_uri,
        &ConfigBlob::mqtt_user,
        &ConfigBlob::mqtt_pass,
        &ConfigBlob::syslog_host,
        &ConfigBlob::ntp_server,
        &ConfigBlob::mb_host,
        &ConfigBlob::ref_temp_name,
        &ConfigBlob::ref_temp_topic,
        &ConfigBlob::ref_temp_path,
        &ConfigBlob::ref_temp_setpoint_path,
        &ConfigBlob::ref_temp_time_path,
        &ConfigBlob::ref_temp_enabled_path,
        &ConfigBlob::ref_temp_hvac_mode_path,
        &ConfigBlob::circulation_name,
        &ConfigBlob::circulation_topic,
        &ConfigBlob::circulation_power_path,
        &ConfigBlob::circulation_time_path,
        &ConfigBlob::ref_temp_setpoint_topic,
        &ConfigBlob::ref_temp_time_topic,
    };
    CHECK(sizeof(kStrings) / sizeof(kStrings[0]) == 23);
    for (std::string ConfigBlob::*field : kStrings) {
        ConfigBlob c;
        c.wifi_ssid = "net";
        c.*field    = over;
        CHECK(!config_blob_strings_fit(c));
        const std::vector<uint8_t> buf = config_blob_serialize(c);
        ConfigBlob                 rt;
        rt.wifi_ssid = "sentinel";
        CHECK(!config_blob_deserialize(buf.data(), buf.size(), rt));
        CHECK(rt.wifi_ssid == "sentinel"); // a rejected blob leaves the caller's config untouched
    }

    // The mb_host case reached this through validate(), which now answers 400 instead of letting
    // the save reach config_save's refusal. The other fields cannot: each is bounded before it gets
    // here.
    Config cfg;
    cfg.mb_host = over;
    std::string why;
    CHECK(!validate(cfg, why) && why == "mb_host is too long");
    cfg.mb_host = at_max;
    CHECK(validate(cfg, why));
}

static void test_env3() {
    const uint8_t crc_bytes[2] = {0xbe, 0xef};
    CHECK(env3_sht_crc(crc_bytes, 2) == 0x92);
    uint8_t sht[6]    = {0x66, 0x66, 0, 0x80, 0x00, 0};
    sht[2]            = env3_sht_crc(sht, 2);
    sht[5]            = env3_sht_crc(sht + 3, 2);
    float temperature = 0.0f, humidity = 0.0f;
    CHECK(env3_decode_sht30(sht, temperature, humidity));
    CHECK(std::fabs(temperature - 25.0f) < 0.01f);
    CHECK(std::fabs(humidity - 50.0008f) < 0.01f);
    sht[5] ^= 1;
    CHECK(!env3_decode_sht30(sht, temperature, humidity));
    CHECK(env3_sample_plausible(-40.0f, 0.0f, 300.0f));
    CHECK(env3_sample_plausible(120.0f, 100.0f, 1100.0f));
    CHECK(!env3_sample_plausible(-40.01f, 50.0f, 1000.0f));
    CHECK(!env3_sample_plausible(120.01f, 50.0f, 1000.0f));
    CHECK(!env3_sample_plausible(20.0f, 50.0f, 1100.01f));
    CHECK(env3_sample_implausibility(20.0f, 50.0f, 1000.0f) == nullptr);
    CHECK(std::string(env3_sample_implausibility(-40.01f, 50.0f, 1000.0f)) ==
          "temperature_out_of_range");
    CHECK(std::string(env3_sample_implausibility(20.0f, -0.01f, 1000.0f)) ==
          "humidity_out_of_range");
    CHECK(std::string(env3_sample_implausibility(20.0f, 50.0f, 299.99f)) ==
          "pressure_out_of_range");
    CHECK(std::string(env3_sample_implausibility(std::nanf(""), 50.0f, 1000.0f)) ==
          "temperature_not_finite");
    // The document carries the OBSERVATION plus the two I2C bus-health counters.
    CHECK(build_env3_mqtt_json(true, 20.25f, 45.5f, 1008.75f, 4211, 7) ==
          "{\"temperature_c\":20.25,\"humidity_pct\":45.50,\"pressure_hpa\":1008.75,"
          "\"samples\":4211,\"errors\":7}");
    // THE READINGS are what absence removes — never the counters. A stale or implausible sample
    // omits temperature_c/humidity_pct/pressure_hpa, which is exactly what the HA availability
    // template keys on (`value_json.get('temperature_c') is number`, logic/discovery.hpp), so the
    // three entities still go unavailable and no retained value survives.
    //
    // But `samples`/`errors` describe the LINK, not the air, and they are most informative in
    // precisely this shape: this installation's sensor hangs on a long I2C run to an outdoor
    // enclosure, where a marginal cable is a rising error rate long before it is a gap in the
    // readings. Carried only on the healthy document, the error count would go dark at the instant
    // it became the answer, leaving a consumer unable to tell a failing SHT30 from a disabled
    // accessory, a rebooted board or a broker it lost.
    CHECK(build_env3_mqtt_json(false, 20.25f, 45.5f, 1008.75f, 4211, 7) ==
          "{\"samples\":4211,\"errors\":7}");
    CHECK(build_env3_mqtt_json(true, 20.25f, 45.5f, 1200.0f, 0, 3) ==
          "{\"samples\":0,\"errors\":3}");
    CHECK(build_env3_mqtt_json(true, std::nanf(""), 45.5f, 1008.75f, 0, 3) ==
          "{\"samples\":0,\"errors\":3}");
    // A sensor that never answered at all still reports its zeroes: 0 samples / 0 errors is a TRUE
    // statement about a link that has produced nothing, unlike the stack marks above where 0 would
    // be a false reading of a task that does not exist.
    CHECK(build_env3_mqtt_json(false, 0.0f, 0.0f, 0.0f, 0, 0) == "{\"samples\":0,\"errors\":0}");
    // Numbers, not strings — the same metrics-consumer rule the heartbeat's 1/0 flags follow.
    CHECK(build_env3_mqtt_json(false, 0.0f, 0.0f, 0.0f, 9, 2).find("\"errors\":\"") ==
          std::string::npos);
    // Both COUNTERS, never a pre-divided rate: a store holding numerator and denominator can
    // compute any window's ratio, where a firmware that divides has thrown the numerator away.
    CHECK(build_env3_mqtt_json(true, 20.0f, 50.0f, 1000.0f, 100, 1).find("error_rate") ==
          std::string::npos);
    CHECK(env3_probe_may_try_swapped(Env3ProbeResult::Sht30Unavailable));
    CHECK(env3_probe_may_try_swapped(Env3ProbeResult::Qmp6988Unavailable));
    CHECK(!env3_probe_may_try_swapped(Env3ProbeResult::Ok));
    CHECK(!env3_probe_may_try_swapped(Env3ProbeResult::BusUnavailable));
    CHECK(ENV3_HISTORY_COUNT == 3);
    CHECK(env3_history_index("env3_temperature") == 0);
    CHECK(env3_history_index("env3_humidity") == 1);
    CHECK(env3_history_index("env3_pressure") == 2);
    CHECK(env3_history_index("outdoor_air") == -1);
    CHECK(std::string(ENV3_HISTORIES[0].unit) == "°C");
    CHECK(std::string(ENV3_HISTORIES[1].unit) == "%");
    CHECK(std::string(ENV3_HISTORIES[2].unit) == "hPa");

    uint8_t calibration_raw[25]  = {};
    calibration_raw[0]           = 0x80;
    calibration_raw[18]          = 0x7f;
    calibration_raw[19]          = 0xff;
    calibration_raw[20]          = 0x12;
    calibration_raw[21]          = 0x34;
    calibration_raw[22]          = 0xfe;
    calibration_raw[23]          = 0xdc;
    calibration_raw[24]          = 0xa5;
    const Env3QmpCalibration cal = env3_qmp_calibration(calibration_raw);
    CHECK(cal.a0 == 0x7fff5);
    CHECK(cal.b00 == static_cast<int32_t>(0xfff8000a));
    CHECK(cal.a1 == 3608L * 0x1234 - 1731677965L);
    CHECK(cal.a2 == 16889L * static_cast<int16_t>(0xfedc) - 87619360L);
    const uint8_t qmp_raw[6] = {0x80, 0x00, 0x00, 0x80, 0x00, 0x00};
    float         qmp_temp = 0.0f, pressure = 0.0f;
    env3_decode_qmp6988(cal, qmp_raw, qmp_temp, pressure);
    CHECK(std::isfinite(qmp_temp) && std::isfinite(pressure));

    Config      c;
    std::string why;
    CHECK(env3_config_valid(c, why)); // disabled is always recoverable

    Config proposed       = c;
    proposed.env3_enabled = true;
    proposed.env3_sda     = 5;
    proposed.env3_scl     = 6;
    CHECK(board_env_save_needed(proposed, c));
    CHECK(board_env_reboot_needed(proposed, c));
    CHECK(env3_save_check(c, proposed) == Env3SaveCheck::HardwareProbe);
    Config running = proposed;
    CHECK(!board_env_save_needed(running, proposed));
    CHECK(!board_env_reboot_needed(running, proposed));
    CHECK(env3_save_check(running, proposed) == Env3SaveCheck::RunningSample);
    proposed.env3_scl = 7;
    CHECK(env3_save_check(running, proposed) == Env3SaveCheck::DisableFirst);
    proposed.env3_enabled = false;
    CHECK(env3_save_check(running, proposed) == Env3SaveCheck::None);

    c.env3_enabled = true;
    c.env3_sda     = 5;
    c.env3_scl     = 6;
    CHECK(!env3_config_valid(c, why, 48, false)); // no stated board identity
    CHECK(why.find("M5Stack") != std::string::npos);
    c.board_user_set  = true;
    c.board_preset_id = BoardPresetId::M5StackAtomS3Lite;
    c.led_gpio        = 35;
    c.led_type        = 1;
    c.led_inverted    = false;
    c.btn_gpio        = 41;
    c.btn_active_low  = true;
    CHECK(env3_config_valid(c, why, 48, false));
    c.env3_sda = 38;
    c.env3_scl = 39;
    CHECK(!env3_config_valid(c, why, 48, false)); // GPIO39 is not offered for ENV III
    c.env3_sda = 10;
    CHECK(!env3_config_valid(c, why, 48, false)); // safe chip pad, absent from Atom header
    c.env3_sda = 5;
    c.env3_scl = 6;
    c.rx_pin   = 5;
    CHECK(!env3_config_valid(c, why, 48, false));
    CHECK(why.find("SDA") != std::string::npos);
    c.rx_pin   = 44;
    c.env3_scl = 5;
    CHECK(!env3_config_valid(c, why, 48, false));
    c.env3_scl = 49;
    CHECK(!env3_config_valid(c, why, 48, false));
    c.env3_sda = 2;
    c.env3_scl = 1;
    c.rx_pin   = 1;
    c.tx_pin   = 2;
    CHECK(!env3_config_valid(c, why, 48, false)); // Atom Grove conflicts with X10A 1/2
    c.rx_pin = 44;
    c.tx_pin = 43;
    CHECK(env3_config_valid(c, why, 48, false));
    CHECK(config_reserved_pins(c).claims(c.env3_sda) && config_reserved_pins(c).claims(c.env3_scl));
    c.env3_enabled = false;
    CHECK(!config_reserved_pins(c).claims(c.env3_sda) &&
          !config_reserved_pins(c).claims(c.env3_scl));
    c.env3_enabled = true;
    c.env3_sda     = 35;
    c.env3_scl     = 6;
    CHECK(!env3_config_valid(c, why, 48, false));
    c.env3_sda        = 5;
    c.led_gpio        = 21;
    c.led_type        = 0;
    c.led_inverted    = true;
    c.btn_gpio        = -1;
    c.board_preset_id = BoardPresetId::SeeedXiaoEsp32S3;
    CHECK(!env3_config_valid(c, why, 48, false)); // selected Seeed board is unsupported
    CHECK(why.find("M5Stack") != std::string::npos);

    const Env3Preset*  presets[ENV3_PRESETS_MAX] = {};
    const BoardPreset* atom  = board_preset_by_id(BoardPresetId::M5StackAtomS3Lite);
    const BoardPreset* seeed = board_preset_by_id(BoardPresetId::SeeedXiaoEsp32S3);
    CHECK(env3_presets_offerable(presets, ENV3_PRESETS_MAX, atom, false) == 1);
    CHECK(presets[0]->sda == 2 && presets[0]->scl == 1);
    CHECK(env3_presets_offerable(presets, 1, atom, false, ReservedPins{2}) == 0);
    CHECK(env3_presets_offerable(presets, ENV3_PRESETS_MAX, seeed, false) == 0);
}

static void test_reference_temperature_config() {
    const char* why = nullptr;
    CHECK(reference_temperature_config_valid("Example sensor", "fixture/room-temperature/status",
                                             "temperature.tC", "", "", "", "", 600, &why));
    CHECK(reference_temperature_config_valid(
        "Meross", "meross/mts200b/id/state", "thermostat.current_temperature_c",
        "thermostat.target_temperature_c", "thermostat.read_at", "thermostat.enabled",
        "thermostat.hvac_mode", 600, &why));
    CHECK(reference_temperature_config_valid("Example temperature sensor",
                                             "fixture/room-temperature/status", "tC", "", "", 200,
                                             "", "", "", "", 600, &why));
    CHECK(reference_temperature_config_valid("Example sleeping sensor",
                                             "fixture/sleeping-sensor/status", "", "", "", 220, "",
                                             "", "", "", 600, &why));
    CHECK(reference_temperature_config_valid("Split thermostat", "room/current", "value",
                                             "room/target", "value", 0, "room/time", "read_at", "",
                                             "", 600, &why));
    CHECK(reference_temperature_config_valid("Unverified split thermostat", "room/current",
                                             "temperature..value", "room/target", "target..value",
                                             0, "room/time", "read..at", "", "", 600, &why));
    CHECK(!reference_temperature_config_valid("Ambiguous target", "room/current", "value",
                                              "room/target", "value", 200, "room/time", "read_at",
                                              "", "", 600, &why));
    CHECK(std::string(why) == "Target temperature must be either a fixed value or an MQTT mapping");
    CHECK(!reference_temperature_config_valid("Cold target", "room/current", "value", "", "", 49,
                                              "room/time", "read_at", "", "", 600, &why));
    CHECK(std::string(why) == "Fixed target temperature must be between 5 and 35 degrees C");
    CHECK(!reference_temperature_config_valid("Wildcard time", "room/current", "value", "", "", 200,
                                              "room/+/time", "read_at", "", "", 600, &why));
    CHECK(reference_temperature_config_valid("", "", "", "", "", "", "", 600, &why));
    CHECK(!reference_temperature_config_valid("x", "sensors/+/temperature", "temperature.tC",
                                              "target", "read_at", "", "", 600, &why));
    CHECK(std::string(why) == "MQTT topic must be exact (no + or # wildcard)");
    CHECK(!reference_temperature_config_valid("x", "/sensors/room", "temperature.tC", "target",
                                              "read_at", "", "", 600, &why));
    CHECK(!reference_temperature_config_valid("x", "sensors/room/", "temperature.tC", "target",
                                              "read_at", "", "", 600, &why));
    CHECK(reference_temperature_config_valid("x", "sensors/room", "temperature..tC", "target..c",
                                             "read..at", "", "", 600, &why));
    CHECK(reference_temperature_config_valid("x", "sensors/room", "temperature. tC", "target",
                                             "read_at", "", "", 600, &why));
    CHECK(!reference_temperature_config_valid("x", "sensors/room",
                                              std::string(REF_TEMP_PATH_MAX + 1, 'x'), "target",
                                              "read_at", "", "", 600, &why));
    CHECK(std::string(why) == "JSON path is too long");
    CHECK(!reference_temperature_config_valid("x", "sensors/room", "temperature.tC", "target",
                                              "read_at", "", "", 9, &why));
    CHECK(std::string(why) == "Maximum age must be between 10 and 3600 seconds");
    CHECK(!reference_temperature_config_valid(std::string(REF_TEMP_NAME_MAX + 1, 'x'),
                                              "sensors/room", "temperature.tC", "target", "read_at",
                                              "", "", 600, &why));

    int64_t unix_s = -1;
    CHECK(reference_parse_rfc3339("2026-08-02T08:35:12.792902415Z", unix_s));
    CHECK(unix_s == 1785659712);
    int64_t offset_s = -1;
    CHECK(reference_parse_rfc3339("2026-08-02T10:35:12+02:00", offset_s));
    CHECK(offset_s == unix_s);
    CHECK(reference_parse_rfc3339("2024-02-29T12:04:56Z", unix_s));
    CHECK(!reference_parse_rfc3339("2023-02-29T12:04:56Z", unix_s));
    CHECK(!reference_parse_rfc3339("2026-08-02T08:35:12", unix_s)); // timezone is mandatory
    CHECK(!reference_parse_rfc3339("2026-08-02T08:35:12.1234567890Z", unix_s));

    ReferenceFreshness fresh = reference_freshness(true, true, true, 1000, 0, 1030, 0, 600);
    CHECK(fresh.fresh && fresh.age_known && fresh.age_s == 30);
    ReferenceFreshness stale = reference_freshness(true, true, true, 1000, 0, 1701, 0, 600);
    CHECK(!stale.fresh && stale.age_known && stale.age_s == 701 &&
          std::string(stale.reason) == "stale");
    ReferenceFreshness replay = reference_freshness(true, true, false, -1, 5000, 2000, 6000, 600);
    CHECK(!replay.fresh && !replay.age_known &&
          std::string(replay.reason) == "retained_without_timestamp");
    ReferenceFreshness live = reference_freshness(true, false, false, -1, 5000, -1, 65000, 600);
    CHECK(live.fresh && live.age_s == 60);
    ReferenceFreshness unsynced = reference_freshness(true, false, true, 1000, 0, -1, 0, 600);
    CHECK(!unsynced.fresh && std::string(unsynced.reason) == "clock_unsynced");
    ReferenceFreshness future = reference_freshness(true, false, true, 1100, 0, 1000, 0, 600);
    CHECK(!future.fresh && std::string(future.reason) == "future_timestamp");

    ReferenceRoomRaw raw;
    raw.configured                     = true;
    raw.has_temperature                = true;
    raw.temperature_c                  = 20.5;
    raw.has_source_time                = true;
    raw.setpoint_mapped                = true;
    raw.has_setpoint                   = true;
    raw.setpoint_c                     = 22.0;
    raw.enabled_mapped                 = true;
    raw.has_enabled                    = true;
    raw.enabled                        = true;
    raw.hvac_mode_mapped               = true;
    raw.has_hvac_mode                  = true;
    raw.hvac_mode                      = "heat";
    const ReferenceRoomSample eligible = reference_room_sample(raw, fresh);
    CHECK(eligible.temperature_valid && eligible.setpoint_valid && eligible.control_eligible);
    CHECK(eligible.has_room_error && eligible.room_error_k == 1.5);
    CHECK(eligible.reason == ReferenceRoomReason::Eligible);
    CHECK(std::string(reference_room_reason_name(eligible.reason)) == "eligible");

    raw.enabled                        = false;
    const ReferenceRoomSample disabled = reference_room_sample(raw, fresh);
    CHECK(disabled.temperature_valid && disabled.setpoint_valid && !disabled.control_eligible);
    CHECK(!disabled.has_room_error && disabled.reason == ReferenceRoomReason::Disabled);
    raw.enabled   = true;
    raw.hvac_mode = "cool";
    CHECK(reference_room_sample(raw, fresh).reason == ReferenceRoomReason::NonHeatingMode);
    raw.hvac_mode    = "heat";
    raw.has_setpoint = false;
    CHECK(reference_room_sample(raw, fresh).reason == ReferenceRoomReason::MissingSetpoint);
    raw.has_setpoint = true;
    raw.setpoint_c   = 36.0;
    CHECK(reference_room_sample(raw, fresh).reason == ReferenceRoomReason::SetpointOutOfRange);
    raw.setpoint_c    = 22.0;
    raw.temperature_c = 4.9;
    CHECK(reference_room_sample(raw, fresh).reason == ReferenceRoomReason::TemperatureOutOfRange);
    raw.temperature_c                      = 20.5;
    raw.has_source_time                    = false;
    const ReferenceRoomSample live_arrival = reference_room_sample(raw, live);
    CHECK(live_arrival.control_eligible && live_arrival.reason == ReferenceRoomReason::Eligible);
    CHECK(reference_room_sample(raw, replay).reason ==
          ReferenceRoomReason::RetainedWithoutTimestamp);
    raw.has_source_time = true;
    CHECK(reference_room_sample(raw, stale).reason == ReferenceRoomReason::Stale);
    raw.payload_valid  = false;
    raw.payload_reason = ReferenceRoomReason::BackwardTimestamp;
    CHECK(reference_room_sample(raw, fresh).reason == ReferenceRoomReason::BackwardTimestamp);
}

static void test_circulation_source() {
    const char* why = nullptr;
    CHECK(circulation_source_config_valid("DHW circulation", "fixture/circulation/status", "apower",
                                          "aenergy.minute_ts", 120, 30, 10, 60, &why));
    CHECK(circulation_source_config_valid("", "", "", "", 120, 30, 10, 60, &why));
    CHECK(!circulation_source_config_valid("pump", "fixture/+/status", "apower",
                                           "aenergy.minute_ts", 120, 30, 10, 60, &why));
    CHECK(!circulation_source_config_valid("pump", "fixture/status", "apower", "aenergy.minute_ts",
                                           120, 10, 10, 60, &why));
    CHECK(std::string(why) == "ON threshold must be greater than OFF threshold");
    CHECK(!circulation_source_config_valid("pump", "fixture/status", "apower", "aenergy.minute_ts",
                                           9, 30, 10, 60, &why));
    CHECK(!circulation_source_config_valid("pump", "fixture/status", "apower", "aenergy.minute_ts",
                                           120, 30, 10, 0, &why));

    CHECK(circulation_power_class(0.0, 30, 10) == CirculationPowerState::Off);
    CHECK(circulation_power_class(1.0, 30, 10) == CirculationPowerState::Off);
    CHECK(circulation_power_class(2.0, 30, 10) == CirculationPowerState::Unknown);
    CHECK(circulation_power_class(3.0, 30, 10) == CirculationPowerState::On);
    CHECK(circulation_power_class(5.7, 30, 10) == CirculationPowerState::On);
    CHECK(circulation_power_class(-0.1, 30, 10) == CirculationPowerState::Unknown);

    CirculationPowerTracker tracker;
    tracker.observe(5.7, 1000, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::Unknown); // one retained sample is no proof
    tracker.observe(5.6, 60'999, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::Unknown);
    tracker.observe(5.6, 61'000, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::On);
    tracker.observe(2.0, 62'000, 30, 10, 60); // hysteresis preserves proof
    CHECK(tracker.confirmed == CirculationPowerState::On);
    tracker.observe(0.0, 70'000, 30, 10, 60);
    tracker.observe(0.1, 130'000, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::Off);

    tracker.reset();
    tracker.observe(0.0, 1'000, 30, 10, 60);
    tracker.observe(0.1, 60'999, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::Unknown);
    tracker.observe(0.0, 61'000, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::Off);

    // The live Wilo witness is a pulsed load: roughly five seconds above 3 W followed by about
    // 27 seconds at 0 W. The pulse train is operating evidence, not a new unconfirmed transition on
    // every edge. It still takes the configured minute to prove ON, and a full quiet minute to turn
    // the last confirmed ON state back to OFF.
    tracker.reset();
    tracker.observe(5.5, 1'000, 30, 10, 60);
    tracker.observe(0.0, 6'000, 30, 10, 60);
    tracker.observe(5.4, 33'000, 30, 10, 60);
    tracker.observe(0.0, 38'000, 30, 10, 60);
    tracker.observe(2.0, 45'000, 30, 10, 60); // hysteresis cannot prove OFF
    tracker.observe(5.3, 65'000, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::On);
    tracker.observe(0.0, 70'000, 30, 10, 60);
    tracker.observe(0.0, 129'999, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::On);
    tracker.observe(0.0, 130'000, 30, 10, 60);
    CHECK(tracker.confirmed == CirculationPowerState::Off);
}

static void test_heating_curve_diagnosis() {
    using namespace daik::logic;

    auto ready = [] {
        HeatingCurveInputs in;
        in.armed                 = true;
        in.room_control_eligible = true;
        in.room_error_k          = 0.6;
        in.x10a_connected        = true;
        in.homehub_connected     = true;
        in.plant_gate_known      = true;
        in.plant_gate_active     = true;
        in.heating_mode_known    = true;
        in.heating_mode_active   = true;
        in.forecast_available    = true;
        in.now_ms                = 0;
        in.now_unix_s            = 1770000000;
        in.room_has_source_time  = true;
        in.room_source_unix_s    = 1234;
        in.room_age_known        = true;
        in.room_age_s            = 5;
        return in;
    };

    HeatingCurveDiagnosis      diagnosis;
    HeatingCurveInputs         in; // default: no room source configured, so nothing is armed
    const HeatingCurveSnapshot off = diagnosis.evaluate(in);
    CHECK(!off.armed && off.state == HeatingCurveState::Off);
    CHECK(off.reason == HeatingCurveReason::Disabled && !off.has_last_sample);
    CHECK(off.evaluations == 0);
    CHECK(diagnosis.evaluate(in).evaluations == 0); // unarmed diagnosis analyses nothing

    in                          = ready();
    HeatingCurveSnapshot sample = diagnosis.evaluate(in);
    CHECK(sample.state == HeatingCurveState::Recording &&
          sample.reason == HeatingCurveReason::SampleRecorded);
    CHECK(sample.sample_eligible && sample.has_current_room_error && sample.has_last_sample);
    CHECK(approx(sample.current_room_error_k, 0.6) && approx(sample.last_sample_room_error_k, 0.6));
    CHECK(sample.last_sample_unix_s == 1770000000 && sample.sequence == 1 && sample.samples == 1 &&
          sample.room_source_unix_s == 1234 && sample.room_age_s == 5);
    // No ENV III configured: the event records, and the outdoor axis is ABSENT rather than 0 C.
    CHECK(!sample.has_outdoor_temperature && !sample.has_last_sample_outdoor);

    in.now_ms = 1000;
    in.now_unix_s++;
    in.room_error_k              = 1.2345;
    HeatingCurveSnapshot cadence = diagnosis.evaluate(in);
    CHECK(cadence.state == HeatingCurveState::Recording &&
          cadence.reason == HeatingCurveReason::SamplingInterval);
    CHECK(cadence.sample_eligible && approx(cadence.current_room_error_k, 1.2345));
    CHECK(cadence.has_last_sample && approx(cadence.last_sample_room_error_k, 0.6) &&
          cadence.sequence == 1 && cadence.samples == 1);

    // The stored value is the exact raw error — no deadband, rounding, clamp or slew operation.
    in.now_ms       = HEATING_CURVE_SAMPLE_CADENCE_MS;
    in.now_unix_s   = 1770001800;
    in.room_error_k = -2.3456;
    sample          = diagnosis.evaluate(in);
    CHECK(sample.reason == HeatingCurveReason::SampleRecorded && sample.sequence == 2);
    CHECK(approx(sample.last_sample_room_error_k, -2.3456) &&
          sample.last_sample_unix_s == 1770001800);

    // The optional ENV III outdoor axis (#env3). It is CONTEXT, never a gate, and the value stored
    // with an event is the one that stood AT the event.
    {
        HeatingCurveDiagnosis outdoor;
        HeatingCurveInputs    oi = ready();
        oi.outdoor               = outdoor_env3_evidence(true, true, -4.25);
        HeatingCurveSnapshot s   = outdoor.evaluate(oi);
        CHECK(s.reason == HeatingCurveReason::SampleRecorded);
        CHECK(s.has_outdoor_temperature && approx(s.outdoor_temperature_c, -4.25));
        CHECK(s.has_last_sample_outdoor && approx(s.last_sample_outdoor_temperature_c, -4.25));

        // Live value moves between events; the recorded event keeps the temperature it was taken
        // at.
        oi.now_ms = 1000;
        oi.now_unix_s++;
        oi.outdoor = outdoor_env3_evidence(true, true, 3.5);
        s          = outdoor.evaluate(oi);
        CHECK(s.reason == HeatingCurveReason::SamplingInterval);
        CHECK(approx(s.outdoor_temperature_c, 3.5) &&
              approx(s.last_sample_outdoor_temperature_c, -4.25));

        // Sensor lost before the NEXT event: the event still records, and the stale outdoor value
        // is CLEARED rather than carried forward under a fresh timestamp.
        oi.now_ms       = HEATING_CURVE_SAMPLE_CADENCE_MS;
        oi.now_unix_s   = 1770001800;
        oi.outdoor      = {};
        oi.room_error_k = 0.9;
        s               = outdoor.evaluate(oi);
        CHECK(s.reason == HeatingCurveReason::SampleRecorded && s.sequence == 2);
        CHECK(approx(s.last_sample_room_error_k, 0.9));
        CHECK(!s.has_outdoor_temperature && !s.has_last_sample_outdoor &&
              s.last_sample_outdoor_temperature_c == 0.0);

        // A non-finite reading is absent, not a number: NaN must never reach a recorded event.
        HeatingCurveDiagnosis nan_case;
        HeatingCurveInputs    ni = ready();
        ni.outdoor =
            OutdoorEvidence{true, OutdoorSource::Env3, std::numeric_limits<double>::quiet_NaN()};
        s = nan_case.evaluate(ni);
        CHECK(s.reason == HeatingCurveReason::SampleRecorded);
        CHECK(!s.has_outdoor_temperature && !s.has_last_sample_outdoor);

        // NEVER a gate: with the sensor present but every other input identical, the state, reason
        // and counters must match the run without it — otherwise a board without ENV III would
        // sample differently from one with it.
        HeatingCurveDiagnosis with, without;
        HeatingCurveInputs    wi     = ready();
        wi.outdoor                   = outdoor_env3_evidence(true, true, 7.0);
        const HeatingCurveSnapshot a = with.evaluate(wi);
        const HeatingCurveSnapshot b = without.evaluate(ready());
        CHECK(a.state == b.state && a.reason == b.reason && a.armed == b.armed);
        CHECK(a.sample_eligible == b.sample_eligible && a.sequence == b.sequence &&
              a.samples == b.samples && a.holds == b.holds && a.blocks == b.blocks);
        CHECK(approx(a.last_sample_room_error_k, b.last_sample_room_error_k));

        // Plant and accessory axes remain independent and name their own provenance. Losing either
        // on the next event clears only that source's event value; neither changes eligibility.
        HeatingCurveDiagnosis both_sources;
        HeatingCurveInputs    bi = ready();
        bi.outdoor               = outdoor_env3_evidence(true, true, 6.5);
        bi.plant_outdoor         = outdoor_homehub_evidence(true, true, 5.75);
        s                        = both_sources.evaluate(bi);
        CHECK(s.has_last_sample_outdoor && s.last_sample_outdoor_source == OutdoorSource::Env3);
        CHECK(s.has_last_sample_plant_outdoor &&
              s.last_sample_plant_outdoor_source == OutdoorSource::HomeHub);
        CHECK(approx(s.last_sample_plant_outdoor_temperature_c, 5.75));
        bi.now_ms = HEATING_CURVE_SAMPLE_CADENCE_MS;
        bi.now_unix_s += 1800;
        bi.plant_outdoor = {};
        s                = both_sources.evaluate(bi);
        CHECK(s.reason == HeatingCurveReason::SampleRecorded && s.has_last_sample_outdoor);
        CHECK(!s.has_last_sample_plant_outdoor &&
              s.last_sample_plant_outdoor_source == OutdoorSource::None);

        // Disarming clears the event, and the outdoor value must not outlive it either.
        HeatingCurveInputs         off_in; // unarmed
        const HeatingCurveSnapshot cleared = with.evaluate(off_in);
        CHECK(!cleared.has_last_sample && !cleared.has_last_sample_outdoor &&
              cleared.last_sample_outdoor_temperature_c == 0.0);
    }

    // The shared outdoor freshness contract. X10A page 0x20 is NOT fresh merely because its row
    // answered or `held` happened to be false: unknown/stopped RPS both refuse it. HomeHub input 44
    // instead follows the current TCP session, and ENV III follows its own fresh+plausible pair.
    {
        CHECK(!outdoor_x10a_evidence(true, false, false, 4.0).available);
        CHECK(!outdoor_x10a_evidence(true, true, false, 4.0).available);
        const OutdoorEvidence x10a = outdoor_x10a_evidence(true, true, true, -3.5);
        CHECK(x10a.available && x10a.source == OutdoorSource::X10a &&
              approx(x10a.temperature_c, -3.5));
        CHECK(!outdoor_homehub_evidence(true, false, 8.0).available);
        CHECK(outdoor_homehub_evidence(true, true, 8.0).source == OutdoorSource::HomeHub);
        CHECK(!outdoor_env3_evidence(true, false, 8.0).available);
        CHECK(outdoor_env3_evidence(true, true, 8.0).source == OutdoorSource::Env3);
        CHECK(!outdoor_homehub_evidence(true, true, std::numeric_limits<double>::quiet_NaN())
                   .available);
    }

    HeatingCurveDiagnosis degraded_diagnosis;
    in                            = ready();
    in.forecast_available         = false;
    HeatingCurveSnapshot degraded = degraded_diagnosis.evaluate(in);
    CHECK(degraded.state == HeatingCurveState::Degraded &&
          degraded.reason == HeatingCurveReason::ForecastUnavailable);
    CHECK(degraded.has_last_sample && approx(degraded.last_sample_room_error_k, 0.6));

    HeatingCurveDiagnosis gates;
    in                   = ready();
    in.homehub_connected = false;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::HomeHubUnavailable);
    in                  = ready();
    in.plant_gate_known = false;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::PlantGateUnknown);
    in                        = ready();
    in.plant_gate_active      = false;
    HeatingCurveSnapshot hold = gates.evaluate(in);
    CHECK(hold.state == HeatingCurveState::Hold &&
          hold.reason == HeatingCurveReason::PlantInactive);
    CHECK(!hold.sample_eligible && hold.holds == 1);
    in                    = ready();
    in.heating_mode_known = false;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::HeatingModeUnknown);
    in                     = ready();
    in.heating_mode_active = false;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::NonHeatingMode);
    in                       = ready();
    in.room_control_eligible = false;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::RoomUnavailable);
    in                = ready();
    in.x10a_connected = false;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::X10aUnavailable);
    in            = ready();
    in.now_unix_s = -1;
    CHECK(gates.evaluate(in).reason == HeatingCurveReason::ClockInvalid);

    // THE ORDER OF THOSE GATES IS ITSELF THE CONTRACT: an idle plant is HOLD even when the room
    // source is ineligible, because outside the heating season BOTH are true at once — a room
    // thermostat switched off for the summer is not control-eligible — and answering
    // "room input unavailable" turns a plant resting exactly as it should into a standing fault.
    // The reference installation reported thousands of blocks in August with nothing wrong.
    HeatingCurveDiagnosis seasonal;
    in                                = ready();
    in.plant_gate_active              = false;
    in.room_control_eligible          = false;
    const HeatingCurveSnapshot summer = seasonal.evaluate(in);
    CHECK(summer.state == HeatingCurveState::Hold &&
          summer.reason == HeatingCurveReason::PlantInactive);
    CHECK(summer.holds == 1 && summer.blocks == 0);
    // While the plant IS heating the same ineligible source is a real block, and still says so.
    in                                 = ready();
    in.room_control_eligible           = false;
    const HeatingCurveSnapshot heating = seasonal.evaluate(in);
    CHECK(heating.state == HeatingCurveState::Blocked &&
          heating.reason == HeatingCurveReason::RoomUnavailable);
    // A down HomeHub outranks the gate it is the only source of: an unknown gate is never read as
    // an idle plant.
    in                   = ready();
    in.homehub_connected = false;
    in.plant_gate_active = false;
    CHECK(seasonal.evaluate(in).reason == HeatingCurveReason::HomeHubUnavailable);

    // A transient plant/data block must not create a fresh event on recovery. The absolute event
    // timestamp + boot-local sequence stay durable until the 30-minute sampling interval expires.
    HeatingCurveDiagnosis recovery;
    in              = ready();
    in.room_error_k = 3.0;
    CHECK(recovery.evaluate(in).sequence == 1);
    in.now_ms         = 1000;
    in.x10a_connected = false;
    CHECK(recovery.evaluate(in).state == HeatingCurveState::Blocked);
    in                               = ready();
    in.now_ms                        = 2000;
    in.room_error_k                  = -3.0;
    HeatingCurveSnapshot after_block = recovery.evaluate(in);
    CHECK(after_block.reason == HeatingCurveReason::SamplingInterval && after_block.sequence == 1 &&
          approx(after_block.last_sample_room_error_k, 3.0));
    in.now_ms            = 3000;
    in.plant_gate_active = false;
    CHECK(recovery.evaluate(in).state == HeatingCurveState::Hold);
    in              = ready();
    in.now_ms       = 4000;
    in.room_error_k = 3.0;
    CHECK(recovery.evaluate(in).reason == HeatingCurveReason::SamplingInterval);
    in.now_ms = 1999;
    CHECK(recovery.evaluate(in).reason == HeatingCurveReason::ClockInvalid);

    // Deleting the required source disarms and clears sample memory. Re-configuring records at
    // once, while the sequence/counters remain useful boot-local evidence.
    HeatingCurveDiagnosis rearm;
    in = ready();
    CHECK(rearm.evaluate(in).sequence == 1);
    in.armed  = false;
    in.now_ms = 10;
    CHECK(rearm.evaluate(in).state == HeatingCurveState::Off && !rearm.snapshot().has_last_sample);
    in        = ready();
    in.now_ms = 20;
    CHECK(rearm.evaluate(in).sequence == 2 && rearm.snapshot().has_last_sample);

    // ARMING requires the explicit master diagnostics opt-in plus every visible source dependency.
    // This remains independent of the retired controller mode: there is no /set_dynamic_lwt and no
    // actuator. Explicitly deleting HomeHub disarms the dependent sampler too.
    Config dependencies;
    CHECK(!heating_curve_diagnosis_armed(dependencies));
    dependencies.mqtt_uri               = "mqtt://broker";
    dependencies.ref_temp_topic         = "room";
    dependencies.ref_temp_path          = "current";
    dependencies.ref_temp_setpoint_path = "target";
    dependencies.ref_temp_time_path     = "read_at";
    dependencies.mb_host                = "homehub.local";
    CHECK(!heating_curve_diagnosis_armed(dependencies)); // diagnostics are opt-in
    dependencies.diagnostics_enabled = true;
    CHECK(heating_curve_diagnosis_armed(dependencies)); // forecast location is optional
    Config arrival_timed = dependencies;
    arrival_timed.ref_temp_time_path.clear();
    CHECK(heating_curve_diagnosis_armed(arrival_timed)); // live non-retained MQTT arrival is enough
    dependencies.weather_enabled = true;
    CHECK(heating_curve_diagnosis_armed(dependencies));
    dependencies.mb_host = "";
    CHECK(!heating_curve_diagnosis_armed(dependencies)); // explicit HomeHub opt-out disarms it
    dependencies.mb_host = "homehub.local";
    for (std::string Config::*field : {&Config::mqtt_uri, &Config::ref_temp_topic,
                                       &Config::ref_temp_path, &Config::ref_temp_setpoint_path}) {
        Config one = dependencies;
        (one.*field).clear();
        CHECK(!heating_curve_diagnosis_armed(one)); // any deleted required input disarms it
    }
    Config no_weather          = dependencies;
    no_weather.weather_enabled = false;
    CHECK(heating_curve_diagnosis_armed(no_weather));
    CHECK(diagnostics_next_generation(0) == 1);
    CHECK(diagnostics_next_generation(41) == 42);
    CHECK(diagnostics_next_generation(UINT32_MAX) == 1);

    // ── The snapshot the evaluator never touched ────────────────────────────────────────────────
    // The sampler lives on the MQTT publish task, which safe mode never creates (main.cpp skips
    // every optional consumer). /status still derives `armed` from the configuration at request
    // time, so it published armed=true beside the evaluator's default Off/Disabled — and "disabled"
    // is the evaluator's word for "no room source is mapped", which is exactly what the reader has
    // already done. The UI, keying on the state, then told them to set up the source configured one
    // row below.
    CHECK(
        heating_curve_sampler_inactive(true, HeatingCurveState::Off, HeatingCurveReason::Disabled));
    CHECK(
        heating_curve_reported_reason(true, HeatingCurveState::Off, HeatingCurveReason::Disabled) ==
        HeatingCurveReason::SamplerInactive);
    CHECK(std::string(heating_curve_reason_name(HeatingCurveReason::SamplerInactive)) ==
          "sampler_inactive");
    CHECK(static_cast<unsigned>(HeatingCurveReason::SamplerInactive) == 14);

    // NOT armed + Off/Disabled is the ordinary unconfigured device (and, since arming also requires
    // a broker, a fully-mapped room source whose broker was cleared). It keeps the evaluator's
    // word.
    CHECK(!heating_curve_sampler_inactive(false, HeatingCurveState::Off,
                                          HeatingCurveReason::Disabled));
    CHECK(heating_curve_reported_reason(false, HeatingCurveState::Off,
                                        HeatingCurveReason::Disabled) ==
          HeatingCurveReason::Disabled);
    // A RUNNING evaluator assigns s_.armed before any gate, so it can never produce armed + Off;
    // every state it does produce must pass through untouched, whatever the configuration says
    // about arming.
    for (bool armed_cfg : {false, true}) {
        for (HeatingCurveState st : {HeatingCurveState::Recording, HeatingCurveState::Hold,
                                     HeatingCurveState::Degraded, HeatingCurveState::Blocked}) {
            for (HeatingCurveReason rs :
                 {HeatingCurveReason::SampleRecorded, HeatingCurveReason::SamplingInterval,
                  HeatingCurveReason::RoomUnavailable, HeatingCurveReason::HomeHubUnavailable,
                  HeatingCurveReason::PlantInactive, HeatingCurveReason::NonHeatingMode}) {
                CHECK(heating_curve_reported_reason(armed_cfg, st, rs) == rs);
            }
        }
    }
}

static void test_weather_forecast_contract() {
    int64_t fetched = -1, decision = -1;
    CHECK(reference_parse_rfc3339("2026-08-03T10:30:00Z", fetched));
    CHECK(reference_parse_rfc3339("2026-08-03T11:00:00Z", decision));
    WeatherForecastSample sample{1,   "open-meteo", "icon_seamless", -1, fetched, decision,
                                 5.4, 82.0};
    WeatherValidation     valid = weather_validate(sample, fetched + 20);
    CHECK(valid.valid && std::string(valid.reason) == "ok");

    WeatherLocationParse location = weather_location_parse("12.345678", "23.456789");
    CHECK(location.valid && location.enabled && location.latitude_e6 == 12345678 &&
          location.longitude_e6 == 23456789);
    CHECK(weather_coordinate_format_e6(location.latitude_e6) == "12.345678");
    CHECK(weather_coordinate_format_e6(-1) == "-0.000001");
    CHECK(weather_location_parse("12,345678", "23,456789").valid);
    int32_t parsed_coordinate = 0;
    CHECK(weather_coordinate_parse_e6("-12,5", WEATHER_LATITUDE_MIN_E6, WEATHER_LATITUDE_MAX_E6,
                                      parsed_coordinate) &&
          parsed_coordinate == -12500000);
    CHECK(!weather_coordinate_parse_e6("", WEATHER_LATITUDE_MIN_E6, WEATHER_LATITUDE_MAX_E6,
                                       parsed_coordinate));
    CHECK(!weather_coordinate_parse_e6("12345678901234567", WEATHER_LONGITUDE_MIN_E6,
                                       WEATHER_LONGITUDE_MAX_E6, parsed_coordinate));
    CHECK(!weather_coordinate_parse_e6("181", WEATHER_LONGITUDE_MIN_E6, WEATHER_LONGITUDE_MAX_E6,
                                       parsed_coordinate));
    CHECK(!weather_coordinate_parse_e6("12.", WEATHER_LATITUDE_MIN_E6, WEATHER_LATITUDE_MAX_E6,
                                       parsed_coordinate));
    CHECK(weather_location_parse("", "").valid && !weather_location_parse("", "").enabled);
    CHECK(!weather_location_parse("52.5", "").valid);
    CHECK(!weather_location_parse("90.000001", "13.4").valid);
    CHECK(!weather_location_parse("52.5", "180.000001").valid);
    CHECK(!weather_location_parse("52.5e0", "13.4").valid);
    CHECK(!weather_location_parse("+52.5", "13.4").valid);
    CHECK(!weather_location_parse("52.5&x=1", "13.4").valid);
    CHECK(!weather_location_parse("52.1234567", "13.4").valid);
    CHECK(weather_location_e6_valid(true, 90000000, -180000000));
    CHECK(weather_location_e6_valid(false, 0, 0));
    CHECK(!weather_location_e6_valid(false, 1, 0));
    CHECK(!weather_location_e6_valid(false, 0, 1));
    CHECK(!weather_location_e6_valid(true, WEATHER_LATITUDE_MIN_E6 - 1, 0));
    CHECK(!weather_location_e6_valid(true, WEATHER_LATITUDE_MAX_E6 + 1, 0));
    CHECK(!weather_location_e6_valid(true, 0, WEATHER_LONGITUDE_MIN_E6 - 1));
    CHECK(!weather_location_e6_valid(true, 0, WEATHER_LONGITUDE_MAX_E6 + 1));
    CHECK(weather_reason_valid("fetch_failed"));
    CHECK(weather_reason_valid("payload_invalid"));
    CHECK(weather_reason_valid("incomplete_horizon"));
    CHECK(!weather_reason_valid("provider said something arbitrary"));

    for (WeatherTaskStartState state :
         {WeatherTaskStartState::NotStarted, WeatherTaskStartState::Available,
          WeatherTaskStartState::DeadlineUnavailable, WeatherTaskStartState::TaskStartFailed}) {
        CHECK(!weather_task_failure(false, true, state));
        CHECK(!weather_task_failure(true, false, state));
    }
    // Keep these two values runtime-visible so coverage proves both the successful worker state and
    // the defensive unknown-enum fallback rather than constant-folding the constexpr helper.
    volatile uint8_t task_state_raw = static_cast<uint8_t>(WeatherTaskStartState::Available);
    CHECK(!weather_task_failure(true, true, static_cast<WeatherTaskStartState>(task_state_raw)));
    task_state_raw = static_cast<uint8_t>(WeatherTaskStartState::DeadlineUnavailable);
    WeatherTaskFailure task_failure =
        weather_task_failure(true, true, static_cast<WeatherTaskStartState>(task_state_raw));
    CHECK(task_failure && std::string(task_failure.reason) == "deadline_unavailable" &&
          std::string(task_failure.error) == "deadline_unavailable");
    task_state_raw = static_cast<uint8_t>(WeatherTaskStartState::TaskStartFailed);
    task_failure =
        weather_task_failure(true, true, static_cast<WeatherTaskStartState>(task_state_raw));
    CHECK(task_failure && std::string(task_failure.reason) == "task_start_failed" &&
          std::string(task_failure.error) == "out_of_memory");
    task_state_raw = static_cast<uint8_t>(WeatherTaskStartState::NotStarted);
    task_failure =
        weather_task_failure(true, true, static_cast<WeatherTaskStartState>(task_state_raw));
    CHECK(task_failure && std::string(task_failure.reason) == "task_unavailable" &&
          std::string(task_failure.error) == "task_unavailable");
    task_state_raw = 0xff;
    task_failure =
        weather_task_failure(true, true, static_cast<WeatherTaskStartState>(task_state_raw));
    CHECK(task_failure && std::string(task_failure.reason) == "task_unavailable" &&
          std::string(task_failure.error) == "task_unavailable");

    uint64_t refresh_started = 0, refresh_completed = 0, refresh_success = 0;
    CHECK(weather_refresh_claim(1, refresh_completed, refresh_started) == 1);
    CHECK(refresh_started == 1);
    // Interleaving: A commits its value, a source transaction then cancels the still-open token,
    // and A's late finish must not turn that final cancellation into success for B.
    weather_refresh_cancel_outstanding(1, refresh_completed);
    CHECK(refresh_completed == 1 && refresh_success == 0);
    CHECK(
        !weather_refresh_complete(1, refresh_started, 1, true, refresh_completed, refresh_success));
    CHECK(refresh_completed == 1 && refresh_success == 0);
    CHECK(weather_refresh_claim(1, refresh_completed, refresh_started) == 0);
    CHECK(weather_refresh_claim(2, refresh_completed, refresh_started) == 2);
    CHECK(
        weather_refresh_complete(2, refresh_started, 2, true, refresh_completed, refresh_success));
    CHECK(refresh_completed == 2 && refresh_success == 2);
    weather_refresh_cancel_outstanding(2, refresh_completed);
    CHECK(refresh_completed == 2 && refresh_success == 2);
    CHECK(
        !weather_refresh_complete(2, refresh_started, 0, true, refresh_completed, refresh_success));
    CHECK(
        !weather_refresh_complete(3, refresh_started, 3, true, refresh_completed, refresh_success));

    WeatherForecastSample bad = sample;
    bad.version               = 2;
    CHECK(!weather_validate(bad).valid &&
          std::string(weather_validate(bad).reason) == "unsupported_version");
    bad          = sample;
    bad.provider = "another-provider";
    CHECK(std::string(weather_validate(bad).reason) == "invalid_provider");
    bad                = sample;
    bad.fetched_unix_s = -1;
    CHECK(std::string(weather_validate(bad).reason) == "missing_timestamp");
    bad                 = sample;
    bad.decision_unix_s = -1;
    CHECK(std::string(weather_validate(bad).reason) == "missing_timestamp");
    bad       = sample;
    bad.model = "best_match";
    CHECK(std::string(weather_validate(bad).reason) == "invalid_model");
    bad                 = sample;
    bad.decision_unix_s = bad.fetched_unix_s + 3601;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_decision_time");
    bad                 = sample;
    bad.fetched_unix_s  = fetched + WEATHER_FUTURE_TOLERANCE_S + 1;
    bad.decision_unix_s = bad.fetched_unix_s;
    CHECK(std::string(weather_validate(bad, fetched).reason) == "future_fetch");
    bad                   = sample;
    bad.outdoor_mean_2h_c = std::nan("");
    CHECK(std::string(weather_validate(bad).reason) == "invalid_outdoor_mean");
    bad                   = sample;
    bad.outdoor_mean_2h_c = WEATHER_OUTDOOR_MIN_C - 0.1;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_outdoor_mean");
    bad                   = sample;
    bad.outdoor_mean_2h_c = WEATHER_OUTDOOR_MAX_C + 0.1;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_outdoor_mean");
    bad                       = sample;
    bad.solar_energy_2h_wh_m2 = -0.1;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_solar_energy");
    bad                       = sample;
    bad.solar_energy_2h_wh_m2 = std::nan("");
    CHECK(std::string(weather_validate(bad).reason) == "invalid_solar_energy");
    bad                       = sample;
    bad.solar_energy_2h_wh_m2 = WEATHER_SOLAR_MAX_WH_M2 + 0.1;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_solar_energy");
    bad              = sample;
    bad.hourly_count = 1;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_hourly_count");
    bad              = sample;
    bad.hourly_count = WEATHER_HOURLY_CAP + 1;
    CHECK(std::string(weather_validate(bad).reason) == "invalid_hourly_count");

    WeatherFreshness no_value = weather_freshness(false, -1, fetched);
    CHECK(!no_value.fresh && !no_value.age_known && no_value.age_s == 0 &&
          std::string(no_value.reason) == "no_value");
    WeatherFreshness fresh = weather_freshness(true, 1000, 1000 + WEATHER_MAX_AGE_S);
    CHECK(fresh.fresh && fresh.age_known && fresh.age_s == WEATHER_MAX_AGE_S);
    WeatherFreshness tolerated_future = weather_freshness(true, 1050, 1000);
    CHECK(tolerated_future.fresh && tolerated_future.age_known && tolerated_future.age_s == 0);
    WeatherFreshness stale = weather_freshness(true, 1000, 1001 + WEATHER_MAX_AGE_S);
    CHECK(!stale.fresh && stale.age_known && std::string(stale.reason) == "stale");
    WeatherFreshness future = weather_freshness(true, 1100, 1000);
    CHECK(!future.fresh && std::string(future.reason) == "future_fetch");
    WeatherFreshness unsynced = weather_freshness(true, 1000, -1);
    CHECK(!unsynced.fresh && std::string(unsynced.reason) == "clock_unsynced");

    WeatherMqttSnapshot mqtt;
    mqtt.configured             = true;
    mqtt.available              = true;
    mqtt.has_value              = true;
    mqtt.outdoor_mean_2h_c      = 5.4;
    mqtt.solar_energy_2h_wh_m2  = 82.0;
    mqtt.fetched_unix_s         = 1000;
    mqtt.forecast_start_unix_s  = 1200;
    mqtt.last_attempt_unix_s    = 999;
    mqtt.successes              = 4;
    mqtt.state                  = "ok";
    mqtt.reason                 = "fresh";
    const std::string mqtt_json = build_weather_mqtt_json(mqtt, 1100);
    CHECK(weather_forecast_topic("daikin") == "daikin/weather/openmeteo/forecast");
    CHECK(weather_mqtt_action(false, false) == WeatherMqttAction::CleanupRetained);
    CHECK(weather_mqtt_action(false, true) == WeatherMqttAction::CleanupRetained);
    CHECK(weather_mqtt_action(true, false) == WeatherMqttAction::Suppress);
    CHECK(weather_mqtt_action(true, true) == WeatherMqttAction::Publish);
    const std::string current_weather = weather_forecast_topic("daikin");
    CHECK(retained_cleanup_candidate(current_weather, current_weather.data(),
                                     static_cast<int>(current_weather.size()), true, 7, 0));
    const std::string retired_weather = retired_weather_forecast_topic("daikin");
    CHECK(retired_weather == "daikin/weather_forecast");
    CHECK(retained_cleanup_candidate(retired_weather, retired_weather.data(),
                                     static_cast<int>(retired_weather.size()), true, 7, 0));
    CHECK(mqtt_json.find("\"provider\":\"open-meteo\"") != std::string::npos);
    CHECK(mqtt_json.find("\"model\":\"icon_seamless\"") != std::string::npos);
    CHECK(mqtt_json.find("\"available\":1,\"fresh\":1,\"has_value\":1") != std::string::npos);
    CHECK(mqtt_json.find("\"issued_unix_s\":null") != std::string::npos);
    CHECK(mqtt_json.find("\"fetched_unix_s\":1000") != std::string::npos);
    CHECK(mqtt_json.find("\"forecast_start_unix_s\":1200") != std::string::npos);
    CHECK(mqtt_json.find("\"valid_until_unix_s\":6400") != std::string::npos);
    CHECK(mqtt_json.find("\"outdoor_mean_2h_c\":5.400000") != std::string::npos);
    CHECK(mqtt_json.find("latitude") == std::string::npos);
    CHECK(mqtt_json.find("longitude") == std::string::npos);

    // HA Discovery is intentionally absent. These are only frozen cleanup targets for configs
    // published by the previous build; their ids must never be repurposed.
    CHECK(RETIRED_WEATHER_HA_SENSOR_COUNT == 4);
    CHECK(
        retired_weather_discovery_topic("homeassistant", "daikin", RETIRED_WEATHER_HA_SENSORS[0]) ==
        "homeassistant/sensor/daikin/weather_forecast_outdoor_mean_2h/config");
    CHECK(
        retired_weather_discovery_topic("homeassistant", "daikin", RETIRED_WEATHER_HA_SENSORS[1]) ==
        "homeassistant/sensor/daikin/weather_forecast_solar_energy_2h/config");
    CHECK(
        retired_weather_discovery_topic("homeassistant", "daikin", RETIRED_WEATHER_HA_SENSORS[2]) ==
        "homeassistant/binary_sensor/daikin/weather_forecast_available/config");
    CHECK(
        retired_weather_discovery_topic("homeassistant", "daikin", RETIRED_WEATHER_HA_SENSORS[3]) ==
        "homeassistant/binary_sensor/daikin/weather_forecast_fresh/config");

    // An old value remains available for forensic history after a provider error, but it cannot
    // masquerade as decision-ready data: both availability signals fail closed immediately, even
    // while the historical value remains younger than the ordinary age limit.
    mqtt.available                = false;
    mqtt.state                    = "error";
    mqtt.reason                   = "fetch_failed";
    mqtt.error                    = "http_503";
    mqtt.errors                   = 1;
    const std::string failed_json = build_weather_mqtt_json(mqtt, 1101);
    CHECK(failed_json.find("\"available\":0,\"fresh\":0,\"has_value\":1") != std::string::npos);
    CHECK(failed_json.find("\"freshness_reason\":\"fetch_failed\"") != std::string::npos);
    CHECK(failed_json.find("\"error\":\"http_503\"") != std::string::npos);
    CHECK(failed_json.find("\"outdoor_mean_2h_c\":5.400000") != std::string::npos);

    mqtt.available = true;
    mqtt.state     = "ok";
    mqtt.reason    = "fresh";
    mqtt.error.clear();
    const std::string stale_json = build_weather_mqtt_json(mqtt, 6401);
    CHECK(stale_json.find("\"available\":0,\"fresh\":0,\"has_value\":1") != std::string::npos);
    CHECK(stale_json.find("\"freshness_reason\":\"stale\"") != std::string::npos);

    WeatherMqttSnapshot disabled;
    // The encoder remains total for diagnostics/unit tests, but mqtt_ha.cpp never publishes this
    // synthetic disabled document: WeatherMqttAction::CleanupRetained owns that state instead.
    const std::string disabled_json = build_weather_mqtt_json(disabled, -1);
    CHECK(disabled_json.find("\"configured\":0") != std::string::npos);
    CHECK(disabled_json.find("\"available\":0,\"fresh\":0,\"has_value\":0") != std::string::npos);
    CHECK(disabled_json.find("\"freshness_reason\":\"not_configured\"") != std::string::npos);
    CHECK(disabled_json.find("\"fetched_unix_s\":null") != std::string::npos);
    CHECK(disabled_json.find("\"outdoor_mean_2h_c\":null") != std::string::npos);

    WeatherForecastSample same = sample;
    CHECK(!weather_timestamp_moved_backward(same, sample)); // duplicate delivery is idempotent
    WeatherForecastSample older = sample;
    older.fetched_unix_s--;
    CHECK(weather_timestamp_moved_backward(older, sample));
    older = sample;
    older.decision_unix_s--;
    CHECK(weather_timestamp_moved_backward(older, sample));
    WeatherForecastSample issued_previous = sample;
    WeatherForecastSample issued_older    = sample;
    issued_previous.issued_unix_s         = 100;
    issued_older.issued_unix_s            = 99;
    CHECK(weather_timestamp_moved_backward(issued_older, issued_previous));
    issued_older.issued_unix_s = -1;
    CHECK(!weather_timestamp_moved_backward(issued_older, issued_previous));

    // At 10:30 the next decision instant is 11:00. Open-Meteo's values at 12:00 and 13:00
    // represent the following two one-hour bins; W/m² means sum numerically to two-hour Wh/m².
    std::vector<int64_t> times;
    for (const char* timestamp : {"2026-08-03T10:00:00Z", "2026-08-03T11:00:00Z",
                                  "2026-08-03T12:00:00Z", "2026-08-03T13:00:00Z"}) {
        int64_t value = -1;
        CHECK(reference_parse_rfc3339(timestamp, value));
        times.push_back(value);
    }
    const std::vector<double> temperature{6.0, 7.0, 8.0, 10.0};
    const std::vector<double> humidity{81.0, 79.0, 76.0, 72.0};
    const std::vector<double> pressure{1002.0, 1003.0, 1004.0, 1005.0};
    const std::vector<double> shortwave{0.0, 50.0, 100.0, 200.0};
    WeatherForecastSample     derived;
    WeatherValidation dv = open_meteo_derive_forecast(times, temperature, humidity, pressure,
                                                      shortwave, fetched, derived);
    CHECK(dv.valid);
    CHECK(derived.provider == "open-meteo" && derived.model == "icon_seamless");
    CHECK(derived.issued_unix_s == -1 && derived.decision_unix_s == decision);
    CHECK(std::abs(derived.outdoor_mean_2h_c - 9.0) < 0.001);
    CHECK(std::abs(derived.solar_energy_2h_wh_m2 - 300.0) < 0.001);
    CHECK(derived.hourly_count == 3);
    CHECK(derived.hourly_unix_s[0] == decision);
    CHECK(std::abs(derived.hourly_temperature_c[2] - 10.0) < 0.001);
    CHECK(std::abs(derived.hourly_humidity_pct[1] - 76.0) < 0.001);
    CHECK(std::abs(derived.hourly_pressure_hpa[0] - 1003.0) < 0.001);
    WeatherForecastSample invalid_hourly  = derived;
    invalid_hourly.hourly_humidity_pct[0] = 101.0;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_humidity");
    invalid_hourly                  = derived;
    invalid_hourly.hourly_unix_s[0] = decision + 1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_time");
    invalid_hourly = derived;
    invalid_hourly.hourly_unix_s[1] += 1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_time");
    invalid_hourly                         = derived;
    invalid_hourly.hourly_temperature_c[0] = std::nan("");
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_temperature");
    invalid_hourly                         = derived;
    invalid_hourly.hourly_temperature_c[0] = WEATHER_OUTDOOR_MIN_C - 0.1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_temperature");
    invalid_hourly                         = derived;
    invalid_hourly.hourly_temperature_c[0] = WEATHER_OUTDOOR_MAX_C + 0.1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_temperature");
    invalid_hourly                        = derived;
    invalid_hourly.hourly_humidity_pct[0] = std::nan("");
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_humidity");
    invalid_hourly                        = derived;
    invalid_hourly.hourly_humidity_pct[0] = WEATHER_HUMIDITY_MIN_PCT - 0.1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_humidity");
    invalid_hourly                        = derived;
    invalid_hourly.hourly_pressure_hpa[0] = std::nan("");
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_pressure");
    invalid_hourly                        = derived;
    invalid_hourly.hourly_pressure_hpa[0] = WEATHER_PRESSURE_MIN_HPA - 0.1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_pressure");
    invalid_hourly                        = derived;
    invalid_hourly.hourly_pressure_hpa[0] = WEATHER_PRESSURE_MAX_HPA + 0.1;
    CHECK(std::string(weather_validate(invalid_hourly).reason) == "invalid_hourly_pressure");
    std::vector<double> short_payload{0.0, 1.0};
    CHECK(std::string(open_meteo_derive_forecast(times, temperature, humidity, pressure,
                                                 short_payload, fetched, derived)
                          .reason) == "payload_shape_invalid");
    times[2] += 1;
    CHECK(std::string(open_meteo_derive_forecast(times, temperature, humidity, pressure, shortwave,
                                                 fetched, derived)
                          .reason) == "non_hourly_horizon");
}

static void test_mcp() {
    auto parse = [](const std::string& json) {
        return mcp_parse(json.data(), static_cast<int>(json.size()));
    };

    // The scanner classifies actual wire bytes, not pre-digested shape flags. Invalid JSON is a
    // parse error; a valid JSON value that is not a Request object is an invalid request.
    CHECK(mcp_parse(nullptr, 0).error == -32700);
    CHECK(parse("").error == -32700);
    CHECK(parse("not json").error == -32700);
    CHECK(parse("{").error == -32700);
    CHECK(parse("{\"jsonrpc\":\"2.0\",}").error == -32700);
    CHECK(parse("[1,true,null,\"ok\",{\"x\":2}]").error == -32600);
    CHECK(parse("1.25e+2").error == -32600);
    CHECK(parse("01").error == -32700);

    // Every structural JSON-RPC fault maps to -32600 and must discard an untrusted id.
    CHECK(parse("{}").error == -32600);
    CHECK(parse("{\"jsonrpc\":\"1.0\",\"id\":1,\"method\":\"tools/list\"}").error == -32600);
    CHECK(parse("{\"jsonrpc\":2,\"id\":1,\"method\":\"tools/list\"}").error == -32600);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":1}").error == -32600);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":7}").error == -32600);
    for (const char* id : {"true", "false", "[]", "{}"}) {
        McpRequest r =
            parse(std::string("{\"jsonrpc\":\"2.0\",\"id\":") + id + ",\"method\":\"tools/list\"}");
        CHECK(r.error == -32600 && r.id_raw == "null");
    }
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"jsonrpc\":\"2.0\",\"id\":1,"
                "\"method\":\"tools/list\"}")
              .error == -32600);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":1,\"id\":2,"
                "\"method\":\"tools/list\"}")
              .error == -32600);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\","
                "\"method\":\"tools/list\"}")
              .error == -32600);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\","
                "\"params\":{},\"params\":{}}")
              .error == -32600);

    // A valid notification has no JSON-RPC response. Its method/params do not change that rule.
    McpRequest r = parse("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
    CHECK(!r.error && r.notification && r.id_kind == McpIdKind::None);
    r = parse("{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":7}");
    CHECK(!r.error && r.notification);

    // initialize negotiates a supported revision verbatim and otherwise offers this server's newest
    // supported revision. The issue's intentionally-minimal params:{} example remains accepted.
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\","
              "\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},"
              "\"clientInfo\":{\"name\":\"test\",\"version\":\"1\"}}}");
    CHECK(!r.error && r.method == McpMethod::Initialize && r.protocol_version == "2025-06-18" &&
          r.id_raw == "1");
    for (const char* version : {"2025-03-26", "2025-06-18", "2025-11-25"}) {
        CHECK(mcp_protocol_supported(version));
    }
    CHECK(!mcp_protocol_supported("2024-11-05"));
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"initialize\","
              "\"params\":{\"protocolVersion\":\"2099-01-01\"}}");
    CHECK(!r.error && r.protocol_version == MCP_PROTOCOL_LATEST && r.id_raw == "\"init\"");
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\",\"params\":{}}");
    CHECK(!r.error && r.protocol_version == MCP_PROTOCOL_LATEST);
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\"}");
    CHECK(!r.error && r.protocol_version == MCP_PROTOCOL_LATEST);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\",\"params\":[]}").error ==
          -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\","
                "\"params\":{\"protocolVersion\":7}}")
              .error == -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\","
                "\"params\":{\"protocolVersion\":\"2025-11-25\","
                "\"protocolVersion\":\"2025-11-25\"}}")
              .error == -32602);

    // tools/list has no required params. A supplied params value must still be an object.
    r = parse("{\"extra\":[1,{\"nested\":true}],\"jsonrpc\":\"2.0\",\"id\":3,"
              "\"method\":\"tools/list\"}");
    CHECK(!r.error && r.method == McpMethod::ToolsList && r.id_raw == "3");
    CHECK(!parse("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/list\",\"params\":{}}").error);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/list\",\"params\":null}").error ==
          -32602);

    // Both tools accept an omitted or empty arguments object and nothing else. Escaped ASCII in a
    // JSON key/value is decoded before dispatch, so a standards-compliant encoder cannot miss
    // tools.
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\","
              "\"params\":{\"name\":\"get_status\"}}");
    CHECK(!r.error && r.method == McpMethod::ToolsCall && r.tool == "get_status");
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\","
              "\"params\":{\"arguments\":{},\"name\":\"get_hp_\\u0076alues\"}}");
    CHECK(!r.error && r.tool == "get_hp_values");
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\"}").error == -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{}}").error ==
          -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\","
                "\"params\":{\"name\":7}}")
              .error == -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\","
                "\"params\":{\"name\":\"get_status\",\"arguments\":{\"unexpected\":1}}}")
              .error == -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\","
                "\"params\":{\"name\":\"get_status\",\"arguments\":[]}}")
              .error == -32602);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\","
                "\"params\":{\"name\":\"get_status\",\"name\":\"get_status\"}}")
              .error == -32602);
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\","
              "\"params\":{\"name\":\"set_hp\"}}");
    CHECK(r.error == -32601 && std::string(mcp_error_message(r)) == "Tool not found");
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"unknown\"}");
    CHECK(r.error == -32601 && std::string(mcp_error_message(r)) == "Method not found");

    // IDs are echoed as exact JSON tokens (including exponent spelling and escaped string content);
    // null remains null. Error/result builders preserve them and quote messages through json.hpp.
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":-1.25e+2,\"method\":\"tools/list\"}");
    CHECK(!r.error && r.id_kind == McpIdKind::Number && r.id_raw == "-1.25e+2");
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":\"a\\\\\\\"b\",\"method\":\"tools/list\"}");
    CHECK(!r.error && r.id_kind == McpIdKind::String && r.id_raw == "\"a\\\\\\\"b\"");
    r = parse("{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"tools/list\"}");
    CHECK(!r.error && r.id_kind == McpIdKind::Null && r.id_raw == "null");
    const std::string ok = mcp_result("-1.25e+2", "{\"ok\":true}");
    CHECK(ok == "{\"jsonrpc\":\"2.0\",\"id\":-1.25e+2,\"result\":{\"ok\":true}}");
    const std::string err = mcp_error("\"x\"", -32602, "bad \"args\"");
    CHECK(err.find("\"id\":\"x\"") != std::string::npos);
    CHECK(err.find("\"code\":-32602") != std::string::npos);
    CHECK(err.find("bad \\\"args\\\"") != std::string::npos);
    CHECK(std::string(mcp_error_message(McpRequest{})) == "Error");
    McpRequest parse_err;
    parse_err.error = -32700;
    CHECK(std::string(mcp_error_message(parse_err)) == "Parse error");
    parse_err.error = -32600;
    CHECK(std::string(mcp_error_message(parse_err)) == "Invalid Request");
    parse_err.error = -32602;
    CHECK(std::string(mcp_error_message(parse_err)) == "Invalid params");

    // Fixed results expose exactly the two read-only no-argument tools and the full server name.
    const std::string init = mcp_initialize_result("2025-11-25", "v9.9.9");
    CHECK(init.find("\"protocolVersion\":\"2025-11-25\"") != std::string::npos);
    CHECK(init.find("\"capabilities\":{\"tools\":{}}") != std::string::npos);
    CHECK(init.find("\"name\":\"daikin-altherma-esp32\"") != std::string::npos);
    CHECK(init.find("\"version\":\"v9.9.9\"") != std::string::npos);
    const std::string catalog = mcp_tools_list_result();
    CHECK(catalog.find("\"name\":\"get_status\"") != std::string::npos);
    CHECK(catalog.find("\"name\":\"get_hp_values\"") != std::string::npos);
    CHECK(catalog.find("\"name\":\"set_") == std::string::npos);
    CHECK(catalog.find("\"additionalProperties\":false") != std::string::npos);
    CHECK(catalog.find("\"readOnlyHint\":true") != std::string::npos);
    const std::string tool_result = mcp_tool_result("{\"values\":[1]}", "snapshot");
    CHECK(tool_result.find("\"content\":[{\"type\":\"text\",\"text\":\"snapshot\"}]") !=
          std::string::npos);
    CHECK(tool_result.find("\"structuredContent\":{\"values\":[1]}") != std::string::npos);
    CHECK(tool_result.find("\"isError\":false") != std::string::npos);
    std::string streamed;
    mcp_result_begin(streamed, "8");
    mcp_tool_result_begin(streamed, "snapshot");
    // String oracle for get_status; get_hp_values applies these same envelope helpers to the
    // bounded transport sink exercised below.
    streamed += "{\"values\":[1]}";
    mcp_tool_result_end(streamed);
    mcp_result_end(streamed);
    CHECK(streamed == "{\"jsonrpc\":\"2.0\",\"id\":8,\"result\":" + tool_result + "}");

    // The production response sink must remain bounded even when ONE append is much larger than the
    // limit. The old HTTP helper appended first and flushed afterwards, so a source-only assertion
    // about a 1 KiB constant did not prove that the live high-water was actually 1 KiB.
    std::string large(20 * 1024, 'x');
    std::string joined;
    size_t      data_flushes  = 0;
    size_t      final_flushes = 0;
    size_t      largest_chunk = 0;
    auto        capture       = [&](std::string_view bytes, bool final) {
        if (final) {
            final_flushes++;
        } else {
            data_flushes++;
            largest_chunk = std::max(largest_chunk, bytes.size());
            joined.append(bytes.data(), bytes.size());
        }
        return true;
    };
    BoundedChunkSink<decltype(capture), 1024> chunks(capture);
    chunks += large;
    CHECK(chunks.finish());
    CHECK(chunks.finish()); // idempotent: never emits a second HTTP terminator
    CHECK(joined == large);
    CHECK(data_flushes > 1);
    CHECK(final_flushes == 1);
    CHECK(largest_chunk <= 1024);
    CHECK(chunks.max_buffered() <= 1024);

    // The same production sink carries the MCP prefix, structured values object and suffix. Joining
    // its transport chunks must reproduce the existing string builder byte-for-byte — including a
    // raw UTF-8 label, escaped JSON text, null, both sources and the isError field.
    const std::string structured = "{\"values\":[{\"label\":\"Café \\\"flow\\\"\",\"value\":null}],"
                                   "\"modbus\":[{\"value\":12.5}]}";
    joined.clear();
    data_flushes     = 0;
    final_flushes    = 0;
    largest_chunk    = 0;
    auto capture_mcp = [&](std::string_view bytes, bool final) {
        if (final) {
            final_flushes++;
        } else {
            data_flushes++;
            largest_chunk = std::max(largest_chunk, bytes.size());
            joined.append(bytes.data(), bytes.size());
        }
        return true;
    };
    BoundedChunkSink<decltype(capture_mcp), 1024> mcp_chunks(capture_mcp);
    mcp_result_begin(mcp_chunks, "8");
    mcp_tool_result_begin(mcp_chunks, "snapshot");
    mcp_chunks += structured;
    mcp_tool_result_end(mcp_chunks);
    mcp_result_end(mcp_chunks);
    CHECK(mcp_chunks.finish());
    CHECK(joined == mcp_result("8", mcp_tool_result(structured, "snapshot")));
    CHECK(final_flushes == 1);
    CHECK(largest_chunk <= 1024);
    CHECK(mcp_chunks.max_buffered() <= 1024);

    // The scanner rejects broken escapes/surrogates and an attacker-controlled nesting bomb.
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":\"\\uD800\",\"method\":\"tools/list\"}").error ==
          -32700);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":\"\\uDC00\",\"method\":\"tools/list\"}").error ==
          -32700);
    CHECK(parse("{\"jsonrpc\":\"2.0\",\"id\":\"\\q\",\"method\":\"tools/list\"}").error == -32700);
    std::string deep = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"x\":";
    deep += std::string(18, '[');
    deep += "0";
    deep += std::string(18, ']');
    deep += "}";
    CHECK(parse(deep).error == -32700);
}

// ── The wired transport's rules (logic/net_link.hpp) ────────────────────────────────────────────
// Every one of these is a decision the boot sequence used to make implicitly, correctly, for a
// device that could only have a radio. They are asserted here because the failure mode of each is
// invisible on a bench board with a cable in it and expensive in a utility room without one.
static void test_net_link() {
    // Who carries the route. The wire wins whenever it has a lease; BOTH being held at once is the
    // normal state of a board that fell back to WiFi and later had a cable plugged in.
    CHECK(net_link_active(false, false) == NetLink::None);
    CHECK(net_link_active(false, true) == NetLink::Wifi);
    CHECK(net_link_active(true, false) == NetLink::Eth);
    CHECK(net_link_active(true, true) == NetLink::Eth);
    CHECK(std::string(net_link_str(NetLink::None)) == "none");
    CHECK(std::string(net_link_str(NetLink::Wifi)) == "wifi");
    CHECK(std::string(net_link_str(NetLink::Eth)) == "eth");
    // The numeric form rides the MQTT heartbeat, so the values are a published contract.
    CHECK(static_cast<int>(NetLink::None) == 0);
    CHECK(static_cast<int>(NetLink::Wifi) == 1);
    CHECK(static_cast<int>(NetLink::Eth) == 2);

    // The boot fork. A wired board does not start its radio…
    CHECK(!net_wifi_start_needed(/*eth*/ true, /*configured*/ true));
    CHECK(!net_wifi_start_needed(/*eth*/ true, /*configured*/ false));
    CHECK(net_wifi_start_needed(/*eth*/ false, /*configured*/ true));
    CHECK(!net_wifi_start_needed(/*eth*/ false, /*configured*/ false));
    // …and, the load-bearing half, does not open a captive portal it has no reason to run. Without
    // this a wired board with no stored SSID would sit behind an OPEN SoftAP that also restricts
    // the HTTP surface — the whole API withheld from the LAN it is reachable on.
    CHECK(!net_portal_needed(/*eth*/ true, /*wifi_up*/ false));
    CHECK(!net_portal_needed(/*eth*/ true, /*wifi_up*/ true));
    CHECK(!net_portal_needed(/*eth*/ false, /*wifi_up*/ true));
    CHECK(net_portal_needed(/*eth*/ false, /*wifi_up*/ false));

    // GOT_IP is a wake-up, not a permanent lease: a local event-bit snapshot that races LOST_IP
    // may not carry the boot once the current lease says otherwise.
    CHECK(net_eth_boot_ready(/*got event*/ true, /*current lease*/ true));
    CHECK(!net_eth_boot_ready(/*got event*/ true, /*current lease*/ false));
    CHECK(!net_eth_boot_ready(/*got event*/ false, /*current lease*/ true));
    // Watch creation keys on boot provenance, so loss in the narrow interval between returning from
    // net_eth_start() and starting the task cannot suppress recovery.
    CHECK(net_eth_fallback_watch_needed(/*present*/ true, /*carried boot*/ true));
    CHECK(!net_eth_fallback_watch_needed(/*present*/ true, /*carried boot*/ false));
    CHECK(!net_eth_fallback_watch_needed(/*present*/ false, /*carried boot*/ true));

    // Losing the wire. A live lease, or a running radio, is nothing to act on.
    EthFallbackWatch w;
    CHECK(net_eth_fallback_step(w, /*lease*/ true, /*wifi_running*/ false, /*configured*/ true) ==
          EthFallbackAction::Idle);
    CHECK(net_eth_fallback_step(w, false, /*wifi_running*/ true, true) == EthFallbackAction::Idle);
    // No configured network to come back on: never reboot. Rebooting would replace a board waiting
    // for its cable with a board waiting for its cable, minus its uptime and its diag ring.
    for (int i = 0; i < 20; i++)
        CHECK(net_eth_fallback_step(w, false, false, /*configured*/ false) ==
              EthFallbackAction::Idle);
    // Proven gone AND there is a radio to come back on -> restart, but only after the grace run.
    for (int i = 0; i < ETH_FALLBACK_PERIODS - 1; i++)
        CHECK(net_eth_fallback_step(w, false, false, true) == EthFallbackAction::Wait);
    CHECK(net_eth_fallback_step(w, false, false, true) == EthFallbackAction::Restart);
    // The run is spent by the verdict, so a caller that refuses (an OTA is installing) re-earns it
    // instead of asserting Restart on every later period.
    CHECK(net_eth_fallback_step(w, false, false, true) == EthFallbackAction::Wait);
    // A single healthy sample clears the run: a switch rebooting must not accumulate across a
    // recovery toward a reboot nobody needed.
    w = EthFallbackWatch{};
    CHECK(net_eth_fallback_step(w, false, false, true) == EthFallbackAction::Wait);
    CHECK(net_eth_fallback_step(w, true, false, true) == EthFallbackAction::Idle);
    for (int i = 0; i < ETH_FALLBACK_PERIODS - 1; i++)
        CHECK(net_eth_fallback_step(w, false, false, true) == EthFallbackAction::Wait);

    // The pads. Four real, distinct GPIOs or there is no Ethernet.
    const EthPins ok{5, 6, 7, 8};
    CHECK(net_eth_pins_valid(ok));
    CHECK(!net_eth_pins_valid(EthPins{-1, 6, 7, 8}));
    CHECK(!net_eth_pins_valid(EthPins{5, 5, 7, 8}));
    CHECK(!net_eth_pins_valid(EthPins{5, 6, 7, 7}));
    CHECK(ok.claims(5) && ok.claims(8) && !ok.claims(4) && !ok.claims(-1));
    CHECK(ok.reserved().claims(6) && ok.reserved().claims(7) && !ok.reserved().claims(1));

    // The probe may not drive a pad the firmware already uses. This is the destructive one: on an
    // AtomS3 Lite with X10A moved to the header pins (docs/BOARDS.md offers exactly 5/6), the
    // probe's clock and chip-select would land on the heat pump's service bus.
    CHECK(net_eth_probe_allowed(ok, ReservedPins{}));
    CHECK(net_eth_probe_allowed(ok, ReservedPins{1, 2}));  // X10A on Grove — no overlap
    CHECK(!net_eth_probe_allowed(ok, ReservedPins{5, 6})); // X10A on the header pads
    CHECK(!net_eth_probe_allowed(ok, ReservedPins{35, 41, 2, 1}.plus(ReservedPins{7})));
    CHECK(!net_eth_probe_allowed(EthPins{-1, -1, -1, -1}, ReservedPins{}));

    // ReservedPins now merges two sets, because the Ethernet pads are learned from a PROBE while
    // the other four come from the config — and both must reach every picker.
    const ReservedPins merged = ReservedPins{35, 41, 1, 2}.plus(ok.reserved());
    for (int p : {35, 41, 1, 2, 5, 6, 7, 8}) CHECK(merged.claims(p));
    CHECK(!merged.claims(9));
    CHECK(!merged.claims(-1));
    // Eight slots is exactly the largest set this firmware builds (four config pins + four pads);
    // a ninth would be silently dropped, so the bound is asserted rather than assumed.
    CHECK(ReservedPins::MAX == 8);

    // The trust surface now keys on the AP itself, not on the WiFi mode: a wired board never starts
    // a station, and reading that absence as "untrusted" withheld the whole API from the cable.
    CHECK(http_surface_for(true) == HttpSurface::SetupAp);
    CHECK(http_surface_for(false) == HttpSurface::TrustedLan);
    CHECK(!http_surface_serves(http_surface_for(true), "/status", false));
    CHECK(http_surface_serves(http_surface_for(false), "/status", false));
}

static void test_http_surface() {
    const HttpSurface ap  = HttpSurface::SetupAp;
    const HttpSurface lan = HttpSurface::TrustedLan;

    // Trusted LAN exposes the full API — every route, either method.
    for (const char* p : {"/",
                          "/index.html",
                          "/favicon.ico",
                          "/locale.js",
                          "/scan",
                          "/status",
                          "/values",
                          "/diag",
                          "/diag/clear",
                          "/coredump",
                          "/coredump/clear",
                          "/crash/dismiss",
                          "/models",
                          "/set_wifi",
                          "/set_mqtt",
                          "/set_ntp",
                          "/set_weather",
                          "/set_hp",
                          "/detect",
                          "/ota/check",
                          "/ota/update",
                          "/ota/changelog",
                          "/mcp"}) {
        CHECK(http_surface_serves(lan, p, false));
        CHECK(http_surface_serves(lan, p, true));
    }

    // Open setup AP: ONLY the provisioning routes.
    CHECK(http_surface_serves(ap, "/", false));
    CHECK(http_surface_serves(ap, "/index.html", false));
    CHECK(http_surface_serves(ap, "/favicon.ico", false));
    CHECK(http_surface_serves(ap, "/set_wifi", true));

    // …and nothing that reads state, carries secrets, or reconfigures the device. This is the F01
    // regression: /coredump and /diag can hold WiFi/MQTT credentials, and the config/OTA/MCP routes
    // reprogram the board — none may be reachable from an unauthenticated radio client.
    CHECK(!http_surface_serves(ap, "/status", false));
    CHECK(!http_surface_serves(ap, "/locale.js", false));
    CHECK(!http_surface_serves(ap, "/values", false));
    CHECK(!http_surface_serves(ap, "/diag", false));
    CHECK(!http_surface_serves(ap, "/diag/clear", true));
    CHECK(!http_surface_serves(ap, "/coredump", false));
    CHECK(!http_surface_serves(ap, "/coredump/clear", true));
    // …and /crash/dismiss least of all: it DESTROYS the dump and the crash record, so an
    // unauthenticated radio client could erase the evidence of a crash it never saw.
    CHECK(!http_surface_serves(ap, "/crash/dismiss", true));
    CHECK(!http_surface_serves(ap, "/models", false));
    // …including /scan: the portal takes a TYPED SSID (main/www/setup.html has no dropdown and
    // issues no fetch), so an open radio has no reason to be handed a list of every AP in range.
    CHECK(!http_surface_serves(ap, "/scan", false));
    CHECK(!http_surface_serves(ap, "/set_mqtt", true));
    CHECK(!http_surface_serves(ap, "/set_syslog", true));
    CHECK(!http_surface_serves(ap, "/set_ntp", true));
    CHECK(!http_surface_serves(ap, "/set_hp", true));
    CHECK(!http_surface_serves(ap, "/detect", true));
    CHECK(!http_surface_serves(ap, "/ota/check", false));
    CHECK(!http_surface_serves(ap, "/ota/update", true));
    CHECK(!http_surface_serves(ap, "/ota/changelog", false));
    CHECK(!http_surface_serves(ap, "/mcp", false)); // GET dashboard is LAN-only too
    CHECK(!http_surface_serves(ap, "/mcp", true));

    // Method matters on the AP: /set_wifi is POST-only and the page routes are GET-only — the
    // mismatched method is withheld (a GET /set_wifi must not slip through the provisioning
    // allow-list, nor a POST to the setup page).
    CHECK(!http_surface_serves(ap, "/set_wifi", false));
    CHECK(!http_surface_serves(ap, "/", true));
    CHECK(!http_surface_serves(ap, "/index.html", true));
    CHECK(!http_surface_serves(ap, "/favicon.ico", true));
}

static void test_http_request_policy() {
    constexpr std::string_view hostname = "daikin-altherma-esp32";
    constexpr std::string_view wifi_ip  = "192.0.2.20";
    constexpr std::string_view eth_ip   = "198.51.100.30";

    for (const char* authority :
         {"daikin-altherma-esp32.local", "DAIKIN-ALTHERMA-ESP32.LOCAL:80", "192.0.2.20",
          "192.0.2.20:80", "198.51.100.30", "198.51.100.30:80"})
        CHECK(http_authority_allowed(authority, hostname, wifi_ip, eth_ip));
    for (const char* authority :
         {"", "evil.example", "daikin-altherma-esp32.local.evil",
          "daikin-altherma-esp32.local:8080", "user@192.0.2.20", "192.0.2.200"})
        CHECK(!http_authority_allowed(authority, hostname, wifi_ip, eth_ip));

    CHECK(http_origin_allowed("http://daikin-altherma-esp32.local", hostname, wifi_ip, eth_ip));
    CHECK(http_origin_allowed("http://198.51.100.30:80", hostname, wifi_ip, eth_ip));
    CHECK(!http_origin_allowed("https://daikin-altherma-esp32.local", hostname, wifi_ip, eth_ip));
    CHECK(!http_origin_allowed("http://evil.example", hostname, wifi_ip, eth_ip));
    CHECK(!http_origin_allowed("null", hostname, wifi_ip, eth_ip));

    HttpRequestHeaders h{};
    // A native HTTP/1.0 probe with no browser headers remains supported.
    CHECK(http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));
    h.host_present = true;
    h.host         = "192.0.2.20";
    CHECK(http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));
    h.host = "attacker.example";
    CHECK(!http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));

    h.host               = "daikin-altherma-esp32.local";
    h.origin_present     = true;
    h.origin             = "http://daikin-altherma-esp32.local";
    h.fetch_site_present = true;
    h.fetch_site         = "same-origin";
    CHECK(http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));
    h.fetch_site = "cross-site";
    CHECK(!http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));
    h.fetch_site = "future-value";
    CHECK(!http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));
    h.fetch_site = "same-origin";
    h.origin     = "http://attacker.example";
    CHECK(!http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));
    h.host_present = false;
    CHECK(!http_lan_request_allowed(h, hostname, wifi_ip, eth_ip));

    CHECK(http_json_content_type("application/json"));
    CHECK(http_json_content_type("Application/JSON; charset=utf-8"));
    CHECK(http_json_content_type(" application/json ; charset=UTF-8 "));
    CHECK(!http_json_content_type(""));
    CHECK(!http_json_content_type("text/plain"));
    CHECK(!http_json_content_type("application/x-www-form-urlencoded"));
    CHECK(!http_json_content_type("application/jsonp"));
    CHECK(!http_json_content_type("application/json;"));
}

// logic/lwt_select.hpp — the leaving-water MEASUREMENT picker that feeds ΔT / heat output / COP.
// Host-testable twin of www/js/schematic.js pickLwtRow(); guards issue #121 (a setpoint must never
// be selected) and the post-BUH mis-credit (R2T must never win over R1T), across the real profile
// catalog and the alias label forms plain "leaving water.*before" misses.
static void test_lwt_select() {
    using logic::lwt_select;

    // --- the #121 case: a "Leaving water" SETPOINT sorts before the R1T measurement (the fixture
    //     layout). The old fallback `vNum(/leaving water/i)` picked index 0 — a 45 °C setpoint. ---
    {
        const char* rows[] = {
            "Leaving Water Setpoint (main)",      // 0x60 — sorts FIRST, must be refused
            "Leaving Water Temp after PHE (R1T)", // 0x61 — the correct pre-BUH sensor
            "Leaving Water Temp after BUH (R2T)", // 0x61 — post-BUH, must be refused
        };
        CHECK(lwt_select(rows, 3) == 1); // R1T, not the setpoint, not R2T
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
        const char* hpsu[] = {
            // HPSU / hybrid
            "LW setpoint (main)",
            "Outlet Water Heat Exch. Temp. (R1T)",
            "Outlet Water BUH Temp. (R2T)",
        };
        CHECK(lwt_select(hpsu, 3) == 1);
        const char* ech2o[] = {
            // ECH2O D-series
            "LW setpoint (main)",
            "[HPSU] Tv inflow Temp  (R1T)",
            "[HPSU] Tvbh inflow Temp after Buffer/BUH (R2T)",
        };
        CHECK(lwt_select(ech2o, 3) == 1);
    }

    // --- traps that must NOT be selected as the main leaving-water measurement ---
    {
        // EKMIK bizone mixed-zone R1T must lose to the main circuit's before-BUH R1T ("mixed"
        // reject).
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

        // A bare "heat exch" keyword would grab these refrigerant/outdoor rows — the picker must
        // not.
        const char* refr[] = {"O/U Heat Exch. Temp.(R4T)", "Outdoor heat exchanger temp."};
        CHECK(lwt_select(refr, 2) == -1);
    }

    // --- Tier 2 fallback: an un-tagged leaving-water measurement is still selected (not a
    // setpoint) ---
    {
        const char* generic[] = {"DHW setpoint", "Leaving water temperature"};
        CHECK(lwt_select(generic, 2) == 1);
        // ...but if the ONLY leaving-water row is a setpoint, select nothing (blank beats wrong).
        const char* only_sp[] = {"Leaving Water Setpoint (main)", "DHW setpoint"};
        CHECK(lwt_select(only_sp, 2) == -1);
    }

    // --- catalog conformance: EVERY detectable profile must resolve a real pre-BUH measurement,
    //     and it must never be a setpoint / mixed-zone / post-BUH row. Fails loudly if a future
    //     generated profile introduces a leaving-water row that trips the selection (the issue's
    //     "so no future generated profile can reintroduce this"). ---
    int detectable_checked = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue; // generic + fixture + minichillers excluded
        const char* labels[128];
        size_t      n = 0;
        for (size_t i = 0; i < p.count && n < 128; i++) labels[n++] = p.values[i].label;
        int idx = lwt_select(labels, n);
        CHECK(idx >= 0); // no detectable profile is blank any more
        if (idx >= 0) {
            const char* sel = labels[idx];
            CHECK(logic::lwt_is_water(sel) &&
                  !logic::lwt_is_reject(sel)); // measurement, not setpoint/mixed/R2T
        }
        detectable_checked++;
    }
    CHECK(detectable_checked >= 39); // the current detectable Altherma catalog

    // The non-detection fixture reproduces the #121 layout (setpoint, then after-PHE R1T): assert
    // the picker refuses its setpoint too, pinning the exact scenario the issue was filed on.
    {
        const auto& fx = def::lookup("altherma3_r_erga");
        const char* labels[128];
        size_t      n = 0;
        for (size_t i = 0; i < fx.count && n < 128; i++) labels[n++] = fx.values[i].label;
        int idx = lwt_select(labels, n);
        CHECK(idx >= 0);
        if (idx >= 0)
            CHECK(!logic::lwt_is_reject(labels[idx]) && logic::lwt_ci_contains(labels[idx], "r1t"));
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
    CHECK(!ou_page_holds_over(0x10)); // carries Defrost Operation — a state input, never silenced
    CHECK(!ou_page_holds_over(0x30)); // INV frequency (rps) — the compressor witness
    CHECK(!ou_page_holds_over(0x60)); // indoor/hydronic
    CHECK(!ou_page_holds_over(0x61));
    CHECK(!ou_page_holds_over(0x62));

    // UNKNOWN compressor state is not "stopped": a profile with no rps row must not have its
    // outdoor readings blanked on a guess. Only a known-stopped compressor is evidence of a
    // held-over page.
    CHECK(ou_reading_held_over(0x20, /*known=*/true, /*running=*/false));
    CHECK(!ou_reading_held_over(0x20, /*known=*/true, /*running=*/true));
    CHECK(!ou_reading_held_over(0x20, /*known=*/false, /*running=*/false)); // unknown -> current
    CHECK(!ou_reading_held_over(0x61, /*known=*/true, /*running=*/false));  // hydronic stays live

    // The compressor WITNESS, now a shared predicate: the poll engine marks its cache with it
    // (main/hp_poll.cpp, so the MQTT bridge can withhold a held-over reading — #209 defect 5) and
    // the trend ring's trend_rps_row() finds its row with it. Two callers, one rule; a second copy
    // of the pattern is what would let one of them quietly stop covering a row.
    CHECK(logic::ou_is_rps_witness("INV frequency (rps)", 0x30));
    CHECK(
        !logic::ou_is_rps_witness("INV frequency (rps)", 0x21)); // must sit on a page that is LIVE,
                                                                 // or the run state comes from the
                                                                 // same frozen bytes it qualifies
    CHECK(!logic::ou_is_rps_witness("INV primary current (A)", 0x21));
    CHECK(!logic::ou_is_rps_witness("Fan 1 (step)", 0x30));
    CHECK(!logic::ou_is_rps_witness(nullptr, 0x30));

    // --- catalog conformance -------------------------------------------------------------------
    // Every detectable profile: the readings the UI blanks must sit on a held-over page, and the
    // compressor witness must NOT. A future generated profile that moves "INV frequency (rps)" onto
    // 0x20/0x21 would make the run state stale-derived and must fail loudly here.
    int rps_rows = 0, out_rows = 0, disch_rows = 0, inv_rows = 0, ct_rows = 0, rp_rows = 0,
        checked = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        for (size_t i = 0; i < p.count; i++) {
            const char*    l   = p.values[i].label;
            const unsigned reg = p.values[i].reg;
            if (logic::lwt_ci_contains(l, "inv frequency")) {
                CHECK(!ou_page_holds_over(reg)); // the run-state witness must stay live
                rps_rows++;
            }
            if (logic::lwt_ci_contains(l, "outdoor air temp")) {
                CHECK(ou_page_holds_over(reg)); // the pill the UI blanks
                out_rows++;
            }
            if (logic::lwt_ci_contains(l, "discharge pipe temp")) {
                CHECK(ou_page_holds_over(reg));
                disch_rows++;
            }
            // The ELECTRICAL-INPUT sources, and they fall on opposite sides of the rule — which is
            // the whole reason www/js/schematic.js has to pick between them rather than blanking
            // the pill wholesale. "INV primary current" is an outdoor-unit row and freezes with the
            // rest of 0x21; the CT clamps sit on the hydronic 0x63 and keep measuring. The
            // browser's d.pel used the INV row as an unconditional fallback whenever the CT sum
            // read 0 — which is exactly what an idle plant reads — so a stopped unit drew a
            // plausible kW figure out of its last run, beside a "not running" headline. Same shape
            // as #35-#39, no numeric tell.
            if (logic::lwt_ci_contains(l, "inv primary current")) {
                CHECK(ou_page_holds_over(reg)); // held over -> the browser must gate on ouHeldOver
                inv_rows++;
            }
            if (logic::lwt_ci_contains(l, "current measured by ct")) {
                CHECK(
                    !ou_page_holds_over(reg)); // live -> a non-zero CT reading is real standby draw
                ct_rows++;
            }
            // The high-side pill's AT-REST source. The compressor's own HP transducer is a 0x20 row
            // and freezes with that page, so the browser falls back to this one — and the inspector
            // now names it as the source line beside the number. That only holds while it is LIVE:
            // on a held-over page it would be the same stale bar under a more trustworthy name.
            if (logic::lwt_ci_contains(l, "refrigerant pressure sensor")) {
                CHECK(!ou_page_holds_over(reg)); // 0x62, the hydronic side — resampled at rest
                rp_rows++;
            }
        }
        checked++;
    }
    CHECK(checked >= 39);  // the current detectable Altherma catalog (mirrors test_lwt_select)
    CHECK(rps_rows >= 20); // the witness exists across the catalog, not on one profile
    CHECK(out_rows >= 20);
    CHECK(disch_rows >= 20);
    // Every detectable profile carries the INV row, and only about half carry CT clamps — so the
    // stale fallback was not an edge case, it was the default path on the majority of installs.
    CHECK(inv_rows >= checked);
    CHECK(ct_rows > 0);
    CHECK(rp_rows > 0); // the at-rest high-side fallback exists in the catalog
}

// ── logic/cop_scope.hpp — WHICH COP the dashboard's quotient describes ────────────────────────
// Two halves, and the first is the one with a real trap behind it: the post-BUH row must be found
// by (label, PAGE) because the catalog gives the SAME "(R2T)" tag, at the SAME offset, with the
// SAME converter, to the leaving-water outlet on 0x61 and to the compressor's discharge pipe on
// 0x20. The second half asserts the pairing rule itself — that a whole-unit denominator is never
// divided into a heat-pump-only numerator while the backup heater is firing.
static void test_cop_scope() {
    using logic::cop_is_post_buh;
    using logic::cop_plan;
    using logic::cop_post_buh_select;
    using logic::CopBlock;
    using logic::CopScope;
    using logic::PelSource;

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
        const char* labels[] = {"Discharge pipe temp.(R2T)", "Leaving water temp. after BUH (R2T)"};
        const unsigned regs[] = {0x20, 0x61};
        CHECK(cop_post_buh_select(labels, regs, 2) == 1); // the water row, never the pipe
        const char*    only_pipe[] = {"Discharge pipe temp.(R2T)"};
        const unsigned pipe_reg[]  = {0x20};
        CHECK(cop_post_buh_select(only_pipe, pipe_reg, 1) == -1); // blank beats wrong
    }

    // --- the pairing rule -----------------------------------------------------------------------
    // Shorthand: the tank heater known-off, which is the branch the BUH cases are about.
    const bool BSH_OFF_K = true, BSH_OFF = false;

    // No current at all (or the only row frozen with the outdoor unit): nothing to divide by.
    CHECK(cop_plan(PelSource::None, true, false, BSH_OFF_K, BSH_OFF, true).block ==
          CopBlock::NoPelSource);
    CHECK(!cop_plan(PelSource::None, true, false, BSH_OFF_K, BSH_OFF, true).showable());

    // Compressor-only current + pre-BUH heat = a HEAT-PUMP COP. BOTH resistive heaters sit outside
    // both sides of the fraction, so neither can unbalance them — this holds with either firing.
    for (bool buh : {false, true})
        for (bool bsh : {false, true}) {
            const auto p = cop_plan(PelSource::Inv, true, buh, true, bsh, true);
            CHECK(p.scope == CopScope::HeatPump);
            CHECK(p.showable());
            CHECK(!p.use_post_buh); // the usual lwt_select numerator
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

    // Whole-unit current with NO post-BUH row: the pre-BUH outlet stands in only while the heater
    // is provably off. Firing -> blocked, and blocked with its OWN reason, since the UI answers
    // each block with a different sentence.
    CHECK(cop_plan(PelSource::Ct, true, false, BSH_OFF_K, BSH_OFF, false).showable());
    CHECK(cop_plan(PelSource::Ct, true, false, BSH_OFF_K, BSH_OFF, false).scope == CopScope::Plant);
    CHECK(cop_plan(PelSource::Ct, true, true, BSH_OFF_K, BSH_OFF, false).block ==
          CopBlock::BuhNoPostBuh);
    // UNKNOWN is not OFF. Off is the permissive branch here, so guessing it is exactly what would
    // ship the collapsed quotient — the mirror of ou_stale's "unknown rps is not stopped".
    CHECK(cop_plan(PelSource::Ct, /*buh_known=*/false, false, BSH_OFF_K, BSH_OFF, false).block ==
          CopBlock::BuhNoPostBuh);
    CHECK(cop_plan(PelSource::Ct, /*buh_known=*/false, false, BSH_OFF_K, BSH_OFF, true).showable());

    // --- the TANK heater, which no numerator can answer -----------------------------------------
    // BSH heats the DHW tank directly, downstream of the flow sensor and of both leaving-water
    // sensors. Its kilowatts enter a whole-unit divisor while its heat crosses neither R1T nor R2T,
    // so unlike the BUH case there is no row anywhere in the profile that would re-pair them.
    // Blocked even WITH a post-BUH row — that is the whole distinction from BuhNoPostBuh.
    for (bool post : {false, true}) {
        const auto p =
            cop_plan(PelSource::Ct, true, false, /*bsh_known=*/true, /*bsh_on=*/true, post);
        CHECK(p.block == CopBlock::TankHeater);
        CHECK(!p.showable());
        CHECK(!p.use_post_buh); // no row is claimed — implying a pairing would be the lie
    }
    // Unknown tank-heater state is not "off" either, same reason as the BUH flag.
    CHECK(cop_plan(PelSource::Ct, true, false, /*bsh_known=*/false, false, true).block ==
          CopBlock::TankHeater);
    // The compressor-only divisor is unaffected: BSH is outside it, so a DHW boost does not block.
    CHECK(cop_plan(PelSource::Inv, true, false, true, /*bsh_on=*/true, true).showable());
    // And the tank heater is checked BEFORE the numerator is picked — a plan that blocks must not
    // also claim a row, or the UI would show a source line for a figure it refuses to state.
    CHECK(!cop_plan(PelSource::Ct, false, true, true, true, true).use_post_buh);

    // --- catalog conformance --------------------------------------------------------------------
    // Every detectable profile resolves EXACTLY ONE post-BUH row, and the BUH state that gates the
    // rule sits on a page that stays live. If the run-state input froze with the outdoor unit the
    // block would be decided from last run's heater state — the failure ou_stale.hpp closes for
    // pel.
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
        CHECK(matches <= 1); // never ambiguous — two would make the pick arbitrary
        const int idx = cop_post_buh_select(labels, regs, n);
        if (idx >= 0) {
            with_post++;
            CHECK(!logic::ou_page_holds_over(regs[idx])); // a live page, always
            CHECK(logic::lwt_ci_contains(labels[idx], "r2t"));
            CHECK(!logic::lwt_ci_contains(labels[idx], "discharge")); // never the pipe twin
            // The two pickers must never land on the same row: one is the heat pump's own outlet,
            // the other the outlet after the resistive heater. Collapsing them would make the
            // plant COP and the heat-pump COP the same number and hide the whole distinction.
            const int pre = logic::lwt_select(labels, n);
            CHECK(pre != idx);
        }
        bool has_ct = false, has_bsh = false;
        for (size_t i = 0; i < n; i++) {
            if (logic::lwt_ci_contains(labels[i], "buh step")) {
                CHECK(!logic::ou_page_holds_over(regs[i])); // 0x60 — live while the O/U sleeps
                with_buh++;
            }
            // The tank heater's own flag. Anchored exactly, like the browser's /^bsh$/ — "Thermal
            // protector BSH" is a different row (a cut-out, not the heater) and must not gate a
            // COP; all 44 tables carry both labels, so an unanchored match would gate on the wrong
            // one. Case-SENSITIVE where the browser's regex is not, and deliberately so: the
            // catalog spells it "BSH" in every table, and if a generator run ever emitted "Bsh"
            // this assertion fails loudly instead of the two twins quietly disagreeing about which
            // profiles can form a plant COP. Strict here is the fail-closed direction.
            const bool is_bsh = labels[i] && (std::strcmp(labels[i], "BSH") == 0);
            if (is_bsh) {
                CHECK(!logic::ou_page_holds_over(regs[i])); // 0x60 too — the block can't be stale
                has_bsh = true;
                with_bsh++;
            }
            if (logic::lwt_ci_contains(labels[i], "measured by ct")) {
                has_ct = true;
                with_ct++;
            }
        }
        // The load-bearing one. A whole-unit divisor is exactly where the tank heater unbalances
        // the fraction, so every profile that HAS CT clamps must also expose the flag that detects
        // it — otherwise the block would depend on an input that profile cannot supply, and the
        // collapsed quotient would ship on precisely the profiles this rule was written for.
        if (has_ct) CHECK(has_bsh);
        checked++;
    }
    CHECK(checked >= 39); // the detectable Altherma catalog (mirrors test_lwt_select)
    CHECK(with_post >=
          checked);      // every detectable profile carries a post-BUH row -> Plant is formable
    CHECK(with_buh > 0); // the backup-heater state exists across the catalog, not on one profile
    CHECK(with_bsh > 0); // and so does the tank heater's
    CHECK(with_ct > 0);  // and so does the whole-unit current that makes the scope Plant
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
        const uint8_t   regs[]  = {0x61, 0x20};
        const uint8_t   offs[]  = {2, 0};
        const char*     units[] = {"°C", "°C"};
        const TrendDef* oa      = trend_by_id("outdoor_air");
        CHECK(oa != nullptr);
        CHECK(trend_select(*oa, regs, offs, units, 2) == 1); // the 0x20 row, never the 0x61 one
        // …and the same offset on the wrong page is refused outright, not trended as outdoor air.
        const uint8_t wrong[] = {0x61, 0x61};
        CHECK(trend_select(*oa, wrong, offs, units, 2) == -1);
    }
    // The second collision is INSIDE one byte window: 0x20/12 carries "High Pressure" (bar) and
    // "High Pressure(T)" (its saturation temperature, °C). Only the unit tells them apart, which is
    // why it is half the locator — a bar chart drawing °C is the #35-#39 shape with a history in
    // front of it. (Neither 0x20 pressure is trended today; the rule is what is asserted.)
    {
        const TrendDef probe{"probe", TrendKind::Row, 0x20, 12, "bar", ""};
        const uint8_t  regs[]  = {0x20, 0x20};
        const uint8_t  offs[]  = {12, 12};
        const char*    units[] = {"°C", "bar"};
        CHECK(trend_select(probe, regs, offs, units, 2) == 1); // the bar row, never its °C twin
        const TrendDef sat{"probe", TrendKind::Row, 0x20, 12, "°C", ""};
        CHECK(trend_select(sat, regs, offs, units, 2) == 0);
    }
    // Outdoor modes have their own exact page/offset/converter locators. Defrost is an observed
    // event; Quiet is a persistent selector state.
    {
        const TrendDef* defrost = trend_by_id("defrost_state");
        const TrendDef* quiet   = trend_by_id("quiet_state");
        CHECK(defrost != nullptr && defrost->kind == TrendKind::BinaryEvent);
        CHECK(defrost->reg == 0x10 && defrost->off == 1 && defrost->conv == 304);
        CHECK(quiet != nullptr && quiet->kind == TrendKind::BinaryState);
        CHECK(quiet->reg == 0x60 && quiet->off == 2 && quiet->conv == 301);
        const uint8_t regs[]  = {0x60, 0x10};
        const uint8_t offs[]  = {2, 1};
        const char*   units[] = {"", ""};
        const int16_t convs[] = {301, 304};
        CHECK(trend_select(*quiet, regs, offs, units, convs, 2) == 0);
        CHECK(trend_select(*defrost, regs, offs, units, convs, 2) == 1);
    }
    // Seven binary facts share 0x60/12 and the empty unit. BSH is converter 305, BUH stages are
    // 304/303 and the 3-way valve is 306; the narrower numeric-row selector must refuse them rather
    // than making array order the identity.
    {
        const TrendDef* bsh = trend_by_id("bsh_state");
        CHECK(bsh != nullptr && bsh->kind == TrendKind::BinaryEvent && bsh->conv == 305);
        const TrendDef* preheat = trend_by_id("tank_preheat_state");
        CHECK(preheat != nullptr && preheat->kind == TrendKind::BinaryEvent);
        CHECK(preheat->reg == 0x62 && preheat->off == 8 && preheat->conv == 303);
        const TrendDef* buh1 = trend_by_id("buh_step1");
        const TrendDef* buh2 = trend_by_id("buh_step2");
        CHECK(buh1 != nullptr && buh1->kind == TrendKind::BinaryEvent && buh1->conv == 304);
        CHECK(buh2 != nullptr && buh2->kind == TrendKind::BinaryEvent && buh2->conv == 303);
        const TrendDef* valve = trend_by_id("valve_dhw");
        CHECK(valve != nullptr && valve->kind == TrendKind::BinaryState && valve->conv == 306);
        const uint8_t regs[]  = {0x60, 0x60, 0x60, 0x60, 0x60};
        const uint8_t offs[]  = {12, 12, 12, 12, 12};
        const char*   units[] = {"", "", "", "", ""};
        const int16_t convs[] = {306, 305, 304, 303, 301};
        CHECK(trend_select(*bsh, regs, offs, units, 5) == -1);
        CHECK(trend_select(*bsh, regs, offs, units, convs, 5) == 1);
        CHECK(trend_select(*buh1, regs, offs, units, convs, 5) == 2);
        CHECK(trend_select(*buh2, regs, offs, units, convs, 5) == 3);
        CHECK(trend_select(*valve, regs, offs, units, 5) == -1);
        CHECK(trend_select(*valve, regs, offs, units, convs, 5) == 0);
    }

    // --- a trend is a measurement, never a target (issue #121's rule) ---------------------------
    // Now structural rather than checked per label: a setpoint lives at its own offset (the tank's
    // is 0x60/7), so addressing the measurement's byte window cannot reach it. The catalog test
    // below asserts the consequence over every profile — that no resolved label says "setpoint".
    {
        const TrendDef* dhw = trend_by_id("dhw_tank");
        CHECK(dhw != nullptr);
        CHECK(dhw->reg == 0x61 && dhw->off == 10);
        const uint8_t regs[]  = {0x60, 0x61}; // DHW setpoint, DHW tank temp.
        const uint8_t offs[]  = {7, 10};
        const char*   units[] = {"°C", "°C"};
        CHECK(trend_select(*dhw, regs, offs, units, 2) == 1);  // the setpoint sorts first and loses
        CHECK(trend_select(*dhw, regs, offs, units, 1) == -1); // …and on its own resolves nothing
    }

    CHECK(trend_by_id("nope") == nullptr); // unknown id -> 404, never a default
    CHECK(trend_by_id(nullptr) == nullptr);
    CHECK(trend_by_id("dhw_tan") == nullptr); // prefix is not a match
    CHECK(trend_by_id("dhw_tank_x") == nullptr);

    // One missing register page is a gap, not a new sensor. The ring identity may change only when
    // the structural row actually resolved; profile/link changes reset all rings explicitly.
    CHECK(!history_row_identity_changed("Expansion valve 1 (pls)", -1, ""));
    CHECK(!history_row_identity_changed("INV frequency (rps)", -1, ""));
    CHECK(!history_row_identity_changed("Expansion valve 1 (pls)", 3, "Expansion valve 1 (pls)"));
    CHECK(history_row_identity_changed("Expansion valve 1 (pls)", 3, "Expansion valve 2 (pls)"));
    CHECK(!history_row_identity_changed("", 3, "Expansion valve 1 (pls)"));
    CHECK(!history_row_identity_changed(nullptr, 3, "Expansion valve 1 (pls)"));

    // --- what gets STORED --------------------------------------------------------------------
    // The held-over test wins over everything: the bus DID answer, and hp_format DID produce a
    // plausible value — that is exactly what makes this failure invisible without the page rule.
    CHECK(history_store(true, 235, 0x20, /*known=*/true, /*running=*/false) == HISTORY_HELD_OVER);
    CHECK(history_store(true, 235, 0x20, /*known=*/true, /*running=*/true) == 235);
    CHECK(history_store(true, 235, 0x20, /*known=*/false, /*running=*/false) ==
          235); // unknown != stopped
    CHECK(history_store(true, 416, 0x61, /*known=*/true, /*running=*/false) ==
          416); // hydronic stays live
    CHECK(history_store(false, 0, 0x61, true, true) == HISTORY_NO_READING);
    CHECK(history_is_absent(HISTORY_NO_READING));
    CHECK(history_is_absent(HISTORY_HELD_OVER));
    CHECK(!history_is_absent(0));    // 0.0 °C is a READING, not an absence
    CHECK(!history_is_absent(-400)); // and so is -40.0 °C

    // The two Smart-Grid contacts form one documented four-state enum. It is stored in tenths like
    // every /history series, and a missing half stays absent rather than fabricating Free running.
    CHECK(history_smart_grid_mode(true, false, true, false) == 0);
    CHECK(history_smart_grid_mode(true, false, true, true) == 10);
    CHECK(history_smart_grid_mode(true, true, true, false) == 20); // Recommended on = Boost
    CHECK(history_smart_grid_mode(true, true, true, true) == 30);
    CHECK(history_smart_grid_mode(false, false, true, false) == HISTORY_NO_READING);
    CHECK(history_smart_grid_mode(true, false, false, false) == HISTORY_NO_READING);

    // --- the compressor witness ----------------------------------------------------------------
    {
        const char*   rows[] = {"R1T-Outdoor air temp.", "INV frequency (rps)"};
        const uint8_t regs[] = {0x20, 0x30};
        CHECK(trend_rps_row(rows, regs, 2) == 1);
        // A witness on a FROZEN page is no witness: it would qualify the very readings it is read
        // from. Refused rather than trusted (belt to ou_stale's catalog braces).
        const uint8_t bad[] = {0x20, 0x21};
        CHECK(trend_rps_row(rows, bad, 2) == -1);
        const char*   none[] = {"Leaving water temp."};
        const uint8_t r1[]   = {0x61};
        CHECK(trend_rps_row(none, r1, 1) == -1); // absent -> UNKNOWN, and unknown keeps storing
    }

    // --- bucket math ---------------------------------------------------------------------------
    // The ring advances on the MONOTONIC clock; a wall-clock bucket would leap on the first SNTP
    // sync of every boot.
    CHECK(history_bucket(0) == 0);
    CHECK(history_bucket(299'999'999LL) == 0);
    CHECK(history_bucket(300'000'000LL) == 1);
    CHECK(history_bucket(24LL * 3600 * 1000000) == HISTORY_SAMPLES); // a full day later
    CHECK(history_completed_samples(0) == 0);
    CHECK(history_completed_samples(12) == 12); // one hour of common raster
    CHECK(history_completed_samples(HISTORY_SAMPLES) == HISTORY_SAMPLES);
    CHECK(history_completed_samples(HISTORY_SAMPLES + 99) == HISTORY_SAMPLES);
    // Skipped-bucket arithmetic: adjacent buckets skip NOTHING (the once-per-5-min common case),
    // and a non-advancing clock yields 0 rather than an unsigned wrap-around that would blank the
    // ring.
    CHECK(history_skipped(5, 6) == 0);
    CHECK(history_skipped(5, 7) == 1);
    CHECK(history_skipped(0, 10) == 9);
    CHECK(history_skipped(5, 5) == 0);
    CHECK(history_skipped(6, 5) == 0); // never 0xFFFFFFFF

    // --- t0 must not depend on WHEN the request arrived
    // -------------------------------------------- The load-bearing property. Measured on a live
    // unit before this was fixed: two fetches 70 s apart with an unchanged sample count reported t0
    // values 70 s apart, because t0 was `now - (n-1)*dt` and assumed the newest sample was taken
    // *now*. That drift is what let a pinned readout round onto the neighbouring slot and describe
    // a different measurement than the one tapped.
    {
        // Same newest sample, three different request times → one answer.
        const int64_t t_a = history_t0(1'000'000, 0, 2, HISTORY_DT_S);
        const int64_t t_b = history_t0(1'000'070, 70, 2, HISTORY_DT_S);
        const int64_t t_c = history_t0(1'000'299, 299, 2, HISTORY_DT_S);
        CHECK(t_a == t_b);
        CHECK(t_b == t_c);
        CHECK(t_a == 1'000'000 - 300); // sample 0 is one bucket before the newest
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
    // instant: the ring shifts a slot every 5 min, so an index anchor would keep pointing at slot
    // 42 while slot 42 became a different measurement.
    {
        const int64_t  t0 = 1'700'000'000;
        const uint32_t dt = HISTORY_DT_S;
        CHECK(history_pin_index(t0, dt, 288, t0) == 0); // the oldest sample
        CHECK(history_pin_index(t0, dt, 288, t0 + 42 * dt) == 42);
        CHECK(history_pin_index(t0, dt, 288, t0 + 287 * dt) == 287); // the newest
        // Aged out / not yet: the pin is DROPPED, never clamped to an edge — clamping would keep
        // the readout up while silently changing which moment it describes.
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
        CHECK(history_pin_index(t0, dt, 288, t0 + 42 * dt + dt / 2 + 1) == 43); // past halfway
        // Degenerate inputs cannot produce a bogus slot.
        CHECK(history_pin_index(t0, 0, 288, t0) == -1);
        CHECK(history_pin_index(t0, dt, 0, t0) == -1);
        // A single-sample series: only that one instant resolves.
        CHECK(history_pin_index(t0, dt, 1, t0) == 0);
        CHECK(history_pin_index(t0, dt, 1, t0 + dt) == -1);
    }

    // --- held-run encoding ---------------------------------------------------------------------
    {
        uint16_t            runs[8][2];
        const HistorySample a[] = {100, HISTORY_HELD_OVER,  HISTORY_HELD_OVER,
                                   120, HISTORY_NO_READING, HISTORY_HELD_OVER};
        size_t              n   = history_held_runs(a, 6, runs, 8);
        CHECK(n == 2);
        CHECK(runs[0][0] == 1 && runs[0][1] == 2);
        CHECK(runs[1][0] == 5 && runs[1][1] == 1); // a NO_READING breaks a held run, not joins it
        // Boundaries: a run that starts at 0 and one that runs to the end.
        const HistorySample b[] = {HISTORY_HELD_OVER, HISTORY_HELD_OVER};
        CHECK(history_held_runs(b, 2, runs, 8) == 1);
        CHECK(runs[0][0] == 0 && runs[0][1] == 2);
        const HistorySample c[] = {10, 20};
        CHECK(history_held_runs(c, 2, runs, 8) == 0); // nothing held -> no runs, not one empty run
        // A full alternating series must fit — HISTORY_MAX_RUNS is sized for exactly this.
        static HistorySample alt[HISTORY_SAMPLES];
        static uint16_t      big[HISTORY_MAX_RUNS][2];
        for (size_t i = 0; i < HISTORY_SAMPLES; i++) alt[i] = (i % 2) ? HISTORY_HELD_OVER : 200;
        CHECK(history_held_runs(alt, HISTORY_SAMPLES, big, HISTORY_MAX_RUNS) ==
              HISTORY_SAMPLES / 2);
    }

    // --- parsing the cache's formatted value back to tenths --------------------------------------
    {
        int v = -1;
        CHECK(history_parse_tenths("41.6", v) && v == 416);
        CHECK(history_parse_tenths("-7.5", v) && v == -75);
        CHECK(history_parse_tenths("0.0", v) && v == 0);
        CHECK(history_parse_tenths("23", v) && v == 230); // no decimal point is still a number
        // Reject legacy/corrupt nonnumeric states rather than letting strtof turn them into a
        // confident 0.0 line. Current binary values reach history as numeric 1/0.
        CHECK(!history_parse_tenths("ON", v));
        CHECK(!history_parse_tenths("OFF", v));
        CHECK(!history_parse_tenths("U4", v)); // a fault code
        CHECK(!history_parse_tenths("", v));   // nothing decoded this cycle
        CHECK(!history_parse_tenths(nullptr, v));
        // Must not collide with the absence sentinels, which sit at the very bottom of int16:
        // -32768 is NO_READING and -32767 is HELD_OVER, so -3276.6 is the first real reading below
        // them. (These are also the ±3276.x "no data" sentinels the X10A units themselves emit —
        // issue #35-#39 — which reading_plausible() already refuses upstream; this is the belt.)
        CHECK(!history_parse_tenths("-3276.8", v)); // == HISTORY_NO_READING
        CHECK(!history_parse_tenths("-3276.7", v)); // == HISTORY_HELD_OVER
        CHECK(history_parse_tenths("-3276.6", v) &&
              v == -32766); // …the first one that is a reading
        CHECK(!history_parse_tenths("nan", v));
        CHECK(!history_parse_tenths("inf", v));

        // ROUND-TRIP EXACTNESS, asserted rather than assumed. The stored sample must equal the
        // value the device published, for every 0.1 step across the plausible range — hp_convert
        // writes
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
        CHECK(r.snapshot(nullptr, 0) == 0); // empty ring reads out nothing
        static HistorySample out[HISTORY_SAMPLES + 4];

        // Folding: a real reading beats absence whenever it arrives in the bucket, a later reading
        // beats an earlier one, and absence keeps the LAST reason.
        r.fold(HISTORY_NO_READING);
        r.fold(250);
        r.fold(HISTORY_HELD_OVER); // absence must NOT overwrite a measurement
        CHECK(r.pending == 250);
        r.fold(260);
        CHECK(r.pending == 260);
        r.commit(0);
        CHECK(r.snapshot(out, 4) == 1 && out[0] == 260);
        CHECK(r.pending == HISTORY_NO_READING); // the next bucket starts empty

        r.fold(HISTORY_NO_READING);
        r.fold(HISTORY_HELD_OVER); // last reason wins when nothing was measured
        r.commit(0);
        CHECK(r.snapshot(out, 4) == 2 && out[1] == HISTORY_HELD_OVER);

        // Skipped buckets are FILLED, not compressed: a dead bus must not slide the earlier samples
        // forward in time. Three skipped -> three NO_READING between the commits.
        r.fold(300);
        r.commit(3);
        CHECK(r.snapshot(out, 8) == 6);
        CHECK(out[2] == 300);
        CHECK(out[3] == HISTORY_NO_READING && out[4] == HISTORY_NO_READING &&
              out[5] == HISTORY_NO_READING);
        HistorySample picked = 0;
        CHECK(r.sample_from_newest(0, picked) && picked == HISTORY_NO_READING);
        CHECK(r.sample_from_newest(3, picked) && picked == 300);
        CHECK(r.sample_from_newest(5, picked) && picked == 260);
        CHECK(!r.sample_from_newest(6, picked));
    }
    {
        // BSH is an event state: once ON was observed, an OFF later in the same five-minute bucket
        // must not erase the use. This reports one active raster window, not exact seconds.
        TrendRing r;
        r.fold_binary_event(0);
        r.fold_binary_event(10);
        r.fold_binary_event(0);
        r.fold_binary_event(HISTORY_NO_READING);
        CHECK(r.pending == 10);
        r.commit(0);
        HistorySample out[2];
        CHECK(r.snapshot(out, 2) == 1 && out[0] == 10);
        r.fold_binary_event(HISTORY_NO_READING);
        r.fold_binary_event(0);
        CHECK(r.pending == 0); // a real OFF beats an initially missing sample
    }
    {
        // Wrap-around: fill past capacity and the readout must still be oldest-first, dropping only
        // the samples that actually fell off the back.
        TrendRing r;
        for (int i = 0; i < static_cast<int>(HISTORY_SAMPLES) + 5; i++) {
            r.fold(static_cast<HistorySample>(i));
            r.commit(0);
        }
        static HistorySample out[HISTORY_SAMPLES];
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == HISTORY_SAMPLES);
        CHECK(out[0] == 5); // 0..4 aged out
        CHECK(out[HISTORY_SAMPLES - 1] == static_cast<HistorySample>(HISTORY_SAMPLES + 4));
        for (size_t i = 1; i < HISTORY_SAMPLES; i++)
            CHECK(out[i] == out[i - 1] + 1); // monotonic, no seam
        // A snapshot smaller than the ring takes the OLDEST n, which is what keeps the caller's
        // time axis anchored at t0 rather than silently shifting it.
        static HistorySample few[10];
        CHECK(r.snapshot(few, 10) == 10 && few[0] == 5);
        // reset() really empties it — a model change must not leave the previous unit's tail
        // behind.
        r.reset();
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == 0);
        // A new source/identity keeps the common elapsed window as explicit gaps. It never carries
        // old readings forward, and a late start beyond 24 h still caps at exactly one day.
        r.reset_with_gaps(8);
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == 8);
        for (size_t i = 0; i < 8; i++) CHECK(out[i] == HISTORY_NO_READING);
        r.reset_with_gaps(HISTORY_SAMPLES + 20);
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == HISTORY_SAMPLES);
        for (size_t i = 0; i < HISTORY_SAMPLES; i++) CHECK(out[i] == HISTORY_NO_READING);
    }
    {
        // A skip larger than the whole ring must not run away: it fills at most one full ring.
        TrendRing r;
        r.fold(100);
        r.commit(100000);
        static HistorySample out[HISTORY_SAMPLES];
        CHECK(r.snapshot(out, HISTORY_SAMPLES) == HISTORY_SAMPLES);
        for (size_t i = 0; i < HISTORY_SAMPLES; i++)
            CHECK(out[i] == HISTORY_NO_READING); // 100 aged out
    }

    // --- catalog conformance ------------------------------------------------------------------
    // The locator is only worth anything if it addresses ONE row, on EVERY profile that carries the
    // quantity — so both halves are measured here rather than assumed. `min_profiles` is the count
    // measured over today's catalog: a generated profile that moved a row, or a generator run that
    // dropped one, has to fail here and not on someone's dashboard. `unit_type` is the catalog's
    // own type code (convert.hpp: 1 = °C, 2 = bar, -1 = none) and must agree with the unit string
    // the TRENDS entry addresses the row by — GET /history prints that string into the chart's
    // range readout and its crosshair.
    struct TrendExpect {
        const char* id;
        int         min_profiles;
        int         unit_type;
        int         size;
    };
    static const TrendExpect kExpect[] = {
        {"dhw_tank", 39, 1, 2},
        {"leaving_water", 39, 1, 2},
        {"return_water", 39, 1, 2},
        {"leaving_water_post_buh", 39, 1, 2},
        {"refrigerant_liquid", 39, 1, 2},
        {"water_pressure", 39, 2, 1}, // the one bar row that is WATER, not refrigerant
        {"flow", 39, -1, 2},          // unit lives in the label ("Flow sensor (l/min)")
        {"pump_signal", 39, -1, 1},
        {"circuit_pressure", 24, 2, 2}, // refrigerant, on the hydronic page — stays live
        {"comp_rps", 26, -1, 1},        // 13 detection profiles carry no 0x30 page at all
        {"eev", 26, -1, 2},             // same 0x30 page as comp_rps — the same 26 profiles
        {"outdoor_air", 39, 1, 2},
        {"outdoor_heat_exchanger", 39, 1, 2}, // outdoor coil / deicer R4T at exact page+offset
        {"discharge", 39, 1, 2},
        {"room_temp", 39, 1, 2},    // "Indoor ambient temp. (R1T)" / "RT Temp." — one locator
        {"inv_current", 39, -1, 2}, // every profile has it; only ~half have CT clamps
        {"ct_l1", 20, -1, 1},
        {"ct_l2", 20, -1, 1},
        {"ct_l3", 20, -1, 1},
        {"defrost_state", 39, -1, 1},      // exact event-folded Defrost Operation flag
        {"quiet_state", 39, -1, 1},        // exact persistent Silent Mode flag
        {"bsh_state", 39, -1, 1},          // exact bit 305 in the shared 0x60/12 state byte
        {"tank_preheat_state", 35, -1, 1}, // four detected families carry no such X10A field
        {"buh_step1", 39, -1, 1},          // exact event-folded BUH stage bits 304/303
        {"buh_step2", 39, -1, 1},
        {"valve_dhw", 39, -1, 1},         // exact bit 306; persistent DHW/space selector state
        {"valve_heat", 39, -1, 1},        // legacy id; exact bit 307, persistent 2WV output state
        {"water_flow_switch", 39, -1, 1}, // exact bit 307 on the preceding state byte
        // Derived from two structurally identified contact rows, so it resolves no SINGLE catalog
        // row. Its truth table is asserted above; test_binary_semantics pins both contacts' catalog
        // coverage independently.
        {"smart_grid_mode", 0, 0, 0},
        // The board trends resolve no catalog row at all — every expectation below is skipped for
        // them, and what they must satisfy instead is asserted in its own block further down. They
        // are listed so the static_assert keeps forcing a decision for every TRENDS entry.
        {"free_heap", 0, 0, 0},
        {"max_alloc", 0, 0, 0},
        {"circulation_state", 0, 0, 0},
    };
    static_assert(sizeof(kExpect) / sizeof(kExpect[0]) == TREND_COUNT,
                  "every TRENDS entry needs its measured catalog expectation here");

    // Positions of the three trends whose pick is cross-checked against another rule below, by id
    // rather than by counting rows in the table.
    size_t i_lwt = TREND_COUNT, i_rps = TREND_COUNT, i_oa = TREND_COUNT;
    for (size_t t = 0; t < TREND_COUNT; t++) {
        if (trend_cstr_eq(TRENDS[t].id, "leaving_water")) i_lwt = t;
        if (trend_cstr_eq(TRENDS[t].id, "comp_rps")) i_rps = t;
        if (trend_cstr_eq(TRENDS[t].id, "outdoor_air")) i_oa = t;
    }
    CHECK(i_lwt < TREND_COUNT && i_rps < TREND_COUNT && i_oa < TREND_COUNT);

    int checked            = 0;
    int found[TREND_COUNT] = {0};
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        const char* labels[512];
        const char* units[512];
        uint8_t     regs[512];
        uint8_t     offs[512];
        int16_t     convs[512];
        size_t      n = p.count < 512 ? p.count : 512;
        for (size_t i = 0; i < n; i++) {
            labels[i] = p.values[i].label;
            units[i]  = unit_for_datatype(p.values[i].type);
            regs[i]   = p.values[i].reg;
            offs[i]   = p.values[i].offset;
            convs[i]  = static_cast<int16_t>(p.values[i].conv);
        }

        int picked[TREND_COUNT];
        for (size_t t = 0; t < TREND_COUNT; t++) {
            const TrendDef* d = trend_by_id(kExpect[t].id);
            CHECK(d != nullptr);
            CHECK(d == &TRENDS[t]); // kExpect is in TRENDS order — keep it that way
            picked[t] = trend_select(*d, regs, offs, units, convs, n);
            if (picked[t] < 0) continue;
            found[t]++;

            // ONE row, not merely a first one. Ambiguity is what a label token had and a locator is
            // supposed to remove; if a profile ever carries two rows in the same byte window with
            // the same unit, the pick becomes table order — which is not a rule anyone stated.
            int hits = 0;
            for (size_t i = 0; i < n; i++)
                if (trend_row_matches(*d, regs[i], offs[i], units[i], convs[i])) hits++;
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
            // A row on a frozen page is gated; one on a live page is not. Derived from the row's
            // own reg, so the two can never disagree (there is no second page field to drift).
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
        // mixed-zone row substituted for the pre-BUH measurement. The locator is the tighter rule
        // of the two, so binding them here is what keeps it from becoming an independent second
        // one.
        CHECK(picked[i_lwt] == lwt_select(labels, n));
        // …and the compressor trend is the very row the held-over gate reads as its witness.
        CHECK(picked[i_rps] == trend_rps_row(labels, regs, n));
        // Outdoor air must never be a row lwt_select would take for leaving water (the "(R1T)"
        // collision, asserted from the catalog side).
        if (picked[i_oa] >= 0) CHECK(!lwt_is_measurement(labels[picked[i_oa]]));
        checked++;
    }
    CHECK(checked >= 39); // the detectable Altherma catalog (mirrors test_lwt_select/ou_stale)

    // Coverage, measured — not a token non-zero. A trend that silently stopped resolving on half
    // the catalog would still be "working" on the author's own unit.
    for (size_t t = 0; t < TREND_COUNT; t++) CHECK(found[t] >= kExpect[t].min_profiles);

    // --- the non-row trends: one derived state plus two BOARD figures ---------------------------
    // They share the table, the ring and the route with catalog trends and must not share their
    // locator failure modes. Every one carries its own label and resolves NO single catalog row.
    int board_trends       = 0;
    int state_trends       = 0;
    int circulation_trends = 0;
    for (size_t t = 0; t < TREND_COUNT; t++) {
        if (TRENDS[t].kind == TrendKind::Row || TRENDS[t].kind == TrendKind::BinaryState ||
            TRENDS[t].kind == TrendKind::BinaryEvent) {
            CHECK(TRENDS[t].label[0] ==
                  '\0'); // a row's label is the PROFILE's, discovered at runtime
            continue;
        }
        CHECK(TRENDS[t].label[0] != '\0');
        CHECK(found[t] == 0);
        if (TRENDS[t].kind == TrendKind::SmartGridMode) {
            state_trends++;
            CHECK(TRENDS[t].unit[0] == '\0');
        } else if (TRENDS[t].kind == TrendKind::CirculationState) {
            circulation_trends++;
            CHECK(TRENDS[t].unit[0] == '\0');
        } else {
            board_trends++;
            CHECK(trend_cstr_eq(TRENDS[t].unit, "KiB"));
        }
    }
    CHECK(board_trends == 2);
    CHECK(state_trends == 1);
    CHECK(circulation_trends == 1);
    {
        // The locator of a board trend is (0, 0) — which is a REAL byte window. Nothing may make it
        // match: the kind is checked first, so even a row crafted to look exactly like it is
        // refused.
        const TrendDef* fh = trend_by_id("free_heap");
        CHECK(fh != nullptr && fh->kind == TrendKind::FreeHeap);
        const uint8_t regs[]  = {0};
        const uint8_t offs[]  = {0};
        const char*   units[] = {"KiB"};
        CHECK(trend_select(*fh, regs, offs, units, 1) == -1);
        CHECK(!trend_row_matches(*fh, 0, 0, "KiB"));
    }

    // Bytes → tenths of a KiB, the board trends' storage unit. The clamp is the point: the ring is
    // int16, and a wrapped heap figure would be a plausible small number on a chart about running
    // out of memory. Unsigned input, so no sample can ever land on an absence sentinel.
    CHECK(history_bytes_tenths_kib(0) == 0);
    CHECK(history_bytes_tenths_kib(1024) == 10);     // 1.0 KiB
    CHECK(history_bytes_tenths_kib(1536) == 15);     // 1.5 KiB
    CHECK(history_bytes_tenths_kib(150000) == 1465); // 146.5 KiB — a realistic free heap
    CHECK(history_bytes_tenths_kib(4u * 1024 * 1024) == INT16_MAX);   // clamped, not wrapped
    CHECK(history_bytes_tenths_kib(0xFFFFFFFFu) == INT16_MAX);        // …at any size
    CHECK(!history_is_absent(history_bytes_tenths_kib(0xFFFFFFFFu))); // and never an "absence"
    CHECK(!history_is_absent(history_bytes_tenths_kib(0)));

    // The two trends that shipped first must be UNCHANGED by the move from label tokens to
    // locators: same concept, same rows. Cheapest possible proof — the labels still say so.
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        const char* labels[512];
        const char* units[512];
        uint8_t     regs[512];
        uint8_t     offs[512];
        size_t      n = p.count < 512 ? p.count : 512;
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

// ── The rolling X10A operating observation (logic/checkup.hpp, issue #208) ─────────────────────
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
        const uint8_t regs[]  = {0x60, 0x60, 0x60, 0x60, 0x60, 0x60};
        const uint8_t offs[]  = {12, 12, 12, 12, 12, 12};
        const int     convs[] = {307, 306, 305, 304, 303, 301};
        //                        2way  3way  BSH    BUH1   BUH2   pump
        CHECK(checkup_select(CHECKUP_LOC_BUH1, regs, offs, convs, 6) == 3);
        CHECK(checkup_select(CHECKUP_LOC_BUH2, regs, offs, convs, 6) == 4);
        CHECK(checkup_select(CHECKUP_LOC_BSH, regs, offs, convs, 6) == 2);
        CHECK(checkup_select(CHECKUP_LOC_PUMP, regs, offs, convs, 6) == 5);
        // The 3-way valve and the 2-way valve sit in the same byte and are addressed by neither —
        // no health check reads them, and none may resolve onto them by accident.
        for (const CheckupLocator* l :
             {&CHECKUP_LOC_BUH1, &CHECKUP_LOC_BUH2, &CHECKUP_LOC_BSH, &CHECKUP_LOC_PUMP}) {
            const int i = checkup_select(*l, regs, offs, convs, 6);
            CHECK(i >= 0 && convs[i] != 307 && convs[i] != 306);
        }
        // Right byte, wrong page: refused outright rather than taken as a near miss.
        const uint8_t other[] = {0x61, 0x61, 0x61, 0x61, 0x61, 0x61};
        CHECK(checkup_select(CHECKUP_LOC_BUH1, other, offs, convs, 6) == -1);
        // A profile that carries none of them resolves nothing — an absent feature, stated by
        // absence rather than by a zero.
        const uint8_t none_r[] = {0x61};
        const uint8_t none_o[] = {2};
        const int     none_c[] = {105};
        CHECK(checkup_select(CHECKUP_LOC_BUH1, none_r, none_o, none_c, 1) == -1);
    }
    // Fault class is matched by converter alone because both plant halves carry it. Retry coverage
    // is stricter: the five 3-bit counters need stable identities so independent changes cannot be
    // hidden by taking one maximum.
    CHECK(checkup_is_fault_class(203));
    CHECK(!checkup_is_fault_class(204)); // the CODE is textual and open-ended — not this
    CHECK(checkup_retry_index(0x10, 10, 310) == 0);
    CHECK(checkup_retry_index(0x10, 10, 311) == 1);
    CHECK(checkup_retry_index(0x10, 11, 310) == 2);
    CHECK(checkup_retry_index(0x10, 11, 311) == 3);
    CHECK(checkup_retry_index(0x10, 12, 310) == 4);
    CHECK(checkup_retry_index(0x10, 12, 311) == -1); // documented "Not in use"
    CHECK(checkup_retry_index(0x60, 10, 310) == -1); // exact page identity matters
    CHECK(checkup_operating_mode("Heating") == CheckupOperatingMode::Heating);
    CHECK(checkup_operating_mode("Heating + DHW") == CheckupOperatingMode::Heating);
    CHECK(checkup_operating_mode("Cooling") == CheckupOperatingMode::Cooling);
    CHECK(checkup_operating_mode("Cooling + DHW") == CheckupOperatingMode::Cooling);
    CHECK(checkup_operating_mode("Stop") == CheckupOperatingMode::Other);
    CHECK(checkup_operating_mode("DHW") == CheckupOperatingMode::Other);
    CHECK(checkup_operating_mode("?") == CheckupOperatingMode::Unknown);

    {
        // Capability comes from the resolved PROFILE, not from whichever rows happened to answer
        // once this boot. Evidence is accounted independently by checkup_step() below.
        CheckupCoverage c;
        checkup_cover_row(c, 0x30, 0, 152, "INV frequency (rps)");
        checkup_cover_row(c, 0x10, 1, 304, "Defrost Operation");
        checkup_cover_row(c, 0x60, 12, 304, "BUH Step1");
        checkup_cover_row(c, 0x60, 12, 303, "BUH Step2");
        checkup_cover_row(c, 0x60, 12, 305, "BSH");
        checkup_cover_row(c, 0x60, 12, 301, "Water pump operation");
        checkup_cover_row(c, 0x60, 2, 315, "I/U operation mode");
        checkup_cover_row(c, 0x62, 11, 105, "Water pressure");
        checkup_cover_row(c, 0x62, 9, 105, "Flow sensor (l/min)");
        checkup_cover_row(c, 0x10, 4, 203, "Error type");
        checkup_cover_row(c, 0x60, 5, 203, "Error type");
        for (unsigned off = 10; off <= 12; off++) {
            checkup_cover_row(c, 0x10, off, 310, "retry");
            if (off < 12) checkup_cover_row(c, 0x10, off, 311, "retry");
        }
        CHECK(c.rps && c.defrost && c.buh && c.buh1 && c.buh2 && c.bsh);
        CHECK(c.pump && c.mode && c.pressure && c.flow && c.fault && c.fault_rows == 2);
        CHECK(c.retries && c.retry_mask == 0x1f);
    }

    // --- bucket math ----------------------------------------------------------------------------
    CHECK(checkup_bucket(0) == 0);
    CHECK(checkup_bucket(3599'999'999LL) == 0);
    CHECK(checkup_bucket(3600'000'000LL) == 1);
    CHECK(checkup_bucket(24LL * 3600 * 1000000) == CHECKUP_BUCKETS);
    CHECK(checkup_skipped(5, 6) == 0); // adjacent hours skip nothing
    CHECK(checkup_skipped(5, 8) == 2);
    CHECK(checkup_skipped(5, 5) == 0);
    CHECK(checkup_skipped(6, 5) == 0); // never an unsigned wrap-around

    // --- the static budget ----------------------------------------------------------------------
    // .noinit is DRAM this board does not have spare, so the ring's size is a decision and not a
    // consequence. The static_assert stops a build that overruns the bound; this pins the FIGURE,
    // so a field added without the conversation shows up as a failing test rather than as headroom
    // quietly spent. The two eight-byte contexts are deliberately separate: sharing one mean would
    // describe Cycling with defrost-runtime weather and vice versa. The payload costs 384 bytes;
    // 4-byte alignment adds another 48.
    CHECK(sizeof(CheckupOutdoorStats) == 8);
    CHECK(sizeof(CheckupBucket) == 64);
    CHECK(CHECKUP_BYTES == 1536);

    // --- saturation -----------------------------------------------------------------------------
    // A wrap would turn the worst imaginable cycling into a perfect score.
    CHECK(checkup_add_u8(250, 3) == 253);
    CHECK(checkup_add_u8(254, 5) == 255);
    CHECK(checkup_add_u8(255, 1) == 255);
    CHECK(checkup_add_u16(65530, 3) == 65533);
    CHECK(checkup_add_u16(65535, 10) == 65535);

    // --- outdoor context: compact arithmetic + paired populations -----------------------------
    {
        CheckupOutdoorStats stats;
        checkup_outdoor_add(stats, outdoor_x10a_evidence(true, true, true, -5.0));
        checkup_outdoor_add(stats, outdoor_x10a_evidence(true, true, true, 5.0));
        CHECK(stats.samples == 2 && stats.min_tenths == -50);
        checkup_outdoor_add(stats, outdoor_x10a_evidence(true, true, true, 400.0));
        CHECK(stats.samples == 2 && stats.min_tenths == -50);
        CHECK(checkup_outdoor_mean_tenths(stats) == 0);
        // Another source cannot enter an X10A-labelled aggregate.
        checkup_outdoor_add(stats, outdoor_homehub_evidence(true, true, -20.0));
        CHECK(stats.samples == 2 && stats.min_tenths == -50);
        CheckupOutdoorStats more;
        checkup_outdoor_add(more, outdoor_x10a_evidence(true, true, true, 10.0));
        checkup_outdoor_merge(stats, more);
        CHECK(stats.samples == 3 && stats.min_tenths == -50 &&
              checkup_outdoor_mean_tenths(stats) == 33);

        // The persisted aggregate keeps an exact sum rather than a finite-precision running mean.
        // Half an hour cold followed by half an hour warm must equal the reverse order; the former
        // centi-degree mean froze at -2.66 C in this adversarial sequence.
        CheckupOutdoorStats cold_first, warm_first;
        for (int i = 0; i < 1800; i++) {
            checkup_outdoor_add(cold_first, outdoor_x10a_evidence(true, true, true, -10.0));
            checkup_outdoor_add(warm_first, outdoor_x10a_evidence(true, true, true, 10.0));
        }
        for (int i = 0; i < 1800; i++) {
            checkup_outdoor_add(cold_first, outdoor_x10a_evidence(true, true, true, 10.0));
            checkup_outdoor_add(warm_first, outdoor_x10a_evidence(true, true, true, -10.0));
        }
        CHECK(checkup_outdoor_mean_tenths(cold_first) == 0);
        CHECK(checkup_outdoor_mean_tenths(warm_first) == 0);
    }
    {
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known      = true;
        s.rps_running    = false;
        s.valve_known    = true;
        s.valve_dhw      = false;
        s.operating_mode = CheckupOperatingMode::Heating;
        checkup_step(st, b, s, 0);
        s.rps_running = true;
        s.outdoor     = outdoor_x10a_evidence(true, true, true, -5.0);
        checkup_step(st, b, s, 1'000'000);
        s.outdoor = outdoor_x10a_evidence(true, true, true, -3.0);
        checkup_step(st, b, s, 2'000'000);
        s.rps_running = false;
        s.outdoor     = {};
        checkup_step(st, b, s, 3'000'000);
        CHECK(b.space_runs == 1 && b.cycling_outdoor.samples == 2);
        CHECK(b.cycling_outdoor.min_tenths == -50 &&
              checkup_outdoor_mean_tenths(b.cycling_outdoor) == -40);
        CheckupRing ring;
        ring.pending = b;
        const CheckupReport weather_report =
            checkup_evaluate(checkup_aggregate(ring), CheckupCoverage{}, FaultClass::Unknown);
        CHECK(weather_report.cycling_outdoor.source == OutdoorSource::X10a);
        CHECK(weather_report.cycling_outdoor.samples == 2 &&
              weather_report.cycling_outdoor.min_tenths == -50 &&
              weather_report.cycling_outdoor.mean_tenths == -40);

        // Defrost context follows its simultaneously-known compressor denominator, not a generic
        // page-0x20 sample. Unknown defrost evidence contributes nothing.
        CheckupState  ds;
        CheckupBucket db;
        CheckupSample d;
        d.rps_known     = true;
        d.rps_running   = true;
        d.defrost_known = true;
        d.outdoor       = outdoor_x10a_evidence(true, true, true, 2.0);
        checkup_step(ds, db, d, 0);
        checkup_step(ds, db, d, 1'000'000);
        CHECK(db.defrost_outdoor.samples == 1);
        d.defrost_known = false;
        d.outdoor       = outdoor_x10a_evidence(true, true, true, -8.0);
        checkup_step(ds, db, d, 2'000'000);
        CHECK(db.defrost_outdoor.samples == 1 && db.defrost_outdoor.min_tenths == 20);

        // A handover inside the compressor run censors both the run and its weather. Keeping the
        // early space-heating samples would label weather from an ineligible mixed population as
        // Cycling context merely because those samples arrived before the valve moved.
        CheckupState  ms;
        CheckupBucket mb;
        CheckupSample m;
        m.rps_known      = true;
        m.rps_running    = false;
        m.valve_known    = true;
        m.valve_dhw      = false;
        m.operating_mode = CheckupOperatingMode::Heating;
        checkup_step(ms, mb, m, 0);
        m.rps_running = true;
        m.outdoor     = outdoor_x10a_evidence(true, true, true, -6.0);
        checkup_step(ms, mb, m, 1'000'000);
        checkup_step(ms, mb, m, 2'000'000);
        m.valve_dhw = true;
        m.outdoor   = outdoor_x10a_evidence(true, true, true, 8.0);
        checkup_step(ms, mb, m, 3'000'000);
        m.rps_running = false;
        checkup_step(ms, mb, m, 4'000'000);
        CHECK(mb.censored_runs == 1 && mb.space_runs == 0);
        CHECK(mb.cycling_outdoor.samples == 0);
    }

    // --- the edge, which is the whole reason this is not derived from the trend rings -----------
    {
        CheckupState  st;
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
        CHECK(b.starts == 1); // still running is not another start

        // No valve was readable in any of that, so the operating class established NOTHING — not a
        // classified run and not a paired second either.
        CHECK(b.class_observed_s == 0 && b.space_run_s == 0 && b.dhw_run_s == 0);
        CHECK(b.space_runs == 0 && b.dhw_runs == 0);
    }
    {
        // ── the operating class is a PAIRED reading, and the pairing runs both ways ─────────────
        // The compressor witness is on page 0x30 and the 3-way valve on 0x60, so either can time
        // out alone. The paired clock only advances when both answered in the SAME sample.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known   = true;
        s.rps_running = true;
        s.valve_known = false;
        checkup_step(st, b, s, 1'000'000);
        checkup_step(st, b, s, 2'000'000); // witness only
        CHECK(b.run_s == 1 && b.class_observed_s == 0);
        s.valve_known    = true;
        s.valve_dhw      = false;
        s.operating_mode = CheckupOperatingMode::Heating;
        s.rps_known      = false;
        s.rps_running    = false;
        checkup_step(st, b, s, 3'000'000); // valve only
        CHECK(b.class_observed_s == 0);
        s.rps_known   = true;
        s.rps_running = true;
        checkup_step(st, b, s, 4'000'000); // both
        CHECK(b.class_observed_s == 1);
    }
    {
        // ── A RUN IS THE UNIT, AND ONLY A COMPLETED ONE COUNTS ──────────────────────────────────
        // Two clean runs on opposite sides of the valve, each witnessed start to stop.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known      = true;
        s.valve_known    = true;
        s.operating_mode = CheckupOperatingMode::Heating;
        s.rps_running    = false;
        s.valve_dhw      = false;
        int64_t t        = 0;
        auto    tick     = [&](int secs, bool running, bool dhw) {
            for (int i = 0; i < secs; i++) {
                t += 1'000'000;
                s.rps_running = running;
                s.valve_dhw   = dhw;
                checkup_step(st, b, s, t);
            }
        };
        tick(1, false, false);
        tick(600, true, false); // ten minutes on the space circuit
        tick(1, false, false);  // stop -> the run completes
        CHECK(b.space_runs == 1 && b.space_run_s == 600);
        tick(1200, true, true); // twenty minutes charging the tank
        tick(1, false, true);
        CHECK(b.dhw_runs == 1 && b.dhw_run_s == 1200);
        CHECK(b.censored_runs == 0 && b.starts == 2);

        // The same valve position is also used for cooling, so the I/U mode is the load-bearing
        // second witness. A positively identified cooling run is reported but never judged as heat.
        s.operating_mode = CheckupOperatingMode::Cooling;
        tick(300, true, false);
        tick(1, false, false);
        CHECK(b.cooling_runs == 1 && b.space_runs == 1 && b.starts == 3);

        // Valve position alone cannot see a heating-to-cooling change. A mode change inside the
        // same compressor run makes the whole run mixed rather than crediting either class.
        s.operating_mode = CheckupOperatingMode::Heating;
        tick(60, true, false);
        s.operating_mode = CheckupOperatingMode::Cooling;
        tick(60, true, false);
        tick(1, false, false);
        CHECK(b.censored_runs == 1 && b.cooling_runs == 1 && b.space_runs == 1 && b.starts == 4);

        // A run still IN FLIGHT contributes nothing: it has not completed, so it has no duration to
        // put in a mean. This is the window-edge censoring, and it needs no code of its own.
        s.operating_mode = CheckupOperatingMode::Heating;
        tick(300, true, false);
        CHECK(b.space_runs == 1 && b.space_run_s == 600);
    }
    {
        // ── THE REVIEWER'S REPRODUCER (#443): a valve switch is not a compressor cycle ──────────
        // Twelve runs, each 25 minutes long and each handing over to the tank after five — ordinary
        // DHW priority. Splitting SECONDS by the valve while the START stays where the run began
        // reported a five-minute mean over twelve starts, i.e. short cycling on a plant whose every
        // run lasted 25 minutes. Classified as runs, all twelve are MIXED: judged by neither side,
        // counted so their absence from the verdict is visible.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known      = true;
        s.valve_known    = true;
        s.operating_mode = CheckupOperatingMode::Heating;
        s.rps_running    = false;
        s.valve_dhw      = false;
        int64_t t        = 0;
        auto    tick     = [&](int secs, bool running, bool dhw) {
            for (int i = 0; i < secs; i++) {
                t += 1'000'000;
                s.rps_running = running;
                s.valve_dhw   = dhw;
                checkup_step(st, b, s, t);
            }
        };
        tick(1, false, false);
        for (int run = 0; run < 12; run++) {
            tick(300, true, false); // five minutes of space heating
            tick(1200, true, true); // hands over to the tank, compressor never stops
            tick(60, false, true);  // and only then stops
        }
        CHECK(b.starts == 12);
        CHECK(b.space_runs == 0 && b.space_run_s == 0);
        CHECK(b.dhw_runs == 0 && b.dhw_run_s == 0);
        CHECK(b.censored_runs == 12);

        // The same shape the other way round — tank first, then space — must censor identically.
        CheckupState  st2;
        CheckupBucket b2;
        CheckupSample s2;
        s2.rps_known      = true;
        s2.valve_known    = true;
        s2.operating_mode = CheckupOperatingMode::Heating;
        s2.rps_running    = false;
        s2.valve_dhw      = true;
        int64_t t2        = 0;
        auto    tick2     = [&](int secs, bool running, bool dhw) {
            for (int i = 0; i < secs; i++) {
                t2 += 1'000'000;
                s2.rps_running = running;
                s2.valve_dhw   = dhw;
                checkup_step(st2, b2, s2, t2);
            }
        };
        tick2(1, false, true);
        tick2(600, true, true);
        tick2(300, true, false); // hands back to the space circuit
        tick2(1, false, false);
        CHECK(b2.censored_runs == 1 && b2.space_runs == 0 && b2.dhw_runs == 0);
    }
    {
        // A valve that stops answering for PART of a run forfeits the run's class — the side cannot
        // be asserted to have held — while an unreadable COMPRESSOR row forfeits it because the
        // duration stops being witnessed. Both are censored, not guessed.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known      = true;
        s.valve_known    = true;
        s.operating_mode = CheckupOperatingMode::Heating;
        s.rps_running    = false;
        s.valve_dhw      = false;
        int64_t t        = 0;
        auto    tick     = [&](int secs, bool running, bool valve_known, bool rps_known_now) {
            for (int i = 0; i < secs; i++) {
                t += 1'000'000;
                s.rps_running = running;
                s.valve_known = valve_known;
                s.rps_known   = rps_known_now;
                checkup_step(st, b, s, t);
            }
        };
        tick(1, false, true, true);
        tick(200, true, true, true);
        tick(5, true, false, true); // the valve page timed out mid-run
        tick(200, true, true, true);
        tick(1, false, true, true);
        CHECK(b.censored_runs == 1 && b.space_runs == 0);

        CheckupState  st2;
        CheckupBucket b2;
        CheckupSample s2;
        s2.rps_known      = true;
        s2.valve_known    = true;
        s2.rps_running    = false;
        s2.valve_dhw      = false;
        s2.operating_mode = CheckupOperatingMode::Heating;
        int64_t t2        = 0;
        for (int i = 0; i < 1; i++) {
            t2 += 1'000'000;
            checkup_step(st2, b2, s2, t2);
        }
        s2.rps_running = true;
        for (int i = 0; i < 200; i++) {
            t2 += 1'000'000;
            checkup_step(st2, b2, s2, t2);
        }
        s2.rps_known = false; // the compressor page timed out mid-run
        for (int i = 0; i < 3; i++) {
            t2 += 1'000'000;
            checkup_step(st2, b2, s2, t2);
        }
        s2.rps_known = true;
        for (int i = 0; i < 200; i++) {
            t2 += 1'000'000;
            checkup_step(st2, b2, s2, t2);
        }
        s2.rps_running = false;
        t2 += 1'000'000;
        checkup_step(st2, b2, s2, t2);
        CHECK(b2.censored_runs == 1 && b2.space_runs == 0);
    }
    {
        // The compressor page can disappear while the stop occurs and return already OFF. The old
        // implementation waited forever for a known ON->OFF edge, then overwrote the still-open run
        // at the next start. Known OFF now closes it as censored exactly once.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known = s.valve_known = true;
        s.operating_mode            = CheckupOperatingMode::Heating;
        checkup_step(st, b, s, 0);
        s.rps_running = true;
        checkup_step(st, b, s, 1'000'000);
        s.rps_known = false;
        checkup_step(st, b, s, 2'000'000);
        s.rps_known   = true;
        s.rps_running = false;
        checkup_step(st, b, s, 3'000'000);
        CHECK(b.censored_runs == 1 && !st.run_open);
        checkup_step(st, b, s, 4'000'000);
        CHECK(b.censored_runs == 1); // a second OFF is not another completion
    }
    {
        // A POLL GAP inside a run: the firmware was not watching, so neither the length nor the
        // side can be asserted. The run is closed as censored — it happened — rather than dropped.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known      = true;
        s.valve_known    = true;
        s.operating_mode = CheckupOperatingMode::Heating;
        s.rps_running    = false;
        s.valve_dhw      = false;
        int64_t t        = 0;
        t += 1'000'000;
        checkup_step(st, b, s, t);
        s.rps_running = true;
        for (int i = 0; i < 100; i++) {
            t += 1'000'000;
            checkup_step(st, b, s, t);
        }
        t += static_cast<int64_t>(CHECKUP_MAX_GAP_S + 5) * 1'000'000;
        checkup_step(st, b, s, t); // the gap itself
        CHECK(b.censored_runs == 1 && b.space_runs == 0);
        // …and the post-gap running samples do not resurrect it: no start edge crossed the gap, so
        // there is no open run to accrue into.
        for (int i = 0; i < 100; i++) {
            t += 1'000'000;
            checkup_step(st, b, s, t);
        }
        s.rps_running = false;
        t += 1'000'000;
        checkup_step(st, b, s, t);
        CHECK(b.censored_runs == 1 && b.space_runs == 0 && b.dhw_runs == 0);
    }
    {
        // Complete-run statistics age with the START edge. A run whose start is already outside the
        // retained 24-hour ring is censored in the current bucket; its pre-window duration may not
        // re-enter the class mean through the stop bucket.
        CheckupRing r;
        for (uint32_t i = 0; i < CHECKUP_COMPLETED_BUCKETS; i++) r.commit(0);
        CheckupState st;
        st.run_open = st.run_class_pure = true;
        st.run_class                    = CheckupRunClass::SpaceHeating;
        st.run_start_bucket             = 0;
        st.run_s                        = 25u * 3600u;
        CHECK(!checkup_close_run(st, r.pending, &r, CHECKUP_BUCKETS));
        CHECK(r.pending.space_runs == 0 && r.pending.space_run_s == 0);
        CHECK(r.pending.censored_runs == 1);

        // A retained start is booked back into its own completed bucket and tells the caller to
        // re-seal the persisted ring. It must not inflate the current pending hour.
        CheckupState kept;
        kept.run_open = kept.run_class_pure = true;
        kept.run_class                      = CheckupRunClass::SpaceHeating;
        kept.run_start_bucket               = CHECKUP_BUCKETS - 1;
        kept.run_s                          = 300;
        CHECK(checkup_close_run(kept, r.pending, &r, CHECKUP_BUCKETS));
        CHECK(r.pending.space_runs == 0);
        const CheckupWindow retained = checkup_aggregate(r);
        CHECK(retained.space_runs == 1 && retained.space_run_s == 300);
    }
    {
        // UNKNOWN is not stopped — the rule logic/ou_stale.hpp states, applied to an edge. A
        // profile that stops reporting the witness for one cycle must not book a stop and then a
        // start.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known   = true;
        s.rps_running = true;
        checkup_step(st, b, s, 1'000'000);
        checkup_step(st, b, s, 2'000'000);
        s.rps_known   = false;
        s.rps_running = false; // the row went missing this cycle
        checkup_step(st, b, s, 3'000'000);
        s.rps_known   = true;
        s.rps_running = true;
        checkup_step(st, b, s, 4'000'000);
        CHECK(b.starts == 0); // no phantom start across the unknown cycle
        // Three deltas were observed (the first sample of a boot has no predecessor and books
        // nothing) and the UNKNOWN one is not among the running ones.
        CHECK(b.run_s == 2);
    }
    {
        // A POLL GAP breaks continuity in both directions: no seconds, and no transition. Without
        // this a two-minute bus stall would book two minutes of whatever preceded it and one start
        // that may in truth have been three.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known   = true;
        s.rps_running = false;
        checkup_step(st, b, s, 1'000'000);
        s.rps_running = true;
        checkup_step(st, b, s, 1'000'000 + (CHECKUP_MAX_GAP_S + 5) * 1'000'000LL);
        CHECK(b.starts == 0);
        CHECK(b.covered_s == 0);
        // …and the very next in-window sample still cannot use the pre-gap state as its
        // predecessor: the gap cycle has already replaced it (with the same value here, so the next
        // transition is measured from the post-gap reading, which is the only one that was
        // observed).
        s.rps_running = false;
        checkup_step(st, b, s, 1'000'000 + (CHECKUP_MAX_GAP_S + 6) * 1'000'000LL);
        s.rps_running = true;
        checkup_step(st, b, s, 1'000'000 + (CHECKUP_MAX_GAP_S + 7) * 1'000'000LL);
        CHECK(b.starts == 1);
        // A gap exactly at the limit is still continuous — the boundary is inclusive.
        CheckupState  st2;
        CheckupBucket b2;
        CheckupSample s2;
        s2.rps_known   = true;
        s2.rps_running = true;
        checkup_step(st2, b2, s2, 0);
        checkup_step(st2, b2, s2, CHECKUP_MAX_GAP_S * 1'000'000LL);
        CHECK(b2.covered_s == CHECKUP_MAX_GAP_S);
        // One microsecond beyond the inclusive limit is already an observation gap. Comparing
        // truncated whole seconds would incorrectly accept almost another full second.
        CheckupState  st3;
        CheckupBucket b3;
        CheckupSample s3;
        s3.rps_known   = true;
        s3.rps_running = false;
        checkup_step(st3, b3, s3, 0);
        s3.rps_running = true;
        checkup_step(st3, b3, s3, CHECKUP_MAX_GAP_S * 1'000'000LL + 1);
        CHECK(b3.covered_s == 0 && b3.starts == 0);

        // Real polling is one second PLUS the serial sweep (~1.2–1.3 s on this catalog). Fractional
        // time must telescope instead of being discarded once per sample, or 90% can never mature.
        CheckupState  jitter_st;
        CheckupBucket jitter_b;
        CheckupSample jitter;
        jitter.rps_known = jitter.rps_running = true;
        checkup_step(jitter_st, jitter_b, jitter, 0);
        for (int i = 1; i <= 100; i++)
            checkup_step(jitter_st, jitter_b, jitter, static_cast<int64_t>(i) * 1'250'000);
        CHECK(jitter_b.covered_s == 125);
        CHECK(jitter_b.rps_observed_s == 125);
        CHECK(jitter_b.run_s == 125);
    }
    {
        // Defrost edges remain direct facts without an RPS row, but runtime/share evidence only
        // accrues while both signals are simultaneously readable.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.defrost_known = true;
        s.defrost_on    = false;
        checkup_step(st, b, s, 1'000'000);
        s.defrost_on = true;
        checkup_step(st, b, s, 2'000'000);
        CHECK(b.defrosts == 1);
        CHECK(b.paired_defrosts == 0);
        CHECK(b.dfr_observed_s == 1 && b.dfr_pair_observed_s == 0 && b.defrost_s == 0);

        s.rps_known   = true;
        s.rps_running = true;
        checkup_step(st, b, s, 3'000'000);
        CHECK(b.defrosts == 1);
        CHECK(b.dfr_observed_s == 2 && b.dfr_pair_observed_s == 1);
        CHECK(b.dfr_run_s == 1 && b.defrost_s == 1);
        s.defrost_on = false;
        checkup_step(st, b, s, 4'000'000);
        s.defrost_on = true;
        checkup_step(st, b, s, 5'000'000);
        CHECK(b.defrosts == 2 && b.paired_defrosts == 1);
    }
    {
        // Signal-specific evidence. One continuous poll interval can establish different amounts
        // for every check; global bus coverage is never a substitute for a missing row.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.rps_known = s.rps_running = true;
        s.defrost_known = s.defrost_on = true;
        s.buh_known = s.buh_on = true;
        s.bsh_known = s.bsh_on = true;
        s.bar_ok               = true;
        s.bar_tenths           = 18;
        s.pump_known           = true;
        s.pump_on              = false;
        s.flow_ok              = true;
        s.flow_tenths          = 2;
        s.retry_expected_mask = s.retry_known_mask = 0x1f;
        s.retry_value[0]                           = 3;
        s.fault                                    = FaultClass::Normal;
        checkup_step(st, b, s, 0);
        checkup_step(st, b, s, 1'000'000);
        CHECK(b.covered_s == 1 && b.rps_observed_s == 1 && b.run_s == 1);
        CHECK(b.dfr_observed_s == 1 && b.dfr_pair_observed_s == 1);
        CHECK(b.dfr_run_s == 1 && b.defrost_s == 1);
        CHECK(b.buh_observed_s == 1 && b.buh_s == 1);
        CHECK(b.bsh_observed_s == 1 && b.bsh_s == 1);
        CHECK(b.bar_observed_s == 1 && b.min_bar == 18);
        CHECK(b.flow_observed_s == 0 && b.min_flow == CHECKUP_ABSENT);
        CHECK(b.retry_observed_s == 1 && (b.flags & CHECKUP_F_RETRY) == 0);

        // A continuous cycle carrying no usable signal does not inflate even global card coverage.
        CheckupSample unknown;
        checkup_step(st, b, unknown, 2'000'000);
        CHECK(b.covered_s == 1 && b.rps_observed_s == 1 && b.bar_observed_s == 1);
    }
    {
        // A low-pressure sample is always part of the raw minimum; debounce may only control the
        // warning strength, never rewrite the statistic into a more reassuring number.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample low;
        low.bar_ok     = true;
        low.bar_tenths = CHECKUP_BAR_WARN_TENTHS;
        checkup_step(st, b, low, 0);
        for (uint32_t second = 1; second < CHECKUP_PRESSURE_CONFIRM_S; second++)
            checkup_step(st, b, low, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.bar_observed_s == CHECKUP_PRESSURE_CONFIRM_S - 1);
        CHECK(b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((b.flags & CHECKUP_F_LOW_BAR) == 0);
        checkup_step(st, b, low, static_cast<int64_t>(CHECKUP_PRESSURE_CONFIRM_S) * 1'000'000);
        CHECK(b.bar_observed_s == CHECKUP_PRESSURE_CONFIRM_S);
        CHECK(b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((b.flags & CHECKUP_F_LOW_BAR) != 0);
    }
    {
        // conv 105 is signed, but these hydronic sensors are not bidirectional. A corrupt negative
        // pressure is missing evidence, not a warning whose numeric JSON field later becomes null.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.bar_ok     = true;
        s.bar_tenths = -1;
        checkup_step(st, b, s, 0);
        checkup_step(st, b, s, 1'000'000);
        CHECK(b.bar_observed_s == 0);
        CHECK(b.min_bar == CHECKUP_ABSENT);
        CHECK(b.covered_s == 0);
    }
    {
        // Recovery above 1.0 bar resets confirmation. Raw minima remain raw across both spells,
        // while only one uninterrupted minute sets the separate warning fact.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.bar_ok     = true;
        s.bar_tenths = CHECKUP_BAR_WARN_TENTHS;
        checkup_step(st, b, s, 0);
        for (int second = 1; second <= 30; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        s.bar_tenths = CHECKUP_BAR_WARN_TENTHS + 7;
        checkup_step(st, b, s, 31'000'000);
        CHECK(b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((b.flags & CHECKUP_F_LOW_BAR) == 0);

        s.bar_tenths = CHECKUP_BAR_WARN_TENTHS - 1;
        for (int second = 32; second <= 90; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.min_bar == CHECKUP_BAR_WARN_TENTHS - 1);
        CHECK((b.flags & CHECKUP_F_LOW_BAR) == 0);
        checkup_step(st, b, s, 91'000'000);
        CHECK(b.min_bar == CHECKUP_BAR_WARN_TENTHS - 1);
        CHECK((b.flags & CHECKUP_F_LOW_BAR) != 0);
    }
    {
        // Missing pressure and a long poll gap both break continuity; neither permits two partial
        // low sequences to be added into a warning.
        CheckupState  missing_st;
        CheckupBucket missing_b;
        CheckupSample s;
        s.bar_ok     = true;
        s.bar_tenths = CHECKUP_BAR_WARN_TENTHS;
        checkup_step(missing_st, missing_b, s, 0);
        for (int second = 1; second <= 30; second++)
            checkup_step(missing_st, missing_b, s, static_cast<int64_t>(second) * 1'000'000);
        s.bar_ok = false;
        checkup_step(missing_st, missing_b, s, 31'000'000);
        s.bar_ok = true;
        for (int second = 32; second <= 90; second++)
            checkup_step(missing_st, missing_b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(missing_b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((missing_b.flags & CHECKUP_F_LOW_BAR) == 0);
        checkup_step(missing_st, missing_b, s, 91'000'000);
        CHECK(missing_b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((missing_b.flags & CHECKUP_F_LOW_BAR) != 0);

        CheckupState  gap_st;
        CheckupBucket gap_b;
        checkup_step(gap_st, gap_b, s, 0);
        for (int second = 1; second <= 30; second++)
            checkup_step(gap_st, gap_b, s, static_cast<int64_t>(second) * 1'000'000);
        const int64_t after_gap =
            30'000'000LL + static_cast<int64_t>(CHECKUP_MAX_GAP_S + 1) * 1'000'000;
        checkup_step(gap_st, gap_b, s, after_gap);
        for (uint32_t second = 1; second < CHECKUP_PRESSURE_CONFIRM_S; second++)
            checkup_step(gap_st, gap_b, s, after_gap + static_cast<int64_t>(second) * 1'000'000);
        CHECK(gap_b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((gap_b.flags & CHECKUP_F_LOW_BAR) == 0);
        checkup_step(gap_st, gap_b, s,
                     after_gap + static_cast<int64_t>(CHECKUP_PRESSURE_CONFIRM_S) * 1'000'000);
        CHECK(gap_b.min_bar == CHECKUP_BAR_WARN_TENTHS);
        CHECK((gap_b.flags & CHECKUP_F_LOW_BAR) != 0);
    }
    {
        // Flow is a steady-state observation. The first known-ON sample is only a baseline, the
        // following 60 seconds are run-up, and only time strictly beyond that run-up is evidence.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.pump_known  = true;
        s.pump_on     = false;
        s.flow_ok     = true;
        s.flow_tenths = 0;
        checkup_step(st, b, s, 0);

        s.pump_on     = true;
        s.flow_tenths = 2;
        for (int second = 1; second <= 60; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.min_flow == CHECKUP_ABSENT && b.flow_observed_s == 0);

        // At the exact boundary a steady-state sample may become the observed minimum, but no
        // post-run-up second has elapsed yet.
        s.flow_tenths = 140;
        checkup_step(st, b, s, 61'000'000);
        CHECK(b.min_flow == 140 && b.flow_observed_s == 0);
        for (int second = 62; second <= 121; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.min_flow == 140 && b.flow_observed_s == CHECKUP_MIN_S_FLOW);

        // Known OFF resets. A low transient in the next run-up cannot replace the prior minimum.
        s.pump_on     = false;
        s.flow_tenths = 0;
        checkup_step(st, b, s, 122'000'000);
        s.pump_on     = true;
        s.flow_tenths = 1;
        for (int second = 123; second <= 182; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.min_flow == 140 && b.flow_observed_s == CHECKUP_MIN_S_FLOW);
        s.flow_tenths = 160;
        checkup_step(st, b, s, 183'000'000);
        CHECK(b.min_flow == 140 && b.flow_observed_s == CHECKUP_MIN_S_FLOW);
        checkup_step(st, b, s, 184'000'000);
        CHECK(b.flow_observed_s == CHECKUP_MIN_S_FLOW + 1);

        // UNKNOWN resets too.
        s.pump_known = false;
        checkup_step(st, b, s, 185'000'000);
        s.pump_known  = true;
        s.flow_tenths = 1;
        for (int second = 186; second <= 245; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.min_flow == 140 && b.flow_observed_s == CHECKUP_MIN_S_FLOW + 1);
        s.flow_tenths = 160;
        checkup_step(st, b, s, 246'000'000);
        CHECK(b.flow_observed_s == CHECKUP_MIN_S_FLOW + 1);
        checkup_step(st, b, s, 247'000'000);
        CHECK(b.flow_observed_s == CHECKUP_MIN_S_FLOW + 2);

        // A scheduling/bus gap also resets without booking the low post-gap sample.
        s.flow_tenths = 1;
        const int64_t after_gap =
            247'000'000LL + static_cast<int64_t>(CHECKUP_MAX_GAP_S + 1) * 1'000'000;
        checkup_step(st, b, s, after_gap);
        checkup_step(st, b, s, after_gap + 1'000'000);
        CHECK(b.min_flow == 140 && b.flow_observed_s == CHECKUP_MIN_S_FLOW + 2);
    }
    {
        // A negative signed-converter artefact after run-up is likewise not a physical flow sample.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s;
        s.pump_known  = true;
        s.pump_on     = true;
        s.flow_ok     = true;
        s.flow_tenths = -1;
        checkup_step(st, b, s, 0);
        for (uint32_t second = 1; second <= CHECKUP_FLOW_RUNUP_S + CHECKUP_MIN_S_FLOW; second++)
            checkup_step(st, b, s, static_cast<int64_t>(second) * 1'000'000);
        CHECK(b.flow_observed_s == 0);
        CHECK(b.min_flow == CHECKUP_ABSENT);
    }
    {
        auto retry_sample = []() {
            CheckupSample s;
            s.rps_known           = true;
            s.rps_running         = true;
            s.retry_expected_mask = s.retry_known_mask = 0x1f;
            return s;
        };

        // A non-zero first value is only a baseline. Stable non-zero values remain no event.
        CheckupState  st;
        CheckupBucket b;
        CheckupSample s  = retry_sample();
        s.retry_value[0] = 3;
        checkup_step(st, b, s, 0);
        checkup_step(st, b, s, 1'000'000);
        CHECK((b.flags & CHECKUP_F_RETRY) == 0 && b.retry_observed_s == 1);

        // Comparable no-event evidence is valid while stopped too. A strict increase is still an
        // event: the counter itself changed inside the observed interval, even if its update became
        // visible at a run-state boundary rather than between two running samples.
        CheckupState  stopped_st;
        CheckupBucket stopped_b;
        s                = retry_sample();
        s.rps_running    = false;
        s.retry_value[0] = 3;
        checkup_step(stopped_st, stopped_b, s, 0);
        s.retry_value[0] = 4;
        checkup_step(stopped_st, stopped_b, s, 1'000'000);
        CHECK(stopped_b.retry_observed_s == 1);
        CHECK((stopped_b.flags & CHECKUP_F_RETRY) != 0);

        CheckupState  transition_st;
        CheckupBucket transition_b;
        s                = retry_sample();
        s.rps_running    = false;
        s.retry_value[0] = 3;
        checkup_step(transition_st, transition_b, s, 0);
        s.rps_running    = true;
        s.retry_value[0] = 4;
        checkup_step(transition_st, transition_b, s, 1'000'000);
        CHECK(transition_b.retry_observed_s == 1);
        CHECK((transition_b.flags & CHECKUP_F_RETRY) != 0);

        // Per-counter identity catches an increase hidden below another counter's stable maximum.
        s                = retry_sample();
        s.retry_value[0] = 3;
        s.retry_value[1] = 6;
        checkup_step(st, b, s, 2'000'000);
        s.retry_value[0] = 4; // max remains 6
        checkup_step(st, b, s, 3'000'000);
        CHECK((b.flags & CHECKUP_F_RETRY) != 0);

        // A decrease/reset is not a wrap or an event; the next strict increase is.
        CheckupState  reset_st;
        CheckupBucket reset_b;
        s                = retry_sample();
        s.retry_value[0] = 7;
        checkup_step(reset_st, reset_b, s, 0);
        s.retry_value[0] = 0;
        checkup_step(reset_st, reset_b, s, 1'000'000);
        CHECK((reset_b.flags & CHECKUP_F_RETRY) == 0);
        CHECK(reset_b.retry_observed_s == 0); // reset interval is not no-event evidence
        s.retry_value[0] = 1;
        checkup_step(reset_st, reset_b, s, 2'000'000);
        CHECK((reset_b.flags & CHECKUP_F_RETRY) != 0);
        CHECK(reset_b.retry_observed_s == 1);

        // Missing evidence re-baselines; no increase is invented across it.
        CheckupState  miss_st;
        CheckupBucket miss_b;
        s                = retry_sample();
        s.retry_value[0] = 2;
        checkup_step(miss_st, miss_b, s, 0);
        s.retry_known_mask = 0;
        checkup_step(miss_st, miss_b, s, 1'000'000);
        s.retry_known_mask = 0x1f;
        s.retry_value[0]   = 4;
        checkup_step(miss_st, miss_b, s, 2'000'000);
        CHECK((miss_b.flags & CHECKUP_F_RETRY) == 0);
        s.retry_value[0] = 5;
        checkup_step(miss_st, miss_b, s, 3'000'000);
        CHECK((miss_b.flags & CHECKUP_F_RETRY) != 0);

        // A long gap also re-baselines. The first clean post-gap increase is observable.
        CheckupState  gap_st;
        CheckupBucket gap_b;
        s                = retry_sample();
        s.retry_value[0] = 2;
        checkup_step(gap_st, gap_b, s, 0);
        s.retry_value[0] = 4;
        checkup_step(gap_st, gap_b, s, 100'000'000);
        CHECK((gap_b.flags & CHECKUP_F_RETRY) == 0);
        s.retry_value[0] = 5;
        checkup_step(gap_st, gap_b, s, 101'000'000);
        CHECK((gap_b.flags & CHECKUP_F_RETRY) != 0);

        // No-event coverage needs every counter the profile says it supplies.
        CheckupState  partial_st;
        CheckupBucket partial_b;
        s                  = retry_sample();
        s.retry_known_mask = 0x01;
        checkup_step(partial_st, partial_b, s, 0);
        checkup_step(partial_st, partial_b, s, 1'000'000);
        CHECK(partial_b.retry_observed_s == 0);
        s.retry_known_mask = 0x1f;
        checkup_step(partial_st, partial_b, s, 2'000'000);
        CHECK(partial_b.retry_observed_s == 0);
        checkup_step(partial_st, partial_b, s, 3'000'000);
        CHECK(partial_b.retry_observed_s == 1);
    }
    {
        // The fault flags come from conv 203's OWN class table (logic/fault_state.hpp), so a class
        // renamed there is understood here for free — and an UNKNOWN class sets neither flag, which
        // is the one direction a fault report must never fail in.
        CheckupState  st;
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
        CHECK((b.flags & CHECKUP_F_FAULT) != 0); // the flag is "happened", not "is happening"
    }

    // --- the ring -------------------------------------------------------------------------------
    {
        CheckupRing r;
        r.pending.starts    = 3;
        r.pending.covered_s = 3600;
        r.commit(0);
        CHECK(r.count == 1);
        CHECK(r.pending.starts == 0 && r.pending.covered_s == 0); // the next hour starts empty
        CheckupWindow w = checkup_aggregate(r);
        CHECK(w.starts == 3 && w.covered_s == 3600);

        // A skipped hour is pushed EMPTY, never filled with a guess: nobody watched it, so it
        // contributed nothing — which is exactly what keeps covered_s an honest number.
        r.pending.starts    = 2;
        r.pending.covered_s = 3600;
        r.commit(2);
        CHECK(r.count == 4);
        w = checkup_aggregate(r);
        CHECK(w.starts == 5 && w.covered_s == 7200); // 2 hours observed out of 4 elapsed
    }
    {
        // The pending hour is part of, not in addition to, the 24-hour window. Before the first
        // complete lifecycle 23 full buckets plus half a pending hour are 23.5 h, never 24.5 h.
        // Start one second before an hourly boundary: this is the adversarial phase where counting
        // boundaries alone would claim a full day almost one hour early.
        CheckupRing   r;
        const int64_t first_us = CHECKUP_WINDOW_US / CHECKUP_BUCKETS - 1'000'000;
        r.observe(first_us);
        for (unsigned i = 0; i < CHECKUP_COMPLETED_BUCKETS; i++) {
            r.pending.starts    = 1;
            r.pending.covered_s = CHECKUP_DT_S;
            r.commit(0);
        }
        r.observe(static_cast<int64_t>(CHECKUP_COMPLETED_BUCKETS) * CHECKUP_DT_S * 1'000'000 +
                  CHECKUP_DT_S * 500'000LL);
        CHECK(r.count == CHECKUP_COMPLETED_BUCKETS);
        CHECK(r.age_buckets == CHECKUP_COMPLETED_BUCKETS);
        r.pending.starts    = 2;
        r.pending.covered_s = CHECKUP_DT_S / 2;
        CheckupWindow w     = checkup_aggregate(r);
        CHECK(!w.full_span);
        CHECK(w.starts == CHECKUP_COMPLETED_BUCKETS + 2);
        CHECK(w.covered_s == CHECKUP_COMPLETED_BUCKETS * CHECKUP_DT_S + CHECKUP_DT_S / 2);
        CHECK(w.covered_s <= CHECKUP_WINDOW_S);

        // Crossing the 24th boundary evicts the oldest completed bucket, but only about 23 real
        // hours elapsed from the phase-shifted first sample. It must not unlock a clear verdict.
        r.commit(0);
        r.observe(static_cast<int64_t>(CHECKUP_BUCKETS) * CHECKUP_DT_S * 1'000'000);
        w = checkup_aggregate(r);
        CHECK(!w.full_span && r.age_buckets == CHECKUP_BUCKETS);
        CHECK(r.count == CHECKUP_COMPLETED_BUCKETS);
        CHECK(w.starts == (CHECKUP_COMPLETED_BUCKETS - 1) + 2);
        CHECK(w.covered_s <= CHECKUP_WINDOW_S);

        // The real monotonic 24-hour point, not a bucket count, opens the absence-of-pattern gate.
        r.observe(first_us + CHECKUP_WINDOW_US - 1);
        CHECK(!checkup_aggregate(r).full_span);
        r.observe(first_us + CHECKUP_WINDOW_US);
        CHECK(checkup_aggregate(r).full_span);

        // Even a full pending bucket cannot make the aggregate exceed 24 hours.
        r.pending.covered_s = CHECKUP_DT_S;
        CHECK(checkup_aggregate(r).covered_s <= CHECKUP_WINDOW_S);

        // A skip larger than the whole ring must not run away; the original event ages out.
        CheckupRing r2;
        r2.observe(0);
        r2.pending.starts = 9;
        r2.commit(100000);
        r2.observe(CHECKUP_WINDOW_US);
        CHECK(r2.count == CHECKUP_COMPLETED_BUCKETS);
        CHECK(r2.age_buckets == CHECKUP_BUCKETS);
        CHECK(checkup_aggregate(r2).starts == 0);
        CHECK(checkup_aggregate(r2).full_span);
    }
    {
        // The window minimum is the minimum ACROSS buckets, and an hour that measured nothing does
        // not drag it to a sentinel.
        CheckupRing r;
        r.pending.min_bar = 18;
        r.commit(0);
        r.commit(0); // an hour with no pressure reading at all
        r.pending.min_bar = 11;
        CheckupWindow w   = checkup_aggregate(r);
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
        CHECK(r.count == 0 && r.age_buckets == 0 && checkup_aggregate(r).starts == 0);
        CHECK(!checkup_aggregate(r).full_span);
    }
    {
        // Hour rollover is commit-first. The caller sets last_us to the boundary instant so no old
        // duration leaks into the new hour, but leaves the tri-state witnesses intact: a current
        // edge and current fault belong to the new bucket and must not disappear at xx:00.
        CheckupRing   r;
        CheckupState  st;
        CheckupSample before;
        before.rps_known   = true;
        before.rps_running = false;
        checkup_step(st, r.pending, before, 3'599'000'000LL);
        r.commit(0);

        const int64_t boundary_us = 3'600'000'000LL;
        st.last_us                = boundary_us;
        CheckupSample at_boundary;
        at_boundary.rps_known   = true;
        at_boundary.rps_running = true;
        at_boundary.fault       = FaultClass::Error;
        checkup_step(st, r.pending, at_boundary, boundary_us);
        CHECK(r.pending.starts == 1);
        CHECK((r.pending.flags & CHECKUP_F_FAULT) != 0);
        CHECK(r.pending.covered_s == 0 && r.pending.run_s == 0);
        CHECK(r.buf[0].starts == 0 && (r.buf[0].flags & CHECKUP_F_FAULT) == 0);
    }

    {
        // DHW cooling is built from clean, non-overlapping one-hour R5T windows. With actual Shelly
        // power known OFF continuously, a 1.0 K/h decline becomes attributable only after the
        // independent two-hour off-settling guard; the first hour is still a real high-loss
        // finding, just not yet an off-pump one.
        DhwLossState  st;
        DhwLossBucket b;
        CheckupSample s;
        s.valve_known = s.pump_known = s.bsh_known = true;
        s.valve_dhw = s.pump_on = s.bsh_on = false;
        s.r5t_ok                           = true;
        s.circulation_configured = s.circulation_known = true;
        s.circulation_on                               = false;
        for (int sec = 0; sec <= 2 * 3600 + 10; sec += 10) {
            s.r5t_tenths = 500 - sec / 360; // exactly 1.0 K/h at 0.1 K resolution
            dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(b.windows == 2 && b.high_windows == 2 && b.max_loss_tenths_k_h == 10);
        CHECK(b.high_with_pump == 0 && b.high_pump_off == 1);
        CHECK(b.circulation_on_s == 0 && b.circulation_known_s >= 2 * 3600 - 10);

        // The same measured loss with ~5.7 W continuously present is correlated with pump
        // operation.
        DhwLossState  on_st;
        DhwLossBucket on_b;
        s.circulation_on = true;
        for (int sec = 0; sec <= 3610; sec += 10) {
            s.r5t_tenths = 500 - sec / 360;
            dhw_loss_step(on_st, on_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(on_b.windows == 1 && on_b.high_with_pump == 1 && on_b.high_pump_off == 0);

        // A 0.4 K step inside ten minutes is draw-like contamination. It resets the candidate
        // rather than becoming a spectacular heat-loss rate in the diagnosis.
        DhwLossState  draw_st;
        DhwLossBucket draw_b;
        s.circulation_on = false;
        for (int sec = 0; sec <= 3600; sec += 10) {
            s.r5t_tenths = sec < 300 ? 500 : 496;
            dhw_loss_step(draw_st, draw_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(draw_b.windows == 0 && draw_b.high_windows == 0);

        // THE BLIND BAND, pinned so it stays visible and so widening the filter shows up HERE as a
        // deliberate change rather than as a quiet behavioural drift. The draw filter cannot tell a
        // steady decline from a draw, so above ~1.85 K/h no window ever completes and the check
        // answers `collecting` forever — in the severity range it exists to find (a leaking
        // diverter is by definition worse than the 1.2 K/h healthy-with-circulation reference
        // figure). The constant carries the measurement and why raising it is a domain decision.
        auto windows_at = [](int tenths_per_h) {
            DhwLossState  rs;
            DhwLossBucket rb;
            CheckupSample r;
            r.valve_known = r.pump_known = r.bsh_known = true;
            r.valve_dhw = r.pump_on = r.bsh_on = false;
            r.r5t_ok                           = true;
            r.circulation_configured = r.circulation_known = true;
            r.circulation_on                               = false;
            for (int sec = 0; sec <= 4 * 3600; sec += 10) {
                r.r5t_tenths = 900 - (sec * tenths_per_h) / 3600;
                dhw_loss_step(rs, rb, r, static_cast<int64_t>(sec) * 1000000);
            }
            return static_cast<int>(rb.windows);
        };
        CHECK(windows_at(8) == 3);  // 0.8 K/h — the high-loss threshold itself, seen
        CHECK(windows_at(12) == 3); // 1.2 K/h — the healthy-with-circulation reference, seen
        CHECK(windows_at(18) == 3); // 1.8 K/h — the last rate fully seen
        CHECK(windows_at(19) == 0); // 1.9 K/h — and from here the check is structurally blind
        CHECK(windows_at(60) == 0); // 6.0 K/h — a severe standing loss reports nothing at all

        // A positive tank-charge witness starts the 45-minute settling guard even when a different
        // state row timed out in the same sweep. Recovering that row must not admit the charge
        // tail.
        DhwLossState  settle_st;
        DhwLossBucket settle_b;
        s.valve_known = true;
        s.valve_dhw   = true;
        s.pump_known  = false;
        s.bsh_known   = true;
        s.bsh_on      = false;
        s.r5t_tenths  = 500;
        dhw_loss_step(settle_st, settle_b, s, 0);
        CHECK(settle_st.settle_remaining_s == DHW_LOSS_SETTLE_S);
        s.valve_dhw  = false;
        s.pump_known = true;
        dhw_loss_step(settle_st, settle_b, s, 10'000'000);
        CHECK(settle_st.settle_remaining_s == DHW_LOSS_SETTLE_S - 10);
        CHECK(settle_st.segment_start_us < 0 && settle_b.windows == 0);

        // An intentional reboot checkpoints relative ages, not the old boot's esp_timer values.
        // The candidate keeps every OBSERVED second, while the fixed reboot seam is booked as blind
        // and therefore cannot buy evidence.  Another clean half-hour completes the original hour.
        DhwLossState  ota_st;
        DhwLossBucket ota_b;
        s.valve_known = s.pump_known = s.bsh_known = true;
        s.valve_dhw = s.pump_on = s.bsh_on = false;
        s.r5t_ok                           = true;
        s.circulation_configured = s.circulation_known = true;
        s.circulation_on                               = false;
        for (int sec = 0; sec <= 1800; sec += 10) {
            s.r5t_tenths = 500 - sec / 720;
            dhw_loss_step(ota_st, ota_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(dhw_loss_progress(ota_st, 1800LL * 1000000).candidate_observed_s == 1790);
        const DhwLossCarry carry = dhw_loss_checkpoint(ota_st, 1800LL * 1000000);
        DhwLossState       adopted;
        dhw_loss_adopt(adopted, carry, 0);
        CHECK(adopted.segment_blind_s == DHW_LOSS_REBOOT_BLIND_S);
        CHECK(dhw_loss_progress(adopted, 0).candidate_observed_s == 1790);
        for (int sec = 10; sec <= 1810; sec += 10) {
            s.r5t_tenths = 498 - sec / 720;
            dhw_loss_step(adopted, ota_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(ota_b.windows == 1);
        CHECK(ota_b.observed_s == 3600);

        // Repeated dev-channel OTAs shorter than one hour used to make this check collect forever.
        // Four 15-minute boots now finish one clean hour; each handoff preserves the pending bucket
        // just as checkup.cpp's shutdown payload does.
        DhwLossState  short_boot;
        DhwLossBucket short_pending;
        unsigned      observed_total = 0;
        for (int boot = 0; boot < 4; boot++) {
            for (int sec = 10; sec <= 910; sec += 10) {
                observed_total += 10;
                s.r5t_tenths = 500 - static_cast<int>(observed_total / 720);
                dhw_loss_step(short_boot, short_pending, s, static_cast<int64_t>(sec) * 1000000);
            }
            if (boot < 3) {
                const DhwLossCarry handoff = dhw_loss_checkpoint(short_boot, 910LL * 1000000);
                DhwLossState       next;
                dhw_loss_adopt(next, handoff, 0);
                short_boot = next;
            }
        }
        CHECK(short_pending.windows == 1);
        CHECK(short_pending.observed_s >= DHW_LOSS_WINDOW_S - 3 * DHW_LOSS_REBOOT_BLIND_S);
        CHECK(short_pending.observed_s <= DHW_LOSS_WINDOW_S);

        // Settling is a safety gate, not observed evidence.  It survives unchanged: downtime is
        // unknown and therefore cannot be used to spend the remaining 45-minute guard.
        const DhwLossCarry settle_carry = dhw_loss_checkpoint(settle_st, 10'000'000);
        DhwLossState       settle_adopted;
        dhw_loss_adopt(settle_adopted, settle_carry, 0);
        CHECK(settle_adopted.settle_remaining_s == DHW_LOSS_SETTLE_S - 10);
        CHECK(dhw_loss_progress(settle_adopted, 0).candidate_observed_s == 0);
    }

    {
        // A CHARGE WITNESS TOO SHORT TO HAVE PUT HEAT IN COSTS NO SETTLING TIME.
        //
        // The settle exists because a freshly heated tank redistributes; that is a claim about heat
        // entering the tank, and one poll cycle of "3-way valve on DHW" put none in. It used to arm
        // the full 45 minutes anyway, so a blip and a 40-minute charge cost the identical 105
        // minutes (settle + a fresh hour) — and a plant that blips more often than that reported
        // `0 min of 6 h` forever with every input present and correct.
        auto quiet = [](int tenths) {
            CheckupSample s;
            s.valve_known = s.pump_known = s.bsh_known = true;
            s.r5t_ok                                   = true;
            s.r5t_tenths                               = tenths;
            return s;
        };

        // Continuous samples, so the "unmeasured gap counts as proven" branch is not what arms it.
        DhwLossState  st;
        DhwLossBucket b;
        int64_t       us = 0;
        // Two quiet samples: the first only establishes continuity, the second opens the candidate.
        for (int sec = 0; sec <= 10; sec++)
            dhw_loss_step(st, b, quiet(500), static_cast<int64_t>(sec) * 1000000);
        CHECK(st.segment_start_us >= 0);
        for (int sec = 11; sec <= 40; sec++) { // 30 s of charge witness
            us              = static_cast<int64_t>(sec) * 1000000;
            CheckupSample s = quiet(500);
            s.valve_dhw     = true;
            dhw_loss_step(st, b, s, us);
        }
        CHECK(st.charge_run_s == 30);
        CHECK(st.settle_remaining_s == 0); // under the two-minute bound
        // …but the candidate still ended: the hydronics moved, so the tank was not standing.
        CHECK(st.segment_start_us < 0);
        CHECK(b.aborts == 1 && b.abort_reasons == DHW_ABORT_CHARGE);

        // Past the bound the same witness is a charge again and earns the full settle.
        for (int sec = 41; sec <= static_cast<int>(DHW_LOSS_CHARGE_MIN_S) + 15; sec++) {
            us              = static_cast<int64_t>(sec) * 1000000;
            CheckupSample s = quiet(500);
            s.valve_dhw     = true;
            dhw_loss_step(st, b, s, us);
        }
        CHECK(st.settle_remaining_s == DHW_LOSS_SETTLE_S);
        // One charge is ONE discarded candidate, not one per second of it.
        CHECK(b.aborts == 1);
        // Dropping the witness releases the accumulated run, so two short blips never add up.
        dhw_loss_step(st, b, quiet(500), us + 1000000);
        CHECK(st.charge_run_s == 0);

        // A TIMED-OUT SWEEP INSIDE A CHARGE DOES NOT RESTART THE CLOCK. Both witnesses ride page
        // 0x60, so one silent page makes `heating_tank` false without the charge having stopped.
        // Clearing the run there would mean a charge ending soon after a timeout armed NO settle
        // and its own tail was measured as standing tank loss — a leak reported where there is
        // none, which is the one direction this check must never fail in.
        DhwLossState  blind_st;
        DhwLossBucket blind_b;
        for (int sec = 0; sec <= 10; sec++)
            dhw_loss_step(blind_st, blind_b, quiet(500), static_cast<int64_t>(sec) * 1000000);
        for (int sec = 11; sec <= 110; sec++) { // 100 s of real charge
            CheckupSample s = quiet(500);
            s.valve_dhw     = true;
            dhw_loss_step(blind_st, blind_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(blind_st.charge_run_s == 100 && blind_st.settle_remaining_s == 0);
        { // page 0x60 misses one sweep
            CheckupSample s = quiet(500);
            s.valve_known = s.bsh_known = false;
            dhw_loss_step(blind_st, blind_b, s, 111LL * 1000000);
        }
        CHECK(blind_st.charge_run_s == 100);     // NOT restarted
        for (int sec = 112; sec <= 140; sec++) { // the charge continues
            CheckupSample s = quiet(500);
            s.valve_dhw     = true;
            dhw_loss_step(blind_st, blind_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(blind_st.settle_remaining_s == DHW_LOSS_SETTLE_S);
        // A READABLE not-charging sweep does clear it, so two separate blips never add up.
        dhw_loss_step(blind_st, blind_b, quiet(500), 141LL * 1000000);
        CHECK(blind_st.charge_run_s == 0);

        // BSH is the second witness and is bounded identically.
        DhwLossState  bsh_st;
        DhwLossBucket bsh_b;
        for (int sec = 0; sec <= 10; sec++)
            dhw_loss_step(bsh_st, bsh_b, quiet(500), static_cast<int64_t>(sec) * 1000000);
        for (int sec = 11; sec <= 40; sec++) {
            CheckupSample s = quiet(500);
            s.bsh_on        = true;
            dhw_loss_step(bsh_st, bsh_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(bsh_st.settle_remaining_s == 0 && bsh_b.abort_reasons == DHW_ABORT_CHARGE);

        // AN UNMEASURED GAP COUNTS AS PROVEN CHARGE TIME. A witness seen across an interval nobody
        // watched could have run for all of it, and guessing SHORT there would admit a real
        // charge's tail as tank loss — the one direction that must stay impossible.
        DhwLossState  gap_st;
        DhwLossBucket gap_b;
        CheckupSample charging = quiet(500);
        charging.valve_dhw     = true;
        dhw_loss_step(gap_st, gap_b, charging, 0); // first sample of a boot
        CHECK(gap_st.settle_remaining_s == DHW_LOSS_SETTLE_S);

        // A charge STRADDLING an intentional reboot keeps its accumulated run: restarting the clock
        // would let a 40-minute charge that spans an OTA look like a fresh blip and skip its
        // settle.
        DhwLossState  span_st;
        DhwLossBucket span_b;
        dhw_loss_step(span_st, span_b, quiet(500), 0);
        for (int sec = 1; sec <= 90; sec++) {
            CheckupSample s = quiet(500);
            s.valve_dhw     = true;
            dhw_loss_step(span_st, span_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(span_st.settle_remaining_s == 0 && span_st.charge_run_s == 90);
        DhwLossState resumed;
        dhw_loss_adopt(resumed, dhw_loss_checkpoint(span_st, 90LL * 1000000), 0);
        CHECK(resumed.charge_run_s == 90);
        for (int sec = 1; sec <= 40; sec++) {
            CheckupSample s = quiet(500);
            s.valve_dhw     = true;
            dhw_loss_step(resumed, span_b, s, static_cast<int64_t>(sec) * 1000000);
        }
        CHECK(resumed.settle_remaining_s == DHW_LOSS_SETTLE_S);

        // THE MEASURED DEFECT, END TO END. One ~1 s valve blip every 90 minutes over 24 h on an
        // otherwise perfect standing tank: zero completed windows before this bound existed.
        auto blips_every = [&quiet](uint32_t period_s) {
            DhwLossState  s_st;
            DhwLossBucket s_b;
            for (uint64_t ms = 0; ms < 24ull * 3600 * 1000; ms += 1200) {
                const uint32_t sec = static_cast<uint32_t>(ms / 1000);
                CheckupSample  s   = quiet(558 - static_cast<int>(sec / 1200)); // 0.3 K/h
                s.valve_dhw        = (sec % period_s) < 2;
                dhw_loss_step(s_st, s_b, s, static_cast<int64_t>(ms) * 1000);
            }
            return s_b;
        };
        CHECK(blips_every(90 * 60).windows > 0);
        // The blip still discards the candidate hour, so a plant blipping faster than the window
        // itself still yields nothing — the fix is proportionality, not permissiveness.
        CHECK(blips_every(45 * 60).windows == 0);
        CHECK(blips_every(45 * 60).aborts > 0);
    }

    {
        // WHAT THE WINDOW DISCARDED, and the verdict that follows from it. Each disqualifier books
        // its own reason so the card can name where to look; the settle's per-cycle reset does not,
        // because the charge that armed it already booked one and there is no candidate left.
        auto standing = []() {
            CheckupSample s;
            s.valve_known = s.pump_known = s.bsh_known = true;
            s.r5t_ok                                   = true;
            s.r5t_tenths                               = 500;
            return s;
        };
        auto aborted_by = [&standing](void (*disturb)(CheckupSample&)) {
            DhwLossState  st;
            DhwLossBucket b;
            for (int sec = 0; sec <= 600; sec++) // 10 min of clean candidate
                dhw_loss_step(st, b, standing(), static_cast<int64_t>(sec) * 1000000);
            CheckupSample s = standing();
            disturb(s);
            dhw_loss_step(st, b, s, 601LL * 1000000);
            return b;
        };
        const DhwLossBucket by_pump = aborted_by([](CheckupSample& s) { s.pump_on = true; });
        CHECK(by_pump.aborts == 1 && by_pump.abort_reasons == DHW_ABORT_PUMP);
        // How far the best one got is what separates "close, but interrupted" from "never starts".
        CHECK(by_pump.best_aborted_s == 600);
        const DhwLossBucket by_reading = aborted_by([](CheckupSample& s) { s.r5t_tenths = 950; });
        CHECK(by_reading.abort_reasons == DHW_ABORT_READING);
        const DhwLossBucket by_draw = aborted_by([](CheckupSample& s) { s.r5t_tenths = 495; });
        CHECK(by_draw.abort_reasons == DHW_ABORT_DRAW);
        const DhwLossBucket by_blind = aborted_by([](CheckupSample& s) { s.r5t_ok = false; });
        CHECK(by_blind.aborts == 0); // one unread sweep is inside the blind budget
        {
            // …but exhausting that budget is an abort, and it says so.
            DhwLossState  st;
            DhwLossBucket b;
            for (int sec = 0; sec <= 600; sec++)
                dhw_loss_step(st, b, standing(), static_cast<int64_t>(sec) * 1000000);
            for (int sec = 601; sec <= 601 + 2 * static_cast<int>(DHW_LOSS_BLIND_RUN_MAX_S);
                 sec++) {
                CheckupSample s = standing();
                s.r5t_ok        = false;
                dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
            }
            CHECK(b.aborts == 1 && b.abort_reasons == DHW_ABORT_BLIND);
        }
        {
            // The settle's own resets are not aborts: one charge, one discarded candidate.
            DhwLossState  st;
            DhwLossBucket b;
            for (int sec = 0; sec <= 600; sec++)
                dhw_loss_step(st, b, standing(), static_cast<int64_t>(sec) * 1000000);
            for (int sec = 601; sec <= 900; sec++) {
                CheckupSample s = standing();
                s.valve_dhw     = true;
                dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
            }
            for (int sec = 901; sec <= 1500; sec++) // settling, 10 min of it
                dhw_loss_step(st, b, standing(), static_cast<int64_t>(sec) * 1000000);
            CHECK(b.aborts == 1);
        }

        // THE VERDICT. A full lifecycle with no completed window and six discarded ones is a plant
        // that will not grant the method its 105 minutes — a different answer from "not yet", and
        // reported as Unavailable so it says nothing either way instead of holding the whole card
        // at `collecting` for the life of the installation.
        CheckupCoverage cov;
        cov.r5t = cov.valve = cov.pump = cov.bsh = true;
        CheckupWindow w;
        w.full_span = true;
        DhwLossWindow dhw;
        dhw.aborts         = DHW_LOSS_BLOCKED_MIN_ABORTS;
        dhw.abort_reasons  = DHW_ABORT_CHARGE | DHW_ABORT_PUMP;
        dhw.best_aborted_s = 2400;
        {
            const CheckupReport r = checkup_evaluate(w, cov, FaultClass::Normal, dhw);
            CHECK(r[CheckupCheck::DhwLoss].verdict == CheckupVerdict::Unavailable);
            CHECK(r.dhw_blocked);
            CHECK(r.dhw_aborts == DHW_LOSS_BLOCKED_MIN_ABORTS);
            CHECK(r.dhw_best_aborted_s == 2400);
            CHECK(r.dhw_abort_reasons == (DHW_ABORT_CHARGE | DHW_ABORT_PUMP));
            // Unavailable says nothing either way: it must not be counted as an assessable check
            // and must not drag the card's overall verdict.
            CHECK(r.overall != CheckupVerdict::Collecting);
        }
        // One abort short of the bar is still "not yet".
        dhw.aborts = DHW_LOSS_BLOCKED_MIN_ABORTS - 1;
        {
            const CheckupReport r = checkup_evaluate(w, cov, FaultClass::Normal, dhw);
            CHECK(r[CheckupCheck::DhwLoss].verdict == CheckupVerdict::Collecting);
            CHECK(!r.dhw_blocked);
        }
        // A DEAD BUS measured nothing and discarded nothing — `collecting` stays the honest answer
        // there, which is exactly what `aborts` separates.
        dhw.aborts = 0;
        CHECK(checkup_evaluate(w, cov, FaultClass::Normal, dhw)[CheckupCheck::DhwLoss].verdict ==
              CheckupVerdict::Collecting);
        // An incomplete lifecycle is never blocked, however many candidates it lost.
        dhw.aborts  = 50;
        w.full_span = false;
        CHECK(checkup_evaluate(w, cov, FaultClass::Normal, dhw)[CheckupCheck::DhwLoss].verdict ==
              CheckupVerdict::Collecting);
        // A FINDING always outranks it: a high window is evidence, and evidence is never withheld
        // because the plant is also busy.
        w.full_span             = true;
        dhw.high_windows        = 1;
        dhw.max_loss_tenths_k_h = 12;
        {
            const CheckupReport r = checkup_evaluate(w, cov, FaultClass::Normal, dhw);
            CHECK(r[CheckupCheck::DhwLoss].verdict == CheckupVerdict::Info);
            CHECK(!r.dhw_blocked);
            // The account of what was discarded is still reported — it explains a thin sample.
            CHECK(r.dhw_aborts == 50);
        }
        // A profile that cannot supply the rows is the OTHER Unavailable and must not claim this
        // one: the two need opposite advice, so `dhw_blocked` distinguishes them.
        cov.valve = false;
        CHECK(!checkup_evaluate(w, cov, FaultClass::Normal, dhw).dhw_blocked);
    }

    {
        // The handoff CRC covers the charge run, so a charge straddling a reboot cannot be silently
        // dropped or forged by a stale record.
        DhwLossHandoffPayload p;
        p.candidate.charge_run_s = 90;
        const uint32_t crc       = checkup_dhw_handoff_crc(7, p);
        p.candidate.charge_run_s = 91;
        CHECK(checkup_dhw_handoff_crc(7, p) != crc);
        // …and the ring's new counters ride the same seal.
        p.candidate.charge_run_s = 90;
        p.pending.aborts         = 1;
        CHECK(checkup_dhw_handoff_crc(7, p) != crc);
        p.pending.aborts        = 0;
        p.pending.abort_reasons = DHW_ABORT_PUMP;
        CHECK(checkup_dhw_handoff_crc(7, p) != crc);
        p.pending.abort_reasons  = 0;
        p.pending.best_aborted_s = 60;
        CHECK(checkup_dhw_handoff_crc(7, p) != crc);
    }

    {
        // A PAGE THAT DID NOT ANSWER IS MISSING EVIDENCE, NOT A PLANT STATE. Every input this check
        // needs rides the X10A sweep, where one timed-out read removes all of that page's rows from
        // the cycle (hp_poll replaces the cache with the rows that answered) — valve/pump/BSH on
        // 0x60, R5T on 0x61. Treating that second as ineligible discarded the whole accumulated
        // hour, and on the reference installation (47 timeouts in 8.2 h of uptime) that meant the
        // check reported `collecting`, 0 min of 6 h, on a plant whose rows were all present: the
        // same 24 h replayed without the drop-outs yields 12 completed windows.
        //
        // One second of blindness per hour, at the poll cadence, on an otherwise perfect standing
        // tank. `blind_at` returns the completed windows plus the seconds the window CLAIMS to have
        // observed, because the second half is what keeps the first honest.
        auto blind_at = [](int blind_from_s, int blind_len_s, bool drop_page_60,
                           int* observed_out) {
            DhwLossState  st;
            DhwLossBucket b;
            CheckupSample s;
            s.valve_dhw = s.pump_on = s.bsh_on = false;
            s.circulation_configured = s.circulation_known = true;
            s.circulation_on                               = false;
            for (int sec = 0; sec <= 3700; sec++) {
                const bool blind = sec >= blind_from_s && sec < blind_from_s + blind_len_s;
                s.valve_known = s.pump_known = s.bsh_known = !(blind && drop_page_60);
                s.r5t_ok                                   = !(blind && !drop_page_60);
                s.r5t_tenths = 500 - sec / 720; // 0.5 K/h — a healthy standing tank
                dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
            }
            if (observed_out) *observed_out = b.observed_s;
            return static_cast<int>(b.windows);
        };
        int observed = 0;
        CHECK(blind_at(1800, 1, true, &observed) == 1);  // page 0x60 silent for one cycle
        CHECK(observed == 3599);                         // the blind second is NOT claimed as seen
        CHECK(blind_at(1800, 1, false, &observed) == 1); // page 0x61 (R5T) silent for one cycle
        CHECK(observed == 3599);
        CHECK(blind_at(1800, 30, true, &observed) == 1); // a 30 s burst is still only a gap
        CHECK(observed == 3570);

        // …but a window may not be assembled out of absence. Both bounds end the segment: a single
        // unobserved RUN long enough to hide a tank charge, and a TOTAL past the 90%-evidence shape
        // the circulation witness already uses.
        CHECK(blind_at(1800, DHW_LOSS_BLIND_RUN_MAX_S + 1, true, nullptr) == 0);
        int spread = 0;
        {
            DhwLossState  st;
            DhwLossBucket b;
            CheckupSample s;
            s.valve_dhw = s.pump_on = s.bsh_on = false;
            s.circulation_configured = s.circulation_known = true;
            for (int sec = 0; sec <= 3700; sec++) {
                const bool blind = (sec % 6) == 0; // ~17% of the hour, every run short
                s.valve_known = s.pump_known = s.bsh_known = !blind;
                s.r5t_ok                                   = true;
                s.r5t_tenths                               = 500 - sec / 720;
                dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
            }
            spread = b.windows;
        }
        CHECK(spread == 0);

        // A DRAW hidden inside a blind run is still caught: the anchor standing when vision was
        // lost is what the first sighted sample is judged against, before it is re-armed.
        {
            DhwLossState  st;
            DhwLossBucket b;
            CheckupSample s;
            s.valve_dhw = s.pump_on = s.bsh_on = false;
            s.circulation_configured = s.circulation_known = true;
            for (int sec = 0; sec <= 3700; sec++) {
                const bool blind = sec >= 1800 && sec < 1830;
                s.valve_known = s.pump_known = s.bsh_known = true;
                s.r5t_ok                                   = !blind;
                s.r5t_tenths = sec < 1800 ? 500 : 494; // 0.6 K vanished while unobserved
                dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
            }
            CHECK(b.windows == 0);
        }

        // And a state the sweep CAN see stays disqualifying. The fix separates "unknown" from
        // "known and busy"; it must not make the second permissive.
        {
            DhwLossState  st;
            DhwLossBucket b;
            CheckupSample s;
            s.valve_known = s.pump_known = s.bsh_known = true;
            s.valve_dhw = s.bsh_on = false;
            s.r5t_ok               = true;
            for (int sec = 0; sec <= 3700; sec++) {
                s.pump_on    = sec == 1800; // one second of space-heating circulation
                s.r5t_tenths = 500 - sec / 720;
                dhw_loss_step(st, b, s, static_cast<int64_t>(sec) * 1000000);
            }
            CHECK(b.windows == 0);
        }
    }

    // --- verdicts -------------------------------------------------------------------------------
    // Full capability and a complete evidence window unless a case says otherwise.
    CheckupCoverage full;
    full.rps = full.defrost = full.buh = full.buh1 = full.buh2 = full.bsh = full.pump = true;
    full.pressure = full.flow = full.fault = full.retries = true;
    full.fault_rows                                       = 2;
    full.retry_mask                                       = 0x1f;

    auto day = []() {
        CheckupWindow w;
        w.full_span      = true;
        w.covered_s      = CHECKUP_REQUIRED_S;
        w.rps_observed_s = CHECKUP_REQUIRED_S;
        // The PAIRED compressor+valve clock the operating-class split rests on. Part of "a complete
        // evidence window" like every other clock here; cases that mean a sparse valve row say so.
        w.class_observed_s    = CHECKUP_REQUIRED_S;
        w.dfr_observed_s      = CHECKUP_REQUIRED_S;
        w.dfr_pair_observed_s = CHECKUP_REQUIRED_S;
        w.dfr_run_s           = 3600; // establishes a denominator for the defrost-share heuristic
        w.buh_observed_s      = CHECKUP_REQUIRED_S;
        w.bsh_observed_s      = CHECKUP_REQUIRED_S;
        w.bar_observed_s      = CHECKUP_REQUIRED_S;
        w.flow_observed_s     = CHECKUP_MIN_S_FLOW;
        w.retry_observed_s    = CHECKUP_REQUIRED_S;
        w.min_bar             = 17;
        w.min_flow            = 150;
        return w;
    };

    {
        // Outdoor context is additive evidence only. Give two otherwise identical windows wildly
        // different weather and pin every verdict/accounting field to the same result: no future
        // refactor may quietly turn temperature into permission or a threshold input.
        CheckupWindow without = day();
        without.starts        = 20;
        without.run_s         = 20u * 240;
        without.defrosts = without.paired_defrosts = CHECKUP_DEFROST_MIN_COUNT;
        without.defrost_s                          = 200;
        without.dfr_run_s                          = 1000;
        CheckupWindow with                         = without;
        with.cycling_outdoor_min_tenths            = -300;
        with.cycling_outdoor_sum_tenths            = 3'000;
        with.cycling_outdoor_samples               = 100;
        with.defrost_outdoor_min_tenths            = 450;
        with.defrost_outdoor_sum_tenths            = -2'000;
        with.defrost_outdoor_samples               = 50;
        const CheckupReport a = checkup_evaluate(without, full, FaultClass::Normal);
        const CheckupReport b = checkup_evaluate(with, full, FaultClass::Normal);
        CHECK(b.cycling_outdoor.samples == 100 && b.defrost_outdoor.samples == 50);
        CHECK(a.overall == b.overall && a.available == b.available &&
              a.assessable == b.assessable && a.evaluated == b.evaluated);
        for (size_t i = 0; i < CHECKUP_CHECK_COUNT; i++)
            CHECK(a.checks[i].verdict == b.checks[i].verdict);
    }

    {
        // A supported locator is capability, not evidence. Until at least one interval was actually
        // readable, zero starts/cycles/heater seconds would be invented facts and must stay null.
        CheckupWindow w;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].a == -1);
            CHECK(r[CheckupCheck::Defrost].a == -1 && r[CheckupCheck::Defrost].e == -1);
            CHECK(r[CheckupCheck::Heater].a == -1 && r[CheckupCheck::Heater].b == -1);
        }

        // Once one interval was observed as known-off, zero becomes a real partial observation.
        w.rps_observed_s      = 1;
        w.dfr_observed_s      = 1;
        w.dfr_pair_observed_s = 1;
        w.buh_observed_s      = 1;
        w.bsh_observed_s      = 1;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].a == 0);
            CHECK(r[CheckupCheck::Defrost].a == 0 && r[CheckupCheck::Defrost].e == 0);
            CHECK(r[CheckupCheck::Heater].a == 0 && r[CheckupCheck::Heater].b == 0);
        }

        // Raw defrost coverage may be complete while the RPS witness has never been readable. The
        // paired transition count remains unknown until the first jointly observed interval.
        w                     = day();
        w.dfr_pair_observed_s = 0;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].e == -1);
        w.dfr_pair_observed_s = 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].e == 0);
    }

    {
        // Cycling has no per-cycle operating mode. Even a very short mean is therefore a heuristic
        // Info, never a fault/limit warning.
        CheckupWindow w = day();
        w.starts        = 24;
        w.run_s         = 24u * 1800;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        w.run_s = 24u * CHECKUP_CYCLING_SHORT_RUN_S;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        w.run_s = 24u * (CHECKUP_CYCLING_SHORT_RUN_S - 1);
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Cycling].a == 24);
            CHECK(r[CheckupCheck::Cycling].b == static_cast<int>(CHECKUP_CYCLING_SHORT_RUN_S) - 1);
            CHECK(r.overall == CheckupVerdict::Info);
        }
        w.starts = CHECKUP_CYCLING_MIN_STARTS - 1;
        w.run_s  = w.starts * 60;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        w.starts = CHECKUP_CYCLING_MIN_STARTS;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Info);

        // Twelve short heating-like runs plus one long DHW-like run demonstrate why the combined
        // mean cannot classify the short runs. It remains context, with no universal Warn either
        // way.
        w.starts                  = 13;
        w.run_s                   = 12u * 300 + 2u * 3600;
        const CheckupReport mixed = checkup_evaluate(w, full, FaultClass::Normal);
        CHECK(mixed[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
        CHECK(mixed[CheckupCheck::Cycling].b == static_cast<int>(w.run_s / w.starts));

        w.starts                 = 0;
        w.run_s                  = 0;
        const CheckupReport idle = checkup_evaluate(w, full, FaultClass::Normal);
        CHECK(idle[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
        CHECK(idle[CheckupCheck::Cycling].a == 0);
    }
    {
        // ── the operating-class split, once the 3-way valve is readable ─────────────────────────
        // `full` deliberately carries no valve row, so every case above is the POOLED fallback and
        // stays exactly as it was. These are the same windows judged with the valve in hand.
        CheckupCoverage split = full;
        split.valve = split.mode = true;

        // THE FINDING THE POOLED MEAN COULD NOT REACH, and it is the block above's own example:
        // twelve five-minute space runs beside one two-hour tank charge. Pooled, the long charge
        // lifts the mean to 13.8 minutes and the day reads Ok. Per completed run, the space circuit
        // is cycling at five minutes with the tank's runtime out of both halves of the ratio.
        CheckupWindow w = day();
        w.starts        = 13;
        w.run_s         = 12u * 300 + 2u * 3600;
        w.space_runs    = 12;
        w.space_run_s   = 12u * 300;
        w.dhw_runs      = 1;
        w.dhw_run_s     = 2u * 3600;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok); // no valve row: pooled, and masked
        {
            const CheckupReport r = checkup_evaluate(w, split, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Info);
            CHECK(r.overall == CheckupVerdict::Info);
            CHECK(r.cycling_split);
            // The pooled pair stays on the wire as the day's total — still a fact, no longer a
            // decision.
            CHECK(r[CheckupCheck::Cycling].a == 13);
            CHECK(r[CheckupCheck::Cycling].b == static_cast<int>(w.run_s / w.starts));
            CHECK(r[CheckupCheck::Cycling].c == 12 && r[CheckupCheck::Cycling].d == 300);
            CHECK(r[CheckupCheck::Cycling].e == 1 && r[CheckupCheck::Cycling].f == 2 * 3600);
            CHECK(r[CheckupCheck::Cycling].g == 0); // nothing was censored in this day
        }

        // And the OTHER direction the same pooling produced: a tank charging in many short bursts
        // is the plant doing its job, and pooled it reads as a finding. The DHW class is
        // observation.
        w.starts      = 32;
        w.space_runs  = 2;
        w.space_run_s = 2u * 3600;
        w.dhw_runs    = 30;
        w.dhw_run_s   = 30u * 120;
        w.run_s       = w.space_run_s + w.dhw_run_s;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Info); // pooled: the tank's own duty, called out
        {
            const CheckupReport r = checkup_evaluate(w, split, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Cycling].e == 30 && r[CheckupCheck::Cycling].f == 120);
        }

        // ── THE STALL (#443 live review): catalog capability is not evidence ────────────────────
        // A profile that CARRIES the valve row on a plant whose valve page never answers. Before
        // this rule the paired clock stayed pinned at 0, could never reach 90% of 24 h, and a check
        // that had always worked from the compressor witness alone read `0 min of 21 h 36 min`
        // forever — while the card printed `space 0` beside sixteen real starts.
        CheckupWindow silent    = day();
        silent.class_observed_s = 0;
        silent.starts           = 16;
        silent.run_s            = 16u * 3600;
        {
            const CheckupReport r = checkup_evaluate(silent, split, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict != CheckupVerdict::Collecting);
            CHECK(!r.cycling_split); // the pooled figure decided, and says so
            CHECK(r[CheckupCheck::Cycling].observed_s == silent.rps_observed_s);
            CHECK(r[CheckupCheck::Cycling].a == 16);
            // NOT zero: nothing about the class was ever witnessed, and a rendered 0 reads as "no
            // space heating ran today" beside sixteen starts that did.
            CHECK(r[CheckupCheck::Cycling].c == -1 && r[CheckupCheck::Cycling].d == -1);
            CHECK(r[CheckupCheck::Cycling].e == -1 && r[CheckupCheck::Cycling].g == -1);
        }
        // One witnessed second is enough to make the counts real observations again, while the
        // VERDICT still falls back until the pair clears the same bar the check has always used.
        silent.class_observed_s = 1;
        {
            const CheckupReport r = checkup_evaluate(silent, split, FaultClass::Normal);
            CHECK(!r.cycling_split);
            CHECK(r[CheckupCheck::Cycling].c == 0 && r[CheckupCheck::Cycling].g == 0);
        }

        // The verdict rests on the paired clock only once that clock cleared the bar; the READINESS
        // gate stays on the compressor witness, so the row can never be starved into collecting.
        w.class_observed_s = CHECKUP_REQUIRED_S - 1;
        {
            const CheckupReport r = checkup_evaluate(w, split, FaultClass::Normal);
            CHECK(!r.cycling_split);
            CHECK(r[CheckupCheck::Cycling].verdict != CheckupVerdict::Collecting);
            CHECK(r[CheckupCheck::Cycling].observed_s == w.rps_observed_s);
            CHECK(r[CheckupCheck::Cycling].c == 2); // the class facts are still published
        }
        w.class_observed_s = CHECKUP_REQUIRED_S;
        CHECK(checkup_evaluate(w, split, FaultClass::Normal).cycling_split);

        // Without the valve row in the catalog at all, the class fields are UNESTABLISHED.
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].c == -1 && r[CheckupCheck::Cycling].d == -1);
            CHECK(r[CheckupCheck::Cycling].e == -1 && r[CheckupCheck::Cycling].f == -1);
            CHECK(r[CheckupCheck::Cycling].g == -1);
            CHECK(r[CheckupCheck::Cycling].observed_s == w.rps_observed_s);
        }

        // The twelve-run bound is a bound on the JUDGED population: eleven short space runs cannot
        // borrow a busy tank's runs to clear it.
        w.dhw_runs    = 20;
        w.dhw_run_s   = 20u * 1200;
        w.space_runs  = CHECKUP_CYCLING_MIN_STARTS - 1;
        w.space_run_s = w.space_runs * 60;
        w.starts      = w.space_runs + w.dhw_runs;
        w.run_s       = w.space_run_s + w.dhw_run_s;
        CHECK(checkup_evaluate(w, split, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Ok);
        w.space_runs  = CHECKUP_CYCLING_MIN_STARTS;
        w.space_run_s = w.space_runs * 60;
        w.starts      = w.space_runs + w.dhw_runs;
        w.run_s       = w.space_run_s + w.dhw_run_s;
        CHECK(checkup_evaluate(w, split, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Info);

        // Runs that happened but could not be classified are PUBLISHED, so a day with no eligible
        // space run cannot be read as a day with no space heating.
        w.space_runs = w.dhw_runs = 0;
        w.space_run_s = w.dhw_run_s = 0;
        w.censored_runs             = 9;
        w.starts                    = 9;
        w.run_s                     = 9u * 1500;
        {
            const CheckupReport r = checkup_evaluate(w, split, FaultClass::Normal);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Cycling].c == 0 && r[CheckupCheck::Cycling].d == -1);
            CHECK(r[CheckupCheck::Cycling].g == 9);
            // ...and that Ok comes from the POOLED figure, not from an empty judged set. The
            // assertion above used to pass with `split` still true, which is the defect below.
            CHECK(!r.cycling_split);
        }

        // ── AN EMPTY JUDGED POPULATION IS NOT A CLEAN BILL (#443 second live round) ─────────────
        // The clock and the judged population are DIFFERENT measurements, and gating the split on
        // the clock alone was the same category error as gating it on catalog capability — the
        // third place it hid. `class_observed_s` counts seconds in which both rows were READABLE;
        // a valve that answers all day while moving mid-run yields a full clock and zero classified
        // runs. The split then judged an empty set, `notable` needed >= MIN_STARTS to fire, and the
        // day fell through to Ok: a green verdict resting on nothing, on exactly the DHW-priority
        // pattern the censoring rule exists for.
        //
        // The bar is therefore on the population the verdict is built from: unless enough runs were
        // classified AT ALL, the split has no picture of the day and the pooled figure decides —
        // the same degradation as a too-sparse clock, one step earlier.
        {
            CheckupWindow d       = day(); // 12 x 1500 s, every run handed over
            d.starts              = 12;
            d.run_s               = 12u * 1500;
            d.censored_runs       = 12;
            const CheckupReport r = checkup_evaluate(d, split, FaultClass::Normal);
            CHECK(!r.cycling_split); // no classified run -> pooled decides
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Cycling].b == 1500); // ...and Ok now has a number behind it
            CHECK(r[CheckupCheck::Cycling].c == 0 && r[CheckupCheck::Cycling].g == 12);
        }
        // The case that makes it matter rather than merely tidy: a plant that BOTH short-cycles and
        // hands over mid-run. Judging the empty space set returned Ok and lost the finding; the
        // pooled fallback keeps it.
        {
            CheckupWindow d       = day();
            d.starts              = 20;
            d.run_s               = 20u * 240;
            d.censored_runs       = 20;
            const CheckupReport r = checkup_evaluate(d, split, FaultClass::Normal);
            CHECK(!r.cycling_split);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Info);
        }
        // Twelve pure tank runs do not make twenty unclassified handovers evidence about space
        // heating. The old "twelve on either side" gate opened the split, judged space_runs=0 and
        // lost the pooled short-cycling finding. Classification coverage now fails closed.
        {
            CheckupWindow d       = day();
            d.dhw_runs            = 12;
            d.dhw_run_s           = 12u * 240u;
            d.censored_runs       = 20;
            d.starts              = 32;
            d.run_s               = 32u * 240u;
            const CheckupReport r = checkup_evaluate(d, split, FaultClass::Normal);
            CHECK(!r.cycling_split);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Info);
        }
        // Cooling is a positively known third class: it proves those room-circuit runs were not
        // heating and therefore neither pollutes the heating mean nor counts as censored evidence.
        {
            CheckupWindow d       = day();
            d.cooling_runs        = 12;
            d.starts              = 12;
            d.run_s               = 12u * 240u;
            const CheckupReport r = checkup_evaluate(d, split, FaultClass::Normal);
            CHECK(r.cycling_split);
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
            CHECK(r.cycling_cooling_runs == 12);
            CHECK(r[CheckupCheck::Cycling].c == 0); // no HEATING run was claimed
        }
        // And the fallback must NOT reach back for a day the split described perfectly well. A tank
        // charging in short bursts beside two long space runs classified every run it had: the
        // space population is small because the plant barely heated, not because classification
        // failed. Falling back there would restore the pooled false positive this PR removed.
        {
            CheckupWindow d       = day();
            d.space_runs          = 2;
            d.space_run_s         = 2u * 3600;
            d.dhw_runs            = 30;
            d.dhw_run_s           = 30u * 120;
            d.starts              = 32;
            d.run_s               = d.space_run_s + d.dhw_run_s;
            const CheckupReport r = checkup_evaluate(d, split, FaultClass::Normal);
            CHECK(r.cycling_split); // 32 runs classified: a real picture
            CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Ok);
            CHECK(checkup_evaluate(d, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
                  CheckupVerdict::Info); // what the pooled figure would have said
        }
    }
    {
        // A complete global bus window with sparse RPS evidence stays collecting. The row reports
        // its own evidence clock, not covered_s.
        CheckupWindow w       = day();
        w.rps_observed_s      = CHECKUP_REQUIRED_S - 1;
        w.starts              = 40;
        w.run_s               = 40 * 60;
        const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
        CHECK(r[CheckupCheck::Cycling].verdict == CheckupVerdict::Collecting);
        CHECK(r[CheckupCheck::Cycling].observed_s == CHECKUP_REQUIRED_S - 1);
        CHECK(r[CheckupCheck::Cycling].required_s == CHECKUP_REQUIRED_S);
        CHECK(r[CheckupCheck::Cycling].a == 40);
        CHECK(r.overall != CheckupVerdict::Ok);
        w.rps_observed_s = CHECKUP_REQUIRED_S;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Info);
        w.full_span = false;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Cycling].verdict ==
              CheckupVerdict::Collecting);
    }
    {
        // Defrost share uses paired RPS+defrost evidence and remains an Info heuristic at 20%.
        CheckupWindow w   = day();
        w.defrosts        = 6;
        w.paired_defrosts = 6;
        w.dfr_run_s       = 6u * 3600;
        w.defrost_s       = 1200;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Ok);
        w.defrost_s = w.dfr_run_s * 20 / 100;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Defrost].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Defrost].a == 6 && r[CheckupCheck::Defrost].b == 20);
            CHECK(r[CheckupCheck::Defrost].c == static_cast<int>(w.defrost_s));
            CHECK(r[CheckupCheck::Defrost].d == static_cast<int>(w.dfr_run_s));
        }
        // Verdict uses the raw ratio, not the rounded-down display percentage.
        w.defrosts        = CHECKUP_DEFROST_MIN_COUNT;
        w.paired_defrosts = CHECKUP_DEFROST_MIN_COUNT;
        w.dfr_run_s       = 1000;
        w.defrost_s       = 150;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Ok);
        w.defrost_s = 151;
        {
            const CheckupReport       r = checkup_evaluate(w, full, FaultClass::Normal);
            const CheckupCheckResult& c = r[CheckupCheck::Defrost];
            CHECK(c.verdict == CheckupVerdict::Info);
            CHECK(c.b == 15 && c.c == 151 && c.d == 1000);
        }
        w.defrost_s = 1;
        {
            const CheckupReport       r = checkup_evaluate(w, full, FaultClass::Normal);
            const CheckupCheckResult& c = r[CheckupCheck::Defrost];
            CHECK(c.verdict == CheckupVerdict::Ok);
            CHECK(c.b == 0 && c.c == 1 && c.d == 1000);
        }
        w.defrosts        = CHECKUP_DEFROST_MIN_COUNT - 1;
        w.paired_defrosts = CHECKUP_DEFROST_MIN_COUNT - 1;
        w.dfr_run_s       = 600;
        w.defrost_s       = 600;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Ok);

        // The count guard belongs to the paired ratio evidence, not the larger raw edge count.
        // Three raw cycles with only two paired transitions cannot lend the ratio a three-cycle
        // basis.
        w.defrosts        = CHECKUP_DEFROST_MIN_COUNT;
        w.paired_defrosts = CHECKUP_DEFROST_MIN_COUNT - 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Ok);
        w.paired_defrosts = CHECKUP_DEFROST_MIN_COUNT;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Info);

        // Without RPS the direct cycle count remains reportable, but it cannot adjudicate the ratio
        // heuristic and therefore must not increase the aggregate evaluated denominator.
        CheckupCoverage no_rps         = full;
        no_rps.rps                     = false;
        const CheckupReport count_only = checkup_evaluate(w, no_rps, FaultClass::Normal);
        CHECK(count_only[CheckupCheck::Defrost].verdict == CheckupVerdict::Ok);
        CHECK(count_only[CheckupCheck::Defrost].a == static_cast<int>(w.defrosts));
        CHECK(count_only[CheckupCheck::Defrost].b == -1);
        CHECK(count_only[CheckupCheck::Defrost].e == -1);
        CHECK(count_only.evaluated == 2); // current fault class and documented pressure boundary
        CheckupCoverage no_defrost      = full;
        no_defrost.defrost              = false;
        const CheckupReport unsupported = checkup_evaluate(w, no_defrost, FaultClass::Normal);
        CHECK(unsupported[CheckupCheck::Defrost].verdict == CheckupVerdict::Unavailable);
        CHECK(unsupported[CheckupCheck::Defrost].a == -1);
        CHECK(unsupported[CheckupCheck::Defrost].b == -1);

        w                = day();
        w.dfr_observed_s = CHECKUP_REQUIRED_S - 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Collecting);
        w.dfr_observed_s      = CHECKUP_REQUIRED_S;
        w.dfr_pair_observed_s = CHECKUP_REQUIRED_S - 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Defrost].verdict ==
              CheckupVerdict::Collecting);
        w.dfr_pair_observed_s              = CHECKUP_REQUIRED_S;
        w.dfr_run_s                        = 0;
        w.defrost_s                        = 0;
        const CheckupReport no_denominator = checkup_evaluate(w, full, FaultClass::Normal);
        CHECK(no_denominator[CheckupCheck::Defrost].b == -1);
        CHECK(no_denominator.assessable == 3 && no_denominator.evaluated == 3);
    }
    {
        // Pressure <=1.0 bar violates the documented ">1 bar" boundary. The raw minimum surfaces as
        // Info immediately; Warn needs one continuous confirmation minute. A clear result still
        // needs the complete window.
        CheckupWindow w = day();
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Ok);
        w.min_bar = CHECKUP_BAR_WARN_TENTHS + 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Ok);
        w.min_bar = CHECKUP_BAR_WARN_TENTHS;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Pressure].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Pressure].required_s == 0);
        }
        w.min_bar = CHECKUP_BAR_WARN_TENTHS - 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Info);
        w.min_bar = 0;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Info);
        w.flags |= CHECKUP_F_LOW_BAR;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Warn);

        w                = day();
        w.full_span      = false;
        w.bar_observed_s = CHECKUP_MIN_S_PRESSURE;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Collecting);
        w.min_bar = CHECKUP_BAR_WARN_TENTHS;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Info);
        w.flags |= CHECKUP_F_LOW_BAR;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Warn);
        w.bar_observed_s = CHECKUP_MIN_S_PRESSURE - 1;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].verdict ==
              CheckupVerdict::Warn);
        w.min_bar = CHECKUP_ABSENT;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Pressure].a == -1);
    }
    {
        // FLOW is OBSERVATION ONLY. The manufacturer's minimum is per model — this catalog spans
        // 3 kW to 18 kW — so one number laid across every profile would never fire on the large
        // units and always fire on the small ones. #208 proposed exactly that number (10 l/min);
        // this asserts it did not ship.
        CheckupWindow w = day();
        for (int f : {5, 50, 120, 400}) {
            w.min_flow            = f;
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Flow].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Flow].a == f);
        }
        // The pump row is what makes a flow reading a measurement; without it the check is OFF.
        CheckupCoverage nopump = full;
        nopump.pump            = false;
        w.min_flow             = 120;
        CHECK(checkup_evaluate(w, nopump, FaultClass::Normal)[CheckupCheck::Flow].verdict ==
              CheckupVerdict::Unavailable);
        w.flow_observed_s = CHECKUP_MIN_S_FLOW - 1;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Flow].verdict == CheckupVerdict::Collecting);
            CHECK(r[CheckupCheck::Flow].observed_s == CHECKUP_MIN_S_FLOW - 1);
            CHECK(r[CheckupCheck::Flow].required_s == CHECKUP_MIN_S_FLOW);
            CHECK(r[CheckupCheck::Flow].a == 120); // partial fact remains visible
        }
        w.min_flow = CHECKUP_ABSENT;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Flow].a == -1);
    }
    {
        // BUH and BSH are independent observations. Unsupported is null, never a plausible zero;
        // any amount of legitimate heater use remains observation-only.
        CheckupWindow w = day();
        w.buh_s         = 3600;
        w.bsh_s         = 9000;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Heater].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Heater].a == 3600 && r[CheckupCheck::Heater].b == 9000);
        }
        w.buh_s = 8u * 3600;
        w.bsh_s = 6u * 3600;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Heater].verdict ==
              CheckupVerdict::Ok);

        CheckupCoverage only_buh = full;
        only_buh.bsh             = false;
        w.bsh_observed_s         = 0;
        {
            const CheckupReport r = checkup_evaluate(w, only_buh, FaultClass::Normal);
            CHECK(r[CheckupCheck::Heater].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Heater].a == 8 * 3600);
            CHECK(r[CheckupCheck::Heater].b == -1);
        }

        CheckupCoverage only_bsh = full;
        only_bsh.buh = only_bsh.buh1 = only_bsh.buh2 = false;
        w.buh_observed_s                             = 0;
        w.bsh_observed_s                             = CHECKUP_REQUIRED_S;
        {
            const CheckupReport r = checkup_evaluate(w, only_bsh, FaultClass::Normal);
            CHECK(r[CheckupCheck::Heater].verdict == CheckupVerdict::Ok);
            CHECK(r[CheckupCheck::Heater].a == -1);
            CHECK(r[CheckupCheck::Heater].b == 6 * 3600);
        }

        // Seconds are carried to the serializer: a real 1–59 s activation is not a factual zero.
        w       = day();
        w.buh_s = 1;
        w.bsh_s = 59;
        {
            const CheckupReport       r = checkup_evaluate(w, full, FaultClass::Normal);
            const CheckupCheckResult& c = r[CheckupCheck::Heater];
            CHECK(c.a == 1 && c.b == 59);
        }

        CheckupCoverage neither = only_bsh;
        neither.bsh             = false;
        CHECK(checkup_evaluate(w, neither, FaultClass::Normal)[CheckupCheck::Heater].verdict ==
              CheckupVerdict::Unavailable);

        w                           = day();
        w.bsh_observed_s            = CHECKUP_REQUIRED_S - 1;
        const CheckupReport partial = checkup_evaluate(w, full, FaultClass::Normal);
        CHECK(partial[CheckupCheck::Heater].verdict == CheckupVerdict::Collecting);
        CHECK(partial[CheckupCheck::Heater].observed_s == CHECKUP_REQUIRED_S - 1);
    }
    {
        // FAULT has no minimum window — a fault now is a fault now — and distinguishes three states
        // no other surface keeps: active, cleared-but-seen-in-window, and never.
        CheckupWindow w; // no window at all, deliberately
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
            CHECK(r[CheckupCheck::Fault].a == 0); // …and it says the fault is not active NOW
        }
        // A current timeout cannot erase known history. Its active field remains unknown; without
        // any historical fact, the same supported row is still collecting rather than "clear".
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Unknown);
            CHECK(r[CheckupCheck::Fault].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Fault].a == -1);
        }
        w.flags = 0;
        CHECK(checkup_evaluate(w, full, FaultClass::Unknown)[CheckupCheck::Fault].verdict ==
              CheckupVerdict::Collecting);
    }
    {
        // Retry no-event evidence needs counters plus a known compressor state. A strict comparable
        // increase is experimental Info immediately; a stable baseline clears only after the full
        // rolling-window gate.
        CheckupWindow w = day();
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Ok);
        w.retry_observed_s = CHECKUP_REQUIRED_S - 1;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Retries].verdict == CheckupVerdict::Collecting);
            CHECK(r[CheckupCheck::Retries].observed_s == CHECKUP_REQUIRED_S - 1);
            CHECK(r[CheckupCheck::Retries].required_s == CHECKUP_REQUIRED_S);
            CHECK(r[CheckupCheck::Retries].a == -1);
        }
        w.flags = CHECKUP_F_RETRY;
        {
            const CheckupReport r = checkup_evaluate(w, full, FaultClass::Normal);
            CHECK(r[CheckupCheck::Retries].verdict == CheckupVerdict::Info);
            CHECK(r[CheckupCheck::Retries].a == 1);
        }
        CheckupCoverage norps = full;
        norps.rps             = false;
        CHECK(checkup_evaluate(w, norps, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Unavailable);
        CheckupCoverage noctr = full;
        noctr.retries         = false;
        CHECK(checkup_evaluate(w, noctr, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Unavailable);
        w.flags            = 0;
        w.retry_observed_s = CHECKUP_REQUIRED_S;
        w.full_span        = false;
        CHECK(checkup_evaluate(w, full, FaultClass::Normal)[CheckupCheck::Retries].verdict ==
              CheckupVerdict::Collecting);
    }
    {
        // AGGREGATION. Supported observations remain visible and count as available, but only
        // bounded adjudications may count as evaluated or support a green no-finding summary.
        // Collecting does hold back an adjudication that could run and lacks evidence.
        CHECK(checkup_worse(CheckupVerdict::Ok, CheckupVerdict::Unavailable) == CheckupVerdict::Ok);
        CHECK(checkup_worse(CheckupVerdict::Ok, CheckupVerdict::Collecting) ==
              CheckupVerdict::Collecting);
        CHECK(checkup_worse(CheckupVerdict::Collecting, CheckupVerdict::Info) ==
              CheckupVerdict::Info);
        CHECK(checkup_worse(CheckupVerdict::Info, CheckupVerdict::Warn) == CheckupVerdict::Warn);
        CHECK(checkup_worse(CheckupVerdict::Warn, CheckupVerdict::Warn) == CheckupVerdict::Warn);

        // A profile that can supply NOTHING: every row Unavailable, and the card says so rather
        // than claiming a clean bill of health.
        const CheckupCoverage none;
        const CheckupReport   r = checkup_evaluate(day(), none, FaultClass::Unknown);
        CHECK(r.overall == CheckupVerdict::Unavailable);
        for (const auto& c : r.checks) CHECK(c.verdict == CheckupVerdict::Unavailable);
        // …and only a fully-spanned, per-signal-covered window with no supported finding clears.
        CheckupWindow good = day();
        good.starts        = 8;
        good.run_s         = 8u * 3600;
        // `all` carries the valve row, so the cycling verdict is the per-class one and the window
        // has to be coherent with that: eight hour-long runs on the space circuit, none on the
        // tank.
        good.space_runs     = 8;
        good.space_run_s    = 8u * 3600;
        CheckupCoverage all = full;
        all.valve = all.mode = all.r5t = true;
        DhwLossWindow clean_dhw;
        clean_dhw.observed_s          = DHW_LOSS_REQUIRED_S;
        clean_dhw.circulation_known_s = DHW_LOSS_REQUIRED_S;
        clean_dhw.windows             = DHW_LOSS_REQUIRED_S / DHW_LOSS_WINDOW_S;
        clean_dhw.max_loss_tenths_k_h = 3;
        const CheckupReport ok        = checkup_evaluate(good, all, FaultClass::Normal, clean_dhw);
        CHECK(ok.overall == CheckupVerdict::Ok);
        CHECK(ok.full_span && ok.available == CHECKUP_CHECK_COUNT && ok.assessable == 5 &&
              ok.evaluated == 5); // fault, DHW loss, cycling, defrost ratio and pressure

        CheckupWindow idle_no_ratio = good;
        idle_no_ratio.dfr_run_s     = 0;
        const CheckupReport idle_defrost =
            checkup_evaluate(idle_no_ratio, all, FaultClass::Normal, clean_dhw);
        CHECK(idle_defrost[CheckupCheck::Defrost].verdict == CheckupVerdict::Ok);
        CHECK(idle_defrost.assessable == 4 && idle_defrost.evaluated == 4);

        // Flow and heaters are facts without universal judgement; count-only defrost is likewise
        // not an assessment. They can fill rows but can never manufacture "no finding".
        CheckupCoverage observations;
        observations.defrost = observations.flow = observations.pump = true;
        observations.buh = observations.buh1 = observations.bsh = true;
        const CheckupReport observed = checkup_evaluate(good, observations, FaultClass::Unknown);
        CHECK(observed.available == 3);
        CHECK(observed.assessable == 0);
        CHECK(observed.evaluated == 0);
        CHECK(observed.overall == CheckupVerdict::Unavailable);

        // An actually observed experimental increase may raise Info; a stable counter does not
        // support an absence conclusion and therefore stays outside the evaluated denominator.
        CheckupWindow retry_event = good;
        retry_event.flags |= CHECKUP_F_RETRY;
        const CheckupReport with_retry =
            checkup_evaluate(retry_event, all, FaultClass::Normal, clean_dhw);
        CHECK(with_retry[CheckupCheck::Retries].verdict == CheckupVerdict::Info);
        CHECK(with_retry.overall == CheckupVerdict::Info);
        CHECK(with_retry.assessable == 5 && with_retry.evaluated == 5);
        // These strings are the existing /status.health wire contract. Non-empty is insufficient:
        // a well-formed rename would make an older UI silently skip a row or misread a verdict.
        static const char* const kCheckIds[] = {
            "fault", "dhw_loss", "cycling", "defrost", "pressure", "flow", "heater", "retries",
        };
        CHECK(sizeof(kCheckIds) / sizeof(kCheckIds[0]) == CHECKUP_CHECK_COUNT);
        for (size_t i = 0; i < CHECKUP_CHECK_COUNT; i++) {
            CHECK(std::string(checkup_check_id(static_cast<CheckupCheck>(i))) == kCheckIds[i]);
            CHECK(checkup_evidence_name(static_cast<CheckupCheck>(i))[0] != '\0');
        }
        CHECK(std::string(checkup_verdict_name(CheckupVerdict::Unavailable)) == "unavailable");
        CHECK(std::string(checkup_verdict_name(CheckupVerdict::Ok)) == "ok");
        CHECK(std::string(checkup_verdict_name(CheckupVerdict::Collecting)) == "collecting");
        CHECK(std::string(checkup_verdict_name(CheckupVerdict::Info)) == "info");
        CHECK(std::string(checkup_verdict_name(CheckupVerdict::Warn)) == "warn");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Fault)) == "device");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Pressure)) == "manufacturer");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::DhwLoss)) == "heuristic");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Cycling)) == "heuristic");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Defrost)) == "heuristic");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Flow)) == "observation");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Heater)) == "observation");
        CHECK(std::string(checkup_evidence_name(CheckupCheck::Retries)) == "experimental");
        CheckupCheckResult count_evidence;
        count_evidence.d = -1;
        CHECK(std::string(checkup_result_evidence_name(CheckupCheck::Defrost, count_evidence)) ==
              "observation");
        count_evidence.d = 0;
        CHECK(std::string(checkup_result_evidence_name(CheckupCheck::Defrost, count_evidence)) ==
              "observation");
        count_evidence.d = 1;
        CHECK(std::string(checkup_result_evidence_name(CheckupCheck::Defrost, count_evidence)) ==
              "heuristic");
    }

    // --- catalog conformance --------------------------------------------------------------------
    // The locator is only worth anything if it resolves to ONE row, and to the RIGHT row, on every
    // profile that carries the quantity. `token` is what the resolved label must contain: without
    // it this would only prove that some row lives at that byte, which is exactly the assumption
    // the 0x60/12 stack punishes. `min_profiles` is measured over today's catalog, so a generator
    // run that moves or drops a row fails here rather than on someone's dashboard.
    struct CheckupExpect {
        const CheckupLocator* loc;
        const char*           token;
        int                   min_profiles;
    };
    static const CheckupExpect kCheckup[] = {
        {&CHECKUP_LOC_DEFROST, "defrost", 39},
        {&CHECKUP_LOC_BUH1, "buh step1", 39},
        {&CHECKUP_LOC_BUH2, "buh step2", 39},
        {&CHECKUP_LOC_BSH, "bsh", 39},
        {&CHECKUP_LOC_PUMP, "water pump operation", 39},
        {&CHECKUP_LOC_PRESSURE, "water pressure", 39},
        {&CHECKUP_LOC_FLOW, "flow sensor", 39},
        // The valve and the tank sensor were the two locators this table did not pin, and both now
        // decide verdicts: the valve gates the cycling class split and, with R5T, the whole
        // DHW-loss check. An unpinned locator is exactly the 0x60/12 collision waiting to be
        // re-made — the valve shares its byte with six other flags and is separated only by its
        // converter.
        {&CHECKUP_LOC_VALVE, "way valve", 39},
        {&CHECKUP_LOC_IU_MODE, "i/u operation mode", 39},
        {&CHECKUP_LOC_R5T, "r5t", 39},
    };
    constexpr size_t kCheckupCount = sizeof(kCheckup) / sizeof(kCheckup[0]);

    int hchecked              = 0;
    int hfound[kCheckupCount] = {0};
    int with_fault = 0, with_retries = 0, with_rps = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        // The VIEW, not the base table: the protection-retry counters live in def/overlay.hpp, so
        // coverage read off the generated rows alone would report `retries` false on every model —
        // the gate would answer correctly for the wrong reason today, and wrongly the moment the
        // generator emits them (the argument feature_gate.hpp already makes).
        const logic::ProfileView view = def::resolved(p);
        const size_t             n    = view.count();

        bool            fault_row = false, retry_row = false, rps_row = false;
        int             fault_rows = 0;
        CheckupCoverage capability;
        for (size_t i = 0; i < n; i++) {
            // Match production exactly: withhold non-publishable rows first, then apply converter
            // and label adjudication before deriving capability.
            if (!row_publishable(view[i])) continue;
            const ValueDef row = logic::adjudicated(view[i]);
            if (checkup_is_fault_class(row.conv)) {
                fault_row = true;
                fault_rows++;
            }
            if (checkup_retry_index(row.reg, row.offset, row.conv) >= 0) retry_row = true;
            if (ou_is_rps_witness(row.label, row.reg)) rps_row = true;
            checkup_cover_row(capability, row.reg, row.offset, row.conv, row.label);
        }
        with_fault += fault_row;
        with_retries += retry_row;
        with_rps += rps_row;
        CHECK(capability.fault == fault_row);
        CHECK(capability.fault_rows == fault_rows);
        CHECK(capability.retries == retry_row);
        CHECK(capability.rps == rps_row);
        if (retry_row) CHECK(capability.retry_mask == 0x1f);

        for (size_t k = 0; k < kCheckupCount; k++) {
            const CheckupLocator& l             = *kCheckup[k].loc;
            int                   hits          = 0;
            const char*           matched_label = nullptr;
            for (size_t i = 0; i < n; i++) {
                if (!row_publishable(view[i])) continue;
                const ValueDef row = logic::adjudicated(view[i]);
                if (checkup_row_matches(l, row.reg, row.offset, row.conv)) {
                    hits++;
                    matched_label = row.label;
                }
            }
            if (!hits) continue;
            hfound[k]++;
            // ONE row. Ambiguity is what a label token had and a locator is supposed to remove; two
            // matches would make the pick table order, which is not a rule anyone stated.
            CHECK(hits == 1);
            // …and the RIGHT one. This is the half that catches the 0x60/12 collision: five other
            // rows sit in that byte, and every one of them would satisfy a reg+offset match.
            CHECK(matched_label && lwt_ci_contains(matched_label, kCheckup[k].token));
        }
    }
    for (size_t k = 0; k < kCheckupCount; k++) CHECK(hfound[k] >= kCheckup[k].min_profiles);
    hchecked = with_fault; // every detectable profile carries a class
    CHECK(hchecked >= 39);
    // The retry counters reach 39+ profiles via the overlay, while the compressor witness reaches
    // far fewer — which is exactly why the cycling and retries checks gate on coverage instead of
    // assuming it. Exactly 13 of the 39 detection profiles carry no page 0x30 at all
    // (feature_gate.hpp measures the same thing from the other side).
    CHECK(with_retries == 39);
    CHECK(with_rps == 26);
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
        CHECK(std::string(p.id) == id); // profile really exists under this id
        int      flagged = 0;
        uint32_t mask    = 0;
        for (size_t i = 0; i < p.count; i++) {
            mask |= page_mask_bit(p.values[i].reg); // signature spans EVERY row, flagged too
            if (p.values[i].no_publish) {
                flagged++;
                CHECK(p.values[i].reg == 0x64); // only the hybrid page is detect-only
            }
        }
        CHECK(flagged == 8);                      // the whole 0x64 hybrid/boiler cluster
        CHECK((mask & page_mask_bit(0x64)) != 0); // SIGNATURE INTACT — the reason for the flag
    }
    // Contained: nothing outside the non-hybrid 4-8 kW set is flagged (a genuine hybrid must keep
    // publishing its boiler values).
    int total = 0;
    for (const auto& p : def::profiles)
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].no_publish) total++;
    CHECK(total == 8 * 4);
    // Defaults false: an ordinary generated `{reg,offset,conv,size,type,label}` row stays
    // publishable without having to say so, so the flag is additive to every existing table.
    const auto& m = def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc");
    for (size_t i = 0; i < m.count; i++)
        if (m.values[i].reg != 0x64) CHECK(!m.values[i].no_publish);
}

// ── logic/profile_view.hpp + def/overlay.hpp — the page-0x10 protection-word supplement (#110 B)
// ──
static void test_profile_view() {
    using namespace daik::logic;

    // THE OVERLAY RULE: a supplement applies only if the base already reads its page. This is what
    // keeps a hand-written block from doing what hand-editing a generated table would do — move
    // detection — and from adding a per-cycle bus round-trip (and, on a model that does not answer,
    // a per-cycle TIMEOUT that reads on /diag exactly like a wiring fault).
    ValueDef base_with[]    = {{0x10, 0, 217, 1, -1, "Operation Mode"},
                               {0x60, 3, 204, 1, -1, "Error Code"}};
    ValueDef base_without[] = {{0x60, 3, 204, 1, -1, "Error Code"}};
    ValueDef extra[]        = {{0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty"}};

    const auto applied = profile_view(base_with, 2, extra, 1, 0x10);
    CHECK(applied.count() == 3);
    CHECK(applied[0].conv == 217 && applied[1].conv == 204); // base rows keep their order + indices
    CHECK(applied[2].conv == 310 && applied[2].offset == 10); // supplement lands after them

    const auto skipped = profile_view(base_without, 1, extra, 1, 0x10);
    CHECK(skipped.count() == 1); // page absent -> block withheld entirely
    CHECK(skipped.extra_count == 0);
    CHECK(!profile_has_page(base_without, 1, 0x10));
    CHECK(profile_has_page(base_with, 2, 0x10));

    // An empty supplement is a no-op, not a crash: the block is deleted the day the generator emits
    // these rows, and the deletion must not have to be atomic with the call-site cleanup.
    CHECK(profile_view(base_with, 2, nullptr, 0, 0x10).count() == 2);

    // A second block may span several pages, but every one must already be present in the generated
    // base. It is appended after the ordinary supplement and withheld atomically if even one page
    // is absent; one supplement can never bootstrap a page for another.
    ValueDef   mixed_ok[] = {{0x60, 11, 306, 1, -1, "Thermal protector"},
                             {0x10, 1, 305, 1, -1, "Startup Control"}};
    const auto applied2   = profile_view_extend_existing_pages(applied, mixed_ok, 2);
    CHECK(applied2.count() == 5);
    CHECK(applied2[2].conv == 310);
    CHECK(applied2[3].reg == 0x60 && applied2[4].reg == 0x10);
    CHECK(applied2.extra2_count == 2);
    ValueDef   mixed_missing[] = {{0x60, 11, 306, 1, -1, "Thermal protector"},
                                  {0x62, 2, 302, 1, -1, "System OFF"}};
    const auto skipped2        = profile_view_extend_existing_pages(applied, mixed_missing, 2);
    CHECK(skipped2.count() == applied.count());
    CHECK(skipped2.extra2_count == 0);

    // ── The real catalog ────────────────────────────────────────────────────────────────────────
    // Every profile reads page 0x10, so every profile gets the supplement. If a future generated
    // profile drops the page this CHECK fails rather than the device quietly gaining a round-trip.
    for (const auto& p : def::profiles) {
        const auto   v                   = def::resolved(p);
        const bool   observation_profile = std::string(p.id) == def::OBSERVABILITY_PROFILE;
        const size_t expected            = p.count + def::RETRY_ROW_COUNT +
                                (observation_profile ? def::OBSERVABILITY_ROW_COUNT : 0);
        CHECK(v.count() == expected);
        CHECK(v.extra_count == def::RETRY_ROW_COUNT);
        CHECK(v.extra2_count == (observation_profile ? def::OBSERVABILITY_ROW_COUNT : 0));
    }

    // DETECTION IS UNMOVED — the load-bearing claim. Belt: signatures are built over def::profiles
    // (the BASE tables) and never see a view. Braces: even resolved, the page mask is identical,
    // because the rule cannot set a bit that was not already set. Assert the braces, since the belt
    // is the one a refactor would remove.
    for (const auto& p : def::profiles) {
        uint32_t base_mask = 0, view_mask = 0, base_query_mask = 0, view_query_mask = 0;
        for (size_t i = 0; i < p.count; i++) {
            base_mask |= daik::page_mask_bit(p.values[i].reg);
            if (row_publishable(p.values[i]))
                base_query_mask |= daik::page_mask_bit(p.values[i].reg);
        }
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            view_mask |= daik::page_mask_bit(v[i].reg);
            if (row_publishable(v[i])) view_query_mask |= daik::page_mask_bit(v[i].reg);
        }
        CHECK(base_mask == view_mask);
        CHECK(base_query_mask == view_query_mask);
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
    CHECK(c310 == 3); // Discharge Temp. / HP / Fin Temp. retry counters — UC5's signal
    CHECK(c311 == 2); // Comp. INV Current / LP retry counters ("Not in use" omitted)
    CHECK(c307 == 3 && c303 == 3); // the drop-control flags sharing those bytes

    // The rows DECODE, end to end, through the real converter — the half PR #111 could not reach
    // because no row used conv 310. 0x95 on offset 10 is 1 discharge retry with the drop flag set
    // and 5 INV-current retries, NOT 149.
    const uint8_t word[] = {0x95};
    int           seen   = 0;
    for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
        if (def::retry_rows[i].offset != 10) continue;
        const auto r = convert(def::retry_rows[i], word);
        CHECK(r.ok);
        switch (def::retry_rows[i].conv) {
        case 310:
            CHECK(approx(r.value, 1.0));
            seen++;
            break;
        case 311:
            CHECK(approx(r.value, 5.0));
            seen++;
            break;
        case 307:
            CHECK(approx(r.value, 1.0));
            seen++;
            break; // bit 7 set
        case 303:
            CHECK(approx(r.value, 0.0));
            seen++;
            break; // bit 3 clear
        default:
            CHECK(false);
            break;
        }
    }
    CHECK(seen == 4);

    // A bit-flag row publishes as an HA binary_sensor and a COUNTER as a number — they share a
    // byte, so a split that keyed on the label instead of the converter would type all four alike.
    CHECK(conv_is_binary(307) && conv_is_binary(303));
    CHECK(!conv_is_binary(310) && !conv_is_binary(311));
    for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
        const ValueDef& d = def::retry_rows[i];
        CHECK(!object_id(d.label).empty()); // an empty object_id is a row publish_discovery drops
        CHECK(std::string(ha_component(d)) ==
              (conv_is_binary(d.conv) ? "binary_sensor" : "sensor"));
    }

    // The supplement must not introduce a DUPLICATE STATE KEY: mqtt_group.hpp nests the payload by
    // group, so two rows sharing a (group, object_id) would write one key and the second row would
    // silently never arrive — in the X10A topic AND in VictoriaMetrics, which is keyed on that
    // pair.
    //
    // Scoped by group rather than global since #221. The old global form was an assertion about the
    // DELTA only, because the catalog itself carried label collisions ("Error Code" on both 0x10/5
    // and 0x60/3); those are no longer collisions at all — they are two rows in two groups, which
    // is what they always were on the wire. The supplement is page-0x10-only, so in practice this
    // reads "no supplement row may take a state key an outdoor_state row already holds".
    for (const auto& p : def::profiles) {
        for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++) {
            const std::string key = row_object_id(def::retry_rows[i]);
            for (size_t k = 0; k < p.count; k++) CHECK(row_object_id(p.values[k]) != key);
        }
    }

    // ── Profile-specific diagnostic telemetry ──────────────────────────────────────────────────
    // These rows are transcribed from docs/REGISTERS.md and freeze both their wire identity and the
    // metric suffix they create. They are deliberately attached only to the reference monobloc and
    // only on pages the generated profile already polls.
    static const struct {
        uint8_t     reg;
        uint8_t     off;
        int         conv;
        const char* label;
        const char* group;
        const char* metric;
    } observation_ids[] = {
        {0x10, 1, 307, "Thermostat ON/OFF", "outdoor_state", "thermostat_on_off"},
        {0x10, 1, 306, "Restart standby", "outdoor_state", "restart_standby"},
        {0x10, 1, 305, "Startup Control", "outdoor_state", "startup_control"},
        {0x10, 1, 303, "Oil Return Operation", "outdoor_state", "oil_return_operation"},
        {0x10, 1, 302, "Pressure equalizing operation", "outdoor_state",
         "pressure_equalizing_operation"},
        {0x10, 1, 301, "Demand Signal", "outdoor_state", "demand_signal"},
        {0x10, 1, 300, "Low noise control", "outdoor_state", "low_noise_control"},
        {0x30, 11, 307, "4 Way Valve", "actuators", "4_way_valve"},
        {0x30, 12, 307, "Crank case heater", "actuators", "crank_case_heater"},
        {0x30, 13, 307, "Hot gas bypass valve (Y3S)", "actuators", "hot_gas_bypass_valve_y3s"},
        {0x30, 13, 306, "LP bypass valve (Y2S)", "actuators", "lp_bypass_valve_y2s"},
        {0x30, 13, 305, "Y3S", "actuators", "y3s"},
        {0x60, 4, 152, "Error detailed code", "hydronic", "error_detailed_code"},
        {0x60, 11, 306, "Thermal protector (Q1L) BUH", "hydronic", "thermal_protector_q1l_buh"},
        {0x60, 11, 303, "Solar input", "hydronic", "solar_input"},
        {0x60, 12, 302, "Floor loop shut off valve", "hydronic", "floor_loop_shut_off_valve"},
        {0x62, 2, 302, "System OFF (ON:System off)", "hydronic_state", "system_off_on_system_off"},
        {0x62, 7, 307, "Add. Ext. RT Input Cool.", "hydronic_state", "add_ext_rt_input_cool"},
        {0x62, 7, 306, "Add. Ext. RT Input Heat.", "hydronic_state", "add_ext_rt_input_heat"},
        {0x62, 7, 305, "Main RT Cooling", "hydronic_state", "main_rt_cooling"},
        {0x62, 7, 304, "Main RT Heating", "hydronic_state", "main_rt_heating"},
        {0x62, 7, 303, "Pwr consumption limit 4", "hydronic_state", "pwr_consumption_limit_4"},
        {0x62, 7, 302, "Pwr consumption limit 3", "hydronic_state", "pwr_consumption_limit_3"},
        {0x62, 7, 301, "Pwr consumption limit 2", "hydronic_state", "pwr_consumption_limit_2"},
        {0x62, 7, 300, "Pwr consumption limit 1", "hydronic_state", "pwr_consumption_limit_1"},
        {0x62, 8, 304, "PHE Heater", "hydronic_state", "phe_heater"},
        {0x63, 13, 311, "BUH output capacity", "mains_current", "buh_output_capacity"},
    };
    CHECK(sizeof(observation_ids) / sizeof(observation_ids[0]) == def::OBSERVABILITY_ROW_COUNT);
    CHECK(def::OBSERVABILITY_ROW_COUNT == 27);

    const auto& target_base = def::lookup(def::OBSERVABILITY_PROFILE);
    const auto  target      = def::resolved(target_base);
    CHECK(target.extra2_count == def::OBSERVABILITY_ROW_COUNT);
    int binary_rows = 0;
    for (size_t i = 0; i < def::OBSERVABILITY_ROW_COUNT; i++) {
        const ValueDef& d = def::observability_rows[i];
        CHECK(d.size == 1 && d.type == -1 && !d.no_publish && d.conv != 405);
        CHECK(profile_has_page(target_base.values, target_base.count, d.reg));
        if (conv_is_binary(d.conv)) binary_rows++;
        CHECK(std::string(ha_component(d)) ==
              (conv_is_binary(d.conv) ? "binary_sensor" : "sensor"));

        int hits = 0;
        for (const auto& e : observation_ids) {
            if (d.reg == e.reg && d.offset == e.off && d.conv == e.conv &&
                std::string(d.label) == e.label && std::string(group_for_page(d.reg)) == e.group &&
                object_id(d.label) == e.metric)
                hits++;
        }
        CHECK(hits == 1);

        // No state key may collide with any earlier base/retry/observation row in the resolved
        // view.
        const size_t at = target.base_count + target.extra_count + i;
        for (size_t k = 0; k < at; k++) CHECK(row_object_id(target[k]) != row_object_id(d));
    }
    CHECK(binary_rows == 25);

    // End-to-end packed-bit decoding of the eight 0x62/7 rows. 0xA5 = 1010 0101, so converters
    // 307..300 must read 1,0,1,0,0,1,0,1 respectively rather than the whole byte.
    const uint8_t control_word[]  = {0xA5};
    const int     expected_bits[] = {1, 0, 1, 0, 0, 1, 0, 1};
    int           control_bits    = 0;
    for (size_t i = 0; i < def::OBSERVABILITY_ROW_COUNT; i++) {
        const ValueDef& d = def::observability_rows[i];
        if (d.reg != 0x62 || d.offset != 7) continue;
        const auto decoded = convert(d, control_word);
        CHECK(decoded.ok && approx(decoded.value, expected_bits[307 - d.conv]));
        control_bits++;
    }
    CHECK(control_bits == 8);

    // HP Forced FG is intentionally NOT published yet. It aliases bit 7 of the existing one-byte
    // CT-L3 current field. The availability ledger must reject that current while the bit is
    // asserted rather than fabricate +64 A; raw-data evidence or a documented mask is required
    // before exposing the flag or decoding a simultaneous current.
    for (size_t i = 0; i < def::OBSERVABILITY_ROW_COUNT; i++) {
        const ValueDef& d = def::observability_rows[i];
        CHECK(!(d.reg == 0x63 && d.offset == 16 && d.conv == 307));
    }
    const uint8_t  shared_ct_byte[] = {0x80};
    const ValueDef ct_l3{0x63, 16, 161, 1, -1, "Current measured by CT sensor of L3"};
    CHECK(convert(ct_l3, shared_ct_byte)
              .ok); // intrinsic converter remains a whole-byte ×0.5-A decode
    CHECK(approx(convert(ct_l3, shared_ct_byte).value, 64.0));
    uint8_t shared_ct_page[17] = {};
    shared_ct_page[16]         = 0x80;
    CHECK(!value_available(ct_l3, true, 64.0, shared_ct_page, sizeof(shared_ct_page)));
    CHECK(value_available(ct_l3, true, 64.0)); // no page witness: availability rules fail open
    const uint8_t ordinary_ct_byte[] = {0x7f};
    CHECK(convert(ct_l3, ordinary_ct_byte).ok);
    CHECK(approx(convert(ct_l3, ordinary_ct_byte).value, 63.5));
    shared_ct_page[16] = 0x7f;
    CHECK(value_available(ct_l3, true, 63.5, shared_ct_page, sizeof(shared_ct_page)));
    const ValueDef ct_l2{0x63, 15, 161, 1, -1, "Current measured by CT sensor of L2"};
    CHECK(convert(ct_l2, shared_ct_byte).ok);
    CHECK(approx(convert(ct_l2, shared_ct_byte).value, 64.0));
    shared_ct_page[15] = 0x80;
    CHECK(value_available(ct_l2, true, 64.0, shared_ct_page, sizeof(shared_ct_page)));

    // ── The metric IDs these rows have already become in VictoriaMetrics (#180) ──────────────────
    // Verified 2026-07-26: these 11 rows are INGESTED. Telegraf reads the grouped X10A topic and
    // the store carries one series per row, named `daikin_altherma_<group>_<object_id>`. That
    // promotes BOTH halves of that name from presentation to load-bearing identifier — the group
    // key and each row's label-derived slug. #180's schema-coupling note asks whether an "ingest
    // schema freeze" covers them; no such mechanism exists in this repo, so this block IS the
    // freeze.
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

    static const struct {
        const char* label;
        const char* metric;
    } vm_ids[] = {
        {"Discharge Temp. Drop", "discharge_temp_drop"},
        {"Discharge Temp. Protection Retry Qty", "discharge_temp_protection_retry_qty"},
        {"Comp. INV Current Drop", "comp_inv_current_drop"},
        {"Comp. INV Current Protection Retry Qty", "comp_inv_current_protection_retry_qty"},
        {"HP Drop Control", "hp_drop_control"},
        {"HP Protection Retry Qty", "hp_protection_retry_qty"},
        {"LP Drop Control", "lp_drop_control"},
        {"LP Protection Retry Qty", "lp_protection_retry_qty"},
        {"Fin Temp. Drop Control", "fin_temp_drop_control"},
        {"Fin Temp. Protection Retry Qty", "fin_temp_protection_retry_qty"},
        {"Other Drop Control", "other_drop_control"},
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
        int               hits  = 0;
        for (const auto& e : vm_ids)
            if (label == e.label && oid == e.metric) hits++;
        CHECK(hits == 1); // this row still lands on the id the store already carries
    }
    for (const auto& e : vm_ids) {
        int hits = 0;
        for (size_t i = 0; i < def::RETRY_ROW_COUNT; i++)
            if (std::string(def::retry_rows[i].label) == e.label) hits++;
        CHECK(hits == 1); // ...and no pinned series lost the row that feeds it
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
            if (v.no_publish) continue; // detect-only: never announced, never a series
            // Through adjudicated(): the store is keyed on what the bridge PUBLISHES, and a label
            // override (logic/label_override.hpp, #230 A) changes that word — so a row's series
            // suffix is its adjudicated label's slug, not the generator's.
            actual.insert(std::string(group_for_page(v.reg)) + "_" +
                          object_id(logic::adjudicated(v).label));
        }

    std::set<std::string> expected(EXPECTED, EXPECTED + EXPECTED_N);
    CHECK(expected.size() == EXPECTED_N); // no duplicate literal above
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
    // VictoriaMetrics series suffix, so the frozen list above now gates both. A label edit moves
    // the HA entity and the series together or neither — they can no longer drift apart.
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
    // `..._error_code_2`. discovery.hpp's AMBIGUOUS_LABEL_SLUGS is the ledger of rows named by
    // their group for that reason, and it is hand-maintained on purpose (a name computed from the
    // detected profile's rows would differ per model, so a re-detect would rename a live entity).
    //
    // So: same computation, opposite verdict. It must be EXACTLY the ledger — another reused label
    // that nobody added to the ledger would ship two identically-named entities and a `_2`.
    //
    // Keyed on distinct PAGES, not distinct (reg, offset): the group is what disambiguates, so a
    // label reused twice on ONE page would not be fixable by scoping at all. That case is
    // test_entity_identity()'s — it asserts the property directly, on the published payload.
    std::set<std::string> ledger(AMBIGUOUS_LABEL_SLUGS,
                                 AMBIGUOUS_LABEL_SLUGS + AMBIGUOUS_LABEL_SLUG_COUNT);
    std::set<std::string> reused;
    for (const auto& p : def::profiles) {
        std::map<std::string, std::set<int>> by_obj; // object_id -> distinct register pages
        const auto                           view = def::resolved(p);
        for (size_t i = 0; i < view.count(); i++) {
            const auto& v = view[i];
            if (v.no_publish) continue;
            by_obj[object_id(v.label)].insert(v.reg);
        }
        for (const auto& kv : by_obj)
            if (kv.second.size() > 1) reused.insert(kv.first);
    }
    for (const auto& r : reused)
        if (!ledger.count(r))
            std::printf("  label reused across pages, not in AMBIGUOUS_LABEL_SLUGS: %s\n",
                        r.c_str());
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
// still decides an identifier and this test is what bounds WHICH.) On the live 8 kW unit three of
// the five survivors are REGISTER-EQUIVALENT — byte-identical (reg, offset, conv, size, type) rows
// — so which one wins changes not one decoded value. It changes the LABELS, and a label is the HA
// entity id plus the VictoriaMetrics series suffix. This is exactly the shape of #230 A's fan step:
// `altherma_ebla_edla_d_series_4_8kw_monobloc` and
// `altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw` were register-equivalent yet published
// `actuators_fan_1_step` vs `actuators_fan_1_10_rpm` depending on nothing but registry order. Add,
// remove or reorder a profile — none of which is a suspicious act — and the old series stops
// receiving samples while a new one starts at zero: #217's silent fork, a counter resetting to zero
// reading as the plant going quiet rather than as a rename. The fan case is now CLOSED —
// logic/label_override.hpp republishes every profile as `actuators_fan_1_step`, so that class is
// identifier-equivalent and neither fan id is tie-break-decided any more (which is why they are
// gone from the frozen set below) — but the mechanism is general and the remaining classes below
// still have it.
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
//     Both are true of their own product, and docs/REGISTERS.md:196-200 says to expect exactly
//     this;
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
    // message. Removing one means the divergence is gone: a label override now makes the class
    // agree
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
    static const size_t TIE_BREAK_DECIDED_N =
        sizeof(TIE_BREAK_DECIDED) / sizeof(TIE_BREAK_DECIDED[0]);

    // profile -> the identifiers it publishes; keyed by its wire-field multiset.
    std::map<std::vector<std::string>, std::map<std::string, std::set<std::string>>> classes;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue; // `generic` + the fixture are never picked
        const logic::ProfileView view = def::resolved(p);
        std::vector<std::string> field; // the WIRE, label-free
        std::set<std::string>    ids;   // what it publishes
        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef d = logic::adjudicated(view[i]);
            char           f[48];
            std::snprintf(f, sizeof(f), "%02X/%d/%d/%d/%d", d.reg, (int)d.offset, d.conv,
                          (int)d.size, d.type);
            field.push_back(f);
            if (!row_publishable(d) || !conv_publishable(d.conv) || object_id(d.label).empty())
                continue;
            ids.insert(row_object_id(d));
        }
        std::sort(field.begin(), field.end());
        classes[field][p.id] = ids;
    }

    std::set<std::string>              decided;    // ids a tie-break can move
    std::map<std::string, std::string> carried_by; // ...and which class member carries each
    int                                equiv_classes = 0, divergent_classes = 0;
    for (const auto& [field, members] : classes) {
        (void)field;
        if (members.size() < 2) continue; // nothing to tie-break between
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
        if (diff.empty()) continue; // identifier-equivalent: the safe shape
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
    CHECK(expected.size() == TIE_BREAK_DECIDED_N); // no duplicate literal above
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
    CHECK(divergent_classes < equiv_classes); // ...and most classes ARE safe today
}

// ── What the tie-break decides on a REAL fingerprint, and what cannot move it (#230 B) ───────────
// test_tie_break_identity() above asks a CATALOG question: which identifiers do REGISTER-EQUIVALENT
// profiles disagree about? The two tests below ask the two OPERATIONAL ones, and all three are kept
// because none subsumes another — measured, not assumed:
//
//   • the tie detect_best actually resolves is on the page COUNT and the kW-class SPAN, both
//   coarser
//     than the row tables. So a tie can hold between profiles that are NOT register-equivalent (98
//     of 152 measured ties, row multisets up to 8 rows apart), and the register-equivalence set
//     misses 32 of the identifiers a tie-break can really move;
//   • and conversely 2 identifiers (`outdoor_sensors_low_pressure{,_t}`) diverge between
//     register-equivalent profiles yet are NOT reachable, because a tighter kW class always wins on
//     criterion (3) before the tie-break is consulted. A gate that only measured reachability would
//     call that pair safe while a catalog edit could still expose it.
//
// The sweep below is every fingerprint a real unit can present: each distinct page mask the catalog
// carries (plus the live reference unit's 0x1bff), crossed with the capacity in 0.5 kW steps, in
// BOTH states a unit can report it — the O/U descriptor's own figure, and the I/U code that stands
// in when that descriptor is too short (detect_capacity). 336 fingerprints.
static std::vector<Fingerprint> tie_break_sweep() {
    std::set<uint32_t> masks{0x1bff}; // + the live reference unit
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        uint32_t                 m = 0;
        const logic::ProfileView v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) m |= page_mask_bit(v[i].reg);
        masks.insert(m);
    }
    std::vector<Fingerprint> fps;
    for (uint32_t m : masks)
        for (int ou = 0; ou < 2; ou++)
            for (int cap = -1; cap <= 160; cap += (cap < 0 ? 31 : 5)) {
                if (cap >= 0 && cap < 30) continue; // below the smallest rated class
                Fingerprint fp;
                fp.page_mask    = m;
                fp.kw_tenths    = (ou == 0) ? cap : -1;
                fp.iu_kw_tenths = (ou == 0) ? -1 : cap;
                fps.push_back(fp);
            }
    return fps;
}

// The PROPERTY, asserted directly rather than frozen as a list: reordering the registry cannot
// change what a unit publishes. detect_best's last criterion used to be "first in signature order",
// i.e. the order the tables happen to sit in def/registry.hpp — an incidental fact about a FILE. A
// label is an identifier (ha_slug -> HA entity id + VictoriaMetrics series suffix), so a moved
// tie-break stops one series and starts another at zero, which reads downstream as the plant going
// quiet rather than as a rename (#180/#217). Measured before the fix: permuting the registry moved
// the published identity on 11275 of 200x336 trials over 90 distinct identifiers. Criterion (4) is
// now the lowest profile id, which is intrinsic to the profile, so the same tie resolves the same
// way in any order.
//
// Permutation is hand-rolled Fisher-Yates on an LCG, NOT std::shuffle: how std::shuffle consumes
// its URBG is implementation-defined, so libstdc++ and libc++ would permute differently and a
// failure would not reproduce. This is a test about determinism; it must be deterministic itself.
static void test_tie_break_order_independence() {
    int                            nsig = 0;
    const Signature*               raw  = def::signatures(nsig);
    std::vector<Signature>         base(raw, raw + nsig);
    const std::vector<Fingerprint> fps = tie_break_sweep();

    uint32_t s    = 0x1234567u;
    auto     next = [&s]() {
        s = s * 1664525u + 1013904223u;
        return s >> 16;
    };

    int moved = 0;
    for (int trial = 0; trial < 50; trial++) {
        std::vector<Signature> perm = base;
        for (size_t i = perm.size(); i > 1; i--) std::swap(perm[i - 1], perm[next() % i]);
        for (const auto& fp : fps) {
            const char* a = detect_best(base.data(), (int)base.size(), fp);
            const char* b = detect_best(perm.data(), (int)perm.size(), fp);
            if ((a == nullptr) != (b == nullptr)) {
                moved++;
                continue;
            }
            if (a && b && std::strcmp(a, b) != 0) {
                if (moved++ < 5) std::printf("  registry order moved the pick: %s -> %s\n", a, b);
            }
        }
    }
    CHECK(moved == 0);

    // Non-vacuity, both halves: the sweep must actually reach the tie-break, and the permutations
    // must actually permute — otherwise this passes by testing nothing.
    int with_tie = 0;
    for (const auto& fp : fps) {
        int  bp = -1, bm = -1, bs = 0, n = 0;
        bool have = false;
        for (const auto& sig : base) {
            if (!signature_consistent(sig, fp)) continue;
            const int pop   = __builtin_popcount(sig.page_mask);
            const int match = signature_kw_contains(sig, detect_capacity(fp)) ? 1 : 0;
            const int span =
                (sig.kw_min_tenths >= 0) ? (sig.kw_max_tenths - sig.kw_min_tenths) : 1000;
            if (!have || pop > bp || (pop == bp && match > bm) ||
                (pop == bp && match == bm && span < bs)) {
                bp   = pop;
                bm   = match;
                bs   = span;
                have = true;
            }
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
    CHECK(with_tie >= 100); // measured 152

    std::vector<Signature> perm = base;
    for (size_t i = perm.size(); i > 1; i--) std::swap(perm[i - 1], perm[next() % i]);
    int same_slot = 0;
    for (size_t i = 0; i < base.size(); i++)
        if (std::strcmp(base[i].id, perm[i].id) == 0) same_slot++;
    CHECK(same_slot < (int)base.size() / 2); // the shuffle really shuffles

    // And the live reference unit is unmoved by the whole change — the reason this needed no #221
    // migration: 0 of the 336 fingerprints re-label anything, this one included.
    Fingerprint live;
    live.page_mask    = 0x1bff;
    live.iu_kw_tenths = 80;
    CHECK(std::strcmp(detect_best(base.data(), (int)base.size(), live),
                      "altherma_ebla_edla_d_series_4_8kw_monobloc") == 0);
}

// ...and the RESIDUE the property above does not remove: order-independence stops a REORDER from
// moving an identifier, but adding or removing a profile still can (a new lexicographic sibling
// wins the tie). So freeze the identifiers a tie-break can decide on a fingerprint a real unit can
// present — the question a device OWNER has, which the catalog-wide set above cannot answer.
//
// Adding an entry means a new series is tie-break-decided: say why in the commit message. Removing
// one means a divergence is gone (a label override made the class agree, the generator agrees, or a
// profile left the tie).
static void test_tie_break_reach() {
    static const char* const REACHABLE[] = {
        "actuators_4_way_valve",
        "actuators_crank_case_heater",
        "actuators_expansion_valve_2_pls",
        "actuators_fan_2_step",
        "actuators_hot_gas_bypass_valve_y3s",
        "actuators_lp_bypass_valve_y2s",
        "actuators_y3s",
        "hybrid_2nd_domestic_hot_water_temperature",
        "hybrid_be_cop",
        "hybrid_boiler_dhw_demand",
        "hybrid_boiler_heating_target_temp",
        "hybrid_boiler_operation_demand",
        "hybrid_hybrid_heating_target_temp",
        "hybrid_hybrid_op_mode",
        "hybrid_mixed_water_temp",
        "hybrid_mixed_water_temp_r7t",
        "hydronic_error_detailed_code",
        "hydronic_error_type",
        "hydronic_floor_loop_shut_off_valve",
        "hydronic_solar_input",
        "hydronic_state_add_ext_rt_input_cool",
        "hydronic_state_add_ext_rt_input_heat",
        "hydronic_state_main_rt_cooling",
        "hydronic_state_main_rt_heating",
        "hydronic_state_phe_heater",
        "hydronic_state_pressure_sensor",
        "hydronic_state_pressure_sensor_t",
        "hydronic_state_pwr_consumption_limit_1",
        "hydronic_state_pwr_consumption_limit_2",
        "hydronic_state_pwr_consumption_limit_3",
        "hydronic_state_pwr_consumption_limit_4",
        "hydronic_state_refrigerant_pressure_sensor",
        "hydronic_state_space_h_operation_output",
        "hydronic_state_system_off_on_system_off",
        "hydronic_state_tank_preheat_on_off",
        "hydronic_thermal_protector_q1l_buh",
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
        "outdoor_state_demand_signal",
        "outdoor_state_low_noise_control",
        "outdoor_state_oil_return_operation",
        "outdoor_state_pressure_equalizing_operation",
        "outdoor_state_restart_standby",
        "outdoor_state_startup_control",
        "outdoor_state_thermostat_on_off",
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

    int                    nsig = 0;
    const Signature*       raw  = def::signatures(nsig);
    std::vector<Signature> base(raw, raw + nsig);

    std::set<std::string> reachable;
    int                   ties = 0, deciding = 0, not_equiv = 0;
    for (const auto& fp : tie_break_sweep()) {
        int  bp = -1, bm = -1, bs = 0;
        bool have = false;
        for (const auto& sig : base) {
            if (!signature_consistent(sig, fp)) continue;
            const int pop   = __builtin_popcount(sig.page_mask);
            const int match = signature_kw_contains(sig, detect_capacity(fp)) ? 1 : 0;
            const int span =
                (sig.kw_min_tenths >= 0) ? (sig.kw_max_tenths - sig.kw_min_tenths) : 1000;
            if (!have || pop > bp || (pop == bp && match > bm) ||
                (pop == bp && match == bm && span < bs)) {
                bp   = pop;
                bm   = match;
                bs   = span;
                have = true;
            }
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
        if (!diff.empty()) {
            deciding++;
            reachable.insert(diff.begin(), diff.end());
        }
        // ...and the claim detect.hpp used to make: are the tied candidates register-equivalent?
        for (const auto& t : tied)
            if (pub[t].size() != pub[tied.front()].size()) {
                not_equiv++;
                break;
            }
    }

    std::set<std::string> expected(REACHABLE, REACHABLE + REACHABLE_N);
    CHECK(expected.size() == REACHABLE_N); // no duplicate literal above
    for (const auto& r : reachable)
        if (!expected.count(r)) std::printf("  tie-break can NOW decide: %s\n", r.c_str());
    for (const auto& e : expected)
        if (!reachable.count(e)) std::printf("  no longer tie-break-reachable: %s\n", e.c_str());
    CHECK(reachable == expected);

    // Non-vacuity + the measured shape of the hazard.
    CHECK(ties >= 100);    // measured 152
    CHECK(deciding >= 50); // measured 108
    CHECK(not_equiv >= 1); // tied != register-equivalent (see above)
    // Every reachable identifier is one the catalog really publishes, so a typo in the list above
    // fails here rather than silently widening the freeze.
    for (const auto& e : expected) {
        bool found = false;
        for (const auto& [id, ids] : pub) {
            (void)id;
            if (ids.count(e)) {
                found = true;
                break;
            }
        }
        CHECK(found);
    }
}

// ── Entity identity: no two announced entities may share a uniq_id (#221) ───────────────────────
// Home Assistant keys its entity registry on `uniq_id` and its discovery on the retained config
// TOPIC. Both are FLAT namespaces — while a catalog row's label is only unique within its register
// page. The catalog carries "Error Code" on the outdoor page AND on the hydronic one, so before
// #221 the two rows were announced under one id on one topic: the broker kept one payload, HA
// created one entity, and the second sensor silently did not exist. Nothing errored — in HA it
// reads as "my model doesn't have that sensor" — and the X10A topic was fine throughout (it nests
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
    const size_t      b   = cfg.find(key);
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
    const std::string st = "base/x10a", av = "base/status", hb = "base/heartbeat",
                      cr = "base/crash";

    std::set<std::string> colliding; // reported once, not once per profile
    int                   checked = 0;

    for (const auto& p : def::profiles) {
        const logic::ProfileView view = def::resolved(p); // the rows mqtt_ha really announces
        std::map<std::string, std::string> owner;         // uniq_id -> who claimed it first

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
            claim(uniq_id_of(crash_discovery_config(node, brd, cr, av, CRASH_SENSORS[i])), "crash",
                  crash_discovery_topic(pfx, node, CRASH_SENSORS[i]));
        // A RETIRED id is not published any more, but it must never be RE-USED either: the whole
        // point of retiring it is that a broker somewhere still holds its retained config, and a
        // new entity claiming that id would inherit the corpse instead of getting a fresh registry
        // entry. Both surfaces retire entities (crash: "Last Reset Reason"; heartbeat: "Device
        // Time", "WiFi Quality") and uniq_id is ONE flat namespace across them, so both lists are
        // burned.
        auto burned = [&](const RetiredHaSensor& r) {
            const std::string uid = node + "_" + r.object_id;
            auto              it  = owner.find(uid);
            if (it != owner.end() && colliding.insert(uid).second)
                std::printf("  live entity re-uses the RETIRED id %s on %s (claimed by %s)\n",
                            uid.c_str(), p.id, it->second.c_str());
        };
        for (int i = 0; i < RETIRED_CRASH_SENSOR_COUNT; i++) burned(RETIRED_CRASH_SENSORS[i]);
        for (int i = 0; i < RETIRED_HEARTBEAT_SENSOR_COUNT; i++)
            burned(RETIRED_HEARTBEAT_SENSORS[i]);
        for (int i = 0; i < RETIRED_WEATHER_HA_SENSOR_COUNT; i++)
            burned(RETIRED_WEATHER_HA_SENSORS[i]);
    }

    CHECK(checked > 4000); // every profile x every family, not a sampled subset
    CHECK(colliding.empty());
}

// ── logic/feature_gate.hpp — what may honestly run on the detected profile (#110 Part C) ─────────
static void test_feature_gate() {
    using namespace daik::logic;

    // `generic` is the case #69 names: detection failed, so the fallback carries the universal
    // register core and nothing else. Measured, not assumed — it has no leaving-water MEASUREMENT
    // (only "LW setpoint (main)", which the lwt_select rule correctly rejects), no INV frequency,
    // no expansion valve and no pressure row. The decision is DISABLE, so both gates are false.
    const auto gen = feature_coverage(def::lookup_view("generic"));
    CHECK(!gen.leaving_water);
    CHECK(!gen.run_state);
    CHECK(!gen.expansion_valve);
    CHECK(!gen.refrigerant_pressure);
    CHECK(gen.retry_counters);  // the supplement reaches `generic` too — it reads 0x10
    CHECK(!uc5_supported(gen)); // counters with no run-state to interpret them against
    CHECK(!inference_supported(gen));

    // A fully-equipped detected model is the opposite end: everything on, both gates open.
    const auto full =
        feature_coverage(def::lookup_view("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    CHECK(full.leaving_water && full.run_state && full.retry_counters);
    CHECK(full.expansion_valve && full.refrigerant_pressure);
    CHECK(uc5_supported(full));
    CHECK(inference_supported(full));

    // WHY THIS IS NOT AN `id == "generic"` CHECK, pinned as a measurement: the starvation is not
    // unique to the fallback. Across the DETECTABLE catalog a substantial minority carry no page
    // 0x30, hence no INV frequency and no expansion valve — an id check would have let inference
    // run without a run-state input on every one of them.
    int detectable = 0, no_run_state = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        detectable++;
        const auto c = feature_coverage(def::resolved(p));
        // Universal across the catalog: a leaving-water measurement (so lwt_select always resolves
        // — the #121 guarantee) and, now, the retry counters.
        CHECK(c.leaving_water);
        CHECK(c.retry_counters);
        if (!c.run_state) {
            no_run_state++;
            CHECK(!uc5_supported(c)); // disabled, never degraded
            CHECK(!inference_supported(c));
            CHECK(!c.expansion_valve); // both live on page 0x30 — they go together
        } else {
            CHECK(uc5_supported(c));
        }
    }
    CHECK(detectable >= 39);
    CHECK(no_run_state >= 10);        // a real minority, not a rounding error
    CHECK(no_run_state < detectable); // ...and not the whole catalog, or the gate says nothing

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
    ValueDef   ghost[]   = {{0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty", true}};
    const auto ghost_cov = feature_coverage(profile_view(ghost, 1, nullptr, 0, 0x10));
    CHECK(!ghost_cov.retry_counters);
    CHECK(!uc5_supported(ghost_cov));

    // A WATER pressure row is not refrigerant-circuit coverage.  Six detected profiles used to pass
    // this half of inference_supported() solely because type 2 means bar for both circuits.
    ValueDef   water_only[] = {{0x62, 11, 105, 1, 2, "Water pressure"}};
    const auto water_cov    = feature_coverage(profile_view(water_only, 1, nullptr, 0, 0x62));
    CHECK(!water_cov.refrigerant_pressure);

    int refrigerant_profiles = 0;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;
        const auto v           = def::resolved(p);
        const auto c           = feature_coverage(v);
        bool       refrigerant = false;
        for (size_t i = 0; i < v.count(); i++) {
            if (fg_is_refrigerant_pressure(v, i)) refrigerant = true;
        }
        if (refrigerant) refrigerant_profiles++;
        CHECK(c.refrigerant_pressure == refrigerant);
    }
    // All 39 current detection profiles structurally expose an outdoor pressure row.  This catalog
    // count is not the regression test for the bug — the synthetic water-only profile above is —
    // but it proves the hardening did not accidentally disable a real current profile.
    CHECK(refrigerant_profiles == 39);

    ValueDef outdoor_bar[] = {{0x20, 12, 105, 2, 2, "Pressure"}};
    CHECK(feature_coverage(profile_view(outdoor_bar, 1, nullptr, 0, 0x20)).refrigerant_pressure);

    // The pressure row and its structural saturation twin may live in different ProfileView spans;
    // flattening the view as base+count would be UB and checking only base would miss this case.
    ValueDef   hydronic_bar[]    = {{0x62, 15, 105, 2, 2, "Pressure sensor"}};
    ValueDef   saturation_twin[] = {{0x62, 15, 405, 2, 1, "Pressure sensor(T)"}};
    const auto cross_span        = profile_view(hydronic_bar, 1, saturation_twin, 1, 0x62);
    CHECK(feature_coverage(cross_span).refrigerant_pressure);

    ValueDef hidden_bar[] = {{0x20, 12, 105, 2, 2, "Pressure", true}};
    CHECK(!feature_coverage(profile_view(hidden_bar, 1, nullptr, 0, 0x20)).refrigerant_pressure);
}

static void test_refrigerant_service() {
    using namespace daik::logic;

    RefrigerantServiceCoverage c;
    refrigerant_service_cover_row(c, 0x30, 0, 152, false);
    refrigerant_service_cover_row(c, 0x60, 2, 315, false);
    refrigerant_service_cover_row(c, 0x60, 12, 306, false);
    refrigerant_service_cover_row(c, 0x10, 1, 304, false);
    refrigerant_service_cover_row(c, 0x20, 4, 105, false);
    refrigerant_service_cover_row(c, 0x20, 6, 105, false);
    refrigerant_service_cover_row(c, 0x20, 10, 105, false);
    refrigerant_service_cover_row(c, 0x30, 3, 151, false);
    refrigerant_service_cover_row(c, 0x62, 15, 105, true);
    refrigerant_service_cover_row(c, 0x20, 14, 105, true);
    refrigerant_service_cover_row(c, 0x20, 0, 105, false);
    refrigerant_service_cover_row(c, 0x20, 2, 105, false);
    refrigerant_service_cover_row(c, 0x10, 1, 306, false);
    refrigerant_service_cover_row(c, 0x10, 1, 305, false);
    refrigerant_service_cover_row(c, 0x10, 1, 303, false);
    refrigerant_service_cover_row(c, 0x10, 1, 302, false);
    refrigerant_service_cover_row(c, 0x60, 3, 203, false);
    CHECK(refrigerant_service_supported(c));
    CHECK(refrigerant_service_special_phases_known(c));
    CHECK(c.high_pressure && c.low_pressure && c.fault_rows == 1);

    // Water pressure never becomes either refrigerant side, even though its datatype is also bar.
    RefrigerantServiceCoverage water;
    refrigerant_service_cover_row(water, 0x62, 11, 105, false);
    CHECK(!water.high_pressure && !water.low_pressure);
    CHECK(!refrigerant_service_supported(water));
    CHECK(refrigerant_service_mode_from_text("Heating") == RefrigerantServiceMode::Heating);
    CHECK(refrigerant_service_mode_from_text("Cooling") == RefrigerantServiceMode::Cooling);
    CHECK(refrigerant_service_mode_from_text("Heating + DHW") == RefrigerantServiceMode::Other);
    CHECK(refrigerant_service_mode_from_text("DHW") == RefrigerantServiceMode::Other);
    CHECK(refrigerant_service_mode_from_text("?") == RefrigerantServiceMode::Unknown);

    RefrigerantServiceSample s;
    s.rps_known = s.rps_running = true;
    s.rps_tenths                = 310;
    s.mode                      = RefrigerantServiceMode::Heating;
    s.valve_known               = true;
    s.defrost_known             = true;
    s.fault_known               = true;
    s.restart_known = s.startup_known = s.oil_return_known = s.pressure_equalizing_known = true;
    s.discharge_ok                                                                       = true;
    s.discharge_tenths                                                                   = 820;
    s.suction_ok                                                                         = true;
    s.suction_tenths                                                                     = 20;
    s.liquid_ok                                                                          = true;
    s.liquid_tenths                                                                      = 310;
    s.eev_ok                                                                             = true;
    s.eev_tenths                                                                         = 2400;
    s.high_pressure_ok                                                                   = true;
    s.high_pressure_tenths                                                               = 153;
    s.low_pressure_ok                                                                    = true;
    s.low_pressure_tenths                                                                = 45;
    s.outdoor_air_ok                                                                     = true;
    s.outdoor_air_tenths                                                                 = 30;
    s.outdoor_hx_ok                                                                      = true;
    s.outdoor_hx_tenths                                                                  = -20;

    RefrigerantServiceTracker t;
    CHECK(!refrigerant_service_snapshot(t, 99999999).coverage_evaluated);
    constexpr int64_t service_gap_us = 5000000;
    refrigerant_service_record(t, c, s, 100000000, 7, service_gap_us);
    CHECK(refrigerant_service_snapshot(t, 100000000).coverage_evaluated);
    CHECK(t.state == RefrigerantServiceState::Observing);
    CHECK(t.continuous_us == 0 && t.samples == 1);
    CHECK(t.discharge.min_tenths == 820 && t.discharge.mean_tenths() == 820);
    s.discharge_tenths = 860;
    s.rps_tenths       = 330;
    refrigerant_service_record(t, c, s, 101250000, 7, service_gap_us);
    CHECK(t.continuous_us == 1250000 && t.samples == 2);
    CHECK(t.discharge.min_tenths == 820 && t.discharge.max_tenths == 860);
    CHECK(t.discharge.mean_tenths() == 840);
    const auto snap = refrigerant_service_snapshot(t, 102000000);
    CHECK(snap.state == RefrigerantServiceState::Observing && snap.samples == 2);
    CHECK(snap.continuous_s == 1);
    CHECK(snap.discharge.available && snap.discharge.mean_tenths == 840);

    RefrigerantServiceSample unknown_valve = s;
    unknown_valve.valve_known              = false;
    CHECK(!refrigerant_service_decide(c, unknown_valve).eligible);
    RefrigerantServiceSample unknown_fault = s;
    unknown_fault.fault_known              = false;
    CHECK(!refrigerant_service_decide(c, unknown_fault).eligible);
    RefrigerantServiceSample unknown_rps = s;
    unknown_rps.rps_known                = false;
    CHECK(refrigerant_service_decide(c, unknown_rps).blocker ==
          RefrigerantServiceBlocker::MissingFreshData);
    RefrigerantServiceSample cooling = s;
    cooling.mode                     = RefrigerantServiceMode::Cooling;
    CHECK(!refrigerant_service_decide(c, cooling).eligible);
    RefrigerantServiceSample dhw = s;
    dhw.valve_dhw                = true;
    CHECK(!refrigerant_service_decide(c, dhw).eligible);

    // A profile-provided special-phase witness is mandatory in every sample.  Unknown cannot mean
    // OFF and a later good sweep must start a new window instead of upgrading blind time.
    RefrigerantServiceSample blind_phase = s;
    blind_phase.startup_known            = false;
    CHECK(!refrigerant_service_decide(c, blind_phase).eligible);

    // An observed defrost interrupts instead of being folded into an apparently steady window.
    s.defrost_on = true;
    refrigerant_service_record(t, c, s, 102500000, 7, service_gap_us);
    CHECK(t.state == RefrigerantServiceState::Interrupted);
    CHECK(t.blocker == RefrigerantServiceBlocker::Defrost);
    CHECK(t.samples == 0);
    s.defrost_on = false;
    refrigerant_service_record(t, c, s, 103500000, 7, service_gap_us);
    CHECK(t.state == RefrigerantServiceState::Observing && t.samples == 1);

    // A gap is not interpolated.  The next fresh sweep starts a new window only after explicitly
    // reporting the interruption once.
    refrigerant_service_record(t, c, s, 110000000, 7, service_gap_us);
    CHECK(t.state == RefrigerantServiceState::Interrupted);
    CHECK(t.blocker == RefrigerantServiceBlocker::PollGap);
    refrigerant_service_record(t, c, s, 111000000, 7, service_gap_us);
    CHECK(t.state == RefrigerantServiceState::Observing && t.samples == 1);

    // A stalled poll is reflected by the read-only snapshot even before the poll task records its
    // next sample.  Snapshotting never mutates or extends the retained tracker.
    const auto stale = refrigerant_service_snapshot(t, 117000001);
    CHECK(stale.state == RefrigerantServiceState::Interrupted);
    CHECK(stale.blocker == RefrigerantServiceBlocker::PollGap);
    CHECK(stale.samples == 0 && t.samples == 1);

    // Deliberate quiescence and exception cycles are an evidence gap, never proof that the
    // compressor stopped.  An active window is interrupted; an idle tracker keeps waiting.
    RefrigerantServiceTracker active_gap = t;
    refrigerant_service_record_poll_gap(active_gap, 111500000, 7);
    CHECK(active_gap.state == RefrigerantServiceState::Interrupted);
    CHECK(active_gap.blocker == RefrigerantServiceBlocker::PollGap);
    CHECK(active_gap.mode == RefrigerantServiceMode::Unknown && active_gap.samples == 0);
    RefrigerantServiceTracker idle_gap;
    refrigerant_service_record_poll_gap(idle_gap, 111500000, 7);
    CHECK(!refrigerant_service_snapshot(idle_gap, 111500000).coverage_evaluated);
    CHECK(idle_gap.state == RefrigerantServiceState::Waiting);
    CHECK(idle_gap.blocker == RefrigerantServiceBlocker::PollGap);

    // Cooling cannot inherit a heating window: the established pressure-side role is heating-only.
    refrigerant_service_record(t, c, cooling, 112000000, 7, service_gap_us);
    CHECK(t.state == RefrigerantServiceState::Interrupted);
    CHECK(t.blocker == RefrigerantServiceBlocker::UnknownMode);

    // Without the profile-specific special-phase rows the same raw window is useful but LIMITED.
    RefrigerantServiceCoverage limited = c;
    limited.restart_standby = limited.startup = limited.oil_return = limited.pressure_equalizing =
        false;
    s.restart_known = s.startup_known = s.oil_return_known = s.pressure_equalizing_known = false;
    RefrigerantServiceTracker lt;
    refrigerant_service_record(lt, limited, s, 200000000, 9, service_gap_us);
    CHECK(lt.state == RefrigerantServiceState::Limited);
    CHECK(!lt.special_phases_known);
    CHECK(lt.limitation_mask & RefrigerantServiceSpecialPhases);

    // Optional context missing once limits the whole uninterrupted window even when it returns.
    s.suction_ok = false;
    refrigerant_service_record(lt, limited, s, 201000000, 9, service_gap_us);
    CHECK(lt.state == RefrigerantServiceState::Limited);
    CHECK(lt.limitation_mask & RefrigerantServiceTemperatures);
    s.suction_ok = true;
    refrigerant_service_record(lt, limited, s, 202000000, 9, service_gap_us);
    CHECK(lt.state == RefrigerantServiceState::Limited);

    // Missing/unknown is never the permissive OFF value, and a source generation change cannot
    // splice two physical units into one window.
    s.discharge_ok = false;
    refrigerant_service_record(lt, limited, s, 203000000, 9, service_gap_us);
    CHECK(lt.state == RefrigerantServiceState::Interrupted);
    CHECK(lt.blocker == RefrigerantServiceBlocker::MissingFreshData);
    s.discharge_ok = true;
    refrigerant_service_record(lt, limited, s, 204000000, 10, service_gap_us);
    CHECK(lt.state == RefrigerantServiceState::Limited);
    CHECK(lt.generation == 10 && lt.samples == 1 && lt.continuous_us == 0);

    // A non-monotonic clock cannot add time to the observation.
    refrigerant_service_record(lt, limited, s, 203999999, 10, service_gap_us);
    CHECK(lt.state == RefrigerantServiceState::Interrupted);
    CHECK(lt.blocker == RefrigerantServiceBlocker::PollGap);
}

// ── logic/state_dwell.hpp ───────────────────────────────────────────────────────────────────────
// How long a switched row has read what it reads. The interesting half is every case where the
// answer is NOTHING: this number is a claim about a stretch of time, and the board can only make it
// for the seconds it was actually watching.
static void test_state_dwell() {
    using namespace logic;

    // ── the state code ──────────────────────────────────────────────────────────────────────────
    // 0 is "no usable state" and must be produced for everything that is not a state, including the
    // shapes that LOOK like one. A binary row is the numeric 1/0 boundary (#210); anything else is
    // a contract break upstream and answering "state 0" for it would invent one.
    CHECK(dwell_code(304, "0") == 1);
    CHECK(dwell_code(304, "1") == 2);
    CHECK(dwell_code(304, "ON") == DWELL_CODE_NONE); // pre-#210 text must not decode
    CHECK(dwell_code(304, "") == DWELL_CODE_NONE);
    CHECK(dwell_code(304, nullptr) == DWELL_CODE_NONE);
    CHECK(dwell_code(304, "10") == DWELL_CODE_NONE); // not a flag value
    CHECK(dwell_code(203, "Normal") != DWELL_CODE_NONE);
    CHECK(dwell_code(203, "Error") != dwell_code(203, "Normal"));
    // conv 203's "?" is an undecodable class. It must never read as a state, because the state it
    // would be confused with is "no fault" — the one direction a fault reading must not fail in.
    CHECK(dwell_code(203, "?") == DWELL_CODE_NONE);
    CHECK(dwell_code(105, "42.0") == DWELL_CODE_NONE); // a temperature is not a state

    // The selector composes conv_is_binary rather than restating its range, so a converter added to
    // that family is tracked here without anyone remembering to say so twice.
    CHECK(dwell_tracked(300) && dwell_tracked(307) && dwell_tracked(203));
    CHECK(!dwell_tracked(204)); // the same event as its 203 companion, spelled differently
    CHECK(!dwell_tracked(105) && !dwell_tracked(151) && !dwell_tracked(211));

    // Evidence strength limits interpretation, not the raw ON/OFF age. Pin every P2 overlay tuple:
    // these were the exact rows whose infoboxes lacked "OFF >= ..." while neighbouring P1 flags
    // carried it. A neutral duration claims neither polarity nor meaning, so all eight must follow
    // the same binary-row contract.
    const DwellObservation p2_rows[] = {
        {0x10, 1, 307, 2},  {0x10, 1, 301, 2},  {0x10, 1, 300, 2},  {0x30, 13, 307, 2},
        {0x30, 13, 306, 2}, {0x30, 13, 305, 2}, {0x60, 11, 303, 2}, {0x60, 12, 302, 2},
    };
    for (const DwellObservation& row : p2_rows) {
        CHECK(dwell_tracked(row.conv));
        CHECK(dwell_row_tracked(row.reg, row.off, row.conv));
    }
    CHECK(dwell_row_tracked(0x10, 1, 305));  // Startup Control
    CHECK(dwell_row_tracked(0x30, 11, 307)); // 4 Way Valve
    CHECK(dwell_row_tracked(0x60, 11, 306)); // BUH thermal protector
    CHECK(dwell_row_tracked(0x62, 2, 302));  // System OFF

    DwellSlot included[DWELL_MAX_SLOTS] = {};
    dwell_step(included, DWELL_MAX_SLOTS, p2_rows, sizeof(p2_rows) / sizeof(p2_rows[0]), 1);
    for (const DwellObservation& row : p2_rows)
        CHECK(dwell_lookup(included, DWELL_MAX_SLOTS, row.reg, row.off, row.conv).known);

    // The table now crosses the old 64-bit observed mask. Exercise a row in word two twice: if the
    // second mask word is missing, slot 64 is incorrectly booked as blind in the very cycle that
    // observed it.
    DwellSlot        wide[DWELL_MAX_SLOTS]  = {};
    DwellObservation every[DWELL_MAX_SLOTS] = {};
    for (size_t i = 0; i < DWELL_MAX_SLOTS; i++) {
        every[i].reg  = static_cast<uint8_t>(0x70u + i / 32u);
        every[i].off  = static_cast<uint8_t>(i % 32u);
        every[i].conv = 304;
        every[i].code = 2;
    }
    dwell_step(wide, DWELL_MAX_SLOTS, every, DWELL_MAX_SLOTS, 1);
    dwell_step(wide, DWELL_MAX_SLOTS, every, DWELL_MAX_SLOTS, 1);
    const DwellObservation& beyond64 = every[64];
    const DwellReading      wide_read =
        dwell_lookup(wide, DWELL_MAX_SLOTS, beyond64.reg, beyond64.off, beyond64.conv);
    CHECK(wide_read.known && wide_read.since_s == 1 && wide_read.blind_s == 0);

    DwellSlot              slots[DWELL_MAX_SLOTS] = {};
    const DwellObservation off_row[]              = {{0x62, 2, 304, 1}};
    const DwellObservation on_row[]               = {{0x62, 2, 304, 2}};

    // ── a run this board joined in progress is a LOWER BOUND ────────────────────────────────────
    // Ten cycles of OFF establish "OFF for at least 10 s" and nothing more: the row was already OFF
    // when the poll task started, and stating a bare "OFF for 10 s" would be a true number carrying
    // a stronger claim than the evidence supports.
    dwell_step(slots, DWELL_MAX_SLOTS, off_row, 1, 1);
    for (int i = 0; i < 9; i++) dwell_step(slots, DWELL_MAX_SLOTS, off_row, 1, 1);
    DwellReading r = dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(r.known && !r.exact);
    CHECK(r.since_s == 9 && r.blind_s == 0);

    // A WITNESSED transition restarts the run and upgrades it: this board saw the state arrive, so
    // the anchor is its own observation rather than the moment it happened to start looking.
    dwell_step(slots, DWELL_MAX_SLOTS, on_row, 1, 1);
    r = dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(r.known && r.exact && r.since_s == 0 && r.blind_s == 0);
    for (int i = 0; i < 5; i++) dwell_step(slots, DWELL_MAX_SLOTS, on_row, 1, 1);
    r = dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(r.exact && r.since_s == 5);

    // ── a change found AFTER a gap is not a witnessed change ────────────────────────────────────
    // The transition happened somewhere inside the gap, so calling it exact would publish a precise
    // "for 0 s" about an instant nobody observed. The gap need not be long enough to have gone
    // stale for that to be wrong, which is why the rule tests the gap and not the stale flag.
    {
        DwellSlot g[DWELL_MAX_SLOTS] = {};
        dwell_step(g, DWELL_MAX_SLOTS, off_row, 1, 1);
        dwell_step(g, DWELL_MAX_SLOTS, off_row, 1, 1);
        CHECK(!dwell_lookup(g, DWELL_MAX_SLOTS, 0x62, 2, 304).exact); // joined in progress
        dwell_step(g, DWELL_MAX_SLOTS, on_row, 1, 1);                 // seen change, no gap
        CHECK(dwell_lookup(g, DWELL_MAX_SLOTS, 0x62, 2, 304).exact);
        // Now lose the row for 30 s — well inside DWELL_MAX_GAP_S — and find it changed.
        for (int i = 0; i < 30; i++) dwell_step(g, DWELL_MAX_SLOTS, nullptr, 0, 1);
        CHECK(dwell_lookup(g, DWELL_MAX_SLOTS, 0x62, 2, 304).known); // short gap: still speaking
        dwell_step(g, DWELL_MAX_SLOTS, off_row, 1, 1);
        const DwellReading after_gap = dwell_lookup(g, DWELL_MAX_SLOTS, 0x62, 2, 304);
        CHECK(after_gap.known && after_gap.since_s == 0);
        CHECK(!after_gap.exact); // the change is located only to within the 30 s nobody watched
    }

    // ── blind time is not unchanged time ────────────────────────────────────────────────────────
    // A page that does not answer removes its rows from the cache outright, and 47 such timeouts in
    // 8.2 h is what the reference installation actually produces. The wall clock does not stop, so
    // the run grows — but the OBSERVATION stopped, and `blind_s` is what stops the pair from being
    // reported as an unbroken watched run. This is #413/#414 one row at a time.
    for (int i = 0; i < 4; i++) dwell_step(slots, DWELL_MAX_SLOTS, nullptr, 0, 1);
    r = dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(r.known && r.exact && r.since_s == 9 && r.blind_s == 4);

    // Seeing it again clears the CURRENT gap but keeps the accumulated blind seconds: the caveat
    // belongs to the run, not to the last cycle.
    dwell_step(slots, DWELL_MAX_SLOTS, on_row, 1, 1);
    r = dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(r.since_s == 10 && r.blind_s == 4 && r.exact);

    // ── the gap bound applies to the CLOCK, not only to the missing rows ────────────────────────
    // checkup_step() gates its whole computation on the elapsed time and discards the previous
    // state past the bound. Enforcing that only in the unseen loop would leave a row PRESENT at
    // both ends of a stall — the poll task starved through an OTA install, a cycle dropped by the
    // bad_alloc guard — booking the entire stall as time somebody watched, which is the one
    // distinction this whole feature exists to draw.
    {
        DwellSlot c[DWELL_MAX_SLOTS] = {};
        dwell_step(c, DWELL_MAX_SLOTS, on_row, 1, 1);
        dwell_step(c, DWELL_MAX_SLOTS, on_row, 1, 1);
        dwell_step(c, DWELL_MAX_SLOTS, on_row, 1, 1);
        const DwellReading watched = dwell_lookup(c, DWELL_MAX_SLOTS, 0x62, 2, 304);
        CHECK(watched.known && watched.since_s == 2);
        // One call, the row present, a stall longer than the bound in between.
        dwell_step(c, DWELL_MAX_SLOTS, on_row, 1, DWELL_MAX_GAP_S + 1);
        const DwellReading after = dwell_lookup(c, DWELL_MAX_SLOTS, 0x62, 2, 304);
        CHECK(after.known);        // it IS being read again, so it has something to say
        CHECK(after.since_s == 0); // but not that the stall was a watched run
        CHECK(!after.exact);       // and the state may have moved and returned inside it
        // A stall INSIDE the bound is still a continuous observation — the rule must not fire on
        // the ordinary case of a slow sweep or one skipped cycle.
        DwellSlot ok[DWELL_MAX_SLOTS] = {};
        dwell_step(ok, DWELL_MAX_SLOTS, on_row, 1, 1);
        dwell_step(ok, DWELL_MAX_SLOTS, on_row, 1, DWELL_MAX_GAP_S);
        const DwellReading fine = dwell_lookup(ok, DWELL_MAX_SLOTS, 0x62, 2, 304);
        CHECK(fine.known && fine.since_s == DWELL_MAX_GAP_S);
    }

    // ── past the gap bound the slot says NOTHING ────────────────────────────────────────────────
    // A flag can go ON and back OFF inside a long gap, so a run that spans one cannot be vouched
    // for. The answer is the absence rule this project applies everywhere else: report nothing,
    // never a duration the board cannot stand behind.
    for (uint32_t i = 0; i <= DWELL_MAX_GAP_S; i++)
        dwell_step(slots, DWELL_MAX_SLOTS, nullptr, 0, 1);
    CHECK(!dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304).known);

    // Coming back starts a FRESH run that is again only a lower bound — a stale slot cannot vouch
    // for when the state it now sees actually arrived, even when the state is the one it last saw.
    dwell_step(slots, DWELL_MAX_SLOTS, on_row, 1, 1);
    r = dwell_lookup(slots, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(r.known && !r.exact && r.since_s == 0 && r.blind_s == 0);

    // ── a row that never answered occupies nothing ──────────────────────────────────────────────
    // The difference between "unchanged since boot" and "never seen" is the whole point: a silent
    // X10A bus must not produce a table of rows all claiming a long steady run.
    DwellSlot fresh[DWELL_MAX_SLOTS] = {};
    for (int i = 0; i < 50; i++) dwell_step(fresh, DWELL_MAX_SLOTS, nullptr, 0, 1);
    for (const DwellSlot& s : fresh) CHECK(!(s.flags & DWELL_F_USED));
    CHECK(!dwell_lookup(fresh, DWELL_MAX_SLOTS, 0x62, 2, 304).known);

    // An observation carrying no usable state is treated exactly like a row that did not answer —
    // it must not open a slot, and it must not extend one.
    const DwellObservation junk[] = {{0x62, 8, 303, DWELL_CODE_NONE}};
    dwell_step(fresh, DWELL_MAX_SLOTS, junk, 1, 1);
    CHECK(!dwell_lookup(fresh, DWELL_MAX_SLOTS, 0x62, 8, 303).known);

    // The converter is part of the key, and it is load-bearing rather than defensive: six flags
    // share the single byte 0x60/12 and differ only in which bit they mask, so a (reg, off) key
    // would make the diverter valve and the circulation pump one row.
    DwellSlot              shared[DWELL_MAX_SLOTS] = {};
    const DwellObservation byte_60_12[]            = {{0x60, 12, 306, 2}, {0x60, 12, 307, 1}};
    dwell_step(shared, DWELL_MAX_SLOTS, byte_60_12, 2, 1);
    dwell_step(shared, DWELL_MAX_SLOTS, byte_60_12, 2, 30);
    CHECK(dwell_lookup(shared, DWELL_MAX_SLOTS, 0x60, 12, 306).known);
    CHECK(dwell_lookup(shared, DWELL_MAX_SLOTS, 0x60, 12, 307).known);
    CHECK(dwell_find(shared, DWELL_MAX_SLOTS, 0x60, 12, 306) !=
          dwell_find(shared, DWELL_MAX_SLOTS, 0x60, 12, 307));
    CHECK(!dwell_lookup(shared, DWELL_MAX_SLOTS, 0x60, 12, 305).known); // a bit nobody reported

    // Saturation, because a wrap would turn a long run into a fresh one — a state change that never
    // happened, arriving through arithmetic instead of through the bus.
    CHECK(dwell_add_u32(UINT32_MAX - 1, 5) == UINT32_MAX);
    CHECK(dwell_add_u16(static_cast<uint16_t>(UINT16_MAX - 1), 5) == UINT16_MAX);

    // ── the restore ─────────────────────────────────────────────────────────────────────────────
    const uint32_t fp  = dwell_catalog_fingerprint();
    const uint32_t crc = 0x12345678u;
    CHECK(fp != 0);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::SW), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp, fp, crc, crc) == DwellRestore::Accept);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::POWERON), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp, fp, crc,
                                crc) == DwellRestore::PowerCycle);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::BROWNOUT), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp, fp, crc,
                                crc) == DwellRestore::PowerCycle);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::SW), 0, DWELL_PERSIST_VERSION,
                                fp, fp, crc, crc) == DwellRestore::NoRecord);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::SW), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION + 1, fp, fp, crc,
                                crc) == DwellRestore::WrongVersion);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::SW), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp ^ 1u, fp, crc,
                                crc) == DwellRestore::WrongCatalog);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::SW), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp, fp, crc,
                                crc ^ 1u) == DwellRestore::BadCrc);
    // A PANIC is the boot whose preceding state matters most, so it must adopt. SAFE MODE refuses
    // outright and is not about the bytes: it never starts the poll task, so nothing would age
    // these slots and an adopted table would go on reporting "OFF for 3 h" for as long as the latch
    // holds.
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::PANIC), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp, fp, crc, crc) == DwellRestore::Accept);
    CHECK(dwell_restore_verdict(static_cast<uint32_t>(CrashReason::SW), DWELL_PERSIST_MAGIC,
                                DWELL_PERSIST_VERSION, fp, fp, crc, crc,
                                true) == DwellRestore::SafeMode);

    // Adoption books the unwatched reboot window as blind rather than pretending it was observed.
    // A stale slot stays stale: it was already saying nothing, and a reboot is not evidence.
    DwellSlot carried[DWELL_MAX_SLOTS] = {};
    dwell_step(carried, DWELL_MAX_SLOTS, on_row, 1, 1);
    dwell_step(carried, DWELL_MAX_SLOTS, off_row, 1, 60);
    const DwellReading before = dwell_lookup(carried, DWELL_MAX_SLOTS, 0x62, 2, 304);
    dwell_adopt(carried, DWELL_MAX_SLOTS);
    const DwellReading after = dwell_lookup(carried, DWELL_MAX_SLOTS, 0x62, 2, 304);
    CHECK(after.known && after.exact);
    CHECK(after.since_s == before.since_s + DWELL_REBOOT_BLIND_S);
    CHECK(after.blind_s == before.blind_s + DWELL_REBOOT_BLIND_S);

    // A slot already mid-gap when the board went down has been unread for its own gap PLUS the
    // reboot. Restarting the counter would hand it a fresh DWELL_MAX_GAP_S on the other side — a
    // run vouched for across nearly twice the bound the rule states.
    DwellSlot midgap[DWELL_MAX_SLOTS] = {};
    dwell_step(midgap, DWELL_MAX_SLOTS, on_row, 1, 1);
    for (uint32_t i = 0; i < DWELL_MAX_GAP_S - 1; i++)
        dwell_step(midgap, DWELL_MAX_SLOTS, nullptr, 0, 1);
    CHECK(dwell_lookup(midgap, DWELL_MAX_SLOTS, 0x62, 2, 304).known); // one second of bound left
    dwell_adopt(midgap, DWELL_MAX_SLOTS);
    CHECK(!dwell_lookup(midgap, DWELL_MAX_SLOTS, 0x62, 2, 304).known); // the reboot spent it

    // ── the real catalog ────────────────────────────────────────────────────────────────────────
    // The table is fixed-size, so the question is whether any shipped profile can overflow it — a
    // silent drop of the last rows, with no error anywhere. Resolve the VIEW, not the base table:
    // def/overlay.hpp's page-0x10 drop-control flags are tracked rows too, so counting the
    // generated rows alone would answer correctly for the wrong reason today and wrongly the moment
    // the generator emits them.
    size_t worst = 0;
    for (const auto& p : def::profiles) {
        const auto v       = def::resolved(p);
        size_t     tracked = 0;
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef& row = v[i];
            if (!dwell_row_tracked(row.reg, row.offset, row.conv)) continue;
            tracked++;
            // A tracked row is a STATE, never a measurement: it must carry no physical unit, or the
            // value list would offer "42.0 °C unchanged for 3 h" as if a thermistor were a switch.
            CHECK(row.type == -1);
        }
        if (tracked > worst) worst = tracked;
    }
    CHECK(worst > 0);
    CHECK(worst == 63);
    CHECK(worst <= DWELL_MAX_SLOTS);
    // Headroom is stated rather than assumed: the day a generator run takes the worst case past the
    // table this fails here instead of on a device, where the symptom is one row quietly having no
    // dwell among a hundred that do.
    CHECK(worst + 8 <= DWELL_MAX_SLOTS);
}

// ── logic/checkup_persist.hpp ───────────────────────────────────────────────────────────────────
// The checkup's window is the part of this firmware that tolerates a reboot WORST: the window is
// 24 h and the requirements are hours long, so losing it loses the verdict rather than a few
// samples. These pin what may be re-adopted and, more importantly, what may not.
static void test_checkup_persist() {
    using namespace logic;

    const uint32_t fp  = checkup_layout_fingerprint();
    const uint32_t crc = 0xAABBCCDDu;

    // The happy path, and then every refusal in the order the verdict function ranks them: the
    // cheapest, most explanatory one must win, or a power-cycled board full of garbage gets
    // reported as a memory fault and sends a reader hunting for one that is not there.
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc,
                                  crc) == CheckupRestore::Accept);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::POWERON),
                                  CHECKUP_PERSIST_MAGIC, CHECKUP_PERSIST_VERSION, fp, fp, crc,
                                  crc) == CheckupRestore::PowerCycle);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), 0,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc,
                                  crc) == CheckupRestore::NoRecord);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION + 1, fp, fp, crc,
                                  crc) == CheckupRestore::WrongVersion);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp ^ 1u, fp, crc,
                                  crc) == CheckupRestore::WrongLayout);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc,
                                  crc ^ 1u) == CheckupRestore::BadCrc);

    // A PANIC is the boot whose preceding hours matter most, so it must adopt; a BROWNOUT must not,
    // because the supply dipped and the contents are not proven — refused rather than left to the
    // CRC, exactly as the trends refuse it.
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::PANIC), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc,
                                  crc) == CheckupRestore::Accept);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::BROWNOUT),
                                  CHECKUP_PERSIST_MAGIC, CHECKUP_PERSIST_VERSION, fp, fp, crc,
                                  crc) == CheckupRestore::PowerCycle);

    // SAFE MODE refuses outright, ahead of every intactness question, and it is the rule that is
    // not about the bytes: safe mode never starts the poll task, so nothing would age an adopted
    // window — it would sit frozen at its pre-reboot content, presented as a live 24-hour
    // assessment, for as long as the latch holds. Evidence outliving its source, which is exactly
    // what the checkup's own honesty rules exist to prevent.
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc, crc,
                                  /*safe_mode=*/true) == CheckupRestore::SafeMode);
    // ...and it outranks even a power cycle, so the reported reason is the one a reader can act on.
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::POWERON),
                                  CHECKUP_PERSIST_MAGIC, CHECKUP_PERSIST_VERSION, fp, fp, crc, crc,
                                  /*safe_mode=*/true) == CheckupRestore::SafeMode);
    CHECK(std::string(checkup_restore_slug(CheckupRestore::SafeMode)) == "safe_mode");
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc, crc,
                                  /*safe_mode=*/false, /*diagnostics_enabled=*/false, 4,
                                  4) == CheckupRestore::DiagnosticsDisabled);
    CHECK(checkup_restore_verdict(static_cast<uint32_t>(CrashReason::SW), CHECKUP_PERSIST_MAGIC,
                                  CHECKUP_PERSIST_VERSION, fp, fp, crc, crc,
                                  /*safe_mode=*/false, /*diagnostics_enabled=*/true, 4,
                                  5) == CheckupRestore::DiagnosticsChanged);

    // Every verdict says something distinct on /diag and /status.health.persist.
    CHECK(std::string(checkup_restore_slug(CheckupRestore::Accept)) == "accept");
    CHECK(std::string(checkup_restore_slug(CheckupRestore::WrongLayout)) == "wrong_layout");
    CHECK(std::string(checkup_restore_slug(CheckupRestore::ModelChanged)) == "model_changed");
    CHECK(std::string(checkup_restore_slug(CheckupRestore::PowerCycle)) == "power_cycle");
    CHECK(std::string(checkup_restore_slug(CheckupRestore::DiagnosticsDisabled)) ==
          "diagnostics_disabled");
    CHECK(std::string(checkup_restore_slug(CheckupRestore::DiagnosticsChanged)) ==
          "diagnostics_changed");

    // The layout fingerprint is the half a CRC cannot do. A bucket is a pile of anonymous counters:
    // nothing in `buh_s` says which row it came from, so an update that moved a locator or a
    // counting threshold would hand the previous build's numbers to a check that now means
    // something else by them. The fingerprint has to be STABLE across calls and SENSITIVE to that.
    CHECK(checkup_layout_fingerprint() == fp);
    CHECK(fp != 0);

    // The model identity is separate and is compared at detection. Different profile, different
    // window; the same profile re-detected on a fresh boot is the same unit and keeps its day.
    CHECK(checkup_model_fingerprint("altherma3_r_erga") ==
          checkup_model_fingerprint("altherma3_r_erga"));
    CHECK(checkup_model_fingerprint("altherma3_r_erga") !=
          checkup_model_fingerprint("altherma_top_grade"));
    CHECK(checkup_model_fingerprint("generic") != checkup_model_fingerprint(nullptr));
    // A prefix must not collide with the longer id it is a prefix of — the NUL is fed deliberately.
    CHECK(checkup_model_fingerprint("altherma_gshp") !=
          checkup_model_fingerprint("altherma_gshp2"));

    // The intentional-reboot handoff is separately sealed from the completed ring.  A finished DHW
    // window can live in the generic hour's pending bucket, and must survive even though the main
    // seal deliberately excludes every open bucket.
    DhwLossHandoffPayload dhw_handoff;
    dhw_handoff.candidate.flags                = DHW_LOSS_CARRY_SEGMENT | DHW_LOSS_CARRY_DRAW;
    dhw_handoff.candidate.segment_elapsed_s    = 3590;
    dhw_handoff.candidate.draw_anchor_age_s    = 120;
    dhw_handoff.candidate.segment_start_tenths = 500;
    dhw_handoff.candidate.draw_anchor_tenths   = 498;
    dhw_handoff.pending.observed_s             = 3599;
    dhw_handoff.pending.windows                = 1;
    dhw_handoff.pending.max_loss_tenths_k_h    = 7;
    const uint32_t model_fp                    = checkup_model_fingerprint("altherma3_r_erga");
    const uint32_t handoff_fp                  = checkup_dhw_handoff_layout_fingerprint();
    const uint32_t handoff_crc                 = checkup_dhw_handoff_crc(model_fp, dhw_handoff);
    CHECK(checkup_dhw_handoff_valid(CHECKUP_DHW_HANDOFF_MAGIC, CHECKUP_DHW_HANDOFF_VERSION,
                                    handoff_fp, model_fp, model_fp, handoff_crc, dhw_handoff));
    CHECK(!checkup_dhw_handoff_valid(CHECKUP_DHW_HANDOFF_MAGIC, CHECKUP_DHW_HANDOFF_VERSION,
                                     handoff_fp, model_fp, model_fp ^ 1u, handoff_crc,
                                     dhw_handoff));
    dhw_handoff.pending.windows++;
    CHECK(!checkup_dhw_handoff_valid(CHECKUP_DHW_HANDOFF_MAGIC, CHECKUP_DHW_HANDOFF_VERSION,
                                     handoff_fp, model_fp, model_fp, handoff_crc, dhw_handoff));

    // ── the carried lifecycle ────────────────────────────────────────────────────────────────────
    // first/latest_sample_us are MONOTONIC and restart at zero, so a restore cannot adopt them: the
    // previous boot's span rides as a duration instead. Without this the restored window would
    // report full_span() == false for another 24 h and every `ok` verdict would stay suppressed on
    // evidence the device actually has.
    CheckupRing r;
    r.observe(0);
    r.observe(20LL * 3600 * 1000000); // 20 h in this boot
    CHECK(!r.full_span());
    CHECK(r.span_us() == 20LL * 3600 * 1000000);

    CheckupRing restored;
    restored.carried_span_us = 20LL * 3600 * 1000000; // ...carried across a reboot
    CHECK(!restored.full_span());
    restored.observe(0);
    restored.observe(5LL * 3600 * 1000000); // plus 5 h in the new boot
    CHECK(restored.span_us() == 25LL * 3600 * 1000000);
    CHECK(restored.full_span());

    // reset() must clear it too, or an explicit re-detect would hand a brand-new window a lifecycle
    // it never observed — a green verdict bought with the previous unit's uptime.
    restored.reset();
    CHECK(restored.carried_span_us == 0);
    CHECK(restored.span_us() == 0);
    CHECK(!restored.full_span());

    // The seal excludes `pending`, so a restore drops the open hour. Its counters must not survive
    // into the adopted window: a partial hour was never a completed bucket.
    CheckupRing open;
    open.pending.covered_s = 1234;
    open.pending.starts    = 7;
    open.pending           = CheckupBucket{};
    CHECK(open.pending.covered_s == 0 && open.pending.starts == 0);

    // The durable source stores the EXACT hourly counters, not a reconstruction from five-minute
    // trends. Its identity covers both their meaning and the payload wire layout; its exact end
    // time rejects future/stale records and preserves a real rolling-day boundary after cold boot.
    CHECK(CHECKUP_JOURNAL_PAYLOAD_BYTES >= sizeof(CheckupJournalPayload));
    CHECK(CHECKUP_JOURNAL_PAYLOAD_BYTES % sizeof(uint16_t) == 0);
    CHECK(CHECKUP_JOURNAL_WORDS * sizeof(uint16_t) == CHECKUP_JOURNAL_PAYLOAD_BYTES);
    CHECK(checkup_journal_fingerprint() == checkup_journal_fingerprint());
    CHECK(checkup_journal_fingerprint() != checkup_layout_fingerprint());
    CHECK(checkup_journal_bucket(7'199) == 1);
    CHECK(checkup_journal_bucket(7'200) == 2);
    CHECK(checkup_journal_bucket(-1) == INT64_MIN);
    CHECK(checkup_journal_in_window(100'000, 100'000));
    CHECK(checkup_journal_in_window(100'000 - CHECKUP_WINDOW_S + 1, 100'000));
    CHECK(!checkup_journal_in_window(100'001, 100'000)); // future is never slid to now
    CHECK(!checkup_journal_in_window(100'000 - CHECKUP_WINDOW_S, 100'000));
    CHECK(checkup_journal_next_live_bucket(INT64_MIN, 6, 1) == 6);
    CHECK(checkup_journal_next_live_bucket(4, 6, 1) == 6); // hour 5 was a power-off gap
    CHECK(checkup_journal_next_live_bucket(4, 6, 2) == 5);
    CHECK(checkup_journal_next_live_bucket(6, 6, 2) == INT64_MIN);
    CHECK(checkup_journal_next_live_bucket(INT64_MIN, 6, 0) == INT64_MIN);
}

// ── logic/history_persist.hpp ───────────────────────────────────────────────────────────────────
// Persisting the rings is the one feature here whose failure mode is a CONFIDENTLY WRONG chart
// rather than an absent one, so the tests are written against the ways a restore can be wrong while
// looking right: adopted after a power cycle, adopted across a catalog change, or placed at the
// wrong instant on the axis.
static void test_history_persist() {
    using namespace logic;

    // --- the streaming CRC is the SAME function the config blob is sealed with -------------------
    // Split into update/final so the ring seal can skip the open bucket's `pending` (see the
    // header). The property every caller depends on is that feeding two regions equals feeding
    // their concatenation — if that broke, the blob's own integrity check would break with it.
    const char* v = "123456789";
    CHECK(config_crc32(reinterpret_cast<const uint8_t*>(v), 9) ==
          0xCBF43926u); // the standard vector
    uint32_t split = CONFIG_CRC32_INIT;
    split          = config_crc32_update(split, reinterpret_cast<const uint8_t*>(v), 4);
    split          = config_crc32_update(split, reinterpret_cast<const uint8_t*>(v) + 4, 5);
    CHECK(config_crc32_final(split) == 0xCBF43926u);
    CHECK(config_crc32_update(CONFIG_CRC32_INIT, nullptr, 0) == CONFIG_CRC32_INIT);

    // --- which resets leave DRAM intact ---------------------------------------------------------
    // The allow list, stated both ways. The refusals are the load-bearing half: adopting garbage as
    // a day of plant readings is the failure this check exists for, and POWERON is not the only way
    // to reach it — a brown-out leaves the chip powered while the contents are unproven.
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::SW)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::PANIC)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::TASK_WDT)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::INT_WDT)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::OTHER_WDT)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::CPU_LOCKUP)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::EXT)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::USB)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::JTAG)));
    CHECK(history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::SDIO)));
    CHECK(!history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::POWERON)));
    CHECK(!history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::BROWNOUT)));
    CHECK(!history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::PWR_GLITCH)));
    CHECK(!history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::DEEPSLEEP)));
    CHECK(!history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::EFUSE)));
    CHECK(!history_reset_preserves_ram(static_cast<uint32_t>(CrashReason::UNKNOWN)));
    CHECK(!history_reset_preserves_ram(9999)); // a newer IDF code: refused, not guessed

    // --- the verdict, and the ORDER it decides in -----------------------------------------------
    const uint32_t fp = history_catalog_fingerprint();
    // PR #8's exact catalog: existing dev.6/dev.7 flash records must stay on the
    // direct fast path while manifests make future catalog edits migratable.
    CHECK(fp == 0xda95bbc0u);
    const uint32_t sw = static_cast<uint32_t>(CrashReason::SW);
    CHECK(history_restore_verdict(sw, HISTORY_PERSIST_MAGIC, HISTORY_PERSIST_VERSION, fp, fp, 7,
                                  7) == HistoryRestore::Accept);
    // A power-cycled board is full of bytes that would ALSO fail the magic and the CRC. Reporting
    // the cheapest true cause keeps a reader from hunting a memory fault that is not there.
    CHECK(history_restore_verdict(static_cast<uint32_t>(CrashReason::POWERON), 0, 0, 0, fp, 1, 2) ==
          HistoryRestore::PowerCycle);
    CHECK(history_restore_verdict(sw, 0, HISTORY_PERSIST_VERSION, fp, fp, 7, 7) ==
          HistoryRestore::NoRecord);
    CHECK(history_restore_verdict(sw, HISTORY_PERSIST_MAGIC, 99, fp, fp, 7, 7) ==
          HistoryRestore::WrongVersion);
    CHECK(history_restore_verdict(sw, HISTORY_PERSIST_MAGIC, HISTORY_PERSIST_VERSION, fp ^ 1u, fp,
                                  7, 7) == HistoryRestore::WrongCatalog);
    CHECK(history_restore_verdict(sw, HISTORY_PERSIST_MAGIC, HISTORY_PERSIST_VERSION, fp, fp, 7,
                                  8) == HistoryRestore::BadCrc);
    CHECK(std::strcmp(history_restore_slug(HistoryRestore::Accept), "accept") == 0);
    CHECK(std::strcmp(history_restore_slug(HistoryRestore::NoRecord), "no_record") == 0);
    CHECK(std::strcmp(history_restore_slug(HistoryRestore::PowerCycle), "power_cycle") == 0);
    CHECK(std::strcmp(history_restore_slug(HistoryRestore::WrongVersion), "wrong_version") == 0);
    CHECK(std::strcmp(history_restore_slug(HistoryRestore::WrongCatalog), "wrong_catalog") == 0);
    CHECK(std::strcmp(history_restore_slug(HistoryRestore::BadCrc), "bad_crc") == 0);
    CHECK(std::strcmp(history_restore_slug(static_cast<HistoryRestore>(200)), "unknown") == 0);

    // --- the fingerprint separates what it must ------------------------------------------------
    // Deterministic (two calls agree) and it distinguishes the pieces a trend is made of. The
    // NUL terminator is what stops "ab"+"c" and "a"+"bc" hashing alike, which is the collision a
    // reordered pair of trend ids would otherwise slip through.
    CHECK(history_catalog_fingerprint() == fp);
    CHECK(history_fp_str(CONFIG_CRC32_INIT, "ab") != history_fp_str(CONFIG_CRC32_INIT, "ba"));
    CHECK(history_fp_str(history_fp_str(CONFIG_CRC32_INIT, "ab"), "c") !=
          history_fp_str(history_fp_str(CONFIG_CRC32_INIT, "a"), "bc"));
    CHECK(history_fp_str(CONFIG_CRC32_INIT, nullptr) == history_fp_str(CONFIG_CRC32_INIT, ""));
    CHECK(history_fp_u32(CONFIG_CRC32_INIT, 1) != history_fp_u32(CONFIG_CRC32_INIT, 256));

    // --- the official 8 MB append journal -------------------------------------------------------
    CHECK(HISTORY_FLASH_TOTAL_RINGS == 48);
    CHECK(HISTORY_FLASH_PARTITION_BYTES == 4u * 1024u * 1024u);
    CHECK(HISTORY_FLASH_ERASE_BYTES == 4096);
    CHECK(HISTORY_JOURNAL_HEADER_BYTES == 64);
    CHECK(HISTORY_JOURNAL_MAX_SOURCE_RINGS == 32);
    CHECK(history_journal_slot_bytes(HISTORY_JOURNAL_HEADER_BYTES + 48 * sizeof(uint32_t)) == 256);
    CHECK(history_journal_slot_bytes(HISTORY_JOURNAL_HEADER_BYTES + 49 * sizeof(uint32_t)) == 512);
    CHECK(history_journal_slot_bytes(256) == 256);
    CHECK(history_journal_slot_bytes(257) == 512);
    CHECK(history_journal_slot_bytes(513) == 1024);
    CHECK(HISTORY_JOURNAL_SLOT_BYTES == 256);
    CHECK(HISTORY_JOURNAL_SLOTS_PER_SECTOR == 16);
    CHECK(HISTORY_JOURNAL_SLOT_COUNT == 16384);
    CHECK(history_journal_source_rings(HistoryJournalSource::X10a) == 32);
    CHECK(history_journal_source_rings(HistoryJournalSource::Modbus) == 13);
    CHECK(history_journal_source_rings(HistoryJournalSource::Env3) == 3);
    CHECK(history_journal_source_rings(HistoryJournalSource::Checkup) == 0);
    CHECK(HISTORY_JOURNAL_SOURCE_COUNT == 4);
    CHECK(history_journal_slot_offset(17) == 17 * 256);
    CHECK(history_journal_sector_first_slot(17) == 16);
    CHECK(history_journal_next_sector_slot(15) == 16);
    CHECK(history_journal_next_sector_slot(HISTORY_JOURNAL_SLOT_COUNT - 1) == 0);
    CHECK(history_journal_write_slot(5, true) == 5);    // ordinary erased append
    CHECK(history_journal_write_slot(5, false) == 16);  // torn slot preserves earlier sector
    CHECK(history_journal_write_slot(16, false) == 16); // sector start is erased in place
    CHECK(history_journal_write_slot(HISTORY_JOURNAL_SLOT_COUNT - 1, false) == 0);
    CHECK(HISTORY_FLASH_FUTURE_HOURS == 72);
    CHECK(HISTORY_FLASH_FUTURE_SAMPLES == 864);
    CHECK(HISTORY_FLASH_FUTURE_RECORDS == 2664);
    CHECK(HISTORY_JOURNAL_SLOT_COUNT >= HISTORY_FLASH_FUTURE_RECORDS);
    CHECK(HISTORY_FLASH_PARTITION_OFFSET == 0x400000);

    HistoryJournalHeader jh{};
    jh.magic       = HISTORY_JOURNAL_MAGIC;
    jh.version     = HISTORY_JOURNAL_VERSION;
    jh.source      = static_cast<uint8_t>(HistoryJournalSource::X10a);
    jh.catalog_fp  = fp;
    jh.commit      = HISTORY_JOURNAL_ERASED;
    jh.value_count = static_cast<uint16_t>(TREND_COUNT);
    jh.slot_bytes  = static_cast<uint16_t>(HISTORY_JOURNAL_SLOT_BYTES);
    jh.sequence    = 42;
    jh.bucket      = 123456;
    jh.dt_s        = HISTORY_DT_S;
    jh.rings[0]    = static_cast<uint16_t>(TREND_COUNT);
    jh.rings[1]    = static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT);
    jh.rings[2]    = static_cast<uint16_t>(ENV3_HISTORY_COUNT);
    HistorySample journal_values[TREND_COUNT];
    for (size_t i = 0; i < TREND_COUNT; i++) journal_values[i] = static_cast<HistorySample>(i * 10);
    jh.crc = history_journal_crc(jh, journal_values, TREND_COUNT);
    CHECK(!history_journal_header_matches(jh, fp)); // body alone is never committed
    jh.commit = HISTORY_JOURNAL_COMMITTED;
    CHECK(history_journal_header_matches(jh, fp));
    CHECK(jh.crc == history_journal_crc(jh, journal_values, TREND_COUNT));
    journal_values[7]++;
    CHECK(jh.crc != history_journal_crc(jh, journal_values, TREND_COUNT));
    journal_values[7]--;
    CHECK(!history_journal_header_matches(jh, fp ^ 1u)); // catalog changes fail closed
    jh.value_count--;
    CHECK(!history_journal_header_matches(jh, fp)); // a short dense vector cannot shift ids

    // HomeHub records add a configured-target identity to the catalog identity. Old/unscoped v1
    // records fail closed, and host, port or unit changes cannot splice target A under target B.
    const uint32_t hub_a = history_homehub_target_fingerprint("hub-a.local", 502, 1);
    CHECK(hub_a != history_homehub_target_fingerprint("hub-b.local", 502, 1));
    CHECK(hub_a != history_homehub_target_fingerprint("hub-a.local", 1502, 1));
    CHECK(hub_a != history_homehub_target_fingerprint("hub-a.local", 502, 2));
    HistoryJournalHeader mh = jh;
    mh.source               = static_cast<uint8_t>(HistoryJournalSource::Modbus);
    mh.flags                = HISTORY_JOURNAL_FLAG_TARGET_SCOPED;
    mh.value_count          = static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT);
    mh.commit               = HISTORY_JOURNAL_ERASED;
    history_journal_set_scope(mh, hub_a);
    HistorySample hub_values[HOMEHUB_HISTORY_COUNT] = {};
    mh.crc    = history_journal_crc(mh, hub_values, HOMEHUB_HISTORY_COUNT);
    mh.commit = HISTORY_JOURNAL_COMMITTED;
    CHECK(history_journal_header_matches_scoped(mh, fp, hub_a));
    CHECK(!history_journal_header_matches_scoped(mh, fp, hub_a ^ 1u));
    CHECK(history_journal_header_matches_scoped_layout(
        mh, fp, HistoryJournalSource::Modbus)); // old targets still advance the physical head
    CHECK(!history_journal_header_matches(mh, fp));
    mh.flags = 0;
    CHECK(!history_journal_header_matches_scoped(mh, fp, hub_a));

    const uint32_t unit_a = history_x10a_target_fingerprint("profile-a", 44, 43, 'I');
    CHECK(unit_a != 0);
    CHECK(unit_a != history_x10a_target_fingerprint("profile-b", 44, 43, 'I'));
    CHECK(unit_a != history_x10a_target_fingerprint("profile-a", 43, 44, 'I'));
    CHECK(unit_a != history_x10a_target_fingerprint("profile-a", 44, 43, 'S'));
    // Optional detection witnesses are intentionally absent from this identity. A transiently
    // missing page/capacity/EEPROM reply cannot change the committed profile/link scope.
    CHECK(unit_a == history_x10a_target_fingerprint("profile-a", 44, 43, 'I'));
    HistoryJournalHeader xh = jh;
    xh.flags                = HISTORY_JOURNAL_FLAG_TARGET_SCOPED;
    xh.value_count          = static_cast<uint16_t>(TREND_COUNT);
    xh.commit               = HISTORY_JOURNAL_ERASED;
    history_journal_set_scope(xh, unit_a);
    xh.crc    = history_journal_crc(xh, journal_values, TREND_COUNT);
    xh.commit = HISTORY_JOURNAL_COMMITTED;
    CHECK(history_journal_header_matches_x10a_scoped(xh, fp, unit_a));
    CHECK(!history_journal_header_matches_x10a_scoped(xh, fp, unit_a ^ 1u));
    CHECK(history_journal_header_matches_scoped_layout(
        xh, fp, HistoryJournalSource::X10a)); // restore scope and global sequence are separate

    // Catalog manifests make the dense vector self-describing without repeating ids in every
    // five-minute record. Reordering is mapped, additions are absent only for the new series, and a
    // collision is refused rather than letting two plausible curves share one identity.
    CHECK(HISTORY_JOURNAL_PAYLOAD_BYTES == 192);
    CHECK(HISTORY_MANIFEST_MAX_IDS == 48);
    CHECK(HISTORY_MANIFEST_CACHE_PER_SOURCE == 4);
    CHECK(HISTORY_MANIFEST_REFRESH_BUCKETS == HISTORY_SAMPLES);
    uint32_t x_ids[HISTORY_MANIFEST_MAX_IDS]   = {};
    uint32_t mb_ids[HISTORY_MANIFEST_MAX_IDS]  = {};
    uint32_t env_ids[HISTORY_MANIFEST_MAX_IDS] = {};
    CHECK(history_current_series_ids(HistoryJournalSource::X10a, x_ids, HISTORY_MANIFEST_MAX_IDS) ==
          TREND_COUNT);
    CHECK(history_current_series_ids(HistoryJournalSource::Modbus, mb_ids,
                                     HISTORY_MANIFEST_MAX_IDS) == HOMEHUB_HISTORY_COUNT);
    CHECK(history_current_series_ids(HistoryJournalSource::Env3, env_ids,
                                     HISTORY_MANIFEST_MAX_IDS) == ENV3_HISTORY_COUNT);
    CHECK(history_series_ids_valid(x_ids, TREND_COUNT));
    CHECK(history_series_ids_valid(mb_ids, HOMEHUB_HISTORY_COUNT));
    CHECK(history_series_ids_valid(env_ids, ENV3_HISTORY_COUNT));
    CHECK(history_current_series_list_fingerprint(HistoryJournalSource::X10a) ==
          history_series_list_fingerprint(HistoryJournalSource::X10a, x_ids, TREND_COUNT));
    CHECK(history_series_id(HistoryJournalSource::X10a, TREND_COUNT) == 0);
    CHECK(history_series_id(HistoryJournalSource::Checkup, 0) == 0);

    uint32_t reordered[HISTORY_MANIFEST_MAX_IDS] = {};
    std::memcpy(reordered, x_ids, TREND_COUNT * sizeof(uint32_t));
    const uint32_t first_id    = reordered[0];
    reordered[0]               = reordered[TREND_COUNT - 1];
    reordered[TREND_COUNT - 1] = first_id;
    CHECK(history_series_index(reordered, TREND_COUNT, x_ids[0]) ==
          static_cast<int>(TREND_COUNT - 1));
    CHECK(history_series_index(reordered, TREND_COUNT, x_ids[TREND_COUNT - 1]) == 0);
    CHECK(history_series_index(reordered, TREND_COUNT, 0x12345678u) == -1); // new series
    reordered[1] = reordered[0];
    CHECK(!history_series_ids_valid(reordered, TREND_COUNT));
    CHECK(history_series_index(reordered, TREND_COUNT, x_ids[0]) == -1);

    HistoryJournalHeader manifest = xh;
    manifest.flags                = HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST;
    manifest.value_count          = static_cast<uint16_t>(TREND_COUNT);
    history_journal_set_schema_fingerprint(
        manifest, history_series_list_fingerprint(HistoryJournalSource::X10a, x_ids, TREND_COUNT));
    CHECK(history_journal_payload_bytes(manifest) == TREND_COUNT * sizeof(uint32_t));
    CHECK(history_journal_manifest_header_matches(manifest));
    CHECK(history_journal_manifest_payload_matches(manifest, x_ids));
    x_ids[2] ^= 1u;
    CHECK(!history_journal_manifest_payload_matches(manifest, x_ids));
    x_ids[2] ^= 1u;
    manifest.value_count = HISTORY_MANIFEST_MAX_IDS + 1;
    CHECK(!history_journal_manifest_header_matches(manifest));

    // Exact pre-#3 wire contract, measured by compiling that historical tree. Its dense vectors are
    // the only pre-manifest generation promised a built-in adapter: every old series maps by its
    // semantic id, while the two newly-added disinfection histories correctly have no predecessor.
    CHECK(history_legacy_disinfection_catalog_fingerprint() == 0x63ec0a62u);
    CHECK(history_legacy_disinfection_catalog_fingerprint() != fp);
    uint32_t legacy_x[HISTORY_MANIFEST_MAX_IDS]  = {};
    uint32_t legacy_mb[HISTORY_MANIFEST_MAX_IDS] = {};
    CHECK(history_legacy_disinfection_series_ids(HistoryJournalSource::X10a, legacy_x,
                                                 HISTORY_MANIFEST_MAX_IDS) == 31);
    CHECK(history_legacy_disinfection_series_ids(HistoryJournalSource::Modbus, legacy_mb,
                                                 HISTORY_MANIFEST_MAX_IDS) == 12);
    CHECK(history_legacy_disinfection_series_id(HistoryJournalSource::X10a, 31) == 0);
    CHECK(history_legacy_disinfection_series_id(HistoryJournalSource::Modbus, 12) == 0);
    int tank_preheat_index = -1;
    for (size_t i = 0; i < TREND_COUNT; ++i)
        if (trend_cstr_eq(TRENDS[i].id, "tank_preheat_state"))
            tank_preheat_index = static_cast<int>(i);
    CHECK(tank_preheat_index >= 0);
    CHECK(history_series_index(legacy_x, 31, x_ids[static_cast<size_t>(tank_preheat_index)]) == -1);
    CHECK(history_series_index(legacy_mb, 12, mb_ids[HOMEHUB_HISTORY_COUNT - 1]) == -1);
    CHECK(history_series_index(legacy_x, 31, x_ids[0]) == 0);
    CHECK(history_series_index(legacy_x, 31, x_ids[0] ^ 1u) == -1); // changed semantics
    CHECK(history_series_index(legacy_mb, 12, mb_ids[0]) == 0);
    CHECK(history_legacy_disinfection_stored_index(HistoryJournalSource::X10a,
                                                   static_cast<size_t>(tank_preheat_index)) == -1);
    CHECK(history_legacy_disinfection_stored_index(HistoryJournalSource::X10a, 0) == 0);
    CHECK(history_legacy_disinfection_stored_index(HistoryJournalSource::X10a,
                                                   static_cast<size_t>(tank_preheat_index + 1)) ==
          tank_preheat_index);
    CHECK(history_legacy_disinfection_stored_index(HistoryJournalSource::Modbus,
                                                   HOMEHUB_HISTORY_COUNT - 1) == -1);
    CHECK(history_legacy_disinfection_stored_index(HistoryJournalSource::Env3, 2) == 2);

    HistoryJournalHeader legacy = xh;
    legacy.catalog_fp           = history_legacy_disinfection_catalog_fingerprint();
    legacy.value_count          = 31;
    legacy.rings[0]             = 31;
    legacy.rings[1]             = 12;
    legacy.rings[2]             = 3;
    CHECK(history_journal_trend_header_structural_matches(legacy));
    CHECK(history_legacy_disinfection_layout_matches(legacy));
    legacy.rings[1] = 13;
    CHECK(!history_legacy_disinfection_layout_matches(legacy));

    // The fourth source extends v1 without changing the first three ids or invalidating their old
    // records. Its own layout fingerprint, hourly raster and word-rounded payload width are all
    // mandatory, and CRC covers the exact persisted CheckupBucket + DhwLossBucket bytes.
    CheckupJournalPayload checkup_payload;
    checkup_payload.model_fp                             = checkup_model_fingerprint("altherma3");
    checkup_payload.end_unix_s                           = 1'700'002'800;
    checkup_payload.checkup.rps_observed_s               = 3'599;
    checkup_payload.checkup.starts                       = 7;
    checkup_payload.dhw.observed_s                       = 3'500;
    uint8_t checkup_words[CHECKUP_JOURNAL_PAYLOAD_BYTES] = {};
    std::memcpy(checkup_words, &checkup_payload, sizeof(checkup_payload));
    HistoryJournalHeader ch = jh;
    ch.source               = static_cast<uint8_t>(HistoryJournalSource::Checkup);
    ch.catalog_fp           = checkup_journal_fingerprint();
    ch.value_count          = static_cast<uint16_t>(CHECKUP_JOURNAL_WORDS);
    ch.dt_s                 = CHECKUP_DT_S;
    ch.commit               = HISTORY_JOURNAL_ERASED;
    ch.crc                  = history_journal_crc_bytes(ch, checkup_words, sizeof(checkup_words));
    ch.commit               = HISTORY_JOURNAL_COMMITTED;
    CHECK(history_journal_header_matches(ch, checkup_journal_fingerprint(), CHECKUP_JOURNAL_WORDS,
                                         CHECKUP_DT_S));
    CHECK(!history_journal_header_matches(ch, fp)); // never interpreted as a trend vector
    CHECK(ch.crc == history_journal_crc_bytes(ch, checkup_words, sizeof(checkup_words)));
    checkup_words[offsetof(CheckupJournalPayload, checkup) + offsetof(CheckupBucket, starts)] ^= 1;
    CHECK(ch.crc != history_journal_crc_bytes(ch, checkup_words, sizeof(checkup_words)));
    checkup_words[offsetof(CheckupJournalPayload, checkup) + offsetof(CheckupBucket, starts)] ^= 1;
    CHECK(!history_journal_header_matches(ch, checkup_journal_fingerprint() ^ 1u,
                                          CHECKUP_JOURNAL_WORDS, CHECKUP_DT_S));
    CHECK(!history_journal_header_matches(ch, checkup_journal_fingerprint(), CHECKUP_JOURNAL_WORDS,
                                          HISTORY_DT_S));
    ch.rings[0] = 31;
    ch.rings[1] = 12;
    ch.rings[2] = 3;
    CHECK(history_journal_header_matches(ch, checkup_journal_fingerprint(), CHECKUP_JOURNAL_WORDS,
                                         CHECKUP_DT_S));

    // --- absolute buckets -----------------------------------------------------------------------
    CHECK(history_bucket_from_unix(0) == 0);
    CHECK(history_bucket_from_unix(299) == 0);
    CHECK(history_bucket_from_unix(300) == 1);
    CHECK(history_bucket_from_unix(1'700'000'000) == 1'700'000'000 / 300);
    // Floors toward minus infinity rather than truncating toward zero, so the grid has no wide cell
    // straddling the epoch. Unreachable with a real clock; a grid with one odd cell is not the kind
    // of thing that announces itself.
    CHECK(history_bucket_from_unix(-1) == -1);
    CHECK(history_bucket_from_unix(-300) == -1);
    CHECK(history_bucket_from_unix(-301) == -2);
    CHECK(history_bucket_from_unix(5, 0) == 0); // degenerate dt: 0, never a divide by zero

    // Live-device regression: 26 s after a reboot at unix 1786459116, the current five-minute wall
    // bucket began 216 s ago — before esp_timer's zero. The monotonic commit MUST stay negative;
    // clamping it to zero moved a flash-restored t0 from 1786458900 to the reboot instant
    // 1786459090.
    const int64_t wall_bucket = history_bucket_from_unix(1'786'459'116);
    const int64_t commit_us   = history_anchor_commit_us(26'000'000, 1'786'459'116, wall_bucket);
    CHECK(commit_us == -190'000'000);
    const uint32_t restored_age_s = static_cast<uint32_t>((26'000'000 - commit_us) / 1'000'000);
    CHECK(history_t0(1'786'459'116, restored_age_s, 1, HISTORY_DT_S) == 1'786'458'900);
    CHECK(history_anchor_commit_us(123, 456, 789, 0) == 123);

    // --- locating the journal-backed span --------------------------------------------------------
    // The record buckets, not their values, define the restored span. This is load-bearing for a
    // register that was unavailable for every sample: its all-NO_READING raster must still survive.
    CHECK(history_flash_restore_start(1000, 1000) == HISTORY_SAMPLES - 1);
    CHECK(history_flash_restore_start(998, 1000) == HISTORY_SAMPLES - 3);
    CHECK(history_flash_restore_start(1000 - (HISTORY_SAMPLES - 1), 1000) == 0);
    CHECK(history_flash_restore_start(500, 1000) == 0); // older data clamps to this window
    CHECK(history_flash_restore_start(INT64_MIN, 1000) == HISTORY_SAMPLES);
    CHECK(history_flash_restore_start(1001, 1000) == HISTORY_SAMPLES);
    CHECK(history_flash_restore_start(1000, 1000, 0) == 0);

    // --- the splice -----------------------------------------------------------------------------
    // The restored samples go BEHIND what this boot recorded, each at the absolute bucket it was
    // actually taken in — the whole point, since a snapshot that is merely appended slides a
    // day-old curve onto today.
    HistorySample       out[HISTORY_SAMPLES];
    const HistorySample oldv[3]  = {100, 200, 300};
    const HistorySample livev[2] = {11, 22};
    HistorySnapshotView snap;
    snap.v             = oldv;
    snap.n             = 3;
    snap.stride        = 2;
    snap.newest_bucket = 1000;

    // Live holds buckets 1004..1005; the snapshot holds 996, 998, 1000. Everything between is a
    // gap.
    size_t n = history_splice(snap, livev, 2, 1005, out, HISTORY_SAMPLES);
    CHECK(n == 10);                   // 996 .. 1005
    CHECK(out[0] == 100);             // 996
    CHECK(history_is_absent(out[1])); // 997 — the stride's own gap, not a failure
    CHECK(out[2] == 200);             // 998
    CHECK(out[4] == 300);             // 1000
    CHECK(history_is_absent(out[5])); // 1001 — the outage between the two lives
    CHECK(out[8] == 11);              // 1004
    CHECK(out[9] == 22);              // 1005

    // THE LIVE SAMPLE WINS in an overlap, including when it is an absence: this boot observed that
    // bucket itself, and a retained payload from a previous life of the same five minutes must not
    // overwrite the observation.
    const HistorySample gap_live[3] = {HISTORY_NO_READING, 11, 22};
    snap.newest_bucket              = 1005; // snapshot buckets 1001, 1003, 1005
    n                               = history_splice(snap, gap_live, 3, 1005, out, HISTORY_SAMPLES);
    CHECK(n == 5);                    // 1001 .. 1005
    CHECK(out[0] == 100);             // 1001 — outside the live range, snapshot only
    CHECK(history_is_absent(out[1])); // 1002 — between two coarse samples
    CHECK(history_is_absent(out[2])); // 1003 — live absence beats the snapshot's 200
    CHECK(out[3] == 11);
    CHECK(out[4] == 22); // 1005 — live beats the snapshot's 300

    // A snapshot claiming to be NEWER than the live ring is refused rather than clamped — the two
    // anchors disagree about the present, and every position for it would be a guess.
    snap.newest_bucket = 2000;
    n                  = history_splice(snap, livev, 2, 1005, out, HISTORY_SAMPLES);
    CHECK(n == 2);
    CHECK(out[0] == 11 && out[1] == 22); // live alone, snapshot ignored

    // Aged wholly out of the 24-hour window: not an error, just nothing to contribute.
    snap.newest_bucket = 1005 - static_cast<int64_t>(HISTORY_SAMPLES);
    n                  = history_splice(snap, livev, 2, 1005, out, HISTORY_SAMPLES);
    CHECK(n == 2);
    CHECK(out[0] == 11 && out[1] == 22);

    // An EMPTY live ring is the normal case right after a power-loss boot: the snapshot alone
    // defines the window, and it must still land on its own buckets.
    snap.newest_bucket = 1000;
    n                  = history_splice(snap, nullptr, 0, 1005, out, HISTORY_SAMPLES);
    CHECK(n == 10);
    CHECK(out[4] == 300);
    CHECK(history_is_absent(out[9])); // 1005 — open, nothing recorded there yet

    // Nothing on either side.
    CHECK(history_splice(HistorySnapshotView{}, nullptr, 0, 1005, out, HISTORY_SAMPLES) == 0);
    CHECK(history_splice(snap, livev, 2, 1005, nullptr, HISTORY_SAMPLES) == 0);
    CHECK(history_splice(snap, livev, 2, 1005, out, 0) == 0);

    // The window CAP truncates the old end: a snapshot older than the ring can hold contributes
    // only the part that still fits, and the axis stays exactly 24 hours.
    snap.newest_bucket = 1005 - static_cast<int64_t>(HISTORY_SAMPLES) + 1; // oldest still inside
    n                  = history_splice(snap, livev, 2, 1005, out, HISTORY_SAMPLES);
    CHECK(n == HISTORY_SAMPLES);
    CHECK(out[0] == 300); // its newest sample sits at the window edge
    CHECK(out[HISTORY_SAMPLES - 1] == 22);
}

// ── The converter adjudication (logic/conv_override.hpp) — #194 ──────────────────────────────────
// The ledger asserts a DIFFERENT value, not merely a withheld one, so what is pinned here is the
// evidence itself: the wire integers. If a future generator run, a REGISTERS.md edit or a converter
// change ever makes the ÷128 reading stop reproducing them, this fails rather than quietly shipping
// a second wrong scale.
static void test_conv_override() {
    // Identity for everything the ledger is silent about — which is all of the catalog but one row.
    CHECK(logic::effective_conv(0x10, 8, 114) ==
          114); // Target Cond. Temp.: same page, same converter
    CHECK(logic::effective_conv(0xA1, 5, 114) == 114); // Target Discharge Temp.
    CHECK(logic::effective_conv(0xA1, 7, 114) == 114); // Target port temperature
    CHECK(logic::effective_conv(0x61, 2, 105) ==
          105); // leaving water — the row that must never move
    CHECK(logic::effective_conv(0x10, 6, 105) ==
          105); // right coordinates, WRONG converter: no match
    CHECK(logic::effective_conv(0x11, 6, 114) == 114); // right converter, wrong page
    CHECK(logic::effective_conv(0x10, 7, 114) == 114); // right page, wrong offset
    CHECK(logic::effective_conv(0x10, 6, 114) == 109); // the one entry

    // THE EVIDENCE. Every distinct 16-bit value this row has ever been observed to carry — 46
    // run-time (recovered exactly from the published series, since conv 114 prints raw × 0.1 at one
    // decimal) and 8 at rest (from the boot-time page dumps replayed to syslog). Under ÷128 each is
    // floor(128 × T) for T on an exact 0.1 K grid; the set {floor(12.8k)} has density 1/12.8, so
    // 54/54 is p ~ 1.6e-60 against any other scale. THIS is why the row could be re-decoded on one
    // unit's data where a merely-plausible range could not have justified it.
    static const int OBSERVED[] = {
        1331, 1344, 1369, 1382, 1395, 1408, 1420, 1433, 1446, 1459, 1472, 1484,
        1510, 1536, 1548, 1561, 1574, 1587, 1600, 1612, 1625, 1651, 1664, 1689,
        1702, 1728, 1740, 1753, 1766, 1779, 1792, 1804, 1817, 1830, 1856, 1868,
        1881, 1894, 1907, 1920, 1932, 1945, 1958, 1971, 1984, 1996, // compressor running
        2201, 2214, 2240, 2304, 2342, 2393, 2406, 2432,             // at rest
    };
    const ValueDef row = logic::adjudicated(ValueDef{0x10, 6, 114, 2, 1, "Target Evap. Temp."});
    for (size_t i = 0; i < sizeof(OBSERVED) / sizeof(OBSERVED[0]); i++) {
        const int     raw      = OBSERVED[i];
        const uint8_t bytes[2] = {
            static_cast<uint8_t>(raw & 0xFF),
            static_cast<uint8_t>((raw >> 8) & 0xFF)}; // s16 LE, as on the wire
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

// ── The label ledger (logic/label_override.hpp) — #230 A
// ────────────────────────────────────────── The sibling of test_conv_override(): the same
// "generated table is wrong, corrected in logic/, pinned against the real catalog" shape — but for
// the row's LABEL, which is the HA entity id and the VictoriaMetrics series suffix
// (logic/discovery.hpp), so the correction moves what the device publishes, not how a value
// decodes.
static void test_label_override() {
    // Identity for the rows the ledger is silent about, and the exact structural key it fires on.
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 2, 211, "Fan 2 (step)"),
                              "Fan 2 (step)")); // neighbour: untouched
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 1, 211, "Fan 1 (step)"),
                              "Fan 1 (step)")); // already correct: no `from` match
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 1, 210, "Fan 1 (10 rpm)"),
                              "Fan 1 (10 rpm)")); // wrong converter: no match
    CHECK(logic::label_str_eq(logic::effective_label(0x31, 1, 211, "Fan 1 (10 rpm)"),
                              "Fan 1 (10 rpm)")); // wrong page: no match
    CHECK(logic::label_str_eq(logic::effective_label(0x30, 1, 211, "Fan 1 (10 rpm)"),
                              "Fan 1 (step)")); // THE entry

    // The corrected row publishes as actuators_fan_1_step — one identifier, two surfaces (#221):
    // the group-scoped HA entity id AND the un-grouped state key / VictoriaMetrics series suffix
    // both move.
    const ValueDef row = logic::adjudicated(ValueDef{0x30, 1, 211, 1, -1, "Fan 1 (10 rpm)"});
    CHECK(logic::label_str_eq(row.label, "Fan 1 (step)"));
    CHECK(row_object_id(row) == "actuators_fan_1_step");
    CHECK(object_id(row.label) == "fan_1_step");

    // SELF-RETIRE PIN, exactly as test_conv_override() pins conv 114's 44 rows. The GENERATED
    // tables still carry the wrong label on precisely FOUR profiles; the day gen_profiles.py emits
    // "Fan 1 (step)" this count hits 0, the override matches nothing and is dead code, and this
    // CHECK trips — the signal to delete the label_override entry, this pin, and
    // retract_relabeled_values.
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

// ── The availability ledger (logic/availability.hpp) — #209 defects 1, 2 and 6
// ──────────────────── Two things are asserted, and the second is the one that matters. The first
// is that each rule does what it says on a hand-built row. The second is what it does to the REAL
// CATALOG: a rule keyed on (page, offset, converter) is a claim about every profile at once, so the
// catalog loop is what proves it selects the quantity that was adjudicated and nothing else — the
// failure mode being a rule that silently starts suppressing a real hydronic reading on some other
// model.
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
    CHECK(row_publishable(cond));             // the ENTITY stays — this field can be populated
    CHECK(!value_available(cond, true, 0.0)); // raw 0x0000: unpopulated, not a 0 °C target
    CHECK(value_available(cond, true, 35.0)); // a real target still publishes
    CHECK(value_available(cond, true, -0.1)); // and the rule is an EXACT zero, not a band

    // A text/enum row has no number to judge and passes through untouched.
    CHECK(value_available(cond, false, 0.0));

    // CT-L3 shares bit 7 with the documented HP Forced FG. The intrinsic converter stays
    // whole-byte ×0.5 A; availability withholds only the affected row when the current page proves
    // the flag is asserted. A caller without that witness fails open, like the other page rules.
    const ValueDef ct_l3{0x63, 16, 161, 1, -1, "Current measured by CT sensor of L3"};
    uint8_t        page63[17] = {};
    page63[16]                = 0x80;
    CHECK(availability_policy(ct_l3) == AvailabilityPolicy::Bit7MeansAbsent);
    CHECK(!value_available(ct_l3, true, 64.0, page63, sizeof(page63)));
    CHECK(value_available(ct_l3, true, 64.0));
    page63[16] = 0x7f;
    CHECK(value_available(ct_l3, true, 63.5, page63, sizeof(page63)));
    const ValueDef ct_l2{0x63, 15, 161, 1, -1, "Current measured by CT sensor of L2"};
    page63[15] = 0x80;
    CHECK(availability_policy(ct_l2) == AvailabilityPolicy::Always);
    CHECK(value_available(ct_l2, true, 64.0, page63, sizeof(page63)));

    // ── The page-0x21 zero rows, and the label key that makes them safe (#224) ───────────────────
    // The three air-source rows are withheld at exactly 0.0 …
    const ValueDef fan1{0x21, 6, 105, 2, 1, "Fan1 Fin temp."};
    const ValueDef fan2{0x21, 8, 105, 2, 1, "Fan2 Fin temp."};
    const ValueDef cout{0x21, 10, 105, 2, 1, "Compressor outlet temperature"};
    for (const ValueDef* d : {&fan1, &fan2, &cout}) {
        CHECK(availability_policy(*d) == AvailabilityPolicy::ZeroMeansAbsent);
        CHECK(row_publishable(*d));             // the ENTITY stays — the field CAN be populated
        CHECK(!value_available(*d, true, 0.0)); // the unpopulated field
        CHECK(value_available(*d, true, 42.0)); // a real heatsink reading still publishes
        CHECK(value_available(*d, true, -0.1)); // exact zero, not a band
        CHECK(value_available(*d, true, 0.1));
    }

    // … and the GEOTHERMAL rows at the very same (reg, offset, conv) are NOT. This is the half that
    // matters: brine circulates near 0 °C and evaporating refrigerant sits at it, so a
    // coordinate-only rule would delete those units' most load-bearing reading exactly where it
    // counts. A byte-identical coordinate with a different label must stay Always.
    const ValueDef brine_in{0x21, 6, 105, 2, 1, "Brine inlet temp."};
    const ValueDef brine_out{0x21, 8, 105, 2, 1, "Brine outlet temp."};
    const ValueDef evap_in{0x21, 8, 105, 2, 1, "Refrig. temp. evap. In"};
    const ValueDef evap_out{0x21, 10, 105, 2, 1, "Refrig. temp. evap.Out"};
    for (const ValueDef* d : {&brine_in, &brine_out, &evap_in, &evap_out}) {
        CHECK(availability_rule(*d) == nullptr);
        CHECK(availability_policy(*d) == AvailabilityPolicy::Always);
        CHECK(value_available(*d, true, 0.0)); // 0 °C brine is a reading, not an absence
    }

    // ── Page 0x20: the LOW-side rows stay published, the HIGH-side one is conditional (#224) ─────
    // The outdoor coil (the evaporator in heating) and the suction pipe are on the LOW side, and
    // the only witness the catalog carries is the HIGH side. A coil at 0 °C while the refrigerant
    // condenses at 49 °C is an ordinary January afternoon, not a contradiction — so these two must
    // stay Always, and must stay published EVEN WITH a strong witness present. That second
    // assertion is the load-bearing one: it is what stops someone widening the liquid-line rule to
    // "all three 0x20 zeros" and silently withholding a real winter reading.
    const ValueDef          ou_hx{0x20, 2, 105, 2, 1, "O/U Heat Exch. Temp."};
    const ValueDef          suction{0x20, 6, 105, 2, 1, "Suction pipe temp."};
    const SaturationWitness hot{true, 49.0};
    for (const ValueDef* d : {&ou_hx, &suction}) {
        CHECK(availability_policy(*d) == AvailabilityPolicy::Always);
        CHECK(value_available(*d, true, 0.0));
        CHECK(value_available(*d, true, 0.0, nullptr, 0, hot)); // witness present: still published
    }

    // The LIQUID LINE is the high side, so the same witness refutes its zero: liquid temperature =
    // condensing temperature - subcooling, and 0.00 against 49 °C claims ~49 K of it.
    // ALL THREE air-source spellings carry the rule (29 + 6 + 4 = 39 catalog rows); the geothermal
    // Leaving brine temp.(R6T) at the identical coordinate must never reach it.
    const ValueDef liq_r6t{0x20, 10, 105, 2, 1, "Liquid pipe temp.(R6T)"};
    const ValueDef liq_r3t{0x20, 10, 105, 2, 1, "Liquid temperature(R3T)"};
    const ValueDef liq_bare{0x20, 10, 105, 2, 1, "Liquid pipe temp."};
    for (const ValueDef* d : {&liq_r6t, &liq_r3t, &liq_bare}) {
        CHECK(availability_policy(*d) == AvailabilityPolicy::ZeroAbsentAboveSaturation);
        // 1. witness present and REFUTING -> withheld
        CHECK(!value_available(*d, true, 0.0, nullptr, 0, hot));
        // 2. witness present and AGREEING (the circuit is cold, so 0 °C is reachable) -> PUBLISHED.
        //    This is the half that makes the rule conditional rather than flat, and it is what a
        //    reversed comparison would break while every other case still passed.
        CHECK(value_available(*d, true, 0.0, nullptr, 0, SaturationWitness{true, 5.0}));
        // 3. no witness at all (no witness row, page silent, sensor absent) -> PUBLISHED (fails
        // open)
        CHECK(value_available(*d, true, 0.0));
        CHECK(value_available(*d, true, 0.0, nullptr, 0, SaturationWitness{false, 49.0}));
        // 4. a real reading is never touched, whatever the witness says
        CHECK(value_available(*d, true, 44.0, nullptr, 0, hot));
        CHECK(value_available(*d, true, -0.1, nullptr, 0, hot)); // exact zero, not a band
        CHECK(value_available(*d, true, 0.1, nullptr, 0, hot));
        // 5. a text/enum row has no number to judge
        CHECK(value_available(*d, false, 0.0, nullptr, 0, hot));
    }
    // The bound is a strict >, so a witness exactly AT the ceiling does not withhold.
    CHECK(value_available(liq_r6t, true, 0.0, nullptr, 0,
                          SaturationWitness{true, LIQUID_LINE_SAT_CEILING}));

    // The GEOTHERMAL row at the very same coordinate: brine LEAVING a ground loop sits at 0 °C in
    // normal operation, so it must be untouched even under a refuting witness.
    const ValueDef brine_out_r6t{0x20, 10, 105, 2, 1, "Leaving brine temp.(R6T)"};
    CHECK(availability_rule(brine_out_r6t) == nullptr);
    CHECK(availability_policy(brine_out_r6t) == AvailabilityPolicy::Always);
    CHECK(value_available(brine_out_r6t, true, 0.0, nullptr, 0, hot));

    // The catalog-wide reach of this rule — every 0x20/10 spelling in every profile, in both
    // directions — is pinned in test_availability_catalog() below, beside the other ledger reaches.

    // THE WITNESS-ROW GATE. The capture may only read the witness bytes out of a profile that
    // DECLARES that row; on a model without it those bytes are whatever that model puts there, and
    // a pressure read off them would be an invented witness — the one direction that must be
    // impossible, since a witness can only ever take a reading away.
    const ValueDef with_witness[] = {{0x62, 15, 405, 2, 1, "Pressure sensor(T)"}};
    const ValueDef no_witness[]   = {{0x62, 11, 105, 1, 2, "Water pressure"},
                                     {0x62, 15, 105, 2, 2, "Refrigerant pressure sensor"}};
    CHECK(profile_has_saturation_witness(with_witness, 1));
    CHECK(!profile_has_saturation_witness(no_witness, 2)); // the bar twin alone is not a witness
    CHECK(!profile_has_saturation_witness(nullptr, 0));
    CHECK(!profile_has_saturation_witness(with_witness, 0));

    // ── Expansion valve pulses: raw 0xFFF8 is not a position ─────────────────────────────────────
    // BYTE LEVEL, because the whole finding is about which integer arrives on the wire. conv 151 is
    // u16 little-endian, so the field is {low, high}.
    const ValueDef ev1{0x30, 3, 151, 2, -1, "Expansion valve 1 (pls)"};
    const uint8_t  ev_parked[] = {0xC2, 0x01}; // 450 — the position it rests at between cycles
    const uint8_t  ev_widest[] = {0xDA, 0x01}; // 474 — the widest opening in 30 d of samples
    const uint8_t  ev_shut[]  = {0x00, 0x00}; // 0 — a closed valve is a real reading, not absence
    const uint8_t ev_glitch[] = {0xF8, 0xFF}; // 0xFFF8 — 65528 unsigned / -8 signed; neither is a
                                              // valve position, which is why the fix is a
                                              // withholding and not a re-read of the sign.
    CHECK(availability_policy(ev1) == AvailabilityPolicy::AboveRangeIsAbsent);
    CHECK(row_publishable(ev1)); // the ENTITY stays — the valve is real

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

    // The bound is an impossibility filter, not a working-range check: a position well past
    // anything this unit reaches still publishes, because a larger model's valve legitimately
    // might.
    CHECK(value_available(ev1, true, 1999.0));
    CHECK(value_available(ev1, true, EEV_PULSE_CEILING)); // one-sided, so the ceiling itself passes
    CHECK(!value_available(ev1, true, EEV_PULSE_CEILING + 1.0));

    // Everything the ledger says nothing about is unaffected — including the OTHER conv-114 rows
    // and a legitimate 0 °C reading, which is the one thing a global "zero means unavailable" rule
    // would have destroyed (a real thermistor crosses zero every winter).
    const ValueDef r1t{0x61, 8, 105, 2, 1, "Inlet water temp.(R4T)"};
    CHECK(availability_policy(r1t) == AvailabilityPolicy::Always);
    CHECK(row_publishable(r1t) && value_available(r1t, true, 0.0));

    // ── Page-level absence: 0xA1, the all-zero reply ─────────────────────────────────────────────
    // The verdict is on the PAGE, so no row on it carries a policy of its own — asserted here,
    // because that is exactly what changed when the four row entries became one page entry.
    const ValueDef tdis{0xA1, 5, 114, 2, 1, "Target Discharge Temp."};
    const ValueDef twin{0xA1, 0, 119, 2, 1, "(Raw data)Water heat exchanger inlet temp."};
    const ValueDef twout{0xA1, 2, 119, 2, 1, "(Raw data)Water heat exchanger outlet temp."};
    const ValueDef tport{0xA1, 7, 114, 2, 1, "Target port temperature"};
    const uint8_t  absent_a1[16]    = {};
    const uint8_t  short_a1[9]      = {};
    uint8_t        populated_a1[16] = {};
    populated_a1[9] =
        0x01; // Altherma-LT setting bit: page exists, even if this row is exactly 0 °C
    CHECK(page_absence_rule(0xA1) != nullptr);
    CHECK(page_absence_rule(0xA1)->signature == PageAbsence::AllBytesZero);
    CHECK(page_absent(0xA1, absent_a1, sizeof(absent_a1)));
    CHECK(!page_absent(0xA1, populated_a1, sizeof(populated_a1)));
    CHECK(!page_absent(0xA1, short_a1, sizeof(short_a1))); // too short to reach the flag byte
    CHECK(!page_absent(0xA1, nullptr, 0));                 // no reply is not an absence
    for (const ValueDef* d : {&twin, &twout, &tdis, &tport}) {
        CHECK(availability_policy(*d) == AvailabilityPolicy::Always); // the PAGE carries it now
        CHECK(row_publishable(*d));
        CHECK(value_available(*d, true, 0.0)); // no page context: never invent an absence verdict
        CHECK(value_available(*d, true, 0.0, short_a1, sizeof(short_a1)));
        CHECK(!value_available(*d, true, 0.0, absent_a1, sizeof(absent_a1)));
        CHECK(!value_available(*d, true, 35.0, absent_a1, sizeof(absent_a1)));
        CHECK(value_available(*d, true, 0.0, populated_a1, sizeof(populated_a1)));
        CHECK(value_available(*d, true, 35.0, populated_a1, sizeof(populated_a1)));
    }

    // ── Page-level absence: 0xA0, the unidentified unit ──────────────────────────────────────────
    // BYTE LEVEL, because the whole finding is which bytes the absent unit answers with. This is
    // the reference installation's reply verbatim (#224): every field zero except the O/U MPU id,
    // which reads 0xFFFF, and the 0x800C at offset 2 whose low byte never leaves 0x00/0x80 and
    // which is therefore not a ×0.1 temperature at all.
    const uint8_t absent_a0[16] = {0x00, 0x00, 0x80, 0x0C, 0x00, 0x00, 0x00, 0x00,
                                   0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00};
    CHECK(page_absence_rule(0xA0) != nullptr);
    CHECK(page_absence_rule(0xA0)->signature == PageAbsence::UnidentifiedUnit);
    CHECK(page_absent(0xA0, absent_a0, sizeof(absent_a0)));
    CHECK(!page_absent(0xA0, absent_a0, A0_PRESENCE_BYTES - 1)); // short of the flag words
    CHECK(page_absent(0xA0, absent_a0, A0_PRESENCE_BYTES));      // exactly reaching them is enough

    // It fails OPEN on anything that is not the full signature. An MPU that identifies itself is a
    // fitted unit however quiet it is; a unit that asserts ANY output is fitted however it
    // identifies itself. Both halves are required, so either one alone publishes the whole page.
    uint8_t a0[16];
    for (size_t i = 0; i < sizeof(a0); i++) a0[i] = absent_a0[i];
    a0[10] = 0x01; // an MPU id — a second unit answers
    CHECK(!page_absent(0xA0, a0, sizeof(a0)));
    a0[10] = 0xFF;
    a0[11] = 0x02; // the other id byte, same conclusion
    CHECK(!page_absent(0xA0, a0, sizeof(a0)));
    a0[11] = 0xFF;
    a0[12] = 0x01; // 52C output asserted
    CHECK(!page_absent(0xA0, a0, sizeof(a0)));
    a0[12] = 0x00;
    a0[13] = 0x08; // discharge-temp-drop flag
    CHECK(!page_absent(0xA0, a0, sizeof(a0)));
    a0[13] = 0x00;
    CHECK(page_absent(0xA0, a0, sizeof(a0))); // back to the absence signature

    // A populated page: an MPU answers, so nothing on it is withheld.
    uint8_t a0_live[16];
    for (size_t i = 0; i < sizeof(a0_live); i++) a0_live[i] = absent_a0[i];
    a0_live[10] = 0x21;
    CHECK(!page_absent(0xA0, a0_live, sizeof(a0_live)));

    // Every row on the page goes, whatever it decoded to and whatever else it carries. The two that
    // matter are the ones a row-level ledger could not have reached: the expansion valve, which
    // already carries the conv-151 pulse ceiling, and the 0xA0/2 field that decodes to an ordinary
    // 192 °C rather than to a zero.
    const ValueDef a0_suction{0xA0, 0, 119, 2, 1, "Suction temp"};
    const ValueDef a0_hx{0xA0, 2, 119, 2, 1, "Outdoor heat exchanger temp."};
    const ValueDef a0_liquid{0xA0, 4, 119, 2, 1, "Liquid pipe temp."};
    const ValueDef a0_press{0xA0, 6, 119, 2, 2, "Pressure"};
    const ValueDef a0_eev{0xA0, 8, 151, 2, -1, "Expansion valve 3 (pls) [OU-II]"};
    const ValueDef a0_port{0xA0, 14, 105, 2, 1, "Compressor port temperature"};
    for (const ValueDef* d : {&a0_suction, &a0_hx, &a0_liquid, &a0_press, &a0_eev, &a0_port}) {
        CHECK(row_publishable(*d));            // the ENTITY stays: a second O/U is real
        CHECK(value_available(*d, true, 0.0)); // no page context: no absence invented
        CHECK(!value_available(*d, true, 0.0, absent_a0, sizeof(absent_a0)));
        CHECK(!value_available(*d, true, 192.0, absent_a0, sizeof(absent_a0)));
        CHECK(!value_available(*d, false, 0.0, absent_a0, sizeof(absent_a0))); // text rows too
        CHECK(value_available(*d, true, 35.0, a0_live, sizeof(a0_live))); // populated: publishes
    }
    // The valve keeps its OWN verdict on a populated page — the page rule composes with the ledger
    // rather than replacing it, so 0xFFF8 is still not a position when a second unit IS fitted.
    CHECK(availability_policy(a0_eev) == AvailabilityPolicy::AboveRangeIsAbsent);
    CHECK(value_available(a0_eev, true, 450.0, a0_live, sizeof(a0_live)));
    CHECK(!value_available(a0_eev, true, 65528.0, a0_live, sizeof(a0_live)));

    // NO OTHER PAGE MAY ACQUIRE ONE. The hydronic pages carry every reading #209 found correct, and
    // an absence signature on one of them would withhold a whole page of good measurements at once.
    for (int reg = 0; reg <= 0xFF; reg++) {
        const bool has = page_absence_rule(static_cast<uint8_t>(reg)) != nullptr;
        CHECK(has == (reg == 0xA0 || reg == 0xA1));
    }

    // The generated detect-only flag composes with the ledger rather than competing with it: both
    // reach the same predicate, so hp_poll and mqtt_ha's discovery cannot see different row sets.
    ValueDef hybrid{0x64, 2, 316, 1, -1, "Hybrid Op. Mode", true};
    CHECK(!row_publishable(hybrid));
    CHECK(availability_policy(hybrid) == AvailabilityPolicy::Always); // orthogonal reasons

    // ── Against the real catalog
    // ──────────────────────────────────────────────────────────────────
    int profiles_total = 0, evap_rows = 0, cond_rows = 0, suppressed = 0, odd_label = 0;
    int eev_rows = 0, conv151_rows = 0, page_absence_rows = 0, ct_l3_rows = 0;
    int zero_rows = 0, fan1_rows = 0, fan2_rows = 0, cout_rows = 0, geo_shared_rows = 0;
    int liq_rows = 0, liq_brine_rows = 0;
    for (const auto& p : def::profiles) {
        profiles_total++;
        const auto view                = def::resolved(p);
        int        publishable_on_0x10 = 0;
        for (size_t i = 0; i < view.count(); i++) {
            const ValueDef&          d   = view[i];
            const AvailabilityPolicy pol = availability_policy(d);
            if (logic::effective_conv(d.reg, d.offset, d.conv) != d.conv) {
                suppressed++;
                evap_rows++;
                CHECK(d.reg == 0x10 && d.offset == 6 && d.conv == 114);
                CHECK(logic::adjudicated(d).conv == 109);
                // A quarantine must land on the quantity it was adjudicated for, on EVERY profile.
                // The structural key is what makes that true, and this is what proves it —
                // including the one place the catalog disagrees with ITSELF: altherma_lt_d7_e_bml
                // labels this exact register "Target Discharge Temp." while the other 43 and
                // docs/REGISTERS.md §5 call it "Target Evap. Temp.". Same page, same offset, same
                // converter, same width, same dataType — one family's source catalog simply spells
                // it differently, which is the argument for keying on the register rather than the
                // name in miniature. Under either reading the ×0.1 decode is impossible (a
                // discharge TARGET of 145-200 °C is no more real than an evaporating one), so the
                // adjudication covers both.
                if (logic::lwt_ci_contains(d.label, "target discharge"))
                    odd_label++;
                else
                    CHECK(logic::lwt_ci_contains(d.label, "target evap"));
            }
            if (pol == AvailabilityPolicy::ZeroMeansAbsent) {
                zero_rows++;
                // Every zero verdict lands on one of the four adjudicated quantities and NOTHING
                // else. The 0x21 three are label-keyed, so this also proves the key discriminates:
                // the geothermal rows sharing their coordinates are counted below and must never
                // appear here.
                if (d.reg == 0x10) {
                    CHECK(logic::lwt_ci_contains(d.label, "target cond"));
                    cond_rows++;
                } else if (d.reg == 0x21 && d.offset == 6) {
                    CHECK(logic::lwt_ci_contains(d.label, "fan1 fin"));
                    fan1_rows++;
                } else if (d.reg == 0x21 && d.offset == 8) {
                    CHECK(logic::lwt_ci_contains(d.label, "fan2 fin"));
                    fan2_rows++;
                } else if (d.reg == 0x21 && d.offset == 10) {
                    CHECK(logic::lwt_ci_contains(d.label, "compressor outlet"));
                    cout_rows++;
                } else
                    CHECK(false); // an unadjudicated coordinate acquired a zero verdict
                CHECK(row_publishable(d));
            }
            // THE OTHER DIRECTION, and the one the label key exists for. A brine or evaporating-
            // refrigerant row sits at exactly the coordinates the 0x21 rules use, and its real
            // reading is 0 °C in normal operation — it must reach the ledger and be told nothing.
            if (logic::lwt_ci_contains(d.label, "brine") ||
                logic::lwt_ci_contains(d.label, "refrig. temp. evap")) {
                if (d.reg == 0x21 && (d.offset == 6 || d.offset == 8 || d.offset == 10)) {
                    geo_shared_rows++;
                    CHECK(availability_rule(d) == nullptr);
                    CHECK(value_available(d, true, 0.0));
                }
            }
            // The 0x20 zero rows #224 lists, split by WHICH SIDE OF THE CIRCUIT they sit on — the
            // fact that decides whether the one available witness can say anything about them.
            // The outdoor coil (evaporator) and the suction pipe are LOW side and the witness is
            // HIGH side, so they stay unadjudicated: 0 °C is where they live for much of a heating
            // season and no high-side reading contradicts that.
            if (d.reg == 0x20 && (d.offset == 2 || d.offset == 6))
                CHECK(pol == AvailabilityPolicy::Always);
            // The liquid line IS the high side, so its zero is conditional on the witness. Both
            // directions, catalog-wide: every air-source spelling carries the rule, and the
            // geothermal brine row at the identical coordinate never does — a leaving brine
            // temperature really does sit at 0 °C.
            if (d.reg == 0x20 && d.offset == 10 && d.conv == 105) {
                if (logic::lwt_ci_contains(d.label, "brine")) {
                    liq_brine_rows++;
                    CHECK(availability_rule(d) == nullptr);
                    CHECK(pol == AvailabilityPolicy::Always);
                    CHECK(value_available(d, true, 0.0, nullptr, 0, SaturationWitness{true, 49.0}));
                } else {
                    liq_rows++;
                    CHECK(logic::lwt_ci_contains(d.label, "liquid"));
                    CHECK(pol == AvailabilityPolicy::ZeroAbsentAboveSaturation);
                    CHECK(availability_rule(d)->ceiling == LIQUID_LINE_SAT_CEILING);
                    CHECK(row_publishable(d)); // the row is real; only the refuted zero is withheld
                    // refuting witness withholds, agreeing witness and absent witness do not
                    CHECK(
                        !value_available(d, true, 0.0, nullptr, 0, SaturationWitness{true, 49.0}));
                    CHECK(value_available(d, true, 0.0, nullptr, 0, SaturationWitness{true, 5.0}));
                    CHECK(value_available(d, true, 0.0));
                }
            }
            // Nothing OUTSIDE that coordinate may acquire the conditional verdict — a rule whose
            // whole justification is "this row is on the high side" must not spread to rows nobody
            // established that for.
            if (pol == AvailabilityPolicy::ZeroAbsentAboveSaturation)
                CHECK(d.reg == 0x20 && d.offset == 10 && d.conv == 105);
            if (pol == AvailabilityPolicy::Bit7MeansAbsent) {
                ct_l3_rows++;
                CHECK(d.reg == 0x63 && d.offset == 16 && d.conv == 161);
                CHECK(row_publishable(d));
                uint8_t p63[17] = {};
                p63[16]         = 0x80;
                CHECK(!value_available(d, true, 64.0, p63, sizeof(p63)));
                p63[16] = 0x7f;
                CHECK(value_available(d, true, 63.5, p63, sizeof(p63)));
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
                CHECK((d.reg == 0x30 &&
                       (d.offset == 3 || d.offset == 5 || d.offset == 7 || d.offset == 9)) ||
                      (d.reg == 0xA0 && d.offset == 8));
                CHECK(row_publishable(d)); // the valve is real — only the bad integer is withheld
            }
            // Every row on a page that has an absence rule is covered by it, and covered whatever
            // else it carries — this is the property the row-level shape could not give, and the
            // reason the count is taken from the CATALOG rather than from the ledger: a row the
            // generator adds to one of these pages tomorrow is inside it the day it appears.
            if (page_absence_rule(d.reg)) {
                page_absence_rows++;
                CHECK(d.reg == 0xA0 || d.reg == 0xA1);
                CHECK(row_publishable(d)); // entity stays; only the absent-page reply is withheld
                CHECK(!value_available(d, true, 0.0, absent_a1, sizeof(absent_a1)) ||
                      d.reg != 0xA1);
                CHECK(!value_available(d, true, 0.0, absent_a0, sizeof(absent_a0)) ||
                      d.reg != 0xA0);
            }
            // NO CORE HYDRONIC ROW MAY BE TOUCHED. The audit in #209 is explicit that the hydronic
            // decode is excellent and must not be collaterally damaged: leaving/return water, tank,
            // flow, pressure and the setpoints all live on 0x60-0x62, and not one of them may fall
            // under a rule.
            if (d.reg >= 0x60 && d.reg <= 0x62) CHECK(pol == AvailabilityPolicy::Always);
            if (d.reg == 0x10 && row_publishable(d)) publishable_on_0x10++;
        }
        // Page 0x10 must still be QUERIED on every profile after the quarantine — the error class,
        // the error code and the protection words live there, and so does the raw dump that is
        // meant to settle #194. A page whose rows are all unpublishable is not read at all
        // (hp_poll).
        CHECK(publishable_on_0x10 > 0);
    }
    // The exact reach of the two rules, pinned. 44 of the 45 profiles carry both rows; the one that
    // does not is `altherma3_r_erga`, whose page-0x10 row set stops at offset 5 — it has no target
    // temperatures at all, so there is nothing to adjudicate there. Hardcoded on purpose: a changed
    // count means a profile was added or the generator's page-0x10 input moved, and either is a
    // reason to re-read the adjudication rather than let it silently re-scope itself.
    CHECK(profiles_total == 45);
    // The liquid line's reach, hardcoded for the same reason as the two above: a changed count
    // means the generator emitted a FOURTH air-source spelling (which would otherwise escape the
    // rule silently) or moved a geothermal row into it (which would withhold a real 0 °C brine
    // reading). Either is a reason to re-read the adjudication, not to let it re-scope itself.
    CHECK(liq_rows == 39); // 29 "Liquid pipe temp.(R6T)" + 6 "Liquid temperature(R3T)" + 4 bare
    CHECK(liq_brine_rows == 4); // "Leaving brine temp.(R6T)" — reaches the ledger, told nothing
    // HOW FAR THE RULE CAN ACTUALLY REACH, which is much narrower than the 39 rows that carry it
    // and must be stated rather than left implied. The witness row (0x62/15 conv 405) exists on
    // only 8 profiles, so on the other 31 liquid-line profiles the rule is ARMED BUT PERMANENTLY
    // SILENT and every zero publishes. That is the intended fail-open, not a gap to close by
    // loosening the witness — and the reference unit (altherma_ebla_edla_d_series_4_8kw_monobloc)
    // is one of the 8, which is what makes the rule verifiable on real hardware at all. Every
    // witness-carrying profile also carries the liquid line, so there is no profile whose witness
    // judges nothing.
    int witness_profiles = 0, witness_and_liquid = 0;
    for (const auto& p : def::profiles) {
        if (!profile_has_saturation_witness(p.values, p.count)) continue;
        witness_profiles++;
        for (size_t i = 0; i < p.count; i++)
            if (p.values[i].reg == 0x20 && p.values[i].offset == 10 && p.values[i].conv == 105) {
                witness_and_liquid++;
                break;
            }
    }
    CHECK(witness_profiles == 8);
    CHECK(witness_and_liquid == witness_profiles);
    CHECK(profile_has_saturation_witness(
        def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc").values,
        def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc").count));
    CHECK(evap_rows == 44 && cond_rows == 44);
    CHECK(evap_rows == suppressed);
    CHECK(odd_label == 1); // exactly one family spells the re-decoded register differently
    // conv 151 has exactly ONE use in the catalog, which is the argument for covering all five of
    // its coordinates from a capture on one of them. If this count moves, the generator has started
    // emitting conv 151 somewhere new and the "it is always an expansion valve" premise needs
    // re-reading before the ceiling is allowed to follow it there.
    CHECK(conv151_rows == 113);
    CHECK(eev_rows == conv151_rows);
    CHECK(ct_l3_rows == 22);
    // The reach of the two page rules, pinned as one number over the real catalog. 21 profiles
    // carry the two raw Water-HX rows and 19 of those carry both 0xA1 target rows (80 rows), while
    // 19 carry all six 0xA0 rows (114) — 194 in total. It moves when a profile is added or when the
    // generator starts emitting a row on either page, and either is a reason to re-read the
    // adjudication rather than let it silently re-scope itself.
    CHECK(page_absence_rows == 194);
    // The #224 zero verdicts, pinned per quantity so a moved count names WHICH one moved. 19/19/21
    // are the air-source profiles carrying each row; 44 is Target Cond. Temp. as before, and the
    // sum is every zero verdict in the catalog.
    CHECK(fan1_rows == 19 && fan2_rows == 19 && cout_rows == 21);
    CHECK(zero_rows == cond_rows + fan1_rows + fan2_rows + cout_rows);
    // And the direction that keeps a geothermal unit whole: 10 rows share those three coordinates
    // with a brine or evaporating-refrigerant quantity, and not one of them is adjudicated. If this
    // count moves, the catalog has put another quantity behind a zero rule and the label key needs
    // re-reading before the rule is allowed to follow it there.
    CHECK(geo_shared_rows == 10);
}

// ── Numeric fault state beside the textual code (logic/fault_state.hpp) — #209 defect 4 ──────────
static void test_fault_state() {
    // The inverse of conv 203, taken from the same ERR_TYPE table it renders from.
    CHECK(fault_class_from_text("Normal") == FaultClass::Normal);
    CHECK(fault_class_from_text("Error") == FaultClass::Error);
    CHECK(fault_class_from_text("Warning") == FaultClass::Warning);
    CHECK(fault_class_from_text("Caution") == FaultClass::Caution);
    CHECK(fault_class_from_text("?") == FaultClass::Unknown); // conv 203's out-of-range render
    CHECK(fault_class_from_text("") == FaultClass::Unknown);
    CHECK(fault_class_from_text(nullptr) == FaultClass::Unknown);
    CHECK(fault_class_from_text("Norma") == FaultClass::Unknown);   // a prefix is not a match
    CHECK(fault_class_from_text("Normal2") == FaultClass::Unknown); // nor is an extension

    // Round-trip against the real converter: whatever conv 203 emits for a byte, this reads back.
    const ValueDef etype{0x10, 4, 203, 1, -1, "Error type"};
    for (int b = 0; b < 4; b++) {
        const uint8_t raw = static_cast<uint8_t>(b);
        CHECK(fault_class_from_text(convert(etype, &raw).text) == static_cast<FaultClass>(b));
    }
    const uint8_t bogus = 9;
    CHECK(fault_class_from_text(convert(etype, &bogus).text) == FaultClass::Unknown);

    // The flags. Error is a stop; Warning and Caution are both "running and complaining".
    CHECK(!fault_error_active(FaultClass::Normal) && !fault_warning_active(FaultClass::Normal));
    CHECK(fault_error_active(FaultClass::Error) && !fault_warning_active(FaultClass::Error));
    CHECK(!fault_error_active(FaultClass::Warning) && fault_warning_active(FaultClass::Warning));
    CHECK(!fault_error_active(FaultClass::Caution) && fault_warning_active(FaultClass::Caution));

    // An unreadable class publishes NEITHER flag. Reporting 0/0 would assert "no fault" on a byte
    // nobody could decode — the one direction a fault flag must never fail in.
    CHECK(!fault_companions_publishable(FaultClass::Unknown));
    CHECK(fault_companions_publishable(FaultClass::Normal));

    // The wire form is always "1"/"0" — a permanently numeric field, which is the entire point.
    CHECK(FAULT_COMPANION_COUNT == 2);
    CHECK(std::string(fault_companion_state(0, FaultClass::Error)) == "1");
    CHECK(std::string(fault_companion_state(1, FaultClass::Error)) == "0");
    CHECK(std::string(fault_companion_state(0, FaultClass::Normal)) == "0");
    CHECK(std::string(fault_companion_state(1, FaultClass::Caution)) == "1");

    // ── The scenario #209 asks to be replayed: 00 -> U4 -> 00
    // ───────────────────────────────────── The textual code keeps its type through the whole
    // sequence (an alphanumeric code cannot become a number), and the numeric flag moves 0 -> 1 ->
    // 0 beside it, so an alert on the flag fires where an alert on the code could not.
    const ValueDef ecode{0x10, 5, 204, 1, -1, "Error Code"};
    const uint8_t  no_err = 0x00, u4 = 0x94, seven_h = 0xCB; // ERR_C1/ERR_C2 nibble pairs
    CHECK(std::string(convert(ecode, &no_err).text) == "0"); // conv 204 trims the leading space
    CHECK(std::string(convert(ecode, &u4).text) == "U4");
    CHECK(std::string(convert(ecode, &seven_h).text) == "7H");
    const uint8_t cls_normal = 0, cls_error = 1;
    std::string   seq;
    for (uint8_t c : {cls_normal, cls_error, cls_normal}) {
        const FaultClass          fc   = fault_class_from_text(convert(etype, &c).text);
        std::vector<GroupedValue> vals = {
            {"outdoor_state", "error_code", "U4", PublishedKind::Text},
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
    CHECK(companion_discovery_topic("homeassistant", "daikin_test", "hydronic", "warning_active") ==
          "homeassistant/binary_sensor/daikin_test/hydronic_warning_active/config");
    const std::string ccfg =
        companion_discovery_config("daikin_test", "daikin_board", "daikin/x10a", "daikin/status",
                                   "outdoor_state", FAULT_COMPANIONS[0]);
    CHECK(ccfg.find("\"name\":\"Outdoor State Error Active\"") != std::string::npos);
    CHECK(ccfg.find("\"uniq_id\":\"daikin_test_outdoor_state_error_active\"") != std::string::npos);
    CHECK(ccfg.find("\"val_tpl\":\"{{ value_json['outdoor_state']['error_active'] }}\"") !=
          std::string::npos);
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
        CHECK(classes >= 1); // no profile is left without a numeric fault state
    }
}

// ── The run-time raw-page capture cadence (logic/raw_capture.hpp) — #194's decisive experiment
// ────
static void test_raw_capture() {
    logic::RawCaptureState s;
    const int64_t          sec = 1000000;

    // Nothing while the compressor is stopped: that is the state hp_detect.cpp already dumps, and
    // the state in which the value under investigation is NOT wrong.
    CHECK(!logic::raw_capture_due(s, false, 0));
    CHECK(!logic::raw_capture_due(s, false, 100 * sec));
    CHECK(s.emitted == 0);

    // The stopped -> running EDGE fires immediately; the next cycle does not.
    CHECK(logic::raw_capture_due(s, true, 200 * sec));
    CHECK(!logic::raw_capture_due(s, true, 201 * sec));
    CHECK(!logic::raw_capture_due(s, true, (200 + logic::RAW_CAPTURE_PERIOD_S - 1) * sec));
    // …and then once per period, so a long run yields a short SERIES. Two candidate scales that
    // both fit one sample may not fit a curve, which is the whole reason for more than one point.
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
    int                    fired = 0;
    for (int i = 0; i < 500; i++) {
        if (logic::raw_capture_due(b, false, i * 2000 * sec)) fired++;      // stop
        if (logic::raw_capture_due(b, true, (i * 2000 + 1) * sec)) fired++; // start -> edge
    }
    CHECK(fired == logic::RAW_CAPTURE_MAX);
    CHECK(b.emitted == logic::RAW_CAPTURE_MAX);
    // Once exhausted it stays exhausted for the rest of the boot, in both phases.
    CHECK(!logic::raw_capture_due(b, true, 9999999 * sec));
}

// ── MQTT may observe before X10A; outbound installation identity still needs proof ──────────────
static void test_mqtt_cleanup() {
    MqttCleanupScheduler cleanup;
    cleanup.begin_cycle();
    CHECK(cleanup.reconstruct_for_client(1));
    CHECK(cleanup.suppress(MqttCleanupSource::Weather));
    CHECK(cleanup.suppress(MqttCleanupSource::Modbus));
    CHECK(cleanup.suppress(MqttCleanupSource::Env3));

    // The first source queues exactly one state tombstone. Without its PUBACK, later one-second
    // cycles neither repeat it nor expose any of the other requested sources to ordinary publish.
    MqttCleanupAction action = cleanup.next_action(true, false);
    CHECK(action.source == MqttCleanupSource::Weather);
    CHECK(action.topic == MqttCleanupTopic::State && action.index == 0);
    CHECK(cleanup.publish_queued(1, 101));
    cleanup.begin_cycle();
    CHECK(!cleanup.next_action(true, false));
    CHECK(cleanup.in_flight() && cleanup.in_flight_id() == 101);
    CHECK(!cleanup.acknowledge({1, 99}));
    CHECK(!cleanup.acknowledge({2, 101}));
    CHECK(cleanup.suppress(MqttCleanupSource::Weather));
    CHECK(cleanup.suppress(MqttCleanupSource::Modbus));
    CHECK(cleanup.suppress(MqttCleanupSource::Env3));

    CHECK(cleanup.acknowledge({1, 101}));
    CHECK(!cleanup.take_completion());
    action = cleanup.next_action(true, false);
    CHECK(action.source == MqttCleanupSource::Weather);
    CHECK(action.topic == MqttCleanupTopic::RetiredDiscovery && action.index == 0);

    // A second request arriving during the active run is remembered. Finish the four discovery
    // tombstones; the source remains suppressed in the completion cycle and immediately owns a
    // second full run rather than losing the concurrent request.
    cleanup.request(MqttCleanupSource::Weather);
    for (int i = 0; i < MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT; ++i) {
        CHECK(action.index == i);
        CHECK(cleanup.publish_queued(1, 102 + i));
        CHECK(cleanup.acknowledge({1, 102 + i}));
        if (i + 1 < MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT) {
            CHECK(!cleanup.take_completion());
            action = cleanup.next_action(true, false);
            CHECK(action.source == MqttCleanupSource::Weather);
            CHECK(action.topic == MqttCleanupTopic::RetiredDiscovery);
        }
    }
    const MqttCleanupCompletion weather_done = cleanup.take_completion();
    CHECK(weather_done.source == MqttCleanupSource::Weather);
    CHECK(cleanup.suppress(MqttCleanupSource::Weather));
    action = cleanup.next_action(true, false);
    CHECK(action.source == MqttCleanupSource::Weather && action.topic == MqttCleanupTopic::State);

    // Same-client reconnect is a no-op: esp-mqtt owns the queued packet and will retransmit it.
    CHECK(cleanup.publish_queued(1, 200));
    CHECK(!cleanup.reconstruct_for_client(1));
    CHECK(cleanup.in_flight_id() == 200);
    CHECK(!cleanup.next_action(true, false));

    // Client replacement invalidates the old id and restarts all idempotent source sequences. A
    // late event from the destroyed client epoch cannot advance the replacement's first step.
    cleanup.invalidate_client();
    CHECK(!cleanup.in_flight());
    CHECK(cleanup.reconstruct_for_client(2));
    action = cleanup.next_action(true, true);
    CHECK(action.source == MqttCleanupSource::Weather && action.topic == MqttCleanupTopic::State);
    CHECK(cleanup.publish_queued(2, 300));
    CHECK(!cleanup.acknowledge({1, 200}));
    CHECK(cleanup.in_flight_id() == 300);

    // ESP-MQTT expiry is explicit evidence that the queued item is gone. A foreign deletion is
    // ignored; the exact deletion releases only this step and selects the same action for retry.
    CHECK(!cleanup.retry_deleted({1, 300, MqttCleanupDeliveryOutcome::Deleted}));
    CHECK(!cleanup.retry_deleted({2, 301, MqttCleanupDeliveryOutcome::Deleted}));
    CHECK(cleanup.retry_deleted({2, 300, MqttCleanupDeliveryOutcome::Deleted}));
    action = cleanup.next_action(true, true);
    CHECK(action.source == MqttCleanupSource::Weather && action.topic == MqttCleanupTopic::State);
    CHECK(cleanup.publish_queued(2, 301));

    // A deliberate transport stop clears the outbox without a DELETED event. Preserve the active
    // step, release its lost id only after the producer has stopped, and retry after same-handle
    // resume without restarting the already-completed prefix.
    CHECK(cleanup.outbox_cleared_after_transport_stop());
    CHECK(!cleanup.in_flight());
    CHECK(!cleanup.outbox_cleared_after_transport_stop());
    action = cleanup.next_action(true, true);
    CHECK(action.source == MqttCleanupSource::Weather && action.topic == MqttCleanupTopic::State);
    CHECK(cleanup.publish_queued(2, 302));

    // The fixed SPSC evidence ring preserves an ACK that arrives before mqtt_task stores the return
    // id. It is bounded and reports overflow instead of overwriting an unconsumed matching ACK.
    MqttCleanupEvidenceQueue<3> evidence;
    CHECK(evidence.push({2, 302, MqttCleanupDeliveryOutcome::Published}));
    CHECK(evidence.push({2, 303, MqttCleanupDeliveryOutcome::Deleted}));
    CHECK(evidence.push({2, 304, MqttCleanupDeliveryOutcome::Published}));
    CHECK(!evidence.push({2, 305, MqttCleanupDeliveryOutcome::Published}));
    CHECK(evidence.dropped() == 1);
    MqttCleanupDeliveryEvidence delivery;
    CHECK(evidence.pop(delivery) && delivery.client_epoch == 2 && delivery.msg_id == 302);
    CHECK(cleanup.acknowledge(delivery));
    CHECK(evidence.pop(delivery) && delivery.msg_id == 303 &&
          delivery.outcome == MqttCleanupDeliveryOutcome::Deleted);
    evidence.clear_after_producer_stop();
    CHECK(!evidence.pop(delivery));

    // ENV III captures its target state when its run starts: enabled deletes state only; disabled
    // deletes state plus the exact three discovery configs.
    MqttCleanupScheduler env3;
    env3.begin_cycle();
    env3.request(MqttCleanupSource::Env3);
    action = env3.next_action(true, true);
    CHECK(!action); // no client epoch means no broker evidence domain
    CHECK(env3.publish_queued(0, 1) == false);
    CHECK(env3.reconstruct_for_client(9));
    // Reconstruction also requests Weather/HomeHub; use a fresh scheduler for the isolated shape.
    MqttCleanupScheduler env3_only;
    env3_only.begin_cycle();
    CHECK(env3_only.reconstruct_for_client(9));
    // Complete reconstructed Weather and HomeHub mechanically, then inspect enabled ENV III.
    int msg_id = 1;
    for (int i = 0; i < 5 + 28; ++i) {
        action = env3_only.next_action(true, true);
        CHECK(action);
        CHECK(env3_only.publish_queued(9, msg_id));
        CHECK(env3_only.acknowledge({9, msg_id++}));
        (void)env3_only.take_completion();
    }
    action = env3_only.next_action(true, true);
    CHECK(action.source == MqttCleanupSource::Env3 && action.topic == MqttCleanupTopic::State);
    CHECK(env3_only.publish_queued(9, msg_id));
    CHECK(env3_only.acknowledge({9, msg_id}));
    const MqttCleanupCompletion env3_enabled_done = env3_only.take_completion();
    CHECK(env3_enabled_done.source == MqttCleanupSource::Env3 && env3_enabled_done.env3_enabled);
    CHECK(env3_only.suppress(MqttCleanupSource::Env3)); // completion cycle stays suppressed

    CHECK(MQTT_SOURCE_CLEANUP_MAX_STEPS == 37);
}

static void test_mqtt_publish_gate() {
    // Cleanup runs before ordinary publication in one MQTT cycle. A disabled target that was just
    // tombstoned must stay idle even while its worker still reports enabled; an A-to-B replacement
    // remains publishable and can expose `{}` until the new source answers.
    CHECK(retained_source_action(false, true) == RetainedSourceAction::Idle);
    CHECK(retained_source_action(false, false) == RetainedSourceAction::DeleteRetained);
    CHECK(retained_source_action(true, true) == RetainedSourceAction::PublishCurrent);
    CHECK(retained_source_action(true, false) == RetainedSourceAction::PublishCurrent);

    MqttPublishGateState state = MqttPublishGateState::SubscriberOnly;

    // Broker configuration alone proves no installation ownership. The no-LWT client may be
    // connected for subscriptions, but the gate authorizes no application publication.
    auto d = mqtt_publish_gate_step(state, false, -1, false);
    CHECK(d.next == MqttPublishGateState::SubscriberOnly);
    CHECK(!d.promote_publisher && !d.publish_cycle && !d.publish_offline && !d.resumed);
    d = mqtt_publish_gate_step(state, false, -1, true);
    CHECK(d.next == MqttPublishGateState::SubscriberOnly);
    CHECK(!d.promote_publisher && !d.publish_cycle && !d.publish_offline && !d.resumed);

    // The first valid bus cycle authorizes exactly the replacement by an LWT-bearing client.
    // Publication still waits for that new client's MQTT_EVENT_CONNECTED.
    d = mqtt_publish_gate_step(state, true, 0, true);
    CHECK(d.next == MqttPublishGateState::Active);
    CHECK(d.promote_publisher && !d.publish_cycle && !d.publish_offline && !d.resumed);
    state = d.next;
    d     = mqtt_publish_gate_step(state, true, 0, true);
    CHECK(d.publish_cycle && !d.promote_publisher && !d.publish_offline);

    // One missed whole sweep is a known property of this serial source, not an installation outage.
    // Keep publishing auxiliary/diagnostic data during the grace; the runtime separately refuses to
    // publish the empty current-cycle X10A cache. The boundary is elapsed source age, not MQTT
    // ticks.
    d = mqtt_publish_gate_step(state, false, 1, true);
    CHECK(d.next == MqttPublishGateState::Active);
    CHECK(d.publish_cycle && !d.publish_offline && !d.resumed);
    d = mqtt_publish_gate_step(state, false, MQTT_X10A_OFFLINE_GRACE_S - 1, true);
    CHECK(d.next == MqttPublishGateState::Active);
    CHECK(d.publish_cycle && !d.publish_offline && !d.resumed);

    // A sustained loss gets one explicit offline marker at the exact grace boundary, then silence.
    d = mqtt_publish_gate_step(state, false, MQTT_X10A_OFFLINE_GRACE_S, true);
    CHECK(d.next == MqttPublishGateState::Paused);
    CHECK(d.publish_offline && !d.publish_cycle && !d.promote_publisher);
    state = d.next;
    d     = mqtt_publish_gate_step(state, false, MQTT_X10A_OFFLINE_GRACE_S + 1, true);
    CHECK(d.next == MqttPublishGateState::Paused);
    CHECK(!d.publish_offline && !d.publish_cycle && !d.resumed);

    // Recovery on the existing broker session asks the runtime for an online + fresh state seed;
    // a recovery while the broker is down still changes state but cannot publish prematurely.
    d = mqtt_publish_gate_step(state, true, 0, true);
    CHECK(d.next == MqttPublishGateState::Active);
    CHECK(d.resumed && d.publish_cycle && !d.publish_offline);
    d = mqtt_publish_gate_step(state, true, 0, false);
    CHECK(d.resumed && !d.publish_cycle && !d.publish_offline);

    // The MQTT task can start just after a good sweep and observe the following transient miss.
    // last_ok_s still proves X10A ownership during this boot, while -1 never does.
    state = MqttPublishGateState::SubscriberOnly;
    d     = mqtt_publish_gate_step(state, false, 1, true);
    CHECK(d.next == MqttPublishGateState::Active && d.promote_publisher);
    CHECK(!mqtt_x10a_available(false, -1));
    CHECK(mqtt_x10a_available(true, -1));
    CHECK(mqtt_x10a_available(false, MQTT_X10A_OFFLINE_GRACE_S - 1));
    CHECK(!mqtt_x10a_available(false, MQTT_X10A_OFFLINE_GRACE_S));
}

static void test_http_deadline() {
    using Tick = uint32_t;
    // Volatile inputs keep these calls in gcov rather than letting the compiler fold every
    // constexpr branch away. The function remains constexpr for firmware callers with compile-time
    // values.
    volatile Tick runtime_start    = 100;
    volatile Tick runtime_before   = 129;
    volatile Tick runtime_at       = 130;
    volatile Tick runtime_duration = 30;
    CHECK(http_deadline_remaining_ticks<Tick>(runtime_start, runtime_start, runtime_duration) ==
          30);
    CHECK(http_deadline_remaining_ticks<Tick>(runtime_start, runtime_before, runtime_duration) ==
          1);
    CHECK(http_deadline_remaining_ticks<Tick>(runtime_start, runtime_at, runtime_duration) == 0);
    CHECK(!http_deadline_reached_at<Tick>(runtime_start, runtime_before, runtime_duration));
    CHECK(http_deadline_reached_at<Tick>(runtime_start, runtime_at, runtime_duration));
    CHECK(http_deadline_reached_at<Tick>(runtime_start, runtime_start, Tick{0}));

    // FreeRTOS ticks are unsigned: one wrap between start and observation retains the exact
    // elapsed duration instead of turning the watchdog into a fresh deadline.
    volatile Tick start_before_wrap = std::numeric_limits<Tick>::max() - 9;
    volatile Tick after_wrap_before = 5;
    volatile Tick after_wrap_at     = 10;
    volatile Tick wrap_duration     = 20;
    CHECK(http_deadline_remaining_ticks<Tick>(start_before_wrap, after_wrap_before,
                                              wrap_duration) == 5);
    CHECK(http_deadline_remaining_ticks<Tick>(start_before_wrap, after_wrap_at, wrap_duration) ==
          0);
    volatile uint64_t remaining_ticks = 5;
    volatile uint64_t tick_period_ms  = 10;
    CHECK(http_deadline_ticks_to_us(remaining_ticks, tick_period_ms) == UINT64_C(50000));
}

int main() {
    test_http_cache();
    test_crc();
    test_hp_query_log_policy();
    test_registers();
    test_convert();
    test_query_flag();
    test_redact();
    test_config_store();
    test_config_blob_strings_fit();
    test_env3();
    test_reference_temperature_config();
    test_circulation_source();
    test_heating_curve_diagnosis();
    test_weather_forecast_contract();
    test_mcp();
    test_net_link();
    test_http_surface();
    test_http_request_policy();
    test_lwt_select();
    test_ou_stale();
    test_cop_scope();
    test_conv_override();
    test_label_override();
    test_availability();
    test_fault_state();
    test_raw_capture();
    test_mqtt_cleanup();
    test_mqtt_publish_gate();
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
    test_binary_semantics();
    test_refrigerant_pressure_catalog();
    test_demand_flag_catalog();
    test_bsh_flag_catalog();
    test_registry();
    test_detect();
    test_json();
    test_mqtt_group();
    test_x10a_snapshot_align();
    test_mqtt_base();
    test_mqtt_uri();
    test_modbus();
    test_modbus_plan();
    test_modbus_snapshot();
    test_homehub();
    test_homehub_map();
    test_ota_quiesce();
    test_ota_headroom();
    test_weather_fetch_headroom();
    test_http_values_wait();
    test_http_deadline();
    test_ota_transport();
    test_heartbeat();
    test_crashinfo();
    test_bootlog();
    test_syslog_policy();
    test_timestamp();
    test_hexdump();
    test_hp_probe();
    test_link_watch();
    test_wifi_rollback();
    test_reset_reason();
    test_boot_guard();
    test_heap_watchdog();
    test_health_gate();
    test_captive();
    test_http_body();
    test_uart_plan();
    test_detect_backoff();
    test_version_cmp();
    test_ota_manifest();
    test_ota_changelog_range();
    test_ota_channel();
    test_ota_hil_feed();
    test_ui_lang();
    test_profile_view();
    test_metric_identity();
    test_tie_break_identity();
    test_tie_break_order_independence();
    test_tie_break_reach();
    test_entity_identity();
    test_feature_gate();
    test_refrigerant_service();
    test_state_dwell();
    test_checkup_persist();
    test_history_persist();
    if (g_failures == 0) {
        std::printf("all logic tests passed\n");
        return 0;
    }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
