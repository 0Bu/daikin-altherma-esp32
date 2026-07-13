#pragma once
// Runtime configuration: the daik::Config model (logic/config_model.hpp) backed by NVS
// (namespace "daik_cfg"). Loaded once at boot; the web UI mutates it via the /set_* handlers.
#include "logic/config_model.hpp"

namespace daik {

// A consistent snapshot of the live config, copied under the internal mutex. Valid after
// config_load(). Returns by value so concurrent writers (config_save / config_set_runtime, called
// from the HTTP and poll tasks) can never expose a torn Config to a reader; bind it with
// `const Config& c = config();` to keep the snapshot alive for the scope.
Config config();

// Load from NVS, seeding any missing key from its Kconfig default.
void config_load();

// Persist the given config to NVS. Returns true on success. Writes user settings (WiFi + MQTT) and
// the X10A link cache (RX/TX pins + protocol); the model (profile + fingerprint) is NOT written.
bool config_save(const Config& c);

// Update the in-RAM config singleton WITHOUT touching NVS. Used for the auto-detected MODEL (profile
// + fingerprint), which is session-only and re-derived every boot (the link cache uses config_save).
void config_set_runtime(const Config& c);

} // namespace daik
