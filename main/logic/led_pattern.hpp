#pragma once
// The status indicator's state -> pattern decision, lifted out of status_led.cpp.
//
// Two reasons it is its own pure header rather than an if-chain inside the blink loop:
//
//   1. TWO BACK-ENDS, ONE RULE. The indicator is now runtime-selectable — a plain GPIO LED (Seeed
//      XIAO ESP32-S3, GPIO21 active-low) or an addressable WS2812 (M5Stack AtomS3 Lite, GPIO35).
//      One published image serves both boards (scripts/ci-build-all.sh builds a single esp32s3
//      artifact), so the driver is picked from NVS at boot, not from Kconfig at compile time. Both
//      render the SAME pattern table; only the emit step differs. Duplicating the state->pattern
//      if-chain per back-end is how the two silently drift apart.
//   2. THE OVERRIDE NEEDS A DEFINED PRIORITY. button.cpp's factory reset is destructive and must be
//      visible while it happens, so it pre-empts every operating pattern. "Which wins" is a rule,
//      not a flag read somewhere in the middle of a blink sequence — it belongs where a test can
//      assert it.
//
// A monochrome LED ignores the colour and shows only the blink SHAPE, so every phase below is
// distinguishable on shape alone; the colour is a bonus on an RGB board, never the sole carrier of
// a state. (Same reason the six operating patterns keep the exact timings status_led.cpp shipped:
// this refactor must not silently re-teach a user's board a new vocabulary.)
#include <cstdint>

namespace daik {

// Which indicator hardware this board has. Persisted as an int in the config blob, so the numeric
// values are part of the on-flash format — append, never renumber.
enum class LedType : uint8_t {
    Gpio   = 0,   // plain LED on a GPIO (level-driven, optionally active-low)
    Ws2812 = 1,   // addressable WS2812/WS2812C (one pixel, RMT-driven)
};

inline bool led_type_valid(int v) { return v == 0 || v == 1; }

// A non-operating state the button task asserts over the normal indication. Ordered by urgency:
// a higher value wins, which is also the order led_phase() checks them in.
enum class LedSignal : uint8_t {
    None      = 0,
    WipeArmed = 1,   // the reset button is held past the arm threshold — release now to abort
    Wiping    = 2,   // the config erase is RUNNING (do not pull power)
};

enum class LedPhase : uint8_t {
    Off,           // no transport at all this boot / indicator idle
    SetupPortal,   // SoftAP provisioning portal up
    Connecting,    // a transport exists but holds no address yet
    Healthy,       // link + X10A up, MQTT connected or not configured
    BusDown,       // X10A link down — outranks MqttDown (the bus is the point of the device)
    MqttDown,      // X10A up, but a configured broker is not connected
    WipeArmed,
    Wiping,
};

// One repeat of a pattern: `pulses` × (on for on_ms, off for off_ms), then off for gap_ms.
// pulses == 0 renders as "dark for gap_ms" (the Off phase). A solid phase is one pulse with
// off_ms == 0 and gap_ms == 0. r/g/b are ignored by the GPIO back-end.
struct LedPattern {
    uint8_t r = 0, g = 0, b = 0;
    int     pulses = 0;
    int     on_ms  = 0;
    int     off_ms = 0;
    int     gap_ms = 0;
};

// The observable inputs, snapshotted by the caller (status_led.cpp copies them out of wifi_info() /
// mqtt_status() / hp_stats() before calling in, so this stays allocation-free and IDF-free).
struct LedInputs {
    bool      ap_mode        = false;   // SoftAP or APSTA — any live SoftAP means "setup"
    // NOT WiFi-specific, and deliberately not named so: since the optional wired transport
    // (net.cpp) a board can hold an address with no radio started at all. `link_mode` = some
    // transport exists this boot (a station, or a detected Ethernet controller); `link_up` = it
    // holds an address. Reading these as WiFi facts is what would render a perfectly healthy wired
    // board as the Off pattern — dark, while it serves the whole API over the cable.
    bool      link_mode      = false;
    bool      link_up        = false;
    bool      mqtt_configured = false;
    bool      mqtt_connected  = false;
    bool      hp_connected    = false;
    LedSignal signal          = LedSignal::None;
};

inline LedPhase led_phase(const LedInputs& in) {
    // The button override pre-empts everything: a destructive erase must be visible even if the
    // board happens to be perfectly healthy (which, when someone is deliberately factory-resetting
    // it, is the NORMAL case — gating the signal on a fault would hide it exactly when it matters).
    if (in.signal == LedSignal::Wiping)    return LedPhase::Wiping;
    if (in.signal == LedSignal::WipeArmed) return LedPhase::WipeArmed;

    if (in.ap_mode)  return LedPhase::SetupPortal;
    if (!in.link_mode) return LedPhase::Off;
    if (!in.link_up) return LedPhase::Connecting;

    const bool mqtt_ok = !in.mqtt_configured || in.mqtt_connected;   // unconfigured is not a fault
    if (in.hp_connected && mqtt_ok) return LedPhase::Healthy;
    // X10A-down outranks MQTT-down: with both down this shows the bus fault, never the broker one.
    return in.hp_connected ? LedPhase::MqttDown : LedPhase::BusDown;
}

inline LedPattern led_pattern(LedPhase p) {
    switch (p) {
    // Blue slow heartbeat — "come and configure me".
    case LedPhase::SetupPortal: return {0,   0,   255, 1, 1000, 1000, 0};
    // Yellow fast blink — working on it.
    case LedPhase::Connecting:  return {255, 160, 0,   1, 100,  100,  0};
    // Green solid — everything up.
    case LedPhase::Healthy:     return {0,   255, 0,   1, 500,  0,    0};
    // Red double flash then a long dark gap — the bus fault, the loudest operating pattern.
    case LedPhase::BusDown:     return {255, 0,   0,   2, 120,  150,  1000};
    // Orange medium blink — bus fine, broker missing.
    case LedPhase::MqttDown:    return {255, 90,  0,   1, 300,  300,  0};
    // Red strobe — the erase is ARMED and will fire if the button stays held. Faster than any
    // operating pattern on purpose: "something is counting down".
    case LedPhase::WipeArmed:   return {255, 0,   0,   1, 60,   60,   0};
    // Solid white — the erase is RUNNING. The only phase that is both solid and not green, so it
    // cannot be mistaken for Healthy on a monochrome board either (see below).
    case LedPhase::Wiping:      return {255, 255, 255, 1, 500,  0,    0};
    case LedPhase::Off:
    default:                    return {0,   0,   0,   0, 0,    0,    1000};
    }
}

// Wiping and Healthy are both SOLID, so a monochrome LED cannot tell them apart by shape. That is
// deliberate and safe only because of how the wipe is reached: the button task asserts Wiping ONLY
// while a human is holding the button down, immediately after the unmistakable WipeArmed strobe,
// and the board reboots into Connecting a moment later. There is no way to arrive at a steady
// "solid" and be unsure which one it is. Asserted in the tests so the reasoning is on record.
inline bool led_phase_is_solid(LedPhase p) {
    const LedPattern pat = led_pattern(p);
    return pat.pulses == 1 && pat.off_ms == 0 && pat.gap_ms == 0;
}

// Total duration of one repeat, in ms — the caller's tick length for this phase. Never 0 (a
// zero-length pattern would spin the LED task), which the tests pin for every phase.
inline int led_pattern_period_ms(const LedPattern& p) {
    const int n = p.pulses > 0 ? p.pulses : 0;
    const int d = n * (p.on_ms + p.off_ms) + p.gap_ms;
    return d > 0 ? d : 1000;
}

}  // namespace daik
