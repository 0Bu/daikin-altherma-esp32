#pragma once
// WHICH X10A ROW A HOMEHUB REGISTER IS THE SAME QUANTITY AS — the link that lets the web UI print a
// Modbus reading beside the X10A one, and lets it stand in for that row when the X10A bus is silent.
// IDF-free + host-tested (test/test_logic.cpp).
//
// The two stacks are INDEPENDENT (docs/MODBUS_PROTOCOL.md): different wire, different framing,
// different register model, different failure modes, separate tasks and separate caches. The only
// thing they share is that both describe the same heat pump — and this header is the entirety of
// that sharing. Nothing else in the firmware pairs a HomeHub register with an X10A row.
//
// ── The pairing may NEVER be made on the label ──────────────────────────────────────────────────
// The catalog spells one quantity many ways across the 43 detectable profiles — "[HPSU] Tv inflow
// Temp  (R1T)", "Leaving water temp. before BUH (R1T)", "Outlet Water Heat Exch", four spellings of
// leaving water alone, one of them with a DOUBLE space — and it also REUSES a tag for different
// quantities ("(R1T)" is both the outdoor air sensor on 0x20 and the indoor leaving-water sensor).
// A label match would therefore be both incomplete and wrong, and it is exactly the mistake
// logic/lwt_select.hpp and logic/ou_stale.hpp exist to prevent. A wrong pairing here is worse than a
// missing one: in the FALLBACK case the Modbus value stands alone under the X10A row's name, with
// nothing beside it to look implausible against.
//
// ── The vocabulary is logic/history.hpp's TREND IDS, deliberately reused ────────────────────────
// A trend is already "one physical quantity a human cares about, addressed STRUCTURALLY by
// (register page, byte offset, unit)" — which is precisely the concept this pairing needs, and the
// catalog test already proves each locator resolves to exactly one row on every profile. Inventing a
// second concept vocabulary beside it would be two lists to keep in step for no gain, so a HomeHub
// register names a TREND ID and the X10A side resolves through trend_row_matches(). The set is
// asserted against TRENDS at compile time below, so a renamed or deleted trend is a build error
// rather than a pairing that silently stops happening.
//
// A HomeHub register with NO counterpart (the real power measurement, the Smart-Grid mode, the
// setpoint limits) carries a null concept and is simply never paired — it shows up as a Modbus-only
// reading. That is the honest outcome, not a gap to be filled by loosening the rule.
#include <cstddef>
#include "history.hpp"   // TRENDS / TrendDef / trend_row_matches — the shared concept vocabulary

namespace daik::logic {

// One HomeHub register ↔ X10A concept pairing. `offset` is the EKRHH 1-based data-model offset
// (def/homehub.hpp), `concept_id` a logic/history.hpp trend id.
struct HomeHubConcept {
    uint16_t    offset;
    const char* concept_id;   // a logic/history.hpp trend id (`concept` is a C++20 keyword)
};

// The pairings. Derived from the EKRHH register semantics (guide §9.2 UC3) against what the X10A
// trend locators address — NOT from any resemblance between the two sides' label text.
//
// NOT PAIRED, and each for a stated reason rather than an oversight:
//   41 LWT-BUH        — the POST-BUH outlet (logic/cop_scope.hpp's R2T row). It is a different
//                       measurement point from `leaving_water` (which is pre-BUH by definition), and
//                       pairing them would be the substitution lwt_select.hpp refuses. No trend
//                       addresses the post-BUH row today, so it stays unpaired rather than borrowing
//                       the pre-BUH one.
//   45 liquid refrig. — X10A has the row (0x61/6, R3T) but no trend addresses it, so there is no
//                       concept id to name. Adding one is a history.hpp decision, not this file's.
//   51 power          — the real electrical input. X10A has NO equivalent at all: the dashboard
//                       ESTIMATES it from CT clamps at an assumed 230 V. Deliberately unpaired —
//                       pairing a measurement with an estimate would hide which one is which.
//   1/2/6/7/10/56/57/58, 3, 4, 9, 21/22/23 — setpoints, modes and faults. Trends buffer MEASURED
//                       rows only (a setpoint sits at its own offset and is not a reading), so no
//                       concept exists for them.
inline constexpr HomeHubConcept HOMEHUB_CONCEPTS[] = {
    { 40, "leaving_water" },   // LWT PHE     ↔ 0x61/2  pre-BUH heat-exchanger outlet
    { 42, "return_water"  },   // return      ↔ 0x61/8  Inlet water temp. (R4T)
    { 43, "dhw_tank"      },   // DHW tank    ↔ 0x61/10 DHW tank temp. (R5T)
    { 44, "outdoor_air"   },   // outdoor air ↔ 0x20/0  R1T-Outdoor air temp.
    { 49, "flow"          },   // flow        ↔ 0x62/9  Flow sensor (l/min)
    { 50, "room_temp"     },   // room        ↔ 0x61/12 Indoor ambient temp. (R1T)
};
inline constexpr size_t HOMEHUB_CONCEPT_COUNT =
    sizeof(HOMEHUB_CONCEPTS) / sizeof(HOMEHUB_CONCEPTS[0]);

// ── STATES: the same pairing for rows that are not MEASUREMENTS ────────────────────────────────
// The table above can only name quantities a TREND addresses, and trends buffer measured numbers.
// That left the plant's STATES — is the pump running, which way is the diverter pointing — unpaired
// for a reason that is about this file's vocabulary rather than about the data: both sources report
// them, plainly and unambiguously, and a reader looking at "3way valve OFF" is owed the gateway's
// answer next to it just as much as for a temperature.
//
// They need their own table because they need a WIDER KEY. `3way valve`, `2way valve`, `BSH`,
// `BUH Step1`, `BUH Step2` and `Water pump operation` all live in ONE dimensionless byte — 0x60/12 —
// and differ ONLY in which bit their converter masks. A (reg, offset, unit) locator, which is all a
// trend has, resolves every one of them to the same row: ask it for the diverter and it answers with
// the pump. So the key here is (reg, offset, CONVERTER), exactly one field wider and for exactly the
// reason logic/checkup.hpp carries the same third field.
//
// Measured over the shipped catalog, each locator below appears on 44 profiles and no other row
// shares its triple; the catalog test asserts both, plus the identity of the row it resolves to.
//
// NOT PAIRED, and this one is the interesting refusal:
//   52 DHW normal operation — X10A has no plain "is DHW running" flag. The nearest row is
//                       "Powerful DHW Operation. ON/OFF" (0x62/2 conv 304), which is the BOOST — a
//                       different fact that reads OFF through an ordinary hot-water cycle. Pairing
//                       them would put "off" beside a tank actively being charged, which is worse
//                       than the empty space it replaces. The gateway's flag stays Modbus-only, and
//                       it is what the fallback headline names the mode from.
struct HomeHubState {
    uint16_t    offset;      // EKRHH 1-based data-model offset (def/homehub.hpp)
    unsigned    reg;         // X10A register page
    unsigned    off;         // byte offset within that page
    unsigned    conv;        // converter id — the field that separates the six flags in 0x60/12
    const char* concept_id;  // this pairing's own id; must not collide with a trend id (asserted)
};
inline constexpr HomeHubState HOMEHUB_STATES[] = {
    { 30, 0x60, 12, 301, "pump_running" },  // Circulation pump running ↔ "Water pump operation"
    { 37, 0x60, 12, 306, "valve_dhw"    },  // 3-way valve              ↔ "3way valve(On:DHW_Off:Space)"
    { 53, 0x62,  2, 303, "space_op"     },  // Space h/c normal op.     ↔ "Space heating Operation ON/OFF"
};
inline constexpr size_t HOMEHUB_STATE_COUNT = sizeof(HOMEHUB_STATES) / sizeof(HOMEHUB_STATES[0]);

// The concept a HomeHub register carries, or nullptr when it has no X10A counterpart.
inline const char* homehub_concept_for(uint16_t offset) {
    for (const auto& c : HOMEHUB_CONCEPTS)
        if (c.offset == offset) return c.concept_id;
    for (const auto& s : HOMEHUB_STATES)
        if (s.offset == offset) return s.concept_id;
    return nullptr;
}

// The concept an X10A row carries, or nullptr. MEASUREMENTS resolve through trend_row_matches() —
// the SAME predicate the trend rings use, so a row pairs here exactly when it is the row the trend
// buffers. STATES resolve on their own (reg, offset, conv) triple. Never keyed on the label (see the
// header note).
inline const char* x10a_concept_for(unsigned reg, unsigned off, const char* unit, int conv) {
    for (const auto& d : TRENDS)
        if (trend_row_matches(d, reg, off, unit)) return d.id;
    for (const auto& s : HOMEHUB_STATES)
        if (s.reg == reg && s.off == off && s.conv == static_cast<unsigned>(conv)) return s.concept_id;
    return nullptr;
}

// Compile-time proof that every concept named above is a REAL trend id. Without this a renamed trend
// would leave a pairing pointing at nothing — the Modbus value would silently stop appearing beside
// its X10A row, with no error anywhere and nothing in the UI to notice it by.
namespace detail {
constexpr bool homehub_concepts_are_trends() {
    for (const auto& c : HOMEHUB_CONCEPTS) {
        bool found = false;
        for (const auto& d : TRENDS)
            if (trend_cstr_eq(c.concept_id, d.id)) { found = true; break; }
        if (!found) return false;
    }
    return true;
}
// The two vocabularies share ONE namespace — the browser matches an X10A row to a Modbus row on the
// concept string alone and cannot tell which table produced it. A state id that collided with a
// trend id would pair a temperature with a flag: the #35-#39 substitution shape, arriving through a
// name rather than a register. Also proves the ids are unique among themselves.
constexpr bool homehub_state_ids_are_distinct() {
    for (size_t i = 0; i < HOMEHUB_STATE_COUNT; i++) {
        for (const auto& d : TRENDS)
            if (trend_cstr_eq(HOMEHUB_STATES[i].concept_id, d.id)) return false;
        for (size_t j = i + 1; j < HOMEHUB_STATE_COUNT; j++)
            if (trend_cstr_eq(HOMEHUB_STATES[i].concept_id, HOMEHUB_STATES[j].concept_id)) return false;
    }
    return true;
}
// One HomeHub register may name at most one concept: the two tables are searched in order, so an
// offset in both would make the answer depend on that order rather than on the data.
constexpr bool homehub_offsets_are_distinct() {
    for (const auto& c : HOMEHUB_CONCEPTS)
        for (const auto& s : HOMEHUB_STATES)
            if (c.offset == s.offset) return false;
    return true;
}
}  // namespace detail
static_assert(detail::homehub_concepts_are_trends(),
              "a HOMEHUB_CONCEPTS entry names a trend id that logic/history.hpp does not define");
static_assert(detail::homehub_state_ids_are_distinct(),
              "a HOMEHUB_STATES id collides with a trend id or another state id");
static_assert(detail::homehub_offsets_are_distinct(),
              "a HomeHub offset appears in both HOMEHUB_CONCEPTS and HOMEHUB_STATES");

}  // namespace daik::logic
