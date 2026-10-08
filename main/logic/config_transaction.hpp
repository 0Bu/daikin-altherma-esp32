#pragma once
// The config save transactions, executed by main/config.cpp over NVS, by the host logic tests
// (test/test_logic.cpp) and by the runtime harness (test/runtime/) over fakes, so the failure
// boundaries are proven on the code that ships rather than on a copy that can drift. IDF-free: the
// persistent store is a template parameter with exactly one member,
//
//     int write_blob(const char* key, const uint8_t* data, size_t len);
//
// which returns 0 on success and the store's own non-zero code (esp_err_t on the device) on
// failure. A failed write must leave that key's previous value intact — IDF v6.1 nvs_set_blob is
// write-through and atomic per entry and nvs_commit is a no-op, so there is no staged state to lose
// or roll back — and the store reports failure by return value only, never by throwing.
//
// Two durability domains share one config mutex, which the CALLER holds around every call here:
//
//   "cfg"  — the credential/service blob (logic/config_store.hpp). Its writers are the service
//            /set_* routes and the boot-time saves that finish before httpd starts (the WiFi
//            rollback/success commits, the initial HomeHub discovery); a service save requires it.
//            An X10A /set_hp never writes it.
//   "link" — the X10A link cache (RX/TX pins, protocol, observation identity). Its writers are the
//            detection commit and an X10A /set_hp; a service save only maintains it.
#include <cstddef>
#include <cstdint>
#include <type_traits>
#include <utility>
#include <vector>
#include "config_model.hpp"
#include "config_store.hpp"

namespace daik {

inline constexpr const char* CONFIG_KEY_SERVICE = "cfg";
inline constexpr const char* CONFIG_KEY_LINK    = "link";

// The runtime revision after `current`. Zero is skipped so a wrapped counter never equals the
// "no revision" value a failed commit reports.
inline uint32_t config_next_revision(uint32_t current) {
    const uint32_t next = current + 1;
    return next ? next : 1;
}

enum class ConfigSaveResult : uint8_t { Saved, Stale, Failed };

// Where a save stopped, or which part of it was given up on.
enum class ConfigSaveStep : uint8_t {
    None,         // nothing went wrong
    FieldTooLong, // a service string would not decode again: nothing was written
    ServiceWrite, // the "cfg" write failed: nothing durable changed and "link" was not attempted
    LinkWrite,    // the "link" write failed; ConfigSaveOutcome::result says what that cost
};

// At most one write can fail per transaction (a failed "cfg" write ends it), so one step and one
// store code describe every outcome. The result defaults to Failed so a path that forgets to decide
// fails closed.
struct ConfigSaveOutcome {
    ConfigSaveResult result      = ConfigSaveResult::Failed;
    ConfigSaveStep   failed      = ConfigSaveStep::None;
    int              store_error = 0;
};

// The service blob a Config persists: every field config_load reads back from "cfg". The link
// fields are not part of it and the model (profile + fingerprint) is never persisted. Board
// hardware, the OTA channel, the UI language and the HomeHub stack ride the same blob because each
// has exactly one writer (the httpd task; the initial HomeHub discovery finishes before httpd
// starts), which makes "save the indicator pin" all-or-nothing instead of a pin written without its
// polarity. Diagnostics consent and its generation ride with every source that depends on them.
inline ConfigBlob config_blob_from(const Config& c) {
    ConfigBlob b;
    b.wifi_ssid                      = c.wifi_ssid;
    b.wifi_pass                      = c.wifi_pass;
    b.wifi_ssid_backup               = c.wifi_ssid_backup;
    b.wifi_pass_backup               = c.wifi_pass_backup;
    b.wifi_rollback_active           = c.wifi_rollback_active;
    b.wifi_rolled_back               = c.wifi_rolled_back;
    b.mqtt_uri                       = c.mqtt_uri;
    b.mqtt_user                      = c.mqtt_user;
    b.mqtt_pass                      = c.mqtt_pass;
    b.mqtt_base                      = c.mqtt_base;
    b.ref_temp_name                  = c.ref_temp_name;
    b.ref_temp_topic                 = c.ref_temp_topic;
    b.ref_temp_path                  = c.ref_temp_path;
    b.ref_temp_time_path             = c.ref_temp_time_path;
    b.ref_temp_setpoint_topic        = c.ref_temp_setpoint_topic;
    b.ref_temp_time_topic            = c.ref_temp_time_topic;
    b.ref_temp_fixed_setpoint_tenths = c.ref_temp_fixed_setpoint_tenths;
    b.ref_temp_setpoint_path         = c.ref_temp_setpoint_path;
    b.ref_temp_enabled_path          = c.ref_temp_enabled_path;
    b.ref_temp_hvac_mode_path        = c.ref_temp_hvac_mode_path;
    b.ref_temp_max_age_s             = c.ref_temp_max_age_s;
    b.circulation_name               = c.circulation_name;
    b.circulation_topic              = c.circulation_topic;
    b.circulation_power_path         = c.circulation_power_path;
    b.circulation_time_path          = c.circulation_time_path;
    b.circulation_max_age_s          = c.circulation_max_age_s;
    b.circulation_on_tenths_w        = c.circulation_on_tenths_w;
    b.circulation_off_tenths_w       = c.circulation_off_tenths_w;
    b.circulation_confirm_s          = c.circulation_confirm_s;
    b.weather_enabled                = c.weather_enabled;
    b.weather_latitude_e6            = c.weather_latitude_e6;
    b.weather_longitude_e6           = c.weather_longitude_e6;
    b.diagnostics_enabled            = c.diagnostics_enabled;
    b.diagnostics_generation         = c.diagnostics_generation;
    b.env3_enabled                   = c.env3_enabled;
    b.env3_sda                       = c.env3_sda;
    b.env3_scl                       = c.env3_scl;
    b.board_preset_id                = static_cast<int32_t>(c.board_preset_id);
    b.board_user_set                 = c.board_user_set;
    b.syslog_host                    = c.syslog_host;
    b.syslog_port                    = c.syslog_port;
    b.ntp_server                     = c.ntp_server;
    b.led_gpio                       = c.led_gpio;
    b.led_type                       = c.led_type;
    b.led_inverted                   = c.led_inverted;
    b.btn_gpio                       = c.btn_gpio;
    b.btn_active_low                 = c.btn_active_low;
    b.ota_channel                    = ota_channel_to_int(c.ota_channel);
    b.ui_lang                        = ui_lang_to_int(c.ui_lang);
    b.mb_host                        = c.mb_host;
    b.mb_port                        = c.mb_port;
    b.mb_unit_id                     = c.mb_unit_id;
    b.mb_discovery_done              = c.mb_discovery_done;
    return b;
}

// One whole-struct save: config_save (owns_link == false) and the X10A config_save_link (true).
//
// Every writer of `live` runs under the caller's config mutex, so the order below is the only
// ordering there is. The persistent entries are atomic one by one (see the Store contract above),
// which leaves two things to get right: what is written, and what can still go wrong after the
// first write.
//
//  * A service save requires "cfg" and only maintains "link" (a cache failure after the service
//    blob landed must not turn the committed request into a false failure). An X10A save changes
//    only link and model fields (/set_hp rejects a request that mixes in HomeHub fields, which
//    would reach RAM but never "cfg"), so it writes ONLY "link" and requires it. It neither builds
//    nor writes "cfg": the RAM view it holds also carries the sanitising config_load applied
//    without persisting (for example rejected board pins, a colliding ENV III mapping or an
//    unusable weather location), and rewriting that view would persist the fallbacks over the
//    user's stored settings. Its failure is also free of side effects: no durable entry changes
//    and RAM stays as it was.
//  * The only concurrent writer is auto-detection, so a snapshot older than a detection commit is
//    decided by config_save_revision under the mutex: a service save carries the detected link and
//    model forward, an X10A save (which derived its model fields from that snapshot) is refused as
//    Stale before anything is copied, serialized or written.
//  * Everything that can throw is staged before the first durable write: the Config copy, the blobs
//    and the RAM successor. After that boundary only checked writes and a nothrow move remain, so
//    an allocation failure can never answer "failed" for a change that is already durable.
//  * A service blob that this build could not decode again is refused, not written. The decoder
//    rejects the WHOLE blob when any string exceeds CONFIG_BLOB_MAX_STR and the fallback is the
//    legacy per-key layout a blob-era device never populated, so such a write would silently
//    destroy the whole config at the next boot. This is the last point where every field is
//    together.
//
// `live` changes (all of it, revision bumped) only on Saved.
template <class Store>
ConfigSaveOutcome config_save_transaction(Config& live, const Config& requested, bool owns_link,
                                          Store& store) {
    ConfigSaveOutcome        out;
    const ConfigSaveRevision revision =
        config_save_revision(owns_link, requested.runtime_revision, live.runtime_revision);
    if (revision == ConfigSaveRevision::Stale) {
        out.result = ConfigSaveResult::Stale;
        return out;
    }
    Config c = requested;
    if (revision == ConfigSaveRevision::ReconcileDetected) reconcile_detected_config(c, live);

    std::vector<uint8_t> service;
    if (!owns_link) {
        const ConfigBlob b = config_blob_from(c);
        if (!config_blob_strings_fit(b)) {
            out.failed = ConfigSaveStep::FieldTooLong;
            return out;
        }
        service = config_blob_serialize(b);
    }
    const std::vector<uint8_t> link = link_blob_serialize(
        LinkBlob{c.rx_pin, c.tx_pin, static_cast<char>(c.proto), c.x10a_identity_fp});
    Config published           = std::move(c);
    published.runtime_revision = config_next_revision(live.runtime_revision);
    static_assert(std::is_nothrow_move_assignable_v<Config>,
                  "post-NVS Config publication must not allocate or throw");

    if (!owns_link) {
        const int service_err =
            store.write_blob(CONFIG_KEY_SERVICE, service.data(), service.size());
        if (service_err != 0) {
            out.failed      = ConfigSaveStep::ServiceWrite;
            out.store_error = service_err;
            return out;
        }
    }
    const int link_err = store.write_blob(CONFIG_KEY_LINK, link.data(), link.size());
    if (link_err != 0) {
        out.failed      = ConfigSaveStep::LinkWrite;
        out.store_error = link_err;
    }
    // The service blob is vacuously "ok" here: a failed one returned above, and an X10A save has
    // none.
    if (!config_save_succeeded(/*blob_ok=*/true, link_err == 0, owns_link)) return out;
    live       = std::move(published);
    out.result = ConfigSaveResult::Saved;
    return out;
}

// The link detection proved, committed only if `live` still has the revision captured before the
// sweep. A changed link is serialized before it is written and an unchanged one is not written at
// all. The proven link is applied to RAM even when its cache write fails (`link_saved` reports that
// narrower outcome): it was proven on the bus for this session, and the caller's history reset
// scopes every new record to `identity_fp`, so a stale cached identity is rejected fail-closed at
// the next boot. Returns false, with nothing changed, only for a stale revision.
template <class Store>
bool config_commit_detected_link_transaction(Config& live, uint32_t expected_revision, int rx_pin,
                                             int tx_pin, Protocol proto, uint32_t identity_fp,
                                             Store& store, bool& link_saved,
                                             uint32_t& committed_revision) {
    if (live.runtime_revision != expected_revision) {
        link_saved         = false;
        committed_revision = 0;
        return false;
    }
    const bool link_changed = live.rx_pin != rx_pin || live.tx_pin != tx_pin ||
                              live.proto != proto || live.x10a_identity_fp != identity_fp;
    link_saved = true;
    if (link_changed) {
        const std::vector<uint8_t> link =
            link_blob_serialize(LinkBlob{rx_pin, tx_pin, static_cast<char>(proto), identity_fp});
        link_saved = store.write_blob(CONFIG_KEY_LINK, link.data(), link.size()) == 0;
    }
    apply_link(live, rx_pin, tx_pin, proto, identity_fp);
    live.runtime_revision = config_next_revision(live.runtime_revision);
    committed_revision    = live.runtime_revision;
    return true;
}

// The model detection identified, committed only if nothing changed since the link commit returned
// `expected_revision`. RAM only: the model is re-detected on every boot and never persisted. The
// strings are consumed (moved from) and swapped in (apply_model), so nothing allocates under the
// caller's mutex; they are taken by reference so that this adds no string objects to the stack of
// the poll task that calls it.
inline bool config_commit_detected_model_if_current(Config& live, uint32_t expected_revision,
                                                    std::string&& profile, uint32_t fp_pages,
                                                    int fp_kw_tenths, int fp_iu_kw_tenths,
                                                    std::string&& fp_eeprom) {
    if (live.runtime_revision != expected_revision) return false;
    apply_model(live, std::move(profile), fp_pages, fp_kw_tenths, fp_iu_kw_tenths,
                std::move(fp_eeprom));
    live.runtime_revision = config_next_revision(live.runtime_revision);
    return true;
}

} // namespace daik
