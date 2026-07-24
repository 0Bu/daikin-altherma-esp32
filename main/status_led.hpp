#pragma once
// Physical status indicator. Drives the board's onboard LED to signal link and bus status, and to
// make the recovery button's destructive factory reset visible while it happens.
//
// The hardware is a RUNTIME choice (config_model.hpp led_gpio/led_type/led_inverted): one published
// image serves both a plain GPIO LED (Seeed XIAO ESP32-S3, GPIO21 active-low) and an addressable
// WS2812 (M5Stack AtomS3 Lite, GPIO35). The state -> pattern rule both back-ends render is
// logic/led_pattern.hpp.
#include "logic/led_pattern.hpp"

namespace daik {

// Start the indicator task. Call AFTER config_load() — the pin and driver come from the config, so
// starting earlier would read an unloaded one. A no-op when led_gpio is -1 (no indicator).
void status_led_start();

// Assert (or release, with LedSignal::None) a non-operating override that pre-empts the normal
// status pattern — see logic/led_pattern.hpp for the priority rule. Called from button.cpp's task,
// so it must not allocate or block: it stores into an atomic the indicator task reads each slice.
// Safe to call before status_led_start(), and when no indicator is configured (both no-ops).
void status_led_signal(LedSignal s);

} // namespace daik
