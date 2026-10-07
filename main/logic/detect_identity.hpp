#pragma once
// What a detection candidate set ESTABLISHES about the unit's identity — the rule behind
// /status.detect.model. IDF-free so test/test_logic.cpp pins it.
//
// The profile the firmware READS with (`profile.id` in /status) is chosen by logic/detect.hpp
// detect_best: when several profiles fit the bus fingerprint equally, the lowest id wins. That
// makes the pick stable, not true. On the reference unit — an Altherma 3 R split — the tie between
// the register-identical ERGA E and EBLA/EDLA tables is broken towards the EBLA/EDLA MONOBLOC id,
// and /status.detect.model used to report that pick's name, family and marketing name as if
// detection had established them. The web UI already refused to show it (it names a model only when
// one family remains), but every other consumer of /status — MCP get_status, scripts, a person
// reading the JSON — got "Altherma 3 M (EBLA/EDLA)" for a unit that is not one.
//
// So each field is reported only as far as the candidate set supports it:
//   - name:      only when the set has at most one member (no set at all is a manual or Protocol S
//                choice, which the user or the protocol made, not the tie-break);
//   - family:    when every candidate belongs to the representative's family;
//   - marketing: when every candidate carries the representative's non-empty marketing name.
// A field the set does not establish is null, never the representative's guess. When nothing is
// established the whole object is null.

#include <cstring>

namespace daik::logic {

// Accumulates, candidate by candidate, whether the set agrees with the representative. Kept as a
// running tally so the /status builder needs no per-candidate array on the httpd stack.
struct IdentityAgreement {
    int  seen      = 0;
    bool family    = true;
    bool marketing = true;
};

inline void identity_agree(IdentityAgreement& a, const char* rep_family, const char* rep_marketing,
                           const char* cand_family, const char* cand_marketing) {
    a.seen++;
    if (!rep_family || !cand_family || std::strcmp(rep_family, cand_family) != 0) a.family = false;
    if (!rep_marketing || !*rep_marketing || !cand_marketing ||
        std::strcmp(rep_marketing, cand_marketing) != 0)
        a.marketing = false;
}

struct EstablishedIdentity {
    const char* name      = nullptr;
    const char* family    = nullptr;
    const char* marketing = nullptr;
    bool        any() const { return name || family || marketing; }
};

// `rep_*` describe the profile actually read (all nullptr when it has no display metadata, e.g.
// `generic`); `total` is the full candidate count, which may exceed the candidates fed to `a` when
// the caller truncates its list — an unseen candidate could disagree, so a short tally establishes
// nothing beyond the name rule.
inline EstablishedIdentity established_identity(const char* rep_name, const char* rep_family,
                                                const char*              rep_marketing,
                                                const IdentityAgreement& a, int total) {
    EstablishedIdentity out;
    if (!rep_name) return out;
    if (total <= 1) {
        out.name      = rep_name;
        out.family    = rep_family;
        out.marketing = rep_marketing;
        return out;
    }
    const bool complete = a.seen == total;
    if (complete && a.family) out.family = rep_family;
    if (complete && a.marketing) out.marketing = rep_marketing;
    return out;
}

} // namespace daik::logic
