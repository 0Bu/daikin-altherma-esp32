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

// Allocation-free snapshot for the UART owner. A full Config copy includes many std::strings and
// can throw under heap pressure; the probe service needs only these three POD fields and runs even
// after an allocating poll cycle was skipped.
struct ConfigLinkSnapshot {
    Protocol proto = Protocol::I;
    int rx_pin = -1;
    int tx_pin = -1;
};
ConfigLinkSnapshot config_link_snapshot();

// Allocation-free snapshot for the compact OTA status route. Reading one enum must not copy the
// string-owning Config while OTA/TLS deliberately keeps that route available under heap pressure.
OtaChannel config_ota_channel();

// Load from NVS, seeding any missing key from its Kconfig default.
void config_load();

// All three writers below are [[nodiscard]], for the reason nvs_storage.hpp's setters carry it one
// layer down: a dropped result is silent, and only the caller knows what the failure costs. A
// /set_* handler that ignores it answers 200 and reboots as if the write landed — precisely what
// AGENTS.md's "Configuration writes are atomic and fallible. Check every result" forbids. Every
// call site checks today; the attribute is what makes the next one a build error rather than a
// review catch, and main/CMakeLists.txt already pins -Werror=unused-result on this component.

// Persist the given config to NVS. The credential/service/board/channel fields are one atomic blob;
// the X10A link cache (RX/TX/proto/history identity) is a separate self-healing durability domain.
// Ordinary callers
// succeed once the blob lands even if best-effort cache maintenance fails afterwards; /set_hp passes
// require_link=true because that route owns the link and must not apply it unless its atomic cache
// entry landed. The model (profile + fingerprint) is NOT written. For the whole-struct writers only:
// the /set_* handlers, serialized on the single httpd task. The poll task must NOT use this — see
// the compare-and-commit detection helpers below.
[[nodiscard]] bool config_save(const Config& c, bool require_link = false);

// Atomically commit the link proven by one detection sweep, but only if the live config still has
// the revision captured before that sweep. The NVS link write and RAM publication are
// serialized with every HTTP config save, closing the detect-vs-/set_hp TOCTOU. A failed NVS cache
// write still publishes the proven session state; `link_saved` reports that narrower durability
// outcome. Returns false only when the expected revision is stale and nothing was changed.
[[nodiscard]] bool config_commit_detected_link(const Config& expected, int rx_pin, int tx_pin,
                                               Protocol proto, uint32_t identity_fp,
                                               bool& link_saved, uint32_t& committed_revision);

// Publish the model only if nothing changed after the link commit. Keeping this as a second CAS lets
// the caller reset every identity-bound observer while the public config still says "auto"; readers
// never see a new profile paired with old trend/checkup/dwell state.
[[nodiscard]] bool config_commit_detected_model(uint32_t expected_revision, std::string profile,
                                                uint32_t fp_pages, int fp_kw_tenths,
                                                int fp_iu_kw_tenths, std::string fp_eeprom);

// Publish a whole config to the in-RAM singleton WITHOUT touching NVS. Used by POST /detect to reset
// the session-only model back to the "auto" sentinel; the detection path itself commits through the
// compare-and-commit helpers above. Whole-struct like config_save, so the same rule applies: httpd
// task only.
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
