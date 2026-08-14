#pragma once
// Making the 24-hour trend rings survive a reboot — WHEN a persisted ring may be believed, and where
// its samples belong on the time axis once it is.
//
// history.hpp decides what is recorded; this decides what may be RE-ADOPTED. The two questions are
// not the same shape at all: recording is about one reading at a time, while a restore adopts ~28 KB
// of prior state in one act and every field in it is a claim about a moment that has already passed.
// Get it wrong and the chart is not empty — it is confidently wrong, which is strictly worse than
// the blank axis this firmware shipped with (the #35-#39 shape, drawn as a day of history).
//
// ── Two media, ONE question each ────────────────────────────────────────────────────────────────
// The firmware persists the rings two ways, because neither alone covers the reboots that actually
// happen:
//
//   .noinit DRAM   — survives every reset that KEEPS POWER (esp_restart from a /set_* save, a panic,
//                    a task watchdog, the recovery button). Costs no flash write and no extra RAM:
//                    the live arrays simply stop being initialised at startup. Cannot survive a
//                    power cycle, and cannot survive an OTA either — the new image's section layout
//                    moves, so the bytes are not where the new build looks. Fails closed both times.
//   history        — an append-only flash journal: one compact record per source and completed
//                    five-minute bucket. Covers OTA, ordinary reboot and sudden power loss; only the
//                    bucket which was still open can be lost. It exists only in the official 8 MB
//                    table; there is no coarse/old-table fallback.
//
// ── Why the RAM path needs no clock and the flash one does ─────────────────────────────────────
// A restored sample is meaningless without knowing WHEN it was taken, and the ring runs on the
// MONOTONIC clock (history.hpp), which restarts at zero every boot. So a restore has to re-anchor.
//
// For .noinit the answer is free, and it is a property of the medium rather than an assumption: if
// the bytes are still there, power was never lost, and a reset that keeps power completes in about a
// second. The downtime is therefore bounded by construction to well under one bucket, and the rings
// are adopted in place with no re-anchoring at all. The residual error is that the bucket which was
// open when the device died is lost — which is what a gap means, so nothing is claimed that was not
// measured. The seam is at most one HISTORY_DT_S wide and is documented rather than hidden.
//
// For the flash path the downtime is UNBOUNDED (a board can sit powered off for a week), so every
// record carries its absolute wall-clock bucket and the last 24 hours are SPLICED behind whatever
// the current boot has already recorded — see history_splice below. A record whose anchor is missing
// is never written: there is no defensible place to put it, and putting it at "now" would slide a
// week-old curve onto today.
//
// ── Why a catalog fingerprint, not just a CRC ───────────────────────────────────────────────────
// A ring is addressed by its INDEX in TRENDS. Insert a trend, reorder two, change a locator or the
// ring geometry, and index 12 stops meaning what it meant when the bytes were written — so a valid
// CRC would hand the expansion valve's day to the DHW tank. That is the same substitution
// history.hpp's locator rule exists to prevent, arriving through the back door of a firmware update.
// The fingerprint covers every id, kind, locator and the geometry, so any catalog edit invalidates
// every persisted ring automatically and nobody has to remember to bump a version.
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
inline constexpr uint16_t HISTORY_PERSIST_VERSION = 2;  // v2 binds .noinit HomeHub rings to target

// ── Flash-journal geometry ──────────────────────────────────────────────────────────────────────
// The official 8 MB table gives the entire upper 4 MiB to history. Flash can clear bits with a
// program operation but can set them again only by erasing a whole 4 KiB sector, so the durable
// shape is a circular APPEND log rather than an in-place snapshot. Each source closes its own
// raster independently and therefore gets its own record: a disabled HomeHub/ENV III can never hold
// X10A persistence hostage.
//
// One record is page-aligned and large enough for the largest source's dense int16 vector. At the
// current 31/12/3 rings this is 256 bytes: sixteen records share one erased sector. If the catalog
// grows past 96 rings in one source the expression moves the format to 512 bytes automatically; the
// checked 72-hour capacity below then fails before a catalog can silently outgrow the reservation.
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
    HISTORY_JOURNAL_HEADER_BYTES + HISTORY_JOURNAL_MAX_SOURCE_RINGS * sizeof(HistorySample));
inline constexpr size_t HISTORY_JOURNAL_SLOTS_PER_SECTOR =
    HISTORY_FLASH_ERASE_BYTES / HISTORY_JOURNAL_SLOT_BYTES;
inline constexpr size_t HISTORY_JOURNAL_SLOT_COUNT =
    HISTORY_FLASH_PARTITION_BYTES / HISTORY_JOURNAL_SLOT_BYTES;

inline constexpr uint32_t HISTORY_JOURNAL_MAGIC = 0x4c4e4a48u;       // "HJNL" little-endian
inline constexpr uint16_t HISTORY_JOURNAL_VERSION = 1;
inline constexpr uint32_t HISTORY_JOURNAL_ERASED = 0xffffffffu;
inline constexpr uint32_t HISTORY_JOURNAL_COMMITTED = 0x54494d43u;   // "CMIT" little-endian
inline constexpr uint8_t  HISTORY_JOURNAL_FLAG_TARGET_SCOPED = 0x01u;

// Wire format. `commit` remains erased while the body is programmed and is changed to CMIT in one
// final 1->0 write. A torn body or torn commit is therefore never mistaken for a valid record.
struct HistoryJournalHeader {
    uint32_t magic;          //  0
    uint16_t version;        //  4
    uint8_t  source;         //  6 — HistoryJournalSource
    uint8_t  flags;          //  7 — zero in v1
    uint32_t catalog_fp;     //  8
    uint32_t crc;            // 12 — normalised header + `value_count` samples
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
        h.rings[0] != TREND_COUNT || h.rings[1] != HOMEHUB_HISTORY_COUNT ||
        h.rings[2] != ENV3_HISTORY_COUNT)
        return false;
    return h.value_count == value_count && value_count > 0 &&
           static_cast<size_t>(value_count) * sizeof(HistorySample) <=
               HISTORY_JOURNAL_SLOT_BYTES - HISTORY_JOURNAL_HEADER_BYTES;
}

// Compatibility wrapper for the three original dense trend sources.  Existing host tests and old
// v1 records keep exactly their former contract; the fourth source must state its own payload width
// and one-hour raster explicitly through the overload above.
inline bool history_journal_header_matches(const HistoryJournalHeader& h, uint32_t catalog_fp) {
    if (h.source >= static_cast<uint8_t>(HistoryJournalSource::Checkup) ||
        h.source == static_cast<uint8_t>(HistoryJournalSource::Modbus))
        return false;  // HomeHub records additionally require the configured-target fingerprint
    return history_journal_header_matches(
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
    return history_journal_header_matches(
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
static_assert(HISTORY_JOURNAL_SLOT_COUNT <= UINT16_MAX,
              "restore indexes store physical slot numbers as uint16_t");
static_assert(HISTORY_JOURNAL_SLOT_COUNT >= HISTORY_FLASH_FUTURE_RECORDS,
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
        case CrashReason::SW:         // esp_restart() — a /set_* save, an OTA install, a rollback
        case CrashReason::PANIC:      // the crash we most want the preceding hours for
        case CrashReason::INT_WDT:
        case CrashReason::TASK_WDT:
        case CrashReason::OTHER_WDT:
        case CrashReason::CPU_LOCKUP:
        case CrashReason::EXT:        // reset pin — the board stayed powered
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
    NoRecord,       // magic absent — a fresh board, or DRAM that was never written
    PowerCycle,     // the reset reason does not preserve RAM
    WrongVersion,   // this build's record layout differs
    WrongCatalog,   // TRENDS changed — indices no longer mean the same rows
    BadCrc,         // present and current, but not intact
};

inline constexpr const char* history_restore_slug(HistoryRestore r) {
    switch (r) {
        case HistoryRestore::Accept:       return "accept";
        case HistoryRestore::NoRecord:     return "no_record";
        case HistoryRestore::PowerCycle:   return "power_cycle";
        case HistoryRestore::WrongVersion: return "wrong_version";
        case HistoryRestore::WrongCatalog: return "wrong_catalog";
        case HistoryRestore::BadCrc:       return "bad_crc";
    }
    return "unknown";
}

// Order is deliberate and is the reason this is a function rather than a chain of ifs at the call
// site: the CHEAPEST and most explanatory refusal must win. A power-cycled board holds garbage that
// will usually fail the magic check too, and reporting "bad_crc" for it would send a reader looking
// for a memory fault that is not there.
inline constexpr HistoryRestore history_restore_verdict(uint32_t reset_reason, uint32_t magic,
                                                        uint16_t version, uint32_t catalog_fp,
                                                        uint32_t want_catalog_fp,
                                                        uint32_t stored_crc, uint32_t actual_crc) {
    if (!history_reset_preserves_ram(reset_reason)) return HistoryRestore::PowerCycle;
    if (magic != HISTORY_PERSIST_MAGIC)             return HistoryRestore::NoRecord;
    if (version != HISTORY_PERSIST_VERSION)         return HistoryRestore::WrongVersion;
    if (catalog_fp != want_catalog_fp)              return HistoryRestore::WrongCatalog;
    if (stored_crc != actual_crc)                   return HistoryRestore::BadCrc;
    return HistoryRestore::Accept;
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

// Every fact that decides WHICH physical quantity ring index i holds, plus the geometry that decides
// how its bytes are laid out. A change to any of them must invalidate the persisted set, and the
// point of deriving it rather than hand-maintaining a version byte is that nobody can forget.
//
// The three sources are all here because they share the record: adding a HomeHub history shifts no
// X10A index, but it does change the payload length, and a length change with a matching CRC is
// exactly the kind of coincidence this is meant to exclude.
inline uint32_t history_catalog_fingerprint() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = history_fp_u32(crc, HISTORY_DT_S);
    crc = history_fp_u32(crc, HISTORY_SAMPLES);
    crc = history_fp_u32(crc, static_cast<uint32_t>(TREND_COUNT));
    crc = history_fp_u32(crc, static_cast<uint32_t>(HOMEHUB_HISTORY_COUNT));
    crc = history_fp_u32(crc, static_cast<uint32_t>(ENV3_HISTORY_COUNT));
    for (const auto& d : TRENDS) {
        crc = history_fp_str(crc, d.id);
        crc = history_fp_u32(crc, static_cast<uint32_t>(d.kind));
        crc = history_fp_u32(crc, d.reg);
        crc = history_fp_u32(crc, d.off);
        crc = history_fp_str(crc, d.unit);
        crc = history_fp_u32(crc, static_cast<uint32_t>(d.conv));
    }
    for (size_t i = 0; i < HOMEHUB_HISTORY_COUNT; i++) {
        crc = history_fp_u32(crc, HOMEHUB_HISTORIES[i].offset);
        crc = history_fp_str(crc, HOMEHUB_HISTORIES[i].trend_id);
    }
    for (size_t i = 0; i < ENV3_HISTORY_COUNT; i++) crc = history_fp_str(crc, ENV3_HISTORIES[i].id);
    return config_crc32_final(crc);
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
    return unix_s >= 0 ? unix_s / d : -(((-unix_s) + d - 1) / d);
}

// Represent an absolute wall-clock bucket on this boot's monotonic axis. The result is allowed to
// be NEGATIVE: immediately after a reboot, the wall bucket may have started before esp_timer's new
// zero. Clamping it to zero slides every restored curve forward to the boot instant — exactly the
// lie the absolute flash anchor exists to prevent. Callers therefore use a distinct INT64_MIN
// sentinel for "no commit" and accept ordinary negative timestamps as pre-boot commits.
inline constexpr int64_t history_anchor_commit_us(int64_t now_us, int64_t unix_s,
                                                  int64_t newest_bucket,
                                                  uint32_t dt = HISTORY_DT_S) {
    if (dt == 0) return now_us;
    const int64_t bucket_s = newest_bucket * static_cast<int64_t>(dt);
    return now_us - (unix_s - bucket_s) * 1000000LL;
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
