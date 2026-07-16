#pragma once
// Physical status-LED support.
// Drives the onboard LED to signal link and bus status.

namespace daik {

// Starts the background task that drives the status LED.
void status_led_start();

} // namespace daik
