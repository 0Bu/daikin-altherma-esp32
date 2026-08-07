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
//   hist partition — a COARSE snapshot written once per intentional reboot from a shutdown handler.
//                    Covers the OTA case .noinit structurally cannot.
//
// LOSING POWER is therefore still unrecovered, and deliberately so: the only medium that could
// survive it is one that is not on this board, and taking the history off the device is a different
// feature with a different owner (the broker already stores every published value — see
// docs/HOME_ASSISTANT.md). Nothing here pretends otherwise; /status.history.persist reports
// "power_cycle" and the rings start empty, exactly as they always did.
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
// For the flash path the downtime is UNBOUNDED (a board can sit powered off between an OTA that
// failed and a re-flash a week later), so that snapshot carries the absolute wall-clock bucket of
// its newest sample and is SPLICED behind whatever the current boot has already recorded — see
// history_splice below. A snapshot whose anchor is missing is not restored at all: there is no
// defensible place to put it, and putting it at "now" would slide a week-old curve onto today.
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
inline constexpr uint16_t HISTORY_PERSIST_VERSION = 1;

// ── The coarse form ─────────────────────────────────────────────────────────────────────────────
// A full ring set is ~28 KB and the flash partition this firmware can offer is 8 KB, so the stored
// record keeps every STRIDE-th sample.
//
// For a MEASUREMENT the decimation is PURE — it takes the sample that actually sits in that bucket
// and drops the rest. It deliberately does NOT fold a group down to "the last reading in it", which
// would look like more data and would be a lie about WHEN: a reading from 25 minutes earlier would
// be drawn at the group's own instant. What the restored curve therefore shows is exact samples 30
// minutes apart with honest gaps between them, and the UI already renders gaps.
//
// BinaryEvent rows are the documented exception, and history_coarse_encode's `event` mode below
// carries the reasoning: for them pure decimation is the lie instead.
inline constexpr uint32_t HISTORY_COARSE_STRIDE  = 6;                        // 5 min -> 30 min
inline constexpr size_t   HISTORY_COARSE_SAMPLES = HISTORY_SAMPLES / HISTORY_COARSE_STRIDE;  // 48
static_assert(HISTORY_SAMPLES % HISTORY_COARSE_STRIDE == 0,
              "the coarse raster must divide the ring exactly, or a restored sample lands off-grid");

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

// ── Decimation ──────────────────────────────────────────────────────────────────────────────────
// Take every `stride`-th sample from a full oldest-first snapshot, ANCHORED ON THE NEWEST so the
// last coarse sample is the last real one. Anchoring on the oldest instead would let the newest
// sample fall between grid points, i.e. the one sample a reader looks at first would be the one most
// likely to be dropped.
//
// ── Why EVENT rows are folded and measurements are not ─────────────────────────────────────────
// Dropping five of every six buckets is honest for a MEASUREMENT: the kept sample was really taken
// at the instant it is drawn at, and folding a group down to "the last reading in it" would be a lie
// about WHEN — a temperature from 25 minutes earlier drawn at the group's own instant.
//
// For a BinaryEvent row that argument does not hold, and pure decimation is the lie instead. Those
// rows exist BECAUSE the events are shorter than one bucket (history.hpp: `fold_binary_event` keeps
// a 5-minute bucket ON if the state was ON at any moment in it) — a defrost lasts minutes, a BUH
// step can be a single cycle. Decimating them keeps one bucket in six, so most defrosts and backup
// heater pulses would simply not be in a restored day, and "nothing ran last night" would read as a
// finding when it is an artefact. So an event row is OR-FOLDED over the group instead: any ON in the
// `stride` buckets ENDING at the kept instant makes the coarse slot ON.
//
// That invents nothing. It widens what the slot MEANS from "ON in these five minutes" to "ON in the
// thirty minutes ending here" — the same statement the row already makes, at the width the record
// can afford. What is lost is the position WITHIN those thirty minutes, which for a boolean is a far
// smaller loss than the event disappearing.
inline HistorySample history_coarse_event_fold(const HistorySample* v, size_t from, size_t to) {
    constexpr HistorySample on = 10;   // the public binary 1 in the common tenths wire format
    HistorySample known = HISTORY_NO_READING;
    bool saw_held = false;
    for (size_t i = from; i <= to; i++) {
        const HistorySample s = v[i];
        if (s == on) return on;                            // ON wins outright, like fold_binary_event
        if (s == HISTORY_HELD_OVER) { saw_held = true; continue; }
        if (!history_is_absent(s)) known = s;              // a measured OFF beats an absence
    }
    if (!history_is_absent(known)) return known;
    return saw_held ? HISTORY_HELD_OVER : HISTORY_NO_READING;
}

inline size_t history_coarse_encode(const HistorySample* full, size_t n, uint32_t stride,
                                    HistorySample* out, size_t max, bool event = false) {
    if (!full || !out || !n || !max || !stride) return 0;
    const size_t avail = 1 + (n - 1) / stride;
    const size_t m = avail < max ? avail : max;
    for (size_t j = 0; j < m; j++) {
        const size_t idx = n - 1 - (m - 1 - j) * stride;
        if (!event) { out[j] = full[idx]; continue; }
        // The group is the `stride` buckets ENDING at the kept instant, clamped at the old end so
        // the first group cannot read before the array.
        const size_t from = idx + 1 >= stride ? idx + 1 - stride : 0;
        out[j] = history_coarse_event_fold(full, from, idx);
    }
    return m;
}

// ── Dropping the write-side padding ─────────────────────────────────────────────────────────────
// A stored block is written RIGHT-ALIGNED and padded at its OLD end with HISTORY_NO_READING, so a
// board that has recorded ten minutes ships the same 48 slots as one that has recorded a day. Those
// pad slots must not reach the splice: history_splice derives the restored window from the OLDEST
// entry it is handed, so the padding would drag every ring back a full 24 hours. The samples would
// still be right — the SPAN would not, and the UI reads the span off the array length (history.js:
// `full = n * dt >= 23.5 h`), so a chart holding one real reading would title itself "Last 24
// hours". A fabricated span is the same class of mistake as a fabricated value.
//
// Only the LEADING run goes, and only the NO_READING sentinel. An interior gap is a real
// observation and is kept; HELD_OVER is a real observation too ("outdoor unit resting") and is never
// padding. A leading gap carries no information in any case — it just means the series starts later.
inline size_t history_coarse_lead_skip(const HistorySample* v, size_t n) {
    if (!v) return n;
    size_t k = 0;
    while (k < n && v[k] == HISTORY_NO_READING) k++;
    return k;
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
