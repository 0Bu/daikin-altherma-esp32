#pragma once
// HAND-WRITTEN supplement to the GENERATED per-model profiles — the page-0x10 protection words.
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

// The rows the firmware actually decodes, announces and sizes its buffers from: this model's
// generated table plus the block above when the model already reads page 0x10 (it does on all 43
// generated profiles and on `generic`; the rule is enforced, not assumed).
inline logic::ProfileView resolved(const Profile& p) {
    return logic::profile_view(p.values, p.count, retry_rows, RETRY_ROW_COUNT, OVERLAY_PAGE);
}

// lookup() + resolved() — the one accessor every consumer should call. Using lookup() directly and
// iterating `.values` is what would let a consumer see a different row set than its neighbours.
inline logic::ProfileView lookup_view(const char* id) { return resolved(lookup(id)); }

} // namespace daik::def
