#include "sdk.hpp"
#include <cstdlib>
#include <functional>
#include <new>
#include <stdexcept>
#include "state_dwell.hpp"
#ifdef HTTP_STREAM_LEGACY_DWELL
namespace daik {
logic::DwellReading dwell_reading(uint8_t, uint8_t, int);
}
#endif

void* operator new(size_t size) {
    if (sdk::track_allocations) {
        sdk::largest_allocation = std::max(sdk::largest_allocation, size);
        if (++sdk::allocations == sdk::fail_allocation) {
            sdk::fail_allocation = 0;
            throw std::bad_alloc();
        }
    }
    if (void* memory = std::malloc(size ? size : 1)) return memory;
    throw std::bad_alloc();
}
void* operator new[](size_t size) { return ::operator new(size); }
void  operator delete(void* memory) noexcept { std::free(memory); }
void  operator delete[](void* memory) noexcept { std::free(memory); }
void  operator delete(void* memory, size_t) noexcept { std::free(memory); }
void  operator delete[](void* memory, size_t) noexcept { std::free(memory); }

#include HTTP_COMMON_SOURCE
#include HTTP_STATUS_SOURCE
#include STATE_DWELL_SOURCE

namespace fixture {
inline std::string                    oracle;
inline daik::Config                   current;
inline std::vector<daik::CachedValue> rows, modbus_rows;
inline daik::HpValuesIdentity         identity{"generic", 0x1234, 7, 11};
inline bool                           ota = false, weather = false, modbus_live = false;
inline bool                           config_unreadable    = false;
inline bool                           change_history_epoch = false;
inline uint32_t                       epoch                = 42;
inline int                            failure = 0, stage_race = 0;
inline unsigned                       stack_samples = 0;
inline unsigned                       wifi_calls    = 0;
inline daik::WifiScanEntry            scan_rows[20]{};
inline int                            scan_count = 0, scan_failure = 0;
inline unsigned                       scan_calls             = 0;
inline size_t                         scan_first_allocations = 0;
inline std::string                    log;
[[noreturn]] void                     fail(const char* message) {
    std::fprintf(stderr, "FAIL %s: %s\n", oracle.c_str(), message);
    std::exit(1);
}
void check(bool value, const char* message) {
    if (!value) fail(message);
}
void emit(const httpd_req_t& req, const char* name) {
    std::printf("WIRE %s %s ", name, req.content_type == "application/json" ? "json" : "text");
    for (const unsigned char byte : req.response) std::printf("%02x", byte);
    std::printf("\n");
}
void reset() {
    sdk::track_allocations = false;
    sdk::allocations = sdk::fail_allocation = 0;
    sdk::largest_allocation                 = 0;
    sdk::after_chunk                        = nullptr;
    current                                 = {};
    current.profile                         = "generic";
    current.wifi_ssid                       = "Café \"quoted\"\\line\n";
    current.mqtt_base                       = "daikin-altherma-esp32";
    ota = weather = modbus_live = change_history_epoch = false;
    config_unreadable                                  = false;
    epoch                                              = 42;
    failure = stage_race = 0;
    stack_samples = wifi_calls = 0;
    scan_count = scan_failure = 0;
    scan_calls                = 0;
    scan_first_allocations    = 0;
    std::memset(scan_rows, 0, sizeof(scan_rows));
    sdk::now        = 10000000;
    sdk::clock_step = 0;
    fixture_ticks   = 0;
    fixture_delay   = nullptr;
    identity        = {"generic", 0x1234, 7, 11};
    rows.clear();
    modbus_rows.clear();
    for (size_t i = 0; i < 129; ++i) {
        daik::CachedValue row;
        row.label = i == 0 ? "Flag" : "Temp Café \"quote\"\\unit\n";
        row.value = i == 0 ? "0" : "12.34567890123456789";
        row.unit  = i == 0 ? "" : "°C";
        row.reg   = i == 0 ? 0x60 : 0x61;
        row.off   = i == 0 ? 12 : static_cast<uint8_t>(i);
        row.conv  = i == 0 ? 300 : 217;
        row.held  = i == 1;
        rows.push_back(std::move(row));
    }
    log.clear();
    for (int i = 0; i < 40; ++i)
        log += "[1.000] syslog: forwarding to Fixture home network (192.0.2.10), reachable=yes\n";
    daik::dwell_start();
    daik::dwell_forget();
    daik::dwell_record(rows.data(), rows.size(), identity.source_generation, 120, &identity);
    sdk::now += 5000000;
    daik::dwell_record(rows.data(), rows.size(), identity.source_generation, 120, &identity);
}
httpd_req_t request() {
    httpd_req_t req;
    req.headers["Host"] = "daikin-altherma-esp32.local";
    return req;
}
esp_err_t invoke(httpd_req_t& req, const char* uri, esp_err_t (*handler)(httpd_req_t*),
                 size_t fail_at = 0) {
    req.uri                 = uri;
    req.method              = HTTP_GET;
    req.user_ctx            = reinterpret_cast<void*>(handler);
    sdk::allocations        = 0;
    sdk::largest_allocation = 0;
    sdk::fail_allocation    = fail_at;
    sdk::track_allocations  = true;
    const auto result       = daik::handle_then_settle_body(&req);
    sdk::track_allocations  = false;
    sdk::fail_allocation    = 0;
    return result;
}
void next_request() {
    auto req = request();
    check(invoke(req, "/values", daik::h_values) == ESP_OK && req.final_chunks == 1 &&
              !fixture_mutex.held,
          "failure stranded a mutex or poisoned the next request");
}
void successful(const httpd_req_t& req) {
    check(req.status == "200 OK" && req.final_chunks == 1 && req.max_chunk <= 1024 &&
              req.replacement_responses == 0 && req.late_status_changes == 0,
          "completed stream is unbounded or replaced");
}
void maximum_scan() {
    scan_count = 20;
    for (int i = 0; i < scan_count; ++i) {
        std::memset(scan_rows[i].ssid, 0x80, 32);
        scan_rows[i].ssid[32] = '\0';
        scan_rows[i].rssi = static_cast<int8_t>(i == 0 ? -128 : i == 18 ? 0 : i == 19 ? 127 : -i);
    }
}
void allocation_sweep(const char* uri, esp_err_t (*handler)(httpd_req_t*)) {
    auto baseline = request();
    check(invoke(baseline, uri, handler) == ESP_OK && baseline.status == "200 OK" &&
              baseline.final_chunks == 1,
          "allocation baseline stream failed");
    const size_t allocation_count = sdk::allocations;
    check(allocation_count > 0, "allocation oracle did not enter production work");
    unsigned before = 0, after = 0;
    for (size_t i = 1; i <= allocation_count; ++i) {
        auto       req    = request();
        const auto result = invoke(req, uri, handler, i);
        if (!req.emission_attempts) {
            ++before;
            check(result == ESP_OK && req.status == "503 Service Unavailable" &&
                      req.response == "out of memory",
                  "pre-send OOM did not produce one clean 503");
        } else {
            ++after;
            check(result == ESP_FAIL && req.final_chunks == 0 && req.replacement_responses == 0 &&
                      req.late_status_changes == 0,
                  "post-send OOM appended a replacement response or completed partial data");
        }
        next_request();
    }
    check(before > 0, "no pre-send allocation failures tested");
    if (handler == daik::h_status || handler == daik::h_diag)
        check(after > 0, "no actual post-send allocations tested");
    std::printf("ALLOC %s before=%u after=%u\n", uri, before, after);
}
void chunk_sweep(const char* uri, esp_err_t (*handler)(httpd_req_t*)) {
    auto baseline = request();
    check(invoke(baseline, uri, handler) == ESP_OK, "chunk baseline failed");
    successful(baseline);
    const unsigned chunks = baseline.chunks;
    check(chunks > 0, "no data chunks to fail");
    for (unsigned i = 0; i <= chunks; ++i) {
        auto req       = request();
        req.fail_chunk = static_cast<int>(i);
        check(invoke(req, uri, handler) == ESP_FAIL && req.final_chunks == 0 &&
                  req.replacement_responses == 0 && req.late_status_changes == 0,
              "chunk failure did not abort incomplete response");
        next_request();
    }
}
} // namespace fixture

namespace daik {
Config      config() { return fixture::current; }
std::string config_profile() { return fixture::current.profile; }
bool        config_stored_blob_unreadable() { return fixture::config_unreadable; }
bool        hw_octal_spi() { return false; }
bool        provisioning_ap_active() { return false; }
bool        ota_download_active() { return fixture::ota; }
bool        ota_busy() { return fixture::ota; }
size_t      heap_largest_internal_block() { return 32768; }
uint8_t     heap_guard_restarts() { return 0; }
void        stack_watch_sample(StackWatch) noexcept { ++fixture::stack_samples; }
uint32_t    stack_watch_min_free_bytes(StackWatch) noexcept { return 0; }
WifiInfo    wifi_info() {
    ++fixture::wifi_calls;
    if (fixture::failure == 2 || (fixture::failure == 1 && fixture::wifi_calls >= 2))
        throw std::runtime_error("injected status snapshot failure");
    WifiInfo info{};
    std::strcpy(info.ip, "192.0.2.10");
    info.connected = true;
    info.rssi      = -42;
    return info;
}
int wifi_scan(WifiScanEntry* out, int max) {
    ++fixture::scan_calls;
    if (fixture::scan_failure == 1) throw std::bad_alloc();
    if (fixture::scan_failure == 2) throw std::runtime_error("injected scan failure");
    const int n = std::min(max, fixture::scan_count);
    std::copy_n(fixture::scan_rows, n, out);
    return n;
}
EthInfo                           net_eth_info() { return {}; }
EthPins                           net_eth_pins() { return {}; }
ReservedPins                      net_eth_reserved_pins() { return {}; }
NetLink                           net_kind() { return NetLink::Wifi; }
bool                              safe_mode_active() { return false; }
const char*                       safe_mode_cause() { return nullptr; }
CrashInfo                         diag_crash_info() { return {}; }
CrashInfo                         diag_crash_info_live() { return {}; }
bool                              diag_crash_coredump_present() { return false; }
void                              diag_printf(const char*, ...) {}
Env3Status                        env3_status() { return {}; }
MqttStatus                        mqtt_status() { return {}; }
MqttSkipStats                     mqtt_skip_stats() { return {}; }
uint32_t                          mqtt_retirement_evidence() noexcept { return 0; }
ReferenceTemperatureStatus        reference_temperature_status(const Config&) { return {}; }
logic::HeatingCurveSnapshot       heating_curve_status() { return {}; }
CirculationSourceStatus           circulation_source_status(const Config&) { return {}; }
CirculationPumpSample             circulation_pump_sample() { return {}; }
WeatherForecastStatus             weather_forecast_status() { return {}; }
bool                              weather_fetch_active() { return fixture::weather; }
SyslogStatus                      syslog_status() { return {}; }
HpStats                           hp_stats() { return {}; }
uint32_t                          hp_skipped_cycles() { return 0; }
logic::RefrigerantServiceSnapshot refrigerant_service_status() { return {}; }
ModbusStatus                      mb_status() {
    ModbusStatus s;
    s.connected = fixture::modbus_live;
    return s;
}
ModbusProfile mb_active_profile() { return ModbusProfile::HomeHub; }
size_t        mb_values_capacity() { return fixture::modbus_rows.size(); }
size_t        mb_values_snapshot(CachedValue* out, size_t cap, bool& live) {
    live           = fixture::modbus_live;
    const size_t n = std::min(cap, fixture::modbus_rows.size());
    for (size_t i = 0; i < n; ++i) out[i] = fixture::modbus_rows[i];
    return n;
}
size_t hp_values_capacity(uint32_t* revision) {
    if (revision) *revision = fixture::identity.cache_revision;
    return fixture::rows.size();
}
size_t hp_values_snapshot(CachedValue* out, size_t cap, size_t* total, uint32_t* revision,
                          HpValuesIdentity* identity) {
    if (total) *total = fixture::rows.size();
    if (revision) *revision = fixture::identity.cache_revision;
    if (identity) *identity = fixture::identity;
    const size_t n = std::min(cap, fixture::rows.size());
    for (size_t i = 0; i < n; ++i) out[i] = fixture::rows[i];
    if (fixture::stage_race) {
        auto pending = fixture::identity;
        if (fixture::stage_race == 1) pending.cache_revision++;
        if (fixture::stage_race == 2) pending.profile_id = "altherma_3";
        if (fixture::stage_race == 3) pending.identity_fp++;
        if (fixture::stage_race == 4) pending.source_generation++;
        if (fixture::stage_race == 5) fixture::rows[0].value = "1";
        // Invoke the ACTUAL dwell producer before its cache commit, then keep the returned
        // values untouched. The source API seam controls the interleaving, not the serializer.
        dwell_record(fixture::rows.data(), fixture::rows.size(),
                     fixture::identity.source_generation, 120, &pending);
    }
    return n;
}
bool hp_poll_generation_matches(uint32_t generation) {
    return generation == fixture::identity.source_generation;
}
const char* history_persist_state() { return "no_record"; }
uint32_t    history_epoch() noexcept { return fixture::epoch; }
size_t      history_label(size_t, char* out, size_t cap) {
    return std::snprintf(out, cap, "Supply Café \"quote\"\\line\n");
}
size_t history_unit(size_t, char* out, size_t cap) { return std::snprintf(out, cap, "°C"); }
size_t history_snapshot(size_t, logic::HistorySample* out, size_t max, uint32_t* epoch,
                        logic::HistoryMeta* meta) {
    const size_t n = std::min<size_t>(max, logic::HISTORY_SAMPLES);
    for (size_t i = 0; i < n; ++i)
        out[i] = i % 2 ? logic::HISTORY_HELD_OVER : static_cast<int16_t>(static_cast<int>(i) - 100);
    if (epoch) *epoch = fixture::epoch;
    if (meta) {
        meta->newest_age_s  = 10;
        meta->oldest_bucket = 100;
    }
    if (fixture::change_history_epoch) ++fixture::epoch;
    return n;
}
size_t history_modbus_snapshot(size_t t, logic::HistorySample* out, size_t max, uint32_t* epoch,
                               logic::HistoryMeta* meta) {
    return history_snapshot(t, out, max, epoch, meta);
}
size_t history_env3_snapshot(size_t t, logic::HistorySample* out, size_t max, uint32_t* epoch,
                             logic::HistoryMeta* meta) {
    return history_snapshot(t, out, max, epoch, meta);
}
TimeStatus time_status() {
    TimeStatus s;
    s.synced    = true;
    s.unix_time = 2000000000;
    return s;
}
void time_now(int64_t& seconds, int32_t& ms) {
    seconds = 2000000000;
    ms      = 0;
}
const char*          checkup_persist_state() { return "no_record"; }
logic::CheckupReport checkup_report() { return {}; }
size_t               diag_dump(char* out, size_t cap) {
    const size_t n = std::min(cap, fixture::log.size());
    std::memcpy(out, fixture::log.data(), n);
    return n;
}
void diag_set_verbose(bool) {}
} // namespace daik

int main(int argc, char** argv) {
    using namespace fixture;
    const std::string selected = argc > 1 ? argv[1] : "";
    unsigned          count    = 0;
    auto              run      = [&](const char* name, const std::function<void()>& fn) {
        if (!selected.empty() && selected != name) return;
        oracle = name;
        reset();
        fn();
        ++count;
        std::printf("PASS %s\n", name);
    };
    run("completed_oracles", [] {
        for (const auto& [uri, handler] :
             std::vector<std::pair<const char*, esp_err_t (*)(httpd_req_t*)>>{
                 {"/status", daik::h_status},
                 {"/values", daik::h_values},
                 {"/history?row=leaving_water", daik::h_history},
                 {"/diag", daik::h_diag},
                 {"/diag?redact=1", daik::h_diag}}) {
            auto req = request();
            check(invoke(req, uri, handler) == ESP_OK, "completed handler failed");
            successful(req);
            emit(req, uri);
        }
    });
    run("config_unreadable_status", [] {
        for (const bool unreadable : {false, true}) {
            config_unreadable = unreadable;
            for (const bool redact : {false, true}) {
                auto req = request();
                check(invoke(req, redact ? "/status?redact=1" : "/status", daik::h_status) ==
                          ESP_OK,
                      "stored configuration status failed");
                successful(req);
                check((req.response.find("\"config_unreadable\":") != std::string::npos) ==
                          unreadable,
                      "stored configuration warning omitted or fabricated");
                if (unreadable)
                    check(req.response.find("\"config_unreadable\":true") != std::string::npos,
                          "stored configuration warning is not literal true");
                emit(req, unreadable
                              ? (redact ? "config-unreadable-redacted" : "config-unreadable-plain")
                              : (redact ? "config-readable-redacted" : "config-readable-plain"));
            }
        }
        config_unreadable = false;
        current           = {};
        for (const bool redact : {false, true}) {
            auto req = request();
            check(invoke(req, redact ? "/status?redact=1" : "/status", daik::h_status) == ESP_OK,
                  "unconfigured status failed");
            successful(req);
            check(req.response.find("\"config_unreadable\":") == std::string::npos,
                  "unconfigured device has a stored configuration warning");
            emit(req, redact ? "config-absent-redacted" : "config-absent-plain");
        }
    });
    run("allocation_failures", [] {
        allocation_sweep("/status", daik::h_status);
        config_unreadable = true;
        allocation_sweep("/status?redact=1", daik::h_status);
        config_unreadable = false;
        allocation_sweep("/values", daik::h_values);
        allocation_sweep("/history?row=leaving_water", daik::h_history);
        allocation_sweep("/diag?redact=1", daik::h_diag);
    });
    run("chunk_failures", [] {
        chunk_sweep("/status", daik::h_status);
        config_unreadable = true;
        chunk_sweep("/status?redact=1", daik::h_status);
        config_unreadable = false;
        chunk_sweep("/values", daik::h_values);
        chunk_sweep("/history?row=leaving_water", daik::h_history);
        chunk_sweep("/diag", daik::h_diag);
        chunk_sweep("/diag?redact=1", daik::h_diag);
    });
    run("dwell_state_and_identity", [] {
        for (int race = 0; race <= 5; ++race) {
            reset();
            stage_race = race;
            auto req   = request();
            check(invoke(req, "/values", daik::h_values) == ESP_OK, "dwell response failed");
            successful(req);
            const bool has_age = req.response.find("\"dwell_s\":") != std::string::npos;
            check(has_age == (race == 0),
                  "dwell belongs to a different code/profile/source/revision");
            check(req.response.find("\"value\":\"0\"") != std::string::npos,
                  "snapshot value changed during dwell fold");
            emit(req, race == 0 ? "dwell-match" : "dwell-mismatch");
        }
    });
    run("invalid_utf8_output", [] {
        current.wifi_ssid = std::string("bad\x80\xc0\xaf\xe2\x82", 8);
        auto req          = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "invalid source bytes broke response");
        successful(req);
        emit(req, "invalid-ssid");
        check(req.response.find("\\ufffd\\ufffd\\ufffd\\ufffd\\ufffd") != std::string::npos,
              "invalid source bytes escaped UTF8 guard");
    });
    run("history_epoch_refusal", [] {
        change_history_epoch = true;
        auto req             = request();
        check(invoke(req, "/history?row=leaving_water", daik::h_history) == ESP_OK &&
                  req.status == "503 Service Unavailable" && req.emission_attempts == 0,
              "history mixed two epochs before send");
        emit(req, "epoch-refusal");
    });
    run("weather_and_ota_admission", [] {
        weather       = true;
        fixture_delay = [](TickType_t) { fixture::weather = false; };
        auto req      = request();
        check(invoke(req, "/values", daik::h_values) == ESP_OK && fixture_ticks == 250,
              "short Weather wait changed");
        weather       = true;
        fixture_delay = nullptr;
        req           = request();
        check(invoke(req, "/values", daik::h_values) == ESP_OK &&
                  req.status == "503 Service Unavailable" && fixture_ticks == 4250,
              "Weather wait is unbounded");
        ota = true;
        req = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK &&
                  req.status == "503 Service Unavailable" && req.emission_attempts == 0,
              "OTA status admission reached serializer");
    });
    run("general_exception", [] {
        failure           = 1;
        auto       req    = request();
        const auto result = invoke(req, "/status", daik::h_status);
        check(result == ESP_FAIL && req.emission_attempts > 0 && req.replacement_responses == 0 &&
                  req.late_status_changes == 0,
              "postcommit general throw appended another response");
        failure = 0;
        next_request();
        failure = 2;
        req     = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK &&
                  req.status == "500 Internal Server Error" && req.emission_attempts == 0 &&
                  req.response == "handler error",
              "precommit general throw not clean 500");
        failure = 0;
        next_request();
    });
    run("first_send_failure_then_oom", [] {
        auto baseline       = request();
        baseline.fail_chunk = 0;
        check(invoke(baseline, "/status", daik::h_status) == ESP_FAIL,
              "first chunk failure ignored");
        const size_t total = sdk::allocations;
        unsigned     later = 0;
        for (size_t i = 1; i <= total; ++i) {
            auto req          = request();
            req.fail_chunk    = 0;
            const auto result = invoke(req, "/status", daik::h_status, i);
            if (req.emission_attempts) {
                ++later;
                check(result == ESP_FAIL && req.replacement_responses == 0 &&
                          req.late_status_changes == 0,
                      "failed first emission reopened clean-error window");
            }
            next_request();
        }
        check(later > 0, "no allocation after failed first emission exercised");
    });
    run("snapshot_stable_after_send", [] {
        std::rotate(rows.begin(), rows.begin() + 1, rows.end());
        sdk::after_chunk = [] {
            sdk::after_chunk           = nullptr;
            fixture::rows.back().value = "1";
            auto pending               = fixture::identity;
            ++pending.cache_revision;
            daik::dwell_record(fixture::rows.data(), fixture::rows.size(),
                               pending.source_generation, 120, &pending);
        };
        auto req = request();
        check(invoke(req, "/values", daik::h_values) == ESP_OK, "concurrent stream failed");
        successful(req);
        check(req.response.find("\"value\":\"0\"") != std::string::npos &&
                  req.response.find("\"dwell_s\":5") != std::string::npos,
              "stream re-read value/state-age after snapshot");
        emit(req, "stable-values");
    });
    run("modbus_independent_types", [] {
        modbus_live = true;
        for (const auto offset : {22, 40, 4}) {
            const auto* definition = daik::def::homehub_find(offset);
            check(definition != nullptr, "fixture must use a real Modbus definition");
            daik::CachedValue row;
            row.label             = definition->label;
            row.unit              = definition->unit;
            row.off               = static_cast<uint8_t>(offset);
            row.modbus_definition = daik::def::homehub_definition_id(*definition);
            row.value             = offset == 22 ? "U4" : offset == 40 ? "12.3" : "1";
            modbus_rows.push_back(row);
        }
        daik::CachedValue invalid;
        invalid.label             = "Broken numeric";
        invalid.off               = 40;
        invalid.modbus_definition = daik::def::homehub_definition_id(*daik::def::homehub_find(40));
        invalid.value             = "not-a-number";
        modbus_rows.push_back(invalid);
        auto req = request();
        check(invoke(req, "/values", daik::h_values) == ESP_OK,
              "independent Modbus response failed");
        successful(req);
        emit(req, "modbus-values");
        modbus_live = false;
        req         = request();
        check(invoke(req, "/values", daik::h_values) == ESP_OK &&
                  req.response.find("\"modbus\":") == std::string::npos,
              "withdrawn Modbus source remained present");
    });
    run("shared_protocol_framing", [] {
        auto req = request();
        check(invoke(req, "/values",
                     [](httpd_req_t* request) {
                         return daik::http_send_values_json(request, "{\"result\":", "}");
                     }) == ESP_OK,
              "protocol prefix/suffix failed");
        successful(req);
        emit(req, "framed-values");
        config_unreadable = true;
        req               = request();
        check(invoke(req, "/status",
                     [](httpd_req_t* request) {
                         return daik::http_send_status_json(request, "{\"result\":", "}", true);
                     }) == ESP_OK,
              "status protocol prefix/suffix failed");
        successful(req);
        emit(req, "framed-status-redacted");
    });
    run("scan_completed_oracles", [] {
        maximum_scan();
        sdk::after_chunk = [] {
            scan_first_allocations = sdk::allocations;
            // The service changes after emission; only the prepared fixed-size snapshot may
            // reach the wire. Existing public SSID encoding remains the shared JSON encoder.
            std::memset(scan_rows, 0, sizeof(scan_rows));
        };
        auto req = request();
        check(invoke(req, "/scan", daik::h_scan) == ESP_OK, "maximum scan failed");
        check(sdk::largest_allocation <= 2048 && sdk::allocations == scan_first_allocations,
              "scan materialized a body or allocated after emission");
        successful(req);
        check(req.response.size() > 4096 && req.chunks >= 5, "maximum scan was truncated");
        emit(req, "scan-maximum-invalid");
        std::printf("SCAN bytes=%zu chunks=%u allocations=%zu largest_allocation=%zu\n",
                    req.response.size(), req.chunks, sdk::allocations, sdk::largest_allocation);
        sdk::after_chunk = nullptr;
        scan_count       = 0;
        req              = request();
        check(invoke(req, "/scan", daik::h_scan) == ESP_OK, "empty scan failed");
        successful(req);
        emit(req, "scan-empty");
        scan_count = 1;
        std::strcpy(scan_rows[0].ssid, "Café \"quoted\"\\line\n");
        scan_rows[0].rssi = -42;
        req               = request();
        check(invoke(req, "/scan", daik::h_scan) == ESP_OK, "escaped Unicode scan failed");
        successful(req);
        emit(req, "scan-unicode-escape");
    });
    run("scan_failure_boundaries", [] {
        maximum_scan();
        allocation_sweep("/scan", daik::h_scan);
        chunk_sweep("/scan", daik::h_scan);
        for (const int injected : {1, 2}) {
            scan_failure = injected;
            auto req     = request();
            check(invoke(req, "/scan", daik::h_scan) == ESP_OK && req.emission_attempts == 0 &&
                      req.status == (injected == 1 ? "503 Service Unavailable"
                                                   : "500 Internal Server Error") &&
                      req.response == (injected == 1 ? "out of memory" : "handler error"),
                  "pre-send scan exception escaped its clean error boundary");
            scan_failure = 0;
            next_request();
            sdk::after_chunk = injected == 1 ? +[] { throw std::bad_alloc(); } : +[] {
                throw std::runtime_error("scan send failure");
            };
            req              = request();
            check(invoke(req, "/scan", daik::h_scan) == ESP_FAIL && req.emission_attempts == 1 &&
                      req.final_chunks == 0 && req.replacement_responses == 0 &&
                      req.late_status_changes == 0,
                  "midstream scan exception appended an error response");
            sdk::after_chunk = nullptr;
            next_request();
        }
        ota        = true;
        scan_calls = 0;
        auto req   = request();
        check(invoke(req, "/scan", daik::h_scan) == ESP_OK && scan_calls == 0 &&
                  req.status == "503 Service Unavailable" && req.emission_attempts == 0,
              "OTA admission reached the scan service");
    });
    check(count > 0, "unknown oracle");
    std::printf("PASS total=%u\n", count);
}
