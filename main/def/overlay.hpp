#pragma once
// HAND-WRITTEN supplement to the GENERATED per-model profiles — audited rows the offline catalog
// currently omits. The catalog-wide page-0x10 protection words remain the first block; the second
// block adds audited control/safety/actuator telemetry for the reference 4-8 kW monobloc.
//
// ── Why this file exists at all ───────────────────────────────────────────────────────────────────
// Every generated profile carries exactly SIX rows for page 0x10 (offsets 0, 1, 4, 5, 6, 8) while
// docs/REGISTERS.md §5 documents TWENTY-SIX. The omission is uniform — all 43 generated tables agree
// row-for-row — so it is not a per-model absence but the offline generator's page-0x10 input being
// narrower than the in-repo spec. Among the missing rows are the protection-retry counters, which are
// the input signal for the "silent protection retries" early warning (issue #69 UC5, spun off as
// #110). Converter 310 has been implemented and host-tested since PR #111, but no profile carries a
// row that uses it, so it decodes nothing in the field: conv 310 appears ZERO times across all 3694
// generated rows.
//
// That half cannot be fixed the normal way from this repo. The right fix is a `gen_profiles.py` run
// (maintained outside this repo, not available here), which would repair all 43 profiles and the
// other page-0x10 gaps at once. .claude/CLAUDE.md forbids hand-editing a generated table — correctly,
// and the reason is specific: a hand-added row changes the profile's DETECTION signature. This file
// is the way to add the rows WITHOUT touching a generated table and WITHOUT that hazard; see the
// overlay rule in logic/profile_view.hpp for why it structurally cannot move detection.
//
// ── This file is TEMPORARY ───────────────────────────────────────────────────────────────────────
// It is a bridge, not an architecture. When the generator emits the page-0x10 rows, DELETE this file
// and the `def::lookup_view` plumbing with it — a supplement that outlives its generator run is a
// second source of truth for the catalog, which is precisely the drift the domain audit exists to
// catch. Until then the rows below ARE audited: tools/domain/catalog_audit.cpp resolves the view, so
// these are cross-checked against docs/REGISTERS.md §5 exactly like a generated row, and the catalog
// guard in test/test_logic.cpp covers them too.
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "../logic/profile_view.hpp"
#include "../logic/value_def.hpp"
#include "registry.hpp"

namespace daik::def {

// The page these rows sit on. Single-page block by construction (logic/profile_view.hpp).
inline constexpr uint8_t OVERLAY_PAGE = 0x10;

// Page 0x10 offsets 10-12, transcribed from docs/REGISTERS.md §5 (register 0x10). Each byte packs
// FOUR fields: a drop-control flag at bit 7 (conv 307), a 3-bit protection-retry counter at bits 4-6
// (conv 310), a second drop flag at bit 3 (conv 303) and a second 3-bit counter at bits 0-2
// (conv 311). All four converters mask their own window, so the four rows share one byte without
// interfering — that masking is what PR #111 added for conv 310 and is pinned byte-for-byte in
// test/test_logic.cpp (0x95 -> 1 retry, not 149).
//
// IN BOUNDS ON THE WIRE: the captured page-0x10 reply in docs/X10A_PROTOCOL.md §8 announces
// LEN=0x12=18, i.e. a 20-byte frame = 3 header + 16 payload + 1 checksum. Offsets 10-12 sit inside
// those 16 bytes, so logic/registers.hpp's in_bounds() accepts them. This page is NOT variable-length
// the way page 0x00 is (where a smaller unit's short reply omits offset 12) — but if some model does
// answer short, in_bounds() already fails the row closed and hp_format skips it: an absent value, not
// a wrong one.
//
// OMITTED DELIBERATELY: §5's twelfth row, `0x10/12 conv 311 "Not in use"`. The `no_publish` flag
// exists to keep an absent-feature placeholder counting toward a DETECTION signature; this block is
// structurally invisible to detection, so there is nothing for the flag to preserve here and a row
// Daikin itself labels unused would only reach Home Assistant as a nameless number.
inline constexpr ValueDef retry_rows[] = {
    {0x10, 10, 307, 1, -1, "Discharge Temp. Drop"},
    {0x10, 10, 310, 1, -1, "Discharge Temp. Protection Retry Qty"},
    {0x10, 10, 303, 1, -1, "Comp. INV Current Drop"},
    {0x10, 10, 311, 1, -1, "Comp. INV Current Protection Retry Qty"},
    {0x10, 11, 307, 1, -1, "HP Drop Control"},
    {0x10, 11, 310, 1, -1, "HP Protection Retry Qty"},
    {0x10, 11, 303, 1, -1, "LP Drop Control"},
    {0x10, 11, 311, 1, -1, "LP Protection Retry Qty"},
    {0x10, 12, 307, 1, -1, "Fin Temp. Drop Control"},
    {0x10, 12, 310, 1, -1, "Fin Temp. Protection Retry Qty"},
    {0x10, 12, 303, 1, -1, "Other Drop Control"},
};

inline constexpr size_t RETRY_ROW_COUNT = sizeof(retry_rows) / sizeof(retry_rows[0]);

// The active reference profile's generated table intentionally exposes a curated subset. These 27
// rows are all present in docs/REGISTERS.md and live on pages that profile already polls, so adding
// them changes neither detection nor bus traffic. They are telemetry, not diagnoses: several
// proprietary flags (Demand Signal, valve energisation and protector polarity) must be correlated
// with live operating edges before an alert assigns them a stronger meaning. HP Forced FG is
// deliberately absent: it aliases bit 7 of the current profile's one-byte CT-L3 measurement. The
// availability ledger rejects that row while bit 7 is asserted, preventing a fictitious +64 A
// current step, but the flag itself remains unpublished until its polarity and the current mask are
// backed by wire evidence or model documentation.
inline constexpr const char* OBSERVABILITY_PROFILE =
    "altherma_ebla_edla_d_series_4_8kw_monobloc";

inline constexpr ValueDef observability_rows[] = {
    {0x10, 1, 307, 1, -1, "Thermostat ON/OFF"},
    {0x10, 1, 306, 1, -1, "Restart standby"},
    {0x10, 1, 305, 1, -1, "Startup Control"},
    {0x10, 1, 303, 1, -1, "Oil Return Operation"},
    {0x10, 1, 302, 1, -1, "Pressure equalizing operation"},
    {0x10, 1, 301, 1, -1, "Demand Signal"},
    {0x10, 1, 300, 1, -1, "Low noise control"},

    {0x30, 11, 307, 1, -1, "4 Way Valve"},
    {0x30, 12, 307, 1, -1, "Crank case heater"},
    {0x30, 13, 307, 1, -1, "Hot gas bypass valve (Y3S)"},
    {0x30, 13, 306, 1, -1, "LP bypass valve (Y2S)"},
    {0x30, 13, 305, 1, -1, "Y3S"},

    {0x60, 4, 152, 1, -1, "Error detailed code"},
    {0x60, 11, 306, 1, -1, "Thermal protector (Q1L) BUH"},
    {0x60, 11, 303, 1, -1, "Solar input"},
    {0x60, 12, 302, 1, -1, "Floor loop shut off valve"},

    {0x62, 2, 302, 1, -1, "System OFF (ON:System off)"},
    {0x62, 7, 307, 1, -1, "Add. Ext. RT Input Cool."},
    {0x62, 7, 306, 1, -1, "Add. Ext. RT Input Heat."},
    {0x62, 7, 305, 1, -1, "Main RT Cooling"},
    {0x62, 7, 304, 1, -1, "Main RT Heating"},
    {0x62, 7, 303, 1, -1, "Pwr consumption limit 4"},
    {0x62, 7, 302, 1, -1, "Pwr consumption limit 3"},
    {0x62, 7, 301, 1, -1, "Pwr consumption limit 2"},
    {0x62, 7, 300, 1, -1, "Pwr consumption limit 1"},
    {0x62, 8, 304, 1, -1, "PHE Heater"},

    {0x63, 13, 311, 1, -1, "BUH output capacity"},
};

inline constexpr size_t OBSERVABILITY_ROW_COUNT =
    sizeof(observability_rows) / sizeof(observability_rows[0]);

// hp_poll hands the BASE table (not the view) to profile_refrigerant() and to hp_format()'s
// reading_plausible() check, because both want a flat contiguous array and both only ever look at
// pressure / conv-405 rows. That is correct only while this block contains neither, so pin it here
// rather than trusting the comment: every row must be a dimensionless (type -1) single byte, and
// none may be the saturation-temperature converter whose curve selection depends on the profile.
inline constexpr bool overlay_is_dimensionless() {
    for (size_t i = 0; i < RETRY_ROW_COUNT; i++)
        if (retry_rows[i].type != -1 || retry_rows[i].size != 1 || retry_rows[i].conv == 405)
            return false;
    return true;
}
static_assert(overlay_is_dimensionless(),
              "overlay rows must stay dimensionless 1-byte non-405 rows — hp_poll passes the BASE "
              "table to profile_refrigerant()/reading_plausible(), which would then miss them");

inline constexpr bool observability_rows_are_safe() {
    if (OBSERVABILITY_ROW_COUNT != 27) return false;
    for (size_t i = 0; i < OBSERVABILITY_ROW_COUNT; i++)
        if (observability_rows[i].type != -1 || observability_rows[i].size != 1 ||
            observability_rows[i].no_publish || observability_rows[i].conv == 405)
            return false;
    return true;
}
static_assert(observability_rows_are_safe(),
              "observability rows must stay publishable dimensionless 1-byte non-405 values");

// The rows the firmware actually decodes, announces and sizes its buffers from: this model's
// generated table plus the block above when the model already reads page 0x10 (it does on all 43
// generated profiles and on `generic`; the rule is enforced, not assumed).
inline logic::ProfileView resolved(const Profile& p) {
    logic::ProfileView v =
        logic::profile_view(p.values, p.count, retry_rows, RETRY_ROW_COUNT, OVERLAY_PAGE);
    if (std::strcmp(p.id, OBSERVABILITY_PROFILE) != 0) return v;
    return logic::profile_view_extend_existing_pages(v, observability_rows,
                                                     OBSERVABILITY_ROW_COUNT);
}

// lookup() + resolved() — the one accessor every consumer should call. Using lookup() directly and
// iterating `.values` is what would let a consumer see a different row set than its neighbours.
inline logic::ProfileView lookup_view(const char* id) { return resolved(lookup(id)); }

} // namespace daik::def
