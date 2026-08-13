#pragma once
// The rolling plant diagnosis — storage and plumbing. Everything decidable (row locators,
// the edge rules, the ring mechanics, the thresholds and the verdicts) lives in logic/checkup.hpp and
// is host-tested; this file is the static ring, one mutex, and the fold from a poll cycle's cached
// values into the open hour.
//
// STATIC, never heap — the same argument history.hpp makes: the binding limit on this board is the
// largest CONTIGUOUS free block, and a static array does not compete for it. 24 one-hour buckets
// cost logic/checkup.hpp's CHECKUP_BYTES.
//
// Still not in NVS — hourly buckets there would write into the partition holding WiFi credentials.
// Resets that KEEP POWER use the zero-write .noinit fast path; completed hours also ride the existing
// append-only `history` partition, so OTA layout changes and power loss retain the exact counted
// evidence without reconstructing it from lossy five-minute trends. See logic/checkup_persist.hpp.
//
// An explicit X10A re-detection, profile or pin identity change still empties the window. A
// HomeHub-only edit is a separate source and deliberately does not.
#include "hp_poll.hpp"          // CachedValue
#include "logic/checkup.hpp"
#include "logic/checkup_persist.hpp"

#include <cstddef>

namespace daik {

// Transport between the checkup owner and history.cpp's shared flash-journal owner.  The absolute
// bucket is duplicated outside the payload because it belongs to the common journal header; the
// payload's exact end time is what validates age/full-span after a cold boot.
struct CheckupFlashRecord {
    int64_t bucket = INT64_MIN;
    logic::CheckupJournalPayload payload;
};

enum class CheckupFlashRestoreResult : uint8_t { Deferred, Ignored, Restored };

// Feed one poll cycle. Called from the poll task right after a sweep with that cycle's values — NOT
// under the cache mutex (this takes its own, and holding two would invent a lock order this file has
// no reason to have, exactly like history_record).
//
// `rps_known` / `rps_running` are the compressor state the poll task has ALREADY derived for the
// held-over marking (logic/ou_stale.hpp). Passed in rather than re-derived: two answers to "is the
// compressor running" is how the trend ring and the MQTT bridge would come to blank different rows,
// and here it would be how a compressor start gets counted by one rule and not the other.
void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running,
                    const logic::CheckupCoverage& coverage);

// Judge what the previous boot left in .noinit and adopt or wipe it. app_main calls this ONCE,
// before any producer task exists, which is what makes the decision single-threaded and lock-free.
void checkup_start();

// How this boot's window came to be — logic/checkup_persist.hpp's CheckupRestore vocabulary, on
// /status.health.persist. A card that emptied itself otherwise reads as a defect.
const char* checkup_persist_state();

// The reset a DETECTION asks for. Not checkup_reset(): detection resolves a profile on every boot,
// so "detection resolved" is not evidence that the unit changed — the first call after an adopted
// boot keeps the window if the profile matches the one it was recorded under.
void checkup_reset_on_detect(const char* profile_id);

// Start a new observation identity after explicit X10A re-detection, link rewiring or profile
// selection. Cross-task safe: only record consumes it under the checkup mutex and discards that
// in-flight sample; report stays empty while the request is pending.
// HomeHub-only reconfiguration must not call this; it is an independent source.
void checkup_reset();

// Start only the DHW-loss/circulation window over after its independent source, mapping or power
// thresholds change. Other X10A-backed findings keep their already-collected 24-hour evidence.
void checkup_dhw_reset();

// The judged 24-hour window. Read by GET /status (httpd task) and by the WebSocket status broadcast
// (poll task), so it copies out under the lock — the report is a plain POD, so nothing allocates
// inside the critical section (CLAUDE.md → never allocate while holding a mutex).
logic::CheckupReport checkup_report();

// Copy the next completed hourly pair after `after_bucket` into a journal payload. `now_unix_s`
// supplies the wall-clock anchor; no record is produced before time is synced or before one hour has
// completed. Called under the FLASH mutex, and takes only the independent checkup mutex.
bool checkup_flash_next(int64_t now_unix_s, int64_t after_bucket,
                        int64_t& bucket, logic::CheckupJournalPayload& payload);

// Splice journal records behind this boot's live pending hour. Deferred until profile detection has
// established the model identity and consumed its reset; existing .noinit data always wins. The
// records are oldest-first and may contain gaps or other model identities, all rejected explicitly.
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t now_unix_s);

} // namespace daik
