#pragma once
// Which readings stop being CURRENT while the compressor is off.
//
// The outdoor unit refreshes its OWN X10A register pages only while it RUNS. Stopped, it keeps
// answering the query — with the values from its last run. Measured on a live unit (2026-07-24,
// EBLA/EDLA-detected 4-8 kW): outdoor air read exactly 19.0 °C for five hours, stepped
// 19.0 → 23 → 24 → 25.5 at the instant the compressor started, then sat at exactly 25.5 for the next
// two hours. Discharge pipe did the same: flat 84.0 for five hours, 73 → 89 → 88 across the run,
// flat 83.0 after. Over the same window the HYDRONIC pages moved continuously — leaving water
// 53.4 → 52.2 → 51.2 → 50.1 → 49.2 °C, refrigerant pressure resampling every cycle — so this is the
// outdoor unit going quiet, not the poll engine stalling.
//
// It is the #35-#39 failure shape with no numeric tell: 19.0 °C IS a plausible outdoor temperature,
// so hp_convert.cpp's reading_plausible() cannot see it, and neither can the domain audit. Only the
// PAGE a reading came from, plus the compressor state, can. DESIGN.md already decides what to do
// with a held-over reading in the dead-bus case — "an idle plant with no readings, not a stale one
// … a held-over reading would assert a value nobody is still measuring" — and this applies the same
// rule to one sleeping UNIT instead of one silent BUS.
//
// Host-testable twin of www/app.js's `d.ouHeldOver` (like logic/lwt_select.hpp there is no firmware
// caller): the rule keys on the generated def/ profile REGISTER ids, which are C++, so the CI
// logic-test gates it against the whole catalog — every profile must keep the readings the UI BLANKS
// on a held-over page, AND must keep the readings that DECIDE the run state on a live one. That
// second half is the load-bearing one: it is what makes "Standby — not running" trustworthy while
// the pills around it are blank.
//
// WHAT the UI does with a held-over reading is the UI's call, and it has moved once and back: v1.0.13
// showed the pills GREYED with a caption, which is reverted — the drawing keeps ONE vocabulary for
// "no reading right now", and the explanation lives in the inspector rather than in a second, dimmer
// class of number. This header is unaffected either way — it answers "is this reading still current",
// not "how should it be drawn" — which is exactly why the rule lives here and the presentation does not.

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

}  // namespace daik::logic
