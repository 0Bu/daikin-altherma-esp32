#pragma once
// Which readings stop being CURRENT while the compressor is off.
//
// The outdoor unit refreshes its OWN X10A register pages only while it RUNS. Stopped, it keeps
// answering the query — with the values from its last run. Measured on a live unit (2026-07-24,
// EBLA/EDLA-detected 4-8 kW): outdoor air read exactly 19.0 °C for five hours, stepped
// 19.0 → 23 → 24 → 25.5 at the instant the compressor started, then sat at exactly 25.5 for the
// next two hours. Discharge pipe did the same: flat 84.0 for five hours, 73 → 89 → 88 across the
// run, flat 83.0 after. Over the same window the HYDRONIC pages moved continuously — leaving water
// 53.4 → 52.2 → 51.2 → 50.1 → 49.2 °C, refrigerant pressure resampling every cycle — so this is the
// outdoor unit going quiet, not the poll engine stalling.
//
// It is the legacy-35–legacy-39 failure shape with no numeric tell: 19.0 °C IS a plausible outdoor
// temperature, so hp_convert.cpp's reading_plausible() cannot see it, and neither can the domain
// audit. Only the PAGE a reading came from, plus the compressor state, can. DESIGN.md already
// decides what to do with a held-over reading in the dead-bus case — "an idle plant with no
// readings, not a stale one … a held-over reading would assert a value nobody is still measuring" —
// and this applies the same rule to one sleeping UNIT instead of one silent BUS.
//
// The poll engine and the trend rings apply this directly, and www/js/schematic.js's `d.ouHeldOver`
// is its twin for held-over: the rule keys on the generated def/ profile REGISTER ids, which are
// C++, so the CI logic-test gates it against the whole catalog — every profile must keep the
// readings the UI BLANKS on a held-over page, AND must keep the readings that DECIDE the run state
// on a live one. That second half is the load-bearing one: it is what makes "Standby — not running"
// trustworthy while the pills around it are blank.
//
// WHAT the UI does with a held-over reading is the UI's call, and it has moved once and back:
// v1.0.13 showed the pills GREYED with a caption, which is reverted — the drawing keeps ONE
// vocabulary for "no reading right now", and the explanation lives in the inspector rather than in
// a second, dimmer class of number. This header is unaffected either way — it answers "is this
// reading still current", not "how should it be drawn" — which is exactly why the rule lives here
// and the presentation does not.

#include <cstdint>

#include "lwt_select.hpp"   // lwt_ci_contains — the compressor witness still matches by label

namespace daik::logic {

// The outdoor unit's own pages: 0x20 (outdoor sensors — air, discharge, suction, coil, HP/LP) and
// 0x21 (inverter — currents, fin temps, compressor outlet).
//
// NOT 0x10, deliberately. It carries Defrost Operation, which FEEDS the run-state decision, and no
// measurement could prove whether it freezes: its Target Cond. Temp. reads 0.0 even mid-run, so it
// is a useless witness, and "Operation Mode: Fan Only" on a unit with both fans off is suspicious
// but not evidence. An unproven page must not be allowed to silence a state input — blanking a
// reading costs information, but suppressing `defrost` would corrupt the state machine itself.
constexpr bool ou_page_holds_over(unsigned reg) { return reg == 0x20u || reg == 0x21u; }

// Compressor state as the caller knows it. UNKNOWN is not a synonym for stopped: a profile without
// an "INV frequency (rps)" row tells us nothing about the compressor, and guessing "held over"
// there would blank readings that may well be live on a unit we cannot ask. Only a KNOWN-stopped
// compressor is evidence that the outdoor pages have gone stale.
constexpr bool ou_reading_held_over(unsigned reg, bool rps_known, bool rps_running) {
    return rps_known && !rps_running && ou_page_holds_over(reg);
}

// The unit-level answer has THREE values, and the third is the reason it is not a bool. "Not held
// over" is a claim that the unit is refreshing these pages; with no readable compressor speed the
// bridge has no evidence for that claim, only no evidence against it. A consumer handed `false`
// there cannot tell a running unit from one this firmware could not ask.
enum class OuFreshness : uint8_t { Unknown, Current, HeldOver };

constexpr OuFreshness ou_unit_freshness(bool rps_known, bool rps_running) {
    return !rps_known    ? OuFreshness::Unknown
           : rps_running ? OuFreshness::Current
                         : OuFreshness::HeldOver;
}

// The per-row form of Unknown: an outdoor-page reading in a sweep with no compressor reading. It
// may be live and it may be the last run's number, so it is kept apart from ou_reading_held_over().
constexpr bool ou_reading_held_unknown(unsigned reg, bool rps_known) {
    return !rps_known && ou_page_holds_over(reg);
}

// What happens to that reading depends on the last thing the witness said. A compressor that read
// as stopped moments ago is most likely still stopped, and this number the last run's: the reading
// is dropped, as for a value that failed to decode. Measured on a resting 4-8 kW unit (2026-11-02):
// those sweeps put the last run's numbers on the MQTT state topic about three times an hour, and
// the 24-hour outdoor chart showed them as points inside its held gaps. Every other reading stays,
// and only `held_unknown` qualifies it. A compressor that read as running moments ago is refreshing
// these pages. With no recent reading at all the state is standing (a profile without the row, a
// unit that never answers that page), and dropping would blank the outdoor unit for good on a
// guess.
constexpr bool ou_reading_dropped(unsigned reg, bool rps_known, bool recently_stopped) {
    return recently_stopped && ou_reading_held_unknown(reg, rps_known);
}

// Is THIS row the compressor witness — "INV frequency (rps)" — that makes the rule above decidable
// at all? It MUST sit on a page that stays live, or the run state would be derived from the same
// frozen bytes it is meant to qualify; the catalog test pins that across every profile, and the
// page condition here is the belt to those braces.
//
// The witness is matched by LABEL, which is the one place this file departs from the structural
// rule it otherwise insists on — and it is safe here for a reason the catalog test states: the rps
// row is spelled "INV frequency (rps)" in all 27 profiles that carry one, on page 0x30 in every one
// of them. There is nothing to alias.
//
// A per-row predicate rather than a search, because its callers keep their rows differently — the
// poll engine's cache (main/hp_poll.cpp, which marks the held-over readings so that they do not
// reach MQTT) and the trend ring's parallel arrays (history.hpp's trend_rps_row below it), among
// others. One predicate, several loops; a second copy of the pattern is what would re-open
// legacy-209 defect 5.
inline bool ou_is_rps_witness(const char* label, unsigned reg) {
    return label && lwt_ci_contains(label, "inv frequency") && !ou_page_holds_over(reg);
}

}  // namespace daik::logic
