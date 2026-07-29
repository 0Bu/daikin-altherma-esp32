// Protocol + model auto-detection (see hp_detect.hpp). One pass: sweep the protocol, probe pages,
// read capacity + EEPROM, narrow to candidate profiles. All decisions are in logic/detect.hpp.
#include "hp_detect.hpp"
#include "config.hpp"
#include "def/signatures.hpp"
#include "diag_log.hpp"
#include "hp_comm.hpp"
#include "logic/crc.hpp"
#include "logic/detect.hpp"
#include "logic/hexdump.hpp"
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

// Same read, but RETRIED — used only for the page probe (step 2), where the protocol and pins are
// already known to answer, so a non-reply is far more likely to be a dropped frame than a page the
// unit does not have.
//
// This matters more than a lost reading would: the page probe does not gather VALUES, it gathers
// the unit's IDENTITY. One dropped frame clears one page bit for the whole boot, and because
// signature_consistent() matches on page SUBSET, clearing a bit that every profile references makes
// them all inconsistent — the unit is then read with `generic` (53 rows, no leaving water, no
// compressor speed, no pressures). Measured: that is what 8 of the 12 fingerprint pages do (#214).
// The board this was found on reboots often enough to roll those dice weekly.
//
// Cost is bounded and paid only on failure: a page that answers costs one query as before, and the
// bus was already proven to answer before this loop is reached. Worst case is
// (DETECT_PAGE_TRIES - 1) extra 300 ms timeouts per genuinely-absent page, once per detect pass.
static constexpr int DETECT_PAGE_TRIES = 3;

// `recovered` counts only the retries that SAVED a page — attempts beyond the first on a page that
// then answered. Attempts spent on a page the unit simply does not have are NOT counted: every probe
// sweep tries pages no single model carries (0x65 answers on none of the measured units), so counting
// them made `retries=` read 3 on a perfectly healthy boot and an operator reading it would reasonably
// conclude the bus was dropping frames. A diagnostic whose healthy baseline is non-zero trains its
// reader to ignore it. Now 0 is healthy and any non-zero is a real dropped reply that the retry
// caught — which is the number worth watching, since that is the failure #214 is about. A page that
// never answered needs no counter: its bit is already absent from the page mask on the same line.
static int read_page_retry(uint8_t reg, Protocol proto, uint8_t* out, int outmax, int& recovered) {
    for (int attempt = 0; attempt < DETECT_PAGE_TRIES; attempt++) {
        const int n = read_page(reg, proto, out, outmax);
        if (n >= 0) {
            recovered += attempt;                    // 0 on a first-try answer
            return n;
        }
    }
    return -1;                                       // absent, not dropped — nothing to report
}

DetectResult hp_detect_run() {
    const Config& c = config();

    DetectResult r;
    r.rx = c.rx_pin;
    r.tx = c.tx_pin;

    // 1. Pin + protocol sweep. Candidate RX/TX pairs, in order: the persisted-cache pins (c.rx/tx,
    //    tried FIRST), their swap (a swapped X10A wire is the most common mistake), then the per-target
    //    Kconfig default and its swap — so a stale/default cache still self-heals to the real wiring.
    //    All pins are X10A-designated (no arbitrary GPIO probing). Keep the framing + pins that answer.
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

    const Protocol p0 = c.proto;                               // cached framing — try it first
    const Protocol p1 = (p0 == Protocol::I) ? Protocol::S : Protocol::I;
    for (int i = 0; i < nc && !r.bus_ok; i++) {
        diag_printf("detect: probing rx=%d tx=%d (proto %c/%c)\n",
                    cand[i].rx, cand[i].tx, static_cast<char>(p0), static_cast<char>(p1));
        // CHECK the bring-up, exactly as poll_once does, and for two distinct reasons:
        //   * A failed REMAP leaves the driver valid on the PREVIOUS pins (hp_comm.cpp keeps it that
        //     way on purpose). Probing on anyway means an answer heard on the old pair gets recorded
        //     as this candidate's — and poll_detect then persists that wrong pair via
        //     config_save_link, so the next boot starts from a lie the sweep has to undo.
        //   * A failed first INSTALL leaves no driver at all, and every hp_query then reports
        //     "HP timeout — check X10A cable / GND": a wiring accusation against a fault that is
        //     entirely on this side of the connector. Naming the real cause once is the whole point
        //     of the equivalent guard in poll_once.
        if (!hp_uart_init(cand[i].rx, cand[i].tx)) {
            diag_printf("detect: UART bring-up failed on rx=%d tx=%d — skipping this pair\n",
                        cand[i].rx, cand[i].tx);
            continue;
        }
        if (proto_answers(p0))      { r.proto = p0; r.bus_ok = true; }
        else if (proto_answers(p1)) { r.proto = p1; r.bus_ok = true; }
        if (r.bus_ok) { r.rx = cand[i].rx; r.tx = cand[i].tx; }
    }
    if (!r.bus_ok) {
        if (nc > 0) {
            diag_printf("detect: no X10A response on any pin/proto (last tried rx=%d tx=%d) — check wiring/GND\n",
                        cand[nc - 1].rx, cand[nc - 1].tx);
        } else {
            diag_printf("detect: no valid rx/tx pin candidates to probe — check config\n");
        }
        return r;
    }
    // Settle on the winning pins. This is a Noop in the common case (the sweep left the driver on
    // exactly this pair), so a failure here would mean the pins stopped being usable between the
    // answer and now — report it and give up rather than fingerprint the unit through a link we no
    // longer know the shape of. bus_ok is cleared so poll_detect keeps "auto" and simply retries.
    if (!hp_uart_init(r.rx, r.tx)) {
        diag_printf("detect: UART re-init failed on the answering pair rx=%d tx=%d — retrying\n",
                    r.rx, r.tx);
        r.bus_ok = false;
        return r;
    }

    // 2. Probe pages; capture the 0x00 (capacity) and 0x11 (EEPROM) payloads.
    Fingerprint fp{};
    uint8_t page00[32]; int len00 = -1;
    uint8_t page11[16]; int len11 = -1;
    uint8_t page60[32]; int len60 = -1;
    uint8_t page10[32]; int len10 = -1;              // dump-only (below): target temps
    uint8_t page20[32]; int len20 = -1;              // dump-only (below): O/U sensors + pressures
    uint8_t pageA0[32]; int lenA0 = -1;              // O/U-II rows — raw, for the diag dump below
    uint8_t pageA1[32]; int lenA1 = -1;
    int probe_retries = 0;                           // dropped replies the retry RECOVERED (0 = healthy)
    for (uint8_t reg : PROBE_PAGES) {
        uint8_t pay[32];
        const int paylen = read_page_retry(reg, r.proto, pay, static_cast<int>(sizeof(pay)), probe_retries);
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
        } else if (reg == 0x60) {
            len60 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(page60)); i++) page60[i] = pay[i];
        } else if (reg == 0x10) {
            len10 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(page10)); i++) page10[i] = pay[i];
        } else if (reg == 0x20) {
            len20 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(page20)); i++) page20[i] = pay[i];
        } else if (reg == 0xA0) {
            lenA0 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(pageA0)); i++) pageA0[i] = pay[i];
        } else if (reg == 0xA1) {
            lenA1 = paylen;
            for (int i = 0; i < paylen && i < static_cast<int>(sizeof(pageA1)); i++) pageA1[i] = pay[i];
        }
    }

    // 2b. RAW payload dump for the pages whose LAYOUT is still an open question. HTTP exposes only
    //     decoded values, so a physically impossible reading cannot be attributed to a wrong
    //     converter vs. a wrong offset vs. a per-unit layout difference without the wire bytes —
    //     and they are otherwise unobservable off-device. Each page here answers one such question:
    //       0x00  "why is the O/U capacity absent?" — a short descriptor omits offset 12.
    //       0xA0  "why do some O/U-II rows read a constant 0.0 while others read ~190 °C?"
    //       0xA1  same block; every row on it decoded to a constant 0.0 on a live unit.
    //       0x10  Target Evap. Temp. (offset 6) reached 199.6 °C on a live unit — impossible, and
    //             0.4 °C UNDER reading_plausible()'s +200 °C ceiling, so nothing masks it.
    //       0x20  the two outdoor pressures (offsets 12/14) stayed at 0.0 bar in every sample taken
    //             while the compressor ran at 42 rps with 104.5 °C discharge; an R32 high side runs
    //             25-40 bar there. Absent sensor or wrong offset — the bytes decide, the decode can't.
    //     One line per page, only on a detect pass (not per poll cycle), so the diag ring (6 KB) and
    //     syslog stay readable: 5 lines of ~120 chars against a 256-byte line buffer.
    {
        const struct { uint8_t reg; const uint8_t* buf; int len; } raw[] = {
            {0x00, page00, len00}, {0x10, page10, len10}, {0x20, page20, len20},
            {0xA0, pageA0, lenA0}, {0xA1, pageA1, lenA1},
        };
        for (const auto& pg : raw) {
            if (pg.len < 0) {                        // page did not answer — say so, don't stay silent
                diag_printf("detect: raw 0x%02X no reply\n", pg.reg);
                continue;
            }
            char hex[104];                           // 32 B -> 95 chars + NUL; see logic/hexdump.hpp
            const int capped = pg.len < 32 ? pg.len : 32;
            hex_render(pg.buf, capped, hex, static_cast<int>(sizeof(hex)));
            diag_printf("detect: raw 0x%02X len=%d [%s]\n", pg.reg, pg.len, hex);
        }
    }

    // 3. Capacity from page 0x00 offset 12 (conv 105 raw byte = 0.1 kW units). This descriptor is
    //    variable-length; a smaller unit returns a short 0x00 that omits offset 12, leaving kw_tenths
    //    at -1 (docs/X10A_PROTOCOL.md §7). Fall back to the I/U capacity code (page 0x60 offset 6,
    //    conv 219, same kW×10 units) so detect_best can still class the model (a byte 0 = not
    //    reported). The fallback only RANKS the representative, never excludes a candidate.
    if (len00 > 12) fp.kw_tenths = page00[12];
    if (len60 > 6 && page60[6] != 0) fp.iu_kw_tenths = page60[6];

    // 4. EEPROM digits from page 0x11 offsets 0..5 (display only — no digits→name table).
    char ee[32] = {0};
    if (len11 >= 6) {
        for (int i = 0; i < 6; i++) fp.eeprom[i] = page11[i];
        fp.eeprom_ok = true;
        eeprom_render(fp.eeprom, 6, ee, static_cast<int>(sizeof(ee)));
    }

    r.page_mask    = fp.page_mask;
    r.kw_tenths    = fp.kw_tenths;
    r.iu_kw_tenths = fp.iu_kw_tenths;
    r.eeprom       = ee;

    // 5. Narrow to the best-fitting candidate profiles.
    int nsig = 0;
    const Signature* sigs = def::signatures(nsig);
    const char* out[64];
    const int n = detect_candidates(sigs, nsig, fp, out, static_cast<int>(sizeof(out) / sizeof(out[0])));
    for (int i = 0; i < n && i < static_cast<int>(sizeof(out) / sizeof(out[0])); i++)
        r.candidates.emplace_back(out[i]);
    // Best-fit representative to actually read with (deterministic, not registry order). When the
    // capacity is known the candidates share a kW class and are register-equivalent, so this only
    // names the displayed model; when the O/U capacity is absent (short 0x00) the set spans classes,
    // so detect_best leans on the I/U capacity fallback to pick the right-class reading profile.
    if (const char* b = detect_best(sigs, nsig, fp)) r.best = b;

    // `retries` is on this line rather than its own: a rising count is the early warning that the
    // page probe is working harder to hold the fingerprint together, which is the condition that
    // used to change the model silently (#214). It counts only retries that RECOVERED a page, so 0
    // is the healthy reading and any non-zero is a reply that was actually dropped.
    diag_printf("detect: proto=%c rx=%d tx=%d pages=0x%04x kw=%d iu_kw=%d eeprom=[%s] retries=%d -> %d candidate(s), best=%s\n",
                static_cast<char>(r.proto), r.rx, r.tx, static_cast<unsigned>(fp.page_mask),
                fp.kw_tenths, fp.iu_kw_tenths, ee, probe_retries, n,
                r.best.empty() ? "(none)" : r.best.c_str());
    return r;
}

} // namespace daik
