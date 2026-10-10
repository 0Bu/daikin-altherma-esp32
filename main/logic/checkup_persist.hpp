#pragma once
// Checkup integrity, scoped handoff and absolute-age journal compatibility.
//
// Completed diagnosis hours are reconstructed from the history flash journal after clock sync
// and current-boot X10A source confirmation. Warm .noinit rings have no absolute ages and are
// always retired: repeated boots near an hourly seam must not rejuvenate an older assessment.
// RAM-only completed hours and undated open-hour counters can therefore be lost on a restart.
//
// Each journal payload carries the detected profile, the existing X10A profile/pins/protocol
// target fingerprint, consent generation and exact interval end. The layout fingerprint binds
// the bucket geometry, row locators and counting thresholds. Old unscoped records fail closed.
// A unit swap that leaves the detected profile and link unchanged remains indistinguishable.
//
// The RAM integrity predicate remains useful for a separately sealed, one-shot ongoing DHW
// level filter written at an intentional esp_restart. Startup consumes the checkpoint once,
// holds it only until current source confirmation. A carried candidate books the entire startup
// gap plus the restart allowance as blind time; a settle/charge-only handoff adds no candidate
// evidence. Undated completed pending counters are discarded. Edge state is never carried.
#include "logic/checkup.hpp"
#include "logic/config_store.hpp"     // config_crc32_* — the firmware's ONE CRC implementation
#include "logic/history_persist.hpp"  // history_reset_preserves_ram — ONE answer to "did DRAM survive?"

#include <cstddef>
#include <cstdint>

namespace daik::logic {

inline constexpr uint32_t CHECKUP_PERSIST_MAGIC   = 0x504b4843u;   // "CHKP" little-endian
// v2 adds the diagnostics consent generation to the warm-restart image.  A v1
// image must not be interpreted with the shifted v2 layout.  v3 seals the count of boots that
// adopted the window and have not completed an hour since (HIST-03/b): a v2 image cannot say
// whether its newest hour was ever aged, so it is refused as a whole.
// v4 binds the full X10A source; integrity permits only the separate scoped handoff.
// Completed hours are reconstructed exclusively from absolute-age flash records.
inline constexpr uint16_t CHECKUP_PERSIST_VERSION = 4;

// ── The verdict ─────────────────────────────────────────────────────────────────────────────────
// Internal integrity/refusal and public restoration vocabulary. Startup routes internal Accept
// to FlashPending; later journal selection can report Fresh or Flash. "wrong_layout" after an
// update is expected; "bad_crc" on a board that was never power-cycled is a memory fault worth
// seeing.
enum class CheckupRestore : uint8_t {
    Accept,       // integrity only; startup routes this to FlashPending
    NoRecord,     // magic absent — a fresh board, or DRAM that was never written
    PowerCycle,   // the reset reason does not preserve RAM
    WrongVersion, // this build's record layout differs
    WrongLayout,  // geometry, a row locator or a counting threshold moved
    BadCrc,       // present and current, but not intact
    ModelChanged, // an explicit reset or later detector changed the source contract
    SafeMode,     // latched boot-loop recovery: nothing will age the window, so nothing adopts it
    DiagnosticsDisabled, // explicit master switch is off: no observation or restore is allowed
    DiagnosticsChanged,  // evidence belongs to an earlier enable/disable generation
    NotCommitted,        // retained legacy integrity-counter refusal; no completed-hour age claim
    FlashPending,        // RAM hours retired; journal recovery pending, not proof of stored hours
    Fresh,               // no stored intervals selected, including live/capacity precedence
    Flash,               // selected stored intervals establish absolute-age journal reconstruction
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
        case CheckupRestore::DiagnosticsDisabled: return "diagnostics_disabled";
        case CheckupRestore::DiagnosticsChanged:  return "diagnostics_changed";
        case CheckupRestore::NotCommitted:
            return "not_committed";
        case CheckupRestore::FlashPending:
            return "flash_pending";
        case CheckupRestore::Fresh:
            return "fresh";
        case CheckupRestore::Flash:
            return "flash";
    }
    return "unknown";
}

// Order is deliberate, and is why this is a function rather than a chain of ifs at the call site:
// the cheapest and most explanatory refusal must win. A power-cycled board holds garbage that will
// usually fail the magic check too, and reporting "bad_crc" for it sends a reader looking for a
// memory fault that is not there.
//
// Diagnostics-disabled and safe-mode refusals precede byte-integrity checks. Neither permits
// observation or restoration; startup retires completed RAM hours in every case. Safe mode also
// stops optional producers while the board recovers from a boot loop.
//
// NOT COMMITTED retains the sealed counter's legacy integrity refusal and is last because that
// counter means nothing until the record passes its other checks. It does not establish age or
// admit completed RAM hours: startup retires those hours regardless of this verdict. Integrity
// instead gates the separate one-shot DHW handoff. `Flash` is not a verdict of this function:
// later compatible absolute-age journal reconstruction reports it only after selecting evidence.
inline constexpr CheckupRestore
checkup_restore_verdict(uint32_t reset_reason, uint32_t magic, uint16_t version, uint32_t layout_fp,
                        uint32_t want_layout_fp, uint32_t stored_crc, uint32_t actual_crc,
                        bool safe_mode = false, bool diagnostics_enabled = true,
                        uint32_t stored_generation = 0, uint32_t wanted_generation = 0,
                        uint32_t boots_since_commit = 0) {
    if (!diagnostics_enabled)                         return CheckupRestore::DiagnosticsDisabled;
    if (safe_mode)                                  return CheckupRestore::SafeMode;
    if (!history_reset_preserves_ram(reset_reason)) return CheckupRestore::PowerCycle;
    if (magic != CHECKUP_PERSIST_MAGIC)             return CheckupRestore::NoRecord;
    if (version != CHECKUP_PERSIST_VERSION)         return CheckupRestore::WrongVersion;
    if (layout_fp != want_layout_fp)                return CheckupRestore::WrongLayout;
    if (stored_crc != actual_crc)                   return CheckupRestore::BadCrc;
    if (stored_generation != wanted_generation)     return CheckupRestore::DiagnosticsChanged;
    if (boots_since_commit != 0) return CheckupRestore::NotCommitted;
    return CheckupRestore::Accept;
}

// Whether the one-shot DHW handoff of the previous boot's esp_restart is still believed. It rides
// the record but has its own seal, model and layout. Startup consumes it once and retires all
// completed RAM hours independently. The retained legacy NotCommitted counter follows the other
// integrity and consent checks and does not itself measure age, so it need not reject this separate
// handoff. Its own scope and seal still must pass, and applying it waits for current-source
// confirmation. Preserving a compatible settle timer prevents a candidate inside the charge guard;
// every other refusal clears the handoff as well.
inline constexpr bool checkup_restore_keeps_dhw_handoff(CheckupRestore r) {
    return r == CheckupRestore::Accept || r == CheckupRestore::NotCommitted;
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
                                    CHECKUP_LOC_FLOW, CHECKUP_LOC_VALVE, CHECKUP_LOC_IU_MODE,
                                    CHECKUP_LOC_R5T, CHECKUP_LOC_OUTDOOR,
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
    // Both decide what a stored counter MEANS, so both belong here: the charge minimum changes which
    // events armed a settle (and therefore which hours ever became candidates), and the blocked
    // threshold changes what an `aborts` tally concludes.
    crc = checkup_fp_u32(crc, DHW_LOSS_CHARGE_MIN_S);
    crc = checkup_fp_u32(crc, DHW_LOSS_BLOCKED_MIN_ABORTS);
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
// First detection confirms this boot's source for later journal admission and the scoped DHW
// filter handoff. Later source changes retire the old window.
// This fingerprint binds the model portion: every checkup locator is fixed, and the profile selects
// its decoding. The separate source_fp additionally binds the existing X10A profile/pins/protocol
// target scope.
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

// ── Durable hourly journal payload ───────────────────────────────────────────────────────────────
// history_persist.hpp owns the common 256-byte slot/header protocol; this header owns what the
// diagnostic bytes MEAN.  `end_unix_s` is the exact end of the measured one-hour interval, not only
// floor(unix/3600): after a cold boot it lets full_span remain an elapsed-time statement and lets a
// record older than the rolling day be rejected even when the board was powered off for weeks.
struct CheckupJournalPayload {
    uint32_t model_fp = 0;
    uint32_t source_fp = 0; // full detected X10A profile/link identity; zero is unsupported legacy
    uint32_t diagnostics_generation = 0;
    int64_t end_unix_s = -1;
    CheckupBucket checkup;
    DhwLossBucket dhw;
};

struct CheckupJournalRecord {
    int64_t               bucket = INT64_MIN;
    CheckupJournalPayload payload;
};

inline constexpr size_t CHECKUP_JOURNAL_WORD_BYTES = sizeof(uint16_t);
inline constexpr size_t CHECKUP_JOURNAL_WORDS =
    (sizeof(CheckupJournalPayload) + CHECKUP_JOURNAL_WORD_BYTES - 1) /
    CHECKUP_JOURNAL_WORD_BYTES;
inline constexpr size_t CHECKUP_JOURNAL_PAYLOAD_BYTES =
    CHECKUP_JOURNAL_WORDS * CHECKUP_JOURNAL_WORD_BYTES;

// The common journal version cannot name a change inside this source: its first three source ids
// must remain compatible with already-written trend records.  Fold the diagnostic wire shape into
// this source's identity instead, beside every threshold/locator already covered above.
inline uint32_t checkup_journal_fingerprint() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = checkup_fp_u32(crc, checkup_layout_fingerprint());
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(CheckupJournalPayload)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(offsetof(CheckupJournalPayload, model_fp)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(offsetof(CheckupJournalPayload, source_fp)));
    crc = checkup_fp_u32(
        crc, static_cast<uint32_t>(offsetof(CheckupJournalPayload, diagnostics_generation)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(offsetof(CheckupJournalPayload, end_unix_s)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(offsetof(CheckupJournalPayload, checkup)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(offsetof(CheckupJournalPayload, dhw)));
    return config_crc32_final(crc);
}

inline constexpr int64_t checkup_journal_bucket(int64_t end_unix_s) {
    return end_unix_s >= 0 ? end_unix_s / static_cast<int64_t>(CHECKUP_DT_S) : INT64_MIN;
}

// A completed interval contributes while any part of its one-hour extent can still be inside the
// rolling day. Future records are refused rather than slid to now; a stale record after a long power
// outage is valid flash, but no longer current diagnostic evidence.
inline constexpr bool checkup_journal_in_window(int64_t end_unix_s, int64_t now_unix_s) {
    return end_unix_s >= 0 && now_unix_s >= 0 && end_unix_s <= now_unix_s &&
           end_unix_s > now_unix_s - static_cast<int64_t>(CHECKUP_WINDOW_S);
}

// Only buckets completed in THIS boot have the current monotonic-to-wall-clock anchor. After a
// cold restore the first new completion need not be adjacent to the newest stored wall-clock bucket
// (the board may have been off for part of an hour), so jump to the oldest genuinely live bucket
// instead of relabelling a restored predecessor as the missing hour.
inline constexpr int64_t checkup_journal_next_live_bucket(int64_t after_bucket,
                                                          int64_t newest_live_bucket,
                                                          size_t live_count) {
    if (!live_count || newest_live_bucket == INT64_MIN || after_bucket >= newest_live_bucket)
        return INT64_MIN;
    const int64_t oldest_live = newest_live_bucket - static_cast<int64_t>(live_count - 1);
    const int64_t target = after_bucket == INT64_MIN ? oldest_live : after_bucket + 1;
    return target < oldest_live ? oldest_live : target;
}

// ── Intentional-reboot DHW handoff ──────────────────────────────────────────────────────────────
// Separate from the completed-ring seal on purpose.  The normal seal must remain valid through an
// unexpected panic while the open buckets change. The best-effort intentional-restart checkpoint
// is consumed once at startup; applying its compatible filter waits for current-source
// confirmation.
inline constexpr uint32_t CHECKUP_DHW_HANDOFF_MAGIC   = 0x57484443u; // "CDHW" little-endian
inline constexpr uint16_t CHECKUP_DHW_HANDOFF_VERSION = 2;

struct DhwLossHandoffPayload {
    uint32_t      source_fp = 0; // bound independently from profile and consent
    DhwLossCarry  candidate;
    DhwLossBucket pending; // reserved layout field; undated completed counters retire on restart
};

inline uint32_t checkup_dhw_handoff_layout_fingerprint() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = checkup_fp_u32(crc, checkup_layout_fingerprint());
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(DhwLossCarry)));
    crc = checkup_fp_u32(crc, static_cast<uint32_t>(sizeof(DhwLossBucket)));
    crc = checkup_fp_u32(crc, DHW_LOSS_REBOOT_BLIND_S);
    crc = checkup_fp_u32(crc, DHW_LOSS_CARRY_SEGMENT);
    crc = checkup_fp_u32(crc, DHW_LOSS_CARRY_DRAW);
    return config_crc32_final(crc);
}

// Field-wise rather than over raw structs: padding bytes are not evidence and must not decide
// whether a valid handoff survives a compiler update.
inline uint32_t checkup_dhw_handoff_crc(uint32_t model_fp,
                                        const DhwLossHandoffPayload& p) {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = checkup_fp_u32(crc, model_fp);
    crc                   = checkup_fp_u32(crc, p.source_fp);
    const DhwLossCarry& c = p.candidate;
    crc = checkup_fp_u32(crc, c.segment_elapsed_s);
    crc = checkup_fp_u32(crc, c.draw_anchor_age_s);
    crc = checkup_fp_u32(crc, c.segment_circulation_known_s);
    crc = checkup_fp_u32(crc, c.segment_circulation_on_s);
    crc = checkup_fp_u32(crc, c.settle_remaining_s);
    crc = checkup_fp_u32(crc, c.charge_run_s);
    crc = checkup_fp_u32(crc, c.segment_blind_s);
    crc = checkup_fp_u32(crc, c.blind_run_s);
    crc = checkup_fp_u32(crc, static_cast<uint16_t>(c.segment_start_tenths));
    crc = checkup_fp_u32(crc, static_cast<uint16_t>(c.draw_anchor_tenths));
    crc = checkup_fp_u32(crc, c.flags);

    const DhwLossBucket& b = p.pending;
    crc = checkup_fp_u32(crc, b.observed_s);
    crc = checkup_fp_u32(crc, b.circulation_known_s);
    crc = checkup_fp_u32(crc, b.circulation_on_s);
    crc = checkup_fp_u32(crc, static_cast<uint16_t>(b.max_loss_tenths_k_h));
    crc = checkup_fp_u32(crc, b.windows);
    crc = checkup_fp_u32(crc, b.high_windows);
    crc = checkup_fp_u32(crc, b.high_with_pump);
    crc = checkup_fp_u32(crc, b.high_pump_off);
    crc = checkup_fp_u32(crc, b.best_aborted_s);
    crc = checkup_fp_u32(crc, b.aborts);
    crc = checkup_fp_u32(crc, b.abort_reasons);
    return config_crc32_final(crc);
}

inline bool checkup_dhw_handoff_valid(uint32_t magic, uint16_t version,
                                      uint32_t layout_fp, uint32_t model_fp,
                                      uint32_t expected_model_fp, uint32_t stored_crc,
                                      const DhwLossHandoffPayload& payload) {
    return magic == CHECKUP_DHW_HANDOFF_MAGIC && version == CHECKUP_DHW_HANDOFF_VERSION &&
           layout_fp == checkup_dhw_handoff_layout_fingerprint() &&
           model_fp == expected_model_fp &&
           stored_crc == checkup_dhw_handoff_crc(model_fp, payload);
}

// Integrity and restoration are separate: a warm image never establishes completed-hour ages.
inline constexpr CheckupRestore checkup_restore_route(CheckupRestore integrity) {
    return integrity == CheckupRestore::Accept || integrity == CheckupRestore::NotCommitted
               ? CheckupRestore::FlashPending
               : integrity;
}

inline bool checkup_journal_identity_matches(const CheckupJournalPayload& p, uint32_t model_fp,
                                             uint32_t source_fp, uint32_t generation) {
    return source_fp != 0 && p.source_fp == source_fp && p.model_fp == model_fp &&
           p.diagnostics_generation == generation;
}

// Actual production admission for both stored and current-boot records. A cached startup scope
// and a withdrawn source are expectations, never confirmation; absent clock uses the -1 sentinel.
inline constexpr bool checkup_flash_source_ready(bool confirmed, uint32_t model_fp,
                                                 uint32_t source_fp, bool reset_requested) {
    return confirmed && model_fp != 0 && source_fp != 0 && !reset_requested;
}
inline bool checkup_journal_restore_admits(const CheckupJournalPayload& p, int64_t bucket,
                                           int64_t now_unix_s, bool confirmed, uint32_t model_fp,
                                           uint32_t source_fp, uint32_t generation,
                                           bool reset_requested) {
    return checkup_flash_source_ready(confirmed, model_fp, source_fp, reset_requested) &&
           checkup_journal_identity_matches(p, model_fp, source_fp, generation) &&
           bucket == checkup_journal_bucket(p.end_unix_s) &&
           checkup_journal_in_window(p.end_unix_s, now_unix_s);
}

// Select exactly one admissible record for a retained slot. Current-boot evidence wins only
// while it is itself valid; otherwise the newest valid stored duplicate wins. The caller uses
// this same selection for provenance counting and reconstruction after capacity clipping.
inline const CheckupJournalRecord*
checkup_journal_select_slot(int64_t wanted, const CheckupJournalRecord* live, size_t live_count,
                            const CheckupJournalRecord* stored, size_t stored_count,
                            int64_t now_unix_s, bool confirmed, uint32_t model_fp,
                            uint32_t source_fp, uint32_t generation, bool reset_requested,
                            bool& from_flash) {
    from_flash = false;
    if ((!live && live_count) || (!stored && stored_count)) return nullptr;
    auto admits = [&](const CheckupJournalRecord& rec) {
        return rec.bucket == wanted &&
               checkup_journal_restore_admits(rec.payload, rec.bucket, now_unix_s, confirmed,
                                              model_fp, source_fp, generation, reset_requested);
    };
    for (size_t i = 0; i < live_count; ++i)
        if (admits(live[i])) return &live[i];
    for (size_t i = stored_count; i > 0; --i) {
        if (!admits(stored[i - 1])) continue;
        from_flash = true;
        return &stored[i - 1];
    }
    return nullptr;
}

// Reconstructed slots, including selected live intervals, have monotonic deadlines independent of
// the next boot-raster boundary and later SNTP corrections. Zero marks gaps or ordinary live slots
// that still age through the hourly ring. Equality expires: end <= now - 24 h.
inline constexpr bool checkup_restored_expired(int64_t expiry_us, int64_t now_us) {
    return expiry_us > 0 && now_us >= expiry_us;
}
inline constexpr int64_t checkup_restore_expiry_us(int64_t end_unix_s, int64_t now_unix_s,
                                                   int64_t now_us) {
    if (now_us < 0 || !checkup_journal_in_window(end_unix_s, now_unix_s)) return 0;
    const int64_t remaining_us =
        (static_cast<int64_t>(CHECKUP_WINDOW_S) - (now_unix_s - end_unix_s)) * 1000000LL;
    return now_us > INT64_MAX - remaining_us ? INT64_MAX : now_us + remaining_us;
}
} // namespace daik::logic
