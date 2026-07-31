#pragma once
// UI LANGUAGE: which language the web UI renders in. IDF-free + host-tested.
//
// The web UI is bilingual (de/en) and localises itself in the BROWSER: by default it picks the
// language from navigator.language, with no device involvement (main/www/js/i18n.js). This setting is
// the MANUAL override on top of that default — a persistent, per-installation choice that wins over
// the browser's guess and survives a reboot (config ui_lang, POST /set_lang; NVS blob v4).
//
//   Auto  the browser decides (the default — "auto until the user picks a language")
//   De    force German
//   En    force English
//
// `Auto` is a first-class value, NOT the absence of a value: a device fresh out of the box, or one
// OTA-upgraded from a pre-v4 blob, reports "auto" and the browser keeps auto-detecting. Only when the
// user picks De/En does the device state a language, and only then does that language override the
// browser default on every client that opens the dashboard.
//
// Pure so the enum <-> string/int mappings are asserted host-side rather than only on a device, and
// decoded DEFENSIVELY on the load path (an unknown stored byte reads as Auto — a garbled byte must
// not force a language the user never chose).
#include <string>

namespace daik {

enum class UiLang {
    Auto,   // browser-detected (the default)
    De,     // force German
    En,     // force English
};

inline const char* ui_lang_name(UiLang l) {
    return l == UiLang::De ? "de" : l == UiLang::En ? "en" : "auto";
}

// Accepts only the three names /status and POST /set_lang document. Anything else is REFUSED rather
// than defaulted: a typo'd language silently meaning "auto" would look like the save worked.
inline bool ui_lang_valid(const std::string& s) { return s == "auto" || s == "de" || s == "en"; }

// Parse a stored/POSTed language name, falling back to `def` for anything unrecognised. The fallback
// is for the LOAD path (an NVS blob written by a future build, a corrupt byte); the request path
// validates with ui_lang_valid first and rejects instead.
inline UiLang ui_lang_parse(const std::string& s, UiLang def = UiLang::Auto) {
    if (s == "de")   return UiLang::De;
    if (s == "en")   return UiLang::En;
    if (s == "auto") return UiLang::Auto;
    return def;
}

// On-flash encoding (logic/config_store.hpp blob v4). Kept HERE, next to the enum, so the stored byte
// and the enum cannot drift apart — and decoded DEFENSIVELY: any value this build does not know reads
// as Auto, so a garbled byte falls back to the browser default rather than forcing a language.
inline int32_t ui_lang_to_int(UiLang l) { return l == UiLang::De ? 1 : l == UiLang::En ? 2 : 0; }
inline UiLang ui_lang_from_int(int32_t v) { return v == 1 ? UiLang::De : v == 2 ? UiLang::En : UiLang::Auto; }

}  // namespace daik
