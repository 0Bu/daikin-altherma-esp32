#pragma once
// Physical recovery button: hold it down to factory-reset the device.
//
// WHY a hardware path exists at all. Every other way to reset this firmware's configuration goes
// through the network — the web UI, /set_wifi, MQTT. That is fine for every failure EXCEPT the one
// that matters most: the device is on a WiFi network the user can no longer reach (moved house,
// changed router, mistyped an SSID that happened to exist). The credential rollback (wifi.cpp)
// covers a *rejected* password; it cannot cover a network that accepts the device onto a LAN the
// user isn't on. Until now the only cure was USB + `esptool erase_flash` — i.e. opening the
// enclosure and finding a cable, for a config mistake.
//
// The button is the offline cure: hold BUTTON_FIRE_MS (logic/button.hpp) and the firmware erases
// the whole "daik_cfg" NVS namespace, legacy WiFi flash credentials, history journal plus
// trend/dwell RAM, and the raw coredump. It reboots into the setup portal only when every privacy
// erase succeeds. Press classification — including the arm checkpoint that warns before anything is
// destroyed — is the pure, host-tested logic/button.hpp; this file coordinates GPIO, storage and
// the indicator.
//
// Runtime-configured (config_model.hpp btn_gpio/btn_active_low) and DISABLED by default, because an
// unconfigured input floats and a floating pin that reads "pressed" for five seconds would wipe a
// board nobody touched. Reference board: M5Stack AtomS3 Lite, GPIO41, active-low.

namespace daik {

// Start the button task. Call AFTER config_load(). A no-op when btn_gpio is -1 (no button wired /
// configured). Started even in safe mode: this is a recovery path, and safe mode is exactly the
// state where the user most needs one.
void recovery_button_start();

} // namespace daik
