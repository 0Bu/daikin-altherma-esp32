// Protocol + model auto-detection (see hp_detect.hpp). One pass: sweep the protocol, probe pages,
// read capacity + EEPROM, narrow to candidate profiles. All decisions are in logic/detect.hpp.
#include "hp_detect.hpp"
#include "config.hpp"
#include "def/signatures.hpp"
#include "diag_log.hpp"
#include "hp_comm.hpp"
#include "logic/crc.hpp"
#include "logic/detect.hpp"
#include "sdkconfig.h"

namespace daik {

// Pages probed for the model fingerprint (union of what any profile references) plus 0x11 for the
// O/U EEPROM digits (display only — not a page-mask bit; see logic/detect.hpp page_bit).
static const uint8_t PROBE_PAGES[] = {
    0x00, 0x10, 0x11, 0x20, 0x21, 0x30, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0xA0, 0xA1};

// Query one register; on a valid reply copy its payload into out[0..outmax) and return the payload
// length, else -1. (hp_query already strips framing/CRC and returns <0 on timeout/NAK/bad CRC.)
static int read_page(uint8_t reg, Protocol proto, uint8_t* out, int outmax) {
    uint8_t buf[64];
    const int n = hp_query(reg, proto, buf, sizeof(buf));
    if (n <= 0) return -1;
    const int poff = payload_offset(proto);
    int paylen = n - poff - 1;                       // minus header, minus CRC byte
    if (paylen < 0) paylen = 0;
    const int copy = paylen < outmax ? paylen : outmax;
    for (int i = 0; i < copy; i++) out[i] = buf[poff + i];
    return paylen;
}

static bool proto_answers(Protocol p) {
    uint8_t tmp[64];
    return read_page(0x00, p, tmp, sizeof(tmp)) >= 0;
}

DetectResult hp_detect_run() {
    const Config& c = config();

    DetectResult r;
    r.rx = c.rx_pin;
    r.tx = c.tx_pin;

    // 1. Pin + protocol sweep. Candidate RX/TX pairs: the configured pins, their swap (a swapped
    //    X10A wire is the most common mistake), then the per-target Kconfig default and its swap —
    //    all pins already designated for X10A, so no arbitrary/unsafe GPIO probing. Keep the framing
    //    (and pins) that answer the identity page.
    struct PinPair { int rx, tx; };
    PinPair cand[4];
    int nc = 0;
    auto add = [&](int rx, int tx) {
        if (rx < 0 || tx < 0 || rx == tx) return;
        for (int i = 0; i < nc; i++) if (cand[i].rx == rx && cand[i].tx == tx) return;
        if (nc < 4) cand[nc++] = {rx, tx};
    };
    add(c.rx_pin, c.tx_pin);
    add(c.tx_pin, c.rx_pin);
    add(CONFIG_DAIKIN_RX_PIN, CONFIG_DAIKIN_TX_PIN);
    add(CONFIG_DAIKIN_TX_PIN, CONFIG_DAIKIN_RX_PIN);

    for (int i = 0; i < nc && !r.bus_ok; i++) {
        hp_uart_init(cand[i].rx, cand[i].tx);
        if (proto_answers(Protocol::I))      { r.proto = Protocol::I; r.bus_ok = true; }
        else if (proto_answers(Protocol::S)) { r.proto = Protocol::S; r.bus_ok = true; }
        if (r.bus_ok) { r.rx = cand[i].rx; r.tx = cand[i].tx; }
    }
    if (!r.bus_ok) { diag_printf("detect: no X10A response on any pin/proto — check wiring/GND\n"); return r; }
    hp_uart_init(r.rx, r.tx);                                   // settle on the winning pins

    // 2. Probe pages; capture the 0x00 (capacity) and 0x11 (EEPROM) payloads.
    Fingerprint fp{};
    uint8_t page00[32]; int len00 = -1;
    uint8_t page11[16]; int len11 = -1;
    for (uint8_t reg : PROBE_PAGES) {
        uint8_t pay[32];
        const int paylen = read_page(reg, r.proto, pay, static_cast<int>(sizeof(pay)));
        if (paylen < 0) continue;
        if (reg == 0x11) {
            len11 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(page11)); i++) page11[i] = pay[i];
            continue;                                // 0x11 is not a fingerprint page bit
        }
        fp.page_mask |= page_mask_bit(reg);
        if (reg == 0x00) {
            len00 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(page00)); i++) page00[i] = pay[i];
        }
    }

    // 3. Capacity from page 0x00 offset 12 (conv 105 raw byte = 0.1 kW units).
    if (len00 > 12) fp.kw_tenths = page00[12];

    // 4. EEPROM digits from page 0x11 offsets 0..5 (display only — no digits→name table).
    char ee[32] = {0};
    if (len11 >= 6) {
        for (int i = 0; i < 6; i++) fp.eeprom[i] = page11[i];
        fp.eeprom_ok = true;
        eeprom_render(fp.eeprom, 6, ee, static_cast<int>(sizeof(ee)));
    }

    r.page_mask = fp.page_mask;
    r.kw_tenths = fp.kw_tenths;
    r.eeprom    = ee;

    // 5. Narrow to the best-fitting candidate profiles.
    int nsig = 0;
    const Signature* sigs = def::signatures(nsig);
    const char* out[64];
    const int n = detect_candidates(sigs, nsig, fp, out, static_cast<int>(sizeof(out) / sizeof(out[0])));
    for (int i = 0; i < n && i < static_cast<int>(sizeof(out) / sizeof(out[0])); i++)
        r.candidates.emplace_back(out[i]);

    diag_printf("detect: proto=%c rx=%d tx=%d pages=0x%04x kw=%d eeprom=[%s] -> %d candidate(s)\n",
                static_cast<char>(r.proto), r.rx, r.tx, static_cast<unsigned>(fp.page_mask),
                fp.kw_tenths, ee, n);
    return r;
}

} // namespace daik
