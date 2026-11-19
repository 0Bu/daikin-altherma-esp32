#pragma once
// UI LANGUAGE: which language the web UI renders in. IDF-free + host-tested.
//
// The web UI localises itself in the BROWSER: by default it picks a supported language from
// navigator.language, with no device involvement (main/www/js/i18n.js). This setting is the MANUAL
// override on top of that default — a persistent, per-installation choice that wins over the
// browser's guess and survives a reboot (config ui_lang, POST /set_lang; NVS blob v4).
//
//   Auto  the browser decides (the default — "auto until the user picks a language")
//   En    force English
//   De    force German
//   Es    force Spanish
//   Fr    force French
//   It    force Italian
//   Pl    force Polish
//   Cs    force Czech
//   Uk    force Ukrainian
//   Zh    force Simplified Chinese
//   Ja    force Japanese
//   Nb    force Norwegian Bokmal
//   Sv    force Swedish
//   Fi    force Finnish
//
// `Auto` is a first-class value, NOT the absence of a value: a device fresh out of the box, or one
// OTA-upgraded from a pre-v4 blob, reports "auto" and the browser keeps auto-detecting. Only when the
// user picks a named language does the device state one, and only then does that language override
// the browser default on every client that opens the dashboard.
//
// Pure so the enum <-> string/int mappings are asserted host-side rather than only on a device, and
// decoded DEFENSIVELY on the load path (an unknown stored byte reads as Auto — a garbled byte must
// not force a language the user never chose).
#include <string>
#include <string_view>

namespace daik {

enum class UiLang {
    Auto,  // browser-detected (the default)
    De,    // force German
    En,    // force English
    Es,    // force Spanish
    Fr,    // force French
    It,    // force Italian
    Pl,    // force Polish
    Cs,    // force Czech
    Uk,    // force Ukrainian
    Zh,    // force Simplified Chinese
    Ja,    // force Japanese
    Nb,    // force Norwegian Bokmal
    Sv,    // force Swedish
    Fi,    // force Finnish
};

inline const char* ui_lang_name(UiLang l) {
    switch (l) {
        case UiLang::De: return "de";
        case UiLang::En: return "en";
        case UiLang::Es: return "es";
        case UiLang::Fr: return "fr";
        case UiLang::It: return "it";
        case UiLang::Pl: return "pl";
        case UiLang::Cs: return "cs";
        case UiLang::Uk: return "uk";
        case UiLang::Zh: return "zh";
        case UiLang::Ja: return "ja";
        case UiLang::Nb: return "nb";
        case UiLang::Sv: return "sv";
        case UiLang::Fi: return "fi";
        default: return "auto";
    }
}

inline bool ui_lang_parse_exact(std::string_view s, UiLang& out) {
    struct Entry {
        const char* code;
        UiLang      lang;
    };
    static constexpr Entry kEntries[] = {
        {"auto", UiLang::Auto}, {"de", UiLang::De}, {"en", UiLang::En}, {"es", UiLang::Es},
        {"fr", UiLang::Fr},     {"it", UiLang::It}, {"pl", UiLang::Pl}, {"cs", UiLang::Cs},
        {"uk", UiLang::Uk},     {"zh", UiLang::Zh}, {"ja", UiLang::Ja}, {"nb", UiLang::Nb},
        {"sv", UiLang::Sv},     {"fi", UiLang::Fi},
    };
    for (const auto& entry : kEntries) {
        if (s == entry.code) {
            out = entry.lang;
            return true;
        }
    }
    return false;
}

// Accepts only the names /status and POST /set_lang document. Anything else is REFUSED rather
// than defaulted: a typo'd language silently meaning "auto" would look like the save worked.
inline bool ui_lang_valid(std::string_view s) {
    UiLang parsed = UiLang::Auto;
    return ui_lang_parse_exact(s, parsed);
}

// Parse a stored/POSTed language name, falling back to `def` for anything unrecognised. The fallback
// is for the LOAD path (an NVS blob written by a future build, a corrupt byte); the request path
// validates with ui_lang_valid first and rejects instead.
inline UiLang ui_lang_parse(std::string_view s, UiLang def = UiLang::Auto) {
    UiLang parsed = def;
    ui_lang_parse_exact(s, parsed);
    return parsed;
}

// On-flash encoding (logic/config_store.hpp blob v4). Kept HERE, next to the enum, so the stored byte
// and the enum cannot drift apart — and decoded DEFENSIVELY: any value this build does not know reads
// as Auto, so a garbled byte falls back to the browser default rather than forcing a language.
inline int32_t ui_lang_to_int(UiLang l) {
    switch (l) {
        case UiLang::De: return 1;
        case UiLang::En: return 2;
        case UiLang::Es: return 3;
        case UiLang::Fr: return 4;
        case UiLang::It: return 5;
        case UiLang::Pl: return 6;
        case UiLang::Cs: return 7;
        case UiLang::Uk: return 8;
        case UiLang::Zh: return 9;
        case UiLang::Ja: return 10;
        case UiLang::Nb: return 11;
        case UiLang::Sv: return 12;
        case UiLang::Fi: return 13;
        default: return 0;
    }
}
inline UiLang ui_lang_from_int(int32_t v) {
    switch (v) {
        case 1: return UiLang::De;
        case 2: return UiLang::En;
        case 3: return UiLang::Es;
        case 4: return UiLang::Fr;
        case 5: return UiLang::It;
        case 6: return UiLang::Pl;
        case 7: return UiLang::Cs;
        case 8: return UiLang::Uk;
        case 9: return UiLang::Zh;
        case 10: return UiLang::Ja;
        case 11: return UiLang::Nb;
        case 12: return UiLang::Sv;
        case 13: return UiLang::Fi;
        default: return UiLang::Auto;
    }
}

}  // namespace daik
