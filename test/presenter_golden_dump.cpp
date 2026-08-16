// Golden decision vectors for the three presenter rules the BROWSER re-implements, emitted from the
// real C++ headers. tools/presenter/presenter_parity.mjs re-decides the identical inputs with the
// production main/www/js/schematic.js and diffs; scripts/check-presenter-parity.sh runs the pair.
//
// WHY THIS EXISTS. logic/lwt_select.hpp, logic/cop_scope.hpp and logic/ou_stale.hpp each say, in
// their own header, that they have no firmware caller: they exist so CI can gate a rule the browser
// actually applies. That gets the C++ copy right and says nothing whatever about the JavaScript one
// — and the JavaScript one is the copy that ships to the user. docs/FEATURES.md records why this
// cross-language parity corpus exists. The gap is not hypothetical: a looser
// second copy of the leaving-water pattern once matched the bizone kit's MIXED leaving-water row,
// which is the #35-#39 shape (a correct number attributed to the wrong sensor) reaching ΔT, heat
// output and COP at once. docs/FEATURES.md explains why a looser second copy is not a test, and
// scripts/check-presenter-parity.sh names the resulting coverage gap. This closes it: the two
// copies are now compared, not merely both present.
//
// The corpus is the REAL catalOg, not a sample. Every distinct (label, register) pair the shipped
// profiles produce is emitted, because that is exactly the input space the rules run on and exactly
// where two spellings of one quantity hide. Adversarial synthetic labels follow, one per historical
// or structural trap.
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "logic/conv_override.hpp"   // adjudicated() — the row AS PUBLISHED, label override included
#include "logic/cop_scope.hpp"
#include "logic/label_override.hpp"
#include "logic/lwt_select.hpp"
#include "logic/ou_stale.hpp"
#include "logic/profile_view.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace daik;
using namespace daik::logic;

namespace {

// TAB separates fields and newline separates records, so a label carrying either would silently
// shift every later column and make a divergence look like a parity failure somewhere else. The
// catalog has none; refuse loudly rather than escape, since the escape would then need its own twin
// on the JavaScript side.
void require_clean(const std::string& label) {
    if (label.find('\t') != std::string::npos || label.find('\n') != std::string::npos) {
        std::fprintf(stderr, "presenter_golden_dump: label carries a tab or newline: %s\n",
                     label.c_str());
        std::exit(2);
    }
}

void emit_row(const std::string& label, unsigned reg) {
    require_clean(label);
    std::printf("ROW\t%s\t%u\t%d\t%d\t%d\t%d\n",
                label.c_str(), reg,
                lwt_is_pre_buh(label.c_str())        ? 1 : 0,
                lwt_is_measurement(label.c_str())    ? 1 : 0,
                cop_is_post_buh(label.c_str(), reg)  ? 1 : 0,
                ou_page_holds_over(reg)              ? 1 : 0);
}

const char* scope_name(CopScope s) {
    switch (s) {
        case CopScope::HeatPump: return "hp";
        case CopScope::Plant:    return "plant";
        default:                 return "null";
    }
}

const char* block_name(CopBlock b) {
    switch (b) {
        case CopBlock::NoPelSource:  return "no_pel";
        case CopBlock::BuhNoPostBuh: return "buh_no_r2t";
        case CopBlock::TankHeater:   return "tank_heater";
        default:                     return "null";
    }
}

const char* pel_name(PelSource p) {
    switch (p) {
        case PelSource::Ct:  return "CT";
        case PelSource::Inv: return "INV";
        default:             return "null";
    }
}

// One ORDERING case: a candidate list, then the index each selector picks out of it. The per-row
// predicates above cannot see this half — tier 1 must beat tier 2 no matter where each sits in the
// list, and "first match wins" is what makes the answer deterministic when a profile carries two.
void emit_pick(const char* id, const std::vector<std::pair<std::string, unsigned>>& rows) {
    std::vector<const char*> labels;
    std::vector<unsigned>    regs;
    labels.reserve(rows.size());
    regs.reserve(rows.size());
    for (const auto& r : rows) {
        require_clean(r.first);
        std::printf("PICKROW\t%s\t%s\t%u\n", id, r.first.c_str(), r.second);
        labels.push_back(r.first.c_str());
        regs.push_back(r.second);
    }
    std::printf("PICKANS\t%s\t%d\t%d\n", id,
                lwt_select(labels.data(), labels.size()),
                cop_post_buh_select(labels.data(), regs.data(), labels.size()));
}

} // namespace

int main() {
    std::printf("# presenter golden vectors — regenerate with test/presenter_golden_dump.cpp\n");

    // ── The catalog's own (label, register) pairs ──────────────────────────────────────────────
    // Through adjudicated(), because that is the label the browser is handed: a row whose published
    // identity logic/label_override.hpp corrects must be judged under the corrected spelling, or the
    // gate would compare the two copies on a string neither of them ever sees.
    std::set<std::pair<std::string, unsigned>> seen;
    for (const auto& p : def::profiles) {
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef row = adjudicated(v[i]);
            seen.emplace(std::string(row.label), static_cast<unsigned>(row.reg));
        }
    }
    for (const auto& e : seen) emit_row(e.first, e.second);
    // A COLLAPSE guard, deliberately not a pin: the catalog produces 179 distinct (label, register)
    // pairs today and gaining one is routine, so an equality here would fail on every generator run
    // and teach the reader to re-baseline it without looking. What must never happen quietly is the
    // corpus going to nothing — a changed accessor, an empty registry — because a parity gate over
    // zero rows passes with the loudest possible green.
    if (seen.size() < 150) {
        std::fprintf(stderr, "presenter_golden_dump: only %zu catalog rows — the corpus collapsed\n",
                     seen.size());
        return 2;
    }

    // ── Adversarial labels, one per trap ───────────────────────────────────────────────────────
    // Case folding, the mixed-zone row that a looser copy once selected, the "(R2T)" discharge twin
    // that shares its offset and converter with the hydronic outlet, the setpoint that must never
    // stand in for a measurement, and the four post-BUH spellings the catalog actually ships.
    static const std::pair<const char*, unsigned> kSynthetic[] = {
        {"LEAVING WATER TEMP. BEFORE BUH (R1T)",              0x61},
        {"leaving water temp. before buh (r1t)",              0x61},
        {"Leaving  Water  Temp.  before  BUH  (R1T)",         0x61},  // the double-space spelling
        {"Leaving water temp. mixed zone (R1T)",              0x61},  // EKMIK bizone — must NOT win
        {"LW setpoint (main)",                                0x61},
        {"Leaving water temp. setpoint before BUH (R1T)",     0x61},
        {"Leaving water temp. after BUH (R2T)",               0x61},
        {"Leaving Water Temp  after BUH (R2T)",               0x61},
        // The post-BUH reject tokens WITHOUT the (R2T) tag. Every post-BUH row the catalog ships
        // today carries both, so "after buh"/"after buffer" are redundant against "r2t" on the real
        // corpus and a copy that dropped them would diverge nowhere — measured, not assumed: the
        // selftest's mutation of those tokens passed until these two labels existed. They are what
        // the tokens are actually for, since a generator run may spell either half on its own.
        {"Leaving water temp. after BUH",                     0x61},
        {"Outlet water temp. after Buffer/BUH",               0x61},
        {"Outlet Water BUH Temp. (R2T)",                      0x61},
        {"[HPSU] Tvbh inflow Temp after Buffer/BUH (R2T)",    0x61},
        {"[HPSU] Tv inflow Temp  (R1T)",                      0x61},
        {"Outlet Water Heat Exch. Temp. (R1T)",               0x61},
        {"Leaving water temp. after PHE (R1T)",               0x61},
        {"Discharge pipe temp.(R2T)",                         0x20},  // held-over page, NOT water
        {"Leaving water temp. after BUH (R2T)",               0x20},  // water tokens on a dead page
        {"Leaving water temp. after BUH (R2T)",               0x21},
        {"O/U Heat Exch. Temp.(R4T)",                         0x20},
        {"Outdoor heat exchanger temp.",                      0x20},
        {"Outdoor Air Temp. (R1T)",                           0x20},  // (R1T) on the OUTDOOR sensor
        {"INV frequency (rps)",                               0x30},
        {"INV frequency (rps)",                               0x21},  // witness on a frozen page
        {"Inlet water temp. (R4T)",                           0x61},
        {"",                                                  0x61},
        {"r1t",                                               0x61},  // tag alone is not water
        {"leaving water",                                     0x61},  // water alone, no tag
        {"Leaving water temp. before BUH (R1T)",              0x62},
    };
    for (const auto& s : kSynthetic) emit_row(std::string(s.first), s.second);

    // ── Ordering ───────────────────────────────────────────────────────────────────────────────
    emit_pick("empty", {});
    emit_pick("none", {{"Inlet water temp. (R4T)", 0x61}, {"Water pressure", 0x61}});
    // Tier 2 appears FIRST in the list and tier 1 second: the tier must win, not the position.
    emit_pick("tier2_before_tier1", {{"Outlet water temp.", 0x61},
                                     {"Leaving water temp. before BUH (R1T)", 0x61}});
    // Only a setpoint and a mixed-zone row: blank is the right answer, never a substitute.
    emit_pick("reject_only", {{"LW setpoint (main)", 0x61},
                              {"Leaving water temp. mixed zone (R1T)", 0x61}});
    // Two tier-1 rows: first wins, deterministically.
    emit_pick("two_tier1", {{"Outlet Water Heat Exch. Temp. (R1T)", 0x61},
                            {"Leaving water temp. before BUH (R1T)", 0x61}});
    // The post-BUH pick must skip the held-over page and take the live one further down the list.
    emit_pick("postbuh_skips_held", {{"Leaving water temp. after BUH (R2T)", 0x20},
                                     {"Leaving water temp. before BUH (R1T)", 0x61},
                                     {"Leaving water temp. after BUH (R2T)", 0x61}});
    emit_pick("postbuh_none", {{"Leaving water temp. before BUH (R1T)", 0x61}});

    // ── The COP scope rule, exhaustively ───────────────────────────────────────────────────────
    // 3 electrical sources x 9 backup-heater step pairs x 3 tank-heater states x post-BUH row or
    // not = 162 combinations, i.e. every input the rule has.
    //
    // The two heater STEPS are enumerated as raw tri-states (-1 unknown / 0 off / 1 on) rather than
    // as the (known, on) pair cop_plan() takes, and the collapse to that pair is done HERE. That is
    // the point rather than an implementation detail: "UNKNOWN is not OFF" is the rule's most
    // dangerous step, off is its permissive branch, and a collapse performed on only one side of the
    // comparison is a step the gate cannot see. Measured — while the browser did this in its
    // caller, a copy that read an unknown tank heater as off passed this gate.
    static const PelSource kPel[] = {PelSource::None, PelSource::Ct, PelSource::Inv};
    static const int kTri[] = {-1, 0, 1};
    for (PelSource pel : kPel)
        for (int b1 : kTri)
            for (int b2 : kTri)
                for (int s : kTri)
                    for (int pb = 0; pb < 2; pb++) {
                        const bool buh_known = (b1 != -1) || (b2 != -1);
                        const bool buh_on    = (b1 == 1) || (b2 == 1);
                        const bool bsh_known = s != -1;
                        const bool bsh_on    = s == 1;
                        const CopPlan plan = cop_plan(pel, buh_known, buh_on,
                                                      bsh_known, bsh_on, pb != 0);
                        std::printf("COP\t%s\t%d\t%d\t%d\t%d\t%s\t%s\t%d\n",
                                    pel_name(pel), b1, b2, s, pb,
                                    scope_name(plan.scope), block_name(plan.block),
                                    plan.use_post_buh ? 1 : 0);
                    }
    return 0;
}
