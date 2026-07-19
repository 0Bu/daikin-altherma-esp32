#pragma once
// OTA downgrade gate: compare two firmware version strings. IDF-free + host-tested.
//
// A signature proves a build is AUTHENTIC, not that it is NEWER. Secure Boot v2 verification will
// happily install a correctly-signed OLDER image — so a host that serves an authentic but
// vulnerable back-version could walk a fleet backwards onto a fixed bug. This gate is the only
// thing standing between the manifest and that, which is why it is pure logic with its own CHECKs
// rather than an inline comparison in the download path.
//
// The version format is NOT open-ended here: PROJECT_VER comes from the committed version.txt
// (ESP-IDF prefers it over `git describe` whenever the file exists, which it always does in this
// repo), CI rewrites that file to the release version before building, and
// scripts/ci-build-all.sh then reads the version back OUT of the built image and refuses to
// publish if it disagrees with the manifest. So the strings compared here are plain dotted
// MAJOR.MINOR.PATCH triples in practice. The suffix/`v`-prefix handling below is defensive, for a
// hand-built manifest or a local build, not something the release path produces.
#include <cstring>
#include <string>

namespace daik {

namespace detail {

// Read the next dot-separated numeric segment from [p,end), advancing p past it and one following
// '.'. An exhausted or non-numeric segment reads as 0, so "1.0" and "1.0.0" compare equal.
// Digits accumulate against a ceiling: a hostile manifest carrying a 400-digit "version" must not
// overflow a signed long long (undefined behaviour). Saturating instead means two absurd versions
// compare EQUAL, which the gate then reads as "not newer" and refuses — the safe direction.
inline long long version_segment(const char*& p, const char* end) {
    long long v = 0;
    while (p < end && *p >= '0' && *p <= '9') {
        if (v < 100000000LL) v = v * 10 + (*p - '0');   // real versions are tiny; saturate the rest
        ++p;
    }
    if (p < end && *p == '.') ++p;
    return v;
}

// Split a version into its numeric core and its pre-release/build suffix, skipping one leading
// 'v'/'V' (a git tag pasted into a manifest reads as "v1.0.1"; without this it would parse as a
// core of 0 and compare BELOW every real version — a silent refusal to ever update).
inline void version_split(const std::string& s, const char*& core, const char*& core_end,
                          const char*& suffix) {
    const char* p = s.c_str();
    if (*p == 'v' || *p == 'V') ++p;
    core = p;
    while (*p && *p != '-' && *p != '+') ++p;
    core_end = p;
    suffix   = p;   // "" when there is none
}

}  // namespace detail

// Is this a version string we are willing to reason about at all? Requires a non-empty numeric core
// made only of digits and dots, with at least one digit. Anything else — an empty string, "unknown",
// an HTML error page's first line that a broken manifest host returned — is NOT ordered against real
// versions; the gate refuses rather than guessing.
inline bool version_valid(const std::string& s) {
    const char *core, *core_end, *suffix;
    detail::version_split(s, core, core_end, suffix);
    if (core == core_end) return false;
    bool digit = false;
    for (const char* p = core; p < core_end; ++p) {
        if (*p >= '0' && *p <= '9') digit = true;
        else if (*p != '.')         return false;
    }
    return digit;
}

// Returns <0, 0, >0 like strcmp. Numeric segments compare NUMERICALLY, so 1.10.0 > 1.9.0 — the
// whole reason this is not a strcmp. Equal cores fall back to the semver pre-release rule
// (1.0.0-rc1 < 1.0.0), then a lexical suffix tie-break.
inline int version_compare(const std::string& a, const std::string& b) {
    const char *ac, *ae, *as;  detail::version_split(a, ac, ae, as);
    const char *bc, *be, *bs;  detail::version_split(b, bc, be, bs);
    const char *ap = ac, *bp = bc;
    for (int i = 0; i < 4; ++i) {   // MAJOR.MINOR.PATCH plus one spare; missing segments read 0
        const long long av = detail::version_segment(ap, ae);
        const long long bv = detail::version_segment(bp, be);
        if (av != bv) return av < bv ? -1 : 1;
    }
    const bool a_pre = *as != 0, b_pre = *bs != 0;
    if (a_pre != b_pre) return a_pre ? -1 : 1;   // a release outranks its own pre-releases
    if (!a_pre) return 0;
    const int c = std::strcmp(as, bs);
    return c < 0 ? -1 : (c > 0 ? 1 : 0);
}

// THE GATE: may we install `candidate` while running `running`?
// Fails CLOSED — an unparseable version on either side refuses the update rather than assuming an
// ordering. "We could not tell" and "it is newer" must never be the same answer here.
inline bool ota_is_upgrade(const std::string& running, const std::string& candidate) {
    if (!version_valid(running) || !version_valid(candidate)) return false;
    return version_compare(candidate, running) > 0;
}

}  // namespace daik
