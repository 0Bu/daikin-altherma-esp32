#pragma once
// OTA UPDATE CHANNEL: which published feed this device follows. IDF-free + host-tested.
//
// CI publishes TWO feeds from one gh-pages site, and they are cut by different events:
//
//   release  <base>/manifest.json       — only a MANUAL workflow run tags v* and republishes this
//   dev      <base>/dev/manifest.json   — every firmware-relevant merge to main republishes this
//
// Before this split, every merge to main auto-tagged a release, so "the latest firmware" and "the
// last thing merged" were the same artifact and nobody could run one without the other. Now they
// are separate feeds and the device picks one (config ota_channel, POST /set_ota) — so a board can
// sit on releases while another follows main.
//
// The URLs are DERIVED here rather than being two more Kconfig strings, for the same reason
// ha_device.hpp derives one device identity for three publishers: a second configurable URL is a
// second thing that can silently point somewhere else, and the dev feed is not independently
// located — it is a subdirectory of the release feed by construction (scripts/build-pages.sh
// writes _site/dev/, scripts/publish-pages-branch.sh --dev owns exactly that subtree).
//
// Pure so the join rules are asserted: a base URL with or without its trailing slash must produce
// the same URL, and an EMPTY base must produce an empty string rather than a relative path that
// would be fetched against nothing and reported as an unreachable server.
#include <cstddef>
#include <cstring>
#include <string>

namespace daik {

enum class OtaChannel {
    Release,   // the manually-cut, tagged releases (the default)
    Dev,       // every firmware-relevant merge to main
};

// The dev feed's subdirectory under the published site root. One definition — the firmware, the
// Pages assembly script and the publish script all mean this same path.
inline constexpr const char* kOtaDevSubdir = "dev";

inline const char* ota_channel_name(OtaChannel c) { return c == OtaChannel::Dev ? "dev" : "release"; }

// Accepts only the two names /status and POST /set_ota document. Anything else is REFUSED rather
// than defaulted: a typo'd channel silently meaning "release" would look like the save worked.
inline bool ota_channel_valid(const std::string& s) { return s == "release" || s == "dev"; }

// Parse a stored/POSTed channel name, falling back to `def` for anything unrecognised. The fallback
// is for the LOAD path (an NVS blob written by a future build, a corrupt byte); the request path
// validates with ota_channel_valid first and rejects instead.
inline OtaChannel ota_channel_parse(const std::string& s, OtaChannel def = OtaChannel::Release) {
    if (s == "dev")     return OtaChannel::Dev;
    if (s == "release") return OtaChannel::Release;
    return def;
}

// On-flash encoding (logic/config_store.hpp blob v3). Kept HERE, next to the enum, so the stored
// byte and the enum cannot drift apart — and decoded DEFENSIVELY: any value this build does not
// know reads as Release, because a garbled byte must not silently move a board onto the fast feed.
inline int32_t ota_channel_to_int(OtaChannel c) { return c == OtaChannel::Dev ? 1 : 0; }
inline OtaChannel ota_channel_from_int(int32_t v) { return v == 1 ? OtaChannel::Dev : OtaChannel::Release; }

// Join `rest` onto `base` with exactly one '/' between them. An EMPTY base yields an empty string:
// the caller must report "no update URL configured", never fetch a relative path.
inline std::string ota_url_join(const std::string& base, const std::string& rest) {
    if (base.empty()) return "";
    if (rest.empty()) return base;
    std::string out = base;
    if (out.back() != '/') out += '/';
    out += rest;
    return out;
}

// The manifest to check for THIS channel. The release channel uses the configured manifest URL
// verbatim (CONFIG_DAIKIN_OTA_MANIFEST_URL — a full URL, historically settable on its own); the dev
// channel is always <firmware base>/dev/manifest.json, since that is where CI puts it.
inline std::string ota_channel_manifest_url(const std::string& release_manifest_url,
                                            const std::string& firmware_base_url, OtaChannel c) {
    if (c == OtaChannel::Release) return release_manifest_url;
    return ota_url_join(ota_url_join(firmware_base_url, kOtaDevSubdir), "manifest.json");
}

// Resolve a file published beside the selected manifest.  Release manifests may be hosted at a
// custom path independent of CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, so deriving changelog.json from
// the exact checked URL keeps custom feeds coherent instead of silently jumping back to the
// default firmware base.  A URL without a directory separator is unusable and fails closed.
inline bool ota_manifest_sibling_url(const std::string& manifest_url, const char* sibling,
                                     char* out, size_t outlen) {
    if (!out || outlen == 0) return false;
    out[0] = '\0';
    if (manifest_url.empty() || !sibling || sibling[0] == '\0') return false;
    const auto slash = manifest_url.rfind('/');
    if (slash == std::string::npos) return false;
    const size_t prefix_len = slash + 1;
    const size_t sibling_len = std::strlen(sibling);
    if (prefix_len + sibling_len >= outlen) return false;
    std::memcpy(out, manifest_url.data(), prefix_len);
    std::memcpy(out + prefix_len, sibling, sibling_len + 1);
    return true;
}

// The image to download for THIS channel. `image` is the per-target file name the manifest's feed
// carries (daikin-altherma-esp32<suffix>.bin).
inline std::string ota_channel_firmware_url(const std::string& firmware_base_url, OtaChannel c,
                                            const std::string& image) {
    const std::string dir =
        (c == OtaChannel::Dev) ? ota_url_join(firmware_base_url, kOtaDevSubdir) : firmware_base_url;
    return ota_url_join(dir, image);
}

// Does this version string come from the dev feed? Purely a LABEL question — the install decision is
// version_cmp.hpp's, never this. CI stamps dev builds as "<next release>-dev.<n>" (scripts/
// next-version.sh), so the marker is the pre-release identifier, not a substring anywhere in the
// string: "1.0.8-dev.3" is a dev build, a hypothetical "1.0.8-rcdev" is not.
inline bool ota_version_is_dev(const std::string& v) {
    const std::string::size_type dash = v.find('-');
    if (dash == std::string::npos) return false;
    const std::string suffix = v.substr(dash + 1);
    return suffix == "dev" || suffix.compare(0, 4, "dev.") == 0;
}

}  // namespace daik
