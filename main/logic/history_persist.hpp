#pragma once
// Making the 24-hour trend rings survive a reboot — WHEN a persisted ring may be believed, and
// where its samples belong on the time axis once it is.
//
// history.hpp decides what is recorded; this decides what may be RE-ADOPTED. The two questions are
// not the same shape at all: recording is about one reading at a time, while a restore adopts ~30
// KB of prior state in one act and every field in it is a claim about a moment that has already
// passed. Get it wrong and the chart is not empty — it is confidently wrong, which is strictly
// worse than the blank axis this firmware shipped with (the legacy-35–legacy-39 shape, drawn as a
// day of history).
//
// ── Two media, ONE question each ────────────────────────────────────────────────────────────────
// The firmware persists the rings two ways, because neither alone covers the reboots that actually
// happen:
//
//   .noinit DRAM   — may survive a compatible reset that KEEPS POWER (esp_restart from a /set_*
//   save,
//                    a panic or a task watchdog). Reuses the live arrays without flash writes;
//                    bounded metadata and restore sidecars use additional RAM. A power cycle cannot
//                    preserve it; an OTA may move the section, so only a matching seal can adopt it
//                    and compatible committed flash records provide the durable OTA path. Factory
//                    reset explicitly wipes this RAM too.
//   history        — an append-only flash journal: one compact record per source and completed
//                    five-minute bucket. After a successful scan and wall-clock sync enable
//                    commits, it covers OTA, ordinary reboot and later power loss for committed
//                    intervals. Open and undrained buckets can be lost; backlog and adoption floors
//                    prevent a universal one-bucket loss bound. It exists only in the official 8 MB
//                    table; there is no coarse/old-table fallback.
//
// ── Why the RAM path needs no clock and the flash one does ─────────────────────────────────────
// A restored sample is meaningless without knowing WHEN it was taken, and the ring runs on the
// MONOTONIC clock (history.hpp), which restarts at zero every boot. So a restore has to re-anchor.
//
// For .noinit the DOWNTIME needs no clock, and that is a property of the medium rather than an
// assumption: if the bytes are still there, power was never lost, and a reset that keeps power
// completes in about a second (a USB or pin reset that holds the chip can take longer; the fixed
// allowance below then under-books it). The rings are adopted in place. What they cannot say is
// HOW LONG the newest sample has been waiting: the rest of the previous boot after its bucket
// closed, the downtime and this boot's own uptime up to the raster boundary it claims all passed
// with nothing measuring. Adoption therefore BOOKS that stretch as explicit no-reading samples
// (history_adopt_booking) and claims the newest of them for the start of this boot's raster
// (history_raster_boundary_us), so the first live commit lands on the bucket after it. Claiming the
// boot instant with no gaps instead collapsed the stretch to nothing, and the collapses of
// repeated restarts added up, always in one direction, until a day-old curve sat hours off.
//
// What is booked is what the liveness record below MEASURES: the previous boot's last sign of life
// minus the raster boundary its newest commit closed, plus a fixed downtime allowance, plus the
// uptime up to the claim. A raster that stalled while the device kept signing (an OTA or weather
// hold-off parks the X10A raster, a HomeHub task that stopped) therefore has its stall booked
// at five-minute resolution, and keeps the samples it had; stalling alone does not refuse it.
// Short interruptions can leave no visible gap. The count is capped at the
// ring: a stretch of a ring or more leaves a ring of nothing but gaps, which is a ring that has
// effectively lost its samples to the passing of time, not to a guard.
//
// The stretch is rounded to the NEAREST bucket and the rounding RESIDUAL is carried to the next
// adoption of the same raster (error diffusion, a sealed field of the region). Rounding alone is
// unbiased only if the restarts fall at random phases of the bucket; a restart loop at a fixed
// uptime leaves the same residual with the same sign at every seam, and the residuals add up
// linearly. Carried forward, the rounding errors of all the seams a sample crossed telescope into
// the difference of two residuals, so the rounding term of any sample stays within one bucket
// (HISTORY_DT_S) however many restarts it crossed. What the carry cannot remove are the terms that
// are not rounding, and those do add up, a few seconds per restart: the allowance against the real
// downtime (5 s against a typical 1 s; a longer held reset can instead be under-booked) and, after
// a panic or a watchdog, the time between the last sign of life and the reset (an under-booking).
// An esp_restart shutdown touch is best effort: its bounded lock can fail, and journal draining
// follows the touch. The rings carry no per-sample time, so these are bounded per restart and not
// once. The flash journal does not have this property: every record carries its absolute wall-clock
// bucket.
//
// The booking covers the stretch the record measures, and that part rests on the seal and on the
// record. Ordinary pending folds leave the seal intact; adoption, resets and source bookkeeping
// also reseal it. A valid seal does not establish sample age. A boot that never committed can leave
// intact samples from a moment long gone: a safe-mode latch (no producer signs the record), a
// crash loop whose every boot dies inside one bucket (each adoption would book the same samples
// again). Two refusals keep adoption to what the booking can account for, and a third one to what
// can be measured at all, each a named verdict (HistoryRestore):
//
//   safe_mode      — no producer runs, nothing would age or commit the rings.
//   not_committed  — a sealed counter of boots that adopted the rings and committed nothing since;
//                    one such boot is already an unobserved stretch of unknown length, so ≥ 1
//                    refuses.
//   stale_commit   — the name predates the booking rule and now means UNMEASURABLE: the separately
//                    sealed LIVENESS record (below) cannot say how old the X10A raster's newest
//                    sample is, because it does not verify or because the raster holds samples but
//                    recorded no commit. A measurable stall is booked, never refused. HomeHub and
//                    ENV III are independent rasters: an unmeasurable one retires its own rings
//                    alone.
//
// A refusal costs nothing the flash journal holds: it restores by wall clock as it always did. It
// is a loss where the journal holds nothing — a board without the upper-flash `history` partition,
// the board and circulation trends while no X10A identity has been detected and saved (the journal
// scopes the X10A source by it), and a board that never syncs SNTP — and for the open or still
// undrained bucket. That is the fail-closed trade: a refused copy is empty, a misdated one is
// wrong.
//
// For the flash path the downtime is UNBOUNDED (a board can sit powered off for a week), so every
// record carries its absolute wall-clock bucket and the last 24 hours are SPLICED behind whatever
// the current boot has already recorded — see history_splice below. A record whose anchor is
// missing is never written: there is no defensible place to put it, and putting it at "now" would
// slide a week-old curve onto today.
//
// ── Why catalog manifests, not just a CRC ───────────────────────────────────────────────────────
// A dense record addresses rings by INDEX. Insert a trend or reorder two and index 12 stops meaning
// what it meant when the bytes were written — so a valid payload CRC alone could hand the expansion
// valve's day to the DHW tank. Every catalog generation therefore has a fingerprint, while a rare
// manifest record stores one stable semantic id per index. Restore maps ids rather than positions:
// unchanged series survive additions/reordering, new series start empty, and a changed semantic id
// invalidates only that series. One known pre-manifest catalog has an explicit, equally fail-closed
// mapping. The five-minute data records stay dense, small and byte-for-byte rollback-readable.
#include "logic/config_store.hpp"   // config_crc32_update — the firmware's ONE CRC implementation
#include "logic/crashinfo.hpp"      // CrashReason — the reset vocabulary, not a second copy of it
#include "logic/env3.hpp"
#include "logic/history.hpp"
#include "logic/homehub_map.hpp"

#include <cstddef>
#include <cstdint>

namespace daik::logic {

// ── Record identity ─────────────────────────────────────────────────────────────────────────────
// The magic is a spelled-out ASCII tag so a hex dump of the region says what it is. The version
// covers the RECORD LAYOUT alone; anything about the trend catalog is the fingerprint's job, which
// is why this number has not had to move for a trend addition and should not be bumped for one.
inline constexpr uint32_t HISTORY_PERSIST_MAGIC   = 0x54534948u;   // "HIST" little-endian
// v2 bound the .noinit HomeHub rings to their target. v3 adds the circulation witness's evidence
// identity to the sealed region (HIST-01/b): a v2 seal cannot name the identity of the circulation
// ring it covers, so it is refused as a whole rather than adopted on trust. v4 seals the count of
// boots that adopted the rings without committing (HIST-03/a), whether the ENV III sensor was
// live (HIST-03/e) and the rounding residual each raster's last booking left (HIST-03/f): a v3 seal
// can say none of them, so it is refused as a whole as well.
inline constexpr uint16_t HISTORY_PERSIST_VERSION = 4;

// ── Flash-journal geometry ──────────────────────────────────────────────────────────────────────
// The official 8 MB table gives the entire upper 4 MiB to history. Flash can clear bits with a
// program operation but can set them again only by erasing a whole 4 KiB sector, so the durable
// shape is a circular APPEND log rather than an in-place snapshot. Each source closes its own
// raster independently and therefore gets its own record: a disabled HomeHub/ENV III can never hold
// X10A persistence hostage.
//
// One record is page-aligned and large enough for the largest source's dense int16 vector. At the
// current 32/13/3 rings this is 256 bytes: sixteen records share one erased sector. If the catalog
// grows past 48 rings in one source the manifest becomes the binding payload and the expression
// moves the format to 512 bytes automatically; the checked 72-hour capacity below then fails before
// a catalog can silently outgrow the reservation.
inline constexpr uint32_t HISTORY_FLASH_PARTITION_OFFSET = 0x400000u;
inline constexpr size_t   HISTORY_FLASH_PARTITION_BYTES = 4u * 1024u * 1024u;
inline constexpr size_t   HISTORY_FLASH_ERASE_BYTES = 4096;
inline constexpr size_t   HISTORY_FLASH_PAGE_BYTES = 256;
inline constexpr size_t   HISTORY_JOURNAL_HEADER_BYTES = 64;
inline constexpr size_t   HISTORY_FLASH_TOTAL_RINGS =
    TREND_COUNT + HOMEHUB_HISTORY_COUNT + ENV3_HISTORY_COUNT;
// The first three ids are the original v1 trend sources.  Checkup extends the SAME append stream
// with one hourly diagnostic bucket; keeping the old ids and wire version intact means an update can
// still restore every existing trend record instead of invalidating the journal it is fixing.
inline constexpr size_t HISTORY_JOURNAL_SOURCE_COUNT = 4;

enum class HistoryJournalSource : uint8_t { X10a = 0, Modbus = 1, Env3 = 2, Checkup = 3 };

inline constexpr size_t history_journal_source_rings(HistoryJournalSource src) {
    switch (src) {
        case HistoryJournalSource::X10a:   return TREND_COUNT;
        case HistoryJournalSource::Modbus: return HOMEHUB_HISTORY_COUNT;
        case HistoryJournalSource::Env3:   return ENV3_HISTORY_COUNT;
        // The diagnostic payload is a byte-for-byte CheckupJournalPayload rather than a dense
        // HistorySample vector.  Its word count is supplied by checkup.cpp's wire contract at the
        // generic header matcher below, avoiding a dependency cycle between the two persist headers.
        case HistoryJournalSource::Checkup: return 0;
    }
    return 0;
}

inline constexpr size_t history_journal_max_source_rings() {
    size_t n = TREND_COUNT;
    if (HOMEHUB_HISTORY_COUNT > n) n = HOMEHUB_HISTORY_COUNT;
    if (ENV3_HISTORY_COUNT > n) n = ENV3_HISTORY_COUNT;
    return n;
}

inline constexpr size_t history_journal_slot_bytes(size_t body_bytes) {
    size_t slot = HISTORY_FLASH_PAGE_BYTES;
    while (slot < body_bytes && slot < HISTORY_FLASH_ERASE_BYTES) slot *= 2;
    return slot;
}

inline constexpr size_t HISTORY_JOURNAL_MAX_SOURCE_RINGS = history_journal_max_source_rings();
inline constexpr size_t HISTORY_JOURNAL_SLOT_BYTES = history_journal_slot_bytes(
    HISTORY_JOURNAL_HEADER_BYTES + HISTORY_JOURNAL_MAX_SOURCE_RINGS * sizeof(uint32_t));
inline constexpr size_t HISTORY_JOURNAL_SLOTS_PER_SECTOR =
    HISTORY_FLASH_ERASE_BYTES / HISTORY_JOURNAL_SLOT_BYTES;
inline constexpr size_t HISTORY_JOURNAL_SLOT_COUNT =
    HISTORY_FLASH_PARTITION_BYTES / HISTORY_JOURNAL_SLOT_BYTES;

inline constexpr uint32_t HISTORY_JOURNAL_MAGIC = 0x4c4e4a48u;       // "HJNL" little-endian
inline constexpr uint16_t HISTORY_JOURNAL_VERSION = 1;
inline constexpr uint32_t HISTORY_JOURNAL_ERASED = 0xffffffffu;
inline constexpr uint32_t HISTORY_JOURNAL_COMMITTED = 0x54494d43u;   // "CMIT" little-endian
inline constexpr uint8_t  HISTORY_JOURNAL_FLAG_TARGET_SCOPED = 0x01u;
inline constexpr uint8_t  HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST = 0x02u;

// A manifest carries uint32 semantic ids instead of int16 samples. It uses the same physical slot,
// so adding a trend cannot silently overflow the manifest even when the dense vector still fits.
inline constexpr size_t HISTORY_JOURNAL_PAYLOAD_BYTES =
    HISTORY_JOURNAL_SLOT_BYTES - HISTORY_JOURNAL_HEADER_BYTES;
inline constexpr size_t HISTORY_MANIFEST_MAX_IDS =
    HISTORY_JOURNAL_PAYLOAD_BYTES / sizeof(uint32_t);
inline constexpr size_t HISTORY_MANIFEST_CACHE_PER_SOURCE = 4;
inline constexpr size_t HISTORY_MANIFEST_REFRESH_BUCKETS = HISTORY_SAMPLES;  // at least daily

// Wire format. `commit` remains erased while the body is programmed and is changed to CMIT in one
// final 1->0 write. A torn body or torn commit is therefore never mistaken for a valid record.
struct HistoryJournalHeader {
    uint32_t magic;          //  0
    uint16_t version;        //  4
    uint8_t  source;         //  6 — HistoryJournalSource
    uint8_t  flags;          //  7 — zero in v1
    uint32_t catalog_fp;     //  8
    uint32_t crc;            // 12 — normalised header + `value_count` payload elements
    uint32_t commit;         // 16 — written LAST
    uint16_t value_count;    // 20
    uint16_t slot_bytes;     // 22
    uint64_t sequence;       // 24 — global append order, starts at one
    int64_t  bucket;         // 32 — absolute bucket of these values
    uint32_t dt_s;           // 40
    uint16_t rings[3];       // 44 — all source widths pin dense-vector addressing
    uint16_t reserved;       // 50
    uint8_t  pad[12];        // 52
};
static_assert(sizeof(HistoryJournalHeader) == HISTORY_JOURNAL_HEADER_BYTES,
              "history journal header is a 64-byte wire format");
static_assert(offsetof(HistoryJournalHeader, commit) == 16,
              "commit offset is part of the power-loss protocol");

inline bool history_journal_header_matches(const HistoryJournalHeader& h, uint32_t identity_fp,
                                           uint16_t value_count, uint32_t dt_s) {
    if (h.magic != HISTORY_JOURNAL_MAGIC || h.version != HISTORY_JOURNAL_VERSION ||
        h.commit != HISTORY_JOURNAL_COMMITTED || h.flags != 0 || h.catalog_fp != identity_fp ||
        h.slot_bytes != HISTORY_JOURNAL_SLOT_BYTES || h.dt_s != dt_s ||
        h.sequence == 0 || h.bucket == INT64_MIN || h.source >= HISTORY_JOURNAL_SOURCE_COUNT ||
        h.rings[0] == 0 || h.rings[0] > HISTORY_MANIFEST_MAX_IDS ||
        h.rings[1] == 0 || h.rings[1] > HISTORY_MANIFEST_MAX_IDS ||
        h.rings[2] == 0 || h.rings[2] > HISTORY_MANIFEST_MAX_IDS)
        return false;
    return h.value_count == value_count && value_count > 0 &&
           static_cast<size_t>(value_count) * sizeof(HistorySample) <=
               HISTORY_JOURNAL_SLOT_BYTES - HISTORY_JOURNAL_HEADER_BYTES;
}

// Physical head discovery must retain sequence numbers of intact diagnostic records from a
// previous payload generation. Interpretation separately requires the current fingerprint/width.
inline bool history_journal_checkup_header_structural_matches(const HistoryJournalHeader& h,
                                                              uint32_t                    dt_s) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) && h.catalog_fp != 0 &&
           history_journal_header_matches(h, h.catalog_fp, h.value_count, dt_s);
}

inline bool history_journal_rings_match_current(const HistoryJournalHeader& h) {
    return h.rings[0] == TREND_COUNT && h.rings[1] == HOMEHUB_HISTORY_COUNT &&
           h.rings[2] == ENV3_HISTORY_COUNT;
}

// Compatibility wrapper for the three original dense trend sources.  Existing host tests and old
// v1 records keep exactly their former contract; the fourth source must state its own payload width
// and one-hour raster explicitly through the overload above.
inline bool history_journal_header_matches(const HistoryJournalHeader& h, uint32_t catalog_fp) {
    if (h.source >= static_cast<uint8_t>(HistoryJournalSource::Checkup) ||
        h.source == static_cast<uint8_t>(HistoryJournalSource::Modbus))
        return false;  // HomeHub records additionally require the configured-target fingerprint
    return history_journal_rings_match_current(h) && history_journal_header_matches(
        h, catalog_fp,
        static_cast<uint16_t>(history_journal_source_rings(
            static_cast<HistoryJournalSource>(h.source))), HISTORY_DT_S);
}

inline void history_journal_set_scope(HistoryJournalHeader& h, uint32_t scope_fp) {
    h.pad[0] = static_cast<uint8_t>(scope_fp);
    h.pad[1] = static_cast<uint8_t>(scope_fp >> 8);
    h.pad[2] = static_cast<uint8_t>(scope_fp >> 16);
    h.pad[3] = static_cast<uint8_t>(scope_fp >> 24);
}

inline uint32_t history_journal_scope(const HistoryJournalHeader& h) {
    return static_cast<uint32_t>(h.pad[0]) | (static_cast<uint32_t>(h.pad[1]) << 8) |
           (static_cast<uint32_t>(h.pad[2]) << 16) |
           (static_cast<uint32_t>(h.pad[3]) << 24);
}

inline void history_journal_set_schema_fingerprint(HistoryJournalHeader& h, uint32_t fp) {
    h.pad[4] = static_cast<uint8_t>(fp);
    h.pad[5] = static_cast<uint8_t>(fp >> 8);
    h.pad[6] = static_cast<uint8_t>(fp >> 16);
    h.pad[7] = static_cast<uint8_t>(fp >> 24);
}

inline uint32_t history_journal_schema_fingerprint(const HistoryJournalHeader& h) {
    return static_cast<uint32_t>(h.pad[4]) | (static_cast<uint32_t>(h.pad[5]) << 8) |
           (static_cast<uint32_t>(h.pad[6]) << 16) |
           (static_cast<uint32_t>(h.pad[7]) << 24);
}

// ── The circulation witness's evidence identity (HIST-01/b) ─────────────────────────────────────
// X10A source index 31 (`circulation_state`) is not an X10A reading: it is the external MQTT power
// witness of the DHW circulation pump, and WHICH witness that was is a configuration fact the X10A
// target fingerprint knows nothing about. Remapping the topic or the thresholds, or switching the
// diagnostics consent, retires the RAM samples at once (history_circulation_reset) — but an X10A
// record is scoped by the X10A target alone, so the retired topic's samples sat in the journal
// under a scope that still matched and were spliced back after the next boot. The identity below
// closes that: a record names the witness its circulation COLUMN was recorded under, and the column
// is restored only for an exact match with the current, non-zero identity. Every other X10A column
// of the same record is unaffected.
//
// Where it lives, and why that is rollback-safe. The header has 12 spare bytes, `pad` (header
// offsets 52..63): pad[0..3] (offsets 52..55) carry the target scope of an X10A or HomeHub data
// record, pad[4..7] (56..59) the schema fingerprint of a catalog MANIFEST, and nothing in any build
// reads or writes pad[8..11] (60..63; not the `catalog_fp` at offset 8). The writer fills the
// whole slot with 0xff before assigning fields, so every record ever written holds 0xffffffff
// there. The previous firmware's acceptance reads only magic, version, commit, catalog, slot size,
// raster, sequence, bucket, source, flags, rings and the scope in pad[0..3];
// history_journal_crc_bytes() hashes the whole header as stored (it normalises only `crc` and
// `commit`), so a record that carries the field verifies in the old reader exactly as it did in the
// writer. A record from before the field reads back as 0xffffffff, which is never a valid identity.
inline constexpr uint32_t HISTORY_CIRCULATION_NONE   = 0;           // not configured / consented
inline constexpr uint32_t HISTORY_CIRCULATION_LEGACY = 0xffffffffu; // erased pad: pre-field record

inline void history_journal_set_circulation_identity(HistoryJournalHeader& h, uint32_t identity) {
    h.pad[8]  = static_cast<uint8_t>(identity);
    h.pad[9]  = static_cast<uint8_t>(identity >> 8);
    h.pad[10] = static_cast<uint8_t>(identity >> 16);
    h.pad[11] = static_cast<uint8_t>(identity >> 24);
}

inline uint32_t history_journal_circulation_identity(const HistoryJournalHeader& h) {
    return static_cast<uint32_t>(h.pad[8]) | (static_cast<uint32_t>(h.pad[9]) << 8) |
           (static_cast<uint32_t>(h.pad[10]) << 16) | (static_cast<uint32_t>(h.pad[11]) << 24);
}

// May the circulation column of a record stamped `record_identity` be restored? Only for an exact
// match with the current non-zero identity, and never while a circulation reset is pending (the
// ring still holds the retired witness's samples until the reset is consumed). A record without the
// field (0xffffffff), one written while no witness was configured (0) and one of another witness
// all fail closed.
inline constexpr bool history_circulation_restore_allowed(uint32_t record_identity,
                                                          uint32_t current_identity,
                                                          bool     reset_pending) {
    return !reset_pending && current_identity != HISTORY_CIRCULATION_NONE &&
           current_identity != HISTORY_CIRCULATION_LEGACY && record_identity == current_identity;
}

// Is X10A ring `index` the circulation witness's? The only X10A column whose samples come from
// somewhere other than the heat pump's own bus or the board.
inline constexpr bool history_trend_is_circulation(size_t index) {
    return index < TREND_COUNT && TRENDS[index].kind == TrendKind::CirculationState;
}

// May X10A column `index` of a record stamped `record_identity` be restored? Every column but the
// circulation one, which also needs the record's witness to be the current one. A record from
// before the field existed therefore still restores all 31 other columns — the identity refuses
// one column, not the record.
inline constexpr bool history_x10a_column_restorable(size_t index, uint32_t record_identity,
                                                     uint32_t current_identity,
                                                     bool     reset_pending) {
    return !history_trend_is_circulation(index) ||
           history_circulation_restore_allowed(record_identity, current_identity, reset_pending);
}

// Structural validity which is deliberately independent of THIS build's catalog. It lets the scan
// find the physical head and CRC-check an older dense vector before deciding whether a manifest or
// an explicit legacy map can interpret it. Restore eligibility is a separate, stricter question.
inline bool history_journal_trend_header_structural_matches(const HistoryJournalHeader& h) {
    if (h.magic != HISTORY_JOURNAL_MAGIC || h.version != HISTORY_JOURNAL_VERSION ||
        h.commit != HISTORY_JOURNAL_COMMITTED || h.catalog_fp == 0 ||
        h.slot_bytes != HISTORY_JOURNAL_SLOT_BYTES || h.dt_s != HISTORY_DT_S ||
        h.sequence == 0 || h.bucket == INT64_MIN ||
        h.source >= static_cast<uint8_t>(HistoryJournalSource::Checkup) ||
        (h.flags & ~HISTORY_JOURNAL_FLAG_TARGET_SCOPED) != 0)
        return false;
    const auto src = static_cast<HistoryJournalSource>(h.source);
    if ((src == HistoryJournalSource::X10a || src == HistoryJournalSource::Modbus) !=
        ((h.flags & HISTORY_JOURNAL_FLAG_TARGET_SCOPED) != 0))
        return false;
    if ((src == HistoryJournalSource::X10a || src == HistoryJournalSource::Modbus) &&
        history_journal_scope(h) == 0)
        return false;
    if (h.value_count == 0 || h.value_count > HISTORY_JOURNAL_PAYLOAD_BYTES / sizeof(HistorySample))
        return false;
    for (size_t i = 0; i < 3; ++i)
        if (h.rings[i] == 0 || h.rings[i] > HISTORY_MANIFEST_MAX_IDS) return false;
    return h.value_count == h.rings[h.source];
}

inline bool history_journal_trend_layout_matches(const HistoryJournalHeader& h,
                                                 uint32_t catalog_fp,
                                                 uint16_t x10a_rings,
                                                 uint16_t modbus_rings,
                                                 uint16_t env3_rings) {
    if (!history_journal_trend_header_structural_matches(h) || h.catalog_fp != catalog_fp) return false;
    const uint16_t rings[3] = {x10a_rings, modbus_rings, env3_rings};
    for (size_t i = 0; i < 3; ++i)
        if (h.rings[i] != rings[i]) return false;
    return h.value_count == rings[h.source];
}

inline bool history_journal_manifest_header_matches(const HistoryJournalHeader& h) {
    if (h.magic != HISTORY_JOURNAL_MAGIC || h.version != HISTORY_JOURNAL_VERSION ||
        h.commit != HISTORY_JOURNAL_COMMITTED || h.flags != HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST ||
        h.catalog_fp == 0 || h.slot_bytes != HISTORY_JOURNAL_SLOT_BYTES ||
        h.dt_s != HISTORY_DT_S || h.sequence == 0 || h.bucket == INT64_MIN ||
        h.source >= static_cast<uint8_t>(HistoryJournalSource::Checkup) ||
        h.value_count == 0 || h.value_count > HISTORY_MANIFEST_MAX_IDS ||
        history_journal_schema_fingerprint(h) == 0)
        return false;
    for (size_t i = 0; i < 3; ++i)
        if (h.rings[i] == 0 || h.rings[i] > HISTORY_MANIFEST_MAX_IDS) return false;
    return h.value_count == h.rings[h.source];
}

inline size_t history_journal_payload_bytes(const HistoryJournalHeader& h) {
    const size_t width = h.flags == HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST
        ? sizeof(uint32_t) : sizeof(HistorySample);
    return static_cast<size_t>(h.value_count) * width;
}

// Structural/CRC-independent validity for a target-scoped source, without choosing the currently
// configured target. Journal head discovery must see records from old targets too; otherwise it can
// reuse their global sequence numbers. Scope equality belongs only to restore/index selection.
inline bool history_journal_header_matches_scoped_layout(const HistoryJournalHeader& h,
                                                         uint32_t catalog_fp,
                                                         HistoryJournalSource source) {
    if ((source != HistoryJournalSource::X10a && source != HistoryJournalSource::Modbus) ||
        h.source != static_cast<uint8_t>(source) ||
        h.flags != HISTORY_JOURNAL_FLAG_TARGET_SCOPED || history_journal_scope(h) == 0)
        return false;
    HistoryJournalHeader structural = h;
    structural.flags = 0;
    return history_journal_rings_match_current(structural) && history_journal_header_matches(
        structural, catalog_fp,
        static_cast<uint16_t>(history_journal_source_rings(source)), HISTORY_DT_S);
}

inline bool history_journal_header_matches_scoped(const HistoryJournalHeader& h,
                                                  uint32_t catalog_fp, uint32_t scope_fp) {
    return scope_fp != 0 && history_journal_scope(h) == scope_fp &&
           history_journal_header_matches_scoped_layout(
               h, catalog_fp, HistoryJournalSource::Modbus);
}

inline bool history_journal_header_matches_x10a_scoped(const HistoryJournalHeader& h,
                                                       uint32_t catalog_fp, uint32_t scope_fp) {
    return scope_fp != 0 && history_journal_scope(h) == scope_fp &&
           history_journal_header_matches_scoped_layout(
               h, catalog_fp, HistoryJournalSource::X10a);
}

// CRC normalises the two fields changed after the body was assembled. This makes the exact same
// helper usable before the commit write and after reading the committed header back.
inline uint32_t history_journal_crc_bytes(HistoryJournalHeader h, const void* payload,
                                          size_t payload_bytes) {
    h.crc = 0;
    h.commit = HISTORY_JOURNAL_ERASED;
    uint32_t crc = config_crc32_update(CONFIG_CRC32_INIT,
                                       reinterpret_cast<const uint8_t*>(&h), sizeof(h));
    if (payload && payload_bytes)
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(payload), payload_bytes);
    return config_crc32_final(crc);
}

inline uint32_t history_journal_crc(HistoryJournalHeader h, const HistorySample* values,
                                    size_t count) {
    return history_journal_crc_bytes(h, values, count * sizeof(HistorySample));
}

inline constexpr size_t history_journal_slot_offset(size_t slot) {
    return slot * HISTORY_JOURNAL_SLOT_BYTES;
}

inline constexpr size_t history_journal_sector_first_slot(size_t slot) {
    return (slot / HISTORY_JOURNAL_SLOTS_PER_SECTOR) * HISTORY_JOURNAL_SLOTS_PER_SECTOR;
}

inline constexpr size_t history_journal_next_sector_slot(size_t slot) {
    return (history_journal_sector_first_slot(slot) + HISTORY_JOURNAL_SLOTS_PER_SECTOR) %
           HISTORY_JOURNAL_SLOT_COUNT;
}

// A torn program in the middle of a sector cannot be retried in place and its sector cannot be
// erased because older committed slots precede it. An erased candidate is usable; a non-erased
// sector-first candidate is reusable after erasing that sector; only a non-erased MID-sector slot
// skips forward. Kept pure so the power-loss branch is host-tested rather than device-only.
inline constexpr size_t history_journal_write_slot(size_t next_slot, bool candidate_erased) {
    return candidate_erased || next_slot % HISTORY_JOURNAL_SLOTS_PER_SECTOR == 0
        ? next_slot : history_journal_next_sector_slot(next_slot);
}

// A slot whose erase, program or readback fails is retried once — a transient SPI-flash error is
// real — and then abandoned together with the rest of its sector. Without a limit the same slot was
// re-erased, re-programmed and re-logged on EVERY poll tick (the diag ring is only 6 KB, so one bad
// sector evicted every other line) while the cursor never advanced and nothing after it was ever
// persisted. The next sector's first slot is the only safe landing: the sector the failure is in
// may hold the head's committed predecessors, and that one is erased by the ordinary rotation
// anyway.
//
// Abandoning is itself destructive, though: the landing sector is ERASED before the next program
// attempt, which retires the oldest slots of the journal. A fault that is not local to one sector
// (the erase succeeds, the program or its readback fails everywhere) would therefore carry the
// cursor round the whole ring, erasing every sector on the way: one lap is the sector count times
// HISTORY_JOURNAL_SLOT_RETRY_LIMIT poll ticks, and afterwards no retained history is left. One
// failure episode — the failures since the last successful append — may thus abandon at most
// HISTORY_JOURNAL_MAX_ABANDONED_SECTORS. Beyond that the cursor stays on the failing slot and the
// writer is PAUSED: one attempt per HISTORY_JOURNAL_PAUSED_RETRY_S until an append succeeds. The
// erase damage of an episode is bounded by that cap (one landing sector per abandon), however
// long the fault lasts, and a fault that does clear heals by itself.
inline constexpr size_t   HISTORY_JOURNAL_SLOT_RETRY_LIMIT      = 2;
inline constexpr size_t   HISTORY_JOURNAL_MAX_ABANDONED_SECTORS = 2;
inline constexpr uint32_t HISTORY_JOURNAL_PAUSED_RETRY_S        = 60;

inline constexpr size_t history_journal_slot_after_failure(size_t slot,
                                                           size_t consecutive_failures) {
    return consecutive_failures >= HISTORY_JOURNAL_SLOT_RETRY_LIMIT
               ? history_journal_next_sector_slot(slot)
               : slot;
}

// The decision after one failed append at `slot`. `consecutive_failures` counts the failures at
// that slot (this one included), `abandoned_in_episode` the sectors this episode has abandoned so
// far. Once the budget is spent every failure pauses: the throttle (history_journal_retry_due)
// already makes each later attempt a retry, so there is no immediate second try.
struct HistoryJournalFailureStep {
    size_t next_slot; // where the next append attempt goes
    bool   paused;    // the abandon budget is spent: stay on `next_slot` and retry slowly
};
inline constexpr HistoryJournalFailureStep
history_journal_failure_step(size_t slot, size_t consecutive_failures,
                             size_t abandoned_in_episode) {
    if (abandoned_in_episode >= HISTORY_JOURNAL_MAX_ABANDONED_SECTORS) return {slot, true};
    return {history_journal_slot_after_failure(slot, consecutive_failures), false};
}

// May the writer attempt an append now? Always, unless it is paused: then at most one attempt per
// HISTORY_JOURNAL_PAUSED_RETRY_S of the monotonic clock since the previous attempt.
// `last_attempt_us` is INT64_MIN when no attempt has been recorded.
inline constexpr bool history_journal_retry_due(bool paused, int64_t now_us,
                                                int64_t last_attempt_us) {
    if (!paused || last_attempt_us == INT64_MIN) return true;
    return now_us - last_attempt_us >=
           static_cast<int64_t>(HISTORY_JOURNAL_PAUSED_RETRY_S) * 1000000;
}

// A capacity guard for the CURRENT catalog. The journal retains at least 72 hours even if all three
// trend sources close every five-minute bucket and checkup closes every hourly bucket. The remaining
// slots are wear reserve: records are ignored by age, never erased merely because they passed 72 h.
inline constexpr size_t HISTORY_FLASH_FUTURE_HOURS = 72;
inline constexpr size_t HISTORY_FLASH_FUTURE_SAMPLES =
    HISTORY_FLASH_FUTURE_HOURS * 60u * 60u / HISTORY_DT_S;
inline constexpr size_t HISTORY_FLASH_FUTURE_RECORDS =
    HISTORY_FLASH_FUTURE_SAMPLES * 3u + HISTORY_FLASH_FUTURE_HOURS;
static_assert(HISTORY_FLASH_FUTURE_SAMPLES == 864,
              "72 hours at the five-minute raster must contain 864 samples per ring");
static_assert(HISTORY_JOURNAL_SLOT_BYTES <= HISTORY_FLASH_ERASE_BYTES &&
              HISTORY_FLASH_ERASE_BYTES % HISTORY_JOURNAL_SLOT_BYTES == 0,
              "journal slots must divide one independently erasable sector");
static_assert(HISTORY_JOURNAL_HEADER_BYTES +
                  HISTORY_JOURNAL_MAX_SOURCE_RINGS * sizeof(HistorySample) <=
              HISTORY_JOURNAL_SLOT_BYTES,
              "the largest dense source vector must fit one journal slot");
static_assert(TREND_COUNT <= HISTORY_MANIFEST_MAX_IDS &&
              HOMEHUB_HISTORY_COUNT <= HISTORY_MANIFEST_MAX_IDS &&
              ENV3_HISTORY_COUNT <= HISTORY_MANIFEST_MAX_IDS,
              "each source catalog must fit one manifest slot");
static_assert(HISTORY_JOURNAL_SLOT_COUNT <= UINT16_MAX,
              "restore indexes store physical slot numbers as uint16_t");
static_assert(HISTORY_JOURNAL_SLOT_COUNT >= HISTORY_FLASH_FUTURE_RECORDS +
                  3 * (HISTORY_FLASH_FUTURE_SAMPLES / HISTORY_MANIFEST_REFRESH_BUCKETS + 1),
              "the history partition must retain 72 h with every source active");

// ── Which resets leave DRAM intact ──────────────────────────────────────────────────────────────
// An ALLOW list, and everything unrecognised is refused. The direction matters: a wrongly-refused
// restore costs an empty chart, while a wrongly-accepted one adopts whatever bytes happened to be in
// RAM as a day of plant readings. The CRC would catch nearly all of that — "nearly" is the reason
// this check exists in front of it.
//
// POWERON is the obvious no. BROWNOUT and PWR_GLITCH are the interesting ones: the supply dipped, so
// the contents are not proven intact even though the chip never lost power outright — refused rather
// than trusted to the CRC. DEEPSLEEP powers DRAM down; this firmware never sleeps, so it cannot
// occur, and it is listed as refused rather than left to the default so the reasoning is on record.
inline constexpr bool history_reset_preserves_ram(uint32_t reason) {
    switch (static_cast<CrashReason>(reason)) {
    case CrashReason::SW:    // esp_restart(); the later seal decides build compatibility
    case CrashReason::PANIC: // the crash we most want the preceding hours for
    case CrashReason::INT_WDT:
    case CrashReason::TASK_WDT:
    case CrashReason::OTHER_WDT:
    case CrashReason::CPU_LOCKUP:
    case CrashReason::EXT: // reset pin — the board stayed powered
    case CrashReason::USB:
    case CrashReason::JTAG:
    case CrashReason::SDIO:
        return true;
    case CrashReason::POWERON:
    case CrashReason::BROWNOUT:
    case CrashReason::PWR_GLITCH:
    case CrashReason::DEEPSLEEP:
    case CrashReason::EFUSE:
    case CrashReason::UNKNOWN:
    default:
        return false;
    }
}

// ── The verdict ─────────────────────────────────────────────────────────────────────────────────
// Named outcomes rather than a bool, because every one of them is a different thing to say on /diag
// and a different thing for a person to do about it. "The catalog moved" after an OTA is expected
// and uninteresting; "the CRC failed" on a board that was not power-cycled is a memory fault worth
// knowing about.
enum class HistoryRestore : uint8_t {
    Accept,
    NoRecord,     // magic absent — a fresh board, or DRAM that was never written
    PowerCycle,   // the reset reason does not preserve RAM
    WrongVersion, // this build's record layout differs
    WrongCatalog, // TRENDS changed — indices no longer mean the same rows
    BadCrc,       // present and current, but not intact
    SafeMode,     // latched boot-loop recovery: no producer runs, so nothing ages or commits
    NotCommitted, // intact, but its boot adopted it and committed nothing of its own since
    StaleCommit,  // intact, but the liveness record cannot measure the X10A raster's unobserved
                  // stretch (a name that predates booking: it now means "unmeasurable")
};

inline constexpr const char* history_restore_slug(HistoryRestore r) {
    switch (r) {
        case HistoryRestore::Accept:       return "accept";
        case HistoryRestore::NoRecord:     return "no_record";
        case HistoryRestore::PowerCycle:   return "power_cycle";
        case HistoryRestore::WrongVersion: return "wrong_version";
        case HistoryRestore::WrongCatalog: return "wrong_catalog";
        case HistoryRestore::BadCrc:       return "bad_crc";
        case HistoryRestore::SafeMode:
            return "safe_mode";
        case HistoryRestore::NotCommitted:
            return "not_committed";
        case HistoryRestore::StaleCommit:
            return "stale_commit";
    }
    return "unknown";
}

// Order is deliberate and is the reason this is a function rather than a chain of ifs at the call
// site: the CHEAPEST and most explanatory refusal must win. A power-cycled board holds garbage that
// will usually fail the magic check too, and reporting "bad_crc" for it would send a reader looking
// for a memory fault that is not there.
//
// SAFE MODE comes first and is not about the bytes at all, for the reason checkup_persist.hpp and
// state_dwell.hpp give: it starts no producer, so an adopted ring would sit frozen while the latch
// holds. The two guards about AGE come LAST, after the CRC, because they read sealed state — a
// counter inside the seal, a liveness record with its own seal — that means nothing on a record
// that failed its checks. Between them the counter is the cheaper and more specific statement
// (this boot adopted and never committed), so it wins over an unmeasurable raster. The two guards'
// inputs default to the old unguarded behaviour so a caller that predates them compiles; the
// firmware passes both explicitly, and the tests pin each refusal. `bookable` is the liveness
// record's answer for the X10A raster: it can measure the stretch the adoption has to book (a
// stalled raster is measurable and is booked; only an unreadable record, or a raster with samples
// and no recorded commit, is not).
inline constexpr HistoryRestore
history_restore_verdict(uint32_t reset_reason, uint32_t magic, uint16_t version,
                        uint32_t catalog_fp, uint32_t want_catalog_fp, uint32_t stored_crc,
                        uint32_t actual_crc, bool safe_mode = false,
                        uint32_t boots_since_commit = 0, bool bookable = true) {
    if (safe_mode) return HistoryRestore::SafeMode;
    if (!history_reset_preserves_ram(reset_reason)) return HistoryRestore::PowerCycle;
    if (magic != HISTORY_PERSIST_MAGIC)             return HistoryRestore::NoRecord;
    if (version != HISTORY_PERSIST_VERSION)         return HistoryRestore::WrongVersion;
    if (catalog_fp != want_catalog_fp)              return HistoryRestore::WrongCatalog;
    if (stored_crc != actual_crc)                   return HistoryRestore::BadCrc;
    if (boots_since_commit != 0) return HistoryRestore::NotCommitted;
    if (!bookable) return HistoryRestore::StaleCommit;
    return HistoryRestore::Accept;
}

// The sealed count of boots that adopted a region and have not committed since. Saturating, so a
// counter at its maximum can never wrap to the "nothing pending" value. Shared with the checkup's
// record, which uses a wider field.
template <typename T> inline constexpr T history_counter_next(T n) {
    return n == static_cast<T>(~static_cast<T>(0)) ? n : static_cast<T>(n + 1);
}

// ── The catalog fingerprint ─────────────────────────────────────────────────────────────────────
// Feed a NUL-terminated string into a running CRC, terminator included — so "ab","c" and "a","bc"
// cannot collide, which they would if the separator were dropped.
inline uint32_t history_fp_str(uint32_t crc, const char* s) {
    const uint8_t nul = 0;
    if (s) {
        size_t n = 0;
        while (s[n]) n++;
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(s), n);
    }
    return config_crc32_update(crc, &nul, 1);
}

inline uint32_t history_fp_u32(uint32_t crc, uint32_t v) {
    const uint8_t b[4] = { static_cast<uint8_t>(v), static_cast<uint8_t>(v >> 8),
                           static_cast<uint8_t>(v >> 16), static_cast<uint8_t>(v >> 24) };
    return config_crc32_update(crc, b, 4);
}

// ── The liveness record: how long ago did the newest commit happen, as the device last saw it? ──
// The main seal answers "are these bytes intact"; it cannot answer "how old is the newest sample
// they hold". Ordinary pending folds leave it intact; commits, adoption, resets and source
// bookkeeping reseal it. Intact samples can still be old. This small record is the other half.
// It is written by the boot that owns the
// rings, outside the ~30 KB seal and under a CRC of its own, so updating it costs a few dozen bytes
// of CRC rather than the whole region's, which is what lets the poll task refresh it every cycle.
//
// It holds the monotonic instant of the last SIGN OF LIFE (the poll task's cycle, including the
// cycles that skip all work, and the shutdown handler) and, per raster, the monotonic instant of
// the last COMMIT. The three rasters are independent — X10A (which carries the board and the
// circulation witness), HomeHub and ENV III close their buckets in different tasks — so one
// stalled raster is not hidden by a healthy neighbour. Both instants are on the same boot's clock,
// so their difference needs no wall clock and survives the reset.
//
// The difference IS the stall: the poll task signs on every cycle whatever the raster does, and
// the shutdown handler signs at esp_restart, so (last sign of life) − (the boundary the newest
// commit closed) is the time the raster stood still, measured. The adoption books exactly that
// (history_adopt_booking), so a stalled raster is booked rather than refused. The record can
// answer "unmeasurable" only in two ways: it does not verify (damaged or never written DRAM), or a
// raster that holds samples has no recorded commit (or a commit after the last sign of life, which
// no code path writes). Those are the only reasons a raster is refused or retired.
//
// The verdict is PER RASTER, and only the X10A raster refuses the region. It carries the board and
// circulation trends and is fed at the top of every poll cycle, whatever the bus does, so it is the
// one raster that is always meant to be running. HomeHub and ENV III are optional sources that can
// go away without a reboot (a HomeHub disabled by /set_hp leaves its rings frozen, its task gone
// and its pending reset never consumed; a task that failed to start never folds at all). An
// unmeasurable one retires its OWN rings and the verdict stays on the X10A raster, so a source that
// stopped never costs the trends that did not. Only rasters this boot would adopt are weighed at
// all (history_raster_state, `weighed`): a ring that an identity change retires anyway has nothing
// for the record to measure.
inline constexpr uint32_t HISTORY_LIVENESS_MAGIC   = 0x564c4948u; // "HILV" little-endian
inline constexpr uint16_t HISTORY_LIVENESS_VERSION = 1;
inline constexpr size_t   HISTORY_LIVENESS_RASTERS = 3; // X10a, Modbus, Env3 (HistoryJournalSource)

// Plain data on purpose: no member initialisers, so a definition in .noinit emits no initialiser
// image (the reason history.cpp's PersistStore is a union) and the type stays trivially
// constructible. Padding is not part of the CRC.
struct HistoryLiveness {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    int64_t  sign_us;                             // last sign of life; INT64_MIN: none
    int64_t  commit_us[HISTORY_LIVENESS_RASTERS]; // last commit per raster; INT64_MIN: none
    uint32_t crc;
};

// The CRC covers the instants — the fields that change — serialised little-endian into one small
// buffer and hashed in one call: this runs on the poll task every cycle and from the commit paths
// of three other tasks, so it keeps its call chain flat. Magic and version are compared directly
// by history_liveness_valid() and padding is not evidence, so none of them needs to be hashed.
inline uint32_t history_liveness_crc(const HistoryLiveness& r) {
    uint8_t        b[8 + 8 * HISTORY_LIVENESS_RASTERS];
    size_t         n    = 0;
    const uint64_t sign = static_cast<uint64_t>(r.sign_us);
    for (size_t i = 0; i < 8; ++i) b[n++] = static_cast<uint8_t>(sign >> (8 * i));
    for (size_t k = 0; k < HISTORY_LIVENESS_RASTERS; ++k) {
        const uint64_t commit = static_cast<uint64_t>(r.commit_us[k]);
        for (size_t i = 0; i < 8; ++i) b[n++] = static_cast<uint8_t>(commit >> (8 * i));
    }
    return config_crc32_final(config_crc32_update(CONFIG_CRC32_INIT, b, n));
}

inline void history_liveness_seal(HistoryLiveness& r) {
    r.magic    = HISTORY_LIVENESS_MAGIC;
    r.version  = HISTORY_LIVENESS_VERSION;
    r.reserved = 0;
    r.crc      = history_liveness_crc(r);
}

inline bool history_liveness_valid(const HistoryLiveness& r) {
    return r.magic == HISTORY_LIVENESS_MAGIC && r.version == HISTORY_LIVENESS_VERSION &&
           r.crc == history_liveness_crc(r);
}

// A new boot's record: alive now, nothing committed yet. The previous boot's record has already
// been judged by the time this overwrites it.
inline void history_liveness_begin(HistoryLiveness& r, int64_t now_us) {
    r.sign_us = now_us;
    for (size_t i = 0; i < HISTORY_LIVENESS_RASTERS; ++i) r.commit_us[i] = INT64_MIN;
    history_liveness_seal(r);
}

// The device is alive at `now_us`. Never moves backwards: two tasks can touch the record, and the
// later reading is the one that matters.
inline void history_liveness_touch(HistoryLiveness& r, int64_t now_us) {
    if (r.sign_us == INT64_MIN || now_us > r.sign_us) r.sign_us = now_us;
    history_liveness_seal(r);
}

// A raster committed (or was seeded, or adopted) at `commit_us`; INT64_MIN clears it. A commit is
// itself a sign of life.
inline void history_liveness_commit(HistoryLiveness& r, HistoryJournalSource src,
                                    int64_t commit_us) {
    const size_t i = static_cast<size_t>(src);
    if (i >= HISTORY_LIVENESS_RASTERS) return;
    r.commit_us[i] = commit_us;
    if (commit_us != INT64_MIN && (r.sign_us == INT64_MIN || commit_us > r.sign_us))
        r.sign_us = commit_us;
    history_liveness_seal(r);
}

// What the record says about ONE raster.
enum class HistoryRasterState : uint8_t {
    NotWeighed, // holds no sample this boot would adopt: nothing to book, so it is not asked
    Measurable, // the record verifies and the raster recorded a commit: the stretch can be booked
    NoRecord,   // the record does not verify (or never signalled life): nothing can be said
    NoCommit,   // the raster holds samples but recorded no commit, or one after the last sign of
                // life: the record is not one this code wrote, so it measures nothing
};

// Not weighed counts as bookable: a raster without samples has nothing to book or to misdate.
inline constexpr bool history_raster_bookable(HistoryRasterState s) {
    return s == HistoryRasterState::NotWeighed || s == HistoryRasterState::Measurable;
}

// `weighed` says the raster holds samples this boot would ADOPT; the caller decides that, because
// only it knows which rings an identity change retires anyway. A source that is not a raster of
// the record (the checkup's journal source) has no commit instant to measure with. There is no
// staleness bound: how long the raster stood still is what the adoption books.
inline HistoryRasterState history_raster_state(const HistoryLiveness& r, HistoryJournalSource src,
                                               bool weighed) {
    if (!weighed) return HistoryRasterState::NotWeighed;
    const size_t i = static_cast<size_t>(src);
    if (i >= HISTORY_LIVENESS_RASTERS || !history_liveness_valid(r) || r.sign_us == INT64_MIN)
        return HistoryRasterState::NoRecord;
    // `sign >= commit` is established here so the unsigned difference the booking takes later can
    // never be a wrapped one, even for a record from damaged DRAM that still verifies. A negative
    // commit (which includes the "none" sentinel) is not an instant of a monotonic clock either.
    const int64_t commit = r.commit_us[i];
    if (commit < 0 || r.sign_us < commit) return HistoryRasterState::NoCommit;
    return HistoryRasterState::Measurable;
}

// What an adoption does with each raster, decided from the previous boot's record BEFORE the fresh
// one overwrites it. The X10A raster alone decides the region (`region_bookable` is the verdict's
// `bookable`): an unmeasurable one refuses everything as stale_commit. An unmeasurable HomeHub or
// ENV III raster retires only its own rings and leaves the verdict where the X10A raster put it,
// so an optional source that stopped (disabled without a reboot, a task that never started) cannot
// cost the trends that did not. `weighed[i]` is raster i's rings holding samples this boot would
// adopt.
struct HistoryRasterPlan {
    HistoryRasterState state[HISTORY_LIVENESS_RASTERS];
    bool               region_bookable;
    bool               retire_modbus;
    bool               retire_env3;
};

inline HistoryRasterPlan history_raster_plan(const HistoryLiveness& r,
                                             const bool (&weighed)[HISTORY_LIVENESS_RASTERS]) {
    constexpr size_t  kX10a   = static_cast<size_t>(HistoryJournalSource::X10a);
    constexpr size_t  kModbus = static_cast<size_t>(HistoryJournalSource::Modbus);
    constexpr size_t  kEnv3   = static_cast<size_t>(HistoryJournalSource::Env3);
    HistoryRasterPlan p{};
    for (size_t i = 0; i < HISTORY_LIVENESS_RASTERS; ++i)
        p.state[i] = history_raster_state(r, static_cast<HistoryJournalSource>(i), weighed[i]);
    p.region_bookable = history_raster_bookable(p.state[kX10a]);
    p.retire_modbus   = !history_raster_bookable(p.state[kModbus]);
    p.retire_env3     = !history_raster_bookable(p.state[kEnv3]);
    return p;
}

// ── ENV III has no producer of its own while it is disabled ─────────────────────────────────────
// A disabled sensor starts no task and nothing advances its raster, so its ring is frozen. Adopting
// a frozen ring would treat it as if it had been fed until the reset, and the journal writer would
// then append the same samples under the recent buckets — which a later power cycle restores from
// flash as if they had been measured there. The ring is therefore believed only if the sensor was
// live in the boot that sealed it AND is live now, and the journal is written only for a ring this
// boot actually fed. "Live" is the producer's existence: configured, supported by the board and not
// in safe mode.
inline constexpr bool history_env3_ring_adoptable(bool sealed_live, bool live_now) {
    return sealed_live && live_now;
}

inline constexpr bool history_env3_append_allowed(bool live_now, bool fed_this_boot) {
    return live_now && fed_this_boot;
}

// Neither sentinel (0 = no witness, 0xffffffff = a record from before the field) is ever produced
// as the identity of a real witness: a hash that lands on one is moved off it.
inline constexpr uint32_t history_circulation_identity_clamp(uint32_t hash) {
    return hash == HISTORY_CIRCULATION_NONE || hash == HISTORY_CIRCULATION_LEGACY ? 1u : hash;
}

// The identity of the witness a configuration defines: every field that decides WHICH power stream
// the circulation samples were derived from and HOW (topic, the JSON paths into it, the freshness
// bound, the ON/OFF thresholds and their confirmation time), plus the diagnostics consent, which
// is the opt-in boundary for collecting it at all (each transition advances the generation, so the
// evidence of one consent interval can never be restored into another). Exactly the set
// http_config.cpp's set_circulation treats as an evidence-mapping change, and nothing else: the
// display name and every unrelated setting leave it alone, and so does the MQTT broker connection
// (a broker change reconnects the same topic without retiring the live ring, so the stored one
// follows the same rule). Zero when the source is not configured or not consented — no witness
// exists, so nothing may be restored.
//
// Templated on the configuration type only so this header need not name Config; `c` is a
// daik::Config.
template <typename Cfg> inline uint32_t history_circulation_identity(const Cfg& c) {
    if (!c.diagnostics_enabled || c.circulation_topic.empty()) return HISTORY_CIRCULATION_NONE;
    uint32_t crc = CONFIG_CRC32_INIT;
    crc          = history_fp_u32(crc, 0x43495231u); // "CIR1" circulation-identity contract
    crc          = history_fp_u32(crc, c.diagnostics_generation);
    crc          = history_fp_str(crc, c.circulation_topic.c_str());
    crc          = history_fp_str(crc, c.circulation_power_path.c_str());
    crc          = history_fp_str(crc, c.circulation_time_path.c_str());
    crc          = history_fp_u32(crc, static_cast<uint32_t>(c.circulation_max_age_s));
    crc          = history_fp_u32(crc, static_cast<uint32_t>(c.circulation_on_tenths_w));
    crc          = history_fp_u32(crc, static_cast<uint32_t>(c.circulation_off_tenths_w));
    crc          = history_fp_u32(crc, static_cast<uint32_t>(c.circulation_confirm_s));
    return history_circulation_identity_clamp(config_crc32_final(crc));
}

// Stable identity of ONE stored series. The public trend id is the semantic anchor; the source and
// every field which can change the meaning of its int16 sample are also included. Consequently a
// label-only edit survives, while a locator/converter/unit/folding change starts only that series
// empty. The catalog-wide fingerprint below remains order-sensitive; these ids deliberately do not.
//
// THE RULE THAT KEEPS THIS AND THE CATALOG FINGERPRINT FROM DRIFTING (HIST-01/c): the fingerprint
// below is a fold of exactly the ids this function returns, ring by ring. A field belongs to a
// series' meaning in ONE place — here — and the fingerprint inherits it. The two used to be written
// out separately, and the fingerprint had fallen behind: it left out the HomeHub event-folding
// policy and the ENV III unit, so a catalog that changed only those still matched, was mapped by
// index and had its RAM seal accepted, while the manifest ids (which did carry them) had moved.
//
// Each source's id is a function of its own table ENTRY (history_x10a_series_id and its siblings),
// so a test can vary one field of a copy and watch the id move; history_series_id() only picks the
// entry.
inline uint32_t history_series_id_begin(HistoryJournalSource src) {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_u32(crc, 0x53455231u);  // "SER1" semantic-id contract
    return history_fp_u32(crc, static_cast<uint32_t>(src));
}

inline uint32_t history_series_id_end(uint32_t crc) {
    const uint32_t out = config_crc32_final(crc);
    return out ? out : 1u; // zero is the invalid/out-of-range sentinel
}

inline uint32_t history_x10a_series_id(const TrendDef& d) {
    uint32_t crc = history_series_id_begin(HistoryJournalSource::X10a);
    crc          = history_fp_str(crc, d.id);
    crc          = history_fp_u32(crc, static_cast<uint32_t>(d.kind));
    crc          = history_fp_u32(crc, d.reg);
    crc          = history_fp_u32(crc, d.off);
    crc          = history_fp_str(crc, d.unit);
    crc          = history_fp_u32(crc, static_cast<uint32_t>(d.conv));
    return history_series_id_end(crc);
}

inline uint32_t history_modbus_series_id(const HomeHubHistory& d) {
    uint32_t crc = history_series_id_begin(HistoryJournalSource::Modbus);
    crc          = history_fp_str(crc, d.trend_id);
    crc          = history_fp_u32(crc, d.offset);
    crc          = history_fp_u32(crc, d.event ? 1u : 0u);
    // What the register's raw word means (HIST-01/d): the Modbus space, the codec, the extra
    // divisor and the unit. A decode fix in def/homehub.hpp moves these and so moves the id, which
    // starts only that series empty instead of mapping tenths recorded under the old scale onto the
    // new one. The label and the presentation kind are not here.
    crc = history_fp_u32(crc, static_cast<uint32_t>(d.decode.space));
    crc = history_fp_u32(crc, static_cast<uint32_t>(d.decode.type));
    crc = history_fp_u32(crc, static_cast<uint32_t>(d.decode.scale));
    crc = history_fp_str(crc, d.decode.unit);
    return history_series_id_end(crc);
}

inline uint32_t history_env3_series_id(const Env3HistoryDef& d) {
    uint32_t crc = history_series_id_begin(HistoryJournalSource::Env3);
    crc          = history_fp_str(crc, d.id);
    crc          = history_fp_str(crc, d.unit);
    return history_series_id_end(crc);
}

inline uint32_t history_series_id(HistoryJournalSource src, size_t index) {
    switch (src) {
    case HistoryJournalSource::X10a:
        return index < TREND_COUNT ? history_x10a_series_id(TRENDS[index]) : 0;
    case HistoryJournalSource::Modbus:
        return index < HOMEHUB_HISTORY_COUNT ? history_modbus_series_id(HOMEHUB_HISTORIES[index])
                                             : 0;
    case HistoryJournalSource::Env3:
        return index < ENV3_HISTORY_COUNT ? history_env3_series_id(ENV3_HISTORIES[index]) : 0;
    case HistoryJournalSource::Checkup:
        return 0;
    }
    return 0;
}

inline uint32_t history_series_list_fingerprint(HistoryJournalSource src, const uint32_t* ids,
                                                size_t count) {
    if (!ids || !count || count > HISTORY_MANIFEST_MAX_IDS) return 0;
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_u32(crc, 0x4d414e31u);  // "MAN1" manifest payload contract
    crc = history_fp_u32(crc, HISTORY_DT_S);
    crc = history_fp_u32(crc, HISTORY_SAMPLES);
    crc = history_fp_u32(crc, static_cast<uint32_t>(src));
    crc = history_fp_u32(crc, static_cast<uint32_t>(count));
    for (size_t i = 0; i < count; ++i) crc = history_fp_u32(crc, ids[i]);
    const uint32_t out = config_crc32_final(crc);
    return out ? out : 1u;
}

inline bool history_series_ids_valid(const uint32_t* ids, size_t count) {
    if (!ids || !count || count > HISTORY_MANIFEST_MAX_IDS) return false;
    for (size_t i = 0; i < count; ++i) {
        if (ids[i] == 0) return false;
        for (size_t j = i + 1; j < count; ++j)
            if (ids[i] == ids[j]) return false;  // a collision makes mapping ambiguous: fail closed
    }
    return true;
}

inline int history_series_index(const uint32_t* stored_ids, size_t stored_count,
                                uint32_t current_id) {
    if (!history_series_ids_valid(stored_ids, stored_count) || current_id == 0) return -1;
    for (size_t i = 0; i < stored_count; ++i)
        if (stored_ids[i] == current_id) return static_cast<int>(i);
    return -1;
}

inline size_t history_current_series_ids(HistoryJournalSource src, uint32_t* out, size_t max) {
    const size_t count = history_journal_source_rings(src);
    if (!out || count == 0 || count > max) return 0;
    for (size_t i = 0; i < count; ++i) out[i] = history_series_id(src, i);
    return history_series_ids_valid(out, count) ? count : 0;
}

inline uint32_t history_current_series_list_fingerprint(HistoryJournalSource src) {
    const size_t count = history_journal_source_rings(src);
    if (!count || count > HISTORY_MANIFEST_MAX_IDS) return 0;
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_u32(crc, 0x4d414e31u);
    crc = history_fp_u32(crc, HISTORY_DT_S);
    crc = history_fp_u32(crc, HISTORY_SAMPLES);
    crc = history_fp_u32(crc, static_cast<uint32_t>(src));
    crc = history_fp_u32(crc, static_cast<uint32_t>(count));
    for (size_t i = 0; i < count; ++i) crc = history_fp_u32(crc, history_series_id(src, i));
    const uint32_t out = config_crc32_final(crc);
    return out ? out : 1u;
}

inline bool history_journal_manifest_payload_matches(const HistoryJournalHeader& h,
                                                     const uint32_t* ids) {
    return history_journal_manifest_header_matches(h) &&
           history_series_ids_valid(ids, h.value_count) &&
           history_series_list_fingerprint(
               static_cast<HistoryJournalSource>(h.source), ids, h.value_count) ==
               history_journal_schema_fingerprint(h);
}

// ── Which manifest is the CURRENT one ───────────────────────────────────────────────────────────
// Before every data record the writer asks whether this catalog generation still has a recent
// manifest in the journal. The answer rests on one remembered fact per source: the manifest the
// journal appended LAST for this build's catalog.
//
// "Last" is the append SEQUENCE, never the bucket. A bucket is a wall-clock claim about the data
// the manifest precedes, and the writer legitimately moves it BACKWARDS: every cursor reset (a new
// unit, a new HomeHub target, a re-detect) restarts the backlog at the live ring's oldest bucket,
// which is older than the manifest written for the previous backlog. Adopting by bucket refused the
// manifest that had just been appended at that older bucket, so the data record behind it was due a
// manifest again — three manifests per poll tick, no data for ANY source, until the live window
// caught up with the old manifest (up to a day; until a reboot after a HomeHub disable).
struct HistoryManifestCurrent {
    uint32_t fp       = 0;         // catalog_fp of the adopted manifest (0: none yet)
    int64_t  bucket   = INT64_MIN; // the bucket it was appended at: the refresh-distance origin
    uint64_t sequence = 0;         // global append order; real sequences start at one, 0 is "none"
};

// Is a manifest due ahead of the data record for `data_bucket`? Yes when this catalog generation
// has none, when the data lies before the current manifest (the cursor was reset — that is the
// moment to re-anchor it, ONCE: the append below becomes current and the data is then no longer
// before it), or when the manifest is a full ring old and would otherwise age out of the circular
// journal.
inline bool history_manifest_due(const HistoryManifestCurrent& cur, uint32_t catalog_fp,
                                 int64_t data_bucket) {
    if (data_bucket == INT64_MIN) return false;
    if (cur.fp != catalog_fp || cur.bucket == INT64_MIN) return true;
    if (data_bucket < cur.bucket) return true;
    return static_cast<uint64_t>(data_bucket - cur.bucket) >= HISTORY_MANIFEST_REFRESH_BUCKETS;
}

// Adopt a manifest that is now in the journal (just appended and read back, or found by the boot
// scan) as the source's current one. `current_generation` is "this build's catalog, ring geometry
// and semantic-id list": a manifest of any other generation never becomes current, it is only
// cached for mapping old data. The scan meets manifests in physical order, so the later append
// wins by sequence; an equal or lower sequence is the same or an older record and changes nothing.
inline bool history_manifest_adopt(HistoryManifestCurrent& cur, bool current_generation,
                                   uint32_t catalog_fp, int64_t bucket, uint64_t sequence) {
    if (!current_generation || bucket == INT64_MIN || sequence == 0 || sequence <= cur.sequence)
        return false;
    cur.fp       = catalog_fp;
    cur.bucket   = bucket;
    cur.sequence = sequence;
    return true;
}

// The physical HomeHub observation identity. Flash and .noinit history must never cross this
// boundary: a new host, port or unit id is a different plant even when the register catalog matches.
inline uint32_t history_homehub_target_fingerprint(const char* host, uint32_t port, uint32_t unit) {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_str(crc, host);
    crc = history_fp_u32(crc, port);
    crc = history_fp_u32(crc, unit);
    return config_crc32_final(crc);
}

// Scope X10A history to the committed decoding contract, not to a single sweep's optional witness.
// Page/capacity/EEPROM reads may legitimately be absent for one boot-time sweep; including them
// would discard a day of valid history on a transient reply loss even though the selected row
// catalog and wiring are unchanged. A profile or physical link change still gets a distinct scope.
//
// THE SCOPE TAKES NO INPUT FROM THE TREND CATALOG, and must not (HIST-01/d). It stamps every X10A
// record as a whole and is checked before the semantic-id manifest is consulted, so anything in it
// that depends on TRENDS (an id, a locator, their order or count, the row a profile resolves one
// to) would turn every X10A trend insertion, reorder or single-row decode fix into the loss of the
// whole X10A history instead of the one series the manifest says changed. The value is therefore
// the same for the same (profile, pins, protocol) in every build, which also keeps an update or a
// rollback able to restore the other build's X10A records. Pinned in test_logic.cpp.
//
// Known limit: an X10A decode fix shipped under an unchanged series id keeps the old-scale samples
// of that series until they leave the 24-hour window. Kept deliberately by owner decision; a
// per-series decode identity would close it (docs/ARCHITECTURE.md, history).
inline uint32_t history_x10a_target_fingerprint(const char* profile, int32_t rx_pin, int32_t tx_pin,
                                                char proto) {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_str(crc, profile);
    crc = history_fp_u32(crc, static_cast<uint32_t>(rx_pin));
    crc = history_fp_u32(crc, static_cast<uint32_t>(tx_pin));
    crc = history_fp_u32(crc, static_cast<uint8_t>(proto));
    uint32_t out = config_crc32_final(crc);
    return out ? out : 1u;  // zero remains the explicit "identity not detected" sentinel
}

// Every fact that decides WHICH physical quantity ring index i holds, plus the geometry that
// decides how its bytes are laid out. The order-sensitive value seals .noinit RAM and identifies
// one dense flash generation. Flash restore may still map that generation through its semantic-id
// manifest; deriving the value rather than hand-maintaining a version byte means nobody can forget
// to distinguish the layouts.
//
// The three sources are all here because they share the record: adding a HomeHub history shifts no
// X10A index, but it does change the payload length, and a length change with a matching CRC is
// exactly the kind of coincidence this is meant to exclude.
//
// THE SERIES IDS ARE FOLDED, NOT RESTATED (HIST-01/c): history_series_id() is the one place that
// says which fields give a ring its meaning, and this is an order-sensitive fold of exactly those
// ids. A field can therefore not be part of a series' meaning and absent from the catalog
// fingerprint, which is how the HomeHub event policy and the ENV III unit had slipped out of it
// while the manifest ids carried them. Add a field to history_series_id() and this follows.
inline uint32_t history_catalog_fingerprint() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_u32(crc, HISTORY_DT_S);
    crc = history_fp_u32(crc, HISTORY_SAMPLES);
    crc = history_fp_u32(crc, static_cast<uint32_t>(TREND_COUNT));
    crc = history_fp_u32(crc, static_cast<uint32_t>(HOMEHUB_HISTORY_COUNT));
    crc = history_fp_u32(crc, static_cast<uint32_t>(ENV3_HISTORY_COUNT));
    for (const HistoryJournalSource src :
         {HistoryJournalSource::X10a, HistoryJournalSource::Modbus, HistoryJournalSource::Env3})
        for (size_t i = 0, n = history_journal_source_rings(src); i < n; i++)
            crc = history_fp_u32(crc, history_series_id(src, i));
    return config_crc32_final(crc);
}

// Exact catalog shipped immediately before disinfection histories: 31 X10A, 12 Modbus, 3 ENV III.
// It had no manifest, so its semantic ids and fingerprint are frozen here as one deliberate legacy
// promise. They must NOT be derived from today's catalog: future additions, reordering or semantic
// changes must not mutate what those historical indices meant. Any other unknown pre-manifest
// fingerprint remains unreadable rather than guessed.
inline constexpr uint32_t HISTORY_LEGACY_DISINFECTION_CATALOG_FP = 0x63ec0a62u;
inline constexpr uint32_t HISTORY_LEGACY_DISINFECTION_X10A_IDS[] = {
    0x675148b7u, 0xda1ce8ceu, 0x8569d7c4u, 0x3e4b2950u,
    0x9c4c3108u, 0x49e93d56u, 0xa7a62607u, 0x6d08f527u,
    0x713475b0u, 0x637974cau, 0x93587f76u, 0x5fb1e088u,
    0x0caab8acu, 0x22811bf0u, 0x18efe2bfu, 0xdb699cbeu,
    0x26dd146cu, 0x92f08686u, 0x366b8b7eu, 0x4c2a31b0u,
    0x63511b32u, 0xa66efda8u, 0xca3a725eu, 0x6116b33eu,
    0x0c16f578u, 0xa2732bb5u, 0x09af8c11u, 0xeeea5107u,
    0xa342c80cu, 0xefbedd67u, 0xa6e93395u,
};
inline constexpr uint32_t HISTORY_LEGACY_DISINFECTION_MODBUS_IDS[] = {
    0x0eaa4cfbu, 0x89b9fdb1u, 0x1ee1ca38u, 0x9f716983u,
    0x44543af9u, 0x5653ffb8u, 0x8a1edca3u, 0xd422946eu,
    0x9799e234u, 0x7ef69fa2u, 0x4fa15cb6u, 0xadc0c041u,
};
inline constexpr uint32_t HISTORY_LEGACY_DISINFECTION_ENV3_IDS[] = {
    0xbf2d4bb5u, 0xf5aa0790u, 0x337a9c00u,
};
static_assert(sizeof(HISTORY_LEGACY_DISINFECTION_X10A_IDS) / sizeof(uint32_t) == 31 &&
              sizeof(HISTORY_LEGACY_DISINFECTION_MODBUS_IDS) / sizeof(uint32_t) == 12 &&
              sizeof(HISTORY_LEGACY_DISINFECTION_ENV3_IDS) / sizeof(uint32_t) == 3,
              "the pre-manifest adapter is an exact 31/12/3 wire contract");

inline constexpr uint32_t history_legacy_disinfection_catalog_fingerprint() {
    return HISTORY_LEGACY_DISINFECTION_CATALOG_FP;
}

inline const uint32_t* history_legacy_disinfection_id_list(HistoryJournalSource src,
                                                           size_t& count) {
    switch (src) {
        case HistoryJournalSource::X10a:
            count = sizeof(HISTORY_LEGACY_DISINFECTION_X10A_IDS) / sizeof(uint32_t);
            return HISTORY_LEGACY_DISINFECTION_X10A_IDS;
        case HistoryJournalSource::Modbus:
            count = sizeof(HISTORY_LEGACY_DISINFECTION_MODBUS_IDS) / sizeof(uint32_t);
            return HISTORY_LEGACY_DISINFECTION_MODBUS_IDS;
        case HistoryJournalSource::Env3:
            count = sizeof(HISTORY_LEGACY_DISINFECTION_ENV3_IDS) / sizeof(uint32_t);
            return HISTORY_LEGACY_DISINFECTION_ENV3_IDS;
        case HistoryJournalSource::Checkup:
            count = 0;
            return nullptr;
    }
    count = 0;
    return nullptr;
}

inline size_t history_legacy_disinfection_series_ids(HistoryJournalSource src, uint32_t* out,
                                                     size_t max) {
    size_t count = 0;
    const uint32_t* ids = history_legacy_disinfection_id_list(src, count);
    if (!out || !ids || !count || count > max || !history_series_ids_valid(ids, count)) return 0;
    for (size_t i = 0; i < count; ++i) out[i] = ids[i];
    return count;
}

inline uint32_t history_legacy_disinfection_series_id(HistoryJournalSource src, size_t legacy_index) {
    size_t count = 0;
    const uint32_t* ids = history_legacy_disinfection_id_list(src, count);
    return ids && legacy_index < count ? ids[legacy_index] : 0;
}

inline int history_legacy_disinfection_stored_index(HistoryJournalSource src,
                                                    size_t current_index) {
    const uint32_t id = history_series_id(src, current_index);
    if (!id) return -1;
    size_t count = 0;
    const uint32_t* ids = history_legacy_disinfection_id_list(src, count);
    return history_series_index(ids, count, id);
}

inline bool history_legacy_disinfection_layout_matches(const HistoryJournalHeader& h) {
    static constexpr uint16_t rings[3] = {31, 12, 3};
    if (!history_journal_trend_header_structural_matches(h) ||
        h.catalog_fp != history_legacy_disinfection_catalog_fingerprint()) return false;
    for (size_t i = 0; i < 3; ++i)
        if (h.rings[i] != rings[i]) return false;
    return h.value_count == rings[h.source];
}

// ── Absolute buckets ────────────────────────────────────────────────────────────────────────────
// The ring's own bucket index is monotonic-since-boot and therefore meaningless to anyone else. A
// snapshot that has to outlive the boot is anchored on the WALL CLOCK instead: bucket = floor(unix /
// dt), which is the same grid on every device and every boot, so two snapshots taken years apart
// still line up sample-for-sample.
//
// Negative instants floor toward minus infinity rather than truncating toward zero — C++ integer
// division truncates, which would make the grid one bucket wider around the epoch. Unreachable in
// practice (the clock is either unset or after 2020) and handled anyway, because a grid with one odd
// cell in it is the kind of thing that surfaces as an off-by-one chart three weeks later.
inline constexpr int64_t history_bucket_from_unix(int64_t unix_s, uint32_t dt = HISTORY_DT_S) {
    if (dt == 0) return 0;
    const int64_t d = static_cast<int64_t>(dt);
    const int64_t quotient = unix_s / d;
    return quotient - (unix_s % d < 0 ? 1 : 0);
}

// The wall-clock bucket a source's newest commit is attributed to: the wall time of the commit
// instant, `now - commit` ago. This is the ONE derivation of a live source's anchor — the journal
// writer, the restore and the seed below all go through it — so a commit and the seed that precedes
// it are compared on the same arithmetic. INT64_MIN (no commit) has no anchor.
inline constexpr int64_t history_anchor_bucket(int64_t unix_s, int64_t now_us, int64_t commit_us,
                                               uint32_t dt = HISTORY_DT_S, int32_t wall_ms = 0) {
    if (commit_us == INT64_MIN || wall_ms < 0 || wall_ms >= 1000) return INT64_MIN;
    // Unsigned, once `now >= commit` is established: a commit instant restored from damaged DRAM
    // must not turn the subtraction into signed overflow.
    const uint64_t age_us =
        now_us < commit_us ? 0 : static_cast<uint64_t>(now_us) - static_cast<uint64_t>(commit_us);
    // Keep the subsecond remainder until wall time and age have been combined. Flooring age
    // first can put a restored seed and the first live completion in the same wall bucket.
    // Millisecond wall-clock precision and separately sampled clocks remain timing limits.
    const int64_t age_s = static_cast<int64_t>(age_us / 1000000u) +
                          (static_cast<uint64_t>(wall_ms) * 1000u < age_us % 1000000u ? 1 : 0);
    if (unix_s < INT64_MIN + age_s) return INT64_MIN;
    return history_bucket_from_unix(unix_s - age_s, dt);
}

// The last boundary of THIS boot's monotonic raster at or before `now_us`: the instant the open
// bucket began, which is also the instant the bucket before it was committed.
//
// A source that has not closed a bucket yet is SEEDED from flash, and the seed has to claim a
// commit instant for the newest restored sample. It used to claim the start of the current WALL
// bucket (which can precede the boot, hence the negative values this axis once had to allow). That
// instant lies on a different grid from the one every later commit lands on: the first live commit
// comes at the next monotonic boundary, up to a bucket after the seed, and it falls into the very
// wall bucket the seed had already claimed whenever the two grids' phases leave room for it (a
// fixed share of restores, set by the phases alone). The curve then gains a duplicate bucket and
// every restored sample reads one bucket early, with a phantom gap at the join. Claiming the
// monotonic boundary puts the seed exactly one raster step before the first commit, so the commit's
// wall bucket follows the seed's by one. The restored samples sit on the raster the rest of the
// ring already uses.
inline constexpr int64_t history_raster_boundary_us(int64_t now_us, uint32_t dt = HISTORY_DT_S) {
    if (now_us < 0) return 0; // the monotonic clock starts at zero; keep the helper total
    if (dt == 0) return now_us;
    const int64_t step_us = static_cast<int64_t>(dt) * 1000000;
    return now_us / step_us * step_us;
}

// ── Booking the stretch an adoption cannot see ──────────────────────────────────────────────────
// The newest adopted sample closed at the raster boundary just before `commit_us` on the previous
// boot's clock (a live commit stores the instant of its FOLD, which lags the boundary by up to one
// producer period; measuring from the fold would under-book every seam by that lag, always in the
// same direction, so the stretch is measured from the boundary). That boot gave its last sign of
// life at `sign_us`. Until this boot's raster begins (`claim_us`, the monotonic boundary adoption
// claims for it) the time that passed is: the rest of the previous boot after the boundary (sign −
// boundary, which includes any stall of the raster: the record measures it), the downtime (a fixed
// allowance — the device cannot time it, and the project already uses one for the state ages and
// the DHW handoff: DWELL_REBOOT_BLIND_S), and this boot's own uptime up to the claim. The count of
// whole buckets nearest to that stretch is how many explicit no-reading samples follow the newest
// sample, so the claimed commit instant and the samples before it agree. The stretch is measured to
// the CLAIM and not to the boot instant: the claim is where the newest booked sample is placed, and
// a stretch measured further would put every restart's samples a few seconds early, a
// one-directional drift of its own.
//
// ERROR DIFFUSION. Round to nearest, ties up, but do not throw the remainder away: `carry_us` is
// the remainder the previous adoption of the same raster left (positive: it booked too little,
// negative: too much), it is added to this stretch before rounding, and the new remainder is
// returned to be carried again. Plain rounding is unbiased only for restarts at random phases of
// the bucket; a restart loop at a fixed uptime leaves the same remainder with the same sign at
// every seam, and the remainders add up linearly (a day of such restarts put the oldest sample
// hours off). With the carry the booked total tracks the true total to within half a bucket
// whatever the number of seams, and a sample that crossed n seams is off by the difference of two
// remainders (under one bucket) plus the non-rounding terms, which add up a few seconds per seam
// (the allowance against the real downtime, the time between the last sign of life and a panic).
//
// Capped at `cap` (the ring size). A stretch of a ring or more leaves nothing of the old content,
// so there is nothing to carry a remainder for and it is returned as zero. A raster with no
// recorded commit, or a sign of life before it, has nothing measured and books nothing (such a
// raster is not adopted at all, see history_raster_state). Integer arithmetic on unsigned 64-bit
// instants with saturation, so a record from damaged DRAM that still verifies cannot overflow it.
struct HistoryAdoptBooking {
    uint32_t gaps;       // whole no-reading buckets to append after the newest adopted sample
    int32_t residual_us; // the unbooked (+) or over-booked (−) remainder, carried to the next one
};

inline HistoryAdoptBooking history_adopt_booking(int64_t sign_us, int64_t commit_us,
                                                 uint32_t downtime_s, int64_t claim_us,
                                                 int32_t carry_us, uint32_t dt_s = HISTORY_DT_S,
                                                 uint32_t cap = HISTORY_SAMPLES) {
    if (dt_s == 0 || commit_us < 0 || claim_us < 0 || sign_us < commit_us) return {0, 0};
    const uint64_t step     = static_cast<uint64_t>(dt_s) * 1000000u;
    const uint64_t boundary = static_cast<uint64_t>(history_raster_boundary_us(commit_us, dt_s));
    const uint64_t since = static_cast<uint64_t>(sign_us) - boundary; // boundary <= commit <= sign
    const uint64_t extra =
        static_cast<uint64_t>(downtime_s) * 1000000u + static_cast<uint64_t>(claim_us);
    const uint64_t lost = since > UINT64_MAX - extra ? UINT64_MAX : since + extra;
    // A stretch beyond half the signed range is taken as the largest there is: the ring is all
    // gaps, and `owed` below cannot overflow. (A smaller stretch that is still a ring or more
    // reaches the same answer through the cap.)
    if (lost > static_cast<uint64_t>(INT64_MAX / 2)) return {cap, 0};
    const int64_t  owed  = static_cast<int64_t>(lost) + carry_us;
    const int64_t  half  = static_cast<int64_t>(step / 2);
    const uint64_t whole = owed + half <= 0 ? 0 : static_cast<uint64_t>(owed + half) / step;
    if (whole >= cap) return {cap, 0};
    const int64_t residual = owed - static_cast<int64_t>(whole * step);
    return {static_cast<uint32_t>(whole), static_cast<int32_t>(residual > INT32_MAX   ? INT32_MAX
                                                               : residual < INT32_MIN ? INT32_MIN
                                                                                      : residual)};
}

// The monotonic instant (this boot's clock) at which the newest REAL adopted sample ended: the
// claimed instant of the newest booked gap, less one bucket per gap. INT64_MIN when the ring holds
// no real sample, i.e. when the booking filled it.
inline constexpr int64_t history_adopt_real_end_us(int64_t claim_us, uint32_t gaps,
                                                   uint32_t dt_s = HISTORY_DT_S) {
    if (dt_s == 0 || claim_us < 0 || gaps >= HISTORY_SAMPLES) return INT64_MIN;
    return claim_us - static_cast<int64_t>(gaps) * static_cast<int64_t>(dt_s) * 1000000;
}

// ── The journal must not file an adopted sample twice ───────────────────────────────────────────
// The journal writer files the ring's samples at the wall buckets after its cursor (the newest
// bucket the journal holds for the source). After an adoption the ring is the previous boot's,
// shifted by the seam, so the newest REAL sample can sit one bucket later than the bucket the
// previous boot already journaled it under, and the writer would file the same reading again under
// the next bucket - a bucket in which nothing was measured. The cure is a floor: the writer never
// appends a bucket at or before the wall bucket of the newest real adopted sample; the bucket after
// it is a gap or the next live sample.
//
// The floor is meant for a sample the journal ALREADY holds, and the cursor is the only witness: a
// cursor within HISTORY_ADOPT_FLOOR_REACH_BUCKETS is treated as prior filing evidence, within the
// bounded seam/backlog reach below. It cannot distinguish prior filing from a short backlog.
// A cursor with no value (the journal holds nothing for the source) or far behind it says the
// samples in between were never filed - the clock never synced, or the journal was down - and the
// writer files them as it always did. The decision is made once, at the writer's first look after
// the adoption. A genuine short backlog is indistinguishable and can lose up to the reach's
// recent undrained readings from flash; this deliberately prefers a gap to duplicated fresh data.
inline constexpr uint32_t HISTORY_ADOPT_FLOOR_REACH_BUCKETS = 2;

// The wall bucket the writer may not append at or before, or INT64_MIN for none. `cursor` is the
// journal's newest bucket for the source, `real_bucket` the wall bucket of the newest real adopted
// sample (history_anchor_bucket of history_adopt_real_end_us).
inline constexpr int64_t history_adopt_floor_bucket(int64_t cursor, int64_t real_bucket) {
    if (cursor == INT64_MIN || cursor >= real_bucket) return INT64_MIN; // (INT64_MIN real: below)
    return static_cast<uint64_t>(real_bucket) - static_cast<uint64_t>(cursor) <=
                   HISTORY_ADOPT_FLOOR_REACH_BUCKETS
               ? real_bucket
               : INT64_MIN;
}

// The cursor the writer works from: the journal's own, lifted to the floor. A source with no cursor
// stays without one (nothing is filed for it, so nothing can be filed twice).
inline constexpr int64_t history_adopt_floor_cursor(int64_t cursor, int64_t floor_bucket) {
    return cursor == INT64_MIN || cursor >= floor_bucket ? cursor : floor_bucket;
}

// ── A bucket from the future ────────────────────────────────────────────────────────────────────
// A journal record whose bucket lies AHEAD of the clock is evidence of one of two faults, and the
// journal cannot tell which. Either an earlier boot synchronised to a wrong, far-future time (a
// user-set NTP server is enough) and stamped its records with buckets no later clock has reached,
// or THIS boot synchronised to a wrong PAST time and is looking at a perfectly good journal.
//
// Acting on either reading is unsafe. Re-indexing below the clock and rewinding the writer's
// cursor to the records found there trusts the current clock, and a mature journal (days of
// history) always has believable records below a wrong past clock, so "an older record exists"
// proves nothing. The writer would then append the live window under wrong past buckets; those
// records become the physical head, and the next correctly synchronised boot trusts them over the
// genuine newest ones (or shows them in place of genuine values). That turns MISSING history into
// MISDATED history, which this firmware never publishes.
//
// So the rule is: records beyond the clock are never restored (the splice refuses a snapshot newer
// than the live ring) and never rewritten. The writer of an affected source appends nothing until
// the clock passes its cursor, and says so once; the episode ends with that source's next
// successful data append. After a far-future boot a trend source therefore neither restores nor
// persists until the corrected clock reaches the stamped buckets (the diagnostic restore refuses
// the hours beyond the clock and restores in-window hours only within a day below the newest
// stamped hour); after a wrong past clock the records of a source whose cursor
// is ahead are left exactly as they were and only that boot's own window goes unpersisted. A
// source with no cursor (its identity was reset during that boot) or one older than the wrong
// clock is indistinguishable from an ordinary boot and journals that boot's window as it always
// did.
//
// This is the detection decision only. `slack` is tolerance for the anchor itself, which is
// derived from separately sampled wall and monotonic clocks, and can straddle a bucket boundary
// (or differ after a small clock step). A cursor inside the slack just waits, as it always did;
// only a cursor beyond it is reported as ahead of the clock. Equal is never future, and an unknown
// cursor or anchor (INT64_MIN) is not evidence of anything.
inline constexpr uint32_t HISTORY_CURSOR_FUTURE_SLACK_BUCKETS = 1;
inline constexpr bool history_cursor_in_future(int64_t cursor, int64_t anchor, uint32_t slack = 0) {
    if (cursor == INT64_MIN || anchor == INT64_MIN || cursor <= anchor) return false;
    return static_cast<uint64_t>(cursor) - static_cast<uint64_t>(anchor) > slack;
}

// ── Locating the journal-backed span ────────────────────────────────────────────────────────────
// Restore scratch always represents a complete 24-hour window and is initialised to NO_READING.
// That sentinel is also a REAL journal sample: an unavailable register must retain the same
// five-minute raster as the other values. Therefore the values themselves cannot distinguish
// unwritten leading scratch from recorded gaps. The oldest and newest journal record buckets can.
inline size_t history_flash_restore_start(int64_t oldest_record_bucket,
                                          int64_t newest_record_bucket,
                                          size_t width = HISTORY_SAMPLES) {
    if (width == 0) return 0;
    if (oldest_record_bucket == INT64_MIN ||
        newest_record_bucket == INT64_MIN ||
        oldest_record_bucket > newest_record_bucket)
        return width;

    const uint64_t span = static_cast<uint64_t>(newest_record_bucket) -
                          static_cast<uint64_t>(oldest_record_bucket);
    if (span >= width) return 0;
    return width - 1U - static_cast<size_t>(span);
}

// The restore walks the rings of all three trend sources in one global order: X10A, then HomeHub,
// then ENV III (the order history.cpp's source_of_slot() decodes). A source whose identity reset is
// pending has nothing it may restore — the reset normally cleared its index with it — and the reset
// may never be consumed (a disabled HomeHub, an X10A bus that never resolves a profile), so the
// restore must step OVER the whole source instead of waiting at its first ring. This is the first
// ring of the source after the one `ring` belongs to; the total ring count when it was the last
// source.
inline constexpr size_t history_restore_next_source_ring(size_t ring) {
    if (ring < TREND_COUNT) return TREND_COUNT;
    if (ring < TREND_COUNT + HOMEHUB_HISTORY_COUNT) return TREND_COUNT + HOMEHUB_HISTORY_COUNT;
    return HISTORY_FLASH_TOTAL_RINGS;
}

// ── The splice ──────────────────────────────────────────────────────────────────────────────────
// One older, wall-clock-anchored snapshot, placed BEHIND what this boot has already recorded.
//
// `newest_bucket` is the absolute bucket of v[n-1]; consecutive entries are `stride` buckets apart.
// The live ring's newest COMMITTED sample sits at live_newest_bucket, and the ring holds live_n
// samples ending there — the same relationship history.cpp already maintains (a commit pushes the
// bucket that just closed, so the newest sample is always the bucket before the open one).
struct HistorySnapshotView {
    const HistorySample* v = nullptr;
    size_t   n = 0;
    uint32_t stride = 1;
    int64_t  newest_bucket = 0;
};

// Writes oldest-first into `out`, ending at live_newest_bucket, and returns the count.
//
// THE LIVE SAMPLE ALWAYS WINS where the two overlap, including when it is an absence. An overlap
// means the two disagree about a bucket this boot personally observed, and the observation this boot
// made itself is the one to keep — the alternative is letting a stale broker payload overwrite a
// measurement with a reading from a previous life of the same five minutes.
//
// A snapshot entirely older than the window contributes nothing and is not an error: a board that
// was off for two days has a perfectly valid snapshot describing a day that has since scrolled away.
inline size_t history_splice(const HistorySnapshotView& old, const HistorySample* live, size_t live_n,
                             int64_t live_newest_bucket, HistorySample* out, size_t max) {
    if (!out || !max) return 0;
    const size_t cap = max < HISTORY_SAMPLES ? max : HISTORY_SAMPLES;
    const int64_t window_start = live_newest_bucket - static_cast<int64_t>(cap) + 1;

    // A snapshot claiming to be NEWER than the live ring is refused outright rather than clamped. It
    // means the two anchors disagree about the present — a clock that moved backwards, or a payload
    // from a device whose time was wrong — and there is no position for it that is not a guess.
    bool have_old = old.v && old.n && old.stride &&
                    old.newest_bucket <= live_newest_bucket &&
                    old.newest_bucket >= window_start;

    const int64_t live_oldest = live_newest_bucket - static_cast<int64_t>(live_n ? live_n - 1 : 0);
    int64_t oldest = live_n ? live_oldest : live_newest_bucket + 1;   // empty live ring: nothing yet
    if (have_old) {
        const int64_t old_oldest =
            old.newest_bucket - static_cast<int64_t>(old.n - 1) * static_cast<int64_t>(old.stride);
        if (old_oldest < oldest) oldest = old_oldest;
    }
    if (oldest < window_start) oldest = window_start;
    if (oldest > live_newest_bucket) return 0;

    const size_t len = static_cast<size_t>(live_newest_bucket - oldest + 1);
    for (size_t i = 0; i < len; i++) {
        const int64_t b = oldest + static_cast<int64_t>(i);
        HistorySample s = HISTORY_NO_READING;
        if (have_old) {
            const int64_t d = old.newest_bucket - b;
            if (d >= 0 && d % static_cast<int64_t>(old.stride) == 0) {
                const int64_t k = static_cast<int64_t>(old.n) - 1 - d / static_cast<int64_t>(old.stride);
                if (k >= 0) s = old.v[static_cast<size_t>(k)];
            }
        }
        if (live_n && b >= live_oldest && b <= live_newest_bucket)
            s = live[static_cast<size_t>(b - live_oldest)];
        out[i] = s;
    }
    return len;
}

} // namespace daik::logic
