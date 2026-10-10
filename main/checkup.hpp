#pragma once
// The rolling plant diagnosis — storage and plumbing. Everything decidable (row locators,
// the edge rules, the ring mechanics, the thresholds and the verdicts) lives in logic/checkup.hpp
// and is host-tested; this file is the static ring, one mutex, and the fold from a poll cycle's
// cached values into the open hour.
//
// STATIC, never heap — the same argument history.hpp makes: the binding limit on this board is the
// largest CONTIGUOUS free block, and a static array does not compete for it. 24 one-hour buckets
// cost logic/checkup.hpp's CHECKUP_BYTES.
//
// Still not in NVS — hourly buckets there would write into the partition holding WiFi credentials.
// Completed RAM hours are retired at every boot. The existing append-only `history` partition
// restores dated compatible completed hours after clock sync and current source confirmation,
// without reconstructing them from lossy five-minute trends. See logic/checkup_persist.hpp.
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
using CheckupFlashRecord = logic::CheckupJournalRecord;

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
                    const logic::CheckupCoverage& coverage, uint32_t source_generation);

// Judge the previous boot's handoff integrity and retire completed RAM hours. app_main calls ONCE,
// before any producer task exists, which is what makes the decision single-threaded and lock-free.
void checkup_start(bool diagnostics_enabled, uint32_t diagnostics_generation);

// Apply the persisted master switch live. A transition synchronously starts a fresh evidence
// identity, so neither the next poll cycle nor a reboot can carry the previous interval across it.
void checkup_set_diagnostics(bool enabled, uint32_t generation);

// How this boot's window came to be — logic/checkup_persist.hpp's CheckupRestore vocabulary, on
// /status.health.persist reports the startup integrity refusal, flash_pending while journal
// recovery awaits clock/source confirmation, fresh when no stored intervals were selected, and
// flash after reconstruction. Pending does not prove saved hours exist; compatible records can
// lose to live evidence or capacity clipping. Completed RAM hours are never adopted; the one-shot
// scoped ongoing DHW filter is separate.
const char* checkup_persist_state();

// Confirm this boot's detected or explicitly selected profile/link scope. Startup's cached scope
// cannot unlock flash restore. The first confirmation may resume a matching one-shot ongoing DHW
// filter; later confirmation changes retire the old window through the reset barrier.
void checkup_reset_on_detect(const char* profile_id, uint32_t source_fp);

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
// inside the critical section (AGENTS.md → Memory, concurrency, and HTTP safety).
logic::CheckupReport checkup_report();

// Copy the next completed hourly pair after `after_bucket` into a journal payload. `now_unix_s`
// supplies the wall-clock anchor; no record is produced before time is synced or before one hour has
// completed. Called under the FLASH mutex, and takes only the independent checkup mutex.
bool checkup_flash_next(int64_t now_unix_s, int64_t after_bucket,
                        int64_t& bucket, logic::CheckupJournalPayload& payload);

// Splice journal records behind this boot's live pending hour. Deferred until profile detection has
// confirmed the current profile/link scope and consumed its reset. Current-boot pending/live data
// takes precedence; completed RAM hours were retired. Records are oldest-first and may contain
// gaps or other source identities, all rejected explicitly.
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord* records, size_t count,
                                                int64_t now_unix_s);

} // namespace daik
