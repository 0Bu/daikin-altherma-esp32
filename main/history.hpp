#pragma once
// The 24-hour trend rings. One fixed-cadence buffer per entry in logic/history.hpp's TRENDS, fed by
// the poll task and read by GET /history.
//
// The buffers are STATIC (.bss), never heap: on this board the binding limit is the largest
// CONTIGUOUS free block, not free heap, and a static array does not compete for it. Eleven trends
// cost 6336 bytes of ring plus ~78 bytes of label/unit each — see logic/history.hpp's
// HISTORY_BYTES_PER_TREND and the ceiling assert beside TRENDS.
//
// RAM only, and deliberately not persisted: a 576-byte blob rewritten every 5 minutes is ~100k NVS
// writes a year in the partition that holds the WiFi credentials, to save a history that is only
// ever nice-to-have. The consequence is stated rather than hidden — a reboot (every /set_*, every
// OTA) empties the rings, and the UI draws the span it actually has ("Seit Neustart · 1 h") instead
// of padding a 24-hour axis with absence.
#include "hp_poll.hpp"          // CachedValue
#include "logic/history.hpp"

#include <cstddef>

namespace daik {

// Feed one poll cycle. Called from the poll task right after a sweep, with that cycle's values —
// NOT under the cache mutex (this takes its own, and holding two would invert a lock order for no
// reason). Cheap: it resolves the trended rows, folds one sample into the pending bucket per trend,
// and only touches the ring when a bucket boundary is crossed (once per HISTORY_DT_S).
void history_record(const CachedValue* v, size_t n);

// Copy trend `t`'s samples OLDEST-FIRST into `out`. Returns the count written (0 .. HISTORY_SAMPLES,
// and 0 when the profile carries no such row or nothing has been recorded yet). Non-allocating under
// the lock — a plain copy of int16s, per CLAUDE.md's "never allocate while holding a mutex".
size_t history_snapshot(size_t t, logic::HistorySample* out, size_t max);

// Seconds since the newest sample was committed, or -1 when nothing has been committed yet. The
// route needs it to state the series' t0 independently of when the request arrived — see
// logic/history_t0 for what went wrong without it.
int32_t history_newest_age_s();

// Copy the label this profile spells trend `t` with into `out` (empty when it carries no such row);
// returns the length written. A COPY rather than a pointer: the poll task rewrites the stored label
// when the model changes, so a returned pointer could be read mid-write. The web UI matches its
// value rows against this string; the trend ID is what /history takes.
size_t history_label(size_t t, char* out, size_t max);

// The row's OWN unit ("°C", "bar", "A", … — whatever `unit_for_datatype` gave the cached value), or
// empty when the profile carries no such row. Reported rather than assumed: the trends mix °C, bar
// and unitless rows, and a pressure charted as °C is the #35-#39 failure shape — a plausible,
// well-formed, wrongly-labelled value.
size_t history_unit(size_t t, char* out, size_t max);

} // namespace daik
