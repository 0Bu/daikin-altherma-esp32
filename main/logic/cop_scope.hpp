#pragma once
// WHICH COP the dashboard's quotient actually describes — and when it describes nothing.
//
// The COP pill divides a heat output by an electrical input. Both are picked from the profile, and
// the two picks do not have to describe the same SYSTEM. That is the whole subject of this header:
// a quotient of two correct numbers taken across two different boundaries is not a worse COP, it is
// a different quantity wearing the same name.
//
// The two electrical sources the browser chooses between sit on opposite boundaries:
//   • the CT clamps (0x63) see the WHOLE unit — compressor, backup heater, pump, controls;
//   • "INV primary current" (0x21) sees the OUTDOOR inverter only — compressor and fan.
// (docs/DESIGN.md §"derived figures", www/js/schematic.js's pel explainer.)
//
// The heat side has the same split and the browser already picks the PRE-BUH outlet for it
// (lwt_select.hpp — R1T, never a setpoint, never R2T), i.e. heat from the heat pump's own exchanger,
// with the resistive backup heater deliberately NOT credited to it. So:
//
//   pth(R1T) / pel(INV)  → heat-pump heat over heat-pump electricity. Boundaries agree. A HEAT-PUMP
//                          COP, valid whatever the backup heater is doing — it is simply outside
//                          both sides of the fraction.
//   pth(R1T) / pel(CT)   → heat-pump heat over WHOLE-UNIT electricity. Boundaries agree only while
//                          the backup heater is OFF (it then draws nothing, so "whole unit" and
//                          "heat pump" differ by the pump and the controls). The moment BUH fires,
//                          kilowatts enter the denominator whose heat never enters the numerator and
//                          the quotient collapses — a number that reads as a broken heat pump while
//                          nothing is wrong.
//
// The fix is not to pick a different denominator, it is to move the NUMERATOR to the same boundary:
// with a whole-unit denominator the honest numerator is the POST-BUH outlet (R2T), which carries the
// backup heater's heat too. That is exactly what docs/HOME_ASSISTANT.md's heat-meter recipe already
// does for an external electricity meter, and for the same reason.
//
// Where no such pairing exists, the answer is to publish NOTHING — logic/feature_gate.hpp's rule
// (DISABLE, NEVER DEGRADE), which lwt_select and ou_stale already apply: blank the reading rather
// than offer a second, dimmer register of half-valid numbers.
//
// Host-testable twin of www/js/schematic.js, like lwt_select.hpp and ou_stale.hpp: there is no firmware
// caller. It lives here so the CI logic-test gates the rule against the WHOLE generated catalog
// rather than against whichever profile the author happened to be looking at.
#include <cstddef>

#include "lwt_select.hpp"   // lwt_ci_contains / lwt_is_water — same matching discipline, one copy
#include "ou_stale.hpp"     // ou_page_holds_over — the outdoor pages a water row can never be on

namespace daik::logic {

// ── The post-BUH (R2T) leaving-water measurement ───────────────────────────────────────────────
//
// Addressed with the PAGE in hand, not by label alone, because the catalog REUSES the tag.
// Measured over the 44 shipped profile tables, "(R2T)" names two unrelated sensors at the SAME
// offset with the SAME converter:
//
//   0x61/4 conv 105 — the leaving-water outlet after the backup heater   (44 profiles, 4 spellings)
//   0x20/4 conv 105 — "Discharge pipe temp.(R2T)"                        (14 profiles)
//
// Being honest about what separates them today: the water-token test below already does, because
// "Discharge pipe temp." happens to carry none of "leaving water" / "outlet water" / "inflow". That
// is a fact about how the generator spelled one row, not a property of the data — the same
// accident logic/history.hpp refuses to rely on for "(R1T)", which names the outdoor air inlet on
// 0x20 AND the indoor leaving-water sensor lwt_select keys on.
//
// So the page is here as the STRUCTURAL half of the address, and it carries a guarantee the label
// tokens cannot: whatever a row is called, one on a page the outdoor unit stops refreshing is a
// HELD-OVER reading (ou_stale.hpp), and a held-over temperature must never reach a heat meter that
// presents its output as current. Stated as "not an outdoor-unit page" rather than "== 0x61" for
// the same reason — it stays correct if the generator ever emits the hydronic outlet elsewhere,
// and it is the claim that actually matters. The catalog test asserts the selected row is on a
// live page for every profile; the unit tests assert a water row on 0x20/0x21 is refused, which is
// the case the token list alone would let through.
inline bool cop_is_post_buh(const char* label, unsigned reg) {
    if (ou_page_holds_over(reg)) return false;              // 0x20/0x21 — the discharge-pipe twin
    if (!lwt_ci_contains(label, "r2t")) return false;
    if (lwt_ci_contains(label, "setpoint")) return false;   // a target is not a measurement
    if (lwt_ci_contains(label, "mixed")) return false;      // the bizone kit's mixed-zone circuit
    // The four shipped spellings are "Leaving water temp. after BUH (R2T)", "Leaving Water Temp
    // after BUH (R2T)", "Outlet Water BUH Temp. (R2T)" and "[HPSU] Tvbh inflow Temp after
    // Buffer/BUH (R2T)" — the first two match "leaving water", the third "outlet water", the
    // fourth "inflow", so lwt_is_water covers all four with no fifth token list to drift.
    return lwt_is_water(label);
}

// Index of the post-BUH leaving-water row, or -1 when the profile carries none. `regs[i]` is the
// X10A register page row i came from — /values carries it per row for exactly this kind of rule.
inline int cop_post_buh_select(const char* const* labels, const unsigned* regs, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (labels && regs && labels[i] && cop_is_post_buh(labels[i], regs[i])) return static_cast<int>(i);
    return -1;
}

// ── The scope rule ─────────────────────────────────────────────────────────────────────────────

// Which electrical measurement the quotient was divided by. None = the profile offered neither, or
// the INV row is currently held over (ou_stale.hpp) — the browser decides that, not this header.
enum class PelSource { None, Ct, Inv };

// Which system the resulting quotient describes. This is what the inspector must NAME: the two are
// different quantities, and a plant COP is the smaller of the two whenever the backup heater runs.
enum class CopScope { None, HeatPump, Plant };

// Why there is no COP to show. Each value is a DIFFERENT sentence in the UI — suppressing one wrong
// claim must not substitute another, the rule ou_stale.hpp already states for the pel explainer.
enum class CopBlock {
    None,           // a COP is formable
    NoPelSource,    // no current row, or the only one is frozen with the outdoor unit
    BuhNoPostBuh,   // whole-unit denominator, backup heater firing, and no post-BUH row to match it
    TankHeater,     // whole-unit denominator, the tank's immersion heater firing — unpairable at all
};

struct CopPlan {
    CopScope scope       = CopScope::None;
    CopBlock block       = CopBlock::NoPelSource;
    // true  → the numerator must be the POST-BUH row (cop_post_buh_select)
    // false → the numerator is the usual pre-BUH pick (lwt_select)
    bool     use_post_buh = false;

    constexpr bool showable() const { return block == CopBlock::None; }
};

// The whole rule, from what the browser knows: which current it has, what the plant's TWO resistive
// heaters are doing, and whether this profile carries a post-BUH row.
//
// Both `_known` flags are tri-state partners to their `_on`, exactly like ou_stale's rps_known: a
// profile with no such row tells us nothing, and UNKNOWN must not be read as OFF. Off is the
// permissive case here (it says the boundaries agree), so guessing it is what would ship the
// collapsed quotient. Measured over the catalog the strictness costs nothing: 43 of the 44 profile
// tables carry BUH Step1/2, 43 carry BSH, all 44 carry a post-BUH row, and BOTH heater flags sit on
// page 0x60, which stays live while the outdoor unit sleeps — so neither input can be a held-over
// state from the last run.
//
// THE TWO HEATERS ARE NOT THE SAME PROBLEM, and that is the whole reason for two block codes:
//
//   BUH — the backup heater in the space-heating flow, between R1T and R2T. Its heat DOES cross the
//         water circuit, so moving the numerator downstream of it (use_post_buh) re-pairs the
//         boundaries and the COP survives.
//   BSH — the immersion heater INSIDE the domestic-hot-water tank (logic added with the X10A tank
//         heater flag). It heats tank water directly, downstream of the flow sensor and of BOTH
//         leaving-water sensors. Its kilowatts land in a whole-unit divisor while its heat crosses
//         NEITHER R1T nor R2T, so there is no numerator anywhere in the profile that would re-pair
//         them. Unlike the BUH case this is unfixable, not merely unfixed — hence a block rather
//         than a different row, and its own code so the UI can say which of the two it is.
//
// The BSH matters precisely where this rule is aimed: all 21 profiles that carry CT clamps also
// carry a BSH row, and the heater can run with compressor, pump and flow all at zero.
constexpr CopPlan cop_plan(PelSource pel, bool buh_known, bool buh_on,
                           bool bsh_known, bool bsh_on, bool has_post_buh) {
    if (pel == PelSource::None) return {CopScope::None, CopBlock::NoPelSource, false};

    // Compressor-only current: BOTH heaters are outside BOTH sides of the fraction, so neither can
    // unbalance them. The pre-BUH numerator is already the matching one.
    if (pel == PelSource::Inv) return {CopScope::HeatPump, CopBlock::None, false};

    // Whole-unit current. The tank heater is checked FIRST because no choice of numerator answers
    // it — deciding the row before the block would imply a pairing that does not exist.
    if (!(bsh_known && !bsh_on)) return {CopScope::Plant, CopBlock::TankHeater, false};

    // Prefer the post-BUH numerator whenever the profile has one — that is the matching boundary
    // regardless of what the backup heater is doing this second, so the figure does not change
    // meaning as the heater cycles.
    if (has_post_buh) return {CopScope::Plant, CopBlock::None, true};

    // No post-BUH row. The pre-BUH outlet stands in for it only while the heater is provably off;
    // otherwise there is no honest pairing and the pill blanks.
    const bool heater_quiet = buh_known && !buh_on;
    return {CopScope::Plant, heater_quiet ? CopBlock::None : CopBlock::BuhNoPostBuh, false};
}

}  // namespace daik::logic
