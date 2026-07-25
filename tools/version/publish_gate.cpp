// Would a device sitting on the PUBLISHED version accept the version we are about to publish?
//
// This is the publish-side guard against a feed moving BACKWARDS. It happened: on 2026-07-24 the
// repository's v* tags were deleted, scripts/next-version.sh fell back to the version.txt floor
// (1.0.0), and the very next merge republished the dev feed as 1.0.0-dev.168 — below the
// 1.0.14-dev.2 it had served minutes earlier. Nothing failed. Every dev device correctly refused
// the "update", so the feed simply stopped being able to move anyone forward, silently, and the
// only visible trace was a version string nobody was looking at.
//
// The question is deliberately asked in the DEVICE's own words rather than by comparing version
// strings here: ota_is_upgrade() is the exact predicate main/ota_update.cpp applies before it
// installs anything (logic/version_cmp.hpp, host-tested in test/test_logic.cpp). So a publish
// passes this gate if and only if a board on the currently-published build would take it. A second
// comparison implementation living in a shell script could drift from that rule — and the drift
// would be invisible until a fleet stopped updating.
//
//   publish_gate <published-version> <candidate-version> [--release]
//
// --release additionally requires the candidate to be a plain release version. Ordering alone does
// not say that: 1.0.14-dev.3 is a perfectly good upgrade from 1.0.13, and publishing it to the
// ROOT feed would still be wrong — that feed is defined as the builds cut by hand, and a device
// following `release` would then be running a dev build it never opted into.
//
// Exit: 0 = the candidate is installable from the published one (publish it)
//       1 = it is not (equal, older, unparseable on either side, or a pre-release on the root feed)
//       2 = usage
//
// The caller resolves <published-version> from the feed being written (scripts/check-publish-version.sh);
// "nothing published yet" is that script's case to decide, not this one's — here, an empty string is
// simply an unparseable version and fails closed.

#include "logic/version_cmp.hpp"

#include <cstdio>
#include <string>

int main(int argc, char** argv) {
    bool release_feed = false;
    if (argc == 4 && std::string(argv[3]) == "--release") release_feed = true;
    else if (argc != 3) {
        std::fprintf(stderr, "usage: publish_gate <published-version> <candidate-version> [--release]\n");
        return 2;
    }
    const std::string published = argv[1];
    const std::string candidate = argv[2];

    // The shape check first: a suffix on the root feed is a wrong ARTIFACT, not a wrong order, and
    // saying "not newer" about 1.0.14-dev.3 over 1.0.13 would be a false diagnosis of a real fault.
    if (release_feed && daik::version_valid(candidate)) {
        const char *core, *core_end, *suffix;
        daik::detail::version_split(candidate, core, core_end, suffix);
        if (*suffix != 0) {
            std::fprintf(stderr,
                         "publish gate: REFUSING to publish %s to the RELEASE feed — it carries the "
                         "pre-release/build suffix '%s'; that feed serves hand-cut releases only\n",
                         candidate.c_str(), suffix);
            return 1;
        }
    }

    if (daik::ota_is_upgrade(published, candidate)) {
        std::printf("publish gate: %s -> %s is an upgrade\n", published.c_str(), candidate.c_str());
        return 0;
    }

    // Name WHICH way it failed: "not newer" covers three very different mistakes, and the fix for
    // each is different (a lost tag, a re-run of an already-published build, a malformed floor).
    const char* why;
    if (!daik::version_valid(published))      why = "the published version is unparseable";
    else if (!daik::version_valid(candidate)) why = "the candidate version is unparseable";
    else if (daik::version_compare(published, candidate) == 0) why = "it is the version already published";
    else                                                       why = "it is OLDER than the published version";
    std::fprintf(stderr, "publish gate: REFUSING to publish %s over %s — %s\n",
                 candidate.c_str(), published.c_str(), why);
    return 1;
}
