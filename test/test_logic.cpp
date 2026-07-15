// Host logic tests for the IDF-free pure headers in main/logic/. One translation unit; run via
// scripts/run-mock-tests.sh (cmake+ctest, or a direct g++/clang++ compile). CI's logic-test job
// gates the firmware build on this. Add a CHECK here whenever you touch a converter / CRC / the
// config model / a discovery payload — the riskiest, silently-wrong parts of the port.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <initializer_list>
#include <string>

#include "logic/board_pins.hpp"
#include "logic/config_model.hpp"
#include "logic/convert.hpp"
#include "logic/crashinfo.hpp"
#include "logic/crc.hpp"
#include "logic/detect.hpp"
#include "logic/discovery.hpp"
#include "logic/health_gate.hpp"
#include "logic/heartbeat.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/registers.hpp"
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

    // conv 802 = refrigerant type (encoded by the converter id; reads no bytes).
    ValueDef rf{0x00, 0, 802, 0, -1, "rf"};
    CHECK(std::string(convert(rf, c).text) == "R32");

    // conv 214/215 = raw EEPROM identification byte (no name table -> exposed as the byte value).
    ValueDef ee{0x11, 0, 215, 1, -1, "ee"};
    const uint8_t e34[] = {0x34};
    CHECK(convert(ee, e34).ok && approx(convert(ee, e34).value, 52.0));   // 0x34 = 52

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

    // Target-aware GPIO range: the ESP32-S3 default 44/43 is valid on a 48-GPIO target but must be
    // rejected on an ESP32-C3 (max GPIO 21), where those pins physically don't exist.
    CHECK(validate(c, why, 48));
    CHECK(!validate(c, why, 21));

    CHECK(parse_protocol("S") == Protocol::S);
    CHECK(parse_protocol("I") == Protocol::I);
    CHECK(parse_protocol("") == Protocol::I);

    // /set_hp fingerprint rule: a partial live update (no "profile" key) never clears the cached
    // detection, whatever the stored profile is; only an explicit "auto" does; a manual pin doesn't.
    CHECK(!set_hp_clears_fingerprint(false, "auto"));            // wiring-only patch (no "profile")
    CHECK(!set_hp_clears_fingerprint(false, "altherma_gshp"));   // partial update on a pinned model
    CHECK(set_hp_clears_fingerprint(true, "auto"));             // explicit re-detect / wiring Save
    CHECK(!set_hp_clears_fingerprint(true, "altherma_gshp"));    // manual pin keeps the fingerprint
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
    CHECK(HEARTBEAT_SENSOR_COUNT == 13);
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
    // Reference board (Seeed XIAO ESP32-S3): exactly the broken-out pads, with the X10A defaults
    // present and the not-broken-out pins (16/17, 47/48) absent — the whole point of the dropdown.
    BoardPins s3 = board_pins("esp32s3");
    CHECK(s3.count == 11);
    CHECK(has(s3, 43) && has(s3, 44));                              // D6/D7 — the X10A defaults
    CHECK(!has(s3, 16) && !has(s3, 17) && !has(s3, 47) && !has(s3, 48));
    // Supported target: non-empty and strictly ascending (⇒ sorted + de-duped) within GPIO range.
    for (const char* t : {"esp32s3"}) {
        BoardPins b = board_pins(t);
        CHECK(b.count > 0);
        for (int i = 0; i < b.count; i++) CHECK(gpio_in_range(b.pins[i]));
        for (int i = 1; i < b.count; i++) CHECK(b.pins[i] > b.pins[i - 1]);
    }
    // Unknown / null target falls back to the reference board (never an empty list).
    CHECK(board_pins("nope").count == s3.count);
    CHECK(board_pins(nullptr).count == s3.count);
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

int main() {
    test_crc();
    test_registers();
    test_convert();
    test_config_model();
    test_board_pins();
    test_discovery();
    test_registry();
    test_detect();
    test_mqtt_group();
    test_heartbeat();
    test_crashinfo();
    test_health_gate();
    if (g_failures == 0) { std::printf("all logic tests passed\n"); return 0; }
    std::printf("%d logic test(s) FAILED\n", g_failures);
    return 1;
}
