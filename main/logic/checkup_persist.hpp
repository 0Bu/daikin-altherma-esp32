#pragma once
// Making the 24-hour plant checkup survive a reboot — WHEN a persisted window may be believed.
//
// logic/checkup.hpp decides what is COUNTED; this decides what may be RE-ADOPTED. The sibling of
// logic/history_persist.hpp, and deliberately the same machinery: a seal, a layout fingerprint, a
// reset-reason allowlist, and a named verdict for every way the answer can be no.
//
// ── Why this exists at all ──────────────────────────────────────────────────────────────────────
// The checkup was RAM-only "for history.hpp's reason" — hourly buckets in NVS would be write traffic
// in the partition holding the WiFi credentials, for a convenience. That argument was never about
// RAM; it was about FLASH, and #391 answered it for the trends by moving them into .noinit, where a
// reset that keeps power costs nothing to survive. The checkup simply never got the same treatment,
// and its own header went on justifying the gap with "it is not persisted, so a reboot starts it
// over regardless" — circular the moment somebody can change it.
//
// The gap matters MORE here than it does for the trends. A trend that loses an hour has a shorter
// chart; a checkup that loses its window loses the VERDICT, because the window is 24 h and the
// requirements are hours long. Measured on the reference installation: the DHW check had one
// completed hour after 9.9 h of uptime, and a single OTA took it back to zero — on a device
// following the `dev` channel, where a firmware-relevant merge publishes a build and an owner who
// keeps up to date may never reach 24 h at all.
//
// ── One medium, and the honest limit ────────────────────────────────────────────────────────────
// .noinit DRAM only. The rings are 1178 bytes and they were already static, so this costs no RAM,
// no flash write and no new partition — the arrays simply stop being initialised at startup.
//
// It does NOT cover a power cycle, and nothing here pretends otherwise: /status.health.persist
// reports "power_cycle" and the window starts empty, exactly as it always did.
//
// history_persist.hpp also runs a COARSE snapshot through the optional `history` flash partition for
// the case it says .noinit "cannot" cover. That is deliberately NOT mirrored here, for a reason the
// reference board settles rather than assumes: it reports `no `history` partition — reboot snapshot
// unavailable on this board`, because esp_https_ota writes the app slot and never the partition
// table, so every over-the-air-updated device lacks it and only a USB re-flash grants it. A second
// tenant in a partition most deployed boards do not have would have bought this feature nothing on
// the very board that motivated it.
//
// And the measurement is worth recording, because the sibling header states the opposite: that same
// board kept its trend rings across a real OTA through .noinit ALONE ("rings kept across a sw
// reset"). The new image's sections CAN move and then the bytes are not where the new build looks —
// but they need not, and on an ordinary incremental build they did not. So .noinit is not the
// power-cycle-only path it is described as; it is the path that fails closed when the layout moves,
// which the seal below is what makes safe.
//
// ── Why the restore needs no clock ──────────────────────────────────────────────────────────────
// history_persist.hpp's argument, and it transfers exactly: if the bytes are still there, power was
// never lost, so the gap is a reset — about a second, or the reboot at the end of an OTA install.
// The buckets are adopted in place with no re-anchoring. What CANNOT be adopted in place is the
// lifecycle anchor: first/latest_sample_us are monotonic and restart at zero, so the previous boot's
// observed span is carried as a DURATION (CheckupRing::carried_span_us) instead.
//
// The in-flight CheckupState/DhwLossState are deliberately NOT restored. They hold the previous
// sample's timestamp and the edge witnesses either side of it, and a reboot is precisely the
// discontinuity both step functions already know how to handle: no elapsed seconds are booked across
// it and no transition is read across it. Restoring them would book a compressor start that may
// never have happened — the one thing CHECKUP_MAX_GAP_S exists to refuse.
//
// ── Why a layout fingerprint, not just a CRC ────────────────────────────────────────────────────
// A bucket is a pile of anonymous counters. Nothing in `buh_s` says which row it was read from, so a
// firmware update that moved a locator, changed the bucket struct or moved a threshold would hand
// the previous build's numbers to a check that now means something else by them — a valid CRC over
// bytes that have quietly changed meaning. The fingerprint covers the geometry, every row locator
// and the constants that decide what a counter COUNTS, so any such edit invalidates the record
// automatically and nobody has to remember to bump a version.
//
// The MODEL is a second identity and is checked separately, at detect rather than at boot — see
// checkup_model_fingerprint.
#include "logic/checkup.hpp"
#include "logic/config_store.hpp"     // config_crc32_* — the firmware's ONE CRC implementation
#include "logic/history_persist.hpp"  // history_reset_preserves_ram — ONE answer to "did DRAM survive?"

#include <cstddef>
#include <cstdint>

namespace daik::logic {

inline constexpr uint32_t CHECKUP_PERSIST_MAGIC   = 0x504b4843u;   // "CHKP" little-endian
inline constexpr uint16_t CHECKUP_PERSIST_VERSION = 1;

// ── The verdict ─────────────────────────────────────────────────────────────────────────────────
// Named outcomes for history_persist.hpp's reason: each is a different thing to say on /diag and a
// different thing to do about it. "wrong_layout" after an update is expected and uninteresting;
// "bad_crc" on a board that was never power-cycled is a memory fault worth seeing.
enum class CheckupRestore : uint8_t {
    Accept,
    NoRecord,       // magic absent — a fresh board, or DRAM that was never written
    PowerCycle,     // the reset reason does not preserve RAM
    WrongVersion,   // this build's record layout differs
    WrongLayout,    // geometry, a row locator or a counting threshold moved
    BadCrc,         // present and current, but not intact
    ModelChanged,   // adopted at boot, then detection resolved a DIFFERENT unit
    SafeMode,       // latched boot-loop recovery: nothing will age the window, so nothing adopts it
};

inline constexpr const char* checkup_restore_slug(CheckupRestore r) {
    switch (r) {
        case CheckupRestore::Accept:       return "accept";
        case CheckupRestore::NoRecord:     return "no_record";
        case CheckupRestore::PowerCycle:   return "power_cycle";
        case CheckupRestore::WrongVersion: return "wrong_version";
        case CheckupRestore::WrongLayout:  return "wrong_layout";
        case CheckupRestore::BadCrc:       return "bad_crc";
        case CheckupRestore::ModelChanged: return "model_changed";
        case CheckupRestore::SafeMode:     return "safe_mode";
    }
    return "unknown";
}

// Order is deliberate, and is why this is a function rather than a chain of ifs at the call site:
// the cheapest and most explanatory refusal must win. A power-cycled board holds garbage that will
// usually fail the magic check too, and reporting "bad_crc" for it sends a reader looking for a
// memory fault that is not there.
//
// SAFE MODE is checked FIRST and refuses outright, which is the one rule here that is not about
// whether the bytes are intact. Safe mode does not start the poll task, so nothing ages the ring:
// an adopted window would sit frozen at its pre-reboot content — presented as a live 24-hour
// assessment — for as long as the latch holds, which can be days. That is evidence outliving the
// source it came from. It is also the state in which a plant verdict is worth least: the board is
// recovering from a boot loop, and every optional consumer is already down.
inline constexpr CheckupRestore checkup_restore_verdict(uint32_t reset_reason, uint32_t magic,
                                                        uint16_t version, uint32_t layout_fp,
                                                        uint32_t want_layout_fp,
                                                        uint32_t stored_crc, uint32_t actual_crc,
                                                        bool safe_mode = false) {
    if (safe_mode)                                  return CheckupRestore::SafeMode;
    if (!history_reset_preserves_ram(reset_reason)) return CheckupRestore::PowerCycle;
    if (magic != CHECKUP_PERSIST_MAGIC)             return CheckupRestore::NoRecord;
    if (version != CHECKUP_PERSIST_VERSION)         return CheckupRestore::WrongVersion;
    if (layout_fp != want_layout_fp)                return CheckupRestore::WrongLayout;
    if (stored_crc != actual_crc)                   return CheckupRestore::BadCrc;
    return CheckupRestore::Accept;
}

// ── The fingerprints ────────────────────────────────────────────────────────────────────────────
inline uint32_t checkup_fp_u32(uint32_t crc, uint32_t v) {
    const uint8_t b[4] = {static_cast<uint8_t>(v), static_cast<uint8_t>(v >> 8),
                          static_cast<uint8_t>(v >> 16), static_cast<uint8_t>(v >> 24)};
    return config_crc32_update(crc, b, sizeof(b));
}

inline uint32_t checkup_fp_loc(uint32_t crc, const CheckupLocator& l) {
    crc = checkup_fp_u32(crc, l.reg);
    crc = checkup_fp_u32(crc, l.off);
    return checkup_fp_u32(crc, static_cast<uint32_t>(l.conv));
}

// Everything that decides what a stored counter MEANS. Geometry first (a bucket that changed size
// or a ring that changed length cannot be read at all), then the row locators (which sensor a
// counter was read from), then the constants that decide what gets counted — a DHW window length or
// a high-loss threshold moving makes yesterday's `high_windows` a different statistic under the same
// name, which is exactly the substitution a CRC cannot see.
inline uint32_t checkup_layout_fingerprint() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(CheckupBucket)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(DhwLossBucket)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(CheckupRing)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(DhwLossRing)));
    crc = checkup_fp_u32(crc, CHECKUP_BUCKETS);
    crc = checkup_fp_u32(crc, CHECKUP_COMPLETED_BUCKETS);
    crc = checkup_fp_u32(crc, CHECKUP_DT_S);
    crc = checkup_fp_u32(crc, CHECKUP_MAX_GAP_S);
    for (const CheckupLocator& l : {CHECKUP_LOC_BSH, CHECKUP_LOC_PUMP, CHECKUP_LOC_PRESSURE,
                                    CHECKUP_LOC_FLOW, CHECKUP_LOC_VALVE, CHECKUP_LOC_R5T,
                                    CHECKUP_LOC_DEFROST, CHECKUP_LOC_BUH1, CHECKUP_LOC_BUH2})
        crc = checkup_fp_loc(crc, l);
    // The retry counters are addressed by a predicate rather than a table, so the fingerprint asks
    // it the same question the recorder does, over the page it answers for. A moved or added counter
    // changes the mapping and therefore the record.
    for (unsigned off = 0; off < 32; off++)
        for (int conv : {310, 311})
            crc = checkup_fp_u32(crc, static_cast<uint32_t>(
                      checkup_retry_index(0x10u, off, conv) + 1));
    crc = checkup_fp_u32(crc, DHW_LOSS_WINDOW_S);
    crc = checkup_fp_u32(crc, DHW_LOSS_SETTLE_S);
    crc = checkup_fp_u32(crc, DHW_LOSS_DRAW_WINDOW_S);
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(DHW_LOSS_DRAW_DROP_TENTHS));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(DHW_LOSS_HIGH_TENTHS_K_H));
    crc = checkup_fp_u32(crc, DHW_LOSS_BLIND_RUN_MAX_S);
    crc = checkup_fp_u32(crc, DHW_LOSS_BLIND_MAX_PCT);
    crc = checkup_fp_u32(crc, DHW_LOSS_CIRC_KNOWN_PCT);
    crc = checkup_fp_u32(crc, DHW_LOSS_CIRC_MIN_ON_S);
    crc = checkup_fp_u32(crc, DHW_LOSS_CIRC_OFF_SETTLE_S);
    crc = checkup_fp_u32(crc, CHECKUP_FLOW_RUNUP_S);
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(CHECKUP_BAR_WARN_TENTHS));
    crc = checkup_fp_u32(crc, CHECKUP_PRESSURE_CONFIRM_S);
    return config_crc32_final(crc);
}

// WHICH UNIT the stored window describes. Checked at DETECTION rather than at boot, because that is
// when the answer exists: the model is RAM-only by design and every boot re-runs the sweep, so at
// checkup_start() nothing yet knows what is on the bus.
//
// This is the trap history.cpp documents and paid for: treating "detection resolved" as "the
// identity changed" was harmless while the window died at every reboot anyway, and becomes a
// feature that delivers nothing the moment it does not — the restore is adopted at boot and thrown
// away four seconds later, on exactly the boards that have a heat pump attached. The profile id is
// the whole identity here, unlike the trends' per-row labels: every checkup locator is a fixed
// constant, so what varies between units is only which profile supplies them.
inline uint32_t checkup_model_fingerprint(const char* profile_id) {
    uint32_t crc = CONFIG_CRC32_INIT;
    const uint8_t nul = 0;
    if (profile_id) {
        size_t n = 0;
        while (profile_id[n]) n++;
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(profile_id), n);
    }
    crc = config_crc32_update(crc, &nul, 1);
    return config_crc32_final(crc);
}

} // namespace daik::logic
