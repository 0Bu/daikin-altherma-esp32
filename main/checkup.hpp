#pragma once
// The 24-hour plant health checkup — storage and plumbing. Everything decidable (the row locators,
// the edge rules, the ring mechanics, the thresholds and the verdicts) lives in logic/checkup.hpp and
// is host-tested; this file is the static ring, one mutex, and the fold from a poll cycle's cached
// values into the open hour.
//
// STATIC (.bss), never heap — the same argument history.hpp makes: the binding limit on this board
// is the largest CONTIGUOUS free block, and a static array does not compete for it. 24 one-hour
// buckets cost logic/checkup.hpp's CHECKUP_BYTES.
//
// RAM only, and deliberately not persisted. Hourly buckets in NVS would be ~24 writes a day into the
// partition that holds the WiFi credentials, for a convenience — the same trade history.hpp already
// refused for the trends. The consequence is STATED rather than hidden: a reboot empties the window,
// and every check reports the coverage it actually has (logic/checkup.hpp's Collecting verdict)
// instead of a green light bought with no evidence.
#include "hp_poll.hpp"          // CachedValue
#include "logic/checkup.hpp"

#include <cstddef>

namespace daik {

// Feed one poll cycle. Called from the poll task right after a sweep with that cycle's values — NOT
// under the cache mutex (this takes its own, and holding two would invent a lock order this file has
// no reason to have, exactly like history_record).
//
// `rps_known` / `rps_running` are the compressor state the poll task has ALREADY derived for the
// held-over marking (logic/ou_stale.hpp). Passed in rather than re-derived: two answers to "is the
// compressor running" is how the trend ring and the MQTT bridge would come to blank different rows,
// and here it would be how a compressor start gets counted by one rule and not the other.
void checkup_record(const CachedValue* v, size_t n, bool rps_known, bool rps_running);

// The judged 24-hour window. Read by GET /status (httpd task) and by the WebSocket status broadcast
// (poll task), so it copies out under the lock — the report is a plain POD, so nothing allocates
// inside the critical section (CLAUDE.md → never allocate while holding a mutex).
logic::CheckupReport checkup_report();

} // namespace daik
