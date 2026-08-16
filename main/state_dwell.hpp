#pragma once
// How long each switched row has read what it reads — storage and plumbing. Everything decidable
// (which rows are tracked, what counts as a state, how blind time is booked, when a run stops being
// believable and what may be re-adopted after a reboot) lives in logic/state_dwell.hpp and is
// host-tested; this file is the static table, one mutex, and the fold from a poll cycle.
//
// STATIC, never heap — history.hpp's and checkup.hpp's argument: the binding limit on this board is
// the largest CONTIGUOUS free block, and a static array does not compete for it. The table is
// DWELL_MAX_SLOTS * sizeof(DwellSlot) = 1024 B, against history's ~26.5 KB of rings and the checkup's
// 1224 B, so this is the cheapest of the three by a wide margin — which is the point: the same
// question answered with a 24-hour ring would cost 576 B PER ROW.
//
// Not in NVS, for their reason too (a table rewritten every second is not something to put in the
// partition holding the WiFi credentials), and "not in NVS" does not mean "gone at every reboot":
// the table lives in .noinit DRAM, so any reset that KEPT POWER carries it across at no cost in RAM,
// flash or a partition. A power cycle is unrecovered and says so on /status.history.dwell_persist.
//
// An explicit X10A re-detection onto a DIFFERENT unit empties the table: the slots are addressed by
// (register page, byte offset, converter), and the same coordinates on another model are another
// flag — continuing a run across that would be the #35-#39 substitution with a duration in front
// of it.
#include "hp_poll.hpp"          // CachedValue
#include "logic/state_dwell.hpp"

#include <cstddef>
#include <cstdint>

namespace daik {

// Fold one poll cycle. Called from the poll task right after a sweep with that cycle's values —
// NOT under the cache mutex (this takes its own, exactly like history_record and checkup_record).
//
// `v == nullptr, n == 0` is a REAL call and must keep being made: it is what tells the table that a
// cycle went by with nothing readable, so every slot books blind seconds and eventually stops
// claiming a run. Skipping it on a silent bus would freeze every dwell at its last value and go on
// presenting it as current — the failure this whole feature exists to avoid.
void dwell_record(const CachedValue* v, size_t n, uint32_t source_generation);

// Judge what the previous boot left in .noinit and adopt or wipe it. app_main calls this ONCE,
// before any producer task exists, which is what makes the decision single-threaded and lock-free.
void dwell_start();

// How this boot's table came to be — logic/state_dwell.hpp's DwellRestore vocabulary. Reported so a
// set of durations that reset itself has a stated cause rather than looking like a defect.
const char* dwell_persist_state();

// The reset a DETECTION asks for. Detection resolves a profile on EVERY boot, so "detection
// resolved" is not evidence that the unit changed: the first call after an adopted boot keeps the
// table when the profile matches the one it was recorded under. That is the trap history.cpp shipped
// and checkup.cpp documents — avoided here rather than rediscovered a third time.
void dwell_reset_on_detect(const char* profile_id);

// Start a new set of state ages after an explicit X10A re-detection, link rewiring or profile
// selection — the plain reset, beside checkup_reset(). Cross-task safe: only dwell_record consumes
// the request, under the table's own mutex, and discards that in-flight sample with the identity it
// belonged to. A HomeHub-only reconfiguration must NOT call this; it is an independent source and
// changes nothing about which X10A flag sits at which coordinate.
void dwell_reset();

// Factory-reset privacy boundary. Unlike the deferred identity reset above, this synchronously
// invalidates the .noinit table before esp_restart(), so a software reset cannot re-adopt the prior
// owner's state ages after NVS has already been erased.
void dwell_forget();

// What this board can say about one row, or `known == false` when the answer is nothing. Copies a
// plain POD out under the lock, so nothing allocates inside the critical section (AGENTS.md →
// Memory, concurrency, and HTTP safety).
logic::DwellReading dwell_reading(uint8_t reg, uint8_t off, int conv);

} // namespace daik
