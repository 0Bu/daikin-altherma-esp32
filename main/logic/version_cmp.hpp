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

// Compare two dot-separated PRE-RELEASE identifier lists (semver §11.4), each still carrying its
// leading '-'/'+' marker. Load-bearing since the dev channel exists: CI stamps every merge to main
// as "<next release>-dev.<n>" (scripts/next-version.sh), so a device on the dev feed asks this
// function whether dev.12 is newer than dev.9 — and a plain strcmp answers NO (it compares '1' to
// '9'), which would freeze a dev board at the ninth build of a series forever. Numeric identifiers
// therefore compare NUMERICALLY; a numeric identifier ranks below an alphanumeric one; a prefix
// ranks below the longer list ("dev" < "dev.1"). Saturates like version_segment for the same reason.
inline int prerelease_compare(const char* a, const char* b) {
    if (*a != *b) return *a < *b ? -1 : 1;   // '-' vs '+': different kinds of suffix, ordered by byte
    ++a; ++b;                                 // skip the marker both sides share
    while (true) {
        if (*a == 0 || *b == 0) {
            if (*a == 0 && *b == 0) return 0;
            return *a == 0 ? -1 : 1;          // fewer identifiers -> lower precedence
        }
        const char* ae = a; while (*ae && *ae != '.') ++ae;
        const char* be = b; while (*be && *be != '.') ++be;
        auto all_digits = [](const char* p, const char* e) {
            if (p == e) return false;
            for (; p < e; ++p) if (*p < '0' || *p > '9') return false;
            return true;
        };
        const bool an = all_digits(a, ae), bn = all_digits(b, be);
        if (an && bn) {
            long long av = 0, bv = 0;
            for (const char* p = a; p < ae; ++p) if (av < 100000000LL) av = av * 10 + (*p - '0');
            for (const char* p = b; p < be; ++p) if (bv < 100000000LL) bv = bv * 10 + (*p - '0');
            if (av != bv) return av < bv ? -1 : 1;
        } else if (an != bn) {
            return an ? -1 : 1;               // numeric identifiers rank below alphanumeric ones
        } else {
            const size_t alen = static_cast<size_t>(ae - a), blen = static_cast<size_t>(be - b);
            const size_t n    = alen < blen ? alen : blen;
            const int    c    = n ? std::memcmp(a, b, n) : 0;
            if (c != 0)         return c < 0 ? -1 : 1;
            if (alen != blen)   return alen < blen ? -1 : 1;
        }
        a = (*ae == '.') ? ae + 1 : ae;
        b = (*be == '.') ? be + 1 : be;
    }
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
    return detail::prerelease_compare(as, bs);
}

// THE GATE: may we install `candidate` while running `running`?
//
// `allow_downgrade` is the CHANNEL SWITCH, and nothing else. A device that has been following the
// dev feed runs a version ahead of the last release, so "install the latest release" is a
// DOWNGRADE by version and the automatic gate below refuses it — leaving the release channel
// unreachable from a dev board, i.e. a one-way door. The flag opens that door, but only ever on a
// request that explicitly asked for it (POST /ota/update?downgrade=1, from a trusted-LAN client
// that just picked a channel in the UI). It is never inferred from the manifest, never persisted,
// and never the default — so the property that matters is intact: a hostile or stale manifest host
// still cannot walk a fleet backwards on its own say-so. It also does not weaken anything else:
// the RSA-3072 Secure Boot v2 signature check still has to pass on the image that arrives.
//
// Fails CLOSED — an unparseable version on either side refuses the install rather than assuming an
// ordering. "We could not tell" and "it is newer" must never be the same answer here. An EQUAL
// version is refused in both modes: re-installing what is already running is not a channel switch,
// it is a reboot loop.
inline bool ota_install_allowed(const std::string& running, const std::string& candidate,
                                bool allow_downgrade) {
    if (!version_valid(running) || !version_valid(candidate)) return false;
    const int c = version_compare(candidate, running);
    return allow_downgrade ? c != 0 : c > 0;
}

// The automatic gate: strictly newer only.
inline bool ota_is_upgrade(const std::string& running, const std::string& candidate) {
    return ota_install_allowed(running, candidate, /*allow_downgrade=*/false);
}

}  // namespace daik
