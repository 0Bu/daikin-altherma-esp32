#pragma once
// A NUMERIC fault state beside the TEXTUAL Daikin diagnostic code — issue #209 defect 4.
//
// Converters 203 (error class) and 204 (error code) are deliberately textual: "Normal"/"Error" and
// "00"/"U4"/"7H" are what a human, the web UI and Home Assistant want, and mapping every Daikin code
// onto an invented numeric enum would be a guess with no authority behind it. But the grouped state
// topic is ALSO consumed as metrics JSON (Telegraf → VictoriaMetrics on this install), and a metrics
// parser drops a string:
//
//   • "00" (no fault) can be read as the number 0 and become a series;
//   • "U4" cannot become a sample at all — it is simply dropped;
//   • so the last numeric value stays put, and an alert on `error_code != 0` never fires for
//     exactly the alphanumeric faults it exists to catch.
//
// The fix is NOT to change the textual field's type (that is the mistake #209 defect 3 documents,
// from the other direction). It is to publish a small, permanently-numeric companion pair beside it
// and leave the diagnostic code alone:
//
//   { "error_type": "Error", "error_code": "U4", "error_active": 1, "warning_active": 0 }
//
// The companions are DERIVED from the error-CLASS row rather than from the code, because the class
// is what Daikin itself uses to say how bad it is, and it is a 4-value enum rather than an open
// alphanumeric space. They are derived from the class INDEX via the same ERR_TYPE table conv 203
// decodes through — the inverse of that one lookup, not a second opinion about what the labels mean.
#include <cstddef>

#include "convert.hpp"   // ERR_TYPE — the one table conv 203 decodes through

namespace daik {

// The error classes conv 203 decodes: an index into ERR_TYPE. Unknown is the `?` case — a byte
// outside 0-3, which conv 203 renders as "?" and which must NOT be reported as "no fault".
enum class FaultClass : int { Normal = 0, Error = 1, Warning = 2, Caution = 3, Unknown = -1 };

inline constexpr int FAULT_CLASS_COUNT = 4;   // sizeof ERR_TYPE — pinned by the test

// Inverse of conv 203: which class produced this label. Matching against the SAME table conv 203
// renders from is what keeps this from becoming a second, drifting opinion — a new class added to
// ERR_TYPE is understood here for free, and a renamed one cannot silently fall through to Normal
// (it falls through to Unknown, which publishes nothing).
inline FaultClass fault_class_from_text(const char* text) {
    if (!text) return FaultClass::Unknown;
    for (int i = 0; i < FAULT_CLASS_COUNT; i++) {
        const char* a = ERR_TYPE[i];
        const char* b = text;
        while (*a && *a == *b) { ++a; ++b; }
        if (!*a && !*b) return static_cast<FaultClass>(i);
    }
    return FaultClass::Unknown;
}

// Error is the class Daikin raises for a unit that has STOPPED on a fault. Warning and Caution are
// both "running, but the unit is complaining", and they are folded into one flag on purpose: a
// consumer that needs the three-way distinction has the textual class right beside these, and
// inventing a third boolean for a severity nobody on this install has yet observed would be the
// kind of guess #35-#39 was made of.
inline constexpr bool fault_error_active(FaultClass c)   { return c == FaultClass::Error; }
inline constexpr bool fault_warning_active(FaultClass c) {
    return c == FaultClass::Warning || c == FaultClass::Caution;
}

// The companions published beside every conv-203 row, in the row's own MQTT group. The JSON key is
// group-scoped by construction (a profile carries an error class on the outdoor page AND on the
// hydronic one, and each lands in its own group object), so the keys stay short; the HA entity ids
// prepend the group, since THOSE share one flat namespace.
struct FaultCompanion {
    const char* key;    // JSON key inside the row's group
    const char* name;   // HA entity name suffix
};

inline constexpr FaultCompanion FAULT_COMPANIONS[] = {
    {"error_active",   "Error Active"},
    {"warning_active", "Warning Active"},
};
inline constexpr size_t FAULT_COMPANION_COUNT =
    sizeof(FAULT_COMPANIONS) / sizeof(FAULT_COMPANIONS[0]);

// "1"/"0" — the wire form, always numeric, for companion `i`. An Unknown class has no honest answer
// and the caller publishes nothing for it (see fault_companions_publishable): reporting 0/0 would
// assert "no fault" on a byte we could not read, which is the one direction a fault flag must never
// fail in.
inline const char* fault_companion_state(size_t i, FaultClass c) {
    const bool on = (i == 0) ? fault_error_active(c) : fault_warning_active(c);
    return on ? "1" : "0";
}

inline constexpr bool fault_companions_publishable(FaultClass c) { return c != FaultClass::Unknown; }

} // namespace daik
