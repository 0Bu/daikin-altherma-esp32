#pragma once
// Physische Status-LED-Unterstützung.
// Steuert die onboard LED, um Verbindungs- und Busstatus zu signalisieren.

namespace daik {

// Startet den Hintergrundtask zur Steuerung der Status-LED.
void status_led_start();

} // namespace daik
