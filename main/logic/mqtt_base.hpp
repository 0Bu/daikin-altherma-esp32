#pragma once
// WHICH MQTT BASE TOPIC THIS INSTALLATION PUBLISHES UNDER — the runtime half of what was, until now,
// a compile-time-only fact.
//
// The base topic is the INSTALLATION identity: every message topic sits directly under it
// (`<base>/x10a`, `<base>/heartbeat`, `<base>/crash`, …) and `device_node_id(base)`
// (logic/ha_device.hpp) slugifies it into the Home Assistant discovery node id. Kconfig's
// DAIKIN_MQTT_BASE_TOPIC help has always stated the consequence — "Two boards on one broker
// therefore need two base topics" — but the value was compile-time ONLY, while CI publishes exactly
// ONE esp32s3 image. So the requirement was unsatisfiable for anyone running the published build:
// every board flashed from the release or dev feed publishes under the same base, by construction.
//
// What that costs is not theoretical. Two boards on one base do not merely coexist noisily — they
// become ONE thing to every consumer downstream:
//   * every retained topic has two writers, so `<base>/heartbeat`, `<base>/x10a` and `<base>/crash`
//     each carry whichever board published last;
//   * a metrics consumer sees ONE series per field (the labels are identical), so two interleaved
//     uptime counters read as a sawtooth — measured on this project's own store, that inflated
//     `resets(daikin_heartbeat_uptime_s[7d])` from ~50 real reboots to 16272, and the day it was
//     worst the sample count doubled from 8500/day to 17138/day (#215);
//   * `device_node_id` is the same for both, so Home Assistant merges them into ONE device whose
//     entities flip between two units.
// None of that announces itself. Every number stays plausible, which is why it survived a week of
// reboot analysis before the sample count gave it away.
//
// This is the same rule board_presets.hpp already applies to the status LED and the recovery button:
// a fact that differs PER INSTALLATION cannot live in Kconfig when CI ships one binary. Compiling it
// in would fork the artifact, the manifest and the OTA feed per board.
//
// Pure + IDF-free so the rules are asserted host-side (test/test_logic.cpp) rather than discovered on
// a broker, where a bad base topic does not fail loudly — it publishes to the wrong place.
#include <string>

#include "ha_device.hpp"   // ha_slug — the node id must survive this, or two boards collide again

namespace daik {

// A base topic longer than this is refused. MQTT itself allows 65535 bytes, but this string is a
// PREFIX on every topic the firmware builds and is slugified into an HA node id that appears in every
// discovery topic and unique_id. The bound keeps those derived strings small on a heap-tight target;
// it is not a protocol limit and nothing here depends on the exact number.
inline constexpr size_t MQTT_BASE_MAX_LEN = 64;

// Why a base topic was refused: a stable machine `code` beside the English `message`. Both are string
// LITERALS — http_config.cpp interpolates them into JSON unescaped, so neither may ever carry user
// text. The pair exists for the reason env3.hpp's refusals carry one: the UI is localized, and a
// translatable code beside one canonical English wording lets the browser translate without the API
// losing its single answer. One code PER RULE, not one for the field, because "too long" and "that
// would collide in Home Assistant" need different things done about them.
struct MqttBaseRefusal {
    const char* code    = "";
    const char* message = "";
};

// Is `base` usable as THIS installation's MQTT base topic? Empty is VALID and means "use the
// compile-time default" (see mqtt_base_effective) — that is what keeps every already-deployed device
// byte-identical across the upgrade that introduced this field, so the change needs no migration.
inline bool mqtt_base_valid(const std::string& base, MqttBaseRefusal* out = nullptr) {
    auto fail = [&](const char* code, const char* message) {
        if (out) { out->code = code; out->message = message; }
        return false;
    };
    if (base.empty()) return true;                       // = the compile-time default, not a refusal
    if (base.size() > MQTT_BASE_MAX_LEN)
        return fail("mqtt_base_too_long", "Base topic is too long");
    // MQTT wildcards are meaningless in a topic being PUBLISHED to, and a broker rejects the PUBLISH
    // outright — which would present as "MQTT silently stopped working" after a save that answered ok.
    if (base.find('#') != std::string::npos || base.find('+') != std::string::npos)
        return fail("mqtt_base_wildcard", "Base topic must not contain + or #");
    // $SYS and friends are the broker's own reserved tree; publishing into it is refused or ignored.
    if (base.front() == '$')
        return fail("mqtt_base_reserved", "Base topic must not start with $");
    if (base.front() == '/' || base.back() == '/')
        return fail("mqtt_base_slash", "Base topic must not start or end with /");
    char prev = 0;
    for (char c : base) {
        const unsigned char u = static_cast<unsigned char>(c);
        // Control bytes are forbidden in MQTT topic names; a space is legal but turns every derived
        // topic into something no operator can paste into a broker CLI.
        if (u < 0x20 || u == 0x7F)
            return fail("mqtt_base_control", "Base topic must not contain control characters");
        if (c == ' ')
            return fail("mqtt_base_space", "Base topic must not contain spaces");
        if (c == '/' && prev == '/')
            return fail("mqtt_base_empty_segment", "Base topic must not contain an empty segment");
        prev = c;
    }
    // The load-bearing rule. device_node_id() falls back to the constant "daikin" when the base
    // slugifies to nothing, so a base of "___" would put two boards back on ONE Home Assistant device
    // — the exact collision this setting exists to end, re-created by a value that passed every check
    // above. Refuse it here rather than let the fallback quietly undo the user's intent.
    if (ha_slug(base.c_str()).empty())
        return fail("mqtt_base_not_sluggable", "Base topic must contain a letter or digit");
    return true;
}

// The base topic actually used, given what is stored and what was compiled in. Empty stored value =
// the Kconfig default, so a device upgraded onto this feature keeps publishing exactly where it
// did. One function rather than an `empty() ? … : …` at each call site: mqtt_ha.cpp derives every
// topic plus the HA node id from this string, and a second copy of the fallback rule is how one of
// them would end up on a different base from the rest.
inline std::string mqtt_base_effective(const std::string& stored, const char* compiled_default) {
    if (!stored.empty()) return stored;
    return compiled_default ? std::string(compiled_default) : std::string();
}

}  // namespace daik
