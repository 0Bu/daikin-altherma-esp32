#pragma once
// The 24-hour trend rings. One fixed-cadence buffer per entry in logic/history.hpp's TRENDS, fed by
// the X10A poll task, twelve rings fed by the independent HomeHub task and three rings fed by ENV
// III, and read by GET /history. The HomeHub set is eight paired measurements plus BSH,
// 3-way-valve, Quiet and Smart-Grid state timelines.
//
// The buffers are STATIC storage, never heap: on this board the binding limit is the largest
// CONTIGUOUS free block, not free heap, and a static array does not compete for it. Their non-zero
// pending sentinel places the rings in .data. Thirty-one X10A/board/state rings cost 17856 bytes and
// twelve HomeHub rings another 6912 bytes and three ENV III rings 1728 bytes — see
// logic/history.hpp's HISTORY_BYTES_PER_TREND and the ceiling asserts beside the arrays.
//
// RAM only, and deliberately not persisted: a 576-byte blob rewritten every 5 minutes is ~100k NVS
// writes a year in the partition that holds the WiFi credentials, to save a history that is only
// ever nice-to-have. After a reboot/OTA the common raster therefore grows from zero to 24 hours.
// A later X10A/HomeHub identity change removes the old readings but preserves that boot-aligned
// raster as explicit gaps, so every chart shows the same elapsed window without splicing devices.
// The UI draws the span actually retained ("Aufzeichnung · 11 h" until the first full day).
#include "hp_poll.hpp"          // CachedValue
#include "logic/history.hpp"

#include <cstddef>

namespace daik {

// Create the one mutex before any producer task starts. History has three writers (X10A, HomeHub
// and ENV III), so lazy creation inside one of them would be a race on first boot.
void history_start();

// Feed one poll cycle. Called from the poll task right after a sweep, with that cycle's values —
// NOT under the cache mutex (this takes its own, and holding two would invert a lock order for no
// reason). Cheap: it resolves the trended rows, folds one sample into the pending bucket per trend,
// and only touches the ring when a bucket boundary is crossed (once per HISTORY_DT_S).
void history_record(const CachedValue* v, size_t n);

// Feed the BOARD's own trends (free heap, largest contiguous block). Called from the poll task at
// the top of EVERY cycle, before it decides whether to detect or to sweep, because these describe the
// ESP32 and not the heat pump: routing them through history_record() made them vanish on a board
// whose X10A bus never answers (the profile stays "auto", so poll_once() — and with it
// history_record() — never runs), which is precisely the board someone is diagnosing. One producer,
// no branch that can skip it.
void history_record_board();

// Feed the external MQTT circulation witness from the MQTT task's own one-second cadence. This is
// deliberately separate from history_record(): an installation whose X10A bus is silent remains in
// auto-detection and therefore has no X10A poll cycle, but its configured MQTT witness is still a
// valid independent source and must keep its timeline moving.
void history_record_circulation();

// Feed one HomeHub cycle. The eight paired measurements plus BSH, 3-way-valve, Quiet and Smart-Grid
// states named in logic/homehub_map.hpp are buffered; other states, setpoints and Modbus-only values do not
// acquire a chart. An empty cycle advances the source's time raster with gaps, so an outage does not
// make the last Modbus point slide to "now".
void history_record_modbus(const CachedValue* v, size_t n);

// Fold the independent ENV III observation into its three 24-hour rings. Called from the sensor's
// own 10-second task, so these curves keep advancing even when X10A is disconnected. `valid=false`
// advances time but contributes no reading; a successful sample already seen in the same five-
// minute bucket is retained.
void history_record_env3(bool valid, float temperature_c, float humidity_pct, float pressure_hpa);

// Start a new X10A observation identity after explicit re-detection, link rewiring or profile
// selection. Cross-task safe: the poll task consumes the request under the history mutex before it
// folds the first sample of the newly resolved unit. HomeHub is an independent source and remains.
void history_reset();

// Start a new HomeHub observation identity after host, port or unit-id changes. Like the X10A
// reset, elapsed positions remain explicit gaps on the common boot-aligned 24-hour raster.
void history_modbus_reset();

// Start a new identity for the two optional external circulation witnesses without discarding the
// independent X10A/HomeHub histories.
void history_circulation_reset();

// Copy trend `t`'s samples OLDEST-FIRST into `out`. Returns the count written (0 .. HISTORY_SAMPLES,
// and 0 when the profile carries no such row or nothing has been recorded yet). Non-allocating under
// the lock — a plain copy of int16s, per CLAUDE.md's "never allocate while holding a mutex".
size_t history_snapshot(size_t t, logic::HistorySample* out, size_t max);

// Copy the HomeHub series for history slot `t` (logic::HOMEHUB_HISTORIES), oldest first.
size_t history_modbus_snapshot(size_t t, logic::HistorySample* out, size_t max);
size_t history_env3_snapshot(size_t t, logic::HistorySample* out, size_t max);

// Seconds since the newest sample was committed, or -1 when nothing has been committed yet. The
// route needs it to state the series' t0 independently of when the request arrived — see
// logic/history_t0 for what went wrong without it.
int32_t history_newest_age_s();
int32_t history_modbus_newest_age_s();
int32_t history_env3_newest_age_s();

// Monotonic 5-minute bucket of sample zero, shared across both sources and therefore an exact
// alignment key even before SNTP has established wall time. Returns -1 for an empty series.
int64_t history_oldest_bucket(size_t sample_count);
int64_t history_modbus_oldest_bucket(size_t sample_count);
int64_t history_env3_oldest_bucket(size_t sample_count);

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
