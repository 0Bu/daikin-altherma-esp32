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

// Persist the given config to NVS. The credential/service/board/channel fields are one atomic blob;
// the X10A link cache (RX/TX/proto) is a separate self-healing durability domain. Ordinary callers
// succeed once the blob lands even if best-effort cache maintenance fails afterwards; /set_hp passes
// require_link=true because that route owns the link and must not apply it unless all three cache
// keys landed. The model (profile + fingerprint) is NOT written. For the whole-struct writers only:
// the /set_* handlers, serialized on the single httpd task. The poll task must NOT use this — see
// config_save_link / config_set_model below.
bool config_save(const Config& c, bool require_link = false);

// Commit ONLY the X10A link (rx/tx/proto), patched into the live config under the mutex — the
// caller's other fields are left alone, so a detection commit can never revert a concurrent
// /set_wifi (logic/config_model.hpp documents the field-ownership rule). Returns false if the NVS
// cache write failed; the RAM patch is applied either way (the detected link is proven-good and the
// poll engine must keep using it this session — a lost cache just means re-detecting next boot).
bool config_save_link(int rx_pin, int tx_pin, Protocol proto);

// Commit ONLY the detected model (profile + fingerprint) to the live config. RAM-only and
// unfailable: the model is session-only and re-derived on every boot, so it is never persisted.
void config_set_model(std::string profile, uint32_t fp_pages, int fp_kw_tenths, std::string fp_eeprom);

// Publish a whole config to the in-RAM singleton WITHOUT touching NVS. Used by POST /detect to reset
// the session-only model back to the "auto" sentinel; the detection path itself commits through the
// narrow setters above. Whole-struct like config_save, so the same rule applies: httpd task only.
void config_set_runtime(const Config& c);

// ── Build/hardware facts read from Kconfig, exposed so logic/board_pins.hpp's octal_spi input comes
// from ONE place (this file) instead of a #if block copied into each call site; logic/ must not see
// CONFIG_* itself. ──
// True iff THIS build's flash and/or PSRAM run Octal I/O, so GPIO33-37 carry SPIIO4-7/DQS and are
// unsafe for the X10A link (logic/board_pins.hpp `octal_spi`).
bool hw_octal_spi();
// board_pins' other input, `reserved` — the GPIOs the firmware itself drives (status indicator +
// recovery button) — is no longer a Kconfig fact: both are runtime-configured, so it is read from
// the live config via config_reserved_pins(config()) (logic/config_model.hpp).

} // namespace daik
