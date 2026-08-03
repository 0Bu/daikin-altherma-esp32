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
// (register page, byte offset, unit, plus converter for a shared bit byte)" — which is precisely the
// concept this pairing needs, and the catalog test already proves each locator resolves to exactly
// one row on every profile. Inventing a
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
//   1/2/6/7/10/57/58, 3, 4, 21/22/23 — setpoints, other modes and faults. No paired measurement
//                       concept exists for them. Offsets 9 and 37 are exact state pairs below;
//                       offset 56 is the unpaired Smart-Grid state-timeline exception.
inline constexpr HomeHubConcept HOMEHUB_CONCEPTS[] = {
    { 40, "leaving_water" },   // LWT PHE     ↔ 0x61/2  pre-BUH heat-exchanger outlet
    { 42, "return_water"  },   // return      ↔ 0x61/8  Inlet water temp. (R4T)
    { 43, "dhw_tank"      },   // DHW tank    ↔ 0x61/10 DHW tank temp. (R5T)
    { 44, "outdoor_air"   },   // outdoor air ↔ 0x20/0  R1T-Outdoor air temp.
    { 49, "flow"          },   // flow        ↔ 0x62/9  Flow sensor (l/min)
    { 50, "room_temp"     },   // room        ↔ 0x61/12 Indoor ambient temp. (R1T)
    { 32, "bsh_state"     },   // booster run ↔ 0x60/12 conv 305 BSH (DHW immersion heater)
    { 37, "valve_dhw"     },   // 3-way valve ↔ 0x60/12 conv 306 (1 = DHW, 0 = space circuit)
    {  9, "quiet_state"    },   // Quiet mode ↔ 0x60/2 conv 301 Silent Mode
};
inline constexpr size_t HOMEHUB_CONCEPT_COUNT =
    sizeof(HOMEHUB_CONCEPTS) / sizeof(HOMEHUB_CONCEPTS[0]);

// Histories are a slightly wider contract than source PAIRING. The six measurements and three exact
// state flags/selectors above are still paired one-for-one, while Smart-Grid mode is
// assembled from TWO X10A contacts and
// therefore cannot honestly be attached to either source row as its twin. It can still share one
// history concept: both sources report the same documented 0..3 enum, and the UI draws their state
// tracks independently so a disagreement remains visible.
//
// Keep this explicit rather than accepting any HomeHub number by label or kind. A state/setpoint
// costs a 576-byte ring per source only by being named here and in TRENDS.
struct HomeHubHistory {
    uint16_t    offset;
    const char* trend_id;
};
inline constexpr HomeHubHistory HOMEHUB_HISTORIES[] = {
    { 40, "leaving_water"   },
    { 42, "return_water"    },
    { 43, "dhw_tank"        },
    { 44, "outdoor_air"     },
    { 49, "flow"            },
    { 50, "room_temp"       },
    { 32, "bsh_state"       },
    { 37, "valve_dhw"       },
    {  9, "quiet_state"     },
    { 56, "smart_grid_mode" },
};
inline constexpr size_t HOMEHUB_HISTORY_COUNT =
    sizeof(HOMEHUB_HISTORIES) / sizeof(HOMEHUB_HISTORIES[0]);

// Stable ring index for one paired reading/state concept. The Modbus history recorder and
// GET /history?source=modbus both use this, so a concept can never be written into one slot and read
// back from another. Unknown and unpaired state concepts deliberately resolve to -1.
inline constexpr int homehub_concept_index(const char* concept_id) {
    for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++)
        if (trend_cstr_eq(HOMEHUB_CONCEPTS[i].concept_id, concept_id)) return static_cast<int>(i);
    return -1;
}

// Stable ring index for every HomeHub history, including the unpaired Smart-Grid state timeline.
inline constexpr int homehub_history_index(const char* trend_id) {
    for (size_t i = 0; i < HOMEHUB_HISTORY_COUNT; i++)
        if (trend_cstr_eq(HOMEHUB_HISTORIES[i].trend_id, trend_id)) return static_cast<int>(i);
    return -1;
}

// ── OTHER STATES: live pairings that do not need their own history ─────────────────────────────
// BSH, the 3-way valve and Quiet belong above because they are trended. The remaining plant states — pump
// running and space heating/cooling operation — are paired live without spending another history
// ring: both sources report them plainly, and a reader looking at a state is owed the gateway's
// answer too.
//
// They need their own table because they need a WIDER KEY. `3way valve`, `2way valve`, `BSH`,
// `BUH Step1`, `BUH Step2` and `Water pump operation` all live in ONE dimensionless byte — 0x60/12 —
// and differ ONLY in which bit their converter masks. The key here is therefore (reg, offset,
// CONVERTER), the same discriminator the BSH BinaryEvent trend and logic/checkup.hpp use.
//
// Measured over the detectable shipped catalog, each locator below appears on 39 profiles and no
// other row shares its triple; the catalog test asserts both, plus the resolved row's identity.
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

// The concept an X10A row carries, or nullptr. TRENDED rows resolve through trend_row_matches() —
// the SAME predicate the trend rings use, so a row pairs here exactly when it is the row the trend
// buffers. STATES resolve on their own (reg, offset, conv) triple. Never keyed on the label (see the
// header note).
inline const char* x10a_concept_for(unsigned reg, unsigned off, const char* unit, int conv) {
    for (const auto& d : TRENDS)
        if (trend_row_matches(d, reg, off, unit, conv)) return d.id;
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
constexpr bool homehub_histories_are_valid() {
    // The first entries must reproduce every paired concept exactly. This makes the apparent
    // duplication above mechanically closed: changing a pairing without its history is a build
    // error, not a missing second line in the browser.
    if (HOMEHUB_HISTORY_COUNT < HOMEHUB_CONCEPT_COUNT) return false;
    for (size_t i = 0; i < HOMEHUB_CONCEPT_COUNT; i++) {
        if (HOMEHUB_HISTORIES[i].offset != HOMEHUB_CONCEPTS[i].offset ||
            !trend_cstr_eq(HOMEHUB_HISTORIES[i].trend_id, HOMEHUB_CONCEPTS[i].concept_id)) return false;
    }
    for (size_t i = 0; i < HOMEHUB_HISTORY_COUNT; i++) {
        bool trend = false;
        for (const auto& d : TRENDS)
            if (trend_cstr_eq(HOMEHUB_HISTORIES[i].trend_id, d.id)) { trend = true; break; }
        if (!trend) return false;
        for (size_t j = i + 1; j < HOMEHUB_HISTORY_COUNT; j++)
            if (HOMEHUB_HISTORIES[i].offset == HOMEHUB_HISTORIES[j].offset ||
                trend_cstr_eq(HOMEHUB_HISTORIES[i].trend_id, HOMEHUB_HISTORIES[j].trend_id)) return false;
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
static_assert(detail::homehub_histories_are_valid(),
              "HomeHub histories drifted from their paired concepts or name an invalid trend");
static_assert(detail::homehub_state_ids_are_distinct(),
              "a HOMEHUB_STATES id collides with a trend id or another state id");
static_assert(detail::homehub_offsets_are_distinct(),
              "a HomeHub offset appears in both HOMEHUB_CONCEPTS and HOMEHUB_STATES");

}  // namespace daik::logic
