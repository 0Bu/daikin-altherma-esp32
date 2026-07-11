#pragma once
// Runtime configuration: the daik::Config model (logic/config_model.hpp) backed by NVS
// (namespace "daik_cfg"). Loaded once at boot; the web UI mutates it via the /set_* handlers.
#include "logic/config_model.hpp"

namespace daik {

// The live config singleton. Valid after config_load().
Config& config();

// Load from NVS, seeding any missing key from its Kconfig default.
void config_load();

// Persist the given config to NVS. Returns true on success.
bool config_save(const Config& c);

} // namespace daik
